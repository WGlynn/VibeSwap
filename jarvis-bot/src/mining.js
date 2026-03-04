// ============ Mining Module — PoW Verification + JUL Emission ============
//
// Server-side SHA-256 PoW verification engine for Jarvis shard miners.
// Ports bit-counting logic from ckb/lib/pow/src/lib.rs for compatibility.
//
// JUL tokens are mined via SHA-256(challenge || nonce) with leading-zero-bit
// difficulty. Mining JUL earns compute credits (1 JUL = 1000 API tokens)
// and increases Shapley weight via creditFact() / markIdentified().
//
// State persists to data/mining-state.json, auto-saved every 60s.
// ============

import { createHash, randomBytes } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { creditFact, markIdentified } from './compute-economics.js';

// ============ Constants ============

const BASE_DIFFICULTY = 8;        // 8 leading zero bits (~256 hashes)
const INITIAL_DIFFICULTY = 12;    // ~4096 hashes (~4 seconds on phone)
const MAX_DIFFICULTY = 32;        // ~4B hashes (cap for mobile)
const EPOCH_LENGTH = 100;         // proofs per difficulty adjustment
const TARGET_EPOCH_DURATION = 3600; // seconds (1 hour)
const BASE_REWARD = 1.0;          // JUL per proof at base difficulty
const REWARD_SCALE_PER_BIT = 2.0; // doubles per bit above base
const CHALLENGE_ROTATION = 300;   // new challenge every 5 min
const MAX_PROOFS_PER_MINUTE = 5;  // rate limit per user
const JUL_PER_API_TOKEN = 1000;   // 1 JUL = 1000 API tokens
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
  },
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

// ============ Reward Calculation ============

function calculateReward(difficulty) {
  const bitsAboveBase = Math.max(0, difficulty - BASE_DIFFICULTY);
  return BASE_REWARD * Math.pow(REWARD_SCALE_PER_BIT, bitsAboveBase);
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
    apiTokensEarned: reward * JUL_PER_API_TOKEN,
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
    apiTokensEarned: (state.balances[userId] || 0) * JUL_PER_API_TOKEN,
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
    poolExpansion: amount * JUL_PER_API_TOKEN,
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

  // Keep tips array bounded (last 1000)
  if (state.treasury.tips.length > 1000) {
    state.treasury.tips = state.treasury.tips.slice(-1000);
  }

  dirty = true;
  return result;
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
    dailyPoolExpansion: state.treasury.dailyBurned * JUL_PER_API_TOKEN,
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

// ============ Leaderboard ============

export function getLeaderboard(limit = 10) {
  const entries = Object.entries(state.balances)
    .map(([userId, balance]) => ({
      userId,
      julBalance: balance,
      proofsSubmitted: state.proofCounts[userId] || 0,
      apiTokensEarned: balance * JUL_PER_API_TOKEN,
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

export async function initMining() {
  try {
    const raw = await readFile(STATE_FILE, 'utf-8');
    const loaded = JSON.parse(raw);
    state = { ...state, ...loaded };
    // Restore replay set from serialized array
    replaySet = new Set(state.replaySet || []);
    console.log(`[mining] State loaded — epoch ${state.epoch}, difficulty ${state.difficulty}, ${state.totalProofs} total proofs, ${Object.keys(state.balances).length} miners`);
  } catch {
    console.log('[mining] No existing state — starting fresh');
    rotateChallenge();
  }

  // Auto-save timer
  saveTimer = setInterval(() => {
    if (dirty) flushMining();
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
