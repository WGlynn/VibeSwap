// ============ Lending Pool Type Script — Verification Logic ============
// Validates state transitions for lending pool cells.
// Shared state per asset market — PoW-gated for contention resolution.

#![cfg_attr(feature = "ckb", no_std)]

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
    if pool.borrow_index != PRECISION {
        return Err(PoolError::InvalidBorrowIndex);
    }
    if pool.asset_type_hash == [0u8; 32] {
        return Err(PoolError::InvalidAssetHash);
    }
    if pool.pool_id == [0u8; 32] {
        return Err(PoolError::InvalidPoolId);
    }
    if pool.optimal_utilization == 0 || pool.optimal_utilization > PRECISION {
        return Err(PoolError::InvalidRateParams);
    }
    if pool.reserve_factor > PRECISION {
        return Err(PoolError::InvalidRateParams);
    }
    if pool.collateral_factor > PRECISION {
        return Err(PoolError::InvalidCollateralParams);
    }
    if pool.liquidation_threshold > PRECISION || pool.liquidation_threshold == 0 {
        return Err(PoolError::InvalidCollateralParams);
    }
    if pool.liquidation_threshold < pool.collateral_factor {
        return Err(PoolError::InvalidCollateralParams);
    }
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
    if old.asset_type_hash != new.asset_type_hash {
        return Err(PoolError::AssetChanged);
    }
    if old.pool_id != new.pool_id {
        return Err(PoolError::PoolIdChanged);
    }
    if old.base_rate != new.base_rate
        || old.slope1 != new.slope1
        || old.slope2 != new.slope2
        || old.optimal_utilization != new.optimal_utilization
        || old.reserve_factor != new.reserve_factor
    {
        return Err(PoolError::RateParamsChanged);
    }
    if old.collateral_factor != new.collateral_factor
        || old.liquidation_threshold != new.liquidation_threshold
        || old.liquidation_incentive != new.liquidation_incentive
    {
        return Err(PoolError::CollateralParamsChanged);
    }
    if new.last_accrual_block < old.last_accrual_block {
        return Err(PoolError::AccrualBlockRegression);
    }
    if new.borrow_index < old.borrow_index {
        return Err(PoolError::IndexDecreased);
    }
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
