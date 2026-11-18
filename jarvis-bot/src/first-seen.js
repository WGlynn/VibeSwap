// ============ First seen: when each person first appeared in a group chat (2026-11-17) ============
//
// The Bot API gives no join date and no account age, so "new here" can only mean "first logged here".
// This module answers that from the logs the bot already keeps, through post-counter.js (the archive and
// contributions.json, unioned on message id), and keeps the answer current in memory as updates arrive:
//   - firstSeenTs:    the person's first logged message of any kind in the chat (a join, media, text);
//   - firstCountedTs: their first post that passes post-counter.js's counting rules (the junk and
//                     near-duplicate screen, no bots, edits, commands or forwards, nothing antispam acted
//                     on), or null when they have none;
//   - since:          the chat's oldest logged message, so a caller can tell whether the logs reach back
//                     far enough to call anyone new (a chat logged for an hour has no newcomers to name).
// Used by antispam.js (check 3, new account plus link) and the engage gate (L6, L8), DESIGN S2.5.
//
// Each group chat is read from disk once per process, on first use; afterwards noteSeen (every archived
// update) and noteCountedPost (each text message antispam let through) keep it current. A failed read is
// logged once per chat and retried after 10 minutes; until then the chat is unknown, and the callers
// then behave as they did before this module existed. Only ids and times are kept, never text.

import { chatPostStats, countPosts, unionRecords } from './post-counter.js';
import { config } from './config.js';

const RETRY_MS = 10 * 60_000;
const isGroup = (chatType) => chatType === 'group' || chatType === 'supergroup';

// chatId -> { since, firstSeen: Map<userId, ts>, firstCounted: Map<userId, ts> }, or { failedAt } after a failed read
const chats = new Map();
const failLogged = new Set();

function stateFor(chatId, now = Date.now()) {
  const key = String(chatId);
  const cached = chats.get(key);
  if (cached && !cached.failedAt) return cached;
  if (cached && now - cached.failedAt < RETRY_MS) return null;
  try {
    const { stats, firstSeen, since } = chatPostStats(config.dataDir, key);
    const firstCounted = new Map();
    for (const [userId, s] of stats) firstCounted.set(userId, s.firstTs);
    const state = { since, firstSeen, firstCounted };
    chats.set(key, state);
    return state;
  } catch (err) {
    chats.set(key, { failedAt: now });
    if (!failLogged.has(key)) {
      failLogged.add(key);
      console.warn(`[first-seen] could not read the logs of chat ${key}, treating it as unknown: ${err.message}`);
    }
    return null;
  }
}

/**
 * Note one archived update (the record archive.js wrote). Group chats only; edits are ignored.
 */
export function noteSeen(record) {
  if (!record || record.isEdit || !isGroup(record.chatType) || record.userId == null || record.ts == null) return;
  const state = stateFor(record.chatId, record.ts);
  if (!state) return;
  const uid = String(record.userId);
  if (state.since == null) state.since = record.ts;
  if (!state.firstSeen.has(uid)) state.firstSeen.set(uid, record.ts);
}

/**
 * Note a message that passed antispam, as its archive record. If the person has no counted post yet,
 * this one becomes their first when post-counter.js would count it (countPosts on this record alone is
 * exactly that test for someone with no counted posts).
 */
export function noteCountedPost(record) {
  if (!record || record.isEdit || !isGroup(record.chatType) || record.userId == null) return;
  const state = stateFor(record.chatId, record.ts);
  if (!state) return;
  const uid = String(record.userId);
  if (state.firstCounted.has(uid)) return;
  const counted = countPosts(unionRecords({ archive: [record] }, record.chatId)).get(uid);
  if (counted) state.firstCounted.set(uid, counted.firstTs);
}

/**
 * { since, firstSeenTs, firstCountedTs } for a person in a group chat, or null when the chat is unknown.
 * Someone not logged yet is first seen at `now` (and noted, so the next lookup agrees).
 */
export function presenceOf(chatId, userId, now = Date.now()) {
  const state = stateFor(chatId, now);
  if (!state) return null;
  const uid = String(userId);
  if (state.since == null) state.since = now;
  if (!state.firstSeen.has(uid)) state.firstSeen.set(uid, now);
  return { since: state.since, firstSeenTs: state.firstSeen.get(uid), firstCountedTs: state.firstCounted.get(uid) ?? null };
}

/**
 * The "join date" antispam's check 3 wants: the person's first-seen time, but only when the chat's logs
 * reach back at least `minCoverageMs` (24 h). Otherwise undefined, which antispam reads as "not new".
 */
export function joinDateFor(chatId, userId, now = Date.now(), minCoverageMs = 24 * 60 * 60_000) {
  const p = presenceOf(chatId, userId, now);
  if (!p || p.since == null || now - p.since < minCoverageMs) return undefined;
  return p.firstSeenTs;
}

// For tests: forget every chat, so the next lookup reads the logs again.
export function resetFirstSeen() {
  chats.clear();
  failLogged.clear();
}
