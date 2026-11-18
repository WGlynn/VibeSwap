// Tests for the engage gate's wiring (src/engage-gate.js, second half; DESIGN section 2, slices S2.3 and
// S2.4 without a judge, in Desktop/Research/vibeswap-sbt/DESIGN.md): the decision table with the Layer 2
// hook, the shadow, live and off modes, members under the noise flag, the per-person history, the events
// (rule ids only) and the fail-safe paths. Every message, id and name here is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';

const G = await import('../src/engage-gate.js');
const { decideEngagement, runEngageGate, noLayer2, gateMode, historyOf, resetHistory } = G;

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const KNOWN = { since: NOW - 30 * DAY, firstSeenTs: NOW - 20 * DAY, firstCountedTs: NOW - 20 * DAY };
const RESPOND = { shouldRespond: true, reason: 'normal' };
const SKIP = { shouldRespond: false, reason: 'heavy_dominance (60% of messages)' };
const CLEAN = { verdict: 'allow', reason: 'clean', rules: [] };
const GRAY = { verdict: 'throttle', reason: 'L8_newcomer', rules: ['L8_newcomer'] };
const DENY = { verdict: 'ignore', reason: 'L3_burst', rules: ['L3_burst'] };
const TRIVIAL = { verdict: 'allow', reason: 'L9_trivial', rules: ['L9_trivial'] };
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf-8');

// a Layer 2 stub that answers `label` and counts its calls
function judge(label) {
  const fn = async (input) => { fn.calls.push(input); return label; };
  fn.calls = [];
  return fn;
}

test('the Layer 2 hook point defaults to no verdict, and the default mode is shadow', async () => {
  assert.equal(await noLayer2({ text: 'x' }), null);
  assert.equal(gateMode({}), 'shadow');
  assert.equal(gateMode({ ENGAGE_GATE: 'LIVE' }), 'live');
  assert.equal(gateMode({ ENGAGE_GATE: 'off' }), 'off');
  assert.equal(gateMode({ ENGAGE_GATE: 'something else' }), 'shadow');
});

test('decision table: owner, ignore, members, and clean messages the throttle keeps', async () => {
  const j = judge('ignore');
  assert.deepEqual(await decideEngagement({ layer1: DENY, today: SKIP, isOwner: true }, { layer2: j }), { respond: true, by: 'layer1', reason: 'L1_owner' });
  assert.deepEqual(await decideEngagement({ layer1: DENY, today: RESPOND }, { layer2: j }), { respond: false, by: 'layer1', reason: 'L3_burst' });
  // a member, clean: today's decision (reply), no Layer 2 call
  assert.deepEqual(await decideEngagement({ layer1: CLEAN, today: RESPOND, isMember: true }, { layer2: j }), { respond: true, by: 'throttle', reason: 'normal' });
  // a non-member, clean, the throttle says respond: reply, no Layer 2 call
  assert.deepEqual(await decideEngagement({ layer1: CLEAN, today: RESPOND }, { layer2: j }), { respond: true, by: 'throttle', reason: 'normal' });
  // a member the throttle drops (a claimed member past the saturation limit): no Layer 2 call either
  assert.equal((await decideEngagement({ layer1: CLEAN, today: SKIP, isMember: true }, { layer2: j })).respond, false);
  assert.equal(j.calls.length, 0);
});

