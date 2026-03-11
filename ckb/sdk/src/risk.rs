// ============ Risk Manager — Unified Protocol Risk Assessment ============
// The central risk engine that combines oracle, keeper, insurance, and governance
// into a single entry point for protocol-wide risk monitoring.
//
// A production keeper daemon calls:
//   1. `assess_protocol()` — full protocol health snapshot
//   2. `prioritize_actions()` — ranked list of what to do next
//   3. `simulate_scenario()` — "what if ETH drops 30%?"
//
// This module does NOT mutate state — it's pure analysis.

use vibeswap_types::*;
use vibeswap_math::PRECISION;
use crate::keeper::{self, VaultAssessment, KeeperAction};
use crate::oracle;
use crate::governance;

// ============ Protocol Health Snapshot ============

/// Full protocol health assessment
#[derive(Debug, Clone)]
pub struct ProtocolHealth {
    /// Total value locked across all lending pools (in debt denomination)
    pub total_tvl: u128,
    /// Total outstanding borrows
    pub total_borrows: u128,
    /// Overall utilization rate (bps)
    pub utilization_bps: u64,
    /// Number of vaults assessed
    pub vaults_assessed: usize,
    /// Number of vaults in each risk tier
    pub tier_counts: TierCounts,
    /// Worst health factor across all vaults
    pub worst_health_factor: u128,
    /// Insurance coverage ratio (bps)
    pub insurance_coverage_bps: u64,
    /// Actions needed (sorted by urgency)
    pub pending_actions: Vec<PendingAction>,
}

/// Count of vaults per risk tier
#[derive(Debug, Clone, Default)]
pub struct TierCounts {
    pub safe: usize,
    pub warning: usize,
    pub auto_deleverage: usize,
    pub soft_liquidation: usize,
    pub hard_liquidation: usize,
}

/// An action the keeper should take, with priority
#[derive(Debug, Clone)]
pub struct PendingAction {
    /// Vault index in the input array
    pub vault_index: usize,
    /// The recommended action
    pub action: KeeperAction,
    /// Health factor of the vault
    pub health_factor: u128,
    /// Priority score (lower = more urgent, 0 = critical)
    pub priority: u64,
}

// ============ Core Assessment ============

/// Assess the full protocol health given all vaults and a lending pool.
///
/// This is the main entry point for keeper daemons.
pub fn assess_protocol(
    vaults: &[VaultCellData],
    lending_pool: &LendingPoolCellData,
    insurance_pool: Option<&InsurancePoolCellData>,
    collateral_price: u128,
    debt_price: u128,
) -> ProtocolHealth {
    let mut tier_counts = TierCounts::default();
    let mut worst_hf = u128::MAX;
    let mut pending_actions = Vec::new();

    for (i, vault) in vaults.iter().enumerate() {
        let assessment = keeper::assess_vault(
            vault,
            lending_pool,
            insurance_pool,
            collateral_price,
            debt_price,
        );

        // Track tier counts
        match &assessment.action {
            KeeperAction::Safe { .. } => tier_counts.safe += 1,
            KeeperAction::Warn { .. } => tier_counts.warning += 1,
            KeeperAction::AutoDeleverage { .. } => tier_counts.auto_deleverage += 1,
            KeeperAction::InsuranceClaim { .. } => tier_counts.auto_deleverage += 1,
            KeeperAction::SoftLiquidate { .. } => tier_counts.soft_liquidation += 1,
            KeeperAction::HardLiquidate { .. } => tier_counts.hard_liquidation += 1,
        }

        // Track worst HF
        if assessment.health_factor < worst_hf {
            worst_hf = assessment.health_factor;
        }

        // Collect non-safe actions
        if !matches!(assessment.action, KeeperAction::Safe { .. }) {
            let priority = health_factor_to_priority(assessment.health_factor);
            pending_actions.push(PendingAction {
                vault_index: i,
                action: assessment.action,
                health_factor: assessment.health_factor,
                priority,
            });
        }
    }

    // Sort by priority (lowest = most urgent)
    pending_actions.sort_by_key(|a| a.priority);

    // Calculate protocol-level metrics
    let utilization_bps = if lending_pool.total_deposits > 0 {
        ((lending_pool.total_borrows * 10_000) / lending_pool.total_deposits) as u64
    } else {
        0
    };

    let insurance_coverage_bps = if let Some(ins) = insurance_pool {
        if lending_pool.total_borrows > 0 {
            ((ins.total_deposits * 10_000) / lending_pool.total_borrows).min(10_000) as u64
        } else {
            10_000
        }
    } else {
        0
    };

    let tvl = vibeswap_math::mul_div(
        lending_pool.total_deposits,
        debt_price,
        PRECISION,
    );

    ProtocolHealth {
        total_tvl: tvl,
        total_borrows: lending_pool.total_borrows,
        utilization_bps,
        vaults_assessed: vaults.len(),
        tier_counts,
        worst_health_factor: if vaults.is_empty() { u128::MAX } else { worst_hf },
        insurance_coverage_bps,
        pending_actions,
    }
}

