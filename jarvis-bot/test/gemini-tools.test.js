// ============ Gemini native tools / thinking / retry policy — mocked ============
//
// Zero real API calls: globalThis.fetch is replaced before llm-provider.js loads. Covers the
// Anthropic <-> Gemini conversions (tools, functionCall, functionResponse, thought signatures),
// thinking on hard messages, and llmChat's 429-rotation / 503-backoff / 400-degrade paths.
// The meter log goes to a temp file so these fake calls never touch the bot's real log.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFileSync } from 'fs';

process.env.LLM_CALL_LOG = join(tmpdir(), `jarvis-gemini-test-${process.pid}.jsonl`);
process.env.GEMINI_FALLBACK_MODELS = 'gemini-test-lite,gemini-test-latest';

// ============ Fetch Mock ============
const calls = [];
let responders = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.includes('generativelanguage.googleapis.com')) return new Response('not mocked', { status: 404 });
  const body = init.body ? JSON.parse(init.body) : null;
  const model = /models\/([^:]+):generateContent/.exec(u)?.[1];
  calls.push({ model, body });
  const next = responders.shift();
  if (!next) throw new Error('fetch mock: no responder queued');
  return next({ model, body });
};
const json = (obj, status = 200) => () => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const textReply = (text) => json({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
const reset = (...rs) => { calls.length = 0; responders = rs; };

const llm = await import('../src/llm-provider.js');
const { withTurn } = await import('../src/llm-meter.js');
const meterLines = () => { try { return readFileSync(process.env.LLM_CALL_LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const newGemini = (model = 'gemini-3.5-flash') => llm.createProvider('gemini', { apiKey: 'test-key-not-real', model });

const TOOLS = [
  { name: 'get_time', description: 'Current time', input_schema: { type: 'object', properties: {} } },
  { name: 'set_behavior', description: 'Set a flag', input_schema: {
    type: 'object', $schema: 'http://json-schema.org/draft-07/schema#', additionalProperties: false,
    properties: {
      flag: { type: 'string', description: 'flag name', default: 'x' },
      value: { description: 'boolean or string' },
      level: { type: 'integer', enum: [1, 2, 3] },
      note: { type: ['string', 'null'] },
      tags: { type: 'array' },
    },
    required: ['flag', 'value', 'ghost'],
  } },
];

// ============ Conversions ============

test('tools: Anthropic input_schema → sanitized Gemini functionDeclarations', async () => {
  const p = newGemini();
  reset(textReply('ok'));
  await p.chat({ messages: [{ role: 'user', content: 'hi' }], tools: TOOLS, max_tokens: 100 });
  const decls = calls[0].body.tools[0].functionDeclarations;
  assert.equal(decls.length, 2);
  assert.deepEqual(decls[0], { name: 'get_time', description: 'Current time' }, 'zero-arg tool omits parameters');
  const params = decls[1].parameters;
  assert.equal(params.type, 'object');
  assert.ok(!('additionalProperties' in params) && !('$schema' in params), 'unknown keys dropped');
  assert.ok(!('default' in params.properties.flag));
  assert.deepEqual(params.properties.value.anyOf.map(s => s.type), ['string', 'number', 'boolean'], 'untyped → any scalar');
  assert.equal(params.properties.level.type, 'integer');
  assert.ok(!params.properties.level.enum && /Allowed: 1, 2, 3/.test(params.properties.level.description), 'non-string enum → description');
  assert.deepEqual(params.properties.note, { type: 'string', nullable: true });
  assert.deepEqual(params.properties.tags.items, { type: 'string' }, 'array always gets items');
  assert.deepEqual(params.required, ['flag', 'value'], 'required filtered to real properties');
});

test('response: functionCall → tool_use (+ signature kept aside), thought parts skipped', async () => {
  const p = newGemini();
  reset(json({ candidates: [{ content: { role: 'model', parts: [
    { text: 'private reasoning', thought: true },
    { text: 'Checking.' },
    { functionCall: { id: 'fc-1', name: 'get_time', args: {} }, thoughtSignature: 'SIG_A' },
    { functionCall: { id: 'fc-2', name: 'set_behavior', args: { flag: 'f', value: true } } },
  ] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, thoughtsTokenCount: 9 } }));
  const r = await p.chat({ messages: [{ role: 'user', content: 'time?' }], tools: TOOLS });
  assert.equal(r.stop_reason, 'tool_use');
  assert.deepEqual(r.content.map(b => b.type), ['text', 'tool_use', 'tool_use']);
  assert.equal(r.content[0].text, 'Checking.');
  const [t1, t2] = r.content.slice(1);
  assert.match(t1.id, /^toolu_gemini_[0-9a-f]{16}$/);
  assert.notEqual(t1.id, t2.id);
  assert.deepEqual(Object.keys(t1).sort(), ['id', 'input', 'name', 'type'], 'block stays Anthropic-clean');
  assert.equal(r.usage.thinking_tokens, 9);
  assert.equal(r._model, 'gemini-3.5-flash');

  // Round trip: replay the assistant turn + tool results.
  reset(textReply('It is noon.'));
  await p.chat({ tools: TOOLS, messages: [
    { role: 'user', content: 'time?' },
    { role: 'assistant', content: r.content },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: t1.id, content: '12:00' },
      { type: 'tool_result', tool_use_id: t2.id, content: [{ type: 'text', text: 'denied' }], is_error: true },
    ] },
  ] });
  const [u0, m1, u2] = calls[0].body.contents;
  assert.equal(u0.role, 'user');
  assert.equal(m1.role, 'model');
  assert.deepEqual(m1.parts[0], { text: 'Checking.' });
  assert.deepEqual(m1.parts[1], { functionCall: { id: 'fc-1', name: 'get_time', args: {} }, thoughtSignature: 'SIG_A' });
  assert.deepEqual(m1.parts[2], { functionCall: { id: 'fc-2', name: 'set_behavior', args: { flag: 'f', value: true } } }, 'parallel call: no signature on 2nd');
  assert.equal(u2.role, 'user');
  assert.deepEqual(u2.parts, [
    { functionResponse: { id: 'fc-1', name: 'get_time', response: { result: '12:00' } } },
    { functionResponse: { id: 'fc-2', name: 'set_behavior', response: { error: 'denied' } } },
  ]);
});

test('signatures: unknown ids get the placeholder on the first call only; Gemini 2.x gets none', async () => {
  const history = [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_01claude', name: 'get_time', input: {} },
      { type: 'tool_use', id: 'toolu_02claude', name: 'get_time', input: {} },
    ] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'toolu_01claude', content: 'a' },
      { type: 'tool_result', tool_use_id: 'toolu_02claude', content: 'b' },
    ] },
  ];
  reset(textReply('ok'));
  await newGemini().chat({ tools: TOOLS, messages: history });
  const model = calls[0].body.contents[1];
  assert.equal(model.parts[0].thoughtSignature, 'skip_thought_signature_validator');
  assert.ok(!('thoughtSignature' in model.parts[1]));
  assert.equal(calls[0].body.contents[2].parts[0].functionResponse.name, 'get_time');

  reset(textReply('ok'));
  await newGemini('gemini-2.5-flash').chat({ tools: TOOLS, messages: history });
  assert.ok(calls[0].body.contents[1].parts.every(p => !('thoughtSignature' in p)));
});

