// ============ Knowledge Type Script — Library ============
// CKB type script that validates knowledge cell state transitions
// for PoW-gated shared state used by Jarvis multi-instance sync.
//
// Knowledge cells form a header chain (prev_state_hash links) with
// MMR accumulation of all historical states. The PoW lock script
// handles write access gating; this type script validates that
// state transitions are well-formed.
//
// Transitions:
//   Creation  — genesis cell with update_count=0, empty prev_state_hash
//   Update    — header chain continuity, MMR append, monotonic counter
//   Destruction — only allowed if update_count > 0

#![cfg_attr(feature = "ckb", no_std)]

#[cfg(feature = "ckb")]
extern crate alloc;
#[cfg(feature = "ckb")]
use alloc::vec::Vec;

use sha2::{Digest, Sha256};
use vibeswap_types::{KnowledgeCellData, KNOWLEDGE_MIN_DIFFICULTY, KNOWLEDGE_MAX_DIFFICULTY_DELTA};

// ============ Script Entry Point ============

/// Validate knowledge cell creation (new cell, no input)
pub fn verify_creation(cell_data: &[u8]) -> Result<(), KnowledgeError> {
    let data = KnowledgeCellData::deserialize(cell_data)
        .ok_or(KnowledgeError::InvalidCellData)?;

    // Genesis: update_count must be 0
    if data.update_count != 0 {
        return Err(KnowledgeError::NonZeroGenesisCounter);
    }

    // Genesis: prev_state_hash must be all zeros
    if data.prev_state_hash != [0u8; 32] {
        return Err(KnowledgeError::NonZeroGenesisPrevHash);
    }

    // Genesis: MMR root must be empty (all zeros)
    if data.mmr_root != [0u8; 32] {
        return Err(KnowledgeError::NonEmptyGenesisMMR);
    }

    // Genesis: difficulty must meet minimum
    if data.difficulty < KNOWLEDGE_MIN_DIFFICULTY {
        return Err(KnowledgeError::DifficultyBelowMinimum);
    }

    // key_hash must be non-zero (identifies the knowledge slot)
    if data.key_hash == [0u8; 32] {
        return Err(KnowledgeError::EmptyKeyHash);
    }

    // value_hash must be non-zero (must store something)
    if data.value_hash == [0u8; 32] {
        return Err(KnowledgeError::EmptyValueHash);
    }

    Ok(())
}

/// Validate knowledge cell update (input → output)
pub fn verify_update(
    old_cell_data: &[u8],
    new_cell_data: &[u8],
) -> Result<(), KnowledgeError> {
    let old = KnowledgeCellData::deserialize(old_cell_data)
        .ok_or(KnowledgeError::InvalidCellData)?;
    let new = KnowledgeCellData::deserialize(new_cell_data)
        .ok_or(KnowledgeError::InvalidCellData)?;

    // ============ key_hash must be unchanged ============
    // Same knowledge slot — you can't change what key this cell represents
    if old.key_hash != new.key_hash {
        return Err(KnowledgeError::KeyHashChanged);
    }

    // ============ Header chain: prev_state_hash = SHA-256(old_cell_data) ============
    let expected_prev_hash = sha256_hash(old_cell_data);
    if new.prev_state_hash != expected_prev_hash {
        return Err(KnowledgeError::InvalidPrevStateHash);
    }

    // ============ Monotonic counter: new = old + 1 ============
    if new.update_count != old.update_count + 1 {
        return Err(KnowledgeError::NonMonotonicCounter);
    }

    // ============ MMR root: old MMR with new state appended ============
    // We verify by recomputing: the new MMR root should be the result of
    // appending the new state hash to the old MMR.
    // Since we can't reconstruct the full MMR from just the root, we verify
    // that the new MMR root is different from the old (state changed) and non-zero.
    // Full verification requires MMR proof in witness (future enhancement).
    if new.mmr_root == [0u8; 32] && new.update_count > 0 {
        return Err(KnowledgeError::EmptyMMROnUpdate);
    }
    if new.mmr_root == old.mmr_root {
        return Err(KnowledgeError::MMRRootUnchanged);
    }

    // ============ Difficulty adjustment: within ±1 of previous ============
    let diff_delta = if new.difficulty >= old.difficulty {
        new.difficulty - old.difficulty
    } else {
        old.difficulty - new.difficulty
    };
    if diff_delta > KNOWLEDGE_MAX_DIFFICULTY_DELTA {
        return Err(KnowledgeError::DifficultyAdjustmentTooLarge);
    }

    // Difficulty must not go below minimum
    if new.difficulty < KNOWLEDGE_MIN_DIFFICULTY {
        return Err(KnowledgeError::DifficultyBelowMinimum);
    }

    // ============ value_hash must be non-zero ============
    if new.value_hash == [0u8; 32] {
        return Err(KnowledgeError::EmptyValueHash);
    }

    // ============ timestamp_block must not decrease ============
    if new.timestamp_block < old.timestamp_block {
        return Err(KnowledgeError::TimestampDecreased);
    }

    Ok(())
}

