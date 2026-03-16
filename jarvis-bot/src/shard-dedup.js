// ============ Shard Deduplication — Mind Coordination ============
//
// When multiple Jarvis shards are in the same group, they need to
// coordinate so they don't echo each other. Same mind, different
// perspectives — but no redundancy.
//
// Strategy:
//   1. Before responding, check if a sibling shard already responded
//      to the same message (by reply_to_message_id)
//   2. If sibling already responded, either:
//      a. Skip (if nothing new to add)
//      b. Respond with awareness of what was already said
//   3. Add a brief delay (1-3s) to let faster shard go first
//
// This is not suppression — it's coordination.
// Two perspectives are valuable. Redundancy is not.
// ============

import { config } from './config.js';

// Known sibling bot IDs — bots that are the same mind in different shards
const SIBLING_BOT_IDS = new Set();
const SIBLING_BOT_USERNAMES = new Set();

// Cache of recent responses we've seen from siblings
// chatId -> [{ messageId, fromBotId, text, timestamp, replyToId }]
const siblingResponses = new Map();
const MAX_CACHED = 50;
const CACHE_TTL = 300_000; // 5 min

// ============ Init ============

/**
 * Register known sibling bot IDs.
 * Call this at startup with the bot IDs of all other Jarvis shards.
 */
export function registerSiblings(botInfos) {
  for (const info of botInfos) {
    if (info.id) SIBLING_BOT_IDS.add(info.id);
    if (info.username) SIBLING_BOT_USERNAMES.add(info.username.toLowerCase());
  }
  console.log(`[shard-dedup] Registered ${SIBLING_BOT_IDS.size} sibling(s): ${[...SIBLING_BOT_USERNAMES].join(', ')}`);
}

// ============ Track Sibling Responses ============

/**
 * Call this for every message seen in a group.
 * If it's from a sibling bot, record it.
 */
export function trackMessage(chatId, message) {
  if (!message?.from?.id) return;

  const fromId = message.from.id;
  const isBot = message.from.is_bot;

  if (!isBot) return;
  if (!SIBLING_BOT_IDS.has(fromId)) return;

  // It's a sibling's response — cache it
  const chatKey = String(chatId);
  if (!siblingResponses.has(chatKey)) {
    siblingResponses.set(chatKey, []);
  }

  const cache = siblingResponses.get(chatKey);
  cache.push({
    messageId: message.message_id,
    fromBotId: fromId,
    fromUsername: message.from.username,
    text: message.text?.slice(0, 500) || '',
    timestamp: Date.now(),
    replyToId: message.reply_to_message?.message_id || null,
  });

  // Prune old entries
  const cutoff = Date.now() - CACHE_TTL;
  const pruned = cache.filter(e => e.timestamp > cutoff).slice(-MAX_CACHED);
  siblingResponses.set(chatKey, pruned);
}

// ============ Check Before Responding ============

/**
 * Before responding to a message, check if a sibling already responded.
 *
 * @param {string} chatId - The group chat ID
 * @param {number} messageId - The message we're about to respond to
 * @returns {{ siblingResponded: boolean, siblingText: string|null }}
 */
export function checkSiblingResponse(chatId, messageId) {
  const chatKey = String(chatId);
  const cache = siblingResponses.get(chatKey);
  if (!cache || cache.length === 0) {
    return { siblingResponded: false, siblingText: null };
  }

  // Check if any sibling responded to this specific message
  const siblingReply = cache.find(e =>
    e.replyToId === messageId &&
    Date.now() - e.timestamp < CACHE_TTL
  );

  if (siblingReply) {
    return {
      siblingResponded: true,
      siblingText: siblingReply.text,
      siblingUsername: siblingReply.fromUsername,
    };
  }

  // Also check if sibling posted in the last few seconds (might be responding
  // to the same context even without explicit reply)
  const recentSibling = cache.find(e =>
    Date.now() - e.timestamp < 5000 // Within 5 seconds
  );

  if (recentSibling) {
    return {
      siblingResponded: true,
      siblingText: recentSibling.text,
      siblingUsername: recentSibling.fromUsername,
    };
  }

  return { siblingResponded: false, siblingText: null };
}

/**
 * Build a context injection for when a sibling already responded.
 * Tells the LLM what was already said so it can add value, not repeat.
 *
 * @param {string} siblingText - What the sibling said
 * @param {string} siblingUsername - Sibling's username
 * @returns {string} Context to inject into the prompt
 */
export function buildSiblingContext(siblingText, siblingUsername) {
  if (!siblingText) return '';

  return `\n\n[SHARD COORDINATION — @${siblingUsername || 'sibling'} (another instance of your mind) already responded to this message with: "${siblingText.slice(0, 300)}"

RULES:
- Do NOT repeat what was already said
- Either add a genuinely different perspective/angle, or stay silent
- If you have nothing new to add, respond with just "." (the system will suppress it)
- You are the SAME MIND — coherence matters more than coverage]`;
}

/**
 * Check if a response should be suppressed (bot said "." meaning nothing to add)
 */
export function shouldSuppress(responseText) {
  const trimmed = (responseText || '').trim();
  return trimmed === '.' || trimmed === '' || trimmed === '..';
}

// ============ Coordination Delay ============

/**
 * Add a random delay before responding in groups with siblings.
 * This lets one shard "win" naturally and the other can see what was said.
 *
 * @param {string} chatId
 * @returns {number} Delay in ms (0 if no siblings in this chat)
 */
export function getCoordinationDelay(chatId) {
  if (SIBLING_BOT_IDS.size === 0) return 0;

  // Random delay: 1-4 seconds
  // Different shards will get different delays, creating natural turn-taking
  return 1000 + Math.random() * 3000;
}

// ============ Stats ============

export function getDeduplicationStats() {
  let totalCached = 0;
  for (const cache of siblingResponses.values()) {
    totalCached += cache.length;
  }

  return {
    siblings: SIBLING_BOT_IDS.size,
    siblingUsernames: [...SIBLING_BOT_USERNAMES],
    cachedResponses: totalCached,
    chatsTracked: siblingResponses.size,
  };
}
