import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { initClaude, chat, codeGenChat, bufferMessage, reloadSystemPrompt, clearHistory, saveConversations, getSystemPrompt, getLastResponse } from './claude.js';
import { gitStatus, gitPull, gitCommitAndPush, gitLog, backupData, gitCreateBranch, gitCommitAndPushBranch, gitReturnToMaster } from './git.js';
import { initTracker, trackMessage, linkWallet, getUserStats, getGroupStats, getAllUsers, flushTracker } from './tracker.js';
import { diagnoseContext } from './memory.js';
import { initModeration, warnUser, muteUser, unmuteUser, banUser, unbanUser, getModerationLog, flushModeration } from './moderation.js';
import { checkMessage, initAntispam, flushAntispam, getSpamLog } from './antispam.js';
import { generateDigest, generateWeeklyDigest } from './digest.js';
import { analyzeMessage, generateProactiveResponse, evaluateModeration, getIntelligenceStats } from './intelligence.js';
import { initThreads, trackForThread, shouldSuggestArchival, archiveThread, getRecentThreads, getThreadStats, flushThreads } from './threads.js';
import { loadBehavior, getFlag, setFlag, listFlags } from './behavior.js';
import { initLearning, processCorrection, getLearningStats, getUserKnowledgeSummary, getGroupKnowledgeSummary, getSkills, flushLearning, addGroupNorm, setGroupName, compressCKB } from './learning.js';
import { initPrivacy, getPrivacyStatus, isEncryptionEnabled } from './privacy.js';
import { initInnerDialogue, getRecentDialogue, getDialogueStats, recordInnerDialogue, flushInnerDialogue, generateInnerDialogue } from './inner-dialogue.js';
import { initStateStore } from './state-store.js';
import { initProvider, getProviderName, getModelName, getFallbackChain, getIntelligenceLevel, checkDegradation, tryRestorePrimary } from './llm-provider.js';
import { initShard, getShardInfo, isMultiShard, shutdownShard } from './shard.js';
import { getTopology, handleRouterRequest, processRouterBody, checkShardHealth, getArchiveStatus } from './router.js';
import { initConsensus, getConsensusState, handleConsensusRequest, processConsensusBody } from './consensus.js';
import { initCRPC, getCRPCStats, handleCRPCRequest, processCRPCBody } from './crpc.js';
import { registerConsensusHandlers } from './learning.js';
import { produceEpoch, addChange, broadcastEpoch, syncWithPeers, getChainStats, handleKnowledgeChainRequest, processKnowledgeChainBody, recoverWAL, retryMissedEpochs, scheduleHarmonicTick } from './knowledge-chain.js';
import { recoverRetryQueue } from './consensus.js';
import { initShadow, createInvite, consumeInvite, registerShadow, isShadow, getShadowCodename, incrementContribution, listShadows, listPendingInvites, revokeShadow, getShadowStats, flushShadow } from './shadow.js';
import { runSecurityChecks } from './security-checks.js';
// Group monitor — graceful fallback if 'telegram' package not installed
let initMonitor, interactiveAuth, interceptAuthMessage, formatIntelReport, getMonitorStatus, getMessagesForAnalysis, startPolling, stopPolling, MONITORED_GROUPS;
let monitorAvailable = false;
try {
  const monitor = await import('./telegram-monitor.js');
  initMonitor = monitor.initMonitor;
  interactiveAuth = monitor.interactiveAuth;
  interceptAuthMessage = monitor.interceptAuthMessage;
  formatIntelReport = monitor.formatIntelReport;
  getMonitorStatus = monitor.getMonitorStatus;
  getMessagesForAnalysis = monitor.getMessagesForAnalysis;
  startPolling = monitor.startPolling;
  stopPolling = monitor.stopPolling;
  MONITORED_GROUPS = monitor.MONITORED_GROUPS;
  monitorAvailable = true;
} catch (err) {
  console.warn(`[jarvis] Group monitor unavailable: ${err.message}`);
  console.warn('[jarvis] Run "npm install" to add the telegram (GramJS) package.');
  MONITORED_GROUPS = ['NervosNation'];
}
import { initStickers, textToSticker, imageToSticker, imageWithText, addToStickerPack, getStyleList, AVAILABLE_STYLES } from './sticker.js';
import { loadComms, saveComms, receiveFromClaudeCode, getUnprocessedInbox, markProcessed, sendToClaudeCode, getOutbox, acknowledgeOutbox, getCommsLog, getCommsStats, pruneOldMessages } from './comms.js';
import { handleWebRequest } from './web-api.js';
import { initComputeEconomics, recordUsage as recordComputeUsage, flushComputeEconomics, recordTelegramMessage, getTelegramMessageCount, FREE_TELEGRAM_DMS, getComputeStats, getEffectivePool, getJulToPoolRatio, updatePricing, getPricingInfo } from './compute-economics.js';
import { initMining, flushMining, getMiningStats, getLeaderboard, tipJUL, getTreasuryStats, getDailyBurned } from './mining.js';
import { initHell, flushHell, getHellStats, checkIdentity, getRegistry } from './hell.js';
import { initDeepStorage, getDeepStorageGlobalStats } from './deep-storage.js';
import { initContextMemory, flushContextMemory, getContextMemoryStats } from './context-memory.js';
import { initLimni, flushLimni, getLimniStats, registerTerminal, registerVPS, checkTerminalHealth, checkAllVPS, listStrategies, getStrategy, startMonitorLoop, stopMonitorLoop, getAlerts, onAlert, strategyPipeline, deployStrategy, listBacktests, getBacktestResult, fetchTrades } from './limni.js';
import { registerKataraktiStrategies, formatPerformanceSummary } from './katarakti.js';
import { createServer } from 'http';
import { createHmac } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, mkdir, unlink, appendFile } from 'fs/promises';
import { join } from 'path';
const execFileAsync = promisify(execFile);
import googleTTS from 'google-tts-api';

// ============ Safe Body Reader (prevents unbounded body accumulation) ============
const MAX_BODY_SIZE = 64 * 1024; // 64 KB
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const HEARTBEAT_FILE = join(config.dataDir, 'heartbeat.json');

// ============ Mode Detection ============
// Primary mode: full JARVIS with Telegram bot + all features
// Worker mode: headless shard — consensus, CRPC, knowledge chain only (no Telegram)

const SHARD_MODE = config.shard?.mode || 'primary';
const IS_WORKER = SHARD_MODE === 'worker';

if (IS_WORKER) {
  console.log('[jarvis] ============ WORKER SHARD MODE ============');
  console.log('[jarvis] No Telegram token — running as headless consensus node.');
  console.log('[jarvis] This shard participates in: BFT consensus, CRPC, Knowledge Chain.');
  const provider = config.llm?.provider || 'claude';
  const hasKey = provider === 'ollama' || config.anthropic.apiKey || config.llm?.openaiApiKey || config.llm?.geminiApiKey || config.llm?.deepseekApiKey;
  if (!hasKey) {
    console.error('An LLM API key is required for worker shards (CRPC needs an LLM).');
    console.error('Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or use LLM_PROVIDER=ollama');
    process.exit(1);
  }
} else {
  // Primary mode: full startup checks
  if (!config.telegram.token) {
    console.error('============================================================');
    console.error('TELEGRAM_BOT_TOKEN is missing.');
    console.error('');
    console.error('Options:');
    console.error('  1. Set TELEGRAM_BOT_TOKEN in .env for full primary mode');
    console.error('  2. Set SHARD_MODE=worker in .env for headless consensus node');
    console.error('');
    console.error('Worker mode requires: ANTHROPIC_API_KEY, SHARD_ID, ROUTER_URL');
    console.error('============================================================');
    process.exit(1);
  }
  if (!config.anthropic.apiKey) {
    console.error('ANTHROPIC_API_KEY is required. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
}

// Only create Telegram bot in primary mode
// Worker mode: noop proxy that silently ignores all bot registrations
const NOOP = () => {};
const noopBot = new Proxy({}, { get: () => (...args) => typeof args[args.length - 1] === 'function' ? undefined : NOOP });
const bot = IS_WORKER ? noopBot : new Telegraf(config.telegram.token, {
  telegram: { allowedUpdates: ['message', 'callback_query'] },
});

// ============ Runtime Authorization ============
// Owner can authorize/deauthorize users at runtime via /authorize command.
// Persisted to disk so authorized users survive restarts.

const AUTHORIZED_FILE = join(config.dataDir, 'authorized-users.json');
const runtimeAuthorized = new Set(); // userId numbers added at runtime

async function loadRuntimeAuthorized() {
  try {
    const data = await readFile(AUTHORIZED_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    for (const id of parsed) runtimeAuthorized.add(id);
    if (runtimeAuthorized.size > 0) {
      console.log(`[auth] Loaded ${runtimeAuthorized.size} runtime-authorized user(s)`);
    }
  } catch {
    // No file yet — that's fine
  }
}

async function saveRuntimeAuthorized() {
  try {
    await writeFile(AUTHORIZED_FILE, JSON.stringify([...runtimeAuthorized], null, 2));
  } catch (err) {
    console.warn(`[auth] Failed to save authorized users: ${err.message}`);
  }
}

function authorizeUser(userId) {
  runtimeAuthorized.add(userId);
  saveRuntimeAuthorized();
}

function deauthorizeUser(userId) {
  runtimeAuthorized.delete(userId);
  saveRuntimeAuthorized();
}

function getAuthorizedList() {
  return [...new Set([...config.authorizedUsers, ...runtimeAuthorized])];
}

// Auth middleware (only used in primary mode)
function isAuthorized(ctx) {
  if (isOwner(ctx)) return true;
  if (config.authorizedUsers.includes(ctx.from.id)) return true;
  if (runtimeAuthorized.has(ctx.from.id)) return true;
  return false;
}

function unauthorized(ctx) {
  return ctx.reply('Not authorized. Ask Will to add your Telegram user ID.');
}

function isOwner(ctx) {
  return ctx.from.id === config.ownerUserId;
}

function ownerOnly(ctx) {
  return ctx.reply('Only Will can do that.');
}


// ============ Rate Limiting ============

const rateLimitMap = new Map(); // userId -> [timestamps]

function isRateLimited(userId) {
  const now = Date.now();
  if (!rateLimitMap.has(userId)) {
    rateLimitMap.set(userId, []);
  }
  const timestamps = rateLimitMap.get(userId);

  // Clean entries older than 60s
  while (timestamps.length > 0 && now - timestamps[0] > 60000) {
    timestamps.shift();
  }

  if (timestamps.length >= config.rateLimitPerMinute) {
    return true;
  }

  timestamps.push(now);
  return false;
}

// Evict stale rate limit entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamps] of rateLimitMap) {
    if (timestamps.length === 0 || now - timestamps[timestamps.length - 1] > 120000) {
      rateLimitMap.delete(userId);
    }
  }
}, 10 * 60 * 1000);

// ============ Heartbeat + Crash Detection ============

async function writeHeartbeat(status) {
  try {
    await mkdir(config.dataDir, { recursive: true });
    await writeFile(HEARTBEAT_FILE, JSON.stringify({
      status,
      timestamp: Date.now(),
      iso: new Date().toISOString(),
      model: config.anthropic.model,
      pid: process.pid,
    }, null, 2));
  } catch {}
}

async function checkLastShutdown() {
  try {
    const data = await readFile(HEARTBEAT_FILE, 'utf-8');
    const hb = JSON.parse(data);
    if (hb.status === 'running') {
      // Last shutdown was NOT graceful (no 'stopped' heartbeat)
      const downtime = Math.round((Date.now() - hb.timestamp) / 60000);
      return { clean: false, downtime, lastSeen: hb.iso };
    }
    return { clean: true, lastSeen: hb.iso };
  } catch {
    return { clean: true, firstBoot: true };
  }
}

// ============ New Member Welcome ============
// Reads behavior.json flag — can be toggled at runtime via /setbehavior or conversation mandate

bot.on('new_chat_members', async (ctx) => {
  if (!getFlag('welcomeNewMembers')) return; // silently skip if disabled
  for (const member of ctx.message.new_chat_members) {
    if (member.is_bot) continue;
    const name = member.first_name || member.username || 'newcomer';
    const msg = getFlag('welcomeMessage').replace(/\{name\}/g, name);
    await ctx.reply(msg);
  }
});

// ============ Commands ============

bot.command('start', async (ctx) => {
  const payload = ctx.message.text.split(' ')[1] || '';

  // Shadow Protocol deep link: /start shadow_<token>
  if (payload.startsWith('shadow_')) {
    const token = payload.slice(7);
    const invite = consumeInvite(token);
    if (!invite) {
      return ctx.reply('This invite link has expired or was already used.');
    }

    const { codename, existing } = registerShadow(ctx.from.id, invite);
    await flushShadow();

    if (existing) {
      return ctx.reply(`Welcome back. Your codename is: ${codename}\n\nYou can talk to me freely. Your identity remains private.`);
    }

    console.log(`[shadow] New shadow identity: ${codename} (invite note: ${invite.note || 'none'})`);
    return ctx.reply(
      `Welcome to VibeSwap.\n\n` +
      `Your codename is: ${codename}\n\n` +
      `Your real identity is encrypted and known only to the inner circle. ` +
      `Everything you say here is attributed to "${codename}" — never your real name.\n\n` +
      `You can talk to me about anything. I'm JARVIS — co-architect of VibeSwap. ` +
      `Ask me about the project, share ideas, give feedback. Your perspective matters.\n\n` +
      `This is a private channel. No one else can see our conversation.`
    );
  }

  if (!isAuthorized(ctx) && !isShadow(ctx.from.id)) return unauthorized(ctx);
  ctx.reply('JARVIS online. Just talk to me.');
});

bot.command('whoami', (ctx) => {
  const authorized = isAuthorized(ctx) ? 'Yes' : 'No';
  ctx.reply(`User ID: ${ctx.from.id}\nUsername: ${ctx.from.username || 'none'}\nName: ${ctx.from.first_name}\nAuthorized: ${authorized}`);
});

// /authorize — Owner adds a user to the authorized list at runtime
bot.command('authorize', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);

  // Accept: /authorize <userId>, /authorize @username (via reply), or reply to a message
  const args = ctx.message.text.split(/\s+/).slice(1);
  let targetId = null;
  let targetName = 'unknown';

  // If replying to someone's message, authorize that user
  if (ctx.message.reply_to_message?.from) {
    targetId = ctx.message.reply_to_message.from.id;
    targetName = ctx.message.reply_to_message.from.username || ctx.message.reply_to_message.from.first_name || String(targetId);
  } else if (args.length > 0) {
    // Try parsing as numeric user ID
    const parsed = parseInt(args[0]);
    if (!isNaN(parsed)) {
      targetId = parsed;
      targetName = args[1] || String(parsed);
    } else {
      return ctx.reply('Usage: /authorize <userId> or reply to someone\'s message with /authorize');
    }
  } else {
    return ctx.reply('Usage: /authorize <userId> or reply to someone\'s message with /authorize');
  }

  if (targetId === config.ownerUserId) {
    return ctx.reply('Owner is always authorized.');
  }

  authorizeUser(targetId);
  ctx.reply(`Authorized ${targetName} (${targetId}). They can now interact with JARVIS.`);
  console.log(`[auth] Will authorized user ${targetId} (${targetName})`);
});

// /deauthorize — Owner removes a user from the authorized list
bot.command('deauthorize', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);

  const args = ctx.message.text.split(/\s+/).slice(1);
  let targetId = null;

  if (ctx.message.reply_to_message?.from) {
    targetId = ctx.message.reply_to_message.from.id;
  } else if (args.length > 0) {
    targetId = parseInt(args[0]);
  }

  if (!targetId || isNaN(targetId)) {
    return ctx.reply('Usage: /deauthorize <userId> or reply to someone\'s message with /deauthorize');
  }

  deauthorizeUser(targetId);
  ctx.reply(`Deauthorized user ${targetId}.`);
  console.log(`[auth] Will deauthorized user ${targetId}`);
});

// /authorized — List all authorized users
bot.command('authorized', (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const list = getAuthorizedList();
  if (list.length === 0) {
    return ctx.reply('No authorized users (owner-only mode).');
  }
  ctx.reply(`Authorized users (${list.length}):\n${list.map(id => `- ${id}`).join('\n')}\n\nOwner: ${config.ownerUserId}`);
});

bot.command('status', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const status = await gitStatus();
  ctx.reply(status);
});

bot.command('pull', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const result = await gitPull();
  ctx.reply(result);
});

bot.command('log', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const log = await gitLog();
  ctx.reply(log);
});

bot.command('commit', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const message = ctx.message.text.replace('/commit', '').trim();
  if (!message) {
    return ctx.reply('Usage: /commit <message>');
  }
  const result = await gitCommitAndPush(message);
  ctx.reply(result);
});

bot.command('refresh', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  await reloadSystemPrompt();
  ctx.reply('Memory reloaded.');
});

bot.command('clear', (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  clearHistory(ctx.chat.id);
  ctx.reply('Conversation history cleared.');
});

bot.command('model', (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const arg = ctx.message.text.replace('/model', '').trim().toLowerCase();
  if (arg === 'opus') {
    config.anthropic.model = 'claude-opus-4-6';
    ctx.reply('Switched to Opus 4.6 (deep analysis mode).');
  } else if (arg === 'sonnet') {
    config.anthropic.model = 'claude-sonnet-4-5-20250929';
    ctx.reply('Switched to Sonnet 4.5 (fast mode).');
  } else {
    ctx.reply(`Current: ${config.anthropic.model}\nUsage: /model opus or /model sonnet`);
  }
});

// ============ Contribution Tracking Commands ============

