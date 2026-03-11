// ============ Prediction Position Type Script — Verification Logic ============
// Validates state transitions for individual prediction position cells.
// Each position represents a user's bet on a specific outcome tier in a market.
//
// Positions are immutable once created — they can only be created or destroyed.
// No updates allowed (positions are consumed during settlement, not modified).
//
// Creation: must reference a valid market_id, valid tier_index, minimum bet amount.
// Destruction: market must be SETTLED or CANCELLED (positions can be redeemed).

#![cfg_attr(feature = "ckb", no_std)]

use vibeswap_types::{
    PredictionPositionCellData,
    MINIMUM_BET_AMOUNT, MAX_OUTCOME_TIERS,
};

// ============ Error Types ============

#[derive(Debug, PartialEq, Eq)]
pub enum PositionError {
    // Creation errors
    InvalidMarketId,
    InvalidOwnerHash,
    InvalidTierIndex,
    BelowMinimumBet,
    InvalidCreatedBlock,

    // Update errors (positions are immutable)
    PositionImmutable,
}

// ============ Creation Verification ============

/// Verify creation of a new prediction position cell.
///
/// Positions must have a valid market_id, owner, tier_index, and minimum bet amount.
/// The `max_tiers` parameter is the num_tiers from the associated market cell
/// (validated by the transaction assembler, not available on-chain from position alone).
pub fn verify_creation(
    position: &PredictionPositionCellData,
    max_tiers: u8,
) -> Result<(), PositionError> {
    // Market ID must be non-zero
    if position.market_id == [0u8; 32] {
        return Err(PositionError::InvalidMarketId);
    }

    // Owner must be non-zero
    if position.owner_lock_hash == [0u8; 32] {
        return Err(PositionError::InvalidOwnerHash);
    }

    // Tier must be valid for the market
    if max_tiers == 0 || position.tier_index >= max_tiers {
        return Err(PositionError::InvalidTierIndex);
    }

    // Tier must also be within absolute max
    if position.tier_index as usize >= MAX_OUTCOME_TIERS {
        return Err(PositionError::InvalidTierIndex);
    }

    // Amount must meet minimum
    if position.amount < MINIMUM_BET_AMOUNT {
        return Err(PositionError::BelowMinimumBet);
    }

    // Created block must be non-zero
    if position.created_block == 0 {
        return Err(PositionError::InvalidCreatedBlock);
    }

    Ok(())
}

// ============ Update Verification ============

/// Positions are immutable — any update is rejected.
pub fn verify_update(
    _old: &PredictionPositionCellData,
    _new: &PredictionPositionCellData,
) -> Result<(), PositionError> {
    Err(PositionError::PositionImmutable)
}

// ============ Destruction Verification ============

