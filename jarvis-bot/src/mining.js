// ============ Mining Module — PoW Verification + JUL Elastic Emission ============
//
// Server-side SHA-256 PoW verification engine for Jarvis shard miners.
// Ports bit-counting logic from ckb/lib/pow/src/lib.rs for compatibility.
//
// JUL is cyphercash — elastic supply mutual credit for compute, modeled after
// Ergon (Licho, 2023). Reward is PROPORTIONAL to actual computational work,
// with Moore's law decay (~2.3yr halving) to compensate hardware improvement.
//
// Core formula (Ergon model):
//   work = 2^difficulty                    // actual hashes expected for proof
//   work *= (MOORE_DECAY)^epochsSinceGenesis  // smooth Moore's law correction
//   work /= CALIBRATION                   // scale to JUL denomination
//   reward = work                          // reward IS the work
//
// JUL is NOT a speculative token. It's a reusable proof of work — mutual credit
// that burns for compute access. No hard cap needed; supply is bounded by physics
// (escape velocity) and natural sinks (lost coins, compute burns, FR collapses).
//
// See: elastic-money-primitives.md for full Ergon/Licho knowledge base.
// State persists to data/mining-state.json, auto-saved every 60s.
// ============

import { createHash, randomBytes } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { creditFact, markIdentified, getJulToPoolRatio } from './compute-economics.js';

// ============ Constants ============

const BASE_DIFFICULTY = 8;        // 8 leading zero bits (~256 hashes)
const INITIAL_DIFFICULTY = 12;    // ~4096 hashes (~4 seconds on phone)
const MAX_DIFFICULTY = 32;        // ~4B hashes (cap for mobile)
const EPOCH_LENGTH = 100;         // proofs per difficulty adjustment
const TARGET_EPOCH_DURATION = 3600; // seconds (1 hour)
const CHALLENGE_ROTATION = 300;   // new challenge every 5 min
const MAX_PROOFS_PER_MINUTE = 5;  // rate limit per user
const JUL_PER_API_TOKEN_FALLBACK = 1000; // fallback before compute-economics loads

// ============ Ergon-Model Proportional Reward ============
// Reward = (2^difficulty) / CALIBRATION * MOORE_DECAY^epochsSinceGenesis
//
// The calibration constant is chosen so that at difficulty 12, epoch 0,
// reward ≈ 16 JUL (matching the previous fixed reward for continuity).
//
// 2^12 = 4096. To get 16 JUL: CALIBRATION = 4096 / 16 = 256
//
// Moore's law decay: hardware doubles in efficiency every ~2.3 years.
// With 1-hour epochs: 2.3 years ≈ 2.3 * 365 * 24 = 20,148 epochs.
// Decay per epoch = 2^(-1/20148) = 0.999965596... ≈ 99997/100000
// After 20,148 epochs: 0.999965596^20148 ≈ 0.5 (halving achieved)

const CALIBRATION = 256;                      // 2^12 / 16 — anchors diff 12 = 16 JUL at epoch 0
const MOORE_HALVING_EPOCHS = 20148;           // epochs for 50% decay (2.3yr × 365d × 24h)
// Per-epoch decay computed exactly: 2^(-1/20148) — no integer approximation needed
const MOORE_DECAY_PER_EPOCH = Math.pow(2, -1 / MOORE_HALVING_EPOCHS); // 0.99996559575...

// Dynamic ratio from pricing oracle (CPI-adjusted)
function julToTokens() {
  try { return getJulToPoolRatio(); }
  catch { return JUL_PER_API_TOKEN_FALLBACK; }
}
const AUTO_SAVE_INTERVAL = 60_000; // 60s
const MAX_ADJUSTMENT = 2;         // max ±2 bits per epoch

// ============ State ============

const STATE_FILE = join(config.dataDir || 'data', 'mining-state.json');