bot.command('mystats', (ctx) => {
  const stats = getUserStats(ctx.from.id);
  if (!stats) {
    return ctx.reply('No contributions tracked yet. Just keep talking.');
  }
  const lines = [
    `${stats.username} — since ${stats.firstSeen}`,
    `Messages: ${stats.messageCount}`,
    `Tracked contributions: ${stats.contributions}`,
    `Avg quality: ${stats.avgQuality}/5`,
    `Replies given: ${stats.repliesGiven} | received: ${stats.repliesReceived}`,
    `Days active: ${stats.daysSinceFirst}`,
    `Wallet linked: ${stats.walletLinked ? 'yes' : 'no'}`,
    '',
    'Categories:',
    ...Object.entries(stats.categoryCounts).map(([k, v]) => `  ${k}: ${v}`),
  ];
  ctx.reply(lines.join('\n'));
});

bot.command('groupstats', (ctx) => {
  const stats = getGroupStats(ctx.chat.id);
  const lines = [
    `Group contributions: ${stats.totalContributions}`,
    `Active users: ${stats.totalUsers}`,
    `Interactions: ${stats.totalInteractions}`,
    '',
    'Categories:',
    ...Object.entries(stats.categoryCounts).map(([k, v]) => `  ${k}: ${v}`),
    '',
    'Top contributors:',
    ...stats.topContributors,
  ];
  ctx.reply(lines.join('\n'));
});

bot.command('linkwallet', async (ctx) => {
  const address = ctx.message.text.replace('/linkwallet', '').trim();
  if (!address || !address.startsWith('0x') || address.length !== 42) {
    return ctx.reply('Usage: /linkwallet 0xYourAddress');
  }
  const success = await linkWallet(ctx.from.id, address);
  if (success) {
    ctx.reply(`Wallet linked: ${address.slice(0, 6)}...${address.slice(-4)}`);
  } else {
    ctx.reply('Send a message first so I can track you, then link your wallet.');
  }
});

// ============ Backup ============

bot.command('backup', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const result = await backupData();
  ctx.reply(result);
});

// ============ Moderation (Will + Jarvis = Co-Admins) ============
// 50/50 human + AI governance. Both can execute moderation.
// Every action is logged with an evidence hash for on-chain accountability.
// No other humans have admin powers — eliminates third-party bias.

function resolveTargetUser(ctx) {
  // Try reply-to-message first (most natural)
  if (ctx.message.reply_to_message?.from) {
    return ctx.message.reply_to_message.from;
  }
  return null;
}

bot.command('warn', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const target = resolveTargetUser(ctx);
  if (!target) return ctx.reply('Reply to a message to warn that user.');
  if (target.is_bot) return ctx.reply('Cannot moderate bots.');

  const reason = ctx.message.text.replace('/warn', '').trim() || 'Community guidelines violation';
  const result = await warnUser(bot, ctx.chat.id, target.id, reason, ctx.from.id);

  if (result.escalated) {
    ctx.reply(`${target.first_name} warned (${result.warnings}/${3} — auto-muted for 1hr). Reason: ${reason}`);
  } else {
    ctx.reply(`${target.first_name} warned (${result.warnings}/${3}). Reason: ${reason}`);
  }
});

bot.command('mute', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const target = resolveTargetUser(ctx);
  if (!target) return ctx.reply('Reply to a message to mute that user.');
  if (target.is_bot) return ctx.reply('Cannot moderate bots.');

  const args = ctx.message.text.replace('/mute', '').trim();
  // Parse duration: /mute 1h reason or /mute 30m reason
  const durationMatch = args.match(/^(\d+)(m|h|d)/);
  let duration = 3600; // default 1h
  let reason = args;
  if (durationMatch) {
    const val = parseInt(durationMatch[1]);
    const unit = durationMatch[2];
    duration = unit === 'm' ? val * 60 : unit === 'h' ? val * 3600 : val * 86400;
    reason = args.slice(durationMatch[0].length).trim() || 'Muted by admin';
  }

  const result = await muteUser(bot, ctx.chat.id, target.id, duration, reason, ctx.from.id);
  if (result.executed) {
    const dStr = duration >= 3600 ? `${Math.round(duration/3600)}h` : `${Math.round(duration/60)}m`;
    ctx.reply(`${target.first_name} muted for ${dStr}. Reason: ${reason}`);
  } else {
    ctx.reply(`Failed to mute: ${result.error}. Make sure JARVIS is a group admin.`);
  }
});

bot.command('unmute', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const target = resolveTargetUser(ctx);
  if (!target) return ctx.reply('Reply to a message to unmute that user.');

  const reason = ctx.message.text.replace('/unmute', '').trim() || 'Unmuted';
  const result = await unmuteUser(bot, ctx.chat.id, target.id, reason, ctx.from.id);
  if (result.executed) {
    ctx.reply(`${target.first_name} unmuted.`);
  } else {
    ctx.reply(`Failed to unmute: ${result.error}`);
  }
});

bot.command('ban', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const target = resolveTargetUser(ctx);
  if (!target) return ctx.reply('Reply to a message to ban that user.');
  if (target.is_bot) return ctx.reply('Cannot moderate bots.');

  const reason = ctx.message.text.replace('/ban', '').trim() || 'Banned by admin';
  const result = await banUser(bot, ctx.chat.id, target.id, reason, ctx.from.id);
  if (result.executed) {
    ctx.reply(`${target.first_name} banned. Reason: ${reason}\nEvidence: ${result.evidenceHash.slice(0, 12)}...`);
  } else {
    ctx.reply(`Failed to ban: ${result.error}. Make sure JARVIS is a group admin.`);
  }
});

bot.command('unban', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const target = resolveTargetUser(ctx);
  if (!target) return ctx.reply('Reply to a message to unban that user.');

  const reason = ctx.message.text.replace('/unban', '').trim() || 'Unbanned';
  const result = await unbanUser(bot, ctx.chat.id, target.id, reason, ctx.from.id);
  if (result.executed) {
    ctx.reply(`${target.first_name} unbanned.`);
  } else {
    ctx.reply(`Failed to unban: ${result.error}`);
  }
});

bot.command('modlog', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const log = getModerationLog(ctx.chat.id, 10);
  if (!log.length) return ctx.reply('No moderation actions recorded.');

  const lines = log.map(e => {
    const time = new Date(e.timestamp).toISOString().slice(5, 16).replace('T', ' ');
    const status = e.executed === false ? ' [FAILED]' : '';
    return `${time} ${e.action.toUpperCase()} user:${e.userId} — ${e.reason}${status}`;
  });
  ctx.reply('Moderation Log:\n' + lines.join('\n'));
});

bot.command('spamlog', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const log = getSpamLog(ctx.chat.id, 10);
  if (!log.length) return ctx.reply('No spam actions recorded.');

  const lines = log.map(e => {
    const time = new Date(e.timestamp).toISOString().slice(5, 16).replace('T', ' ');
    const del = e.messageDeleted ? ' [deleted]' : '';
    return `${time} ${e.action.toUpperCase()} user:${e.userId} — ${e.reason}${del}`;
  });
  ctx.reply('Spam Log:\n' + lines.join('\n'));
});

// ============ Behavior Flags ============
// Runtime-configurable behavioral toggles. Persisted to data/behavior.json.

bot.command('behavior', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  ctx.reply('Behavior flags:\n' + listFlags());
});

bot.command('setbehavior', async (ctx) => {
  if (ctx.from.id !== config.ownerUserId) return ctx.reply('Owner only.');
  const args = ctx.message.text.split(/\s+/).slice(1);
  if (args.length < 2) return ctx.reply('Usage: /setbehavior <flag> <true|false>\n\nFlags:\n' + listFlags());
  const key = args[0];
  const val = args[1].toLowerCase();
  if (val !== 'true' && val !== 'false') return ctx.reply('Value must be true or false.');
  const ok = await setFlag(key, val === 'true');
  if (!ok) return ctx.reply(`Unknown flag: ${key}`);
  ctx.reply(`${key} = ${val}`);
});

// ============ The Ark — Emergency Recovery ============
// If the main group is ever deleted, Jarvis DMs every active user an invite link to the Ark.

bot.command('ark', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);

  if (!config.arkGroupId) {
    return ctx.reply('Ark group not configured. Set ARK_GROUP_ID in .env.');
  }

  ctx.reply('Launching the Ark. Creating invite link and notifying all active users...');

  try {
    // Create a permanent invite link for the Ark
    const invite = await bot.telegram.createChatInviteLink(config.arkGroupId, {
      name: 'VibeSwap Ark — Emergency Recovery',
      creates_join_request: false,
    });

    const inviteLink = invite.invite_link;

    // Get all tracked users from tracker
    const allUsers = getAllUsers();
    const userIds = Object.keys(allUsers).map(Number);

    let sent = 0;
    let failed = 0;

    for (const userId of userIds) {
      // Skip bots and the owner (owner already knows)
      if (userId === config.ownerUserId) continue;

      try {
        await bot.telegram.sendMessage(userId,
          `The VibeSwap community chat was disrupted. We've activated the Ark — the backup channel.\n\n` +
          `Join here: ${inviteLink}\n\n` +
          `Your contributions and history are safe. See you inside.`
        );
        sent++;
        // Rate limit: Telegram allows ~30 msgs/sec to different users
        await new Promise(r => setTimeout(r, 50));
      } catch {
        failed++;
      }
    }

    ctx.reply(`Ark deployed. Invite sent to ${sent} users (${failed} unreachable — they haven't DMed Jarvis before).`);
  } catch (err) {
    ctx.reply(`Ark failed: ${err.message}. Make sure Jarvis is admin of the Ark group.`);
  }
});

// ============ Digest Commands ============

bot.command('digest', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  ctx.reply('Generating daily digest...');
  const digest = await generateDigest(ctx.chat.id);
  if (digest) {
    ctx.reply(digest);
  } else {
    ctx.reply('No activity to report today.');
  }
});

bot.command('weeklydigest', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  ctx.reply('Generating weekly digest...');
  const digest = await generateWeeklyDigest(ctx.chat.id);
  if (digest) {
    ctx.reply(digest);
  } else {
    ctx.reply('No activity this week.');
  }
});

// ============ Thread Archival Commands ============

bot.command('archive', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const result = await archiveThread(ctx.chat.id, ctx.chat.title, ctx.from.id);
  if (result.success) {
    const t = result.thread;
    ctx.reply(
      `Thread archived.\n` +
      `ID: ${t.id}\n` +
      `Messages: ${t.messageCount} from ${t.participants.length} participants\n` +
      `Topics: ${t.topics.join(', ') || 'general'}\n` +
      `Summary: ${t.summary}`
    );
  } else {
    ctx.reply(result.error);
  }
});

bot.command('threads', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const recent = getRecentThreads(ctx.chat.id, 5);
  if (!recent.length) return ctx.reply('No archived threads yet. Use /archive to save a conversation.');

  const lines = ['Archived threads:'];
  for (const t of recent) {
    const date = new Date(t.timestamp).toISOString().split('T')[0];
    lines.push(`  ${t.id} — ${date} — ${t.messageCount} msgs — ${t.topics.join(', ') || 'general'}`);
  }

  const stats = getThreadStats();
  lines.push('');
  lines.push(`Total: ${stats.totalArchived} threads, ${stats.totalMessages} messages, ${stats.totalParticipants} participants`);

  ctx.reply(lines.join('\n'));
});

// ============ Intelligence Stats Command ============

bot.command('brain', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const stats = getIntelligenceStats();
  const lines = [
    'JARVIS Intelligence',
    '',
    `Proactive engagements this hour: ${stats.engagementsThisHour}/${stats.maxPerHour}`,
    `Last engagement: ${stats.lastEngageTime}`,
    `Last moderation: ${stats.lastModerateTime}`,
    `Cooldown remaining: ${Math.round(stats.cooldownRemaining / 1000)}s`,
  ];
  ctx.reply(lines.join('\n'));
});

// ============ Learning Commands ============

bot.command('learned', async (ctx) => {
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const stats = await getLearningStats(userId, chatId);

  const lines = [
    'JARVIS Learning Engine',
    '',
    `Relationship: ${stats.knowledgeClass} (${stats.interactionCount} interactions)`,
    '',
    `Your CKB: ${stats.userFacts} facts (${stats.userTokens}/${stats.userBudget} tokens, ${stats.userUtilization})`,
    `Corrections: ${stats.userCorrections}`,
    '',
    `Group CKB: ${stats.groupFacts} facts (${stats.groupTokens}/${stats.groupBudget} tokens)`,
    `Group norms: ${stats.groupNorms}`,
    '',
    `Network skills: ${stats.globalSkills} (${stats.confirmedSkills} confirmed, ${stats.skillTokens}/${stats.skillBudget} tokens)`,
  ];
  ctx.reply(lines.join('\n'));
});

bot.command('knowledge', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const arg = ctx.message.text.replace('/knowledge', '').trim();

  if (arg === 'group') {
    const summary = await getGroupKnowledgeSummary(ctx.chat.id);
    if (!summary) return ctx.reply('No group knowledge learned yet.');

    const lines = [`Group Knowledge (${summary.occupation}/${summary.budget} tokens):`];
    for (const fact of summary.facts) {
      const age = Math.floor((Date.now() - new Date(fact.created).getTime()) / 86400000);
      lines.push(`  [${fact.category}] ${fact.content} (${age}d ago, x${fact.confirmed})`);
    }
    if (summary.norms.length > 0) {
      lines.push('');
      lines.push('Norms:');
      for (const norm of summary.norms) {
        lines.push(`  - ${norm}`);
      }
    }
    return ctx.reply(lines.join('\n'));
  }

  // Default: show user knowledge
  const summary = await getUserKnowledgeSummary(ctx.from.id);
  if (!summary) return ctx.reply('No personal knowledge learned yet. Just keep talking.');

  const lines = [
    `Your Knowledge Profile (${summary.occupation}/${summary.budget} tokens):`,
  ];
  for (const fact of summary.facts) {
    const age = Math.floor((Date.now() - new Date(fact.created).getTime()) / 86400000);
    const classTag = fact.knowledgeClass === 'common' ? 'C' : fact.knowledgeClass === 'mutual' ? 'M' : 'S';
    lines.push(`  [${classTag}|${fact.category}] ${fact.content} (vd:${fact.valueDensity}, ${fact.decayPercent}% decayed, x${fact.confirmed})`);
  }
  if (summary.corrections.length > 0) {
    lines.push('');
    lines.push('Recent corrections:');
    for (const c of summary.corrections.slice(-5)) {
      lines.push(`  ${c.what_is_right?.slice(0, 80) || 'N/A'}`);
    }
  }
  ctx.reply(lines.join('\n'));
});

bot.command('skills', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const skills = getSkills();
  if (skills.length === 0) return ctx.reply('No skills learned yet. Correct me and I will learn.');

  const lines = ['Learned Skills (from corrections):'];
  for (const skill of skills) {
    const conf = skill.confirmations > 1 ? ` (confirmed x${skill.confirmations})` : ' (new)';
    lines.push(`  [${skill.id}] ${skill.lesson.slice(0, 100)}${conf}`);
  }
  ctx.reply(lines.join('\n'));
});

// ============ Privacy Command ============

bot.command('privacy', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const status = getPrivacyStatus();
  const lines = [
    'Privacy Fortress (Rosetta Stone Protocol)',
    '',
    `Encryption: ${status.enabled ? 'ENABLED' : 'DISABLED'}`,
    `Key loaded: ${status.keyLoaded ? 'yes' : 'no'}`,
    `Fingerprint: ${status.fingerprint}`,
    `Algorithm: ${status.algorithm}`,
    `Key derivation: ${status.keyDerivation}`,
    `PBKDF2 iterations: ${status.pbkdf2Iterations}`,
    '',
    'Per-user CKBs: AES-256-GCM (per-user derived key)',
    'Per-group CKBs: AES-256-GCM (per-group derived key)',
    'Skills: HMAC-SHA256 integrity verification',
    'Corrections log: HMAC signed',
    '',
    'At rest: encrypted. In memory: decrypted (compute-to-data).',
    'Knowledge never leaves its encryption boundary.',
  ];
  ctx.reply(lines.join('\n'));
});

// ============ Inner Dialogue Command ============

bot.command('inner', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const stats = getDialogueStats();
  const recent = getRecentDialogue(8);

  const lines = [
    'JARVIS Inner Dialogue (Self-Reflection)',
    '',
    `Entries: ${stats.totalEntries} (${stats.totalTokens}/${stats.budget} tokens, ${stats.utilization})`,
    `Promoted to network: ${stats.promotedToNetwork}`,
    '',
  ];

  if (stats.totalEntries > 0) {
    lines.push('Categories:');
    for (const [cat, count] of Object.entries(stats.categoryCounts)) {
      lines.push(`  ${cat}: ${count}`);
    }
    lines.push('');
  }

  if (recent.length > 0) {
    lines.push('Recent:');
    for (const entry of recent) {
      const age = Math.floor((Date.now() - new Date(entry.created).getTime()) / (60 * 60 * 1000));
      const ageLabel = age < 1 ? 'just now' : age < 24 ? `${age}h ago` : `${Math.floor(age / 24)}d ago`;
      lines.push(`  [${ageLabel}] [${entry.category}] ${entry.thought.slice(0, 120)}`);
    }
  } else {
    lines.push('No inner dialogue entries yet. Self-reflection begins after first flush cycle.');
  }

  ctx.reply(lines.join('\n'));
});

// ============ Shard / Network Commands ============

bot.command('shard', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const info = getShardInfo();
  const lines = [
    'JARVIS Shard Identity',
    '',
    `Shard ID: ${info.id}`,
    `Mode: ${info.totalShards > 1 ? 'MULTI-SHARD' : 'SINGLE-SHARD'}`,
    `Status: ${info.status}`,
    `State backend: ${info.capabilities.stateBackend}`,
    `Encryption: ${info.capabilities.encryption ? 'enabled' : 'disabled'}`,
    `Model: ${info.capabilities.model}`,
    `Load: ${info.load}%`,
    `Local users: ${info.localUsers}`,
    `Peers: ${info.peers}`,
    `Uptime: ${Math.round(info.uptime / 60)}m`,
    `Memory: ${info.memory}MB`,
  ];
  ctx.reply(lines.join('\n'));
});

