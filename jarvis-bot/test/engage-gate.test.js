// Tests for Layer 1 of the engage gate (src/engage-gate.js; DESIGN section 2, slice S2.1, in
// Desktop/Research/vibeswap-sbt/DESIGN.md): each rule fires on its fixture and not on a near miss, the
// owner bypasses everything, and a rule that throws falls back to today's behavior. Every message, id and
// name here is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const G = await import('../src/engage-gate.js');
const { evaluateLayer1, historyEntry, countLinks, countMentions, isTrivial, REASONS, VERDICTS } = G;

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;
const BOT = 'fixture_bot';
const OLD_CHAT = { since: NOW - 30 * DAY, firstSeenTs: NOW - 20 * DAY, firstCountedTs: NOW - 20 * DAY };
const Q = 'jarvis how does the batch auction settle orders at one price';

const run = (over = {}) => evaluateLayer1({ now: NOW, text: Q, botUsername: BOT, presence: OLD_CHAT, ...over }, { log: () => {} });
const addressed = (...agesMs) => agesMs.map((age, n) => historyEntry(NOW - age, `fixture question number ${n} about something else entirely`));

test('a plain question from a known person is clean', () => {
  assert.deepEqual(run(), { verdict: 'allow', reason: 'clean', rules: [] });
  assert.ok(VERDICTS.includes(run().verdict));
});

test('L1 the owner bypasses every rule', () => {
  const r = run({
    isOwner: true, noiseFlagged: true, text: 'a https://x.example b https://y.example c https://z.example',
    history: { addressed: addressed(1 * SEC, 2 * SEC, 3 * SEC, 4 * SEC), repliesToBot: [] },
    presence: { since: NOW - 30 * DAY, firstSeenTs: NOW - MIN, firstCountedTs: null },
  });
  assert.deepEqual(r, { verdict: 'allow', reason: 'L1_owner', rules: ['L1_owner'] });
});

test('L2 the noise flag ignores, even a trivial greeting; off, nothing fires', () => {
  assert.deepEqual(run({ noiseFlagged: true }), { verdict: 'ignore', reason: 'L2_noise', rules: ['L2_noise'] });
  assert.equal(run({ noiseFlagged: true, text: 'hi jarvis' }).reason, 'L2_noise');
  assert.equal(run({ noiseFlagged: false }).reason, 'clean');
});

test('L3 a fourth addressed message within 60 s is ignored; a third, or an older fourth, is not', () => {
  const burst = run({ history: { addressed: addressed(50 * SEC, 30 * SEC, 10 * SEC) } });
  assert.equal(burst.verdict, 'ignore');
  assert.equal(burst.reason, 'L3_burst');
  assert.equal(run({ history: { addressed: addressed(30 * SEC, 10 * SEC) } }).reason, 'clean');
  assert.equal(run({ history: { addressed: addressed(61 * SEC, 30 * SEC, 10 * SEC) } }).reason, 'clean');
});

test('L4 a near copy of an addressed message this hour is ignored; a different one, an old one or a short one is not', () => {
  const prior = (text, age = 10 * MIN) => ({ addressed: [historyEntry(NOW - age, text)] });
  const r = run({ history: prior(`@${BOT} ${Q}?`) });
  assert.equal(r.verdict, 'ignore');
  assert.equal(r.reason, 'L4_repeat');
  // shares words, different question: under 0.8
  assert.equal(run({ history: prior('jarvis how does the reveal phase hide orders from solvers') }).reason, 'clean');
  // the same text, but over an hour ago
  assert.equal(run({ history: prior(Q, HOUR + MIN) }).reason, 'clean');
  // two short identical messages (under 3 bigrams) are left to antispam and the throttle
  assert.equal(run({ text: 'jarvis thanks', history: prior('jarvis thanks') }).reason !== 'L4_repeat', true);
  // only the last 10 in the hour are compared
  const eleven = [historyEntry(NOW - 50 * MIN, Q), ...addressed(...Array.from({ length: 10 }, (_, n) => (40 - n) * MIN))];
  assert.equal(run({ history: { addressed: eleven } }).reason, 'clean');
});

test('L5 three links or four other @mentions are ignored; two links or three mentions are not', () => {
  assert.equal(run({ text: 'see https://a.example and https://b.example and www.c.example' }).reason, 'L5_links_mentions');
  assert.equal(run({ text: 'see https://a.example and https://b.example' }).reason, 'clean');
  assert.equal(run({ text: `@${BOT} ping @aaa_x @bbb_x @ccc_x @ddd_x` }).reason, 'L5_links_mentions');
  assert.equal(run({ text: `@${BOT} ping @aaa_x @bbb_x @ccc_x` }).reason, 'clean');
  // hidden links count through Telegram's entities
  const entities = [{ type: 'text_link' }, { type: 'text_link' }, { type: 'url' }];
  assert.equal(run({ text: 'three hidden links in here', entities }).reason, 'L5_links_mentions');
  assert.equal(countLinks('mail me at x@y.example'), 0);
  assert.equal(countMentions('mail me at someone@mail.example', BOT), 0);
});

