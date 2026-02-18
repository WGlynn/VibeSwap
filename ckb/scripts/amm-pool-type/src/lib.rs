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
    if pool.reserve0 == 0 || pool.reserve1 == 0 {
        return Err(PoolTypeError::ZeroReserves);
    }

    let expected_lp = sqrt_product(pool.reserve0, pool.reserve1);
    if expected_lp <= MINIMUM_LIQUIDITY {
        return Err(PoolTypeError::InsufficientInitialLiquidity);
    }
    let expected_supply = expected_lp - MINIMUM_LIQUIDITY;
    if pool.total_lp_supply != expected_supply {
        return Err(PoolTypeError::InvalidLPSupply);
    }

    if pool.minimum_liquidity != MINIMUM_LIQUIDITY {
        return Err(PoolTypeError::InvalidMinimumLiquidity);
    }

    if pool.fee_rate_bps == 0 || pool.fee_rate_bps > 1000 {
        return Err(PoolTypeError::InvalidFeeRate);
    }

    if pool.pair_id == [0u8; 32] {
        return Err(PoolTypeError::InvalidPairId);
    }

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

    let reserves_changed = old.reserve0 != new.reserve0 || old.reserve1 != new.reserve1;
    let lp_changed = old.total_lp_supply != new.total_lp_supply;

    if reserves_changed && lp_changed {
        if new.total_lp_supply > old.total_lp_supply {
            validate_add_liquidity(old, new)?;
        } else {
            validate_remove_liquidity(old, new, config)?;
        }
    } else if reserves_changed {
        validate_swap(old, new, config, oracle_price)?;
    } else {
        return Err(PoolTypeError::NoStateChange);
    }

    validate_twap_update(old, new, block_number)?;

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

    let ratio0 = mul_div(amount0, PRECISION, old.reserve0);
    let ratio1 = mul_div(amount1, PRECISION, old.reserve1);
    let max_ratio = ratio0.max(ratio1);
    let min_ratio = ratio0.min(ratio1);
    if max_ratio - min_ratio > PRECISION / 1000 {
        return Err(PoolTypeError::DisproportionateDeposit);
    }

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

    let expected_amount0 = mul_div(lp_burned, old.reserve0, old.total_lp_supply);
    let expected_amount1 = mul_div(lp_burned, old.reserve1, old.total_lp_supply);

    if amount0_out > expected_amount0 + 1 || amount1_out > expected_amount1 + 1 {
        return Err(PoolTypeError::ExcessiveWithdrawal);
    }

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
    if old.total_lp_supply != new.total_lp_supply {
        return Err(PoolTypeError::LPChangedDuringSwap);
    }

    let r0_increased = new.reserve0 > old.reserve0;
    let r1_increased = new.reserve1 > old.reserve1;

    if r0_increased == r1_increased {
        return Err(PoolTypeError::KInvariantViolation);
    }

    let (amount_in, reserve_in_old, reserve_out_old, amount_out) =
        if r0_increased {
            (
                new.reserve0 - old.reserve0,
                old.reserve0,
                old.reserve1,
                old.reserve1 - new.reserve1,
            )
        } else {
            (
                new.reserve1 - old.reserve1,
                old.reserve1,
                old.reserve0,
                old.reserve0 - new.reserve0,
            )
        };

    let max_out = batch_math::get_amount_out(
        amount_in,
        reserve_in_old,
        reserve_out_old,
        0,
    )
    .map_err(|_| PoolTypeError::SwapCalculationFailed)?;

    if amount_out > max_out {
        return Err(PoolTypeError::ExcessiveOutput);
    }

    let expected_out = batch_math::get_amount_out(
        amount_in,
        reserve_in_old,
        reserve_out_old,
        old.fee_rate_bps as u128,
    )
    .map_err(|_| PoolTypeError::SwapCalculationFailed)?;

    let tolerance = expected_out / 10_000;
    if amount_out > expected_out + tolerance {
        return Err(PoolTypeError::InsufficientFee);
    }

    validate_k_invariant(old, new)?;

    let trade_bps = mul_div(amount_in, BPS_DENOMINATOR, reserve_in_old);
    if trade_bps > config.max_trade_size_bps as u128 {
        return Err(PoolTypeError::TradeTooLarge);
    }

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
        if new.twap_price_cum != old.twap_price_cum {
            return Err(PoolTypeError::InvalidTWAPUpdate);
        }
    } else {
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
    let volume = if new.reserve0 > old.reserve0 {
        new.reserve0 - old.reserve0
    } else {
        old.reserve0 - new.reserve0
    };

    if volume > config.volume_breaker_limit {
        return Err(PoolTypeError::VolumeCircuitBreaker);
    }

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
