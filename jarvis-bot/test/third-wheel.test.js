// Tests for the 2026-11-03 third-wheel incident. In the group "Will, Blake and Jarvis" Will wrote to
// Blake, not to the bot, and the proactive (CRPC) path posted a reply anyway. Its replies also kept
// closing on availability lines ("ready when Will spins up the indexer.", "ready whenever"). Will: "as
// the third wheel of that exchange, a thumbs up reaction to my message will suffice." An unaddressed
// group message now gets a thumbs-up where a reply would have gone, and the transport strips a closing
// availability line, or holds back a message that is nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { Context } from 'telegraf';
import { installDashFilter, reactInstead, stripSignOff, isSignOffOnly } from '../src/text-style.js';
import { QUEUED_NOTE } from '../src/protocol.js';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf-8');
const GROUP = -5590478415;
const THUMBS = [{ type: 'emoji', emoji: '👍' }];

// A real Telegraf context for a group message that names nobody, over a recording Telegram.
function unaddressedGroupMessage(telegram) {
  return new Context({
    update_id: 1,
    message: { message_id: 35860, date: 0, chat: { id: GROUP, type: 'group', title: 'Will, Blake and Jarvis' }, from: { id: 8366932263, first_name: 'Will' }, text: 'Blake, read Leviticus 23 before Sunday' },
  }, telegram, { id: 1, username: 'JarvisMind1828383bot' });
}

// The transport filter over a fake Telegram that records what would reach the API.
function transport() {
  const calls = [];
  class FakeTelegram { callApi(method, payload) { calls.push({ method, payload }); return payload; } }
  installDashFilter(FakeTelegram);
  return { t: new FakeTelegram(), calls };
}

function capture(stream, fn) {
  const lines = [];
  const original = console[stream];
  console[stream] = (...args) => lines.push(args.join(' '));
  return Promise.resolve().then(fn).finally(() => { console[stream] = original; }).then((result) => ({ result, lines }));
}

test('T1 an unaddressed group message gets a thumbs-up and no text', async () => {
  const calls = [];
  const telegram = {
    setMessageReaction: async (...args) => { calls.push(['setMessageReaction', ...args]); return true; },
    sendMessage: async (...args) => { calls.push(['sendMessage', ...args]); },
  };
  const { result, lines } = await capture('log', () => reactInstead(unaddressedGroupMessage(telegram)));
  assert.equal(result, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 4), ['setMessageReaction', GROUP, 35860, THUMBS]);
  assert.ok(lines.includes(`[airspace] third-wheel: reacted instead of replying in chat ${GROUP}`), lines.join('\n'));
});

test('T2 a failed reaction is logged and nothing is sent in its place', async () => {
  const calls = [];
  const telegram = {
    setMessageReaction: async () => { throw new Error('400: Bad Request: REACTION_INVALID'); },
    sendMessage: async (...args) => { calls.push(args); },
  };
  const { result, lines } = await capture('warn', () => reactInstead(unaddressedGroupMessage(telegram)));
  assert.equal(result, false);
  assert.equal(calls.length, 0);
  assert.match(lines.join('\n'), /\[airspace\] third-wheel: reaction failed in chat -5590478415, nothing sent: 400: Bad Request: REACTION_INVALID/);
});

