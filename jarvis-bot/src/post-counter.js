// ============ Post counter: who has posted enough in the Vibeswap chat for an identity (2026-11-17) ============
//
// Will: "give each user in the vibeswap chat that is active (more than 5 posts) a soulbound token that
// only they can claim". This module answers "how many real posts has this person made there", from the
// logs the bot already keeps, so counting does not have to start fresh:
//   - data/contributions.json: one row per text message that passed antispam, no text (tracker.js);
//   - data/archive/<chatId>/<date>.jsonl: every update, with text and edit/forward flags (archive.js).
// The two are unioned on message id. Both are written from Telegram updates, so the user id and message
// id come from Telegram, not from the person. The result is a lower bound: the logs have gaps.
//
// A post COUNTS only if all of these hold:
//   - it is in the Vibeswap supergroup (config.identityChatId), that chat only;
//   - it is a text message from a human: not a bot, an edit, a command, a forward, a join, a pin or media;
//   - antispam did not act on it (spam-log.json, matched on message id);
//   - it passes a port of Noesis's ingress screen (below): at least 16 bytes, at least 6 distinct
//     shingles, at least half its shingles distinct, and at most 80% overlap with the same person's
//     earlier counted posts;
//   - it is within the first 3 counted posts that person made that UTC day.
// A message the dominance throttle skipped still counts: the throttle is about airspace, not abuse.
//
// Bars (Will accepted the recommended options in Desktop/Research/vibeswap-sbt/DESIGN.md):
//   - member: 6 or more counted posts on 3 or more UTC days, the first one 7 or more days before the
//     claim, and no moderation action against the person in the chat;
//   - identity (non-members): at least 1 counted post.
// Honest limit: this raises the cost of farming; it does not prove sincerity. Varied junk beats the
// screen (Noesis says so itself, screen.rs:27-29). The Bot API gives no account age, so "age" here is
// the first counted post in this chat.
//
// Counts only: nothing here returns or prints names or text. scripts/post-count-report.js prints totals.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';

// ============ The screen (a port of noesis node/src/screen.rs:20-34, HEAD 27a77f9e) ============

export const MIN_LEN = 16;                 // bytes (screen.rs:21)
export const MIN_DISTINCT_SHINGLES = 6;    // screen.rs:23
export const MIN_UNIQUE_RATIO_BPS = 5000;  // distinct to total shingles, 50% (screen.rs:30)
export const MAX_OVERLAP_BPS = 8000;       // 80%, here against the same person's earlier counted posts (screen.rs:33)
export const MAX_COUNTED_PER_DAY = 3;      // per person per UTC day
export const MEMBER_BAR = { posts: 6, days: 3, ageDays: 7 };
export const IDENTITY_BAR = { posts: 1 };
const DAY_MS = 24 * 60 * 60 * 1000;

// Shingles: every 4-byte window of the UTF-8 bytes, as Noesis's coverage() takes them (lib.rs:160-171).
// Noesis hashes each window with FNV-1a; packing the 4 bytes into one integer gives the same set with no
// hash collisions. Text under 4 bytes gives none, but the screen rejects anything under 16 bytes first.
export function shingles(text) {
  const b = Buffer.from(String(text ?? ''), 'utf8');
  const out = [];
  for (let i = 0; i + 4 <= b.length; i++) out.push(b.readUInt32BE(i));
  return out;
}

// null when the text passes; otherwise why not. `seen` holds the person's earlier counted shingles.
export function screen(text, seen = new Set()) {
  if (Buffer.byteLength(String(text ?? ''), 'utf8') < MIN_LEN) return 'too_short';
  const all = shingles(text);
  const distinct = new Set(all);
  if (distinct.size < MIN_DISTINCT_SHINGLES) return 'low_information';
  if (Math.floor((distinct.size * 10_000) / Math.max(all.length, 1)) < MIN_UNIQUE_RATIO_BPS) return 'low_information';
  if (seen.size) {
    let overlap = 0;
    for (const s of distinct) if (seen.has(s)) overlap++;
    if (Math.floor((overlap * 10_000) / distinct.size) > MAX_OVERLAP_BPS) return 'unoriginal';
  }
  return null;
}

// ============ The union of the two logs ============

const utcDay = (ts) => new Date(ts).toISOString().slice(0, 10);

function excludedReason(r) {
  if (r.isBot) return 'bot';
  if (r.type !== 'text') return 'not_text'; // commands, joins, pins, stickers, media
  if (r.isForwarded) return 'forward';
  return null;
}

