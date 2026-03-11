// ============ Dual Consensus Integration Tests ============
// End-to-end testing of the quantization boundary between
// non-deterministic (off-chain) and deterministic (on-chain) consensus.
//
// Tests verify:
// 1. Full pipeline: raw oracle data → validated price → risk assessment → keeper actions
// 2. Monotonicity: worse inputs always produce equal/more severe outputs
// 3. Determinism: same snapshot always produces same decision
// 4. Tier completeness: every vault maps to exactly one tier
// 5. Stress resilience: progressive drops maintain system invariants

use vibeswap_types::*;
use vibeswap_sdk::consensus::{self, *};
use vibeswap_sdk::risk::RiskLevel;
use ckb_lending_math::prevention::RiskTier;
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

fn oracle(price: u128, confidence: u8, block: u64) -> OracleCellData {
    OracleCellData {
        price,
        block_number: block,
        confidence,
        source_hash: [0xEE; 32],
        pair_id: [0xDD; 32],
    }
}

fn base_snapshot() -> ProtocolSnapshot {
    ProtocolSnapshot {
        oracle_data: vec![
            oracle(3000 * PRECISION, 90, 100),
            oracle(3010 * PRECISION, 85, 99),
            oracle(2990 * PRECISION, 80, 98),
        ],
        current_block: 105,
        vaults: vec![
            vault(0x01, 100 * PRECISION, 50_000 * PRECISION),  // Very safe (HF ≈ 4.8)
            vault(0x02, 10 * PRECISION, 18_000 * PRECISION),   // Warning zone (HF ≈ 1.33)
            vault(0x03, 10 * PRECISION, 22_000 * PRECISION),   // Near liquidation (HF ≈ 1.09)
        ],
        pool: test_pool(),
        insurance: Some(test_insurance()),
        collateral_price: 3000 * PRECISION,
        debt_price: PRECISION,
    }
}

// ============ Full Pipeline Tests ============

#[test]
fn test_full_pipeline_healthy_market() {
    let snapshot = ProtocolSnapshot {
        oracle_data: vec![
            oracle(3000 * PRECISION, 95, 100),
            oracle(3005 * PRECISION, 90, 100),
            oracle(2998 * PRECISION, 88, 99),
        ],
        current_block: 102,
        vaults: vec![
            vault(0x01, 100 * PRECISION, 50_000 * PRECISION), // HF ≈ 4.8
            vault(0x02, 50 * PRECISION, 30_000 * PRECISION),  // HF ≈ 4.0
            vault(0x03, 20 * PRECISION, 10_000 * PRECISION),  // HF ≈ 4.8
        ],
        pool: test_pool(),
        insurance: Some(test_insurance()),
        collateral_price: 3000 * PRECISION,
        debt_price: PRECISION,
    };

    let decision = consensus::quantize(&snapshot);

    // All vaults safe in a healthy market
    assert!(decision.oracle_valid);
    assert_eq!(decision.oracle_agreement_count, 3);
    for vt in &decision.vault_tiers {
        assert_eq!(vt.tier, RiskTier::Safe);
    }
    assert_eq!(decision.risk_level, RiskLevel::Low);
    assert_eq!(decision.utilization_tier, UtilizationTier::Low);
    assert!(decision.coverage_tier >= CoverageTier::Adequate);
}

#[test]
fn test_full_pipeline_mixed_risk_portfolio() {
    let snapshot = base_snapshot();
    let decision = consensus::quantize(&snapshot);

    // Vault 1 (100 ETH / $50K) should be safe
    assert_eq!(decision.vault_tiers[0].tier, RiskTier::Safe);

    // Vault 3 (10 ETH / $22K, HF ≈ 1.09) should be in danger zone
    let tier3 = &decision.vault_tiers[2];
    assert!(
        tier3.tier == RiskTier::SoftLiquidation || tier3.tier == RiskTier::HardLiquidation,
        "Vault 3 (HF ≈ 1.09) should be in liquidation zone, got {:?}", tier3.tier
    );

    // Should have pending actions for risky vaults
    assert!(!decision.actions.is_empty());
}

#[test]
fn test_full_pipeline_market_crash() {
    let mut snapshot = base_snapshot();
    // Price crash to $1000
    snapshot.collateral_price = 1000 * PRECISION;
    snapshot.oracle_data = vec![
        oracle(1000 * PRECISION, 90, 100),
        oracle(1010 * PRECISION, 85, 99),
        oracle(990 * PRECISION, 80, 98),
    ];

    let decision = consensus::quantize(&snapshot);

    // At $1000, vault 2 (10 ETH / $18K) has HF ≈ 0.44, vault 3 even worse
    let liquidatable: Vec<_> = decision.vault_tiers.iter()
        .filter(|vt| vt.tier == RiskTier::HardLiquidation)
        .collect();

    assert!(liquidatable.len() >= 2, "At least 2 vaults should be liquidatable at $1000");
    assert!(matches!(decision.risk_level,
        RiskLevel::Medium | RiskLevel::High | RiskLevel::Critical),
        "Expected at least Medium risk at $1000 crash, got {:?} (score {})",
        decision.risk_level, decision.risk_score);
}

