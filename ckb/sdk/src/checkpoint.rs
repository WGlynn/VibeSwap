// ============ Checkpoint Module ============
// Protocol Checkpoints — periodic state commitments that enable fast sync,
// state verification, and rollback capabilities. On CKB's UTXO model,
// checkpoints capture the set of live cells representing protocol state.

use sha2::{Digest, Sha256};

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum CheckpointError {
    NotFound,
    AlreadyFinalized,
    NotFinalized,
    InvalidStateRoot,
    HeightMismatch,
    ChainBroken,
    InsufficientVerifiers,
    DuplicateEntry,
    EmptyCheckpoint,
    CapacityMismatch,
    InvalidSequence,
    ArchiveError,
    RollbackFailed,
    EntryNotFound,
    Overflow,
}

// ============ Data Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum CheckpointStatus {
    Pending,
    Finalized,
    Verified,
    Archived,
    Invalid,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StateEntry {
    pub cell_id: [u8; 32],
    pub cell_type: u32,
    pub data_hash: [u8; 32],
    pub capacity: u64,
    pub owner: [u8; 32],
}

#[derive(Debug, Clone, PartialEq)]
pub struct Checkpoint {
    pub checkpoint_id: u64,
    pub block_height: u64,
    pub timestamp: u64,
    pub state_root: [u8; 32],
    pub entries: Vec<StateEntry>,
    pub entry_count: u64,
    pub total_capacity: u128,
    pub status: CheckpointStatus,
    pub prev_checkpoint_id: Option<u64>,
    pub verifier_count: u32,
    pub created_by: [u8; 32],
}

#[derive(Debug, Clone)]
pub struct CheckpointChain {
    pub checkpoints: Vec<Checkpoint>,
    pub latest_finalized: Option<u64>,
    pub interval_blocks: u64,
    pub min_verifiers: u32,
    pub retention_count: u64,
    pub auto_archive_after: u64,
}

#[derive(Debug, Clone)]
pub struct CheckpointDiff {
    pub from_id: u64,
    pub to_id: u64,
    pub added_cells: Vec<StateEntry>,
    pub removed_cells: Vec<[u8; 32]>,
    pub modified_cells: Vec<(StateEntry, StateEntry)>,
    pub capacity_change: i128,
}

#[derive(Debug, Clone)]
pub struct VerificationResult {
    pub checkpoint_id: u64,
    pub is_valid: bool,
    pub root_matches: bool,
    pub entry_count_matches: bool,
    pub capacity_matches: bool,
    pub errors: Vec<String>,
}

// ============ Chain Management ============

/// Create a new checkpoint chain with the given parameters.
pub fn create_chain(
    interval_blocks: u64,
    min_verifiers: u32,
    retention_count: u64,
    auto_archive_after: u64,
) -> CheckpointChain {
    CheckpointChain {
        checkpoints: Vec::new(),
        latest_finalized: None,
        interval_blocks,
        min_verifiers,
        retention_count,
        auto_archive_after,
    }
}

/// Create a chain with default parameters: interval=1000, min_verifiers=3, retention=100, archive_after=10000.
pub fn default_chain() -> CheckpointChain {
    create_chain(1000, 3, 100, 10000)
}

// ============ Checkpoint Creation ============

/// Create a new pending checkpoint at the given block height.
pub fn create_checkpoint(
    chain: &mut CheckpointChain,
    block_height: u64,
    timestamp: u64,
    creator: [u8; 32],
) -> Result<u64, CheckpointError> {
    let id = chain.checkpoints.len() as u64;
    let prev = if chain.checkpoints.is_empty() {
        None
    } else {
        Some(id - 1)
    };
    let cp = Checkpoint {
        checkpoint_id: id,
        block_height,
        timestamp,
        state_root: [0u8; 32],
        entries: Vec::new(),
        entry_count: 0,
        total_capacity: 0,
        status: CheckpointStatus::Pending,
        prev_checkpoint_id: prev,
        verifier_count: 0,
        created_by: creator,
    };
    chain.checkpoints.push(cp);
    Ok(id)
}

/// Add a single state entry to a pending checkpoint. Rejects duplicates by cell_id.
pub fn add_entry(
    chain: &mut CheckpointChain,
    checkpoint_id: u64,
    entry: StateEntry,
) -> Result<(), CheckpointError> {
    let cp = chain
        .checkpoints
        .iter_mut()
        .find(|c| c.checkpoint_id == checkpoint_id)
        .ok_or(CheckpointError::NotFound)?;
    if cp.status != CheckpointStatus::Pending {
        return Err(CheckpointError::AlreadyFinalized);
    }
    for existing in &cp.entries {
        if existing.cell_id == entry.cell_id {
            return Err(CheckpointError::DuplicateEntry);
        }
    }
    cp.total_capacity = cp
        .total_capacity
        .checked_add(entry.capacity as u128)
        .ok_or(CheckpointError::Overflow)?;
    cp.entries.push(entry);
    cp.entry_count = cp.entries.len() as u64;
    Ok(())
}

/// Add multiple state entries to a pending checkpoint. Returns count added.
pub fn add_entries(
    chain: &mut CheckpointChain,
    checkpoint_id: u64,
    entries: Vec<StateEntry>,
) -> Result<usize, CheckpointError> {
    let count = entries.len();
    for entry in entries {
        add_entry(chain, checkpoint_id, entry)?;
    }
    Ok(count)
}

/// Finalize a pending checkpoint: compute state root, set status to Finalized.
pub fn finalize_checkpoint(
    chain: &mut CheckpointChain,
    checkpoint_id: u64,
) -> Result<(), CheckpointError> {
    let cp = chain
        .checkpoints
        .iter_mut()
        .find(|c| c.checkpoint_id == checkpoint_id)
        .ok_or(CheckpointError::NotFound)?;
    if cp.status != CheckpointStatus::Pending {
        return Err(CheckpointError::AlreadyFinalized);
    }
    if cp.entries.is_empty() {
        return Err(CheckpointError::EmptyCheckpoint);
    }
    cp.state_root = compute_state_root(&cp.entries);
    cp.status = CheckpointStatus::Finalized;
    chain.latest_finalized = Some(checkpoint_id);
    Ok(())
}

/// Create a checkpoint, add entries, and finalize in one call.
pub fn from_entries(
    chain: &mut CheckpointChain,
    height: u64,
    ts: u64,
    creator: [u8; 32],
    entries: Vec<StateEntry>,
) -> Result<u64, CheckpointError> {
    if entries.is_empty() {
        return Err(CheckpointError::EmptyCheckpoint);
    }
    // Check for duplicate cell_ids
    for i in 0..entries.len() {
        for j in (i + 1)..entries.len() {
            if entries[i].cell_id == entries[j].cell_id {
                return Err(CheckpointError::DuplicateEntry);
            }
        }
    }
    let id = create_checkpoint(chain, height, ts, creator)?;
    add_entries(chain, id, entries)?;
    finalize_checkpoint(chain, id)?;
    Ok(id)
}

// ============ State Root Computation ============

/// Compute the SHA-256 hash of a single state entry.
pub fn compute_entry_hash(entry: &StateEntry) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(entry.cell_id);
    hasher.update(entry.cell_type.to_le_bytes());
    hasher.update(entry.data_hash);
    hasher.update(entry.capacity.to_le_bytes());
    hasher.update(entry.owner);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

/// Compute the Merkle root over a slice of state entries.
pub fn compute_state_root(entries: &[StateEntry]) -> [u8; 32] {
    if entries.is_empty() {
        return [0u8; 32];
    }
    let leaves: Vec<[u8; 32]> = entries.iter().map(|e| compute_entry_hash(e)).collect();
    compute_merkle_root(&leaves)
}

/// Internal Merkle root computation over leaf hashes.
fn compute_merkle_root(leaves: &[[u8; 32]]) -> [u8; 32] {
    if leaves.is_empty() {
        return [0u8; 32];
    }
    if leaves.len() == 1 {
        return leaves[0];
    }
    let mut current_level: Vec<[u8; 32]> = leaves.to_vec();
    while current_level.len() > 1 {
        let mut next_level = Vec::new();
        let mut i = 0;
        while i < current_level.len() {
            let left = current_level[i];
            let right = if i + 1 < current_level.len() {
                current_level[i + 1]
            } else {
                current_level[i]
            };
            let mut hasher = Sha256::new();
            hasher.update(left);
            hasher.update(right);
            let result = hasher.finalize();
            let mut hash = [0u8; 32];
            hash.copy_from_slice(&result);
            next_level.push(hash);
            i += 2;
        }
        current_level = next_level;
    }
    current_level[0]
}

/// Check whether the checkpoint's stored state_root matches its entries.
pub fn verify_state_root(checkpoint: &Checkpoint) -> bool {
    if checkpoint.entries.is_empty() {
        return checkpoint.state_root == [0u8; 32];
    }
    let computed = compute_state_root(&checkpoint.entries);
    computed == checkpoint.state_root
}

/// Generate a Merkle inclusion proof for a cell_id within a checkpoint.
pub fn generate_inclusion_proof(
    checkpoint: &Checkpoint,
    cell_id: &[u8; 32],
) -> Result<Vec<[u8; 32]>, CheckpointError> {
    let idx = checkpoint
        .entries
        .iter()
        .position(|e| &e.cell_id == cell_id)
        .ok_or(CheckpointError::EntryNotFound)?;

    let leaves: Vec<[u8; 32]> = checkpoint
        .entries
        .iter()
        .map(|e| compute_entry_hash(e))
        .collect();

    let mut proof = Vec::new();
    let mut current_level = leaves;
    let mut current_idx = idx;

    while current_level.len() > 1 {
        let sibling_idx = if current_idx % 2 == 1 {
            current_idx - 1
        } else if current_idx + 1 < current_level.len() {
            current_idx + 1
        } else {
            current_idx
        };
        proof.push(current_level[sibling_idx]);

        let mut next_level = Vec::new();
        let mut i = 0;
        while i < current_level.len() {
            let left = current_level[i];
            let right = if i + 1 < current_level.len() {
                current_level[i + 1]
            } else {
                current_level[i]
            };
            let mut hasher = Sha256::new();
            hasher.update(left);
            hasher.update(right);
            let result = hasher.finalize();
            let mut hash = [0u8; 32];
            hash.copy_from_slice(&result);
            next_level.push(hash);
            i += 2;
        }
        current_level = next_level;
        current_idx /= 2;
    }
    Ok(proof)
}

/// Verify that a cell_hash is included in a Merkle root using the given proof.
pub fn verify_inclusion(
    root: &[u8; 32],
    cell_hash: [u8; 32],
    proof: &[[u8; 32]],
    index: usize,
) -> bool {
    let mut current = cell_hash;
    let mut idx = index;
    for sibling in proof {
        let mut hasher = Sha256::new();
        if idx % 2 == 1 {
            hasher.update(sibling);
            hasher.update(current);
        } else {
            hasher.update(current);
            hasher.update(sibling);
        }
        let result = hasher.finalize();
        current = [0u8; 32];
        current.copy_from_slice(&result);
        idx /= 2;
    }
    current == *root
}

// ============ Verification ============

