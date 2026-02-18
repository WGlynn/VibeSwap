// ============ AMM Pool Type Script — CKB-VM Entry Point ============
// The library logic lives in lib.rs; this binary is compiled for RISC-V.

fn main() {
    println!("AMM Pool Type Script — compile with RISC-V target for CKB-VM");
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
