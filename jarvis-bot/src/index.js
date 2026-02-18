import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { initClaude, chat, bufferMessage, reloadSystemPrompt, clearHistory, saveConversations } from './claude.js';
import { gitStatus, gitPull, gitCommitAndPush, gitLog, backupData } from './git.js';
import { initTracker, trackMessage, linkWallet, getUserStats, getGroupStats, flushTracker } from './tracker.js';
import { diagnoseContext } from './memory.js';
import { initModeration, warnUser, muteUser, unmuteUser, banUser, unbanUser, getModerationLog, flushModeration } from './moderation.js';

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
  if (!isAuthorized(ctx)) return unauthorized(ctx);
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
  if (!isAuthorized(ctx)) return unauthorized(ctx);
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
  if (!isAuthorized(ctx)) return unauthorized(ctx);
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
  if (!isAuthorized(ctx)) return unauthorized(ctx);
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
  if (!isAuthorized(ctx)) return unauthorized(ctx);
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

// ============ Message Handler ============

bot.on('text', async (ctx) => {
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
    // In groups: buffer into conversation history for situational awareness, but don't call Claude
    const userName = ctx.from.username || ctx.from.first_name || 'Unknown';
    bufferMessage(ctx.chat.id, userName, ctx.message.text);
    return;
  }

  if (!isAuthorized(ctx)) return unauthorized(ctx);

  const chatId = ctx.chat.id;
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';

  // Show typing indicator
  await ctx.sendChatAction('typing');

  const typingInterval = setInterval(() => {
    ctx.sendChatAction('typing').catch(() => {});
  }, 4000);

  try {
    const response = await chat(chatId, userName, ctx.message.text);

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

  // Step 2: Load context, conversation history, moderation log
  console.log('[jarvis] Step 2: Loading memory, conversations, moderation...');
  await initClaude();
  await initTracker();
  await initModeration();

  // Step 3: Context diagnosis
  const report = await diagnoseContext();
  console.log(`[jarvis] Context: ${report.loaded.length} files loaded (${report.totalChars} chars)`);
  if (report.missing.length > 0) {
    console.warn(`[jarvis] WARNING — Missing context files: ${report.missing.join(', ')}`);
  }

  console.log(`[jarvis] Model: ${config.anthropic.model}`);
  console.log('[jarvis] Step 3: Starting Telegram bot...');

  bot.launch();
  console.log('[jarvis] ============ JARVIS IS ONLINE ============');

  // Flush all data every 5 minutes (tracker + conversations + moderation)
  setInterval(async () => {
    await flushTracker();
    await saveConversations();
    await flushModeration();
  }, 5 * 60 * 1000);

  // Auto-sync: pull from git + reload context periodically
  if (config.autoSyncInterval > 0) {
    const syncMins = Math.round(config.autoSyncInterval / 60000);
    console.log(`[jarvis] Auto-sync enabled: every ${syncMins} minutes`);
    setInterval(async () => {
      try {
        const pullResult = await gitPull();
        console.log(`[jarvis] Auto-sync: ${pullResult}`);
        await reloadSystemPrompt();
        console.log('[jarvis] Auto-sync: context reloaded');
      } catch (err) {
        console.warn(`[jarvis] Auto-sync failed: ${err.message}`);
      }
    }, config.autoSyncInterval);
  }

  // Auto-backup: commit data files to git periodically
  if (config.autoBackupInterval > 0) {
    const backupHrs = Math.round(config.autoBackupInterval / 3600000);
    console.log(`[jarvis] Auto-backup enabled: every ${backupHrs} hours`);
    setInterval(async () => {
      try {
        const result = await backupData();
        console.log(`[jarvis] Auto-backup: ${result}`);
      } catch (err) {
        console.warn(`[jarvis] Auto-backup failed: ${err.message}`);
      }
    }, config.autoBackupInterval);
  }

  // Graceful shutdown — save everything
  process.once('SIGINT', async () => {
    console.log('[jarvis] Shutting down — saving all data...');
    await flushTracker();
    await saveConversations();
    await flushModeration();
    bot.stop('SIGINT');
  });
  process.once('SIGTERM', async () => {
    console.log('[jarvis] Shutting down — saving all data...');
    await flushTracker();
    await saveConversations();
    await flushModeration();
    bot.stop('SIGTERM');
  });
}

main().catch(console.error);
