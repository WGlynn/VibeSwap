// ============ Runtime Directive System ============
//
// Jarvis follows behavioral directives from team members in group chats.
// Any user can set a directive for the chat they're in. Directives persist
// across restarts until overridden by a new directive.
//
// Modes:
//   'normal'   — default behavior, full proactive engagement
//   'tag-only' — only respond when @mentioned or replied to
//   'quiet'    — complete silence (only directive changes processed)
//
// Detection:
//   When Jarvis is addressed (mention/reply/name), the message is checked
//   for directive patterns BEFORE generating a response. This means users
//   can always change the mode, even when Jarvis is in quiet mode.
//
// Enforcement:
//   shouldSuppress(chatId, triggerType) is checked at every output pathway:
//   - Text handler (proactive, name triggers, archive, XP)
//   - Autonomous system (boredom, impulse, market)
//   - Scheduler (briefings, alerts)
// ============

import { config } from './config.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = config.dataDir;
const DIRECTIVES_FILE = join(DATA_DIR, 'directives.json');

// Per-chat behavioral directives
// { "chatId": { mode, setBy: { id, username }, setAt, reason } }
let directives = {};

const MODES = ['normal', 'tag-only', 'quiet'];

// ============ Pattern Detection ============
// Patterns are checked against the message text AFTER stripping @mentions
// and bot name prefix. Organized by mode, checked in order.

const DIRECTIVE_PATTERNS = [
  { mode: 'tag-only', patterns: [
    /only (?:respond|reply|speak|talk|answer|say\b|post|message) (?:when|if) (?:you(?:'re|'re| are)? )?(?:tagged|mentioned|@|pinged)/i,
    /don'?t (?:say|speak|respond|reply|talk|post|message|type|chime) (?:anything |nothing |in )?(?:unless|until|except) (?:you(?:'re|'re| are)? )?(?:tagged|mentioned|@|pinged)/i,
    /tag[\s-]?only(?: mode)?/i,
    /mention[\s-]?only(?: mode)?/i,
    /wait for (?:a )?tag/i,
    /no (?:proactive|unsolicited|autonomous|random|unprompted) (?:messages?|responses?|replies?|posts?|engagement)/i,
    /don'?t (?:talk|speak|respond|reply|say anything|chime in|engage) unless (?:someone )?(?:tags?|mentions?|@|pings?)/i,
    /stay quiet unless (?:tagged|mentioned|@|pinged)/i,
    /only (?:talk|speak|engage|chime in) (?:when|if) (?:tagged|mentioned|@|pinged)/i,
  ]},
  { mode: 'quiet', patterns: [
    /^(?:shut up|be quiet|mute(?: yourself)?|silence|stfu|stop talking|stop responding|go away|go silent|quiet down)[.!?]*$/i,
    /don'?t (?:say|speak|respond|reply|talk|post|message|type) (?:anything|at all|ever|a word|a thing)[.!?]*$/i,
    /^(?:mute|quiet|silent|silence)[.!?]*$/i,
    /complete(?:ly)? (?:silent|quiet|mute)/i,
    /zero (?:messages?|responses?|engagement)/i,
  ]},
  { mode: 'normal', patterns: [
    /you can (?:talk|speak|respond|reply|engage|be proactive) (?:again|now|freely)/i,
    /(?:unmute|un-mute|back to normal|resume|normal mode)/i,
    /^(?:come back|you(?:'re|'re| are) (?:free|good|unmuted|back)|go ahead)[.!?]*$/i,
    /be (?:proactive|active|normal|yourself) (?:again)?/i,
    /(?:proactive|autonomous) (?:mode )?(?:on|enabled?|back|restored)/i,
    /you(?:'re|'re| are) (?:free|allowed) to (?:talk|speak|respond|engage)/i,
    /full (?:engagement|mode)/i,
  ]},
];

/**
 * Detect if a message is a behavioral directive.
 * @param {string} text - Raw message text
 * @returns {{ mode: string, matchedText: string } | null}
 */
export function detectDirective(text) {
  if (!text || text.length < 2) return null;

  // Strip @mentions and bot name prefix for cleaner matching
  const cleaned = text
    .replace(/@\w+/g, '')
    .replace(/^(?:jarvis|jar|j)\s*[,.:!?\-—]\s*/i, '')
    .trim();

  if (cleaned.length < 2) return null;

  for (const { mode, patterns } of DIRECTIVE_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(cleaned)) {
        return { mode, matchedText: cleaned };
      }
    }
  }
  return null;
}

// ============ State Management ============

/**
 * Get the behavioral mode for a chat.
 * Checks runtime directives first, then falls back to TAG_ONLY_CHAT_IDS env var.
 * @param {number} chatId
 * @returns {'normal' | 'tag-only' | 'quiet'}
 */
