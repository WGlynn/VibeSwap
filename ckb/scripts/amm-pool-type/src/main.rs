// ============ AMM Pool Type Script — CKB-VM Entry Point ============
// Type script for constant product AMM pool validation.
// Port of VibeAMM.sol to CKB's cell model.

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
    use amm_pool_type::verify_amm_pool_type;
    use vibeswap_types::*;

    // Determine creation vs transition
    let old_data = load_cell_data(0, Source::GroupInput).ok();

    // Load new pool data from GroupOutput
    let new_data = match load_cell_data(0, Source::GroupOutput) {
        Ok(d) => d,
        Err(_) => return -2,
    };

    // Load config from cell_deps
    let config = match load_cell_data(0, Source::CellDep) {
        Ok(d) => match ConfigCellData::deserialize(&d) {
            Some(c) => c,
            None => ConfigCellData::default(),
        },
        Err(_) => ConfigCellData::default(),
    };

    // Load oracle price from cell_deps (optional, second cell_dep)
    let oracle_price: Option<u128> = load_cell_data(1, Source::CellDep)
        .ok()
        .and_then(|d| OracleCellData::deserialize(&d))
        .map(|o| o.price);

    match verify_amm_pool_type(
        old_data.as_deref(),
        &new_data,
        &config,
        oracle_price,
        0, // block_number — from header_deps in production
    ) {
        Ok(()) => 0,
        Err(_) => -10,
    }
}

// ============ Native Entry Point ============

#[cfg(not(feature = "ckb"))]
fn main() {
    println!("AMM Pool Type Script — compile with --features ckb for CKB-VM");
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use amm_pool_type::*;
    use vibeswap_math::{batch_math, sqrt_product, mul_div, PRECISION};
    use vibeswap_types::*;

    fn make_pool(r0: u128, r1: u128) -> PoolCellData {
        let lp = sqrt_product(r0, r1) - MINIMUM_LIQUIDITY;
        PoolCellData {
            reserve0: r0,
            reserve1: r1,
            total_lp_supply: lp,
            fee_rate_bps: DEFAULT_FEE_RATE_BPS,
            twap_price_cum: 0,
            twap_last_block: 100,
            k_last: [0u8; 32],
            minimum_liquidity: MINIMUM_LIQUIDITY,
            pair_id: [0x01; 32],
            token0_type_hash: [0x02; 32],
            token1_type_hash: [0x03; 32],
        }
    }

    #[test]
    fn test_valid_pool_creation() {
        let pool = make_pool(1_000_000 * PRECISION, 2_000_000 * PRECISION);
        let data = pool.serialize();

        let result = verify_amm_pool_type(None, &data, &ConfigCellData::default(), None, 100);
        assert!(result.is_ok());
    }

    #[test]
    fn test_zero_reserve_rejected() {
        let pool = PoolCellData {
            reserve0: 0,
            reserve1: 1000,
            ..make_pool(1_000_000 * PRECISION, 1_000_000 * PRECISION)
        };
        let data = pool.serialize();

        let result = verify_amm_pool_type(None, &data, &ConfigCellData::default(), None, 100);
        assert_eq!(result, Err(PoolTypeError::ZeroReserves));
    }

    #[test]
    fn test_valid_swap() {
        let old = make_pool(1_000_000 * PRECISION, 2_000_000 * PRECISION);
        let old_data = old.serialize();

        let amount_in = 1000 * PRECISION;
        let amount_out = batch_math::get_amount_out(
            amount_in,
            old.reserve0,
            old.reserve1,
            old.fee_rate_bps as u128,
        ).unwrap();

        let mut new = old.clone();
        new.reserve0 = old.reserve0 + amount_in;
        new.reserve1 = old.reserve1 - amount_out;
        new.twap_last_block = 110;
        let price = mul_div(old.reserve1, PRECISION, old.reserve0);
        new.twap_price_cum = old.twap_price_cum.wrapping_add(price * 10);
        let new_data = new.serialize();

        let config = ConfigCellData::default();
        let result = verify_amm_pool_type(
            Some(&old_data), &new_data, &config, None, 110,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_k_invariant_violation() {
        let old = make_pool(1_000_000 * PRECISION, 2_000_000 * PRECISION);
        let old_data = old.serialize();

        let mut new = old.clone();
        new.reserve0 = old.reserve0 - 1000 * PRECISION;
        new.reserve1 = old.reserve1 - 1000 * PRECISION;
        new.twap_last_block = 110;
        let price = mul_div(old.reserve1, PRECISION, old.reserve0);
        new.twap_price_cum = old.twap_price_cum.wrapping_add(price * 10);
        let new_data = new.serialize();

        let config = ConfigCellData::default();
        let result = verify_amm_pool_type(
            Some(&old_data), &new_data, &config, None, 110,
        );
        assert_eq!(result, Err(PoolTypeError::KInvariantViolation));
    }

    #[test]
    fn test_pair_id_immutable() {
        let old = make_pool(1_000_000 * PRECISION, 2_000_000 * PRECISION);
        let old_data = old.serialize();

        let mut new = old.clone();
        new.pair_id = [0xFF; 32];
        let new_data = new.serialize();

        let config = ConfigCellData::default();
        let result = verify_amm_pool_type(
            Some(&old_data), &new_data, &config, None, 110,
        );
        assert_eq!(result, Err(PoolTypeError::PairIdChanged));
    }
}
