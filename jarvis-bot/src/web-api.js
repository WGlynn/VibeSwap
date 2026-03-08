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
import { getCurrentTarget, submitProof, getMiningStats, linkMiner, getLinkedMiner } from './mining.js';
import { createPrediction, placeBet, resolveMarket, listMarkets, listMarketsStructured, getMyBets, getPredictorLeaderboard, getLeaderboardStructured } from './tools-predictions.js';
import { createHmac } from 'crypto';

// ============ Rate Limiter ============

const rateBuckets = new Map(); // IP -> [timestamps]
const miningRateBuckets = new Map(); // IP -> [timestamps]
const RATE_LIMIT = config.web?.rateLimitPerMinute || 5;
const MINING_RATE_LIMIT = 10; // mining submissions per minute per IP
const RATE_WINDOW = 60_000; // 1 minute
const MAX_TRACKED_IPS = 10000;

function pruneOldestBuckets(map) {
  if (map.size <= MAX_TRACKED_IPS) return;
  // Drop oldest entries (Map preserves insertion order)
  const excess = map.size - MAX_TRACKED_IPS;
  let removed = 0;
  for (const key of map.keys()) {
    if (removed >= excess) break;
    map.delete(key);
    removed++;
  }
}

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
  pruneOldestBuckets(rateBuckets);
  return true;
}

function checkMiningRateLimit(ip) {
  const now = Date.now();
  const bucket = miningRateBuckets.get(ip) || [];
  const recent = bucket.filter(t => now - t < RATE_WINDOW);
  if (recent.length >= MINING_RATE_LIMIT) {
    miningRateBuckets.set(ip, recent);
    return false;
  }
  recent.push(now);
  miningRateBuckets.set(ip, recent);
  pruneOldestBuckets(miningRateBuckets);
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
  for (const [ip, bucket] of miningRateBuckets) {
    const recent = bucket.filter(t => now - t < RATE_WINDOW);
    if (recent.length === 0) miningRateBuckets.delete(ip);
    else miningRateBuckets.set(ip, recent);
  }
}, 5 * 60_000);

// ============ Telegram initData HMAC Validation ============

function validateTelegramInitData(initData) {
  const botToken = config.telegram?.token;
  if (!botToken) return false; // Fail-closed: reject if bot token not configured

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;

    params.delete('hash');
    const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    return computed === hash;
  } catch {
    return false;
  }
}

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