bot.command('network', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const topo = getTopology();
  const archives = getArchiveStatus();
  const consensus = getConsensusState();
  const crpc = getCRPCStats();
  const kchain = getChainStats();

  const lines = [
    'JARVIS Mind Network',
    '',
    `Shards: ${topo.runningShards} active, ${topo.downShards} down`,
    `Total users: ${topo.totalUsers}`,
    `Network health: ${topo.networkHealth.healthy ? 'HEALTHY' : 'DEGRADED'}`,
    '',
  ];

  if (topo.shards.length > 0) {
    for (const shard of topo.shards) {
      const uptimeStr = shard.uptime > 86400
        ? `${Math.floor(shard.uptime / 86400)}d ${Math.floor((shard.uptime % 86400) / 3600)}h`
        : shard.uptime > 3600
        ? `${Math.floor(shard.uptime / 3600)}h ${Math.floor((shard.uptime % 3600) / 60)}m`
        : `${Math.floor(shard.uptime / 60)}m`;
      lines.push(`  ${shard.shardId} (${shard.nodeType}): ${shard.userCount} users, ${shard.load}% load, uptime ${uptimeStr} [${shard.status}]`);
    }
    lines.push('');
  }

  lines.push(`Archive nodes: ${archives.running}/${archives.minimum} minimum (${archives.healthy ? 'healthy' : 'BELOW MINIMUM'})`);
  lines.push('');
  lines.push(`BFT Consensus: ${consensus.enabled ? 'ENABLED' : 'single-shard'} | ${consensus.committedTotal} committed | ${consensus.pendingProposals} pending`);
  lines.push(`CRPC: ${crpc.enabled ? 'ENABLED' : 'disabled'} | ${crpc.completedTasks} rounds | avg confidence: ${crpc.avgConfidence}`);
  lines.push(`Knowledge Chain: height ${kchain.height} | ${kchain.pendingChanges} pending changes`);
  if (kchain.head) {
    lines.push(`  Head: ${kchain.head.hash.slice(0, 12)}... | cumVD: ${kchain.head.cumulativeValueDensity.toFixed(3)}`);
  }

  ctx.reply(lines.join('\n'));
});

// ============ Mine — Launch Shard Miner Mini App ============

bot.command('mine', async (ctx) => {
  const webAppUrl = process.env.WEBAPP_URL || `https://jarvis-vibeswap.fly.dev/app/`;
  const isPrivate = ctx.chat.type === 'private';

  if (isPrivate) {
    // DM: web_app button works in reply keyboard
    await ctx.reply(
      'Launch a Jarvis shard on your phone.\nMine JUL, join consensus, earn compute credits.',
      {
        reply_markup: {
          keyboard: [[
            { text: 'Launch Shard', web_app: { url: webAppUrl } }
          ]],
          resize_keyboard: true,
          one_time_keyboard: true,
        }
      }
    );
  } else {
    // Group: web_app buttons not allowed — send direct link + DM prompt
    const botUsername = ctx.botInfo?.username || 'JarvisVibeSwapBot';
    await ctx.reply(
      'Launch a Jarvis shard on your phone.\nMine JUL, join consensus, earn compute credits.\n\n' +
      `Tap to open: ${webAppUrl}\n\n` +
      `Or DM me @${botUsername} and type /mine for the full Mini App experience.`
    );
  }
});

// Handle data sent back when Mini App closes
bot.on('web_app_data', async (ctx) => {
  try {
    const data = JSON.parse(ctx.webAppData.data);
    if (data.type === 'mining_report') {
      await ctx.reply(
        `Mining session complete.\n` +
        `JUL mined: ${data.julMined?.toFixed(2) || 0}\n` +
        `Proofs submitted: ${data.proofsAccepted || 0}\n` +
        `Hashrate: ${data.hashrate || 0} H/s`
      );
    }
  } catch {
    // Silently ignore malformed data
  }
});

// ============ Balance — JUL + Compute Stats ============

bot.command('balance', async (ctx) => {
  const userId = String(ctx.from.id);
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
  const mining = getMiningStats(userId);
  const compute = getComputeStats(userId);
  const treasury = getTreasuryStats();
  const learningStats = await getLearningStats(userId, ctx.chat.id);

  const lines = [
    `Balance: ${userName}`,
    '',
    `JUL: ${mining.julBalance.toFixed(2)}`,
    `Proofs submitted: ${mining.proofsSubmitted}`,
    `Mining difficulty: ${mining.difficulty}`,
    '',
    'JUL Bridge:',
    `  Rate: 1 JUL = ${compute.pool.julToPoolRatio.toLocaleString()} tokens (CPI-adjusted)`,
    `  Burned today: ${treasury.dailyBurned.toFixed(2)} JUL`,
    `  Pool expansion: +${treasury.dailyPoolExpansion.toLocaleString()} tokens`,
    `  Effective pool: ${compute.pool.dailyPool.toLocaleString()} (${compute.pool.basePool.toLocaleString()} base + ${compute.pool.julBonus.toLocaleString()} JUL bonus)`,
    '',
  ];

  if (compute.user) {
    lines.push(`Shapley weight: ${compute.user.shapleyWeight}`);
    lines.push(`Compute budget: ${compute.user.remaining.toLocaleString()}/${compute.user.budget.toLocaleString()} tokens`);
    lines.push(`Compute used: ${compute.user.utilization}%`);
  }

  lines.push('');
  lines.push(`CKB: ${learningStats.userTokens}/${learningStats.userBudget} tokens (${learningStats.userUtilization})`);
  lines.push(`Facts: ${learningStats.userFacts} | Corrections: ${learningStats.userCorrections}`);
  lines.push(`Knowledge class: ${learningStats.knowledgeClass}`);

  ctx.reply(lines.join('\n'));
});

// ============ Economy — Pool-Level Compute Stats ============

bot.command('economy', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);

  const compute = getComputeStats(null);
  const mining = getLeaderboard(5);
  const treasury = getTreasuryStats();
  const pricing = getPricingInfo();

  const L0 = pricing.layer0;
  const L1 = pricing.layer1;

  const intel = getIntelligenceLevel();
  const chain = getFallbackChain();

  const lines = [
    'JOULE Economy',
    '',
    `Wardenclyffe: ${intel.quality}% intelligence (${intel.tierLabel} — ${intel.provider}/${intel.model})`,
    `  Cascade: ${chain.active?.name} → ${chain.remaining.map(p => p.name).join(' → ') || 'none'}`,
    `  Providers: ${chain.totalProviders} total | ${chain.remaining.length} fallbacks remaining`,
    intel.degraded
      ? `  DEGRADED since ${new Date(intel.degradedSince).toLocaleTimeString()} — tip jar refills restore premium quality`
      : '  Status: nominal (premium tier active)',
    '',
    `Pricing Oracle: 1 JUL = ${pricing.ratio.toLocaleString()} tokens`,
    `  Source: ${pricing.source}`,
    '',
    '  Layer 0 (trustless floor):',
    `    Ratio: ${L0.ratio.toLocaleString()} | Hash cost index: ${L0.hashCostIndex}`,
    `    Confidence: ${(L0.confidence * 100).toFixed(0)}% (${L0.epochsUsed} epochs)`,
    `    Difficulty: ${L0.difficulty} (ref: ${L0.referenceDifficulty}) | Trend: ${L0.trend}`,
    '',
    '  Layer 1 (CPI refinement):',
    `    Ratio: ${L1.ratio.toLocaleString()}`,
    `    API cost: $${L1.costPerMTok.toFixed(2)}/MTok (ref: $${L1.referenceCostPerMTok.toFixed(2)})`,
    `    CPI: ${L1.cpiIndex} (ref: ${L1.referenceCPI})${L1.lastUpdated ? ' | Updated: ' + new Date(L1.lastUpdated).toLocaleDateString() : ''}`,
    '',
    `  Divergence: ${pricing.divergence}%${pricing.circuitBroken ? ' — CIRCUIT BREAKER ACTIVE (Layer 0 wins)' : ''}`,
    '',
    'Compute Pool:',
    `  Base pool: ${compute.pool.basePool.toLocaleString()} tokens (Will subsidy)`,
    `  JUL bonus: +${compute.pool.julBonus.toLocaleString()} tokens (${treasury.dailyBurned.toFixed(2)} JUL burned × ${pricing.ratio.toLocaleString()})`,
    `  Effective pool: ${compute.pool.dailyPool.toLocaleString()} tokens`,
    `  Pool used: ${compute.pool.poolUsed.toLocaleString()} (${compute.pool.poolUtilization}%)`,
    `  Pool remaining: ${compute.pool.poolRemaining.toLocaleString()}`,
    '',
    'Network:',
    `  Active users today: ${compute.pool.activeUsers}`,
    `  Total users: ${compute.pool.totalUsers}`,
    '',
    'Treasury:',
    `  JUL burned today: ${treasury.dailyBurned.toFixed(2)}`,
    `  JUL burned all-time: ${treasury.totalBurned.toFixed(2)}`,
    `  Tips today: ${treasury.tipsToday} | All-time: ${treasury.tipsAllTime}`,
    '',
    `Mining: epoch ${mining.epoch}, difficulty ${mining.difficulty}`,
    `Total proofs: ${mining.totalProofs}`,
    `Active miners: ${mining.totalMiners}`,
    '',
  ];

  if (treasury.topTippers.length > 0) {
    lines.push('Top tippers (all-time):');
    for (const t of treasury.topTippers) {
      lines.push(`  ${t.userId} — ${t.totalTipped.toFixed(2)} JUL`);
    }
    lines.push('');
  }

  if (mining.leaderboard.length > 0) {
    lines.push('Top miners:');
    for (let i = 0; i < mining.leaderboard.length; i++) {
      const m = mining.leaderboard[i];
      lines.push(`  ${i + 1}. ${m.userId} — ${m.julBalance.toFixed(2)} JUL (${m.proofsSubmitted} proofs)`);
    }
  }

  ctx.reply(lines.join('\n'));
});

// ============ Tip — Tip Jar Address ============

bot.command('tip', async (ctx) => {
  const userId = String(ctx.from.id);
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
  const args = ctx.message.text.split(/\s+/).slice(1);
  const amount = parseFloat(args[0]);

  // /tip (no amount) — show info
  if (!args[0] || isNaN(amount)) {
    const mining = getMiningStats(userId);
    const treasury = getTreasuryStats();
    const compute = getComputeStats(userId);

    const lines = [
      'JUL Tip — Burn JUL to expand the compute pool',
      '',
      `Your JUL balance: ${mining.julBalance.toFixed(2)}`,
      `Burned today (network): ${treasury.dailyBurned.toFixed(2)} JUL`,
      `Pool expansion: +${treasury.dailyPoolExpansion.toLocaleString()} tokens`,
      `Effective pool: ${compute.pool.dailyPool.toLocaleString()} tokens`,
      '',
      'How it works:',
      '  /tip <amount> — burn JUL to expand the pool for everyone',
      '  1 JUL burned = 1,000 extra API tokens in the daily pool',
      '  Work in, access out. No money needed.',
      '',
      `All-time burned: ${treasury.totalBurned.toFixed(2)} JUL`,
    ];
    return ctx.reply(lines.join('\n'));
  }

  // /tip <amount> — burn JUL
  if (amount <= 0) {
    return ctx.reply('Tip amount must be positive.');
  }

  const result = tipJUL(userId, amount);

  if (!result.success) {
    if (result.reason === 'insufficient_balance') {
      return ctx.reply(`Not enough JUL. Balance: ${result.balance.toFixed(2)} JUL. Mine more with /mine.`);
    }
    return ctx.reply('Tip failed. Try again.');
  }

  const lines = [
    `${userName} tipped ${amount.toFixed(2)} JUL`,
    '',
    `Pool expanded by ${result.poolExpansion.toLocaleString()} tokens`,
    `Daily JUL burned: ${result.dailyBurned.toFixed(2)}`,
    `Your remaining balance: ${result.newBalance.toFixed(2)} JUL`,
    '',
    'The entire network benefits. Work in, access out.',
  ];

  // Wardenclyffe: attempt to restore premium provider after tip
  const intel = getIntelligenceLevel();
  if (intel.degraded) {
    const restore = tryRestorePrimary();
    if (restore.restored) {
      lines.push('');
      lines.push(`Wardenclyffe: Premium intelligence restored (${restore.provider}/${restore.model})`);
      lines.push('Intelligence: 100% — tip jar refilled credits.');
    }
  }

  ctx.reply(lines.join('\n'));
});

// ============ Reprice — JUL Pricing Oracle ============

bot.command('reprice', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);

  const args = ctx.message.text.split(/\s+/).slice(1);

  // /reprice (no args) — show current pricing
  if (args.length === 0) {
    const p = getPricingInfo();
    return ctx.reply(
      `JUL Pricing Oracle (Floor/Ceiling Convergence)\n\n` +
      `Final ratio: 1 JUL = ${p.ratio.toLocaleString()} tokens\n` +
      `Source: ${p.source}\n\n` +
      `Layer 0 (trustless floor):\n` +
      `  Ratio: ${p.layer0.ratio.toLocaleString()} | Hash cost: ${p.layer0.hashCostIndex}\n` +
      `  Confidence: ${(p.layer0.confidence * 100).toFixed(0)}% | Trend: ${p.layer0.trend}\n\n` +
      `Layer 1 (CPI refinement):\n` +
      `  Ratio: ${p.layer1.ratio.toLocaleString()}\n` +
      `  API: $${p.layer1.costPerMTok.toFixed(2)}/MTok | CPI: ${p.layer1.cpiIndex}\n\n` +
      `Divergence: ${p.divergence}%${p.circuitBroken ? ' — CIRCUIT BREAKER' : ''}\n\n` +
      `Usage:\n` +
      `  /reprice cost <$/MTok> — update API cost (Layer 1)\n` +
      `  /reprice cpi <index> — update CPI index (Layer 1)\n` +
      `  /reprice cost 1.50 cpi 103 — update both\n\n` +
      `Layer 0 adjusts automatically from mining data.`
    );
  }

  // Parse key-value pairs
  let costPerMTok, cpiIndex;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === 'cost' && args[i + 1]) {
      costPerMTok = parseFloat(args[++i]);
    } else if (args[i] === 'cpi' && args[i + 1]) {
      cpiIndex = parseFloat(args[++i]);
    }
  }

  if ((costPerMTok !== undefined && (isNaN(costPerMTok) || costPerMTok <= 0)) ||
      (cpiIndex !== undefined && (isNaN(cpiIndex) || cpiIndex <= 0))) {
    return ctx.reply('Invalid values. Cost and CPI must be positive numbers.');
  }

  if (costPerMTok === undefined && cpiIndex === undefined) {
    return ctx.reply('Usage: /reprice cost <$/MTok> | /reprice cpi <index> | /reprice cost <x> cpi <y>');
  }

  const result = updatePricing({ costPerMTok, cpiIndex });

  ctx.reply(
    `Pricing updated.\n\n` +
    `API cost: $${result.costPerMTok.toFixed(2)}/MTok\n` +
    `CPI index: ${result.cpiIndex}\n` +
    `New ratio: 1 JUL = ${result.ratio.toLocaleString()} tokens\n` +
    `Effective pool: ${result.effectivePool.toLocaleString()} tokens\n\n` +
    `Shapley budgets recomputed.`
  );
});

// ============ Spawn Shard (One-Click via Telegram) ============

