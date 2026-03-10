// ============ Reputation-Weighted Consensus ============
//
// Asymmetric cost model: cooperation becomes progressively cheaper
// while attack remains constant or increases in cost.
//
// Mechanisms:
//   1. Progressive Difficulty — honest participants earn computational
//      discounts proportional to accumulated PoM score
//   2. Cooperation Multiplier — consistent cooperators earn amplified
//      Shapley rewards across proposal rounds
//   3. Reputation Staking — participants implicitly stake reputation
//      when voting; misbehavior triggers slash + difficulty reset
//   4. Viral Metrics — tracks flywheel position: diversity, niches,
//      cost-per-participant trajectory
//
// Integrates with:
//   - consensus.js (BFT proposal/vote pipeline)
//   - tracker.js (contribution scoring, quality signals)
//   - shard.js (shard identity, peer discovery)
//
// Paper: docs/papers/asymmetric-cost-consensus.md
// ============

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { onProposal, onCommit } from './consensus.js';

const DATA_DIR = config.dataDir;
const REPUTATION_FILE = join(DATA_DIR, 'reputation-scores.json');

// ============ Constants ============

// Progressive difficulty: difficulty = base / (1 + ALPHA * log(1 + score))
const ALPHA = 0.5;
const MIN_DIFFICULTY_RATIO = 0.15; // Floor: never below 15% of base difficulty

// Cooperation multiplier: bonus compounds per consecutive cooperative round
const COOP_BONUS_PER_ROUND = 0.02; // +2% per consecutive cooperation
const MAX_COOP_MULTIPLIER = 2.0;   // Cap at 2x

// Reputation staking: implicit stake when voting
const SLASH_FRACTION = 0.3;        // 30% of reputation slashed on misbehavior
const DIFFICULTY_RESET_ON_SLASH = true;

// Score weights for aggregating contribution dimensions
const SCORE_WEIGHTS = {
  contributions: 0.30,  // Total contribution count (from tracker)
  quality: 0.25,        // Average quality score (0-5)
  interactions: 0.15,   // Reply graph density (engagement)
  tenure: 0.15,         // Days since first seen
  consistency: 0.15,    // Active days / total days (regularity)
};

// Contribution category XP values (mirrors SoulboundIdentity.sol)
const CATEGORY_XP = {
  CODE: 100,
  IDEA: 50,
  GOVERNANCE: 50,
  REVIEW: 30,
  DESIGN: 20,
  COMMUNITY: 10,
};

// ============ State ============

// Per-entity reputation scores
// { entityId: { score, rawMetrics, cooperationStreak, slashCount, lastUpdate, history[] } }
let reputationScores = {};
let dirty = false;

// ============ Init / Persist ============

export async function initReputation() {
  try {
    const data = await readFile(REPUTATION_FILE, 'utf-8');
    reputationScores = JSON.parse(data);
    const count = Object.keys(reputationScores).length;
    if (count > 0) {
      console.log(`[reputation] Loaded ${count} reputation scores`);
    }
  } catch {
    console.log('[reputation] No saved reputation data — starting fresh');
  }

  // Register consensus hooks — reputation-weighted validation + cooperation rewards
  onProposal(async (type, data, proposal) => {
    return validateProposalByReputation(type, data, proposal);
  });
  onCommit(async (type, data, proposal) => {
    rewardCommitParticipants(type, data, proposal);
  });
  console.log('[reputation] Consensus hooks registered (proposal validation + cooperation rewards)');
}

export async function flushReputation() {
  if (!dirty) return;
  try {
    await writeFile(REPUTATION_FILE, JSON.stringify(reputationScores, null, 2));
    dirty = false;
  } catch (err) {
    console.warn(`[reputation] Flush failed: ${err.message}`);
  }
}

// ============ Score Computation ============

/**
 * Compute a unified reputation score from contribution data.
 *
 * @param {object} stats - Output from tracker.getUserStats()
 * @returns {number} Reputation score (0+, unbounded but log-compressed in difficulty)
 */