test('T3 index.js: the unaddressed proactive path reacts where it used to reply; addressed messages still get a reply', () => {
  const idx = src('index.js');
  const start = idx.indexOf('if (isGroup && !isMentioned && !isReplyToBot && !isCalledByName) {');
  const end = idx.indexOf('// Shadow Protocol', start);
  assert.ok(start > -1 && end > start, 'the unaddressed group block is where it was');
  const unaddressed = idx.slice(start, end);
  const addressed = idx.slice(end, idx.indexOf('// ============ Startup ============', end));
  // The triage path and its transient-error retry: the draft decides, a reaction goes out, no text.
  assert.equal((unaddressed.match(/await reactInstead\(ctx\)/g) || []).length, 2);
  assert.doesNotMatch(unaddressed, /ctx\.reply\(clean(Reply|Retry)\b/);
  assert.doesNotMatch(unaddressed, /bufferAssistantMessage\(ctx\.chat\.id, (proactiveReply|retryReply)\)/);
  // Addressed messages are answered as before.
  assert.doesNotMatch(addressed, /reactInstead/);
  assert.match(addressed, /await ctx\.reply\(text, \{ parse_mode: undefined \}\);/);
});

test('T4 a closing availability line is stripped from the end of a multi-sentence reply', () => {
  const { t } = transport();
  assert.equal(t.callApi('sendMessage', { chat_id: GROUP, text: 'All four sheets came through, footnotes included. ready when Will spins up the indexer.' }).text,
    'All four sheets came through, footnotes included.');
  for (const [reply, kept] of [
    ['Pushed the fix. Ready when you are.', 'Pushed the fix.'],
    ['Pushed the fix.\n\nready whenever', 'Pushed the fix.'],
    ['Pushed the fix. Standing by.', 'Pushed the fix.'],
    ["Index first, then backfill. Let me know when you're ready.", 'Index first, then backfill.'],
    ["Pushed the fix. I'm here whenever you need me.", 'Pushed the fix.'],
    ['Pushed the fix. Ready when you are, Will.', 'Pushed the fix.'],
    ['Pushed the fix. I\u2019m ready when you are \u{1FAE1}', 'Pushed the fix.'],
    ['Pushed the fix. Standing by. Let me know if you need anything else.', 'Pushed the fix.'],
  ]) assert.equal(stripSignOff(reply), kept, reply);
});

test('T5 a "ready" mid-reply, or in a sentence with its own subject, is untouched', () => {
  const { t } = transport();
  for (const text of [
    'the build is ready when the tests pass, then we ship',
    'Tests are running. The build is ready when the tests pass, then we ship.',
    'Ready when you are. The indexer is at block 812k and the API is live.',
    'Ready when you are, the indexer is at block 812k.',
    'Pushed the fix. Let me know if the migration fails.',
    'Pushed the fix. Standing by is not an option, we ship tonight.',
    'Ready.',
    QUEUED_NOTE,
  ]) {
    assert.equal(stripSignOff(text), text, text);
    assert.equal(t.callApi('sendMessage', { chat_id: GROUP, text }).text, text, text);
  }
});

test('T6 a reply that is only an availability line is not sent', async () => {
  const { t, calls } = transport();
  // A DM: dropped. Nothing reaches Telegram, and the call still resolves so no caller sends a fallback.
  assert.equal(await t.callApi('sendMessage', { chat_id: 8366932263, text: 'ready when you are.' }), true);
  // A group reply threaded to the message it answers: that message gets the thumbs-up instead.
  await t.callApi('sendMessage', { chat_id: GROUP, text: 'Standing by. Ready whenever.', reply_parameters: { message_id: 35857 } });
  await t.callApi('sendMessage', { chat_id: GROUP, text: 'Here whenever you need me.', reply_to_message_id: 35858 });
  // A group reply that does not name the message it answers: dropped. The protocol line goes first.
  await t.callApi('sendMessage', { chat_id: GROUP, text: "Let me know when you're ready.\n<protocol>actions: none | sources: conversation</protocol>" });
  assert.deepEqual(calls, [
    { method: 'setMessageReaction', payload: { chat_id: GROUP, message_id: 35857, reaction: THUMBS } },
    { method: 'setMessageReaction', payload: { chat_id: GROUP, message_id: 35858, reaction: THUMBS } },
  ]);
  // An edit keeps its text, so a reply pacer placeholder is never left behind.
  assert.equal(t.callApi('editMessageText', { chat_id: GROUP, message_id: 9, text: 'ready when you are.' }).text, 'ready when you are.');
  assert.equal(isSignOffOnly('the build is ready when the tests pass, then we ship'), false);
});

test('T7 the prompt asks for it too: rule 25, and the constitution rule follows as 26', () => {
  const rule = src('memory.js').match(/\n(25\. [^\r\n]*)\r?\n<\/critical_rules>/)?.[1];
  assert.ok(rule, 'rule 25 closes the recency rules');
  assert.match(rule, /^25\. NEVER close a reply with an availability line .*If there is nothing to add, say nothing\.$/);
  assert.doesNotMatch(rule, /[—–]/);
  assert.match(src('constitution.js'), /export const RECENCY_RULE = '26\. /);
});
