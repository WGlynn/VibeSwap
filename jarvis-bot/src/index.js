import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { initClaude, chat, reloadSystemPrompt, clearHistory } from './claude.js';
import { gitStatus, gitPull, gitCommitAndPush, gitLog } from './git.js';

if (!config.telegram.token) {
  console.error('TELEGRAM_BOT_TOKEN is required. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (!config.anthropic.apiKey) {
  console.error('ANTHROPIC_API_KEY is required. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const bot = new Telegraf(config.telegram.token);

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
  ctx.reply(
    'JARVIS online.\n\n' +
    'Commands:\n' +
    '/status — git status\n' +
    '/pull — git pull\n' +
    '/log — recent commits\n' +
    '/commit <message> — commit and push to both remotes\n' +
    '/refresh — reload memory files\n' +
    '/clear — clear conversation history\n' +
    '/model <opus|sonnet> — switch model\n' +
    '/whoami — show your Telegram user ID\n\n' +
    'Or just talk to me.'
  );
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

// ============ Message Handler ============

bot.on('text', async (ctx) => {
  if (!isAuthorized(ctx)) return unauthorized(ctx);

  // Skip commands (already handled above)
  if (ctx.message.text.startsWith('/')) return;

  const chatId = ctx.chat.id;
  const userName = ctx.from.username || ctx.from.first_name || 'Unknown';

  // Show typing indicator
  await ctx.sendChatAction('typing');

  // Keep typing indicator alive for long responses
  const typingInterval = setInterval(() => {
    ctx.sendChatAction('typing').catch(() => {});
  }, 4000);

  try {
    const response = await chat(chatId, userName, ctx.message.text);

    clearInterval(typingInterval);

    // Telegram has a 4096 char limit per message
    const text = response.text;
    if (text.length <= 4096) {
      await ctx.reply(text, { parse_mode: undefined });
    } else {
      // Split into chunks
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

  console.log(`[jarvis] Model: ${config.anthropic.model}`);
  console.log('[jarvis] Starting Telegram bot...');

  bot.launch();
  console.log('[jarvis] JARVIS is online.');

  // Graceful shutdown
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch(console.error);
