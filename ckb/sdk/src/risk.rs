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

    // ============ Additional Edge Case & Hardening Tests ============

    #[test]
    fn test_risk_score_zero_vaults_assessed() {
        // With zero vaults assessed, at-risk percentage = 0/1 = 0
        let health = ProtocolHealth {
            total_tvl: PRECISION,
            total_borrows: PRECISION,
            utilization_bps: 0,
            vaults_assessed: 0,
            tier_counts: TierCounts::default(),
            worst_health_factor: u128::MAX,
            insurance_coverage_bps: 5000,
            pending_actions: vec![],
        };
        // Should not panic on division (uses .max(1))
        let score = risk_score(&health);
        assert!(score <= 100, "Score should be valid even with 0 vaults");
    }

    #[test]
    fn test_priority_monotonically_increases_with_hf() {
        // As HF increases, priority should increase (become less urgent)
        let hfs = [
            0,
            PRECISION / 2,
            PRECISION - 1,
            PRECISION,
            PRECISION * 105 / 100,
            PRECISION * 110 / 100,
            PRECISION * 120 / 100,
            PRECISION * 130 / 100,
            PRECISION * 140 / 100,
            PRECISION * 150 / 100,
            PRECISION * 200 / 100,
        ];

        let mut prev_priority = 0u64;
        for &hf in &hfs {
            let priority = health_factor_to_priority(hf);
            assert!(priority >= prev_priority,
                "Priority should be non-decreasing as HF increases: hf={}, prev={}, curr={}",
                hf, prev_priority, priority);
            prev_priority = priority;
        }
    }

    #[test]
    fn test_classify_risk_level_full_range() {
        // Test every score from 0 to 100
        for score in 0..=100u64 {
            let level = classify_risk_level(score);
            match score {
                0..=20 => assert_eq!(level, RiskLevel::Low, "score={}", score),
                21..=50 => assert_eq!(level, RiskLevel::Medium, "score={}", score),
                51..=75 => assert_eq!(level, RiskLevel::High, "score={}", score),
                76..=100 => assert_eq!(level, RiskLevel::Critical, "score={}", score),
                _ => unreachable!(),
            }
        }
    }

    #[test]
    fn test_classify_risk_level_above_100() {
        // Score > 100 should still classify as Critical
        assert_eq!(classify_risk_level(150), RiskLevel::Critical);
        assert_eq!(classify_risk_level(u64::MAX), RiskLevel::Critical);
    }

    #[test]
    fn test_assess_protocol_single_vault_no_debt() {
        // A single vault with zero debt should be safe
        let pool = test_pool();
        let vaults = vec![safe_vault(100 * PRECISION, 0)];

        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        assert_eq!(health.vaults_assessed, 1);
        assert_eq!(health.tier_counts.safe, 1);
        assert!(health.pending_actions.is_empty());
        assert_eq!(health.worst_health_factor, u128::MAX);
    }

    #[test]
    fn test_simulate_price_drop_preserves_vault_count() {
        // Simulating a price drop should not change the number of vaults assessed
        let pool = test_pool();
        let vaults = vec![
            safe_vault(50 * PRECISION, 10_000 * PRECISION),
            safe_vault(100 * PRECISION, 5_000 * PRECISION),
            safe_vault(20 * PRECISION, 15_000 * PRECISION),
        ];

        for drop_bps in [0u64, 1000, 3000, 5000, 9000] {
            let health = simulate_price_drop(
                &vaults, &pool, None,
                3000 * PRECISION, PRECISION, drop_bps,
            );
            assert_eq!(health.vaults_assessed, 3,
                "Vault count should not change with price drop={}bps", drop_bps);
        }
    }

    #[test]
    fn test_risk_score_all_vaults_at_risk() {
        // 100% of vaults at risk should give max vault distribution component (25 points)
        let health = ProtocolHealth {
            total_tvl: PRECISION,
            total_borrows: PRECISION,
            utilization_bps: 0,
            vaults_assessed: 5,
            tier_counts: TierCounts {
                safe: 0,
                warning: 0,
                auto_deleverage: 0,
                soft_liquidation: 2,
                hard_liquidation: 3,
            },
            worst_health_factor: u128::MAX,
            insurance_coverage_bps: 5000,
            pending_actions: vec![],
        };
        let score = risk_score(&health);
        // 100% at-risk = 25 vault component, 0 util, 0 insurance component, 0 hf component
        assert!(score >= 25, "All vaults at risk should contribute 25 points, got {}", score);
    }

    #[test]
    fn test_find_liquidation_threshold_multiple_vaults_different_risk() {
        // Multiple vaults — threshold should be determined by the weakest vault
        let pool = test_pool();
        let vaults = vec![
            safe_vault(100 * PRECISION, 5_000 * PRECISION),  // Very safe (HF ≈ 4.8)
            safe_vault(10 * PRECISION, 18_000 * PRECISION),  // Moderate (HF ≈ 1.33)
        ];

        let threshold = find_liquidation_threshold(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        // Should find a threshold driven by the weaker vault (index 1)
        assert!(threshold.is_some());
        let bps = threshold.unwrap();

        // After this drop, at least one vault should be liquidatable
        let stressed = simulate_price_drop(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION, bps,
        );
        assert!(stressed.tier_counts.hard_liquidation > 0 || stressed.tier_counts.soft_liquidation > 0,
            "At threshold drop of {}bps, at least one vault should be liquidatable", bps);
    }

    #[test]
    fn test_tvl_zero_debt_price() {
        // If debt price is zero, TVL should be zero (deposits valued at 0)
        let pool = test_pool();
        let health = assess_protocol(&[], &pool, None, 3000 * PRECISION, 0);
        assert_eq!(health.total_tvl, 0);
    }

    #[test]
    fn test_pending_actions_count_matches_non_safe_tiers() {
        // Number of pending actions should equal total non-safe vaults
        let pool = test_pool();
        let vaults = vec![
            safe_vault(100 * PRECISION, 1_000 * PRECISION),  // safe
            safe_vault(100 * PRECISION, 2_000 * PRECISION),  // safe
            safe_vault(10 * PRECISION, 30_000 * PRECISION),  // underwater
            safe_vault(10 * PRECISION, 25_000 * PRECISION),  // at risk
        ];

        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        let non_safe = health.tier_counts.warning
            + health.tier_counts.auto_deleverage
            + health.tier_counts.soft_liquidation
            + health.tier_counts.hard_liquidation;

        assert_eq!(health.pending_actions.len(), non_safe,
            "Pending actions ({}) should match non-safe vault count ({})",
            health.pending_actions.len(), non_safe);
    }

    // ============ New Edge Case & Boundary Tests ============

    #[test]
    fn test_assess_protocol_all_zero_debt_vaults() {
        // Multiple vaults with zero debt should all be safe
        let pool = test_pool();
        let vaults: Vec<VaultCellData> = (0..10)
            .map(|i| safe_vault((i + 1) * PRECISION, 0))
            .collect();

        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        assert_eq!(health.vaults_assessed, 10);
        assert_eq!(health.tier_counts.safe, 10);
        assert!(health.pending_actions.is_empty());
        assert_eq!(health.worst_health_factor, u128::MAX);
    }

    #[test]
    fn test_simulate_progressive_drops_tier_transition() {
        // As price drops, tiers should transition: Safe → Warning → ... → HardLiq
        let pool = test_pool();
        // HF = (10 * price * 0.8) / 15000
        // At $3000: HF = 1.6 → Safe
        // At $2000: HF = 1.07 → SoftLiquidation
        // At $1500: HF = 0.8 → HardLiquidation
        let vaults = vec![safe_vault(15_000 * PRECISION, 10 * PRECISION)];

        let no_drop = assess_protocol(
            &vaults, &pool, None, 3000 * PRECISION, PRECISION,
        );
        let moderate_drop = simulate_price_drop(
            &vaults, &pool, None, 3000 * PRECISION, PRECISION, 3500, // 35% drop → $1950
        );
        let severe_drop = simulate_price_drop(
            &vaults, &pool, None, 3000 * PRECISION, PRECISION, 5000, // 50% drop → $1500
        );

        assert_eq!(no_drop.tier_counts.safe, 1);
        assert!(moderate_drop.worst_health_factor < no_drop.worst_health_factor,
            "35% drop should degrade health");
        assert!(severe_drop.worst_health_factor < moderate_drop.worst_health_factor,
            "50% drop should further degrade health");
    }

    #[test]
    fn test_risk_score_only_utilization_component() {
        // Zero vaults, good insurance → only utilization affects score
        let make_health = |util: u64| ProtocolHealth {
            total_tvl: PRECISION,
            total_borrows: PRECISION,
            utilization_bps: util,
            vaults_assessed: 0,
            tier_counts: TierCounts::default(),
            worst_health_factor: u128::MAX,
            insurance_coverage_bps: 10_000, // 100% coverage
            pending_actions: vec![],
        };

        let s_low = risk_score(&make_health(3000));   // < 50% → 0 pts
        let s_mid = risk_score(&make_health(6000));   // 50-80% → 5 pts
        let s_high = risk_score(&make_health(8500));   // 80-90% → 15 pts
        let s_crit = risk_score(&make_health(9500));   // > 90% → 25 pts

        assert_eq!(s_low, 0, "Low utilization with max insurance should be 0");
        assert_eq!(s_mid, 5);
        assert_eq!(s_high, 15);
        assert_eq!(s_crit, 25);
    }

    #[test]
    fn test_find_liquidation_threshold_very_tight_margin() {
        // Vault barely above liquidation — threshold should be very small
        let pool = test_pool();
        // HF = (10 * 3000 * 0.8) / 22000 = 1.09 → just above soft liquidation
        let vaults = vec![safe_vault(10 * PRECISION, 22_000 * PRECISION)];

        let threshold = find_liquidation_threshold(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        assert!(threshold.is_some());
        let bps = threshold.unwrap();
        // Should need very small drop to trigger (< 15%)
        assert!(bps < 1500, "Tight margin vault should need < 15% drop, got {}bps", bps);
    }

    #[test]
    fn test_assess_protocol_utilization_edge_over_100() {
        // Borrows > deposits → utilization > 100%
        let pool = LendingPoolCellData {
            total_deposits: 500_000 * PRECISION,
            total_borrows: 600_000 * PRECISION, // 120% utilization
            ..test_pool()
        };

        let health = assess_protocol(&[], &pool, None, 3000 * PRECISION, PRECISION);
        // 600K / 500K = 1.2 = 12000 bps
        assert_eq!(health.utilization_bps, 12_000,
            "Utilization can exceed 10_000 bps when borrows > deposits");
    }

    #[test]
    fn test_pending_actions_all_critical_same_priority() {
        // All vaults deeply underwater → all should have priority 0
        let pool = test_pool();
        let vaults = vec![
            safe_vault(1 * PRECISION, 100_000 * PRECISION),
            safe_vault(1 * PRECISION, 200_000 * PRECISION),
            safe_vault(1 * PRECISION, 300_000 * PRECISION),
        ];

        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        for action in &health.pending_actions {
            assert_eq!(action.priority, 0,
                "All deeply underwater vaults should have critical priority (0)");
            assert!(action.health_factor < PRECISION);
        }
    }

    #[test]
    fn test_simulate_price_drop_does_not_modify_input() {
        // Verify that simulate_price_drop is a pure function — input vaults unchanged
        let pool = test_pool();
        let vaults = vec![safe_vault(10 * PRECISION, 18_000 * PRECISION)];
        let vault_clone = vaults.clone();

        let _ = simulate_price_drop(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION, 5000,
        );

        // Original vault data should be unchanged
        assert_eq!(vaults[0].collateral_amount, vault_clone[0].collateral_amount);
        assert_eq!(vaults[0].debt_shares, vault_clone[0].debt_shares);
    }

    #[test]
    fn test_find_liquidation_threshold_binary_search_precision() {
        // Verify the threshold found is the tightest possible (within 1 bps accuracy)
        let pool = test_pool();
        let vaults = vec![safe_vault(10 * PRECISION, 18_000 * PRECISION)];

        let threshold = find_liquidation_threshold(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );
        assert!(threshold.is_some());
        let bps = threshold.unwrap();

        // At (bps - 1), should NOT be liquidatable
        if bps > 0 {
            let below = simulate_price_drop(
                &vaults, &pool, None,
                3000 * PRECISION, PRECISION, bps - 1,
            );
            assert_eq!(below.tier_counts.hard_liquidation + below.tier_counts.soft_liquidation, 0,
                "At {}bps (1 below threshold), no vault should be liquidatable", bps - 1);
        }

        // At bps, should be liquidatable
        let at_threshold = simulate_price_drop(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION, bps,
        );
        assert!(at_threshold.tier_counts.hard_liquidation + at_threshold.tier_counts.soft_liquidation > 0,
            "At threshold {}bps, at least one vault should be liquidatable", bps);
    }

    #[test]
    fn test_tvl_scales_linearly_with_deposits() {
        // TVL should scale linearly with total_deposits
        let pool_1m = test_pool(); // 1M deposits
        let pool_2m = LendingPoolCellData {
            total_deposits: 2_000_000 * PRECISION,
            ..test_pool()
        };

        let h1 = assess_protocol(&[], &pool_1m, None, 3000 * PRECISION, PRECISION);
        let h2 = assess_protocol(&[], &pool_2m, None, 3000 * PRECISION, PRECISION);

        assert_eq!(h2.total_tvl, h1.total_tvl * 2,
            "TVL should scale linearly with deposits");
    }

    #[test]
    fn test_risk_score_minimum_possible() {
        // The absolute minimum risk score: healthy everything
        let health = ProtocolHealth {
            total_tvl: PRECISION,
            total_borrows: PRECISION,
            utilization_bps: 0,       // < 50% → 0 pts
            vaults_assessed: 10,
            tier_counts: TierCounts { safe: 10, ..Default::default() }, // 0% at risk → 0 pts
            worst_health_factor: u128::MAX, // Very safe → 0 pts
            insurance_coverage_bps: 10_000, // 100% coverage → 0 pts
            pending_actions: vec![],
        };

        assert_eq!(risk_score(&health), 0,
            "Perfect health should produce risk score of 0");
        assert_eq!(classify_risk_level(0), RiskLevel::Low);
    }

    // ============ Batch 4: Additional Coverage Tests ============

    #[test]
    fn test_health_factor_to_priority_just_above_thresholds() {
        // Test values just above each threshold boundary
        // Just above 1.0 → priority 100
        assert_eq!(health_factor_to_priority(PRECISION + 1), 100);
        // Just above 1.1 → priority 200
        assert_eq!(health_factor_to_priority(PRECISION * 110 / 100 + 1), 200);
        // Just above 1.3 → priority 300
        assert_eq!(health_factor_to_priority(PRECISION * 130 / 100 + 1), 300);
        // Just above 1.5 → priority 1000
        assert_eq!(health_factor_to_priority(PRECISION * 150 / 100 + 1), 1000);
    }

    #[test]
    fn test_assess_protocol_mixed_tiers_all_represented() {
        // Create vaults at different risk levels to cover all tier buckets
        let pool = test_pool();
        let vaults = vec![
            safe_vault(100 * PRECISION, 5_000 * PRECISION),   // HF ≈ 4.8 → Safe
            safe_vault(10 * PRECISION, 17_000 * PRECISION),   // HF ≈ 1.41 → Warning/Warn
            safe_vault(10 * PRECISION, 20_000 * PRECISION),   // HF ≈ 1.2 → AutoDeleverage
            safe_vault(10 * PRECISION, 25_000 * PRECISION),   // HF ≈ 0.96 → SoftLiq or HardLiq
            safe_vault(10 * PRECISION, 40_000 * PRECISION),   // HF ≈ 0.6 → HardLiq
        ];

        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        assert_eq!(health.vaults_assessed, 5);
        let total_in_tiers = health.tier_counts.safe
            + health.tier_counts.warning
            + health.tier_counts.auto_deleverage
            + health.tier_counts.soft_liquidation
            + health.tier_counts.hard_liquidation;
        assert_eq!(total_in_tiers, 5, "All vaults must be categorized into a tier");
        assert!(health.tier_counts.safe >= 1, "At least one vault should be safe");
    }

    #[test]
    fn test_simulate_full_drop_9900_bps() {
        // 99% drop → price becomes 1% of original
        let pool = test_pool();
        let vaults = vec![safe_vault(100 * PRECISION, 5_000 * PRECISION)];

        let health = simulate_price_drop(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION, 9900,
        );

        // At $30 (1% of $3000): HF = (100 * 30 * 0.8) / 5000 = 0.48
        assert!(health.worst_health_factor < PRECISION,
            "99% drop should put vault underwater");
    }

    #[test]
    fn test_insurance_coverage_partial() {
        // Partial coverage: 50K insurance on 500K borrows = 10% = 1000 bps
        let pool = test_pool(); // 500K borrows
        let insurance = InsurancePoolCellData {
            total_deposits: 50_000 * PRECISION,
            ..test_insurance()
        };

        let health = assess_protocol(
            &[], &pool, Some(&insurance),
            3000 * PRECISION, PRECISION,
        );

        assert_eq!(health.insurance_coverage_bps, 1000,
            "50K/500K = 10% = 1000 bps");
    }

    #[test]
    fn test_risk_score_boundary_21_medium() {
        // Score of exactly 21 should be Medium (not Low)
        assert_eq!(classify_risk_level(21), RiskLevel::Medium);
    }

    #[test]
    fn test_risk_score_boundary_51_high() {
        // Score of exactly 51 should be High (not Medium)
        assert_eq!(classify_risk_level(51), RiskLevel::High);
    }

    #[test]
    fn test_risk_score_boundary_76_critical() {
        // Score of exactly 76 should be Critical (not High)
        assert_eq!(classify_risk_level(76), RiskLevel::Critical);
    }

    #[test]
    fn test_assess_protocol_worst_hf_tracks_minimum() {
        // worst_health_factor must be the minimum across all vaults
        let pool = test_pool();
        let vaults = vec![
            safe_vault(100 * PRECISION, 1_000 * PRECISION),  // Very safe HF
            safe_vault(10 * PRECISION, 18_000 * PRECISION),  // Moderate HF ≈ 1.33
            safe_vault(100 * PRECISION, 2_000 * PRECISION),  // Very safe HF
        ];

        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        // The moderate vault (index 1) should have the worst HF
        // HF = (10 * 3000 * 0.8) / 18000 = 1.33
        let expected_worst = vibeswap_math::mul_div(
            vibeswap_math::mul_div(10 * PRECISION, 3000 * PRECISION, PRECISION),
            DEFAULT_LIQUIDATION_THRESHOLD,
            vibeswap_math::mul_div(18_000 * PRECISION, PRECISION, PRECISION),
        );
        assert_eq!(health.worst_health_factor, expected_worst);
    }

    #[test]
    fn test_simulate_price_drop_with_multiple_insurance_levels() {
        // Insurance coverage stays constant as price drops (depends on borrows, not price)
        let pool = test_pool();
        let insurance = test_insurance();
        let vaults = vec![safe_vault(100 * PRECISION, 5_000 * PRECISION)];

        let drops = [0u64, 1000, 3000, 5000, 8000];
        for &drop in &drops {
            let health = simulate_price_drop(
                &vaults, &pool, Some(&insurance),
                3000 * PRECISION, PRECISION, drop,
            );
            assert_eq!(health.insurance_coverage_bps, 2000,
                "Insurance coverage should be constant at drop={}bps", drop);
        }
    }

    // ============ Batch 5: New Edge Case, Boundary, and Overflow Tests ============

    #[test]
    fn test_health_factor_to_priority_mid_range_values() {
        // Values in the middle of each bucket should return the correct priority
        // Mid of [0, PRECISION): e.g., PRECISION / 2
        assert_eq!(health_factor_to_priority(PRECISION / 2), 0);
        // Mid of [PRECISION, 1.1*PRECISION): e.g., 1.05 * PRECISION
        assert_eq!(health_factor_to_priority(PRECISION * 105 / 100), 100);
        // Mid of [1.1, 1.3): e.g., 1.2 * PRECISION
        assert_eq!(health_factor_to_priority(PRECISION * 120 / 100), 200);
        // Mid of [1.3, 1.5): e.g., 1.4 * PRECISION
        assert_eq!(health_factor_to_priority(PRECISION * 140 / 100), 300);
        // Well above 1.5: e.g., 5.0 * PRECISION
        assert_eq!(health_factor_to_priority(PRECISION * 500 / 100), 1000);
    }

    #[test]
    fn test_risk_score_utilization_exact_boundaries() {
        // Test risk_score at exact utilization boundary values (5000, 8000, 9000)
        let make_health = |util: u64| ProtocolHealth {
            total_tvl: PRECISION,
            total_borrows: PRECISION,
            utilization_bps: util,
            vaults_assessed: 1,
            tier_counts: TierCounts { safe: 1, ..Default::default() },
            worst_health_factor: u128::MAX,
            insurance_coverage_bps: 10_000,
            pending_actions: vec![],
        };

        // Exactly 5000 → 0 (match arm is > 5000)
        let s_5000 = risk_score(&make_health(5000));
        // Exactly 5001 → 5
        let s_5001 = risk_score(&make_health(5001));
        // Exactly 8000 → 5 (match arm is > 8000)
        let s_8000 = risk_score(&make_health(8000));
        // Exactly 8001 → 15
        let s_8001 = risk_score(&make_health(8001));
        // Exactly 9000 → 15 (match arm is > 9000)
        let s_9000 = risk_score(&make_health(9000));
        // Exactly 9001 → 25
        let s_9001 = risk_score(&make_health(9001));

        assert_eq!(s_5000, 0, "At exactly 5000 bps, util component should be 0");
        assert_eq!(s_5001, 5, "At 5001 bps, util component should be 5");
        assert_eq!(s_8000, 5, "At exactly 8000 bps, util component should be 5");
        assert_eq!(s_8001, 15, "At 8001 bps, util component should be 15");
        assert_eq!(s_9000, 15, "At exactly 9000 bps, util component should be 15");
        assert_eq!(s_9001, 25, "At 9001 bps, util component should be 25");
    }

    #[test]
    fn test_risk_score_insurance_exact_boundaries() {
        // Test risk_score at exact insurance boundary values (500, 1000, 2000)
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

        // Exactly 500 → 10 (match arm is < 1000)
        let s_500 = risk_score(&make_health(500));
        // Exactly 499 → 20 (match arm is < 500)
        let s_499 = risk_score(&make_health(499));
        // Exactly 1000 → 5 (match arm is < 2000)
        let s_1000 = risk_score(&make_health(1000));
        // Exactly 999 → 10 (match arm is < 1000)
        let s_999 = risk_score(&make_health(999));
        // Exactly 2000 → 0 (match arm is _)
        let s_2000 = risk_score(&make_health(2000));
        // Exactly 1999 → 5 (match arm is < 2000)
        let s_1999 = risk_score(&make_health(1999));

        assert_eq!(s_499, 20);
        assert_eq!(s_500, 10);
        assert_eq!(s_999, 10);
        assert_eq!(s_1000, 5);
        assert_eq!(s_1999, 5);
        assert_eq!(s_2000, 0);
    }

    #[test]
    fn test_risk_score_worst_hf_exact_boundaries() {
        // Test risk_score worst-HF component at exact boundary values
        let make_health = |hf: u128| ProtocolHealth {
            total_tvl: PRECISION,
            total_borrows: PRECISION,
            utilization_bps: 0,
            vaults_assessed: 1,
            tier_counts: TierCounts { safe: 1, ..Default::default() },
            worst_health_factor: hf,
            insurance_coverage_bps: 10_000,
            pending_actions: vec![],
        };

        // Exactly PRECISION (1.0) → 20 (is in [1.0, 1.1) range)
        assert_eq!(risk_score(&make_health(PRECISION)), 20);
        // Exactly PRECISION - 1 (just below 1.0) → 25
        assert_eq!(risk_score(&make_health(PRECISION - 1)), 25);
        // Exactly 1.1 * PRECISION → 10 (in [1.1, 1.3) range)
        assert_eq!(risk_score(&make_health(PRECISION * 110 / 100)), 10);
        // Exactly 1.1 * PRECISION - 1 → 20 (in [1.0, 1.1) range)
        assert_eq!(risk_score(&make_health(PRECISION * 110 / 100 - 1)), 20);
        // Exactly 1.3 * PRECISION → 5 (in [1.3, 1.5) range)
        assert_eq!(risk_score(&make_health(PRECISION * 130 / 100)), 5);
        // Exactly 1.5 * PRECISION → 0
        assert_eq!(risk_score(&make_health(PRECISION * 150 / 100)), 0);
    }

    #[test]
    fn test_risk_score_vault_distribution_exact_boundaries() {
        // Test at-risk-percentage boundaries: 0%, 1%, 10%, 11%, 25%, 26%, 50%, 51%
        let make_health = |safe: usize, at_risk: usize| ProtocolHealth {
            total_tvl: PRECISION,
            total_borrows: PRECISION,
            utilization_bps: 0,
            vaults_assessed: safe + at_risk,
            tier_counts: TierCounts {
                safe,
                warning: at_risk,
                ..Default::default()
            },
            worst_health_factor: u128::MAX,
            insurance_coverage_bps: 10_000,
            pending_actions: vec![],
        };

        // 0% at risk → 0 points
        assert_eq!(risk_score(&make_health(100, 0)), 0);
        // 1/100 = 1% at risk → 5 points (> 0%)
        assert_eq!(risk_score(&make_health(99, 1)), 5);
        // 10/100 = 10% → 5 points (> 0% but not > 10%)
        assert_eq!(risk_score(&make_health(90, 10)), 5);
        // 11/100 = 11% → 10 points (> 10%)
        assert_eq!(risk_score(&make_health(89, 11)), 10);
        // 25/100 = 25% → 10 points (> 10% but not > 25%)
        assert_eq!(risk_score(&make_health(75, 25)), 10);
        // 26/100 = 26% → 15 points (> 25%)
        assert_eq!(risk_score(&make_health(74, 26)), 15);
        // 50/100 = 50% → 15 points (> 25% but not > 50%)
        assert_eq!(risk_score(&make_health(50, 50)), 15);
        // 51/100 = 51% → 25 points (> 50%)
        assert_eq!(risk_score(&make_health(49, 51)), 25);
    }

    #[test]
    fn test_assess_protocol_large_collateral_price() {
        // Extremely high collateral price — should not overflow, vaults should be safe
        let pool = test_pool();
        let vaults = vec![safe_vault(1 * PRECISION, 1_000 * PRECISION)];

        let health = assess_protocol(
            &vaults, &pool, None,
            1_000_000 * PRECISION, PRECISION, // $1M/token price
        );

        assert_eq!(health.tier_counts.safe, 1);
        assert!(health.worst_health_factor > PRECISION * 100);
    }

    #[test]
    fn test_assess_protocol_very_low_collateral_price() {
        // Very low collateral price — pushes all vaults underwater
        let pool = test_pool();
        let vaults = vec![
            safe_vault(100 * PRECISION, 5_000 * PRECISION),
        ];

        // At $0.01 per token
        let health = assess_protocol(
            &vaults, &pool, None,
            PRECISION / 100, PRECISION,
        );

        // HF = (100 * 0.01 * 0.8) / 5000 = 0.00016 — deeply underwater
        assert!(health.worst_health_factor < PRECISION);
        assert_eq!(health.tier_counts.safe, 0);
    }

    #[test]
    fn test_assess_protocol_equal_collateral_and_debt_price() {
        // When collateral and debt prices are equal, HF depends purely on amounts
        let pool = test_pool();
        let vaults = vec![safe_vault(100 * PRECISION, 50 * PRECISION)];

        let health = assess_protocol(
            &vaults, &pool, None,
            PRECISION, PRECISION, // both $1
        );

        // HF = (100 * 1 * 0.8) / 50 = 1.6 → Safe
        assert_eq!(health.tier_counts.safe, 1);
    }

    #[test]
    fn test_simulate_price_drop_1_bps() {
        // Smallest possible price drop (1 basis point = 0.01%)
        let pool = test_pool();
        let vaults = vec![safe_vault(10 * PRECISION, 18_000 * PRECISION)];

        let normal = assess_protocol(&vaults, &pool, None, 3000 * PRECISION, PRECISION);
        let tiny_drop = simulate_price_drop(
            &vaults, &pool, None, 3000 * PRECISION, PRECISION, 1,
        );

        // Health should degrade by a tiny amount
        assert!(tiny_drop.worst_health_factor <= normal.worst_health_factor);
        assert_eq!(tiny_drop.vaults_assessed, normal.vaults_assessed);
    }

    #[test]
    fn test_find_liquidation_threshold_all_vaults_no_debt() {
        // Multiple vaults, all with zero debt
        let pool = test_pool();
        let vaults = vec![
            safe_vault(100 * PRECISION, 0),
            safe_vault(200 * PRECISION, 0),
            safe_vault(50 * PRECISION, 0),
        ];

        let threshold = find_liquidation_threshold(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );
        assert!(threshold.is_none(),
            "No debt means no liquidation possible");
    }

    #[test]
    fn test_find_liquidation_threshold_mix_debt_and_no_debt() {
        // Some vaults have debt, some don't. Threshold depends on the one with debt.
        let pool = test_pool();
        let vaults = vec![
            safe_vault(100 * PRECISION, 0),                      // No debt
            safe_vault(10 * PRECISION, 18_000 * PRECISION),      // Has debt, HF ≈ 1.33
            safe_vault(200 * PRECISION, 0),                      // No debt
        ];

        let threshold = find_liquidation_threshold(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );
        assert!(threshold.is_some(),
            "Vaults with debt should trigger threshold search");
    }

    #[test]
    fn test_pending_actions_vault_index_range() {
        // Verify all vault_index values in pending_actions are valid indices
        let pool = test_pool();
        let vaults = vec![
            safe_vault(100 * PRECISION, 5_000 * PRECISION),   // safe
            safe_vault(10 * PRECISION, 30_000 * PRECISION),   // underwater
            safe_vault(100 * PRECISION, 2_000 * PRECISION),   // safe
            safe_vault(10 * PRECISION, 25_000 * PRECISION),   // at risk
            safe_vault(10 * PRECISION, 40_000 * PRECISION),   // underwater
        ];

        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        for action in &health.pending_actions {
            assert!(action.vault_index < vaults.len(),
                "vault_index {} is out of range [0, {})",
                action.vault_index, vaults.len());
        }
    }

    #[test]
    fn test_pending_actions_no_duplicate_vault_indices() {
        // Each vault should appear at most once in pending_actions
        let pool = test_pool();
        let vaults = vec![
            safe_vault(100 * PRECISION, 5_000 * PRECISION),
            safe_vault(10 * PRECISION, 30_000 * PRECISION),
            safe_vault(10 * PRECISION, 25_000 * PRECISION),
            safe_vault(10 * PRECISION, 40_000 * PRECISION),
        ];

        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        let mut seen_indices: Vec<usize> = health.pending_actions.iter()
            .map(|a| a.vault_index)
            .collect();
        let original_len = seen_indices.len();
        seen_indices.sort();
        seen_indices.dedup();
        assert_eq!(seen_indices.len(), original_len,
            "No vault should appear twice in pending_actions");
    }

    #[test]
    fn test_assess_protocol_tvl_uses_debt_price_not_collateral_price() {
        // TVL is total_deposits * debt_price / PRECISION, NOT dependent on collateral_price
        let pool = test_pool(); // 1M deposits

        let h1 = assess_protocol(&[], &pool, None, 1000 * PRECISION, PRECISION);
        let h2 = assess_protocol(&[], &pool, None, 5000 * PRECISION, PRECISION);

        // TVL should be the same regardless of collateral price
        assert_eq!(h1.total_tvl, h2.total_tvl,
            "TVL depends on debt_price, not collateral_price");
    }

    #[test]
    fn test_risk_score_single_vault_in_each_non_safe_tier() {
        // 1 warning, 1 auto_deleverage, 1 soft_liq, 1 hard_liq out of 10 = 40% at risk
        let health = ProtocolHealth {
            total_tvl: PRECISION,
            total_borrows: PRECISION,
            utilization_bps: 0,
            vaults_assessed: 10,
            tier_counts: TierCounts {
                safe: 6,
                warning: 1,
                auto_deleverage: 1,
                soft_liquidation: 1,
                hard_liquidation: 1,
            },
            worst_health_factor: u128::MAX,
            insurance_coverage_bps: 10_000,
            pending_actions: vec![],
        };

        let score = risk_score(&health);
        // 4/10 = 40% → > 25% → 15 points
        assert_eq!(score, 15,
            "40% at-risk with no other factors should give 15, got {}", score);
    }

    #[test]
    fn test_assess_protocol_total_borrows_field() {
        // Verify total_borrows in ProtocolHealth matches the lending pool's total_borrows
        let pool = LendingPoolCellData {
            total_borrows: 777_000 * PRECISION,
            ..test_pool()
        };

        let health = assess_protocol(&[], &pool, None, 3000 * PRECISION, PRECISION);
        assert_eq!(health.total_borrows, 777_000 * PRECISION,
            "total_borrows should pass through from lending pool");
    }

    #[test]
    fn test_insurance_coverage_exactly_equal_to_borrows() {
        // Insurance deposits == total borrows → exactly 100% coverage
        let pool = LendingPoolCellData {
            total_borrows: 100_000 * PRECISION,
            ..test_pool()
        };
        let insurance = InsurancePoolCellData {
            total_deposits: 100_000 * PRECISION,
            ..test_insurance()
        };

        let health = assess_protocol(
            &[], &pool, Some(&insurance),
            3000 * PRECISION, PRECISION,
        );
        assert_eq!(health.insurance_coverage_bps, 10_000,
            "Equal coverage = 100% = 10000 bps");
    }

    #[test]
    fn test_assess_protocol_worst_hf_with_single_vault() {
        // With a single vault, worst_health_factor == that vault's health factor
        let pool = test_pool();
        let vaults = vec![safe_vault(10 * PRECISION, 18_000 * PRECISION)];

        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        // Also assess via keeper directly and compare
        let assessment = keeper::assess_vault(
            &vaults[0], &pool, None, 3000 * PRECISION, PRECISION,
        );

        assert_eq!(health.worst_health_factor, assessment.health_factor,
            "Single vault's worst HF should match direct assessment");
    }

    #[test]
    fn test_simulate_price_drop_increasing_actions_count() {
        // As price drops more, the number of pending actions should not decrease
        let pool = test_pool();
        let vaults = vec![
            safe_vault(100 * PRECISION, 5_000 * PRECISION),  // Very safe
            safe_vault(10 * PRECISION, 15_000 * PRECISION),  // Moderate
            safe_vault(10 * PRECISION, 20_000 * PRECISION),  // At risk
        ];

        let mut prev_action_count = 0;
        for drop_bps in [0u64, 1000, 2000, 3000, 5000, 7000, 9000] {
            let health = simulate_price_drop(
                &vaults, &pool, None,
                3000 * PRECISION, PRECISION, drop_bps,
            );
            assert!(health.pending_actions.len() >= prev_action_count,
                "Action count should not decrease as price drops: drop={}bps, prev={}, curr={}",
                drop_bps, prev_action_count, health.pending_actions.len());
            prev_action_count = health.pending_actions.len();
        }
    }

    #[test]
    fn test_protocol_health_debug_clone() {
        // Verify ProtocolHealth implements Debug and Clone correctly
        let pool = test_pool();
        let vaults = vec![safe_vault(100 * PRECISION, 5_000 * PRECISION)];

        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        let health_clone = health.clone();
        assert_eq!(health_clone.total_tvl, health.total_tvl);
        assert_eq!(health_clone.total_borrows, health.total_borrows);
        assert_eq!(health_clone.utilization_bps, health.utilization_bps);
        assert_eq!(health_clone.vaults_assessed, health.vaults_assessed);
        assert_eq!(health_clone.worst_health_factor, health.worst_health_factor);
        assert_eq!(health_clone.insurance_coverage_bps, health.insurance_coverage_bps);
        assert_eq!(health_clone.pending_actions.len(), health.pending_actions.len());

        // Verify Debug doesn't panic
        let _debug_str = format!("{:?}", health);
    }

    #[test]
    fn test_tier_counts_default() {
        // TierCounts::default() should be all zeros
        let tc = TierCounts::default();
        assert_eq!(tc.safe, 0);
        assert_eq!(tc.warning, 0);
        assert_eq!(tc.auto_deleverage, 0);
        assert_eq!(tc.soft_liquidation, 0);
        assert_eq!(tc.hard_liquidation, 0);
    }

    #[test]
    fn test_risk_level_debug_clone_eq() {
        // Verify RiskLevel derives work correctly
        let level = RiskLevel::Low;
        let cloned = level.clone();
        assert_eq!(level, cloned);
        assert_eq!(format!("{:?}", level), "Low");
        assert_eq!(format!("{:?}", RiskLevel::Medium), "Medium");
        assert_eq!(format!("{:?}", RiskLevel::High), "High");
        assert_eq!(format!("{:?}", RiskLevel::Critical), "Critical");
    }

    #[test]
    fn test_assess_protocol_debt_price_higher_than_collateral() {
        // When debt is worth more than collateral token, vaults are riskier
        let pool = test_pool();
        let vaults = vec![safe_vault(100 * PRECISION, 5_000 * PRECISION)];

        let h_cheap_debt = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION, // Debt = $1
        );
        let h_expensive_debt = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, 10 * PRECISION, // Debt = $10
        );

        // More expensive debt doesn't change HF (HF is computed in debt terms directly)
        // but TVL should be higher
        assert!(h_expensive_debt.total_tvl > h_cheap_debt.total_tvl);
    }

    // ============ Batch 6: Hardening Tests (Target 105+) ============

    #[test]
    fn test_priority_one_below_each_threshold() {
        // Test values at exactly 1 below each boundary
        // PRECISION - 1 → 0 (critical, below 1.0)
        assert_eq!(health_factor_to_priority(PRECISION - 1), 0);
        // 1.1 * PRECISION - 1 → 100 (in [1.0, 1.1) range)
        assert_eq!(health_factor_to_priority(PRECISION * 110 / 100 - 1), 100);
        // 1.3 * PRECISION - 1 → 200 (in [1.1, 1.3) range)
        assert_eq!(health_factor_to_priority(PRECISION * 130 / 100 - 1), 200);
        // 1.5 * PRECISION - 1 → 300 (in [1.3, 1.5) range)
        assert_eq!(health_factor_to_priority(PRECISION * 150 / 100 - 1), 300);
    }

    #[test]
    fn test_assess_protocol_single_vault_exactly_at_liquidation_threshold() {
        // Vault where HF is exactly at PRECISION (1.0) — boundary between safe and liquidatable
        let pool = test_pool();
        // HF = (collateral * price * liq_threshold) / (debt * debt_price)
        // We need HF = PRECISION = (col * 3000 * 0.8) / debt
        // col = 10, debt = 24000 → HF = (10*3000*0.8)/24000 = 24000/24000 = 1.0
        let vaults = vec![safe_vault(10 * PRECISION, 24_000 * PRECISION)];

        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );

        assert_eq!(health.vaults_assessed, 1);
        // At exactly HF=1.0, the vault should not be in the safe tier
        // (keeper should flag it for at least a warning)
        assert!(health.worst_health_factor <= PRECISION,
            "HF at exactly 1.0 should be flagged: {}", health.worst_health_factor);
    }

    #[test]
    fn test_simulate_price_drop_5000_bps_halves_price() {
        // 50% drop: price should be exactly half
        let pool = test_pool();
        let vaults = vec![safe_vault(100 * PRECISION, 5_000 * PRECISION)];

        // At $3000: HF = (100 * 3000 * 0.8) / 5000 = 48
        let full_price = assess_protocol(&vaults, &pool, None, 3000 * PRECISION, PRECISION);
        // At $1500 (50% drop): HF = (100 * 1500 * 0.8) / 5000 = 24
        let half_price = simulate_price_drop(&vaults, &pool, None, 3000 * PRECISION, PRECISION, 5000);

        // HF should roughly halve (depends on exact calculation path)
        assert!(half_price.worst_health_factor < full_price.worst_health_factor,
            "50% price drop should lower HF");
    }

    #[test]
    fn test_risk_score_all_components_at_lowest_bracket() {
        // Each component at its lowest non-zero bracket
        let health = ProtocolHealth {
            total_tvl: PRECISION,
            total_borrows: PRECISION,
            utilization_bps: 5001,      // > 5000 → 5 pts
            vaults_assessed: 100,
            tier_counts: TierCounts {
                safe: 99,
                warning: 1,            // 1% → > 0% → 5 pts
                ..Default::default()
            },
            worst_health_factor: PRECISION * 140 / 100, // 1.4 → [1.3, 1.5) → 5 pts
            insurance_coverage_bps: 1500,               // [1000, 2000) → 5 pts
            pending_actions: vec![],
        };
        assert_eq!(risk_score(&health), 20,
            "All lowest non-zero brackets should sum to 20, got {}", risk_score(&health));
        assert_eq!(classify_risk_level(20), RiskLevel::Low);
    }

    #[test]
    fn test_risk_score_all_components_at_second_bracket() {
        // Each component at its second bracket
        let health = ProtocolHealth {
            total_tvl: PRECISION,
            total_borrows: PRECISION,
            utilization_bps: 8001,      // > 8000 → 15 pts
            vaults_assessed: 100,
            tier_counts: TierCounts {
                safe: 89,
                warning: 11,           // 11% → > 10% → 10 pts
                ..Default::default()
            },
            worst_health_factor: PRECISION * 120 / 100, // 1.2 → [1.1, 1.3) → 10 pts
            insurance_coverage_bps: 700,                // [500, 1000) → 10 pts
            pending_actions: vec![],
        };
        assert_eq!(risk_score(&health), 45,
            "All second brackets should sum to 45, got {}", risk_score(&health));
        assert_eq!(classify_risk_level(45), RiskLevel::Medium);
    }

    #[test]
    fn test_find_liquidation_threshold_with_insurance_pool() {
        // Threshold search should work the same with insurance present
        let pool = test_pool();
        let insurance = test_insurance();
        let vaults = vec![safe_vault(10 * PRECISION, 18_000 * PRECISION)];

        let threshold_no_ins = find_liquidation_threshold(
            &vaults, &pool, None, 3000 * PRECISION, PRECISION,
        );
        let threshold_with_ins = find_liquidation_threshold(
            &vaults, &pool, Some(&insurance), 3000 * PRECISION, PRECISION,
        );

        // Both should find a threshold (insurance doesn't prevent liquidation)
        assert!(threshold_no_ins.is_some());
        assert!(threshold_with_ins.is_some());
    }

    #[test]
    fn test_tvl_zero_deposits() {
        // Zero deposits → TVL = 0 regardless of debt_price
        let pool = LendingPoolCellData {
            total_deposits: 0,
            total_borrows: 0,
            ..test_pool()
        };

        let health = assess_protocol(&[], &pool, None, 3000 * PRECISION, 5 * PRECISION);
        assert_eq!(health.total_tvl, 0);
    }

    #[test]
    fn test_insurance_coverage_very_large_borrows() {
        // Insurance is tiny relative to huge borrows
        let pool = LendingPoolCellData {
            total_borrows: 10_000_000 * PRECISION, // 10M borrows
            ..test_pool()
        };
        let insurance = InsurancePoolCellData {
            total_deposits: 1_000 * PRECISION, // 1K insurance
            ..test_insurance()
        };

        let health = assess_protocol(
            &[], &pool, Some(&insurance),
            3000 * PRECISION, PRECISION,
        );
        // 1K / 10M = 0.01% = 1 bps
        assert_eq!(health.insurance_coverage_bps, 1,
            "Tiny insurance on huge borrows should give 1 bps");
    }

    #[test]
    fn test_assess_protocol_preserves_vault_order_in_actions() {
        // Verify that vault_index in pending_actions correctly references the input order
        let pool = test_pool();
        let vaults = vec![
            safe_vault(100 * PRECISION, 1_000 * PRECISION),  // idx 0: safe
            safe_vault(10 * PRECISION, 30_000 * PRECISION),  // idx 1: underwater
            safe_vault(100 * PRECISION, 2_000 * PRECISION),  // idx 2: safe
            safe_vault(10 * PRECISION, 35_000 * PRECISION),  // idx 3: underwater
        ];

        let health = assess_protocol(
            &vaults, &pool, None, 3000 * PRECISION, PRECISION,
        );

        // Safe vaults should not appear
        let action_indices: Vec<usize> = health.pending_actions.iter()
            .map(|a| a.vault_index)
            .collect();
        assert!(!action_indices.contains(&0), "Safe vault 0 should not be in actions");
        assert!(!action_indices.contains(&2), "Safe vault 2 should not be in actions");
        // Underwater vaults should appear
        assert!(action_indices.contains(&1), "Underwater vault 1 should be in actions");
        assert!(action_indices.contains(&3), "Underwater vault 3 should be in actions");
    }

    #[test]
    fn test_pending_action_health_factor_matches_vault() {
        // Each pending action should carry the correct health factor for its vault
        let pool = test_pool();
        let vaults = vec![
            safe_vault(10 * PRECISION, 30_000 * PRECISION), // underwater
        ];

        let health = assess_protocol(
            &vaults, &pool, None, 3000 * PRECISION, PRECISION,
        );

        assert_eq!(health.pending_actions.len(), 1);
        let action = &health.pending_actions[0];

        // Independently compute the expected HF
        let assessment = keeper::assess_vault(
            &vaults[0], &pool, None, 3000 * PRECISION, PRECISION,
        );
        assert_eq!(action.health_factor, assessment.health_factor,
            "Action HF should match direct vault assessment");
    }

    #[test]
    fn test_simulate_price_drop_extreme_9999_bps() {
        // 99.99% drop → price = 0.01% of original
        let pool = test_pool();
        let vaults = vec![safe_vault(1_000 * PRECISION, 1_000 * PRECISION)];

        let health = simulate_price_drop(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION, 9999,
        );

        // At $0.30 (0.01% of $3000): HF = (1000 * 0.3 * 0.8) / 1000 = 0.24
        assert!(health.worst_health_factor < PRECISION,
            "99.99% drop should put any leveraged vault underwater");
    }

    #[test]
    fn test_risk_score_single_at_risk_vault_in_large_pool() {
        // 1 vault at risk out of 1000 = 0.1%
        // Integer math: (1 * 100) / 1000 = 0 → 0% at-risk → 0 pts vault component
        let health = ProtocolHealth {
            total_tvl: PRECISION,
            total_borrows: PRECISION,
            utilization_bps: 0,
            vaults_assessed: 1000,
            tier_counts: TierCounts {
                safe: 999,
                warning: 1,
                ..Default::default()
            },
            worst_health_factor: u128::MAX,
            insurance_coverage_bps: 10_000,
            pending_actions: vec![],
        };
        // Integer division: (1*100)/1000 = 0 → 0% bucket → 0 pts
        assert_eq!(risk_score(&health), 0,
            "Single at-risk vault among 1000 rounds to 0% in integer math");
    }

    #[test]
    fn test_assess_protocol_mixed_with_all_tier_types_sum() {
        // Create vaults that land in every tier, verify counts sum to total
        let pool = test_pool();
        let vaults = vec![
            safe_vault(100 * PRECISION, 5_000 * PRECISION),   // Safe
            safe_vault(100 * PRECISION, 3_000 * PRECISION),   // Safe
            safe_vault(10 * PRECISION, 17_000 * PRECISION),   // Warning
            safe_vault(10 * PRECISION, 20_000 * PRECISION),   // AutoDeleverage
            safe_vault(10 * PRECISION, 24_000 * PRECISION),   // Soft/Hard liquidation
            safe_vault(10 * PRECISION, 40_000 * PRECISION),   // Hard liquidation
        ];

        let health = assess_protocol(
            &vaults, &pool, None, 3000 * PRECISION, PRECISION,
        );

        let total = health.tier_counts.safe
            + health.tier_counts.warning
            + health.tier_counts.auto_deleverage
            + health.tier_counts.soft_liquidation
            + health.tier_counts.hard_liquidation;
        assert_eq!(total, 6, "All 6 vaults must be in some tier");
        assert!(health.tier_counts.safe >= 2, "At least 2 should be safe");
    }

    #[test]
    fn test_find_liquidation_threshold_consistency() {
        // For a range of vault configurations, verify threshold produces liquidation
        let pool = test_pool();
        let test_cases = vec![
            safe_vault(10 * PRECISION, 15_000 * PRECISION),
            safe_vault(20 * PRECISION, 30_000 * PRECISION),
            safe_vault(50 * PRECISION, 80_000 * PRECISION),
        ];

        for vault in &test_cases {
            if vault.debt_shares == 0 { continue; }
            let vaults = vec![vault.clone()];
            let threshold = find_liquidation_threshold(
                &vaults, &pool, None, 3000 * PRECISION, PRECISION,
            );
            if let Some(bps) = threshold {
                let stressed = simulate_price_drop(
                    &vaults, &pool, None, 3000 * PRECISION, PRECISION, bps,
                );
                assert!(
                    stressed.tier_counts.hard_liquidation > 0
                    || stressed.tier_counts.soft_liquidation > 0,
                    "At threshold {}bps, vault should be liquidatable", bps
                );
            }
        }
    }

    #[test]
    fn test_utilization_1_bps() {
        // Extremely low utilization (0.01%)
        let pool = LendingPoolCellData {
            total_deposits: 1_000_000 * PRECISION,
            total_borrows: 100 * PRECISION, // 0.01%
            ..test_pool()
        };

        let health = assess_protocol(&[], &pool, None, 3000 * PRECISION, PRECISION);
        // 100 / 1_000_000 = 0.0001 = 1 bps (integer division)
        assert_eq!(health.utilization_bps, 1);
    }

    #[test]
    fn test_assess_protocol_two_vaults_same_hf() {
        // Two vaults with identical parameters → worst_hf should equal their shared HF
        let pool = test_pool();
        let vaults = vec![
            safe_vault(10 * PRECISION, 18_000 * PRECISION),
            safe_vault(10 * PRECISION, 18_000 * PRECISION),
        ];

        let health = assess_protocol(
            &vaults, &pool, None, 3000 * PRECISION, PRECISION,
        );

        // Both should have the same HF
        let assessment1 = keeper::assess_vault(&vaults[0], &pool, None, 3000 * PRECISION, PRECISION);
        assert_eq!(health.worst_health_factor, assessment1.health_factor);
    }

    #[test]
    fn test_risk_score_exactly_at_medium_threshold() {
        // Score = 21 → Medium, Score = 20 → Low
        assert_eq!(classify_risk_level(20), RiskLevel::Low);
        assert_eq!(classify_risk_level(21), RiskLevel::Medium);
        // Verify they are different
        assert_ne!(classify_risk_level(20), classify_risk_level(21));
    }

    // ============ Batch 7: Hardening Tests (Target 125+) ============

    #[test]
    fn test_risk_score_exactly_50_is_medium() {
        assert_eq!(classify_risk_level(50), RiskLevel::Medium);
    }

    #[test]
    fn test_risk_score_exactly_75_is_high() {
        assert_eq!(classify_risk_level(75), RiskLevel::High);
    }

    #[test]
    fn test_priority_at_half_precision() {
        // HF = 0.5 → critical
        assert_eq!(health_factor_to_priority(PRECISION / 2), 0);
    }

    #[test]
    fn test_priority_at_quarter_precision() {
        // HF = 0.25 → critical
        assert_eq!(health_factor_to_priority(PRECISION / 4), 0);
    }

    #[test]
    fn test_priority_at_exactly_2x() {
        assert_eq!(health_factor_to_priority(PRECISION * 2), 1000);
    }

    #[test]
    fn test_priority_at_exactly_10x() {
        assert_eq!(health_factor_to_priority(PRECISION * 10), 1000);
    }

    #[test]
    fn test_assess_protocol_1_vault_large_collateral() {
        let pool = test_pool();
        let vaults = vec![safe_vault(1_000_000 * PRECISION, 1 * PRECISION)];
        let health = assess_protocol(
            &vaults, &pool, None,
            PRECISION, PRECISION,
        );
        assert_eq!(health.vaults_assessed, 1);
        // Extremely over-collateralized: HF = (1M * 1 * 0.8) / 1 = 800,000
        assert_eq!(health.tier_counts.safe, 1);
    }

    #[test]
    fn test_simulate_price_drop_10_bps() {
        // Very small drop: 0.1%
        let pool = test_pool();
        let vaults = vec![safe_vault(10 * PRECISION, 18_000 * PRECISION)];
        let normal = assess_protocol(&vaults, &pool, None, 3000 * PRECISION, PRECISION);
        let small_drop = simulate_price_drop(&vaults, &pool, None, 3000 * PRECISION, PRECISION, 10);
        assert!(small_drop.worst_health_factor <= normal.worst_health_factor);
    }

    #[test]
    fn test_simulate_price_drop_100_bps() {
        // 1% drop
        let pool = test_pool();
        let vaults = vec![safe_vault(10 * PRECISION, 18_000 * PRECISION)];
        let no_drop = assess_protocol(&vaults, &pool, None, 3000 * PRECISION, PRECISION);
        let drop_100 = simulate_price_drop(&vaults, &pool, None, 3000 * PRECISION, PRECISION, 100);
        assert!(drop_100.worst_health_factor <= no_drop.worst_health_factor);
    }

    #[test]
    fn test_risk_score_insurance_exactly_at_zero() {
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
        assert_eq!(risk_score(&make_health(0)), 25);
    }

    #[test]
    fn test_risk_score_insurance_at_1_bps() {
        let health = ProtocolHealth {
            total_tvl: PRECISION,
            total_borrows: PRECISION,
            utilization_bps: 0,
            vaults_assessed: 1,
            tier_counts: TierCounts { safe: 1, ..Default::default() },
            worst_health_factor: u128::MAX,
            insurance_coverage_bps: 1,
            pending_actions: vec![],
        };
        // 1 bps < 500 → 20 points
        assert_eq!(risk_score(&health), 20);
    }

    #[test]
    fn test_utilization_exact_50_percent() {
        let pool = test_pool(); // 500K / 1M = 50%
        let health = assess_protocol(&[], &pool, None, 3000 * PRECISION, PRECISION);
        assert_eq!(health.utilization_bps, 5000);
    }

    #[test]
    fn test_utilization_near_zero() {
        let pool = LendingPoolCellData {
            total_deposits: 1_000_000 * PRECISION,
            total_borrows: 1 * PRECISION,
            ..test_pool()
        };
        let health = assess_protocol(&[], &pool, None, 3000 * PRECISION, PRECISION);
        assert!(health.utilization_bps < 10);
    }

    #[test]
    fn test_find_liquidation_threshold_returns_none_for_empty_vaults() {
        let pool = test_pool();
        let threshold = find_liquidation_threshold(
            &[], &pool, None, 3000 * PRECISION, PRECISION,
        );
        assert!(threshold.is_none());
    }

    #[test]
    fn test_assess_protocol_collateral_price_1() {
        // Collateral priced at 1.0 (same as debt)
        let pool = test_pool();
        let vaults = vec![safe_vault(10_000 * PRECISION, 5_000 * PRECISION)];
        let health = assess_protocol(
            &vaults, &pool, None, PRECISION, PRECISION,
        );
        // HF = (10000 * 1 * 0.8) / 5000 = 1.6 → Safe
        assert_eq!(health.tier_counts.safe, 1);
    }

    #[test]
    fn test_tier_counts_clone_eq() {
        let tc = TierCounts {
            safe: 3,
            warning: 2,
            auto_deleverage: 1,
            soft_liquidation: 0,
            hard_liquidation: 0,
        };
        let tc2 = tc.clone();
        assert_eq!(tc2.safe, 3);
        assert_eq!(tc2.warning, 2);
        assert_eq!(tc2.auto_deleverage, 1);
    }

    #[test]
    fn test_risk_level_ne_comparison() {
        assert_ne!(RiskLevel::Low, RiskLevel::Medium);
        assert_ne!(RiskLevel::Medium, RiskLevel::High);
        assert_ne!(RiskLevel::High, RiskLevel::Critical);
        assert_ne!(RiskLevel::Low, RiskLevel::Critical);
    }

    #[test]
    fn test_assess_protocol_single_debt_share_1() {
        // Vault with debt_shares = 1 (dust)
        let pool = test_pool();
        let vaults = vec![safe_vault(100 * PRECISION, 1)];
        let health = assess_protocol(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION,
        );
        assert_eq!(health.vaults_assessed, 1);
        // Extremely over-collateralized, should be safe
        assert_eq!(health.tier_counts.safe, 1);
    }

    #[test]
    fn test_risk_score_utilization_at_exactly_10000() {
        let health = ProtocolHealth {
            total_tvl: PRECISION,
            total_borrows: PRECISION,
            utilization_bps: 10_000,
            vaults_assessed: 1,
            tier_counts: TierCounts { safe: 1, ..Default::default() },
            worst_health_factor: u128::MAX,
            insurance_coverage_bps: 10_000,
            pending_actions: vec![],
        };
        // 10000 > 9000 → 25 points
        assert_eq!(risk_score(&health), 25);
    }

    // ============ Hardening Tests (Batch harden3) ============

    #[test]
    fn test_assess_protocol_two_vaults_same_risk_harden3() {
        let pool = test_pool();
        let vaults = vec![
            safe_vault(10 * PRECISION, 18_000 * PRECISION),
            safe_vault(10 * PRECISION, 18_000 * PRECISION),
        ];
        let health = assess_protocol(&vaults, &pool, None, 3000 * PRECISION, PRECISION);
        assert_eq!(health.vaults_assessed, 2);
        // Both identical → same tier
        let total_tiers = health.tier_counts.safe + health.tier_counts.warning
            + health.tier_counts.auto_deleverage + health.tier_counts.soft_liquidation
            + health.tier_counts.hard_liquidation;
        assert_eq!(total_tiers, 2);
    }

    #[test]
    fn test_simulate_price_drop_50_bps_harden3() {
        // 0.5% drop
        let pool = test_pool();
        let vaults = vec![safe_vault(10 * PRECISION, 18_000 * PRECISION)];
        let normal = assess_protocol(&vaults, &pool, None, 3000 * PRECISION, PRECISION);
        let dropped = simulate_price_drop(&vaults, &pool, None, 3000 * PRECISION, PRECISION, 50);
        assert!(dropped.worst_health_factor <= normal.worst_health_factor);
    }

    #[test]
    fn test_simulate_price_drop_full_10000_bps_harden3() {
        // 100% drop → price = 0
        let pool = test_pool();
        let vaults = vec![safe_vault(10 * PRECISION, 18_000 * PRECISION)];
        let crashed = simulate_price_drop(&vaults, &pool, None, 3000 * PRECISION, PRECISION, 10_000);
        // Price → 0 → HF → 0
        assert_eq!(crashed.worst_health_factor, 0);
    }

    #[test]
    fn test_risk_score_only_insurance_component_harden3() {
        // Isolate insurance component with everything else perfect
        let make = |ins: u64| ProtocolHealth {
            total_tvl: PRECISION,
            total_borrows: PRECISION,
            utilization_bps: 0,
            vaults_assessed: 0,
            tier_counts: TierCounts::default(),
            worst_health_factor: u128::MAX,
            insurance_coverage_bps: ins,
            pending_actions: vec![],
        };
        assert_eq!(risk_score(&make(0)), 25);      // No insurance
        assert_eq!(risk_score(&make(100)), 20);     // < 500
        assert_eq!(risk_score(&make(500)), 10);     // < 1000
        assert_eq!(risk_score(&make(1500)), 5);     // < 2000
        assert_eq!(risk_score(&make(5000)), 0);     // >= 2000
    }

    #[test]
    fn test_assess_protocol_collateral_price_zero_harden3() {
        // Zero collateral price → all vaults with debt should be underwater
        let pool = test_pool();
        let vaults = vec![safe_vault(100 * PRECISION, 5_000 * PRECISION)];
        let health = assess_protocol(&vaults, &pool, None, 0, PRECISION);
        assert_eq!(health.worst_health_factor, 0);
        assert_eq!(health.tier_counts.safe, 0);
    }

    #[test]
    fn test_find_liquidation_threshold_returns_none_for_empty_harden3() {
        let pool = test_pool();
        let threshold = find_liquidation_threshold(&[], &pool, None, 3000 * PRECISION, PRECISION);
        assert!(threshold.is_none());
    }

    #[test]
    fn test_pending_actions_health_factor_below_precision_harden3() {
        let pool = test_pool();
        let vaults = vec![safe_vault(1 * PRECISION, 50_000 * PRECISION)];
        let health = assess_protocol(&vaults, &pool, None, 3000 * PRECISION, PRECISION);
        assert!(!health.pending_actions.is_empty());
        assert!(health.pending_actions[0].health_factor < PRECISION);
        assert_eq!(health.pending_actions[0].priority, 0);
    }

    #[test]
    fn test_tier_counts_clone_harden3() {
        let tc = TierCounts { safe: 5, warning: 3, auto_deleverage: 1, soft_liquidation: 2, hard_liquidation: 4 };
        let cloned = tc.clone();
        assert_eq!(cloned.safe, 5);
        assert_eq!(cloned.warning, 3);
        assert_eq!(cloned.auto_deleverage, 1);
        assert_eq!(cloned.soft_liquidation, 2);
        assert_eq!(cloned.hard_liquidation, 4);
    }

    #[test]
    fn test_pending_action_clone_debug_harden3() {
        let action = PendingAction {
            vault_index: 0,
            action: KeeperAction::Safe { health_factor: PRECISION * 2 },
            health_factor: PRECISION * 2,
            priority: 1000,
        };
        let cloned = action.clone();
        assert_eq!(cloned.vault_index, 0);
        assert_eq!(cloned.health_factor, PRECISION * 2);
        assert_eq!(cloned.priority, 1000);
        let _ = format!("{:?}", action);
    }

    #[test]
    fn test_risk_level_ne_harden3() {
        assert_ne!(RiskLevel::Low, RiskLevel::Medium);
        assert_ne!(RiskLevel::Medium, RiskLevel::High);
        assert_ne!(RiskLevel::High, RiskLevel::Critical);
        assert_ne!(RiskLevel::Low, RiskLevel::Critical);
    }

    #[test]
    fn test_assess_protocol_many_safe_vaults_no_actions_harden3() {
        let pool = test_pool();
        let vaults: Vec<VaultCellData> = (0..50)
            .map(|i| safe_vault((100 + i) * PRECISION, 1_000 * PRECISION))
            .collect();
        let health = assess_protocol(&vaults, &pool, None, 3000 * PRECISION, PRECISION);
        assert_eq!(health.vaults_assessed, 50);
        assert_eq!(health.tier_counts.safe, 50);
        assert!(health.pending_actions.is_empty());
    }

    #[test]
    fn test_simulate_price_drop_consistent_tvl_harden3() {
        // TVL depends on deposits * debt_price, not collateral price
        // So TVL should be the same regardless of price drop
        let pool = test_pool();
        let vaults = vec![safe_vault(100 * PRECISION, 5_000 * PRECISION)];
        let h1 = assess_protocol(&vaults, &pool, None, 3000 * PRECISION, PRECISION);
        let h2 = simulate_price_drop(&vaults, &pool, None, 3000 * PRECISION, PRECISION, 5000);
        // TVL = deposits * debt_price / PRECISION, debt_price is the same
        assert_eq!(h1.total_tvl, h2.total_tvl);
    }

    #[test]
    fn test_risk_score_max_utilization_only_harden3() {
        let health = ProtocolHealth {
            total_tvl: PRECISION,
            total_borrows: PRECISION,
            utilization_bps: u64::MAX,
            vaults_assessed: 0,
            tier_counts: TierCounts::default(),
            worst_health_factor: u128::MAX,
            insurance_coverage_bps: 10_000,
            pending_actions: vec![],
        };
        // u64::MAX > 9000 → 25 utilization points, 0 for everything else
        assert_eq!(risk_score(&health), 25);
    }

    #[test]
    fn test_find_liquidation_threshold_with_insurance_harden3() {
        let pool = test_pool();
        let insurance = test_insurance();
        let vaults = vec![safe_vault(10 * PRECISION, 18_000 * PRECISION)];

        let threshold = find_liquidation_threshold(
            &vaults, &pool, Some(&insurance), 3000 * PRECISION, PRECISION,
        );
        // Insurance doesn't change vault HF, so threshold should be similar
        assert!(threshold.is_some());
    }

    #[test]
    fn test_assess_protocol_worst_hf_is_minimum_harden3() {
        let pool = test_pool();
        let vaults = vec![
            safe_vault(100 * PRECISION, 5_000 * PRECISION),   // Safe, high HF
            safe_vault(10 * PRECISION, 30_000 * PRECISION),    // Underwater, low HF
            safe_vault(50 * PRECISION, 10_000 * PRECISION),    // Moderate HF
        ];
        let health = assess_protocol(&vaults, &pool, None, 3000 * PRECISION, PRECISION);

        // Verify worst_hf is indeed the minimum
        for (i, vault) in vaults.iter().enumerate() {
            let assessment = keeper::assess_vault(vault, &pool, None, 3000 * PRECISION, PRECISION);
            assert!(health.worst_health_factor <= assessment.health_factor,
                "worst_health_factor should be <= vault {} HF", i);
        }
    }

    #[test]
    fn test_risk_score_everything_at_worst_harden3() {
        let health = ProtocolHealth {
            total_tvl: 0,
            total_borrows: PRECISION * 1_000_000,
            utilization_bps: 15_000,         // > 9000 → 25
            vaults_assessed: 2,
            tier_counts: TierCounts {
                safe: 0,
                warning: 0,
                auto_deleverage: 0,
                soft_liquidation: 0,
                hard_liquidation: 2,          // 100% at risk → 25
            },
            worst_health_factor: 0,          // < PRECISION → 25
            insurance_coverage_bps: 0,       // 0% → 25
            pending_actions: vec![],
        };
        assert_eq!(risk_score(&health), 100);
    }

    #[test]
    fn test_classify_risk_level_at_200_harden3() {
        assert_eq!(classify_risk_level(200), RiskLevel::Critical);
    }

    #[test]
    fn test_simulate_price_drop_total_borrows_unchanged_harden3() {
        let pool = test_pool();
        let vaults = vec![safe_vault(10 * PRECISION, 18_000 * PRECISION)];
        let normal = assess_protocol(&vaults, &pool, None, 3000 * PRECISION, PRECISION);
        let dropped = simulate_price_drop(&vaults, &pool, None, 3000 * PRECISION, PRECISION, 5000);
        assert_eq!(normal.total_borrows, dropped.total_borrows);
    }

    #[test]
    fn test_simulate_price_drop_utilization_unchanged_harden3() {
        let pool = test_pool();
        let vaults = vec![safe_vault(10 * PRECISION, 18_000 * PRECISION)];
        let normal = assess_protocol(&vaults, &pool, None, 3000 * PRECISION, PRECISION);
        let dropped = simulate_price_drop(&vaults, &pool, None, 3000 * PRECISION, PRECISION, 5000);
        assert_eq!(normal.utilization_bps, dropped.utilization_bps);
    }

    #[test]
    fn test_priority_zero_hf_harden3() {
        assert_eq!(health_factor_to_priority(0), 0);
    }

    #[test]
    fn test_priority_one_hf_harden3() {
        assert_eq!(health_factor_to_priority(1), 0);
    }

    #[test]
    fn test_find_liquidation_threshold_binary_search_convergence_harden3() {
        // Verify the found threshold is tight
        let pool = test_pool();
        let vaults = vec![safe_vault(10 * PRECISION, 15_000 * PRECISION)];
        let threshold = find_liquidation_threshold(&vaults, &pool, None, 3000 * PRECISION, PRECISION);
        if let Some(bps) = threshold {
            // At threshold, should be liquidatable
            let at = simulate_price_drop(&vaults, &pool, None, 3000 * PRECISION, PRECISION, bps);
            assert!(at.tier_counts.hard_liquidation + at.tier_counts.soft_liquidation > 0);
        }
    }

    // ============ Hardening Round 5 ============

    #[test]
    fn test_assess_protocol_single_vault_huge_collateral_v5() {
        let pool = test_pool();
        // Large collateral, small debt → very safe
        let vaults = vec![safe_vault(10_000 * PRECISION, 1_000 * PRECISION)];
        let health = assess_protocol(&vaults, &pool, None, 3000 * PRECISION, PRECISION);
        assert_eq!(health.vaults_assessed, 1);
        assert_eq!(health.tier_counts.safe, 1);
    }

    #[test]
    fn test_assess_protocol_worst_hf_single_vault_v5() {
        let pool = test_pool();
        let vaults = vec![safe_vault(10 * PRECISION, 25_000 * PRECISION)];
        let health = assess_protocol(&vaults, &pool, None, 3000 * PRECISION, PRECISION);
        assert!(health.worst_health_factor < PRECISION); // Under-collateralized
    }

    #[test]
    fn test_simulate_price_drop_2500_bps_v5() {
        let pool = test_pool();
        let vaults = vec![safe_vault(10 * PRECISION, 15_000 * PRECISION)];
        let result = simulate_price_drop(&vaults, &pool, None, 3000 * PRECISION, PRECISION, 2500);
        // 25% drop: price = 2250, collateral_value = 10*2250*0.8=18000, debt=15000 → HF=1.2
        assert_eq!(result.vaults_assessed, 1);
    }

    #[test]
    fn test_risk_score_zero_utilization_high_insurance_v5() {
        let pool = LendingPoolCellData {
            total_deposits: 1_000_000 * PRECISION,
            total_borrows: 0,
            ..test_pool()
        };
        let insurance = InsurancePoolCellData {
            total_deposits: 500_000 * PRECISION,
            ..test_insurance()
        };
        let health = assess_protocol(&[], &pool, Some(&insurance), 3000 * PRECISION, PRECISION);
        let score = risk_score(&health);
        assert_eq!(score, 0); // Perfectly safe
    }

    #[test]
    fn test_risk_level_low_boundary_v5() {
        assert_eq!(classify_risk_level(0), RiskLevel::Low);
        assert_eq!(classify_risk_level(20), RiskLevel::Low);
    }

    #[test]
    fn test_risk_level_medium_boundary_v5() {
        assert_eq!(classify_risk_level(21), RiskLevel::Medium);
        assert_eq!(classify_risk_level(50), RiskLevel::Medium);
    }

    #[test]
    fn test_risk_level_high_boundary_v5() {
        assert_eq!(classify_risk_level(51), RiskLevel::High);
        assert_eq!(classify_risk_level(75), RiskLevel::High);
    }

    #[test]
    fn test_risk_level_critical_boundary_v5() {
        assert_eq!(classify_risk_level(76), RiskLevel::Critical);
        assert_eq!(classify_risk_level(100), RiskLevel::Critical);
    }

    #[test]
    fn test_priority_exactly_at_precision_v5() {
        // HF == 1.0 exactly → priority 100 (just above critical)
        let p = health_factor_to_priority(PRECISION);
        assert_eq!(p, 100);
    }

    #[test]
    fn test_priority_at_1_1x_v5() {
        // HF == 1.1 exactly → priority 200
        let p = health_factor_to_priority(PRECISION * 110 / 100);
        assert_eq!(p, 200);
    }

    #[test]
    fn test_priority_at_1_3x_v5() {
        let p = health_factor_to_priority(PRECISION * 130 / 100);
        assert_eq!(p, 300);
    }

    #[test]
    fn test_priority_at_1_5x_v5() {
        let p = health_factor_to_priority(PRECISION * 150 / 100);
        assert_eq!(p, 1000);
    }

    #[test]
    fn test_insurance_coverage_half_of_borrows_v5() {
        let pool = test_pool(); // 500K borrows
        let insurance = InsurancePoolCellData {
            total_deposits: 250_000 * PRECISION,
            ..test_insurance()
        };
        let health = assess_protocol(&[], &pool, Some(&insurance), 3000 * PRECISION, PRECISION);
        assert_eq!(health.insurance_coverage_bps, 5000); // 50%
    }

    #[test]
    fn test_utilization_75_percent_v5() {
        let pool = LendingPoolCellData {
            total_deposits: 1_000_000 * PRECISION,
            total_borrows: 750_000 * PRECISION,
            ..test_pool()
        };
        let health = assess_protocol(&[], &pool, None, 3000 * PRECISION, PRECISION);
        assert_eq!(health.utilization_bps, 7500);
    }

    #[test]
    fn test_assess_protocol_five_vaults_all_same_v5() {
        let pool = test_pool();
        let vaults: Vec<VaultCellData> = (0..5)
            .map(|_| safe_vault(100 * PRECISION, 5_000 * PRECISION))
            .collect();
        let health = assess_protocol(&vaults, &pool, None, 3000 * PRECISION, PRECISION);
        assert_eq!(health.vaults_assessed, 5);
        assert_eq!(health.tier_counts.safe, 5);
        assert!(health.pending_actions.is_empty());
    }

    #[test]
    fn test_simulate_price_drop_zero_bps_no_change_v5() {
        let pool = test_pool();
        let vaults = vec![safe_vault(100 * PRECISION, 5_000 * PRECISION)];
        let normal = assess_protocol(&vaults, &pool, None, 3000 * PRECISION, PRECISION);
        let zero_drop = simulate_price_drop(&vaults, &pool, None, 3000 * PRECISION, PRECISION, 0);
        assert_eq!(normal.worst_health_factor, zero_drop.worst_health_factor);
    }

    #[test]
    fn test_find_liquidation_threshold_highly_collateralized_v5() {
        let pool = test_pool();
        // HF is extremely high
        let vaults = vec![safe_vault(1000 * PRECISION, 1_000 * PRECISION)];
        let threshold = find_liquidation_threshold(&vaults, &pool, None, 3000 * PRECISION, PRECISION);
        // Should require massive drop, if found at all
        if let Some(bps) = threshold {
            assert!(bps > 9000, "Highly collateralized vault needs >90% drop, got {}", bps);
        }
    }

    #[test]
    fn test_risk_score_moderate_utilization_v5() {
        let pool = LendingPoolCellData {
            total_deposits: 1_000_000 * PRECISION,
            total_borrows: 600_000 * PRECISION,
            ..test_pool()
        };
        let health = assess_protocol(&[], &pool, Some(&test_insurance()), 3000 * PRECISION, PRECISION);
        let score = risk_score(&health);
        // 60% utilization = 5pts, insurance should help, no vaults at risk
        assert!(score <= 10);
    }

    #[test]
    fn test_pending_actions_sorted_critical_first_v5() {
        let pool = test_pool();
        let vaults = vec![
            safe_vault(10 * PRECISION, 30_000 * PRECISION), // HF < 1 → critical
            safe_vault(100 * PRECISION, 5_000 * PRECISION),  // HF high → safe
            safe_vault(10 * PRECISION, 22_000 * PRECISION), // HF ~ 1.09 → warning
        ];
        let health = assess_protocol(&vaults, &pool, None, 3000 * PRECISION, PRECISION);
        if health.pending_actions.len() >= 2 {
            assert!(health.pending_actions[0].priority <= health.pending_actions[1].priority);
        }
    }

    #[test]
    fn test_risk_score_insurance_coverage_caps_at_10000_v5() {
        let pool = LendingPoolCellData {
            total_deposits: 1_000_000 * PRECISION,
            total_borrows: 100 * PRECISION,
            ..test_pool()
        };
        let insurance = InsurancePoolCellData {
            total_deposits: 1_000_000 * PRECISION,
            ..test_insurance()
        };
        let health = assess_protocol(&[], &pool, Some(&insurance), 3000 * PRECISION, PRECISION);
        assert_eq!(health.insurance_coverage_bps, 10000);
    }

    #[test]
    fn test_assess_protocol_total_borrows_matches_pool_v5() {
        let pool = test_pool(); // 500_000 * PRECISION borrows
        let health = assess_protocol(&[], &pool, None, 3000 * PRECISION, PRECISION);
        assert_eq!(health.total_borrows, pool.total_borrows);
    }

    #[test]
    fn test_risk_score_max_is_100_v5() {
        // Create worst case scenario
        let pool = LendingPoolCellData {
            total_deposits: 1_000_000 * PRECISION,
            total_borrows: 999_000 * PRECISION,
            ..test_pool()
        };
        let vaults: Vec<VaultCellData> = (0..10)
            .map(|_| safe_vault(1 * PRECISION, 30_000 * PRECISION))
            .collect();
        let health = assess_protocol(&vaults, &pool, None, 3000 * PRECISION, PRECISION);
        let score = risk_score(&health);
        assert!(score <= 100);
    }

    #[test]
    fn test_simulate_progressive_drops_hf_monotonically_decreases_v5() {
        let pool = test_pool();
        let vaults = vec![safe_vault(10 * PRECISION, 10_000 * PRECISION)];
        let mut prev_hf = u128::MAX;
        for bps in [0, 1000, 2000, 3000, 5000, 7000] {
            let result = simulate_price_drop(&vaults, &pool, None, 3000 * PRECISION, PRECISION, bps);
            assert!(result.worst_health_factor <= prev_hf);
            prev_hf = result.worst_health_factor;
        }
    }

    #[test]
    fn test_tier_counts_default_all_zero_v5() {
        let tc = TierCounts::default();
        assert_eq!(tc.safe, 0);
        assert_eq!(tc.warning, 0);
        assert_eq!(tc.auto_deleverage, 0);
        assert_eq!(tc.soft_liquidation, 0);
        assert_eq!(tc.hard_liquidation, 0);
    }

    #[test]
    fn test_risk_level_debug_impl_v5() {
        let level = RiskLevel::Low;
        let debug = format!("{:?}", level);
        assert_eq!(debug, "Low");
    }
}
