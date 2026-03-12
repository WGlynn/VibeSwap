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

    // ============ Batch 4: Additional Coverage Tests ============

    #[test]
    fn test_value_hash_max_byte_values() {
        // All-0xFF bytes should produce a valid, distinct hash
        let all_ff = vec![0xFFu8; 256];
        let all_zero = vec![0x00u8; 256];
        let h_ff = compute_value_hash(&all_ff);
        let h_zero = compute_value_hash(&all_zero);

        assert_ne!(h_ff, [0u8; 32]);
        assert_ne!(h_zero, [0u8; 32]);
        assert_ne!(h_ff, h_zero, "Different byte patterns must hash differently");
    }

    #[test]
    fn test_key_hash_whitespace_sensitivity() {
        // Whitespace differences must produce different hashes
        let h1 = compute_key_hash("jarvis", "key");
        let h2 = compute_key_hash("jarvis", " key");
        let h3 = compute_key_hash("jarvis", "key ");
        let h4 = compute_key_hash("jarvis ", "key");
        let h5 = compute_key_hash(" jarvis", "key");

        let hashes = [h1, h2, h3, h4, h5];
        for i in 0..hashes.len() {
            for j in (i + 1)..hashes.len() {
                assert_ne!(hashes[i], hashes[j],
                    "Whitespace-different hash[{}] == hash[{}]", i, j);
            }
        }
    }

    #[test]
    fn test_create_cell_value_size_u32_max_boundary() {
        // u32::MAX value size is representable but we just check large values serialize
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x01; 32], index: 0, since: 0 };

        // 100KB value
        let value = vec![0xABu8; 100_000];
        let tx = create_knowledge_cell(
            "ns", "big_key", &value, [0xFF; 32], 500, &deployment, input,
        );

        let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(cell.value_size, 100_000);
        assert_eq!(cell.value_hash, compute_value_hash(&value));
    }

    #[test]
    fn test_update_chain_prev_state_hash_uniqueness() {
        // Three sequential updates must all have distinct prev_state_hashes
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let mut current = KnowledgeCellData {
            key_hash: compute_key_hash("chain", "unique_psh"),
            ..Default::default()
        };

        let mut prev_hashes = Vec::new();
        for i in 1..=3u64 {
            let tx = update_knowledge_cell(
                &current, input.clone(), format!("v{}", i).as_bytes(),
                [i as u8; 32], [0xEE; 32], 100 + i * 50, &proof, &deployment,
            );
            let next = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
            prev_hashes.push(next.prev_state_hash);
            current = next;
        }

        // All prev_state_hashes must be unique
        for i in 0..prev_hashes.len() {
            for j in (i + 1)..prev_hashes.len() {
                assert_ne!(prev_hashes[i], prev_hashes[j],
                    "prev_state_hash[{}] == prev_state_hash[{}]", i, j);
            }
        }
    }

    #[test]
    fn test_difficulty_increase_by_exactly_one() {
        // Verify that a single fast update increases difficulty by exactly 1
        let cell = KnowledgeCellData {
            difficulty: 15,
            timestamp_block: 100,
            ..Default::default()
        };

        let fast_diff = compute_new_difficulty(&cell, 101);
        // Should be exactly 16 (increased by 1, clamped to +KNOWLEDGE_MAX_DIFFICULTY_DELTA)
        assert_eq!(fast_diff, 16,
            "Fast update from difficulty 15 should produce exactly 16, got {}", fast_diff);
    }

    #[test]
    fn test_difficulty_decrease_by_exactly_one() {
        // Verify that a very slow update decreases difficulty by exactly 1
        let cell = KnowledgeCellData {
            difficulty: 25,
            timestamp_block: 100,
            ..Default::default()
        };

        let slow_diff = compute_new_difficulty(&cell, 100 + 100_000_000);
        assert_eq!(slow_diff, 24,
            "Very slow update from difficulty 25 should produce exactly 24, got {}", slow_diff);
    }

    #[test]
    fn test_create_cell_input_preserved() {
        // Verify the input CellInput is correctly preserved in the transaction
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0xDE; 32], index: 7, since: 42 };

        let tx = create_knowledge_cell(
            "ns", "key", b"data", [0xFF; 32], 100, &deployment, input,
        );

        assert_eq!(tx.inputs.len(), 1);
        assert_eq!(tx.inputs[0].tx_hash, [0xDE; 32]);
        assert_eq!(tx.inputs[0].index, 7);
        assert_eq!(tx.inputs[0].since, 42);
    }

    #[test]
    fn test_update_cell_input_preserved() {
        // Verify the outpoint input is correctly preserved in update transaction
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0xAB; 32], index: 3, since: 99 };

        let old = KnowledgeCellData {
            key_hash: compute_key_hash("ns", "input_test"),
            ..Default::default()
        };

        let tx = update_knowledge_cell(
            &old, input, b"data", [0u8; 32], [0xFF; 32], 200, &proof, &deployment,
        );

        assert_eq!(tx.inputs.len(), 1);
        assert_eq!(tx.inputs[0].tx_hash, [0xAB; 32]);
        assert_eq!(tx.inputs[0].index, 3);
        assert_eq!(tx.inputs[0].since, 99);
    }

    #[test]
    fn test_mine_proof_at_difficulty_one() {
        // Difficulty 1 should succeed quickly
        let cell = KnowledgeCellData {
            key_hash: compute_key_hash("test", "diff_one"),
            difficulty: 1,
            ..Default::default()
        };

        let proof = mine_for_knowledge_cell(&cell, 10_000);
        assert!(proof.is_some(), "Difficulty 1 should succeed within 10K iterations");
        let p = proof.unwrap();
        assert!(vibeswap_pow::verify(&p, 1));
    }

    // ============ Batch 5: Edge Cases, Boundary Values, Overflow ============

    #[test]
    fn test_compute_key_hash_returns_32_bytes() {
        // Verify output is always exactly 32 bytes regardless of input
        let cases = [
            ("", ""),
            ("a", "b"),
            ("x".repeat(10_000).as_str(), "y"),
        ];
        for &(ns, key) in &[("", ""), ("a", "b")] {
            let h = compute_key_hash(ns, key);
            assert_eq!(h.len(), 32);
        }
        let long_ns = "x".repeat(10_000);
        let h = compute_key_hash(&long_ns, "y");
        assert_eq!(h.len(), 32);
    }

    #[test]
    fn test_compute_value_hash_returns_32_bytes() {
        // All outputs must be exactly 32 bytes
        for data in &[vec![], vec![0u8; 1], vec![0xFFu8; 65536]] {
            let h = compute_value_hash(data);
            assert_eq!(h.len(), 32);
        }
    }

    #[test]
    fn test_key_hash_null_bytes_in_namespace() {
        // Null bytes embedded in namespace should produce valid distinct hashes
        let h1 = compute_key_hash("ns\0", "key");
        let h2 = compute_key_hash("ns", "key");
        assert_ne!(h1, h2, "Null byte in namespace must produce different hash");
    }

    #[test]
    fn test_key_hash_multibyte_utf8_boundary() {
        // Multi-byte UTF-8 sequences of different lengths
        let h_2byte = compute_key_hash("jarvis", "\u{00E9}"); // 2-byte: e with accent
        let h_3byte = compute_key_hash("jarvis", "\u{20AC}"); // 3-byte: Euro sign
        let h_4byte = compute_key_hash("jarvis", "\u{1F600}"); // 4-byte: grinning face emoji
        assert_ne!(h_2byte, h_3byte);
        assert_ne!(h_2byte, h_4byte);
        assert_ne!(h_3byte, h_4byte);
    }

    #[test]
    fn test_value_hash_two_bytes_differ_by_one_bit() {
        // Values that differ by a single bit must produce different hashes
        let h1 = compute_value_hash(&[0b0000_0000]);
        let h2 = compute_value_hash(&[0b0000_0001]);
        assert_ne!(h1, h2, "Single-bit difference must produce different hash");
    }

    #[test]
    fn test_value_hash_length_extension() {
        // value + padding should differ from value alone (no length extension weakness)
        let h_short = compute_value_hash(b"hello");
        let h_padded = compute_value_hash(b"hello\x00");
        assert_ne!(h_short, h_padded, "Appending null byte must produce different hash");
    }

    #[test]
    fn test_create_cell_max_block_number() {
        // Creating a cell at u64::MAX block should not panic
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x01; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell(
            "ns", "key", b"data", [0xFF; 32], u64::MAX, &deployment, input,
        );

        let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(cell.timestamp_block, u64::MAX);
    }

    #[test]
    fn test_create_cell_all_zero_author() {
        // All-zero author_lock_hash is valid (represents burned/unclaimed)
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x01; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell(
            "ns", "key", b"data", [0x00; 32], 100, &deployment, input,
        );

        let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(cell.author_lock_hash, [0x00; 32]);
    }

    #[test]
    fn test_create_cell_serialization_roundtrip() {
        // Cell data from create should survive serialize -> deserialize roundtrip
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x01; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell(
            "roundtrip", "test", b"roundtrip_data", [0xAB; 32], 12345, &deployment, input,
        );

        let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        let reserialized = cell.serialize();
        let cell2 = KnowledgeCellData::deserialize(&reserialized).unwrap();
        assert_eq!(cell, cell2, "Serialize -> deserialize roundtrip must be identity");
    }

    #[test]
    fn test_update_serialization_roundtrip() {
        // Updated cell data must also survive roundtrip
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let old = KnowledgeCellData {
            key_hash: compute_key_hash("ns", "roundtrip2"),
            value_hash: compute_value_hash(b"old"),
            value_size: 3,
            update_count: 5,
            timestamp_block: 100,
            difficulty: 12,
            ..Default::default()
        };

        let tx = update_knowledge_cell(
            &old, input, b"new_data", [0xCC; 32], [0xDD; 32], 200, &proof, &deployment,
        );

        let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        let reserialized = cell.serialize();
        let cell2 = KnowledgeCellData::deserialize(&reserialized).unwrap();
        assert_eq!(cell, cell2);
    }

    #[test]
    fn test_update_with_empty_new_value() {
        // Updating with empty value should work and set value_size=0
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let old = KnowledgeCellData {
            key_hash: compute_key_hash("ns", "empty_update"),
            value_hash: compute_value_hash(b"non_empty"),
            value_size: 9,
            ..Default::default()
        };

        let tx = update_knowledge_cell(
            &old, input, b"", [0u8; 32], [0xFF; 32], 200, &proof, &deployment,
        );

        let new_data = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(new_data.value_size, 0);
        assert_eq!(new_data.value_hash, compute_value_hash(b""));
    }

    #[test]
    fn test_update_with_same_value_produces_same_value_hash() {
        // Updating with identical value to old should produce same value_hash
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let old = KnowledgeCellData {
            key_hash: compute_key_hash("ns", "idempotent"),
            value_hash: compute_value_hash(b"same_value"),
            value_size: 10,
            ..Default::default()
        };

        let tx = update_knowledge_cell(
            &old, input, b"same_value", [0u8; 32], [0xFF; 32], 200, &proof, &deployment,
        );

        let new_data = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(new_data.value_hash, old.value_hash,
            "Same value content must produce same value_hash");
        // But prev_state_hash should still differ (chain advances)
        assert_ne!(new_data.prev_state_hash, old.prev_state_hash);
    }

    #[test]
    fn test_difficulty_at_exactly_min_plus_one_with_slow_update() {
        // Difficulty just above minimum: slow update should decrease to minimum
        let cell = KnowledgeCellData {
            difficulty: KNOWLEDGE_MIN_DIFFICULTY + 1,
            timestamp_block: 100,
            ..Default::default()
        };

        let new_diff = compute_new_difficulty(&cell, 100 + 100_000_000);
        assert_eq!(new_diff, KNOWLEDGE_MIN_DIFFICULTY,
            "One above minimum with slow update should decrease to minimum, got {}", new_diff);
    }

    #[test]
    fn test_difficulty_at_exactly_min_with_fast_update() {
        // Difficulty at minimum: fast update should increase by 1
        let cell = KnowledgeCellData {
            difficulty: KNOWLEDGE_MIN_DIFFICULTY,
            timestamp_block: 100,
            ..Default::default()
        };

        let new_diff = compute_new_difficulty(&cell, 101);
        assert_eq!(new_diff, KNOWLEDGE_MIN_DIFFICULTY + 1,
            "At minimum with fast update should increase by 1, got {}", new_diff);
    }

    #[test]
    fn test_difficulty_block_number_going_backward_saturates() {
        // If current_block < timestamp_block (shouldn't happen but testing robustness)
        // blocks_elapsed should saturate to 0 via saturating_sub
        let cell = KnowledgeCellData {
            difficulty: 20,
            timestamp_block: 1000,
            ..Default::default()
        };

        // current_block < timestamp_block
        let new_diff = compute_new_difficulty(&cell, 500);
        // blocks_elapsed = 1000.saturating_sub(500) = 0, so this is like instant update
        assert!(new_diff >= 20, "Backward block should act like instant: got {}", new_diff);
        assert!(new_diff <= 21, "Clamped to +1: got {}", new_diff);
    }

    #[test]
    fn test_mine_single_iteration_at_low_difficulty() {
        // With max_iterations=1 and difficulty=0, should succeed (or at least not panic)
        let cell = KnowledgeCellData {
            key_hash: compute_key_hash("test", "single_iter"),
            difficulty: 0,
            ..Default::default()
        };

        let proof = mine_for_knowledge_cell(&cell, 1);
        // At difficulty 0, every nonce succeeds
        assert!(proof.is_some(), "Difficulty 0 with 1 iteration should succeed");
    }

    #[test]
    fn test_mine_produces_different_nonces_for_different_update_counts() {
        // Same cell at different update_counts should produce different challenges
        let cell_count_0 = KnowledgeCellData {
            key_hash: compute_key_hash("test", "nonce_diff"),
            update_count: 0,
            difficulty: 4,
            ..Default::default()
        };

        let cell_count_1 = KnowledgeCellData {
            key_hash: compute_key_hash("test", "nonce_diff"),
            update_count: 1,
            difficulty: 4,
            ..Default::default()
        };

        let proof_0 = mine_for_knowledge_cell(&cell_count_0, 100_000).unwrap();
        let proof_1 = mine_for_knowledge_cell(&cell_count_1, 100_000).unwrap();

        assert_ne!(proof_0.challenge, proof_1.challenge,
            "Different update_counts should produce different challenges");
    }

    #[test]
    fn test_update_type_script_preserved_across_update() {
        // Verify update preserves type_script code_hash and args from deployment
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let key_hash = compute_key_hash("ns", "type_script_test");
        let old = KnowledgeCellData {
            key_hash,
            ..Default::default()
        };

        let tx = update_knowledge_cell(
            &old, input, b"data", [0u8; 32], [0xFF; 32], 200, &proof, &deployment,
        );

        let type_script = tx.outputs[0].type_script.as_ref().unwrap();
        assert_eq!(type_script.code_hash, deployment.knowledge_type_code_hash,
            "Type script code_hash must match deployment");
        assert_eq!(type_script.args, key_hash.to_vec(),
            "Type script args must be the key_hash");
    }

    #[test]
    fn test_update_lock_args_match_key_hash() {
        // The lock script PoWLockArgs.pair_id must match the cell's key_hash
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let key_hash = compute_key_hash("ns", "lock_args_pair_id");
        let old = KnowledgeCellData {
            key_hash,
            ..Default::default()
        };

        let tx = update_knowledge_cell(
            &old, input, b"data", [0u8; 32], [0xFF; 32], 200, &proof, &deployment,
        );

        let lock_args = PoWLockArgs::deserialize(&tx.outputs[0].lock_script.args).unwrap();
        assert_eq!(lock_args.pair_id, key_hash,
            "Lock args pair_id must match cell key_hash");
        assert_eq!(lock_args.min_difficulty, KNOWLEDGE_MIN_DIFFICULTY);
    }

    #[test]
    fn test_sha256_data_large_input() {
        // sha256_data should handle large inputs without panic
        let large = vec![0xABu8; 1_000_000];
        let h = sha256_data(&large);
        assert_ne!(h, [0u8; 32]);
        assert_eq!(h, sha256_data(&large), "Must be deterministic for large input");
    }

    #[test]
    fn test_sha256_data_single_byte_sensitivity() {
        // Each single-byte value should produce a unique hash
        let h0 = sha256_data(&[0x00]);
        let h1 = sha256_data(&[0x01]);
        let hfe = sha256_data(&[0xFE]);
        let hff = sha256_data(&[0xFF]);

        assert_ne!(h0, h1);
        assert_ne!(h0, hfe);
        assert_ne!(h0, hff);
        assert_ne!(h1, hfe);
        assert_ne!(hfe, hff);
    }

    #[test]
    fn test_create_cell_dep_type_is_dep_group() {
        // Verify dep_type is always DepGroup (required for script resolution)
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x01; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell(
            "ns", "key", b"data", [0xFF; 32], 100, &deployment, input,
        );

        assert!(matches!(tx.cell_deps[0].dep_type, super::super::DepType::DepGroup),
            "Cell dep type must be DepGroup");
    }

    #[test]
    fn test_create_cell_hash_type_is_data1() {
        // Both lock and type scripts must use Data1 hash type
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x01; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell(
            "ns", "key", b"data", [0xFF; 32], 100, &deployment, input,
        );

        assert!(matches!(tx.outputs[0].lock_script.hash_type, super::super::HashType::Data1),
            "Lock script hash_type must be Data1");
        let type_script = tx.outputs[0].type_script.as_ref().unwrap();
        assert!(matches!(type_script.hash_type, super::super::HashType::Data1),
            "Type script hash_type must be Data1");
    }

    #[test]
    fn test_sequential_updates_monotonic_update_count() {
        // update_count must be strictly monotonically increasing across chain
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let mut current = KnowledgeCellData {
            key_hash: compute_key_hash("ns", "monotonic"),
            ..Default::default()
        };

        let mut prev_count = current.update_count;
        for i in 1..=10u64 {
            let tx = update_knowledge_cell(
                &current, input.clone(), format!("v{}", i).as_bytes(),
                [i as u8; 32], [0xEE; 32], 100 + i * 10, &proof, &deployment,
            );
            let next = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
            assert_eq!(next.update_count, prev_count + 1,
                "update_count must increment by exactly 1 at step {}", i);
            prev_count = next.update_count;
            current = next;
        }
        assert_eq!(current.update_count, 10);
    }

    #[test]
    fn test_update_large_value_size_correctness() {
        // Verify value_size for large new values in updates
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let old = KnowledgeCellData {
            key_hash: compute_key_hash("ns", "large_val_update"),
            value_size: 5,
            ..Default::default()
        };

        let large_value = vec![0xBBu8; 500_000]; // 500KB
        let tx = update_knowledge_cell(
            &old, input, &large_value, [0u8; 32], [0xFF; 32], 200, &proof, &deployment,
        );

        let new_data = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(new_data.value_size, 500_000);
        assert_eq!(new_data.value_hash, compute_value_hash(&large_value));
    }

    #[test]
    fn test_difficulty_one_above_min_fast_update() {
        // Just above minimum, fast update should go to min+2
        let cell = KnowledgeCellData {
            difficulty: KNOWLEDGE_MIN_DIFFICULTY + 1,
            timestamp_block: 100,
            ..Default::default()
        };

        let fast = compute_new_difficulty(&cell, 101);
        assert_eq!(fast, KNOWLEDGE_MIN_DIFFICULTY + 2,
            "One above min with fast update should increase by 1, got {}", fast);
    }

    #[test]
    fn test_create_and_update_use_same_deployment_code_hashes() {
        // Both create and update transactions should reference same deployment code hashes
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x01; 32], index: 0, since: 0 };
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };

        let create_tx = create_knowledge_cell(
            "ns", "consistency", b"v1", [0xFF; 32], 100, &deployment, input.clone(),
        );

        let old = KnowledgeCellData {
            key_hash: compute_key_hash("ns", "consistency"),
            ..Default::default()
        };
        let update_tx = update_knowledge_cell(
            &old, input, b"v2", [0u8; 32], [0xFF; 32], 200, &proof, &deployment,
        );

        // Lock scripts should use same code_hash
        assert_eq!(
            create_tx.outputs[0].lock_script.code_hash,
            update_tx.outputs[0].lock_script.code_hash,
            "Lock script code_hash must be consistent"
        );

        // Type scripts should use same code_hash
        assert_eq!(
            create_tx.outputs[0].type_script.as_ref().unwrap().code_hash,
            update_tx.outputs[0].type_script.as_ref().unwrap().code_hash,
            "Type script code_hash must be consistent"
        );
    }

    // ============ Batch 6: Hardening — New Edge Cases & Boundary Tests ============

    #[test]
    fn test_key_hash_case_sensitivity() {
        // Upper vs lower case must produce different hashes
        let h_lower = compute_key_hash("jarvis", "config");
        let h_upper = compute_key_hash("JARVIS", "CONFIG");
        let h_mixed = compute_key_hash("Jarvis", "Config");

        assert_ne!(h_lower, h_upper, "Case sensitivity: lower != upper");
        assert_ne!(h_lower, h_mixed, "Case sensitivity: lower != mixed");
        assert_ne!(h_upper, h_mixed, "Case sensitivity: upper != mixed");
    }

    #[test]
    fn test_key_hash_prefix_domain_separation() {
        // The prefix "vibeswap:knowledge:" ensures domain separation.
        // A hash without this prefix (raw concat) should differ.
        let h = compute_key_hash("ns", "key");
        // Manually hash "ns:key" without prefix — should differ
        let mut hasher = Sha256::new();
        hasher.update(b"ns:key");
        let result = hasher.finalize();
        let mut raw = [0u8; 32];
        raw.copy_from_slice(&result);
        assert_ne!(h, raw, "Domain prefix must differentiate from raw hash");
    }

    #[test]
    fn test_value_hash_incremental_lengths() {
        // Hashes of incrementally longer inputs must all differ
        let mut hashes = Vec::new();
        for len in 0..=32 {
            let data = vec![0xABu8; len];
            hashes.push(compute_value_hash(&data));
        }
        for i in 0..hashes.len() {
            for j in (i + 1)..hashes.len() {
                assert_ne!(hashes[i], hashes[j],
                    "Different lengths must differ: len {} vs len {}", i, j);
            }
        }
    }

    #[test]
    fn test_value_hash_known_sha256() {
        // SHA-256 of empty string is a well-known constant
        let h = compute_value_hash(b"");
        // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        assert_eq!(h[0], 0xe3);
        assert_eq!(h[1], 0xb0);
        assert_eq!(h[31], 0x55);
    }

    #[test]
    fn test_sha256_data_known_empty() {
        // sha256_data(b"") should match compute_value_hash(b"") since both are SHA-256
        let h1 = sha256_data(b"");
        let h2 = compute_value_hash(b"");
        assert_eq!(h1, h2, "sha256_data and compute_value_hash should produce same result for same input");
    }

    #[test]
    fn test_create_cell_type_script_is_some() {
        // Type script must always be present (not None) for knowledge cells
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x01; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell(
            "ns", "key", b"data", [0xFF; 32], 100, &deployment, input,
        );

        assert!(tx.outputs[0].type_script.is_some(),
            "Knowledge cells must always have a type script");
    }

    #[test]
    fn test_update_cell_type_script_is_some() {
        // Type script must be present in updates too
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let old = KnowledgeCellData {
            key_hash: compute_key_hash("ns", "type_present"),
            ..Default::default()
        };

        let tx = update_knowledge_cell(
            &old, input, b"data", [0u8; 32], [0xFF; 32], 200, &proof, &deployment,
        );

        assert!(tx.outputs[0].type_script.is_some());
    }

    #[test]
    fn test_create_cell_multiple_namespaces_unique_key_hashes() {
        // 10 different namespaces with the same key should all produce unique key_hashes
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x01; 32], index: 0, since: 0 };

        let mut key_hashes = Vec::new();
        for i in 0..10u8 {
            let ns = format!("namespace_{}", i);
            let tx = create_knowledge_cell(
                &ns, "shared_key", b"data", [0xFF; 32], 100, &deployment, input.clone(),
            );
            let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
            key_hashes.push(cell.key_hash);
        }

        for i in 0..key_hashes.len() {
            for j in (i + 1)..key_hashes.len() {
                assert_ne!(key_hashes[i], key_hashes[j],
                    "Different namespaces must produce different key_hashes: {} vs {}", i, j);
            }
        }
    }

    #[test]
    fn test_update_prev_state_hash_depends_on_all_old_fields() {
        // Two old cells differing only in author_lock_hash must produce different prev_state_hashes
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let old_a = KnowledgeCellData {
            key_hash: compute_key_hash("ns", "psh_diff"),
            author_lock_hash: [0xAA; 32],
            ..Default::default()
        };

        let old_b = KnowledgeCellData {
            key_hash: compute_key_hash("ns", "psh_diff"),
            author_lock_hash: [0xBB; 32],
            ..Default::default()
        };

        let tx_a = update_knowledge_cell(
            &old_a, input.clone(), b"val", [0u8; 32], [0xFF; 32], 200, &proof, &deployment,
        );
        let tx_b = update_knowledge_cell(
            &old_b, input, b"val", [0u8; 32], [0xFF; 32], 200, &proof, &deployment,
        );

        let cell_a = KnowledgeCellData::deserialize(&tx_a.outputs[0].data).unwrap();
        let cell_b = KnowledgeCellData::deserialize(&tx_b.outputs[0].data).unwrap();

        assert_ne!(cell_a.prev_state_hash, cell_b.prev_state_hash,
            "Different old cell content must produce different prev_state_hash");
    }

    #[test]
    fn test_difficulty_range_sweep() {
        // Sweep difficulty from min to 50, verify fast always >= current, slow always <= current
        let target_blocks = vibeswap_pow::TARGET_TRANSITION_BLOCKS * vibeswap_pow::ADJUSTMENT_WINDOW;
        for diff in KNOWLEDGE_MIN_DIFFICULTY..=50 {
            let cell = KnowledgeCellData {
                difficulty: diff,
                timestamp_block: 100,
                ..Default::default()
            };

            let fast = compute_new_difficulty(&cell, 101);
            assert!(fast >= diff, "diff={}: fast update ({}) must not decrease", diff, fast);

            let slow = compute_new_difficulty(&cell, 100 + 10_000_000);
            assert!(slow <= diff, "diff={}: slow update ({}) must not increase", diff, slow);

            let stable = compute_new_difficulty(&cell, 100 + target_blocks);
            assert_eq!(stable, diff, "diff={}: target interval must not change, got {}", diff, stable);
        }
    }

    #[test]
    fn test_mine_proof_verifies_at_multiple_difficulties() {
        // Mine and verify at several difficulty levels
        for diff in [0u8, 1, 2, 4, 8] {
            let cell = KnowledgeCellData {
                key_hash: compute_key_hash("test", &format!("multi_diff_{}", diff)),
                difficulty: diff,
                ..Default::default()
            };

            let proof = mine_for_knowledge_cell(&cell, 1_000_000);
            assert!(proof.is_some(), "Should find proof at difficulty {}", diff);
            assert!(vibeswap_pow::verify(&proof.unwrap(), diff),
                "Proof must verify at difficulty {}", diff);
        }
    }

    #[test]
    fn test_create_cell_output_data_is_serialized_cell() {
        // Verify that the output data is exactly the serialized KnowledgeCellData
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x01; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell(
            "ns", "roundtrip_output", b"test_data", [0xBB; 32], 42, &deployment, input,
        );

        // Deserialize and re-serialize to check equality
        let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        let reserialized = cell.serialize();
        assert_eq!(tx.outputs[0].data, reserialized.to_vec(),
            "Output data must be exactly the serialized cell");
    }

    #[test]
    fn test_update_cell_output_data_is_serialized_cell() {
        // Same check for update transactions
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let old = KnowledgeCellData {
            key_hash: compute_key_hash("ns", "roundtrip_update_output"),
            value_hash: compute_value_hash(b"old"),
            value_size: 3,
            update_count: 7,
            timestamp_block: 100,
            difficulty: 14,
            ..Default::default()
        };

        let tx = update_knowledge_cell(
            &old, input, b"new_data", [0xCC; 32], [0xDD; 32], 200, &proof, &deployment,
        );

        let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        let reserialized = cell.serialize();
        assert_eq!(tx.outputs[0].data, reserialized.to_vec());
    }

    #[test]
    fn test_key_hash_repeated_characters() {
        // "aaaa":"b" vs "aaa":"ab" vs "aa":"aab" — all must differ
        let h1 = compute_key_hash("aaaa", "b");
        let h2 = compute_key_hash("aaa", "ab");
        let h3 = compute_key_hash("aa", "aab");
        let h4 = compute_key_hash("a", "aaab");

        assert_ne!(h1, h2);
        assert_ne!(h1, h3);
        assert_ne!(h1, h4);
        assert_ne!(h2, h3);
        assert_ne!(h2, h4);
        assert_ne!(h3, h4);
    }

    #[test]
    fn test_update_difficulty_uses_compute_new_difficulty() {
        // Verify the difficulty in the updated cell matches compute_new_difficulty's output
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let old = KnowledgeCellData {
            key_hash: compute_key_hash("ns", "diff_match"),
            difficulty: 18,
            timestamp_block: 100,
            ..Default::default()
        };

        let current_block = 200u64;
        let expected_diff = compute_new_difficulty(&old, current_block);

        let tx = update_knowledge_cell(
            &old, input, b"val", [0u8; 32], [0xFF; 32], current_block, &proof, &deployment,
        );

        let new_data = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(new_data.difficulty, expected_diff,
            "Update cell difficulty must match compute_new_difficulty");
    }

    #[test]
    fn test_create_genesis_fields_all_correct() {
        // Comprehensive check of all genesis cell fields
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x01; 32], index: 0, since: 0 };
        let author = [0x42; 32];
        let value = b"genesis_value";
        let block = 12345u64;

        let tx = create_knowledge_cell(
            "comprehensive", "genesis", value, author, block, &deployment, input,
        );

        let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();

        assert_eq!(cell.key_hash, compute_key_hash("comprehensive", "genesis"));
        assert_eq!(cell.value_hash, compute_value_hash(value));
        assert_eq!(cell.value_size, value.len() as u32);
        assert_eq!(cell.prev_state_hash, [0u8; 32], "Genesis prev_state_hash must be zero");
        assert_eq!(cell.mmr_root, [0u8; 32], "Genesis MMR root must be zero");
        assert_eq!(cell.update_count, 0, "Genesis update_count must be 0");
        assert_eq!(cell.author_lock_hash, author);
        assert_eq!(cell.timestamp_block, block);
        assert_eq!(cell.difficulty, KNOWLEDGE_MIN_DIFFICULTY);
    }

    // ============ Hardening Tests — Edge Cases, Boundaries, Error Paths ============

    #[test]
    fn test_key_hash_long_namespace() {
        let long_ns = "a".repeat(10_000);
        let h = compute_key_hash(&long_ns, "key");
        assert_ne!(h, [0u8; 32]);
        assert_eq!(h, compute_key_hash(&long_ns, "key")); // Deterministic
    }

    #[test]
    fn test_key_hash_long_key() {
        let long_key = "k".repeat(10_000);
        let h = compute_key_hash("ns", &long_key);
        assert_ne!(h, [0u8; 32]);
    }

    #[test]
    fn test_key_hash_whitespace_sensitivity_2() {
        let h1 = compute_key_hash("ns", "key");
        let h2 = compute_key_hash("ns", "key ");
        let h3 = compute_key_hash("ns", " key");
        assert_ne!(h1, h2);
        assert_ne!(h1, h3);
        assert_ne!(h2, h3);
    }

    #[test]
    fn test_key_hash_null_bytes() {
        let h1 = compute_key_hash("ns\0", "key");
        let h2 = compute_key_hash("ns", "\0key");
        let h3 = compute_key_hash("ns", "key");
        assert_ne!(h1, h3);
        assert_ne!(h2, h3);
    }

    #[test]
    fn test_value_hash_single_byte_2() {
        let h = compute_value_hash(&[0x42]);
        assert_ne!(h, [0u8; 32]);
    }

    #[test]
    fn test_value_hash_all_zeros() {
        let h1 = compute_value_hash(&[0u8; 32]);
        let h2 = compute_value_hash(&[0u8; 33]);
        assert_ne!(h1, h2); // Different lengths → different hashes
    }

    #[test]
    fn test_value_hash_all_ones_vs_zeros() {
        let h1 = compute_value_hash(&[0x00; 64]);
        let h2 = compute_value_hash(&[0xFF; 64]);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_sha256_data_empty() {
        let h = sha256_data(b"");
        assert_ne!(h, [0u8; 32]);
    }

    #[test]
    fn test_sha256_data_deterministic_2() {
        let h1 = sha256_data(b"test data");
        let h2 = sha256_data(b"test data");
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_sha256_data_different_inputs() {
        let h1 = sha256_data(b"abc");
        let h2 = sha256_data(b"abd");
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_create_knowledge_cell_empty_value() {
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell("ns", "key", b"", [0xFF; 32], 100, &deployment, input);
        let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(cell.value_size, 0);
        assert_eq!(cell.value_hash, compute_value_hash(b""));
    }

    #[test]
    fn test_create_knowledge_cell_large_value() {
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };
        let large_value = vec![0xAB; 100_000];

        let tx = create_knowledge_cell("ns", "key", &large_value, [0xFF; 32], 100, &deployment, input);
        let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(cell.value_size, 100_000);
    }

    #[test]
    fn test_create_knowledge_cell_capacity_is_300_ckb() {
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell("ns", "key", b"val", [0xFF; 32], 100, &deployment, input);
        assert_eq!(tx.outputs[0].capacity, 30_000_000_000u64);
    }

    #[test]
    fn test_create_knowledge_cell_witness_is_empty_vec() {
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell("ns", "key", b"val", [0xFF; 32], 100, &deployment, input);
        assert_eq!(tx.witnesses.len(), 1);
        assert_eq!(tx.witnesses[0].len(), 0);
    }

    #[test]
    fn test_update_knowledge_cell_witness_is_64_bytes() {
        let deployment = test_deployment();
        let old = KnowledgeCellData { ..Default::default() };
        let proof = PoWProof { challenge: [0xAA; 32], nonce: [0xBB; 32] };
        let input = super::super::CellInput { tx_hash: [0; 32], index: 0, since: 0 };

        let tx = update_knowledge_cell(&old, input, b"new", [0; 32], [0; 32], 200, &proof, &deployment);
        assert_eq!(tx.witnesses[0].len(), 64);
        assert_eq!(&tx.witnesses[0][..32], &[0xAA; 32]);
        assert_eq!(&tx.witnesses[0][32..], &[0xBB; 32]);
    }

    #[test]
    fn test_update_preserves_key_hash_across_many_updates() {
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0x42; 32], index: 0, since: 0 };
        let original_key_hash = compute_key_hash("ns", "persistent_key");

        let mut current = KnowledgeCellData {
            key_hash: original_key_hash,
            ..Default::default()
        };

        for i in 1..=10u64 {
            let val = format!("value_{}", i);
            let tx = update_knowledge_cell(
                &current, input.clone(), val.as_bytes(),
                [i as u8; 32], [0xEE; 32], 100 + i * 10, &proof, &deployment,
            );
            current = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
            assert_eq!(current.key_hash, original_key_hash,
                "Key hash must never change on update {}", i);
        }
    }

    #[test]
    fn test_compute_new_difficulty_at_min_with_slow_update() {
        let cell = KnowledgeCellData {
            difficulty: KNOWLEDGE_MIN_DIFFICULTY,
            timestamp_block: 100,
            ..Default::default()
        };
        // Very slow update — difficulty should stay at min
        let new_diff = compute_new_difficulty(&cell, 100 + 1_000_000);
        assert_eq!(new_diff, KNOWLEDGE_MIN_DIFFICULTY);
    }

    #[test]
    fn test_compute_new_difficulty_max_block_number() {
        let cell = KnowledgeCellData {
            difficulty: 20,
            timestamp_block: 100,
            ..Default::default()
        };
        let new_diff = compute_new_difficulty(&cell, u64::MAX);
        assert!(new_diff >= KNOWLEDGE_MIN_DIFFICULTY);
        // Should be clamped: at most -1 from current
        assert!(new_diff >= 19);
    }

    #[test]
    fn test_compute_new_difficulty_same_block() {
        let cell = KnowledgeCellData {
            difficulty: 16,
            timestamp_block: 100,
            ..Default::default()
        };
        // blocks_elapsed = 0 via saturating_sub
        let new_diff = compute_new_difficulty(&cell, 100);
        // Very fast (0 blocks elapsed) → wants to increase
        assert!(new_diff <= 17); // clamped to +1
        assert!(new_diff >= KNOWLEDGE_MIN_DIFFICULTY);
    }

    #[test]
    fn test_compute_new_difficulty_current_block_before_timestamp() {
        let cell = KnowledgeCellData {
            difficulty: 16,
            timestamp_block: 200,
            ..Default::default()
        };
        // current_block < timestamp_block → saturating_sub = 0
        let new_diff = compute_new_difficulty(&cell, 100);
        assert!(new_diff >= KNOWLEDGE_MIN_DIFFICULTY);
        assert!(new_diff <= 17);
    }

    #[test]
    fn test_create_knowledge_cell_author_lock_hash_stored() {
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0; 32], index: 0, since: 0 };
        let author = [0x42; 32];

        let tx = create_knowledge_cell("ns", "key", b"val", author, 100, &deployment, input);
        let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(cell.author_lock_hash, author);
    }

    #[test]
    fn test_update_author_lock_hash_changes() {
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0; 32], index: 0, since: 0 };

        let old = KnowledgeCellData {
            author_lock_hash: [0xAA; 32],
            ..Default::default()
        };
        let new_author = [0xBB; 32];

        let tx = update_knowledge_cell(&old, input, b"val", [0; 32], new_author, 200, &proof, &deployment);
        let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(cell.author_lock_hash, new_author);
    }

    #[test]
    fn test_update_mmr_root_stored() {
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0; 32], index: 0, since: 0 };

        let old = KnowledgeCellData::default();
        let new_mmr = [0xCC; 32];

        let tx = update_knowledge_cell(&old, input, b"val", new_mmr, [0; 32], 200, &proof, &deployment);
        let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(cell.mmr_root, new_mmr);
    }

    #[test]
    fn test_create_cell_dep_count() {
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell("ns", "key", b"val", [0; 32], 100, &deployment, input);
        assert_eq!(tx.cell_deps.len(), 1);
    }

    #[test]
    fn test_update_cell_dep_count() {
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0; 32], index: 0, since: 0 };
        let old = KnowledgeCellData::default();

        let tx = update_knowledge_cell(&old, input, b"val", [0; 32], [0; 32], 200, &proof, &deployment);
        assert_eq!(tx.cell_deps.len(), 1);
    }

    #[test]
    fn test_key_hash_separator_in_inputs() {
        // Ensure the ":" separator in the hash input doesn't cause collisions
        // "ns:key" with namespace="ns" key="key" vs namespace="ns:" key="key"
        let h1 = compute_key_hash("ns", "key");
        let h2 = compute_key_hash("ns:", "key");
        let h3 = compute_key_hash("n", "s:key");
        assert_ne!(h1, h2);
        assert_ne!(h1, h3);
    }

    #[test]
    fn test_value_hash_two_byte_difference() {
        // Changing a single byte should change the hash
        let mut data = [0u8; 256];
        let h1 = compute_value_hash(&data);
        data[127] = 1;
        let h2 = compute_value_hash(&data);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_update_value_size_matches_new_value() {
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0; 32], index: 0, since: 0 };
        let old = KnowledgeCellData::default();

        let values: &[&[u8]] = &[b"", b"a", b"hello world", &[0xFFu8; 1000]];
        for val in values {
            let tx = update_knowledge_cell(&old, input.clone(), val, [0; 32], [0; 32], 200, &proof, &deployment);
            let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
            assert_eq!(cell.value_size, val.len() as u32,
                "value_size mismatch for value of length {}", val.len());
        }
    }

    #[test]
    fn test_update_value_hash_matches_new_value() {
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0; 32], index: 0, since: 0 };
        let old = KnowledgeCellData::default();

        let tx = update_knowledge_cell(&old, input, b"specific_value", [0; 32], [0; 32], 200, &proof, &deployment);
        let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(cell.value_hash, compute_value_hash(b"specific_value"));
    }

    #[test]
    fn test_difficulty_clamp_prevents_large_jump() {
        // With a high starting difficulty, fast update should only increase by 1
        let cell = KnowledgeCellData {
            difficulty: 30,
            timestamp_block: 100,
            ..Default::default()
        };
        let new_diff = compute_new_difficulty(&cell, 101); // Very fast
        assert!(new_diff <= 31, "Max increase should be KNOWLEDGE_MAX_DIFFICULTY_DELTA");
    }

    #[test]
    fn test_difficulty_clamp_prevents_large_decrease() {
        let cell = KnowledgeCellData {
            difficulty: 30,
            timestamp_block: 100,
            ..Default::default()
        };
        // Very slow update
        let new_diff = compute_new_difficulty(&cell, 100 + 10_000_000);
        assert!(new_diff >= 29, "Max decrease should be KNOWLEDGE_MAX_DIFFICULTY_DELTA");
    }

    #[test]
    fn test_create_lock_script_uses_pow_lock() {
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell("ns", "key", b"val", [0; 32], 100, &deployment, input);
        assert_eq!(tx.outputs[0].lock_script.code_hash, deployment.pow_lock_code_hash);
    }

    #[test]
    fn test_create_type_script_uses_knowledge_type() {
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0; 32], index: 0, since: 0 };

        let tx = create_knowledge_cell("ns", "key", b"val", [0; 32], 100, &deployment, input);
        let type_script = tx.outputs[0].type_script.as_ref().unwrap();
        assert_eq!(type_script.code_hash, deployment.knowledge_type_code_hash);
    }

    #[test]
    fn test_create_type_script_args_is_key_hash() {
        let deployment = test_deployment();
        let input = super::super::CellInput { tx_hash: [0; 32], index: 0, since: 0 };
        let expected_key_hash = compute_key_hash("myns", "mykey");

        let tx = create_knowledge_cell("myns", "mykey", b"val", [0; 32], 100, &deployment, input);
        let type_script = tx.outputs[0].type_script.as_ref().unwrap();
        assert_eq!(type_script.args, expected_key_hash.to_vec());
    }

    #[test]
    fn test_update_count_overflow_at_u64_max() {
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0; 32], index: 0, since: 0 };

        let old = KnowledgeCellData {
            update_count: u64::MAX - 1,
            ..Default::default()
        };

        let tx = update_knowledge_cell(&old, input, b"val", [0; 32], [0; 32], 200, &proof, &deployment);
        let cell = KnowledgeCellData::deserialize(&tx.outputs[0].data).unwrap();
        assert_eq!(cell.update_count, u64::MAX);
    }

    #[test]
    fn test_prev_state_hash_changes_with_different_old_cells() {
        let deployment = test_deployment();
        let proof = PoWProof { challenge: [0x11; 32], nonce: [0x22; 32] };
        let input = super::super::CellInput { tx_hash: [0; 32], index: 0, since: 0 };

        let old1 = KnowledgeCellData {
            value_size: 10,
            ..Default::default()
        };
        let old2 = KnowledgeCellData {
            value_size: 20,
            ..Default::default()
        };

        let tx1 = update_knowledge_cell(&old1, input.clone(), b"val", [0; 32], [0; 32], 200, &proof, &deployment);
        let tx2 = update_knowledge_cell(&old2, input, b"val", [0; 32], [0; 32], 200, &proof, &deployment);

        let cell1 = KnowledgeCellData::deserialize(&tx1.outputs[0].data).unwrap();
        let cell2 = KnowledgeCellData::deserialize(&tx2.outputs[0].data).unwrap();
        assert_ne!(cell1.prev_state_hash, cell2.prev_state_hash);
    }
}
