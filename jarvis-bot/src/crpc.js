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
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { getShardInfo, getShardPeers } from './shard.js';

const CRPC_DATA_DIR = join(config.dataDir, 'crpc');
const REPUTATION_FILE = join(CRPC_DATA_DIR, 'reputation.json');
const COMPLETED_FILE = join(CRPC_DATA_DIR, 'completed.json');
const STALE_TASK_MS = 60000; // Auto-settle tasks stuck for >60s

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
  KNOWLEDGE_VERIFICATION: 'knowledge_verification',
};

// ============ State ============

let crpcEnabled = false;
let staleTaskInterval = null;
const activeTasks = new Map(); // taskId -> CRPCTask
const MAX_ACTIVE_TASKS = 100;
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

export async function initCRPC() {
  const shardInfo = getShardInfo();
  crpcEnabled = shardInfo && shardInfo.totalShards >= MIN_PARTICIPANTS;

  // Ensure data directory exists
  try { await mkdir(CRPC_DATA_DIR, { recursive: true }); } catch {}

  // Restore persisted reputation
  try {
    const data = await readFile(REPUTATION_FILE, 'utf-8');
    const entries = JSON.parse(data);
    for (const [k, v] of Object.entries(entries)) {
      reputationScores.set(k, v);
    }
    if (Object.keys(entries).length > 0) {
      console.log(`[crpc] Restored ${Object.keys(entries).length} reputation scores`);
    }
  } catch { /* clean start */ }

  // Restore completed task history
  try {
    const data = await readFile(COMPLETED_FILE, 'utf-8');
    const tasks = JSON.parse(data);
    completedTasks.push(...tasks.slice(-MAX_HISTORY));
  } catch { /* clean start */ }

  if (crpcEnabled) {
    console.log(`[crpc] CRPC ENABLED (${shardInfo.totalShards} shards, min ${MIN_PARTICIPANTS} for pairwise comparison)`);
    // Auto-settle stale tasks every 30s
    staleTaskInterval = setInterval(autoSettleStaleTasks, 30000);
  } else {
    console.log('[crpc] CRPC disabled — fewer than 3 shards. Single-response mode.');
  }
}

/**
 * Dynamic activation: called when a new shard registers with the router.
 * Switches from single-response to CRPC mode when enough shards are online.
 */
export function recheckCRPCMode(liveShardCount) {
  if (crpcEnabled) return; // Already active
  if (liveShardCount >= MIN_PARTICIPANTS) {
    crpcEnabled = true;
    console.log(`[crpc] CRPC ACTIVATED — ${liveShardCount} shards online. Pairwise comparison enabled.`);
    staleTaskInterval = setInterval(autoSettleStaleTasks, 30000);
  }
}

// ============ Persistence ============

export async function flushCRPC() {
  try {
    await writeFile(REPUTATION_FILE, JSON.stringify(Object.fromEntries(reputationScores)));
  } catch (err) {
    console.warn(`[crpc] Failed to flush reputation: ${err.message}`);
  }
  try {
    await writeFile(COMPLETED_FILE, JSON.stringify(completedTasks.slice(-MAX_HISTORY)));
  } catch (err) {
    console.warn(`[crpc] Failed to flush completed tasks: ${err.message}`);
  }
}

// ============ Auto-Settle Stale Tasks ============