let state = {
  difficulty: INITIAL_DIFFICULTY,
  epoch: 0,
  epochProofs: 0,
  epochStartTime: Date.now(),
  totalProofs: 0,
  challenge: '',
  challengeCreatedAt: 0,
  balances: {},      // userId -> JUL balance
  proofCounts: {},   // userId -> total proofs
  replaySet: [],     // proof hashes for current epoch (serialized as array)
  treasury: {
    totalBurned: 0,       // all-time JUL burned (never resets)
    dailyBurned: 0,       // JUL burned today (resets on day rollover)
    dailyBurnDate: '',    // YYYY-MM-DD — triggers daily reset
    tips: [],             // tip records [{ userId, amount, timestamp }]
    // ============ Tip Split: 50% POL + 50% Autonomous Treasury ============
    // Tips are split 50/50:
    //   - Protocol-Owned Liquidity (POL): permanent locked LP position on Base
    //     mainnet VibeSwap. Lock-and-burn style — liquidity never leaves.
    //   - Autonomous Treasury: funds objective value contributions to the DAG
    //     and protocol growth. Self-sustaining, no human bottleneck.
    liquidityPool: 0,     // 50% → permanent POL (lock-and-burn LP on Base)
    autonomousTreasury: 0, // 50% → DAG contributions, protocol growth
  },
  // Layer 0 oracle: epoch history for trustless hash cost index
  // Tracks how long each epoch took vs target — the network's own
  // measurement of real-world mining economics (electricity + hardware).
  epochHistory: [],       // [{ epoch, difficulty, duration, proofs, timestamp }]
};

let replaySet = new Set();       // in-memory Set for O(1) lookups
let rateLimits = new Map();      // userId -> [timestamps]
let saveTimer = null;
let dirty = false;

// ============ PoW Verification (port of ckb/lib/pow/src/lib.rs:79-93) ============

/**
 * Count leading zero bits in a hash buffer (0-255).
 * Matches Rust: count_leading_zero_bits()
 */
export function countLeadingZeroBits(hashBuffer) {
  for (let i = 0; i < hashBuffer.length; i++) {
    const byte = hashBuffer[i];
    if (byte === 0) continue;
    // Math.clz32 counts leading zeros in a 32-bit int
    // Byte is 8 bits, so subtract 24 to get leading zeros in the byte
    return i * 8 + (Math.clz32(byte) - 24);
  }
  return 255; // All bytes zero — matches Rust
}

/**
 * Verify a SHA-256 PoW proof.
 * hash = SHA-256(challenge || nonce) must have >= difficulty leading zero bits.
 */
function verifyProof(challenge, nonce, claimedHash, difficulty) {
  // Recompute hash
  const hasher = createHash('sha256');
  hasher.update(Buffer.from(challenge, 'hex'));
  hasher.update(Buffer.from(nonce, 'hex'));
  const computed = hasher.digest();

  // Verify claimed hash matches
  if (computed.toString('hex') !== claimedHash) {
    return { valid: false, reason: 'hash_mismatch' };
  }

  // Check difficulty
  const zeroBits = countLeadingZeroBits(computed);
  if (zeroBits < difficulty) {
    return { valid: false, reason: 'insufficient_difficulty', got: zeroBits, need: difficulty };
  }

  return { valid: true, zeroBits };
}

// ============ Challenge Management ============

function rotateChallenge() {
  state.challenge = randomBytes(32).toString('hex');
  state.challengeCreatedAt = Date.now();
  dirty = true;
}

function ensureChallenge() {
  const age = (Date.now() - state.challengeCreatedAt) / 1000;
  if (!state.challenge || age >= CHALLENGE_ROTATION) {
    rotateChallenge();
  }
}

// ============ Difficulty Adjustment (port of Rust adjust_difficulty) ============

function adjustDifficulty() {
  const elapsed = (Date.now() - state.epochStartTime) / 1000;
  if (elapsed <= 0) return;

  const ratio = TARGET_EPOCH_DURATION / elapsed;

  let adjustment;
  if (ratio > 1) {
    // Epoch completed too fast → increase difficulty
    adjustment = Math.min(Math.ceil(Math.log2(ratio)), MAX_ADJUSTMENT);
  } else if (ratio < 1) {
    // Epoch completed too slow → decrease difficulty
    adjustment = -Math.min(Math.ceil(Math.log2(1 / ratio)), MAX_ADJUSTMENT);
  } else {
    adjustment = 0;
  }

  const newDifficulty = Math.max(BASE_DIFFICULTY, Math.min(MAX_DIFFICULTY, state.difficulty + adjustment));
  console.log(`[mining] Difficulty adjustment: ${state.difficulty} → ${newDifficulty} (epoch ${state.epoch}, ${elapsed.toFixed(0)}s, ratio ${ratio.toFixed(2)})`);
  state.difficulty = newDifficulty;
}

