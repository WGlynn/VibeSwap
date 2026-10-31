import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDirective } from '../src/directives.js';

// 2026-10-30: Will told the bot "You can't respond unless tagged J"; the bot replied
// "got it, back in tag-only mode" but no pattern matched, so the chat stayed normal.
test("negated forms beyond don't switch a chat to tag-only", () => {
  for (const text of [
    "You can't respond unless tagged J",
    'you cannot reply unless you are tagged',
    "you shouldn't talk unless someone tags you",
    "please don't speak unless summoned",
  ]) {
    assert.equal(detectDirective(text)?.mode, 'tag-only', text);
  }
});

test('curly apostrophes from phone keyboards are matched', () => {
  assert.equal(detectDirective('You can’t respond unless tagged')?.mode, 'tag-only');
});

test('ordinary questions are not directives', () => {
  assert.equal(detectDirective('can you respond to this when you get a chance?'), null);
  assert.equal(detectDirective("I can't respond unless I check my notes"), null);
  assert.equal(detectDirective('you can talk again')?.mode, 'normal');
});
