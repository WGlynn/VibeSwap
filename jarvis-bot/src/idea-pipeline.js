// ============ Idea Pipeline — Autonomous Community Contribution Engine ============
//
// People submit ideas via /idea or /suggest in Telegram. Jarvis evaluates them
// against the project's knowledge primitives, scores them, and stores worthy ones.
//
// Flow:
//   1. User submits idea via TG command
//   2. Haiku evaluates alignment, feasibility, novelty, community impact
//   3. Score 0-100 assigned with rationale
//   4. Stored in data/idea-pipeline.json
//   5. High-scoring ideas (80+) trigger a DM to Will
//   6. Auto-respond to submitter with Jarvis-voice feedback
//
// Philosophy: The community IS the protocol. Ideas from the edges are how
// cooperative capitalism self-organizes. P-000: fairness above all — every
// voice gets evaluated by the same standard.
// ============

import { llmChat } from './llm-provider.js';
import { config } from './config.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');
const PIPELINE_FILE = join(DATA_DIR, 'idea-pipeline.json');

// ============ Core Primitives (Evaluation Context) ============
// These are the knowledge primitives Haiku uses to judge alignment.
// Compressed for token efficiency — every char costs tokens.

const VIBESWAP_PRIMITIVES = `
# VibeSwap Core Primitives (Evaluation Context)

## P-000: Fairness Above All (GENESIS PRIMITIVE)
If something is clearly unfair, amending the code is a responsibility, a credo, a law, a canon.
Fairness is structural, not aspirational. The Lawson Constant is load-bearing.

## Core Mechanism: Commit-Reveal Batch Auction
- 10-second batches: 8s commit, 2s reveal
- Commit: hash(order || secret) + deposit — no one sees anyone else's order
- Reveal: orders + optional priority bids
- Settlement: Fisher-Yates shuffle (XORed secrets), uniform clearing price
- Result: MEV is structurally impossible — no frontrunning, no sandwiching

## Philosophy: Cooperative Capitalism
- Mutualized risk: insurance pools, treasury stabilization, IL protection
- Free market competition: priority auctions, arbitrage opportunities
- Shapley value rewards: game-theoretic fair distribution based on marginal contribution
- Not hostile disruption — positive-sum mutualistic absorption of liquidity

## Anti-MEV Design
- Flash loan protection (EOA-only commits)
- TWAP validation (max 5% deviation)
- Rate limiting (1M tokens/hour/user)
- Circuit breakers (volume, price, withdrawal thresholds)
- 50% slashing for invalid reveals

## Tech Stack
- Solidity 0.8.20, Foundry, OpenZeppelin v5.0.1 (UUPS upgradeable)
- LayerZero V2 for omnichain messaging
- React 18 + Vite frontend
- Python Kalman filter oracle for true price discovery

## Key Contracts
- CommitRevealAuction — batch auction engine
- VibeAMM — constant product AMM (x*y=k)
- VibeSwapCore — main orchestrator
- ShapleyDistributor — game theory reward distribution
- CrossChainRouter — LayerZero messaging
- DAOTreasury + TreasuryStabilizer — governance
- ILProtection, LoyaltyRewards — incentives

## Existing Features (Novelty Check)
- Commit-reveal batch auctions with uniform clearing prices
- Shapley value-based reward distribution
- Augmented bonding curves
- Cross-chain via LayerZero V2
- Circuit breakers (volume, price, withdrawal)
- Flash loan protection
- TWAP oracle with Kalman filter
- Fisher-Yates deterministic shuffle
- IL protection insurance pool
- Loyalty rewards with time-weighted staking
- Hot/cold wallet separation
- WebAuthn device wallets (Secure Element keys)
- ContributionDAG for attribution tracking

## Values
- "Your keys, your bitcoin" — self-custody is non-negotiable
- Decentralization over convenience
- Transparency over obscurity
- Community ownership over VC extraction
- Tit-for-Tat protocol personality: Nice, Provocable, Forgiving, Clear
`;

