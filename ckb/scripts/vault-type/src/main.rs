// ============ Vault Type Script — CKB Entry Point ============

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
    use vault_type::{verify_creation, verify_update, verify_destruction};

    let script = load_script().map_err(|_| -1i8)?;
    let _args = script.args().raw_data();

    let old_data = lcd(0, Source::GroupInput).ok();
    let new_data = lcd(0, Source::GroupOutput).ok();

    match (old_data.as_deref(), new_data.as_deref()) {
        (None, Some(data)) => {
            let vault = vibeswap_types::VaultCellData::deserialize(data)
                .ok_or(-2i8)?;
            verify_creation(&vault).map_err(|_| -3i8)
        }
        (Some(old), Some(new)) => {
            let old_vault = vibeswap_types::VaultCellData::deserialize(old)
                .ok_or(-4i8)?;
            let new_vault = vibeswap_types::VaultCellData::deserialize(new)
                .ok_or(-5i8)?;
            verify_update(&old_vault, &new_vault).map_err(|_| -6i8)
        }
        (Some(old), None) => {
            let vault = vibeswap_types::VaultCellData::deserialize(old)
                .ok_or(-7i8)?;
            verify_destruction(&vault).map_err(|_| -8i8)
        }
        (None, None) => Err(-9),
    }
}

#[cfg(not(feature = "ckb"))]
fn main() {}

// ============ Tests (use lib functions) ============

#[cfg(test)]
mod tests {
    use vault_type::*;
    use vibeswap_types::*;

    fn default_vault() -> VaultCellData {
        VaultCellData {
            owner_lock_hash: [0x11; 32],
            pool_id: [0x22; 32],
            collateral_amount: 0,
            collateral_type_hash: [0u8; 32],
            debt_shares: 0,
            borrow_index_snapshot: PRECISION,
            deposit_shares: 0,
            last_update_block: 0,
        }
    }

    #[test]
    fn test_valid_creation_empty() {
        assert!(verify_creation(&default_vault()).is_ok());
    }

    #[test]
    fn test_valid_creation_with_collateral() {
        let mut v = default_vault();
        v.collateral_amount = 10 * PRECISION;
        v.collateral_type_hash = [0xAA; 32];
        assert!(verify_creation(&v).is_ok());
    }

    #[test]
    fn test_valid_creation_with_deposit() {
        let mut v = default_vault();
        v.deposit_shares = 1000 * PRECISION;
        assert!(verify_creation(&v).is_ok());
    }

    #[test]
    fn test_creation_zero_owner() {
        let mut v = default_vault();
        v.owner_lock_hash = [0u8; 32];
        assert_eq!(verify_creation(&v), Err(VaultError::InvalidOwner));
    }

    #[test]
    fn test_creation_zero_pool() {
        let mut v = default_vault();
        v.pool_id = [0u8; 32];
        assert_eq!(verify_creation(&v), Err(VaultError::InvalidPoolId));
    }

    #[test]
    fn test_creation_collateral_without_type() {
        let mut v = default_vault();
        v.collateral_amount = 10 * PRECISION;
        assert_eq!(verify_creation(&v), Err(VaultError::InvalidCollateralType));
    }

    #[test]
    fn test_creation_debt_without_index() {
        let mut v = default_vault();
        v.debt_shares = 100 * PRECISION;
        v.borrow_index_snapshot = 0;
        assert_eq!(verify_creation(&v), Err(VaultError::InvalidBorrowIndex));
    }

    #[test]
    fn test_valid_add_collateral() {
        let old = default_vault();
        let mut new = old.clone();
        new.collateral_amount = 10 * PRECISION;
        new.collateral_type_hash = [0xAA; 32];
        new.last_update_block = 100;
        assert!(verify_update(&old, &new).is_ok());
    }

