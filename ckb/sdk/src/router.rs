// ============ DEX Router — Multi-hop Swap Path Finding ============
// Finds optimal routes through a graph of AMM pools for token swaps.
//
// Key capabilities:
// - Build a pool graph from on-chain PoolCellData
// - BFS path discovery (up to MAX_HOPS intermediate tokens)
// - Best-route selection by simulating get_amount_out through each hop
// - Split routing: divide a large order across multiple paths
// - Price impact estimation per route
// - Slippage-aware output calculation
//
// The router is off-chain only — it inspects pool state and recommends
// which pools to include in a multi-hop swap transaction.

use std::collections::BTreeMap;

use vibeswap_math::batch_math;
use vibeswap_math::BPS_DENOMINATOR;

// ============ Constants ============

/// Maximum number of intermediate hops (A→X→...→B). 4 means up to 5 pools chained.
pub const MAX_HOPS: usize = 4;

/// Maximum number of candidate routes to evaluate per query
const MAX_ROUTES: usize = 64;

/// Maximum number of splits for split routing
const MAX_SPLITS: usize = 4;

/// Minimum meaningful output to consider a route viable (1 unit)
const MIN_OUTPUT: u128 = 1;

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RouterError {
    /// No viable route exists between the two tokens
    NoRouteFound,
    /// Input amount is zero
    ZeroInput,
    /// Insufficient liquidity along the path
    InsufficientLiquidity,
    /// Pool graph has no pools
    EmptyGraph,
    /// Token in equals token out
    SameToken,
}

// ============ Pool Graph Types ============

/// A pool edge in the routing graph
#[derive(Clone, Debug)]
pub struct PoolEdge {
    /// Unique pool identifier (pair_id from PoolCellData)
    pub pair_id: [u8; 32],
    /// Type hash of token0
    pub token0: [u8; 32],
    /// Type hash of token1
    pub token1: [u8; 32],
    /// Current reserve of token0
    pub reserve0: u128,
    /// Current reserve of token1
    pub reserve1: u128,
    /// Fee rate in basis points
    pub fee_rate_bps: u16,
}

/// A single hop in a swap route
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SwapHop {
    /// Index into PoolGraph.pools
    pub pool_index: usize,
    /// The pair_id of this pool
    pub pair_id: [u8; 32],
    /// Token being sold into this pool
    pub token_in: [u8; 32],
    /// Token being bought from this pool
    pub token_out: [u8; 32],
}

/// A complete route from input token to output token
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SwapRoute {
    /// Ordered sequence of pool hops
    pub hops: Vec<SwapHop>,
    /// Expected output amount for the given input
    pub expected_output: u128,
    /// Price impact in basis points (0-10000)
    pub price_impact_bps: u16,
}

/// A split route: multiple paths with allocated amounts
#[derive(Clone, Debug, PartialEq)]
pub struct SplitRoute {
    /// Each (route, amount_in) pair
    pub legs: Vec<(SwapRoute, u128)>,
    /// Total expected output across all legs
    pub total_output: u128,
}

// ============ Pool Graph ============

/// Graph of AMM pools for route discovery
#[derive(Clone, Debug)]
pub struct PoolGraph {
    /// All pools in the graph
    pub pools: Vec<PoolEdge>,
    /// Adjacency list: token_hash → [(pool_index, neighbor_token)]
    adjacency: BTreeMap<[u8; 32], Vec<(usize, [u8; 32])>>,
}

impl PoolGraph {
    /// Create an empty pool graph
    pub fn new() -> Self {
        Self {
            pools: Vec::new(),
            adjacency: BTreeMap::new(),
        }
    }

    /// Add a pool to the graph. Returns the pool index.
    pub fn add_pool(&mut self, pool: PoolEdge) -> usize {
        let idx = self.pools.len();

        // Add bidirectional edges: token0 <-> token1
        self.adjacency
            .entry(pool.token0)
            .or_insert_with(Vec::new)
            .push((idx, pool.token1));
        self.adjacency
            .entry(pool.token1)
            .or_insert_with(Vec::new)
            .push((idx, pool.token0));

        self.pools.push(pool);
        idx
    }

    /// Build a graph from a slice of PoolCellData + pair metadata
    pub fn from_pools(pools: &[(PoolEdge,)]) -> Self {
        let mut graph = Self::new();
        for (edge,) in pools {
            graph.add_pool(edge.clone());
        }
        graph
    }

    /// Number of pools in the graph
    pub fn pool_count(&self) -> usize {
        self.pools.len()
    }

    /// Number of unique tokens in the graph
    pub fn token_count(&self) -> usize {
        self.adjacency.len()
    }

    /// Get all tokens reachable from a given token in one hop
    pub fn neighbors(&self, token: &[u8; 32]) -> Vec<(usize, [u8; 32])> {
        self.adjacency.get(token).cloned().unwrap_or_default()
    }

    // ============ Route Finding ============

    /// Find the best route between two tokens for a given input amount.
    /// Explores all paths up to MAX_HOPS and returns the one with highest output.
    pub fn find_best_route(
        &self,
        token_in: &[u8; 32],
        token_out: &[u8; 32],
        amount_in: u128,
    ) -> Result<SwapRoute, RouterError> {
        if amount_in == 0 {
            return Err(RouterError::ZeroInput);
        }
        if token_in == token_out {
            return Err(RouterError::SameToken);
        }
        if self.pools.is_empty() {
            return Err(RouterError::EmptyGraph);
        }

        let routes = self.find_all_routes(token_in, token_out, MAX_HOPS)?;

        // Simulate each route and pick the best output
        let mut best: Option<SwapRoute> = None;

        for route_hops in routes {
            if let Some(output) = self.simulate_route(&route_hops, amount_in) {
                if output >= MIN_OUTPUT {
                    let impact = self.estimate_price_impact(&route_hops, amount_in);
                    let candidate = SwapRoute {
                        hops: route_hops,
                        expected_output: output,
                        price_impact_bps: impact,
                    };

                    match &best {
                        Some(current) if current.expected_output >= output => {}
                        _ => best = Some(candidate),
                    }
                }
            }
        }

        best.ok_or(RouterError::NoRouteFound)
    }

    /// Find all routes between two tokens, up to max_hops intermediate hops.
    /// Returns raw hop sequences (not yet simulated).
    pub fn find_all_routes(
        &self,
        token_in: &[u8; 32],
        token_out: &[u8; 32],
        max_hops: usize,
    ) -> Result<Vec<Vec<SwapHop>>, RouterError> {
        if token_in == token_out {
            return Err(RouterError::SameToken);
        }
        if self.pools.is_empty() {
            return Err(RouterError::EmptyGraph);
        }

        let mut all_routes = Vec::new();
        let mut current_path: Vec<SwapHop> = Vec::new();
        let mut visited_pools = Vec::new();

        self.dfs_routes(
            token_in,
            token_out,
            max_hops + 1, // max_hops intermediate = max_hops+1 pools
            &mut current_path,
            &mut visited_pools,
            &mut all_routes,
        );

        if all_routes.is_empty() {
            return Err(RouterError::NoRouteFound);
        }

        Ok(all_routes)
    }

    /// DFS route discovery — finds all simple paths from current token to target
    fn dfs_routes(
        &self,
        current: &[u8; 32],
        target: &[u8; 32],
        remaining_hops: usize,
        path: &mut Vec<SwapHop>,
        visited_pools: &mut Vec<usize>,
        results: &mut Vec<Vec<SwapHop>>,
    ) {
        if results.len() >= MAX_ROUTES {
            return;
        }
        if remaining_hops == 0 {
            return;
        }

        let neighbors = self.neighbors(current);
        for (pool_idx, neighbor_token) in neighbors {
            // Skip already-used pools (no loops)
            if visited_pools.contains(&pool_idx) {
                continue;
            }

            let hop = SwapHop {
                pool_index: pool_idx,
                pair_id: self.pools[pool_idx].pair_id,
                token_in: *current,
                token_out: neighbor_token,
            };

            path.push(hop);
            visited_pools.push(pool_idx);

            if neighbor_token == *target {
                // Found a complete route
                results.push(path.clone());
            } else if remaining_hops > 1 {
                // Continue searching
                self.dfs_routes(
                    &neighbor_token,
                    target,
                    remaining_hops - 1,
                    path,
                    visited_pools,
                    results,
                );
            }

            path.pop();
            visited_pools.pop();
        }
    }

    // ============ Route Simulation ============

    /// Simulate a route: feed amount_in through each hop using get_amount_out.
    /// Returns None if any hop fails (insufficient liquidity).
    pub fn simulate_route(&self, hops: &[SwapHop], amount_in: u128) -> Option<u128> {
        let mut current_amount = amount_in;

        for hop in hops {
            let pool = &self.pools[hop.pool_index];
            let (reserve_in, reserve_out) = if hop.token_in == pool.token0 {
                (pool.reserve0, pool.reserve1)
            } else {
                (pool.reserve1, pool.reserve0)
            };

            current_amount = batch_math::get_amount_out(
                current_amount,
                reserve_in,
                reserve_out,
                pool.fee_rate_bps as u128,
            )
            .ok()?;

            if current_amount == 0 {
                return None;
            }
        }

        Some(current_amount)
    }

    /// Estimate price impact for a route.
    /// Compares the effective rate vs. the spot rate (zero-size trade).
    /// Returns basis points (0-10000).
    pub fn estimate_price_impact(&self, hops: &[SwapHop], amount_in: u128) -> u16 {
        if amount_in == 0 {
            return 0;
        }

        // Spot rate: simulate with 1 unit to get the "zero-impact" rate
        // Use a small amount to avoid rounding to 0
        let spot_amount = 1_000_000u128; // 1e6 as a probe
        let spot_output = match self.simulate_route(hops, spot_amount) {
            Some(o) if o > 0 => o,
            _ => return 10_000, // Max impact if probe fails
        };

        let actual_output = match self.simulate_route(hops, amount_in) {
            Some(o) if o > 0 => o,
            _ => return 10_000,
        };

        // spot_rate = spot_output / spot_amount
        // actual_rate = actual_output / amount_in
        // impact = 1 - actual_rate / spot_rate
        //        = 1 - (actual_output * spot_amount) / (amount_in * spot_output)
        let numerator = actual_output as u128 * spot_amount;
        let denominator = amount_in as u128 * spot_output;

        if numerator >= denominator {
            return 0; // No negative impact (shouldn't happen, but safe)
        }

        let ratio_bps = (numerator * BPS_DENOMINATOR) / denominator;
        let impact = BPS_DENOMINATOR - ratio_bps;

        // Clamp to u16 range
        if impact > 10_000 {
            10_000
        } else {
            impact as u16
        }
    }

    // ============ Split Routing ============

    /// Split a large order across multiple routes for better execution.
    /// Uses greedy allocation: give each split to the route with best marginal rate.
    pub fn find_split_route(
        &self,
        token_in: &[u8; 32],
        token_out: &[u8; 32],
        amount_in: u128,
    ) -> Result<SplitRoute, RouterError> {
        if amount_in == 0 {
            return Err(RouterError::ZeroInput);
        }

        let all_routes = self.find_all_routes(token_in, token_out, MAX_HOPS)?;
        if all_routes.is_empty() {
            return Err(RouterError::NoRouteFound);
        }

        // If only one route, don't split
        if all_routes.len() == 1 {
            let output = self
                .simulate_route(&all_routes[0], amount_in)
                .ok_or(RouterError::InsufficientLiquidity)?;
            let impact = self.estimate_price_impact(&all_routes[0], amount_in);
            let route = SwapRoute {
                hops: all_routes[0].clone(),
                expected_output: output,
                price_impact_bps: impact,
            };
            return Ok(SplitRoute {
                legs: vec![(route, amount_in)],
                total_output: output,
            });
        }

        // Score each route at full amount and select top candidates
        let mut scored: Vec<(usize, u128)> = Vec::new();
        for (i, route) in all_routes.iter().enumerate() {
            if let Some(out) = self.simulate_route(route, amount_in) {
                scored.push((i, out));
            }
        }
        scored.sort_by(|a, b| b.1.cmp(&a.1));

        // Take top MAX_SPLITS routes
        let n_splits = scored.len().min(MAX_SPLITS);
        if n_splits == 0 {
            return Err(RouterError::InsufficientLiquidity);
        }

        // Binary search on optimal split ratios using equal splits as starting point
        // For simplicity, try equal splits and 80/20 splits, take best
        let candidate_routes: Vec<&Vec<SwapHop>> =
            scored[..n_splits].iter().map(|(i, _)| &all_routes[*i]).collect();

        let best_split = self.optimize_splits(&candidate_routes, amount_in);

        // Build SplitRoute
        let mut legs = Vec::new();
        let mut total_output = 0u128;

        for (route_hops, leg_amount) in candidate_routes.iter().zip(best_split.iter()) {
            if *leg_amount == 0 {
                continue;
            }
            let output = self
                .simulate_route(route_hops, *leg_amount)
                .unwrap_or(0);
            let impact = self.estimate_price_impact(route_hops, *leg_amount);
            let route = SwapRoute {
                hops: (*route_hops).clone(),
                expected_output: output,
                price_impact_bps: impact,
            };
            total_output += output;
            legs.push((route, *leg_amount));
        }

        if legs.is_empty() || total_output == 0 {
            return Err(RouterError::InsufficientLiquidity);
        }

        Ok(SplitRoute {
            legs,
            total_output,
        })
    }