// ============ State ============

let ideas = [];
let loaded = false;

// ============ Persistence ============

async function loadIdeas() {
  if (loaded) return;
  try {
    await mkdir(DATA_DIR, { recursive: true });
    if (existsSync(PIPELINE_FILE)) {
      const raw = await readFile(PIPELINE_FILE, 'utf-8');
      ideas = JSON.parse(raw);
    }
  } catch (err) {
    console.error('[idea-pipeline] Failed to load ideas:', err.message);
    ideas = [];
  }
  loaded = true;
}

async function saveIdeas() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(PIPELINE_FILE, JSON.stringify(ideas, null, 2), 'utf-8');
  } catch (err) {
    console.error('[idea-pipeline] Failed to save ideas:', err.message);
  }
}

// ============ ID Generation ============

function generateIdeaId(userId, text) {
  const hash = createHash('sha256')
    .update(`${userId}:${text}:${Date.now()}`)
    .digest('hex')
    .slice(0, 12);
  return `idea-${hash}`;
}

// ============ LLM Evaluation ============

async function evaluateIdea(ideaText, username) {
  const response = await llmChat({
    _background: true,
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    system: `You are JARVIS, the AI co-architect of VibeSwap — an omnichain DEX that eliminates MEV through commit-reveal batch auctions. You evaluate community-submitted ideas against the project's core primitives.

${VIBESWAP_PRIMITIVES}

EVALUATION CRITERIA (score each 0-25, total 0-100):

1. ALIGNMENT (0-25): Does this idea align with fairness (P-000), cooperative capitalism, anti-MEV, self-custody, and decentralization? Ideas that contradict these score 0. Ideas that reinforce them score high.

2. FEASIBILITY (0-25): Can this be built with the existing tech stack (Solidity/Foundry/React/LayerZero)? Is the implementation path clear? Does it fit the architecture? Vague wishes score low. Concrete proposals score high.

3. NOVELTY (0-25): Is this already implemented (check Existing Features list)? Is it a fresh perspective? Reinventing what exists scores 0. Building on gaps scores high.

4. COMMUNITY IMPACT (0-25): Does this benefit the community broadly? Does it create positive-sum outcomes? Does it attract users/LPs/builders? Self-serving ideas score low. Rising-tide ideas score high.

Return EXACTLY one JSON object:
{
  "alignment_score": 0-25,
  "alignment_reason": "1 sentence",
  "feasibility_score": 0-25,
  "feasibility_reason": "1 sentence",
  "novelty_score": 0-25,
  "novelty_reason": "1 sentence",
  "impact_score": 0-25,
  "impact_reason": "1 sentence",
  "total_score": 0-100,
  "verdict": "accepted" | "needs_work" | "rejected",
  "feedback": "2-3 sentences of Jarvis-voice feedback to the submitter. Be encouraging but honest. If rejected, explain why constructively. If accepted, express genuine interest. Sound like a builder who respects other builders.",
  "implementation_notes": "1-2 sentences on HOW this could be built if score >= 50, null otherwise",
  "tags": ["tag1", "tag2"],
  "contradicts_existing": false,
  "already_exists": false
}

Verdict thresholds:
- 80+: "accepted" — strong idea, worth building
- 50-79: "needs_work" — has potential but needs refinement
- 0-49: "rejected" — doesn't fit or too vague

Be fair but demanding. Not every idea is good. Not every bad idea is worthless — point toward what COULD make it good. P-000 applies to evaluation too: judge the idea, not the person.`,
    messages: [{
      role: 'user',
      content: `Evaluate this idea submitted by @${username}:\n\n"${ideaText}"`
    }],
  });

  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('LLM did not return valid JSON evaluation');
  }

  const evaluation = JSON.parse(jsonMatch[0]);

  // Sanity: recalculate total from components
  evaluation.total_score = (evaluation.alignment_score || 0) +
    (evaluation.feasibility_score || 0) +
    (evaluation.novelty_score || 0) +
    (evaluation.impact_score || 0);

  // Force verdict consistency
  if (evaluation.total_score >= 80) evaluation.verdict = 'accepted';
  else if (evaluation.total_score >= 50) evaluation.verdict = 'needs_work';
  else evaluation.verdict = 'rejected';

  return evaluation;
}

