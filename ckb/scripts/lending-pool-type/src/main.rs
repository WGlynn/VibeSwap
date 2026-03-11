// ============ Lending Pool Type Script ============
// Validates state transitions for lending pool cells.
// Shared state per asset market — PoW-gated for contention resolution.
//
// Operations:
//   Creation  (None → Some) — Initialize new lending market
//   Update    (Some → Some) — Accrue interest, deposit, borrow, repay, liquidate
//   Destruction (Some → None) — Only if pool is empty

#![cfg_attr(feature = "ckb", no_std)]
#![cfg_attr(feature = "ckb", no_main)]

#[cfg(feature = "ckb")]
use ckb_std::{
    default_alloc,
    entry,
    high_level::{load_cell_data, load_script},
    ckb_types::prelude::*,
};

#[cfg(feature = "ckb")]
default_alloc!();

#[cfg(feature = "ckb")]
entry!(main);

#[cfg(feature = "ckb")]
fn main() -> i8 {
    match entry_main() {
        Ok(()) => 0,
        Err(e) => e,
    }
}

#[cfg(feature = "ckb")]
fn entry_main() -> Result<(), i8> {
    use ckb_std::high_level::{load_cell_data as lcd, QueryIter};
    use ckb_std::ckb_constants::Source;

    // Load type script args (pool_id)
    let script = load_script().map_err(|_| -1i8)?;
    let _args = script.args().raw_data();

    // Load old cell data (input group)
    let old_data = lcd(0, Source::GroupInput).ok();
    // Load new cell data (output group)
    let new_data = lcd(0, Source::GroupOutput).ok();

    match (old_data.as_deref(), new_data.as_deref()) {
        (None, Some(data)) => {
            // Creation
            let pool = vibeswap_types::LendingPoolCellData::deserialize(data)
                .ok_or(-2i8)?;
            verify_creation(&pool).map_err(|_| -3i8)
        }
        (Some(old), Some(new)) => {
            // Update
            let old_pool = vibeswap_types::LendingPoolCellData::deserialize(old)
                .ok_or(-4i8)?;
            let new_pool = vibeswap_types::LendingPoolCellData::deserialize(new)
                .ok_or(-5i8)?;
            verify_update(&old_pool, &new_pool).map_err(|_| -6i8)
        }
        (Some(old), None) => {
            // Destruction
            let pool = vibeswap_types::LendingPoolCellData::deserialize(old)
                .ok_or(-7i8)?;
            verify_destruction(&pool).map_err(|_| -8i8)
        }
        (None, None) => Err(-9),
    }
}

// ============ Native Entry (for testing) ============

#[cfg(not(feature = "ckb"))]
fn main() {}

// ============ Verification Logic ============

use vibeswap_types::{LendingPoolCellData, PRECISION};

#[derive(Debug, PartialEq, Eq)]
pub enum PoolError {
    InvalidBorrowIndex,
    InvalidAssetHash,
    InvalidPoolId,
    InvalidRateParams,
    InvalidCollateralParams,
    BorrowsExceedDeposits,
    PoolNotEmpty,
    AssetChanged,
    PoolIdChanged,
    RateParamsChanged,
    CollateralParamsChanged,
    InvalidAccrual,
    AccrualBlockRegression,
    IndexDecreased,
    SharesNegative,
}

/// Verify creation of a new lending pool
pub fn verify_creation(pool: &LendingPoolCellData) -> Result<(), PoolError> {
    // Borrow index must start at PRECISION (1.0)
    if pool.borrow_index != PRECISION {
        return Err(PoolError::InvalidBorrowIndex);
    }

    // Asset type hash must be non-zero
    if pool.asset_type_hash == [0u8; 32] {
        return Err(PoolError::InvalidAssetHash);
    }

    // Pool ID must be non-zero
    if pool.pool_id == [0u8; 32] {
        return Err(PoolError::InvalidPoolId);
    }

    // Rate model params must be reasonable
    if pool.optimal_utilization == 0 || pool.optimal_utilization > PRECISION {
        return Err(PoolError::InvalidRateParams);
    }
    if pool.reserve_factor > PRECISION {
        return Err(PoolError::InvalidRateParams);
    }

    // Collateral params must be valid
    if pool.collateral_factor > PRECISION {
        return Err(PoolError::InvalidCollateralParams);
    }
    if pool.liquidation_threshold > PRECISION || pool.liquidation_threshold == 0 {
        return Err(PoolError::InvalidCollateralParams);
    }
    // Liquidation threshold must be >= collateral factor
    if pool.liquidation_threshold < pool.collateral_factor {
        return Err(PoolError::InvalidCollateralParams);
    }

    // Initial state: no borrows
    if pool.total_borrows != 0 {
        return Err(PoolError::BorrowsExceedDeposits);
    }

    Ok(())
}

