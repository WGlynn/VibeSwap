// ============ Vibeswap identity registry (2026-11-17) ============
//
// The bot's private record of who claimed a Vibeswap chat identity, and the source of truth for the
// soulbound identity cells on Noesis (Desktop/Research/vibeswap-sbt/DESIGN.md, slice A2). The chain is a
// mirror: membership starts at claim, here, and the session mints from this file.
//
// File: <dataDir>/identity-registry.json (data/ is gitignored; it holds Telegram ids). Shape:
//   { claimsOpen: false, nextSerial: 1, rows: [row] }
//   row = { serial, telegramId, address, tier, status, claimedAt, updatedAt, rebinds, minted }
//     serial      monotonic integer, never reused (nextSerial only grows)
//     telegramId  string; ctx.from.id of the claimant (only that account can claim for itself)
//     address     the Noesis address, 64 lowercase hex characters (format below)
//     tier        'identity' | 'member' | 'revoked'
//     status      'active' | 'unclaimed' (the holder withdrew) | 'revoked' (Will) | 'rebound' (replaced
//                 by a new serial when Will moved the identity to a new address)
//     rebinds     how many times this identity was re-bound (at most 1, and only through Will)
//     minted      null, or { tier, ref, at }: the tier the last confirmed mint carried and its tx/cell ref
//
// CLAIMS_OPEN: the "claimsOpen" field of this file. Missing or anything but true means closed: only Will
// can claim (for testing). Will opens or closes it with the owner command "/identity open" or
// "/identity close" (identity-claim.js); editing the file works too.
//
// Rules held here: one active identity per Telegram id; one identity per address, ever (a withdrawn
// identity keeps its address, since its cell carries it); one re-bind per identity, through Will.
// A row is pending for the next mint batch when its tier differs from the tier last minted, except a
// row that was never minted and is already revoked (nothing on chain to revoke).
//
// Writes are atomic (a temp file, then a rename). A registry that exists but does not parse is an
// error, never an empty registry: starting over would reuse serials.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { config } from './config.js';

export const REGISTRY_FILE = 'identity-registry.json';
export const COLLECTION = 'vibeswap-identity-v1';
export const TIERS = ['identity', 'member', 'revoked'];
export const MAX_REBINDS = 1;

export const registryPath = (dataDir = config.dataDir) => join(dataDir, REGISTRY_FILE);

// ============ Noesis address ============
// A Noesis address is 32 bytes (the XMSS public root, noesis onchain/noesis-core/src/lib.rs:1117
// keygen_address -> [u8; 32]) written as hex. The node decodes it with hex32 (noesis node/src/rpc.rs:67-71:
// hex_decode, then exactly 32 bytes); hex_decode (rpc.rs:60-65) takes lower or upper case and no prefix,
// and hex_encode (rpc.rs:52-58) writes lowercase. So: exactly 64 hex characters, no "0x", stored lowercase.
// One deliberate difference: Rust's from_str_radix lets a "+" sign through in a pair ("+f"), which the
// node would accept by accident; this rejects it. Returns the canonical address or null.
export function parseNoesisAddress(input) {
  const s = String(input ?? '');
  return /^[0-9a-fA-F]{64}$/.test(s) ? s.toLowerCase() : null;
}

// ============ Load and save ============

export function emptyRegistry() {
  return { claimsOpen: false, nextSerial: 1, rows: [] };
}

export function loadRegistry(path = registryPath()) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return emptyRegistry();
    throw err;
  }
  const reg = JSON.parse(text); // throws on a corrupt file, on purpose
  if (!reg || !Array.isArray(reg.rows) || !Number.isInteger(reg.nextSerial)) {
    throw new Error(`${path} is not an identity registry`);
  }
  return reg;
}

export function saveRegistry(reg, path = registryPath()) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n');
  renameSync(tmp, path);
}

export const claimsOpen = (reg) => reg?.claimsOpen === true;

// ============ Lookups ============

export const rowBySerial = (reg, serial) => reg.rows.find((r) => r.serial === Number(serial)) || null;

// The person's current identity: their latest row that was not replaced by a re-bind.
export function currentRow(reg, telegramId) {
  const id = String(telegramId);
  const rows = reg.rows.filter((r) => r.telegramId === id && r.status !== 'rebound');
  return rows.length ? rows[rows.length - 1] : null;
}

export const addressHolder = (reg, address) => reg.rows.find((r) => r.address === address) || null;

// ============ Changes (each mutates reg; the caller saves) ============

const iso = (now) => new Date(now).toISOString();

function newRow(reg, { telegramId, address, tier, now, rebinds = 0 }) {
  const row = {
    serial: reg.nextSerial,
    telegramId: String(telegramId),
    address,
    tier,
    status: 'active',
    claimedAt: iso(now),
    updatedAt: iso(now),
    rebinds,
    minted: null,
  };
  reg.nextSerial += 1;
  reg.rows.push(row);
  return row;
}