test('L6 a link from someone whose first counted post is under 24 h old is ignored', () => {
  const newbie = { since: NOW - 30 * DAY, firstSeenTs: NOW - 2 * HOUR, firstCountedTs: NOW - 2 * HOUR };
  const link = 'jarvis is https://site.example legit';
  assert.equal(run({ text: link, presence: newbie }).reason, 'L6_new_linking');
  // no counted post at all (only junk so far): still new
  assert.equal(run({ text: link, presence: { ...newbie, firstCountedTs: null } }).reason, 'L6_new_linking');
  // near misses: first counted post 25 h ago; no link; logs too short to tell; presence unknown
  assert.equal(run({ text: link, presence: { ...newbie, firstCountedTs: NOW - 25 * HOUR } }).reason, 'clean');
  assert.equal(run({ presence: newbie }).reason, 'clean');
  assert.equal(run({ text: link, presence: { ...newbie, since: NOW - 23 * HOUR } }).reason, 'clean');
  assert.equal(run({ text: link, presence: null }).reason, 'clean');
});

test('L7 a seventh reply to the bot within 15 min is gray; a sixth, or a non-reply, is not', () => {
  const six = Array.from({ length: 6 }, (_, n) => NOW - (n + 1) * MIN);
  const r = run({ isReplyToBot: true, history: { repliesToBot: six } });
  assert.deepEqual(r, { verdict: 'throttle', reason: 'L7_reply_chain', rules: ['L7_reply_chain'] });
  assert.equal(run({ isReplyToBot: true, history: { repliesToBot: six.slice(1) } }).reason, 'clean');
  assert.equal(run({ isReplyToBot: false, history: { repliesToBot: six } }).reason, 'clean');
  assert.equal(run({ isReplyToBot: true, history: { repliesToBot: [...six.slice(1), NOW - 16 * MIN] } }).reason, 'clean');
});

test('L8 a first message under 10 min ago is gray; 11 min ago, or in a chat logged for under 10 min, is not', () => {
  const fresh = { since: NOW - 30 * DAY, firstSeenTs: NOW - 5 * MIN, firstCountedTs: NOW - 5 * MIN };
  assert.equal(run({ presence: fresh }).verdict, 'throttle');
  assert.equal(run({ presence: fresh }).reason, 'L8_newcomer');
  assert.equal(run({ presence: { ...fresh, firstSeenTs: NOW - 11 * MIN } }).reason, 'clean');
  assert.equal(run({ presence: { ...fresh, since: NOW - 5 * MIN } }).reason, 'clean');
});

test('L9 a greeting or a bare invocation is trivial; a real question is not', () => {
  for (const t of ['hi jarvis', `@${BOT}`, 'jarvis', 'thanks jarvis', 'gm', 'you there?']) {
    assert.equal(isTrivial(t, BOT), true, t);
    assert.deepEqual(run({ text: t }), { verdict: 'allow', reason: 'L9_trivial', rules: ['L9_trivial'] }, t);
  }
  assert.equal(isTrivial('hi jarvis, my swap failed, what happened', BOT), false);
  // a trivial message from a newcomer needs no judgment: allowed, with the gray rule still listed
  const fresh = { since: NOW - 30 * DAY, firstSeenTs: NOW - MIN, firstCountedTs: null };
  assert.deepEqual(run({ text: 'hello', presence: fresh }), { verdict: 'allow', reason: 'L9_trivial', rules: ['L8_newcomer', 'L9_trivial'] });
});

test('the first deny is the reason and every fired rule is listed', () => {
  const r = run({ noiseFlagged: true, text: 'a https://a.example b https://b.example c https://c.example', history: { addressed: addressed(5 * SEC, 4 * SEC, 3 * SEC) } });
  assert.equal(r.verdict, 'ignore');
  assert.equal(r.reason, 'L2_noise');
  assert.deepEqual(r.rules, ['L2_noise', 'L3_burst', 'L5_links_mentions']);
  for (const x of [r, run(), run({ isOwner: true })]) assert.ok(REASONS.includes(x.reason));
});

test('a rule that throws falls back to today\'s behavior (allow, rule_error) and is logged once', () => {
  const logs = [];
  const broken = { now: NOW, text: Q, history: { addressed: [{ ts: NOW - 10 * MIN, bigrams: null }] } };
  const r1 = evaluateLayer1(broken, { log: (s) => logs.push(s) });
  const r2 = evaluateLayer1(broken, { log: (s) => logs.push(s) });
  assert.deepEqual(r1, { verdict: 'allow', reason: 'rule_error', rules: ['L4_repeat'] });
  assert.deepEqual(r2, r1);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /L4_repeat/);
  // no input at all is a clean, empty message, not a throw
  assert.equal(evaluateLayer1(undefined, { log: () => {} }).verdict, 'allow');
});

test('the gate module sends nothing: it imports no Telegram, network or moderation code', async () => {
  const { readFileSync } = await import('fs');
  const src = readFileSync(new URL('../src/engage-gate.js', import.meta.url), 'utf-8');
  const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./message-collision.js', './quick-reply.js']);
});
