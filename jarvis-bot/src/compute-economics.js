// ============ Compute Economics — Shapley-Compliant Budget System ============
//
// Bounds API costs with a Shapley-weighted budget allocation.
// Contributors earn more compute. Spammers hit the free tier ceiling.
// Total daily cost is capped by the operator's pool.
//
// Budget formula:
//   B_i = B_free + B_pool × S_i / Σ(S_j)
//
// Shapley weight:
//   S_i = 0.40×D + 0.30×E + 0.20×R + 0.10×T
//
//   D = Direct quality     = avg(quality_signals) / 5           [0..1]
//   E = Enabling knowledge = (facts + access_credits/100) / 50  [0..1]
//   R = Scarcity           = unique_categories / total_cats      [0..1]
//   T = Stability          = min(days_active / 30, 1)            [0..1]
//
// Degradation:
//   80% budget used → responses capped at 512 tokens (warn)
//   100% budget used → request denied with message
//
// Persistence: data/compute-economics.json, saved every 60s when dirty.
// Day rollover: zeros `today` counters, recomputes Shapley weights.
// ============

import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { getDailyBurned, burnJUL, getMiningStats } from './mining.js';

const DATA_DIR = config.dataDir;
const STATE_FILE = join(DATA_DIR, 'compute-economics.json');

// ============ Constants ============

const FREE_BUDGET_ANONYMOUS = 5_000;   // tokens/day for unidentified users
const FREE_BUDGET_IDENTIFIED = 10_000; // tokens/day for identified users
const BASE_POOL = 500_000;             // Will's baseline funding (floor)
const JUL_TO_POOL_RATIO = 1_000;       // 1 JUL burned = 1000 extra pool tokens

const DEGRADED_MAX_TOKENS = 512;       // cap when budget > 80%
const DEGRADE_THRESHOLD = 0.80;        // 80% = start degrading

// Shapley dimension weights
const W_DIRECT    = 0.40;
const W_ENABLING  = 0.30;
const W_SCARCITY  = 0.20;
const W_STABILITY = 0.10;

// Total categories from tracker
const TOTAL_CATEGORIES = 6; // IDEA, CODE, GOVERNANCE, COMMUNITY, DESIGN, REVIEW

const FREE_TELEGRAM_DMS = 3;          // free DMs/day for non-team users

const SAVE_INTERVAL = 60_000; // 60s

// ============ Dynamic Pool ============

/**
 * Effective pool = BASE_POOL + (daily JUL burned × JUL_TO_POOL_RATIO).
 * Work-credit loop: mining → burn → pool expansion → more budget for everyone.
 */
export function getEffectivePool() {
  const julBurned = getDailyBurned();
  return BASE_POOL + Math.round(julBurned * JUL_TO_POOL_RATIO);
}

// ============ State ============

let state = {
  users: {},       // userId -> UserEconomics
  dayKey: '',      // YYYY-MM-DD — triggers rollover when it changes
  shapleySum: 0,   // Σ(S_j) — cached, recomputed on rollover
};

let dirty = false;
let saveTimer = null;

// UserEconomics shape:
// {
//   today: { input: 0, output: 0 },  // tokens used today
//   allTime: { input: 0, output: 0 }, // tokens used all time
//   quality: { sum: 0, count: 0 },    // quality signal accumulator
//   facts: 0,                         // facts contributed
//   accessCredits: 0,                 // times their facts were accessed by others
//   categories: [],                   // unique categories of their messages
//   firstSeen: '2026-01-01',          // date string
//   shapleyWeight: 0,                 // cached S_i
//   budget: 0,                        // cached B_i (tokens/day)
//   identified: false,                // has username/wallet
// }

// ============ Helpers ============

function todayKey() {
  return new Date().toISOString().split('T')[0];
}