/// Verify a checkpoint's internal consistency.
pub fn verify_checkpoint(checkpoint: &Checkpoint) -> VerificationResult {
    let mut errors = Vec::new();

    let root_matches = verify_state_root(checkpoint);
    if !root_matches {
        errors.push("State root does not match entries".to_string());
    }

    let entry_count_matches = checkpoint.entry_count == checkpoint.entries.len() as u64;
    if !entry_count_matches {
        errors.push(format!(
            "Entry count mismatch: stored={} actual={}",
            checkpoint.entry_count,
            checkpoint.entries.len()
        ));
    }

    let actual_capacity: u128 = checkpoint.entries.iter().map(|e| e.capacity as u128).sum();
    let capacity_matches = checkpoint.total_capacity == actual_capacity;
    if !capacity_matches {
        errors.push(format!(
            "Capacity mismatch: stored={} actual={}",
            checkpoint.total_capacity, actual_capacity
        ));
    }

    let is_valid = root_matches && entry_count_matches && capacity_matches;

    VerificationResult {
        checkpoint_id: checkpoint.checkpoint_id,
        is_valid,
        root_matches,
        entry_count_matches,
        capacity_matches,
        errors,
    }
}

/// Add a verification to a finalized checkpoint. Returns new verifier count.
pub fn add_verification(
    chain: &mut CheckpointChain,
    checkpoint_id: u64,
) -> Result<u32, CheckpointError> {
    let cp = chain
        .checkpoints
        .iter_mut()
        .find(|c| c.checkpoint_id == checkpoint_id)
        .ok_or(CheckpointError::NotFound)?;
    if cp.status == CheckpointStatus::Pending {
        return Err(CheckpointError::NotFinalized);
    }
    if cp.status == CheckpointStatus::Invalid {
        return Err(CheckpointError::InvalidStateRoot);
    }
    cp.verifier_count += 1;
    Ok(cp.verifier_count)
}

/// Check if a checkpoint has enough verifiers.
pub fn is_fully_verified(chain: &CheckpointChain, checkpoint_id: u64) -> bool {
    chain
        .checkpoints
        .iter()
        .find(|c| c.checkpoint_id == checkpoint_id)
        .map(|cp| cp.verifier_count >= chain.min_verifiers)
        .unwrap_or(false)
}

/// Mark a checkpoint as Verified (requires finalized + enough verifiers).
pub fn mark_verified(
    chain: &mut CheckpointChain,
    checkpoint_id: u64,
) -> Result<(), CheckpointError> {
    let min_v = chain.min_verifiers;
    let cp = chain
        .checkpoints
        .iter_mut()
        .find(|c| c.checkpoint_id == checkpoint_id)
        .ok_or(CheckpointError::NotFound)?;
    if cp.status == CheckpointStatus::Pending {
        return Err(CheckpointError::NotFinalized);
    }
    if cp.verifier_count < min_v {
        return Err(CheckpointError::InsufficientVerifiers);
    }
    cp.status = CheckpointStatus::Verified;
    Ok(())
}

/// Mark a checkpoint as Invalid.
pub fn mark_invalid(
    chain: &mut CheckpointChain,
    checkpoint_id: u64,
) -> Result<(), CheckpointError> {
    let cp = chain
        .checkpoints
        .iter_mut()
        .find(|c| c.checkpoint_id == checkpoint_id)
        .ok_or(CheckpointError::NotFound)?;
    cp.status = CheckpointStatus::Invalid;
    Ok(())
}

// ============ Queries ============

/// Get a checkpoint by ID.
pub fn get_checkpoint(chain: &CheckpointChain, checkpoint_id: u64) -> Option<&Checkpoint> {
    chain
        .checkpoints
        .iter()
        .find(|c| c.checkpoint_id == checkpoint_id)
}

/// Get the most recently added checkpoint.
pub fn latest_checkpoint(chain: &CheckpointChain) -> Option<&Checkpoint> {
    chain.checkpoints.last()
}

/// Get the most recently finalized checkpoint.
pub fn latest_finalized(chain: &CheckpointChain) -> Option<&Checkpoint> {
    chain.latest_finalized.and_then(|id| {
        chain
            .checkpoints
            .iter()
            .find(|c| c.checkpoint_id == id)
    })
}

/// Find a checkpoint at the exact block height.
pub fn checkpoint_at_height(chain: &CheckpointChain, height: u64) -> Option<&Checkpoint> {
    chain
        .checkpoints
        .iter()
        .find(|c| c.block_height == height)
}

/// Find the nearest checkpoint at or below the given height.
pub fn nearest_checkpoint(chain: &CheckpointChain, height: u64) -> Option<&Checkpoint> {
    chain
        .checkpoints
        .iter()
        .filter(|c| c.block_height <= height)
        .max_by_key(|c| c.block_height)
}

/// Get all checkpoints within a block height range (inclusive).
pub fn checkpoints_in_range<'a>(
    chain: &'a CheckpointChain,
    start_height: u64,
    end_height: u64,
) -> Vec<&'a Checkpoint> {
    chain
        .checkpoints
        .iter()
        .filter(|c| c.block_height >= start_height && c.block_height <= end_height)
        .collect()
}

// ============ Diffing ============

/// Compute the diff between two checkpoints.
pub fn diff_checkpoints(old: &Checkpoint, new: &Checkpoint) -> CheckpointDiff {
    let old_ids: Vec<[u8; 32]> = old.entries.iter().map(|e| e.cell_id).collect();
    let new_ids: Vec<[u8; 32]> = new.entries.iter().map(|e| e.cell_id).collect();

    let added_cells: Vec<StateEntry> = new
        .entries
        .iter()
        .filter(|e| !old_ids.contains(&e.cell_id))
        .cloned()
        .collect();

    let removed_cells: Vec<[u8; 32]> = old_ids
        .iter()
        .filter(|id| !new_ids.contains(id))
        .copied()
        .collect();

    let mut modified_cells = Vec::new();
    for new_entry in &new.entries {
        if let Some(old_entry) = old.entries.iter().find(|e| e.cell_id == new_entry.cell_id) {
            if old_entry.data_hash != new_entry.data_hash
                || old_entry.capacity != new_entry.capacity
                || old_entry.owner != new_entry.owner
                || old_entry.cell_type != new_entry.cell_type
            {
                modified_cells.push((old_entry.clone(), new_entry.clone()));
            }
        }
    }

    let capacity_change = new.total_capacity as i128 - old.total_capacity as i128;

    CheckpointDiff {
        from_id: old.checkpoint_id,
        to_id: new.checkpoint_id,
        added_cells,
        removed_cells,
        modified_cells,
        capacity_change,
    }
}

/// Count of (added, removed, modified) entries in a diff.
pub fn diff_entry_count(diff: &CheckpointDiff) -> (usize, usize, usize) {
    (
        diff.added_cells.len(),
        diff.removed_cells.len(),
        diff.modified_cells.len(),
    )
}

/// Apply a diff to a base checkpoint's entries to reconstruct the new state.
pub fn apply_diff(
    base: &Checkpoint,
    diff: &CheckpointDiff,
) -> Result<Vec<StateEntry>, CheckpointError> {
    // Start with base entries, remove removed cells
    let mut result: Vec<StateEntry> = base
        .entries
        .iter()
        .filter(|e| !diff.removed_cells.contains(&e.cell_id))
        .cloned()
        .collect();

    // Apply modifications
    for (old_entry, new_entry) in &diff.modified_cells {
        if let Some(existing) = result.iter_mut().find(|e| e.cell_id == old_entry.cell_id) {
            *existing = new_entry.clone();
        }
    }

    // Add new cells
    for entry in &diff.added_cells {
        result.push(entry.clone());
    }

    Ok(result)
}

// ============ Rollback ============

/// Check if rollback to a checkpoint is possible (exists and Finalized or Verified).
pub fn can_rollback_to(chain: &CheckpointChain, checkpoint_id: u64) -> bool {
    chain
        .checkpoints
        .iter()
        .find(|c| c.checkpoint_id == checkpoint_id)
        .map(|cp| {
            cp.status == CheckpointStatus::Finalized || cp.status == CheckpointStatus::Verified
        })
        .unwrap_or(false)
}

/// Remove all checkpoints after the given checkpoint_id. Returns removed checkpoints.
pub fn rollback_to(
    chain: &mut CheckpointChain,
    checkpoint_id: u64,
) -> Result<Vec<Checkpoint>, CheckpointError> {
    if !can_rollback_to(chain, checkpoint_id) {
        return Err(CheckpointError::RollbackFailed);
    }
    let removed: Vec<Checkpoint> = chain
        .checkpoints
        .iter()
        .filter(|c| c.checkpoint_id > checkpoint_id)
        .cloned()
        .collect();
    chain.checkpoints.retain(|c| c.checkpoint_id <= checkpoint_id);

    // Update latest_finalized
    chain.latest_finalized = chain
        .checkpoints
        .iter()
        .rev()
        .find(|c| {
            c.status == CheckpointStatus::Finalized || c.status == CheckpointStatus::Verified
        })
        .map(|c| c.checkpoint_id);

    Ok(removed)
}

/// Extract entries from a checkpoint for state restoration.
pub fn rollback_state(checkpoint: &Checkpoint) -> Vec<StateEntry> {
    checkpoint.entries.clone()
}

// ============ Archival ============

/// Archive checkpoints older than `auto_archive_after` blocks from current height.
/// Only archives Finalized or Verified checkpoints. Returns count archived.
pub fn archive_old(chain: &mut CheckpointChain, current_height: u64) -> usize {
    let threshold = current_height.saturating_sub(chain.auto_archive_after);
    let mut count = 0;
    for cp in &mut chain.checkpoints {
        if cp.block_height < threshold
            && (cp.status == CheckpointStatus::Finalized
                || cp.status == CheckpointStatus::Verified)
        {
            cp.status = CheckpointStatus::Archived;
            count += 1;
        }
    }
    count
}

/// Remove archived checkpoints beyond the retention count. Returns count pruned.
pub fn prune_archived(chain: &mut CheckpointChain) -> usize {
    let archived: Vec<u64> = chain
        .checkpoints
        .iter()
        .filter(|c| c.status == CheckpointStatus::Archived)
        .map(|c| c.checkpoint_id)
        .collect();

    if archived.len() as u64 <= chain.retention_count {
        return 0;
    }
    let to_remove = archived.len() as u64 - chain.retention_count;
    let remove_ids: Vec<u64> = archived.into_iter().take(to_remove as usize).collect();
    let before = chain.checkpoints.len();
    chain.checkpoints.retain(|c| !remove_ids.contains(&c.checkpoint_id));
    before - chain.checkpoints.len()
}

/// Count of archived checkpoints.
pub fn archived_count(chain: &CheckpointChain) -> usize {
    chain
        .checkpoints
        .iter()
        .filter(|c| c.status == CheckpointStatus::Archived)
        .count()
}

/// Whether it's time for a new checkpoint based on interval and latest height.
pub fn should_checkpoint(chain: &CheckpointChain, current_height: u64) -> bool {
    if chain.interval_blocks == 0 {
        return false;
    }
    match chain.checkpoints.last() {
        Some(cp) => current_height >= cp.block_height + chain.interval_blocks,
        None => true,
    }
}

// ============ Analytics ============

