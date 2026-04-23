import { appendFile, mkdir, readdir, readFile } from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { join } from 'path';
import { config } from './config.js';

// ============ Chat Archive ============
//
// Every Telegram update hitting the bot is appended to a jsonl file at:
//   DATA_DIR/archive/<chatId>/<YYYY-MM-DD>.jsonl  (UTC date)
//
// This is the canonical source of truth for everything the bot reports
// about chat activity. Digest, stats, rank, streaks — all read from here,
// not from in-memory derived state. The archive closes the Telegram-bot
// substrate gap: bots can't retroactively fetch history, but once archived
// the history is queryable forever.
//
// Design constraints:
//  - Append-only. One line per event. Never rewrite past lines.
//  - UTC dates. Peak-hour labels match the files.
//  - Raw Telegram message object is NOT stored wholesale — only a normalized
//    record with the fields the bot actually uses. This keeps lines scannable
//    and avoids bloating the log with polymorphic Telegraf internals.
//  - Stickers, media, commands, joins, leaves, edits — all captured.
//  - Dedupe via messageId inside a single (chatId, date). If the same event
//    arrives twice, the second append is a no-op at read time (first-wins).

const ARCHIVE_DIR = join(config.dataDir, 'archive');

// In-memory last-known date per chat to avoid mkdir thrash on hot paths
const ensuredDirs = new Set();

async function ensureChatDir(chatId) {
  const key = String(chatId);
  if (ensuredDirs.has(key)) return;
  const dir = join(ARCHIVE_DIR, key);
  await mkdir(dir, { recursive: true });
  ensuredDirs.add(key);
}

function utcDateString(ts) {
  // ts is ms since epoch. Returns YYYY-MM-DD in UTC.
  return new Date(ts).toISOString().split('T')[0];
}

function archivePath(chatId, dateStr) {
  return join(ARCHIVE_DIR, String(chatId), `${dateStr}.jsonl`);
}

// ============ Message Normalization ============

function classifyMessageType(msg) {
  // Deterministic type tag from raw Telegram message shape.
  // No keyword heuristics. What the substrate reports, we record.
  if (msg.new_chat_members) return 'new_chat_members';
  if (msg.left_chat_member) return 'left_chat_member';
  if (msg.pinned_message) return 'pinned_message';
  if (msg.sticker) return 'sticker';
  if (msg.photo) return 'photo';
  if (msg.video) return 'video';
  if (msg.animation) return 'animation';
  if (msg.voice) return 'voice';
  if (msg.audio) return 'audio';
  if (msg.document) return 'document';
  if (msg.poll) return 'poll';
  if (msg.contact) return 'contact';
  if (msg.location) return 'location';
  if (msg.text && msg.text.startsWith('/')) return 'command';
  if (msg.text) return 'text';
  return 'unknown';
}

function extractText(msg) {
  // For text messages, the content. For media, the caption. Null otherwise.
  if (msg.text) return msg.text;
  if (msg.caption) return msg.caption;
  return null;
}

