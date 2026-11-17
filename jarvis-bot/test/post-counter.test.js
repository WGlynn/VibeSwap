// Tests for the Vibeswap identity post counter (src/post-counter.js, slice A1 of
// Desktop/Research/vibeswap-sbt/DESIGN.md). Every person, id and message here is synthetic. The logs
// live in a temp DATA_DIR, so the bot's real data is never read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const CHAT = '-100777000111';
const OTHER_CHAT = '-100777000222';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'post-counter-'));
process.env.IDENTITY_CHAT_ID = CHAT;

const pc = await import('../src/post-counter.js');
const { unionRecords, countPosts, tierFor, screen, eligibilityFor, chatPostStats } = pc;

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
const at = (daysAgo, minute = 0) => NOW - daysAgo * DAY + minute * 60_000;

// Ten varied synthetic posts: each clears the screen and none is a near-copy of another.
const REAL = [
  'The batch auction clears every order at one uniform price.',
  'Does the commit phase hide my order size from the solvers?',
  'I tried the testnet faucet this morning and it worked fine.',
  'Shapley rewards split fees by marginal contribution, right?',
  'Could someone explain how the reveal deadline gets enforced?',
  'Liquidity providers here seem protected from sandwich attacks.',
  'Ran the fuzz suite overnight; two invariants held for 10k runs.',
  'What happens to a deposit if I never reveal my committed order?',
  'Governance proposals need a quorum before execution, I believe.',
  'My node synced in under four minutes on a cheap laptop today.',
];

let nextId = 1;
const msg = (userId, ts, text, extra = {}) => ({
  ts, chatId: Number(CHAT), chatType: 'supergroup', messageId: nextId++, userId, username: `fixture_user_${userId}`,
  firstName: 'Fixture', isBot: false, type: 'text', isEdit: false, text, ...extra,
});

// A person with 6 real posts over 3 days, the first 8 days ago.
const memberPosts = (userId) => [
  msg(userId, at(8), REAL[0]), msg(userId, at(8, 5), REAL[1]),
  msg(userId, at(5), REAL[2]), msg(userId, at(5, 5), REAL[3]),
  msg(userId, at(2), REAL[4]), msg(userId, at(2, 5), REAL[5]),
];

const stats = (archive, contributions = []) => countPosts(unionRecords({ archive, contributions }, CHAT));

test('the screen: short, repetitive and copied text fail; real text passes', () => {
  assert.equal(screen('gm gm'), 'too_short');
  assert.equal(screen('booger booger booger booger booger booger booger booger'), 'low_information');
  assert.equal(screen(REAL[0]), null);
  const seen = new Set(pc.shingles(REAL[0]));
  assert.equal(screen(REAL[0] + '!', seen), 'unoriginal');
  assert.equal(screen(REAL[1], seen), null);
});

test('6 junk posts in one burst are not eligible', () => {
  const junk = ['gm', 'gm gm', 'lol', 'wen moon', 'ok', 'nice'].map((t, i) => msg(101, at(9, i), t));
  assert.equal(stats(junk).get('101'), undefined);
  assert.equal(tierFor(stats(junk).get('101'), NOW), null);
});

test('6 real posts in one burst count 3 (the daily cap) and are not a member', () => {
  const burst = REAL.slice(0, 6).map((t, i) => msg(102, at(9, i), t));
  const s = stats(burst).get('102');
  assert.deepEqual({ counted: s.counted, days: s.days }, { counted: 3, days: 1 });
  assert.equal(tierFor(s, NOW), 'identity');
});

test('6 real posts over 3 days, a week old, clear the member bar', () => {
  const s = stats(memberPosts(103)).get('103');
  assert.deepEqual(s, { counted: 6, days: 3, firstTs: at(8) });
  assert.equal(tierFor(s, NOW), 'member');
  // the same posts, the first only 6 days ago: identity only
  assert.equal(tierFor(s, at(8) + 6 * DAY), 'identity');
  // a moderation action keeps a member-level count at identity
  assert.equal(tierFor(s, NOW, { moderated: true }), 'identity');
});

test('near-copies of a person\'s own earlier posts do not count', () => {
  const posts = [
    msg(104, at(8), REAL[0]), msg(104, at(7), REAL[0] + ' Yes.'),
    msg(104, at(6), REAL[0].toUpperCase().toLowerCase()), msg(104, at(5), REAL[1]),
  ];
  assert.equal(stats(posts).get('104').counted, 2);
  // another person may say the same thing: overlap is checked per person
  assert.equal(stats([msg(105, at(8), REAL[0]), msg(106, at(8, 1), REAL[0])]).get('106').counted, 1);
});

