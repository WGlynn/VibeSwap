// ============ Message Collision Detector ============
//
// Detects when a bot is about to send a message that's too similar
// to something it (or a sibling shard) recently said in the same chat.
//
// Consistency is good. Literal repetition is robotic.
// Same mind, fresh words every time.
//
// Uses bigram Jaccard similarity — fast, no LLM calls, effective
// for catching near-duplicate messages.
//
// CRPC-aware: collision history is shared across shards via
// the shard update endpoint so Jarvis Main and Diablo don't
// echo each other's patterns either.
// ============

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';

// ============ Config ============

const SIMILARITY_THRESHOLD = 0.60;  // 60% bigram overlap = collision
const MAX_HISTORY_PER_CHAT = 30;    // Keep last 30 messages per chat
const HISTORY_TTL = 86_400_000;     // 24 hours — forget after that
const FLUSH_INTERVAL = 300_000;     // Persist every 5 min
const MIN_MESSAGE_LENGTH = 50;      // Don't check very short messages

// ============ State ============

// chatId -> [{ text, timestamp, shardId }]
const outgoingHistory = new Map();
let dirty = false;
let dataDir = null;

// ============ Similarity Engine ============

/**
 * Extract word bigrams from text (lowercased, punctuation stripped).
 * "hello world foo" → Set(["hello world", "world foo"])
 */
function bigrams(text) {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1);

  const set = new Set();
  for (let i = 0; i < words.length - 1; i++) {
    set.add(`${words[i]} ${words[i + 1]}`);
  }
  return set;
}

/**
 * Jaccard similarity between two bigram sets.
 * |A ∩ B| / |A ∪ B| → [0, 1]
 */
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ============ Core API ============

/**
 * Check if a message collides with recent outgoing history.
 *
 * @param {string} chatId - Chat where message will be sent
 * @param {string} newMessage - The message about to be sent
 * @returns {{ collision: boolean, similarity: number, matchedMessage: string|null, matchAge: number|null }}
 */
export function checkCollision(chatId, newMessage) {
  if (!newMessage || newMessage.length < MIN_MESSAGE_LENGTH) {
    return { collision: false, similarity: 0, matchedMessage: null, matchAge: null };
  }

  const chatKey = String(chatId);
  const history = outgoingHistory.get(chatKey);
  if (!history || history.length === 0) {
    return { collision: false, similarity: 0, matchedMessage: null, matchAge: null };
  }

  const newBigrams = bigrams(newMessage);
  if (newBigrams.size < 3) {
    // Too few bigrams to judge — let it through
    return { collision: false, similarity: 0, matchedMessage: null, matchAge: null };
  }

  let maxSimilarity = 0;
  let matchedMessage = null;
  let matchAge = null;
  const now = Date.now();

  for (const entry of history) {
    // Skip expired entries
    if (now - entry.timestamp > HISTORY_TTL) continue;

    const historicalBigrams = bigrams(entry.text);
    if (historicalBigrams.size < 3) continue;

    const similarity = jaccardSimilarity(newBigrams, historicalBigrams);

    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      matchedMessage = entry.text;
      matchAge = now - entry.timestamp;
    }
  }

  const collision = maxSimilarity >= SIMILARITY_THRESHOLD;

  if (collision) {
    const ageStr = matchAge < 60000
      ? `${Math.round(matchAge / 1000)}s ago`
      : matchAge < 3600000
        ? `${Math.round(matchAge / 60000)}m ago`
        : `${Math.round(matchAge / 3600000)}h ago`;
    console.log(`[collision] Detected in chat ${chatKey}: ${(maxSimilarity * 100).toFixed(1)}% similar to message from ${ageStr}`);
  }

  return { collision, similarity: maxSimilarity, matchedMessage, matchAge };
}

/**
 * Record an outgoing message in history.
 * Call this AFTER successfully sending a message.
 *
 * @param {string} chatId
 * @param {string} text - The sent message
 * @param {string} [shardId] - Which shard sent it (for cross-shard awareness)
 */
export function recordOutgoing(chatId, text, shardId = null) {
  if (!text || text.length < MIN_MESSAGE_LENGTH) return;

  const chatKey = String(chatId);
  if (!outgoingHistory.has(chatKey)) {
    outgoingHistory.set(chatKey, []);
  }

  const history = outgoingHistory.get(chatKey);
  history.push({
    text: text.slice(0, 1000), // Cap storage
    timestamp: Date.now(),
    shardId: shardId || config.shardId || 'local',
  });

  // Prune: keep only recent entries within TTL and max count
  const now = Date.now();
  const pruned = history
    .filter(e => now - e.timestamp < HISTORY_TTL)
    .slice(-MAX_HISTORY_PER_CHAT);
  outgoingHistory.set(chatKey, pruned);
  dirty = true;
}

