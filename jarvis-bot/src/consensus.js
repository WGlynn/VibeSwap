// ============ BFT Consensus — Tendermint-Lite for JARVIS Mind Network ============
//
// Simplified Tendermint-style BFT consensus for network-level knowledge changes.
// Not a full blockchain — just consensus on state transitions that affect ALL shards.
//
// What requires consensus (Network tier):
//   - Skill promotion from correction (changes global behavior)
//   - Behavior flag changes (affects all shards)
//   - Inner dialogue promotion to network knowledge
//   - Agent registration/capability changes
//
// What does NOT require consensus (Private tier):
//   - Per-user CKB updates (local only)
//   - Conversation history (shard-local)
//   - User preferences (shard-local)
//
// Protocol (per-proposal, round-based):
//   1. PROPOSE: Shard broadcasts proposal { type, data, proposer, round }
//   2. PREVOTE: Each shard validates + votes { accept | reject }
//      Collect +2/3 prevotes → proceed
//   3. PRECOMMIT: Shards that saw +2/3 prevotes broadcast precommit
//      Collect +2/3 precommits → COMMIT
//   4. COMMIT: All shards apply the state transition
//
// Fault tolerance: With N shards, tolerates f < N/3 byzantine shards.
// Message transport: HTTP POST between shards (discovered via router).
//
// In single-shard mode: proposals auto-commit (no voting needed).
// ============

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { getShardInfo, getShardPeers } from './shard.js';

// ============ Constants ============

const PROPOSAL_TIMEOUT_MS = 15000; // 15s per round
const PHASE_TIMEOUT_MS = 5000; // 5s per phase within a round
const MAX_PENDING_PROPOSALS = 50;
const HTTP_TIMEOUT_MS = 3000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 5000;
const PROPOSAL_JOURNAL_FILE = join(config.dataDir, 'knowledge', 'proposal-journal.json');

// Proposal types that require BFT consensus
const PROPOSAL_TYPES = {
  SKILL_PROMOTION: 'skill_promotion',
  BEHAVIOR_CHANGE: 'behavior_change',
  INNER_PROMOTION: 'inner_promotion',
  AGENT_REGISTRATION: 'agent_registration',
  APOPTOSIS_BATCH: 'apoptosis_batch',
};

// Consensus phases
const PHASES = {
  PROPOSE: 'propose',
  PREVOTE: 'prevote',
  PRECOMMIT: 'precommit',
  COMMIT: 'commit',
};

// Vote types
const VOTES = {
  ACCEPT: 'accept',
  REJECT: 'reject',
};

// ============ Canonical JSON ============
// JSON.stringify key ordering is NOT stable across engines/versions.
// Canonical form: recursively sort object keys before stringifying.

function canonicalJSON(obj) {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJSON).join(',') + ']';
  if (typeof obj === 'object') {
    const sorted = Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonicalJSON(obj[k]));
    return '{' + sorted.join(',') + '}';
  }
  return JSON.stringify(obj);
}

// ============ HMAC Authentication for Inter-Shard Communication ============

function getShardSecret() {
  return config.shard?.secret || null;
}

function signPayload(data) {
  const secret = getShardSecret();
  if (!secret) return null;
  return createHmac('sha256', secret)
    .update(canonicalJSON(data))
    .digest('hex');
}

