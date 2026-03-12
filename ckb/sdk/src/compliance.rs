// ============ Compliance — KYC, Sanctions & Regulatory Controls ============
// Regulatory compliance module for VibeSwap on CKB. Handles KYC verification,
// sanctions screening, transaction limits, and jurisdiction checks.
//
// Key capabilities:
// - KYC level gating: None < Basic < Enhanced < Institutional
// - Per-transaction and daily/monthly volume limits scaled by KYC tier
// - Sanctions screening against on-chain deny-lists
// - Jurisdiction-based access control
// - Privacy-preserving address hashing for screening without leaking identities
// - Heuristic risk scoring for address behavior profiling
//
// Philosophy: compliance as a feature, not an afterthought.  Transparent rules
// that protect users while preserving the decentralized ethos.  We screen
// addresses, not people — privacy is preserved through hashed lookups (P-000).

use vibeswap_math::PRECISION;
use vibeswap_math::mul_div;
use sha2::{Digest, Sha256};

// ============ Constants ============

/// KYC expiry in blocks (~6 months at 4s/block)
pub const KYC_EXPIRY_BLOCKS: u64 = 2_600_000;

/// Warning window before KYC expiry (~1 month)
pub const KYC_WARNING_BLOCKS: u64 = 400_000;

/// Maximum possible risk score
pub const MAX_RISK_SCORE: u16 = 10_000;

/// Risk score above which an address is considered high-risk
pub const HIGH_RISK_THRESHOLD: u16 = 7_000;

/// Per-tx limit for Basic KYC (10K tokens)
pub const BASIC_TX_LIMIT: u128 = 10_000 * PRECISION;

/// Per-tx limit for Enhanced KYC (1M tokens)
pub const ENHANCED_TX_LIMIT: u128 = 1_000_000 * PRECISION;

/// Per-tx limit for Institutional KYC (100M tokens)
pub const INSTITUTIONAL_TX_LIMIT: u128 = 100_000_000 * PRECISION;

/// Daily limit for Basic KYC (50K tokens)
pub const BASIC_DAILY_LIMIT: u128 = 50_000 * PRECISION;

/// Daily limit for Enhanced KYC (5M tokens)
pub const ENHANCED_DAILY_LIMIT: u128 = 5_000_000 * PRECISION;

/// Daily limit for Institutional KYC (500M tokens)
pub const INSTITUTIONAL_DAILY_LIMIT: u128 = 500_000_000 * PRECISION;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ComplianceError {
    /// User has not completed required KYC level
    KycRequired,
    /// Address appears on a sanctions deny-list
    SanctionedAddress,
    /// Single transaction exceeds per-tx limit
    TransactionLimitExceeded,
    /// Cumulative daily volume exceeds daily cap
    DailyLimitExceeded,
    /// User's jurisdiction is restricted for this operation
    InvalidJurisdiction,
    /// KYC verification has expired and must be renewed
    ExpiredVerification,
    /// Cooldown period has not yet elapsed
    CooldownActive,
    /// The requested trading pair is restricted
    RestrictedPair,
    /// Transaction amount is below the minimum threshold
    AmountBelowMinimum,
    /// Too many requests in the current window
    RateLimitHit,
}

// ============ Data Types ============

/// KYC verification level — determines access tier.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum KycLevel {
    /// No verification — very limited or no access
    None,
    /// Basic identity verification (email + phone)
    Basic,
    /// Enhanced due diligence (government ID + proof of address)
    Enhanced,
    /// Institutional onboarding (legal entity + AML documentation)
    Institutional,
}

impl KycLevel {
    /// Returns a numeric rank for comparison (higher = more privileged).
    fn rank(&self) -> u8 {
        match self {
            KycLevel::None => 0,
            KycLevel::Basic => 1,
            KycLevel::Enhanced => 2,
            KycLevel::Institutional => 3,
        }
    }
}

/// KYC status for an address.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KycStatus {
    /// The address (lock hash) this KYC record belongs to
    pub address: [u8; 32],
    /// Current KYC level
    pub level: KycLevel,
    /// Block number when verification was completed
    pub verified_at: u64,
    /// Block number when this verification expires
    pub expires_at: u64,
    /// ISO-3166-1 numeric jurisdiction code
    pub jurisdiction: u16,
}

/// Per-tier transaction limits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransactionLimits {
    /// Maximum amount per single transaction
    pub per_tx_max: u128,
    /// Maximum cumulative volume per day
    pub daily_max: u128,
    /// Maximum cumulative volume per month
    pub monthly_max: u128,
    /// Minimum amount per transaction
    pub min_amount: u128,
}

/// A compliance rule governing a specific operation or pair.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComplianceRule {
    /// Unique rule identifier
    pub rule_id: u16,
    /// Minimum KYC level required
    pub kyc_level_required: KycLevel,
    /// Transaction limits for this rule
    pub limits: TransactionLimits,
    /// List of restricted jurisdiction codes
    pub restricted_jurisdictions: Vec<u16>,
    /// Minimum blocks between operations (anti-spam)
    pub cooldown_blocks: u64,
}

/// Result of a full compliance check.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComplianceCheck {
    /// Overall pass/fail
    pub passed: bool,
    /// KYC level was sufficient
    pub kyc_ok: bool,
    /// Transaction limits were satisfied
    pub limits_ok: bool,
    /// Address was not sanctioned
    pub sanctions_ok: bool,
    /// Jurisdiction was not restricted
    pub jurisdiction_ok: bool,
    /// First failure reason (if any)
    pub reason: Option<ComplianceError>,
}

/// Risk profile for an address.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AddressRisk {
    /// The address being assessed
    pub address: [u8; 32],
    /// Composite risk score (0 = safe, 10_000 = maximum risk)
    pub risk_score: u16,
    /// Bit-packed flags (e.g. 0x01 = mixer, 0x02 = high-frequency, etc.)
    pub flags: u32,
    /// Block at which this assessment was last computed
    pub last_assessed: u64,
}

/// Aggregate compliance report over multiple checks.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComplianceReport {
    /// Total number of checks performed
    pub total_checked: u32,
    /// Number that passed
    pub passed: u32,
    /// Number that failed
    pub failed: u32,
    /// Failures due to KYC issues
    pub kyc_failures: u32,
    /// Failures due to limit breaches
    pub limit_failures: u32,
    /// Failures due to sanctions hits
    pub sanction_hits: u32,
}

// ============ Core Functions ============

/// Run a full compliance check for a transaction.
///
/// Evaluates KYC status, sanctions, limits, and jurisdiction in one pass.
/// Returns a `ComplianceCheck` with granular pass/fail fields.
pub fn check_compliance(
    kyc: &KycStatus,
    rule: &ComplianceRule,
    amount: u128,
    daily_volume: u128,
    current_block: u64,
    sanctioned: &[[u8; 32]],
) -> ComplianceCheck {
    let mut result = ComplianceCheck {
        passed: true,
        kyc_ok: true,
        limits_ok: true,
        sanctions_ok: true,
        jurisdiction_ok: true,
        reason: None,
    };

    // 1. Sanctions check (highest priority — hard block)
    if is_sanctioned(&kyc.address, sanctioned) {
        result.passed = false;
        result.sanctions_ok = false;
        if result.reason.is_none() {
            result.reason = Some(ComplianceError::SanctionedAddress);
        }
    }

    // 2. KYC expiry
    if is_kyc_expired(kyc, current_block) {
        result.passed = false;
        result.kyc_ok = false;
        if result.reason.is_none() {
            result.reason = Some(ComplianceError::ExpiredVerification);
        }
    }

    // 3. KYC level
    if !kyc_level_sufficient(&kyc.level, &rule.kyc_level_required) {
        result.passed = false;
        result.kyc_ok = false;
        if result.reason.is_none() {
            result.reason = Some(ComplianceError::KycRequired);
        }
    }

    // 4. Jurisdiction
    if is_restricted_jurisdiction(kyc.jurisdiction, &rule.restricted_jurisdictions) {
        result.passed = false;
        result.jurisdiction_ok = false;
        if result.reason.is_none() {
            result.reason = Some(ComplianceError::InvalidJurisdiction);
        }
    }

    // 5. Limits
    if let Err(e) = check_limits(amount, daily_volume, &rule.limits) {
        result.passed = false;
        result.limits_ok = false;
        if result.reason.is_none() {
            result.reason = Some(e);
        }
    }

    result
}

/// Check if a user's KYC level is sufficient for the required level.
///
/// KYC levels are ordered: None < Basic < Enhanced < Institutional.
/// A user with a higher level always satisfies a lower requirement.
pub fn kyc_level_sufficient(user_level: &KycLevel, required: &KycLevel) -> bool {
    user_level.rank() >= required.rank()
}

/// Check if a KYC verification has expired.
pub fn is_kyc_expired(kyc: &KycStatus, current_block: u64) -> bool {
    current_block >= kyc.expires_at
}

