// ============ Dual Consensus Engine ============
// Formalizes the interface between non-deterministic (off-chain)
// and deterministic (on-chain) consensus layers.
//
// Architecture:
//   Non-deterministic inputs (oracle prices, confidence scores,
//   multiple price sources, keeper assessments) are QUANTIZED into
//   deterministic outputs (risk tiers, keeper actions, governance
//   decisions) through threshold-based boundary crossings.
//
// Key Properties:
//   1. MONOTONICITY: Worse inputs → equal or more severe outputs
//   2. DETERMINISM: Same inputs → same outputs (integer math only)
//   3. COMPLETENESS: Every input maps to exactly one output tier
//   4. GRADUALISM: Mutualist preference ordering (warn > deleverage > liquidate)
//
// This module captures the "quantization boundary" — the exact point
// where binary and non-binary outcomes understand each other.

use vibeswap_types::*;
use ckb_lending_math::prevention::RiskTier;
use crate::risk::{self, RiskLevel, PendingAction};
use crate::keeper::{self, KeeperAction};
use crate::oracle;

const PRECISION: u128 = ckb_lending_math::PRECISION;

// ============ Dual Consensus Types ============

/// A point-in-time capture of all non-deterministic protocol inputs.
/// This is the "observation" side — what the off-chain world sees.
#[derive(Clone, Debug)]
pub struct ProtocolSnapshot {
    /// Oracle cell data observations (may vary by source)
    pub oracle_data: Vec<OracleCellData>,
    /// Current block height (for staleness checks)
    pub current_block: u64,
    /// All active vaults in the protocol
    pub vaults: Vec<VaultCellData>,
    /// Lending pool state
    pub pool: LendingPoolCellData,
    /// Insurance pool state (if any)
    pub insurance: Option<InsurancePoolCellData>,
    /// Collateral price (fallback if oracle validation fails)
    pub collateral_price: u128,
    /// Debt price (non-deterministic: from oracle or 1:1 stablecoin)
    pub debt_price: u128,
}

/// The deterministic output — what the on-chain world will execute.
/// Every field here is binary or discrete — no fuzzy values.
#[derive(Clone, Debug)]
pub struct ConsensusDecision {
    /// Validated price used for all calculations (single deterministic value)
    pub validated_price: u128,
    /// Protocol health assessment (discrete risk level)
    pub risk_level: RiskLevel,
    /// Composite risk score (0-100, integer)
    pub risk_score: u64,
    /// Ordered list of keeper actions (most urgent first)
    pub actions: Vec<PendingAction>,
    /// Per-vault assessments (each mapped to exactly one tier)
    pub vault_tiers: Vec<VaultTier>,
    /// Whether the oracle data passed validation
    pub oracle_valid: bool,
    /// Number of oracle sources that agreed (within deviation bounds)
    pub oracle_agreement_count: usize,
    /// Utilization tier (discrete)
    pub utilization_tier: UtilizationTier,
    /// Insurance coverage tier (discrete)
    pub coverage_tier: CoverageTier,
}

/// A vault mapped to its discrete risk tier — the quantization output
#[derive(Clone, Debug)]
pub struct VaultTier {
    pub owner_lock_hash: [u8; 32],
    pub health_factor: u128,
    pub tier: RiskTier,
    pub action: KeeperAction,
}

/// Discrete utilization tiers (continuous bps → 4 categories)
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum UtilizationTier {
    Low,       // 0-50%
    Moderate,  // 50-80%
    High,      // 80-90%
    Critical,  // 90%+
}

/// Discrete insurance coverage tiers
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum CoverageTier {
    None,       // 0%
    Minimal,    // 0-5%
    Partial,    // 5-10%
    Adequate,   // 10-20%
    Strong,     // 20%+
}

// ============ Quantization Functions ============

