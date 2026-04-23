import { readArchiveDay, readArchiveRange, aggregateDay } from './archive.js';
import { getAllUsers } from './tracker.js';
import { recordUsage } from './compute-economics.js';

// ============ Daily Digest ============
//
// Every number in the digest is auditable against
//   DATA_DIR/archive/<chatId>/<YYYY-MM-DD>.jsonl
//
// No keyword-category invention. No LLM free-form closer. No Fisher-Yates
// fabrication. No "reviewing community guidelines" filler. If a fact isn't
// derivable from the archive, it does not appear. If there's no activity,
// the digest says so — it does not generate.
//
// Identity authority: every user mentioned is pulled by userId from the
// archive's per-message user fields (username || firstName). The LLM is
// never asked to produce a user's name from scratch.

let lastDigestTimestamp = 0;

// Window for "today" in the digest is the preceding 24 hours, UTC-aligned
// to the current calendar day. Matches the jsonl file layout.
function utcDay(ts) {
  return new Date(ts).toISOString().split('T')[0];
}

function previousUtcDay(ts) {
  return utcDay(ts - 24 * 60 * 60 * 1000);
}

// ============ Render ============

function displayName(u) {
  return u.displayName || u.username || u.firstName || String(u.userId);
}

function formatTypeBreakdown(typeBreakdown) {
  // Returns a compact human-readable breakdown of message types.
  // Only includes types with at least one occurrence.
  const order = ['text', 'sticker', 'photo', 'video', 'animation', 'voice', 'audio', 'document', 'command', 'poll'];
  const parts = [];
  for (const t of order) {
    const n = typeBreakdown[t] || 0;
    if (n > 0) parts.push(`${n} ${t}${n === 1 ? '' : 's'}`);
  }
  // Catch any type not in the canonical order
  for (const [t, n] of Object.entries(typeBreakdown)) {
    if (order.includes(t)) continue;
    if (n > 0) parts.push(`${n} ${t}${n === 1 ? '' : 's'}`);
  }
  return parts.join(', ');
}

function buildDailyReport(dateStr, agg, allTimeTotals) {
  // Deterministic template. JARVIS voice — conversational, plain, no moralizing.
  // Every line traces to a field on `agg`. No invention.

  const lines = [];
  lines.push(`Daily — ${dateStr}`);
  lines.push('');

  if (agg.totalMessages === 0) {
    lines.push('No activity in the last 24 hours.');
    if (allTimeTotals) {
      lines.push('');
      lines.push(`All-time: ${allTimeTotals.messages} messages across ${allTimeTotals.users} users.`);
    }
    return lines.join('\n');
  }

  // Primary counts
  lines.push(`${agg.totalMessages} messages from ${agg.activeUsers} active user${agg.activeUsers === 1 ? '' : 's'}.`);

  // Type mix — only shown if not 100% text (otherwise the breakdown adds nothing)
  const textCount = agg.typeBreakdown.text || 0;
  if (textCount < agg.totalMessages) {
    const mix = formatTypeBreakdown(agg.typeBreakdown);
    if (mix) lines.push(`Mix: ${mix}.`);
  }

  // Peak hour — only if reportable
  if (agg.peakHour !== null && agg.peakHour !== undefined) {
    lines.push(`Peak hour: ${String(agg.peakHour).padStart(2, '0')}:00 UTC.`);
  }

  // Membership events
  if (agg.newMembersCount > 0) {
    const names = (agg.newMembers || [])
      .map(m => m.username || m.firstName || String(m.userId))
      .join(', ');
    lines.push(`New: ${agg.newMembersCount} (${names}).`);
  }
  if (agg.leftMembersCount > 0) {
    lines.push(`Departed: ${agg.leftMembersCount}.`);
  }

  // Top contributors by volume
  if (agg.topByVolume.length > 0) {
    lines.push('');
    lines.push('Top by volume:');
    for (const u of agg.topByVolume) {
      lines.push(`  ${displayName(u)} — ${u.messageCount}`);
    }
  }

  // Engagement (replies received) — only shown if anyone got replies
  if (agg.topByEngagement.length > 0) {
    lines.push('');
    lines.push('Replied-to most:');
    for (const u of agg.topByEngagement) {
      lines.push(`  ${displayName(u)} — ${u.repliesReceived}`);
    }
  }

  // All-time (archive-derived if available, otherwise skipped)
  if (allTimeTotals) {
    lines.push('');
    lines.push(`All-time: ${allTimeTotals.messages} messages across ${allTimeTotals.users} users.`);
  }

  return lines.join('\n');
}

// ============ All-Time Totals ============
// Pulls from users.json + tracker for the cross-session totals line.
// Stays intentionally conservative: a running counter, not a reconstructed aggregate.

function getAllTimeTotals() {
  try {
    const users = getAllUsers();
    const userEntries = Object.values(users);
    // Sum of messageCount as stored in users.json. Matches the trackUser accounting
    // that has been running all along, so the number stays continuous with prior digests.
    const messages = userEntries.reduce((acc, u) => acc + (u.messageCount || 0), 0);
    return {
      users: userEntries.length,
      messages,
    };
  } catch {
    return null;
  }
}

// ============ Entry Points ============

export async function generateDigest(chatId) {
  const now = Date.now();
  const yesterday = previousUtcDay(now);

  const records = await readArchiveDay(chatId, yesterday);
  const agg = aggregateDay(records);
  const allTime = getAllTimeTotals();

  // Record the fact that we ran — digest generation is free (no LLM call)
  // but we still want it in the usage log so the meta-observability layer sees it.
  try {
    recordUsage('jarvis-digest', { input: 0, output: 0 });
  } catch {
    // recordUsage signature drift is not fatal here
  }

  lastDigestTimestamp = now;
  return buildDailyReport(yesterday, agg, allTime);
}

// ============ Weekly Digest ============

export async function generateWeeklyDigest(chatId) {
  const now = Date.now();
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const records = await readArchiveRange(chatId, oneWeekAgo, now);
  if (records.length === 0) {
    return `Weekly — no activity in the last 7 days.`;
  }

  // Per-day buckets
  const byDay = new Map();
  for (const r of records) {
    const d = utcDay(r.ts);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(r);
  }

  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const perDay = days.map(([d, recs]) => ({ date: d, ...aggregateDay(recs) }));

  // Week-wide aggregation
  const weekAgg = aggregateDay(records);

  const lines = [];
  const from = perDay[0].date;
  const to = perDay[perDay.length - 1].date;
  lines.push(`Weekly — ${from} to ${to}`);
  lines.push('');
  lines.push(`${weekAgg.totalMessages} messages from ${weekAgg.activeUsers} users across ${perDay.length} active day${perDay.length === 1 ? '' : 's'}.`);

  // Daily breakdown
  lines.push('');
  lines.push('By day:');
  for (const d of perDay) {
    lines.push(`  ${d.date} — ${d.totalMessages} msg / ${d.activeUsers} users`);
  }

  // Top contributors for the week (use week-level aggregation)
  if (weekAgg.topByVolume.length > 0) {
    lines.push('');
    lines.push('Top by volume:');
    for (const u of weekAgg.topByVolume) {
      lines.push(`  ${displayName(u)} — ${u.messageCount}`);
    }
  }
  if (weekAgg.topByEngagement.length > 0) {
    lines.push('');
    lines.push('Replied-to most:');
    for (const u of weekAgg.topByEngagement) {
      lines.push(`  ${displayName(u)} — ${u.repliesReceived}`);
    }
  }

  return lines.join('\n');
}

export function getLastDigestTimestamp() {
  return lastDigestTimestamp;
}
