import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateFakeActions } from '../src/action-claims.js';

test('the Pragma promise is gated (we + experiment verb)', () => {
  const r = gateFakeActions("running a side-by-side on 0.91 will give us the actual retention delta. we'll benchmark that across the teachers harness.");
  assert.equal(r.changed, true);
  assert.deepEqual(r.removed, ["we'll benchmark that across the teachers harness."]);
});

test('existing I-promises still gated', () => {
  assert.equal(gateFakeActions("I'll track that for you.").changed, true);
  assert.equal(gateFakeActions('I will test it tonight.').changed, true);
});

test('nouns and past observations pass', () => {
  for (const s of ['I have a test for you.', "we've seen the test results.", 'we will see.', 'that test is worth running.', 'want me to compare them?']) {
    assert.equal(gateFakeActions(s).changed, false, s);
  }
});

test('a tool that ran lets the claim through', () => {
  assert.equal(gateFakeActions("we'll benchmark that.", { toolsRan: 1 }).changed, false);
});
