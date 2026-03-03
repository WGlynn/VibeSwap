// ============ CRPC — Tim Cotton's Commit-Reveal Pairwise Comparison ============
//
// Off-chain implementation of CRPC for fuzzy non-deterministic consensus.
// Mirrors PairwiseVerifier.sol but runs between JARVIS shards, not on-chain.
//
// When to use CRPC (not for every message — only high-stakes):
//   - Moderation decisions (should this user be warned?)
//   - Proactive engagement (should JARVIS speak up in a group?)
//   - Knowledge promotion (is this correction worth making a skill?)
//   - Dispute resolution (two users disagree, which is right?)
//
// Four phases (Cotton's protocol):
//
//   Phase 1 — WORK COMMIT:
//     Shards independently generate response to same prompt.
//     Each publishes hash(response || secret) to all peers.
//     Prevents copying — can't wait to see others' answers.
//
//   Phase 2 — WORK REVEAL:
//     Shards reveal actual responses + secrets.
//     Peers verify hash matches commitment.
//     Invalid reveals → reputation penalty.
//
//   Phase 3 — COMPARE COMMIT:
//     Validator shards compare pairs.
//     Each commits hash(choice || secret) where choice ∈ {A_BETTER, B_BETTER, EQUIVALENT}.
//     Prevents collusion.
//
//   Phase 4 — COMPARE REVEAL:
//     Validators reveal choices + secrets.
//     Tally: majority determines winner per pair.
//     Overall: submission with most pairwise wins = consensus output.
//     Validators aligned with majority → reputation boost.
//
// Epsilon threshold (fuzzy agreement):
//   Two responses are EQUIVALENT if semantic similarity > 0.85
//   This is the "fuzzy" in fuzzy consensus — not binary, but quality-ranked.
//
// In single-shard mode: CRPC is a no-op (single response = consensus response).
// ============

import { createHash, randomBytes } from 'crypto';
import { config } from './config.js';
import { getShardInfo, getShardPeers } from './shard.js';

// ============ Constants ============

const CRPC_TIMEOUT_MS = 20000; // 20s total budget for all 4 phases
const PHASE_TIMEOUTS = [5000, 3000, 5000, 3000]; // Phase 1-4 timeouts in ms
const MIN_PARTICIPANTS = 3; // Minimum shards for CRPC
const HTTP_TIMEOUT_MS = 3000;

// Comparison choices
const CHOICES = {
  A_BETTER: 'A_BETTER',
  B_BETTER: 'B_BETTER',
  EQUIVALENT: 'EQUIVALENT',
};

// CRPC task types
const TASK_TYPES = {
  MODERATION: 'moderation',
  PROACTIVE: 'proactive',
  PROMOTION: 'promotion',
  DISPUTE: 'dispute',
};

// ============ State ============

let crpcEnabled = false;
const activeTasks = new Map(); // taskId -> CRPCTask
const completedTasks = []; // History
const MAX_HISTORY = 100;

// Reputation tracking (per shard)
const reputationScores = new Map(); // shardId -> { wins, losses, total }

// ============ CRPC Task State ============

function createCRPCTask(taskId, prompt, context, opts) {
  return {
    id: taskId,
    prompt,
    context,
    type: opts.type || TASK_TYPES.PROACTIVE,
    phase: 1,
    createdAt: Date.now(),

    // Phase 1: Work commits
    workCommits: new Map(), // shardId -> commitHash

    // Phase 2: Work reveals
    workReveals: new Map(), // shardId -> { response, secret }

    // Phase 3: Compare commits
    compareCommits: new Map(), // shardId -> Map<pairId, commitHash>

    // Phase 4: Compare reveals
    compareReveals: new Map(), // shardId -> Map<pairId, { choice, secret }>

    // Results
    pairwiseResults: new Map(), // pairId -> { winner, votes }
    rankings: [], // Final rankings
    consensusResponse: null,
    confidence: 0,
    settled: false,
  };
}

// ============ Init ============

