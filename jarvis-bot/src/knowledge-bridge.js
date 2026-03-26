// ============ Knowledge Bridge — Off-Chain Knowledge → On-Chain Settlement ============
//
// Bridges Jarvis's off-chain knowledge chain epochs to on-chain checkpoints.
// Both interfaces already exist:
//   - knowledge-chain.js produces Merkle roots every ~5 minutes
//   - VibeCheckpointRegistry.sol accepts (blockNumber, stateRoot, receiptsRoot)
//   - IntelligenceExchange.sol accepts (merkleRoot, assetCount, totalValue)
//
// This module wires them together. ~150 lines. The simplest bridge possible.
//
// Architecture:
//   1. Listens for epoch production events from knowledge-chain.js
//   2. Takes the epoch's Merkle root and aggregate value density
//   3. Calls IntelligenceExchange.anchorKnowledgeEpoch() via contract-bridge pattern
//   4. Falls back to VibeCheckpointRegistry.submit() if SIE not deployed
//   5. Records checkpoint history locally for light client verification
//
// P-001: No extraction. This bridge costs gas but takes zero fees.
// ============

import { getChainHead, getChainStats } from './knowledge-chain.js';
import { callContract, isUnlocked } from './wallet.js';
import { config } from './config.js';
import { writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// ============ Constants ============

const BRIDGE_INTERVAL_MS = 5 * 60 * 1000; // Match epoch interval
const CHECKPOINT_HISTORY_FILE = join(config.dataDir, 'knowledge', 'bridge-checkpoints.json');
const MAX_CHECKPOINT_HISTORY = 500;

// ============ Contract Config ============

const INTELLIGENCE_EXCHANGE = process.env.INTELLIGENCE_EXCHANGE || '';
const CHECKPOINT_REGISTRY = process.env.CHECKPOINT_REGISTRY || '';

const SIE_ABI = [
  'function anchorKnowledgeEpoch(bytes32 merkleRoot, uint256 assetCount, uint256 totalValue) external',
  'function epochCount() external view returns (uint256)',
];

const REGISTRY_ABI = [
  'function submit(uint256 blockNumber, bytes32 stateRoot, bytes32 receiptsRoot) external',
  'function checkpointCount() external view returns (uint256)',
];

// ============ State ============

let lastBridgedEpoch = 0;
let checkpointHistory = [];
let bridgeTimer = null;

// ============ Core Bridge ============

/**
 * Bridge the current knowledge chain head to on-chain settlement.
 * Tries IntelligenceExchange first, falls back to VibeCheckpointRegistry.
 */
export async function bridgeCurrentEpoch() {
  if (!isUnlocked()) {
    return { success: false, reason: 'wallet-locked' };
  }

  const head = getChainHead();
  if (!head) {
    return { success: false, reason: 'no-chain-head' };
  }

  // Skip if already bridged
  if (head.height <= lastBridgedEpoch) {
    return { success: false, reason: 'already-bridged', height: head.height };
  }

  const stats = getChainStats();
  const merkleRoot = head.merkleRoot;
  const assetCount = stats.totalFacts || 0;
  const totalValue = Math.floor((stats.aggregateValueDensity || 0) * 1e18);

  // Try IntelligenceExchange.anchorKnowledgeEpoch()
  if (INTELLIGENCE_EXCHANGE) {
    try {
      const tx = await callContract(
        INTELLIGENCE_EXCHANGE,
        SIE_ABI,
        'anchorKnowledgeEpoch',
        [merkleRoot, assetCount, totalValue]
      );

      const checkpoint = {
        epochHeight: head.height,
        merkleRoot,
        assetCount,
        totalValue: totalValue.toString(),
        txHash: tx.hash,
        target: 'IntelligenceExchange',
        timestamp: Date.now(),
      };

      await recordCheckpoint(checkpoint);
      lastBridgedEpoch = head.height;
      console.log(`[knowledge-bridge] Anchored epoch ${head.height} to SIE (tx: ${tx.hash})`);
      return { success: true, checkpoint };
    } catch (err) {
      console.warn(`[knowledge-bridge] SIE anchor failed, trying registry: ${err.message}`);
    }
  }

  // Fallback: VibeCheckpointRegistry.submit()
  if (CHECKPOINT_REGISTRY) {
    try {
      const blockNumber = head.height;
      const stateRoot = merkleRoot;
      const receiptsRoot = head.parentHash || '0x' + '0'.repeat(64);

      const tx = await callContract(
        CHECKPOINT_REGISTRY,
        REGISTRY_ABI,
        'submit',
        [blockNumber, stateRoot, receiptsRoot]
      );

      const checkpoint = {
        epochHeight: head.height,
        merkleRoot,
        assetCount,
        totalValue: totalValue.toString(),
        txHash: tx.hash,
        target: 'VibeCheckpointRegistry',
        timestamp: Date.now(),
      };

      await recordCheckpoint(checkpoint);
      lastBridgedEpoch = head.height;
      console.log(`[knowledge-bridge] Checkpointed epoch ${head.height} to registry (tx: ${tx.hash})`);
      return { success: true, checkpoint };
    } catch (err) {
      console.error(`[knowledge-bridge] Registry checkpoint failed: ${err.message}`);
      return { success: false, reason: 'tx-failed', error: err.message };
    }
  }

  return { success: false, reason: 'no-contract-configured' };
}

// ============ Checkpoint History ============

async function recordCheckpoint(checkpoint) {
  checkpointHistory.push(checkpoint);
  if (checkpointHistory.length > MAX_CHECKPOINT_HISTORY) {
    checkpointHistory = checkpointHistory.slice(-MAX_CHECKPOINT_HISTORY);
  }
  try {
    await writeFile(CHECKPOINT_HISTORY_FILE, JSON.stringify(checkpointHistory, null, 2));
  } catch { /* non-critical */ }
}

async function loadCheckpointHistory() {
  try {
    if (existsSync(CHECKPOINT_HISTORY_FILE)) {
      const raw = await readFile(CHECKPOINT_HISTORY_FILE, 'utf-8');
      checkpointHistory = JSON.parse(raw);
      if (checkpointHistory.length > 0) {
        lastBridgedEpoch = checkpointHistory[checkpointHistory.length - 1].epochHeight || 0;
      }
    }
  } catch { /* start fresh */ }
}

// ============ Lifecycle ============

/**
 * Start the knowledge bridge. Runs on the same interval as epoch production.
 */
export async function startKnowledgeBridge() {
  await loadCheckpointHistory();

  if (!INTELLIGENCE_EXCHANGE && !CHECKPOINT_REGISTRY) {
    console.log('[knowledge-bridge] No contract configured — bridge inactive');
    return;
  }

  console.log(`[knowledge-bridge] Starting bridge (target: ${INTELLIGENCE_EXCHANGE ? 'SIE' : 'Registry'})`);
  console.log(`[knowledge-bridge] Last bridged epoch: ${lastBridgedEpoch}`);

  // Bridge immediately if there's a gap
  await bridgeCurrentEpoch();

  // Then bridge on interval
  bridgeTimer = setInterval(async () => {
    try {
      await bridgeCurrentEpoch();
    } catch (err) {
      console.error(`[knowledge-bridge] Bridge tick failed: ${err.message}`);
    }
  }, BRIDGE_INTERVAL_MS);
}

export function stopKnowledgeBridge() {
  if (bridgeTimer) {
    clearInterval(bridgeTimer);
    bridgeTimer = null;
  }
}

// ============ API ============

export function getBridgeStats() {
  return {
    lastBridgedEpoch,
    totalCheckpoints: checkpointHistory.length,
    target: INTELLIGENCE_EXCHANGE ? 'IntelligenceExchange' : CHECKPOINT_REGISTRY ? 'VibeCheckpointRegistry' : 'none',
    configured: !!(INTELLIGENCE_EXCHANGE || CHECKPOINT_REGISTRY),
    recentCheckpoints: checkpointHistory.slice(-5),
  };
}

/**
 * Handle HTTP API requests for bridge status.
 */
export function handleBridgeRequest(path) {
  if (path === '/web/bridge/stats' || path === '/bridge/stats') {
    return { status: 200, body: getBridgeStats() };
  }
  if (path === '/web/bridge/checkpoints' || path === '/bridge/checkpoints') {
    return { status: 200, body: { checkpoints: checkpointHistory.slice(-20) } };
  }
  return null;
}
