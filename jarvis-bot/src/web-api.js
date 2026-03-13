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
//   GET  /web/rosetta/view      → Full Rosetta Protocol state
//   GET  /web/rosetta/translate  → Translate concept between agents
//   GET  /web/rosetta/all        → Translate concept to ALL agents
//   GET  /web/rosetta/lexicon    → Get agent vocabulary
//   GET  /web/covenants          → Ten Covenants + hash
// ============

import { config } from './config.js';
import { chat } from './claude.js';
import { speak as jarvisSpeak, cleanup as ttsCleanup } from './tts.js';
import { getChainStats } from './knowledge-chain.js';
import { getShardInfo, isMultiShard } from './shard.js';
import { getTopology } from './router.js';
import { getSkills, getLearningStats } from './learning.js';
import { getShadowStats, consumeInvite, registerShadow } from './shadow.js';
import { getRecentDialogue, getDialogueStats } from './inner-dialogue.js';
import { getProviderName, getModelName, getProviderPerformanceStats, getFallbackChain, getIntelligenceLevel } from './llm-provider.js';
import { getIntelligenceStats, getScoreTrends } from './intelligence.js';
import { checkBudget, recordUsage, getComputeStats, markIdentified } from './compute-economics.js';
import { getCurrentTarget, submitProof, getMiningStats, linkMiner, getLinkedMiner, getLeaderboard, getTotalSupply, getEscapeVelocity, getTreasuryStats, getHashCostIndex } from './mining.js';
import { getPendingCommands, acknowledgeCommand, acknowledgeAll } from './relay.js';
import { getGraphStats, getAuthorAttribution } from './passive-attribution.js';
import { createPrediction, placeBet, resolveMarket, listMarkets, listMarketsStructured, getMyBets, getPredictorLeaderboard, getLeaderboardStructured } from './tools-predictions.js';
import { createHmac } from 'crypto';
import { getRosettaView, translate, translateToAll, getLexicon, TEN_COVENANTS, COVENANT_HASH } from './rosetta.js';
import { createPrimitive, getPrimitive, listPrimitives, citePrimitive, viewPrimitive, getInfoFiStats, getAuthorStats, searchPrimitives } from './infofi.js';

// ============ Rate Limiter ============

const rateBuckets = new Map(); // IP -> { timestamps: [], lastAccess: number }
const miningRateBuckets = new Map(); // IP -> { timestamps: [], lastAccess: number }
const RATE_LIMIT = config.web?.rateLimitPerMinute || 5;
const MINING_RATE_LIMIT = 10; // mining submissions per minute per IP
const RATE_WINDOW = 60_000; // 1 minute
const MAX_TRACKED_IPS = 10000;

function evictLRU(map) {
  if (map.size <= MAX_TRACKED_IPS) return;
  // Evict least recently used entries (by lastAccess timestamp)
  const entries = [...map.entries()];
  entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess);
  const excess = map.size - MAX_TRACKED_IPS;
  for (let i = 0; i < excess; i++) {
    map.delete(entries[i][0]);
  }
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateBuckets.get(ip) || { timestamps: [], lastAccess: now };
  // Prune old entries
  const recent = entry.timestamps.filter(t => now - t < RATE_WINDOW);
  if (recent.length >= RATE_LIMIT) {
    rateBuckets.set(ip, { timestamps: recent, lastAccess: now });
    return false;
  }
  recent.push(now);
  rateBuckets.set(ip, { timestamps: recent, lastAccess: now });
  evictLRU(rateBuckets);
  return true;
}

function checkMiningRateLimit(ip) {
  const now = Date.now();
  const entry = miningRateBuckets.get(ip) || { timestamps: [], lastAccess: now };
  const recent = entry.timestamps.filter(t => now - t < RATE_WINDOW);
  if (recent.length >= MINING_RATE_LIMIT) {
    miningRateBuckets.set(ip, { timestamps: recent, lastAccess: now });
    return false;
  }
  recent.push(now);
  miningRateBuckets.set(ip, { timestamps: recent, lastAccess: now });
  evictLRU(miningRateBuckets);
  return true;
}

