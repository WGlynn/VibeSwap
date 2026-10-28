// ============ chat-learning: intent/humor tags, outcome attribution, evidence-gated guidance ============
// Synthetic strings only (the repo is public and the real feed holds private chats). DATA_DIR
// and JARVIS_FEED_DIR point at temp dirs before any module loads, so nothing touches real data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';

const ROOT = join(tmpdir(), `jarvis-chat-learning-test-${process.pid}`);
rmSync(ROOT, { recursive: true, force: true });
process.env.DATA_DIR = join(ROOT, 'data');
process.env.JARVIS_FEED_DIR = join(ROOT, 'feed');
process.env.LLM_CALL_LOG = join(ROOT, 'llm-calls.jsonl');
delete process.env.JARVIS_CHAT_GUIDANCE_OFF;

const ci = await import('../src/chat-intent.js');
const { classifySignal } = await import('../src/reward-signal.js');
const cl = await import('../src/chat-learning.js');

const BOT = 999;
const T0 = Date.now();
let msgId = 1;
const ctxOf = (chat, user, text, { type = 'supergroup', replyTo = null } = {}) => ({
  chat: { id: chat, type },
  from: { id: user, is_bot: false },
  botInfo: { id: BOT },
  message: { message_id: msgId++, text, reply_to_message: replyTo ? { from: { id: BOT }, text: replyTo } : undefined },
});
let dirN = 0;
async function freshDir() {
  const d = join(ROOT, `d${dirN++}`);
  await cl.initChatLearning(d);
  return join(d, 'chat-learning', 'events.jsonl');
}
const readRows = (p) => (existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// ============ Tagger ============

test('tagIntent abstains on bare invocations, phatic openers, weak cues and ties', () => {
  assert.equal(ci.tagIntent('@somebot', true).why, 'bare_invocation');
  assert.equal(ci.tagIntent('jarvis', false).why, 'bare_invocation');
  assert.equal(ci.tagIntent('gm jarvis', true).why, 'phatic');
  assert.equal(ci.tagIntent('are you up', false).why, 'phatic');
  assert.equal(ci.tagIntent('Some neutral sentence about a thing', false).why, 'weak');
  const tie = ci.tagIntent('lol the dashboard is broken again and nobody has noticed it for a whole week', false);
  assert.equal(tie.intent, null);
  assert.equal(tie.why, 'conflict');
});

test('tagIntent tags clear banter, critique and mechanism', () => {
  assert.equal(ci.tagIntent('lmaooo', false).intent, 'banter');
  assert.equal(ci.tagIntent("that's incorrect", false).intent, 'critique');
  assert.equal(ci.tagIntent('how does finality work under a sybil attack', false).intent, 'mechanism');
});

test('tagHumor is tri-state: joking, straight, unsure', () => {
  assert.equal(ci.tagHumor('ha, the chart agrees with you for once', 'banter').humor, true);
  assert.equal(ci.tagHumor('back online, what are we working on?', null).humor, false);
  assert.equal(ci.tagHumor('x'.repeat(400), 'banter').humor, false);
  assert.equal(ci.tagHumor('Finality needs two thirds of stake and contribution.', 'mechanism').humor, false);
  assert.equal(ci.tagHumor('ok', 'banter').humor, null);
  assert.equal(ci.tagHumor('Some neutral sentence here.', null).humor, null);
});

// ============ Outcome classifier ============

test('classifySignal: substring false positives are gone, laugh and already-said are new', () => {
  assert.notEqual(classifySignal('based on the data it looks flat').type, 'thanks');
  assert.notEqual(classifySignal('the service was down').type, 'thanks');
  assert.notEqual(classifySignal('he got fired from the desk').type, 'thanks');
  assert.equal(classifySignal('you already said that').type, 'correction');
  assert.equal(classifySignal('lmaooo').type, 'laugh');
  assert.equal(classifySignal('lmao bruh').type, 'laugh', 'laughing slang is not frustration');
  assert.equal(classifySignal('based').type, 'thanks');
});

test('classifySignal: pushback wins over a laugh attached to it', () => {
  assert.equal(classifySignal("lol no, that's wrong").type, 'correction');
  assert.equal(classifySignal('you already said that lmao').type, 'correction');
  assert.equal(classifySignal('lmao this is useless slop').type, 'frustration');
  assert.notEqual(classifySignal('not funny').type, 'laugh');
  assert.equal(classifySignal('bruh').type, 'frustration');
  assert.notEqual(classifySignal('bruh', null, { banter: true }).type, 'frustration', 'bruh after banter is banter');
});

// ============ Attribution ============

test('a reply-to match closes the matching older pending, not the newest', async () => {
  const ev = await freshDir();
  cl.noteExchange(ctxOf(-1, 1, 'lmaooo'), 'lmaooo', 'First reply   alpha, the chart wins.', {}, T0);
  cl.noteExchange(ctxOf(-1, 2, 'lol ok'), 'lol ok', 'Second reply beta.', {}, T0 + 1000);
  cl.noteInbound(ctxOf(-1, 3, 'lmao', { replyTo: 'first reply alpha, the chart wins.' }), T0 + 2000);
  const rows = readRows(ev);
  assert.equal(rows.length, 1, 'one inbound closes at most one pending');
  assert.equal(rows[0].user, 1);
  assert.equal(rows[0].by, 'reply');
  assert.equal(rows[0].sig, 'laugh');
  assert.equal(rows[0].outcome, 'pos');
  const raw = readFileSync(ev, 'utf8');
  assert.ok(!/alpha|lmao|chart/.test(raw), 'no message text is persisted');
  // The other pending closes as silence once it is 10+ minutes old
  cl.sweep(T0 + 11 * 60_000);
  const after = readRows(ev);
  assert.equal(after.length, 2);
  assert.equal(after[1].user, 2);
  assert.equal(after[1].sig, 'silence');
  assert.equal(after[1].by, 'timeout');
  assert.equal(after[1].outcome, 'sil');
});

test('same-user fallback closes only the newest pending and respects the 10 minute window', async () => {
  const ev = await freshDir();
  cl.noteExchange(ctxOf(-2, 1, 'lmaooo'), 'lmaooo', 'Reply one.', {}, T0);
  cl.noteExchange(ctxOf(-2, 1, 'lol ok'), 'lol ok', 'Reply two.', {}, T0 + 1000);
  cl.noteInbound(ctxOf(-2, 1, 'thanks'), T0 + 2000);
  let rows = readRows(ev);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].by, 'same_user');
  assert.equal(rows[0].sig, 'thanks');
  // Remaining pending is from T0; a same-user message 11 minutes later is not attributed
  cl.noteInbound(ctxOf(-2, 1, 'thanks'), T0 + 11 * 60_000);
  rows = readRows(ev);
  assert.equal(rows.length, 1, 'outside the same-user window nothing closes');
  // Another user, no reply-to: unattributable, abstain
  cl.noteInbound(ctxOf(-2, 7, 'thanks'), T0 + 3000);
  assert.equal(readRows(ev).length, 1);
});

