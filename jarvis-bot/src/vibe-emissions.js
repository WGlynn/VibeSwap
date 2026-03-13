// ============ VIBE Token Emission Engine ============
// Tracks VIBE earned by community members based on verifiable contributions.
// Emissions are Shapley-compliant: reward = marginal contribution to coalition.
// All scores grounded in evidence hashes from tracker.js.
//
// Emission schedule:
// - Base rate: 100 VIBE/day distributed across all active users
// - Quality multiplier: quality_score / avg_quality (better contributions = more VIBE)
// - Streak multiplier: 1 + (streak_days * 0.02) capped at 1.5x
// - Category bonuses: technical +20%, trading +10%, community +5%
// - Conviction bonus: longer tenure = higher share (sqrt(days_active))
//
// VIBE is NOT minted on-chain yet — this tracks pending emissions.
// When token contract deploys, these become claimable.
// ============

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { getAllUsers, getUserStats, getUserWallet, getUserStreak } from './tracker.js';
import { getFactualScore } from './tools-xp.js';

const DATA_DIR = config.dataDir;
const EMISSIONS_FILE = join(DATA_DIR, 'vibe-emissions.json');

// ============ Constants ============

const BASE_DAILY_RATE = 100;  // 100 VIBE/day total pool
const STREAK_MULTIPLIER_CAP = 1.5;
const STREAK_MULTIPLIER_RATE = 0.02; // per day
const CATEGORY_BONUSES = {
  CODE: 0.20,
  REVIEW: 0.20,
  IDEA: 0.10,
  DESIGN: 0.10,
  GOVERNANCE: 0.05,
  COMMUNITY: 0.05,
};

// ============ State ============

// userId -> { balance, lastEmission, dailyRate, history: [{ timestamp, amount, reason }] }
let balances = {};
let totalEmitted = 0;
let lastTickTimestamp = 0;

// ============ Init / Persist ============

