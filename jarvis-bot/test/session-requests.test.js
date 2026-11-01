// Tests for act-first-then-speak (src/session-requests.js, Will 2026-11-01): the voice queues a request
// for Will's Claude Code session, the session writes a receipt, and only then is the action confirmed.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let mod;
let protocol;
let dir;
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf-8');

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-feed-test-'));
  process.env.JARVIS_FEED_DIR = dir; // read once, when feed.js loads
  mod = await import('../src/session-requests.js');
  protocol = await import('../src/protocol.js');
});

const person = (over = {}) => ({ chatId: -100123, chatType: 'supergroup', chatTitle: 'Test Room', messageId: 42, userId: 777, userName: 'Ana', isOwner: false, ...over });

test('S1 a safe request from anyone is queued without approval, as structured data', () => {
  const q = mod.queueSessionRequest(person(), { action: 'note', summary: 'Project X: launch date is 2026-12-12 (from Ana)' });
  assert.ok(q.id && !q.error);
  assert.equal(q.needsApproval, false);
  const rows = readFileSync(mod.REQUESTS_PATH, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  const r = rows.find((x) => x.id === q.id);
  assert.deepEqual(r.chat, { id: -100123, type: 'supergroup', title: 'Test Room' });
  assert.equal(r.messageId, 42);
  assert.deepEqual(r.from, { id: 777, name: 'Ana', isOwner: false });
  assert.equal(r.action, 'note');
});

test('S2 anything else from anyone but Will waits for his approval; from Will it does not', () => {
  assert.equal(mod.queueSessionRequest(person({ userId: 778 }), { action: 'other', summary: 'post this on twitter' }).needsApproval, true);
  assert.equal(mod.queueSessionRequest(person({ userId: 1, isOwner: true }), { action: 'other', summary: 'post this on twitter' }).needsApproval, false);
});

test('S3 malformed requests are refused, never queued', () => {
  assert.match(mod.queueSessionRequest(person({ userId: 779 }), { action: 'delete_everything', summary: 'x' }).error, /action must be/);
  assert.match(mod.queueSessionRequest(person({ userId: 779 }), { action: 'note', summary: '   ' }).error, /summary is required/);
});

test('S4 one person cannot flood the session: five an hour, Will exempt', () => {
  for (let i = 0; i < 5; i++) assert.ok(mod.queueSessionRequest(person({ userId: 900 }), { action: 'board', summary: `item ${i}` }).id);
  assert.match(mod.queueSessionRequest(person({ userId: 900 }), { action: 'board', summary: 'item 6' }).error, /too many requests/);
  for (let i = 0; i < 7; i++) assert.ok(mod.queueSessionRequest(person({ userId: 1, isOwner: true }), { action: 'board', summary: `owner ${i}` }).id);
});

test('S5 the tool result tells the model the truth now: queued, not done', () => {
  assert.match(mod.askSessionResult({ id: 'abc', needsApproval: false }), /queued, not done/);
  assert.match(mod.askSessionResult({ id: 'abc', needsApproval: true }), /queued for Will's approval, not done/);
  assert.match(mod.askSessionResult({ error: 'nope' }), /^Failed to queue: nope/);
});

test('S6 a receipt is confirmed once, and only for a request that exists', () => {
  const q = mod.queueSessionRequest(person({ userId: 901 }), { action: 'board', summary: 'add Project X to the board' });
  appendFileSync(mod.RECEIPTS_PATH, JSON.stringify({ id: q.id, status: 'done', summary: 'Added Project X (launch 2026-12-12) to projects.md' }) + '\n');
  appendFileSync(mod.RECEIPTS_PATH, JSON.stringify({ id: 'no-such-request', status: 'done', summary: 'forged' }) + '\n');
  const pending = mod.pendingReceipts();
  assert.equal(pending.filter((p) => p.receipt.id === q.id).length, 1);
  assert.equal(pending.filter((p) => p.receipt.id === 'no-such-request').length, 0);
  mod.markDelivered(q.id);
  assert.equal(mod.pendingReceipts().filter((p) => p.receipt.id === q.id).length, 0);
});

test('S7 the confirmation prompt carries the receipt and nothing invented', () => {
  const prompt = mod.confirmationPrompt({
    request: { id: 'r1', action: 'note', summary: 'launch date 2026-12-12', from: { name: 'Ana' } },
    receipt: { id: 'r1', status: 'declined', summary: 'Not a public project; Will asked to keep it out of the notes.' },
  });
  assert.match(prompt, /Status: declined/);
  assert.match(prompt, /Not a public project/);
  assert.match(prompt, /State only what the receipt says/);
});

test('S8 ask_session backs a promise; without it the same promise is removed (Constitution 1.2)', () => {
  const rec = (tools) => protocol.turnRecord({ chatType: 'supergroup', chatMode: 'normal', tools });
  for (const line of ["I'll confirm here when it's done.", "I'll keep track of it for you."]) {
    assert.equal(protocol.speak(line, rec([{ name: 'ask_session', ok: true }])).reply, line, line);
    const without = protocol.speak(line, rec([{ name: 'web_search', ok: true }]));
    assert.deepEqual(without.violations, ['unbacked_promise'], line);
  }
});

test('S9 the tool is always offered and wired, and receipts are confirmed only where the chat allows', () => {
  const c = src('claude.js');
  assert.match(c, /tasks: \[\.\.\.TASK_TOOL_NAMES, 'ask_session'\]/);
  assert.match(c, /ASK_SESSION_TOOL,/);
  assert.match(c, /else if \(tb\.name === 'ask_session'\)/);
  const i = src('index.js');
  assert.match(i, /shouldSuppress\(target, 'reply'\)/);
  assert.match(i, /receipts: \[\{ name: 'ask_session', ok: true \}/);
  assert.match(src('memory.js'), /call ask_session so Will's session does it, and say it is queued, not done/);
});