/// Convert health factor to priority score (0 = critical, higher = less urgent)
fn health_factor_to_priority(hf: u128) -> u64 {
    // HF < 1.0 → priority 0 (critical)
    // HF 1.0-1.1 → priority 100
    // HF 1.1-1.3 → priority 200
    // HF 1.3-1.5 → priority 300
    if hf < PRECISION {
        0
    } else if hf < PRECISION * 110 / 100 {
        100
    } else if hf < PRECISION * 130 / 100 {
        200
    } else if hf < PRECISION * 150 / 100 {
        300
    } else {
        1000
    }
}

// ============ Scenario Simulation ============

/// Simulate a price drop scenario and return the resulting protocol health.
///
/// `price_drop_bps` is how much the collateral price drops (e.g., 3000 = 30%).
pub fn simulate_price_drop(
    vaults: &[VaultCellData],
    lending_pool: &LendingPoolCellData,
    insurance_pool: Option<&InsurancePoolCellData>,
    current_collateral_price: u128,
    debt_price: u128,
    price_drop_bps: u64,
) -> ProtocolHealth {
    let stressed_price = current_collateral_price
        * (10_000 - price_drop_bps as u128)
        / 10_000;

    assess_protocol(
        vaults,
        lending_pool,
        insurance_pool,
        stressed_price,
        debt_price,
    )
}

/// Find the price drop (in bps) that would cause the first vault to become liquidatable.
///
/// Binary searches for the smallest price drop that causes HF < 1.0 for any vault.
/// Returns None if no vault would become liquidatable even at 99% price drop.
pub fn find_liquidation_threshold(
    vaults: &[VaultCellData],
    lending_pool: &LendingPoolCellData,
    insurance_pool: Option<&InsurancePoolCellData>,
    current_collateral_price: u128,
    debt_price: u128,
) -> Option<u64> {
    // Binary search between 0 and 9900 bps (99% drop)
    let mut low = 0u64;
    let mut high = 9900u64;
    let mut result = None;

    // Quick check: is there any vault with debt?
    let has_debt = vaults.iter().any(|v| v.debt_shares > 0);
    if !has_debt {
        return None;
    }

    while low <= high {
        let mid = (low + high) / 2;
        let health = simulate_price_drop(
            vaults, lending_pool, insurance_pool,
            current_collateral_price, debt_price, mid,
        );

        if health.tier_counts.hard_liquidation > 0 || health.tier_counts.soft_liquidation > 0 {
            result = Some(mid);
            if mid == 0 { break; }
            high = mid - 1;
        } else {
            low = mid + 1;
        }
    }

    result
}

// ============ Protocol Risk Score ============

/// Calculate a single 0-100 risk score for the protocol.
///
/// 0 = perfectly safe, 100 = critical risk.
/// Factors: utilization, insurance coverage, vault risk distribution, worst HF.
pub fn risk_score(health: &ProtocolHealth) -> u64 {
    let mut score = 0u64;

    // Utilization component: 0-25 points
    // >90% = 25, 80-90% = 15, <80% = 5, <50% = 0
    score += match health.utilization_bps {
        bps if bps > 9000 => 25,
        bps if bps > 8000 => 15,
        bps if bps > 5000 => 5,
        _ => 0,
    };

    // Insurance coverage component: 0-25 points
    // 0% coverage = 25, <5% = 20, <10% = 10, >20% = 0
    score += match health.insurance_coverage_bps {
        0 => 25,
        bps if bps < 500 => 20,
        bps if bps < 1000 => 10,
        bps if bps < 2000 => 5,
        _ => 0,
    };

    // Vault risk distribution: 0-25 points
    let total = health.vaults_assessed.max(1) as u64;
    let at_risk = (health.tier_counts.warning
        + health.tier_counts.auto_deleverage
        + health.tier_counts.soft_liquidation
        + health.tier_counts.hard_liquidation) as u64;
    let at_risk_pct = (at_risk * 100) / total;
    score += match at_risk_pct {
        pct if pct > 50 => 25,
        pct if pct > 25 => 15,
        pct if pct > 10 => 10,
        pct if pct > 0 => 5,
        _ => 0,
    };

    // Worst HF component: 0-25 points
    if health.worst_health_factor < PRECISION {
        score += 25; // Active liquidation needed
    } else if health.worst_health_factor < PRECISION * 110 / 100 {
        score += 20;
    } else if health.worst_health_factor < PRECISION * 130 / 100 {
        score += 10;
    } else if health.worst_health_factor < PRECISION * 150 / 100 {
        score += 5;
    }

    score.min(100)
}

/// Risk level classification based on score
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RiskLevel {
    /// 0-20: Protocol is healthy
    Low,
    /// 21-50: Some positions at risk, monitor closely
    Medium,
    /// 51-75: Multiple positions at risk, active intervention needed
    High,
    /// 76-100: Protocol-level risk, emergency governance may be needed
    Critical,
}

