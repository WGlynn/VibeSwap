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
import { writeFile, readFile, appendFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { mkdir } from 'fs/promises';
import { config } from './config.js';
import { getShardInfo, getShardPeers } from './shard.js';

// ============ Constants ============

const EPOCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — aligned with flush cycle
const MAX_CHAIN_LENGTH = 1000; // Keep last 1000 epochs
const HTTP_TIMEOUT_MS = 3000;
const MAX_MISSED_EPOCHS_PER_PEER = 10;
const WAL_FILE = join(config.dataDir, 'knowledge', 'wal.jsonl');
const MISSED_EPOCHS_FILE = join(config.dataDir, 'knowledge', 'missed-epochs.json');
const CHAIN_FILE = join(config.dataDir, 'knowledge', 'chain.json');

// NC-Max constants — propose/commit pipelining
const PROPOSAL_WINDOW_EPOCHS = 2; // Changes must be proposed N epochs before commitment
const COMPACT_SHORTID_BYTES = 6; // 48-bit shortids for compact epochs
const FRESHNESS_PENALTY = 0.5; // VD multiplier for epochs containing fresh changes
const PRE_PROPAGATION_DEBOUNCE_MS = 2000; // Batch pre-propagation announcements

// ============ State ============

let chain = []; // Local chain of epochs
let pendingChanges = []; // Changes accumulated since last epoch
let chainHead = null; // Current chain tip
const missedEpochs = new Map(); // peerId -> epoch[] (capped at MAX_MISSED_EPOCHS_PER_PEER)

// NC-Max state — propose/commit pipeline
const proposedChanges = new Map(); // changeHash -> { change, proposedAt, epoch }
const peerChangePool = new Map(); // changeHash -> change (changes announced by peers, not yet in epoch)
let prePropagationQueue = []; // Changes waiting to be announced to peers
let prePropagationTimer = null;

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

  // Extract file_sync changes to carry inline (peers need the content)
  const fileSyncData = changes
    .filter(c => c.type === 'file_sync' && c.content)
    .map(c => ({ type: c.type, path: c.path, contentHash: c.contentHash, content: c.content, size: c.size }));

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
    fileSyncData: fileSyncData.length > 0 ? fileSyncData : undefined,
    hash: '', // Computed below
  };

  // Epoch hash = hash of all fields (self-referential like a block hash)
  epoch.hash = hashEpoch(epoch);

  return epoch;
}

// ============ Chain Operations ============

export async function addChange(change) {
  const entry = {
    ...change,
    timestamp: new Date().toISOString(),
  };
  pendingChanges.push(entry);
  // Append to WAL immediately (crash-safe — survives restarts)
  try {
    await appendFile(WAL_FILE, JSON.stringify(entry) + '\n');
  } catch { /* first write or dir missing — non-fatal */ }

  // NC-Max: pre-propagate immediately (peers cache for compact epoch reconstruction)
  try {
    const changeHash = hashChange(entry);
    queuePrePropagation(entry, changeHash);
  } catch { /* non-fatal — epoch still works without pre-propagation */ }
}

// ============ NC-Max: Change Pre-Propagation (Two-Step Mechanism) ============
//
// NC-Max insight: "fresh transactions" (changes peers haven't seen) are the bottleneck.
// Solution: propagate change hashes IMMEDIATELY when added, before the epoch.
// When the epoch arrives, peers already have the changes in their pool.
// Epoch propagation becomes size-independent (like compact blocks).
//
// Step 1: PROPOSE — change hash announced to all peers immediately
// Step 2: COMMIT — epoch confirms only pre-propagated changes
//
// Fresh changes (not pre-propagated) still get included but receive a VD penalty,
// disincentivizing information asymmetry (transaction withholding defense).

function hashChange(change) {
  return createHash('sha256').update(JSON.stringify(change)).digest('hex').slice(0, 32);
}

function computeShortId(changeHash, epochSalt) {
  // Compact block-style shortid: siphash-like truncation
  return createHash('sha256')
    .update(changeHash + (epochSalt || ''))
    .digest('hex')
    .slice(0, COMPACT_SHORTID_BYTES * 2); // hex chars = 2x bytes
}

/**
 * Pre-propagate a change to peers immediately (NC-Max Step 1: PROPOSE).
 * Called automatically by addChange(). Peers store in their peerChangePool.
 * When the epoch arrives, they can reconstruct from shortids.
 */
