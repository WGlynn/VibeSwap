// ============ Deep Storage — L2 Knowledge Archive ============
//
// Two-tier knowledge system:
//   L1 = Active CKB (bounded, in-memory, fast, expensive)
//   L2 = Deep Storage (unbounded, disk, slower, cheap)
//
// Facts pruned from L1 (apoptosis, displacement, compression) are archived
// here rather than permanently deleted. Nothing is ever truly forgotten —
// it just moves to cold storage.
//
// Format: JSONL (one JSON object per line) — append-only, crash-safe.
// Index: In-memory keyword/tag map rebuilt on startup (fast for <100K facts).
//
// Future: Could back this with IPFS, CKB cells, or a proper DB.
// For now, filesystem JSONL is the cave-appropriate solution.
// ============

import { readFile, appendFile, mkdir, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';

const DEEP_DIR = join(config.dataDir, 'knowledge', 'deep');

// In-memory index: userId -> [{ lineNum, keywords, tags, timestamp, preview }]
const index = new Map();

// ============ Init ============

export async function initDeepStorage() {
  await mkdir(DEEP_DIR, { recursive: true });

  // Scan all existing deep storage files and build index
  let totalFacts = 0;
  try {
    const files = await readdir(DEEP_DIR);
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const userId = file.replace('.jsonl', '');
      const entries = await _loadAndIndex(userId);
      totalFacts += entries;
    }
  } catch {
    // Empty directory — first run
  }

  console.log(`[deep-storage] Initialized — ${index.size} users, ${totalFacts} archived facts`);
}

// ============ Archive ============

export async function archiveFact(userId, fact, reason = 'apoptosis') {
  const id = String(userId);
  const entry = {
    ...fact,
    archivedAt: new Date().toISOString(),
    archiveReason: reason,
  };

  const filePath = join(DEEP_DIR, `${id}.jsonl`);
  await appendFile(filePath, JSON.stringify(entry) + '\n');

  // Update in-memory index
  _indexEntry(id, entry, _getLineCount(id));

  return entry;
}

export async function archiveBatch(userId, facts, reason = 'apoptosis') {
  if (!facts || facts.length === 0) return;
  const id = String(userId);
  const filePath = join(DEEP_DIR, `${id}.jsonl`);
  const timestamp = new Date().toISOString();

  let lineNum = _getLineCount(id);
  const lines = [];
  for (const fact of facts) {
    const entry = {
      ...fact,
      archivedAt: timestamp,
      archiveReason: reason,
    };
    lines.push(JSON.stringify(entry));
    _indexEntry(id, entry, lineNum++);
  }

  await appendFile(filePath, lines.join('\n') + '\n');
  console.log(`[deep-storage] Archived ${facts.length} facts for user ${id} (reason: ${reason})`);
}

// ============ Search ============

export function searchDeepStorage(userId, query, tags = [], limit = 5) {
  const id = String(userId);
  const userIndex = index.get(id);
  if (!userIndex || userIndex.length === 0) return [];

  const queryLower = query?.toLowerCase() || '';
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
  const tagSet = new Set(tags.map(t => t.toLowerCase()));

  // Score each indexed entry
  const scored = [];
  for (const entry of userIndex) {
    let score = 0;

    // Keyword match scoring
    for (const word of queryWords) {
      if (entry.keywords.has(word)) score += 2;
      // Partial match
      for (const kw of entry.keywords) {
        if (kw.includes(word) || word.includes(kw)) score += 1;
      }
    }

    // Tag match scoring
    for (const tag of tagSet) {
      if (entry.tags.has(tag)) score += 3;
    }

    if (score > 0) {
      scored.push({ ...entry, score });
    }
  }

  // Sort by score (descending), then recency
  scored.sort((a, b) => b.score - a.score || b.lineNum - a.lineNum);

  // Read actual entries from disk for top matches
  return scored.slice(0, limit);
}

// Full search with disk read — returns complete fact objects
export async function searchDeepStorageFull(userId, query, tags = [], limit = 5) {
  const matches = searchDeepStorage(userId, query, tags, limit);
  if (matches.length === 0) return [];

  const id = String(userId);
  const filePath = join(DEEP_DIR, `${id}.jsonl`);

  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    return matches.map(m => {
      try {
        const fact = JSON.parse(lines[m.lineNum]);
        return { ...fact, _score: m.score };
      } catch {
        return { content: m.preview, _score: m.score };
      }
    }).filter(Boolean);
  } catch {
    return matches.map(m => ({ content: m.preview, _score: m.score }));
  }
}

// ============ Stats ============

export async function getDeepStorageStats(userId) {
  const id = String(userId);
  const userIndex = index.get(id);
  const count = userIndex?.length || 0;

  let sizeBytes = 0;
  try {
    const filePath = join(DEEP_DIR, `${id}.jsonl`);
    const s = await stat(filePath);
    sizeBytes = s.size;
  } catch {
    // File doesn't exist
  }

  // Category breakdown from index
  const categories = {};
  if (userIndex) {
    for (const entry of userIndex) {
      const cat = entry.category || 'unknown';
      categories[cat] = (categories[cat] || 0) + 1;
    }
  }

  return {
    factCount: count,
    sizeBytes,
    sizeKB: Math.round(sizeBytes / 1024),
    categories,
  };
}

// Global stats across all users
export async function getDeepStorageGlobalStats() {
  let totalFacts = 0;
  let totalUsers = 0;
  let totalBytes = 0;

  for (const [userId, entries] of index) {
    totalUsers++;
    totalFacts += entries.length;
    try {
      const filePath = join(DEEP_DIR, `${userId}.jsonl`);
      const s = await stat(filePath);
      totalBytes += s.size;
    } catch {}
  }

  return { totalFacts, totalUsers, totalKB: Math.round(totalBytes / 1024) };
}

// ============ Internal Helpers ============

async function _loadAndIndex(userId) {
  const id = String(userId);
  const filePath = join(DEEP_DIR, `${id}.jsonl`);

  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.length > 0);

    for (let i = 0; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]);
        _indexEntry(id, entry, i);
      } catch {
        // Skip malformed lines
      }
    }

    return lines.length;
  } catch {
    return 0;
  }
}

function _indexEntry(userId, entry, lineNum) {
  if (!index.has(userId)) {
    index.set(userId, []);
  }

  // Extract keywords from content
  const content = (entry.content || '').toLowerCase();
  const words = content.split(/\s+/)
    .filter(w => w.length > 2)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length > 2);
  const keywords = new Set(words);

  // Extract tags
  const tags = new Set((entry.tags || []).map(t => t.toLowerCase()));

  index.get(userId).push({
    lineNum,
    keywords,
    tags,
    category: entry.category || 'general',
    timestamp: entry.archivedAt || entry.created,
    preview: (entry.content || '').slice(0, 80),
  });
}

function _getLineCount(userId) {
  const userIndex = index.get(userId);
  return userIndex ? userIndex.length : 0;
}
