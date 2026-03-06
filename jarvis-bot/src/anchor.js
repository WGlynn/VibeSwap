// ============ Anchor — Periodic On-Chain Merkle Root Anchoring ============
//
// Periodically anchors knowledge chain Merkle roots to create an immutable,
// censorship-resistant proof chain. This ensures that even if GitHub goes
// down or is censored, any shard can verify the knowledge chain's integrity
// against on-chain anchors.
//
// Phased rollout:
//   Phase 1 (NOW):     Local proof chain — data/anchor-log.jsonl
//   Phase 2 (Mainnet): EVM anchoring via ContextAnchor.sol
//   Phase 3 (CKB):     CKB knowledge cells with MMR accumulator
//
// "No external services. Just VSOS shards + VSOS chains."
// ============

import { appendFile, readFile } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { getChain, getChainHead, computeMerkleRoot } from './knowledge-chain.js';

// ============ Constants ============

const ANCHOR_INTERVAL = 12; // Epochs between anchors (~1 hour at 5-min epochs)
const ANCHOR_LOG_FILE = join(config.dataDir, 'anchor-log.jsonl');

// ============ State ============

let lastAnchoredHeight = -1;
let anchorCount = 0;

// ============ Init ============

export async function initAnchor() {
  // Recover last anchored height from log
  try {
    const data = await readFile(ANCHOR_LOG_FILE, 'utf-8');
    const lines = data.trim().split('\n').filter(Boolean);
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      const lastAnchor = JSON.parse(lastLine);
      lastAnchoredHeight = lastAnchor.toHeight || -1;
      anchorCount = lines.length;
      console.log(`[anchor] Recovered ${anchorCount} anchors, last at height ${lastAnchoredHeight}`);
    }
  } catch {
    console.log('[anchor] No anchor log — starting fresh');
  }
}

// ============ Core: Maybe Anchor ============

/**
 * Check if enough epochs have passed since last anchor, and if so,
 * compute a super-root and write it to the local proof chain.
 *
 * Call this after every produceEpoch() in the harmonic tick.
 */
export async function maybeAnchor() {
  const head = getChainHead();
  if (!head) return null;

  // Not enough epochs since last anchor
  if (head.height - lastAnchoredHeight < ANCHOR_INTERVAL) return null;

  // Get epochs since last anchor
  const sinceHeight = lastAnchoredHeight >= 0 ? lastAnchoredHeight + 1 : 0;
  const epochs = getChain(sinceHeight);
  if (epochs.length === 0) return null;

  // Compute super-root: Merkle root of all epoch hashes in this interval
  const epochHashes = epochs.map(e => ({ hash: e.hash }));
  const superRoot = computeMerkleRoot(epochHashes);

  const anchor = {
    fromHeight: sinceHeight,
    toHeight: head.height,
    superRoot,
    epochCount: epochs.length,
    timestamp: new Date().toISOString(),
    cumulativeVD: head.cumulativeValueDensity,
    chainLength: getChain(0).length,
  };

  // Phase 1: Local proof chain (pre-mainnet)
  try {
    await appendFile(ANCHOR_LOG_FILE, JSON.stringify(anchor) + '\n');
  } catch (err) {
    console.warn(`[anchor] Failed to write anchor log: ${err.message}`);
    return null;
  }

  // Phase 2: EVM anchoring (post-mainnet)
  // await anchorToEVM(superRoot, anchor.fromHeight, anchor.toHeight);

  // Phase 3: CKB anchoring (post-CKB integration)
  // await anchorToCKB(superRoot, anchor);

  lastAnchoredHeight = head.height;
  anchorCount++;

  console.log(`[anchor] #${anchorCount}: epochs ${anchor.fromHeight}-${anchor.toHeight} (${anchor.epochCount} epochs), superRoot: ${superRoot.slice(0, 16)}...`);

  return anchor;
}

// ============ Stats ============

export function getAnchorStats() {
  return {
    anchorCount,
    lastAnchoredHeight,
    anchorInterval: ANCHOR_INTERVAL,
    logFile: ANCHOR_LOG_FILE,
  };
}

// ============ Future: EVM Anchoring ============
// When mainnet is live, this will call ContextAnchor.sol:
//
// async function anchorToEVM(superRoot, fromHeight, toHeight) {
//   const provider = new ethers.JsonRpcProvider(config.rpcUrl);
//   const wallet = new ethers.Wallet(config.anchorPrivateKey, provider);
//   const anchor = new ethers.Contract(CONTEXT_ANCHOR_ADDRESS, CONTEXT_ANCHOR_ABI, wallet);
//   const tx = await anchor.anchorContext(
//     ethers.zeroPadValue(ethers.toBeHex(fromHeight), 32),
//     superRoot,
//     `epoch:${fromHeight}-${toHeight}`
//   );
//   await tx.wait();
// }

// ============ Future: CKB Anchoring ============
// When CKB integration is live, this will create knowledge cells:
//
// async function anchorToCKB(superRoot, anchor) {
//   // Use CKB SDK to create a knowledge-type cell with:
//   // - header: { prev_state_hash, merkle_root: superRoot, epoch_range }
//   // - MMR accumulator update
//   // - PoW lock (access-gated)
// }