test('errors carry status and RetryInfo delay; key never in message', async () => {
  const p = newGemini();
  reset(json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota (key=abc123)',
    details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '4.5s' }] } }, 429));
  await assert.rejects(p.chat({ messages: [{ role: 'user', content: 'x' }] }), (e) => {
    assert.equal(e.status, 429);
    assert.equal(e.retryAfterMs, 4500);
    assert.match(e.message, /^Gemini API error 429: RESOURCE_EXHAUSTED You exceeded/);
    assert.ok(!e.message.includes('abc123'));
    return true;
  });
});

// ============ llmChat: tools, history, thinking ============

test('llmChat: Gemini receives tools; only the current turn keeps native tool exchanges', async () => {
  newGemini();
  reset(textReply('Here is a full answer for you about it.'));
  await llm.llmChat({ model: 'claude-sonnet-4-5', max_tokens: 500, system: 's', tools: TOOLS, messages: [
    { role: 'user', content: 'old question' },
    { role: 'assistant', content: [{ type: 'text', text: 'looking' }, { type: 'tool_use', id: 'toolu_old', name: 'web_search', input: { q: 'x' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_old', content: 'old result' }] },
    { role: 'assistant', content: 'old answer' },
    { role: 'user', content: 'what time is it' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_now', name: 'get_time', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_now', content: '12:00' }] },
  ] });
  const { body, model } = calls[0];
  assert.equal(model, 'gemini-3.5-flash', 'Claude model id stripped');
  assert.equal(body.tools[0].functionDeclarations.length, 2, 'tools not stripped for gemini');
  const fc = body.contents.flatMap(c => c.parts).filter(p => p.functionCall).map(p => p.functionCall.name);
  assert.deepEqual(fc, ['get_time'], 'prior-turn web_search exchange flattened, current-turn kept');
  assert.ok(JSON.stringify(body.contents).includes('looking'), 'prior-turn text survives');
});

test('thinking: hard message → thinkingLevel high + headroom; easy / background → none; 2.x → budget', async () => {
  newGemini();
  const hard = { role: 'user', content: 'Explain why the game theory of commit-reveal auctions removes MEV, and the trade-offs versus a CLOB.' };
  reset(textReply('A long enough considered answer about auctions and MEV.'));
  await llm.llmChat({ max_tokens: 1000, tools: TOOLS, messages: [hard] });
  assert.deepEqual(calls[0].body.generationConfig, { maxOutputTokens: 9192, thinkingConfig: { thinkingLevel: 'high' } });

  reset(textReply('gm to you too, friend!'));
  await llm.llmChat({ max_tokens: 1000, tools: TOOLS, messages: [{ role: 'user', content: 'gm' }] });
  assert.deepEqual(calls[0].body.generationConfig, { maxOutputTokens: 1000 });

  reset(textReply('A long enough considered answer about auctions and MEV.'));
  await llm.llmChat({ max_tokens: 1000, _background: true, messages: [hard] });
  assert.equal(calls[0].body.generationConfig.thinkingConfig, undefined);

  newGemini('gemini-2.5-flash');
  reset(textReply('A long enough considered answer about auctions and MEV.'));
  await llm.llmChat({ max_tokens: 1000, messages: [hard] });
  assert.deepEqual(calls[0].body.generationConfig.thinkingConfig, { thinkingBudget: 8192 });
});

// ============ llmChat: retry policy ============

const quota429 = (delay) => json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota',
  details: delay ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: delay }] : [] } }, 429);

