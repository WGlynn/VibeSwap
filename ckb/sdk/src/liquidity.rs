// ============ Liquidity SDK — LP Position Management & Pool Analytics ============
// High-level utilities for managing liquidity positions in VibeSwap AMM pools.
// Complements the TX builders in lib.rs (add_liquidity, remove_liquidity, create_pool)
// with position valuation, IL tracking, pool analytics, and zap calculations.
//
// Key capabilities:
// - Position valuation: current value of LP tokens in underlying terms
// - Impermanent loss: exact IL calculation vs HODL baseline
// - Withdrawal estimation: predict token amounts for LP burn
// - Pool analytics: TVL, utilization, fee APR, depth score
// - Zap-in calculation: single-sided deposit math (swap half + add liquidity)
// - Optimal deposit: best deposit ratio for a given budget

use vibeswap_types::*;
use vibeswap_math::PRECISION;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LiquidityError {
    /// Pool has zero reserves
    EmptyPool,
    /// Pool has zero LP supply
    ZeroLPSupply,
    /// Amount is zero
    ZeroAmount,
    /// Price is zero
    ZeroPrice,
    /// Would result in insufficient liquidity (below minimum)
    InsufficientLiquidity,
    /// Math overflow
    Overflow,
}

// ============ Position Valuation ============

/// Value of an LP position in terms of the pool's underlying tokens.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PositionValue {
    /// Token0 amount the position is entitled to
    pub amount0: u128,
    /// Token1 amount the position is entitled to
    pub amount1: u128,
    /// Total value in a reference denomination (using price0, price1)
    pub total_value: u128,
    /// Share of the pool (in bps)
    pub pool_share_bps: u64,
}

/// Calculate the current value of an LP position.
pub fn position_value(
    lp_amount: u128,
    pool: &PoolCellData,
    price0: u128,
    price1: u128,
) -> Result<PositionValue, LiquidityError> {
    if pool.total_lp_supply == 0 {
        return Err(LiquidityError::ZeroLPSupply);
    }

    let amount0 = vibeswap_math::mul_div(lp_amount, pool.reserve0, pool.total_lp_supply);
    let amount1 = vibeswap_math::mul_div(lp_amount, pool.reserve1, pool.total_lp_supply);

    let value0 = vibeswap_math::mul_div(amount0, price0, PRECISION);
    let value1 = vibeswap_math::mul_div(amount1, price1, PRECISION);
    let total_value = value0 + value1;

    let pool_share_bps = vibeswap_math::mul_div(lp_amount, 10_000, pool.total_lp_supply) as u64;

    Ok(PositionValue {
        amount0,
        amount1,
        total_value,
        pool_share_bps,
    })
}

// ============ Impermanent Loss ============

/// Impermanent loss result comparing LP position to HODL.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImpermanentLoss {
    /// IL in basis points (always >= 0, higher = more loss)
    pub il_bps: u64,
    /// Value if held in LP position
    pub lp_value: u128,
    /// Value if held as tokens (HODL)
    pub hodl_value: u128,
    /// Absolute loss amount (hodl_value - lp_value), or 0 if LP is better
    pub loss_amount: u128,
}

/// Calculate exact impermanent loss for a position.
///
/// Uses the standard IL formula:
///   IL_ratio = 2 * sqrt(r) / (1 + r) where r = price_new / price_entry
///   IL_bps = (1 - IL_ratio) * 10000
///
/// HODL value = initial * (1 + r) / 2
/// LP value = initial * sqrt(r)
///
/// For r=2 (price doubles): IL = 1 - 2*sqrt(2)/3 ≈ 5.72%
pub fn impermanent_loss(
    entry_price: u128,
    current_price: u128,
    initial_value: u128,
) -> Result<ImpermanentLoss, LiquidityError> {
    if entry_price == 0 {
        return Err(LiquidityError::ZeroPrice);
    }

    // price_ratio r = current / entry (PRECISION scale)
    let r = vibeswap_math::mul_div(current_price, PRECISION, entry_price);

    // HODL value = initial * (1 + r) / 2
    // Token0 unchanged, token1 moves by r → average = (1 + r)/2
    let hodl_value = vibeswap_math::mul_div(
        initial_value,
        PRECISION + r,
        2 * PRECISION,
    );

    // LP value = initial * sqrt(r)
    // In constant-product AMM, LP value scales as sqrt(price_ratio)
    let sqrt_r = vibeswap_math::sqrt(vibeswap_math::mul_div(r, PRECISION, 1));
    let lp_value = vibeswap_math::mul_div(initial_value, sqrt_r, PRECISION);

    let loss_amount = hodl_value.saturating_sub(lp_value);
    let il_bps = if hodl_value > 0 {
        vibeswap_math::mul_div(loss_amount, 10_000, hodl_value) as u64
    } else {
        0
    };

    Ok(ImpermanentLoss {
        il_bps,
        lp_value,
        hodl_value,
        loss_amount,
    })
}

// ============ Withdrawal Estimation ============

/// Estimate tokens received when burning LP tokens.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WithdrawalEstimate {
    /// Token0 amount to receive
    pub amount0: u128,
    /// Token1 amount to receive
    pub amount1: u128,
    /// Pool share after withdrawal (bps), 0 if fully withdrawn
    pub remaining_share_bps: u64,
    /// Whether withdrawal would bring pool below minimum liquidity
    pub below_minimum: bool,
}

/// Estimate withdrawal amounts for burning LP tokens.
pub fn estimate_withdrawal(
    lp_to_burn: u128,
    pool: &PoolCellData,
) -> Result<WithdrawalEstimate, LiquidityError> {
    if pool.total_lp_supply == 0 {
        return Err(LiquidityError::ZeroLPSupply);
    }
    if lp_to_burn == 0 {
        return Err(LiquidityError::ZeroAmount);
    }

    let amount0 = vibeswap_math::mul_div(lp_to_burn, pool.reserve0, pool.total_lp_supply);
    let amount1 = vibeswap_math::mul_div(lp_to_burn, pool.reserve1, pool.total_lp_supply);

    let remaining_lp = pool.total_lp_supply.saturating_sub(lp_to_burn);
    let remaining_share_bps = if pool.total_lp_supply > lp_to_burn {
        // This would be the user's remaining share if they had more LP — but we don't know that
        // Return 0 since they're burning all they specified
        0
    } else {
        0
    };

    let below_minimum = remaining_lp < pool.minimum_liquidity;

    Ok(WithdrawalEstimate {
        amount0,
        amount1,
        remaining_share_bps,
        below_minimum,
    })
}

// ============ Optimal Deposit ============

/// Result of optimal deposit calculation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OptimalDeposit {
    /// Amount of token0 to deposit
    pub amount0: u128,
    /// Amount of token1 to deposit
    pub amount1: u128,
    /// Expected LP tokens to receive
    pub expected_lp: u128,
    /// Leftover token0 (not deposited due to ratio)
    pub leftover0: u128,
    /// Leftover token1
    pub leftover1: u128,
}

/// Calculate optimal deposit amounts to maximize LP tokens for a given budget.
///
/// Given desired amounts of token0 and token1, adjusts to match the pool ratio
/// and returns the adjusted amounts + expected LP tokens.
pub fn optimal_deposit(
    amount0_desired: u128,
    amount1_desired: u128,
    pool: &PoolCellData,
) -> Result<OptimalDeposit, LiquidityError> {
    if pool.reserve0 == 0 || pool.reserve1 == 0 {
        // Initial deposit — accept as-is
        if amount0_desired == 0 || amount1_desired == 0 {
            return Err(LiquidityError::ZeroAmount);
        }
        let lp = vibeswap_math::sqrt_product(amount0_desired, amount1_desired)
            .saturating_sub(MINIMUM_LIQUIDITY);
        if lp == 0 {
            return Err(LiquidityError::InsufficientLiquidity);
        }
        return Ok(OptimalDeposit {
            amount0: amount0_desired,
            amount1: amount1_desired,
            expected_lp: lp,
            leftover0: 0,
            leftover1: 0,
        });
    }

    // Calculate optimal ratio
    let (opt0, opt1) = vibeswap_math::batch_math::calculate_optimal_liquidity(
        amount0_desired,
        amount1_desired,
        pool.reserve0,
        pool.reserve1,
    )
    .map_err(|_| LiquidityError::Overflow)?;

    let expected_lp = vibeswap_math::batch_math::calculate_liquidity(
        opt0,
        opt1,
        pool.reserve0,
        pool.reserve1,
        pool.total_lp_supply,
    )
    .map_err(|_| LiquidityError::InsufficientLiquidity)?;

    Ok(OptimalDeposit {
        amount0: opt0,
        amount1: opt1,
        expected_lp,
        leftover0: amount0_desired - opt0,
        leftover1: amount1_desired - opt1,
    })
}

// ============ Zap-In Calculation ============

/// Result of a zap-in calculation (single-sided deposit).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ZapEstimate {
    /// Amount of input token to swap
    pub swap_amount: u128,
    /// Amount of other token received from swap
    pub swap_output: u128,
    /// Amount of input token remaining for deposit
    pub deposit_amount_in: u128,
    /// Total LP tokens expected
    pub expected_lp: u128,
    /// Price impact of the swap (bps)
    pub swap_impact_bps: u64,
}