// ============ Reward Calculation (Ergon Proportional Model) ============
//
// Reward is proportional to ACTUAL computational work (2^difficulty hashes),
// decayed by Moore's law correction. This is the Ergon formula adapted for
// epoch-based (not block-based) mining.
//
// At difficulty d, epoch e:
//   work = 2^d                           (expected hashes to find proof)
//   mooreDecay = 2^(-e/20148)             (exact halving over ~2.3 years)
//   reward = work * mooreDecay / CALIBRATION
//
// Properties:
//   - Proportional: more work → more reward (not arbitrary exponential)
//   - Elastic: miners adjust effort based on profitability (invisible hand)
//   - Decaying: hardware improvements don't inflate supply
//   - No hard cap: supply bounded by physics (escape velocity)

function calculateReward(difficulty) {
  // Work = expected number of hashes for this difficulty
  const work = Math.pow(2, difficulty);

  // Moore's law decay — applied per epoch since genesis
  // Exact: decay = 2^(-epoch/HALVING_EPOCHS) — halves every 20,148 epochs (2.3 years)
  const epoch = state.epoch || 0;
  const mooreDecay = Math.pow(2, -epoch / MOORE_HALVING_EPOCHS);

  // Reward = work × decay / calibration
  const reward = (work * mooreDecay) / CALIBRATION;

  // Floor at minimum reward — even at heat death, mining still earns something
  return Math.max(reward, 0.001);
}

// ============ Rate Limiting ============

function checkMiningRateLimit(userId) {
  const now = Date.now();
  const bucket = rateLimits.get(userId) || [];
  const recent = bucket.filter(t => now - t < 60_000);
  if (recent.length >= MAX_PROOFS_PER_MINUTE) {
    rateLimits.set(userId, recent);
    return false;
  }
  recent.push(now);
  rateLimits.set(userId, recent);
  return true;
}

// ============ Public API ============

/**
 * Get current mining target for clients.
 */
export function getCurrentTarget() {
  ensureChallenge();
  return {
    challenge: state.challenge,
    difficulty: state.difficulty,
    epoch: state.epoch,
    reward: calculateReward(state.difficulty),
    activeMinerCount: Object.keys(state.proofCounts).length,
    totalProofs: state.totalProofs,
    epochProgress: `${state.epochProofs}/${EPOCH_LENGTH}`,
  };
}

/**
 * Submit a PoW proof. Returns acceptance result + JUL balance.
 */
