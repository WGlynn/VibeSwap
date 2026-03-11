// ============ Vault Type Script — Verification Logic ============
// Validates state transitions for per-user lending vault cells.
// No contention — each user owns their own vault cell.

#![cfg_attr(feature = "ckb", no_std)]

use vibeswap_types::VaultCellData;

#[derive(Debug, PartialEq, Eq)]
pub enum VaultError {
    InvalidOwner,
    InvalidPoolId,
    InvalidCollateralType,
    InvalidBorrowIndex,
    OwnerChanged,
    PoolChanged,
    CollateralTypeChanged,
    DebtNotZero,
    BlockRegression,
    IndexRegression,
    InvalidDebtShares,
    CollateralIncreased,
    DepositSharesChanged,
}

/// Verify creation of a new vault
pub fn verify_creation(vault: &VaultCellData) -> Result<(), VaultError> {
    if vault.owner_lock_hash == [0u8; 32] {
        return Err(VaultError::InvalidOwner);
    }
    if vault.pool_id == [0u8; 32] {
        return Err(VaultError::InvalidPoolId);
    }
    if vault.collateral_amount > 0 && vault.collateral_type_hash == [0u8; 32] {
        return Err(VaultError::InvalidCollateralType);
    }
    if vault.debt_shares > 0 && vault.borrow_index_snapshot == 0 {
        return Err(VaultError::InvalidBorrowIndex);
    }
    Ok(())
}

/// Verify update of existing vault
pub fn verify_update(
    old: &VaultCellData,
    new: &VaultCellData,
) -> Result<(), VaultError> {
    if old.owner_lock_hash != new.owner_lock_hash {
        return Err(VaultError::OwnerChanged);
    }
    if old.pool_id != new.pool_id {
        return Err(VaultError::PoolChanged);
    }
    if old.collateral_type_hash != [0u8; 32]
        && new.collateral_type_hash != [0u8; 32]
        && old.collateral_type_hash != new.collateral_type_hash
    {
        return Err(VaultError::CollateralTypeChanged);
    }
    if new.last_update_block < old.last_update_block {
        return Err(VaultError::BlockRegression);
    }
    if new.debt_shares > 0 && new.borrow_index_snapshot == 0 {
        return Err(VaultError::InvalidBorrowIndex);
    }
    if new.borrow_index_snapshot < old.borrow_index_snapshot
        && new.debt_shares > 0
    {
        return Err(VaultError::IndexRegression);
    }
    Ok(())
}

/// Verify destruction of vault (position closure)
pub fn verify_destruction(vault: &VaultCellData) -> Result<(), VaultError> {
    if vault.debt_shares > 0 {
        return Err(VaultError::DebtNotZero);
    }
    Ok(())
}

/// Verify liquidation transition (subset of update)
/// Liquidation is a special update where:
/// - Debt shares decrease (debt is being repaid)
/// - Collateral amount decreases (collateral is seized)
/// - Owner/pool/collateral_type are immutable
/// - Borrow index must not decrease
pub fn verify_liquidation(
    old: &VaultCellData,
    new: &VaultCellData,
) -> Result<(), VaultError> {
    // Immutability checks (same as update)
    if old.owner_lock_hash != new.owner_lock_hash {
        return Err(VaultError::OwnerChanged);
    }
    if old.pool_id != new.pool_id {
        return Err(VaultError::PoolChanged);
    }
    if old.collateral_type_hash != new.collateral_type_hash {
        return Err(VaultError::CollateralTypeChanged);
    }

    // Block must advance
    if new.last_update_block < old.last_update_block {
        return Err(VaultError::BlockRegression);
    }

    // Borrow index must not decrease
    if new.borrow_index_snapshot < old.borrow_index_snapshot {
        return Err(VaultError::IndexRegression);
    }

    // Liquidation-specific: debt must decrease
    if new.debt_shares > old.debt_shares {
        return Err(VaultError::InvalidDebtShares);
    }

    // Liquidation-specific: collateral must decrease
    if new.collateral_amount > old.collateral_amount {
        return Err(VaultError::CollateralIncreased);
    }

    // Deposit shares should not change during liquidation
    if new.deposit_shares != old.deposit_shares {
        return Err(VaultError::DepositSharesChanged);
    }

    Ok(())
}