// Returns { row } or { error: 'bad_address' | 'bad_tier' | 'already_claimed' | 'withdrawn' | 'address_taken', row? }.
export function addClaim(reg, { telegramId, address, tier, now = Date.now() }) {
  const addr = parseNoesisAddress(address);
  if (!addr) return { error: 'bad_address' };
  if (tier !== 'identity' && tier !== 'member') return { error: 'bad_tier' };
  const existing = currentRow(reg, telegramId);
  if (existing) return { error: existing.status === 'active' ? 'already_claimed' : 'withdrawn', row: existing };
  if (addressHolder(reg, addr)) return { error: 'address_taken' };
  return { row: newRow(reg, { telegramId, address: addr, tier, now }) };
}

// identity -> member when the holder later clears the member bar. Returns the row, or null if it is
// not an active identity-tier row.
export function upgradeToMember(reg, serial, now = Date.now()) {
  const row = rowBySerial(reg, serial);
  if (!row || row.status !== 'active' || row.tier !== 'identity') return null;
  row.tier = 'member';
  row.updatedAt = iso(now);
  return row;
}

// The holder withdrew ('unclaimed') or Will revoked it ('revoked'). Either way the tier becomes revoked,
// which the next mint batch carries to the chain. Returns the row, or null if it is not active.
export function withdraw(reg, serial, status, now = Date.now()) {
  if (status !== 'unclaimed' && status !== 'revoked') throw new Error(`bad withdraw status ${status}`);
  const row = rowBySerial(reg, serial);
  if (!row || row.status !== 'active') return null;
  row.status = status;
  row.tier = 'revoked';
  row.updatedAt = iso(now);
  return row;
}

// Will moves an active identity to a new address, once. A cell's holder can never change, so the old
// serial is revoked and a new serial carries the same tier to the new address.
// Returns { old, row } or { error: 'not_active' | 'rebind_used' | 'bad_address' | 'address_taken' }.
export function rebind(reg, serial, newAddress, now = Date.now()) {
  const old = rowBySerial(reg, serial);
  if (!old || old.status !== 'active') return { error: 'not_active' };
  if ((old.rebinds || 0) >= MAX_REBINDS) return { error: 'rebind_used' };
  const addr = parseNoesisAddress(newAddress);
  if (!addr) return { error: 'bad_address' };
  if (addressHolder(reg, addr)) return { error: 'address_taken' };
  const tier = old.tier;
  old.status = 'rebound';
  old.tier = 'revoked';
  old.updatedAt = iso(now);
  const row = newRow(reg, { telegramId: old.telegramId, address: addr, tier, now, rebinds: (old.rebinds || 0) + 1 });
  return { old, row };
}

// ============ Mint batches ============

export function isPending(row) {
  const mintedTier = row.minted?.tier ?? null;
  if (mintedTier === row.tier) return false;
  if (mintedTier === null && row.tier === 'revoked') return false; // never on chain: nothing to revoke
  return true;
}

export const pendingRows = (reg) => reg.rows.filter(isPending).sort((a, b) => a.serial - b.serial);

// The batch the Noesis mint tool reads (Phase B). Exactly these fields: no Telegram id, username, name
// or chat text, ever.
export function mintBatch(reg) {
  return {
    collection: COLLECTION,
    records: pendingRows(reg).map((r) => ({ serial: r.serial, holder: r.address, tier: r.tier })),
  };
}

// After the session confirms a mint: record, per serial, the tier that batch carried (not the current
// tier, which may have moved since the export) and the tx/cell reference. A row whose tier moved after
// the export stays pending. Returns { marked: [serial], unknown: [serial] }.
export function markMinted(reg, records, ref, now = Date.now()) {
  if (!ref || !String(ref).trim()) throw new Error('a tx or cell reference is required');
  const marked = [];
  const unknown = [];
  for (const rec of records) {
    const row = rowBySerial(reg, rec.serial);
    if (!row || row.address !== rec.holder || !TIERS.includes(rec.tier)) { unknown.push(rec.serial); continue; }
    row.minted = { tier: rec.tier, ref: String(ref).trim(), at: iso(now) };
    marked.push(rec.serial);
  }
  return { marked, unknown };
}

// Counts for Will's status view: no ids.
export function summary(reg) {
  const by = (k, v) => reg.rows.filter((r) => r[k] === v).length;
  return {
    claimsOpen: claimsOpen(reg),
    active: by('status', 'active'),
    member: reg.rows.filter((r) => r.status === 'active' && r.tier === 'member').length,
    identity: reg.rows.filter((r) => r.status === 'active' && r.tier === 'identity').length,
    withdrawn: by('status', 'unclaimed') + by('status', 'revoked'),
    pending: pendingRows(reg).length,
    nextSerial: reg.nextSerial,
  };
}