export function submitProof(userId, nonce, hash, challenge) {
  if (!userId || !nonce || !hash || !challenge) {
    return { accepted: false, reason: 'missing_fields' };
  }

  // Rate limit
  if (!checkMiningRateLimit(userId)) {
    return { accepted: false, reason: 'rate_limited', retryAfter: 60 };
  }

  // Challenge validity
  ensureChallenge();
  if (challenge !== state.challenge) {
    return { accepted: false, reason: 'stale_challenge' };
  }

  // Replay prevention
  const proofKey = `${challenge}:${nonce}`;
  if (replaySet.has(proofKey)) {
    return { accepted: false, reason: 'duplicate_proof' };
  }

  // Verify PoW
  const result = verifyProof(challenge, nonce, hash, state.difficulty);
  if (!result.valid) {
    return { accepted: false, reason: result.reason, details: result };
  }

  // Accept proof
  replaySet.add(proofKey);

  // Credit JUL
  const reward = calculateReward(state.difficulty);
  state.balances[userId] = (state.balances[userId] || 0) + reward;
  state.proofCounts[userId] = (state.proofCounts[userId] || 0) + 1;
  state.totalProofs++;
  state.epochProofs++;
  dirty = true;

  // Bridge to compute economics: mining earns API credits + Shapley weight
  try {
    creditFact(userId);
    markIdentified(userId);
  } catch (err) {
    console.warn(`[mining] Compute economics bridge error: ${err.message}`);
  }

  console.log(`[mining] Proof accepted from ${userId} — reward: ${reward.toFixed(2)} JUL (${result.zeroBits} bits, difficulty ${state.difficulty})`);

  // Epoch transition
  if (state.epochProofs >= EPOCH_LENGTH) {
    // Record epoch history BEFORE adjustment (raw signal for Layer 0 oracle)
    const epochDuration = (Date.now() - state.epochStartTime) / 1000;
    if (!state.epochHistory) state.epochHistory = [];
    state.epochHistory.push({
      epoch: state.epoch,
      difficulty: state.difficulty,
      duration: epochDuration,
      proofs: state.epochProofs,
      timestamp: Date.now(),
    });
    // Keep last 100 epochs (bounded memory)
    if (state.epochHistory.length > 100) {
      state.epochHistory = state.epochHistory.slice(-100);
    }

    adjustDifficulty();
    state.epoch++;
    state.epochProofs = 0;
    state.epochStartTime = Date.now();
    // Rotate challenge FIRST — old proofs become stale before replay set clears
    rotateChallenge();
    replaySet.clear();
    state.replaySet = [];
    console.log(`[mining] New epoch ${state.epoch} — difficulty: ${state.difficulty}`);
  }

  return {
    accepted: true,
    reward,
    julBalance: state.balances[userId],
    apiTokensEarned: reward * julToTokens(),
    proofsSubmitted: state.proofCounts[userId],
    epoch: state.epoch,
    difficulty: state.difficulty,
  };
}

/**
 * Get mining stats for a user.
 */
export function getMiningStats(userId) {
  ensureChallenge();
  return {
    julBalance: state.balances[userId] || 0,
    proofsSubmitted: state.proofCounts[userId] || 0,
    apiTokensEarned: (state.balances[userId] || 0) * julToTokens(),
    difficulty: state.difficulty,
    epoch: state.epoch,
    epochProgress: `${state.epochProofs}/${EPOCH_LENGTH}`,
    activeMinerCount: Object.keys(state.proofCounts).length,
    totalNetworkProofs: state.totalProofs,
    reward: calculateReward(state.difficulty),
  };
}

// ============ Treasury — JUL Burn + Tip ============

function ensureTreasuryDayRollover() {
  const today = new Date().toISOString().split('T')[0];
  if (!state.treasury) {
    state.treasury = { totalBurned: 0, dailyBurned: 0, dailyBurnDate: today, tips: [] };
  }
  if (state.treasury.dailyBurnDate !== today) {
    state.treasury.dailyBurned = 0;
    state.treasury.dailyBurnDate = today;
    dirty = true;
  }
}

/**
 * Burn JUL from a user's balance into the treasury.
 * Returns { success, burned, newBalance, poolExpansion } or { success: false, reason }.
 */
export function burnJUL(userId, amount, reason = 'burn') {
  ensureTreasuryDayRollover();
  if (!userId || typeof amount !== 'number' || amount <= 0) {
    return { success: false, reason: 'invalid_amount' };
  }
  const balance = state.balances[userId] || 0;
  if (balance < amount) {
    return { success: false, reason: 'insufficient_balance', balance };
  }

  state.balances[userId] = balance - amount;
  state.treasury.totalBurned += amount;
  state.treasury.dailyBurned += amount;
  dirty = true;

  console.log(`[mining] Burn: ${userId} burned ${amount.toFixed(2)} JUL (${reason}) — daily total: ${state.treasury.dailyBurned.toFixed(2)}`);

  return {
    success: true,
    burned: amount,
    newBalance: state.balances[userId],
    poolExpansion: amount * julToTokens(),
    dailyBurned: state.treasury.dailyBurned,
    totalBurned: state.treasury.totalBurned,
  };
}

