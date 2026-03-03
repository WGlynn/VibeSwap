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

import { createHash, randomBytes } from 'crypto';
import { config } from './config.js';
import { getShardInfo, getShardPeers } from './shard.js';

// ============ Constants ============

const PROPOSAL_TIMEOUT_MS = 15000; // 15s per round
const PHASE_TIMEOUT_MS = 5000; // 5s per phase within a round
const MAX_PENDING_PROPOSALS = 50;
const HTTP_TIMEOUT_MS = 3000;

// Proposal types that require BFT consensus
const PROPOSAL_TYPES = {
  SKILL_PROMOTION: 'skill_promotion',
  BEHAVIOR_CHANGE: 'behavior_change',
  INNER_PROMOTION: 'inner_promotion',
  AGENT_REGISTRATION: 'agent_registration',
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

// ============ State ============

let consensusEnabled = false;
const pendingProposals = new Map(); // proposalId -> ProposalState
const committedProposals = []; // History of committed proposals
const commitHandlers = []; // Callbacks for committed state changes
const proposalHandlers = []; // Callbacks for incoming proposals (validation)

let roundCounter = 0;

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

  // Single-shard mode: auto-commit
  if (!consensusEnabled) {
    console.log(`[consensus] Auto-commit (single shard): ${type}`);
    const result = { proposal, committed: true, phase: PHASES.COMMIT };
    for (const handler of commitHandlers) {
      try { await handler(type, data, proposal); } catch (err) {
        console.error(`[consensus] Commit handler error: ${err.message}`);
      }
    }
    committedProposals.push({ ...proposal, committedAt: new Date().toISOString() });
    return result;
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
  const state = pendingProposals.get(prevote.proposalId);
  if (!state || state.committed) return;

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
  const state = pendingProposals.get(precommit.proposalId);
  if (!state || state.committed) return;

  state.precommits.set(precommit.shardId, precommit.vote);

  // Check if we have 2/3 precommits
  const totalShards = getShardInfo()?.totalShards || 1;
  const requiredVotes = Math.ceil((totalShards * 2) / 3);
  const acceptCount = Array.from(state.precommits.values()).filter(v => v === VOTES.ACCEPT).length;

  if (acceptCount >= requiredVotes && !state.committed) {
    state.committed = true;
    state.phase = PHASES.COMMIT;

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
  const promises = peers.map(async (peer) => {
    try {
      await fetch(`${peer.url}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      console.warn(`[consensus] Broadcast to ${peer.shardId} failed: ${err.message}`);
    }
  });

  await Promise.allSettled(promises);
}

// ============ Timeout Checker ============

function checkProposalTimeouts() {
  const now = Date.now();
  for (const [id, state] of pendingProposals) {
    if (now - state.createdAt > PROPOSAL_TIMEOUT_MS && !state.committed) {
      state.timedOut = true;
      pendingProposals.delete(id);
      console.warn(`[consensus] Proposal timed out: ${id} (${state.type}) at phase ${state.phase}`);
    }
  }
}

// ============ Hashing ============

function hashProposal(type, data) {
  return createHash('sha256')
    .update(JSON.stringify({ type, data }))
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

export async function processConsensusBody(handler, body) {
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