// ============ Oracle Quantization Tests ============

#[test]
fn test_oracle_consensus_requires_majority() {
    let mut snapshot = base_snapshot();

    // 2 of 3 agree, 1 is wildly off
    snapshot.oracle_data = vec![
        oracle(3000 * PRECISION, 90, 100),
        oracle(3005 * PRECISION, 85, 99),
        oracle(6000 * PRECISION, 80, 98), // Manipulated — 100% off
    ];

    let decision = consensus::quantize(&snapshot);

    // Should still be valid: 2/3 agree (majority)
    assert!(decision.oracle_valid);
    assert_eq!(decision.oracle_agreement_count, 2);
    // Median should be ~3005 (middle of sorted [3000, 3005, 6000])
    assert!(decision.validated_price >= 3000 * PRECISION);
    assert!(decision.validated_price <= 3010 * PRECISION);
}

#[test]
fn test_oracle_stale_data_falls_back() {
    let mut snapshot = base_snapshot();
    // All oracles very stale (block 1 vs current 500)
    snapshot.oracle_data = vec![
        oracle(3000 * PRECISION, 90, 1),
        oracle(3010 * PRECISION, 85, 2),
    ];
    snapshot.current_block = 500;

    let decision = consensus::quantize(&snapshot);

    // Oracle invalid — should fall back to snapshot.collateral_price
    assert!(!decision.oracle_valid);
    assert_eq!(decision.validated_price, 3000 * PRECISION);
}

#[test]
fn test_oracle_empty_uses_fallback() {
    let mut snapshot = base_snapshot();
    snapshot.oracle_data.clear();

    let decision = consensus::quantize(&snapshot);

    assert!(!decision.oracle_valid);
    assert_eq!(decision.oracle_agreement_count, 0);
    // Falls back to collateral_price
    assert_eq!(decision.validated_price, snapshot.collateral_price);
}

// ============ Monotonicity Invariant Tests ============

#[test]
fn test_monotonicity_across_10_price_levels() {
    let snapshot = base_snapshot();

    let prices = [5000, 4000, 3500, 3000, 2500, 2000, 1500, 1000, 500, 250];
    let mut prev_decision: Option<ConsensusDecision> = None;

    for &price in &prices {
        let mut s = snapshot.clone();
        s.collateral_price = price as u128 * PRECISION;
        s.oracle_data.clear(); // Use collateral_price directly

        let decision = consensus::quantize(&s);

        if let Some(prev) = &prev_decision {
            let result = consensus::verify_monotonicity(prev, &decision);
            assert!(result.is_monotonic,
                "Monotonicity violated at price ${}: {:?}",
                price, result.violations);
        }

        prev_decision = Some(decision);
    }
}

#[test]
fn test_monotonicity_stress_simulation() {
    let snapshot = base_snapshot();

    for drop_bps in (0..=5000).step_by(500) {
        if drop_bps == 0 { continue; }
        let (before, after) = consensus::simulate_price_stress(&snapshot, drop_bps);

        let result = consensus::verify_monotonicity(&before, &after);
        assert!(result.is_monotonic,
            "Stress drop of {}bps violated monotonicity: {:?}",
            drop_bps, result.violations);
    }
}

// ============ Determinism Tests ============

#[test]
fn test_determinism_100_runs() {
    let snapshot = base_snapshot();

    let baseline = consensus::quantize(&snapshot);

    for _ in 0..100 {
        let d = consensus::quantize(&snapshot);
        assert_eq!(d.risk_score, baseline.risk_score);
        assert_eq!(d.risk_level, baseline.risk_level);
        assert_eq!(d.validated_price, baseline.validated_price);
        assert_eq!(d.oracle_valid, baseline.oracle_valid);
        assert_eq!(d.oracle_agreement_count, baseline.oracle_agreement_count);
        assert_eq!(d.vault_tiers.len(), baseline.vault_tiers.len());
        for (a, b) in d.vault_tiers.iter().zip(baseline.vault_tiers.iter()) {
            assert_eq!(a.tier, b.tier);
            assert_eq!(a.health_factor, b.health_factor);
        }
    }
}

// ============ Report Tests ============

#[test]
fn test_report_captures_both_layers() {
    let snapshot = base_snapshot();
    let report = consensus::generate_report(&snapshot);

    // Observation layer (non-deterministic inputs)
    assert_eq!(report.observation.oracle_source_count, 3);
    assert_eq!(report.observation.vault_count, 3);
    assert!(report.observation.total_collateral_value > 0);
    assert!(report.observation.total_debt > 0);
    // Spread should be small (3 sources within 1%)
    assert!(report.observation.price_spread_bps < 100,
        "Spread should be small: {} bps", report.observation.price_spread_bps);

    // Decision layer (deterministic outputs)
    assert!(report.decision.oracle_valid);
    assert_eq!(report.decision.vault_tiers.len(), 3);

    // Stress layer (forward-looking assessment)
    assert!(report.stress.tier_transition_threshold.is_some());
}

