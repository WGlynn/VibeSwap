// ============ LP Position Type Script — CKB-VM Entry Point ============
// Type script for tracking per-user LP positions.
// No contention — each user has their own LP position cells.

#![cfg_attr(feature = "ckb", no_std)]
#![cfg_attr(feature = "ckb", no_main)]

#[cfg(feature = "ckb")]
ckb_std::default_alloc!();

#[cfg(feature = "ckb")]
ckb_std::entry!(program);

// ============ CKB-VM Entry Point ============

#[cfg(feature = "ckb")]
fn program() -> i8 {
    use ckb_std::ckb_constants::Source;
    use ckb_std::high_level::load_cell_data;
    use lp_position_type::verify_lp_position_type;
    use vibeswap_types::PoolCellData;

    // Determine creation vs consumption
    let has_group_input = load_cell_data(0, Source::GroupInput).is_ok();
    let has_group_output = load_cell_data(0, Source::GroupOutput).is_ok();
    let is_creation = !has_group_input && has_group_output;

    // Load the LP position cell data
    let cell_data = if is_creation {
        match load_cell_data(0, Source::GroupOutput) {
            Ok(d) => d,
            Err(_) => return -2,
        }
    } else {
        match load_cell_data(0, Source::GroupInput) {
            Ok(d) => d,
            Err(_) => return -2,
        }
    };

    // Try to load pool data from cell_deps for price verification
    let pool_data: Option<PoolCellData> = load_cell_data(0, Source::CellDep)
        .ok()
        .and_then(|d| PoolCellData::deserialize(&d));

    match verify_lp_position_type(
        is_creation,
        &cell_data,
        pool_data.as_ref(),
    ) {
        Ok(()) => 0,
        Err(_) => -10,
    }
}

// ============ Native Entry Point ============

#[cfg(not(feature = "ckb"))]
fn main() {
    println!("LP Position Type Script — compile with --features ckb for CKB-VM");
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use lp_position_type::*;
    use vibeswap_types::*;

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