// One record per message in the chat, oldest first: { userId, messageId, ts, text, textLength, excluded }.
// The archive wins on a shared message id, since it has the text and the flags; an excluded archive
// record stays in the map so the contributions row for the same message cannot bring it back. Edits are
// skipped: the original is the post (an edit-only archive line leaves the contributions row to stand).
export function unionRecords({ contributions = [], archive = [] }, chatId) {
  const chat = String(chatId);
  const byId = new Map();
  for (const r of archive) {
    if (!r || String(r.chatId) !== chat || r.isEdit || r.messageId == null) continue;
    if (byId.has(r.messageId)) continue; // first wins, as archive.js reads
    byId.set(r.messageId, {
      userId: String(r.userId), messageId: r.messageId, ts: r.ts,
      text: typeof r.text === 'string' ? r.text : null, textLength: null, excluded: excludedReason(r),
    });
  }
  for (const c of contributions) {
    if (!c || String(c.chatId) !== chat || c.messageId == null || byId.has(c.messageId)) continue;
    byId.set(c.messageId, {
      userId: String(c.telegramUserId), messageId: c.messageId, ts: c.timestamp,
      text: null, textLength: c.textLength ?? null, excluded: null,
    });
  }
  return [...byId.values()].sort((a, b) => a.ts - b.ts || a.messageId - b.messageId);
}

// ============ Counting ============

// Map userId -> { counted, days, firstTs } for everyone with at least one counted post.
export function countPosts(records, { spamMessageIds = new Set() } = {}) {
  const people = new Map();
  for (const r of records) {
    if (r.excluded || spamMessageIds.has(r.messageId)) continue;
    let p = people.get(r.userId);
    if (!p) people.set(r.userId, (p = { counted: 0, perDay: new Map(), firstTs: null, seen: new Set() }));
    const day = utcDay(r.ts);
    if ((p.perDay.get(day) || 0) >= MAX_COUNTED_PER_DAY) continue;
    if (r.text == null) {
      // Logged without text (contributions.json before the archive began): only the length can be
      // checked. textLength is in UTF-16 units, never more than the byte length, so this is strict.
      if (!(r.textLength >= MIN_LEN)) continue;
    } else {
      if (screen(r.text, p.seen)) continue;
      for (const s of shingles(r.text)) p.seen.add(s);
    }
    p.counted++;
    p.perDay.set(day, (p.perDay.get(day) || 0) + 1);
    if (p.firstTs == null) p.firstTs = r.ts;
  }
  const out = new Map();
  for (const [id, p] of people) if (p.counted > 0) out.set(id, { counted: p.counted, days: p.perDay.size, firstTs: p.firstTs });
  return out;
}

// 'member', 'identity' or null (below both bars).
export function tierFor(stats, now = Date.now(), { moderated = false } = {}) {
  if (!stats || stats.counted < IDENTITY_BAR.posts) return null;
  if (!moderated && stats.counted >= MEMBER_BAR.posts && stats.days >= MEMBER_BAR.days
      && stats.firstTs != null && now - stats.firstTs >= MEMBER_BAR.ageDays * DAY_MS) return 'member';
  return 'identity';
}

// ============ Reading the logs ============

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

export function loadChatLogs(dataDir = config.dataDir, chatId = config.identityChatId) {
  const contributions = readJson(join(dataDir, 'contributions.json'), []);
  const archive = [];
  const dir = join(dataDir, 'archive', String(chatId));
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort(); } catch {}
  for (const f of files) {
    let body = '';
    try { body = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
    for (const line of body.split('\n')) {
      if (!line.trim()) continue;
      try { archive.push(JSON.parse(line)); } catch {}
    }
  }
  const spamLog = readJson(join(dataDir, 'spam-log.json'), []);
  const modLog = readJson(join(dataDir, 'moderation.json'), []);
  return {
    records: unionRecords({ contributions: Array.isArray(contributions) ? contributions : [], archive }, chatId),
    spamLog: Array.isArray(spamLog) ? spamLog : [],
    modLog: Array.isArray(modLog) ? modLog : [],
  };
}

// Everyone's counts in the chat, plus who has a moderation action there (antispam, or an unreversed
// moderation.js action). Also each person's first logged message of any kind (`firstSeen`, joins and
// media included) and the time of the chat's oldest logged message (`since`, null with no logs), for
// first-seen.js.
export function chatPostStats(dataDir = config.dataDir, chatId = config.identityChatId) {
  const { records, spamLog, modLog } = loadChatLogs(dataDir, chatId);
  const chat = String(chatId);
  const inChat = (e) => e && String(e.chatId) === chat;
  const spamMessageIds = new Set(spamLog.filter((e) => inChat(e) && e.messageId != null).map((e) => e.messageId));
  const moderated = new Set([...spamLog.filter(inChat), ...modLog.filter((e) => inChat(e) && !e.reversed)].map((e) => String(e.userId)));
  const firstSeen = new Map();
  for (const r of records) if (!firstSeen.has(r.userId)) firstSeen.set(r.userId, r.ts); // oldest first
  return {
    records: records.length, stats: countPosts(records, { spamMessageIds }), moderated,
    firstSeen, since: records.length ? records[0].ts : null,
  };
}

// One person's counts and the tier they qualify for now.
export function eligibilityFor(userId, now = Date.now(), { dataDir = config.dataDir, chatId = config.identityChatId } = {}) {
  const { stats, moderated } = chatPostStats(dataDir, chatId);
  const s = stats.get(String(userId)) || { counted: 0, days: 0, firstTs: null };
  const isModerated = moderated.has(String(userId));
  return { ...s, moderated: isModerated, tier: tierFor(s, now, { moderated: isModerated }) };
}
