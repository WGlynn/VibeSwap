// Tests for antispam check 3 (new account plus link) and its join-date source, src/first-seen.js
// (slice S2.5 of section 2 in Desktop/Research/vibeswap-sbt/DESIGN.md). The check used to be called with
// no join date, so every account looked old and it never fired. Now the join date is the person's
// first-seen time in the chat, from the bot's own logs, used only when the logs reach back 24 h. Every
// chat, person and message here is synthetic; the logs live in a temp DATA_DIR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dir = mkdtempSync(join(tmpdir(), 'antispam-'));
process.env.DATA_DIR = dir;

const CHAT = '-100777000333';   // logged for 30 days
const YOUNG = '-100777000444';  // logged for 2 hours
const EMPTY = '-100777000555';  // no logs at all
const OLD = 9001, NEW = 9002, JOINER = 9003, STRANGER = 9004, JUNKER = 9005;

const HOUR = 60 * 60 * 1000, DAY = 24 * HOUR;
const T0 = Date.now();
let nextId = 1;
const rec = (chatId, userId, ts, text, extra = {}) => ({
  ts, chatId: Number(chatId), chatType: 'supergroup', messageId: nextId++, userId, isBot: false,
  type: 'text', isEdit: false, ...(text == null ? {} : { text }), ...extra,
});
const writeArchive = (chatId, rows) => {
  mkdirSync(join(dir, 'archive', chatId), { recursive: true });
  writeFileSync(join(dir, 'archive', chatId, 'fixture.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
};
writeArchive(CHAT, [
  rec(CHAT, OLD, T0 - 30 * DAY, 'The batch auction clears every order at one uniform price.'),
  rec(CHAT, JOINER, T0 - 3 * DAY, null, { type: 'new_chat_members' }),
  rec(CHAT, NEW, T0 - 2 * HOUR, 'Does the commit phase hide my order size from the solvers?'),
  rec(CHAT, JUNKER, T0 - 5 * DAY, 'gm gm'),
]);
writeArchive(YOUNG, [rec(YOUNG, OLD, T0 - 2 * HOUR, 'I tried the testnet faucet this morning and it worked.')]);

const { checkMessage } = await import('../src/antispam.js');
const FS = await import('../src/first-seen.js');
const { presenceOf, joinDateFor, noteSeen, noteCountedPost, resetFirstSeen } = FS;

function stubBot() {
  const calls = [];
  return {
    calls,
    telegram: {
      deleteMessage: async (chatId, messageId) => { calls.push(['delete', chatId, messageId]); },
      restrictChatMember: async (chatId, userId, opts) => { calls.push(['restrict', chatId, userId, opts.until_date]); },
      banChatMember: async (chatId, userId) => { calls.push(['ban', chatId, userId]); },
    },
  };
}
const ctxFor = (chatId, from, text) => ({
  chat: { id: Number(chatId), type: 'supergroup' },
  from: { is_bot: false, ...from },
  message: { text, message_id: nextId++, date: Math.floor(Date.now() / 1000) },
});
const LINK = (n) => `have a look at https://site${n}.example when you can`;

test('first-seen reads the logs: first message of any kind, first counted post, and how far back the chat goes', () => {
  resetFirstSeen();
  const old = presenceOf(CHAT, OLD);
  assert.equal(old.since, T0 - 30 * DAY);
  assert.equal(old.firstSeenTs, T0 - 30 * DAY);
  assert.equal(old.firstCountedTs, T0 - 30 * DAY);
  // a join and a junk post are first sightings but not counted posts
  assert.deepEqual(presenceOf(CHAT, JOINER), { since: T0 - 30 * DAY, firstSeenTs: T0 - 3 * DAY, firstCountedTs: null });
  assert.equal(presenceOf(CHAT, JUNKER).firstSeenTs, T0 - 5 * DAY);
  assert.equal(presenceOf(CHAT, JUNKER).firstCountedTs, null);
  // someone never logged is first seen now, and stays so
  const now = T0 + 1000;
  assert.equal(presenceOf(CHAT, STRANGER, now).firstSeenTs, now);
  assert.equal(presenceOf(CHAT, STRANGER, now + 5000).firstSeenTs, now);
});

test('joinDateFor gives a date only when the chat\'s logs reach back 24 h', () => {
  resetFirstSeen();
  assert.equal(joinDateFor(CHAT, NEW), T0 - 2 * HOUR);
  assert.equal(joinDateFor(YOUNG, OLD), undefined);
  // a chat with no logs starts its clock at the first lookup; 25 h later its first sightings count
  const t = Date.now();
  assert.equal(joinDateFor(EMPTY, OLD, t), undefined);
  assert.equal(joinDateFor(EMPTY, OLD, t + 25 * HOUR), t);
});

test('noteSeen and noteCountedPost keep it current: junk, forwards and edits do not count; DMs are ignored', () => {
  resetFirstSeen();
  const who = 9100;
  const t = T0 + 10_000;
  noteSeen(rec(CHAT, who, t, 'gm gm'));
  noteCountedPost(rec(CHAT, who, t, 'gm gm'));
  assert.deepEqual(presenceOf(CHAT, who, t + 1), { since: T0 - 30 * DAY, firstSeenTs: t, firstCountedTs: null });
  noteCountedPost(rec(CHAT, who, t + 2, 'Shapley rewards split fees by marginal contribution, right?', { isForwarded: true }));
  noteCountedPost(rec(CHAT, who, t + 3, 'Shapley rewards split fees by marginal contribution, right?', { isEdit: true }));
  assert.equal(presenceOf(CHAT, who, t + 4).firstCountedTs, null);
  noteCountedPost(rec(CHAT, who, t + 5, 'Shapley rewards split fees by marginal contribution, right?'));
  assert.equal(presenceOf(CHAT, who, t + 6).firstCountedTs, t + 5);
  noteCountedPost(rec(CHAT, who, t + 7, 'Could someone explain how the reveal deadline gets enforced?'));
  assert.equal(presenceOf(CHAT, who, t + 8).firstCountedTs, t + 5); // the first one stays
  noteSeen({ ...rec('5551', 9200, t, 'a direct message to the bot'), chatType: 'private' });
  noteSeen(null);
  noteCountedPost(undefined);
});

test('check 3 fires: a new account with no username posting a link is muted for an hour and its message deleted', async () => {
  resetFirstSeen();
  const bot = stubBot();
  const ctx = ctxFor(CHAT, { id: NEW }, LINK(1));
  const r = await checkMessage(bot, ctx);
  assert.equal(r.action, 'mute');
  assert.equal(r.reason, 'New account with no username posting links');
  assert.equal(r.executed, true);
  assert.deepEqual(bot.calls[0], ['delete', Number(CHAT), ctx.message.message_id]);
  assert.equal(bot.calls[1][0], 'restrict');
  const until = bot.calls[1][3] * 1000 - Date.now();
  assert.ok(until > 59 * 60 * 1000 && until <= 60 * 60 * 1000 + 1000, `mute length ${until} ms`);
  // someone the logs have never seen, no username, link on their first message: also new
  const bot2 = stubBot();
  assert.equal((await checkMessage(bot2, ctxFor(CHAT, { id: STRANGER }, LINK(2)))).action, 'mute');
});

test('check 3 near misses: a username, an older first sighting, a join 3 days ago, or no link all pass', async () => {
  resetFirstSeen();
  const cases = [
    [CHAT, { id: NEW, username: 'fixture_named' }, LINK(3)],
    [CHAT, { id: OLD }, LINK(4)],
    [CHAT, { id: JOINER }, LINK(5)],
    [CHAT, { id: NEW }, 'no link in this one, just a question about fees'],
  ];
  for (const [chat, from, text] of cases) {
    const bot = stubBot();
    assert.deepEqual(await checkMessage(bot, ctxFor(chat, from, text)), { action: 'allow' }, JSON.stringify(from));
    assert.deepEqual(bot.calls, []);
  }
});

test('check 3 stays off where the logs are too young to tell anyone is new', async () => {
  resetFirstSeen();
  for (const chat of [YOUNG, EMPTY]) {
    const bot = stubBot();
    assert.deepEqual(await checkMessage(bot, ctxFor(chat, { id: 9300 }, LINK(6))), { action: 'allow' }, chat);
    assert.deepEqual(bot.calls, []);
  }
});

test('checks 1 and 2 are unchanged: a scam pattern bans, the same text three times in a minute mutes', async () => {
  resetFirstSeen();
  const bot = stubBot();
  const r = await checkMessage(bot, ctxFor(CHAT, { id: OLD, username: 'fixture_old' }, 'claim your free airdrop now'));
  assert.equal(r.action, 'ban');
  const who = { id: 9400, username: 'fixture_repeat' };
  const text = 'the same words sent again and again';
  assert.equal((await checkMessage(stubBot(), ctxFor(CHAT, who, text))).action, 'allow');
  assert.equal((await checkMessage(stubBot(), ctxFor(CHAT, who, text))).action, 'allow');
  assert.equal((await checkMessage(stubBot(), ctxFor(CHAT, who, text))).action, 'mute');
});
