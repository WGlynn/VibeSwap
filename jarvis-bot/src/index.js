import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { initClaude, chat, bufferMessage, reloadSystemPrompt, clearHistory } from './claude.js';
import { gitStatus, gitPull, gitCommitAndPush, gitLog } from './git.js';
import { initTracker, trackMessage, linkWallet, getUserStats, getGroupStats, flushTracker } from './tracker.js';

if (!config.telegram.token) {
  console.error('TELEGRAM_BOT_TOKEN is required. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (!config.anthropic.apiKey) {
  console.error('ANTHROPIC_API_KEY is required. Copy .env.example to .env and fill it in.');
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
  console.log('[jarvis] Loading memory...');
  await initClaude();
  await initTracker();

  console.log(`[jarvis] Model: ${config.anthropic.model}`);
  console.log('[jarvis] Starting Telegram bot...');

  bot.launch();
  console.log('[jarvis] JARVIS is online. Contribution tracking active.');

  // Flush tracker data every 5 minutes
  setInterval(() => flushTracker(), 5 * 60 * 1000);

  // Graceful shutdown
  process.once('SIGINT', async () => {
    await flushTracker();
    bot.stop('SIGINT');
  });
  process.once('SIGTERM', async () => {
    await flushTracker();
    bot.stop('SIGTERM');
  });
}

main().catch(console.error);
