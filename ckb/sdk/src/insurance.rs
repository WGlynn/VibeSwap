// ============ Insurance — IL Protection & Mutualized Risk Pools ============
// Core insurance module implementing VibeSwap's "Cooperative Capitalism" philosophy:
// risk is mutualized through insurance pools so LPs are protected from impermanent
// loss without requiring individual hedging strategies.
//
// Key capabilities:
// - Premium calculation: dynamic pricing based on pool utilization and coverage tier
// - IL claim processing: standard constant-product IL formula with tier-capped payouts
// - Pool health monitoring: utilization, reserves, sustainability scoring
// - Coverage lifecycle: quoting, activation, expiry tracking, claim validation
//
// The insurance pool absorbs first-loss from IL events, funded by premiums.
// Higher utilization drives up premiums (supply/demand equilibrium).
// Tiered coverage lets LPs choose their risk/cost tradeoff.
//
// Philosophy: prevention > punishment, mutualism > predation (P-105).

use vibeswap_math::PRECISION;
use vibeswap_math::mul_div;

// ============ Constants ============

/// Maximum ratio of total coverage to total deposits (80%)
pub const MAX_COVERAGE_RATIO_BPS: u16 = 8000;

/// Minimum premium rate floor (0.1%)
pub const MIN_PREMIUM_RATE_BPS: u16 = 10;

/// Maximum premium rate ceiling (5%)
pub const MAX_PREMIUM_RATE_BPS: u16 = 500;

/// Default cooldown period before claims can be submitted (blocks)
pub const DEFAULT_COOLDOWN_BLOCKS: u64 = 1000;

/// Warning threshold: coverage approaching expiry (blocks)
pub const EXPIRY_WARNING_BLOCKS: u64 = 5000;

/// Maximum number of coverage tiers
pub const MAX_TIERS: usize = 5;

/// Premium multiplier at full utilization (3x base rate)
pub const UTILIZATION_PREMIUM_FACTOR: u128 = 3;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InsuranceError {
    /// Pool cannot cover the requested amount
    InsufficientCoverage,
    /// Pool has no remaining deposits to pay claims
    PoolDepleted,
    /// Premium parameters are invalid (zero or out of range)
    InvalidPremium,
    /// Claim submitted before cooldown period elapsed
    ClaimTooEarly,
    /// Coverage position has expired
    ClaimExpired,
    /// No active coverage position found for this owner
    NoActiveCoverage,
    /// Claim amount exceeds tier maximum payout
    ExcessiveClaim,
    /// Tier ID is invalid or exceeds MAX_TIERS
    InvalidTier,
    /// Cooldown period has not elapsed since coverage start
    CooldownActive,
    /// Pool has reached maximum coverage capacity
    PoolFull,
}

// ============ Data Types ============

/// Insurance pool state — mutualized protection fund.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InsurancePool {
    /// Unique pool identifier
    pub pool_id: [u8; 32],
    /// Total deposited capital backing the pool
    pub total_deposits: u128,
    /// Total outstanding coverage commitments
    pub total_coverage: u128,
    /// Current utilization (coverage / deposits) in bps
    pub utilization_bps: u16,
    /// Base premium rate in bps
    pub premium_rate_bps: u16,
    /// Maximum coverage-to-deposit ratio in bps
    pub max_coverage_ratio_bps: u16,
    /// Blocks before a new position can submit claims
    pub cooldown_blocks: u64,
}

/// An individual LP's coverage position.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CoveragePosition {
    /// Owner's identity (pubkey hash or lock hash)
    pub owner: [u8; 32],
    /// The AMM pair this coverage protects
    pub pair_id: [u8; 32],
    /// Nominal amount of LP value covered
    pub covered_amount: u128,
    /// Premium paid upfront for this coverage
    pub premium_paid: u128,
    /// Block number when coverage began
    pub start_block: u64,
    /// Block number when coverage expires
    pub expiry_block: u64,
    /// Coverage tier (0..MAX_TIERS)
    pub tier: u8,
}

/// Coverage tier definition — determines payout caps and premium scaling.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CoverageTier {
    /// Tier identifier (0 = basic, 4 = premium)
    pub tier_id: u8,
    /// Human-readable name (padded to 16 bytes)
    pub name: [u8; 16],
    /// Maximum payout as % of covered amount (bps)
    pub max_payout_bps: u16,
    /// Premium multiplier relative to base rate (bps, 10000 = 1x)
    pub premium_multiplier_bps: u16,
    /// Minimum duration in blocks for this tier
    pub min_duration_blocks: u64,
}

/// Result of an IL claim calculation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ILClaim {
    /// The coverage position being claimed against
    pub position: CoveragePosition,
    /// Actual impermanent loss in bps
    pub actual_il_bps: u16,
    /// Amount claimable from the pool
    pub claimable_amount: u128,
    /// Effective payout ratio (claimable / covered_amount) in bps
    pub payout_ratio_bps: u16,
}

/// Pool health assessment.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolHealth {
    /// Total deposited capital
    pub total_deposits: u128,
    /// Total outstanding coverage
    pub total_coverage: u128,
    /// Utilization ratio in bps
    pub utilization_bps: u16,
    /// Reserve ratio: uncovered deposits / total deposits (bps)
    pub reserve_ratio_bps: u16,
    /// Composite risk score (0 = safe, 10000 = critical)
    pub risk_score: u16,
    /// Whether the pool can sustain current commitments
    pub sustainable: bool,
}

/// Premium quote for a prospective coverage buyer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PremiumQuote {
    /// Total premium to pay
    pub premium_amount: u128,
    /// Coverage amount being quoted
    pub coverage_amount: u128,
    /// Duration of coverage in blocks
    pub duration_blocks: u64,
    /// Tier of coverage
    pub tier: u8,
    /// Effective premium rate after utilization adjustment (bps)
    pub effective_rate_bps: u16,
}

/// Coverage lifecycle status.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CoverageStatus {
    /// Coverage is active and claimable
    Active,
    /// Coverage is within EXPIRY_WARNING_BLOCKS of expiry
    Expiring,
    /// Coverage has passed its expiry block
    Expired,
}

// ============ Premium Calculation ============

/// Calculate the premium for a given coverage amount, duration, and tier.
///
/// Premium = coverage_amount * effective_rate * duration_blocks / BLOCKS_PER_YEAR
/// where effective_rate accounts for utilization-driven pricing and tier multipliers.
///
/// We normalize duration against a reference period (the pool's cooldown_blocks
/// acts as a scaling denominator — longer coverage costs proportionally more).
pub fn calculate_premium(
    pool: &InsurancePool,
    coverage_amount: u128,
    duration_blocks: u64,
    tier: &CoverageTier,
) -> Result<PremiumQuote, InsuranceError> {
    if coverage_amount == 0 {
        return Err(InsuranceError::InvalidPremium);
    }
    if duration_blocks == 0 {
        return Err(InsuranceError::InvalidPremium);
    }
    if tier.tier_id as usize >= MAX_TIERS {
        return Err(InsuranceError::InvalidTier);
    }
    if duration_blocks < tier.min_duration_blocks {
        return Err(InsuranceError::InvalidPremium);
    }

    // Check pool capacity
    let max_coverage = available_coverage(pool);
    if coverage_amount > max_coverage {
        return Err(InsuranceError::PoolFull);
    }

    // Dynamic rate based on current utilization
    let base_dynamic = dynamic_premium_rate(pool.premium_rate_bps, pool.utilization_bps);

    // Apply tier multiplier: effective = base_dynamic * tier_multiplier / 10000
    let effective_rate_bps = {
        let raw = (base_dynamic as u64) * (tier.premium_multiplier_bps as u64) / 10_000;
        let clamped = raw.min(MAX_PREMIUM_RATE_BPS as u64).max(MIN_PREMIUM_RATE_BPS as u64);
        clamped as u16
    };

    // Premium = coverage_amount * effective_rate_bps * duration_blocks / (10000 * reference_blocks)
    // Use cooldown_blocks as a reference period. If cooldown is 0, use 1 to avoid div-by-zero.
    let reference_blocks = if pool.cooldown_blocks > 0 { pool.cooldown_blocks } else { 1 };
    let premium_amount = mul_div(
        coverage_amount,
        (effective_rate_bps as u128) * (duration_blocks as u128),
        10_000u128 * (reference_blocks as u128),
    );

    if premium_amount == 0 {
        return Err(InsuranceError::InvalidPremium);
    }

    Ok(PremiumQuote {
        premium_amount,
        coverage_amount,
        duration_blocks,
        tier: tier.tier_id,
        effective_rate_bps,
    })
}

// ============ IL Claim Calculation ============

/// Calculate the IL and claimable payout for a coverage position.
///
/// Uses the standard constant-product IL formula:
///   price_ratio = current_price / entry_price
///   sqrt_ratio = sqrt(price_ratio)
///   lp_hodl_ratio = 2 * sqrt_ratio / (1 + price_ratio)
///   il_bps = (1 - lp_hodl_ratio) * 10000
///
/// Payout is capped by the tier's max_payout_bps.
pub fn calculate_il_claim(
    position: &CoveragePosition,
    entry_price: u128,
    current_price: u128,
    tier: &CoverageTier,
) -> Result<ILClaim, InsuranceError> {
    if entry_price == 0 || current_price == 0 {
        return Err(InsuranceError::NoActiveCoverage);
    }

    // price_ratio = current_price * PRECISION / entry_price
    let price_ratio = mul_div(current_price, PRECISION, entry_price);

    // sqrt_ratio = sqrt(price_ratio * PRECISION) — result is in PRECISION scale
    let sqrt_ratio = vibeswap_math::sqrt(mul_div(price_ratio, PRECISION, 1));

    // lp_hodl_ratio = 2 * sqrt_ratio * PRECISION / (PRECISION + price_ratio)
    let numerator = 2 * sqrt_ratio;
    let denominator = PRECISION + price_ratio;
    let lp_hodl_ratio = mul_div(numerator, PRECISION, denominator);

    // il_bps = (PRECISION - lp_hodl_ratio) * 10000 / PRECISION
    // If price unchanged, lp_hodl_ratio == PRECISION, il_bps == 0
    let il_bps = if lp_hodl_ratio >= PRECISION {
        0u16
    } else {
        mul_div(PRECISION - lp_hodl_ratio, 10_000, PRECISION) as u16
    };

    if il_bps == 0 {
        return Ok(ILClaim {
            position: position.clone(),
            actual_il_bps: 0,
            claimable_amount: 0,
            payout_ratio_bps: 0,
        });
    }

    // Raw payout = covered_amount * il_bps / 10000
    let raw_payout = mul_div(position.covered_amount, il_bps as u128, 10_000);

    // Cap at tier max payout
    let max_payout = mul_div(position.covered_amount, tier.max_payout_bps as u128, 10_000);
    let claimable_amount = raw_payout.min(max_payout);

    let payout_ratio_bps = if position.covered_amount > 0 {
        mul_div(claimable_amount, 10_000, position.covered_amount) as u16
    } else {
        0
    };

    Ok(ILClaim {
        position: position.clone(),
        actual_il_bps: il_bps,
        claimable_amount,
        payout_ratio_bps,
    })
}

// ============ Claim Validation ============

/// Validate whether a claim can be submitted for a coverage position.
///
/// Checks:
/// 1. Coverage must not have expired (current_block <= expiry_block)
/// 2. Cooldown must have elapsed (current_block >= start_block + cooldown_blocks)
pub fn validate_claim(
    position: &CoveragePosition,
    current_block: u64,
    cooldown_blocks: u64,
) -> Result<(), InsuranceError> {
    // Check expiry
    if current_block > position.expiry_block {
        return Err(InsuranceError::ClaimExpired);
    }

    // Check cooldown
    let cooldown_end = position.start_block.saturating_add(cooldown_blocks);
    if current_block < cooldown_end {
        return Err(InsuranceError::CooldownActive);
    }

    Ok(())
}

// ============ Pool Health ============

