// ============ llm-meter: cached/think fields, no-model rows, turn ids ============
// No network, no provider. A fake provider object is wrapped by metered() and the rows
// land in a temp LLM_CALL_LOG that is set before the module loads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFileSync, rmSync, existsSync } from 'fs';

const LOG = join(tmpdir(), `jarvis-meter-test-${process.pid}.jsonl`);
process.env.LLM_CALL_LOG = LOG;
if (existsSync(LOG)) rmSync(LOG);

const { metered, meterStats, recordNoModelTurn, withTurn, currentTurn } = await import('../src/llm-meter.js');

const rows = () => readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const lastRow = () => rows().at(-1);
const fakeProvider = (usage, name = 'fake') => metered({
  name,
  model: 'fake-model',
  async chat() { await new Promise((r) => setTimeout(r, 1)); return { content: [], usage }; },
});

test('metered: cached and think fields land on the row next to in/out', async () => {
  const p = fakeProvider({ input_tokens: 100, output_tokens: 5, cached_tokens: 64, thinking_tokens: 7 });
  await p.chat({ messages: [] });
  const row = lastRow();
  assert.equal(row.ok, true);
  assert.equal(row.in, 100);
  assert.equal(row.out, 5);
  assert.equal(row.cached, 64);
  assert.equal(row.think, 7);
  assert.equal(row.turn, null, 'no turn id outside withTurn');
  assert.equal(row.provider, 'fake');
});

test('metered: providers that report no cache count write null, not 0', async () => {
  const p = fakeProvider({ input_tokens: 10, output_tokens: 1 });
  await p.chat({ messages: [] });
  assert.equal(lastRow().cached, null);
  assert.equal(lastRow().think, null);
});

test('metered: error rows carry quota when the error has quotaId', async () => {
  const p = metered({ name: 'fake', model: 'm', async chat() { const e = new Error('Gemini API error 429: RESOURCE_EXHAUSTED'); e.status = 429; e.quotaId = 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'; throw e; } });
  await assert.rejects(p.chat({}), /429/);
  const row = lastRow();
  assert.equal(row.ok, false);
  assert.equal(row.quota, 'GenerateRequestsPerDayPerProjectPerModel-FreeTier');
});

test('recordNoModelTurn: writes a no_model row and counts it apart from physical total', async () => {
  const before = meterStats();
  recordNoModelTurn('quick_reply', { chatType: 'private' });
  const row = lastRow();
  assert.equal(row.kind, 'no_model');
  assert.equal(row.reason, 'quick_reply');
  assert.equal(row.chatType, 'private');
  assert.equal(row.turn, null);
  const after = meterStats();
  assert.equal(after.noModel, before.noModel + 1);
  assert.equal(after.total, before.total, 'physical request total untouched');
  assert.equal(after.noModelByReason.quick_reply, (before.noModelByReason.quick_reply || 0) + 1);
});

test('withTurn: two sequential chats share the id; a chat outside has null', async () => {
  const p = fakeProvider({ input_tokens: 1, output_tokens: 1 });
  await withTurn('c1:9', async () => {
    await p.chat({});
    await p.chat({});
    assert.equal(currentTurn(), 'c1:9');
  });
  const last2 = rows().slice(-2);
  assert.deepEqual(last2.map((r) => r.turn), ['c1:9', 'c1:9']);
  await p.chat({});
  assert.equal(lastRow().turn, null);
});

test('withTurn: concurrent scopes do not leak ids into each other', async () => {
  const p = fakeProvider({ input_tokens: 1, output_tokens: 1 });
  const seen = {};
  await Promise.all([
    withTurn('a', async () => { await p.chat({}); await new Promise((r) => setTimeout(r, 5)); seen.a = currentTurn(); await p.chat({}); }),
    withTurn('b', async () => { await new Promise((r) => setTimeout(r, 2)); await p.chat({}); seen.b = currentTurn(); await p.chat({}); }),
  ]);
  assert.equal(seen.a, 'a');
  assert.equal(seen.b, 'b');
  const last4 = rows().slice(-4);
  assert.equal(last4.filter((r) => r.turn === 'a').length, 2);
  assert.equal(last4.filter((r) => r.turn === 'b').length, 2);
});

test('withTurn: no_model rows inside a scope carry the id too', async () => {
  await withTurn('q:1', async () => recordNoModelTurn('bare_ack'));
  assert.equal(lastRow().turn, 'q:1');
});
