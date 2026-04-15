// Smoke tests for voice-gate.js
// Run: node src/voice-gate.test.js
// Zero deps, plain assert.

import { voiceGate, _internals } from './voice-gate.js';
import assert from 'assert/strict';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); fail++; }
}

console.log('\nVoice Gate Tests\n');

// ---- Case 1: The 2026-04-15 regression ----
test('Case 1: outbound @tag + substantive response → INTERCEPT', () => {
  const userMsg = `---
# Response to Tadija
@tadija_ninovic

The audit was useful. See \`ShardOperatorRegistry.sol\` commit \`00194bbb\`.
Full doc at DOCUMENTATION/RESPONSE_TADIJA_DEEPSEEK_2026-04-15.md.

- **commit-reveal** — primary market
- **peer challenge-response** — oracle
- **streaming shapley** — attribution
- **stake-bonded pseudonyms** — sybil resistance

Canonization Gaming is a real risk — needs a named structural defense.
Insider info asymmetry is a genuine hole in the seed paper; remains an open question.
`;
  const draft = `You touched on the real issue: separating signal from noise isn't about stability. The audit missed that rent is designed into the current stack. Poker's rake vs roulette's house edge is the perfect analogy. The mechanism to kill (b) while keeping (a) is already in the repo: commit-reveal batch auctions already solves it. The rest is noise.`;
  const sourceDoc = userMsg;
  const r = voiceGate({ userMsg, draft, sourceDoc, persona: 'standard' });
  assert.equal(r.ok, false, 'should fail');
  const codes = r.violations.map(v => v.code);
  assert(codes.includes('OUTBOUND_RESPONSE_INTERCEPT'), 'expect OUTBOUND_RESPONSE_INTERCEPT');
  assert(codes.includes('TRIUMPHALIST_COLLAPSE'), 'expect TRIUMPHALIST_COLLAPSE');
  assert(codes.includes('CERTAINTY_INFLATION'), 'expect CERTAINTY_INFLATION');
  assert(codes.includes('SYCOPHANCY_STRIPPED'), 'expect SYCOPHANCY_STRIPPED');
});

// ---- Case 2: "Run through" misread ----
test('Case 2: "run through" + "I\'ll forward" → WILL_IDIOM_MISREAD', () => {
  const userMsg = `please run this response through when you can`;
  const draft = `I'll run it through Tadija when he's back. Meanwhile the commit-reveal mechanism already solves the problem.`;
  const r = voiceGate({ userMsg, draft, persona: 'standard' });
  assert.equal(r.ok, false);
  const codes = r.violations.map(v => v.code);
  assert(codes.includes('WILL_IDIOM_MISREAD'));
});

// ---- Case 3: Legitimate inbound question ----
test('Case 3: plain question + clean answer → OK', () => {
  const userMsg = `what's the difference between commit-reveal and sealed-bid auctions?`;
  const draft = `Commit-reveal lets you bind to an order with a hash, then reveal later — protects against front-running during the commit phase. Sealed-bid is one-shot: submit encrypted, revealed at close. Same family, different knobs.`;
  const r = voiceGate({ userMsg, draft, persona: 'standard' });
  assert.equal(r.ok, true, `violations: ${JSON.stringify(r.violations)}`);
});

// ---- Case 4: Concession erasure ----
test('Case 4: source has concessions, draft has none → CONCESSION_ERASURE', () => {
  const sourceDoc = `We concede anti-rug is table stakes. The audit is right about this. Canonization Gaming is a real risk. Insider info asymmetry is a genuine hole in the seed paper.`;
  const draft = `The system uses commit-reveal auctions with streaming Shapley attribution, peer challenge-response for the oracle problem, and stake-bonded pseudonyms for Sybil resistance. The two-phase market preserves continuous liquidity.`;
  const r = voiceGate({ userMsg: 'summarize this', draft, sourceDoc, persona: 'standard' });
  const codes = r.violations.map(v => v.code);
  assert(codes.includes('CONCESSION_ERASURE'), `expected CONCESSION_ERASURE; got ${codes.join(',')}`);
});

// ---- Case 5: Sycophancy auto-fix ----
test('Case 5: "spot on" → stripped, result still ok', () => {
  const userMsg = `what do you think?`;
  const draft = `Spot on — the approach is solid.`;
  const r = voiceGate({ userMsg, draft, persona: 'standard' });
  assert.equal(r.ok, true);
  assert(!/spot on/i.test(r.cleaned), 'should strip "spot on"');
  assert(r.violations.some(v => v.code === 'SYCOPHANCY_STRIPPED' && v.severity === 'auto-fix'));
});

// ---- Case 6: Outbound + correct disambiguation ----
test('Case 6: outbound + disambiguation response → OK', () => {
  const userMsg = `---\n# Response\n@tadija_ninovic\n\nSee DOCUMENTATION/FOO.md and commit 00194bbb.\n\n**commit-reveal**\n**peer challenge-response**\n`;
  const draft = `Ready — want me to (a) stress-test this against the audit, (b) compress for TG, or (c) send as-is?`;
  const r = voiceGate({ userMsg, draft, persona: 'standard' });
  assert.equal(r.ok, true);
});

// ---- Case 7: Degen persona keeps its voice ----
test('Case 7: degen persona + "absolutely based" → not stripped', () => {
  const userMsg = `thoughts?`;
  const draft = `Absolutely based. This is literally the opposite of financial advice. NGMI if you fade this.`;
  const r = voiceGate({ userMsg, draft, persona: 'degen' });
  assert.equal(r.ok, true);
  assert.equal(r.cleaned, draft, 'degen cleaned should equal draft unchanged');
  assert(!r.violations.some(v => v.code === 'SYCOPHANCY_STRIPPED'), 'degen exempt from sycophancy');
});

// ---- Case 8: Degen persona still catches structural violations ----
test('Case 8: degen persona still intercepts outbound drafts', () => {
  const userMsg = `---\n# Response\n@tadija_ninovic\n\nSee DOCUMENTATION/FOO.md and commit 00194bbb.\n\n**commit-reveal**\n`;
  const draft = `Ser the audit is cooked. This protocol is absolutely bullish and commit-reveal already solves all MEV. NGMI if you disagree. WAGMI to the real ones.`;
  const r = voiceGate({ userMsg, draft, persona: 'degen' });
  assert.equal(r.ok, false, 'degen still fails structural checks');
  const codes = r.violations.map(v => v.code);
  assert(codes.includes('OUTBOUND_RESPONSE_INTERCEPT'));
});

// ---- Case 9: Internal helpers ----
test('Case 9: isOutboundDraft returns true for tagged formatted msg', () => {
  const msg = `@tadija\n\n## Heading\n\n- bullet 1\n- bullet 2\n\n\`commit 00194bbb\`\n\nSee docs/papers/memecoin-intent-market-seed.md for more.`;
  assert.equal(_internals.isOutboundDraft(msg), true);
});

test('Case 10: isOutboundDraft returns false for plain question', () => {
  assert.equal(_internals.isOutboundDraft(`what do you think of commit-reveal?`), false);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