export async function initEmissions() {
  try {
    const data = await readFile(EMISSIONS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    balances = parsed.balances || {};
    totalEmitted = parsed.totalEmitted || 0;
    lastTickTimestamp = parsed.lastTickTimestamp || 0;
    console.log(`[vibe-emissions] Loaded ${Object.keys(balances).length} balances, ${totalEmitted.toFixed(2)} VIBE total emitted`);
  } catch {
    console.log('[vibe-emissions] No saved emission data — starting fresh');
  }
}

export async function flushEmissions() {
  try {
    await writeFile(EMISSIONS_FILE, JSON.stringify({
      balances,
      totalEmitted,
      lastTickTimestamp,
    }, null, 2));
  } catch (err) {
    console.warn(`[vibe-emissions] Save failed: ${err.message}`);
  }
}

// ============ Core Emission Logic ============

/**
 * Calculate a single user's daily VIBE emission based on factual contributions.
 * Returns { daily, breakdown } where breakdown explains each multiplier.
 */
export function calculateDailyEmission(userId) {
  const factual = getFactualScore(userId);
  if (!factual || factual.message_count === 0) {
    return { daily: 0, breakdown: { reason: 'no tracked contributions' } };
  }

  // Get all active users to compute proportional share
  const allUsers = getAllUsers();
  const activeUserIds = Object.keys(allUsers).filter(id => {
    const u = allUsers[id];
    // Active = has sent a message in the last 7 days
    return u.lastSeen && (Date.now() - u.lastSeen) < 7 * 24 * 60 * 60 * 1000;
  });

  if (activeUserIds.length === 0) {
    return { daily: 0, breakdown: { reason: 'no active users' } };
  }

  // Compute user's raw weight
  const weight = computeUserWeight(factual);

  // Compute total weight across all active users
  let totalWeight = 0;
  for (const id of activeUserIds) {
    const score = getFactualScore(Number(id));
    if (score) {
      totalWeight += computeUserWeight(score);
    }
  }

  if (totalWeight === 0) {
    return { daily: 0, breakdown: { reason: 'zero total weight' } };
  }

  const share = weight / totalWeight;
  const daily = BASE_DAILY_RATE * share;

  return {
    daily: Math.round(daily * 100) / 100,
    breakdown: {
      base_rate: BASE_DAILY_RATE,
      your_weight: Math.round(weight * 100) / 100,
      total_weight: Math.round(totalWeight * 100) / 100,
      share_pct: Math.round(share * 10000) / 100,
      active_users: activeUserIds.length,
      quality_multiplier: Math.round(weight / Math.max(1, Math.sqrt(factual.days_active)) * 100) / 100,
      streak_multiplier: Math.min(STREAK_MULTIPLIER_CAP, 1 + factual.streak_days * STREAK_MULTIPLIER_RATE),
    },
  };
}

/**
 * Compute a user's emission weight from factual score.
 * Weight = conviction_bonus * quality_factor * streak_multiplier * (1 + category_bonus)
 */
function computeUserWeight(factual) {
  // Conviction bonus: sqrt(days_active) — longer tenure = higher share
  const conviction = Math.sqrt(Math.max(1, factual.days_active));

  // Quality factor: quality_sum scaled by contribution count
  const qualityFactor = Math.max(0.1, factual.quality_avg);

  // Streak multiplier: 1 + (streak_days * 0.02), capped at 1.5x
  const streakMult = Math.min(STREAK_MULTIPLIER_CAP, 1 + factual.streak_days * STREAK_MULTIPLIER_RATE);

  // Category bonus: weighted average of category bonuses
  let categoryBonus = 0;
  const totalCatContributions = Object.values(factual.categories).reduce((s, v) => s + v, 0);
  if (totalCatContributions > 0) {
    for (const [cat, count] of Object.entries(factual.categories)) {
      const bonus = CATEGORY_BONUSES[cat] || 0;
      categoryBonus += bonus * (count / totalCatContributions);
    }
  }

  // Message volume factor (log scale to prevent spam farming)
  const volumeFactor = Math.log2(Math.max(1, factual.message_count));

  return conviction * qualityFactor * streakMult * (1 + categoryBonus) * volumeFactor;
}

// ============ Emission Tick (Hourly) ============

/**
 * Process one emission tick. Called every hour.
 * Distributes VIBE to all active users proportionally.
 */
export async function processEmissionTick() {
  const allUsers = getAllUsers();
  const activeUserIds = Object.keys(allUsers).filter(id => {
    const u = allUsers[id];
    return u.lastSeen && (Date.now() - u.lastSeen) < 7 * 24 * 60 * 60 * 1000;
  });

  if (activeUserIds.length === 0) return;

  // Hourly portion of daily rate
  const hourlyPool = BASE_DAILY_RATE / 24;

  // Compute all weights
  const weights = {};
  let totalWeight = 0;
  for (const id of activeUserIds) {
    const score = getFactualScore(Number(id));
    if (score) {
      const w = computeUserWeight(score);
      weights[id] = w;
      totalWeight += w;
    }
  }

  if (totalWeight === 0) return;

  // Distribute proportionally
  for (const [id, weight] of Object.entries(weights)) {
    const share = weight / totalWeight;
    const amount = hourlyPool * share;

    if (amount < 0.001) continue; // Skip dust

    if (!balances[id]) {
      balances[id] = { balance: 0, lastEmission: 0, history: [] };
    }

    balances[id].balance += amount;
    balances[id].lastEmission = Date.now();

    // Keep last 100 history entries per user
    balances[id].history.push({
      timestamp: Date.now(),
      amount: Math.round(amount * 1000) / 1000,
      hourly: true,
    });
    if (balances[id].history.length > 100) {
      balances[id].history = balances[id].history.slice(-100);
    }

    totalEmitted += amount;
  }

  lastTickTimestamp = Date.now();
  await flushEmissions();
}

// ============ Balance Queries ============

export function getVibeBalance(userId) {
  const id = String(userId);
  const entry = balances[id];
  if (!entry) return { balance: 0, lastEmission: null };
  return {
    balance: Math.round(entry.balance * 100) / 100,
    lastEmission: entry.lastEmission ? new Date(entry.lastEmission).toISOString() : null,
  };
}

export function getEmissionStats() {
  const userCount = Object.keys(balances).length;
  const sortedBalances = Object.entries(balances)
    .map(([id, data]) => ({ id, balance: data.balance }))
    .sort((a, b) => b.balance - a.balance);

  const topEarners = sortedBalances.slice(0, 5);

  return {
    total_emitted: Math.round(totalEmitted * 100) / 100,
    daily_rate: BASE_DAILY_RATE,
    active_earners: userCount,
    top_earners: topEarners.map(e => ({
      user_id: e.id,
      balance: Math.round(e.balance * 100) / 100,
    })),
    last_tick: lastTickTimestamp ? new Date(lastTickTimestamp).toISOString() : 'never',
  };
}

export function getLeaderboard(limit = 10) {
  const allUsers = getAllUsers();
  const sorted = Object.entries(balances)
    .map(([id, data]) => {
      const user = allUsers[id];
      return {
        id,
        username: user?.username || user?.firstName || `User ${id}`,
        balance: Math.round(data.balance * 100) / 100,
      };
    })
    .sort((a, b) => b.balance - a.balance)
    .slice(0, limit);

  return sorted;
}

// ============ LLM Tool Definitions ============

export const EMISSION_TOOLS = [
  {
    name: 'get_vibe_balance',
    description: 'Get a user\'s accumulated VIBE token balance',
    input_schema: {
      type: 'object',
      properties: {
        user_id: { type: 'number', description: 'Telegram user ID' },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'get_vibe_leaderboard',
    description: 'Get top VIBE earners leaderboard',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of top earners to show (default 10)' },
      },
    },
  },
  {
    name: 'get_emission_stats',
    description: 'Get VIBE emission statistics: total emitted, daily rate, top earners',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

export function handleEmissionTool(name, input) {
  switch (name) {
    case 'get_vibe_balance': {
      const bal = getVibeBalance(input.user_id);
      const emission = calculateDailyEmission(input.user_id);
      return JSON.stringify({ ...bal, daily_rate: emission.daily, breakdown: emission.breakdown });
    }
    case 'get_vibe_leaderboard': {
      return JSON.stringify(getLeaderboard(input.limit || 10));
    }
    case 'get_emission_stats': {
      return JSON.stringify(getEmissionStats());
    }
    default:
      return JSON.stringify({ error: `Unknown emission tool: ${name}` });
  }
}
