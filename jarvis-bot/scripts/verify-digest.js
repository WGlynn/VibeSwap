#!/usr/bin/env node
// Verification: run the new archive-grounded digest against a synthetic
// reconstruction of the 2026-04-23 chat from Will's transcript paste.
//
// Goal: prove the output is grounded — no Fisher-Yates fabrication, no
// "reviewing community guidelines" filler, no invented usernames, and
// stickers are counted correctly.
//
// Run:
//   node scripts/verify-digest.js

import { mkdtemp, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// Point the config at a throwaway data dir before anything else is loaded
const testDir = await mkdtemp(join(tmpdir(), 'jarvis-digest-verify-'));
process.env.DATA_DIR = testDir;

// Dynamic imports so the env var is picked up by config.js at load time
const { readArchiveDay, aggregateDay } = await import('../src/archive.js');

// ============ Synthetic 2026-04-23 chat ============
// Reconstructed from Will's 2026-04-23 paste. Times treated as UTC.
// IDs are arbitrary but consistent per user.
const CHAT_ID = -1001111111111;
const DATE = '2026-04-23';

const RODNEY = { id: 1001, username: 'rodneytrotter', first_name: 'Rodney' };
const CATTO = { id: 1002, username: 'HappyCatto94', first_name: 'Happy Catto' };
const WILL = { id: 1003, username: 'Willwillwillwillwill', first_name: 'Will' };

function tsFor(hour, minute) {
  // Returns epoch seconds (Telegram format) for 2026-04-23 HH:MM UTC
  return Math.floor(Date.UTC(2026, 3, 23, hour, minute) / 1000);
}

const messages = [
  { from: RODNEY, at: [3, 43], text: 'Gm' },
  { from: CATTO, at: [5, 0], text: 'Gm, Rod and Wifeyyyy :)' },
  { from: WILL, at: [6, 59], text: 'Yoooo lmaoooo baby is angry you made them stop playtime' },
  { from: RODNEY, at: [7, 5], text: "He's fuming 😂" },
  { from: WILL, at: [7, 6], text: 'Yeah that face of anger and betrayal like "how could you take me from my game master?"' },
  { from: RODNEY, at: [7, 43], sticker: true },
  { from: CATTO, at: [7, 44], text: 'This sticker gives me the..."Why did u redeem it?" kind of vibes HAHAHAHAHAHA' },
  { from: RODNEY, at: [8, 31], sticker: true },
  { from: WILL, at: [11, 59], sticker: true },
  { from: RODNEY, at: [12, 15], sticker: true },
  { from: CATTO, at: [12, 16], sticker: true },
  { from: CATTO, at: [12, 16], sticker: true },
  { from: RODNEY, at: [12, 22], sticker: true },
  { from: WILL, at: [12, 51], sticker: true },
];

// ============ Build synthetic archive file ============

function buildCtx(msg, idx) {
  // Minimal shape matching what archive.js's normalizeMessage expects.
  const base = {
    message_id: 10000 + idx,
    from: msg.from,
    chat: { id: CHAT_ID, type: 'supergroup', title: 'VibeSwap Test' },
    date: tsFor(msg.at[0], msg.at[1]),
  };
  if (msg.sticker) {
    base.sticker = { emoji: '🤔', set_name: 'test_pack', file_id: `sticker_${idx}` };
  } else {
    base.text = msg.text;
  }
  return { message: base, update: { message: base } };
}

const archiveDir = join(testDir, 'archive', String(CHAT_ID));
await mkdir(archiveDir, { recursive: true });
const archivePath = join(archiveDir, `${DATE}.jsonl`);

// Hand-roll records matching the archive schema so we bypass middleware
// and test aggregateDay + buildDailyReport directly against canonical shape.
const records = messages.map((msg, idx) => {
  const ts = tsFor(msg.at[0], msg.at[1]) * 1000;
  const rec = {
    ts,
    chatId: CHAT_ID,
    chatTitle: 'VibeSwap Test',
    chatType: 'supergroup',
    messageId: 10000 + idx,
    userId: msg.from.id,
    username: msg.from.username || null,
    firstName: msg.from.first_name || null,
    lastName: null,
    isBot: false,
    type: msg.sticker ? 'sticker' : 'text',
    isEdit: false,
  };
  if (msg.sticker) {
    rec.stickerEmoji = '🤔';
    rec.stickerSetName = 'test_pack';
    rec.stickerFileId = `sticker_${idx}`;
  } else {
    rec.text = msg.text;
  }
  return rec;
});

await writeFile(archivePath, records.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf-8');

// ============ Run pipeline ============

const readBack = await readArchiveDay(CHAT_ID, DATE);
const agg = aggregateDay(readBack);

console.log('═══ AGGREGATION ═══');
console.log(`totalMessages:     ${agg.totalMessages}`);
console.log(`activeUsers:       ${agg.activeUsers}`);
console.log(`peakHour:          ${agg.peakHour}:00 UTC`);
console.log(`typeBreakdown:     ${JSON.stringify(agg.typeBreakdown)}`);
console.log(`newMembersCount:   ${agg.newMembersCount}`);
console.log(`replyCount:        ${agg.replyCount}`);
console.log();
console.log('topByVolume:');
for (const u of agg.topByVolume) {
  console.log(`  ${u.displayName} — ${u.messageCount}`);
}
console.log();
console.log('topByEngagement:');
if (agg.topByEngagement.length === 0) console.log('  (none — no replies in this chat)');
for (const u of agg.topByEngagement) {
  console.log(`  ${u.displayName} — ${u.repliesReceived}`);
}

// ============ Render digest via the same template digest.js uses ============
// (Inlined here to avoid loading digest.js which pulls tracker.js init)

function displayName(u) {
  return u.displayName || u.username || u.firstName || String(u.userId);
}

function formatTypeBreakdown(typeBreakdown) {
  const order = ['text', 'sticker', 'photo', 'video', 'animation', 'voice', 'audio', 'document', 'command', 'poll'];
  const parts = [];
  for (const t of order) {
    const n = typeBreakdown[t] || 0;
    if (n > 0) parts.push(`${n} ${t}${n === 1 ? '' : 's'}`);
  }
  return parts.join(', ');
}

function buildDailyReport(dateStr, agg) {
  const lines = [`Daily — ${dateStr}`, ''];
  if (agg.totalMessages === 0) {
    lines.push('No activity in the last 24 hours.');
    return lines.join('\n');
  }
  lines.push(`${agg.totalMessages} messages from ${agg.activeUsers} active user${agg.activeUsers === 1 ? '' : 's'}.`);
  const textCount = agg.typeBreakdown.text || 0;
  if (textCount < agg.totalMessages) {
    const mix = formatTypeBreakdown(agg.typeBreakdown);
    if (mix) lines.push(`Mix: ${mix}.`);
  }
  if (agg.peakHour !== null) {
    lines.push(`Peak hour: ${String(agg.peakHour).padStart(2, '0')}:00 UTC.`);
  }
  if (agg.newMembersCount > 0) {
    const names = (agg.newMembers || []).map(m => m.username || m.firstName || String(m.userId)).join(', ');
    lines.push(`New: ${agg.newMembersCount} (${names}).`);
  }
  if (agg.topByVolume.length > 0) {
    lines.push('');
    lines.push('Top by volume:');
    for (const u of agg.topByVolume) lines.push(`  ${displayName(u)} — ${u.messageCount}`);
  }
  if (agg.topByEngagement.length > 0) {
    lines.push('');
    lines.push('Replied-to most:');
    for (const u of agg.topByEngagement) lines.push(`  ${displayName(u)} — ${u.repliesReceived}`);
  }
  return lines.join('\n');
}

const report = buildDailyReport(DATE, agg);
console.log();
console.log('═══ DIGEST OUTPUT ═══');
console.log(report);
console.log();

// ============ Fabrication checks ============
const fabricationPhrases = [
  'Fisher-Yates',
  'fuzz tests',
  'reviewing',
  'refining',
  'guidelines',
  'focus on implementing',
  'being reviewed',
  'for further development',
  'nebuchadnezzar',
  'the future',
  'exciting developments',
];
const violations = fabricationPhrases.filter(p => report.toLowerCase().includes(p.toLowerCase()));
console.log('═══ ANTI-FABRICATION CHECK ═══');
if (violations.length === 0) {
  console.log('PASS: no known fabrication phrases present.');
} else {
  console.log(`FAIL: found fabrication phrases: ${violations.join(', ')}`);
  process.exit(1);
}

// ============ Ground-truth assertions ============
console.log();
console.log('═══ GROUND TRUTH CHECK ═══');
const assertions = [
  { name: 'totalMessages=14',     actual: agg.totalMessages,    expected: 14 },
  { name: 'activeUsers=3',        actual: agg.activeUsers,      expected: 3 },
  { name: 'stickers=8',           actual: agg.typeBreakdown.sticker, expected: 8 },
  { name: 'text=6',               actual: agg.typeBreakdown.text,    expected: 6 },
  { name: 'peakHour=12',          actual: agg.peakHour,         expected: 12 },
];
let failed = 0;
for (const a of assertions) {
  const ok = a.actual === a.expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${a.name} → actual=${a.actual}`);
  if (!ok) failed++;
}

console.log();
console.log(`Cleanup: test data left at ${testDir}`);
if (failed > 0) {
  console.log(`\nFAILED ${failed}/${assertions.length} assertions`);
  process.exit(1);
}
console.log('\nAll checks passed.');
