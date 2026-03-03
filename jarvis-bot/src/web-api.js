// ============ Web Portal API — Public-Facing Endpoints ============
//
// Serves the VibeSwap frontend at /web/*
// Separate from /api/* (Claude Code bridge, requires X-Api-Secret)
// These endpoints are public but rate-limited per IP.
//
// Endpoints:
//   POST /web/chat         → Talk to JARVIS
//   GET  /web/mind         → Knowledge chain, shards, learning, inner dialogue
//   GET  /web/health       → Status + uptime
//   POST /web/shadow/verify → Validate shadow invite token
// ============

import { config } from './config.js';
import { chat } from './claude.js';
import { getChainStats } from './knowledge-chain.js';
import { getShardInfo, isMultiShard } from './shard.js';
import { getTopology } from './router.js';
import { getSkills, getLearningStats } from './learning.js';
import { getShadowStats, consumeInvite, registerShadow } from './shadow.js';
import { getRecentDialogue, getDialogueStats } from './inner-dialogue.js';
import { getProviderName, getModelName } from './llm-provider.js';
import { checkBudget, recordUsage, getComputeStats, markIdentified } from './compute-economics.js';

// ============ Rate Limiter ============

const rateBuckets = new Map(); // IP -> [timestamps]
const RATE_LIMIT = config.web?.rateLimitPerMinute || 5;
const RATE_WINDOW = 60_000; // 1 minute

function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || [];
  // Prune old entries
  const recent = bucket.filter(t => now - t < RATE_WINDOW);
  if (recent.length >= RATE_LIMIT) {
    rateBuckets.set(ip, recent);
    return false;
  }
  recent.push(now);
  rateBuckets.set(ip, recent);
  return true;
}

// Periodic cleanup (every 5 min)
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    const recent = bucket.filter(t => now - t < RATE_WINDOW);
    if (recent.length === 0) rateBuckets.delete(ip);
    else rateBuckets.set(ip, recent);
  }
}, 5 * 60_000);

// ============ CORS ============

const ALLOWED_ORIGINS = config.web?.corsOrigins || ['http://localhost:3000'];