test('edits deduplicate: an edited post counts once, from its original', () => {
  const original = msg(107, at(8), REAL[0]);
  const edit = { ...original, isEdit: true, text: REAL[0] + ' (edited)' };
  assert.equal(stats([original, edit, edit]).get('107').counted, 1);
  // a message both logs hold is one post
  const row = { telegramUserId: 107, chatId: Number(CHAT), messageId: original.messageId, timestamp: original.ts, textLength: REAL[0].length };
  assert.equal(stats([original], [row]).get('107').counted, 1);
});

test('other chats, bots, commands, forwards and joins are ignored', () => {
  const s = stats([
    { ...msg(108, at(8), REAL[0]), chatId: Number(OTHER_CHAT) },
    { ...msg(108, at(8, 1), REAL[1]), isBot: true },
    { ...msg(108, at(8, 2), '/claim ' + 'a'.repeat(64)), type: 'command' },
    { ...msg(108, at(8, 3), REAL[2]), isForwarded: true },
    { ...msg(108, at(8, 4), null), type: 'new_chat_members' },
  ], [{ telegramUserId: 108, chatId: Number(OTHER_CHAT), messageId: 999001, timestamp: at(7), textLength: 80 }]);
  assert.equal(s.get('108'), undefined);
});

test('rows only contributions.json holds count by length, and a forward the archive flags stays out', () => {
  const rows = [
    { telegramUserId: 109, chatId: Number(CHAT), messageId: 888001, timestamp: at(30), textLength: 60 },
    { telegramUserId: 109, chatId: Number(CHAT), messageId: 888002, timestamp: at(29), textLength: 4 },
  ];
  assert.equal(stats([], rows).get('109').counted, 1);
  const fwd = { ...msg(110, at(8), REAL[0]), isForwarded: true };
  const fwdRow = { telegramUserId: 110, chatId: Number(CHAT), messageId: fwd.messageId, timestamp: fwd.ts, textLength: 60 };
  assert.equal(stats([fwd], [fwdRow]).get('110'), undefined);
});

test('from the files: antispam and moderation actions are honored, and eligibilityFor reads both logs', () => {
  const dir = process.env.DATA_DIR;
  const archive = [...memberPosts(201), ...memberPosts(202), msg(203, at(1), REAL[6]), ...memberPosts(204)];
  const spammed = archive.find((m) => m.userId === 204);
  mkdirSync(join(dir, 'archive', CHAT), { recursive: true });
  writeFileSync(join(dir, 'archive', CHAT, '2026-11-09.jsonl'), archive.map((m) => JSON.stringify(m)).join('\n') + '\n');
  writeFileSync(join(dir, 'contributions.json'), JSON.stringify([
    { telegramUserId: 203, username: 'fixture_user_203', chatId: Number(CHAT), messageId: 777001, timestamp: at(20), textLength: 70 },
  ]));
  writeFileSync(join(dir, 'spam-log.json'), JSON.stringify([{ action: 'mute', userId: 204, chatId: Number(CHAT), messageId: spammed.messageId, timestamp: at(8) }]));
  writeFileSync(join(dir, 'moderation.json'), JSON.stringify([{ action: 'warn', userId: 202, chatId: Number(CHAT), reversed: false }]));

  assert.equal(eligibilityFor(201, NOW).tier, 'member');
  assert.equal(eligibilityFor(202, NOW).tier, 'identity'); // warned
  const e203 = eligibilityFor(203, NOW);
  assert.deepEqual({ counted: e203.counted, days: e203.days, tier: e203.tier }, { counted: 2, days: 2, tier: 'identity' });
  const e204 = eligibilityFor(204, NOW);
  assert.equal(e204.counted, 5); // the message antispam acted on is out, and the person is moderated
  assert.equal(e204.tier, 'identity');
  assert.equal(eligibilityFor(999, NOW).tier, null);
  assert.equal(chatPostStats().stats.size, 4);
});

test('the report prints counts only: no names, usernames, ids or text', () => {
  const script = fileURLToPath(new URL('../scripts/post-count-report.js', import.meta.url));
  const out = execFileSync(process.execPath, [script], { env: { ...process.env }, encoding: 'utf8' });
  assert.match(out, /people with a counted post: 4/);
  for (const banned of ['fixture_user', 'Fixture', '201', '202', '203', '204', ...REAL.map((t) => t.slice(0, 20))]) {
    assert.ok(!out.includes(banned), `report leaked ${banned}`);
  }
});
