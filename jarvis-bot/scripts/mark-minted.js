#!/usr/bin/env node
// Record that a Vibeswap identity mint batch is on chain, once the session has confirmed it.
//
//   node scripts/mark-minted.js <batch file> <tx or cell ref> [serial ...]
//
// Marks every record of the batch file (or only the serials listed) as minted with the tier that batch
// carried, storing the reference given. A row whose tier changed after the export stays pending, so the
// next batch carries the change. Prints serials only.

import { readFileSync } from 'fs';
import { loadRegistry, saveRegistry, markMinted, COLLECTION } from '../src/identity-registry.js';

const [file, ref, ...only] = process.argv.slice(2);
if (!file || !ref) {
  console.error('usage: node scripts/mark-minted.js <batch file> <tx or cell ref> [serial ...]');
  process.exit(2);
}
const batch = JSON.parse(readFileSync(file, 'utf8'));
if (batch.collection !== COLLECTION || !Array.isArray(batch.records)) {
  console.error(`not a ${COLLECTION} batch: ${file}`);
  process.exit(2);
}
const pick = only.length ? new Set(only.map(Number)) : null;
const records = pick ? batch.records.filter((r) => pick.has(r.serial)) : batch.records;
const reg = loadRegistry();
const { marked, unknown } = markMinted(reg, records, ref);
saveRegistry(reg);
console.log(`marked minted: ${marked.join(', ') || 'none'}`);
if (unknown.length) {
  console.error(`not marked (no such serial, or the holder differs): ${unknown.join(', ')}`);
  process.exit(1);
}
