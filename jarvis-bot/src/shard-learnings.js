// ============ Cross-Shard Learning Bus — Git-Synced JSONL ============
//
// Serializes high-value learnings to .claude/shard_learnings.jsonl
// Append-only, git-synced, readable by any session that pulls the repo.
//
// Not new infrastructure — just a new transport layer for existing
// knowledge chain signals. Claude Code sessions can't participate in
// HTTP epoch sync, but they CAN read/write git-tracked JSONL.
// ============

import { readFile, appendFile, writeFile, rename, stat } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { config } from './config.js';
import { getShardInfo } from './shard.js';

const REPO_ROOT = config.repo.path;
const JSONL_PATH = join(REPO_ROOT, '.claude', 'shard_learnings.jsonl');
const ARCHIVE_PATH = join(REPO_ROOT, '.claude', 'shard_learnings_archive.jsonl');

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REFRESH_INTERVAL_MS = 60 * 1000; // 60s staleness window
const CONTEXT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for LLM context
const CONTEXT_CAP = 20; // max entries in context string

// In-memory state
let learnings = []; // parsed JSONL entries
let dedupSet = new Set(); // hash strings for dedup
let lastReadTime = 0; // ms timestamp of last file read
let lastModifiedTime = 0; // ms timestamp of file's mtime at last read

// ============ Category → Topic Mapping ============

const CATEGORY_MAP = {
  social: 'teamdynamics',
  project: 'decision',
  technical: 'decision',
  preference: 'preference',
  behavioral: 'preference',
};

// Keywords that trigger broadcast even without explicit category match
const BROADCAST_TAG_KEYWORDS = [
  'team', 'decision', 'architecture', 'security', 'deploy', 'status', 'preference',
];

// Fact content patterns that always broadcast
const BROADCAST_PATTERNS = [
  /\b(left|quit|joined|departed|kicked|banned)\b/i,
  /\b(decided|pivot|pivoted|chose|chosen|agreed)\b/i,
  /\b(deployed|launched|shipped|released|live)\b/i,
  /\b(vulnerability|exploit|breach|compromised|attack)\b/i,
];

// ============ Hash / Dedup ============

function computeHash(shardId, topic, fact) {
  return createHash('sha256')
    .update(`${shardId}|${topic}|${fact}`)
    .digest('hex')
    .slice(0, 32);
}

// ============ Broadcast Threshold ============

function shouldBroadcast(fact, category, tags) {
  // Explicit category mapping
  if (category && CATEGORY_MAP[category]) return true;

  // Tag keyword match
  if (tags && tags.some(t => BROADCAST_TAG_KEYWORDS.includes(t.toLowerCase()))) return true;

  // Content pattern match
  if (BROADCAST_PATTERNS.some(rx => rx.test(fact))) return true;

  // factual category without explicit signal = no broadcast
  return false;
}

// ============ Init ============

