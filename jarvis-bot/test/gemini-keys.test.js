// ============ Gemini key rotation (GEMINI_API_KEYS) — mocked ============
//
// Zero real API calls: globalThis.fetch is replaced before llm-provider.js loads. A quota
// bucket is (key, model): llmChat tries the next key for the same model before dropping a
// model, skips every key of a model on a spent 503, and parks a rejected key for the session.
// With one key everything must look exactly as before (no key field, no _keyIdx).
// Cooldowns, breakers and parked keys are module state, so each test uses its own model name
// and the tests that park key 0 run last.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFileSync } from 'fs';

process.env.LLM_CALL_LOG = join(tmpdir(), `jarvis-gemini-keys-test-${process.pid}.jsonl`);
process.env.GEMINI_FALLBACK_MODELS = 'gk-lite';

// ============ Fetch Mock ============
const calls = [];
let responders = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.includes('generativelanguage.googleapis.com')) return new Response('not mocked', { status: 404 });
  const body = init.body ? JSON.parse(init.body) : null;
  const model = /models\/([^:]+):generateContent/.exec(u)?.[1];
  calls.push({ model, key: new URL(u).searchParams.get('key'), body });
  const next = responders.shift();
  if (!next) throw new Error('fetch mock: no responder queued');
  return next({ model, body });
};
const json = (obj, status = 200) => () => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const textReply = (text) => json({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
const quota429 = () => json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota' } }, 429);
const overloaded = () => json({ error: { code: 503, status: 'UNAVAILABLE', message: 'This model is currently experiencing high demand.' } }, 503);
const keyInvalid400 = () => json({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key. (key=fake-key-A)',
  details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com' }] } }, 400);
const reset = (...rs) => { calls.length = 0; responders = rs; };
const seen = () => calls.map(c => `${c.key}/${c.model}`);

const llm = await import('../src/llm-provider.js');
const { splitKeys } = await import('../src/config.js');
const meterLines = () => { try { return readFileSync(process.env.LLM_CALL_LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const oneKey = (model) => llm.createProvider('gemini', { apiKey: 'fake-key-A', model });
const twoKeys = (model) => llm.createProvider('gemini', { apiKeys: ['fake-key-A', 'fake-key-B'], model });
const ask = (extra = {}) => llm.llmChat({ max_tokens: 100, messages: [{ role: 'user', content: 'tell me something about bridges please' }], ...extra });

// ============ Config ============

test('splitKeys: ordered, trimmed, de-duplicated, empty-safe', () => {
  assert.deepEqual(splitKeys('A', 'A, B,,C '), ['A', 'B', 'C']);
  assert.deepEqual(splitKeys(undefined, 'X'), ['X']);
  assert.deepEqual(splitKeys(null, ''), []);
});

// ============ Rotation ============

test('one key: 429 rotates model only; no key field, no _keyIdx (old behaviour)', async () => {
  const p = oneKey('gk-1');
  assert.equal(p.keyCount, 1);
  reset(quota429(), textReply('Answer from the lite model, complete.'));
  const r = await ask();
  assert.deepEqual(seen(), ['fake-key-A/gk-1', 'fake-key-A/gk-lite']);
  assert.equal(r._model, 'gk-lite');
  assert.ok(r._cascadeTrail.every(t => !('key' in t)), 'trail carries no key with one key');
  const rows = meterLines().filter(m => m.model === 'gk-1' || (m.model === 'gk-lite' && m.ok));
  assert.ok(rows.length >= 2 && rows.every(m => !('key' in m)), 'meter rows carry no key with one key');
});

test('two keys: 429 rotates to the next key on the SAME model; next call starts there', async () => {
  twoKeys('gk-2');
  reset(quota429(), textReply('Answer from key B on the best model.'));
  const r = await ask();
  assert.deepEqual(seen(), ['fake-key-A/gk-2', 'fake-key-B/gk-2']);
  assert.equal(r._model, 'gk-2');
  assert.deepEqual(meterLines().filter(m => m.model === 'gk-2').map(m => m.key), [0, 1]);
  assert.equal(r._cascadeTrail.at(-1).key, 1);
  reset(textReply('Second answer, straight from key B.'));
  await ask();
  assert.deepEqual(seen(), ['fake-key-B/gk-2'], '(A, gk-2) is cooling down, so B goes first');
});

test('two keys: both 429 on the primary model, then the next model on key A', async () => {
  twoKeys('gk-3');
  reset(quota429(), quota429(), textReply('Answer from the lite model, complete.'));
  const r = await ask();
  assert.deepEqual(seen(), ['fake-key-A/gk-3', 'fake-key-B/gk-3', 'fake-key-A/gk-lite']);
  assert.equal(r._model, 'gk-lite');
});

test('two keys: spent 503 retries skip the other key (overload is per model)', async () => {
  twoKeys('gk-4');
  reset(overloaded(), overloaded(), overloaded(), textReply('Answer after the overload, complete.'));
  const r = await ask();
  assert.deepEqual(seen(), ['fake-key-A/gk-4', 'fake-key-A/gk-4', 'fake-key-A/gk-4', 'fake-key-A/gk-lite']);
  assert.equal(r._model, 'gk-lite');
});

test('thought signature minted under key 0 is not replayed under key 1', async () => {
  const p = twoKeys('gemini-3.9-gk-sig');
  reset(json({ candidates: [{ content: { role: 'model', parts: [
    { functionCall: { name: 'get_time', args: {} }, thoughtSignature: 'SIG_K0' },
  ] }, finishReason: 'STOP' }] }));
  const first = await p.chat({ messages: [{ role: 'user', content: 'time?' }], max_tokens: 100 });
  const toolUse = first.content.find(b => b.type === 'tool_use');
  const history = [
    { role: 'user', content: 'time?' },
    { role: 'assistant', content: [toolUse] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: 'noon' }] },
  ];
  const sigOf = (c) => c.body.contents.find(t => t.role === 'model').parts.find(x => x.functionCall).thoughtSignature;
  reset(textReply('ok'), textReply('ok'));
  await p.chat({ messages: history, max_tokens: 100 });
  await p.chat({ messages: history, max_tokens: 100, _keyIdx: 1 });
  assert.equal(sigOf(calls[0]), 'SIG_K0', 'same key, same model: real signature');
  assert.equal(sigOf(calls[1]), 'skip_thought_signature_validator', 'other key: placeholder');
  assert.equal(calls[1].key, 'fake-key-B');
});

// ============ Rejected keys ============

test('error parse: API_KEY_INVALID / leaked flag keyInvalid; key never in message; tool 400 untouched', async () => {
  const p = oneKey('gk-parse');
  reset(keyInvalid400());
  const e1 = await p.chat({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 }).catch(e => e);
  assert.equal(e1.keyInvalid, true);
  assert.equal(e1.status, 400);
  assert.ok(!e1.message.includes('fake-key-A'), 'key redacted from the message');
  reset(json({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'Your API key was reported as leaked. Please use another API key.' } }, 403));
  const e2 = await p.chat({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 }).catch(e => e);
  assert.equal(e2.keyInvalid, true);
  reset(json({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload: function_declarations[0].parameters schema' } }, 400));
  const e3 = await p.chat({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 }).catch(e => e);
  assert.equal(e3.keyInvalid, undefined, 'a tool-schema 400 stays with degradeAfter400');
});

test('one key + API_KEY_INVALID: no parking, old permanent-error path; next call still uses the key', async () => {
  oneKey('gk-6');
  reset(keyInvalid400());
  await assert.rejects(ask({ _background: true }), /400/);
  assert.equal(calls.length, 1);
  reset(textReply('Answer on the same single key, complete.'));
  await ask({ _background: true });
  assert.deepEqual(seen(), ['fake-key-A/gk-6']);
});

// Parks key 0 for the rest of this process, so it runs last.
test('two keys: a rejected key is parked for the session; same model on the next key, breaker closed', async () => {
  twoKeys('gk-5');
  reset(keyInvalid400(), textReply('Answer from key B after A was rejected.'));
  const r = await ask();
  assert.deepEqual(seen(), ['fake-key-A/gk-5', 'fake-key-B/gk-5']);
  assert.equal(r._model, 'gk-5');
  assert.equal(llm.getProviderHealth()['gemini']?.state ?? 'closed', 'closed', 'a bad key does not trip the breaker');
  twoKeys('gk-7'); // fresh model, no cooldowns: key A is still skipped
  reset(textReply('Straight to key B.'));
  await ask();
  assert.deepEqual(seen(), ['fake-key-B/gk-7']);
});
