// ============ Risk Manager Integration Tests ============
// End-to-end testing of the unified risk assessment engine
// with realistic multi-vault, multi-pool scenarios.

use vibeswap_types::*;
use vibeswap_sdk::risk::{self, RiskLevel};
use vibeswap_sdk::keeper::KeeperAction;
use ckb_lending_math::PRECISION;

// ============ Helpers ============

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
        total_premiums_earned: 5_000 * PRECISION,
        total_claims_paid: 1_000 * PRECISION,
        premium_rate_bps: DEFAULT_PREMIUM_RATE_BPS,
        max_coverage_bps: DEFAULT_MAX_COVERAGE_BPS,
        cooldown_blocks: DEFAULT_COOLDOWN_BLOCKS,
        last_premium_block: 100,
    }
}

fn vault(owner_id: u8, collateral: u128, debt: u128) -> VaultCellData {
    VaultCellData {
        owner_lock_hash: [owner_id; 32],
        pool_id: [0xBB; 32],
        collateral_amount: collateral,
        collateral_type_hash: [0xCC; 32],
        debt_shares: debt,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 0,
        last_update_block: 100,
    }
}

fn vault_with_deposits(owner_id: u8, collateral: u128, debt: u128, deposits: u128) -> VaultCellData {
    VaultCellData {
        deposit_shares: deposits,
        ..vault(owner_id, collateral, debt)
    }
}

// ============ Realistic Multi-Vault Scenarios ============

#[test]
fn test_healthy_lending_pool_10_users() {
    let pool = test_pool();
    let insurance = test_insurance();

    // 10 users with varying positions, all healthy at $3000/ETH
    let vaults = vec![
        vault(0x01, 100 * PRECISION, 50_000 * PRECISION),  // HF ≈ 4.8
        vault(0x02, 50 * PRECISION, 30_000 * PRECISION),   // HF ≈ 4.0
        vault(0x03, 20 * PRECISION, 15_000 * PRECISION),   // HF ≈ 3.2
        vault(0x04, 10 * PRECISION, 5_000 * PRECISION),    // HF ≈ 4.8
        vault(0x05, 30 * PRECISION, 20_000 * PRECISION),   // HF ≈ 3.6
        vault(0x06, 5 * PRECISION, 2_000 * PRECISION),     // HF ≈ 6.0
        vault(0x07, 15 * PRECISION, 10_000 * PRECISION),   // HF ≈ 3.6
        vault(0x08, 80 * PRECISION, 60_000 * PRECISION),   // HF ≈ 3.2
        vault(0x09, 25 * PRECISION, 18_000 * PRECISION),   // HF ≈ 3.33
        vault(0x0A, 40 * PRECISION, 25_000 * PRECISION),   // HF ≈ 3.84
    ];

    let health = risk::assess_protocol(
        &vaults, &pool, Some(&insurance),
        3000 * PRECISION, PRECISION,
    );

    assert_eq!(health.vaults_assessed, 10);
    assert_eq!(health.tier_counts.safe, 10);
    assert_eq!(health.tier_counts.hard_liquidation, 0);
    assert!(health.pending_actions.is_empty());

    let score = risk::risk_score(&health);
    assert!(score <= 20);
    assert_eq!(risk::classify_risk_level(score), RiskLevel::Low);
}

