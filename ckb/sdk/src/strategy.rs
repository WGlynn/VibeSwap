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
}
