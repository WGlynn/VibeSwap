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
import { getDailyBurned, burnJUL, getMiningStats, getHashCostIndex } from './mining.js';

const DATA_DIR = config.dataDir;
const STATE_FILE = join(DATA_DIR, 'compute-economics.json');

// ============ Constants ============

const FREE_BUDGET_ANONYMOUS = 5_000;   // tokens/day for unidentified users
const FREE_BUDGET_IDENTIFIED = 10_000; // tokens/day for identified users
const BASE_POOL = 500_000;             // Will's baseline funding (floor)

// ============ JUL Pricing Oracle — Floor/Ceiling Convergence ============
//
// From the Trinomial Stability Theorem:
//   "The production theory of value (energy-backed) gives you the floor.
//    The time adjustments (CPI, Shapley T) keep that floor honest across
//    history. The market (Phase 3) gives you the ceiling — what people
//    actually think it's worth in practice."
//
// Three-layer oracle architecture (§5.2 dual oracle, extended):
//
// Layer 0 — FLOOR (trustless, always-on, oracle-free):
//   Hash cost index from mining epoch behavior. The network measures
//   its own production cost: ε₀ = cost of a hash in electricity.
//   No external data. The network IS the oracle.
//
// Layer 1 — REFINEMENT (semi-trusted, optional fine-tuning):
//   CPI + API cost via /reprice. Cross-validates against Layer 0.
//   If Layer 1 diverges >25% from Layer 0: Layer 0 wins (circuit breaker).
//   "Each oracle constrains the other" — Trinomial §5.2
//
// Layer 2 — CEILING (market, future):
//   AMM price discovery. The market IS the oracle.
//   Replaces both layers. JUL/USDC LP price = purchasing power.
//
// Floor and ceiling converge over time → price stability.
// Volatility bound: σ²_elec ≈ 2-5% annually (Trinomial §11.4)
//
const BASE_RATIO = 1_000;                // tokens per JUL at calibration
const REFERENCE_COST_PER_MTOK = 3.00;    // $/MTok when ratio was set (Sonnet 3.5 input)
const REFERENCE_CPI = 100;               // CPI index at calibration (normalized base)
const LAYER_DIVERGENCE_LIMIT = 0.25;     // 25% max divergence before circuit breaker

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

// ============ Dynamic Pool + Three-Layer Floating Ratio ============

/**
 * Layer 0: Trustless hash cost ratio (floor).
 * Derived entirely from the mining network's own epoch behavior.
 * No external oracle. The network IS the measurement.
 *
 * From Trinomial §3.3: price converges to ε₀ (cost of a hash in electricity).
 * If hash cost index rises (mining more expensive): ratio increases
 * (JUL costs more to produce, so it should buy more tokens).
 * If hash cost index falls: ratio decreases.
 */
function getLayer0Ratio() {
  const hci = getHashCostIndex();
  if (hci.confidence < 0.1) return BASE_RATIO; // not enough data yet
  return Math.max(1, Math.round(BASE_RATIO * hci.index));
}

/**
 * Layer 1: CPI-adjusted ratio (refinement).
 * Semi-trusted: Will sets costPerMTok + cpiIndex via /reprice.
 * Adjusts for dollar inflation and API pricing changes.
 */
function getLayer1Ratio() {
  const p = state.pricing;
  const currentCost = p.costPerMTok || REFERENCE_COST_PER_MTOK;
  const currentCPI = p.cpiIndex || REFERENCE_CPI;

  // Real cost = nominal cost adjusted for purchasing power
  const currentRealCost = currentCost * (REFERENCE_CPI / currentCPI);

  return Math.max(1, Math.round(BASE_RATIO * (REFERENCE_COST_PER_MTOK / currentRealCost)));
}

/**
 * Three-layer JUL→token ratio with circuit breaker.
 *
 * Layer 0 (hash cost) is the trustless floor — always computed.
 * Layer 1 (CPI/API cost) fine-tunes — but if it diverges >25% from
 * Layer 0, the circuit breaker fires and Layer 0 wins.
 *
 * "Each oracle constrains the other. If one feed were compromised or
 *  manipulated, the other provides an independent physical-reality
 *  anchor." — Trinomial Stability Theorem §5.2
 *
 * Layer 2 (AMM market price) will replace both when JUL is on-chain.
 */
export function getJulToPoolRatio() {
  const layer0 = getLayer0Ratio();
  const layer1 = getLayer1Ratio();
  const hci = getHashCostIndex();

  // If Layer 0 doesn't have enough data, use Layer 1 alone
  if (hci.confidence < 0.1) {
    return layer1;
  }

  // Circuit breaker: if Layer 1 diverges >25% from Layer 0, Layer 0 wins
  const divergence = Math.abs(layer1 - layer0) / layer0;
  if (divergence > LAYER_DIVERGENCE_LIMIT) {
    console.log(`[compute-econ] Circuit breaker: Layer 1 (${layer1}) diverges ${(divergence * 100).toFixed(1)}% from Layer 0 (${layer0}) — using Layer 0`);
    return layer0;
  }

  // Normal operation: geometric mean of both layers
  // Geometric mean respects proportional changes and prevents either
  // layer from dominating. It's the "conservative composite" from §5.2.
  return Math.max(1, Math.round(Math.sqrt(layer0 * layer1)));
}

/**
 * Effective pool = BASE_POOL + (daily JUL burned × floating ratio).
 * Work-credit loop: mining → burn → pool expansion → more budget for everyone.
 */
export function getEffectivePool() {
  const julBurned = getDailyBurned();
  return BASE_POOL + Math.round(julBurned * getJulToPoolRatio());
}

/**
 * Update the pricing oracle. Owner-only via /reprice.
 * Returns the new ratio for display.
 */