/// The core quantization function: converts a non-deterministic
/// ProtocolSnapshot into a deterministic ConsensusDecision.
///
/// This is where binary and non-binary outcomes "understand each other."
/// All integer math, all deterministic, all monotonic.
pub fn quantize(snapshot: &ProtocolSnapshot) -> ConsensusDecision {
    // Step 1: Quantize oracle prices → single validated price
    let (validated_price, oracle_valid, agreement_count) =
        quantize_oracle(&snapshot.oracle_data, snapshot.current_block);

    // Use validated price if available, fall back to snapshot price
    let price = if oracle_valid { validated_price } else { snapshot.collateral_price };

    // Step 2: Quantize protocol state → risk assessment
    let health = risk::assess_protocol(
        &snapshot.vaults,
        &snapshot.pool,
        snapshot.insurance.as_ref(),
        price,
        snapshot.debt_price,
    );

    let score = risk::risk_score(&health);
    let level = risk::classify_risk_level(score);

    // Step 3: Quantize each vault → discrete tier + action
    let vault_tiers: Vec<VaultTier> = snapshot.vaults.iter().map(|vault| {
        let assessment = keeper::assess_vault(
            vault,
            &snapshot.pool,
            snapshot.insurance.as_ref(),
            price,
            snapshot.debt_price,
        );
        VaultTier {
            owner_lock_hash: vault.owner_lock_hash,
            health_factor: assessment.health_factor,
            tier: assessment.risk_tier,
            action: assessment.action,
        }
    }).collect();

    // Step 4: Quantize utilization → tier
    let utilization_tier = quantize_utilization(health.utilization_bps);

    // Step 5: Quantize insurance coverage → tier
    let coverage_tier = quantize_coverage(health.insurance_coverage_bps);

    ConsensusDecision {
        validated_price: price,
        risk_level: level,
        risk_score: score,
        actions: health.pending_actions,
        vault_tiers,
        oracle_valid,
        oracle_agreement_count: agreement_count,
        utilization_tier,
        coverage_tier,
    }
}

/// Quantize multiple oracle sources into a single validated price.
/// Returns (price, is_valid, agreement_count).
fn quantize_oracle(
    oracles: &[OracleCellData],
    current_block: u64,
) -> (u128, bool, usize) {
    if oracles.is_empty() {
        return (0, false, 0);
    }

    // Filter fresh oracles
    let fresh: Vec<&OracleCellData> = oracles.iter()
        .filter(|o| oracle::validate_freshness(o, current_block).is_ok())
        .collect();

    if fresh.is_empty() {
        return (0, false, 0);
    }

    // Extract price values from fresh oracles
    let price_values: Vec<u128> = fresh.iter().map(|o| o.price).collect();

    // Use median for single-value aggregation
    let median = compute_median(&price_values);

    // Count how many agree (within 10% deviation)
    let agreement = price_values.iter()
        .filter(|&&p| {
            let diff = if p > median { p - median } else { median - p };
            // diff / median <= 10% → diff * 10000 <= median * 1000
            diff * 10_000 <= median * 1_000
        })
        .count();

    let valid = agreement >= (fresh.len() + 1) / 2; // Majority must agree

    (median, valid, agreement)
}

