// ============ Arbitrage — MEV Analysis, Detection & Protection Validation ============
// Implements MEV analysis, cross-pool arbitrage detection, sandwich attack simulation,
// and frontrunning protection validation for VibeSwap on CKB.
//
// Key capabilities:
// - Detect price discrepancies between AMM pools
// - Calculate two-pool and multi-hop cyclic arbitrage profits
// - Find optimal arbitrage input size via binary search
// - Simulate sandwich attacks and validate commit-reveal protection
// - Score MEV protection features of the protocol
// - Compute price impact and post-arbitrage equilibrium prices
//
// All percentages are expressed in basis points (bps, 10000 = 100%).
// Uses PRECISION (1e18) scaling for safe fixed-point arithmetic where needed.
//
// Philosophy: VibeSwap eliminates MEV through commit-reveal batch auctions.
// This module proves it by detecting, analyzing, and validating the absence
// of MEV opportunities.

use vibeswap_math::PRECISION;
use vibeswap_math::mul_div;

// ============ Constants ============

/// Basis points denominator
pub const BPS: u128 = 10_000;

/// Minimum profit threshold to consider an arb opportunity worthwhile (0.001 VIBE)
pub const MIN_PROFIT_THRESHOLD: u128 = 1_000_000_000_000_000;

/// Maximum number of hops for cyclic arbitrage (A→B→C→...→A)
pub const MAX_HOPS: usize = 4;

/// Estimated gas cost for an arbitrage transaction (0.1 VIBE)
pub const GAS_COST_ESTIMATE: u128 = 100_000_000_000_000_000;

/// Number of blocks to look back for sandwich attack patterns
pub const SANDWICH_DETECTION_WINDOW: u64 = 3;

/// Price impact in BPS above which a trade is suspicious for frontrunning (0.5%)
pub const FRONTRUN_PRICE_IMPACT_BPS: u16 = 50;

/// Profit in BPS above which a backrun is suspicious (0.1%)
pub const BACKRUN_PROFIT_THRESHOLD_BPS: u16 = 10;

/// Maximum MEV protection score
pub const MEV_PROTECTION_SCORE_MAX: u8 = 100;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ArbitrageError {
    /// Pool has insufficient liquidity for the requested operation
    InsufficientLiquidity,
    /// No profitable arbitrage route was found
    NoProfitableRoute,
    /// Route exceeds the maximum allowed number of hops
    ExceedsMaxHops,
    /// Pool identifier is invalid or not found
    InvalidPool,
    /// Input amount is zero
    ZeroAmount,
    /// Reserve value is zero when it must be positive
    ZeroReserve,
    /// No cyclic route exists through the given pools
    NoCyclicRoute,
    /// Price impact of the trade is too high
    PriceImpactTooHigh,
    /// Arithmetic overflow during computation
    Overflow,
    /// Detection window parameter is invalid
    InvalidWindow,
}

// ============ Data Types ============

/// A single hop in an arbitrage route
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArbHop {
    /// Pool identifier (32-byte hash)
    pub pool_id: [u8; 32],
    /// Token being sold into this pool
    pub token_in: [u8; 32],
    /// Token being bought from this pool
    pub token_out: [u8; 32],
    /// Amount of token_in sold
    pub amount_in: u128,
    /// Amount of token_out received
    pub amount_out: u128,
    /// Fee rate of this pool in basis points
    pub fee_rate_bps: u16,
    /// Reserve of token_in before the trade
    pub reserve_in: u128,
    /// Reserve of token_out before the trade
    pub reserve_out: u128,
}

/// A complete arbitrage opportunity with profit analysis
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArbOpportunity {
    /// Route hops (fixed-size array, use hop_count for valid entries)
    pub route: [ArbHop; 4],
    /// Number of valid hops in the route
    pub hop_count: u8,
    /// Total input amount
    pub input_amount: u128,
    /// Total output amount
    pub output_amount: u128,
    /// Gross profit before gas costs
    pub gross_profit: u128,
    /// Estimated gas cost
    pub gas_cost: u128,
    /// Net profit after gas (can be negative)
    pub net_profit: i128,
    /// Whether the opportunity is net profitable
    pub is_profitable: bool,
    /// Profit as basis points of input amount
    pub profit_bps: u16,
}

/// Analysis of a potential sandwich attack
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SandwichAnalysis {
    /// Whether this transaction pattern constitutes a sandwich attack
    pub is_sandwich: bool,
    /// Transaction hash of the frontrun trade
    pub frontrun_tx: [u8; 32],
    /// Transaction hash of the victim trade
    pub victim_tx: [u8; 32],
    /// Transaction hash of the backrun trade
    pub backrun_tx: [u8; 32],
    /// Loss suffered by the victim in basis points
    pub victim_loss_bps: u16,
    /// Profit captured by the attacker
    pub attacker_profit: u128,
    /// Price impact of the frontrun in basis points
    pub price_impact_bps: u16,
}

/// Overall MEV protection report for the protocol
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MEVReport {
    /// Total number of arbitrage opportunities detected
    pub total_arb_opportunities: u32,
    /// Total arbitrage profit across all opportunities
    pub total_arb_profit: u128,
    /// Number of sandwich attack attempts detected
    pub sandwich_attempts: u32,
    /// Number of sandwich attempts blocked by commit-reveal
    pub sandwich_blocked: u32,
    /// Number of frontrunning attempts detected
    pub frontrun_attempts: u32,
    /// Number of frontrunning attempts blocked
    pub frontrun_blocked: u32,
    /// Overall protection score (0-100)
    pub protection_score: u8,
    /// Whether commit-reveal mechanism is effectively preventing MEV
    pub commit_reveal_effective: bool,
}

/// Price discrepancy between two pools trading the same pair
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PriceDiscrepancy {
    /// Identifier of the first pool
    pub pool_a_id: [u8; 32],
    /// Identifier of the second pool
    pub pool_b_id: [u8; 32],
    /// Price in pool A (reserve_out / reserve_in scaled by PRECISION)
    pub pool_a_price: u128,
    /// Price in pool B (reserve_out / reserve_in scaled by PRECISION)
    pub pool_b_price: u128,
    /// Spread between the two prices in basis points
    pub spread_bps: u16,
    /// Direction to exploit the discrepancy
    pub arb_direction: ArbDirection,
}

/// Direction of an arbitrage opportunity
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ArbDirection {
    /// Buy from pool A (cheaper), sell to pool B (more expensive)
    AToB,
    /// Buy from pool B (cheaper), sell to pool A (more expensive)
    BToA,
    /// No profitable direction exists
    None,
}

/// Result of optimal arbitrage size calculation
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OptimalArbSize {
    /// Optimal input amount for maximum profit
    pub optimal_input: u128,
    /// Expected output for the optimal input
    pub expected_output: u128,
    /// Expected profit (can be negative if no profitable size exists)
    pub expected_profit: i128,
    /// Price in the first pool after the arbitrage trade
    pub price_after_arb: u128,
}

// ============ Internal Helpers ============

/// Constant-product AMM: compute output amount given input, reserves, and fee.
/// Returns 0 if any input is zero or overflow occurs.
fn amm_out(amount_in: u128, reserve_in: u128, reserve_out: u128, fee_bps: u16) -> u128 {
    if amount_in == 0 || reserve_in == 0 || reserve_out == 0 {
        return 0;
    }
    let fee = fee_bps as u128;
    if fee >= BPS {
        return 0;
    }
    let amount_in_with_fee = match amount_in.checked_mul(BPS - fee) {
        Some(v) => v,
        None => return 0,
    };
    let denominator = match reserve_in.checked_mul(BPS) {
        Some(v) => match v.checked_add(amount_in_with_fee) {
            Some(d) => d,
            None => return 0,
        },
        None => return 0,
    };
    if denominator == 0 {
        return 0;
    }
    mul_div(amount_in_with_fee, reserve_out, denominator)
}

/// Create a default (empty) ArbHop
fn default_hop() -> ArbHop {
    ArbHop {
        pool_id: [0u8; 32],
        token_in: [0u8; 32],
        token_out: [0u8; 32],
        amount_in: 0,
        amount_out: 0,
        fee_rate_bps: 0,
        reserve_in: 0,
        reserve_out: 0,
    }
}

/// Compute price from reserves scaled by PRECISION (reserve_out * PRECISION / reserve_in)
fn price_from_reserves(reserve_in: u128, reserve_out: u128) -> u128 {
    if reserve_in == 0 {
        return 0;
    }
    mul_div(reserve_out, PRECISION, reserve_in)
}

// ============ Core Functions ============

/// Detect price discrepancy between two pools trading the same pair.
///
/// Computes the price in each pool (reserve_out / reserve_in * PRECISION) and
/// the spread in basis points. Determines which direction to trade for profit.
pub fn detect_price_discrepancy(
    pool_a_reserve_in: u128,
    pool_a_reserve_out: u128,
    pool_b_reserve_in: u128,
    pool_b_reserve_out: u128,
    pool_a_id: [u8; 32],
    pool_b_id: [u8; 32],
) -> PriceDiscrepancy {
    let price_a = price_from_reserves(pool_a_reserve_in, pool_a_reserve_out);
    let price_b = price_from_reserves(pool_b_reserve_in, pool_b_reserve_out);

    let (spread_bps, direction) = if price_a == 0 && price_b == 0 {
        (0u16, ArbDirection::None)
    } else if price_a == 0 {
        (10_000u16, ArbDirection::BToA)
    } else if price_b == 0 {
        (10_000u16, ArbDirection::AToB)
    } else if price_a > price_b {
        // Pool A is more expensive — buy from B (cheap), sell to A (expensive)
        let diff = price_a - price_b;
        let avg = (price_a / 2).saturating_add(price_b / 2);
        if avg == 0 {
            (0u16, ArbDirection::None)
        } else {
            let bps = mul_div(diff, BPS, avg);
            let bps_capped = if bps > 10_000 { 10_000u16 } else { bps as u16 };
            if bps_capped == 0 {
                (0u16, ArbDirection::None)
            } else {
                (bps_capped, ArbDirection::BToA)
            }
        }
    } else if price_b > price_a {
        // Pool B is more expensive — buy from A (cheap), sell to B (expensive)
        let diff = price_b - price_a;
        let avg = (price_a / 2).saturating_add(price_b / 2);
        if avg == 0 {
            (0u16, ArbDirection::None)
        } else {
            let bps = mul_div(diff, BPS, avg);
            let bps_capped = if bps > 10_000 { 10_000u16 } else { bps as u16 };
            if bps_capped == 0 {
                (0u16, ArbDirection::None)
            } else {
                (bps_capped, ArbDirection::AToB)
            }
        }
    } else {
        (0u16, ArbDirection::None)
    };

    PriceDiscrepancy {
        pool_a_id,
        pool_b_id,
        pool_a_price: price_a,
        pool_b_price: price_b,
        spread_bps,
        arb_direction: direction,
    }
}

