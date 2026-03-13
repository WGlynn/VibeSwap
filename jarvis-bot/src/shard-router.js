// ============ Shard Router — TG Update Dispatcher ============
//
// Thin process that receives ALL Telegram updates and routes
// them to the correct shard worker by chat ID.
//
// Architecture:
//   TG webhook → Router (this) → HTTP POST to shard worker
//
// The router is intentionally minimal:
//   - No LLM, no context, no memory
//   - Just routing table + health checks + failover
//   - One Telegraf instance, dispatches raw updates
//
// Shards register via POST /router/register
// Shards send heartbeats via POST /router/heartbeat
// Router dispatches TG updates via POST /shard/update on each worker
//
// Run: SHARD_MODE=router node src/shard-router.js
// Env: TELEGRAM_BOT_TOKEN, PORT, WEBHOOK_DOMAIN
// ============

import { Telegraf } from 'telegraf';
import express from 'express';
import { config } from './config.js';

const PORT = parseInt(process.env.PORT, 10) || 8080;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN || null;
const STALE_MS = 90_000; // Shard considered dead after 90s without heartbeat
const REBALANCE_INTERVAL = 60_000;

// ============ Shard Registry ============

const shards = new Map(); // shardId -> { url, status, load, userCount, lastHeartbeat, capabilities, chatIds }
const chatAssignments = new Map(); // chatId -> shardId

// ============ Assignment Strategy ============

function assignChat(chatId) {
  // Check existing assignment
  const existing = chatAssignments.get(chatId);
  if (existing && shards.has(existing)) {
    const shard = shards.get(existing);
    if (shard.status === 'running' && Date.now() - shard.lastHeartbeat < STALE_MS) {
      return existing;
    }
  }

  // Find least-loaded live shard
  let best = null;
  let bestLoad = Infinity;

  for (const [id, shard] of shards) {
    if (shard.status !== 'running') continue;
    if (Date.now() - shard.lastHeartbeat > STALE_MS) continue;
    const effectiveLoad = (shard.chatIds?.size || 0) + shard.load;
    if (effectiveLoad < bestLoad) {
      bestLoad = effectiveLoad;
      best = id;
    }
  }

  if (!best) return null; // No live shards

  // Assign
  chatAssignments.set(chatId, best);
  const shard = shards.get(best);
  if (!shard.chatIds) shard.chatIds = new Set();
  shard.chatIds.add(chatId);

  console.log(`[router] Chat ${chatId} → ${best} (load: ${bestLoad})`);
  return best;
}

// ============ Dispatch ============

