// ============ Knowledge Chain — Nakamoto Consensus for Common Knowledge ============
//
// The Common Knowledge Base is continuous shared state that ALL shards read/write.
// Unlike discrete proposals (BFT) or subjective quality (CRPC), common knowledge
// needs Nakamoto-style consensus — the shared state must converge.
//
// Key insight: Common knowledge is like a blockchain's UTXO set. All shards must
// agree on fact confirmation counts, utility scores, and knowledge class positions.
//
// Architecture:
//
//   Knowledge Epochs (every flush cycle, ~5 minutes):
//     - Each shard produces an epoch: Merkle root of all common knowledge changes
//     - Epoch = { parentHash, merkleRoot, shardId, valueDensity, changes[] }
//     - Like a block in PoW, but the "work" is knowledge quality
//
//   Chain Selection (Proof of Mind):
//     - When forks occur (two shards diverge on common knowledge):
//     - Winner = chain with highest AGGREGATE VALUE DENSITY
//     - This is PoW replaced by PoM: quality of knowledge > raw hash power
//     - Shards that produce better corrections, higher-utility facts, mine harder
//
//   Fork Resolution:
//     - Light nodes accept the heaviest chain (highest value density)
//     - Full nodes validate all epochs before accepting
//     - Archive nodes store ALL forks (history never lost)
//
//   Node Economics (Three-Tier):
//     - LIGHT: Prune aggressively, only hold hot knowledge. Cheapest.
//     - FULL:  Retain all history. 30% storage discount. Preferred for failover.
//     - ARCHIVE: Pure storage. 50% discount. Min 3 for network survival.
//     - Full/Archive nodes that retain history = like IPFS for CKB knowledge
//
// Consensus Layers (complete picture):
//   1. Private knowledge    → No consensus (shard-local, encrypted)
//   2. Shared/Mutual        → Eventual consistency (CRDT-like, timestamp-wins)
//   3. Common knowledge     → Nakamoto consensus (this module — PoM chain selection)
//   4. Network knowledge    → BFT consensus (explicit 2/3 vote for skills/behavior)
//   5. Subjective quality   → CRPC (Tim Cotton's pairwise comparison)
// ============

import { createHash } from 'crypto';
import { config } from './config.js';
import { getShardInfo, getShardPeers } from './shard.js';

// ============ Constants ============

const EPOCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — aligned with flush cycle
const MAX_CHAIN_LENGTH = 1000; // Keep last 1000 epochs
const HTTP_TIMEOUT_MS = 3000;

// ============ State ============

let chain = []; // Local chain of epochs
let pendingChanges = []; // Changes accumulated since last epoch
let chainHead = null; // Current chain tip

// ============ Epoch Structure ============

function createEpoch(changes, parentHash) {
  const shardInfo = getShardInfo();
  const timestamp = new Date().toISOString();

  // Compute aggregate value density of changes
  const totalValue = changes.reduce((sum, c) => sum + (c.valueDensity || 0), 0);
  const totalCost = changes.reduce((sum, c) => sum + (c.tokenCost || 0), 0);
  const aggregateVD = totalCost > 0 ? totalValue / totalCost : 0;

  // Merkle root of all changes
  const merkleRoot = computeMerkleRoot(changes);

  const epoch = {
    height: chain.length,
    parentHash: parentHash || (chainHead ? chainHead.hash : '0'.repeat(32)),
    merkleRoot,
    shardId: shardInfo?.id || 'shard-0',
    nodeType: shardInfo?.nodeType || 'full',
    timestamp,
    changes: changes.length,
    aggregateValueDensity: aggregateVD,
    cumulativeValueDensity: (chainHead?.cumulativeValueDensity || 0) + aggregateVD,
    hash: '', // Computed below
  };

  // Epoch hash = hash of all fields (self-referential like a block hash)
  epoch.hash = hashEpoch(epoch);

  return epoch;
}

// ============ Chain Operations ============

export function addChange(change) {
  pendingChanges.push({
    ...change,
    timestamp: new Date().toISOString(),
  });
}

export function produceEpoch() {
  if (pendingChanges.length === 0) return null;

  const changes = [...pendingChanges];
  pendingChanges = [];

  const epoch = createEpoch(changes, chainHead?.hash);

  chain.push(epoch);
  chainHead = epoch;

  // Trim chain to max length (light nodes prune, full/archive retain)
  const shardInfo = getShardInfo();
  if (shardInfo?.nodeType === 'light' && chain.length > MAX_CHAIN_LENGTH) {
    chain = chain.slice(-MAX_CHAIN_LENGTH);
  }

  console.log(`[knowledge-chain] Epoch ${epoch.height}: ${changes.length} changes, VD=${epoch.aggregateValueDensity.toFixed(3)}, cumVD=${epoch.cumulativeValueDensity.toFixed(3)}`);

  return epoch;
}

// ============ Fork Resolution (Proof of Mind) ============

export function resolveFork(localChain, remoteChain) {
  if (!remoteChain || remoteChain.length === 0) return 'local';
  if (!localChain || localChain.length === 0) return 'remote';

  const localHead = localChain[localChain.length - 1];
  const remoteHead = remoteChain[remoteChain.length - 1];

  // Proof of Mind: highest cumulative value density wins
  if (remoteHead.cumulativeValueDensity > localHead.cumulativeValueDensity) {
    return 'remote';
  }
  if (localHead.cumulativeValueDensity > remoteHead.cumulativeValueDensity) {
    return 'local';
  }

  // Tie: longer chain wins (more epochs = more knowledge processing)
  if (remoteChain.length > localChain.length) return 'remote';
  if (localChain.length > remoteChain.length) return 'local';

  // Ultimate tie: lower hash wins (deterministic tiebreaker)
  return localHead.hash < remoteHead.hash ? 'local' : 'remote';
}