/// Calculate a single-sided "zap" deposit.
///
/// User has only one token and wants to LP. We calculate:
/// 1. How much to swap to get the other token
/// 2. How much LP they'd receive from the balanced deposit
///
/// The optimal swap amount for a constant-product AMM is:
///   swap = (sqrt(reserve * (reserve * (4 * fee_factor) + amount * fee_factor^2)) - reserve * fee_factor) / (2 * fee_factor)
///
/// We use a simpler approximation: swap half, then deposit.
pub fn zap_in_estimate(
    amount_in: u128,
    is_token0: bool,
    pool: &PoolCellData,
) -> Result<ZapEstimate, LiquidityError> {
    if amount_in == 0 {
        return Err(LiquidityError::ZeroAmount);
    }
    if pool.reserve0 == 0 || pool.reserve1 == 0 {
        return Err(LiquidityError::EmptyPool);
    }

    let (reserve_in, reserve_out) = if is_token0 {
        (pool.reserve0, pool.reserve1)
    } else {
        (pool.reserve1, pool.reserve0)
    };

    // Swap approximately half
    let swap_amount = amount_in / 2;
    let remaining = amount_in - swap_amount;

    // Calculate swap output
    let swap_output = vibeswap_math::batch_math::get_amount_out(
        swap_amount,
        reserve_in,
        reserve_out,
        pool.fee_rate_bps as u128,
    )
    .map_err(|_| LiquidityError::Overflow)?;

    // After swap, new reserves
    let new_reserve_in = reserve_in + swap_amount;
    let new_reserve_out = reserve_out - swap_output;

    // Calculate LP from balanced deposit
    let (dep0, dep1) = if is_token0 {
        (remaining, swap_output)
    } else {
        (swap_output, remaining)
    };

    let (nr0, nr1) = if is_token0 {
        (new_reserve_in, new_reserve_out)
    } else {
        (new_reserve_out, new_reserve_in)
    };

    let expected_lp = vibeswap_math::batch_math::calculate_liquidity(
        dep0, dep1, nr0, nr1, pool.total_lp_supply,
    )
    .map_err(|_| LiquidityError::InsufficientLiquidity)?;

    // Price impact
    let spot_price = vibeswap_math::mul_div(reserve_out, PRECISION, reserve_in);
    let exec_price = vibeswap_math::mul_div(swap_output, PRECISION, swap_amount);
    let impact = if spot_price > exec_price {
        spot_price - exec_price
    } else {
        exec_price - spot_price
    };
    let swap_impact_bps = vibeswap_math::mul_div(impact, 10_000, spot_price) as u64;

    Ok(ZapEstimate {
        swap_amount,
        swap_output,
        deposit_amount_in: remaining,
        expected_lp,
        swap_impact_bps,
    })
}

// ============ Pool Analytics ============

/// Pool analytics snapshot.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolAnalytics {
    /// Total value locked (in reference denomination)
    pub tvl: u128,
    /// Pool depth: sqrt(reserve0 * reserve1)
    pub depth: u128,
    /// Current spot price (token1 per token0, PRECISION scale)
    pub spot_price: u128,
    /// Fee APR estimate from volume (bps)
    pub fee_apr_bps: u64,
    /// Utilization: volume / tvl (bps)
    pub utilization_bps: u64,
}

/// Calculate pool analytics given prices and recent volume.
pub fn pool_analytics(
    pool: &PoolCellData,
    price0: u128,
    price1: u128,
    epoch_volume: u128,
    epoch_blocks: u64,
) -> Result<PoolAnalytics, LiquidityError> {
    if pool.reserve0 == 0 || pool.reserve1 == 0 {
        return Err(LiquidityError::EmptyPool);
    }

    let value0 = vibeswap_math::mul_div(pool.reserve0, price0, PRECISION);
    let value1 = vibeswap_math::mul_div(pool.reserve1, price1, PRECISION);
    let tvl = value0 + value1;

    let depth = vibeswap_math::sqrt_product(pool.reserve0, pool.reserve1);

    let spot_price = vibeswap_math::mul_div(pool.reserve1, PRECISION, pool.reserve0);

    // Fee APR: (volume * fee_rate / tvl) annualized
    let fee_apr_bps = if tvl > 0 && epoch_blocks > 0 {
        let epoch_fees = vibeswap_math::mul_div(epoch_volume, pool.fee_rate_bps as u128, 10_000);
        let blocks_per_year: u128 = 7_884_000;
        let annualized_fees = vibeswap_math::mul_div(epoch_fees, blocks_per_year, epoch_blocks as u128);
        vibeswap_math::mul_div(annualized_fees, 10_000, tvl) as u64
    } else {
        0
    };

    let utilization_bps = if tvl > 0 {
        vibeswap_math::mul_div(epoch_volume, 10_000, tvl) as u64
    } else {
        0
    };

    Ok(PoolAnalytics {
        tvl,
        depth,
        spot_price,
        fee_apr_bps,
        utilization_bps,
    })
}

/// Calculate the minimum LP tokens that must remain in the pool.
pub fn available_lp_to_burn(pool: &PoolCellData) -> u128 {
    pool.total_lp_supply.saturating_sub(pool.minimum_liquidity)
}

/// Spot price of token0 in terms of token1 (PRECISION scale).
pub fn spot_price(pool: &PoolCellData) -> Result<u128, LiquidityError> {
    if pool.reserve0 == 0 {
        return Err(LiquidityError::EmptyPool);
    }
    Ok(vibeswap_math::mul_div(pool.reserve1, PRECISION, pool.reserve0))
}

