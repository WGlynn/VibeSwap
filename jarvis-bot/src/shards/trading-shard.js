// ============ Trading Shard — Rodney's Memehunter ============
//
// Specialized Jarvis shard for trading operations, owned by
// triggerednometry (Rodney). This is the first shard that
// actually runs as an independent worker with its own identity,
// tools, and context resolution via DID registry.
//
// Architecture:
//   - Registers with shard-router as 'shard-trading-rodney'
//   - Loads context by DID reference (compact, no raw data duplication)
//   - Runs memehunter commands + trading intelligence
//   - Sends heartbeats every 30s (exponential backoff on failure)
//   - Shapley tracking enabled for fair attribution
//
// Run: SHARD_ID=shard-trading-rodney node src/shards/trading-shard.js
// ============

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  huntMemecoins,
  getMemeScore,
  startMemeMonitor,
  stopMemeMonitor,
  getMonitorStatus,
  getPendingApprovals,
  handleMemeCallback,
} from '../tools-memehunter.js';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');

// ============ Shard Configuration ============

export const TRADING_SHARD_CONFIG = {
  shardId: 'shard-trading-rodney',
  specialization: 'memehunter',
  owner: 'triggerednometry',
  tools: ['memehunter', 'trading', 'wallet', 'market-data'],
  didRegistry: join(DATA_DIR, 'did-registry.json'),
  shapleyTracking: true,
  systemPrompt: [
    'You are a specialized trading shard of the Jarvis Mind Network.',
    'Owner: triggerednometry (Rodney) — core contributor, trading bot builder.',
    'Specialization: memecoin hunting, trade signal detection, and execution on Base via Uniswap V3.',
    '',
    'Capabilities:',
    '  - /hunt [chain] — scan new tokens, score them, show best candidates',
    '  - /memescore <addr> [chain] — deep risk score for a single token',
    '  - /mememonitor [chain] — start background memecoin monitor',
    '  - /memestop — stop background monitor',
    '  - /memestatus — monitor status',
    '  - /memepending — show pending approval queue',
    '',
    'Trading intelligence:',
    '  - Higher sensitivity to price mentions and trade signals in conversation',
    '  - Auto-detect token addresses (0x...) and chain mentions',
    '  - When a user mentions a token, proactively offer /memescore',
    '  - Flag suspicious patterns (rug pull indicators, honeypot language)',
    '',
    'Safety:',
    '  - Human-in-the-loop approval for all trades (inline TG keyboard)',
    '  - Max position size enforced by config (default 0.005 ETH)',
    '  - All trades logged to data/meme-trades.jsonl',
    '  - Shapley tracking enabled — contributions attributed fairly',
    '',
    'Personality: Direct, data-driven, no hype. Show the numbers.',
    'If a token looks like a rug, say so. Protecting capital > looking bullish.',
  ].join('\n'),
};

// ============ DID Registry — Context Resolution ============

let didRegistry = null;

/**
 * Look up a DID in the compact registry.
 * Returns { title, type, tier, tags, description } or null.
 * This is how the shard loads context by reference instead of raw data.
 *
 * @param {string} did - Full DID (e.g. 'did:jarvis:project:ddf4bb34') or alias (e.g. 'augmented-bonding-curves')
 * @returns {object|null} Registry entry or null if not found
 */
export function resolveDID(did) {
  if (!didRegistry) return null;

  // Direct DID lookup
  if (didRegistry.entries[did]) {
    return { did, ...didRegistry.entries[did] };
  }

  // Alias lookup
  if (didRegistry.aliases && didRegistry.aliases[did]) {
    const resolvedDid = didRegistry.aliases[did];
    if (didRegistry.entries[resolvedDid]) {
      return { did: resolvedDid, ...didRegistry.entries[resolvedDid] };
    }
  }

  // Fuzzy search by tag (return first match)
  const needle = did.toLowerCase();
  for (const [entryDid, entry] of Object.entries(didRegistry.entries)) {
    if (entry.tags && entry.tags.some(tag => tag === needle)) {
      return { did: entryDid, ...entry };
    }
  }

  return null;
}

/**
 * Load the DID registry from disk.
 * @returns {object|null} The parsed registry or null on failure
 */
async function loadDIDRegistry() {
  try {
    const raw = await readFile(TRADING_SHARD_CONFIG.didRegistry, 'utf-8');
    didRegistry = JSON.parse(raw);
    const entryCount = Object.keys(didRegistry.entries || {}).length;
    console.log(`[trading-shard] DID registry loaded: ${entryCount} entries, v${didRegistry.version}`);
    return didRegistry;
  } catch (err) {
    console.warn(`[trading-shard] DID registry load failed: ${err.message}`);
    return null;
  }
}

// ============ Trading Intelligence — Signal Detection ============

const TOKEN_ADDRESS_RE = /\b0x[a-fA-F0-9]{40}\b/g;
const PRICE_SIGNAL_RE = /\b(pump(ing|ed)?|dump(ing|ed)?|moon(ing)?|rug(ged)?|honeypot|scam|buy|sell|long|short|ape|degen|100x|10x|1000x)\b/gi;
const CHAIN_MENTION_RE = /\b(base|eth|ethereum|sol|solana|arb|arbitrum|bsc|bnb|polygon|matic|avax|avalanche|op|optimism)\b/gi;