/// Chain health score 0-10000 based on coverage, verification, and gaps.
pub fn chain_health(chain: &CheckpointChain) -> u64 {
    if chain.checkpoints.is_empty() {
        return 0;
    }

    let total = chain.checkpoints.len() as u64;
    let finalized = chain
        .checkpoints
        .iter()
        .filter(|c| {
            c.status == CheckpointStatus::Finalized
                || c.status == CheckpointStatus::Verified
                || c.status == CheckpointStatus::Archived
        })
        .count() as u64;
    let verified = chain
        .checkpoints
        .iter()
        .filter(|c| c.status == CheckpointStatus::Verified)
        .count() as u64;
    let invalid = chain
        .checkpoints
        .iter()
        .filter(|c| c.status == CheckpointStatus::Invalid)
        .count() as u64;

    // Finalization rate: 40% weight
    let finalization_score = if total > 0 {
        (finalized * 4000) / total
    } else {
        0
    };

    // Verification rate: 30% weight
    let verification_score = if finalized > 0 {
        (verified * 3000) / finalized
    } else {
        0
    };

    // Invalidity penalty: 20% weight (inverted)
    let invalidity_score = if total > 0 {
        let invalid_rate = (invalid * 2000) / total;
        2000u64.saturating_sub(invalid_rate)
    } else {
        2000
    };

    // Gap penalty: 10% weight
    let gaps = gap_count(chain);
    let gap_score = if chain.checkpoints.len() > 1 {
        let max_gaps = chain.checkpoints.len() - 1;
        let gap_rate = if max_gaps > 0 {
            (gaps as u64 * 1000) / max_gaps as u64
        } else {
            0
        };
        1000u64.saturating_sub(gap_rate)
    } else {
        1000
    };

    finalization_score + verification_score + invalidity_score + gap_score
}

/// What percentage (in bps) of a height range has checkpoint coverage.
pub fn coverage_bps(chain: &CheckpointChain, start: u64, end: u64) -> u64 {
    if end <= start {
        return 0;
    }
    let range = end - start;
    let covered = chain
        .checkpoints
        .iter()
        .filter(|c| c.block_height >= start && c.block_height <= end)
        .count() as u64;
    let expected = range / chain.interval_blocks.max(1) + 1;
    if expected == 0 {
        return 0;
    }
    let ratio = (covered * 10000) / expected;
    ratio.min(10000)
}

/// Average number of entries per checkpoint.
pub fn avg_entries_per_checkpoint(chain: &CheckpointChain) -> u64 {
    if chain.checkpoints.is_empty() {
        return 0;
    }
    let total_entries: u64 = chain.checkpoints.iter().map(|c| c.entry_count).sum();
    total_entries / chain.checkpoints.len() as u64
}

/// Total capacity tracked across all non-archived checkpoints.
pub fn total_capacity_tracked(chain: &CheckpointChain) -> u128 {
    chain
        .checkpoints
        .iter()
        .filter(|c| c.status != CheckpointStatus::Archived)
        .map(|c| c.total_capacity)
        .sum()
}

/// Verification rate in bps: verified / finalized * 10000.
pub fn verification_rate(chain: &CheckpointChain) -> u64 {
    let finalized = chain
        .checkpoints
        .iter()
        .filter(|c| {
            c.status == CheckpointStatus::Finalized
                || c.status == CheckpointStatus::Verified
        })
        .count() as u64;
    let verified = chain
        .checkpoints
        .iter()
        .filter(|c| c.status == CheckpointStatus::Verified)
        .count() as u64;
    if finalized == 0 {
        return 0;
    }
    (verified * 10000) / finalized
}

/// Count of missed checkpoint intervals (gaps).
pub fn gap_count(chain: &CheckpointChain) -> usize {
    if chain.checkpoints.len() < 2 || chain.interval_blocks == 0 {
        return 0;
    }
    let mut sorted_heights: Vec<u64> = chain.checkpoints.iter().map(|c| c.block_height).collect();
    sorted_heights.sort();
    let mut gaps = 0;
    for window in sorted_heights.windows(2) {
        let diff = window[1] - window[0];
        if diff > chain.interval_blocks {
            // Count how many intervals were missed
            gaps += (diff / chain.interval_blocks) as usize - 1;
        }
    }
    gaps
}

// ============ Validation ============

/// Validate the entire chain, returning all errors found.
pub fn validate_chain(chain: &CheckpointChain) -> Vec<CheckpointError> {
    let mut errors = Vec::new();

    // Check sequence
    for (i, cp) in chain.checkpoints.iter().enumerate() {
        if i > 0 {
            let prev = &chain.checkpoints[i - 1];
            if cp.block_height < prev.block_height {
                errors.push(CheckpointError::InvalidSequence);
            }
            if cp.prev_checkpoint_id != Some(prev.checkpoint_id) {
                errors.push(CheckpointError::ChainBroken);
            }
        }
        // Verify entries consistency
        if cp.entry_count != cp.entries.len() as u64 {
            errors.push(CheckpointError::CapacityMismatch);
        }
        let actual_cap: u128 = cp.entries.iter().map(|e| e.capacity as u128).sum();
        if cp.total_capacity != actual_cap {
            errors.push(CheckpointError::CapacityMismatch);
        }
        // Verify state root for finalized/verified
        if (cp.status == CheckpointStatus::Finalized || cp.status == CheckpointStatus::Verified)
            && !verify_state_root(cp)
        {
            errors.push(CheckpointError::InvalidStateRoot);
        }
    }

    errors
}

/// Check if checkpoint heights form a contiguous sequence (no missed intervals).
pub fn is_contiguous(chain: &CheckpointChain) -> bool {
    gap_count(chain) == 0
}

/// Validate a single state entry (all fields non-zero).
pub fn validate_entry(entry: &StateEntry) -> bool {
    entry.cell_id != [0u8; 32]
        && entry.data_hash != [0u8; 32]
        && entry.capacity > 0
        && entry.owner != [0u8; 32]
}

// ============ Utilities ============

/// Count of checkpoints in the chain.
pub fn checkpoint_count(chain: &CheckpointChain) -> usize {
    chain.checkpoints.len()
}

