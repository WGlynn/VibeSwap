// End-to-end tests for /claim, /unclaim and /identity (src/identity-claim.js, slice A3 of
// Desktop/Research/vibeswap-sbt/DESIGN.md), driven through a fake Telegram ctx, so no message is sent
// anywhere. Every person, id, address and post is synthetic. The data dir, the session feed and the
// members file are temp dirs. The tests run in order and share one registry, like a real sequence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const CHAT = '-100777000111';
const OWNER = 900001;
const MEMBER = 301, IDENT = 302, NOBODY = 303, STRANGER = 304, LATE = 305, HAND = 306;
const DATA = mkdtempSync(join(tmpdir(), 'claim-data-'));
const FEED = mkdtempSync(join(tmpdir(), 'claim-feed-'));
Object.assign(process.env, { DATA_DIR: DATA, JARVIS_FEED_DIR: FEED, IDENTITY_CHAT_ID: CHAT, OWNER_USER_ID: String(OWNER) });

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
const at = (daysAgo, minute = 0) => NOW - daysAgo * DAY + minute * 60_000;
const REAL = [
  'The batch auction clears every order at one uniform price.',
  'Does the commit phase hide my order size from the solvers?',
  'I tried the testnet faucet this morning and it worked fine.',
  'Shapley rewards split fees by marginal contribution, right?',
  'Could someone explain how the reveal deadline gets enforced?',
  'Liquidity providers here seem protected from sandwich attacks.',
];
let nextId = 1;
const post = (userId, ts, text) => ({ ts, chatId: Number(CHAT), chatType: 'supergroup', messageId: nextId++, userId,
  username: `fixture_user_${userId}`, firstName: 'Fixture', isBot: false, type: 'text', isEdit: false, text });
// 6 posts on 3 days, the first `firstDaysAgo` days before NOW
const sixOverThreeDays = (userId, firstDaysAgo) => [0, 1, 2].flatMap((d) => [
  post(userId, at(firstDaysAgo - d * 1.5), REAL[d * 2]), post(userId, at(firstDaysAgo - d * 1.5, 5), REAL[d * 2 + 1]),
]);
mkdirSync(join(DATA, 'archive', CHAT), { recursive: true });
writeFileSync(join(DATA, 'archive', CHAT, '2026-11-10.jsonl'), [
  ...sixOverThreeDays(OWNER, 9), ...sixOverThreeDays(MEMBER, 8), post(IDENT, at(2), REAL[0]),
  ...sixOverThreeDays(STRANGER, 8), ...sixOverThreeDays(LATE, 4), post(NOBODY, at(1), 'gm'), ...sixOverThreeDays(HAND, 8),
].map((m) => JSON.stringify(m)).join('\n') + '\n');
writeFileSync(join(DATA, 'throttle-members.json'), JSON.stringify({
  _doc: 'fixture members file',
  members: [{ id: HAND, username: 'fixture_hand', name: 'Fixture Hand', added: '2026-11-17', why: 'fixture' }],
}));

const { handleClaim, handleUnclaim, handleIdentityAdmin, TEXT } = await import('../src/identity-claim.js');
const { isMember } = await import('../src/airspace-monitor.js');