#[test]
fn test_report_stress_escalation() {
    let snapshot = base_snapshot();
    let report = consensus::generate_report(&snapshot);

    // Risk should escalate with larger drops
    let ord_10 = risk_level_ord(&report.stress.risk_at_10pct_drop);
    let ord_25 = risk_level_ord(&report.stress.risk_at_25pct_drop);
    let ord_50 = risk_level_ord(&report.stress.risk_at_50pct_drop);

    assert!(ord_25 >= ord_10, "25% drop should be >= 10% drop risk");
    assert!(ord_50 >= ord_25, "50% drop should be >= 25% drop risk");
}

fn risk_level_ord(level: &RiskLevel) -> u8 {
    match level {
        RiskLevel::Low => 0,
        RiskLevel::Medium => 1,
        RiskLevel::High => 2,
        RiskLevel::Critical => 3,
    }
}

// ============ Tier Transition Tests ============

#[test]
fn test_tier_transition_threshold_precision() {
    let snapshot = base_snapshot();

    if let Some(threshold_bps) = consensus::find_tier_transition_threshold(&snapshot) {
        // Just below threshold: no tier change
        if threshold_bps > 1 {
            let (_, below) = consensus::simulate_price_stress(&snapshot, threshold_bps - 1);
            let baseline = consensus::quantize(&snapshot);

            // At least one vault should still be in its original tier
            let same_count = baseline.vault_tiers.iter()
                .zip(below.vault_tiers.iter())
                .filter(|(a, b)| a.tier == b.tier)
                .count();
            assert_eq!(same_count, baseline.vault_tiers.len(),
                "Below threshold ({}bps - 1), no vault should change tier", threshold_bps);
        }
    }
}

// ============ Insurance Impact Tests ============

#[test]
fn test_insurance_affects_coverage_tier() {
    let mut with_insurance = base_snapshot();
    let mut without_insurance = base_snapshot();
    without_insurance.insurance = None;

    let d_with = consensus::quantize(&with_insurance);
    let d_without = consensus::quantize(&without_insurance);

    assert!(d_with.coverage_tier > CoverageTier::None);
    assert_eq!(d_without.coverage_tier, CoverageTier::None);

    // Insurance should reduce or maintain risk score
    assert!(d_with.risk_score <= d_without.risk_score,
        "Insurance should not increase risk: with={}, without={}",
        d_with.risk_score, d_without.risk_score);
}

// ============ Utilization Tier Tests ============

#[test]
fn test_utilization_tiers_across_spectrum() {
    let test_cases = vec![
        (200_000, UtilizationTier::Low),        // 20%
        (500_000, UtilizationTier::Low),         // 50%
        (700_000, UtilizationTier::Moderate),    // 70%
        (850_000, UtilizationTier::High),        // 85%
        (950_000, UtilizationTier::Critical),    // 95%
    ];

    for (borrows, expected_tier) in test_cases {
        let mut snapshot = base_snapshot();
        snapshot.pool.total_borrows = borrows as u128 * PRECISION;

        let decision = consensus::quantize(&snapshot);
        assert_eq!(decision.utilization_tier, expected_tier,
            "Borrows {} should give {:?}, got {:?}",
            borrows, expected_tier, decision.utilization_tier);
    }
}

// ============ Edge Cases ============

#[test]
fn test_empty_protocol_no_vaults() {
    let mut snapshot = base_snapshot();
    snapshot.vaults.clear();

    let decision = consensus::quantize(&snapshot);
    assert!(decision.vault_tiers.is_empty());
    assert!(decision.actions.is_empty());
    // Risk should be low with no vaults
    assert_eq!(decision.risk_level, RiskLevel::Low);
}

#[test]
fn test_single_vault_all_debt() {
    let mut snapshot = base_snapshot();
    // One vault with extreme leverage: 1 ETH, $2500 debt (HF ≈ 0.96 at $3000)
    snapshot.vaults = vec![vault(0x01, 1 * PRECISION, 2_500 * PRECISION)];

    let decision = consensus::quantize(&snapshot);
    assert_eq!(decision.vault_tiers.len(), 1);
    assert_eq!(decision.vault_tiers[0].tier, RiskTier::HardLiquidation);
    assert!(!decision.actions.is_empty());
}

#[test]
fn test_price_at_one_wei() {
    let mut snapshot = base_snapshot();
    // Extreme: price = 1 (1 wei)
    snapshot.collateral_price = 1;
    snapshot.oracle_data.clear();

    let decision = consensus::quantize(&snapshot);
    // All vaults with debt should be liquidatable
    let liquidatable = decision.vault_tiers.iter()
        .filter(|vt| vt.tier == RiskTier::HardLiquidation)
        .count();
    // Vaults 2 and 3 have debt
    assert!(liquidatable >= 2);
}