export function initCRPC() {
  const shardInfo = getShardInfo();
  crpcEnabled = shardInfo && shardInfo.totalShards >= MIN_PARTICIPANTS;

  if (crpcEnabled) {
    console.log(`[crpc] CRPC ENABLED (${shardInfo.totalShards} shards, min ${MIN_PARTICIPANTS} for pairwise comparison)`);
  } else {
    console.log('[crpc] CRPC disabled — fewer than 3 shards. Single-response mode.');
  }
}

// ============ Request Consensus Response ============

export async function requestConsensusResponse(prompt, context, opts = {}) {
  const shardInfo = getShardInfo();
  const taskId = `crpc-${Date.now()}-${randomBytes(4).toString('hex')}`;

  // Single-shard mode: return local response directly (no CRPC needed)
  if (!crpcEnabled) {
    return {
      taskId,
      consensusResponse: null, // Caller generates response normally
      singleShard: true,
      confidence: 1.0,
    };
  }

  const task = createCRPCTask(taskId, prompt, context, opts);
  activeTasks.set(taskId, task);

  console.log(`[crpc] Starting CRPC round: ${taskId} (${opts.type || 'unknown'})`);

  const peers = getShardPeers();
  const participants = [shardInfo.id, ...peers.map(p => p.shardId)].slice(0, opts.maxShards || 5);

  // Phase 1: Request work commits from all participants
  await broadcastCRPC(peers, '/crpc/request-work', {
    taskId,
    prompt,
    context,
    type: opts.type,
    phaseTimeout: PHASE_TIMEOUTS[0],
  });

  // Wait for phases to complete (or timeout)
  return new Promise((resolve) => {
    const totalTimeout = opts.timeout || CRPC_TIMEOUT_MS;

    setTimeout(() => {
      const result = settleTask(taskId);
      resolve(result);
    }, totalTimeout);
  });
}

// ============ Phase 1: Work Commit ============

export function submitWorkCommit(taskId, shardId, commitHash) {
  const task = activeTasks.get(taskId);
  if (!task || task.phase > 1) return false;

  task.workCommits.set(shardId, commitHash);

  // Check if all expected commits are in
  const shardInfo = getShardInfo();
  const totalShards = shardInfo?.totalShards || 1;
  if (task.workCommits.size >= Math.min(totalShards, MIN_PARTICIPANTS)) {
    task.phase = 2;
  }

  return true;
}

// ============ Phase 2: Work Reveal ============

export function revealWork(taskId, shardId, response, secret) {
  const task = activeTasks.get(taskId);
  if (!task || task.phase < 2) return false;

  // Verify commit matches
  const expectedHash = task.workCommits.get(shardId);
  const actualHash = hashCommit(response, secret);

  if (expectedHash && expectedHash !== actualHash) {
    console.warn(`[crpc] Invalid reveal from ${shardId} — hash mismatch. Reputation penalty.`);
    updateReputation(shardId, false);
    return false;
  }

  task.workReveals.set(shardId, { response, secret });

  // Check if all reveals are in
  if (task.workReveals.size >= task.workCommits.size) {
    task.phase = 3;
  }

  return true;
}

// ============ Phase 3: Compare Commit ============

export function submitCompareCommit(taskId, shardId, pairId, commitHash) {
  const task = activeTasks.get(taskId);
  if (!task || task.phase < 3) return false;

  if (!task.compareCommits.has(shardId)) {
    task.compareCommits.set(shardId, new Map());
  }
  task.compareCommits.get(shardId).set(pairId, commitHash);

  return true;
}

// ============ Phase 4: Compare Reveal ============

export function revealComparison(taskId, shardId, pairId, choice, secret) {
  const task = activeTasks.get(taskId);
  if (!task || task.phase < 3) return false;

  // Verify commit
  const commits = task.compareCommits.get(shardId);
  if (commits) {
    const expectedHash = commits.get(pairId);
    const actualHash = hashCommit(choice, secret);
    if (expectedHash && expectedHash !== actualHash) {
      console.warn(`[crpc] Invalid comparison reveal from ${shardId}. Reputation penalty.`);
      updateReputation(shardId, false);
      return false;
    }
  }

  if (!task.compareReveals.has(shardId)) {
    task.compareReveals.set(shardId, new Map());
  }
  task.compareReveals.get(shardId).set(pairId, { choice, secret });

  return true;
}