export function updatePricing({ costPerMTok, cpiIndex } = {}) {
  if (!state.pricing) {
    state.pricing = {
      costPerMTok: REFERENCE_COST_PER_MTOK,
      cpiIndex: REFERENCE_CPI,
      lastUpdated: null,
      source: 'manual',
    };
  }
  // Bounded pricing: $0.01–$100/MTok, CPI 50–500
  if (typeof costPerMTok === 'number' && costPerMTok >= 0.01 && costPerMTok <= 100) {
    state.pricing.costPerMTok = costPerMTok;
  }
  if (typeof cpiIndex === 'number' && cpiIndex >= 50 && cpiIndex <= 500) {
    state.pricing.cpiIndex = cpiIndex;
  }
  state.pricing.lastUpdated = Date.now();
  dirty = true;

  // Recompute Shapley budgets with new ratio
  computeShapleyWeights();

  return {
    costPerMTok: state.pricing.costPerMTok,
    cpiIndex: state.pricing.cpiIndex,
    ratio: getJulToPoolRatio(),
    effectivePool: getEffectivePool(),
  };
}

/**
 * Get current pricing oracle state for display.
 * Exposes all three layers for transparency.
 */
export function getPricingInfo() {
  const p = state.pricing || {};
  const hci = getHashCostIndex();
  const layer0 = getLayer0Ratio();
  const layer1 = getLayer1Ratio();
  const finalRatio = getJulToPoolRatio();
  const divergence = layer0 > 0 ? Math.abs(layer1 - layer0) / layer0 : 0;
  const circuitBroken = hci.confidence >= 0.1 && divergence > LAYER_DIVERGENCE_LIMIT;

  return {
    // Final ratio (what's actually used)
    ratio: finalRatio,
    baseRatio: BASE_RATIO,
    // Layer 0: trustless hash cost (floor)
    layer0: {
      ratio: layer0,
      hashCostIndex: hci.index,
      confidence: hci.confidence,
      epochsUsed: hci.epochsUsed,
      trend: hci.trend,
      difficulty: hci.currentDifficulty,
      referenceDifficulty: hci.referenceDifficulty,
    },
    // Layer 1: CPI fine-tuning (refinement)
    layer1: {
      ratio: layer1,
      costPerMTok: p.costPerMTok || REFERENCE_COST_PER_MTOK,
      cpiIndex: p.cpiIndex || REFERENCE_CPI,
      referenceCostPerMTok: REFERENCE_COST_PER_MTOK,
      referenceCPI: REFERENCE_CPI,
      lastUpdated: p.lastUpdated,
    },
    // Cross-validation
    divergence: Math.round(divergence * 1000) / 10,  // percentage
    circuitBroken,
    source: circuitBroken ? 'layer0 (circuit breaker)' :
            hci.confidence < 0.1 ? 'layer1 (layer0 bootstrapping)' :
            'geometric mean (layer0 × layer1)',
  };
}

// ============ State ============

let state = {
  users: {},       // userId -> UserEconomics
  dayKey: '',      // YYYY-MM-DD — triggers rollover when it changes
  shapleySum: 0,   // Σ(S_j) — cached, recomputed on rollover
  pricing: {
    costPerMTok: REFERENCE_COST_PER_MTOK,  // current $/MTok (Will updates via /reprice)
    cpiIndex: REFERENCE_CPI,                // current CPI index (Will updates via /reprice)
    lastUpdated: null,                       // timestamp of last repricing
    source: 'manual',                        // 'manual' | 'market' (phase 3)
  },
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

  // Cap per-call tokens to prevent a single malformed call from destroying accounting
  const MAX_TOKENS_PER_CALL = 200_000;
  const input = Math.max(0, Math.min(MAX_TOKENS_PER_CALL, usage?.input || 0));
  const output = Math.max(0, Math.min(MAX_TOKENS_PER_CALL, usage?.output || 0));

  user.today.input += input;
  user.today.output += output;
  user.allTime.input += input;
  user.allTime.output += output;

  // Clamp quality to [0, 5]
  if (typeof quality === 'number') {
    user.quality.sum += Math.max(0, Math.min(5, quality));
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
  const currentRatio = getJulToPoolRatio();
  const julBonus = Math.round(julBurnedToday * currentRatio);

  const pool = {
    basePool: BASE_POOL,
    julBonus,
    julToPoolRatio: currentRatio,
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

function validateState(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  if (parsed.users && typeof parsed.users !== 'object') return false;
  if (parsed.dayKey && typeof parsed.dayKey !== 'string') return false;
  if (parsed.shapleySum !== undefined && typeof parsed.shapleySum !== 'number') return false;
  // Validate user entries
  if (parsed.users) {
    for (const [userId, user] of Object.entries(parsed.users)) {
      if (!user || typeof user !== 'object') return false;
      if (user.today && (typeof user.today.input !== 'number' || typeof user.today.output !== 'number')) return false;
      if (user.allTime && (typeof user.allTime.input !== 'number' || typeof user.allTime.output !== 'number')) return false;
      // Check for corrupted negative values
      if (user.today?.input < 0 || user.today?.output < 0) return false;
      if (user.allTime?.input < 0 || user.allTime?.output < 0) return false;
    }
  }
  // Validate pricing
  if (parsed.pricing) {
    const p = parsed.pricing;
    if (p.costPerMTok !== undefined && (typeof p.costPerMTok !== 'number' || p.costPerMTok <= 0)) return false;
    if (p.cpiIndex !== undefined && (typeof p.cpiIndex !== 'number' || p.cpiIndex <= 0)) return false;
  }
  return true;
}

async function loadState() {
  try {
    const data = await readFile(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (!validateState(parsed)) {
      console.warn('[compute-econ] State file failed validation — using default state');
      return;
    }
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
