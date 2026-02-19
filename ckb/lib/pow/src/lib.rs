// ============ VibeSwap PoW Library ============
// SHA-256 proof-of-work verification for CKB cell access gating
// Port of ProofOfWorkLib.sol — Bitcoin-compatible SHA-256 PoW
//
// On CKB, PoW serves as the cell contention resolution mechanism:
// - Miners must find a nonce that produces a SHA-256 hash with N leading zero bits
// - This replaces gas bidding for shared state access
// - Difficulty adjusts based on state transition frequency
// - Bitcoin SHA-256 hardware can participate

#![cfg_attr(feature = "no_std", no_std)]

#[cfg(feature = "no_std")]
extern crate alloc;

use sha2::{Digest, Sha256};

// ============ Constants ============

/// Base difficulty for value calculations (8 bits = 256 hashes avg)
pub const BASE_DIFFICULTY: u8 = 8;

/// Maximum difficulty to prevent overflow
pub const MAX_DIFFICULTY: u8 = 255;

/// Base difficulty for fee discount calculations
pub const FEE_DISCOUNT_BASE_DIFFICULTY: u8 = 12;

/// Basis points per difficulty bit above base for fee discount
pub const FEE_DISCOUNT_SCALE: u64 = 500;

/// Target time between state transitions (in blocks)
/// Used for difficulty adjustment
pub const TARGET_TRANSITION_BLOCKS: u64 = 5; // ~1 second at CKB block time

/// Difficulty adjustment window (number of transitions to consider)
pub const ADJUSTMENT_WINDOW: u64 = 10;

/// Maximum difficulty adjustment per epoch (4x up, 1/4 down)
pub const MAX_ADJUSTMENT_FACTOR: u64 = 4;

// ============ PoW Proof ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoWProof {
    pub challenge: [u8; 32],
    pub nonce: [u8; 32],
}

// ============ Verification ============

/// Verify a SHA-256 proof-of-work meets the claimed difficulty
/// Returns true if hash(challenge || nonce) has >= `difficulty` leading zero bits
pub fn verify(proof: &PoWProof, difficulty: u8) -> bool {
    let hash = compute_hash(&proof.challenge, &proof.nonce);
    let actual_difficulty = count_leading_zero_bits(&hash);
    actual_difficulty >= difficulty
}

/// Verify and return the actual difficulty achieved
pub fn verify_and_get_difficulty(proof: &PoWProof) -> u8 {
    let hash = compute_hash(&proof.challenge, &proof.nonce);
    count_leading_zero_bits(&hash)
}