test('429: rotates to the next model bucket, never retries the same model; _model is truthful', async () => {
  newGemini('gemini-test-primary');
  reset(quota429('41s'), textReply('Answer from the lite model, complete.'));
  const logLinesBefore = meterLines().length;
  const r = await withTurn('t1', () => llm.llmChat({ max_tokens: 100, messages: [{ role: 'user', content: 'tell me something about bridges please' }] }));
  assert.deepEqual(calls.map(c => c.model), ['gemini-test-primary', 'gemini-test-lite']);
  assert.equal(r._model, 'gemini-test-lite');
  assert.deepEqual(r._cascadeTrail.map(t => `${t.model}:${t.status}`), ['gemini-test-primary:credit_error', 'gemini-test-lite:success']);
  // Both physical rows (the 429 and the fallback success) are countable as one turn.
  const turnRows = meterLines().slice(logLinesBefore);
  assert.deepEqual(turnRows.map(x => [x.model, x.ok, x.turn]), [['gemini-test-primary', false, 't1'], ['gemini-test-lite', true, 't1']]);

  // Primary is cooling (41s RetryInfo) → the next message starts on the lite bucket directly.
  reset(textReply('Second answer from the lite model, complete.'));
  const r2 = await llm.llmChat({ max_tokens: 100, messages: [{ role: 'user', content: 'and another thing about bridges' }] });
  assert.deepEqual(calls.map(c => c.model), ['gemini-test-lite']);
  assert.equal(r2._model, 'gemini-test-lite');
  assert.equal(llm.getProviderHealth()['gemini']?.state ?? 'closed', 'closed', 'model 429 does not trip the provider breaker');
});

test('503: retries the same provider at ~1s then ~3s (+jitter), then succeeds', async () => {
  newGemini();
  const overloaded = json({ error: { code: 503, status: 'UNAVAILABLE', message: 'This model is currently experiencing high demand.' } }, 503);
  reset(overloaded, overloaded, textReply('Finally a complete answer here.'));
  const t0 = Date.now();
  const r = await llm.llmChat({ max_tokens: 100, messages: [{ role: 'user', content: 'tell me something about bridges please' }] });
  const elapsed = Date.now() - t0;
  assert.equal(calls.length, 3);
  assert.ok(calls.every(c => c.model === 'gemini-3.5-flash'), 'same model, no rotation on 503');
  assert.ok(elapsed >= 4000 && elapsed < 5500, `backoff ~1s+~3s, got ${elapsed}ms`);
  assert.equal(r._model, 'gemini-3.5-flash');
});

test('400 on tools: resend once without tools (old behaviour) instead of failing the message', async () => {
  newGemini();
  reset(json({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload: tools[0].function_declarations[1].parameters' } }, 400),
    textReply('Answered without tools, complete.'));
  const r = await llm.llmChat({ max_tokens: 100, tools: TOOLS, messages: [{ role: 'user', content: 'tell me something about bridges please' }] });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].body.tools && !calls[1].body.tools);
  assert.equal(r.content[0].text, 'Answered without tools, complete.');
});

test('429 with every bucket spent: no retry of the same model, fails fast (background breaker)', async () => {
  newGemini('gemini-solo');
  process.env.GEMINI_FALLBACK_MODELS = '';
  newGemini('gemini-solo'); // re-create so the empty fallback list is read
  reset(quota429(null));
  await assert.rejects(llm.llmChat({ _background: true, max_tokens: 100, messages: [{ role: 'user', content: 'x y z w' }] }));
  assert.equal(calls.length, 1, 'exactly one physical call');
});