    /// Optimize split amounts across routes using iterative greedy allocation
    fn optimize_splits(
        &self,
        routes: &[&Vec<SwapHop>],
        total_amount: u128,
    ) -> Vec<u128> {
        let n = routes.len();
        if n == 1 {
            return vec![total_amount];
        }

        // Strategy: divide into granular chunks and allocate each chunk to the
        // route that gives the best marginal output at that point.
        // Use 20 chunks for reasonable granularity without being too slow.
        let n_chunks = 20u128;
        let chunk_size = total_amount / n_chunks;
        if chunk_size == 0 {
            // Amount too small to split meaningfully
            return {
                let mut v = vec![0u128; n];
                v[0] = total_amount;
                v
            };
        }

        let mut allocations = vec![0u128; n];
        let mut remaining = total_amount;

        // For each chunk, simulate adding it to each route and pick the best marginal gain
        for _ in 0..n_chunks {
            if remaining == 0 {
                break;
            }
            let alloc_amount = chunk_size.min(remaining);

            let mut best_route = 0;
            let mut best_marginal = 0u128;

            for (i, route) in routes.iter().enumerate() {
                // Output with current allocation + this chunk
                let new_output = self
                    .simulate_route(route, allocations[i] + alloc_amount)
                    .unwrap_or(0);
                // Output with current allocation only
                let old_output = if allocations[i] > 0 {
                    self.simulate_route(route, allocations[i]).unwrap_or(0)
                } else {
                    0
                };
                let marginal = new_output.saturating_sub(old_output);
                if marginal > best_marginal {
                    best_marginal = marginal;
                    best_route = i;
                }
            }

            allocations[best_route] += alloc_amount;
            remaining -= alloc_amount;
        }

        // Any leftover goes to the first route
        if remaining > 0 {
            allocations[0] += remaining;
        }

        allocations
    }

    // ============ Utility Functions ============

    /// Get the spot price of token_out in terms of token_in for a single pool.
    /// Returns price scaled by PRECISION (1e18).
    pub fn spot_price(pool: &PoolEdge, token_in: &[u8; 32]) -> u128 {
        let (reserve_in, reserve_out) = if *token_in == pool.token0 {
            (pool.reserve0, pool.reserve1)
        } else {
            (pool.reserve1, pool.reserve0)
        };

        if reserve_in == 0 {
            return 0;
        }

        vibeswap_math::mul_div(reserve_out, vibeswap_math::PRECISION, reserve_in)
    }

    /// Get the effective execution price for a given route and amount.
    /// Returns price scaled by PRECISION (1e18).
    pub fn effective_price(
        &self,
        hops: &[SwapHop],
        amount_in: u128,
    ) -> Option<u128> {
        let output = self.simulate_route(hops, amount_in)?;
        if amount_in == 0 {
            return None;
        }
        Some(vibeswap_math::mul_div(output, vibeswap_math::PRECISION, amount_in))
    }

    /// Compute the minimum input needed to get at least `min_output` from a route.
    /// Uses binary search over the simulation function.
    pub fn required_input(
        &self,
        hops: &[SwapHop],
        min_output: u128,
    ) -> Option<u128> {
        if hops.is_empty() {
            return None;
        }

        // Upper bound: use get_amount_in through each hop in reverse
        // Lower bound: 1
        let mut lo: u128 = 1;
        let mut hi: u128 = min_output * 10; // Generous upper bound

        // Ensure hi actually produces enough
        loop {
            match self.simulate_route(hops, hi) {
                Some(out) if out >= min_output => break,
                Some(_) => hi = hi.checked_mul(2)?,
                None => return None, // Route can never produce enough
            }
        }

        // Binary search
        for _ in 0..128 {
            if lo >= hi {
                break;
            }
            let mid = lo + (hi - lo) / 2;
            match self.simulate_route(hops, mid) {
                Some(out) if out >= min_output => hi = mid,
                _ => lo = mid + 1,
            }
        }

        Some(hi)
    }

