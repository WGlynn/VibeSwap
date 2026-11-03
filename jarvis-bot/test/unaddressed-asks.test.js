// Tests for the 2026-11-03 incident. In a group, Will replied to his own message with "Save this to memory
// as a logical primitive. It will save you a few operational IQ points in the future". It did not name the
// bot, so nothing was queued for his Claude Code session; the proactive path answered anyway, from the
// same system prompt, without the protocol check: "noted." went out for a save nobody did, with the
// closing <protocol> line showing. Act first, then speak, holds on every path the bot speaks on.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let requests;
let protocol;
let style;
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf-8');

before(async () => {
  process.env.JARVIS_FEED_DIR = mkdtempSync(join(tmpdir(), 'jarvis-feed-test-')); // read once, when feed.js loads
  requests = await import('../src/session-requests.js');
  protocol = await import('../src/protocol.js');
  style = await import('../src/text-style.js');
});

const LIVE = 'noted. apparent paradoxes are just the same invariant viewed from different layers of the execution stack.\n<protocol>actions: none | sources: conversation</protocol>';

test('U1 the live proactive reply loses its protocol line and its unbacked "noted."', () => {
  const out = protocol.speak(LIVE, protocol.turnRecord({ chatId: -5590478415, chatType: 'group' }));
  assert.doesNotMatch(out.reply, /protocol|actions:/i);
  assert.doesNotMatch(out.reply, /^noted\b/i);
  assert.match(out.reply, /apparent paradoxes are just the same invariant/);
  assert.ok(out.violations.includes('unbacked_action'));
});

test('U2 every proactive reply passes the protocol check before it is returned', () => {
  const intel = src('intelligence.js');
  assert.match(intel, /export async function generateProactiveResponse\(text, userName, responseHint, systemPrompt, recentContext, opts = \{\}\) \{\r?\n  const raw = await draftProactiveResponse\(/);
  assert.match(intel, /const spoken = speak\(raw, opts\.record \|\| turnRecord\(\{ chatType: 'group' \}\)\);/);
  // All three callers pass the turn's record (chat id, type and mode).
  const idx = src('index.js');
  assert.equal((idx.match(/generateProactiveResponse\(/g) || []).length, 3);
  assert.equal((idx.match(/record: proactiveRecord/g) || []).length, 3);
});

test('U3 nothing protocol-shaped reaches Telegram, whatever path sent it', () => {
  class FakeTelegram { callApi(method, payload) { return payload; } }
  style.installDashFilter(FakeTelegram);
  const t = new FakeTelegram();
  const send = (payload) => t.callApi('sendMessage', payload);
  assert.equal(send({ text: LIVE }).text, 'noted. apparent paradoxes are just the same invariant viewed from different layers of the execution stack.');
  assert.equal(send({ text: 'unterminated\n<protocol>actions: saved it (learn_fact)' }).text, 'unterminated');
  assert.equal(send({ caption: 'a picture\nprotocol: actions: none | sources: web' }).caption, 'a picture');
  // Text with nothing protocol-shaped is untouched, spacing included; the dash filter still runs.
  assert.equal(send({ text: '  keep my spacing  ' }).text, '  keep my spacing  ');
  assert.equal(send({ text: 'one thing — then another' }).text, 'one thing, then another');
});

test('U4 a request carries the message it replied to, so the session can act on "save this"', () => {
  const message = {
    message_id: 35857,
    text: 'Save this to memory as a logical primitive. It will save you a few operational IQ points in the future',
    reply_to_message: { message_id: 35854, from: { username: 'Willwillwillwillwill' }, text: 'This is because context matters, especially in the Bible.' },
  };
  assert.deepEqual(requests.detectActionRequest(message.text), { action: 'note' });
  const q = requests.queueFromMessage({
    chat: { id: -5590478415, type: 'group', title: 'Will, Blake and Jarvis' }, from: { id: 8366932263 }, message, userName: 'Will', isOwner: true,
  }, 'note');
  assert.ok(q.id && !q.error, q.error);
  const row = readFileSync(requests.REQUESTS_PATH, 'utf-8').trim().split('\n').map((l) => JSON.parse(l)).find((r) => r.id === q.id);
  assert.match(row.summary, /^Will: Save this to memory as a logical primitive/);
  assert.equal(row.details, 'In reply to Willwillwillwillwill: "This is because context matters, especially in the Bible."');
  assert.deepEqual(row.chat, { id: -5590478415, type: 'group', title: 'Will, Blake and Jarvis' });
  assert.equal(row.messageId, 35857);
  assert.equal(row.from.isOwner, true);
  assert.equal(row.needsApproval, false);
});

test('U5 in a group, Will\'s unaddressed ask is queued before anything is said; anyone else\'s gets no proactive reply', () => {
  const idx = src('index.js');
  assert.match(idx, /const unaddressedAsk = detectActionRequest\(msgText\);/);
  assert.match(idx, /if \(unaddressedAsk && String\(ctx\.from\.id\) === String\(config\.ownerUserId\)\) \{/);
  assert.match(idx, /queueFromMessage\(\{ chat: ctx\.chat, from: ctx\.from, message: ctx\.message, userName, isOwner: true \}, unaddressedAsk\.action\)/);
  assert.match(idx, /await ctx\.reply\(QUEUED_NOTE, \{ parse_mode: undefined \}\);/);
  assert.match(idx, /if \(msgText\.length >= 3 && !unaddressedAsk && !shouldSkipProactive && !shouldSuppress\(ctx\.chat\.id, 'proactive'\)\) \{/);
  // The addressed path queues through the same function, so it carries the replied-to message too.
  assert.match(idx, /queueFromMessage\(\{ chat: ctx\.chat, from: ctx\.from, message: ctx\.message, userName, isOwner: String\(ctx\.from\.id\) === String\(config\.ownerUserId\) \}, actionAsk\.action\)/);
});