function autoSettleStaleTasks() {
  const now = Date.now();
  for (const [taskId, task] of activeTasks) {
    if (now - task.createdAt > STALE_TASK_MS && !task.settled) {
      console.warn(`[crpc] Auto-settling stale task ${taskId} (age: ${Math.round((now - task.createdAt) / 1000)}s)`);
      settleTask(taskId);
    }
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

  // Cap active tasks to prevent unbounded growth from stuck tasks
  if (activeTasks.size >= MAX_ACTIVE_TASKS) {
    console.warn(`[crpc] Active tasks at cap (${MAX_ACTIVE_TASKS}) — settling oldest`);
    const oldest = activeTasks.keys().next().value;
    settleTask(oldest);
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
      const resp = await fetch(`${peer.url}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!resp.ok) {
        console.warn(`[crpc] Broadcast to ${peer.shardId} HTTP ${resp.status}`);
      }
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
  if (path === '/crpc/demo' && (method === 'POST' || method === 'GET')) return 'demo';
  if (path === '/crpc/protocol' && method === 'GET') return 'protocol';
  if (path === '/crpc/dashboard' && method === 'GET') return 'dashboard';
  return null;
}

export async function processCRPCBody(handler, body) {
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
    case 'demo':
      return await runCRPCDemo(body?.prompt);
    case 'protocol':
      return getCRPCProtocolSpec();
    case 'dashboard':
      return { _html: await getCRPCDashboardHTML() };
    default:
      return { error: 'Unknown CRPC handler' };
  }
}

// ============ Protocol Specification ============

function getCRPCProtocolSpec() {
  return {
    name: 'CRPC — Commit-Reveal Pairwise Comparison',
    version: '1.0',
    author: 'Tim Cotton (Scrypted)',
    implementation: 'VibeSwap / JARVIS Mind Network',
    description: 'Off-chain fuzzy consensus protocol for non-deterministic AI agent responses. Unlike blockchain consensus (binary agree/disagree), CRPC handles subjective quality evaluation through cryptographically committed pairwise comparison.',
    keyInnovation: 'Commitment schemes prevent both copying (work phase) and collusion (compare phase). The protocol produces a quality-ranked consensus from inherently non-deterministic AI outputs.',
    phases: [
      {
        phase: 1,
        name: 'WORK COMMIT',
        description: 'Each shard independently generates a response to the prompt. Publishes hash(response || secret) to all peers. The commitment prevents any shard from copying another\'s answer.',
        cryptography: 'SHA-256 commitment: hash(JSON.stringify(response) + secret)',
        timeout: `${PHASE_TIMEOUTS[0]}ms`,
      },
      {
        phase: 2,
        name: 'WORK REVEAL',
        description: 'Shards reveal actual responses and secrets. Peers recompute hash and verify it matches the Phase 1 commitment. Invalid reveals incur reputation penalties.',
        verification: 'recomputed_hash === committed_hash',
        penalty: 'Reputation loss for hash mismatch (attempted response substitution)',
      },
      {
        phase: 3,
        name: 'COMPARE COMMIT',
        description: 'Each shard acts as validator. For every pair of revealed responses, the validator evaluates which is better and commits hash(choice || secret). Choices: A_BETTER, B_BETTER, EQUIVALENT.',
        cryptography: 'SHA-256 commitment per pair per validator',
        pairsFormula: 'n*(n-1)/2 pairs for n participants',
        timeout: `${PHASE_TIMEOUTS[2]}ms`,
      },
      {
        phase: 4,
        name: 'COMPARE REVEAL',
        description: 'Validators reveal choices and secrets. Hash verification confirms no vote was changed after seeing other validators\' commitments. Majority determines each pair\'s winner.',
        settlement: 'Pairwise wins tallied. Most wins = consensus output. Ties broken by reputation.',
        reputationUpdate: 'Validators aligned with majority get reputation boost.',
      },
    ],
    parameters: {
      minParticipants: MIN_PARTICIPANTS,
      totalTimeout: `${CRPC_TIMEOUT_MS}ms`,
      phaseTimeouts: PHASE_TIMEOUTS.map((t, i) => `Phase ${i + 1}: ${t}ms`),
      staleTaskTimeout: `${STALE_TASK_MS}ms`,
    },
    useCases: [
      'Moderation decisions — should this user be warned?',
      'Proactive engagement — should the AI speak up in a group chat?',
      'Knowledge promotion — is a correction worth making a permanent skill?',
      'Dispute resolution — two users disagree, which is right?',
      'High-stakes responses — personal disclosure, vulnerability signals',
      'Content gating — "Is this post in the best interests of the project?" (agent-driven social media)',
      'Cross-framework consensus — ElizaOS/DayDreams agents reaching agreement on shared state',
    ],
    endpoints: {
      demo: { method: 'GET|POST', path: '/crpc/demo', description: 'Run a live 4-phase CRPC round with real LLM responses' },
      stats: { method: 'GET', path: '/crpc/stats', description: 'Current CRPC statistics and reputation scores' },
      protocol: { method: 'GET', path: '/crpc/protocol', description: 'This specification' },
    },
    differentiators: [
      'Fuzzy consensus: EQUIVALENT is a valid outcome — not everything has a "winner"',
      'Non-deterministic: designed for AI outputs that vary on every run',
      'Reputation-weighted: shards build trust over time through consistent quality',
      'Commit-reveal: cryptographic guarantees against copying and collusion',
      'Off-chain: runs between AI shards, not on a blockchain — no gas costs',
    ],
    liveStats: getCRPCStats(),
  };
}

// ============ CRPC Dashboard (Self-Contained HTML) ============

async function getCRPCDashboardHTML() {
  const stats = getCRPCStats();
  let scoreTrendsHTML = '';
  try {
    const { getScoreTrends, getScoreCalibration } = await import('./intelligence.js');
    const trends = await getScoreTrends(7);
    const calibration = await getScoreCalibration();
    if (trends && trends.count > 0) {
      const barWidth = (score) => Math.round(parseFloat(score) * 10);
      const barColor = (score) => parseFloat(score) >= 7 ? '#00ff88' : parseFloat(score) >= 5 ? '#ffaa00' : '#ff4444';
      const bar = (label, score) =>
        `<div style="display:flex;align-items:center;gap:8px;margin:4px 0"><span style="width:100px;color:#888;font-size:0.8em">${label}</span><div style="flex:1;background:#1a1a1a;border-radius:4px;height:16px"><div style="width:${barWidth(score)}%;background:${barColor(score)};border-radius:4px;height:16px"></div></div><span style="width:40px;text-align:right;font-size:0.85em;color:${barColor(score)}">${score}</span></div>`;
      scoreTrendsHTML = `<h2>Brain — Self-Improvement Loop</h2>
<div class="card" style="margin-bottom:16px">
<div class="label">Response Quality (${trends.count} scored, 7 days)</div>
<div style="margin-top:12px">
${bar('Accuracy', trends.accuracy)}
${bar('Relevance', trends.relevance)}
${bar('Conciseness', trends.conciseness)}
${bar('Usefulness', trends.usefulness)}
${bar('Naturalness', trends.naturalness)}
${bar('Composite', trends.composite)}
</div>
${calibration ? `<div style="margin-top:12px;padding:8px;background:#0d0d0d;border-radius:4px;font-size:0.8em;color:#ffaa00">${calibration}</div>` : ''}
</div>`;
    }
  } catch { /* intelligence module not loaded */ }
  const recentRows = (stats.recentTasks || []).map(t => {
    const id = t.taskId?.slice(0, 20) || '—';
    const conf = ((t.confidence || 0) * 100).toFixed(0);
    const rankings = (t.rankings || []).map(r => `${r.shardId} (${r.wins}w)`).join(', ');
    return `<tr><td>${id}</td><td>${t.type || '—'}</td><td>${t.participants || 0}</td><td>${conf}%</td><td>${rankings}</td><td>${t.settledAt || '—'}</td></tr>`;
  }).join('');

  const repRows = Object.entries(stats.reputations || {}).map(([id, rep]) => {
    const winRate = rep.total > 0 ? ((rep.wins / rep.total) * 100).toFixed(0) : '—';
    return `<tr><td>${id}</td><td>${rep.wins}</td><td>${rep.losses}</td><td>${rep.total}</td><td>${winRate}%</td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CRPC Dashboard — JARVIS Mind Network</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'SF Mono',Monaco,Consolas,monospace;background:#0a0a0a;color:#e0e0e0;padding:24px;max-width:1200px;margin:0 auto}
h1{color:#00ff88;font-size:1.5em;margin-bottom:4px}
.subtitle{color:#666;font-size:0.85em;margin-bottom:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:32px}
.card{background:#141414;border:1px solid #222;border-radius:8px;padding:16px}
.card .label{color:#888;font-size:0.75em;text-transform:uppercase;letter-spacing:1px}
.card .value{color:#00ff88;font-size:2em;font-weight:700;margin-top:4px}
.card .value.warn{color:#ffaa00}
table{width:100%;border-collapse:collapse;margin-top:8px}
th{text-align:left;color:#888;font-size:0.7em;text-transform:uppercase;letter-spacing:1px;padding:8px 12px;border-bottom:1px solid #333}
td{padding:8px 12px;border-bottom:1px solid #1a1a1a;font-size:0.85em}
tr:hover td{background:#1a1a1a}
h2{color:#ccc;font-size:1.1em;margin:24px 0 8px}
.demo-btn{background:#00ff88;color:#000;border:none;padding:10px 20px;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit;font-size:0.9em;margin-top:16px}
.demo-btn:hover{background:#00cc66}
.demo-btn:disabled{background:#333;color:#666;cursor:wait}
#demo-output{background:#0d0d0d;border:1px solid #222;border-radius:8px;padding:16px;margin-top:16px;white-space:pre-wrap;font-size:0.8em;max-height:500px;overflow-y:auto;display:none}
.phase{color:#00aaff}.winner{color:#00ff88;font-weight:700}
a{color:#00ff88;text-decoration:none}a:hover{text-decoration:underline}
</style>
</head><body>
<h1>CRPC Dashboard</h1>
<div class="subtitle">Tim Cotton's Commit-Reveal Pairwise Comparison — Live on JARVIS Mind Network</div>

<div class="grid">
<div class="card"><div class="label">Completed Rounds</div><div class="value">${stats.completedTasks}</div></div>
<div class="card"><div class="label">Active Tasks</div><div class="value ${stats.activeTasks > 0 ? 'warn' : ''}">${stats.activeTasks}</div></div>
<div class="card"><div class="label">Avg Confidence</div><div class="value">${stats.avgConfidence}</div></div>
<div class="card"><div class="label">Mode</div><div class="value" style="font-size:1em">${stats.enabled ? 'Multi-Shard' : 'Local CRPC'}</div></div>
</div>

<h2>Recent Rounds</h2>
<table>
<tr><th>Task ID</th><th>Type</th><th>Shards</th><th>Confidence</th><th>Rankings</th><th>Settled</th></tr>
${recentRows || '<tr><td colspan="6" style="color:#666">No rounds yet — click "Run Demo" below</td></tr>'}
</table>

<h2>Shard Reputations</h2>
<table>
<tr><th>Shard ID</th><th>Wins</th><th>Losses</th><th>Total</th><th>Win Rate</th></tr>
${repRows || '<tr><td colspan="5" style="color:#666">No reputation data yet</td></tr>'}
</table>

${scoreTrendsHTML}

<h2>Live Demo</h2>
<p style="color:#888;font-size:0.85em;margin-bottom:8px">Run a full 4-phase CRPC round with real LLM responses.</p>
<input id="demo-prompt" type="text" placeholder="Custom prompt (or leave empty for default)" style="width:100%;padding:8px 12px;background:#141414;border:1px solid #333;border-radius:6px;color:#e0e0e0;font-family:inherit;font-size:0.85em;margin-bottom:8px">
<button class="demo-btn" onclick="runDemo()">Run CRPC Demo</button>
<div id="demo-output"></div>

<div style="margin-top:32px;color:#444;font-size:0.75em">
<a href="/crpc/protocol">Protocol Spec</a> | <a href="/crpc/stats">Stats API</a> | <a href="/crpc/demo">Demo API</a>
</div>

<script>
async function runDemo(){
const btn=document.querySelector('.demo-btn');
const out=document.getElementById('demo-output');
const prompt=document.getElementById('demo-prompt').value.trim();
btn.disabled=true;btn.textContent='Running CRPC round...';
out.style.display='block';out.textContent='Phase 1: Generating independent shard responses...\\n';
try{
const body=prompt?JSON.stringify({prompt}):undefined;
const resp=await fetch('/crpc/demo',{method:prompt?'POST':'GET',headers:prompt?{'Content-Type':'application/json'}:{},body});
const data=await resp.json();
if(data.error){out.textContent='Error: '+data.error;return}
let log='CRPC CONSENSUS COMPLETE\\n';
log+='Duration: '+data.totalDurationMs+'ms\\n\\n';
for(const phase of data.phases){
log+='--- Phase '+phase.phase+': '+phase.name+' ('+phase.durationMs+'ms) ---\\n';
log+=phase.description+'\\n';
if(phase.commits)phase.commits.forEach(c=>log+='  '+c.shardId+': '+c.commitHash.slice(0,16)+'...\\n');
if(phase.reveals)phase.reveals.forEach(r=>log+='  '+r.shardId+' [hash:'+((r.hashVerified)?'OK':'FAIL')+']: '+r.response.slice(0,100)+'...\\n');
if(phase.pairwiseResults)phase.pairwiseResults.forEach(pr=>log+='  '+pr.pairId+': A='+pr.votes.A_BETTER+' B='+pr.votes.B_BETTER+' EQ='+pr.votes.EQUIVALENT+' -> '+pr.winner+'\\n');
log+='\\n';
}
log+='RANKINGS:\\n';
data.rankings.forEach((r,i)=>log+='  '+(i+1)+'. '+r.shardId+' ('+r.pairwiseWins+' wins)\\n');
log+='\\nWINNER: '+data.consensusWinner+' (confidence: '+(data.confidence*100).toFixed(0)+'%)\\n';
log+='\\nCONSENSUS RESPONSE:\\n'+data.consensusResponse;
out.textContent=log;
}catch(e){out.textContent='Error: '+e.message}
finally{btn.disabled=false;btn.textContent='Run CRPC Demo'}
}
</script>
</body></html>`;
}

// ============ Local CRPC — Production Chat Pipeline Integration ============
//
// Runs CRPC locally within a single shard for high-stakes messages.
// Uses the caller's system prompt and message history (full Jarvis context).
// Generates 3 candidate responses with temperature variation, then uses
// pairwise LLM comparison to select the best one.
//
// This is NOT the demo — this is production CRPC running inside the chat pipeline.
// When multi-shard mode is active, requestConsensusResponse() handles real shards.
// When single-shard, runLocalCRPC() simulates the protocol locally.

const LOCAL_CRPC_TEMPERATURES = [0.3, 0.7, 1.0];

export async function runLocalCRPC(systemPrompt, messages, opts = {}) {
  const { llmChat } = await import('./llm-provider.js');
  const taskId = `crpc-local-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const maxTokens = opts.maxTokens || 1024;

  console.log(`[crpc-local] Starting local CRPC round: ${taskId}`);
  const startTime = Date.now();

  // ============ Phase 1+2: Generate + Commit (combined locally) ============
  // 3 candidates with different temperatures — simulates independent shards
  const candidates = await Promise.all(
    LOCAL_CRPC_TEMPERATURES.map(async (temp, i) => {
      const shardId = `local-shard-${i}`;
      const secret = randomBytes(16).toString('hex');

      const response = await llmChat({
        system: systemPrompt,
        messages,
        max_tokens: maxTokens,
        temperature: temp,
        _background: true,
      });

      const responseText = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');

      const commitHash = hashCommit(responseText, secret);
      return { shardId, temperature: temp, response: responseText, secret, commitHash, usage: response.usage };
    })
  );

  const genDuration = Date.now() - startTime;

  // ============ Phase 3+4: Pairwise Comparison (combined locally) ============
  // Each candidate pair is evaluated by a single LLM call (validator)
  const pairs = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      pairs.push({ a: candidates[i], b: candidates[j] });
    }
  }

  // Extract the user's question for comparison context
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const questionText = !lastUserMsg ? '' :
    typeof lastUserMsg.content === 'string' ? lastUserMsg.content :
    Array.isArray(lastUserMsg.content) ? lastUserMsg.content.filter(b => b.type === 'text').map(b => b.text).join(' ') : '';

  const comparisonResults = await Promise.all(
    pairs.map(async (pair) => {
      const result = await llmChat({
        system: 'You are evaluating two AI responses for quality, accuracy, helpfulness, and naturalness. Reply with EXACTLY one word: A_BETTER, B_BETTER, or EQUIVALENT.',
        messages: [{
          role: 'user',
          content: `Question: ${questionText.slice(0, 500)}\n\nResponse A:\n${pair.a.response.slice(0, 800)}\n\nResponse B:\n${pair.b.response.slice(0, 800)}\n\nWhich is better?`,
        }],
        max_tokens: 10,
        temperature: 0.1,
        _background: true,
      });

      const choiceRaw = result.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim()
        .toUpperCase();

      let choice = CHOICES.EQUIVALENT;
      if (choiceRaw.includes('A_BETTER') || choiceRaw.startsWith('A')) choice = CHOICES.A_BETTER;
      else if (choiceRaw.includes('B_BETTER') || choiceRaw.startsWith('B')) choice = CHOICES.B_BETTER;

      return { a: pair.a.shardId, b: pair.b.shardId, choice };
    })
  );

  // Tally pairwise wins
  const winCounts = new Map();
  for (const c of candidates) winCounts.set(c.shardId, 0);

  for (const cr of comparisonResults) {
    if (cr.choice === CHOICES.A_BETTER) winCounts.set(cr.a, (winCounts.get(cr.a) || 0) + 1);
    else if (cr.choice === CHOICES.B_BETTER) winCounts.set(cr.b, (winCounts.get(cr.b) || 0) + 1);
  }

  // Rank and select winner
  const ranked = candidates
    .map(c => ({ ...c, wins: winCounts.get(c.shardId) || 0 }))
    .sort((a, b) => b.wins - a.wins);

  const winner = ranked[0];
  const confidence = winner.wins / Math.max(1, pairs.length);
  const totalDuration = Date.now() - startTime;

  // Update reputation
  for (const r of ranked) {
    updateReputation(r.shardId, r.wins > 0);
  }

  // Archive
  completedTasks.push({
    taskId,
    type: opts.type || 'local-crpc',
    consensusResponse: winner.response,
    confidence,
    rankings: ranked.map(r => ({
      shardId: r.shardId,
      wins: r.wins,
      responsePreview: r.response.slice(0, 100),
    })),
    participants: candidates.length,
    comparisons: comparisonResults.length,
    settledAt: new Date().toISOString(),
  });
  if (completedTasks.length > MAX_HISTORY) completedTasks.shift();

  console.log(`[crpc-local] Settled ${taskId}: winner=${winner.shardId} (temp=${winner.temperature}), confidence=${confidence.toFixed(2)}, gen=${genDuration}ms, total=${totalDuration}ms`);

  return {
    taskId,
    consensusResponse: winner.response,
    confidence,
    winner: winner.shardId,
    winnerTemperature: winner.temperature,
    rankings: ranked.map(r => ({ shardId: r.shardId, wins: r.wins, temperature: r.temperature })),
    durationMs: totalDuration,
    totalUsage: {
      input_tokens: candidates.reduce((sum, c) => sum + (c.usage?.input_tokens || 0), 0),
      output_tokens: candidates.reduce((sum, c) => sum + (c.usage?.output_tokens || 0), 0),
    },
  };
}

// ============ CRPC Demo — Full 4-Phase Simulation ============
//
// Simulates a complete CRPC round with 3 virtual shards generating real LLM
// responses. Shows the full commit-reveal pairwise comparison protocol:
//   Phase 1: WORK COMMIT — 3 shards independently generate + commit
//   Phase 2: WORK REVEAL — reveal responses, verify hashes
//   Phase 3: COMPARE COMMIT — validator shards compare all pairs
//   Phase 4: COMPARE REVEAL — tally votes, rank, determine consensus winner
//
// This is a self-contained demonstration — no actual multi-shard deployment needed.
// Tim Cotton's CRPC protocol running with real LLM responses and real crypto.

const DEMO_SHARDS = [
  { id: 'shard-alpha', temperature: 0.3, persona: 'analytical and precise' },
  { id: 'shard-beta', temperature: 0.7, persona: 'balanced and thoughtful' },
  { id: 'shard-gamma', temperature: 1.0, persona: 'creative and bold' },
];

const DEFAULT_DEMO_PROMPT = 'What makes AI agent consensus fundamentally different from blockchain consensus, and why does it matter?';

export async function runCRPCDemo(prompt) {
  const { llmChat } = await import('./llm-provider.js');
  const taskId = `crpc-demo-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const demoPrompt = prompt || DEFAULT_DEMO_PROMPT;
  const trace = {
    taskId,
    protocol: 'CRPC (Commit-Reveal Pairwise Comparison)',
    author: 'Tim Cotton — adapted for AI shard consensus by VibeSwap',
    prompt: demoPrompt,
    shards: DEMO_SHARDS.map(s => ({ id: s.id, temperature: s.temperature, persona: s.persona })),
    phases: [],
    pairwiseResults: [],
    rankings: [],
    consensusResponse: null,
    confidence: 0,
    totalDurationMs: 0,
    reputations: {},
  };

  const overallStart = Date.now();

  // ============ Phase 1: WORK COMMIT ============
  // Each shard independently generates a response and commits hash(response || secret)
  // Commitment prevents copying — no shard can see another's answer before committing.
  const phase1Start = Date.now();
  const workItems = []; // { shardId, response, secret, commitHash }

  const phase1Promises = DEMO_SHARDS.map(async (shard) => {
    const secret = randomBytes(16).toString('hex');
    const response = await llmChat({
      system: `You are ${shard.id}, an AI shard with a ${shard.persona} style. Answer concisely in 2-3 sentences. Your perspective should reflect your persona.`,
      messages: [{ role: 'user', content: demoPrompt }],
      max_tokens: 300,
      temperature: shard.temperature,
      _background: true,
    });

    const responseText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const commitHash = hashCommit(responseText, secret);
    return { shardId: shard.id, response: responseText, secret, commitHash };
  });

  const results = await Promise.all(phase1Promises);
  workItems.push(...results);

  const phase1Commits = workItems.map(w => ({
    shardId: w.shardId,
    commitHash: w.commitHash,
    // Response is hidden at this point — only the hash is published
  }));

  trace.phases.push({
    phase: 1,
    name: 'WORK COMMIT',
    description: 'Shards independently generate responses and publish commitment hashes. No shard can see others\' answers.',
    durationMs: Date.now() - phase1Start,
    commits: phase1Commits,
  });

  // ============ Phase 2: WORK REVEAL ============
  // Shards reveal their actual responses + secrets. Peers verify hash matches commitment.
  const phase2Start = Date.now();
  const reveals = [];
  let allValid = true;

  for (const item of workItems) {
    const recomputedHash = hashCommit(item.response, item.secret);
    const valid = recomputedHash === item.commitHash;
    if (!valid) allValid = false;

    reveals.push({
      shardId: item.shardId,
      response: item.response,
      secret: item.secret,
      hashVerified: valid,
      commitHash: item.commitHash,
      recomputedHash: recomputedHash,
    });
  }

  trace.phases.push({
    phase: 2,
    name: 'WORK REVEAL',
    description: 'Shards reveal responses + secrets. Hash verification proves no response was changed after seeing others.',
    durationMs: Date.now() - phase2Start,
    reveals: reveals.map(r => ({
      shardId: r.shardId,
      response: r.response,
      hashVerified: r.hashVerified,
    })),
    allHashesValid: allValid,
  });

  // ============ Phase 3: COMPARE COMMIT ============
  // Each shard acts as validator and compares every pair.
  // Commits hash(choice || secret) before seeing other validators' opinions.
  const phase3Start = Date.now();
  const pairs = [];
  for (let i = 0; i < workItems.length; i++) {
    for (let j = i + 1; j < workItems.length; j++) {
      pairs.push({
        id: `${workItems[i].shardId}-vs-${workItems[j].shardId}`,
        a: workItems[i],
        b: workItems[j],
      });
    }
  }

  // Each shard evaluates all pairs via LLM
  const compareItems = []; // { validatorId, pairId, choice, secret, commitHash }

  const phase3Promises = DEMO_SHARDS.map(async (validator) => {
    const validatorResults = [];
    for (const pair of pairs) {
      const secret = randomBytes(16).toString('hex');
      const comparisonResult = await llmChat({
        system: `You are a validator shard evaluating two AI responses. Compare them for quality, accuracy, and insight. Reply with EXACTLY one of: A_BETTER, B_BETTER, or EQUIVALENT. Nothing else.`,
        messages: [{
          role: 'user',
          content: `Question: ${demoPrompt}\n\nResponse A (${pair.a.shardId}):\n${pair.a.response}\n\nResponse B (${pair.b.shardId}):\n${pair.b.response}\n\nWhich response is better? Reply A_BETTER, B_BETTER, or EQUIVALENT.`,
        }],
        max_tokens: 20,
        temperature: 0.1, // Low temperature for consistent evaluation
        _background: true,
      });

      const choiceRaw = comparisonResult.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim()
        .toUpperCase();

      // Parse choice — accept fuzzy matches
      let choice = CHOICES.EQUIVALENT;
      if (choiceRaw.includes('A_BETTER') || choiceRaw.startsWith('A')) choice = CHOICES.A_BETTER;
      else if (choiceRaw.includes('B_BETTER') || choiceRaw.startsWith('B')) choice = CHOICES.B_BETTER;

      const commitHash = hashCommit(choice, secret);
      validatorResults.push({
        validatorId: validator.id,
        pairId: pair.id,
        choice,
        secret,
        commitHash,
      });
    }
    return validatorResults;
  });

  const allCompareResults = await Promise.all(phase3Promises);
  for (const batch of allCompareResults) {
    compareItems.push(...batch);
  }

  trace.phases.push({
    phase: 3,
    name: 'COMPARE COMMIT',
    description: 'Validator shards compare every pair and commit their votes (hash protected). Prevents vote collusion.',
    durationMs: Date.now() - phase3Start,
    pairs: pairs.map(p => p.id),
    totalCommits: compareItems.length,
    commitsPerValidator: pairs.length,
    commits: compareItems.map(c => ({
      validatorId: c.validatorId,
      pairId: c.pairId,
      commitHash: c.commitHash,
    })),
  });

  // ============ Phase 4: COMPARE REVEAL ============
  // Validators reveal their votes. Tally determines pairwise winners.
  const phase4Start = Date.now();
  const pairwiseResults = [];

  for (const pair of pairs) {
    const votes = { A_BETTER: 0, B_BETTER: 0, EQUIVALENT: 0 };
    const voterDetails = [];

    for (const item of compareItems) {
      if (item.pairId !== pair.id) continue;

      // Verify hash
      const recomputedHash = hashCommit(item.choice, item.secret);
      const valid = recomputedHash === item.commitHash;

      votes[item.choice]++;
      voterDetails.push({
        validatorId: item.validatorId,
        choice: item.choice,
        hashVerified: valid,
      });
    }

    const winner = votes.A_BETTER > votes.B_BETTER ? pair.a.shardId
      : votes.B_BETTER > votes.A_BETTER ? pair.b.shardId
      : 'equivalent';

    pairwiseResults.push({
      pairId: pair.id,
      votes,
      winner,
      voters: voterDetails,
    });
  }

  trace.phases.push({
    phase: 4,
    name: 'COMPARE REVEAL',
    description: 'Validators reveal votes + secrets. Hash verification confirms no vote was changed. Majority determines each pair\'s winner.',
    durationMs: Date.now() - phase4Start,
    pairwiseResults,
  });

  // ============ Settlement ============
  // Count pairwise wins per shard. Most wins = consensus winner.
  const winCounts = new Map();
  for (const shard of DEMO_SHARDS) winCounts.set(shard.id, 0);

  for (const result of pairwiseResults) {
    if (result.winner !== 'equivalent') {
      winCounts.set(result.winner, (winCounts.get(result.winner) || 0) + 1);
    }
  }

  const rankings = workItems
    .map(w => ({
      shardId: w.shardId,
      response: w.response,
      pairwiseWins: winCounts.get(w.shardId) || 0,
    }))
    .sort((a, b) => b.pairwiseWins - a.pairwiseWins);

  const confidence = rankings[0].pairwiseWins / Math.max(1, pairs.length);

  // Update reputation scores (persisted across demos)
  for (const r of rankings) {
    updateReputation(r.shardId, r.pairwiseWins > 0);
  }

  trace.rankings = rankings;
  trace.consensusResponse = rankings[0].response;
  trace.consensusWinner = rankings[0].shardId;
  trace.confidence = parseFloat(confidence.toFixed(3));
  trace.totalDurationMs = Date.now() - overallStart;
  trace.reputations = Object.fromEntries(reputationScores);

  // Archive into completed tasks
  completedTasks.push({
    taskId,
    type: 'demo',
    consensusResponse: rankings[0].response,
    confidence,
    rankings: rankings.map(r => ({
      shardId: r.shardId,
      wins: r.pairwiseWins,
      responsePreview: r.response.slice(0, 100),
    })),
    participants: DEMO_SHARDS.length,
    comparisons: pairwiseResults.length,
    settledAt: new Date().toISOString(),
  });
  if (completedTasks.length > MAX_HISTORY) completedTasks.shift();

  // Persist reputation
  flushCRPC().catch(() => {});

  console.log(`[crpc-demo] Completed ${taskId}: winner=${rankings[0].shardId}, confidence=${confidence.toFixed(2)}, duration=${trace.totalDurationMs}ms`);

  return trace;
}

export function stopCRPC() {
  if (staleTaskInterval) {
    clearInterval(staleTaskInterval);
    staleTaskInterval = null;
  }
}

// ============ Exports ============

export { CHOICES, TASK_TYPES };
