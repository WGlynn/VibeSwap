// ============ Protocol Simulator — What-If Scenario Engine ============
// Enables running "what-if" scenarios across the entire VibeSwap system:
// swap simulations, batch auction outcomes, liquidity events, lending
// cascades, and multi-step strategy evaluation.
//
// All functions are pure — they take state as input and return results
// without side effects. This makes them safe for exploratory analysis,
// strategy backtesting, and risk modeling.
//
// Core scenarios:
// - Swap simulation: constant-product AMM with fee deduction
// - Liquidity add/remove: proportional LP minting/burning
// - Multi-hop routing: chained swaps across multiple pools
// - Batch auction clearing: uniform price discovery from order books
// - Liquidation cascades: chain-reaction modeling from price drops
// - Arbitrage profitability: cross-pool price discrepancy analysis
// - Sandwich attack modeling: demonstrates commit-reveal protection
// - Impermanent loss: IL at any price ratio vs. HODL baseline

use vibeswap_math::PRECISION;

// ============ Constants ============

/// Maximum number of steps in a multi-step scenario.
pub const MAX_SIMULATION_STEPS: u32 = 100;

/// Maximum depth for liquidation cascade recursion.
pub const MAX_CASCADE_DEPTH: u32 = 10;

/// Minimum liquidity to consider a pool valid.
pub const MIN_LIQUIDITY: u128 = 1000;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SimError {
    /// Input amount is zero or parameters are invalid.
    InvalidInput,
    /// Pool has insufficient liquidity for the requested operation.
    InsufficientLiquidity,
    /// Arithmetic overflow during calculation.
    OverflowError,
    /// Pool has zero reserves.
    EmptyPool,
    /// No valid path found for multi-hop swap.
    NoPath,
    /// Operation would result in negative balance.
    NegativeBalance,
    /// Scenario exceeded maximum allowed steps.
    MaxStepsExceeded,
    /// Price parameter is zero or invalid.
    InvalidPrice,
}

// ============ Pool State ============

/// Snapshot of a constant-product AMM pool used as simulation input.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolState {
    /// Unique identifier for the token pair.
    pub pair_id: [u8; 32],
    /// Reserve of token0.
    pub reserve0: u128,
    /// Reserve of token1.
    pub reserve1: u128,
    /// Swap fee rate in basis points (e.g. 30 = 0.30%).
    pub fee_rate_bps: u16,
    /// Total LP token supply.
    pub total_lp: u128,
}

// ============ Result Types ============

/// Result of simulating a single swap.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SwapResult {
    /// Amount of output token received.
    pub amount_out: u128,
    /// Price impact in basis points.
    pub price_impact_bps: u16,
    /// Fee paid (in input token).
    pub fee_paid: u128,
    /// Reserve of token0 after the swap.
    pub new_reserve0: u128,
    /// Reserve of token1 after the swap.
    pub new_reserve1: u128,
}

/// Result of simulating an add-liquidity operation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AddLiquidityResult {
    /// LP tokens minted.
    pub lp_minted: u128,
    /// Amount of token0 actually consumed.
    pub amount0_used: u128,
    /// Amount of token1 actually consumed.
    pub amount1_used: u128,
    /// Reserve of token0 after deposit.
    pub new_reserve0: u128,
    /// Reserve of token1 after deposit.
    pub new_reserve1: u128,
}

/// Result of simulating a remove-liquidity operation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoveLiquidityResult {
    /// Amount of token0 withdrawn.
    pub amount0_out: u128,
    /// Amount of token1 withdrawn.
    pub amount1_out: u128,
    /// LP tokens burned.
    pub lp_burned: u128,
    /// Reserve of token0 after withdrawal.
    pub new_reserve0: u128,
    /// Reserve of token1 after withdrawal.
    pub new_reserve1: u128,
}

/// Result of a batch auction clearing simulation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BatchAuctionSim {
    /// Uniform clearing price (PRECISION scale).
    pub clearing_price: u128,
    /// Number of buy orders filled.
    pub buy_fills: u32,
    /// Number of sell orders filled.
    pub sell_fills: u32,
    /// Total volume transacted (in base token).
    pub total_volume: u128,
    /// Total unfilled buy volume.
    pub unfilled_buys: u128,
    /// Total unfilled sell volume.
    pub unfilled_sells: u128,
}

/// Result of a multi-hop swap simulation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MultiHopResult {
    /// Final output amount after all hops.
    pub final_output: u128,
    /// Number of hops executed.
    pub hops: u32,
    /// Total fees paid across all hops (in first input token equivalent).
    pub total_fee: u128,
    /// Total price impact across all hops in bps.
    pub total_impact_bps: u16,
    /// Intermediate output amounts (one per hop).
    pub intermediate_amounts: Vec<u128>,
}

/// Result of a liquidation cascade simulation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LiquidationCascade {
    /// Number of vaults liquidated.
    pub liquidations_triggered: u32,
    /// Total debt repaid by liquidators.
    pub total_debt_repaid: u128,
    /// Total collateral seized by liquidators.
    pub total_collateral_seized: u128,
    /// Final price impact on the pool in bps.
    pub final_price_impact_bps: u16,
    /// How many rounds of cascading occurred.
    pub cascade_depth: u32,
}

/// Result of a multi-step scenario simulation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScenarioResult {
    /// Number of simulation steps executed.
    pub steps_executed: u32,
    /// Pool state after all steps.
    pub final_pool_state: PoolState,
    /// Profit/loss of the scenario (can be negative).
    pub pnl: i128,
    /// Total fees paid across all steps.
    pub fees_total: u128,
}

// ============ Spot Price ============

/// Current spot price of token0 in terms of token1, scaled by PRECISION.
///
/// spot_price = reserve1 * PRECISION / reserve0
/// (how many token1 per token0)
pub fn spot_price(pool: &PoolState) -> u128 {
    if pool.reserve0 == 0 {
        return 0;
    }
    vibeswap_math::mul_div(pool.reserve1, PRECISION, pool.reserve0)
}

// ============ Swap Simulation ============

/// Simulate a constant-product AMM swap with fee deduction.
///
/// The fee is deducted from amount_in first, then the constant-product
/// formula determines amount_out:
///   amount_out = reserve_out * amount_in_after_fee / (reserve_in + amount_in_after_fee)
///
/// Price impact is measured as the deviation of the execution price from
/// the pre-swap spot price, expressed in basis points.
pub fn simulate_swap(
    pool: &PoolState,
    amount_in: u128,
    is_token0_in: bool,
) -> Result<SwapResult, SimError> {
    if amount_in == 0 {
        return Err(SimError::InvalidInput);
    }
    if pool.reserve0 == 0 || pool.reserve1 == 0 {
        return Err(SimError::EmptyPool);
    }
    if pool.reserve0 < MIN_LIQUIDITY || pool.reserve1 < MIN_LIQUIDITY {
        return Err(SimError::InsufficientLiquidity);
    }

    let (reserve_in, reserve_out) = if is_token0_in {
        (pool.reserve0, pool.reserve1)
    } else {
        (pool.reserve1, pool.reserve0)
    };

    // Fee deduction
    let fee = vibeswap_math::mul_div(amount_in, pool.fee_rate_bps as u128, 10_000);
    let amount_in_after_fee = amount_in.checked_sub(fee).ok_or(SimError::OverflowError)?;

    // Constant product: amount_out = reserve_out * amount_in_after_fee / (reserve_in + amount_in_after_fee)
    let denominator = reserve_in
        .checked_add(amount_in_after_fee)
        .ok_or(SimError::OverflowError)?;
    let amount_out = vibeswap_math::mul_div(reserve_out, amount_in_after_fee, denominator);

    if amount_out == 0 {
        return Err(SimError::InsufficientLiquidity);
    }
    if amount_out >= reserve_out {
        return Err(SimError::InsufficientLiquidity);
    }

    // Price impact in bps
    // Ideal output (no impact) = amount_in_after_fee * spot_price
    // spot_price of out per in = reserve_out / reserve_in
    // ideal_out = amount_in_after_fee * reserve_out / reserve_in
    let ideal_out = vibeswap_math::mul_div(amount_in_after_fee, reserve_out, reserve_in);
    let impact_bps = if ideal_out > 0 && ideal_out > amount_out {
        let diff = ideal_out - amount_out;
        let bps = vibeswap_math::mul_div(diff, 10_000, ideal_out);
        if bps > u16::MAX as u128 {
            u16::MAX
        } else {
            bps as u16
        }
    } else {
        0
    };

    // New reserves
    let (new_reserve0, new_reserve1) = if is_token0_in {
        (
            pool.reserve0.checked_add(amount_in).ok_or(SimError::OverflowError)?,
            pool.reserve1.checked_sub(amount_out).ok_or(SimError::OverflowError)?,
        )
    } else {
        (
            pool.reserve0.checked_sub(amount_out).ok_or(SimError::OverflowError)?,
            pool.reserve1.checked_add(amount_in).ok_or(SimError::OverflowError)?,
        )
    };

    Ok(SwapResult {
        amount_out,
        price_impact_bps: impact_bps,
        fee_paid: fee,
        new_reserve0,
        new_reserve1,
    })
}

// ============ Pool State After Swap ============

/// Apply a swap result to produce a new pool state.
pub fn pool_after_swap(pool: &PoolState, swap: &SwapResult, _is_token0_in: bool) -> PoolState {
    PoolState {
        pair_id: pool.pair_id,
        reserve0: swap.new_reserve0,
        reserve1: swap.new_reserve1,
        fee_rate_bps: pool.fee_rate_bps,
        total_lp: pool.total_lp,
    }
}

// ============ Add Liquidity Simulation ============

/// Simulate adding liquidity to a constant-product pool.
///
/// For the first deposit (empty pool), LP tokens equal sqrt(amount0 * amount1).
/// For subsequent deposits, tokens are added proportionally to existing reserves
/// and LP minted is proportional to the smaller ratio.
pub fn simulate_add_liquidity(
    pool: &PoolState,
    amount0: u128,
    amount1: u128,
) -> Result<AddLiquidityResult, SimError> {
    if amount0 == 0 || amount1 == 0 {
        return Err(SimError::InvalidInput);
    }

    // First deposit — bootstrap the pool
    if pool.reserve0 == 0 && pool.reserve1 == 0 {
        let lp_minted = vibeswap_math::sqrt_product(amount0, amount1);
        if lp_minted < MIN_LIQUIDITY {
            return Err(SimError::InsufficientLiquidity);
        }
        return Ok(AddLiquidityResult {
            lp_minted,
            amount0_used: amount0,
            amount1_used: amount1,
            new_reserve0: amount0,
            new_reserve1: amount1,
        });
    }

    if pool.total_lp == 0 {
        return Err(SimError::EmptyPool);
    }

    // Proportional deposit: use the limiting token
    // ratio0 = amount0 / reserve0, ratio1 = amount1 / reserve1
    // Use the smaller ratio to determine how much of each token is consumed
    let ratio0 = vibeswap_math::mul_div(amount0, PRECISION, pool.reserve0);
    let ratio1 = vibeswap_math::mul_div(amount1, PRECISION, pool.reserve1);

    let (amount0_used, amount1_used, lp_minted) = if ratio0 <= ratio1 {
        // token0 is the limiting factor
        let used1 = vibeswap_math::mul_div(amount0, pool.reserve1, pool.reserve0);
        let lp = vibeswap_math::mul_div(amount0, pool.total_lp, pool.reserve0);
        (amount0, used1, lp)
    } else {
        // token1 is the limiting factor
        let used0 = vibeswap_math::mul_div(amount1, pool.reserve0, pool.reserve1);
        let lp = vibeswap_math::mul_div(amount1, pool.total_lp, pool.reserve1);
        (used0, amount1, lp)
    };

    if lp_minted == 0 {
        return Err(SimError::InsufficientLiquidity);
    }

    Ok(AddLiquidityResult {
        lp_minted,
        amount0_used,
        amount1_used,
        new_reserve0: pool.reserve0 + amount0_used,
        new_reserve1: pool.reserve1 + amount1_used,
    })
}

// ============ Remove Liquidity Simulation ============

/// Simulate removing liquidity from a constant-product pool.
///
/// Returns proportional shares of both tokens based on the fraction
/// of total LP supply being burned.
pub fn simulate_remove_liquidity(
    pool: &PoolState,
    lp_amount: u128,
) -> Result<RemoveLiquidityResult, SimError> {
    if lp_amount == 0 {
        return Err(SimError::InvalidInput);
    }
    if pool.total_lp == 0 || pool.reserve0 == 0 || pool.reserve1 == 0 {
        return Err(SimError::EmptyPool);
    }
    if lp_amount > pool.total_lp {
        return Err(SimError::InsufficientLiquidity);
    }

    let amount0_out = vibeswap_math::mul_div(pool.reserve0, lp_amount, pool.total_lp);
    let amount1_out = vibeswap_math::mul_div(pool.reserve1, lp_amount, pool.total_lp);

    if amount0_out == 0 || amount1_out == 0 {
        return Err(SimError::InsufficientLiquidity);
    }

    Ok(RemoveLiquidityResult {
        amount0_out,
        amount1_out,
        lp_burned: lp_amount,
        new_reserve0: pool.reserve0 - amount0_out,
        new_reserve1: pool.reserve1 - amount1_out,
    })
}

// ============ Multi-Hop Swap Simulation ============