function verifyShardSignature(body, signature) {
  const secret = getShardSecret();
  if (!secret) return false; // Fail-closed: no secret = reject all
  if (!signature || typeof signature !== 'string') return false;
  const expected = createHmac('sha256', secret)
    .update(canonicalJSON(body))
    .digest('hex');
  try {
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

// ============ Replay Protection ============
// Track seen proposal IDs with per-entry timestamps to reject duplicates.
// Old entries expire individually (not all at once via global timer).

const seenProposals = new Map(); // id -> timestamp
const SEEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const SEEN_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Cleanup scan every 5 min
let lastSeenCleanup = Date.now();

function trackProposalId(id) {
  const now = Date.now();
  seenProposals.set(id, now);
  // Periodic cleanup: expire individual entries older than SEEN_EXPIRY_MS
  if (now - lastSeenCleanup > SEEN_CLEANUP_INTERVAL_MS) {
    for (const [key, ts] of seenProposals) {
      if (now - ts > SEEN_EXPIRY_MS) seenProposals.delete(key);
    }
    lastSeenCleanup = now;
  }
}

function isReplayedProposal(id) {
  if (!seenProposals.has(id)) return false;
  // Check if entry has expired (stale entries don't count as replays)
  const ts = seenProposals.get(id);
  if (Date.now() - ts > SEEN_EXPIRY_MS) {
    seenProposals.delete(id);
    return false;
  }
  return true;
}

// ============ State ============

let consensusEnabled = false;
const pendingProposals = new Map(); // proposalId -> ProposalState
const PROPOSAL_TTL_MS = 120000; // Auto-expire stuck proposals after 2 minutes
const committedProposals = []; // History of committed proposals
const committedIds = new Set(); // Dedup: track committed proposal hashes to prevent double-commit
const MAX_COMMITTED_IDS = 5000;
const commitHandlers = []; // Callbacks for committed state changes
const proposalHandlers = []; // Callbacks for incoming proposals (validation)
const retryQueue = []; // { proposal, retryCount, nextRetryAt }
const COMMITTED_IDS_FILE = join(config.dataDir, 'knowledge', 'committed-ids.json');

let roundCounter = 0;

// ============ Circuit Breaker ============
// Prevents consensus from flooding the event loop when all peers are unreachable.
// Opens after consecutive failures, backs off exponentially, auto-recovers.

const circuitBreaker = {
  failures: 0,
  state: 'closed', // closed (normal) | open (blocking) | half-open (testing)
  openedAt: 0,
  backoffMs: 30000, // Start at 30s, doubles each trip, max 5 min
  maxBackoffMs: 300000,
  failureThreshold: 1, // Open immediately on first all-peer failure
};

function cbTrip() {
  circuitBreaker.failures++;
  if (circuitBreaker.failures >= circuitBreaker.failureThreshold) {
    if (circuitBreaker.state !== 'open') {
      circuitBreaker.state = 'open';
      circuitBreaker.openedAt = Date.now();
      console.warn(`[consensus] Circuit breaker OPEN — all peers unreachable, backing off ${circuitBreaker.backoffMs / 1000}s`);
    }
  }
}

function cbSuccess() {
  if (circuitBreaker.state !== 'closed') {
    console.log(`[consensus] Circuit breaker CLOSED — peer reachable`);
  }
  circuitBreaker.failures = 0;
  circuitBreaker.state = 'closed';
  circuitBreaker.backoffMs = 30000;
}

function cbAllowRequest() {
  if (circuitBreaker.state === 'closed') return true;
  const elapsed = Date.now() - circuitBreaker.openedAt;
  if (elapsed >= circuitBreaker.backoffMs) {
    circuitBreaker.state = 'half-open';
    // Double backoff for next trip
    circuitBreaker.backoffMs = Math.min(circuitBreaker.backoffMs * 2, circuitBreaker.maxBackoffMs);
    return true;
  }
  return false;
}

// ============ Proposal State ============

function createProposalState(proposal) {
  return {
    id: proposal.id,
    type: proposal.type,
    data: proposal.data,
    proposer: proposal.proposer,
    round: proposal.round,
    phase: PHASES.PROPOSE,
    createdAt: Date.now(),
    prevotes: new Map(), // shardId -> vote
    precommits: new Map(), // shardId -> vote
    committed: false,
    timedOut: false,
  };
}

// ============ Init ============

export function initConsensus() {
  const shardInfo = getShardInfo();
  consensusEnabled = shardInfo && shardInfo.totalShards > 1;

  if (consensusEnabled) {
    console.log(`[consensus] BFT consensus ENABLED (${shardInfo.totalShards} shards, f < ${Math.floor(shardInfo.totalShards / 3)} byzantine tolerance)`);
    // Start proposal timeout checker
    setInterval(checkProposalTimeouts, PHASE_TIMEOUT_MS);
  } else {
    console.log('[consensus] Single-shard mode — proposals auto-commit.');
  }
}

/**
 * Dynamic activation: called when a new shard registers with the router.
 * Switches from single-shard to BFT mode when enough shards are online.
 */
export function recheckConsensusMode(liveShardCount) {
  if (consensusEnabled) return; // Already active
  if (liveShardCount > 1) {
    consensusEnabled = true;
    console.log(`[consensus] BFT ACTIVATED — ${liveShardCount} shards now online. Proposals require consensus.`);
    setInterval(checkProposalTimeouts, PHASE_TIMEOUT_MS);
  }
}

// ============ Propose ============

export async function propose(type, data) {
  const shardInfo = getShardInfo();
  roundCounter++;

  const proposal = {
    id: `prop-${Date.now()}-${randomBytes(4).toString('hex')}`,
    type,
    data,
    proposer: shardInfo?.id || 'shard-0',
    round: roundCounter,
    hash: hashProposal(type, data),
  };

  // Single-shard mode: auto-commit (with dedup)
  if (!consensusEnabled) {
    const dedupKey = hashProposal(type, data);
    if (committedIds.has(dedupKey)) {
      console.warn(`[consensus] Duplicate auto-commit blocked: ${type}`);
      return { proposal, committed: false, duplicate: true };
    }
    console.log(`[consensus] Auto-commit (single shard): ${type}`);
    committedIds.add(dedupKey);
    const result = { proposal, committed: true, phase: PHASES.COMMIT };
    for (const handler of commitHandlers) {
      try { await handler(type, data, proposal); } catch (err) {
        console.error(`[consensus] Commit handler error: ${err.message}`);
      }
    }
    committedProposals.push({ ...proposal, committedAt: new Date().toISOString() });
    persistCommittedIds();
    return result;
  }

  // Circuit breaker: don't create proposals when peers are unreachable
  // (prevents timeout → retry → new proposal → timeout cycle)
  if (!cbAllowRequest()) {
    return { proposal, committed: false, circuitOpen: true };
  }

  // Multi-shard: start BFT round
  const state = createProposalState(proposal);
  pendingProposals.set(proposal.id, state);

  // Self-prevote (proposer always accepts own proposal)
  state.prevotes.set(shardInfo.id, VOTES.ACCEPT);

  // Broadcast proposal to all peers
  const peers = getShardPeers();
  await broadcastToPeers(peers, '/consensus/propose', proposal);

  console.log(`[consensus] Proposed: ${type} (${proposal.id}), broadcasting to ${peers.length} peers`);

  // Wait for consensus (or timeout)
  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      const current = pendingProposals.get(proposal.id);
      if (!current) {
        clearInterval(checkInterval);
        resolve({ proposal, committed: false, timedOut: true });
        return;
      }
      if (current.committed) {
        clearInterval(checkInterval);
        resolve({ proposal, committed: true, phase: PHASES.COMMIT });
        return;
      }
      if (current.timedOut) {
        clearInterval(checkInterval);
        resolve({ proposal, committed: false, timedOut: true });
        return;
      }
    }, 500);

    // Hard timeout
    setTimeout(() => {
      clearInterval(checkInterval);
      const current = pendingProposals.get(proposal.id);
      if (current && !current.committed) {
        current.timedOut = true;
        pendingProposals.delete(proposal.id);
        resolve({ proposal, committed: false, timedOut: true });
      }
    }, PROPOSAL_TIMEOUT_MS);
  });
}

