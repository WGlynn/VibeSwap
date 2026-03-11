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
    let clamped = if adjusted > old_cell.difficulty + KNOWLEDGE_MAX_DIFFICULTY_DELTA {
        old_cell.difficulty + KNOWLEDGE_MAX_DIFFICULTY_DELTA
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
            script_dep_tx_hash: [0x10; 32],
            script_dep_index: 0,
        }
    }
}