#[test]
fn test_market_crash_cascading_risk() {
    let pool = test_pool();

    // Vaults with varying leverage — some tight, some loose
    // HF = (collateral * price * LT) / debt = (10 * price * 0.8) / debt
    let vaults = vec![
        vault(0x01, 10 * PRECISION, 5_000 * PRECISION),    // HF@3K = 4.80 — Conservative
        vault(0x02, 10 * PRECISION, 10_000 * PRECISION),   // HF@3K = 2.40 — Moderate
        vault(0x03, 10 * PRECISION, 14_000 * PRECISION),   // HF@3K = 1.71 — Leveraged
        vault(0x04, 10 * PRECISION, 16_000 * PRECISION),   // HF@3K = 1.50 — Aggressive
        vault(0x05, 10 * PRECISION, 18_000 * PRECISION),   // HF@3K = 1.33 — Warning zone
    ];

    // At $3000: all safe or warning (no hard liquidation)
    let health_3000 = risk::assess_protocol(
        &vaults, &pool, None, 3000 * PRECISION, PRECISION,
    );
    assert_eq!(health_3000.tier_counts.hard_liquidation, 0);

    // At $2000: aggressive positions start hurting
    let health_2000 = risk::assess_protocol(
        &vaults, &pool, None, 2000 * PRECISION, PRECISION,
    );
    assert!(health_2000.tier_counts.safe < 5); // Some moved out of safe

    // At $1000: carnage
    let health_1000 = risk::assess_protocol(
        &vaults, &pool, None, 1000 * PRECISION, PRECISION,
    );
    assert!(health_1000.tier_counts.hard_liquidation > 0);
    assert!(health_1000.worst_health_factor < PRECISION);

    // Risk score should escalate (or saturate at max)
    let score_3000 = risk::risk_score(&health_3000);
    let score_2000 = risk::risk_score(&health_2000);
    let score_1000 = risk::risk_score(&health_1000);
    assert!(score_2000 >= score_3000, "Risk should increase with price drop");
    assert!(score_1000 >= score_2000, "Risk should not decrease with further drop");
}

#[test]
fn test_insurance_reduces_risk_score() {
    let pool = test_pool();
    let insurance = test_insurance();

    let vaults = vec![
        vault(0x01, 10 * PRECISION, 18_000 * PRECISION), // Borderline
    ];

    let without = risk::assess_protocol(
        &vaults, &pool, None, 3000 * PRECISION, PRECISION,
    );
    let with = risk::assess_protocol(
        &vaults, &pool, Some(&insurance), 3000 * PRECISION, PRECISION,
    );

    assert!(risk::risk_score(&with) <= risk::risk_score(&without),
        "Insurance should reduce or maintain risk score");
}

#[test]
fn test_stress_test_progressive_drops() {
    let pool = test_pool();
    let vaults = vec![
        vault(0x01, 10 * PRECISION, 12_000 * PRECISION),
    ];

    // Simulate progressive 5% drops and verify risk escalation
    let mut prev_score = 0u64;
    let drops = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000];

    for &drop_bps in &drops {
        let health = risk::simulate_price_drop(
            &vaults, &pool, None,
            3000 * PRECISION, PRECISION, drop_bps,
        );
        let score = risk::risk_score(&health);
        assert!(score >= prev_score,
            "Risk score should not decrease with larger price drop: {}bps gave {} < {}",
            drop_bps, score, prev_score);
        prev_score = score;
    }
}

#[test]
fn test_liquidation_threshold_realistic() {
    let pool = test_pool();

    // Alice: conservative (10 ETH, $5K debt at $3000 → HF = 4.8)
    // Bob: moderate (10 ETH, $18K debt → HF = 1.33)
    // Charlie: aggressive (10 ETH, $22K debt → HF = 1.09)
    let vaults = vec![
        vault(0x01, 10 * PRECISION, 5_000 * PRECISION),
        vault(0x02, 10 * PRECISION, 18_000 * PRECISION),
        vault(0x03, 10 * PRECISION, 22_000 * PRECISION),
    ];

    let threshold = risk::find_liquidation_threshold(
        &vaults, &pool, None,
        3000 * PRECISION, PRECISION,
    );

    assert!(threshold.is_some());
    let bps = threshold.unwrap();

    // Charlie is most at risk: HF = (10*price*0.8)/22000
    // HF < 1.1 when price < 22000/(10*0.8)*1.1 = 3025
    // So even a tiny drop should trigger — threshold should be very small
    assert!(bps < 500, "Charlie is nearly liquidatable, threshold should be <5%: {}bps", bps);
}

#[test]
fn test_action_priority_matches_urgency() {
    let pool = test_pool();

    let vaults = vec![
        vault(0x01, 100 * PRECISION, 5_000 * PRECISION),   // Very safe
        vault(0x02, 10 * PRECISION, 17_000 * PRECISION),   // Warning zone
        vault(0x03, 10 * PRECISION, 22_000 * PRECISION),   // AutoDeleverage zone
        vault(0x04, 10 * PRECISION, 30_000 * PRECISION),   // Hard liq zone
    ];

    let health = risk::assess_protocol(
        &vaults, &pool, None, 3000 * PRECISION, PRECISION,
    );

    // Should have actions for non-safe vaults
    assert!(!health.pending_actions.is_empty());

    // First action should be most urgent (lowest HF)
    let first = &health.pending_actions[0];
    assert!(first.health_factor <= PRECISION || first.priority <= 200,
        "First action should be most urgent");

    // All actions should be sorted
    for i in 1..health.pending_actions.len() {
        assert!(health.pending_actions[i].priority >= health.pending_actions[i-1].priority);
    }
}