/// Verify update of existing lending pool
pub fn verify_update(
    old: &LendingPoolCellData,
    new: &LendingPoolCellData,
) -> Result<(), PoolError> {
    // Immutable fields
    if old.asset_type_hash != new.asset_type_hash {
        return Err(PoolError::AssetChanged);
    }
    if old.pool_id != new.pool_id {
        return Err(PoolError::PoolIdChanged);
    }

    // Rate model params are immutable (governance can create new pool)
    if old.base_rate != new.base_rate
        || old.slope1 != new.slope1
        || old.slope2 != new.slope2
        || old.optimal_utilization != new.optimal_utilization
        || old.reserve_factor != new.reserve_factor
    {
        return Err(PoolError::RateParamsChanged);
    }

    // Collateral params immutable
    if old.collateral_factor != new.collateral_factor
        || old.liquidation_threshold != new.liquidation_threshold
        || old.liquidation_incentive != new.liquidation_incentive
    {
        return Err(PoolError::CollateralParamsChanged);
    }

    // Accrual block must not go backwards
    if new.last_accrual_block < old.last_accrual_block {
        return Err(PoolError::AccrualBlockRegression);
    }

    // Borrow index must not decrease (interest only accrues)
    if new.borrow_index < old.borrow_index {
        return Err(PoolError::IndexDecreased);
    }

    // Borrows cannot exceed deposits + reserves
    if new.total_borrows > new.total_deposits + new.total_reserves {
        return Err(PoolError::BorrowsExceedDeposits);
    }

    Ok(())
}