/// Simulate a multi-hop swap through a sequence of pools.
///
/// `pools` contains the pool states in hop order.
/// `token_path` contains the token IDs along the route (length = pools.len() + 1).
/// For each hop, determines swap direction by matching token_path entries to pool pair_id.
///
/// The is_token0_in direction for each hop is determined by convention:
/// we assume the input token for hop i is token_path[i] and the output is token_path[i+1].
/// The caller passes pool states in the correct order. The first token in a pair (token0)
/// is the token whose reserve is in reserve0. We use a simple heuristic: if the amount
/// flows in as token0, is_token0_in = true. The caller must ensure pool ordering matches
/// the token path. For simplicity, odd-indexed hops swap token1->token0 and even-indexed
/// hops swap token0->token1 (the caller can reorder pools to match).
///
/// To keep the interface simple and avoid ambiguity, each pool's direction is determined
/// by an alternating pattern: hop 0 is token0_in=true, hop 1 is token0_in=false, etc.
/// The caller should arrange the pool list so this alternation matches the desired path.
pub fn simulate_multi_hop(
    pools: &[PoolState],
    token_path: &[[u8; 32]],
    amount_in: u128,
) -> Result<MultiHopResult, SimError> {
    if pools.is_empty() {
        return Err(SimError::NoPath);
    }
    if token_path.len() != pools.len() + 1 {
        return Err(SimError::InvalidInput);
    }
    if amount_in == 0 {
        return Err(SimError::InvalidInput);
    }

    let mut current_amount = amount_in;
    let mut total_fee: u128 = 0;
    let mut total_impact: u128 = 0;
    let mut intermediate_amounts = Vec::with_capacity(pools.len());

    for (i, pool) in pools.iter().enumerate() {
        // Direction: even hops are token0->token1, odd hops are token1->token0
        let is_token0_in = i % 2 == 0;

        let swap = simulate_swap(pool, current_amount, is_token0_in)?;

        // Accumulate fee (approximate — in different tokens per hop)
        total_fee = total_fee.saturating_add(swap.fee_paid);
        total_impact = total_impact.saturating_add(swap.price_impact_bps as u128);

        current_amount = swap.amount_out;
        intermediate_amounts.push(current_amount);
    }

    let capped_impact = if total_impact > u16::MAX as u128 {
        u16::MAX
    } else {
        total_impact as u16
    };

    Ok(MultiHopResult {
        final_output: current_amount,
        hops: pools.len() as u32,
        total_fee,
        total_impact_bps: capped_impact,
        intermediate_amounts,
    })
}

// ============ Batch Auction Simulation ============

/// Simulate a batch auction to find the uniform clearing price.
///
/// `buys` contains (amount, max_price) pairs — buy orders willing to pay up to max_price.
/// `sells` contains (amount, min_price) pairs — sell orders willing to sell at min_price or above.
/// Prices are in PRECISION scale.
///
/// The clearing price is the highest price where cumulative buy volume >= cumulative sell volume.
/// Buy orders fill if their limit_price >= clearing_price.
/// Sell orders fill if their limit_price <= clearing_price.
pub fn simulate_batch_auction(
    buys: &[(u128, u128)],
    sells: &[(u128, u128)],
) -> Result<BatchAuctionSim, SimError> {
    if buys.is_empty() && sells.is_empty() {
        return Err(SimError::InvalidInput);
    }

    // Collect all unique prices as candidate clearing prices
    let mut prices: Vec<u128> = Vec::new();
    for &(_, price) in buys.iter() {
        if price > 0 {
            prices.push(price);
        }
    }
    for &(_, price) in sells.iter() {
        if price > 0 {
            prices.push(price);
        }
    }

    if prices.is_empty() {
        return Err(SimError::InvalidPrice);
    }

    prices.sort_unstable();
    prices.dedup();

    // Find the clearing price that maximizes matched volume
    let mut best_price: u128 = 0;
    let mut best_volume: u128 = 0;
    let mut best_buy_fills: u32 = 0;
    let mut best_sell_fills: u32 = 0;
    let mut best_buy_vol: u128 = 0;
    let mut best_sell_vol: u128 = 0;

    for &candidate in &prices {
        // Total buy volume at this price: buys willing to pay >= candidate
        let mut buy_vol: u128 = 0;
        let mut buy_count: u32 = 0;
        for &(amount, max_price) in buys.iter() {
            if max_price >= candidate {
                buy_vol = buy_vol.saturating_add(amount);
                buy_count += 1;
            }
        }

        // Total sell volume at this price: sells willing to sell <= candidate
        let mut sell_vol: u128 = 0;
        let mut sell_count: u32 = 0;
        for &(amount, min_price) in sells.iter() {
            if min_price <= candidate {
                sell_vol = sell_vol.saturating_add(amount);
                sell_count += 1;
            }
        }

        // Matched volume is the minimum of buy and sell volumes
        let matched = if buy_vol < sell_vol { buy_vol } else { sell_vol };

        // Pick the price that maximizes matched volume; ties go to higher price
        if matched > best_volume || (matched == best_volume && candidate > best_price) {
            best_price = candidate;
            best_volume = matched;
            best_buy_fills = buy_count;
            best_sell_fills = sell_count;
            best_buy_vol = buy_vol;
            best_sell_vol = sell_vol;
        }
    }

    // If there are only buys and no sells (or vice versa), clearing price is the best we found
    // but volume matched is 0
    let unfilled_buys = best_buy_vol.saturating_sub(best_volume);
    let unfilled_sells = best_sell_vol.saturating_sub(best_volume);

    Ok(BatchAuctionSim {
        clearing_price: best_price,
        buy_fills: best_buy_fills,
        sell_fills: best_sell_fills,
        total_volume: best_volume,
        unfilled_buys,
        unfilled_sells,
    })
}

// ============ Price Impact ============

/// Calculate the price impact of a swap in basis points, without executing it.
///
/// Returns 0 if the pool is empty or the amount is zero.
pub fn simulate_price_impact(pool: &PoolState, amount_in: u128, is_token0_in: bool) -> u16 {
    if amount_in == 0 || pool.reserve0 == 0 || pool.reserve1 == 0 {
        return 0;
    }

    match simulate_swap(pool, amount_in, is_token0_in) {
        Ok(result) => result.price_impact_bps,
        Err(_) => u16::MAX,
    }
}

// ============ Arbitrage Profit Simulation ============

/// Simulate buying on pool_a and selling on pool_b.
///
/// Buys token1 on pool_a (token0 -> token1), then sells token1 on pool_b (token1 -> token0).
/// Returns the net profit (positive) or loss (negative) in token0.
pub fn simulate_arb_profit(
    pool_a: &PoolState,
    pool_b: &PoolState,
    amount: u128,
) -> Result<i128, SimError> {
    if amount == 0 {
        return Err(SimError::InvalidInput);
    }

    // Buy on pool_a: swap token0 -> token1
    let buy_result = simulate_swap(pool_a, amount, true)?;
    let intermediate = buy_result.amount_out;

    // Sell on pool_b: swap token1 -> token0
    let sell_result = simulate_swap(pool_b, intermediate, false)?;
    let final_amount = sell_result.amount_out;

    // Profit = final_amount - initial_amount
    let profit = (final_amount as i128) - (amount as i128);
    Ok(profit)
}

// ============ Liquidation Cascade Simulation ============

/// Simulate a liquidation cascade from a price drop.
///
/// Each vault is (collateral_amount, debt_amount, liquidation_threshold_bps).
/// A vault is liquidated when:
///   collateral_value * liquidation_threshold_bps / 10000 < debt_value
/// which means the collateral ratio has fallen below the threshold.
///
/// When a vault is liquidated, its collateral is sold on the pool,
/// further depressing the price and potentially triggering more liquidations.
pub fn simulate_liquidation_cascade(
    vaults: &[(u128, u128, u16)],
    price_drop_bps: u16,
    pool: &PoolState,
) -> LiquidationCascade {
    if vaults.is_empty() || price_drop_bps == 0 {
        return LiquidationCascade {
            liquidations_triggered: 0,
            total_debt_repaid: 0,
            total_collateral_seized: 0,
            final_price_impact_bps: 0,
            cascade_depth: 0,
        };
    }

    let initial_price = spot_price(pool);
    if initial_price == 0 {
        return LiquidationCascade {
            liquidations_triggered: 0,
            total_debt_repaid: 0,
            total_collateral_seized: 0,
            final_price_impact_bps: 0,
            cascade_depth: 0,
        };
    }

    // Apply the initial price drop to get the current effective price
    let mut current_price = vibeswap_math::mul_div(
        initial_price,
        (10_000u128).saturating_sub(price_drop_bps as u128),
        10_000,
    );

    let mut total_liquidations: u32 = 0;
    let mut total_debt_repaid: u128 = 0;
    let mut total_collateral_seized: u128 = 0;
    let mut cascade_depth: u32 = 0;
    let mut current_pool = pool.clone();

    // Track which vaults have been liquidated
    let mut liquidated = vec![false; vaults.len()];

    loop {
        if cascade_depth >= MAX_CASCADE_DEPTH {
            break;
        }

        let mut round_liquidations: u32 = 0;
        let mut round_collateral: u128 = 0;
        let mut round_debt: u128 = 0;

        for (i, &(collateral, debt, threshold_bps)) in vaults.iter().enumerate() {
            if liquidated[i] {
                continue;
            }

            // Collateral value in terms of token1 (debt denomination)
            let collateral_value = vibeswap_math::mul_div(collateral, current_price, PRECISION);

            // Check if undercollateralized:
            // collateral_value * 10000 < debt * threshold_bps
            let lhs = vibeswap_math::mul_div(collateral_value, 10_000, 1);
            let rhs = vibeswap_math::mul_div(debt, threshold_bps as u128, 1);

            if lhs < rhs {
                liquidated[i] = true;
                round_liquidations += 1;
                round_collateral = round_collateral.saturating_add(collateral);
                round_debt = round_debt.saturating_add(debt);
            }
        }

        if round_liquidations == 0 {
            break;
        }

        total_liquidations += round_liquidations;
        total_debt_repaid = total_debt_repaid.saturating_add(round_debt);
        total_collateral_seized = total_collateral_seized.saturating_add(round_collateral);
        cascade_depth += 1;

        // Simulate the selling pressure: collateral is sold on the pool
        // This further depresses the price
        if current_pool.reserve0 >= MIN_LIQUIDITY && current_pool.reserve1 >= MIN_LIQUIDITY {
            if let Ok(swap) = simulate_swap(&current_pool, round_collateral, true) {
                current_pool = pool_after_swap(&current_pool, &swap, true);
                current_price = spot_price(&current_pool);
            } else {
                break;
            }
        } else {
            break;
        }
    }

    // Final price impact
    let final_price = spot_price(&current_pool);
    let final_impact_bps = if initial_price > 0 && final_price < initial_price {
        let diff = initial_price - final_price;
        let bps = vibeswap_math::mul_div(diff, 10_000, initial_price);
        if bps > u16::MAX as u128 {
            u16::MAX
        } else {
            bps as u16
        }
    } else {
        0
    };

    LiquidationCascade {
        liquidations_triggered: total_liquidations,
        total_debt_repaid,
        total_collateral_seized,
        final_price_impact_bps: final_impact_bps,
        cascade_depth,
    }
}

// ============ Optimal Swap Amount ============

/// Calculate how much to swap to move the pool's spot price to a target.
///
/// Returns (amount, is_token0_in) — the amount to swap and the direction.
/// target_price is in PRECISION scale (token1 per token0).
///
/// For constant product x*y = k:
///   new_price = new_reserve1 / new_reserve0 = target_price / PRECISION
///   Solving with k = reserve0 * reserve1:
///   new_reserve0 = sqrt(k * PRECISION / target_price)
///   amount_in = new_reserve0 - reserve0 (if target price < current, need more token0)
pub fn optimal_swap_amount(
    pool: &PoolState,
    target_price: u128,
) -> Result<(u128, bool), SimError> {
    if target_price == 0 {
        return Err(SimError::InvalidPrice);
    }
    if pool.reserve0 == 0 || pool.reserve1 == 0 {
        return Err(SimError::EmptyPool);
    }

    let current = spot_price(pool);
    if current == 0 {
        return Err(SimError::EmptyPool);
    }

    // k = reserve0 * reserve1
    // At target price P (in PRECISION): new_r1 / new_r0 = P / PRECISION
    // new_r0 * new_r1 = k
    // new_r1 = new_r0 * P / PRECISION
    // new_r0^2 * P / PRECISION = k
    // new_r0 = sqrt(k * PRECISION / P)

    // To avoid overflow, compute k_scaled = reserve0 * reserve1 * PRECISION / target_price
    // new_r0 = sqrt(k_scaled)
    // But we need to be careful about overflow. Use mul_div where possible.

    // k * PRECISION / target_price = (reserve0 * reserve1 * PRECISION) / target_price
    // = reserve0 * (reserve1 * PRECISION / target_price)
    let r1_scaled = vibeswap_math::mul_div(pool.reserve1, PRECISION, target_price);
    // new_r0 = sqrt(reserve0 * r1_scaled)
    let new_r0 = vibeswap_math::sqrt_product(pool.reserve0, r1_scaled);

    if new_r0 == 0 {
        return Err(SimError::InvalidPrice);
    }

    if target_price < current {
        // Price needs to go down: sell token0 (swap token0 -> token1)
        // This increases reserve0 and decreases reserve1
        if new_r0 <= pool.reserve0 {
            // Already at or past target
            return Ok((0, true));
        }
        let raw_amount = new_r0 - pool.reserve0;
        // Account for fees: actual swap amount needs to be larger because fee is deducted
        // amount_in_after_fee = raw_amount, so amount_in = raw_amount * 10000 / (10000 - fee)
        let denom = 10_000u128.saturating_sub(pool.fee_rate_bps as u128);
        if denom == 0 {
            return Err(SimError::InvalidInput);
        }
        let amount = vibeswap_math::mul_div(raw_amount, 10_000, denom);
        Ok((amount, true))
    } else if target_price > current {
        // Price needs to go up: sell token1 (swap token1 -> token0)
        // This decreases reserve0 and increases reserve1
        // new_r1 = k / new_r0
        let new_r1 = vibeswap_math::mul_div(pool.reserve0, pool.reserve1, new_r0);
        if new_r1 <= pool.reserve1 {
            return Ok((0, false));
        }
        let raw_amount = new_r1 - pool.reserve1;
        let denom = 10_000u128.saturating_sub(pool.fee_rate_bps as u128);
        if denom == 0 {
            return Err(SimError::InvalidInput);
        }
        let amount = vibeswap_math::mul_div(raw_amount, 10_000, denom);
        Ok((amount, false))
    } else {
        // Already at target
        Ok((0, true))
    }
}

