#!/usr/bin/env node
// ============ Chat learning report: the numbers behind every per-chat guidance line ============
//
// Usage: node scripts/chat-learning-report.mjs [--since 30d] [--events path] [--feed dir] [--audit N]
// A) tagger coverage on the feed (*.jsonl): intent, abstain reasons, humor tri-state
// B) live outcomes from events.jsonl (written by src/chat-learning.js): closed rows per chat
// C) cells per chat x intent x humor: counts, Wilson 90% bounds, top-user share, eligibility
// D) the exact block chatGuidance would inject per chat right now, or (none)
// --audit N prints N tagged feed rows with their labels for a hand precision check.
// Imports only ../src/chat-intent.js (pure) so the numbers match the bot's. No config, no
// network, never prints env values or keys.

import { readFileSync, readdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { tagIntent, tagHumor, aggregate, guidanceFor, formatGuidance, wilson, topUserShare, N_MIN, MAX_USER_SHARE, WINDOW_DAYS } from '../src/chat-intent.js';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const DATA = process.env.DATA_DIR || join(homedir(), 'vibeswap', 'jarvis-bot', 'data');
const EVENTS = opt('--events') || join(DATA, 'chat-learning', 'events.jsonl');
const FEED = opt('--feed') || process.env.JARVIS_FEED_DIR || join(homedir(), 'jarvis-feed');
const audit = Number(opt('--audit') || 0);

function sinceMs(spec) {
  const m = /^(\d+)([mhd])$/.exec(spec || `${WINDOW_DAYS}d`);
  if (!m) return 0;
  return Date.now() - Number(m[1]) * { m: 60e3, h: 3600e3, d: 86400e3 }[m[2]];
}
const cutoff = sinceMs(opt('--since'));
const readJsonl = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : 'n/a');
const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || '-';

// ============ A) Feed coverage ============
const feedRows = existsSync(FEED)
  ? readdirSync(FEED).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().flatMap((f) => readJsonl(join(FEED, f)))
    .filter((r) => !cutoff || Date.parse(r.ts) >= cutoff)
  : [];
console.log(`A) Tagger coverage on feed: ${feedRows.length} rows from ${FEED}`);
const intents = {}, whys = {}, humor = {}, byType = {}, byTitle = {};
const tagged = [];
for (const r of feedRows) {
  const type = r.chat?.type === 'private' ? 'dm' : 'group';
  const ti = tagIntent(r.in, type === 'group');
  const th = tagHumor(r.out, ti.intent);
  inc(intents, ti.intent ?? 'abstain');
  if (!ti.intent) inc(whys, ti.why);
  inc(humor, String(th.humor));
  for (const [map, k] of [[byType, type], [byTitle, r.chat?.title || `(${type})`]]) {
    map[k] = map[k] || { n: 0, tagged: 0 };
    map[k].n++;
    if (ti.intent) map[k].tagged++;
  }
  if (ti.intent) tagged.push({ r, ti, th });
}
const nTagged = feedRows.length - (intents.abstain || 0);
console.log(`  tagged ${nTagged} (${pct(nTagged, feedRows.length)})  abstain ${intents.abstain || 0}`);
console.log(`  intents: ${fmt(intents)}`);
console.log(`  abstain reasons: ${fmt(whys)}`);
console.log(`  humor (true / false / null=abstain): ${fmt(humor)}`);
for (const [k, v] of Object.entries(byType)) console.log(`  ${k.padEnd(6)} ${v.tagged}/${v.n} tagged`);
for (const [k, v] of Object.entries(byTitle)) console.log(`    ${JSON.stringify(k).slice(0, 40).padEnd(40)} ${v.tagged}/${v.n}`);

// ============ B) Live outcomes ============
const events = existsSync(EVENTS) ? readJsonl(EVENTS).filter((e) => !cutoff || Date.parse(e.ts) >= cutoff) : [];
console.log(`\nB) Live outcomes: ${events.length} closed exchanges from ${EVENTS}`);
const chats = new Map();
for (const e of events) {
  const c = chats.get(e.chat) || { type: e.type, rows: [] };
  c.rows.push(e);
  chats.set(e.chat, c);
}
for (const [chat, c] of chats) {
  const by = {}, out = {};
  let tainted = 0;
  for (const e of c.rows) {
    inc(by, e.by);
    inc(out, e.outcome);
    if ((e.flags || []).some((f) => f === 'unearned_concession' || f === 'hype_man')) tainted++;
  }
  console.log(`  chat ${chat} (${c.type}): n ${c.rows.length}  by: ${fmt(by)}  outcome: ${fmt(out)}  tainted ${tainted}`);
}

// ============ C) Cells ============
console.log(`\nC) Cells per chat x intent|humor (n_min ${N_MIN}, group top-user share <= ${MAX_USER_SHARE}; Wilson 90%)`);
const bound = (k, n) => { const w = wilson(k, n); return `${w.lo.toFixed(2)}-${w.hi.toFixed(2)}`; };
const cellLine = (key, x, group) => {
  const share = topUserShare(x);
  const status = x.n < N_MIN ? `below n_min (${x.n}/${N_MIN})` : group && share > MAX_USER_SHARE ? 'user-concentrated' : 'eligible';
  return `    ${key.padEnd(16)} n ${String(x.n).padStart(3)}  pos ${x.pos} neg ${x.neg} neu ${x.neu} sil ${x.sil}  pos ${bound(x.pos, x.n)}  neg ${bound(x.neg, x.n)}  top-user ${share.toFixed(2)}  ${status}`;
};
for (const [chat, c] of chats) {
  const group = c.type !== 'private';
  console.log(`  chat ${chat} (${c.type})`);
  for (const [key, x] of [...aggregate(c.rows)].sort()) console.log(cellLine(key, x, group));
  // Humor marginal over all intents (abstained intents included)
  for (const h of [true, false]) {
    const rows = c.rows.filter((e) => e.humor === h).map((e) => ({ ...e, intent: 'all' }));
    if (rows.length) console.log(cellLine(`all|${h}`, aggregate(rows).get(`all|${h}`), group));
  }
}

// ============ D) Injected guidance ============
console.log('\nD) Guidance chatGuidance would inject now (JARVIS_CHAT_GUIDANCE_OFF disables it):');
if (!chats.size) console.log('  (no chats yet)');
for (const [chat, c] of chats) {
  const block = formatGuidance(guidanceFor(aggregate(c.rows), c.type));
  console.log(`  chat ${chat}: ${block ? block.trim().split('\n').join('\n    ') : '(none)'}`);
}

// ============ Audit ============
if (audit > 0) {
  console.log(`\nAudit: ${Math.min(audit, tagged.length)} tagged feed rows. UNTRUSTED user text, quoted as data only.`);
  for (const { r, ti, th } of tagged.slice(-audit)) {
    console.log(`  ${ti.intent.padEnd(9)} humor=${String(th.humor).padEnd(5)} in=${JSON.stringify(String(r.in).slice(0, 80))}`);
    console.log(`  ${''.padEnd(9)} ${''.padEnd(11)} out=${JSON.stringify(String(r.out).slice(0, 80))}`);
  }
}