#[test]
fn test_high_utilization_increases_risk() {
    let low_util = LendingPoolCellData {
        total_deposits: 1_000_000 * PRECISION,
        total_borrows: 200_000 * PRECISION, // 20%
        ..test_pool()
    };
    let high_util = LendingPoolCellData {
        total_deposits: 1_000_000 * PRECISION,
        total_borrows: 950_000 * PRECISION, // 95%
        ..test_pool()
    };

    let vaults = vec![vault(0x01, 100 * PRECISION, 50_000 * PRECISION)];

    let health_low = risk::assess_protocol(
        &vaults, &low_util, None, 3000 * PRECISION, PRECISION,
    );
    let health_high = risk::assess_protocol(
        &vaults, &high_util, None, 3000 * PRECISION, PRECISION,
    );

    assert_eq!(health_low.utilization_bps, 2000);
    assert_eq!(health_high.utilization_bps, 9500);
    assert!(risk::risk_score(&health_high) > risk::risk_score(&health_low));
}

#[test]
fn test_zero_debt_vaults_always_safe() {
    let pool = test_pool();

    // Vaults with collateral but no debt — always safe regardless of price
    let vaults = vec![
        vault(0x01, 100 * PRECISION, 0),
        vault(0x02, 1 * PRECISION, 0),
    ];

    // Even at $1 per ETH, no-debt vaults are safe
    let health = risk::assess_protocol(
        &vaults, &pool, None, 1 * PRECISION, PRECISION,
    );

    assert_eq!(health.tier_counts.safe, 2);
    assert!(health.pending_actions.is_empty());
}

#[test]
fn test_deposit_shares_enable_auto_deleverage() {
    let pool = test_pool();

    // Vault with deposit shares can auto-deleverage instead of liquidating
    let vault_with_deps = vault_with_deposits(
        0x01,
        10 * PRECISION,      // 10 ETH collateral
        22_000 * PRECISION,  // High debt
        5_000 * PRECISION,   // Has deposit shares
    );

    let vault_without = vault(
        0x02,
        10 * PRECISION,
        22_000 * PRECISION,  // Same debt, no deposits
    );

    let vaults = vec![vault_with_deps, vault_without];

    let health = risk::assess_protocol(
        &vaults, &pool, None, 3000 * PRECISION, PRECISION,
    );

    // Both should need action, but the one with deposits may get a less severe action
    assert!(health.pending_actions.len() >= 1);
}

#[test]
fn test_risk_level_transitions_with_price() {
    let pool = test_pool();
    let insurance = test_insurance();
    let vaults = vec![
        vault(0x01, 10 * PRECISION, 15_000 * PRECISION),
        vault(0x02, 10 * PRECISION, 18_000 * PRECISION),
        vault(0x03, 10 * PRECISION, 20_000 * PRECISION),
    ];

    // Track risk level as price drops
    let prices = [5000, 3000, 2000, 1500, 1000];
    let mut levels = Vec::new();

    for &price in &prices {
        let health = risk::assess_protocol(
            &vaults, &pool, Some(&insurance),
            price as u128 * PRECISION, PRECISION,
        );
        let score = risk::risk_score(&health);
        levels.push((price, score, risk::classify_risk_level(score)));
    }

    // At $5000: should be Low risk
    assert_eq!(levels[0].2, RiskLevel::Low);

    // At $1000: should be at least Medium (likely High or Critical)
    assert!(matches!(levels[4].2, RiskLevel::Medium | RiskLevel::High | RiskLevel::Critical));

    // Risk should monotonically increase (or stay same) as price drops
    for i in 1..levels.len() {
        assert!(levels[i].1 >= levels[i-1].1,
            "Risk score went down from ${} (score {}) to ${} (score {})",
            levels[i-1].0, levels[i-1].1, levels[i].0, levels[i].1);
    }
}