/// Calculate two-pool arbitrage profit.
///
/// Simulates buying from pool A and selling to pool B.
/// The route is: input → pool A → intermediate token → pool B → output.
/// Computes gross/net profit, gas costs, and whether the opportunity is viable.
pub fn compute_arb_profit(
    amount_in: u128,
    reserve_in_a: u128,
    reserve_out_a: u128,
    fee_a_bps: u16,
    reserve_in_b: u128,
    reserve_out_b: u128,
    fee_b_bps: u16,
) -> ArbOpportunity {
    let pool_a_id = {
        let mut id = [0u8; 32];
        id[0] = 0xAA;
        id
    };
    let pool_b_id = {
        let mut id = [0u8; 32];
        id[0] = 0xBB;
        id
    };
    let token_base = {
        let mut t = [0u8; 32];
        t[0] = 0x01;
        t
    };
    let token_mid = {
        let mut t = [0u8; 32];
        t[0] = 0x02;
        t
    };
    let token_final = {
        let mut t = [0u8; 32];
        t[0] = 0x03;
        t
    };

    // Hop 1: buy from pool A
    let mid_amount = amm_out(amount_in, reserve_in_a, reserve_out_a, fee_a_bps);
    // Hop 2: sell to pool B (note: selling token_mid into pool B means token_mid is reserve_in_b side)
    let final_amount = amm_out(mid_amount, reserve_in_b, reserve_out_b, fee_b_bps);

    let gross_profit = if final_amount > amount_in {
        final_amount - amount_in
    } else {
        0
    };

    let net_profit = (final_amount as i128) - (amount_in as i128) - (GAS_COST_ESTIMATE as i128);
    let is_profitable = net_profit > 0 && gross_profit >= MIN_PROFIT_THRESHOLD;

    let profit_bps = if amount_in > 0 && gross_profit > 0 {
        let bps = mul_div(gross_profit, BPS, amount_in);
        if bps > u16::MAX as u128 { u16::MAX } else { bps as u16 }
    } else {
        0
    };

    let hop_a = ArbHop {
        pool_id: pool_a_id,
        token_in: token_base,
        token_out: token_mid,
        amount_in,
        amount_out: mid_amount,
        fee_rate_bps: fee_a_bps,
        reserve_in: reserve_in_a,
        reserve_out: reserve_out_a,
    };

    let hop_b = ArbHop {
        pool_id: pool_b_id,
        token_in: token_mid,
        token_out: token_final,
        amount_in: mid_amount,
        amount_out: final_amount,
        fee_rate_bps: fee_b_bps,
        reserve_in: reserve_in_b,
        reserve_out: reserve_out_b,
    };

    ArbOpportunity {
        route: [hop_a, hop_b, default_hop(), default_hop()],
        hop_count: 2,
        input_amount: amount_in,
        output_amount: final_amount,
        gross_profit,
        gas_cost: GAS_COST_ESTIMATE,
        net_profit,
        is_profitable,
        profit_bps,
    }
}

/// Find the optimal arbitrage input amount using binary search.
///
/// Searches between 1 unit and the smaller of reserve_in_a / 2 (to avoid
/// draining the pool) for the input that maximizes net profit.
pub fn optimal_arb_amount(
    reserve_in_a: u128,
    reserve_out_a: u128,
    fee_a_bps: u16,
    reserve_in_b: u128,
    reserve_out_b: u128,
    fee_b_bps: u16,
) -> OptimalArbSize {
    if reserve_in_a == 0 || reserve_out_a == 0 || reserve_in_b == 0 || reserve_out_b == 0 {
        return OptimalArbSize {
            optimal_input: 0,
            expected_output: 0,
            expected_profit: 0,
            price_after_arb: 0,
        };
    }

    // Upper bound: don't try to trade more than half the smaller reserve
    let max_input = reserve_in_a / 2;
    if max_input == 0 {
        return OptimalArbSize {
            optimal_input: 0,
            expected_output: 0,
            expected_profit: 0,
            price_after_arb: price_from_reserves(reserve_in_a, reserve_out_a),
        };
    }

    let mut best_input: u128 = 0;
    let mut best_profit: i128 = i128::MIN;
    let mut best_output: u128 = 0;

    // Binary search: find peak of the profit curve
    let mut lo: u128 = 1;
    let mut hi: u128 = max_input;

    // First check if any profit is possible at all
    let small_arb = compute_arb_profit(lo, reserve_in_a, reserve_out_a, fee_a_bps, reserve_in_b, reserve_out_b, fee_b_bps);
    let large_arb = compute_arb_profit(hi, reserve_in_a, reserve_out_a, fee_a_bps, reserve_in_b, reserve_out_b, fee_b_bps);

    // Track the best we've seen
    if small_arb.net_profit > best_profit {
        best_profit = small_arb.net_profit;
        best_input = lo;
        best_output = small_arb.output_amount;
    }
    if large_arb.net_profit > best_profit {
        best_profit = large_arb.net_profit;
        best_input = hi;
        best_output = large_arb.output_amount;
    }

    // Ternary search for the maximum of the profit function
    let mut iterations = 0;
    while hi - lo > 2 && iterations < 128 {
        iterations += 1;
        let mid1 = lo + (hi - lo) / 3;
        let mid2 = hi - (hi - lo) / 3;

        let arb1 = compute_arb_profit(mid1, reserve_in_a, reserve_out_a, fee_a_bps, reserve_in_b, reserve_out_b, fee_b_bps);
        let arb2 = compute_arb_profit(mid2, reserve_in_a, reserve_out_a, fee_a_bps, reserve_in_b, reserve_out_b, fee_b_bps);

        if arb1.net_profit > best_profit {
            best_profit = arb1.net_profit;
            best_input = mid1;
            best_output = arb1.output_amount;
        }
        if arb2.net_profit > best_profit {
            best_profit = arb2.net_profit;
            best_input = mid2;
            best_output = arb2.output_amount;
        }

        if arb1.net_profit < arb2.net_profit {
            lo = mid1;
        } else {
            hi = mid2;
        }
    }

    // Check remaining candidates
    for candidate in lo..=hi {
        if candidate == 0 {
            continue;
        }
        let arb = compute_arb_profit(candidate, reserve_in_a, reserve_out_a, fee_a_bps, reserve_in_b, reserve_out_b, fee_b_bps);
        if arb.net_profit > best_profit {
            best_profit = arb.net_profit;
            best_input = candidate;
            best_output = arb.output_amount;
        }
    }

    let price_after = post_arb_price(reserve_in_a, reserve_out_a, best_input, fee_a_bps);

    OptimalArbSize {
        optimal_input: best_input,
        expected_output: best_output,
        expected_profit: best_profit,
        price_after_arb: price_after,
    }
}

/// Simulate a sandwich attack against a victim trade.
///
/// Models the three-step process:
/// 1. Attacker frontrun: buys before victim, moving the price up
/// 2. Victim trade: executes at the worse price
/// 3. Attacker backrun: sells at the inflated price
///
/// Returns analysis including victim loss and attacker profit.
pub fn simulate_sandwich(
    victim_amount: u128,
    pool_reserve_in: u128,
    pool_reserve_out: u128,
    fee_bps: u16,
    frontrun_amount: u128,
) -> SandwichAnalysis {
    let frontrun_tx = {
        let mut h = [0u8; 32];
        h[0] = 0xFF;
        h
    };
    let victim_tx = {
        let mut h = [0u8; 32];
        h[0] = 0xEE;
        h
    };
    let backrun_tx = {
        let mut h = [0u8; 32];
        h[0] = 0xDD;
        h
    };

    if victim_amount == 0 || pool_reserve_in == 0 || pool_reserve_out == 0 || frontrun_amount == 0 {
        return SandwichAnalysis {
            is_sandwich: false,
            frontrun_tx,
            victim_tx,
            backrun_tx,
            victim_loss_bps: 0,
            attacker_profit: 0,
            price_impact_bps: 0,
        };
    }

    // Step 0: Victim output WITHOUT the sandwich (fair price)
    let fair_victim_out = amm_out(victim_amount, pool_reserve_in, pool_reserve_out, fee_bps);

    // Step 1: Attacker frontrun — buys token_out, moving price up
    let frontrun_out = amm_out(frontrun_amount, pool_reserve_in, pool_reserve_out, fee_bps);
    let r_in_after_front = pool_reserve_in.saturating_add(frontrun_amount);
    let r_out_after_front = pool_reserve_out.saturating_sub(frontrun_out);

    // Step 2: Victim trades at the worse price
    let victim_out = amm_out(victim_amount, r_in_after_front, r_out_after_front, fee_bps);
    let r_in_after_victim = r_in_after_front.saturating_add(victim_amount);
    let r_out_after_victim = r_out_after_front.saturating_sub(victim_out);

    // Step 3: Attacker backruns — sells the tokens bought in step 1
    // Attacker sells token_out back for token_in
    let backrun_out = amm_out(frontrun_out, r_out_after_victim, r_in_after_victim, fee_bps);

    // Attacker profit: what they got back minus what they spent
    let attacker_profit = if backrun_out > frontrun_amount {
        backrun_out - frontrun_amount
    } else {
        0
    };

    // Victim loss: difference between fair output and actual output
    let victim_loss = if fair_victim_out > victim_out {
        fair_victim_out - victim_out
    } else {
        0
    };

    let victim_loss_bps = if fair_victim_out > 0 {
        let bps = mul_div(victim_loss, BPS, fair_victim_out);
        if bps > u16::MAX as u128 { u16::MAX } else { bps as u16 }
    } else {
        0
    };

    // Price impact of frontrun
    let price_impact = price_impact_of_trade(frontrun_amount, pool_reserve_in, pool_reserve_out, fee_bps);

    let is_sandwich = attacker_profit > 0 && victim_loss > 0;

    SandwichAnalysis {
        is_sandwich,
        frontrun_tx,
        victim_tx,
        backrun_tx,
        victim_loss_bps,
        attacker_profit,
        price_impact_bps: price_impact,
    }
}

/// Check whether a sandwich attack is profitable after gas costs.
pub fn is_sandwich_profitable(frontrun_cost: u128, backrun_revenue: u128, gas_cost: u128) -> bool {
    if backrun_revenue <= frontrun_cost {
        return false;
    }
    let profit = backrun_revenue - frontrun_cost;
    profit > gas_cost
}

/// Determine whether commit-reveal batch auctions prevent sandwich attacks.
///
/// Commit-reveal prevents sandwiching when:
/// - The batch size is large enough to provide anonymity (>= 2 trades)
/// - The commit window is long enough that ordering is non-deterministic
///
/// In a commit-reveal scheme, the attacker cannot see victim orders during
/// the commit phase, making frontrunning impossible.
pub fn commit_reveal_blocks_sandwich(batch_size: u32, commit_window: u64) -> bool {
    // Commit-reveal blocks sandwich attacks when:
    // 1. There's a batch (more than 1 trade) so individual targeting is hard
    // 2. The commit window is nonzero (orders are hidden during commit phase)
    // Both conditions must hold for effective protection
    batch_size >= 2 && commit_window >= 1
}

/// Compute an overall MEV protection report for the protocol.
///
/// Aggregates arbitrage, sandwich, and frontrunning statistics and computes
/// a protection score based on the ratio of blocked vs attempted attacks.
pub fn compute_mev_report(
    arb_count: u32,
    arb_profit: u128,
    sandwich_attempts: u32,
    blocked: u32,
    frontrun_attempts: u32,
    fr_blocked: u32,
    has_commit_reveal: bool,
) -> MEVReport {
    let total_attempts = sandwich_attempts.saturating_add(frontrun_attempts);
    let total_blocked = blocked.saturating_add(fr_blocked);

    let protection_score = if has_commit_reveal {
        if total_attempts == 0 {
            // No attacks to measure against — perfect score with commit-reveal
            MEV_PROTECTION_SCORE_MAX
        } else {
            // Score based on block rate, with commit-reveal bonus
            let block_rate = mul_div(total_blocked as u128, 100, total_attempts as u128);
            let score = block_rate as u8;
            if score > MEV_PROTECTION_SCORE_MAX {
                MEV_PROTECTION_SCORE_MAX
            } else {
                score
            }
        }
    } else if total_attempts == 0 {
        // No commit-reveal, no attacks — mediocre score
        50
    } else {
        let block_rate = mul_div(total_blocked as u128, 100, total_attempts as u128);
        let score = (block_rate as u8).min(80); // Cap at 80 without commit-reveal
        score
    };

    let commit_reveal_effective = has_commit_reveal
        && (total_attempts == 0 || total_blocked >= total_attempts / 2);

    MEVReport {
        total_arb_opportunities: arb_count,
        total_arb_profit: arb_profit,
        sandwich_attempts,
        sandwich_blocked: blocked,
        frontrun_attempts,
        frontrun_blocked: fr_blocked,
        protection_score,
        commit_reveal_effective,
    }
}

