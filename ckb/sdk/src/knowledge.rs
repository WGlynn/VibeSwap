// ============ Knowledge Cell Transaction Builders ============
// SDK functions for creating and updating PoW-gated knowledge cells
// used by Jarvis multi-instance sync.
//
// Knowledge cells store key-value pairs on CKB with:
// - PoW-gated write access (anyone can mine to update)
// - Header chain linking (SHA-256 prev_state_hash)
// - MMR accumulation (history of all states)
// - Monotonic counters (no rollbacks)

use sha2::{Digest, Sha256};
use vibeswap_types::*;
use vibeswap_pow::PoWProof;

// ============ Key Hash Generation ============

/// Compute key_hash = blake2b(namespace || ":" || key) for knowledge cell identity.
/// Uses SHA-256 since blake2b requires the blake2b-rs crate (C compiler dependency).
/// This is consistent across all Jarvis instances.
pub fn compute_key_hash(namespace: &str, key: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"vibeswap:knowledge:");
    hasher.update(namespace.as_bytes());
    hasher.update(b":");
    hasher.update(key.as_bytes());
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

/// Compute value_hash = SHA-256(value) for integrity verification
pub fn compute_value_hash(value: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(value);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

// ============ Transaction Builders ============

/// Build an unsigned transaction to create a new knowledge cell (genesis).
///
/// The cell is locked with pow-lock and typed with knowledge-type.
/// The initial state has update_count=0, empty prev_state_hash, empty MMR.
pub fn create_knowledge_cell(
    namespace: &str,
    key: &str,
    value: &[u8],
    author_lock_hash: [u8; 32],
    current_block: u64,
    deployment: &super::DeploymentInfo,
    user_input: super::CellInput,
) -> super::UnsignedTransaction {
    let key_hash = compute_key_hash(namespace, key);
    let value_hash = compute_value_hash(value);

    let cell_data = KnowledgeCellData {
        key_hash,
        value_hash,
        value_size: value.len() as u32,
        prev_state_hash: [0u8; 32], // Genesis
        mmr_root: [0u8; 32],        // Empty MMR
        update_count: 0,
        author_lock_hash,
        timestamp_block: current_block,
        difficulty: KNOWLEDGE_MIN_DIFFICULTY,
    };

    let serialized = cell_data.serialize();

    // Knowledge cell capacity: 181 bytes data + ~100 bytes for scripts
    // CKB minimum: 61 bytes (empty cell), 1 CKB = 10^8 shannons
    // Conservative: 300 CKB shannons (covers data + scripts)
    let capacity = 30_000_000_000u64; // 300 CKB

    // PoW lock args: use key_hash as the "pair_id" for challenge generation
    let lock_args = PoWLockArgs {
        pair_id: key_hash,
        min_difficulty: KNOWLEDGE_MIN_DIFFICULTY,
    };

    let output = super::CellOutput {
        capacity,
        lock_script: super::Script {
            code_hash: deployment.pow_lock_code_hash,
            hash_type: super::HashType::Data1,
            args: lock_args.serialize().to_vec(),
        },
        type_script: Some(super::Script {
            code_hash: deployment.knowledge_type_code_hash,
            hash_type: super::HashType::Data1,
            args: key_hash.to_vec(), // Type script args = key_hash for uniqueness
        }),
        data: serialized.to_vec(),
    };

    super::UnsignedTransaction {
        cell_deps: vec![super::CellDep {
            tx_hash: deployment.script_dep_tx_hash,
            index: deployment.script_dep_index,
            dep_type: super::DepType::DepGroup,
        }],
        inputs: vec![user_input],
        outputs: vec![output],
        witnesses: vec![vec![]], // Filled during signing
    }
}

/// Build an unsigned transaction to update an existing knowledge cell.
///
/// Requires a PoW proof that meets the cell's difficulty requirement.
/// Enforces header chain linking and MMR root update.
pub fn update_knowledge_cell(
    old_cell: &KnowledgeCellData,
    old_cell_outpoint: super::CellInput,
    new_value: &[u8],
    new_mmr_root: [u8; 32],
    author_lock_hash: [u8; 32],
    current_block: u64,
    pow_proof: &PoWProof,
    deployment: &super::DeploymentInfo,
) -> super::UnsignedTransaction {
    let old_bytes = old_cell.serialize();
    let prev_state_hash = sha256_data(&old_bytes);
    let value_hash = compute_value_hash(new_value);

    let new_cell = KnowledgeCellData {
        key_hash: old_cell.key_hash,
        value_hash,
        value_size: new_value.len() as u32,
        prev_state_hash,
        mmr_root: new_mmr_root,
        update_count: old_cell.update_count + 1,
        author_lock_hash,
        timestamp_block: current_block,
        difficulty: compute_new_difficulty(old_cell, current_block),
    };

    let serialized = new_cell.serialize();

    let lock_args = PoWLockArgs {
        pair_id: old_cell.key_hash,
        min_difficulty: KNOWLEDGE_MIN_DIFFICULTY,
    };

    let output = super::CellOutput {
        capacity: 30_000_000_000u64,
        lock_script: super::Script {
            code_hash: deployment.pow_lock_code_hash,
            hash_type: super::HashType::Data1,
            args: lock_args.serialize().to_vec(),
        },
        type_script: Some(super::Script {
            code_hash: deployment.knowledge_type_code_hash,
            hash_type: super::HashType::Data1,
            args: old_cell.key_hash.to_vec(),
        }),
        data: serialized.to_vec(),
    };

    // PoW proof in witness
    let mut pow_witness = Vec::with_capacity(64);
    pow_witness.extend_from_slice(&pow_proof.challenge);
    pow_witness.extend_from_slice(&pow_proof.nonce);

    super::UnsignedTransaction {
        cell_deps: vec![super::CellDep {
            tx_hash: deployment.script_dep_tx_hash,
            index: deployment.script_dep_index,
            dep_type: super::DepType::DepGroup,
        }],
        inputs: vec![old_cell_outpoint],
        outputs: vec![output],
        witnesses: vec![pow_witness],
    }
}

/// Mine a PoW proof for updating a knowledge cell
pub fn mine_for_knowledge_cell(
    old_cell: &KnowledgeCellData,
    max_iterations: u64,
) -> Option<PoWProof> {
    let old_bytes = old_cell.serialize();
    let prev_state_hash = sha256_data(&old_bytes);

    // Generate challenge using key_hash as pair_id
    let challenge = vibeswap_pow::generate_challenge(
        &old_cell.key_hash,
        old_cell.update_count + 1, // Next update's batch_id
        &prev_state_hash,
    );

    let nonce = vibeswap_pow::mine(&challenge, old_cell.difficulty, max_iterations)?;
    Some(PoWProof { challenge, nonce })
}

// ============ Helpers ============

fn sha256_data(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

/// Compute new difficulty based on time between updates.
/// If updates are faster than target, increase; if slower, decrease.
/// Clamped to ±1 of old difficulty per the type script rules.
fn compute_new_difficulty(old_cell: &KnowledgeCellData, current_block: u64) -> u8 {
    let blocks_elapsed = current_block.saturating_sub(old_cell.timestamp_block);
    let target_blocks = vibeswap_pow::TARGET_TRANSITION_BLOCKS * vibeswap_pow::ADJUSTMENT_WINDOW;

    let adjusted = vibeswap_pow::adjust_difficulty(old_cell.difficulty, blocks_elapsed, target_blocks);

    // Clamp to ±1 of current
    let clamped = if adjusted > old_cell.difficulty.saturating_add(KNOWLEDGE_MAX_DIFFICULTY_DELTA) {
        old_cell.difficulty.saturating_add(KNOWLEDGE_MAX_DIFFICULTY_DELTA)
    } else if adjusted < old_cell.difficulty.saturating_sub(KNOWLEDGE_MAX_DIFFICULTY_DELTA) {
        old_cell.difficulty.saturating_sub(KNOWLEDGE_MAX_DIFFICULTY_DELTA)
    } else {
        adjusted
    };

    clamped.max(KNOWLEDGE_MIN_DIFFICULTY)
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_key_hash_deterministic() {
        let h1 = compute_key_hash("jarvis", "session_state");
        let h2 = compute_key_hash("jarvis", "session_state");
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_compute_key_hash_different_keys() {
        let h1 = compute_key_hash("jarvis", "session_state");
        let h2 = compute_key_hash("jarvis", "preferences");
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_compute_key_hash_different_namespaces() {
        let h1 = compute_key_hash("jarvis", "config");
        let h2 = compute_key_hash("vibeswap", "config");
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_compute_value_hash() {
        let h = compute_value_hash(b"hello world");
        assert_ne!(h, [0u8; 32]);
        assert_eq!(h, compute_value_hash(b"hello world")); // Deterministic
    }

    #[test]
    fn test_create_knowledge_cell() {
        let deployment = test_deployment();
        let input = super::super::CellInput {
            tx_hash: [0x42; 32],
            index: 0,
            since: 0,
        };

        let tx = create_knowledge_cell(
            "jarvis",
            "session_state",
            b"some session data",
            [0xFF; 32],
            100,
            &deployment,
            input,
        );

        assert_eq!(tx.inputs.len(), 1);
        assert_eq!(tx.outputs.len(), 1);

        // Verify output cell data is valid genesis
        let cell_data = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(cell_data.update_count, 0);
        assert_eq!(cell_data.prev_state_hash, [0u8; 32]);
        assert_eq!(cell_data.mmr_root, [0u8; 32]);
        assert_eq!(cell_data.difficulty, KNOWLEDGE_MIN_DIFFICULTY);
        assert_eq!(cell_data.value_size, 17); // "some session data".len()
    }

    #[test]
    fn test_update_knowledge_cell() {
        let deployment = test_deployment();

        let old = KnowledgeCellData {
            key_hash: compute_key_hash("jarvis", "state"),
            value_hash: compute_value_hash(b"old value"),
            value_size: 9,
            prev_state_hash: [0u8; 32],
            mmr_root: [0u8; 32],
            update_count: 0,
            author_lock_hash: [0xFF; 32],
            timestamp_block: 100,
            difficulty: KNOWLEDGE_MIN_DIFFICULTY,
        };

        let proof = PoWProof {
            challenge: [0x11; 32],
            nonce: [0x22; 32],
        };

        let input = super::super::CellInput {
            tx_hash: [0x42; 32],
            index: 0,
            since: 0,
        };

        let tx = update_knowledge_cell(
            &old,
            input,
            b"new value",
            [0xAA; 32], // New MMR root
            [0xEE; 32], // Author
            150,
            &proof,
            &deployment,
        );

        assert_eq!(tx.inputs.len(), 1);
        assert_eq!(tx.outputs.len(), 1);
        assert_eq!(tx.witnesses[0].len(), 64); // PoW proof

        // Verify new cell data
        let new_data = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(new_data.key_hash, old.key_hash); // Same key
        assert_eq!(new_data.update_count, 1); // Incremented
        assert_ne!(new_data.prev_state_hash, [0u8; 32]); // Linked to old
        assert_eq!(new_data.value_size, 9); // "new value".len()
    }

    #[test]
    fn test_mine_for_knowledge_cell() {
        let cell = KnowledgeCellData {
            key_hash: compute_key_hash("jarvis", "test"),
            value_hash: compute_value_hash(b"test"),
            value_size: 4,
            prev_state_hash: [0u8; 32],
            mmr_root: [0u8; 32],
            update_count: 0,
            author_lock_hash: [0xFF; 32],
            timestamp_block: 100,
            difficulty: 4, // Low difficulty for fast test
        };

        let proof = mine_for_knowledge_cell(&cell, 100_000);
        assert!(proof.is_some());

        let proof = proof.unwrap();
        assert!(vibeswap_pow::verify(&proof, 4));
    }

    #[test]
    fn test_compute_new_difficulty_stable() {
        let cell = KnowledgeCellData {
            difficulty: 16,
            timestamp_block: 100,
            ..Default::default()
        };
        // Update at target interval
        let target_blocks = vibeswap_pow::TARGET_TRANSITION_BLOCKS * vibeswap_pow::ADJUSTMENT_WINDOW;
        let new_diff = compute_new_difficulty(&cell, 100 + target_blocks);
        assert_eq!(new_diff, 16); // No change
    }

    #[test]
    fn test_compute_new_difficulty_clamped() {
        let cell = KnowledgeCellData {
            difficulty: 16,
            timestamp_block: 100,
            ..Default::default()
        };
        // Very fast update (should want to increase a lot, but clamped to +1)
        let new_diff = compute_new_difficulty(&cell, 101);
        assert!(new_diff <= 17); // Clamped to +1
        assert!(new_diff >= 16);
    }

    // ============ Hash Edge Cases ============

    #[test]
    fn test_key_hash_empty_strings() {
        let h1 = compute_key_hash("", "");
        let h2 = compute_key_hash("", "key");
        let h3 = compute_key_hash("ns", "");

        // All produce valid 32-byte hashes, all distinct
        assert_ne!(h1, [0u8; 32]);
        assert_ne!(h1, h2);
        assert_ne!(h1, h3);
        assert_ne!(h2, h3);
    }

    #[test]
    fn test_key_hash_unicode() {
        let h1 = compute_key_hash("jarvis", "emoji_test_🔥");
        let h2 = compute_key_hash("jarvis", "emoji_test_🔥");
        assert_eq!(h1, h2); // Deterministic

        let h3 = compute_key_hash("jarvis", "emoji_test_🧊");
        assert_ne!(h1, h3); // Different emoji = different hash
    }

    #[test]
    fn test_key_hash_collision_resistance() {
        // Very similar inputs must produce different hashes
        let h1 = compute_key_hash("a", "b");
        let h2 = compute_key_hash("ab", "");
        let h3 = compute_key_hash("", "ab");
        let h4 = compute_key_hash("a:", "b"); // Contains separator char

        assert_ne!(h1, h2);
        assert_ne!(h1, h3);
        assert_ne!(h2, h3);
        assert_ne!(h1, h4);
    }

    #[test]
    fn test_value_hash_empty_data() {
        let h = compute_value_hash(b"");
        assert_ne!(h, [0u8; 32]); // Empty input still produces valid hash
        assert_eq!(h, compute_value_hash(b"")); // Deterministic
    }

    #[test]
    fn test_value_hash_different_inputs() {
        let h1 = compute_value_hash(b"hello");
        let h2 = compute_value_hash(b"hello!");
        let h3 = compute_value_hash(b"Hello");

        assert_ne!(h1, h2);
        assert_ne!(h1, h3);
        assert_ne!(h2, h3);
    }

    #[test]
    fn test_value_hash_large_data() {
        let large = vec![0xABu8; 1_000_000]; // 1MB
        let h = compute_value_hash(&large);
        assert_ne!(h, [0u8; 32]);
        assert_eq!(h, compute_value_hash(&large)); // Deterministic
    }

    // ============ Chain Linking Tests ============

    #[test]
    fn test_update_links_to_old_state() {
        let deployment = test_deployment();
        let old = KnowledgeCellData {
            key_hash: compute_key_hash("jarvis", "chain_test"),
            value_hash: compute_value_hash(b"v1"),
            value_size: 2,
            prev_state_hash: [0u8; 32],
            mmr_root: [0u8; 32],
            update_count: 0,
            author_lock_hash: [0xFF; 32],
            timestamp_block: 100,
            difficulty: KNOWLEDGE_MIN_DIFFICULTY,
        };

        // Compute expected prev_state_hash
        let old_bytes = old.serialize();
        let expected_hash = sha256_data(&old_bytes);

        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let tx = update_knowledge_cell(
            &old, input, b"v2", [0xAA; 32], [0xEE; 32], 200, &proof, &deployment,
        );

        let new_data = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(new_data.prev_state_hash, expected_hash,
            "prev_state_hash must be SHA-256 of old cell's serialized data");
    }

    #[test]
    fn test_sequential_updates_form_chain() {
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        // Genesis
        let mut current = KnowledgeCellData {
            key_hash: compute_key_hash("jarvis", "chain"),
            value_hash: compute_value_hash(b"v0"),
            value_size: 2,
            prev_state_hash: [0u8; 32],
            mmr_root: [0u8; 32],
            update_count: 0,
            author_lock_hash: [0xFF; 32],
            timestamp_block: 100,
            difficulty: KNOWLEDGE_MIN_DIFFICULTY,
        };

        // Chain 5 updates
        for i in 1..=5u64 {
            let value = format!("v{}", i);
            let tx = update_knowledge_cell(
                &current, input.clone(), value.as_bytes(),
                [i as u8; 32], [0xEE; 32], 100 + i * 50, &proof, &deployment,
            );

            let next = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();

            // Verify chain properties
            assert_eq!(next.update_count, i as u64);
            assert_eq!(next.key_hash, current.key_hash, "Key must never change");
            assert_ne!(next.prev_state_hash, [0u8; 32], "Must link to previous state");
            assert_eq!(next.prev_state_hash, sha256_data(&current.serialize()));

            current = next;
        }

        assert_eq!(current.update_count, 5);
    }

    // ============ Difficulty Tests ============

    #[test]
    fn test_difficulty_never_below_minimum() {
        let cell = KnowledgeCellData {
            difficulty: KNOWLEDGE_MIN_DIFFICULTY,
            timestamp_block: 100,
            ..Default::default()
        };

        // Very slow updates should decrease difficulty, but never below minimum
        let new_diff = compute_new_difficulty(&cell, 100 + 1_000_000);
        assert!(new_diff >= KNOWLEDGE_MIN_DIFFICULTY,
            "Difficulty {} below minimum {}", new_diff, KNOWLEDGE_MIN_DIFFICULTY);
    }

    #[test]
    fn test_difficulty_increase_on_fast_updates() {
        let cell = KnowledgeCellData {
            difficulty: 10,
            timestamp_block: 100,
            ..Default::default()
        };

        // Very fast update (1 block)
        let new_diff = compute_new_difficulty(&cell, 101);
        assert!(new_diff >= 10, "Fast updates should not decrease difficulty");
    }

    #[test]
    fn test_difficulty_decrease_on_slow_updates() {
        let cell = KnowledgeCellData {
            difficulty: 20,
            timestamp_block: 100,
            ..Default::default()
        };

        // Very slow update (millions of blocks)
        let new_diff = compute_new_difficulty(&cell, 100 + 10_000_000);
        assert!(new_diff <= 20, "Slow updates should not increase difficulty: got {}", new_diff);
    }

    #[test]
    fn test_difficulty_same_block_update() {
        let cell = KnowledgeCellData {
            difficulty: 16,
            timestamp_block: 100,
            ..Default::default()
        };

        // Same block — 0 elapsed
        let new_diff = compute_new_difficulty(&cell, 100);
        assert!(new_diff >= 16); // Should increase or stay same (too fast)
        assert!(new_diff <= 17); // Clamped to +1
    }

    // ============ Mining Tests ============

    #[test]
    fn test_mine_difficulty_zero_succeeds() {
        let cell = KnowledgeCellData {
            key_hash: compute_key_hash("test", "easy"),
            difficulty: 0,
            ..Default::default()
        };

        let proof = mine_for_knowledge_cell(&cell, 1);
        assert!(proof.is_some(), "Difficulty 0 should succeed immediately");
    }

    #[test]
    fn test_mine_high_difficulty_may_fail() {
        let cell = KnowledgeCellData {
            key_hash: compute_key_hash("test", "hard"),
            difficulty: 255,
            ..Default::default()
        };

        // 100 iterations at difficulty 255 should almost certainly fail
        let proof = mine_for_knowledge_cell(&cell, 100);
        assert!(proof.is_none(), "Difficulty 255 should not succeed in 100 tries");
    }

    #[test]
    fn test_mine_proof_verifies_at_cell_difficulty() {
        let cell = KnowledgeCellData {
            key_hash: compute_key_hash("test", "verify"),
            difficulty: 8,
            ..Default::default()
        };

        let proof = mine_for_knowledge_cell(&cell, 1_000_000);
        assert!(proof.is_some());
        let p = proof.unwrap();
        assert!(vibeswap_pow::verify(&p, cell.difficulty));
    }

    // ============ Create Cell Edge Cases ============

    #[test]
    fn test_create_cell_preserves_author() {
        let deployment = test_deployment();
        let author = [0x42; 32];
        let input = super::super::CellInput { tx_hash: [0x01; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell(
            "ns", "key", b"val", author, 500, &deployment, input,
        );

        let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(cell.author_lock_hash, author);
        assert_eq!(cell.timestamp_block, 500);
    }

    #[test]
    fn test_create_cell_empty_value() {
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x01; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell(
            "ns", "key", b"", [0xFF; 32], 1, &deployment, input,
        );

        let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(cell.value_size, 0);
        assert_ne!(cell.value_hash, [0u8; 32]); // Empty still has hash
    }

    // ============ New Edge Case Tests ============

    #[test]
    fn test_create_cell_large_value() {
        // Verify that a large value (64KB) produces correct value_size and a valid hash
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x77; 32], index: 0, since: 0 };
        let large_value = vec![0xCDu8; 65_536]; // 64KB

        let tx = create_knowledge_cell(
            "storage", "blob", &large_value, [0xAA; 32], 999, &deployment, input,
        );

        let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(cell.value_size, 65_536);
        assert_eq!(cell.value_hash, compute_value_hash(&large_value));
        assert_eq!(cell.timestamp_block, 999);
    }

    #[test]
    fn test_create_cell_block_zero() {
        // Genesis at block 0 should work fine
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x33; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell(
            "ns", "key", b"data", [0xFF; 32], 0, &deployment, input,
        );

        let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(cell.timestamp_block, 0);
        assert_eq!(cell.update_count, 0);
        assert_eq!(cell.difficulty, KNOWLEDGE_MIN_DIFFICULTY);
    }

    #[test]
    fn test_create_cell_type_script_args_match_key_hash() {
        // The type script args must equal key_hash for on-chain uniqueness enforcement
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x55; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell(
            "jarvis", "memory_index", b"pointer data", [0xBB; 32], 42, &deployment, input,
        );

        let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        let type_script = tx.outputs[0].type_script.as_ref().unwrap();
        assert_eq!(type_script.args, cell.key_hash.to_vec(),
            "Type script args must be key_hash for uniqueness");
    }

    #[test]
    fn test_create_cell_lock_script_encodes_pow_args() {
        // Verify the lock script args correctly encode PoWLockArgs
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x66; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell(
            "vibeswap", "config", b"settings", [0xDD; 32], 100, &deployment, input,
        );

        let lock_args_bytes = &tx.outputs[0].lock_script.args;
        let lock_args = PoWLockArgs::deserialize(lock_args_bytes).unwrap();
        let expected_key_hash = compute_key_hash("vibeswap", "config");

        assert_eq!(lock_args.pair_id, expected_key_hash);
        assert_eq!(lock_args.min_difficulty, KNOWLEDGE_MIN_DIFFICULTY);
    }

    #[test]
    fn test_update_preserves_key_hash_across_author_change() {
        // Different authors can update the same cell; key_hash must remain constant
        let deployment = test_deployment();
        let key_hash = compute_key_hash("shared", "resource");
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let old = KnowledgeCellData {
            key_hash,
            value_hash: compute_value_hash(b"author_a_data"),
            value_size: 13,
            prev_state_hash: [0u8; 32],
            mmr_root: [0u8; 32],
            update_count: 0,
            author_lock_hash: [0xAA; 32], // Author A
            timestamp_block: 100,
            difficulty: KNOWLEDGE_MIN_DIFFICULTY,
        };

        let tx = update_knowledge_cell(
            &old, input, b"author_b_data", [0xBB; 32], // New MMR
            [0xCC; 32], // Author B (different)
            200, &proof, &deployment,
        );

        let new_data = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(new_data.key_hash, key_hash, "Key hash must never change between authors");
        assert_eq!(new_data.author_lock_hash, [0xCC; 32], "Author should be updated");
        assert_ne!(new_data.author_lock_hash, old.author_lock_hash);
    }

    #[test]
    fn test_update_mmr_root_propagation() {
        // Verify MMR root from update_knowledge_cell is correctly stored
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let old = KnowledgeCellData {
            key_hash: compute_key_hash("jarvis", "mmr_test"),
            value_hash: compute_value_hash(b"v1"),
            value_size: 2,
            mmr_root: [0u8; 32], // Empty MMR at genesis
            ..Default::default()
        };

        let new_mmr = [0xDE; 32];
        let tx = update_knowledge_cell(
            &old, input, b"v2", new_mmr, [0xFF; 32], 50, &proof, &deployment,
        );

        let new_data = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(new_data.mmr_root, new_mmr, "MMR root must be stored exactly as provided");
        assert_ne!(new_data.mmr_root, old.mmr_root, "MMR root should differ from genesis");
    }

    #[test]
    fn test_update_witness_contains_pow_challenge_and_nonce() {
        // Verify the witness is exactly [challenge || nonce] (64 bytes)
        let deployment = test_deployment();
        let challenge = [0xAB; 32];
        let nonce = [0xCD; 32];
        let proof = PoWProof { challenge, nonce };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let old = KnowledgeCellData {
            key_hash: compute_key_hash("jarvis", "witness_test"),
            ..Default::default()
        };

        let tx = update_knowledge_cell(
            &old, input, b"data", [0u8; 32], [0xFF; 32], 10, &proof, &deployment,
        );

        assert_eq!(tx.witnesses.len(), 1);
        assert_eq!(tx.witnesses[0].len(), 64);
        assert_eq!(&tx.witnesses[0][..32], &challenge);
        assert_eq!(&tx.witnesses[0][32..64], &nonce);
    }

    #[test]
    fn test_difficulty_near_max_u8() {
        // Edge case: difficulty at 254 (one below u8::MAX)
        // Note: difficulty=255 causes overflow in compute_new_difficulty due to
        // unchecked `old_cell.difficulty + KNOWLEDGE_MAX_DIFFICULTY_DELTA` on line 221.
        // This test validates behavior at the highest safe difficulty value.
        let cell = KnowledgeCellData {
            difficulty: 254,
            timestamp_block: 100,
            ..Default::default()
        };

        // Fast update: wants to increase, clamped to +1 = 255
        let fast_diff = compute_new_difficulty(&cell, 101);
        assert!(fast_diff >= 254, "Should not decrease on fast update");
        assert!(fast_diff <= 255, "Clamped to +1 max");

        // Slow update: should decrease by 1
        let slow_diff = compute_new_difficulty(&cell, 100 + 10_000_000);
        assert!(slow_diff >= 253, "Slow update should decrease by at most 1");
        assert!(slow_diff <= 254, "Should not increase on slow update");
    }

    #[test]
    fn test_difficulty_at_minimum_with_slow_update() {
        // Edge case: difficulty is at minimum and update is slow
        // Should remain at minimum, not underflow
        let cell = KnowledgeCellData {
            difficulty: KNOWLEDGE_MIN_DIFFICULTY,
            timestamp_block: 0,
            ..Default::default()
        };

        let new_diff = compute_new_difficulty(&cell, u64::MAX / 2);
        assert_eq!(new_diff, KNOWLEDGE_MIN_DIFFICULTY,
            "Cannot go below minimum even with extremely slow updates");
    }

    #[test]
    fn test_full_lifecycle_create_mine_update() {
        // Integration test: create genesis -> mine PoW -> update cell -> verify chain integrity
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x01; 32], index: 0, since: 0 };

        // Step 1: Create genesis cell
        let create_tx = create_knowledge_cell(
            "lifecycle", "test", b"genesis_value", [0xAA; 32], 100, &deployment, input.clone(),
        );
        let genesis = KnowledgeCellData::deserialize(&create_tx.outputs[0].data).unwrap();
        assert_eq!(genesis.update_count, 0);
        assert_eq!(genesis.prev_state_hash, [0u8; 32]);

        // Step 2: Mine PoW for update (low difficulty for test speed)
        let mut mineable = genesis.clone();
        mineable.difficulty = 4; // Override to low difficulty for fast mining
        let proof = mine_for_knowledge_cell(&mineable, 1_000_000);
        assert!(proof.is_some(), "Should find PoW proof at difficulty 4");
        let proof = proof.unwrap();
        assert!(vibeswap_pow::verify(&proof, 4));

        // Step 3: Build update transaction
        let update_tx = update_knowledge_cell(
            &mineable, input.clone(), b"updated_value",
            [0xBB; 32], [0xCC; 32], 200, &proof, &deployment,
        );
        let updated = KnowledgeCellData::deserialize(&update_tx.outputs[0].data).unwrap();

        // Step 4: Verify chain integrity
        assert_eq!(updated.update_count, 1);
        assert_eq!(updated.key_hash, mineable.key_hash, "Key must persist");
        assert_eq!(updated.prev_state_hash, sha256_data(&mineable.serialize()),
            "Must link to genesis via prev_state_hash");
        assert_eq!(updated.value_hash, compute_value_hash(b"updated_value"));
        assert_eq!(updated.value_size, 13); // "updated_value".len()

        // Step 5: Verify second update chains off first
        let second_tx = update_knowledge_cell(
            &updated, input, b"third_value",
            [0xDD; 32], [0xEE; 32], 300, &proof, &deployment,
        );
        let third = KnowledgeCellData::deserialize(&second_tx.outputs[0].data).unwrap();
        assert_eq!(third.update_count, 2);
        assert_eq!(third.prev_state_hash, sha256_data(&updated.serialize()));
    }

    #[test]
    fn test_key_hash_long_inputs() {
        // Verify correctness with very long namespace and key strings
        let long_ns = "a".repeat(10_000);
        let long_key = "b".repeat(10_000);

        let h1 = compute_key_hash(&long_ns, &long_key);
        let h2 = compute_key_hash(&long_ns, &long_key);
        assert_eq!(h1, h2, "Long inputs must still be deterministic");

        // Slightly different long input must differ
        let long_key_alt = format!("{}c", "b".repeat(9_999));
        let h3 = compute_key_hash(&long_ns, &long_key_alt);
        assert_ne!(h1, h3, "Even 1-char difference in long input must produce different hash");
    }

    // ============ Additional Edge Case & Boundary Tests ============

    #[test]
    fn test_value_hash_single_byte() {
        // Single byte inputs should produce distinct, valid hashes
        let h0 = compute_value_hash(&[0x00]);
        let h1 = compute_value_hash(&[0x01]);
        let hff = compute_value_hash(&[0xFF]);

        assert_ne!(h0, [0u8; 32]);
        assert_ne!(h0, h1);
        assert_ne!(h0, hff);
        assert_ne!(h1, hff);
    }

    #[test]
    fn test_key_hash_separator_boundary_behavior() {
        // The hash format is: "vibeswap:knowledge:{ns}:{key}"
        // Since there's a single colon separator, ("ns:", "key") and ("ns", ":key")
        // both produce "vibeswap:knowledge:ns::key" — this is expected.
        // However, shifting characters across the boundary without adding colons
        // must produce different hashes.
        let h1 = compute_key_hash("abc", "def");
        let h2 = compute_key_hash("ab", "cdef");
        let h3 = compute_key_hash("abcd", "ef");
        let h4 = compute_key_hash("abcde", "f");
        let h5 = compute_key_hash("a", "bcdef");

        // All must differ because the colon separator changes position
        let hashes = [h1, h2, h3, h4, h5];
        for i in 0..hashes.len() {
            for j in (i + 1)..hashes.len() {
                assert_ne!(hashes[i], hashes[j],
                    "Boundary shift: hash[{}] == hash[{}]", i, j);
            }
        }

        // Verify the known collision: moving colon across boundary produces same hash
        let ha = compute_key_hash("ns:", "key");
        let hb = compute_key_hash("ns", ":key");
        assert_eq!(ha, hb, "Expected collision: both produce 'vibeswap:knowledge:ns::key'");
    }

    #[test]
    fn test_sha256_data_deterministic() {
        let data = b"test data for hashing";
        let h1 = sha256_data(data);
        let h2 = sha256_data(data);
        assert_eq!(h1, h2);
        assert_ne!(h1, [0u8; 32]);
    }

    #[test]
    fn test_sha256_data_empty_input() {
        let h = sha256_data(b"");
        assert_ne!(h, [0u8; 32]);
        // SHA-256 of empty string is a known constant
        assert_eq!(h, sha256_data(b""));
    }

    #[test]
    fn test_create_cell_capacity_is_300_ckb() {
        // Verify the capacity field is always 300 CKB = 30_000_000_000 shannons
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x01; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell(
            "ns", "key", b"data", [0xFF; 32], 100, &deployment, input,
        );

        assert_eq!(tx.outputs[0].capacity, 30_000_000_000u64,
            "Knowledge cell capacity must be exactly 300 CKB");
    }

    #[test]
    fn test_create_cell_has_single_cell_dep() {
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x01; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell(
            "ns", "key", b"data", [0xFF; 32], 100, &deployment, input,
        );

        assert_eq!(tx.cell_deps.len(), 1);
        assert_eq!(tx.cell_deps[0].tx_hash, deployment.script_dep_tx_hash);
        assert_eq!(tx.cell_deps[0].index, deployment.script_dep_index);
    }

    #[test]
    fn test_create_cell_genesis_witness_is_empty() {
        // Genesis cell has no PoW proof, witness should be empty vec
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x01; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell(
            "ns", "key", b"val", [0xFF; 32], 100, &deployment, input,
        );

        assert_eq!(tx.witnesses.len(), 1);
        assert!(tx.witnesses[0].is_empty(),
            "Genesis cell witness should be empty (filled during signing)");
    }

    #[test]
    fn test_update_cell_capacity_matches_create() {
        // Update cell must have same capacity as create cell
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let old = KnowledgeCellData {
            key_hash: compute_key_hash("ns", "key"),
            ..Default::default()
        };

        let tx = update_knowledge_cell(
            &old, input, b"data", [0u8; 32], [0xFF; 32], 10, &proof, &deployment,
        );

        assert_eq!(tx.outputs[0].capacity, 30_000_000_000u64);
    }

    #[test]
    fn test_update_increments_count_correctly_at_high_values() {
        // Verify update_count increments correctly even at high values
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let old = KnowledgeCellData {
            key_hash: compute_key_hash("ns", "counter"),
            update_count: u64::MAX - 1, // Near max
            ..Default::default()
        };

        let tx = update_knowledge_cell(
            &old, input, b"data", [0u8; 32], [0xFF; 32], 10, &proof, &deployment,
        );

        let new_data = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(new_data.update_count, u64::MAX,
            "update_count should increment to u64::MAX");
    }

    #[test]
    fn test_update_value_hash_changes_with_content() {
        // Verify that different new values produce different value_hashes in the output cell
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let old = KnowledgeCellData {
            key_hash: compute_key_hash("ns", "key"),
            ..Default::default()
        };

        let tx_a = update_knowledge_cell(
            &old, input.clone(), b"value_a", [0u8; 32], [0xFF; 32], 10, &proof, &deployment,
        );
        let tx_b = update_knowledge_cell(
            &old, input, b"value_b", [0u8; 32], [0xFF; 32], 10, &proof, &deployment,
        );

        let cell_a = KnowledgeCellData::deserialize(&tx_a.outputs[0].data).unwrap();
        let cell_b = KnowledgeCellData::deserialize(&tx_b.outputs[0].data).unwrap();

        assert_ne!(cell_a.value_hash, cell_b.value_hash,
            "Different values must produce different value_hashes");
        assert_eq!(cell_a.value_hash, compute_value_hash(b"value_a"));
        assert_eq!(cell_b.value_hash, compute_value_hash(b"value_b"));
    }

    #[test]
    fn test_difficulty_clamped_both_directions() {
        // Verify +-1 clamping explicitly: fast update → +1, slow update → -1
        let cell_mid = KnowledgeCellData {
            difficulty: 20,
            timestamp_block: 100,
            ..Default::default()
        };

        let fast = compute_new_difficulty(&cell_mid, 101);
        let slow = compute_new_difficulty(&cell_mid, 100 + 10_000_000);

        assert!(fast <= 21, "Fast update clamped to at most +1: got {}", fast);
        assert!(fast >= 20, "Fast update should not decrease: got {}", fast);
        assert!(slow >= 19, "Slow update clamped to at most -1: got {}", slow);
        assert!(slow <= 20, "Slow update should not increase: got {}", slow);
    }

    #[test]
    fn test_difficulty_at_target_blocks_stays_same() {
        // When elapsed == target, difficulty should not change
        let target_blocks = vibeswap_pow::TARGET_TRANSITION_BLOCKS * vibeswap_pow::ADJUSTMENT_WINDOW;
        for diff in [KNOWLEDGE_MIN_DIFFICULTY, 12, 16, 20, 30] {
            let cell = KnowledgeCellData {
                difficulty: diff,
                timestamp_block: 100,
                ..Default::default()
            };

            let new_diff = compute_new_difficulty(&cell, 100 + target_blocks);
            assert_eq!(new_diff, diff,
                "At exact target interval, difficulty {} should remain unchanged, got {}", diff, new_diff);
        }
    }

    #[test]
    fn test_mine_proof_challenge_uses_next_update_count() {
        // Verify that mine_for_knowledge_cell uses (update_count + 1) as batch_id
        let cell = KnowledgeCellData {
            key_hash: compute_key_hash("test", "batch_id"),
            update_count: 42,
            difficulty: 4,
            ..Default::default()
        };

        let old_bytes = cell.serialize();
        let prev_state_hash = sha256_data(&old_bytes);
        let expected_challenge = vibeswap_pow::generate_challenge(
            &cell.key_hash,
            43, // update_count + 1
            &prev_state_hash,
        );

        let proof = mine_for_knowledge_cell(&cell, 1_000_000);
        assert!(proof.is_some());
        assert_eq!(proof.unwrap().challenge, expected_challenge,
            "Challenge must use update_count + 1 as batch_id");
    }

    #[test]
    fn test_update_timestamp_block_propagates() {
        // Verify current_block parameter becomes the new cell's timestamp_block
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let old = KnowledgeCellData {
            key_hash: compute_key_hash("ns", "ts"),
            timestamp_block: 100,
            ..Default::default()
        };

        for block in [200u64, 0, 999_999, u64::MAX] {
            let tx = update_knowledge_cell(
                &old, input.clone(), b"data", [0u8; 32], [0xFF; 32], block, &proof, &deployment,
            );
            let new_data = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
            assert_eq!(new_data.timestamp_block, block,
                "timestamp_block should be set to current_block={}", block);
        }
    }

    fn test_deployment() -> super::super::DeploymentInfo {
        super::super::DeploymentInfo {
            pow_lock_code_hash: [0x01; 32],
            batch_auction_type_code_hash: [0x02; 32],
            commit_type_code_hash: [0x03; 32],
            amm_pool_type_code_hash: [0x04; 32],
            lp_position_type_code_hash: [0x05; 32],
            compliance_type_code_hash: [0x06; 32],
            config_type_code_hash: [0x07; 32],
            oracle_type_code_hash: [0x08; 32],
            knowledge_type_code_hash: [0x09; 32],
            lending_pool_type_code_hash: [0x0A; 32],
            vault_type_code_hash: [0x0B; 32],
            insurance_pool_type_code_hash: [0x0C; 32],
            prediction_market_type_code_hash: [0x0D; 32],
            prediction_position_type_code_hash: [0x0E; 32],
            script_dep_tx_hash: [0x10; 32],
            script_dep_index: 0,
        }
    }

    // ============ New Edge Case & Boundary Tests ============

    #[test]
    fn test_create_and_update_same_key_different_values_distinct_hashes() {
        // Two creates with same key but different values must produce different value_hashes
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x01; 32], index: 0, since: 0 };

        let tx_a = create_knowledge_cell(
            "ns", "key", b"value_a", [0xFF; 32], 100, &deployment, input.clone(),
        );
        let tx_b = create_knowledge_cell(
            "ns", "key", b"value_b", [0xFF; 32], 100, &deployment, input,
        );

        let cell_a = KnowledgeCellData::deserialize(&tx_a.outputs[0].data).unwrap();
        let cell_b = KnowledgeCellData::deserialize(&tx_b.outputs[0].data).unwrap();

        assert_eq!(cell_a.key_hash, cell_b.key_hash, "Same ns/key must produce same key_hash");
        assert_ne!(cell_a.value_hash, cell_b.value_hash, "Different values must produce different value_hashes");
    }

    #[test]
    fn test_key_hash_special_characters() {
        // Keys with special chars (slashes, dots, nulls) should still be unique
        let h1 = compute_key_hash("path/to", "file.txt");
        let h2 = compute_key_hash("path/to/file", "txt");
        let h3 = compute_key_hash("path", "to/file.txt");
        let h_null = compute_key_hash("ns\0ns", "key\0key");

        assert_ne!(h1, h2);
        assert_ne!(h1, h3);
        assert_ne!(h2, h3);
        assert_ne!(h_null, [0u8; 32]);
    }

    #[test]
    fn test_mine_proof_challenge_differs_between_different_cells() {
        // Two cells with different key_hashes should produce different challenges
        let cell_a = KnowledgeCellData {
            key_hash: compute_key_hash("jarvis", "state_a"),
            difficulty: 4,
            ..Default::default()
        };
        let cell_b = KnowledgeCellData {
            key_hash: compute_key_hash("jarvis", "state_b"),
            difficulty: 4,
            ..Default::default()
        };

        let proof_a = mine_for_knowledge_cell(&cell_a, 100_000).unwrap();
        let proof_b = mine_for_knowledge_cell(&cell_b, 100_000).unwrap();

        assert_ne!(proof_a.challenge, proof_b.challenge,
            "Cells with different key_hashes must generate different challenges");
    }

    #[test]
    fn test_update_at_max_block_number() {
        // Using u64::MAX as current_block should not panic
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let old = KnowledgeCellData {
            key_hash: compute_key_hash("ns", "max_block"),
            timestamp_block: u64::MAX - 1,
            ..Default::default()
        };

        let tx = update_knowledge_cell(
            &old, input, b"data", [0u8; 32], [0xFF; 32], u64::MAX, &proof, &deployment,
        );

        let new_data = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(new_data.timestamp_block, u64::MAX);
        assert_eq!(new_data.update_count, 1);
    }

    #[test]
    fn test_update_preserves_lock_script_structure() {
        // Verify lock script code_hash and hash_type match deployment info
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let old = KnowledgeCellData {
            key_hash: compute_key_hash("ns", "lock_test"),
            ..Default::default()
        };

        let tx = update_knowledge_cell(
            &old, input, b"val", [0u8; 32], [0xFF; 32], 200, &proof, &deployment,
        );

        let lock = &tx.outputs[0].lock_script;
        assert_eq!(lock.code_hash, deployment.pow_lock_code_hash);
        assert!(matches!(lock.hash_type, super::super::HashType::Data1));
    }

    #[test]
    fn test_create_cell_different_authors_different_cells() {
        // Same key/value but different authors should produce cells with different author_lock_hash
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x01; 32], index: 0, since: 0 };

        let tx_a = create_knowledge_cell(
            "ns", "key", b"value", [0xAA; 32], 100, &deployment, input.clone(),
        );
        let tx_b = create_knowledge_cell(
            "ns", "key", b"value", [0xBB; 32], 100, &deployment, input,
        );

        let cell_a = KnowledgeCellData::deserialize(&tx_a.outputs[0].data).unwrap();
        let cell_b = KnowledgeCellData::deserialize(&tx_b.outputs[0].data).unwrap();

        assert_ne!(cell_a.author_lock_hash, cell_b.author_lock_hash,
            "Different authors should produce different author_lock_hash");
        assert_eq!(cell_a.key_hash, cell_b.key_hash, "Key hash should be same");
        assert_eq!(cell_a.value_hash, cell_b.value_hash, "Value hash should be same");
    }

    #[test]
    fn test_difficulty_clamping_prevents_large_jumps() {
        // Even with extreme timing, difficulty can only change by +-KNOWLEDGE_MAX_DIFFICULTY_DELTA
        let cell = KnowledgeCellData {
            difficulty: 50,
            timestamp_block: 100,
            ..Default::default()
        };

        // Instant update (blocks_elapsed = 0) → wants to increase massively
        let fast = compute_new_difficulty(&cell, 100);
        assert!(fast <= 50 + KNOWLEDGE_MAX_DIFFICULTY_DELTA,
            "Fast update clamped: got {}, expected <= {}", fast, 50 + KNOWLEDGE_MAX_DIFFICULTY_DELTA);
        assert!(fast >= 50,
            "Fast update should not decrease: got {}", fast);

        // Extremely slow update
        let slow = compute_new_difficulty(&cell, 100 + u64::MAX / 4);
        assert!(slow >= 50u8.saturating_sub(KNOWLEDGE_MAX_DIFFICULTY_DELTA),
            "Slow update clamped: got {}, expected >= {}", slow, 50u8.saturating_sub(KNOWLEDGE_MAX_DIFFICULTY_DELTA));
        assert!(slow <= 50,
            "Slow update should not increase: got {}", slow);
    }

    #[test]
    fn test_mine_zero_iterations_returns_none() {
        // Zero iterations should always fail, even at difficulty 0
        let cell = KnowledgeCellData {
            key_hash: compute_key_hash("test", "zero_iter"),
            difficulty: 0,
            ..Default::default()
        };

        let proof = mine_for_knowledge_cell(&cell, 0);
        assert!(proof.is_none(), "Zero iterations must return None");
    }

    #[test]
    fn test_sha256_data_different_inputs_different_outputs() {
        // Verify sha256_data produces different outputs for different inputs
        let h1 = sha256_data(b"input_one");
        let h2 = sha256_data(b"input_two");
        let h3 = sha256_data(b"input_one"); // same as h1

        assert_ne!(h1, h2);
        assert_eq!(h1, h3, "Same input must produce same hash");
    }

    #[test]
    fn test_update_cell_deps_match_deployment() {
        // Verify that update_knowledge_cell uses the same cell_deps as create
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let create_tx = create_knowledge_cell(
            "ns", "key", b"val", [0xFF; 32], 100, &deployment, input.clone(),
        );

        let old = KnowledgeCellData {
            key_hash: compute_key_hash("ns", "key"),
            ..Default::default()
        };
        let update_tx = update_knowledge_cell(
            &old, input, b"new_val", [0u8; 32], [0xFF; 32], 200, &proof, &deployment,
        );

        assert_eq!(create_tx.cell_deps.len(), update_tx.cell_deps.len(),
            "Create and update should have same number of cell_deps");
        assert_eq!(create_tx.cell_deps[0].tx_hash, update_tx.cell_deps[0].tx_hash);
        assert_eq!(create_tx.cell_deps[0].index, update_tx.cell_deps[0].index);
    }
}
