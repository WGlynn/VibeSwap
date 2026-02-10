#!/usr/bin/env node
/**
 * Updates the build version in index.html before each build.
 * This ensures browsers always fetch fresh assets after deployment.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = resolve(__dirname, '../index.html');

const html = readFileSync(indexPath, 'utf8');
const newVersion = `v${Date.now()}`;

// Update the build comment
const updated = html.replace(
  /<!-- Build: v\d+ -->/,
  `<!-- Build: ${newVersion} -->`
);

writeFileSync(indexPath, updated);
console.log(`✓ Build version updated to ${newVersion}`);
