// ============ Gemini live e2e — REAL API CALLS (spends free-tier quota) ============
//
// Opt-in only, never part of `npm test`. Run from jarvis-bot/ so .env loads:
//   GEMINI_LIVE=1 node test/gemini-live-e2e.mjs tools     # 2 real calls: functionCall round trip + thinking
//   GEMINI_LIVE=1 node test/gemini-live-e2e.mjs rotation  # 1 real call: synthetic 429 on GEMINI_MODEL → real fallback
//   GEMINI_LIVE=1 node test/gemini-live-e2e.mjs cache     # 2 real calls: identical ~24k-char system twice, prints cachedContentTokenCount
// Prints shapes and counts only, never the key or the signature bytes.

if (process.env.GEMINI_LIVE !== '1') {
  console.log('skipped: set GEMINI_LIVE=1 (spends real Gemini quota)');
  process.exit(0);
}
const mode = process.argv[2] || 'tools';
process.loadEnvFile('.env');
const primary = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
if (mode === 'rotation') {
  // The synthetic 429 must not land in the bot's real meter log.
  process.env.LLM_CALL_LOG = `${process.env.TEMP || '/tmp'}/jarvis-gemini-rotation-e2e.jsonl`;
  process.env.GEMINI_FALLBACK_MODELS = 'gemini-3.5-flash-lite';
}
if (mode === 'cache') {
  process.env.LLM_CALL_LOG = `${process.env.TEMP || '/tmp'}/jarvis-gemini-cache-e2e.jsonl`;
}

// ============ Fetch Tap ============
let physical = 0;
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.includes('generativelanguage.googleapis.com')) return realFetch(url, init);
  const model = /models\/([^:]+):/.exec(u)?.[1];
  const body = JSON.parse(init.body);
  sent.push({ model, generationConfig: body.generationConfig, nTools: body.tools?.[0]?.functionDeclarations?.length || 0 });
  if (mode === 'rotation' && model === primary) {
    console.log(`[tap] synthetic 429 for ${model} (no network)`);
    return new Response(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota (synthetic)',
      details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '30s' }] } }), { status: 429 });
  }
  physical++;
  const res = await realFetch(url, init);
  const clone = res.clone();
  try {
    const data = await clone.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    console.log(`[tap] ${model} HTTP ${res.status} finish=${data.candidates?.[0]?.finishReason} parts=${JSON.stringify(parts.map(p => Object.keys(p).map(k => k === 'thoughtSignature' ? `thoughtSignature(${p[k].length}b)` : k)))}`
      + ` usage=${JSON.stringify(data.usageMetadata || {})}${data.error ? ' error=' + JSON.stringify(data.error).slice(0, 300) : ''}`);
  } catch {}
  return res;
};

const llm = await import('../src/llm-provider.js');
llm.createProvider('gemini', { apiKey: process.env.GEMINI_API_KEY, model: primary });

const TOOLS = [
  { name: 'get_time', description: 'Returns the current UTC time as ISO-8601.', input_schema: { type: 'object', properties: {} } },
  { name: 'set_behavior', description: 'Update a runtime behavior flag.', input_schema: { type: 'object', properties: {
    flag: { type: 'string', description: 'The behavior flag to update' },
    value: { description: 'The new value (boolean for flags, string for welcomeMessage)' },
  }, required: ['flag', 'value'] } },
];

if (mode === 'tools') {
  const messages = [{ role: 'user', content: 'What time is it right now in UTC? Call get_time first, then explain in two sentences the trade-offs of server time versus client time for an auction deadline.' }];
  const r1 = await llm.llmChat({ model: 'claude-sonnet-4-5', max_tokens: 1024, system: 'You are terse. Use tools when asked.', messages, tools: TOOLS });
  const tu = r1.content.find(b => b.type === 'tool_use');
  console.log('round1:', { stop_reason: r1.stop_reason, blocks: r1.content.map(b => b.type), tool: tu?.name, id: tu?.id, _model: r1._model, thinking_tokens: r1.usage.thinking_tokens });
  if (!tu) { console.log('FAIL: no functionCall'); process.exit(1); }
  messages.push({ role: 'assistant', content: r1.content });
  messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: tu.id, content: new Date().toISOString() }] });
  const r2 = await llm.llmChat({ model: 'claude-sonnet-4-5', max_tokens: 1024, system: 'You are terse. Use tools when asked.', messages, tools: TOOLS });
  console.log('round2:', { stop_reason: r2.stop_reason, _model: r2._model, text: r2.content.filter(b => b.type === 'text').map(b => b.text).join(' ').slice(0, 400) });
} else if (mode === 'cache') {
  // Does implicit caching report any hit on this model and tier? Deterministic system string
  // (no timestamps) well above the 4,096-token 3.x minimum, sent twice through the metered
  // provider with the model pinned (no llmChat routing, no rotation). Counts only, never the key.
  const paragraph = 'VibeSwap is a coordination primitive, not a casino. Orders are committed as hashes, revealed in a short window, shuffled with a seed no single party controls, and cleared at one uniform price per batch so position in the block buys nothing. ';
  const system = 'You answer in one short sentence.\n\n' + paragraph.repeat(Math.ceil(24000 / paragraph.length));
  const provider = llm.getProvider();
  const ask = () => provider.chat({ model: primary, max_tokens: 60, system, messages: [{ role: 'user', content: 'What does the uniform clearing price remove?' }] });
  let r1, r2;
  try {
    r1 = await ask();
    r2 = await ask();
  } catch (e) {
    // A quota 429 answers a different question (which bucket is dry, and for how long); print
    // that and stop so the second call is not spent against an exhausted model.
    console.log(`cache mode: ${primary} refused: status=${e.status} quotaId=${e.quotaId || 'n/a'} retryAfterMs=${e.retryAfterMs || 0}`);
    console.log('RESULT: cache check not answered today (model rejected the request); rerun after the quota resets');
    console.log(`PHYSICAL REAL CALLS: ${physical}`);
    process.exit(0);
  }
  const show = (r) => ({ promptTokenCount: r.usage.input_tokens, cachedContentTokenCount: r.usage.cached_tokens, out: r.usage.output_tokens, think: r.usage.thinking_tokens });
  console.log(`cache mode: model=${primary} systemChars=${system.length}`);
  console.log('call 1:', show(r1));
  console.log('call 2:', show(r2));
  const { readFileSync } = await import('fs');
  const rows = readFileSync(process.env.LLM_CALL_LOG, 'utf8').trim().split('\n').slice(-2).map(l => JSON.parse(l));
  console.log('meter rows cached:', rows.map(x => ({ model: x.model, in: x.in, cached: x.cached, ok: x.ok })));
  console.log(r2.usage.cached_tokens > 0
    ? 'RESULT: implicit caching HIT on the second call; measuring the production prefix is worth it'
    : 'RESULT: no cached tokens reported on the second call; prefix-discipline work buys nothing on this tier until this changes');
} else {
  const r = await llm.llmChat({ max_tokens: 200, messages: [{ role: 'user', content: 'In one sentence: why do batch auctions resist front-running?' }] });
  console.log('rotation:', { _model: r._model, trail: r._cascadeTrail.map(t => `${t.model}:${t.status}`), text: r.content.map(b => b.text).join(' ').slice(0, 200) });
  const { readFileSync } = await import('fs');
  console.log('meter lines:\n' + readFileSync(process.env.LLM_CALL_LOG, 'utf8').trim().split('\n').slice(-2).join('\n'));
}
console.log('request shapes sent:', JSON.stringify(sent));
console.log(`PHYSICAL REAL CALLS: ${physical}`);