const addr = (c) => c.repeat(64);
let msgId = 5000;
function dm(from, text, chatType = 'private') {
  const replies = [];
  const ctx = {
    from: { id: from, is_bot: false, first_name: 'Fixture' },
    chat: chatType === 'private' ? { id: from, type: 'private' } : { id: Number(CHAT), type: chatType, title: 'Fixture group' },
    message: { message_id: msgId++, text },
    reply: (t) => { replies.push(t); return Promise.resolve(); },
  };
  return { ctx, replies };
}
const run = (handler, from, text, opts = {}) => {
  const { ctx, replies } = dm(from, text, opts.chatType);
  handler(ctx, { now: opts.now ?? NOW });
  return replies;
};
const claim = (from, text, opts) => run(handleClaim, from, text, opts);
const registry = () => (existsSync(join(DATA, 'identity-registry.json')) ? JSON.parse(readFileSync(join(DATA, 'identity-registry.json'), 'utf8')) : null);
const requests = () => (existsSync(join(FEED, 'requests.jsonl'))
  ? readFileSync(join(FEED, 'requests.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const members = () => JSON.parse(readFileSync(join(DATA, 'throttle-members.json'), 'utf8')).members;
const rowOf = (id) => registry().rows.filter((r) => r.telegramId === String(id)).at(-1);

test('C1 in a group all three commands are silent and write nothing', () => {
  for (const type of ['group', 'supergroup']) {
    assert.deepEqual(claim(MEMBER, `/claim ${addr('a')}`, { chatType: type }), []);
    assert.deepEqual(run(handleUnclaim, MEMBER, '/unclaim confirm', { chatType: type }), []);
    assert.deepEqual(run(handleIdentityAdmin, OWNER, '/identity open', { chatType: type }), []);
  }
  assert.equal(registry(), null);
  assert.deepEqual(requests(), []);
});

test('C2 closed (the default): a stranger is refused, the owner is accepted', () => {
  assert.deepEqual(claim(STRANGER, `/claim ${addr('4')}`), [TEXT.notOpen]);
  assert.deepEqual(run(handleUnclaim, STRANGER, '/unclaim'), [TEXT.notOpen]);
  assert.deepEqual(run(handleIdentityAdmin, STRANGER, '/identity open'), []); // owner only, silent
  assert.equal(registry(), null);

  const [reply] = claim(OWNER, `/claim ${addr('0')}`);
  assert.match(reply, /^Recorded: Vibeswap identity #1, tier member, bound to 00000000\.\.\.000000\./);
  assert.match(reply, /queued for the next mint batch; it is not on chain yet/);
  assert.doesNotMatch(reply, /\bminted\b/);
  assert.equal(registry().claimsOpen, false);
  assert.deepEqual(registry().rows.map((r) => [r.serial, r.tier, r.status]), [[1, 'member', 'active']]);
  const [req] = requests();
  assert.equal(req.action, 'identity_mint');
  assert.match(req.summary, /serial 1 pending/);
  assert.ok(!JSON.stringify(req).includes(addr('0')), 'the request carries no address');
  assert.equal(req.from.name, null);
});

test('C3 the owner opens claims; usage and a bad address', () => {
  assert.deepEqual(run(handleIdentityAdmin, OWNER, '/identity open'), ['Claims are OPEN: anyone who clears the bars can /claim in a DM.']);
  assert.equal(registry().claimsOpen, true);
  assert.deepEqual(claim(MEMBER, '/claim'), [TEXT.usage]);
  for (const bad of ['0x' + addr('a'), addr('a').slice(2), addr('g')]) assert.deepEqual(claim(MEMBER, `/claim ${bad}`), [TEXT.badAddress]);
});

test('C4 open: a member gets a members-list entry by id only; identity-only gets none', () => {
  const [m] = claim(MEMBER, `/claim ${addr('A')}`);
  assert.match(m, /^Recorded: Vibeswap identity #2, tier member/);
  assert.match(m, /members list now/);
  assert.equal(rowOf(MEMBER).address, addr('a')); // stored lowercase
  const entry = members().find((e) => String(e.id) === String(MEMBER));
  assert.deepEqual(Object.keys(entry).sort(), ['claimed', 'id', 'serial']);
  assert.equal(entry.serial, 2);
  assert.equal(isMember({ id: MEMBER }), true);
  assert.equal(isMember({ id: 1, username: `fixture_user_${MEMBER}` }), false);

  const [i] = claim(IDENT, `/claim ${addr('b')}`);
  assert.match(i, /^Recorded: Vibeswap identity #3, tier identity/);
  assert.match(i, /you have 1 on 1 day\./);
  assert.ok(!members().some((e) => String(e.id) === String(IDENT)));
  // Will's hand-added entry and the file's other fields are untouched
  assert.deepEqual(members().find((e) => e.id === HAND), { id: HAND, username: 'fixture_hand', name: 'Fixture Hand', added: '2026-11-17', why: 'fixture' });
  assert.equal(JSON.parse(readFileSync(join(DATA, 'throttle-members.json'), 'utf8'))._doc, 'fixture members file');
});

test('C5 open: below both bars, a taken address, a second claim and a re-bind are refused', () => {
  const before = requests().length;
  assert.deepEqual(claim(NOBODY, `/claim ${addr('c')}`), [TEXT.belowBar]); // only "gm": nothing counted
  assert.deepEqual(claim(STRANGER, `/claim ${addr('B')}`), [TEXT.taken]);
  assert.match(claim(MEMBER, `/claim ${addr('a')}`)[0], /^You already hold Vibeswap identity #2, tier member/);
  assert.match(claim(MEMBER, '/claim')[0], /^You already hold Vibeswap identity #2, tier member/);
  assert.match(claim(MEMBER, `/claim ${addr('d')}`)[0], /Only Will can re-bind it to a new address\.$/);
  assert.match(claim(IDENT, '/claim')[0], /^You hold Vibeswap identity #3, tier identity\. The member tier needs 6/);
  assert.equal(registry().rows.length, 3);
  assert.equal(registry().nextSerial, 4);
  assert.equal(requests().length, before, 'no request for a refused claim');
});

test('C6 one queued request per accepted claim, and an identity holder upgrades once the bar is met', () => {
  const [first] = claim(LATE, `/claim ${addr('e')}`); // 6 posts on 3 days, but the first only 4 days ago
  assert.match(first, /tier identity/);
  assert.match(first, /you have 6 on 3 days\./);
  const [up] = claim(LATE, '/claim', { now: NOW + 4 * DAY });
  assert.match(up, /^Upgraded: Vibeswap identity #4 is now tier member\./);
  assert.equal(rowOf(LATE).tier, 'member');
  assert.ok(members().some((e) => String(e.id) === String(LATE) && e.claimed));
  const mints = requests().filter((r) => r.action === 'identity_mint');
  assert.deepEqual(mints.map((r) => r.summary.match(/serial ([\d, ]+) pending/)[1]), ['1', '2', '3', '4', '4']);
  assert.equal(new Set(mints.map((r) => r.id)).size, 5);
  assert.ok(mints.filter((r) => !r.from.isOwner).every((r) => r.needsApproval), 'mints from others wait for Will');
});

test('C7 the mint batch export: exact format, no Telegram data; mark-minted records the ref', () => {
  const script = (name) => fileURLToPath(new URL(`../scripts/${name}`, import.meta.url));
  const out = join(DATA, 'batch-1.json');
  const printed = execFileSync(process.execPath, [script('export-mint-batch.js'), '--out', out], { env: process.env, encoding: 'utf8' });
  assert.match(printed, /^4 record\(s\) pending: wrote /);
  const text = readFileSync(out, 'utf8');
  assert.deepEqual(JSON.parse(text), {
    collection: 'vibeswap-identity-v1',
    records: [
      { serial: 1, holder: addr('0'), tier: 'member' },
      { serial: 2, holder: addr('a'), tier: 'member' },
      { serial: 3, holder: addr('b'), tier: 'identity' },
      { serial: 4, holder: addr('e'), tier: 'member' },
    ],
  });
  for (const id of [OWNER, MEMBER, IDENT, LATE]) assert.ok(!text.includes(String(id)), `batch leaked id ${id}`);
  assert.ok(!/fixture|telegram|username/i.test(text));

  const marked = execFileSync(process.execPath, [script('mark-minted.js'), out, 'cell:fixture-tx-1', '2', '3'], { env: process.env, encoding: 'utf8' });
  assert.match(marked, /marked minted: 2, 3/);
  assert.deepEqual(rowOf(MEMBER).minted.ref, 'cell:fixture-tx-1');
  assert.equal(rowOf(OWNER).minted, null);
});

test('C8 unclaim asks first, then withdraws; a withdrawn account cannot claim again', () => {
  assert.match(run(handleUnclaim, IDENT, '/unclaim')[0], /Send \/unclaim confirm to go ahead\.$/);
  assert.equal(rowOf(IDENT).status, 'active');
  const before = requests().length;
  assert.match(run(handleUnclaim, IDENT, '/unclaim confirm')[0], /^Withdrawn: Vibeswap identity #3 is revoked; the re-tier of its on-chain copy is queued/);
  assert.deepEqual([rowOf(IDENT).tier, rowOf(IDENT).status], ['revoked', 'unclaimed']);
  assert.equal(requests().length, before + 1); // it was minted (C7), so the chain copy needs a re-tier
  assert.deepEqual(claim(IDENT, `/claim ${addr('f')}`), [TEXT.withdrawn]);
  assert.deepEqual(run(handleUnclaim, IDENT, '/unclaim confirm'), [TEXT.noIdentity]);
});

test('C9 Will revokes: off the list at once, re-tier queued; a hand-added entry is reported, not removed', () => {
  const [r] = run(handleIdentityAdmin, OWNER, `/identity revoke ${MEMBER}`);
  assert.match(r, /^Revoked identity #2; the on-chain re-tier is queued for the next mint batch\.$/);
  assert.ok(!members().some((e) => String(e.id) === String(MEMBER)));
  assert.equal(isMember({ id: MEMBER }), false);
  assert.match(run(handleIdentityAdmin, OWNER, `/identity revoke ${MEMBER}`)[0], /^No active identity/);

  // someone Will listed by hand claims: no second entry; a revoke leaves Will's entry and says so
  assert.match(claim(HAND, `/claim ${addr('6')}`)[0], /^Recorded: Vibeswap identity #5, tier member[\s\S]*members list now/);
  assert.equal(members().filter((e) => String(e.id) === String(HAND)).length, 1);
  assert.match(run(handleIdentityAdmin, OWNER, '/identity revoke 5')[0],
    /^Revoked identity #5 \(never minted, nothing on chain\)\. Note: their hand-added members-list entry stays; edit throttle-members\.json to remove it\.$/);
  assert.equal(isMember({ id: HAND }), true);
});

test('C10 Will re-binds once: old serial revoked, new serial, same tier; a second re-bind is refused', () => {
  const [r] = run(handleIdentityAdmin, OWNER, `/identity rebind 4 ${addr('9')}`);
  assert.match(r, /^Re-bound: identity #4 is revoked and #6 \(tier member\) holds 99999999/);
  assert.equal(members().find((e) => String(e.id) === String(LATE)).serial, 6);
  assert.match(run(handleIdentityAdmin, OWNER, `/identity rebind 6 ${addr('8')}`)[0], /its one re-bind is used/);
  assert.match(run(handleIdentityAdmin, OWNER, `/identity rebind ${LATE} ${addr('8')}`)[0], /its one re-bind is used/);
  assert.match(run(handleIdentityAdmin, OWNER, `/identity rebind 1 ${addr('9')}`)[0], /that address is already bound/);
  // pending: #1 (never minted), #2 and #3 (minted, now revoked), #6 (new); #4 and #5 were never on chain
  assert.match(run(handleIdentityAdmin, OWNER, '/identity')[0], /^Claims OPEN\. Active identities 2 \(member 2, identity 0\); withdrawn 3; pending for the next mint batch 4; next serial 7\.$/);
  assert.deepEqual(run(handleIdentityAdmin, OWNER, '/identity close'), ['Claims are closed: only you can claim.']);
  assert.deepEqual(claim(STRANGER, `/claim ${addr('7')}`), [TEXT.notOpen]);
});

test('C11 index.js routes the three commands, and /claim is in no help text or command menu', () => {
  const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf-8');
  assert.match(index, /bot\.command\('claim', \(ctx\) => handleClaim\(ctx\)\);/);
  assert.match(index, /bot\.command\('unclaim', \(ctx\) => handleUnclaim\(ctx\)\);/);
  assert.match(index, /bot\.command\('identity', \(ctx\) => handleIdentityAdmin\(ctx\)\);/);
  const menu = index.slice(index.indexOf('setMyCommands(['), index.indexOf(']);', index.indexOf('setMyCommands([')));
  const help = index.slice(index.indexOf("bot.command('help'"), index.indexOf('});', index.indexOf("bot.command('help'")));
  for (const block of [menu, help]) assert.doesNotMatch(block, /\/?\b(un)?claim\b|command: 'identity'/);
});
