import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { initClaude, chat, bufferMessage, reloadSystemPrompt, clearHistory, saveConversations, getSystemPrompt } from './claude.js';
import { gitStatus, gitPull, gitCommitAndPush, gitLog, backupData } from './git.js';
import { initTracker, trackMessage, linkWallet, getUserStats, getGroupStats, getAllUsers, flushTracker } from './tracker.js';
import { diagnoseContext } from './memory.js';
import { initModeration, warnUser, muteUser, unmuteUser, banUser, unbanUser, getModerationLog, flushModeration } from './moderation.js';
import { checkMessage, initAntispam, flushAntispam, getSpamLog } from './antispam.js';
import { generateDigest, generateWeeklyDigest } from './digest.js';
import { analyzeMessage, generateProactiveResponse, evaluateModeration, getIntelligenceStats } from './intelligence.js';
import { initThreads, trackForThread, shouldSuggestArchival, archiveThread, getRecentThreads, getThreadStats, flushThreads } from './threads.js';
import { loadBehavior, getFlag, setFlag, listFlags } from './behavior.js';
import { createServer } from 'http';
import { writeFile, readFile, mkdir, unlink, appendFile } from 'fs/promises';
import { join } from 'path';
import googleTTS from 'google-tts-api';

const HEARTBEAT_FILE = join(config.dataDir, 'heartbeat.json');

// ============ Startup Checks ============
// Graceful degradation: diagnose what's available instead of hard crash

if (!config.telegram.token) {
  console.error('============================================================');
  console.error('TELEGRAM_BOT_TOKEN is missing.');
  console.error('');
  console.error('To fix:');
  console.error('  1. Go to @BotFather on Telegram');
  console.error('  2. Create or select a bot');
  console.error('  3. Copy the token');
  console.error('  4. Set it in jarvis-bot/.env as TELEGRAM_BOT_TOKEN=...');
  console.error('');
  console.error('Your context and contribution data are INTACT:');
  console.error('  - jarvis-bot/data/contributions.json (contribution history)');
  console.error('  - jarvis-bot/data/users.json (user registry)');
  console.error('  - jarvis-bot/data/conversations.json (chat history)');
  console.error('  - CLAUDE.md + SESSION_STATE.md + memory files (project context)');
  console.error('');
  console.error('Nothing is lost. Just add the token and restart.');
  console.error('============================================================');
  process.exit(1);
}
if (!config.anthropic.apiKey) {
  console.error('ANTHROPIC_API_KEY is required. Copy .env.example to .env and fill it in.');
  console.error('All local data (contributions, conversations, users) is safe.');
  process.exit(1);
}

const bot = new Telegraf(config.telegram.token, {
  telegram: { allowedUpdates: ['message', 'callback_query'] },
});

// Auth middleware
function isAuthorized(ctx) {
  if (config.authorizedUsers.length === 0) return true;
  return config.authorizedUsers.includes(ctx.from.id);
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

bot.command('start', (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);
  ctx.reply('JARVIS online. Just talk to me.');
});

bot.command('whoami', (ctx) => {
  ctx.reply(`User ID: ${ctx.from.id}\nUsername: ${ctx.from.username || 'none'}\nName: ${ctx.from.first_name}`);
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

// ============ Message Handler ============

bot.on('text', async (ctx) => {
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

    // Proactive intelligence — analyze and maybe respond autonomously
    if (msgText.length >= 20) {
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
    }

    return;
  }

  if (!isAuthorized(ctx)) return unauthorized(ctx);

  // Rate limit Claude API calls (owner exempt)
  if (!isOwner(ctx) && isRateLimited(ctx.from.id)) {
    return ctx.reply('Slow down — too many requests. Try again in a minute.');
  }

  const chatId = ctx.chat.id;
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';

  // Show typing indicator
  await ctx.sendChatAction('typing');

  const typingInterval = setInterval(() => {
    ctx.sendChatAction('typing').catch(() => {});
  }, 4000);

  try {
    const response = await chat(chatId, userName, ctx.message.text, ctx.chat.type);

    clearInterval(typingInterval);

    // Save conversation after every Claude response (resilience)
    await saveConversations();

    const text = response.text;
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
    ctx.reply(`Error: ${error.message}`);
  }
});

// ============ Startup ============

async function main() {
  console.log('[jarvis] ============ STARTUP ============');

  // Step 1: Pull latest from git BEFORE loading context
  console.log('[jarvis] Step 1: Syncing from git...');
  try {
    const pullResult = await gitPull();
    console.log(`[jarvis] Git: ${pullResult}`);
  } catch (err) {
    console.warn(`[jarvis] Git pull failed (will use local files): ${err.message}`);
  }

  // Step 2: Load context, conversation history, moderation log, threads
  console.log('[jarvis] Step 2: Loading memory, conversations, moderation, threads...');
  await initClaude();
  await initTracker();
  await initModeration();
  await initAntispam();
  await initThreads();
  await loadBehavior();
  console.log('[jarvis] Behavior flags loaded.');

  // Step 3: Context diagnosis
  const report = await diagnoseContext();
  console.log(`[jarvis] Context: ${report.loaded.length} files loaded (${report.totalChars} chars)`);
  if (report.missing.length > 0) {
    console.warn(`[jarvis] WARNING — Missing context files: ${report.missing.join(', ')}`);
  }

  // Step 4: Check for unclean shutdown
  const lastShutdown = await checkLastShutdown();
  if (!lastShutdown.clean && !lastShutdown.firstBoot) {
    console.warn(`[jarvis] WARNING: Unclean shutdown detected. Last seen: ${lastShutdown.lastSeen}, downtime: ~${lastShutdown.downtime}min`);
  }

  console.log(`[jarvis] Model: ${config.anthropic.model}`);
  console.log('[jarvis] Step 4: Starting Telegram bot...');

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
            model: config.anthropic.model,
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
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    }).listen(healthPort, () => {
      console.log(`[jarvis] Health endpoint: http://0.0.0.0:${healthPort}/health`);
      console.log(`[jarvis] Transcript webhook: http://0.0.0.0:${healthPort}/transcript`);
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
    await bot.telegram.sendMessage(config.ownerUserId, lines.join('\n'));
  } catch (err) {
    console.warn(`[jarvis] Could not notify owner: ${err.message}`);
  }

  // Flush all data every 5 minutes (tracker + conversations + moderation + threads)
  setInterval(async () => {
    await flushTracker();
    await saveConversations();
    await flushModeration();
    await flushAntispam();
    await flushThreads();
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
    await flushTracker();
    await saveConversations();
    await flushModeration();
    await flushAntispam();
    await flushThreads();
    await writeHeartbeat('stopped');
    bot.stop(signal);
  }
  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

main().catch(console.error);
