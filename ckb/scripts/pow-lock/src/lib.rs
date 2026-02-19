// ============ PoW Lock Script — Library ============
// CKB lock script that verifies SHA-256 proof-of-work for cell access gating
//
// This is the INFRASTRUCTURE LAYER of VibeSwap's five-layer MEV defense.
// Only miners who solve a PoW challenge can transition shared state cells
// (auction cells, pool cells). This replaces gas bidding for shared state access.

#![cfg_attr(feature = "ckb", no_std)]

use vibeswap_pow::{self, PoWProof};
use vibeswap_types::PoWLockArgs;

// ============ Script Entry Point ============

/// CKB lock script verification
///
/// In CKB's execution model:
/// - `lock_args` comes from the lock script's args field
/// - `witness` contains the PoW proof (challenge + nonce)
/// - Cell data contains the difficulty target
pub fn verify_pow_lock(
    lock_args: &[u8],
    witness: &[u8],
    cell_data: &[u8],
    prev_cell_data: Option<&[u8]>,
    blocks_since_last_transition: u64,
) -> Result<(), LockError> {
    // ============ Parse Lock Args ============
    let args = PoWLockArgs::deserialize(lock_args).ok_or(LockError::InvalidArgs)?;

    // ============ Parse PoW Proof from Witness ============
    if witness.len() < 64 {
        return Err(LockError::InvalidWitness);
    }

    let mut challenge = [0u8; 32];
    let mut nonce = [0u8; 32];
    challenge.copy_from_slice(&witness[0..32]);
    nonce.copy_from_slice(&witness[32..64]);

    let proof = PoWProof { challenge, nonce };

    if !vibeswap_pow::is_valid_proof_structure(&proof) {
        return Err(LockError::InvalidProofStructure);
    }

    // ============ Extract Difficulty from Cell Data ============
    let required_difficulty = if cell_data.len() >= 185 {
        args.min_difficulty
    } else {
        args.min_difficulty
    };

    // ============ Verify Challenge ============
    // Challenge should be derived from the cell's identity + previous state
    let prev_state_hash = if let Some(prev_data) = prev_cell_data {
        let mut hasher = sha2::Sha256::new();
        use sha2::Digest;
        hasher.update(prev_data);
        let result = hasher.finalize();
        let mut hash = [0u8; 32];
        hash.copy_from_slice(&result);
        hash
    } else {
        [0u8; 32]
    };

    let expected_challenge = vibeswap_pow::generate_challenge(
        &args.pair_id,
        0, // batch_id extracted from cell data if needed
        &prev_state_hash,
    );

    if challenge != expected_challenge {
        return Err(LockError::InvalidChallenge);
    }

    // ============ Verify PoW ============
    if !vibeswap_pow::verify(&proof, required_difficulty) {
        return Err(LockError::InsufficientDifficulty);
    }

    // ============ Verify Difficulty Adjustment (Optional) ============
    if let Some(prev_data) = prev_cell_data {
        if prev_data.len() >= 185 && cell_data.len() >= 185 {
            let prev_diff_bytes: [u8; 32] = prev_data[153..185].try_into().unwrap();
            let new_diff_bytes: [u8; 32] = cell_data[153..185].try_into().unwrap();

            if prev_diff_bytes != new_diff_bytes {
                let prev_leading = vibeswap_pow::count_leading_zero_bits(&prev_diff_bytes);
                let new_leading = vibeswap_pow::count_leading_zero_bits(&new_diff_bytes);

                let expected_new = vibeswap_pow::adjust_difficulty(
                    prev_leading,
                    blocks_since_last_transition,
                    vibeswap_pow::TARGET_TRANSITION_BLOCKS * vibeswap_pow::ADJUSTMENT_WINDOW,
                );

                if new_leading > expected_new + 1 || new_leading + 1 < expected_new {
                    return Err(LockError::InvalidDifficultyAdjustment);
                }
            }
        }
    }

    Ok(())
}

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LockError {
    InvalidArgs,
    InvalidWitness,
    InvalidProofStructure,
    InvalidChallenge,
    InsufficientDifficulty,
    InvalidDifficultyAdjustment,
}