/// Verify destruction of a prediction position cell.
///
/// Positions can always be destroyed (the settlement logic in the SDK
/// handles payout calculation; the type script just validates that the
/// cell existed and is being consumed).
pub fn verify_destruction(
    _position: &PredictionPositionCellData,
) -> Result<(), PositionError> {
    // Destruction is always valid — the market type script and settlement
    // logic handle authorization. Position cells are consumed during
    // settlement or refund (cancelled market).
    Ok(())
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;
    use vibeswap_types::*;

    fn default_position() -> PredictionPositionCellData {
        PredictionPositionCellData {
            market_id: [0xAA; 32],
            owner_lock_hash: [0xBB; 32],
            tier_index: 0,
            amount: 5 * MINIMUM_BET_AMOUNT,
            created_block: 200,
        }
    }

    // ============ Creation Tests ============

    #[test]
    fn test_creation_valid() {
        let pos = default_position();
        assert!(verify_creation(&pos, 2).is_ok());
    }

    #[test]
    fn test_creation_valid_multi_tier() {
        let mut pos = default_position();
        pos.tier_index = 5;
        assert!(verify_creation(&pos, 8).is_ok());
    }

    #[test]
    fn test_creation_valid_max_tier() {
        let mut pos = default_position();
        pos.tier_index = 7;
        assert!(verify_creation(&pos, 8).is_ok());
    }

    #[test]
    fn test_creation_valid_minimum_bet() {
        let mut pos = default_position();
        pos.amount = MINIMUM_BET_AMOUNT;
        assert!(verify_creation(&pos, 2).is_ok());
    }

    #[test]
    fn test_creation_zero_market_id() {
        let mut pos = default_position();
        pos.market_id = [0u8; 32];
        assert_eq!(verify_creation(&pos, 2), Err(PositionError::InvalidMarketId));
    }

    #[test]
    fn test_creation_zero_owner() {
        let mut pos = default_position();
        pos.owner_lock_hash = [0u8; 32];
        assert_eq!(verify_creation(&pos, 2), Err(PositionError::InvalidOwnerHash));
    }

    #[test]
    fn test_creation_tier_exceeds_market_tiers() {
        let mut pos = default_position();
        pos.tier_index = 2; // invalid for 2-tier market
        assert_eq!(verify_creation(&pos, 2), Err(PositionError::InvalidTierIndex));
    }

    #[test]
    fn test_creation_tier_exceeds_max() {
        let mut pos = default_position();
        pos.tier_index = 8; // >= MAX_OUTCOME_TIERS
        assert_eq!(verify_creation(&pos, 10), Err(PositionError::InvalidTierIndex));
    }

    #[test]
    fn test_creation_zero_max_tiers() {
        let pos = default_position();
        assert_eq!(verify_creation(&pos, 0), Err(PositionError::InvalidTierIndex));
    }

    #[test]
    fn test_creation_below_minimum_bet() {
        let mut pos = default_position();
        pos.amount = MINIMUM_BET_AMOUNT - 1;
        assert_eq!(verify_creation(&pos, 2), Err(PositionError::BelowMinimumBet));
    }

    #[test]
    fn test_creation_zero_amount() {
        let mut pos = default_position();
        pos.amount = 0;
        assert_eq!(verify_creation(&pos, 2), Err(PositionError::BelowMinimumBet));
    }

    #[test]
    fn test_creation_zero_block() {
        let mut pos = default_position();
        pos.created_block = 0;
        assert_eq!(verify_creation(&pos, 2), Err(PositionError::InvalidCreatedBlock));
    }

    // ============ Update Tests ============

    #[test]
    fn test_update_always_rejected() {
        let old = default_position();
        let new = old.clone();
        assert_eq!(verify_update(&old, &new), Err(PositionError::PositionImmutable));
    }

    #[test]
    fn test_update_different_amount_rejected() {
        let old = default_position();
        let mut new = old.clone();
        new.amount += MINIMUM_BET_AMOUNT;
        assert_eq!(verify_update(&old, &new), Err(PositionError::PositionImmutable));
    }

    // ============ Destruction Tests ============

    #[test]
    fn test_destruction_always_valid() {
        let pos = default_position();
        assert!(verify_destruction(&pos).is_ok());
    }

    #[test]
    fn test_destruction_large_position() {
        let mut pos = default_position();
        pos.amount = 1_000_000 * MINIMUM_BET_AMOUNT;
        assert!(verify_destruction(&pos).is_ok());
    }

    // ============ Serialization Round-Trip ============

    #[test]
    fn test_serialize_roundtrip() {
        let pos = default_position();
        let bytes = pos.serialize();
        let deserialized = PredictionPositionCellData::deserialize(&bytes).unwrap();
        assert_eq!(pos, deserialized);
    }

    #[test]
    fn test_serialize_roundtrip_max_values() {
        let pos = PredictionPositionCellData {
            market_id: [0xFF; 32],
            owner_lock_hash: [0xFF; 32],
            tier_index: 7,
            amount: u128::MAX,
            created_block: u64::MAX,
        };
        let bytes = pos.serialize();
        let deserialized = PredictionPositionCellData::deserialize(&bytes).unwrap();
        assert_eq!(pos, deserialized);
    }

    // ============ Lifecycle ============

    #[test]
    fn test_lifecycle_create_then_destroy() {
        let pos = default_position();
        assert!(verify_creation(&pos, 2).is_ok());
        assert!(verify_destruction(&pos).is_ok());
    }

    #[test]
    fn test_lifecycle_cannot_update_between_create_and_destroy() {
        let pos = default_position();
        assert!(verify_creation(&pos, 2).is_ok());
        assert!(verify_update(&pos, &pos).is_err());
        assert!(verify_destruction(&pos).is_ok());
    }
}