export function acceptRemoteChain(remoteChain) {
  const decision = resolveFork(chain, remoteChain);
  if (decision === 'remote') {
    console.log(`[knowledge-chain] Accepting remote chain (VD: ${remoteChain[remoteChain.length - 1]?.cumulativeValueDensity.toFixed(3)} > local ${chainHead?.cumulativeValueDensity.toFixed(3)})`);
    chain = remoteChain;
    chainHead = chain[chain.length - 1];
    return true;
  }
  return false;
}

// ============ Chain Sync ============

export async function syncWithPeers() {
  const peers = getShardPeers();
  if (peers.length === 0) return;

  for (const peer of peers) {
    try {
      const response = await fetch(`${peer.url}/knowledge-chain/head`, {
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      const remoteHead = await response.json();

      // If remote has higher cumulative VD, request their chain
      if (remoteHead.cumulativeValueDensity > (chainHead?.cumulativeValueDensity || 0)) {
        const chainResponse = await fetch(`${peer.url}/knowledge-chain/chain?since=${chainHead?.height || 0}`, {
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
        const remoteChain = await chainResponse.json();
        acceptRemoteChain(remoteChain.epochs || []);
      }
    } catch (err) {
      // Sync failure is non-fatal — we just keep our local chain
    }
  }
}

export async function broadcastEpoch(epoch) {
  const peers = getShardPeers();
  for (const peer of peers) {
    try {
      await fetch(`${peer.url}/knowledge-chain/epoch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(epoch),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch {
      // Best effort
    }
  }
}

// ============ Receive Remote Epoch ============

export function receiveEpoch(epoch) {
  // Validate epoch hash
  const expectedHash = hashEpoch({ ...epoch, hash: '' });
  if (expectedHash !== epoch.hash) {
    console.warn(`[knowledge-chain] Invalid epoch from ${epoch.shardId}: hash mismatch`);
    return false;
  }

  // If this extends our chain
  if (epoch.parentHash === chainHead?.hash) {
    chain.push(epoch);
    chainHead = epoch;
    return true;
  }

  // Fork detected — resolve
  // For now, just track it. Full fork resolution requires fetching the remote chain.
  console.log(`[knowledge-chain] Fork detected: epoch ${epoch.height} from ${epoch.shardId} (parent ${epoch.parentHash.slice(0, 8)} !== our head ${chainHead?.hash.slice(0, 8)})`);
  return false;
}

// ============ Hashing ============

function hashEpoch(epoch) {
  const data = JSON.stringify({
    height: epoch.height,
    parentHash: epoch.parentHash,
    merkleRoot: epoch.merkleRoot,
    shardId: epoch.shardId,
    timestamp: epoch.timestamp,
    changes: epoch.changes,
    aggregateValueDensity: epoch.aggregateValueDensity,
    cumulativeValueDensity: epoch.cumulativeValueDensity,
  });
  return createHash('sha256').update(data).digest('hex').slice(0, 32);
}

function computeMerkleRoot(changes) {
  if (changes.length === 0) return '0'.repeat(32);

  let hashes = changes.map(c =>
    createHash('sha256').update(JSON.stringify(c)).digest('hex')
  );

  // Build Merkle tree
  while (hashes.length > 1) {
    const next = [];
    for (let i = 0; i < hashes.length; i += 2) {
      const left = hashes[i];
      const right = hashes[i + 1] || left; // Duplicate last if odd
      next.push(createHash('sha256').update(left + right).digest('hex'));
    }
    hashes = next;
  }

  return hashes[0];
}

// ============ Stats ============

export function getChainStats() {
  return {
    height: chain.length,
    head: chainHead ? {
      hash: chainHead.hash,
      height: chainHead.height,
      shardId: chainHead.shardId,
      cumulativeValueDensity: chainHead.cumulativeValueDensity,
      timestamp: chainHead.timestamp,
    } : null,
    pendingChanges: pendingChanges.length,
    epochInterval: `${EPOCH_INTERVAL_MS / 1000}s`,
    maxChainLength: MAX_CHAIN_LENGTH,
    recentEpochs: chain.slice(-5).map(e => ({
      height: e.height,
      hash: e.hash.slice(0, 12),
      shardId: e.shardId,
      changes: e.changes,
      vd: e.aggregateValueDensity.toFixed(3),
      cumVd: e.cumulativeValueDensity.toFixed(3),
    })),
  };
}

export function getChainHead() {
  return chainHead;
}

export function getChain(sinceHeight = 0) {
  return chain.filter(e => e.height >= sinceHeight);
}

// ============ HTTP Handler ============

export function handleKnowledgeChainRequest(path, method) {
  if (path === '/knowledge-chain/head' && method === 'GET') return 'head';
  if (path === '/knowledge-chain/stats' && method === 'GET') return 'stats';
  if (path === '/knowledge-chain/epoch' && method === 'POST') return 'epoch';
  if (path.startsWith('/knowledge-chain/chain') && method === 'GET') return 'chain';
  return null;
}

export function processKnowledgeChainBody(handler, body, query) {
  switch (handler) {
    case 'head': return getChainHead() || { height: 0, cumulativeValueDensity: 0 };
    case 'stats': return getChainStats();
    case 'epoch': return { accepted: receiveEpoch(body) };
    case 'chain': return { epochs: getChain(parseInt(query?.since || '0')) };
    default: return { error: 'Unknown handler' };
  }
}