/// Validate knowledge cell destruction
pub fn verify_destruction(cell_data: &[u8]) -> Result<(), KnowledgeError> {
    let data = KnowledgeCellData::deserialize(cell_data)
        .ok_or(KnowledgeError::InvalidCellData)?;

    // Can't destroy genesis cell without any history
    if data.update_count == 0 {
        return Err(KnowledgeError::DestroyGenesisCell);
    }

    Ok(())
}

// ============ Helpers ============

/// SHA-256 hash of arbitrary data
fn sha256_hash(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

/// Compute the expected MMR root after appending a new state to the existing MMR.
/// Takes the serialized old cell data as the new leaf to append.
/// Returns the new MMR root.
///
/// Note: This requires the full MMR peaks from the witness to reconstruct.
/// For on-chain verification, the witness must include the old peaks.
/// For off-chain (SDK), we can compute directly.
pub fn compute_new_mmr_root(
    old_peaks: &[[u8; 32]],
    old_leaf_count: u64,
    new_state_data: &[u8],
) -> [u8; 32] {
    // Build a temporary MMR from the peaks to append the new state
    let mut mmr = vibeswap_mmr::MMR::new();

    // Reconstruct: we can't perfectly reconstruct from peaks alone,
    // but we can compute the new root if we know the leaf count and peaks.
    // For verification, we use the peaks-based root computation.
    let new_leaf_hash = vibeswap_mmr::hash_leaf(new_state_data);

    // Simple approach: append to a fresh MMR (for SDK-side computation)
    // On-chain, the witness provides the proof
    if old_peaks.is_empty() && old_leaf_count == 0 {
        mmr.append_hash(new_leaf_hash);
        return mmr.root();
    }

    // For non-empty case, we need the full MMR state
    // This function is primarily used by the SDK
    // On-chain, verify via witness proof instead
    let mut all_peaks: Vec<[u8; 32]> = old_peaks.to_vec();
    all_peaks.push(new_leaf_hash);
    vibeswap_mmr::compress_roots(&all_peaks)
}

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KnowledgeError {
    InvalidCellData,
    NonZeroGenesisCounter,
    NonZeroGenesisPrevHash,
    NonEmptyGenesisMMR,
    DifficultyBelowMinimum,
    EmptyKeyHash,
    EmptyValueHash,
    KeyHashChanged,
    InvalidPrevStateHash,
    NonMonotonicCounter,
    EmptyMMROnUpdate,
    MMRRootUnchanged,
    DifficultyAdjustmentTooLarge,
    TimestampDecreased,
    DestroyGenesisCell,
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;
    use vibeswap_types::KnowledgeCellData;

    fn make_genesis() -> KnowledgeCellData {
        KnowledgeCellData {
            key_hash: [0x01; 32],
            value_hash: [0xAA; 32],
            value_size: 256,
            prev_state_hash: [0u8; 32],
            mmr_root: [0u8; 32],
            update_count: 0,
            author_lock_hash: [0xFF; 32],
            timestamp_block: 100,
            difficulty: KNOWLEDGE_MIN_DIFFICULTY,
        }
    }

    fn make_update(old: &KnowledgeCellData, old_bytes: &[u8]) -> KnowledgeCellData {
        let prev_hash = sha256_hash(old_bytes);
        // Compute a new MMR root (append old state to fresh MMR)
        let mut mmr = vibeswap_mmr::MMR::new();
        mmr.append(old_bytes);
        let new_root = mmr.root();

        KnowledgeCellData {
            key_hash: old.key_hash,
            value_hash: [0xBB; 32],
            value_size: 512,
            prev_state_hash: prev_hash,
            mmr_root: new_root,
            update_count: old.update_count + 1,
            author_lock_hash: [0xEE; 32],
            timestamp_block: old.timestamp_block + 10,
            difficulty: old.difficulty,
        }
    }

    // ============ Creation Tests ============

    #[test]
    fn test_valid_creation() {
        let genesis = make_genesis();
        let bytes = genesis.serialize();
        assert!(verify_creation(&bytes).is_ok());
    }

    #[test]
    fn test_creation_nonzero_counter_fails() {
        let mut data = make_genesis();
        data.update_count = 1;
        let bytes = data.serialize();
        assert_eq!(verify_creation(&bytes), Err(KnowledgeError::NonZeroGenesisCounter));
    }

    #[test]
    fn test_creation_nonzero_prev_hash_fails() {
        let mut data = make_genesis();
        data.prev_state_hash = [0x01; 32];
        let bytes = data.serialize();
        assert_eq!(verify_creation(&bytes), Err(KnowledgeError::NonZeroGenesisPrevHash));
    }

    #[test]
    fn test_creation_nonempty_mmr_fails() {
        let mut data = make_genesis();
        data.mmr_root = [0x01; 32];
        let bytes = data.serialize();
        assert_eq!(verify_creation(&bytes), Err(KnowledgeError::NonEmptyGenesisMMR));
    }

    #[test]
    fn test_creation_low_difficulty_fails() {
        let mut data = make_genesis();
        data.difficulty = KNOWLEDGE_MIN_DIFFICULTY - 1;
        let bytes = data.serialize();
        assert_eq!(verify_creation(&bytes), Err(KnowledgeError::DifficultyBelowMinimum));
    }

    #[test]
    fn test_creation_empty_key_hash_fails() {
        let mut data = make_genesis();
        data.key_hash = [0u8; 32];
        let bytes = data.serialize();
        assert_eq!(verify_creation(&bytes), Err(KnowledgeError::EmptyKeyHash));
    }

    #[test]
    fn test_creation_empty_value_hash_fails() {
        let mut data = make_genesis();
        data.value_hash = [0u8; 32];
        let bytes = data.serialize();
        assert_eq!(verify_creation(&bytes), Err(KnowledgeError::EmptyValueHash));
    }

    #[test]
    fn test_creation_invalid_data_fails() {
        let short = [0u8; 50];
        assert_eq!(verify_creation(&short), Err(KnowledgeError::InvalidCellData));
    }

    // ============ Update Tests ============

    #[test]
    fn test_valid_update() {
        let old = make_genesis();
        let old_bytes = old.serialize();
        let new = make_update(&old, &old_bytes);
        let new_bytes = new.serialize();
        assert!(verify_update(&old_bytes, &new_bytes).is_ok());
    }

    #[test]
    fn test_update_key_hash_changed_fails() {
        let old = make_genesis();
        let old_bytes = old.serialize();
        let mut new = make_update(&old, &old_bytes);
        new.key_hash = [0x99; 32]; // Changed!
        let new_bytes = new.serialize();
        assert_eq!(verify_update(&old_bytes, &new_bytes), Err(KnowledgeError::KeyHashChanged));
    }

    #[test]
    fn test_update_invalid_prev_hash_fails() {
        let old = make_genesis();
        let old_bytes = old.serialize();
        let mut new = make_update(&old, &old_bytes);
        new.prev_state_hash = [0x00; 32]; // Wrong prev hash
        let new_bytes = new.serialize();
        assert_eq!(verify_update(&old_bytes, &new_bytes), Err(KnowledgeError::InvalidPrevStateHash));
    }

    #[test]
    fn test_update_non_monotonic_counter_fails() {
        let old = make_genesis();
        let old_bytes = old.serialize();
        let mut new = make_update(&old, &old_bytes);
        new.update_count = 0; // Not incremented
        let new_bytes = new.serialize();
        assert_eq!(verify_update(&old_bytes, &new_bytes), Err(KnowledgeError::NonMonotonicCounter));
    }

    #[test]
    fn test_update_counter_skip_fails() {
        let old = make_genesis();
        let old_bytes = old.serialize();
        let mut new = make_update(&old, &old_bytes);
        new.update_count = 5; // Skipped ahead
        let new_bytes = new.serialize();
        assert_eq!(verify_update(&old_bytes, &new_bytes), Err(KnowledgeError::NonMonotonicCounter));
    }

    #[test]
    fn test_update_empty_mmr_fails() {
        let old = make_genesis();
        let old_bytes = old.serialize();
        let mut new = make_update(&old, &old_bytes);
        new.mmr_root = [0u8; 32]; // Empty MMR on update
        let new_bytes = new.serialize();
        assert_eq!(verify_update(&old_bytes, &new_bytes), Err(KnowledgeError::EmptyMMROnUpdate));
    }

    #[test]
    fn test_update_difficulty_too_large_fails() {
        let old = make_genesis();
        let old_bytes = old.serialize();
        let mut new = make_update(&old, &old_bytes);
        new.difficulty = old.difficulty + 2; // Delta of 2, max is 1
        let new_bytes = new.serialize();
        assert_eq!(
            verify_update(&old_bytes, &new_bytes),
            Err(KnowledgeError::DifficultyAdjustmentTooLarge)
        );
    }

    #[test]
    fn test_update_difficulty_decrease_ok() {
        let mut old = make_genesis();
        old.difficulty = KNOWLEDGE_MIN_DIFFICULTY + 1; // Room to decrease
        let old_bytes = old.serialize();
        let mut new = make_update(&old, &old_bytes);
        new.difficulty = old.difficulty - 1; // Decrease by 1
        let new_bytes = new.serialize();
        assert!(verify_update(&old_bytes, &new_bytes).is_ok());
    }

    #[test]
    fn test_update_difficulty_increase_ok() {
        let old = make_genesis();
        let old_bytes = old.serialize();
        let mut new = make_update(&old, &old_bytes);
        new.difficulty = old.difficulty + 1; // Increase by 1
        let new_bytes = new.serialize();
        assert!(verify_update(&old_bytes, &new_bytes).is_ok());
    }

    #[test]
    fn test_update_difficulty_below_min_fails() {
        let mut old = make_genesis();
        old.difficulty = KNOWLEDGE_MIN_DIFFICULTY;
        let old_bytes = old.serialize();
        let mut new = make_update(&old, &old_bytes);
        new.difficulty = KNOWLEDGE_MIN_DIFFICULTY - 1; // Below min
        let new_bytes = new.serialize();
        assert_eq!(
            verify_update(&old_bytes, &new_bytes),
            Err(KnowledgeError::DifficultyBelowMinimum)
        );
    }

    #[test]
    fn test_update_timestamp_decrease_fails() {
        let old = make_genesis();
        let old_bytes = old.serialize();
        let mut new = make_update(&old, &old_bytes);
        new.timestamp_block = old.timestamp_block - 1; // Went backwards
        let new_bytes = new.serialize();
        assert_eq!(
            verify_update(&old_bytes, &new_bytes),
            Err(KnowledgeError::TimestampDecreased)
        );
    }

    #[test]
    fn test_update_empty_value_hash_fails() {
        let old = make_genesis();
        let old_bytes = old.serialize();
        let mut new = make_update(&old, &old_bytes);
        new.value_hash = [0u8; 32];
        let new_bytes = new.serialize();
        assert_eq!(
            verify_update(&old_bytes, &new_bytes),
            Err(KnowledgeError::EmptyValueHash)
        );
    }

    // ============ Destruction Tests ============

    #[test]
    fn test_destroy_with_history_ok() {
        let mut data = make_genesis();
        data.update_count = 5; // Has history
        let bytes = data.serialize();
        assert!(verify_destruction(&bytes).is_ok());
    }

    #[test]
    fn test_destroy_genesis_fails() {
        let data = make_genesis();
        let bytes = data.serialize();
        assert_eq!(verify_destruction(&bytes), Err(KnowledgeError::DestroyGenesisCell));
    }

    #[test]
    fn test_destroy_invalid_data_fails() {
        let short = [0u8; 50];
        assert_eq!(verify_destruction(&short), Err(KnowledgeError::InvalidCellData));
    }

    // ============ Header Chain Continuity Tests ============

    #[test]
    fn test_header_chain_three_updates() {
        // Genesis
        let genesis = make_genesis();
        let genesis_bytes = genesis.serialize();
        assert!(verify_creation(&genesis_bytes).is_ok());

        // Update 1
        let update1 = make_update(&genesis, &genesis_bytes);
        let update1_bytes = update1.serialize();
        assert!(verify_update(&genesis_bytes, &update1_bytes).is_ok());

        // Update 2
        let update2 = make_update(&update1, &update1_bytes);
        let update2_bytes = update2.serialize();
        assert!(verify_update(&update1_bytes, &update2_bytes).is_ok());

        // Verify chain: update2.prev_state_hash == SHA-256(update1_bytes)
        let expected_prev = sha256_hash(&update1_bytes);
        assert_eq!(update2.prev_state_hash, expected_prev);

        // Verify counters are sequential
        assert_eq!(genesis.update_count, 0);
        assert_eq!(update1.update_count, 1);
        assert_eq!(update2.update_count, 2);
    }

    // ============ MMR Root Tests ============

    #[test]
    fn test_mmr_root_changes_each_update() {
        let genesis = make_genesis();
        let genesis_bytes = genesis.serialize();

        let update1 = make_update(&genesis, &genesis_bytes);
        let update1_bytes = update1.serialize();

        let update2 = make_update(&update1, &update1_bytes);

        // Each update produces a different MMR root
        assert_ne!(genesis.mmr_root, update1.mmr_root);
        assert_ne!(update1.mmr_root, update2.mmr_root);
    }

    #[test]
    fn test_compute_new_mmr_root_genesis() {
        let state_data = [0x42; 64];
        let root = compute_new_mmr_root(&[], 0, &state_data);
        assert_ne!(root, [0u8; 32]); // Non-empty result
    }

    // ============ Difficulty Boundary Tests ============

    #[test]
    fn test_difficulty_same_as_old_ok() {
        let old = make_genesis();
        let old_bytes = old.serialize();
        let new = make_update(&old, &old_bytes);
        // difficulty unchanged = delta 0
        let new_bytes = new.serialize();
        assert!(verify_update(&old_bytes, &new_bytes).is_ok());
    }

    #[test]
    fn test_max_difficulty_no_overflow() {
        let mut old = make_genesis();
        old.difficulty = 255; // Max u8
        let old_bytes = old.serialize();
        let mut new = make_update(&old, &old_bytes);
        new.difficulty = 255; // Same, delta 0
        let new_bytes = new.serialize();
        assert!(verify_update(&old_bytes, &new_bytes).is_ok());
    }
}
