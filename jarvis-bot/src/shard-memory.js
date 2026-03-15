// ============ Shard Memory — Compressed Semantic Memory Layer ============
//
// Inspired by claude-mem (thedotmack). Adapted for Jarvis shards.
//
// Problem: Shards need shared context but full transcripts are too expensive.
// Solution: Auto-capture interactions → compress to semantic summaries →
// index for fast retrieval → share compressed memories across shards.
//
// Architecture:
//   1. CAPTURE: Every TG interaction → observation record
//   2. COMPRESS: LLM summarizes observations into dense semantic chunks
//   3. INDEX: TF-IDF-like scoring for keyword + semantic retrieval
//   4. INJECT: Relevant memories loaded into system prompt per query
//   5. SHARE: Compressed memories sync across shards via knowledge chain
//
// No external vector DB needed. Self-contained trigram index + LLM compression.
// Memory budget: ~500KB on disk, ~2K tokens injected per query.
//
// "The true mind can weather all lies and illusions without being lost."
// Memories are compressed truths. The index finds them. The mind uses them.
// ============

import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { config } from './config.js';
import { llmChat } from './llm-provider.js';

// ============ Constants ============

const DATA_DIR = join(config.dataDir || 'data', 'shard-memory');
const OBSERVATIONS_FILE = join(DATA_DIR, 'observations.json');
const SUMMARIES_FILE = join(DATA_DIR, 'summaries.json');
const INDEX_FILE = join(DATA_DIR, 'index.json');

const MAX_OBSERVATIONS = 5000;        // Raw observations before pruning
const MAX_SUMMARIES = 500;            // Compressed summaries
const COMPRESSION_BATCH = 20;         // Observations per compression cycle
const COMPRESSION_INTERVAL = 300_000; // 5 min between compressions
const INJECT_TOKEN_BUDGET = 2000;     // Max tokens to inject per query
const AUTO_SAVE_INTERVAL = 60_000;    // Save every 60s

// ============ State ============

let observations = [];   // Raw interaction records
let summaries = [];      // Compressed semantic chunks
let index = {};          // term -> [summaryId, score]
let dirty = false;
let lastCompression = 0;
let initialized = false;

// ============ Init ============

export async function initShardMemory() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
  } catch {}

  try {
    const obsRaw = await readFile(OBSERVATIONS_FILE, 'utf-8');
    observations = JSON.parse(obsRaw);
  } catch { observations = []; }

  try {
    const sumRaw = await readFile(SUMMARIES_FILE, 'utf-8');
    summaries = JSON.parse(sumRaw);
  } catch { summaries = []; }

  try {
    const idxRaw = await readFile(INDEX_FILE, 'utf-8');
    index = JSON.parse(idxRaw);
  } catch { index = {}; }

  initialized = true;
  console.log(`[shard-memory] Initialized: ${observations.length} observations, ${summaries.length} summaries, ${Object.keys(index).length} index terms`);

  // Auto-save
  setInterval(save, AUTO_SAVE_INTERVAL);

  // Auto-compress
  setInterval(maybeCompress, COMPRESSION_INTERVAL);
}

// ============ Capture ============

/**
 * Record an interaction observation.
 * Called after every TG message/response pair.
 */
