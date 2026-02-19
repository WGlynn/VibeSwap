// ============ Oracle Type Script — CKB-VM Entry Point ============
// Type script for oracle price feed cells.
// Updated by authorized relayers with freshness checks.

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
    use oracle_type::verify_oracle_type;

    // Determine creation vs update
    let old_data = load_cell_data(0, Source::GroupInput).ok();
    let is_creation = old_data.is_none();

    // Load new cell data
    let new_data = match load_cell_data(0, Source::GroupOutput) {
        Ok(d) => d,
        Err(_) => return -2,
    };

    // Authorization: if input cell lock script passed, relayer is authorized
    let is_authorized_relayer = !is_creation || {
        // For creation: simplified — actual auth via lock script
        true
    };

    // Current block from header_deps (simplified — would use load_header)
    let current_block = 0u64;

    match verify_oracle_type(
        is_creation,
        old_data.as_deref(),
        &new_data,
        is_authorized_relayer,
        current_block,
    ) {
        Ok(()) => 0,
        Err(_) => -10,
    }
}

// ============ Native Entry Point ============

#[cfg(not(feature = "ckb"))]
fn main() {
    println!("Oracle Type Script — compile with --features ckb for CKB-VM");
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use oracle_type::*;
    use vibeswap_types::*;

    #[test]
    fn test_valid_creation() {
        let oracle = OracleCellData {
            price: 2_000 * PRECISION,
            block_number: 100,
            confidence: 95,
            source_hash: [0x01; 32],
            pair_id: [0x02; 32],
        };
        let data = oracle.serialize();
        assert!(verify_oracle_type(true, None, &data, true, 100).is_ok());
    }

    #[test]
    fn test_unauthorized() {
        let oracle = OracleCellData {
            price: 2_000 * PRECISION,
            block_number: 100,
            confidence: 95,
            source_hash: [0x01; 32],
            pair_id: [0x02; 32],
        };
        let data = oracle.serialize();
        assert_eq!(
            verify_oracle_type(true, None, &data, false, 100),
            Err(OracleTypeError::Unauthorized)
        );
    }

    #[test]
    fn test_stale_data_rejected() {
        let oracle = OracleCellData {
            price: 2_000 * PRECISION,
            block_number: 100,
            confidence: 95,
            source_hash: [0x01; 32],
            pair_id: [0x02; 32],
        };
        let data = oracle.serialize();
        assert_eq!(
            verify_oracle_type(true, None, &data, true, 300), // 200 blocks old
            Err(OracleTypeError::StaleData)
        );
    }

    #[test]
    fn test_excessive_price_change() {
        let old = OracleCellData {
            price: 2_000 * PRECISION,
            block_number: 100,
            confidence: 95,
            source_hash: [0x01; 32],
            pair_id: [0x02; 32],
        };
        let old_data = old.serialize();

        let new_oracle = OracleCellData {
            price: 4_000 * PRECISION, // 100% increase
            block_number: 110,
            confidence: 90,
            source_hash: [0x01; 32],
            pair_id: [0x02; 32],
        };
        let new_data = new_oracle.serialize();

        assert_eq!(
            verify_oracle_type(false, Some(&old_data), &new_data, true, 110),
            Err(OracleTypeError::ExcessivePriceChange)
        );
    }
}
