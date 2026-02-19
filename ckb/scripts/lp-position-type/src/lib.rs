// ============ LP Position Type Script — Library ============
// CKB type script for tracking per-user LP positions
// No contention — each user has their own LP position cells

#![cfg_attr(feature = "ckb", no_std)]

use vibeswap_types::*;

// ============ Script Entry Point ============

pub fn verify_lp_position_type(
    is_creation: bool,
    cell_data: &[u8],
    pool_data: Option<&PoolCellData>,
) -> Result<(), LPPositionError> {
    let position = LPPositionCellData::deserialize(cell_data)
        .ok_or(LPPositionError::InvalidCellData)?;

    if is_creation {
        validate_creation(&position, pool_data)
    } else {
        validate_consumption(&position)
    }
}

fn validate_creation(
    position: &LPPositionCellData,
    pool_data: Option<&PoolCellData>,
) -> Result<(), LPPositionError> {
    // LP amount must be positive
    if position.lp_amount == 0 {
        return Err(LPPositionError::ZeroLPAmount);
    }

    // Pool ID must be non-zero
    if position.pool_id == [0u8; 32] {
        return Err(LPPositionError::InvalidPoolId);
    }

    // If pool data is available, verify entry price matches current TWAP
    if let Some(pool) = pool_data {
        let current_price = pool.reserve1
            .checked_mul(PRECISION)
            .ok_or(LPPositionError::Overflow)?
            / pool.reserve0;

        // Entry price should be within 1% of current price
        let deviation = if position.entry_price > current_price {
            (position.entry_price - current_price) * 10_000 / current_price
        } else {
            (current_price - position.entry_price) * 10_000 / current_price
        };

        if deviation > 100 {
            return Err(LPPositionError::EntryPriceDeviation);
        }
    }

    Ok(())
}

fn validate_consumption(_position: &LPPositionCellData) -> Result<(), LPPositionError> {
    // LP cells can be consumed (burned) when removing liquidity
    // The pool type script validates that the correct amount is returned
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LPPositionError {
    InvalidCellData,
    ZeroLPAmount,
    InvalidPoolId,
    Overflow,
    EntryPriceDeviation,
}