export function observe(observation) {
  if (!initialized) return;

  const record = {
    id: `obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    type: observation.type || 'interaction',   // interaction, tool_use, learning, error
    userId: observation.userId || null,
    chatId: observation.chatId || null,
    summary: observation.summary || '',         // One-line summary of what happened
    content: observation.content || '',         // Full content (truncated to 500 chars)
    tags: observation.tags || [],               // Semantic tags
    importance: observation.importance || 0.5,  // 0-1 scale
  };

  // Truncate content to prevent bloat
  if (record.content.length > 500) {
    record.content = record.content.slice(0, 497) + '...';
  }

  observations.push(record);
  dirty = true;

  // Prune if over limit (keep most recent + highest importance)
  if (observations.length > MAX_OBSERVATIONS) {
    observations.sort((a, b) => {
      // Keep high importance regardless of age
      if (a.importance >= 0.8 && b.importance < 0.8) return -1;
      if (b.importance >= 0.8 && a.importance < 0.8) return 1;
      return b.timestamp - a.timestamp;
    });
    observations = observations.slice(0, MAX_OBSERVATIONS * 0.8);
  }
}

// ============ Compress ============

/**
 * Compress a batch of observations into a semantic summary.
 * Uses LLM to extract the essential meaning in minimal tokens.
 */
async function maybeCompress() {
  if (!initialized) return;

  const uncompressed = observations.filter(o => !o.compressed);
  if (uncompressed.length < COMPRESSION_BATCH) return;

  const now = Date.now();
  if (now - lastCompression < COMPRESSION_INTERVAL) return;
  lastCompression = now;

  const batch = uncompressed.slice(0, COMPRESSION_BATCH);
  const batchText = batch.map(o =>
    `[${o.type}] ${o.summary || o.content.slice(0, 200)}`
  ).join('\n');

  try {
    const response = await llmChat({
      model: 'fast',
      max_tokens: 300,
      system: 'You are a memory compression engine. Given a batch of interaction observations, produce a single dense semantic summary (2-4 sentences) that captures the essential information, decisions, and patterns. Include key names, numbers, and technical terms. Output ONLY the summary, nothing else.',
      messages: [{ role: 'user', content: batchText }],
    });

    const summaryText = response?.content?.[0]?.text || response?.content || '';
    if (!summaryText || summaryText.length < 10) return;

    const summary = {
      id: `sum-${Date.now()}`,
      timestamp: now,
      timeRange: {
        start: batch[0].timestamp,
        end: batch[batch.length - 1].timestamp,
      },
      text: summaryText.trim(),
      observationCount: batch.length,
      tags: [...new Set(batch.flatMap(o => o.tags))],
      hash: createHash('sha256').update(summaryText).digest('hex').slice(0, 16),
    };

    summaries.push(summary);

    // Mark observations as compressed
    const batchIds = new Set(batch.map(o => o.id));
    observations.forEach(o => {
      if (batchIds.has(o.id)) o.compressed = true;
    });

    // Rebuild index
    indexSummary(summary);

    // Prune old summaries
    if (summaries.length > MAX_SUMMARIES) {
      summaries = summaries.slice(-MAX_SUMMARIES);
      rebuildIndex();
    }

    dirty = true;
    console.log(`[shard-memory] Compressed ${batch.length} observations → "${summaryText.slice(0, 60)}..."`);
  } catch (err) {
    console.warn(`[shard-memory] Compression failed: ${err.message}`);
  }
}

// ============ Index ============

/**
 * Index a summary for keyword search.
 * Uses trigram + word-level indexing for fuzzy matching.
 */
function indexSummary(summary) {
  const text = (summary.text + ' ' + summary.tags.join(' ')).toLowerCase();
  const words = text.match(/[a-z0-9]{3,}/g) || [];

  for (const word of words) {
    if (!index[word]) index[word] = [];
    // Avoid duplicate entries for same summary
    if (!index[word].some(e => e.id === summary.id)) {
      index[word].push({
        id: summary.id,
        score: 1 + (summary.tags.includes(word) ? 0.5 : 0),
      });
    }
  }
}

function rebuildIndex() {
  index = {};
  for (const summary of summaries) {
    indexSummary(summary);
  }
}

// ============ Search ============

/**
 * Search memories for relevant context.
 * Returns compressed summaries ranked by relevance.
 *
 * @param {string} query - Natural language query
 * @param {number} maxResults - Max summaries to return
 * @returns {Array} Ranked summaries
 */
export function searchMemory(query, maxResults = 5) {
  if (!initialized || summaries.length === 0) return [];

  const queryWords = query.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  if (queryWords.length === 0) return summaries.slice(-maxResults);

  // Score each summary by term overlap
  const scores = new Map();

  for (const word of queryWords) {
    const entries = index[word] || [];
    for (const entry of entries) {
      const current = scores.get(entry.id) || 0;
      scores.set(entry.id, current + entry.score);
    }
  }

  // Boost recent summaries (recency bias)
  const now = Date.now();
  for (const summary of summaries) {
    if (scores.has(summary.id)) {
      const age = (now - summary.timestamp) / (86400 * 1000); // days
      const recencyBoost = Math.max(0, 1 - age / 30); // Full boost within 30 days
      scores.set(summary.id, scores.get(summary.id) + recencyBoost * 0.5);
    }
  }

  // Sort by score, return top results
  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxResults)
    .map(([id]) => summaries.find(s => s.id === id))
    .filter(Boolean);

  return ranked;
}

// ============ Inject ============

/**
 * Build context string for injection into system prompt.
 * Progressive disclosure: compact summaries that fit token budget.
 *
 * @param {string} userMessage - Current user message for relevance scoring
 * @returns {string} Context string to inject
 */
export function buildMemoryContext(userMessage) {
  if (!initialized || summaries.length === 0) return '';

  const relevant = searchMemory(userMessage, 8);
  if (relevant.length === 0) return '';

  let context = '=== SHARD MEMORY (compressed past interactions) ===\n';
  let tokens = 0;

  for (const summary of relevant) {
    const chunk = `[${new Date(summary.timestamp).toISOString().slice(0, 10)}] ${summary.text}\n`;
    const chunkTokens = Math.ceil(chunk.length / 4); // Rough token estimate

    if (tokens + chunkTokens > INJECT_TOKEN_BUDGET) break;

    context += chunk;
    tokens += chunkTokens;
  }

  context += '=== END SHARD MEMORY ===\n';
  return context;
}

// ============ Share ============

/**
 * Export compressed summaries for shard sync.
 * Other shards import these to build shared memory.
 */
export function exportForSync() {
  return {
    shardId: config.shard?.id || 'shard-0',
    summaries: summaries.slice(-50), // Last 50 summaries
    timestamp: Date.now(),
  };
}

/**
 * Import summaries from another shard.
 * Merges without duplicates (by hash).
 */
export function importFromShard(shardData) {
  if (!shardData?.summaries?.length) return 0;

  const existingHashes = new Set(summaries.map(s => s.hash));
  let imported = 0;

  for (const summary of shardData.summaries) {
    if (!existingHashes.has(summary.hash)) {
      summary.sourceShardId = shardData.shardId;
      summaries.push(summary);
      indexSummary(summary);
      imported++;
    }
  }

  if (imported > 0) {
    dirty = true;
    console.log(`[shard-memory] Imported ${imported} summaries from ${shardData.shardId}`);
  }

  return imported;
}

// ============ Stats ============

export function getMemoryStats() {
  return {
    observations: observations.length,
    uncompressed: observations.filter(o => !o.compressed).length,
    summaries: summaries.length,
    indexTerms: Object.keys(index).length,
    oldestObservation: observations[0]?.timestamp || null,
    newestObservation: observations[observations.length - 1]?.timestamp || null,
    oldestSummary: summaries[0]?.timestamp || null,
    newestSummary: summaries[summaries.length - 1]?.timestamp || null,
    totalTags: [...new Set(summaries.flatMap(s => s.tags))].length,
  };
}

// ============ Persistence ============

async function save() {
  if (!dirty) return;
  dirty = false;

  try {
    await Promise.all([
      writeFile(OBSERVATIONS_FILE, JSON.stringify(observations), 'utf-8'),
      writeFile(SUMMARIES_FILE, JSON.stringify(summaries), 'utf-8'),
      writeFile(INDEX_FILE, JSON.stringify(index), 'utf-8'),
    ]);
  } catch (err) {
    console.error(`[shard-memory] Save failed: ${err.message}`);
    dirty = true;
  }
}
