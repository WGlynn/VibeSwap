#!/usr/bin/env node

/**
 * ============================================================
 * Weekly Digest — Auto-generate weekly summary from git + stats
 * ============================================================
 *
 * Usage:
 *   node scripts/weekly-digest.js            # this week
 *   node scripts/weekly-digest.js --post     # format for Telegram
 *   node scripts/weekly-digest.js --tweet    # format as tweet thread
 *
 * Generates:
 *   - Commit summary (count, top contributors)
 *   - Files changed by area (contracts, frontend, docs, etc.)
 *   - New pages/components added
 *   - New docs/essays written
 *   - Stats comparison vs last week
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'docs', 'bd-output');

function run(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  } catch { return ''; }
}

function getWeeklyDigest() {
  const since = '7 days ago';
  const digest = {};

  // Commit count
  digest.commits = parseInt(run(`git rev-list --count --since="${since}" HEAD`)) || 0;

  // Files changed — aggregate from git log --shortstat
  const shortStats = run(`git log --since="${since}" --shortstat --pretty=format: HEAD`);
  let totalIns = 0, totalDel = 0;
  for (const line of shortStats.split('\n')) {
    const ins = line.match(/(\d+) insertion/);
    const del = line.match(/(\d+) deletion/);
    if (ins) totalIns += parseInt(ins[1]);
    if (del) totalDel += parseInt(del[1]);
  }
  digest.insertions = totalIns;
  digest.deletions = totalDel;

  // Changed files by area
  const changedFiles = run(`git log --since="${since}" --name-only --pretty=format: HEAD`).split('\n').filter(Boolean);
  // Deduplicate
  const uniqueFiles = [...new Set(changedFiles)];
  digest.areas = {};
  for (const f of uniqueFiles) {
    const area = f.split('/')[0];
    digest.areas[area] = (digest.areas[area] || 0) + 1;
  }

  // New files this week
  const newFilesRaw = run(`git log --since="${since}" --diff-filter=A --name-only --pretty=format:"" HEAD`);
  const newFiles = newFilesRaw.split('\n').filter(f => f && f.length > 0 && !f.startsWith('"'));
  digest.newFiles = newFiles.length;
  digest.newPages = newFiles.filter(f => f.includes('frontend/src/components/') && f.endsWith('Page.jsx')).map(f => path.basename(f, '.jsx'));
  digest.newDocs = newFiles.filter(f => f.startsWith('docs/') && f.endsWith('.md')).map(f => path.basename(f, '.md'));
  digest.newTweets = newFiles.filter(f => f.startsWith('tweet repo/')).length;
  digest.newContracts = newFiles.filter(f => f.startsWith('contracts/') && f.endsWith('.sol')).length;
  digest.newTests = newFiles.filter(f => f.startsWith('test/') && f.endsWith('.sol')).length;

  // Recent commit messages
  digest.recentMessages = run(`git log --since="${since}" --oneline HEAD 2>/dev/null`).split('\n').filter(Boolean).slice(0, 15);

  // Total stats (current)
  try {
    const components = fs.readdirSync(path.join(ROOT, 'frontend/src/components')).filter(f => f.endsWith('.jsx'));
    digest.totalPages = components.length;
  } catch { digest.totalPages = '?'; }

  digest.totalCommits = parseInt(run('git rev-list --count HEAD')) || '?';

  return digest;
}

function formatMarkdown(d) {
  const lines = [];
  lines.push(`# VibeSwap Weekly Digest`);
  lines.push(`*Week ending ${new Date().toISOString().split('T')[0]}*`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push(`- **${d.commits}** commits this week`);
  lines.push(`- **+${d.insertions.toLocaleString()}** / **-${d.deletions.toLocaleString()}** lines`);
  lines.push(`- **${d.newFiles}** new files created`);
  lines.push('');

  if (Object.keys(d.areas).length > 0) {
    lines.push(`## Changes by Area`);
    const sorted = Object.entries(d.areas).sort((a, b) => b[1] - a[1]);
    for (const [area, count] of sorted) {
      lines.push(`- **${area}**: ${count} files`);
    }
    lines.push('');
  }

  if (d.newPages.length > 0) {
    lines.push(`## New Pages`);
    d.newPages.forEach(p => lines.push(`- ${p}`));
    lines.push('');
  }

  if (d.newDocs.length > 0) {
    lines.push(`## New Docs`);
    d.newDocs.forEach(p => lines.push(`- ${p}`));
    lines.push('');
  }

  if (d.newTweets > 0) lines.push(`- **${d.newTweets}** new tweets drafted`);
  if (d.newContracts > 0) lines.push(`- **${d.newContracts}** new contracts`);
  if (d.newTests > 0) lines.push(`- **${d.newTests}** new test files`);
  if (d.newTweets > 0 || d.newContracts > 0 || d.newTests > 0) lines.push('');

  lines.push(`## Totals`);
  lines.push(`- ${d.totalPages} frontend components`);
  lines.push(`- ${d.totalCommits} total commits`);
  lines.push('');

  if (d.recentMessages.length > 0) {
    lines.push(`## Recent Commits`);
    d.recentMessages.forEach(m => lines.push(`- ${m}`));
    lines.push('');
  }

  return lines.join('\n');
}

function formatTelegram(d) {
  const lines = [];
  lines.push(`**VibeSwap Weekly Digest**`);
  lines.push(`Week of ${new Date().toISOString().split('T')[0]}`);
  lines.push('');
  lines.push(`${d.commits} commits | +${d.insertions.toLocaleString()} lines | ${d.newFiles} new files`);
  lines.push('');

  if (d.newPages.length > 0) {
    lines.push(`New pages: ${d.newPages.join(', ')}`);
  }
  if (d.newDocs.length > 0) {
    lines.push(`New docs: ${d.newDocs.slice(0, 5).join(', ')}${d.newDocs.length > 5 ? ` +${d.newDocs.length - 5} more` : ''}`);
  }
  if (d.newTweets > 0) lines.push(`${d.newTweets} new tweets drafted`);
  if (d.newContracts > 0) lines.push(`${d.newContracts} new contracts`);

  lines.push('');
  lines.push(`Totals: ${d.totalPages} components | ${d.totalCommits} commits`);
  lines.push('');
  lines.push(`Live: https://frontend-jade-five-87.vercel.app`);
  lines.push(`Code: https://github.com/wglynn/vibeswap`);

  return lines.join('\n');
}

function formatTweetThread(d) {
  const tweets = [];

  tweets.push(`VibeSwap weekly build report:\n\n${d.commits} commits\n+${d.insertions.toLocaleString()} lines of code\n${d.newFiles} new files\n\nWe don't stop. Thread:`);

  if (d.newPages.length > 0) {
    tweets.push(`New pages shipped:\n${d.newPages.map(p => `- ${p}`).join('\n')}\n\nEvery page: lazy-loaded, animated, keyboard-navigable.`);
  }

  if (d.newDocs.length > 0) {
    tweets.push(`New docs & essays:\n${d.newDocs.slice(0, 8).map(p => `- ${p}`).join('\n')}${d.newDocs.length > 8 ? `\n+${d.newDocs.length - 8} more` : ''}`);
  }

  if (d.newTweets > 0 || d.newContracts > 0) {
    let parts = [];
    if (d.newContracts > 0) parts.push(`${d.newContracts} new contracts`);
    if (d.newTweets > 0) parts.push(`${d.newTweets} tweet drafts`);
    tweets.push(parts.join(', ') + ' this week.');
  }

  tweets.push(`Running totals:\n\n${d.totalPages} frontend components\n${d.totalCommits} commits\n$0 VC funding\n\nThe cave doesn't have a deadline. It has momentum.`);

  return tweets.join('\n\n---\n\n');
}

// Main
const args = process.argv.slice(2);
const d = getWeeklyDigest();

let output;
if (args.includes('--post') || args.includes('--telegram')) {
  output = formatTelegram(d);
} else if (args.includes('--tweet')) {
  output = formatTweetThread(d);
} else {
  output = formatMarkdown(d);
}

console.log(output);

// Save markdown version
const outFile = path.join(OUTPUT, `weekly-digest-${new Date().toISOString().split('T')[0]}.md`);
if (!fs.existsSync(OUTPUT)) fs.mkdirSync(OUTPUT, { recursive: true });
fs.writeFileSync(outFile, formatMarkdown(d));
console.log(`\nSaved to ${outFile}`);