/**
 * Tip JUL — burn from sender's balance, record in treasury.
 * Returns receipt or { success: false, reason }.
 */
export function tipJUL(fromUserId, amount) {
  const result = burnJUL(fromUserId, amount, 'tip');
  if (!result.success) return result;

  state.treasury.tips.push({
    userId: fromUserId,
    amount,
    timestamp: Date.now(),
  });

  // 50/50 tip split: POL + Autonomous Treasury
  // Half bootstraps permanent liquidity (lock-and-burn LP on Base mainnet)
  // Half funds DAG value contributions and protocol growth (self-sustaining)
  if (!state.treasury.liquidityPool) state.treasury.liquidityPool = 0;
  if (!state.treasury.autonomousTreasury) state.treasury.autonomousTreasury = 0;
  const halfAmount = amount / 2;
  state.treasury.liquidityPool += halfAmount;
  state.treasury.autonomousTreasury += halfAmount;

  // Keep tips array bounded (last 1000)
  if (state.treasury.tips.length > 1000) {
    state.treasury.tips = state.treasury.tips.slice(-1000);
  }

  dirty = true;
  return {
    ...result,
    liquidityPool: state.treasury.liquidityPool,
    autonomousTreasury: state.treasury.autonomousTreasury,
  };
}

/**
 * Get daily JUL burned (for compute-economics pool expansion).
 */
export function getDailyBurned() {
  ensureTreasuryDayRollover();
  return state.treasury.dailyBurned;
}

/**
 * Get treasury stats for display.
 */
export function getTreasuryStats() {
  ensureTreasuryDayRollover();
  const now = Date.now();
  const todayTips = state.treasury.tips.filter(t =>
    new Date(t.timestamp).toISOString().split('T')[0] === state.treasury.dailyBurnDate
  );

  return {
    totalBurned: state.treasury.totalBurned,
    dailyBurned: state.treasury.dailyBurned,
    dailyPoolExpansion: state.treasury.dailyBurned * julToTokens(),
    liquidityPool: state.treasury.liquidityPool || 0,
    autonomousTreasury: state.treasury.autonomousTreasury || 0,
    tipsToday: todayTips.length,
    tipsAllTime: state.treasury.tips.length,
    topTippers: Object.entries(
      state.treasury.tips.reduce((acc, t) => {
        acc[t.userId] = (acc[t.userId] || 0) + t.amount;
        return acc;
      }, {})
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([userId, total]) => ({ userId, totalTipped: total })),
  };
}

// ============ Supply Economics (Ergon Escape Velocity) ============
//
// No hard cap. Supply bounded by physics. Escape velocity formula:
//   totalSupply = currentSupply + (halvingTime / ln2) × rewardRate × proofsPerEpoch
//
// Even at max difficulty with infinite hashrate, Moore's law decay ensures
// the supply converges. This is the "escape velocity" — the theoretical
// maximum supply if current conditions persist forever.

/**
 * Calculate total circulating supply (all balances + burned).
 */
export function getTotalSupply() {
  const circulating = Object.values(state.balances).reduce((s, b) => s + b, 0);
  const burned = state.treasury?.totalBurned || 0;
  return { circulating, burned, totalMinted: circulating + burned };
}

/**
 * Calculate escape velocity — theoretical max supply if current mining
 * conditions persist forever with Moore's law decay.
 *
 * Formula: currentSupply + factor × currentRewardPerProof × proofsPerEpoch
 * Where factor = halvingTime / ln(2) (in epochs)
 *
 * The halvingTime in epochs = MOORE_HALVING_EPOCHS
 */
export function getEscapeVelocity() {
  const { totalMinted, circulating, burned } = getTotalSupply();
  const currentReward = calculateReward(state.difficulty);
  const proofsPerEpoch = EPOCH_LENGTH;

  // Factor = halvingTime / ln(2) (Licho's derivation)
  const factor = MOORE_HALVING_EPOCHS / Math.LN2;

  // Future supply = factor × reward × proofs per epoch
  const futureSupply = factor * currentReward * proofsPerEpoch;
  const escapeVelocity = totalMinted + futureSupply;

  return {
    currentSupply: circulating,
    totalMinted,
    burned,
    escapeVelocity: Math.round(escapeVelocity * 100) / 100,
    currentReward: Math.round(currentReward * 1000) / 1000,
    mooreDecayPercent: ((1 - MOORE_DECAY_PER_EPOCH) * 100).toFixed(6),
    halvingEpochs: MOORE_HALVING_EPOCHS,
    halvingYears: 2.3,
    epoch: state.epoch,
    difficulty: state.difficulty,
  };
}