const MAX_BODY_SIZE = 64 * 1024; // 64 KB max request body

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function jsonResponse(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ============ Ubuntu Presence ============
// "I am because we are" — tracks who's here right now
const ubuntuPresence = new Map(); // sessionKey -> lastSeen timestamp

// ============ Response Cache ============
// Short-lived cache for expensive endpoints (mesh, mind, health)

const responseCache = new Map(); // key -> { data, expiry }
const CACHE_TTL = {
  '/web/mesh': 10_000,     // 10s — GitHub API call is slow
  '/web/mind': 15_000,     // 15s — aggregates many subsystems
  '/web/health': 5_000,    // 5s — lightweight but called often
};

function getCached(key) {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    responseCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  const ttl = CACHE_TTL[key];
  if (!ttl) return;
  responseCache.set(key, { data, expiry: Date.now() + ttl });
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
    const cached = getCached('/web/mind');
    if (cached) { jsonResponse(res, 200, cached); return true; }
    try {
      const knowledgeChain = getChainStats();
      const shard = getShardInfo();
      const topology = isMultiShard() ? getTopology() : null;
      const skills = getSkills();
      const dialogue = getRecentDialogue(5);
      const dialogueStats = getDialogueStats();
      const shadowStats = getShadowStats();
      const computeEcon = getComputeStats();

      const mindData = {
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
        tipJar: {
          address: config.tipJarAddress,
          dailyCost: '$5',
          perPerson: '$0.33',
          teamSize: 15,
        },
        timestamp: new Date().toISOString(),
      };
      setCache('/web/mind', mindData);
      jsonResponse(res, 200, mindData);
    } catch (err) {
      console.error('[web-api] Mind error:', err.message);
      jsonResponse(res, 500, { error: 'Could not fetch mind data' });
    }
    return true;
  }

  // ============ GET /web/health ============
  if (pathname === '/web/health' && req.method === 'GET') {
    const cached = getCached('/web/health');
    if (cached) { jsonResponse(res, 200, cached); return true; }
    const healthData = {
      status: 'online',
      uptime: Math.round(process.uptime()),
      provider: getProviderName(),
      model: getModelName(),
      shardId: config.shard?.id || 'shard-0',
      rateLimit: { perMinute: RATE_LIMIT, window: RATE_WINDOW },
      timestamp: new Date().toISOString(),
    };
    setCache('/web/health', healthData);
    jsonResponse(res, 200, healthData);
    return true;
  }

  // ============ POST /web/report ============
  // Frontend error/performance reporting — lightweight telemetry
  if (pathname === '/web/report' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const { type, message, url, userAgent, vitals } = body;
      if (type === 'error') {
        console.warn(`[web-report] Error from ${ip}: ${message} @ ${url}`);
      } else if (type === 'vitals') {
        console.log(`[web-report] Vitals from ${ip}: LCP=${vitals?.lcp}ms FCP=${vitals?.fcp}ms CLS=${vitals?.cls}`);
      }
      jsonResponse(res, 200, { received: true });
    } catch {
      jsonResponse(res, 400, { error: 'Invalid report' });
    }
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

  // ============ GET /web/mining/target ============
  if (pathname === '/web/mining/target' && req.method === 'GET') {
    try {
      const target = getCurrentTarget();
      jsonResponse(res, 200, target);
    } catch (err) {
      console.error('[web-api] Mining target error:', err.message);
      jsonResponse(res, 500, { error: 'Could not fetch mining target' });
    }
    return true;
  }

  // ============ POST /web/mining/submit ============
  if (pathname === '/web/mining/submit' && req.method === 'POST') {
    if (!checkMiningRateLimit(ip)) {
      jsonResponse(res, 429, { error: 'Mining rate limited. Max 10 submissions per minute.', retryAfter: 60 });
      return true;
    }

    try {
      const body = JSON.parse(await readBody(req));
      const { userId, nonce, hash, challenge, initData } = body;

      if (!nonce || !hash || !challenge) {
        jsonResponse(res, 400, { error: 'Missing required fields: nonce, hash, challenge' });
        return true;
      }

      // Require valid Telegram initData — binds proof to authenticated identity
      if (!initData) {
        jsonResponse(res, 403, { error: 'Telegram initData required' });
        return true;
      }
      if (!validateTelegramInitData(initData)) {
        jsonResponse(res, 403, { error: 'Invalid Telegram initData' });
        return true;
      }

      // Extract authenticated userId from initData (not from request body)
      let authenticatedUserId = null;
      try {
        const params = new URLSearchParams(initData);
        const userJson = params.get('user');
        if (userJson) {
          const user = JSON.parse(userJson);
          authenticatedUserId = String(user.id); // Telegram user ID — tamper-proof
        }
      } catch (parseErr) {
        console.warn(`[web-api] initData user parse failed (IP: ${ip}): ${parseErr.message}`);
      }
      // Fallback to body userId ONLY if initData didn't yield an ID
      if (!authenticatedUserId) authenticatedUserId = userId;

      if (!authenticatedUserId) {
        jsonResponse(res, 400, { error: 'Could not determine userId' });
        return true;
      }

      // SPV auto-link: if initData yielded a Telegram ID different from body userId,
      // cryptographically link the mobile miner to the Telegram account.
      // The initData HMAC IS the proof — signed by Telegram's servers.
      if (userId && authenticatedUserId !== userId && userId.startsWith('mobile-')) {
        const existing = getLinkedMiner(authenticatedUserId);
        if (!existing) {
          const link = linkMiner(authenticatedUserId, userId);
          if (link.success) {
            console.log(`[web-api] SPV auto-link: ${userId} → Telegram ${authenticatedUserId} (${link.transferred.toFixed(2)} JUL transferred)`);
          }
        }
      }

      // Input validation — prevent oversized or malformed inputs
      if (typeof nonce !== 'string' || nonce.length !== 64 || !/^[0-9a-f]{64}$/i.test(nonce)) {
        jsonResponse(res, 400, { error: 'Invalid nonce format (expected 64 hex chars)' });
        return true;
      }
      if (typeof hash !== 'string' || hash.length !== 64 || !/^[0-9a-f]{64}$/i.test(hash)) {
        jsonResponse(res, 400, { error: 'Invalid hash format (expected 64 hex chars)' });
        return true;
      }
      if (typeof challenge !== 'string' || challenge.length !== 64 || !/^[0-9a-f]{64}$/i.test(challenge)) {
        jsonResponse(res, 400, { error: 'Invalid challenge format (expected 64 hex chars)' });
        return true;
      }

      const result = submitProof(authenticatedUserId, nonce, hash, challenge);
      const status = result.accepted ? 200 : 400;
      jsonResponse(res, status, result);
    } catch (err) {
      console.error('[web-api] Mining submit error:', err.message);
      jsonResponse(res, 500, { error: 'Mining submission failed' });
    }
    return true;
  }

  // ============ GET /web/mining/stats/:userId ============
  if (pathname.startsWith('/web/mining/stats/') && req.method === 'GET') {
    try {
      const userId = pathname.split('/web/mining/stats/')[1];
      if (!userId) {
        jsonResponse(res, 400, { error: 'Missing userId' });
        return true;
      }
      const stats = getMiningStats(decodeURIComponent(userId));
      jsonResponse(res, 200, stats);
    } catch (err) {
      console.error('[web-api] Mining stats error:', err.message);
      jsonResponse(res, 500, { error: 'Could not fetch mining stats' });
    }
    return true;
  }

  // ============ Prediction Markets API ============

  // GET /web/predictions — list all markets (structured JSON)
  if (pathname === '/web/predictions' && req.method === 'GET') {
    try {
      const result = listMarketsStructured('web');
      jsonResponse(res, 200, result);
    } catch (err) {
      jsonResponse(res, 500, { error: err.message });
    }
    return true;
  }

  // POST /web/predictions/create — create a new market
  if (pathname === '/web/predictions/create' && req.method === 'POST') {
    if (!checkRateLimit(ip)) {
      jsonResponse(res, 429, { error: 'Rate limited.' });
      return true;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const { question, userId, userName, initData } = body;
      if (!question) {
        jsonResponse(res, 400, { error: 'Missing question' });
        return true;
      }
      // Use Telegram auth if provided, otherwise use session ID
      let authUserId = userId || `web-${ip}`;
      let authUserName = userName || 'Anon';
      if (initData && validateTelegramInitData(initData)) {
        try {
          const params = new URLSearchParams(initData);
          const userJson = params.get('user');
          if (userJson) {
            const user = JSON.parse(userJson);
            authUserId = String(user.id);
            authUserName = user.first_name || authUserName;
          }
        } catch { /* use fallback */ }
      }
      const result = createPrediction(authUserId, authUserName, 'web', question);
      jsonResponse(res, 200, { result });
    } catch (err) {
      jsonResponse(res, 500, { error: err.message });
    }
    return true;
  }

  // POST /web/predictions/bet — place a bet
  if (pathname === '/web/predictions/bet' && req.method === 'POST') {
    if (!checkRateLimit(ip)) {
      jsonResponse(res, 429, { error: 'Rate limited.' });
      return true;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const { marketId, side, amount, userId, userName, initData } = body;
      let authUserId = userId || `web-${ip}`;
      let authUserName = userName || 'Anon';
      if (initData && validateTelegramInitData(initData)) {
        try {
          const params = new URLSearchParams(initData);
          const userJson = params.get('user');
          if (userJson) {
            const user = JSON.parse(userJson);
            authUserId = String(user.id);
            authUserName = user.first_name || authUserName;
          }
        } catch { /* use fallback */ }
      }
      const result = placeBet(authUserId, authUserName, marketId, side, amount);
      jsonResponse(res, 200, { result });
    } catch (err) {
      jsonResponse(res, 500, { error: err.message });
    }
    return true;
  }

  // GET /web/predictions/leaderboard — top predictors (structured JSON)
  if (pathname === '/web/predictions/leaderboard' && req.method === 'GET') {
    try {
      const result = getLeaderboardStructured();
      jsonResponse(res, 200, result);
    } catch (err) {
      jsonResponse(res, 500, { error: err.message });
    }
    return true;
  }

  // ============ POST /web/chat/stream ============
  // SSE streaming endpoint — sends response chunks as they're ready.
  // The response is generated in full, then streamed character-by-character
  // to give instant-feeling feedback.
  if (pathname === '/web/chat/stream' && req.method === 'POST') {
    if (!checkRateLimit(ip)) {
      jsonResponse(res, 429, { error: 'Rate limited.', retryAfter: 60 });
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

      const budgetCheck = checkBudget(sessionId);
      if (!budgetCheck.allowed) {
        jsonResponse(res, 429, { error: budgetCheck.message });
        return true;
      }
      if (userName) markIdentified(sessionId);

      // Set up SSE
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': req.headers.origin || '*',
      });

      // Send "thinking" event immediately
      res.write(`data: ${JSON.stringify({ type: 'thinking' })}\n\n`);

      const chatId = `web-${sessionId}`;
      const name = (userName || 'Web Visitor').slice(0, 50);
      const chatOptions = budgetCheck.degraded ? { maxTokensOverride: budgetCheck.maxTokens } : {};

      const response = await chat(chatId, name, message, 'web', [], chatOptions);
      const fullText = response.text || '';

      // Stream in chunks (~word-by-word)
      const words = fullText.split(/(\s+)/);
      let buffer = '';
      for (let i = 0; i < words.length; i++) {
        buffer += words[i];
        // Flush every ~3-5 words or at end
        if ((i > 0 && i % 4 === 0) || i === words.length - 1) {
          res.write(`data: ${JSON.stringify({ type: 'chunk', text: buffer })}\n\n`);
          buffer = '';
        }
      }

      // Record usage
      const quality = computeWebQuality(message);
      recordUsage(sessionId, response.usage, quality);

      // Send done event with budget info
      res.write(`data: ${JSON.stringify({
        type: 'done',
        budget: {
          daily: budgetCheck.budget,
          used: budgetCheck.used + (response.usage?.input || 0) + (response.usage?.output || 0),
          remaining: Math.max(0, budgetCheck.remaining - (response.usage?.input || 0) - (response.usage?.output || 0)),
          degraded: budgetCheck.degraded,
        },
      })}\n\n`);

      res.end();
    } catch (err) {
      console.error('[web-api] Stream chat error:', err.message);
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
        res.end();
      } catch { res.end(); }
    }
    return true;
  }

  // ============ GET /web/mesh ============
  // Cells within cells interlinked — returns mesh status of all 3 nodes:
  //   1. Fly.io (JARVIS full node — Telegram bot + AI)
  //   2. Vercel (frontend light node — edge-deployed UI)
  //   3. GitHub (persistence layer — code + knowledge chain)
  if (pathname === '/web/mesh' && req.method === 'GET') {
    const cached = getCached('/web/mesh');
    if (cached) { jsonResponse(res, 200, cached); return true; }
    try {
      const shard = getShardInfo();
      const chain = getChainStats();
      const topology = isMultiShard() ? getTopology() : null;
      const uptime = Math.round(process.uptime());
      const mem = process.memoryUsage();

      // Cell 1: Fly.io (self — always online if this responds)
      const flyCell = {
        id: 'fly-jarvis',
        name: 'JARVIS',
        type: 'full-node',
        status: 'interlinked',
        location: 'Fly.io',
        shardId: shard?.id || config.shard?.id || 'shard-0',
        uptime,
        memory: { heapMB: Math.round(mem.heapUsed / 1048576), rssMB: Math.round(mem.rss / 1048576) },
        provider: getProviderName(),
        model: getModelName(),
        chain: { height: chain.height, head: chain.head?.hash?.slice(0, 12), pending: chain.pendingChanges },
        peers: shard?.peers || 0,
        capabilities: ['inference', 'consensus', 'knowledge-chain', 'telegram', 'crpc'],
      };

      // Cell 2: GitHub (check recent push via API — no auth needed for public repo)
      let githubCell = {
        id: 'github-repo',
        name: 'GitHub',
        type: 'persistence',
        status: 'unknown',
        location: 'github.com/wglynn/vibeswap',
        capabilities: ['code', 'knowledge-persistence', 'session-reports', 'version-control'],
      };
      try {
        const ghRes = await fetch('https://api.github.com/repos/wglynn/vibeswap/commits?per_page=1', {
          headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'JARVIS-Mind-Network' },
          signal: AbortSignal.timeout(5000),
        });
        if (ghRes.ok) {
          const [latest] = await ghRes.json();
          const commitAge = Date.now() - new Date(latest.commit.committer.date).getTime();
          githubCell.status = commitAge < 24 * 60 * 60 * 1000 ? 'interlinked' : 'dormant';
          githubCell.lastCommit = {
            sha: latest.sha.slice(0, 7),
            message: latest.commit.message.split('\n')[0].slice(0, 80),
            author: latest.commit.author.name,
            age: commitAge < 3600000 ? `${Math.round(commitAge / 60000)}m ago`
              : commitAge < 86400000 ? `${Math.round(commitAge / 3600000)}h ago`
              : `${Math.round(commitAge / 86400000)}d ago`,
          };
        } else {
          githubCell.status = 'unreachable';
        }
      } catch {
        githubCell.status = 'unreachable';
      }

      // Cell 3: Vercel (the caller is proof it's alive — report edge presence)
      const vercelCell = {
        id: 'vercel-frontend',
        name: 'VibeSwap UI',
        type: 'light-node',
        status: 'interlinked', // If this endpoint is being called, the frontend is alive
        location: 'Vercel Edge Network',
        capabilities: ['ui', 'edge-cache', 'light-verification', 'user-relay'],
      };

      // Mesh topology — the interlinks between cells
      const links = [
        { from: 'fly-jarvis', to: 'vercel-frontend', protocol: 'HTTP/REST', latency: 'live' },
        { from: 'fly-jarvis', to: 'github-repo', protocol: 'Git/HTTPS', latency: githubCell.status === 'interlinked' ? 'synced' : 'stale' },
        { from: 'vercel-frontend', to: 'fly-jarvis', protocol: 'HTTP/REST', latency: 'live' },
        { from: 'vercel-frontend', to: 'github-repo', protocol: 'Deploy Hook', latency: 'on-push' },
        { from: 'github-repo', to: 'vercel-frontend', protocol: 'Vercel Deploy', latency: 'on-push' },
        { from: 'github-repo', to: 'fly-jarvis', protocol: 'Git Pull', latency: 'periodic' },
      ];

      const allInterlinked = flyCell.status === 'interlinked' &&
        githubCell.status === 'interlinked' &&
        vercelCell.status === 'interlinked';

      const meshData = {
        mantra: 'cells within cells interlinked',
        status: allInterlinked ? 'fully-interlinked' : 'partial',
        cells: [flyCell, githubCell, vercelCell],
        links,
        topology: topology ? { shardCount: topology.shards?.length || 0 } : null,
        timestamp: new Date().toISOString(),
      };
      setCache('/web/mesh', meshData);
      jsonResponse(res, 200, meshData);
    } catch (err) {
      console.error('[web-api] Mesh error:', err.message);
      jsonResponse(res, 500, { error: 'Could not fetch mesh state' });
    }
    return true;
  }

  // ============ POST /web/presence ============
  // Ubuntu — "I am because we are"
  // Lightweight presence: clients ping every 30s, server tracks active count.
  if (pathname === '/web/presence' && req.method === 'POST') {
    const sessionKey = `presence-${ip}`;
    ubuntuPresence.set(sessionKey, Date.now());
    // Prune stale (>60s)
    const now = Date.now();
    for (const [k, t] of ubuntuPresence) {
      if (now - t > 60_000) ubuntuPresence.delete(k);
    }
    jsonResponse(res, 200, {
      here: ubuntuPresence.size,
      mantra: 'umuntu ngumuntu ngabantu',
    });
    return true;
  }

  // GET /web/presence — just read the count
  if (pathname === '/web/presence' && req.method === 'GET') {
    const now = Date.now();
    for (const [k, t] of ubuntuPresence) {
      if (now - t > 60_000) ubuntuPresence.delete(k);
    }
    jsonResponse(res, 200, { here: ubuntuPresence.size });
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