test('429 with a short RetryInfo and no bucket left: wait it out once, then succeed', async () => {
  newGemini('gemini-solo2'); // fallback list still empty from the previous test
  reset(quota429('0.3s'), textReply('Answer after waiting the RetryInfo delay.'));
  const t0 = Date.now();
  const r = await llm.llmChat({ max_tokens: 100, messages: [{ role: 'user', content: 'tell me something about bridges please' }] });
  assert.deepEqual(calls.map(c => c.model), ['gemini-solo2', 'gemini-solo2']);
  assert.ok(Date.now() - t0 >= 300);
  assert.equal(r._model, 'gemini-solo2');
});

test('429 again after the one honored wait: give up (no second wait)', async () => {
  newGemini('gemini-solo3');
  reset(quota429('0.2s'), quota429('0.2s'));
  await assert.rejects(llm.llmChat({ max_tokens: 100, messages: [{ role: 'user', content: 'tell me something about bridges please' }] }), /429/);
  assert.equal(calls.length, 2);
});

// ============ Meter: cached tokens and quota ids ============

test('usage: cachedContentTokenCount reaches usage.cached_tokens and the meter row', async () => {
  // Direct provider.chat (still metered): earlier tests leave the provider breaker tripped,
  // and this test is about the parse path, not routing.
  const p = newGemini('gemini-3.6-flash');
  reset(json({ candidates: [{ content: { role: 'model', parts: [{ text: 'cached answer, complete enough' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 6000, candidatesTokenCount: 5, cachedContentTokenCount: 4096 } }));
  const r = await p.chat({ max_tokens: 100, messages: [{ role: 'user', content: 'tell me something about bridges please' }] });
  assert.equal(r.usage.cached_tokens, 4096);
  assert.equal(r.usage.input_tokens, 6000);
  const last = meterLines().at(-1);
  assert.equal(last.model, 'gemini-3.6-flash');
  assert.equal(last.cached, 4096);
  assert.equal(last.in, 6000);
});

test('429 with QuotaFailure: quotaId parsed onto the error and the meter error row', async () => {
  const p = newGemini('gemini-quota-test');
  reset(json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota',
    details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '5s' },
    ] } }, 429));
  try {
    await p.chat({ messages: [{ role: 'user', content: 'x' }], max_tokens: 10 });
    assert.fail('expected 429');
  } catch (e) {
    assert.equal(e.status, 429);
    assert.equal(e.retryAfterMs, 5000);
    assert.equal(e.quotaId, 'GenerateRequestsPerDayPerProjectPerModel-FreeTier');
  }
  const last = meterLines().at(-1);
  assert.equal(last.ok, false);
  assert.equal(last.quota, 'GenerateRequestsPerDayPerProjectPerModel-FreeTier');
});

// ============ OpenAI-compatible cache field: unreported means null, not 0 ============
// Same mocked-fetch harness, pointed at the openai-compatible path. The meter report
// must be able to tell "this provider never told us" (null, unmeasured) apart from
// "this provider told us zero cache hits" (0, measured).

const withOpenAIFetch = async (usage, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try { return await fn(); } finally { globalThis.fetch = real; }
};

test('openai-compat usage without any cache field reaches the meter as cached: null', async () => {
  const p = llm.createProvider('cerebras', { apiKey: 'test-key-not-real', model: 'test-model' });
  await withOpenAIFetch({ prompt_tokens: 12, completion_tokens: 3 }, () =>
    p.chat({ messages: [{ role: 'user', content: 'x' }], max_tokens: 10 }));
  const last = meterLines().at(-1);
  assert.equal(last.ok, true);
  assert.equal(last.in, 12);
  assert.equal(last.cached, null, 'unreported cache count must be null (unmeasured), not 0');
});

test('openai-compat usage with prompt_tokens_details.cached_tokens is read as-is, including 0', async () => {
  const p = llm.createProvider('groq', { apiKey: 'test-key-not-real', model: 'test-model' });
  await withOpenAIFetch({ prompt_tokens: 12, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 0 } }, () =>
    p.chat({ messages: [{ role: 'user', content: 'x' }], max_tokens: 10 }));
  assert.equal(meterLines().at(-1).cached, 0, 'a reported 0 is a real measurement');
});

test('deepseek top-level prompt_cache_hit_tokens is read when prompt_tokens_details is absent', async () => {
  const p = llm.createProvider('deepseek', { apiKey: 'test-key-not-real', model: 'test-model' });
  await withOpenAIFetch({ prompt_tokens: 40, completion_tokens: 3, prompt_cache_hit_tokens: 32, prompt_cache_miss_tokens: 8 }, () =>
    p.chat({ messages: [{ role: 'user', content: 'x' }], max_tokens: 10 }));
  assert.equal(meterLines().at(-1).cached, 32);
});