fn compute_median(values: &[u128]) -> u128 {
    if values.is_empty() {
        return 0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let mid = sorted.len() / 2;
    if sorted.len() % 2 == 0 {
        // Average of two middle values (integer)
        sorted[mid - 1] / 2 + sorted[mid] / 2
    } else {
        sorted[mid]
    }
}

fn quantize_utilization(bps: u64) -> UtilizationTier {
    match bps {
        0..=5000 => UtilizationTier::Low,
        5001..=8000 => UtilizationTier::Moderate,
        8001..=9000 => UtilizationTier::High,
        _ => UtilizationTier::Critical,
    }
}

fn quantize_coverage(bps: u64) -> CoverageTier {
    match bps {
        0 => CoverageTier::None,
        1..=500 => CoverageTier::Minimal,
        501..=1000 => CoverageTier::Partial,
        1001..=2000 => CoverageTier::Adequate,
        _ => CoverageTier::Strong,
    }
}

// ============ Monotonicity Verification ============

/// Verify that the dual consensus system maintains monotonicity:
/// if the protocol gets riskier (worse snapshot), the decision
/// must be at least as severe (never downgrade actions).
///
/// Returns true if the pair satisfies monotonicity.
pub fn verify_monotonicity(
    safer: &ConsensusDecision,
    riskier: &ConsensusDecision,
) -> MonotonicityResult {
    let mut violations = Vec::new();

    // Risk score must not decrease
    if riskier.risk_score < safer.risk_score {
        violations.push(MonotonicityViolation::RiskScoreDecreased {
            from: safer.risk_score,
            to: riskier.risk_score,
        });
    }

    // Risk level must not improve
    if risk_level_ordinal(&riskier.risk_level) < risk_level_ordinal(&safer.risk_level) {
        violations.push(MonotonicityViolation::RiskLevelImproved {
            from: safer.risk_level.clone(),
            to: riskier.risk_level.clone(),
        });
    }

    // Utilization tier must not improve
    if riskier.utilization_tier < safer.utilization_tier {
        violations.push(MonotonicityViolation::UtilizationImproved);
    }

    // Number of actions must not decrease
    if riskier.actions.len() < safer.actions.len() {
        violations.push(MonotonicityViolation::ActionCountDecreased {
            from: safer.actions.len(),
            to: riskier.actions.len(),
        });
    }

    MonotonicityResult {
        is_monotonic: violations.is_empty(),
        violations,
    }
}

#[derive(Clone, Debug)]
pub struct MonotonicityResult {
    pub is_monotonic: bool,
    pub violations: Vec<MonotonicityViolation>,
}

#[derive(Clone, Debug)]
pub enum MonotonicityViolation {
    RiskScoreDecreased { from: u64, to: u64 },
    RiskLevelImproved { from: RiskLevel, to: RiskLevel },
    UtilizationImproved,
    ActionCountDecreased { from: usize, to: usize },
}

fn risk_level_ordinal(level: &RiskLevel) -> u8 {
    match level {
        RiskLevel::Low => 0,
        RiskLevel::Medium => 1,
        RiskLevel::High => 2,
        RiskLevel::Critical => 3,
    }
}

// ============ Stress Simulation ============

/// Simulate a price drop and return both snapshots + decisions
/// for monotonicity verification.
pub fn simulate_price_stress(
    snapshot: &ProtocolSnapshot,
    drop_bps: u64,
) -> (ConsensusDecision, ConsensusDecision) {
    let before = quantize(snapshot);

    let mut stressed = snapshot.clone();
    stressed.collateral_price = ckb_lending_math::mul_div(
        snapshot.collateral_price,
        10_000 - drop_bps as u128,
        10_000,
    );
    // Clear oracle data so stressed snapshot uses the adjusted price
    stressed.oracle_data.clear();

    let after = quantize(&stressed);

    (before, after)
}

/// Find the smallest price drop (in bps) that causes a tier transition
/// for any vault in the protocol.
pub fn find_tier_transition_threshold(
    snapshot: &ProtocolSnapshot,
) -> Option<u64> {
    let baseline = quantize(snapshot);

    // Binary search: 0 to 10000 bps (0% to 100% drop)
    let mut low: u64 = 0;
    let mut high: u64 = 10_000;
    let mut found = false;

    while low < high {
        let mid = (low + high) / 2;
        let (_, stressed) = simulate_price_stress(snapshot, mid);

        // Check if any vault changed tier
        let changed = tier_changed(&baseline, &stressed);
        if changed {
            high = mid;
            found = true;
        } else {
            low = mid + 1;
        }
    }

    if found { Some(low) } else { None }
}

fn tier_changed(a: &ConsensusDecision, b: &ConsensusDecision) -> bool {
    if a.vault_tiers.len() != b.vault_tiers.len() {
        return true;
    }
    for (va, vb) in a.vault_tiers.iter().zip(b.vault_tiers.iter()) {
        if va.tier != vb.tier {
            return true;
        }
    }
    false
}

// ============ Consensus Report ============

/// A human-readable report combining both consensus layers.
/// For dashboards, keeper UIs, and governance visibility.
#[derive(Clone, Debug)]
pub struct DualConsensusReport {
    /// Non-deterministic layer summary
    pub observation: ObservationSummary,
    /// Deterministic layer output
    pub decision: ConsensusDecision,
    /// Stress test results
    pub stress: StressReport,
}

#[derive(Clone, Debug)]
pub struct ObservationSummary {
    pub oracle_source_count: usize,
    pub fresh_source_count: usize,
    pub price_spread_bps: u64,
    pub vault_count: usize,
    pub total_collateral_value: u128,
    pub total_debt: u128,
}

#[derive(Clone, Debug)]
pub struct StressReport {
    /// Bps drop until first tier transition (None = never)
    pub tier_transition_threshold: Option<u64>,
    /// Risk level at 10% drop
    pub risk_at_10pct_drop: RiskLevel,
    /// Risk level at 25% drop
    pub risk_at_25pct_drop: RiskLevel,
    /// Risk level at 50% drop
    pub risk_at_50pct_drop: RiskLevel,
}

/// Generate a full dual-consensus report from a protocol snapshot.
pub fn generate_report(snapshot: &ProtocolSnapshot) -> DualConsensusReport {
    let decision = quantize(snapshot);

    // Compute observation summary
    let fresh_count = snapshot.oracle_data.iter()
        .filter(|o| oracle::validate_freshness(o, snapshot.current_block).is_ok())
        .count();

    let price_values: Vec<u128> = snapshot.oracle_data.iter()
        .map(|o| o.price)
        .collect();
    let spread_bps = if price_values.len() >= 2 {
        let min = *price_values.iter().min().unwrap();
        let max = *price_values.iter().max().unwrap();
        if min > 0 {
            ((max - min) * 10_000 / min) as u64
        } else {
            0
        }
    } else {
        0
    };

    let total_collateral: u128 = snapshot.vaults.iter()
        .map(|v| ckb_lending_math::mul_div(
            v.collateral_amount, snapshot.collateral_price, PRECISION,
        ))
        .sum();
    let total_debt: u128 = snapshot.vaults.iter()
        .map(|v| v.debt_shares)
        .sum();

    let observation = ObservationSummary {
        oracle_source_count: snapshot.oracle_data.len(),
        fresh_source_count: fresh_count,
        price_spread_bps: spread_bps,
        vault_count: snapshot.vaults.len(),
        total_collateral_value: total_collateral,
        total_debt,
    };

    // Stress tests at 10%, 25%, 50%
    let risk_10 = {
        let (_, d) = simulate_price_stress(snapshot, 1000);
        d.risk_level
    };
    let risk_25 = {
        let (_, d) = simulate_price_stress(snapshot, 2500);
        d.risk_level
    };
    let risk_50 = {
        let (_, d) = simulate_price_stress(snapshot, 5000);
        d.risk_level
    };

    let threshold = find_tier_transition_threshold(snapshot);

    let stress = StressReport {
        tier_transition_threshold: threshold,
        risk_at_10pct_drop: risk_10,
        risk_at_25pct_drop: risk_25,
        risk_at_50pct_drop: risk_50,
    };

    DualConsensusReport {
        observation,
        decision,
        stress,
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

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

    fn test_oracle(price: u128, confidence: u8, block: u64) -> OracleCellData {
        OracleCellData {
            price,
            block_number: block,
            confidence,
            source_hash: [0xEE; 32],
            pair_id: [0xDD; 32],
        }
    }

    fn test_snapshot() -> ProtocolSnapshot {
        ProtocolSnapshot {
            oracle_data: vec![
                test_oracle(3000 * PRECISION, 90, 100),
                test_oracle(3010 * PRECISION, 85, 99),
                test_oracle(2990 * PRECISION, 80, 98),
            ],
            current_block: 105,
            vaults: vec![
                vault(0x01, 100 * PRECISION, 50_000 * PRECISION),
                vault(0x02, 10 * PRECISION, 18_000 * PRECISION),
                vault(0x03, 10 * PRECISION, 22_000 * PRECISION),
            ],
            pool: test_pool(),
            insurance: Some(test_insurance()),
            collateral_price: 3000 * PRECISION,
            debt_price: PRECISION,
        }
    }

    // ============ Quantization Tests ============

    #[test]
    fn test_quantize_produces_deterministic_output() {
        let snapshot = test_snapshot();
        let d1 = quantize(&snapshot);
        let d2 = quantize(&snapshot);

        // Same input → same output (deterministic)
        assert_eq!(d1.risk_score, d2.risk_score);
        assert_eq!(d1.risk_level, d2.risk_level);
        assert_eq!(d1.vault_tiers.len(), d2.vault_tiers.len());
        assert_eq!(d1.utilization_tier, d2.utilization_tier);
        assert_eq!(d1.coverage_tier, d2.coverage_tier);
    }

    #[test]
    fn test_quantize_maps_every_vault_to_tier() {
        let snapshot = test_snapshot();
        let decision = quantize(&snapshot);

        // Every vault gets a tier (completeness)
        assert_eq!(decision.vault_tiers.len(), snapshot.vaults.len());
    }

    #[test]
    fn test_quantize_oracle_validation() {
        let mut snapshot = test_snapshot();
        let d1 = quantize(&snapshot);
        assert!(d1.oracle_valid);
        assert_eq!(d1.oracle_agreement_count, 3);

        // Make all oracles stale
        snapshot.current_block = 500;
        let d2 = quantize(&snapshot);
        assert!(!d2.oracle_valid);
        assert_eq!(d2.oracle_agreement_count, 0);
    }

    #[test]
    fn test_quantize_utilization_tiers() {
        assert_eq!(quantize_utilization(0), UtilizationTier::Low);
        assert_eq!(quantize_utilization(2500), UtilizationTier::Low);
        assert_eq!(quantize_utilization(5000), UtilizationTier::Low);
        assert_eq!(quantize_utilization(5001), UtilizationTier::Moderate);
        assert_eq!(quantize_utilization(8000), UtilizationTier::Moderate);
        assert_eq!(quantize_utilization(8001), UtilizationTier::High);
        assert_eq!(quantize_utilization(9000), UtilizationTier::High);
        assert_eq!(quantize_utilization(9001), UtilizationTier::Critical);
        assert_eq!(quantize_utilization(10000), UtilizationTier::Critical);
    }

    #[test]
    fn test_quantize_coverage_tiers() {
        assert_eq!(quantize_coverage(0), CoverageTier::None);
        assert_eq!(quantize_coverage(1), CoverageTier::Minimal);
        assert_eq!(quantize_coverage(500), CoverageTier::Minimal);
        assert_eq!(quantize_coverage(501), CoverageTier::Partial);
        assert_eq!(quantize_coverage(1000), CoverageTier::Partial);
        assert_eq!(quantize_coverage(1001), CoverageTier::Adequate);
        assert_eq!(quantize_coverage(2000), CoverageTier::Adequate);
        assert_eq!(quantize_coverage(2001), CoverageTier::Strong);
    }

    // ============ Median Tests ============

    #[test]
    fn test_median_odd_count() {
        assert_eq!(compute_median(&[100, 200, 300]), 200);
        assert_eq!(compute_median(&[300, 100, 200]), 200);
        assert_eq!(compute_median(&[1, 1, 1]), 1);
    }

    #[test]
    fn test_median_even_count() {
        assert_eq!(compute_median(&[100, 200]), 150);
        assert_eq!(compute_median(&[100, 200, 300, 400]), 250);
    }

    #[test]
    fn test_median_single_value() {
        assert_eq!(compute_median(&[42]), 42);
    }

    #[test]
    fn test_median_empty() {
        assert_eq!(compute_median(&[]), 0);
    }

    // ============ Monotonicity Tests ============

    #[test]
    fn test_monotonicity_price_drop() {
        let snapshot = test_snapshot();
        let (before, after) = simulate_price_stress(&snapshot, 2000); // 20% drop

        let result = verify_monotonicity(&before, &after);
        assert!(result.is_monotonic,
            "20% price drop should maintain monotonicity: {:?}", result.violations);
    }

    #[test]
    fn test_monotonicity_progressive_drops() {
        let snapshot = test_snapshot();

        let mut prev_decision = quantize(&snapshot);
        for drop_bps in [500, 1000, 1500, 2000, 3000, 4000, 5000] {
            let (_, current) = simulate_price_stress(&snapshot, drop_bps);
            let result = verify_monotonicity(&prev_decision, &current);
            assert!(result.is_monotonic,
                "Drop of {}bps should maintain monotonicity: {:?}",
                drop_bps, result.violations);
            prev_decision = current;
        }
    }

    #[test]
    fn test_monotonicity_violation_detected() {
        // Construct two decisions where monotonicity is violated
        let snapshot = test_snapshot();
        let d1 = quantize(&snapshot);

        // Artificially create a "better" decision (simulate bug)
        let mut d2 = d1.clone();
        d2.risk_score = d1.risk_score.saturating_sub(10);

        let result = verify_monotonicity(&d1, &d2);
        assert!(!result.is_monotonic);
        assert!(!result.violations.is_empty());
    }

    // ============ Stress Simulation Tests ============

    #[test]
    fn test_simulate_price_stress() {
        let snapshot = test_snapshot();
        let (before, after) = simulate_price_stress(&snapshot, 5000); // 50% drop

        // After 50% drop, risk should be higher
        assert!(after.risk_score >= before.risk_score);
    }

    #[test]
    fn test_tier_transition_threshold_exists() {
        let snapshot = test_snapshot();
        let threshold = find_tier_transition_threshold(&snapshot);

        // With a vault at 10 ETH / $22K debt (HF ≈ 1.09 at $3000),
        // even a tiny drop should push it into a worse tier
        assert!(threshold.is_some());
        let bps = threshold.unwrap();
        assert!(bps <= 5000, "Threshold should be reasonable: {}bps", bps);
    }

    #[test]
    fn test_no_tier_transition_for_safe_portfolio() {
        let mut snapshot = test_snapshot();
        // All very safe vaults
        snapshot.vaults = vec![
            vault(0x01, 100 * PRECISION, 5_000 * PRECISION),
            vault(0x02, 100 * PRECISION, 5_000 * PRECISION),
        ];

        let threshold = find_tier_transition_threshold(&snapshot);
        // Very safe vaults might not transition until extreme drops
        if let Some(bps) = threshold {
            assert!(bps > 1000, "Safe vaults shouldn't transition easily: {}bps", bps);
        }
    }

    // ============ Report Tests ============

    #[test]
    fn test_generate_report_complete() {
        let snapshot = test_snapshot();
        let report = generate_report(&snapshot);

        // Observation layer populated
        assert_eq!(report.observation.oracle_source_count, 3);
        assert_eq!(report.observation.vault_count, 3);
        assert!(report.observation.total_collateral_value > 0);
        assert!(report.observation.total_debt > 0);

        // Decision layer populated
        assert!(report.decision.validated_price > 0);
        assert_eq!(report.decision.vault_tiers.len(), 3);

        // Stress layer populated
        // risk at bigger drops should be >= risk at smaller drops
        assert!(risk_level_ordinal(&report.stress.risk_at_25pct_drop)
            >= risk_level_ordinal(&report.stress.risk_at_10pct_drop));
        assert!(risk_level_ordinal(&report.stress.risk_at_50pct_drop)
            >= risk_level_ordinal(&report.stress.risk_at_25pct_drop));
    }

    #[test]
    fn test_report_empty_oracle() {
        let mut snapshot = test_snapshot();
        snapshot.oracle_data.clear();
        let report = generate_report(&snapshot);

        assert_eq!(report.observation.oracle_source_count, 0);
        assert!(!report.decision.oracle_valid);
    }

    #[test]
    fn test_report_single_vault() {
        let mut snapshot = test_snapshot();
        snapshot.vaults = vec![vault(0x01, 10 * PRECISION, 15_000 * PRECISION)];

        let report = generate_report(&snapshot);
        assert_eq!(report.decision.vault_tiers.len(), 1);
        assert_eq!(report.observation.vault_count, 1);
    }

    // ============ Oracle Quantization Tests ============

    #[test]
    fn test_oracle_agreement_all_agree() {
        let oracles = vec![
            test_oracle(3000 * PRECISION, 90, 100),
            test_oracle(3010 * PRECISION, 85, 99),
            test_oracle(2990 * PRECISION, 80, 98),
        ];

        let (price, valid, agreement) = quantize_oracle(&oracles, 105);
        assert!(valid);
        assert_eq!(agreement, 3);
        // Median of 2990, 3000, 3010 = 3000
        assert_eq!(price, 3000 * PRECISION);
    }

    #[test]
    fn test_oracle_disagreement_rejects() {
        let oracles = vec![
            test_oracle(3000 * PRECISION, 90, 100),
            test_oracle(5000 * PRECISION, 85, 99), // 67% off
            test_oracle(1000 * PRECISION, 80, 98), // 67% off
        ];

        let (_price, valid, agreement) = quantize_oracle(&oracles, 105);
        // Median is 3000, but the other two are far off
        // Only 1 of 3 agrees — not majority
        assert_eq!(agreement, 1);
        assert!(!valid);
    }

    #[test]
    fn test_oracle_stale_excluded() {
        let oracles = vec![
            test_oracle(3000 * PRECISION, 90, 100),
            test_oracle(3010 * PRECISION, 85, 1), // Very stale
            test_oracle(2990 * PRECISION, 80, 2), // Very stale
        ];

        let (_price, valid, _agreement) = quantize_oracle(&oracles, 105);
        // Only 1 fresh source — 1/1 agree → valid
        assert!(valid);
    }

    // ============ Edge Cases ============

    #[test]
    fn test_quantize_zero_debt_vaults() {
        let mut snapshot = test_snapshot();
        snapshot.vaults = vec![
            vault(0x01, 100 * PRECISION, 0),
            vault(0x02, 50 * PRECISION, 0),
        ];

        let decision = quantize(&snapshot);
        // All vaults should be safe regardless of price
        for vt in &decision.vault_tiers {
            assert_eq!(vt.tier, RiskTier::Safe);
        }
    }

    #[test]
    fn test_quantize_no_vaults() {
        let mut snapshot = test_snapshot();
        snapshot.vaults.clear();

        let decision = quantize(&snapshot);
        assert!(decision.vault_tiers.is_empty());
        assert!(decision.actions.is_empty());
    }
}
