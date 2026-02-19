// ============ PoW Lock Script — CKB-VM Entry Point ============
// Lock script verifying SHA-256 proof-of-work for shared state cell access.
// Infrastructure layer of VibeSwap's five-layer MEV defense.

#![cfg_attr(feature = "ckb", no_std)]
#![cfg_attr(feature = "ckb", no_main)]

#[cfg(feature = "ckb")]
ckb_std::default_alloc!();

#[cfg(feature = "ckb")]
ckb_std::entry!(program);

// ============ CKB-VM Entry Point ============

#[cfg(feature = "ckb")]
fn program() -> i8 {
    use ckb_std::ckb_constants::Source;
    use ckb_std::high_level::{load_cell_data, load_script, load_witness_args};
    use pow_lock::verify_pow_lock;

    // Load lock script args (contains PoWLockArgs: pair_id + min_difficulty)
    let script = match load_script() {
        Ok(s) => s,
        Err(_) => return -1,
    };
    let lock_args: alloc::vec::Vec<u8> = script.args().raw_data().to_vec();

    // Load PoW proof from witness lock field
    let witness_args = match load_witness_args(0, Source::GroupInput) {
        Ok(w) => w,
        Err(_) => return -2,
    };
    let witness: alloc::vec::Vec<u8> = match witness_args.lock().to_opt() {
        Some(bytes) => bytes.raw_data().to_vec(),
        None => return -3,
    };

    // Load current cell data (the cell being consumed)
    let cell_data = match load_cell_data(0, Source::GroupInput) {
        Ok(d) => d,
        Err(_) => return -4,
    };

    // Try to load the corresponding output cell data for difficulty adjustment
    let output_data = load_cell_data(0, Source::GroupOutput).ok();

    // Verify PoW
    match verify_pow_lock(
        &lock_args,
        &witness,
        &cell_data,
        output_data.as_deref(),
        0, // blocks_since_last_transition — derived from header_deps in production
    ) {
        Ok(()) => 0,
        Err(_) => -5,
    }
}

// ============ Native Entry Point ============

#[cfg(not(feature = "ckb"))]
fn main() {
    println!("PoW Lock Script — compile with --features ckb for CKB-VM");
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use pow_lock::*;
    use vibeswap_pow::mine;
    use vibeswap_types::PoWLockArgs;

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

        let nonce = [0xFF; 32];

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
        let wrong_challenge = [0x01; 32];

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
        let witness = vec![0u8; 10];
        let cell_data = vec![0u8; 32];

        let result = verify_pow_lock(&lock_args, &witness, &cell_data, None, 0);
        assert_eq!(result, Err(LockError::InvalidWitness));
    }

    #[test]
    fn test_invalid_args() {
        let lock_args = vec![0u8; 5];
        let witness = vec![0u8; 64];
        let cell_data = vec![0u8; 32];

        let result = verify_pow_lock(&lock_args, &witness, &cell_data, None, 0);
        assert_eq!(result, Err(LockError::InvalidArgs));
    }
}
