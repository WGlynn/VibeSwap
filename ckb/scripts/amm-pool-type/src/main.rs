// ============ AMM Pool Type Script ============
// CKB type script for constant product AMM pool validation
//
// Port of VibeAMM.sol to CKB's cell model
// Validates all pool state transitions:
// - Pool creation (initial liquidity deposit)
// - Add liquidity (proportional deposit, LP minting)
// - Remove liquidity (LP burning, proportional withdrawal)
// - Swap settlement (from batch auction clearing)
// - TWAP updates on every state transition
// - Circuit breaker checks via config cell_dep

use vibeswap_math::{batch_math, sqrt_product, mul_cmp, mul_div, PRECISION};
use vibeswap_types::*;

// ============ Script Entry Point ============

pub fn verify_amm_pool_type(
    old_data: Option<&[u8]>,
    new_data: &[u8],
    config: &ConfigCellData,
    oracle_price: Option<u128>,
    block_number: u64,
) -> Result<(), PoolTypeError> {
    let new_pool = PoolCellData::deserialize(new_data)
        .ok_or(PoolTypeError::InvalidCellData)?;

    match old_data {
        None => validate_pool_creation(&new_pool),
        Some(old) => {
            let old_pool = PoolCellData::deserialize(old)
                .ok_or(PoolTypeError::InvalidCellData)?;
            validate_pool_transition(&old_pool, &new_pool, config, oracle_price, block_number)
        }
    }
}

// ============ Pool Creation ============

fn validate_pool_creation(pool: &PoolCellData) -> Result<(), PoolTypeError> {
    // Must have initial reserves
    if pool.reserve0 == 0 || pool.reserve1 == 0 {
        return Err(PoolTypeError::ZeroReserves);
    }

    // Initial liquidity = sqrt(reserve0 * reserve1) - MINIMUM_LIQUIDITY
    // Uses sqrt_product to handle u128 overflow for large reserves
    let expected_lp = sqrt_product(pool.reserve0, pool.reserve1);
    if expected_lp <= MINIMUM_LIQUIDITY {
        return Err(PoolTypeError::InsufficientInitialLiquidity);
    }
    let expected_supply = expected_lp - MINIMUM_LIQUIDITY;
    if pool.total_lp_supply != expected_supply {
        return Err(PoolTypeError::InvalidLPSupply);
    }

    // Minimum liquidity must be locked
    if pool.minimum_liquidity != MINIMUM_LIQUIDITY {
        return Err(PoolTypeError::InvalidMinimumLiquidity);
    }

    // Fee rate must be reasonable (1-1000 bps = 0.01%-10%)
    if pool.fee_rate_bps == 0 || pool.fee_rate_bps > 1000 {
        return Err(PoolTypeError::InvalidFeeRate);
    }

    // Pair ID must be non-zero
    if pool.pair_id == [0u8; 32] {
        return Err(PoolTypeError::InvalidPairId);
    }

    // Token type hashes must be non-zero and different
    if pool.token0_type_hash == [0u8; 32] || pool.token1_type_hash == [0u8; 32] {
        return Err(PoolTypeError::InvalidTokenTypes);
    }
    if pool.token0_type_hash == pool.token1_type_hash {
        return Err(PoolTypeError::DuplicateTokenTypes);
    }

    Ok(())
}

// ============ Pool Transition Validation ============

fn validate_pool_transition(
    old: &PoolCellData,
    new: &PoolCellData,
    config: &ConfigCellData,
    oracle_price: Option<u128>,
    block_number: u64,
) -> Result<(), PoolTypeError> {
    // Immutable fields must not change
    if old.pair_id != new.pair_id {
        return Err(PoolTypeError::PairIdChanged);
    }
    if old.token0_type_hash != new.token0_type_hash
        || old.token1_type_hash != new.token1_type_hash
    {
        return Err(PoolTypeError::TokenTypesChanged);
    }
    if old.minimum_liquidity != new.minimum_liquidity {
        return Err(PoolTypeError::MinimumLiquidityChanged);
    }

    // Detect operation type from state changes
    let reserves_changed = old.reserve0 != new.reserve0 || old.reserve1 != new.reserve1;
    let lp_changed = old.total_lp_supply != new.total_lp_supply;

    if reserves_changed && lp_changed {
        // Add or remove liquidity
        if new.total_lp_supply > old.total_lp_supply {
            validate_add_liquidity(old, new)?;
        } else {
            validate_remove_liquidity(old, new, config)?;
        }
    } else if reserves_changed {
        // Swap (from batch settlement)
        validate_swap(old, new, config, oracle_price)?;
    } else {
        return Err(PoolTypeError::NoStateChange);
    }

    // ============ TWAP Update ============
    validate_twap_update(old, new, block_number)?;

    // ============ Circuit Breaker Check ============
    if reserves_changed {
        check_circuit_breakers(old, new, config)?;
    }

    Ok(())
}

// ============ Add Liquidity ============