// ============ Layer 0: Trustless Hash Cost Oracle ============
//
// From the Trinomial Stability Theorem (§3.3):
//   Price converges to ε₀ — the cost of a single hash in electricity.
//   h'(t) = α(N'(t)×p(t) - h(t)×ε)
//
// The mining network's own epoch behavior measures ε₀ trustlessly:
//   - Epoch runs FAST (< target): miners spending more compute than expected
//     → energy is cheap / hardware plentiful → deflationary signal
//   - Epoch runs SLOW (> target): miners spending less compute
//     → energy is expensive / hardware scarce → inflationary signal
//
// Layer 0 = trustless, always-on, oracle-free (the network IS the oracle)
// Layer 1 = CPI/API cost fine-tuning via /reprice (semi-trusted, optional)
// Layer 2 = AMM price discovery (future — market replaces all oracles)
//
// The hash cost index is an EMA of epoch efficiency ratios. It captures
// the real-world production cost of computational work without any
// external data feed. Dual-oracle architecture (§5.2) cross-validates:
// if Layer 1 CPI diverges >25% from Layer 0 hash cost, Layer 0 wins.

const HASH_COST_EMA_ALPHA = 0.3;         // EMA smoothing (higher = more reactive)
const HASH_COST_REFERENCE_DIFFICULTY = INITIAL_DIFFICULTY; // difficulty at calibration

/**
 * Compute the trustless hash cost index from epoch history.
 *
 * hashCostIndex = EMA of (epochDuration / TARGET_EPOCH_DURATION)
 *   × (currentDifficulty / referenceDifficulty)
 *
 * The first factor captures temporal efficiency: are miners spending
 * more or less real-world compute than expected?
 *
 * The second factor captures difficulty trend: has the network attracted
 * more or less hash power over time? Rising difficulty = economic
 * expansion (more miners willing to spend energy on JUL).
 *
 * Index > 1.0: mining is getting more expensive (inflationary pressure)
 * Index < 1.0: mining is getting cheaper (deflationary pressure)
 * Index = 1.0: equilibrium (production cost unchanged from reference)
 *
 * Returns { index, epochsUsed, confidence, currentDifficulty, trend }
 */
export function getHashCostIndex() {
  const history = state.epochHistory || [];

  // Not enough data yet — return neutral
  if (history.length < 2) {
    return {
      index: 1.0,
      epochsUsed: history.length,
      confidence: 0,
      currentDifficulty: state.difficulty,
      referenceDifficulty: HASH_COST_REFERENCE_DIFFICULTY,
      trend: 'insufficient_data',
    };
  }

  // Compute EMA of epoch duration ratios
  let ema = history[0].duration / TARGET_EPOCH_DURATION;
  for (let i = 1; i < history.length; i++) {
    const ratio = history[i].duration / TARGET_EPOCH_DURATION;
    ema = HASH_COST_EMA_ALPHA * ratio + (1 - HASH_COST_EMA_ALPHA) * ema;
  }

  // Difficulty trend factor: how has difficulty moved from reference?
  // Higher difficulty = more hash power being spent = economic expansion
  const difficultyFactor = state.difficulty / HASH_COST_REFERENCE_DIFFICULTY;

  // Combined index: epoch efficiency × difficulty trend
  // If epochs run slow AND difficulty is rising: strong inflationary signal
  // If epochs run fast AND difficulty is falling: strong deflationary signal
  const index = ema * difficultyFactor;

  // Confidence: increases with more epochs of data (0..1)
  const confidence = Math.min(1, history.length / 20);

  // Trend classification
  const recentEpochs = history.slice(-5);
  const recentAvgDuration = recentEpochs.reduce((s, e) => s + e.duration, 0) / recentEpochs.length;
  const trend = recentAvgDuration < TARGET_EPOCH_DURATION * 0.8 ? 'deflationary'
    : recentAvgDuration > TARGET_EPOCH_DURATION * 1.2 ? 'inflationary'
    : 'equilibrium';

  return {
    index: Math.round(index * 1000) / 1000,
    epochsUsed: history.length,
    confidence: Math.round(confidence * 100) / 100,
    currentDifficulty: state.difficulty,
    referenceDifficulty: HASH_COST_REFERENCE_DIFFICULTY,
    trend,
  };
}