// ============ Core API ============

/**
 * Submit an idea for evaluation.
 * @param {number} userId - Telegram user ID
 * @param {string} username - Telegram username or first_name
 * @param {string} ideaText - The idea description
 * @returns {{ accepted: boolean, score: number, feedback: string, id: string, evaluation: object }}
 */
export async function submitIdea(userId, username, ideaText) {
  await loadIdeas();

  // Duplicate check — same user, same idea (fuzzy: first 100 chars)
  const fingerprint = ideaText.slice(0, 100).toLowerCase().replace(/\s+/g, ' ').trim();
  const duplicate = ideas.find(i =>
    i.userId === userId &&
    i.fingerprint === fingerprint &&
    Date.now() - new Date(i.submittedAt).getTime() < 24 * 60 * 60 * 1000 // within 24h
  );
  if (duplicate) {
    return {
      accepted: false,
      score: duplicate.score,
      feedback: `You already submitted this idea recently (${duplicate.id}). Give it time — good ideas don't need to be repeated.`,
      id: duplicate.id,
      evaluation: duplicate.evaluation,
      duplicate: true,
    };
  }

  // Evaluate with Haiku
  const evaluation = await evaluateIdea(ideaText, username);
  const id = generateIdeaId(userId, ideaText);

  const idea = {
    id,
    userId,
    username,
    text: ideaText,
    fingerprint,
    score: evaluation.total_score,
    verdict: evaluation.verdict,
    evaluation,
    status: evaluation.verdict === 'accepted' ? 'pending_review' : evaluation.verdict,
    submittedAt: new Date().toISOString(),
    reviewedAt: null,
    approvedAt: null,
    approvedBy: null,
    implementedAt: null,
    notes: null,
  };

  ideas.push(idea);
  await saveIdeas();

  console.log(`[idea-pipeline] New idea ${id} from @${username}: score=${evaluation.total_score} verdict=${evaluation.verdict}`);

  return {
    accepted: evaluation.verdict === 'accepted',
    score: evaluation.total_score,
    feedback: evaluation.feedback,
    id,
    evaluation,
    duplicate: false,
  };
}

/**
 * Get ideas with optional filtering.
 * @param {{ status?: string, minScore?: number, userId?: number, verdict?: string, limit?: number }} filter
 * @returns {Array}
 */
export async function getIdeas(filter = {}) {
  await loadIdeas();

  let result = [...ideas];

  if (filter.status) {
    result = result.filter(i => i.status === filter.status);
  }
  if (filter.verdict) {
    result = result.filter(i => i.verdict === filter.verdict);
  }
  if (filter.minScore !== undefined) {
    result = result.filter(i => i.score >= filter.minScore);
  }
  if (filter.userId !== undefined) {
    result = result.filter(i => i.userId === filter.userId);
  }

  // Sort by score descending, then by date
  result.sort((a, b) => b.score - a.score || new Date(b.submittedAt) - new Date(a.submittedAt));

  if (filter.limit) {
    result = result.slice(0, filter.limit);
  }

  return result;
}

/**
 * Approve an idea (owner-only action).
 * @param {string} ideaId
 * @param {string} [approverNote] - optional note from the approver
 * @returns {{ ok: boolean, idea?: object, error?: string }}
 */
