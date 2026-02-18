// ============ LP Position Type Script ============
// CKB type script for tracking per-user LP positions
// No contention — each user has their own LP position cells

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

fn main() {
    println!("LP Position Type Script — compile with RISC-V target for CKB-VM");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_creation() {
        let pos = LPPositionCellData {
            lp_amount: 1_000 * PRECISION,
            entry_price: 2_000 * PRECISION,
            pool_id: [0x01; 32],
            deposit_block: 100,
        };
        let data = pos.serialize();
        assert!(verify_lp_position_type(true, &data, None).is_ok());
    }

    #[test]
    fn test_zero_lp_rejected() {
        let pos = LPPositionCellData {
            lp_amount: 0,
            entry_price: 2_000 * PRECISION,
            pool_id: [0x01; 32],
            deposit_block: 100,
        };
        let data = pos.serialize();
        assert_eq!(
            verify_lp_position_type(true, &data, None),
            Err(LPPositionError::ZeroLPAmount)
        );
    }
}