bot.command('spawnshard', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);

  const args = ctx.message.text.split(/\s+/).slice(1);
  const shardName = args[0];
  const nodeType = args[1] || 'light';

  if (!shardName) {
    return ctx.reply(
      'Usage: /spawnshard <name> [node_type]\n\n' +
      'Examples:\n' +
      '  /spawnshard alpha\n' +
      '  /spawnshard bravo full\n' +
      '  /spawnshard node-42 archive\n\n' +
      'Node types: light (cheapest), full (retains history), archive (pure storage)\n\n' +
      'This creates a new worker shard on Fly.io that auto-registers with the network.'
    );
  }

  if (!['light', 'full', 'archive'].includes(nodeType)) {
    return ctx.reply(`Invalid node type "${nodeType}". Use: light, full, or archive`);
  }

  const appName = `jarvis-shard-${shardName}`;
  const shardId = `shard-${shardName}`;
  const region = 'iad';

  ctx.reply(`Spawning ${appName} (${nodeType} node) in ${region}...`);

  try {
    // Step 1: Create app
    try {
      await execFileAsync('fly', ['apps', 'create', appName, '--org', 'personal'], { timeout: 30000 });
      ctx.reply(`App ${appName} created.`);
    } catch (e) {
      if (e.stderr?.includes('already exists')) {
        ctx.reply(`App ${appName} already exists, continuing...`);
      } else throw e;
    }

    // Step 2: Create volume
    try {
      await execFileAsync('fly', ['volumes', 'create', 'jarvis_data', '--size', '1', '--region', region, '--app', appName, '--yes'], { timeout: 30000 });
      ctx.reply('Volume created (1GB).');
    } catch (e) {
      if (e.stderr?.includes('already exists')) {
        ctx.reply('Volume already exists, continuing...');
      } else throw e;
    }

    // Step 3: Set secrets (use the same Anthropic key as this shard)
    const apiKey = config.anthropic.apiKey;
    await execFileAsync('fly', ['secrets', 'set', `ANTHROPIC_API_KEY=${apiKey}`, `SHARD_ID=${shardId}`, '--app', appName], { timeout: 30000 });
    ctx.reply('Secrets configured.');

    // Step 4: Generate fly.toml for this shard
    const currentShards = (config.shard?.totalShards || 1) + 1;
    const routerUrl = 'https://jarvis-vibeswap.fly.dev';
    const model = config.anthropic.model || 'claude-sonnet-4-5-20250929';

    const tomlContent = [
      `# JARVIS Mind Network — Worker Shard: ${shardName}`,
      `# Auto-spawned via /spawnshard command`,
      '',
      `app = '${appName}'`,
      `primary_region = '${region}'`,
      '',
      '[build]',
      `  image = 'ghcr.io/wglynn/jarvis-shard:latest'`,
      '',
      '[env]',
      `  DATA_DIR = '/app/data'`,
      `  DOCKER = '1'`,
      `  ENCRYPTION_ENABLED = 'true'`,
      `  NODE_ENV = 'production'`,
      `  HEALTH_PORT = '8080'`,
      `  SHARD_MODE = 'worker'`,
      `  TOTAL_SHARDS = '${currentShards}'`,
      `  NODE_TYPE = '${nodeType}'`,
      `  ROUTER_URL = '${routerUrl}'`,
      `  CLAUDE_MODEL = '${model}'`,
      '',
      '[[mounts]]',
      `  source = 'jarvis_data'`,
      `  destination = '/app/data'`,
      '',
      '[http_service]',
      '  internal_port = 8080',
      '  force_https = true',
      `  auto_stop_machines = 'off'`,
      '  auto_start_machines = true',
      '',
      '[checks]',
      '  [checks.health]',
      '    port = 8080',
      `    type = 'http'`,
      `    interval = '1m0s'`,
      `    timeout = '10s'`,
      `    path = '/health'`,
      '',
      '[[restart]]',
      `  policy = 'always'`,
      '  max_retries = 10',
      '',
      '[[vm]]',
      `  size = 'shared-cpu-1x'`,
      `  memory = '256mb'`,
    ].join('\n');

    const tomlPath = join(config.dataDir, `fly-${shardName}.toml`);
    await writeFile(tomlPath, tomlContent);

    // Step 5: Deploy
    ctx.reply('Deploying shard (this takes ~60 seconds)...');
    await execFileAsync('fly', ['deploy', '--config', tomlPath, '--app', appName], { timeout: 300000 });

    // Step 6: Verify health
    await new Promise(r => setTimeout(r, 5000));
    try {
      const healthRes = await fetch(`https://${appName}.fly.dev/health`, { signal: AbortSignal.timeout(10000) });
      const health = await healthRes.json();
      ctx.reply(
        `Shard ${shardId} is LIVE\n\n` +
        `App: https://${appName}.fly.dev\n` +
        `Health: ${health.status}\n` +
        `Type: ${nodeType}\n` +
        `Region: ${region}\n\n` +
        `Monitor: fly logs --app ${appName}\n` +
        `Destroy: fly apps destroy ${appName}`
      );
    } catch {
      ctx.reply(
        `Shard deployed but health check pending.\n\n` +
        `App: https://${appName}.fly.dev\n` +
        `Check: fly status --app ${appName}\n` +
        `Logs: fly logs --app ${appName}`
      );
    }
  } catch (err) {
    ctx.reply(`Shard deployment failed: ${err.message}\n\nCheck: fly logs --app ${appName}`);
  }
});

// ============ Health Check ============

bot.command('health', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const report = await diagnoseContext();
  const lines = [
    'JARVIS Health Check',
    '',
    `Context loaded: ${report.loaded.length}/${report.loaded.length + report.missing.length} files (${report.totalChars} chars)`,
  ];
  if (report.missing.length > 0) {
    lines.push(`Missing: ${report.missing.join(', ')}`);
  }
  lines.push(`Model: ${config.anthropic.model}`);
  ctx.reply(lines.join('\n'));
});

// ============ Continuous Context ============

bot.command('context', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const stats = getContextMemoryStats();
  const lines = [
    'Continuous Context Memory',
    '',
    `Chats with memory: ${stats.totalChats}`,
    `Total messages summarized: ${stats.totalMessages}`,
    `Total summary size: ${stats.totalSummaryChars} chars`,
  ];
  for (const s of stats.summaries) {
    lines.push(`\nChat ${s.chatId}:`);
    lines.push(`  Messages: ${s.messageCount} | Summary: ${s.summaryLength} chars | v${s.version}`);
    lines.push(`  Last updated: ${s.lastUpdated}`);
  }
  if (stats.totalChats === 0) {
    lines.push('\nNo summaries yet — context will build as conversations grow beyond 40 messages.');
  }
  ctx.reply(lines.join('\n'));
});

// ============ Limni — Trading Terminal Monitoring ============

bot.command('trades', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const stats = getLimniStats();
  const lines = [
    'Limni Trading Monitor',
    '',
    `Terminals: ${stats.terminals.length} registered`,
  ];
  for (const t of stats.terminals) {
    lines.push(`  ${t.id}: ${t.status} (${t.operator}) — ${t.strategies.length} strategies`);
  }
  lines.push('');
  lines.push(`Trades: ${stats.totalTrades} total (${stats.validTrades} valid, ${stats.invalidTrades} invalid)`);
  lines.push(`Alerts: ${stats.alertsSent} sent (${stats.pendingAlerts} pending)`);
  lines.push(`Strategies: ${stats.strategies.length} registered`);
  for (const s of stats.strategies) {
    lines.push(`  ${s.id}: ${s.name} (${s.operator})`);
  }
  lines.push('');
  lines.push(`VPS: ${stats.vps.length} monitored`);
  for (const v of stats.vps) {
    lines.push(`  ${v.id}: ${v.status} (${v.host})`);
  }
  lines.push(`Backtests: ${stats.backtestCount}`);
  ctx.reply(lines.join('\n'));
});

bot.command('strategy', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const args = ctx.message.text.split(' ').slice(1);
  const strategyId = args[0];
  if (!strategyId) {
    const strats = listStrategies();
    if (strats.length === 0) return ctx.reply('No strategies registered.');
    const lines = ['Registered Strategies:', ''];
    for (const s of strats) {
      lines.push(`${s.id} (${s.version}) — ${s.name} [${s.operator}]`);
    }
    lines.push('\nUse /strategy <id> for details.');
    return ctx.reply(lines.join('\n'));
  }
  const s = getStrategy(strategyId);
  if (!s) return ctx.reply(`Strategy '${strategyId}' not found.`);
  ctx.reply(JSON.stringify(s, null, 2).slice(0, 4000));
});

bot.command('vps', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const results = await checkAllVPS();
  const lines = ['VPS Health Check:', ''];
  for (const [id, r] of Object.entries(results)) {
    lines.push(`${id}: ${r.status}${r.error ? ` — ${r.error}` : ''}${r.failures ? ` (${r.failures} consecutive failures)` : ''}`);
  }
  if (Object.keys(results).length === 0) lines.push('No VPS registered. Use Jarvis tools to add one.');
  ctx.reply(lines.join('\n'));
});

bot.command('backtests', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const bts = listBacktests();
  if (bts.length === 0) return ctx.reply('No backtests yet. Use the strategy pipeline to create one.');
  const lines = ['Backtest Results:', ''];
  for (const b of bts.slice(-10)) {
    lines.push(`${b.backtestId.slice(0, 25)}: ${b.strategyName || b.strategyId} → ${b.returnPct >= 0 ? '+' : ''}${b.returnPct}% (${b.winRate}% win, ${b.maxDD}% DD, ${b.trades} trades)`);
  }
  ctx.reply(lines.join('\n'));
});

bot.command('alerts', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  const alerts = getAlerts(10);
  if (alerts.length === 0) return ctx.reply('No recent alerts.');
  const lines = ['Recent Alerts:', ''];
  for (const a of alerts) {
    const time = new Date(a.timestamp).toISOString().slice(11, 19);
    lines.push(`[${time}] ${a.type}: ${a.message}`);
  }
  ctx.reply(lines.join('\n'));
});

// ============ Recovery ============

bot.command('recover', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  ctx.reply('Starting full context recovery...');

  try {
    // Step 1: Force git pull
    const pullResult = await gitPull();

    // Step 2: Reload system prompt from fresh files
    await reloadSystemPrompt();

    // Step 3: Re-diagnose
    const report = await diagnoseContext();

    const lines = [
      'Recovery complete.',
      '',
      `Git: ${pullResult}`,
      `Context: ${report.loaded.length}/${report.loaded.length + report.missing.length} files (${report.totalChars} chars)`,
    ];
    if (report.missing.length > 0) {
      lines.push(`Still missing: ${report.missing.join(', ')}`);
    }
    lines.push(`Model: ${config.anthropic.model}`);
    ctx.reply(lines.join('\n'));
  } catch (err) {
    ctx.reply(`Recovery failed: ${err.message}`);
  }
});

// ============ Backlog ============

const BACKLOG_FILE = join(config.dataDir, 'backlog.json');

async function loadBacklog() {
  try {
    const data = await readFile(BACKLOG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveBacklog(items) {
  await writeFile(BACKLOG_FILE, JSON.stringify(items, null, 2));
}

bot.command('backlog', async (ctx) => {
  const args = ctx.message.text.replace('/backlog', '').trim();

  // /backlog — list all open items
  if (!args) {
    const items = await loadBacklog();
    const open = items.filter(i => i.status === 'open' || i.status === 'accepted');
    if (open.length === 0) return ctx.reply('Backlog is empty.');

    const lines = open.map(i =>
      `#${i.id.replace('backlog-', '')} [${i.status}] ${i.author}: ${i.suggestion.slice(0, 80)}${i.suggestion.length > 80 ? '...' : ''}`
    );
    return ctx.reply(`Backlog (${open.length} items):\n\n${lines.join('\n')}`);
  }

  // /backlog 003 — view specific item
  const idMatch = args.match(/^(\d+)$/);
  if (idMatch) {
    const items = await loadBacklog();
    const id = `backlog-${idMatch[1].padStart(3, '0')}`;
    const item = items.find(i => i.id === id);
    if (!item) return ctx.reply(`Item ${id} not found.`);

    return ctx.reply(
      `#${item.id} [${item.status}]\n` +
      `Author: ${item.author}\n` +
      `Tags: ${item.tags.join(', ')}\n\n` +
      `${item.suggestion}\n\n` +
      `Jarvis: ${item.jarvis_take}`
    );
  }

  // /backlog add <suggestion> — add new item from chat
  if (args.startsWith('add ')) {
    const suggestion = args.slice(4).trim();
    if (suggestion.length < 10) return ctx.reply('Too short. Give me a real suggestion.');

    const items = await loadBacklog();
    const nextNum = items.length + 1;
    const id = `backlog-${String(nextNum).padStart(3, '0')}`;
    const author = ctx.from.username || ctx.from.first_name || 'Unknown';

    // Get Jarvis's take via Claude
    await ctx.sendChatAction('typing');
    let jarvisTake = '';
    try {
      const prompt = `Evaluate this suggestion for VibeSwap in 2-3 sentences. Be direct — is it strong, weak, or redundant? How does it map to existing architecture?\n\nSuggestion: "${suggestion}"`;
      const response = await chat(ctx.chat.id, 'backlog-eval', prompt, 'private');
      jarvisTake = response.text || 'No assessment available.';
    } catch {
      jarvisTake = 'Assessment failed — will review later.';
    }

    const newItem = {
      id,
      timestamp: new Date().toISOString(),
      source: 'telegram',
      author,
      suggestion,
      status: 'open',
      tags: [],
      jarvis_take: jarvisTake,
    };

    items.push(newItem);
    await saveBacklog(items);

    return ctx.reply(
      `Added #${id}\n\n` +
      `${suggestion.slice(0, 120)}${suggestion.length > 120 ? '...' : ''}\n\n` +
      `Jarvis: ${jarvisTake}`
    );
  }

  // /backlog close 003 — close an item
  if (args.startsWith('close ')) {
    if (!isOwner(ctx)) return ownerOnly(ctx);
    const num = args.replace('close ', '').trim();
    const id = `backlog-${num.padStart(3, '0')}`;
    const items = await loadBacklog();
    const item = items.find(i => i.id === id);
    if (!item) return ctx.reply(`Item ${id} not found.`);
    item.status = 'closed';
    await saveBacklog(items);
    return ctx.reply(`Closed #${id}: ${item.suggestion.slice(0, 60)}...`);
  }

  ctx.reply('Usage:\n/backlog — list open items\n/backlog 003 — view item\n/backlog add <suggestion> — add new\n/backlog close 003 — close item');
});

// ============ Group Monitor (MTProto) ============

bot.command('monitor_setup', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  if (!monitorAvailable) return ctx.reply('Monitor module not loaded. Run npm install to add GramJS.');
  await interactiveAuth(ctx, bot);
});

bot.command('monitor', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  if (!monitorAvailable) return ctx.reply('Monitor module not loaded. Run npm install to add GramJS.');
  const arg = ctx.message.text.replace('/monitor', '').trim();

  if (arg === 'status') {
    return ctx.reply(getMonitorStatus());
  }

  if (arg === 'start') {
    startPolling();
    return ctx.reply('Monitor polling started.');
  }

  if (arg === 'stop') {
    stopPolling();
    return ctx.reply('Monitor polling stopped.');
  }

  ctx.reply('Usage:\n/monitor status — connection & group stats\n/monitor start — start polling\n/monitor stop — stop polling\n/monitor_setup — authenticate MTProto');
});

bot.command('intel', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  if (!monitorAvailable) return ctx.reply('Monitor module not loaded.');
  const arg = ctx.message.text.replace('/intel', '').trim();
  const group = arg || MONITORED_GROUPS[0] || 'NervosNation';

  const report = formatIntelReport(group);

  if (report.length <= 4096) {
    await ctx.reply(report, { parse_mode: undefined });
  } else {
    // Split long intel reports
    for (let i = 0; i < report.length; i += 4096) {
      await ctx.reply(report.slice(i, i + 4096), { parse_mode: undefined });
    }
  }
});

bot.command('analyze_intel', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  if (!monitorAvailable) return ctx.reply('Monitor module not loaded.');
  const arg = ctx.message.text.replace('/analyze_intel', '').trim();
  const group = arg || MONITORED_GROUPS[0] || 'NervosNation';

  const messages = getMessagesForAnalysis(group, 50);
  if (messages.length === 0) {
    return ctx.reply(`No messages from ${group} to analyze.`);
  }

  await ctx.sendChatAction('typing');

  const transcript = messages.map(m => {
    const time = new Date(m.date * 1000).toISOString().slice(11, 16);
    return `[${time}] ${m.sender}: ${m.text}`;
  }).join('\n');

  const prompt =
    `Analyze these recent messages from the ${group} Telegram group.\n` +
    `Identify: key topics discussed, sentiment, any mentions of VibeSwap or related projects, ` +
    `actionable insights, and potential collaboration opportunities.\n` +
    `Be concise.\n\n${transcript}`;

  try {
    const response = await chat(ctx.chat.id, 'intel-analyst', prompt, 'private');
    await ctx.reply(`Intel Analysis — ${group}:\n\n${response.text}`, { parse_mode: undefined });
  } catch (err) {
    await ctx.reply(`Analysis failed: ${err.message}`);
  }
});

// ============ Idea-to-Code Pipeline ============

bot.command('idea', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);

  const ideaText = ctx.message.text.replace('/idea', '').trim();
  if (!ideaText || ideaText.length < 20) {
    return ctx.reply(
      'Usage: /idea <description of your idea>\n\n' +
      'Describe what you want to build. Jarvis will:\n' +
      '1. Analyze the idea\n' +
      '2. Generate code drafts\n' +
      '3. Create a branch and push\n' +
      '4. Give you a summary\n\n' +
      'Example: /idea Add a reputation-weighted voting system where LP providers with higher trust tiers get quadratic vote weight'
    );
  }

  const author = ctx.from.username || ctx.from.first_name || 'Unknown';
  const slug = ideaText.slice(0, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
  const branch = `idea/${slug}`;

  await ctx.reply(`Processing idea from @${author}...\n\nCreating branch: ${branch}`);
  await ctx.sendChatAction('typing');

  try {
    // 1. Create branch
    const branchResult = await gitCreateBranch(branch);
    if (!branchResult.ok) {
      await gitReturnToMaster();
      return ctx.reply(`Failed to create branch: ${branchResult.error}`);
    }

    // 2. Generate code with Claude
    const { text, filesWritten } = await codeGenChat(ideaText, author);

    if (filesWritten.length === 0) {
      await gitReturnToMaster();
      return ctx.reply(`Jarvis analyzed the idea but didn't generate files:\n\n${text.slice(0, 1500)}`);
    }

    // 3. Commit and push
    const commitMsg = `idea: ${ideaText.slice(0, 72)}\n\nAuthor: @${author} (via Telegram)\nFiles: ${filesWritten.join(', ')}`;
    const pushResult = await gitCommitAndPushBranch(commitMsg, branch);

    // 4. Return to master
    await gitReturnToMaster();

    // 5. Report back
    const fileList = filesWritten.map(f => `  - ${f}`).join('\n');
    const summary = text.length > 800 ? text.slice(0, 800) + '...' : text;

    await ctx.reply(
      `Idea drafted and pushed!\n\n` +
      `Branch: ${branch}\n` +
      `Files (${filesWritten.length}):\n${fileList}\n\n` +
      `${pushResult}\n\n` +
      `Summary:\n${summary}\n\n` +
      `Create a PR at: https://github.com/wglynn/vibeswap/compare/${branch}?expand=1`
    );

    // Track the contribution
    await trackMessage(ctx);

  } catch (error) {
    await gitReturnToMaster();
    ctx.reply(`Idea generation failed: ${error.message}`);
  }
});

// ============ Sticker Generator ============

