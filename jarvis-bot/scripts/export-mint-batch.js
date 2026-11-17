#!/usr/bin/env node
// Export the Vibeswap identity rows pending for the next mint batch (unminted, or re-tiered since the
// last confirmed mint) from data/identity-registry.json, in the format the Noesis mint tool reads:
//   {"collection":"vibeswap-identity-v1","records":[{"serial":1,"holder":"<64 hex>","tier":"member"}]}
// tier is "identity", "member" or "revoked". No Telegram id, username, name or chat text, ever.
//
//   node scripts/export-mint-batch.js [--out <file>]     (default <DATA_DIR>/identity-mint-batch.json)
//
// After the session confirms the mint on chain, record it:
//   node scripts/mark-minted.js <batch file> <tx or cell ref> [serial ...]

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { loadRegistry, mintBatch } from '../src/identity-registry.js';
import { config } from '../src/config.js';

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const out = resolve(outIdx >= 0 && argv[outIdx + 1] ? argv[outIdx + 1] : join(config.dataDir, 'identity-mint-batch.json'));

const batch = mintBatch(loadRegistry());
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(batch, null, 2) + '\n');
console.log(`${batch.records.length} record(s) pending: wrote ${out}`);