/// Validate a transaction amount against limits.
///
/// Checks per-tx max, daily cumulative cap, and minimum amount.
pub fn check_limits(
    amount: u128,
    daily_volume: u128,
    limits: &TransactionLimits,
) -> Result<(), ComplianceError> {
    if amount < limits.min_amount {
        return Err(ComplianceError::AmountBelowMinimum);
    }
    if amount > limits.per_tx_max {
        return Err(ComplianceError::TransactionLimitExceeded);
    }
    let new_daily = daily_volume.saturating_add(amount);
    if new_daily > limits.daily_max {
        return Err(ComplianceError::DailyLimitExceeded);
    }
    Ok(())
}

/// Check if an address is in the sanctions list.
///
/// Simple linear scan — for on-chain usage where the list is small.
/// For larger lists, use `address_hash` with a Merkle proof.
pub fn is_sanctioned(address: &[u8; 32], sanctioned_list: &[[u8; 32]]) -> bool {
    sanctioned_list.iter().any(|s| s == address)
}

/// Check if a jurisdiction code is in the restricted list.
pub fn is_restricted_jurisdiction(jurisdiction: u16, restricted: &[u16]) -> bool {
    restricted.contains(&jurisdiction)
}

/// Return default transaction limits for a given KYC level.
///
/// None-level gets zero limits (no transactions allowed).
pub fn limits_for_kyc_level(level: &KycLevel) -> TransactionLimits {
    match level {
        KycLevel::None => TransactionLimits {
            per_tx_max: 0,
            daily_max: 0,
            monthly_max: 0,
            min_amount: 0,
        },
        KycLevel::Basic => TransactionLimits {
            per_tx_max: BASIC_TX_LIMIT,
            daily_max: BASIC_DAILY_LIMIT,
            monthly_max: BASIC_DAILY_LIMIT * 30,
            min_amount: PRECISION, // 1 token minimum
        },
        KycLevel::Enhanced => TransactionLimits {
            per_tx_max: ENHANCED_TX_LIMIT,
            daily_max: ENHANCED_DAILY_LIMIT,
            monthly_max: ENHANCED_DAILY_LIMIT * 30,
            min_amount: PRECISION,
        },
        KycLevel::Institutional => TransactionLimits {
            per_tx_max: INSTITUTIONAL_TX_LIMIT,
            daily_max: INSTITUTIONAL_DAILY_LIMIT,
            monthly_max: INSTITUTIONAL_DAILY_LIMIT * 30,
            min_amount: PRECISION,
        },
    }
}

/// Compute a heuristic risk score for an address.
///
/// Factors:
/// - High tx count relative to age = possible bot (higher risk)
/// - Low unique counterparties = possible wash trading (higher risk)
/// - Very high average amount = possible money laundering (higher risk)
/// - Very young account = insufficient history (higher risk)
///
/// Returns a score in [0, MAX_RISK_SCORE].
pub fn address_risk_score(
    tx_count: u64,
    unique_counterparties: u32,
    avg_amount: u128,
    age_blocks: u64,
) -> u16 {
    let mut score: u64 = 0;

    // Factor 1: Transaction frequency (tx per 1000 blocks)
    // High frequency => higher risk
    let frequency = if age_blocks > 0 {
        mul_div(tx_count as u128, 1000, age_blocks as u128) as u64
    } else {
        // Brand new address with transactions is suspicious
        5000
    };
    if frequency > 100 {
        score += 3000; // Very high frequency
    } else if frequency > 50 {
        score += 2000;
    } else if frequency > 10 {
        score += 1000;
    }

    // Factor 2: Counterparty diversity
    // Low diversity relative to tx count => higher risk (wash trading)
    if tx_count > 0 {
        let diversity_ratio = mul_div(
            unique_counterparties as u128,
            10_000,
            tx_count as u128,
        ) as u64;
        if diversity_ratio < 500 {
            score += 3000; // Less than 5% unique — very suspicious
        } else if diversity_ratio < 2000 {
            score += 2000;
        } else if diversity_ratio < 5000 {
            score += 1000;
        }
    }

    // Factor 3: Average transaction size
    // Very large average amounts increase risk
    let large_threshold = 1_000_000u128 * PRECISION; // 1M tokens
    let huge_threshold = 10_000_000u128 * PRECISION;  // 10M tokens
    if avg_amount > huge_threshold {
        score += 2500;
    } else if avg_amount > large_threshold {
        score += 1500;
    }

    // Factor 4: Account age
    // Young accounts are riskier
    if age_blocks < 10_000 {
        score += 1500; // Less than ~11 hours
    } else if age_blocks < 100_000 {
        score += 500;
    }

    // Clamp to MAX_RISK_SCORE
    if score > MAX_RISK_SCORE as u64 {
        MAX_RISK_SCORE
    } else {
        score as u16
    }
}

/// Aggregate multiple compliance check results into a summary report.
pub fn compliance_report(checks: &[ComplianceCheck]) -> ComplianceReport {
    let mut report = ComplianceReport {
        total_checked: checks.len() as u32,
        passed: 0,
        failed: 0,
        kyc_failures: 0,
        limit_failures: 0,
        sanction_hits: 0,
    };

    for check in checks {
        if check.passed {
            report.passed += 1;
        } else {
            report.failed += 1;
            if !check.kyc_ok {
                report.kyc_failures += 1;
            }
            if !check.limits_ok {
                report.limit_failures += 1;
            }
            if !check.sanctions_ok {
                report.sanction_hits += 1;
            }
        }
    }

    report
}

/// Calculate remaining daily transaction capacity.
///
/// Returns 0 if already at or over the daily limit (saturating).
pub fn remaining_daily_limit(limits: &TransactionLimits, daily_volume: u128) -> u128 {
    limits.daily_max.saturating_sub(daily_volume)
}

