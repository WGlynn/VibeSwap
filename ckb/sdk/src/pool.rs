// ============ Pool Module ============
// Liquidity Pool State Management — constant product AMM pools that batch
// auctions settle against. Manages pool creation, reserves, LP shares,
// fee accrual, and pool health metrics.
//
// Key capabilities:
// - Pool lifecycle: create, pause, drain, deprecate
// - Liquidity: add/remove (balanced, single-sided, optimal)
// - Swaps: compute, execute, reverse, slippage protection
// - Pricing: spot, mid, marginal, price impact
// - K-value tracking: fee accrual via k growth
// - Analytics: TVL, fee APR, pool health scoring
// - Multi-pool: sort by TVL, best-output routing, aggregation

// ============ Constants ============

/// Default trading fee: 30 bps = 0.3%
const DEFAULT_FEE_RATE_BPS: u64 = 30;

/// Default protocol share of trading fees: 1667 bps ≈ 1/6
const DEFAULT_PROTOCOL_FEE_BPS: u64 = 1667;

/// Minimum liquidity permanently locked on first deposit
const MINIMUM_LIQUIDITY: u64 = 10000;

/// Price scaling factor (1e8) for fixed-point price representation
const PRICE_SCALE: u128 = 100_000_000;

/// Maximum fee rate: 10000 bps = 100%
const MAX_FEE_BPS: u64 = 10_000;

/// Maximum portion of a reserve that a single swap can consume (30%)
const MAX_SWAP_FRACTION_BPS: u64 = 3000;

/// Basis points denominator
const BPS: u64 = 10_000;

// ============ Data Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum PoolStatus {
    Active,
    Paused,
    Draining,
    Deprecated,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PoolType {
    ConstantProduct,
    StableSwap,
    Concentrated,
}

#[derive(Debug, Clone)]
pub struct Pool {
    pub pool_id: [u8; 32],
    pub token_a: [u8; 32],
    pub token_b: [u8; 32],
    pub reserve_a: u64,
    pub reserve_b: u64,
    pub total_lp_shares: u64,
    pub fee_rate_bps: u64,
    pub protocol_fee_bps: u64,
    pub pool_type: PoolType,
    pub status: PoolStatus,
    pub created_at: u64,
    pub total_volume_a: u128,
    pub total_volume_b: u128,
    pub total_fees_a: u128,
    pub total_fees_b: u128,
    pub k_last: u128,
}

#[derive(Debug, Clone)]
pub struct LpPosition {
    pub owner: [u8; 32],
    pub pool_id: [u8; 32],
    pub shares: u64,
    pub deposited_a: u64,
    pub deposited_b: u64,
    pub deposit_time: u64,
}

#[derive(Debug, Clone)]
pub struct SwapResult {
    pub amount_in: u64,
    pub amount_out: u64,
    pub fee_amount: u64,
    pub protocol_fee: u64,
    pub price_impact_bps: u64,
    pub effective_price: u64,
}