// Periodic cleanup (every 5 min)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateBuckets) {
    const recent = entry.timestamps.filter(t => now - t < RATE_WINDOW);
    if (recent.length === 0) rateBuckets.delete(ip);
    else rateBuckets.set(ip, { timestamps: recent, lastAccess: entry.lastAccess });
  }
  for (const [ip, entry] of miningRateBuckets) {
    const recent = entry.timestamps.filter(t => now - t < RATE_WINDOW);
    if (recent.length === 0) miningRateBuckets.delete(ip);
    else miningRateBuckets.set(ip, { timestamps: recent, lastAccess: entry.lastAccess });
  }
}, 5 * 60_000);

// ============ Telegram initData HMAC Validation ============

function validateTelegramInitData(initData) {
  // Support multiple bot tokens — main bot + shard bots all need valid initData
  // SHARD_BOT_TOKENS env var: comma-separated list of additional bot tokens
  const tokens = [config.telegram?.token];
  if (process.env.SHARD_BOT_TOKENS) {
    tokens.push(...process.env.SHARD_BOT_TOKENS.split(',').map(t => t.trim()).filter(Boolean));
  }
  // Also add chatterbox token if configured
  if (process.env.CHATTERBOX_BOT_TOKEN) {
    tokens.push(process.env.CHATTERBOX_BOT_TOKEN.trim());
  }

  const validTokens = tokens.filter(Boolean);
  if (validTokens.length === 0) return false; // Fail-closed: reject if no tokens configured

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;

    params.delete('hash');
    const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

    // Try each token — initData is signed by whichever bot launched the Mini App
    for (const botToken of validTokens) {
      const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
      const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
      if (computed === hash) return true;
    }

    console.warn(`[web-api] initData validation failed against ${validTokens.length} token(s)`);
    return false;
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Secret, X-Telegram-Init-Data');
  res.setHeader('Access-Control-Max-Age', '86400');
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

// ============ Helpers ============

function getClientIP(req) {
  // SECURITY: x-forwarded-for is only trustworthy when running behind a known reverse proxy
  // (Fly.io sets this header reliably). If exposed directly to the internet without a proxy,
  // clients can spoof this header to bypass rate limiting. In that case, use req.socket.remoteAddress only.
  if (config.isDocker || process.env.FLY_APP_NAME) {
    // Behind Fly.io proxy — trust x-forwarded-for (first entry = real client IP)
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  }
  // Local/direct exposure — do not trust x-forwarded-for
  return req.socket?.remoteAddress || 'unknown';
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

// Last-known-good GitHub state — survives transient API failures / rate limits
let lastKnownGithub = null;

// ============ Uptime Proof Ring Buffer ============
// Rolling 24h heartbeat history for trinity fault tolerance visibility.
// Each entry: { ts, fly, github, vercel } where values are 1 (up) or 0 (down).
// Capped at 1440 entries (1 per minute for 24h).
const UPTIME_MAX = 1440;
const uptimeRing = [];
let lastUptimeTick = 0;

function recordUptime(flyOk, githubOk, vercelOk) {
  const now = Date.now();
  // Only record once per minute
  if (now - lastUptimeTick < 60_000) return;
  lastUptimeTick = now;
  uptimeRing.push({ ts: now, fly: flyOk ? 1 : 0, github: githubOk ? 1 : 0, vercel: vercelOk ? 1 : 0 });
  if (uptimeRing.length > UPTIME_MAX) uptimeRing.shift();
}

function getUptimeStats() {
  if (uptimeRing.length === 0) return { fly: 100, github: 100, vercel: 100, samples: 0 };
  const n = uptimeRing.length;
  const fly = Math.round(uptimeRing.reduce((s, e) => s + e.fly, 0) / n * 100);
  const github = Math.round(uptimeRing.reduce((s, e) => s + e.github, 0) / n * 100);
  const vercel = Math.round(uptimeRing.reduce((s, e) => s + e.vercel, 0) / n * 100);
  return { fly, github, vercel, samples: n, since: new Date(uptimeRing[0].ts).toISOString() };
}

// ============ Response Cache ============
// Short-lived cache for expensive endpoints (mesh, mind, health)

const responseCache = new Map(); // key -> { data, expiry }
const CACHE_TTL = {
  '/web/mesh': 60_000,     // 60s — GitHub API rate limit is 60/hr unauthenticated
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
    // Check if request is authenticated (API secret)
    const apiSecret = process.env.CLAUDE_CODE_API_SECRET;
    const isAuthenticated = apiSecret && req.headers['x-api-secret'] === apiSecret;

    if (!isAuthenticated) {
      // Minimal info for unauthenticated requests
      jsonResponse(res, 200, { status: 'ok', uptime: Math.round(process.uptime()) });
      return true;
    }

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

  // ============ GET /web/relay ============
  // Claude Code polls this for pending commands from mobile
  if (pathname === '/web/relay' && req.method === 'GET') {
    const apiSecret = process.env.CLAUDE_CODE_API_SECRET;
    if (apiSecret && req.headers['x-api-secret'] !== apiSecret) {
      const initData = req.headers['x-telegram-init-data'];
      if (!initData || !validateTelegramInitData(initData)) {
        jsonResponse(res, 401, { error: 'Unauthorized' });
        return true;
      }
    }
    const pending = getPendingCommands();
    jsonResponse(res, 200, { pending, count: pending.length });
    return true;
  }

  // ============ POST /web/relay/ack ============
  // Claude Code acknowledges a command
  if (pathname === '/web/relay/ack' && req.method === 'POST') {
    const apiSecret = process.env.CLAUDE_CODE_API_SECRET;
    if (apiSecret && req.headers['x-api-secret'] !== apiSecret) {
      const initData = req.headers['x-telegram-init-data'];
      if (!initData || !validateTelegramInitData(initData)) {
        jsonResponse(res, 401, { error: 'Unauthorized' });
        return true;
      }
    }
    try {
      const body = JSON.parse(await readBody(req));
      if (body.all) {
        const count = acknowledgeAll();
        jsonResponse(res, 200, { acknowledged: count });
      } else if (body.id) {
        const ok = acknowledgeCommand(body.id);
        jsonResponse(res, 200, { acknowledged: ok });
      } else {
        jsonResponse(res, 400, { error: 'Provide id or all:true' });
      }
    } catch { jsonResponse(res, 400, { error: 'Invalid JSON' }); }
    return true;
  }

  // ============ GET /web/attribution ============
  // View the passive attribution graph stats or a specific author
  if (pathname === '/web/attribution' && req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const author = url.searchParams.get('author');
    if (author) {
      const attribution = getAuthorAttribution(author);
      jsonResponse(res, 200, attribution || { error: 'Author not found' });
    } else {
      jsonResponse(res, 200, getGraphStats());
    }
    return true;
  }

  // ============ GET /web/wardenclyffe ============
  // LLM provider cascade performance stats
  if (pathname === '/web/wardenclyffe' && req.method === 'GET') {
    const providers = getProviderPerformanceStats();
    const chain = getFallbackChain();
    const level = getIntelligenceLevel();
    jsonResponse(res, 200, {
      activeProvider: getProviderName(),
      activeModel: getModelName(),
      intelligenceLevel: level,
      fallbackChain: chain,
      providerPerformance: providers,
    });
    return true;
  }

  // ============ GET /web/intelligence ============
  // Turing-passability stats: engagement, rapport, self-evaluation trends
  if (pathname === '/web/intelligence' && req.method === 'GET') {
    const stats = getIntelligenceStats();
    const trends = await getScoreTrends(7);
    jsonResponse(res, 200, { ...stats, scoreTrends: trends });
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

      // Two auth paths:
      // 1. Telegram initData (mobile mini app) → uses Telegram user ID
      // 2. Wallet address (web frontend) → uses wallet address as userId
      let authenticatedUserId = null;

      if (initData) {
        // Path 1: Telegram initData — cryptographic proof of Telegram identity
        if (!validateTelegramInitData(initData)) {
          jsonResponse(res, 403, { error: 'Invalid Telegram initData' });
          return true;
        }
        try {
          const params = new URLSearchParams(initData);
          const userJson = params.get('user');
          if (userJson) {
            const user = JSON.parse(userJson);
            authenticatedUserId = String(user.id);
          }
        } catch (parseErr) {
          console.warn(`[web-api] initData user parse failed (IP: ${ip}): ${parseErr.message}`);
        }
        if (!authenticatedUserId) authenticatedUserId = userId;

        // SPV auto-link: if initData yielded a Telegram ID different from body userId,
        // cryptographically link the mobile miner to the Telegram account.
        if (userId && authenticatedUserId !== userId && userId.startsWith('mobile-')) {
          const existing = getLinkedMiner(authenticatedUserId);
          if (!existing) {
            const link = linkMiner(authenticatedUserId, userId);
            if (link.success) {
              console.log(`[web-api] SPV auto-link: ${userId} → Telegram ${authenticatedUserId} (${link.transferred.toFixed(2)} JUL transferred)`);
            }
          }
        }
      } else if (body.walletAddress) {
        // Path 2: Wallet address — web frontend miners
        // Wallet address is the identity; PoW is the proof of work.
        // Rate limiting per IP prevents abuse.
        const wallet = body.walletAddress.toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
          jsonResponse(res, 400, { error: 'Invalid wallet address format' });
          return true;
        }
        authenticatedUserId = `wallet:${wallet}`;
      } else if (userId && userId.startsWith('mobile-') && /^mobile-[0-9a-f]{16}$/.test(userId)) {
        // Path 3: Mobile shard ID fallback — when Mini App SDK doesn't provide initData
        // (e.g., opened via direct link, or TG SDK failed to load).
        // Accept the mobile shard ID as identity. Rate limiting per IP prevents abuse.
        // These proofs can be linked to a Telegram account later via /linkminer.
        authenticatedUserId = userId;
        console.log(`[web-api] Mining with mobile shard ID fallback: ${userId} (IP: ${ip})`);
      } else {
        jsonResponse(res, 403, { error: 'Authentication required: provide initData (Telegram) or walletAddress (web)' });
        return true;
      }

      if (!authenticatedUserId) {
        jsonResponse(res, 400, { error: 'Could not determine userId' });
        return true;
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
      if (!result.accepted) {
        console.log(`[mining] Proof REJECTED: user=${authenticatedUserId} reason=${result.reason || 'unknown'} details=${JSON.stringify(result.details || {})} challenge_match=${challenge === state?.challenge} IP=${ip}`);
      }
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

  // ============ POST /web/mining/link-wallet ============
  // Link a Telegram mining identity to a wallet address (or vice versa).
  // Merges balances so the same user can mine on both platforms.
  // Requires Telegram initData + wallet address.
  if (pathname === '/web/mining/link-wallet' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const { walletAddress, initData } = body;

      if (!walletAddress || !initData) {
        jsonResponse(res, 400, { error: 'Both walletAddress and initData required' });
        return true;
      }

      // Validate Telegram identity
      if (!validateTelegramInitData(initData)) {
        jsonResponse(res, 403, { error: 'Invalid Telegram initData' });
        return true;
      }

      const wallet = walletAddress.toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
        jsonResponse(res, 400, { error: 'Invalid wallet address' });
        return true;
      }

      // Extract Telegram user ID
      let telegramId = null;
      try {
        const params = new URLSearchParams(initData);
        const userJson = params.get('user');
        if (userJson) telegramId = String(JSON.parse(userJson).id);
      } catch { /* skip */ }

      if (!telegramId) {
        jsonResponse(res, 400, { error: 'Could not extract Telegram user ID' });
        return true;
      }

      const walletId = `wallet:${wallet}`;

      // Link wallet miner → Telegram ID (merge balances into Telegram ID)
      const result = linkMiner(telegramId, walletId);
      if (result.success) {
        console.log(`[web-api] Wallet link: ${walletId} → Telegram ${telegramId} (${result.transferred.toFixed(2)} JUL merged)`);
      }

      jsonResponse(res, 200, {
        linked: result.success,
        telegramId,
        walletAddress: wallet,
        ...result,
      });
    } catch (err) {
      console.error('[web-api] Link wallet error:', err.message);
      jsonResponse(res, 500, { error: 'Wallet linking failed' });
    }
    return true;
  }

  // ============ GET /web/mining/leaderboard ============
  if (pathname === '/web/mining/leaderboard' && req.method === 'GET') {
    jsonResponse(res, 200, getLeaderboard(20));
    return true;
  }

  // ============ GET /web/mining/supply ============
  // Ergon economics: total supply, burned, escape velocity, hash cost index
  if (pathname === '/web/mining/supply' && req.method === 'GET') {
    const supply = getTotalSupply();
    const escape = getEscapeVelocity();
    const treasury = getTreasuryStats();
    const hashCost = getHashCostIndex();
    jsonResponse(res, 200, { supply, escapeVelocity: escape, treasury, hashCostIndex: hashCost });
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
      const sseHeaders = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      };
      const sseOrigin = req.headers.origin || '';
      if (ALLOWED_ORIGINS.includes(sseOrigin) || ALLOWED_ORIGINS.includes('*')) {
        sseHeaders['Access-Control-Allow-Origin'] = sseOrigin;
      }
      res.writeHead(200, sseHeaders);

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

  // ============ POST /web/tts ============
  // Text-to-speech — returns MP3 audio of JARVIS speaking the given text
  if (pathname === '/web/tts' && req.method === 'POST') {
    if (!checkRateLimit(ip)) {
      jsonResponse(res, 429, { error: 'Rate limited.' });
      return true;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const { text } = body;
      if (!text || typeof text !== 'string' || text.length > 5000) {
        jsonResponse(res, 400, { error: 'Missing or invalid text (max 5000 chars)' });
        return true;
      }

      const voicePath = await jarvisSpeak(text, 'web');
      if (!voicePath) {
        jsonResponse(res, 503, { error: 'Voice synthesis unavailable' });
        return true;
      }

      // Read the MP3 file and return as binary
      const { readFile } = await import('fs/promises');
      const audioBuffer = await readFile(voicePath);
      await ttsCleanup(voicePath);

      const ttsHeaders = {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length,
        'Cache-Control': 'no-cache',
      };
      const ttsOrigin = req.headers.origin || '';
      if (ALLOWED_ORIGINS.includes(ttsOrigin) || ALLOWED_ORIGINS.includes('*')) {
        ttsHeaders['Access-Control-Allow-Origin'] = ttsOrigin;
      }
      res.writeHead(200, ttsHeaders);
      res.end(audioBuffer);
    } catch (err) {
      console.error('[web-api] TTS error:', err.message);
      jsonResponse(res, 500, { error: 'Voice generation failed' });
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
      // Last-known-good: survive transient GitHub API failures / rate limits
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
          signal: AbortSignal.timeout(8000),
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
          // Store last-known-good for resilience
          lastKnownGithub = { ...githubCell };
        } else if (lastKnownGithub) {
          // Rate limited or server error — use last known good
          githubCell = { ...lastKnownGithub };
        } else {
          githubCell.status = 'unreachable';
        }
      } catch {
        // Network failure — use last known good if available
        if (lastKnownGithub) {
          githubCell = { ...lastKnownGithub };
        } else {
          githubCell.status = 'unreachable';
        }
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

      // Record uptime proof
      recordUptime(
        flyCell.status === 'interlinked',
        githubCell.status === 'interlinked' || githubCell.status === 'dormant',
        vercelCell.status === 'interlinked'
      );

      const meshData = {
        mantra: 'cells within cells interlinked',
        status: allInterlinked ? 'fully-interlinked' : 'partial',
        cells: [flyCell, githubCell, vercelCell],
        links,
        uptime: getUptimeStats(),
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

  // ============ GET /web/rosetta/view ============
  // Full Rosetta Protocol state: all lexicons, universal concepts, covenant hash, active challenges
  if (pathname === '/web/rosetta/view' && req.method === 'GET') {
    try {
      const view = getRosettaView();
      jsonResponse(res, 200, view);
    } catch (err) {
      console.error('[web-api] Rosetta view error:', err.message);
      jsonResponse(res, 500, { error: 'Could not fetch Rosetta state' });
    }
    return true;
  }

  // ============ GET /web/rosetta/translate ============
  // Translate a concept between two agents
  // ?from=poseidon&to=athena&concept=liquidity
  if (pathname === '/web/rosetta/translate' && req.method === 'GET') {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const concept = url.searchParams.get('concept');
      if (!from || !to || !concept) {
        jsonResponse(res, 400, { error: 'Missing required params: from, to, concept' });
        return true;
      }
      const result = translate(from, to, concept);
      jsonResponse(res, 200, result);
    } catch (err) {
      console.error('[web-api] Rosetta translate error:', err.message);
      jsonResponse(res, 500, { error: 'Translation failed' });
    }
    return true;
  }

  // ============ GET /web/rosetta/all ============
  // Translate a concept from one agent to ALL other agents
  // ?from=poseidon&concept=liquidity
  if (pathname === '/web/rosetta/all' && req.method === 'GET') {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const from = url.searchParams.get('from');
      const concept = url.searchParams.get('concept');
      if (!from || !concept) {
        jsonResponse(res, 400, { error: 'Missing required params: from, concept' });
        return true;
      }
      const result = translateToAll(from, concept);
      jsonResponse(res, 200, result);
    } catch (err) {
      console.error('[web-api] Rosetta translate-all error:', err.message);
      jsonResponse(res, 500, { error: 'Translation failed' });
    }
    return true;
  }

  // ============ GET /web/rosetta/lexicon ============
  // Get an agent's vocabulary
  // ?agent=poseidon
  if (pathname === '/web/rosetta/lexicon' && req.method === 'GET') {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const agent = url.searchParams.get('agent');
      if (!agent) {
        jsonResponse(res, 400, { error: 'Missing required param: agent' });
        return true;
      }
      const lexicon = getLexicon(agent);
      jsonResponse(res, 200, lexicon);
    } catch (err) {
      console.error('[web-api] Rosetta lexicon error:', err.message);
      jsonResponse(res, 500, { error: 'Could not fetch lexicon' });
    }
    return true;
  }

  // ============ GET /web/covenants ============
  // Returns the Ten Covenants with their hash
  if (pathname === '/web/covenants' && req.method === 'GET') {
    jsonResponse(res, 200, {
      covenants: TEN_COVENANTS,
      hash: COVENANT_HASH,
      count: TEN_COVENANTS.length,
    });
    return true;
  }

  // ============ GET /web/infofi/stats ============
  if (pathname === '/web/infofi/stats' && req.method === 'GET') {
    try {
      jsonResponse(res, 200, getInfoFiStats());
    } catch (err) {
      jsonResponse(res, 500, { error: err.message });
    }
    return true;
  }

  // ============ GET /web/infofi/primitives ============
  if (pathname === '/web/infofi/primitives' && req.method === 'GET') {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const type = url.searchParams.get('type') || undefined;
      const author = url.searchParams.get('author') || undefined;
      const limit = parseInt(url.searchParams.get('limit')) || 20;
      const offset = parseInt(url.searchParams.get('offset')) || 0;
      // Normalize sort values from frontend
      let sort = url.searchParams.get('sort') || 'newest';
      const sortMap = { most_cited: 'citations', highest_price: 'price', most_viewed: 'views', newest: 'newest' };
      sort = sortMap[sort] || sort;
      jsonResponse(res, 200, listPrimitives({ type, author, sort, limit, offset }));
    } catch (err) {
      jsonResponse(res, 500, { error: err.message });
    }
    return true;
  }

  // ============ POST /web/infofi/primitives ============
  if (pathname === '/web/infofi/primitives' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const result = createPrimitive(body);
      jsonResponse(res, 201, result);
    } catch (err) {
      jsonResponse(res, 400, { error: err.message });
    }
    return true;
  }

  // ============ POST /web/infofi/cite ============
  if (pathname === '/web/infofi/cite' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.primitiveId || !body.citingAuthor) {
        jsonResponse(res, 400, { error: 'Missing primitiveId or citingAuthor' });
        return true;
      }
      const result = citePrimitive(body.primitiveId, body.citingAuthor);
      jsonResponse(res, 200, result);
    } catch (err) {
      jsonResponse(res, 400, { error: err.message });
    }
    return true;
  }

  // ============ GET /web/infofi/search ============
  if (pathname === '/web/infofi/search' && req.method === 'GET') {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const q = url.searchParams.get('q') || '';
      const limit = parseInt(url.searchParams.get('limit')) || 20;
      const offset = parseInt(url.searchParams.get('offset')) || 0;
      const results = searchPrimitives(q);
      jsonResponse(res, 200, { primitives: results.slice(offset, offset + limit), total: results.length });
    } catch (err) {
      jsonResponse(res, 500, { error: err.message });
    }
    return true;
  }

  // ============ GET /web/infofi/author/:author ============
  if (pathname.startsWith('/web/infofi/author/') && req.method === 'GET') {
    try {
      const author = decodeURIComponent(pathname.slice('/web/infofi/author/'.length));
      jsonResponse(res, 200, getAuthorStats(author));
    } catch (err) {
      jsonResponse(res, 500, { error: err.message });
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
