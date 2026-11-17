// Tests for the Vibeswap identity registry (src/identity-registry.js, slice A2 of
// Desktop/Research/vibeswap-sbt/DESIGN.md). Ids and addresses are synthetic; the file lives in a temp dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dir = mkdtempSync(join(tmpdir(), 'identity-registry-'));
process.env.DATA_DIR = dir;
const R = await import('../src/identity-registry.js');

const addr = (c) => c.repeat(64);
const A = addr('a'), B = addr('b'), C = addr('c'), D = addr('d');
const NOW = Date.UTC(2026, 10, 17, 12);

test('a Noesis address is exactly 64 hex characters, no 0x, stored lowercase', () => {
  assert.equal(R.parseNoesisAddress(A), A);
  assert.equal(R.parseNoesisAddress('AB'.repeat(32)), 'ab'.repeat(32));
  for (const bad of ['0x' + A.slice(2), '0x' + A, A.slice(1), A + 'a', 'g'.repeat(64), '+f'.repeat(32), ` ${A}`, '', null, undefined]) {
    assert.equal(R.parseNoesisAddress(bad), null, String(bad));
  }
});

test('one identity per Telegram id and one per address; serials are monotonic', () => {
  const reg = R.emptyRegistry();
  const one = R.addClaim(reg, { telegramId: 101, address: A, tier: 'member', now: NOW });
  assert.equal(one.row.serial, 1);
  assert.equal(one.row.telegramId, '101');
  assert.equal(R.addClaim(reg, { telegramId: 101, address: B, tier: 'identity', now: NOW }).error, 'already_claimed');
  assert.equal(R.addClaim(reg, { telegramId: 102, address: A.toUpperCase(), tier: 'identity', now: NOW }).error, 'address_taken');
  assert.equal(R.addClaim(reg, { telegramId: 102, address: 'nope', tier: 'identity' }).error, 'bad_address');
  assert.equal(R.addClaim(reg, { telegramId: 102, address: B, tier: 'revoked' }).error, 'bad_tier');
  assert.equal(R.addClaim(reg, { telegramId: 102, address: B, tier: 'identity', now: NOW }).row.serial, 2);
  assert.equal(reg.nextSerial, 3);
});

test('a withdrawn identity blocks a new claim, keeps its address, and its serial is never reused', () => {
  const reg = R.emptyRegistry();
  R.addClaim(reg, { telegramId: 201, address: A, tier: 'identity', now: NOW });
  const w = R.withdraw(reg, 1, 'unclaimed', NOW);
  assert.deepEqual({ tier: w.tier, status: w.status }, { tier: 'revoked', status: 'unclaimed' });
  assert.equal(R.withdraw(reg, 1, 'revoked', NOW), null); // already withdrawn
  assert.equal(R.addClaim(reg, { telegramId: 201, address: B, tier: 'identity' }).error, 'withdrawn');
  assert.equal(R.addClaim(reg, { telegramId: 202, address: A, tier: 'identity' }).error, 'address_taken');
  assert.equal(R.addClaim(reg, { telegramId: 202, address: B, tier: 'identity', now: NOW }).row.serial, 2);
});

test('upgrade identity to member; re-bind once, through a new serial', () => {
  const reg = R.emptyRegistry();
  R.addClaim(reg, { telegramId: 301, address: A, tier: 'identity', now: NOW });
  assert.equal(R.upgradeToMember(reg, 1, NOW).tier, 'member');
  assert.equal(R.upgradeToMember(reg, 1, NOW), null); // already a member
  assert.equal(R.rebind(reg, 1, A).error, 'address_taken');
  assert.equal(R.rebind(reg, 1, 'zz').error, 'bad_address');
  const r = R.rebind(reg, 1, B, NOW);
  assert.deepEqual({ status: r.old.status, tier: r.old.tier }, { status: 'rebound', tier: 'revoked' });
  assert.deepEqual({ serial: r.row.serial, tier: r.row.tier, address: B, rebinds: r.row.rebinds },
    { serial: 2, tier: 'member', address: B, rebinds: 1 });
  assert.equal(R.currentRow(reg, 301).serial, 2);
  assert.equal(R.rebind(reg, 2, C).error, 'rebind_used');
  assert.equal(R.rebind(reg, 1, C).error, 'not_active');
});