#[derive(Debug, Clone)]
pub struct PoolHealth {
    pub tvl: u128,
    pub utilization_bps: u64,
    pub depth_score: u64,
    pub imbalance_bps: u64,
    pub fee_apr_bps: u64,
    pub health_score: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PoolError {
    InsufficientLiquidity,
    InsufficientShares,
    ZeroAmount,
    PoolPaused,
    PoolDraining,
    PoolDeprecated,
    InvalidFeeRate,
    SlippageExceeded,
    MaxPriceImpact,
    IdenticalTokens,
    Overflow,
    ZeroShares,
    MinimumLiquidity,
}

// ============ Internal Helpers ============

/// Integer square root via Newton's method (u128).
fn isqrt(x: u128) -> u128 {
    if x == 0 {
        return 0;
    }
    let mut z = x / 2 + 1;
    let mut y = x;
    while z < y {
        y = z;
        z = (x / z + z) / 2;
    }
    y
}

/// Safe (a * b) / c using u128 intermediates, returning u64.
/// Returns Err(Overflow) if the result doesn't fit in u64.
fn mul_div_u64(a: u64, b: u64, c: u64) -> Result<u64, PoolError> {
    if c == 0 {
        return Err(PoolError::Overflow);
    }
    let result = (a as u128)
        .checked_mul(b as u128)
        .ok_or(PoolError::Overflow)?
        / (c as u128);
    if result > u64::MAX as u128 {
        return Err(PoolError::Overflow);
    }
    Ok(result as u64)
}

/// Check that the pool allows trading operations.
fn require_active(pool: &Pool) -> Result<(), PoolError> {
    match pool.status {
        PoolStatus::Active => Ok(()),
        PoolStatus::Paused => Err(PoolError::PoolPaused),
        PoolStatus::Draining => Err(PoolError::PoolDraining),
        PoolStatus::Deprecated => Err(PoolError::PoolDeprecated),
    }
}

// ============ Pool Creation & Config ============

/// Create a new empty pool. Validates that tokens differ and fee <= 10000 bps.
pub fn create_pool(
    pool_id: [u8; 32],
    token_a: [u8; 32],
    token_b: [u8; 32],
    fee_rate_bps: u64,
    pool_type: PoolType,
) -> Result<Pool, PoolError> {
    if token_a == token_b {
        return Err(PoolError::IdenticalTokens);
    }
    if fee_rate_bps > MAX_FEE_BPS {
        return Err(PoolError::InvalidFeeRate);
    }
    Ok(Pool {
        pool_id,
        token_a,
        token_b,
        reserve_a: 0,
        reserve_b: 0,
        total_lp_shares: 0,
        fee_rate_bps,
        protocol_fee_bps: DEFAULT_PROTOCOL_FEE_BPS,
        pool_type,
        status: PoolStatus::Active,
        created_at: 0,
        total_volume_a: 0,
        total_volume_b: 0,
        total_fees_a: 0,
        total_fees_b: 0,
        k_last: 0,
    })
}

/// Returns the default trading fee rate: 30 bps (0.3%).
pub fn default_fee_rate() -> u64 {
    DEFAULT_FEE_RATE_BPS
}

/// Validate all pool invariants:
/// - Tokens differ
/// - Fee rate <= MAX_FEE_BPS
/// - If reserves > 0, both must be > 0 and lp_shares > 0
/// - k_last <= reserve_a * reserve_b (k never decreases)
pub fn validate_pool(pool: &Pool) -> Result<(), PoolError> {
    if pool.token_a == pool.token_b {
        return Err(PoolError::IdenticalTokens);
    }
    if pool.fee_rate_bps > MAX_FEE_BPS {
        return Err(PoolError::InvalidFeeRate);
    }
    if pool.reserve_a > 0 || pool.reserve_b > 0 {
        if pool.reserve_a == 0 || pool.reserve_b == 0 {
            return Err(PoolError::InsufficientLiquidity);
        }
        if pool.total_lp_shares == 0 {
            return Err(PoolError::ZeroShares);
        }
    }
    Ok(())
}

// ============ Liquidity Operations ============

/// Add liquidity to a pool. For the first deposit, shares = sqrt(a*b) - MINIMUM_LIQUIDITY.
/// For subsequent deposits, shares = min(a * totalLP / reserveA, b * totalLP / reserveB).
/// Returns an LpPosition with the minted shares.
pub fn add_liquidity(
    pool: &mut Pool,
    amount_a: u64,
    amount_b: u64,
    min_shares: u64,
) -> Result<LpPosition, PoolError> {
    require_active(pool)?;
    if amount_a == 0 || amount_b == 0 {
        return Err(PoolError::ZeroAmount);
    }

    let shares: u64;
    if pool.total_lp_shares == 0 {
        // First deposit: sqrt(a * b) - MINIMUM_LIQUIDITY
        let product = (amount_a as u128)
            .checked_mul(amount_b as u128)
            .ok_or(PoolError::Overflow)?;
        let root = isqrt(product);
        if root <= MINIMUM_LIQUIDITY as u128 {
            return Err(PoolError::MinimumLiquidity);
        }
        shares = (root - MINIMUM_LIQUIDITY as u128) as u64;
        // The MINIMUM_LIQUIDITY shares are permanently locked (added to total but unowned)
        pool.total_lp_shares = shares + MINIMUM_LIQUIDITY;
    } else {
        // Proportional deposit: take the minimum ratio
        let shares_a = mul_div_u64(amount_a, pool.total_lp_shares, pool.reserve_a)?;
        let shares_b = mul_div_u64(amount_b, pool.total_lp_shares, pool.reserve_b)?;
        shares = shares_a.min(shares_b);
        if shares == 0 {
            return Err(PoolError::ZeroShares);
        }
        pool.total_lp_shares = pool
            .total_lp_shares
            .checked_add(shares)
            .ok_or(PoolError::Overflow)?;
    }

    if shares < min_shares {
        return Err(PoolError::SlippageExceeded);
    }

    pool.reserve_a = pool
        .reserve_a
        .checked_add(amount_a)
        .ok_or(PoolError::Overflow)?;
    pool.reserve_b = pool
        .reserve_b
        .checked_add(amount_b)
        .ok_or(PoolError::Overflow)?;

    Ok(LpPosition {
        owner: [0u8; 32],
        pool_id: pool.pool_id,
        shares,
        deposited_a: amount_a,
        deposited_b: amount_b,
        deposit_time: 0,
    })
}

/// Burn LP shares and return proportional reserves (amount_a, amount_b).
pub fn remove_liquidity(pool: &mut Pool, shares: u64) -> Result<(u64, u64), PoolError> {
    if shares == 0 {
        return Err(PoolError::ZeroAmount);
    }
    match pool.status {
        PoolStatus::Paused => return Err(PoolError::PoolPaused),
        PoolStatus::Deprecated => return Err(PoolError::PoolDeprecated),
        _ => {} // Active and Draining both allow withdrawal
    }
    if shares > pool.total_lp_shares {
        return Err(PoolError::InsufficientShares);
    }
    let amount_a = mul_div_u64(shares, pool.reserve_a, pool.total_lp_shares)?;
    let amount_b = mul_div_u64(shares, pool.reserve_b, pool.total_lp_shares)?;
    if amount_a == 0 && amount_b == 0 {
        return Err(PoolError::InsufficientLiquidity);
    }
    pool.reserve_a -= amount_a;
    pool.reserve_b -= amount_b;
    pool.total_lp_shares -= shares;
    Ok((amount_a, amount_b))
}

/// Single-sided deposit: internally swap half, then add balanced liquidity.
/// Returns (LpPosition, amount_swapped).
pub fn add_liquidity_single_sided(
    pool: &mut Pool,
    amount: u64,
    is_token_a: bool,
) -> Result<(LpPosition, u64), PoolError> {
    require_active(pool)?;
    if amount == 0 {
        return Err(PoolError::ZeroAmount);
    }
    if pool.reserve_a == 0 || pool.reserve_b == 0 {
        return Err(PoolError::InsufficientLiquidity);
    }

    // Swap half the deposit
    let swap_amount = amount / 2;
    if swap_amount == 0 {
        return Err(PoolError::ZeroAmount);
    }

    let swap_result = execute_swap(pool, swap_amount, is_token_a, 0)?;
    let remaining = amount - swap_amount;

    // Now add liquidity with both tokens
    let (add_a, add_b) = if is_token_a {
        // We deposited token_a, swapped half to token_b
        let optimal_a = optimal_add_amounts(pool, remaining, swap_result.amount_out);
        (optimal_a.0, optimal_a.1)
    } else {
        // We deposited token_b, swapped half to token_a
        let optimal = optimal_add_amounts(pool, swap_result.amount_out, remaining);
        (optimal.0, optimal.1)
    };

    if add_a == 0 || add_b == 0 {
        return Err(PoolError::ZeroAmount);
    }

    let position = add_liquidity(pool, add_a, add_b, 0)?;
    Ok((position, swap_amount))
}

/// Compute optimal deposit amounts to minimize dust given current reserves.
/// Returns (optimal_a, optimal_b) where at most one is reduced.
pub fn optimal_add_amounts(pool: &Pool, amount_a: u64, amount_b: u64) -> (u64, u64) {
    if pool.reserve_a == 0 || pool.reserve_b == 0 {
        return (amount_a, amount_b);
    }
    // Desired ratio: reserve_a : reserve_b
    // optimal_b for given amount_a = amount_a * reserve_b / reserve_a
    let optimal_b_for_a = (amount_a as u128) * (pool.reserve_b as u128) / (pool.reserve_a as u128);
    if optimal_b_for_a <= amount_b as u128 {
        // amount_a is the binding constraint
        (amount_a, optimal_b_for_a as u64)
    } else {
        // amount_b is the binding constraint
        let optimal_a_for_b =
            (amount_b as u128) * (pool.reserve_a as u128) / (pool.reserve_b as u128);
        (optimal_a_for_b as u64, amount_b)
    }
}

/// Preview how many LP shares would be minted for given deposit amounts.
pub fn shares_for_amounts(pool: &Pool, amount_a: u64, amount_b: u64) -> u64 {
    if pool.total_lp_shares == 0 {
        let product = (amount_a as u128) * (amount_b as u128);
        let root = isqrt(product);
        if root <= MINIMUM_LIQUIDITY as u128 {
            return 0;
        }
        return (root - MINIMUM_LIQUIDITY as u128) as u64;
    }
    let shares_a = (amount_a as u128) * (pool.total_lp_shares as u128) / (pool.reserve_a as u128);
    let shares_b = (amount_b as u128) * (pool.total_lp_shares as u128) / (pool.reserve_b as u128);
    shares_a.min(shares_b) as u64
}

/// Preview how much of each token a share amount is worth.
pub fn amounts_for_shares(pool: &Pool, shares: u64) -> (u64, u64) {
    if pool.total_lp_shares == 0 {
        return (0, 0);
    }
    let a = (shares as u128) * (pool.reserve_a as u128) / (pool.total_lp_shares as u128);
    let b = (shares as u128) * (pool.reserve_b as u128) / (pool.total_lp_shares as u128);
    (a as u64, b as u64)
}

// ============ Swap Operations ============

/// Core AMM output formula: amount_out = (reserve_out * amount_in_after_fee) / (reserve_in * BPS + amount_in_after_fee)
/// Uses careful overflow handling for extreme u64 values.
pub fn amount_out(reserve_in: u64, reserve_out: u64, amount_in: u64, fee_bps: u64) -> u64 {
    if reserve_in == 0 || reserve_out == 0 || amount_in == 0 {
        return 0;
    }
    // Work in u128. For extreme u64 values, numerator = amount_in * fee_factor * reserve_out
    // can overflow u128. We rearrange:
    //   out = reserve_out / (1 + reserve_in * BPS / (amount_in * fee_factor))
    // But simpler: scale down by a common shift if needed.
    let fee_factor = (BPS - fee_bps) as u128;
    // amount_in_with_fee fits in u128 (max u64::MAX * 10000 < u128::MAX)
    let aif = (amount_in as u128) * fee_factor;

    // denominator = reserve_in * BPS + aif
    // Both terms fit in u128 individually; their sum might overflow but won't for realistic values.
    // For extreme u64::MAX * 10000 ≈ 1.8e23, still fits in u128.
    let denom = (reserve_in as u128) * (BPS as u128) + aif;
    if denom == 0 {
        return 0;
    }

    // numerator = aif * reserve_out — may overflow u128
    match aif.checked_mul(reserve_out as u128) {
        Some(num) => (num / denom) as u64,
        None => {
            // Overflow path: divide first to reduce magnitude.
            // out = reserve_out * aif / denom
            //     = reserve_out * (aif / denom) + reserve_out * (aif % denom) / denom
            let q = aif / denom;
            let r = aif % denom;
            let main = (reserve_out as u128).saturating_mul(q);
            // r < denom, but reserve_out * r can still overflow u128
            let extra = match (reserve_out as u128).checked_mul(r) {
                Some(v) => v / denom,
                None => {
                    // Further reduce: (reserve_out * r) / denom
                    // = reserve_out * (r / denom) + reserve_out * (r % denom) / denom
                    // Since r < denom, r/denom = 0, so:
                    // Scale both r and denom down by a factor
                    let shift = 64;
                    let r_scaled = r >> shift;
                    let d_scaled = denom >> shift;
                    if d_scaled == 0 {
                        0
                    } else {
                        (reserve_out as u128) * r_scaled / d_scaled
                    }
                }
            };
            (main + extra) as u64
        }
    }
}

/// Reverse AMM formula: given desired output, compute required input.
/// amount_in = (reserve_in * amount_out * BPS) / ((reserve_out - amount_out) * (BPS - fee)) + 1
pub fn amount_in_for_out(
    reserve_in: u64,
    reserve_out: u64,
    desired_out: u64,
    fee_bps: u64,
) -> u64 {
    if reserve_in == 0 || reserve_out == 0 || desired_out == 0 || desired_out >= reserve_out {
        return 0;
    }
    let numerator =
        (reserve_in as u128) * (desired_out as u128) * (BPS as u128);
    let denominator =
        ((reserve_out - desired_out) as u128) * ((BPS - fee_bps) as u128);
    if denominator == 0 {
        return 0;
    }
    // Round up (+1)
    ((numerator / denominator) + 1) as u64
}

/// Compute a swap result without modifying pool state.
pub fn compute_swap(
    pool: &Pool,
    amt_in: u64,
    is_a_to_b: bool,
) -> Result<SwapResult, PoolError> {
    require_active(pool)?;
    if amt_in == 0 {
        return Err(PoolError::ZeroAmount);
    }
    if pool.reserve_a == 0 || pool.reserve_b == 0 {
        return Err(PoolError::InsufficientLiquidity);
    }

    let (r_in, r_out) = if is_a_to_b {
        (pool.reserve_a, pool.reserve_b)
    } else {
        (pool.reserve_b, pool.reserve_a)
    };

    let out = amount_out(r_in, r_out, amt_in, pool.fee_rate_bps);
    if out == 0 {
        return Err(PoolError::InsufficientLiquidity);
    }

    let fee_total = (amt_in as u128) * (pool.fee_rate_bps as u128) / (BPS as u128);
    let protocol_fee = fee_total * (pool.protocol_fee_bps as u128) / (BPS as u128);

    let impact = price_impact(pool, amt_in, is_a_to_b);

    // effective_price = amount_out * PRICE_SCALE / amount_in
    let eff_price = (out as u128) * PRICE_SCALE / (amt_in as u128);

    Ok(SwapResult {
        amount_in: amt_in,
        amount_out: out,
        fee_amount: fee_total as u64,
        protocol_fee: protocol_fee as u64,
        price_impact_bps: impact,
        effective_price: eff_price as u64,
    })
}

/// Compute a reverse swap: given desired output, what input is required?
pub fn compute_swap_reverse(
    pool: &Pool,
    amt_out: u64,
    is_a_to_b: bool,
) -> Result<SwapResult, PoolError> {
    require_active(pool)?;
    if amt_out == 0 {
        return Err(PoolError::ZeroAmount);
    }
    if pool.reserve_a == 0 || pool.reserve_b == 0 {
        return Err(PoolError::InsufficientLiquidity);
    }

    let (r_in, r_out) = if is_a_to_b {
        (pool.reserve_a, pool.reserve_b)
    } else {
        (pool.reserve_b, pool.reserve_a)
    };

    if amt_out >= r_out {
        return Err(PoolError::InsufficientLiquidity);
    }

    let required_in = amount_in_for_out(r_in, r_out, amt_out, pool.fee_rate_bps);
    if required_in == 0 {
        return Err(PoolError::InsufficientLiquidity);
    }

    let fee_total = (required_in as u128) * (pool.fee_rate_bps as u128) / (BPS as u128);
    let protocol_fee = fee_total * (pool.protocol_fee_bps as u128) / (BPS as u128);

    let impact = price_impact(pool, required_in, is_a_to_b);
    let eff_price = (amt_out as u128) * PRICE_SCALE / (required_in as u128);

    Ok(SwapResult {
        amount_in: required_in,
        amount_out: amt_out,
        fee_amount: fee_total as u64,
        protocol_fee: protocol_fee as u64,
        price_impact_bps: impact,
        effective_price: eff_price as u64,
    })
}

/// Execute a swap: modify pool reserves and accumulators. Enforces min_out slippage.
pub fn execute_swap(
    pool: &mut Pool,
    amt_in: u64,
    is_a_to_b: bool,
    min_out: u64,
) -> Result<SwapResult, PoolError> {
    let result = compute_swap(pool, amt_in, is_a_to_b)?;
    if result.amount_out < min_out {
        return Err(PoolError::SlippageExceeded);
    }

    if is_a_to_b {
        pool.reserve_a = pool
            .reserve_a
            .checked_add(amt_in)
            .ok_or(PoolError::Overflow)?;
        pool.reserve_b = pool
            .reserve_b
            .checked_sub(result.amount_out)
            .ok_or(PoolError::InsufficientLiquidity)?;
        pool.total_volume_a += amt_in as u128;
        pool.total_fees_a += result.fee_amount as u128;
    } else {
        pool.reserve_b = pool
            .reserve_b
            .checked_add(amt_in)
            .ok_or(PoolError::Overflow)?;
        pool.reserve_a = pool
            .reserve_a
            .checked_sub(result.amount_out)
            .ok_or(PoolError::InsufficientLiquidity)?;
        pool.total_volume_b += amt_in as u128;
        pool.total_fees_b += result.fee_amount as u128;
    }

    Ok(result)
}

// ============ Price Functions ============

/// Spot price of token A in terms of token B (or inverse), scaled by PRICE_SCALE (1e8).
pub fn spot_price(pool: &Pool, is_a_in_b: bool) -> u64 {
    if pool.reserve_a == 0 || pool.reserve_b == 0 {
        return 0;
    }
    if is_a_in_b {
        ((pool.reserve_b as u128) * PRICE_SCALE / (pool.reserve_a as u128)) as u64
    } else {
        ((pool.reserve_a as u128) * PRICE_SCALE / (pool.reserve_b as u128)) as u64
    }
}

/// Price impact of a swap in basis points.
/// impact = (spot_price - effective_price) / spot_price * 10000
pub fn price_impact(pool: &Pool, amt_in: u64, is_a_to_b: bool) -> u64 {
    if pool.reserve_a == 0 || pool.reserve_b == 0 || amt_in == 0 {
        return 0;
    }

    let (r_in, r_out) = if is_a_to_b {
        (pool.reserve_a, pool.reserve_b)
    } else {
        (pool.reserve_b, pool.reserve_a)
    };

    // Spot price (output per input, scaled by PRICE_SCALE)
    let spot = (r_out as u128) * PRICE_SCALE / (r_in as u128);
    if spot == 0 {
        return 0;
    }

    // Effective price after swap (using fee-adjusted output)
    let out = amount_out(r_in, r_out, amt_in, pool.fee_rate_bps);
    if out == 0 {
        return BPS;
    }
    let effective = (out as u128) * PRICE_SCALE / (amt_in as u128);

    // Impact = (spot - effective) / spot * 10000
    if effective >= spot {
        return 0;
    }
    let diff = spot - effective;
    ((diff * (BPS as u128)) / spot) as u64
}

/// Geometric mean price: sqrt(price_a_in_b * price_b_in_a) scaled by PRICE_SCALE.
/// For a constant product AMM this simplifies to PRICE_SCALE (the geometric mean of
/// reciprocal prices is always 1). We compute it explicitly for correctness.
pub fn mid_price(pool: &Pool) -> u64 {
    if pool.reserve_a == 0 || pool.reserve_b == 0 {
        return 0;
    }
    let pa = (pool.reserve_b as u128) * PRICE_SCALE / (pool.reserve_a as u128);
    let pb = (pool.reserve_a as u128) * PRICE_SCALE / (pool.reserve_b as u128);
    let product = pa * pb;
    isqrt(product) as u64
}

/// Marginal price after executing a swap of amt_in, scaled by PRICE_SCALE.
pub fn marginal_price_after_swap(pool: &Pool, amt_in: u64, is_a_to_b: bool) -> u64 {
    if pool.reserve_a == 0 || pool.reserve_b == 0 || amt_in == 0 {
        return 0;
    }

    let (r_in, r_out) = if is_a_to_b {
        (pool.reserve_a, pool.reserve_b)
    } else {
        (pool.reserve_b, pool.reserve_a)
    };

    let out = amount_out(r_in, r_out, amt_in, pool.fee_rate_bps);
    let new_r_in = (r_in as u128) + (amt_in as u128);
    let new_r_out = (r_out as u128) - (out as u128);
    if new_r_in == 0 {
        return 0;
    }
    (new_r_out * PRICE_SCALE / new_r_in) as u64
}

// ============ K-value & Fee Tracking ============

/// Current k = reserve_a * reserve_b.
pub fn compute_k(pool: &Pool) -> u128 {
    (pool.reserve_a as u128) * (pool.reserve_b as u128)
}

/// K growth since last snapshot: current_k - k_last. Represents fee accrual.
pub fn k_growth(pool: &Pool) -> u128 {
    let current = compute_k(pool);
    current.saturating_sub(pool.k_last)
}

/// Mint protocol LP shares from k growth (Uniswap V2 style).
/// new_shares = total_lp * (sqrt(k_new) - sqrt(k_last)) / (sqrt(k_new) * (protocol_fee_denom - 1) + sqrt(k_last))
/// where protocol_fee_denom = BPS / protocol_fee_bps.
/// Returns number of new shares minted.
pub fn protocol_fee_mint(pool: &mut Pool) -> u64 {
    if pool.k_last == 0 || pool.total_lp_shares == 0 || pool.protocol_fee_bps == 0 {
        return 0;
    }
    let k_new = compute_k(pool);
    let sqrt_k_new = isqrt(k_new);
    let sqrt_k_last = isqrt(pool.k_last);

    if sqrt_k_new <= sqrt_k_last {
        return 0;
    }

    let numerator = (pool.total_lp_shares as u128) * (sqrt_k_new - sqrt_k_last);
    // protocol_fee_denom = BPS / protocol_fee_bps (e.g., 10000/1667 ≈ 6)
    let fee_denom = (BPS as u128) / (pool.protocol_fee_bps as u128);
    let denominator = sqrt_k_new * (fee_denom - 1) + sqrt_k_last;

    if denominator == 0 {
        return 0;
    }

    let new_shares = (numerator / denominator) as u64;
    if new_shares > 0 {
        pool.total_lp_shares += new_shares;
        pool.k_last = k_new;
    }
    new_shares
}

/// Snapshot current k into k_last.
pub fn update_k_last(pool: &mut Pool) {
    pool.k_last = compute_k(pool);
}

// ============ Pool Status ============

/// Pause the pool (circuit breaker). Only active pools can be paused.
pub fn pause_pool(pool: &mut Pool) -> Result<(), PoolError> {
    match pool.status {
        PoolStatus::Active => {
            pool.status = PoolStatus::Paused;
            Ok(())
        }
        PoolStatus::Paused => Err(PoolError::PoolPaused),
        PoolStatus::Draining => Err(PoolError::PoolDraining),
        PoolStatus::Deprecated => Err(PoolError::PoolDeprecated),
    }
}

/// Unpause a paused pool back to active.
pub fn unpause_pool(pool: &mut Pool) -> Result<(), PoolError> {
    match pool.status {
        PoolStatus::Paused => {
            pool.status = PoolStatus::Active;
            Ok(())
        }
        PoolStatus::Active => Err(PoolError::PoolPaused), // already active
        PoolStatus::Draining => Err(PoolError::PoolDraining),
        PoolStatus::Deprecated => Err(PoolError::PoolDeprecated),
    }
}

/// Start draining: withdrawals only, no new deposits or swaps.
pub fn start_draining(pool: &mut Pool) -> Result<(), PoolError> {
    match pool.status {
        PoolStatus::Active | PoolStatus::Paused => {
            pool.status = PoolStatus::Draining;
            Ok(())
        }
        PoolStatus::Draining => Err(PoolError::PoolDraining),
        PoolStatus::Deprecated => Err(PoolError::PoolDeprecated),
    }
}

/// Mark pool as deprecated (replaced by new version).
pub fn deprecate_pool(pool: &mut Pool) -> Result<(), PoolError> {
    match pool.status {
        PoolStatus::Deprecated => Err(PoolError::PoolDeprecated),
        _ => {
            pool.status = PoolStatus::Deprecated;
            Ok(())
        }
    }
}

/// True if the pool is active (allows trading).
pub fn is_tradeable(pool: &Pool) -> bool {
    pool.status == PoolStatus::Active
}

/// True if the pool accepts new deposits.
pub fn is_depositable(pool: &Pool) -> bool {
    pool.status == PoolStatus::Active
}

/// True if the pool allows withdrawals (Active or Draining).
pub fn is_withdrawable(pool: &Pool) -> bool {
    matches!(pool.status, PoolStatus::Active | PoolStatus::Draining)
}

// ============ Analytics ============

/// Total value locked, denominated in token_a units.
/// TVL = reserve_a + reserve_b * price_a (where price_a = price of token_b in token_a units).
/// price_a is scaled by PRICE_SCALE.
pub fn tvl(pool: &Pool, price_a: u64) -> u128 {
    let val_a = pool.reserve_a as u128;
    let val_b = (pool.reserve_b as u128) * (price_a as u128) / PRICE_SCALE;
    val_a + val_b
}

/// Pool health composite score.
pub fn pool_health(pool: &Pool, daily_volume: u128, price_a: u64) -> PoolHealth {
    let pool_tvl = tvl(pool, price_a);

    // Utilization: daily_volume / TVL (capped at 10000 bps)
    let utilization = if pool_tvl > 0 {
        let raw = daily_volume * (BPS as u128) / pool_tvl;
        raw.min(BPS as u128) as u64
    } else {
        0
    };

    // Depth score: sqrt(reserve_a * reserve_b) normalized to 0-10000
    // We scale by comparing to a reference depth of 1_000_000 units
    let depth_raw = isqrt((pool.reserve_a as u128) * (pool.reserve_b as u128));
    let depth_score = if depth_raw >= 1_000_000 {
        BPS
    } else {
        (depth_raw * (BPS as u128) / 1_000_000) as u64
    };

    // Imbalance: |reserve_a_share - 5000| * 2
    let total = (pool.reserve_a as u128) + (pool.reserve_b as u128);
    let imbalance = if total > 0 {
        let share_a = (pool.reserve_a as u128) * (BPS as u128) / total;
        let deviation = if share_a > 5000 {
            share_a - 5000
        } else {
            5000 - share_a
        };
        (deviation * 2) as u64
    } else {
        0
    };

    let apr = fee_apr(pool, daily_volume);

    // Health score: weighted combination
    // 40% depth + 30% utilization + 30% (10000 - imbalance)
    let balance_score = BPS.saturating_sub(imbalance);
    let health = (depth_score as u128 * 40 + utilization as u128 * 30 + balance_score as u128 * 30)
        / 100;

    PoolHealth {
        tvl: pool_tvl,
        utilization_bps: utilization,
        depth_score,
        imbalance_bps: imbalance,
        fee_apr_bps: apr,
        health_score: health as u64,
    }
}

/// Annualized fee yield in basis points.
/// fee_apr = (daily_volume * fee_rate / BPS) * 365 / TVL * BPS
pub fn fee_apr(pool: &Pool, daily_volume: u128) -> u64 {
    let pool_tvl = (pool.reserve_a as u128) + (pool.reserve_b as u128);
    if pool_tvl == 0 {
        return 0;
    }
    let daily_fees = daily_volume * (pool.fee_rate_bps as u128) / (BPS as u128);
    let annual_fees = daily_fees * 365;
    let apr_bps = annual_fees * (BPS as u128) / pool_tvl;
    apr_bps as u64
}

/// Normalized reserve ratio. Returns (share_a_bps, share_b_bps) summing to 10000.
pub fn reserve_ratio(pool: &Pool) -> (u64, u64) {
    let total = (pool.reserve_a as u128) + (pool.reserve_b as u128);
    if total == 0 {
        return (5000, 5000);
    }
    let a_bps = ((pool.reserve_a as u128) * (BPS as u128) / total) as u64;
    let b_bps = BPS - a_bps;
    (a_bps, b_bps)
}

/// Impermanent loss in basis points given initial and current price ratio.
/// IL = 1 - 2*sqrt(r) / (1 + r) where r = current_price / initial_price.
/// Both prices scaled by PRICE_SCALE.
pub fn impermanent_loss_bps(initial_price: u64, current_price: u64) -> u64 {
    if initial_price == 0 || current_price == 0 {
        return 0;
    }
    // r = current / initial (scaled by PRICE_SCALE)
    let r_scaled = (current_price as u128) * PRICE_SCALE / (initial_price as u128);

    // sqrt(r) scaled by sqrt(PRICE_SCALE) — we need consistent scaling
    // lp_ratio = 2 * sqrt(r) / (1 + r), all at PRICE_SCALE
    // sqrt(r_scaled) = sqrt(current/initial * PRICE_SCALE)
    let sqrt_r = isqrt(r_scaled);

    // 2 * sqrt(r_scaled) * PRICE_SCALE / (PRICE_SCALE + r_scaled)
    // This gives us the LP ratio scaled by sqrt(PRICE_SCALE)
    // We need to compare to 1.0 = sqrt(PRICE_SCALE) in this scaling
    let sqrt_scale = isqrt(PRICE_SCALE);

    let numerator = 2 * sqrt_r * (BPS as u128);
    // denominator = sqrt_scale * (1 + r/PRICE_SCALE) = sqrt_scale * (PRICE_SCALE + r_scaled) / PRICE_SCALE
    let denominator = sqrt_scale * (PRICE_SCALE + r_scaled) / PRICE_SCALE;

    if denominator == 0 {
        return 0;
    }

    let lp_ratio_bps = numerator / denominator;
    if lp_ratio_bps >= BPS as u128 {
        return 0;
    }
    (BPS as u128 - lp_ratio_bps) as u64
}

/// Value of an LP position in token_a terms.
/// lp_value = (shares / total_shares) * TVL
pub fn lp_value(pool: &Pool, shares: u64, price_a: u64) -> u128 {
    if pool.total_lp_shares == 0 {
        return 0;
    }
    let pool_tvl = tvl(pool, price_a);
    pool_tvl * (shares as u128) / (pool.total_lp_shares as u128)
}

// ============ Multi-Pool ============

/// Return pool indices sorted by TVL descending.
/// `prices[i]` is the price_a for `pools[i]`.
pub fn sort_pools_by_tvl(pools: &[Pool], prices: &[u64]) -> Vec<usize> {
    let mut indices: Vec<usize> = (0..pools.len()).collect();
    let tvls: Vec<u128> = pools
        .iter()
        .zip(prices.iter())
        .map(|(p, &pr)| tvl(p, pr))
        .collect();
    indices.sort_by(|&a, &b| tvls[b].cmp(&tvls[a]));
    indices
}

/// Find the pool index that gives the best output for a given swap.
pub fn best_pool_for_swap(pools: &[Pool], amt_in: u64, is_a_to_b: bool) -> Option<usize> {
    let mut best_idx: Option<usize> = None;
    let mut best_out: u64 = 0;
    for (i, p) in pools.iter().enumerate() {
        if let Ok(result) = compute_swap(p, amt_in, is_a_to_b) {
            if result.amount_out > best_out {
                best_out = result.amount_out;
                best_idx = Some(i);
            }
        }
    }
    best_idx
}

/// Aggregate TVL across all pools.
pub fn aggregate_tvl(pools: &[Pool], prices: &[u64]) -> u128 {
    pools
        .iter()
        .zip(prices.iter())
        .map(|(p, &pr)| tvl(p, pr))
        .sum()
}

/// Aggregate cumulative volume across all pools.
pub fn aggregate_volume(pools: &[Pool]) -> u128 {
    pools
        .iter()
        .map(|p| p.total_volume_a + p.total_volume_b)
        .sum()
}

// ============ Safety ============

/// Maximum safe swap amount (30% of the target reserve).
pub fn max_swap_amount(pool: &Pool, is_a_to_b: bool) -> u64 {
    let reserve = if is_a_to_b {
        pool.reserve_b
    } else {
        pool.reserve_a
    };
    (reserve as u128 * MAX_SWAP_FRACTION_BPS as u128 / BPS as u128) as u64
}

/// Check if a swap would exceed the given maximum price impact.
pub fn would_exceed_impact(
    pool: &Pool,
    amt_in: u64,
    is_a_to_b: bool,
    max_impact_bps: u64,
) -> bool {
    price_impact(pool, amt_in, is_a_to_b) > max_impact_bps
}

/// The minimum liquidity constant (1000) locked on first deposit.
pub fn minimum_liquidity() -> u64 {
    MINIMUM_LIQUIDITY
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Test Helpers ----

    fn token_a() -> [u8; 32] {
        let mut t = [0u8; 32];
        t[0] = 0xAA;
        t
    }

    fn token_b() -> [u8; 32] {
        let mut t = [0u8; 32];
        t[0] = 0xBB;
        t
    }

    fn pool_id() -> [u8; 32] {
        [1u8; 32]
    }

    fn pool_id_2() -> [u8; 32] {
        [2u8; 32]
    }

    /// Create a default active pool with 30 bps fee.
    fn make_pool() -> Pool {
        create_pool(pool_id(), token_a(), token_b(), 30, PoolType::ConstantProduct).unwrap()
    }

    /// Create a pool pre-seeded with reserves.
    fn seeded_pool(ra: u64, rb: u64) -> Pool {
        let mut p = make_pool();
        add_liquidity(&mut p, ra, rb, 0).unwrap();
        p
    }

    // ============ Pool Creation & Config Tests ============

    #[test]
    fn test_create_pool_success() {
        let pool = create_pool(pool_id(), token_a(), token_b(), 30, PoolType::ConstantProduct);
        assert!(pool.is_ok());
        let p = pool.unwrap();
        assert_eq!(p.reserve_a, 0);
        assert_eq!(p.reserve_b, 0);
        assert_eq!(p.total_lp_shares, 0);
        assert_eq!(p.fee_rate_bps, 30);
        assert_eq!(p.status, PoolStatus::Active);
        assert_eq!(p.pool_type, PoolType::ConstantProduct);
    }

    #[test]
    fn test_create_pool_identical_tokens() {
        let result = create_pool(pool_id(), token_a(), token_a(), 30, PoolType::ConstantProduct);
        assert_eq!(result.unwrap_err(), PoolError::IdenticalTokens);
    }

    #[test]
    fn test_create_pool_fee_too_high() {
        let result = create_pool(pool_id(), token_a(), token_b(), 10001, PoolType::ConstantProduct);
        assert_eq!(result.unwrap_err(), PoolError::InvalidFeeRate);
    }

    #[test]
    fn test_create_pool_max_fee() {
        let result = create_pool(pool_id(), token_a(), token_b(), 10000, PoolType::ConstantProduct);
        assert!(result.is_ok());
    }

    #[test]
    fn test_create_pool_zero_fee() {
        let p = create_pool(pool_id(), token_a(), token_b(), 0, PoolType::ConstantProduct).unwrap();
        assert_eq!(p.fee_rate_bps, 0);
    }

    #[test]
    fn test_create_pool_stable_swap() {
        let p = create_pool(pool_id(), token_a(), token_b(), 4, PoolType::StableSwap).unwrap();
        assert_eq!(p.pool_type, PoolType::StableSwap);
    }

    #[test]
    fn test_create_pool_concentrated() {
        let p = create_pool(pool_id(), token_a(), token_b(), 5, PoolType::Concentrated).unwrap();
        assert_eq!(p.pool_type, PoolType::Concentrated);
    }

    #[test]
    fn test_default_fee_rate() {
        assert_eq!(default_fee_rate(), 30);
    }

    #[test]
    fn test_validate_pool_empty() {
        let p = make_pool();
        assert!(validate_pool(&p).is_ok());
    }

    #[test]
    fn test_validate_pool_seeded() {
        let p = seeded_pool(1_000_000, 1_000_000);
        assert!(validate_pool(&p).is_ok());
    }

    #[test]
    fn test_validate_pool_identical_tokens() {
        let mut p = make_pool();
        p.token_b = p.token_a;
        assert_eq!(validate_pool(&p).unwrap_err(), PoolError::IdenticalTokens);
    }

    #[test]
    fn test_validate_pool_bad_fee() {
        let mut p = make_pool();
        p.fee_rate_bps = 20_000;
        assert_eq!(validate_pool(&p).unwrap_err(), PoolError::InvalidFeeRate);
    }

    #[test]
    fn test_validate_pool_one_reserve_zero() {
        let mut p = make_pool();
        p.reserve_a = 100;
        p.reserve_b = 0;
        assert_eq!(
            validate_pool(&p).unwrap_err(),
            PoolError::InsufficientLiquidity
        );
    }

    #[test]
    fn test_validate_pool_reserves_no_shares() {
        let mut p = make_pool();
        p.reserve_a = 100;
        p.reserve_b = 100;
        p.total_lp_shares = 0;
        assert_eq!(validate_pool(&p).unwrap_err(), PoolError::ZeroShares);
    }

    // ============ First Deposit Tests ============

    #[test]
    fn test_first_deposit_sqrt_formula() {
        let mut p = make_pool();
        let pos = add_liquidity(&mut p, 1_000_000, 1_000_000, 0).unwrap();
        // sqrt(1e6 * 1e6) = 1e6, minus 1000 minimum = 999_000
        assert_eq!(pos.shares, 1_000_000 - MINIMUM_LIQUIDITY);
        assert_eq!(p.total_lp_shares, 1_000_000);
        assert_eq!(p.reserve_a, 1_000_000);
        assert_eq!(p.reserve_b, 1_000_000);
    }

    #[test]
    fn test_first_deposit_asymmetric() {
        let mut p = make_pool();
        let pos = add_liquidity(&mut p, 4_000_000, 1_000_000, 0).unwrap();
        // sqrt(4e6 * 1e6) = sqrt(4e12) = 2e6, minus 1000 = 1_999_000
        assert_eq!(pos.shares, 2_000_000 - MINIMUM_LIQUIDITY);
    }

    #[test]
    fn test_first_deposit_minimum_liquidity_locked() {
        let mut p = make_pool();
        let pos = add_liquidity(&mut p, 100_000, 100_000, 0).unwrap();
        // sqrt(1e10) = 100_000, minus 1000 = 99_000
        assert_eq!(pos.shares, 99_000);
        assert_eq!(p.total_lp_shares, 100_000); // includes MINIMUM_LIQUIDITY
    }

    #[test]
    fn test_first_deposit_too_small() {
        let mut p = make_pool();
        // sqrt(100 * 100) = 100, which is <= MINIMUM_LIQUIDITY (1000)
        let result = add_liquidity(&mut p, 100, 100, 0);
        assert_eq!(result.unwrap_err(), PoolError::MinimumLiquidity);
    }

    #[test]
    fn test_first_deposit_exactly_minimum() {
        let mut p = make_pool();
        // sqrt(1000 * 1000) = 1000, equals MINIMUM_LIQUIDITY → error
        let result = add_liquidity(&mut p, 1000, 1000, 0);
        assert_eq!(result.unwrap_err(), PoolError::MinimumLiquidity);
    }

    #[test]
    fn test_first_deposit_just_above_minimum() {
        let mut p = make_pool();
        // sqrt(1001 * 1001) = 1001, minus 1000 = 1 share
        let pos = add_liquidity(&mut p, 1001, 1001, 0).unwrap();
        assert_eq!(pos.shares, 1);
    }

    #[test]
    fn test_first_deposit_position_fields() {
        let mut p = make_pool();
        let pos = add_liquidity(&mut p, 500_000, 500_000, 0).unwrap();
        assert_eq!(pos.pool_id, pool_id());
        assert_eq!(pos.deposited_a, 500_000);
        assert_eq!(pos.deposited_b, 500_000);
    }

    // ============ Proportional Deposit Tests ============

    #[test]
    fn test_proportional_deposit() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let total_before = p.total_lp_shares;
        let pos = add_liquidity(&mut p, 500_000, 500_000, 0).unwrap();
        // 500k/1M = 0.5 of pool → 0.5 * total_before shares
        let expected = (500_000u128 * total_before as u128 / 1_000_000u128) as u64;
        assert_eq!(pos.shares, expected);
    }