// ============ Handle Incoming Proposal ============

export async function handleProposal(proposal) {
  if (!consensusEnabled) return; // Single-shard mode — reject incoming proposals
  const shardInfo = getShardInfo();
  if (!shardInfo) return;

  // Validate proposal
  let vote = VOTES.ACCEPT;
  for (const handler of proposalHandlers) {
    try {
      const result = await handler(proposal.type, proposal.data, proposal);
      if (result === false) {
        vote = VOTES.REJECT;
        break;
      }
    } catch {
      vote = VOTES.REJECT;
    }
  }

  // Track proposal state locally
  if (!pendingProposals.has(proposal.id)) {
    pendingProposals.set(proposal.id, createProposalState(proposal));
  }

  // Send prevote
  const prevote = {
    proposalId: proposal.id,
    proposalHash: proposal.hash,
    vote,
    shardId: shardInfo.id,
  };

  const peers = getShardPeers();
  await broadcastToPeers(peers, '/consensus/prevote', prevote);

  return prevote;
}

// ============ Handle Prevote ============

export async function handlePrevote(prevote) {
  if (!consensusEnabled) return;
  const state = pendingProposals.get(prevote.proposalId);
  if (!state || state.committed) return;

  // Validate that the prevote's proposal hash matches the actual proposal data hash.
  // Prevents a byzantine node from voting on a different proposal under the same ID.
  const expectedHash = hashProposal(state.type, state.data);
  if (prevote.proposalHash && prevote.proposalHash !== expectedHash) {
    console.warn(`[consensus] Rejected prevote from ${prevote.shardId}: proposalHash mismatch (got ${prevote.proposalHash}, expected ${expectedHash})`);
    return;
  }

  state.prevotes.set(prevote.shardId, prevote.vote);

  // Check if we have 2/3 prevotes
  const totalShards = getShardInfo()?.totalShards || 1;
  const requiredVotes = Math.ceil((totalShards * 2) / 3);
  const acceptCount = Array.from(state.prevotes.values()).filter(v => v === VOTES.ACCEPT).length;

  if (acceptCount >= requiredVotes && state.phase === PHASES.PROPOSE) {
    state.phase = PHASES.PREVOTE;

    // Send precommit
    const shardInfo = getShardInfo();
    const precommit = {
      proposalId: prevote.proposalId,
      proposalHash: state.id,
      vote: VOTES.ACCEPT,
      shardId: shardInfo.id,
    };

    state.precommits.set(shardInfo.id, VOTES.ACCEPT);

    const peers = getShardPeers();
    await broadcastToPeers(peers, '/consensus/precommit', precommit);
  }
}