    #[test]
    fn test_valid_borrow() {
        let mut old = default_vault();
        old.collateral_amount = 10 * PRECISION;
        old.collateral_type_hash = [0xAA; 32];
        let mut new = old.clone();
        new.debt_shares = 5000 * PRECISION;
        new.borrow_index_snapshot = PRECISION;
        new.last_update_block = 100;
        assert!(verify_update(&old, &new).is_ok());
    }

    #[test]
    fn test_valid_repay() {
        let mut old = default_vault();
        old.collateral_amount = 10 * PRECISION;
        old.collateral_type_hash = [0xAA; 32];
        old.debt_shares = 5000 * PRECISION;
        old.borrow_index_snapshot = PRECISION;
        let mut new = old.clone();
        new.debt_shares = 2000 * PRECISION;
        new.borrow_index_snapshot = PRECISION + 1000;
        new.last_update_block = 100;
        assert!(verify_update(&old, &new).is_ok());
    }

    #[test]
    fn test_update_owner_changed() {
        let old = default_vault();
        let mut new = old.clone();
        new.owner_lock_hash = [0xFF; 32];
        assert_eq!(verify_update(&old, &new), Err(VaultError::OwnerChanged));
    }

    #[test]
    fn test_update_pool_changed() {
        let old = default_vault();
        let mut new = old.clone();
        new.pool_id = [0xFF; 32];
        assert_eq!(verify_update(&old, &new), Err(VaultError::PoolChanged));
    }

    #[test]
    fn test_update_collateral_type_changed() {
        let mut old = default_vault();
        old.collateral_type_hash = [0xAA; 32];
        let mut new = old.clone();
        new.collateral_type_hash = [0xBB; 32];
        assert_eq!(verify_update(&old, &new), Err(VaultError::CollateralTypeChanged));
    }

    #[test]
    fn test_update_block_regression() {
        let mut old = default_vault();
        old.last_update_block = 100;
        let mut new = old.clone();
        new.last_update_block = 99;
        assert_eq!(verify_update(&old, &new), Err(VaultError::BlockRegression));
    }

    #[test]
    fn test_update_index_regression() {
        let mut old = default_vault();
        old.debt_shares = 100 * PRECISION;
        old.borrow_index_snapshot = PRECISION + 1000;
        let mut new = old.clone();
        new.borrow_index_snapshot = PRECISION;
        assert_eq!(verify_update(&old, &new), Err(VaultError::IndexRegression));
    }

    #[test]
    fn test_valid_destruction_no_debt() {
        let mut v = default_vault();
        v.collateral_amount = 10 * PRECISION;
        assert!(verify_destruction(&v).is_ok());
    }

    #[test]
    fn test_destruction_with_debt() {
        let mut v = default_vault();
        v.debt_shares = 100 * PRECISION;
        assert_eq!(verify_destruction(&v), Err(VaultError::DebtNotZero));
    }

    #[test]
    fn test_destruction_empty_vault() {
        assert!(verify_destruction(&default_vault()).is_ok());
    }

    #[test]
    fn test_full_lifecycle() {
        let vault = default_vault();
        assert!(verify_creation(&vault).is_ok());

        let v2 = VaultCellData {
            collateral_amount: 10 * PRECISION,
            collateral_type_hash: [0xAA; 32],
            last_update_block: 100,
            ..vault.clone()
        };
        assert!(verify_update(&vault, &v2).is_ok());

        let v3 = VaultCellData {
            debt_shares: 5000 * PRECISION,
            borrow_index_snapshot: PRECISION,
            last_update_block: 200,
            ..v2.clone()
        };
        assert!(verify_update(&v2, &v3).is_ok());

        let v4 = VaultCellData {
            debt_shares: 0,
            borrow_index_snapshot: PRECISION + 50_000_000_000_000_000,
            last_update_block: 300,
            ..v3.clone()
        };
        assert!(verify_update(&v3, &v4).is_ok());
        assert!(verify_destruction(&v4).is_ok());
    }
}