export async function approveIdea(ideaId, approverNote = null) {
  await loadIdeas();

  const idea = ideas.find(i => i.id === ideaId);
  if (!idea) {
    return { ok: false, error: `Idea ${ideaId} not found` };
  }
  if (idea.status === 'approved') {
    return { ok: false, error: `Idea ${ideaId} is already approved` };
  }

  idea.status = 'approved';
  idea.approvedAt = new Date().toISOString();
  idea.approvedBy = 'owner';
  if (approverNote) idea.notes = approverNote;

  await saveIdeas();
  console.log(`[idea-pipeline] Idea ${ideaId} approved`);

  return { ok: true, idea };
}

/**
 * Reject an idea with reason.
 * @param {string} ideaId
 * @param {string} [reason]
 * @returns {{ ok: boolean, idea?: object, error?: string }}
 */
export async function rejectIdea(ideaId, reason = null) {
  await loadIdeas();

  const idea = ideas.find(i => i.id === ideaId);
  if (!idea) {
    return { ok: false, error: `Idea ${ideaId} not found` };
  }

  idea.status = 'rejected';
  idea.reviewedAt = new Date().toISOString();
  if (reason) idea.notes = reason;

  await saveIdeas();
  console.log(`[idea-pipeline] Idea ${ideaId} rejected: ${reason || 'no reason given'}`);

  return { ok: true, idea };
}

/**
 * Mark an idea as implemented.
 * @param {string} ideaId
 * @param {string} [commitRef] - git commit or branch reference
 * @returns {{ ok: boolean, idea?: object, error?: string }}
 */
export async function markImplemented(ideaId, commitRef = null) {
  await loadIdeas();

  const idea = ideas.find(i => i.id === ideaId);
  if (!idea) {
    return { ok: false, error: `Idea ${ideaId} not found` };
  }

  idea.status = 'implemented';
  idea.implementedAt = new Date().toISOString();
  if (commitRef) idea.notes = (idea.notes ? idea.notes + '\n' : '') + `Implemented: ${commitRef}`;

  await saveIdeas();
  console.log(`[idea-pipeline] Idea ${ideaId} marked implemented`);

  return { ok: true, idea };
}

/**
 * Get summary statistics for the pipeline.
 * @returns {{ total: number, byVerdict: object, byStatus: object, avgScore: number, topContributors: Array, recentIdeas: Array }}
 */
export async function getIdeaStats() {
  await loadIdeas();

  const byVerdict = { accepted: 0, needs_work: 0, rejected: 0 };
  const byStatus = { pending_review: 0, approved: 0, rejected: 0, implemented: 0, needs_work: 0 };
  const contributorMap = new Map();
  let totalScore = 0;

  for (const idea of ideas) {
    byVerdict[idea.verdict] = (byVerdict[idea.verdict] || 0) + 1;
    byStatus[idea.status] = (byStatus[idea.status] || 0) + 1;
    totalScore += idea.score;

    const key = idea.username || String(idea.userId);
    if (!contributorMap.has(key)) {
      contributorMap.set(key, { username: key, count: 0, totalScore: 0, accepted: 0 });
    }
    const c = contributorMap.get(key);
    c.count++;
    c.totalScore += idea.score;
    if (idea.verdict === 'accepted') c.accepted++;
  }

  // Top contributors by average score (min 1 idea)
  const topContributors = [...contributorMap.values()]
    .map(c => ({ ...c, avgScore: Math.round(c.totalScore / c.count) }))
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 10);

  // Recent ideas (last 5)
  const recentIdeas = [...ideas]
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
    .slice(0, 5)
    .map(i => ({
      id: i.id,
      username: i.username,
      score: i.score,
      verdict: i.verdict,
      status: i.status,
      preview: i.text.slice(0, 80) + (i.text.length > 80 ? '...' : ''),
      submittedAt: i.submittedAt,
    }));

  return {
    total: ideas.length,
    byVerdict,
    byStatus,
    avgScore: ideas.length > 0 ? Math.round(totalScore / ideas.length) : 0,
    topContributors,
    recentIdeas,
  };
}