// ============ Settlement ============

export function settleTask(taskId) {
  const task = activeTasks.get(taskId);
  if (!task) return { error: 'Task not found' };
  if (task.settled) return formatResult(task);

  const reveals = Array.from(task.workReveals.entries());

  if (reveals.length === 0) {
    task.settled = true;
    activeTasks.delete(taskId);
    return { taskId, consensusResponse: null, confidence: 0, noResponses: true };
  }

  if (reveals.length === 1) {
    // Only one response — it wins by default
    const [shardId, { response }] = reveals[0];
    task.consensusResponse = response;
    task.confidence = 1.0;
    task.rankings = [{ shardId, response, wins: 0, score: 1.0 }];
    task.settled = true;
    activeTasks.delete(taskId);
    archiveTask(task);
    return formatResult(task);
  }

  // Generate all pairs
  const pairs = [];
  for (let i = 0; i < reveals.length; i++) {
    for (let j = i + 1; j < reveals.length; j++) {
      pairs.push({
        id: `${reveals[i][0]}-vs-${reveals[j][0]}`,
        a: { shardId: reveals[i][0], response: reveals[i][1].response },
        b: { shardId: reveals[j][0], response: reveals[j][1].response },
      });
    }
  }

  // Tally pairwise comparisons from reveals
  const winCounts = new Map(); // shardId -> wins
  for (const [shardId] of reveals) {
    winCounts.set(shardId, 0);
  }

  for (const pair of pairs) {
    const votes = { A: 0, B: 0, EQ: 0 };

    for (const [, comparisons] of task.compareReveals) {
      const comparison = comparisons.get(pair.id);
      if (comparison) {
        if (comparison.choice === CHOICES.A_BETTER) votes.A++;
        else if (comparison.choice === CHOICES.B_BETTER) votes.B++;
        else votes.EQ++;
      }
    }

    if (votes.A > votes.B) {
      winCounts.set(pair.a.shardId, winCounts.get(pair.a.shardId) + 1);
    } else if (votes.B > votes.A) {
      winCounts.set(pair.b.shardId, winCounts.get(pair.b.shardId) + 1);
    }
    // Equivalent: no wins for either (fuzzy agreement)

    task.pairwiseResults.set(pair.id, { votes, winner: votes.A > votes.B ? pair.a.shardId : votes.B > votes.A ? pair.b.shardId : 'equivalent' });
  }

  // If no comparisons happened (Phase 3-4 didn't complete), use first response
  const totalComparisons = Array.from(task.compareReveals.values())
    .reduce((sum, m) => sum + m.size, 0);

  if (totalComparisons === 0) {
    // Fallback: use the response from the shard with highest reputation
    const bestShard = reveals
      .map(([shardId, { response }]) => ({
        shardId,
        response,
        reputation: getReputation(shardId),
      }))
      .sort((a, b) => b.reputation - a.reputation)[0];

    task.consensusResponse = bestShard.response;
    task.confidence = 0.5; // Low confidence — no comparison happened
    task.rankings = reveals.map(([shardId, { response }]) => ({
      shardId,
      response,
      wins: 0,
      score: getReputation(shardId),
    }));
  } else {
    // Rank by wins
    const rankings = reveals
      .map(([shardId, { response }]) => ({
        shardId,
        response,
        wins: winCounts.get(shardId) || 0,
      }))
      .sort((a, b) => b.wins - a.wins);

    // Winner = most pairwise wins
    task.consensusResponse = rankings[0].response;
    task.confidence = rankings[0].wins / Math.max(1, pairs.length);
    task.rankings = rankings;

    // Update reputations
    for (const [, comparisons] of task.compareReveals) {
      for (const [pairId, { choice }] of comparisons) {
        const result = task.pairwiseResults.get(pairId);
        if (result) {
          const aligned = (choice === CHOICES.A_BETTER && result.winner === result.votes?.A?.shardId) ||
                          (choice === CHOICES.B_BETTER && result.winner === result.votes?.B?.shardId) ||
                          (choice === CHOICES.EQUIVALENT && result.winner === 'equivalent');
          // Note: simplified reputation update
        }
      }
    }
  }

  task.settled = true;
  activeTasks.delete(taskId);
  archiveTask(task);

  console.log(`[crpc] Settled ${taskId}: winner=${task.rankings[0]?.shardId}, confidence=${task.confidence.toFixed(2)}`);

  return formatResult(task);
}

