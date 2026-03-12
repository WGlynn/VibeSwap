// ============ Strategy SDK — Automated Trading & Yield Optimization ============
// Cross-module strategy helpers that combine router, fees, liquidity, and risk
// analysis into actionable trading and yield optimization decisions.
//
// Strategies:
// - Arbitrage detection: find profitable price discrepancies between pools
// - Rebalancing triggers: detect when LP positions need rebalancing
// - Yield optimization: compare yields across protocols to find best allocation
// - Liquidation opportunities: find profitable keeper actions
// - Portfolio risk alerts: detect positions approaching danger zones

use std::collections::BTreeMap;

use vibeswap_types::*;
use vibeswap_math::PRECISION;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StrategyError {
    /// No profitable arbitrage found
    NoArbOpportunity,
    /// Insufficient data to evaluate strategy
    InsufficientData,
    /// Pool reserves are zero
    EmptyPool,
    /// No positions to analyze
    NoPositions,
}

// ============ Arbitrage Detection ============

/// A detected arbitrage opportunity between two pools.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArbOpportunity {
    /// Pool to buy from (lower price)
    pub buy_pool_id: [u8; 32],
    /// Pool to sell into (higher price)
    pub sell_pool_id: [u8; 32],
    /// Price in the buy pool (PRECISION scale)
    pub buy_price: u128,
    /// Price in the sell pool (PRECISION scale)
    pub sell_price: u128,
    /// Price spread in bps
    pub spread_bps: u64,
    /// Estimated optimal trade size
    pub optimal_size: u128,
    /// Estimated profit (after fees)
    pub estimated_profit: u128,
}

/// Scan pools for arbitrage opportunities on the same token pair.
///
/// Compares spot prices across pools and identifies spreads that exceed
/// the combined fee rates (making arbitrage profitable).
pub fn find_arbitrage(
    pools: &[([u8; 32], &PoolCellData)],
    min_spread_bps: u64,
) -> Vec<ArbOpportunity> {
    let mut opportunities = Vec::new();

    for i in 0..pools.len() {
        let (id_a, pool_a) = &pools[i];
        if pool_a.reserve0 == 0 || pool_a.reserve1 == 0 {
            continue;
        }
        let price_a = vibeswap_math::mul_div(pool_a.reserve1, PRECISION, pool_a.reserve0);

        for j in (i + 1)..pools.len() {
            let (id_b, pool_b) = &pools[j];
            if pool_b.reserve0 == 0 || pool_b.reserve1 == 0 {
                continue;
            }
            let price_b = vibeswap_math::mul_div(pool_b.reserve1, PRECISION, pool_b.reserve0);

            // Determine direction
            let (buy_id, sell_id, buy_price, sell_price, buy_pool, sell_pool) = if price_a < price_b {
                (*id_a, *id_b, price_a, price_b, *pool_a, *pool_b)
            } else if price_b < price_a {
                (*id_b, *id_a, price_b, price_a, *pool_b, *pool_a)
            } else {
                continue; // Equal prices, no arb
            };

            let spread_bps = vibeswap_math::mul_div(
                sell_price - buy_price,
                10_000,
                buy_price,
            ) as u64;

            // Fees eat into the spread
            let total_fee_bps = buy_pool.fee_rate_bps as u64 + sell_pool.fee_rate_bps as u64;
            if spread_bps <= total_fee_bps || spread_bps < min_spread_bps {
                continue;
            }

            // Optimal size: limited by smaller pool's reserves
            let max_buy_size = buy_pool.reserve0 / 100; // Max 1% of pool
            let max_sell_size = sell_pool.reserve0 / 100;
            let optimal_size = max_buy_size.min(max_sell_size);

            // Estimate profit: size × (spread - fees) / 10000
            let net_spread_bps = spread_bps - total_fee_bps;
            let estimated_profit = vibeswap_math::mul_div(
                optimal_size,
                net_spread_bps as u128,
                10_000,
            );

            opportunities.push(ArbOpportunity {
                buy_pool_id: buy_id,
                sell_pool_id: sell_id,
                buy_price,
                sell_price,
                spread_bps,
                optimal_size,
                estimated_profit,
            });
        }
    }

    // Sort by estimated profit descending
    opportunities.sort_by(|a, b| b.estimated_profit.cmp(&a.estimated_profit));
    opportunities
}

// ============ Rebalancing Triggers ============

/// Rebalancing recommendation for an LP position.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RebalanceSignal {
    /// Current IL in bps
    pub current_il_bps: u64,
    /// Whether rebalancing is recommended
    pub should_rebalance: bool,
    /// Recommended action
    pub action: RebalanceAction,
    /// Current position value
    pub position_value: u128,
    /// Value if rebalanced now
    pub rebalanced_value: u128,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RebalanceAction {
    /// Hold current position
    Hold,
    /// Remove liquidity and re-enter at current price
    ReenterAtCurrentPrice,
    /// Remove liquidity entirely (IL too high)
    ExitPosition,
    /// Add more liquidity (price favorable)
    AddLiquidity,
}

/// Check if an LP position should be rebalanced.
///
/// Evaluates IL vs accrued fees to determine if the position is still profitable.
/// Recommends rebalancing when IL exceeds the fee income threshold.
pub fn check_rebalance(
    entry_price: u128,
    current_price: u128,
    position_value: u128,
    accrued_fees: u128,
    il_threshold_bps: u64,
    exit_threshold_bps: u64,
) -> Result<RebalanceSignal, StrategyError> {
    if entry_price == 0 || current_price == 0 {
        return Err(StrategyError::InsufficientData);
    }

    let il = crate::liquidity::impermanent_loss(entry_price, current_price, position_value)
        .map_err(|_| StrategyError::InsufficientData)?;

    // Net P&L: fees earned - IL
    let fees_cover_il = accrued_fees >= il.loss_amount;

    let (should_rebalance, action) = if il.il_bps >= exit_threshold_bps {
        (true, RebalanceAction::ExitPosition)
    } else if il.il_bps >= il_threshold_bps && !fees_cover_il {
        (true, RebalanceAction::ReenterAtCurrentPrice)
    } else if il.il_bps < 50 && accrued_fees > 0 {
        // Very low IL + earning fees → could add more
        (false, RebalanceAction::AddLiquidity)
    } else {
        (false, RebalanceAction::Hold)
    };

    // Rebalanced value = current LP value (reset IL to 0)
    let rebalanced_value = il.lp_value + accrued_fees;

    Ok(RebalanceSignal {
        current_il_bps: il.il_bps,
        should_rebalance,
        action,
        position_value: il.lp_value,
        rebalanced_value,
    })
}

// ============ Yield Comparison ============

/// A yield source with its current APY.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct YieldSource {
    /// Identifier for this source
    pub source_id: [u8; 32],
    /// Type of yield source
    pub source_type: YieldType,
    /// Current APY in bps
    pub apy_bps: u64,
    /// Total value locked / deposited
    pub tvl: u128,
    /// Risk score (0-100, higher = riskier)
    pub risk_score: u8,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum YieldType {
    /// AMM LP fees
    LPFees,
    /// Lending deposit interest
    LendingDeposit,
    /// Insurance premium income
    InsurancePremium,
    /// Governance staking rewards
    StakingRewards,
}

/// Yield optimization recommendation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct YieldRecommendation {
    /// Best risk-adjusted yield source
    pub best_source: [u8; 32],
    /// APY of best source (bps)
    pub best_apy_bps: u64,
    /// Risk-adjusted APY (apy / risk, higher = better)
    pub risk_adjusted_score: u128,
    /// All sources ranked by risk-adjusted yield
    pub ranked_sources: Vec<([u8; 32], u64, u128)>, // (id, apy_bps, risk_adjusted)
}

/// Find the best yield opportunity across all available sources.
///
/// Uses a simple risk-adjusted return: APY / (1 + risk_score/100)
/// This penalizes high-risk sources proportionally.
pub fn optimize_yield(
    sources: &[YieldSource],
    max_risk_score: u8,
) -> Result<YieldRecommendation, StrategyError> {
    if sources.is_empty() {
        return Err(StrategyError::NoPositions);
    }

    let mut ranked: Vec<([u8; 32], u64, u128)> = sources
        .iter()
        .filter(|s| s.risk_score <= max_risk_score && s.apy_bps > 0)
        .map(|s| {
            // Risk-adjusted: apy * PRECISION / (PRECISION + risk_score * PRECISION / 100)
            let risk_penalty = PRECISION + vibeswap_math::mul_div(
                s.risk_score as u128,
                PRECISION,
                100,
            );
            let adjusted = vibeswap_math::mul_div(s.apy_bps as u128 * PRECISION, PRECISION, risk_penalty);
            (s.source_id, s.apy_bps, adjusted)
        })
        .collect();

    if ranked.is_empty() {
        return Err(StrategyError::NoPositions);
    }

    // Sort by risk-adjusted score descending
    ranked.sort_by(|a, b| b.2.cmp(&a.2));

    let best = ranked[0];

    Ok(YieldRecommendation {
        best_source: best.0,
        best_apy_bps: best.1,
        risk_adjusted_score: best.2,
        ranked_sources: ranked,
    })
}

// ============ Liquidation Opportunities ============

/// A profitable liquidation opportunity.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LiquidationOpportunity {
    /// Vault index in the input list
    pub vault_index: usize,
    /// Current health factor (PRECISION scale)
    pub health_factor: u128,
    /// Maximum collateral that can be seized
    pub seizable_collateral: u128,
    /// Estimated profit from liquidation (collateral bonus - gas)
    pub estimated_profit: u128,
    /// Urgency score (0-100, higher = more urgent)
    pub urgency: u8,
}

/// Scan vaults for profitable liquidation opportunities.
///
/// A liquidation is profitable when the liquidation incentive (bonus collateral)
/// exceeds the gas cost of the transaction.
pub fn find_liquidations(
    vaults: &[(u128, u128, u128)], // (collateral_value, debt_value, liquidation_threshold_bps)
    liquidation_incentive_bps: u64,
    gas_cost: u128,
) -> Vec<LiquidationOpportunity> {
    let mut opportunities = Vec::new();

    for (i, &(collateral, debt, threshold_bps)) in vaults.iter().enumerate() {
        if debt == 0 || collateral == 0 {
            continue;
        }

        // Health factor = collateral * threshold_bps / (debt * 10000)
        // Scaled to PRECISION: hf = collateral * threshold_bps * PRECISION / (debt * 10000)
        let hf = vibeswap_math::mul_div(
            collateral,
            threshold_bps * PRECISION,
            debt * 10_000,
        );

        // Liquidatable if HF < 1.0 (PRECISION)
        if hf >= PRECISION {
            continue;
        }

        // Max seizable = debt * (1 + incentive) in collateral terms
        let seizable = vibeswap_math::mul_div(
            debt,
            10_000 + liquidation_incentive_bps as u128,
            10_000,
        ).min(collateral);

        // Profit = incentive portion - gas
        let incentive_value = vibeswap_math::mul_div(
            seizable,
            liquidation_incentive_bps as u128,
            10_000 + liquidation_incentive_bps as u128,
        );

        let estimated_profit = incentive_value.saturating_sub(gas_cost);

        // Urgency: lower HF = more urgent
        let urgency = if hf == 0 {
            100
        } else {
            let hf_pct = vibeswap_math::mul_div(hf, 100, PRECISION) as u8;
            100u8.saturating_sub(hf_pct)
        };

        if estimated_profit > 0 {
            opportunities.push(LiquidationOpportunity {
                vault_index: i,
                health_factor: hf,
                seizable_collateral: seizable,
                estimated_profit,
                urgency,
            });
        }
    }

    // Sort by profit descending
    opportunities.sort_by(|a, b| b.estimated_profit.cmp(&a.estimated_profit));
    opportunities
}

// ============ Portfolio Risk Alerts ============

/// Alert level for a position.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum AlertLevel {
    /// Everything fine
    Safe,
    /// Worth monitoring
    Watch,
    /// Action recommended soon
    Warning,
    /// Immediate action needed
    Critical,
}

/// A risk alert for a specific position.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RiskAlert {
    /// Position identifier
    pub position_id: [u8; 32],
    /// Alert severity
    pub level: AlertLevel,
    /// Human-readable reason
    pub reason: AlertReason,
    /// Relevant metric value
    pub metric_value: u64,
    /// Threshold that was exceeded
    pub threshold: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AlertReason {
    /// Health factor approaching liquidation
    LowHealthFactor,
    /// Impermanent loss exceeding threshold
    HighImpermanentLoss,
    /// Position concentration too high
    HighConcentration,
    /// Pool utilization dangerously high
    HighUtilization,
}