async function dispatchUpdate(update) {
  const chatId = update.message?.chat?.id
    || update.callback_query?.message?.chat?.id
    || update.edited_message?.chat?.id
    || null;

  if (!chatId) {
    console.warn('[router] Update with no chat ID — dropping');
    return;
  }

  const shardId = assignChat(chatId);
  if (!shardId) {
    console.warn(`[router] No live shard for chat ${chatId} — dropping update`);
    return;
  }

  const shard = shards.get(shardId);
  try {
    const resp = await fetch(`${shard.url}/shard/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      console.warn(`[router] Shard ${shardId} rejected update: ${resp.status}`);
      // Try failover to another shard
      chatAssignments.delete(chatId);
      shard.chatIds?.delete(chatId);
    }
  } catch (err) {
    console.error(`[router] Dispatch to ${shardId} failed: ${err.message}`);
    // Mark shard as potentially dead, reassign on next update
    chatAssignments.delete(chatId);
    shard.chatIds?.delete(chatId);
  }
}

// ============ Health / Rebalance ============

function evictStaleShards() {
  const now = Date.now();
  for (const [id, shard] of shards) {
    if (now - shard.lastHeartbeat > STALE_MS * 2) {
      console.warn(`[router] Evicting stale shard: ${id}`);
      // Reassign all its chats
      for (const [chatId, assignedShard] of chatAssignments) {
        if (assignedShard === id) chatAssignments.delete(chatId);
      }
      shards.delete(id);
    }
  }
}

setInterval(evictStaleShards, REBALANCE_INTERVAL);

// ============ Express API (shard registration + heartbeat) ============

const app = express();
app.use(express.json());

// Shard registration
app.post('/router/register', (req, res) => {
  const { shardId, url, capabilities, load, userCount } = req.body;
  if (!shardId || !url) return res.status(400).json({ error: 'shardId and url required' });

  shards.set(shardId, {
    url,
    capabilities: capabilities || {},
    load: load || 0,
    userCount: userCount || 0,
    status: 'running',
    lastHeartbeat: Date.now(),
    registeredAt: Date.now(),
    chatIds: shards.get(shardId)?.chatIds || new Set(),
  });

  console.log(`[router] Shard registered: ${shardId} @ ${url} (${shards.size} total)`);

  // Return peer list + current assignments
  const peers = [];
  for (const [id, s] of shards) {
    if (id !== shardId) {
      peers.push({ shardId: id, url: s.url, status: s.status, load: s.load });
    }
  }

  // Convert chat assignments to object (only ones relevant to this shard)
  const assignments = {};
  for (const [chatId, sid] of chatAssignments) {
    if (sid === shardId) assignments[chatId] = sid;
  }

  res.json({ ok: true, peers, assignments, totalShards: shards.size });
});

// Heartbeat
app.post('/router/heartbeat', (req, res) => {
  const { shardId, status, load, userCount, uptime, memory } = req.body;
  if (!shardId) return res.status(400).json({ error: 'shardId required' });

  const shard = shards.get(shardId);
  if (!shard) return res.status(404).json({ error: 'Shard not registered. POST /router/register first.' });

  shard.status = status || 'running';
  shard.load = load || 0;
  shard.userCount = userCount || 0;
  shard.lastHeartbeat = Date.now();
  if (uptime) shard.uptime = uptime;
  if (memory) shard.memory = memory;

  res.json({ ok: true });
});

// Status dashboard
app.get('/router/status', (req, res) => {
  const status = {
    uptime: process.uptime(),
    shards: {},
    totalChats: chatAssignments.size,
    totalShards: shards.size,
  };

  for (const [id, shard] of shards) {
    status.shards[id] = {
      url: shard.url,
      status: shard.status,
      load: shard.load,
      chatCount: shard.chatIds?.size || 0,
      lastHeartbeat: new Date(shard.lastHeartbeat).toISOString(),
      stale: Date.now() - shard.lastHeartbeat > STALE_MS,
      uptime: shard.uptime,
      memory: shard.memory,
    };
  }

  res.json(status);
});

// Manual reassignment
app.post('/router/assign', (req, res) => {
  const { chatId, shardId } = req.body;
  if (!chatId || !shardId) return res.status(400).json({ error: 'chatId and shardId required' });
  if (!shards.has(shardId)) return res.status(404).json({ error: 'Shard not found' });

  // Remove from old shard
  const old = chatAssignments.get(chatId);
  if (old && shards.has(old)) shards.get(old).chatIds?.delete(chatId);

  // Assign to new shard
  chatAssignments.set(chatId, shardId);
  const shard = shards.get(shardId);
  if (!shard.chatIds) shard.chatIds = new Set();
  shard.chatIds.add(chatId);

  console.log(`[router] Manual reassign: chat ${chatId} → ${shardId}`);
  res.json({ ok: true, chatId, shardId });
});

// Learning bus — broadcast to all shards
app.post('/router/broadcast', async (req, res) => {
  const { type, data, excludeShard } = req.body;
  if (!type || !data) return res.status(400).json({ error: 'type and data required' });

  const results = [];
  for (const [id, shard] of shards) {
    if (id === excludeShard) continue;
    if (shard.status !== 'running') continue;

    try {
      await fetch(`${shard.url}/shard/learn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, data, fromShard: excludeShard || 'router' }),
        signal: AbortSignal.timeout(5_000),
      });
      results.push({ shard: id, ok: true });
    } catch (err) {
      results.push({ shard: id, ok: false, error: err.message });
    }
  }

  res.json({ ok: true, delivered: results.filter(r => r.ok).length, total: results.length, results });
});

// ============ Telegraf Setup ============

const bot = new Telegraf(config.telegram.token);

// Intercept ALL updates and dispatch to shards
bot.use(async (ctx) => {
  await dispatchUpdate(ctx.update);
});

// ============ Launch ============

async function start() {
  console.log('[router] ============ SHARD ROUTER MODE ============');
  console.log(`[router] Port: ${PORT}`);
  console.log(`[router] Webhook domain: ${WEBHOOK_DOMAIN || 'NONE (long-polling)'}`);

  // Start Express server for shard API
  app.listen(PORT, () => {
    console.log(`[router] API listening on :${PORT}`);
  });

  if (WEBHOOK_DOMAIN) {
    // Webhook mode — TG pushes updates to us
    const webhookPath = `/webhook/${config.telegram.token}`;
    app.use(bot.webhookCallback(webhookPath));
    await bot.telegram.setWebhook(`${WEBHOOK_DOMAIN}${webhookPath}`);
    console.log(`[router] Webhook set: ${WEBHOOK_DOMAIN}${webhookPath}`);
  } else {
    // Long-polling fallback (dev mode)
    bot.launch({ dropPendingUpdates: true });
    console.log('[router] Long-polling started (dev mode)');
  }

  console.log('[router] Waiting for shard registrations...');
}

start().catch(err => {
  console.error(`[router] Fatal: ${err.message}`);
  process.exit(1);
});

// Graceful shutdown
process.once('SIGINT', () => { bot.stop('SIGINT'); process.exit(0); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });
