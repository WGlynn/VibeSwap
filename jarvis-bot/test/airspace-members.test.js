// Tests for members under the airspace throttle (slice A4 of Desktop/Research/vibeswap-sbt/DESIGN.md,
// 2026-11-17). Before this a listed member skipped the whole airspace check, so Will's noise flag
// ("slop", "stop") did not reach them. Now every member is under the noise flag; entries written by a
// Vibeswap identity claim are matched by id only and keep the saturation limit; entries Will added by
// hand keep today's exemption apart from the noise flag. Ids and usernames are synthetic; the members
// file lives in a temp DATA_DIR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dir = mkdtempSync(join(tmpdir(), 'airspace-members-'));
process.env.DATA_DIR = dir;
const CLAIMED_AT = '2026-11-17T12:00:00.000Z';
writeFileSync(join(dir, 'throttle-members.json'), JSON.stringify({
  members: [
    { id: 111, username: 'fixture_hand' },
    { id: 222, username: 'fixture_limited', throttleExempt: false },
    { id: '333', claimed: CLAIMED_AT, serial: 1 },
    { id: '444', username: 'fixture_claimed', claimed: CLAIMED_AT, serial: 2 }, // a username here is ignored
  ],
}));

const A = await import('../src/airspace-monitor.js');
const { recordMessage, recordBotResponse, checkAirspace, flagNoise, throttleMemberClass, isMember, isThrottleMember } = A;
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf-8');

const HAND = 111, LIMITED = 222, CLAIMED = 333, OTHER = 555, NEWCOMER = 666;
const withRoll = (roll, fn) => { const saved = Math.random; Math.random = () => roll; try { return fn(); } finally { Math.random = saved; } };
const check = (chat, id, from = { id }) => withRoll(0.99, () => checkAirspace(chat, id, 250, throttleMemberClass(from)));

// `id` sends 6 of 7 messages (86%) in a big chat.
function dominates(chat, id) {
  for (let i = 0; i < 6; i++) recordMessage(chat, id);
  recordMessage(chat, OTHER);
}

test('M1 the member classes: hand-added by id or username; claimed by id only; limited is not exempt', () => {
  assert.equal(throttleMemberClass({ id: HAND }), 'listed');
  assert.equal(throttleMemberClass({ id: 9, username: 'FIXTURE_HAND' }), 'listed');
  assert.equal(throttleMemberClass({ id: CLAIMED }), 'claimed');
  assert.equal(throttleMemberClass({ id: 444 }), 'claimed');
  assert.equal(throttleMemberClass({ id: 9, username: 'fixture_claimed' }), null);
  assert.equal(isMember({ id: 9, username: 'fixture_claimed' }), false);
  assert.equal(throttleMemberClass({ id: LIMITED }), null);
  assert.equal(isMember({ id: LIMITED }), true);
  assert.equal(throttleMemberClass({ id: OTHER }), null);
  assert.equal(isThrottleMember({ id: CLAIMED }), true);
  assert.equal(isThrottleMember({ id: LIMITED }), false);
});

test('M2 the noise flag reaches every member, hand-added and claimed', () => {
  const chat = -7001;
  dominates(chat, OTHER);
  flagNoise(chat);
  for (const id of [HAND, CLAIMED, LIMITED, OTHER]) {
    assert.deepEqual(check(chat, id), { shouldRespond: false, reason: 'noise_flagged', probability: 0.0 }, `member ${id}`);
  }
});

test('M3 the noise flag holds even in a chat with under 5 messages this hour', () => {
  const chat = -7002;
  recordMessage(chat, HAND);
  flagNoise(chat);
  assert.equal(check(chat, HAND).reason, 'noise_flagged');
  assert.equal(check(chat, NEWCOMER).reason, 'noise_flagged');
});

test('M4 claimed members skip dominance but keep the saturation limit; hand-added skip both', () => {
  const chat = -7003;
  dominates(chat, CLAIMED);
  assert.deepEqual(check(chat, CLAIMED), { shouldRespond: true, reason: 'claimed_member', probability: 1.0 });
  for (let i = 0; i < 6; i++) recordMessage(chat, HAND);
  for (let i = 0; i < 8; i++) { recordBotResponse(chat, CLAIMED); recordBotResponse(chat, HAND); }
  assert.deepEqual(check(chat, CLAIMED), { shouldRespond: false, reason: 'bot_saturated (8 responses this hour)', probability: 0.15 });
  assert.deepEqual(check(chat, HAND), { shouldRespond: true, reason: 'member', probability: 1.0 });
  // a non-member with the same share is throttled as before
  const other = -7004;
  dominates(other, NEWCOMER);
  assert.equal(check(other, NEWCOMER).reason, 'heavy_dominance (86% of messages)');
  assert.equal(check(other, NEWCOMER).shouldRespond, false);
});

test('M5 a claim or a revoke applies at once, without waiting for the minute re-read', () => {
  const chat = -7005;
  dominates(chat, NEWCOMER);
  assert.equal(check(chat, NEWCOMER).shouldRespond, false);
  assert.equal(A.addClaimedMember(NEWCOMER, 9), true);
  assert.equal(check(chat, NEWCOMER).reason, 'claimed_member');
  const entry = JSON.parse(readFileSync(join(dir, 'throttle-members.json'), 'utf8')).members.find((m) => m.id === String(NEWCOMER));
  assert.deepEqual(Object.keys(entry).sort(), ['claimed', 'id', 'serial']);
  assert.equal(A.removeClaimedMember(NEWCOMER), true);
  assert.equal(check(chat, NEWCOMER).shouldRespond, false);
  // a hand-added entry is never removed by an unclaim or a revoke
  assert.equal(A.removeClaimedMember(HAND), true);
  assert.equal(throttleMemberClass({ id: HAND }), 'listed');
});

test('M6 index.js sends every member through checkAirspace with their class', () => {
  const index = src('index.js');
  // (the block now also feeds today's decision to the engage gate, test/engage-decide.test.js)
  assert.match(index, /if \(isGroup && isAddressed\) \{\s+\/\/ BOT-004/);
  assert.doesNotMatch(index, /isAddressed && !isThrottleMember/);
  assert.match(index, /const memberClass = ownerMsg \? null : throttleMemberClass\(ctx\.from\);/);
  assert.match(index, /checkAirspace\(ctx\.chat\.id, ctx\.from\.id, memberCount, memberClass\)/);
});