// ============ Handle Precommit ============

export async function handlePrecommit(precommit) {
  if (!consensusEnabled) return;
  const state = pendingProposals.get(precommit.proposalId);
  if (!state || state.committed) return;

  state.precommits.set(precommit.shardId, precommit.vote);

  // Check if we have 2/3 precommits
  const totalShards = getShardInfo()?.totalShards || 1;
  const requiredVotes = Math.ceil((totalShards * 2) / 3);
  const acceptCount = Array.from(state.precommits.values()).filter(v => v === VOTES.ACCEPT).length;

  if (acceptCount >= requiredVotes && !state.committed) {
    // Dedup check — prevent double-commit of same proposal content
    const dedupKey = hashProposal(state.type, state.data);
    if (committedIds.has(dedupKey)) {
      console.warn(`[consensus] Duplicate commit blocked: ${state.type} (${state.id}) — content already committed`);
      pendingProposals.delete(state.id);
      return;
    }

    state.committed = true;
    state.phase = PHASES.COMMIT;
    committedIds.add(dedupKey);

    // Execute commit handlers
    for (const handler of commitHandlers) {
      try {
        await handler(state.type, state.data, { id: state.id, proposer: state.proposer });
      } catch (err) {
        console.error(`[consensus] Commit handler error: ${err.message}`);
      }
    }

    committedProposals.push({
      id: state.id,
      type: state.type,
      proposer: state.proposer,
      round: state.round,
      committedAt: new Date().toISOString(),
      prevotes: state.prevotes.size,
      precommits: state.precommits.size,
    });

    pendingProposals.delete(state.id);
    persistCommittedIds(); // Best-effort persist
    console.log(`[consensus] COMMITTED: ${state.type} (${state.id}) — ${acceptCount}/${totalShards} precommits`);
  }
}

// ============ Event Handlers ============

export function onProposal(handler) {
  proposalHandlers.push(handler);
}

export function onCommit(handler) {
  commitHandlers.push(handler);
}

// ============ Broadcast ============

