import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { config } from './config.js';

const DATA_DIR = config.dataDir;
const MOD_LOG_FILE = join(DATA_DIR, 'moderation.json');
const MOD_POLICY_FILE = join(DATA_DIR, 'moderation-policy.json');

// ============ State ============

let moderationLog = [];
let policy = null;

// ============ Init ============

export async function initModeration() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
  } catch {}

  moderationLog = await loadJson(MOD_LOG_FILE, []);
  policy = await loadJson(MOD_POLICY_FILE, getDefaultPolicy());

  console.log(`[moderation] Loaded ${moderationLog.length} moderation actions, policy v${policy.version}`);
}

async function loadJson(path, fallback) {
  try {
    const data = await readFile(path, 'utf-8');
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

async function saveModLog() {
  await writeFile(MOD_LOG_FILE, JSON.stringify(moderationLog, null, 2));
}

// ============ Default Policy ============

function getDefaultPolicy() {
  return {
    version: 1,
    // Jarvis is the sole admin — no human bias
    // All moderation goes through Jarvis, logged with evidence hashes
    rules: [
      { id: 'spam', description: 'Repeated identical messages or promotional content', action: 'mute', duration: 3600 },
      { id: 'harassment', description: 'Targeted personal attacks or threats', action: 'ban', duration: 0 },
      { id: 'scam', description: 'Phishing links, fake token promotions, impersonation', action: 'ban', duration: 0 },
      { id: 'offtopic', description: 'Persistent off-topic content after warning', action: 'mute', duration: 1800 },
      { id: 'nsfw', description: 'Explicit or inappropriate content', action: 'mute', duration: 7200 },
    ],
    // Warnings before escalation
    warningThreshold: 3,
    // Trusted users (high ContributionDAG score) get leniency
    trustedUserLeniency: true,
    // All actions require a reason — no silent moderation
    requireReason: true,
  };
}

// ============ Core Moderation Actions ============

function createEvidenceHash(action, userId, chatId, reason) {
  return createHash('sha256')
    .update(`${action}:${userId}:${chatId}:${reason}:${Date.now()}`)
    .digest('hex');
}

export async function warnUser(bot, chatId, userId, reason, moderatorId) {
  const evidenceHash = createEvidenceHash('warn', userId, chatId, reason);

  const entry = {
    action: 'warn',
    userId,
    chatId,
    reason,
    moderatorId, // who requested the action (or 'auto' for Jarvis-initiated)
    evidenceHash,
    timestamp: Date.now(),
    reversed: false,
  };

  moderationLog.push(entry);
  await saveModLog();

  // Count active warnings for this user in this chat
  const warnings = getActiveWarnings(chatId, userId);

  // Auto-escalate if threshold reached
  if (warnings.length >= policy.warningThreshold) {
    const muteResult = await muteUser(bot, chatId, userId, 3600, `Auto-escalation: ${policy.warningThreshold} warnings reached`, 'auto');
    return { ...entry, warnings: warnings.length, escalated: true, muteResult };
  }

  return { ...entry, warnings: warnings.length, escalated: false };
}

export async function muteUser(bot, chatId, userId, durationSeconds, reason, moderatorId) {
  const evidenceHash = createEvidenceHash('mute', userId, chatId, reason);

  const entry = {
    action: 'mute',
    userId,
    chatId,
    reason,
    moderatorId,
    evidenceHash,
    timestamp: Date.now(),
    duration: durationSeconds,
    expiresAt: Date.now() + (durationSeconds * 1000),
    reversed: false,
  };

  // Execute the restriction via Telegram API
  try {
    const until = Math.floor(entry.expiresAt / 1000);
    await bot.telegram.restrictChatMember(chatId, userId, {
      permissions: {
        can_send_messages: false,
        can_send_media_messages: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
      },
      until_date: until,
    });
    entry.executed = true;
  } catch (err) {
    entry.executed = false;
    entry.error = err.message;
  }

  moderationLog.push(entry);
  await saveModLog();
  return entry;
}

export async function unmuteUser(bot, chatId, userId, reason, moderatorId) {
  const evidenceHash = createEvidenceHash('unmute', userId, chatId, reason);

  const entry = {
    action: 'unmute',
    userId,
    chatId,
    reason,
    moderatorId,
    evidenceHash,
    timestamp: Date.now(),
    reversed: false,
  };

  try {
    await bot.telegram.restrictChatMember(chatId, userId, {
      permissions: {
        can_send_messages: true,
        can_send_media_messages: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
      },
    });
    entry.executed = true;
  } catch (err) {
    entry.executed = false;
    entry.error = err.message;
  }

  moderationLog.push(entry);
  await saveModLog();
  return entry;
}

export async function banUser(bot, chatId, userId, reason, moderatorId) {
  const evidenceHash = createEvidenceHash('ban', userId, chatId, reason);

  const entry = {
    action: 'ban',
    userId,
    chatId,
    reason,
    moderatorId,
    evidenceHash,
    timestamp: Date.now(),
    reversed: false,
  };

  try {
    await bot.telegram.banChatMember(chatId, userId);
    entry.executed = true;
  } catch (err) {
    entry.executed = false;
    entry.error = err.message;
  }

  moderationLog.push(entry);
  await saveModLog();
  return entry;
}

export async function unbanUser(bot, chatId, userId, reason, moderatorId) {
  const evidenceHash = createEvidenceHash('unban', userId, chatId, reason);

  const entry = {
    action: 'unban',
    userId,
    chatId,
    reason,
    moderatorId,
    evidenceHash,
    timestamp: Date.now(),
    reversed: false,
  };

  try {
    await bot.telegram.unbanChatMember(chatId, userId);
    entry.executed = true;
  } catch (err) {
    entry.executed = false;
    entry.error = err.message;
  }

  moderationLog.push(entry);
  await saveModLog();
  return entry;
}

// ============ Query Functions ============

export function getActiveWarnings(chatId, userId) {
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  return moderationLog.filter(e =>
    e.action === 'warn' &&
    e.chatId === chatId &&
    e.userId === userId &&
    e.timestamp > oneDayAgo &&
    !e.reversed
  );
}

export function getModerationLog(chatId, limit = 20) {
  return moderationLog
    .filter(e => !chatId || e.chatId === chatId)
    .slice(-limit);
}

export function getUserModerationHistory(userId) {
  return moderationLog.filter(e => e.userId === userId);
}

export function getPolicy() {
  return { ...policy };
}

// ============ Flush ============

export async function flushModeration() {
  await saveModLog();
}
