// ============ Prediction Market Type Script — Verification Logic ============
// Validates state transitions for prediction market cells.
// Supports non-binary outcomes (2-8 tiers) with parimutuel pooling.
//
// State machine:
//   ACTIVE → RESOLVING → RESOLVED → SETTLED
//   ACTIVE → CANCELLED (creator only, if no bets)
//
// Immutable after creation: market_id, question_hash, creator_lock_hash,
//   oracle_pair_id, num_tiers, settlement_mode, resolution_block,
//   dispute_end_block, fee_rate_bps.
//
// Key invariants:
//   1. Total liquidity always equals sum of tier_pools
//   2. Tier pools can only increase while ACTIVE (no withdrawal before resolution)
//   3. Status transitions are strictly ordered
//   4. resolved_tier < num_tiers
//   5. Only empty markets (no bets) can be cancelled

#![cfg_attr(feature = "ckb", no_std)]

use vibeswap_types::{
    PredictionMarketCellData,
    MARKET_ACTIVE, MARKET_RESOLVING, MARKET_RESOLVED, MARKET_SETTLED, MARKET_CANCELLED,
    SETTLEMENT_SCALAR, MAX_OUTCOME_TIERS, MINIMUM_BET_AMOUNT, BPS_DENOMINATOR,
};

// ============ Error Types ============

#[derive(Debug, PartialEq, Eq)]
pub enum PredictionMarketError {
    // Creation errors
    InvalidMarketId,
    InvalidQuestionHash,
    InvalidCreatorHash,
    InvalidNumTiers,
    InvalidSettlementMode,
    InvalidFeeRate,
    InvalidResolutionBlock,
    InvalidDisputeBlock,
    MarketNotClean,

    // Immutability violations
    MarketIdChanged,
    QuestionHashChanged,
    CreatorChanged,
    OraclePairChanged,
    NumTiersChanged,
    SettlementModeChanged,
    ResolutionBlockChanged,
    DisputeBlockChanged,
    FeeRateChanged,
    CreatedBlockChanged,

    // Status transition errors
    InvalidStatusTransition,
    StatusRegression,

    // Betting errors
    LiquidityDecreased,
    TierPoolDecreased,
    LiquidityMismatch,
    InactiveTierModified,

    // Resolution errors
    InvalidResolvedTier,
    ResolvedValueChanged,
    ResolvedTierChanged,

    // Destruction errors
    MarketNotSettledOrCancelled,
    PositionsOutstanding,

    // Cancellation errors
    NonEmptyCancel,
}

// ============ Creation Verification ============

/// Verify creation of a new prediction market cell.
///
/// All identity fields must be non-zero, initial state must be clean.
pub fn verify_creation(market: &PredictionMarketCellData) -> Result<(), PredictionMarketError> {
    // Identity fields must be set
    if market.market_id == [0u8; 32] {
        return Err(PredictionMarketError::InvalidMarketId);
    }
    if market.question_hash == [0u8; 32] {
        return Err(PredictionMarketError::InvalidQuestionHash);
    }
    if market.creator_lock_hash == [0u8; 32] {
        return Err(PredictionMarketError::InvalidCreatorHash);
    }

    // Tier count must be valid
    if market.num_tiers < 2 || market.num_tiers as usize > MAX_OUTCOME_TIERS {
        return Err(PredictionMarketError::InvalidNumTiers);
    }

    // Settlement mode must be valid
    if market.settlement_mode > SETTLEMENT_SCALAR {
        return Err(PredictionMarketError::InvalidSettlementMode);
    }

    // Fee rate sanity check (max 10% = 1000 bps)
    if market.fee_rate_bps > 1000 {
        return Err(PredictionMarketError::InvalidFeeRate);
    }

    // Resolution block must be in the future (relative to created_block)
    if market.resolution_block <= market.created_block {
        return Err(PredictionMarketError::InvalidResolutionBlock);
    }

    // Dispute end must be after resolution
    if market.dispute_end_block <= market.resolution_block {
        return Err(PredictionMarketError::InvalidDisputeBlock);
    }

    // Status must be ACTIVE
    if market.status != MARKET_ACTIVE {
        return Err(PredictionMarketError::MarketNotClean);
    }

    // Initial state must be clean
    if market.total_liquidity != 0 {
        return Err(PredictionMarketError::MarketNotClean);
    }
    for i in 0..MAX_OUTCOME_TIERS {
        if market.tier_pools[i] != 0 {
            return Err(PredictionMarketError::MarketNotClean);
        }
    }
    if market.resolved_tier != 0 || market.resolved_value != 0 {
        return Err(PredictionMarketError::MarketNotClean);
    }

    Ok(())
}