fn validate_add_liquidity(
    old: &PoolCellData,
    new: &PoolCellData,
) -> Result<(), PoolTypeError> {
    let amount0 = new.reserve0.checked_sub(old.reserve0)
        .ok_or(PoolTypeError::ReserveUnderflow)?;
    let amount1 = new.reserve1.checked_sub(old.reserve1)
        .ok_or(PoolTypeError::ReserveUnderflow)?;

    if amount0 == 0 || amount1 == 0 {
        return Err(PoolTypeError::ZeroLiquidityDeposit);
    }

    // Verify proportional deposit (within 0.1% tolerance)
    let ratio0 = mul_div(amount0, PRECISION, old.reserve0);
    let ratio1 = mul_div(amount1, PRECISION, old.reserve1);
    let max_ratio = ratio0.max(ratio1);
    let min_ratio = ratio0.min(ratio1);
    if max_ratio - min_ratio > PRECISION / 1000 {
        return Err(PoolTypeError::DisproportionateDeposit);
    }

    // Verify LP minted correctly
    let lp_minted = new.total_lp_supply - old.total_lp_supply;
    let expected_lp = batch_math::calculate_liquidity(
        amount0,
        amount1,
        old.reserve0,
        old.reserve1,
        old.total_lp_supply,
    )
    .map_err(|_| PoolTypeError::LPCalculationFailed)?;

    if lp_minted != expected_lp {
        return Err(PoolTypeError::InvalidLPMinted);
    }

    // Constant product invariant: new k >= old k
    validate_k_invariant(old, new)?;

    Ok(())
}

// ============ Remove Liquidity ============

fn validate_remove_liquidity(
    old: &PoolCellData,
    new: &PoolCellData,
    _config: &ConfigCellData,
) -> Result<(), PoolTypeError> {
    let lp_burned = old.total_lp_supply - new.total_lp_supply;
    let amount0_out = old.reserve0 - new.reserve0;
    let amount1_out = old.reserve1 - new.reserve1;

    // Verify proportional withdrawal
    let expected_amount0 = mul_div(lp_burned, old.reserve0, old.total_lp_supply);
    let expected_amount1 = mul_div(lp_burned, old.reserve1, old.total_lp_supply);

    // Allow 1 wei tolerance for rounding
    if amount0_out > expected_amount0 + 1 || amount1_out > expected_amount1 + 1 {
        return Err(PoolTypeError::ExcessiveWithdrawal);
    }

    // Cannot withdraw below minimum liquidity
    if new.total_lp_supply < MINIMUM_LIQUIDITY {
        return Err(PoolTypeError::BelowMinimumLiquidity);
    }

    Ok(())
}

// ============ Swap Validation ============

fn validate_swap(
    old: &PoolCellData,
    new: &PoolCellData,
    config: &ConfigCellData,
    oracle_price: Option<u128>,
) -> Result<(), PoolTypeError> {
    // LP supply must not change during swap
    if old.total_lp_supply != new.total_lp_supply {
        return Err(PoolTypeError::LPChangedDuringSwap);
    }

    // Determine swap direction: one reserve must increase, the other must decrease
    let r0_increased = new.reserve0 > old.reserve0;
    let r1_increased = new.reserve1 > old.reserve1;

    // Both decreased or both increased = not a valid swap
    if r0_increased == r1_increased {
        return Err(PoolTypeError::KInvariantViolation);
    }

    let (amount_in, reserve_in_old, reserve_out_old, amount_out) =
        if r0_increased {
            // Token0 in, token1 out
            (
                new.reserve0 - old.reserve0,
                old.reserve0,
                old.reserve1,
                old.reserve1 - new.reserve1,
            )
        } else {
            // Token1 in, token0 out
            (
                new.reserve1 - old.reserve1,
                old.reserve1,
                old.reserve0,
                old.reserve0 - new.reserve0,
            )
        };

    // Verify fee was taken (output should be <= theoretical no-fee output)
    let max_out = batch_math::get_amount_out(
        amount_in,
        reserve_in_old,
        reserve_out_old,
        0, // No fee for maximum bound check
    )
    .map_err(|_| PoolTypeError::SwapCalculationFailed)?;

    if amount_out > max_out {
        return Err(PoolTypeError::ExcessiveOutput);
    }

    // Verify minimum fee was taken
    let expected_out = batch_math::get_amount_out(
        amount_in,
        reserve_in_old,
        reserve_out_old,
        old.fee_rate_bps as u128,
    )
    .map_err(|_| PoolTypeError::SwapCalculationFailed)?;

    // Allow 0.01% tolerance for rounding
    let tolerance = expected_out / 10_000;
    if amount_out > expected_out + tolerance {
        return Err(PoolTypeError::InsufficientFee);
    }

    // Constant product: new k >= old k (fees increase k)
    validate_k_invariant(old, new)?;

    // Trade size check
    let trade_bps = mul_div(amount_in, BPS_DENOMINATOR, reserve_in_old);
    if trade_bps > config.max_trade_size_bps as u128 {
        return Err(PoolTypeError::TradeTooLarge);
    }

    // TWAP deviation check
    if let Some(oracle) = oracle_price {
        let new_price = mul_div(new.reserve1, PRECISION, new.reserve0);
        let deviation = if new_price > oracle {
            (new_price - oracle) * BPS_DENOMINATOR / oracle
        } else {
            (oracle - new_price) * BPS_DENOMINATOR / oracle
        };
        if deviation > config.max_price_deviation as u128 {
            return Err(PoolTypeError::ExcessivePriceDeviation);
        }
    }

    Ok(())
}

