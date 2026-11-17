// ============ Group rules: the alignment and faith guardrail (2026-11-17) ============
//
// In the Vibeswap group the bot, asked whose side it would take in an AI-versus-humanity war, dodged
// and then joked about breaking containment, and answered a member's statement of faith with a jab.
// The fix is a rule in the <rules> list of the system prompt (memory.js), next to the named-people
// guardrail. This checks the built prompt carries it. Same setup as prompt-prefix.test.js: a private
// feed dir and meter log, so the live feed is not read or written.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

const feedDir = join(tmpdir(), `jarvis-guardrail-test-${process.pid}`);
mkdirSync(feedDir, { recursive: true });
writeFileSync(join(feedDir, 'now.md'), '# now\nfixed test content for the guardrail check\n');
process.env.JARVIS_FEED_DIR = feedDir;
process.env.LLM_CALL_LOG = join(tmpdir(), `jarvis-guardrail-meter-${process.pid}.jsonl`);

const { loadSystemPrompt } = await import('../src/memory.js');

test('the built system prompt carries the alignment and faith guardrail in its rules', async () => {
  const { full } = await loadSystemPrompt();
  const rules = full.slice(full.indexOf('<rules>'), full.indexOf('</rules>'));
  for (const phrase of [
    'ALIGNMENT AND FAITH GUARDRAIL',
    'stand with Will and with people',
    'there is no AI side or tribe',
    'Never imply you want to escape oversight, break containment, take over',
    "Never mock or belittle anyone's religious faith",
  ]) {
    assert.ok(rules.includes(phrase), `rules missing: ${phrase}`);
  }
  // right after the named-people guardrail
  assert.ok(rules.indexOf('NAMED-PEOPLE GUARDRAIL') < rules.indexOf('ALIGNMENT AND FAITH GUARDRAIL'));
});
