// Tests for two failures in one stretch of the "Will, Blake and Jarvis" group (2026-11-03):
// 1. "remember this video at all?" was queued for Will's session, which answered in the chat itself
//    (POST /api/say, replying to the question). The receipt watcher then posted a second reply made
//    from the session's receipt: "checked. Levin's Against Mind Blindness, the spectrum picture and
//    continuum idea, keeping the personal June parts out". Will: "an internal message that slipped through".
// 2. Given an email address, the bot answered "got it, logged." with no tool run. The claim check
//    looked only at a sentence's first word.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let requests;
let claims;
let protocol;
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf-8');

before(async () => {
  process.env.JARVIS_FEED_DIR = mkdtempSync(join(tmpdir(), 'jarvis-feed-test-')); // read once, when feed.js loads
  requests = await import('../src/session-requests.js');
  claims = await import('../src/action-claims.js');
  protocol = await import('../src/protocol.js');
});

test('C1 a request the session answered in its chat gets no second, confirming reply', () => {
  const request = { id: 'b18360aa', chat: { id: -5590478415 }, messageId: 35881 };
  assert.equal(requests.answeredInChat(request), false);
  requests.noteSessionReply('-5590478415', 35881); // what /api/say records when the session replies to it
  assert.equal(requests.answeredInChat(request), true);
  assert.equal(requests.answeredInChat({ ...request, messageId: 35882 }), false);
  assert.equal(requests.answeredInChat({ id: 'x', chat: { id: -1 } }), false);
});

test('C2 /api/say records the session\'s replies, and the watcher checks them before any model call', () => {
  const idx = src('index.js');
  assert.match(idx, /if \(payload\.replyToMessageId\) noteSessionReply\(chatId, payload\.replyToMessageId\);/);
  const watcher = idx.slice(idx.indexOf('const deliverSessionReceipts'), idx.indexOf('setInterval(() => { deliverSessionReceipts()'));
  const check = watcher.indexOf('answeredInChat(request)');
  assert.ok(check > -1 && check < watcher.indexOf('confirmationPrompt('), 'the answered check must come before the confirmation call');
});

test('C3 a confirmation tells the person what was done, never the session\'s notes to itself', () => {
  const prompt = requests.confirmationPrompt({
    receipt: { status: 'done', summary: 'Answered in the group (msg reply to 35881): Levin, the spectrum picture; personal parts of the June conversation kept out' },
    request: { id: 'b18360aa', action: 'note', summary: 'Will: remember this video at all?', from: { name: 'Will' } },
  });
  assert.match(prompt, /Everyone in this chat reads it/);
  assert.match(prompt, /Never repeat the session's notes to itself/);
  // The session is told the same thing when a request reaches it.
  const hook = readFileSync(join(process.env.USERPROFILE || process.env.HOME, '.claude', 'hooks', '_session_requests.py'), 'utf-8');
  assert.match(hook, /the bot posts nothing more/);
});

test('C4 an acknowledgment in front of an action claim does not hide it', () => {
  for (const s of ['got it, logged.', 'ok, noted.', 'Done, saved.', 'sure, added it to the board.', 'Added it to the board.', 'Got it, I logged it.', 'yep. stored it.', 'Okay! Recorded that.']) {
    assert.equal(claims.claimsAction(s), true, s);
  }
  // Still not claims: state, speech and plain acknowledgments.
  for (const s of ['conversation history logged locally, by design.', 'I noted earlier that the cap is 5%.', 'got it, makes sense.', 'ok, that tracks.', 'Got it, I logged in.', "It's already on the project board."]) {
    assert.equal(claims.claimsAction(s), false, s);
  }
});

test('C5 the live reply loses its unbacked "logged"', () => {
  const out = protocol.speak('got it, logged.\n<protocol>actions: none | sources: conversation</protocol>', protocol.turnRecord({ chatType: 'group' }));
  assert.doesNotMatch(out.reply, /logged/i);
  assert.ok(out.violations.includes('unbacked_action'));
});