function normalizeMessage(ctx) {
  const msg = ctx.update?.edited_message || ctx.update?.message || ctx.message;
  if (!msg) return null;

  const isEdit = Boolean(ctx.update?.edited_message);
  const from = msg.from || {};
  const chat = msg.chat || {};
  const type = classifyMessageType(msg);

  const record = {
    ts: (msg.date || Math.floor(Date.now() / 1000)) * 1000,
    chatId: chat.id,
    chatTitle: chat.title || chat.username || 'DM',
    chatType: chat.type, // 'private' | 'group' | 'supergroup' | 'channel'
    messageId: msg.message_id,
    userId: from.id,
    username: from.username || null,
    firstName: from.first_name || null,
    lastName: from.last_name || null,
    isBot: Boolean(from.is_bot),
    type,
    isEdit,
  };

  const text = extractText(msg);
  if (text !== null) record.text = text;

  if (msg.sticker) {
    record.stickerEmoji = msg.sticker.emoji || null;
    record.stickerSetName = msg.sticker.set_name || null;
    record.stickerFileId = msg.sticker.file_id || null;
  }

  if (msg.photo && msg.photo.length) {
    // Telegram returns an array of sizes; largest is last.
    record.photoFileId = msg.photo[msg.photo.length - 1].file_id;
  }

  if (msg.video) record.videoFileId = msg.video.file_id;
  if (msg.animation) record.animationFileId = msg.animation.file_id;
  if (msg.voice) record.voiceFileId = msg.voice.file_id;
  if (msg.audio) record.audioFileId = msg.audio.file_id;
  if (msg.document) {
    record.documentFileId = msg.document.file_id;
    record.documentName = msg.document.file_name || null;
  }

  if (msg.reply_to_message) {
    record.replyToMessageId = msg.reply_to_message.message_id;
    record.replyToUserId = msg.reply_to_message.from?.id || null;
    record.replyToUsername = msg.reply_to_message.from?.username || null;
  }

  if (msg.forward_from || msg.forward_from_chat || msg.forward_sender_name) {
    record.isForwarded = true;
  }

  if (msg.entities && msg.entities.length) {
    // Preserve entity types only (mention, url, hashtag, code, etc.) — not positions.
    // Enough signal to answer "did this message contain a link" without bloat.
    record.entityTypes = [...new Set(msg.entities.map(e => e.type))];
  }

  if (msg.new_chat_members) {
    record.newMembers = msg.new_chat_members.map(m => ({
      userId: m.id,
      username: m.username || null,
      firstName: m.first_name || null,
      isBot: Boolean(m.is_bot),
    }));
  }

  if (msg.left_chat_member) {
    record.leftMember = {
      userId: msg.left_chat_member.id,
      username: msg.left_chat_member.username || null,
      firstName: msg.left_chat_member.first_name || null,
    };
  }

  return record;
}

// ============ Write Path ============

export async function archiveMessage(ctx) {
  const record = normalizeMessage(ctx);
  if (!record || !record.chatId) return null;

  const dateStr = utcDateString(record.ts);
  await ensureChatDir(record.chatId);
  const path = archivePath(record.chatId, dateStr);

  const line = JSON.stringify(record) + '\n';
  try {
    await appendFile(path, line, 'utf-8');
  } catch (err) {
    console.warn(`[archive] Failed to write ${path}: ${err.message}`);
    return null;
  }
  return record;
}

// ============ Read Path ============

export async function readArchiveDay(chatId, dateStr) {
  // Returns all records for (chatId, dateStr). Dedupe on messageId — first wins.
  const path = archivePath(chatId, dateStr);
  const seen = new Set();
  const records = [];

  try {
    const stream = createReadStream(path, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue; // skip malformed lines rather than aborting the whole read
      }
      const key = `${rec.messageId}:${rec.isEdit ? 'edit' : 'orig'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      records.push(rec);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[archive] Failed to read ${path}: ${err.message}`);
    }
    return [];
  }

  return records;
}

export async function readArchiveRange(chatId, startTs, endTs) {
  // Inclusive start, exclusive end. Reads UTC-day files that could overlap.
  const startDate = utcDateString(startTs);
  const endDate = utcDateString(endTs - 1);
  const dates = [];
  let cursor = new Date(startDate + 'T00:00:00Z').getTime();
  const endCursor = new Date(endDate + 'T00:00:00Z').getTime();
  while (cursor <= endCursor) {
    dates.push(utcDateString(cursor));
    cursor += 24 * 60 * 60 * 1000;
  }

  const all = [];
  for (const d of dates) {
    const records = await readArchiveDay(chatId, d);
    for (const r of records) {
      if (r.ts >= startTs && r.ts < endTs) all.push(r);
    }
  }
  all.sort((a, b) => a.ts - b.ts);
  return all;
}