/// The next expected checkpoint height based on the interval.
pub fn next_checkpoint_height(chain: &CheckpointChain) -> u64 {
    match chain.checkpoints.last() {
        Some(cp) => cp.block_height + chain.interval_blocks,
        None => chain.interval_blocks,
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn creator(n: u8) -> [u8; 32] {
        let mut c = [0u8; 32];
        c[0] = n;
        c
    }

    fn cell_id(n: u8) -> [u8; 32] {
        let mut id = [0u8; 32];
        id[0] = n;
        id
    }

    fn data_hash(n: u8) -> [u8; 32] {
        let mut h = [0u8; 32];
        h[31] = n;
        h
    }

    fn owner(n: u8) -> [u8; 32] {
        let mut o = [0u8; 32];
        o[1] = n;
        o
    }

    fn make_entry(n: u8, capacity: u64) -> StateEntry {
        StateEntry {
            cell_id: cell_id(n),
            cell_type: n as u32,
            data_hash: data_hash(n),
            capacity,
            owner: owner(n),
        }
    }

    fn make_entry_with_owner(n: u8, capacity: u64, own: u8) -> StateEntry {
        StateEntry {
            cell_id: cell_id(n),
            cell_type: n as u32,
            data_hash: data_hash(n),
            capacity,
            owner: owner(own),
        }
    }

    fn make_finalized_chain(entries_per_cp: &[(u64, Vec<StateEntry>)]) -> CheckpointChain {
        let mut chain = default_chain();
        for (height, entries) in entries_per_cp {
            from_entries(&mut chain, *height, *height * 10, creator(1), entries.clone()).unwrap();
        }
        chain
    }

    fn make_simple_chain(count: usize) -> CheckpointChain {
        let mut chain = create_chain(1000, 3, 100, 10000);
        for i in 0..count {
            let height = (i as u64 + 1) * 1000;
            let entries = vec![make_entry((i + 1) as u8, 1000)];
            from_entries(&mut chain, height, height * 10, creator(1), entries).unwrap();
        }
        chain
    }

    // ============ Chain Management Tests ============

    #[test]
    fn test_create_chain() {
        let chain = create_chain(500, 5, 50, 5000);
        assert_eq!(chain.interval_blocks, 500);
        assert_eq!(chain.min_verifiers, 5);
        assert_eq!(chain.retention_count, 50);
        assert_eq!(chain.auto_archive_after, 5000);
        assert!(chain.checkpoints.is_empty());
        assert_eq!(chain.latest_finalized, None);
    }

    #[test]
    fn test_default_chain() {
        let chain = default_chain();
        assert_eq!(chain.interval_blocks, 1000);
        assert_eq!(chain.min_verifiers, 3);
        assert_eq!(chain.retention_count, 100);
        assert_eq!(chain.auto_archive_after, 10000);
    }

    #[test]
    fn test_create_chain_zero_interval() {
        let chain = create_chain(0, 1, 10, 100);
        assert_eq!(chain.interval_blocks, 0);
    }

    #[test]
    fn test_create_chain_large_values() {
        let chain = create_chain(u64::MAX, u32::MAX, u64::MAX, u64::MAX);
        assert_eq!(chain.interval_blocks, u64::MAX);
        assert_eq!(chain.min_verifiers, u32::MAX);
    }

    // ============ Checkpoint Creation Tests ============

    #[test]
    fn test_create_checkpoint() {
        let mut chain = default_chain();
        let id = create_checkpoint(&mut chain, 1000, 10000, creator(1)).unwrap();
        assert_eq!(id, 0);
        assert_eq!(chain.checkpoints.len(), 1);
        assert_eq!(chain.checkpoints[0].status, CheckpointStatus::Pending);
        assert_eq!(chain.checkpoints[0].block_height, 1000);
        assert_eq!(chain.checkpoints[0].prev_checkpoint_id, None);
    }

    #[test]
    fn test_create_multiple_checkpoints() {
        let mut chain = default_chain();
        let id0 = create_checkpoint(&mut chain, 1000, 10000, creator(1)).unwrap();
        let id1 = create_checkpoint(&mut chain, 2000, 20000, creator(2)).unwrap();
        assert_eq!(id0, 0);
        assert_eq!(id1, 1);
        assert_eq!(chain.checkpoints[1].prev_checkpoint_id, Some(0));
    }

    #[test]
    fn test_create_checkpoint_preserves_creator() {
        let mut chain = default_chain();
        let c = creator(42);
        create_checkpoint(&mut chain, 1000, 10000, c).unwrap();
        assert_eq!(chain.checkpoints[0].created_by, c);
    }

    #[test]
    fn test_add_entry() {
        let mut chain = default_chain();
        create_checkpoint(&mut chain, 1000, 10000, creator(1)).unwrap();
        add_entry(&mut chain, 0, make_entry(1, 500)).unwrap();
        assert_eq!(chain.checkpoints[0].entries.len(), 1);
        assert_eq!(chain.checkpoints[0].entry_count, 1);
        assert_eq!(chain.checkpoints[0].total_capacity, 500);
    }

    #[test]
    fn test_add_entry_not_found() {
        let mut chain = default_chain();
        let result = add_entry(&mut chain, 99, make_entry(1, 500));
        assert_eq!(result, Err(CheckpointError::NotFound));
    }

    #[test]
    fn test_add_entry_already_finalized() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 500)]).unwrap();
        let result = add_entry(&mut chain, 0, make_entry(2, 500));
        assert_eq!(result, Err(CheckpointError::AlreadyFinalized));
    }

    #[test]
    fn test_add_entry_duplicate() {
        let mut chain = default_chain();
        create_checkpoint(&mut chain, 1000, 10000, creator(1)).unwrap();
        add_entry(&mut chain, 0, make_entry(1, 500)).unwrap();
        let result = add_entry(&mut chain, 0, make_entry(1, 600));
        assert_eq!(result, Err(CheckpointError::DuplicateEntry));
    }

    #[test]
    fn test_add_entry_accumulates_capacity() {
        let mut chain = default_chain();
        create_checkpoint(&mut chain, 1000, 10000, creator(1)).unwrap();
        add_entry(&mut chain, 0, make_entry(1, 500)).unwrap();
        add_entry(&mut chain, 0, make_entry(2, 300)).unwrap();
        assert_eq!(chain.checkpoints[0].total_capacity, 800);
        assert_eq!(chain.checkpoints[0].entry_count, 2);
    }

    #[test]
    fn test_add_entries() {
        let mut chain = default_chain();
        create_checkpoint(&mut chain, 1000, 10000, creator(1)).unwrap();
        let entries = vec![make_entry(1, 100), make_entry(2, 200), make_entry(3, 300)];
        let count = add_entries(&mut chain, 0, entries).unwrap();
        assert_eq!(count, 3);
        assert_eq!(chain.checkpoints[0].entry_count, 3);
        assert_eq!(chain.checkpoints[0].total_capacity, 600);
    }

    #[test]
    fn test_add_entries_partial_duplicate() {
        let mut chain = default_chain();
        create_checkpoint(&mut chain, 1000, 10000, creator(1)).unwrap();
        add_entry(&mut chain, 0, make_entry(1, 100)).unwrap();
        let entries = vec![make_entry(2, 200), make_entry(1, 300)];
        let result = add_entries(&mut chain, 0, entries);
        assert_eq!(result, Err(CheckpointError::DuplicateEntry));
    }

    #[test]
    fn test_add_entries_empty() {
        let mut chain = default_chain();
        create_checkpoint(&mut chain, 1000, 10000, creator(1)).unwrap();
        let count = add_entries(&mut chain, 0, vec![]).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_finalize_checkpoint() {
        let mut chain = default_chain();
        create_checkpoint(&mut chain, 1000, 10000, creator(1)).unwrap();
        add_entry(&mut chain, 0, make_entry(1, 500)).unwrap();
        finalize_checkpoint(&mut chain, 0).unwrap();
        assert_eq!(chain.checkpoints[0].status, CheckpointStatus::Finalized);
        assert_ne!(chain.checkpoints[0].state_root, [0u8; 32]);
        assert_eq!(chain.latest_finalized, Some(0));
    }

    #[test]
    fn test_finalize_empty_checkpoint() {
        let mut chain = default_chain();
        create_checkpoint(&mut chain, 1000, 10000, creator(1)).unwrap();
        let result = finalize_checkpoint(&mut chain, 0);
        assert_eq!(result, Err(CheckpointError::EmptyCheckpoint));
    }

    #[test]
    fn test_finalize_already_finalized() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 500)]).unwrap();
        let result = finalize_checkpoint(&mut chain, 0);
        assert_eq!(result, Err(CheckpointError::AlreadyFinalized));
    }

    #[test]
    fn test_finalize_not_found() {
        let mut chain = default_chain();
        let result = finalize_checkpoint(&mut chain, 99);
        assert_eq!(result, Err(CheckpointError::NotFound));
    }

    #[test]
    fn test_from_entries() {
        let mut chain = default_chain();
        let entries = vec![make_entry(1, 100), make_entry(2, 200)];
        let id = from_entries(&mut chain, 1000, 10000, creator(1), entries).unwrap();
        assert_eq!(id, 0);
        assert_eq!(chain.checkpoints[0].status, CheckpointStatus::Finalized);
        assert_eq!(chain.checkpoints[0].entry_count, 2);
        assert_eq!(chain.checkpoints[0].total_capacity, 300);
    }

    #[test]
    fn test_from_entries_empty() {
        let mut chain = default_chain();
        let result = from_entries(&mut chain, 1000, 10000, creator(1), vec![]);
        assert_eq!(result, Err(CheckpointError::EmptyCheckpoint));
    }

    #[test]
    fn test_from_entries_duplicate_cell_ids() {
        let mut chain = default_chain();
        let entries = vec![make_entry(1, 100), make_entry(1, 200)];
        let result = from_entries(&mut chain, 1000, 10000, creator(1), entries);
        assert_eq!(result, Err(CheckpointError::DuplicateEntry));
    }

    #[test]
    fn test_from_entries_multiple_sequential() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 100)]).unwrap();
        from_entries(&mut chain, 2000, 20000, creator(1), vec![make_entry(2, 200)]).unwrap();
        assert_eq!(chain.checkpoints.len(), 2);
        assert_eq!(chain.latest_finalized, Some(1));
        assert_eq!(chain.checkpoints[1].prev_checkpoint_id, Some(0));
    }

    // ============ State Root Computation Tests ============

    #[test]
    fn test_compute_entry_hash_deterministic() {
        let entry = make_entry(1, 500);
        let h1 = compute_entry_hash(&entry);
        let h2 = compute_entry_hash(&entry);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_compute_entry_hash_different_entries() {
        let e1 = make_entry(1, 500);
        let e2 = make_entry(2, 500);
        assert_ne!(compute_entry_hash(&e1), compute_entry_hash(&e2));
    }

    #[test]
    fn test_compute_entry_hash_different_capacity() {
        let e1 = make_entry(1, 500);
        let e2 = make_entry(1, 600);
        // Same cell_id but different capacity => the cell_id helper sets capacity separately
        // Actually they'll have different capacity but we construct e2 differently
        let mut e2b = make_entry(1, 500);
        e2b.capacity = 600;
        assert_ne!(compute_entry_hash(&e1), compute_entry_hash(&e2b));
    }

    #[test]
    fn test_compute_entry_hash_nonzero() {
        let entry = make_entry(1, 500);
        let h = compute_entry_hash(&entry);
        assert_ne!(h, [0u8; 32]);
    }

    #[test]
    fn test_compute_state_root_empty() {
        let root = compute_state_root(&[]);
        assert_eq!(root, [0u8; 32]);
    }

    #[test]
    fn test_compute_state_root_single() {
        let entries = vec![make_entry(1, 500)];
        let root = compute_state_root(&entries);
        let expected = compute_entry_hash(&entries[0]);
        assert_eq!(root, expected);
    }

    #[test]
    fn test_compute_state_root_two_entries() {
        let entries = vec![make_entry(1, 500), make_entry(2, 600)];
        let root = compute_state_root(&entries);
        assert_ne!(root, [0u8; 32]);
        assert_ne!(root, compute_entry_hash(&entries[0]));
    }

    #[test]
    fn test_compute_state_root_deterministic() {
        let entries = vec![make_entry(1, 500), make_entry(2, 600)];
        let r1 = compute_state_root(&entries);
        let r2 = compute_state_root(&entries);
        assert_eq!(r1, r2);
    }

    #[test]
    fn test_compute_state_root_order_matters() {
        let e1 = make_entry(1, 500);
        let e2 = make_entry(2, 600);
        let r1 = compute_state_root(&[e1.clone(), e2.clone()]);
        let r2 = compute_state_root(&[e2, e1]);
        assert_ne!(r1, r2);
    }

    #[test]
    fn test_compute_state_root_three_entries() {
        let entries = vec![make_entry(1, 100), make_entry(2, 200), make_entry(3, 300)];
        let root = compute_state_root(&entries);
        assert_ne!(root, [0u8; 32]);
    }

    #[test]
    fn test_compute_state_root_four_entries() {
        let entries = vec![
            make_entry(1, 100),
            make_entry(2, 200),
            make_entry(3, 300),
            make_entry(4, 400),
        ];
        let root = compute_state_root(&entries);
        assert_ne!(root, [0u8; 32]);
    }

    #[test]
    fn test_verify_state_root_valid() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 500)]).unwrap();
        assert!(verify_state_root(&chain.checkpoints[0]));
    }

    #[test]
    fn test_verify_state_root_invalid() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 500)]).unwrap();
        chain.checkpoints[0].state_root = [0xFFu8; 32];
        assert!(!verify_state_root(&chain.checkpoints[0]));
    }

    #[test]
    fn test_verify_state_root_empty_checkpoint() {
        let cp = Checkpoint {
            checkpoint_id: 0,
            block_height: 1000,
            timestamp: 10000,
            state_root: [0u8; 32],
            entries: vec![],
            entry_count: 0,
            total_capacity: 0,
            status: CheckpointStatus::Pending,
            prev_checkpoint_id: None,
            verifier_count: 0,
            created_by: creator(1),
        };
        assert!(verify_state_root(&cp));
    }

    // ============ Merkle Proof Tests ============

    #[test]
    fn test_generate_inclusion_proof_single() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 500)]).unwrap();
        let proof = generate_inclusion_proof(&chain.checkpoints[0], &cell_id(1)).unwrap();
        assert!(proof.is_empty()); // single entry = no siblings
    }

    #[test]
    fn test_generate_inclusion_proof_two() {
        let mut chain = default_chain();
        let entries = vec![make_entry(1, 500), make_entry(2, 600)];
        from_entries(&mut chain, 1000, 10000, creator(1), entries).unwrap();
        let proof = generate_inclusion_proof(&chain.checkpoints[0], &cell_id(1)).unwrap();
        assert_eq!(proof.len(), 1);
    }

    #[test]
    fn test_generate_inclusion_proof_not_found() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 500)]).unwrap();
        let result = generate_inclusion_proof(&chain.checkpoints[0], &cell_id(99));
        assert_eq!(result, Err(CheckpointError::EntryNotFound));
    }

    #[test]
    fn test_verify_inclusion_two_entries_first() {
        let mut chain = default_chain();
        let entries = vec![make_entry(1, 500), make_entry(2, 600)];
        from_entries(&mut chain, 1000, 10000, creator(1), entries.clone()).unwrap();
        let cp = &chain.checkpoints[0];
        let proof = generate_inclusion_proof(cp, &cell_id(1)).unwrap();
        let cell_hash = compute_entry_hash(&entries[0]);
        assert!(verify_inclusion(&cp.state_root, cell_hash, &proof, 0));
    }

    #[test]
    fn test_verify_inclusion_two_entries_second() {
        let mut chain = default_chain();
        let entries = vec![make_entry(1, 500), make_entry(2, 600)];
        from_entries(&mut chain, 1000, 10000, creator(1), entries.clone()).unwrap();
        let cp = &chain.checkpoints[0];
        let proof = generate_inclusion_proof(cp, &cell_id(2)).unwrap();
        let cell_hash = compute_entry_hash(&entries[1]);
        assert!(verify_inclusion(&cp.state_root, cell_hash, &proof, 1));
    }

    #[test]
    fn test_verify_inclusion_four_entries() {
        let mut chain = default_chain();
        let entries = vec![
            make_entry(1, 100),
            make_entry(2, 200),
            make_entry(3, 300),
            make_entry(4, 400),
        ];
        from_entries(&mut chain, 1000, 10000, creator(1), entries.clone()).unwrap();
        let cp = &chain.checkpoints[0];
        for (i, entry) in entries.iter().enumerate() {
            let proof = generate_inclusion_proof(cp, &entry.cell_id).unwrap();
            let hash = compute_entry_hash(entry);
            assert!(
                verify_inclusion(&cp.state_root, hash, &proof, i),
                "Failed for entry index {}",
                i
            );
        }
    }

    #[test]
    fn test_verify_inclusion_three_entries() {
        let mut chain = default_chain();
        let entries = vec![make_entry(1, 100), make_entry(2, 200), make_entry(3, 300)];
        from_entries(&mut chain, 1000, 10000, creator(1), entries.clone()).unwrap();
        let cp = &chain.checkpoints[0];
        for (i, entry) in entries.iter().enumerate() {
            let proof = generate_inclusion_proof(cp, &entry.cell_id).unwrap();
            let hash = compute_entry_hash(entry);
            assert!(
                verify_inclusion(&cp.state_root, hash, &proof, i),
                "Failed for entry index {}",
                i
            );
        }
    }

    #[test]
    fn test_verify_inclusion_wrong_hash() {
        let mut chain = default_chain();
        let entries = vec![make_entry(1, 500), make_entry(2, 600)];
        from_entries(&mut chain, 1000, 10000, creator(1), entries).unwrap();
        let cp = &chain.checkpoints[0];
        let proof = generate_inclusion_proof(cp, &cell_id(1)).unwrap();
        let wrong_hash = [0xABu8; 32];
        assert!(!verify_inclusion(&cp.state_root, wrong_hash, &proof, 0));
    }

    #[test]
    fn test_verify_inclusion_wrong_root() {
        let mut chain = default_chain();
        let entries = vec![make_entry(1, 500), make_entry(2, 600)];
        from_entries(&mut chain, 1000, 10000, creator(1), entries.clone()).unwrap();
        let cp = &chain.checkpoints[0];
        let proof = generate_inclusion_proof(cp, &cell_id(1)).unwrap();
        let cell_hash = compute_entry_hash(&entries[0]);
        let wrong_root = [0xFFu8; 32];
        assert!(!verify_inclusion(&wrong_root, cell_hash, &proof, 0));
    }

    #[test]
    fn test_verify_inclusion_five_entries() {
        let mut chain = default_chain();
        let entries: Vec<StateEntry> = (1..=5).map(|i| make_entry(i, i as u64 * 100)).collect();
        from_entries(&mut chain, 1000, 10000, creator(1), entries.clone()).unwrap();
        let cp = &chain.checkpoints[0];
        for (i, entry) in entries.iter().enumerate() {
            let proof = generate_inclusion_proof(cp, &entry.cell_id).unwrap();
            let hash = compute_entry_hash(entry);
            assert!(verify_inclusion(&cp.state_root, hash, &proof, i));
        }
    }

    // ============ Verification Tests ============

    #[test]
    fn test_verify_checkpoint_valid() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 500)]).unwrap();
        let result = verify_checkpoint(&chain.checkpoints[0]);
        assert!(result.is_valid);
        assert!(result.root_matches);
        assert!(result.entry_count_matches);
        assert!(result.capacity_matches);
        assert!(result.errors.is_empty());
    }

    #[test]
    fn test_verify_checkpoint_bad_root() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 500)]).unwrap();
        chain.checkpoints[0].state_root = [0xAAu8; 32];
        let result = verify_checkpoint(&chain.checkpoints[0]);
        assert!(!result.is_valid);
        assert!(!result.root_matches);
    }

    #[test]
    fn test_verify_checkpoint_bad_entry_count() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 500)]).unwrap();
        chain.checkpoints[0].entry_count = 99;
        let result = verify_checkpoint(&chain.checkpoints[0]);
        assert!(!result.is_valid);
        assert!(!result.entry_count_matches);
    }

    #[test]
    fn test_verify_checkpoint_bad_capacity() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 500)]).unwrap();
        chain.checkpoints[0].total_capacity = 999;
        let result = verify_checkpoint(&chain.checkpoints[0]);
        assert!(!result.is_valid);
        assert!(!result.capacity_matches);
    }

    #[test]
    fn test_verify_checkpoint_multiple_errors() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 500)]).unwrap();
        chain.checkpoints[0].state_root = [0xAAu8; 32];
        chain.checkpoints[0].entry_count = 99;
        chain.checkpoints[0].total_capacity = 999;
        let result = verify_checkpoint(&chain.checkpoints[0]);
        assert!(!result.is_valid);
        assert_eq!(result.errors.len(), 3);
    }

    #[test]
    fn test_add_verification() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 500)]).unwrap();
        let count = add_verification(&mut chain, 0).unwrap();
        assert_eq!(count, 1);
        let count = add_verification(&mut chain, 0).unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn test_add_verification_not_finalized() {
        let mut chain = default_chain();
        create_checkpoint(&mut chain, 1000, 10000, creator(1)).unwrap();
        let result = add_verification(&mut chain, 0);
        assert_eq!(result, Err(CheckpointError::NotFinalized));
    }

    #[test]
    fn test_add_verification_invalid_checkpoint() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 500)]).unwrap();
        mark_invalid(&mut chain, 0).unwrap();
        let result = add_verification(&mut chain, 0);
        assert_eq!(result, Err(CheckpointError::InvalidStateRoot));
    }

    #[test]
    fn test_add_verification_not_found() {
        let mut chain = default_chain();
        let result = add_verification(&mut chain, 99);
        assert_eq!(result, Err(CheckpointError::NotFound));
    }

    #[test]
    fn test_is_fully_verified_false() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 500)]).unwrap();
        assert!(!is_fully_verified(&chain, 0));
    }

    #[test]
    fn test_is_fully_verified_true() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 500)]).unwrap();
        add_verification(&mut chain, 0).unwrap();
        add_verification(&mut chain, 0).unwrap();
        add_verification(&mut chain, 0).unwrap();
        assert!(is_fully_verified(&chain, 0));
    }

    #[test]
    fn test_is_fully_verified_not_found() {
        let chain = default_chain();
        assert!(!is_fully_verified(&chain, 99));
    }

    #[test]
    fn test_mark_verified() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 500)]).unwrap();
        for _ in 0..3 {
            add_verification(&mut chain, 0).unwrap();
        }
        mark_verified(&mut chain, 0).unwrap();
        assert_eq!(chain.checkpoints[0].status, CheckpointStatus::Verified);
    }

    #[test]
    fn test_mark_verified_insufficient() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 500)]).unwrap();
        add_verification(&mut chain, 0).unwrap();
        let result = mark_verified(&mut chain, 0);
        assert_eq!(result, Err(CheckpointError::InsufficientVerifiers));
    }

    #[test]
    fn test_mark_verified_pending() {
        let mut chain = default_chain();
        create_checkpoint(&mut chain, 1000, 10000, creator(1)).unwrap();
        let result = mark_verified(&mut chain, 0);
        assert_eq!(result, Err(CheckpointError::NotFinalized));
    }

    #[test]
    fn test_mark_verified_not_found() {
        let mut chain = default_chain();
        let result = mark_verified(&mut chain, 99);
        assert_eq!(result, Err(CheckpointError::NotFound));
    }

    #[test]
    fn test_mark_invalid() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 500)]).unwrap();
        mark_invalid(&mut chain, 0).unwrap();
        assert_eq!(chain.checkpoints[0].status, CheckpointStatus::Invalid);
    }

    #[test]
    fn test_mark_invalid_not_found() {
        let mut chain = default_chain();
        let result = mark_invalid(&mut chain, 99);
        assert_eq!(result, Err(CheckpointError::NotFound));
    }

    #[test]
    fn test_mark_invalid_pending() {
        let mut chain = default_chain();
        create_checkpoint(&mut chain, 1000, 10000, creator(1)).unwrap();
        mark_invalid(&mut chain, 0).unwrap();
        assert_eq!(chain.checkpoints[0].status, CheckpointStatus::Invalid);
    }

    // ============ Query Tests ============

    #[test]
    fn test_get_checkpoint() {
        let chain = make_simple_chain(3);
        let cp = get_checkpoint(&chain, 1).unwrap();
        assert_eq!(cp.checkpoint_id, 1);
        assert_eq!(cp.block_height, 2000);
    }

    #[test]
    fn test_get_checkpoint_not_found() {
        let chain = make_simple_chain(3);
        assert!(get_checkpoint(&chain, 99).is_none());
    }

    #[test]
    fn test_latest_checkpoint() {
        let chain = make_simple_chain(3);
        let cp = latest_checkpoint(&chain).unwrap();
        assert_eq!(cp.checkpoint_id, 2);
    }

    #[test]
    fn test_latest_checkpoint_empty() {
        let chain = default_chain();
        assert!(latest_checkpoint(&chain).is_none());
    }

    #[test]
    fn test_latest_finalized() {
        let chain = make_simple_chain(3);
        let cp = latest_finalized(&chain).unwrap();
        assert_eq!(cp.checkpoint_id, 2);
    }

    #[test]
    fn test_latest_finalized_empty() {
        let chain = default_chain();
        assert!(latest_finalized(&chain).is_none());
    }

    #[test]
    fn test_latest_finalized_with_pending() {
        let mut chain = make_simple_chain(2);
        create_checkpoint(&mut chain, 3000, 30000, creator(1)).unwrap();
        let cp = latest_finalized(&chain).unwrap();
        assert_eq!(cp.checkpoint_id, 1);
    }

    #[test]
    fn test_checkpoint_at_height() {
        let chain = make_simple_chain(3);
        let cp = checkpoint_at_height(&chain, 2000).unwrap();
        assert_eq!(cp.checkpoint_id, 1);
    }

    #[test]
    fn test_checkpoint_at_height_not_found() {
        let chain = make_simple_chain(3);
        assert!(checkpoint_at_height(&chain, 1500).is_none());
    }

    #[test]
    fn test_nearest_checkpoint() {
        let chain = make_simple_chain(3);
        let cp = nearest_checkpoint(&chain, 2500).unwrap();
        assert_eq!(cp.block_height, 2000);
    }

    #[test]
    fn test_nearest_checkpoint_exact() {
        let chain = make_simple_chain(3);
        let cp = nearest_checkpoint(&chain, 2000).unwrap();
        assert_eq!(cp.block_height, 2000);
    }

    #[test]
    fn test_nearest_checkpoint_below_all() {
        let chain = make_simple_chain(3);
        assert!(nearest_checkpoint(&chain, 500).is_none());
    }

    #[test]
    fn test_nearest_checkpoint_above_all() {
        let chain = make_simple_chain(3);
        let cp = nearest_checkpoint(&chain, 99999).unwrap();
        assert_eq!(cp.block_height, 3000);
    }

    #[test]
    fn test_checkpoints_in_range() {
        let chain = make_simple_chain(5);
        let results = checkpoints_in_range(&chain, 2000, 4000);
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn test_checkpoints_in_range_empty() {
        let chain = make_simple_chain(3);
        let results = checkpoints_in_range(&chain, 5000, 6000);
        assert!(results.is_empty());
    }

    #[test]
    fn test_checkpoints_in_range_single() {
        let chain = make_simple_chain(3);
        let results = checkpoints_in_range(&chain, 2000, 2000);
        assert_eq!(results.len(), 1);
    }

    // ============ Diffing Tests ============

    #[test]
    fn test_diff_identical_checkpoints() {
        let chain = make_simple_chain(2);
        let diff = diff_checkpoints(&chain.checkpoints[0], &chain.checkpoints[0]);
        assert!(diff.added_cells.is_empty());
        assert!(diff.removed_cells.is_empty());
        assert!(diff.modified_cells.is_empty());
        assert_eq!(diff.capacity_change, 0);
    }

    #[test]
    fn test_diff_added_cells() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 100)]).unwrap();
        from_entries(
            &mut chain,
            2000,
            20000,
            creator(1),
            vec![make_entry(1, 100), make_entry(2, 200)],
        )
        .unwrap();
        let diff = diff_checkpoints(&chain.checkpoints[0], &chain.checkpoints[1]);
        assert_eq!(diff.added_cells.len(), 1);
        assert_eq!(diff.added_cells[0].cell_id, cell_id(2));
        assert_eq!(diff.removed_cells.len(), 0);
    }

    #[test]
    fn test_diff_removed_cells() {
        let mut chain = default_chain();
        from_entries(
            &mut chain,
            1000,
            10000,
            creator(1),
            vec![make_entry(1, 100), make_entry(2, 200)],
        )
        .unwrap();
        from_entries(&mut chain, 2000, 20000, creator(1), vec![make_entry(1, 100)]).unwrap();
        let diff = diff_checkpoints(&chain.checkpoints[0], &chain.checkpoints[1]);
        assert_eq!(diff.added_cells.len(), 0);
        assert_eq!(diff.removed_cells.len(), 1);
        assert_eq!(diff.removed_cells[0], cell_id(2));
    }

    #[test]
    fn test_diff_modified_cells() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 100)]).unwrap();
        let mut modified = make_entry(1, 200);
        modified.data_hash = data_hash(99);
        from_entries(&mut chain, 2000, 20000, creator(1), vec![modified]).unwrap();
        let diff = diff_checkpoints(&chain.checkpoints[0], &chain.checkpoints[1]);
        assert_eq!(diff.modified_cells.len(), 1);
        assert_eq!(diff.modified_cells[0].0.capacity, 100);
        assert_eq!(diff.modified_cells[0].1.capacity, 200);
    }

    #[test]
    fn test_diff_capacity_change_positive() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 100)]).unwrap();
        from_entries(
            &mut chain,
            2000,
            20000,
            creator(1),
            vec![make_entry(1, 100), make_entry(2, 300)],
        )
        .unwrap();
        let diff = diff_checkpoints(&chain.checkpoints[0], &chain.checkpoints[1]);
        assert_eq!(diff.capacity_change, 300);
    }

    #[test]
    fn test_diff_capacity_change_negative() {
        let mut chain = default_chain();
        from_entries(
            &mut chain,
            1000,
            10000,
            creator(1),
            vec![make_entry(1, 100), make_entry(2, 300)],
        )
        .unwrap();
        from_entries(&mut chain, 2000, 20000, creator(1), vec![make_entry(1, 100)]).unwrap();
        let diff = diff_checkpoints(&chain.checkpoints[0], &chain.checkpoints[1]);
        assert_eq!(diff.capacity_change, -300);
    }

    #[test]
    fn test_diff_entry_count() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 100)]).unwrap();
        from_entries(
            &mut chain,
            2000,
            20000,
            creator(1),
            vec![make_entry(2, 200), make_entry(3, 300)],
        )
        .unwrap();
        let diff = diff_checkpoints(&chain.checkpoints[0], &chain.checkpoints[1]);
        let (added, removed, modified) = diff_entry_count(&diff);
        assert_eq!(added, 2);
        assert_eq!(removed, 1);
        assert_eq!(modified, 0);
    }

    #[test]
    fn test_apply_diff_added() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 100)]).unwrap();
        from_entries(
            &mut chain,
            2000,
            20000,
            creator(1),
            vec![make_entry(1, 100), make_entry(2, 200)],
        )
        .unwrap();
        let diff = diff_checkpoints(&chain.checkpoints[0], &chain.checkpoints[1]);
        let result = apply_diff(&chain.checkpoints[0], &diff).unwrap();
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_apply_diff_removed() {
        let mut chain = default_chain();
        from_entries(
            &mut chain,
            1000,
            10000,
            creator(1),
            vec![make_entry(1, 100), make_entry(2, 200)],
        )
        .unwrap();
        from_entries(&mut chain, 2000, 20000, creator(1), vec![make_entry(1, 100)]).unwrap();
        let diff = diff_checkpoints(&chain.checkpoints[0], &chain.checkpoints[1]);
        let result = apply_diff(&chain.checkpoints[0], &diff).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].cell_id, cell_id(1));
    }

    #[test]
    fn test_apply_diff_modified() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 100)]).unwrap();
        let mut modified = make_entry(1, 200);
        modified.data_hash = data_hash(99);
        from_entries(&mut chain, 2000, 20000, creator(1), vec![modified]).unwrap();
        let diff = diff_checkpoints(&chain.checkpoints[0], &chain.checkpoints[1]);
        let result = apply_diff(&chain.checkpoints[0], &diff).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].capacity, 200);
    }

    #[test]
    fn test_apply_diff_roundtrip() {
        let mut chain = default_chain();
        from_entries(
            &mut chain,
            1000,
            10000,
            creator(1),
            vec![make_entry(1, 100), make_entry(2, 200)],
        )
        .unwrap();
        from_entries(
            &mut chain,
            2000,
            20000,
            creator(1),
            vec![make_entry(2, 200), make_entry(3, 300)],
        )
        .unwrap();
        let diff = diff_checkpoints(&chain.checkpoints[0], &chain.checkpoints[1]);
        let result = apply_diff(&chain.checkpoints[0], &diff).unwrap();
        assert_eq!(result.len(), 2);
        let ids: Vec<[u8; 32]> = result.iter().map(|e| e.cell_id).collect();
        assert!(ids.contains(&cell_id(2)));
        assert!(ids.contains(&cell_id(3)));
    }

    // ============ Rollback Tests ============

    #[test]
    fn test_can_rollback_to_finalized() {
        let chain = make_simple_chain(3);
        assert!(can_rollback_to(&chain, 1));
    }

    #[test]
    fn test_can_rollback_to_verified() {
        let mut chain = make_simple_chain(3);
        for _ in 0..3 {
            add_verification(&mut chain, 0).unwrap();
        }
        mark_verified(&mut chain, 0).unwrap();
        assert!(can_rollback_to(&chain, 0));
    }

    #[test]
    fn test_can_rollback_to_pending() {
        let mut chain = default_chain();
        create_checkpoint(&mut chain, 1000, 10000, creator(1)).unwrap();
        assert!(!can_rollback_to(&chain, 0));
    }

    #[test]
    fn test_can_rollback_to_invalid() {
        let mut chain = make_simple_chain(1);
        mark_invalid(&mut chain, 0).unwrap();
        assert!(!can_rollback_to(&chain, 0));
    }

    #[test]
    fn test_can_rollback_to_not_found() {
        let chain = default_chain();
        assert!(!can_rollback_to(&chain, 99));
    }

    #[test]
    fn test_rollback_to() {
        let mut chain = make_simple_chain(5);
        let removed = rollback_to(&mut chain, 2).unwrap();
        assert_eq!(removed.len(), 2);
        assert_eq!(chain.checkpoints.len(), 3);
        assert_eq!(chain.latest_finalized, Some(2));
    }

    #[test]
    fn test_rollback_to_first() {
        let mut chain = make_simple_chain(3);
        let removed = rollback_to(&mut chain, 0).unwrap();
        assert_eq!(removed.len(), 2);
        assert_eq!(chain.checkpoints.len(), 1);
    }

    #[test]
    fn test_rollback_to_last() {
        let mut chain = make_simple_chain(3);
        let removed = rollback_to(&mut chain, 2).unwrap();
        assert!(removed.is_empty());
        assert_eq!(chain.checkpoints.len(), 3);
    }

    #[test]
    fn test_rollback_to_failed() {
        let mut chain = default_chain();
        create_checkpoint(&mut chain, 1000, 10000, creator(1)).unwrap();
        let result = rollback_to(&mut chain, 0);
        assert_eq!(result, Err(CheckpointError::RollbackFailed));
    }

    #[test]
    fn test_rollback_updates_latest_finalized() {
        let mut chain = make_simple_chain(5);
        rollback_to(&mut chain, 1).unwrap();
        assert_eq!(chain.latest_finalized, Some(1));
    }

    #[test]
    fn test_rollback_state() {
        let mut chain = default_chain();
        let entries = vec![make_entry(1, 100), make_entry(2, 200)];
        from_entries(&mut chain, 1000, 10000, creator(1), entries).unwrap();
        let state = rollback_state(&chain.checkpoints[0]);
        assert_eq!(state.len(), 2);
        assert_eq!(state[0].capacity, 100);
        assert_eq!(state[1].capacity, 200);
    }

    #[test]
    fn test_rollback_state_empty() {
        let mut chain = default_chain();
        create_checkpoint(&mut chain, 1000, 10000, creator(1)).unwrap();
        let state = rollback_state(&chain.checkpoints[0]);
        assert!(state.is_empty());
    }

    // ============ Archival Tests ============

    #[test]
    fn test_archive_old() {
        let mut chain = default_chain();
        // Create checkpoints at heights 1000, 2000, 3000
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 100)]).unwrap();
        from_entries(&mut chain, 2000, 20000, creator(1), vec![make_entry(2, 200)]).unwrap();
        from_entries(&mut chain, 3000, 30000, creator(1), vec![make_entry(3, 300)]).unwrap();
        // auto_archive_after=10000, current_height=12000 => threshold=2000
        // checkpoint at 1000 < 2000 => archived
        let count = archive_old(&mut chain, 12000);
        assert_eq!(count, 1);
        assert_eq!(chain.checkpoints[0].status, CheckpointStatus::Archived);
        assert_eq!(chain.checkpoints[1].status, CheckpointStatus::Finalized);
    }

    #[test]
    fn test_archive_old_none() {
        let mut chain = make_simple_chain(3);
        let count = archive_old(&mut chain, 5000);
        assert_eq!(count, 0);
    }

    #[test]
    fn test_archive_old_skips_pending() {
        let mut chain = default_chain();
        create_checkpoint(&mut chain, 1000, 10000, creator(1)).unwrap();
        let count = archive_old(&mut chain, 50000);
        assert_eq!(count, 0);
    }

    #[test]
    fn test_archive_old_skips_invalid() {
        let mut chain = make_simple_chain(1);
        mark_invalid(&mut chain, 0).unwrap();
        let count = archive_old(&mut chain, 50000);
        assert_eq!(count, 0);
    }

    #[test]
    fn test_prune_archived() {
        let mut chain = create_chain(1000, 3, 2, 10000);
        for i in 0..5u8 {
            from_entries(
                &mut chain,
                (i as u64 + 1) * 1000,
                0,
                creator(1),
                vec![make_entry(i + 1, 100)],
            )
            .unwrap();
        }
        // Archive first 3
        for cp in chain.checkpoints.iter_mut().take(3) {
            cp.status = CheckpointStatus::Archived;
        }
        // retention=2, so prune 1
        let pruned = prune_archived(&mut chain);
        assert_eq!(pruned, 1);
        assert_eq!(chain.checkpoints.len(), 4);
    }

    #[test]
    fn test_prune_archived_none_needed() {
        let mut chain = create_chain(1000, 3, 100, 10000);
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 100)]).unwrap();
        chain.checkpoints[0].status = CheckpointStatus::Archived;
        let pruned = prune_archived(&mut chain);
        assert_eq!(pruned, 0);
    }

    #[test]
    fn test_prune_archived_removes_oldest_first() {
        let mut chain = create_chain(1000, 3, 1, 10000);
        for i in 0..3u8 {
            from_entries(
                &mut chain,
                (i as u64 + 1) * 1000,
                0,
                creator(1),
                vec![make_entry(i + 1, 100)],
            )
            .unwrap();
            chain.checkpoints[i as usize].status = CheckpointStatus::Archived;
        }
        let pruned = prune_archived(&mut chain);
        assert_eq!(pruned, 2);
        assert_eq!(chain.checkpoints.len(), 1);
        assert_eq!(chain.checkpoints[0].checkpoint_id, 2);
    }

    #[test]
    fn test_archived_count() {
        let mut chain = make_simple_chain(3);
        assert_eq!(archived_count(&chain), 0);
        chain.checkpoints[0].status = CheckpointStatus::Archived;
        assert_eq!(archived_count(&chain), 1);
        chain.checkpoints[1].status = CheckpointStatus::Archived;
        assert_eq!(archived_count(&chain), 2);
    }

    #[test]
    fn test_should_checkpoint_empty() {
        let chain = default_chain();
        assert!(should_checkpoint(&chain, 1000));
    }

    #[test]
    fn test_should_checkpoint_time() {
        let chain = make_simple_chain(1);
        assert!(!should_checkpoint(&chain, 1500));
        assert!(should_checkpoint(&chain, 2000));
        assert!(should_checkpoint(&chain, 3000));
    }

    #[test]
    fn test_should_checkpoint_zero_interval() {
        let chain = create_chain(0, 3, 100, 10000);
        assert!(!should_checkpoint(&chain, 1000));
    }

    // ============ Analytics Tests ============

    #[test]
    fn test_chain_health_empty() {
        let chain = default_chain();
        assert_eq!(chain_health(&chain), 0);
    }

    #[test]
    fn test_chain_health_all_finalized() {
        let chain = make_simple_chain(5);
        let health = chain_health(&chain);
        // Should be high since all are finalized
        assert!(health >= 5000);
    }

    #[test]
    fn test_chain_health_with_invalid() {
        let mut chain = make_simple_chain(5);
        mark_invalid(&mut chain, 0).unwrap();
        mark_invalid(&mut chain, 1).unwrap();
        let health = chain_health(&chain);
        let healthy = chain_health(&make_simple_chain(5));
        assert!(health < healthy);
    }

    #[test]
    fn test_chain_health_with_verified() {
        let mut chain = make_simple_chain(3);
        for _ in 0..3 {
            add_verification(&mut chain, 0).unwrap();
        }
        mark_verified(&mut chain, 0).unwrap();
        let health = chain_health(&chain);
        assert!(health > 0);
    }

    #[test]
    fn test_coverage_bps_full() {
        let chain = make_simple_chain(5);
        // Heights 1000..5000, interval 1000
        let coverage = coverage_bps(&chain, 1000, 5000);
        assert!(coverage > 0);
    }

    #[test]
    fn test_coverage_bps_empty() {
        let chain = default_chain();
        assert_eq!(coverage_bps(&chain, 1000, 5000), 0);
    }

    #[test]
    fn test_coverage_bps_invalid_range() {
        let chain = make_simple_chain(3);
        assert_eq!(coverage_bps(&chain, 5000, 1000), 0);
    }

    #[test]
    fn test_avg_entries_empty() {
        let chain = default_chain();
        assert_eq!(avg_entries_per_checkpoint(&chain), 0);
    }

    #[test]
    fn test_avg_entries() {
        let mut chain = default_chain();
        from_entries(
            &mut chain,
            1000,
            10000,
            creator(1),
            vec![make_entry(1, 100), make_entry(2, 200)],
        )
        .unwrap();
        from_entries(
            &mut chain,
            2000,
            20000,
            creator(1),
            vec![make_entry(3, 300), make_entry(4, 400), make_entry(5, 500), make_entry(6, 600)],
        )
        .unwrap();
        // (2 + 4) / 2 = 3
        assert_eq!(avg_entries_per_checkpoint(&chain), 3);
    }

    #[test]
    fn test_total_capacity_tracked() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 100)]).unwrap();
        from_entries(&mut chain, 2000, 20000, creator(1), vec![make_entry(2, 200)]).unwrap();
        assert_eq!(total_capacity_tracked(&chain), 300);
    }

    #[test]
    fn test_total_capacity_tracked_excludes_archived() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 100)]).unwrap();
        from_entries(&mut chain, 2000, 20000, creator(1), vec![make_entry(2, 200)]).unwrap();
        chain.checkpoints[0].status = CheckpointStatus::Archived;
        assert_eq!(total_capacity_tracked(&chain), 200);
    }

    #[test]
    fn test_verification_rate_none() {
        let chain = default_chain();
        assert_eq!(verification_rate(&chain), 0);
    }

    #[test]
    fn test_verification_rate_all_verified() {
        let mut chain = make_simple_chain(3);
        for i in 0..3u64 {
            for _ in 0..3 {
                add_verification(&mut chain, i).unwrap();
            }
            mark_verified(&mut chain, i).unwrap();
        }
        assert_eq!(verification_rate(&chain), 10000);
    }

    #[test]
    fn test_verification_rate_partial() {
        let mut chain = make_simple_chain(4);
        for _ in 0..3 {
            add_verification(&mut chain, 0).unwrap();
        }
        mark_verified(&mut chain, 0).unwrap();
        // 1 verified, 3 finalized => 1/4 = 2500 bps
        assert_eq!(verification_rate(&chain), 2500);
    }

    #[test]
    fn test_gap_count_contiguous() {
        let chain = make_simple_chain(5);
        assert_eq!(gap_count(&chain), 0);
    }

    #[test]
    fn test_gap_count_with_gaps() {
        let mut chain = default_chain();
        // Heights: 1000, 3000 (missing 2000)
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 100)]).unwrap();
        from_entries(&mut chain, 3000, 30000, creator(1), vec![make_entry(2, 200)]).unwrap();
        assert_eq!(gap_count(&chain), 1);
    }

    #[test]
    fn test_gap_count_large_gap() {
        let mut chain = default_chain();
        // Heights: 1000, 5000 (missing 2000, 3000, 4000)
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 100)]).unwrap();
        from_entries(&mut chain, 5000, 50000, creator(1), vec![make_entry(2, 200)]).unwrap();
        assert_eq!(gap_count(&chain), 3);
    }

    #[test]
    fn test_gap_count_single() {
        let chain = make_simple_chain(1);
        assert_eq!(gap_count(&chain), 0);
    }

    #[test]
    fn test_gap_count_empty() {
        let chain = default_chain();
        assert_eq!(gap_count(&chain), 0);
    }

    // ============ Validation Tests ============

    #[test]
    fn test_validate_chain_valid() {
        let chain = make_simple_chain(3);
        let errors = validate_chain(&chain);
        assert!(errors.is_empty());
    }

    #[test]
    fn test_validate_chain_bad_sequence() {
        let mut chain = default_chain();
        from_entries(&mut chain, 2000, 20000, creator(1), vec![make_entry(1, 100)]).unwrap();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(2, 200)]).unwrap();
        let errors = validate_chain(&chain);
        assert!(errors.contains(&CheckpointError::InvalidSequence));
    }

    #[test]
    fn test_validate_chain_broken_links() {
        let mut chain = make_simple_chain(3);
        chain.checkpoints[2].prev_checkpoint_id = Some(0);
        let errors = validate_chain(&chain);
        assert!(errors.contains(&CheckpointError::ChainBroken));
    }

    #[test]
    fn test_validate_chain_bad_entry_count() {
        let mut chain = make_simple_chain(1);
        chain.checkpoints[0].entry_count = 99;
        let errors = validate_chain(&chain);
        assert!(errors.contains(&CheckpointError::CapacityMismatch));
    }

    #[test]
    fn test_validate_chain_bad_capacity() {
        let mut chain = make_simple_chain(1);
        chain.checkpoints[0].total_capacity = 999999;
        let errors = validate_chain(&chain);
        assert!(errors.contains(&CheckpointError::CapacityMismatch));
    }

    #[test]
    fn test_validate_chain_bad_state_root() {
        let mut chain = make_simple_chain(1);
        chain.checkpoints[0].state_root = [0xFFu8; 32];
        let errors = validate_chain(&chain);
        assert!(errors.contains(&CheckpointError::InvalidStateRoot));
    }

    #[test]
    fn test_validate_chain_empty() {
        let chain = default_chain();
        let errors = validate_chain(&chain);
        assert!(errors.is_empty());
    }

    #[test]
    fn test_is_contiguous_true() {
        let chain = make_simple_chain(5);
        assert!(is_contiguous(&chain));
    }

    #[test]
    fn test_is_contiguous_false() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 100)]).unwrap();
        from_entries(&mut chain, 3000, 30000, creator(1), vec![make_entry(2, 200)]).unwrap();
        assert!(!is_contiguous(&chain));
    }

    #[test]
    fn test_is_contiguous_empty() {
        let chain = default_chain();
        assert!(is_contiguous(&chain));
    }

    #[test]
    fn test_is_contiguous_single() {
        let chain = make_simple_chain(1);
        assert!(is_contiguous(&chain));
    }

    #[test]
    fn test_validate_entry_valid() {
        assert!(validate_entry(&make_entry(1, 500)));
    }

    #[test]
    fn test_validate_entry_zero_cell_id() {
        let mut entry = make_entry(1, 500);
        entry.cell_id = [0u8; 32];
        assert!(!validate_entry(&entry));
    }

    #[test]
    fn test_validate_entry_zero_data_hash() {
        let mut entry = make_entry(1, 500);
        entry.data_hash = [0u8; 32];
        assert!(!validate_entry(&entry));
    }

    #[test]
    fn test_validate_entry_zero_capacity() {
        let mut entry = make_entry(1, 500);
        entry.capacity = 0;
        assert!(!validate_entry(&entry));
    }

    #[test]
    fn test_validate_entry_zero_owner() {
        let mut entry = make_entry(1, 500);
        entry.owner = [0u8; 32];
        assert!(!validate_entry(&entry));
    }

    // ============ Utility Tests ============

    #[test]
    fn test_checkpoint_count() {
        let chain = make_simple_chain(5);
        assert_eq!(checkpoint_count(&chain), 5);
    }

    #[test]
    fn test_checkpoint_count_empty() {
        let chain = default_chain();
        assert_eq!(checkpoint_count(&chain), 0);
    }

    #[test]
    fn test_next_checkpoint_height_empty() {
        let chain = default_chain();
        assert_eq!(next_checkpoint_height(&chain), 1000);
    }

    #[test]
    fn test_next_checkpoint_height() {
        let chain = make_simple_chain(3);
        assert_eq!(next_checkpoint_height(&chain), 4000);
    }

    // ============ Integration / Scenario Tests ============

    #[test]
    fn test_full_lifecycle() {
        let mut chain = create_chain(100, 2, 10, 1000);

        // Create and finalize checkpoint
        let id = create_checkpoint(&mut chain, 100, 1000, creator(1)).unwrap();
        add_entry(&mut chain, id, make_entry(1, 100)).unwrap();
        add_entry(&mut chain, id, make_entry(2, 200)).unwrap();
        finalize_checkpoint(&mut chain, id).unwrap();

        // Verify
        let result = verify_checkpoint(&chain.checkpoints[0]);
        assert!(result.is_valid);

        // Add verifications
        add_verification(&mut chain, id).unwrap();
        add_verification(&mut chain, id).unwrap();
        assert!(is_fully_verified(&chain, id));
        mark_verified(&mut chain, id).unwrap();

        assert_eq!(chain.checkpoints[0].status, CheckpointStatus::Verified);
    }

    #[test]
    fn test_lifecycle_with_rollback() {
        let mut chain = make_simple_chain(5);
        // Rollback to checkpoint 2
        let removed = rollback_to(&mut chain, 2).unwrap();
        assert_eq!(removed.len(), 2);
        // Can still add new checkpoints
        from_entries(&mut chain, 4000, 40000, creator(1), vec![make_entry(10, 1000)]).unwrap();
        assert_eq!(chain.checkpoints.len(), 4);
    }

    #[test]
    fn test_lifecycle_archive_and_prune() {
        let mut chain = create_chain(1000, 3, 2, 5000);
        for i in 0..5u8 {
            from_entries(
                &mut chain,
                (i as u64 + 1) * 1000,
                0,
                creator(1),
                vec![make_entry(i + 1, 100)],
            )
            .unwrap();
        }
        // Archive: current_height=20000, threshold=15000
        let archived = archive_old(&mut chain, 20000);
        assert_eq!(archived, 5);
        // Prune: retention=2, archived=5, prune 3
        let pruned = prune_archived(&mut chain);
        assert_eq!(pruned, 3);
        assert_eq!(chain.checkpoints.len(), 2);
    }

    #[test]
    fn test_diff_and_apply_complex() {
        let mut chain = default_chain();
        from_entries(
            &mut chain,
            1000,
            10000,
            creator(1),
            vec![
                make_entry(1, 100),
                make_entry(2, 200),
                make_entry(3, 300),
            ],
        )
        .unwrap();

        let mut e2_modified = make_entry(2, 250);
        e2_modified.data_hash = data_hash(99);
        from_entries(
            &mut chain,
            2000,
            20000,
            creator(1),
            vec![
                make_entry(1, 100),
                e2_modified,
                make_entry(4, 400),
            ],
        )
        .unwrap();

        let diff = diff_checkpoints(&chain.checkpoints[0], &chain.checkpoints[1]);
        let (added, removed, modified) = diff_entry_count(&diff);
        assert_eq!(added, 1);    // entry 4
        assert_eq!(removed, 1);  // entry 3
        assert_eq!(modified, 1); // entry 2

        let result = apply_diff(&chain.checkpoints[0], &diff).unwrap();
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn test_multiple_verifiers_workflow() {
        let mut chain = create_chain(1000, 5, 100, 10000);
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 100)]).unwrap();

        for i in 0..4 {
            add_verification(&mut chain, 0).unwrap();
            assert!(!is_fully_verified(&chain, 0));
            assert_eq!(chain.checkpoints[0].verifier_count, i + 1);
        }
        add_verification(&mut chain, 0).unwrap();
        assert!(is_fully_verified(&chain, 0));
        mark_verified(&mut chain, 0).unwrap();
    }

    #[test]
    fn test_checkpoint_chain_integrity() {
        let chain = make_simple_chain(10);
        for (i, cp) in chain.checkpoints.iter().enumerate() {
            assert_eq!(cp.checkpoint_id, i as u64);
            if i > 0 {
                assert_eq!(cp.prev_checkpoint_id, Some((i - 1) as u64));
            } else {
                assert_eq!(cp.prev_checkpoint_id, None);
            }
        }
        let errors = validate_chain(&chain);
        assert!(errors.is_empty());
    }

    #[test]
    fn test_state_root_changes_with_entries() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 100)]).unwrap();
        from_entries(
            &mut chain,
            2000,
            20000,
            creator(1),
            vec![make_entry(1, 100), make_entry(2, 200)],
        )
        .unwrap();
        assert_ne!(
            chain.checkpoints[0].state_root,
            chain.checkpoints[1].state_root
        );
    }

    #[test]
    fn test_should_checkpoint_after_exact_interval() {
        let chain = make_simple_chain(1);
        assert!(!should_checkpoint(&chain, 1999));
        assert!(should_checkpoint(&chain, 2000));
    }

    #[test]
    fn test_analytics_on_mixed_statuses() {
        let mut chain = make_simple_chain(4);
        // Mark one verified
        for _ in 0..3 {
            add_verification(&mut chain, 0).unwrap();
        }
        mark_verified(&mut chain, 0).unwrap();
        // Mark one invalid
        mark_invalid(&mut chain, 3).unwrap();

        let health = chain_health(&chain);
        assert!(health > 0);
        assert!(health < 10000);

        let vrate = verification_rate(&chain);
        // 1 verified out of 3 finalized+verified (cp3 is invalid, not counted)
        assert!(vrate > 0);
    }

    #[test]
    fn test_entry_with_owner() {
        let entry = make_entry_with_owner(1, 500, 42);
        assert_eq!(entry.owner, owner(42));
        assert!(validate_entry(&entry));
    }

    #[test]
    fn test_coverage_bps_partial() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 100)]).unwrap();
        from_entries(&mut chain, 3000, 30000, creator(1), vec![make_entry(2, 200)]).unwrap();
        // Range 1000-5000, interval 1000 => expected ~5 checkpoints, have 2
        let coverage = coverage_bps(&chain, 1000, 5000);
        assert!(coverage > 0);
        assert!(coverage < 10000);
    }

    #[test]
    fn test_rollback_preserves_earlier_checkpoints() {
        let mut chain = make_simple_chain(5);
        let cp0_root = chain.checkpoints[0].state_root;
        let cp1_root = chain.checkpoints[1].state_root;
        rollback_to(&mut chain, 2).unwrap();
        assert_eq!(chain.checkpoints[0].state_root, cp0_root);
        assert_eq!(chain.checkpoints[1].state_root, cp1_root);
    }

    #[test]
    fn test_archive_does_not_archive_already_archived() {
        let mut chain = make_simple_chain(2);
        chain.checkpoints[0].status = CheckpointStatus::Archived;
        let count = archive_old(&mut chain, 50000);
        // Only checkpoint 1 should be newly archived
        assert_eq!(count, 1);
    }

    #[test]
    fn test_next_checkpoint_height_after_rollback() {
        let mut chain = make_simple_chain(5);
        rollback_to(&mut chain, 1).unwrap();
        assert_eq!(next_checkpoint_height(&chain), 3000);
    }

    #[test]
    fn test_total_capacity_tracked_empty() {
        let chain = default_chain();
        assert_eq!(total_capacity_tracked(&chain), 0);
    }

    #[test]
    fn test_finalized_chain_with_multiple_entries() {
        let mut chain = default_chain();
        let entries: Vec<StateEntry> = (1..=10).map(|i| make_entry(i, i as u64 * 100)).collect();
        let id = from_entries(&mut chain, 1000, 10000, creator(1), entries).unwrap();
        assert_eq!(chain.checkpoints[id as usize].entry_count, 10);
        assert_eq!(chain.checkpoints[id as usize].total_capacity, 5500);
        assert!(verify_state_root(&chain.checkpoints[id as usize]));
    }

    #[test]
    fn test_inclusion_proof_seven_entries() {
        let mut chain = default_chain();
        let entries: Vec<StateEntry> = (1..=7).map(|i| make_entry(i, i as u64 * 100)).collect();
        from_entries(&mut chain, 1000, 10000, creator(1), entries.clone()).unwrap();
        let cp = &chain.checkpoints[0];
        for (i, entry) in entries.iter().enumerate() {
            let proof = generate_inclusion_proof(cp, &entry.cell_id).unwrap();
            let hash = compute_entry_hash(entry);
            assert!(
                verify_inclusion(&cp.state_root, hash, &proof, i),
                "Proof failed for index {}",
                i
            );
        }
    }

    #[test]
    fn test_diff_no_overlap() {
        let mut chain = default_chain();
        from_entries(
            &mut chain,
            1000,
            10000,
            creator(1),
            vec![make_entry(1, 100), make_entry(2, 200)],
        )
        .unwrap();
        from_entries(
            &mut chain,
            2000,
            20000,
            creator(1),
            vec![make_entry(3, 300), make_entry(4, 400)],
        )
        .unwrap();
        let diff = diff_checkpoints(&chain.checkpoints[0], &chain.checkpoints[1]);
        let (added, removed, modified) = diff_entry_count(&diff);
        assert_eq!(added, 2);
        assert_eq!(removed, 2);
        assert_eq!(modified, 0);
    }

    #[test]
    fn test_validate_chain_pending_root_not_checked() {
        let mut chain = default_chain();
        create_checkpoint(&mut chain, 1000, 10000, creator(1)).unwrap();
        // Pending checkpoint with zero root is fine
        let errors = validate_chain(&chain);
        // Only possible issue is entry_count or capacity mismatch (both 0)
        assert!(errors.is_empty());
    }

    #[test]
    fn test_chain_health_single_verified() {
        let mut chain = create_chain(1000, 1, 100, 10000);
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 100)]).unwrap();
        add_verification(&mut chain, 0).unwrap();
        mark_verified(&mut chain, 0).unwrap();
        let health = chain_health(&chain);
        assert_eq!(health, 10000);
    }

    #[test]
    fn test_checkpoint_ids_sequential() {
        let mut chain = default_chain();
        for i in 0..10u8 {
            let id = from_entries(
                &mut chain,
                (i as u64 + 1) * 1000,
                0,
                creator(1),
                vec![make_entry(i + 1, 100)],
            )
            .unwrap();
            assert_eq!(id, i as u64);
        }
    }

    #[test]
    fn test_get_checkpoint_after_prune() {
        let mut chain = create_chain(1000, 3, 1, 5000);
        for i in 0..3u8 {
            from_entries(
                &mut chain,
                (i as u64 + 1) * 1000,
                0,
                creator(1),
                vec![make_entry(i + 1, 100)],
            )
            .unwrap();
        }
        chain.checkpoints[0].status = CheckpointStatus::Archived;
        chain.checkpoints[1].status = CheckpointStatus::Archived;
        prune_archived(&mut chain);
        // ID 0 pruned, ID 1 kept as the 1 retention slot
        assert!(get_checkpoint(&chain, 0).is_none());
    }

    #[test]
    fn test_compute_state_root_large() {
        let entries: Vec<StateEntry> = (1..=20).map(|i| make_entry(i, i as u64 * 50)).collect();
        let root = compute_state_root(&entries);
        assert_ne!(root, [0u8; 32]);
        // Deterministic
        assert_eq!(root, compute_state_root(&entries));
    }

    #[test]
    fn test_verify_checkpoint_id_preserved() {
        let mut chain = default_chain();
        from_entries(&mut chain, 1000, 10000, creator(1), vec![make_entry(1, 500)]).unwrap();
        let result = verify_checkpoint(&chain.checkpoints[0]);
        assert_eq!(result.checkpoint_id, 0);
    }
}