/// Calculate the k-invariant: reserve0 * reserve1.
/// Returns (high, low) for 256-bit result.
pub fn k_invariant(pool: &PoolCellData) -> (u128, u128) {
    vibeswap_math::wide_mul(pool.reserve0, pool.reserve1)
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn make_pool(r0: u128, r1: u128, lp: u128, fee_bps: u16) -> PoolCellData {
        PoolCellData {
            reserve0: r0,
            reserve1: r1,
            total_lp_supply: lp,
            fee_rate_bps: fee_bps,
            twap_price_cum: 0,
            twap_last_block: 0,
            k_last: [0; 32],
            minimum_liquidity: MINIMUM_LIQUIDITY,
            pair_id: [1; 32],
            token0_type_hash: [2; 32],
            token1_type_hash: [3; 32],
        }
    }

    fn balanced_pool() -> PoolCellData {
        make_pool(
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            30, // 0.3%
        )
    }

    fn imbalanced_pool() -> PoolCellData {
        make_pool(
            500_000 * PRECISION,
            2_000_000 * PRECISION,
            1_000_000 * PRECISION,
            30,
        )
    }

    // ============ Position Value ============

    #[test]
    fn test_position_value_full_pool() {
        let pool = balanced_pool();
        let val = position_value(
            pool.total_lp_supply,
            &pool,
            PRECISION, // $1 per token0
            PRECISION, // $1 per token1
        ).unwrap();

        assert_eq!(val.amount0, pool.reserve0);
        assert_eq!(val.amount1, pool.reserve1);
        assert_eq!(val.total_value, pool.reserve0 + pool.reserve1);
        assert_eq!(val.pool_share_bps, 10_000); // 100%
    }

    #[test]
    fn test_position_value_half_pool() {
        let pool = balanced_pool();
        let val = position_value(
            pool.total_lp_supply / 2,
            &pool,
            PRECISION,
            PRECISION,
        ).unwrap();

        assert_eq!(val.amount0, pool.reserve0 / 2);
        assert_eq!(val.amount1, pool.reserve1 / 2);
        assert_eq!(val.pool_share_bps, 5_000); // 50%
    }

    #[test]
    fn test_position_value_imbalanced_pool() {
        let pool = imbalanced_pool();
        let val = position_value(
            pool.total_lp_supply / 4,
            &pool,
            PRECISION,     // $1 per token0
            PRECISION / 4, // $0.25 per token1
        ).unwrap();

        let expected0 = pool.reserve0 / 4;
        let expected1 = pool.reserve1 / 4;
        assert_eq!(val.amount0, expected0);
        assert_eq!(val.amount1, expected1);

        // Value: 125K * $1 + 500K * $0.25 = $250K
        let exp_val = vibeswap_math::mul_div(expected0, PRECISION, PRECISION)
            + vibeswap_math::mul_div(expected1, PRECISION / 4, PRECISION);
        assert_eq!(val.total_value, exp_val);
    }

    #[test]
    fn test_position_value_zero_lp_supply() {
        let mut pool = balanced_pool();
        pool.total_lp_supply = 0;
        let err = position_value(1000, &pool, PRECISION, PRECISION).unwrap_err();
        assert_eq!(err, LiquidityError::ZeroLPSupply);
    }

    #[test]
    fn test_position_value_zero_prices() {
        let pool = balanced_pool();
        let val = position_value(pool.total_lp_supply, &pool, 0, 0).unwrap();
        assert_eq!(val.total_value, 0);
        assert!(val.amount0 > 0); // Still entitled to tokens
    }

    // ============ Impermanent Loss ============

    #[test]
    fn test_il_no_price_change() {
        let il = impermanent_loss(PRECISION, PRECISION, 100_000 * PRECISION).unwrap();
        assert_eq!(il.il_bps, 0);
        assert_eq!(il.loss_amount, 0);
        assert_eq!(il.lp_value, il.hodl_value);
    }

    #[test]
    fn test_il_2x_price_increase() {
        // Classic IL scenario: price doubles
        let il = impermanent_loss(
            PRECISION,
            2 * PRECISION,
            100_000 * PRECISION,
        ).unwrap();

        // IL for 2x should be ~5.7% = ~570 bps
        assert!(il.il_bps > 500, "IL should be > 5%: {}", il.il_bps);
        assert!(il.il_bps < 700, "IL should be < 7%: {}", il.il_bps);
        assert!(il.hodl_value > il.lp_value);
        assert!(il.loss_amount > 0);
    }

    #[test]
    fn test_il_half_price_decrease() {
        // Price halves
        let il = impermanent_loss(
            PRECISION,
            PRECISION / 2,
            100_000 * PRECISION,
        ).unwrap();

        // IL for 0.5x should also be ~5.7% (symmetric)
        assert!(il.il_bps > 500);
        assert!(il.il_bps < 700);
    }

    #[test]
    fn test_il_symmetry() {
        // IL should be roughly symmetric for reciprocal price moves
        let il_up = impermanent_loss(PRECISION, 4 * PRECISION, 100_000 * PRECISION).unwrap();
        let il_down = impermanent_loss(4 * PRECISION, PRECISION, 100_000 * PRECISION).unwrap();

        // Not exactly equal due to how HODL vs LP scale, but same IL mechanism
        assert!(il_up.il_bps > 0);
        assert!(il_down.il_bps > 0);
    }

    #[test]
    fn test_il_zero_entry_price() {
        let err = impermanent_loss(0, PRECISION, 100_000 * PRECISION).unwrap_err();
        assert_eq!(err, LiquidityError::ZeroPrice);
    }

    #[test]
    fn test_il_extreme_10x() {
        let il = impermanent_loss(PRECISION, 10 * PRECISION, 100_000 * PRECISION).unwrap();
        // IL for 10x is ~42.5%
        assert!(il.il_bps > 4000);
        assert!(il.il_bps < 5000);
    }

    // ============ Withdrawal Estimation ============

    #[test]
    fn test_withdrawal_full() {
        let pool = balanced_pool();
        let est = estimate_withdrawal(pool.total_lp_supply, &pool).unwrap();
        assert_eq!(est.amount0, pool.reserve0);
        assert_eq!(est.amount1, pool.reserve1);
        assert!(est.below_minimum); // Withdrawing all would go below minimum
    }

    #[test]
    fn test_withdrawal_partial() {
        let pool = balanced_pool();
        let est = estimate_withdrawal(pool.total_lp_supply / 10, &pool).unwrap();
        assert_eq!(est.amount0, pool.reserve0 / 10);
        assert_eq!(est.amount1, pool.reserve1 / 10);
        assert!(!est.below_minimum);
    }

    #[test]
    fn test_withdrawal_zero_amount() {
        let pool = balanced_pool();
        let err = estimate_withdrawal(0, &pool).unwrap_err();
        assert_eq!(err, LiquidityError::ZeroAmount);
    }

    #[test]
    fn test_withdrawal_zero_supply() {
        let mut pool = balanced_pool();
        pool.total_lp_supply = 0;
        let err = estimate_withdrawal(1000, &pool).unwrap_err();
        assert_eq!(err, LiquidityError::ZeroLPSupply);
    }

    #[test]
    fn test_withdrawal_below_minimum() {
        let pool = make_pool(
            10_000 * PRECISION,
            10_000 * PRECISION,
            2_000, // Just above minimum_liquidity (1000)
            30,
        );
        let est = estimate_withdrawal(1_500, &pool).unwrap();
        assert!(est.below_minimum); // 2000 - 1500 = 500 < 1000
    }

    // ============ Optimal Deposit ============

    #[test]
    fn test_optimal_deposit_balanced() {
        let pool = balanced_pool();
        let dep = optimal_deposit(
            10_000 * PRECISION,
            10_000 * PRECISION,
            &pool,
        ).unwrap();

        // Pool is 1:1, so optimal is to deposit equal amounts
        assert_eq!(dep.amount0, 10_000 * PRECISION);
        assert_eq!(dep.amount1, 10_000 * PRECISION);
        assert_eq!(dep.leftover0, 0);
        assert_eq!(dep.leftover1, 0);
        assert!(dep.expected_lp > 0);
    }

    #[test]
    fn test_optimal_deposit_excess_token0() {
        let pool = balanced_pool();
        let dep = optimal_deposit(
            20_000 * PRECISION, // 2x token0
            10_000 * PRECISION,
            &pool,
        ).unwrap();

        // Should cap token0 to match pool ratio
        assert_eq!(dep.amount0, 10_000 * PRECISION);
        assert_eq!(dep.amount1, 10_000 * PRECISION);
        assert_eq!(dep.leftover0, 10_000 * PRECISION);
        assert_eq!(dep.leftover1, 0);
    }

    #[test]
    fn test_optimal_deposit_imbalanced_pool() {
        let pool = imbalanced_pool(); // 500K:2M ratio = 1:4
        let dep = optimal_deposit(
            10_000 * PRECISION,
            10_000 * PRECISION,
            &pool,
        ).unwrap();

        // Pool ratio is 1:4, so 10K token0 needs 40K token1
        // But we only have 10K token1, so cap based on token1
        // 10K token1 needs 2.5K token0
        assert_eq!(dep.amount0, 2_500 * PRECISION);
        assert_eq!(dep.amount1, 10_000 * PRECISION);
        assert_eq!(dep.leftover0, 7_500 * PRECISION);
        assert!(dep.expected_lp > 0);
    }

    #[test]
    fn test_optimal_deposit_initial() {
        let empty = make_pool(0, 0, 0, 30);
        let dep = optimal_deposit(
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            &empty,
        ).unwrap();

        assert_eq!(dep.amount0, 1_000_000 * PRECISION);
        assert_eq!(dep.amount1, 1_000_000 * PRECISION);
        assert!(dep.expected_lp > 0);
        // Initial LP = sqrt(a0 * a1) - 1000
        let expected = vibeswap_math::sqrt_product(1_000_000 * PRECISION, 1_000_000 * PRECISION)
            .saturating_sub(MINIMUM_LIQUIDITY);
        assert_eq!(dep.expected_lp, expected);
    }

    #[test]
    fn test_optimal_deposit_zero_amounts() {
        let empty = make_pool(0, 0, 0, 30);
        let err = optimal_deposit(0, 1000, &empty).unwrap_err();
        assert_eq!(err, LiquidityError::ZeroAmount);
    }

    // ============ Zap-In ============

    #[test]
    fn test_zap_in_token0() {
        let pool = balanced_pool();
        let zap = zap_in_estimate(10_000 * PRECISION, true, &pool).unwrap();

        assert_eq!(zap.swap_amount, 5_000 * PRECISION);
        assert!(zap.swap_output > 0);
        assert_eq!(zap.deposit_amount_in, 5_000 * PRECISION);
        assert!(zap.expected_lp > 0);
        // Small swap relative to pool — low impact
        assert!(zap.swap_impact_bps < 100, "Impact should be < 1%: {}", zap.swap_impact_bps);
    }

    #[test]
    fn test_zap_in_token1() {
        let pool = balanced_pool();
        let zap = zap_in_estimate(10_000 * PRECISION, false, &pool).unwrap();

        assert!(zap.swap_output > 0);
        assert!(zap.expected_lp > 0);
    }

    #[test]
    fn test_zap_in_large_relative_to_pool() {
        let pool = balanced_pool();
        // Zap 50% of pool reserves — should have significant impact
        let zap = zap_in_estimate(500_000 * PRECISION, true, &pool).unwrap();
        assert!(zap.swap_impact_bps > 100, "Large zap should have > 1% impact");
    }

    #[test]
    fn test_zap_in_zero_amount() {
        let pool = balanced_pool();
        let err = zap_in_estimate(0, true, &pool).unwrap_err();
        assert_eq!(err, LiquidityError::ZeroAmount);
    }

    #[test]
    fn test_zap_in_empty_pool() {
        let pool = make_pool(0, 0, 0, 30);
        let err = zap_in_estimate(1000, true, &pool).unwrap_err();
        assert_eq!(err, LiquidityError::EmptyPool);
    }

    // ============ Pool Analytics ============

    #[test]
    fn test_pool_analytics_balanced() {
        let pool = balanced_pool();
        let analytics = pool_analytics(
            &pool,
            PRECISION,  // $1
            PRECISION,  // $1
            100_000 * PRECISION, // 100K volume
            788_400, // ~1/10 year
        ).unwrap();

        assert_eq!(analytics.tvl, 2_000_000 * PRECISION); // $1M + $1M
        assert!(analytics.depth > 0);
        assert_eq!(analytics.spot_price, PRECISION); // 1:1
        assert!(analytics.fee_apr_bps > 0);
        assert!(analytics.utilization_bps > 0);
    }

    #[test]
    fn test_pool_analytics_fee_apr() {
        let pool = balanced_pool(); // TVL = $2M, fee = 0.3%
        let analytics = pool_analytics(
            &pool,
            PRECISION,
            PRECISION,
            2_000_000 * PRECISION, // $2M volume per epoch (= TVL)
            7_884_000, // Full year
        ).unwrap();

        // Fee income = $2M × 0.3% = $6K
        // APR = $6K / $2M = 0.3% = 30 bps
        assert!(analytics.fee_apr_bps >= 28 && analytics.fee_apr_bps <= 32,
            "Expected ~30 bps APR, got {}", analytics.fee_apr_bps);
    }

    #[test]
    fn test_pool_analytics_empty_pool() {
        let pool = make_pool(0, 0, 0, 30);
        let err = pool_analytics(&pool, PRECISION, PRECISION, 0, 1000).unwrap_err();
        assert_eq!(err, LiquidityError::EmptyPool);
    }

    #[test]
    fn test_pool_analytics_zero_volume() {
        let pool = balanced_pool();
        let analytics = pool_analytics(&pool, PRECISION, PRECISION, 0, 1000).unwrap();
        assert_eq!(analytics.fee_apr_bps, 0);
        assert_eq!(analytics.utilization_bps, 0);
    }

    // ============ Utility Functions ============

    #[test]
    fn test_available_lp_to_burn() {
        let pool = balanced_pool();
        let available = available_lp_to_burn(&pool);
        assert_eq!(available, pool.total_lp_supply - MINIMUM_LIQUIDITY);
    }

    #[test]
    fn test_spot_price_balanced() {
        let pool = balanced_pool();
        assert_eq!(spot_price(&pool).unwrap(), PRECISION);
    }

    #[test]
    fn test_spot_price_imbalanced() {
        let pool = imbalanced_pool(); // 500K:2M → price = 4
        let price = spot_price(&pool).unwrap();
        assert_eq!(price, 4 * PRECISION);
    }

    #[test]
    fn test_spot_price_empty() {
        let pool = make_pool(0, 1000, 1000, 30);
        let err = spot_price(&pool).unwrap_err();
        assert_eq!(err, LiquidityError::EmptyPool);
    }

    #[test]
    fn test_k_invariant() {
        let pool = balanced_pool();
        let (hi, lo) = k_invariant(&pool);
        // 1M * 1M * PRECISION^2 — will have high bits
        assert!(hi > 0 || lo > 0);
    }

    // ============ Integration ============

    #[test]
    fn test_deposit_then_withdraw_roundtrip() {
        let pool = balanced_pool();

        // Deposit 10K:10K
        let dep = optimal_deposit(10_000 * PRECISION, 10_000 * PRECISION, &pool).unwrap();

        // Simulate pool after deposit
        let mut new_pool = pool.clone();
        new_pool.reserve0 += dep.amount0;
        new_pool.reserve1 += dep.amount1;
        new_pool.total_lp_supply += dep.expected_lp;

        // Withdraw the same LP
        let est = estimate_withdrawal(dep.expected_lp, &new_pool).unwrap();

        // Should get back approximately what was deposited (within rounding)
        let diff0 = if est.amount0 > dep.amount0 { est.amount0 - dep.amount0 } else { dep.amount0 - est.amount0 };
        let diff1 = if est.amount1 > dep.amount1 { est.amount1 - dep.amount1 } else { dep.amount1 - est.amount1 };

        // Allow 0.01% rounding error
        assert!(diff0 < dep.amount0 / 10_000, "Token0 roundtrip error too large");
        assert!(diff1 < dep.amount1 / 10_000, "Token1 roundtrip error too large");
    }

    #[test]
    fn test_il_vs_position_value() {
        let pool = balanced_pool();
        let initial_value = 100_000 * PRECISION;

        // Position value at entry
        let val_entry = position_value(
            pool.total_lp_supply / 10, // 10% of pool
            &pool,
            PRECISION, PRECISION,
        ).unwrap();

        // Simulate 2x price move (reserve0 halves, reserve1 doubles to maintain k)
        let mut moved_pool = pool.clone();
        // After arb: r0 = r0/sqrt(2), r1 = r1*sqrt(2) to maintain k and get 2x price
        let sqrt2 = vibeswap_math::sqrt(2 * PRECISION * PRECISION);
        moved_pool.reserve0 = vibeswap_math::mul_div(pool.reserve0, PRECISION, sqrt2);
        moved_pool.reserve1 = vibeswap_math::mul_div(pool.reserve1, sqrt2, PRECISION);

        let val_after = position_value(
            pool.total_lp_supply / 10,
            &moved_pool,
            PRECISION,     // token0 still $1
            2 * PRECISION, // token1 now $2
        ).unwrap();

        // LP value should have grown, but less than HODL
        assert!(val_after.total_value > val_entry.total_value, "LP value should increase with price");
    }

    // ============ Additional Edge Case & Boundary Tests ============

    #[test]
    fn test_position_value_tiny_lp_amount() {
        // Minimal LP amount (1 unit) should still return valid proportional amounts
        let pool = balanced_pool();
        let val = position_value(1, &pool, PRECISION, PRECISION).unwrap();
        // 1 / total_lp_supply fraction of reserves
        assert_eq!(val.amount0, vibeswap_math::mul_div(1, pool.reserve0, pool.total_lp_supply));
        assert_eq!(val.amount1, vibeswap_math::mul_div(1, pool.reserve1, pool.total_lp_supply));
        assert_eq!(val.pool_share_bps, 0); // Less than 1 bps
    }

    #[test]
    fn test_position_value_asymmetric_prices() {
        // Token0 worth much more than token1
        let pool = balanced_pool();
        let val = position_value(
            pool.total_lp_supply,
            &pool,
            100 * PRECISION,  // $100 per token0
            PRECISION / 100,  // $0.01 per token1
        ).unwrap();
        // Value should be dominated by token0
        let value0 = vibeswap_math::mul_div(pool.reserve0, 100 * PRECISION, PRECISION);
        let value1 = vibeswap_math::mul_div(pool.reserve1, PRECISION / 100, PRECISION);
        assert_eq!(val.total_value, value0 + value1);
        assert!(value0 > value1 * 1000); // token0 side dominates
    }

    #[test]
    fn test_il_zero_current_price() {
        // Current price drops to zero — extreme edge case
        let il = impermanent_loss(PRECISION, 0, 100_000 * PRECISION).unwrap();
        // r = 0, sqrt(0) = 0, LP value = 0
        // HODL value = initial * (1+0)/2 = initial/2
        assert_eq!(il.lp_value, 0);
        assert!(il.hodl_value > 0);
        assert_eq!(il.loss_amount, il.hodl_value);
    }

    #[test]
    fn test_il_same_price_zero_initial_value() {
        // Zero initial value — IL should be zero
        let il = impermanent_loss(PRECISION, PRECISION, 0).unwrap();
        assert_eq!(il.il_bps, 0);
        assert_eq!(il.lp_value, 0);
        assert_eq!(il.hodl_value, 0);
        assert_eq!(il.loss_amount, 0);
    }

    #[test]
    fn test_il_100x_price_increase() {
        // Extreme price move: 100x
        let il = impermanent_loss(PRECISION, 100 * PRECISION, 100_000 * PRECISION).unwrap();
        // IL for 100x is very large — sqrt(100)=10, HODL=(1+100)/2=50.5, LP=10
        // IL = 1 - 10/50.5 ≈ 80.2%
        assert!(il.il_bps > 7500, "IL for 100x should be > 75%: {}", il.il_bps);
        assert!(il.il_bps < 8500, "IL for 100x should be < 85%: {}", il.il_bps);
    }

    #[test]
    fn test_withdrawal_more_than_supply() {
        // Burning more LP than exists — should still compute (saturating_sub handles it)
        let pool = balanced_pool();
        let est = estimate_withdrawal(pool.total_lp_supply + 1000, &pool).unwrap();
        // Should get more than total reserves due to proportional calculation
        assert!(est.amount0 >= pool.reserve0);
        assert!(est.amount1 >= pool.reserve1);
        assert!(est.below_minimum);
    }

    #[test]
    fn test_withdrawal_imbalanced_pool() {
        // Withdrawal from a pool with imbalanced reserves
        let pool = imbalanced_pool();
        let est = estimate_withdrawal(pool.total_lp_supply / 5, &pool).unwrap();
        // Should get 1/5 of each reserve
        assert_eq!(est.amount0, pool.reserve0 / 5);
        assert_eq!(est.amount1, pool.reserve1 / 5);
        // 4/5 of LP remains, which is well above minimum
        assert!(!est.below_minimum);
    }

    #[test]
    fn test_optimal_deposit_both_zero_on_empty_pool() {
        let empty = make_pool(0, 0, 0, 30);
        let err = optimal_deposit(0, 0, &empty).unwrap_err();
        assert_eq!(err, LiquidityError::ZeroAmount);
    }

    #[test]
    fn test_optimal_deposit_excess_token1() {
        // Excess token1 instead of token0
        let pool = balanced_pool();
        let dep = optimal_deposit(
            10_000 * PRECISION,
            30_000 * PRECISION, // 3x token1
            &pool,
        ).unwrap();
        // Should cap token1 to match pool ratio (1:1)
        assert_eq!(dep.amount0, 10_000 * PRECISION);
        assert_eq!(dep.amount1, 10_000 * PRECISION);
        assert_eq!(dep.leftover0, 0);
        assert_eq!(dep.leftover1, 20_000 * PRECISION);
    }

    #[test]
    fn test_zap_in_imbalanced_pool_token0() {
        // Zap into an imbalanced pool (1:4 ratio)
        let pool = imbalanced_pool();
        let zap = zap_in_estimate(10_000 * PRECISION, true, &pool).unwrap();
        assert_eq!(zap.swap_amount, 5_000 * PRECISION);
        assert!(zap.swap_output > 0);
        assert!(zap.expected_lp > 0);
    }

    #[test]
    fn test_zap_in_tiny_amount_errors() {
        // Very small zap amount (1 unit) — swap_amount = 0 causes InsufficientInput
        // which maps to Overflow via the map_err in get_amount_out
        let pool = balanced_pool();
        let result = zap_in_estimate(1, true, &pool);
        assert!(result.is_err(), "Tiny zap should fail because swap_amount rounds to 0");
    }

    #[test]
    fn test_zap_in_small_but_valid_amount() {
        // Minimum viable zap: 2 units (swap_amount = 1, remaining = 1)
        let pool = balanced_pool();
        let zap = zap_in_estimate(2, true, &pool).unwrap();
        assert_eq!(zap.swap_amount, 1);
        assert_eq!(zap.deposit_amount_in, 1);
    }

    #[test]
    fn test_pool_analytics_imbalanced() {
        let pool = imbalanced_pool(); // 500K:2M
        let analytics = pool_analytics(
            &pool,
            PRECISION,     // $1 per token0
            PRECISION / 4, // $0.25 per token1
            50_000 * PRECISION,
            788_400,
        ).unwrap();
        // TVL = 500K*$1 + 2M*$0.25 = $500K + $500K = $1M
        assert_eq!(analytics.tvl, 1_000_000 * PRECISION);
        // Spot price = reserve1 / reserve0 = 2M / 500K = 4
        assert_eq!(analytics.spot_price, 4 * PRECISION);
    }

    #[test]
    fn test_pool_analytics_zero_epoch_blocks() {
        // Zero blocks in epoch — fee APR should be 0
        let pool = balanced_pool();
        let analytics = pool_analytics(&pool, PRECISION, PRECISION, 100_000 * PRECISION, 0).unwrap();
        assert_eq!(analytics.fee_apr_bps, 0);
    }

    #[test]
    fn test_available_lp_to_burn_below_minimum() {
        // Pool with LP supply at or below minimum — available should be 0
        let pool = make_pool(10_000, 10_000, MINIMUM_LIQUIDITY, 30);
        let available = available_lp_to_burn(&pool);
        assert_eq!(available, 0);

        // Below minimum (shouldn't happen in practice but test saturating_sub)
        let pool2 = make_pool(10_000, 10_000, MINIMUM_LIQUIDITY - 1, 30);
        let available2 = available_lp_to_burn(&pool2);
        assert_eq!(available2, 0);
    }

    #[test]
    fn test_k_invariant_imbalanced() {
        let pool = imbalanced_pool();
        let (hi, lo) = k_invariant(&pool);
        // k should be reserve0 * reserve1
        // 500K * 2M * PRECISION^2 — verify non-zero
        assert!(hi > 0 || lo > 0);
        // Compare against balanced pool: balanced has 1M*1M = 1e12, imbalanced has 500K*2M = 1e12
        // Same product (both have k = 1e12 * PRECISION^2)
        let balanced = balanced_pool();
        let (bhi, blo) = k_invariant(&balanced);
        assert_eq!(hi, bhi);
        assert_eq!(lo, blo);
    }

    // ============ New Edge Case & Coverage Tests (Batch 3) ============

    #[test]
    fn test_position_value_zero_lp_amount() {
        // Zero LP amount should give zero amounts but no error
        let pool = balanced_pool();
        let val = position_value(0, &pool, PRECISION, PRECISION).unwrap();
        assert_eq!(val.amount0, 0);
        assert_eq!(val.amount1, 0);
        assert_eq!(val.total_value, 0);
        assert_eq!(val.pool_share_bps, 0);
    }

    #[test]
    fn test_il_very_small_price_change() {
        // Price moves by only 0.1% — IL should be essentially zero
        let il = impermanent_loss(
            PRECISION,
            PRECISION * 1001 / 1000, // +0.1%
            100_000 * PRECISION,
        ).unwrap();
        // IL for 0.1% move should be < 1 bps
        assert!(il.il_bps < 1, "Tiny price move should produce negligible IL: {}", il.il_bps);
    }

    #[test]
    fn test_withdrawal_exactly_minimum_liquidity() {
        // Burning exactly enough to bring pool to minimum_liquidity
        let pool = make_pool(
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            10_000,
            30,
        );
        let burn_amount = 10_000 - MINIMUM_LIQUIDITY;
        let est = estimate_withdrawal(burn_amount, &pool).unwrap();
        // After burning, remaining = MINIMUM_LIQUIDITY exactly
        assert!(!est.below_minimum, "Remaining at exactly minimum should not be below_minimum");
    }

    #[test]
    fn test_optimal_deposit_very_small_amounts() {
        // Very small deposit into a large pool
        let pool = balanced_pool();
        let dep = optimal_deposit(1, 1, &pool).unwrap();
        assert_eq!(dep.amount0, 1);
        assert_eq!(dep.amount1, 1);
        assert_eq!(dep.leftover0, 0);
        assert_eq!(dep.leftover1, 0);
        // LP might be 0 due to rounding, but should not panic
    }

    #[test]
    fn test_zap_in_imbalanced_pool_token1() {
        // Zap token1 into an imbalanced pool
        let pool = imbalanced_pool(); // 500K:2M
        let zap = zap_in_estimate(10_000 * PRECISION, false, &pool).unwrap();
        assert_eq!(zap.swap_amount, 5_000 * PRECISION);
        assert!(zap.swap_output > 0);
        assert!(zap.expected_lp > 0);
    }

    #[test]
    fn test_pool_analytics_high_volume() {
        // Volume much higher than TVL — high utilization
        let pool = balanced_pool();
        let analytics = pool_analytics(
            &pool,
            PRECISION,
            PRECISION,
            20_000_000 * PRECISION, // 20M volume vs 2M TVL
            788_400,
        ).unwrap();
        // Utilization = volume/tvl * 10000 = 20M/2M * 10000 = 100000 bps
        assert!(analytics.utilization_bps > 10_000,
            "Volume >> TVL should produce utilization > 100%: {}", analytics.utilization_bps);
    }

    #[test]
    fn test_spot_price_reserves_1_to_1000() {
        // Very imbalanced pool: 1:1000 ratio
        let pool = make_pool(
            1 * PRECISION,
            1000 * PRECISION,
            1000 * PRECISION,
            30,
        );
        let price = spot_price(&pool).unwrap();
        assert_eq!(price, 1000 * PRECISION);
    }

    #[test]
    fn test_available_lp_to_burn_large_supply() {
        // Very large LP supply — should saturate correctly
        let pool = make_pool(
            u128::MAX / 4,
            u128::MAX / 4,
            u128::MAX / 2,
            30,
        );
        let available = available_lp_to_burn(&pool);
        assert_eq!(available, u128::MAX / 2 - MINIMUM_LIQUIDITY);
    }

    // ============ Batch 4: Additional Edge Case & Coverage Tests ============

    #[test]
    fn test_position_value_with_different_prices() {
        // Token0 at $2 and Token1 at $0.50 — verify total_value computed correctly
        let pool = balanced_pool();
        let lp_amount = pool.total_lp_supply / 10; // 10%
        let val = position_value(lp_amount, &pool, 2 * PRECISION, PRECISION / 2).unwrap();

        let expected_amount0 = pool.reserve0 / 10;
        let expected_amount1 = pool.reserve1 / 10;
        assert_eq!(val.amount0, expected_amount0);
        assert_eq!(val.amount1, expected_amount1);

        let value0 = vibeswap_math::mul_div(expected_amount0, 2 * PRECISION, PRECISION);
        let value1 = vibeswap_math::mul_div(expected_amount1, PRECISION / 2, PRECISION);
        assert_eq!(val.total_value, value0 + value1);
    }

    #[test]
    fn test_il_4x_price_increase() {
        // Price quadruples: IL should be ~20%
        let il = impermanent_loss(PRECISION, 4 * PRECISION, 100_000 * PRECISION).unwrap();
        // IL for 4x: 1 - 2*sqrt(4)/(1+4) = 1 - 4/5 = 20% = 2000 bps
        assert!(il.il_bps > 1800, "IL for 4x should be ~20%: got {}", il.il_bps);
        assert!(il.il_bps < 2200, "IL for 4x should be ~20%: got {}", il.il_bps);
    }

    #[test]
    fn test_withdrawal_one_unit_lp() {
        // Withdrawing exactly 1 LP unit from a large pool
        let pool = balanced_pool();
        let est = estimate_withdrawal(1, &pool).unwrap();
        // Should get proportional (tiny) amounts
        let expected0 = vibeswap_math::mul_div(1, pool.reserve0, pool.total_lp_supply);
        let expected1 = vibeswap_math::mul_div(1, pool.reserve1, pool.total_lp_supply);
        assert_eq!(est.amount0, expected0);
        assert_eq!(est.amount1, expected1);
        assert!(!est.below_minimum);
    }

    #[test]
    fn test_optimal_deposit_initial_zero_token0() {
        // Initial deposit with zero token0 on empty pool should fail
        let empty = make_pool(0, 0, 0, 30);
        let err = optimal_deposit(0, 1_000_000 * PRECISION, &empty).unwrap_err();
        assert_eq!(err, LiquidityError::ZeroAmount);
    }

    #[test]
    fn test_zap_in_half_split_amount() {
        // Verify the swap_amount is exactly half and deposit_amount_in is the remainder
        let pool = balanced_pool();
        let amount = 1_000 * PRECISION;
        let zap = zap_in_estimate(amount, true, &pool).unwrap();
        assert_eq!(zap.swap_amount, amount / 2);
        assert_eq!(zap.deposit_amount_in, amount - amount / 2);
        assert_eq!(zap.swap_amount + zap.deposit_amount_in, amount);
    }

    #[test]
    fn test_pool_analytics_spot_price_imbalanced() {
        // Spot price in analytics should match the standalone spot_price function
        let pool = imbalanced_pool();
        let analytics = pool_analytics(
            &pool, PRECISION, PRECISION, 0, 1000,
        ).unwrap();
        let standalone_price = spot_price(&pool).unwrap();
        assert_eq!(analytics.spot_price, standalone_price);
    }

    #[test]
    fn test_k_invariant_zero_reserves() {
        // Pool with zero reserves should have k = 0
        let pool = make_pool(0, 0, 0, 30);
        let (hi, lo) = k_invariant(&pool);
        assert_eq!(hi, 0);
        assert_eq!(lo, 0);
    }

    #[test]
    fn test_spot_price_one_sided_zero_reserve1() {
        // reserve1 = 0, reserve0 > 0 → spot price = 0
        let pool = make_pool(1000 * PRECISION, 0, 1000, 30);
        let price = spot_price(&pool).unwrap();
        assert_eq!(price, 0, "Zero reserve1 should give spot price of 0");
    }

    // ============ Batch 5: Edge Cases, Boundaries, Overflow & Error Paths ============

    #[test]
    fn test_position_value_lp_exceeds_supply() {
        // LP amount greater than total supply — should compute proportional amounts > reserves
        let pool = balanced_pool();
        let val = position_value(
            pool.total_lp_supply * 3,
            &pool,
            PRECISION,
            PRECISION,
        ).unwrap();
        // Should get 3x the reserves
        assert_eq!(val.amount0, pool.reserve0 * 3);
        assert_eq!(val.amount1, pool.reserve1 * 3);
        // pool_share_bps capped at > 10000
        assert_eq!(val.pool_share_bps, 30_000);
    }

    #[test]
    fn test_position_value_one_price_zero() {
        // Only one price is zero — total_value should reflect only the priced token
        let pool = balanced_pool();
        let val = position_value(pool.total_lp_supply, &pool, PRECISION, 0).unwrap();
        let expected_value = vibeswap_math::mul_div(pool.reserve0, PRECISION, PRECISION);
        assert_eq!(val.total_value, expected_value);
        // Amounts still valid
        assert_eq!(val.amount0, pool.reserve0);
        assert_eq!(val.amount1, pool.reserve1);
    }

    #[test]
    fn test_position_value_pool_share_rounding() {
        // LP amount that produces non-integer bps — verify truncation
        let pool = make_pool(
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            30_000, // Unusual LP supply for exact bps test
            30,
        );
        // 1/3 of pool = 3333.33 bps → should truncate to 3333
        let val = position_value(10_000, &pool, PRECISION, PRECISION).unwrap();
        assert_eq!(val.pool_share_bps, 3333);
    }

    #[test]
    fn test_il_price_drops_to_1_percent() {
        // Price drops to 1% of entry — extreme downside
        let il = impermanent_loss(
            100 * PRECISION,
            1 * PRECISION, // 1% of entry
            100_000 * PRECISION,
        ).unwrap();
        // r = 0.01, sqrt(0.01) = 0.1, HODL = (1+0.01)/2 = 0.505, LP = 0.1
        // IL = 1 - 0.1/0.505 ≈ 80.2%
        assert!(il.il_bps > 7500, "IL for 99% drop should be very high: {}", il.il_bps);
        assert!(il.hodl_value > il.lp_value);
    }

    #[test]
    fn test_il_entry_equals_current() {
        // Same absolute price but different magnitude — verify zero IL
        let il = impermanent_loss(
            500 * PRECISION,
            500 * PRECISION,
            1_000_000 * PRECISION,
        ).unwrap();
        assert_eq!(il.il_bps, 0);
        assert_eq!(il.loss_amount, 0);
        assert_eq!(il.lp_value, il.hodl_value);
    }

    #[test]
    fn test_il_very_small_initial_value() {
        // Initial value = 1 unit — verify no division-by-zero or panic
        let il = impermanent_loss(PRECISION, 2 * PRECISION, 1).unwrap();
        // With initial_value = 1, values will be very small but should not panic
        assert!(il.hodl_value >= il.lp_value);
    }

    #[test]
    fn test_withdrawal_burn_exactly_total_supply() {
        // Burn exactly the total supply — should get all reserves
        let pool = balanced_pool();
        let est = estimate_withdrawal(pool.total_lp_supply, &pool).unwrap();
        assert_eq!(est.amount0, pool.reserve0);
        assert_eq!(est.amount1, pool.reserve1);
        // remaining = 0 which is below minimum_liquidity
        assert!(est.below_minimum);
        assert_eq!(est.remaining_share_bps, 0);
    }

    #[test]
    fn test_withdrawal_just_above_minimum() {
        // Leave exactly minimum_liquidity + 1 remaining
        let lp_supply = MINIMUM_LIQUIDITY + 500;
        let pool = make_pool(
            100_000 * PRECISION,
            100_000 * PRECISION,
            lp_supply,
            30,
        );
        let burn = 499; // leaves MINIMUM_LIQUIDITY + 1
        let est = estimate_withdrawal(burn, &pool).unwrap();
        assert!(!est.below_minimum,
            "Remaining {} should be >= minimum {}",
            lp_supply - burn, MINIMUM_LIQUIDITY);
    }

    #[test]
    fn test_withdrawal_just_below_minimum() {
        // Leave exactly minimum_liquidity - 1 remaining
        let lp_supply = MINIMUM_LIQUIDITY + 500;
        let pool = make_pool(
            100_000 * PRECISION,
            100_000 * PRECISION,
            lp_supply,
            30,
        );
        let burn = 501; // leaves MINIMUM_LIQUIDITY - 1
        let est = estimate_withdrawal(burn, &pool).unwrap();
        assert!(est.below_minimum,
            "Remaining {} should be < minimum {}",
            lp_supply - burn, MINIMUM_LIQUIDITY);
    }

    #[test]
    fn test_optimal_deposit_initial_tiny_amounts_insufficient() {
        // Initial deposit where sqrt(a0 * a1) <= MINIMUM_LIQUIDITY → InsufficientLiquidity
        let empty = make_pool(0, 0, 0, 30);
        // sqrt(100 * 1) = 10 which is < MINIMUM_LIQUIDITY (1000), so lp saturates to 0
        let err = optimal_deposit(100, 1, &empty).unwrap_err();
        assert_eq!(err, LiquidityError::InsufficientLiquidity);
    }

    #[test]
    fn test_optimal_deposit_initial_zero_token1() {
        // Initial deposit with zero token1 on empty pool should fail
        let empty = make_pool(0, 0, 0, 30);
        let err = optimal_deposit(1_000_000 * PRECISION, 0, &empty).unwrap_err();
        assert_eq!(err, LiquidityError::ZeroAmount);
    }

    #[test]
    fn test_optimal_deposit_matching_ratio_exactly() {
        // Deposit amounts that exactly match pool ratio — no leftovers
        let pool = imbalanced_pool(); // 500K:2M = 1:4
        let dep = optimal_deposit(
            5_000 * PRECISION,
            20_000 * PRECISION, // Exact 1:4 ratio
            &pool,
        ).unwrap();
        assert_eq!(dep.amount0, 5_000 * PRECISION);
        assert_eq!(dep.amount1, 20_000 * PRECISION);
        assert_eq!(dep.leftover0, 0);
        assert_eq!(dep.leftover1, 0);
        assert!(dep.expected_lp > 0);
    }

    #[test]
    fn test_zap_in_odd_amount_rounding() {
        // Odd-numbered input — verify swap + deposit = input
        let pool = balanced_pool();
        let amount = 999_999 * PRECISION + 1; // Odd number
        let zap = zap_in_estimate(amount, true, &pool).unwrap();
        assert_eq!(zap.swap_amount + zap.deposit_amount_in, amount,
            "Swap + deposit must equal total input");
    }

    #[test]
    fn test_zap_in_pool_with_zero_reserve0_only() {
        // Only reserve0 = 0 while reserve1 > 0 — should trigger EmptyPool
        let pool = make_pool(0, 1_000_000 * PRECISION, 1000, 30);
        let err = zap_in_estimate(10_000 * PRECISION, true, &pool).unwrap_err();
        assert_eq!(err, LiquidityError::EmptyPool);
    }

    #[test]
    fn test_zap_in_pool_with_zero_reserve1_only() {
        // Only reserve1 = 0 while reserve0 > 0 — should trigger EmptyPool
        let pool = make_pool(1_000_000 * PRECISION, 0, 1000, 30);
        let err = zap_in_estimate(10_000 * PRECISION, false, &pool).unwrap_err();
        assert_eq!(err, LiquidityError::EmptyPool);
    }

    #[test]
    fn test_zap_in_swap_output_less_than_spot() {
        // After fee and slippage, swap_output should be less than spot-price equivalent
        let pool = balanced_pool(); // 1:1
        let zap = zap_in_estimate(100_000 * PRECISION, true, &pool).unwrap();
        // At 1:1 spot, swapping 50K should yield less than 50K due to fees + price impact
        assert!(zap.swap_output < zap.swap_amount,
            "Swap output {} should be < swap amount {} due to fees + impact",
            zap.swap_output, zap.swap_amount);
    }

    #[test]
    fn test_pool_analytics_zero_prices() {
        // Both prices zero — TVL should be 0, but pool is not empty
        let pool = balanced_pool();
        let analytics = pool_analytics(&pool, 0, 0, 100_000 * PRECISION, 1000).unwrap();
        assert_eq!(analytics.tvl, 0);
        // depth is independent of price
        assert!(analytics.depth > 0);
        // fee_apr with zero tvl → 0
        assert_eq!(analytics.fee_apr_bps, 0);
    }

    #[test]
    fn test_pool_analytics_one_price_zero() {
        // Only one price is zero — TVL reflects only the priced token
        let pool = balanced_pool();
        let analytics = pool_analytics(&pool, PRECISION, 0, 0, 1000).unwrap();
        let expected_tvl = vibeswap_math::mul_div(pool.reserve0, PRECISION, PRECISION);
        assert_eq!(analytics.tvl, expected_tvl);
    }

    #[test]
    fn test_pool_analytics_very_large_epoch_blocks() {
        // Near-maximum epoch_blocks — annualized fee should be very small
        let pool = balanced_pool();
        let analytics = pool_analytics(
            &pool,
            PRECISION,
            PRECISION,
            100_000 * PRECISION,
            u64::MAX / 2, // Very large epoch
        ).unwrap();
        // Annualized fee = epoch_fees * blocks_per_year / epoch_blocks → near zero
        assert_eq!(analytics.fee_apr_bps, 0,
            "Very large epoch should yield near-zero annualized APR");
    }

    #[test]
    fn test_pool_analytics_single_block_epoch() {
        // Single block epoch — annualized fee should be very large
        let pool = balanced_pool();
        let analytics = pool_analytics(
            &pool,
            PRECISION,
            PRECISION,
            1_000_000 * PRECISION, // 1M volume in 1 block
            1, // 1 block
        ).unwrap();
        // fee = 1M * 30/10000 = 30K per block, annualized = 30K * 7.884M = huge
        assert!(analytics.fee_apr_bps > 10_000,
            "1-block epoch with high volume should yield very high APR: {}",
            analytics.fee_apr_bps);
    }

    #[test]
    fn test_spot_price_minimal_reserve0() {
        // reserve0 = 1 unit — maximum spot price without overflow
        let pool = make_pool(1, 1_000_000 * PRECISION, 1000, 30);
        let price = spot_price(&pool).unwrap();
        assert_eq!(price, vibeswap_math::mul_div(1_000_000 * PRECISION, PRECISION, 1));
    }

    #[test]
    fn test_k_invariant_one_reserve_zero() {
        // One reserve is zero — k should be 0
        let pool = make_pool(1_000_000 * PRECISION, 0, 1000, 30);
        let (hi, lo) = k_invariant(&pool);
        assert_eq!(hi, 0);
        assert_eq!(lo, 0);
    }

    #[test]
    fn test_k_invariant_single_unit_reserves() {
        // Smallest non-zero reserves: 1 * 1 = 1
        let pool = make_pool(1, 1, 1, 30);
        let (hi, lo) = k_invariant(&pool);
        assert_eq!(hi, 0);
        assert_eq!(lo, 1); // 1 * 1 = 1, fits in low bits
    }

    #[test]
    fn test_deposit_withdraw_roundtrip_imbalanced() {
        // Roundtrip on an imbalanced pool
        let pool = imbalanced_pool(); // 500K:2M
        let dep = optimal_deposit(
            1_000 * PRECISION,
            4_000 * PRECISION, // Match 1:4 ratio
            &pool,
        ).unwrap();

        let mut new_pool = pool.clone();
        new_pool.reserve0 += dep.amount0;
        new_pool.reserve1 += dep.amount1;
        new_pool.total_lp_supply += dep.expected_lp;

        let est = estimate_withdrawal(dep.expected_lp, &new_pool).unwrap();

        let diff0 = if est.amount0 > dep.amount0 { est.amount0 - dep.amount0 } else { dep.amount0 - est.amount0 };
        let diff1 = if est.amount1 > dep.amount1 { est.amount1 - dep.amount1 } else { dep.amount1 - est.amount1 };
        assert!(diff0 < dep.amount0 / 10_000, "Token0 roundtrip error too large: {}", diff0);
        assert!(diff1 < dep.amount1 / 10_000, "Token1 roundtrip error too large: {}", diff1);
    }

    #[test]
    fn test_zap_vs_direct_deposit_lp_comparison() {
        // Zapping should yield fewer LP tokens than a balanced deposit of the same total value
        // because zap incurs swap fees + price impact
        let pool = balanced_pool();
        let total = 10_000 * PRECISION;

        // Zap: all in token0
        let zap = zap_in_estimate(total, true, &pool).unwrap();

        // Direct balanced deposit: split evenly (since pool is 1:1)
        let dep = optimal_deposit(total / 2, total / 2, &pool).unwrap();

        assert!(dep.expected_lp > zap.expected_lp,
            "Direct deposit LP {} should exceed zap LP {} due to fees",
            dep.expected_lp, zap.expected_lp);
    }

    #[test]
    fn test_available_lp_zero_supply() {
        // Pool with 0 LP supply — available should be 0 (saturating_sub)
        let pool = make_pool(0, 0, 0, 30);
        assert_eq!(available_lp_to_burn(&pool), 0);
    }

    #[test]
    fn test_il_monotonically_increases_with_price_deviation() {
        // IL should increase as price deviates further from entry
        let initial = 100_000 * PRECISION;
        let il_2x = impermanent_loss(PRECISION, 2 * PRECISION, initial).unwrap();
        let il_4x = impermanent_loss(PRECISION, 4 * PRECISION, initial).unwrap();
        let il_10x = impermanent_loss(PRECISION, 10 * PRECISION, initial).unwrap();

        assert!(il_2x.il_bps < il_4x.il_bps,
            "IL should increase: 2x={} < 4x={}", il_2x.il_bps, il_4x.il_bps);
        assert!(il_4x.il_bps < il_10x.il_bps,
            "IL should increase: 4x={} < 10x={}", il_4x.il_bps, il_10x.il_bps);
    }

    #[test]
    fn test_pool_analytics_depth_is_geometric_mean() {
        // depth = sqrt(reserve0 * reserve1)
        let pool = balanced_pool();
        let analytics = pool_analytics(&pool, PRECISION, PRECISION, 0, 1000).unwrap();
        let expected_depth = vibeswap_math::sqrt_product(pool.reserve0, pool.reserve1);
        assert_eq!(analytics.depth, expected_depth);
    }

    #[test]
    fn test_pool_analytics_utilization_100_percent() {
        // Volume exactly equals TVL → utilization = 10000 bps (100%)
        let pool = balanced_pool(); // TVL = 2M at $1/$1
        let analytics = pool_analytics(
            &pool,
            PRECISION,
            PRECISION,
            2_000_000 * PRECISION, // Volume = TVL
            1000,
        ).unwrap();
        assert_eq!(analytics.utilization_bps, 10_000,
            "Volume = TVL should yield 100% utilization: {}", analytics.utilization_bps);
    }

    #[test]
    fn test_optimal_deposit_high_ratio_pool() {
        // Pool with extreme ratio 1:10000
        let pool = make_pool(
            1 * PRECISION,
            10_000 * PRECISION,
            100 * PRECISION,
            30,
        );
        let dep = optimal_deposit(
            1 * PRECISION,
            10_000 * PRECISION,
            &pool,
        ).unwrap();
        assert_eq!(dep.amount0, 1 * PRECISION);
        assert_eq!(dep.amount1, 10_000 * PRECISION);
        assert_eq!(dep.leftover0, 0);
        assert_eq!(dep.leftover1, 0);
        assert!(dep.expected_lp > 0);
    }

    #[test]
    fn test_zap_in_with_high_fee_rate() {
        // Pool with very high fee (5%) — swap output should be significantly lower
        let pool = make_pool(
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            500, // 5% fee
        );
        let zap = zap_in_estimate(10_000 * PRECISION, true, &pool).unwrap();

        // Compare with low-fee pool
        let low_fee = balanced_pool(); // 0.3% fee
        let zap_low = zap_in_estimate(10_000 * PRECISION, true, &low_fee).unwrap();

        // High fee should yield less swap output
        assert!(zap.swap_output < zap_low.swap_output,
            "High fee swap output {} should be < low fee {}",
            zap.swap_output, zap_low.swap_output);
    }

    #[test]
    fn test_zap_in_with_zero_fee_rate() {
        // Pool with 0% fee — swap output should be maximal (only price impact)
        let pool = make_pool(
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            0, // 0% fee
        );
        let zap = zap_in_estimate(10_000 * PRECISION, true, &pool).unwrap();
        assert!(zap.swap_output > 0);
        // With zero fee, output should be higher than with standard fee
        let std_fee = balanced_pool(); // 0.3% fee
        let zap_std = zap_in_estimate(10_000 * PRECISION, true, &std_fee).unwrap();
        assert!(zap.swap_output > zap_std.swap_output,
            "Zero fee output {} should exceed 0.3% fee output {}",
            zap.swap_output, zap_std.swap_output);
    }

    // ============ Batch 2: Additional Hardening Tests ============

    #[test]
    fn test_position_value_one_lp_token() {
        // Smallest meaningful LP position: 1 unit
        let pool = balanced_pool();
        let val = position_value(1, &pool, PRECISION, PRECISION).unwrap();
        // With 1M LP supply and 1M reserves, 1 LP = 1 of each token
        assert_eq!(val.amount0, 1);
        assert_eq!(val.amount1, 1);
        assert_eq!(val.pool_share_bps, 0); // 1/1M < 1 bps
    }

    #[test]
    fn test_position_value_zero_lp_yields_zero_values() {
        // 0 LP tokens should give zero values (not error)
        let pool = balanced_pool();
        let val = position_value(0, &pool, PRECISION, PRECISION).unwrap();
        assert_eq!(val.amount0, 0);
        assert_eq!(val.amount1, 0);
        assert_eq!(val.total_value, 0);
        assert_eq!(val.pool_share_bps, 0);
    }

    #[test]
    fn test_position_value_very_high_prices() {
        // Prices at 1M per token
        let pool = balanced_pool();
        let high_price = 1_000_000 * PRECISION;
        let val = position_value(
            pool.total_lp_supply / 10,
            &pool,
            high_price,
            high_price,
        ).unwrap();

        assert!(val.total_value > 0);
        assert_eq!(val.pool_share_bps, 1000); // 10%
    }

    #[test]
    fn test_impermanent_loss_at_entry_price_is_zero() {
        // When current_price == entry_price, IL should be 0
        let il = impermanent_loss(PRECISION, PRECISION, 100_000 * PRECISION).unwrap();
        assert_eq!(il.il_bps, 0, "No price change = no IL");
        assert_eq!(il.loss_amount, 0);
    }

    #[test]
    fn test_impermanent_loss_price_halved() {
        // Price halves (r = 0.5): IL ≈ 5.72%
        let il = impermanent_loss(PRECISION, PRECISION / 2, 100_000 * PRECISION).unwrap();
        assert!(il.il_bps > 0, "50% price drop should produce IL");
        assert!(il.il_bps < 1000, "IL for 50% drop should be < 10%");
        assert!(il.loss_amount > 0);
    }

    #[test]
    fn test_impermanent_loss_zero_entry_price() {
        let result = impermanent_loss(0, PRECISION, 100_000 * PRECISION);
        assert_eq!(result.unwrap_err(), LiquidityError::ZeroPrice);
    }

    #[test]
    fn test_impermanent_loss_zero_initial_value() {
        // Zero initial value — IL amounts should all be 0
        let il = impermanent_loss(PRECISION, 2 * PRECISION, 0).unwrap();
        assert_eq!(il.lp_value, 0);
        assert_eq!(il.hodl_value, 0);
        assert_eq!(il.loss_amount, 0);
        assert_eq!(il.il_bps, 0);
    }

    #[test]
    fn test_estimate_withdrawal_zero_amount() {
        let pool = balanced_pool();
        let result = estimate_withdrawal(0, &pool);
        assert_eq!(result.unwrap_err(), LiquidityError::ZeroAmount);
    }

    #[test]
    fn test_estimate_withdrawal_zero_lp_supply() {
        let mut pool = balanced_pool();
        pool.total_lp_supply = 0;
        let result = estimate_withdrawal(1000, &pool);
        assert_eq!(result.unwrap_err(), LiquidityError::ZeroLPSupply);
    }

    #[test]
    fn test_estimate_withdrawal_full_supply() {
        // Burning all LP should return all reserves
        let pool = balanced_pool();
        let est = estimate_withdrawal(pool.total_lp_supply, &pool).unwrap();
        assert_eq!(est.amount0, pool.reserve0);
        assert_eq!(est.amount1, pool.reserve1);
    }

    #[test]
    fn test_estimate_withdrawal_below_minimum() {
        // Burning enough to go below minimum_liquidity should flag below_minimum
        let pool = make_pool(10_000, 10_000, 2000, 30);
        let est = estimate_withdrawal(1500, &pool).unwrap();
        // remaining = 2000 - 1500 = 500 < MINIMUM_LIQUIDITY (1000)
        assert!(est.below_minimum, "500 remaining LP < MINIMUM_LIQUIDITY should flag below_minimum");
    }

    #[test]
    fn test_estimate_withdrawal_at_minimum() {
        // Remaining LP exactly equals minimum_liquidity → not below minimum
        let pool = make_pool(10_000, 10_000, 2000, 30);
        let est = estimate_withdrawal(1000, &pool).unwrap();
        // remaining = 2000 - 1000 = 1000 = MINIMUM_LIQUIDITY
        assert!(!est.below_minimum, "Exactly at minimum should not be below");
    }

    #[test]
    fn test_optimal_deposit_empty_pool_zero_amount_error() {
        let pool = make_pool(0, 0, 0, 30);
        let result = optimal_deposit(0, 100 * PRECISION, &pool);
        assert_eq!(result.unwrap_err(), LiquidityError::ZeroAmount);
    }

    #[test]
    fn test_optimal_deposit_existing_pool_matching_ratio() {
        // Deposit in exact pool ratio should use all tokens
        let pool = balanced_pool(); // 1:1
        let dep = optimal_deposit(1000 * PRECISION, 1000 * PRECISION, &pool).unwrap();
        assert_eq!(dep.amount0, 1000 * PRECISION);
        assert_eq!(dep.amount1, 1000 * PRECISION);
        assert_eq!(dep.leftover0, 0);
        assert_eq!(dep.leftover1, 0);
        assert!(dep.expected_lp > 0);
    }

    #[test]
    fn test_optimal_deposit_surplus_token0_leftover() {
        // More token0 than pool ratio requires — leftover0 > 0
        let pool = balanced_pool(); // 1:1
        let dep = optimal_deposit(2000 * PRECISION, 1000 * PRECISION, &pool).unwrap();
        // Pool is 1:1, so optimal is 1000:1000
        assert_eq!(dep.amount0, 1000 * PRECISION);
        assert_eq!(dep.amount1, 1000 * PRECISION);
        assert_eq!(dep.leftover0, 1000 * PRECISION);
        assert_eq!(dep.leftover1, 0);
    }

    #[test]
    fn test_zap_in_empty_pool_error() {
        let pool = make_pool(0, 0, 0, 30);
        let result = zap_in_estimate(1000 * PRECISION, true, &pool);
        assert_eq!(result.unwrap_err(), LiquidityError::EmptyPool);
    }

    #[test]
    fn test_zap_in_zero_amount_error() {
        let pool = balanced_pool();
        let result = zap_in_estimate(0, true, &pool);
        assert_eq!(result.unwrap_err(), LiquidityError::ZeroAmount);
    }

    #[test]
    fn test_zap_in_via_token1_side() {
        // Zap in with token1 (is_token0 = false)
        let pool = balanced_pool();
        let zap = zap_in_estimate(10_000 * PRECISION, false, &pool).unwrap();
        assert!(zap.swap_amount > 0);
        assert!(zap.swap_output > 0);
        assert!(zap.expected_lp > 0);
        assert_eq!(zap.swap_amount + zap.deposit_amount_in, 10_000 * PRECISION);
    }

    #[test]
    fn test_pool_analytics_empty_pool_error() {
        let pool = make_pool(0, 0, 0, 30);
        let result = pool_analytics(&pool, PRECISION, PRECISION, 0, 1000);
        assert_eq!(result.unwrap_err(), LiquidityError::EmptyPool);
    }

    #[test]
    fn test_pool_analytics_no_volume_zero_apr() {
        // No volume — fee_apr and utilization should be 0
        let pool = balanced_pool();
        let analytics = pool_analytics(&pool, PRECISION, PRECISION, 0, 1000).unwrap();
        assert_eq!(analytics.fee_apr_bps, 0);
        assert_eq!(analytics.utilization_bps, 0);
        assert!(analytics.tvl > 0);
    }

    #[test]
    fn test_spot_price_balanced_is_precision() {
        let pool = balanced_pool();
        let price = spot_price(&pool).unwrap();
        assert_eq!(price, PRECISION); // 1:1
    }

    #[test]
    fn test_spot_price_imbalanced_is_4x() {
        let pool = imbalanced_pool(); // 500K:2M → price = 2M/500K = 4
        let price = spot_price(&pool).unwrap();
        assert_eq!(price, 4 * PRECISION);
    }

    #[test]
    fn test_spot_price_zero_reserve0_error() {
        let pool = make_pool(0, 1000, 1000, 30);
        let result = spot_price(&pool);
        assert_eq!(result.unwrap_err(), LiquidityError::EmptyPool);
    }

    #[test]
    fn test_k_invariant_balanced() {
        let pool = balanced_pool();
        let (hi, lo) = k_invariant(&pool);
        // 1M*P * 1M*P is very large, hi should be > 0
        assert!(hi > 0 || lo > 0, "k should be non-zero for non-empty pool");
    }

    #[test]
    fn test_available_lp_to_burn_balanced() {
        let pool = balanced_pool();
        let available = available_lp_to_burn(&pool);
        assert_eq!(available, pool.total_lp_supply - MINIMUM_LIQUIDITY);
    }

    #[test]
    fn test_available_lp_to_burn_at_minimum() {
        // Pool with LP supply exactly at minimum → 0 available
        let pool = make_pool(1000, 1000, MINIMUM_LIQUIDITY, 30);
        assert_eq!(available_lp_to_burn(&pool), 0);
    }

    #[test]
    fn test_available_lp_below_minimum_is_zero() {
        // Pool with LP supply below minimum → 0 (saturating_sub)
        let pool = make_pool(1000, 1000, MINIMUM_LIQUIDITY - 1, 30);
        assert_eq!(available_lp_to_burn(&pool), 0);
    }

    #[test]
    fn test_liquidity_error_clone_debug_eq() {
        let e1 = LiquidityError::EmptyPool;
        let e2 = e1.clone();
        assert_eq!(e1, e2);
        assert_ne!(e1, LiquidityError::ZeroAmount);
        let _debug = format!("{:?}", e1);
    }

    #[test]
    fn test_position_value_clone_debug_eq() {
        let pool = balanced_pool();
        let val = position_value(1000, &pool, PRECISION, PRECISION).unwrap();
        let cloned = val.clone();
        assert_eq!(val, cloned);
        let _debug = format!("{:?}", val);
    }

    #[test]
    fn test_withdrawal_estimate_clone_debug_eq() {
        let pool = balanced_pool();
        let est = estimate_withdrawal(1000, &pool).unwrap();
        let cloned = est.clone();
        assert_eq!(est, cloned);
        let _debug = format!("{:?}", est);
    }

    #[test]
    fn test_optimal_deposit_clone_debug_eq() {
        let pool = balanced_pool();
        let dep = optimal_deposit(1000 * PRECISION, 1000 * PRECISION, &pool).unwrap();
        let cloned = dep.clone();
        assert_eq!(dep, cloned);
        let _debug = format!("{:?}", dep);
    }

    #[test]
    fn test_zap_estimate_clone_debug_eq() {
        let pool = balanced_pool();
        let zap = zap_in_estimate(10_000 * PRECISION, true, &pool).unwrap();
        let cloned = zap.clone();
        assert_eq!(zap, cloned);
        let _debug = format!("{:?}", zap);
    }

    #[test]
    fn test_pool_analytics_clone_debug_eq() {
        let pool = balanced_pool();
        let analytics = pool_analytics(&pool, PRECISION, PRECISION, 0, 1000).unwrap();
        let cloned = analytics.clone();
        assert_eq!(analytics, cloned);
        let _debug = format!("{:?}", analytics);
    }

    #[test]
    fn test_impermanent_loss_clone_debug_eq() {
        let il = impermanent_loss(PRECISION, 2 * PRECISION, 100_000 * PRECISION).unwrap();
        let cloned = il.clone();
        assert_eq!(il, cloned);
        let _debug = format!("{:?}", il);
    }
}