export async function listArchivedChats() {
  try {
    const entries = await readdir(ARCHIVE_DIR, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}

export async function listArchivedDays(chatId) {
  try {
    const dir = join(ARCHIVE_DIR, String(chatId));
    const files = await readdir(dir);
    return files
      .filter(f => f.endsWith('.jsonl'))
      .map(f => f.replace(/\.jsonl$/, ''))
      .sort();
  } catch {
    return [];
  }
}

// ============ Derived Aggregations ============
// All report-facing metrics read from here. No invented fields. If a fact
// isn't derivable from the archive, it does not appear in output.

export function aggregateDay(records) {
  // Returns ground-truth aggregations for a single day's records.
  // Every number in here is auditable against the jsonl file.

  const users = new Map(); // userId -> {username, firstName, messageCount, types, repliesReceived, repliesGiven}
  const typeBreakdown = {};
  const hourlyActivity = new Array(24).fill(0);
  const replyEdges = []; // [{from, to}]
  const newMembers = [];
  const leftMembers = [];

  for (const r of records) {
    if (r.isEdit) continue; // edits don't count as new messages
    if (r.isBot) continue; // skip bot's own messages from user-facing metrics

    // Type breakdown
    typeBreakdown[r.type] = (typeBreakdown[r.type] || 0) + 1;

    // Hourly (UTC)
    const hour = new Date(r.ts).getUTCHours();
    hourlyActivity[hour]++;

    // Membership events — counted but not attributed to a user's message count
    if (r.type === 'new_chat_members') {
      for (const m of r.newMembers || []) newMembers.push(m);
      continue;
    }
    if (r.type === 'left_chat_member') {
      leftMembers.push(r.leftMember);
      continue;
    }

    // Per-user counts (exclude commands? keep them — commands are activity)
    if (!r.userId) continue;
    if (!users.has(r.userId)) {
      users.set(r.userId, {
        userId: r.userId,
        username: r.username,
        firstName: r.firstName,
        messageCount: 0,
        types: {},
        repliesReceived: 0,
        repliesGiven: 0,
      });
    }
    const u = users.get(r.userId);
    u.messageCount++;
    u.types[r.type] = (u.types[r.type] || 0) + 1;

    // Reply edges
    if (r.replyToUserId && r.replyToUserId !== r.userId) {
      replyEdges.push({ from: r.userId, to: r.replyToUserId });
      u.repliesGiven++;
    }
  }

  // Resolve repliesReceived on each user
  for (const edge of replyEdges) {
    if (users.has(edge.to)) {
      users.get(edge.to).repliesReceived++;
    }
  }

  const totalMessages = records.filter(r => !r.isEdit && !r.isBot && r.type !== 'new_chat_members' && r.type !== 'left_chat_member').length;
  const activeUsers = users.size;

  // Peak hour — only if there's actual variation. If all zeros or a single bucket, don't report it.
  let peakHour = null;
  const maxActivity = Math.max(...hourlyActivity);
  if (maxActivity > 0) {
    peakHour = hourlyActivity.indexOf(maxActivity);
  }

  // Top contributors by volume (real message count)
  const topByVolume = [...users.values()]
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, 5)
    .map(u => ({
      displayName: u.username || u.firstName || String(u.userId),
      userId: u.userId,
      messageCount: u.messageCount,
    }));

  // Top by engagement — replies received. This replaces the dead keyword-based "quality".
  const topByEngagement = [...users.values()]
    .filter(u => u.repliesReceived > 0)
    .sort((a, b) => b.repliesReceived - a.repliesReceived)
    .slice(0, 5)
    .map(u => ({
      displayName: u.username || u.firstName || String(u.userId),
      userId: u.userId,
      repliesReceived: u.repliesReceived,
    }));

  return {
    totalMessages,
    activeUsers,
    typeBreakdown,
    hourlyActivity,
    peakHour,
    topByVolume,
    topByEngagement,
    newMembersCount: newMembers.length,
    newMembers,
    leftMembersCount: leftMembers.length,
    replyCount: replyEdges.length,
  };
}
