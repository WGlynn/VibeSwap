// ============ text-style: roomLine (room register) + wordCount ============
// Pure helpers, no network, no state. roomLine sizes casual turns to the chat's own humans.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomLine, wordCount } from '../src/text-style.js';

const words = n => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

test('group of 4-word humans: length norm at the 12-word floor plus the only-tagged bullet', () => {
  const out = roomLine({ isGroup: true, humanTexts: Array(30).fill('a b c d') });
  assert.match(out, /about 4 words/);
  assert.match(out, /Land near 12 words/);
  assert.match(out, /only tagged/);
});

test('median is robust to long pitches', () => {
  const out = roomLine({ isGroup: true, humanTexts: ['a b', 'a b', 'a b c', words(90), words(91)] });
  assert.match(out, /about 3 words/);
  assert.match(out, /Land near 12 words/);
});

test('aim clamps to [12, 40]', () => {
  assert.match(roomLine({ isGroup: true, humanTexts: Array(5).fill(words(20)) }), /Land near 40 words/);
  assert.match(roomLine({ isGroup: true, humanTexts: Array(5).fill('gm') }), /about 1 words.*Land near 12 words/);
});

test('fewer than 5 samples: no length bullet, still the only-tagged bullet', () => {
  const out = roomLine({ isGroup: true, humanTexts: Array(4).fill('a b c') });
  assert.doesNotMatch(out, /People here write/);
  assert.match(out, /only tagged/);
});

test('bare @mentions are dropped from the counts', () => {
  const out = roomLine({ isGroup: true, humanTexts: [...Array(4).fill('a b c'), ...Array(6).fill('@JarvisMind1828383bot')] });
  assert.doesNotMatch(out, /People here write/);
});

test('DM: question bullet fires at 2+ of last 6, no length bullet; 1 of 6 returns empty', () => {
  const three = ['ok.', 'what now?', 'done.', 'which one? ', 'fine.', 'ready?'];
  const out = roomLine({ isGroup: false, recentReplies: three });
  assert.match(out, /kept ending on a question/);
  assert.doesNotMatch(out, /People here write|only tagged/);
  assert.equal(roomLine({ isGroup: false, recentReplies: ['a?', 'b.', 'c.', 'd.', 'e.', 'f.'] }), '');
});

test('only the last 6 replies count', () => {
  const replies = ['old?', 'older?', 'a.', 'b.', 'c.', 'd.', 'e.', 'f.'];
  assert.equal(roomLine({ isGroup: false, recentReplies: replies }), '');
});

test('wordCount strips URLs and @mentions', () => {
  assert.equal(wordCount('@bot gm https://x.y ser'), 2);
  assert.equal(wordCount(''), 0);
});

test('roomLine output carries no em or en dashes', () => {
  const out = roomLine({ isGroup: true, humanTexts: Array(10).fill('a b c'), recentReplies: ['a?', 'b?'] });
  assert.doesNotMatch(out, /[—–]/);
});

test("group line never makes Will's DMs conditional on someone asking", () => {
  const out = roomLine({ isGroup: true, humanTexts: [] });
  assert.match(out, /Never bring up anything from Will's DMs/);
  assert.doesNotMatch(out, /DMs[^.]*if someone here asks/);
});
