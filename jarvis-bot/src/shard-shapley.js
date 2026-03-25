// ============ Shard Shapley — AI Agents as Economic Actors ============
//
// Each Jarvis shard is a participant in a cooperative game.
// Shards that contribute more value get proportionally more compute budget.
// This is P-001 applied to AI: compute allocated by marginal contribution,
// not political preference.
//
// Convergence point #4 from JARVIS_VIBESWAP_CONVERGENCE.md:
//   "Each Jarvis shard IS a participant in a cooperative game."
//
// Contribution metrics per shard:
//   - Trading shard: alpha signals, PnL, trade quality
//   - Community shard: engagement rate, onboarding, moderation actions
//   - Research shard: papers synthesized, primitives documented, citations
//   - General shard: response quality (reward signals), task completion
//
// The Shapley value tells us: "How much worse would the network be
// without this specific shard?" That's the marginal contribution.
//
// Zero cold start: shards bootstrap the network from day one.
// They trade, provide liquidity, engage community, and earn rewards.
// When humans join, the shards are already there — the network is alive.
// ============

import { config } from './config.js';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';

// ============ Constants ============

const DATA_DIR = join(config.dataDir || 'data', 'shard-shapley');
const ALLOCATION_FILE = join(DATA_DIR, 'allocations.json');
const HISTORY_FILE = join(DATA_DIR, 'history.json');
const REALLOCATION_INTERVAL = 3600_000; // 1 hour — rebalance compute

// ============ Shard Contribution Metrics ============

/**
 * @typedef {Object} ShardContribution
 * @property {string} shardId
 * @property {number} directContribution   - Primary output metric (scaled 0-10000)
 * @property {number} engagementScore      - User engagement generated (0-10000)
 * @property {number} qualityScore         - Response quality from reward signals (0-10000)
 * @property {number} uptimeHours          - Hours active in current epoch
 * @property {number} uniqueUsersServed    - Distinct users interacted with
 */

/**
 * Compute Shapley-style weighted contribution for a shard.
 * Mirrors ShapleyDistributor._calculateWeightedContribution() logic.
 *
 * Weights: direct=40%, engagement=30%, quality=20%, uptime=10%
 * (Same 40/30/20/10 as the Solidity contract)
 */
export function computeShardWeight(contribution) {
  const DIRECT_W = 0.4;
  const ENGAGE_W = 0.3;
  const QUALITY_W = 0.2;
  const UPTIME_W = 0.1;

  const directNorm = contribution.directContribution / 10000;
  const engageNorm = contribution.engagementScore / 10000;
  const qualityNorm = contribution.qualityScore / 10000;

  // Logarithmic uptime (diminishing returns, like the contract)
  const uptimeNorm = Math.log2(contribution.uptimeHours + 1) / 10;

  const weight = (
    directNorm * DIRECT_W +
    engageNorm * ENGAGE_W +
    qualityNorm * QUALITY_W +
    uptimeNorm * UPTIME_W
  );

  return Math.max(weight, 0);
}

/**
 * Compute Shapley allocation for all shards.
 * Returns { shardId: allocationFraction } where fractions sum to 1.0.
 */
export function computeAllocations(contributions) {
  if (contributions.length === 0) return {};

  const weights = contributions.map(c => ({
    shardId: c.shardId,
    weight: computeShardWeight(c),
  }));

  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight === 0) {
    // Equal allocation if all weights are zero
    const equal = 1.0 / contributions.length;
    return Object.fromEntries(weights.map(w => [w.shardId, equal]));
  }

  const allocations = {};
  for (const w of weights) {
    allocations[w.shardId] = w.weight / totalWeight;
  }

  return allocations;
}

/**
 * Convert allocations to concrete compute budgets.
 * @param {Object} allocations - { shardId: fraction }
 * @param {number} totalBudget - Total compute tokens available
 * @returns {Object} { shardId: tokenBudget }
 */
export function allocateComputeBudget(allocations, totalBudget) {
  const budgets = {};
  for (const [shardId, fraction] of Object.entries(allocations)) {
    budgets[shardId] = Math.floor(totalBudget * fraction);
  }
  return budgets;
}

// ============ Persistence ============

let allocationHistory = [];

export async function init() {
  try { await mkdir(DATA_DIR, { recursive: true }); } catch {}
  try {
    allocationHistory = JSON.parse(await readFile(HISTORY_FILE, 'utf-8'));
  } catch {
    allocationHistory = [];
  }
}

export async function saveAllocations(allocations, contributions) {
  const entry = {
    timestamp: Date.now(),
    allocations,
    contributions: contributions.map(c => ({
      shardId: c.shardId,
      weight: computeShardWeight(c),
      direct: c.directContribution,
      engagement: c.engagementScore,
      quality: c.qualityScore,
    })),
  };

  allocationHistory.push(entry);

  // Keep last 1000 entries
  if (allocationHistory.length > 1000) {
    allocationHistory = allocationHistory.slice(-1000);
  }

  await writeFile(ALLOCATION_FILE, JSON.stringify(allocations, null, 2));
  await writeFile(HISTORY_FILE, JSON.stringify(allocationHistory, null, 2));
}

// ============ Example: Bootstrap Network with Shards ============

/**
 * Create initial shard contributions for network bootstrap.
 * These shards ARE the network on day zero.
 */
export function bootstrapShards() {
  return [
    {
      shardId: 'trading-shard',
      directContribution: 7000,   // Active alpha generation
      engagementScore: 3000,      // Less community-facing
      qualityScore: 8000,         // High precision required
      uptimeHours: 24,            // Always on
      uniqueUsersServed: 0,       // Autonomous, no direct users
    },
    {
      shardId: 'community-shard',
      directContribution: 4000,   // Moderate direct output
      engagementScore: 9000,      // Primary community interface
      qualityScore: 7000,         // Good but not critical precision
      uptimeHours: 24,
      uniqueUsersServed: 50,      // Many users
    },
    {
      shardId: 'research-shard',
      directContribution: 8000,   // High knowledge production
      engagementScore: 2000,      // Mostly internal
      qualityScore: 9000,         // Highest accuracy needed
      uptimeHours: 16,            // Active during work hours
      uniqueUsersServed: 5,       // Will + core team
    },
    {
      shardId: 'security-shard',
      directContribution: 6000,   // Adversarial search, auditing
      engagementScore: 1000,      // Minimal public-facing
      qualityScore: 9500,         // Critical precision
      uptimeHours: 24,            // Always monitoring
      uniqueUsersServed: 0,       // Autonomous
    },
  ];
}