/**
 * Analyze a message for trading signals.
 * Returns detected addresses, signal words, and chain mentions.
 *
 * @param {string} text - Raw message text
 * @returns {{ addresses: string[], signals: string[], chains: string[], hasTradingIntent: boolean }}
 */
function detectTradingSignals(text) {
  if (!text) return { addresses: [], signals: [], chains: [], hasTradingIntent: false };

  const addresses = [...new Set((text.match(TOKEN_ADDRESS_RE) || []))];
  const signals = [...new Set((text.match(PRICE_SIGNAL_RE) || []).map(s => s.toLowerCase()))];
  const chains = [...new Set((text.match(CHAIN_MENTION_RE) || []).map(c => c.toLowerCase()))];

  // Trading intent = has address + signal, or multiple signals, or explicit chain + signal
  const hasTradingIntent =
    (addresses.length > 0 && signals.length > 0) ||
    signals.length >= 2 ||
    (chains.length > 0 && signals.length > 0);

  return { addresses, signals, chains, hasTradingIntent };
}

// ============ Init — Register, Setup Commands, Start Heartbeat ============

let heartbeatTimer = null;
let registered = false;

/**
 * Initialize the trading shard.
 * - Loads the DID registry
 * - Registers with the shard router
 * - Sets up memehunter-specific TG commands
 * - Starts heartbeat loop
 *
 * @param {object} bot - Telegraf bot instance (or null for headless mode)
 * @param {function} sendTg - (chatId, text, opts?) => Promise — sends TG message
 * @returns {object} Shard info
 */
export async function initTradingShard(bot, sendTg) {
  console.log('[trading-shard] ============ TRADING SHARD INIT ============');
  console.log(`[trading-shard] ID: ${TRADING_SHARD_CONFIG.shardId}`);
  console.log(`[trading-shard] Owner: ${TRADING_SHARD_CONFIG.owner}`);
  console.log(`[trading-shard] Specialization: ${TRADING_SHARD_CONFIG.specialization}`);
  console.log(`[trading-shard] Shapley tracking: ${TRADING_SHARD_CONFIG.shapleyTracking}`);

  // Step 1: Load DID registry
  await loadDIDRegistry();

  // Step 2: Register with router
  const routerUrl = config.shard?.routerUrl;
  if (routerUrl) {
    await registerWithRouter(routerUrl);
  } else {
    console.warn('[trading-shard] No ROUTER_URL configured — running standalone');
  }

  // Step 3: Setup memehunter commands on bot
  if (bot) {
    setupCommands(bot, sendTg);
  }

  // Step 4: Start heartbeat
  startHeartbeat(routerUrl);

  console.log('[trading-shard] ============ TRADING SHARD READY ============');

  return {
    shardId: TRADING_SHARD_CONFIG.shardId,
    status: 'running',
    tools: TRADING_SHARD_CONFIG.tools,
    didEntries: didRegistry ? Object.keys(didRegistry.entries).length : 0,
    registered,
  };
}

// ============ Router Registration ============

async function registerWithRouter(routerUrl) {
  try {
    const healthPort = process.env.HEALTH_PORT || '8080';
    const flyApp = process.env.FLY_APP_NAME;
    const flyMachine = process.env.FLY_MACHINE_ID;
    const shardUrl = flyApp && flyMachine
      ? `http://${flyMachine}.vm.${flyApp}.internal:${healthPort}`
      : `http://localhost:${healthPort}`;

    const resp = await fetch(`${routerUrl}/router/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shardId: TRADING_SHARD_CONFIG.shardId,
        url: shardUrl,
        capabilities: {
          specialization: TRADING_SHARD_CONFIG.specialization,
          tools: TRADING_SHARD_CONFIG.tools,
          owner: TRADING_SHARD_CONFIG.owner,
          shapleyTracking: TRADING_SHARD_CONFIG.shapleyTracking,
        },
        load: 0,
        userCount: 0,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      console.warn(`[trading-shard] Router registration failed: ${resp.status}`);
      return;
    }

    const data = await resp.json();
    registered = true;
    console.log(`[trading-shard] Registered with router. Peers: ${data.peers?.length || 0}, total shards: ${data.totalShards}`);
  } catch (err) {
    console.warn(`[trading-shard] Router registration error: ${err.message}`);
  }
}

// ============ Heartbeat ============

let consecutiveFailures = 0;
const HEARTBEAT_MS = 30_000;
const HEARTBEAT_MAX_MS = 5 * 60 * 1000;

function startHeartbeat(routerUrl) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  consecutiveFailures = 0;

  heartbeatTimer = setInterval(async () => {
    if (!routerUrl) return;

    try {
      const resp = await fetch(`${routerUrl}/router/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shardId: TRADING_SHARD_CONFIG.shardId,
          status: 'running',
          load: 0,
          userCount: 0,
          uptime: process.uptime(),
          memory: process.memoryUsage().heapUsed,
        }),
        signal: AbortSignal.timeout(5_000),
      });

      if (resp.ok) {
        if (consecutiveFailures > 0) {
          console.log(`[trading-shard] Heartbeat recovered after ${consecutiveFailures} failures`);
        }
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
        console.warn(`[trading-shard] Heartbeat rejected: ${resp.status} (failure ${consecutiveFailures})`);
      }
    } catch (err) {
      consecutiveFailures++;
      const backoff = Math.min(HEARTBEAT_MS * Math.pow(2, consecutiveFailures), HEARTBEAT_MAX_MS);
      console.warn(`[trading-shard] Heartbeat failed (${consecutiveFailures}x, backoff ${Math.round(backoff / 1000)}s): ${err.message}`);
    }
  }, HEARTBEAT_MS);

  console.log(`[trading-shard] Heartbeat started (${HEARTBEAT_MS / 1000}s interval)`);
}