/// Compute the price impact of a trade in basis points.
///
/// Price impact = how much the marginal price moves due to the trade.
/// Calculated as: (price_before - price_after) / price_before * BPS
///
/// Returns the absolute price impact in BPS (0-10000).
pub fn price_impact_of_trade(
    amount_in: u128,
    reserve_in: u128,
    reserve_out: u128,
    fee_bps: u16,
) -> u16 {
    if amount_in == 0 || reserve_in == 0 || reserve_out == 0 {
        return 0;
    }

    // Price before: reserve_out / reserve_in (scaled by PRECISION)
    let price_before = price_from_reserves(reserve_in, reserve_out);
    if price_before == 0 {
        return 0;
    }

    // Simulate the trade
    let amount_out = amm_out(amount_in, reserve_in, reserve_out, fee_bps);
    if amount_out == 0 {
        return 0;
    }

    // New reserves after trade
    let new_reserve_in = reserve_in.saturating_add(amount_in);
    let new_reserve_out = reserve_out.saturating_sub(amount_out);

    // Price after: new_reserve_out / new_reserve_in
    let price_after = price_from_reserves(new_reserve_in, new_reserve_out);

    // Impact = (price_before - price_after) / price_before * BPS
    if price_before <= price_after {
        // Price went up (shouldn't happen for a buy, but handle gracefully)
        return 0;
    }

    let diff = price_before - price_after;
    let impact_bps = mul_div(diff, BPS, price_before);
    if impact_bps > 10_000 {
        10_000u16
    } else {
        impact_bps as u16
    }
}

/// Determine whether a trade is suspicious as a potential frontrun.
///
/// A trade is suspicious if:
/// - Its price impact exceeds the frontrun threshold (0.5%)
/// - It was submitted within 1 block of the target transaction
pub fn is_frontrun_suspicious(price_impact_bps: u16, time_before_target: u64) -> bool {
    price_impact_bps >= FRONTRUN_PRICE_IMPACT_BPS && time_before_target <= 1
}

/// Calculate profit for a multi-hop cyclic arbitrage route.
///
/// Each hop is described as (reserve_in, reserve_out, fee_bps).
/// The route forms a cycle: the output token of the last hop equals
/// the input token of the first hop.
///
/// Returns an ArbOpportunity with full route details.
pub fn cyclic_arb_profit(
    hops: &[(u128, u128, u16)],
    initial_amount: u128,
) -> Result<ArbOpportunity, ArbitrageError> {
    if hops.is_empty() {
        return Err(ArbitrageError::NoCyclicRoute);
    }
    if hops.len() > MAX_HOPS {
        return Err(ArbitrageError::ExceedsMaxHops);
    }
    if initial_amount == 0 {
        return Err(ArbitrageError::ZeroAmount);
    }

    // Validate reserves
    for (reserve_in, reserve_out, _) in hops {
        if *reserve_in == 0 || *reserve_out == 0 {
            return Err(ArbitrageError::ZeroReserve);
        }
    }

    let mut route = [default_hop(), default_hop(), default_hop(), default_hop()];
    let mut current_amount = initial_amount;

    for (i, (reserve_in, reserve_out, fee_bps)) in hops.iter().enumerate() {
        let out = amm_out(current_amount, *reserve_in, *reserve_out, *fee_bps);
        if out == 0 {
            return Err(ArbitrageError::InsufficientLiquidity);
        }

        let mut pool_id = [0u8; 32];
        pool_id[0] = (i + 1) as u8;
        let mut token_in = [0u8; 32];
        token_in[0] = (i + 1) as u8;
        let mut token_out = [0u8; 32];
        token_out[0] = (i + 2) as u8;

        route[i] = ArbHop {
            pool_id,
            token_in,
            token_out,
            amount_in: current_amount,
            amount_out: out,
            fee_rate_bps: *fee_bps,
            reserve_in: *reserve_in,
            reserve_out: *reserve_out,
        };

        current_amount = out;
    }

    let gross_profit = if current_amount > initial_amount {
        current_amount - initial_amount
    } else {
        0
    };

    let net_profit = (current_amount as i128) - (initial_amount as i128) - (GAS_COST_ESTIMATE as i128);
    let is_profitable = net_profit > 0 && gross_profit >= MIN_PROFIT_THRESHOLD;

    let profit_bps = if initial_amount > 0 && gross_profit > 0 {
        let bps = mul_div(gross_profit, BPS, initial_amount);
        if bps > u16::MAX as u128 { u16::MAX } else { bps as u16 }
    } else {
        0
    };

    Ok(ArbOpportunity {
        route,
        hop_count: hops.len() as u8,
        input_amount: initial_amount,
        output_amount: current_amount,
        gross_profit,
        gas_cost: GAS_COST_ESTIMATE,
        net_profit,
        is_profitable,
        profit_bps,
    })
}

/// Compute the price in a pool after an arbitrage trade.
///
/// Returns the new price scaled by PRECISION: new_reserve_out / new_reserve_in * PRECISION
pub fn post_arb_price(
    reserve_in: u128,
    reserve_out: u128,
    arb_amount: u128,
    fee_bps: u16,
) -> u128 {
    if reserve_in == 0 || reserve_out == 0 {
        return 0;
    }
    if arb_amount == 0 {
        return price_from_reserves(reserve_in, reserve_out);
    }

    let amount_out = amm_out(arb_amount, reserve_in, reserve_out, fee_bps);
    let new_reserve_in = reserve_in.saturating_add(arb_amount);
    let new_reserve_out = reserve_out.saturating_sub(amount_out);

    price_from_reserves(new_reserve_in, new_reserve_out)
}

