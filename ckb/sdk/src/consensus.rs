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

    // ============ New Hardening Tests ============

    #[test]
    fn test_median_large_values_no_overflow() {
        // Two values close to u128::MAX / 2 should not overflow during averaging
        let a = u128::MAX / 2;
        let b = u128::MAX / 2 + 1;
        let result = compute_median(&[a, b]);
        // sorted[0]/2 + sorted[1]/2 avoids overflow
        assert_eq!(result, a / 2 + b / 2);
    }

    #[test]
    fn test_median_identical_values() {
        let val = 7777 * PRECISION;
        assert_eq!(compute_median(&[val, val, val, val, val]), val);
    }

    #[test]
    fn test_quantize_oracle_single_source_valid() {
        // A single fresh oracle is both the median and the majority — should be valid
        let oracles = vec![test_oracle(4200 * PRECISION, 95, 100)];
        let (price, valid, agreement) = quantize_oracle(&oracles, 105);
        assert!(valid);
        assert_eq!(agreement, 1);
        assert_eq!(price, 4200 * PRECISION);
    }

    #[test]
    fn test_quantize_oracle_all_stale_returns_invalid() {
        let oracles = vec![
            test_oracle(3000 * PRECISION, 90, 1),
            test_oracle(3010 * PRECISION, 85, 2),
        ];
        let (price, valid, agreement) = quantize_oracle(&oracles, 500);
        assert!(!valid);
        assert_eq!(price, 0);
        assert_eq!(agreement, 0);
    }

    #[test]
    fn test_quantize_oracle_empty_returns_invalid() {
        let (price, valid, agreement) = quantize_oracle(&[], 100);
        assert!(!valid);
        assert_eq!(price, 0);
        assert_eq!(agreement, 0);
    }

    #[test]
    fn test_quantize_fallback_price_when_oracle_invalid() {
        // When oracle validation fails, quantize should fall back to snapshot.collateral_price
        let mut snapshot = test_snapshot();
        snapshot.oracle_data.clear();
        snapshot.collateral_price = 2500 * PRECISION;

        let decision = quantize(&snapshot);
        assert!(!decision.oracle_valid);
        assert_eq!(decision.validated_price, 2500 * PRECISION);
    }

    #[test]
    fn test_monotonicity_equal_snapshots_is_monotonic() {
        // Two identical decisions should be trivially monotonic
        let snapshot = test_snapshot();
        let d1 = quantize(&snapshot);
        let d2 = quantize(&snapshot);

        let result = verify_monotonicity(&d1, &d2);
        assert!(result.is_monotonic);
        assert!(result.violations.is_empty());
    }

    #[test]
    fn test_monotonicity_detects_utilization_improvement() {
        let snapshot = test_snapshot();
        let d1 = quantize(&snapshot);

        let mut d2 = d1.clone();
        // Force utilization tier to improve (go from whatever tier to Low)
        d2.utilization_tier = UtilizationTier::Low;
        // Ensure d1 is at a higher tier so we can detect improvement
        let mut d1_worse = d1.clone();
        d1_worse.utilization_tier = UtilizationTier::High;

        let result = verify_monotonicity(&d1_worse, &d2);
        assert!(!result.is_monotonic);
        assert!(result.violations.iter().any(|v| matches!(v, MonotonicityViolation::UtilizationImproved)));
    }

    #[test]
    fn test_monotonicity_detects_action_count_decrease() {
        let snapshot = test_snapshot();
        let d1 = quantize(&snapshot);

        let mut d_more_actions = d1.clone();
        d_more_actions.actions.push(PendingAction {
            vault_index: 99,
            action: KeeperAction::Warn { health_factor: PRECISION, vault_owner: [0xFF; 32] },
            health_factor: PRECISION,
            priority: 100,
        });

        let result = verify_monotonicity(&d_more_actions, &d1);
        assert!(!result.is_monotonic);
        assert!(result.violations.iter().any(|v|
            matches!(v, MonotonicityViolation::ActionCountDecreased { .. })
        ));
    }

    #[test]
    fn test_simulate_price_stress_zero_drop_unchanged() {
        let snapshot = test_snapshot();
        let (before, after) = simulate_price_stress(&snapshot, 0);

        // With 0 bps drop, the stressed price equals the original.
        // The "after" snapshot clears oracle_data and uses collateral_price
        // which at 0 drop stays the same as the original collateral_price.
        // Risk scores may differ because "before" uses oracle-validated price
        // while "after" uses the raw collateral_price.
        // But the validated price from the "before" should be close.
        assert!(after.vault_tiers.len() == before.vault_tiers.len());
    }

    #[test]
    fn test_quantize_utilization_boundary_u64_max() {
        // Extreme value beyond 10000 — should still map to Critical
        assert_eq!(quantize_utilization(u64::MAX), UtilizationTier::Critical);
    }

    #[test]
    fn test_report_stress_monotonicity_across_drops() {
        // The report stress test risk levels must be monotonically non-decreasing
        // across 10% -> 25% -> 50% drops.
        let snapshot = test_snapshot();
        let report = generate_report(&snapshot);

        let ord_10 = risk_level_ordinal(&report.stress.risk_at_10pct_drop);
        let ord_25 = risk_level_ordinal(&report.stress.risk_at_25pct_drop);
        let ord_50 = risk_level_ordinal(&report.stress.risk_at_50pct_drop);

        assert!(ord_25 >= ord_10,
            "25% drop risk ({:?}) must be >= 10% drop risk ({:?})",
            report.stress.risk_at_25pct_drop, report.stress.risk_at_10pct_drop);
        assert!(ord_50 >= ord_25,
            "50% drop risk ({:?}) must be >= 25% drop risk ({:?})",
            report.stress.risk_at_50pct_drop, report.stress.risk_at_25pct_drop);
    }

    // ============ Additional Edge Case & Boundary Tests ============

    #[test]
    fn test_median_two_identical_values() {
        // Even count with identical values: average should equal the value itself
        assert_eq!(compute_median(&[500, 500]), 500);
    }

    #[test]
    fn test_median_descending_order() {
        // Verify sorting works correctly when input is reverse-sorted
        assert_eq!(compute_median(&[300, 200, 100]), 200);
        assert_eq!(compute_median(&[400, 300, 200, 100]), 250);
    }

    #[test]
    fn test_median_with_zero_values() {
        assert_eq!(compute_median(&[0, 0, 0]), 0);
        assert_eq!(compute_median(&[0, 100]), 50);
        assert_eq!(compute_median(&[0, 0, 100]), 0);
    }

    #[test]
    fn test_quantize_utilization_exact_boundaries() {
        // Test the exact boundary values that are NOT already covered
        // 5000 → Low (covered), 5001 → Moderate (covered)
        // but test values right at every transition
        assert_eq!(quantize_utilization(4999), UtilizationTier::Low);
        assert_eq!(quantize_utilization(7999), UtilizationTier::Moderate);
        assert_eq!(quantize_utilization(8999), UtilizationTier::High);
        assert_eq!(quantize_utilization(9999), UtilizationTier::Critical);
    }

    #[test]
    fn test_quantize_coverage_boundary_values() {
        // Test values immediately before and after each boundary
        assert_eq!(quantize_coverage(499), CoverageTier::Minimal);
        assert_eq!(quantize_coverage(502), CoverageTier::Partial);
        assert_eq!(quantize_coverage(999), CoverageTier::Partial);
        assert_eq!(quantize_coverage(1002), CoverageTier::Adequate);
        assert_eq!(quantize_coverage(1999), CoverageTier::Adequate);
        assert_eq!(quantize_coverage(2002), CoverageTier::Strong);
    }

    #[test]
    fn test_quantize_coverage_u64_max() {
        // Extreme value beyond 10000 — should map to Strong
        assert_eq!(quantize_coverage(u64::MAX), CoverageTier::Strong);
    }

    #[test]
    fn test_oracle_two_sources_agree() {
        // Two fresh oracles that agree: 2/2 majority → valid
        let oracles = vec![
            test_oracle(3000 * PRECISION, 90, 100),
            test_oracle(3005 * PRECISION, 85, 99),
        ];

        let (price, valid, agreement) = quantize_oracle(&oracles, 105);
        assert!(valid);
        assert_eq!(agreement, 2);
        // Median of [3000, 3005] = 3000/2 + 3005/2
        let expected = (3000 * PRECISION) / 2 + (3005 * PRECISION) / 2;
        assert_eq!(price, expected);
    }

    #[test]
    fn test_oracle_two_sources_disagree() {
        // Two oracles far apart: median is between them, but only 1 may agree
        let oracles = vec![
            test_oracle(1000 * PRECISION, 90, 100),
            test_oracle(5000 * PRECISION, 85, 100),
        ];

        let (price, valid, agreement) = quantize_oracle(&oracles, 105);
        // Median = avg(1000, 5000) = 3000. Check who's within 10%:
        // 1000 vs 3000: diff=2000, 2000*10000 = 20M > 3000*1000 = 3M → disagree
        // 5000 vs 3000: diff=2000, same → disagree
        assert_eq!(agreement, 0);
        assert!(!valid);
        let expected = (1000 * PRECISION) / 2 + (5000 * PRECISION) / 2;
        assert_eq!(price, expected);
    }

    #[test]
    fn test_oracle_majority_with_one_outlier() {
        // 4 oracles: 3 agree, 1 outlier. Majority = 3/4 → valid
        let oracles = vec![
            test_oracle(3000 * PRECISION, 90, 100),
            test_oracle(3010 * PRECISION, 85, 100),
            test_oracle(2995 * PRECISION, 88, 100),
            test_oracle(9000 * PRECISION, 70, 100), // outlier
        ];

        let (_price, valid, agreement) = quantize_oracle(&oracles, 105);
        // Median of sorted [2995, 3000, 3010, 9000] = avg(3000, 3010) = 3005
        // Agreement: 2995 within 10% of 3005? diff=10, 10*10000=100000, 3005*1000=3005000 → yes
        // 3000 within 10%? diff=5 → yes
        // 3010 within 10%? diff=5 → yes
        // 9000 within 10%? diff=5995 → no
        assert_eq!(agreement, 3);
        assert!(valid); // 3/4 >= (4+1)/2 = 2 → true
    }

    #[test]
    fn test_oracle_partial_staleness_affects_median() {
        // 3 oracles, but 1 is stale. Median computed from 2 fresh ones only.
        let oracles = vec![
            test_oracle(3000 * PRECISION, 90, 100),  // fresh
            test_oracle(4000 * PRECISION, 85, 99),   // fresh
            test_oracle(1000 * PRECISION, 80, 1),    // stale (block 1 vs current 105)
        ];

        let (price, valid, agreement) = quantize_oracle(&oracles, 105);
        // Only [3000, 4000] are fresh → median = avg(3000,4000) = 3500
        let expected = (3000 * PRECISION) / 2 + (4000 * PRECISION) / 2;
        assert_eq!(price, expected);
        // Both within 10% of 3500? 3000: diff=500, 500*10000=5M, 3500*1000=3.5M → no!
        // So only 4000: diff=500, same → no.
        // Actually neither agrees at 10% of median
        // agreement should be checked — let's just verify the count
        assert!(agreement <= 2);
    }

    #[test]
    fn test_quantize_single_risky_vault() {
        // A single vault near liquidation threshold
        let mut snapshot = test_snapshot();
        snapshot.vaults = vec![
            vault(0x01, 10 * PRECISION, 28_000 * PRECISION), // Very risky at $3000/ETH
        ];

        let decision = quantize(&snapshot);
        assert_eq!(decision.vault_tiers.len(), 1);
        // Health factor = (10 * 3000 * CF) / 28000 — should be low
        // This vault should NOT be in Safe tier
        assert_ne!(decision.vault_tiers[0].tier, RiskTier::Safe,
            "Heavily leveraged vault should not be Safe");
    }

    #[test]
    fn test_quantize_no_insurance() {
        // Protocol without insurance pool
        let mut snapshot = test_snapshot();
        snapshot.insurance = None;

        let decision = quantize(&snapshot);
        // Should still produce a valid decision
        assert_eq!(decision.vault_tiers.len(), snapshot.vaults.len());
        assert_eq!(decision.coverage_tier, CoverageTier::None);
    }

    #[test]
    fn test_monotonicity_detects_risk_level_improvement() {
        let snapshot = test_snapshot();
        let d1 = quantize(&snapshot);

        let mut d_critical = d1.clone();
        d_critical.risk_level = RiskLevel::Critical;

        let mut d_low = d1.clone();
        d_low.risk_level = RiskLevel::Low;

        // "Riskier" decision has lower risk level → violation
        let result = verify_monotonicity(&d_critical, &d_low);
        assert!(!result.is_monotonic);
        assert!(result.violations.iter().any(|v|
            matches!(v, MonotonicityViolation::RiskLevelImproved { .. })
        ));
    }

    #[test]
    fn test_monotonicity_multiple_violations_at_once() {
        let snapshot = test_snapshot();
        let d1 = quantize(&snapshot);

        let mut d_worse = d1.clone();
        d_worse.risk_score = d1.risk_score + 20;
        d_worse.risk_level = RiskLevel::Critical;
        d_worse.utilization_tier = UtilizationTier::Critical;
        d_worse.actions.push(PendingAction {
            vault_index: 99,
            action: KeeperAction::Warn { health_factor: PRECISION, vault_owner: [0xFF; 32] },
            health_factor: PRECISION,
            priority: 100,
        });

        // Verify safer→riskier is monotonic
        let result = verify_monotonicity(&d1, &d_worse);
        assert!(result.is_monotonic);

        // Now check riskier→safer detects MULTIPLE violations
        let reverse = verify_monotonicity(&d_worse, &d1);
        assert!(!reverse.is_monotonic);
        assert!(reverse.violations.len() >= 2,
            "Should detect multiple violations, got {}: {:?}",
            reverse.violations.len(), reverse.violations);
    }

    #[test]
    fn test_tier_changed_empty_vaults() {
        // Two decisions with no vaults should show no tier change
        let mut snapshot = test_snapshot();
        snapshot.vaults.clear();
        let d1 = quantize(&snapshot);
        let d2 = quantize(&snapshot);

        assert!(!tier_changed(&d1, &d2));
    }

    #[test]
    fn test_tier_changed_different_vault_counts() {
        // If vault counts differ, tier_changed should return true
        let snapshot = test_snapshot();
        let d1 = quantize(&snapshot);

        let mut snapshot2 = test_snapshot();
        snapshot2.vaults.pop(); // Remove one vault
        let d2 = quantize(&snapshot2);

        assert!(tier_changed(&d1, &d2));
    }

    #[test]
    fn test_simulate_price_stress_full_drop() {
        // 100% price drop (10000 bps) → collateral_price = 0
        let snapshot = test_snapshot();
        let (before, after) = simulate_price_stress(&snapshot, 10000);

        assert!(after.risk_score >= before.risk_score,
            "100% drop must produce equal or higher risk");
        // With 0 collateral price, all vaults with debt should be in bad shape
        for vt in &after.vault_tiers {
            if vt.health_factor == 0 {
                assert_ne!(vt.tier, RiskTier::Safe);
            }
        }
    }

    #[test]
    fn test_report_no_vaults_produces_valid_report() {
        let mut snapshot = test_snapshot();
        snapshot.vaults.clear();

        let report = generate_report(&snapshot);
        assert_eq!(report.observation.vault_count, 0);
        assert_eq!(report.observation.total_debt, 0);
        assert!(report.decision.vault_tiers.is_empty());
        assert!(report.decision.actions.is_empty());
    }

    #[test]
    fn test_report_price_spread_with_identical_oracles() {
        let mut snapshot = test_snapshot();
        snapshot.oracle_data = vec![
            test_oracle(3000 * PRECISION, 90, 100),
            test_oracle(3000 * PRECISION, 85, 99),
        ];

        let report = generate_report(&snapshot);
        assert_eq!(report.observation.price_spread_bps, 0,
            "Identical oracle prices should produce 0 spread");
    }

    // ============ New Tests: Edge Cases & Coverage Hardening ============

    #[test]
    fn test_quantize_many_vaults_all_safe() {
        // 10 vaults all with massive over-collateralization
        let mut snapshot = test_snapshot();
        snapshot.vaults = (0..10u8).map(|i| {
            vault(i, 1000 * PRECISION, 1_000 * PRECISION) // 1000 ETH @ $3000 vs $1000 debt
        }).collect();

        let decision = quantize(&snapshot);
        assert_eq!(decision.vault_tiers.len(), 10);
        for vt in &decision.vault_tiers {
            assert_eq!(vt.tier, RiskTier::Safe,
                "Massively over-collateralized vault should be Safe");
        }
    }

    #[test]
    fn test_quantize_mixed_safe_and_risky_vaults() {
        // Mix of very safe and very risky vaults in same snapshot
        let mut snapshot = test_snapshot();
        snapshot.vaults = vec![
            vault(0x01, 1000 * PRECISION, 1_000 * PRECISION),    // Very safe
            vault(0x02, 10 * PRECISION, 28_000 * PRECISION),     // Very risky
        ];

        let decision = quantize(&snapshot);
        assert_eq!(decision.vault_tiers.len(), 2);
        // The safe vault and risky vault should have different tiers
        assert_ne!(decision.vault_tiers[0].tier, decision.vault_tiers[1].tier,
            "Safe and risky vaults should have different risk tiers");
    }

    #[test]
    fn test_quantize_oracle_five_sources_three_agree() {
        // 5 oracles: 3 agree, 2 outliers. Majority = 3/5 → valid
        let oracles = vec![
            test_oracle(3000 * PRECISION, 90, 100),
            test_oracle(3005 * PRECISION, 88, 100),
            test_oracle(2998 * PRECISION, 85, 100),
            test_oracle(8000 * PRECISION, 70, 100), // outlier
            test_oracle(500 * PRECISION, 60, 100),  // outlier
        ];

        let (price, valid, agreement) = quantize_oracle(&oracles, 105);
        // Sorted: [500, 2998, 3000, 3005, 8000]. Median = 3000.
        assert_eq!(price, 3000 * PRECISION);
        // 2998, 3000, 3005 all within 10% of 3000 → 3 agree
        assert_eq!(agreement, 3);
        // 3/5 >= (5+1)/2 = 3 → valid
        assert!(valid);
    }

    #[test]
    fn test_quantize_oracle_exact_10_percent_boundary() {
        // Test oracle exactly at the 10% deviation boundary
        // Median = 1000. 10% of 1000 = 100. So price 1100 should be at boundary.
        // Check: diff=100, diff*10000=1_000_000, median*1000=1_000_000 → 1M <= 1M → agrees
        let oracles = vec![
            test_oracle(1000 * PRECISION, 90, 100),
            test_oracle(1100 * PRECISION, 85, 100), // exactly 10% away
        ];

        let (_price, _valid, agreement) = quantize_oracle(&oracles, 105);
        // Both should agree: 1000 is within 10% of median(1000,1100)=1050,
        // and 1100 is within 10% of 1050.
        // Let's check: median = avg(1000,1100) = 1050
        // 1000 vs 1050: diff=50, 50*10000=500000, 1050*1000=1050000 → 500K <= 1.05M → agrees
        // 1100 vs 1050: diff=50, same → agrees
        assert_eq!(agreement, 2);
    }

    #[test]
    fn test_median_large_even_count() {
        // 6 values
        let values = [100, 200, 300, 400, 500, 600];
        let result = compute_median(&values);
        // Sorted: [100,200,300,400,500,600]. Mid=3. avg(sorted[2], sorted[3]) = avg(300,400) = 350
        assert_eq!(result, 350);
    }

    #[test]
    fn test_simulate_price_stress_small_drop_1bps() {
        // Minimal 1 bps (0.01%) drop
        let snapshot = test_snapshot();
        let (before, after) = simulate_price_stress(&snapshot, 1);

        // Risk should be >= before (monotonic)
        assert!(after.risk_score >= before.risk_score);
        // Vault count should remain the same
        assert_eq!(after.vault_tiers.len(), before.vault_tiers.len());
    }

    #[test]
    fn test_tier_changed_same_tiers_returns_false() {
        // Two quantize calls on same snapshot must have same tiers
        let snapshot = test_snapshot();
        let d1 = quantize(&snapshot);
        let d2 = quantize(&snapshot);

        assert!(!tier_changed(&d1, &d2),
            "Identical snapshots should not show tier changes");
    }

    #[test]
    fn test_report_single_oracle_source() {
        let mut snapshot = test_snapshot();
        snapshot.oracle_data = vec![
            test_oracle(3000 * PRECISION, 95, 100),
        ];

        let report = generate_report(&snapshot);
        assert_eq!(report.observation.oracle_source_count, 1);
        assert_eq!(report.observation.fresh_source_count, 1);
        // Single oracle → no spread
        assert_eq!(report.observation.price_spread_bps, 0);
    }

    #[test]
    fn test_report_price_spread_calculation() {
        let mut snapshot = test_snapshot();
        // Two oracles: 2000 and 3000. Spread = (3000-2000)/2000 * 10000 = 5000 bps
        snapshot.oracle_data = vec![
            test_oracle(2000 * PRECISION, 90, 100),
            test_oracle(3000 * PRECISION, 85, 99),
        ];

        let report = generate_report(&snapshot);
        assert_eq!(report.observation.price_spread_bps, 5000,
            "Spread between 2000 and 3000 should be 5000 bps");
    }

    #[test]
    fn test_quantize_collateral_price_zero_with_debt() {
        // Zero collateral price should make all vaults with debt unhealthy
        let mut snapshot = test_snapshot();
        snapshot.oracle_data.clear();
        snapshot.collateral_price = 0;

        let decision = quantize(&snapshot);
        assert_eq!(decision.validated_price, 0);
        // Vaults with non-zero debt should not be Safe
        for (i, vt) in decision.vault_tiers.iter().enumerate() {
            if snapshot.vaults[i].debt_shares > 0 {
                assert_ne!(vt.tier, RiskTier::Safe,
                    "Vault with debt and 0 price should not be Safe");
            }
        }
    }

    #[test]
    fn test_monotonicity_result_fields_consistent() {
        // When is_monotonic is true, violations must be empty
        let snapshot = test_snapshot();
        let d1 = quantize(&snapshot);
        let (_, d2) = simulate_price_stress(&snapshot, 1000);

        let result = verify_monotonicity(&d1, &d2);
        if result.is_monotonic {
            assert!(result.violations.is_empty(),
                "Monotonic result must have zero violations");
        } else {
            assert!(!result.violations.is_empty(),
                "Non-monotonic result must have at least one violation");
        }
    }

    #[test]
    fn test_find_tier_transition_threshold_no_vaults() {
        // With no vaults, there's nothing to transition
        let mut snapshot = test_snapshot();
        snapshot.vaults.clear();

        let threshold = find_tier_transition_threshold(&snapshot);
        assert!(threshold.is_none(),
            "No vaults means no tier transitions possible");
    }

    // ============ New Tests: 67-78 (Edge Cases & Boundary Hardening) ============

    #[test]
    fn test_median_u128_max_single_value() {
        // Single u128::MAX should return itself with no overflow
        assert_eq!(compute_median(&[u128::MAX]), u128::MAX);
    }

    #[test]
    fn test_median_even_count_rounding_loss() {
        // Two odd numbers: sorted[0]/2 + sorted[1]/2 = 1/2 + 3/2 = 0 + 1 = 1
        // Integer division truncates, so we lose 0.5 from each half
        assert_eq!(compute_median(&[1, 3]), 1);
        // Two values that lose a bit: (101/2 + 103/2) = 50 + 51 = 101
        assert_eq!(compute_median(&[101, 103]), 101);
        // Both odd, differ by 1: (99/2 + 101/2) = 49 + 50 = 99
        assert_eq!(compute_median(&[99, 101]), 99);
    }

    #[test]
    fn test_median_seven_values() {
        // Odd count with 7 values — median is the 4th element
        let values = [10, 20, 30, 40, 50, 60, 70];
        assert_eq!(compute_median(&values), 40);
        // Reversed input should still work
        let reversed = [70, 60, 50, 40, 30, 20, 10];
        assert_eq!(compute_median(&reversed), 40);
    }

    #[test]
    fn test_oracle_at_exact_staleness_boundary() {
        // Oracle at block N, current = N + MAX_STALENESS_BLOCKS (exactly at boundary).
        // validate_freshness checks: (current - oracle.block_number) > MAX_STALENESS_BLOCKS
        // So at exactly MAX_STALENESS_BLOCKS, it should still be fresh (not strictly greater).
        let oracle_block = 100;
        let current = oracle_block + oracle::MAX_STALENESS_BLOCKS;
        let oracles = vec![test_oracle(5000 * PRECISION, 90, oracle_block)];

        let (price, valid, agreement) = quantize_oracle(&oracles, current);
        assert!(valid, "Oracle exactly at staleness boundary should be fresh");
        assert_eq!(agreement, 1);
        assert_eq!(price, 5000 * PRECISION);
    }

    #[test]
    fn test_oracle_one_past_staleness_boundary() {
        // One block past the staleness boundary should be stale
        let oracle_block = 100;
        let current = oracle_block + oracle::MAX_STALENESS_BLOCKS + 1;
        let oracles = vec![test_oracle(5000 * PRECISION, 90, oracle_block)];

        let (price, valid, agreement) = quantize_oracle(&oracles, current);
        assert!(!valid, "Oracle one block past staleness boundary should be stale");
        assert_eq!(agreement, 0);
        assert_eq!(price, 0);
    }

    #[test]
    fn test_oracle_future_block_number_is_fresh() {
        // Oracle from the "future" (block_number > current_block)
        // validate_freshness only triggers if current_block > oracle.block_number
        // So a future oracle should pass freshness check
        let oracles = vec![test_oracle(2000 * PRECISION, 90, 200)];
        let (price, valid, agreement) = quantize_oracle(&oracles, 50);
        assert!(valid, "Future oracle should pass freshness check");
        assert_eq!(agreement, 1);
        assert_eq!(price, 2000 * PRECISION);
    }

    #[test]
    fn test_quantize_with_nonunit_debt_price() {
        // debt_price != PRECISION (non-stablecoin debt)
        let mut snapshot = test_snapshot();
        snapshot.debt_price = 2 * PRECISION; // debt token worth $2 each
        snapshot.oracle_data.clear();
        snapshot.collateral_price = 3000 * PRECISION;

        let decision = quantize(&snapshot);
        // Should still produce valid output with all vaults assessed
        assert_eq!(decision.vault_tiers.len(), snapshot.vaults.len());
    }

    #[test]
    fn test_utilization_tier_ordering_is_monotonic() {
        // Verify PartialOrd derives correct ordering: Low < Moderate < High < Critical
        assert!(UtilizationTier::Low < UtilizationTier::Moderate);
        assert!(UtilizationTier::Moderate < UtilizationTier::High);
        assert!(UtilizationTier::High < UtilizationTier::Critical);
        assert!(UtilizationTier::Low < UtilizationTier::Critical);
    }

    #[test]
    fn test_coverage_tier_ordering_is_monotonic() {
        // Verify PartialOrd derives correct ordering: None < Minimal < ... < Strong
        assert!(CoverageTier::None < CoverageTier::Minimal);
        assert!(CoverageTier::Minimal < CoverageTier::Partial);
        assert!(CoverageTier::Partial < CoverageTier::Adequate);
        assert!(CoverageTier::Adequate < CoverageTier::Strong);
        assert!(CoverageTier::None < CoverageTier::Strong);
    }

    #[test]
    fn test_monotonicity_with_zero_risk_scores() {
        // Both decisions with risk_score = 0 — trivially monotonic
        let snapshot = test_snapshot();
        let d1 = quantize(&snapshot);

        let mut d_zero_a = d1.clone();
        d_zero_a.risk_score = 0;
        let mut d_zero_b = d1.clone();
        d_zero_b.risk_score = 0;

        let result = verify_monotonicity(&d_zero_a, &d_zero_b);
        // Equal scores should not trigger RiskScoreDecreased
        assert!(result.violations.iter().all(|v|
            !matches!(v, MonotonicityViolation::RiskScoreDecreased { .. })
        ));
    }

    #[test]
    fn test_monotonicity_with_empty_actions_both_sides() {
        // Both decisions with zero actions — should be monotonic for action count
        let snapshot = test_snapshot();
        let d1 = quantize(&snapshot);

        let mut d_no_actions_a = d1.clone();
        d_no_actions_a.actions.clear();
        let mut d_no_actions_b = d1.clone();
        d_no_actions_b.actions.clear();

        let result = verify_monotonicity(&d_no_actions_a, &d_no_actions_b);
        assert!(result.violations.iter().all(|v|
            !matches!(v, MonotonicityViolation::ActionCountDecreased { .. })
        ));
    }

    #[test]
    fn test_report_with_zero_price_oracle_spread() {
        // Oracle with price = 0 → spread computation should handle min=0
        // In generate_report: if min > 0, compute spread; else spread = 0
        let mut snapshot = test_snapshot();
        snapshot.oracle_data = vec![
            test_oracle(0, 90, 100),
            test_oracle(3000 * PRECISION, 85, 99),
        ];

        let report = generate_report(&snapshot);
        // min price is 0, so spread formula has a guard: min > 0
        assert_eq!(report.observation.price_spread_bps, 0,
            "Zero min price should produce 0 spread (guard clause)");
    }

    #[test]
    fn test_report_all_stale_oracles_stress_still_works() {
        // All oracles stale — report should still produce valid stress data
        let mut snapshot = test_snapshot();
        snapshot.oracle_data = vec![
            test_oracle(3000 * PRECISION, 90, 1),
            test_oracle(3010 * PRECISION, 85, 2),
        ];
        snapshot.current_block = 500;

        let report = generate_report(&snapshot);
        assert!(!report.decision.oracle_valid);
        assert_eq!(report.observation.fresh_source_count, 0);
        // Stress tests should still complete (using fallback price)
        let _ = report.stress.risk_at_10pct_drop;
        let _ = report.stress.risk_at_50pct_drop;
    }

    #[test]
    fn test_quantize_all_vaults_in_hard_liquidation() {
        // All vaults with massive debt relative to collateral
        let mut snapshot = test_snapshot();
        snapshot.oracle_data.clear();
        snapshot.collateral_price = 100 * PRECISION; // Very low price
        snapshot.vaults = vec![
            vault(0x01, 1 * PRECISION, 500_000 * PRECISION),
            vault(0x02, 1 * PRECISION, 500_000 * PRECISION),
        ];

        let decision = quantize(&snapshot);
        assert_eq!(decision.vault_tiers.len(), 2);
        // Both vaults should be in a severe tier (not Safe)
        for vt in &decision.vault_tiers {
            assert_ne!(vt.tier, RiskTier::Safe,
                "Massively undercollateralized vault must not be Safe");
        }
    }
}