export function computeReputationScore(stats) {
  if (!stats) return 0;

  // Normalize each dimension to 0-100 range
  const contributionScore = Math.min(stats.contributions || 0, 500) / 5; // 500 contributions = 100
  const qualityScore = (parseFloat(stats.avgQuality) || 0) * 20;         // 5.0 quality = 100
  const interactionScore = Math.min((stats.repliesGiven || 0) + (stats.repliesReceived || 0), 200) / 2;
  const tenureScore = Math.min(stats.daysSinceFirst || 0, 365) / 3.65;   // 1 year = 100
  const consistencyScore = stats.daysSinceFirst > 0
    ? Math.min(((stats.messageCount || 0) / Math.max(stats.daysSinceFirst, 1)), 10) * 10
    : 0; // 10+ msgs/day = 100

  // XP from contribution categories
  let categoryXP = 0;
  if (stats.categoryCounts) {
    for (const [cat, count] of Object.entries(stats.categoryCounts)) {
      categoryXP += (CATEGORY_XP[cat] || 10) * count;
    }
  }

  // Weighted composite
  const composite =
    contributionScore * SCORE_WEIGHTS.contributions +
    qualityScore * SCORE_WEIGHTS.quality +
    interactionScore * SCORE_WEIGHTS.interactions +
    tenureScore * SCORE_WEIGHTS.tenure +
    consistencyScore * SCORE_WEIGHTS.consistency;

  // Add XP bonus (log-scaled to prevent gaming via spam)
  const xpBonus = Math.log(1 + categoryXP) * 5;

  return Math.round((composite + xpBonus) * 100) / 100;
}

// ============ Progressive Difficulty ============

/**
 * Compute the difficulty multiplier for a participant.
 * Lower = easier (honest veterans pay less).
 * Returns value between MIN_DIFFICULTY_RATIO and 1.0.
 *
 * @param {string} entityId - Shard ID or user ID
 * @returns {number} Difficulty multiplier (0.15 to 1.0)
 */
export function getDifficultyMultiplier(entityId) {
  const entry = reputationScores[entityId];
  if (!entry || entry.score <= 0) return 1.0; // Full difficulty for newcomers

  const discount = 1 / (1 + ALPHA * Math.log(1 + entry.score));
  return Math.max(discount, MIN_DIFFICULTY_RATIO);
}

/**
 * Get the effective computational requirement for a participant.
 *
 * @param {string} entityId
 * @param {number} baseDifficulty - The network's base difficulty
 * @returns {number} Effective difficulty for this participant
 */
export function getEffectiveDifficulty(entityId, baseDifficulty) {
  return baseDifficulty * getDifficultyMultiplier(entityId);
}

// ============ Cooperation Multiplier ============

/**
 * Record a cooperative action (honest vote, valid proposal, helpful contribution).
 * Increases cooperation streak → higher Shapley multiplier.
 *
 * @param {string} entityId
 */
export function recordCooperation(entityId) {
  ensureEntry(entityId);
  const entry = reputationScores[entityId];
  entry.cooperationStreak++;
  entry.lastUpdate = Date.now();
  dirty = true;
}

/**
 * Get the cooperation multiplier for Shapley reward amplification.
 * Consecutive cooperative rounds compound the bonus.
 *
 * @param {string} entityId
 * @returns {number} Multiplier (1.0 to MAX_COOP_MULTIPLIER)
 */
export function getCooperationMultiplier(entityId) {
  const entry = reputationScores[entityId];
  if (!entry) return 1.0;

  const bonus = 1.0 + (entry.cooperationStreak * COOP_BONUS_PER_ROUND);
  return Math.min(bonus, MAX_COOP_MULTIPLIER);
}

// ============ Reputation Staking / Slashing ============

/**
 * Slash a participant's reputation for detected misbehavior.
 * - Reduces score by SLASH_FRACTION
 * - Resets cooperation streak to 0
 * - Optionally resets difficulty discount (back to full cost)
 *
 * @param {string} entityId
 * @param {string} reason - Human-readable reason for the slash
 * @returns {object} { slashed: boolean, oldScore, newScore, reason }
 */
