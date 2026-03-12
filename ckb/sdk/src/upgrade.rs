// ============ Upgrade — Protocol Upgrade Management & Timelock Enforcement ============
// Implements UUPS-style protocol upgrade management for VibeSwap on CKB.
//
// On CKB, upgrades involve deploying new type scripts and migrating cells.
// This module manages the full upgrade lifecycle with safety checks:
//
// Key capabilities:
// - Upgrade proposal creation with timelock validation
// - Approval accumulation with quorum/super-majority enforcement
// - Timelock + execution window enforcement
// - Emergency upgrade path with shorter timelock
// - Impact assessment for upgrade scope analysis
// - Code hash compatibility validation
// - Rollback preparation and execution within deadline
// - Proposal expiry and cancellation
//
// Flow:
// 1. PROPOSE: Create upgrade proposal with old/new code hashes + timelock
// 2. APPROVE: Accumulate approval BPS until quorum/super-majority reached
// 3. EXECUTE: After timelock expires and within window, execute upgrade
// 4. ROLLBACK: If needed, revert to previous code hash within deadline
//
// All state is represented as cells — no global mutable state, pure UTXO.

use vibeswap_math::mul_div;

// ============ Constants ============

/// Basis points denominator (100% = 10,000 bps)
pub const BPS: u128 = 10_000;

/// Minimum timelock delay in blocks (~2.3 days at ~4 sec/block)
pub const MIN_TIMELOCK_BLOCKS: u64 = 50_000;

/// Maximum timelock delay in blocks (~23 days)
pub const MAX_TIMELOCK_BLOCKS: u64 = 500_000;

/// Emergency timelock delay in blocks (~11 hours)
pub const EMERGENCY_TIMELOCK_BLOCKS: u64 = 10_000;

/// Window after timelock expires during which upgrade can be executed
pub const UPGRADE_WINDOW_BLOCKS: u64 = 100_000;

/// Maximum number of pending (non-terminal) upgrade proposals
pub const MAX_PENDING_UPGRADES: usize = 5;

/// Quorum: minimum approval needed for non-breaking changes (50%)
pub const QUORUM_BPS: u16 = 5000;

/// Super majority: approval needed for breaking changes (66.67%)
pub const SUPER_MAJORITY_BPS: u16 = 6667;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UpgradeError {
    /// Code hash is invalid (zero hash or malformed)
    InvalidCodeHash,
    /// Timelock period has not elapsed yet
    TimelockNotMet,
    /// Execution window has passed after timelock
    TimelockExpired,
    /// Approval BPS is below the required threshold
    InsufficientApproval,
    /// Maximum number of pending proposals reached
    MaxPendingReached,
    /// Proposal with the given ID was not found
    UpgradeNotFound,
    /// Proposal has already been executed
    AlreadyExecuted,
    /// Proposal has already been cancelled
    AlreadyCancelled,
    /// Caller is not authorized for this action
    NotAuthorized,
    /// Timelock value is outside valid range
    InvalidTimelock,
    /// New code hash is incompatible with the old one
    IncompatibleVersion,
    /// Rollback is not available (expired or never prepared)
    RollbackNotAvailable,
    /// Emergency proposal lacks valid justification
    EmergencyNotJustified,
    /// Arithmetic overflow
    Overflow,
}

// ============ Data Types ============

/// Status of an upgrade proposal through its lifecycle.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UpgradeStatus {
    /// Proposal is awaiting approval
    Pending,
    /// Proposal has sufficient approval and timelock is counting
    Approved,
    /// Proposal has been executed successfully
    Executed,
    /// Proposal was cancelled by proposer or guardian
    Cancelled,
    /// Proposal's execution window expired without execution
    Expired,
}

/// An upgrade proposal describing a code hash transition.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpgradeProposal {
    /// Unique proposal identifier
    pub proposal_id: u64,
    /// Code hash of the currently deployed type script
    pub old_code_hash: [u8; 32],
    /// Code hash of the new type script to upgrade to
    pub new_code_hash: [u8; 32],
    /// Lock hash of the proposer
    pub proposer: [u8; 32],
    /// Block number when the proposal was created
    pub proposed_block: u64,
    /// Number of blocks to wait after approval before execution
    pub timelock_blocks: u64,
    /// Whether this is an emergency proposal (shorter timelock)
    pub is_emergency: bool,
    /// Current accumulated approval in basis points
    pub approval_bps: u16,
    /// Current lifecycle status
    pub status: UpgradeStatus,
    /// Number of cells affected by this upgrade
    pub affected_cells: u64,
    /// SHA-256 hash of the off-chain description
    pub description_hash: [u8; 32],
}

/// Impact analysis for a proposed upgrade.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpgradeImpact {
    /// Number of cells that need to be migrated
    pub affected_cell_count: u64,
    /// Whether cell data migration is required
    pub requires_migration: bool,
    /// Whether this is a breaking change (major version bump)
    pub breaking_change: bool,
    /// Estimated gas/CKB cost in shannons
    pub estimated_gas: u128,
}

/// Result of a successfully executed upgrade.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExecutionResult {
    /// ID of the proposal that was executed
    pub proposal_id: u64,
    /// Block number at which execution occurred
    pub executed_block: u64,
    /// Number of cells upgraded
    pub cells_upgraded: u64,
    /// Whether rollback is available for this upgrade
    pub rollback_available: bool,
}

/// Information needed to rollback an executed upgrade.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RollbackInfo {
    /// Code hash to revert to
    pub original_code_hash: [u8; 32],
    /// Block number after which rollback is no longer possible
    pub rollback_deadline: u64,
    /// Number of cells that need to be reverted
    pub cells_to_revert: u64,
}

// ============ Core Functions ============

/// Create a new upgrade proposal with timelock validation.
///
/// Validates:
/// - Code hashes are non-zero and differ
/// - Timelock is within [MIN_TIMELOCK_BLOCKS, MAX_TIMELOCK_BLOCKS] (or EMERGENCY_TIMELOCK_BLOCKS for emergencies)
/// - Number of pending proposals hasn't reached MAX_PENDING_UPGRADES
///
/// Returns the constructed proposal on success.
pub fn create_proposal(
    proposal_id: u64,
    old_code_hash: [u8; 32],
    new_code_hash: [u8; 32],
    proposer: [u8; 32],
    current_block: u64,
    timelock_blocks: u64,
    is_emergency: bool,
    affected_cells: u64,
    description_hash: [u8; 32],
    pending_count: usize,
) -> Result<UpgradeProposal, UpgradeError> {
    // Validate code hashes are non-zero
    if old_code_hash == [0u8; 32] {
        return Err(UpgradeError::InvalidCodeHash);
    }
    if new_code_hash == [0u8; 32] {
        return Err(UpgradeError::InvalidCodeHash);
    }
    // Old and new must differ
    if old_code_hash == new_code_hash {
        return Err(UpgradeError::InvalidCodeHash);
    }

    // Check pending limit
    if pending_count >= MAX_PENDING_UPGRADES {
        return Err(UpgradeError::MaxPendingReached);
    }

    // Validate timelock range
    if is_emergency {
        // Emergency proposals use the fixed emergency timelock
        if timelock_blocks != EMERGENCY_TIMELOCK_BLOCKS {
            return Err(UpgradeError::InvalidTimelock);
        }
    } else {
        if timelock_blocks < MIN_TIMELOCK_BLOCKS {
            return Err(UpgradeError::InvalidTimelock);
        }
        if timelock_blocks > MAX_TIMELOCK_BLOCKS {
            return Err(UpgradeError::InvalidTimelock);
        }
    }

    Ok(UpgradeProposal {
        proposal_id,
        old_code_hash,
        new_code_hash,
        proposer,
        proposed_block: current_block,
        timelock_blocks,
        is_emergency,
        approval_bps: 0,
        status: UpgradeStatus::Pending,
        affected_cells,
        description_hash,
    })
}

/// Accumulate approval on a proposal.
///
/// Adds `additional_bps` to the proposal's approval. If the total meets
/// the required threshold (QUORUM_BPS for non-breaking, SUPER_MAJORITY_BPS
/// for breaking changes), the status transitions to Approved.
///
/// Returns the new total approval BPS.
pub fn approve_proposal(
    proposal: &mut UpgradeProposal,
    additional_bps: u16,
    breaking_change: bool,
) -> Result<u16, UpgradeError> {
    match proposal.status {
        UpgradeStatus::Executed => return Err(UpgradeError::AlreadyExecuted),
        UpgradeStatus::Cancelled => return Err(UpgradeError::AlreadyCancelled),
        UpgradeStatus::Expired => return Err(UpgradeError::TimelockExpired),
        UpgradeStatus::Pending | UpgradeStatus::Approved => {}
    }

    // Accumulate approval, cap at BPS (10,000)
    let new_approval = (proposal.approval_bps as u32)
        .checked_add(additional_bps as u32)
        .ok_or(UpgradeError::Overflow)?;
    let capped = if new_approval > BPS as u32 {
        BPS as u16
    } else {
        new_approval as u16
    };
    proposal.approval_bps = capped;

    // Check if threshold met
    let threshold = if breaking_change {
        SUPER_MAJORITY_BPS
    } else {
        QUORUM_BPS
    };

    if proposal.approval_bps >= threshold {
        proposal.status = UpgradeStatus::Approved;
    }

    Ok(proposal.approval_bps)
}

/// Check whether a proposal can be executed at the given block.
///
/// Conditions:
/// 1. Status is Approved
/// 2. Current block >= proposed_block + timelock_blocks (timelock met)
/// 3. Current block < proposed_block + timelock_blocks + UPGRADE_WINDOW_BLOCKS (within window)
/// 4. Approval meets required threshold
pub fn can_execute(
    proposal: &UpgradeProposal,
    current_block: u64,
    breaking_change: bool,
) -> Result<bool, UpgradeError> {
    // Must be approved
    if proposal.status != UpgradeStatus::Approved {
        return Ok(false);
    }

    // Check approval threshold
    let threshold = if breaking_change {
        SUPER_MAJORITY_BPS
    } else {
        QUORUM_BPS
    };
    if proposal.approval_bps < threshold {
        return Ok(false);
    }

    // Calculate timelock expiry
    let timelock_end = proposal
        .proposed_block
        .checked_add(proposal.timelock_blocks)
        .ok_or(UpgradeError::Overflow)?;

    // Timelock not met yet
    if current_block < timelock_end {
        return Ok(false);
    }

    // Calculate window end
    let window_end = timelock_end
        .checked_add(UPGRADE_WINDOW_BLOCKS)
        .ok_or(UpgradeError::Overflow)?;

    // Window expired
    if current_block >= window_end {
        return Ok(false);
    }

    Ok(true)
}

