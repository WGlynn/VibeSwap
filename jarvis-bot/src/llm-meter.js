// ============ LLM Meter: one line per physical model request ============
//
// Complete-task accounting (HarnessMM, arXiv 2610.32813): a pipeline step only pays if
// it removes more model work than it adds. On free-tier inference the binding limit is
// request quota, so every physical request is logged with the code that asked for it.
//
// Output: <LLM_CALL_LOG> (default ~/jarvis-bot-logs/llm-calls.jsonl), one JSON line per
// request: ts, provider, model, ms, ok, input/output tokens when the provider reports
// them, cached (provider-side cache hits) and think (thinking tokens) when reported,
// turn (the Telegram message this request belongs to, see withTurn), caller (first stack
// frame outside the provider layer), error and quota (on failure).
//
// A second row kind, { kind: 'no_model' }, records a turn answered without any model
// request (quick reply, bare ack). Those rows do not count toward `total`, which stays
// the number of physical requests, so the two are never conflated.

import { appendFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, basename } from 'path';
import { AsyncLocalStorage } from 'node:async_hooks';

const LOG = process.env.LLM_CALL_LOG || join(homedir(), 'jarvis-bot-logs', 'llm-calls.jsonl');
let total = 0;
let noModel = 0;
const byCaller = new Map();
const noModelByReason = new Map();

// Turn id scope. withTurn(id, fn) tags every meter row written while fn (and anything it
// awaits or spawns) runs, so a report can count physical requests per incoming message:
// tool-loop rounds, 429/503 rotations and background work all share the id without an
// argument threaded through llmChat. Stdlib only.
const turnStore = new AsyncLocalStorage();

export function withTurn(id, fn) {
  return turnStore.run(String(id), fn);
}

export function currentTurn() {
  return turnStore.getStore() ?? null;
}

function callerOf(stack) {
  for (const line of String(stack).split('\n').slice(1)) {
    if (line.includes('llm-provider.js') || line.includes('llm-meter.js') || line.includes('node:')) continue;
    const named = line.match(/at (?:async )?(\S+) \((?:file:\/\/\/)?(.+):(\d+):\d+\)$/);
    if (named) return `${basename(named[2])}:${named[3]} ${named[1]}`;
    const anon = line.match(/at (?:async )?(?:file:\/\/\/)?(.+):(\d+):\d+$/);
    if (anon) return `${basename(anon[1])}:${anon[2]}`;
  }
  return 'unknown';
}

function write(entry) {
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    appendFileSync(LOG, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.warn(`[llm-meter] write failed: ${err.message}`);
  }
}

function record(entry) {
  total += 1;
  byCaller.set(entry.caller, (byCaller.get(entry.caller) || 0) + 1);
  write(entry);
}

// A turn that was answered without a model request. `reason` is a short tag such as
// 'quick_reply' or 'bare_ack'; `extra` is merged into the row (chat type, for example).
export function recordNoModelTurn(reason, extra = {}) {
  noModel += 1;
  noModelByReason.set(reason, (noModelByReason.get(reason) || 0) + 1);
  write({ ts: new Date().toISOString(), kind: 'no_model', reason, turn: currentTurn(), ...extra });
}

export function metered(provider) {
  if (!provider || typeof provider.chat !== 'function' || provider.__metered) return provider;
  const inner = provider.chat.bind(provider);
  provider.chat = async (request) => {
    const caller = callerOf(new Error().stack);
    const t0 = Date.now();
    const base = {
      ts: new Date().toISOString(),
      provider: provider.name,
      model: request?.model || provider.model,
      caller,
      turn: currentTurn(),
    };
    try {
      const result = await inner(request);
      const u = result?.usage || {};
      record({
        ...base,
        ms: Date.now() - t0,
        ok: true,
        in: u.input_tokens ?? null,
        out: u.output_tokens ?? null,
        cached: u.cached_tokens ?? null,
        think: u.thinking_tokens ?? null,
      });
      return result;
    } catch (err) {
      const row = { ...base, ms: Date.now() - t0, ok: false, error: String(err?.message || err).slice(0, 160) };
      if (err?.quotaId) row.quota = err.quotaId;
      record(row);
      throw err;
    }
  };
  provider.__metered = true;
  return provider;
}

export function meterStats() {
  return {
    total,
    noModel,
    noModelByReason: Object.fromEntries([...noModelByReason].sort((a, b) => b[1] - a[1])),
    byCaller: Object.fromEntries([...byCaller].sort((a, b) => b[1] - a[1])),
  };
}