test('reply-to a bot message with no matching pending abstains rather than guessing', async () => {
  const ev = await freshDir();
  cl.noteExchange(ctxOf(-3, 1, 'lmaooo'), 'lmaooo', 'Fresh reply.', {}, T0);
  // Same user as the open pending: the reply-to points elsewhere, so the fallback must not fire
  cl.noteInbound(ctxOf(-3, 1, "that's wrong", { replyTo: 'some old message from yesterday' }), T0 + 1000);
  assert.equal(readRows(ev).length, 0);
});

test('a same-user answer at 6 minutes is attributed, not left to close as silence', async () => {
  const ev = await freshDir();
  cl.noteExchange(ctxOf(-4, 1, 'lmaooo', { type: 'private' }), 'lmaooo', 'Reply.', {}, T0);
  cl.noteInbound(ctxOf(-4, 1, 'lmao', { type: 'private' }), T0 + 6 * 60_000);
  assert.equal(readRows(ev)[0]?.by, 'same_user');
});

test('banter: a repeated laugh is a laugh, not a re-ask', async () => {
  const ev = await freshDir();
  cl.noteExchange(ctxOf(-5, 1, 'lol'), 'lol', 'ha, the chart agrees with you for once', {}, T0);
  cl.noteInbound(ctxOf(-5, 1, 'lol'), T0 + 1000);
  const [row] = readRows(ev);
  assert.equal(row.intent, 'banter');
  assert.equal(row.sig, 'laugh');
  assert.equal(row.outcome, 'pos');
});