pub fn classify_risk_level(score: u64) -> RiskLevel {
    match score {
        0..=20 => RiskLevel::Low,
        21..=50 => RiskLevel::Medium,
        51..=75 => RiskLevel::High,
        _ => RiskLevel::Critical,
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;
    use ckb_lending_math::PRECISION;

    fn test_pool() -> LendingPoolCellData {
        LendingPoolCellData {
            total_deposits: 1_000_000 * PRECISION,
            total_borrows: 500_000 * PRECISION,
            total_shares: 1_000_000 * PRECISION,
            total_reserves: 0,
            borrow_index: PRECISION,
            last_accrual_block: 100,
            asset_type_hash: [0xAA; 32],
            pool_id: [0xBB; 32],
            base_rate: DEFAULT_BASE_RATE,
            slope1: DEFAULT_SLOPE1,
            slope2: DEFAULT_SLOPE2,
            optimal_utilization: DEFAULT_OPTIMAL_UTILIZATION,
            reserve_factor: DEFAULT_RESERVE_FACTOR,
            collateral_factor: DEFAULT_COLLATERAL_FACTOR,
            liquidation_threshold: DEFAULT_LIQUIDATION_THRESHOLD,
            liquidation_incentive: DEFAULT_LIQUIDATION_INCENTIVE,
        }
    }

    fn test_insurance() -> InsurancePoolCellData {
        InsurancePoolCellData {
            pool_id: [0xBB; 32],
            asset_type_hash: [0xAA; 32],
            total_deposits: 100_000 * PRECISION,
            total_shares: 100_000 * PRECISION,
            total_premiums_earned: 0,
            total_claims_paid: 0,
            premium_rate_bps: DEFAULT_PREMIUM_RATE_BPS,
            max_coverage_bps: DEFAULT_MAX_COVERAGE_BPS,
            cooldown_blocks: DEFAULT_COOLDOWN_BLOCKS,
            last_premium_block: 100,
        }
    }

    fn safe_vault(collateral: u128, debt: u128) -> VaultCellData {
        VaultCellData {
            owner_lock_hash: [0x11; 32],
            pool_id: [0xBB; 32],
            collateral_amount: collateral,
            collateral_type_hash: [0xCC; 32],
            debt_shares: debt,
            borrow_index_snapshot: PRECISION,
            deposit_shares: 0,
            last_update_block: 100,
        }
    }

    // ============ Basic Assessment ============

    #[test]
    fn test_assess_protocol_all_safe() {
        let pool = test_pool();
        let vaults = vec![
            safe_vault(100 * PRECISION, 5_000 * PRECISION),
            safe_vault(200 * PRECISION, 8_000 * PRECISION),
            safe_vault(50 * PRECISION, 1_000 * PRECISION),
        ];

        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        assert_eq!(health.vaults_assessed, 3);
        assert_eq!(health.tier_counts.safe, 3);
        assert_eq!(health.tier_counts.hard_liquidation, 0);
        assert!(health.pending_actions.is_empty());
        assert!(health.worst_health_factor > PRECISION);
    }

    #[test]
    fn test_assess_protocol_mixed_risk() {
        let pool = test_pool();
        let vaults = vec![
            safe_vault(100 * PRECISION, 5_000 * PRECISION),   // HF ≈ 4.8 → Safe
            safe_vault(10 * PRECISION, 15_000 * PRECISION),   // HF ≈ 1.6 → Safe
            safe_vault(10 * PRECISION, 20_000 * PRECISION),   // HF ≈ 1.2 → AutoDeleverage
            safe_vault(10 * PRECISION, 30_000 * PRECISION),   // HF ≈ 0.8 → HardLiquidation
        ];

        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        assert_eq!(health.vaults_assessed, 4);
        assert!(health.tier_counts.safe >= 1);
        assert!(!health.pending_actions.is_empty());
        assert!(health.worst_health_factor < PRECISION);

        // Actions should be sorted: most urgent first
        if health.pending_actions.len() >= 2 {
            assert!(health.pending_actions[0].priority <= health.pending_actions[1].priority);
        }
    }

    #[test]
    fn test_assess_protocol_no_vaults() {
        let pool = test_pool();
        let health = assess_protocol(
            &[], &pool, None, 3000 * PRECISION, PRECISION,
        );

        assert_eq!(health.vaults_assessed, 0);
        assert!(health.pending_actions.is_empty());
        assert_eq!(health.worst_health_factor, u128::MAX);
    }

    #[test]
    fn test_assess_protocol_with_insurance() {
        let pool = test_pool();
        let insurance = test_insurance();
        let vaults = vec![safe_vault(100 * PRECISION, 5_000 * PRECISION)];

        let health = assess_protocol(
            &vaults, &pool, Some(&insurance),
            3000 * PRECISION, PRECISION,
        );

        // Insurance covers 100K of 500K borrows = 20% = 2000 bps
        assert_eq!(health.insurance_coverage_bps, 2000);
    }

    #[test]
    fn test_utilization_rate() {
        let pool = test_pool(); // 500K/1M = 50%
        let health = assess_protocol(
            &[], &pool, None, 3000 * PRECISION, PRECISION,
        );
        assert_eq!(health.utilization_bps, 5000);
    }

    // ============ Price Drop Simulation ============

    #[test]
    fn test_simulate_10_percent_drop() {
        let pool = test_pool();
        let vaults = vec![
            safe_vault(10 * PRECISION, 18_000 * PRECISION), // HF ≈ 1.33 at $3000
        ];

        // Current state: safe
        let current = assess_protocol(
            &vaults, &pool, None, 3000 * PRECISION, PRECISION,
        );
        assert_eq!(current.tier_counts.hard_liquidation, 0);

        // 10% drop: HF ≈ 1.2 → still no hard liq
        let after_10 = simulate_price_drop(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION, 1000,
        );
        assert_eq!(after_10.tier_counts.hard_liquidation, 0);

        // 30% drop: HF ≈ 0.93 → hard liquidation
        let after_30 = simulate_price_drop(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION, 3000,
        );
        assert!(after_30.tier_counts.hard_liquidation > 0
            || after_30.tier_counts.soft_liquidation > 0);
    }

    #[test]
    fn test_find_liquidation_threshold() {
        let pool = test_pool();
        let vaults = vec![
            // HF = (10 * price * 0.8) / 18000
            // HF < 1.1 when price < 18000 / (10*0.8) * 1.1 = 2475
            // At $3000: HF = 1.33
            safe_vault(10 * PRECISION, 18_000 * PRECISION),
        ];

        let threshold = find_liquidation_threshold(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        assert!(threshold.is_some());
        let bps = threshold.unwrap();
        // Should need roughly 17-25% drop to trigger liquidation zone
        assert!(bps > 1000, "Should need >10% drop");
        assert!(bps < 4000, "Should need <40% drop");
    }

    #[test]
    fn test_find_liquidation_threshold_no_debt() {
        let pool = test_pool();
        let vaults = vec![
            safe_vault(100 * PRECISION, 0), // No debt
        ];

        let threshold = find_liquidation_threshold(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );
        assert!(threshold.is_none());
    }

    // ============ Risk Score ============

    #[test]
    fn test_risk_score_healthy_protocol() {
        let pool = test_pool();
        let insurance = test_insurance();
        let vaults = vec![
            safe_vault(100 * PRECISION, 5_000 * PRECISION),
            safe_vault(200 * PRECISION, 8_000 * PRECISION),
        ];

        let health = assess_protocol(
            &vaults, &pool, Some(&insurance),
            3000 * PRECISION, PRECISION,
        );

        let score = risk_score(&health);
        assert!(score <= 20, "Healthy protocol should have low risk score: {}", score);
        assert_eq!(classify_risk_level(score), RiskLevel::Low);
    }

    #[test]
    fn test_risk_score_stressed_protocol() {
        let pool = LendingPoolCellData {
            total_deposits: 1_000_000 * PRECISION,
            total_borrows: 950_000 * PRECISION, // 95% utilization
            ..test_pool()
        };
        let vaults = vec![
            safe_vault(10 * PRECISION, 25_000 * PRECISION), // HF ≈ 0.96
        ];

        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        let score = risk_score(&health);
        assert!(score > 50, "Stressed protocol should have high risk score: {}", score);
        assert!(matches!(
            classify_risk_level(score),
            RiskLevel::High | RiskLevel::Critical
        ));
    }

    #[test]
    fn test_risk_score_no_insurance() {
        let pool = test_pool();
        let vaults = vec![safe_vault(100 * PRECISION, 5_000 * PRECISION)];

        let with_insurance = assess_protocol(
            &vaults, &pool, Some(&test_insurance()),
            3000 * PRECISION, PRECISION,
        );
        let without_insurance = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        // No insurance = higher risk
        assert!(risk_score(&without_insurance) >= risk_score(&with_insurance));
    }

    // ============ Priority Ordering ============

    #[test]
    fn test_actions_ordered_by_urgency() {
        let pool = test_pool();
        let vaults = vec![
            safe_vault(10 * PRECISION, 13_000 * PRECISION), // HF ≈ 1.85
            safe_vault(10 * PRECISION, 20_000 * PRECISION), // HF ≈ 1.2
            safe_vault(10 * PRECISION, 30_000 * PRECISION), // HF ≈ 0.8
            safe_vault(10 * PRECISION, 17_000 * PRECISION), // HF ≈ 1.41
        ];

        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        // Verify: actions sorted by priority (ascending)
        for i in 1..health.pending_actions.len() {
            assert!(
                health.pending_actions[i].priority >= health.pending_actions[i - 1].priority,
                "Actions not sorted by urgency"
            );
        }
    }

    // ============ Risk Level Classification ============

    #[test]
    fn test_risk_level_boundaries() {
        assert_eq!(classify_risk_level(0), RiskLevel::Low);
        assert_eq!(classify_risk_level(20), RiskLevel::Low);
        assert_eq!(classify_risk_level(21), RiskLevel::Medium);
        assert_eq!(classify_risk_level(50), RiskLevel::Medium);
        assert_eq!(classify_risk_level(51), RiskLevel::High);
        assert_eq!(classify_risk_level(75), RiskLevel::High);
        assert_eq!(classify_risk_level(76), RiskLevel::Critical);
        assert_eq!(classify_risk_level(100), RiskLevel::Critical);
    }

    #[test]
    fn test_risk_score_capped_at_100() {
        // Even with everything terrible, score should cap at 100
        let health = ProtocolHealth {
            total_tvl: 0,
            total_borrows: 1_000_000 * PRECISION,
            utilization_bps: 10_000,
            vaults_assessed: 1,
            tier_counts: TierCounts {
                safe: 0, warning: 0, auto_deleverage: 0,
                soft_liquidation: 0, hard_liquidation: 1,
            },
            worst_health_factor: 0,
            insurance_coverage_bps: 0,
            pending_actions: vec![],
        };
        assert_eq!(risk_score(&health), 100);
    }

    // ============ Priority Mapping Edge Cases ============

    #[test]
    fn test_priority_at_exact_boundaries() {
        // Exactly at PRECISION (1.0x HF) — critical
        assert_eq!(health_factor_to_priority(PRECISION), 100);
        // Just below 1.0x — critical
        assert_eq!(health_factor_to_priority(PRECISION - 1), 0);
        // Exactly at 1.1x
        assert_eq!(health_factor_to_priority(PRECISION * 110 / 100), 200);
        // Exactly at 1.3x
        assert_eq!(health_factor_to_priority(PRECISION * 130 / 100), 300);
        // Exactly at 1.5x
        assert_eq!(health_factor_to_priority(PRECISION * 150 / 100), 1000);
        // Zero HF — critical
        assert_eq!(health_factor_to_priority(0), 0);
        // Max HF — safe
        assert_eq!(health_factor_to_priority(u128::MAX), 1000);
    }

    // ============ Insurance Coverage Edge Cases ============

    #[test]
    fn test_insurance_coverage_exceeds_borrows() {
        let pool = LendingPoolCellData {
            total_borrows: 10_000 * PRECISION,
            ..test_pool()
        };
        let insurance = InsurancePoolCellData {
            total_deposits: 50_000 * PRECISION, // 5x coverage
            ..test_insurance()
        };

        let health = assess_protocol(
            &[safe_vault(100 * PRECISION, 5_000 * PRECISION)],
            &pool, Some(&insurance),
            3000 * PRECISION, PRECISION,
        );
        // Coverage capped at 10000 bps (100%)
        assert_eq!(health.insurance_coverage_bps, 10_000);
    }

    #[test]
    fn test_insurance_coverage_zero_borrows() {
        let pool = LendingPoolCellData {
            total_borrows: 0,
            ..test_pool()
        };
        let insurance = test_insurance();

        let health = assess_protocol(
            &[], &pool, Some(&insurance),
            3000 * PRECISION, PRECISION,
        );
        // Zero borrows = fully covered
        assert_eq!(health.insurance_coverage_bps, 10_000);
    }

    // ============ Utilization Edge Cases ============

    #[test]
    fn test_utilization_zero_deposits() {
        let pool = LendingPoolCellData {
            total_deposits: 0,
            total_borrows: 0,
            ..test_pool()
        };

        let health = assess_protocol(&[], &pool, None, 3000 * PRECISION, PRECISION);
        assert_eq!(health.utilization_bps, 0);
    }

    #[test]
    fn test_utilization_100_percent() {
        let pool = LendingPoolCellData {
            total_deposits: 1_000_000 * PRECISION,
            total_borrows: 1_000_000 * PRECISION, // 100% utilization
            ..test_pool()
        };

        let health = assess_protocol(&[], &pool, None, 3000 * PRECISION, PRECISION);
        assert_eq!(health.utilization_bps, 10_000);
    }

    // ============ TVL Calculation ============

    #[test]
    fn test_tvl_with_different_debt_prices() {
        let pool = test_pool(); // 1M deposits

        // Debt price = 1.0
        let h1 = assess_protocol(&[], &pool, None, 3000 * PRECISION, PRECISION);
        // Debt price = 2.0 (e.g., debt token worth $2)
        let h2 = assess_protocol(&[], &pool, None, 3000 * PRECISION, 2 * PRECISION);

        assert_eq!(h2.total_tvl, h1.total_tvl * 2);
    }

    // ============ Large Portfolio Stress Tests ============

    #[test]
    fn test_assess_100_vaults() {
        let pool = test_pool();
        let mut vaults = Vec::new();
        for i in 0..100u128 {
            // Mix of safe and at-risk vaults
            let collateral = (10 + i) * PRECISION;
            let debt = (5_000 + i * 300) * PRECISION;
            vaults.push(safe_vault(collateral, debt));
        }

        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        assert_eq!(health.vaults_assessed, 100);
        assert!(health.tier_counts.safe > 0);
        // Actions should be sorted
        for i in 1..health.pending_actions.len() {
            assert!(health.pending_actions[i].priority >= health.pending_actions[i - 1].priority);
        }
    }

    // ============ Simulate Price Drop Edge Cases ============

    #[test]
    fn test_simulate_zero_drop() {
        let pool = test_pool();
        let vaults = vec![safe_vault(10 * PRECISION, 18_000 * PRECISION)];

        let normal = assess_protocol(&vaults, &pool, None, 3000 * PRECISION, PRECISION);
        let zero_drop = simulate_price_drop(&vaults, &pool, None, 3000 * PRECISION, PRECISION, 0);

        assert_eq!(normal.worst_health_factor, zero_drop.worst_health_factor);
    }

    #[test]
    fn test_simulate_99_percent_drop() {
        let pool = test_pool();
        let vaults = vec![safe_vault(10 * PRECISION, 1_000 * PRECISION)];

        let crashed = simulate_price_drop(&vaults, &pool, None, 3000 * PRECISION, PRECISION, 9900);
        // Price → $30. Almost everything should be liquidatable.
        assert!(crashed.worst_health_factor < PRECISION);
    }

    // ============ Risk Score Component Analysis ============

    #[test]
    fn test_risk_score_utilization_component() {
        // Test each utilization bracket
        let make_health = |util: u64| ProtocolHealth {
            total_tvl: PRECISION,
            total_borrows: PRECISION,
            utilization_bps: util,
            vaults_assessed: 1,
            tier_counts: TierCounts { safe: 1, ..Default::default() },
            worst_health_factor: u128::MAX,
            insurance_coverage_bps: 5000,
            pending_actions: vec![],
        };

        // Low util (< 50%) = 0 points
        let s1 = risk_score(&make_health(4000));
        // Medium util (50-80%) = 5 points
        let s2 = risk_score(&make_health(6000));
        // High util (80-90%) = 15 points
        let s3 = risk_score(&make_health(8500));
        // Critical util (>90%) = 25 points
        let s4 = risk_score(&make_health(9500));

        assert!(s4 > s3);
        assert!(s3 > s2);
        assert!(s2 > s1);
    }

    #[test]
    fn test_risk_score_insurance_component() {
        let make_health = |ins: u64| ProtocolHealth {
            total_tvl: PRECISION,
            total_borrows: PRECISION,
            utilization_bps: 0,
            vaults_assessed: 1,
            tier_counts: TierCounts { safe: 1, ..Default::default() },
            worst_health_factor: u128::MAX,
            insurance_coverage_bps: ins,
            pending_actions: vec![],
        };

        let no_ins = risk_score(&make_health(0));          // 25 points
        let low_ins = risk_score(&make_health(300));        // 20 points
        let med_ins = risk_score(&make_health(700));        // 10 points
        let good_ins = risk_score(&make_health(1500));      // 5 points
        let great_ins = risk_score(&make_health(5000));     // 0 points

        assert!(no_ins > low_ins);
        assert!(low_ins > med_ins);
        assert!(med_ins > good_ins);
        assert!(good_ins > great_ins);
    }

    // ============ Liquidation Threshold Edge Cases ============

    #[test]
    fn test_find_liquidation_threshold_no_vaults() {
        let pool = test_pool();
        let threshold = find_liquidation_threshold(
            &[], &pool, None, 3000 * PRECISION, PRECISION,
        );
        assert!(threshold.is_none());
    }

    #[test]
    fn test_find_liquidation_threshold_already_liquidatable() {
        let pool = test_pool();
        let vaults = vec![
            safe_vault(10 * PRECISION, 50_000 * PRECISION), // HF ≈ 0.48
        ];

        let threshold = find_liquidation_threshold(
            &vaults, &pool, None, 3000 * PRECISION, PRECISION,
        );

        assert!(threshold.is_some());
        assert_eq!(threshold.unwrap(), 0); // Already liquidatable at current price
    }

    // ============ Tier Counts Accuracy ============

    #[test]
    fn test_tier_counts_sum_equals_vaults() {
        let pool = test_pool();
        let vaults = vec![
            safe_vault(100 * PRECISION, 1_000 * PRECISION),  // Very safe
            safe_vault(10 * PRECISION, 15_000 * PRECISION),  // Moderate
            safe_vault(10 * PRECISION, 20_000 * PRECISION),  // At risk
            safe_vault(10 * PRECISION, 30_000 * PRECISION),  // Underwater
            safe_vault(10 * PRECISION, 25_000 * PRECISION),  // At risk
        ];

        let health = assess_protocol(
            &vaults, &pool, None, 3000 * PRECISION, PRECISION,
        );

        let total_in_tiers = health.tier_counts.safe
            + health.tier_counts.warning
            + health.tier_counts.auto_deleverage
            + health.tier_counts.soft_liquidation
            + health.tier_counts.hard_liquidation;

        assert_eq!(total_in_tiers, vaults.len(),
            "Tier counts should sum to vault count");
    }

    // ============ Pending Actions ============

    #[test]
    fn test_pending_actions_only_for_non_safe() {
        let pool = test_pool();
        let vaults = vec![
            safe_vault(100 * PRECISION, 1_000 * PRECISION),  // Very safe
            safe_vault(200 * PRECISION, 1_000 * PRECISION),  // Very safe
        ];

        let health = assess_protocol(
            &vaults, &pool, None, 3000 * PRECISION, PRECISION,
        );

        assert_eq!(health.tier_counts.safe, 2);
        assert!(health.pending_actions.is_empty(),
            "Safe vaults should generate no pending actions");
    }

    #[test]
    fn test_pending_actions_have_correct_vault_index() {
        let pool = test_pool();
        let vaults = vec![
            safe_vault(100 * PRECISION, 1_000 * PRECISION),  // index 0: safe
            safe_vault(10 * PRECISION, 30_000 * PRECISION),  // index 1: underwater
        ];

        let health = assess_protocol(
            &vaults, &pool, None, 3000 * PRECISION, PRECISION,
        );

        assert!(!health.pending_actions.is_empty());
        // The underwater vault is at index 1
        assert!(health.pending_actions.iter().any(|a| a.vault_index == 1));
        // Safe vault should NOT have an action
        assert!(!health.pending_actions.iter().any(|a| a.vault_index == 0));
    }

    // ============ New Tests: Edge Cases & Hardening ============

    #[test]
    fn test_assess_protocol_zero_collateral_zero_debt() {
        // A vault with zero collateral AND zero debt should be safe (no borrow obligation)
        let pool = test_pool();
        let vaults = vec![safe_vault(0, 0)];

        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        assert_eq!(health.vaults_assessed, 1);
        assert_eq!(health.tier_counts.safe, 1);
        assert!(health.pending_actions.is_empty());
    }

    #[test]
    fn test_assess_protocol_zero_collateral_with_debt() {
        // A vault with zero collateral but outstanding debt is deeply underwater
        let pool = test_pool();
        let vaults = vec![safe_vault(0, 10_000 * PRECISION)];

        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        assert_eq!(health.vaults_assessed, 1);
        // Should be in a liquidation tier since HF = 0
        assert!(health.tier_counts.hard_liquidation > 0
            || health.tier_counts.soft_liquidation > 0);
        assert!(!health.pending_actions.is_empty());
        assert!(health.worst_health_factor < PRECISION);
    }

    #[test]
    fn test_assess_protocol_single_dust_vault() {
        // Minimal amounts: 1 unit of collateral, 1 unit of debt
        let pool = test_pool();
        let vaults = vec![safe_vault(1, 1)];

        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        assert_eq!(health.vaults_assessed, 1);
        // With 1 unit collateral at $3000 and 1 unit debt at $1,
        // collateral value vastly exceeds debt — should be safe
        assert_eq!(health.tier_counts.safe, 1);
    }

    #[test]
    fn test_simulate_progressive_drops_monotonic_degradation() {
        // As price drops increase, health should monotonically degrade:
        // worst_health_factor should decrease or stay the same
        let pool = test_pool();
        let vaults = vec![
            safe_vault(10 * PRECISION, 12_000 * PRECISION),
            safe_vault(20 * PRECISION, 30_000 * PRECISION),
        ];

        let mut prev_hf = u128::MAX;
        for drop_bps in [0u64, 500, 1000, 2000, 3000, 5000, 7000] {
            let health = simulate_price_drop(
                &vaults, &pool, None,
                3000 * PRECISION, PRECISION, drop_bps,
            );
            assert!(
                health.worst_health_factor <= prev_hf,
                "HF should not improve as price drops further: drop={}bps, prev={}, curr={}",
                drop_bps, prev_hf, health.worst_health_factor,
            );
            prev_hf = health.worst_health_factor;
        }
    }

    #[test]
    fn test_risk_score_worst_hf_component() {
        // Isolate the worst-HF component of risk_score by holding everything else constant
        let make_health = |hf: u128| ProtocolHealth {
            total_tvl: PRECISION,
            total_borrows: PRECISION,
            utilization_bps: 0,
            vaults_assessed: 1,
            tier_counts: TierCounts { safe: 1, ..Default::default() },
            worst_health_factor: hf,
            insurance_coverage_bps: 5000,
            pending_actions: vec![],
        };

        // HF >= 1.5 → 0 points
        let s_safe = risk_score(&make_health(PRECISION * 200 / 100));
        // HF in [1.3, 1.5) → 5 points
        let s_watch = risk_score(&make_health(PRECISION * 140 / 100));
        // HF in [1.1, 1.3) → 10 points
        let s_caution = risk_score(&make_health(PRECISION * 120 / 100));
        // HF in [1.0, 1.1) → 20 points
        let s_danger = risk_score(&make_health(PRECISION * 105 / 100));
        // HF < 1.0 → 25 points
        let s_critical = risk_score(&make_health(PRECISION * 90 / 100));

        assert!(s_critical > s_danger);
        assert!(s_danger > s_caution);
        assert!(s_caution > s_watch);
        assert!(s_watch > s_safe);
    }

    #[test]
    fn test_risk_score_vault_distribution_component() {
        // Isolate the vault-risk-distribution component
        let make_health = |safe: usize, warning: usize, hard_liq: usize| ProtocolHealth {
            total_tvl: PRECISION,
            total_borrows: PRECISION,
            utilization_bps: 0,
            vaults_assessed: safe + warning + hard_liq,
            tier_counts: TierCounts {
                safe,
                warning,
                auto_deleverage: 0,
                soft_liquidation: 0,
                hard_liquidation: hard_liq,
            },
            worst_health_factor: u128::MAX,
            insurance_coverage_bps: 5000,
            pending_actions: vec![],
        };

        // All safe → 0 at-risk %
        let s_all_safe = risk_score(&make_health(10, 0, 0));
        // 1 warning out of 10 = 10% → 5 points
        let s_some = risk_score(&make_health(9, 1, 0));
        // 3 hard_liq out of 10 = 30% → 15 points
        let s_many = risk_score(&make_health(7, 0, 3));
        // 6 warning out of 10 = 60% → 25 points
        let s_most = risk_score(&make_health(4, 6, 0));

        assert!(s_most > s_many);
        assert!(s_many > s_some);
        assert!(s_some > s_all_safe);
    }

    #[test]
    fn test_find_liquidation_threshold_extremely_safe_vault() {
        // A vault so over-collateralized that even a 99% price drop can't liquidate it
        let pool = test_pool();
        let vaults = vec![
            safe_vault(1_000 * PRECISION, 1_000 * PRECISION), // HF ≈ 2400 at $3000
        ];

        let threshold = find_liquidation_threshold(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        // Even at 99% drop (price $30), HF = 24 — still safe. Should return None.
        assert!(threshold.is_none(),
            "Extremely over-collateralized vault should survive even 99% drop");
    }

    #[test]
    fn test_insurance_tiny_deposits() {
        // Insurance with very small deposits relative to borrows
        let pool = LendingPoolCellData {
            total_borrows: 1_000_000 * PRECISION,
            ..test_pool()
        };
        let insurance = InsurancePoolCellData {
            total_deposits: 100 * PRECISION, // 0.01% coverage
            ..test_insurance()
        };

        let health = assess_protocol(
            &[safe_vault(100 * PRECISION, 5_000 * PRECISION)],
            &pool, Some(&insurance),
            3000 * PRECISION, PRECISION,
        );

        // 100 / 1_000_000 = 0.0001 = 1 bps
        assert!(health.insurance_coverage_bps <= 1);
    }

    #[test]
    fn test_assess_protocol_all_hard_liquidation() {
        // Every vault is deeply underwater
        let pool = test_pool();
        let vaults = vec![
            safe_vault(1 * PRECISION, 50_000 * PRECISION),
            safe_vault(1 * PRECISION, 60_000 * PRECISION),
            safe_vault(1 * PRECISION, 70_000 * PRECISION),
        ];

        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        assert_eq!(health.vaults_assessed, 3);
        // All should be in liquidation tiers
        assert_eq!(health.tier_counts.safe, 0);
        assert_eq!(health.pending_actions.len(), 3,
            "Each underwater vault should generate an action");

        // Worst HF should be very low
        assert!(health.worst_health_factor < PRECISION / 2,
            "Worst HF should be far below 1.0");
    }

    #[test]
    fn test_risk_score_combined_max_stress() {
        // Combine multiple risk factors at their worst levels
        let pool = LendingPoolCellData {
            total_deposits: 1_000_000 * PRECISION,
            total_borrows: 990_000 * PRECISION, // 99% utilization
            ..test_pool()
        };

        let vaults = vec![
            safe_vault(1 * PRECISION, 50_000 * PRECISION), // HF << 1.0
            safe_vault(1 * PRECISION, 60_000 * PRECISION),
            safe_vault(1 * PRECISION, 70_000 * PRECISION),
        ];

        let health = assess_protocol(
            &vaults, &pool, None, // No insurance
            3000 * PRECISION, PRECISION,
        );

        let score = risk_score(&health);
        // 99% util → 25, no insurance → 25, 100% at risk → 25, HF << 1.0 → 25 = 100
        assert_eq!(score, 100, "Maximum stress should hit the cap of 100");
        assert_eq!(classify_risk_level(score), RiskLevel::Critical);
    }

    #[test]
    fn test_simulate_price_drop_with_insurance_coverage() {
        // Verify insurance coverage is recalculated correctly under stress
        let pool = test_pool();
        let insurance = test_insurance(); // 100K deposits
        let vaults = vec![safe_vault(50 * PRECISION, 10_000 * PRECISION)];

        let normal = assess_protocol(
            &vaults, &pool, Some(&insurance),
            3000 * PRECISION, PRECISION,
        );

        let stressed = simulate_price_drop(
            &vaults, &pool, Some(&insurance),
            3000 * PRECISION, PRECISION, 5000, // 50% drop
        );

        // Insurance coverage should remain the same (it depends on pool borrows,
        // not collateral price)
        assert_eq!(normal.insurance_coverage_bps, stressed.insurance_coverage_bps);

        // But vault health should degrade
        assert!(stressed.worst_health_factor < normal.worst_health_factor);
    }
}
