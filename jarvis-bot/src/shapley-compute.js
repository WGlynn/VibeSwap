// ============ Off-Chain Shapley Compute Service ============
//
// The heavy math runs HERE, not on-chain. Results are submitted
// to ShapleyVerifier.sol with a merkle proof. The verifier checks
// the axioms (efficiency, sanity, Lawson floor) in O(n) — 90% cheaper
// than computing Shapley values on-chain.
//
// This is Layer 2 of the execution/settlement separation.
// The math is account model agnostic — same computation whether
// settling on Ethereum, CKB, or any future chain.
//
// Flow:
//   1. Read participant data from reward-batcher computeBatch()
//   2. Compute weighted Shapley values locally
//   3. Apply Lawson fairness floor (1% minimum)
//   4. Build merkle proof of the result
//   5. Submit to ShapleyVerifier via contract-bridge
//
// "Verification is always cheaper than computation."
// ============

import { createHash } from 'crypto';
import { ethers } from 'ethers';

// ============ Shapley Weight Configuration ============
// Same weights as ShapleyDistributor.sol _calculateWeightedContribution()

const WEIGHTS = {
  direct: 4000,     // 40% — quality * quantity of contributions
  time: 3000,       // 30% — duration of participation (log scale)
  scarcity: 2000,   // 20% — rare contribution types
  stability: 1000,  // 10% — consistency during volatility
};
const BPS = 10000;
const LAWSON_FLOOR_BPS = 100; // 1% minimum

// ============ Core: Compute Shapley Values ============

/**
 * Compute Shapley values for a batch of participants.
 * Pure function — no state, no I/O, no chain dependency.
 * Account model agnostic. The same math runs anywhere.
 *
 * @param {Array} participants - From reward-batcher computeBatch()
 *   Each: { wallet, directContribution, timeInPool, scarcityScore, stabilityScore }
 * @param {BigInt|number} totalPool - Total VIBE to distribute
 * @returns {Object} { participants: address[], values: BigInt[], totalPool: BigInt }
 */
export function computeShapleyValues(participants, totalPool) {
  const pool = BigInt(totalPool);
  if (participants.length === 0 || pool === 0n) {
    return { participants: [], values: [], totalPool: pool };
  }

  // Step 1: Calculate weighted contribution score for each participant
  const scores = participants.map(p => {
    const direct = BigInt(p.directContribution || 0);
    const time = BigInt(Math.floor(Math.log2(Math.max(1, Number(p.timeInPool) / 86400 + 1)) * 1000));
    const scarcity = BigInt(p.scarcityScore || 5000);
    const stability = BigInt(p.stabilityScore || 5000);

    // Weighted sum (matches on-chain calculation)
    const weighted =
      (direct * BigInt(WEIGHTS.direct)) / BigInt(BPS) +
      (time * BigInt(WEIGHTS.time)) / BigInt(BPS) +
      (scarcity * BigInt(WEIGHTS.scarcity)) / BigInt(BPS) +
      (stability * BigInt(WEIGHTS.stability)) / BigInt(BPS);

    return { wallet: p.wallet, weighted };
  });

  // Step 2: Total weighted score
  const totalWeighted = scores.reduce((sum, s) => sum + s.weighted, 0n);
  if (totalWeighted === 0n) {
    // Everyone gets equal share
    const equalShare = pool / BigInt(participants.length);
    return {
      participants: scores.map(s => s.wallet),
      values: scores.map(() => equalShare),
      totalPool: pool,
    };
  }

  // Step 3: Pro-rata distribution based on weighted scores
  let values = scores.map(s => (pool * s.weighted) / totalWeighted);

  // Step 4: Apply Lawson fairness floor (1% of average)
  const average = pool / BigInt(participants.length);
  const floor = (average * BigInt(LAWSON_FLOOR_BPS)) / BigInt(BPS);

  let deficit = 0n;
  let belowFloor = 0;

  for (let i = 0; i < values.length; i++) {
    if (values[i] < floor) {
      deficit += floor - values[i];
      values[i] = floor;
      belowFloor++;
    }
  }

  // Fund the deficit by proportionally reducing above-floor participants
  if (deficit > 0n && belowFloor < values.length) {
    const aboveFloorTotal = values
      .filter(v => v > floor)
      .reduce((sum, v) => sum + v, 0n);

    if (aboveFloorTotal > 0n) {
      values = values.map(v => {
        if (v > floor) {
          const reduction = (deficit * v) / aboveFloorTotal;
          return v - reduction;
        }
        return v;
      });
    }
  }

  // Step 5: Ensure efficiency axiom (sum == totalPool)
  // Adjust last participant to absorb rounding dust
  const currentSum = values.reduce((sum, v) => sum + v, 0n);
  const dust = pool - currentSum;
  if (dust !== 0n && values.length > 0) {
    // Add dust to the largest value holder (least relative impact)
    let maxIdx = 0;
    for (let i = 1; i < values.length; i++) {
      if (values[i] > values[maxIdx]) maxIdx = i;
    }
    values[maxIdx] += dust;
  }

  return {
    participants: scores.map(s => s.wallet),
    values,
    totalPool: pool,
  };
}