/// Execute an approved upgrade proposal.
///
/// Validates all execution preconditions and returns an ExecutionResult.
/// The proposal status is set to Executed.
pub fn execute_upgrade(
    proposal: &mut UpgradeProposal,
    current_block: u64,
    breaking_change: bool,
) -> Result<ExecutionResult, UpgradeError> {
    // Check status
    match proposal.status {
        UpgradeStatus::Executed => return Err(UpgradeError::AlreadyExecuted),
        UpgradeStatus::Cancelled => return Err(UpgradeError::AlreadyCancelled),
        UpgradeStatus::Expired => return Err(UpgradeError::TimelockExpired),
        UpgradeStatus::Pending => return Err(UpgradeError::InsufficientApproval),
        UpgradeStatus::Approved => {}
    }

    // Check approval threshold
    let threshold = if breaking_change {
        SUPER_MAJORITY_BPS
    } else {
        QUORUM_BPS
    };
    if proposal.approval_bps < threshold {
        return Err(UpgradeError::InsufficientApproval);
    }

    // Check timelock
    let timelock_end = proposal
        .proposed_block
        .checked_add(proposal.timelock_blocks)
        .ok_or(UpgradeError::Overflow)?;

    if current_block < timelock_end {
        return Err(UpgradeError::TimelockNotMet);
    }

    // Check execution window
    let window_end = timelock_end
        .checked_add(UPGRADE_WINDOW_BLOCKS)
        .ok_or(UpgradeError::Overflow)?;

    if current_block >= window_end {
        return Err(UpgradeError::TimelockExpired);
    }

    // Execute
    proposal.status = UpgradeStatus::Executed;

    Ok(ExecutionResult {
        proposal_id: proposal.proposal_id,
        executed_block: current_block,
        cells_upgraded: proposal.affected_cells,
        rollback_available: true,
    })
}

/// Cancel a proposal. Only the proposer or a guardian can cancel.
///
/// `caller` is the lock hash of the entity requesting cancellation.
/// `guardian` is the lock hash of the protocol guardian (optional).
pub fn cancel_proposal(
    proposal: &mut UpgradeProposal,
    caller: [u8; 32],
    guardian: Option<[u8; 32]>,
) -> Result<(), UpgradeError> {
    match proposal.status {
        UpgradeStatus::Executed => return Err(UpgradeError::AlreadyExecuted),
        UpgradeStatus::Cancelled => return Err(UpgradeError::AlreadyCancelled),
        _ => {}
    }

    // Authorize: must be proposer or guardian
    let is_proposer = caller == proposal.proposer;
    let is_guardian = guardian.map_or(false, |g| caller == g);

    if !is_proposer && !is_guardian {
        return Err(UpgradeError::NotAuthorized);
    }

    proposal.status = UpgradeStatus::Cancelled;
    Ok(())
}

/// Check if a proposal has expired and update its status if so.
///
/// A proposal expires when the current block is past
/// proposed_block + timelock_blocks + UPGRADE_WINDOW_BLOCKS
/// and it has not been executed.
pub fn check_expiry(
    proposal: &mut UpgradeProposal,
    current_block: u64,
) -> Result<bool, UpgradeError> {
    // Only non-terminal statuses can expire
    match proposal.status {
        UpgradeStatus::Executed | UpgradeStatus::Cancelled | UpgradeStatus::Expired => {
            return Ok(false);
        }
        UpgradeStatus::Pending | UpgradeStatus::Approved => {}
    }

    let timelock_end = proposal
        .proposed_block
        .checked_add(proposal.timelock_blocks)
        .ok_or(UpgradeError::Overflow)?;

    let window_end = timelock_end
        .checked_add(UPGRADE_WINDOW_BLOCKS)
        .ok_or(UpgradeError::Overflow)?;

    if current_block >= window_end {
        proposal.status = UpgradeStatus::Expired;
        return Ok(true);
    }

    Ok(false)
}

/// Create an emergency upgrade proposal with shorter timelock.
///
/// Emergency proposals use EMERGENCY_TIMELOCK_BLOCKS and require a
/// non-zero justification hash to demonstrate the emergency is justified.
pub fn create_emergency_proposal(
    proposal_id: u64,
    old_code_hash: [u8; 32],
    new_code_hash: [u8; 32],
    proposer: [u8; 32],
    current_block: u64,
    affected_cells: u64,
    justification_hash: [u8; 32],
    pending_count: usize,
) -> Result<UpgradeProposal, UpgradeError> {
    // Justification must be non-zero (actual justification exists off-chain)
    if justification_hash == [0u8; 32] {
        return Err(UpgradeError::EmergencyNotJustified);
    }

    create_proposal(
        proposal_id,
        old_code_hash,
        new_code_hash,
        proposer,
        current_block,
        EMERGENCY_TIMELOCK_BLOCKS,
        true,
        affected_cells,
        justification_hash,
        pending_count,
    )
}

/// Assess the impact of a proposed upgrade.
///
/// Analyzes the scope based on cell count, migration requirements,
/// and whether the change is breaking. Estimates gas cost proportional
/// to affected cells using PRECISION-scaled arithmetic.
pub fn assess_impact(
    affected_cells: u64,
    requires_migration: bool,
    breaking_change: bool,
) -> Result<UpgradeImpact, UpgradeError> {
    // Base cost per cell: 100_000 shannons (0.001 CKB)
    let base_cost_per_cell: u128 = 100_000;

    // Migration multiplier: 3x if migration required, 1x otherwise
    let multiplier: u128 = if requires_migration { 3 } else { 1 };

    // Breaking change adds 50% overhead
    let breaking_overhead_bps: u128 = if breaking_change { 15_000 } else { 10_000 };

    // estimated_gas = cells * base_cost * multiplier * overhead / BPS
    let cell_cost = (affected_cells as u128)
        .checked_mul(base_cost_per_cell)
        .ok_or(UpgradeError::Overflow)?;
    let with_multiplier = cell_cost
        .checked_mul(multiplier)
        .ok_or(UpgradeError::Overflow)?;
    let estimated_gas = mul_div(with_multiplier, breaking_overhead_bps, BPS);

    Ok(UpgradeImpact {
        affected_cell_count: affected_cells,
        requires_migration,
        breaking_change,
        estimated_gas,
    })
}

/// Validate compatibility between old and new code hashes.
///
/// In CKB's model, compatibility is determined by convention:
/// - Same hash = no upgrade needed (error)
/// - Both non-zero and different = potentially compatible
/// - Zero hash = invalid
///
/// The `versions_compatible` flag indicates whether the caller has verified
/// that the new script version is backward-compatible with the old.
pub fn validate_compatibility(
    old_code_hash: [u8; 32],
    new_code_hash: [u8; 32],
    versions_compatible: bool,
) -> Result<bool, UpgradeError> {
    if old_code_hash == [0u8; 32] || new_code_hash == [0u8; 32] {
        return Err(UpgradeError::InvalidCodeHash);
    }
    if old_code_hash == new_code_hash {
        return Err(UpgradeError::InvalidCodeHash);
    }
    if !versions_compatible {
        return Err(UpgradeError::IncompatibleVersion);
    }
    Ok(true)
}

/// Prepare rollback information for a executed upgrade.
///
/// Creates a RollbackInfo struct that captures everything needed
/// to revert the upgrade within the rollback deadline.
///
/// `rollback_window` is the number of blocks after execution during
/// which rollback remains possible.
pub fn prepare_rollback(
    original_code_hash: [u8; 32],
    executed_block: u64,
    rollback_window: u64,
    cells_to_revert: u64,
) -> Result<RollbackInfo, UpgradeError> {
    if original_code_hash == [0u8; 32] {
        return Err(UpgradeError::InvalidCodeHash);
    }

    let rollback_deadline = executed_block
        .checked_add(rollback_window)
        .ok_or(UpgradeError::Overflow)?;

    Ok(RollbackInfo {
        original_code_hash,
        rollback_deadline,
        cells_to_revert,
    })
}

/// Execute a rollback to the previous code hash.
///
/// Validates that rollback is still available (within deadline)
/// and returns the number of cells reverted.
pub fn execute_rollback(
    rollback_info: &RollbackInfo,
    current_block: u64,
) -> Result<u64, UpgradeError> {
    if current_block > rollback_info.rollback_deadline {
        return Err(UpgradeError::RollbackNotAvailable);
    }

    Ok(rollback_info.cells_to_revert)
}

/// Check whether rollback is still available for a given RollbackInfo.
pub fn is_rollback_available(
    rollback_info: &RollbackInfo,
    current_block: u64,
) -> bool {
    current_block <= rollback_info.rollback_deadline
}

/// Count the number of pending (non-terminal) proposals in a slice.
///
/// Terminal statuses are: Executed, Cancelled, Expired.
pub fn pending_upgrades_count(proposals: &[UpgradeProposal]) -> usize {
    proposals
        .iter()
        .filter(|p| matches!(p.status, UpgradeStatus::Pending | UpgradeStatus::Approved))
        .count()
}