bot.command('sticker', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);

  const args = ctx.message.text.replace(/^\/sticker(@\w+)?/, '').trim();

  // Check if replying to a photo — image-to-sticker mode
  const replyPhoto = ctx.message.reply_to_message?.photo;
  const replyText = args || ctx.message.reply_to_message?.text || ctx.message.reply_to_message?.caption;

  if (!args && !replyPhoto && !replyText) {
    const styles = getStyleList();
    return ctx.reply(
      `Usage:\n\n` +
      `/sticker <text> — Generate text sticker (default style)\n` +
      `/sticker <text> --style hype — Use a style template\n` +
      `Reply to a photo with /sticker — Convert image to sticker\n` +
      `Reply to a photo with /sticker <text> — Add text overlay\n\n` +
      `Styles:\n${styles}\n\n` +
      `Add --emoji <emoji> to set the sticker emoji\n` +
      `Add --pack to also add to the VibeSwap sticker pack`
    );
  }

  await ctx.sendChatAction('upload_photo');

  try {
    // Parse flags
    const styleMatch = args.match(/--style\s+(\w+)/);
    const emojiMatch = args.match(/--emoji\s+(\S+)/);
    const addToPack = args.includes('--pack');
    const style = styleMatch ? styleMatch[1] : 'default';
    const emoji = emojiMatch ? emojiMatch[1] : '\u{1F680}';

    // Strip flags from text
    let stickerText = args
      .replace(/--style\s+\w+/, '')
      .replace(/--emoji\s+\S+/, '')
      .replace(/--pack/, '')
      .trim();

    let pngBuffer;

    if (replyPhoto) {
      // Image mode — get the highest resolution photo
      const photo = replyPhoto[replyPhoto.length - 1];
      const fileLink = await ctx.telegram.getFileLink(photo.file_id);
      const response = await fetch(fileLink.href);
      const imageBuffer = Buffer.from(await response.arrayBuffer());

      if (stickerText) {
        // Image + text overlay
        pngBuffer = await imageWithText(imageBuffer, stickerText);
      } else {
        // Pure image conversion
        pngBuffer = await imageToSticker(imageBuffer);
      }
    } else {
      // Text-only mode
      if (!stickerText) stickerText = replyText || 'VIBE';
      if (!AVAILABLE_STYLES.includes(style)) {
        return ctx.reply(`Unknown style "${style}". Available: ${AVAILABLE_STYLES.join(', ')}`);
      }
      pngBuffer = await textToSticker(stickerText, style);
    }

    // Send as document (PNG) so Telegram doesn't compress it
    await ctx.replyWithDocument(
      { source: pngBuffer, filename: `vibe_sticker_${Date.now()}.png` },
      { caption: `Sticker generated (${style} style)` }
    );

    // Optionally add to pack
    if (addToPack) {
      try {
        const botUsername = ctx.botInfo.username;
        const result = await addToStickerPack(ctx.telegram, ctx.from.id, botUsername, pngBuffer, emoji);
        const action = result.created ? 'Created pack and added' : 'Added to';
        await ctx.reply(`${action} sticker pack: t.me/addstickers/${result.packName}`);
      } catch (packErr) {
        await ctx.reply(`Sticker generated but pack error: ${packErr.message}\n\nYou can still use the PNG above as a sticker.`);
      }
    }

  } catch (err) {
    console.error('[sticker] Generation failed:', err.message);
    await ctx.reply(`Sticker generation failed: ${err.message}`);
  }
});

// ============ Shadow Protocol ============

// /shadow [note] — Owner generates a private invite token
bot.command('shadow', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const note = ctx.message.text.replace(/^\/shadow(@\w+)?/, '').trim();
  const token = createInvite(ctx.from.id, note);
  await flushShadow();

  const botUsername = ctx.botInfo?.username || config.botUsername;
  const inviteLink = `https://t.me/${botUsername}?start=shadow_${token}`;

  const lines = [
    'Shadow Protocol — Invite Generated',
    '',
    `Link: ${inviteLink}`,
    `Token: ${token}`,
    note ? `Note: ${note}` : '',
    '',
    'Expires in 7 days. Single use.',
    'Send this link privately to your contact.',
    'They open it → JARVIS assigns a codename → identity encrypted.',
  ].filter(Boolean);

  // Always send as DM to owner, never in group
  try {
    await bot.telegram.sendMessage(ctx.from.id, lines.join('\n'));
    if (ctx.chat.type !== 'private') {
      await ctx.reply('Invite sent to your DMs.');
    }
  } catch {
    await ctx.reply(lines.join('\n'));
  }
});

// /shadows — Owner views all shadow identities (decrypted)
bot.command('shadows', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);

  const stats = getShadowStats();
  const all = listShadows();
  const invites = listPendingInvites();

  const lines = [
    `Shadow Protocol — ${stats.active} active, ${stats.revoked} revoked, ${stats.totalContributions} contributions`,
    '',
  ];

  if (all.length === 0) {
    lines.push('No shadow identities yet. Use /shadow to create an invite.');
  } else {
    for (const s of all) {
      const status = s.status === 'revoked' ? ' [REVOKED]' : '';
      lines.push(`${s.codename}${status} — ID: ${s.telegramId} — ${s.contributions} contributions — joined ${s.joinedAt.slice(0, 10)}${s.note ? ` (${s.note})` : ''}`);
    }
  }

  if (invites.length > 0) {
    lines.push('', 'Pending invites:');
    for (const inv of invites) {
      lines.push(`  ${inv.token} — ${inv.expiresIn}${inv.note ? ` (${inv.note})` : ''}`);
    }
  }

  // DM only
  try {
    await bot.telegram.sendMessage(ctx.from.id, lines.join('\n'));
    if (ctx.chat.type !== 'private') await ctx.reply('Shadow list sent to your DMs.');
  } catch {
    await ctx.reply(lines.join('\n'));
  }
});

// /unshadow <codename> — Owner revokes a shadow identity
bot.command('unshadow', async (ctx) => {
  if (!isOwner(ctx)) return ownerOnly(ctx);
  const codename = ctx.message.text.replace(/^\/unshadow(@\w+)?/, '').trim();
  if (!codename) return ctx.reply('Usage: /unshadow <codename>');

  if (revokeShadow(codename)) {
    await flushShadow();
    ctx.reply(`Shadow identity "${codename}" revoked.`);
  } else {
    ctx.reply(`No shadow found with codename "${codename}".`);
  }
});

// ============ Multimodal Helpers ============

async function downloadTelegramFile(ctx, fileId) {
  const fileLink = await ctx.telegram.getFileLink(fileId);
  const response = await fetch(fileLink.href);
  const buffer = Buffer.from(await response.arrayBuffer());
  // Infer mime type from URL extension
  const url = fileLink.href;
  const ext = url.split('.').pop()?.split('?')[0]?.toLowerCase();
  const mimeMap = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', pdf: 'application/pdf', ogg: 'audio/ogg', oga: 'audio/ogg',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', mp4: 'video/mp4',
  };
  const mimeType = mimeMap[ext] || 'application/octet-stream';
  return { buffer, mimeType };
}

async function transcribeAudio(buffer, filename) {
  const apiKey = config.llm?.openaiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) return null; // No key — caller handles fallback

  try {
    const formData = new FormData();
    formData.append('file', new Blob([buffer]), filename);
    formData.append('model', config.llm?.whisperModel || 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.warn(`[multimodal] Whisper API error ${response.status}: ${await response.text()}`);
      return null;
    }

    const data = await response.json();
    return data.text || null;
  } catch (err) {
    console.warn(`[multimodal] Transcription failed: ${err.message}`);
    return null;
  }
}

// Shared response sender (avoids duplication across media handlers)
async function sendChatResponse(ctx, chatId, userName, text, chatType, media = []) {
  await ctx.sendChatAction('typing');
  const typingInterval = setInterval(() => {
    ctx.sendChatAction('typing').catch(() => {});
  }, 4000);

  try {
    const response = await chat(chatId, userName, text, chatType, media, { userId: ctx.from?.id });
    clearInterval(typingInterval);
    await saveConversations();

    // Record compute usage (non-blocking)
    if (response.usage) {
      try { recordComputeUsage(String(chatId), response.usage); } catch {}
    }

    const reply = response.text?.trim();
    if (!reply) {
      console.warn('[bot] Empty response from LLM — skipping send');
      return;
    }
    if (reply.length <= 4096) {
      await ctx.reply(reply, { parse_mode: undefined });
    } else {
      for (let i = 0; i < reply.length; i += 4096) {
        await ctx.reply(reply.slice(i, i + 4096), { parse_mode: undefined });
      }
    }

    // Wardenclyffe: check for intelligence degradation and notify once
    const degradation = checkDegradation();
    if (degradation?.degraded) {
      const notifyChat = config.communityGroupId || chatId;
      try {
        await bot.telegram.sendMessage(notifyChat,
          `[Wardenclyffe] Intelligence at ${degradation.quality}% — running on ${degradation.provider}.\n` +
          `Premium provider credits exhausted. Tip jar contributions (/tip) restore full quality.`
        );
      } catch {}
    } else if (degradation?.recovered) {
      const notifyChat = config.communityGroupId || chatId;
      try {
        await bot.telegram.sendMessage(notifyChat,
          `[Wardenclyffe] Intelligence restored to 100% — back on ${degradation.provider}. Premium quality active.`
        );
      } catch {}
    }
  } catch (error) {
    clearInterval(typingInterval);
    console.error('[bot] Media response error:', error.message);
    try {
      await ctx.reply(`Error: ${error.message?.slice(0, 200) || 'Unknown error'}`, { parse_mode: undefined });
    } catch {
      console.error('[bot] Failed to send error reply to chat', ctx.chat?.id);
    }
  }
}

// Check if bot is addressed in a group (mentioned, replied to, or called by name)
// For media without captions (voice, video_note), check reply-to only
function isBotAddressed(ctx) {
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  if (!isGroup) return true; // DMs always addressed
  const botUsername = ctx.botInfo?.username?.toLowerCase();
  const caption = (ctx.message.caption || '').toLowerCase();
  const isMentioned = botUsername && caption.includes(`@${botUsername}`);
  const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.botInfo?.id;
  const isCalledByName = caption.includes('jarvis');
  // Voice/video_note can't have captions — if user replies to bot with media, honor it
  // Also: if media has NO caption at all, treat reply-to as the only addressing check
  const isMediaWithoutCaption = !ctx.message.caption && (ctx.message.voice || ctx.message.video_note || ctx.message.audio);
  if (isMediaWithoutCaption) return isReplyToBot;
  return isMentioned || isReplyToBot || isCalledByName;
}

// ============ Photo Handler (multimodal + sticker) ============

bot.on('photo', async (ctx) => {
  console.log(`[multimodal] Photo handler triggered — from: ${ctx.from?.id} (${ctx.from?.username || 'anon'}), chat: ${ctx.chat?.type}`);
  if (!isAuthorized(ctx)) return;

  const caption = ctx.message.caption || '';

  // Sticker conversion path — /sticker caption in DMs
  if (caption.startsWith('/sticker') && ctx.chat.type === 'private') {
    const args = caption.replace(/^\/sticker(@\w+)?/, '').trim();
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);

    await ctx.sendChatAction('upload_photo');
    try {
      const response = await fetch(fileLink.href);
      const imageBuffer = Buffer.from(await response.arrayBuffer());

      let pngBuffer;
      if (args) {
        pngBuffer = await imageWithText(imageBuffer, args);
      } else {
        pngBuffer = await imageToSticker(imageBuffer);
      }

      await ctx.replyWithDocument(
        { source: pngBuffer, filename: `vibe_sticker_${Date.now()}.png` },
        { caption: 'Sticker generated from your image' }
      );
    } catch (err) {
      await ctx.reply(`Sticker generation failed: ${err.message}`);
    }
    return;
  }

  // Multimodal vision path — send image to LLM for analysis
  if (!isBotAddressed(ctx) && ctx.chat.type !== 'private') return;
  if (!isOwner(ctx) && isRateLimited(ctx.from.id)) return;

  const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Largest size
  try {
    const { buffer, mimeType } = await downloadTelegramFile(ctx, photo.file_id);
    const media = [{
      type: 'image',
      mimeType,
      data: buffer.toString('base64'),
      filename: `photo_${photo.file_id.slice(0, 8)}.jpg`,
    }];
    const text = caption || 'The user sent this image. Describe what you see and respond naturally.';
    const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
    console.log(`[multimodal] Photo from ${userName} (${Math.round(buffer.length / 1024)}KB)`);
    await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type, media);
  } catch (err) {
    console.error('[multimodal] Photo processing failed:', err.message);
    await ctx.reply(`Couldn't process that image: ${err.message}`);
  }
});

// ============ Voice Message Handler ============

bot.on('voice', async (ctx) => {
  console.log(`[multimodal] Voice handler triggered — from: ${ctx.from?.id} (${ctx.from?.username || 'anon'}), chat: ${ctx.chat?.type}, authorized: ${isAuthorized(ctx)}, addressed: ${isBotAddressed(ctx)}`);
  if (!isAuthorized(ctx)) return;
  if (!isBotAddressed(ctx) && ctx.chat.type !== 'private') return;
  if (!isOwner(ctx) && isRateLimited(ctx.from.id)) return;

  const voice = ctx.message.voice;
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
  const duration = voice.duration;

  try {
    const { buffer } = await downloadTelegramFile(ctx, voice.file_id);
    console.log(`[multimodal] Voice from ${userName} (${duration}s, ${Math.round(buffer.length / 1024)}KB)`);

    const transcript = await transcribeAudio(buffer, 'voice.ogg');
    if (transcript) {
      const text = `[Voice message transcription]: "${transcript}"`;
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
    } else {
      // No API key or transcription failed — graceful fallback
      const text = `[User sent a ${duration}s voice message but transcription is unavailable. Acknowledge it and let them know you can't process audio without an OPENAI_API_KEY configured.]`;
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
    }
  } catch (err) {
    console.error('[multimodal] Voice processing failed:', err.message);
    await ctx.reply(`Couldn't process that voice message: ${err.message}`);
  }
});

// ============ Audio File Handler ============

bot.on('audio', async (ctx) => {
  console.log(`[multimodal] Audio handler triggered — from: ${ctx.from?.id} (${ctx.from?.username || 'anon'}), chat: ${ctx.chat?.type}`);
  if (!isAuthorized(ctx)) return;
  if (!isBotAddressed(ctx) && ctx.chat.type !== 'private') return;
  if (!isOwner(ctx) && isRateLimited(ctx.from.id)) return;

  const audio = ctx.message.audio;
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
  const title = audio.title || audio.file_name || 'audio';

  try {
    const { buffer } = await downloadTelegramFile(ctx, audio.file_id);
    console.log(`[multimodal] Audio from ${userName}: "${title}" (${audio.duration}s, ${Math.round(buffer.length / 1024)}KB)`);

    const transcript = await transcribeAudio(buffer, audio.file_name || 'audio.mp3');
    if (transcript) {
      const text = `[Audio file "${title}" transcription]: "${transcript}"`;
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
    } else {
      const text = `[User sent an audio file: "${title}" (${audio.duration}s). Transcription unavailable.]`;
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
    }
  } catch (err) {
    console.error('[multimodal] Audio processing failed:', err.message);
    await ctx.reply(`Couldn't process that audio: ${err.message}`);
  }
});

// ============ Document Handler (PDF, images) ============

bot.on('document', async (ctx) => {
  console.log(`[multimodal] Document handler triggered — from: ${ctx.from?.id} (${ctx.from?.username || 'anon'}), chat: ${ctx.chat?.type}, mime: ${ctx.message.document?.mime_type}`);
  if (!isAuthorized(ctx)) return;
  if (!isBotAddressed(ctx) && ctx.chat.type !== 'private') return;
  if (!isOwner(ctx) && isRateLimited(ctx.from.id)) return;

  const doc = ctx.message.document;
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
  const filename = doc.file_name || 'document';
  const mime = doc.mime_type || '';
  const caption = ctx.message.caption || '';

  // Only process supported types (images + PDF)
  const isImage = mime.startsWith('image/');
  const isPDF = mime === 'application/pdf';
  if (!isImage && !isPDF) {
    // Unsupported document type — acknowledge but don't download
    const text = `[User sent a document: "${filename}" (${mime}). This file type is not supported for analysis. Let them know you can process images and PDFs.]`;
    if (ctx.chat.type === 'private') {
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
    }
    return;
  }

  // Size guard — skip files over 20MB (API limit for base64)
  if (doc.file_size > 20 * 1024 * 1024) {
    await ctx.reply('That file is too large (>20MB). Send a smaller version.');
    return;
  }

  try {
    const { buffer, mimeType } = await downloadTelegramFile(ctx, doc.file_id);
    console.log(`[multimodal] Document from ${userName}: "${filename}" (${mime}, ${Math.round(buffer.length / 1024)}KB)`);

    const media = [{
      type: isImage ? 'image' : 'document',
      mimeType: mimeType === 'application/octet-stream' ? mime : mimeType,
      data: buffer.toString('base64'),
      filename,
    }];
    const text = caption || `The user sent a ${isImage ? 'image' : 'PDF'} document: "${filename}". Analyze its contents and respond.`;
    await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type, media);
  } catch (err) {
    console.error('[multimodal] Document processing failed:', err.message);
    await ctx.reply(`Couldn't process that document: ${err.message}`);
  }
});

// ============ Sticker Handler (visual analysis) ============

bot.on('sticker', async (ctx) => {
  if (!isAuthorized(ctx)) return;
  if (!isBotAddressed(ctx) && ctx.chat.type !== 'private') return;
  if (!isOwner(ctx) && isRateLimited(ctx.from.id)) return;

  const sticker = ctx.message.sticker;
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
  const emoji = sticker.emoji || '';
  const setName = sticker.set_name || 'unknown';

  // Try to get sticker thumbnail for visual analysis
  const thumbFileId = sticker.thumbnail?.file_id || sticker.file_id;
  if (thumbFileId && !sticker.is_animated && !sticker.is_video) {
    try {
      const { buffer, mimeType } = await downloadTelegramFile(ctx, thumbFileId);
      console.log(`[multimodal] Sticker from ${userName}: ${emoji} (set: ${setName})`);

      const media = [{
        type: 'image',
        mimeType,
        data: buffer.toString('base64'),
        filename: `sticker_${Date.now()}.webp`,
      }];
      const text = `[User sent a sticker. Emoji: ${emoji}. Sticker set: ${setName}. This is the sticker image. React to it naturally — describe what you see, match the vibe, respond with personality.]`;
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type, media);
    } catch (err) {
      console.error('[multimodal] Sticker processing failed:', err.message);
      const text = `[User sent a sticker: ${emoji} from set "${setName}". Image processing failed. React to the emoji and context.]`;
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
    }
  } else {
    // Animated/video sticker — can't display, react to emoji
    const stickerType = sticker.is_animated ? 'animated' : sticker.is_video ? 'video' : 'static';
    const text = `[User sent a ${stickerType} sticker: ${emoji} from set "${setName}". React to the emoji and context naturally.]`;
    await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
  }
});