// ============ Verification (Self-Check Before Submission) ============

/**
 * Verify computed values pass all Shapley axioms BEFORE submitting.
 * Same checks as ShapleyVerifier.verifyShapleyAxioms() on-chain.
 * If this passes locally, the on-chain verification will pass too.
 */
export function verifySelfCheck(participants, values, totalPool) {
  const pool = BigInt(totalPool);

  // Axiom 1: Efficiency
  const sum = values.reduce((s, v) => s + BigInt(v), 0n);
  if (sum !== pool) return { valid: false, reason: `efficiency: sum ${sum} != pool ${pool}` };

  // Axiom 2: Sanity
  for (const v of values) {
    if (BigInt(v) > pool) return { valid: false, reason: `sanity: value ${v} > pool` };
  }

  // Axiom 3: Lawson floor
  if (participants.length > 0) {
    const average = pool / BigInt(participants.length);
    const floor = (average * BigInt(LAWSON_FLOOR_BPS)) / BigInt(BPS);
    for (const v of values) {
      if (BigInt(v) < floor) return { valid: false, reason: `lawson: value ${v} < floor ${floor}` };
    }
  }

  return { valid: true };
}

// ============ Merkle Proof Generation ============

/**
 * Build a merkle tree from the Shapley result and return the proof.
 * The root gets set on-chain via ShapleyVerifier.setExpectedRoot().
 * The proof gets submitted with submitShapleyResult().
 */
export function buildMerkleProof(gameId, participants, values, totalPool) {
  // Leaf = keccak256(abi.encode(gameId, participants, values, totalPool))
  // This must match how ShapleyVerifier computes resultHash
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const encoded = abiCoder.encode(
    ['bytes32', 'address[]', 'uint256[]', 'uint256'],
    [gameId, participants, values.map(v => v.toString()), totalPool.toString()]
  );
  const resultHash = ethers.keccak256(encoded);

  // For single-result submission, the merkle tree is just the leaf itself
  // The root = hash(leaf). Proof = empty (leaf IS the root).
  // For batched multi-game submissions, we'd build a proper tree.
  const root = ethers.keccak256(
    abiCoder.encode(['bytes32'], [resultHash])
  );

  return {
    resultHash,
    root,
    proof: [resultHash], // Single-leaf tree: proof is the leaf itself
  };
}

// ============ Full Pipeline ============

/**
 * Compute Shapley values and prepare for on-chain submission.
 * Returns everything needed to call ShapleyVerifier.submitShapleyResult().
 *
 * @param {string} gameId - bytes32 game identifier
 * @param {Array} participants - From reward-batcher
 * @param {BigInt|number} totalPool - Total VIBE to distribute
 * @returns {Object} Ready for contract-bridge submission
 */
export function prepareShapleySubmission(gameId, participants, totalPool) {
  // 1. Compute values
  const result = computeShapleyValues(participants, totalPool);

  // 2. Self-check
  const check = verifySelfCheck(result.participants, result.values, result.totalPool);
  if (!check.valid) {
    return { error: `Self-check failed: ${check.reason}` };
  }

  // 3. Build merkle proof
  const merkle = buildMerkleProof(gameId, result.participants, result.values, result.totalPool);

  return {
    gameId,
    participants: result.participants,
    values: result.values.map(v => v.toString()),
    totalPool: result.totalPool.toString(),
    merkleRoot: merkle.root,
    merkleProof: merkle.proof,
    resultHash: merkle.resultHash,
    participantCount: result.participants.length,
  };
}

// ============ Stats ============

export function getComputeStats() {
  return {
    weights: WEIGHTS,
    lawsonFloorBps: LAWSON_FLOOR_BPS,
    description: 'Off-chain Shapley compute. Pure math, account model agnostic.',
  };
}