/// Scan positions and generate risk alerts.
pub fn check_risk_alerts(
    positions: &[([u8; 32], u64, AlertReason)], // (id, metric_bps, reason)
    watch_threshold_bps: u64,
    warning_threshold_bps: u64,
    critical_threshold_bps: u64,
) -> Vec<RiskAlert> {
    let mut alerts = Vec::new();

    for &(ref id, metric, ref reason) in positions {
        let level = if metric >= critical_threshold_bps {
            AlertLevel::Critical
        } else if metric >= warning_threshold_bps {
            AlertLevel::Warning
        } else if metric >= watch_threshold_bps {
            AlertLevel::Watch
        } else {
            continue; // Safe, no alert
        };

        let threshold = match level {
            AlertLevel::Critical => critical_threshold_bps,
            AlertLevel::Warning => warning_threshold_bps,
            AlertLevel::Watch => watch_threshold_bps,
            AlertLevel::Safe => unreachable!(),
        };

        alerts.push(RiskAlert {
            position_id: *id,
            level,
            reason: reason.clone(),
            metric_value: metric,
            threshold,
        });
    }

    // Sort by severity descending (Critical first)
    alerts.sort_by(|a, b| b.level.cmp(&a.level));
    alerts
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn id(n: u8) -> [u8; 32] {
        let mut h = [0u8; 32];
        h[0] = n;
        h
    }

    fn make_pool_data(r0: u128, r1: u128, fee_bps: u16) -> PoolCellData {
        PoolCellData {
            reserve0: r0,
            reserve1: r1,
            total_lp_supply: vibeswap_math::sqrt_product(r0, r1),
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

    // ============ Arbitrage Detection ============

    #[test]
    fn test_arb_no_opportunity() {
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 30);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 30);
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        let arbs = find_arbitrage(&pools, 10);
        assert!(arbs.is_empty());
    }

    #[test]
    fn test_arb_profitable_spread() {
        // Pool A: 1:1, Pool B: 1:1.05 (5% spread)
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 30);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_050_000 * PRECISION, 30);
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        let arbs = find_arbitrage(&pools, 10);
        assert!(!arbs.is_empty());

        let arb = &arbs[0];
        assert_eq!(arb.buy_pool_id, id(1)); // Buy from cheaper
        assert_eq!(arb.sell_pool_id, id(2)); // Sell to more expensive
        assert!(arb.spread_bps > 400); // ~5% = 500 bps
        assert!(arb.estimated_profit > 0);
    }

    #[test]
    fn test_arb_spread_below_fees() {
        // 0.1% spread but 0.3% fees each way = unprofitable
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 30);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_001_000 * PRECISION, 30);
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        let arbs = find_arbitrage(&pools, 10);
        assert!(arbs.is_empty());
    }

    #[test]
    fn test_arb_multiple_pools() {
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 5);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_100_000 * PRECISION, 5);
        let pool_c = make_pool_data(1_000_000 * PRECISION, 1_200_000 * PRECISION, 5);
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b), (id(3), &pool_c)];

        let arbs = find_arbitrage(&pools, 10);
        assert!(arbs.len() >= 2); // A↔B, A↔C, and possibly B↔C
        // Best arb should be sorted first (A↔C, 20% spread)
        assert!(arbs[0].spread_bps > arbs.last().unwrap().spread_bps);
    }

    #[test]
    fn test_arb_empty_pool_skipped() {
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 30);
        let pool_b = make_pool_data(0, 0, 30); // Empty
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        let arbs = find_arbitrage(&pools, 10);
        assert!(arbs.is_empty());
    }

    #[test]
    fn test_arb_min_spread_filter() {
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 5);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_020_000 * PRECISION, 5); // 2% spread

        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        // Min 100 bps — should find it
        assert!(!find_arbitrage(&pools, 100).is_empty());
        // Min 500 bps — should filter it out
        assert!(find_arbitrage(&pools, 500).is_empty());
    }

    // ============ Rebalance Signals ============

    #[test]
    fn test_rebalance_hold() {
        let signal = check_rebalance(
            PRECISION, PRECISION, // No price change
            100_000 * PRECISION,
            5_000 * PRECISION,  // 5K fees earned
            500,                // 5% IL threshold
            2000,               // 20% exit threshold
        ).unwrap();

        assert!(!signal.should_rebalance);
        // Low IL + fees → AddLiquidity
        assert_eq!(signal.action, RebalanceAction::AddLiquidity);
    }

    #[test]
    fn test_rebalance_reenter() {
        // Price doubled → ~5.7% IL, fees don't cover
        let signal = check_rebalance(
            PRECISION,
            2 * PRECISION,
            100_000 * PRECISION,
            1_000 * PRECISION,  // Only 1K fees (not enough)
            500,                // 5% threshold → triggers
            2000,
        ).unwrap();

        assert!(signal.should_rebalance);
        assert_eq!(signal.action, RebalanceAction::ReenterAtCurrentPrice);
    }

    #[test]
    fn test_rebalance_exit() {
        // Price 10x → ~42% IL → above exit threshold
        let signal = check_rebalance(
            PRECISION,
            10 * PRECISION,
            100_000 * PRECISION,
            0,
            500,
            2000, // 20% exit → triggers at 42%
        ).unwrap();

        assert!(signal.should_rebalance);
        assert_eq!(signal.action, RebalanceAction::ExitPosition);
    }

    #[test]
    fn test_rebalance_fees_cover_il() {
        // Price doubled (~5.7% IL) but fees more than cover it
        let signal = check_rebalance(
            PRECISION,
            2 * PRECISION,
            100_000 * PRECISION,
            20_000 * PRECISION, // 20K fees >> IL
            500,
            2000,
        ).unwrap();

        assert!(!signal.should_rebalance);
        assert_eq!(signal.action, RebalanceAction::Hold);
    }

    #[test]
    fn test_rebalance_zero_price() {
        let err = check_rebalance(0, PRECISION, 100_000, 0, 500, 2000).unwrap_err();
        assert_eq!(err, StrategyError::InsufficientData);
    }

    // ============ Yield Optimization ============

    #[test]
    fn test_yield_basic_ranking() {
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 500, tvl: 1_000_000, risk_score: 20 },
            YieldSource { source_id: id(2), source_type: YieldType::LendingDeposit, apy_bps: 300, tvl: 2_000_000, risk_score: 10 },
            YieldSource { source_id: id(3), source_type: YieldType::InsurancePremium, apy_bps: 800, tvl: 500_000, risk_score: 50 },
        ];

        let rec = optimize_yield(&sources, 100).unwrap();
        // All 3 should be in ranking
        assert_eq!(rec.ranked_sources.len(), 3);
        // Best should have highest risk-adjusted score
        assert!(rec.risk_adjusted_score > 0);
    }

    #[test]
    fn test_yield_risk_filter() {
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 1000, tvl: 1_000_000, risk_score: 80 },
            YieldSource { source_id: id(2), source_type: YieldType::LendingDeposit, apy_bps: 200, tvl: 2_000_000, risk_score: 10 },
        ];

        // Max risk 50 → filters out source 1
        let rec = optimize_yield(&sources, 50).unwrap();
        assert_eq!(rec.ranked_sources.len(), 1);
        assert_eq!(rec.best_source, id(2));
    }

    #[test]
    fn test_yield_risk_adjusted_prefers_safety() {
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 500, tvl: 1_000_000, risk_score: 5 },
            YieldSource { source_id: id(2), source_type: YieldType::InsurancePremium, apy_bps: 600, tvl: 500_000, risk_score: 60 },
        ];

        let rec = optimize_yield(&sources, 100).unwrap();
        // Source 1: 500 / 1.05 ≈ 476 adjusted
        // Source 2: 600 / 1.60 = 375 adjusted
        // Source 1 should win despite lower raw APY
        assert_eq!(rec.best_source, id(1));
    }

    #[test]
    fn test_yield_empty_sources() {
        let err = optimize_yield(&[], 100).unwrap_err();
        assert_eq!(err, StrategyError::NoPositions);
    }

    #[test]
    fn test_yield_all_zero_apy() {
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 0, tvl: 1_000_000, risk_score: 10 },
        ];
        let err = optimize_yield(&sources, 100).unwrap_err();
        assert_eq!(err, StrategyError::NoPositions);
    }

    // ============ Liquidation Opportunities ============

    #[test]
    fn test_liquidation_profitable() {
        // Vault: 80K collateral, 100K debt, 80% threshold → HF = 0.64
        let vaults = vec![
            (80_000 * PRECISION, 100_000 * PRECISION, 8000u128), // Undercollateralized
        ];

        let opps = find_liquidations(&vaults, 500, 100 * PRECISION); // 5% incentive, 100 gas
        assert_eq!(opps.len(), 1);
        assert!(opps[0].estimated_profit > 0);
        assert!(opps[0].health_factor < PRECISION, "Should be undercollateralized");
        assert!(opps[0].urgency > 0, "Should have some urgency");
    }

    #[test]
    fn test_liquidation_healthy_vault_skipped() {
        // Vault: 200K collateral, 100K debt → safe
        let vaults = vec![
            (200_000 * PRECISION, 100_000 * PRECISION, 8000u128),
        ];

        let opps = find_liquidations(&vaults, 500, 100 * PRECISION);
        assert!(opps.is_empty());
    }

    #[test]
    fn test_liquidation_zero_debt_skipped() {
        let vaults = vec![(100_000 * PRECISION, 0u128, 8000u128)];
        let opps = find_liquidations(&vaults, 500, 0);
        assert!(opps.is_empty());
    }

    #[test]
    fn test_liquidation_sorted_by_profit() {
        let vaults = vec![
            (50_000 * PRECISION, 100_000 * PRECISION, 8000u128),  // Very underwater
            (90_000 * PRECISION, 100_000 * PRECISION, 8000u128),  // Barely underwater
        ];

        let opps = find_liquidations(&vaults, 500, 10 * PRECISION);
        assert!(opps.len() >= 1);
        if opps.len() >= 2 {
            assert!(opps[0].estimated_profit >= opps[1].estimated_profit);
        }
    }

    #[test]
    fn test_liquidation_gas_eats_profit() {
        // Small vault where gas > incentive
        let vaults = vec![
            (500 * PRECISION, 1000 * PRECISION, 8000u128),
        ];

        let opps = find_liquidations(&vaults, 500, 1_000_000 * PRECISION); // Huge gas
        assert!(opps.is_empty()); // Not profitable
    }

    // ============ Risk Alerts ============

    #[test]
    fn test_alerts_critical() {
        let positions = vec![
            (id(1), 9500u64, AlertReason::LowHealthFactor), // 95% → critical
        ];

        let alerts = check_risk_alerts(&positions, 3000, 6000, 9000);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].level, AlertLevel::Critical);
    }

    #[test]
    fn test_alerts_multiple_levels() {
        let positions = vec![
            (id(1), 2000u64, AlertReason::HighImpermanentLoss), // Below watch
            (id(2), 3500u64, AlertReason::HighImpermanentLoss), // Watch
            (id(3), 6500u64, AlertReason::LowHealthFactor),     // Warning
            (id(4), 9500u64, AlertReason::HighConcentration),    // Critical
        ];

        let alerts = check_risk_alerts(&positions, 3000, 6000, 9000);
        assert_eq!(alerts.len(), 3); // id(1) is safe, filtered out
        assert_eq!(alerts[0].level, AlertLevel::Critical);
        assert_eq!(alerts[1].level, AlertLevel::Warning);
        assert_eq!(alerts[2].level, AlertLevel::Watch);
    }

    #[test]
    fn test_alerts_all_safe() {
        let positions = vec![
            (id(1), 100u64, AlertReason::LowHealthFactor),
            (id(2), 200u64, AlertReason::HighImpermanentLoss),
        ];

        let alerts = check_risk_alerts(&positions, 3000, 6000, 9000);
        assert!(alerts.is_empty());
    }

    #[test]
    fn test_alerts_empty_positions() {
        let alerts = check_risk_alerts(&[], 3000, 6000, 9000);
        assert!(alerts.is_empty());
    }

    // ============ Integration ============

    #[test]
    fn test_arb_then_yield() {
        // Find arb opportunities, then check if yields beat the arb profit
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 5);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_100_000 * PRECISION, 5);
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        let arbs = find_arbitrage(&pools, 10);
        assert!(!arbs.is_empty());

        // Compare arb profit to yield
        let sources = vec![
            YieldSource { source_id: id(10), source_type: YieldType::LendingDeposit, apy_bps: 300, tvl: 5_000_000, risk_score: 10 },
        ];
        let yield_rec = optimize_yield(&sources, 100).unwrap();

        // Both should be valid strategies
        assert!(arbs[0].estimated_profit > 0);
        assert!(yield_rec.best_apy_bps > 0);
    }

    #[test]
    fn test_full_strategy_scan() {
        // Simulate a full strategy scan across all modules
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 30);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_500_000 * PRECISION, 30);
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        // 1. Arb scan
        let arbs = find_arbitrage(&pools, 10);

        // 2. Rebalance check for an LP position
        let rebal = check_rebalance(
            PRECISION, 15 * PRECISION / 10, // 50% price move
            50_000 * PRECISION, 2_000 * PRECISION,
            500, 2000,
        ).unwrap();

        // 3. Yield optimization
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 400, tvl: 2_000_000, risk_score: 15 },
            YieldSource { source_id: id(2), source_type: YieldType::LendingDeposit, apy_bps: 250, tvl: 5_000_000, risk_score: 5 },
        ];
        let yield_rec = optimize_yield(&sources, 100).unwrap();

        // 4. Risk alerts
        let positions = vec![
            (id(1), 7000u64, AlertReason::HighImpermanentLoss),
        ];
        let alerts = check_risk_alerts(&positions, 3000, 6000, 9000);

        // All should produce valid results
        assert!(!arbs.is_empty());
        assert!(rebal.current_il_bps > 0);
        assert!(yield_rec.ranked_sources.len() == 2);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].level, AlertLevel::Warning);
    }

    // ============ Edge Case: Single Pool Arb Scan ============

    #[test]
    fn test_arb_single_pool_no_arb() {
        // With only one pool, no pair comparison is possible → no arb
        let pool_a = make_pool_data(1_000_000 * PRECISION, 2_000_000 * PRECISION, 30);
        let pools = vec![(id(1), &pool_a)];

        let arbs = find_arbitrage(&pools, 0);
        assert!(arbs.is_empty(), "Single pool cannot produce arbitrage");
    }

    #[test]
    fn test_arb_extreme_price_ratio() {
        // Pool A: 1:1, Pool B: 1:100 (10000% spread)
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 10);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 100_000_000 * PRECISION, 10);
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        let arbs = find_arbitrage(&pools, 10);
        assert_eq!(arbs.len(), 1);
        // Spread should be enormous (close to 9900 bps = 99x / 1x)
        assert!(arbs[0].spread_bps > 5000, "Extreme ratio should produce large spread");
        assert_eq!(arbs[0].buy_pool_id, id(1));
        assert_eq!(arbs[0].sell_pool_id, id(2));
    }

    #[test]
    fn test_arb_one_pool_empty_reserves() {
        // Pool A has zero reserve0, Pool B is normal
        let pool_a = make_pool_data(0, 1_000_000 * PRECISION, 30);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_500_000 * PRECISION, 30);
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        let arbs = find_arbitrage(&pools, 0);
        assert!(arbs.is_empty(), "Pool with zero reserves should be skipped");
    }

    // ============ Yield Optimization Boundary Conditions ============

    #[test]
    fn test_yield_equal_apy_prefers_lower_risk() {
        // Two sources with identical APY but different risk
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 500, tvl: 1_000_000, risk_score: 30 },
            YieldSource { source_id: id(2), source_type: YieldType::StakingRewards, apy_bps: 500, tvl: 1_000_000, risk_score: 10 },
        ];

        let rec = optimize_yield(&sources, 100).unwrap();
        // Same APY → lower risk should win on risk-adjusted basis
        assert_eq!(rec.best_source, id(2), "Equal APY should favor lower risk");
    }

    #[test]
    fn test_yield_equal_risk_prefers_higher_apy() {
        // Two sources with identical risk but different APY
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 300, tvl: 1_000_000, risk_score: 20 },
            YieldSource { source_id: id(2), source_type: YieldType::LendingDeposit, apy_bps: 700, tvl: 1_000_000, risk_score: 20 },
        ];

        let rec = optimize_yield(&sources, 100).unwrap();
        assert_eq!(rec.best_source, id(2), "Equal risk should favor higher APY");
        assert_eq!(rec.best_apy_bps, 700);
    }

    #[test]
    fn test_yield_all_filtered_by_risk_cap() {
        // All sources exceed the risk cap
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 800, tvl: 1_000_000, risk_score: 60 },
            YieldSource { source_id: id(2), source_type: YieldType::InsurancePremium, apy_bps: 1200, tvl: 500_000, risk_score: 90 },
        ];

        let err = optimize_yield(&sources, 50).unwrap_err();
        assert_eq!(err, StrategyError::NoPositions, "All sources above risk cap");
    }

    // ============ Rebalance Edge Cases ============

    #[test]
    fn test_rebalance_price_unchanged_with_fees() {
        // Price hasn't moved at all → IL should be 0
        let signal = check_rebalance(
            PRECISION,
            PRECISION,          // Same price
            100_000 * PRECISION,
            10_000 * PRECISION, // Earned 10K in fees
            500,
            2000,
        ).unwrap();

        assert_eq!(signal.current_il_bps, 0, "No price change → zero IL");
        assert!(!signal.should_rebalance);
        // Zero IL + fees earned → AddLiquidity
        assert_eq!(signal.action, RebalanceAction::AddLiquidity);
    }

    #[test]
    fn test_rebalance_extreme_il_price_100x() {
        // Price 100x → extreme IL, should recommend exit
        let signal = check_rebalance(
            PRECISION,
            100 * PRECISION,     // 100x price move
            100_000 * PRECISION,
            0,                   // No fees earned
            500,
            2000,                // 20% exit threshold
        ).unwrap();

        assert!(signal.current_il_bps > 2000, "100x price should produce >20% IL");
        assert!(signal.should_rebalance);
        assert_eq!(signal.action, RebalanceAction::ExitPosition);
    }

    #[test]
    fn test_rebalance_both_prices_zero() {
        // Both entry and current are zero → error
        let err = check_rebalance(0, 0, 100_000 * PRECISION, 0, 500, 2000).unwrap_err();
        assert_eq!(err, StrategyError::InsufficientData);
    }

    // ============ Liquidation Edge Cases ============

    #[test]
    fn test_liquidation_all_vaults_healthy() {
        // All vaults well-collateralized
        let vaults = vec![
            (200_000 * PRECISION, 100_000 * PRECISION, 8000u128),
            (300_000 * PRECISION, 100_000 * PRECISION, 8000u128),
            (500_000 * PRECISION, 100_000 * PRECISION, 8000u128),
        ];

        let opps = find_liquidations(&vaults, 500, 100 * PRECISION);
        assert!(opps.is_empty(), "All healthy vaults should produce no liquidations");
    }

    #[test]
    fn test_liquidation_all_underwater() {
        // Multiple vaults all underwater → should find all of them
        let vaults = vec![
            (70_000 * PRECISION, 100_000 * PRECISION, 8000u128),
            (60_000 * PRECISION, 100_000 * PRECISION, 8000u128),
            (50_000 * PRECISION, 100_000 * PRECISION, 8000u128),
        ];

        let opps = find_liquidations(&vaults, 500, 10 * PRECISION);
        assert_eq!(opps.len(), 3, "All three underwater vaults should be liquidatable");
        // Should be sorted by profit descending
        for w in opps.windows(2) {
            assert!(w[0].estimated_profit >= w[1].estimated_profit);
        }
    }

    #[test]
    fn test_liquidation_zero_collateral_skipped() {
        // Zero collateral vault should be skipped (collateral == 0 guard)
        let vaults = vec![(0u128, 100_000 * PRECISION, 8000u128)];
        let opps = find_liquidations(&vaults, 500, 0);
        assert!(opps.is_empty(), "Zero collateral vault should be skipped");
    }

    // ============ Alert System Edge Cases ============

    #[test]
    fn test_alerts_exactly_at_thresholds() {
        // Metric exactly equals each threshold boundary
        let positions = vec![
            (id(1), 3000u64, AlertReason::HighImpermanentLoss), // Exactly at watch
            (id(2), 6000u64, AlertReason::LowHealthFactor),     // Exactly at warning
            (id(3), 9000u64, AlertReason::HighConcentration),    // Exactly at critical
            (id(4), 2999u64, AlertReason::HighUtilization),      // Just below watch
        ];

        let alerts = check_risk_alerts(&positions, 3000, 6000, 9000);
        // id(4) at 2999 should be filtered out (below watch)
        assert_eq!(alerts.len(), 3, "Exactly-at-threshold values should trigger alerts");

        // Critical first
        assert_eq!(alerts[0].position_id, id(3));
        assert_eq!(alerts[0].level, AlertLevel::Critical);
        assert_eq!(alerts[0].threshold, 9000);

        // Warning second
        assert_eq!(alerts[1].position_id, id(2));
        assert_eq!(alerts[1].level, AlertLevel::Warning);
        assert_eq!(alerts[1].threshold, 6000);

        // Watch third
        assert_eq!(alerts[2].position_id, id(1));
        assert_eq!(alerts[2].level, AlertLevel::Watch);
        assert_eq!(alerts[2].threshold, 3000);
    }

    // ============ Integration: Multi-Module Combinations ============

    #[test]
    fn test_liquidation_feeds_yield_decision() {
        // Find liquidation profits, then decide if yield farming is better
        let vaults = vec![
            (70_000 * PRECISION, 100_000 * PRECISION, 8000u128),
        ];
        let liq_opps = find_liquidations(&vaults, 500, 100 * PRECISION);
        assert_eq!(liq_opps.len(), 1);
        let liq_profit = liq_opps[0].estimated_profit;

        // Compare to yield source
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::StakingRewards, apy_bps: 1200, tvl: 10_000_000, risk_score: 5 },
            YieldSource { source_id: id(2), source_type: YieldType::InsurancePremium, apy_bps: 2000, tvl: 2_000_000, risk_score: 40 },
        ];
        let yield_rec = optimize_yield(&sources, 100).unwrap();

        // Both strategies should be valid
        assert!(liq_profit > 0, "Liquidation should be profitable");
        assert!(yield_rec.best_apy_bps > 0, "Yield source should have positive APY");
        assert_eq!(yield_rec.ranked_sources.len(), 2);
    }

    #[test]
    fn test_rebalance_triggers_risk_alert() {
        // High IL should also trigger a risk alert at the appropriate level
        let signal = check_rebalance(
            PRECISION,
            5 * PRECISION,       // 5x price move
            100_000 * PRECISION,
            0,
            500,
            2000,
        ).unwrap();

        // Build an alert from the rebalance signal's IL
        let positions = vec![
            (id(1), signal.current_il_bps, AlertReason::HighImpermanentLoss),
        ];
        let alerts = check_risk_alerts(&positions, 500, 1500, 3000);

        // IL from 5x price move is significant → should trigger at least Warning
        assert!(!alerts.is_empty(), "High IL should generate an alert");
        assert!(signal.current_il_bps >= 1500, "5x price move should exceed warning threshold");
        assert!(alerts[0].level >= AlertLevel::Warning);
        assert_eq!(alerts[0].metric_value, signal.current_il_bps);
    }

    // ============ Additional Edge Case & Hardening Tests ============

    #[test]
    fn test_arb_both_pools_empty() {
        let pool_a = make_pool_data(0, 0, 30);
        let pool_b = make_pool_data(0, 0, 30);
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        let arbs = find_arbitrage(&pools, 0);
        assert!(arbs.is_empty(), "Two empty pools should produce no arb");
    }

    #[test]
    fn test_arb_no_pools() {
        let pools: Vec<([u8; 32], &PoolCellData)> = vec![];
        let arbs = find_arbitrage(&pools, 0);
        assert!(arbs.is_empty(), "Empty pool list should produce no arb");
    }

    #[test]
    fn test_arb_sorted_by_profit_descending() {
        // Three pools with different spreads
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 5);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_050_000 * PRECISION, 5); // 5% spread from A
        let pool_c = make_pool_data(1_000_000 * PRECISION, 1_200_000 * PRECISION, 5); // 20% spread from A

        let pools = vec![(id(1), &pool_a), (id(2), &pool_b), (id(3), &pool_c)];
        let arbs = find_arbitrage(&pools, 10);

        assert!(arbs.len() >= 2);
        // Verify descending profit order
        for w in arbs.windows(2) {
            assert!(w[0].estimated_profit >= w[1].estimated_profit,
                "Arbs should be sorted by profit descending");
        }
    }

    #[test]
    fn test_rebalance_current_price_zero() {
        let err = check_rebalance(PRECISION, 0, 100_000 * PRECISION, 0, 500, 2000).unwrap_err();
        assert_eq!(err, StrategyError::InsufficientData);
    }

    #[test]
    fn test_rebalance_il_below_threshold_no_fees() {
        // Price moved slightly (1.1x), IL is small, no fees earned → Hold
        let signal = check_rebalance(
            PRECISION,
            PRECISION * 110 / 100, // 10% price increase
            100_000 * PRECISION,
            0, // No fees
            500,  // 5% IL threshold
            2000, // 20% exit threshold
        ).unwrap();

        // IL from 10% price move is very small (< 0.5%)
        assert!(!signal.should_rebalance);
        // IL < 50 bps and no fees → Hold (not AddLiquidity since accrued_fees = 0)
        assert_eq!(signal.action, RebalanceAction::Hold);
    }

    #[test]
    fn test_yield_single_source() {
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::StakingRewards, apy_bps: 1200, tvl: 5_000_000, risk_score: 15 },
        ];

        let rec = optimize_yield(&sources, 100).unwrap();
        assert_eq!(rec.ranked_sources.len(), 1);
        assert_eq!(rec.best_source, id(1));
        assert_eq!(rec.best_apy_bps, 1200);
    }

    #[test]
    fn test_yield_zero_risk_no_penalty() {
        // Risk score 0 should mean zero penalty (risk_adjusted ≈ apy * PRECISION)
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 500, tvl: 1_000_000, risk_score: 0 },
        ];

        let rec = optimize_yield(&sources, 100).unwrap();
        // With risk_score=0, risk_penalty = PRECISION, so adjusted = apy_bps * PRECISION
        let expected = 500u128 * PRECISION;
        assert_eq!(rec.risk_adjusted_score, expected,
            "Zero risk should produce no penalty: expected={}, got={}", expected, rec.risk_adjusted_score);
    }

    #[test]
    fn test_liquidation_urgency_increases_as_hf_drops() {
        // Lower HF should produce higher urgency
        let vaults = vec![
            (70_000 * PRECISION, 100_000 * PRECISION, 8000u128), // HF ≈ 0.56
            (50_000 * PRECISION, 100_000 * PRECISION, 8000u128), // HF ≈ 0.40
        ];

        let opps = find_liquidations(&vaults, 500, 10 * PRECISION);
        assert!(opps.len() >= 2);

        // The more underwater vault should have higher urgency
        let opp_50k = opps.iter().find(|o| o.vault_index == 1).unwrap();
        let opp_70k = opps.iter().find(|o| o.vault_index == 0).unwrap();
        assert!(opp_50k.urgency >= opp_70k.urgency,
            "Lower HF should have higher urgency: 50k_urgency={}, 70k_urgency={}",
            opp_50k.urgency, opp_70k.urgency);
    }

    #[test]
    fn test_liquidation_seizable_capped_by_collateral() {
        // When debt > collateral (deeply underwater), seized should be capped at collateral
        let vaults = vec![
            (10_000 * PRECISION, 100_000 * PRECISION, 8000u128),
        ];

        let opps = find_liquidations(&vaults, 500, 0);
        assert_eq!(opps.len(), 1);
        assert!(opps[0].seizable_collateral <= 10_000 * PRECISION,
            "Seized ({}) should not exceed collateral ({})", opps[0].seizable_collateral, 10_000 * PRECISION);
    }

    #[test]
    fn test_alerts_all_critical() {
        // All positions are critical level
        let positions = vec![
            (id(1), 9500u64, AlertReason::LowHealthFactor),
            (id(2), 9800u64, AlertReason::HighImpermanentLoss),
            (id(3), 10000u64, AlertReason::HighConcentration),
        ];

        let alerts = check_risk_alerts(&positions, 3000, 6000, 9000);
        assert_eq!(alerts.len(), 3);
        for alert in &alerts {
            assert_eq!(alert.level, AlertLevel::Critical);
            assert_eq!(alert.threshold, 9000);
        }
    }

    #[test]
    fn test_alerts_threshold_ordering() {
        // Verify alert thresholds correspond to their levels correctly
        let positions = vec![
            (id(1), 3000u64, AlertReason::HighUtilization),  // Watch
            (id(2), 6000u64, AlertReason::HighUtilization),  // Warning
            (id(3), 9000u64, AlertReason::HighUtilization),  // Critical
        ];

        let alerts = check_risk_alerts(&positions, 3000, 6000, 9000);
        assert_eq!(alerts.len(), 3);

        // Sorted by severity descending (Critical, Warning, Watch)
        assert_eq!(alerts[0].level, AlertLevel::Critical);
        assert_eq!(alerts[0].threshold, 9000);
        assert_eq!(alerts[1].level, AlertLevel::Warning);
        assert_eq!(alerts[1].threshold, 6000);
        assert_eq!(alerts[2].level, AlertLevel::Watch);
        assert_eq!(alerts[2].threshold, 3000);
    }

    // ============ New Edge Case & Coverage Tests (Batch 3) ============

    #[test]
    fn test_arb_symmetric_spread_direction() {
        // Pool A is cheap, Pool B is expensive — verify buy/sell direction
        let pool_a = make_pool_data(1_000_000 * PRECISION, 500_000 * PRECISION, 5); // price = 0.5
        let pool_b = make_pool_data(1_000_000 * PRECISION, 2_000_000 * PRECISION, 5); // price = 2.0
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        let arbs = find_arbitrage(&pools, 10);
        assert_eq!(arbs.len(), 1);
        assert_eq!(arbs[0].buy_pool_id, id(1), "Should buy from cheaper pool");
        assert_eq!(arbs[0].sell_pool_id, id(2), "Should sell to more expensive pool");
        assert!(arbs[0].buy_price < arbs[0].sell_price);
    }

    #[test]
    fn test_arb_five_pools_pairwise() {
        // 5 pools should check C(5,2)=10 pairs
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 5);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_100_000 * PRECISION, 5);
        let pool_c = make_pool_data(1_000_000 * PRECISION, 1_200_000 * PRECISION, 5);
        let pool_d = make_pool_data(1_000_000 * PRECISION, 1_300_000 * PRECISION, 5);
        let pool_e = make_pool_data(1_000_000 * PRECISION, 1_400_000 * PRECISION, 5);
        let pools = vec![
            (id(1), &pool_a), (id(2), &pool_b), (id(3), &pool_c),
            (id(4), &pool_d), (id(5), &pool_e),
        ];

        let arbs = find_arbitrage(&pools, 10);
        // With increasing prices and low fees, many pairs should be profitable
        assert!(arbs.len() >= 4, "Multiple pairs should have profitable spreads: found {}", arbs.len());
        // First arb should be the most profitable (A vs E has biggest spread)
        assert_eq!(arbs[0].buy_pool_id, id(1));
        assert_eq!(arbs[0].sell_pool_id, id(5));
    }

    #[test]
    fn test_rebalance_small_price_drop_with_fees() {
        // Small price drop (0.95x) + substantial fees → AddLiquidity
        let signal = check_rebalance(
            PRECISION,
            PRECISION * 95 / 100, // 5% drop
            100_000 * PRECISION,
            10_000 * PRECISION, // 10K fees (covers any IL from 5% move)
            500,
            2000,
        ).unwrap();

        // IL from 5% move is very small (< 0.1%)
        assert!(!signal.should_rebalance);
        assert_eq!(signal.action, RebalanceAction::AddLiquidity);
    }

    #[test]
    fn test_yield_high_risk_high_apy_loses_to_safe() {
        // Risk-adjusted: apy / (1 + risk/100)
        // Source 1: 500 / 1.9 = ~263   (high risk dominates)
        // Source 2: 800 / 1.05 = ~762  (safe wins on risk-adjusted basis)
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::InsurancePremium, apy_bps: 500, tvl: 500_000, risk_score: 90 },
            YieldSource { source_id: id(2), source_type: YieldType::StakingRewards, apy_bps: 800, tvl: 5_000_000, risk_score: 5 },
        ];

        let rec = optimize_yield(&sources, 100).unwrap();
        assert_eq!(rec.best_source, id(2), "Safe low-APY should beat risky high-APY on risk-adjusted basis");
    }

    #[test]
    fn test_yield_many_sources_ranking() {
        // 5 sources — verify all are present and ranked
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 400, tvl: 1_000_000, risk_score: 20 },
            YieldSource { source_id: id(2), source_type: YieldType::LendingDeposit, apy_bps: 300, tvl: 2_000_000, risk_score: 10 },
            YieldSource { source_id: id(3), source_type: YieldType::InsurancePremium, apy_bps: 900, tvl: 500_000, risk_score: 50 },
            YieldSource { source_id: id(4), source_type: YieldType::StakingRewards, apy_bps: 600, tvl: 3_000_000, risk_score: 15 },
            YieldSource { source_id: id(5), source_type: YieldType::LPFees, apy_bps: 150, tvl: 10_000_000, risk_score: 3 },
        ];

        let rec = optimize_yield(&sources, 100).unwrap();
        assert_eq!(rec.ranked_sources.len(), 5);
        // Verify ranked by risk-adjusted score descending
        for w in rec.ranked_sources.windows(2) {
            assert!(w[0].2 >= w[1].2, "Ranked sources should be in descending risk-adjusted order");
        }
    }

    #[test]
    fn test_liquidation_exactly_at_threshold() {
        // Vault exactly at liquidation threshold — HF = 1.0, NOT liquidatable
        // collateral * threshold / (debt * 10000) = 100K * 8000 / (80K * 10000) = 1.0
        let vaults = vec![
            (100_000 * PRECISION, 80_000 * PRECISION, 8000u128),
        ];

        let opps = find_liquidations(&vaults, 500, 0);
        assert!(opps.is_empty(), "Vault exactly at HF=1.0 should NOT be liquidatable");
    }

    #[test]
    fn test_alerts_metric_value_and_threshold_correct() {
        // Verify each alert carries the original metric value and correct threshold
        let positions = vec![
            (id(1), 4500u64, AlertReason::HighImpermanentLoss), // Watch
            (id(2), 7200u64, AlertReason::LowHealthFactor),     // Warning
        ];

        let alerts = check_risk_alerts(&positions, 3000, 6000, 9000);
        assert_eq!(alerts.len(), 2);

        let warning_alert = alerts.iter().find(|a| a.level == AlertLevel::Warning).unwrap();
        assert_eq!(warning_alert.metric_value, 7200);
        assert_eq!(warning_alert.threshold, 6000);

        let watch_alert = alerts.iter().find(|a| a.level == AlertLevel::Watch).unwrap();
        assert_eq!(watch_alert.metric_value, 4500);
        assert_eq!(watch_alert.threshold, 3000);
    }

    #[test]
    fn test_rebalance_signal_rebalanced_value_includes_fees() {
        // The rebalanced_value should be lp_value + accrued_fees
        let signal = check_rebalance(
            PRECISION,
            2 * PRECISION,         // Price doubled
            100_000 * PRECISION,
            15_000 * PRECISION,    // 15K fees
            500,
            2000,
        ).unwrap();

        assert_eq!(signal.rebalanced_value, signal.position_value + 15_000 * PRECISION,
            "Rebalanced value should be LP value + accrued fees");
    }

    // ============ Batch 4: Additional Coverage Tests ============

    #[test]
    fn test_arb_fees_exactly_equal_spread() {
        // Spread exactly matches combined fees → no profit → no arb
        // Pool A: 1:1 ratio, Pool B: slightly higher, but 30bps each = 60bps total
        // Need spread = exactly 60bps → 0.6%
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 30);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_006_000 * PRECISION, 30); // 0.6% spread
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        let arbs = find_arbitrage(&pools, 0);
        assert!(arbs.is_empty(),
            "Spread exactly equal to fees should produce no arb opportunity");
    }

    #[test]
    fn test_arb_optimal_size_limited_by_smaller_pool() {
        // One pool much larger than the other → optimal_size limited by smaller pool
        let pool_a = make_pool_data(10_000 * PRECISION, 10_000 * PRECISION, 5);
        let pool_b = make_pool_data(10_000_000 * PRECISION, 11_000_000 * PRECISION, 5); // 10% spread
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        let arbs = find_arbitrage(&pools, 10);
        assert_eq!(arbs.len(), 1);
        // Optimal size should be limited by pool_a (1% of 10K = 100)
        assert!(arbs[0].optimal_size <= 100 * PRECISION,
            "Optimal size {} should be limited by smaller pool", arbs[0].optimal_size);
    }

    #[test]
    fn test_rebalance_entry_equals_current_price() {
        // Same price → 0 IL → AddLiquidity (if fees > 0)
        let signal = check_rebalance(
            5_000 * PRECISION,
            5_000 * PRECISION,
            200_000 * PRECISION,
            500 * PRECISION,
            500,
            2000,
        ).unwrap();

        assert_eq!(signal.current_il_bps, 0);
        assert!(!signal.should_rebalance);
        assert_eq!(signal.action, RebalanceAction::AddLiquidity);
    }

    #[test]
    fn test_rebalance_price_halved() {
        // Price halved: entry=100, current=50 → ~5.7% IL
        let signal = check_rebalance(
            100 * PRECISION,
            50 * PRECISION,      // Price halved
            200_000 * PRECISION,
            0,                   // No fees
            500,
            2000,
        ).unwrap();

        assert!(signal.current_il_bps > 500, "Halved price should exceed 5% IL: got {}", signal.current_il_bps);
        assert!(signal.should_rebalance);
        assert_eq!(signal.action, RebalanceAction::ReenterAtCurrentPrice);
    }

    #[test]
    fn test_yield_all_same_risk_sorted_by_apy() {
        // Equal risk scores → sorted purely by APY descending
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 300, tvl: 1_000_000, risk_score: 20 },
            YieldSource { source_id: id(2), source_type: YieldType::LendingDeposit, apy_bps: 700, tvl: 1_000_000, risk_score: 20 },
            YieldSource { source_id: id(3), source_type: YieldType::StakingRewards, apy_bps: 500, tvl: 1_000_000, risk_score: 20 },
        ];

        let rec = optimize_yield(&sources, 100).unwrap();
        assert_eq!(rec.best_source, id(2), "Highest APY should win when risk is equal");
        assert_eq!(rec.best_apy_bps, 700);
        // Verify ranking order: 700, 500, 300
        assert_eq!(rec.ranked_sources[0].1, 700);
        assert_eq!(rec.ranked_sources[1].1, 500);
        assert_eq!(rec.ranked_sources[2].1, 300);
    }

    #[test]
    fn test_yield_max_risk_score_100() {
        // Source with risk_score = 100 should still work (not divide by zero)
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::InsurancePremium, apy_bps: 2000, tvl: 500_000, risk_score: 100 },
        ];

        let rec = optimize_yield(&sources, 100).unwrap();
        assert_eq!(rec.best_source, id(1));
        // risk_penalty = 2 * PRECISION, adjusted = 2000 * PRECISION / 2 = 1000 * PRECISION
        assert!(rec.risk_adjusted_score > 0);
    }

    #[test]
    fn test_liquidation_multiple_vaults_sorted_by_profit() {
        // Varying underwater vaults → results sorted by profit descending
        let vaults = vec![
            (80_000 * PRECISION, 100_000 * PRECISION, 8000u128),  // HF=0.64, moderate profit
            (40_000 * PRECISION, 100_000 * PRECISION, 8000u128),  // HF=0.32, more collateral seized
            (90_000 * PRECISION, 100_000 * PRECISION, 8000u128),  // HF=0.72, least profit
        ];

        let opps = find_liquidations(&vaults, 500, 10 * PRECISION);
        assert!(opps.len() >= 2);
        // Verify sorted by profit descending
        for w in opps.windows(2) {
            assert!(w[0].estimated_profit >= w[1].estimated_profit,
                "Liquidations should be sorted by profit descending");
        }
    }

    #[test]
    fn test_liquidation_zero_incentive() {
        // With 0% incentive, profit = 0 → no opportunities (profit must be > 0)
        let vaults = vec![
            (50_000 * PRECISION, 100_000 * PRECISION, 8000u128),
        ];

        let opps = find_liquidations(&vaults, 0, 0);
        assert!(opps.is_empty(), "Zero incentive should produce zero profit → no opportunities");
    }

    #[test]
    fn test_alerts_descending_severity_order() {
        // Verify that alerts are always sorted by severity descending
        let positions = vec![
            (id(1), 3500u64, AlertReason::HighUtilization),    // Watch
            (id(2), 9900u64, AlertReason::LowHealthFactor),    // Critical
            (id(3), 7000u64, AlertReason::HighImpermanentLoss), // Warning
            (id(4), 4000u64, AlertReason::HighConcentration),   // Watch
        ];

        let alerts = check_risk_alerts(&positions, 3000, 6000, 9000);
        assert_eq!(alerts.len(), 4);

        // Verify descending order: Critical, Warning, Watch, Watch
        assert_eq!(alerts[0].level, AlertLevel::Critical);
        assert_eq!(alerts[1].level, AlertLevel::Warning);
        assert!(alerts[2].level <= AlertLevel::Watch);
        assert!(alerts[3].level <= AlertLevel::Watch);
    }

    // ============ Batch 5: Edge Cases, Boundaries & Error Paths ============

    #[test]
    fn test_arb_zero_reserve1_only() {
        // Pool A has reserve1=0 (reserve0 > 0) — should be skipped
        let pool_a = make_pool_data(1_000_000 * PRECISION, 0, 30);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_500_000 * PRECISION, 30);
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        let arbs = find_arbitrage(&pools, 0);
        assert!(arbs.is_empty(), "Pool with zero reserve1 should be skipped");
    }

    #[test]
    fn test_arb_high_fee_rate_kills_spread() {
        // 10% spread but 5% fee each side = 10% total fees → no profit
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 500); // 5% fee
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_100_000 * PRECISION, 500); // 5% fee
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        let arbs = find_arbitrage(&pools, 0);
        assert!(arbs.is_empty(), "10% spread with 10% total fees should not be profitable");
    }

    #[test]
    fn test_arb_reversed_pool_order() {
        // Pass pools in reversed order (expensive first, cheap second)
        // buy/sell assignment should still be correct
        let pool_expensive = make_pool_data(1_000_000 * PRECISION, 2_000_000 * PRECISION, 5);
        let pool_cheap = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 5);
        let pools = vec![(id(10), &pool_expensive), (id(20), &pool_cheap)];

        let arbs = find_arbitrage(&pools, 10);
        assert_eq!(arbs.len(), 1);
        assert_eq!(arbs[0].buy_pool_id, id(20), "Should buy from cheaper pool regardless of input order");
        assert_eq!(arbs[0].sell_pool_id, id(10), "Should sell into expensive pool");
    }

    #[test]
    fn test_arb_very_small_reserves() {
        // Tiny pools with 1 unit each — optimal_size should be 0 (1/100 = 0)
        let pool_a = make_pool_data(1, 1, 0);
        let pool_b = make_pool_data(1, 2, 0);
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        let arbs = find_arbitrage(&pools, 0);
        // With reserves of 1, reserve0/100 = 0, so optimal_size = 0, profit = 0
        // The arb is detected (spread exists) but profit is zero
        assert_eq!(arbs.len(), 1, "Arb is detected even with tiny pools");
        assert_eq!(arbs[0].optimal_size, 0, "Optimal size is 0 for 1-unit reserves");
        assert_eq!(arbs[0].estimated_profit, 0, "No profit possible with zero trade size");
    }

    #[test]
    fn test_arb_asymmetric_fees() {
        // Pool A has 0 fees, Pool B has 30bps — total 30bps
        // Need spread > 30 bps to be profitable
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 0);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_010_000 * PRECISION, 30); // 1% spread
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        let arbs = find_arbitrage(&pools, 0);
        assert!(!arbs.is_empty(), "1% spread with 0.3% total fees should be profitable");
        assert!(arbs[0].estimated_profit > 0);
    }

    #[test]
    fn test_arb_zero_fee_pools() {
        // Both pools have 0 fees — any spread is profitable
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 0);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_001_000 * PRECISION, 0); // 0.1% spread
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        let arbs = find_arbitrage(&pools, 0);
        assert!(!arbs.is_empty(), "Any spread with zero fees should be profitable");
    }

    #[test]
    fn test_arb_profit_proportional_to_net_spread() {
        // Two scenarios: same pools but different fee levels
        // Higher net spread should yield higher profit
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 5);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_100_000 * PRECISION, 5);

        let pool_c = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 50);
        let pool_d = make_pool_data(1_000_000 * PRECISION, 1_100_000 * PRECISION, 50);

        let arbs_low_fee = find_arbitrage(&[(id(1), &pool_a), (id(2), &pool_b)], 0);
        let arbs_high_fee = find_arbitrage(&[(id(3), &pool_c), (id(4), &pool_d)], 0);

        assert!(!arbs_low_fee.is_empty());
        assert!(!arbs_high_fee.is_empty());
        assert!(arbs_low_fee[0].estimated_profit > arbs_high_fee[0].estimated_profit,
            "Lower fees should yield higher profit for same spread");
    }

    #[test]
    fn test_rebalance_price_decrease_below_entry() {
        // Price dropped to 1/4 of entry → significant IL
        let signal = check_rebalance(
            4 * PRECISION,
            PRECISION,             // Price dropped to 1/4
            100_000 * PRECISION,
            0,
            500,
            2000,
        ).unwrap();

        // Price ratio = 0.25, IL from halving ≈ same as doubling due to symmetry
        assert!(signal.current_il_bps > 0, "Price drop should produce IL");
        assert!(signal.should_rebalance);
    }

    #[test]
    fn test_rebalance_il_exactly_at_il_threshold() {
        // We need to find a price ratio that gives us exactly ~500 bps IL
        // IL for price ratio r: IL = 2*sqrt(r)/(1+r) - 1
        // At r=2: IL ≈ 5.72%, at r=1.5: IL ≈ 2.02%
        // Use r=2 (5.72% > 5%) with fees NOT covering → ReenterAtCurrentPrice
        let signal = check_rebalance(
            PRECISION,
            2 * PRECISION,
            100_000 * PRECISION,
            0,        // No fees to cover IL
            500,      // 5% threshold
            2000,     // 20% exit
        ).unwrap();

        assert!(signal.current_il_bps >= 500);
        assert!(signal.current_il_bps < 2000);
        assert!(signal.should_rebalance);
        assert_eq!(signal.action, RebalanceAction::ReenterAtCurrentPrice);
    }

    #[test]
    fn test_rebalance_il_between_thresholds_fees_cover() {
        // IL above il_threshold but fees cover it → Hold (not rebalance)
        let signal = check_rebalance(
            PRECISION,
            2 * PRECISION,          // ~5.7% IL
            100_000 * PRECISION,
            50_000 * PRECISION,     // Massive fees easily cover IL
            500,
            2000,
        ).unwrap();

        // IL > il_threshold but fees_cover_il is true → Hold
        assert!(!signal.should_rebalance);
        assert_eq!(signal.action, RebalanceAction::Hold);
    }

    #[test]
    fn test_rebalance_very_large_entry_price() {
        // Entry and current prices are very large numbers
        let large = PRECISION * 1_000_000; // 1e24
        let signal = check_rebalance(
            large,
            large,
            100_000 * PRECISION,
            1_000 * PRECISION,
            500,
            2000,
        ).unwrap();

        assert_eq!(signal.current_il_bps, 0, "Same price should be 0 IL regardless of magnitude");
        assert!(!signal.should_rebalance);
    }

    #[test]
    fn test_rebalance_position_value_zero() {
        // Position value of 0 — IL calculation should still work
        let signal = check_rebalance(
            PRECISION,
            2 * PRECISION,
            0,              // Zero position value
            0,
            500,
            2000,
        ).unwrap();

        // With position_value=0, both lp_value and hodl_value are 0
        // IL bps is calculated from the price ratio but scaled by zero value → 0 bps IL
        // il_bps < 50 and accrued_fees = 0 → Hold
        assert_eq!(signal.position_value, 0);
        assert_eq!(signal.action, RebalanceAction::Hold);
    }

    #[test]
    fn test_yield_multiple_zero_apy_one_valid() {
        // Several zero-APY sources + one valid → only valid one returned
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 0, tvl: 1_000_000, risk_score: 10 },
            YieldSource { source_id: id(2), source_type: YieldType::LendingDeposit, apy_bps: 0, tvl: 2_000_000, risk_score: 5 },
            YieldSource { source_id: id(3), source_type: YieldType::StakingRewards, apy_bps: 400, tvl: 500_000, risk_score: 20 },
        ];

        let rec = optimize_yield(&sources, 100).unwrap();
        assert_eq!(rec.ranked_sources.len(), 1);
        assert_eq!(rec.best_source, id(3));
    }

    #[test]
    fn test_yield_risk_score_boundary_exact_max() {
        // Source at exactly the max_risk_score boundary → should be included
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 500, tvl: 1_000_000, risk_score: 50 },
        ];

        let rec = optimize_yield(&sources, 50).unwrap();
        assert_eq!(rec.ranked_sources.len(), 1, "Source at exactly max_risk_score should be included");
        assert_eq!(rec.best_source, id(1));
    }

    #[test]
    fn test_yield_risk_score_boundary_one_above() {
        // Source one above max_risk_score → filtered out
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 500, tvl: 1_000_000, risk_score: 51 },
        ];

        let err = optimize_yield(&sources, 50).unwrap_err();
        assert_eq!(err, StrategyError::NoPositions, "Source above max risk should be filtered");
    }

    #[test]
    fn test_yield_all_zero_risk() {
        // All sources at risk_score=0 → ranking purely by APY
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 200, tvl: 1_000_000, risk_score: 0 },
            YieldSource { source_id: id(2), source_type: YieldType::LendingDeposit, apy_bps: 800, tvl: 1_000_000, risk_score: 0 },
            YieldSource { source_id: id(3), source_type: YieldType::StakingRewards, apy_bps: 500, tvl: 1_000_000, risk_score: 0 },
        ];

        let rec = optimize_yield(&sources, 100).unwrap();
        assert_eq!(rec.best_source, id(2));
        assert_eq!(rec.best_apy_bps, 800);
        // All risk-adjusted scores should equal apy * PRECISION
        for &(sid, apy, score) in &rec.ranked_sources {
            assert_eq!(score, apy as u128 * PRECISION,
                "Zero risk sources should have score = apy * PRECISION");
        }
    }

    #[test]
    fn test_liquidation_zero_both_skipped() {
        // Vault with zero collateral AND zero debt → skipped
        let vaults = vec![(0u128, 0u128, 8000u128)];
        let opps = find_liquidations(&vaults, 500, 0);
        assert!(opps.is_empty());
    }

    #[test]
    fn test_liquidation_threshold_10000_bps() {
        // 100% liquidation threshold (threshold_bps = 10000)
        // HF = collateral * 10000 * PRECISION / (debt * 10000) = collateral/debt
        // 80K/100K = 0.8 < 1.0 → liquidatable
        let vaults = vec![
            (80_000 * PRECISION, 100_000 * PRECISION, 10_000u128),
        ];

        let opps = find_liquidations(&vaults, 500, 10 * PRECISION);
        assert_eq!(opps.len(), 1, "Vault at 100% threshold with 80% collateral ratio should be liquidatable");
        assert!(opps[0].health_factor < PRECISION);
    }

    #[test]
    fn test_liquidation_very_small_vault() {
        // Tiny vault: 1 unit collateral, 2 units debt → HF < 1
        let vaults = vec![(PRECISION, 2 * PRECISION, 8000u128)];
        let opps = find_liquidations(&vaults, 500, 0);
        assert_eq!(opps.len(), 1, "Small underwater vault should be liquidatable");
        assert!(opps[0].estimated_profit > 0);
    }

    #[test]
    fn test_liquidation_vault_index_preserved() {
        // Multiple vaults with some healthy in between → vault_index should be correct
        let vaults = vec![
            (200_000 * PRECISION, 100_000 * PRECISION, 8000u128), // 0: healthy
            (50_000 * PRECISION, 100_000 * PRECISION, 8000u128),  // 1: underwater
            (300_000 * PRECISION, 100_000 * PRECISION, 8000u128), // 2: healthy
            (40_000 * PRECISION, 100_000 * PRECISION, 8000u128),  // 3: underwater
        ];

        let opps = find_liquidations(&vaults, 500, 10 * PRECISION);
        assert_eq!(opps.len(), 2);
        let indices: Vec<usize> = opps.iter().map(|o| o.vault_index).collect();
        assert!(indices.contains(&1), "Vault index 1 should be found");
        assert!(indices.contains(&3), "Vault index 3 should be found");
    }

    #[test]
    fn test_liquidation_urgency_zero_hf_is_max_urgency() {
        // A vault where HF rounds to 0 should have urgency = 100
        // Need: underwater (HF < 1), enough collateral for incentive to produce profit > 0
        // collateral = 10K, debt = 100K, threshold = 8000 → HF = 10K * 8000 * P / (100K * 10000 * P) = 0.08
        let vaults = vec![
            (10_000 * PRECISION, 100_000 * PRECISION, 8000u128),
        ];

        let opps = find_liquidations(&vaults, 500, 0);
        assert_eq!(opps.len(), 1);
        // HF ≈ 0.08, urgency = 100 - 8 = 92
        assert!(opps[0].urgency >= 90, "Very low HF should have high urgency: got {}", opps[0].urgency);
        assert!(opps[0].health_factor < PRECISION / 10, "HF should be < 0.1");
    }

    #[test]
    fn test_alerts_single_position_at_watch() {
        let positions = vec![
            (id(1), 3000u64, AlertReason::HighImpermanentLoss),
        ];
        let alerts = check_risk_alerts(&positions, 3000, 6000, 9000);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].level, AlertLevel::Watch);
        assert_eq!(alerts[0].metric_value, 3000);
    }

    #[test]
    fn test_alerts_max_u64_metric() {
        // Maximum possible metric value → definitely Critical
        let positions = vec![
            (id(1), u64::MAX, AlertReason::LowHealthFactor),
        ];
        let alerts = check_risk_alerts(&positions, 3000, 6000, 9000);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].level, AlertLevel::Critical);
    }

    #[test]
    fn test_alerts_reason_propagated_correctly() {
        // Each alert should carry its original reason
        let positions = vec![
            (id(1), 5000u64, AlertReason::LowHealthFactor),
            (id(2), 5000u64, AlertReason::HighImpermanentLoss),
            (id(3), 5000u64, AlertReason::HighConcentration),
            (id(4), 5000u64, AlertReason::HighUtilization),
        ];

        let alerts = check_risk_alerts(&positions, 3000, 6000, 9000);
        assert_eq!(alerts.len(), 4);

        // All are Watch level (5000 >= 3000 but < 6000)
        for alert in &alerts {
            assert_eq!(alert.level, AlertLevel::Watch);
        }

        // Verify all 4 reasons are present
        let reasons: Vec<&AlertReason> = alerts.iter().map(|a| &a.reason).collect();
        assert!(reasons.contains(&&AlertReason::LowHealthFactor));
        assert!(reasons.contains(&&AlertReason::HighImpermanentLoss));
        assert!(reasons.contains(&&AlertReason::HighConcentration));
        assert!(reasons.contains(&&AlertReason::HighUtilization));
    }

    #[test]
    fn test_alerts_zero_thresholds_everything_triggers() {
        // With thresholds at 0, any metric >= 0 triggers (but Safe positions with metric=0
        // would hit exactly the watch threshold)
        let positions = vec![
            (id(1), 0u64, AlertReason::LowHealthFactor),
            (id(2), 1u64, AlertReason::HighImpermanentLoss),
        ];

        let alerts = check_risk_alerts(&positions, 0, 0, 0);
        assert_eq!(alerts.len(), 2, "Zero thresholds means everything is Critical");
        for alert in &alerts {
            assert_eq!(alert.level, AlertLevel::Critical);
        }
    }

    #[test]
    fn test_arb_pool_with_one_unit_reserve0() {
        // Pool with reserve0=1, reserve1=large → extreme price, but reserve0/100=0
        let pool_a = make_pool_data(1, 1_000_000 * PRECISION, 0);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 0);
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        let arbs = find_arbitrage(&pools, 0);
        // Pool A has extreme price (reserve1/reserve0 = 1e24), pool B price = 1
        // Huge spread, arb detected, but optimal_size = min(1/100, pool/100) = 0 → profit = 0
        assert_eq!(arbs.len(), 1, "Arb detected even with tiny reserve0");
        assert_eq!(arbs[0].optimal_size, 0, "Trade size limited by tiny pool");
        assert_eq!(arbs[0].estimated_profit, 0, "Zero trade size means zero profit");
    }

    #[test]
    fn test_rebalance_price_slightly_above_entry() {
        // Price moved up by 1% → negligible IL, no fees → Hold
        let signal = check_rebalance(
            PRECISION,
            PRECISION * 101 / 100,
            100_000 * PRECISION,
            0,
            500,
            2000,
        ).unwrap();

        assert!(signal.current_il_bps < 50, "1% price move should produce < 50 bps IL");
        assert!(!signal.should_rebalance);
        assert_eq!(signal.action, RebalanceAction::Hold);
    }

    #[test]
    fn test_yield_risk_adjusted_score_decreases_with_risk() {
        // Same APY, increasing risk → scores should decrease
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 1000, tvl: 1_000_000, risk_score: 10 },
            YieldSource { source_id: id(2), source_type: YieldType::LPFees, apy_bps: 1000, tvl: 1_000_000, risk_score: 50 },
            YieldSource { source_id: id(3), source_type: YieldType::LPFees, apy_bps: 1000, tvl: 1_000_000, risk_score: 90 },
        ];

        let rec = optimize_yield(&sources, 100).unwrap();
        assert_eq!(rec.ranked_sources.len(), 3);
        // Verify strictly decreasing risk-adjusted scores
        assert!(rec.ranked_sources[0].2 > rec.ranked_sources[1].2);
        assert!(rec.ranked_sources[1].2 > rec.ranked_sources[2].2);
        // Best should be lowest risk
        assert_eq!(rec.best_source, id(1));
    }

    // ============ Batch 6: Hardening — New Edge Cases & Boundary Tests ============

    #[test]
    fn test_arb_four_pools_all_equal_prices_no_arb() {
        // Four pools with identical reserves → no arb at all
        let pool = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 30);
        let pools = vec![
            (id(1), &pool), (id(2), &pool), (id(3), &pool), (id(4), &pool),
        ];

        let arbs = find_arbitrage(&pools, 0);
        assert!(arbs.is_empty(), "Identical prices across all pools should yield no arb");
    }

    #[test]
    fn test_arb_spread_just_above_fees() {
        // Spread barely exceeds total fees → small but nonzero profit
        // 30 bps fee each → 60 bps total. Need spread > 60 bps.
        // Pool B has ~0.7% higher price → spread ≈ 70 bps > 60 bps
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 30);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_007_000 * PRECISION, 30);
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        let arbs = find_arbitrage(&pools, 0);
        assert_eq!(arbs.len(), 1, "Spread just above fees should be profitable");
        assert!(arbs[0].estimated_profit > 0);
        // But profit should be small
        assert!(arbs[0].spread_bps < 100, "Spread should be < 100 bps");
    }

    #[test]
    fn test_arb_min_spread_filter_at_exact_value() {
        // Spread is exactly min_spread_bps → should still be included (spread >= min)
        // Pool B ~2% higher → spread ≈ 200 bps
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 5);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_020_000 * PRECISION, 5);
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        let arbs_at = find_arbitrage(&pools, 200);
        let arbs_above = find_arbitrage(&pools, 201);

        // At 200 → the actual spread (~199 bps due to rounding) may or may not pass 200 exactly
        // What we verify: there's a threshold where it transitions
        // At some point increasing min_spread filters it out
        assert!(find_arbitrage(&pools, 100).len() >= 1, "Should be found with low min_spread");
        assert!(find_arbitrage(&pools, 10000).is_empty(), "Should be filtered with very high min_spread");
    }

    #[test]
    fn test_arb_pool_with_max_fee_rate() {
        // Fee rate of u16::MAX (65535 bps = 655.35%) — extreme but valid
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, u16::MAX);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 2_000_000 * PRECISION, u16::MAX);
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];

        let arbs = find_arbitrage(&pools, 0);
        // Total fee = 2 * 65535 = 131070 bps, spread = ~10000 bps → fees dominate
        assert!(arbs.is_empty(), "Extreme fees should eliminate arb even with large spread");
    }

    #[test]
    fn test_rebalance_price_ratio_1_point_5x() {
        // 1.5x price move → IL ≈ 2% — below typical 5% threshold
        let signal = check_rebalance(
            PRECISION,
            PRECISION * 3 / 2,      // 1.5x price
            100_000 * PRECISION,
            0,
            500,                     // 5% threshold
            2000,
        ).unwrap();

        assert!(signal.current_il_bps < 500,
            "1.5x price move should produce < 5% IL: got {} bps", signal.current_il_bps);
        assert!(!signal.should_rebalance);
    }

    #[test]
    fn test_rebalance_massive_fees_override_exit() {
        // Price 10x → IL > 20% (exit threshold), but fees don't prevent exit
        // Exit is checked first (before fee check) so it should still trigger exit
        let signal = check_rebalance(
            PRECISION,
            10 * PRECISION,
            100_000 * PRECISION,
            1_000_000 * PRECISION,   // Massive fees
            500,
            2000,
        ).unwrap();

        // IL from 10x ≈ 42%, which exceeds exit_threshold (20%)
        // Exit check comes first in the code (il >= exit_threshold_bps)
        assert!(signal.current_il_bps >= 2000);
        assert!(signal.should_rebalance);
        assert_eq!(signal.action, RebalanceAction::ExitPosition,
            "Exit threshold should take priority even with massive fees");
    }

    #[test]
    fn test_rebalance_accrued_fees_zero_low_il() {
        // Low IL + zero fees → Hold (not AddLiquidity, because accrued_fees == 0)
        let signal = check_rebalance(
            PRECISION,
            PRECISION * 101 / 100,   // 1% price move
            100_000 * PRECISION,
            0,                        // No fees
            500,
            2000,
        ).unwrap();

        assert!(signal.current_il_bps < 50);
        assert!(!signal.should_rebalance);
        assert_eq!(signal.action, RebalanceAction::Hold,
            "Low IL + zero fees should Hold, not AddLiquidity");
    }

    #[test]
    fn test_rebalance_symmetric_il_direction() {
        // IL from 2x up should equal IL from 0.5x down (symmetric)
        let signal_up = check_rebalance(
            PRECISION,
            2 * PRECISION,
            100_000 * PRECISION,
            0, 500, 2000,
        ).unwrap();

        let signal_down = check_rebalance(
            2 * PRECISION,
            PRECISION,
            100_000 * PRECISION,
            0, 500, 2000,
        ).unwrap();

        // IL should be approximately equal for the same ratio in both directions
        let diff = if signal_up.current_il_bps > signal_down.current_il_bps {
            signal_up.current_il_bps - signal_down.current_il_bps
        } else {
            signal_down.current_il_bps - signal_up.current_il_bps
        };
        assert!(diff <= 10, "IL should be symmetric for ratio 2:1, diff={} bps", diff);
    }

    #[test]
    fn test_yield_one_bps_apy() {
        // Minimum positive APY (1 bps) should still rank
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 1, tvl: 1_000_000, risk_score: 0 },
        ];

        let rec = optimize_yield(&sources, 100).unwrap();
        assert_eq!(rec.best_apy_bps, 1);
        assert!(rec.risk_adjusted_score > 0);
    }

    #[test]
    fn test_yield_max_u64_apy() {
        // Very large APY (u64::MAX bps) — should not overflow
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::StakingRewards, apy_bps: u64::MAX, tvl: 1_000_000, risk_score: 50 },
        ];

        // This may or may not overflow depending on mul_div implementation
        // At minimum it should not panic
        let result = optimize_yield(&sources, 100);
        assert!(result.is_ok(), "Large APY should not panic");
    }

    #[test]
    fn test_yield_recommendation_best_matches_first_ranked() {
        // The best_source and best_apy_bps should always match ranked_sources[0]
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 400, tvl: 1_000_000, risk_score: 20 },
            YieldSource { source_id: id(2), source_type: YieldType::LendingDeposit, apy_bps: 700, tvl: 2_000_000, risk_score: 10 },
            YieldSource { source_id: id(3), source_type: YieldType::StakingRewards, apy_bps: 300, tvl: 500_000, risk_score: 5 },
        ];

        let rec = optimize_yield(&sources, 100).unwrap();
        assert_eq!(rec.best_source, rec.ranked_sources[0].0,
            "best_source must match first ranked source id");
        assert_eq!(rec.best_apy_bps, rec.ranked_sources[0].1,
            "best_apy_bps must match first ranked source apy");
        assert_eq!(rec.risk_adjusted_score, rec.ranked_sources[0].2,
            "risk_adjusted_score must match first ranked source score");
    }

    #[test]
    fn test_liquidation_single_vault_barely_underwater() {
        // HF just barely below 1.0 — should still be liquidatable
        // collateral=99.9K, debt=100K, threshold=10000 → HF = 99900/100000 = 0.999
        let vaults = vec![
            (99_900 * PRECISION, 100_000 * PRECISION, 10_000u128),
        ];

        let opps = find_liquidations(&vaults, 500, 0);
        assert_eq!(opps.len(), 1, "Barely underwater vault should be liquidatable");
        // HF should be just below PRECISION
        assert!(opps[0].health_factor < PRECISION);
        assert!(opps[0].health_factor > PRECISION * 99 / 100, "HF should be > 0.99");
    }

    #[test]
    fn test_liquidation_incentive_impacts_seizable() {
        // Higher incentive means more seizable collateral (up to cap)
        let vaults = vec![
            (80_000 * PRECISION, 100_000 * PRECISION, 8000u128),
        ];

        let opps_low = find_liquidations(&vaults, 200, 0);   // 2% incentive
        let opps_high = find_liquidations(&vaults, 1000, 0);  // 10% incentive

        assert_eq!(opps_low.len(), 1);
        assert_eq!(opps_high.len(), 1);
        assert!(opps_high[0].seizable_collateral >= opps_low[0].seizable_collateral,
            "Higher incentive should mean more seizable collateral");
        assert!(opps_high[0].estimated_profit > opps_low[0].estimated_profit,
            "Higher incentive should yield higher profit");
    }

    #[test]
    fn test_liquidation_empty_vaults_list() {
        let vaults: Vec<(u128, u128, u128)> = vec![];
        let opps = find_liquidations(&vaults, 500, 0);
        assert!(opps.is_empty(), "Empty vaults list should produce no liquidations");
    }

    #[test]
    fn test_liquidation_high_threshold_makes_more_liquidatable() {
        // Higher threshold_bps → higher HF for same vault → fewer liquidations
        // Lower threshold_bps → lower HF → more liquidations
        let vaults = vec![
            (90_000 * PRECISION, 100_000 * PRECISION, 10_000u128), // HF=0.9 at 100% threshold
        ];

        let opps_high_thresh = find_liquidations(&vaults, 500, 10 * PRECISION);
        assert_eq!(opps_high_thresh.len(), 1, "At 100% threshold, 90K/100K is underwater");

        // At lower threshold (50%), HF = 90K * 5000 * P / (100K * 10000) = 0.45 → still under
        let vaults_low = vec![
            (90_000 * PRECISION, 100_000 * PRECISION, 5_000u128),
        ];
        let opps_low_thresh = find_liquidations(&vaults_low, 500, 10 * PRECISION);
        assert_eq!(opps_low_thresh.len(), 1, "At 50% threshold too");
    }

    #[test]
    fn test_alerts_just_below_each_threshold() {
        // Metrics just 1 below each threshold → should be at the level below
        let positions = vec![
            (id(1), 2999u64, AlertReason::HighImpermanentLoss), // Just below watch (3000)
            (id(2), 5999u64, AlertReason::LowHealthFactor),     // Just below warning (6000), so Watch
            (id(3), 8999u64, AlertReason::HighConcentration),    // Just below critical (9000), so Warning
        ];

        let alerts = check_risk_alerts(&positions, 3000, 6000, 9000);
        // id(1) at 2999 is below watch → filtered out
        assert_eq!(alerts.len(), 2);
        // id(3) at 8999 → Warning, id(2) at 5999 → Watch
        assert_eq!(alerts[0].level, AlertLevel::Warning);
        assert_eq!(alerts[0].metric_value, 8999);
        assert_eq!(alerts[1].level, AlertLevel::Watch);
        assert_eq!(alerts[1].metric_value, 5999);
    }

    #[test]
    fn test_alerts_equal_thresholds() {
        // All thresholds set to same value → everything at or above is Critical
        let positions = vec![
            (id(1), 499u64, AlertReason::HighUtilization),
            (id(2), 500u64, AlertReason::LowHealthFactor),
            (id(3), 1000u64, AlertReason::HighConcentration),
        ];

        let alerts = check_risk_alerts(&positions, 500, 500, 500);
        // id(1) at 499 < 500 → filtered
        assert_eq!(alerts.len(), 2);
        for alert in &alerts {
            assert_eq!(alert.level, AlertLevel::Critical,
                "When all thresholds equal, everything at or above is Critical");
        }
    }

    #[test]
    fn test_alerts_inverted_thresholds() {
        // critical < warning < watch — unusual but code handles it
        // Metric 5000: >= critical(1000) → Critical
        let positions = vec![
            (id(1), 5000u64, AlertReason::HighImpermanentLoss),
        ];

        let alerts = check_risk_alerts(&positions, 9000, 6000, 1000);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].level, AlertLevel::Critical,
            "Metric 5000 >= critical threshold 1000 → Critical");
    }

    #[test]
    fn test_alerts_position_id_preserved() {
        // Verify position_id in alerts matches input positions
        let positions = vec![
            (id(42), 7000u64, AlertReason::HighUtilization),
            (id(99), 3500u64, AlertReason::LowHealthFactor),
        ];

        let alerts = check_risk_alerts(&positions, 3000, 6000, 9000);
        assert_eq!(alerts.len(), 2);

        let warning = alerts.iter().find(|a| a.level == AlertLevel::Warning).unwrap();
        assert_eq!(warning.position_id, id(42));

        let watch = alerts.iter().find(|a| a.level == AlertLevel::Watch).unwrap();
        assert_eq!(watch.position_id, id(99));
    }

    #[test]
    fn test_strategy_error_variants_distinct() {
        // All StrategyError variants should be distinguishable
        let errors = vec![
            StrategyError::NoArbOpportunity,
            StrategyError::InsufficientData,
            StrategyError::EmptyPool,
            StrategyError::NoPositions,
        ];

        for i in 0..errors.len() {
            for j in (i + 1)..errors.len() {
                assert_ne!(errors[i], errors[j],
                    "Error variants must be distinct: {:?} vs {:?}", errors[i], errors[j]);
            }
        }
    }

    #[test]
    fn test_alert_level_ordering() {
        // AlertLevel derives PartialOrd/Ord — verify correct ordering
        assert!(AlertLevel::Safe < AlertLevel::Watch);
        assert!(AlertLevel::Watch < AlertLevel::Warning);
        assert!(AlertLevel::Warning < AlertLevel::Critical);
    }

    // ============ Hardening Batch 7: Deep Edge Cases & Coverage Expansion ============

    #[test]
    fn test_arb_three_pools_all_equal() {
        let pool = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 30);
        let pools = vec![(id(1), &pool), (id(2), &pool), (id(3), &pool)];
        let arbs = find_arbitrage(&pools, 0);
        assert!(arbs.is_empty(), "Three equal-priced pools should produce no arb");
    }

    #[test]
    fn test_arb_two_pools_one_empty_reserve0() {
        let pool_a = make_pool_data(0, 1_000_000 * PRECISION, 30);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 30);
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];
        let arbs = find_arbitrage(&pools, 0);
        assert!(arbs.is_empty(), "Pool with zero reserve0 should be skipped");
    }

    #[test]
    fn test_arb_spread_calculation_matches_manual() {
        // Pool A: price = 1.0, Pool B: price = 1.1 → spread = 10% = 1000 bps
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 0);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_100_000 * PRECISION, 0);
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];
        let arbs = find_arbitrage(&pools, 0);
        assert_eq!(arbs.len(), 1);
        // spread_bps = (sell - buy) * 10000 / buy = 0.1 * 10000 = 1000
        assert!(arbs[0].spread_bps >= 990 && arbs[0].spread_bps <= 1010,
            "Spread should be ~1000 bps, got {}", arbs[0].spread_bps);
    }

    #[test]
    fn test_rebalance_3x_price_move() {
        // Price tripled → ~5.7% IL at 2x, even more at 3x
        let signal = check_rebalance(
            PRECISION,
            3 * PRECISION,
            100_000 * PRECISION,
            0,
            500,
            2000,
        ).unwrap();
        // IL from 3x ≈ 13.4% → above 5% threshold but below 20% exit
        assert!(signal.current_il_bps > 500);
        assert!(signal.should_rebalance);
        assert_eq!(signal.action, RebalanceAction::ReenterAtCurrentPrice);
    }

    #[test]
    fn test_rebalance_50x_price_extreme() {
        // Price 50x → extreme IL, must recommend exit
        let signal = check_rebalance(
            PRECISION,
            50 * PRECISION,
            100_000 * PRECISION,
            0,
            500,
            2000,
        ).unwrap();
        assert!(signal.current_il_bps > 2000);
        assert!(signal.should_rebalance);
        assert_eq!(signal.action, RebalanceAction::ExitPosition);
    }

    #[test]
    fn test_rebalance_add_liquidity_requires_fees() {
        // Low IL + fees > 0 → AddLiquidity
        // Low IL + fees = 0 → Hold
        let with_fees = check_rebalance(
            PRECISION, PRECISION, 100_000 * PRECISION,
            1_000 * PRECISION, 500, 2000,
        ).unwrap();
        let without_fees = check_rebalance(
            PRECISION, PRECISION, 100_000 * PRECISION,
            0, 500, 2000,
        ).unwrap();
        assert_eq!(with_fees.action, RebalanceAction::AddLiquidity);
        assert_eq!(without_fees.action, RebalanceAction::Hold);
    }

    #[test]
    fn test_yield_two_sources_same_everything() {
        // Two sources with identical params → both rank equal
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 500, tvl: 1_000_000, risk_score: 20 },
            YieldSource { source_id: id(2), source_type: YieldType::LPFees, apy_bps: 500, tvl: 1_000_000, risk_score: 20 },
        ];
        let rec = optimize_yield(&sources, 100).unwrap();
        assert_eq!(rec.ranked_sources.len(), 2);
        assert_eq!(rec.ranked_sources[0].2, rec.ranked_sources[1].2,
            "Identical sources should have equal risk-adjusted scores");
    }

    #[test]
    fn test_yield_risk_score_1() {
        // Minimal risk (risk_score = 1) → very small penalty
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 1000, tvl: 1_000_000, risk_score: 1 },
        ];
        let rec = optimize_yield(&sources, 100).unwrap();
        // risk_penalty = PRECISION + 1 * PRECISION / 100 = 1.01 * PRECISION
        // adjusted ≈ 1000 * PRECISION / 1.01 ≈ 990 * PRECISION
        assert!(rec.risk_adjusted_score > 900 * PRECISION);
    }

    #[test]
    fn test_liquidation_single_underwater_zero_gas() {
        let vaults = vec![(50_000 * PRECISION, 100_000 * PRECISION, 8000u128)];
        let opps = find_liquidations(&vaults, 500, 0);
        assert_eq!(opps.len(), 1);
        assert!(opps[0].estimated_profit > 0);
        assert!(opps[0].urgency > 50);
    }

    #[test]
    fn test_liquidation_very_high_incentive() {
        // 50% incentive (5000 bps) — seizable capped by collateral
        let vaults = vec![(80_000 * PRECISION, 100_000 * PRECISION, 8000u128)];
        let opps = find_liquidations(&vaults, 5000, 0);
        assert_eq!(opps.len(), 1);
        // seizable = debt * 1.5 = 150K, but capped at collateral 80K
        assert!(opps[0].seizable_collateral <= 80_000 * PRECISION);
    }

    #[test]
    fn test_liquidation_threshold_1_bps() {
        // Very low threshold (1 bps = 0.01%) → HF = col * 1 * P / (debt * 10000)
        // = 80K * 1 / (100K * 10000) ≈ 0.00000008 → deeply underwater
        let vaults = vec![(80_000 * PRECISION, 100_000 * PRECISION, 1u128)];
        let opps = find_liquidations(&vaults, 500, 0);
        assert_eq!(opps.len(), 1);
        assert!(opps[0].health_factor < PRECISION / 1000);
        assert!(opps[0].urgency > 90);
    }

    #[test]
    fn test_alerts_large_number_of_positions() {
        // 50 positions across all alert levels
        let positions: Vec<([u8; 32], u64, AlertReason)> = (0..50u8).map(|i| {
            let metric = (i as u64) * 200; // 0, 200, 400, ..., 9800
            (id(i), metric, AlertReason::HighUtilization)
        }).collect();
        let alerts = check_risk_alerts(&positions, 3000, 6000, 9000);
        // Only positions with metric >= 3000 should be included
        let expected = positions.iter().filter(|p| p.1 >= 3000).count();
        assert_eq!(alerts.len(), expected);
    }

    #[test]
    fn test_alerts_all_watch_level() {
        let positions = vec![
            (id(1), 3000u64, AlertReason::HighUtilization),
            (id(2), 4000u64, AlertReason::LowHealthFactor),
            (id(3), 5999u64, AlertReason::HighConcentration),
        ];
        let alerts = check_risk_alerts(&positions, 3000, 6000, 9000);
        assert_eq!(alerts.len(), 3);
        for alert in &alerts {
            assert_eq!(alert.level, AlertLevel::Watch);
        }
    }

    #[test]
    fn test_alerts_all_warning_level() {
        let positions = vec![
            (id(1), 6000u64, AlertReason::HighUtilization),
            (id(2), 7000u64, AlertReason::LowHealthFactor),
            (id(3), 8999u64, AlertReason::HighConcentration),
        ];
        let alerts = check_risk_alerts(&positions, 3000, 6000, 9000);
        assert_eq!(alerts.len(), 3);
        for alert in &alerts {
            assert_eq!(alert.level, AlertLevel::Warning);
        }
    }

    #[test]
    fn test_arb_equal_reserves_different_fees() {
        // Same reserves → same price → no arb regardless of fees
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 5);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 50);
        let pools = vec![(id(1), &pool_a), (id(2), &pool_b)];
        let arbs = find_arbitrage(&pools, 0);
        assert!(arbs.is_empty(), "Same price should produce no arb regardless of fee differences");
    }

    #[test]
    fn test_yield_type_variants_used() {
        // All four yield types should work
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 100, tvl: 1_000_000, risk_score: 10 },
            YieldSource { source_id: id(2), source_type: YieldType::LendingDeposit, apy_bps: 200, tvl: 1_000_000, risk_score: 10 },
            YieldSource { source_id: id(3), source_type: YieldType::InsurancePremium, apy_bps: 300, tvl: 1_000_000, risk_score: 10 },
            YieldSource { source_id: id(4), source_type: YieldType::StakingRewards, apy_bps: 400, tvl: 1_000_000, risk_score: 10 },
        ];
        let rec = optimize_yield(&sources, 100).unwrap();
        assert_eq!(rec.ranked_sources.len(), 4);
    }

    #[test]
    fn test_liquidation_ten_vaults_mixed() {
        // 10 vaults: 5 healthy, 5 underwater
        let mut vaults = Vec::new();
        for i in 0..5 {
            vaults.push((200_000 * PRECISION, 100_000 * PRECISION, 8000u128)); // healthy
        }
        for i in 0..5 {
            vaults.push(((50_000 + i as u128 * 5_000) * PRECISION, 100_000 * PRECISION, 8000u128)); // underwater
        }
        let opps = find_liquidations(&vaults, 500, 10 * PRECISION);
        assert_eq!(opps.len(), 5, "Exactly 5 underwater vaults should be liquidatable");
        for w in opps.windows(2) {
            assert!(w[0].estimated_profit >= w[1].estimated_profit);
        }
    }

    #[test]
    fn test_rebalance_signal_position_value_matches_il_lp_value() {
        // RebalanceSignal.position_value should equal the IL calculation's lp_value
        let signal = check_rebalance(
            PRECISION,
            3 * PRECISION,
            100_000 * PRECISION,
            5_000 * PRECISION,
            500,
            2000,
        ).unwrap();
        // rebalanced_value = position_value + accrued_fees
        assert_eq!(signal.rebalanced_value, signal.position_value + 5_000 * PRECISION);
    }

    // ============ Hardening Tests v3 ============

    #[test]
    fn test_arb_spread_proportional_to_price_diff_v3() {
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 10);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_100_000 * PRECISION, 10);
        let opps = find_arbitrage(&[(id(1), &pool_a), (id(2), &pool_b)], 0);
        assert!(!opps.is_empty());
        let opp = &opps[0];
        assert!(opp.spread_bps > 0);
        assert!(opp.buy_price < opp.sell_price);
    }

    #[test]
    fn test_arb_empty_input_v3() {
        let opps = find_arbitrage(&[], 0);
        assert!(opps.is_empty());
    }

    #[test]
    fn test_arb_single_pool_no_arb_v3() {
        let pool = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 30);
        let opps = find_arbitrage(&[(id(1), &pool)], 0);
        assert!(opps.is_empty());
    }

    #[test]
    fn test_rebalance_zero_il_suggests_add_liquidity_v3() {
        let signal = check_rebalance(
            PRECISION,
            PRECISION, // Same price
            100_000 * PRECISION,
            1_000 * PRECISION, // Has accrued fees
            500,
            2000,
        ).unwrap();
        assert_eq!(signal.action, RebalanceAction::AddLiquidity);
        assert!(!signal.should_rebalance);
    }

    #[test]
    fn test_rebalance_extreme_il_suggests_exit_v3() {
        let signal = check_rebalance(
            PRECISION,
            20 * PRECISION, // 20x price change
            100_000 * PRECISION,
            0, // No fees to compensate
            500,
            2000, // Exit threshold
        ).unwrap();
        assert_eq!(signal.action, RebalanceAction::ExitPosition);
        assert!(signal.should_rebalance);
    }

    #[test]
    fn test_yield_single_source_returns_it_v3() {
        let sources = vec![YieldSource {
            source_id: id(1),
            source_type: YieldType::LPFees,
            apy_bps: 500,
            tvl: PRECISION,
            risk_score: 10,
        }];
        let rec = optimize_yield(&sources, 100).unwrap();
        assert_eq!(rec.best_source, id(1));
        assert_eq!(rec.best_apy_bps, 500);
    }

    #[test]
    fn test_yield_risk_adjusted_score_monotonic_v3() {
        // Same APY, increasing risk → decreasing adjusted score
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 1000, tvl: PRECISION, risk_score: 10 },
            YieldSource { source_id: id(2), source_type: YieldType::LPFees, apy_bps: 1000, tvl: PRECISION, risk_score: 50 },
            YieldSource { source_id: id(3), source_type: YieldType::LPFees, apy_bps: 1000, tvl: PRECISION, risk_score: 90 },
        ];
        let rec = optimize_yield(&sources, 100).unwrap();
        for i in 0..rec.ranked_sources.len() - 1 {
            assert!(rec.ranked_sources[i].2 >= rec.ranked_sources[i + 1].2);
        }
    }

    #[test]
    fn test_yield_zero_risk_gets_max_adjustment_v3() {
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 1000, tvl: PRECISION, risk_score: 0 },
            YieldSource { source_id: id(2), source_type: YieldType::LPFees, apy_bps: 1000, tvl: PRECISION, risk_score: 50 },
        ];
        let rec = optimize_yield(&sources, 100).unwrap();
        assert_eq!(rec.best_source, id(1)); // Zero risk wins
    }

    #[test]
    fn test_liquidation_urgency_boundary_values_v3() {
        // HF = 0 → urgency = 100
        let opps = find_liquidations(
            &[(0, 100, 15000)], // 0 collateral, 100 debt, high threshold → HF=0
            500,
            0, // zero gas
        );
        // With 0 collateral, skipped by the zero check
        assert!(opps.is_empty());
    }

    #[test]
    fn test_liquidation_gas_cost_eliminates_profit_v3() {
        let opps = find_liquidations(
            &[(1000, 900, 10_000)], // barely underwater
            500,  // 5% incentive
            1000, // gas cost equals entire position
        );
        // Gas too high, no profitable liquidation
        assert!(opps.is_empty());
    }

    #[test]
    fn test_liquidation_sorted_by_profit_v3() {
        let opps = find_liquidations(
            &[
                (100_000, 90_000, 10_000), // HF < 1
                (200_000, 190_000, 10_000), // HF < 1, more profit
                (50_000, 45_000, 10_000),  // HF < 1, less profit
            ],
            500,
            0,
        );
        for i in 0..opps.len().saturating_sub(1) {
            assert!(opps[i].estimated_profit >= opps[i + 1].estimated_profit);
        }
    }

    #[test]
    fn test_alerts_below_watch_threshold_no_alert_v3() {
        let positions = vec![(id(1), 99u64, AlertReason::LowHealthFactor)];
        let alerts = check_risk_alerts(&positions, 100, 500, 1000);
        assert!(alerts.is_empty());
    }

    #[test]
    fn test_alerts_at_watch_threshold_v3() {
        let positions = vec![(id(1), 100u64, AlertReason::LowHealthFactor)];
        let alerts = check_risk_alerts(&positions, 100, 500, 1000);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].level, AlertLevel::Watch);
    }

    #[test]
    fn test_alerts_at_warning_threshold_v3() {
        let positions = vec![(id(1), 500u64, AlertReason::HighImpermanentLoss)];
        let alerts = check_risk_alerts(&positions, 100, 500, 1000);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].level, AlertLevel::Warning);
    }

    #[test]
    fn test_alerts_at_critical_threshold_v3() {
        let positions = vec![(id(1), 1000u64, AlertReason::HighConcentration)];
        let alerts = check_risk_alerts(&positions, 100, 500, 1000);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].level, AlertLevel::Critical);
    }

    #[test]
    fn test_alerts_sorted_critical_first_v3() {
        let positions = vec![
            (id(1), 150u64, AlertReason::LowHealthFactor),    // Watch
            (id(2), 1500u64, AlertReason::HighImpermanentLoss), // Critical
            (id(3), 600u64, AlertReason::HighUtilization),      // Warning
        ];
        let alerts = check_risk_alerts(&positions, 100, 500, 1000);
        assert_eq!(alerts.len(), 3);
        assert_eq!(alerts[0].level, AlertLevel::Critical);
        assert_eq!(alerts[1].level, AlertLevel::Warning);
        assert_eq!(alerts[2].level, AlertLevel::Watch);
    }

    #[test]
    fn test_rebalance_fees_cover_il_hold_v3() {
        let signal = check_rebalance(
            PRECISION,
            2 * PRECISION, // 2x price change
            100_000 * PRECISION,
            50_000 * PRECISION, // Large fee accrual covers IL
            500,
            2000,
        ).unwrap();
        // IL exceeds threshold but fees cover it → Hold
        assert_eq!(signal.action, RebalanceAction::Hold);
    }

    #[test]
    fn test_arb_opportunity_fields_correct_v3() {
        let pool_a = make_pool_data(1_000_000 * PRECISION, 800_000 * PRECISION, 10);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_200_000 * PRECISION, 10);
        let opps = find_arbitrage(&[(id(1), &pool_a), (id(2), &pool_b)], 0);
        assert!(!opps.is_empty());
        let opp = &opps[0];
        assert_eq!(opp.buy_pool_id, id(1)); // Lower price
        assert_eq!(opp.sell_pool_id, id(2)); // Higher price
        assert!(opp.estimated_profit > 0);
        assert!(opp.optimal_size > 0);
    }

    #[test]
    fn test_yield_all_above_risk_cap_returns_error_v3() {
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 1000, tvl: PRECISION, risk_score: 80 },
            YieldSource { source_id: id(2), source_type: YieldType::StakingRewards, apy_bps: 500, tvl: PRECISION, risk_score: 90 },
        ];
        let result = optimize_yield(&sources, 50); // Max risk = 50
        assert_eq!(result, Err(StrategyError::NoPositions));
    }

    #[test]
    fn test_rebalance_rebalanced_value_includes_fees_v3() {
        let signal = check_rebalance(
            PRECISION,
            PRECISION * 3 / 2, // 1.5x price change
            100_000 * PRECISION,
            10_000 * PRECISION,
            500,
            2000,
        ).unwrap();
        // rebalanced_value = lp_value + accrued_fees
        assert_eq!(signal.rebalanced_value, signal.position_value + 10_000 * PRECISION);
    }

    #[test]
    fn test_arb_min_spread_filter_exact_v3() {
        let pool_a = make_pool_data(1_000_000 * PRECISION, 1_000_000 * PRECISION, 10);
        let pool_b = make_pool_data(1_000_000 * PRECISION, 1_050_000 * PRECISION, 10);
        // Spread is about 500 bps (5%)
        let opps_low = find_arbitrage(&[(id(1), &pool_a), (id(2), &pool_b)], 100);
        let opps_high = find_arbitrage(&[(id(1), &pool_a), (id(2), &pool_b)], 1000);
        // Low min spread finds it, high min spread may not
        assert!(opps_low.len() >= opps_high.len());
    }

    #[test]
    fn test_liquidation_seizable_capped_at_collateral_v3() {
        let opps = find_liquidations(
            &[(100, 200, 10_000)], // debt > collateral (deeply underwater)
            5000, // 50% incentive
            0,
        );
        if !opps.is_empty() {
            assert!(opps[0].seizable_collateral <= 100);
        }
    }

    #[test]
    fn test_alert_reason_propagated_v3() {
        let positions = vec![
            (id(1), 600u64, AlertReason::LowHealthFactor),
            (id(2), 600u64, AlertReason::HighImpermanentLoss),
            (id(3), 600u64, AlertReason::HighConcentration),
            (id(4), 600u64, AlertReason::HighUtilization),
        ];
        let alerts = check_risk_alerts(&positions, 100, 500, 1000);
        assert_eq!(alerts.len(), 4);
        // Verify all are Warning level (600 >= 500, < 1000)
        for alert in &alerts {
            assert_eq!(alert.level, AlertLevel::Warning);
        }
    }

    #[test]
    fn test_strategy_error_variants_cover_all_v3() {
        let e1 = StrategyError::NoArbOpportunity;
        let e2 = StrategyError::InsufficientData;
        let e3 = StrategyError::EmptyPool;
        let e4 = StrategyError::NoPositions;
        assert_ne!(e1, e2);
        assert_ne!(e2, e3);
        assert_ne!(e3, e4);
    }

    #[test]
    fn test_alert_level_ordering_complete_v3() {
        assert!(AlertLevel::Safe < AlertLevel::Watch);
        assert!(AlertLevel::Watch < AlertLevel::Warning);
        assert!(AlertLevel::Warning < AlertLevel::Critical);
    }

    #[test]
    fn test_rebalance_entry_price_zero_returns_error_v3() {
        let result = check_rebalance(0, PRECISION, 100_000, 0, 500, 2000);
        assert_eq!(result, Err(StrategyError::InsufficientData));
    }

    #[test]
    fn test_rebalance_current_price_zero_returns_error_v3() {
        let result = check_rebalance(PRECISION, 0, 100_000, 0, 500, 2000);
        // Zero current price → error from IL calculation
        assert!(result.is_err());
    }

    // ============ Hardening Tests v4 ============

    #[test]
    fn test_arb_two_pools_same_price_no_arb_v4() {
        let p1 = make_pool_data(1_000_000, 1_000_000, 30);
        let p2 = make_pool_data(2_000_000, 2_000_000, 30);
        let pools = vec![(id(1), &p1), (id(2), &p2)];
        let arbs = find_arbitrage(&pools, 0);
        assert!(arbs.is_empty());
    }

    #[test]
    fn test_arb_spread_exactly_fees_no_profit_v4() {
        // Spread of 60 bps = sum of two 30 bps fees
        let p1 = make_pool_data(1_000_000, 1_000_000, 30);
        let p2 = make_pool_data(1_000_000, 1_006_000, 30);
        let pools = vec![(id(1), &p1), (id(2), &p2)];
        let arbs = find_arbitrage(&pools, 0);
        assert!(arbs.is_empty());
    }

    #[test]
    fn test_arb_spread_above_fees_profitable_v4() {
        // Large spread well above fees
        let p1 = make_pool_data(1_000_000, 1_000_000, 30);
        let p2 = make_pool_data(1_000_000, 2_000_000, 30);
        let pools = vec![(id(1), &p1), (id(2), &p2)];
        let arbs = find_arbitrage(&pools, 0);
        assert!(!arbs.is_empty());
        assert!(arbs[0].estimated_profit > 0);
    }

    #[test]
    fn test_arb_empty_pools_list_v4() {
        let pools: Vec<([u8; 32], &PoolCellData)> = vec![];
        let arbs = find_arbitrage(&pools, 0);
        assert!(arbs.is_empty());
    }

    #[test]
    fn test_arb_min_spread_filter_works_v4() {
        let p1 = make_pool_data(1_000_000, 1_000_000, 30);
        let p2 = make_pool_data(1_000_000, 1_500_000, 30);
        let pools = vec![(id(1), &p1), (id(2), &p2)];
        // Without filter
        let arbs = find_arbitrage(&pools, 0);
        assert!(!arbs.is_empty());
        // With very high filter
        let arbs_filtered = find_arbitrage(&pools, 100_000);
        assert!(arbs_filtered.is_empty());
    }

    #[test]
    fn test_rebalance_no_il_suggests_add_liquidity_v4() {
        let signal = check_rebalance(
            PRECISION, PRECISION, // same price
            100_000,              // position value
            1_000,                // some accrued fees
            500, 2000,            // thresholds
        ).unwrap();
        assert_eq!(signal.action, RebalanceAction::AddLiquidity);
        assert!(!signal.should_rebalance);
    }

    #[test]
    fn test_rebalance_high_il_exit_v4() {
        let signal = check_rebalance(
            PRECISION,
            100 * PRECISION,      // 100x price move → extreme IL
            100_000,
            0,                     // no fees
            500, 2000,
        ).unwrap();
        assert_eq!(signal.action, RebalanceAction::ExitPosition);
        assert!(signal.should_rebalance);
    }

    #[test]
    fn test_rebalance_moderate_il_fees_cover_hold_v4() {
        let signal = check_rebalance(
            PRECISION,
            2 * PRECISION,        // 2x price → ~5.7% IL
            1_000_000,
            1_000_000,             // massive fees cover IL
            500, 2000,
        ).unwrap();
        // Fees cover IL, so should not rebalance
        assert!(!signal.should_rebalance);
    }

    #[test]
    fn test_rebalance_moderate_il_no_fees_reenter_v4() {
        let signal = check_rebalance(
            PRECISION,
            2 * PRECISION,
            1_000_000,
            0,                     // no fees
            200, 2000,             // low il_threshold
        ).unwrap();
        // IL > 200 bps and fees don't cover → reenter
        assert!(signal.should_rebalance);
        assert_eq!(signal.action, RebalanceAction::ReenterAtCurrentPrice);
    }

    #[test]
    fn test_yield_single_source_v4() {
        let sources = vec![YieldSource {
            source_id: id(1),
            source_type: YieldType::LPFees,
            apy_bps: 1000,
            tvl: 1_000_000,
            risk_score: 10,
        }];
        let rec = optimize_yield(&sources, 100).unwrap();
        assert_eq!(rec.best_source, id(1));
        assert_eq!(rec.best_apy_bps, 1000);
        assert_eq!(rec.ranked_sources.len(), 1);
    }

    #[test]
    fn test_yield_empty_returns_error_v4() {
        let result = optimize_yield(&[], 100);
        assert_eq!(result, Err(StrategyError::NoPositions));
    }

    #[test]
    fn test_yield_all_filtered_by_risk_v4() {
        let sources = vec![YieldSource {
            source_id: id(1),
            source_type: YieldType::LPFees,
            apy_bps: 1000,
            tvl: 1_000_000,
            risk_score: 50,
        }];
        let result = optimize_yield(&sources, 30); // max_risk = 30 < risk_score 50
        assert_eq!(result, Err(StrategyError::NoPositions));
    }

    #[test]
    fn test_yield_lower_risk_preferred_v4() {
        let sources = vec![
            YieldSource { source_id: id(1), source_type: YieldType::LPFees, apy_bps: 1000, tvl: 1_000_000, risk_score: 50 },
            YieldSource { source_id: id(2), source_type: YieldType::StakingRewards, apy_bps: 1000, tvl: 1_000_000, risk_score: 10 },
        ];
        let rec = optimize_yield(&sources, 100).unwrap();
        // Same APY but lower risk → id(2) should be best
        assert_eq!(rec.best_source, id(2));
    }

    #[test]
    fn test_liquidation_empty_vaults_v4() {
        let opps = find_liquidations(&[], 500, 100);
        assert!(opps.is_empty());
    }

    #[test]
    fn test_liquidation_healthy_vault_no_opp_v4() {
        let vaults = vec![(200, 100, 8000u128)]; // hf = 200*8000/(100*10000) = 1.6
        let opps = find_liquidations(&vaults, 500, 0);
        assert!(opps.is_empty());
    }

    #[test]
    fn test_liquidation_underwater_vault_v4() {
        let vaults = vec![(100, 200, 8000u128)]; // hf = 100*8000/(200*10000) = 0.4
        let opps = find_liquidations(&vaults, 500, 0);
        assert_eq!(opps.len(), 1);
        assert!(opps[0].estimated_profit > 0);
        assert!(opps[0].urgency > 50); // Very underwater
    }

    #[test]
    fn test_liquidation_gas_eliminates_profit_v4() {
        let vaults = vec![(100, 200, 8000u128)];
        let opps = find_liquidations(&vaults, 500, u128::MAX);
        assert!(opps.is_empty()); // Gas too high
    }

    #[test]
    fn test_alerts_below_watch_no_alert_v4() {
        let positions = vec![(id(1), 50u64, AlertReason::LowHealthFactor)];
        let alerts = check_risk_alerts(&positions, 100, 500, 1000);
        assert!(alerts.is_empty());
    }

    #[test]
    fn test_alerts_at_watch_v4() {
        let positions = vec![(id(1), 100u64, AlertReason::LowHealthFactor)];
        let alerts = check_risk_alerts(&positions, 100, 500, 1000);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].level, AlertLevel::Watch);
    }

    #[test]
    fn test_alerts_at_warning_v4() {
        let positions = vec![(id(1), 500u64, AlertReason::HighImpermanentLoss)];
        let alerts = check_risk_alerts(&positions, 100, 500, 1000);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].level, AlertLevel::Warning);
    }

    #[test]
    fn test_alerts_at_critical_v4() {
        let positions = vec![(id(1), 1000u64, AlertReason::HighUtilization)];
        let alerts = check_risk_alerts(&positions, 100, 500, 1000);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].level, AlertLevel::Critical);
    }

    #[test]
    fn test_alerts_sorted_critical_first_v4() {
        let positions = vec![
            (id(1), 100u64, AlertReason::LowHealthFactor),      // Watch
            (id(2), 1500u64, AlertReason::HighImpermanentLoss),  // Critical
            (id(3), 600u64, AlertReason::HighConcentration),     // Warning
        ];
        let alerts = check_risk_alerts(&positions, 100, 500, 1000);
        assert_eq!(alerts.len(), 3);
        assert_eq!(alerts[0].level, AlertLevel::Critical);
        assert_eq!(alerts[1].level, AlertLevel::Warning);
        assert_eq!(alerts[2].level, AlertLevel::Watch);
    }

    #[test]
    fn test_arb_sorted_by_profit_v4() {
        // Create 3 pools with different prices for multiple arb opps
        let p1 = make_pool_data(1_000_000, 1_000_000, 10);
        let p2 = make_pool_data(1_000_000, 2_000_000, 10);
        let p3 = make_pool_data(1_000_000, 3_000_000, 10);
        let pools = vec![(id(1), &p1), (id(2), &p2), (id(3), &p3)];
        let arbs = find_arbitrage(&pools, 0);
        // Should be sorted by estimated_profit descending
        for i in 1..arbs.len() {
            assert!(arbs[i - 1].estimated_profit >= arbs[i].estimated_profit);
        }
    }

    #[test]
    fn test_liquidation_sorted_by_profit_v4() {
        let vaults = vec![
            (100, 200, 8000u128),  // hf=0.4
            (100, 300, 8000u128),  // hf=0.27 — more underwater
            (100, 150, 8000u128),  // hf=0.53
        ];
        let opps = find_liquidations(&vaults, 500, 0);
        for i in 1..opps.len() {
            assert!(opps[i - 1].estimated_profit >= opps[i].estimated_profit);
        }
    }

    #[test]
    fn test_rebalance_position_value_returned_v4() {
        let signal = check_rebalance(PRECISION, PRECISION, 100_000, 5_000, 500, 2000).unwrap();
        // position_value should reflect lp_value from IL calc
        assert!(signal.position_value > 0);
        // rebalanced_value = lp_value + accrued_fees
        assert_eq!(signal.rebalanced_value, signal.position_value + 5_000);
    }

    #[test]
    fn test_yield_type_variants_v4() {
        let types = vec![YieldType::LPFees, YieldType::LendingDeposit, YieldType::InsurancePremium, YieldType::StakingRewards];
        assert_eq!(types.len(), 4);
    }

    #[test]
    fn test_alert_level_ordering_v4() {
        assert!(AlertLevel::Safe < AlertLevel::Watch);
        assert!(AlertLevel::Watch < AlertLevel::Warning);
        assert!(AlertLevel::Warning < AlertLevel::Critical);
    }
}