test('reply-to matches a reply that opened with a dash, as Telegram stores it', async () => {
  const ev = await freshDir();
  cl.noteExchange(ctxOf(-6, 1, 'lmaooo'), 'lmaooo', 'Ha — that is the whole bit', {}, T0);
  cl.noteInbound(ctxOf(-6, 2, 'lmao', { replyTo: 'Ha, that is the whole bit' }), T0 + 1000);
  assert.equal(readRows(ev)[0]?.by, 'reply');
});

test('boot compacts events.jsonl once most rows have aged out of the window', async () => {
  const d = join(ROOT, 'compact');
  const file = join(d, 'chat-learning', 'events.jsonl');
  mkdirSync(join(d, 'chat-learning'), { recursive: true });
  const old = new Date(T0 - 40 * 86_400_000).toISOString(), fresh = new Date(T0 - 60_000).toISOString();
  const rows = [old, old, old, fresh].map((ts) => JSON.stringify({ ts, chat: '7', intent: 'banter', humor: true, sig: 'laugh', outcome: 'pos' }));
  writeFileSync(file, rows.join('\n') + '\n');
  await cl.initChatLearning(d);
  assert.equal(readRows(file).length, 1);
});

// ============ Guidance ============

// Build cells straight from synthetic events (aggregate is what the bot runs).
function events({ intent, humor, pos = 0, neg = 0, neu = 0, users = 10, tainted = 0 }) {
  const out = [];
  const push = (sig, outcome) => out.push({ intent, humor, sig, outcome, user: out.length % users, flags: [] });
  for (let i = 0; i < pos; i++) push('laugh', 'pos');
  for (let i = 0; i < neg; i++) push('correction', 'neg');
  for (let i = 0; i < neu; i++) push('continue', 'neu');
  for (let i = 0; i < tainted; i++) out[i].flags = ['hype_man'];
  return out;
}
const linesFor = (evs, type = 'supergroup') => ci.guidanceFor(ci.aggregate(evs), type);

test('guidance stays empty below n_min=20 and gives the exact template at threshold', () => {
  assert.deepEqual(linesFor(events({ intent: 'banter', humor: true, pos: 19 })), []);
  assert.deepEqual(linesFor(events({ intent: 'banter', humor: true, pos: 9, neu: 11 })), [
    '- Banter here: 9 of 20 short replies to banter drew a laugh, thanks or a follow-up; 0 drew a correction. The wit lands, keep it.',
  ]);
  // Critique merges over humor and never reads positives
  assert.deepEqual(linesFor([...events({ intent: 'critique', humor: null, neg: 5, pos: 5 }), ...events({ intent: 'critique', humor: false, neg: 4, neu: 6 })]), [
    '- Pushback here: 9 of 20 replies to a correction were pushed back on again. Re-check the claim: fix it if wrong, hold it with the reason if right.',
  ]);
  assert.deepEqual(linesFor(events({ intent: 'critique', humor: null, pos: 20 })), [], 'agreement after pushback is never credited');
});

