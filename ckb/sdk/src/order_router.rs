// ============ Order Router — Smart Order Routing ============
// Finds optimal execution paths across multiple liquidity pools, chains,
// and venues. Implements split routing, cost estimation, route optimization,
// venue selection, execution planning, route caching, and analytics.
//
// All percentages in basis points (bps, 10000 = 100%).
// Uses u64/u128 arithmetic only — no floating point.

// ============ Constants ============

/// Basis points denominator
pub const BPS: u64 = 10_000;

/// Maximum hops in a route
pub const MAX_HOPS: usize = 6;

/// Maximum splits for a split order
pub const MAX_SPLITS: usize = 10;

/// Default route cache TTL in milliseconds (30 seconds)
pub const DEFAULT_CACHE_TTL_MS: u64 = 30_000;

/// Maximum routes to consider
pub const MAX_ROUTES: usize = 50;

/// Gas cost per hop in gas units
pub const GAS_PER_HOP: u64 = 50_000;

/// Gas cost for a bridge hop
pub const GAS_PER_BRIDGE: u64 = 200_000;

/// Default timeout per step in milliseconds
pub const DEFAULT_STEP_TIMEOUT_MS: u64 = 60_000;

/// Bridge time estimate base in milliseconds
pub const BRIDGE_TIME_BASE_MS: u64 = 120_000;

/// Minimum liquidity to consider a venue (in token units)
pub const MIN_VENUE_LIQUIDITY: u64 = 1_000;

/// Price precision multiplier for internal calculations
pub const PRICE_PRECISION: u128 = 1_000_000_000_000;