function queuePrePropagation(change, changeHash) {
  // Track locally as proposed
  proposedChanges.set(changeHash, {
    change,
    proposedAt: Date.now(),
    epoch: chainHead?.height || 0,
  });

  prePropagationQueue.push({ hash: changeHash, change });

  // Debounce: batch announcements every 2s to avoid per-change HTTP spam
  if (!prePropagationTimer) {
    prePropagationTimer = setTimeout(() => flushPrePropagation(), PRE_PROPAGATION_DEBOUNCE_MS);
  }
}

async function flushPrePropagation() {
  prePropagationTimer = null;
  if (prePropagationQueue.length === 0) return;

  const batch = prePropagationQueue.splice(0);
  const peers = getShardPeers();
  if (peers.length === 0) return;

  const shardInfo = getShardInfo();
  const announcement = {
    type: 'change_announcement',
    shardId: shardInfo?.id || 'shard-0',
    changes: batch.map(b => ({
      hash: b.hash,
      // Include full change content (small — typically <500 bytes)
      // This is the "pre-propagation" — peers cache it for epoch reconstruction
      content: b.change,
    })),
    timestamp: new Date().toISOString(),
  };

  // Best-effort broadcast — failures are non-fatal (epoch still works, just slower)
  for (const peer of peers) {
    try {
      await fetch(`${peer.url}/knowledge-chain/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(announcement),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch { /* non-fatal — epoch will carry full content as fallback */ }
  }
}

/**
 * Receive pre-propagated changes from a peer (NC-Max Step 1 receiver).
 * Stores changes in peerChangePool for later epoch reconstruction.
 */
export function receiveChangeAnnouncement(announcement) {
  if (!announcement?.changes || !Array.isArray(announcement.changes)) return 0;

  let added = 0;
  for (const item of announcement.changes) {
    if (!item.hash || peerChangePool.has(item.hash)) continue;
    peerChangePool.set(item.hash, item.content);
    added++;
  }

  // Cap pool size to prevent memory bloat
  if (peerChangePool.size > 5000) {
    // Evict oldest entries (Map preserves insertion order)
    const excess = peerChangePool.size - 5000;
    const keys = peerChangePool.keys();
    for (let i = 0; i < excess; i++) keys.next().value && peerChangePool.delete(keys.next().value);
  }

  return added;
}

// ============ NC-Max: Compact Epochs ============
//
// Instead of full changes, epochs carry shortids.
// Receiver reconstructs from peerChangePool + requests missing.
// Epoch propagation latency becomes independent of change count.

function buildCompactEpoch(epoch, changes) {
  const salt = epoch.hash.slice(0, 16);
  const shortids = changes.map(c => computeShortId(hashChange(c), salt));

  // Track freshness: how many changes were NOT pre-propagated
  const freshCount = changes.filter(c => {
    const h = hashChange(c);
    return !proposedChanges.has(h);
  }).length;

  return {
    height: epoch.height,
    hash: epoch.hash,
    parentHash: epoch.parentHash,
    salt,
    shortids,
    // Pre-filled: changes that are likely fresh (peer probably doesn't have them)
    // Analogous to compact block "prefilled transactions"
    prefilled: changes.filter(c => !proposedChanges.has(hashChange(c))),
    freshCount,
    totalCount: changes.length,
    // Full epoch fields for fallback
    merkleRoot: epoch.merkleRoot,
    shardId: epoch.shardId,
    timestamp: epoch.timestamp,
    aggregateValueDensity: epoch.aggregateValueDensity,
    cumulativeValueDensity: epoch.cumulativeValueDensity,
    fileSyncData: epoch.fileSyncData,
  };
}

/**
 * Reconstruct full changes from a compact epoch using local change pool.
 * Returns { changes, missing } — missing shortids need explicit request.
 */
export function reconstructFromCompact(compactEpoch) {
  if (!compactEpoch.shortids) return { changes: [], missing: [] };

  const salt = compactEpoch.salt;
  const changes = [];
  const missing = [];

  // Build reverse lookup: shortid -> change from our pools
  const localPool = new Map();
  for (const [hash, change] of peerChangePool) {
    const sid = computeShortId(hash, salt);
    localPool.set(sid, change);
  }
  for (const [hash, info] of proposedChanges) {
    const sid = computeShortId(hash, salt);
    if (!localPool.has(sid)) localPool.set(sid, info.change);
  }

  // Add prefilled changes first (these are "fresh" — guaranteed available)
  const prefilledSids = new Set();
  if (compactEpoch.prefilled) {
    for (const c of compactEpoch.prefilled) {
      const sid = computeShortId(hashChange(c), salt);
      prefilledSids.add(sid);
      localPool.set(sid, c);
    }
  }

  // Reconstruct
  for (const sid of compactEpoch.shortids) {
    if (localPool.has(sid)) {
      changes.push(localPool.get(sid));
    } else {
      missing.push(sid);
    }
  }

  return { changes, missing };
}

// ============ NC-Max: Freshness Penalty (Anti-Withholding) ============
//
// Epochs containing high % of fresh (not pre-propagated) changes get
// a VD penalty in fork resolution. This disincentivizes shards from
// deliberately withholding changes to gain propagation advantage.
//
// Analogous to NC-Max's defense against transaction withholding attacks.

export function computeFreshnessPenalty(compactEpoch) {
  if (!compactEpoch || compactEpoch.totalCount === 0) return 1.0;
  const freshRatio = (compactEpoch.freshCount || 0) / compactEpoch.totalCount;
  // Linear penalty: 0% fresh = 1.0x VD, 100% fresh = FRESHNESS_PENALTY x VD
  return 1.0 - (freshRatio * (1.0 - FRESHNESS_PENALTY));
}

// ============ File Sync — Shard-to-Shard File Relay ============
// When a memory file or SESSION_STATE changes, propagate via knowledge chain.
// This makes shards independent of GitHub — peer-to-peer file relay.

const FILE_SYNC_MAX_INLINE = 4096; // Only inline content under 4KB
const syncedFileHashes = new Map(); // path -> contentHash (dedup)
const syncedFileInventory = new Map(); // path -> { hash, size, lastUpdated }

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 32);
}

/**
 * Sync a file change across the shard network via knowledge chain epochs.
 * Call this when a memory file, CKB, or SESSION_STATE changes.
 */
export async function syncFileChange(filePath, content) {
  const contentHash = hashContent(content);

  // Dedup: don't re-sync if hash hasn't changed
  if (syncedFileHashes.get(filePath) === contentHash) return false;
  syncedFileHashes.set(filePath, contentHash);

  // Update inventory
  syncedFileInventory.set(filePath, {
    hash: contentHash,
    size: content.length,
    lastUpdated: Date.now(),
  });

  await addChange({
    type: 'file_sync',
    path: filePath,
    contentHash,
    // Only inline content under threshold; larger files served on demand
    content: content.length <= FILE_SYNC_MAX_INLINE ? content : null,
    size: content.length,
  });

  console.log(`[knowledge-chain] File sync queued: ${filePath} (${content.length} chars, hash: ${contentHash.slice(0, 12)})`);
  return true;
}

/**
 * Apply file_sync changes from a received epoch.
 * Writes synced files to local disk.
 */
async function applyFileSyncChanges(epochChanges) {
  if (!Array.isArray(epochChanges)) return;
  for (const change of epochChanges) {
    if (change.type !== 'file_sync' || !change.content || !change.path) continue;

    // Don't overwrite if we already have the same hash
    if (syncedFileHashes.get(change.path) === change.contentHash) continue;

    try {
      // Ensure directory exists
      const dir = dirname(change.path);
      await mkdir(dir, { recursive: true });

      await writeFile(change.path, change.content, 'utf-8');
      syncedFileHashes.set(change.path, change.contentHash);
      syncedFileInventory.set(change.path, {
        hash: change.contentHash,
        size: change.size || change.content.length,
        lastUpdated: Date.now(),
      });
      console.log(`[knowledge-chain] File synced from peer: ${change.path} (${change.content.length} chars)`);
    } catch (err) {
      console.warn(`[knowledge-chain] File sync write failed for ${change.path}: ${err.message}`);
    }
  }
}

/**
 * Get inventory of all synced files (for peer bootstrap).
 */
export function getFileInventory() {
  const inventory = [];
  for (const [path, info] of syncedFileInventory) {
    inventory.push({ path, hash: info.hash, size: info.size, lastUpdated: info.lastUpdated });
  }
  return inventory;
}

/**
 * Get content of a synced file by path (for peer bootstrap).
 */
export async function getFileContent(filePath) {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Bootstrap files from a peer (when booting without git).
 */
export async function bootstrapFilesFromPeer(peerUrl) {
  try {
    const response = await fetch(`${peerUrl}/knowledge/files`, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS * 3),
    });
    const inventory = await response.json();

    let synced = 0;
    for (const file of inventory) {
      // Skip if we already have this version
      if (syncedFileHashes.get(file.path) === file.hash) continue;

      try {
        const contentResponse = await fetch(
          `${peerUrl}/knowledge/file?path=${encodeURIComponent(file.path)}`,
          { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS * 2) }
        );
        if (contentResponse.ok) {
          const content = await contentResponse.text();
          const dir = dirname(file.path);
          await mkdir(dir, { recursive: true });
          await writeFile(file.path, content, 'utf-8');
          syncedFileHashes.set(file.path, file.hash);
          syncedFileInventory.set(file.path, { hash: file.hash, size: file.size, lastUpdated: Date.now() });
          synced++;
        }
      } catch { /* individual file failure is non-fatal */ }
    }

    if (synced > 0) {
      console.log(`[knowledge-chain] Bootstrapped ${synced} files from peer ${peerUrl}`);
    }
    return synced;
  } catch (err) {
    console.warn(`[knowledge-chain] Bootstrap from ${peerUrl} failed: ${err.message}`);
    return 0;
  }
}

// ============ WAL Recovery ============

export async function recoverWAL() {
  try {
    const data = await readFile(WAL_FILE, 'utf-8');
    const lines = data.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return 0;
    for (const line of lines) {
      try {
        pendingChanges.push(JSON.parse(line));
      } catch { /* skip corrupt line */ }
    }
    console.log(`[knowledge-chain] WAL recovery: ${lines.length} pending changes restored`);
    return lines.length;
  } catch {
    return 0; // No WAL file — clean start
  }
}

async function truncateWAL() {
  try {
    await writeFile(WAL_FILE, '');
  } catch { /* non-fatal */ }
}

export async function produceEpoch() {
  if (pendingChanges.length === 0) return null;

  const changes = [...pendingChanges];
  pendingChanges = [];

  const epoch = createEpoch(changes, chainHead?.hash);

  // NC-Max: compute freshness metrics for this epoch
  let freshCount = 0;
  for (const c of changes) {
    const ch = hashChange(c);
    if (!proposedChanges.has(ch)) freshCount++;
  }
  epoch.freshCount = freshCount;
  epoch.totalCount = changes.length;
  // Re-hash with freshness metadata included
  epoch.hash = hashEpoch(epoch);

  // Store compact epoch data for peers requesting shortids
  epoch._compactData = buildCompactEpoch(epoch, changes);
  epoch._fullChanges = changes; // Keep for broadcastEpoch fallback

  chain.push(epoch);
  chainHead = epoch;

  // WAL served its purpose — truncate after successful epoch
  await truncateWAL();

  // Trim chain to max length (light nodes prune, full/archive retain)
  const shardInfo = getShardInfo();
  if (shardInfo?.nodeType === 'light' && chain.length > MAX_CHAIN_LENGTH) {
    chain = chain.slice(-MAX_CHAIN_LENGTH);
  }

  // NC-Max: prune old proposed changes (older than 2 epochs)
  const pruneThreshold = (chainHead?.height || 0) - PROPOSAL_WINDOW_EPOCHS;
  for (const [hash, info] of proposedChanges) {
    if (info.epoch < pruneThreshold) proposedChanges.delete(hash);
  }

  const freshPct = changes.length > 0 ? Math.round(freshCount / changes.length * 100) : 0;
  console.log(`[knowledge-chain] Epoch ${epoch.height}: ${changes.length} changes (${freshCount} fresh/${freshPct}%), VD=${epoch.aggregateValueDensity.toFixed(3)}, cumVD=${epoch.cumulativeValueDensity.toFixed(3)}`);

  return epoch;
}

// ============ Fork Resolution (Proof of Mind + NC-Max Freshness) ============

export function resolveFork(localChain, remoteChain) {
  if (!remoteChain || remoteChain.length === 0) return 'local';
  if (!localChain || localChain.length === 0) return 'remote';

  const localHead = localChain[localChain.length - 1];
  const remoteHead = remoteChain[remoteChain.length - 1];

  // NC-Max freshness penalty: apply to cumulative VD if epoch has fresh change metadata
  const localPenalty = computeFreshnessPenalty(localHead);
  const remotePenalty = computeFreshnessPenalty(remoteHead);
  const localEffectiveVD = (localHead.cumulativeValueDensity || 0) * localPenalty;
  const remoteEffectiveVD = (remoteHead.cumulativeValueDensity || 0) * remotePenalty;

  // Proof of Mind: highest effective cumulative value density wins
  if (remoteEffectiveVD > localEffectiveVD) {
    return 'remote';
  }
  if (localEffectiveVD > remoteEffectiveVD) {
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
      const response = await fetch(`${peer.url}/knowledge-chain/epoch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(epoch),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      const result = await response.json();
      if (!result.accepted) {
        queueMissedEpoch(peer.shardId, epoch);
      }
    } catch {
      // Peer unreachable — queue for retry
      queueMissedEpoch(peer.shardId, epoch);
    }
  }
}

// ============ Missed Epoch Queue ============

function queueMissedEpoch(peerId, epoch) {
  if (!missedEpochs.has(peerId)) {
    missedEpochs.set(peerId, []);
  }
  const queue = missedEpochs.get(peerId);
  // Cap to prevent unbounded growth
  if (queue.length >= MAX_MISSED_EPOCHS_PER_PEER) {
    queue.shift(); // Drop oldest
  }
  queue.push(epoch);
}

export async function retryMissedEpochs() {
  for (const [peerId, epochs] of missedEpochs) {
    if (epochs.length === 0) continue;
    const peers = getShardPeers();
    const peer = peers.find(p => p.shardId === peerId);
    if (!peer) {
      missedEpochs.delete(peerId);
      continue;
    }
    // Retry oldest first — break on first failure (peer still down)
    while (epochs.length > 0) {
      const epoch = epochs[0];
      try {
        const response = await fetch(`${peer.url}/knowledge-chain/epoch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(epoch),
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
        const result = await response.json();
        epochs.shift(); // Delivered
        if (!result.accepted) break; // Peer rejected — don't hammer
      } catch {
        break; // Still down — stop retrying this peer
      }
    }
    if (epochs.length === 0) missedEpochs.delete(peerId);
  }
}

// ============ Receive Remote Epoch ============

export async function receiveEpoch(epoch) {
  // Validate epoch hash
  const expectedHash = hashEpoch({ ...epoch, hash: '' });
  if (expectedHash !== epoch.hash) {
    console.warn(`[knowledge-chain] Invalid epoch from ${epoch.shardId}: hash mismatch`);
    return false;
  }

  // NC-Max: log freshness of received epoch
  if (epoch.totalCount > 0) {
    const freshPct = Math.round((epoch.freshCount || 0) / epoch.totalCount * 100);
    if (freshPct > 50) {
      console.warn(`[knowledge-chain] High freshness epoch from ${epoch.shardId}: ${freshPct}% fresh (possible withholding)`);
    }
  }

  // If this extends our chain
  if (epoch.parentHash === chainHead?.hash) {
    // Apply any file_sync changes from this epoch
    if (epoch.fileSyncData) {
      await applyFileSyncChanges(epoch.fileSyncData);
    }
    chain.push(epoch);
    chainHead = epoch;
    return true;
  }

  // Fork detected — attempt resolution by fetching remote chain
  console.log(`[knowledge-chain] Fork detected: epoch ${epoch.height} from ${epoch.shardId} (parent ${epoch.parentHash.slice(0, 8)} !== our head ${chainHead?.hash.slice(0, 8)})`);

  // Find the peer that sent this epoch and fetch their full chain
  const peers = getShardPeers();
  const sourcePeer = peers.find(p => p.shardId === epoch.shardId);
  if (sourcePeer) {
    try {
      const chainResponse = await fetch(`${sourcePeer.url}/knowledge-chain/chain?since=0`, {
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS * 2), // Give extra time for full chain
      });
      const remoteData = await chainResponse.json();
      const remoteChain = remoteData.epochs || [];
      if (remoteChain.length > 0) {
        const accepted = acceptRemoteChain(remoteChain);
        if (accepted) {
          console.log(`[knowledge-chain] Fork resolved: accepted remote chain from ${epoch.shardId} (${remoteChain.length} epochs)`);
          return true;
        }
      }
    } catch (err) {
      console.warn(`[knowledge-chain] Fork resolution failed for ${epoch.shardId}: ${err.message}`);
    }
  }

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
    // NC-Max: freshness metadata included in hash commitment
    freshCount: epoch.freshCount || 0,
    totalCount: epoch.totalCount || epoch.changes,
  });
  return createHash('sha256').update(data).digest('hex').slice(0, 32);
}

export function computeMerkleRoot(changes) {
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

// ============ Chain & Missed Epoch Persistence ============

export async function persistChain() {
  try {
    await writeFile(CHAIN_FILE, JSON.stringify({
      chain: chain.slice(-MAX_CHAIN_LENGTH),
      head: chainHead,
    }));
  } catch {}
  // Persist missed epochs
  try {
    const obj = {};
    for (const [k, v] of missedEpochs) obj[k] = v;
    if (Object.keys(obj).length > 0) {
      await writeFile(MISSED_EPOCHS_FILE, JSON.stringify(obj));
    }
  } catch {}
}

export async function recoverChain() {
  // Recover chain state
  try {
    const data = await readFile(CHAIN_FILE, 'utf-8');
    const saved = JSON.parse(data);
    if (saved.chain?.length > 0) {
      chain = saved.chain;
      chainHead = saved.head || chain[chain.length - 1];
      console.log(`[knowledge-chain] Recovered chain: ${chain.length} epochs, head at height ${chainHead.height}`);
    }
  } catch { /* clean start */ }
  // Recover missed epochs
  try {
    const data = await readFile(MISSED_EPOCHS_FILE, 'utf-8');
    const obj = JSON.parse(data);
    for (const [k, v] of Object.entries(obj)) {
      missedEpochs.set(k, v);
    }
    if (Object.keys(obj).length > 0) {
      console.log(`[knowledge-chain] Recovered ${Object.keys(obj).length} peers with missed epochs`);
    }
  } catch { /* clean start */ }
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
    // NC-Max pipeline stats
    ncmax: {
      proposedChanges: proposedChanges.size,
      peerChangePool: peerChangePool.size,
      prePropagationQueue: prePropagationQueue.length,
      proposalWindowEpochs: PROPOSAL_WINDOW_EPOCHS,
      freshnessPenalty: FRESHNESS_PENALTY,
    },
    recentEpochs: chain.slice(-5).map(e => ({
      height: e.height,
      hash: e.hash.slice(0, 12),
      shardId: e.shardId,
      changes: e.changes,
      vd: e.aggregateValueDensity.toFixed(3),
      cumVd: e.cumulativeValueDensity.toFixed(3),
      freshCount: e.freshCount || 0,
    })),
  };
}

export function getChainHead() {
  return chainHead;
}

export function getChain(sinceHeight = 0) {
  return chain.filter(e => e.height >= sinceHeight);
}

// ============ Harmonic Tick ============
// All shards compute "next multiple of intervalMs from Unix epoch 0".
// Shard-0 booting at t=12345 and shard-1 booting at t=67890 both fire at t=300000.
// Result: all shards pulse together like a metronome.

export function scheduleHarmonicTick(callback, intervalMs) {
  const now = Date.now();
  const nextTick = Math.ceil(now / intervalMs) * intervalMs;
  const delay = nextTick - now;

  console.log(`[knowledge-chain] Harmonic tick: next fire in ${Math.round(delay / 1000)}s (aligned to ${new Date(nextTick).toISOString()})`);

  // First tick: align to wall clock
  const firstTimer = setTimeout(() => {
    callback();
    // Subsequent ticks: regular interval from this aligned point
    setInterval(callback, intervalMs);
  }, delay);

  return firstTimer;
}

// ============ HTTP Handler ============

export function handleKnowledgeChainRequest(path, method) {
  if (path === '/knowledge-chain/head' && method === 'GET') return 'head';
  if (path === '/knowledge-chain/stats' && method === 'GET') return 'stats';
  if (path === '/knowledge-chain/epoch' && method === 'POST') return 'epoch';
  if (path === '/knowledge-chain/announce' && method === 'POST') return 'announce';
  if (path.startsWith('/knowledge-chain/chain') && method === 'GET') return 'chain';
  // File sync endpoints — peer bootstrap (GitHub-free recovery)
  if (path === '/knowledge/files' && method === 'GET') return 'files';
  if (path === '/knowledge/file' && method === 'GET') return 'file';
  return null;
}

export async function processKnowledgeChainBody(handler, body, query) {
  switch (handler) {
    case 'head': return getChainHead() || { height: 0, cumulativeValueDensity: 0 };
    case 'stats': return getChainStats();
    case 'epoch': return { accepted: await receiveEpoch(body) };
    case 'announce': return { added: receiveChangeAnnouncement(body) };
    case 'chain': return { epochs: getChain(parseInt(query?.since || '0')) };
    case 'files': return getFileInventory();
    case 'file': {
      const filePath = query?.path;
      if (!filePath) return { error: 'Missing path parameter' };
      const content = await getFileContent(filePath);
      return content !== null ? { content } : { error: 'File not found' };
    }
    default: return { error: 'Unknown handler' };
  }
}
