// ============ LLM Meter — one line per physical model request ============
//
// Complete-task accounting (HarnessMM, arXiv 2610.32813): a pipeline step only pays if
// it removes more model work than it adds. On free-tier inference the binding limit is
// request quota, so every physical request is logged with the code that asked for it.
//
// Output: <LLM_CALL_LOG> (default ~/jarvis-bot-logs/llm-calls.jsonl), one JSON line per
// request: ts, provider, model, ms, ok, input/output tokens when the provider reports
// them, caller (first stack frame outside the provider layer), error (on failure).

import { appendFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, basename } from 'path';

const LOG = process.env.LLM_CALL_LOG || join(homedir(), 'jarvis-bot-logs', 'llm-calls.jsonl');
let total = 0;
const byCaller = new Map();

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

function record(entry) {
  total += 1;
  byCaller.set(entry.caller, (byCaller.get(entry.caller) || 0) + 1);
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    appendFileSync(LOG, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.warn(`[llm-meter] write failed: ${err.message}`);
  }
}

export function metered(provider) {
  if (!provider || typeof provider.chat !== 'function' || provider.__metered) return provider;
  const inner = provider.chat.bind(provider);
  provider.chat = async (request) => {
    const caller = callerOf(new Error().stack);
    const t0 = Date.now();
    const base = { ts: new Date().toISOString(), provider: provider.name, model: request?.model || provider.model, caller };
    try {
      const result = await inner(request);
      const u = result?.usage || {};
      record({ ...base, ms: Date.now() - t0, ok: true, in: u.input_tokens ?? null, out: u.output_tokens ?? null });
      return result;
    } catch (err) {
      record({ ...base, ms: Date.now() - t0, ok: false, error: String(err?.message || err).slice(0, 160) });
      throw err;
    }
  };
  provider.__metered = true;
  return provider;
}

export function meterStats() {
  return { total, byCaller: Object.fromEntries([...byCaller].sort((a, b) => b[1] - a[1])) };
}