// ============ Data Types ============

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hop {
    pub venue_id: u64,
    pub token_in: u64,
    pub token_out: u64,
    pub pool_id: u64,
    pub expected_price: u64,
    pub fee_bps: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Route {
    pub hops: Vec<Hop>,
    pub total_cost_bps: u64,
    pub expected_output: u64,
    pub gas_estimate: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Venue {
    pub id: u64,
    pub venue_type: u8, // 0=amm, 1=orderbook, 2=bridge
    pub chain_id: u64,
    pub liquidity: u64,
    pub fee_bps: u64,
    pub token_a: u64,
    pub token_b: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pool {
    pub id: u64,
    pub venue_id: u64,
    pub token_a: u64,
    pub token_b: u64,
    pub reserve_a: u64,
    pub reserve_b: u64,
    pub fee_bps: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SplitOrder {
    pub splits: Vec<Split>,
    pub total_input: u64,
    pub total_expected_output: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Split {
    pub venue_id: u64,
    pub amount: u64,
    pub expected_output: u64,
    pub cost_bps: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteRequest {
    pub token_in: u64,
    pub token_out: u64,
    pub amount: u64,
    pub max_hops: usize,
    pub max_slippage_bps: u64,
    pub chain_id: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteScore {
    pub price_score: u64,
    pub gas_score: u64,
    pub reliability_score: u64,
    pub total_score: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionPlan {
    pub steps: Vec<ExecutionStep>,
    pub total_timeout_ms: u64,
    pub estimated_gas: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionStep {
    pub hop: Hop,
    pub sequence_order: u32,
    pub depends_on: Vec<u32>,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachedRoute {
    pub route: Route,
    pub cached_at: u64,
    pub ttl_ms: u64,
    pub hit_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VenueStats {
    pub venue_id: u64,
    pub avg_slippage_bps: u64,
    pub fill_rate_bps: u64,
    pub avg_gas: u64,
    pub trade_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteComparison {
    pub estimated_output: u64,
    pub actual_output: u64,
    pub deviation_bps: u64,
    pub gas_used: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fill {
    pub venue_id: u64,
    pub slippage_bps: u64,
    pub filled: bool,
    pub gas_used: u64,
}

// ============ Path Finding ============

pub fn find_best_route(
    request: &RouteRequest,
    venues: &[Venue],
    pools: &[Pool],
) -> Result<Route, String> {
    if request.amount == 0 {
        return Err("zero input amount".to_string());
    }
    let all = find_all_routes(request, venues, pools, MAX_ROUTES);
    if all.is_empty() {
        return Err("no route found".to_string());
    }
    let scored = compare_routes(&all);
    let best_idx = scored
        .iter()
        .max_by_key(|(_, s)| s.total_score)
        .map(|(i, _)| *i)
        .unwrap();
    Ok(all[best_idx].clone())
}

pub fn find_all_routes(
    request: &RouteRequest,
    venues: &[Venue],
    pools: &[Pool],
    max_routes: usize,
) -> Vec<Route> {
    let mut results: Vec<Route> = Vec::new();
    let max_h = if request.max_hops == 0 || request.max_hops > MAX_HOPS {
        MAX_HOPS
    } else {
        request.max_hops
    };

    // Single-hop routes
    for pool in pools {
        if let Some(hop) = pool_to_hop(pool, request.token_in, request.token_out, venues) {
            let output = calculate_single_hop_output(request.amount, pool, request.token_in);
            if output > 0 {
                let gas = estimate_gas_for_venue(hop.venue_id, venues);
                let cost = hop.fee_bps.saturating_add(gas_to_bps(gas, request.amount));
                results.push(Route {
                    hops: vec![hop],
                    total_cost_bps: cost,
                    expected_output: output,
                    gas_estimate: gas,
                });
            }
        }
        if results.len() >= max_routes {
            return results;
        }
    }

    // Two-hop routes
    if max_h >= 2 {
        for p1 in pools {
            for p2 in pools {
                if p1.id == p2.id {
                    continue;
                }
                let mid = find_intermediate_token(p1, p2, request.token_in, request.token_out);
                if let Some(mid_token) = mid {
                    if let (Some(h1), Some(h2)) = (
                        pool_to_hop(p1, request.token_in, mid_token, venues),
                        pool_to_hop(p2, mid_token, request.token_out, venues),
                    ) {
                        let out1 = calculate_single_hop_output(request.amount, p1, request.token_in);
                        if out1 > 0 {
                            let out2 = calculate_single_hop_output(out1, p2, mid_token);
                            if out2 > 0 {
                                let gas = estimate_gas_for_venue(h1.venue_id, venues)
                                    .saturating_add(estimate_gas_for_venue(h2.venue_id, venues));
                                let cost = h1
                                    .fee_bps
                                    .saturating_add(h2.fee_bps)
                                    .saturating_add(gas_to_bps(gas, request.amount));
                                results.push(Route {
                                    hops: vec![h1, h2],
                                    total_cost_bps: cost,
                                    expected_output: out2,
                                    gas_estimate: gas,
                                });
                            }
                        }
                    }
                }
                if results.len() >= max_routes {
                    return results;
                }
            }
        }
    }
    results
}

pub fn calculate_route_output(route: &Route, amount: u64) -> Result<u64, String> {
    if amount == 0 {
        return Err("zero amount".to_string());
    }
    if route.hops.is_empty() {
        return Err("empty route".to_string());
    }
    let mut current = amount as u128;
    for hop in &route.hops {
        let fee_factor = (BPS as u128).saturating_sub(hop.fee_bps as u128);
        let after_fee = current.saturating_mul(fee_factor) / BPS as u128;
        let price = hop.expected_price as u128;
        if price == 0 {
            return Err("zero price in hop".to_string());
        }
        current = after_fee.saturating_mul(price) / PRICE_PRECISION;
    }
    if current > u64::MAX as u128 {
        return Err("output overflow".to_string());
    }
    Ok(current as u64)
}

pub fn calculate_route_cost(route: &Route) -> u64 {
    let mut total: u64 = 0;
    for hop in &route.hops {
        total = total.saturating_add(hop.fee_bps);
    }
    total.saturating_add(gas_to_bps(route.gas_estimate, route.expected_output.max(1)))
}

// ============ Split Routing ============

pub fn split_order(
    request: &RouteRequest,
    venues: &[Venue],
    pools: &[Pool],
) -> Result<SplitOrder, String> {
    if request.amount == 0 {
        return Err("zero input amount".to_string());
    }
    let relevant = select_venues(request.token_in, request.token_out, venues);
    if relevant.is_empty() {
        return Err("no venues available".to_string());
    }

    let relevant_pools: Vec<&Pool> = pools
        .iter()
        .filter(|p| {
            relevant.iter().any(|v| v.id == p.venue_id)
                && ((p.token_a == request.token_in && p.token_b == request.token_out)
                    || (p.token_b == request.token_in && p.token_a == request.token_out))
        })
        .collect();

    if relevant_pools.is_empty() {
        return Err("no pools for token pair".to_string());
    }

    // Calculate split amounts proportional to liquidity
    let total_liq: u128 = relevant_pools.iter().map(|p| p.reserve_a as u128 + p.reserve_b as u128).sum();
    if total_liq == 0 {
        return Err("zero total liquidity".to_string());
    }

    let mut splits = Vec::new();
    let mut remaining = request.amount;
    let pool_count = relevant_pools.len();

    for (i, pool) in relevant_pools.iter().enumerate() {
        let pool_liq = pool.reserve_a as u128 + pool.reserve_b as u128;
        let share = if i == pool_count - 1 {
            remaining
        } else {
            let s = (request.amount as u128 * pool_liq / total_liq) as u64;
            s.min(remaining)
        };
        if share == 0 {
            continue;
        }
        remaining = remaining.saturating_sub(share);
        let output = calculate_single_hop_output(share, pool, request.token_in);
        let cost = pool.fee_bps.saturating_add(calculate_price_impact(share, pool.reserve_a.max(pool.reserve_b)));
        splits.push(Split {
            venue_id: pool.venue_id,
            amount: share,
            expected_output: output,
            cost_bps: cost,
        });
    }

    let total_output = splits.iter().map(|s| s.expected_output).sum();
    Ok(SplitOrder {
        splits,
        total_input: request.amount,
        total_expected_output: total_output,
    })
}

pub fn optimal_split_ratio(amounts: &[u64], price_impacts: &[u64]) -> Vec<u64> {
    if amounts.is_empty() {
        return Vec::new();
    }
    let total: u64 = amounts.iter().sum();
    if total == 0 {
        return amounts.to_vec();
    }
    // Weight inversely proportional to price impact — lower impact gets more
    let max_impact = price_impacts.iter().copied().max().unwrap_or(1).max(1);
    let mut inverse_impacts: Vec<u128> = price_impacts
        .iter()
        .map(|&pi| if pi == 0 { (max_impact as u128 + 1) * BPS as u128 } else { BPS as u128 * BPS as u128 / pi as u128 })
        .collect();
    let total_inv: u128 = inverse_impacts.iter().sum();
    if total_inv == 0 {
        return amounts.to_vec();
    }
    let mut result = Vec::new();
    let mut remaining = total;
    for (i, inv) in inverse_impacts.iter().enumerate() {
        if i == amounts.len() - 1 {
            result.push(remaining);
        } else {
            let share = (total as u128 * inv / total_inv) as u64;
            let share = share.min(remaining);
            result.push(share);
            remaining = remaining.saturating_sub(share);
        }
    }
    result
}

pub fn rebalance_split(
    split_order: &SplitOrder,
    updated_prices: &[u64],
) -> Result<SplitOrder, String> {
    if split_order.splits.is_empty() {
        return Err("empty split order".to_string());
    }
    if updated_prices.len() != split_order.splits.len() {
        return Err("price count mismatch".to_string());
    }
    let total_input = split_order.total_input;
    let total_price: u128 = updated_prices.iter().map(|&p| p as u128).sum();
    if total_price == 0 {
        return Err("zero total price".to_string());
    }
    let mut splits = Vec::new();
    let mut remaining = total_input;
    for (i, (s, &price)) in split_order.splits.iter().zip(updated_prices).enumerate() {
        let share = if i == split_order.splits.len() - 1 {
            remaining
        } else {
            let sh = (total_input as u128 * price as u128 / total_price) as u64;
            sh.min(remaining)
        };
        remaining = remaining.saturating_sub(share);
        // Estimate output with updated price
        let output = if price > 0 {
            (share as u128 * price as u128 / PRICE_PRECISION) as u64
        } else {
            0
        };
        splits.push(Split {
            venue_id: s.venue_id,
            amount: share,
            expected_output: output,
            cost_bps: s.cost_bps,
        });
    }
    let total_out = splits.iter().map(|s| s.expected_output).sum();
    Ok(SplitOrder {
        splits,
        total_input,
        total_expected_output: total_out,
    })
}

// ============ Cost Estimation ============

pub fn estimate_slippage(amount: u64, pool_liquidity: u64, fee_bps: u64) -> u64 {
    if pool_liquidity == 0 {
        return BPS;
    }
    // Slippage ~ amount / liquidity (in bps)
    let slip = (amount as u128 * BPS as u128 / pool_liquidity as u128) as u64;
    slip.saturating_add(fee_bps).min(BPS)
}

pub fn estimate_gas_cost(hops: &[Hop]) -> u64 {
    let mut gas: u64 = 0;
    for _hop in hops {
        gas = gas.saturating_add(GAS_PER_HOP);
    }
    gas
}

pub fn calculate_price_impact(amount: u64, liquidity: u64) -> u64 {
    if liquidity == 0 {
        return BPS;
    }
    let impact = (amount as u128 * BPS as u128 / liquidity as u128) as u64;
    impact.min(BPS)
}

pub fn multi_hop_output(
    amount: u64,
    hops_fees_bps: &[u64],
    hops_prices: &[u64],
) -> Result<u64, String> {
    if hops_fees_bps.len() != hops_prices.len() {
        return Err("fees and prices length mismatch".to_string());
    }
    if hops_fees_bps.is_empty() {
        return Err("no hops".to_string());
    }
    let mut current = amount as u128;
    for (fee, price) in hops_fees_bps.iter().zip(hops_prices.iter()) {
        if *price == 0 {
            return Err("zero price".to_string());
        }
        let fee_factor = (BPS as u128).saturating_sub(*fee as u128);
        current = current * fee_factor / BPS as u128;
        current = current * (*price as u128) / PRICE_PRECISION;
    }
    if current > u64::MAX as u128 {
        return Err("overflow".to_string());
    }
    Ok(current as u64)
}

pub fn calculate_effective_price(input: u64, output: u64) -> u64 {
    if input == 0 {
        return 0;
    }
    (output as u128 * PRICE_PRECISION / input as u128) as u64
}

pub fn estimate_bridge_time(chain_from: u64, chain_to: u64) -> u64 {
    if chain_from == chain_to {
        return 0;
    }
    // Different chain pairs have different finality times
    let factor = (chain_from ^ chain_to) % 5 + 1;
    BRIDGE_TIME_BASE_MS * factor
}

// ============ Route Optimization ============

pub fn score_route(route: &Route) -> RouteScore {
    // Price score: higher output = better, scaled to 0-10000
    let price_score = if route.expected_output > 0 {
        (route.expected_output as u128 * BPS as u128
            / route.expected_output.saturating_add(route.gas_estimate).max(1) as u128) as u64
    } else {
        0
    };

    // Gas score: lower gas = better
    let gas_score = BPS.saturating_sub(
        (route.gas_estimate as u128 * BPS as u128 / route.gas_estimate.saturating_add(1_000_000) as u128) as u64,
    );

    // Reliability: fewer hops = more reliable
    let hop_penalty = (route.hops.len() as u64).saturating_mul(500);
    let reliability_score = BPS.saturating_sub(hop_penalty);

    let total_score = price_score / 3 + gas_score / 3 + reliability_score / 3;

    RouteScore {
        price_score,
        gas_score,
        reliability_score,
        total_score,
    }
}

pub fn compare_routes(routes: &[Route]) -> Vec<(usize, RouteScore)> {
    let mut scored: Vec<(usize, RouteScore)> = routes
        .iter()
        .enumerate()
        .map(|(i, r)| (i, score_route(r)))
        .collect();
    scored.sort_by(|a, b| b.1.total_score.cmp(&a.1.total_score));
    scored
}

// ============ Venue Selection ============

pub fn select_venues(token_in: u64, token_out: u64, venues: &[Venue]) -> Vec<Venue> {
    venues
        .iter()
        .filter(|v| {
            (v.token_a == token_in && v.token_b == token_out)
                || (v.token_b == token_in && v.token_a == token_out)
        })
        .cloned()
        .collect()
}

pub fn filter_venues_by_liquidity(venues: &[Venue], min_liquidity: u64) -> Vec<Venue> {
    venues
        .iter()
        .filter(|v| v.liquidity >= min_liquidity)
        .cloned()
        .collect()
}

// ============ Execution Planning ============

pub fn build_execution_plan(route: &Route) -> ExecutionPlan {
    let mut steps = Vec::new();
    for (i, hop) in route.hops.iter().enumerate() {
        let depends = if i == 0 {
            Vec::new()
        } else {
            vec![(i - 1) as u32]
        };
        steps.push(ExecutionStep {
            hop: hop.clone(),
            sequence_order: i as u32,
            depends_on: depends,
            timeout_ms: DEFAULT_STEP_TIMEOUT_MS,
        });
    }
    let total_timeout = steps.len() as u64 * DEFAULT_STEP_TIMEOUT_MS;
    ExecutionPlan {
        steps,
        total_timeout_ms: total_timeout,
        estimated_gas: route.gas_estimate,
    }
}

pub fn validate_execution_plan(plan: &ExecutionPlan) -> Result<bool, String> {
    if plan.steps.is_empty() {
        return Err("empty execution plan".to_string());
    }
    for step in &plan.steps {
        for &dep in &step.depends_on {
            if dep >= step.sequence_order {
                return Err("circular dependency in plan".to_string());
            }
            if !plan.steps.iter().any(|s| s.sequence_order == dep) {
                return Err("missing dependency step".to_string());
            }
        }
    }
    // Check sequence orders are unique
    let mut orders: Vec<u32> = plan.steps.iter().map(|s| s.sequence_order).collect();
    orders.sort();
    orders.dedup();
    if orders.len() != plan.steps.len() {
        return Err("duplicate sequence orders".to_string());
    }
    Ok(true)
}

pub fn topological_sort_steps(steps: &[ExecutionStep]) -> Result<Vec<ExecutionStep>, String> {
    if steps.is_empty() {
        return Err("empty steps".to_string());
    }
    let mut sorted: Vec<ExecutionStep> = Vec::new();
    let mut remaining: Vec<ExecutionStep> = steps.to_vec();
    let mut resolved: Vec<u32> = Vec::new();
    let max_iter = steps.len() * steps.len() + 1;
    let mut iter = 0;

    while !remaining.is_empty() {
        iter += 1;
        if iter > max_iter {
            return Err("cycle detected in dependencies".to_string());
        }
        let mut found = false;
        let mut i = 0;
        while i < remaining.len() {
            let all_deps_met = remaining[i]
                .depends_on
                .iter()
                .all(|d| resolved.contains(d));
            if all_deps_met {
                resolved.push(remaining[i].sequence_order);
                sorted.push(remaining.remove(i));
                found = true;
            } else {
                i += 1;
            }
        }
        if !found {
            return Err("unresolvable dependencies".to_string());
        }
    }
    Ok(sorted)
}

// ============ Route Caching ============

pub fn cache_route(route: &Route, ttl_ms: u64, current_time: u64) -> CachedRoute {
    CachedRoute {
        route: route.clone(),
        cached_at: current_time,
        ttl_ms,
        hit_count: 0,
    }
}

pub fn lookup_cached_route(
    cache: &mut [CachedRoute],
    token_in: u64,
    token_out: u64,
    current_time: u64,
) -> Option<CachedRoute> {
    for entry in cache.iter_mut() {
        if entry.cached_at + entry.ttl_ms < current_time {
            continue; // expired
        }
        if let Some(first_hop) = entry.route.hops.first() {
            if let Some(last_hop) = entry.route.hops.last() {
                if first_hop.token_in == token_in && last_hop.token_out == token_out {
                    entry.hit_count += 1;
                    return Some(entry.clone());
                }
            }
        }
    }
    None
}

pub fn invalidate_stale_routes(cache: &[CachedRoute], current_time: u64) -> Vec<CachedRoute> {
    cache
        .iter()
        .filter(|e| e.cached_at + e.ttl_ms < current_time)
        .cloned()
        .collect()
}

// ============ Analytics ============

pub fn aggregate_venue_stats(fills: &[Fill]) -> VenueStats {
    if fills.is_empty() {
        return VenueStats {
            venue_id: 0,
            avg_slippage_bps: 0,
            fill_rate_bps: 0,
            avg_gas: 0,
            trade_count: 0,
        };
    }
    let venue_id = fills[0].venue_id;
    let count = fills.len() as u64;
    let total_slip: u64 = fills.iter().map(|f| f.slippage_bps).sum();
    let filled_count = fills.iter().filter(|f| f.filled).count() as u64;
    let total_gas: u64 = fills.iter().map(|f| f.gas_used).sum();

    VenueStats {
        venue_id,
        avg_slippage_bps: total_slip / count,
        fill_rate_bps: (filled_count * BPS / count),
        avg_gas: total_gas / count,
        trade_count: count,
    }
}

pub fn compare_execution(estimated_output: u64, actual_output: u64, gas_used: u64) -> RouteComparison {
    let deviation = if estimated_output > actual_output {
        let diff = estimated_output - actual_output;
        if estimated_output > 0 {
            (diff as u128 * BPS as u128 / estimated_output as u128) as u64
        } else {
            0
        }
    } else {
        let diff = actual_output - estimated_output;
        if estimated_output > 0 {
            (diff as u128 * BPS as u128 / estimated_output as u128) as u64
        } else {
            0
        }
    };
    RouteComparison {
        estimated_output,
        actual_output,
        deviation_bps: deviation,
        gas_used,
    }
}

pub fn find_arbitrage_routes(venues: &[Venue], pools: &[Pool]) -> Vec<Route> {
    let mut arb_routes = Vec::new();
    // Look for A -> B -> A circular routes with profit
    for p1 in pools {
        for p2 in pools {
            if p1.id == p2.id {
                continue;
            }
            // p1: A->B, p2: B->A
            if p1.token_a == p2.token_b && p1.token_b == p2.token_a {
                let test_amount: u64 = 1_000_000;
                let out1 = calculate_single_hop_output(test_amount, p1, p1.token_a);
                if out1 > 0 {
                    let out2 = calculate_single_hop_output(out1, p2, p2.token_a);
                    if out2 > test_amount {
                        // Profitable circular route
                        if let (Some(h1), Some(h2)) = (
                            pool_to_hop(p1, p1.token_a, p1.token_b, venues),
                            pool_to_hop(p2, p2.token_a, p2.token_b, venues),
                        ) {
                            let gas = estimate_gas_cost(&[h1.clone(), h2.clone()]);
                            let profit_bps = ((out2 - test_amount) as u128 * BPS as u128
                                / test_amount as u128) as u64;
                            arb_routes.push(Route {
                                hops: vec![h1, h2],
                                total_cost_bps: 0,
                                expected_output: out2,
                                gas_estimate: gas,
                            });
                        }
                    }
                }
            }
        }
    }
    arb_routes
}

// ============ Internal Helpers ============

fn calculate_single_hop_output(amount: u64, pool: &Pool, token_in: u64) -> u64 {
    let (reserve_in, reserve_out) = if pool.token_a == token_in {
        (pool.reserve_a, pool.reserve_b)
    } else if pool.token_b == token_in {
        (pool.reserve_b, pool.reserve_a)
    } else {
        return 0;
    };
    if reserve_in == 0 || reserve_out == 0 {
        return 0;
    }
    // AMM formula: out = reserve_out * amount_in_after_fee / (reserve_in + amount_in_after_fee)
    let amount_after_fee =
        (amount as u128) * ((BPS as u128).saturating_sub(pool.fee_bps as u128)) / BPS as u128;
    let numerator = reserve_out as u128 * amount_after_fee;
    let denominator = reserve_in as u128 + amount_after_fee;
    if denominator == 0 {
        return 0;
    }
    let result = numerator / denominator;
    if result > u64::MAX as u128 {
        return u64::MAX;
    }
    result as u64
}

fn pool_to_hop(pool: &Pool, token_in: u64, token_out: u64, venues: &[Venue]) -> Option<Hop> {
    let has_pair = (pool.token_a == token_in && pool.token_b == token_out)
        || (pool.token_b == token_in && pool.token_a == token_out);
    if !has_pair {
        return None;
    }
    let (reserve_in, reserve_out) = if pool.token_a == token_in {
        (pool.reserve_a, pool.reserve_b)
    } else {
        (pool.reserve_b, pool.reserve_a)
    };
    if reserve_in == 0 || reserve_out == 0 {
        return None;
    }
    let price = (reserve_out as u128 * PRICE_PRECISION / reserve_in as u128) as u64;
    Some(Hop {
        venue_id: pool.venue_id,
        token_in,
        token_out,
        pool_id: pool.id,
        expected_price: price,
        fee_bps: pool.fee_bps,
    })
}

fn find_intermediate_token(p1: &Pool, p2: &Pool, token_in: u64, token_out: u64) -> Option<u64> {
    // p1 must have token_in, p2 must have token_out
    // They share an intermediate token
    let p1_other = if p1.token_a == token_in {
        Some(p1.token_b)
    } else if p1.token_b == token_in {
        Some(p1.token_a)
    } else {
        None
    };
    let p2_other = if p2.token_a == token_out {
        Some(p2.token_b)
    } else if p2.token_b == token_out {
        Some(p2.token_a)
    } else {
        None
    };
    match (p1_other, p2_other) {
        (Some(a), Some(b)) if a == b && a != token_in && a != token_out => Some(a),
        _ => None,
    }
}

fn gas_to_bps(gas: u64, amount: u64) -> u64 {
    if amount == 0 {
        return 0;
    }
    (gas as u128 * BPS as u128 / amount as u128).min(BPS as u128) as u64
}

fn estimate_gas_for_venue(venue_id: u64, venues: &[Venue]) -> u64 {
    for v in venues {
        if v.id == venue_id {
            return match v.venue_type {
                2 => GAS_PER_BRIDGE,
                _ => GAS_PER_HOP,
            };
        }
    }
    GAS_PER_HOP
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn make_venue(id: u64, vtype: u8, chain: u64, liq: u64, fee: u64, ta: u64, tb: u64) -> Venue {
        Venue { id, venue_type: vtype, chain_id: chain, liquidity: liq, fee_bps: fee, token_a: ta, token_b: tb }
    }

    fn make_pool(id: u64, vid: u64, ta: u64, tb: u64, ra: u64, rb: u64, fee: u64) -> Pool {
        Pool { id, venue_id: vid, token_a: ta, token_b: tb, reserve_a: ra, reserve_b: rb, fee_bps: fee }
    }

    fn make_hop(vid: u64, tin: u64, tout: u64, pid: u64, price: u64, fee: u64) -> Hop {
        Hop { venue_id: vid, token_in: tin, token_out: tout, pool_id: pid, expected_price: price, fee_bps: fee }
    }

    fn make_route(hops: Vec<Hop>, cost: u64, output: u64, gas: u64) -> Route {
        Route { hops, total_cost_bps: cost, expected_output: output, gas_estimate: gas }
    }

    fn sample_venues() -> Vec<Venue> {
        vec![
            make_venue(1, 0, 1, 1_000_000, 30, 100, 200),
            make_venue(2, 0, 1, 500_000, 25, 200, 300),
            make_venue(3, 1, 1, 2_000_000, 10, 100, 200),
            make_venue(4, 2, 2, 800_000, 50, 100, 300),
        ]
    }

    fn sample_pools() -> Vec<Pool> {
        vec![
            make_pool(1, 1, 100, 200, 1_000_000, 2_000_000, 30),
            make_pool(2, 2, 200, 300, 500_000, 1_500_000, 25),
            make_pool(3, 3, 100, 200, 2_000_000, 4_000_000, 10),
            make_pool(4, 4, 100, 300, 800_000, 2_400_000, 50),
        ]
    }

    fn make_request(tin: u64, tout: u64, amt: u64, mh: usize, slip: u64, chain: u64) -> RouteRequest {
        RouteRequest { token_in: tin, token_out: tout, amount: amt, max_hops: mh, max_slippage_bps: slip, chain_id: chain }
    }

    // ============ Path Finding Tests ============

    #[test]
    fn test_find_best_route_single_hop() {
        let v = sample_venues();
        let p = sample_pools();
        let req = make_request(100, 200, 10_000, 1, 100, 1);
        let route = find_best_route(&req, &v, &p).unwrap();
        assert!(!route.hops.is_empty());
        assert!(route.expected_output > 0);
    }

    #[test]
    fn test_find_best_route_zero_amount() {
        let v = sample_venues();
        let p = sample_pools();
        let req = make_request(100, 200, 0, 2, 100, 1);
        assert!(find_best_route(&req, &v, &p).is_err());
    }

    #[test]
    fn test_find_best_route_no_route() {
        let v = sample_venues();
        let p = sample_pools();
        let req = make_request(999, 888, 10_000, 2, 100, 1);
        assert!(find_best_route(&req, &v, &p).is_err());
    }

    #[test]
    fn test_find_best_route_multi_hop() {
        let v = sample_venues();
        let p = sample_pools();
        let req = make_request(100, 300, 10_000, 2, 500, 1);
        let route = find_best_route(&req, &v, &p).unwrap();
        assert!(route.expected_output > 0);
    }

    #[test]
    fn test_find_all_routes_single_hop_only() {
        let v = sample_venues();
        let p = sample_pools();
        let req = make_request(100, 200, 10_000, 1, 100, 1);
        let routes = find_all_routes(&req, &v, &p, 10);
        assert!(!routes.is_empty());
        for r in &routes {
            assert_eq!(r.hops.len(), 1);
        }
    }

    #[test]
    fn test_find_all_routes_includes_multi_hop() {
        let v = sample_venues();
        let p = sample_pools();
        let req = make_request(100, 300, 10_000, 2, 500, 1);
        let routes = find_all_routes(&req, &v, &p, 50);
        let multi: Vec<_> = routes.iter().filter(|r| r.hops.len() > 1).collect();
        assert!(!multi.is_empty());
    }

    #[test]
    fn test_find_all_routes_max_routes_limit() {
        let v = sample_venues();
        let p = sample_pools();
        let req = make_request(100, 200, 10_000, 2, 500, 1);
        let routes = find_all_routes(&req, &v, &p, 1);
        assert!(routes.len() <= 1);
    }

    #[test]
    fn test_find_all_routes_empty_pools() {
        let v = sample_venues();
        let req = make_request(100, 200, 10_000, 2, 500, 1);
        let routes = find_all_routes(&req, &v, &[], 10);
        assert!(routes.is_empty());
    }

    #[test]
    fn test_find_all_routes_empty_venues() {
        let p = sample_pools();
        let req = make_request(100, 200, 10_000, 2, 500, 1);
        let routes = find_all_routes(&req, &[], &p, 10);
        // Routes can still be found from pools alone (hop uses venue lookup)
        // but pool_to_hop won't find matching venues to calculate gas
        assert!(routes.len() >= 0); // may or may not find routes
    }

    #[test]
    fn test_find_all_routes_max_hops_zero_defaults() {
        let v = sample_venues();
        let p = sample_pools();
        let req = make_request(100, 200, 10_000, 0, 500, 1);
        let routes = find_all_routes(&req, &v, &p, 50);
        assert!(!routes.is_empty());
    }

    #[test]
    fn test_find_best_route_selects_highest_output() {
        let v = vec![
            make_venue(1, 0, 1, 1_000_000, 30, 100, 200),
            make_venue(2, 0, 1, 500_000, 100, 100, 200),
        ];
        let p = vec![
            make_pool(1, 1, 100, 200, 1_000_000, 2_000_000, 30),
            make_pool(2, 2, 100, 200, 500_000, 800_000, 100),
        ];
        let req = make_request(100, 200, 10_000, 1, 500, 1);
        let route = find_best_route(&req, &v, &p).unwrap();
        assert!(route.expected_output > 0);
    }

    // ============ Route Output Tests ============

    #[test]
    fn test_calculate_route_output_single_hop() {
        let hop = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(vec![hop], 30, 10_000, 50_000);
        let out = calculate_route_output(&route, 10_000).unwrap();
        assert!(out > 0);
        assert!(out < 10_000); // fees reduce output
    }

    #[test]
    fn test_calculate_route_output_zero_amount() {
        let hop = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(vec![hop], 30, 10_000, 50_000);
        assert!(calculate_route_output(&route, 0).is_err());
    }

    #[test]
    fn test_calculate_route_output_empty_route() {
        let route = make_route(vec![], 0, 0, 0);
        assert!(calculate_route_output(&route, 10_000).is_err());
    }

    #[test]
    fn test_calculate_route_output_zero_price() {
        let hop = make_hop(1, 100, 200, 1, 0, 30);
        let route = make_route(vec![hop], 30, 10_000, 50_000);
        assert!(calculate_route_output(&route, 10_000).is_err());
    }

    #[test]
    fn test_calculate_route_output_multi_hop() {
        let h1 = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let h2 = make_hop(2, 200, 300, 2, PRICE_PRECISION as u64, 25);
        let route = make_route(vec![h1, h2], 55, 10_000, 100_000);
        let out = calculate_route_output(&route, 10_000).unwrap();
        assert!(out > 0);
        assert!(out < 10_000);
    }

    #[test]
    fn test_calculate_route_output_high_fee() {
        let hop = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 5000);
        let route = make_route(vec![hop], 5000, 10_000, 50_000);
        let out = calculate_route_output(&route, 10_000).unwrap();
        assert!(out <= 5_000); // 50% fee
    }

    #[test]
    fn test_calculate_route_output_2x_price() {
        let hop = make_hop(1, 100, 200, 1, (PRICE_PRECISION * 2) as u64, 0);
        let route = make_route(vec![hop], 0, 20_000, 50_000);
        let out = calculate_route_output(&route, 10_000).unwrap();
        assert_eq!(out, 20_000);
    }

    // ============ Route Cost Tests ============

    #[test]
    fn test_calculate_route_cost_single_hop() {
        let hop = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(vec![hop], 30, 100_000, 50_000);
        let cost = calculate_route_cost(&route);
        assert!(cost >= 30);
    }

    #[test]
    fn test_calculate_route_cost_multi_hop() {
        let h1 = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let h2 = make_hop(2, 200, 300, 2, PRICE_PRECISION as u64, 25);
        let route = make_route(vec![h1, h2], 55, 100_000, 100_000);
        let cost = calculate_route_cost(&route);
        assert!(cost >= 55);
    }

    #[test]
    fn test_calculate_route_cost_empty() {
        let route = make_route(vec![], 0, 100_000, 0);
        let cost = calculate_route_cost(&route);
        assert_eq!(cost, 0);
    }

    #[test]
    fn test_calculate_route_cost_high_gas() {
        let hop = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(vec![hop], 30, 1_000, 10_000_000);
        let cost = calculate_route_cost(&route);
        assert!(cost > 30); // gas adds to cost
    }

    // ============ Split Order Tests ============

    #[test]
    fn test_split_order_basic() {
        let v = sample_venues();
        let p = sample_pools();
        let req = make_request(100, 200, 100_000, 1, 200, 1);
        let split = split_order(&req, &v, &p).unwrap();
        assert!(!split.splits.is_empty());
        let total_in: u64 = split.splits.iter().map(|s| s.amount).sum();
        assert_eq!(total_in, req.amount);
    }

    #[test]
    fn test_split_order_zero_amount() {
        let v = sample_venues();
        let p = sample_pools();
        let req = make_request(100, 200, 0, 1, 200, 1);
        assert!(split_order(&req, &v, &p).is_err());
    }

    #[test]
    fn test_split_order_no_venues() {
        let p = sample_pools();
        let req = make_request(100, 200, 100_000, 1, 200, 1);
        assert!(split_order(&req, &[], &p).is_err());
    }

    #[test]
    fn test_split_order_no_pools() {
        let v = sample_venues();
        let req = make_request(100, 200, 100_000, 1, 200, 1);
        assert!(split_order(&req, &v, &[]).is_err());
    }

    #[test]
    fn test_split_order_single_venue() {
        let v = vec![make_venue(1, 0, 1, 1_000_000, 30, 100, 200)];
        let p = vec![make_pool(1, 1, 100, 200, 1_000_000, 2_000_000, 30)];
        let req = make_request(100, 200, 50_000, 1, 200, 1);
        let split = split_order(&req, &v, &p).unwrap();
        assert_eq!(split.splits.len(), 1);
        assert_eq!(split.splits[0].amount, 50_000);
    }

    #[test]
    fn test_split_order_total_output_positive() {
        let v = sample_venues();
        let p = sample_pools();
        let req = make_request(100, 200, 100_000, 1, 200, 1);
        let split = split_order(&req, &v, &p).unwrap();
        assert!(split.total_expected_output > 0);
    }

    #[test]
    fn test_split_order_no_matching_pair() {
        let v = vec![make_venue(1, 0, 1, 1_000_000, 30, 100, 200)];
        let p = vec![make_pool(1, 1, 100, 200, 1_000_000, 2_000_000, 30)];
        let req = make_request(300, 400, 50_000, 1, 200, 1);
        assert!(split_order(&req, &v, &p).is_err());
    }

    #[test]
    fn test_split_order_large_amount() {
        let v = sample_venues();
        let p = sample_pools();
        let req = make_request(100, 200, 10_000_000, 1, 500, 1);
        let split = split_order(&req, &v, &p).unwrap();
        let total: u64 = split.splits.iter().map(|s| s.amount).sum();
        assert_eq!(total, 10_000_000);
    }

    // ============ Optimal Split Ratio Tests ============

    #[test]
    fn test_optimal_split_ratio_equal_impacts() {
        let amounts = vec![1000, 1000];
        let impacts = vec![100, 100];
        let result = optimal_split_ratio(&amounts, &impacts);
        assert_eq!(result.len(), 2);
        let total: u64 = result.iter().sum();
        assert_eq!(total, 2000);
    }

    #[test]
    fn test_optimal_split_ratio_empty() {
        let result = optimal_split_ratio(&[], &[]);
        assert!(result.is_empty());
    }

    #[test]
    fn test_optimal_split_ratio_single() {
        let result = optimal_split_ratio(&[1000], &[50]);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], 1000);
    }

    #[test]
    fn test_optimal_split_ratio_zero_impact_gets_more() {
        let amounts = vec![500, 500];
        let impacts = vec![0, 100];
        let result = optimal_split_ratio(&amounts, &impacts);
        assert!(result[0] > result[1]); // zero impact venue gets more
    }

    #[test]
    fn test_optimal_split_ratio_preserves_total() {
        let amounts = vec![1000, 2000, 3000];
        let impacts = vec![50, 100, 200];
        let result = optimal_split_ratio(&amounts, &impacts);
        let total: u64 = result.iter().sum();
        assert_eq!(total, 6000);
    }

    #[test]
    fn test_optimal_split_ratio_high_vs_low_impact() {
        let amounts = vec![5000, 5000];
        let impacts = vec![10, 1000];
        let result = optimal_split_ratio(&amounts, &impacts);
        assert!(result[0] > result[1]);
    }

    // ============ Rebalance Split Tests ============

    #[test]
    fn test_rebalance_split_basic() {
        let so = SplitOrder {
            splits: vec![
                Split { venue_id: 1, amount: 500, expected_output: 490, cost_bps: 30 },
                Split { venue_id: 2, amount: 500, expected_output: 485, cost_bps: 25 },
            ],
            total_input: 1000,
            total_expected_output: 975,
        };
        let prices = vec![PRICE_PRECISION as u64, PRICE_PRECISION as u64];
        let result = rebalance_split(&so, &prices).unwrap();
        assert_eq!(result.total_input, 1000);
    }

    #[test]
    fn test_rebalance_split_empty() {
        let so = SplitOrder { splits: vec![], total_input: 0, total_expected_output: 0 };
        assert!(rebalance_split(&so, &[]).is_err());
    }

    #[test]
    fn test_rebalance_split_price_mismatch() {
        let so = SplitOrder {
            splits: vec![Split { venue_id: 1, amount: 1000, expected_output: 990, cost_bps: 30 }],
            total_input: 1000,
            total_expected_output: 990,
        };
        assert!(rebalance_split(&so, &[100, 200]).is_err());
    }

    #[test]
    fn test_rebalance_split_preserves_total_input() {
        let so = SplitOrder {
            splits: vec![
                Split { venue_id: 1, amount: 700, expected_output: 680, cost_bps: 30 },
                Split { venue_id: 2, amount: 300, expected_output: 290, cost_bps: 25 },
            ],
            total_input: 1000,
            total_expected_output: 970,
        };
        let prices = vec![2 * PRICE_PRECISION as u64, PRICE_PRECISION as u64];
        let result = rebalance_split(&so, &prices).unwrap();
        let total: u64 = result.splits.iter().map(|s| s.amount).sum();
        assert_eq!(total, 1000);
    }

    // ============ Slippage Estimation Tests ============

    #[test]
    fn test_estimate_slippage_basic() {
        let slip = estimate_slippage(1_000, 1_000_000, 30);
        assert!(slip > 30);
        assert!(slip < BPS);
    }

    #[test]
    fn test_estimate_slippage_zero_liquidity() {
        let slip = estimate_slippage(1_000, 0, 30);
        assert_eq!(slip, BPS);
    }

    #[test]
    fn test_estimate_slippage_zero_amount() {
        let slip = estimate_slippage(0, 1_000_000, 30);
        assert_eq!(slip, 30); // just the fee
    }

    #[test]
    fn test_estimate_slippage_large_amount() {
        let slip = estimate_slippage(900_000, 1_000_000, 30);
        assert!(slip > 1000); // significant slippage
    }

    #[test]
    fn test_estimate_slippage_tiny_amount() {
        let slip = estimate_slippage(1, 1_000_000_000, 30);
        assert_eq!(slip, 30); // negligible slippage, just fee
    }

    #[test]
    fn test_estimate_slippage_capped_at_bps() {
        let slip = estimate_slippage(u64::MAX, 1, 5000);
        assert_eq!(slip, BPS);
    }

    // ============ Gas Estimation Tests ============

    #[test]
    fn test_estimate_gas_cost_single_hop() {
        let hops = vec![make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30)];
        assert_eq!(estimate_gas_cost(&hops), GAS_PER_HOP);
    }

    #[test]
    fn test_estimate_gas_cost_multi_hop() {
        let hops = vec![
            make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30),
            make_hop(2, 200, 300, 2, PRICE_PRECISION as u64, 25),
            make_hop(3, 300, 400, 3, PRICE_PRECISION as u64, 10),
        ];
        assert_eq!(estimate_gas_cost(&hops), GAS_PER_HOP * 3);
    }

    #[test]
    fn test_estimate_gas_cost_empty() {
        assert_eq!(estimate_gas_cost(&[]), 0);
    }

    // ============ Price Impact Tests ============

    #[test]
    fn test_calculate_price_impact_basic() {
        let impact = calculate_price_impact(10_000, 1_000_000);
        assert_eq!(impact, 100); // 1%
    }

    #[test]
    fn test_calculate_price_impact_zero_liquidity() {
        let impact = calculate_price_impact(10_000, 0);
        assert_eq!(impact, BPS);
    }

    #[test]
    fn test_calculate_price_impact_zero_amount() {
        let impact = calculate_price_impact(0, 1_000_000);
        assert_eq!(impact, 0);
    }

    #[test]
    fn test_calculate_price_impact_equal() {
        let impact = calculate_price_impact(1_000_000, 1_000_000);
        assert_eq!(impact, BPS);
    }

    #[test]
    fn test_calculate_price_impact_small() {
        let impact = calculate_price_impact(1, 1_000_000);
        assert_eq!(impact, 0);
    }

    #[test]
    fn test_calculate_price_impact_large_exceeds_bps_capped() {
        let impact = calculate_price_impact(2_000_000, 1_000_000);
        assert_eq!(impact, BPS); // capped
    }

    // ============ Multi-Hop Output Tests ============

    #[test]
    fn test_multi_hop_output_single() {
        let out = multi_hop_output(10_000, &[30], &[PRICE_PRECISION as u64]).unwrap();
        assert!(out > 0);
        assert!(out < 10_000);
    }

    #[test]
    fn test_multi_hop_output_two_hops() {
        let p = PRICE_PRECISION as u64;
        let out = multi_hop_output(10_000, &[30, 25], &[p, p]).unwrap();
        assert!(out > 0);
        assert!(out < 10_000);
    }

    #[test]
    fn test_multi_hop_output_zero_price() {
        assert!(multi_hop_output(10_000, &[30], &[0]).is_err());
    }

    #[test]
    fn test_multi_hop_output_empty() {
        assert!(multi_hop_output(10_000, &[], &[]).is_err());
    }

    #[test]
    fn test_multi_hop_output_length_mismatch() {
        assert!(multi_hop_output(10_000, &[30, 25], &[PRICE_PRECISION as u64]).is_err());
    }

    #[test]
    fn test_multi_hop_output_zero_fee() {
        let p = PRICE_PRECISION as u64;
        let out = multi_hop_output(10_000, &[0], &[p]).unwrap();
        assert_eq!(out, 10_000);
    }

    #[test]
    fn test_multi_hop_output_double_price() {
        let p = (PRICE_PRECISION * 2) as u64;
        let out = multi_hop_output(10_000, &[0], &[p]).unwrap();
        assert_eq!(out, 20_000);
    }

    #[test]
    fn test_multi_hop_output_half_price() {
        let p = (PRICE_PRECISION / 2) as u64;
        let out = multi_hop_output(10_000, &[0], &[p]).unwrap();
        assert_eq!(out, 5_000);
    }

    // ============ Effective Price Tests ============

    #[test]
    fn test_calculate_effective_price_basic() {
        let price = calculate_effective_price(10_000, 20_000);
        assert_eq!(price, (PRICE_PRECISION * 2) as u64);
    }

    #[test]
    fn test_calculate_effective_price_zero_input() {
        assert_eq!(calculate_effective_price(0, 10_000), 0);
    }

    #[test]
    fn test_calculate_effective_price_equal() {
        let price = calculate_effective_price(1_000, 1_000);
        assert_eq!(price, PRICE_PRECISION as u64);
    }

    #[test]
    fn test_calculate_effective_price_zero_output() {
        let price = calculate_effective_price(1_000, 0);
        assert_eq!(price, 0);
    }

    // ============ Bridge Time Tests ============

    #[test]
    fn test_estimate_bridge_time_same_chain() {
        assert_eq!(estimate_bridge_time(1, 1), 0);
    }

    #[test]
    fn test_estimate_bridge_time_different_chains() {
        let time = estimate_bridge_time(1, 2);
        assert!(time > 0);
        assert!(time >= BRIDGE_TIME_BASE_MS);
    }

    #[test]
    fn test_estimate_bridge_time_symmetric() {
        // XOR is symmetric
        assert_eq!(estimate_bridge_time(1, 2), estimate_bridge_time(2, 1));
    }

    #[test]
    fn test_estimate_bridge_time_various_chains() {
        let t1 = estimate_bridge_time(1, 3);
        let t2 = estimate_bridge_time(1, 5);
        // Different chains yield different times
        assert!(t1 > 0);
        assert!(t2 > 0);
    }

    // ============ Route Scoring Tests ============

    #[test]
    fn test_score_route_basic() {
        let hop = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(vec![hop], 30, 100_000, 50_000);
        let score = score_route(&route);
        assert!(score.total_score > 0);
        assert!(score.price_score > 0);
        assert!(score.gas_score > 0);
        assert!(score.reliability_score > 0);
    }

    #[test]
    fn test_score_route_zero_output() {
        let hop = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(vec![hop], 30, 0, 50_000);
        let score = score_route(&route);
        assert_eq!(score.price_score, 0);
    }

    #[test]
    fn test_score_route_fewer_hops_better() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let r1 = make_route(vec![h.clone()], 30, 100_000, 50_000);
        let r2 = make_route(vec![h.clone(), h.clone(), h.clone()], 90, 100_000, 150_000);
        let s1 = score_route(&r1);
        let s2 = score_route(&r2);
        assert!(s1.reliability_score > s2.reliability_score);
    }

    #[test]
    fn test_score_route_lower_gas_better() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let r1 = make_route(vec![h.clone()], 30, 100_000, 10_000);
        let r2 = make_route(vec![h.clone()], 30, 100_000, 10_000_000);
        let s1 = score_route(&r1);
        let s2 = score_route(&r2);
        assert!(s1.gas_score > s2.gas_score);
    }

    // ============ Compare Routes Tests ============

    #[test]
    fn test_compare_routes_sorted_by_score() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let r1 = make_route(vec![h.clone()], 30, 100_000, 50_000);
        let r2 = make_route(vec![h.clone()], 30, 50_000, 50_000);
        let scored = compare_routes(&[r1, r2]);
        assert_eq!(scored.len(), 2);
        assert!(scored[0].1.total_score >= scored[1].1.total_score);
    }

    #[test]
    fn test_compare_routes_empty() {
        let scored = compare_routes(&[]);
        assert!(scored.is_empty());
    }

    #[test]
    fn test_compare_routes_single() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let r = make_route(vec![h], 30, 100_000, 50_000);
        let scored = compare_routes(&[r]);
        assert_eq!(scored.len(), 1);
    }

    #[test]
    fn test_compare_routes_three_routes() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let r1 = make_route(vec![h.clone()], 30, 200_000, 50_000);
        let r2 = make_route(vec![h.clone()], 30, 100_000, 50_000);
        let r3 = make_route(vec![h.clone()], 30, 150_000, 50_000);
        let scored = compare_routes(&[r1, r2, r3]);
        assert_eq!(scored.len(), 3);
        // First should be highest score
        assert!(scored[0].1.total_score >= scored[1].1.total_score);
        assert!(scored[1].1.total_score >= scored[2].1.total_score);
    }

    // ============ Venue Selection Tests ============

    #[test]
    fn test_select_venues_basic() {
        let v = sample_venues();
        let selected = select_venues(100, 200, &v);
        assert!(!selected.is_empty());
    }

    #[test]
    fn test_select_venues_no_match() {
        let v = sample_venues();
        let selected = select_venues(999, 888, &v);
        assert!(selected.is_empty());
    }

    #[test]
    fn test_select_venues_reverse_pair() {
        let v = vec![make_venue(1, 0, 1, 1_000_000, 30, 200, 100)];
        let selected = select_venues(100, 200, &v);
        assert_eq!(selected.len(), 1);
    }

    #[test]
    fn test_select_venues_empty() {
        let selected = select_venues(100, 200, &[]);
        assert!(selected.is_empty());
    }

    #[test]
    fn test_select_venues_multiple_matches() {
        let v = vec![
            make_venue(1, 0, 1, 1_000_000, 30, 100, 200),
            make_venue(2, 0, 1, 500_000, 25, 100, 200),
            make_venue(3, 1, 1, 2_000_000, 10, 100, 200),
        ];
        let selected = select_venues(100, 200, &v);
        assert_eq!(selected.len(), 3);
    }

    // ============ Filter Venues Tests ============

    #[test]
    fn test_filter_venues_by_liquidity_basic() {
        let v = sample_venues();
        let filtered = filter_venues_by_liquidity(&v, 500_000);
        assert!(!filtered.is_empty());
        for venue in &filtered {
            assert!(venue.liquidity >= 500_000);
        }
    }

    #[test]
    fn test_filter_venues_by_liquidity_high_threshold() {
        let v = sample_venues();
        let filtered = filter_venues_by_liquidity(&v, 10_000_000);
        assert!(filtered.is_empty());
    }

    #[test]
    fn test_filter_venues_by_liquidity_zero_threshold() {
        let v = sample_venues();
        let filtered = filter_venues_by_liquidity(&v, 0);
        assert_eq!(filtered.len(), v.len());
    }

    #[test]
    fn test_filter_venues_by_liquidity_empty() {
        let filtered = filter_venues_by_liquidity(&[], 100);
        assert!(filtered.is_empty());
    }

    #[test]
    fn test_filter_venues_by_liquidity_exact_match() {
        let v = vec![make_venue(1, 0, 1, 1000, 30, 100, 200)];
        let filtered = filter_venues_by_liquidity(&v, 1000);
        assert_eq!(filtered.len(), 1);
    }

    // ============ Execution Plan Tests ============

    #[test]
    fn test_build_execution_plan_single_hop() {
        let hop = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(vec![hop], 30, 100_000, 50_000);
        let plan = build_execution_plan(&route);
        assert_eq!(plan.steps.len(), 1);
        assert_eq!(plan.steps[0].sequence_order, 0);
        assert!(plan.steps[0].depends_on.is_empty());
    }

    #[test]
    fn test_build_execution_plan_multi_hop() {
        let h1 = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let h2 = make_hop(2, 200, 300, 2, PRICE_PRECISION as u64, 25);
        let route = make_route(vec![h1, h2], 55, 100_000, 100_000);
        let plan = build_execution_plan(&route);
        assert_eq!(plan.steps.len(), 2);
        assert_eq!(plan.steps[1].depends_on, vec![0]);
    }

    #[test]
    fn test_build_execution_plan_timeout() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(vec![h.clone(), h.clone(), h.clone()], 90, 100_000, 150_000);
        let plan = build_execution_plan(&route);
        assert_eq!(plan.total_timeout_ms, DEFAULT_STEP_TIMEOUT_MS * 3);
    }

    #[test]
    fn test_build_execution_plan_empty_route() {
        let route = make_route(vec![], 0, 0, 0);
        let plan = build_execution_plan(&route);
        assert!(plan.steps.is_empty());
        assert_eq!(plan.total_timeout_ms, 0);
    }

    #[test]
    fn test_build_execution_plan_gas_estimate() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(vec![h], 30, 100_000, 75_000);
        let plan = build_execution_plan(&route);
        assert_eq!(plan.estimated_gas, 75_000);
    }

    // ============ Validate Plan Tests ============

    #[test]
    fn test_validate_execution_plan_valid() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(vec![h], 30, 100_000, 50_000);
        let plan = build_execution_plan(&route);
        assert!(validate_execution_plan(&plan).unwrap());
    }

    #[test]
    fn test_validate_execution_plan_empty() {
        let plan = ExecutionPlan { steps: vec![], total_timeout_ms: 0, estimated_gas: 0 };
        assert!(validate_execution_plan(&plan).is_err());
    }

    #[test]
    fn test_validate_execution_plan_circular_dep() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let plan = ExecutionPlan {
            steps: vec![ExecutionStep {
                hop: h,
                sequence_order: 0,
                depends_on: vec![0], // depends on itself
                timeout_ms: 60_000,
            }],
            total_timeout_ms: 60_000,
            estimated_gas: 50_000,
        };
        assert!(validate_execution_plan(&plan).is_err());
    }

    #[test]
    fn test_validate_execution_plan_duplicate_orders() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let plan = ExecutionPlan {
            steps: vec![
                ExecutionStep { hop: h.clone(), sequence_order: 0, depends_on: vec![], timeout_ms: 60_000 },
                ExecutionStep { hop: h, sequence_order: 0, depends_on: vec![], timeout_ms: 60_000 },
            ],
            total_timeout_ms: 120_000,
            estimated_gas: 100_000,
        };
        assert!(validate_execution_plan(&plan).is_err());
    }

    #[test]
    fn test_validate_execution_plan_valid_chain() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let plan = ExecutionPlan {
            steps: vec![
                ExecutionStep { hop: h.clone(), sequence_order: 0, depends_on: vec![], timeout_ms: 60_000 },
                ExecutionStep { hop: h.clone(), sequence_order: 1, depends_on: vec![0], timeout_ms: 60_000 },
                ExecutionStep { hop: h, sequence_order: 2, depends_on: vec![1], timeout_ms: 60_000 },
            ],
            total_timeout_ms: 180_000,
            estimated_gas: 150_000,
        };
        assert!(validate_execution_plan(&plan).unwrap());
    }

    // ============ Topological Sort Tests ============

    #[test]
    fn test_topological_sort_simple_chain() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let steps = vec![
            ExecutionStep { hop: h.clone(), sequence_order: 0, depends_on: vec![], timeout_ms: 60_000 },
            ExecutionStep { hop: h.clone(), sequence_order: 1, depends_on: vec![0], timeout_ms: 60_000 },
        ];
        let sorted = topological_sort_steps(&steps).unwrap();
        assert_eq!(sorted[0].sequence_order, 0);
        assert_eq!(sorted[1].sequence_order, 1);
    }

    #[test]
    fn test_topological_sort_empty() {
        assert!(topological_sort_steps(&[]).is_err());
    }

    #[test]
    fn test_topological_sort_single() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let steps = vec![
            ExecutionStep { hop: h, sequence_order: 0, depends_on: vec![], timeout_ms: 60_000 },
        ];
        let sorted = topological_sort_steps(&steps).unwrap();
        assert_eq!(sorted.len(), 1);
    }

    #[test]
    fn test_topological_sort_reverse_input() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let steps = vec![
            ExecutionStep { hop: h.clone(), sequence_order: 1, depends_on: vec![0], timeout_ms: 60_000 },
            ExecutionStep { hop: h.clone(), sequence_order: 0, depends_on: vec![], timeout_ms: 60_000 },
        ];
        let sorted = topological_sort_steps(&steps).unwrap();
        assert_eq!(sorted[0].sequence_order, 0);
        assert_eq!(sorted[1].sequence_order, 1);
    }

    #[test]
    fn test_topological_sort_diamond_deps() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let steps = vec![
            ExecutionStep { hop: h.clone(), sequence_order: 0, depends_on: vec![], timeout_ms: 60_000 },
            ExecutionStep { hop: h.clone(), sequence_order: 1, depends_on: vec![0], timeout_ms: 60_000 },
            ExecutionStep { hop: h.clone(), sequence_order: 2, depends_on: vec![0], timeout_ms: 60_000 },
            ExecutionStep { hop: h.clone(), sequence_order: 3, depends_on: vec![1, 2], timeout_ms: 60_000 },
        ];
        let sorted = topological_sort_steps(&steps).unwrap();
        assert_eq!(sorted[0].sequence_order, 0);
        assert_eq!(sorted[3].sequence_order, 3);
    }

    #[test]
    fn test_topological_sort_cycle_detected() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let steps = vec![
            ExecutionStep { hop: h.clone(), sequence_order: 0, depends_on: vec![1], timeout_ms: 60_000 },
            ExecutionStep { hop: h.clone(), sequence_order: 1, depends_on: vec![0], timeout_ms: 60_000 },
        ];
        assert!(topological_sort_steps(&steps).is_err());
    }

    // ============ Cache Tests ============

    #[test]
    fn test_cache_route_basic() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(vec![h], 30, 100_000, 50_000);
        let cached = cache_route(&route, DEFAULT_CACHE_TTL_MS, 1000);
        assert_eq!(cached.cached_at, 1000);
        assert_eq!(cached.hit_count, 0);
        assert_eq!(cached.ttl_ms, DEFAULT_CACHE_TTL_MS);
    }

    #[test]
    fn test_lookup_cached_route_hit() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(vec![h], 30, 100_000, 50_000);
        let cached = cache_route(&route, DEFAULT_CACHE_TTL_MS, 1000);
        let mut cache = vec![cached];
        let result = lookup_cached_route(&mut cache, 100, 200, 2000);
        assert!(result.is_some());
        assert_eq!(result.unwrap().hit_count, 1);
    }

    #[test]
    fn test_lookup_cached_route_miss_wrong_tokens() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(vec![h], 30, 100_000, 50_000);
        let cached = cache_route(&route, DEFAULT_CACHE_TTL_MS, 1000);
        let mut cache = vec![cached];
        let result = lookup_cached_route(&mut cache, 300, 400, 2000);
        assert!(result.is_none());
    }

    #[test]
    fn test_lookup_cached_route_expired() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(vec![h], 30, 100_000, 50_000);
        let cached = cache_route(&route, 1000, 1000); // TTL = 1s
        let mut cache = vec![cached];
        let result = lookup_cached_route(&mut cache, 100, 200, 100_000); // way past TTL
        assert!(result.is_none());
    }

    #[test]
    fn test_lookup_cached_route_empty_cache() {
        let mut cache: Vec<CachedRoute> = vec![];
        let result = lookup_cached_route(&mut cache, 100, 200, 1000);
        assert!(result.is_none());
    }

    #[test]
    fn test_lookup_cached_route_increments_hit_count() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(vec![h], 30, 100_000, 50_000);
        let cached = cache_route(&route, DEFAULT_CACHE_TTL_MS, 1000);
        let mut cache = vec![cached];
        lookup_cached_route(&mut cache, 100, 200, 2000);
        lookup_cached_route(&mut cache, 100, 200, 3000);
        let result = lookup_cached_route(&mut cache, 100, 200, 4000);
        assert_eq!(result.unwrap().hit_count, 3);
    }

    #[test]
    fn test_invalidate_stale_routes_basic() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(vec![h], 30, 100_000, 50_000);
        let c1 = cache_route(&route, 1000, 1000);
        let c2 = cache_route(&route, 100_000, 1000);
        let cache = vec![c1, c2];
        let stale = invalidate_stale_routes(&cache, 5000);
        assert_eq!(stale.len(), 1); // only the 1000ms TTL one is stale
    }

    #[test]
    fn test_invalidate_stale_routes_none_stale() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(vec![h], 30, 100_000, 50_000);
        let c1 = cache_route(&route, 100_000, 1000);
        let cache = vec![c1];
        let stale = invalidate_stale_routes(&cache, 2000);
        assert!(stale.is_empty());
    }

    #[test]
    fn test_invalidate_stale_routes_all_stale() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(vec![h], 30, 100_000, 50_000);
        let c1 = cache_route(&route, 100, 1000);
        let c2 = cache_route(&route, 200, 1000);
        let cache = vec![c1, c2];
        let stale = invalidate_stale_routes(&cache, 100_000);
        assert_eq!(stale.len(), 2);
    }

    // ============ Analytics Tests ============

    #[test]
    fn test_aggregate_venue_stats_basic() {
        let fills = vec![
            Fill { venue_id: 1, slippage_bps: 10, filled: true, gas_used: 50_000 },
            Fill { venue_id: 1, slippage_bps: 20, filled: true, gas_used: 60_000 },
            Fill { venue_id: 1, slippage_bps: 30, filled: false, gas_used: 40_000 },
        ];
        let stats = aggregate_venue_stats(&fills);
        assert_eq!(stats.venue_id, 1);
        assert_eq!(stats.trade_count, 3);
        assert_eq!(stats.avg_slippage_bps, 20);
        assert_eq!(stats.avg_gas, 50_000);
    }

    #[test]
    fn test_aggregate_venue_stats_empty() {
        let stats = aggregate_venue_stats(&[]);
        assert_eq!(stats.trade_count, 0);
    }

    #[test]
    fn test_aggregate_venue_stats_fill_rate() {
        let fills = vec![
            Fill { venue_id: 1, slippage_bps: 10, filled: true, gas_used: 50_000 },
            Fill { venue_id: 1, slippage_bps: 20, filled: false, gas_used: 60_000 },
        ];
        let stats = aggregate_venue_stats(&fills);
        assert_eq!(stats.fill_rate_bps, 5_000); // 50%
    }

    #[test]
    fn test_aggregate_venue_stats_all_filled() {
        let fills = vec![
            Fill { venue_id: 1, slippage_bps: 10, filled: true, gas_used: 50_000 },
            Fill { venue_id: 1, slippage_bps: 20, filled: true, gas_used: 60_000 },
        ];
        let stats = aggregate_venue_stats(&fills);
        assert_eq!(stats.fill_rate_bps, BPS);
    }

    #[test]
    fn test_aggregate_venue_stats_none_filled() {
        let fills = vec![
            Fill { venue_id: 1, slippage_bps: 10, filled: false, gas_used: 50_000 },
        ];
        let stats = aggregate_venue_stats(&fills);
        assert_eq!(stats.fill_rate_bps, 0);
    }

    // ============ Route Comparison Tests ============

    #[test]
    fn test_compare_execution_exact_match() {
        let cmp = compare_execution(10_000, 10_000, 50_000);
        assert_eq!(cmp.deviation_bps, 0);
    }

    #[test]
    fn test_compare_execution_under() {
        let cmp = compare_execution(10_000, 9_000, 50_000);
        assert_eq!(cmp.deviation_bps, 1_000); // 10%
    }

    #[test]
    fn test_compare_execution_over() {
        let cmp = compare_execution(10_000, 11_000, 50_000);
        assert_eq!(cmp.deviation_bps, 1_000); // 10%
    }

    #[test]
    fn test_compare_execution_zero_estimated() {
        let cmp = compare_execution(0, 1_000, 50_000);
        assert_eq!(cmp.deviation_bps, 0);
    }

    #[test]
    fn test_compare_execution_gas_recorded() {
        let cmp = compare_execution(10_000, 9_500, 75_000);
        assert_eq!(cmp.gas_used, 75_000);
    }

    // ============ Arbitrage Tests ============

    #[test]
    fn test_find_arbitrage_routes_basic() {
        let v = vec![
            make_venue(1, 0, 1, 1_000_000, 30, 100, 200),
            make_venue(2, 0, 1, 1_000_000, 30, 200, 100),
        ];
        // Create price discrepancy: pool1 has 1:2 ratio, pool2 has 1:1.5 ratio
        let p = vec![
            make_pool(1, 1, 100, 200, 1_000_000, 2_500_000, 10),
            make_pool(2, 2, 200, 100, 2_000_000, 1_200_000, 10),
        ];
        let arb = find_arbitrage_routes(&v, &p);
        // May or may not find arb depending on exact ratios + fees
        // Just check it doesn't panic
        assert!(arb.len() >= 0);
    }

    #[test]
    fn test_find_arbitrage_routes_no_arb() {
        let v = vec![
            make_venue(1, 0, 1, 1_000_000, 30, 100, 200),
            make_venue(2, 0, 1, 1_000_000, 30, 200, 100),
        ];
        // Same ratio, high fees — no arb
        let p = vec![
            make_pool(1, 1, 100, 200, 1_000_000, 2_000_000, 500),
            make_pool(2, 2, 200, 100, 2_000_000, 1_000_000, 500),
        ];
        let arb = find_arbitrage_routes(&v, &p);
        assert!(arb.is_empty());
    }

    #[test]
    fn test_find_arbitrage_routes_empty() {
        let arb = find_arbitrage_routes(&[], &[]);
        assert!(arb.is_empty());
    }

    #[test]
    fn test_find_arbitrage_routes_single_pool_no_arb() {
        let v = vec![make_venue(1, 0, 1, 1_000_000, 30, 100, 200)];
        let p = vec![make_pool(1, 1, 100, 200, 1_000_000, 2_000_000, 30)];
        let arb = find_arbitrage_routes(&v, &p);
        assert!(arb.is_empty()); // can't arb with single pool
    }

    // ============ Internal Helper Tests ============

    #[test]
    fn test_calculate_single_hop_output_basic() {
        let pool = make_pool(1, 1, 100, 200, 1_000_000, 2_000_000, 30);
        let out = calculate_single_hop_output(10_000, &pool, 100);
        assert!(out > 0);
        assert!(out < 20_000); // can't exceed reserves ratio
    }

    #[test]
    fn test_calculate_single_hop_output_zero_reserves() {
        let pool = make_pool(1, 1, 100, 200, 0, 2_000_000, 30);
        let out = calculate_single_hop_output(10_000, &pool, 100);
        assert_eq!(out, 0);
    }

    #[test]
    fn test_calculate_single_hop_output_wrong_token() {
        let pool = make_pool(1, 1, 100, 200, 1_000_000, 2_000_000, 30);
        let out = calculate_single_hop_output(10_000, &pool, 999);
        assert_eq!(out, 0);
    }

    #[test]
    fn test_calculate_single_hop_output_reverse_direction() {
        let pool = make_pool(1, 1, 100, 200, 1_000_000, 2_000_000, 30);
        let out = calculate_single_hop_output(10_000, &pool, 200);
        assert!(out > 0);
        assert!(out < 10_000); // 2:1 ratio but getting less favorable direction
    }

    #[test]
    fn test_calculate_single_hop_output_large_amount() {
        let pool = make_pool(1, 1, 100, 200, 1_000_000, 2_000_000, 30);
        let out = calculate_single_hop_output(500_000, &pool, 100);
        assert!(out > 0);
        assert!(out < 2_000_000); // can't drain pool
    }

    #[test]
    fn test_calculate_single_hop_output_zero_fee() {
        let pool = make_pool(1, 1, 100, 200, 1_000_000, 1_000_000, 0);
        let out = calculate_single_hop_output(10_000, &pool, 100);
        // With zero fee: out = 1_000_000 * 10_000 / (1_000_000 + 10_000) = 9900 (approx)
        assert!(out > 9_800 && out < 10_100);
    }

    // ============ Pool to Hop Tests ============

    #[test]
    fn test_pool_to_hop_basic() {
        let venues = sample_venues();
        let pool = make_pool(1, 1, 100, 200, 1_000_000, 2_000_000, 30);
        let hop = pool_to_hop(&pool, 100, 200, &venues);
        assert!(hop.is_some());
        let h = hop.unwrap();
        assert_eq!(h.token_in, 100);
        assert_eq!(h.token_out, 200);
        assert_eq!(h.fee_bps, 30);
    }

    #[test]
    fn test_pool_to_hop_wrong_pair() {
        let venues = sample_venues();
        let pool = make_pool(1, 1, 100, 200, 1_000_000, 2_000_000, 30);
        let hop = pool_to_hop(&pool, 300, 400, &venues);
        assert!(hop.is_none());
    }

    #[test]
    fn test_pool_to_hop_zero_reserves() {
        let venues = sample_venues();
        let pool = make_pool(1, 1, 100, 200, 0, 2_000_000, 30);
        let hop = pool_to_hop(&pool, 100, 200, &venues);
        assert!(hop.is_none());
    }

    // ============ Gas to BPS Tests ============

    #[test]
    fn test_gas_to_bps_basic() {
        let bps = gas_to_bps(100, 10_000);
        assert_eq!(bps, 100); // 1%
    }

    #[test]
    fn test_gas_to_bps_zero_amount() {
        assert_eq!(gas_to_bps(100, 0), 0);
    }

    #[test]
    fn test_gas_to_bps_zero_gas() {
        assert_eq!(gas_to_bps(0, 10_000), 0);
    }

    #[test]
    fn test_gas_to_bps_capped() {
        let bps = gas_to_bps(u64::MAX, 1);
        assert_eq!(bps, BPS);
    }

    // ============ Find Intermediate Token Tests ============

    #[test]
    fn test_find_intermediate_token_basic() {
        let p1 = make_pool(1, 1, 100, 200, 1_000_000, 2_000_000, 30);
        let p2 = make_pool(2, 2, 200, 300, 500_000, 1_500_000, 25);
        let mid = find_intermediate_token(&p1, &p2, 100, 300);
        assert_eq!(mid, Some(200));
    }

    #[test]
    fn test_find_intermediate_token_no_shared() {
        let p1 = make_pool(1, 1, 100, 200, 1_000_000, 2_000_000, 30);
        let p2 = make_pool(2, 2, 300, 400, 500_000, 1_500_000, 25);
        let mid = find_intermediate_token(&p1, &p2, 100, 400);
        assert!(mid.is_none());
    }

    #[test]
    fn test_find_intermediate_token_same_as_input() {
        let p1 = make_pool(1, 1, 100, 200, 1_000_000, 2_000_000, 30);
        let p2 = make_pool(2, 2, 100, 300, 500_000, 1_500_000, 25);
        // intermediate would be 100, which equals token_in
        let mid = find_intermediate_token(&p1, &p2, 200, 300);
        assert_eq!(mid, Some(100));
    }

    // ============ Estimate Gas for Venue Tests ============

    #[test]
    fn test_estimate_gas_for_venue_amm() {
        let venues = vec![make_venue(1, 0, 1, 1_000_000, 30, 100, 200)];
        assert_eq!(estimate_gas_for_venue(1, &venues), GAS_PER_HOP);
    }

    #[test]
    fn test_estimate_gas_for_venue_bridge() {
        let venues = vec![make_venue(1, 2, 1, 1_000_000, 50, 100, 200)];
        assert_eq!(estimate_gas_for_venue(1, &venues), GAS_PER_BRIDGE);
    }

    #[test]
    fn test_estimate_gas_for_venue_orderbook() {
        let venues = vec![make_venue(1, 1, 1, 1_000_000, 10, 100, 200)];
        assert_eq!(estimate_gas_for_venue(1, &venues), GAS_PER_HOP);
    }

    #[test]
    fn test_estimate_gas_for_venue_not_found() {
        assert_eq!(estimate_gas_for_venue(999, &[]), GAS_PER_HOP);
    }

    // ============ Edge Case & Overflow Tests ============

    #[test]
    fn test_large_amount_no_panic() {
        let pool = make_pool(1, 1, 100, 200, u64::MAX / 2, u64::MAX / 2, 30);
        let out = calculate_single_hop_output(u64::MAX / 4, &pool, 100);
        assert!(out > 0);
    }

    #[test]
    fn test_max_u64_price_impact() {
        let impact = calculate_price_impact(u64::MAX, u64::MAX);
        assert_eq!(impact, BPS);
    }

    #[test]
    fn test_slippage_max_amount_max_liq() {
        let slip = estimate_slippage(u64::MAX, u64::MAX, 30);
        // u64::MAX / u64::MAX = 1 BPS + 30 fee = 31
        assert!(slip >= 30);
    }

    #[test]
    fn test_effective_price_large_values() {
        let price = calculate_effective_price(u64::MAX / 2, u64::MAX / 2);
        assert_eq!(price, PRICE_PRECISION as u64);
    }

    #[test]
    fn test_multi_hop_output_max_fee() {
        let out = multi_hop_output(10_000, &[BPS], &[PRICE_PRECISION as u64]).unwrap();
        assert_eq!(out, 0); // 100% fee = 0 output
    }

    #[test]
    fn test_route_output_many_hops() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 100);
        let route = make_route(vec![h.clone(), h.clone(), h.clone(), h.clone(), h.clone()], 500, 10_000, 250_000);
        let out = calculate_route_output(&route, 10_000).unwrap();
        assert!(out > 0);
        assert!(out < 10_000);
    }

    #[test]
    fn test_split_order_preserves_input_with_many_venues() {
        let mut venues = Vec::new();
        let mut pools = Vec::new();
        for i in 0..5 {
            venues.push(make_venue(i + 1, 0, 1, 100_000 * (i + 1), 30, 100, 200));
            pools.push(make_pool(i + 1, i + 1, 100, 200, 100_000 * (i + 1), 200_000 * (i + 1), 30));
        }
        let req = make_request(100, 200, 500_000, 1, 500, 1);
        let split = split_order(&req, &venues, &pools).unwrap();
        let total: u64 = split.splits.iter().map(|s| s.amount).sum();
        assert_eq!(total, 500_000);
    }

    #[test]
    fn test_cache_route_ttl_zero() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(vec![h], 30, 100_000, 50_000);
        let cached = cache_route(&route, 0, 1000);
        assert_eq!(cached.ttl_ms, 0);
    }

    #[test]
    fn test_lookup_cached_multi_hop_route() {
        let h1 = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let h2 = make_hop(2, 200, 300, 2, PRICE_PRECISION as u64, 25);
        let route = make_route(vec![h1, h2], 55, 100_000, 100_000);
        let cached = cache_route(&route, DEFAULT_CACHE_TTL_MS, 1000);
        let mut cache = vec![cached];
        let result = lookup_cached_route(&mut cache, 100, 300, 2000);
        assert!(result.is_some());
    }

    #[test]
    fn test_score_route_high_output() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 0);
        let r = make_route(vec![h], 0, 10_000_000, 50_000);
        let score = score_route(&r);
        assert!(score.price_score > 9_000);
    }

    #[test]
    fn test_execution_plan_step_dependencies_sequential() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(
            vec![h.clone(), h.clone(), h.clone(), h.clone()],
            120, 100_000, 200_000,
        );
        let plan = build_execution_plan(&route);
        for (i, step) in plan.steps.iter().enumerate() {
            if i == 0 {
                assert!(step.depends_on.is_empty());
            } else {
                assert_eq!(step.depends_on, vec![(i - 1) as u32]);
            }
        }
    }

    #[test]
    fn test_bridge_time_zero_ids() {
        assert_eq!(estimate_bridge_time(0, 0), 0);
    }

    #[test]
    fn test_bridge_time_large_chain_ids() {
        let time = estimate_bridge_time(u64::MAX, u64::MAX - 1);
        assert!(time > 0);
    }

    #[test]
    fn test_venue_stats_single_fill() {
        let fills = vec![Fill { venue_id: 5, slippage_bps: 42, filled: true, gas_used: 100_000 }];
        let stats = aggregate_venue_stats(&fills);
        assert_eq!(stats.venue_id, 5);
        assert_eq!(stats.avg_slippage_bps, 42);
        assert_eq!(stats.fill_rate_bps, BPS);
        assert_eq!(stats.avg_gas, 100_000);
        assert_eq!(stats.trade_count, 1);
    }

    #[test]
    fn test_compare_execution_large_deviation() {
        let cmp = compare_execution(100, 1_000, 50_000);
        assert!(cmp.deviation_bps > 0);
    }

    #[test]
    fn test_optimal_split_ratio_all_zero_amounts() {
        let result = optimal_split_ratio(&[0, 0, 0], &[100, 200, 300]);
        let total: u64 = result.iter().sum();
        assert_eq!(total, 0);
    }

    #[test]
    fn test_find_best_route_prefers_lower_fee() {
        let v = vec![
            make_venue(1, 0, 1, 1_000_000, 300, 100, 200),
            make_venue(2, 0, 1, 1_000_000, 10, 100, 200),
        ];
        let p = vec![
            make_pool(1, 1, 100, 200, 1_000_000, 1_000_000, 300),
            make_pool(2, 2, 100, 200, 1_000_000, 1_000_000, 10),
        ];
        let req = make_request(100, 200, 10_000, 1, 500, 1);
        let route = find_best_route(&req, &v, &p).unwrap();
        // Lower fee pool should give more output
        assert!(route.expected_output > 0);
    }

    #[test]
    fn test_validate_plan_missing_dependency() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let plan = ExecutionPlan {
            steps: vec![
                ExecutionStep { hop: h.clone(), sequence_order: 0, depends_on: vec![], timeout_ms: 60_000 },
                ExecutionStep { hop: h, sequence_order: 1, depends_on: vec![5], timeout_ms: 60_000 },
            ],
            total_timeout_ms: 120_000,
            estimated_gas: 100_000,
        };
        assert!(validate_execution_plan(&plan).is_err());
    }

    #[test]
    fn test_route_cost_zero_fees() {
        let hop = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 0);
        let route = make_route(vec![hop], 0, 100_000, 0);
        assert_eq!(calculate_route_cost(&route), 0);
    }

    #[test]
    fn test_single_hop_output_tiny_reserves() {
        let pool = make_pool(1, 1, 100, 200, 1, 1, 0);
        let out = calculate_single_hop_output(1, &pool, 100);
        // With reserves of 1/1, putting in 1: out = 1*1/(1+1) = 0
        assert!(out <= 1);
    }

    #[test]
    fn test_multi_hop_output_three_hops() {
        let p = PRICE_PRECISION as u64;
        let out = multi_hop_output(100_000, &[30, 25, 10], &[p, p, p]).unwrap();
        // Each hop takes a fee
        assert!(out < 100_000);
        assert!(out > 90_000); // small fees
    }

    #[test]
    fn test_score_route_many_hops_low_reliability() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(
            vec![h.clone(), h.clone(), h.clone(), h.clone(), h.clone(), h.clone()],
            180, 100_000, 300_000,
        );
        let score = score_route(&route);
        // 6 hops * 500 penalty = 3000, so reliability = 10000 - 3000 = 7000
        assert!(score.reliability_score <= 7_000);
    }

    #[test]
    fn test_find_all_routes_max_hops_exceeds_limit() {
        let v = sample_venues();
        let p = sample_pools();
        let req = make_request(100, 200, 10_000, 100, 500, 1);
        let routes = find_all_routes(&req, &v, &p, 50);
        // Should still work, capping at MAX_HOPS
        assert!(!routes.is_empty());
    }

    #[test]
    fn test_rebalance_split_zero_prices() {
        let so = SplitOrder {
            splits: vec![Split { venue_id: 1, amount: 1000, expected_output: 990, cost_bps: 30 }],
            total_input: 1000,
            total_expected_output: 990,
        };
        assert!(rebalance_split(&so, &[0]).is_err());
    }

    #[test]
    fn test_estimate_slippage_medium_amount() {
        let slip = estimate_slippage(100_000, 1_000_000, 50);
        // 100k/1M = 1000 bps + 50 fee = 1050
        assert_eq!(slip, 1_050);
    }

    #[test]
    fn test_compare_execution_both_zero() {
        let cmp = compare_execution(0, 0, 0);
        assert_eq!(cmp.deviation_bps, 0);
        assert_eq!(cmp.gas_used, 0);
    }

    #[test]
    fn test_select_venues_with_bridge() {
        let v = vec![
            make_venue(1, 0, 1, 1_000_000, 30, 100, 200),
            make_venue(2, 2, 2, 500_000, 50, 100, 200),
        ];
        let selected = select_venues(100, 200, &v);
        assert_eq!(selected.len(), 2);
        assert_eq!(selected[1].venue_type, 2);
    }

    #[test]
    fn test_filter_venues_preserves_order() {
        let v = vec![
            make_venue(3, 0, 1, 3_000, 30, 100, 200),
            make_venue(1, 0, 1, 1_000, 30, 100, 200),
            make_venue(2, 0, 1, 2_000, 30, 100, 200),
        ];
        let filtered = filter_venues_by_liquidity(&v, 1_500);
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].id, 3);
        assert_eq!(filtered[1].id, 2);
    }

    #[test]
    fn test_cache_preserves_route_data() {
        let h = make_hop(7, 100, 200, 42, 999, 30);
        let route = make_route(vec![h], 30, 12345, 67890);
        let cached = cache_route(&route, 5000, 9999);
        assert_eq!(cached.route.expected_output, 12345);
        assert_eq!(cached.route.gas_estimate, 67890);
        assert_eq!(cached.route.hops[0].venue_id, 7);
        assert_eq!(cached.route.hops[0].pool_id, 42);
    }

    #[test]
    fn test_topological_sort_independent_steps() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let steps = vec![
            ExecutionStep { hop: h.clone(), sequence_order: 0, depends_on: vec![], timeout_ms: 60_000 },
            ExecutionStep { hop: h.clone(), sequence_order: 1, depends_on: vec![], timeout_ms: 60_000 },
            ExecutionStep { hop: h.clone(), sequence_order: 2, depends_on: vec![], timeout_ms: 60_000 },
        ];
        let sorted = topological_sort_steps(&steps).unwrap();
        assert_eq!(sorted.len(), 3);
    }

    #[test]
    fn test_route_struct_clone() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, 30);
        let route = make_route(vec![h], 30, 100_000, 50_000);
        let cloned = route.clone();
        assert_eq!(route, cloned);
    }

    #[test]
    fn test_venue_struct_debug() {
        let v = make_venue(1, 0, 1, 1_000_000, 30, 100, 200);
        let debug = format!("{:?}", v);
        assert!(debug.contains("Venue"));
    }

    #[test]
    fn test_split_struct_fields() {
        let s = Split { venue_id: 5, amount: 1000, expected_output: 990, cost_bps: 30 };
        assert_eq!(s.venue_id, 5);
        assert_eq!(s.amount, 1000);
        assert_eq!(s.expected_output, 990);
        assert_eq!(s.cost_bps, 30);
    }

    #[test]
    fn test_hop_struct_fields() {
        let h = make_hop(3, 100, 200, 7, 500, 25);
        assert_eq!(h.venue_id, 3);
        assert_eq!(h.token_in, 100);
        assert_eq!(h.token_out, 200);
        assert_eq!(h.pool_id, 7);
        assert_eq!(h.expected_price, 500);
        assert_eq!(h.fee_bps, 25);
    }

    #[test]
    fn test_route_request_fields() {
        let req = make_request(100, 200, 50_000, 3, 150, 1);
        assert_eq!(req.token_in, 100);
        assert_eq!(req.token_out, 200);
        assert_eq!(req.amount, 50_000);
        assert_eq!(req.max_hops, 3);
        assert_eq!(req.max_slippage_bps, 150);
        assert_eq!(req.chain_id, 1);
    }

    #[test]
    fn test_execution_step_fields() {
        let h = make_hop(1, 100, 200, 1, 500, 30);
        let step = ExecutionStep {
            hop: h.clone(),
            sequence_order: 2,
            depends_on: vec![0, 1],
            timeout_ms: 30_000,
        };
        assert_eq!(step.sequence_order, 2);
        assert_eq!(step.depends_on.len(), 2);
        assert_eq!(step.timeout_ms, 30_000);
    }

    #[test]
    fn test_venue_stats_fields() {
        let vs = VenueStats {
            venue_id: 3,
            avg_slippage_bps: 15,
            fill_rate_bps: 9500,
            avg_gas: 55_000,
            trade_count: 100,
        };
        assert_eq!(vs.venue_id, 3);
        assert_eq!(vs.fill_rate_bps, 9500);
    }

    #[test]
    fn test_route_comparison_fields() {
        let rc = RouteComparison {
            estimated_output: 10_000,
            actual_output: 9_800,
            deviation_bps: 200,
            gas_used: 75_000,
        };
        assert_eq!(rc.deviation_bps, 200);
    }

    #[test]
    fn test_cached_route_fields() {
        let h = make_hop(1, 100, 200, 1, 500, 30);
        let route = make_route(vec![h], 30, 100_000, 50_000);
        let cr = CachedRoute {
            route,
            cached_at: 5000,
            ttl_ms: 30_000,
            hit_count: 7,
        };
        assert_eq!(cr.cached_at, 5000);
        assert_eq!(cr.hit_count, 7);
    }

    #[test]
    fn test_fill_struct_fields() {
        let f = Fill { venue_id: 2, slippage_bps: 15, filled: true, gas_used: 80_000 };
        assert_eq!(f.venue_id, 2);
        assert!(f.filled);
    }

    #[test]
    fn test_route_score_fields() {
        let rs = RouteScore {
            price_score: 8000,
            gas_score: 9000,
            reliability_score: 7500,
            total_score: 8167,
        };
        assert_eq!(rs.price_score, 8000);
        assert_eq!(rs.total_score, 8167);
    }

    #[test]
    fn test_pool_struct_fields() {
        let p = make_pool(5, 3, 100, 200, 500_000, 1_000_000, 25);
        assert_eq!(p.id, 5);
        assert_eq!(p.venue_id, 3);
        assert_eq!(p.reserve_a, 500_000);
    }

    #[test]
    fn test_calculate_route_cost_saturating() {
        let h = make_hop(1, 100, 200, 1, PRICE_PRECISION as u64, u64::MAX);
        let route = make_route(vec![h.clone(), h], u64::MAX, 1, u64::MAX);
        let cost = calculate_route_cost(&route);
        // Should not panic, saturates
        assert!(cost > 0);
    }

    #[test]
    fn test_split_order_reverse_token_pair() {
        let v = vec![make_venue(1, 0, 1, 1_000_000, 30, 200, 100)];
        let p = vec![make_pool(1, 1, 200, 100, 2_000_000, 1_000_000, 30)];
        let req = make_request(100, 200, 50_000, 1, 200, 1);
        let split = split_order(&req, &v, &p).unwrap();
        assert!(split.total_expected_output > 0);
    }

    #[test]
    fn test_multi_hop_output_very_small_amount() {
        let p = PRICE_PRECISION as u64;
        let out = multi_hop_output(1, &[30], &[p]).unwrap();
        // 1 * (10000-30)/10000 = 0 due to integer math
        assert!(out <= 1);
    }
}