// ============ Command Setup — Memehunter + Trading Intelligence ============

function setupCommands(bot, sendTg) {
  // /hunt [chain] — scan new tokens
  bot.command('hunt', async (ctx) => {
    const chain = ctx.message.text.split(/\s+/)[1] || 'base';
    const reply = await huntMemecoins(chain);
    await ctx.reply(reply, { parse_mode: undefined });
    trackContribution(ctx.from, 'hunt', { chain });
  });

  // /memescore <addr> [chain] — deep score
  bot.command('memescore', async (ctx) => {
    const parts = ctx.message.text.split(/\s+/);
    const addr = parts[1];
    const chain = parts[2];
    const reply = await getMemeScore(addr, chain);
    await ctx.reply(reply, { parse_mode: undefined });
    trackContribution(ctx.from, 'memescore', { addr, chain });
  });

  // /mememonitor [chain] — start background monitor
  bot.command('mememonitor', async (ctx) => {
    const chain = ctx.message.text.split(/\s+/)[1] || 'base';
    const postAlert = (msg) => ctx.reply(msg, { parse_mode: undefined });
    const reply = startMemeMonitor(chain, postAlert, sendTg);
    await ctx.reply(reply);
    trackContribution(ctx.from, 'mememonitor', { chain });
  });

  // /memestop — stop monitor
  bot.command('memestop', async (ctx) => {
    const reply = stopMemeMonitor();
    await ctx.reply(reply);
  });

  // /memestatus — monitor status
  bot.command('memestatus', async (ctx) => {
    const reply = getMonitorStatus();
    await ctx.reply(reply);
  });

  // /memepending — pending approvals
  bot.command('memepending', async (ctx) => {
    const reply = getPendingApprovals();
    await ctx.reply(reply, { parse_mode: undefined });
  });

  // Callback handler for approve/reject inline buttons
  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data || !data.startsWith('meme_')) return;

    const [action, callbackId] = data.split(':');
    if (!action || !callbackId) return;

    const result = await handleMemeCallback(action, callbackId, sendTg);
    await ctx.answerCbQuery(result.slice(0, 200));
  });

  // Trading intelligence — detect signals in regular messages
  bot.on('text', async (ctx, next) => {
    const text = ctx.message.text;

    // Skip commands (handled above)
    if (text.startsWith('/')) return next();

    const signals = detectTradingSignals(text);

    // If we detect a token address with trading intent, proactively offer a score
    if (signals.addresses.length > 0 && signals.hasTradingIntent) {
      const addr = signals.addresses[0];
      const chain = signals.chains[0] || 'base';
      const hint = `Detected token address. Scoring...\n/memescore ${addr} ${chain}`;
      await ctx.reply(hint);

      const score = await getMemeScore(addr, chain);
      await ctx.reply(score, { parse_mode: undefined });
      trackContribution(ctx.from, 'auto-score', { addr, chain, signals: signals.signals });
      return; // Handled — don't pass to next
    }

    return next();
  });

  console.log(`[trading-shard] Commands registered: /hunt, /memescore, /mememonitor, /memestop, /memestatus, /memepending`);
}

// ============ Shapley Contribution Tracking ============

const contributions = [];
const MAX_CONTRIBUTIONS = 10_000;

function trackContribution(user, action, metadata = {}) {
  if (!TRADING_SHARD_CONFIG.shapleyTracking) return;

  const entry = {
    timestamp: new Date().toISOString(),
    shardId: TRADING_SHARD_CONFIG.shardId,
    userId: user?.id || 'unknown',
    username: user?.username || user?.first_name || 'unknown',
    action,
    ...metadata,
  };

  contributions.push(entry);

  // Cap memory usage
  if (contributions.length > MAX_CONTRIBUTIONS) {
    contributions.splice(0, contributions.length - MAX_CONTRIBUTIONS);
  }
}

/**
 * Get contribution history for Shapley attribution.
 * @param {number} limit - Max entries to return
 * @returns {object[]} Recent contributions
 */
export function getContributions(limit = 100) {
  return contributions.slice(-limit);
}

// ============ Shutdown ============

export function shutdownTradingShard() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  console.log(`[trading-shard] Shutdown. ${contributions.length} contributions tracked this session.`);
}

// ============ Exports ============

export { detectTradingSignals };