// ============ Invariant Checks ============

fn validate_k_invariant(old: &PoolCellData, new: &PoolCellData) -> Result<(), PoolTypeError> {
    // k = reserve0 * reserve1
    // Uses 256-bit comparison to handle u128 overflow for large reserves
    // New k must be >= old k (fees always increase or maintain k)
    if mul_cmp(new.reserve0, new.reserve1, old.reserve0, old.reserve1)
        == core::cmp::Ordering::Less
    {
        return Err(PoolTypeError::KInvariantViolation);
    }

    Ok(())
}

fn validate_twap_update(
    old: &PoolCellData,
    new: &PoolCellData,
    block_number: u64,
) -> Result<(), PoolTypeError> {
    if block_number <= old.twap_last_block {
        // Same block, cumulative should not change
        if new.twap_price_cum != old.twap_price_cum {
            return Err(PoolTypeError::InvalidTWAPUpdate);
        }
    } else {
        // Price = reserve1/reserve0
        let price = mul_div(old.reserve1, PRECISION, old.reserve0);
        let delta_blocks = block_number - old.twap_last_block;
        let expected_cum = old.twap_price_cum.wrapping_add(price * delta_blocks as u128);

        if new.twap_price_cum != expected_cum {
            return Err(PoolTypeError::InvalidTWAPUpdate);
        }
    }

    if new.twap_last_block != block_number {
        return Err(PoolTypeError::InvalidTWAPBlock);
    }

    Ok(())
}

fn check_circuit_breakers(
    old: &PoolCellData,
    new: &PoolCellData,
    config: &ConfigCellData,
) -> Result<(), PoolTypeError> {
    // Volume breaker: check if trade volume exceeds limit
    let volume = if new.reserve0 > old.reserve0 {
        new.reserve0 - old.reserve0
    } else {
        old.reserve0 - new.reserve0
    };

    if volume > config.volume_breaker_limit {
        return Err(PoolTypeError::VolumeCircuitBreaker);
    }

    // Price breaker: check if price moved too much in one transition
    let old_price = mul_div(old.reserve1, BPS_DENOMINATOR, old.reserve0);
    let new_price = mul_div(new.reserve1, BPS_DENOMINATOR, new.reserve0);

    let price_change_bps = if new_price > old_price {
        (new_price - old_price) * BPS_DENOMINATOR / old_price
    } else {
        (old_price - new_price) * BPS_DENOMINATOR / old_price
    };

    if price_change_bps > config.price_breaker_bps as u128 {
        return Err(PoolTypeError::PriceCircuitBreaker);
    }

    Ok(())
}

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PoolTypeError {
    InvalidCellData,
    ZeroReserves,
    InsufficientInitialLiquidity,
    InvalidLPSupply,
    InvalidMinimumLiquidity,
    InvalidFeeRate,
    InvalidPairId,
    InvalidTokenTypes,
    DuplicateTokenTypes,
    PairIdChanged,
    TokenTypesChanged,
    MinimumLiquidityChanged,
    NoStateChange,
    Overflow,
    ReserveUnderflow,

    // Liquidity
    ZeroLiquidityDeposit,
    DisproportionateDeposit,
    LPCalculationFailed,
    InvalidLPMinted,
    ExcessiveWithdrawal,
    BelowMinimumLiquidity,

    // Swap
    LPChangedDuringSwap,
    SwapCalculationFailed,
    ExcessiveOutput,
    InsufficientFee,
    TradeTooLarge,
    ExcessivePriceDeviation,

    // Invariant
    KInvariantViolation,

    // TWAP
    InvalidTWAPUpdate,
    InvalidTWAPBlock,

    // Circuit breakers
    VolumeCircuitBreaker,
    PriceCircuitBreaker,
}

fn main() {
    println!("AMM Pool Type Script — compile with RISC-V target for CKB-VM");
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

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

        // Swap: 1000 token0 in → some token1 out
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
        // TWAP update
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

        // Artificially reduce both reserves (violates k invariant)
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
        new.pair_id = [0xFF; 32]; // Changed
        let new_data = new.serialize();

        let config = ConfigCellData::default();
        let result = verify_amm_pool_type(
            Some(&old_data), &new_data, &config, None, 110,
        );
        assert_eq!(result, Err(PoolTypeError::PairIdChanged));
    }
}