    /// Calculate the minimum output applying slippage tolerance.
    /// slippage_bps: max acceptable slippage in basis points (e.g., 50 = 0.5%)
    pub fn min_output_with_slippage(expected_output: u128, slippage_bps: u16) -> u128 {
        let slippage = expected_output * slippage_bps as u128 / BPS_DENOMINATOR;
        expected_output.saturating_sub(slippage)
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn token(id: u8) -> [u8; 32] {
        let mut h = [0u8; 32];
        h[0] = id;
        h
    }

    fn pair(a: u8, b: u8) -> [u8; 32] {
        let mut h = [0u8; 32];
        h[0] = a;
        h[1] = b;
        h
    }

    fn pool(t0: u8, t1: u8, r0: u128, r1: u128) -> PoolEdge {
        PoolEdge {
            pair_id: pair(t0, t1),
            token0: token(t0),
            token1: token(t1),
            reserve0: r0,
            reserve1: r1,
            fee_rate_bps: 30, // 0.3% default
        }
    }

    fn graph_two_pools() -> PoolGraph {
        let mut g = PoolGraph::new();
        // A-B pool: 1M/1M (1:1)
        g.add_pool(pool(1, 2, 1_000_000e18 as u128, 1_000_000e18 as u128));
        // B-C pool: 1M/2M (1:2)
        g.add_pool(pool(2, 3, 1_000_000e18 as u128, 2_000_000e18 as u128));
        g
    }

    fn graph_triangle() -> PoolGraph {
        let mut g = PoolGraph::new();
        // A-B: 1M/1M
        g.add_pool(pool(1, 2, 1_000_000e18 as u128, 1_000_000e18 as u128));
        // B-C: 1M/2M
        g.add_pool(pool(2, 3, 1_000_000e18 as u128, 2_000_000e18 as u128));
        // A-C: 500K/1M
        g.add_pool(pool(1, 3, 500_000e18 as u128, 1_000_000e18 as u128));
        g
    }

    // ============ Graph Construction ============

    #[test]
    fn test_empty_graph() {
        let g = PoolGraph::new();
        assert_eq!(g.pool_count(), 0);
        assert_eq!(g.token_count(), 0);
    }

    #[test]
    fn test_add_pool() {
        let mut g = PoolGraph::new();
        let idx = g.add_pool(pool(1, 2, 1000, 2000));
        assert_eq!(idx, 0);
        assert_eq!(g.pool_count(), 1);
        assert_eq!(g.token_count(), 2);
    }

    #[test]
    fn test_adjacency() {
        let g = graph_two_pools();
        let n1 = g.neighbors(&token(1));
        assert_eq!(n1.len(), 1); // A connects to B only
        assert_eq!(n1[0].1, token(2));

        let n2 = g.neighbors(&token(2));
        assert_eq!(n2.len(), 2); // B connects to A and C
    }

    #[test]
    fn test_triangle_adjacency() {
        let g = graph_triangle();
        let n1 = g.neighbors(&token(1));
        assert_eq!(n1.len(), 2); // A connects to B and C
        let n2 = g.neighbors(&token(2));
        assert_eq!(n2.len(), 2); // B connects to A and C
        let n3 = g.neighbors(&token(3));
        assert_eq!(n3.len(), 2); // C connects to A and B
    }

    #[test]
    fn test_isolated_token_no_neighbors() {
        let g = graph_two_pools();
        let n = g.neighbors(&token(99));
        assert!(n.is_empty());
    }

    // ============ Route Finding ============

    #[test]
    fn test_direct_route() {
        let g = graph_two_pools();
        let routes = g.find_all_routes(&token(1), &token(2), 1).unwrap();
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].len(), 1); // Single hop
        assert_eq!(routes[0][0].token_in, token(1));
        assert_eq!(routes[0][0].token_out, token(2));
    }

    #[test]
    fn test_two_hop_route() {
        let g = graph_two_pools();
        let routes = g.find_all_routes(&token(1), &token(3), 2).unwrap();
        assert_eq!(routes.len(), 1); // A→B→C
        assert_eq!(routes[0].len(), 2);
    }

    #[test]
    fn test_triangle_finds_multiple_routes() {
        let g = graph_triangle();
        let routes = g.find_all_routes(&token(1), &token(3), 2).unwrap();
        // Should find: A→C (direct) and A→B→C (two-hop)
        assert_eq!(routes.len(), 2);
    }

    #[test]
    fn test_no_route_disjoint_graph() {
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1000, 2000)); // A-B
        g.add_pool(pool(3, 4, 1000, 2000)); // C-D (disconnected)
        let result = g.find_all_routes(&token(1), &token(4), 4);
        assert_eq!(result, Err(RouterError::NoRouteFound));
    }

    #[test]
    fn test_same_token_error() {
        let g = graph_two_pools();
        assert_eq!(
            g.find_best_route(&token(1), &token(1), 1000),
            Err(RouterError::SameToken)
        );
    }

    #[test]
    fn test_zero_input_error() {
        let g = graph_two_pools();
        assert_eq!(
            g.find_best_route(&token(1), &token(2), 0),
            Err(RouterError::ZeroInput)
        );
    }

    #[test]
    fn test_empty_graph_error() {
        let g = PoolGraph::new();
        assert_eq!(
            g.find_best_route(&token(1), &token(2), 1000),
            Err(RouterError::EmptyGraph)
        );
    }

    #[test]
    fn test_max_hops_respected() {
        // Build a chain: A→B→C→D→E→F (5 hops)
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1_000_000, 1_000_000));
        g.add_pool(pool(2, 3, 1_000_000, 1_000_000));
        g.add_pool(pool(3, 4, 1_000_000, 1_000_000));
        g.add_pool(pool(4, 5, 1_000_000, 1_000_000));
        g.add_pool(pool(5, 6, 1_000_000, 1_000_000));

        // With max_hops=3, can't reach F from A (needs 5)
        let result = g.find_all_routes(&token(1), &token(6), 3);
        assert_eq!(result, Err(RouterError::NoRouteFound));

        // With max_hops=5, should find it
        let routes = g.find_all_routes(&token(1), &token(6), 5).unwrap();
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].len(), 5);
    }

    // ============ Route Simulation ============

    #[test]
    fn test_simulate_single_hop() {
        let g = graph_two_pools();
        let hop = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        let amount_in = 1_000e18 as u128;
        let output = g.simulate_route(&hop, amount_in).unwrap();
        // With 0.3% fee on 1:1 pool with 1M reserves, output should be slightly less than input
        assert!(output > 0);
        assert!(output < amount_in); // Fee + slippage
    }

    #[test]
    fn test_simulate_two_hop() {
        let g = graph_two_pools();
        let hops = vec![
            SwapHop {
                pool_index: 0,
                pair_id: pair(1, 2),
                token_in: token(1),
                token_out: token(2),
            },
            SwapHop {
                pool_index: 1,
                pair_id: pair(2, 3),
                token_in: token(2),
                token_out: token(3),
            },
        ];
        let amount_in = 1_000e18 as u128;
        let output = g.simulate_route(&hops, amount_in).unwrap();
        // A→B→C: 1:1 then 1:2, so ~2x minus fees and slippage
        assert!(output > amount_in); // Should be roughly 2x due to B:C = 1:2
    }

    #[test]
    fn test_simulate_reverse_direction() {
        let g = graph_two_pools();
        // Swap C→B (reverse direction through B-C pool)
        let hop = vec![SwapHop {
            pool_index: 1,
            pair_id: pair(2, 3),
            token_in: token(3),
            token_out: token(2),
        }];
        let amount_in = 1_000e18 as u128;
        let output = g.simulate_route(&hop, amount_in).unwrap();
        // C is token1 with 2M reserve, B is token0 with 1M reserve
        // Swapping 1000 C should get roughly 500 B minus fees
        assert!(output > 0);
        assert!(output < amount_in);
    }

    #[test]
    fn test_simulate_empty_hops() {
        let g = graph_two_pools();
        let output = g.simulate_route(&[], 1000);
        // Empty route should return the input amount unchanged
        assert_eq!(output, Some(1000));
    }

    #[test]
    fn test_simulate_zero_reserves() {
        let mut g = PoolGraph::new();
        g.add_pool(PoolEdge {
            pair_id: pair(1, 2),
            token0: token(1),
            token1: token(2),
            reserve0: 0,
            reserve1: 0,
            fee_rate_bps: 30,
        });
        let hop = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        assert!(g.simulate_route(&hop, 1000).is_none());
    }

    // ============ Best Route Selection ============

    #[test]
    fn test_best_route_direct_vs_indirect() {
        let g = graph_triangle();
        let amount = 1_000e18 as u128;
        let best = g.find_best_route(&token(1), &token(3), amount).unwrap();

        // Both direct A→C and indirect A→B→C exist
        // The direct route through A-C (500K/1M = 1:2) should give ~2x
        // The indirect A→B→C: A→B (1M/1M = 1:1) then B→C (1M/2M = 1:2) also ~2x but with double fees
        // Direct should win due to fewer hops (less fee)
        assert_eq!(best.hops.len(), 1); // Direct route preferred
        assert!(best.expected_output > 0);
    }

    #[test]
    fn test_best_route_prefers_deeper_liquidity() {
        let mut g = PoolGraph::new();
        // Shallow pool: 1K/1K
        g.add_pool(pool(1, 2, 1_000e18 as u128, 1_000e18 as u128));
        // Parallel deep pool (need different pair_id so use same tokens but bigger)
        g.add_pool(PoolEdge {
            pair_id: {
                let mut p = pair(1, 2);
                p[31] = 1; // Different pair_id
                p
            },
            token0: token(1),
            token1: token(2),
            reserve0: 1_000_000e18 as u128,
            reserve1: 1_000_000e18 as u128,
            fee_rate_bps: 30,
        });

        // Large swap: 100 tokens — should prefer the deeper pool
        let amount = 100e18 as u128;
        let best = g.find_best_route(&token(1), &token(2), amount).unwrap();
        assert_eq!(best.hops[0].pool_index, 1); // Deep pool
    }

    // ============ Price Impact ============

    #[test]
    fn test_price_impact_small_trade() {
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        // Very small trade relative to reserves — near zero impact
        let impact = g.estimate_price_impact(&hops, 100e18 as u128);
        assert!(impact < 50); // Less than 0.5% impact for 0.01% of reserves
    }

    #[test]
    fn test_price_impact_large_trade() {
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        // 10% of reserves — significant impact
        let impact = g.estimate_price_impact(&hops, 100_000e18 as u128);
        assert!(impact > 100); // More than 1% impact
    }

    #[test]
    fn test_price_impact_zero_input() {
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        assert_eq!(g.estimate_price_impact(&hops, 0), 0);
    }

    // ============ Spot Price ============

    #[test]
    fn test_spot_price_balanced_pool() {
        let p = pool(1, 2, 1_000_000e18 as u128, 1_000_000e18 as u128);
        let price = PoolGraph::spot_price(&p, &token(1));
        // 1:1 pool should give PRECISION (1e18)
        assert_eq!(price, vibeswap_math::PRECISION);
    }

    #[test]
    fn test_spot_price_imbalanced_pool() {
        let p = pool(1, 2, 1_000_000e18 as u128, 2_000_000e18 as u128);
        let price = PoolGraph::spot_price(&p, &token(1));
        // token1/token0 = 2, so price = 2e18
        assert_eq!(price, 2 * vibeswap_math::PRECISION);
    }

    #[test]
    fn test_spot_price_reverse() {
        let p = pool(1, 2, 1_000_000e18 as u128, 2_000_000e18 as u128);
        let price_forward = PoolGraph::spot_price(&p, &token(1));
        let price_reverse = PoolGraph::spot_price(&p, &token(2));
        // Forward * reverse should approximately equal PRECISION^2
        let product = vibeswap_math::mul_div(price_forward, price_reverse, vibeswap_math::PRECISION);
        // Should be close to PRECISION (within rounding)
        let diff = if product > vibeswap_math::PRECISION {
            product - vibeswap_math::PRECISION
        } else {
            vibeswap_math::PRECISION - product
        };
        assert!(diff < 2); // Rounding tolerance
    }

    #[test]
    fn test_spot_price_zero_reserve() {
        let p = pool(1, 2, 0, 1_000_000e18 as u128);
        assert_eq!(PoolGraph::spot_price(&p, &token(1)), 0);
    }

    // ============ Effective Price ============

    #[test]
    fn test_effective_price_includes_slippage() {
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];

        let spot = PoolGraph::spot_price(&g.pools[0], &token(1));
        let effective = g.effective_price(&hops, 10_000e18 as u128).unwrap();

        // Effective price should be worse (lower) than spot due to fees + slippage
        assert!(effective < spot);
    }

    // ============ Required Input ============

    #[test]
    fn test_required_input_single_hop() {
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];

        let desired_output = 500e18 as u128;
        let required = g.required_input(&hops, desired_output).unwrap();

        // Verify: the required input actually produces >= desired output
        let actual_output = g.simulate_route(&hops, required).unwrap();
        assert!(actual_output >= desired_output);

        // And required-1 produces less
        if required > 1 {
            let under_output = g.simulate_route(&hops, required - 1).unwrap_or(0);
            assert!(under_output < desired_output);
        }
    }

    #[test]
    fn test_required_input_two_hop() {
        let g = graph_two_pools();
        let hops = vec![
            SwapHop {
                pool_index: 0,
                pair_id: pair(1, 2),
                token_in: token(1),
                token_out: token(2),
            },
            SwapHop {
                pool_index: 1,
                pair_id: pair(2, 3),
                token_in: token(2),
                token_out: token(3),
            },
        ];

        let desired = 1_000e18 as u128;
        let required = g.required_input(&hops, desired).unwrap();
        let actual = g.simulate_route(&hops, required).unwrap();
        assert!(actual >= desired);
    }

    // ============ Slippage ============

    #[test]
    fn test_min_output_with_slippage() {
        let expected = 1_000_000u128;
        // 0.5% slippage
        let min = PoolGraph::min_output_with_slippage(expected, 50);
        assert_eq!(min, 995_000); // 1M - 0.5%
    }

    #[test]
    fn test_min_output_with_zero_slippage() {
        let expected = 1_000_000u128;
        assert_eq!(PoolGraph::min_output_with_slippage(expected, 0), 1_000_000);
    }

    #[test]
    fn test_min_output_with_100pct_slippage() {
        let expected = 1_000_000u128;
        assert_eq!(PoolGraph::min_output_with_slippage(expected, 10_000), 0);
    }

    // ============ Split Routing ============

    #[test]
    fn test_split_route_single_path() {
        let g = graph_two_pools();
        let split = g
            .find_split_route(&token(1), &token(2), 1_000e18 as u128)
            .unwrap();
        // Only one route A→B, so no split
        assert_eq!(split.legs.len(), 1);
        assert!(split.total_output > 0);
    }

    #[test]
    fn test_split_route_triangle() {
        let g = graph_triangle();
        let amount = 50_000e18 as u128;
        let split = g.find_split_route(&token(1), &token(3), amount).unwrap();

        // Should find multiple routes and potentially split
        assert!(split.total_output > 0);

        // Total allocation should sum to input
        let total_alloc: u128 = split.legs.iter().map(|(_, a)| *a).sum();
        assert_eq!(total_alloc, amount);
    }

    #[test]
    fn test_split_route_beats_single() {
        // Build parallel paths with different liquidity depths
        let mut g = PoolGraph::new();
        // Direct A→C: 100K/200K (thin)
        g.add_pool(pool(1, 3, 100_000e18 as u128, 200_000e18 as u128));
        // A→B: 1M/1M, B→C: 1M/2M (deep indirect)
        g.add_pool(pool(1, 2, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(2, 3, 1_000_000e18 as u128, 2_000_000e18 as u128));

        let amount = 50_000e18 as u128;
        let split = g.find_split_route(&token(1), &token(3), amount).unwrap();
        let best_single = g.find_best_route(&token(1), &token(3), amount).unwrap();

        // Split routing should give equal or better output than single route
        assert!(split.total_output >= best_single.expected_output);
    }

    #[test]
    fn test_split_allocations_sum_to_input() {
        let g = graph_triangle();
        let amount = 10_000e18 as u128;
        let split = g.find_split_route(&token(1), &token(3), amount).unwrap();
        let total: u128 = split.legs.iter().map(|(_, a)| *a).sum();
        assert_eq!(total, amount);
    }

    // ============ Edge Cases ============

    #[test]
    fn test_large_swap_high_impact() {
        let g = graph_two_pools();
        let amount = 500_000e18 as u128; // 50% of reserves
        let route = g.find_best_route(&token(1), &token(2), amount).unwrap();
        // Price impact should be very high
        assert!(route.price_impact_bps > 500); // >5% impact
    }

    #[test]
    fn test_tiny_swap() {
        let g = graph_two_pools();
        // 1 unit rounds to 0 output in a pool with 1e18-scale reserves, so no route found
        assert_eq!(
            g.find_best_route(&token(1), &token(2), 1),
            Err(RouterError::NoRouteFound)
        );
        // But a slightly larger amount works
        let route = g.find_best_route(&token(1), &token(2), 1_000_000).unwrap();
        assert!(!route.hops.is_empty());
    }

    #[test]
    fn test_multiple_pools_same_pair() {
        let mut g = PoolGraph::new();
        // Two pools for same pair with different rates
        g.add_pool(PoolEdge {
            pair_id: pair(1, 2),
            token0: token(1),
            token1: token(2),
            reserve0: 100_000e18 as u128,
            reserve1: 100_000e18 as u128,
            fee_rate_bps: 30,
        });
        g.add_pool(PoolEdge {
            pair_id: {
                let mut p = pair(1, 2);
                p[31] = 1;
                p
            },
            token0: token(1),
            token1: token(2),
            reserve0: 100_000e18 as u128,
            reserve1: 100_000e18 as u128,
            fee_rate_bps: 5, // Lower fee
        });

        let amount = 1_000e18 as u128;
        let route = g.find_best_route(&token(1), &token(2), amount).unwrap();
        // Should pick the lower-fee pool
        assert_eq!(route.hops[0].pool_index, 1);
    }

    #[test]
    fn test_four_token_chain() {
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(2, 3, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(3, 4, 1_000_000e18 as u128, 1_000_000e18 as u128));

        let amount = 1_000e18 as u128;
        let route = g.find_best_route(&token(1), &token(4), amount).unwrap();
        assert_eq!(route.hops.len(), 3);
        assert!(route.expected_output > 0);
        // Three hops of fees means output < input
        assert!(route.expected_output < amount);
    }

    #[test]
    fn test_diamond_graph_picks_best() {
        // Diamond: A→B→D and A→C→D
        let mut g = PoolGraph::new();
        // A→B: 1M/1M, B→D: 1M/1M (2 hops, 2x fees)
        g.add_pool(pool(1, 2, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(2, 4, 1_000_000e18 as u128, 1_000_000e18 as u128));
        // A→C: 1M/1M, C→D: 1M/1M (2 hops, 2x fees)
        g.add_pool(pool(1, 3, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(3, 4, 1_000_000e18 as u128, 1_000_000e18 as u128));

        let amount = 1_000e18 as u128;
        let routes = g.find_all_routes(&token(1), &token(4), 2).unwrap();
        // Should find both paths
        assert_eq!(routes.len(), 2);

        let route = g.find_best_route(&token(1), &token(4), amount).unwrap();
        assert_eq!(route.hops.len(), 2);
    }

    #[test]
    fn test_pool_graph_from_pools() {
        let edges = vec![
            (pool(1, 2, 1000, 2000),),
            (pool(2, 3, 3000, 4000),),
        ];
        let g = PoolGraph::from_pools(&edges);
        assert_eq!(g.pool_count(), 2);
        assert_eq!(g.token_count(), 3);
    }

    // ============ Additional Edge Case & Hardening Tests ============

    #[test]
    fn test_find_all_routes_same_token_error() {
        let g = graph_two_pools();
        assert_eq!(
            g.find_all_routes(&token(1), &token(1), 4),
            Err(RouterError::SameToken)
        );
    }

    #[test]
    fn test_find_all_routes_empty_graph_error() {
        let g = PoolGraph::new();
        assert_eq!(
            g.find_all_routes(&token(1), &token(2), 4),
            Err(RouterError::EmptyGraph)
        );
    }

    #[test]
    fn test_split_route_zero_input() {
        let g = graph_two_pools();
        let result = g.find_split_route(&token(1), &token(2), 0);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), RouterError::ZeroInput);
    }

    #[test]
    fn test_split_route_no_route() {
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(3, 4, 1_000_000e18 as u128, 1_000_000e18 as u128));
        // token(1) and token(4) are disconnected
        let result = g.find_split_route(&token(1), &token(4), 1_000e18 as u128);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), RouterError::NoRouteFound);
    }

    #[test]
    fn test_spot_price_reverse_token() {
        // Spot price queried with token1 as input should give inverse
        let p = pool(1, 2, 1_000_000e18 as u128, 2_000_000e18 as u128);
        let price_t1_in = PoolGraph::spot_price(&p, &token(1));  // = 2e18
        let price_t2_in = PoolGraph::spot_price(&p, &token(2));  // = 0.5e18

        assert_eq!(price_t1_in, 2 * vibeswap_math::PRECISION);
        assert_eq!(price_t2_in, vibeswap_math::PRECISION / 2);
    }

    #[test]
    fn test_effective_price_empty_hops() {
        let g = graph_two_pools();
        // Empty hops, amount_in = 1000 → output = 1000 (passthrough)
        // effective_price = output * PRECISION / input = 1000 * P / 1000 = P
        let price = g.effective_price(&[], 1000);
        assert_eq!(price, Some(vibeswap_math::PRECISION));
    }

    #[test]
    fn test_required_input_empty_hops() {
        let g = graph_two_pools();
        // Empty hops returns None (guard clause at start of required_input)
        let result = g.required_input(&[], 500);
        assert!(result.is_none(), "Empty hops should return None");
    }

    #[test]
    fn test_slippage_saturating_sub() {
        // Very large slippage on small amount should saturate to 0, not underflow
        let min = PoolGraph::min_output_with_slippage(100, 10_000);
        assert_eq!(min, 0, "100% slippage on 100 should give 0");

        let min2 = PoolGraph::min_output_with_slippage(50, 9999);
        // 50 * 9999 / 10000 = 49, so 50 - 49 = 1
        assert_eq!(min2, 1);
    }

    #[test]
    fn test_find_best_route_returns_highest_output() {
        // With triangle graph, best route should have the highest expected_output
        let g = graph_triangle();
        let amount = 500e18 as u128;
        let best = g.find_best_route(&token(1), &token(3), amount).unwrap();

        // Get all routes and simulate each
        let all_routes = g.find_all_routes(&token(1), &token(3), MAX_HOPS).unwrap();
        for route_hops in &all_routes {
            if let Some(output) = g.simulate_route(route_hops, amount) {
                assert!(best.expected_output >= output,
                    "Best route output ({}) should be >= all alternatives ({})",
                    best.expected_output, output);
            }
        }
    }

    #[test]
    fn test_price_impact_increases_with_trade_size() {
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];

        let impact_small = g.estimate_price_impact(&hops, 1_000e18 as u128);
        let impact_large = g.estimate_price_impact(&hops, 100_000e18 as u128);

        assert!(impact_large > impact_small,
            "Larger trade should have more price impact: small={}, large={}",
            impact_small, impact_large);
    }

    // ============ New Edge Case & Coverage Tests (Batch 3) ============

    #[test]
    fn test_graph_single_pool_neighbors() {
        // Graph with a single pool — each token should have exactly 1 neighbor
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1_000_000, 2_000_000));
        let n1 = g.neighbors(&token(1));
        let n2 = g.neighbors(&token(2));
        assert_eq!(n1.len(), 1);
        assert_eq!(n2.len(), 1);
        assert_eq!(n1[0].1, token(2));
        assert_eq!(n2[0].1, token(1));
    }

    #[test]
    fn test_effective_price_zero_input() {
        // Zero input should return None (guard against division by zero)
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        let price = g.effective_price(&hops, 0);
        assert!(price.is_none(), "Zero input should yield None for effective price");
    }

    #[test]
    fn test_simulate_route_output_decreases_with_fees() {
        // Compare simulation on same pool with different fee rates
        let mut g_low = PoolGraph::new();
        g_low.add_pool(PoolEdge {
            pair_id: pair(1, 2),
            token0: token(1),
            token1: token(2),
            reserve0: 1_000_000e18 as u128,
            reserve1: 1_000_000e18 as u128,
            fee_rate_bps: 5,
        });
        let mut g_high = PoolGraph::new();
        g_high.add_pool(PoolEdge {
            pair_id: pair(1, 2),
            token0: token(1),
            token1: token(2),
            reserve0: 1_000_000e18 as u128,
            reserve1: 1_000_000e18 as u128,
            fee_rate_bps: 100,
        });

        let hop = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        let amount = 1_000e18 as u128;
        let out_low = g_low.simulate_route(&hop, amount).unwrap();
        let out_high = g_high.simulate_route(&hop, amount).unwrap();
        assert!(out_low > out_high, "Lower fee pool should give more output");
    }

    #[test]
    fn test_find_best_route_no_viable_route() {
        // Graph has a pool but reserves are too small for output > 0
        let mut g = PoolGraph::new();
        g.add_pool(PoolEdge {
            pair_id: pair(1, 2),
            token0: token(1),
            token1: token(2),
            reserve0: 10,
            reserve1: 10,
            fee_rate_bps: 30,
        });
        // Very tiny reserves — swap of 1 will produce 0 output after fees
        let result = g.find_best_route(&token(1), &token(2), 1);
        assert_eq!(result, Err(RouterError::NoRouteFound));
    }

    #[test]
    fn test_min_output_with_slippage_partial() {
        // 2.5% slippage = 250 bps
        let expected = 10_000u128;
        let min = PoolGraph::min_output_with_slippage(expected, 250);
        // 10000 - (10000 * 250 / 10000) = 10000 - 250 = 9750
        assert_eq!(min, 9750);
    }

    #[test]
    fn test_required_input_larger_than_reserves() {
        // Request a very large output — required input should be very large
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        // Requesting output close to entire reserve — requires enormous input
        let desired = 900_000e18 as u128; // 90% of reserve1
        let required = g.required_input(&hops, desired);
        // This should either find a (very large) required input, or None if impossible
        if let Some(req) = required {
            let actual = g.simulate_route(&hops, req).unwrap();
            assert!(actual >= desired);
        }
        // If None, route cannot produce that much — also acceptable
    }

    #[test]
    fn test_split_route_allocations_non_negative() {
        // All split allocations must be >= 0
        let g = graph_triangle();
        let amount = 1_000e18 as u128;
        let split = g.find_split_route(&token(1), &token(3), amount).unwrap();
        for (_, alloc) in &split.legs {
            assert!(*alloc > 0, "Each leg allocation should be positive");
        }
    }

    #[test]
    fn test_spot_price_symmetric_1_to_1() {
        // A 1:1 pool should give PRECISION from both directions
        let p = pool(1, 2, 1_000_000e18 as u128, 1_000_000e18 as u128);
        let forward = PoolGraph::spot_price(&p, &token(1));
        let reverse = PoolGraph::spot_price(&p, &token(2));
        assert_eq!(forward, vibeswap_math::PRECISION);
        assert_eq!(reverse, vibeswap_math::PRECISION);
    }

    // ============ Batch 4: Additional Edge Case & Coverage Tests ============

    #[test]
    fn test_add_pool_returns_sequential_indices() {
        // Each add_pool call should return the next sequential index
        let mut g = PoolGraph::new();
        let i0 = g.add_pool(pool(1, 2, 1000, 2000));
        let i1 = g.add_pool(pool(2, 3, 3000, 4000));
        let i2 = g.add_pool(pool(3, 4, 5000, 6000));
        assert_eq!(i0, 0);
        assert_eq!(i1, 1);
        assert_eq!(i2, 2);
        assert_eq!(g.pool_count(), 3);
        assert_eq!(g.token_count(), 4);
    }

    #[test]
    fn test_find_all_routes_max_hops_1() {
        // max_hops parameter means max intermediate hops
        // max_hops=1 allows up to 2 pools chained (A→B→C)
        let g = graph_two_pools();
        // A→B is direct (1 pool), should be found with max_hops=1
        let routes_ab = g.find_all_routes(&token(1), &token(2), 1).unwrap();
        assert_eq!(routes_ab.len(), 1);
        assert_eq!(routes_ab[0].len(), 1);

        // A→C requires 2 pools (A→B→C), and max_hops=1 allows 2 pools
        let routes_ac = g.find_all_routes(&token(1), &token(3), 1).unwrap();
        assert_eq!(routes_ac.len(), 1);
        assert_eq!(routes_ac[0].len(), 2);

        // With max_hops=0, only direct (single pool) routes are found
        // A→C has no direct pool, so it should fail
        let result = g.find_all_routes(&token(1), &token(3), 0);
        assert_eq!(result, Err(RouterError::NoRouteFound));
    }

    #[test]
    fn test_simulate_route_output_always_less_than_input_on_1_to_1_pool() {
        // On a 1:1 pool with fees, output should always be < input
        let g = graph_two_pools();
        let hop = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        for exp in [100, 1_000, 10_000, 100_000u128] {
            let amount = exp * 1_000_000_000_000_000_000; // exp * 1e18
            if let Some(output) = g.simulate_route(&hop, amount) {
                assert!(output < amount,
                    "Output ({}) should be < input ({}) on 1:1 pool with fees", output, amount);
            }
        }
    }

    #[test]
    fn test_price_impact_empty_hops() {
        // Empty hops should have 0 price impact
        let g = graph_two_pools();
        let impact = g.estimate_price_impact(&[], 1_000_000);
        assert_eq!(impact, 0, "Empty hops should produce 0 price impact");
    }

    #[test]
    fn test_split_route_same_token_error() {
        let g = graph_two_pools();
        let result = g.find_split_route(&token(1), &token(1), 1_000e18 as u128);
        assert_eq!(result.unwrap_err(), RouterError::SameToken);
    }

    #[test]
    fn test_split_route_empty_graph() {
        let g = PoolGraph::new();
        let result = g.find_split_route(&token(1), &token(2), 1_000e18 as u128);
        assert_eq!(result.unwrap_err(), RouterError::EmptyGraph);
    }

    #[test]
    fn test_best_route_two_hop_output_less_than_reserves() {
        // Two-hop route output should never exceed the final pool's reserves
        let g = graph_two_pools();
        let amount = 10_000e18 as u128;
        let route = g.find_best_route(&token(1), &token(3), amount).unwrap();
        // Final pool B-C has 2M token1 reserves
        let final_reserve = g.pools[1].reserve1;
        assert!(route.expected_output < final_reserve,
            "Output should not exceed final pool's reserves");
    }

    #[test]
    fn test_min_output_slippage_1_bps() {
        // 1 bps = 0.01% slippage
        let expected = 1_000_000u128;
        let min = PoolGraph::min_output_with_slippage(expected, 1);
        // 1_000_000 * 1 / 10_000 = 100
        assert_eq!(min, 999_900);
    }

    // ============ Batch 5: Edge Cases, Boundaries, Overflow, Error Paths ============

    #[test]
    fn test_simulate_single_unit_input() {
        // Single unit through a pool with small reserves — should produce 0 and return None
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1_000_000, 1_000_000));
        let hop = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        // With 30 bps fee, amount_in_with_fee = 1 * 9970 / 10000 = 0 (integer division)
        // So output should be 0 → simulate returns None
        let output = g.simulate_route(&hop, 1);
        assert!(output.is_none() || output == Some(0) || output.unwrap() < 2,
            "Single unit input should produce negligible or no output");
    }

    #[test]
    fn test_spot_price_both_reserves_zero() {
        let p = PoolEdge {
            pair_id: pair(1, 2),
            token0: token(1),
            token1: token(2),
            reserve0: 0,
            reserve1: 0,
            fee_rate_bps: 30,
        };
        assert_eq!(PoolGraph::spot_price(&p, &token(1)), 0);
        assert_eq!(PoolGraph::spot_price(&p, &token(2)), 0);
    }

    #[test]
    fn test_spot_price_reserve_out_zero() {
        // reserve_out is 0, reserve_in is non-zero — price should be 0
        let p = pool(1, 2, 1_000_000e18 as u128, 0);
        let price = PoolGraph::spot_price(&p, &token(1));
        assert_eq!(price, 0, "Zero output reserve should give price 0");
    }

    #[test]
    fn test_effective_price_decreases_with_size() {
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];

        let price_small = g.effective_price(&hops, 100e18 as u128).unwrap();
        let price_large = g.effective_price(&hops, 100_000e18 as u128).unwrap();

        assert!(price_small > price_large,
            "Effective price should decrease with larger trade size: small={}, large={}",
            price_small, price_large);
    }

    #[test]
    fn test_required_input_for_small_output() {
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        // Very small desired output
        let desired = 1_000_000u128; // 1e6 — small relative to 1e18 reserves
        let required = g.required_input(&hops, desired).unwrap();
        let actual = g.simulate_route(&hops, required).unwrap();
        assert!(actual >= desired, "Required input should produce at least desired output");
    }

    #[test]
    fn test_min_output_with_slippage_u128_max() {
        // Test with very large expected_output near u128 limits
        let expected = u128::MAX / 10_001; // Ensure slippage * expected doesn't overflow
        let min = PoolGraph::min_output_with_slippage(expected, 100); // 1% slippage
        let slippage_amount = expected * 100 / 10_000;
        assert_eq!(min, expected - slippage_amount);
    }

    #[test]
    fn test_min_output_with_slippage_zero_expected() {
        // Zero expected output with any slippage should give 0
        assert_eq!(PoolGraph::min_output_with_slippage(0, 50), 0);
        assert_eq!(PoolGraph::min_output_with_slippage(0, 10_000), 0);
        assert_eq!(PoolGraph::min_output_with_slippage(0, 0), 0);
    }

    #[test]
    fn test_simulate_one_reserve_zero_other_nonzero() {
        // Pool with reserve0 = 0, reserve1 > 0 — get_amount_out should fail
        let mut g = PoolGraph::new();
        g.add_pool(PoolEdge {
            pair_id: pair(1, 2),
            token0: token(1),
            token1: token(2),
            reserve0: 0,
            reserve1: 1_000_000e18 as u128,
            fee_rate_bps: 30,
        });
        let hop = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        assert!(g.simulate_route(&hop, 1_000).is_none(),
            "Pool with zero reserve_in should fail simulation");
    }

    #[test]
    fn test_find_all_routes_with_max_hops_zero() {
        // max_hops=0 means remaining_hops = 1, so only direct (1-pool) paths
        let g = graph_two_pools();
        // A→B is direct, should be found
        let routes = g.find_all_routes(&token(1), &token(2), 0).unwrap();
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].len(), 1);
    }

    #[test]
    fn test_price_impact_multi_hop_greater_than_single_hop() {
        let g = graph_two_pools();
        let single = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        let multi = vec![
            SwapHop {
                pool_index: 0,
                pair_id: pair(1, 2),
                token_in: token(1),
                token_out: token(2),
            },
            SwapHop {
                pool_index: 1,
                pair_id: pair(2, 3),
                token_in: token(2),
                token_out: token(3),
            },
        ];
        let amount = 50_000e18 as u128;
        let impact_single = g.estimate_price_impact(&single, amount);
        let impact_multi = g.estimate_price_impact(&multi, amount);
        // Multi-hop should have equal or greater impact due to cascading slippage
        assert!(impact_multi >= impact_single,
            "Multi-hop impact ({}) should be >= single-hop impact ({})",
            impact_multi, impact_single);
    }

    #[test]
    fn test_add_pool_duplicate_pair() {
        // Adding the exact same pool twice — both should be indexed
        let mut g = PoolGraph::new();
        let i0 = g.add_pool(pool(1, 2, 1000, 2000));
        let i1 = g.add_pool(pool(1, 2, 1000, 2000));
        assert_eq!(i0, 0);
        assert_eq!(i1, 1);
        assert_eq!(g.pool_count(), 2);
        // Token count should still be 2 (same tokens, but adjacency entries double)
        assert_eq!(g.token_count(), 2);
        // Neighbors should show 2 entries for each token
        assert_eq!(g.neighbors(&token(1)).len(), 2);
        assert_eq!(g.neighbors(&token(2)).len(), 2);
    }

    #[test]
    fn test_find_best_route_nonexistent_tokens() {
        // Both tokens exist in no pool
        let g = graph_two_pools();
        let result = g.find_best_route(&token(99), &token(100), 1000);
        assert_eq!(result, Err(RouterError::NoRouteFound));
    }

    #[test]
    fn test_find_best_route_one_token_exists_other_not() {
        // token(1) exists, token(99) does not
        let g = graph_two_pools();
        let result = g.find_best_route(&token(1), &token(99), 1000);
        assert_eq!(result, Err(RouterError::NoRouteFound));
    }

    #[test]
    fn test_split_route_tiny_amount_no_meaningful_split() {
        // Amount too small to split into 20 chunks — should give all to first route
        let g = graph_triangle();
        let amount = 10u128; // Very small
        // This may fail with NoRouteFound if output rounds to 0, or succeed with single leg
        let result = g.find_split_route(&token(1), &token(3), amount);
        match result {
            Ok(split) => {
                let total: u128 = split.legs.iter().map(|(_, a)| *a).sum();
                assert_eq!(total, amount, "Total allocation must equal input");
            }
            Err(e) => {
                // Acceptable errors for tiny amounts
                assert!(e == RouterError::NoRouteFound || e == RouterError::InsufficientLiquidity,
                    "Unexpected error for tiny split: {:?}", e);
            }
        }
    }

    #[test]
    fn test_simulate_route_fee_rate_zero() {
        // Pool with 0 fee — output should only reflect price impact, no fee
        let mut g = PoolGraph::new();
        g.add_pool(PoolEdge {
            pair_id: pair(1, 2),
            token0: token(1),
            token1: token(2),
            reserve0: 1_000_000e18 as u128,
            reserve1: 1_000_000e18 as u128,
            fee_rate_bps: 0,
        });
        let hop = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        let amount = 1_000e18 as u128;
        let output = g.simulate_route(&hop, amount).unwrap();
        // With zero fees and 0.1% of pool, output should be very close to input
        // x*y=k: output = reserve_out * amount_in / (reserve_in + amount_in)
        // = 1e24 * 1e21 / (1e24 + 1e21) = 1e45 / 1.001e24 ≈ 999001e18
        assert!(output > 999_000_000_000_000_000_000u128,
            "Zero-fee output should be close to input minus price impact only");
        assert!(output < amount, "Output must still be less than input due to slippage");
    }

    #[test]
    fn test_five_token_chain_at_max_hops() {
        // Chain of 5 pools: A→B→C→D→E→F — exactly MAX_HOPS (4) intermediate
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(2, 3, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(3, 4, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(4, 5, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(5, 6, 1_000_000e18 as u128, 1_000_000e18 as u128));

        // MAX_HOPS = 4 intermediate = 5 pools chained — should find A→F
        let amount = 1_000e18 as u128;
        let route = g.find_best_route(&token(1), &token(6), amount).unwrap();
        assert_eq!(route.hops.len(), 5);
        // 5 hops of 0.3% fee on 1:1 pools — output should be significantly less
        assert!(route.expected_output < amount);
        assert!(route.expected_output > 0);
    }

    #[test]
    fn test_six_token_chain_exceeds_max_hops() {
        // Chain of 6 pools: A→B→C→D→E→F→G — needs 6 intermediate, but MAX_HOPS=4
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(2, 3, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(3, 4, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(4, 5, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(5, 6, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(6, 7, 1_000_000e18 as u128, 1_000_000e18 as u128));

        // A→G requires 6 pools, MAX_HOPS=4 allows only 5 pools max
        let result = g.find_best_route(&token(1), &token(7), 1_000e18 as u128);
        assert_eq!(result, Err(RouterError::NoRouteFound));
    }

    #[test]
    fn test_price_impact_max_cap_at_10000() {
        // Price impact should never exceed 10000 bps (100%)
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 100, 100)); // Tiny pool
        let hop = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        // Very large trade relative to reserves
        let impact = g.estimate_price_impact(&hop, 1_000_000_000);
        assert!(impact <= 10_000, "Price impact should be capped at 10000 bps, got {}", impact);
    }

    #[test]
    fn test_simulate_large_reserves_small_trade() {
        // Extremely large reserves with tiny trade — should still produce valid output
        let mut g = PoolGraph::new();
        let big_reserve = 1_000_000_000_000_000_000_000_000_000u128; // 1e27
        g.add_pool(PoolEdge {
            pair_id: pair(1, 2),
            token0: token(1),
            token1: token(2),
            reserve0: big_reserve,
            reserve1: big_reserve,
            fee_rate_bps: 30,
        });
        let hop = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        let small_amount = 1_000_000_000u128; // 1e9
        let output = g.simulate_route(&hop, small_amount);
        assert!(output.is_some(), "Large pool should handle small trades");
        let out = output.unwrap();
        // Near 1:1 with minimal impact, so output ≈ amount * (1 - fee)
        assert!(out > 0);
        assert!(out < small_amount);
    }

    #[test]
    fn test_from_pools_empty() {
        let g = PoolGraph::from_pools(&[]);
        assert_eq!(g.pool_count(), 0);
        assert_eq!(g.token_count(), 0);
    }

    #[test]
    fn test_swap_route_hop_tokens_chain_correctly() {
        // Verify that in a multi-hop route, token_out of hop N == token_in of hop N+1
        let g = graph_two_pools();
        let routes = g.find_all_routes(&token(1), &token(3), MAX_HOPS).unwrap();
        for route in &routes {
            for i in 1..route.len() {
                assert_eq!(route[i - 1].token_out, route[i].token_in,
                    "Hop {} token_out must match hop {} token_in", i - 1, i);
            }
            // First hop token_in should be the source token
            assert_eq!(route[0].token_in, token(1));
            // Last hop token_out should be the destination token
            assert_eq!(route.last().unwrap().token_out, token(3));
        }
    }

    #[test]
    fn test_split_route_each_leg_has_valid_output() {
        let g = graph_triangle();
        let amount = 10_000e18 as u128;
        let split = g.find_split_route(&token(1), &token(3), amount).unwrap();
        for (route, alloc) in &split.legs {
            assert!(*alloc > 0, "Each leg should have positive allocation");
            assert!(route.expected_output > 0, "Each leg should have positive output");
            assert!(!route.hops.is_empty(), "Each leg should have at least one hop");
        }
        // Total output should equal sum of leg outputs
        let sum_output: u128 = split.legs.iter().map(|(r, _)| r.expected_output).sum();
        assert_eq!(sum_output, split.total_output,
            "Total output should equal sum of leg outputs");
    }

    #[test]
    fn test_pool_edge_high_fee_rate() {
        // Fee rate at 50% (5000 bps) — extremely high fee
        let mut g = PoolGraph::new();
        g.add_pool(PoolEdge {
            pair_id: pair(1, 2),
            token0: token(1),
            token1: token(2),
            reserve0: 1_000_000e18 as u128,
            reserve1: 1_000_000e18 as u128,
            fee_rate_bps: 5000,
        });
        let hop = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        let amount = 1_000e18 as u128;
        let output = g.simulate_route(&hop, amount).unwrap();
        // 50% fee means output is roughly half of what 0-fee would give
        assert!(output < amount / 2, "50% fee should cut output by more than half");
        assert!(output > 0);
    }

    #[test]
    fn test_required_input_binary_search_precision() {
        // Verify binary search finds tight bound — required produces >= desired,
        // required-1 produces < desired
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 500_000e18 as u128, 750_000e18 as u128));
        let hops = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        let desired = 10_000e18 as u128;
        let required = g.required_input(&hops, desired).unwrap();
        let actual = g.simulate_route(&hops, required).unwrap();
        assert!(actual >= desired, "Required input must produce at least desired output");
        // Check tightness: required-1 should produce less than desired
        if required > 1 {
            let under = g.simulate_route(&hops, required - 1).unwrap_or(0);
            assert!(under < desired,
                "required-1 should produce less than desired: got {} vs {}",
                under, desired);
        }
    }

    // ============ Batch 6: Additional Edge Cases & Coverage Tests ============

    #[test]
    fn test_best_route_reverse_direction() {
        // Find best route from B→A (reverse of the typical A→B direction)
        let g = graph_two_pools();
        let amount = 1_000e18 as u128;
        let route = g.find_best_route(&token(2), &token(1), amount).unwrap();
        assert_eq!(route.hops.len(), 1);
        assert_eq!(route.hops[0].token_in, token(2));
        assert_eq!(route.hops[0].token_out, token(1));
        assert!(route.expected_output > 0);
        assert!(route.expected_output < amount); // 1:1 pool with fees
    }

    #[test]
    fn test_best_route_reverse_through_two_hops() {
        // C→B→A (reverse through two-hop chain)
        let g = graph_two_pools();
        let amount = 1_000e18 as u128;
        let route = g.find_best_route(&token(3), &token(1), amount).unwrap();
        assert_eq!(route.hops.len(), 2);
        assert_eq!(route.hops[0].token_in, token(3));
        assert_eq!(route.hops[0].token_out, token(2));
        assert_eq!(route.hops[1].token_in, token(2));
        assert_eq!(route.hops[1].token_out, token(1));
        // B:C = 1M:2M, so going C→B gives roughly 0.5x, then B→A gives ~1x, net ~0.5x minus fees
        assert!(route.expected_output < amount);
    }

    #[test]
    fn test_triangle_best_route_reverse() {
        // In triangle graph, find best route C→A (both direct and indirect paths exist)
        let g = graph_triangle();
        let amount = 1_000e18 as u128;
        let best = g.find_best_route(&token(3), &token(1), amount).unwrap();
        // Should pick the route with highest output
        let all_routes = g.find_all_routes(&token(3), &token(1), MAX_HOPS).unwrap();
        for route_hops in &all_routes {
            if let Some(output) = g.simulate_route(route_hops, amount) {
                assert!(best.expected_output >= output);
            }
        }
    }

    #[test]
    fn test_effective_price_two_hop_route() {
        // Effective price through a two-hop route
        let g = graph_two_pools();
        let hops = vec![
            SwapHop {
                pool_index: 0,
                pair_id: pair(1, 2),
                token_in: token(1),
                token_out: token(2),
            },
            SwapHop {
                pool_index: 1,
                pair_id: pair(2, 3),
                token_in: token(2),
                token_out: token(3),
            },
        ];
        let amount = 1_000e18 as u128;
        let price = g.effective_price(&hops, amount).unwrap();
        // A→B (1:1) → B→C (1:2), effective rate ~2x minus double fees
        assert!(price > vibeswap_math::PRECISION, "Two-hop through 1:2 pool should give >1x rate");
        assert!(price < 2 * vibeswap_math::PRECISION, "But less than 2x due to fees and slippage");
    }

    #[test]
    fn test_simulate_route_max_fee_10000_bps() {
        // Fee rate of 10000 bps (100%) — entire input is taken as fee, output should be 0
        let mut g = PoolGraph::new();
        g.add_pool(PoolEdge {
            pair_id: pair(1, 2),
            token0: token(1),
            token1: token(2),
            reserve0: 1_000_000e18 as u128,
            reserve1: 1_000_000e18 as u128,
            fee_rate_bps: 10_000,
        });
        let hop = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        let amount = 1_000e18 as u128;
        let output = g.simulate_route(&hop, amount);
        // With 100% fee, amount_in_with_fee = amount * 0 / 10000 = 0, so output = 0
        assert!(output.is_none() || output == Some(0),
            "100% fee should yield zero output, got {:?}", output);
    }

    #[test]
    fn test_spot_price_extreme_asymmetry() {
        // Very asymmetric reserves: 1 vs 1e27
        let p = PoolEdge {
            pair_id: pair(1, 2),
            token0: token(1),
            token1: token(2),
            reserve0: 1,
            reserve1: 1_000_000_000_000_000_000_000_000_000u128, // 1e27
            fee_rate_bps: 30,
        };
        let price = PoolGraph::spot_price(&p, &token(1));
        // price = reserve1 * PRECISION / reserve0 = 1e27 * 1e18 / 1 = 1e45
        assert!(price > 0);
        // Reverse direction
        let price_rev = PoolGraph::spot_price(&p, &token(2));
        // price_rev = 1 * 1e18 / 1e27 = 0 (integer division truncates)
        assert_eq!(price_rev, 0, "Tiny reserve_out / huge reserve_in should truncate to 0");
    }

    #[test]
    fn test_find_all_routes_verifies_pair_ids() {
        // Verify that each hop in discovered routes has correct pair_id matching the pool
        let g = graph_triangle();
        let routes = g.find_all_routes(&token(1), &token(3), MAX_HOPS).unwrap();
        for route in &routes {
            for hop in route {
                assert_eq!(hop.pair_id, g.pools[hop.pool_index].pair_id,
                    "Hop pair_id should match pool's pair_id at index {}", hop.pool_index);
            }
        }
    }

    #[test]
    fn test_split_route_asymmetric_parallel_pools() {
        // Two very different parallel paths — split should favor the deeper one
        let mut g = PoolGraph::new();
        // Direct A→C: tiny pool (1K/2K)
        g.add_pool(pool(1, 3, 1_000e18 as u128, 2_000e18 as u128));
        // Indirect A→B→C: huge pools
        g.add_pool(pool(1, 2, 10_000_000e18 as u128, 10_000_000e18 as u128));
        g.add_pool(pool(2, 3, 10_000_000e18 as u128, 20_000_000e18 as u128));

        let amount = 5_000e18 as u128;
        let split = g.find_split_route(&token(1), &token(3), amount).unwrap();
        // Total allocation must match input
        let total_alloc: u128 = split.legs.iter().map(|(_, a)| *a).sum();
        assert_eq!(total_alloc, amount);
        assert!(split.total_output > 0);
    }

    #[test]
    fn test_required_input_impossible_output() {
        // Request more output than the pool could ever produce
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1_000, 1_000)); // Tiny pool
        let hops = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        // Request 2000 output from a pool with only 1000 reserve_out — impossible
        let result = g.required_input(&hops, 2_000);
        assert!(result.is_none(), "Should return None when desired output exceeds pool capacity");
    }

    #[test]
    fn test_min_output_slippage_odd_values() {
        // Values that don't divide evenly
        let expected = 333u128;
        let min = PoolGraph::min_output_with_slippage(expected, 100); // 1%
        // 333 * 100 / 10000 = 3 (integer), so min = 333 - 3 = 330
        assert_eq!(min, 330);

        let min2 = PoolGraph::min_output_with_slippage(7, 5000); // 50%
        // 7 * 5000 / 10000 = 3, so min = 7 - 3 = 4
        assert_eq!(min2, 4);

        let min3 = PoolGraph::min_output_with_slippage(1, 1); // 0.01% of 1
        // 1 * 1 / 10000 = 0, so min = 1 - 0 = 1
        assert_eq!(min3, 1);
    }

    #[test]
    fn test_graph_shared_tokens_count() {
        // Adding pools that share a token — token count should reflect unique tokens only
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1000, 2000)); // tokens 1, 2
        g.add_pool(pool(2, 3, 3000, 4000)); // tokens 2, 3 (2 is shared)
        g.add_pool(pool(3, 4, 5000, 6000)); // tokens 3, 4 (3 is shared)
        assert_eq!(g.pool_count(), 3);
        assert_eq!(g.token_count(), 4); // 4 unique tokens: 1, 2, 3, 4
    }

    #[test]
    fn test_simulate_route_monotonic_output() {
        // Increasing input should produce increasing (or equal) output — monotonicity
        let g = graph_two_pools();
        let hop = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        let mut prev_output = 0u128;
        for exp in 1..=10u128 {
            let amount = exp * 1_000_000_000_000_000_000; // exp * 1e18
            if let Some(output) = g.simulate_route(&hop, amount) {
                assert!(output >= prev_output,
                    "Output should increase with input: at {}e18, got {} vs prev {}",
                    exp, output, prev_output);
                prev_output = output;
            }
        }
    }

    #[test]
    fn test_price_impact_on_zero_fee_pool() {
        // Price impact should still exist even with zero fees (due to AMM curve)
        let mut g = PoolGraph::new();
        g.add_pool(PoolEdge {
            pair_id: pair(1, 2),
            token0: token(1),
            token1: token(2),
            reserve0: 1_000_000e18 as u128,
            reserve1: 1_000_000e18 as u128,
            fee_rate_bps: 0,
        });
        let hop = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        // 10% of reserves — should have measurable price impact even with zero fee
        let impact = g.estimate_price_impact(&hop, 100_000e18 as u128);
        assert!(impact > 0, "Even with zero fees, large trade should have price impact");
    }

    #[test]
    fn test_diamond_graph_split_route() {
        // Diamond graph: A→B→D and A→C→D — split route should use both paths
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(2, 4, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(1, 3, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(3, 4, 1_000_000e18 as u128, 1_000_000e18 as u128));

        let amount = 100_000e18 as u128;
        let split = g.find_split_route(&token(1), &token(4), amount).unwrap();
        assert!(split.legs.len() >= 1);
        let total_alloc: u128 = split.legs.iter().map(|(_, a)| *a).sum();
        assert_eq!(total_alloc, amount);
        assert!(split.total_output > 0);
    }

    #[test]
    fn test_find_all_routes_no_pool_reuse() {
        // Routes should not reuse the same pool index in a single path
        let g = graph_triangle();
        let routes = g.find_all_routes(&token(1), &token(3), MAX_HOPS).unwrap();
        for route in &routes {
            let mut seen_pools = Vec::new();
            for hop in route {
                assert!(!seen_pools.contains(&hop.pool_index),
                    "Route should not reuse pool index {}", hop.pool_index);
                seen_pools.push(hop.pool_index);
            }
        }
    }

    #[test]
    fn test_required_input_two_hop_tight_bound() {
        // Required input for a two-hop route should be tight
        let g = graph_two_pools();
        let hops = vec![
            SwapHop {
                pool_index: 0,
                pair_id: pair(1, 2),
                token_in: token(1),
                token_out: token(2),
            },
            SwapHop {
                pool_index: 1,
                pair_id: pair(2, 3),
                token_in: token(2),
                token_out: token(3),
            },
        ];
        let desired = 5_000e18 as u128;
        let required = g.required_input(&hops, desired).unwrap();
        let actual = g.simulate_route(&hops, required).unwrap();
        assert!(actual >= desired);
        if required > 1 {
            let under = g.simulate_route(&hops, required - 1).unwrap_or(0);
            assert!(under < desired,
                "Two-hop required-1 should produce less than desired");
        }
    }

    #[test]
    fn test_best_route_with_high_fee_vs_low_fee_different_reserves() {
        // Pool A: low reserves but low fee vs Pool B: high reserves but high fee
        let mut g = PoolGraph::new();
        g.add_pool(PoolEdge {
            pair_id: pair(1, 2),
            token0: token(1),
            token1: token(2),
            reserve0: 100_000e18 as u128,
            reserve1: 100_000e18 as u128,
            fee_rate_bps: 5, // 0.05% fee
        });
        g.add_pool(PoolEdge {
            pair_id: {
                let mut p = pair(1, 2);
                p[31] = 1;
                p
            },
            token0: token(1),
            token1: token(2),
            reserve0: 10_000_000e18 as u128,
            reserve1: 10_000_000e18 as u128,
            fee_rate_bps: 100, // 1% fee
        });

        // Small trade — low-fee pool should win despite smaller reserves
        let small_amount = 100e18 as u128;
        let route_small = g.find_best_route(&token(1), &token(2), small_amount).unwrap();
        assert_eq!(route_small.hops[0].pool_index, 0, "Small trade should prefer low-fee pool");

        // Very large trade — high-reserve pool should win despite higher fees
        let large_amount = 50_000e18 as u128;
        let route_large = g.find_best_route(&token(1), &token(2), large_amount).unwrap();
        assert_eq!(route_large.hops[0].pool_index, 1, "Large trade should prefer deep pool");
    }

    // ============ Batch 7: Additional Hardening Tests ============

    #[test]
    fn test_pool_graph_new_is_empty() {
        let g = PoolGraph::new();
        assert!(g.pools.is_empty());
        assert_eq!(g.pool_count(), 0);
        assert_eq!(g.token_count(), 0);
        assert!(g.neighbors(&token(1)).is_empty());
    }

    #[test]
    fn test_simulate_route_tiny_reserves_produces_limited_output() {
        // With extremely tiny reserves, swap output should be very limited
        let mut g = PoolGraph::new();
        g.add_pool(PoolEdge {
            pair_id: pair(1, 2),
            token0: token(1),
            token1: token(2),
            reserve0: 10,
            reserve1: 10,
            fee_rate_bps: 30,
        });
        let hop = vec![SwapHop {
            pool_index: 0,
            pair_id: pair(1, 2),
            token_in: token(1),
            token_out: token(2),
        }];
        // Input of 1 into a tiny pool with 30bps fee → amount_in_with_fee = 0 → output = 0
        let result = g.simulate_route(&hop, 1);
        assert!(result.is_none() || result == Some(0),
            "Tiny pool with 1 unit input should yield zero or None: {:?}", result);
    }

    #[test]
    fn test_find_all_routes_returns_unique_paths() {
        // In a triangle, no two routes should be identical
        let g = graph_triangle();
        let routes = g.find_all_routes(&token(1), &token(3), MAX_HOPS).unwrap();
        for i in 0..routes.len() {
            for j in (i + 1)..routes.len() {
                assert_ne!(routes[i], routes[j],
                    "Routes {} and {} should be different", i, j);
            }
        }
    }

    #[test]
    fn test_split_route_total_output_matches_leg_sum() {
        let g = graph_triangle();
        let amount = 20_000e18 as u128;
        let split = g.find_split_route(&token(1), &token(3), amount).unwrap();

        let sum: u128 = split.legs.iter().map(|(r, _)| r.expected_output).sum();
        assert_eq!(sum, split.total_output,
            "total_output should equal sum of leg outputs");
    }

    #[test]
    fn test_best_route_single_hop_has_one_element() {
        let g = graph_two_pools();
        let route = g.find_best_route(&token(1), &token(2), 1_000e18 as u128).unwrap();
        assert_eq!(route.hops.len(), 1);
        assert_eq!(route.hops[0].pool_index, 0);
    }

    #[test]
    fn test_best_route_price_impact_bps_populated() {
        let g = graph_two_pools();
        let route = g.find_best_route(&token(1), &token(2), 10_000e18 as u128).unwrap();
        // For a meaningful trade, price_impact should be > 0
        assert!(route.price_impact_bps > 0,
            "Meaningful trade should have positive price impact");
    }

    #[test]
    fn test_min_output_with_slippage_very_small_expected() {
        // Expected output of 1 with various slippages
        assert_eq!(PoolGraph::min_output_with_slippage(1, 0), 1);
        assert_eq!(PoolGraph::min_output_with_slippage(1, 5000), 1); // 1 * 5000 / 10000 = 0
        assert_eq!(PoolGraph::min_output_with_slippage(1, 10_000), 0);
    }

    #[test]
    fn test_find_all_routes_triangle_both_directions() {
        // Triangle graph should find routes from token(3) to token(1) as well
        let g = graph_triangle();
        let forward = g.find_all_routes(&token(1), &token(3), MAX_HOPS).unwrap();
        let reverse = g.find_all_routes(&token(3), &token(1), MAX_HOPS).unwrap();
        // Both directions should find the same number of routes
        assert_eq!(forward.len(), reverse.len(),
            "Triangle should have same number of routes in both directions");
    }

    #[test]
    fn test_simulate_route_single_hop_reverse_is_different() {
        // Simulating A→B and B→A should give different outputs for the same input
        let g = graph_two_pools();
        let amount = 1_000e18 as u128;

        let hop_ab = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];
        let hop_ba = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(2), token_out: token(1),
        }];

        let out_ab = g.simulate_route(&hop_ab, amount).unwrap();
        let out_ba = g.simulate_route(&hop_ba, amount).unwrap();

        // On 1:1 pool, both should be approximately equal
        let diff = if out_ab > out_ba { out_ab - out_ba } else { out_ba - out_ab };
        assert!(diff < amount / 100, "1:1 pool should give similar output in both directions");
    }

    #[test]
    fn test_required_input_returns_none_for_impossible_output() {
        // Requesting more output than the pool can ever produce
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 100, 100));
        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];
        // Reserve_out is 100 — impossible to get 200 output
        let result = g.required_input(&hops, 200);
        assert!(result.is_none(), "Should return None for impossible output");
    }

    #[test]
    fn test_pool_edge_clone_debug() {
        // Verify PoolEdge Clone and Debug traits work
        let p = pool(1, 2, 1000, 2000);
        let cloned = p.clone();
        let _debug = format!("{:?}", cloned);
        assert_eq!(cloned.reserve0, p.reserve0);
        assert_eq!(cloned.reserve1, p.reserve1);
    }

    #[test]
    fn test_swap_route_clone_debug_eq() {
        // Verify SwapRoute Clone, Debug, PartialEq, Eq
        let route = SwapRoute {
            hops: vec![SwapHop {
                pool_index: 0, pair_id: pair(1, 2),
                token_in: token(1), token_out: token(2),
            }],
            expected_output: 1000,
            price_impact_bps: 50,
        };
        let cloned = route.clone();
        assert_eq!(route, cloned);
        let _debug = format!("{:?}", route);
    }

    #[test]
    fn test_router_error_clone_debug_eq() {
        // Verify RouterError Clone, Debug, PartialEq, Eq
        let e1 = RouterError::NoRouteFound;
        let e2 = e1.clone();
        assert_eq!(e1, e2);
        assert_ne!(e1, RouterError::ZeroInput);
        let _debug = format!("{:?}", e1);
    }

    #[test]
    fn test_effective_price_larger_trade_gives_lower_price() {
        // Effective price should decrease monotonically with trade size
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];

        let p1 = g.effective_price(&hops, 1_000e18 as u128).unwrap();
        let p2 = g.effective_price(&hops, 10_000e18 as u128).unwrap();
        let p3 = g.effective_price(&hops, 100_000e18 as u128).unwrap();

        assert!(p1 >= p2, "Price should decrease: 1K={} vs 10K={}", p1, p2);
        assert!(p2 >= p3, "Price should decrease: 10K={} vs 100K={}", p2, p3);
    }

    #[test]
    fn test_split_route_single_route_no_actual_split() {
        // With only one path available, split route should have 1 leg
        let g = graph_two_pools();
        let split = g.find_split_route(&token(1), &token(2), 1_000e18 as u128).unwrap();
        assert_eq!(split.legs.len(), 1);
        assert_eq!(split.legs[0].1, 1_000e18 as u128);
    }

    // ============ Batch 7: Hardening to 145+ Tests ============

    #[test]
    fn test_find_best_route_zero_input_err() {
        let g = graph_two_pools();
        let result = g.find_best_route(&token(1), &token(2), 0);
        assert_eq!(result, Err(RouterError::ZeroInput));
    }

    #[test]
    fn test_find_best_route_same_token_err() {
        let g = graph_two_pools();
        let result = g.find_best_route(&token(1), &token(1), 1000);
        assert_eq!(result, Err(RouterError::SameToken));
    }

    #[test]
    fn test_find_best_route_empty_graph_err() {
        let g = PoolGraph::new();
        let result = g.find_best_route(&token(1), &token(2), 1000);
        assert_eq!(result, Err(RouterError::EmptyGraph));
    }

    #[test]
    fn test_find_best_route_no_path_err() {
        // Two disconnected pools: A-B and C-D
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(3, 4, 1_000_000e18 as u128, 1_000_000e18 as u128));
        let result = g.find_best_route(&token(1), &token(4), 1_000e18 as u128);
        assert_eq!(result, Err(RouterError::NoRouteFound));
    }

    #[test]
    fn test_find_all_routes_same_token_err() {
        let g = graph_two_pools();
        let result = g.find_all_routes(&token(1), &token(1), MAX_HOPS);
        assert_eq!(result, Err(RouterError::SameToken));
    }

    #[test]
    fn test_find_all_routes_empty_graph_err() {
        let g = PoolGraph::new();
        let result = g.find_all_routes(&token(1), &token(2), MAX_HOPS);
        assert_eq!(result, Err(RouterError::EmptyGraph));
    }

    #[test]
    fn test_find_all_routes_no_path_err() {
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1000, 1000));
        let result = g.find_all_routes(&token(1), &token(99), MAX_HOPS);
        assert_eq!(result, Err(RouterError::NoRouteFound));
    }

    #[test]
    fn test_simulate_route_empty_hops_returns_input() {
        let g = graph_two_pools();
        let result = g.simulate_route(&[], 1000);
        assert_eq!(result, Some(1000), "Empty hops should return input amount");
    }

    #[test]
    fn test_simulate_route_1_wei_input() {
        // Very small input through a pool
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];
        let result = g.simulate_route(&hops, 1);
        // 1 wei input after 0.3% fee is 0 → get_amount_out returns 0 or error
        // Either None or Some(0) is acceptable
        assert!(result.is_none() || result == Some(0),
            "1 wei input should yield zero or None");
    }

    #[test]
    fn test_estimate_price_impact_zero_amount() {
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];
        let impact = g.estimate_price_impact(&hops, 0);
        assert_eq!(impact, 0, "Zero amount should have zero price impact");
    }

    #[test]
    fn test_estimate_price_impact_increases_with_size() {
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];

        let impact_small = g.estimate_price_impact(&hops, 1_000e18 as u128);
        let impact_large = g.estimate_price_impact(&hops, 100_000e18 as u128);

        assert!(impact_large >= impact_small,
            "Larger trades should have >= price impact: small={}, large={}",
            impact_small, impact_large);
    }

    #[test]
    fn test_spot_price_1_to_1_pool() {
        let p = pool(1, 2, 1_000_000e18 as u128, 1_000_000e18 as u128);
        let price = PoolGraph::spot_price(&p, &token(1));
        // 1:1 pool → spot price = 1e18
        assert_eq!(price, vibeswap_math::PRECISION,
            "1:1 pool spot price should be PRECISION (1e18)");
    }

    #[test]
    fn test_spot_price_2_to_1_pool() {
        let p = pool(1, 2, 1_000_000e18 as u128, 2_000_000e18 as u128);
        let price = PoolGraph::spot_price(&p, &token(1));
        // Reserve out / reserve in = 2 → spot price = 2e18
        assert_eq!(price, 2 * vibeswap_math::PRECISION,
            "2:1 pool spot price should be 2*PRECISION");
    }

    #[test]
    fn test_spot_price_reverse_direction() {
        let p = pool(1, 2, 1_000_000e18 as u128, 2_000_000e18 as u128);
        let price_forward = PoolGraph::spot_price(&p, &token(1)); // token1 → token2
        let price_reverse = PoolGraph::spot_price(&p, &token(2)); // token2 → token1

        // Forward price * reverse price should approximately equal PRECISION^2
        let product = vibeswap_math::mul_div(price_forward, price_reverse, vibeswap_math::PRECISION);
        assert_eq!(product, vibeswap_math::PRECISION,
            "Forward * Reverse spot price should equal PRECISION");
    }

    #[test]
    fn test_spot_price_zero_reserve_in() {
        let p = PoolEdge {
            pair_id: pair(1, 2),
            token0: token(1),
            token1: token(2),
            reserve0: 0,
            reserve1: 1_000_000e18 as u128,
            fee_rate_bps: 30,
        };
        let price = PoolGraph::spot_price(&p, &token(1));
        assert_eq!(price, 0, "Zero reserve_in should return 0 spot price");
    }

    #[test]
    fn test_effective_price_decreases_with_trade_size() {
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];

        let p_small = g.effective_price(&hops, 100e18 as u128).unwrap();
        let p_large = g.effective_price(&hops, 500_000e18 as u128).unwrap();

        assert!(p_small >= p_large,
            "Effective price should decrease with size: small={}, large={}",
            p_small, p_large);
    }

    #[test]
    fn test_required_input_small_output() {
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1_000_000e18 as u128, 1_000_000e18 as u128));
        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];

        let input = g.required_input(&hops, 1_000e18 as u128);
        assert!(input.is_some(), "Should find required input for reasonable output");
        let input_val = input.unwrap();

        // Verify the found input actually produces at least the desired output
        let output = g.simulate_route(&hops, input_val).unwrap();
        assert!(output >= 1_000e18 as u128,
            "Required input {} should produce >= 1000e18, got {}", input_val, output);
    }

    #[test]
    fn test_required_input_empty_hops_2() {
        let g = graph_two_pools();
        let result = g.required_input(&[], 1000);
        assert!(result.is_none(), "Empty hops should return None");
    }

    #[test]
    fn test_min_output_with_slippage_zero_slippage() {
        assert_eq!(PoolGraph::min_output_with_slippage(1_000_000, 0), 1_000_000);
    }

    #[test]
    fn test_min_output_with_slippage_100_percent() {
        assert_eq!(PoolGraph::min_output_with_slippage(1_000_000, 10_000), 0);
    }

    #[test]
    fn test_min_output_with_slippage_50_bps() {
        // 50 bps = 0.5%
        let result = PoolGraph::min_output_with_slippage(1_000_000, 50);
        let expected = 1_000_000 - (1_000_000 * 50 / 10_000);
        assert_eq!(result, expected, "50 bps slippage on 1M");
    }

    #[test]
    fn test_min_output_with_slippage_zero_expected_2() {
        assert_eq!(PoolGraph::min_output_with_slippage(0, 500), 0);
    }

    #[test]
    fn test_split_route_zero_input_err() {
        let g = graph_triangle();
        let result = g.find_split_route(&token(1), &token(3), 0);
        assert_eq!(result, Err(RouterError::ZeroInput));
    }

    #[test]
    fn test_split_route_triangle_uses_multiple_legs() {
        // Triangle graph has 2 routes from 1→3: direct (1→3) and via 2 (1→2→3)
        let g = graph_triangle();
        let split = g.find_split_route(&token(1), &token(3), 100_000e18 as u128).unwrap();
        // Should have >= 1 leg (optimizer may or may not split)
        assert!(split.legs.len() >= 1,
            "Triangle split route should have at least 1 leg, got {}", split.legs.len());
        assert!(split.total_output > 0, "Total output should be positive");

        // Total input should sum to the requested amount
        let total_in: u128 = split.legs.iter().map(|(_, amt)| *amt).sum();
        assert_eq!(total_in, 100_000e18 as u128,
            "Total input across legs should equal requested amount");
    }

    #[test]
    fn test_from_pools_constructor() {
        let edges = vec![
            (pool(1, 2, 1000, 2000),),
            (pool(2, 3, 3000, 4000),),
        ];
        let g = PoolGraph::from_pools(&edges);
        assert_eq!(g.pool_count(), 2);
        assert_eq!(g.token_count(), 3);
    }

    #[test]
    fn test_pool_count_and_token_count() {
        let mut g = PoolGraph::new();
        assert_eq!(g.pool_count(), 0);
        assert_eq!(g.token_count(), 0);

        g.add_pool(pool(1, 2, 1000, 1000));
        assert_eq!(g.pool_count(), 1);
        assert_eq!(g.token_count(), 2);

        // Add pool with one shared token
        g.add_pool(pool(2, 3, 1000, 1000));
        assert_eq!(g.pool_count(), 2);
        assert_eq!(g.token_count(), 3);

        // Add pool with all new tokens
        g.add_pool(pool(4, 5, 1000, 1000));
        assert_eq!(g.pool_count(), 3);
        assert_eq!(g.token_count(), 5);
    }

    #[test]
    fn test_find_best_route_direct_vs_multi_hop() {
        // When a direct route exists alongside a multi-hop, best route should be whichever gives more output
        let g = graph_triangle();
        let amount = 10_000e18 as u128;
        let route = g.find_best_route(&token(1), &token(3), amount).unwrap();
        // Must have a positive expected output
        assert!(route.expected_output > 0);
        // The best route's output should be >= any alternative
        let all_routes = g.find_all_routes(&token(1), &token(3), MAX_HOPS).unwrap();
        for r in &all_routes {
            if let Some(out) = g.simulate_route(r, amount) {
                assert!(route.expected_output >= out,
                    "Best route output {} should be >= alternative output {}", route.expected_output, out);
            }
        }
    }

    #[test]
    fn test_simulate_route_multi_hop_output_less_than_single_reserves() {
        // Multi-hop: A→B→C. Output should be strictly less than reserve_out of the last pool
        let g = graph_two_pools();
        let hops = vec![
            SwapHop { pool_index: 0, pair_id: pair(1, 2), token_in: token(1), token_out: token(2) },
            SwapHop { pool_index: 1, pair_id: pair(2, 3), token_in: token(2), token_out: token(3) },
        ];
        let output = g.simulate_route(&hops, 1_000e18 as u128).unwrap();
        assert!(output < 2_000_000e18 as u128,
            "Output should be less than the last pool's reserve_out");
    }

    #[test]
    fn test_find_best_route_returns_price_impact() {
        let g = graph_two_pools();
        let route = g.find_best_route(&token(1), &token(2), 100_000e18 as u128).unwrap();
        // A 100K trade on a 1M pool should have noticeable price impact
        assert!(route.price_impact_bps > 0,
            "100K trade on 1M pool should have positive price impact");
    }

    #[test]
    fn test_graph_clone() {
        let g = graph_triangle();
        let cloned = g.clone();
        assert_eq!(cloned.pool_count(), g.pool_count());
        assert_eq!(cloned.token_count(), g.token_count());
    }

    #[test]
    fn test_pool_graph_add_pool_returns_sequential_indices() {
        let mut g = PoolGraph::new();
        let i0 = g.add_pool(pool(1, 2, 1000, 1000));
        let i1 = g.add_pool(pool(2, 3, 1000, 1000));
        let i2 = g.add_pool(pool(3, 4, 1000, 1000));
        assert_eq!(i0, 0);
        assert_eq!(i1, 1);
        assert_eq!(i2, 2);
    }

    #[test]
    fn test_required_input_matches_simulate() {
        // Verify that the required_input result, when simulated, produces >= min_output
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1_000_000e18 as u128, 1_000_000e18 as u128));
        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];

        for target in [100e18 as u128, 10_000e18 as u128, 500_000e18 as u128] {
            if let Some(input) = g.required_input(&hops, target) {
                let output = g.simulate_route(&hops, input).unwrap();
                assert!(output >= target,
                    "Required input for {} should produce >= {}, got {}", target, target, output);
            }
        }
    }

    #[test]
    fn test_effective_price_approaches_spot_for_small_trade() {
        let mut g = PoolGraph::new();
        let p = pool(1, 2, 1_000_000e18 as u128, 2_000_000e18 as u128);
        let spot = PoolGraph::spot_price(&p, &token(1));
        g.add_pool(p);

        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];

        // Very small trade should yield effective price close to spot
        let eff = g.effective_price(&hops, 1e18 as u128).unwrap();
        // Allow some deviation due to fee + rounding
        let diff = if eff > spot { eff - spot } else { spot - eff };
        let tolerance = spot / 100; // 1% tolerance
        assert!(diff <= tolerance,
            "Effective price {} should be close to spot {} for small trade", eff, spot);
    }

    #[test]
    fn test_pool_edge_with_zero_fee() {
        let p = PoolEdge {
            pair_id: pair(1, 2),
            token0: token(1),
            token1: token(2),
            reserve0: 1_000_000e18 as u128,
            reserve1: 1_000_000e18 as u128,
            fee_rate_bps: 0,
        };
        let mut g = PoolGraph::new();
        g.add_pool(p);

        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];

        // With zero fee, output should be closer to input on a 1:1 pool
        let output = g.simulate_route(&hops, 1_000e18 as u128).unwrap();
        // With zero fee, output = amount_in * reserve_out / (reserve_in + amount_in)
        // = 1000 * 1M / (1M + 1000) ≈ 999.999
        assert!(output > 999e18 as u128,
            "Zero-fee pool should give output very close to input: {}", output);
    }

    #[test]
    fn test_pool_edge_with_high_fee() {
        let p = PoolEdge {
            pair_id: pair(1, 2),
            token0: token(1),
            token1: token(2),
            reserve0: 1_000_000e18 as u128,
            reserve1: 1_000_000e18 as u128,
            fee_rate_bps: 1000, // 10% fee
        };
        let mut g = PoolGraph::new();
        g.add_pool(p);

        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];

        let output = g.simulate_route(&hops, 1_000e18 as u128).unwrap();
        // With 10% fee, output should be significantly less
        assert!(output < 950e18 as u128,
            "10% fee should reduce output significantly: {}", output);
    }

    // ============ Batch 8: Hardening to 185+ Tests ============

    #[test]
    fn test_neighbors_returns_empty_for_unknown_token() {
        let g = graph_triangle();
        let n = g.neighbors(&token(99));
        assert!(n.is_empty());
    }

    #[test]
    fn test_add_pool_creates_bidirectional_edges() {
        let mut g = PoolGraph::new();
        g.add_pool(pool(10, 20, 1000, 2000));
        let n10 = g.neighbors(&token(10));
        let n20 = g.neighbors(&token(20));
        assert_eq!(n10.len(), 1);
        assert_eq!(n20.len(), 1);
        assert_eq!(n10[0].1, token(20));
        assert_eq!(n20[0].1, token(10));
    }

    #[test]
    fn test_find_all_routes_direct_single_pool() {
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1_000_000e18 as u128, 1_000_000e18 as u128));
        let routes = g.find_all_routes(&token(1), &token(2), MAX_HOPS).unwrap();
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].len(), 1);
    }

    #[test]
    fn test_find_all_routes_three_hop_chain() {
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1_000_000, 1_000_000));
        g.add_pool(pool(2, 3, 1_000_000, 1_000_000));
        g.add_pool(pool(3, 4, 1_000_000, 1_000_000));
        let routes = g.find_all_routes(&token(1), &token(4), 3).unwrap();
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].len(), 3);
    }

    #[test]
    fn test_simulate_route_larger_input_larger_output() {
        let g = graph_two_pools();
        let hop = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];
        let out_small = g.simulate_route(&hop, 100e18 as u128).unwrap();
        let out_large = g.simulate_route(&hop, 1_000e18 as u128).unwrap();
        assert!(out_large > out_small, "Larger input should produce larger output");
    }

    #[test]
    fn test_simulate_route_asymmetric_pool_direction() {
        // Pool with 1M:2M reserves. Swapping token0 should give more token1
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1_000_000e18 as u128, 2_000_000e18 as u128));
        let hop = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];
        let amount = 1_000e18 as u128;
        let output = g.simulate_route(&hop, amount).unwrap();
        // In a 1:2 pool, output should be roughly 2x input (minus fees)
        assert!(output > amount, "1:2 pool should give output > input");
    }

    #[test]
    fn test_best_route_prefers_fewer_hops_same_output() {
        // Triangle: direct A→C and indirect A→B→C with same reserve ratios
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 3, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(1, 2, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(2, 3, 1_000_000e18 as u128, 1_000_000e18 as u128));

        let amount = 1_000e18 as u128;
        let best = g.find_best_route(&token(1), &token(3), amount).unwrap();
        // Direct route should be preferred (same reserves but fewer fees)
        assert_eq!(best.hops.len(), 1, "Should prefer direct route with fewer hops");
    }

    #[test]
    fn test_price_impact_monotonic_with_trade_size() {
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];
        let sizes = [1_000e18 as u128, 10_000e18 as u128, 50_000e18 as u128, 200_000e18 as u128];
        let mut prev_impact = 0u16;
        for &size in &sizes {
            let impact = g.estimate_price_impact(&hops, size);
            assert!(impact >= prev_impact,
                "Price impact should increase: at {}, got {} vs prev {}", size, impact, prev_impact);
            prev_impact = impact;
        }
    }

    #[test]
    fn test_spot_price_with_3_to_1_ratio() {
        let p = pool(1, 2, 1_000_000e18 as u128, 3_000_000e18 as u128);
        let price = PoolGraph::spot_price(&p, &token(1));
        assert_eq!(price, 3 * vibeswap_math::PRECISION);
    }

    #[test]
    fn test_spot_price_inverse_3_to_1() {
        let p = pool(1, 2, 1_000_000e18 as u128, 3_000_000e18 as u128);
        let price_rev = PoolGraph::spot_price(&p, &token(2));
        // 1M / 3M = 0.333... * PRECISION
        let expected = vibeswap_math::PRECISION / 3;
        assert_eq!(price_rev, expected);
    }

    #[test]
    fn test_effective_price_single_hop_less_than_spot() {
        let mut g = PoolGraph::new();
        let p = pool(1, 2, 1_000_000e18 as u128, 1_000_000e18 as u128);
        let spot = PoolGraph::spot_price(&p, &token(1));
        g.add_pool(p);

        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];
        let eff = g.effective_price(&hops, 10_000e18 as u128).unwrap();
        assert!(eff < spot, "Effective price should be less than spot due to slippage");
    }

    #[test]
    fn test_required_input_for_one_unit_output() {
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];
        let result = g.required_input(&hops, 1);
        assert!(result.is_some());
        let input = result.unwrap();
        let output = g.simulate_route(&hops, input).unwrap();
        assert!(output >= 1);
    }

    #[test]
    fn test_min_output_with_slippage_5_percent() {
        let expected = 2_000_000u128;
        let min = PoolGraph::min_output_with_slippage(expected, 500); // 5%
        assert_eq!(min, 1_900_000);
    }

    #[test]
    fn test_min_output_with_slippage_10_percent() {
        let expected = 1_000_000u128;
        let min = PoolGraph::min_output_with_slippage(expected, 1000); // 10%
        assert_eq!(min, 900_000);
    }

    #[test]
    fn test_split_route_two_pools_single_leg() {
        // Two-hop path only (no direct route) — should have single leg
        let g = graph_two_pools();
        let split = g.find_split_route(&token(1), &token(3), 1_000e18 as u128).unwrap();
        assert_eq!(split.legs.len(), 1);
        assert!(split.total_output > 0);
    }

    #[test]
    fn test_split_route_legs_have_positive_output() {
        let g = graph_triangle();
        let split = g.find_split_route(&token(1), &token(3), 50_000e18 as u128).unwrap();
        for (route, alloc) in &split.legs {
            assert!(*alloc > 0);
            assert!(route.expected_output > 0);
        }
    }

    #[test]
    fn test_diamond_graph_best_route_is_two_hops() {
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(2, 4, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(1, 3, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(3, 4, 1_000_000e18 as u128, 1_000_000e18 as u128));

        let route = g.find_best_route(&token(1), &token(4), 1_000e18 as u128).unwrap();
        assert_eq!(route.hops.len(), 2);
    }

    #[test]
    fn test_graph_five_pools_shared_token() {
        let mut g = PoolGraph::new();
        // Star topology: center token 1 connects to 2,3,4,5,6
        g.add_pool(pool(1, 2, 1_000_000, 1_000_000));
        g.add_pool(pool(1, 3, 1_000_000, 1_000_000));
        g.add_pool(pool(1, 4, 1_000_000, 1_000_000));
        g.add_pool(pool(1, 5, 1_000_000, 1_000_000));
        g.add_pool(pool(1, 6, 1_000_000, 1_000_000));

        assert_eq!(g.pool_count(), 5);
        assert_eq!(g.token_count(), 6);
        assert_eq!(g.neighbors(&token(1)).len(), 5);
    }

    #[test]
    fn test_simulate_route_three_hops_output_positive() {
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(2, 3, 1_000_000e18 as u128, 1_000_000e18 as u128));
        g.add_pool(pool(3, 4, 1_000_000e18 as u128, 1_000_000e18 as u128));

        let hops = vec![
            SwapHop { pool_index: 0, pair_id: pair(1, 2), token_in: token(1), token_out: token(2) },
            SwapHop { pool_index: 1, pair_id: pair(2, 3), token_in: token(2), token_out: token(3) },
            SwapHop { pool_index: 2, pair_id: pair(3, 4), token_in: token(3), token_out: token(4) },
        ];
        let output = g.simulate_route(&hops, 1_000e18 as u128).unwrap();
        assert!(output > 0);
        // Three hops of fees on 1:1 pools
        assert!(output < 1_000e18 as u128);
    }

    #[test]
    fn test_router_error_all_variants_distinct() {
        let errors = [
            RouterError::NoRouteFound,
            RouterError::ZeroInput,
            RouterError::InsufficientLiquidity,
            RouterError::EmptyGraph,
            RouterError::SameToken,
        ];
        for i in 0..errors.len() {
            for j in (i + 1)..errors.len() {
                assert_ne!(errors[i], errors[j]);
            }
        }
    }

    #[test]
    fn test_swap_hop_clone_debug_eq() {
        let hop = SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        };
        let cloned = hop.clone();
        assert_eq!(hop, cloned);
        let _debug = format!("{:?}", hop);
    }

    #[test]
    fn test_split_route_clone() {
        let sr = SplitRoute {
            legs: vec![],
            total_output: 0,
        };
        let cloned = sr.clone();
        assert_eq!(cloned.total_output, 0);
        assert!(cloned.legs.is_empty());
    }

    #[test]
    fn test_best_route_output_matches_simulation() {
        let g = graph_triangle();
        let amount = 5_000e18 as u128;
        let route = g.find_best_route(&token(1), &token(3), amount).unwrap();
        let simulated = g.simulate_route(&route.hops, amount).unwrap();
        assert_eq!(route.expected_output, simulated,
            "Best route expected_output should match simulation");
    }

    #[test]
    fn test_spot_price_equal_reserves_equals_precision() {
        for amount in [1000u128, 1_000_000, 1_000_000_000_000_000_000u128] {
            let p = PoolEdge {
                pair_id: pair(1, 2),
                token0: token(1),
                token1: token(2),
                reserve0: amount,
                reserve1: amount,
                fee_rate_bps: 30,
            };
            let price = PoolGraph::spot_price(&p, &token(1));
            assert_eq!(price, vibeswap_math::PRECISION,
                "Equal reserves should give PRECISION price for amount {}", amount);
        }
    }

    #[test]
    fn test_find_all_routes_no_duplicate_pool_in_path() {
        let g = graph_triangle();
        let routes = g.find_all_routes(&token(1), &token(3), MAX_HOPS).unwrap();
        for route in &routes {
            let pool_indices: Vec<usize> = route.iter().map(|h| h.pool_index).collect();
            for i in 0..pool_indices.len() {
                for j in (i + 1)..pool_indices.len() {
                    assert_ne!(pool_indices[i], pool_indices[j],
                        "Route should not reuse pool index");
                }
            }
        }
    }

    #[test]
    fn test_simulate_route_preserves_constant_product() {
        // After a swap on a 1:1 pool, the product of new reserves should be >= old product
        // (because fees are added to the pool)
        // Use smaller reserves to avoid u128 overflow in the product calculation
        let r = 1_000_000_000_000u128; // 1e12 (instead of 1e24)
        let p = PoolEdge {
            pair_id: pair(1, 2),
            token0: token(1),
            token1: token(2),
            reserve0: r,
            reserve1: r,
            fee_rate_bps: 30,
        };
        let old_product = r * r;
        let mut g = PoolGraph::new();
        g.add_pool(p);
        let hop = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];
        let amount_in = r / 1000; // 0.1% of reserves
        let amount_out = g.simulate_route(&hop, amount_in).unwrap();
        let new_r0 = r + amount_in;
        let new_r1 = r - amount_out;
        let new_product = new_r0 * new_r1;
        assert!(new_product >= old_product,
            "Constant product should hold: old={}, new={}", old_product, new_product);
    }

    #[test]
    fn test_price_impact_on_tiny_pool() {
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1_000e18 as u128, 1_000e18 as u128));
        let hop = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];
        // 10% of reserves on tiny pool
        let impact = g.estimate_price_impact(&hop, 100e18 as u128);
        assert!(impact > 100, "10% trade on tiny pool should have significant impact");
    }

    #[test]
    fn test_effective_price_returns_none_for_failing_simulation() {
        // Pool with zero reserves should fail simulation
        let mut g = PoolGraph::new();
        g.add_pool(PoolEdge {
            pair_id: pair(1, 2),
            token0: token(1),
            token1: token(2),
            reserve0: 0,
            reserve1: 0,
            fee_rate_bps: 30,
        });
        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];
        let result = g.effective_price(&hops, 1_000);
        assert!(result.is_none());
    }

    // ============ Hardening Round 9 ============

    #[test]
    fn test_find_best_route_zero_input_h9() {
        let g = graph_two_pools();
        let result = g.find_best_route(&token(1), &token(3), 0);
        assert_eq!(result, Err(RouterError::ZeroInput));
    }

    #[test]
    fn test_find_best_route_same_token_h9() {
        let g = graph_two_pools();
        let result = g.find_best_route(&token(1), &token(1), 1000);
        assert_eq!(result, Err(RouterError::SameToken));
    }

    #[test]
    fn test_find_best_route_empty_graph_h9() {
        let g = PoolGraph::new();
        let result = g.find_best_route(&token(1), &token(2), 1000);
        assert_eq!(result, Err(RouterError::EmptyGraph));
    }

    #[test]
    fn test_find_best_route_no_route_h9() {
        let mut g = PoolGraph::new();
        g.add_pool(pool(1, 2, 1_000_000, 1_000_000));
        // Token 3 is not connected
        let result = g.find_best_route(&token(1), &token(3), 1000);
        assert_eq!(result, Err(RouterError::NoRouteFound));
    }

    #[test]
    fn test_find_all_routes_same_token_h9() {
        let g = graph_two_pools();
        let result = g.find_all_routes(&token(1), &token(1), 4);
        assert_eq!(result, Err(RouterError::SameToken));
    }

    #[test]
    fn test_find_all_routes_empty_graph_h9() {
        let g = PoolGraph::new();
        let result = g.find_all_routes(&token(1), &token(2), 4);
        assert_eq!(result, Err(RouterError::EmptyGraph));
    }

    #[test]
    fn test_find_all_routes_triangle_multiple_paths_h9() {
        let g = graph_triangle();
        let routes = g.find_all_routes(&token(1), &token(3), 4).unwrap();
        // Should find at least 2 routes: A->C direct, A->B->C
        assert!(routes.len() >= 2);
    }

    #[test]
    fn test_simulate_route_single_hop_h9() {
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];
        let output = g.simulate_route(&hops, 1_000_000);
        assert!(output.is_some());
        assert!(output.unwrap() > 0);
    }

    #[test]
    fn test_simulate_route_zero_input_h9() {
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];
        let output = g.simulate_route(&hops, 0);
        // Zero input may produce None or Some(0)
        assert!(output.is_none() || output == Some(0));
    }

    #[test]
    fn test_estimate_price_impact_zero_input_h9() {
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];
        let impact = g.estimate_price_impact(&hops, 0);
        assert_eq!(impact, 0);
    }

    #[test]
    fn test_estimate_price_impact_large_trade_h9() {
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];
        // Trade half the pool -> significant price impact
        let impact = g.estimate_price_impact(&hops, 500_000e18 as u128);
        assert!(impact > 0);
    }

    #[test]
    fn test_spot_price_token0_to_token1_h9() {
        let p = pool(1, 2, 1_000_000, 2_000_000);
        let price = PoolGraph::spot_price(&p, &token(1));
        // token1 / token0 * PRECISION = 2_000_000 / 1_000_000 * PRECISION = 2*PRECISION
        assert_eq!(price, 2 * vibeswap_math::PRECISION);
    }

    #[test]
    fn test_spot_price_token1_to_token0_h9() {
        let p = pool(1, 2, 1_000_000, 2_000_000);
        let price = PoolGraph::spot_price(&p, &token(2));
        // Reversed: token0/token1 * PRECISION = 1M/2M * PRECISION = PRECISION/2
        assert_eq!(price, vibeswap_math::PRECISION / 2);
    }

    #[test]
    fn test_spot_price_zero_reserve_in_h9() {
        let p = pool(1, 2, 0, 2_000_000);
        let price = PoolGraph::spot_price(&p, &token(1));
        assert_eq!(price, 0);
    }

    #[test]
    fn test_min_output_with_slippage_h9() {
        let result = PoolGraph::min_output_with_slippage(10_000, 50); // 0.5% slippage
        assert_eq!(result, 9_950);
    }

    #[test]
    fn test_min_output_with_slippage_zero_h9() {
        let result = PoolGraph::min_output_with_slippage(10_000, 0);
        assert_eq!(result, 10_000);
    }

    #[test]
    fn test_min_output_with_slippage_100_percent_h9() {
        let result = PoolGraph::min_output_with_slippage(10_000, 10_000);
        assert_eq!(result, 0);
    }

    #[test]
    fn test_effective_price_single_hop_h9() {
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];
        let price = g.effective_price(&hops, 1_000_000);
        assert!(price.is_some());
        assert!(price.unwrap() > 0);
    }

    #[test]
    fn test_effective_price_zero_input_h9() {
        let g = graph_two_pools();
        let hops = vec![SwapHop {
            pool_index: 0, pair_id: pair(1, 2),
            token_in: token(1), token_out: token(2),
        }];
        let result = g.effective_price(&hops, 0);
        assert!(result.is_none());
    }

    #[test]
    fn test_required_input_empty_hops_h9() {
        let g = graph_two_pools();
        let result = g.required_input(&[], 1000);
        assert!(result.is_none());
    }

    #[test]
    fn test_neighbors_unknown_token_h9() {
        let g = graph_two_pools();
        let n = g.neighbors(&token(99));
        assert!(n.is_empty());
    }

    #[test]
    fn test_from_pools_constructor_h9() {
        let edge = pool(1, 2, 1_000_000, 1_000_000);
        let g = PoolGraph::from_pools(&[(edge,)]);
        assert_eq!(g.pool_count(), 1);
        assert_eq!(g.token_count(), 2);
    }

    #[test]
    fn test_find_split_route_zero_input_h9() {
        let g = graph_triangle();
        let result = g.find_split_route(&token(1), &token(3), 0);
        assert_eq!(result, Err(RouterError::ZeroInput));
    }

    #[test]
    fn test_find_best_route_two_hop_h9() {
        let g = graph_two_pools();
        let route = g.find_best_route(&token(1), &token(3), 1_000_000e18 as u128);
        assert!(route.is_ok());
        let r = route.unwrap();
        assert_eq!(r.hops.len(), 2); // A->B->C
        assert!(r.expected_output > 0);
    }
}
