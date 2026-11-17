// Tests for the member tier (Will 2026-11-17). A chat regular asked for access to Jarvis; Will: "yes but
// limited". Full authorization carries the admin commands (git, persona, model, shards), so listed
// members instead get a bigger DM budget than anonymous users (50k tokens a day vs 25k) and no commands.
// An entry with "throttleExempt": false gets only that budget and stays under the group throttle.
// The members file lives in a temp DATA_DIR, so the real data/throttle-members.json is never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dir = mkdtempSync(join(tmpdir(), 'member-tier-'));
process.env.DATA_DIR = dir;
writeFileSync(join(dir, 'throttle-members.json'), JSON.stringify({
  members: [
    { id: 111, username: 'regular' },
    { id: 222, username: 'LimitedOne', throttleExempt: false },
  ],
}));

const { isMember, isThrottleMember } = await import('../src/airspace-monitor.js');
const { getUserTier, checkTieredBudget } = await import('../src/compute-economics.js');
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf-8');

test('a listed member gets the member tier; authorized and owner still win', () => {
  assert.equal(getUserTier('1', { isMember: true }), 'member');
  assert.equal(getUserTier('1', { isMember: true, isAuthorized: true }), 'authorized');
  assert.equal(getUserTier('1', { isMember: true, isOwner: true }), 'owner');
  assert.equal(getUserTier('1', {}), 'anonymous');
});

test('the member budget floor sits between anonymous and authorized', () => {
  const anon = checkTieredBudget('9001', 'anonymous');
  const member = checkTieredBudget('9002', 'member');
  const authorized = checkTieredBudget('9003', 'authorized');
  assert.equal(anon.budget, 25_000);
  assert.ok(member.budget >= 50_000 && member.budget < authorized.budget, `member budget ${member.budget}`);
  assert.ok(authorized.budget >= 100_000);
});

test('every listed entry is a member; only entries not marked throttleExempt:false skip the throttle', () => {
  assert.equal(isMember({ id: 111 }), true);
  assert.equal(isThrottleMember({ id: 111 }), true);
  // limited: member budget, still throttled in groups (matched by id and, case-blind, by username)
  assert.equal(isMember({ id: 222 }), true);
  assert.equal(isThrottleMember({ id: 222 }), false);
  assert.equal(isMember({ id: 5, username: 'limitedone' }), true);
  assert.equal(isThrottleMember({ id: 5, username: 'limitedone' }), false);
  // not listed
  assert.equal(isMember({ id: 333, username: 'stranger' }), false);
  assert.equal(isThrottleMember({ id: 333 }), false);
  assert.equal(isMember(null), false);
});

test('the DM path passes membership into the tier, and /start no longer says "Not authorized" in a DM', () => {
  const index = src('index.js');
  assert.match(index, /getUserTier\(userId, \{[\s\S]{0,200}isMember: isMember\(ctx\.from\)/);
  const start = index.slice(index.indexOf("bot.command('start'"), index.indexOf("bot.command('speak'"));
  assert.match(start, /if \(ctx\.chat\?\.type !== 'private'\) return unauthorized\(ctx\);/);
  assert.match(start, /Chat here is open, with a daily allowance/);
});
