// ============ Attribution Bridge — Jarvis → VibeSwap On-Chain Rewards ============
//
// Bridges passive-attribution.js contribution data to AttributionBridge.sol.
// Computes merkle trees from attribution scores and submits epochs.
//
// This is the convergence point: AI-tracked contributions become
// Shapley-distributed rewards on-chain.
//
// Flow:
//   1. passive-attribution.js tracks who contributed what (automatic)
//   2. This module aggregates scores into epochs (periodic)
//   3. Computes merkle tree of (addr, score, derivations, sourceType)
//   4. Submits root to AttributionBridge.sol
//   5. Contributors prove inclusion and claim rewards
//
// Jarvis shards are valid contributors — they earn Shapley rewards
// for alpha generation, community engagement, research synthesis, etc.
// ============

import { createHash } from 'crypto';
import { getAttributionGraph, getSourceStats } from './passive-attribution.js';
import { config } from './config.js';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';

// ============ Constants ============

const DATA_DIR = join(config.dataDir || 'data', 'attribution-bridge');
const EPOCH_HISTORY_FILE = join(DATA_DIR, 'epoch-history.json');
const EPOCH_INTERVAL = 86400_000; // 24 hours — one epoch per day

// Source type enum matching AttributionBridge.sol
const SourceType = {
  BLOG: 0,
  VIDEO: 1,
  PAPER: 2,
  CODE: 3,
  SOCIAL: 4,
  CONVERSATION: 5,
  SESSION: 6,
};

// ============ Merkle Tree ============

/**
 * Compute leaf hash matching AttributionBridge.sol:
 * keccak256(abi.encodePacked(contributor, directScore, derivationCount, sourceType))
 *
 * We use sha256 as a stand-in for local computation; the actual submission
 * uses ethers.js solidityPackedKeccak256 for on-chain compatibility.
 */
function computeLeaf(contributor, directScore, derivationCount, sourceType) {
  const data = `${contributor}:${directScore}:${derivationCount}:${sourceType}`;
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Build a merkle tree from an array of leaves.
 * Returns { root, layers, proofs }.
 */
function buildMerkleTree(leaves) {
  if (leaves.length === 0) return { root: '0x' + '0'.repeat(64), layers: [], proofs: {} };

  // Pad to power of 2
  let layer = [...leaves];
  while (layer.length > 1 && (layer.length & (layer.length - 1)) !== 0) {
    layer.push(layer[layer.length - 1]); // duplicate last
  }

  const layers = [layer];

  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] || left;
      const combined = left < right ? left + right : right + left;
      next.push(createHash('sha256').update(combined).digest('hex'));
    }
    layers.push(next);
    layer = next;
  }

  // Compute proofs for each original leaf
  const proofs = {};
  for (let i = 0; i < leaves.length; i++) {
    const proof = [];
    let idx = i;
    for (let l = 0; l < layers.length - 1; l++) {
      const sibling = idx % 2 === 0 ? idx + 1 : idx - 1;
      if (sibling < layers[l].length) {
        proof.push(layers[l][sibling]);
      }
      idx = Math.floor(idx / 2);
    }
    proofs[leaves[i]] = proof;
  }

  return {
    root: '0x' + layers[layers.length - 1][0],
    layers,
    proofs,
  };
}

// ============ Epoch Aggregation ============

/**
 * Aggregate attribution data into an epoch-ready format.
 * Returns array of { contributor, directScore, derivationCount, sourceType }.
 */
export async function aggregateEpoch() {
  const graph = await getAttributionGraph();
  if (!graph || !graph.sources) return [];

  const contributorScores = {};

  // Score each source author by their contribution
  for (const source of Object.values(graph.sources || {})) {
    const addr = source.authorAddr || source.author;
    if (!addr) continue;

    if (!contributorScores[addr]) {
      contributorScores[addr] = {
        contributor: addr,
        directScore: 0,
        derivationCount: 0,
        sourceType: SourceType[source.type] ?? SourceType.SOCIAL,
      };
    }

    // Direct contribution = number of unique sources
    contributorScores[addr].directScore += 1;

    // Count derivations that trace to this source
    const derivations = Object.values(graph.derivations || {}).filter(
      d => d.sourceId === source.id
    );
    contributorScores[addr].derivationCount += derivations.length;

    // Higher source type takes precedence
    const newType = SourceType[source.type] ?? SourceType.SOCIAL;
    if (newType > contributorScores[addr].sourceType) {
      contributorScores[addr].sourceType = newType;
    }
  }

  return Object.values(contributorScores);
}

/**
 * Build epoch merkle tree and prepare for submission.
 */
export async function buildEpochTree() {
  const contributors = await aggregateEpoch();
  if (contributors.length < 2) {
    console.log('[attribution-bridge] Not enough contributors for epoch');
    return null;
  }

  // Build leaves
  const leaves = contributors.map(c =>
    computeLeaf(c.contributor, c.directScore, c.derivationCount, c.sourceType)
  );

  const tree = buildMerkleTree(leaves);

  const epoch = {
    timestamp: Date.now(),
    contributorCount: contributors.length,
    merkleRoot: tree.root,
    contributors,
    proofs: tree.proofs,
  };

  // Save epoch
  try { await mkdir(DATA_DIR, { recursive: true }); } catch {}
  let history = [];
  try { history = JSON.parse(await readFile(EPOCH_HISTORY_FILE, 'utf-8')); } catch {}
  history.push({ timestamp: epoch.timestamp, root: epoch.merkleRoot, count: epoch.contributorCount });
  await writeFile(EPOCH_HISTORY_FILE, JSON.stringify(history, null, 2));

  console.log(`[attribution-bridge] Epoch built: ${contributors.length} contributors, root: ${tree.root.slice(0, 18)}...`);

  return epoch;
}

/**
 * Get proof for a specific contributor in the latest epoch.
 */
export async function getContributorProof(epoch, contributorAddr) {
  const contributor = epoch.contributors.find(c => c.contributor === contributorAddr);
  if (!contributor) return null;

  const leaf = computeLeaf(
    contributor.contributor,
    contributor.directScore,
    contributor.derivationCount,
    contributor.sourceType
  );

  return {
    contributor: contributor.contributor,
    directScore: contributor.directScore,
    derivationCount: contributor.derivationCount,
    sourceType: contributor.sourceType,
    proof: epoch.proofs[leaf] || [],
  };
}