// ============ Account Linking — Mobile Miner → Telegram ============

/**
 * Link a mobile mining identity to a Telegram user ID.
 * Transfers JUL balance and proof count from minerId to telegramId.
 * The minerId balance is zeroed — all future lookups use telegramId.
 *
 * Security: knowing the minerId (device-generated hash) = proof of device possession.
 * Future mining from the Mini App with valid initData will use telegramId directly.
 */
export function linkMiner(telegramId, minerId) {
  if (!telegramId || !minerId) {
    return { success: false, reason: 'missing_ids' };
  }
  telegramId = String(telegramId);
  minerId = String(minerId);

  if (telegramId === minerId) {
    return { success: false, reason: 'same_id' };
  }

  const minerBalance = state.balances[minerId] || 0;
  const minerProofs = state.proofCounts[minerId] || 0;

  if (minerBalance === 0 && minerProofs === 0) {
    return { success: false, reason: 'miner_not_found', minerId };
  }

  // Transfer balance and proofs
  state.balances[telegramId] = (state.balances[telegramId] || 0) + minerBalance;
  state.proofCounts[telegramId] = (state.proofCounts[telegramId] || 0) + minerProofs;

  // Zero out the old miner (don't delete — keeps history visible)
  state.balances[minerId] = 0;
  state.proofCounts[minerId] = 0;

  // Track the link for future reference
  if (!state.linkedMiners) state.linkedMiners = {};
  state.linkedMiners[telegramId] = minerId;

  dirty = true;

  console.log(`[mining] Linked miner ${minerId} → ${telegramId} — transferred ${minerBalance.toFixed(2)} JUL, ${minerProofs} proofs`);

  return {
    success: true,
    telegramId,
    minerId,
    transferred: minerBalance,
    proofsTransferred: minerProofs,
    newBalance: state.balances[telegramId],
    totalProofs: state.proofCounts[telegramId],
  };
}

/**
 * Get the linked miner ID for a Telegram user (if any).
 */
export function getLinkedMiner(telegramId) {
  return state.linkedMiners?.[String(telegramId)] || null;
}

// ============ Leaderboard ============

export function getLeaderboard(limit = 10) {
  const entries = Object.entries(state.balances)
    .map(([userId, balance]) => ({
      userId,
      julBalance: balance,
      proofsSubmitted: state.proofCounts[userId] || 0,
      apiTokensEarned: balance * julToTokens(),
    }))
    .sort((a, b) => b.julBalance - a.julBalance)
    .slice(0, limit);

  return {
    leaderboard: entries,
    totalMiners: Object.keys(state.balances).length,
    totalProofs: state.totalProofs,
    difficulty: state.difficulty,
    epoch: state.epoch,
  };
}

// ============ Persistence ============

function validateMiningState(loaded) {
  if (!loaded || typeof loaded !== 'object') return false;
  if (loaded.epoch !== undefined && (typeof loaded.epoch !== 'number' || loaded.epoch < 0)) return false;
  if (loaded.difficulty !== undefined && (typeof loaded.difficulty !== 'number' || loaded.difficulty < 1)) return false;
  if (loaded.totalProofs !== undefined && (typeof loaded.totalProofs !== 'number' || loaded.totalProofs < 0)) return false;
  if (loaded.balances && typeof loaded.balances !== 'object') return false;
  // Check for corrupted negative balances
  if (loaded.balances) {
    for (const [userId, balance] of Object.entries(loaded.balances)) {
      if (typeof balance !== 'number' || balance < 0) return false;
    }
  }
  return true;
}