// ============ Update Verification ============

/// Verify a state transition of an existing prediction market cell.
///
/// Enforces immutable fields, valid status transitions, and invariants.
pub fn verify_update(
    old: &PredictionMarketCellData,
    new: &PredictionMarketCellData,
) -> Result<(), PredictionMarketError> {
    // ---- Immutable fields ----
    verify_immutable_fields(old, new)?;

    // ---- Status transition ----
    verify_status_transition(old, new)?;

    // ---- Per-status validation ----
    match (old.status, new.status) {
        // ACTIVE → ACTIVE: bets being placed
        (MARKET_ACTIVE, MARKET_ACTIVE) => {
            verify_active_update(old, new)?;
        }
        // ACTIVE → RESOLVING: market closed for betting, awaiting oracle
        (MARKET_ACTIVE, MARKET_RESOLVING) => {
            // Tier pools should not change during status transition
            verify_pools_unchanged(old, new)?;
        }
        // RESOLVING → RESOLVED: oracle value submitted
        (MARKET_RESOLVING, MARKET_RESOLVED) => {
            verify_resolution(old, new)?;
        }
        // ACTIVE → RESOLVED: direct resolution (skip RESOLVING)
        (MARKET_ACTIVE, MARKET_RESOLVED) => {
            verify_resolution(old, new)?;
        }
        // RESOLVED → SETTLED: all positions claimed
        (MARKET_RESOLVED, MARKET_SETTLED) => {
            // Pools should not change during settlement transition
            verify_pools_unchanged(old, new)?;
        }
        // ACTIVE → CANCELLED: market cancelled
        (MARKET_ACTIVE, MARKET_CANCELLED) => {
            verify_cancellation(old)?;
        }
        _ => {
            // All other transitions are invalid
            return Err(PredictionMarketError::InvalidStatusTransition);
        }
    }

    Ok(())
}

/// Enforce that immutable fields have not changed.
fn verify_immutable_fields(
    old: &PredictionMarketCellData,
    new: &PredictionMarketCellData,
) -> Result<(), PredictionMarketError> {
    if old.market_id != new.market_id {
        return Err(PredictionMarketError::MarketIdChanged);
    }
    if old.question_hash != new.question_hash {
        return Err(PredictionMarketError::QuestionHashChanged);
    }
    if old.creator_lock_hash != new.creator_lock_hash {
        return Err(PredictionMarketError::CreatorChanged);
    }
    if old.oracle_pair_id != new.oracle_pair_id {
        return Err(PredictionMarketError::OraclePairChanged);
    }
    if old.num_tiers != new.num_tiers {
        return Err(PredictionMarketError::NumTiersChanged);
    }
    if old.settlement_mode != new.settlement_mode {
        return Err(PredictionMarketError::SettlementModeChanged);
    }
    if old.resolution_block != new.resolution_block {
        return Err(PredictionMarketError::ResolutionBlockChanged);
    }
    if old.dispute_end_block != new.dispute_end_block {
        return Err(PredictionMarketError::DisputeBlockChanged);
    }
    if old.fee_rate_bps != new.fee_rate_bps {
        return Err(PredictionMarketError::FeeRateChanged);
    }
    if old.created_block != new.created_block {
        return Err(PredictionMarketError::CreatedBlockChanged);
    }
    Ok(())
}