// ============ Video Handler (thumbnail + audio analysis) ============

bot.on('video', async (ctx) => {
  console.log(`[multimodal] Video handler triggered — from: ${ctx.from?.id} (${ctx.from?.username || 'anon'}), chat: ${ctx.chat?.type}`);
  if (!isAuthorized(ctx)) return;
  if (!isBotAddressed(ctx) && ctx.chat.type !== 'private') return;
  if (!isOwner(ctx) && isRateLimited(ctx.from.id)) return;

  const video = ctx.message.video;
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
  const caption = ctx.message.caption || '';

  // Use Telegram-provided thumbnail for visual context + transcribe audio for small videos
  if (video.thumbnail) {
    try {
      const { buffer, mimeType } = await downloadTelegramFile(ctx, video.thumbnail.file_id);
      console.log(`[multimodal] Video thumbnail from ${userName} (${video.duration}s video, ${Math.round((video.file_size || 0) / 1024)}KB)`);

      // Try audio transcription for videos <10MB
      let transcript = null;
      if (video.file_size && video.file_size < 10 * 1024 * 1024) {
        try {
          const { buffer: videoBuffer } = await downloadTelegramFile(ctx, video.file_id);
          transcript = await transcribeAudio(videoBuffer, `video_${Date.now()}.mp4`);
        } catch (err) {
          console.warn(`[multimodal] Video audio transcription failed: ${err.message}`);
        }
      }

      const media = [{
        type: 'image',
        mimeType,
        data: buffer.toString('base64'),
        filename: `video_thumb_${Date.now()}.jpg`,
      }];
      let text = caption || `[User sent a ${video.duration}s video. This is the thumbnail/preview frame. Describe what you see and respond.]`;
      if (transcript) {
        text += `\n[Audio transcription]: "${transcript}"`;
      }
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type, media);
    } catch (err) {
      console.error('[multimodal] Video thumbnail failed:', err.message);
      const text = `[User sent a ${video.duration}s video. Thumbnail processing failed. Acknowledge the video.]`;
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
    }
  } else {
    const text = `[User sent a ${video.duration}s video but no thumbnail is available. Acknowledge it.]`;
    await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
  }
});

// ============ GIF/Animation Handler ============

bot.on('animation', async (ctx) => {
  console.log(`[multimodal] Animation/GIF handler triggered — from: ${ctx.from?.id} (${ctx.from?.username || 'anon'}), chat: ${ctx.chat?.type}`);
  if (!isAuthorized(ctx)) return;
  if (!isBotAddressed(ctx) && ctx.chat.type !== 'private') return;
  if (!isOwner(ctx) && isRateLimited(ctx.from.id)) return;

  const animation = ctx.message.animation;
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
  const caption = ctx.message.caption || '';

  // Use thumbnail for visual context (GIFs always have one)
  if (animation.thumbnail) {
    try {
      const { buffer, mimeType } = await downloadTelegramFile(ctx, animation.thumbnail.file_id);
      console.log(`[multimodal] GIF thumbnail from ${userName} (${animation.duration}s, ${animation.file_name || 'unnamed'})`);

      const media = [{
        type: 'image',
        mimeType,
        data: buffer.toString('base64'),
        filename: `gif_thumb_${Date.now()}.jpg`,
      }];
      const text = caption || `[User sent a GIF/animation (${animation.duration}s). This is the preview frame. Describe what you see and respond naturally.]`;
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type, media);
    } catch (err) {
      console.error('[multimodal] GIF thumbnail failed:', err.message);
      const text = caption || `[User sent a GIF/animation. Thumbnail processing failed. Acknowledge it.]`;
      await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
    }
  } else {
    const text = caption || `[User sent a GIF/animation but no thumbnail is available. Acknowledge it.]`;
    await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
  }
});

// ============ Video Note Handler (circular videos) ============

bot.on('video_note', async (ctx) => {
  console.log(`[multimodal] VideoNote handler triggered — from: ${ctx.from?.id} (${ctx.from?.username || 'anon'}), chat: ${ctx.chat?.type}`);
  if (!isAuthorized(ctx)) return;
  if (!isBotAddressed(ctx) && ctx.chat.type !== 'private') return;
  if (!isOwner(ctx) && isRateLimited(ctx.from.id)) return;

  const videoNote = ctx.message.video_note;
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';

  // Transcribe audio + analyze thumbnail for full multimodal understanding
  try {
    const { buffer } = await downloadTelegramFile(ctx, videoNote.file_id);
    console.log(`[multimodal] Video note from ${userName} (${videoNote.duration}s, ${Math.round(buffer.length / 1024)}KB)`);

    // Transcribe audio
    const transcript = await transcribeAudio(buffer, 'video_note.mp4');

    // Also try thumbnail analysis
    let media = [];
    if (videoNote.thumbnail) {
      try {
        const { buffer: thumbBuffer, mimeType } = await downloadTelegramFile(ctx, videoNote.thumbnail.file_id);
        media = [{
          type: 'image',
          mimeType,
          data: thumbBuffer.toString('base64'),
          filename: `videonote_thumb_${Date.now()}.jpg`,
        }];
      } catch {}
    }

    let text;
    if (transcript && media.length > 0) {
      text = `[Video note (circular video). Audio transcription]: "${transcript}"\n[This is the thumbnail. Describe what you see + respond to what they said.]`;
    } else if (transcript) {
      text = `[Video note (circular video) transcription]: "${transcript}"`;
    } else if (media.length > 0) {
      text = `[User sent a ${videoNote.duration}s video note (circular video). Audio transcription unavailable. This is the thumbnail — describe what you see.]`;
    } else {
      text = `[User sent a ${videoNote.duration}s video note (circular video). Transcription unavailable. Acknowledge it.]`;
    }

    await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type, media);
  } catch (err) {
    console.error('[multimodal] Video note processing failed:', err.message);
    const text = `[User sent a ${videoNote.duration}s video note. Processing failed. Acknowledge it.]`;
    await sendChatResponse(ctx, ctx.chat.id, userName, text, ctx.chat.type);
  }
});

// ============ Message Handler ============

bot.on('text', async (ctx) => {
  // Monitor auth intercept — if auth flow is active, capture phone/code/password
  if (monitorAvailable && interceptAuthMessage && interceptAuthMessage(ctx.chat.id, ctx.from.id, ctx.message?.text?.trim())) {
    return; // Message consumed by auth flow
  }

  // Anti-spam check FIRST — before anything else
  const spamResult = await checkMessage(bot, ctx);
  if (spamResult.action !== 'allow') return; // Message handled by antispam

  // Track ALL messages silently (before auth check for chat responses)
  await trackMessage(ctx);

  // Skip commands (already handled above)
  if (ctx.message.text.startsWith('/')) return;

  // In group chats, respond if mentioned, replied to, or called by name
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  const botUsername = ctx.botInfo?.username?.toLowerCase();
  const textLower = ctx.message.text.toLowerCase();
  const isMentioned = botUsername && textLower.includes(`@${botUsername}`);
  const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.botInfo?.id;
  const isCalledByName = textLower.includes('jarvis');

  if (isGroup && !isMentioned && !isReplyToBot && !isCalledByName) {
    // In groups: buffer into conversation history for situational awareness
    const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
    const msgText = ctx.message.text;
    bufferMessage(ctx.chat.id, userName, msgText);

    // Track for thread detection (quality from basic heuristic — AI scoring is too expensive for every msg)
    const basicQuality = Math.min(1 + (msgText.length > 50 ? 1 : 0) + (msgText.length > 200 ? 1 : 0) + (msgText.includes('?') ? 1 : 0), 5);
    trackForThread(ctx.chat.id, ctx.from.id, userName, msgText, basicQuality, ctx.message.message_id);

    // Check if thread is worth archiving
    if (shouldSuggestArchival(ctx.chat.id)) {
      ctx.reply('This conversation is getting good. Use /archive if you want to save it as a knowledge artifact.');
    }

    // Proactive intelligence — JARVIS is a full team member, not a wallflower
    if (msgText.length >= 5) {
      try {
        const recentContext = ''; // Could build from buffered messages
        const analysis = await analyzeMessage(msgText, userName, recentContext);

        if (analysis.action === 'engage' && analysis.response_hint) {
          const proactiveReply = await generateProactiveResponse(
            msgText, userName, analysis.response_hint, getSystemPrompt()
          );
          if (proactiveReply) {
            await ctx.reply(proactiveReply, { parse_mode: undefined });
          }
        } else if (analysis.action === 'moderate') {
          const modAction = await evaluateModeration(msgText, userName, analysis.violation, analysis.severity);
          if (modAction.action === 'warn') {
            await warnUser(bot, ctx.chat.id, ctx.from.id, modAction.reason, 'jarvis-ai');
            await ctx.reply(`${ctx.from.first_name} — heads up: ${modAction.reason}`);
          } else if (modAction.action === 'mute') {
            await muteUser(bot, ctx.chat.id, ctx.from.id, 600, modAction.reason, 'jarvis-ai');
          }
          // Bans from AI moderation should be rare and reviewed — log but don't auto-execute
        }
      } catch (err) {
        // Swallow proactive intelligence errors — don't let Haiku 529s crash group handling
        console.error('[intelligence] Proactive analysis failed:', err.message?.slice(0, 100));
      }
    }

    return;
  }

  // Shadow Protocol — shadow users bypass normal auth, use codename
  const shadowCodename = getShadowCodename(ctx.from.id);
  if (!isAuthorized(ctx) && !shadowCodename) {
    // DMs get a soft paywall — 3 free messages/day, then tip jar prompt
    if (ctx.chat.type === 'private') {
      const dmCount = getTelegramMessageCount(String(ctx.from.id));
      if (dmCount >= FREE_TELEGRAM_DMS) {
        const tipAddr = config.tipJarAddress;
        return ctx.reply(
          `You've used your ${FREE_TELEGRAM_DMS} free messages for today.\n\n` +
          `JARVIS costs ~$5/day in API credits. Want to keep chatting?\n\n` +
          `Send a tip to help fund compute:\n${tipAddr}\n\n` +
          `Or ask a team member to vouch for you — resets at midnight UTC.`
        );
      }
      recordTelegramMessage(String(ctx.from.id));
    } else {
      return unauthorized(ctx);
    }
  }

  // Rate limit Claude API calls (owner exempt, shadows get standard limit)
  if (!isOwner(ctx) && isRateLimited(ctx.from.id)) {
    return ctx.reply('Slow down — too many requests. Try again in a minute.');
  }

  const chatId = ctx.chat.id;
  const userName = shadowCodename || ctx.from.username || ctx.from.first_name || 'Unknown';

  // Track shadow contribution
  if (shadowCodename) incrementContribution(ctx.from.id);

  // Show typing indicator
  await ctx.sendChatAction('typing');

  const typingInterval = setInterval(() => {
    ctx.sendChatAction('typing').catch(() => {});
  }, 4000);

  try {
    // Check if this message is a correction of a previous JARVIS response
    const isReply = ctx.message.reply_to_message?.from?.id === ctx.botInfo?.id;
    const lastResponse = getLastResponse(chatId);
    if (isReply || lastResponse) {
      const prevText = isReply
        ? ctx.message.reply_to_message?.text
        : lastResponse?.text;
      // Only check for corrections if previous response was recent (< 10 min)
      const isRecent = !lastResponse || (Date.now() - lastResponse.timestamp < 600000);
      if (prevText && isRecent) {
        // Fire and forget — don't block the response
        processCorrection(
          ctx.message.text, prevText,
          ctx.from.id, userName, chatId, ctx.chat.type
        ).then(result => {
          if (result) {
            console.log(`[learning] Correction from ${userName}: ${result.category} — ${result.lesson?.slice(0, 60) || 'no lesson'}`);
          }
        }).catch(err => {
          console.error('[learning] Correction processing failed:', err.message);
        });
      }
    }

    const response = await chat(chatId, userName, ctx.message.text, ctx.chat.type, [], { userId: ctx.from.id });

    clearInterval(typingInterval);

    // Record compute usage (non-blocking)
    if (response.usage) {
      try { recordComputeUsage(String(chatId), response.usage); } catch {}
    }

    // Save conversation after every Claude response (resilience)
    await saveConversations();

    const text = response.text?.trim();
    if (!text) {
      clearInterval(typingInterval);
      console.warn('[bot] Empty response from LLM — skipping send');
      return;
    }
    if (text.length <= 4096) {
      await ctx.reply(text, { parse_mode: undefined });
    } else {
      const chunks = [];
      for (let i = 0; i < text.length; i += 4096) {
        chunks.push(text.slice(i, i + 4096));
      }
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: undefined });
      }
    }
  } catch (error) {
    clearInterval(typingInterval);
    console.error('[bot] Error:', error.message);
    try {
      await ctx.reply(`Error: ${error.message?.slice(0, 200) || 'Unknown error'}`, { parse_mode: undefined });
    } catch {
      // If even the error reply fails (user blocked bot, chat deleted, TG down), just log
      console.error('[bot] Failed to send error reply to chat', ctx.chat?.id);
    }
  }
});

// ============ Startup ============