test('tainted replies earn no positive credit, and one dominant user blocks a group line', () => {
  assert.deepEqual(linesFor(events({ intent: 'banter', humor: true, pos: 9, neu: 11, tainted: 1 })), []);
  // 16 of 20 rows from one user (80% > 75%): blocked in a group, allowed in a DM
  const conc = events({ intent: 'banter', humor: true, pos: 12, neu: 8, users: 1 }).map((e, i) => ({ ...e, user: i < 16 ? 1 : i }));
  assert.deepEqual(linesFor(conc, 'supergroup'), []);
  assert.equal(linesFor(conc, 'private').length, 1);
});

test('live path: the 20th closed exchange turns guidance on, logs it to health, kill switch hides it', async () => {
  const d = join(ROOT, 'live');
  mkdirSync(join(d, 'chat-learning'), { recursive: true });
  const seed = events({ intent: 'banter', humor: true, pos: 9, neu: 10 })
    .map((e) => JSON.stringify({ ts: new Date(T0 - 60_000).toISOString(), chat: '42', type: 'private', ...e, by: 'same_user' }));
  writeFileSync(join(d, 'chat-learning', 'events.jsonl'), seed.join('\n') + '\n');
  await cl.initChatLearning(d);
  assert.equal(cl.chatGuidance(42), '', 'n=19 at boot gives nothing');
  cl.noteExchange(ctxOf(42, 1, 'lmaooo', { type: 'private' }), 'lmaooo', 'ha, fair point, the chart wins this round.', {}, T0);
  cl.noteInbound(ctxOf(42, 1, 'lol', { type: 'private' }), T0 + 1000);
  const block = cl.chatGuidance(42);
  assert.match(block, /## WHAT HAS LANDED IN THIS CHAT/);
  assert.match(block, /10 of 20 short replies to banter/);
  const health = readRows(join(process.env.JARVIS_FEED_DIR, 'health.jsonl')).filter((h) => h.kind === 'chat_guidance');
  assert.equal(health.length, 1);
  assert.equal(health[0].chat, '42');
  assert.equal(health[0].lines.length, 1);
  process.env.JARVIS_CHAT_GUIDANCE_OFF = '1';
  try { assert.equal(cl.chatGuidance(42), ''); } finally { delete process.env.JARVIS_CHAT_GUIDANCE_OFF; }
  assert.equal(cl.chatGuidance(42), block);
});

test('invariant fuzz: no line can say joke less, drop the wit, or agree; every line carries numbers', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const KEYS = ['banter|true', 'banter|false', 'banter|null', 'mechanism|true', 'mechanism|false', 'critique|true', 'critique|false', 'critique|null'];
  const FLATTEN = /\b(stop|no|less|avoid|drop|fewer|cut)\b.{0,20}\b(jok\w*|humou?r|wit|banter|personality)\b/i;
  let fired = 0;
  for (let i = 0; i < 500; i++) {
    const cells = new Map();
    for (const k of KEYS) {
      if (rnd(2)) continue;
      const n = rnd(60);
      const pos = rnd(n + 1), neg = rnd(n - pos + 1), sil = rnd(n - pos - neg + 1);
      const users = {};
      for (let j = 0; j < n; j++) { const u = rnd(1 + rnd(5)); users[u] = (users[u] || 0) + 1; }
      cells.set(k, { n, pos, neg, sil, neu: n - pos - neg - sil, tainted: 0, users });
    }
    const lines = ci.guidanceFor(cells, rnd(2) ? 'private' : 'supergroup');
    assert.ok(lines.length <= ci.MAX_LINES);
    fired += lines.length;
    for (const l of lines) {
      assert.match(l, /\d/);
      assert.doesNotMatch(l, FLATTEN);
      assert.doesNotMatch(l, /\bagree\b/i);
    }
    assert.doesNotMatch(ci.formatGuidance(lines), FLATTEN);
  }
  assert.ok(fired > 0, 'the fuzz actually exercised some templates');
});