export async function initMining() {
  try {
    const raw = await readFile(STATE_FILE, 'utf-8');
    const loaded = JSON.parse(raw);
    if (!validateMiningState(loaded)) {
      console.warn('[mining] State file failed validation — using default state');
      rotateChallenge();
    } else {
      state = { ...state, ...loaded };
      // Restore replay set from serialized array
      replaySet = new Set(state.replaySet || []);
      console.log(`[mining] State loaded — epoch ${state.epoch}, difficulty ${state.difficulty}, ${state.totalProofs} total proofs, ${Object.keys(state.balances).length} miners`);
    }
  } catch {
    console.log('[mining] No existing state — starting fresh');
    rotateChallenge();
  }

  // Auto-save timer
  saveTimer = setInterval(() => {
    if (dirty) flushMining().catch(err => console.error(`[mining] Auto-save failed: ${err.message}`));
  }, AUTO_SAVE_INTERVAL);

  // Rate limit cleanup (every 5 min — mirrors web-api pattern)
  setInterval(() => {
    const now = Date.now();
    for (const [userId, bucket] of rateLimits) {
      const recent = bucket.filter(t => now - t < 60_000);
      if (recent.length === 0) rateLimits.delete(userId);
      else rateLimits.set(userId, recent);
    }
  }, 5 * 60_000);

  ensureChallenge();
  console.log(`[mining] Mining engine initialized — difficulty ${state.difficulty}, challenge ${state.challenge.slice(0, 16)}...`);
}

export async function flushMining() {
  if (!dirty) return;
  try {
    // Serialize replay set as array for JSON
    state.replaySet = [...replaySet];
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    dirty = false;
  } catch (err) {
    console.error(`[mining] Failed to save state: ${err.message}`);
  }
}

// ============ Self-Test ============

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` ||
    process.argv[1]?.endsWith('mining.js')) {
  console.log('=== Mining Module Self-Test ===');

  // Test 1: countLeadingZeroBits
  const tests = [
    { input: Buffer.from('0000ffff', 'hex'), expected: 16 },
    { input: Buffer.from('00000001', 'hex'), expected: 31 },
    { input: Buffer.from('80000000', 'hex'), expected: 0 },
    { input: Buffer.from('01000000', 'hex'), expected: 7 },
    { input: Buffer.alloc(32, 0), expected: 255 },
    { input: Buffer.from('0080' + '00'.repeat(30), 'hex'), expected: 8 },
  ];

  let passed = 0;
  for (const t of tests) {
    const result = countLeadingZeroBits(t.input);
    const ok = result === t.expected;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}: clzBits(${t.input.toString('hex').slice(0, 16)}...) = ${result} (expected ${t.expected})`);
    if (ok) passed++;
  }

  // Test 2: Mine a real proof
  console.log('\n  Mining a test proof (difficulty 8)...');
  const challenge = randomBytes(32).toString('hex');
  let nonce, hash, attempts = 0;
  while (true) {
    const n = randomBytes(32);
    const h = createHash('sha256')
      .update(Buffer.from(challenge, 'hex'))
      .update(n)
      .digest();
    attempts++;
    if (countLeadingZeroBits(h) >= 8) {
      nonce = n.toString('hex');
      hash = h.toString('hex');
      break;
    }
  }
  console.log(`  Found proof in ${attempts} attempts: ${hash.slice(0, 16)}...`);

  // Test 3: Verify the proof
  const vResult = verifyProof(challenge, nonce, hash, 8);
  console.log(`  Verify: ${vResult.valid ? 'PASS' : 'FAIL'} (${vResult.zeroBits} bits)`);
  if (vResult.valid) passed++;

  // Test 4: Verify bad proof rejected
  const badResult = verifyProof(challenge, nonce, hash, 200);
  console.log(`  Reject high difficulty: ${!badResult.valid ? 'PASS' : 'FAIL'}`);
  if (!badResult.valid) passed++;

  console.log(`\n=== ${passed}/${tests.length + 2} tests passed ===`);
}