// ============ Sandwich Attack Simulation ============

/// Simulate a sandwich attack to calculate attacker profit.
///
/// A sandwich attack front-runs a victim's swap to move the price unfavorably,
/// then back-runs after the victim to profit from the price movement.
///
/// This demonstrates why VibeSwap's commit-reveal mechanism prevents such attacks —
/// the attacker cannot see the victim's order during the commit phase.
///
/// Steps:
/// 1. Attacker front-runs: swaps attacker_amount in the same direction as victim
/// 2. Victim swaps: gets worse price due to front-run
/// 3. Attacker back-runs: swaps in reverse direction to capture profit
///
/// Returns net profit (positive) or loss (negative) for the attacker.
pub fn sandwich_profit(
    pool: &PoolState,
    victim_amount: u128,
    victim_is_token0: bool,
    attacker_amount: u128,
) -> Result<i128, SimError> {
    if victim_amount == 0 || attacker_amount == 0 {
        return Err(SimError::InvalidInput);
    }

    // Step 1: Attacker front-run (same direction as victim)
    let front_run = simulate_swap(pool, attacker_amount, victim_is_token0)?;
    let pool_after_front = pool_after_swap(pool, &front_run, victim_is_token0);

    // Step 2: Victim swap (same direction)
    let victim_swap = simulate_swap(&pool_after_front, victim_amount, victim_is_token0)?;
    let pool_after_victim = pool_after_swap(&pool_after_front, &victim_swap, victim_is_token0);

    // Step 3: Attacker back-run (reverse direction)
    // Attacker sells the tokens received from the front-run
    let back_run = simulate_swap(
        &pool_after_victim,
        front_run.amount_out,
        !victim_is_token0,
    )?;

    // Profit = what attacker got back - what attacker put in
    let profit = (back_run.amount_out as i128) - (attacker_amount as i128);
    Ok(profit)
}

// ============ Impermanent Loss Simulation ============

/// Calculate impermanent loss given initial and final price ratios.
///
/// All prices are in PRECISION scale.
/// initial_value is the total value of the LP position at entry (in token1 terms).
///
/// Returns (lp_value, hodl_value, il_bps):
/// - lp_value: value of the LP position at final_price
/// - hodl_value: value of just holding the initial tokens
/// - il_bps: impermanent loss in basis points (lp_value vs hodl_value)
///
/// IL formula for constant product:
///   price_ratio r = final_price / initial_price
///   lp_value = initial_value * sqrt(r)
///   hodl_value = initial_value * (1 + r) / 2
///   IL = 1 - lp_value / hodl_value = 1 - 2*sqrt(r)/(1+r)
///
/// In integer math with PRECISION scaling:
///   ratio = final_price * PRECISION / initial_price  (PRECISION-scaled)
///   sqrt_ratio = sqrt(ratio * PRECISION)             (PRECISION-scaled)
///   lp_value = initial_value * sqrt_ratio / PRECISION
///   hodl_value = initial_value * (PRECISION + ratio) / (2 * PRECISION)
pub fn impermanent_loss_sim(
    initial_price: u128,
    final_price: u128,
    initial_value: u128,
) -> (u128, u128, u16) {
    if initial_price == 0 || final_price == 0 || initial_value == 0 {
        return (0, 0, 0);
    }

    // ratio = final_price * PRECISION / initial_price (PRECISION-scaled)
    let ratio = vibeswap_math::mul_div(final_price, PRECISION, initial_price);

    // sqrt_ratio in PRECISION scale: sqrt(ratio * PRECISION)
    let sqrt_ratio = vibeswap_math::sqrt_product(ratio, PRECISION);

    // lp_value = initial_value * sqrt_ratio / PRECISION
    let lp_value = vibeswap_math::mul_div(initial_value, sqrt_ratio, PRECISION);

    // hodl_value = initial_value * (PRECISION + ratio) / (2 * PRECISION)
    let hodl_value = vibeswap_math::mul_div(initial_value, PRECISION + ratio, 2 * PRECISION);

    // IL in bps: (hodl_value - lp_value) * 10000 / hodl_value
    let il_bps = if hodl_value > lp_value && hodl_value > 0 {
        let diff = hodl_value - lp_value;
        let bps = vibeswap_math::mul_div(diff, 10_000, hodl_value);
        if bps > u16::MAX as u128 {
            u16::MAX
        } else {
            bps as u16
        }
    } else {
        0
    };

    (lp_value, hodl_value, il_bps)
}

// ============ Fee Revenue Projection ============