/**
 * Build a collision avoidance context injection for the LLM prompt.
 * When a collision is detected, this tells the LLM what it said before
 * so it can generate something fresh.
 *
 * @param {string} matchedMessage - The previous message that was too similar
 * @param {number} similarity - How similar (0-1)
 * @returns {string} Context to inject into prompt
 */
export function buildCollisionContext(matchedMessage, similarity) {
  const pct = (similarity * 100).toFixed(0);
  return `\n\n[MESSAGE COLLISION DETECTED — ${pct}% similar to something you recently said in this chat.
Your previous message: "${matchedMessage.slice(0, 400)}"

RULES:
- You MUST say something DIFFERENT this time
- Same energy, same vibe, but FRESH words
- Don't just rearrange the same sentence — genuinely new angle
- Variety is what makes you feel alive, not scripted
- If you catch yourself writing the same thing, pivot hard]`;
}

// ============ Cross-Shard Sync ============

/**
 * Import collision history from a sibling shard.
 * Called when receiving shard updates via /shard/update endpoint.
 *
 * @param {Object} shardHistory - { chatId: [{ text, timestamp, shardId }] }
 */
export function importShardHistory(shardHistory) {
  if (!shardHistory || typeof shardHistory !== 'object') return;

  let imported = 0;
  for (const [chatId, entries] of Object.entries(shardHistory)) {
    if (!Array.isArray(entries)) continue;

    if (!outgoingHistory.has(chatId)) {
      outgoingHistory.set(chatId, []);
    }
    const local = outgoingHistory.get(chatId);
    const now = Date.now();

    for (const entry of entries) {
      // Don't import expired or duplicate entries
      if (now - entry.timestamp > HISTORY_TTL) continue;
      const isDupe = local.some(l =>
        Math.abs(l.timestamp - entry.timestamp) < 5000 &&
        l.text?.slice(0, 100) === entry.text?.slice(0, 100)
      );
      if (!isDupe) {
        local.push({
          text: (entry.text || '').slice(0, 1000),
          timestamp: entry.timestamp,
          shardId: entry.shardId || 'remote',
        });
        imported++;
      }
    }

    // Prune after import
    const pruned = local
      .filter(e => now - e.timestamp < HISTORY_TTL)
      .slice(-MAX_HISTORY_PER_CHAT);
    outgoingHistory.set(chatId, pruned);
  }

  if (imported > 0) {
    console.log(`[collision] Imported ${imported} entries from sibling shard`);
    dirty = true;
  }
}

/**
 * Export recent collision history for shard sync.
 * Returns only entries from the last hour (minimize payload).
 *
 * @returns {Object} { chatId: [{ text, timestamp, shardId }] }
 */
export function exportShardHistory() {
  const result = {};
  const cutoff = Date.now() - 3_600_000; // Last hour only

  for (const [chatId, entries] of outgoingHistory) {
    const recent = entries.filter(e => e.timestamp > cutoff);
    if (recent.length > 0) {
      result[chatId] = recent;
    }
  }

  return result;
}

// ============ Persistence ============

/**
 * Initialize collision detector — load history from disk.
 */
export async function initCollisionDetector() {
  dataDir = config.dataDir || process.env.DATA_DIR || './data';
  try {
    await mkdir(dataDir, { recursive: true });
    const data = await readFile(join(dataDir, 'collision-history.json'), 'utf8');
    const parsed = JSON.parse(data);

    const now = Date.now();
    let loaded = 0;
    for (const [chatId, entries] of Object.entries(parsed)) {
      const valid = entries.filter(e => now - e.timestamp < HISTORY_TTL);
      if (valid.length > 0) {
        outgoingHistory.set(chatId, valid.slice(-MAX_HISTORY_PER_CHAT));
        loaded += valid.length;
      }
    }
    console.log(`[collision] Loaded ${loaded} history entries across ${outgoingHistory.size} chats`);
  } catch {
    // First run or corrupt file — start fresh
    console.log('[collision] No history found — starting fresh');
  }
}

/**
 * Flush collision history to disk.
 */
export async function flushCollisionHistory() {
  if (!dirty || !dataDir) return;

  const serializable = {};
  for (const [chatId, entries] of outgoingHistory) {
    serializable[chatId] = entries;
  }

  try {
    await writeFile(
      join(dataDir, 'collision-history.json'),
      JSON.stringify(serializable, null, 2),
      'utf8'
    );
    dirty = false;
  } catch (err) {
    console.warn(`[collision] Flush failed: ${err.message}`);
  }
}

// ============ Stats ============

export function getCollisionStats() {
  let totalEntries = 0;
  for (const entries of outgoingHistory.values()) {
    totalEntries += entries.length;
  }

  return {
    chatsTracked: outgoingHistory.size,
    totalEntries,
    threshold: SIMILARITY_THRESHOLD,
    historyTtl: `${HISTORY_TTL / 3600000}h`,
  };
}