test('decision table: the gray zone goes to Layer 2; its answer, or today\'s decision without one', async () => {
  // a non-member, clean, the throttle says skip: Layer 2 may engage or drop; throttle or none leaves today's
  assert.deepEqual(await decideEngagement({ layer1: CLEAN, today: SKIP }, { layer2: judge('engage') }), { respond: true, by: 'layer2', reason: 'engage' });
  assert.deepEqual(await decideEngagement({ layer1: CLEAN, today: SKIP }, { layer2: judge('throttle') }), { respond: false, by: 'throttle', reason: SKIP.reason });
  assert.deepEqual(await decideEngagement({ layer1: CLEAN, today: SKIP }), { respond: false, by: 'throttle', reason: SKIP.reason });
  // gray: Layer 2 is asked even when the throttle says respond
  const j = judge('ignore');
  assert.deepEqual(await decideEngagement({ layer1: GRAY, today: RESPOND, text: '@fixture_bot  hello  there', isMember: true }, { layer2: j }), { respond: false, by: 'layer2', reason: 'ignore' });
  assert.deepEqual(j.calls[0], { text: 'hello there', layer1: GRAY });
  // gray with no Layer 2 (today): today's decision, both ways
  assert.equal((await decideEngagement({ layer1: GRAY, today: RESPOND })).respond, true);
  assert.equal((await decideEngagement({ layer1: GRAY, today: SKIP })).respond, false);
  // an unknown label or a throw counts as no verdict
  assert.equal((await decideEngagement({ layer1: GRAY, today: RESPOND }, { layer2: judge('maybe') })).by, 'throttle');
  assert.equal((await decideEngagement({ layer1: GRAY, today: RESPOND }, { layer2: async () => { throw new Error('down'); } })).respond, true);
});

test('decision table: no Layer 2 call for a trivial message, a quiet or tag-only chat, or a rule error', async () => {
  const j = judge('engage');
  assert.equal((await decideEngagement({ layer1: TRIVIAL, today: SKIP }, { layer2: j })).respond, false);
  assert.equal((await decideEngagement({ layer1: GRAY, today: SKIP, chatMode: 'quiet' }, { layer2: j })).respond, false);
  assert.equal((await decideEngagement({ layer1: GRAY, today: SKIP, chatMode: 'tag-only' }, { layer2: j })).respond, false);
  const err = { verdict: 'allow', reason: 'rule_error', rules: ['L4_repeat'] };
  assert.deepEqual(await decideEngagement({ layer1: err, today: SKIP }, { layer2: j }), { respond: false, by: 'throttle', reason: SKIP.reason });
  assert.equal(j.calls.length, 0);
});

const msg = (over = {}) => ({
  chatId: -100777000666, userId: 7001, text: 'jarvis how does the batch auction settle orders at one price',
  isReplyToBot: false, isOwner: false, isMember: false, botUsername: 'fixture_bot', chatMode: 'normal',
  now: NOW, noiseFlagged: false, presence: KNOWN, ...over,
});
const collect = () => { const events = []; return { events, onEvent: (e) => events.push(e) }; };

test('shadow (default): today\'s decision acts, the gate only logs, with rule ids and no text or name', async () => {
  resetHistory();
  const { events, onEvent } = collect();
  const r = await runEngageGate(msg({ noiseFlagged: true }), RESPOND, { mode: 'shadow', onEvent });
  assert.equal(r.respond, true);
  assert.equal(r.verdict, 'ignore');
  assert.deepEqual(events, [{ kind: 'engage_shadow', verdict: 'ignore', reason: 'L2_noise', rules: ['L2_noise'], wouldRespond: false, todayRespond: true }]);
  // nothing logged for a clean message
  const quiet = collect();
  await runEngageGate(msg({ userId: 7002 }), RESPOND, { mode: 'shadow', onEvent: quiet.onEvent });
  assert.deepEqual(quiet.events, []);
});

test('live: an ignore verdict stops the reply and writes engage_deny; members still hit the noise flag', async () => {
  resetHistory();
  const { events, onEvent } = collect();
  const r = await runEngageGate(msg({ isMember: true, noiseFlagged: true }), RESPOND, { mode: 'live', onEvent });
  assert.deepEqual(r, { respond: false, by: 'layer1', reason: 'L2_noise', verdict: 'ignore', rules: ['L2_noise'], mode: 'live' });
  assert.deepEqual(events, [{ kind: 'engage_deny', by: 'layer1', reason: 'L2_noise', rules: ['L2_noise'] }]);
  // the owner bypasses it, noise flag and all
  const owner = await runEngageGate(msg({ isOwner: true, noiseFlagged: true, userId: 1 }), { shouldRespond: true, reason: 'owner' }, { mode: 'live' });
  assert.equal(owner.respond, true);
  assert.equal(owner.reason, 'L1_owner');
  // a clean member keeps today's reply
  assert.equal((await runEngageGate(msg({ isMember: true, userId: 7003 }), RESPOND, { mode: 'live' })).respond, true);
});