export async function initShardLearnings() {
  try {
    await readLearnings();
    console.log(`[shard-learnings] Loaded ${learnings.length} entries (${dedupSet.size} unique hashes)`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[shard-learnings] Init error: ${err.message}`);
    }
    learnings = [];
    dedupSet = new Set();
  }
}

// ============ Read / Parse ============

export async function readLearnings() {
  let raw;
  try {
    raw = await readFile(JSONL_PATH, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      learnings = [];
      dedupSet = new Set();
      lastReadTime = Date.now();
      return learnings;
    }
    throw err;
  }

  const lines = raw.trim().split('\n').filter(Boolean);
  learnings = [];
  dedupSet = new Set();

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      learnings.push(entry);
      if (entry.hash) dedupSet.add(entry.hash);
    } catch {
      // skip malformed lines
    }
  }

  lastReadTime = Date.now();
  try {
    const fileStat = await stat(JSONL_PATH);
    lastModifiedTime = fileStat.mtimeMs;
  } catch {}

  return learnings;
}

// ============ Broadcast (Append) ============

export async function broadcastLearning(fact, category, tags, confidence) {
  if (!fact || typeof fact !== 'string') return false;
  if (!shouldBroadcast(fact, category, tags)) return false;

  const shard = getShardInfo();
  const shardId = shard?.id || 'claude-code';
  const topic = CATEGORY_MAP[category] || category || 'general';
  const hash = computeHash(shardId, topic, fact);

  // Dedup — already have this exact learning
  if (dedupSet.has(hash)) return false;

  const entry = {
    shardId,
    timestamp: new Date().toISOString(),
    topic,
    fact,
    confidence: confidence || 'medium',
    tags: tags || [],
    hash,
  };

  const line = JSON.stringify(entry) + '\n';

  try {
    await appendFile(JSONL_PATH, line);
    learnings.push(entry);
    dedupSet.add(hash);
    console.log(`[shard-learnings] Broadcast: [${topic}] ${fact.slice(0, 60)}...`);
    return true;
  } catch (err) {
    console.warn(`[shard-learnings] Append failed: ${err.message}`);
    return false;
  }
}

// ============ Query ============

export function queryLearnings(topic, tags) {
  let results = learnings;

  if (topic) {
    const t = topic.toLowerCase();
    results = results.filter(e =>
      e.topic?.toLowerCase().includes(t) ||
      e.fact?.toLowerCase().includes(t)
    );
  }

  if (tags && tags.length > 0) {
    const tagSet = new Set(tags.map(t => t.toLowerCase()));
    results = results.filter(e =>
      e.tags?.some(t => tagSet.has(t.toLowerCase()))
    );
  }

  return results;
}

export function getRecentLearnings(sinceMs) {
  const cutoff = Date.now() - (sinceMs || 24 * 60 * 60 * 1000);
  return learnings.filter(e => new Date(e.timestamp).getTime() > cutoff);
}

// ============ Context Builder (for LLM) ============

export function buildShardLearningsContext() {
  const shard = getShardInfo();
  const ownId = shard?.id || 'claude-code';
  const cutoff = Date.now() - CONTEXT_WINDOW_MS;

  // Filter: other shards only, last 7 days
  const relevant = learnings
    .filter(e => e.shardId !== ownId && new Date(e.timestamp).getTime() > cutoff)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, CONTEXT_CAP);

  if (relevant.length === 0) return '';

  const lines = ['--- CROSS-SHARD LEARNINGS (last 7d, other shards) ---'];
  for (const e of relevant) {
    const age = timeSince(e.timestamp);
    const tags = e.tags?.length ? ` [${e.tags.join(', ')}]` : '';
    lines.push(`- [${e.shardId}] (${age} ago) [${e.topic}] ${e.fact}${tags}`);
  }
  lines.push('');
  return lines.join('\n');
}

function timeSince(isoStr) {
  const ms = Date.now() - new Date(isoStr).getTime();
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 1) return `${Math.floor(ms / (1000 * 60))}m`;
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// ============ Sync Status ============

export function getShardSyncStatus() {
  const shard = getShardInfo();
  const ownId = shard?.id || 'claude-code';
  const now = Date.now();

  const total = learnings.length;
  const own = learnings.filter(e => e.shardId === ownId).length;
  const other = total - own;
  const last24h = learnings.filter(e => now - new Date(e.timestamp).getTime() < 24 * 60 * 60 * 1000).length;
  const last7d = learnings.filter(e => now - new Date(e.timestamp).getTime() < 7 * 24 * 60 * 60 * 1000).length;

  const shardCounts = {};
  for (const e of learnings) {
    shardCounts[e.shardId] = (shardCounts[e.shardId] || 0) + 1;
  }

  const staleSec = lastReadTime ? Math.floor((now - lastReadTime) / 1000) : -1;

  return {
    total,
    own,
    other,
    last24h,
    last7d,
    shardCounts,
    staleSec,
    filePath: JSONL_PATH,
  };
}

// ============ Archive Expired ============

export async function archiveExpired() {
  const cutoff = Date.now() - TTL_MS;
  const expired = learnings.filter(e => new Date(e.timestamp).getTime() < cutoff);

  if (expired.length === 0) return 0;

  // Append expired to archive
  const archiveLines = expired.map(e => JSON.stringify(e)).join('\n') + '\n';
  try {
    await appendFile(ARCHIVE_PATH, archiveLines);
  } catch (err) {
    console.warn(`[shard-learnings] Archive append failed: ${err.message}`);
    return 0;
  }

  // Rewrite main file without expired entries
  const remaining = learnings.filter(e => new Date(e.timestamp).getTime() >= cutoff);
  const newContent = remaining.map(e => JSON.stringify(e)).join('\n') + (remaining.length ? '\n' : '');

  try {
    await writeFile(JSONL_PATH, newContent);
    learnings = remaining;
    // Rebuild dedup set
    dedupSet = new Set(remaining.map(e => e.hash).filter(Boolean));
    console.log(`[shard-learnings] Archived ${expired.length} expired entries`);
  } catch (err) {
    console.warn(`[shard-learnings] Rewrite failed: ${err.message}`);
  }

  return expired.length;
}

// ============ Staleness Refresh ============

export async function maybeRefresh() {
  const now = Date.now();
  if (now - lastReadTime < REFRESH_INTERVAL_MS) return false;

  // Check if file was modified since last read
  try {
    const fileStat = await stat(JSONL_PATH);
    if (fileStat.mtimeMs <= lastModifiedTime) {
      lastReadTime = now; // reset timer even if no change
      return false;
    }
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    // Can't stat — re-read to be safe
  }

  await readLearnings();
  return true;
}