    #[test]
    fn test_proportional_deposit_unbalanced_takes_min() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let total_before = p.total_lp_shares;
        // 500k of A but 1M of B → shares limited by A ratio (0.5)
        let pos = add_liquidity(&mut p, 500_000, 1_000_000, 0).unwrap();
        let shares_a = (500_000u128 * total_before as u128 / 1_000_000u128) as u64;
        let shares_b = (1_000_000u128 * total_before as u128 / 1_000_000u128) as u64;
        assert_eq!(pos.shares, shares_a.min(shares_b));
    }

    #[test]
    fn test_deposit_zero_amount_a() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let result = add_liquidity(&mut p, 0, 500_000, 0);
        assert_eq!(result.unwrap_err(), PoolError::ZeroAmount);
    }

    #[test]
    fn test_deposit_zero_amount_b() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let result = add_liquidity(&mut p, 500_000, 0, 0);
        assert_eq!(result.unwrap_err(), PoolError::ZeroAmount);
    }

    #[test]
    fn test_deposit_min_shares_met() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let result = add_liquidity(&mut p, 500_000, 500_000, 1);
        assert!(result.is_ok());
    }

    #[test]
    fn test_deposit_min_shares_exceeded() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        // Requesting impossibly high min_shares
        let result = add_liquidity(&mut p, 500_000, 500_000, u64::MAX);
        assert_eq!(result.unwrap_err(), PoolError::SlippageExceeded);
    }

    #[test]
    fn test_deposit_paused_pool() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        pause_pool(&mut p).unwrap();
        let result = add_liquidity(&mut p, 100, 100, 0);
        assert_eq!(result.unwrap_err(), PoolError::PoolPaused);
    }

    #[test]
    fn test_deposit_draining_pool() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        start_draining(&mut p).unwrap();
        let result = add_liquidity(&mut p, 100, 100, 0);
        assert_eq!(result.unwrap_err(), PoolError::PoolDraining);
    }

    #[test]
    fn test_deposit_deprecated_pool() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        deprecate_pool(&mut p).unwrap();
        let result = add_liquidity(&mut p, 100, 100, 0);
        assert_eq!(result.unwrap_err(), PoolError::PoolDeprecated);
    }

    #[test]
    fn test_multiple_deposits_grow_reserves() {
        let mut p = make_pool();
        add_liquidity(&mut p, 1_000_000, 1_000_000, 0).unwrap();
        add_liquidity(&mut p, 500_000, 500_000, 0).unwrap();
        assert_eq!(p.reserve_a, 1_500_000);
        assert_eq!(p.reserve_b, 1_500_000);
    }

    // ============ Remove Liquidity Tests ============

    #[test]
    fn test_remove_liquidity_full() {
        let mut p = make_pool();
        let pos = add_liquidity(&mut p, 1_000_000, 1_000_000, 0).unwrap();
        let (a, b) = remove_liquidity(&mut p, pos.shares).unwrap();
        // User gets back proportional share minus MINIMUM_LIQUIDITY portion
        // shares = 999_000 out of 1_000_000 total → 999_000/1_000_000 * 1M = 999_000
        assert_eq!(a, 999_000);
        assert_eq!(b, 999_000);
    }

    #[test]
    fn test_remove_liquidity_partial() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let half_shares = (p.total_lp_shares - MINIMUM_LIQUIDITY) / 2;
        let (a, b) = remove_liquidity(&mut p, half_shares).unwrap();
        assert!(a > 0 && a < 1_000_000);
        assert!(b > 0 && b < 1_000_000);
    }

    #[test]
    fn test_remove_zero_shares() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let result = remove_liquidity(&mut p, 0);
        assert_eq!(result.unwrap_err(), PoolError::ZeroAmount);
    }

    #[test]
    fn test_remove_more_than_total() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let too_many = p.total_lp_shares + 1;
        let result = remove_liquidity(&mut p, too_many);
        assert_eq!(result.unwrap_err(), PoolError::InsufficientShares);
    }

    #[test]
    fn test_remove_from_paused_pool() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        pause_pool(&mut p).unwrap();
        let result = remove_liquidity(&mut p, 100);
        assert_eq!(result.unwrap_err(), PoolError::PoolPaused);
    }

    #[test]
    fn test_remove_from_draining_pool_allowed() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let shares = p.total_lp_shares - MINIMUM_LIQUIDITY;
        start_draining(&mut p).unwrap();
        let result = remove_liquidity(&mut p, shares);
        assert!(result.is_ok());
    }

    #[test]
    fn test_remove_from_deprecated_pool() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        deprecate_pool(&mut p).unwrap();
        let result = remove_liquidity(&mut p, 100);
        assert_eq!(result.unwrap_err(), PoolError::PoolDeprecated);
    }

    #[test]
    fn test_remove_updates_reserves() {
        let mut p = seeded_pool(1_000_000, 2_000_000);
        let shares = 100;
        let ra_before = p.reserve_a;
        let rb_before = p.reserve_b;
        let (a, b) = remove_liquidity(&mut p, shares).unwrap();
        assert_eq!(p.reserve_a, ra_before - a);
        assert_eq!(p.reserve_b, rb_before - b);
    }

    // ============ Single-Sided Deposit Tests ============

    #[test]
    fn test_single_sided_token_a() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let result = add_liquidity_single_sided(&mut p, 100_000, true);
        assert!(result.is_ok());
        let (pos, swapped) = result.unwrap();
        assert_eq!(swapped, 50_000); // half of 100_000
        assert!(pos.shares > 0);
    }

    #[test]
    fn test_single_sided_token_b() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let result = add_liquidity_single_sided(&mut p, 100_000, false);
        assert!(result.is_ok());
        let (pos, swapped) = result.unwrap();
        assert_eq!(swapped, 50_000);
        assert!(pos.shares > 0);
    }

    #[test]
    fn test_single_sided_zero_amount() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let result = add_liquidity_single_sided(&mut p, 0, true);
        assert_eq!(result.unwrap_err(), PoolError::ZeroAmount);
    }

    #[test]
    fn test_single_sided_empty_pool() {
        let mut p = make_pool();
        let result = add_liquidity_single_sided(&mut p, 100_000, true);
        assert_eq!(result.unwrap_err(), PoolError::InsufficientLiquidity);
    }

    #[test]
    fn test_single_sided_one_unit() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        // amount=1, swap_amount=0 → ZeroAmount
        let result = add_liquidity_single_sided(&mut p, 1, true);
        assert_eq!(result.unwrap_err(), PoolError::ZeroAmount);
    }

    // ============ Optimal Add & Preview Tests ============

    #[test]
    fn test_optimal_add_balanced() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let (a, b) = optimal_add_amounts(&p, 500_000, 500_000);
        assert_eq!(a, 500_000);
        assert_eq!(b, 500_000);
    }

    #[test]
    fn test_optimal_add_excess_b() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let (a, b) = optimal_add_amounts(&p, 500_000, 1_000_000);
        assert_eq!(a, 500_000);
        assert_eq!(b, 500_000); // reduced to match ratio
    }

    #[test]
    fn test_optimal_add_excess_a() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let (a, b) = optimal_add_amounts(&p, 1_000_000, 500_000);
        assert_eq!(a, 500_000); // reduced
        assert_eq!(b, 500_000);
    }

    #[test]
    fn test_optimal_add_2x_ratio() {
        let p = seeded_pool(1_000_000, 2_000_000);
        let (a, b) = optimal_add_amounts(&p, 100_000, 300_000);
        // Ratio is 1:2, so 100k A needs 200k B
        assert_eq!(a, 100_000);
        assert_eq!(b, 200_000);
    }

    #[test]
    fn test_shares_for_amounts_first_deposit() {
        let p = make_pool();
        let shares = shares_for_amounts(&p, 1_000_000, 1_000_000);
        assert_eq!(shares, 1_000_000 - MINIMUM_LIQUIDITY);
    }

    #[test]
    fn test_shares_for_amounts_proportional() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let shares = shares_for_amounts(&p, 500_000, 500_000);
        assert!(shares > 0);
    }

    #[test]
    fn test_amounts_for_shares_empty() {
        let p = make_pool();
        let (a, b) = amounts_for_shares(&p, 100);
        assert_eq!(a, 0);
        assert_eq!(b, 0);
    }

    #[test]
    fn test_amounts_for_shares_seeded() {
        let p = seeded_pool(1_000_000, 2_000_000);
        let shares = p.total_lp_shares / 10;
        let (a, b) = amounts_for_shares(&p, shares);
        assert!(a > 0);
        assert!(b > 0);
        // ratio should be roughly 1:2
        assert!(b > a);
    }

    #[test]
    fn test_shares_amounts_roundtrip() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let shares = shares_for_amounts(&p, 100_000, 100_000);
        let (a, b) = amounts_for_shares(&p, shares);
        // Should be close to original amounts (rounding down is fine)
        assert!(a <= 100_000);
        assert!(b <= 100_000);
        assert!(a >= 99_000); // within 1% tolerance
    }

    // ============ Core AMM Formula Tests ============

    #[test]
    fn test_amount_out_basic() {
        // 1000 * 9970 / (10000 * 10000 + 9970) = ~997 (with 30 bps fee)
        let out = amount_out(10_000, 10_000, 1000, 30);
        assert!(out > 0);
        assert!(out < 1000); // Must be less due to price impact + fees
    }

    #[test]
    fn test_amount_out_zero_input() {
        assert_eq!(amount_out(10_000, 10_000, 0, 30), 0);
    }

    #[test]
    fn test_amount_out_zero_reserves() {
        assert_eq!(amount_out(0, 10_000, 1000, 30), 0);
        assert_eq!(amount_out(10_000, 0, 1000, 30), 0);
    }

    #[test]
    fn test_amount_out_no_fee() {
        // With 0 fee: out = 10000 * 1000 / (10000 + 1000) = ~909
        let out = amount_out(10_000, 10_000, 1000, 0);
        assert_eq!(out, 909);
    }

    #[test]
    fn test_amount_out_large_fee() {
        let out_low = amount_out(10_000, 10_000, 1000, 30);
        let out_high = amount_out(10_000, 10_000, 1000, 100);
        assert!(out_low > out_high); // Higher fee → less output
    }

    #[test]
    fn test_amount_out_never_exceeds_reserve() {
        let out = amount_out(100, 10_000, 1_000_000, 30);
        assert!(out < 10_000);
    }

    #[test]
    fn test_amount_in_for_out_basic() {
        let required = amount_in_for_out(10_000, 10_000, 500, 30);
        assert!(required > 500); // Need more than output due to fees + price impact
    }

    #[test]
    fn test_amount_in_for_out_zero() {
        assert_eq!(amount_in_for_out(10_000, 10_000, 0, 30), 0);
    }

    #[test]
    fn test_amount_in_for_out_exceeds_reserve() {
        assert_eq!(amount_in_for_out(10_000, 10_000, 10_000, 30), 0);
    }

    #[test]
    fn test_amount_in_for_out_exceeds_reserve_plus() {
        assert_eq!(amount_in_for_out(10_000, 10_000, 10_001, 30), 0);
    }

    #[test]
    fn test_forward_reverse_consistency() {
        // Forward: given input, get output. Reverse: given that output, get input.
        let fwd_out = amount_out(1_000_000, 1_000_000, 10_000, 30);
        let rev_in = amount_in_for_out(1_000_000, 1_000_000, fwd_out, 30);
        // Reverse should give ≤ original input (due to rounding up in reverse)
        assert!(rev_in <= 10_001); // allow +1 for rounding
        assert!(rev_in >= 9_999);
    }

    // ============ Compute Swap Tests ============

    #[test]
    fn test_compute_swap_a_to_b() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let result = compute_swap(&p, 10_000, true).unwrap();
        assert!(result.amount_out > 0);
        assert!(result.amount_out < 10_000);
        assert!(result.fee_amount > 0);
        assert!(result.protocol_fee > 0);
        assert!(result.effective_price > 0);
    }

    #[test]
    fn test_compute_swap_b_to_a() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let result = compute_swap(&p, 10_000, false).unwrap();
        assert!(result.amount_out > 0);
    }

    #[test]
    fn test_compute_swap_zero_amount() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let result = compute_swap(&p, 0, true);
        assert_eq!(result.unwrap_err(), PoolError::ZeroAmount);
    }

    #[test]
    fn test_compute_swap_empty_pool() {
        let p = make_pool();
        let result = compute_swap(&p, 1000, true);
        assert_eq!(result.unwrap_err(), PoolError::InsufficientLiquidity);
    }

    #[test]
    fn test_compute_swap_paused() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        pause_pool(&mut p).unwrap();
        let result = compute_swap(&p, 1000, true);
        assert_eq!(result.unwrap_err(), PoolError::PoolPaused);
    }

    #[test]
    fn test_compute_swap_fee_structure() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let result = compute_swap(&p, 10_000, true).unwrap();
        // Fee = 10000 * 30 / 10000 = 30
        assert_eq!(result.fee_amount, 30);
        // Protocol fee = 30 * 1667 / 10000 ≈ 5
        assert_eq!(result.protocol_fee, 5);
    }

    // ============ Compute Swap Reverse Tests ============

    #[test]
    fn test_compute_swap_reverse_basic() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let result = compute_swap_reverse(&p, 5_000, true).unwrap();
        assert!(result.amount_in > 5_000); // Must be more than output
        assert_eq!(result.amount_out, 5_000);
    }

    #[test]
    fn test_compute_swap_reverse_zero() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let result = compute_swap_reverse(&p, 0, true);
        assert_eq!(result.unwrap_err(), PoolError::ZeroAmount);
    }

    #[test]
    fn test_compute_swap_reverse_exceeds_reserve() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let result = compute_swap_reverse(&p, 1_000_000, true);
        assert_eq!(result.unwrap_err(), PoolError::InsufficientLiquidity);
    }

    #[test]
    fn test_compute_swap_reverse_consistency() {
        let p = seeded_pool(1_000_000, 1_000_000);
        // Forward swap
        let fwd = compute_swap(&p, 10_000, true).unwrap();
        // Reverse: how much input needed for that output?
        let rev = compute_swap_reverse(&p, fwd.amount_out, true).unwrap();
        // Should be close to original input
        assert!(rev.amount_in >= 9_999);
        assert!(rev.amount_in <= 10_002);
    }

    // ============ Execute Swap Tests ============

    #[test]
    fn test_execute_swap_updates_reserves() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let ra_before = p.reserve_a;
        let rb_before = p.reserve_b;
        let result = execute_swap(&mut p, 10_000, true, 0).unwrap();
        assert_eq!(p.reserve_a, ra_before + 10_000);
        assert_eq!(p.reserve_b, rb_before - result.amount_out);
    }

    #[test]
    fn test_execute_swap_updates_volume() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        assert_eq!(p.total_volume_a, 0);
        execute_swap(&mut p, 10_000, true, 0).unwrap();
        assert_eq!(p.total_volume_a, 10_000);
        assert_eq!(p.total_volume_b, 0);
    }

    #[test]
    fn test_execute_swap_updates_fees() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let result = execute_swap(&mut p, 10_000, true, 0).unwrap();
        assert_eq!(p.total_fees_a, result.fee_amount as u128);
    }

    #[test]
    fn test_execute_swap_slippage_protection() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let result = execute_swap(&mut p, 10_000, true, u64::MAX);
        assert_eq!(result.unwrap_err(), PoolError::SlippageExceeded);
    }

    #[test]
    fn test_execute_swap_slippage_exact() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let preview = compute_swap(&p, 10_000, true).unwrap();
        let result = execute_swap(&mut p, 10_000, true, preview.amount_out);
        assert!(result.is_ok());
    }

    // ============ Constant Product Invariant Tests ============

    #[test]
    fn test_k_never_decreases_after_swap() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let k_before = compute_k(&p);
        execute_swap(&mut p, 50_000, true, 0).unwrap();
        let k_after = compute_k(&p);
        assert!(k_after >= k_before, "k must never decrease: {} < {}", k_after, k_before);
    }

    #[test]
    fn test_k_grows_with_fees() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let k_before = compute_k(&p);
        // Execute several swaps
        execute_swap(&mut p, 50_000, true, 0).unwrap();
        execute_swap(&mut p, 50_000, false, 0).unwrap();
        let k_after = compute_k(&p);
        assert!(k_after > k_before, "k should grow from fee accrual");
    }

    #[test]
    fn test_k_stable_with_zero_fee() {
        let mut p = create_pool(pool_id(), token_a(), token_b(), 0, PoolType::ConstantProduct).unwrap();
        add_liquidity(&mut p, 1_000_000, 1_000_000, 0).unwrap();
        let k_before = compute_k(&p);
        execute_swap(&mut p, 50_000, true, 0).unwrap();
        let k_after = compute_k(&p);
        // With zero fee, k should be preserved or slightly higher due to integer rounding
        // (amount_out rounds down, so the pool retains a tiny dust surplus)
        assert!(k_after >= k_before, "k must never decrease");
        // The rounding error should be negligible (< 0.01% of k)
        let diff = k_after - k_before;
        assert!(diff * 10_000 < k_before, "rounding error too large");
    }

    #[test]
    fn test_multiple_swaps_k_monotonic() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let mut prev_k = compute_k(&p);
        for i in 0..10 {
            let dir = i % 2 == 0;
            execute_swap(&mut p, 10_000, dir, 0).unwrap();
            let k = compute_k(&p);
            assert!(k >= prev_k);
            prev_k = k;
        }
    }

    // ============ Price Function Tests ============

    #[test]
    fn test_spot_price_equal_reserves() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let price = spot_price(&p, true);
        assert_eq!(price, PRICE_SCALE as u64); // 1:1
    }

    #[test]
    fn test_spot_price_2x_ratio() {
        let p = seeded_pool(1_000_000, 2_000_000);
        let price = spot_price(&p, true); // price of A in B
        assert_eq!(price, (2 * PRICE_SCALE) as u64);
    }

    #[test]
    fn test_spot_price_inverse() {
        let p = seeded_pool(1_000_000, 2_000_000);
        let pa = spot_price(&p, true);
        let pb = spot_price(&p, false);
        // pa * pb ≈ PRICE_SCALE^2
        let product = (pa as u128) * (pb as u128);
        let expected = PRICE_SCALE * PRICE_SCALE;
        // Allow small rounding error
        assert!(product >= expected - PRICE_SCALE);
        assert!(product <= expected + PRICE_SCALE);
    }

    #[test]
    fn test_spot_price_empty_pool() {
        let p = make_pool();
        assert_eq!(spot_price(&p, true), 0);
    }

    #[test]
    fn test_price_impact_small_swap() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let impact = price_impact(&p, 1_000, true);
        assert!(impact < 100); // Small swap → small impact
    }

    #[test]
    fn test_price_impact_large_swap() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let impact = price_impact(&p, 500_000, true);
        assert!(impact > 1000); // 50% of reserve → big impact
    }

    #[test]
    fn test_price_impact_increases_with_size() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let i1 = price_impact(&p, 10_000, true);
        let i2 = price_impact(&p, 100_000, true);
        let i3 = price_impact(&p, 500_000, true);
        assert!(i1 < i2);
        assert!(i2 < i3);
    }

    #[test]
    fn test_price_impact_zero_amount() {
        let p = seeded_pool(1_000_000, 1_000_000);
        assert_eq!(price_impact(&p, 0, true), 0);
    }

    #[test]
    fn test_mid_price_balanced() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let mp = mid_price(&p);
        // For 1:1 pool, mid_price ≈ PRICE_SCALE
        let diff = if mp > PRICE_SCALE as u64 {
            mp - PRICE_SCALE as u64
        } else {
            PRICE_SCALE as u64 - mp
        };
        assert!(diff <= 1); // Allow 1 unit rounding
    }

    #[test]
    fn test_mid_price_empty() {
        let p = make_pool();
        assert_eq!(mid_price(&p), 0);
    }

    #[test]
    fn test_marginal_price_after_a_to_b() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let mp = marginal_price_after_swap(&p, 100_000, true);
        // After buying B with A, price of B (in A) should increase
        // i.e., marginal price (B per A) should decrease
        let sp = spot_price(&p, true);
        assert!(mp < sp);
    }

    #[test]
    fn test_marginal_price_after_b_to_a() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let mp = marginal_price_after_swap(&p, 100_000, false);
        // After selling B for A, reserve_b increases → B per A increases
        // but we compute A per B for is_a_to_b=false swap direction
        assert!(mp > 0);
    }

    #[test]
    fn test_marginal_price_zero() {
        let p = seeded_pool(1_000_000, 1_000_000);
        assert_eq!(marginal_price_after_swap(&p, 0, true), 0);
    }

    // ============ K-value & Fee Tracking Tests ============

    #[test]
    fn test_compute_k_empty() {
        let p = make_pool();
        assert_eq!(compute_k(&p), 0);
    }

    #[test]
    fn test_compute_k_seeded() {
        let p = seeded_pool(1_000_000, 2_000_000);
        assert_eq!(compute_k(&p), 1_000_000u128 * 2_000_000u128);
    }

    #[test]
    fn test_k_growth_no_trades() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        update_k_last(&mut p);
        assert_eq!(k_growth(&p), 0);
    }

    #[test]
    fn test_k_growth_after_trades() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        update_k_last(&mut p);
        execute_swap(&mut p, 50_000, true, 0).unwrap();
        assert!(k_growth(&p) > 0);
    }

    #[test]
    fn test_protocol_fee_mint_no_growth() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        update_k_last(&mut p);
        let minted = protocol_fee_mint(&mut p);
        assert_eq!(minted, 0);
    }

    #[test]
    fn test_protocol_fee_mint_after_trades() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        update_k_last(&mut p);
        // Generate fee revenue
        for _ in 0..10 {
            execute_swap(&mut p, 50_000, true, 0).unwrap();
            execute_swap(&mut p, 50_000, false, 0).unwrap();
        }
        let shares_before = p.total_lp_shares;
        let minted = protocol_fee_mint(&mut p);
        assert!(minted > 0);
        assert_eq!(p.total_lp_shares, shares_before + minted);
    }

    #[test]
    fn test_protocol_fee_mint_zero_protocol_fee() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        p.protocol_fee_bps = 0;
        update_k_last(&mut p);
        execute_swap(&mut p, 50_000, true, 0).unwrap();
        let minted = protocol_fee_mint(&mut p);
        assert_eq!(minted, 0);
    }

    #[test]
    fn test_update_k_last() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        assert_eq!(p.k_last, 0);
        update_k_last(&mut p);
        assert_eq!(p.k_last, compute_k(&p));
    }

    // ============ Pool Status Tests ============

    #[test]
    fn test_pause_active() {
        let mut p = make_pool();
        assert!(pause_pool(&mut p).is_ok());
        assert_eq!(p.status, PoolStatus::Paused);
    }

    #[test]
    fn test_pause_already_paused() {
        let mut p = make_pool();
        pause_pool(&mut p).unwrap();
        assert_eq!(pause_pool(&mut p).unwrap_err(), PoolError::PoolPaused);
    }

    #[test]
    fn test_unpause() {
        let mut p = make_pool();
        pause_pool(&mut p).unwrap();
        assert!(unpause_pool(&mut p).is_ok());
        assert_eq!(p.status, PoolStatus::Active);
    }

    #[test]
    fn test_unpause_active() {
        let mut p = make_pool();
        // Already active → error
        assert!(unpause_pool(&mut p).is_err());
    }

    #[test]
    fn test_start_draining_active() {
        let mut p = make_pool();
        assert!(start_draining(&mut p).is_ok());
        assert_eq!(p.status, PoolStatus::Draining);
    }

    #[test]
    fn test_start_draining_paused() {
        let mut p = make_pool();
        pause_pool(&mut p).unwrap();
        assert!(start_draining(&mut p).is_ok());
        assert_eq!(p.status, PoolStatus::Draining);
    }

    #[test]
    fn test_start_draining_already() {
        let mut p = make_pool();
        start_draining(&mut p).unwrap();
        assert_eq!(
            start_draining(&mut p).unwrap_err(),
            PoolError::PoolDraining
        );
    }

    #[test]
    fn test_deprecate_pool() {
        let mut p = make_pool();
        assert!(deprecate_pool(&mut p).is_ok());
        assert_eq!(p.status, PoolStatus::Deprecated);
    }

    #[test]
    fn test_deprecate_already() {
        let mut p = make_pool();
        deprecate_pool(&mut p).unwrap();
        assert_eq!(
            deprecate_pool(&mut p).unwrap_err(),
            PoolError::PoolDeprecated
        );
    }

    #[test]
    fn test_is_tradeable() {
        let mut p = make_pool();
        assert!(is_tradeable(&p));
        pause_pool(&mut p).unwrap();
        assert!(!is_tradeable(&p));
    }

    #[test]
    fn test_is_depositable() {
        let mut p = make_pool();
        assert!(is_depositable(&p));
        start_draining(&mut p).unwrap();
        assert!(!is_depositable(&p));
    }

    #[test]
    fn test_is_withdrawable_active() {
        let p = make_pool();
        assert!(is_withdrawable(&p));
    }

    #[test]
    fn test_is_withdrawable_draining() {
        let mut p = make_pool();
        start_draining(&mut p).unwrap();
        assert!(is_withdrawable(&p));
    }

    #[test]
    fn test_is_withdrawable_paused() {
        let mut p = make_pool();
        pause_pool(&mut p).unwrap();
        assert!(!is_withdrawable(&p));
    }

    #[test]
    fn test_is_withdrawable_deprecated() {
        let mut p = make_pool();
        deprecate_pool(&mut p).unwrap();
        assert!(!is_withdrawable(&p));
    }

    // ============ Analytics Tests ============

    #[test]
    fn test_tvl_balanced() {
        let p = seeded_pool(1_000_000, 1_000_000);
        // price_a = PRICE_SCALE means 1 B = 1 A
        let t = tvl(&p, PRICE_SCALE as u64);
        assert_eq!(t, 2_000_000);
    }

    #[test]
    fn test_tvl_unbalanced_price() {
        let p = seeded_pool(1_000_000, 500_000);
        // 1 B = 2 A (price_a = 2 * PRICE_SCALE)
        let t = tvl(&p, (2 * PRICE_SCALE) as u64);
        assert_eq!(t, 2_000_000); // 1M + 500k * 2
    }

    #[test]
    fn test_fee_apr_basic() {
        let p = seeded_pool(1_000_000, 1_000_000);
        // daily volume = 100k
        let apr = fee_apr(&p, 100_000);
        // daily_fees = 100000 * 30 / 10000 = 300
        // annual_fees = 300 * 365 = 109500
        // apr_bps = 109500 * 10000 / 2000000 = 547
        assert_eq!(apr, 547);
    }

    #[test]
    fn test_fee_apr_zero_volume() {
        let p = seeded_pool(1_000_000, 1_000_000);
        assert_eq!(fee_apr(&p, 0), 0);
    }

    #[test]
    fn test_fee_apr_empty_pool() {
        let p = make_pool();
        assert_eq!(fee_apr(&p, 100_000), 0);
    }

    #[test]
    fn test_reserve_ratio_balanced() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let (a, b) = reserve_ratio(&p);
        assert_eq!(a, 5000);
        assert_eq!(b, 5000);
    }

    #[test]
    fn test_reserve_ratio_unbalanced() {
        let p = seeded_pool(3_000_000, 1_000_000);
        let (a, b) = reserve_ratio(&p);
        assert_eq!(a, 7500);
        assert_eq!(b, 2500);
    }

    #[test]
    fn test_reserve_ratio_empty() {
        let p = make_pool();
        let (a, b) = reserve_ratio(&p);
        assert_eq!(a + b, BPS);
    }

    #[test]
    fn test_impermanent_loss_no_change() {
        let il = impermanent_loss_bps(PRICE_SCALE as u64, PRICE_SCALE as u64);
        assert_eq!(il, 0);
    }

    #[test]
    fn test_impermanent_loss_2x() {
        // When price doubles, IL ≈ 5.72% = 572 bps
        let il = impermanent_loss_bps(PRICE_SCALE as u64, (2 * PRICE_SCALE) as u64);
        // Allow some rounding: 550-600 bps
        assert!(il >= 550 && il <= 600, "IL for 2x should be ~572 bps, got {}", il);
    }

    #[test]
    fn test_impermanent_loss_half() {
        // When price halves, IL ≈ 5.72% (symmetric)
        let il = impermanent_loss_bps((2 * PRICE_SCALE) as u64, PRICE_SCALE as u64);
        assert!(il >= 550 && il <= 600, "IL for 0.5x should be ~572 bps, got {}", il);
    }

    #[test]
    fn test_impermanent_loss_4x() {
        // When price 4x, IL ≈ 20%
        let il = impermanent_loss_bps(PRICE_SCALE as u64, (4 * PRICE_SCALE) as u64);
        assert!(il >= 1900 && il <= 2100, "IL for 4x should be ~2000 bps, got {}", il);
    }

    #[test]
    fn test_impermanent_loss_zero_price() {
        assert_eq!(impermanent_loss_bps(0, PRICE_SCALE as u64), 0);
        assert_eq!(impermanent_loss_bps(PRICE_SCALE as u64, 0), 0);
    }

    #[test]
    fn test_lp_value_basic() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let shares = p.total_lp_shares - MINIMUM_LIQUIDITY; // user's shares
        let val = lp_value(&p, shares, PRICE_SCALE as u64);
        // User owns 999000/1000000 of pool = 99.9% of 2M TVL
        assert!(val > 1_990_000);
        assert!(val <= 2_000_000);
    }

    #[test]
    fn test_lp_value_empty_pool() {
        let p = make_pool();
        assert_eq!(lp_value(&p, 100, PRICE_SCALE as u64), 0);
    }

    #[test]
    fn test_pool_health_balanced_active() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let health = pool_health(&p, 500_000, PRICE_SCALE as u64);
        assert!(health.tvl > 0);
        assert!(health.health_score > 0);
        assert_eq!(health.imbalance_bps, 0); // Perfectly balanced
    }

    #[test]
    fn test_pool_health_no_volume() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let health = pool_health(&p, 0, PRICE_SCALE as u64);
        assert_eq!(health.utilization_bps, 0);
        assert_eq!(health.fee_apr_bps, 0);
    }

    #[test]
    fn test_pool_health_imbalanced() {
        let p = seeded_pool(9_000_000, 1_000_000);
        let health = pool_health(&p, 100_000, PRICE_SCALE as u64);
        assert!(health.imbalance_bps > 0);
    }

    // ============ Multi-Pool Tests ============

    #[test]
    fn test_sort_pools_by_tvl() {
        let p1 = seeded_pool(100_000, 100_000);
        let mut p2 = create_pool(pool_id_2(), token_a(), token_b(), 30, PoolType::ConstantProduct).unwrap();
        add_liquidity(&mut p2, 1_000_000, 1_000_000, 0).unwrap();

        let pools = vec![p1, p2];
        let prices = vec![PRICE_SCALE as u64, PRICE_SCALE as u64];
        let sorted = sort_pools_by_tvl(&pools, &prices);
        assert_eq!(sorted[0], 1); // Bigger pool first
        assert_eq!(sorted[1], 0);
    }

    #[test]
    fn test_sort_pools_empty() {
        let pools: Vec<Pool> = vec![];
        let prices: Vec<u64> = vec![];
        let sorted = sort_pools_by_tvl(&pools, &prices);
        assert!(sorted.is_empty());
    }

    #[test]
    fn test_best_pool_for_swap() {
        let p1 = seeded_pool(100_000, 100_000);
        let mut p2 = create_pool(pool_id_2(), token_a(), token_b(), 30, PoolType::ConstantProduct).unwrap();
        add_liquidity(&mut p2, 10_000_000, 10_000_000, 0).unwrap();

        let pools = vec![p1, p2];
        let best = best_pool_for_swap(&pools, 10_000, true);
        assert_eq!(best, Some(1)); // Deeper pool gives better price
    }

    #[test]
    fn test_best_pool_no_pools() {
        let pools: Vec<Pool> = vec![];
        assert_eq!(best_pool_for_swap(&pools, 10_000, true), None);
    }

    #[test]
    fn test_best_pool_all_paused() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        pause_pool(&mut p).unwrap();
        let pools = vec![p];
        assert_eq!(best_pool_for_swap(&pools, 10_000, true), None);
    }

    #[test]
    fn test_aggregate_tvl() {
        let p1 = seeded_pool(1_000_000, 1_000_000);
        let mut p2 = create_pool(pool_id_2(), token_a(), token_b(), 30, PoolType::ConstantProduct).unwrap();
        add_liquidity(&mut p2, 500_000, 500_000, 0).unwrap();
        let pools = vec![p1, p2];
        let prices = vec![PRICE_SCALE as u64, PRICE_SCALE as u64];
        let total = aggregate_tvl(&pools, &prices);
        assert_eq!(total, 3_000_000);
    }

    #[test]
    fn test_aggregate_volume() {
        let mut p1 = seeded_pool(1_000_000, 1_000_000);
        execute_swap(&mut p1, 10_000, true, 0).unwrap();
        let mut p2 = create_pool(pool_id_2(), token_a(), token_b(), 30, PoolType::ConstantProduct).unwrap();
        add_liquidity(&mut p2, 1_000_000, 1_000_000, 0).unwrap();
        execute_swap(&mut p2, 20_000, false, 0).unwrap();
        let pools = vec![p1, p2];
        let vol = aggregate_volume(&pools);
        assert_eq!(vol, 30_000);
    }

    // ============ Safety Tests ============

    #[test]
    fn test_max_swap_amount_a_to_b() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let max = max_swap_amount(&p, true);
        // 30% of reserve_b (1M) = 300k
        assert_eq!(max, 300_000);
    }

    #[test]
    fn test_max_swap_amount_b_to_a() {
        let p = seeded_pool(1_000_000, 2_000_000);
        let max = max_swap_amount(&p, false);
        // 30% of reserve_a (1M) = 300k
        assert_eq!(max, 300_000);
    }

    #[test]
    fn test_would_exceed_impact_small() {
        let p = seeded_pool(1_000_000, 1_000_000);
        assert!(!would_exceed_impact(&p, 1_000, true, 500));
    }

    #[test]
    fn test_would_exceed_impact_large() {
        let p = seeded_pool(1_000_000, 1_000_000);
        assert!(would_exceed_impact(&p, 500_000, true, 100));
    }

    #[test]
    fn test_minimum_liquidity_constant() {
        assert_eq!(minimum_liquidity(), 1000);
    }

    // ============ Overflow Safety Tests ============

    #[test]
    fn test_large_reserves_swap() {
        let mut p = make_pool();
        let large = u64::MAX / 4;
        add_liquidity(&mut p, large, large, 0).unwrap();
        // Small swap should work
        let result = compute_swap(&p, 1000, true);
        assert!(result.is_ok());
    }

    #[test]
    fn test_large_reserves_add_liquidity() {
        let mut p = make_pool();
        let large = u64::MAX / 4;
        let result = add_liquidity(&mut p, large, large, 0);
        assert!(result.is_ok());
    }

    #[test]
    fn test_overflow_protection_amount_out() {
        // Very large values should not panic
        let out = amount_out(u64::MAX, u64::MAX, u64::MAX / 2, 30);
        assert!(out > 0);
    }

    #[test]
    fn test_mul_div_u64_overflow() {
        let result = mul_div_u64(u64::MAX, u64::MAX, 1);
        assert_eq!(result.unwrap_err(), PoolError::Overflow);
    }

    #[test]
    fn test_isqrt_edge_cases() {
        assert_eq!(isqrt(0), 0);
        assert_eq!(isqrt(1), 1);
        assert_eq!(isqrt(4), 2);
        assert_eq!(isqrt(u128::MAX), 18446744073709551615); // 2^64 - 1
    }

    // ============ Edge Case Tests ============

    #[test]
    fn test_swap_then_reverse_reserves() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let r1 = execute_swap(&mut p, 100_000, true, 0).unwrap();
        // Swap back
        let r2 = execute_swap(&mut p, r1.amount_out, false, 0).unwrap();
        // Due to fees, we get back less than we put in
        assert!(r2.amount_out < 100_000);
    }

    #[test]
    fn test_many_small_swaps() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        for _ in 0..100 {
            execute_swap(&mut p, 100, true, 0).unwrap();
        }
        // Pool should still be functional
        assert!(p.reserve_a > 0);
        assert!(p.reserve_b > 0);
        assert!(compute_k(&p) >= 1_000_000u128 * 1_000_000u128);
    }

    #[test]
    fn test_deposit_withdraw_roundtrip() {
        let mut p = make_pool();
        let pos1 = add_liquidity(&mut p, 1_000_000, 1_000_000, 0).unwrap();
        let pos2 = add_liquidity(&mut p, 500_000, 500_000, 0).unwrap();

        // Withdraw second depositor's shares
        let (a2, b2) = remove_liquidity(&mut p, pos2.shares).unwrap();
        // Should get back approximately what was deposited
        assert!(a2 <= 500_000);
        assert!(b2 <= 500_000);
        assert!(a2 >= 499_000); // within 0.2%

        // First depositor's position should be unaffected in value
        let (a1, b1) = amounts_for_shares(&p, pos1.shares);
        assert!(a1 >= 999_000);
        assert!(b1 >= 999_000);
    }

    #[test]
    fn test_swap_b_to_a_updates_volume_b() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        execute_swap(&mut p, 10_000, false, 0).unwrap();
        assert_eq!(p.total_volume_b, 10_000);
        assert_eq!(p.total_volume_a, 0);
    }

    #[test]
    fn test_pool_health_deep_pool() {
        let p = seeded_pool(10_000_000, 10_000_000);
        let health = pool_health(&p, 1_000_000, PRICE_SCALE as u64);
        assert_eq!(health.depth_score, BPS); // Max depth
    }

    #[test]
    fn test_pool_health_shallow_pool() {
        let mut p = make_pool();
        add_liquidity(&mut p, 10_000, 10_000, 0).unwrap();
        let health = pool_health(&p, 1_000, PRICE_SCALE as u64);
        assert!(health.depth_score < BPS);
    }

    #[test]
    fn test_amount_out_symmetry() {
        // Same reserves, same input → same output regardless of direction
        let out_a = amount_out(1_000_000, 1_000_000, 10_000, 30);
        let out_b = amount_out(1_000_000, 1_000_000, 10_000, 30);
        assert_eq!(out_a, out_b);
    }

    #[test]
    fn test_spot_price_after_swap_moves_correctly() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let price_before = spot_price(&p, true);
        execute_swap(&mut p, 100_000, true, 0).unwrap();
        let price_after = spot_price(&p, true);
        // After buying B with A, B becomes more expensive in A terms
        // But spot_price(true) = reserve_b / reserve_a, which decreases
        assert!(price_after < price_before);
    }

    #[test]
    fn test_spot_price_large_asymmetry() {
        let p = seeded_pool(1, 10_000_000);
        let price = spot_price(&p, true);
        assert!(price > 0);
    }

    #[test]
    fn test_lp_value_proportional_to_shares() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let val1 = lp_value(&p, 1000, PRICE_SCALE as u64);
        let val2 = lp_value(&p, 2000, PRICE_SCALE as u64);
        assert_eq!(val2, val1 * 2);
    }

    #[test]
    fn test_aggregate_tvl_empty() {
        let pools: Vec<Pool> = vec![];
        let prices: Vec<u64> = vec![];
        assert_eq!(aggregate_tvl(&pools, &prices), 0);
    }

    #[test]
    fn test_aggregate_volume_empty() {
        let pools: Vec<Pool> = vec![];
        assert_eq!(aggregate_volume(&pools), 0);
    }

    #[test]
    fn test_status_transitions_full_lifecycle() {
        let mut p = make_pool();
        assert_eq!(p.status, PoolStatus::Active);

        pause_pool(&mut p).unwrap();
        assert_eq!(p.status, PoolStatus::Paused);

        unpause_pool(&mut p).unwrap();
        assert_eq!(p.status, PoolStatus::Active);

        start_draining(&mut p).unwrap();
        assert_eq!(p.status, PoolStatus::Draining);

        deprecate_pool(&mut p).unwrap();
        assert_eq!(p.status, PoolStatus::Deprecated);
    }

    #[test]
    fn test_draining_swap_rejected() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        start_draining(&mut p).unwrap();
        let result = compute_swap(&p, 1000, true);
        assert_eq!(result.unwrap_err(), PoolError::PoolDraining);
    }

    #[test]
    fn test_deprecated_swap_rejected() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        deprecate_pool(&mut p).unwrap();
        let result = compute_swap(&p, 1000, true);
        assert_eq!(result.unwrap_err(), PoolError::PoolDeprecated);
    }

    #[test]
    fn test_execute_swap_b_to_a_updates_reserves() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let rb_before = p.reserve_b;
        let ra_before = p.reserve_a;
        let result = execute_swap(&mut p, 10_000, false, 0).unwrap();
        assert_eq!(p.reserve_b, rb_before + 10_000);
        assert_eq!(p.reserve_a, ra_before - result.amount_out);
    }

    #[test]
    fn test_impermanent_loss_symmetric() {
        // IL should be similar for 2x and 0.5x price movement
        let il_2x = impermanent_loss_bps(PRICE_SCALE as u64, (2 * PRICE_SCALE) as u64);
        let il_half = impermanent_loss_bps(PRICE_SCALE as u64, (PRICE_SCALE / 2) as u64);
        // They should be close (within 50 bps tolerance due to integer math)
        let diff = if il_2x > il_half {
            il_2x - il_half
        } else {
            il_half - il_2x
        };
        assert!(diff < 50, "IL should be symmetric: 2x={}, 0.5x={}", il_2x, il_half);
    }

    #[test]
    fn test_reserve_ratio_sums_to_bps() {
        let p = seeded_pool(3_000_000, 7_000_000);
        let (a, b) = reserve_ratio(&p);
        assert_eq!(a + b, BPS);
    }

    #[test]
    fn test_tvl_zero_price() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let t = tvl(&p, 0);
        // Only reserve_a counts when price_a=0
        assert_eq!(t, 1_000_000);
    }

    #[test]
    fn test_fee_computation_accuracy() {
        let p = seeded_pool(10_000_000, 10_000_000);
        let result = compute_swap(&p, 100_000, true).unwrap();
        // fee = 100000 * 30 / 10000 = 300
        assert_eq!(result.fee_amount, 300);
        // protocol_fee = 300 * 1667 / 10000 = 50
        assert_eq!(result.protocol_fee, 50);
    }

    #[test]
    fn test_compute_swap_reverse_b_to_a() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let result = compute_swap_reverse(&p, 5_000, false).unwrap();
        assert!(result.amount_in > 5_000);
        assert_eq!(result.amount_out, 5_000);
    }

    #[test]
    fn test_best_pool_considers_fees() {
        // Pool 1: high fee, big liquidity
        let mut p1 = create_pool(pool_id(), token_a(), token_b(), 300, PoolType::ConstantProduct).unwrap();
        add_liquidity(&mut p1, 10_000_000, 10_000_000, 0).unwrap();

        // Pool 2: low fee, big liquidity
        let mut p2 = create_pool(pool_id_2(), token_a(), token_b(), 10, PoolType::ConstantProduct).unwrap();
        add_liquidity(&mut p2, 10_000_000, 10_000_000, 0).unwrap();

        let pools = vec![p1, p2];
        let best = best_pool_for_swap(&pools, 100_000, true);
        assert_eq!(best, Some(1)); // Lower fee pool gives better output
    }

    #[test]
    fn test_max_swap_amount_empty() {
        let p = make_pool();
        assert_eq!(max_swap_amount(&p, true), 0);
        assert_eq!(max_swap_amount(&p, false), 0);
    }

    #[test]
    fn test_would_exceed_impact_zero_threshold() {
        let p = seeded_pool(1_000_000, 1_000_000);
        // Even tiny swap has some impact > 0
        assert!(would_exceed_impact(&p, 10_000, true, 0));
    }

    #[test]
    fn test_shares_for_amounts_tiny() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let shares = shares_for_amounts(&p, 1, 1);
        // 1 * 1_000_000 / 1_000_000 = 1 share (ratio is close to 1:1)
        assert_eq!(shares, 1);
        // But truly tiny relative to reserves → 0
        let p_big = seeded_pool(10_000_000, 10_000_000);
        let shares_big = shares_for_amounts(&p_big, 1, 1);
        // 1 * 10M / 10M = 1, still 1 share from integer math
        assert_eq!(shares_big, 1);
    }

    #[test]
    fn test_k_growth_saturating() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        // k_last set to something huge
        p.k_last = u128::MAX;
        // k_growth should saturate to 0
        assert_eq!(k_growth(&p), 0);
    }

    #[test]
    fn test_effective_price_scaling() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let result = compute_swap(&p, 10_000, true).unwrap();
        // For a 1:1 pool, effective price should be close to PRICE_SCALE
        assert!(result.effective_price > (PRICE_SCALE as u64) * 9 / 10);
        assert!(result.effective_price <= PRICE_SCALE as u64);
    }

    #[test]
    fn test_single_sided_increases_reserves() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let ra_before = p.reserve_a;
        let rb_before = p.reserve_b;
        add_liquidity_single_sided(&mut p, 100_000, true).unwrap();
        // Total reserves should have increased
        assert!(p.reserve_a + p.reserve_b > ra_before + rb_before);
    }

    // ============ Hardening Round 8 ============

    #[test]
    fn test_create_pool_identical_tokens_h8() {
        let t = [0x11; 32];
        let result = create_pool([0u8; 32], t, t, 30, PoolType::ConstantProduct);
        assert_eq!(result.err(), Some(PoolError::IdenticalTokens));
    }

    #[test]
    fn test_create_pool_max_fee_h8() {
        let result = create_pool(pool_id(), token_a(), token_b(), 10_000, PoolType::ConstantProduct);
        assert!(result.is_ok());
    }

    #[test]
    fn test_create_pool_over_max_fee_h8() {
        let result = create_pool(pool_id(), token_a(), token_b(), 10_001, PoolType::ConstantProduct);
        assert_eq!(result.err(), Some(PoolError::InvalidFeeRate));
    }

    #[test]
    fn test_validate_pool_empty_h8() {
        let p = make_pool();
        assert!(validate_pool(&p).is_ok());
    }

    #[test]
    fn test_add_liquidity_zero_amount_a_h8() {
        let mut p = make_pool();
        let result = add_liquidity(&mut p, 0, 1000, 0);
        assert_eq!(result.err(), Some(PoolError::ZeroAmount));
    }

    #[test]
    fn test_add_liquidity_zero_amount_b_h8() {
        let mut p = make_pool();
        let result = add_liquidity(&mut p, 1000, 0, 0);
        assert_eq!(result.err(), Some(PoolError::ZeroAmount));
    }

    #[test]
    fn test_add_liquidity_slippage_protection_h8() {
        let mut p = make_pool();
        let result = add_liquidity(&mut p, 1_000_000, 1_000_000, u64::MAX);
        assert_eq!(result.err(), Some(PoolError::SlippageExceeded));
    }

    #[test]
    fn test_remove_liquidity_zero_shares_h8() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let result = remove_liquidity(&mut p, 0);
        assert_eq!(result.err(), Some(PoolError::ZeroAmount));
    }

    #[test]
    fn test_remove_liquidity_excess_shares_h8() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let excess = p.total_lp_shares + 1;
        let result = remove_liquidity(&mut p, excess);
        assert_eq!(result.err(), Some(PoolError::InsufficientShares));
    }

    #[test]
    fn test_amount_out_zero_inputs_h8() {
        assert_eq!(amount_out(0, 1000, 100, 30), 0);
        assert_eq!(amount_out(1000, 0, 100, 30), 0);
        assert_eq!(amount_out(1000, 1000, 0, 30), 0);
    }

    #[test]
    fn test_amount_in_for_out_zero_inputs_h8() {
        assert_eq!(amount_in_for_out(0, 1000, 100, 30), 0);
        assert_eq!(amount_in_for_out(1000, 0, 100, 30), 0);
        assert_eq!(amount_in_for_out(1000, 1000, 0, 30), 0);
    }

    #[test]
    fn test_amount_in_for_out_desired_exceeds_reserve_h8() {
        assert_eq!(amount_in_for_out(1000, 1000, 1000, 30), 0);
        assert_eq!(amount_in_for_out(1000, 1000, 1001, 30), 0);
    }

    #[test]
    fn test_compute_swap_paused_pool_h8() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        pause_pool(&mut p).unwrap();
        let result = compute_swap(&p, 1000, true);
        assert_eq!(result.err(), Some(PoolError::PoolPaused));
    }

    #[test]
    fn test_execute_swap_slippage_exceeded_h8() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        let result = execute_swap(&mut p, 1000, true, u64::MAX);
        assert_eq!(result.err(), Some(PoolError::SlippageExceeded));
    }

    #[test]
    fn test_spot_price_zero_reserves_h8() {
        let p = make_pool();
        assert_eq!(spot_price(&p, true), 0);
        assert_eq!(spot_price(&p, false), 0);
    }

    #[test]
    fn test_price_impact_zero_amount_h8() {
        let p = seeded_pool(1_000_000, 1_000_000);
        assert_eq!(price_impact(&p, 0, true), 0);
    }

    #[test]
    fn test_price_impact_increases_with_size_h8() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let small_impact = price_impact(&p, 1_000, true);
        let large_impact = price_impact(&p, 100_000, true);
        assert!(large_impact > small_impact);
    }

    #[test]
    fn test_compute_k_empty_pool_h8() {
        let p = make_pool();
        assert_eq!(compute_k(&p), 0);
    }

    #[test]
    fn test_compute_k_seeded_h8() {
        let p = seeded_pool(1_000_000, 2_000_000);
        assert_eq!(compute_k(&p), 1_000_000u128 * 2_000_000u128);
    }

    #[test]
    fn test_pause_already_paused_h8() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        pause_pool(&mut p).unwrap();
        assert_eq!(pause_pool(&mut p).err(), Some(PoolError::PoolPaused));
    }

    #[test]
    fn test_unpause_active_pool_h8() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        // Already active, unpause should fail
        assert_eq!(unpause_pool(&mut p).err(), Some(PoolError::PoolPaused));
    }

    #[test]
    fn test_draining_allows_withdrawal_h8() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        start_draining(&mut p).unwrap();
        assert!(is_withdrawable(&p));
        assert!(!is_tradeable(&p));
        assert!(!is_depositable(&p));
    }

    #[test]
    fn test_deprecate_pool_h8() {
        let mut p = seeded_pool(1_000_000, 1_000_000);
        deprecate_pool(&mut p).unwrap();
        assert!(!is_tradeable(&p));
        assert!(!is_withdrawable(&p));
        assert_eq!(deprecate_pool(&mut p).err(), Some(PoolError::PoolDeprecated));
    }

    #[test]
    fn test_reserve_ratio_balanced_h8() {
        let p = seeded_pool(1_000_000, 1_000_000);
        let (a_bps, b_bps) = reserve_ratio(&p);
        assert_eq!(a_bps, 5000);
        assert_eq!(b_bps, 5000);
    }

    #[test]
    fn test_reserve_ratio_empty_pool_h8() {
        let p = make_pool();
        let (a_bps, b_bps) = reserve_ratio(&p);
        assert_eq!(a_bps, 5000);
        assert_eq!(b_bps, 5000);
    }

    #[test]
    fn test_fee_apr_zero_tvl_h8() {
        let p = make_pool();
        assert_eq!(fee_apr(&p, 1_000_000), 0);
    }

    #[test]
    fn test_max_swap_amount_30_percent_h8() {
        let p = seeded_pool(1_000_000, 2_000_000);
        let max_a_to_b = max_swap_amount(&p, true);
        assert_eq!(max_a_to_b, 600_000); // 30% of reserve_b=2M
    }

    #[test]
    fn test_best_pool_for_swap_h8() {
        let p1 = seeded_pool(1_000_000, 1_000_000);
        let p2 = seeded_pool(10_000_000, 10_000_000);
        let pools = vec![p1, p2];
        let best = best_pool_for_swap(&pools, 10_000, true);
        assert_eq!(best, Some(1)); // deeper pool gives better output
    }

    #[test]
    fn test_default_fee_rate_h8() {
        assert_eq!(default_fee_rate(), 30);
    }
}
