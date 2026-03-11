// ============ Lending Pool Type Script — CKB Entry Point ============

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
    use ckb_std::high_level::load_cell_data as lcd;
    use ckb_std::ckb_constants::Source;
    use lending_pool_type::{verify_creation, verify_update, verify_destruction};

    let script = load_script().map_err(|_| -1i8)?;
    let _args = script.args().raw_data();

    let old_data = lcd(0, Source::GroupInput).ok();
    let new_data = lcd(0, Source::GroupOutput).ok();

    match (old_data.as_deref(), new_data.as_deref()) {
        (None, Some(data)) => {
            let pool = vibeswap_types::LendingPoolCellData::deserialize(data)
                .ok_or(-2i8)?;
            verify_creation(&pool).map_err(|_| -3i8)
        }
        (Some(old), Some(new)) => {
            let old_pool = vibeswap_types::LendingPoolCellData::deserialize(old)
                .ok_or(-4i8)?;
            let new_pool = vibeswap_types::LendingPoolCellData::deserialize(new)
                .ok_or(-5i8)?;
            verify_update(&old_pool, &new_pool).map_err(|_| -6i8)
        }
        (Some(old), None) => {
            let pool = vibeswap_types::LendingPoolCellData::deserialize(old)
                .ok_or(-7i8)?;
            verify_destruction(&pool).map_err(|_| -8i8)
        }
        (None, None) => Err(-9),
    }
}

#[cfg(not(feature = "ckb"))]
fn main() {}

// ============ Tests (use lib functions) ============

#[cfg(test)]
mod tests {
    use lending_pool_type::*;
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

    #[test]
    fn test_valid_creation() {
        assert!(verify_creation(&default_pool()).is_ok());
    }

    #[test]
    fn test_creation_wrong_index() {
        let mut p = default_pool();
        p.borrow_index = 0;
        assert_eq!(verify_creation(&p), Err(PoolError::InvalidBorrowIndex));
    }

    #[test]
    fn test_creation_zero_asset_hash() {
        let mut p = default_pool();
        p.asset_type_hash = [0u8; 32];
        assert_eq!(verify_creation(&p), Err(PoolError::InvalidAssetHash));
    }

    #[test]
    fn test_creation_zero_pool_id() {
        let mut p = default_pool();
        p.pool_id = [0u8; 32];
        assert_eq!(verify_creation(&p), Err(PoolError::InvalidPoolId));
    }

    #[test]
    fn test_creation_invalid_utilization() {
        let mut p = default_pool();
        p.optimal_utilization = 0;
        assert_eq!(verify_creation(&p), Err(PoolError::InvalidRateParams));
    }

    #[test]
    fn test_creation_reserve_factor_too_high() {
        let mut p = default_pool();
        p.reserve_factor = PRECISION + 1;
        assert_eq!(verify_creation(&p), Err(PoolError::InvalidRateParams));
    }

    #[test]
    fn test_creation_collateral_factor_too_high() {
        let mut p = default_pool();
        p.collateral_factor = PRECISION + 1;
        assert_eq!(verify_creation(&p), Err(PoolError::InvalidCollateralParams));
    }

    #[test]
    fn test_creation_lt_below_cf() {
        let mut p = default_pool();
        p.liquidation_threshold = p.collateral_factor - 1;
        assert_eq!(verify_creation(&p), Err(PoolError::InvalidCollateralParams));
    }

    #[test]
    fn test_creation_nonzero_borrows() {
        let mut p = default_pool();
        p.total_borrows = 100;
        assert_eq!(verify_creation(&p), Err(PoolError::BorrowsExceedDeposits));
    }

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
        new.total_borrows = 800 * PRECISION + 1000;
        new.total_deposits = old.total_deposits + 900;
        new.total_reserves = 100;
        new.borrow_index = PRECISION + 1;
        assert!(verify_update(&old, &new).is_ok());
    }

    #[test]
    fn test_valid_destruction() {
        assert!(verify_destruction(&default_pool()).is_ok());
    }

    #[test]
    fn test_destruction_nonempty() {
        let mut p = default_pool();
        p.total_deposits = 1;
        assert_eq!(verify_destruction(&p), Err(PoolError::PoolNotEmpty));
    }

    #[test]
    fn test_destruction_with_borrows() {
        let mut p = default_pool();
        p.total_borrows = 1;
        assert_eq!(verify_destruction(&p), Err(PoolError::PoolNotEmpty));
    }
}