async function broadcastToPeers(peers, path, data) {
  // Circuit breaker: don't flood when all peers are down
  if (!cbAllowRequest()) return;

  // Filter self from peer list — self-success doesn't prove peers are reachable
  const flyAppName = process.env.FLY_APP_NAME || '';
  const shardInfo = getShardInfo();
  const remotePeers = peers.filter(p => {
    if (p.shardId === shardInfo?.id) return false;
    // Seed URLs use public hostnames — match by app name
    if (flyAppName && p.url?.includes(flyAppName)) return false;
    return true;
  });

  if (remotePeers.length === 0) return;

  const signature = signPayload(data);
  let successes = 0;
  const promises = remotePeers.map(async (peer) => {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (signature) headers['X-Shard-Signature'] = signature;
      const res = await fetch(`${peer.url}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (res.ok) successes++;
    } catch (err) {
      // Suppress repeated warnings when circuit breaker is half-open
      if (circuitBreaker.state !== 'half-open') {
        console.warn(`[consensus] Broadcast to ${peer.shardId} failed: ${err.message}`);
      }
    }
  });

  await Promise.allSettled(promises);

  // Track circuit breaker state
  if (successes > 0) {
    cbSuccess();
  } else {
    cbTrip();
  }
}

// ============ Timeout Checker ============

function checkProposalTimeouts() {
  const now = Date.now();
  for (const [id, state] of pendingProposals) {
    if (now - state.createdAt > PROPOSAL_TIMEOUT_MS && !state.committed) {
      state.timedOut = true;
      pendingProposals.delete(id);
      // Push to retry queue instead of silent discard (dedup by content hash)
      const contentHash = hashProposal(state.type, state.data);
      const existing = retryQueue.find(r => hashProposal(r.proposal.type, r.proposal.data) === contentHash);
      if (!existing && retryQueue.length < 10) { // Cap retry queue — prevent unbounded growth
        const retryCount = 0;
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, retryCount);
        retryQueue.push({
          proposal: { type: state.type, data: state.data },
          retryCount,
          nextRetryAt: now + delay,
        });
        console.warn(`[consensus] Proposal timed out → retry queue: ${id} (${state.type}) at phase ${state.phase}`);
      } else {
        console.warn(`[consensus] Proposal timed out (already queued): ${id} (${state.type})`);
      }
    }
  }
  processRetryQueue();
}

let retryQueueRunning = false;

async function processRetryQueue() {
  // Don't retry when circuit breaker is open — peers are down
  if (!cbAllowRequest()) return;
  // Prevent concurrent processRetryQueue calls (checkProposalTimeouts doesn't await)
  if (retryQueueRunning) return;
  retryQueueRunning = true;

  const now = Date.now();
  let i = 0;
  while (i < retryQueue.length) {
    const entry = retryQueue[i];
    if (now < entry.nextRetryAt) { i++; continue; }

    entry.retryCount++;
    if (entry.retryCount > MAX_RETRIES) {
      console.warn(`[consensus] Retry exhausted (${MAX_RETRIES}x): ${entry.proposal.type}`);
      retryQueue.splice(i, 1);
      continue;
    }

    // Re-propose — non-upgraded shards see this as a normal new proposal
    console.log(`[consensus] Retrying proposal: ${entry.proposal.type} (attempt ${entry.retryCount}/${MAX_RETRIES})`);
    try {
      const result = await propose(entry.proposal.type, entry.proposal.data);
      if (result.committed) {
        retryQueue.splice(i, 1);
        continue;
      }
      if (result.circuitOpen) {
        // Circuit breaker is open — stop processing retries entirely
        break;
      }
    } catch (err) {
      console.warn(`[consensus] Retry failed: ${err.message}`);
    }

    // Schedule next retry with exponential backoff
    entry.nextRetryAt = now + RETRY_BASE_DELAY_MS * Math.pow(2, entry.retryCount);
    i++;
  }
  retryQueueRunning = false;
  // Persist retry queue for crash recovery
  persistRetryQueue();
}

async function persistRetryQueue() {
  try {
    await writeFile(PROPOSAL_JOURNAL_FILE, JSON.stringify(retryQueue));
  } catch { /* non-fatal */ }
}

export async function recoverRetryQueue() {
  try {
    const data = await readFile(PROPOSAL_JOURNAL_FILE, 'utf-8');
    const entries = JSON.parse(data);
    // Dedup recovered entries by content hash
    const seen = new Set();
    let dedupCount = 0;
    for (const entry of entries) {
      if (!entry.proposal) continue;
      const hash = hashProposal(entry.proposal.type, entry.proposal.data);
      if (seen.has(hash)) { dedupCount++; continue; }
      seen.add(hash);
      retryQueue.push(entry);
    }
    if (retryQueue.length > 0 || dedupCount > 0) {
      console.log(`[consensus] Recovered ${retryQueue.length} proposals from journal (${dedupCount} duplicates removed)`);
    }
  } catch { /* no journal — clean start */ }
}

// ============ Committed IDs Persistence (Dedup) ============

async function persistCommittedIds() {
  try {
    // Cap in-memory Set to prevent unbounded growth
    if (committedIds.size > MAX_COMMITTED_IDS) {
      const keep = [...committedIds].slice(-Math.floor(MAX_COMMITTED_IDS * 0.8));
      committedIds.clear();
      for (const id of keep) committedIds.add(id);
    }
    // Keep last 1000 committed IDs on disk
    const ids = [...committedIds].slice(-1000);
    await writeFile(COMMITTED_IDS_FILE, JSON.stringify(ids));
  } catch { /* non-fatal */ }
}

export async function recoverCommittedIds() {
  try {
    const data = await readFile(COMMITTED_IDS_FILE, 'utf-8');
    const ids = JSON.parse(data);
    for (const id of ids) committedIds.add(id);
    if (ids.length > 0) {
      console.log(`[consensus] Recovered ${ids.length} committed IDs for dedup`);
    }
  } catch { /* clean start */ }
}

// ============ Hashing ============

function hashProposal(type, data) {
  return createHash('sha256')
    .update(canonicalJSON({ type, data }))
    .digest('hex')
    .slice(0, 16);
}

// ============ State Queries ============

export function getConsensusState() {
  return {
    enabled: consensusEnabled,
    pendingProposals: pendingProposals.size,
    committedTotal: committedProposals.length,
    recentCommits: committedProposals.slice(-10),
    roundCounter,
    pending: Array.from(pendingProposals.values()).map(s => ({
      id: s.id,
      type: s.type,
      phase: s.phase,
      proposer: s.proposer,
      prevotes: s.prevotes.size,
      precommits: s.precommits.size,
      age: Math.round((Date.now() - s.createdAt) / 1000),
    })),
  };
}

// ============ HTTP Handler (embeddable) ============

export function handleConsensusRequest(path, method) {
  if (path === '/consensus/propose' && method === 'POST') return 'propose';
  if (path === '/consensus/prevote' && method === 'POST') return 'prevote';
  if (path === '/consensus/precommit' && method === 'POST') return 'precommit';
  if (path === '/consensus/state' && method === 'GET') return 'state';
  return null;
}

// Rate-limited HMAC rejection logging — prevents log overflow from rogue/misconfigured shards
let _hmacRejectCount = 0;
let _hmacRejectWindowStart = 0;
const HMAC_LOG_INTERVAL = 60000; // Log summary every 60s instead of every message

export async function processConsensusBody(handler, body, signature) {
  // Authenticate inter-shard messages.
  // Fail-closed in multi-shard mode: if no secret is configured but peers exist, reject.
  if (handler !== 'state') {
    const secret = getShardSecret();
    const peers = getShardPeers();
    if (!secret && peers.length > 0) {
      console.warn(`[consensus] Rejected ${handler}: no shard secret configured but ${peers.length} peers exist — fail closed`);
      return { error: 'Authentication failed: no shard secret configured' };
    }
    if (secret) {
      if (!verifyShardSignature(body, signature)) {
        // Rate-limited logging — don't flood logs with repeated HMAC failures
        const now = Date.now();
        _hmacRejectCount++;
        if (now - _hmacRejectWindowStart > HMAC_LOG_INTERVAL) {
          if (_hmacRejectCount > 1) {
            console.warn(`[consensus] Rejected ${_hmacRejectCount} messages with invalid HMAC in last ${Math.round((now - _hmacRejectWindowStart) / 1000)}s (latest: ${handler} from ${body?.shardId || 'unknown'})`);
          } else {
            console.warn(`[consensus] Rejected ${handler}: invalid or missing HMAC signature (from ${body?.shardId || 'unknown'})`);
          }
          _hmacRejectCount = 0;
          _hmacRejectWindowStart = now;
        }
        return { error: 'Authentication failed' };
      }
    }
  }

  // Replay protection for proposals
  if (handler === 'propose' && body?.id) {
    if (isReplayedProposal(body.id)) {
      console.warn(`[consensus] Rejected replayed proposal: ${body.id}`);
      return { error: 'Duplicate proposal' };
    }
    trackProposalId(body.id);
  }

  switch (handler) {
    case 'propose': return await handleProposal(body);
    case 'prevote': return await handlePrevote(body);
    case 'precommit': return await handlePrecommit(body);
    case 'state': return getConsensusState();
    default: return { error: 'Unknown handler' };
  }
}

// ============ Exports ============

export { PROPOSAL_TYPES, PHASES, VOTES };