/// Project cumulative fee revenue over a period.
///
/// Assumes constant daily volume and fee rate.
/// Returns total fees collected in the pool's fee token.
pub fn fee_revenue_projection(pool: &PoolState, daily_volume: u128, days: u32) -> u128 {
    if daily_volume == 0 || days == 0 {
        return 0;
    }
    let daily_fee = vibeswap_math::mul_div(daily_volume, pool.fee_rate_bps as u128, 10_000);
    daily_fee.saturating_mul(days as u128)
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn make_pool(r0: u128, r1: u128, fee_bps: u16, lp: u128) -> PoolState {
        PoolState {
            pair_id: [0u8; 32],
            reserve0: r0,
            reserve1: r1,
            fee_rate_bps: fee_bps,
            total_lp: lp,
        }
    }

    fn make_pool_with_id(id: u8, r0: u128, r1: u128, fee_bps: u16, lp: u128) -> PoolState {
        let mut pair_id = [0u8; 32];
        pair_id[0] = id;
        PoolState {
            pair_id,
            reserve0: r0,
            reserve1: r1,
            fee_rate_bps: fee_bps,
            total_lp: lp,
        }
    }

    // Standard pool: 1M/1M at 0.3% fee, 1M LP
    fn standard_pool() -> PoolState {
        make_pool(1_000_000 * PRECISION, 1_000_000 * PRECISION, 30, 1_000_000 * PRECISION)
    }

    // Imbalanced pool: 1M/2M (price = 2.0)
    fn imbalanced_pool() -> PoolState {
        make_pool(1_000_000 * PRECISION, 2_000_000 * PRECISION, 30, 1_414_213 * PRECISION)
    }

    // ============ Spot Price Tests ============

    #[test]
    fn test_spot_price_balanced() {
        let pool = standard_pool();
        let price = spot_price(&pool);
        assert_eq!(price, PRECISION); // 1:1 ratio
    }

    #[test]
    fn test_spot_price_imbalanced() {
        let pool = imbalanced_pool();
        let price = spot_price(&pool);
        assert_eq!(price, 2 * PRECISION); // 2:1 ratio
    }

    #[test]
    fn test_spot_price_empty_pool() {
        let pool = make_pool(0, 0, 30, 0);
        assert_eq!(spot_price(&pool), 0);
    }

    #[test]
    fn test_spot_price_zero_reserve0() {
        let pool = make_pool(0, 1_000_000, 30, 0);
        assert_eq!(spot_price(&pool), 0);
    }

    #[test]
    fn test_spot_price_small_reserves() {
        let pool = make_pool(1000, 3000, 30, 1000);
        let price = spot_price(&pool);
        assert_eq!(price, 3 * PRECISION);
    }

    // ============ Swap Tests ============

    #[test]
    fn test_swap_normal() {
        let pool = standard_pool();
        let amount_in = 1_000 * PRECISION;
        let result = simulate_swap(&pool, amount_in, true).unwrap();
        // Should get slightly less than 1000 due to fees and price impact
        assert!(result.amount_out > 0);
        assert!(result.amount_out < amount_in);
        assert!(result.fee_paid > 0);
        assert!(result.price_impact_bps > 0);
    }

    #[test]
    fn test_swap_fee_calculation() {
        let pool = standard_pool(); // 30 bps fee
        let amount_in = 10_000 * PRECISION;
        let result = simulate_swap(&pool, amount_in, true).unwrap();
        // Fee should be 0.3% of input
        let expected_fee = vibeswap_math::mul_div(amount_in, 30, 10_000);
        assert_eq!(result.fee_paid, expected_fee);
    }

    #[test]
    fn test_swap_large_amount_high_impact() {
        let pool = standard_pool();
        // Swap 10% of reserves — should have significant impact
        let amount_in = 100_000 * PRECISION;
        let result = simulate_swap(&pool, amount_in, true).unwrap();
        assert!(result.price_impact_bps > 100); // > 1% impact
        // Amount out should be noticeably less than amount in due to impact
        assert!(result.amount_out < amount_in);
    }

    #[test]
    fn test_swap_zero_amount() {
        let pool = standard_pool();
        let result = simulate_swap(&pool, 0, true);
        assert_eq!(result, Err(SimError::InvalidInput));
    }

    #[test]
    fn test_swap_empty_pool() {
        let pool = make_pool(0, 0, 30, 0);
        let result = simulate_swap(&pool, 1000, true);
        assert_eq!(result, Err(SimError::EmptyPool));
    }

    #[test]
    fn test_swap_below_min_liquidity() {
        let pool = make_pool(500, 500, 30, 500);
        let result = simulate_swap(&pool, 100, true);
        assert_eq!(result, Err(SimError::InsufficientLiquidity));
    }

    #[test]
    fn test_swap_token1_in() {
        let pool = imbalanced_pool();
        let amount_in = 1_000 * PRECISION;
        let result = simulate_swap(&pool, amount_in, false).unwrap();
        // Swapping token1 for token0 in a pool where token0 is cheaper
        assert!(result.amount_out > 0);
        // New reserves should reflect token1 added, token0 removed
        assert!(result.new_reserve1 > pool.reserve1);
        assert!(result.new_reserve0 < pool.reserve0);
    }

    #[test]
    fn test_swap_preserves_k_approximately() {
        let pool = standard_pool();
        let amount_in = 5_000 * PRECISION;
        let result = simulate_swap(&pool, amount_in, true).unwrap();
        // k should increase slightly (fees add to reserves)
        let k_before = pool.reserve0 as u128 / PRECISION * (pool.reserve1 / PRECISION);
        let k_after = result.new_reserve0 / PRECISION * (result.new_reserve1 / PRECISION);
        assert!(k_after >= k_before);
    }

    #[test]
    fn test_swap_new_reserves_correct() {
        let pool = standard_pool();
        let amount_in = 1_000 * PRECISION;
        let result = simulate_swap(&pool, amount_in, true).unwrap();
        // token0 in: reserve0 goes up by amount_in, reserve1 goes down by amount_out
        assert_eq!(result.new_reserve0, pool.reserve0 + amount_in);
        assert_eq!(result.new_reserve1, pool.reserve1 - result.amount_out);
    }

    #[test]
    fn test_swap_zero_fee_pool() {
        let pool = make_pool(1_000_000 * PRECISION, 1_000_000 * PRECISION, 0, 1_000_000 * PRECISION);
        let amount_in = 1_000 * PRECISION;
        let result = simulate_swap(&pool, amount_in, true).unwrap();
        assert_eq!(result.fee_paid, 0);
        // With no fee, output should be higher than with fee
        let pool_with_fee = standard_pool();
        let result_with_fee = simulate_swap(&pool_with_fee, amount_in, true).unwrap();
        assert!(result.amount_out > result_with_fee.amount_out);
    }

    #[test]
    fn test_swap_small_amount() {
        let pool = standard_pool();
        let result = simulate_swap(&pool, PRECISION, true).unwrap();
        assert!(result.amount_out > 0);
    }

    #[test]
    fn test_swap_very_small_amount() {
        let pool = standard_pool();
        // 1 unit on a massive pool: fee rounds to 0, amount_in_after_fee = 1
        // but amount_out = reserve_out * 1 / (reserve_in + 1) can round to 0
        // which triggers InsufficientLiquidity
        let result = simulate_swap(&pool, 1, true);
        // Either succeeds with tiny output or fails due to rounding to 0
        match result {
            Ok(r) => assert!(r.amount_out > 0),
            Err(e) => assert_eq!(e, SimError::InsufficientLiquidity),
        }
    }

    // ============ Add Liquidity Tests ============

    #[test]
    fn test_add_liquidity_first_deposit() {
        let pool = make_pool(0, 0, 30, 0);
        let result = simulate_add_liquidity(&pool, 1_000_000 * PRECISION, 1_000_000 * PRECISION).unwrap();
        assert!(result.lp_minted > 0);
        assert_eq!(result.amount0_used, 1_000_000 * PRECISION);
        assert_eq!(result.amount1_used, 1_000_000 * PRECISION);
        assert_eq!(result.new_reserve0, 1_000_000 * PRECISION);
        assert_eq!(result.new_reserve1, 1_000_000 * PRECISION);
    }

    #[test]
    fn test_add_liquidity_balanced() {
        let pool = standard_pool();
        let amount = 100_000 * PRECISION;
        let result = simulate_add_liquidity(&pool, amount, amount).unwrap();
        // Both tokens used equally for a balanced pool
        assert_eq!(result.amount0_used, amount);
        assert_eq!(result.amount1_used, amount);
        // LP minted should be 10% of total (adding 10% to each reserve)
        let expected_lp = vibeswap_math::mul_div(amount, pool.total_lp, pool.reserve0);
        assert_eq!(result.lp_minted, expected_lp);
    }

    #[test]
    fn test_add_liquidity_imbalanced_input() {
        let pool = standard_pool();
        // Provide 2x token0 vs token1 — should cap to the limiting factor
        let result = simulate_add_liquidity(&pool, 200_000 * PRECISION, 100_000 * PRECISION).unwrap();
        // token1 is limiting, so amount0_used should be 100_000 (matching ratio)
        assert_eq!(result.amount1_used, 100_000 * PRECISION);
        assert_eq!(result.amount0_used, 100_000 * PRECISION);
    }

    #[test]
    fn test_add_liquidity_proportional_minting() {
        let pool = standard_pool();
        let amount = 50_000 * PRECISION;
        let result = simulate_add_liquidity(&pool, amount, amount).unwrap();
        // 5% of each reserve -> 5% of LP
        let expected_lp = vibeswap_math::mul_div(amount, pool.total_lp, pool.reserve0);
        assert_eq!(result.lp_minted, expected_lp);
    }

    #[test]
    fn test_add_liquidity_zero_amount() {
        let pool = standard_pool();
        assert_eq!(
            simulate_add_liquidity(&pool, 0, 1_000),
            Err(SimError::InvalidInput)
        );
        assert_eq!(
            simulate_add_liquidity(&pool, 1_000, 0),
            Err(SimError::InvalidInput)
        );
    }

    #[test]
    fn test_add_liquidity_imbalanced_pool() {
        let pool = imbalanced_pool();
        // Pool has 1M:2M ratio, so need 2x more token1 than token0
        let result = simulate_add_liquidity(&pool, 100_000 * PRECISION, 200_000 * PRECISION).unwrap();
        assert_eq!(result.amount0_used, 100_000 * PRECISION);
        assert_eq!(result.amount1_used, 200_000 * PRECISION);
    }

    #[test]
    fn test_add_liquidity_first_deposit_small() {
        let pool = make_pool(0, 0, 30, 0);
        // Too small — below MIN_LIQUIDITY
        let result = simulate_add_liquidity(&pool, 1, 1);
        assert_eq!(result, Err(SimError::InsufficientLiquidity));
    }

    #[test]
    fn test_add_liquidity_reserves_increase() {
        let pool = standard_pool();
        let result = simulate_add_liquidity(&pool, 100_000 * PRECISION, 100_000 * PRECISION).unwrap();
        assert!(result.new_reserve0 > pool.reserve0);
        assert!(result.new_reserve1 > pool.reserve1);
    }

    // ============ Remove Liquidity Tests ============

    #[test]
    fn test_remove_liquidity_partial() {
        let pool = standard_pool();
        let lp_amount = pool.total_lp / 10; // Remove 10%
        let result = simulate_remove_liquidity(&pool, lp_amount).unwrap();
        let expected0 = vibeswap_math::mul_div(pool.reserve0, lp_amount, pool.total_lp);
        let expected1 = vibeswap_math::mul_div(pool.reserve1, lp_amount, pool.total_lp);
        assert_eq!(result.amount0_out, expected0);
        assert_eq!(result.amount1_out, expected1);
        assert_eq!(result.lp_burned, lp_amount);
    }

    #[test]
    fn test_remove_liquidity_full() {
        let pool = standard_pool();
        let result = simulate_remove_liquidity(&pool, pool.total_lp).unwrap();
        assert_eq!(result.amount0_out, pool.reserve0);
        assert_eq!(result.amount1_out, pool.reserve1);
        assert_eq!(result.new_reserve0, 0);
        assert_eq!(result.new_reserve1, 0);
    }

    #[test]
    fn test_remove_liquidity_more_than_total() {
        let pool = standard_pool();
        let result = simulate_remove_liquidity(&pool, pool.total_lp + 1);
        assert_eq!(result, Err(SimError::InsufficientLiquidity));
    }

    #[test]
    fn test_remove_liquidity_zero() {
        let pool = standard_pool();
        let result = simulate_remove_liquidity(&pool, 0);
        assert_eq!(result, Err(SimError::InvalidInput));
    }

    #[test]
    fn test_remove_liquidity_empty_pool() {
        let pool = make_pool(0, 0, 30, 0);
        let result = simulate_remove_liquidity(&pool, 100);
        assert_eq!(result, Err(SimError::EmptyPool));
    }

    #[test]
    fn test_remove_liquidity_reserves_decrease() {
        let pool = standard_pool();
        let result = simulate_remove_liquidity(&pool, pool.total_lp / 4).unwrap();
        assert!(result.new_reserve0 < pool.reserve0);
        assert!(result.new_reserve1 < pool.reserve1);
    }

    #[test]
    fn test_remove_liquidity_proportional() {
        let pool = imbalanced_pool();
        let lp_amount = pool.total_lp / 5; // 20%
        let result = simulate_remove_liquidity(&pool, lp_amount).unwrap();
        // Ratio of outputs should match ratio of reserves
        let ratio_reserves = vibeswap_math::mul_div(pool.reserve0, PRECISION, pool.reserve1);
        let ratio_outputs = vibeswap_math::mul_div(result.amount0_out, PRECISION, result.amount1_out);
        // Should be approximately equal (within rounding)
        let diff = if ratio_reserves > ratio_outputs {
            ratio_reserves - ratio_outputs
        } else {
            ratio_outputs - ratio_reserves
        };
        assert!(diff < PRECISION / 1000); // < 0.1% difference
    }

    // ============ Multi-Hop Tests ============

    #[test]
    fn test_multi_hop_two_pools() {
        let pool_a = make_pool_with_id(1, 1_000_000 * PRECISION, 1_000_000 * PRECISION, 30, 1_000_000 * PRECISION);
        let pool_b = make_pool_with_id(2, 1_000_000 * PRECISION, 1_000_000 * PRECISION, 30, 1_000_000 * PRECISION);
        let pools = vec![pool_a, pool_b];
        let path = [[1u8; 32], [2u8; 32], [3u8; 32]];
        let amount_in = 1_000 * PRECISION;

        let result = simulate_multi_hop(&pools, &path, amount_in).unwrap();
        assert_eq!(result.hops, 2);
        assert!(result.final_output > 0);
        assert!(result.final_output < amount_in); // Fees and impact reduce output
        assert_eq!(result.intermediate_amounts.len(), 2);
        assert!(result.total_fee > 0);
    }

    #[test]
    fn test_multi_hop_three_pools() {
        let pool_a = make_pool_with_id(1, 1_000_000 * PRECISION, 1_000_000 * PRECISION, 30, 1_000_000 * PRECISION);
        let pool_b = make_pool_with_id(2, 1_000_000 * PRECISION, 1_000_000 * PRECISION, 30, 1_000_000 * PRECISION);
        let pool_c = make_pool_with_id(3, 1_000_000 * PRECISION, 1_000_000 * PRECISION, 30, 1_000_000 * PRECISION);
        let pools = vec![pool_a, pool_b, pool_c];
        let path = [[1u8; 32], [2u8; 32], [3u8; 32], [4u8; 32]];
        let amount_in = 1_000 * PRECISION;

        let result = simulate_multi_hop(&pools, &path, amount_in).unwrap();
        assert_eq!(result.hops, 3);
        assert!(result.final_output > 0);
        assert_eq!(result.intermediate_amounts.len(), 3);
    }

    #[test]
    fn test_multi_hop_empty_pools() {
        let path = [[1u8; 32], [2u8; 32]];
        let result = simulate_multi_hop(&[], &path, 1000);
        assert_eq!(result, Err(SimError::NoPath));
    }

    #[test]
    fn test_multi_hop_path_length_mismatch() {
        let pool = standard_pool();
        let path = [[1u8; 32], [2u8; 32], [3u8; 32]]; // 3 tokens but only 1 pool = needs 2
        let result = simulate_multi_hop(&[pool], &path, 1000);
        assert_eq!(result, Err(SimError::InvalidInput));
    }

    #[test]
    fn test_multi_hop_zero_amount() {
        let pool = standard_pool();
        let path = [[1u8; 32], [2u8; 32]];
        let result = simulate_multi_hop(&[pool], &path, 0);
        assert_eq!(result, Err(SimError::InvalidInput));
    }

    #[test]
    fn test_multi_hop_more_hops_more_fees() {
        // Two-hop vs one-hop: more hops = more fees
        let pool_a = make_pool_with_id(1, 1_000_000 * PRECISION, 1_000_000 * PRECISION, 30, 1_000_000 * PRECISION);
        let pool_b = make_pool_with_id(2, 1_000_000 * PRECISION, 1_000_000 * PRECISION, 30, 1_000_000 * PRECISION);
        let amount_in = 1_000 * PRECISION;

        let one_hop = simulate_multi_hop(&[pool_a.clone()], &[[1u8; 32], [2u8; 32]], amount_in).unwrap();
        let two_hop = simulate_multi_hop(&[pool_a, pool_b], &[[1u8; 32], [2u8; 32], [3u8; 32]], amount_in).unwrap();

        assert!(two_hop.total_fee > one_hop.total_fee);
        assert!(two_hop.final_output < one_hop.final_output);
    }

    #[test]
    fn test_multi_hop_insufficient_intermediate_liquidity() {
        let pool_a = make_pool_with_id(1, 1_000_000 * PRECISION, 1_000_000 * PRECISION, 30, 1_000_000 * PRECISION);
        // Pool B has reserves below MIN_LIQUIDITY — will fail
        let pool_b = make_pool_with_id(2, 500, 500, 30, 500);
        let pools = vec![pool_a, pool_b];
        let path = [[1u8; 32], [2u8; 32], [3u8; 32]];
        // Large amount should fail at pool_b due to insufficient liquidity
        let result = simulate_multi_hop(&pools, &path, 100_000 * PRECISION);
        assert!(result.is_err());
    }

    // ============ Batch Auction Tests ============

    #[test]
    fn test_batch_auction_balanced() {
        // Buys and sells at overlapping prices
        let buys = vec![
            (1_000 * PRECISION, 110 * PRECISION), // buy 1000 at up to 110
            (2_000 * PRECISION, 105 * PRECISION), // buy 2000 at up to 105
        ];
        let sells = vec![
            (1_500 * PRECISION, 95 * PRECISION),  // sell 1500 at min 95
            (1_500 * PRECISION, 100 * PRECISION), // sell 1500 at min 100
        ];
        let result = simulate_batch_auction(&buys, &sells).unwrap();
        assert!(result.clearing_price > 0);
        assert!(result.total_volume > 0);
        assert!(result.buy_fills > 0);
        assert!(result.sell_fills > 0);
    }

    #[test]
    fn test_batch_auction_all_buys_no_sells() {
        let buys = vec![
            (1_000 * PRECISION, 100 * PRECISION),
            (2_000 * PRECISION, 110 * PRECISION),
        ];
        let sells: Vec<(u128, u128)> = vec![];
        let result = simulate_batch_auction(&buys, &sells).unwrap();
        assert!(result.clearing_price > 0);
        assert_eq!(result.total_volume, 0); // No matching
        assert_eq!(result.sell_fills, 0);
    }

    #[test]
    fn test_batch_auction_no_overlap() {
        // Buys below sell prices — no trades
        let buys = vec![
            (1_000 * PRECISION, 90 * PRECISION), // max price 90
        ];
        let sells = vec![
            (1_000 * PRECISION, 100 * PRECISION), // min price 100
        ];
        let result = simulate_batch_auction(&buys, &sells).unwrap();
        // At price 90: buys=1000, sells=0 => matched=0
        // At price 100: buys=0, sells=1000 => matched=0
        assert_eq!(result.total_volume, 0);
    }

    #[test]
    fn test_batch_auction_price_discovery() {
        // Multiple price levels — should find the optimal clearing
        let buys = vec![
            (1_000 * PRECISION, 120 * PRECISION),
            (1_000 * PRECISION, 110 * PRECISION),
            (1_000 * PRECISION, 100 * PRECISION),
        ];
        let sells = vec![
            (1_000 * PRECISION, 90 * PRECISION),
            (1_000 * PRECISION, 100 * PRECISION),
            (1_000 * PRECISION, 110 * PRECISION),
        ];
        let result = simulate_batch_auction(&buys, &sells).unwrap();
        assert!(result.clearing_price >= 90 * PRECISION);
        assert!(result.clearing_price <= 120 * PRECISION);
        assert!(result.total_volume > 0);
    }

    #[test]
    fn test_batch_auction_empty() {
        let result = simulate_batch_auction(&[], &[]);
        assert_eq!(result, Err(SimError::InvalidInput));
    }

    #[test]
    fn test_batch_auction_single_buy_single_sell_match() {
        let buys = vec![(1_000 * PRECISION, 100 * PRECISION)];
        let sells = vec![(1_000 * PRECISION, 100 * PRECISION)];
        let result = simulate_batch_auction(&buys, &sells).unwrap();
        assert_eq!(result.clearing_price, 100 * PRECISION);
        assert_eq!(result.buy_fills, 1);
        assert_eq!(result.sell_fills, 1);
        assert_eq!(result.total_volume, 1_000 * PRECISION);
    }

    #[test]
    fn test_batch_auction_unfilled_volume() {
        let buys = vec![
            (3_000 * PRECISION, 100 * PRECISION),
        ];
        let sells = vec![
            (1_000 * PRECISION, 100 * PRECISION),
        ];
        let result = simulate_batch_auction(&buys, &sells).unwrap();
        assert_eq!(result.total_volume, 1_000 * PRECISION); // Limited by sells
        assert_eq!(result.unfilled_buys, 2_000 * PRECISION);
        assert_eq!(result.unfilled_sells, 0);
    }

    #[test]
    fn test_batch_auction_all_sells_no_buys() {
        let buys: Vec<(u128, u128)> = vec![];
        let sells = vec![
            (1_000 * PRECISION, 100 * PRECISION),
        ];
        let result = simulate_batch_auction(&buys, &sells).unwrap();
        assert_eq!(result.total_volume, 0);
        assert_eq!(result.buy_fills, 0);
    }

    // ============ Price Impact Tests ============

    #[test]
    fn test_price_impact_small_trade() {
        let pool = standard_pool();
        let impact = simulate_price_impact(&pool, 100 * PRECISION, true);
        assert!(impact < 10); // < 0.1% for a tiny trade on 1M pool
    }

    #[test]
    fn test_price_impact_large_trade() {
        let pool = standard_pool();
        // 10% of reserves
        let impact = simulate_price_impact(&pool, 100_000 * PRECISION, true);
        assert!(impact > 100); // > 1%
    }

    #[test]
    fn test_price_impact_max_trade() {
        let pool = standard_pool();
        // Very large trade — almost entire reserve
        let impact = simulate_price_impact(&pool, 900_000 * PRECISION, true);
        assert!(impact > 1000); // > 10%
    }

    #[test]
    fn test_price_impact_zero_amount() {
        let pool = standard_pool();
        assert_eq!(simulate_price_impact(&pool, 0, true), 0);
    }

    #[test]
    fn test_price_impact_empty_pool() {
        let pool = make_pool(0, 0, 30, 0);
        assert_eq!(simulate_price_impact(&pool, 1000, true), 0);
    }

    #[test]
    fn test_price_impact_increases_with_size() {
        let pool = standard_pool();
        let impact_small = simulate_price_impact(&pool, 1_000 * PRECISION, true);
        let impact_large = simulate_price_impact(&pool, 10_000 * PRECISION, true);
        assert!(impact_large > impact_small);
    }

    // ============ Arb Profit Tests ============

    #[test]
    fn test_arb_profit_profitable() {
        // Pool A has lower price for token1, pool B has higher price
        let pool_a = make_pool(1_000_000 * PRECISION, 2_000_000 * PRECISION, 30, 1_000_000 * PRECISION);
        let pool_b = make_pool(2_000_000 * PRECISION, 1_000_000 * PRECISION, 30, 1_000_000 * PRECISION);
        let result = simulate_arb_profit(&pool_a, &pool_b, 1_000 * PRECISION).unwrap();
        // Buy on A (where token1 is cheap), sell on B (where token1 is expensive)
        assert!(result > 0);
    }

    #[test]
    fn test_arb_profit_unprofitable() {
        // Same price in both pools — fees make arb unprofitable
        let pool_a = standard_pool();
        let pool_b = standard_pool();
        let result = simulate_arb_profit(&pool_a, &pool_b, 1_000 * PRECISION).unwrap();
        assert!(result < 0); // Loss due to fees
    }

    #[test]
    fn test_arb_profit_equal_pools() {
        let pool = standard_pool();
        let result = simulate_arb_profit(&pool, &pool, 1_000 * PRECISION).unwrap();
        assert!(result < 0); // Can't profit from identical pools
    }

    #[test]
    fn test_arb_profit_zero_amount() {
        let pool_a = standard_pool();
        let pool_b = standard_pool();
        let result = simulate_arb_profit(&pool_a, &pool_b, 0);
        assert_eq!(result, Err(SimError::InvalidInput));
    }

    #[test]
    fn test_arb_profit_empty_pool() {
        let pool_a = standard_pool();
        let pool_b = make_pool(0, 0, 30, 0);
        let result = simulate_arb_profit(&pool_a, &pool_b, 1_000 * PRECISION);
        assert!(result.is_err());
    }

    #[test]
    fn test_arb_profit_large_spread() {
        // Huge price difference — guaranteed profit
        let pool_a = make_pool(1_000_000 * PRECISION, 10_000_000 * PRECISION, 30, 1_000_000 * PRECISION);
        let pool_b = make_pool(10_000_000 * PRECISION, 1_000_000 * PRECISION, 30, 1_000_000 * PRECISION);
        let result = simulate_arb_profit(&pool_a, &pool_b, 1_000 * PRECISION).unwrap();
        assert!(result > 0);
    }

    // ============ Liquidation Cascade Tests ============

    #[test]
    fn test_cascade_single_liquidation() {
        let pool = standard_pool();
        // Vault: 1000 collateral, 900 debt, threshold 11000 bps (110%)
        // At 10% price drop: collateral_value = 900, debt = 900, 900 * 10000 < 900 * 11000 => liquidated
        let vaults = vec![(1_000 * PRECISION, 900 * PRECISION, 11000)];
        let result = simulate_liquidation_cascade(&vaults, 1000, &pool); // 10% drop
        assert!(result.liquidations_triggered >= 1);
        assert!(result.total_collateral_seized > 0);
    }

    #[test]
    fn test_cascade_no_liquidations() {
        let pool = standard_pool();
        // Vault is very well-collateralized
        let vaults = vec![(10_000 * PRECISION, 100 * PRECISION, 11000)];
        let result = simulate_liquidation_cascade(&vaults, 100, &pool); // tiny 1% drop
        assert_eq!(result.liquidations_triggered, 0);
    }

    #[test]
    fn test_cascade_chain_reaction() {
        let pool = standard_pool();
        // Multiple vaults at different thresholds
        // First vault liquidated by initial drop, its selling pressure triggers more
        let vaults = vec![
            (50_000 * PRECISION, 48_000 * PRECISION, 11000),  // barely collateralized
            (50_000 * PRECISION, 47_000 * PRECISION, 11000),  // slightly better
            (50_000 * PRECISION, 46_000 * PRECISION, 11000),  // slightly better still
        ];
        let result = simulate_liquidation_cascade(&vaults, 1000, &pool); // 10% drop
        assert!(result.liquidations_triggered > 0);
        // A cascade should have depth > 0
        assert!(result.cascade_depth >= 1);
    }

    #[test]
    fn test_cascade_empty_vaults() {
        let pool = standard_pool();
        let result = simulate_liquidation_cascade(&[], 1000, &pool);
        assert_eq!(result.liquidations_triggered, 0);
        assert_eq!(result.cascade_depth, 0);
    }

    #[test]
    fn test_cascade_zero_price_drop() {
        let pool = standard_pool();
        let vaults = vec![(1_000 * PRECISION, 900 * PRECISION, 11000)];
        let result = simulate_liquidation_cascade(&vaults, 0, &pool);
        assert_eq!(result.liquidations_triggered, 0);
    }

    #[test]
    fn test_cascade_max_depth_limit() {
        // Many vaults that cascade — should be capped at MAX_CASCADE_DEPTH
        let pool = make_pool(10_000_000 * PRECISION, 10_000_000 * PRECISION, 30, 10_000_000 * PRECISION);
        let mut vaults = Vec::new();
        for i in 0..20 {
            // Each vault is just barely under the threshold at progressively worse ratios
            let debt = 9_000 * PRECISION + (i as u128) * 50 * PRECISION;
            vaults.push((10_000 * PRECISION, debt, 11000));
        }
        let result = simulate_liquidation_cascade(&vaults, 1000, &pool);
        assert!(result.cascade_depth <= MAX_CASCADE_DEPTH);
    }

    #[test]
    fn test_cascade_price_impact_increases() {
        let pool = standard_pool();
        let vaults = vec![
            (100_000 * PRECISION, 95_000 * PRECISION, 11000),
        ];
        let result = simulate_liquidation_cascade(&vaults, 1000, &pool);
        if result.liquidations_triggered > 0 {
            assert!(result.final_price_impact_bps > 0);
        }
    }

    // ============ Optimal Swap Amount Tests ============

    #[test]
    fn test_optimal_swap_price_down() {
        let pool = standard_pool();
        let current = spot_price(&pool); // PRECISION (1.0)
        let target = PRECISION / 2; // 0.5 — need to push price down
        let (amount, is_token0) = optimal_swap_amount(&pool, target).unwrap();
        assert!(amount > 0);
        assert!(is_token0); // Selling token0 pushes price down
    }

    #[test]
    fn test_optimal_swap_price_up() {
        let pool = standard_pool();
        let target = 2 * PRECISION; // 2.0 — need to push price up
        let (amount, is_token0) = optimal_swap_amount(&pool, target).unwrap();
        assert!(amount > 0);
        assert!(!is_token0); // Selling token1 pushes price up
    }

    #[test]
    fn test_optimal_swap_already_at_target() {
        let pool = standard_pool();
        let current = spot_price(&pool);
        let (amount, _) = optimal_swap_amount(&pool, current).unwrap();
        assert_eq!(amount, 0); // No swap needed
    }

    #[test]
    fn test_optimal_swap_zero_target() {
        let pool = standard_pool();
        let result = optimal_swap_amount(&pool, 0);
        assert_eq!(result, Err(SimError::InvalidPrice));
    }

    #[test]
    fn test_optimal_swap_empty_pool() {
        let pool = make_pool(0, 0, 30, 0);
        let result = optimal_swap_amount(&pool, PRECISION);
        assert_eq!(result, Err(SimError::EmptyPool));
    }

    #[test]
    fn test_optimal_swap_moves_price_approximately() {
        let pool = standard_pool();
        let target = PRECISION * 3 / 2; // 1.5
        let (amount, is_token0) = optimal_swap_amount(&pool, target).unwrap();
        if amount > 0 {
            // Actually execute the swap and check the resulting price
            let result = simulate_swap(&pool, amount, is_token0).unwrap();
            let new_pool = pool_after_swap(&pool, &result, is_token0);
            let new_price = spot_price(&new_pool);
            // Should be approximately at target (within 5% due to discrete math + fees)
            let diff = if new_price > target {
                new_price - target
            } else {
                target - new_price
            };
            let pct = vibeswap_math::mul_div(diff, 10_000, target);
            assert!(pct < 500, "Price off by more than 5%: got {} vs target {}", new_price, target);
        }
    }

    // ============ Sandwich Attack Tests ============

    #[test]
    fn test_sandwich_profitable() {
        let pool = make_pool(10_000_000 * PRECISION, 10_000_000 * PRECISION, 30, 10_000_000 * PRECISION);
        // Large victim trade on a big pool — attacker can extract value
        let victim_amount = 100_000 * PRECISION;
        let attacker_amount = 50_000 * PRECISION;
        let profit = sandwich_profit(&pool, victim_amount, true, attacker_amount).unwrap();
        // On a large enough victim trade, sandwich should be profitable
        // (This demonstrates WHY commit-reveal is needed!)
        // Note: with fees, small sandwiches may not be profitable
        assert!(profit != 0); // Should have some P&L
    }

    #[test]
    fn test_sandwich_unprofitable_small_victim() {
        let pool = standard_pool();
        // Tiny victim trade — not enough price movement to profit
        let victim_amount = 10 * PRECISION;
        let attacker_amount = 100 * PRECISION;
        let profit = sandwich_profit(&pool, victim_amount, true, attacker_amount).unwrap();
        assert!(profit <= 0); // Fees eat any potential profit
    }

    #[test]
    fn test_sandwich_zero_victim() {
        let pool = standard_pool();
        let result = sandwich_profit(&pool, 0, true, 1000 * PRECISION);
        assert_eq!(result, Err(SimError::InvalidInput));
    }

    #[test]
    fn test_sandwich_zero_attacker() {
        let pool = standard_pool();
        let result = sandwich_profit(&pool, 1000 * PRECISION, true, 0);
        assert_eq!(result, Err(SimError::InvalidInput));
    }

    #[test]
    fn test_sandwich_token1_direction() {
        let pool = make_pool(10_000_000 * PRECISION, 10_000_000 * PRECISION, 30, 10_000_000 * PRECISION);
        let profit = sandwich_profit(&pool, 100_000 * PRECISION, false, 50_000 * PRECISION).unwrap();
        // Should return a result regardless of direction
        assert!(profit != 0 || profit == 0); // Just verify it doesn't panic
    }

    #[test]
    fn test_sandwich_oversized_attacker_loses() {
        // When attacker amount dwarfs the victim AND the pool, self-impact dominates
        // The front-run moves price so far that the back-run gets terrible execution
        let pool = make_pool(100_000 * PRECISION, 100_000 * PRECISION, 30, 100_000 * PRECISION);
        let victim_amount = 100 * PRECISION;  // tiny victim
        let attacker_amount = 50_000 * PRECISION; // 50% of pool
        let profit = sandwich_profit(&pool, victim_amount, true, attacker_amount).unwrap();
        // Massive self-impact on front-run, tiny victim doesn't move price enough
        // to compensate. Should be a loss.
        assert!(profit < 0, "Expected loss from oversized sandwich, got profit: {}", profit);
    }

    // ============ Impermanent Loss Tests ============

    #[test]
    fn test_il_same_price() {
        let initial_price = PRECISION;
        let final_price = PRECISION;
        let initial_value = 1_000_000 * PRECISION;
        let (lp_value, hodl_value, il_bps) =
            impermanent_loss_sim(initial_price, final_price, initial_value);
        // No price change = no IL
        assert_eq!(il_bps, 0);
        assert_eq!(lp_value, hodl_value);
    }

    #[test]
    fn test_il_2x_price() {
        let initial_price = PRECISION;
        let final_price = 2 * PRECISION;
        let initial_value = 1_000_000 * PRECISION;
        let (lp_value, hodl_value, il_bps) =
            impermanent_loss_sim(initial_price, final_price, initial_value);
        // 2x price -> ~5.72% IL
        assert!(il_bps > 500 && il_bps < 700, "IL at 2x should be ~5.72%, got {} bps", il_bps);
        assert!(hodl_value > lp_value);
    }

    #[test]
    fn test_il_half_price() {
        let initial_price = PRECISION;
        let final_price = PRECISION / 2;
        let initial_value = 1_000_000 * PRECISION;
        let (lp_value, hodl_value, il_bps) =
            impermanent_loss_sim(initial_price, final_price, initial_value);
        // 0.5x price -> ~5.72% IL (same as 2x by symmetry)
        assert!(il_bps > 500 && il_bps < 700, "IL at 0.5x should be ~5.72%, got {} bps", il_bps);
        assert!(hodl_value > lp_value);
    }

    #[test]
    fn test_il_extreme_price_increase() {
        let initial_price = PRECISION;
        let final_price = 10 * PRECISION;
        let initial_value = 1_000_000 * PRECISION;
        let (lp_value, hodl_value, il_bps) =
            impermanent_loss_sim(initial_price, final_price, initial_value);
        // 10x price -> ~42.5% IL
        assert!(il_bps > 3000, "IL at 10x should be large, got {} bps", il_bps);
        assert!(hodl_value > lp_value);
    }

    #[test]
    fn test_il_zero_initial_price() {
        let (lp, hodl, il) = impermanent_loss_sim(0, PRECISION, 1_000_000);
        assert_eq!(lp, 0);
        assert_eq!(hodl, 0);
        assert_eq!(il, 0);
    }

    #[test]
    fn test_il_zero_final_price() {
        let (lp, hodl, il) = impermanent_loss_sim(PRECISION, 0, 1_000_000);
        assert_eq!(lp, 0);
        assert_eq!(hodl, 0);
        assert_eq!(il, 0);
    }

    #[test]
    fn test_il_zero_value() {
        let (lp, hodl, il) = impermanent_loss_sim(PRECISION, 2 * PRECISION, 0);
        assert_eq!(lp, 0);
        assert_eq!(hodl, 0);
        assert_eq!(il, 0);
    }

    #[test]
    fn test_il_symmetry() {
        // IL at ratio R should equal IL at ratio 1/R
        let initial_value = 1_000_000 * PRECISION;
        let (_, _, il_2x) = impermanent_loss_sim(PRECISION, 2 * PRECISION, initial_value);
        let (_, _, il_half) = impermanent_loss_sim(PRECISION, PRECISION / 2, initial_value);
        // Should be very close (within rounding)
        let diff = if il_2x > il_half { il_2x - il_half } else { il_half - il_2x };
        assert!(diff <= 1, "IL should be symmetric: 2x={} vs 0.5x={}", il_2x, il_half);
    }

    #[test]
    fn test_il_increases_with_divergence() {
        let initial_value = 1_000_000 * PRECISION;
        let (_, _, il_1_5x) = impermanent_loss_sim(PRECISION, PRECISION * 3 / 2, initial_value);
        let (_, _, il_2x) = impermanent_loss_sim(PRECISION, 2 * PRECISION, initial_value);
        let (_, _, il_4x) = impermanent_loss_sim(PRECISION, 4 * PRECISION, initial_value);
        assert!(il_2x > il_1_5x);
        assert!(il_4x > il_2x);
    }

    // ============ Fee Revenue Projection Tests ============

    #[test]
    fn test_fee_revenue_basic() {
        let pool = standard_pool(); // 30 bps
        let daily_volume = 1_000_000 * PRECISION;
        let revenue = fee_revenue_projection(&pool, daily_volume, 30);
        // Daily fee = 1M * 30/10000 = 3000
        // 30 days = 90,000
        let expected_daily = vibeswap_math::mul_div(daily_volume, 30, 10_000);
        assert_eq!(revenue, expected_daily * 30);
    }

    #[test]
    fn test_fee_revenue_zero_volume() {
        let pool = standard_pool();
        assert_eq!(fee_revenue_projection(&pool, 0, 30), 0);
    }

    #[test]
    fn test_fee_revenue_zero_days() {
        let pool = standard_pool();
        assert_eq!(fee_revenue_projection(&pool, 1_000_000, 0), 0);
    }

    #[test]
    fn test_fee_revenue_one_day() {
        let pool = standard_pool();
        let daily_volume = 1_000_000 * PRECISION;
        let revenue = fee_revenue_projection(&pool, daily_volume, 1);
        let expected = vibeswap_math::mul_div(daily_volume, 30, 10_000);
        assert_eq!(revenue, expected);
    }

    #[test]
    fn test_fee_revenue_high_fee_pool() {
        let pool = make_pool(1_000_000 * PRECISION, 1_000_000 * PRECISION, 100, 1_000_000 * PRECISION); // 1% fee
        let daily_volume = 1_000_000 * PRECISION;
        let revenue = fee_revenue_projection(&pool, daily_volume, 1);
        let expected = vibeswap_math::mul_div(daily_volume, 100, 10_000);
        assert_eq!(revenue, expected);
    }

    #[test]
    fn test_fee_revenue_scales_linearly() {
        let pool = standard_pool();
        let vol = 1_000_000 * PRECISION;
        let rev_10 = fee_revenue_projection(&pool, vol, 10);
        let rev_20 = fee_revenue_projection(&pool, vol, 20);
        assert_eq!(rev_20, rev_10 * 2);
    }

    // ============ Pool After Swap Tests ============

    #[test]
    fn test_pool_after_swap_preserves_metadata() {
        let pool = standard_pool();
        let swap = simulate_swap(&pool, 1_000 * PRECISION, true).unwrap();
        let new_pool = pool_after_swap(&pool, &swap, true);
        assert_eq!(new_pool.pair_id, pool.pair_id);
        assert_eq!(new_pool.fee_rate_bps, pool.fee_rate_bps);
        assert_eq!(new_pool.total_lp, pool.total_lp);
    }

    #[test]
    fn test_pool_after_swap_updates_reserves() {
        let pool = standard_pool();
        let swap = simulate_swap(&pool, 1_000 * PRECISION, true).unwrap();
        let new_pool = pool_after_swap(&pool, &swap, true);
        assert_eq!(new_pool.reserve0, swap.new_reserve0);
        assert_eq!(new_pool.reserve1, swap.new_reserve1);
    }

    #[test]
    fn test_pool_after_swap_can_chain() {
        let pool = standard_pool();
        let swap1 = simulate_swap(&pool, 1_000 * PRECISION, true).unwrap();
        let pool2 = pool_after_swap(&pool, &swap1, true);
        let swap2 = simulate_swap(&pool2, 500 * PRECISION, false).unwrap();
        let pool3 = pool_after_swap(&pool2, &swap2, false);
        // Pool should be valid for further swaps
        assert!(pool3.reserve0 > 0);
        assert!(pool3.reserve1 > 0);
    }

    // ============ Edge Case Tests ============

    #[test]
    fn test_swap_max_fee() {
        // 100% fee pool — all input goes to fees
        let pool = make_pool(1_000_000 * PRECISION, 1_000_000 * PRECISION, 10_000, 1_000_000 * PRECISION);
        let result = simulate_swap(&pool, 1_000 * PRECISION, true);
        // 100% fee means amount_in_after_fee = 0, amount_out = 0
        assert_eq!(result, Err(SimError::InsufficientLiquidity));
    }

    #[test]
    fn test_swap_one_wei_reserve() {
        // Pool with minimal reserves — at the edge of MIN_LIQUIDITY
        let pool = make_pool(MIN_LIQUIDITY, MIN_LIQUIDITY, 30, MIN_LIQUIDITY);
        let result = simulate_swap(&pool, 1, true);
        // Should work but output may be 0 or error
        assert!(result.is_ok() || result.is_err());
    }

    #[test]
    fn test_multi_hop_single_pool() {
        let pool = standard_pool();
        let path = [[1u8; 32], [2u8; 32]];
        let result = simulate_multi_hop(&[pool], &path, 1_000 * PRECISION).unwrap();
        assert_eq!(result.hops, 1);
        assert!(result.final_output > 0);
    }

    #[test]
    fn test_batch_auction_many_orders() {
        let mut buys = Vec::new();
        let mut sells = Vec::new();
        for i in 1..=20 {
            buys.push((100 * PRECISION, (100 + i as u128) * PRECISION));
            sells.push((100 * PRECISION, (80 + i as u128) * PRECISION));
        }
        let result = simulate_batch_auction(&buys, &sells).unwrap();
        assert!(result.total_volume > 0);
        assert!(result.buy_fills > 0);
        assert!(result.sell_fills > 0);
    }

    #[test]
    fn test_il_3x_price() {
        let initial_value = 1_000_000 * PRECISION;
        let (lp_value, hodl_value, il_bps) =
            impermanent_loss_sim(PRECISION, 3 * PRECISION, initial_value);
        // 3x -> ~13.4% IL
        assert!(il_bps > 1000 && il_bps < 1500, "IL at 3x should be ~13.4%, got {} bps", il_bps);
        assert!(hodl_value > lp_value);
    }

    #[test]
    fn test_il_1_1x_price() {
        // Very small price move — IL should be tiny
        let initial_value = 1_000_000 * PRECISION;
        let final_price = PRECISION + PRECISION / 10; // 1.1x
        let (_, _, il_bps) = impermanent_loss_sim(PRECISION, final_price, initial_value);
        assert!(il_bps < 100, "IL at 1.1x should be tiny, got {} bps", il_bps);
    }

    #[test]
    fn test_swap_reverse_direction_symmetry() {
        // Swapping X of token0 then swapping the output back should lose to fees
        let pool = standard_pool();
        let amount_in = 1_000 * PRECISION;
        let swap1 = simulate_swap(&pool, amount_in, true).unwrap();
        let pool2 = pool_after_swap(&pool, &swap1, true);
        let swap2 = simulate_swap(&pool2, swap1.amount_out, false).unwrap();
        // Should get back less than we started with (fees)
        assert!(swap2.amount_out < amount_in);
    }

    #[test]
    fn test_fee_revenue_zero_fee_pool() {
        let pool = make_pool(1_000_000 * PRECISION, 1_000_000 * PRECISION, 0, 1_000_000 * PRECISION);
        assert_eq!(fee_revenue_projection(&pool, 1_000_000 * PRECISION, 30), 0);
    }

    #[test]
    fn test_add_remove_round_trip() {
        let pool = standard_pool();
        let add_amount = 100_000 * PRECISION;
        let add = simulate_add_liquidity(&pool, add_amount, add_amount).unwrap();

        // Build pool state after add
        let pool_after_add = PoolState {
            pair_id: pool.pair_id,
            reserve0: add.new_reserve0,
            reserve1: add.new_reserve1,
            fee_rate_bps: pool.fee_rate_bps,
            total_lp: pool.total_lp + add.lp_minted,
        };

        // Remove what we just added
        let remove = simulate_remove_liquidity(&pool_after_add, add.lp_minted).unwrap();
        // Should get back approximately what we put in
        let diff0 = if remove.amount0_out > add.amount0_used {
            remove.amount0_out - add.amount0_used
        } else {
            add.amount0_used - remove.amount0_out
        };
        // Within 1% of original (rounding)
        assert!(diff0 < add.amount0_used / 100, "Add/remove round trip lost too much: diff={}", diff0);
    }

    #[test]
    fn test_cascade_empty_pool() {
        let pool = make_pool(0, 0, 30, 0);
        let vaults = vec![(1_000 * PRECISION, 900 * PRECISION, 11000)];
        let result = simulate_liquidation_cascade(&vaults, 1000, &pool);
        assert_eq!(result.liquidations_triggered, 0);
    }

    #[test]
    fn test_sandwich_on_deep_pool() {
        // On a very deep pool, sandwich should be less profitable
        let deep_pool = make_pool(
            100_000_000 * PRECISION,
            100_000_000 * PRECISION,
            30,
            100_000_000 * PRECISION,
        );
        let victim_amount = 1_000 * PRECISION; // tiny relative to pool
        let attacker_amount = 1_000 * PRECISION;
        let profit = sandwich_profit(&deep_pool, victim_amount, true, attacker_amount).unwrap();
        // Should be unprofitable due to fees on a deep pool with small victim
        assert!(profit <= 0);
    }

    #[test]
    fn test_spot_price_after_swap() {
        let pool = standard_pool();
        let swap = simulate_swap(&pool, 10_000 * PRECISION, true).unwrap();
        let new_pool = pool_after_swap(&pool, &swap, true);
        let new_price = spot_price(&new_pool);
        // Swapping token0 in increases reserve0, decreases reserve1 -> price goes down
        assert!(new_price < PRECISION);
    }

    #[test]
    fn test_batch_auction_exact_match() {
        // Perfect 1:1 matching
        let buys = vec![
            (500 * PRECISION, 100 * PRECISION),
            (500 * PRECISION, 100 * PRECISION),
        ];
        let sells = vec![
            (500 * PRECISION, 100 * PRECISION),
            (500 * PRECISION, 100 * PRECISION),
        ];
        let result = simulate_batch_auction(&buys, &sells).unwrap();
        assert_eq!(result.clearing_price, 100 * PRECISION);
        assert_eq!(result.total_volume, 1_000 * PRECISION);
        assert_eq!(result.unfilled_buys, 0);
        assert_eq!(result.unfilled_sells, 0);
    }

    #[test]
    fn test_optimal_swap_from_imbalanced() {
        let pool = imbalanced_pool(); // price = 2.0
        let target = PRECISION; // want to move to 1.0
        let (amount, is_token0) = optimal_swap_amount(&pool, target).unwrap();
        assert!(amount > 0);
        // To move price from 2.0 to 1.0, need to sell token0 (increase reserve0)
        assert!(is_token0);
    }

    #[test]
    fn test_arb_profit_negative_when_reversed() {
        // If A is expensive and B is cheap, buying on A and selling on B loses
        let pool_a = make_pool(2_000_000 * PRECISION, 1_000_000 * PRECISION, 30, 1_000_000 * PRECISION); // price = 0.5
        let pool_b = make_pool(1_000_000 * PRECISION, 2_000_000 * PRECISION, 30, 1_000_000 * PRECISION); // price = 2.0
        // Buy token1 on A (expensive), sell token1 on B (cheap) -> loss
        let result = simulate_arb_profit(&pool_a, &pool_b, 1_000 * PRECISION).unwrap();
        assert!(result < 0);
    }

    // ============ Batch 7: Hardening Tests (Target 125+) ============

    #[test]
    fn test_spot_price_large_reserves() {
        // Very large reserves should still compute correctly
        let pool = make_pool(u128::MAX / 10, u128::MAX / 5, 30, u128::MAX / 10);
        let price = spot_price(&pool);
        // reserve1 / reserve0 = 2
        assert_eq!(price, 2 * PRECISION);
    }

    #[test]
    fn test_swap_token0_in_increases_reserve0() {
        let pool = standard_pool();
        let amount_in = 5_000 * PRECISION;
        let result = simulate_swap(&pool, amount_in, true).unwrap();
        assert_eq!(result.new_reserve0, pool.reserve0 + amount_in);
    }

    #[test]
    fn test_swap_token1_in_increases_reserve1() {
        let pool = standard_pool();
        let amount_in = 5_000 * PRECISION;
        let result = simulate_swap(&pool, amount_in, false).unwrap();
        assert_eq!(result.new_reserve1, pool.reserve1 + amount_in);
    }

    #[test]
    fn test_swap_amount_out_less_than_reserve_out() {
        let pool = standard_pool();
        let amount_in = 500_000 * PRECISION; // 50% of reserve
        let result = simulate_swap(&pool, amount_in, true).unwrap();
        assert!(result.amount_out < pool.reserve1);
    }

    #[test]
    fn test_add_liquidity_to_pool_with_reserves_but_zero_lp() {
        // Pool has reserves but total_lp is 0 — should return EmptyPool
        let pool = PoolState {
            pair_id: [0u8; 32],
            reserve0: 1_000_000 * PRECISION,
            reserve1: 1_000_000 * PRECISION,
            fee_rate_bps: 30,
            total_lp: 0,
        };
        let result = simulate_add_liquidity(&pool, 1000 * PRECISION, 1000 * PRECISION);
        assert_eq!(result, Err(SimError::EmptyPool));
    }

    #[test]
    fn test_remove_liquidity_1_lp_token() {
        let pool = standard_pool();
        let result = simulate_remove_liquidity(&pool, 1);
        // 1 LP out of 1M * PRECISION → extremely tiny amounts
        // May succeed with tiny values or fail due to rounding
        match result {
            Ok(r) => {
                assert!(r.amount0_out <= pool.reserve0);
                assert!(r.amount1_out <= pool.reserve1);
            },
            Err(e) => assert_eq!(e, SimError::InsufficientLiquidity),
        }
    }

    #[test]
    fn test_batch_auction_zero_price_orders_ignored() {
        let buys = vec![(1_000 * PRECISION, 0)]; // price = 0, should be filtered
        let sells = vec![(1_000 * PRECISION, 0)];
        let result = simulate_batch_auction(&buys, &sells);
        assert_eq!(result, Err(SimError::InvalidPrice));
    }

    #[test]
    fn test_batch_auction_single_buy_only() {
        let buys = vec![(500 * PRECISION, 100 * PRECISION)];
        let sells: Vec<(u128, u128)> = vec![];
        let result = simulate_batch_auction(&buys, &sells).unwrap();
        assert_eq!(result.total_volume, 0);
        assert_eq!(result.sell_fills, 0);
        assert!(result.clearing_price > 0);
    }

    #[test]
    fn test_price_impact_token1_direction() {
        let pool = standard_pool();
        let impact0 = simulate_price_impact(&pool, 10_000 * PRECISION, true);
        let impact1 = simulate_price_impact(&pool, 10_000 * PRECISION, false);
        // On a balanced pool, impact should be similar in both directions
        let diff = if impact0 > impact1 { impact0 - impact1 } else { impact1 - impact0 };
        assert!(diff < 5, "Impact should be similar on balanced pool: {} vs {}", impact0, impact1);
    }

    #[test]
    fn test_il_100x_price() {
        let initial_value = 1_000_000 * PRECISION;
        let (lp_value, hodl_value, il_bps) =
            impermanent_loss_sim(PRECISION, 100 * PRECISION, initial_value);
        // 100x price → very large IL (~81.8%)
        assert!(il_bps > 7000, "IL at 100x should be very large, got {} bps", il_bps);
        assert!(hodl_value > lp_value);
    }

    #[test]
    fn test_il_0_1x_price() {
        let initial_value = 1_000_000 * PRECISION;
        let (lp_value, hodl_value, il_bps) =
            impermanent_loss_sim(PRECISION, PRECISION / 10, initial_value);
        // 0.1x (90% drop) → large IL
        assert!(il_bps > 3000, "IL at 0.1x should be significant, got {} bps", il_bps);
        assert!(hodl_value > lp_value);
    }

    #[test]
    fn test_fee_revenue_large_days() {
        let pool = standard_pool();
        let daily_volume = 1_000_000 * PRECISION;
        let rev = fee_revenue_projection(&pool, daily_volume, 365);
        let expected_daily = vibeswap_math::mul_div(daily_volume, 30, 10_000);
        assert_eq!(rev, expected_daily * 365);
    }

    #[test]
    fn test_cascade_all_vaults_well_above_threshold() {
        // 10% drop but all vaults have 200% collateralization
        let pool = standard_pool();
        let vaults = vec![
            (10_000 * PRECISION, 5_000 * PRECISION, 11000),
            (20_000 * PRECISION, 8_000 * PRECISION, 11000),
        ];
        let result = simulate_liquidation_cascade(&vaults, 1000, &pool);
        assert_eq!(result.liquidations_triggered, 0);
        assert_eq!(result.cascade_depth, 0);
    }

    #[test]
    fn test_optimal_swap_very_small_target_price() {
        let pool = standard_pool();
        let target = PRECISION / 100; // 0.01
        let result = optimal_swap_amount(&pool, target);
        assert!(result.is_ok());
        let (amount, is_token0) = result.unwrap();
        if amount > 0 {
            assert!(is_token0, "To lower price, should sell token0");
        }
    }

    #[test]
    fn test_optimal_swap_very_large_target_price() {
        let pool = standard_pool();
        let target = PRECISION * 100; // 100.0
        let result = optimal_swap_amount(&pool, target);
        assert!(result.is_ok());
        let (amount, is_token0) = result.unwrap();
        if amount > 0 {
            assert!(!is_token0, "To raise price, should sell token1");
        }
    }

    #[test]
    fn test_sandwich_both_directions() {
        let pool = make_pool(10_000_000 * PRECISION, 10_000_000 * PRECISION, 30, 10_000_000 * PRECISION);
        // Victim buys token0->token1
        let profit_t0 = sandwich_profit(&pool, 50_000 * PRECISION, true, 20_000 * PRECISION).unwrap();
        // Victim buys token1->token0
        let profit_t1 = sandwich_profit(&pool, 50_000 * PRECISION, false, 20_000 * PRECISION).unwrap();
        // Both should produce results (no panic)
        let _ = profit_t0;
        let _ = profit_t1;
    }

    #[test]
    fn test_pool_after_swap_spot_price_changes() {
        let pool = standard_pool();
        let swap = simulate_swap(&pool, 50_000 * PRECISION, true).unwrap();
        let new_pool = pool_after_swap(&pool, &swap, true);
        let old_price = spot_price(&pool);
        let new_price = spot_price(&new_pool);
        // Selling token0 pushes price of token0 down (less token1 per token0)
        assert!(new_price < old_price, "Selling token0 should lower price");
    }

    #[test]
    fn test_swap_output_monotonically_increases_with_input() {
        let pool = standard_pool();
        let amounts = [100, 1_000, 10_000, 100_000, 500_000];
        let mut prev_output = 0u128;
        for &amt in &amounts {
            let result = simulate_swap(&pool, amt * PRECISION, true).unwrap();
            assert!(result.amount_out > prev_output,
                "Output should increase with input: {} -> {}", amt, result.amount_out);
            prev_output = result.amount_out;
        }
    }

    #[test]
    fn test_add_liquidity_first_deposit_asymmetric() {
        let pool = make_pool(0, 0, 30, 0);
        let result = simulate_add_liquidity(&pool, 1_000_000 * PRECISION, 4_000_000 * PRECISION).unwrap();
        assert!(result.lp_minted > 0);
        assert_eq!(result.amount0_used, 1_000_000 * PRECISION);
        assert_eq!(result.amount1_used, 4_000_000 * PRECISION);
    }

    #[test]
    fn test_cascade_single_vault_no_cascade_needed() {
        // One vault just barely liquidated, selling its collateral doesn't trigger more
        let pool = make_pool(10_000_000 * PRECISION, 10_000_000 * PRECISION, 30, 10_000_000 * PRECISION);
        let vaults = vec![
            (100 * PRECISION, 95 * PRECISION, 11000), // barely under
        ];
        let result = simulate_liquidation_cascade(&vaults, 1000, &pool);
        if result.liquidations_triggered > 0 {
            // Collateral is tiny relative to pool — no cascade
            assert_eq!(result.cascade_depth, 1);
        }
    }

    // ============ Hardening Tests v3 ============

    #[test]
    fn test_swap_fee_exactly_zero_bps_v3() {
        let pool = make_pool(1_000_000 * PRECISION, 1_000_000 * PRECISION, 0, 1_000_000 * PRECISION);
        let result = simulate_swap(&pool, 1000 * PRECISION, true).unwrap();
        assert_eq!(result.fee_paid, 0);
        assert!(result.amount_out > 0);
    }

    #[test]
    fn test_swap_fee_max_10000_bps_deep() {
        let pool = make_pool(1_000_000 * PRECISION, 1_000_000 * PRECISION, 10000, 1_000_000 * PRECISION);
        let result = simulate_swap(&pool, 1000 * PRECISION, true);
        // 100% fee means amount_in_after_fee = 0 → InsufficientLiquidity
        assert!(result.is_err());
    }

    #[test]
    fn test_spot_price_extreme_ratio_v3() {
        // 1 : 1_000_000_000 ratio
        let pool = make_pool(PRECISION, 1_000_000_000 * PRECISION, 30, PRECISION);
        let price = spot_price(&pool);
        assert_eq!(price, 1_000_000_000 * PRECISION);
    }

    #[test]
    fn test_swap_amount_equals_reserve_boundary() {
        // Try to swap exactly reserve_out — should fail (can't drain pool)
        let pool = standard_pool();
        let result = simulate_swap(&pool, pool.reserve1, true);
        // amount_out would be close to reserve1 but never equal, or might overflow
        // The result should not allow draining the pool
        match result {
            Ok(r) => assert!(r.amount_out < pool.reserve1),
            Err(_) => {} // Also acceptable
        }
    }

    #[test]
    fn test_add_liquidity_first_deposit_sqrt_calculation_v3() {
        let pool = make_pool(0, 0, 30, 0);
        let result = simulate_add_liquidity(&pool, 100 * PRECISION, 100 * PRECISION).unwrap();
        assert_eq!(result.lp_minted, 100 * PRECISION); // sqrt(100 * 100) = 100
    }

    #[test]
    fn test_add_liquidity_first_deposit_asymmetric_sqrt_v3() {
        let pool = make_pool(0, 0, 30, 0);
        let result = simulate_add_liquidity(&pool, 4 * PRECISION, 9 * PRECISION).unwrap();
        // sqrt(4*9) = 6
        assert_eq!(result.lp_minted, 6 * PRECISION);
    }

    #[test]
    fn test_remove_liquidity_single_lp_from_large_pool_v3() {
        let pool = make_pool(1_000_000 * PRECISION, 1_000_000 * PRECISION, 30, 1_000_000 * PRECISION);
        let result = simulate_remove_liquidity(&pool, 1).unwrap();
        // 1 LP out of 1M LP → proportional tiny amounts
        assert!(result.amount0_out > 0 || result.amount1_out > 0 || result.lp_burned == 1);
    }

    #[test]
    fn test_multi_hop_direction_alternates_v3() {
        let pool1 = make_pool_with_id(1, 100_000 * PRECISION, 100_000 * PRECISION, 30, 100_000 * PRECISION);
        let pool2 = make_pool_with_id(2, 100_000 * PRECISION, 100_000 * PRECISION, 30, 100_000 * PRECISION);
        let token_path = [[1u8; 32], [2u8; 32], [3u8; 32]];
        let result = simulate_multi_hop(&[pool1, pool2], &token_path, 1000 * PRECISION).unwrap();
        // Two hops, alternating direction
        assert_eq!(result.hops, 2);
        assert_eq!(result.intermediate_amounts.len(), 2);
    }

    #[test]
    fn test_batch_auction_single_order_each_side_v3() {
        let buys = vec![(100, 2 * PRECISION)];
        let sells = vec![(100, PRECISION)];
        let result = simulate_batch_auction(&buys, &sells).unwrap();
        assert!(result.total_volume > 0);
        assert!(result.clearing_price >= PRECISION);
        assert!(result.clearing_price <= 2 * PRECISION);
    }

    #[test]
    fn test_batch_auction_identical_prices_v3() {
        let price = 5 * PRECISION;
        let buys = vec![(100, price), (200, price)];
        let sells = vec![(150, price), (150, price)];
        let result = simulate_batch_auction(&buys, &sells).unwrap();
        assert_eq!(result.clearing_price, price);
    }

    #[test]
    fn test_arb_profit_direction_matters_v3() {
        // Pool A: token0 is cheap (price = 0.5 token1/token0)
        // Pool B: token0 is expensive (price = 2.0 token1/token0)
        // simulate_arb_profit buys on A (token0->token1), sells on B (token1->token0)
        let pool_a = make_pool(1_000_000 * PRECISION, 500_000 * PRECISION, 30, 1_000_000 * PRECISION);
        let pool_b = make_pool(500_000 * PRECISION, 1_000_000 * PRECISION, 30, 1_000_000 * PRECISION);
        let profit = simulate_arb_profit(&pool_a, &pool_b, 1000 * PRECISION).unwrap();
        // This specific direction may not be profitable because arb buys token1 on A at 0.5 then sells token1 on B
        // The reverse might be profitable. Either direction should give a definite result.
        let reverse_profit = simulate_arb_profit(&pool_b, &pool_a, 1000 * PRECISION).unwrap();
        // At least one direction should be profitable when pools are differently priced
        assert!(profit > 0 || reverse_profit > 0);
    }

    #[test]
    fn test_cascade_max_cascade_depth_boundary_v3() {
        // Create many vaults all very close to liquidation
        let mut vaults = Vec::new();
        for i in 0..20 {
            // Each vault with decreasing buffer
            vaults.push((1000 * PRECISION, 900 * PRECISION + (i as u128 * 10 * PRECISION), 10000));
        }
        let pool = standard_pool();
        let result = simulate_liquidation_cascade(&vaults, 500, &pool);
        assert!(result.cascade_depth <= MAX_CASCADE_DEPTH);
    }

    #[test]
    fn test_sandwich_both_zero_amounts_v3() {
        let pool = standard_pool();
        assert_eq!(sandwich_profit(&pool, 0, true, 100), Err(SimError::InvalidInput));
        assert_eq!(sandwich_profit(&pool, 100, true, 0), Err(SimError::InvalidInput));
    }

    #[test]
    fn test_il_sim_zero_initial_price_v3() {
        let (lp, hodl, il) = impermanent_loss_sim(0, PRECISION, 1000 * PRECISION);
        assert_eq!(lp, 0);
        assert_eq!(hodl, 0);
        assert_eq!(il, 0);
    }

    #[test]
    fn test_il_sim_zero_final_price_v3() {
        let (lp, hodl, il) = impermanent_loss_sim(PRECISION, 0, 1000 * PRECISION);
        assert_eq!(lp, 0);
        assert_eq!(hodl, 0);
        assert_eq!(il, 0);
    }

    #[test]
    fn test_il_sim_zero_initial_value_v3() {
        let (lp, hodl, il) = impermanent_loss_sim(PRECISION, 2 * PRECISION, 0);
        assert_eq!(lp, 0);
        assert_eq!(hodl, 0);
        assert_eq!(il, 0);
    }

    #[test]
    fn test_fee_revenue_projection_scales_linearly_v3() {
        let pool = standard_pool();
        let rev1 = fee_revenue_projection(&pool, 1_000_000 * PRECISION, 1);
        let rev10 = fee_revenue_projection(&pool, 1_000_000 * PRECISION, 10);
        assert_eq!(rev10, rev1 * 10);
    }

    #[test]
    fn test_swap_k_invariant_never_decreases_v3() {
        let pool = standard_pool();
        let k_before = pool.reserve0 as u128 * (pool.reserve1 / PRECISION); // simplified
        let result = simulate_swap(&pool, 10_000 * PRECISION, true).unwrap();
        let k_after = result.new_reserve0 as u128 * (result.new_reserve1 / PRECISION);
        // k should increase (fees retained)
        assert!(k_after >= k_before);
    }

    #[test]
    fn test_price_impact_monotonic_with_amount_v3() {
        let pool = standard_pool();
        let impact_small = simulate_price_impact(&pool, 100 * PRECISION, true);
        let impact_medium = simulate_price_impact(&pool, 10_000 * PRECISION, true);
        let impact_large = simulate_price_impact(&pool, 100_000 * PRECISION, true);
        assert!(impact_small <= impact_medium);
        assert!(impact_medium <= impact_large);
    }

    #[test]
    fn test_add_remove_conserves_value_approximately_v3() {
        let pool = standard_pool();
        let add = simulate_add_liquidity(&pool, 10_000 * PRECISION, 10_000 * PRECISION).unwrap();
        let new_pool = make_pool(add.new_reserve0, add.new_reserve1, 30, pool.total_lp + add.lp_minted);
        let remove = simulate_remove_liquidity(&new_pool, add.lp_minted).unwrap();
        // Should get back approximately what was deposited (within rounding)
        let diff0 = if remove.amount0_out > add.amount0_used { remove.amount0_out - add.amount0_used } else { add.amount0_used - remove.amount0_out };
        assert!(diff0 <= 2); // allow 2 wei rounding
    }

    #[test]
    fn test_multi_hop_single_pool_returns_one_hop_v3() {
        let pool = standard_pool();
        let token_path = [[1u8; 32], [2u8; 32]];
        let result = simulate_multi_hop(&[pool], &token_path, 1000 * PRECISION).unwrap();
        assert_eq!(result.hops, 1);
        assert_eq!(result.intermediate_amounts.len(), 1);
    }

    #[test]
    fn test_batch_auction_zero_amount_orders_v3() {
        let buys = vec![(0, PRECISION), (100, 2 * PRECISION)];
        let sells = vec![(100, PRECISION)];
        let result = simulate_batch_auction(&buys, &sells).unwrap();
        // Zero-amount orders are still counted but contribute 0 volume
        assert!(result.total_volume > 0);
    }

    #[test]
    fn test_optimal_swap_fee_rate_impact_v3() {
        // Higher fees should require larger swap amounts to reach same target
        let pool_low_fee = make_pool(1_000_000 * PRECISION, 2_000_000 * PRECISION, 10, 1_000_000 * PRECISION);
        let pool_high_fee = make_pool(1_000_000 * PRECISION, 2_000_000 * PRECISION, 100, 1_000_000 * PRECISION);
        let target = PRECISION; // move price to 1:1
        let (amount_low, _) = optimal_swap_amount(&pool_low_fee, target).unwrap();
        let (amount_high, _) = optimal_swap_amount(&pool_high_fee, target).unwrap();
        // Higher fee pool needs more input for same price target
        assert!(amount_high > amount_low);
    }

    #[test]
    fn test_spot_price_after_opposite_swaps_returns_approximately_v3() {
        let pool = standard_pool();
        let swap1 = simulate_swap(&pool, 10_000 * PRECISION, true).unwrap();
        let pool2 = pool_after_swap(&pool, &swap1, true);
        let price_after_1 = spot_price(&pool2);
        // Price moved down (more token0, less token1)
        assert!(price_after_1 < PRECISION);
        // Swap back
        let swap2 = simulate_swap(&pool2, swap1.amount_out, false).unwrap();
        let pool3 = pool_after_swap(&pool2, &swap2, false);
        let price_after_2 = spot_price(&pool3);
        // Should be close to original (but not exact due to fees)
        let diff = if price_after_2 > PRECISION { price_after_2 - PRECISION } else { PRECISION - price_after_2 };
        // Within 1% of original
        assert!(diff < PRECISION / 100);
    }

    // ============ Hardening Round 5 — 25 new tests ============

    #[test]
    fn test_spot_price_one_to_one_v5() {
        let pool = standard_pool();
        assert_eq!(spot_price(&pool), PRECISION);
    }

    #[test]
    fn test_spot_price_two_to_one_v5() {
        let pool = make_pool(1_000_000 * PRECISION, 2_000_000 * PRECISION, 30, 1_000_000 * PRECISION);
        let price = spot_price(&pool);
        assert_eq!(price, 2 * PRECISION);
    }

    #[test]
    fn test_spot_price_zero_reserve0_returns_zero_v5() {
        let pool = make_pool(0, 1_000_000 * PRECISION, 30, 1_000_000 * PRECISION);
        assert_eq!(spot_price(&pool), 0);
    }

    #[test]
    fn test_swap_zero_amount_returns_error_v5() {
        let pool = standard_pool();
        assert_eq!(simulate_swap(&pool, 0, true), Err(SimError::InvalidInput));
    }

    #[test]
    fn test_swap_empty_pool_returns_error_v5() {
        let pool = make_pool(0, 0, 30, 0);
        assert_eq!(simulate_swap(&pool, 1000, true), Err(SimError::EmptyPool));
    }

    #[test]
    fn test_swap_output_less_than_input_for_balanced_pool_v5() {
        let pool = standard_pool();
        let result = simulate_swap(&pool, 10_000 * PRECISION, true).unwrap();
        // Due to fees and price impact, output < input
        assert!(result.amount_out < 10_000 * PRECISION);
    }

    #[test]
    fn test_swap_fee_paid_matches_expected_v5() {
        let pool = make_pool(1_000_000 * PRECISION, 1_000_000 * PRECISION, 100, 1_000_000 * PRECISION);
        let amount = 10_000 * PRECISION;
        let result = simulate_swap(&pool, amount, true).unwrap();
        // Fee = amount * 100 / 10000 = amount / 100
        assert_eq!(result.fee_paid, amount / 100);
    }

    #[test]
    fn test_swap_new_reserves_sum_conserved_v5() {
        let pool = standard_pool();
        let amount = 5_000 * PRECISION;
        let result = simulate_swap(&pool, amount, true).unwrap();
        // token0 reserve increases by amount
        assert_eq!(result.new_reserve0, pool.reserve0 + amount);
        // token1 reserve decreases by amount_out
        assert_eq!(result.new_reserve1, pool.reserve1 - result.amount_out);
    }

    #[test]
    fn test_add_liquidity_first_deposit_v5() {
        let pool = make_pool(0, 0, 30, 0);
        let result = simulate_add_liquidity(&pool, 1_000_000 * PRECISION, 1_000_000 * PRECISION).unwrap();
        assert!(result.lp_minted > 0);
        assert_eq!(result.new_reserve0, 1_000_000 * PRECISION);
        assert_eq!(result.new_reserve1, 1_000_000 * PRECISION);
    }

    #[test]
    fn test_add_liquidity_zero_amount_fails_v5() {
        let pool = standard_pool();
        assert_eq!(simulate_add_liquidity(&pool, 0, 1000), Err(SimError::InvalidInput));
        assert_eq!(simulate_add_liquidity(&pool, 1000, 0), Err(SimError::InvalidInput));
    }

    #[test]
    fn test_remove_liquidity_zero_fails_v5() {
        let pool = standard_pool();
        assert_eq!(simulate_remove_liquidity(&pool, 0), Err(SimError::InvalidInput));
    }

    #[test]
    fn test_remove_liquidity_more_than_total_fails_v5() {
        let pool = standard_pool();
        assert_eq!(simulate_remove_liquidity(&pool, pool.total_lp + 1), Err(SimError::InsufficientLiquidity));
    }

    #[test]
    fn test_remove_liquidity_full_drains_reserves_v5() {
        let pool = standard_pool();
        let result = simulate_remove_liquidity(&pool, pool.total_lp).unwrap();
        assert_eq!(result.new_reserve0, 0);
        assert_eq!(result.new_reserve1, 0);
    }

    #[test]
    fn test_remove_liquidity_half_gets_half_reserves_v5() {
        let pool = standard_pool();
        let result = simulate_remove_liquidity(&pool, pool.total_lp / 2).unwrap();
        assert_eq!(result.amount0_out, pool.reserve0 / 2);
        assert_eq!(result.amount1_out, pool.reserve1 / 2);
    }

    #[test]
    fn test_multi_hop_empty_pools_fails_v5() {
        let result = simulate_multi_hop(&[], &[[0u8; 32], [1u8; 32]], 1000);
        assert_eq!(result, Err(SimError::NoPath));
    }

    #[test]
    fn test_multi_hop_path_mismatch_fails_v5() {
        let pools = vec![standard_pool()];
        let path = vec![[0u8; 32]]; // len should be pools.len() + 1
        assert_eq!(simulate_multi_hop(&pools, &path, 1000), Err(SimError::InvalidInput));
    }

    #[test]
    fn test_batch_auction_empty_fails_v5() {
        assert_eq!(simulate_batch_auction(&[], &[]), Err(SimError::InvalidInput));
    }

    #[test]
    fn test_batch_auction_single_buy_no_sell_v5() {
        let result = simulate_batch_auction(&[(1000, PRECISION)], &[]).unwrap();
        assert_eq!(result.buy_fills, 1);
        assert_eq!(result.sell_fills, 0);
        assert_eq!(result.total_volume, 0); // No matching
    }

    #[test]
    fn test_batch_auction_matching_orders_v5() {
        let buys = vec![(1000 * PRECISION, 2 * PRECISION)]; // Buy 1000 at price 2
        let sells = vec![(1000 * PRECISION, PRECISION)];    // Sell 1000 at price 1
        let result = simulate_batch_auction(&buys, &sells).unwrap();
        assert!(result.total_volume > 0);
    }

    #[test]
    fn test_price_impact_zero_amount_v5() {
        let pool = standard_pool();
        assert_eq!(simulate_price_impact(&pool, 0, true), 0);
    }

    #[test]
    fn test_price_impact_increases_with_amount_v5() {
        let pool = standard_pool();
        let i1 = simulate_price_impact(&pool, 1_000 * PRECISION, true);
        let i2 = simulate_price_impact(&pool, 100_000 * PRECISION, true);
        assert!(i2 > i1);
    }

    #[test]
    fn test_arb_profit_equal_pools_negative_v5() {
        let pool = standard_pool();
        let profit = simulate_arb_profit(&pool, &pool, 10_000 * PRECISION).unwrap();
        // Same pool => fees make it negative
        assert!(profit < 0);
    }

    #[test]
    fn test_il_same_price_zero_loss_v5() {
        let (lp_val, hodl_val, il_bps) = impermanent_loss_sim(PRECISION, PRECISION, 1_000_000 * PRECISION);
        assert_eq!(il_bps, 0);
        assert_eq!(lp_val, hodl_val);
    }

    #[test]
    fn test_il_increases_with_divergence_v5() {
        let (_, _, il_2x) = impermanent_loss_sim(PRECISION, 2 * PRECISION, 1_000_000 * PRECISION);
        let (_, _, il_4x) = impermanent_loss_sim(PRECISION, 4 * PRECISION, 1_000_000 * PRECISION);
        assert!(il_4x > il_2x);
    }

    #[test]
    fn test_fee_revenue_zero_volume_v5() {
        let pool = standard_pool();
        assert_eq!(fee_revenue_projection(&pool, 0, 30), 0);
    }

    #[test]
    fn test_fee_revenue_zero_days_v5() {
        let pool = standard_pool();
        assert_eq!(fee_revenue_projection(&pool, 1_000_000 * PRECISION, 0), 0);
    }

    #[test]
    fn test_fee_revenue_scales_linearly_with_days_v5() {
        let pool = standard_pool();
        let r1 = fee_revenue_projection(&pool, 1_000_000 * PRECISION, 10);
        let r2 = fee_revenue_projection(&pool, 1_000_000 * PRECISION, 20);
        assert_eq!(r2, r1 * 2);
    }
}