export function getChatMode(chatId) {
  const directive = directives[String(chatId)];
  if (directive && directive.mode) return directive.mode;

  // Fallback: TAG_ONLY_CHAT_IDS env var (for boot-time configuration)
  if (config.tagOnlyChatIds && config.tagOnlyChatIds.includes(chatId)) {
    return 'tag-only';
  }

  return 'normal';
}

/**
 * Get the full directive object for a chat.
 * @param {number} chatId
 * @returns {object | null}
 */
export function getDirective(chatId) {
  return directives[String(chatId)] || null;
}

/**
 * Set a behavioral directive for a chat.
 * @param {number} chatId
 * @param {string} mode - 'normal', 'tag-only', or 'quiet'
 * @param {object} setBy - Telegram user object { id, username, first_name }
 * @param {string} reason - Original message text
 * @returns {boolean}
 */
export function setDirective(chatId, mode, setBy, reason) {
  if (!MODES.includes(mode)) return false;

  if (mode === 'normal') {
    // Remove directive — return to default
    delete directives[String(chatId)];
    console.log(`[directives] Cleared directive for chat ${chatId} (set by ${setBy.username || setBy.first_name || setBy.id})`);
  } else {
    directives[String(chatId)] = {
      mode,
      setBy: {
        id: setBy.id,
        username: setBy.username || setBy.first_name || String(setBy.id),
      },
      setAt: new Date().toISOString(),
      reason: reason || '',
    };
    console.log(`[directives] Set ${mode} for chat ${chatId} (by ${setBy.username || setBy.first_name || setBy.id})`);
  }

  // Auto-flush to disk
  flushDirectives().catch(err => console.warn('[directives] Auto-flush failed:', err.message));
  return true;
}

/**
 * Check if a specific trigger type should be suppressed in this chat.
 *
 * @param {number} chatId - Telegram chat ID
 * @param {string} triggerType - What's trying to send the message:
 *   'proactive'  — intelligence triage engagement
 *   'autonomous'  — timer-based impulses/boredom/market
 *   'name-trigger' — "jarvis", "jar", "j" in message
 *   'archive'    — archive suggestion
 *   'xp'         — XP level-up announcement
 *   'scheduler'  — scheduled briefings/alerts
 *   'system'     — system notifications (digest, Wardenclyffe)
 *   'tag'        — @mention response
 *   'reply'      — reply-to-bot response
 * @returns {boolean} true if the message should be suppressed
 */
export function shouldSuppress(chatId, triggerType) {
  const mode = getChatMode(chatId);

  if (mode === 'normal') return false;

  if (mode === 'tag-only') {
    // Allow: @mention and reply-to-bot responses
    // Suppress: everything else
    return triggerType !== 'tag' && triggerType !== 'reply';
  }

  if (mode === 'quiet') {
    // Suppress everything — complete silence
    return true;
  }

  return false;
}

// ============ Acknowledgment Messages ============

/**
 * Get a brief acknowledgment message for a mode change.
 * @param {string} mode
 * @returns {string}
 */
export function getAcknowledgment(mode) {
  switch (mode) {
    case 'tag-only': return "noted. tag-only mode — I'll only respond when @mentioned or replied to.";
    case 'quiet':    return 'going quiet.';
    case 'normal':   return 'back to normal — full engagement re-enabled.';
    default:         return 'understood.';
  }
}

// ============ Listing ============

/**
 * Get a summary of all active directives.
 * @returns {string}
 */
export function listDirectives() {
  const entries = Object.entries(directives);
  if (entries.length === 0) return 'No active directives. All chats in normal mode.';

  const lines = ['Active Directives:\n'];
  for (const [chatId, d] of entries) {
    lines.push(`  Chat ${chatId}: ${d.mode}`);
    lines.push(`    Set by: ${d.setBy.username} at ${d.setAt}`);
    if (d.reason) lines.push(`    Reason: "${d.reason}"`);
  }
  return lines.join('\n');
}

// ============ Persistence ============

export async function loadDirectives() {
  try {
    if (!existsSync(DIRECTIVES_FILE)) {
      console.log('[directives] No saved directives — starting fresh');
      return;
    }
    const raw = await readFile(DIRECTIVES_FILE, 'utf-8');
    directives = JSON.parse(raw);
    const count = Object.keys(directives).length;
    if (count > 0) {
      console.log(`[directives] Loaded ${count} chat directive(s)`);
      for (const [chatId, d] of Object.entries(directives)) {
        console.log(`[directives]   chat ${chatId}: ${d.mode} (set by ${d.setBy.username} at ${d.setAt})`);
      }
    }
  } catch (err) {
    console.warn(`[directives] Failed to load: ${err.message}`);
  }
}

export async function flushDirectives() {
  try {
    if (!existsSync(DATA_DIR)) {
      await mkdir(DATA_DIR, { recursive: true });
    }
    await writeFile(DIRECTIVES_FILE, JSON.stringify(directives, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[directives] Failed to save: ${err.message}`);
  }
}