export function slashReputation(entityId, reason) {
  ensureEntry(entityId);
  const entry = reputationScores[entityId];
  const oldScore = entry.score;

  // Apply slash
  const penalty = entry.score * SLASH_FRACTION;
  entry.score = Math.max(0, entry.score - penalty);
  entry.cooperationStreak = 0;
  entry.slashCount++;
  entry.lastUpdate = Date.now();

  // Record in history
  entry.history.push({
    event: 'slash',
    oldScore,
    newScore: entry.score,
    penalty,
    reason,
    timestamp: Date.now(),
  });

  // Keep history bounded
  if (entry.history.length > 100) {
    entry.history = entry.history.slice(-100);
  }

  dirty = true;

  console.warn(`[reputation] SLASHED ${entityId}: ${oldScore.toFixed(1)} → ${entry.score.toFixed(1)} (reason: ${reason})`);

  return { slashed: true, oldScore, newScore: entry.score, reason };
}

/**
 * Check if a vote/action should be considered suspicious based on patterns.
 * Returns a suspicion score (0-1). Above 0.7 triggers investigation.
 *
 * @param {string} entityId
 * @param {object} action - { type, data, timestamp }
 * @returns {number} Suspicion score (0 = clean, 1 = certain misbehavior)
 */
export function assessSuspicion(entityId, action) {
  const entry = reputationScores[entityId];
  if (!entry) return 0.3; // Unknown entity gets mild suspicion

  let suspicion = 0;

  // Recent slash history (recidivism)
  if (entry.slashCount > 0) {
    suspicion += Math.min(entry.slashCount * 0.15, 0.45); // Max 0.45 from history
  }

  // Very new entity with high-impact action
  if (entry.score < 5 && action?.type === 'proposal') {
    suspicion += 0.2;
  }

  // Rapid-fire actions (potential automation/bot)
  if (entry.lastUpdate && Date.now() - entry.lastUpdate < 1000) {
    suspicion += 0.15;
  }

  return Math.min(suspicion, 1.0);
}

// ============ Score Updates ============

/**
 * Update a participant's reputation score from fresh contribution data.
 *
 * @param {string} entityId
 * @param {object} stats - Output from tracker.getUserStats()
 */
export function updateScore(entityId, stats) {
  ensureEntry(entityId);
  const entry = reputationScores[entityId];
  const oldScore = entry.score;

  entry.score = computeReputationScore(stats);
  entry.rawMetrics = {
    contributions: stats.contributions || 0,
    avgQuality: stats.avgQuality || 0,
    interactions: (stats.repliesGiven || 0) + (stats.repliesReceived || 0),
    tenure: stats.daysSinceFirst || 0,
    messageCount: stats.messageCount || 0,
  };
  entry.lastUpdate = Date.now();

  // Record significant score changes in history
  if (Math.abs(entry.score - oldScore) > 1) {
    entry.history.push({
      event: 'update',
      oldScore,
      newScore: entry.score,
      timestamp: Date.now(),
    });
    if (entry.history.length > 100) {
      entry.history = entry.history.slice(-100);
    }
  }

  dirty = true;
}

// ============ Viral Metrics ============

/**
 * Compute the network's position on the flywheel curve.
 * Returns metrics that indicate how close the network is to viral threshold.
 *
 * @returns {object} Viral metrics
 */