/// Compute SHA-256(challenge || nonce)
pub fn compute_hash(challenge: &[u8; 32], nonce: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(challenge);
    hasher.update(nonce);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

/// Count leading zero bits in a 256-bit hash (0-255)
/// Gas-optimized binary search approach (ported from Solidity)
pub fn count_leading_zero_bits(hash: &[u8; 32]) -> u8 {
    // Check byte-by-byte first (fast path)
    let mut zero_bytes = 0u8;
    for &byte in hash.iter() {
        if byte == 0 {
            zero_bytes += 1;
        } else {
            // Count leading zeros in this byte
            return zero_bytes * 8 + byte.leading_zeros() as u8;
        }
    }

    // All bytes are zero
    255 // Max u8, represents 256 leading zeros
}

// ============ Difficulty Adjustment ============

/// Adjust difficulty based on actual vs target transition time
/// prev_difficulty: current difficulty target
/// actual_blocks: blocks between last N transitions
/// target_blocks: expected blocks between last N transitions
pub fn adjust_difficulty(
    prev_difficulty: u8,
    actual_blocks: u64,
    target_blocks: u64,
) -> u8 {
    if actual_blocks == 0 {
        // Transitions happening too fast, increase difficulty
        return prev_difficulty.saturating_add(1).min(MAX_DIFFICULTY);
    }

    // ratio = target / actual
    // If actual > target (too slow), decrease difficulty
    // If actual < target (too fast), increase difficulty
    let ratio_x1000 = (target_blocks * 1000) / actual_blocks;

    // Clamp ratio to prevent extreme adjustments
    let clamped_ratio = ratio_x1000
        .max(1000 / MAX_ADJUSTMENT_FACTOR)
        .min(1000 * MAX_ADJUSTMENT_FACTOR);

    if clamped_ratio > 1000 {
        // Need to increase difficulty
        let bits_to_add = log2_approx(clamped_ratio / 1000);
        prev_difficulty.saturating_add(bits_to_add as u8).min(MAX_DIFFICULTY)
    } else if clamped_ratio < 1000 {
        // Need to decrease difficulty
        let bits_to_sub = log2_approx(1000 / clamped_ratio);
        prev_difficulty.saturating_sub(bits_to_sub as u8).max(1)
    } else {
        prev_difficulty
    }
}

/// Compute new difficulty target as a 256-bit value
/// difficulty_bits = number of leading zero bits required
/// Returns a 32-byte target where hash must be <= target
pub fn difficulty_to_target(difficulty_bits: u8) -> [u8; 32] {
    if difficulty_bits >= 255 {
        return [0u8; 32]; // Impossible difficulty
    }

    let mut target = [0xFFu8; 32];

    // Set the first `difficulty_bits` bits to 0
    let full_bytes = difficulty_bits / 8;
    let remaining_bits = difficulty_bits % 8;

    for i in 0..full_bytes as usize {
        target[i] = 0;
    }

    if (full_bytes as usize) < 32 {
        target[full_bytes as usize] = 0xFF >> remaining_bits;
    }

    target
}

/// Compare hash against difficulty target
/// Returns true if hash <= target (i.e., meets difficulty)
pub fn meets_target(hash: &[u8; 32], target: &[u8; 32]) -> bool {
    for i in 0..32 {
        if hash[i] < target[i] {
            return true;
        }
        if hash[i] > target[i] {
            return false;
        }
    }
    true // Equal
}

// ============ Challenge Generation ============

/// Generate a unique challenge for cell state transitions
/// Includes pair_id, batch_id, and previous state hash for uniqueness
pub fn generate_challenge(
    pair_id: &[u8; 32],
    batch_id: u64,
    prev_state_hash: &[u8; 32],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(pair_id);
    hasher.update(batch_id.to_le_bytes());
    hasher.update(prev_state_hash);
    let result = hasher.finalize();
    let mut challenge = [0u8; 32];
    challenge.copy_from_slice(&result);
    challenge
}

/// Generate challenge with block number for time-windowed expiry
pub fn generate_challenge_with_window(
    pair_id: &[u8; 32],
    batch_id: u64,
    prev_state_hash: &[u8; 32],
    block_number: u64,
    window_blocks: u64,
) -> [u8; 32] {
    let window = block_number / window_blocks;
    let mut hasher = Sha256::new();
    hasher.update(pair_id);
    hasher.update(batch_id.to_le_bytes());
    hasher.update(prev_state_hash);
    hasher.update(window.to_le_bytes());
    let result = hasher.finalize();
    let mut challenge = [0u8; 32];
    challenge.copy_from_slice(&result);
    challenge
}

// ============ Value Conversion ============

/// Convert difficulty to value (exponential scaling)
/// value = base_value * 2^(difficulty - BASE_DIFFICULTY)
pub fn difficulty_to_value(difficulty: u8, base_value: u64) -> u64 {
    if difficulty <= BASE_DIFFICULTY {
        return base_value;
    }

    let effective = difficulty.min(64);
    let shift = effective - BASE_DIFFICULTY;

    if shift >= 64 {
        return u64::MAX;
    }

    base_value.saturating_mul(1u64 << shift)
}

/// Convert difficulty to fee discount in basis points
pub fn difficulty_to_fee_discount(difficulty: u8, max_discount_bps: u64) -> u64 {
    if difficulty <= FEE_DISCOUNT_BASE_DIFFICULTY {
        return 0;
    }

    let bits_above_base = (difficulty - FEE_DISCOUNT_BASE_DIFFICULTY) as u64;
    let discount = bits_above_base * FEE_DISCOUNT_SCALE;

    discount.min(max_discount_bps)
}

/// Estimate expected hash attempts for a given difficulty
pub fn estimate_hashes(difficulty: u8) -> u64 {
    if difficulty == 0 {
        return 1;
    }
    if difficulty > 63 {
        return u64::MAX;
    }
    1u64 << difficulty
}

// ============ Utility ============

/// Compute unique proof hash for replay prevention
pub fn compute_proof_hash(challenge: &[u8; 32], nonce: &[u8; 32]) -> [u8; 32] {
    compute_hash(challenge, nonce)
}

/// Validate proof structure (non-zero fields)
pub fn is_valid_proof_structure(proof: &PoWProof) -> bool {
    proof.challenge != [0u8; 32] && proof.nonce != [0u8; 32]
}

/// Approximate log2 for small values (used in difficulty adjustment)
fn log2_approx(x: u64) -> u64 {
    if x <= 1 {
        return 0;
    }
    63 - x.leading_zeros() as u64
}

// ============ Mining (for SDK/testing) ============

/// Mine a nonce that meets the given difficulty
/// Returns the nonce if found within max_iterations
#[cfg(feature = "std")]
pub fn mine(challenge: &[u8; 32], difficulty: u8, max_iterations: u64) -> Option<[u8; 32]> {
    for i in 0..max_iterations {
        let mut nonce = [0u8; 32];
        nonce[0..8].copy_from_slice(&i.to_le_bytes());
        // Add some entropy from the iteration
        let mut hasher = Sha256::new();
        hasher.update(i.to_le_bytes());
        hasher.update(challenge);
        let result = hasher.finalize();
        nonce.copy_from_slice(&result);

        if verify(&PoWProof { challenge: *challenge, nonce }, difficulty) {
            return Some(nonce);
        }
    }
    None
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_count_leading_zeros() {
        let mut hash = [0u8; 32];
        assert_eq!(count_leading_zero_bits(&hash), 255); // All zeros

        hash[0] = 0x80; // 1000_0000 → 0 leading zeros
        assert_eq!(count_leading_zero_bits(&hash), 0);

        hash[0] = 0x01; // 0000_0001 → 7 leading zeros
        assert_eq!(count_leading_zero_bits(&hash), 7);

        hash[0] = 0x00;
        hash[1] = 0x01; // 8 zero bits + 7 = 15
        assert_eq!(count_leading_zero_bits(&hash), 15);

        hash[1] = 0x00;
        hash[2] = 0x80; // 16 zero bits + 0 = 16
        assert_eq!(count_leading_zero_bits(&hash), 16);
    }

    #[test]
    fn test_verify_basic() {
        let challenge = [0x42; 32];
        // Try many nonces until one works at low difficulty
        let nonce = mine(&challenge, 4, 10_000).expect("Should find nonce at difficulty 4");
        let proof = PoWProof { challenge, nonce };
        assert!(verify(&proof, 4));
    }

    #[test]
    fn test_verify_insufficient_difficulty() {
        let challenge = [0x42; 32];
        let nonce = mine(&challenge, 4, 10_000).expect("Should find nonce");
        let proof = PoWProof { challenge, nonce };
        let actual = verify_and_get_difficulty(&proof);
        // Should meet difficulty 4 but might not meet much higher
        assert!(actual >= 4);
    }

    #[test]
    fn test_difficulty_to_target() {
        let target = difficulty_to_target(8);
        assert_eq!(target[0], 0x00);
        assert_eq!(target[1], 0xFF);

        let target = difficulty_to_target(16);
        assert_eq!(target[0], 0x00);
        assert_eq!(target[1], 0x00);
        assert_eq!(target[2], 0xFF);

        let target = difficulty_to_target(0);
        assert_eq!(target[0], 0xFF);
    }

    #[test]
    fn test_meets_target() {
        let target = difficulty_to_target(8);
        let mut hash = [0u8; 32];
        hash[0] = 0x00;
        hash[1] = 0x01;
        assert!(meets_target(&hash, &target));

        hash[0] = 0x01;
        assert!(!meets_target(&hash, &target));
    }

    #[test]
    fn test_difficulty_adjustment_stable() {
        let diff = adjust_difficulty(16, 50, 50);
        assert_eq!(diff, 16); // No change when actual == target
    }

    #[test]
    fn test_difficulty_adjustment_too_fast() {
        let diff = adjust_difficulty(16, 10, 50);
        assert!(diff > 16); // Increase when transitions are too fast
    }

    #[test]
    fn test_difficulty_adjustment_too_slow() {
        let diff = adjust_difficulty(16, 200, 50);
        assert!(diff < 16); // Decrease when transitions are too slow
    }

    #[test]
    fn test_difficulty_to_value() {
        assert_eq!(difficulty_to_value(8, 100), 100);
        assert_eq!(difficulty_to_value(9, 100), 200);
        assert_eq!(difficulty_to_value(10, 100), 400);
        assert_eq!(difficulty_to_value(16, 100), 25600);
    }

    #[test]
    fn test_fee_discount() {
        assert_eq!(difficulty_to_fee_discount(10, 5000), 0);
        assert_eq!(difficulty_to_fee_discount(13, 5000), 500);
        assert_eq!(difficulty_to_fee_discount(14, 5000), 1000);
        assert_eq!(difficulty_to_fee_discount(22, 5000), 5000); // Capped
        assert_eq!(difficulty_to_fee_discount(30, 5000), 5000); // Still capped
    }

    #[test]
    fn test_challenge_generation() {
        let pair_id = [0x01; 32];
        let prev_hash = [0x02; 32];
        let c1 = generate_challenge(&pair_id, 1, &prev_hash);
        let c2 = generate_challenge(&pair_id, 1, &prev_hash);
        assert_eq!(c1, c2); // Deterministic

        let c3 = generate_challenge(&pair_id, 2, &prev_hash);
        assert_ne!(c1, c3); // Different batch = different challenge
    }

    #[test]
    fn test_proof_structure_validation() {
        let valid = PoWProof {
            challenge: [0x42; 32],
            nonce: [0x01; 32],
        };
        assert!(is_valid_proof_structure(&valid));

        let invalid = PoWProof {
            challenge: [0x00; 32],
            nonce: [0x01; 32],
        };
        assert!(!is_valid_proof_structure(&invalid));
    }

    #[test]
    fn test_estimate_hashes() {
        assert_eq!(estimate_hashes(0), 1);
        assert_eq!(estimate_hashes(1), 2);
        assert_eq!(estimate_hashes(8), 256);
        assert_eq!(estimate_hashes(16), 65536);
        assert_eq!(estimate_hashes(20), 1048576);
    }

    #[test]
    fn test_mine_low_difficulty() {
        let challenge = [0xAB; 32];
        let nonce = mine(&challenge, 8, 1_000_000);
        assert!(nonce.is_some(), "Should find nonce at difficulty 8 within 1M iterations");
        let proof = PoWProof {
            challenge,
            nonce: nonce.unwrap(),
        };
        assert!(verify(&proof, 8));
    }
}
