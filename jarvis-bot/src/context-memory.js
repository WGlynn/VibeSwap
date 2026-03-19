// ============ CONTINUOUS CONTEXT — Verkle Context Tree ============
//
// V2: Upgraded from flat rolling summaries to the Verkle Context Tree.
//
// The original problem remains the same: messages beyond the history limit
// get lost. The original solution (flat rolling summary) worked but was
// lossy in the wrong way — older context got overwritten, not compressed.
//
// The Verkle Context Tree fixes this:
//
//   OLD: [system prompt] + [one flat summary blob] + [recent messages]
//   NEW: [system prompt] + [structured witness] + [recent messages]
//
// The witness is a compact proof of the entire conversation:
//   - Root: who, what, major decisions (always present)
//   - Recent era: compressed last ~75 messages
//   - Current epochs: structured last ~15-45 messages
//   - Live messages: verbatim recent history
//
// Decisions NEVER get dropped. Relationships survive if load-bearing.
// Open questions get promoted until resolved. Filler dies at epoch level.
//
// Backwards compatible: migrates flat summaries to tree on first use.
// Same exports, same interface — context-memory.js is still the API.
//
// "No more session resets. Jarvis becomes truly persistent."
// Now with structure, not just persistence.
// ============

import { writeFile, readFile, mkdir, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';
import { VerkleContextTree, EPOCH_SIZE } from './verkle-context.js';

const DATA_DIR = config.dataDir;
const CONTEXT_DIR = join(DATA_DIR, 'context-memory');
const SUMMARIES_FILE = join(CONTEXT_DIR, 'summaries.json');       // Legacy flat summaries
const VERKLE_FILE = join(CONTEXT_DIR, 'verkle-trees.json');       // New tree storage

// ============ State ============

// chatId -> VerkleContextTree
const trees = new Map();

// chatId -> { summary, messageCount, lastUpdated, version }  (legacy, kept for migration)
const legacySummaries = new Map();

// How many messages to keep in live history before summarizing
const SUMMARIZE_THRESHOLD = 40;     // Start summarizing when history hits this
const KEEP_RECENT = 25;             // Keep this many recent messages verbatim
const MAX_SUMMARY_LENGTH = 6000;    // Max chars — safety bound for legacy

let dirty = false;

// ============ Init ============

export async function initContextMemory() {
  try {
    await mkdir(CONTEXT_DIR, { recursive: true });

    // Load Verkle trees (new format)
    if (existsSync(VERKLE_FILE)) {
      try {
        const raw = await readFile(VERKLE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        let count = 0;
        for (const [chatId, treeData] of Object.entries(parsed)) {
          trees.set(Number(chatId), VerkleContextTree.fromJSON(treeData));
          count++;
        }
        console.log(`[context-memory] Loaded ${count} Verkle context trees`);
      } catch (err) {
        console.warn(`[context-memory] Verkle tree load failed: ${err.message}`);
      }
    }

    // Load legacy flat summaries (for migration)
    if (existsSync(SUMMARIES_FILE)) {
      try {
        const raw = await readFile(SUMMARIES_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        let count = 0;
        let migrated = 0;
        for (const [chatId, data] of Object.entries(parsed)) {
          const numId = Number(chatId);

          // If we already have a tree for this chat, skip
          if (trees.has(numId)) {
            count++;
            continue;
          }

          // Migrate flat summary to Verkle tree
          if (data.summary && data.summary.length > 0) {
            const tree = new VerkleContextTree(numId);
            tree.importFlatSummary(data.summary, data.messageCount || 0);
            trees.set(numId, tree);
            migrated++;
          }

          // Keep legacy data for backup
          legacySummaries.set(numId, data);
          count++;
        }
        if (migrated > 0) {
          console.log(`[context-memory] Migrated ${migrated} flat summaries to Verkle trees`);
          dirty = true;  // Save the new trees
        }
        console.log(`[context-memory] Loaded ${count} legacy summaries (${trees.size} total trees active)`);
      } catch (err) {
        console.warn(`[context-memory] Legacy summary load failed: ${err.message}`);
      }
    }

    if (trees.size === 0 && legacySummaries.size === 0) {
      console.log('[context-memory] No saved context — starting fresh (Verkle context active)');
    }
  } catch (err) {
    console.warn(`[context-memory] Init warning: ${err.message}`);
  }
}

// ============ Persistence ============

export async function flushContextMemory() {
  if (!dirty) return;
  try {
    // Save Verkle trees
    const treeObj = {};
    for (const [chatId, tree] of trees) {
      treeObj[chatId] = tree.toJSON();
    }
    const tmpFile = VERKLE_FILE + '.tmp';
    await writeFile(tmpFile, JSON.stringify(treeObj, null, 2));
    await rename(tmpFile, VERKLE_FILE);

    // Also keep legacy summaries updated (backup + tools that read them)
    const legacyObj = {};
    for (const [chatId, data] of legacySummaries) {
      legacyObj[chatId] = data;
    }
    // Also write tree witnesses as legacy-compatible summaries
    for (const [chatId, tree] of trees) {
      if (!legacyObj[chatId]) {
        const witness = tree.buildWitness();
        legacyObj[chatId] = {
          summary: witness || '',
          messageCount: tree.totalMessages,
          lastUpdated: tree.lastUpdated,
          version: tree.version,
        };
      }
    }
    const legacyTmp = SUMMARIES_FILE + '.tmp';
    await writeFile(legacyTmp, JSON.stringify(legacyObj, null, 2));
    await rename(legacyTmp, SUMMARIES_FILE);

    dirty = false;
  } catch (err) {
    console.warn(`[context-memory] Flush error: ${err.message}`);
  }
}

// ============ Core: Summarize & Trim (Verkle Tree) ============

/**
 * Check if a conversation history needs summarization, and if so,
 * compress the oldest messages into the Verkle context tree.
 *
 * Same interface as before — call this BEFORE trimming history.
 * Internally, instead of creating a flat summary, it creates
 * structured epoch(s) in the Verkle tree.
 *
 * @param {number} chatId - Chat identifier
 * @param {Array} history - The conversation history array (MUTATED in place)
 * @returns {boolean} Whether summarization occurred
 */
export async function summarizeIfNeeded(chatId, history) {
  if (!history || history.length < SUMMARIZE_THRESHOLD) return false;

  const messagesToSummarize = history.length - KEEP_RECENT;
  if (messagesToSummarize < 5) return false;

  // Get or create tree for this chat
  if (!trees.has(chatId)) {
    trees.set(chatId, new VerkleContextTree(chatId));
  }
  const tree = trees.get(chatId);

  // Extract the oldest messages that will be summarized
  const batch = history.slice(0, messagesToSummarize);

  try {
    // Create epoch(s) from the batch
    // If batch is larger than EPOCH_SIZE, create multiple epochs
    let created = 0;
    let offset = 0;

    while (offset < batch.length) {
      const epochBatch = batch.slice(offset, offset + EPOCH_SIZE);
      if (epochBatch.length < 5) break;  // Don't create tiny epochs

      const epoch = await tree.createEpoch(epochBatch);
      if (epoch) {
        created++;
      } else {
        // If epoch creation failed, don't lose messages — break and let them stay in history
        console.warn(`[context-memory] Chat ${chatId}: epoch creation failed at offset ${offset}, keeping messages`);
        break;
      }

      offset += EPOCH_SIZE;
    }

    if (created === 0) return false;

    // Remove summarized messages from history
    const messagesConsumed = Math.min(created * EPOCH_SIZE, messagesToSummarize);
    history.splice(0, messagesConsumed);

    dirty = true;

    const stats = tree.getStats();
    console.log(
      `[context-memory] Chat ${chatId}: created ${created} epoch(s)`
      + ` (${messagesConsumed} msgs consumed, ${stats.epochs} total epochs`
      + `, ${stats.eras} eras, ${stats.totalDecisions} decisions tracked)`
    );

    return true;
  } catch (err) {
    console.warn(`[context-memory] Summarization failed for chat ${chatId}: ${err.message}`);
    return false;
  }
}

// ============ Get Summary for Prompt Injection ============

/**
 * Get the context witness for a chat.
 * Returns a structured Verkle witness — compact proof of the entire
 * conversation with decisions, relationships, and open questions.
 *
 * Falls back to legacy flat summary if no tree exists.
 */
export function getContextSummary(chatId) {
  // Try Verkle tree first
  const tree = trees.get(chatId);
  if (tree) {
    const witness = tree.buildWitness();
    if (witness) return witness;
  }

  // Fallback to legacy flat summary
  const legacy = legacySummaries.get(chatId);
  if (!legacy?.summary || legacy.summary.length === 0) return '';

  const summary = legacy.summary.length > MAX_SUMMARY_LENGTH
    ? legacy.summary.slice(0, MAX_SUMMARY_LENGTH) + '\n[context truncated]'
    : legacy.summary;

  const age = Date.now() - legacy.lastUpdated;
  const ageStr = age < 3600000
    ? `${Math.round(age / 60000)}m ago`
    : age < 86400000
      ? `${Math.round(age / 3600000)}h ago`
      : `${Math.round(age / 86400000)}d ago`;

  return `\n\n// ============ CONTINUOUS CONTEXT (${legacy.messageCount} messages summarized, updated ${ageStr}) ============\n${summary}\n// ============ END CONTINUOUS CONTEXT ============`;
}

// ============ Verkle-Specific Operations ============

/**
 * Get the Verkle tree for a chat (for cross-shard operations).
 */
export function getTree(chatId) {
  return trees.get(chatId) || null;
}

/**
 * Export a witness for cross-shard sharing.
 */
export function exportWitness(chatId) {
  const tree = trees.get(chatId);
  return tree ? tree.exportWitness() : null;
}

/**
 * Import a witness from another shard.
 */
export function importWitness(chatId, witness) {
  if (!trees.has(chatId)) {
    trees.set(chatId, new VerkleContextTree(chatId));
  }
  const result = trees.get(chatId).importWitness(witness);
  if (result) dirty = true;
  return result;
}

// ============ Manual Operations ============

/**
 * Force a summary update for a chat.
 */
export async function forceSummarize(chatId, history) {
  if (!history || history.length < 5) return { error: 'Not enough messages to summarize' };

  // Temporarily use a lower threshold
  const oldThreshold = SUMMARIZE_THRESHOLD;
  const result = await summarizeIfNeeded(chatId, history);

  const tree = trees.get(chatId);
  return {
    summarized: result,
    verkle: tree ? tree.getStats() : null,
    witness: tree ? tree.buildWitness() : null,
  };
}

/**
 * Get stats about context memory.
 */
export function getContextMemoryStats() {
  const stats = {
    totalChats: trees.size,
    trees: [],
    totalMessages: 0,
    totalDecisions: 0,
    totalEpochs: 0,
    totalEras: 0,
    legacySummaries: legacySummaries.size,
  };

  for (const [chatId, tree] of trees) {
    const treeStats = tree.getStats();
    stats.trees.push(treeStats);
    stats.totalMessages += treeStats.totalMessages;
    stats.totalDecisions += treeStats.totalDecisions;
    stats.totalEpochs += treeStats.epochs;
    stats.totalEras += treeStats.eras;
  }

  return stats;
}

/**
 * Clear the context for a specific chat.
 */
export function clearContextSummary(chatId) {
  const hadTree = trees.has(chatId);
  const hadLegacy = legacySummaries.has(chatId);
  trees.delete(chatId);
  legacySummaries.delete(chatId);
  if (hadTree || hadLegacy) dirty = true;
  return hadTree || hadLegacy;
}

/**
 * Get raw summary data for a chat.
 * Returns Verkle tree stats if available, legacy summary otherwise.
 */
export function getRawSummary(chatId) {
  const tree = trees.get(chatId);
  if (tree) {
    return {
      type: 'verkle',
      stats: tree.getStats(),
      witness: tree.buildWitness(),
      root: tree.root,
    };
  }

  return legacySummaries.get(chatId) || null;
}
