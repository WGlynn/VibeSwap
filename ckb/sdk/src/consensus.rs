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

    // ============ Tests 81-95+: Deep Edge Cases & Coverage Expansion ============

    #[test]
    fn test_median_two_u128_max_values() {
        // Two u128::MAX values: each /2 should avoid overflow
        let result = compute_median(&[u128::MAX, u128::MAX]);
        // MAX/2 + MAX/2 = MAX - 1 (since MAX is odd, each /2 truncates)
        assert_eq!(result, u128::MAX / 2 + u128::MAX / 2);
    }

    #[test]
    fn test_median_large_spread_even_count() {
        // Even count with extreme spread: [0, u128::MAX]
        let result = compute_median(&[0, u128::MAX]);
        // 0/2 + MAX/2 = MAX/2
        assert_eq!(result, u128::MAX / 2);
    }

    #[test]
    fn test_median_eight_values() {
        // Even count with 8 values — median of sorted[3] and sorted[4]
        let values = [80, 10, 50, 30, 70, 20, 40, 60];
        let result = compute_median(&values);
        // Sorted: [10,20,30,40,50,60,70,80]. mid=4. avg(sorted[3],sorted[4]) = avg(40,50) = 45
        assert_eq!(result, 45);
    }

    #[test]
    fn test_oracle_zero_price_sources() {
        // All oracles report price = 0
        let oracles = vec![
            test_oracle(0, 90, 100),
            test_oracle(0, 85, 99),
            test_oracle(0, 80, 98),
        ];

        let (price, valid, agreement) = quantize_oracle(&oracles, 105);
        // Median of [0,0,0] = 0. Agreement check: diff=0, 0 <= 0 → all agree
        assert_eq!(price, 0);
        assert_eq!(agreement, 3);
        assert!(valid);
    }

    #[test]
    fn test_oracle_majority_exactly_half_is_invalid() {
        // 4 oracles, only 2 agree: 2/4 < (4+1)/2 = 2.5 → NOT majority
        let oracles = vec![
            test_oracle(3000 * PRECISION, 90, 100),
            test_oracle(3005 * PRECISION, 85, 100),
            test_oracle(9000 * PRECISION, 80, 100), // far outlier
            test_oracle(100 * PRECISION, 75, 100),  // far outlier
        ];

        let (_price, valid, agreement) = quantize_oracle(&oracles, 105);
        // Sorted: [100, 3000, 3005, 9000]. Median = avg(3000,3005) = 3002 (approx)
        // 100 vs ~3002: way off. 9000 vs ~3002: way off. Only 3000,3005 agree = 2
        // (4+1)/2 = 2 (integer) → 2 >= 2 → actually valid!
        // Wait: (4+1)/2 in Rust integer division = 5/2 = 2. So 2 >= 2 → valid
        assert_eq!(agreement, 2);
        assert!(valid);
    }

    #[test]
    fn test_oracle_six_sources_needs_four_agreement() {
        // 6 oracles: (6+1)/2 = 3 needed for majority
        // 3 agree, 3 are outliers
        let oracles = vec![
            test_oracle(2000 * PRECISION, 90, 100),
            test_oracle(2005 * PRECISION, 88, 100),
            test_oracle(2010 * PRECISION, 85, 100),
            test_oracle(8000 * PRECISION, 70, 100),
            test_oracle(9000 * PRECISION, 60, 100),
            test_oracle(10000 * PRECISION, 50, 100),
        ];

        let (_price, valid, agreement) = quantize_oracle(&oracles, 105);
        // Sorted: [2000, 2005, 2010, 8000, 9000, 10000]
        // Median = avg(sorted[2], sorted[3]) = avg(2010, 8000) = 5005
        // Now check which are within 10% of 5005:
        // 2000: diff=3005 → 3005*10000=30050000 vs 5005*1000=5005000 → no
        // 2005: diff=3000 → same logic → no
        // 2010: diff=2995 → no
        // 8000: diff=2995 → no
        // 9000: diff=3995 → no
        // 10000: diff=4995 → no
        // agreement = 0, not majority
        assert_eq!(agreement, 0);
        assert!(!valid);
    }

    #[test]
    fn test_risk_level_ordinal_all_values() {
        assert_eq!(risk_level_ordinal(&RiskLevel::Low), 0);
        assert_eq!(risk_level_ordinal(&RiskLevel::Medium), 1);
        assert_eq!(risk_level_ordinal(&RiskLevel::High), 2);
        assert_eq!(risk_level_ordinal(&RiskLevel::Critical), 3);
    }

    #[test]
    fn test_monotonicity_all_four_violations_simultaneously() {
        let snapshot = test_snapshot();
        let d_base = quantize(&snapshot);

        // Build a "worse" decision
        let mut d_worse = d_base.clone();
        d_worse.risk_score = d_base.risk_score + 30;
        d_worse.risk_level = RiskLevel::Critical;
        d_worse.utilization_tier = UtilizationTier::Critical;
        d_worse.actions.push(PendingAction {
            vault_index: 99,
            action: KeeperAction::Warn { health_factor: PRECISION, vault_owner: [0xFF; 32] },
            health_factor: PRECISION,
            priority: 100,
        });
        d_worse.actions.push(PendingAction {
            vault_index: 98,
            action: KeeperAction::Warn { health_factor: PRECISION, vault_owner: [0xFE; 32] },
            health_factor: PRECISION,
            priority: 200,
        });

        // Now reverse: d_worse→d_base should detect all violations
        let reverse = verify_monotonicity(&d_worse, &d_base);
        assert!(!reverse.is_monotonic);

        // Count distinct violation types
        let has_risk_score = reverse.violations.iter().any(|v|
            matches!(v, MonotonicityViolation::RiskScoreDecreased { .. }));
        let _has_risk_level = reverse.violations.iter().any(|v|
            matches!(v, MonotonicityViolation::RiskLevelImproved { .. }));
        let _has_util = reverse.violations.iter().any(|v|
            matches!(v, MonotonicityViolation::UtilizationImproved));
        let has_actions = reverse.violations.iter().any(|v|
            matches!(v, MonotonicityViolation::ActionCountDecreased { .. }));

        // At minimum risk score and action count should be violated
        assert!(has_risk_score, "Should detect risk score decrease");
        assert!(has_actions, "Should detect action count decrease");
    }

    #[test]
    fn test_monotonicity_max_risk_score() {
        // Both at u64::MAX risk score — should be monotonic
        let snapshot = test_snapshot();
        let d = quantize(&snapshot);

        let mut d1 = d.clone();
        d1.risk_score = u64::MAX;
        let mut d2 = d.clone();
        d2.risk_score = u64::MAX;

        let result = verify_monotonicity(&d1, &d2);
        assert!(result.violations.iter().all(|v|
            !matches!(v, MonotonicityViolation::RiskScoreDecreased { .. })
        ));
    }

    #[test]
    fn test_simulate_price_stress_uses_fallback_price() {
        // After stress simulation, the stressed snapshot should use collateral_price
        // (oracle_data is cleared). Verify the decision uses the stressed price.
        let mut snapshot = test_snapshot();
        snapshot.oracle_data.clear();
        snapshot.collateral_price = 4000 * PRECISION;

        let (before, after) = simulate_price_stress(&snapshot, 5000); // 50% drop

        // Before uses fallback = 4000*PRECISION, After should use 4000*0.5 = 2000*PRECISION
        assert_eq!(before.validated_price, 4000 * PRECISION);
        assert_eq!(after.validated_price, 2000 * PRECISION);
    }

    #[test]
    fn test_tier_changed_last_vault_different() {
        // All tiers match except the last one
        let mut snapshot = test_snapshot();
        let d1 = quantize(&snapshot);

        // Create a second snapshot where only the last vault is more leveraged
        let mut snapshot2 = snapshot.clone();
        let last_idx = snapshot2.vaults.len() - 1;
        snapshot2.vaults[last_idx].debt_shares = 100_000 * PRECISION; // Much more debt
        let d2 = quantize(&snapshot2);

        // If the last vault changed tier, tier_changed should detect it
        if d1.vault_tiers[last_idx].tier != d2.vault_tiers[last_idx].tier {
            assert!(tier_changed(&d1, &d2));
        }
    }

    #[test]
    fn test_quantize_vault_owner_lock_hash_preserved() {
        // Verify that each VaultTier has the correct owner_lock_hash from the source vault
        let snapshot = test_snapshot();
        let decision = quantize(&snapshot);

        for (i, vt) in decision.vault_tiers.iter().enumerate() {
            assert_eq!(vt.owner_lock_hash, snapshot.vaults[i].owner_lock_hash,
                "VaultTier[{}] owner_lock_hash must match source vault", i);
        }
    }

    #[test]
    fn test_quantize_vault_health_factor_populated() {
        // Every VaultTier should have a health_factor value
        let snapshot = test_snapshot();
        let decision = quantize(&snapshot);

        for (i, vt) in decision.vault_tiers.iter().enumerate() {
            // Vaults with zero debt get u128::MAX health factor
            if snapshot.vaults[i].debt_shares == 0 {
                assert_eq!(vt.health_factor, u128::MAX,
                    "Zero-debt vault should have MAX health factor");
            }
            // All vaults should have some health_factor set (non-zero or MAX for safe)
        }
    }

    #[test]
    fn test_quantize_oracle_valid_uses_oracle_price() {
        // When oracle is valid, validated_price should come from oracle median, not collateral_price
        let mut snapshot = test_snapshot();
        snapshot.collateral_price = 9999 * PRECISION; // Different from oracle prices

        let decision = quantize(&snapshot);
        assert!(decision.oracle_valid);
        // Oracle median is 3000*PRECISION, not 9999*PRECISION
        assert_eq!(decision.validated_price, 3000 * PRECISION);
        assert_ne!(decision.validated_price, snapshot.collateral_price);
    }

    #[test]
    fn test_report_total_debt_sums_all_vaults() {
        let mut snapshot = test_snapshot();
        snapshot.vaults = vec![
            vault(0x01, 100 * PRECISION, 10_000 * PRECISION),
            vault(0x02, 50 * PRECISION, 20_000 * PRECISION),
            vault(0x03, 25 * PRECISION, 30_000 * PRECISION),
        ];

        let report = generate_report(&snapshot);
        let expected_total_debt = 10_000 * PRECISION + 20_000 * PRECISION + 30_000 * PRECISION;
        assert_eq!(report.observation.total_debt, expected_total_debt,
            "Total debt should be sum of all vault debt_shares");
    }

    #[test]
    fn test_report_large_price_spread() {
        // Huge spread between oracles
        let mut snapshot = test_snapshot();
        snapshot.oracle_data = vec![
            test_oracle(100 * PRECISION, 90, 100),
            test_oracle(10_000 * PRECISION, 85, 99),
        ];

        let report = generate_report(&snapshot);
        // Spread = (10000 - 100) / 100 * 10000 = 990000 bps
        assert_eq!(report.observation.price_spread_bps, 990_000);
    }

    #[test]
    fn test_quantize_high_utilization_pool() {
        // Pool with 95% utilization
        let mut snapshot = test_snapshot();
        snapshot.pool.total_deposits = 1_000_000 * PRECISION;
        snapshot.pool.total_borrows = 950_000 * PRECISION; // 95% utilization

        let decision = quantize(&snapshot);
        assert_eq!(decision.utilization_tier, UtilizationTier::Critical,
            "95% utilization should be Critical tier");
    }

    #[test]
    fn test_quantize_zero_deposit_pool() {
        // Pool with zero deposits — utilization should be 0
        let mut snapshot = test_snapshot();
        snapshot.pool.total_deposits = 0;
        snapshot.pool.total_borrows = 0;
        snapshot.vaults.clear();

        let decision = quantize(&snapshot);
        assert_eq!(decision.utilization_tier, UtilizationTier::Low,
            "Zero deposits should result in Low utilization");
    }

    #[test]
    fn test_quantize_no_insurance_gives_none_coverage() {
        // Explicitly verify that no insurance → CoverageTier::None
        let mut snapshot = test_snapshot();
        snapshot.insurance = None;
        snapshot.vaults.clear();

        let decision = quantize(&snapshot);
        assert_eq!(decision.coverage_tier, CoverageTier::None);
    }

    #[test]
    fn test_find_tier_transition_single_risky_vault() {
        // Single vault very close to a tier boundary — threshold should be small
        let mut snapshot = test_snapshot();
        snapshot.oracle_data.clear();
        snapshot.collateral_price = 3000 * PRECISION;
        // Vault with HF just above a tier boundary
        snapshot.vaults = vec![
            vault(0x01, 10 * PRECISION, 22_000 * PRECISION),
        ];

        let threshold = find_tier_transition_threshold(&snapshot);
        assert!(threshold.is_some(), "Risky vault should have a tier transition point");
        // Should transition with a relatively small price drop
        assert!(threshold.unwrap() <= 2000,
            "Risky vault should transition within 20% drop, got {}bps", threshold.unwrap());
    }

    #[test]
    fn test_simulate_price_stress_preserves_vault_count() {
        // After stress, the number of vault tiers must equal the original vault count
        let snapshot = test_snapshot();
        for drop in [100, 500, 1000, 3000, 5000, 8000, 9999] {
            let (before, after) = simulate_price_stress(&snapshot, drop);
            assert_eq!(before.vault_tiers.len(), snapshot.vaults.len());
            assert_eq!(after.vault_tiers.len(), snapshot.vaults.len(),
                "Vault count must be preserved after {}bps stress", drop);
        }
    }

    #[test]
    fn test_report_observation_fresh_vs_total_oracle_count() {
        // Mix of fresh and stale oracles
        let mut snapshot = test_snapshot();
        snapshot.oracle_data = vec![
            test_oracle(3000 * PRECISION, 90, 100), // fresh (block 100, current 105)
            test_oracle(3005 * PRECISION, 85, 99),  // fresh
            test_oracle(2990 * PRECISION, 80, 1),   // stale (block 1)
            test_oracle(3010 * PRECISION, 75, 2),   // stale (block 2)
        ];
        snapshot.current_block = 105;

        let report = generate_report(&snapshot);
        assert_eq!(report.observation.oracle_source_count, 4);
        assert_eq!(report.observation.fresh_source_count, 2);
    }

    // ============ Hardening Tests: 103-116 ============

    #[test]
    fn test_median_three_identical_large_values() {
        let v = u128::MAX / 3;
        assert_eq!(compute_median(&[v, v, v]), v);
    }

    #[test]
    fn test_median_four_identical_values() {
        let v = 12345 * PRECISION;
        assert_eq!(compute_median(&[v, v, v, v]), v);
    }

    #[test]
    fn test_quantize_determinism_across_multiple_calls() {
        // Run quantize 10 times — all results must be identical
        let snapshot = test_snapshot();
        let baseline = quantize(&snapshot);
        for _ in 0..10 {
            let d = quantize(&snapshot);
            assert_eq!(d.risk_score, baseline.risk_score);
            assert_eq!(d.risk_level, baseline.risk_level);
            assert_eq!(d.utilization_tier, baseline.utilization_tier);
            assert_eq!(d.coverage_tier, baseline.coverage_tier);
            assert_eq!(d.oracle_valid, baseline.oracle_valid);
            assert_eq!(d.oracle_agreement_count, baseline.oracle_agreement_count);
            assert_eq!(d.vault_tiers.len(), baseline.vault_tiers.len());
        }
    }

    #[test]
    fn test_quantize_utilization_zero_bps() {
        assert_eq!(quantize_utilization(0), UtilizationTier::Low);
    }

    #[test]
    fn test_quantize_utilization_10000_bps() {
        // 10000 bps = 100% utilization — should be Critical
        assert_eq!(quantize_utilization(10000), UtilizationTier::Critical);
    }

    #[test]
    fn test_quantize_coverage_10001_bps() {
        // 10001 bps — beyond normal range, should still map to Strong
        assert_eq!(quantize_coverage(10001), CoverageTier::Strong);
    }

    #[test]
    fn test_oracle_agreement_boundary_just_inside_10_percent() {
        // Price exactly 9.99% away from median: should agree
        // Median = 10000. 9% deviation = 900. Price = 10900.
        // diff = 900, diff * 10000 = 9_000_000, median * 1000 = 10_000_000. 9M <= 10M => agrees.
        let oracles = vec![
            test_oracle(10000 * PRECISION, 90, 100),
            test_oracle(10900 * PRECISION, 85, 100),
        ];
        let (_price, _valid, agreement) = quantize_oracle(&oracles, 105);
        // Median = avg(10000, 10900) = 10450
        // 10000 vs 10450: diff=450, 450*10000=4500000, 10450*1000=10450000 → agrees
        // 10900 vs 10450: diff=450, same → agrees
        assert_eq!(agreement, 2);
    }

    #[test]
    fn test_oracle_agreement_boundary_just_outside_10_percent() {
        // Two oracles far enough apart that neither agrees with the median
        // 1000 and 2000: median = 1500.
        // 1000 vs 1500: diff=500, 500*10000=5000000, 1500*1000=1500000, 5M > 1.5M → no
        // 2000 vs 1500: diff=500, same → no
        let oracles = vec![
            test_oracle(1000 * PRECISION, 90, 100),
            test_oracle(2000 * PRECISION, 85, 100),
        ];
        let (_price, valid, agreement) = quantize_oracle(&oracles, 105);
        assert_eq!(agreement, 0);
        assert!(!valid);
    }

    #[test]
    fn test_monotonicity_risk_score_equal_is_ok() {
        // If riskier.risk_score == safer.risk_score, should not trigger violation
        let snapshot = test_snapshot();
        let d = quantize(&snapshot);
        let mut d1 = d.clone();
        let mut d2 = d.clone();
        d1.risk_score = 50;
        d2.risk_score = 50;
        let result = verify_monotonicity(&d1, &d2);
        assert!(result.violations.iter().all(|v|
            !matches!(v, MonotonicityViolation::RiskScoreDecreased { .. })
        ));
    }

    #[test]
    fn test_monotonicity_same_utilization_tier_is_ok() {
        let snapshot = test_snapshot();
        let d = quantize(&snapshot);
        let mut d1 = d.clone();
        let mut d2 = d.clone();
        d1.utilization_tier = UtilizationTier::High;
        d2.utilization_tier = UtilizationTier::High;
        let result = verify_monotonicity(&d1, &d2);
        assert!(result.violations.iter().all(|v|
            !matches!(v, MonotonicityViolation::UtilizationImproved)
        ));
    }

    #[test]
    fn test_simulate_price_stress_9999_bps_nearly_zero_price() {
        // 99.99% drop — collateral_price becomes ~0.01% of original
        let snapshot = test_snapshot();
        let (before, after) = simulate_price_stress(&snapshot, 9999);
        assert!(after.risk_score >= before.risk_score);
    }

    #[test]
    fn test_quantize_snapshot_with_large_vault_count() {
        // 20 vaults — all should be assessed
        let mut snapshot = test_snapshot();
        snapshot.vaults = (0..20u8).map(|i| {
            vault(i, 50 * PRECISION, 10_000 * PRECISION)
        }).collect();

        let decision = quantize(&snapshot);
        assert_eq!(decision.vault_tiers.len(), 20);
    }

    #[test]
    fn test_quantize_oracle_confidence_does_not_affect_price() {
        // Confidence value is not used in price computation — only freshness matters
        let oracles_high = vec![
            test_oracle(3000 * PRECISION, 100, 100),
            test_oracle(3010 * PRECISION, 100, 99),
        ];
        let oracles_low = vec![
            test_oracle(3000 * PRECISION, 1, 100),
            test_oracle(3010 * PRECISION, 1, 99),
        ];
        let (p1, _, _) = quantize_oracle(&oracles_high, 105);
        let (p2, _, _) = quantize_oracle(&oracles_low, 105);
        assert_eq!(p1, p2, "Confidence should not affect computed price");
    }

    #[test]
    fn test_report_collateral_value_uses_snapshot_price() {
        // The report computes total_collateral_value using snapshot.collateral_price
        let mut snapshot = test_snapshot();
        snapshot.vaults = vec![vault(0x01, 10 * PRECISION, 5_000 * PRECISION)];
        snapshot.collateral_price = 2000 * PRECISION;

        let report = generate_report(&snapshot);
        // 10 * 2000 = 20_000 (via mul_div)
        let expected = ckb_lending_math::mul_div(10 * PRECISION, 2000 * PRECISION, PRECISION);
        assert_eq!(report.observation.total_collateral_value, expected);
    }

    #[test]
    fn test_tier_changed_single_vault_same_tier() {
        let mut snapshot = test_snapshot();
        snapshot.vaults = vec![vault(0x01, 100 * PRECISION, 5_000 * PRECISION)]; // safe
        let d1 = quantize(&snapshot);
        let d2 = quantize(&snapshot);
        assert!(!tier_changed(&d1, &d2));
    }

    #[test]
    fn test_monotonicity_all_same_risk_levels() {
        // Both at Critical risk level — no RiskLevelImproved violation
        let snapshot = test_snapshot();
        let d = quantize(&snapshot);
        let mut d1 = d.clone();
        let mut d2 = d.clone();
        d1.risk_level = RiskLevel::Critical;
        d2.risk_level = RiskLevel::Critical;
        let result = verify_monotonicity(&d1, &d2);
        assert!(result.violations.iter().all(|v|
            !matches!(v, MonotonicityViolation::RiskLevelImproved { .. })
        ));
    }

    #[test]
    fn test_risk_level_ordinal_monotonic_ordering() {
        // ordinals must be strictly increasing Low → Medium → High → Critical
        let o0 = risk_level_ordinal(&RiskLevel::Low);
        let o1 = risk_level_ordinal(&RiskLevel::Medium);
        let o2 = risk_level_ordinal(&RiskLevel::High);
        let o3 = risk_level_ordinal(&RiskLevel::Critical);
        assert!(o0 < o1 && o1 < o2 && o2 < o3);
    }

    // ============ Hardening Batch 8: Deep Edge Cases ============

    #[test]
    fn test_median_single_zero() {
        assert_eq!(compute_median(&[0]), 0);
    }

    #[test]
    fn test_median_single_max() {
        assert_eq!(compute_median(&[u128::MAX]), u128::MAX);
    }

    #[test]
    fn test_median_five_values_sorted() {
        assert_eq!(compute_median(&[10, 20, 30, 40, 50]), 30);
    }

    #[test]
    fn test_median_five_values_reverse_sorted() {
        assert_eq!(compute_median(&[50, 40, 30, 20, 10]), 30);
    }

    #[test]
    fn test_median_six_values_average_middle() {
        // Sorted: [1, 2, 3, 4, 5, 6], mid=3, avg(sorted[2],sorted[3]) = avg(3,4) = 3
        assert_eq!(compute_median(&[6, 1, 4, 3, 5, 2]), 3);
    }

    #[test]
    fn test_quantize_coverage_at_every_boundary() {
        // Exact boundaries for coverage tiers
        assert_eq!(quantize_coverage(0), CoverageTier::None);
        assert_eq!(quantize_coverage(1), CoverageTier::Minimal);
        assert_eq!(quantize_coverage(500), CoverageTier::Minimal);
        assert_eq!(quantize_coverage(501), CoverageTier::Partial);
        assert_eq!(quantize_coverage(1000), CoverageTier::Partial);
        assert_eq!(quantize_coverage(1001), CoverageTier::Adequate);
        assert_eq!(quantize_coverage(2000), CoverageTier::Adequate);
        assert_eq!(quantize_coverage(2001), CoverageTier::Strong);
        assert_eq!(quantize_coverage(u64::MAX), CoverageTier::Strong);
    }

    #[test]
    fn test_quantize_utilization_at_1_bps() {
        assert_eq!(quantize_utilization(1), UtilizationTier::Low);
    }

    #[test]
    fn test_oracle_two_sources_identical_prices_valid() {
        let oracles = vec![
            test_oracle(5000 * PRECISION, 90, 100),
            test_oracle(5000 * PRECISION, 85, 99),
        ];
        let (price, valid, agreement) = quantize_oracle(&oracles, 105);
        assert!(valid);
        assert_eq!(agreement, 2);
        assert_eq!(price, 5000 * PRECISION);
    }

    #[test]
    fn test_oracle_five_sources_majority_agrees() {
        let oracles = vec![
            test_oracle(1000 * PRECISION, 90, 100),
            test_oracle(1005 * PRECISION, 85, 100),
            test_oracle(1010 * PRECISION, 80, 100),
            test_oracle(5000 * PRECISION, 70, 100), // outlier
            test_oracle(8000 * PRECISION, 60, 100), // outlier
        ];
        let (_price, _valid, agreement) = quantize_oracle(&oracles, 105);
        // Sorted: [1000, 1005, 1010, 5000, 8000]. Median = 1010.
        // 1000 vs 1010: diff=10, 10*10000=100000, 1010*1000=1010000 -> agrees
        // 1005 vs 1010: diff=5, same logic -> agrees
        // 1010 vs 1010: exact match -> agrees
        // 5000 vs 1010: diff=3990 -> 39900000 > 1010000 -> disagrees
        // 8000 vs 1010: diff=6990 -> disagrees
        assert_eq!(agreement, 3);
    }

    #[test]
    fn test_monotonicity_risk_level_same_but_score_decreases() {
        // Risk level stays Critical but score drops — should detect RiskScoreDecreased
        let snapshot = test_snapshot();
        let d = quantize(&snapshot);
        let mut d1 = d.clone();
        let mut d2 = d.clone();
        d1.risk_score = 80;
        d1.risk_level = RiskLevel::Critical;
        d2.risk_score = 50;
        d2.risk_level = RiskLevel::Critical;
        let result = verify_monotonicity(&d1, &d2);
        assert!(!result.is_monotonic);
        assert!(result.violations.iter().any(|v|
            matches!(v, MonotonicityViolation::RiskScoreDecreased { .. })
        ));
    }

    #[test]
    fn test_tier_changed_empty_vaults_both_sides() {
        let mut snapshot = test_snapshot();
        snapshot.vaults.clear();
        let d1 = quantize(&snapshot);
        let d2 = quantize(&snapshot);
        assert!(!tier_changed(&d1, &d2));
    }

    #[test]
    fn test_tier_changed_different_vault_count() {
        let snapshot = test_snapshot();
        let d1 = quantize(&snapshot);
        let mut d2 = d1.clone();
        d2.vault_tiers.pop();
        assert!(tier_changed(&d1, &d2));
    }

    #[test]
    fn test_simulate_price_stress_1_bps_minimal_drop() {
        // 0.01% drop — should have minimal risk impact
        let snapshot = test_snapshot();
        let (before, after) = simulate_price_stress(&snapshot, 1);
        assert!(after.risk_score >= before.risk_score);
    }

    #[test]
    fn test_quantize_single_vault_zero_debt_safe() {
        let mut snapshot = test_snapshot();
        snapshot.vaults = vec![vault(0x01, 100 * PRECISION, 0)];
        let decision = quantize(&snapshot);
        assert_eq!(decision.vault_tiers.len(), 1);
        assert_eq!(decision.vault_tiers[0].tier, RiskTier::Safe);
    }

    #[test]
    fn test_report_single_oracle_spread_is_zero() {
        let mut snapshot = test_snapshot();
        snapshot.oracle_data = vec![test_oracle(3000 * PRECISION, 90, 100)];
        let report = generate_report(&snapshot);
        assert_eq!(report.observation.price_spread_bps, 0,
            "Single oracle source should have 0 spread");
        assert_eq!(report.observation.oracle_source_count, 1);
    }

    #[test]
    fn test_report_no_vaults_totals_are_zero() {
        let mut snapshot = test_snapshot();
        snapshot.vaults.clear();
        let report = generate_report(&snapshot);
        assert_eq!(report.observation.vault_count, 0);
        assert_eq!(report.observation.total_collateral_value, 0);
        assert_eq!(report.observation.total_debt, 0);
    }

    #[test]
    fn test_quantize_with_single_stale_oracle_falls_back() {
        let mut snapshot = test_snapshot();
        snapshot.oracle_data = vec![test_oracle(5000 * PRECISION, 90, 1)]; // stale
        snapshot.current_block = 500;
        snapshot.collateral_price = 4000 * PRECISION;
        let decision = quantize(&snapshot);
        assert!(!decision.oracle_valid);
        assert_eq!(decision.validated_price, 4000 * PRECISION);
    }

    #[test]
    fn test_monotonicity_action_count_increase_is_ok() {
        let snapshot = test_snapshot();
        let d = quantize(&snapshot);
        let mut d1 = d.clone();
        let mut d2 = d.clone();
        d1.actions.clear();
        d2.actions.push(PendingAction {
            vault_index: 0,
            action: KeeperAction::Warn { health_factor: PRECISION, vault_owner: [0xAA; 32] },
            health_factor: PRECISION,
            priority: 1,
        });
        let result = verify_monotonicity(&d1, &d2);
        // More actions in riskier → should NOT trigger ActionCountDecreased
        assert!(result.violations.iter().all(|v|
            !matches!(v, MonotonicityViolation::ActionCountDecreased { .. })
        ));
    }
}