/// Produce a summary of upgrade history from a list of proposals.
///
/// Returns `(total_proposals, executed_count, cancelled_count, expired_count, total_cells_upgraded)`.
pub fn upgrade_history_summary(
    proposals: &[UpgradeProposal],
) -> (usize, usize, usize, usize, u64) {
    let total = proposals.len();
    let mut executed = 0usize;
    let mut cancelled = 0usize;
    let mut expired = 0usize;
    let mut total_cells: u64 = 0;

    for p in proposals {
        match p.status {
            UpgradeStatus::Executed => {
                executed += 1;
                total_cells = total_cells.saturating_add(p.affected_cells);
            }
            UpgradeStatus::Cancelled => {
                cancelled += 1;
            }
            UpgradeStatus::Expired => {
                expired += 1;
            }
            _ => {}
        }
    }

    (total, executed, cancelled, expired, total_cells)
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn hash_a() -> [u8; 32] {
        let mut h = [0u8; 32];
        h[0] = 0xAA;
        h[31] = 0x01;
        h
    }

    fn hash_b() -> [u8; 32] {
        let mut h = [0u8; 32];
        h[0] = 0xBB;
        h[31] = 0x02;
        h
    }

    fn hash_c() -> [u8; 32] {
        let mut h = [0u8; 32];
        h[0] = 0xCC;
        h[31] = 0x03;
        h
    }

    fn zero_hash() -> [u8; 32] {
        [0u8; 32]
    }

    fn proposer_a() -> [u8; 32] {
        let mut h = [0u8; 32];
        h[0] = 0x01;
        h
    }

    fn proposer_b() -> [u8; 32] {
        let mut h = [0u8; 32];
        h[0] = 0x02;
        h
    }

    fn guardian() -> [u8; 32] {
        let mut h = [0u8; 32];
        h[0] = 0xFF;
        h
    }

    fn desc_hash() -> [u8; 32] {
        let mut h = [0u8; 32];
        h[0] = 0xDD;
        h
    }

    fn make_proposal(id: u64, timelock: u64, block: u64) -> UpgradeProposal {
        create_proposal(
            id,
            hash_a(),
            hash_b(),
            proposer_a(),
            block,
            timelock,
            false,
            100,
            desc_hash(),
            0,
        )
        .unwrap()
    }

    fn make_approved_proposal(id: u64, timelock: u64, block: u64) -> UpgradeProposal {
        let mut p = make_proposal(id, timelock, block);
        p.approval_bps = QUORUM_BPS;
        p.status = UpgradeStatus::Approved;
        p
    }

    fn make_emergency(id: u64, block: u64) -> UpgradeProposal {
        create_emergency_proposal(
            id,
            hash_a(),
            hash_b(),
            proposer_a(),
            block,
            50,
            desc_hash(),
            0,
        )
        .unwrap()
    }

    // ============ create_proposal Tests ============

    #[test]
    fn test_create_proposal_valid() {
        let p = create_proposal(
            1, hash_a(), hash_b(), proposer_a(), 1000,
            MIN_TIMELOCK_BLOCKS, false, 100, desc_hash(), 0,
        );
        assert!(p.is_ok());
        let p = p.unwrap();
        assert_eq!(p.proposal_id, 1);
        assert_eq!(p.old_code_hash, hash_a());
        assert_eq!(p.new_code_hash, hash_b());
        assert_eq!(p.proposed_block, 1000);
        assert_eq!(p.timelock_blocks, MIN_TIMELOCK_BLOCKS);
        assert_eq!(p.approval_bps, 0);
        assert_eq!(p.status, UpgradeStatus::Pending);
        assert!(!p.is_emergency);
    }

    #[test]
    fn test_create_proposal_max_timelock() {
        let p = create_proposal(
            1, hash_a(), hash_b(), proposer_a(), 0,
            MAX_TIMELOCK_BLOCKS, false, 50, desc_hash(), 0,
        );
        assert!(p.is_ok());
        assert_eq!(p.unwrap().timelock_blocks, MAX_TIMELOCK_BLOCKS);
    }

    #[test]
    fn test_create_proposal_mid_timelock() {
        let p = create_proposal(
            1, hash_a(), hash_b(), proposer_a(), 0,
            100_000, false, 50, desc_hash(), 0,
        );
        assert!(p.is_ok());
    }

    #[test]
    fn test_create_proposal_timelock_below_min() {
        let p = create_proposal(
            1, hash_a(), hash_b(), proposer_a(), 0,
            MIN_TIMELOCK_BLOCKS - 1, false, 50, desc_hash(), 0,
        );
        assert_eq!(p, Err(UpgradeError::InvalidTimelock));
    }

    #[test]
    fn test_create_proposal_timelock_above_max() {
        let p = create_proposal(
            1, hash_a(), hash_b(), proposer_a(), 0,
            MAX_TIMELOCK_BLOCKS + 1, false, 50, desc_hash(), 0,
        );
        assert_eq!(p, Err(UpgradeError::InvalidTimelock));
    }

    #[test]
    fn test_create_proposal_zero_timelock() {
        let p = create_proposal(
            1, hash_a(), hash_b(), proposer_a(), 0,
            0, false, 50, desc_hash(), 0,
        );
        assert_eq!(p, Err(UpgradeError::InvalidTimelock));
    }

    #[test]
    fn test_create_proposal_zero_old_hash() {
        let p = create_proposal(
            1, zero_hash(), hash_b(), proposer_a(), 0,
            MIN_TIMELOCK_BLOCKS, false, 50, desc_hash(), 0,
        );
        assert_eq!(p, Err(UpgradeError::InvalidCodeHash));
    }

    #[test]
    fn test_create_proposal_zero_new_hash() {
        let p = create_proposal(
            1, hash_a(), zero_hash(), proposer_a(), 0,
            MIN_TIMELOCK_BLOCKS, false, 50, desc_hash(), 0,
        );
        assert_eq!(p, Err(UpgradeError::InvalidCodeHash));
    }

    #[test]
    fn test_create_proposal_same_hashes() {
        let p = create_proposal(
            1, hash_a(), hash_a(), proposer_a(), 0,
            MIN_TIMELOCK_BLOCKS, false, 50, desc_hash(), 0,
        );
        assert_eq!(p, Err(UpgradeError::InvalidCodeHash));
    }

    #[test]
    fn test_create_proposal_max_pending_reached() {
        let p = create_proposal(
            1, hash_a(), hash_b(), proposer_a(), 0,
            MIN_TIMELOCK_BLOCKS, false, 50, desc_hash(), MAX_PENDING_UPGRADES,
        );
        assert_eq!(p, Err(UpgradeError::MaxPendingReached));
    }

    #[test]
    fn test_create_proposal_pending_just_under_max() {
        let p = create_proposal(
            1, hash_a(), hash_b(), proposer_a(), 0,
            MIN_TIMELOCK_BLOCKS, false, 50, desc_hash(), MAX_PENDING_UPGRADES - 1,
        );
        assert!(p.is_ok());
    }

    #[test]
    fn test_create_proposal_emergency_correct_timelock() {
        let p = create_proposal(
            1, hash_a(), hash_b(), proposer_a(), 0,
            EMERGENCY_TIMELOCK_BLOCKS, true, 50, desc_hash(), 0,
        );
        assert!(p.is_ok());
        assert!(p.unwrap().is_emergency);
    }

    #[test]
    fn test_create_proposal_emergency_wrong_timelock() {
        let p = create_proposal(
            1, hash_a(), hash_b(), proposer_a(), 0,
            MIN_TIMELOCK_BLOCKS, true, 50, desc_hash(), 0,
        );
        assert_eq!(p, Err(UpgradeError::InvalidTimelock));
    }

    #[test]
    fn test_create_proposal_zero_affected_cells() {
        let p = create_proposal(
            1, hash_a(), hash_b(), proposer_a(), 0,
            MIN_TIMELOCK_BLOCKS, false, 0, desc_hash(), 0,
        );
        assert!(p.is_ok());
        assert_eq!(p.unwrap().affected_cells, 0);
    }

    #[test]
    fn test_create_proposal_large_affected_cells() {
        let p = create_proposal(
            1, hash_a(), hash_b(), proposer_a(), 0,
            MIN_TIMELOCK_BLOCKS, false, u64::MAX, desc_hash(), 0,
        );
        assert!(p.is_ok());
        assert_eq!(p.unwrap().affected_cells, u64::MAX);
    }

    #[test]
    fn test_create_proposal_preserves_proposer() {
        let p = create_proposal(
            1, hash_a(), hash_b(), proposer_b(), 0,
            MIN_TIMELOCK_BLOCKS, false, 50, desc_hash(), 0,
        );
        assert_eq!(p.unwrap().proposer, proposer_b());
    }

    #[test]
    fn test_create_proposal_preserves_description_hash() {
        let dh = hash_c();
        let p = create_proposal(
            1, hash_a(), hash_b(), proposer_a(), 0,
            MIN_TIMELOCK_BLOCKS, false, 50, dh, 0,
        );
        assert_eq!(p.unwrap().description_hash, dh);
    }

    #[test]
    fn test_create_proposal_zero_block() {
        let p = create_proposal(
            1, hash_a(), hash_b(), proposer_a(), 0,
            MIN_TIMELOCK_BLOCKS, false, 50, desc_hash(), 0,
        );
        assert!(p.is_ok());
        assert_eq!(p.unwrap().proposed_block, 0);
    }

    #[test]
    fn test_create_proposal_large_block() {
        let p = create_proposal(
            1, hash_a(), hash_b(), proposer_a(), u64::MAX - MAX_TIMELOCK_BLOCKS,
            MIN_TIMELOCK_BLOCKS, false, 50, desc_hash(), 0,
        );
        assert!(p.is_ok());
    }

    #[test]
    fn test_create_proposal_id_zero() {
        let p = create_proposal(
            0, hash_a(), hash_b(), proposer_a(), 0,
            MIN_TIMELOCK_BLOCKS, false, 50, desc_hash(), 0,
        );
        assert!(p.is_ok());
        assert_eq!(p.unwrap().proposal_id, 0);
    }

    #[test]
    fn test_create_proposal_id_max() {
        let p = create_proposal(
            u64::MAX, hash_a(), hash_b(), proposer_a(), 0,
            MIN_TIMELOCK_BLOCKS, false, 50, desc_hash(), 0,
        );
        assert!(p.is_ok());
        assert_eq!(p.unwrap().proposal_id, u64::MAX);
    }

    // ============ approve_proposal Tests ============

    #[test]
    fn test_approve_proposal_basic() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let result = approve_proposal(&mut p, 1000, false);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 1000);
        assert_eq!(p.approval_bps, 1000);
        assert_eq!(p.status, UpgradeStatus::Pending);
    }

    #[test]
    fn test_approve_proposal_accumulates() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        approve_proposal(&mut p, 2000, false).unwrap();
        approve_proposal(&mut p, 1500, false).unwrap();
        assert_eq!(p.approval_bps, 3500);
        assert_eq!(p.status, UpgradeStatus::Pending);
    }

    #[test]
    fn test_approve_proposal_reaches_quorum() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        approve_proposal(&mut p, QUORUM_BPS, false).unwrap();
        assert_eq!(p.approval_bps, QUORUM_BPS);
        assert_eq!(p.status, UpgradeStatus::Approved);
    }

    #[test]
    fn test_approve_proposal_exceeds_quorum() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        approve_proposal(&mut p, QUORUM_BPS + 1000, false).unwrap();
        assert_eq!(p.status, UpgradeStatus::Approved);
    }

    #[test]
    fn test_approve_proposal_just_below_quorum() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        approve_proposal(&mut p, QUORUM_BPS - 1, false).unwrap();
        assert_eq!(p.status, UpgradeStatus::Pending);
    }

    #[test]
    fn test_approve_proposal_breaking_needs_super_majority() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        approve_proposal(&mut p, QUORUM_BPS, true).unwrap();
        // 5000 < 6667 super majority, still pending
        assert_eq!(p.status, UpgradeStatus::Pending);
    }

    #[test]
    fn test_approve_proposal_breaking_reaches_super_majority() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        approve_proposal(&mut p, SUPER_MAJORITY_BPS, true).unwrap();
        assert_eq!(p.status, UpgradeStatus::Approved);
    }

    #[test]
    fn test_approve_proposal_breaking_exceeds_super_majority() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        approve_proposal(&mut p, SUPER_MAJORITY_BPS + 500, true).unwrap();
        assert_eq!(p.status, UpgradeStatus::Approved);
    }

    #[test]
    fn test_approve_proposal_breaking_just_below_super_majority() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        approve_proposal(&mut p, SUPER_MAJORITY_BPS - 1, true).unwrap();
        assert_eq!(p.status, UpgradeStatus::Pending);
    }

    #[test]
    fn test_approve_proposal_caps_at_bps() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        approve_proposal(&mut p, 8000, false).unwrap();
        let result = approve_proposal(&mut p, 5000, false).unwrap();
        assert_eq!(result, BPS as u16);
        assert_eq!(p.approval_bps, BPS as u16);
    }

    #[test]
    fn test_approve_proposal_already_executed() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.status = UpgradeStatus::Executed;
        let result = approve_proposal(&mut p, 1000, false);
        assert_eq!(result, Err(UpgradeError::AlreadyExecuted));
    }

    #[test]
    fn test_approve_proposal_already_cancelled() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.status = UpgradeStatus::Cancelled;
        let result = approve_proposal(&mut p, 1000, false);
        assert_eq!(result, Err(UpgradeError::AlreadyCancelled));
    }

    #[test]
    fn test_approve_proposal_expired() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.status = UpgradeStatus::Expired;
        let result = approve_proposal(&mut p, 1000, false);
        assert_eq!(result, Err(UpgradeError::TimelockExpired));
    }

    #[test]
    fn test_approve_proposal_zero_additional() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let result = approve_proposal(&mut p, 0, false).unwrap();
        assert_eq!(result, 0);
        assert_eq!(p.status, UpgradeStatus::Pending);
    }

    #[test]
    fn test_approve_proposal_multiple_small_increments() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        for _ in 0..10 {
            approve_proposal(&mut p, 500, false).unwrap();
        }
        assert_eq!(p.approval_bps, 5000);
        assert_eq!(p.status, UpgradeStatus::Approved);
    }

    #[test]
    fn test_approve_proposal_already_approved_stays_approved() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        approve_proposal(&mut p, QUORUM_BPS, false).unwrap();
        assert_eq!(p.status, UpgradeStatus::Approved);
        // Additional approval keeps it approved
        approve_proposal(&mut p, 1000, false).unwrap();
        assert_eq!(p.status, UpgradeStatus::Approved);
    }

    #[test]
    fn test_approve_proposal_max_u16_bps() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let result = approve_proposal(&mut p, u16::MAX, false).unwrap();
        // Capped at BPS (10000)
        assert_eq!(result, BPS as u16);
    }

    #[test]
    fn test_approve_proposal_incremental_to_breaking() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        approve_proposal(&mut p, 3000, true).unwrap();
        assert_eq!(p.status, UpgradeStatus::Pending);
        approve_proposal(&mut p, 3000, true).unwrap();
        assert_eq!(p.status, UpgradeStatus::Pending);
        approve_proposal(&mut p, 1000, true).unwrap();
        // Now at 7000 >= 6667
        assert_eq!(p.status, UpgradeStatus::Approved);
    }

    // ============ can_execute Tests ============

    #[test]
    fn test_can_execute_approved_after_timelock() {
        let p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 1000);
        let current = 1000 + MIN_TIMELOCK_BLOCKS;
        let result = can_execute(&p, current, false).unwrap();
        assert!(result);
    }

    #[test]
    fn test_can_execute_approved_within_window() {
        let p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 1000);
        let current = 1000 + MIN_TIMELOCK_BLOCKS + UPGRADE_WINDOW_BLOCKS / 2;
        let result = can_execute(&p, current, false).unwrap();
        assert!(result);
    }

    #[test]
    fn test_can_execute_before_timelock() {
        let p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 1000);
        let current = 1000 + MIN_TIMELOCK_BLOCKS - 1;
        let result = can_execute(&p, current, false).unwrap();
        assert!(!result);
    }

    #[test]
    fn test_can_execute_after_window() {
        let p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 1000);
        let current = 1000 + MIN_TIMELOCK_BLOCKS + UPGRADE_WINDOW_BLOCKS;
        let result = can_execute(&p, current, false).unwrap();
        assert!(!result);
    }

    #[test]
    fn test_can_execute_at_window_boundary() {
        let p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 1000);
        // Last valid block is window_end - 1
        let current = 1000 + MIN_TIMELOCK_BLOCKS + UPGRADE_WINDOW_BLOCKS - 1;
        let result = can_execute(&p, current, false).unwrap();
        assert!(result);
    }

    #[test]
    fn test_can_execute_pending_status() {
        let p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let result = can_execute(&p, MIN_TIMELOCK_BLOCKS + 1, false).unwrap();
        assert!(!result);
    }

    #[test]
    fn test_can_execute_executed_status() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.status = UpgradeStatus::Executed;
        let result = can_execute(&p, MIN_TIMELOCK_BLOCKS + 1, false).unwrap();
        assert!(!result);
    }

    #[test]
    fn test_can_execute_cancelled_status() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.status = UpgradeStatus::Cancelled;
        let result = can_execute(&p, MIN_TIMELOCK_BLOCKS + 1, false).unwrap();
        assert!(!result);
    }

    #[test]
    fn test_can_execute_insufficient_approval_breaking() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.approval_bps = QUORUM_BPS; // 5000 < 6667
        let result = can_execute(&p, MIN_TIMELOCK_BLOCKS + 1, true).unwrap();
        assert!(!result);
    }

    #[test]
    fn test_can_execute_sufficient_approval_breaking() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.approval_bps = SUPER_MAJORITY_BPS;
        let result = can_execute(&p, MIN_TIMELOCK_BLOCKS + 1, true).unwrap();
        assert!(result);
    }

    #[test]
    fn test_can_execute_exactly_at_timelock() {
        let p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let result = can_execute(&p, MIN_TIMELOCK_BLOCKS, false).unwrap();
        assert!(result);
    }

    #[test]
    fn test_can_execute_emergency_shorter_timelock() {
        let mut p = make_emergency(1, 0);
        p.approval_bps = QUORUM_BPS;
        p.status = UpgradeStatus::Approved;
        let result = can_execute(&p, EMERGENCY_TIMELOCK_BLOCKS, false).unwrap();
        assert!(result);
    }

    // ============ execute_upgrade Tests ============

    #[test]
    fn test_execute_upgrade_success() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 1000);
        let exec_block = 1000 + MIN_TIMELOCK_BLOCKS;
        let result = execute_upgrade(&mut p, exec_block, false);
        assert!(result.is_ok());
        let r = result.unwrap();
        assert_eq!(r.proposal_id, 1);
        assert_eq!(r.executed_block, exec_block);
        assert_eq!(r.cells_upgraded, 100);
        assert!(r.rollback_available);
        assert_eq!(p.status, UpgradeStatus::Executed);
    }

    #[test]
    fn test_execute_upgrade_before_timelock() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 1000);
        let result = execute_upgrade(&mut p, 1000 + MIN_TIMELOCK_BLOCKS - 1, false);
        assert_eq!(result, Err(UpgradeError::TimelockNotMet));
    }

    #[test]
    fn test_execute_upgrade_after_window() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 1000);
        let expired_block = 1000 + MIN_TIMELOCK_BLOCKS + UPGRADE_WINDOW_BLOCKS;
        let result = execute_upgrade(&mut p, expired_block, false);
        assert_eq!(result, Err(UpgradeError::TimelockExpired));
    }

    #[test]
    fn test_execute_upgrade_already_executed() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.status = UpgradeStatus::Executed;
        let result = execute_upgrade(&mut p, MIN_TIMELOCK_BLOCKS, false);
        assert_eq!(result, Err(UpgradeError::AlreadyExecuted));
    }

    #[test]
    fn test_execute_upgrade_already_cancelled() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.status = UpgradeStatus::Cancelled;
        let result = execute_upgrade(&mut p, MIN_TIMELOCK_BLOCKS, false);
        assert_eq!(result, Err(UpgradeError::AlreadyCancelled));
    }

    #[test]
    fn test_execute_upgrade_expired_status() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.status = UpgradeStatus::Expired;
        let result = execute_upgrade(&mut p, MIN_TIMELOCK_BLOCKS, false);
        assert_eq!(result, Err(UpgradeError::TimelockExpired));
    }

    #[test]
    fn test_execute_upgrade_pending_status() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let result = execute_upgrade(&mut p, MIN_TIMELOCK_BLOCKS, false);
        assert_eq!(result, Err(UpgradeError::InsufficientApproval));
    }

    #[test]
    fn test_execute_upgrade_insufficient_approval_non_breaking() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.approval_bps = QUORUM_BPS - 1;
        let result = execute_upgrade(&mut p, MIN_TIMELOCK_BLOCKS, false);
        assert_eq!(result, Err(UpgradeError::InsufficientApproval));
    }

    #[test]
    fn test_execute_upgrade_insufficient_approval_breaking() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.approval_bps = QUORUM_BPS; // 5000 < 6667
        let result = execute_upgrade(&mut p, MIN_TIMELOCK_BLOCKS, true);
        assert_eq!(result, Err(UpgradeError::InsufficientApproval));
    }

    #[test]
    fn test_execute_upgrade_breaking_with_super_majority() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.approval_bps = SUPER_MAJORITY_BPS;
        let result = execute_upgrade(&mut p, MIN_TIMELOCK_BLOCKS, true);
        assert!(result.is_ok());
    }

    #[test]
    fn test_execute_upgrade_at_window_end_minus_one() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let result = execute_upgrade(&mut p, MIN_TIMELOCK_BLOCKS + UPGRADE_WINDOW_BLOCKS - 1, false);
        assert!(result.is_ok());
    }

    #[test]
    fn test_execute_upgrade_zero_cells() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.affected_cells = 0;
        let result = execute_upgrade(&mut p, MIN_TIMELOCK_BLOCKS, false).unwrap();
        assert_eq!(result.cells_upgraded, 0);
    }

    #[test]
    fn test_execute_upgrade_large_cells() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.affected_cells = u64::MAX;
        let result = execute_upgrade(&mut p, MIN_TIMELOCK_BLOCKS, false).unwrap();
        assert_eq!(result.cells_upgraded, u64::MAX);
    }

    // ============ cancel_proposal Tests ============

    #[test]
    fn test_cancel_by_proposer() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let result = cancel_proposal(&mut p, proposer_a(), None);
        assert!(result.is_ok());
        assert_eq!(p.status, UpgradeStatus::Cancelled);
    }

    #[test]
    fn test_cancel_by_guardian() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let result = cancel_proposal(&mut p, guardian(), Some(guardian()));
        assert!(result.is_ok());
        assert_eq!(p.status, UpgradeStatus::Cancelled);
    }

    #[test]
    fn test_cancel_by_unauthorized() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let result = cancel_proposal(&mut p, proposer_b(), None);
        assert_eq!(result, Err(UpgradeError::NotAuthorized));
    }

    #[test]
    fn test_cancel_by_unauthorized_with_different_guardian() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let result = cancel_proposal(&mut p, proposer_b(), Some(guardian()));
        assert_eq!(result, Err(UpgradeError::NotAuthorized));
    }

    #[test]
    fn test_cancel_already_executed() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.status = UpgradeStatus::Executed;
        let result = cancel_proposal(&mut p, proposer_a(), None);
        assert_eq!(result, Err(UpgradeError::AlreadyExecuted));
    }

    #[test]
    fn test_cancel_already_cancelled() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.status = UpgradeStatus::Cancelled;
        let result = cancel_proposal(&mut p, proposer_a(), None);
        assert_eq!(result, Err(UpgradeError::AlreadyCancelled));
    }

    #[test]
    fn test_cancel_approved_by_proposer() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let result = cancel_proposal(&mut p, proposer_a(), None);
        assert!(result.is_ok());
        assert_eq!(p.status, UpgradeStatus::Cancelled);
    }

    #[test]
    fn test_cancel_approved_by_guardian() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let result = cancel_proposal(&mut p, guardian(), Some(guardian()));
        assert!(result.is_ok());
        assert_eq!(p.status, UpgradeStatus::Cancelled);
    }

    #[test]
    fn test_cancel_expired_by_proposer() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.status = UpgradeStatus::Expired;
        // Expired is not a terminal error for cancellation — it can still be cancelled
        let result = cancel_proposal(&mut p, proposer_a(), None);
        assert!(result.is_ok());
        assert_eq!(p.status, UpgradeStatus::Cancelled);
    }

    // ============ check_expiry Tests ============

    #[test]
    fn test_check_expiry_pending_not_expired() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 1000);
        let result = check_expiry(&mut p, 1000 + MIN_TIMELOCK_BLOCKS).unwrap();
        assert!(!result);
        assert_eq!(p.status, UpgradeStatus::Pending);
    }

    #[test]
    fn test_check_expiry_pending_expired() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 1000);
        let expired_block = 1000 + MIN_TIMELOCK_BLOCKS + UPGRADE_WINDOW_BLOCKS;
        let result = check_expiry(&mut p, expired_block).unwrap();
        assert!(result);
        assert_eq!(p.status, UpgradeStatus::Expired);
    }

    #[test]
    fn test_check_expiry_approved_expired() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 1000);
        let expired_block = 1000 + MIN_TIMELOCK_BLOCKS + UPGRADE_WINDOW_BLOCKS;
        let result = check_expiry(&mut p, expired_block).unwrap();
        assert!(result);
        assert_eq!(p.status, UpgradeStatus::Expired);
    }

    #[test]
    fn test_check_expiry_already_executed() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.status = UpgradeStatus::Executed;
        let result = check_expiry(&mut p, u64::MAX).unwrap();
        assert!(!result);
    }

    #[test]
    fn test_check_expiry_already_cancelled() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.status = UpgradeStatus::Cancelled;
        let result = check_expiry(&mut p, u64::MAX).unwrap();
        assert!(!result);
    }

    #[test]
    fn test_check_expiry_already_expired() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.status = UpgradeStatus::Expired;
        let result = check_expiry(&mut p, u64::MAX).unwrap();
        assert!(!result);
    }

    #[test]
    fn test_check_expiry_at_window_boundary() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let boundary = MIN_TIMELOCK_BLOCKS + UPGRADE_WINDOW_BLOCKS;
        let result = check_expiry(&mut p, boundary).unwrap();
        assert!(result);
        assert_eq!(p.status, UpgradeStatus::Expired);
    }

    #[test]
    fn test_check_expiry_just_before_boundary() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let before = MIN_TIMELOCK_BLOCKS + UPGRADE_WINDOW_BLOCKS - 1;
        let result = check_expiry(&mut p, before).unwrap();
        assert!(!result);
        assert_eq!(p.status, UpgradeStatus::Pending);
    }

    // ============ create_emergency_proposal Tests ============

    #[test]
    fn test_create_emergency_valid() {
        let p = create_emergency_proposal(
            1, hash_a(), hash_b(), proposer_a(), 1000, 50, desc_hash(), 0,
        );
        assert!(p.is_ok());
        let p = p.unwrap();
        assert!(p.is_emergency);
        assert_eq!(p.timelock_blocks, EMERGENCY_TIMELOCK_BLOCKS);
        assert_eq!(p.description_hash, desc_hash());
    }

    #[test]
    fn test_create_emergency_zero_justification() {
        let p = create_emergency_proposal(
            1, hash_a(), hash_b(), proposer_a(), 1000, 50, zero_hash(), 0,
        );
        assert_eq!(p, Err(UpgradeError::EmergencyNotJustified));
    }

    #[test]
    fn test_create_emergency_invalid_old_hash() {
        let p = create_emergency_proposal(
            1, zero_hash(), hash_b(), proposer_a(), 1000, 50, desc_hash(), 0,
        );
        assert_eq!(p, Err(UpgradeError::InvalidCodeHash));
    }

    #[test]
    fn test_create_emergency_invalid_new_hash() {
        let p = create_emergency_proposal(
            1, hash_a(), zero_hash(), proposer_a(), 1000, 50, desc_hash(), 0,
        );
        assert_eq!(p, Err(UpgradeError::InvalidCodeHash));
    }

    #[test]
    fn test_create_emergency_same_hashes() {
        let p = create_emergency_proposal(
            1, hash_a(), hash_a(), proposer_a(), 1000, 50, desc_hash(), 0,
        );
        assert_eq!(p, Err(UpgradeError::InvalidCodeHash));
    }

    #[test]
    fn test_create_emergency_max_pending() {
        let p = create_emergency_proposal(
            1, hash_a(), hash_b(), proposer_a(), 1000, 50, desc_hash(), MAX_PENDING_UPGRADES,
        );
        assert_eq!(p, Err(UpgradeError::MaxPendingReached));
    }

    #[test]
    fn test_create_emergency_zero_cells() {
        let p = create_emergency_proposal(
            1, hash_a(), hash_b(), proposer_a(), 1000, 0, desc_hash(), 0,
        );
        assert!(p.is_ok());
        assert_eq!(p.unwrap().affected_cells, 0);
    }

    // ============ assess_impact Tests ============

    #[test]
    fn test_assess_impact_small_non_breaking() {
        let impact = assess_impact(10, false, false).unwrap();
        assert_eq!(impact.affected_cell_count, 10);
        assert!(!impact.requires_migration);
        assert!(!impact.breaking_change);
        // 10 * 100_000 * 1 * 10_000 / 10_000 = 1_000_000
        assert_eq!(impact.estimated_gas, 1_000_000);
    }

    #[test]
    fn test_assess_impact_with_migration() {
        let impact = assess_impact(10, true, false).unwrap();
        assert!(impact.requires_migration);
        // 10 * 100_000 * 3 * 10_000 / 10_000 = 3_000_000
        assert_eq!(impact.estimated_gas, 3_000_000);
    }

    #[test]
    fn test_assess_impact_breaking_change() {
        let impact = assess_impact(10, false, true).unwrap();
        assert!(impact.breaking_change);
        // 10 * 100_000 * 1 * 15_000 / 10_000 = 1_500_000
        assert_eq!(impact.estimated_gas, 1_500_000);
    }

    #[test]
    fn test_assess_impact_migration_and_breaking() {
        let impact = assess_impact(10, true, true).unwrap();
        assert!(impact.requires_migration);
        assert!(impact.breaking_change);
        // 10 * 100_000 * 3 * 15_000 / 10_000 = 4_500_000
        assert_eq!(impact.estimated_gas, 4_500_000);
    }

    #[test]
    fn test_assess_impact_zero_cells() {
        let impact = assess_impact(0, false, false).unwrap();
        assert_eq!(impact.affected_cell_count, 0);
        assert_eq!(impact.estimated_gas, 0);
    }

    #[test]
    fn test_assess_impact_one_cell() {
        let impact = assess_impact(1, false, false).unwrap();
        assert_eq!(impact.estimated_gas, 100_000);
    }

    #[test]
    fn test_assess_impact_large_cells() {
        let impact = assess_impact(1_000_000, false, false).unwrap();
        // 1_000_000 * 100_000 = 100_000_000_000
        assert_eq!(impact.estimated_gas, 100_000_000_000);
    }

    #[test]
    fn test_assess_impact_large_cells_with_migration_and_breaking() {
        let impact = assess_impact(1_000_000, true, true).unwrap();
        // 1_000_000 * 100_000 * 3 * 15_000 / 10_000 = 450_000_000_000
        assert_eq!(impact.estimated_gas, 450_000_000_000);
    }

    // ============ validate_compatibility Tests ============

    #[test]
    fn test_validate_compatibility_valid() {
        let result = validate_compatibility(hash_a(), hash_b(), true);
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[test]
    fn test_validate_compatibility_incompatible() {
        let result = validate_compatibility(hash_a(), hash_b(), false);
        assert_eq!(result, Err(UpgradeError::IncompatibleVersion));
    }

    #[test]
    fn test_validate_compatibility_zero_old() {
        let result = validate_compatibility(zero_hash(), hash_b(), true);
        assert_eq!(result, Err(UpgradeError::InvalidCodeHash));
    }

    #[test]
    fn test_validate_compatibility_zero_new() {
        let result = validate_compatibility(hash_a(), zero_hash(), true);
        assert_eq!(result, Err(UpgradeError::InvalidCodeHash));
    }

    #[test]
    fn test_validate_compatibility_same_hash() {
        let result = validate_compatibility(hash_a(), hash_a(), true);
        assert_eq!(result, Err(UpgradeError::InvalidCodeHash));
    }

    #[test]
    fn test_validate_compatibility_both_zero() {
        let result = validate_compatibility(zero_hash(), zero_hash(), true);
        assert_eq!(result, Err(UpgradeError::InvalidCodeHash));
    }

    #[test]
    fn test_validate_compatibility_incompatible_with_zero_old() {
        let result = validate_compatibility(zero_hash(), hash_b(), false);
        // Zero hash error takes precedence
        assert_eq!(result, Err(UpgradeError::InvalidCodeHash));
    }

    // ============ prepare_rollback Tests ============

    #[test]
    fn test_prepare_rollback_valid() {
        let rb = prepare_rollback(hash_a(), 1000, 50_000, 100).unwrap();
        assert_eq!(rb.original_code_hash, hash_a());
        assert_eq!(rb.rollback_deadline, 51_000);
        assert_eq!(rb.cells_to_revert, 100);
    }

    #[test]
    fn test_prepare_rollback_zero_hash() {
        let result = prepare_rollback(zero_hash(), 1000, 50_000, 100);
        assert_eq!(result, Err(UpgradeError::InvalidCodeHash));
    }

    #[test]
    fn test_prepare_rollback_overflow() {
        let result = prepare_rollback(hash_a(), u64::MAX, 1, 100);
        assert_eq!(result, Err(UpgradeError::Overflow));
    }

    #[test]
    fn test_prepare_rollback_zero_window() {
        let rb = prepare_rollback(hash_a(), 1000, 0, 100).unwrap();
        assert_eq!(rb.rollback_deadline, 1000);
    }

    #[test]
    fn test_prepare_rollback_zero_cells() {
        let rb = prepare_rollback(hash_a(), 1000, 50_000, 0).unwrap();
        assert_eq!(rb.cells_to_revert, 0);
    }

    #[test]
    fn test_prepare_rollback_large_window() {
        let rb = prepare_rollback(hash_a(), 0, u64::MAX, 100).unwrap();
        assert_eq!(rb.rollback_deadline, u64::MAX);
    }

    #[test]
    fn test_prepare_rollback_large_cells() {
        let rb = prepare_rollback(hash_a(), 1000, 50_000, u64::MAX).unwrap();
        assert_eq!(rb.cells_to_revert, u64::MAX);
    }

    // ============ execute_rollback Tests ============

    #[test]
    fn test_execute_rollback_within_deadline() {
        let rb = RollbackInfo {
            original_code_hash: hash_a(),
            rollback_deadline: 10_000,
            cells_to_revert: 50,
        };
        let result = execute_rollback(&rb, 5_000).unwrap();
        assert_eq!(result, 50);
    }

    #[test]
    fn test_execute_rollback_at_deadline() {
        let rb = RollbackInfo {
            original_code_hash: hash_a(),
            rollback_deadline: 10_000,
            cells_to_revert: 50,
        };
        let result = execute_rollback(&rb, 10_000).unwrap();
        assert_eq!(result, 50);
    }

    #[test]
    fn test_execute_rollback_past_deadline() {
        let rb = RollbackInfo {
            original_code_hash: hash_a(),
            rollback_deadline: 10_000,
            cells_to_revert: 50,
        };
        let result = execute_rollback(&rb, 10_001);
        assert_eq!(result, Err(UpgradeError::RollbackNotAvailable));
    }

    #[test]
    fn test_execute_rollback_zero_cells() {
        let rb = RollbackInfo {
            original_code_hash: hash_a(),
            rollback_deadline: 10_000,
            cells_to_revert: 0,
        };
        let result = execute_rollback(&rb, 5_000).unwrap();
        assert_eq!(result, 0);
    }

    #[test]
    fn test_execute_rollback_block_zero() {
        let rb = RollbackInfo {
            original_code_hash: hash_a(),
            rollback_deadline: 10_000,
            cells_to_revert: 100,
        };
        let result = execute_rollback(&rb, 0).unwrap();
        assert_eq!(result, 100);
    }

    #[test]
    fn test_execute_rollback_max_deadline() {
        let rb = RollbackInfo {
            original_code_hash: hash_a(),
            rollback_deadline: u64::MAX,
            cells_to_revert: 100,
        };
        let result = execute_rollback(&rb, u64::MAX).unwrap();
        assert_eq!(result, 100);
    }

    // ============ is_rollback_available Tests ============

    #[test]
    fn test_is_rollback_available_before_deadline() {
        let rb = RollbackInfo {
            original_code_hash: hash_a(),
            rollback_deadline: 10_000,
            cells_to_revert: 50,
        };
        assert!(is_rollback_available(&rb, 5_000));
    }

    #[test]
    fn test_is_rollback_available_at_deadline() {
        let rb = RollbackInfo {
            original_code_hash: hash_a(),
            rollback_deadline: 10_000,
            cells_to_revert: 50,
        };
        assert!(is_rollback_available(&rb, 10_000));
    }

    #[test]
    fn test_is_rollback_available_past_deadline() {
        let rb = RollbackInfo {
            original_code_hash: hash_a(),
            rollback_deadline: 10_000,
            cells_to_revert: 50,
        };
        assert!(!is_rollback_available(&rb, 10_001));
    }

    #[test]
    fn test_is_rollback_available_at_zero() {
        let rb = RollbackInfo {
            original_code_hash: hash_a(),
            rollback_deadline: 0,
            cells_to_revert: 50,
        };
        assert!(is_rollback_available(&rb, 0));
        assert!(!is_rollback_available(&rb, 1));
    }

    #[test]
    fn test_is_rollback_available_max_deadline() {
        let rb = RollbackInfo {
            original_code_hash: hash_a(),
            rollback_deadline: u64::MAX,
            cells_to_revert: 50,
        };
        assert!(is_rollback_available(&rb, u64::MAX));
    }

    // ============ pending_upgrades_count Tests ============

    #[test]
    fn test_pending_count_empty() {
        let proposals: Vec<UpgradeProposal> = vec![];
        assert_eq!(pending_upgrades_count(&proposals), 0);
    }

    #[test]
    fn test_pending_count_all_pending() {
        let proposals = vec![
            make_proposal(1, MIN_TIMELOCK_BLOCKS, 0),
            make_proposal(2, MIN_TIMELOCK_BLOCKS, 0),
            make_proposal(3, MIN_TIMELOCK_BLOCKS, 0),
        ];
        assert_eq!(pending_upgrades_count(&proposals), 3);
    }

    #[test]
    fn test_pending_count_mixed_statuses() {
        let mut p1 = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let p2 = make_approved_proposal(2, MIN_TIMELOCK_BLOCKS, 0);
        let mut p3 = make_proposal(3, MIN_TIMELOCK_BLOCKS, 0);
        p3.status = UpgradeStatus::Executed;
        let mut p4 = make_proposal(4, MIN_TIMELOCK_BLOCKS, 0);
        p4.status = UpgradeStatus::Cancelled;
        let mut p5 = make_proposal(5, MIN_TIMELOCK_BLOCKS, 0);
        p5.status = UpgradeStatus::Expired;
        p1.status = UpgradeStatus::Pending;

        let proposals = vec![p1, p2, p3, p4, p5];
        // Pending + Approved = 2
        assert_eq!(pending_upgrades_count(&proposals), 2);
    }

    #[test]
    fn test_pending_count_all_executed() {
        let mut p1 = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let mut p2 = make_proposal(2, MIN_TIMELOCK_BLOCKS, 0);
        p1.status = UpgradeStatus::Executed;
        p2.status = UpgradeStatus::Executed;
        assert_eq!(pending_upgrades_count(&[p1, p2]), 0);
    }

    #[test]
    fn test_pending_count_all_cancelled() {
        let mut p1 = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let mut p2 = make_proposal(2, MIN_TIMELOCK_BLOCKS, 0);
        p1.status = UpgradeStatus::Cancelled;
        p2.status = UpgradeStatus::Cancelled;
        assert_eq!(pending_upgrades_count(&[p1, p2]), 0);
    }

    #[test]
    fn test_pending_count_all_expired() {
        let mut p1 = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let mut p2 = make_proposal(2, MIN_TIMELOCK_BLOCKS, 0);
        p1.status = UpgradeStatus::Expired;
        p2.status = UpgradeStatus::Expired;
        assert_eq!(pending_upgrades_count(&[p1, p2]), 0);
    }

    #[test]
    fn test_pending_count_only_approved() {
        let p1 = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let p2 = make_approved_proposal(2, MIN_TIMELOCK_BLOCKS, 0);
        assert_eq!(pending_upgrades_count(&[p1, p2]), 2);
    }

    // ============ upgrade_history_summary Tests ============

    #[test]
    fn test_history_summary_empty() {
        let (total, exec, cancel, expired, cells) = upgrade_history_summary(&[]);
        assert_eq!(total, 0);
        assert_eq!(exec, 0);
        assert_eq!(cancel, 0);
        assert_eq!(expired, 0);
        assert_eq!(cells, 0);
    }

    #[test]
    fn test_history_summary_all_executed() {
        let mut p1 = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p1.status = UpgradeStatus::Executed;
        p1.affected_cells = 100;
        let mut p2 = make_proposal(2, MIN_TIMELOCK_BLOCKS, 0);
        p2.status = UpgradeStatus::Executed;
        p2.affected_cells = 200;

        let (total, exec, cancel, expired, cells) = upgrade_history_summary(&[p1, p2]);
        assert_eq!(total, 2);
        assert_eq!(exec, 2);
        assert_eq!(cancel, 0);
        assert_eq!(expired, 0);
        assert_eq!(cells, 300);
    }

    #[test]
    fn test_history_summary_mixed() {
        let mut p1 = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p1.status = UpgradeStatus::Executed;
        p1.affected_cells = 50;
        let mut p2 = make_proposal(2, MIN_TIMELOCK_BLOCKS, 0);
        p2.status = UpgradeStatus::Cancelled;
        let mut p3 = make_proposal(3, MIN_TIMELOCK_BLOCKS, 0);
        p3.status = UpgradeStatus::Expired;
        let p4 = make_proposal(4, MIN_TIMELOCK_BLOCKS, 0); // Pending

        let (total, exec, cancel, expired, cells) = upgrade_history_summary(&[p1, p2, p3, p4]);
        assert_eq!(total, 4);
        assert_eq!(exec, 1);
        assert_eq!(cancel, 1);
        assert_eq!(expired, 1);
        assert_eq!(cells, 50);
    }

    #[test]
    fn test_history_summary_cells_saturating() {
        let mut p1 = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p1.status = UpgradeStatus::Executed;
        p1.affected_cells = u64::MAX;
        let mut p2 = make_proposal(2, MIN_TIMELOCK_BLOCKS, 0);
        p2.status = UpgradeStatus::Executed;
        p2.affected_cells = 1;

        let (_, _, _, _, cells) = upgrade_history_summary(&[p1, p2]);
        assert_eq!(cells, u64::MAX); // Saturated
    }

    #[test]
    fn test_history_summary_only_pending() {
        let proposals = vec![
            make_proposal(1, MIN_TIMELOCK_BLOCKS, 0),
            make_proposal(2, MIN_TIMELOCK_BLOCKS, 0),
        ];
        let (total, exec, cancel, expired, cells) = upgrade_history_summary(&proposals);
        assert_eq!(total, 2);
        assert_eq!(exec, 0);
        assert_eq!(cancel, 0);
        assert_eq!(expired, 0);
        assert_eq!(cells, 0);
    }

    // ============ Integration / Edge Case Tests ============

    #[test]
    fn test_full_lifecycle_create_approve_execute() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 1000);
        assert_eq!(p.status, UpgradeStatus::Pending);

        // Approve to quorum
        approve_proposal(&mut p, QUORUM_BPS, false).unwrap();
        assert_eq!(p.status, UpgradeStatus::Approved);

        // Can't execute before timelock
        assert!(!can_execute(&p, 1000 + MIN_TIMELOCK_BLOCKS - 1, false).unwrap());

        // Execute after timelock
        let exec_block = 1000 + MIN_TIMELOCK_BLOCKS;
        let result = execute_upgrade(&mut p, exec_block, false).unwrap();
        assert_eq!(result.proposal_id, 1);
        assert_eq!(p.status, UpgradeStatus::Executed);
    }

    #[test]
    fn test_full_lifecycle_create_approve_expire() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 1000);
        approve_proposal(&mut p, QUORUM_BPS, false).unwrap();

        // Don't execute in time
        let expired_block = 1000 + MIN_TIMELOCK_BLOCKS + UPGRADE_WINDOW_BLOCKS;
        let did_expire = check_expiry(&mut p, expired_block).unwrap();
        assert!(did_expire);
        assert_eq!(p.status, UpgradeStatus::Expired);
    }

    #[test]
    fn test_full_lifecycle_create_cancel() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 1000);
        cancel_proposal(&mut p, proposer_a(), None).unwrap();
        assert_eq!(p.status, UpgradeStatus::Cancelled);

        // Can't approve after cancel
        let result = approve_proposal(&mut p, 1000, false);
        assert_eq!(result, Err(UpgradeError::AlreadyCancelled));
    }

    #[test]
    fn test_full_lifecycle_execute_then_rollback() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let exec_block = MIN_TIMELOCK_BLOCKS;
        let result = execute_upgrade(&mut p, exec_block, false).unwrap();

        // Prepare rollback
        let rb = prepare_rollback(
            p.old_code_hash,
            result.executed_block,
            50_000,
            result.cells_upgraded,
        )
        .unwrap();

        // Rollback within deadline
        assert!(is_rollback_available(&rb, exec_block + 10_000));
        let reverted = execute_rollback(&rb, exec_block + 10_000).unwrap();
        assert_eq!(reverted, 100);
    }

    #[test]
    fn test_full_lifecycle_execute_rollback_expired() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let exec_block = MIN_TIMELOCK_BLOCKS;
        let result = execute_upgrade(&mut p, exec_block, false).unwrap();

        let rb = prepare_rollback(
            p.old_code_hash,
            result.executed_block,
            50_000,
            result.cells_upgraded,
        )
        .unwrap();

        // Rollback after deadline
        assert!(!is_rollback_available(&rb, exec_block + 50_001));
        let rollback_result = execute_rollback(&rb, exec_block + 50_001);
        assert_eq!(rollback_result, Err(UpgradeError::RollbackNotAvailable));
    }

    #[test]
    fn test_emergency_lifecycle() {
        let mut p = make_emergency(1, 1000);
        assert!(p.is_emergency);
        assert_eq!(p.timelock_blocks, EMERGENCY_TIMELOCK_BLOCKS);

        approve_proposal(&mut p, QUORUM_BPS, false).unwrap();
        assert_eq!(p.status, UpgradeStatus::Approved);

        let exec_block = 1000 + EMERGENCY_TIMELOCK_BLOCKS;
        let result = execute_upgrade(&mut p, exec_block, false).unwrap();
        assert_eq!(result.executed_block, exec_block);
    }

    #[test]
    fn test_multiple_proposals_pending_count() {
        let p1 = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let p2 = make_proposal(2, MIN_TIMELOCK_BLOCKS, 0);
        let p3 = make_approved_proposal(3, MIN_TIMELOCK_BLOCKS, 0);
        let mut p4 = make_proposal(4, MIN_TIMELOCK_BLOCKS, 0);
        p4.status = UpgradeStatus::Executed;

        let proposals = vec![p1, p2, p3, p4];
        assert_eq!(pending_upgrades_count(&proposals), 3);
    }

    #[test]
    fn test_impact_zero_cells_no_migration_no_breaking() {
        let impact = assess_impact(0, false, false).unwrap();
        assert_eq!(impact.affected_cell_count, 0);
        assert!(!impact.requires_migration);
        assert!(!impact.breaking_change);
        assert_eq!(impact.estimated_gas, 0);
    }

    #[test]
    fn test_compatibility_then_proposal() {
        // First validate compatibility
        validate_compatibility(hash_a(), hash_b(), true).unwrap();
        // Then create proposal
        let p = create_proposal(
            1, hash_a(), hash_b(), proposer_a(), 0,
            MIN_TIMELOCK_BLOCKS, false, 100, desc_hash(), 0,
        );
        assert!(p.is_ok());
    }

    #[test]
    fn test_double_execution_prevented() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        execute_upgrade(&mut p, MIN_TIMELOCK_BLOCKS, false).unwrap();
        let result = execute_upgrade(&mut p, MIN_TIMELOCK_BLOCKS + 1, false);
        assert_eq!(result, Err(UpgradeError::AlreadyExecuted));
    }

    #[test]
    fn test_approve_after_execution_fails() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        execute_upgrade(&mut p, MIN_TIMELOCK_BLOCKS, false).unwrap();
        let result = approve_proposal(&mut p, 1000, false);
        assert_eq!(result, Err(UpgradeError::AlreadyExecuted));
    }

    #[test]
    fn test_cancel_after_execution_fails() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        execute_upgrade(&mut p, MIN_TIMELOCK_BLOCKS, false).unwrap();
        let result = cancel_proposal(&mut p, proposer_a(), None);
        assert_eq!(result, Err(UpgradeError::AlreadyExecuted));
    }

    #[test]
    fn test_check_expiry_after_execution_no_change() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        execute_upgrade(&mut p, MIN_TIMELOCK_BLOCKS, false).unwrap();
        let result = check_expiry(&mut p, u64::MAX).unwrap();
        assert!(!result);
        assert_eq!(p.status, UpgradeStatus::Executed);
    }

    #[test]
    fn test_breaking_change_quorum_not_enough() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        // Approve with regular quorum
        approve_proposal(&mut p, QUORUM_BPS, false).unwrap();
        assert_eq!(p.status, UpgradeStatus::Approved);

        // But can't execute as breaking with only quorum
        let result = execute_upgrade(&mut p, MIN_TIMELOCK_BLOCKS, true);
        assert_eq!(result, Err(UpgradeError::InsufficientApproval));
    }

    #[test]
    fn test_breaking_change_super_majority_sufficient() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        approve_proposal(&mut p, SUPER_MAJORITY_BPS, true).unwrap();
        assert_eq!(p.status, UpgradeStatus::Approved);
        let result = execute_upgrade(&mut p, MIN_TIMELOCK_BLOCKS, true);
        assert!(result.is_ok());
    }

    #[test]
    fn test_assess_impact_consistency() {
        // Non-breaking should be cheaper than breaking
        let non_breaking = assess_impact(100, false, false).unwrap();
        let breaking = assess_impact(100, false, true).unwrap();
        assert!(non_breaking.estimated_gas < breaking.estimated_gas);

        // Non-migration should be cheaper than migration
        let no_mig = assess_impact(100, false, false).unwrap();
        let with_mig = assess_impact(100, true, false).unwrap();
        assert!(no_mig.estimated_gas < with_mig.estimated_gas);
    }

    #[test]
    fn test_rollback_at_exact_deadline() {
        let rb = prepare_rollback(hash_a(), 1000, 5000, 50).unwrap();
        assert_eq!(rb.rollback_deadline, 6000);
        assert!(is_rollback_available(&rb, 6000));
        assert!(!is_rollback_available(&rb, 6001));
    }

    #[test]
    fn test_proposal_with_max_timelock_window_check() {
        let p = make_approved_proposal(1, MAX_TIMELOCK_BLOCKS, 0);
        // Should be executable right at timelock end
        assert!(can_execute(&p, MAX_TIMELOCK_BLOCKS, false).unwrap());
        // And at end of window
        assert!(can_execute(&p, MAX_TIMELOCK_BLOCKS + UPGRADE_WINDOW_BLOCKS - 1, false).unwrap());
        // But not after window
        assert!(!can_execute(&p, MAX_TIMELOCK_BLOCKS + UPGRADE_WINDOW_BLOCKS, false).unwrap());
    }

    #[test]
    fn test_emergency_shorter_than_normal() {
        assert!(EMERGENCY_TIMELOCK_BLOCKS < MIN_TIMELOCK_BLOCKS);
    }

    #[test]
    fn test_upgrade_window_positive() {
        assert!(UPGRADE_WINDOW_BLOCKS > 0);
    }

    #[test]
    fn test_quorum_less_than_super_majority() {
        assert!(QUORUM_BPS < SUPER_MAJORITY_BPS);
    }

    #[test]
    fn test_super_majority_less_than_bps() {
        assert!((SUPER_MAJORITY_BPS as u128) < BPS);
    }

    #[test]
    fn test_constants_valid_ranges() {
        assert!(MIN_TIMELOCK_BLOCKS > 0);
        assert!(MAX_TIMELOCK_BLOCKS > MIN_TIMELOCK_BLOCKS);
        assert!(EMERGENCY_TIMELOCK_BLOCKS > 0);
        assert!(MAX_PENDING_UPGRADES > 0);
        assert!(QUORUM_BPS > 0);
        assert!(SUPER_MAJORITY_BPS > QUORUM_BPS);
    }

    #[test]
    fn test_history_summary_single_executed() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.status = UpgradeStatus::Executed;
        p.affected_cells = 42;
        let (total, exec, cancel, expired, cells) = upgrade_history_summary(&[p]);
        assert_eq!(total, 1);
        assert_eq!(exec, 1);
        assert_eq!(cancel, 0);
        assert_eq!(expired, 0);
        assert_eq!(cells, 42);
    }

    #[test]
    fn test_history_summary_single_cancelled() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.status = UpgradeStatus::Cancelled;
        let (total, exec, cancel, expired, cells) = upgrade_history_summary(&[p]);
        assert_eq!(total, 1);
        assert_eq!(exec, 0);
        assert_eq!(cancel, 1);
        assert_eq!(expired, 0);
        assert_eq!(cells, 0);
    }

    #[test]
    fn test_history_summary_single_expired() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p.status = UpgradeStatus::Expired;
        let (total, exec, cancel, expired, cells) = upgrade_history_summary(&[p]);
        assert_eq!(total, 1);
        assert_eq!(exec, 0);
        assert_eq!(cancel, 0);
        assert_eq!(expired, 1);
        assert_eq!(cells, 0);
    }

    #[test]
    fn test_approve_from_approved_to_full() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        // Already approved at QUORUM_BPS, add more
        approve_proposal(&mut p, 5000, false).unwrap();
        assert_eq!(p.approval_bps, BPS as u16);
        assert_eq!(p.status, UpgradeStatus::Approved);
    }

    #[test]
    fn test_guardian_cancel_pending() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let g = guardian();
        cancel_proposal(&mut p, g, Some(g)).unwrap();
        assert_eq!(p.status, UpgradeStatus::Cancelled);
    }

    #[test]
    fn test_non_proposer_non_guardian_cannot_cancel() {
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let random = hash_c();
        let g = guardian();
        let result = cancel_proposal(&mut p, random, Some(g));
        assert_eq!(result, Err(UpgradeError::NotAuthorized));
    }

    #[test]
    fn test_execute_exactly_at_timelock_end() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let result = execute_upgrade(&mut p, MIN_TIMELOCK_BLOCKS, false);
        assert!(result.is_ok());
    }

    #[test]
    fn test_execute_one_block_before_window_closes() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let block = MIN_TIMELOCK_BLOCKS + UPGRADE_WINDOW_BLOCKS - 1;
        let result = execute_upgrade(&mut p, block, false);
        assert!(result.is_ok());
    }

    #[test]
    fn test_execute_at_window_close_fails() {
        let mut p = make_approved_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        let block = MIN_TIMELOCK_BLOCKS + UPGRADE_WINDOW_BLOCKS;
        let result = execute_upgrade(&mut p, block, false);
        assert_eq!(result, Err(UpgradeError::TimelockExpired));
    }

    #[test]
    fn test_impact_single_cell_all_flags() {
        let impact = assess_impact(1, true, true).unwrap();
        // 1 * 100_000 * 3 * 15_000 / 10_000 = 450_000
        assert_eq!(impact.estimated_gas, 450_000);
    }

    #[test]
    fn test_impact_hundred_cells_no_flags() {
        let impact = assess_impact(100, false, false).unwrap();
        // 100 * 100_000 = 10_000_000
        assert_eq!(impact.estimated_gas, 10_000_000);
    }

    #[test]
    fn test_prepare_rollback_and_check_availability() {
        let rb = prepare_rollback(hash_a(), 500, 1000, 25).unwrap();
        assert!(is_rollback_available(&rb, 500));
        assert!(is_rollback_available(&rb, 1000));
        assert!(is_rollback_available(&rb, 1500));
        assert!(!is_rollback_available(&rb, 1501));
    }

    #[test]
    fn test_proposal_different_hashes_c() {
        let p = create_proposal(
            1, hash_b(), hash_c(), proposer_a(), 0,
            MIN_TIMELOCK_BLOCKS, false, 10, desc_hash(), 0,
        );
        assert!(p.is_ok());
        let p = p.unwrap();
        assert_eq!(p.old_code_hash, hash_b());
        assert_eq!(p.new_code_hash, hash_c());
    }

    #[test]
    fn test_validate_then_assess() {
        validate_compatibility(hash_a(), hash_b(), true).unwrap();
        let impact = assess_impact(500, true, false).unwrap();
        assert_eq!(impact.affected_cell_count, 500);
        assert!(impact.requires_migration);
    }

    #[test]
    fn test_expiry_does_not_affect_terminal_states() {
        // Executed
        let mut p1 = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        p1.status = UpgradeStatus::Executed;
        assert!(!check_expiry(&mut p1, u64::MAX).unwrap());

        // Cancelled
        let mut p2 = make_proposal(2, MIN_TIMELOCK_BLOCKS, 0);
        p2.status = UpgradeStatus::Cancelled;
        assert!(!check_expiry(&mut p2, u64::MAX).unwrap());

        // Expired
        let mut p3 = make_proposal(3, MIN_TIMELOCK_BLOCKS, 0);
        p3.status = UpgradeStatus::Expired;
        assert!(!check_expiry(&mut p3, u64::MAX).unwrap());
    }

    #[test]
    fn test_max_pending_boundary() {
        // At max - 1: OK
        let r1 = create_proposal(
            1, hash_a(), hash_b(), proposer_a(), 0,
            MIN_TIMELOCK_BLOCKS, false, 10, desc_hash(), MAX_PENDING_UPGRADES - 1,
        );
        assert!(r1.is_ok());

        // At max: fail
        let r2 = create_proposal(
            2, hash_a(), hash_b(), proposer_a(), 0,
            MIN_TIMELOCK_BLOCKS, false, 10, desc_hash(), MAX_PENDING_UPGRADES,
        );
        assert_eq!(r2, Err(UpgradeError::MaxPendingReached));

        // Above max: fail
        let r3 = create_proposal(
            3, hash_a(), hash_b(), proposer_a(), 0,
            MIN_TIMELOCK_BLOCKS, false, 10, desc_hash(), MAX_PENDING_UPGRADES + 1,
        );
        assert_eq!(r3, Err(UpgradeError::MaxPendingReached));
    }

    #[test]
    fn test_emergency_has_correct_timelock_value() {
        let p = make_emergency(1, 0);
        assert_eq!(p.timelock_blocks, EMERGENCY_TIMELOCK_BLOCKS);
        assert_eq!(p.timelock_blocks, 10_000);
    }

    #[test]
    fn test_full_lifecycle_with_rollback_preparation() {
        // Create
        let mut p = make_proposal(1, MIN_TIMELOCK_BLOCKS, 0);
        // Approve
        approve_proposal(&mut p, QUORUM_BPS, false).unwrap();
        // Execute
        let exec = execute_upgrade(&mut p, MIN_TIMELOCK_BLOCKS, false).unwrap();
        // Prepare rollback
        let rb = prepare_rollback(p.old_code_hash, exec.executed_block, 100_000, exec.cells_upgraded).unwrap();
        // Check available
        assert!(is_rollback_available(&rb, MIN_TIMELOCK_BLOCKS + 50_000));
        // Execute rollback
        let reverted = execute_rollback(&rb, MIN_TIMELOCK_BLOCKS + 50_000).unwrap();
        assert_eq!(reverted, 100);
        // Check not available after deadline
        assert!(!is_rollback_available(&rb, MIN_TIMELOCK_BLOCKS + 100_001));
    }
}