function ensureUser(userId) {
  if (!state.users[userId]) {
    state.users[userId] = {
      today: { input: 0, output: 0, telegramDMs: 0 },
      allTime: { input: 0, output: 0 },
      quality: { sum: 0, count: 0 },
      facts: 0,
      accessCredits: 0,
      categories: [],
      firstSeen: todayKey(),
      shapleyWeight: 0,
      budget: FREE_BUDGET_ANONYMOUS,
      identified: false,
    };
    dirty = true;
  }
  return state.users[userId];
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// ============ Shapley Weight Computation ============

function computeWeight(user) {
  // D = Direct quality = avg(quality_signals) / 5
  const D = user.quality.count > 0
    ? clamp01((user.quality.sum / user.quality.count) / 5)
    : 0;

  // E = Enabling knowledge = (facts + accessCredits/100) / 50
  const E = clamp01((user.facts + user.accessCredits / 100) / 50);

  // R = Scarcity = unique_categories / total_categories
  const R = clamp01(user.categories.length / TOTAL_CATEGORIES);

  // T = Stability = min(days_active / 30, 1)
  const daysSinceFirst = Math.max(0,
    (Date.now() - new Date(user.firstSeen).getTime()) / (1000 * 60 * 60 * 24)
  );
  const T = clamp01(daysSinceFirst / 30);

  return W_DIRECT * D + W_ENABLING * E + W_SCARCITY * R + W_STABILITY * T;
}

export function computeShapleyWeights() {
  let sum = 0;
  for (const userId of Object.keys(state.users)) {
    const user = state.users[userId];
    user.shapleyWeight = computeWeight(user);
    sum += user.shapleyWeight;
  }
  state.shapleySum = sum;

  // Recompute budgets
  for (const userId of Object.keys(state.users)) {
    const user = state.users[userId];
    const freeBudget = user.identified ? FREE_BUDGET_IDENTIFIED : FREE_BUDGET_ANONYMOUS;
    const poolShare = sum > 0
      ? getEffectivePool() * user.shapleyWeight / sum
      : 0;
    user.budget = Math.round(freeBudget + poolShare);
  }

  dirty = true;
}

// ============ Day Rollover ============

function checkDayRollover() {
  const today = todayKey();
  if (state.dayKey === today) return;

  console.log(`[compute-econ] Day rollover: ${state.dayKey || '(first run)'} → ${today}`);
  state.dayKey = today;

  // Zero daily counters
  for (const user of Object.values(state.users)) {
    user.today = { input: 0, output: 0, telegramDMs: 0 };
  }

  // Recompute Shapley weights for the new day
  computeShapleyWeights();
  dirty = true;
}

// ============ Budget Check ============

export function checkBudget(userId) {
  checkDayRollover();
  const user = ensureUser(userId);

  const used = user.today.input + user.today.output;
  const budget = user.budget || (user.identified ? FREE_BUDGET_IDENTIFIED : FREE_BUDGET_ANONYMOUS);
  const remaining = Math.max(0, budget - used);
  const ratio = budget > 0 ? used / budget : 0;
  const degraded = ratio >= DEGRADE_THRESHOLD;
  const exceeded = ratio >= 1.0;

  if (exceeded) {
    // Auto-burn: if user has JUL balance, burn 1 JUL for extra budget
    const mining = getMiningStats(userId);
    if (mining.julBalance >= 1) {
      const burn = burnJUL(userId, 1, 'auto-burn');
      if (burn.success) {
        // Grant extra budget from the burn
        const extraTokens = burn.poolExpansion; // 1000 tokens
        user.budget += extraTokens;
        dirty = true;

        // Recompute after burn expanded the pool
        const newRemaining = Math.max(0, user.budget - used);
        return {
          allowed: true,
          budget: user.budget,
          used,
          remaining: newRemaining,
          degraded: false,
          maxTokens: null,
          autoBurned: true,
          julBurned: 1,
          message: `Auto-burned 1 JUL for ${extraTokens.toLocaleString()} extra tokens. Balance: ${burn.newBalance.toFixed(2)} JUL.`,
        };
      }
    }

    return {
      allowed: false,
      budget,
      used,
      remaining: 0,
      degraded: true,
      maxTokens: 0,
      message: `Daily budget exceeded (${used.toLocaleString()}/${budget.toLocaleString()} tokens). Resets at midnight UTC. Mine JUL for extra compute or contribute quality content.`,
    };
  }

  return {
    allowed: true,
    budget,
    used,
    remaining,
    degraded,
    maxTokens: degraded ? DEGRADED_MAX_TOKENS : null,
    message: degraded
      ? `Budget ${Math.round(ratio * 100)}% used — responses shortened to conserve quota.`
      : null,
  };
}

// ============ Record Usage ============

export function recordUsage(userId, usage, quality) {
  checkDayRollover();
  const user = ensureUser(userId);

  const input = usage?.input || 0;
  const output = usage?.output || 0;

  user.today.input += input;
  user.today.output += output;
  user.allTime.input += input;
  user.allTime.output += output;

  if (typeof quality === 'number' && quality >= 0) {
    user.quality.sum += quality;
    user.quality.count += 1;
  }

  dirty = true;
}

// ============ Category + Identity Tracking ============

export function recordCategory(userId, category) {
  const user = ensureUser(userId);
  if (category && !user.categories.includes(category)) {
    user.categories.push(category);
    dirty = true;
  }
}

export function markIdentified(userId) {
  const user = ensureUser(userId);
  if (!user.identified) {
    user.identified = true;
    // Recompute this user's budget immediately
    const freeBudget = FREE_BUDGET_IDENTIFIED;
    const poolShare = state.shapleySum > 0
      ? getEffectivePool() * user.shapleyWeight / state.shapleySum
      : 0;
    user.budget = Math.round(freeBudget + poolShare);
    dirty = true;
  }
}

// ============ Knowledge Access Credits ============

export function creditKnowledgeAccess(userId) {
  const user = ensureUser(userId);
  user.accessCredits += 1;
  dirty = true;
}

export function creditFact(userId) {
  const user = ensureUser(userId);
  user.facts += 1;
  dirty = true;
}

// ============ Telegram DM Paywall ============

export function recordTelegramMessage(userId) {
  checkDayRollover();
  const user = ensureUser(userId);
  user.today.telegramDMs = (user.today.telegramDMs || 0) + 1;
  dirty = true;
}

export function getTelegramMessageCount(userId) {
  checkDayRollover();
  const user = ensureUser(userId);
  return user.today.telegramDMs || 0;
}

export { FREE_TELEGRAM_DMS };

// ============ Stats ============

export function getComputeStats(userId) {
  checkDayRollover();

  // Pool-level stats
  const allUsers = Object.entries(state.users);
  const poolUsed = allUsers.reduce((sum, [, u]) => sum + u.today.input + u.today.output, 0);
  const activeToday = allUsers.filter(([, u]) => u.today.input + u.today.output > 0).length;

  const effectivePool = getEffectivePool();
  const julBurnedToday = getDailyBurned();
  const julBonus = Math.round(julBurnedToday * JUL_TO_POOL_RATIO);

  const pool = {
    basePool: BASE_POOL,
    julBonus,
    dailyPool: effectivePool,
    julBurnedToday,
    poolUsed,
    poolRemaining: Math.max(0, effectivePool - poolUsed),
    poolUtilization: effectivePool > 0 ? Math.round((poolUsed / effectivePool) * 100) : 0,
    activeUsers: activeToday,
    totalUsers: allUsers.length,
    shapleySum: Math.round(state.shapleySum * 1000) / 1000,
  };

  // Per-user stats (if requested)
  if (userId && state.users[userId]) {
    const user = state.users[userId];
    const used = user.today.input + user.today.output;
    return {
      pool,
      user: {
        budget: user.budget,
        used,
        remaining: Math.max(0, user.budget - used),
        utilization: user.budget > 0 ? Math.round((used / user.budget) * 100) : 0,
        shapleyWeight: Math.round(user.shapleyWeight * 1000) / 1000,
        quality: user.quality.count > 0
          ? Math.round((user.quality.sum / user.quality.count) * 10) / 10
          : 0,
        facts: user.facts,
        accessCredits: user.accessCredits,
        categories: user.categories.length,
        identified: user.identified,
        allTimeTokens: user.allTime.input + user.allTime.output,
      },
    };
  }

  return { pool };
}

// ============ Persistence ============

async function loadState() {
  try {
    const data = await readFile(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    state = { ...state, ...parsed };
    console.log(`[compute-econ] Loaded state: ${Object.keys(state.users).length} users, day=${state.dayKey}`);
  } catch {
    console.log('[compute-econ] No saved state — starting fresh');
  }
}

async function saveState() {
  if (!dirty) return;
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    dirty = false;
  } catch (err) {
    console.error('[compute-econ] Failed to save:', err.message);
  }
}

// ============ Init / Shutdown ============

export async function initComputeEconomics() {
  await loadState();
  checkDayRollover();

  // Periodic save
  saveTimer = setInterval(() => saveState(), SAVE_INTERVAL);

  const userCount = Object.keys(state.users).length;
  console.log(`[compute-econ] Initialized — ${userCount} users, pool=${getEffectivePool().toLocaleString()} tokens/day`);
}

export async function flushComputeEconomics() {
  if (saveTimer) {
    clearInterval(saveTimer);
    saveTimer = null;
  }
  await saveState();
}
