#!/usr/bin/env node
// ============ Meter report: read-only view of the LLM call log ============
//
// Usage: node scripts/meter-report.mjs [--since 24h|7d|90m] [--log path]
// Reads LLM_CALL_LOG (default ~/jarvis-bot-logs/llm-calls.jsonl) written by src/llm-meter.js
// and prints the numbers every later saving is gated on: physical requests by provider and
// model (ok vs 429/503/other), no-model turns and their share, calls per turn, cached share
// per model, thinking tokens, and the scheduled-vs-user split by caller. Imports nothing from
// src/, makes no network calls, never prints a key.

import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const LOG = opt('--log') || process.env.LLM_CALL_LOG || join(homedir(), 'jarvis-bot-logs', 'llm-calls.jsonl');
const since = opt('--since');
const SCHEDULED_FILES = ['autonomous.js', 'proactive.js', 'self-improve.js', 'intelligence.js'];

function sinceMs(spec) {
  const m = /^(\d+)([mhd])$/.exec(spec || '');
  if (!m) return 0;
  const unit = { m: 60e3, h: 3600e3, d: 86400e3 }[m[2]];
  return Date.now() - Number(m[1]) * unit;
}

if (!existsSync(LOG)) { console.log(`no rows (${LOG} does not exist)`); process.exit(0); }
const cutoff = sinceMs(since);
const rows = readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((r) => r && (!cutoff || Date.parse(r.ts) >= cutoff));
if (!rows.length) { console.log('no rows'); process.exit(0); }

const calls = rows.filter((r) => r.kind !== 'no_model');
const noModel = rows.filter((r) => r.kind === 'no_model');
const inc = (map, key, n = 1) => map.set(key, (map.get(key) || 0) + n);
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
const errClass = (r) => (r.ok ? 'ok' : /\b429\b/.test(r.error || '') ? '429' : /\b503\b/.test(r.error || '') ? '503' : 'other');
const table = (map) => [...map].sort((a, b) => b[1] - a[1]);

console.log(`Meter report: ${rows.length} rows${since ? ` in the last ${since}` : ''} from ${LOG}`);
console.log(`  physical requests: ${calls.length}   no-model turns: ${noModel.length}`);

// Physical requests by provider and by model, split ok / 429 / 503 / other.
const byKey = new Map();
for (const r of calls) {
  for (const key of [`provider ${r.provider}`, `model ${r.provider}/${r.model}`]) {
    const c = byKey.get(key) || { ok: 0, 429: 0, 503: 0, other: 0 };
    c[errClass(r)] += 1;
    byKey.set(key, c);
  }
}
console.log('\nRequests by provider and model (ok / 429 / 503 / other):');
for (const [key, c] of [...byKey].sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y) - Object.values(a[1]).reduce((x, y) => x + y))) {
  console.log(`  ${key.padEnd(44)} ${String(c.ok).padStart(5)} / ${String(c['429']).padStart(4)} / ${String(c['503']).padStart(4)} / ${String(c.other).padStart(4)}`);
}

// No-model turns by reason and their share of answered turns (no-model + distinct turn ids).
const turnIds = new Set(calls.map((r) => r.turn).filter(Boolean));
const byReason = new Map();
for (const r of noModel) inc(byReason, r.reason || 'unknown');
console.log(`\nNo-model turns: ${noModel.length} of ${noModel.length + turnIds.size} answered turns (${pct(noModel.length, noModel.length + turnIds.size)})`);
for (const [reason, n] of table(byReason)) console.log(`  ${reason.padEnd(20)} ${n}`);
if (!turnIds.size) console.log('  (no rows carry a turn id yet; the share above is only meaningful once the bot has run with withTurn)');

// Calls per turn, overall and split by caller so tool rounds and rotations are not conflated with background work.
const perTurn = new Map();
const perTurnCaller = new Map();
for (const r of calls) {
  if (!r.turn) continue;
  inc(perTurn, r.turn);
  const callers = perTurnCaller.get(r.turn) || new Map();
  inc(callers, r.caller || 'unknown');
  perTurnCaller.set(r.turn, callers);
}
if (perTurn.size) {
  const hist = { 1: 0, 2: 0, '3+': 0 };
  const heavyCallers = new Map();
  let sum = 0;
  for (const [turn, n] of perTurn) {
    sum += n;
    hist[n === 1 ? 1 : n === 2 ? 2 : '3+'] += 1;
    if (n >= 3) for (const [caller, k] of perTurnCaller.get(turn)) inc(heavyCallers, caller, k);
  }
  console.log(`\nCalls per turn (${perTurn.size} turns, mean ${(sum / perTurn.size).toFixed(2)}): 1 -> ${hist[1]}   2 -> ${hist[2]}   3+ -> ${hist['3+']}`);
  if (heavyCallers.size) {
    console.log('  callers inside 3+ turns:');
    for (const [caller, n] of table(heavyCallers).slice(0, 8)) console.log(`    ${caller.padEnd(48)} ${n}`);
  }
  console.log(`  rows without a turn id: ${calls.filter((r) => !r.turn).length} (background ticks and pre-withTurn rows)`);
}

// Cached share per model (sum cached / sum in), plus how many rows saw any hit. Split by model
// because Flash-Lite buckets have no free-tier caching and would dilute what 3.x Flash does.
const cache = new Map();
for (const r of calls) {
  if (!r.ok) continue;
  const c = cache.get(r.model) || { in: 0, cached: 0, hits: 0, rows: 0, measured: 0, think: 0 };
  c.rows += 1;
  c.in += r.in || 0;
  c.think += r.think || 0;
  if (r.cached !== null && r.cached !== undefined) { c.measured += 1; c.cached += r.cached; if (r.cached > 0) c.hits += 1; }
  cache.set(r.model, c);
}
console.log('\nCached share and thinking tokens per model (ok rows):');
for (const [model, c] of [...cache].sort((a, b) => b[1].rows - a[1].rows)) {
  const share = c.measured ? pct(c.cached, c.in) : 'unmeasured (rows predate the cached field)';
  console.log(`  ${String(model).padEnd(28)} rows ${String(c.rows).padStart(4)}  in ${String(c.in).padStart(8)}  cached ${String(c.cached).padStart(7)} (${share}, ${c.hits} rows with a hit)  think ${c.think}`);
}

// Scheduled vs user split by caller file.
const byCaller = new Map();
let scheduled = 0;
for (const r of calls) {
  inc(byCaller, r.caller || 'unknown');
  if (SCHEDULED_FILES.some((f) => String(r.caller || '').startsWith(f))) scheduled += 1;
}
console.log(`\nScheduled (${SCHEDULED_FILES.join(', ')}) vs everything else: ${scheduled} / ${calls.length - scheduled} (scheduled ${pct(scheduled, calls.length)})`);
console.log('Rows by caller:');
for (const [caller, n] of table(byCaller).slice(0, 20)) console.log(`  ${caller.padEnd(48)} ${n}`);

// Quota ids seen on 429 rows, once the Gemini error parser has captured any.
const quotas = new Map();
for (const r of calls) if (r.quota) inc(quotas, r.quota);
if (quotas.size) {
  console.log('\nQuota ids on 429 rows:');
  for (const [q, n] of table(quotas)) console.log(`  ${q}  ${n}`);
}