/// Verify that the status transition is valid.
fn verify_status_transition(
    old: &PredictionMarketCellData,
    new: &PredictionMarketCellData,
) -> Result<(), PredictionMarketError> {
    // Status can never decrease (except for CANCELLED which is a terminal state)
    match (old.status, new.status) {
        (MARKET_ACTIVE, MARKET_ACTIVE) => Ok(()),
        (MARKET_ACTIVE, MARKET_RESOLVING) => Ok(()),
        (MARKET_ACTIVE, MARKET_RESOLVED) => Ok(()), // direct resolution
        (MARKET_ACTIVE, MARKET_CANCELLED) => Ok(()),
        (MARKET_RESOLVING, MARKET_RESOLVED) => Ok(()),
        (MARKET_RESOLVED, MARKET_SETTLED) => Ok(()),
        _ => Err(PredictionMarketError::InvalidStatusTransition),
    }
}

/// Validate betting updates (ACTIVE → ACTIVE).
fn verify_active_update(
    old: &PredictionMarketCellData,
    new: &PredictionMarketCellData,
) -> Result<(), PredictionMarketError> {
    // Total liquidity can only increase (no withdrawals during active period)
    if new.total_liquidity < old.total_liquidity {
        return Err(PredictionMarketError::LiquidityDecreased);
    }

    // Individual tier pools can only increase
    for i in 0..old.num_tiers as usize {
        if new.tier_pools[i] < old.tier_pools[i] {
            return Err(PredictionMarketError::TierPoolDecreased);
        }
    }

    // Inactive tiers (>= num_tiers) must remain zero
    for i in old.num_tiers as usize..MAX_OUTCOME_TIERS {
        if new.tier_pools[i] != 0 {
            return Err(PredictionMarketError::InactiveTierModified);
        }
    }

    // Invariant: total_liquidity = sum(tier_pools)
    verify_liquidity_invariant(new)?;

    // Resolved fields must not change while active
    if new.resolved_tier != 0 || new.resolved_value != 0 {
        return Err(PredictionMarketError::InvalidResolvedTier);
    }

    Ok(())
}

/// Verify that tier pools didn't change (for status-only transitions).
fn verify_pools_unchanged(
    old: &PredictionMarketCellData,
    new: &PredictionMarketCellData,
) -> Result<(), PredictionMarketError> {
    if new.total_liquidity != old.total_liquidity {
        return Err(PredictionMarketError::LiquidityMismatch);
    }
    for i in 0..MAX_OUTCOME_TIERS {
        if new.tier_pools[i] != old.tier_pools[i] {
            return Err(PredictionMarketError::TierPoolDecreased);
        }
    }
    Ok(())
}

/// Verify resolution — oracle value mapped to a winning tier.
fn verify_resolution(
    old: &PredictionMarketCellData,
    new: &PredictionMarketCellData,
) -> Result<(), PredictionMarketError> {
    // Pools must not change during resolution
    verify_pools_unchanged(old, new)?;

    // Resolved tier must be valid
    if new.resolved_tier >= new.num_tiers {
        return Err(PredictionMarketError::InvalidResolvedTier);
    }

    Ok(())
}

/// Verify cancellation — only if market has no bets.
fn verify_cancellation(
    old: &PredictionMarketCellData,
) -> Result<(), PredictionMarketError> {
    if old.total_liquidity > 0 {
        return Err(PredictionMarketError::NonEmptyCancel);
    }
    Ok(())
}

/// Invariant: total_liquidity must equal sum of tier_pools.
fn verify_liquidity_invariant(
    market: &PredictionMarketCellData,
) -> Result<(), PredictionMarketError> {
    let mut sum: u128 = 0;
    for i in 0..market.num_tiers as usize {
        sum = sum.saturating_add(market.tier_pools[i]);
    }
    if sum != market.total_liquidity {
        return Err(PredictionMarketError::LiquidityMismatch);
    }
    Ok(())
}