/// Assess the health of an insurance pool.
///
/// Risk score formula:
///   base = utilization_bps (0-10000)
///   if utilization > 6000 bps (60%), add penalty
///   if utilization > 8000 bps (80%), pool is unsustainable
pub fn pool_health(pool: &InsurancePool) -> PoolHealth {
    let utilization_bps = if pool.total_deposits > 0 {
        mul_div(pool.total_coverage, 10_000, pool.total_deposits) as u16
    } else if pool.total_coverage > 0 {
        10_000u16 // fully utilized if no deposits but coverage exists
    } else {
        0u16 // empty pool
    };

    let reserve_ratio_bps = if utilization_bps >= 10_000 {
        0u16
    } else {
        10_000u16 - utilization_bps
    };

    // Risk score: utilization-based with penalty above 60%
    let risk_score = if utilization_bps <= 6000 {
        // Linear: 0-6000 maps to 0-6000
        utilization_bps
    } else if utilization_bps <= 8000 {
        // Accelerated: 6000-8000 maps to 6000-8500
        let excess = (utilization_bps - 6000) as u32;
        let penalty = excess * 125 / 100; // 1.25x scaling
        6000 + penalty as u16
    } else {
        // Critical: 8000-10000 maps to 8500-10000
        let excess = (utilization_bps - 8000) as u32;
        let penalty = excess * 75 / 100; // fill 8500-10000
        (8500 + penalty as u16).min(10_000)
    };

    // Sustainable if utilization is below max coverage ratio
    let sustainable = utilization_bps < pool.max_coverage_ratio_bps;

    PoolHealth {
        total_deposits: pool.total_deposits,
        total_coverage: pool.total_coverage,
        utilization_bps,
        reserve_ratio_bps,
        risk_score,
        sustainable,
    }
}

// ============ Available Coverage ============

/// Calculate the maximum additional coverage the pool can underwrite.
///
/// available = (total_deposits * max_coverage_ratio / 10000) - total_coverage
pub fn available_coverage(pool: &InsurancePool) -> u128 {
    let max_total = mul_div(
        pool.total_deposits,
        pool.max_coverage_ratio_bps as u128,
        10_000,
    );
    max_total.saturating_sub(pool.total_coverage)
}

// ============ Dynamic Premium Rate ============

/// Adjust the base premium rate based on pool utilization.
///
/// Uses a linear ramp: at 0% utilization, rate = base_rate.
/// At 100% utilization, rate = base_rate * UTILIZATION_PREMIUM_FACTOR.
/// Clamped to [MIN_PREMIUM_RATE_BPS, MAX_PREMIUM_RATE_BPS].
pub fn dynamic_premium_rate(base_rate_bps: u16, utilization_bps: u16) -> u16 {
    // rate = base * (1 + (FACTOR - 1) * utilization / 10000)
    // = base + base * (FACTOR - 1) * utilization / 10000
    let base = base_rate_bps as u128;
    let util = utilization_bps as u128;
    let factor_minus_one = UTILIZATION_PREMIUM_FACTOR - 1; // 2

    let premium_increase = base * factor_minus_one * util / 10_000;
    let raw_rate = base + premium_increase;

    let clamped = raw_rate
        .max(MIN_PREMIUM_RATE_BPS as u128)
        .min(MAX_PREMIUM_RATE_BPS as u128);
    clamped as u16
}

// ============ Payout Estimation ============

/// Estimate the payout for a given coverage amount and IL level.
///
/// payout = min(coverage * il_bps / 10000, coverage * max_payout_bps / 10000)
pub fn estimate_payout(coverage_amount: u128, il_bps: u16, tier: &CoverageTier) -> u128 {
    let raw_payout = mul_div(coverage_amount, il_bps as u128, 10_000);
    let max_payout = mul_div(coverage_amount, tier.max_payout_bps as u128, 10_000);
    raw_payout.min(max_payout)
}

// ============ Coverage Expiry Status ============

/// Determine the lifecycle status of a coverage position.
pub fn coverage_expiry_status(position: &CoveragePosition, current_block: u64) -> CoverageStatus {
    if current_block > position.expiry_block {
        CoverageStatus::Expired
    } else if position.expiry_block.saturating_sub(current_block) <= EXPIRY_WARNING_BLOCKS {
        CoverageStatus::Expiring
    } else {
        CoverageStatus::Active
    }
}

// ============ Pool Sustainability ============

/// Check whether a pool is sustainable given recent claim history and premium income.
///
/// A pool is sustainable if:
/// 1. Premium income exceeds recent claim payouts (net positive)
/// 2. Utilization is below the max coverage ratio
/// 3. No single recent claim exceeded 50% of pool deposits
///
/// `recent_claims` is a slice of (amount, block) tuples.
pub fn pool_sustainability_check(
    pool: &InsurancePool,
    recent_claims: &[(u128, u64)],
    premium_income: u128,
) -> bool {
    if pool.total_deposits == 0 {
        return false;
    }

    // Condition 1: premium income covers claims
    let total_claims: u128 = recent_claims.iter().map(|(amt, _)| amt).sum();
    if total_claims > premium_income {
        return false;
    }

    // Condition 2: utilization within bounds
    let health = pool_health(pool);
    if !health.sustainable {
        return false;
    }

    // Condition 3: no single claim exceeds 50% of deposits
    let half_deposits = pool.total_deposits / 2;
    for (amt, _) in recent_claims {
        if *amt > half_deposits {
            return false;
        }
    }

    true
}

// ============ Optimal Coverage Amount ============

/// Calculate how much coverage an LP should purchase based on their LP value
/// and IL tolerance.
///
/// If an LP has `lp_value` and can tolerate `il_tolerance_bps` of loss before
/// wanting insurance to kick in, the optimal coverage protects the excess:
///   optimal = lp_value * (max_payout_bps - il_tolerance_bps) / max_payout_bps
///
/// This ensures the LP is covered for losses beyond their tolerance threshold
/// up to the tier's maximum payout.
pub fn optimal_coverage_amount(
    lp_value: u128,
    il_tolerance_bps: u16,
    tier: &CoverageTier,
) -> u128 {
    if il_tolerance_bps >= tier.max_payout_bps {
        // LP's tolerance exceeds the tier's max payout — no coverage needed
        return 0;
    }

    // Coverage should protect the portion of LP value beyond tolerance
    // optimal = lp_value * (max_payout - tolerance) / max_payout
    let protection_range = (tier.max_payout_bps - il_tolerance_bps) as u128;
    mul_div(lp_value, protection_range, tier.max_payout_bps as u128)
}

// ============ Aggregate Pool Statistics ============

/// Compute aggregate statistics across multiple insurance pools.
///
/// Returns (total_deposits, total_coverage, average_utilization_bps).
pub fn aggregate_pool_stats(pools: &[InsurancePool]) -> (u128, u128, u16) {
    if pools.is_empty() {
        return (0, 0, 0);
    }

    let total_deposits: u128 = pools.iter().map(|p| p.total_deposits).sum();
    let total_coverage: u128 = pools.iter().map(|p| p.total_coverage).sum();

    let avg_utilization = if total_deposits > 0 {
        mul_div(total_coverage, 10_000, total_deposits) as u16
    } else {
        0
    };

    (total_deposits, total_coverage, avg_utilization)
}

// ============ Claim Priority Scoring ============