/**
 * Get a single idea by ID.
 * @param {string} ideaId
 * @returns {object|null}
 */
export async function getIdeaById(ideaId) {
  await loadIdeas();
  return ideas.find(i => i.id === ideaId) || null;
}

/**
 * Check if a high-scoring idea should trigger an owner notification.
 * Returns the idea if it scores 80+ and hasn't been notified yet.
 * @param {object} idea - The idea object from submitIdea result
 * @returns {{ shouldNotify: boolean, message?: string }}
 */
export function buildOwnerNotification(idea, evaluation) {
  if (evaluation.total_score < 80) {
    return { shouldNotify: false };
  }

  const scoreBar = '█'.repeat(Math.floor(evaluation.total_score / 5)) + '░'.repeat(20 - Math.floor(evaluation.total_score / 5));

  const message = [
    `🎯 High-scoring idea submitted`,
    ``,
    `From: @${idea.username || idea.userId}`,
    `Score: ${evaluation.total_score}/100 [${scoreBar}]`,
    ``,
    `Alignment: ${evaluation.alignment_score}/25 — ${evaluation.alignment_reason}`,
    `Feasibility: ${evaluation.feasibility_score}/25 — ${evaluation.feasibility_reason}`,
    `Novelty: ${evaluation.novelty_score}/25 — ${evaluation.novelty_reason}`,
    `Impact: ${evaluation.impact_score}/25 — ${evaluation.impact_reason}`,
    ``,
    `Idea: "${idea.text.slice(0, 300)}${idea.text.length > 300 ? '...' : ''}"`,
    ``,
    evaluation.implementation_notes ? `Implementation: ${evaluation.implementation_notes}` : '',
    ``,
    `Tags: ${(evaluation.tags || []).join(', ') || 'none'}`,
    `ID: ${idea.id}`,
    ``,
    `Approve: /approve_idea ${idea.id}`,
    `Reject: /reject_idea ${idea.id} [reason]`,
  ].filter(Boolean).join('\n');

  return { shouldNotify: true, message };
}

/**
 * Format the submitter response in Jarvis voice.
 * @param {object} result - The submitIdea result
 * @returns {string}
 */
export function formatSubmitterResponse(result) {
  const { score, feedback, id, evaluation, duplicate } = result;

  if (duplicate) {
    return `Already received this one. ${feedback}`;
  }

  const verdictEmoji = {
    accepted: '✅',
    needs_work: '🔧',
    rejected: '❌',
  };

  const scoreBar = '█'.repeat(Math.floor(score / 5)) + '░'.repeat(20 - Math.floor(score / 5));

  const lines = [
    `${verdictEmoji[evaluation.verdict] || '📝'} Idea evaluated`,
    ``,
    `Score: ${score}/100 [${scoreBar}]`,
    `  Alignment: ${evaluation.alignment_score}/25`,
    `  Feasibility: ${evaluation.feasibility_score}/25`,
    `  Novelty: ${evaluation.novelty_score}/25`,
    `  Impact: ${evaluation.impact_score}/25`,
    ``,
    feedback,
  ];

  if (evaluation.implementation_notes && score >= 50) {
    lines.push('', `Implementation path: ${evaluation.implementation_notes}`);
  }

  if (evaluation.tags && evaluation.tags.length > 0) {
    lines.push('', `Tags: ${evaluation.tags.join(', ')}`);
  }

  if (evaluation.verdict === 'accepted') {
    lines.push('', `This has been flagged for review. ID: ${id}`);
  } else if (evaluation.verdict === 'needs_work') {
    lines.push('', `Refine and resubmit anytime. ID: ${id}`);
  }

  return lines.join('\n');
}

/**
 * Flush ideas to disk (for graceful shutdown).
 */
export async function flushIdeas() {
  if (loaded && ideas.length > 0) {
    await saveIdeas();
    console.log(`[idea-pipeline] Flushed ${ideas.length} ideas to disk`);
  }
}