/// Verify destruction of lending pool (only if empty)
pub fn verify_destruction(pool: &LendingPoolCellData) -> Result<(), PoolError> {
    if pool.total_deposits != 0 || pool.total_borrows != 0 || pool.total_shares != 0 {
        return Err(PoolError::PoolNotEmpty);
    }
    Ok(())
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;
    use vibeswap_types::*;

    fn default_pool() -> LendingPoolCellData {
        LendingPoolCellData {
            total_deposits: 0,
            total_borrows: 0,
            total_shares: 0,
            total_reserves: 0,
            borrow_index: PRECISION,
            last_accrual_block: 0,
            asset_type_hash: [0xAA; 32],
            pool_id: [0xBB; 32],
            base_rate: DEFAULT_BASE_RATE,
            slope1: DEFAULT_SLOPE1,
            slope2: DEFAULT_SLOPE2,
            optimal_utilization: DEFAULT_OPTIMAL_UTILIZATION,
            reserve_factor: DEFAULT_RESERVE_FACTOR,
            collateral_factor: DEFAULT_COLLATERAL_FACTOR,
            liquidation_threshold: DEFAULT_LIQUIDATION_THRESHOLD,
            liquidation_incentive: DEFAULT_LIQUIDATION_INCENTIVE,
        }
    }

    // ============ Creation Tests ============

    #[test]
    fn test_valid_creation() {
        let pool = default_pool();
        assert!(verify_creation(&pool).is_ok());
    }

    #[test]
    fn test_creation_wrong_index() {
        let mut pool = default_pool();
        pool.borrow_index = 0;
        assert_eq!(verify_creation(&pool), Err(PoolError::InvalidBorrowIndex));
    }

    #[test]
    fn test_creation_zero_asset_hash() {
        let mut pool = default_pool();
        pool.asset_type_hash = [0u8; 32];
        assert_eq!(verify_creation(&pool), Err(PoolError::InvalidAssetHash));
    }

    #[test]
    fn test_creation_zero_pool_id() {
        let mut pool = default_pool();
        pool.pool_id = [0u8; 32];
        assert_eq!(verify_creation(&pool), Err(PoolError::InvalidPoolId));
    }

    #[test]
    fn test_creation_invalid_utilization() {
        let mut pool = default_pool();
        pool.optimal_utilization = 0;
        assert_eq!(verify_creation(&pool), Err(PoolError::InvalidRateParams));

        let mut pool2 = default_pool();
        pool2.optimal_utilization = PRECISION + 1;
        assert_eq!(verify_creation(&pool2), Err(PoolError::InvalidRateParams));
    }

    #[test]
    fn test_creation_reserve_factor_too_high() {
        let mut pool = default_pool();
        pool.reserve_factor = PRECISION + 1;
        assert_eq!(verify_creation(&pool), Err(PoolError::InvalidRateParams));
    }

    #[test]
    fn test_creation_collateral_factor_too_high() {
        let mut pool = default_pool();
        pool.collateral_factor = PRECISION + 1;
        assert_eq!(verify_creation(&pool), Err(PoolError::InvalidCollateralParams));
    }

    #[test]
    fn test_creation_lt_below_cf() {
        let mut pool = default_pool();
        pool.liquidation_threshold = pool.collateral_factor - 1;
        assert_eq!(verify_creation(&pool), Err(PoolError::InvalidCollateralParams));
    }

    #[test]
    fn test_creation_nonzero_borrows() {
        let mut pool = default_pool();
        pool.total_borrows = 100;
        assert_eq!(verify_creation(&pool), Err(PoolError::BorrowsExceedDeposits));
    }

    // ============ Update Tests ============

    #[test]
    fn test_valid_deposit() {
        let old = default_pool();
        let mut new = old.clone();
        new.total_deposits = 1000 * PRECISION;
        new.total_shares = 1000 * PRECISION;
        assert!(verify_update(&old, &new).is_ok());
    }

    #[test]
    fn test_valid_borrow() {
        let mut old = default_pool();
        old.total_deposits = 1000 * PRECISION;
        old.total_shares = 1000 * PRECISION;

        let mut new = old.clone();
        new.total_borrows = 800 * PRECISION;
        assert!(verify_update(&old, &new).is_ok());
    }

    #[test]
    fn test_update_asset_changed() {
        let old = default_pool();
        let mut new = old.clone();
        new.asset_type_hash = [0xFF; 32];
        assert_eq!(verify_update(&old, &new), Err(PoolError::AssetChanged));
    }

    #[test]
    fn test_update_pool_id_changed() {
        let old = default_pool();
        let mut new = old.clone();
        new.pool_id = [0xFF; 32];
        assert_eq!(verify_update(&old, &new), Err(PoolError::PoolIdChanged));
    }

    #[test]
    fn test_update_rate_params_changed() {
        let old = default_pool();
        let mut new = old.clone();
        new.base_rate += 1;
        assert_eq!(verify_update(&old, &new), Err(PoolError::RateParamsChanged));
    }

    #[test]
    fn test_update_block_regression() {
        let mut old = default_pool();
        old.last_accrual_block = 100;
        let mut new = old.clone();
        new.last_accrual_block = 99;
        assert_eq!(verify_update(&old, &new), Err(PoolError::AccrualBlockRegression));
    }

    #[test]
    fn test_update_index_decreased() {
        let mut old = default_pool();
        old.borrow_index = PRECISION + 1000;
        let mut new = old.clone();
        new.borrow_index = PRECISION;
        assert_eq!(verify_update(&old, &new), Err(PoolError::IndexDecreased));
    }

    #[test]
    fn test_update_borrows_exceed_deposits() {
        let mut old = default_pool();
        old.total_deposits = 1000 * PRECISION;
        let mut new = old.clone();
        new.total_borrows = 1001 * PRECISION;
        assert_eq!(verify_update(&old, &new), Err(PoolError::BorrowsExceedDeposits));
    }

    #[test]
    fn test_valid_interest_accrual() {
        let mut old = default_pool();
        old.total_deposits = 1000 * PRECISION;
        old.total_borrows = 800 * PRECISION;
        old.total_shares = 1000 * PRECISION;
        old.last_accrual_block = 100;

        let mut new = old.clone();
        new.last_accrual_block = 200;
        new.total_borrows = 800 * PRECISION + 1000; // Interest accrued
        new.total_deposits = old.total_deposits + 900; // 90% to depositors
        new.total_reserves = 100; // 10% to protocol
        new.borrow_index = PRECISION + 1; // Slightly increased
        assert!(verify_update(&old, &new).is_ok());
    }

    // ============ Destruction Tests ============

    #[test]
    fn test_valid_destruction() {
        let pool = default_pool();
        assert!(verify_destruction(&pool).is_ok());
    }

    #[test]
    fn test_destruction_nonempty() {
        let mut pool = default_pool();
        pool.total_deposits = 1;
        assert_eq!(verify_destruction(&pool), Err(PoolError::PoolNotEmpty));
    }

    #[test]
    fn test_destruction_with_borrows() {
        let mut pool = default_pool();
        pool.total_borrows = 1;
        assert_eq!(verify_destruction(&pool), Err(PoolError::PoolNotEmpty));
    }
}
