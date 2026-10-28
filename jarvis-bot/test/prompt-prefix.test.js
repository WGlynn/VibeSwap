// ============ Prompt prefix: frozen, static-first, no clock in the static part ============
//
// Standalone until it has been clean for a week (it reads the real memory/knowledge files, so
// it is content-dependent). Run from jarvis-bot/:
//   node --test --test-force-exit test/prompt-prefix.test.js
// --test-force-exit because memory.js pulls in modules that start intervals.
//
// Guards the property the Gemini implicit cache depends on: systemPrompt.full is the same
// bytes across two loads (so between consecutive messages) and starts with the static block.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

// A private feed dir so now.md / people.md come from fixed bytes, not the live feed.
const feedDir = join(tmpdir(), `jarvis-prefix-test-${process.pid}`);
mkdirSync(feedDir, { recursive: true });
writeFileSync(join(feedDir, 'now.md'), '# now\nfixed test content for the prefix check\n');
process.env.JARVIS_FEED_DIR = feedDir;
process.env.LLM_CALL_LOG = join(tmpdir(), `jarvis-prefix-meter-${process.pid}.jsonl`);

const { loadSystemPrompt } = await import('../src/memory.js');

test('two loads produce byte-identical full prompts and the same prefix hash', async () => {
  const a = await loadSystemPrompt();
  const b = await loadSystemPrompt();
  assert.equal(a.full.length, b.full.length);
  assert.equal(a.full, b.full);
  assert.equal(a.prefixHash, b.prefixHash);
  assert.match(a.prefixHash, /^[0-9a-f]{12}$/);
});

test('full starts with static, ends with recency; static clears the 4,096-token Gemini 3.x minimum', async () => {
  const a = await loadSystemPrompt();
  assert.ok(a.full.startsWith(a.static), 'static block is first');
  assert.ok(a.full.endsWith(a.recency), 'recency rules close the frozen block');
  // About 4 chars per token; 4,096 tokens is roughly 16k chars. The static block alone is ~50k.
  assert.ok(a.static.length > 20000, `static block is ${a.static.length} chars`);
});

test('no clock or ISO timestamp in the static part', async () => {
  const a = await loadSystemPrompt();
  assert.doesNotMatch(a.static, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'ISO timestamp in static');
  assert.doesNotMatch(a.static, /\bup \d+ min\b/, 'self-state uptime line leaked into static');
  assert.doesNotMatch(a.full, /\bup \d+ min\b/, 'self-state uptime line leaked into the frozen block');
});