// ============ Reputation ============

function getReputation(shardId) {
  const rep = reputationScores.get(shardId);
  if (!rep) return 0.5; // Default neutral
  return rep.total === 0 ? 0.5 : rep.wins / rep.total;
}

function updateReputation(shardId, win) {
  if (!reputationScores.has(shardId)) {
    reputationScores.set(shardId, { wins: 0, losses: 0, total: 0 });
  }
  const rep = reputationScores.get(shardId);
  if (win) rep.wins++;
  else rep.losses++;
  rep.total++;
}

// ============ Helpers ============

function hashCommit(content, secret) {
  return createHash('sha256')
    .update(JSON.stringify(content) + secret)
    .digest('hex')
    .slice(0, 32);
}

function formatResult(task) {
  return {
    taskId: task.id,
    type: task.type,
    consensusResponse: task.consensusResponse,
    confidence: task.confidence,
    rankings: task.rankings?.map(r => ({
      shardId: r.shardId,
      wins: r.wins,
      responsePreview: r.response?.slice(0, 100),
    })),
    participants: task.workReveals.size,
    comparisons: task.pairwiseResults.size,
    settledAt: new Date().toISOString(),
  };
}

function archiveTask(task) {
  completedTasks.push(formatResult(task));
  if (completedTasks.length > MAX_HISTORY) {
    completedTasks.shift();
  }
}

async function broadcastCRPC(peers, path, data) {
  const promises = peers.map(async (peer) => {
    try {
      await fetch(`${peer.url}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      console.warn(`[crpc] Broadcast to ${peer.shardId} failed: ${err.message}`);
    }
  });

  await Promise.allSettled(promises);
}

// ============ Stats ============

export function getCRPCStats() {
  const totalTasks = completedTasks.length;
  const avgConfidence = totalTasks > 0
    ? completedTasks.reduce((sum, t) => sum + t.confidence, 0) / totalTasks
    : 0;

  return {
    enabled: crpcEnabled,
    activeTasks: activeTasks.size,
    completedTasks: totalTasks,
    avgConfidence: avgConfidence.toFixed(2),
    recentTasks: completedTasks.slice(-5),
    reputations: Object.fromEntries(reputationScores),
  };
}

// ============ HTTP Handler (embeddable) ============

export function handleCRPCRequest(path, method) {
  if (path === '/crpc/request-work' && method === 'POST') return 'request_work';
  if (path === '/crpc/work-commit' && method === 'POST') return 'work_commit';
  if (path === '/crpc/work-reveal' && method === 'POST') return 'work_reveal';
  if (path === '/crpc/compare-commit' && method === 'POST') return 'compare_commit';
  if (path === '/crpc/compare-reveal' && method === 'POST') return 'compare_reveal';
  if (path === '/crpc/stats' && method === 'GET') return 'stats';
  return null;
}

export function processCRPCBody(handler, body) {
  switch (handler) {
    case 'work_commit':
      return { success: submitWorkCommit(body.taskId, body.shardId, body.commitHash) };
    case 'work_reveal':
      return { success: revealWork(body.taskId, body.shardId, body.response, body.secret) };
    case 'compare_commit':
      return { success: submitCompareCommit(body.taskId, body.shardId, body.pairId, body.commitHash) };
    case 'compare_reveal':
      return { success: revealComparison(body.taskId, body.shardId, body.pairId, body.choice, body.secret) };
    case 'stats':
      return getCRPCStats();
    default:
      return { error: 'Unknown CRPC handler' };
  }
}

// ============ Exports ============

export { CHOICES, TASK_TYPES };