/// Privacy-preserving address hash for sanctions screening.
///
/// Produces `SHA-256(address || salt)` so that the same address with the same
/// salt always yields the same hash, but different salts produce different
/// outputs.  This lets screening services check against hashed deny-lists
/// without revealing raw addresses.
pub fn address_hash(address: &[u8; 32], salt: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(address);
    hasher.update(salt);
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

/// Check if a KYC verification is approaching expiry and needs renewal.
///
/// Returns true if the verification will expire within `warning_blocks` from
/// `current_block`, but is NOT already expired.
pub fn kyc_renewal_needed(kyc: &KycStatus, current_block: u64, warning_blocks: u64) -> bool {
    if is_kyc_expired(kyc, current_block) {
        return false; // Already expired — renewal isn't "needed", it's overdue
    }
    let warning_start = kyc.expires_at.saturating_sub(warning_blocks);
    current_block >= warning_start
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn make_kyc(level: KycLevel, jurisdiction: u16) -> KycStatus {
        KycStatus {
            address: [0xAA; 32],
            level,
            verified_at: 100,
            expires_at: 100 + KYC_EXPIRY_BLOCKS,
            jurisdiction,
        }
    }

    fn make_kyc_with_expiry(level: KycLevel, expires_at: u64) -> KycStatus {
        KycStatus {
            address: [0xAA; 32],
            level,
            verified_at: 100,
            expires_at,
            jurisdiction: 840, // US
        }
    }

    fn make_rule(kyc_level: KycLevel, restricted: Vec<u16>) -> ComplianceRule {
        let limits = limits_for_kyc_level(&kyc_level);
        ComplianceRule {
            rule_id: 1,
            kyc_level_required: kyc_level,
            limits,
            restricted_jurisdictions: restricted,
            cooldown_blocks: 10,
        }
    }

    fn make_limits(per_tx: u128, daily: u128, monthly: u128, min: u128) -> TransactionLimits {
        TransactionLimits {
            per_tx_max: per_tx,
            daily_max: daily,
            monthly_max: monthly,
            min_amount: min,
        }
    }

    // ============ KYC Level Ordering Tests ============

    #[test]
    fn test_kyc_none_less_than_basic() {
        assert!(!kyc_level_sufficient(&KycLevel::None, &KycLevel::Basic));
    }

    #[test]
    fn test_kyc_basic_less_than_enhanced() {
        assert!(!kyc_level_sufficient(&KycLevel::Basic, &KycLevel::Enhanced));
    }

    #[test]
    fn test_kyc_enhanced_less_than_institutional() {
        assert!(!kyc_level_sufficient(&KycLevel::Enhanced, &KycLevel::Institutional));
    }

    #[test]
    fn test_kyc_none_less_than_institutional() {
        assert!(!kyc_level_sufficient(&KycLevel::None, &KycLevel::Institutional));
    }

    #[test]
    fn test_kyc_exact_level_basic() {
        assert!(kyc_level_sufficient(&KycLevel::Basic, &KycLevel::Basic));
    }

    #[test]
    fn test_kyc_exact_level_enhanced() {
        assert!(kyc_level_sufficient(&KycLevel::Enhanced, &KycLevel::Enhanced));
    }

    #[test]
    fn test_kyc_exact_level_institutional() {
        assert!(kyc_level_sufficient(&KycLevel::Institutional, &KycLevel::Institutional));
    }

    #[test]
    fn test_kyc_exact_level_none() {
        assert!(kyc_level_sufficient(&KycLevel::None, &KycLevel::None));
    }

    #[test]
    fn test_kyc_higher_level_satisfies_lower() {
        assert!(kyc_level_sufficient(&KycLevel::Institutional, &KycLevel::Basic));
        assert!(kyc_level_sufficient(&KycLevel::Institutional, &KycLevel::Enhanced));
        assert!(kyc_level_sufficient(&KycLevel::Enhanced, &KycLevel::Basic));
    }

    #[test]
    fn test_kyc_institutional_satisfies_none() {
        assert!(kyc_level_sufficient(&KycLevel::Institutional, &KycLevel::None));
    }

    // ============ KYC Expiry Tests ============

    #[test]
    fn test_kyc_not_expired_before() {
        let kyc = make_kyc_with_expiry(KycLevel::Basic, 1000);
        assert!(!is_kyc_expired(&kyc, 999));
    }

    #[test]
    fn test_kyc_expired_at_expiry() {
        let kyc = make_kyc_with_expiry(KycLevel::Basic, 1000);
        assert!(is_kyc_expired(&kyc, 1000));
    }

    #[test]
    fn test_kyc_expired_after() {
        let kyc = make_kyc_with_expiry(KycLevel::Basic, 1000);
        assert!(is_kyc_expired(&kyc, 1001));
    }

    #[test]
    fn test_kyc_expired_long_after() {
        let kyc = make_kyc_with_expiry(KycLevel::Basic, 1000);
        assert!(is_kyc_expired(&kyc, 1_000_000));
    }

    // ============ KYC Renewal Tests ============

    #[test]
    fn test_renewal_not_needed_far_from_expiry() {
        let kyc = make_kyc_with_expiry(KycLevel::Basic, 1_000_000);
        assert!(!kyc_renewal_needed(&kyc, 1000, KYC_WARNING_BLOCKS));
    }

    #[test]
    fn test_renewal_needed_within_warning() {
        let kyc = make_kyc_with_expiry(KycLevel::Basic, 10_000);
        // warning_blocks = 2000, so warning starts at 8000
        assert!(kyc_renewal_needed(&kyc, 8500, 2000));
    }

    #[test]
    fn test_renewal_needed_at_warning_boundary() {
        let kyc = make_kyc_with_expiry(KycLevel::Basic, 10_000);
        // Exactly at the start of the warning window
        assert!(kyc_renewal_needed(&kyc, 8000, 2000));
    }

    #[test]
    fn test_renewal_not_needed_already_expired() {
        let kyc = make_kyc_with_expiry(KycLevel::Basic, 10_000);
        assert!(!kyc_renewal_needed(&kyc, 10_000, 2000));
    }

    #[test]
    fn test_renewal_not_needed_long_expired() {
        let kyc = make_kyc_with_expiry(KycLevel::Basic, 10_000);
        assert!(!kyc_renewal_needed(&kyc, 50_000, 2000));
    }

    // ============ Limits Tests ============

    #[test]
    fn test_limits_within_all() {
        let limits = make_limits(1000, 5000, 100_000, 10);
        assert_eq!(check_limits(500, 2000, &limits), Ok(()));
    }

    #[test]
    fn test_limits_at_per_tx_max() {
        let limits = make_limits(1000, 5000, 100_000, 10);
        assert_eq!(check_limits(1000, 0, &limits), Ok(()));
    }

    #[test]
    fn test_limits_over_per_tx_max() {
        let limits = make_limits(1000, 5000, 100_000, 10);
        assert_eq!(
            check_limits(1001, 0, &limits),
            Err(ComplianceError::TransactionLimitExceeded)
        );
    }

    #[test]
    fn test_limits_at_daily_max() {
        let limits = make_limits(5000, 5000, 100_000, 10);
        // daily_volume = 4000, amount = 1000 => new_daily = 5000 = daily_max
        assert_eq!(check_limits(1000, 4000, &limits), Ok(()));
    }

    #[test]
    fn test_limits_over_daily_max() {
        let limits = make_limits(5000, 5000, 100_000, 10);
        // daily_volume = 4500, amount = 501 => new_daily = 5001 > 5000
        assert_eq!(
            check_limits(501, 4500, &limits),
            Err(ComplianceError::DailyLimitExceeded)
        );
    }

    #[test]
    fn test_limits_below_minimum() {
        let limits = make_limits(1000, 5000, 100_000, 10);
        assert_eq!(
            check_limits(9, 0, &limits),
            Err(ComplianceError::AmountBelowMinimum)
        );
    }

    #[test]
    fn test_limits_at_minimum() {
        let limits = make_limits(1000, 5000, 100_000, 10);
        assert_eq!(check_limits(10, 0, &limits), Ok(()));
    }

    #[test]
    fn test_limits_zero_amount_zero_minimum() {
        let limits = make_limits(1000, 5000, 100_000, 0);
        assert_eq!(check_limits(0, 0, &limits), Ok(()));
    }

    #[test]
    fn test_limits_minimum_takes_priority_over_tx_max() {
        // Amount is below minimum AND above per-tx max shouldn't happen in practice,
        // but minimum check runs first
        let limits = make_limits(5, 5000, 100_000, 100);
        assert_eq!(
            check_limits(50, 0, &limits),
            Err(ComplianceError::AmountBelowMinimum)
        );
    }

    // ============ Sanctions Tests ============

    #[test]
    fn test_not_sanctioned_clean_address() {
        let address = [0xAA; 32];
        let sanctioned = vec![[0xBB; 32], [0xCC; 32]];
        assert!(!is_sanctioned(&address, &sanctioned));
    }

    #[test]
    fn test_sanctioned_address_found() {
        let address = [0xBB; 32];
        let sanctioned = vec![[0xAA; 32], [0xBB; 32], [0xCC; 32]];
        assert!(is_sanctioned(&address, &sanctioned));
    }

    #[test]
    fn test_not_sanctioned_empty_list() {
        let address = [0xAA; 32];
        let sanctioned: Vec<[u8; 32]> = vec![];
        assert!(!is_sanctioned(&address, &sanctioned));
    }

    #[test]
    fn test_sanctioned_single_entry() {
        let address = [0xAA; 32];
        let sanctioned = vec![[0xAA; 32]];
        assert!(is_sanctioned(&address, &sanctioned));
    }

    #[test]
    fn test_not_sanctioned_large_list() {
        let address = [0xFF; 32];
        let sanctioned: Vec<[u8; 32]> = (0u8..200).map(|i| [i; 32]).collect();
        assert!(!is_sanctioned(&address, &sanctioned));
    }

    #[test]
    fn test_sanctioned_last_in_list() {
        let address = [0xCC; 32];
        let sanctioned = vec![[0xAA; 32], [0xBB; 32], [0xCC; 32]];
        assert!(is_sanctioned(&address, &sanctioned));
    }

    // ============ Jurisdiction Tests ============

    #[test]
    fn test_jurisdiction_allowed() {
        assert!(!is_restricted_jurisdiction(840, &[408, 410, 364]));
    }

    #[test]
    fn test_jurisdiction_restricted() {
        assert!(is_restricted_jurisdiction(408, &[408, 410, 364]));
    }

    #[test]
    fn test_jurisdiction_empty_restrictions() {
        assert!(!is_restricted_jurisdiction(408, &[]));
    }

    #[test]
    fn test_jurisdiction_single_restricted() {
        assert!(is_restricted_jurisdiction(364, &[364]));
    }

    #[test]
    fn test_jurisdiction_not_in_single_restricted() {
        assert!(!is_restricted_jurisdiction(840, &[364]));
    }

    // ============ Full Compliance Check Tests ============

    #[test]
    fn test_compliance_all_pass() {
        let kyc = make_kyc(KycLevel::Enhanced, 840);
        let rule = make_rule(KycLevel::Basic, vec![408, 410]);
        let amount = 5_000 * PRECISION;
        let daily = 10_000 * PRECISION;
        let block = 500;
        let sanctioned: Vec<[u8; 32]> = vec![];

        let result = check_compliance(&kyc, &rule, amount, daily, block, &sanctioned);
        assert!(result.passed);
        assert!(result.kyc_ok);
        assert!(result.limits_ok);
        assert!(result.sanctions_ok);
        assert!(result.jurisdiction_ok);
        assert_eq!(result.reason, None);
    }

    #[test]
    fn test_compliance_kyc_insufficient() {
        let kyc = make_kyc(KycLevel::Basic, 840);
        let rule = make_rule(KycLevel::Enhanced, vec![]);
        let amount = 100 * PRECISION;
        let sanctioned: Vec<[u8; 32]> = vec![];

        let result = check_compliance(&kyc, &rule, amount, 0, 500, &sanctioned);
        assert!(!result.passed);
        assert!(!result.kyc_ok);
        assert_eq!(result.reason, Some(ComplianceError::KycRequired));
    }

    #[test]
    fn test_compliance_sanctioned() {
        let kyc = make_kyc(KycLevel::Enhanced, 840);
        let rule = make_rule(KycLevel::Basic, vec![]);
        let amount = 100 * PRECISION;
        let sanctioned = vec![[0xAA; 32]]; // matches kyc.address

        let result = check_compliance(&kyc, &rule, amount, 0, 500, &sanctioned);
        assert!(!result.passed);
        assert!(!result.sanctions_ok);
        assert_eq!(result.reason, Some(ComplianceError::SanctionedAddress));
    }

    #[test]
    fn test_compliance_limit_exceeded() {
        let kyc = make_kyc(KycLevel::Basic, 840);
        let rule = make_rule(KycLevel::Basic, vec![]);
        // BASIC_TX_LIMIT is 10_000 * PRECISION
        let amount = 20_000 * PRECISION;
        let sanctioned: Vec<[u8; 32]> = vec![];

        let result = check_compliance(&kyc, &rule, amount, 0, 500, &sanctioned);
        assert!(!result.passed);
        assert!(!result.limits_ok);
        assert_eq!(result.reason, Some(ComplianceError::TransactionLimitExceeded));
    }

    #[test]
    fn test_compliance_daily_limit_exceeded() {
        let kyc = make_kyc(KycLevel::Basic, 840);
        let rule = make_rule(KycLevel::Basic, vec![]);
        let amount = 5_000 * PRECISION;
        let daily = 48_000 * PRECISION; // 48K + 5K = 53K > 50K daily
        let sanctioned: Vec<[u8; 32]> = vec![];

        let result = check_compliance(&kyc, &rule, amount, daily, 500, &sanctioned);
        assert!(!result.passed);
        assert!(!result.limits_ok);
        assert_eq!(result.reason, Some(ComplianceError::DailyLimitExceeded));
    }

    #[test]
    fn test_compliance_restricted_jurisdiction() {
        let kyc = make_kyc(KycLevel::Enhanced, 408); // North Korea
        let rule = make_rule(KycLevel::Basic, vec![408, 410, 364]);
        let amount = 100 * PRECISION;
        let sanctioned: Vec<[u8; 32]> = vec![];

        let result = check_compliance(&kyc, &rule, amount, 0, 500, &sanctioned);
        assert!(!result.passed);
        assert!(!result.jurisdiction_ok);
        assert_eq!(result.reason, Some(ComplianceError::InvalidJurisdiction));
    }

    #[test]
    fn test_compliance_expired_kyc() {
        let kyc = make_kyc_with_expiry(KycLevel::Enhanced, 1000);
        let rule = make_rule(KycLevel::Basic, vec![]);
        let amount = 100 * PRECISION;
        let sanctioned: Vec<[u8; 32]> = vec![];

        let result = check_compliance(&kyc, &rule, amount, 0, 2000, &sanctioned);
        assert!(!result.passed);
        assert!(!result.kyc_ok);
        assert_eq!(result.reason, Some(ComplianceError::ExpiredVerification));
    }

    #[test]
    fn test_compliance_multiple_failures() {
        // Sanctioned + wrong jurisdiction + over limit
        let mut kyc = make_kyc(KycLevel::Basic, 408);
        kyc.address = [0xAA; 32];
        let rule = make_rule(KycLevel::Basic, vec![408]);
        let amount = 20_000 * PRECISION; // over limit
        let sanctioned = vec![[0xAA; 32]];

        let result = check_compliance(&kyc, &rule, amount, 0, 500, &sanctioned);
        assert!(!result.passed);
        assert!(!result.sanctions_ok);
        assert!(!result.jurisdiction_ok);
        assert!(!result.limits_ok);
        // Sanctions is checked first
        assert_eq!(result.reason, Some(ComplianceError::SanctionedAddress));
    }

    #[test]
    fn test_compliance_amount_below_minimum() {
        let kyc = make_kyc(KycLevel::Basic, 840);
        let rule = make_rule(KycLevel::Basic, vec![]);
        // Basic min is PRECISION (1 token), try half that
        let amount = PRECISION / 2;
        let sanctioned: Vec<[u8; 32]> = vec![];

        let result = check_compliance(&kyc, &rule, amount, 0, 500, &sanctioned);
        assert!(!result.passed);
        assert!(!result.limits_ok);
        assert_eq!(result.reason, Some(ComplianceError::AmountBelowMinimum));
    }

    // ============ Limits for KYC Level Tests ============

    #[test]
    fn test_limits_none_all_zero() {
        let limits = limits_for_kyc_level(&KycLevel::None);
        assert_eq!(limits.per_tx_max, 0);
        assert_eq!(limits.daily_max, 0);
        assert_eq!(limits.monthly_max, 0);
    }

    #[test]
    fn test_limits_basic() {
        let limits = limits_for_kyc_level(&KycLevel::Basic);
        assert_eq!(limits.per_tx_max, BASIC_TX_LIMIT);
        assert_eq!(limits.daily_max, BASIC_DAILY_LIMIT);
        assert_eq!(limits.monthly_max, BASIC_DAILY_LIMIT * 30);
        assert_eq!(limits.min_amount, PRECISION);
    }

    #[test]
    fn test_limits_enhanced() {
        let limits = limits_for_kyc_level(&KycLevel::Enhanced);
        assert_eq!(limits.per_tx_max, ENHANCED_TX_LIMIT);
        assert_eq!(limits.daily_max, ENHANCED_DAILY_LIMIT);
    }

    #[test]
    fn test_limits_institutional() {
        let limits = limits_for_kyc_level(&KycLevel::Institutional);
        assert_eq!(limits.per_tx_max, INSTITUTIONAL_TX_LIMIT);
        assert_eq!(limits.daily_max, INSTITUTIONAL_DAILY_LIMIT);
    }

    #[test]
    fn test_limits_increase_with_level() {
        let basic = limits_for_kyc_level(&KycLevel::Basic);
        let enhanced = limits_for_kyc_level(&KycLevel::Enhanced);
        let institutional = limits_for_kyc_level(&KycLevel::Institutional);
        assert!(basic.per_tx_max < enhanced.per_tx_max);
        assert!(enhanced.per_tx_max < institutional.per_tx_max);
        assert!(basic.daily_max < enhanced.daily_max);
        assert!(enhanced.daily_max < institutional.daily_max);
    }

    // ============ Risk Score Tests ============

    #[test]
    fn test_risk_low_activity() {
        // Old account, few txs, diverse counterparties, small amounts
        let score = address_risk_score(
            10,     // 10 txs
            8,      // 8 unique counterparties (80%)
            1000 * PRECISION, // 1K avg amount
            1_000_000, // ~27 days old
        );
        assert!(score < HIGH_RISK_THRESHOLD, "Low activity should be low risk, got {}", score);
    }

    #[test]
    fn test_risk_medium_activity() {
        // Moderate frequency, moderate diversity
        let score = address_risk_score(
            500,    // 500 txs
            100,    // 100 unique (20%)
            50_000 * PRECISION,
            100_000,
        );
        assert!(score > 0, "Medium activity should have some risk");
        assert!(score < MAX_RISK_SCORE, "Medium activity should not be max risk");
    }

    #[test]
    fn test_risk_high_frequency_bot() {
        // Very high frequency, low diversity, large amounts, new account
        let score = address_risk_score(
            10_000, // 10K txs
            50,     // only 50 unique counterparties
            5_000_000 * PRECISION,
            5_000,  // very young
        );
        assert!(score >= HIGH_RISK_THRESHOLD, "Bot pattern should be high risk, got {}", score);
    }

    #[test]
    fn test_risk_brand_new_address() {
        // Zero age
        let score = address_risk_score(5, 3, 100 * PRECISION, 0);
        assert!(score >= 4500, "Brand new address should be risky, got {}", score);
    }

    #[test]
    fn test_risk_zero_everything() {
        let score = address_risk_score(0, 0, 0, 0);
        // Zero age => 5000 frequency, zero txs => no diversity penalty
        assert!(score > 0, "Should still have risk from zero age");
    }

    #[test]
    fn test_risk_clamped_to_max() {
        // Everything maxed out — should hit MAX_RISK_SCORE, not overflow
        let score = address_risk_score(
            u64::MAX / 2,
            1,
            u128::MAX / 2,
            1,
        );
        assert_eq!(score, MAX_RISK_SCORE);
    }

    #[test]
    fn test_risk_wash_trading_pattern() {
        // Many txs, very few counterparties
        let score = address_risk_score(
            1000,
            5,     // 0.5% diversity
            100 * PRECISION,
            500_000,
        );
        assert!(score >= 3000, "Wash trading should have significant risk, got {}", score);
    }

    // ============ Compliance Report Tests ============

    #[test]
    fn test_report_empty() {
        let report = compliance_report(&[]);
        assert_eq!(report.total_checked, 0);
        assert_eq!(report.passed, 0);
        assert_eq!(report.failed, 0);
    }

    #[test]
    fn test_report_all_pass() {
        let checks = vec![
            ComplianceCheck {
                passed: true, kyc_ok: true, limits_ok: true,
                sanctions_ok: true, jurisdiction_ok: true, reason: None,
            },
            ComplianceCheck {
                passed: true, kyc_ok: true, limits_ok: true,
                sanctions_ok: true, jurisdiction_ok: true, reason: None,
            },
        ];
        let report = compliance_report(&checks);
        assert_eq!(report.total_checked, 2);
        assert_eq!(report.passed, 2);
        assert_eq!(report.failed, 0);
        assert_eq!(report.kyc_failures, 0);
    }

    #[test]
    fn test_report_all_fail() {
        let checks = vec![
            ComplianceCheck {
                passed: false, kyc_ok: false, limits_ok: true,
                sanctions_ok: true, jurisdiction_ok: true,
                reason: Some(ComplianceError::KycRequired),
            },
            ComplianceCheck {
                passed: false, kyc_ok: true, limits_ok: false,
                sanctions_ok: true, jurisdiction_ok: true,
                reason: Some(ComplianceError::TransactionLimitExceeded),
            },
            ComplianceCheck {
                passed: false, kyc_ok: true, limits_ok: true,
                sanctions_ok: false, jurisdiction_ok: true,
                reason: Some(ComplianceError::SanctionedAddress),
            },
        ];
        let report = compliance_report(&checks);
        assert_eq!(report.total_checked, 3);
        assert_eq!(report.passed, 0);
        assert_eq!(report.failed, 3);
        assert_eq!(report.kyc_failures, 1);
        assert_eq!(report.limit_failures, 1);
        assert_eq!(report.sanction_hits, 1);
    }

    #[test]
    fn test_report_mixed() {
        let checks = vec![
            ComplianceCheck {
                passed: true, kyc_ok: true, limits_ok: true,
                sanctions_ok: true, jurisdiction_ok: true, reason: None,
            },
            ComplianceCheck {
                passed: false, kyc_ok: false, limits_ok: false,
                sanctions_ok: true, jurisdiction_ok: true,
                reason: Some(ComplianceError::KycRequired),
            },
        ];
        let report = compliance_report(&checks);
        assert_eq!(report.total_checked, 2);
        assert_eq!(report.passed, 1);
        assert_eq!(report.failed, 1);
        assert_eq!(report.kyc_failures, 1);
        assert_eq!(report.limit_failures, 1);
    }

    #[test]
    fn test_report_multiple_failure_types_per_check() {
        // A single check with both KYC and sanctions failure
        let checks = vec![ComplianceCheck {
            passed: false,
            kyc_ok: false,
            limits_ok: true,
            sanctions_ok: false,
            jurisdiction_ok: true,
            reason: Some(ComplianceError::SanctionedAddress),
        }];
        let report = compliance_report(&checks);
        assert_eq!(report.failed, 1);
        assert_eq!(report.kyc_failures, 1);
        assert_eq!(report.sanction_hits, 1);
    }

    // ============ Remaining Daily Limit Tests ============

    #[test]
    fn test_remaining_plenty() {
        let limits = make_limits(10_000, 50_000, 1_000_000, 100);
        assert_eq!(remaining_daily_limit(&limits, 10_000), 40_000);
    }

    #[test]
    fn test_remaining_near_limit() {
        let limits = make_limits(10_000, 50_000, 1_000_000, 100);
        assert_eq!(remaining_daily_limit(&limits, 49_999), 1);
    }

    #[test]
    fn test_remaining_at_limit() {
        let limits = make_limits(10_000, 50_000, 1_000_000, 100);
        assert_eq!(remaining_daily_limit(&limits, 50_000), 0);
    }

    #[test]
    fn test_remaining_over_limit() {
        // Saturating sub means no underflow
        let limits = make_limits(10_000, 50_000, 1_000_000, 100);
        assert_eq!(remaining_daily_limit(&limits, 60_000), 0);
    }

    #[test]
    fn test_remaining_zero_volume() {
        let limits = make_limits(10_000, 50_000, 1_000_000, 100);
        assert_eq!(remaining_daily_limit(&limits, 0), 50_000);
    }

    // ============ Address Hash Tests ============

    #[test]
    fn test_address_hash_deterministic() {
        let addr = [0xAA; 32];
        let salt = [0xBB; 32];
        let h1 = address_hash(&addr, &salt);
        let h2 = address_hash(&addr, &salt);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_address_hash_different_salts_differ() {
        let addr = [0xAA; 32];
        let salt1 = [0xBB; 32];
        let salt2 = [0xCC; 32];
        let h1 = address_hash(&addr, &salt1);
        let h2 = address_hash(&addr, &salt2);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_address_hash_different_addresses_differ() {
        let addr1 = [0xAA; 32];
        let addr2 = [0xBB; 32];
        let salt = [0x11; 32];
        let h1 = address_hash(&addr1, &salt);
        let h2 = address_hash(&addr2, &salt);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_address_hash_not_all_zeros() {
        let addr = [0x00; 32];
        let salt = [0x00; 32];
        let h = address_hash(&addr, &salt);
        // SHA-256 of 64 zero bytes is a specific non-zero hash
        assert_ne!(h, [0u8; 32]);
    }

    #[test]
    fn test_address_hash_output_is_32_bytes() {
        let h = address_hash(&[0xFF; 32], &[0x01; 32]);
        assert_eq!(h.len(), 32);
    }

    // ============ Edge Case & Integration Tests ============

    #[test]
    fn test_compliance_none_kyc_zero_limits() {
        let kyc = make_kyc(KycLevel::None, 840);
        let rule = make_rule(KycLevel::None, vec![]);
        // None level has zero limits — even a 0 amount should pass (0 >= 0 min, 0 <= 0 max)
        let result = check_compliance(&kyc, &rule, 0, 0, 500, &[]);
        assert!(result.passed);
    }

    #[test]
    fn test_compliance_none_kyc_any_amount_fails() {
        let kyc = make_kyc(KycLevel::None, 840);
        let rule = make_rule(KycLevel::None, vec![]);
        // None level has 0 per_tx_max, so any positive amount exceeds it
        let result = check_compliance(&kyc, &rule, 1, 0, 500, &[]);
        assert!(!result.passed);
        assert!(!result.limits_ok);
    }

    #[test]
    fn test_compliance_institutional_large_amount() {
        let kyc = make_kyc(KycLevel::Institutional, 840);
        let rule = make_rule(KycLevel::Institutional, vec![]);
        let amount = 50_000_000 * PRECISION; // 50M — within 100M limit
        let result = check_compliance(&kyc, &rule, amount, 0, 500, &[]);
        assert!(result.passed);
    }

    #[test]
    fn test_constants_relationships() {
        // Basic < Enhanced < Institutional for all limit types
        assert!(BASIC_TX_LIMIT < ENHANCED_TX_LIMIT);
        assert!(ENHANCED_TX_LIMIT < INSTITUTIONAL_TX_LIMIT);
        assert!(BASIC_DAILY_LIMIT < ENHANCED_DAILY_LIMIT);
        assert!(ENHANCED_DAILY_LIMIT < INSTITUTIONAL_DAILY_LIMIT);
    }

    #[test]
    fn test_kyc_level_rank_ordering() {
        assert!(KycLevel::None.rank() < KycLevel::Basic.rank());
        assert!(KycLevel::Basic.rank() < KycLevel::Enhanced.rank());
        assert!(KycLevel::Enhanced.rank() < KycLevel::Institutional.rank());
    }

    #[test]
    fn test_compliance_check_struct_default_values() {
        // Verify the all-pass struct is coherent
        let check = ComplianceCheck {
            passed: true,
            kyc_ok: true,
            limits_ok: true,
            sanctions_ok: true,
            jurisdiction_ok: true,
            reason: None,
        };
        assert!(check.passed);
        assert!(check.kyc_ok);
        assert!(check.limits_ok);
        assert!(check.sanctions_ok);
        assert!(check.jurisdiction_ok);
        assert_eq!(check.reason, None);
    }

    #[test]
    fn test_address_risk_struct() {
        let risk = AddressRisk {
            address: [0xAA; 32],
            risk_score: 5000,
            flags: 0x03, // mixer + high-frequency
            last_assessed: 100_000,
        };
        assert_eq!(risk.risk_score, 5000);
        assert_eq!(risk.flags & 0x01, 1); // mixer flag
        assert_eq!(risk.flags & 0x02, 2); // high-frequency flag
    }

    #[test]
    fn test_risk_score_old_low_volume_account() {
        // Very old account, minimal activity
        let score = address_risk_score(
            2,        // 2 txs total
            2,        // 2 unique counterparties (100%)
            10 * PRECISION,
            10_000_000, // very old
        );
        assert!(score < 1000, "Old low-volume account should be very low risk, got {}", score);
    }

    #[test]
    fn test_risk_score_large_amounts_only() {
        // Normal frequency, good diversity, but huge amounts
        let score = address_risk_score(
            50,
            40, // 80% diversity
            50_000_000 * PRECISION, // 50M avg
            2_000_000,
        );
        // Should get points from large amounts factor
        assert!(score >= 2500, "Large amounts should raise risk, got {}", score);
    }

    // ============ Additional Edge Case Tests ============

    #[test]
    fn test_limits_daily_volume_saturating_add_overflow() {
        // daily_volume near u128::MAX — saturating_add should not panic
        let limits = make_limits(u128::MAX, u128::MAX, u128::MAX, 0);
        let result = check_limits(1, u128::MAX, &limits);
        // saturating_add(u128::MAX, 1) = u128::MAX, which equals daily_max
        assert_eq!(result, Ok(()));
    }

    #[test]
    fn test_limits_amount_equals_daily_max_zero_prior() {
        // Single tx that exactly fills the daily limit
        let limits = make_limits(5000, 5000, 100_000, 10);
        assert_eq!(check_limits(5000, 0, &limits), Ok(()));
    }

    #[test]
    fn test_limits_zero_per_tx_max_rejects_any_amount() {
        // KYC None scenario: all limits are 0, any positive amount fails
        let limits = make_limits(0, 0, 0, 0);
        assert_eq!(
            check_limits(1, 0, &limits),
            Err(ComplianceError::TransactionLimitExceeded)
        );
    }

    #[test]
    fn test_limits_max_u128_amount() {
        // Extreme amount against finite limits
        let limits = make_limits(1000, 5000, 100_000, 10);
        assert_eq!(
            check_limits(u128::MAX, 0, &limits),
            Err(ComplianceError::TransactionLimitExceeded)
        );
    }

    #[test]
    fn test_risk_frequency_boundary_exactly_10() {
        // frequency = tx_count * 1000 / age_blocks
        // 10 * 1000 / 1000 = 10, which is NOT > 10 so no frequency penalty
        let score = address_risk_score(10, 10, 100 * PRECISION, 1_000);
        // frequency == 10, not > 10 => no frequency score
        // diversity = 10 * 10000 / 10 = 10000 => no diversity penalty
        // avg < 1M => no amount penalty
        // age 1000 < 10000 => +1500
        assert_eq!(score, 1500, "Frequency at boundary 10 should not add penalty, got {}", score);
    }

    #[test]
    fn test_risk_frequency_boundary_exactly_11() {
        // 11 * 1000 / 1000 = 11, which IS > 10 so +1000 frequency penalty
        let score = address_risk_score(11, 11, 100 * PRECISION, 1_000);
        // frequency = 11, > 10 => +1000
        // diversity = 11 * 10000 / 11 = 10000 => no diversity penalty
        // avg < 1M => no amount penalty
        // age 1000 < 10000 => +1500
        assert_eq!(score, 2500, "Frequency at 11 should add 1000, got {}", score);
    }

    #[test]
    fn test_risk_frequency_boundary_exactly_50() {
        // 50 * 1000 / 1000 = 50, NOT > 50 => still 1000 bracket
        let score = address_risk_score(50, 50, 100 * PRECISION, 1_000);
        // frequency = 50, > 10 but not > 50 => +1000
        // diversity = 50*10000/50 = 10000 => no penalty
        // age < 10000 => +1500
        assert_eq!(score, 2500, "Frequency at boundary 50 should be 1000, got {}", score);
    }

    #[test]
    fn test_risk_frequency_boundary_exactly_51() {
        // 51 * 1000 / 1000 = 51, > 50 => +2000
        let score = address_risk_score(51, 51, 100 * PRECISION, 1_000);
        // frequency = 51, > 50 => +2000
        // diversity = 51*10000/51 = 10000 => no penalty
        // age < 10000 => +1500
        assert_eq!(score, 3500, "Frequency at 51 should add 2000, got {}", score);
    }

    #[test]
    fn test_risk_frequency_boundary_exactly_101() {
        // 101 * 1000 / 1000 = 101, > 100 => +3000
        let score = address_risk_score(101, 101, 100 * PRECISION, 1_000);
        // frequency = 101, > 100 => +3000
        // diversity = 101*10000/101 = 10000 => no penalty
        // age < 10000 => +1500
        assert_eq!(score, 4500, "Frequency at 101 should add 3000, got {}", score);
    }

    #[test]
    fn test_risk_diversity_boundary_below_500() {
        // diversity_ratio = unique * 10000 / tx_count
        // 4 * 10000 / 100 = 400 < 500 => +3000 diversity penalty
        let score = address_risk_score(100, 4, 100 * PRECISION, 1_000_000);
        // frequency = 100 * 1000 / 1_000_000 = 0 => no freq penalty
        // diversity = 400 < 500 => +3000
        // avg < 1M => no amount
        // age > 100_000 => no age penalty
        assert_eq!(score, 3000, "Low diversity <500 should add 3000, got {}", score);
    }

    #[test]
    fn test_risk_diversity_boundary_at_500() {
        // 5 * 10000 / 100 = 500, NOT < 500, IS < 2000 => +2000
        let score = address_risk_score(100, 5, 100 * PRECISION, 1_000_000);
        // diversity = 500, not < 500 but < 2000 => +2000
        assert_eq!(score, 2000, "Diversity at 500 should add 2000, got {}", score);
    }

    #[test]
    fn test_risk_diversity_boundary_at_2000() {
        // 20 * 10000 / 100 = 2000, NOT < 2000, IS < 5000 => +1000
        let score = address_risk_score(100, 20, 100 * PRECISION, 1_000_000);
        // diversity = 2000, not < 2000 but < 5000 => +1000
        assert_eq!(score, 1000, "Diversity at 2000 should add 1000, got {}", score);
    }

    #[test]
    fn test_risk_diversity_boundary_at_5000() {
        // 50 * 10000 / 100 = 5000, NOT < 5000 => no diversity penalty
        let score = address_risk_score(100, 50, 100 * PRECISION, 1_000_000);
        // diversity = 5000 => no penalty
        assert_eq!(score, 0, "Diversity at 5000 should add 0, got {}", score);
    }

    #[test]
    fn test_risk_age_boundary_at_10000() {
        // age_blocks = 10_000, NOT < 10_000, IS < 100_000 => +500
        let score = address_risk_score(1, 1, 100 * PRECISION, 10_000);
        // frequency = 1 * 1000 / 10000 = 0 => no freq
        // diversity = 1*10000/1 = 10000 => no diversity
        // avg < 1M => no amount
        // age = 10000, >= 10000 but < 100000 => +500
        assert_eq!(score, 500, "Age at 10000 should add 500, got {}", score);
    }

    #[test]
    fn test_risk_age_boundary_at_9999() {
        // age_blocks = 9_999, < 10_000 => +1500
        let score = address_risk_score(1, 1, 100 * PRECISION, 9_999);
        // frequency = 1*1000/9999 = 0 => no freq
        // diversity = 10000 => no diversity
        // avg < 1M => no amount
        // age < 10000 => +1500
        assert_eq!(score, 1500, "Age at 9999 should add 1500, got {}", score);
    }

    #[test]
    fn test_risk_age_boundary_at_100000() {
        // age_blocks = 100_000, >= 100_000 => no age penalty
        let score = address_risk_score(1, 1, 100 * PRECISION, 100_000);
        // frequency = 1*1000/100000 = 0 => no freq
        // diversity = 10000 => no diversity
        // avg < 1M => no amount
        // age >= 100000 => no age penalty
        assert_eq!(score, 0, "Age at 100000 should add 0, got {}", score);
    }

    #[test]
    fn test_risk_avg_amount_at_large_threshold() {
        // avg_amount exactly at 1M * PRECISION => NOT > large_threshold => no penalty
        let score = address_risk_score(1, 1, 1_000_000 * PRECISION, 1_000_000);
        // freq = 0, diversity = 10000, age > 100000 => all zero
        // avg = 1M*PRECISION = large_threshold, NOT > large => no penalty
        assert_eq!(score, 0, "Avg at exactly 1M threshold should not add penalty, got {}", score);
    }

    #[test]
    fn test_risk_avg_amount_just_above_large_threshold() {
        // avg_amount = 1M*PRECISION + 1 => > large_threshold => +1500
        let score = address_risk_score(1, 1, 1_000_000 * PRECISION + 1, 1_000_000);
        assert_eq!(score, 1500, "Avg just above 1M should add 1500, got {}", score);
    }

    #[test]
    fn test_risk_avg_amount_at_huge_threshold() {
        // avg_amount exactly at 10M * PRECISION => NOT > huge_threshold => +1500
        let score = address_risk_score(1, 1, 10_000_000 * PRECISION, 1_000_000);
        // 10M = huge_threshold, NOT > huge => but IS > large => +1500
        assert_eq!(score, 1500, "Avg at exactly 10M threshold should add 1500, got {}", score);
    }

    #[test]
    fn test_risk_avg_amount_just_above_huge_threshold() {
        // avg_amount = 10M*PRECISION + 1 => > huge_threshold => +2500
        let score = address_risk_score(1, 1, 10_000_000 * PRECISION + 1, 1_000_000);
        assert_eq!(score, 2500, "Avg just above 10M should add 2500, got {}", score);
    }

    #[test]
    fn test_kyc_renewal_warning_blocks_larger_than_expires_at() {
        // warning_blocks > expires_at: saturating_sub should produce 0
        let kyc = make_kyc_with_expiry(KycLevel::Basic, 100);
        // warning_blocks = 500, expires_at = 100, warning_start = 100 - 500 = 0 (saturating)
        // current_block 50 >= 0 => true, and not expired (50 < 100) => renewal needed
        assert!(kyc_renewal_needed(&kyc, 50, 500));
    }

    #[test]
    fn test_kyc_renewal_warning_blocks_zero() {
        // warning_blocks = 0: warning_start = expires_at, only exact block before expiry triggers
        let kyc = make_kyc_with_expiry(KycLevel::Basic, 10_000);
        // warning_start = 10000 - 0 = 10000, current = 9999 < 10000 => false
        assert!(!kyc_renewal_needed(&kyc, 9999, 0));
        // current = 10000 >= 10000, but also expired at 10000 => false (already expired)
        assert!(!kyc_renewal_needed(&kyc, 10_000, 0));
    }

    #[test]
    fn test_kyc_expired_at_block_zero_expires_zero() {
        let kyc = make_kyc_with_expiry(KycLevel::Basic, 0);
        // current_block 0 >= expires_at 0 => expired
        assert!(is_kyc_expired(&kyc, 0));
    }

    #[test]
    fn test_kyc_expired_at_u64_max() {
        let kyc = make_kyc_with_expiry(KycLevel::Basic, u64::MAX);
        // Just before max => not expired
        assert!(!is_kyc_expired(&kyc, u64::MAX - 1));
        // At max => expired
        assert!(is_kyc_expired(&kyc, u64::MAX));
    }

    #[test]
    fn test_compliance_sanctions_priority_over_expired_kyc() {
        // Both sanctioned and expired — sanctions is first failure reason
        let kyc = make_kyc_with_expiry(KycLevel::Enhanced, 1000);
        let rule = make_rule(KycLevel::Basic, vec![]);
        let amount = 100 * PRECISION;
        let sanctioned = vec![[0xAA; 32]]; // matches kyc.address

        let result = check_compliance(&kyc, &rule, amount, 0, 2000, &sanctioned);
        assert!(!result.passed);
        assert!(!result.sanctions_ok);
        assert!(!result.kyc_ok);
        // Sanctions checked first, so reason should be SanctionedAddress
        assert_eq!(result.reason, Some(ComplianceError::SanctionedAddress));
    }

    #[test]
    fn test_compliance_different_address_not_sanctioned() {
        // KYC address is 0xAA, sanctions list has 0xBB => passes sanctions
        let kyc = make_kyc(KycLevel::Enhanced, 840);
        let rule = make_rule(KycLevel::Basic, vec![]);
        let amount = 100 * PRECISION;
        let sanctioned = vec![[0xBB; 32]]; // does NOT match kyc.address 0xAA

        let result = check_compliance(&kyc, &rule, amount, 0, 500, &sanctioned);
        assert!(result.passed);
        assert!(result.sanctions_ok);
    }

    #[test]
    fn test_compliance_report_single_pass() {
        let checks = vec![ComplianceCheck {
            passed: true,
            kyc_ok: true,
            limits_ok: true,
            sanctions_ok: true,
            jurisdiction_ok: true,
            reason: None,
        }];
        let report = compliance_report(&checks);
        assert_eq!(report.total_checked, 1);
        assert_eq!(report.passed, 1);
        assert_eq!(report.failed, 0);
        assert_eq!(report.kyc_failures, 0);
        assert_eq!(report.limit_failures, 0);
        assert_eq!(report.sanction_hits, 0);
    }

    #[test]
    fn test_compliance_report_single_fail_jurisdiction() {
        // Jurisdiction failure only — not tracked as kyc/limit/sanction
        let checks = vec![ComplianceCheck {
            passed: false,
            kyc_ok: true,
            limits_ok: true,
            sanctions_ok: true,
            jurisdiction_ok: false,
            reason: Some(ComplianceError::InvalidJurisdiction),
        }];
        let report = compliance_report(&checks);
        assert_eq!(report.total_checked, 1);
        assert_eq!(report.passed, 0);
        assert_eq!(report.failed, 1);
        // Jurisdiction failures are not tracked in dedicated counters
        assert_eq!(report.kyc_failures, 0);
        assert_eq!(report.limit_failures, 0);
        assert_eq!(report.sanction_hits, 0);
    }

    #[test]
    fn test_remaining_daily_limit_u128_max() {
        let limits = make_limits(u128::MAX, u128::MAX, u128::MAX, 0);
        assert_eq!(remaining_daily_limit(&limits, 0), u128::MAX);
        assert_eq!(remaining_daily_limit(&limits, u128::MAX), 0);
        assert_eq!(remaining_daily_limit(&limits, 1), u128::MAX - 1);
    }

    #[test]
    fn test_address_hash_commutative_check() {
        // Verify hash(addr, salt) != hash(salt, addr) — i.e. argument order matters
        let a = [0xAA; 32];
        let b = [0xBB; 32];
        let h1 = address_hash(&a, &b);
        let h2 = address_hash(&b, &a);
        assert_ne!(h1, h2, "address_hash should not be commutative");
    }

    #[test]
    fn test_limits_for_kyc_none_min_amount_zero() {
        let limits = limits_for_kyc_level(&KycLevel::None);
        assert_eq!(limits.min_amount, 0);
    }

    #[test]
    fn test_limits_for_kyc_monthly_is_30x_daily() {
        for level in &[KycLevel::Basic, KycLevel::Enhanced, KycLevel::Institutional] {
            let limits = limits_for_kyc_level(level);
            assert_eq!(
                limits.monthly_max,
                limits.daily_max * 30,
                "Monthly should be 30x daily for {:?}",
                level
            );
        }
    }

    #[test]
    fn test_compliance_all_four_failures_simultaneously() {
        // Sanctioned + expired + insufficient KYC + restricted jurisdiction + over limits
        let mut kyc = make_kyc_with_expiry(KycLevel::None, 500); // expires at block 500
        kyc.jurisdiction = 408; // restricted
        let rule = make_rule(KycLevel::Institutional, vec![408]);
        let amount = u128::MAX; // way over limits
        let sanctioned = vec![[0xAA; 32]]; // matches

        let result = check_compliance(&kyc, &rule, amount, 0, 1000, &sanctioned);
        assert!(!result.passed);
        assert!(!result.sanctions_ok);
        assert!(!result.kyc_ok);
        assert!(!result.jurisdiction_ok);
        assert!(!result.limits_ok);
        // First failure should be sanctions (highest priority)
        assert_eq!(result.reason, Some(ComplianceError::SanctionedAddress));
    }

    #[test]
    fn test_sanctioned_first_in_list() {
        let address = [0xAA; 32];
        let sanctioned = vec![[0xAA; 32], [0xBB; 32], [0xCC; 32]];
        assert!(is_sanctioned(&address, &sanctioned));
    }

    #[test]
    fn test_jurisdiction_max_u16_value() {
        // Edge case: u16::MAX as jurisdiction code
        assert!(is_restricted_jurisdiction(u16::MAX, &[u16::MAX]));
        assert!(!is_restricted_jurisdiction(u16::MAX, &[0, 1, 2]));
    }

    #[test]
    fn test_kyc_status_clone_and_eq() {
        let kyc1 = make_kyc(KycLevel::Basic, 840);
        let kyc2 = kyc1.clone();
        assert_eq!(kyc1, kyc2);
    }

    #[test]
    fn test_compliance_error_clone_and_eq() {
        let e1 = ComplianceError::KycRequired;
        let e2 = e1.clone();
        assert_eq!(e1, e2);
        assert_ne!(ComplianceError::KycRequired, ComplianceError::SanctionedAddress);
    }

    // ============ Hardening Batch: Additional Edge Cases ============

    #[test]
    fn test_kyc_none_insufficient_for_all_levels() {
        assert!(!kyc_level_sufficient(&KycLevel::None, &KycLevel::Basic));
        assert!(!kyc_level_sufficient(&KycLevel::None, &KycLevel::Enhanced));
        assert!(!kyc_level_sufficient(&KycLevel::None, &KycLevel::Institutional));
    }

    #[test]
    fn test_kyc_basic_sufficient_for_none_and_basic() {
        assert!(kyc_level_sufficient(&KycLevel::Basic, &KycLevel::None));
        assert!(kyc_level_sufficient(&KycLevel::Basic, &KycLevel::Basic));
        assert!(!kyc_level_sufficient(&KycLevel::Basic, &KycLevel::Enhanced));
    }

    #[test]
    fn test_kyc_enhanced_covers_basic_and_none() {
        assert!(kyc_level_sufficient(&KycLevel::Enhanced, &KycLevel::None));
        assert!(kyc_level_sufficient(&KycLevel::Enhanced, &KycLevel::Basic));
        assert!(kyc_level_sufficient(&KycLevel::Enhanced, &KycLevel::Enhanced));
    }

    #[test]
    fn test_kyc_expired_one_block_before() {
        let kyc = make_kyc_with_expiry(KycLevel::Basic, 1000);
        assert!(!is_kyc_expired(&kyc, 999));
    }

    #[test]
    fn test_kyc_expired_one_block_after() {
        let kyc = make_kyc_with_expiry(KycLevel::Basic, 1000);
        assert!(is_kyc_expired(&kyc, 1001));
    }

    #[test]
    fn test_kyc_renewal_at_exact_warning_boundary_minus_one() {
        let kyc = make_kyc_with_expiry(KycLevel::Basic, 10_000);
        // warning starts at 8000, current = 7999 → not needed yet
        assert!(!kyc_renewal_needed(&kyc, 7999, 2000));
    }

    #[test]
    fn test_kyc_renewal_one_block_before_expiry() {
        let kyc = make_kyc_with_expiry(KycLevel::Basic, 10_000);
        // current = 9999, not expired yet, within any warning window
        assert!(kyc_renewal_needed(&kyc, 9999, 100));
    }

    #[test]
    fn test_check_limits_exact_at_per_tx_plus_one() {
        let limits = make_limits(1000, 5000, 100_000, 10);
        assert_eq!(
            check_limits(1001, 0, &limits),
            Err(ComplianceError::TransactionLimitExceeded)
        );
    }

    #[test]
    fn test_check_limits_daily_exactly_full() {
        // daily_volume + amount = daily_max exactly
        let limits = make_limits(5000, 10_000, 100_000, 10);
        assert_eq!(check_limits(3_000, 7_000, &limits), Ok(()));
    }

    #[test]
    fn test_check_limits_daily_one_over() {
        let limits = make_limits(5000, 10_000, 100_000, 10);
        assert_eq!(
            check_limits(3_001, 7_000, &limits),
            Err(ComplianceError::DailyLimitExceeded)
        );
    }

    #[test]
    fn test_sanctioned_zero_address() {
        let address = [0x00; 32];
        let sanctioned = vec![[0x00; 32]];
        assert!(is_sanctioned(&address, &sanctioned));
    }

    #[test]
    fn test_sanctioned_max_address() {
        let address = [0xFF; 32];
        let sanctioned = vec![[0xFF; 32]];
        assert!(is_sanctioned(&address, &sanctioned));
    }

    #[test]
    fn test_jurisdiction_zero_value() {
        assert!(is_restricted_jurisdiction(0, &[0, 100, 200]));
        assert!(!is_restricted_jurisdiction(0, &[100, 200]));
    }

    #[test]
    fn test_compliance_basic_at_exact_tx_limit() {
        let kyc = make_kyc(KycLevel::Basic, 840);
        let rule = make_rule(KycLevel::Basic, vec![]);
        // Exact per-tx limit should pass
        let amount = BASIC_TX_LIMIT;
        let result = check_compliance(&kyc, &rule, amount, 0, 500, &[]);
        assert!(result.passed);
    }

    #[test]
    fn test_compliance_basic_one_over_tx_limit() {
        let kyc = make_kyc(KycLevel::Basic, 840);
        let rule = make_rule(KycLevel::Basic, vec![]);
        let amount = BASIC_TX_LIMIT + 1;
        let result = check_compliance(&kyc, &rule, amount, 0, 500, &[]);
        assert!(!result.passed);
        assert!(!result.limits_ok);
    }

    #[test]
    fn test_compliance_enhanced_at_exact_daily_limit() {
        let kyc = make_kyc(KycLevel::Enhanced, 840);
        let rule = make_rule(KycLevel::Enhanced, vec![]);
        // Send 1M (within per-tx), daily already at 4M → total 5M = daily limit
        let amount = ENHANCED_TX_LIMIT; // 1M
        let daily = ENHANCED_DAILY_LIMIT - amount;
        let result = check_compliance(&kyc, &rule, amount, daily, 500, &[]);
        assert!(result.passed);
    }

    #[test]
    fn test_risk_score_max_diversity_no_penalty() {
        // 10 txs, 10 unique counterparties = 100% diversity → no diversity penalty
        let score = address_risk_score(10, 10, 100 * PRECISION, 1_000_000);
        // diversity = 10*10000/10 = 10000 → no penalty
        // frequency = 10*1000/1000000 = 0 → no penalty
        // avg < 1M → no penalty
        // age >= 100000 → no penalty
        assert_eq!(score, 0);
    }

    #[test]
    fn test_risk_score_zero_tx_count() {
        // No transactions at all
        let score = address_risk_score(0, 0, 0, 1_000_000);
        // frequency = 0 (zero txs means mul_div result is 0)
        // no diversity check (tx_count == 0)
        // avg = 0, no amount penalty
        // age >= 100000 → no age penalty
        assert_eq!(score, 0);
    }

    #[test]
    fn test_risk_score_one_tx_one_counterparty() {
        let score = address_risk_score(1, 1, 500 * PRECISION, 500_000);
        // frequency = 1*1000/500000 = 0 → no freq
        // diversity = 1*10000/1 = 10000 → no diversity
        // avg 500 < 1M → no amount
        // age 500K >= 100K → no age
        assert_eq!(score, 0);
    }

    #[test]
    fn test_compliance_report_ten_checks_mixed() {
        let mut checks = Vec::new();
        for i in 0..10 {
            if i < 6 {
                checks.push(ComplianceCheck {
                    passed: true, kyc_ok: true, limits_ok: true,
                    sanctions_ok: true, jurisdiction_ok: true, reason: None,
                });
            } else {
                checks.push(ComplianceCheck {
                    passed: false, kyc_ok: false, limits_ok: true,
                    sanctions_ok: true, jurisdiction_ok: true,
                    reason: Some(ComplianceError::KycRequired),
                });
            }
        }
        let report = compliance_report(&checks);
        assert_eq!(report.total_checked, 10);
        assert_eq!(report.passed, 6);
        assert_eq!(report.failed, 4);
        assert_eq!(report.kyc_failures, 4);
        assert_eq!(report.limit_failures, 0);
        assert_eq!(report.sanction_hits, 0);
    }

    #[test]
    fn test_remaining_daily_limit_half_used() {
        let limits = make_limits(10_000, 100_000, 1_000_000, 100);
        assert_eq!(remaining_daily_limit(&limits, 50_000), 50_000);
    }

    #[test]
    fn test_address_hash_same_address_same_salt() {
        let addr = [0x42; 32];
        let salt = [0x99; 32];
        let h1 = address_hash(&addr, &salt);
        let h2 = address_hash(&addr, &salt);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_address_hash_different_addr_bytes_produce_different_hashes() {
        let salt = [0x00; 32];
        let mut addr1 = [0x00; 32];
        let mut addr2 = [0x00; 32];
        addr1[31] = 1;
        addr2[31] = 2;
        assert_ne!(address_hash(&addr1, &salt), address_hash(&addr2, &salt));
    }

    #[test]
    fn test_compliance_enhanced_user_basic_rule_passes() {
        // Higher KYC level user accessing lower-tier rule should pass
        let kyc = make_kyc(KycLevel::Enhanced, 840);
        let rule = make_rule(KycLevel::Basic, vec![]);
        let amount = 5_000 * PRECISION;
        let result = check_compliance(&kyc, &rule, amount, 0, 500, &[]);
        assert!(result.passed);
        assert!(result.kyc_ok);
    }

    #[test]
    fn test_compliance_institutional_user_none_rule_passes() {
        let kyc = make_kyc(KycLevel::Institutional, 840);
        let rule = make_rule(KycLevel::None, vec![]);
        let result = check_compliance(&kyc, &rule, 0, 0, 500, &[]);
        assert!(result.passed);
    }

    #[test]
    fn test_limits_none_monthly_zero() {
        let limits = limits_for_kyc_level(&KycLevel::None);
        assert_eq!(limits.monthly_max, 0);
    }

    #[test]
    fn test_risk_score_diversity_below_five_percent() {
        // 1000 txs, only 4 counterparties = 0.4% diversity → +3000
        let score = address_risk_score(1000, 4, 100 * PRECISION, 1_000_000);
        // diversity = 4*10000/1000 = 40 < 500 → +3000
        // freq = 1000*1000/1000000 = 1 → no freq
        assert_eq!(score, 3000);
    }

    #[test]
    fn test_compliance_check_all_fields_are_set() {
        let kyc = make_kyc(KycLevel::Enhanced, 840);
        let rule = make_rule(KycLevel::Basic, vec![]);
        let result = check_compliance(&kyc, &rule, 100 * PRECISION, 0, 500, &[]);

        // All fields should be properly set for a passing check
        assert!(result.passed);
        assert!(result.kyc_ok);
        assert!(result.limits_ok);
        assert!(result.sanctions_ok);
        assert!(result.jurisdiction_ok);
        assert!(result.reason.is_none());
    }

    #[test]
    fn test_compliance_expired_but_sufficient_level() {
        // KYC level is sufficient but expired → should fail with ExpiredVerification
        let kyc = make_kyc_with_expiry(KycLevel::Institutional, 500);
        let rule = make_rule(KycLevel::Basic, vec![]);
        let result = check_compliance(&kyc, &rule, 100 * PRECISION, 0, 1000, &[]);
        assert!(!result.passed);
        assert!(!result.kyc_ok);
        assert_eq!(result.reason, Some(ComplianceError::ExpiredVerification));
    }

    #[test]
    fn test_risk_score_moderate_frequency_boundary() {
        // frequency = 50 * 1000 / 1000 = 50, NOT > 50 → +1000 (not +2000)
        let score = address_risk_score(50, 50, 100 * PRECISION, 1000);
        // freq = 50 → +1000
        // diversity = 50*10000/50 = 10000 → no penalty
        // age < 10000 → +1500
        assert_eq!(score, 2500);
    }

    #[test]
    fn test_risk_score_exactly_100_frequency() {
        // frequency = 100 * 1000 / 1000 = 100, NOT > 100 → +2000
        let score = address_risk_score(100, 100, 100 * PRECISION, 1000);
        // freq = 100, > 50 but not > 100 → +2000
        // diversity = 100*10000/100 = 10000 → no penalty
        // age < 10000 → +1500
        assert_eq!(score, 3500);
    }
}