function addCorsHeaders(res, req) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ============ Helpers ============

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function jsonResponse(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ============ Route Handler ============

export async function handleWebRequest(req, res, pathname) {
  addCorsHeaders(res, req);

  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  const ip = getClientIP(req);

  // ============ POST /web/chat ============
  if (pathname === '/web/chat' && req.method === 'POST') {
    if (!checkRateLimit(ip)) {
      jsonResponse(res, 429, { error: 'Rate limited. Max 5 messages per minute.', retryAfter: 60 });
      return true;
    }

    try {
      const body = JSON.parse(await readBody(req));
      const { sessionId, message, userName } = body;

      if (!sessionId || !message || typeof message !== 'string') {
        jsonResponse(res, 400, { error: 'Missing sessionId or message' });
        return true;
      }

      if (message.length > 2000) {
        jsonResponse(res, 400, { error: 'Message too long (max 2000 chars)' });
        return true;
      }

      const chatId = `web-${sessionId}`;
      const name = (userName || 'Web Visitor').slice(0, 50);

      console.log(`[web-api] Chat from ${ip} (session: ${sessionId.slice(0, 8)}...): "${message.slice(0, 80)}"`);

      // Budget check — enforce compute limits before calling LLM
      const budgetCheck = checkBudget(sessionId);
      if (!budgetCheck.allowed) {
        jsonResponse(res, 429, {
          error: budgetCheck.message,
          budget: {
            daily: budgetCheck.budget,
            used: budgetCheck.used,
            remaining: 0,
          },
        });
        return true;
      }

      // Mark identified if they provided a username
      if (userName) markIdentified(sessionId);

      const chatOptions = budgetCheck.degraded
        ? { maxTokensOverride: budgetCheck.maxTokens }
        : {};

      const response = await chat(chatId, name, message, 'web', [], chatOptions);

      // Record usage after successful response
      const quality = computeWebQuality(message);
      recordUsage(sessionId, response.usage, quality);

      jsonResponse(res, 200, {
        reply: response.text,
        timestamp: new Date().toISOString(),
        budget: {
          daily: budgetCheck.budget,
          used: budgetCheck.used + (response.usage?.input || 0) + (response.usage?.output || 0),
          remaining: Math.max(0, budgetCheck.remaining - (response.usage?.input || 0) - (response.usage?.output || 0)),
          degraded: budgetCheck.degraded,
        },
      });
    } catch (err) {
      console.error('[web-api] Chat error:', err.message);
      jsonResponse(res, 500, { error: 'JARVIS encountered an error. Try again.' });
    }
    return true;
  }

  // ============ GET /web/mind ============
  if (pathname === '/web/mind' && req.method === 'GET') {
    try {
      const knowledgeChain = getChainStats();
      const shard = getShardInfo();
      const topology = isMultiShard() ? getTopology() : null;
      const skills = getSkills();
      const dialogue = getRecentDialogue(5);
      const dialogueStats = getDialogueStats();
      const shadowStats = getShadowStats();
      const computeEcon = getComputeStats();

      jsonResponse(res, 200, {
        knowledgeChain: {
          height: knowledgeChain.height,
          head: knowledgeChain.head,
          pendingChanges: knowledgeChain.pendingChanges,
          recentEpochs: knowledgeChain.recentEpochs?.slice(0, 5),
        },
        network: {
          shardId: shard.shardId || shard.id || config.shard?.id || 'shard-0',
          nodeType: shard.nodeType,
          peers: shard.peers,
          uptime: shard.uptime,
          memory: shard.memory,
          topology: topology ? {
            shardCount: topology.shards?.length || topology.totalShards || 0,
            healthy: topology.healthy !== undefined ? topology.healthy : (topology.shards?.length > 0),
          } : null,
        },
        learning: {
          totalSkills: skills.length,
          confirmedSkills: skills.filter(s => s.confirmations >= 2).length,
          recentSkills: skills.slice(-5).map(s => ({ pattern: s.title || s.lesson?.slice(0, 80) || '', category: s.category || 'general' })),
        },
        innerDialogue: {
          recentThoughts: dialogue.map(d => ({
            content: (d.thought || d.content || '').slice(0, 200),
            category: d.category,
            created: d.created,
          })),
          stats: {
            totalThoughts: dialogueStats.totalEntries || dialogueStats.totalThoughts || 0,
            promoted: dialogueStats.promotedToNetwork || dialogueStats.promoted || 0,
            categories: dialogueStats.categoryCounts || {},
          },
        },
        shadows: {
          active: shadowStats.active,
          totalContributions: shadowStats.totalContributions,
        },
        computeEconomics: computeEcon.pool,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[web-api] Mind error:', err.message);
      jsonResponse(res, 500, { error: 'Could not fetch mind data' });
    }
    return true;
  }

  // ============ GET /web/health ============
  if (pathname === '/web/health' && req.method === 'GET') {
    jsonResponse(res, 200, {
      status: 'online',
      uptime: Math.round(process.uptime()),
      provider: getProviderName(),
      model: getModelName(),
      shardId: config.shard?.id || 'shard-0',
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  // ============ POST /web/shadow/verify ============
  if (pathname === '/web/shadow/verify' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const { token } = body;

      if (!token) {
        jsonResponse(res, 400, { error: 'Missing token' });
        return true;
      }

      // Consume invite and register shadow
      const invite = consumeInvite(token);
      if (!invite) {
        jsonResponse(res, 404, { error: 'Invalid or expired invite token' });
        return true;
      }

      // For web shadow, we use IP hash as pseudo-identity
      const pseudoId = `web-shadow-${ip}`;
      const result = registerShadow(pseudoId, invite);

      jsonResponse(res, 200, {
        codename: result.codename,
        existing: result.existing,
        status: 'active',
      });
    } catch (err) {
      console.error('[web-api] Shadow verify error:', err.message);
      jsonResponse(res, 500, { error: 'Shadow verification failed' });
    }
    return true;
  }

  // Not a /web/ route we handle
  return false;
}

// ============ Quality Signal ============

function computeWebQuality(text) {
  let score = 0;
  if (text.length > 50) score += 1;
  if (text.length > 200) score += 1;
  if (text.includes('?')) score += 1;
  if (text.includes('http') || text.includes('github')) score += 1;
  if (text.includes('```') || text.includes('function') || text.includes('contract')) score += 1;
  return Math.min(score, 5);
}