export function getViralMetrics() {
  const entities = Object.entries(reputationScores);
  if (entities.length === 0) {
    return {
      participants: 0,
      avgReputation: 0,
      avgDifficultyMultiplier: 1.0,
      avgCoopMultiplier: 1.0,
      contributionDiversity: 0,
      uniqueNiches: 0,
      flywheelStage: 'dormant',
      viralThresholdEstimate: 30,
    };
  }

  const scores = entities.map(([, e]) => e.score);
  const avgReputation = scores.reduce((a, b) => a + b, 0) / scores.length;
  const avgDifficulty = entities.reduce((sum, [id]) => sum + getDifficultyMultiplier(id), 0) / entities.length;
  const avgCoop = entities.reduce((sum, [id]) => sum + getCooperationMultiplier(id), 0) / entities.length;

  // Count unique contribution categories across all participants
  const allCategories = new Set();
  for (const [, entry] of entities) {
    if (entry.rawMetrics) {
      // Each user's contribution categories
      allCategories.add('contributions');
      if (entry.rawMetrics.avgQuality > 3) allCategories.add('high-quality');
      if (entry.rawMetrics.interactions > 10) allCategories.add('connected');
      if (entry.rawMetrics.tenure > 30) allCategories.add('veteran');
    }
  }

  // Flywheel stage classification
  let flywheelStage;
  if (entities.length < 5) flywheelStage = 'dormant';
  else if (avgReputation < 10) flywheelStage = 'ignition';
  else if (avgReputation < 30 || entities.length < 15) flywheelStage = 'acceleration';
  else if (avgDifficulty < 0.6) flywheelStage = 'flywheel';
  else flywheelStage = 'steady';

  // Estimated viral threshold based on current metrics
  // n* where log(n*) × (1 + α × log(1 + R)) > 1
  const reputationFactor = 1 + ALPHA * Math.log(1 + avgReputation);
  const viralThresholdEstimate = Math.ceil(Math.exp(1 / reputationFactor));

  return {
    participants: entities.length,
    avgReputation: Math.round(avgReputation * 100) / 100,
    avgDifficultyMultiplier: Math.round(avgDifficulty * 1000) / 1000,
    avgCoopMultiplier: Math.round(avgCoop * 1000) / 1000,
    contributionDiversity: allCategories.size,
    uniqueNiches: allCategories.size,
    flywheelStage,
    viralThresholdEstimate,
    totalSlashes: entities.reduce((sum, [, e]) => sum + (e.slashCount || 0), 0),
  };
}

// ============ Consensus Integration Hooks ============

/**
 * Hook for consensus.onProposal — validate proposals with reputation weight.
 * Returns false to reject proposals from highly suspicious entities.
 *
 * @param {string} type - Proposal type
 * @param {object} data - Proposal data
 * @param {object} proposal - Full proposal object (includes proposer)
 * @returns {boolean} true to accept, false to reject
 */
export function validateProposalByReputation(type, data, proposal) {
  const proposerId = proposal?.proposer;
  if (!proposerId) return true; // Can't validate without proposer info

  const suspicion = assessSuspicion(proposerId, { type, data, timestamp: Date.now() });
  if (suspicion > 0.7) {
    console.warn(`[reputation] Rejected proposal from ${proposerId}: suspicion ${suspicion.toFixed(2)}`);
    return false;
  }

  return true;
}

/**
 * Hook for consensus.onCommit — reward cooperators after successful commit.
 *
 * @param {string} type - Proposal type
 * @param {object} data - Proposal data
 * @param {object} proposal - Full proposal object
 */
export function rewardCommitParticipants(type, data, proposal) {
  const proposerId = proposal?.proposer;
  if (proposerId) {
    recordCooperation(proposerId);
  }
}

// ============ Query ============

/**
 * Get a participant's full reputation profile.
 *
 * @param {string} entityId
 * @returns {object|null}
 */
export function getReputationProfile(entityId) {
  const entry = reputationScores[entityId];
  if (!entry) return null;

  return {
    entityId,
    score: entry.score,
    difficultyMultiplier: getDifficultyMultiplier(entityId),
    cooperationMultiplier: getCooperationMultiplier(entityId),
    cooperationStreak: entry.cooperationStreak,
    slashCount: entry.slashCount,
    rawMetrics: entry.rawMetrics,
    lastUpdate: entry.lastUpdate ? new Date(entry.lastUpdate).toISOString() : null,
    recentHistory: (entry.history || []).slice(-10),
  };
}

/**
 * Get all reputation scores (for diagnostics / /reputation command).
 */
export function getAllReputationScores() {
  return { ...reputationScores };
}

// ============ Helpers ============

function ensureEntry(entityId) {
  if (!reputationScores[entityId]) {
    reputationScores[entityId] = {
      score: 0,
      rawMetrics: null,
      cooperationStreak: 0,
      slashCount: 0,
      lastUpdate: null,
      history: [],
    };
  }
}
