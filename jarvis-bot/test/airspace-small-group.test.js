// Tests for the 2026-11-04 small-group exemption. In "Will, Blake and Jarvis" (three members, the bot
// included) the airspace monitor throttled Blake, the main person talking to Jarvis, even when he
// called Jarvis by name: "[airspace] Throttled response to blakesilvers in -5590478415:
// heavy_dominance (86% of messages)". Will: "exempt small groups from the throttle". A chat of three or
// fewer members, as Telegram counts them, now skips the dominance throttle. The count is cached per
// chat for an hour, and a failed lookup keeps the throttle and is logged once. Telegram is a fake: no
// test calls the API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { recordMessage, checkAirspace, getMemberCount, flagNoise } from '../src/airspace-monitor.js';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf-8');
const HOUR = 60 * 60 * 1000;
const BLAKE = 1001;
const WILL = 1002;

// A fake Telegram whose member-count lookup returns `result` (or throws it), recording each chat asked.
function fakeTelegram(result) {
  const t = { asked: [] };
  t.getChatMembersCount = async (chatId) => {
    t.asked.push(chatId);
    if (result instanceof Error) throw result;
    return result;
  };
  return t;
}

// Blake sends 6 of the 7 messages (86%), as in the logged incident.
function blakeDominates(chatId) {
  for (let i = 0; i < 6; i++) recordMessage(chatId, BLAKE);
  recordMessage(chatId, WILL);
}

// Pin the throttle's dice roll. 0.99 means every probabilistic check says skip.
function withRoll(roll, fn) {
  const saved = Math.random;
  Math.random = () => roll;
  try { return fn(); } finally { Math.random = saved; }
}

// Run fn as if `ms` had passed.
async function later(ms, fn) {
  const saved = Date.now;
  Date.now = () => saved() + ms;
  try { return await fn(); } finally { Date.now = saved; }
}

async function capture(fn) {
  const lines = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(saved)) console[k] = (...args) => lines.push(args.join(' '));
  try {
    return { result: await fn(), lines };
  } finally {
    Object.assign(console, saved);
  }
}

test('A1 a three-member group skips the dominance throttle', async () => {
  const chat = -5590478415;
  blakeDominates(chat);
  // Without a count this is the logged incident, so the exemption below is the count's doing.
  assert.deepEqual(withRoll(0.99, () => checkAirspace(chat, BLAKE, null)),
    { shouldRespond: false, reason: 'heavy_dominance (86% of messages)', probability: 0.3 });
  const count = await getMemberCount(chat, fakeTelegram(3));
  assert.equal(count, 3);
  assert.deepEqual(withRoll(0.99, () => checkAirspace(chat, BLAKE, count)),
    { shouldRespond: true, reason: 'small_group (3 members)', probability: 1.0 });
});

test('A2 a share in the 30-50% tier is exempt in a small group too, since a skipped heavy share lands there', () => {
  const chat = -2002;
  for (let i = 0; i < 3; i++) recordMessage(chat, BLAKE);
  for (let i = 0; i < 4; i++) recordMessage(chat, WILL);
  assert.equal(withRoll(0.99, () => checkAirspace(chat, BLAKE, null)).reason, 'moderate_dominance (43% of messages)');
  assert.equal(withRoll(0.99, () => checkAirspace(chat, BLAKE, 2)).shouldRespond, true);
});

test('A3 a group of four or more keeps the dominance throttle', async () => {
  for (const [chat, members] of [[-3004, 4], [-3250, 250]]) {
    blakeDominates(chat);
    const count = await getMemberCount(chat, fakeTelegram(members));
    assert.deepEqual(withRoll(0.99, () => checkAirspace(chat, BLAKE, count)),
      { shouldRespond: false, reason: 'heavy_dominance (86% of messages)', probability: 0.3 }, `${members} members`);
  }
});

test('A4 a failed lookup keeps the throttle and is logged once', async () => {
  const chat = -4004;
  blakeDominates(chat);
  const telegram = fakeTelegram(new Error('400: Bad Request: chat not found'));
  const first = await capture(() => getMemberCount(chat, telegram));
  assert.equal(first.result, null);
  assert.deepEqual(first.lines,
    [`[airspace] member count lookup failed in ${chat}, dominance throttle stays on: 400: Bad Request: chat not found`]);
  assert.deepEqual(withRoll(0.99, () => checkAirspace(chat, BLAKE, first.result)),
    { shouldRespond: false, reason: 'heavy_dominance (86% of messages)', probability: 0.3 });
  // The failure is cached for the hour; the retry after it fails again with no second log line.
  const cached = await capture(() => getMemberCount(chat, telegram));
  const retry = await capture(() => later(HOUR + 1000, () => getMemberCount(chat, telegram)));
  assert.equal(retry.result, null);
  assert.deepEqual(telegram.asked, [chat, chat]);
  assert.deepEqual([...cached.lines, ...retry.lines], []);
});

test('A5 the member count is cached per chat for an hour', async () => {
  const telegram = fakeTelegram(3);
  assert.equal(await getMemberCount(-5005, telegram), 3);
  assert.equal(await getMemberCount(-5005, telegram), 3);
  assert.equal(await later(HOUR - 60 * 1000, () => getMemberCount(-5005, telegram)), 3);
  assert.deepEqual(telegram.asked, [-5005]);
  await getMemberCount(-5006, telegram); // another chat is its own lookup
  await later(HOUR + 1000, () => getMemberCount(-5005, telegram)); // past the hour: asked again
  assert.deepEqual(telegram.asked, [-5005, -5006, -5005]);
});

test('A6 the noise flag still silences a small group', () => {
  const chat = -6006;
  blakeDominates(chat);
  flagNoise(chat);
  assert.deepEqual(checkAirspace(chat, BLAKE, 3), { shouldRespond: false, reason: 'noise_flagged', probability: 0.0 });
});

test('A7 the group handler passes the cached member count to checkAirspace', () => {
  assert.match(src('index.js'),
    /const memberCount = await getMemberCount\(ctx\.chat\.id, ctx\.telegram\);\s+const airspace = checkAirspace\(ctx\.chat\.id, ctx\.from\.id, memberCount\);/);
});