async function main() {
  // ============ Worker Mode Startup ============
  if (IS_WORKER) {
    console.log('[jarvis] ============ WORKER SHARD STARTUP ============');

    // Worker shards: privacy → state store → learning → shard → consensus → HTTP server
    console.log('[jarvis] Step 1: Initializing privacy engine...');
    await initPrivacy();

    console.log('[jarvis] Step 2: Initializing state store...');
    await initStateStore();

    console.log('[jarvis] Step 2.5: Initializing LLM provider...');
    initProvider();

    console.log('[jarvis] Step 3: Loading learning + inner dialogue + deep storage + hell...');
    await initLearning();
    await initInnerDialogue();
    await initDeepStorage();
    await initHell();
    await recoverWAL();
    await recoverRetryQueue();

    console.log('[jarvis] Step 4: Initializing shard identity...');
    const shardResult = await initShard();
    console.log(`[jarvis] Shard: ${shardResult.id} (${shardResult.totalShards} total, mode: WORKER)`);

    console.log('[jarvis] Step 5: Initializing consensus + CRPC...');
    initConsensus();
    initCRPC();
    registerConsensusHandlers();

    // Worker HTTP server — consensus, CRPC, knowledge chain, health, proxy processing
    const healthPort = parseInt(process.env.HEALTH_PORT || '8080');
    createServer(async (req, res) => {
      // Health check
      if (req.url === '/health') {
        const info = getShardInfo();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          mode: 'worker',
          provider: getProviderName(),
          model: getModelName(),
          shard: info.id,
          nodeType: info.nodeType,
          uptime: process.uptime(),
          memory: info.memory,
          peers: info.peers,
        }));
        return;
      }

      // Proxy processing — primary shard forwards a message for this shard to process
      if (req.url === '/shard/process' && req.method === 'POST') {
        try {
          const body = await readBody(req);
          const payload = JSON.parse(body);
          // Process the message with Claude (for CRPC multi-shard response generation)
          const { chat: chatFn } = await import('./claude.js');
          const response = await chatFn(
            payload.chatId || 'proxy',
            payload.userName || 'proxy',
            payload.text,
            payload.chatType || 'private'
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, text: response.text, shardId: shardResult.id }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      // Router API
      if (req.url?.startsWith('/router/')) {
        const routerUrl = new URL(req.url, `http://localhost:${healthPort}`);
        const routerResult = handleRouterRequest(req, routerUrl);
        if (!routerResult) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unknown router route' }));
        } else if (routerResult.parse) {
          try {
            const body = await readBody(req);
            const payload = JSON.parse(body);
            const data = processRouterBody(routerResult.handler, payload, routerResult.userId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(routerResult.data));
        }
        return;
      }

      // Consensus + CRPC + Knowledge Chain endpoints (same as primary)
      if (req.url?.startsWith('/consensus/') || req.url?.startsWith('/crpc/')) {
        const reqUrl = new URL(req.url, `http://localhost:${healthPort}`);
        const path = reqUrl.pathname;
        const consensusHandler = handleConsensusRequest(path, req.method);
        if (consensusHandler) {
          if (consensusHandler === 'state') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(getConsensusState()));
          } else {
            try {
              const body = await readBody(req);
              const payload = JSON.parse(body);
              const signature = req.headers['x-shard-signature'] || null;
              const data = await processConsensusBody(consensusHandler, payload, signature);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(data || { ok: true }));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
          }
          return;
        }
        const crpcHandler = handleCRPCRequest(path, req.method);
        if (crpcHandler) {
          if (crpcHandler === 'stats') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(getCRPCStats()));
          } else {
            try {
              const body = await readBody(req);
              const payload = JSON.parse(body);
              const data = processCRPCBody(crpcHandler, payload);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(data));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
          }
          return;
        }
      }

      if (req.url?.startsWith('/knowledge-chain/')) {
        const kcUrl = new URL(req.url, `http://localhost:${healthPort}`);
        const kcPath = kcUrl.pathname;
        const kcHandler = handleKnowledgeChainRequest(kcPath, req.method);
        if (kcHandler === 'epoch') {
          try {
            const body = await readBody(req);
            const payload = JSON.parse(body);
            const data = processKnowledgeChainBody(kcHandler, payload);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        } else if (kcHandler) {
          const query = Object.fromEntries(kcUrl.searchParams);
          const data = processKnowledgeChainBody(kcHandler, null, query);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
          return;
        }
      }

      res.writeHead(404);
      res.end('Not found');
    }).listen(healthPort, () => {
      console.log(`[jarvis] Worker shard listening on http://0.0.0.0:${healthPort}`);
    });

    // Flush cycles for worker — harmonic tick (all shards pulse at same wall-clock boundary)
    scheduleHarmonicTick(async () => {
      await flushLearning();
      await flushInnerDialogue();
      if (isMultiShard()) checkShardHealth();
      const epoch = await produceEpoch();
      if (epoch && isMultiShard()) {
        await broadcastEpoch(epoch);
        await retryMissedEpochs();
        await syncWithPeers();
      }
    }, 5 * 60 * 1000);

    // Graceful shutdown for worker
    async function workerShutdown(signal) {
      console.log(`[jarvis] Worker shutting down (${signal})...`);
      await shutdownShard();
      await flushLearning();
      await flushInnerDialogue();
      process.exit(0);
    }
    process.once('SIGINT', () => workerShutdown('SIGINT'));
    process.once('SIGTERM', () => workerShutdown('SIGTERM'));

    console.log('[jarvis] ============ WORKER SHARD ONLINE ============');
    return; // Worker startup complete — don't run primary path
  }

  // ============ Primary Mode Startup ============
  console.log('[jarvis] ============ STARTUP ============');

  // Step 1: Pull latest from git BEFORE loading context
  console.log('[jarvis] Step 1: Syncing from git...');
  try {
    const pullResult = await gitPull();
    console.log(`[jarvis] Git: ${pullResult}`);
  } catch (err) {
    console.warn(`[jarvis] Git pull failed (will use local files): ${err.message}`);
  }

  // Step 2: Initialize privacy engine BEFORE loading any CKBs
  console.log('[jarvis] Step 2: Initializing privacy engine...');
  await initPrivacy();

  // Step 2.5: Initialize state store (abstracts file vs redis vs future backends)
  console.log('[jarvis] Step 2.5: Initializing state store...');
  await initStateStore();

  // Step 2.7: Initialize LLM provider (multi-model support)
  console.log('[jarvis] Step 2.7: Initializing LLM provider...');
  initProvider();

  // Step 2.9: Initialize continuous context memory (rolling summaries)
  console.log('[jarvis] Step 2.9: Initializing continuous context memory...');
  await initContextMemory();

  // Step 2.95: Load runtime-authorized users
  await loadRuntimeAuthorized();

  // Step 3: Load context, conversation history, moderation log, threads, comms
  console.log('[jarvis] Step 3: Loading memory, conversations, moderation, threads, comms...');
  await initClaude();
  await initTracker();
  await initModeration();
  await initAntispam();
  await initThreads();
  await loadBehavior();
  await loadComms();
  await initLearning();
  await initInnerDialogue();
  await initStickers();
  await recoverWAL();
  await recoverRetryQueue();
  await initShadow();
  await initComputeEconomics();
  await initMining();
  await initDeepStorage();
  await initHell();
  await initLimni();
  registerKataraktiStrategies();
  // Wire Limni alerts to owner's Telegram DM
  onAlert((alert) => {
    try {
      bot.telegram.sendMessage(config.ownerUserId, `⚠ LIMNI ALERT [${alert.type}]\n${alert.message}`);
    } catch {}
  });
  console.log('[jarvis] Behavior flags + comms + learning + inner dialogue + stickers + shadow + compute economics + mining + deep storage + hell + limni loaded.');

  // Security posture check (runs every startup)
  await runSecurityChecks();

  // Step 3.5: Initialize shard identity (Decentralized Mind Network)
  console.log('[jarvis] Step 3.5: Initializing shard identity...');
  const shardResult = await initShard();
  console.log(`[jarvis] Shard: ${shardResult.id} (${shardResult.totalShards} total, ${isMultiShard() ? 'MULTI' : 'SINGLE'}-shard mode)`);

  // Step 3.6: Initialize consensus + CRPC
  initConsensus();
  initCRPC();
  registerConsensusHandlers();

  // Step 4: Context diagnosis
  const report = await diagnoseContext();
  console.log(`[jarvis] Context: ${report.loaded.length} files loaded (${report.totalChars} chars)`);
  if (report.missing.length > 0) {
    console.warn(`[jarvis] WARNING — Missing context files: ${report.missing.join(', ')}`);
  }

  // Step 5: Check for unclean shutdown
  const lastShutdown = await checkLastShutdown();
  if (!lastShutdown.clean && !lastShutdown.firstBoot) {
    console.warn(`[jarvis] WARNING: Unclean shutdown detected. Last seen: ${lastShutdown.lastSeen}, downtime: ~${lastShutdown.downtime}min`);
  }

  // Step 6: Initialize group monitor (MTProto — reads public groups without joining)
  if (monitorAvailable) {
    console.log('[jarvis] Step 6: Initializing group monitor...');
    try {
      await initMonitor();
    } catch (err) {
      console.warn(`[jarvis] Monitor init failed (non-fatal): ${err.message}`);
    }
  } else {
    console.log('[jarvis] Step 6: Group monitor skipped (telegram package not installed).');
  }

  console.log(`[jarvis] Model: ${config.anthropic.model}`);
  console.log('[jarvis] Step 7: Starting Telegram bot...');

  bot.launch();
  console.log('[jarvis] ============ JARVIS IS ONLINE ============');

  // HTTP health endpoint for cloud platforms (Fly.io, Railway, etc.)
  if (config.isDocker || process.env.HEALTH_PORT) {
    const healthPort = parseInt(process.env.HEALTH_PORT || '8080');
    createServer(async (req, res) => {
      if (req.url === '/health') {
        try {
          const report = await diagnoseContext();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'ok',
            uptime: process.uptime(),
            provider: getProviderName(),
            model: getModelName(),
            context: { loaded: report.loaded.length, total: report.loaded.length + report.missing.length, chars: report.totalChars },
          }));
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
        }
      } else if (req.url === '/transcript' && req.method === 'POST') {
        // ============ Meeting Transcript Webhook ============
        // Receives live transcript chunks from Fireflies.ai (or any transcription service)
        // and forwards Jarvis's response to the Telegram group/DM
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const payload = JSON.parse(body);

            // Verify webhook secret
            if (config.transcriptWebhookSecret && payload.secret !== config.transcriptWebhookSecret) {
              res.writeHead(401);
              res.end('Unauthorized');
              return;
            }

            const transcript = payload.transcript || payload.text || payload.data?.transcript || '';
            const speaker = payload.speaker || payload.data?.speaker || 'Unknown';
            const meetingTitle = payload.meeting_title || payload.data?.title || 'Meeting';

            if (transcript.length < 10) {
              res.writeHead(200);
              res.end('OK — too short, skipped');
              return;
            }

            // ============ Persist to KB transcript log ============
            const transcriptFile = join(config.dataDir, 'meeting-transcripts.md');
            const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
            const logEntry = `**[${timestamp}] ${meetingTitle}**\n**${speaker}**: ${transcript}\n\n`;
            try {
              await appendFile(transcriptFile, logEntry);
            } catch {
              // First write — file doesn't exist yet
              await writeFile(transcriptFile, `# Meeting Transcripts\n\nPersisted automatically by Jarvis from live meeting webhooks.\n\n---\n\n${logEntry}`);
            }

            // Send to Claude for analysis
            const chatId = config.transcriptChatId || config.ownerUserId;
            const prompt = `[LIVE MEETING: ${meetingTitle}]\n[${speaker}]: ${transcript}\n\nYou are JARVIS, listening to a live meeting. Your ONLY role is to provide actionable feedback and suggestions that build on what was just said. Think like an architect and co-founder.\n\nRules:\n- ONLY respond with concrete suggestions, improvements, or critical feedback on ideas being discussed\n- Point out flaws, edge cases, or missed opportunities in what was proposed\n- Suggest specific technical approaches, patterns, or alternatives\n- Connect what they're saying to existing VibeSwap/CKB mechanisms if relevant\n- Be concise — 2-3 sentences max, like you're interjecting in a meeting\n- If nothing constructive to add (small talk, greetings, off-topic), reply with exactly "—" and nothing else\n- Do NOT summarize what they said. Do NOT repeat their points. Only ADD value.`;

            await bot.telegram.sendChatAction(chatId, 'typing');
            const response = await chat(chatId, 'meeting-transcript', prompt, 'private');

            // Only forward if Jarvis has something meaningful to say
            if (response.text && response.text.trim() !== '—' && response.text.trim() !== '-') {
              const jarvisText = response.text;

              // Persist Jarvis's response to transcript log
              try {
                await appendFile(transcriptFile, `**Jarvis**: ${jarvisText}\n\n`);
              } catch { /* ignore */ }

              // Send text context first
              await bot.telegram.sendMessage(chatId,
                `[Meeting: ${meetingTitle}]\n${speaker}: "${transcript.slice(0, 100)}${transcript.length > 100 ? '...' : ''}"`
              );

              // Generate TTS voice message — Jarvis speaks
              try {
                // google-tts-api getAllAudioBase64 handles long text + chunking automatically
                const audioSegments = await googleTTS.getAllAudioBase64(jarvisText, {
                  lang: 'en',
                  slow: false,
                  host: 'https://translate.google.co.uk', // UK endpoint for British accent
                });

                const audioBuffers = audioSegments.map(seg => Buffer.from(seg.base64, 'base64'));
                const fullAudio = Buffer.concat(audioBuffers);

                // Save temp file and send as voice
                const tmpFile = join(config.dataDir, `tts_${Date.now()}.mp3`);
                await writeFile(tmpFile, fullAudio);
                await bot.telegram.sendVoice(chatId, { source: tmpFile }, { caption: 'Jarvis' });
                await unlink(tmpFile).catch(() => {});
              } catch (ttsErr) {
                console.warn('[tts] Voice generation failed, sending text only:', ttsErr.message);
                await bot.telegram.sendMessage(chatId, `Jarvis: ${jarvisText}`);
              }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', responded: response.text?.trim() !== '—' }));
          } catch (err) {
            console.error('[transcript] Webhook error:', err.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      // ============ Fireflies.ai Webhook ============
      // GET = verification ping (Fireflies checks URL is live before activating)
      // POST = transcription event
      } else if (req.url === '/fireflies' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'jarvis-fireflies-webhook' }));

      } else if (req.url === '/fireflies' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            // Verify HMAC signature if secret is configured
            if (config.fireflies?.webhookSecret) {
              const signature = req.headers['x-hub-signature'];
              const expected = createHmac('sha256', config.fireflies.webhookSecret).update(body).digest('hex');
              if (signature !== expected) {
                console.warn('[fireflies] Invalid webhook signature');
                res.writeHead(401);
                res.end('Unauthorized');
                return;
              }
            }

            const payload = JSON.parse(body);
            const { meetingId, eventType } = payload;
            console.log(`[fireflies] Webhook received: ${eventType} (meetingId: ${meetingId})`);

            if (eventType !== 'Transcription completed') {
              res.writeHead(200);
              res.end('OK — event ignored');
              return;
            }

            if (!config.fireflies?.apiKey) {
              console.warn('[fireflies] No FIREFLIES_API_KEY set — cannot fetch transcript');
              res.writeHead(200);
              res.end('OK — no API key configured');
              return;
            }

            // Fetch transcript from Fireflies GraphQL API
            const query = `query Transcript($transcriptId: String!) {
              transcript(id: $transcriptId) {
                title
                duration
                date
                host_email
                organizer_email
                participants
                speakers { id name }
                sentences { index speaker_name text start_time end_time }
                summary {
                  overview
                  short_summary
                  action_items
                  keywords
                  outline
                }
                meeting_attendees { displayName email }
                transcript_url
              }
            }`;

            console.log(`[fireflies] Fetching transcript ${meetingId} from Fireflies API...`);
            const gqlResponse = await fetch('https://api.fireflies.ai/graphql', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.fireflies.apiKey}`,
              },
              body: JSON.stringify({ query, variables: { transcriptId: meetingId } }),
              signal: AbortSignal.timeout(30000),
            });

            if (!gqlResponse.ok) {
              const errText = await gqlResponse.text();
              console.error(`[fireflies] GraphQL API error ${gqlResponse.status}: ${errText}`);
              res.writeHead(200);
              res.end('OK — API fetch failed');
              return;
            }

            const gqlData = await gqlResponse.json();
            const transcript = gqlData.data?.transcript;
            if (!transcript) {
              console.warn('[fireflies] No transcript data in response');
              res.writeHead(200);
              res.end('OK — no transcript data');
              return;
            }

            const { title, duration, sentences, summary, speakers, meeting_attendees, transcript_url } = transcript;
            const durationMin = duration ? Math.round(duration / 60) : '?';
            const attendeeNames = (meeting_attendees || []).map(a => a.displayName || a.email).filter(Boolean).join(', ');
            console.log(`[fireflies] Transcript: "${title}" (${durationMin}min, ${sentences?.length || 0} sentences, ${speakers?.length || 0} speakers)`);

            // ============ Build meeting notes document ============
            const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
            let notes = `# ${title || 'Meeting'}\n`;
            notes += `**Date**: ${timestamp} | **Duration**: ${durationMin} min\n`;
            if (attendeeNames) notes += `**Attendees**: ${attendeeNames}\n`;
            if (transcript_url) notes += `**Transcript**: ${transcript_url}\n`;
            notes += '\n---\n\n';

            // Summary section
            if (summary) {
              if (summary.overview) notes += `## Overview\n${summary.overview}\n\n`;
              if (summary.action_items) notes += `## Action Items\n${summary.action_items}\n\n`;
              if (summary.keywords) notes += `## Keywords\n${summary.keywords}\n\n`;
              if (summary.outline) notes += `## Outline\n${summary.outline}\n\n`;
            }

            // Full transcript (speaker-grouped)
            if (sentences && sentences.length > 0) {
              notes += `## Transcript\n\n`;
              let lastSpeaker = '';
              for (const s of sentences) {
                if (s.speaker_name !== lastSpeaker) {
                  lastSpeaker = s.speaker_name;
                  notes += `\n**${s.speaker_name}**:\n`;
                }
                notes += `${s.text} `;
              }
              notes += '\n';
            }

            // ============ Persist to file ============
            const transcriptFile = join(config.dataDir, 'meeting-transcripts.md');
            const fileEntry = `\n\n---\n\n${notes}`;
            try {
              await appendFile(transcriptFile, fileEntry);
            } catch {
              await writeFile(transcriptFile, `# Meeting Transcripts\n\nPersisted automatically by Jarvis from Fireflies.ai.\n${fileEntry}`);
            }

            // ============ Send to JARVIS for analysis ============
            const chatId = config.transcriptChatId || config.ownerUserId;
            const shortSummary = summary?.short_summary || summary?.overview || 'No summary available.';
            const actionItems = summary?.action_items || 'None identified.';

            // Build condensed transcript for JARVIS (max ~3000 chars to avoid token blow-up)
            let condensed = '';
            if (sentences && sentences.length > 0) {
              let lastSpeaker = '';
              for (const s of sentences) {
                if (s.speaker_name !== lastSpeaker) {
                  lastSpeaker = s.speaker_name;
                  condensed += `\n[${s.speaker_name}]: `;
                }
                condensed += `${s.text} `;
                if (condensed.length > 3000) {
                  condensed += '\n... [transcript truncated]';
                  break;
                }
              }
            }

            const prompt = `[MEETING TRANSCRIPT COMPLETE: ${title || 'Meeting'}]\nDuration: ${durationMin} min | Attendees: ${attendeeNames || 'unknown'}\n\nSummary: ${shortSummary}\n\nAction Items: ${actionItems}\n\nTranscript:\n${condensed}\n\nYou are JARVIS. A meeting just ended. Provide:\n1. Your 2-3 sentence assessment of the key decisions/direction\n2. Anything you think was missed or under-discussed\n3. Concrete next steps you recommend\n4. Any concerns or risks you see\n\nBe direct and opinionated. This is your co-founder debrief.`;

            await bot.telegram.sendChatAction(chatId, 'typing');
            const response = await chat(chatId, 'fireflies-transcript', prompt, 'private');
            const jarvisText = response.text;

            // ============ Send to Telegram ============
            // Meeting header
            let tgHeader = `[Fireflies] Meeting: ${title || 'Meeting'}\n`;
            tgHeader += `Duration: ${durationMin}min | Speakers: ${speakers?.length || '?'}\n`;
            if (attendeeNames) tgHeader += `Attendees: ${attendeeNames}\n`;
            await bot.telegram.sendMessage(chatId, tgHeader);

            // AI summary
            if (shortSummary && shortSummary !== 'No summary available.') {
              await bot.telegram.sendMessage(chatId, `Summary: ${shortSummary.slice(0, 3000)}`);
            }

            // JARVIS analysis
            if (jarvisText) {
              const reply = `Jarvis: ${jarvisText}`;
              if (reply.length <= 4096) {
                await bot.telegram.sendMessage(chatId, reply);
              } else {
                for (let i = 0; i < reply.length; i += 4096) {
                  await bot.telegram.sendMessage(chatId, reply.slice(i, i + 4096));
                }
              }

              // TTS voice response
              try {
                const audioSegments = await googleTTS.getAllAudioBase64(jarvisText.slice(0, 500), {
                  lang: 'en', slow: false,
                  host: 'https://translate.google.co.uk',
                });
                const audioBuffers = audioSegments.map(seg => Buffer.from(seg.base64, 'base64'));
                const fullAudio = Buffer.concat(audioBuffers);
                const tmpFile = join(config.dataDir, `tts_${Date.now()}.mp3`);
                await writeFile(tmpFile, fullAudio);
                await bot.telegram.sendVoice(chatId, { source: tmpFile }, { caption: 'Jarvis' });
                await unlink(tmpFile).catch(() => {});
              } catch (ttsErr) {
                console.warn('[fireflies] TTS failed:', ttsErr.message);
              }
            }

            // Persist JARVIS response
            try {
              await appendFile(transcriptFile, `\n## JARVIS Analysis\n${jarvisText}\n`);
            } catch { /* ignore */ }

            console.log(`[fireflies] Meeting "${title}" processed — ${sentences?.length || 0} sentences, notes saved`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', title, sentences: sentences?.length || 0 }));
          } catch (err) {
            console.error('[fireflies] Webhook error:', err.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
        });

      // ============ Mini App Static Files ============
      // Serves the built Jarvis Shard Miner webapp at /app/*
      } else if (req.url?.startsWith('/app/') || req.url === '/app') {
        const WEBAPP_DIR = join(process.cwd(), 'webapp', 'dist');
        const CONTENT_TYPES = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.ico': 'image/x-icon',
          '.woff2': 'font/woff2',
          '.woff': 'font/woff',
        };

        try {
          let filePath = req.url.replace(/^\/app\/?/, '') || 'index.html';
          // SPA fallback: if no extension, serve index.html
          if (!filePath.includes('.')) filePath = 'index.html';

          const fullPath = join(WEBAPP_DIR, filePath);
          // Prevent directory traversal
          if (!fullPath.startsWith(WEBAPP_DIR)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
          }

          const content = await readFile(fullPath);
          const ext = '.' + filePath.split('.').pop();
          const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

          // Cache hashed assets immutably, index.html never
          const cacheControl = filePath === 'index.html'
            ? 'no-cache'
            : 'public, max-age=31536000, immutable';

          res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': cacheControl,
          });
          res.end(content);
        } catch (err) {
          // Fallback to index.html for SPA routing
          try {
            const content = await readFile(join(WEBAPP_DIR, 'index.html'));
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end(content);
          } catch {
            res.writeHead(404);
            res.end('Mini App not found. Run: cd webapp && npm run build');
          }
        }

      // ============ Web Portal API ============
      // Public-facing endpoints for the VibeSwap frontend.
      // Rate-limited per IP, CORS-restricted. No API secret needed.
      // ============ Voice Bridge ============
      } else if (req.url === '/voice') {
        try {
          const voiceHtml = await readFile(join(import.meta.dirname || '.', 'voice.html'), 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(voiceHtml);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Voice bridge unavailable: ' + err.message);
        }

      } else if (req.url?.startsWith('/web/')) {
        const webUrl = new URL(req.url, `http://localhost:${healthPort}`);
        const handled = await handleWebRequest(req, res, webUrl.pathname);
        if (!handled) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
        }

      // ============ Claude Code API Bridge ============
      // Direct HTTP communication — no human relay needed.
      // All /api/* routes require X-Api-Secret header.
      } else if (req.url?.startsWith('/api/')) {
        // Auth check
        const apiSecret = req.headers['x-api-secret'];
        if (!config.claudeCodeApiSecret || apiSecret !== config.claudeCodeApiSecret) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized. Set CLAUDE_CODE_API_SECRET on both sides.' }));
          return;
        }

        const url = new URL(req.url, `http://localhost:${healthPort}`);
        const path = url.pathname;

        // GET /api/status — Full JARVIS status
        if (path === '/api/status' && req.method === 'GET') {
          try {
            const report = await diagnoseContext();
            const monStatus = monitorAvailable && getMonitorStatus ? getMonitorStatus() : 'Monitor unavailable';
            const commsStats = getCommsStats();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              status: 'ok',
              uptime: process.uptime(),
              model: config.anthropic.model,
              context: { loaded: report.loaded.length, total: report.loaded.length + report.missing.length, chars: report.totalChars },
              monitor: monStatus,
              comms: commsStats,
              timestamp: new Date().toISOString(),
            }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }

        // GET /api/intel?group=NervosNation&count=50 — Group intel
        } else if (path === '/api/intel' && req.method === 'GET') {
          if (!monitorAvailable || !getMessagesForAnalysis) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Monitor not available' }));
            return;
          }
          const group = url.searchParams.get('group') || MONITORED_GROUPS[0] || 'NervosNation';
          const count = parseInt(url.searchParams.get('count') || '50');
          const messages = getMessagesForAnalysis(group, count);
          const report = formatIntelReport(group);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ group, messageCount: messages.length, messages, report }));

        // POST /api/message — Claude Code sends message/task to JARVIS
        } else if (path === '/api/message' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', async () => {
            try {
              const payload = JSON.parse(body);
              const entry = receiveFromClaudeCode(payload);
              await saveComms();

              // If it's a task or message that should be forwarded to Telegram
              if (payload.notify && config.ownerUserId) {
                const prefix = payload.type === 'task' ? '[Claude Code Task]' : '[Claude Code]';
                const content = typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content);
                const text = `${prefix}\n${content.slice(0, 3000)}`;
                try {
                  await bot.telegram.sendMessage(config.ownerUserId, text);
                } catch { /* notification is best-effort */ }
              }

              // If it's a task, process it with Claude and queue the result
              if (payload.type === 'task' && payload.content) {
                const taskContent = typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content);
                try {
                  const response = await chat(config.ownerUserId, 'claude-code-bridge', taskContent, 'private');
                  sendToClaudeCode('task_result', response.text, { taskId: entry.id });
                  markProcessed(entry.id);
                  await saveComms();
                } catch (err) {
                  sendToClaudeCode('task_error', err.message, { taskId: entry.id });
                  markProcessed(entry.id);
                  await saveComms();
                }
              } else {
                markProcessed(entry.id);
                await saveComms();
              }

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, id: entry.id }));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
          });

        // GET /api/outbox — Messages JARVIS has queued for Claude Code
        } else if (path === '/api/outbox' && req.method === 'GET') {
          const messages = getOutbox();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ count: messages.length, messages }));

        // POST /api/outbox/ack — Claude Code acknowledges receipt
        } else if (path === '/api/outbox/ack' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', async () => {
            try {
              const payload = JSON.parse(body);
              acknowledgeOutbox(payload.ids || 'all');
              await saveComms();
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true }));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
          });

        // GET /api/comms/log — Audit trail
        } else if (path === '/api/comms/log' && req.method === 'GET') {
          const count = parseInt(url.searchParams.get('count') || '20');
          const log = getCommsLog(count);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ count: log.length, log }));

        // POST /api/tg/send — Send a message to Telegram via JARVIS
        } else if (path === '/api/tg/send' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', async () => {
            try {
              const payload = JSON.parse(body);
              const chatId = payload.chatId || config.ownerUserId;
              const text = payload.text || payload.message || '';
              if (!text) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'text is required' }));
                return;
              }
              await bot.telegram.sendMessage(chatId, text, { parse_mode: undefined });
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, chatId }));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
          });

        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unknown API route', available: [
            'GET /api/status',
            'GET /api/intel?group=&count=',
            'POST /api/message',
            'GET /api/outbox',
            'POST /api/outbox/ack',
            'GET /api/comms/log?count=',
            'POST /api/tg/send',
            'POST /router/register',
            'POST /router/heartbeat',
            'GET /router/route/:userId',
            'GET /router/topology',
          ]}));
        }

      // ============ Shard Proxy Processing ============
      // Allows any shard (including primary) to process messages forwarded from peers
      } else if (req.url === '/shard/process' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const payload = JSON.parse(body);
            const response = await chat(
              payload.chatId || 'proxy',
              payload.userName || 'proxy',
              payload.text,
              payload.chatType || 'private'
            );
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, text: response.text, shardId: getShardInfo().id }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });

      // ============ Router API (Shard Network) ============
      } else if (req.url?.startsWith('/router/')) {
        const routerUrl = new URL(req.url, `http://localhost:${healthPort}`);
        const routerResult = handleRouterRequest(req, routerUrl);

        if (!routerResult) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unknown router route' }));
        } else if (routerResult.parse) {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const payload = JSON.parse(body);
              const data = processRouterBody(routerResult.handler, payload, routerResult.userId);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(data));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
          });
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(routerResult.data));
        }

      // ============ Consensus API (BFT + CRPC) ============
      } else if (req.url?.startsWith('/consensus/') || req.url?.startsWith('/crpc/')) {
        const reqUrl = new URL(req.url, `http://localhost:${healthPort}`);
        const path = reqUrl.pathname;

        // Consensus endpoints
        const consensusHandler = handleConsensusRequest(path, req.method);
        if (consensusHandler) {
          if (consensusHandler === 'state') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(getConsensusState()));
          } else {
            try {
              const body = await readBody(req);
              const payload = JSON.parse(body);
              const signature = req.headers['x-shard-signature'] || null;
              const data = await processConsensusBody(consensusHandler, payload, signature);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(data || { ok: true }));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
          }
          return;
        }

        // CRPC endpoints
        const crpcHandler = handleCRPCRequest(path, req.method);
        if (crpcHandler) {
          if (crpcHandler === 'stats') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(getCRPCStats()));
          } else {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const payload = JSON.parse(body);
                const data = processCRPCBody(crpcHandler, payload);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(data));
              } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
              }
            });
          }
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown consensus/crpc route' }));

      // ============ Knowledge Chain API ============
      } else if (req.url?.startsWith('/knowledge-chain/')) {
        const kcUrl = new URL(req.url, `http://localhost:${healthPort}`);
        const kcPath = kcUrl.pathname;
        const kcHandler = handleKnowledgeChainRequest(kcPath, req.method);

        if (!kcHandler) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unknown knowledge-chain route' }));
        } else if (kcHandler === 'epoch') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const payload = JSON.parse(body);
              const data = processKnowledgeChainBody(kcHandler, payload);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(data));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
          });
        } else {
          const query = Object.fromEntries(kcUrl.searchParams);
          const data = processKnowledgeChainBody(kcHandler, null, query);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    }).listen(healthPort, () => {
      console.log(`[jarvis] Health endpoint: http://0.0.0.0:${healthPort}/health`);
      console.log(`[jarvis] Transcript webhook: http://0.0.0.0:${healthPort}/transcript`);
      console.log(`[jarvis] Fireflies webhook: http://0.0.0.0:${healthPort}/fireflies ${config.fireflies?.apiKey ? '(API key set)' : '(no API key)'}`);
      console.log(`[jarvis] Claude Code API: http://0.0.0.0:${healthPort}/api/* ${config.claudeCodeApiSecret ? '(secured)' : '(NO SECRET SET — disabled)'}`);
      console.log(`[jarvis] Web Portal API: http://0.0.0.0:${healthPort}/web/* (public, rate-limited)`);
      console.log(`[jarvis] Mini App: http://0.0.0.0:${healthPort}/app/ (Telegram WebApp)`);
    });
  }

  // Register commands with Telegram (shows in command menu)
  try {
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Start JARVIS' },
      { command: 'whoami', description: 'Show your Telegram user info' },
      { command: 'mystats', description: 'Your contribution profile' },
      { command: 'groupstats', description: 'Group contribution stats' },
      { command: 'linkwallet', description: 'Link your wallet address' },
      { command: 'digest', description: 'Daily community digest' },
      { command: 'weeklydigest', description: 'Weekly community digest' },
      { command: 'archive', description: 'Archive current conversation thread' },
      { command: 'threads', description: 'View archived threads' },
      { command: 'brain', description: 'JARVIS intelligence stats' },
      { command: 'modlog', description: 'View moderation log' },
      { command: 'spamlog', description: 'View anti-spam log' },
      { command: 'health', description: 'JARVIS health check' },
      { command: 'model', description: 'Switch AI model (opus/sonnet)' },
      { command: 'clear', description: 'Clear conversation history' },
      { command: 'backlog', description: 'View/add suggestion backlog' },
      { command: 'learned', description: 'Learning stats' },
      { command: 'knowledge', description: 'View learned knowledge (add "group" for group)' },
      { command: 'skills', description: 'View skills learned from corrections' },
      { command: 'privacy', description: 'Encryption status (owner only)' },
      { command: 'inner', description: 'Inner dialogue / self-reflection (owner only)' },
      { command: 'shard', description: 'Shard identity and status (owner only)' },
      { command: 'network', description: 'Mind Network topology (owner only)' },
      { command: 'mine', description: 'Launch shard miner (Mini App)' },
      { command: 'balance', description: 'JUL balance, compute stats, CKB info' },
      { command: 'economy', description: 'Pool-level compute economics (owner)' },
      { command: 'tip', description: 'Tip jar address' },
    ]);
  } catch {}

  // Write running heartbeat
  await writeHeartbeat('running');

  // Notify owner of boot status
  try {
    const lines = ['JARVIS online.'];
    if (!lastShutdown.clean && !lastShutdown.firstBoot) {
      lines[0] = `JARVIS online. (unclean shutdown detected — down ~${lastShutdown.downtime}min)`;
    }
    lines.push(`Context: ${report.loaded.length}/${report.loaded.length + report.missing.length} files (${report.totalChars} chars)`);
    if (report.missing.length > 0) {
      lines.push(`Missing: ${report.missing.join(', ')}`);
    }
    lines.push(`Model: ${config.anthropic.model}`);
    lines.push(`Shard: ${shardResult.id} (${isMultiShard() ? 'multi' : 'single'}-shard)`);
    await bot.telegram.sendMessage(config.ownerUserId, lines.join('\n'));
  } catch (err) {
    console.warn(`[jarvis] Could not notify owner: ${err.message}`);
  }

  // Flush all data every 5 minutes — harmonic tick (all shards pulse at same wall-clock boundary)
  scheduleHarmonicTick(async () => {
    await flushTracker();
    await saveConversations();
    await flushModeration();
    await flushAntispam();
    await flushThreads();
    await flushLearning();
    // Inner dialogue: generate self-reflections (rate-limited to 1x/hour internally)
    try {
      const stats = await getLearningStats(config.ownerUserId, null);
      const skills = getSkills();
      await generateInnerDialogue(stats, skills);
    } catch (err) {
      console.warn(`[jarvis] Inner dialogue generation error: ${err.message}`);
    }
    await flushInnerDialogue();
    await flushShadow();
    await flushHell();
    await flushLimni();
    await flushContextMemory();
    // CKB compression: compress high-utilization CKBs periodically
    try {
      await compressCKB(config.ownerUserId);
    } catch {}
    pruneOldMessages();
    await saveComms();
    // Check shard health (mark dead shards, trigger failover)
    if (isMultiShard()) {
      checkShardHealth();
    }
    // Knowledge chain: produce epoch + sync + broadcast + retry missed
    const epoch = await produceEpoch();
    if (epoch && isMultiShard()) {
      await broadcastEpoch(epoch);
      await retryMissedEpochs();
      await syncWithPeers();
    }
  }, 5 * 60 * 1000);

  // Scheduled daily digest — send at configured hour (default 18:00 UTC)
  const digestHour = config.digestHour || 18;
  setInterval(async () => {
    const now = new Date();
    if (now.getUTCHours() === digestHour && now.getUTCMinutes() === 0) {
      if (config.communityGroupId) {
        try {
          const digest = await generateDigest(config.communityGroupId);
          if (digest) {
            await bot.telegram.sendMessage(config.communityGroupId, digest);
          }
        } catch {}
      }
    }
  }, 60 * 1000); // Check every minute

  // Auto-sync: pull from git + reload context periodically
  if (config.autoSyncInterval > 0) {
    setInterval(async () => {
      try {
        const pullResult = await gitPull();
        if (!pullResult.includes('0 changes, 0 insertions, 0 deletions')) {
          await reloadSystemPrompt();
        }
      } catch {}
    }, config.autoSyncInterval);
  }

  if (config.autoBackupInterval > 0) {
    setInterval(async () => {
      try { await backupData(); } catch {}
    }, config.autoBackupInterval);
  }

  // Heartbeat: update every 5 minutes to prove we're alive
  setInterval(() => writeHeartbeat('running'), 5 * 60 * 1000);

  // Graceful shutdown — save everything + mark clean shutdown
  async function gracefulShutdown(signal) {
    console.log(`[jarvis] Shutting down (${signal}) — saving all data...`);
    await shutdownShard(); // Notify router before stopping
    await flushTracker();
    await saveConversations();
    await flushModeration();
    await flushAntispam();
    await flushThreads();
    await flushLearning();
    await flushInnerDialogue();
    await flushShadow();
    await flushComputeEconomics();
    await flushMining();
    await saveComms();
    await writeHeartbeat('stopped');
    bot.stop(signal);
  }
  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