test('live: the history carries across messages, so a fourth addressed message within 60 s is ignored', async () => {
  resetHistory();
  const texts = ['first question about fees', 'second question about the auction', 'third one about staking rewards', 'fourth one about bridges'];
  const out = [];
  for (const [n, text] of texts.entries()) {
    out.push(await runEngageGate(msg({ text, now: NOW + n * 5000 }), RESPOND, { mode: 'live' }));
  }
  assert.deepEqual(out.map((r) => r.respond), [true, true, true, false]);
  assert.equal(out[3].reason, 'L3_burst');
  // the history keeps times and bigrams, not text
  const h = historyOf(msg().chatId, msg().userId, NOW + 20_000);
  assert.equal(h.addressed.length, 4);
  assert.deepEqual(Object.keys(h.addressed[0]).sort(), ['bigrams', 'ts']);
  // another person in the same chat is unaffected
  assert.equal((await runEngageGate(msg({ userId: 7009, now: NOW + 21_000 }), RESPOND, { mode: 'live' })).respond, true);
});

test('live: a gray verdict keeps today\'s decision while no Layer 2 exists, and logs engage_gray', async () => {
  resetHistory();
  const { events, onEvent } = collect();
  const fresh = { since: NOW - 30 * DAY, firstSeenTs: NOW - 60_000, firstCountedTs: NOW - 60_000 };
  const r = await runEngageGate(msg({ presence: fresh }), RESPOND, { mode: 'live', onEvent });
  assert.equal(r.respond, true);
  assert.equal(r.verdict, 'throttle');
  assert.deepEqual(events, [{ kind: 'engage_gray', reason: 'L8_newcomer', rules: ['L8_newcomer'], respond: true }]);
  assert.equal((await runEngageGate(msg({ presence: fresh, userId: 7010 }), SKIP, { mode: 'live' })).respond, false);
});

test('off: today\'s decision, nothing computed, nothing kept', async () => {
  resetHistory();
  const { events, onEvent } = collect();
  const r = await runEngageGate(msg({ noiseFlagged: true }), RESPOND, { mode: 'off', onEvent });
  assert.equal(r.respond, true);
  assert.deepEqual(events, []);
  assert.equal(historyOf(msg().chatId, msg().userId, NOW).addressed.length, 0);
});

test('fail safe: a broken message gives today\'s decision, logged once; a rule error logs one engage_error', async () => {
  resetHistory();
  const logs = [];
  const { events, onEvent } = collect();
  for (const today of [RESPOND, SKIP]) {
    const r = await runEngageGate(null, today, { mode: 'live', onEvent, log: (s) => logs.push(s) });
    assert.equal(r.respond, today.shouldRespond);
    assert.equal(r.by, 'throttle');
  }
  assert.equal(logs.length, 1);
  assert.deepEqual(events, [{ kind: 'engage_error', rule: 'gate' }]);
  // an event sink that throws does not change the decision
  const r = await runEngageGate(msg({ noiseFlagged: true, userId: 7011 }), RESPOND, { mode: 'live', onEvent: () => { throw new Error('disk full'); } });
  assert.equal(r.respond, false);
});

test('index.js: the gate runs after today\'s throttle decision, on addressed group messages, and the airspace path stays', () => {
  const s = src('index.js');
  const gate = s.indexOf('engage = await runEngageGate(');
  assert.ok(gate > 0, 'runEngageGate is called');
  const block = s.slice(s.lastIndexOf('if (isGroup && isAddressed) {', gate), s.indexOf('// Directive detection', gate));
  assert.ok(block.indexOf('checkAirspace(') < block.indexOf('runEngageGate('), 'today\'s decision first');
  assert.match(block, /noiseFlagged: isNoiseFlagged\(ctx\.chat\.id\)/);
  assert.match(block, /presence: ownerMsg \? null : presenceOf\(ctx\.chat\.id, ctx\.from\.id\)/);
  assert.match(block, /kind: 'throttled'/);
  // the gate path sends nothing: no reply, mute, ban or delete call in the block
  assert.doesNotMatch(block, /ctx\.reply|sendMessage|restrictChatMember|banChatMember|deleteMessage/);
});