/// Score a claim for priority when the pool is under stress.
///
/// Higher scores = higher priority. Factors:
/// - IL severity: higher IL gets priority (the LP needs it more)
/// - Pool health: stressed pools prioritize smaller claims to preserve capital
/// - Payout ratio: claims using less of their max payout are prioritized
///   (they're more "honest" — not maxing out the tier cap)
///
/// Score = il_severity_weight + efficiency_weight + urgency_weight
pub fn claim_priority_score(claim: &ILClaim, pool_health_info: &PoolHealth) -> u64 {
    // Component 1: IL severity (0-10000 range, scaled to 0-4000)
    let il_severity_weight = (claim.actual_il_bps as u64) * 4000 / 10_000;

    // Component 2: Claim efficiency — smaller claims relative to pool get priority
    // when pool is stressed. Ratio = claimable / total_deposits.
    let efficiency_weight = if pool_health_info.total_deposits > 0 && claim.claimable_amount > 0 {
        let claim_ratio = mul_div(
            claim.claimable_amount,
            10_000,
            pool_health_info.total_deposits,
        ) as u64;
        // Inverse: smaller claims score higher (max 3000)
        if claim_ratio >= 10_000 {
            0
        } else {
            (10_000 - claim_ratio) * 3000 / 10_000
        }
    } else {
        1500 // neutral score for edge cases
    };

    // Component 3: Pool stress urgency — higher utilization = prioritize processing claims
    let urgency_weight = if pool_health_info.risk_score > 8000 {
        // Critical pool: penalize large claims, boost small ones
        let stress_factor = (pool_health_info.risk_score as u64 - 8000) * 3000 / 2000;
        stress_factor.min(3000)
    } else if pool_health_info.risk_score > 5000 {
        // Moderate stress
        let stress_factor = (pool_health_info.risk_score as u64 - 5000) * 1500 / 3000;
        stress_factor.min(1500)
    } else {
        // Healthy pool: standard priority
        1000
    };

    il_severity_weight + efficiency_weight + urgency_weight
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn make_pool(deposits: u128, coverage: u128) -> InsurancePool {
        let utilization = if deposits > 0 {
            mul_div(coverage, 10_000, deposits) as u16
        } else {
            0
        };
        InsurancePool {
            pool_id: [0x01; 32],
            total_deposits: deposits,
            total_coverage: coverage,
            utilization_bps: utilization,
            premium_rate_bps: 100, // 1%
            max_coverage_ratio_bps: MAX_COVERAGE_RATIO_BPS,
            cooldown_blocks: DEFAULT_COOLDOWN_BLOCKS,
        }
    }

    fn make_tier(id: u8, max_payout_bps: u16, multiplier_bps: u16) -> CoverageTier {
        CoverageTier {
            tier_id: id,
            name: [0u8; 16],
            max_payout_bps,
            premium_multiplier_bps: multiplier_bps,
            min_duration_blocks: 100,
        }
    }

    fn make_position(covered: u128, start: u64, expiry: u64, tier: u8) -> CoveragePosition {
        CoveragePosition {
            owner: [0xAA; 32],
            pair_id: [0xBB; 32],
            covered_amount: covered,
            premium_paid: mul_div(covered, 100, 10_000), // 1% premium
            start_block: start,
            expiry_block: expiry,
            tier,
        }
    }

    // ============ Premium Calculation Tests ============

    #[test]
    fn test_premium_normal() {
        let pool = make_pool(1_000_000 * PRECISION, 200_000 * PRECISION);
        let tier = make_tier(0, 2000, 10_000); // 1x multiplier
        let quote = calculate_premium(
            &pool,
            100_000 * PRECISION,
            10_000,
            &tier,
        ).unwrap();
        assert!(quote.premium_amount > 0);
        assert_eq!(quote.coverage_amount, 100_000 * PRECISION);
        assert_eq!(quote.duration_blocks, 10_000);
        assert_eq!(quote.tier, 0);
    }

    #[test]
    fn test_premium_high_utilization() {
        let pool = make_pool(1_000_000 * PRECISION, 700_000 * PRECISION); // 70% util
        let tier = make_tier(0, 2000, 10_000);
        let quote_high = calculate_premium(
            &pool,
            50_000 * PRECISION,
            10_000,
            &tier,
        ).unwrap();

        let pool_low = make_pool(1_000_000 * PRECISION, 100_000 * PRECISION); // 10% util
        let quote_low = calculate_premium(
            &pool_low,
            50_000 * PRECISION,
            10_000,
            &tier,
        ).unwrap();

        // High utilization should yield higher premium
        assert!(quote_high.premium_amount > quote_low.premium_amount);
        assert!(quote_high.effective_rate_bps > quote_low.effective_rate_bps);
    }

    #[test]
    fn test_premium_zero_coverage() {
        let pool = make_pool(1_000_000 * PRECISION, 0);
        let tier = make_tier(0, 2000, 10_000);
        let result = calculate_premium(&pool, 0, 10_000, &tier);
        assert_eq!(result, Err(InsuranceError::InvalidPremium));
    }

    #[test]
    fn test_premium_zero_duration() {
        let pool = make_pool(1_000_000 * PRECISION, 0);
        let tier = make_tier(0, 2000, 10_000);
        let result = calculate_premium(&pool, 100_000 * PRECISION, 0, &tier);
        assert_eq!(result, Err(InsuranceError::InvalidPremium));
    }

    #[test]
    fn test_premium_max_tier() {
        let pool = make_pool(1_000_000 * PRECISION, 0);
        let tier = make_tier(4, 5000, 30_000); // 3x multiplier, highest tier
        let quote = calculate_premium(
            &pool,
            100_000 * PRECISION,
            10_000,
            &tier,
        ).unwrap();
        assert!(quote.effective_rate_bps >= MIN_PREMIUM_RATE_BPS);
        assert!(quote.effective_rate_bps <= MAX_PREMIUM_RATE_BPS);
    }

    #[test]
    fn test_premium_invalid_tier() {
        let pool = make_pool(1_000_000 * PRECISION, 0);
        let tier = make_tier(5, 2000, 10_000); // tier_id=5 >= MAX_TIERS
        let result = calculate_premium(&pool, 100_000 * PRECISION, 10_000, &tier);
        assert_eq!(result, Err(InsuranceError::InvalidTier));
    }

    #[test]
    fn test_premium_pool_full() {
        let pool = make_pool(1_000_000 * PRECISION, 800_000 * PRECISION); // at 80% cap
        let tier = make_tier(0, 2000, 10_000);
        let result = calculate_premium(&pool, 1 * PRECISION, 10_000, &tier);
        // Pool is at max coverage ratio, no room
        assert_eq!(result, Err(InsuranceError::PoolFull));
    }

    #[test]
    fn test_premium_duration_below_min() {
        let pool = make_pool(1_000_000 * PRECISION, 0);
        let tier = make_tier(0, 2000, 10_000); // min_duration_blocks = 100
        let result = calculate_premium(&pool, 100_000 * PRECISION, 50, &tier);
        assert_eq!(result, Err(InsuranceError::InvalidPremium));
    }

    #[test]
    fn test_premium_tier_multiplier_increases_cost() {
        let pool = make_pool(1_000_000 * PRECISION, 100_000 * PRECISION);
        let tier_basic = make_tier(0, 2000, 10_000); // 1x
        let tier_premium = make_tier(1, 4000, 20_000); // 2x

        let quote_basic = calculate_premium(&pool, 50_000 * PRECISION, 10_000, &tier_basic).unwrap();
        let quote_premium = calculate_premium(&pool, 50_000 * PRECISION, 10_000, &tier_premium).unwrap();

        assert!(quote_premium.premium_amount > quote_basic.premium_amount);
    }

    #[test]
    fn test_premium_longer_duration_costs_more() {
        let pool = make_pool(1_000_000 * PRECISION, 100_000 * PRECISION);
        let tier = make_tier(0, 2000, 10_000);

        let quote_short = calculate_premium(&pool, 50_000 * PRECISION, 1_000, &tier).unwrap();
        let quote_long = calculate_premium(&pool, 50_000 * PRECISION, 10_000, &tier).unwrap();

        assert!(quote_long.premium_amount > quote_short.premium_amount);
    }

    // ============ IL Claim Calculation Tests ============

    #[test]
    fn test_il_claim_price_doubles() {
        let position = make_position(1_000_000 * PRECISION, 100, 100_000, 0);
        let tier = make_tier(0, 2000, 10_000);
        // Price doubles: entry=1000, current=2000
        let claim = calculate_il_claim(
            &position,
            1000 * PRECISION,
            2000 * PRECISION,
            &tier,
        ).unwrap();
        // IL for 2x price ratio ≈ 5.72% = ~572 bps
        assert!(claim.actual_il_bps >= 550);
        assert!(claim.actual_il_bps <= 600);
        assert!(claim.claimable_amount > 0);
    }

    #[test]
    fn test_il_claim_price_halves() {
        let position = make_position(1_000_000 * PRECISION, 100, 100_000, 0);
        let tier = make_tier(0, 2000, 10_000);
        // Price halves: entry=2000, current=1000
        let claim = calculate_il_claim(
            &position,
            2000 * PRECISION,
            1000 * PRECISION,
            &tier,
        ).unwrap();
        // IL for 0.5x ratio ≈ 5.72% (same as 2x — IL is symmetric in ratio space)
        assert!(claim.actual_il_bps >= 550);
        assert!(claim.actual_il_bps <= 600);
    }

    #[test]
    fn test_il_claim_price_quadruples() {
        let position = make_position(1_000_000 * PRECISION, 100, 100_000, 0);
        let tier = make_tier(0, 5000, 10_000); // high cap to see full IL
        // Price 4x: IL ≈ 20%
        let claim = calculate_il_claim(
            &position,
            1000 * PRECISION,
            4000 * PRECISION,
            &tier,
        ).unwrap();
        assert!(claim.actual_il_bps >= 1900);
        assert!(claim.actual_il_bps <= 2100);
    }

    #[test]
    fn test_il_claim_price_10x() {
        let position = make_position(1_000_000 * PRECISION, 100, 100_000, 0);
        let tier = make_tier(0, 5000, 10_000);
        // Price 10x: IL ≈ 42.5%
        let claim = calculate_il_claim(
            &position,
            1000 * PRECISION,
            10_000 * PRECISION,
            &tier,
        ).unwrap();
        assert!(claim.actual_il_bps >= 4100);
        assert!(claim.actual_il_bps <= 4400);
    }

    #[test]
    fn test_il_claim_same_price() {
        let position = make_position(1_000_000 * PRECISION, 100, 100_000, 0);
        let tier = make_tier(0, 2000, 10_000);
        // No price change: IL = 0
        let claim = calculate_il_claim(
            &position,
            1000 * PRECISION,
            1000 * PRECISION,
            &tier,
        ).unwrap();
        assert_eq!(claim.actual_il_bps, 0);
        assert_eq!(claim.claimable_amount, 0);
    }

    #[test]
    fn test_il_claim_tier_cap() {
        let position = make_position(1_000_000 * PRECISION, 100, 100_000, 0);
        let tier = make_tier(0, 500, 10_000); // max 5% payout
        // Price 4x: IL ≈ 20%, but tier caps at 5%
        let claim = calculate_il_claim(
            &position,
            1000 * PRECISION,
            4000 * PRECISION,
            &tier,
        ).unwrap();
        // Claimable should be capped
        let max_payout = mul_div(position.covered_amount, 500, 10_000);
        assert_eq!(claim.claimable_amount, max_payout);
    }

    #[test]
    fn test_il_claim_zero_entry_price() {
        let position = make_position(1_000_000 * PRECISION, 100, 100_000, 0);
        let tier = make_tier(0, 2000, 10_000);
        let result = calculate_il_claim(&position, 0, 1000 * PRECISION, &tier);
        assert_eq!(result, Err(InsuranceError::NoActiveCoverage));
    }

    #[test]
    fn test_il_claim_zero_current_price() {
        let position = make_position(1_000_000 * PRECISION, 100, 100_000, 0);
        let tier = make_tier(0, 2000, 10_000);
        let result = calculate_il_claim(&position, 1000 * PRECISION, 0, &tier);
        assert_eq!(result, Err(InsuranceError::NoActiveCoverage));
    }

    #[test]
    fn test_il_claim_small_price_change() {
        let position = make_position(1_000_000 * PRECISION, 100, 100_000, 0);
        let tier = make_tier(0, 2000, 10_000);
        // Price moves 1%: entry=1000, current=1010
        let claim = calculate_il_claim(
            &position,
            1000 * PRECISION,
            1010 * PRECISION,
            &tier,
        ).unwrap();
        // Very small IL — should be near 0 bps
        assert!(claim.actual_il_bps <= 5);
    }

    #[test]
    fn test_il_claim_payout_ratio() {
        let position = make_position(1_000_000 * PRECISION, 100, 100_000, 0);
        let tier = make_tier(0, 2000, 10_000);
        let claim = calculate_il_claim(
            &position,
            1000 * PRECISION,
            2000 * PRECISION,
            &tier,
        ).unwrap();
        // payout_ratio should match il_bps (since tier cap is 2000 and IL ~572)
        assert_eq!(claim.payout_ratio_bps, claim.actual_il_bps);
    }

    // ============ Claim Validation Tests ============

    #[test]
    fn test_validate_claim_active() {
        let position = make_position(1_000_000 * PRECISION, 1000, 50_000, 0);
        let result = validate_claim(&position, 5000, DEFAULT_COOLDOWN_BLOCKS);
        assert_eq!(result, Ok(()));
    }

    #[test]
    fn test_validate_claim_expired() {
        let position = make_position(1_000_000 * PRECISION, 1000, 5000, 0);
        let result = validate_claim(&position, 5001, DEFAULT_COOLDOWN_BLOCKS);
        assert_eq!(result, Err(InsuranceError::ClaimExpired));
    }

    #[test]
    fn test_validate_claim_cooldown_active() {
        let position = make_position(1_000_000 * PRECISION, 1000, 50_000, 0);
        // current_block 1500, cooldown_end = 1000 + 1000 = 2000
        let result = validate_claim(&position, 1500, DEFAULT_COOLDOWN_BLOCKS);
        assert_eq!(result, Err(InsuranceError::CooldownActive));
    }

    #[test]
    fn test_validate_claim_at_cooldown_boundary() {
        let position = make_position(1_000_000 * PRECISION, 1000, 50_000, 0);
        // Exactly at cooldown end
        let result = validate_claim(&position, 2000, DEFAULT_COOLDOWN_BLOCKS);
        assert_eq!(result, Ok(()));
    }

    #[test]
    fn test_validate_claim_at_expiry_boundary() {
        let position = make_position(1_000_000 * PRECISION, 1000, 50_000, 0);
        // Exactly at expiry
        let result = validate_claim(&position, 50_000, DEFAULT_COOLDOWN_BLOCKS);
        assert_eq!(result, Ok(()));
    }

    #[test]
    fn test_validate_claim_zero_cooldown() {
        let position = make_position(1_000_000 * PRECISION, 1000, 50_000, 0);
        let result = validate_claim(&position, 1000, 0);
        assert_eq!(result, Ok(()));
    }

    // ============ Pool Health Tests ============

    #[test]
    fn test_pool_health_healthy() {
        let pool = make_pool(1_000_000 * PRECISION, 200_000 * PRECISION); // 20% util
        let health = pool_health(&pool);
        assert_eq!(health.utilization_bps, 2000);
        assert_eq!(health.reserve_ratio_bps, 8000);
        assert!(health.risk_score <= 2000);
        assert!(health.sustainable);
    }

    #[test]
    fn test_pool_health_stressed() {
        let pool = make_pool(1_000_000 * PRECISION, 700_000 * PRECISION); // 70% util
        let health = pool_health(&pool);
        assert_eq!(health.utilization_bps, 7000);
        assert_eq!(health.reserve_ratio_bps, 3000);
        assert!(health.risk_score > 6000);
        assert!(health.sustainable); // 7000 < 8000 max
    }

    #[test]
    fn test_pool_health_depleted() {
        let pool = make_pool(1_000_000 * PRECISION, 900_000 * PRECISION); // 90% util
        let health = pool_health(&pool);
        assert_eq!(health.utilization_bps, 9000);
        assert!(health.risk_score > 8500);
        assert!(!health.sustainable); // 9000 >= 8000 max
    }

    #[test]
    fn test_pool_health_empty() {
        let pool = make_pool(0, 0);
        let health = pool_health(&pool);
        assert_eq!(health.utilization_bps, 0);
        assert_eq!(health.reserve_ratio_bps, 10_000);
        assert_eq!(health.risk_score, 0);
        assert!(health.sustainable);
    }

    #[test]
    fn test_pool_health_zero_deposits_with_coverage() {
        let pool = make_pool(0, 100 * PRECISION);
        let health = pool_health(&pool);
        assert_eq!(health.utilization_bps, 10_000);
        assert_eq!(health.reserve_ratio_bps, 0);
        assert!(!health.sustainable);
    }

    #[test]
    fn test_pool_health_at_max_coverage() {
        let pool = make_pool(1_000_000 * PRECISION, 800_000 * PRECISION); // exactly 80%
        let health = pool_health(&pool);
        assert_eq!(health.utilization_bps, 8000);
        // 8000 is not < 8000, so not sustainable
        assert!(!health.sustainable);
    }

    #[test]
    fn test_pool_health_just_under_max() {
        let pool = make_pool(1_000_000 * PRECISION, 799_000 * PRECISION); // 79.9%
        let health = pool_health(&pool);
        assert!(health.utilization_bps < 8000);
        assert!(health.sustainable);
    }

    // ============ Available Coverage Tests ============

    #[test]
    fn test_available_coverage_plenty() {
        let pool = make_pool(1_000_000 * PRECISION, 200_000 * PRECISION);
        let avail = available_coverage(&pool);
        // Max = 80% of 1M = 800K, minus 200K = 600K
        assert_eq!(avail, 600_000 * PRECISION);
    }

    #[test]
    fn test_available_coverage_near_limit() {
        let pool = make_pool(1_000_000 * PRECISION, 790_000 * PRECISION);
        let avail = available_coverage(&pool);
        assert_eq!(avail, 10_000 * PRECISION);
    }

    #[test]
    fn test_available_coverage_at_limit() {
        let pool = make_pool(1_000_000 * PRECISION, 800_000 * PRECISION);
        let avail = available_coverage(&pool);
        assert_eq!(avail, 0);
    }

    #[test]
    fn test_available_coverage_over_limit() {
        // Shouldn't happen in practice, but test saturating sub
        let mut pool = make_pool(1_000_000 * PRECISION, 900_000 * PRECISION);
        pool.total_coverage = 900_000 * PRECISION; // forced
        let avail = available_coverage(&pool);
        assert_eq!(avail, 0);
    }

    #[test]
    fn test_available_coverage_empty_pool() {
        let pool = make_pool(0, 0);
        let avail = available_coverage(&pool);
        assert_eq!(avail, 0);
    }

    // ============ Dynamic Premium Rate Tests ============

    #[test]
    fn test_dynamic_premium_low_utilization() {
        // 10% utilization with 100 bps base
        let rate = dynamic_premium_rate(100, 1000);
        // rate = 100 + 100 * 2 * 1000 / 10000 = 100 + 20 = 120
        assert_eq!(rate, 120);
    }

    #[test]
    fn test_dynamic_premium_mid_utilization() {
        // 50% utilization with 100 bps base
        let rate = dynamic_premium_rate(100, 5000);
        // rate = 100 + 100 * 2 * 5000 / 10000 = 100 + 100 = 200
        assert_eq!(rate, 200);
    }

    #[test]
    fn test_dynamic_premium_high_utilization() {
        // 100% utilization with 100 bps base
        let rate = dynamic_premium_rate(100, 10_000);
        // rate = 100 + 100 * 2 * 10000 / 10000 = 100 + 200 = 300
        assert_eq!(rate, 300);
    }

    #[test]
    fn test_dynamic_premium_zero_utilization() {
        let rate = dynamic_premium_rate(100, 0);
        assert_eq!(rate, 100); // just the base
    }

    #[test]
    fn test_dynamic_premium_clamp_max() {
        // Very high base rate: should clamp to MAX_PREMIUM_RATE_BPS
        let rate = dynamic_premium_rate(400, 10_000);
        // rate = 400 + 400*2 = 1200 → clamped to 500
        assert_eq!(rate, MAX_PREMIUM_RATE_BPS);
    }

    #[test]
    fn test_dynamic_premium_clamp_min() {
        // Very low base rate: should clamp to MIN_PREMIUM_RATE_BPS
        let rate = dynamic_premium_rate(0, 0);
        assert_eq!(rate, MIN_PREMIUM_RATE_BPS);
    }

    #[test]
    fn test_dynamic_premium_monotonic() {
        // Premium should increase monotonically with utilization
        let mut prev_rate = 0u16;
        for util in (0..=10_000).step_by(1000) {
            let rate = dynamic_premium_rate(100, util);
            assert!(rate >= prev_rate, "rate should increase: {} < {} at util={}", rate, prev_rate, util);
            prev_rate = rate;
        }
    }

    // ============ Payout Estimation Tests ============

    #[test]
    fn test_estimate_payout_below_cap() {
        let tier = make_tier(0, 2000, 10_000); // max 20% payout
        let payout = estimate_payout(1_000_000 * PRECISION, 500, &tier); // 5% IL
        assert_eq!(payout, mul_div(1_000_000 * PRECISION, 500, 10_000));
    }

    #[test]
    fn test_estimate_payout_at_cap() {
        let tier = make_tier(0, 2000, 10_000); // max 20% payout
        let payout = estimate_payout(1_000_000 * PRECISION, 2000, &tier); // 20% IL = cap
        assert_eq!(payout, mul_div(1_000_000 * PRECISION, 2000, 10_000));
    }

    #[test]
    fn test_estimate_payout_above_cap() {
        let tier = make_tier(0, 2000, 10_000); // max 20% payout
        let payout = estimate_payout(1_000_000 * PRECISION, 5000, &tier); // 50% IL > 20% cap
        let max_payout = mul_div(1_000_000 * PRECISION, 2000, 10_000);
        assert_eq!(payout, max_payout);
    }

    #[test]
    fn test_estimate_payout_zero_il() {
        let tier = make_tier(0, 2000, 10_000);
        let payout = estimate_payout(1_000_000 * PRECISION, 0, &tier);
        assert_eq!(payout, 0);
    }

    #[test]
    fn test_estimate_payout_zero_coverage() {
        let tier = make_tier(0, 2000, 10_000);
        let payout = estimate_payout(0, 500, &tier);
        assert_eq!(payout, 0);
    }

    // ============ Coverage Expiry Status Tests ============

    #[test]
    fn test_coverage_status_active() {
        let position = make_position(1_000_000 * PRECISION, 1000, 100_000, 0);
        let status = coverage_expiry_status(&position, 10_000);
        assert_eq!(status, CoverageStatus::Active);
    }

    #[test]
    fn test_coverage_status_expiring() {
        let position = make_position(1_000_000 * PRECISION, 1000, 100_000, 0);
        // Within EXPIRY_WARNING_BLOCKS (5000) of expiry
        let status = coverage_expiry_status(&position, 96_000);
        assert_eq!(status, CoverageStatus::Expiring);
    }

    #[test]
    fn test_coverage_status_expired() {
        let position = make_position(1_000_000 * PRECISION, 1000, 100_000, 0);
        let status = coverage_expiry_status(&position, 100_001);
        assert_eq!(status, CoverageStatus::Expired);
    }

    #[test]
    fn test_coverage_status_at_expiry() {
        let position = make_position(1_000_000 * PRECISION, 1000, 100_000, 0);
        // Exactly at expiry: within warning window
        let status = coverage_expiry_status(&position, 100_000);
        assert_eq!(status, CoverageStatus::Expiring);
    }

    #[test]
    fn test_coverage_status_at_warning_boundary() {
        let position = make_position(1_000_000 * PRECISION, 1000, 100_000, 0);
        // Exactly at warning boundary: 100000 - 95000 = 5000 = EXPIRY_WARNING_BLOCKS
        let status = coverage_expiry_status(&position, 95_000);
        assert_eq!(status, CoverageStatus::Expiring);
    }

    #[test]
    fn test_coverage_status_just_before_warning() {
        let position = make_position(1_000_000 * PRECISION, 1000, 100_000, 0);
        // One block before warning: 100000 - 94999 = 5001 > EXPIRY_WARNING_BLOCKS
        let status = coverage_expiry_status(&position, 94_999);
        assert_eq!(status, CoverageStatus::Active);
    }

    // ============ Pool Sustainability Tests ============

    #[test]
    fn test_sustainability_profitable() {
        let pool = make_pool(1_000_000 * PRECISION, 300_000 * PRECISION);
        let claims = vec![
            (10_000 * PRECISION, 1000),
            (5_000 * PRECISION, 2000),
        ];
        let premium_income = 20_000 * PRECISION;
        assert!(pool_sustainability_check(&pool, &claims, premium_income));
    }

    #[test]
    fn test_sustainability_break_even() {
        let pool = make_pool(1_000_000 * PRECISION, 300_000 * PRECISION);
        let claims = vec![(15_000 * PRECISION, 1000)];
        let premium_income = 15_000 * PRECISION; // exactly covers claims
        assert!(pool_sustainability_check(&pool, &claims, premium_income));
    }

    #[test]
    fn test_sustainability_unsustainable_claims_exceed_income() {
        let pool = make_pool(1_000_000 * PRECISION, 300_000 * PRECISION);
        let claims = vec![(30_000 * PRECISION, 1000)];
        let premium_income = 10_000 * PRECISION; // claims > income
        assert!(!pool_sustainability_check(&pool, &claims, premium_income));
    }

    #[test]
    fn test_sustainability_unsustainable_high_utilization() {
        let pool = make_pool(1_000_000 * PRECISION, 900_000 * PRECISION); // 90%
        let claims: Vec<(u128, u64)> = vec![];
        let premium_income = 100_000 * PRECISION;
        assert!(!pool_sustainability_check(&pool, &claims, premium_income));
    }

    #[test]
    fn test_sustainability_single_large_claim() {
        let pool = make_pool(1_000_000 * PRECISION, 300_000 * PRECISION);
        // One claim > 50% of deposits
        let claims = vec![(600_000 * PRECISION, 1000)];
        let premium_income = 700_000 * PRECISION;
        assert!(!pool_sustainability_check(&pool, &claims, premium_income));
    }

    #[test]
    fn test_sustainability_empty_pool() {
        let pool = make_pool(0, 0);
        let claims: Vec<(u128, u64)> = vec![];
        let premium_income = 0;
        assert!(!pool_sustainability_check(&pool, &claims, premium_income));
    }

    #[test]
    fn test_sustainability_no_claims() {
        let pool = make_pool(1_000_000 * PRECISION, 300_000 * PRECISION);
        let claims: Vec<(u128, u64)> = vec![];
        let premium_income = 50_000 * PRECISION;
        assert!(pool_sustainability_check(&pool, &claims, premium_income));
    }

    // ============ Optimal Coverage Amount Tests ============

    #[test]
    fn test_optimal_coverage_conservative() {
        let tier = make_tier(0, 2000, 10_000); // max 20% payout
        let lp_value = 1_000_000 * PRECISION;
        let tolerance = 200; // 2% tolerance
        let optimal = optimal_coverage_amount(lp_value, tolerance, &tier);
        // (2000 - 200) / 2000 * 1M = 90% of 1M = 900K
        assert_eq!(optimal, 900_000 * PRECISION);
    }

    #[test]
    fn test_optimal_coverage_aggressive() {
        let tier = make_tier(0, 2000, 10_000);
        let lp_value = 1_000_000 * PRECISION;
        let tolerance = 1500; // 15% tolerance — very aggressive
        let optimal = optimal_coverage_amount(lp_value, tolerance, &tier);
        // (2000 - 1500) / 2000 * 1M = 25% of 1M = 250K
        assert_eq!(optimal, 250_000 * PRECISION);
    }

    #[test]
    fn test_optimal_coverage_zero_tolerance() {
        let tier = make_tier(0, 2000, 10_000);
        let lp_value = 1_000_000 * PRECISION;
        let optimal = optimal_coverage_amount(lp_value, 0, &tier);
        // Full coverage = 100% of LP value
        assert_eq!(optimal, lp_value);
    }

    #[test]
    fn test_optimal_coverage_tolerance_exceeds_max() {
        let tier = make_tier(0, 2000, 10_000);
        let lp_value = 1_000_000 * PRECISION;
        let optimal = optimal_coverage_amount(lp_value, 3000, &tier);
        // Tolerance > max payout → no coverage needed
        assert_eq!(optimal, 0);
    }

    #[test]
    fn test_optimal_coverage_tolerance_equals_max() {
        let tier = make_tier(0, 2000, 10_000);
        let lp_value = 1_000_000 * PRECISION;
        let optimal = optimal_coverage_amount(lp_value, 2000, &tier);
        assert_eq!(optimal, 0);
    }

    // ============ Aggregate Pool Stats Tests ============

    #[test]
    fn test_aggregate_empty() {
        let (d, c, u) = aggregate_pool_stats(&[]);
        assert_eq!(d, 0);
        assert_eq!(c, 0);
        assert_eq!(u, 0);
    }

    #[test]
    fn test_aggregate_single_pool() {
        let pools = vec![make_pool(1_000_000 * PRECISION, 200_000 * PRECISION)];
        let (d, c, u) = aggregate_pool_stats(&pools);
        assert_eq!(d, 1_000_000 * PRECISION);
        assert_eq!(c, 200_000 * PRECISION);
        assert_eq!(u, 2000); // 20%
    }

    #[test]
    fn test_aggregate_multiple_pools() {
        let pools = vec![
            make_pool(1_000_000 * PRECISION, 200_000 * PRECISION),
            make_pool(2_000_000 * PRECISION, 600_000 * PRECISION),
            make_pool(500_000 * PRECISION, 100_000 * PRECISION),
        ];
        let (d, c, u) = aggregate_pool_stats(&pools);
        assert_eq!(d, 3_500_000 * PRECISION);
        assert_eq!(c, 900_000 * PRECISION);
        // avg util = 900K / 3.5M * 10000 ≈ 2571 bps
        assert!(u >= 2500 && u <= 2600);
    }

    #[test]
    fn test_aggregate_all_empty_pools() {
        let pools = vec![make_pool(0, 0), make_pool(0, 0)];
        let (d, c, u) = aggregate_pool_stats(&pools);
        assert_eq!(d, 0);
        assert_eq!(c, 0);
        assert_eq!(u, 0);
    }

    // ============ Claim Priority Score Tests ============

    #[test]
    fn test_claim_priority_healthy_pool() {
        let position = make_position(100_000 * PRECISION, 1000, 50_000, 0);
        let tier = make_tier(0, 2000, 10_000);
        let claim = calculate_il_claim(
            &position,
            1000 * PRECISION,
            2000 * PRECISION,
            &tier,
        ).unwrap();
        let health = PoolHealth {
            total_deposits: 10_000_000 * PRECISION,
            total_coverage: 2_000_000 * PRECISION,
            utilization_bps: 2000,
            reserve_ratio_bps: 8000,
            risk_score: 2000,
            sustainable: true,
        };
        let score = claim_priority_score(&claim, &health);
        assert!(score > 0);
    }

    #[test]
    fn test_claim_priority_stressed_pool() {
        let position = make_position(100_000 * PRECISION, 1000, 50_000, 0);
        let tier = make_tier(0, 2000, 10_000);
        let claim = calculate_il_claim(
            &position,
            1000 * PRECISION,
            2000 * PRECISION,
            &tier,
        ).unwrap();

        let healthy = PoolHealth {
            total_deposits: 10_000_000 * PRECISION,
            total_coverage: 2_000_000 * PRECISION,
            utilization_bps: 2000,
            reserve_ratio_bps: 8000,
            risk_score: 2000,
            sustainable: true,
        };
        let stressed = PoolHealth {
            total_deposits: 10_000_000 * PRECISION,
            total_coverage: 9_000_000 * PRECISION,
            utilization_bps: 9000,
            reserve_ratio_bps: 1000,
            risk_score: 9200,
            sustainable: false,
        };

        let score_healthy = claim_priority_score(&claim, &healthy);
        let score_stressed = claim_priority_score(&claim, &stressed);
        // Stressed pool should give different priority score
        assert_ne!(score_healthy, score_stressed);
    }

    #[test]
    fn test_claim_priority_higher_il_gets_priority() {
        let pos_low = make_position(100_000 * PRECISION, 1000, 50_000, 0);
        let pos_high = make_position(100_000 * PRECISION, 1000, 50_000, 0);
        let tier = make_tier(0, 5000, 10_000);

        let claim_low = calculate_il_claim(
            &pos_low,
            1000 * PRECISION,
            1200 * PRECISION, // small move
            &tier,
        ).unwrap();
        let claim_high = calculate_il_claim(
            &pos_high,
            1000 * PRECISION,
            4000 * PRECISION, // large move
            &tier,
        ).unwrap();

        let health = PoolHealth {
            total_deposits: 10_000_000 * PRECISION,
            total_coverage: 3_000_000 * PRECISION,
            utilization_bps: 3000,
            reserve_ratio_bps: 7000,
            risk_score: 3000,
            sustainable: true,
        };

        let score_low = claim_priority_score(&claim_low, &health);
        let score_high = claim_priority_score(&claim_high, &health);
        assert!(score_high > score_low);
    }

    #[test]
    fn test_claim_priority_zero_il() {
        let position = make_position(100_000 * PRECISION, 1000, 50_000, 0);
        let tier = make_tier(0, 2000, 10_000);
        let claim = calculate_il_claim(
            &position,
            1000 * PRECISION,
            1000 * PRECISION,
            &tier,
        ).unwrap();
        let health = PoolHealth {
            total_deposits: 10_000_000 * PRECISION,
            total_coverage: 2_000_000 * PRECISION,
            utilization_bps: 2000,
            reserve_ratio_bps: 8000,
            risk_score: 2000,
            sustainable: true,
        };
        let score = claim_priority_score(&claim, &health);
        // Should still have a base score from efficiency + urgency
        assert!(score > 0);
    }

    // ============ Integration / Edge Case Tests ============

    #[test]
    fn test_full_lifecycle() {
        // 1. Create pool
        let pool = make_pool(10_000_000 * PRECISION, 0);

        // 2. Quote premium
        let tier = make_tier(0, 2000, 10_000);
        let quote = calculate_premium(
            &pool,
            500_000 * PRECISION,
            50_000,
            &tier,
        ).unwrap();
        assert!(quote.premium_amount > 0);

        // 3. Create position
        let position = make_position(500_000 * PRECISION, 1000, 51_000, 0);

        // 4. Check status — should be active
        assert_eq!(coverage_expiry_status(&position, 2000), CoverageStatus::Active);

        // 5. Validate claim after cooldown
        assert!(validate_claim(&position, 3000, DEFAULT_COOLDOWN_BLOCKS).is_ok());

        // 6. Calculate IL claim
        let claim = calculate_il_claim(
            &position,
            1000 * PRECISION,
            2000 * PRECISION,
            &tier,
        ).unwrap();
        assert!(claim.claimable_amount > 0);

        // 7. Pool health after payout
        let pool_after = make_pool(
            10_000_000 * PRECISION - claim.claimable_amount + quote.premium_amount,
            500_000 * PRECISION,
        );
        let health = pool_health(&pool_after);
        assert!(health.sustainable);
    }

    #[test]
    fn test_extreme_price_ratios() {
        let position = make_position(1_000_000 * PRECISION, 100, 100_000, 0);
        let tier = make_tier(0, 9000, 10_000); // 90% max payout for testing

        // 100x price increase
        let claim = calculate_il_claim(
            &position,
            1 * PRECISION,
            100 * PRECISION,
            &tier,
        ).unwrap();
        // IL for 100x ≈ 81.8%
        assert!(claim.actual_il_bps > 8000);
        assert!(claim.actual_il_bps <= 8500);
    }

    #[test]
    fn test_all_tiers_premium_ordering() {
        let pool = make_pool(10_000_000 * PRECISION, 1_000_000 * PRECISION);
        let tiers = vec![
            make_tier(0, 1000, 10_000),  // basic: 1x
            make_tier(1, 2000, 15_000),  // standard: 1.5x
            make_tier(2, 3000, 20_000),  // enhanced: 2x
            make_tier(3, 4000, 25_000),  // premium: 2.5x
            make_tier(4, 5000, 30_000),  // ultimate: 3x
        ];

        let mut prev_premium = 0u128;
        for tier in &tiers {
            let quote = calculate_premium(
                &pool,
                100_000 * PRECISION,
                10_000,
                tier,
            ).unwrap();
            assert!(
                quote.premium_amount >= prev_premium,
                "tier {} premium {} should >= prev {}",
                tier.tier_id, quote.premium_amount, prev_premium
            );
            prev_premium = quote.premium_amount;
        }
    }

    #[test]
    fn test_pool_health_risk_score_monotonic() {
        // Risk score should increase monotonically with utilization
        let mut prev_score = 0u16;
        for util_pct in 0..=100 {
            let coverage = (util_pct as u128) * 10_000 * PRECISION;
            let pool = make_pool(1_000_000 * PRECISION, coverage);
            let health = pool_health(&pool);
            assert!(
                health.risk_score >= prev_score,
                "risk_score should increase: {} < {} at util={}%",
                health.risk_score, prev_score, util_pct
            );
            prev_score = health.risk_score;
        }
    }

    #[test]
    fn test_available_coverage_consistency() {
        // available_coverage + total_coverage should equal max_total
        let pool = make_pool(1_000_000 * PRECISION, 350_000 * PRECISION);
        let avail = available_coverage(&pool);
        let max_total = mul_div(pool.total_deposits, pool.max_coverage_ratio_bps as u128, 10_000);
        assert_eq!(avail + pool.total_coverage, max_total);
    }

    #[test]
    fn test_payout_never_exceeds_coverage() {
        let tier = make_tier(0, 10_000, 10_000); // 100% max payout
        for il in (0..=10_000u16).step_by(500) {
            let coverage = 1_000_000 * PRECISION;
            let payout = estimate_payout(coverage, il, &tier);
            assert!(payout <= coverage, "payout {} > coverage {} at il_bps={}", payout, coverage, il);
        }
    }

    #[test]
    fn test_il_symmetry() {
        // IL should be roughly symmetric for inverse price ratios
        let position = make_position(1_000_000 * PRECISION, 100, 100_000, 0);
        let tier = make_tier(0, 5000, 10_000);

        let claim_up = calculate_il_claim(
            &position,
            1000 * PRECISION,
            3000 * PRECISION, // 3x up
            &tier,
        ).unwrap();

        let claim_down = calculate_il_claim(
            &position,
            3000 * PRECISION,
            1000 * PRECISION, // 3x down (1/3 ratio)
            &tier,
        ).unwrap();

        // IL should be identical for k and 1/k ratios
        // Allow small rounding difference
        let diff = if claim_up.actual_il_bps > claim_down.actual_il_bps {
            claim_up.actual_il_bps - claim_down.actual_il_bps
        } else {
            claim_down.actual_il_bps - claim_up.actual_il_bps
        };
        assert!(diff <= 2, "IL asymmetry too large: up={}, down={}, diff={}",
            claim_up.actual_il_bps, claim_down.actual_il_bps, diff);
    }

    // ============ Additional Edge Case Tests ============

    // --- Premium calculation edge cases ---

    #[test]
    fn test_premium_zero_cooldown_pool() {
        // Pool with cooldown_blocks = 0 should use reference_blocks = 1
        let mut pool = make_pool(1_000_000 * PRECISION, 0);
        pool.cooldown_blocks = 0;
        let tier = make_tier(0, 2000, 10_000);
        let quote = calculate_premium(&pool, 100_000 * PRECISION, 10_000, &tier).unwrap();
        assert!(quote.premium_amount > 0);
    }

    #[test]
    fn test_premium_exact_min_duration_boundary() {
        // Duration exactly equal to min_duration_blocks should succeed
        let pool = make_pool(1_000_000 * PRECISION, 0);
        let tier = make_tier(0, 2000, 10_000); // min_duration_blocks = 100
        let result = calculate_premium(&pool, 100_000 * PRECISION, 100, &tier);
        assert!(result.is_ok());
    }

    #[test]
    fn test_premium_one_below_min_duration() {
        let pool = make_pool(1_000_000 * PRECISION, 0);
        let tier = make_tier(0, 2000, 10_000); // min_duration_blocks = 100
        let result = calculate_premium(&pool, 100_000 * PRECISION, 99, &tier);
        assert_eq!(result, Err(InsuranceError::InvalidPremium));
    }

    #[test]
    fn test_premium_effective_rate_clamped_to_min() {
        // Very low base rate + very low multiplier should clamp to MIN_PREMIUM_RATE_BPS
        let mut pool = make_pool(1_000_000 * PRECISION, 0);
        pool.premium_rate_bps = 1; // 0.01% base
        let tier = make_tier(0, 2000, 1_000); // 0.1x multiplier
        let quote = calculate_premium(&pool, 100_000 * PRECISION, 10_000, &tier).unwrap();
        assert!(quote.effective_rate_bps >= MIN_PREMIUM_RATE_BPS);
    }

    #[test]
    fn test_premium_effective_rate_clamped_to_max() {
        // High base rate + high multiplier + high utilization should clamp to MAX
        let pool = make_pool(1_000_000 * PRECISION, 700_000 * PRECISION);
        let tier = make_tier(0, 2000, 50_000); // 5x multiplier
        let quote = calculate_premium(&pool, 10_000 * PRECISION, 10_000, &tier).unwrap();
        assert!(quote.effective_rate_bps <= MAX_PREMIUM_RATE_BPS);
    }

    #[test]
    fn test_premium_coverage_exactly_fills_pool() {
        // Request exactly the remaining available coverage
        let pool = make_pool(1_000_000 * PRECISION, 700_000 * PRECISION);
        let avail = available_coverage(&pool);
        let tier = make_tier(0, 2000, 10_000);
        let result = calculate_premium(&pool, avail, 10_000, &tier);
        assert!(result.is_ok());
    }

    #[test]
    fn test_premium_coverage_one_over_capacity() {
        // Request one unit more than available
        let pool = make_pool(1_000_000 * PRECISION, 700_000 * PRECISION);
        let avail = available_coverage(&pool);
        let tier = make_tier(0, 2000, 10_000);
        let result = calculate_premium(&pool, avail + 1, 10_000, &tier);
        assert_eq!(result, Err(InsuranceError::PoolFull));
    }

    #[test]
    fn test_premium_tier_id_at_max_boundary() {
        // tier_id = MAX_TIERS - 1 = 4 should succeed
        let pool = make_pool(1_000_000 * PRECISION, 0);
        let tier = make_tier(4, 2000, 10_000);
        let result = calculate_premium(&pool, 100_000 * PRECISION, 10_000, &tier);
        assert!(result.is_ok());
    }

    #[test]
    fn test_premium_tier_id_just_over_max() {
        // tier_id = MAX_TIERS = 5 should fail
        let pool = make_pool(1_000_000 * PRECISION, 0);
        let tier = make_tier(5, 2000, 10_000);
        let result = calculate_premium(&pool, 100_000 * PRECISION, 10_000, &tier);
        assert_eq!(result, Err(InsuranceError::InvalidTier));

        // tier_id = 6 should also fail
        let tier6 = make_tier(6, 2000, 10_000);
        let result6 = calculate_premium(&pool, 100_000 * PRECISION, 10_000, &tier6);
        assert_eq!(result6, Err(InsuranceError::InvalidTier));
    }

    // --- IL Claim edge cases ---

    #[test]
    fn test_il_claim_both_prices_zero() {
        let position = make_position(1_000_000 * PRECISION, 100, 100_000, 0);
        let tier = make_tier(0, 2000, 10_000);
        let result = calculate_il_claim(&position, 0, 0, &tier);
        assert_eq!(result, Err(InsuranceError::NoActiveCoverage));
    }

    #[test]
    fn test_il_claim_very_small_price_ratio() {
        // entry = 1000000, current = 999999 — nearly identical
        let position = make_position(1_000_000 * PRECISION, 100, 100_000, 0);
        let tier = make_tier(0, 2000, 10_000);
        let claim = calculate_il_claim(
            &position,
            1_000_000 * PRECISION,
            999_999 * PRECISION,
            &tier,
        ).unwrap();
        // IL should be essentially zero for a 0.0001% change
        assert!(claim.actual_il_bps <= 1);
    }

    #[test]
    fn test_il_claim_price_ratio_100x_down() {
        // price drops 100x
        let position = make_position(1_000_000 * PRECISION, 100, 100_000, 0);
        let tier = make_tier(0, 9000, 10_000);
        let claim = calculate_il_claim(
            &position,
            100 * PRECISION,
            1 * PRECISION,
            &tier,
        ).unwrap();
        // IL for 1/100 ratio should be same as 100x up ≈ 81.8%
        assert!(claim.actual_il_bps > 8000);
        assert!(claim.actual_il_bps <= 8500);
    }

    #[test]
    fn test_il_claim_covered_amount_zero() {
        let position = make_position(0, 100, 100_000, 0);
        let tier = make_tier(0, 2000, 10_000);
        let claim = calculate_il_claim(
            &position,
            1000 * PRECISION,
            2000 * PRECISION,
            &tier,
        ).unwrap();
        // Zero covered amount means zero payout regardless of IL
        assert_eq!(claim.claimable_amount, 0);
        assert_eq!(claim.payout_ratio_bps, 0);
    }

    #[test]
    fn test_il_claim_max_payout_bps_zero() {
        // Tier with 0 max payout should always yield 0 claimable
        let position = make_position(1_000_000 * PRECISION, 100, 100_000, 0);
        let tier = make_tier(0, 0, 10_000);
        let claim = calculate_il_claim(
            &position,
            1000 * PRECISION,
            4000 * PRECISION,
            &tier,
        ).unwrap();
        assert_eq!(claim.claimable_amount, 0);
    }

    #[test]
    fn test_il_claim_payout_exactly_at_tier_cap() {
        // When IL bps exactly equals tier max_payout_bps, payout should equal max
        let position = make_position(1_000_000 * PRECISION, 100, 100_000, 0);
        // Use a tier cap of 572 bps (roughly the IL for 2x price)
        let tier = make_tier(0, 572, 10_000);
        let claim = calculate_il_claim(
            &position,
            1000 * PRECISION,
            2000 * PRECISION,
            &tier,
        ).unwrap();
        let max_payout = mul_div(position.covered_amount, 572, 10_000);
        assert!(claim.claimable_amount <= max_payout);
    }

    // --- Validate claim edge cases ---

    #[test]
    fn test_validate_claim_one_block_before_cooldown_end() {
        let position = make_position(1_000_000 * PRECISION, 1000, 50_000, 0);
        // cooldown_end = 1000 + 1000 = 2000, check at 1999
        let result = validate_claim(&position, 1999, DEFAULT_COOLDOWN_BLOCKS);
        assert_eq!(result, Err(InsuranceError::CooldownActive));
    }

    #[test]
    fn test_validate_claim_one_block_after_expiry() {
        let position = make_position(1_000_000 * PRECISION, 1000, 50_000, 0);
        let result = validate_claim(&position, 50_001, DEFAULT_COOLDOWN_BLOCKS);
        assert_eq!(result, Err(InsuranceError::ClaimExpired));
    }

    #[test]
    fn test_validate_claim_start_block_overflow_saturates() {
        // start_block near u64::MAX, cooldown should saturate
        let position = make_position(1_000_000 * PRECISION, u64::MAX - 500, u64::MAX, 0);
        // cooldown_end = saturating_add(u64::MAX - 500, 1000) = u64::MAX
        // current_block = u64::MAX should be ok (>= u64::MAX)
        let result = validate_claim(&position, u64::MAX, DEFAULT_COOLDOWN_BLOCKS);
        assert_eq!(result, Ok(()));
    }

    #[test]
    fn test_validate_claim_expired_and_cooldown_both_fail() {
        // Position that is both expired and still in cooldown
        // start_block=1000, expiry=1500, cooldown=1000 -> cooldown_end=2000
        // At block 1600: expired (1600 > 1500)
        let position = make_position(1_000_000 * PRECISION, 1000, 1500, 0);
        let result = validate_claim(&position, 1600, DEFAULT_COOLDOWN_BLOCKS);
        // Should hit expired check first
        assert_eq!(result, Err(InsuranceError::ClaimExpired));
    }

    #[test]
    fn test_validate_claim_large_cooldown() {
        let position = make_position(1_000_000 * PRECISION, 0, u64::MAX, 0);
        // Very large cooldown
        let result = validate_claim(&position, 999_999, 1_000_000);
        assert_eq!(result, Err(InsuranceError::CooldownActive));
        // Exactly at cooldown end
        let result2 = validate_claim(&position, 1_000_000, 1_000_000);
        assert_eq!(result2, Ok(()));
    }

    // --- Pool health edge cases ---

    #[test]
    fn test_pool_health_exactly_60_percent() {
        // 60% utilization is the boundary for accelerated risk scoring
        let pool = make_pool(1_000_000 * PRECISION, 600_000 * PRECISION);
        let health = pool_health(&pool);
        assert_eq!(health.utilization_bps, 6000);
        // At exactly 6000, should use linear scoring (score = 6000)
        assert_eq!(health.risk_score, 6000);
        assert!(health.sustainable);
    }

    #[test]
    fn test_pool_health_exactly_100_percent() {
        let pool = make_pool(1_000_000 * PRECISION, 1_000_000 * PRECISION);
        let health = pool_health(&pool);
        assert_eq!(health.utilization_bps, 10_000);
        assert_eq!(health.reserve_ratio_bps, 0);
        assert_eq!(health.risk_score, 10_000);
        assert!(!health.sustainable);
    }

    #[test]
    fn test_pool_health_just_above_60_percent() {
        // 61% should trigger accelerated scoring
        let pool = make_pool(10_000 * PRECISION, 6_100 * PRECISION);
        let health = pool_health(&pool);
        assert_eq!(health.utilization_bps, 6100);
        // Accelerated: 6000 + (100 * 125 / 100) = 6000 + 125 = 6125
        assert_eq!(health.risk_score, 6125);
    }

    #[test]
    fn test_pool_health_at_80_percent_boundary() {
        // Exactly 80% is the start of the critical zone
        // 8000 bps, but it's >= 8000 so it goes into the else branch
        let pool = make_pool(1_000_000 * PRECISION, 800_000 * PRECISION);
        let health = pool_health(&pool);
        assert_eq!(health.utilization_bps, 8000);
        // 8000 is in range >8000? No, it's <=8000, so it uses the 6000-8000 branch
        // excess = 8000 - 6000 = 2000, penalty = 2000*125/100 = 2500
        // risk_score = 6000 + 2500 = 8500
        assert_eq!(health.risk_score, 8500);
    }

    #[test]
    fn test_pool_health_at_81_percent() {
        // 8100 bps is in the critical zone (>8000)
        let pool = make_pool(10_000 * PRECISION, 8_100 * PRECISION);
        let health = pool_health(&pool);
        assert_eq!(health.utilization_bps, 8100);
        // Critical: excess = 8100-8000 = 100, penalty = 100*75/100 = 75
        // risk_score = 8500 + 75 = 8575
        assert_eq!(health.risk_score, 8575);
    }

    #[test]
    fn test_pool_health_reserve_ratio_matches_utilization() {
        // reserve_ratio + utilization should always equal 10000 (when util <= 10000)
        for util_pct in (0..=100).step_by(5) {
            let coverage = (util_pct as u128) * 10_000 * PRECISION;
            let pool = make_pool(1_000_000 * PRECISION, coverage);
            let health = pool_health(&pool);
            if health.utilization_bps <= 10_000 {
                assert_eq!(
                    health.utilization_bps as u32 + health.reserve_ratio_bps as u32,
                    10_000,
                    "reserve + util != 10000 at {}%", util_pct
                );
            }
        }
    }

    // --- Available coverage edge cases ---

    #[test]
    fn test_available_coverage_custom_max_ratio() {
        let mut pool = make_pool(1_000_000 * PRECISION, 0);
        pool.max_coverage_ratio_bps = 5000; // 50% max
        let avail = available_coverage(&pool);
        assert_eq!(avail, 500_000 * PRECISION);
    }

    #[test]
    fn test_available_coverage_zero_max_ratio() {
        let mut pool = make_pool(1_000_000 * PRECISION, 0);
        pool.max_coverage_ratio_bps = 0;
        let avail = available_coverage(&pool);
        assert_eq!(avail, 0);
    }

    // --- Dynamic premium rate edge cases ---

    #[test]
    fn test_dynamic_premium_base_at_min() {
        let rate = dynamic_premium_rate(MIN_PREMIUM_RATE_BPS, 0);
        assert_eq!(rate, MIN_PREMIUM_RATE_BPS);
    }

    #[test]
    fn test_dynamic_premium_base_at_max() {
        let rate = dynamic_premium_rate(MAX_PREMIUM_RATE_BPS, 0);
        assert_eq!(rate, MAX_PREMIUM_RATE_BPS);
    }

    #[test]
    fn test_dynamic_premium_over_100_percent_utilization() {
        // Edge case: utilization > 10000 bps (shouldn't happen but test robustness)
        let rate = dynamic_premium_rate(100, 15_000);
        // rate = 100 + 100*2*15000/10000 = 100 + 300 = 400
        assert_eq!(rate, 400);
    }

    // --- Estimate payout edge cases ---

    #[test]
    fn test_estimate_payout_max_payout_bps_zero() {
        let tier = make_tier(0, 0, 10_000);
        let payout = estimate_payout(1_000_000 * PRECISION, 500, &tier);
        assert_eq!(payout, 0);
    }

    #[test]
    fn test_estimate_payout_il_bps_max() {
        // 100% IL (theoretical max)
        let tier = make_tier(0, 10_000, 10_000);
        let coverage = 1_000_000 * PRECISION;
        let payout = estimate_payout(coverage, 10_000, &tier);
        assert_eq!(payout, coverage);
    }

    #[test]
    fn test_estimate_payout_one_wei_coverage() {
        let tier = make_tier(0, 5000, 10_000);
        let payout = estimate_payout(1, 5000, &tier);
        // 1 * 5000 / 10000 = 0 (integer division)
        assert_eq!(payout, 0);
    }

    // --- Coverage expiry edge cases ---

    #[test]
    fn test_coverage_status_current_block_zero() {
        let position = make_position(1_000_000 * PRECISION, 0, 100_000, 0);
        let status = coverage_expiry_status(&position, 0);
        // 100000 - 0 = 100000 > EXPIRY_WARNING_BLOCKS (5000), so Active
        assert_eq!(status, CoverageStatus::Active);
    }

    #[test]
    fn test_coverage_status_expiry_block_zero() {
        let position = make_position(1_000_000 * PRECISION, 0, 0, 0);
        // current_block=0: not expired (0 > 0 is false)
        // 0.saturating_sub(0) = 0 <= 5000, so Expiring
        let status = coverage_expiry_status(&position, 0);
        assert_eq!(status, CoverageStatus::Expiring);
    }

    #[test]
    fn test_coverage_status_immediately_expired() {
        let position = make_position(1_000_000 * PRECISION, 0, 0, 0);
        // current_block=1 > expiry_block=0
        let status = coverage_expiry_status(&position, 1);
        assert_eq!(status, CoverageStatus::Expired);
    }

    // --- Sustainability edge cases ---

    #[test]
    fn test_sustainability_claim_exactly_half_deposits() {
        // Claim exactly at 50% of deposits — should pass (> not >=)
        let pool = make_pool(1_000_000 * PRECISION, 300_000 * PRECISION);
        let half = pool.total_deposits / 2;
        let claims = vec![(half, 1000)];
        let premium_income = half + 1;
        assert!(pool_sustainability_check(&pool, &claims, premium_income));
    }

    #[test]
    fn test_sustainability_claim_one_over_half_deposits() {
        let pool = make_pool(1_000_000 * PRECISION, 300_000 * PRECISION);
        let half = pool.total_deposits / 2;
        let claims = vec![(half + 1, 1000)];
        let premium_income = half + 2;
        assert!(!pool_sustainability_check(&pool, &claims, premium_income));
    }

    #[test]
    fn test_sustainability_many_small_claims() {
        let pool = make_pool(1_000_000 * PRECISION, 300_000 * PRECISION);
        // 100 small claims, none exceeding 50%
        let claims: Vec<(u128, u64)> = (0..100).map(|i| (100 * PRECISION, i as u64)).collect();
        // Total claims = 10000 * PRECISION
        let premium_income = 10_000 * PRECISION;
        assert!(pool_sustainability_check(&pool, &claims, premium_income));
    }

    #[test]
    fn test_sustainability_zero_income_zero_claims() {
        let pool = make_pool(1_000_000 * PRECISION, 300_000 * PRECISION);
        let claims: Vec<(u128, u64)> = vec![];
        let premium_income = 0;
        // No claims, no income, but pool is healthy -> sustainable
        assert!(pool_sustainability_check(&pool, &claims, premium_income));
    }

    #[test]
    fn test_sustainability_at_max_coverage_ratio() {
        // Pool at exactly max coverage ratio: utilization = 8000, NOT sustainable
        let pool = make_pool(1_000_000 * PRECISION, 800_000 * PRECISION);
        let claims: Vec<(u128, u64)> = vec![];
        let premium_income = 100_000 * PRECISION;
        assert!(!pool_sustainability_check(&pool, &claims, premium_income));
    }

    // --- Optimal coverage edge cases ---

    #[test]
    fn test_optimal_coverage_lp_value_zero() {
        let tier = make_tier(0, 2000, 10_000);
        let optimal = optimal_coverage_amount(0, 500, &tier);
        assert_eq!(optimal, 0);
    }

    #[test]
    fn test_optimal_coverage_tolerance_one_below_max() {
        let tier = make_tier(0, 2000, 10_000);
        let lp_value = 1_000_000 * PRECISION;
        let optimal = optimal_coverage_amount(lp_value, 1999, &tier);
        // (2000 - 1999) / 2000 * 1M = 0.05% = 500
        assert_eq!(optimal, mul_div(lp_value, 1, 2000));
    }

    // --- Aggregate stats edge cases ---

    #[test]
    fn test_aggregate_mixed_empty_and_full_pools() {
        let pools = vec![
            make_pool(0, 0),
            make_pool(1_000_000 * PRECISION, 500_000 * PRECISION),
            make_pool(0, 0),
        ];
        let (d, c, u) = aggregate_pool_stats(&pools);
        assert_eq!(d, 1_000_000 * PRECISION);
        assert_eq!(c, 500_000 * PRECISION);
        assert_eq!(u, 5000); // 50%
    }

    #[test]
    fn test_aggregate_all_full_pools() {
        let pools = vec![
            make_pool(100 * PRECISION, 100 * PRECISION),
            make_pool(200 * PRECISION, 200 * PRECISION),
        ];
        let (d, c, u) = aggregate_pool_stats(&pools);
        assert_eq!(d, 300 * PRECISION);
        assert_eq!(c, 300 * PRECISION);
        assert_eq!(u, 10_000); // 100%
    }

    // --- Claim priority score edge cases ---

    #[test]
    fn test_claim_priority_critical_pool_risk_score_10000() {
        let claim = ILClaim {
            position: make_position(100_000 * PRECISION, 1000, 50_000, 0),
            actual_il_bps: 2000,
            claimable_amount: 20_000 * PRECISION,
            payout_ratio_bps: 2000,
        };
        let health = PoolHealth {
            total_deposits: 1_000_000 * PRECISION,
            total_coverage: 1_000_000 * PRECISION,
            utilization_bps: 10_000,
            reserve_ratio_bps: 0,
            risk_score: 10_000,
            sustainable: false,
        };
        let score = claim_priority_score(&claim, &health);
        assert!(score > 0);
        // urgency should be at max 3000
    }

    #[test]
    fn test_claim_priority_risk_score_exactly_5000() {
        let claim = ILClaim {
            position: make_position(100_000 * PRECISION, 1000, 50_000, 0),
            actual_il_bps: 500,
            claimable_amount: 5_000 * PRECISION,
            payout_ratio_bps: 500,
        };
        let health = PoolHealth {
            total_deposits: 10_000_000 * PRECISION,
            total_coverage: 5_000_000 * PRECISION,
            utilization_bps: 5000,
            reserve_ratio_bps: 5000,
            risk_score: 5000,
            sustainable: true,
        };
        let score = claim_priority_score(&claim, &health);
        // risk_score = 5000, NOT > 5000, so urgency_weight = 1000 (healthy)
        // il_severity = 500 * 4000 / 10000 = 200
        // efficiency: small claim relative to large pool, should be near 3000
        assert!(score > 0);
    }

    #[test]
    fn test_claim_priority_risk_score_exactly_8000() {
        let claim = ILClaim {
            position: make_position(100_000 * PRECISION, 1000, 50_000, 0),
            actual_il_bps: 1000,
            claimable_amount: 10_000 * PRECISION,
            payout_ratio_bps: 1000,
        };
        let health = PoolHealth {
            total_deposits: 10_000_000 * PRECISION,
            total_coverage: 8_000_000 * PRECISION,
            utilization_bps: 8000,
            reserve_ratio_bps: 2000,
            risk_score: 8000,
            sustainable: false,
        };
        let score = claim_priority_score(&claim, &health);
        // risk_score = 8000, NOT > 8000, but > 5000 -> moderate stress
        // stress_factor = (8000-5000)*1500/3000 = 1500
        assert!(score > 0);
    }

    #[test]
    fn test_claim_priority_zero_deposits_pool() {
        let claim = ILClaim {
            position: make_position(100_000 * PRECISION, 1000, 50_000, 0),
            actual_il_bps: 500,
            claimable_amount: 5_000 * PRECISION,
            payout_ratio_bps: 500,
        };
        let health = PoolHealth {
            total_deposits: 0,
            total_coverage: 0,
            utilization_bps: 0,
            reserve_ratio_bps: 10_000,
            risk_score: 0,
            sustainable: true,
        };
        let score = claim_priority_score(&claim, &health);
        // efficiency_weight = 1500 (neutral for zero deposits)
        // urgency_weight = 1000 (healthy)
        // il_severity = 500*4000/10000 = 200
        assert_eq!(score, 200 + 1500 + 1000);
    }

    #[test]
    fn test_claim_priority_zero_claimable_amount() {
        let claim = ILClaim {
            position: make_position(100_000 * PRECISION, 1000, 50_000, 0),
            actual_il_bps: 0,
            claimable_amount: 0,
            payout_ratio_bps: 0,
        };
        let health = PoolHealth {
            total_deposits: 10_000_000 * PRECISION,
            total_coverage: 2_000_000 * PRECISION,
            utilization_bps: 2000,
            reserve_ratio_bps: 8000,
            risk_score: 2000,
            sustainable: true,
        };
        let score = claim_priority_score(&claim, &health);
        // il_severity = 0, but efficiency should be 1500 (neutral for zero claimable)
        // urgency = 1000
        assert_eq!(score, 0 + 1500 + 1000);
    }

    #[test]
    fn test_claim_priority_claim_larger_than_pool() {
        // Edge: claim_ratio >= 10000
        let claim = ILClaim {
            position: make_position(100_000 * PRECISION, 1000, 50_000, 0),
            actual_il_bps: 5000,
            claimable_amount: 20_000_000 * PRECISION, // larger than deposits
            payout_ratio_bps: 5000,
        };
        let health = PoolHealth {
            total_deposits: 10_000_000 * PRECISION,
            total_coverage: 9_000_000 * PRECISION,
            utilization_bps: 9000,
            reserve_ratio_bps: 1000,
            risk_score: 9200,
            sustainable: false,
        };
        let score = claim_priority_score(&claim, &health);
        // efficiency_weight = 0 (claim_ratio >= 10000)
        assert!(score > 0);
    }

    // --- Constants verification ---

    #[test]
    fn test_constants_sanity() {
        assert!(MIN_PREMIUM_RATE_BPS < MAX_PREMIUM_RATE_BPS);
        assert!(MAX_COVERAGE_RATIO_BPS <= 10_000);
        assert!(MAX_TIERS > 0);
        assert!(UTILIZATION_PREMIUM_FACTOR > 1);
        assert!(EXPIRY_WARNING_BLOCKS > 0);
        assert!(DEFAULT_COOLDOWN_BLOCKS > 0);
    }

    // --- Error type tests ---

    #[test]
    fn test_error_clone_and_debug() {
        let err = InsuranceError::InsufficientCoverage;
        let cloned = err.clone();
        assert_eq!(err, cloned);
        // Ensure Debug is implemented
        let debug_str = format!("{:?}", err);
        assert!(!debug_str.is_empty());
    }

    #[test]
    fn test_all_error_variants_distinct() {
        let errors = vec![
            InsuranceError::InsufficientCoverage,
            InsuranceError::PoolDepleted,
            InsuranceError::InvalidPremium,
            InsuranceError::ClaimTooEarly,
            InsuranceError::ClaimExpired,
            InsuranceError::NoActiveCoverage,
            InsuranceError::ExcessiveClaim,
            InsuranceError::InvalidTier,
            InsuranceError::CooldownActive,
            InsuranceError::PoolFull,
        ];
        for i in 0..errors.len() {
            for j in (i + 1)..errors.len() {
                assert_ne!(errors[i], errors[j], "errors at {} and {} should differ", i, j);
            }
        }
    }

    // --- Data type tests ---

    #[test]
    fn test_coverage_status_equality() {
        assert_eq!(CoverageStatus::Active, CoverageStatus::Active);
        assert_eq!(CoverageStatus::Expiring, CoverageStatus::Expiring);
        assert_eq!(CoverageStatus::Expired, CoverageStatus::Expired);
        assert_ne!(CoverageStatus::Active, CoverageStatus::Expired);
        assert_ne!(CoverageStatus::Expiring, CoverageStatus::Active);
    }

    #[test]
    fn test_premium_quote_fields() {
        let pool = make_pool(1_000_000 * PRECISION, 100_000 * PRECISION);
        let tier = make_tier(1, 3000, 15_000);
        let quote = calculate_premium(&pool, 200_000 * PRECISION, 5_000, &tier).unwrap();
        assert_eq!(quote.coverage_amount, 200_000 * PRECISION);
        assert_eq!(quote.duration_blocks, 5_000);
        assert_eq!(quote.tier, 1);
        assert!(quote.effective_rate_bps >= MIN_PREMIUM_RATE_BPS);
        assert!(quote.effective_rate_bps <= MAX_PREMIUM_RATE_BPS);
    }

    // ============ Hardening Batch 6: Edge Cases & Boundaries ============

    #[test]
    fn test_premium_large_coverage_amount_v4() {
        // Very large coverage amount near u128 limits (but within pool capacity)
        let pool = InsurancePool {
            pool_id: [0x01; 32],
            total_deposits: u128::MAX / 2,
            total_coverage: 0,
            utilization_bps: 0,
            premium_rate_bps: 100,
            max_coverage_ratio_bps: MAX_COVERAGE_RATIO_BPS,
            cooldown_blocks: DEFAULT_COOLDOWN_BLOCKS,
        };
        let tier = make_tier(0, 2000, 10_000);
        let coverage = u128::MAX / 10;
        let result = calculate_premium(&pool, coverage, 1_000, &tier);
        assert!(result.is_ok(), "Large coverage amount should not panic");
        assert!(result.unwrap().premium_amount > 0);
    }

    #[test]
    fn test_premium_one_block_above_min_duration() {
        let pool = make_pool(1_000_000 * PRECISION, 0);
        let tier = make_tier(0, 2000, 10_000); // min_duration_blocks = 100
        let result = calculate_premium(&pool, 100_000 * PRECISION, 101, &tier);
        assert!(result.is_ok(), "One above min duration should succeed");
    }

    #[test]
    fn test_il_claim_price_ratio_exactly_one_v4() {
        // Entry == current: IL should be exactly 0
        let position = make_position(1_000_000 * PRECISION, 100, 100_000, 0);
        let tier = make_tier(0, 5000, 10_000);
        let claim = calculate_il_claim(&position, 500 * PRECISION, 500 * PRECISION, &tier).unwrap();
        assert_eq!(claim.actual_il_bps, 0);
        assert_eq!(claim.claimable_amount, 0);
        assert_eq!(claim.payout_ratio_bps, 0);
    }

    #[test]
    fn test_il_claim_1000x_price_increase() {
        // Extreme: 1000x price increase
        let position = make_position(1_000_000 * PRECISION, 100, 100_000, 0);
        let tier = make_tier(0, 9500, 10_000);
        let claim = calculate_il_claim(
            &position,
            1 * PRECISION,
            1000 * PRECISION,
            &tier,
        ).unwrap();
        // IL for 1000x ≈ 93.7% — but capped by tier at 95%
        assert!(claim.actual_il_bps > 9000, "1000x should give very high IL: {}", claim.actual_il_bps);
        assert!(claim.claimable_amount > 0);
    }

    #[test]
    fn test_il_claim_near_zero_price_v4() {
        // Price drops to near-zero (but not zero)
        let position = make_position(1_000_000 * PRECISION, 100, 100_000, 0);
        let tier = make_tier(0, 9500, 10_000);
        let claim = calculate_il_claim(
            &position,
            1000 * PRECISION,
            1, // 1 wei — extreme drop
            &tier,
        ).unwrap();
        assert!(claim.actual_il_bps > 9000, "Near-zero price should give very high IL");
    }

    #[test]
    fn test_validate_claim_cooldown_u64_max_boundary() {
        // Start block near u64::MAX with large cooldown — should saturate
        let position = make_position(1_000_000 * PRECISION, u64::MAX - 5, u64::MAX, 0);
        // cooldown_blocks = 100, start + 100 would overflow, saturates to u64::MAX
        let result = validate_claim(&position, u64::MAX, 100);
        // current_block (MAX) >= cooldown_end (MAX) — so cooldown passed
        assert_eq!(result, Ok(()));
    }

    #[test]
    fn test_validate_claim_expiry_at_u64_max() {
        let position = make_position(1_000_000 * PRECISION, 0, u64::MAX, 0);
        // current_block = u64::MAX, expiry = u64::MAX — not expired (<=)
        let result = validate_claim(&position, u64::MAX, 0);
        assert_eq!(result, Ok(()));
    }

    #[test]
    fn test_pool_health_risk_score_at_zero_utilization() {
        let pool = make_pool(1_000_000 * PRECISION, 0);
        let health = pool_health(&pool);
        assert_eq!(health.utilization_bps, 0);
        assert_eq!(health.risk_score, 0);
        assert_eq!(health.reserve_ratio_bps, 10_000);
        assert!(health.sustainable);
    }

    #[test]
    fn test_pool_health_risk_score_at_50_percent() {
        let pool = make_pool(1_000_000 * PRECISION, 500_000 * PRECISION);
        let health = pool_health(&pool);
        assert_eq!(health.utilization_bps, 5000);
        assert_eq!(health.risk_score, 5000); // Linear region
        assert_eq!(health.reserve_ratio_bps, 5000);
    }

    #[test]
    fn test_dynamic_premium_rate_deterministic_v4() {
        let r1 = dynamic_premium_rate(100, 5000);
        let r2 = dynamic_premium_rate(100, 5000);
        assert_eq!(r1, r2, "Same inputs must produce same rate");
    }

    #[test]
    fn test_dynamic_premium_utilization_just_above_zero() {
        let rate = dynamic_premium_rate(100, 1);
        // 100 + 100 * 2 * 1 / 10000 = 100 + 0 = 100 (integer truncation)
        assert_eq!(rate, 100);
    }

    #[test]
    fn test_estimate_payout_large_coverage_v4() {
        let tier = make_tier(0, 5000, 10_000);
        let big = u128::MAX / 100;
        let payout = estimate_payout(big, 1000, &tier); // 10% IL
        let expected = mul_div(big, 1000, 10_000);
        assert_eq!(payout, expected, "Payout should equal coverage * il_bps / 10000 when below cap");
    }

    #[test]
    fn test_coverage_status_expiry_at_u64_max_v4() {
        let position = make_position(1_000_000 * PRECISION, 0, u64::MAX, 0);
        // Far in the future — should be Active
        let status = coverage_expiry_status(&position, 0);
        assert_eq!(status, CoverageStatus::Active);
    }

    #[test]
    fn test_coverage_status_near_u64_max_expiry() {
        let position = make_position(1_000_000 * PRECISION, 0, u64::MAX, 0);
        // EXPIRY_WARNING_BLOCKS (5000) before u64::MAX
        let status = coverage_expiry_status(&position, u64::MAX - EXPIRY_WARNING_BLOCKS);
        assert_eq!(status, CoverageStatus::Expiring);
    }

    #[test]
    fn test_sustainability_many_claims_under_half_deposits() {
        let pool = make_pool(1_000_000 * PRECISION, 300_000 * PRECISION);
        // 10 claims each at 49% of deposits — individually OK, total covered by income
        let claims: Vec<(u128, u64)> = (0..10)
            .map(|i| (490_000 * PRECISION, 1000 + i))
            .collect();
        let premium_income = 5_000_000 * PRECISION;
        assert!(pool_sustainability_check(&pool, &claims, premium_income));
    }

    #[test]
    fn test_sustainability_claims_equal_income_v4() {
        let pool = make_pool(1_000_000 * PRECISION, 300_000 * PRECISION);
        let claims = vec![(100_000 * PRECISION, 1000)];
        let premium_income = 100_000 * PRECISION; // exactly equal
        assert!(pool_sustainability_check(&pool, &claims, premium_income));
    }

    #[test]
    fn test_optimal_coverage_one_bps_tolerance() {
        let tier = make_tier(0, 2000, 10_000);
        let lp_value = 1_000_000 * PRECISION;
        let optimal = optimal_coverage_amount(lp_value, 1, &tier);
        // (2000 - 1) / 2000 * 1M = 99.95% of 1M
        let expected = mul_div(lp_value, 1999, 2000);
        assert_eq!(optimal, expected);
    }

    #[test]
    fn test_optimal_coverage_large_lp_value() {
        let tier = make_tier(0, 5000, 10_000);
        let big_lp = u128::MAX / 100;
        let optimal = optimal_coverage_amount(big_lp, 0, &tier);
        assert_eq!(optimal, big_lp, "Zero tolerance should give full coverage");
    }

    #[test]
    fn test_aggregate_pool_stats_two_pools_equal_v4() {
        let pools = vec![
            make_pool(500_000 * PRECISION, 100_000 * PRECISION),
            make_pool(500_000 * PRECISION, 100_000 * PRECISION),
        ];
        let (d, c, u) = aggregate_pool_stats(&pools);
        assert_eq!(d, 1_000_000 * PRECISION);
        assert_eq!(c, 200_000 * PRECISION);
        assert_eq!(u, 2000); // 20%
    }

    #[test]
    fn test_claim_priority_moderate_stress_v4() {
        let position = make_position(100_000 * PRECISION, 1000, 50_000, 0);
        let tier = make_tier(0, 2000, 10_000);
        let claim = calculate_il_claim(
            &position,
            1000 * PRECISION,
            2000 * PRECISION,
            &tier,
        ).unwrap();
        let health = PoolHealth {
            total_deposits: 10_000_000 * PRECISION,
            total_coverage: 6_000_000 * PRECISION,
            utilization_bps: 6000,
            reserve_ratio_bps: 4000,
            risk_score: 6000,
            sustainable: true,
        };
        let score = claim_priority_score(&claim, &health);
        assert!(score > 0, "Moderate stress pool should still produce a score");
    }

    #[test]
    fn test_available_coverage_large_deposits_v4() {
        let pool = InsurancePool {
            pool_id: [0x01; 32],
            total_deposits: u128::MAX / 2,
            total_coverage: 0,
            utilization_bps: 0,
            premium_rate_bps: 100,
            max_coverage_ratio_bps: MAX_COVERAGE_RATIO_BPS,
            cooldown_blocks: DEFAULT_COOLDOWN_BLOCKS,
        };
        let avail = available_coverage(&pool);
        // 80% of u128::MAX/2
        let expected = mul_div(u128::MAX / 2, MAX_COVERAGE_RATIO_BPS as u128, 10_000);
        assert_eq!(avail, expected);
    }

    #[test]
    fn test_pool_health_risk_score_at_70_percent_v4() {
        let pool = make_pool(1_000_000 * PRECISION, 700_000 * PRECISION);
        let health = pool_health(&pool);
        assert_eq!(health.utilization_bps, 7000);
        // 70% is in the 60-80% accelerated zone: 6000 + (1000 * 125 / 100) = 6000 + 1250 = 7250
        assert_eq!(health.risk_score, 7250);
    }

    #[test]
    fn test_estimate_payout_il_exactly_at_cap_v4() {
        let tier = make_tier(0, 3000, 10_000); // 30% max payout
        let coverage = 1_000_000 * PRECISION;
        let payout = estimate_payout(coverage, 3000, &tier); // IL = 30% = cap
        let expected = mul_div(coverage, 3000, 10_000);
        assert_eq!(payout, expected, "IL exactly at cap should pay the cap amount");
    }

    #[test]
    fn test_il_claim_tiny_covered_amount_v4() {
        // Covered amount of 1 — payout could round to 0
        let position = make_position(1, 100, 100_000, 0);
        let tier = make_tier(0, 2000, 10_000);
        let claim = calculate_il_claim(
            &position,
            1000 * PRECISION,
            2000 * PRECISION,
            &tier,
        ).unwrap();
        // At IL ~5.72% of covered_amount=1, payout rounds to 0
        assert_eq!(claim.claimable_amount, 0, "Tiny covered amount payout should round to 0");
    }

    #[test]
    fn test_premium_deterministic_v4() {
        let pool = make_pool(1_000_000 * PRECISION, 200_000 * PRECISION);
        let tier = make_tier(0, 2000, 10_000);
        let q1 = calculate_premium(&pool, 50_000 * PRECISION, 5_000, &tier).unwrap();
        let q2 = calculate_premium(&pool, 50_000 * PRECISION, 5_000, &tier).unwrap();
        assert_eq!(q1.premium_amount, q2.premium_amount, "Same inputs must produce same premium");
        assert_eq!(q1.effective_rate_bps, q2.effective_rate_bps);
    }
}
