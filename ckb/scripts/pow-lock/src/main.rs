// ============ PoW Lock Script ============
// CKB lock script that verifies SHA-256 proof-of-work for cell access gating
//
// This is the INFRASTRUCTURE LAYER of VibeSwap's five-layer MEV defense.
// Only miners who solve a PoW challenge can transition shared state cells
// (auction cells, pool cells). This replaces gas bidding for shared state access.
//
// Lock script logic:
// 1. Extract PoW proof from witness
// 2. Extract difficulty target from cell data
// 3. Compute challenge from cell's type args + previous state
// 4. Verify SHA-256(challenge || nonce) has enough leading zero bits
// 5. Verify difficulty adjustment is correct (if applicable)
//
// On CKB, this compiles to RISC-V and runs in CKB-VM.
// For development, we use std; for deployment, switch to no_std + ckb-std.

// When targeting CKB-VM (RISC-V), uncomment:
// #![no_std]
// #![no_main]

use vibeswap_pow::{self, PoWProof};
use vibeswap_types::PoWLockArgs;

// ============ Script Entry Point ============

/// CKB lock script entry point
/// Called when a cell with this lock script is consumed in a transaction
///
/// In CKB's execution model:
/// - `args` comes from the lock script's args field
/// - `witness` contains the PoW proof (challenge + nonce)
/// - Cell data contains the difficulty target
///
/// For now, this is a library function. On CKB-VM, it would be the main() entry.
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
    // The difficulty target is stored in the cell data at a known offset
    // For AuctionCell: offset 153 (after phase through fillable_volume)
    // For PoolCell: difficulty is in lock args
    let required_difficulty = if cell_data.len() >= 185 {
        // AuctionCell: difficulty target is at offset 153, 32 bytes
        // But we use min_difficulty from lock args as the floor
        args.min_difficulty
    } else {
        args.min_difficulty
    };

    // ============ Verify Challenge ============
    // Challenge should be derived from the cell's identity + previous state
    // This prevents proof reuse across different cells or state transitions
    let prev_state_hash = if let Some(prev_data) = prev_cell_data {
        // Hash the previous cell data as the state reference
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
    // If this is a state transition with a new difficulty, verify the adjustment
    if let Some(prev_data) = prev_cell_data {
        if prev_data.len() >= 185 && cell_data.len() >= 185 {
            // Extract previous and new difficulty targets
            let prev_diff_bytes: [u8; 32] = prev_data[153..185].try_into().unwrap();
            let new_diff_bytes: [u8; 32] = cell_data[153..185].try_into().unwrap();

            // If difficulty changed, verify adjustment is within bounds
            if prev_diff_bytes != new_diff_bytes {
                let prev_leading = vibeswap_pow::count_leading_zero_bits(&prev_diff_bytes);
                let new_leading = vibeswap_pow::count_leading_zero_bits(&new_diff_bytes);

                let expected_new = vibeswap_pow::adjust_difficulty(
                    prev_leading,
                    blocks_since_last_transition,
                    vibeswap_pow::TARGET_TRANSITION_BLOCKS * vibeswap_pow::ADJUSTMENT_WINDOW,
                );

                // Allow +/- 1 bit tolerance for rounding
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

// ============ CKB-VM Entry Point ============
// When compiled for RISC-V, this would be the actual entry point:
//
// #[no_mangle]
// pub extern "C" fn main() -> i8 {
//     // Load script args, witness, cell data from CKB syscalls
//     let script = ckb_std::high_level::load_script().unwrap();
//     let lock_args = script.args().raw_data();
//     let witness = ckb_std::high_level::load_witness(0, Source::GroupInput).unwrap();
//     let cell_data = ckb_std::high_level::load_cell_data(0, Source::GroupInput).unwrap();
//
//     match verify_pow_lock(&lock_args, &witness, &cell_data, None, 0) {
//         Ok(()) => 0,
//         Err(_) => -1,
//     }
// }

fn main() {
    // Placeholder for non-CKB-VM compilation
    // In production, this would be the CKB-VM entry point above
    println!("PoW Lock Script — compile with RISC-V target for CKB-VM");
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;
    use vibeswap_pow::mine;

    fn make_lock_args(pair_id: [u8; 32], min_diff: u8) -> Vec<u8> {
        let args = PoWLockArgs {
            pair_id,
            min_difficulty: min_diff,
        };
        args.serialize().to_vec()
    }

    #[test]
    fn test_valid_pow_verification() {
        let pair_id = [0x42; 32];
        let prev_state = [0u8; 32];
        let challenge = vibeswap_pow::generate_challenge(&pair_id, 0, &prev_state);

        // Mine a valid nonce
        let nonce = mine(&challenge, 4, 100_000).expect("Should find nonce at diff 4");

        let mut witness = Vec::new();
        witness.extend_from_slice(&challenge);
        witness.extend_from_slice(&nonce);

        let lock_args = make_lock_args(pair_id, 4);
        let cell_data = vec![0u8; 32]; // Minimal cell data

        let result = verify_pow_lock(&lock_args, &witness, &cell_data, None, 0);
        assert!(result.is_ok());
    }

    #[test]
    fn test_insufficient_difficulty() {
        let pair_id = [0x42; 32];
        let prev_state = [0u8; 32];
        let challenge = vibeswap_pow::generate_challenge(&pair_id, 0, &prev_state);

        // Use a nonce that definitely won't meet difficulty 200
        let nonce = [0xFF; 32]; // Will produce non-zero leading bits

        let mut witness = Vec::new();
        witness.extend_from_slice(&challenge);
        witness.extend_from_slice(&nonce);

        let lock_args = make_lock_args(pair_id, 200);
        let cell_data = vec![0u8; 32];

        let result = verify_pow_lock(&lock_args, &witness, &cell_data, None, 0);
        assert_eq!(result, Err(LockError::InsufficientDifficulty));
    }

    #[test]
    fn test_invalid_challenge() {
        let pair_id = [0x42; 32];
        let wrong_challenge = [0x01; 32]; // Not derived from pair_id

        let mut witness = Vec::new();
        witness.extend_from_slice(&wrong_challenge);
        witness.extend_from_slice(&[0x02; 32]);

        let lock_args = make_lock_args(pair_id, 1);
        let cell_data = vec![0u8; 32];

        let result = verify_pow_lock(&lock_args, &witness, &cell_data, None, 0);
        assert_eq!(result, Err(LockError::InvalidChallenge));
    }

    #[test]
    fn test_invalid_witness_too_short() {
        let lock_args = make_lock_args([0x42; 32], 4);
        let witness = vec![0u8; 10]; // Too short
        let cell_data = vec![0u8; 32];

        let result = verify_pow_lock(&lock_args, &witness, &cell_data, None, 0);
        assert_eq!(result, Err(LockError::InvalidWitness));
    }

    #[test]
    fn test_invalid_args() {
        let lock_args = vec![0u8; 5]; // Too short for PoWLockArgs
        let witness = vec![0u8; 64];
        let cell_data = vec![0u8; 32];

        let result = verify_pow_lock(&lock_args, &witness, &cell_data, None, 0);
        assert_eq!(result, Err(LockError::InvalidArgs));
    }
}