test('pending rows and the mint batch: exact format, no Telegram id', () => {
  const reg = R.emptyRegistry();
  R.addClaim(reg, { telegramId: 401, address: A, tier: 'member', now: NOW });
  R.addClaim(reg, { telegramId: 402, address: B, tier: 'identity', now: NOW });
  R.addClaim(reg, { telegramId: 403, address: C, tier: 'identity', now: NOW });
  R.withdraw(reg, 3, 'unclaimed', NOW); // never minted, already revoked: nothing to put on chain
  const batch = R.mintBatch(reg);
  assert.deepEqual(batch, {
    collection: 'vibeswap-identity-v1',
    records: [{ serial: 1, holder: A, tier: 'member' }, { serial: 2, holder: B, tier: 'identity' }],
  });
  assert.deepEqual(Object.keys(batch), ['collection', 'records']);
  assert.ok(!JSON.stringify(batch).includes('401'));

  // the session confirms; then a re-tier and a revoke make rows pending again
  assert.deepEqual(R.markMinted(reg, batch.records, 'cell:0xfeed', NOW), { marked: [1, 2], unknown: [] });
  assert.deepEqual(R.mintBatch(reg).records, []);
  R.upgradeToMember(reg, 2, NOW);
  R.withdraw(reg, 1, 'revoked', NOW);
  const next = R.mintBatch(reg);
  assert.deepEqual(next.records, [{ serial: 1, holder: A, tier: 'revoked' }, { serial: 2, holder: B, tier: 'member' }]);

  // a tier that moves after the export stays pending after the mark
  R.rebind(reg, 2, D, NOW);
  assert.deepEqual(R.markMinted(reg, next.records, 'cell:0xbeef', NOW), { marked: [1, 2], unknown: [] });
  assert.deepEqual(R.mintBatch(reg).records, [{ serial: 2, holder: B, tier: 'revoked' }, { serial: 4, holder: D, tier: 'member' }]);
  assert.deepEqual(R.markMinted(reg, [{ serial: 99, holder: A, tier: 'member' }, { serial: 4, holder: A, tier: 'member' }], 'x', NOW).unknown, [99, 4]);
  assert.throws(() => R.markMinted(reg, [], ' '), /reference is required/);
});

test('save is atomic and round-trips; a missing file is empty; a corrupt one throws', () => {
  const path = R.registryPath(dir);
  assert.deepEqual(R.loadRegistry(path), { claimsOpen: false, nextSerial: 1, rows: [] });
  const reg = R.emptyRegistry();
  R.addClaim(reg, { telegramId: 501, address: A, tier: 'identity', now: NOW });
  R.saveRegistry(reg, path);
  assert.deepEqual(R.loadRegistry(path), reg);
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.tmp')), []);
  assert.equal(R.claimsOpen(R.loadRegistry(path)), false);
  writeFileSync(path, '{"rows": [');
  assert.throws(() => R.loadRegistry(path));
  writeFileSync(path, '{}');
  assert.throws(() => R.loadRegistry(path), /not an identity registry/);
  R.saveRegistry(reg, path);
  assert.match(readFileSync(path, 'utf8'), /"nextSerial": 2/);
});

test('summary counts without ids', () => {
  const reg = R.emptyRegistry();
  R.addClaim(reg, { telegramId: 601, address: A, tier: 'member', now: NOW });
  R.addClaim(reg, { telegramId: 602, address: B, tier: 'identity', now: NOW });
  R.addClaim(reg, { telegramId: 603, address: C, tier: 'identity', now: NOW });
  R.withdraw(reg, 3, 'revoked', NOW);
  assert.deepEqual(R.summary(reg), { claimsOpen: false, active: 2, member: 1, identity: 1, withdrawn: 1, pending: 2, nextSerial: 4 });
});