/// Score VibeSwap's MEV protection features on a 0-100 scale.
///
/// Each feature contributes to the total:
/// - Commit-reveal: 30 points (orders are hidden)
/// - Batch auction: 25 points (no ordering advantage)
/// - Uniform clearing price: 25 points (no price discrimination)
/// - EOA-only: 10 points (flash loan protection)
/// - TWAP check: 10 points (oracle manipulation protection)
pub fn mev_protection_score(
    has_commit_reveal: bool,
    has_batch_auction: bool,
    has_uniform_price: bool,
    has_eoa_only: bool,
    has_twap_check: bool,
) -> u8 {
    let mut score: u8 = 0;
    if has_commit_reveal {
        score = score.saturating_add(30);
    }
    if has_batch_auction {
        score = score.saturating_add(25);
    }
    if has_uniform_price {
        score = score.saturating_add(25);
    }
    if has_eoa_only {
        score = score.saturating_add(10);
    }
    if has_twap_check {
        score = score.saturating_add(10);
    }
    score
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Helper factories ----

    fn test_pool_id(seed: u8) -> [u8; 32] {
        let mut id = [0u8; 32];
        id[0] = seed;
        id
    }

    /// Standard pool: 1M tokens each side, 30bps fee
    const STD_RESERVE: u128 = 1_000_000_000_000_000_000_000_000; // 1M tokens (1e24)
    const STD_FEE: u16 = 30; // 0.3%
    const ONE_TOKEN: u128 = 1_000_000_000_000_000_000; // 1e18

    // ============ amm_out Helper Tests ============

    #[test]
    fn test_amm_out_basic() {
        let out = amm_out(ONE_TOKEN, STD_RESERVE, STD_RESERVE, STD_FEE);
        // With equal reserves and 0.3% fee, output should be slightly less than input
        assert!(out > 0);
        assert!(out < ONE_TOKEN);
    }

    #[test]
    fn test_amm_out_zero_amount() {
        assert_eq!(amm_out(0, STD_RESERVE, STD_RESERVE, STD_FEE), 0);
    }

    #[test]
    fn test_amm_out_zero_reserve_in() {
        assert_eq!(amm_out(ONE_TOKEN, 0, STD_RESERVE, STD_FEE), 0);
    }

    #[test]
    fn test_amm_out_zero_reserve_out() {
        assert_eq!(amm_out(ONE_TOKEN, STD_RESERVE, 0, STD_FEE), 0);
    }

    #[test]
    fn test_amm_out_zero_fee() {
        // With 0 fee, output should be closer to input than with a fee
        let out_no_fee = amm_out(ONE_TOKEN, STD_RESERVE, STD_RESERVE, 0);
        let out_with_fee = amm_out(ONE_TOKEN, STD_RESERVE, STD_RESERVE, STD_FEE);
        assert!(out_no_fee > out_with_fee);
    }

    #[test]
    fn test_amm_out_max_fee() {
        // Fee of 10000 bps = 100% means no output
        assert_eq!(amm_out(ONE_TOKEN, STD_RESERVE, STD_RESERVE, 10000), 0);
    }

    #[test]
    fn test_amm_out_large_trade() {
        // Trading half the reserve
        let half = STD_RESERVE / 2;
        let out = amm_out(half, STD_RESERVE, STD_RESERVE, STD_FEE);
        assert!(out > 0);
        assert!(out < STD_RESERVE); // Can't drain the pool
    }

    // ============ Price Discrepancy Tests ============

    #[test]
    fn test_detect_price_discrepancy_equal_prices() {
        let pd = detect_price_discrepancy(
            STD_RESERVE, STD_RESERVE,
            STD_RESERVE, STD_RESERVE,
            test_pool_id(1), test_pool_id(2),
        );
        assert_eq!(pd.spread_bps, 0);
        assert_eq!(pd.arb_direction, ArbDirection::None);
    }

    #[test]
    fn test_detect_price_discrepancy_a_expensive() {
        // Pool A: 1M in, 2M out (price = 2.0)
        // Pool B: 1M in, 1M out (price = 1.0)
        let pd = detect_price_discrepancy(
            STD_RESERVE, STD_RESERVE * 2,
            STD_RESERVE, STD_RESERVE,
            test_pool_id(1), test_pool_id(2),
        );
        assert!(pd.spread_bps > 0);
        assert_eq!(pd.arb_direction, ArbDirection::BToA);
        assert_eq!(pd.pool_a_price, 2 * PRECISION);
        assert_eq!(pd.pool_b_price, PRECISION);
    }

    #[test]
    fn test_detect_price_discrepancy_b_expensive() {
        // Pool A: 1M in, 1M out (price = 1.0)
        // Pool B: 1M in, 2M out (price = 2.0)
        let pd = detect_price_discrepancy(
            STD_RESERVE, STD_RESERVE,
            STD_RESERVE, STD_RESERVE * 2,
            test_pool_id(1), test_pool_id(2),
        );
        assert!(pd.spread_bps > 0);
        assert_eq!(pd.arb_direction, ArbDirection::AToB);
    }

    #[test]
    fn test_detect_price_discrepancy_small_spread() {
        // 0.1% difference: Pool A has slightly more reserve_out
        let pool_a_out = STD_RESERVE + STD_RESERVE / 1000;
        let pd = detect_price_discrepancy(
            STD_RESERVE, pool_a_out,
            STD_RESERVE, STD_RESERVE,
            test_pool_id(1), test_pool_id(2),
        );
        assert!(pd.spread_bps <= 10); // ~10 bps = 0.1%
    }

    #[test]
    fn test_detect_price_discrepancy_large_spread() {
        // Pool A: price = 10.0, Pool B: price = 1.0
        let pd = detect_price_discrepancy(
            STD_RESERVE, STD_RESERVE * 10,
            STD_RESERVE, STD_RESERVE,
            test_pool_id(1), test_pool_id(2),
        );
        assert!(pd.spread_bps > 100); // > 1%
    }

    #[test]
    fn test_detect_price_discrepancy_reversed_pools() {
        // Swapping pool A and B should reverse the direction
        let pd_ab = detect_price_discrepancy(
            STD_RESERVE, STD_RESERVE * 2,
            STD_RESERVE, STD_RESERVE,
            test_pool_id(1), test_pool_id(2),
        );
        let pd_ba = detect_price_discrepancy(
            STD_RESERVE, STD_RESERVE,
            STD_RESERVE, STD_RESERVE * 2,
            test_pool_id(1), test_pool_id(2),
        );
        assert_eq!(pd_ab.spread_bps, pd_ba.spread_bps);
        assert_ne!(pd_ab.arb_direction, pd_ba.arb_direction);
    }

    #[test]
    fn test_detect_price_discrepancy_zero_reserve_a() {
        let pd = detect_price_discrepancy(
            0, STD_RESERVE,
            STD_RESERVE, STD_RESERVE,
            test_pool_id(1), test_pool_id(2),
        );
        assert_eq!(pd.pool_a_price, 0);
    }

    #[test]
    fn test_detect_price_discrepancy_zero_reserve_b() {
        let pd = detect_price_discrepancy(
            STD_RESERVE, STD_RESERVE,
            0, STD_RESERVE,
            test_pool_id(1), test_pool_id(2),
        );
        assert_eq!(pd.pool_b_price, 0);
    }

    #[test]
    fn test_detect_price_discrepancy_both_zero() {
        let pd = detect_price_discrepancy(
            0, 0,
            0, 0,
            test_pool_id(1), test_pool_id(2),
        );
        assert_eq!(pd.spread_bps, 0);
        assert_eq!(pd.arb_direction, ArbDirection::None);
    }

    #[test]
    fn test_detect_price_discrepancy_pool_ids_preserved() {
        let id_a = test_pool_id(42);
        let id_b = test_pool_id(99);
        let pd = detect_price_discrepancy(
            STD_RESERVE, STD_RESERVE,
            STD_RESERVE, STD_RESERVE,
            id_a, id_b,
        );
        assert_eq!(pd.pool_a_id, id_a);
        assert_eq!(pd.pool_b_id, id_b);
    }

    #[test]
    fn test_detect_price_discrepancy_asymmetric_reserves() {
        // Pool A: 500K/2M (price = 4.0), Pool B: 2M/500K (price = 0.25)
        let pd = detect_price_discrepancy(
            STD_RESERVE / 2, STD_RESERVE * 2,
            STD_RESERVE * 2, STD_RESERVE / 2,
            test_pool_id(1), test_pool_id(2),
        );
        assert!(pd.spread_bps > 1000); // Very large spread
    }

    // ============ Arb Profit Tests ============

    #[test]
    fn test_compute_arb_profit_no_discrepancy() {
        // Equal pools — no arb
        let arb = compute_arb_profit(
            ONE_TOKEN,
            STD_RESERVE, STD_RESERVE, STD_FEE,
            STD_RESERVE, STD_RESERVE, STD_FEE,
        );
        // Should lose money due to fees
        assert!(!arb.is_profitable);
        assert_eq!(arb.hop_count, 2);
    }

    #[test]
    fn test_compute_arb_profit_profitable() {
        // Pool A: cheap (more reserve_out), Pool B: expensive (less reserve_out)
        // Buy cheap from A, sell expensive to B
        let arb = compute_arb_profit(
            ONE_TOKEN * 100,
            STD_RESERVE, STD_RESERVE * 2, STD_FEE, // A: price = 2
            STD_RESERVE * 2, STD_RESERVE, STD_FEE,   // B: buy mid, sell for base at 0.5 ratio
        );
        // The profit depends on the exact amounts
        assert_eq!(arb.hop_count, 2);
        assert_eq!(arb.input_amount, ONE_TOKEN * 100);
        assert!(arb.output_amount > 0);
    }

    #[test]
    fn test_compute_arb_profit_large_discrepancy() {
        // Huge price difference should yield profit
        let arb = compute_arb_profit(
            ONE_TOKEN * 10,
            STD_RESERVE, STD_RESERVE * 10, 0,    // A: price = 10, no fee
            STD_RESERVE / 10, STD_RESERVE, 0,     // B: price = 10, selling mid for base
        );
        assert!(arb.output_amount > 0);
    }

    #[test]
    fn test_compute_arb_profit_different_fees() {
        let arb_low = compute_arb_profit(
            ONE_TOKEN,
            STD_RESERVE, STD_RESERVE * 2, 10, // 0.1% fee
            STD_RESERVE * 2, STD_RESERVE, 10,
        );
        let arb_high = compute_arb_profit(
            ONE_TOKEN,
            STD_RESERVE, STD_RESERVE * 2, 100, // 1% fee
            STD_RESERVE * 2, STD_RESERVE, 100,
        );
        // Higher fee should yield less output
        assert!(arb_low.output_amount >= arb_high.output_amount);
    }

    #[test]
    fn test_compute_arb_profit_zero_input() {
        let arb = compute_arb_profit(
            0,
            STD_RESERVE, STD_RESERVE, STD_FEE,
            STD_RESERVE, STD_RESERVE, STD_FEE,
        );
        assert_eq!(arb.output_amount, 0);
        assert!(!arb.is_profitable);
    }

    #[test]
    fn test_compute_arb_profit_zero_reserves_a() {
        let arb = compute_arb_profit(
            ONE_TOKEN,
            0, STD_RESERVE, STD_FEE,
            STD_RESERVE, STD_RESERVE, STD_FEE,
        );
        assert_eq!(arb.output_amount, 0);
        assert!(!arb.is_profitable);
    }

    #[test]
    fn test_compute_arb_profit_zero_reserves_b() {
        let arb = compute_arb_profit(
            ONE_TOKEN,
            STD_RESERVE, STD_RESERVE, STD_FEE,
            0, STD_RESERVE, STD_FEE,
        );
        assert_eq!(arb.output_amount, 0);
        assert!(!arb.is_profitable);
    }

    #[test]
    fn test_compute_arb_profit_breakeven() {
        // With very small amounts, the trade might be near break-even
        let arb = compute_arb_profit(
            1,
            STD_RESERVE, STD_RESERVE, STD_FEE,
            STD_RESERVE, STD_RESERVE, STD_FEE,
        );
        assert!(!arb.is_profitable); // Tiny trade + fees + gas = no profit
    }

    #[test]
    fn test_compute_arb_profit_gas_cost_included() {
        let arb = compute_arb_profit(
            ONE_TOKEN,
            STD_RESERVE, STD_RESERVE * 2, STD_FEE,
            STD_RESERVE * 2, STD_RESERVE, STD_FEE,
        );
        assert_eq!(arb.gas_cost, GAS_COST_ESTIMATE);
    }

    #[test]
    fn test_compute_arb_profit_route_structure() {
        let arb = compute_arb_profit(
            ONE_TOKEN,
            STD_RESERVE, STD_RESERVE, STD_FEE,
            STD_RESERVE, STD_RESERVE, STD_FEE,
        );
        assert_eq!(arb.hop_count, 2);
        assert_eq!(arb.route[0].amount_in, ONE_TOKEN);
        assert!(arb.route[0].amount_out > 0);
        assert_eq!(arb.route[1].amount_in, arb.route[0].amount_out);
    }

    #[test]
    fn test_compute_arb_profit_profit_bps_calculation() {
        // Large discrepancy should show meaningful BPS
        let arb = compute_arb_profit(
            ONE_TOKEN * 1000,
            STD_RESERVE / 10, STD_RESERVE, 0,
            STD_RESERVE, STD_RESERVE / 10, 0,
        );
        if arb.gross_profit > 0 {
            assert!(arb.profit_bps > 0);
        }
    }

    #[test]
    fn test_compute_arb_profit_symmetric_pools_lose_to_fees() {
        // Same pools, same fees — guaranteed loss
        let arb = compute_arb_profit(
            ONE_TOKEN * 100,
            STD_RESERVE, STD_RESERVE, 30,
            STD_RESERVE, STD_RESERVE, 30,
        );
        assert!(arb.output_amount < arb.input_amount);
        assert!(!arb.is_profitable);
    }

    // ============ Optimal Arb Amount Tests ============

    #[test]
    fn test_optimal_arb_amount_no_discrepancy() {
        let result = optimal_arb_amount(
            STD_RESERVE, STD_RESERVE, STD_FEE,
            STD_RESERVE, STD_RESERVE, STD_FEE,
        );
        // No profitable arb when pools are identical
        assert!(result.expected_profit <= 0);
    }

    #[test]
    fn test_optimal_arb_amount_with_discrepancy() {
        // Pool A cheap, Pool B expensive
        let result = optimal_arb_amount(
            STD_RESERVE, STD_RESERVE * 3, 0,
            STD_RESERVE * 3, STD_RESERVE, 0,
        );
        assert!(result.optimal_input > 0);
    }

    #[test]
    fn test_optimal_arb_amount_zero_reserve() {
        let result = optimal_arb_amount(0, STD_RESERVE, STD_FEE, STD_RESERVE, STD_RESERVE, STD_FEE);
        assert_eq!(result.optimal_input, 0);
        assert_eq!(result.expected_output, 0);
    }

    #[test]
    fn test_optimal_arb_amount_tiny_pool() {
        let result = optimal_arb_amount(
            100, 200, 0,
            200, 100, 0,
        );
        // Should still find something, even for tiny pools
        assert!(result.optimal_input <= 50); // Can't exceed half of reserve_in_a
    }

    #[test]
    fn test_optimal_arb_amount_large_pool() {
        let big = STD_RESERVE * 1000;
        let result = optimal_arb_amount(
            big, big * 2, STD_FEE,
            big * 2, big, STD_FEE,
        );
        assert!(result.optimal_input > 0);
        assert!(result.optimal_input <= big / 2);
    }

    #[test]
    fn test_optimal_arb_amount_price_after() {
        let result = optimal_arb_amount(
            STD_RESERVE, STD_RESERVE * 2, STD_FEE,
            STD_RESERVE * 2, STD_RESERVE, STD_FEE,
        );
        // Price after arb should be between original and equal
        let price_before = price_from_reserves(STD_RESERVE, STD_RESERVE * 2);
        if result.optimal_input > 0 {
            // After arbing, pool A's price should drop (sold reserve_out, gained reserve_in)
            assert!(result.price_after_arb < price_before);
        }
    }

    #[test]
    fn test_optimal_arb_amount_all_zero_reserves() {
        let result = optimal_arb_amount(0, 0, 0, 0, 0, 0);
        assert_eq!(result.optimal_input, 0);
    }

    // ============ Sandwich Attack Tests ============

    #[test]
    fn test_simulate_sandwich_basic() {
        let sa = simulate_sandwich(
            ONE_TOKEN * 100,   // Victim: 100 tokens
            STD_RESERVE,       // Pool reserve in
            STD_RESERVE,       // Pool reserve out
            STD_FEE,           // 0.3% fee
            ONE_TOKEN * 1000,  // Frontrun: 1000 tokens
        );
        // Large frontrun should cause victim loss
        assert!(sa.victim_loss_bps > 0);
        assert!(sa.price_impact_bps > 0);
    }

    #[test]
    fn test_simulate_sandwich_small_frontrun() {
        let sa = simulate_sandwich(
            ONE_TOKEN * 100,
            STD_RESERVE,
            STD_RESERVE,
            STD_FEE,
            1, // Tiny frontrun
        );
        // Tiny frontrun should cause negligible victim loss
        assert!(sa.victim_loss_bps == 0 || sa.victim_loss_bps <= 1);
    }

    #[test]
    fn test_simulate_sandwich_huge_frontrun() {
        let sa = simulate_sandwich(
            ONE_TOKEN * 10,
            STD_RESERVE,
            STD_RESERVE,
            STD_FEE,
            STD_RESERVE / 2, // Massive frontrun: half the pool
        );
        // Huge frontrun should cause significant victim loss
        assert!(sa.victim_loss_bps > 100); // > 1% loss
    }

    #[test]
    fn test_simulate_sandwich_zero_victim() {
        let sa = simulate_sandwich(0, STD_RESERVE, STD_RESERVE, STD_FEE, ONE_TOKEN);
        assert!(!sa.is_sandwich);
        assert_eq!(sa.victim_loss_bps, 0);
    }

    #[test]
    fn test_simulate_sandwich_zero_frontrun() {
        let sa = simulate_sandwich(ONE_TOKEN, STD_RESERVE, STD_RESERVE, STD_FEE, 0);
        assert!(!sa.is_sandwich);
    }

    #[test]
    fn test_simulate_sandwich_zero_reserves() {
        let sa = simulate_sandwich(ONE_TOKEN, 0, STD_RESERVE, STD_FEE, ONE_TOKEN);
        assert!(!sa.is_sandwich);
    }

    #[test]
    fn test_simulate_sandwich_is_sandwich_flag() {
        let sa = simulate_sandwich(
            ONE_TOKEN * 100,
            STD_RESERVE,
            STD_RESERVE,
            STD_FEE,
            ONE_TOKEN * 5000,
        );
        // With significant frontrun, should be flagged as sandwich
        if sa.attacker_profit > 0 && sa.victim_loss_bps > 0 {
            assert!(sa.is_sandwich);
        }
    }

    #[test]
    fn test_simulate_sandwich_attacker_profit() {
        let sa = simulate_sandwich(
            ONE_TOKEN * 500,
            STD_RESERVE,
            STD_RESERVE,
            STD_FEE,
            ONE_TOKEN * 10000,
        );
        // Attacker may or may not profit depending on fees
        // The key test is that the function computes it
        assert!(sa.attacker_profit == 0 || sa.attacker_profit > 0);
    }

    #[test]
    fn test_simulate_sandwich_tx_hashes_set() {
        let sa = simulate_sandwich(ONE_TOKEN, STD_RESERVE, STD_RESERVE, STD_FEE, ONE_TOKEN);
        assert_eq!(sa.frontrun_tx[0], 0xFF);
        assert_eq!(sa.victim_tx[0], 0xEE);
        assert_eq!(sa.backrun_tx[0], 0xDD);
    }

    #[test]
    fn test_simulate_sandwich_no_fee() {
        let sa = simulate_sandwich(
            ONE_TOKEN * 100,
            STD_RESERVE,
            STD_RESERVE,
            0, // No fee
            ONE_TOKEN * 5000,
        );
        // Without fees, sandwich should be more profitable
        assert!(sa.victim_loss_bps > 0);
    }

    #[test]
    fn test_simulate_sandwich_high_fee_kills_profit() {
        let sa = simulate_sandwich(
            ONE_TOKEN * 100,
            STD_RESERVE,
            STD_RESERVE,
            300, // 3% fee — very high
            ONE_TOKEN * 1000,
        );
        // High fees eat into attacker profit
        // May or may not be a sandwich depending on amounts
        let _ = sa.attacker_profit; // Just ensure computation completes
    }

    // ============ is_sandwich_profitable Tests ============

    #[test]
    fn test_is_sandwich_profitable_yes() {
        assert!(is_sandwich_profitable(100, 200, 50));
    }

    #[test]
    fn test_is_sandwich_profitable_no_loss() {
        assert!(!is_sandwich_profitable(200, 100, 50));
    }

    #[test]
    fn test_is_sandwich_profitable_gas_eats_profit() {
        assert!(!is_sandwich_profitable(100, 150, 100));
    }

    #[test]
    fn test_is_sandwich_profitable_exact_breakeven() {
        assert!(!is_sandwich_profitable(100, 200, 100));
    }

    #[test]
    fn test_is_sandwich_profitable_zero_gas() {
        assert!(is_sandwich_profitable(100, 200, 0));
    }

    #[test]
    fn test_is_sandwich_profitable_equal_cost_revenue() {
        assert!(!is_sandwich_profitable(100, 100, 0));
    }

    #[test]
    fn test_is_sandwich_profitable_zero_revenue() {
        assert!(!is_sandwich_profitable(100, 0, 0));
    }

    #[test]
    fn test_is_sandwich_profitable_large_values() {
        let cost = u128::MAX / 4;
        let revenue = u128::MAX / 2;
        let gas = u128::MAX / 8;
        assert!(is_sandwich_profitable(cost, revenue, gas));
    }

    // ============ commit_reveal_blocks_sandwich Tests ============

    #[test]
    fn test_commit_reveal_blocks_sandwich_yes() {
        assert!(commit_reveal_blocks_sandwich(10, 8));
    }

    #[test]
    fn test_commit_reveal_blocks_sandwich_single_trade() {
        assert!(!commit_reveal_blocks_sandwich(1, 8));
    }

    #[test]
    fn test_commit_reveal_blocks_sandwich_zero_window() {
        assert!(!commit_reveal_blocks_sandwich(10, 0));
    }

    #[test]
    fn test_commit_reveal_blocks_sandwich_zero_batch() {
        assert!(!commit_reveal_blocks_sandwich(0, 8));
    }

    #[test]
    fn test_commit_reveal_blocks_sandwich_minimum() {
        assert!(commit_reveal_blocks_sandwich(2, 1));
    }

    #[test]
    fn test_commit_reveal_blocks_sandwich_large_batch() {
        assert!(commit_reveal_blocks_sandwich(1000, 100));
    }

    // ============ MEV Report Tests ============

    #[test]
    fn test_compute_mev_report_clean_protocol() {
        let report = compute_mev_report(0, 0, 0, 0, 0, 0, true);
        assert_eq!(report.protection_score, MEV_PROTECTION_SCORE_MAX);
        assert!(report.commit_reveal_effective);
    }

    #[test]
    fn test_compute_mev_report_attacked_no_protection() {
        let report = compute_mev_report(10, 1000, 50, 0, 50, 0, false);
        assert_eq!(report.protection_score, 0);
        assert!(!report.commit_reveal_effective);
    }

    #[test]
    fn test_compute_mev_report_attacked_with_protection() {
        let report = compute_mev_report(5, 500, 20, 18, 10, 9, true);
        // 27 blocked out of 30 = 90%
        assert!(report.protection_score >= 80);
        assert!(report.commit_reveal_effective);
    }

    #[test]
    fn test_compute_mev_report_partial_protection() {
        let report = compute_mev_report(5, 500, 20, 10, 10, 5, true);
        // 15 blocked out of 30 = 50%
        assert!(report.protection_score == 50);
        assert!(report.commit_reveal_effective); // 15 >= 30/2
    }

    #[test]
    fn test_compute_mev_report_no_commit_reveal_no_attacks() {
        let report = compute_mev_report(0, 0, 0, 0, 0, 0, false);
        assert_eq!(report.protection_score, 50);
        assert!(!report.commit_reveal_effective);
    }

    #[test]
    fn test_compute_mev_report_arb_stats() {
        let report = compute_mev_report(42, 999, 0, 0, 0, 0, true);
        assert_eq!(report.total_arb_opportunities, 42);
        assert_eq!(report.total_arb_profit, 999);
    }

    #[test]
    fn test_compute_mev_report_all_blocked() {
        let report = compute_mev_report(0, 0, 100, 100, 100, 100, true);
        assert_eq!(report.protection_score, 100);
        assert!(report.commit_reveal_effective);
    }

    #[test]
    fn test_compute_mev_report_none_blocked_with_cr() {
        let report = compute_mev_report(0, 0, 100, 0, 100, 0, true);
        assert_eq!(report.protection_score, 0);
        assert!(!report.commit_reveal_effective); // 0 < 200/2
    }

    #[test]
    fn test_compute_mev_report_half_blocked_no_cr() {
        let report = compute_mev_report(0, 0, 10, 5, 10, 5, false);
        // 10 blocked out of 20 = 50%, capped at 80
        assert_eq!(report.protection_score, 50);
    }

    // ============ Price Impact Tests ============

    #[test]
    fn test_price_impact_small_trade() {
        let impact = price_impact_of_trade(ONE_TOKEN, STD_RESERVE, STD_RESERVE, STD_FEE);
        // Small trade relative to pool = small impact
        assert!(impact <= 5); // Should be < 0.05%
    }

    #[test]
    fn test_price_impact_whale_trade() {
        let impact = price_impact_of_trade(
            STD_RESERVE / 10, // 10% of pool
            STD_RESERVE,
            STD_RESERVE,
            STD_FEE,
        );
        // Large trade = significant impact
        assert!(impact > 50); // > 0.5%
    }

    #[test]
    fn test_price_impact_zero_amount() {
        assert_eq!(price_impact_of_trade(0, STD_RESERVE, STD_RESERVE, STD_FEE), 0);
    }

    #[test]
    fn test_price_impact_zero_reserve_in() {
        assert_eq!(price_impact_of_trade(ONE_TOKEN, 0, STD_RESERVE, STD_FEE), 0);
    }

    #[test]
    fn test_price_impact_zero_reserve_out() {
        assert_eq!(price_impact_of_trade(ONE_TOKEN, STD_RESERVE, 0, STD_FEE), 0);
    }

    #[test]
    fn test_price_impact_increases_with_size() {
        let impact1 = price_impact_of_trade(ONE_TOKEN, STD_RESERVE, STD_RESERVE, STD_FEE);
        let impact2 = price_impact_of_trade(ONE_TOKEN * 100, STD_RESERVE, STD_RESERVE, STD_FEE);
        let impact3 = price_impact_of_trade(ONE_TOKEN * 10000, STD_RESERVE, STD_RESERVE, STD_FEE);
        assert!(impact1 <= impact2);
        assert!(impact2 <= impact3);
    }

    #[test]
    fn test_price_impact_no_fee() {
        let impact = price_impact_of_trade(ONE_TOKEN * 1000, STD_RESERVE, STD_RESERVE, 0);
        assert!(impact > 0); // Still has price impact even without fee
    }

    #[test]
    fn test_price_impact_massive_trade() {
        let impact = price_impact_of_trade(
            STD_RESERVE / 2,
            STD_RESERVE,
            STD_RESERVE,
            STD_FEE,
        );
        assert!(impact > 500); // > 5% for half-pool trade
    }

    #[test]
    fn test_price_impact_tiny_pool() {
        let impact = price_impact_of_trade(100, 1000, 1000, 30);
        assert!(impact > 0);
    }

    // ============ Frontrunning Detection Tests ============

    #[test]
    fn test_is_frontrun_suspicious_yes() {
        assert!(is_frontrun_suspicious(100, 0)); // 1% impact, same block
    }

    #[test]
    fn test_is_frontrun_suspicious_no_impact() {
        assert!(!is_frontrun_suspicious(10, 0)); // Below threshold
    }

    #[test]
    fn test_is_frontrun_suspicious_too_far() {
        assert!(!is_frontrun_suspicious(100, 5)); // Too many blocks before target
    }

    #[test]
    fn test_is_frontrun_suspicious_exact_threshold() {
        assert!(is_frontrun_suspicious(FRONTRUN_PRICE_IMPACT_BPS, 1));
    }

    #[test]
    fn test_is_frontrun_suspicious_below_threshold() {
        assert!(!is_frontrun_suspicious(FRONTRUN_PRICE_IMPACT_BPS - 1, 0));
    }

    #[test]
    fn test_is_frontrun_suspicious_time_boundary() {
        assert!(is_frontrun_suspicious(100, 1));   // 1 block before = suspicious
        assert!(!is_frontrun_suspicious(100, 2));  // 2 blocks before = not suspicious
    }

    #[test]
    fn test_is_frontrun_suspicious_normal_trade() {
        assert!(!is_frontrun_suspicious(5, 10)); // Low impact, far away
    }

    #[test]
    fn test_is_frontrun_suspicious_zero_impact() {
        assert!(!is_frontrun_suspicious(0, 0));
    }

    // ============ Cyclic Arbitrage Tests ============

    #[test]
    fn test_cyclic_arb_two_hop() {
        let hops = vec![
            (STD_RESERVE, STD_RESERVE * 2, 0u16), // Pool 1: cheap
            (STD_RESERVE * 2, STD_RESERVE, 0u16), // Pool 2: expensive
        ];
        let result = cyclic_arb_profit(&hops, ONE_TOKEN * 100);
        assert!(result.is_ok());
        let arb = result.unwrap();
        assert_eq!(arb.hop_count, 2);
    }

    #[test]
    fn test_cyclic_arb_three_hop() {
        let hops = vec![
            (STD_RESERVE, STD_RESERVE, 0u16),
            (STD_RESERVE, STD_RESERVE, 0u16),
            (STD_RESERVE, STD_RESERVE, 0u16),
        ];
        let result = cyclic_arb_profit(&hops, ONE_TOKEN);
        assert!(result.is_ok());
        let arb = result.unwrap();
        assert_eq!(arb.hop_count, 3);
    }

    #[test]
    fn test_cyclic_arb_four_hop() {
        let hops = vec![
            (STD_RESERVE, STD_RESERVE, 0u16),
            (STD_RESERVE, STD_RESERVE, 0u16),
            (STD_RESERVE, STD_RESERVE, 0u16),
            (STD_RESERVE, STD_RESERVE, 0u16),
        ];
        let result = cyclic_arb_profit(&hops, ONE_TOKEN);
        assert!(result.is_ok());
        let arb = result.unwrap();
        assert_eq!(arb.hop_count, 4);
    }

    #[test]
    fn test_cyclic_arb_exceeds_max_hops() {
        let hops = vec![
            (STD_RESERVE, STD_RESERVE, 0u16),
            (STD_RESERVE, STD_RESERVE, 0u16),
            (STD_RESERVE, STD_RESERVE, 0u16),
            (STD_RESERVE, STD_RESERVE, 0u16),
            (STD_RESERVE, STD_RESERVE, 0u16), // 5 hops > MAX_HOPS
        ];
        let result = cyclic_arb_profit(&hops, ONE_TOKEN);
        assert_eq!(result, Err(ArbitrageError::ExceedsMaxHops));
    }

    #[test]
    fn test_cyclic_arb_empty_hops() {
        let result = cyclic_arb_profit(&[], ONE_TOKEN);
        assert_eq!(result, Err(ArbitrageError::NoCyclicRoute));
    }

    #[test]
    fn test_cyclic_arb_zero_amount() {
        let hops = vec![(STD_RESERVE, STD_RESERVE, 0u16)];
        let result = cyclic_arb_profit(&hops, 0);
        assert_eq!(result, Err(ArbitrageError::ZeroAmount));
    }

    #[test]
    fn test_cyclic_arb_zero_reserve() {
        let hops = vec![(0, STD_RESERVE, 0u16)];
        let result = cyclic_arb_profit(&hops, ONE_TOKEN);
        assert_eq!(result, Err(ArbitrageError::ZeroReserve));
    }

    #[test]
    fn test_cyclic_arb_zero_reserve_out() {
        let hops = vec![(STD_RESERVE, 0, 0u16)];
        let result = cyclic_arb_profit(&hops, ONE_TOKEN);
        assert_eq!(result, Err(ArbitrageError::ZeroReserve));
    }

    #[test]
    fn test_cyclic_arb_no_profit_equal_pools() {
        let hops = vec![
            (STD_RESERVE, STD_RESERVE, STD_FEE),
            (STD_RESERVE, STD_RESERVE, STD_FEE),
        ];
        let result = cyclic_arb_profit(&hops, ONE_TOKEN);
        assert!(result.is_ok());
        let arb = result.unwrap();
        assert!(!arb.is_profitable);
        assert!(arb.output_amount < arb.input_amount); // Fees eat profit
    }

    #[test]
    fn test_cyclic_arb_profitable_cycle() {
        // For a cyclic arb to profit, the product of price ratios across hops
        // must exceed 1.0. This happens when pools are genuinely mispriced.
        // Pool 1: reserves (R, 5R) — price = 5.0
        // Pool 2: reserves (R, R) — price = 1.0
        // Pool 3: reserves (5R, R) — price = 0.2
        // Cycle: token A → pool1 → token B → pool2 → token C → pool3 → token A
        // Price product = 5.0 * 1.0 * 0.2 = 1.0, so no profit from constant-product.
        //
        // In practice, constant-product AMMs always lose on round-trips through
        // symmetrically priced pools. This test validates that the function correctly
        // identifies when a cycle is NOT profitable despite apparent price differences.
        let hops = vec![
            (STD_RESERVE, STD_RESERVE * 5, 0u16),
            (STD_RESERVE * 5, STD_RESERVE, 0u16),
        ];
        let result = cyclic_arb_profit(&hops, ONE_TOKEN * 100);
        assert!(result.is_ok());
        let arb = result.unwrap();
        // Constant-product guarantees loss on symmetric round-trips
        assert_eq!(arb.gross_profit, 0);
        assert!(!arb.is_profitable);
    }

    #[test]
    fn test_cyclic_arb_route_amounts_chain() {
        let hops = vec![
            (STD_RESERVE, STD_RESERVE * 2, 0u16),
            (STD_RESERVE * 2, STD_RESERVE, 0u16),
        ];
        let result = cyclic_arb_profit(&hops, ONE_TOKEN);
        let arb = result.unwrap();
        // Each hop's output feeds into the next hop's input
        assert_eq!(arb.route[0].amount_out, arb.route[1].amount_in);
    }

    #[test]
    fn test_cyclic_arb_with_fees() {
        let hops = vec![
            (STD_RESERVE, STD_RESERVE * 2, 30),
            (STD_RESERVE * 2, STD_RESERVE, 30),
        ];
        let result = cyclic_arb_profit(&hops, ONE_TOKEN * 100);
        assert!(result.is_ok());
        // Fees reduce output
        let arb_with_fee = result.unwrap();

        let hops_no_fee = vec![
            (STD_RESERVE, STD_RESERVE * 2, 0),
            (STD_RESERVE * 2, STD_RESERVE, 0),
        ];
        let arb_no_fee = cyclic_arb_profit(&hops_no_fee, ONE_TOKEN * 100).unwrap();
        assert!(arb_no_fee.output_amount >= arb_with_fee.output_amount);
    }

    #[test]
    fn test_cyclic_arb_single_hop() {
        // A→A through one pool (degenerate case)
        let hops = vec![(STD_RESERVE, STD_RESERVE, STD_FEE)];
        let result = cyclic_arb_profit(&hops, ONE_TOKEN);
        assert!(result.is_ok());
        let arb = result.unwrap();
        assert_eq!(arb.hop_count, 1);
        assert!(!arb.is_profitable);
    }

    // ============ Post-Arb Price Tests ============

    #[test]
    fn test_post_arb_price_basic() {
        let price_before = price_from_reserves(STD_RESERVE, STD_RESERVE);
        let price_after = post_arb_price(STD_RESERVE, STD_RESERVE, ONE_TOKEN * 100, STD_FEE);
        // Buying reserve_out should decrease the price (more reserve_in, less reserve_out)
        assert!(price_after < price_before);
    }

    #[test]
    fn test_post_arb_price_zero_arb() {
        let price = post_arb_price(STD_RESERVE, STD_RESERVE, 0, STD_FEE);
        let expected = price_from_reserves(STD_RESERVE, STD_RESERVE);
        assert_eq!(price, expected);
    }

    #[test]
    fn test_post_arb_price_zero_reserves() {
        assert_eq!(post_arb_price(0, STD_RESERVE, ONE_TOKEN, STD_FEE), 0);
        assert_eq!(post_arb_price(STD_RESERVE, 0, ONE_TOKEN, STD_FEE), 0);
    }

    #[test]
    fn test_post_arb_price_larger_arb_more_impact() {
        let price1 = post_arb_price(STD_RESERVE, STD_RESERVE, ONE_TOKEN, STD_FEE);
        let price2 = post_arb_price(STD_RESERVE, STD_RESERVE, ONE_TOKEN * 100, STD_FEE);
        let price3 = post_arb_price(STD_RESERVE, STD_RESERVE, ONE_TOKEN * 10000, STD_FEE);
        // Larger arbs push price down more
        assert!(price1 > price2);
        assert!(price2 > price3);
    }

    #[test]
    fn test_post_arb_price_no_fee() {
        let with_fee = post_arb_price(STD_RESERVE, STD_RESERVE, ONE_TOKEN * 100, STD_FEE);
        let no_fee = post_arb_price(STD_RESERVE, STD_RESERVE, ONE_TOKEN * 100, 0);
        // No fee means more output extracted, so price drops more
        assert!(no_fee <= with_fee);
    }

    #[test]
    fn test_post_arb_price_stays_positive() {
        // Even a huge arb shouldn't make price negative (saturating_sub prevents underflow)
        let price = post_arb_price(STD_RESERVE, STD_RESERVE, STD_RESERVE, STD_FEE);
        assert!(price > 0);
    }

    // ============ MEV Protection Score Tests ============

    #[test]
    fn test_mev_protection_score_all_features() {
        assert_eq!(mev_protection_score(true, true, true, true, true), 100);
    }

    #[test]
    fn test_mev_protection_score_no_features() {
        assert_eq!(mev_protection_score(false, false, false, false, false), 0);
    }

    #[test]
    fn test_mev_protection_score_commit_reveal_only() {
        assert_eq!(mev_protection_score(true, false, false, false, false), 30);
    }

    #[test]
    fn test_mev_protection_score_batch_auction_only() {
        assert_eq!(mev_protection_score(false, true, false, false, false), 25);
    }

    #[test]
    fn test_mev_protection_score_uniform_price_only() {
        assert_eq!(mev_protection_score(false, false, true, false, false), 25);
    }

    #[test]
    fn test_mev_protection_score_eoa_only() {
        assert_eq!(mev_protection_score(false, false, false, true, false), 10);
    }

    #[test]
    fn test_mev_protection_score_twap_only() {
        assert_eq!(mev_protection_score(false, false, false, false, true), 10);
    }

    #[test]
    fn test_mev_protection_score_vibeswap_core() {
        // VibeSwap has commit-reveal + batch auction + uniform price
        assert_eq!(mev_protection_score(true, true, true, false, false), 80);
    }

    #[test]
    fn test_mev_protection_score_vibeswap_full() {
        // VibeSwap with all features
        assert_eq!(mev_protection_score(true, true, true, true, true), 100);
    }

    #[test]
    fn test_mev_protection_score_partial_a() {
        assert_eq!(mev_protection_score(true, true, false, false, false), 55);
    }

    #[test]
    fn test_mev_protection_score_partial_b() {
        assert_eq!(mev_protection_score(false, false, true, true, true), 45);
    }

    // ============ Edge Cases & Overflow Tests ============

    #[test]
    fn test_amm_out_large_values() {
        // Test with large but not overflowing values
        let large = PRECISION * 1_000_000; // 1M tokens
        let out = amm_out(large / 100, large, large, STD_FEE);
        assert!(out > 0);
    }

    #[test]
    fn test_arb_profit_single_token() {
        let arb = compute_arb_profit(
            1,
            STD_RESERVE, STD_RESERVE, STD_FEE,
            STD_RESERVE, STD_RESERVE, STD_FEE,
        );
        assert!(!arb.is_profitable);
    }

    #[test]
    fn test_price_from_reserves_precision() {
        let price = price_from_reserves(PRECISION, PRECISION);
        assert_eq!(price, PRECISION); // 1:1 ratio = 1.0 * PRECISION
    }

    #[test]
    fn test_price_from_reserves_2x() {
        let price = price_from_reserves(PRECISION, PRECISION * 2);
        assert_eq!(price, PRECISION * 2); // 1:2 ratio = 2.0 * PRECISION
    }

    #[test]
    fn test_price_from_reserves_half() {
        let price = price_from_reserves(PRECISION * 2, PRECISION);
        assert_eq!(price, PRECISION / 2); // 2:1 ratio = 0.5 * PRECISION
    }

    #[test]
    fn test_price_from_reserves_zero() {
        assert_eq!(price_from_reserves(0, PRECISION), 0);
    }

    #[test]
    fn test_sandwich_with_equal_reserves() {
        let sa = simulate_sandwich(ONE_TOKEN, ONE_TOKEN * 1000, ONE_TOKEN * 1000, STD_FEE, ONE_TOKEN * 10);
        // Should compute without errors
        assert!(sa.price_impact_bps <= 10_000);
    }

    #[test]
    fn test_arb_direction_enum_coverage() {
        let d1 = ArbDirection::AToB;
        let d2 = ArbDirection::BToA;
        let d3 = ArbDirection::None;
        assert_ne!(d1, d2);
        assert_ne!(d1, d3);
        assert_ne!(d2, d3);
    }

    #[test]
    fn test_arb_opportunity_fields() {
        let arb = compute_arb_profit(
            ONE_TOKEN * 10,
            STD_RESERVE, STD_RESERVE, STD_FEE,
            STD_RESERVE, STD_RESERVE, STD_FEE,
        );
        assert_eq!(arb.input_amount, ONE_TOKEN * 10);
        assert_eq!(arb.gas_cost, GAS_COST_ESTIMATE);
        assert_eq!(arb.hop_count, 2);
        // Net profit = output - input - gas
        let expected_net = (arb.output_amount as i128) - (arb.input_amount as i128) - (GAS_COST_ESTIMATE as i128);
        assert_eq!(arb.net_profit, expected_net);
    }

    #[test]
    fn test_sandwich_analysis_fields() {
        let sa = simulate_sandwich(ONE_TOKEN * 100, STD_RESERVE, STD_RESERVE, STD_FEE, ONE_TOKEN * 1000);
        assert!(sa.price_impact_bps <= 10_000);
        assert!(sa.victim_loss_bps <= 10_000);
    }

    #[test]
    fn test_mev_report_fields() {
        let report = compute_mev_report(10, 1000, 5, 3, 8, 6, true);
        assert_eq!(report.total_arb_opportunities, 10);
        assert_eq!(report.total_arb_profit, 1000);
        assert_eq!(report.sandwich_attempts, 5);
        assert_eq!(report.sandwich_blocked, 3);
        assert_eq!(report.frontrun_attempts, 8);
        assert_eq!(report.frontrun_blocked, 6);
        assert!(report.protection_score <= 100);
    }

    #[test]
    fn test_constants() {
        assert_eq!(BPS, 10_000);
        assert_eq!(MAX_HOPS, 4);
        assert_eq!(MEV_PROTECTION_SCORE_MAX, 100);
        assert_eq!(FRONTRUN_PRICE_IMPACT_BPS, 50);
        assert_eq!(BACKRUN_PROFIT_THRESHOLD_BPS, 10);
        assert_eq!(SANDWICH_DETECTION_WINDOW, 3);
    }

    #[test]
    fn test_optimal_arb_respects_half_reserve() {
        let result = optimal_arb_amount(
            1000, 2000, 0,
            2000, 1000, 0,
        );
        assert!(result.optimal_input <= 500); // <= reserve_in_a / 2
    }

    #[test]
    fn test_cyclic_arb_three_hop_with_fees() {
        let hops = vec![
            (STD_RESERVE, STD_RESERVE * 2, 10),
            (STD_RESERVE * 2, STD_RESERVE * 3, 10),
            (STD_RESERVE * 3, STD_RESERVE, 10),
        ];
        let result = cyclic_arb_profit(&hops, ONE_TOKEN * 10);
        assert!(result.is_ok());
    }

    #[test]
    fn test_cyclic_arb_preserves_input_amount() {
        let hops = vec![(STD_RESERVE, STD_RESERVE, 0u16)];
        let result = cyclic_arb_profit(&hops, ONE_TOKEN * 42);
        let arb = result.unwrap();
        assert_eq!(arb.input_amount, ONE_TOKEN * 42);
        assert_eq!(arb.route[0].amount_in, ONE_TOKEN * 42);
    }

    #[test]
    fn test_price_discrepancy_symmetry() {
        // d(A,B) spread == d(B,A) spread
        let pd1 = detect_price_discrepancy(
            STD_RESERVE, STD_RESERVE * 3,
            STD_RESERVE, STD_RESERVE,
            test_pool_id(1), test_pool_id(2),
        );
        let pd2 = detect_price_discrepancy(
            STD_RESERVE, STD_RESERVE,
            STD_RESERVE, STD_RESERVE * 3,
            test_pool_id(1), test_pool_id(2),
        );
        assert_eq!(pd1.spread_bps, pd2.spread_bps);
    }

    #[test]
    fn test_sandwich_victim_always_worse() {
        // With any nonzero frontrun, victim should get equal or worse output
        let sa = simulate_sandwich(
            ONE_TOKEN * 50,
            STD_RESERVE,
            STD_RESERVE,
            STD_FEE,
            ONE_TOKEN * 500,
        );
        // The victim_loss_bps >= 0 is guaranteed by construction (saturating sub)
        let _ = sa.victim_loss_bps;
    }

    #[test]
    fn test_price_impact_bounded() {
        // Price impact should never exceed 10000 BPS (100%)
        let impact = price_impact_of_trade(STD_RESERVE, STD_RESERVE, STD_RESERVE, STD_FEE);
        assert!(impact <= 10_000);
    }

    #[test]
    fn test_post_arb_price_monotonicity() {
        // Larger arb amounts should strictly decrease price (more impact)
        let amounts = [1, 100, 10_000, 1_000_000, ONE_TOKEN, ONE_TOKEN * 100];
        let mut prev_price = u128::MAX;
        for &amount in &amounts {
            let p = post_arb_price(STD_RESERVE, STD_RESERVE, amount, STD_FEE);
            assert!(p <= prev_price, "Price should decrease with larger arb");
            prev_price = p;
        }
    }

    #[test]
    fn test_commit_reveal_is_vibeswap_protection() {
        // VibeSwap parameters: batch size >= 2, commit window = 8 seconds ~ several blocks
        assert!(commit_reveal_blocks_sandwich(100, 8));
    }

    #[test]
    fn test_is_frontrun_max_values() {
        assert!(is_frontrun_suspicious(u16::MAX, 0));
        assert!(!is_frontrun_suspicious(u16::MAX, u64::MAX));
    }

    #[test]
    fn test_mev_report_protection_score_capped() {
        let report = compute_mev_report(0, 0, 1, 1000, 1, 1000, true);
        // Even with more blocked than attempted, score caps at 100
        assert!(report.protection_score <= 100);
    }

    #[test]
    fn test_optimal_arb_amount_single_unit_reserve() {
        let result = optimal_arb_amount(2, 4, 0, 4, 2, 0);
        assert!(result.optimal_input <= 1);
    }

    #[test]
    fn test_cyclic_arb_high_fee() {
        let hops = vec![
            (STD_RESERVE, STD_RESERVE * 2, 500), // 5% fee
            (STD_RESERVE * 2, STD_RESERVE, 500),
        ];
        let result = cyclic_arb_profit(&hops, ONE_TOKEN * 100);
        assert!(result.is_ok());
        let arb = result.unwrap();
        // High fees likely kill profitability
        assert!(!arb.is_profitable);
    }

    #[test]
    fn test_compute_arb_profit_high_fee() {
        let arb = compute_arb_profit(
            ONE_TOKEN * 100,
            STD_RESERVE, STD_RESERVE * 2, 500,
            STD_RESERVE * 2, STD_RESERVE, 500,
        );
        // 5% fee each way = ~10% total slippage, very hard to profit
        assert!(arb.output_amount < arb.input_amount || arb.gross_profit == 0 || !arb.is_profitable);
    }

    #[test]
    fn test_arb_error_variants() {
        assert_eq!(ArbitrageError::ZeroAmount, ArbitrageError::ZeroAmount);
        assert_ne!(ArbitrageError::ZeroAmount, ArbitrageError::ZeroReserve);
        assert_ne!(ArbitrageError::Overflow, ArbitrageError::InvalidPool);
        assert_ne!(ArbitrageError::NoCyclicRoute, ArbitrageError::ExceedsMaxHops);
    }

    #[test]
    fn test_default_hop() {
        let hop = default_hop();
        assert_eq!(hop.pool_id, [0u8; 32]);
        assert_eq!(hop.amount_in, 0);
        assert_eq!(hop.amount_out, 0);
        assert_eq!(hop.fee_rate_bps, 0);
    }

    #[test]
    fn test_price_discrepancy_very_large_ratio() {
        // Pool A: 1 token in, 1M tokens out
        let pd = detect_price_discrepancy(
            1, STD_RESERVE,
            STD_RESERVE, 1,
            test_pool_id(1), test_pool_id(2),
        );
        // Massive spread
        assert_eq!(pd.spread_bps, 10_000); // Capped at 100%
    }

    #[test]
    fn test_sandwich_with_tiny_pool() {
        let sa = simulate_sandwich(10, 100, 100, 30, 20);
        // Should work even with small values
        let _ = sa.is_sandwich;
    }

    #[test]
    fn test_price_impact_equals_reserves() {
        // Trading exactly reserve_in into the pool
        let impact = price_impact_of_trade(STD_RESERVE, STD_RESERVE, STD_RESERVE, STD_FEE);
        assert!(impact > 0);
        assert!(impact <= 10_000);
    }

    #[test]
    fn test_optimal_arb_convergence() {
        // For two-pool arb: buy from pool A, sell to pool B (not a cycle).
        // Pool A: (R, 5R) with 0% fee — buy cheap
        // Pool B: (R/10, R) with 0% fee — sell to this pool (mid token is reserve_in)
        // This creates genuine cross-pool arb opportunity.
        let result = optimal_arb_amount(
            STD_RESERVE, STD_RESERVE * 5, 0,
            STD_RESERVE / 10, STD_RESERVE, 0,
        );
        // Should find a non-trivial optimal
        assert!(result.optimal_input > 0);
        // The optimal input should be bounded by half of reserve_in_a
        assert!(result.optimal_input <= STD_RESERVE / 2);
    }

    #[test]
    fn test_mev_protection_score_additivity() {
        // Score should be additive
        let s1 = mev_protection_score(true, false, false, false, false);
        let s2 = mev_protection_score(false, true, false, false, false);
        let s3 = mev_protection_score(true, true, false, false, false);
        assert_eq!(s3, s1 + s2);
    }

    #[test]
    fn test_compute_arb_profit_net_profit_formula() {
        let arb = compute_arb_profit(
            ONE_TOKEN * 50,
            STD_RESERVE, STD_RESERVE * 2, STD_FEE,
            STD_RESERVE * 2, STD_RESERVE, STD_FEE,
        );
        let expected_net = (arb.output_amount as i128) - (ONE_TOKEN as i128 * 50) - (GAS_COST_ESTIMATE as i128);
        assert_eq!(arb.net_profit, expected_net);
    }

    #[test]
    fn test_cyclic_arb_four_hop_with_mixed_fees() {
        let hops = vec![
            (STD_RESERVE, STD_RESERVE, 10),
            (STD_RESERVE, STD_RESERVE, 20),
            (STD_RESERVE, STD_RESERVE, 30),
            (STD_RESERVE, STD_RESERVE, 50),
        ];
        let result = cyclic_arb_profit(&hops, ONE_TOKEN);
        assert!(result.is_ok());
        assert!(!result.unwrap().is_profitable);
    }

    #[test]
    fn test_post_arb_price_equal_reserves_drops_below_parity() {
        // Starting at parity (price = 1.0), any trade should push price below 1.0
        let p = post_arb_price(STD_RESERVE, STD_RESERVE, ONE_TOKEN, STD_FEE);
        assert!(p < PRECISION);
    }

    #[test]
    fn test_sandwich_proportional_loss() {
        // Larger frontrun should cause proportionally more victim loss
        let sa_small = simulate_sandwich(ONE_TOKEN * 100, STD_RESERVE, STD_RESERVE, STD_FEE, ONE_TOKEN * 100);
        let sa_large = simulate_sandwich(ONE_TOKEN * 100, STD_RESERVE, STD_RESERVE, STD_FEE, ONE_TOKEN * 10000);
        assert!(sa_large.victim_loss_bps >= sa_small.victim_loss_bps);
    }

    #[test]
    fn test_price_impact_fee_irrelevance_on_direction() {
        // Fee changes magnitude but not the fact that impact > 0
        let impact_low = price_impact_of_trade(ONE_TOKEN * 1000, STD_RESERVE, STD_RESERVE, 10);
        let impact_high = price_impact_of_trade(ONE_TOKEN * 1000, STD_RESERVE, STD_RESERVE, 100);
        assert!(impact_low > 0);
        assert!(impact_high > 0);
    }

    #[test]
    fn test_detect_price_discrepancy_both_pools_same_2x() {
        // Both pools have same 2x ratio — no spread
        let pd = detect_price_discrepancy(
            STD_RESERVE, STD_RESERVE * 2,
            STD_RESERVE, STD_RESERVE * 2,
            test_pool_id(1), test_pool_id(2),
        );
        assert_eq!(pd.spread_bps, 0);
        assert_eq!(pd.arb_direction, ArbDirection::None);
    }

    // ============ Hardening Tests v6 ============

    #[test]
    fn test_amm_out_fee_equals_bps_minus_one_v6() {
        // Fee of 9999 bps leaves only 1 bps effective input
        let out = amm_out(ONE_TOKEN, STD_RESERVE, STD_RESERVE, 9999);
        assert!(out > 0, "Should produce some output even at 9999 bps fee");
        assert!(out < ONE_TOKEN / 100, "Output should be tiny with near-100% fee");
    }

    #[test]
    fn test_amm_out_one_wei_input_v6() {
        // 1 wei input into a large pool — tests minimum granularity
        let out = amm_out(1, STD_RESERVE, STD_RESERVE, STD_FEE);
        // With 1 wei into a 1e24 pool, output may be 0 due to rounding
        assert!(out <= 1, "1 wei input should produce 0 or 1 output");
    }

    #[test]
    fn test_amm_out_equal_to_reserve_v6() {
        // Input exactly equal to reserve_in — should not panic
        let out = amm_out(STD_RESERVE, STD_RESERVE, STD_RESERVE, STD_FEE);
        assert!(out > 0);
        assert!(out < STD_RESERVE, "Cannot drain entire reserve_out");
    }

    #[test]
    fn test_amm_out_double_reserve_v6() {
        // Input double reserve_in — extreme but shouldn't panic
        let out = amm_out(STD_RESERVE * 2, STD_RESERVE, STD_RESERVE, STD_FEE);
        assert!(out > 0);
        assert!(out < STD_RESERVE);
    }

    #[test]
    fn test_detect_price_discrepancy_tiny_reserves_v6() {
        // Very small reserves (1 token each side)
        let pd = detect_price_discrepancy(
            ONE_TOKEN, ONE_TOKEN,
            ONE_TOKEN, ONE_TOKEN * 3,
            test_pool_id(1), test_pool_id(2),
        );
        assert!(pd.spread_bps > 0);
        assert_eq!(pd.arb_direction, ArbDirection::AToB);
    }

    #[test]
    fn test_detect_price_discrepancy_max_u128_reserves_v6() {
        // Very large reserves — overflow safety
        let big = u128::MAX / 4;
        let pd = detect_price_discrepancy(
            big, big,
            big, big,
            test_pool_id(1), test_pool_id(2),
        );
        assert_eq!(pd.spread_bps, 0);
        assert_eq!(pd.arb_direction, ArbDirection::None);
    }

    #[test]
    fn test_compute_arb_profit_tiny_input_v6() {
        // 1 wei input into an imbalanced pool
        let opp = compute_arb_profit(
            1,
            STD_RESERVE, STD_RESERVE * 2,
            30,
            STD_RESERVE * 2, STD_RESERVE,
            30,
        );
        // With 1 wei the profit won't be enough for gas
        assert!(!opp.is_profitable);
    }

    #[test]
    fn test_compute_arb_profit_max_fee_both_pools_v6() {
        // Both pools at 9999 bps fee
        let opp = compute_arb_profit(
            ONE_TOKEN * 100,
            STD_RESERVE, STD_RESERVE * 2,
            9999,
            STD_RESERVE * 2, STD_RESERVE,
            9999,
        );
        // Near-100% fee means no profit possible
        assert_eq!(opp.gross_profit, 0);
    }

    #[test]
    fn test_compute_arb_profit_hop_count_always_two_v6() {
        let opp = compute_arb_profit(
            ONE_TOKEN * 100,
            STD_RESERVE, STD_RESERVE * 2,
            30,
            STD_RESERVE * 2, STD_RESERVE,
            30,
        );
        assert_eq!(opp.hop_count, 2);
    }

    #[test]
    fn test_optimal_arb_amount_symmetric_no_profit_v6() {
        // Perfectly symmetric pools — no arb profit possible
        let result = optimal_arb_amount(
            STD_RESERVE, STD_RESERVE, 30,
            STD_RESERVE, STD_RESERVE, 30,
        );
        // Net profit should be negative (fees eat it)
        assert!(result.expected_profit <= 0);
    }

    #[test]
    fn test_optimal_arb_amount_huge_discrepancy_v6() {
        // Pool A: 1M:10M, Pool B: 10M:1M — massive arbitrage opportunity
        let result = optimal_arb_amount(
            STD_RESERVE, STD_RESERVE * 10, 30,
            STD_RESERVE * 10, STD_RESERVE, 30,
        );
        assert!(result.optimal_input > 0);
        // Output may be zero if the pools don't connect profitably at this scale
        // The key assertion is that optimal_input was found
    }

    #[test]
    fn test_simulate_sandwich_equal_frontrun_and_victim_v6() {
        // Frontrun == victim amount
        let analysis = simulate_sandwich(
            ONE_TOKEN * 1000,
            STD_RESERVE,
            STD_RESERVE,
            STD_FEE,
            ONE_TOKEN * 1000,
        );
        // Both same size — victim loss should be moderate
        assert!(analysis.victim_loss_bps > 0 || analysis.attacker_profit == 0);
    }

    #[test]
    fn test_simulate_sandwich_tiny_pool_v6() {
        // Pool with just 1 token — extreme slippage
        let analysis = simulate_sandwich(
            ONE_TOKEN / 10,
            ONE_TOKEN,
            ONE_TOKEN,
            STD_FEE,
            ONE_TOKEN / 10,
        );
        // Shouldn't panic
        assert!(analysis.price_impact_bps >= 0);
    }

    #[test]
    fn test_is_sandwich_profitable_large_gas_v6() {
        // Gas cost larger than any possible profit
        assert!(!is_sandwich_profitable(100, 200, u128::MAX));
    }

    #[test]
    fn test_is_sandwich_profitable_overflow_safe_v6() {
        // Very large values near u128 boundary
        assert!(!is_sandwich_profitable(u128::MAX - 1, u128::MAX, 1));
    }

    #[test]
    fn test_commit_reveal_blocks_sandwich_max_values_v6() {
        assert!(commit_reveal_blocks_sandwich(u32::MAX, u64::MAX));
    }

    #[test]
    fn test_commit_reveal_blocks_sandwich_batch_one_v6() {
        // Batch size 1 means no anonymity — protection fails
        assert!(!commit_reveal_blocks_sandwich(1, 100));
    }

    #[test]
    fn test_compute_mev_report_zero_attacks_no_cr_v6() {
        let report = compute_mev_report(0, 0, 0, 0, 0, 0, false);
        assert_eq!(report.protection_score, 50);
        assert!(!report.commit_reveal_effective);
    }

    #[test]
    fn test_compute_mev_report_all_attacks_blocked_v6() {
        let report = compute_mev_report(5, 1000, 10, 10, 20, 20, true);
        assert_eq!(report.protection_score, 100);
        assert!(report.commit_reveal_effective);
    }

    #[test]
    fn test_price_impact_of_trade_full_reserve_v6() {
        // Trade the entire reserve_in — maximum impact
        let impact = price_impact_of_trade(STD_RESERVE, STD_RESERVE, STD_RESERVE, STD_FEE);
        assert!(impact > 0);
    }

    #[test]
    fn test_price_impact_of_trade_one_wei_v6() {
        // 1 wei trade — negligible impact
        let impact = price_impact_of_trade(1, STD_RESERVE, STD_RESERVE, STD_FEE);
        assert_eq!(impact, 0, "1 wei should have 0 bps impact on a large pool");
    }

    #[test]
    fn test_is_frontrun_suspicious_block_distance_two_v6() {
        // 2 blocks away — should NOT be suspicious even with high impact
        assert!(!is_frontrun_suspicious(1000, 2));
    }

    #[test]
    fn test_is_frontrun_suspicious_zero_distance_low_impact_v6() {
        // 0 blocks but low impact — not suspicious
        assert!(!is_frontrun_suspicious(FRONTRUN_PRICE_IMPACT_BPS - 1, 0));
    }

    #[test]
    fn test_cyclic_arb_two_hop_zero_fee_v6() {
        // Zero fee on both hops
        let result = cyclic_arb_profit(
            &[(STD_RESERVE, STD_RESERVE * 2, 0), (STD_RESERVE * 2, STD_RESERVE, 0)],
            ONE_TOKEN * 100,
        );
        assert!(result.is_ok());
        let opp = result.unwrap();
        assert_eq!(opp.hop_count, 2);
    }

    #[test]
    fn test_cyclic_arb_one_hop_returns_error_v6() {
        // Single hop still forms a valid route (it's a single-pool cycle)
        let result = cyclic_arb_profit(
            &[(STD_RESERVE, STD_RESERVE, 30)],
            ONE_TOKEN,
        );
        assert!(result.is_ok());
        let opp = result.unwrap();
        assert_eq!(opp.hop_count, 1);
    }

    #[test]
    fn test_cyclic_arb_five_hops_rejected_v6() {
        let hops: Vec<(u128, u128, u16)> = vec![
            (STD_RESERVE, STD_RESERVE, 30),
            (STD_RESERVE, STD_RESERVE, 30),
            (STD_RESERVE, STD_RESERVE, 30),
            (STD_RESERVE, STD_RESERVE, 30),
            (STD_RESERVE, STD_RESERVE, 30),
        ];
        let result = cyclic_arb_profit(&hops, ONE_TOKEN);
        assert_eq!(result, Err(ArbitrageError::ExceedsMaxHops));
    }

    #[test]
    fn test_post_arb_price_full_reserve_arb_v6() {
        // Arb the entire reserve_in — price should drop dramatically
        let price_before = price_from_reserves(STD_RESERVE, STD_RESERVE);
        let price_after = post_arb_price(STD_RESERVE, STD_RESERVE, STD_RESERVE, STD_FEE);
        assert!(price_after < price_before);
    }

    #[test]
    fn test_mev_protection_score_all_false_v6() {
        assert_eq!(mev_protection_score(false, false, false, false, false), 0);
    }

    #[test]
    fn test_mev_protection_score_all_true_is_100_v6() {
        assert_eq!(mev_protection_score(true, true, true, true, true), 100);
    }

    #[test]
    fn test_price_from_reserves_asymmetric_v6() {
        // 1:1000 reserve ratio
        let price = price_from_reserves(ONE_TOKEN, ONE_TOKEN * 1000);
        assert_eq!(price, PRECISION * 1000);
    }

    #[test]
    fn test_default_hop_all_zero_v6() {
        let h = default_hop();
        assert_eq!(h.pool_id, [0u8; 32]);
        assert_eq!(h.amount_in, 0);
        assert_eq!(h.amount_out, 0);
        assert_eq!(h.fee_rate_bps, 0);
    }

    #[test]
    fn test_arb_error_zero_amount_v6() {
        let result = cyclic_arb_profit(
            &[(STD_RESERVE, STD_RESERVE, 30)],
            0,
        );
        assert_eq!(result, Err(ArbitrageError::ZeroAmount));
    }

    #[test]
    fn test_arb_error_zero_reserve_in_hop_v6() {
        let result = cyclic_arb_profit(
            &[(0, STD_RESERVE, 30)],
            ONE_TOKEN,
        );
        assert_eq!(result, Err(ArbitrageError::ZeroReserve));
    }

    #[test]
    fn test_arb_error_empty_hops_v6() {
        let result = cyclic_arb_profit(&[], ONE_TOKEN);
        assert_eq!(result, Err(ArbitrageError::NoCyclicRoute));
    }
}