// ============ Destruction Verification ============

/// Verify destruction of a prediction market cell.
///
/// Only SETTLED or CANCELLED markets can be destroyed.
pub fn verify_destruction(
    market: &PredictionMarketCellData,
) -> Result<(), PredictionMarketError> {
    if market.status != MARKET_SETTLED && market.status != MARKET_CANCELLED {
        return Err(PredictionMarketError::MarketNotSettledOrCancelled);
    }
    Ok(())
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;
    use vibeswap_types::*;

    fn default_market() -> PredictionMarketCellData {
        PredictionMarketCellData {
            market_id: [0xAA; 32],
            question_hash: [0xBB; 32],
            creator_lock_hash: [0xCC; 32],
            oracle_pair_id: [0xDD; 32],
            status: MARKET_ACTIVE,
            num_tiers: 2,
            settlement_mode: SETTLEMENT_WINNER_TAKES_ALL,
            resolved_tier: 0,
            total_liquidity: 0,
            resolved_value: 0,
            tier_pools: [0u128; MAX_OUTCOME_TIERS],
            created_block: 100,
            resolution_block: 1000,
            dispute_end_block: 2200,
            fee_rate_bps: DEFAULT_MARKET_FEE_BPS,
        }
    }

    fn market_with_bets() -> PredictionMarketCellData {
        let mut m = default_market();
        m.tier_pools[0] = 10 * MINIMUM_BET_AMOUNT;
        m.tier_pools[1] = 5 * MINIMUM_BET_AMOUNT;
        m.total_liquidity = 15 * MINIMUM_BET_AMOUNT;
        m
    }

    // ============ Creation Tests ============

    #[test]
    fn test_creation_valid() {
        assert!(verify_creation(&default_market()).is_ok());
    }

    #[test]
    fn test_creation_multi_tier() {
        let mut m = default_market();
        m.num_tiers = 5;
        m.settlement_mode = SETTLEMENT_PROPORTIONAL;
        assert!(verify_creation(&m).is_ok());
    }

    #[test]
    fn test_creation_max_tiers() {
        let mut m = default_market();
        m.num_tiers = 8;
        m.settlement_mode = SETTLEMENT_SCALAR;
        assert!(verify_creation(&m).is_ok());
    }

    #[test]
    fn test_creation_zero_market_id() {
        let mut m = default_market();
        m.market_id = [0u8; 32];
        assert_eq!(verify_creation(&m), Err(PredictionMarketError::InvalidMarketId));
    }

    #[test]
    fn test_creation_zero_question_hash() {
        let mut m = default_market();
        m.question_hash = [0u8; 32];
        assert_eq!(verify_creation(&m), Err(PredictionMarketError::InvalidQuestionHash));
    }

    #[test]
    fn test_creation_zero_creator_hash() {
        let mut m = default_market();
        m.creator_lock_hash = [0u8; 32];
        assert_eq!(verify_creation(&m), Err(PredictionMarketError::InvalidCreatorHash));
    }

    #[test]
    fn test_creation_too_few_tiers() {
        let mut m = default_market();
        m.num_tiers = 1;
        assert_eq!(verify_creation(&m), Err(PredictionMarketError::InvalidNumTiers));
    }

    #[test]
    fn test_creation_too_many_tiers() {
        let mut m = default_market();
        m.num_tiers = 9;
        assert_eq!(verify_creation(&m), Err(PredictionMarketError::InvalidNumTiers));
    }

    #[test]
    fn test_creation_invalid_settlement_mode() {
        let mut m = default_market();
        m.settlement_mode = 99;
        assert_eq!(verify_creation(&m), Err(PredictionMarketError::InvalidSettlementMode));
    }

    #[test]
    fn test_creation_excessive_fee() {
        let mut m = default_market();
        m.fee_rate_bps = 1001;
        assert_eq!(verify_creation(&m), Err(PredictionMarketError::InvalidFeeRate));
    }

    #[test]
    fn test_creation_resolution_before_creation() {
        let mut m = default_market();
        m.resolution_block = 50; // before created_block (100)
        assert_eq!(verify_creation(&m), Err(PredictionMarketError::InvalidResolutionBlock));
    }

    #[test]
    fn test_creation_dispute_before_resolution() {
        let mut m = default_market();
        m.dispute_end_block = 500; // before resolution_block (1000)
        assert_eq!(verify_creation(&m), Err(PredictionMarketError::InvalidDisputeBlock));
    }

    #[test]
    fn test_creation_nonzero_liquidity() {
        let mut m = default_market();
        m.total_liquidity = 100;
        assert_eq!(verify_creation(&m), Err(PredictionMarketError::MarketNotClean));
    }

    #[test]
    fn test_creation_nonzero_tier_pool() {
        let mut m = default_market();
        m.tier_pools[0] = 100;
        assert_eq!(verify_creation(&m), Err(PredictionMarketError::MarketNotClean));
    }

    #[test]
    fn test_creation_nonzero_resolved() {
        let mut m = default_market();
        m.resolved_value = 1;
        assert_eq!(verify_creation(&m), Err(PredictionMarketError::MarketNotClean));
    }

    #[test]
    fn test_creation_wrong_status() {
        let mut m = default_market();
        m.status = MARKET_RESOLVED;
        assert_eq!(verify_creation(&m), Err(PredictionMarketError::MarketNotClean));
    }

    // ============ Active Update Tests (Betting) ============

    #[test]
    fn test_active_bet_valid() {
        let old = default_market();
        let mut new = old.clone();
        new.tier_pools[0] = 10 * MINIMUM_BET_AMOUNT;
        new.total_liquidity = 10 * MINIMUM_BET_AMOUNT;
        assert!(verify_update(&old, &new).is_ok());
    }

    #[test]
    fn test_active_multiple_bets() {
        let old = default_market();
        let mut new = old.clone();
        new.tier_pools[0] = 10 * MINIMUM_BET_AMOUNT;
        new.tier_pools[1] = 5 * MINIMUM_BET_AMOUNT;
        new.total_liquidity = 15 * MINIMUM_BET_AMOUNT;
        assert!(verify_update(&old, &new).is_ok());
    }

    #[test]
    fn test_active_liquidity_decreased() {
        let old = market_with_bets();
        let mut new = old.clone();
        new.total_liquidity -= 1;
        new.tier_pools[0] -= 1;
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::LiquidityDecreased));
    }

    #[test]
    fn test_active_tier_pool_decreased() {
        let old = market_with_bets();
        let mut new = old.clone();
        // Try to move liquidity between tiers (not allowed)
        new.tier_pools[0] -= MINIMUM_BET_AMOUNT;
        new.tier_pools[1] += MINIMUM_BET_AMOUNT;
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::TierPoolDecreased));
    }

    #[test]
    fn test_active_liquidity_mismatch() {
        let old = default_market();
        let mut new = old.clone();
        new.tier_pools[0] = 10 * MINIMUM_BET_AMOUNT;
        new.total_liquidity = 20 * MINIMUM_BET_AMOUNT; // doesn't match sum
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::LiquidityMismatch));
    }

    #[test]
    fn test_active_inactive_tier_modified() {
        let old = default_market(); // 2 tiers
        let mut new = old.clone();
        new.tier_pools[5] = MINIMUM_BET_AMOUNT; // tier 5 invalid for 2-tier market
        new.total_liquidity = MINIMUM_BET_AMOUNT;
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::InactiveTierModified));
    }

    #[test]
    fn test_active_resolved_fields_set() {
        let old = default_market();
        let mut new = old.clone();
        new.resolved_value = 1; // shouldn't be set while active
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::InvalidResolvedTier));
    }

    // ============ Immutability Tests ============

    #[test]
    fn test_market_id_changed() {
        let old = default_market();
        let mut new = old.clone();
        new.market_id = [0xFF; 32];
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::MarketIdChanged));
    }

    #[test]
    fn test_question_hash_changed() {
        let old = default_market();
        let mut new = old.clone();
        new.question_hash = [0xFF; 32];
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::QuestionHashChanged));
    }

    #[test]
    fn test_creator_changed() {
        let old = default_market();
        let mut new = old.clone();
        new.creator_lock_hash = [0xFF; 32];
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::CreatorChanged));
    }

    #[test]
    fn test_oracle_pair_changed() {
        let old = default_market();
        let mut new = old.clone();
        new.oracle_pair_id = [0xFF; 32];
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::OraclePairChanged));
    }

    #[test]
    fn test_num_tiers_changed() {
        let old = default_market();
        let mut new = old.clone();
        new.num_tiers = 4;
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::NumTiersChanged));
    }

    #[test]
    fn test_settlement_mode_changed() {
        let old = default_market();
        let mut new = old.clone();
        new.settlement_mode = SETTLEMENT_SCALAR;
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::SettlementModeChanged));
    }

    #[test]
    fn test_resolution_block_changed() {
        let old = default_market();
        let mut new = old.clone();
        new.resolution_block = 2000;
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::ResolutionBlockChanged));
    }

    #[test]
    fn test_dispute_block_changed() {
        let old = default_market();
        let mut new = old.clone();
        new.dispute_end_block = 3000;
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::DisputeBlockChanged));
    }

    #[test]
    fn test_fee_rate_changed() {
        let old = default_market();
        let mut new = old.clone();
        new.fee_rate_bps = 500;
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::FeeRateChanged));
    }

    #[test]
    fn test_created_block_changed() {
        let old = default_market();
        let mut new = old.clone();
        new.created_block = 200;
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::CreatedBlockChanged));
    }

    // ============ Status Transition Tests ============

    #[test]
    fn test_active_to_resolving() {
        let old = market_with_bets();
        let mut new = old.clone();
        new.status = MARKET_RESOLVING;
        assert!(verify_update(&old, &new).is_ok());
    }

    #[test]
    fn test_active_to_resolved_direct() {
        let old = market_with_bets();
        let mut new = old.clone();
        new.status = MARKET_RESOLVED;
        new.resolved_tier = 0;
        new.resolved_value = PRECISION / 4;
        assert!(verify_update(&old, &new).is_ok());
    }

    #[test]
    fn test_resolving_to_resolved() {
        let mut old = market_with_bets();
        old.status = MARKET_RESOLVING;
        let mut new = old.clone();
        new.status = MARKET_RESOLVED;
        new.resolved_tier = 1;
        new.resolved_value = PRECISION * 3 / 4;
        assert!(verify_update(&old, &new).is_ok());
    }

    #[test]
    fn test_resolved_to_settled() {
        let mut old = market_with_bets();
        old.status = MARKET_RESOLVED;
        old.resolved_tier = 0;
        old.resolved_value = PRECISION / 4;
        let mut new = old.clone();
        new.status = MARKET_SETTLED;
        assert!(verify_update(&old, &new).is_ok());
    }

    #[test]
    fn test_invalid_resolved_to_active() {
        let mut old = market_with_bets();
        old.status = MARKET_RESOLVED;
        old.resolved_tier = 0;
        let mut new = old.clone();
        new.status = MARKET_ACTIVE;
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::InvalidStatusTransition));
    }

    #[test]
    fn test_invalid_settled_to_resolved() {
        let mut old = market_with_bets();
        old.status = MARKET_SETTLED;
        old.resolved_tier = 0;
        let mut new = old.clone();
        new.status = MARKET_RESOLVED;
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::InvalidStatusTransition));
    }

    #[test]
    fn test_invalid_cancelled_to_active() {
        let mut old = default_market();
        old.status = MARKET_CANCELLED;
        let mut new = old.clone();
        new.status = MARKET_ACTIVE;
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::InvalidStatusTransition));
    }

    #[test]
    fn test_invalid_resolving_to_active() {
        let mut old = market_with_bets();
        old.status = MARKET_RESOLVING;
        let mut new = old.clone();
        new.status = MARKET_ACTIVE;
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::InvalidStatusTransition));
    }

    // ============ Resolution Tests ============

    #[test]
    fn test_resolution_valid_tier() {
        let old = market_with_bets();
        let mut new = old.clone();
        new.status = MARKET_RESOLVED;
        new.resolved_tier = 1; // valid for 2-tier market
        new.resolved_value = PRECISION * 75 / 100;
        assert!(verify_update(&old, &new).is_ok());
    }

    #[test]
    fn test_resolution_invalid_tier() {
        let old = market_with_bets();
        let mut new = old.clone();
        new.status = MARKET_RESOLVED;
        new.resolved_tier = 2; // invalid for 2-tier market
        new.resolved_value = PRECISION;
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::InvalidResolvedTier));
    }

    #[test]
    fn test_resolution_pools_must_not_change() {
        let old = market_with_bets();
        let mut new = old.clone();
        new.status = MARKET_RESOLVED;
        new.resolved_tier = 0;
        new.tier_pools[0] += 1; // illegally modified
        new.total_liquidity += 1;
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::LiquidityMismatch));
    }

    // ============ Cancellation Tests ============

    #[test]
    fn test_cancel_empty_market() {
        let old = default_market(); // no bets
        let mut new = old.clone();
        new.status = MARKET_CANCELLED;
        assert!(verify_update(&old, &new).is_ok());
    }

    #[test]
    fn test_cancel_non_empty_market() {
        let old = market_with_bets();
        let mut new = old.clone();
        new.status = MARKET_CANCELLED;
        assert_eq!(verify_update(&old, &new), Err(PredictionMarketError::NonEmptyCancel));
    }

    // ============ Destruction Tests ============

    #[test]
    fn test_destroy_settled_market() {
        let mut m = market_with_bets();
        m.status = MARKET_SETTLED;
        assert!(verify_destruction(&m).is_ok());
    }

    #[test]
    fn test_destroy_cancelled_market() {
        let mut m = default_market();
        m.status = MARKET_CANCELLED;
        assert!(verify_destruction(&m).is_ok());
    }

    #[test]
    fn test_destroy_active_market() {
        let m = default_market();
        assert_eq!(verify_destruction(&m), Err(PredictionMarketError::MarketNotSettledOrCancelled));
    }

    #[test]
    fn test_destroy_resolved_market() {
        let mut m = market_with_bets();
        m.status = MARKET_RESOLVED;
        assert_eq!(verify_destruction(&m), Err(PredictionMarketError::MarketNotSettledOrCancelled));
    }

    #[test]
    fn test_destroy_resolving_market() {
        let mut m = market_with_bets();
        m.status = MARKET_RESOLVING;
        assert_eq!(verify_destruction(&m), Err(PredictionMarketError::MarketNotSettledOrCancelled));
    }

    // ============ Full Lifecycle Tests ============

    #[test]
    fn test_full_lifecycle_binary_wta() {
        // 1. Create
        let market = default_market();
        assert!(verify_creation(&market).is_ok());

        // 2. Place bets
        let mut after_bets = market.clone();
        after_bets.tier_pools[0] = 10 * MINIMUM_BET_AMOUNT;
        after_bets.tier_pools[1] = 5 * MINIMUM_BET_AMOUNT;
        after_bets.total_liquidity = 15 * MINIMUM_BET_AMOUNT;
        assert!(verify_update(&market, &after_bets).is_ok());

        // 3. More bets
        let mut more_bets = after_bets.clone();
        more_bets.tier_pools[1] += 5 * MINIMUM_BET_AMOUNT;
        more_bets.total_liquidity += 5 * MINIMUM_BET_AMOUNT;
        assert!(verify_update(&after_bets, &more_bets).is_ok());

        // 4. Close betting (ACTIVE → RESOLVING)
        let mut resolving = more_bets.clone();
        resolving.status = MARKET_RESOLVING;
        assert!(verify_update(&more_bets, &resolving).is_ok());

        // 5. Resolve with oracle value
        let mut resolved = resolving.clone();
        resolved.status = MARKET_RESOLVED;
        resolved.resolved_tier = 0;
        resolved.resolved_value = PRECISION / 4;
        assert!(verify_update(&resolving, &resolved).is_ok());

        // 6. Settle
        let mut settled = resolved.clone();
        settled.status = MARKET_SETTLED;
        assert!(verify_update(&resolved, &settled).is_ok());

        // 7. Destroy
        assert!(verify_destruction(&settled).is_ok());
    }

    #[test]
    fn test_full_lifecycle_multi_tier_scalar() {
        let mut market = default_market();
        market.num_tiers = 4;
        market.settlement_mode = SETTLEMENT_SCALAR;
        assert!(verify_creation(&market).is_ok());

        // Bets on all 4 tiers
        let mut with_bets = market.clone();
        for i in 0..4 {
            with_bets.tier_pools[i] = (5 + i as u128) * MINIMUM_BET_AMOUNT;
        }
        with_bets.total_liquidity = with_bets.tier_pools[..4].iter().sum();
        assert!(verify_update(&market, &with_bets).is_ok());

        // Direct resolution (skip RESOLVING)
        let mut resolved = with_bets.clone();
        resolved.status = MARKET_RESOLVED;
        resolved.resolved_tier = 2;
        resolved.resolved_value = PRECISION * 60 / 100;
        assert!(verify_update(&with_bets, &resolved).is_ok());

        // Settle
        let mut settled = resolved.clone();
        settled.status = MARKET_SETTLED;
        assert!(verify_update(&resolved, &settled).is_ok());

        assert!(verify_destruction(&settled).is_ok());
    }

    #[test]
    fn test_full_lifecycle_cancellation() {
        let market = default_market();
        assert!(verify_creation(&market).is_ok());

        // Cancel (no bets placed)
        let mut cancelled = market.clone();
        cancelled.status = MARKET_CANCELLED;
        assert!(verify_update(&market, &cancelled).is_ok());

        // Destroy
        assert!(verify_destruction(&cancelled).is_ok());
    }

    // ============ Liquidity Invariant Tests ============

    #[test]
    fn test_liquidity_invariant_exact_sum() {
        let mut m = default_market();
        m.tier_pools[0] = 7 * MINIMUM_BET_AMOUNT;
        m.tier_pools[1] = 3 * MINIMUM_BET_AMOUNT;
        m.total_liquidity = 10 * MINIMUM_BET_AMOUNT;
        assert!(verify_liquidity_invariant(&m).is_ok());
    }

    #[test]
    fn test_liquidity_invariant_overstated() {
        let mut m = default_market();
        m.tier_pools[0] = 7 * MINIMUM_BET_AMOUNT;
        m.tier_pools[1] = 3 * MINIMUM_BET_AMOUNT;
        m.total_liquidity = 11 * MINIMUM_BET_AMOUNT; // overstated
        assert_eq!(verify_liquidity_invariant(&m), Err(PredictionMarketError::LiquidityMismatch));
    }

    #[test]
    fn test_liquidity_invariant_understated() {
        let mut m = default_market();
        m.tier_pools[0] = 7 * MINIMUM_BET_AMOUNT;
        m.tier_pools[1] = 3 * MINIMUM_BET_AMOUNT;
        m.total_liquidity = 9 * MINIMUM_BET_AMOUNT; // understated
        assert_eq!(verify_liquidity_invariant(&m), Err(PredictionMarketError::LiquidityMismatch));
    }
}
