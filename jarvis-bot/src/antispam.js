import { createHash } from 'crypto';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';

const DATA_DIR = config.dataDir;
const SPAM_LOG_FILE = join(DATA_DIR, 'spam-log.json');

// ============ State ============

// Per-user message tracking for flood detection
const recentMessages = new Map(); // userId -> [{ text, timestamp }]
let spamLog = [];

// ============ Scam Patterns ============

const SCAM_PATTERNS = [
  // Airdrop/giveaway scams
  /free\s*(airdrop|token|nft|crypto|eth|btc|giveaway)/i,
  /claim\s*(your|free)\s*(airdrop|token|reward|nft)/i,
  /airdrop.*connect.*wallet/i,
  // Phishing links
  /dappradar\.|pancakeswap\.|uniswap\.org\.|metamask\.|trustwallet\./i,
  // "Send me crypto" scams
  /send\s*\d+\s*(eth|btc|bnb|usdt|sol)\s*(to|and)/i,
  /double\s*your\s*(eth|btc|crypto|investment)/i,
  // Impersonation
  /official\s*(admin|support|team|moderator)/i,
  /i\s*am\s*(from|the)\s*(support|team|admin)/i,
  // Pump and dump
  /100x\s*gem/i,
  /guaranteed\s*(profit|return|gain)/i,
  /next\s*1000x/i,
  // Telegram redirect scams
  /t\.me\/(?!vibeswap)/i, // Any telegram link that isn't VibeSwap
  // Wallet drainer patterns
  /connect.*wallet.*claim/i,
  /verify.*wallet.*reward/i,
  /approve.*token.*unlimited/i,
];

const LINK_PATTERN = /https?:\/\/[^\s]+/i;

// ============ Detection ============

function isScamMessage(text) {
  for (const pattern of SCAM_PATTERNS) {
    if (pattern.test(text)) {
      return { detected: true, reason: `Matched scam pattern: ${pattern.source}` };
    }
  }
  return { detected: false };
}

function isFlood(userId, text, now) {
  if (!recentMessages.has(userId)) {
    recentMessages.set(userId, []);
  }

  const history = recentMessages.get(userId);

  // Clean old messages (older than 60s)
  while (history.length > 0 && now - history[0].timestamp > 60000) {
    history.shift();
  }

  history.push({ text, timestamp: now });

  // More than 5 messages in 10 seconds = flood
  const last10s = history.filter(m => now - m.timestamp < 10000);
  if (last10s.length > 5) {
    return { detected: true, reason: `Flood: ${last10s.length} messages in 10s` };
  }

  // Same message 3+ times in 60 seconds = spam
  const duplicates = history.filter(m => m.text === text);
  if (duplicates.length >= 3) {
    return { detected: true, reason: `Duplicate spam: same message ${duplicates.length}x in 60s` };
  }

  return { detected: false };
}

function isNewAccountLinkSpam(user, text, joinDate) {
  // New account (less than 24h in group) posting links = suspicious
  if (!LINK_PATTERN.test(text)) return { detected: false };

  const accountAge = Date.now() - (joinDate || 0);
  const isNew = accountAge < 24 * 60 * 60 * 1000; // Less than 24h

  // No username is a red flag combined with links
  const noUsername = !user.username;

  if (isNew && noUsername) {
    return { detected: true, reason: 'New account with no username posting links' };
  }

  return { detected: false };
}

// ============ Core ============

function createEvidenceHash(action, userId, chatId, reason) {
  return createHash('sha256')
    .update(`antispam:${action}:${userId}:${chatId}:${reason}:${Date.now()}`)
    .digest('hex');
}

export async function checkMessage(bot, ctx) {
  if (!ctx.message?.text) return { action: 'allow' };
  if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') return { action: 'allow' };

  const user = ctx.from;
  if (user.is_bot) return { action: 'allow' };

  const text = ctx.message.text;
  const userId = user.id;
  const chatId = ctx.chat.id;
  const now = Date.now();

  // Check 1: Known scam patterns → ban
  const scam = isScamMessage(text);
  if (scam.detected) {
    return await executeAction(bot, chatId, userId, 'ban', scam.reason, ctx.message.message_id);
  }

  // Check 2: Flood detection → mute 10min
  const flood = isFlood(userId, text, now);
  if (flood.detected) {
    return await executeAction(bot, chatId, userId, 'mute', flood.reason, ctx.message.message_id);
  }

  // Check 3: New account link spam → delete + mute 1hr
  const linkSpam = isNewAccountLinkSpam(user, text);
  if (linkSpam.detected) {
    return await executeAction(bot, chatId, userId, 'mute', linkSpam.reason, ctx.message.message_id);
  }

  return { action: 'allow' };
}

async function executeAction(bot, chatId, userId, action, reason, messageId) {
  const evidenceHash = createEvidenceHash(action, userId, chatId, reason);

  const entry = {
    action,
    userId,
    chatId,
    reason,
    moderatorId: 'jarvis-antispam',
    evidenceHash,
    timestamp: Date.now(),
  };

  // Delete the offending message
  try {
    await bot.telegram.deleteMessage(chatId, messageId);
    entry.messageDeleted = true;
  } catch {
    entry.messageDeleted = false;
  }

  // Execute moderation action
  try {
    if (action === 'ban') {
      await bot.telegram.banChatMember(chatId, userId);
      entry.executed = true;
    } else if (action === 'mute') {
      const duration = reason.includes('Flood') ? 600 : 3600; // 10min for flood, 1hr otherwise
      await bot.telegram.restrictChatMember(chatId, userId, {
        permissions: {
          can_send_messages: false,
          can_send_media_messages: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false,
        },
        until_date: Math.floor((Date.now() + duration * 1000) / 1000),
      });
      entry.executed = true;
      entry.duration = duration;
    }
  } catch (err) {
    entry.executed = false;
    entry.error = err.message;
  }

  spamLog.push(entry);

  return { action, reason, evidenceHash, executed: entry.executed };
}

// ============ Init + Flush ============

export async function initAntispam() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const data = await readFile(SPAM_LOG_FILE, 'utf-8');
    spamLog = JSON.parse(data);
  } catch {
    spamLog = [];
  }
  console.log(`[antispam] Loaded ${spamLog.length} spam actions`);
}

export async function flushAntispam() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    // Keep last 1000 entries to prevent unbounded growth
    const toSave = spamLog.slice(-1000);
    await writeFile(SPAM_LOG_FILE, JSON.stringify(toSave, null, 2));
  } catch {}
}

export function getSpamLog(chatId, limit = 10) {
  return spamLog
    .filter(e => !chatId || e.chatId === chatId)
    .slice(-limit);
}