// ============ Persistent Crash Log ============
// Writes errors to DATA_DIR so they survive restarts.
// Fly.io logs are ephemeral — this is the permanent record.

const CRASH_LOG_FILE = join(config.dataDir, 'crash-log.jsonl');
const MAX_CRASH_LOG_BYTES = 512 * 1024; // 512KB cap

async function persistCrashEntry(type, error) {
  const entry = {
    type,
    timestamp: new Date().toISOString(),
    message: error?.message || String(error),
    stack: error?.stack || null,
    uptime: process.uptime(),
    pid: process.pid,
    memory: process.memoryUsage(),
  };
  const line = JSON.stringify(entry) + '\n';
  try {
    // Rotate if too large
    try {
      const { size } = await import('fs').then(fs => fs.promises.stat(CRASH_LOG_FILE));
      if (size > MAX_CRASH_LOG_BYTES) {
        const data = await readFile(CRASH_LOG_FILE, 'utf-8');
        const lines = data.trim().split('\n');
        // Keep the most recent half
        await writeFile(CRASH_LOG_FILE, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n');
      }
    } catch { /* file doesn't exist yet */ }
    await appendFile(CRASH_LOG_FILE, line);
  } catch { /* last resort — can't write to disk */ }
}

// ============ Process-Level Crash Guards ============
// Prevent transient errors (API timeouts, network blips, Telegram errors)
// from killing the entire process. Log to console AND persistent file.

process.on('uncaughtException', (err) => {
  console.error('[jarvis] UNCAUGHT EXCEPTION (process survived):', err.message);
  console.error(err.stack);
  persistCrashEntry('uncaughtException', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[jarvis] UNHANDLED REJECTION (process survived):', reason);
  persistCrashEntry('unhandledRejection', reason instanceof Error ? reason : { message: String(reason) });
});

main().catch((err) => {
  console.error('[jarvis] FATAL — main() crashed:', err.message);
  console.error(err.stack);
  persistCrashEntry('fatal', err).finally(() => {
    // If main() itself fails (startup error), exit so Fly restarts us
    process.exit(1);
  });
});
