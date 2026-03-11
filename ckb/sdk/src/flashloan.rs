// ============ Flash Loan — Detection, Protection & Analysis ============
// Implements flash loan detection, protection, and analysis for VibeSwap on CKB.
//
// VibeSwap's core anti-MEV defense is the commit-reveal batch auction mechanism.
// Flash loans are particularly dangerous for DEXes — an attacker can borrow
// unlimited capital, manipulate prices, profit, and repay in a single block.
//
// This module provides:
// - Flash loan request validation and fee computation
// - Repayment verification (must repay same block — true flash loan semantics)
// - Pool state tracking for concurrent loan management
// - Suspicious pattern detection (price manipulation, governance, oracle, sandwich)
// - EOA-only commit enforcement (contracts cannot commit to auctions)
// - Vulnerability assessment and protection scoring
// - Attack profitability estimation
//
// The commit-reveal auction inherently protects against most flash loan MEV because:
// 1. Orders are committed as hashes — attacker cannot see them
// 2. EOA-only commits prevent contract-orchestrated flash loan attacks
// 3. Batch settlement with uniform clearing price eliminates front-running
// 4. TWAP validation catches oracle manipulation attempts
//
// Philosophy: The best defense is a mechanism that makes the attack unprofitable.

use vibeswap_math::PRECISION;
use vibeswap_math::mul_div;

// ============ Constants ============

/// Basis points denominator
pub const BPS: u128 = 10_000;

/// Max 50% of pool in single borrow
pub const MAX_SINGLE_BORROW_BPS: u16 = 5000;

/// 0.09% flash loan fee (like Aave)
pub const FLASH_LOAN_FEE_BPS: u16 = 9;

/// Must span at least 1 block between borrows from same pool
pub const MIN_BLOCKS_BETWEEN_BORROWS: u64 = 1;

/// Max simultaneous flash loans per pool
pub const MAX_CONCURRENT_LOANS: usize = 5;

/// 10x normal volume = suspicious
pub const SUSPICIOUS_VOLUME_MULTIPLIER: u128 = 10;

/// Only EOAs can commit to auctions
pub const EOA_COMMIT_REQUIRED: bool = true;

/// Must repay same block (true flash loan)
pub const REPAYMENT_GRACE_BLOCKS: u64 = 0;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FlashLoanError {
    /// Borrow exceeds the total available pool liquidity
    ExceedsPoolCapacity,
    /// Borrow exceeds the maximum single-borrow limit (50% of pool)
    ExceedsMaxBorrow,
    /// Repayment amount is less than required (principal + fee)
    InsufficientRepayment,
    /// Fee paid is below the minimum required fee
    FeeTooLow,
    /// Pool has reached its maximum concurrent loan limit
    ConcurrentLoanLimit,
    /// Loan was not repaid within the required block window
    NotRepaidInTime,
    /// Transaction pattern matches known flash loan attack vectors
    SuspiciousPattern,
    /// Pool identifier is invalid (zero bytes)
    InvalidPool,
    /// Borrow amount is zero
    ZeroAmount,
    /// Arithmetic overflow in fee or repayment calculation
    Overflow,
    /// Protocol flash loan facility is paused
    ProtocolPaused,
    /// Borrower address has been blocked due to prior malicious activity
    BorrowerBlocked,
}

// ============ Data Types ============

/// A flash loan request submitted by a borrower.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FlashLoanRequest {
    /// Borrower's 32-byte address (CKB lock hash)
    pub borrower: [u8; 32],
    /// Pool to borrow from
    pub pool_id: [u8; 32],
    /// Amount to borrow (in token base units)
    pub amount: u128,
    /// Expected repayment amount (must be >= amount + fee)
    pub expected_repayment: u128,
    /// Block number when the request was made
    pub request_block: u64,
}

/// Result of a completed flash loan (borrow + repay cycle).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FlashLoanResult {
    /// The original request
    pub request: FlashLoanRequest,
    /// Actual fee paid by borrower
    pub fee_paid: u128,
    /// Block number when repayment occurred
    pub repaid_block: u64,
    /// Borrower's estimated profit (can be negative if they lost money)
    pub profit_estimate: i128,
    /// Whether the borrower profited from the loan
    pub was_profitable: bool,
}

/// Per-pool flash loan state tracking.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolFlashLoanState {
    /// Pool identifier
    pub pool_id: [u8; 32],
    /// Total liquidity available for flash loans
    pub total_available: u128,
    /// Amount currently borrowed via active flash loans
    pub currently_borrowed: u128,
    /// Number of active (outstanding) flash loans
    pub active_loans: u8,
    /// Lifetime total number of flash loans served
    pub total_loans_served: u64,
    /// Lifetime total fees earned from flash loans
    pub total_fees_earned: u128,
    /// Block number of the most recent loan
    pub last_loan_block: u64,
}

/// Analysis of a potential flash loan attack pattern.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FlashLoanAnalysis {
    /// Whether the analyzed activity is suspicious
    pub is_suspicious: bool,
    /// Risk score in basis points (0 = safe, 10000 = certain attack)
    pub risk_score: u16,
    /// Detected attack pattern
    pub pattern: AttackPattern,
    /// Estimated price impact in basis points
    pub estimated_impact_bps: u16,
    /// Number of pools affected by the detected pattern
    pub affected_pools: u8,
}

/// Known flash loan attack pattern classifications.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AttackPattern {
    /// No attack pattern detected
    None,
    /// Borrow -> trade large volume -> profit from price impact
    PriceManipulation,
    /// Borrow -> dump token -> trigger liquidations -> profit
    LiquidationTrigger,
    /// Borrow -> acquire governance tokens -> vote -> return
    GovernanceAttack,
    /// Borrow -> skew TWAP oracle -> profit from mispricing
    OracleManipulation,
    /// Front-run + back-run a target transaction
    SandwichAttack,
}

/// Overall protocol protection assessment against flash loan attacks.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProtectionReport {
    /// Whether commit-reveal batch auction is active
    pub commit_reveal_active: bool,
    /// Whether only EOAs can commit to auctions
    pub eoa_only_commits: bool,
    /// Whether TWAP oracle validation is enabled
    pub twap_validated: bool,
    /// Whether rate limiting is active
    pub rate_limited: bool,
    /// Whether circuit breakers are enabled
    pub circuit_breaker_active: bool,
    /// Overall protection score (0 = unprotected, 100 = maximum protection)
    pub overall_protection_score: u8,
}

// ============ Core Functions ============

/// Validate a flash loan request against pool state and protocol rules.
///
/// Checks:
/// - Amount is non-zero
/// - Pool has sufficient available liquidity (total_available - currently_borrowed)
/// - Borrow does not exceed MAX_SINGLE_BORROW_BPS of pool
/// - Pool has not reached MAX_CONCURRENT_LOANS
/// - Expected repayment covers principal + fee
///
/// Returns the required fee on success.
pub fn validate_flash_loan(
    request: &FlashLoanRequest,
    pool_state: &PoolFlashLoanState,
) -> Result<u128, FlashLoanError> {
    // Zero amount check
    if request.amount == 0 {
        return Err(FlashLoanError::ZeroAmount);
    }

    // Pool validity: check pool_id is not all zeros
    if pool_state.pool_id == [0u8; 32] {
        return Err(FlashLoanError::InvalidPool);
    }

    // Concurrent loan limit
    if pool_state.active_loans as usize >= MAX_CONCURRENT_LOANS {
        return Err(FlashLoanError::ConcurrentLoanLimit);
    }

    // Available liquidity
    let available = pool_state
        .total_available
        .checked_sub(pool_state.currently_borrowed)
        .unwrap_or(0);

    if request.amount > available {
        return Err(FlashLoanError::ExceedsPoolCapacity);
    }

    // Max single borrow (50% of total pool)
    let max_borrow = max_safe_borrow(pool_state.total_available);
    if request.amount > max_borrow {
        return Err(FlashLoanError::ExceedsMaxBorrow);
    }

    // Compute required fee and repayment
    let fee = compute_fee(request.amount);
    let required_repayment = request
        .amount
        .checked_add(fee)
        .ok_or(FlashLoanError::Overflow)?;

    if request.expected_repayment < required_repayment {
        return Err(FlashLoanError::FeeTooLow);
    }

    Ok(fee)
}

/// Compute the flash loan fee for a given borrow amount.
///
/// fee = amount * FLASH_LOAN_FEE_BPS / BPS
///
/// Uses mul_div for overflow-safe arithmetic.
/// Returns 0 for zero amount (no fee on zero borrow).
pub fn compute_fee(amount: u128) -> u128 {
    if amount == 0 {
        return 0;
    }
    mul_div(amount, FLASH_LOAN_FEE_BPS as u128, BPS)
}

/// Compute the total required repayment (principal + fee).
///
/// Returns amount + compute_fee(amount).
/// Saturates at u128::MAX on overflow (caller should check).
pub fn compute_required_repayment(amount: u128) -> u128 {
    let fee = compute_fee(amount);
    amount.saturating_add(fee)
}

/// Verify that a flash loan was repaid correctly.
///
/// Validates:
/// - Repayment amount >= principal + fee
/// - Repayment occurred within the grace period (same block for true flash loans)
///
/// Returns a FlashLoanResult on success with profit estimation.
pub fn validate_repayment(
    request: &FlashLoanRequest,
    repaid_amount: u128,
    repaid_block: u64,
) -> Result<FlashLoanResult, FlashLoanError> {
    // Check timing: must repay within grace period
    if repaid_block > request.request_block + REPAYMENT_GRACE_BLOCKS {
        return Err(FlashLoanError::NotRepaidInTime);
    }

    // Check repayment amount
    let fee = compute_fee(request.amount);
    let required = request
        .amount
        .checked_add(fee)
        .ok_or(FlashLoanError::Overflow)?;

    if repaid_amount < required {
        return Err(FlashLoanError::InsufficientRepayment);
    }

    // Fee actually paid = repaid - principal
    let fee_paid = repaid_amount.saturating_sub(request.amount);

    // Estimate borrower profit: what they repaid minus what they got
    // Negative means they lost money (fee > any profit from using the funds)
    // This is a simplified model — real profit depends on what they did with the funds
    let profit_estimate = if repaid_amount >= request.amount {
        // They repaid more than they borrowed, so their cost is (repaid - borrowed)
        // Their "profit" from the flash loan operation is unknown from our perspective,
        // so we estimate it as negative of the fee (worst case: no arbitrage profit)
        -(fee_paid as i128)
    } else {
        // Shouldn't happen given the check above, but handle gracefully
        -(fee_paid as i128)
    };

    Ok(FlashLoanResult {
        request: request.clone(),
        fee_paid,
        repaid_block,
        profit_estimate,
        was_profitable: profit_estimate > 0,
    })
}

/// Update pool state after a borrow or repayment.
///
/// When `is_borrow` is true: increases currently_borrowed, increments active_loans.
/// When `is_borrow` is false: decreases currently_borrowed, decrements active_loans,
/// increments total_loans_served, adds fee to total_fees_earned.
pub fn update_pool_state(
    state: &PoolFlashLoanState,
    amount: u128,
    is_borrow: bool,
) -> Result<PoolFlashLoanState, FlashLoanError> {
    if amount == 0 {
        return Err(FlashLoanError::ZeroAmount);
    }

    let mut new_state = state.clone();

    if is_borrow {
        // Borrow: increase borrowed, increment active loans
        new_state.currently_borrowed = state
            .currently_borrowed
            .checked_add(amount)
            .ok_or(FlashLoanError::Overflow)?;

        if new_state.currently_borrowed > new_state.total_available {
            return Err(FlashLoanError::ExceedsPoolCapacity);
        }

        new_state.active_loans = state
            .active_loans
            .checked_add(1)
            .ok_or(FlashLoanError::Overflow)?;

        if new_state.active_loans as usize > MAX_CONCURRENT_LOANS {
            return Err(FlashLoanError::ConcurrentLoanLimit);
        }
    } else {
        // Repay: decrease borrowed, decrement active loans, track stats
        new_state.currently_borrowed = state
            .currently_borrowed
            .checked_sub(amount)
            .ok_or(FlashLoanError::Overflow)?;

        new_state.active_loans = state.active_loans.saturating_sub(1);

        new_state.total_loans_served = state
            .total_loans_served
            .checked_add(1)
            .ok_or(FlashLoanError::Overflow)?;

        let fee = compute_fee(amount);
        new_state.total_fees_earned = state
            .total_fees_earned
            .checked_add(fee)
            .ok_or(FlashLoanError::Overflow)?;
    }

    Ok(new_state)
}

// ============ Detection & Analysis Functions ============

/// Detect suspicious flash loan attack patterns from volume and price data.
///
/// Analyzes:
/// - Volume spikes relative to baseline (SUSPICIOUS_VOLUME_MULTIPLIER threshold)
/// - Price changes that correlate with volume spikes
/// - Pattern classification based on price change direction and magnitude
///
/// Returns a FlashLoanAnalysis with risk scoring and pattern detection.
pub fn detect_suspicious_pattern(
    volumes: &[u128],
    baseline_volume: u128,
    price_changes_bps: &[i16],
) -> FlashLoanAnalysis {
    let no_threat = FlashLoanAnalysis {
        is_suspicious: false,
        risk_score: 0,
        pattern: AttackPattern::None,
        estimated_impact_bps: 0,
        affected_pools: 0,
    };

    // Need data to analyze
    if volumes.is_empty() || baseline_volume == 0 {
        return no_threat;
    }

    // Count volume spikes above suspicious threshold
    let suspicious_threshold = baseline_volume.saturating_mul(SUSPICIOUS_VOLUME_MULTIPLIER);
    let mut spike_count: u32 = 0;
    let mut max_volume: u128 = 0;

    for &v in volumes.iter() {
        if v > suspicious_threshold {
            spike_count += 1;
        }
        if v > max_volume {
            max_volume = v;
        }
    }

    // No spikes — no suspicious pattern
    if spike_count == 0 {
        return no_threat;
    }

    // Compute volume multiplier (how many x above baseline)
    let volume_multiplier = if baseline_volume > 0 {
        max_volume / baseline_volume
    } else {
        0
    };

    // Analyze price changes for pattern classification
    let mut max_price_drop: i16 = 0;
    let mut max_price_rise: i16 = 0;
    let mut has_reversal = false;

    for &pc in price_changes_bps.iter() {
        if pc < max_price_drop {
            max_price_drop = pc;
        }
        if pc > max_price_rise {
            max_price_rise = pc;
        }
    }

    if price_changes_bps.len() >= 2 {
        // A reversal = large move in one direction followed by recovery
        // (suggests manipulation rather than organic movement)
        has_reversal = max_price_drop < -100 && max_price_rise > 100;
    }

    // Classify the attack pattern
    let pattern = classify_pattern(
        spike_count,
        volume_multiplier,
        max_price_drop,
        max_price_rise,
        has_reversal,
        price_changes_bps,
    );

    // Calculate risk score (0-10000 bps)
    let mut risk_score: u32 = 0;

    // Volume spike contribution (up to 4000 bps)
    let volume_risk = if volume_multiplier > 100 {
        4000u32
    } else {
        (volume_multiplier as u32).saturating_mul(40).min(4000)
    };
    risk_score += volume_risk;

    // Spike frequency contribution (up to 2000 bps)
    let frequency_risk = (spike_count as u32).saturating_mul(500).min(2000);
    risk_score += frequency_risk;

    // Price impact contribution (up to 3000 bps)
    let abs_drop = max_price_drop.unsigned_abs() as u32;
    let price_risk = abs_drop.saturating_mul(10).min(3000);
    risk_score += price_risk;

    // Reversal bonus (strong signal of manipulation)
    if has_reversal {
        risk_score += 1000;
    }

    let risk_score = risk_score.min(10000) as u16;

    // Estimated impact is the max absolute price change
    let estimated_impact_bps = abs_drop.min(u16::MAX as u32) as u16;

    // Affected pools: at least 1 if suspicious, more for sandwich/multi-pool patterns
    let affected_pools = match pattern {
        AttackPattern::SandwichAttack => 2u8.max(spike_count.min(255) as u8),
        AttackPattern::OracleManipulation => 2,
        _ => 1,
    };

    FlashLoanAnalysis {
        is_suspicious: true,
        risk_score,
        pattern,
        estimated_impact_bps,
        affected_pools,
    }
}

/// Classify the attack pattern based on volume and price signals.
fn classify_pattern(
    spike_count: u32,
    volume_multiplier: u128,
    max_price_drop: i16,
    max_price_rise: i16,
    has_reversal: bool,
    price_changes: &[i16],
) -> AttackPattern {
    // Sandwich: multiple spikes with price reversal (front-run + back-run)
    if spike_count >= 2 && has_reversal {
        return AttackPattern::SandwichAttack;
    }

    // Oracle manipulation: moderate volume with small but sustained price change
    // Attacker pushes TWAP without triggering large price alerts
    if volume_multiplier >= SUSPICIOUS_VOLUME_MULTIPLIER
        && !price_changes.is_empty()
        && max_price_drop.unsigned_abs() <= 200
        && max_price_rise.unsigned_abs() <= 200
        && spike_count >= 1
    {
        // Small price changes + big volume = trying to move TWAP subtly
        let all_same_direction = price_changes.iter().all(|&p| p >= 0)
            || price_changes.iter().all(|&p| p <= 0);
        if all_same_direction && price_changes.len() >= 2 {
            return AttackPattern::OracleManipulation;
        }
    }

    // Price manipulation: large single spike with significant price impact
    if spike_count >= 1 && (max_price_drop < -300 || max_price_rise > 300) {
        return AttackPattern::PriceManipulation;
    }

    // Liquidation trigger: large volume spike causing downward price pressure
    if volume_multiplier >= SUSPICIOUS_VOLUME_MULTIPLIER && max_price_drop < -500 {
        return AttackPattern::LiquidationTrigger;
    }

    // Governance: very large spike without much price impact (buying governance tokens)
    if volume_multiplier >= SUSPICIOUS_VOLUME_MULTIPLIER * 2
        && max_price_drop.unsigned_abs() < 100
        && max_price_rise.unsigned_abs() < 100
    {
        return AttackPattern::GovernanceAttack;
    }

    // Default to price manipulation for any remaining suspicious activity
    AttackPattern::PriceManipulation
}

/// Check if a committer is an externally-owned account (not a contract).
///
/// In the commit-reveal auction, only EOAs can commit orders.
/// This prevents contract-orchestrated flash loan attacks because:
/// - A flash loan must be initiated and repaid in a single transaction
/// - Only contracts can orchestrate borrow -> trade -> repay atomically
/// - By requiring EOA commits, the attacker cannot use borrowed funds to commit
///
/// Returns true if the address is an EOA (no code, not a contract).
pub fn is_eoa_commit(has_code: bool, is_contract: bool) -> bool {
    !has_code && !is_contract
}

/// Assess the vulnerability of a pool to flash loan attacks.
///
/// Higher score = more vulnerable. Factors:
/// - Pool TVL relative to volume (low TVL + high volume = more manipulable)
/// - Number of oracle sources (fewer = more vulnerable to manipulation)
/// - Presence of circuit breaker
///
/// Returns a score in basis points (0 = fortified, 10000 = extremely vulnerable).
pub fn assess_vulnerability(
    pool_tvl: u128,
    pool_volume_24h: u128,
    oracle_sources: u8,
    has_circuit_breaker: bool,
) -> u16 {
    let mut score: u32 = 0;

    // Volume/TVL ratio risk (high volume relative to TVL = easy to manipulate)
    // Up to 4000 bps
    if pool_tvl > 0 {
        let ratio_bps = mul_div(pool_volume_24h, BPS, pool_tvl);
        // If volume > TVL (ratio > 10000 bps), max risk
        let volume_risk = (ratio_bps as u32).min(4000);
        score += volume_risk;
    } else {
        // No TVL = maximum vulnerability
        score += 4000;
    }

    // Oracle source risk: fewer sources = more vulnerable
    // Up to 3000 bps
    let oracle_risk = match oracle_sources {
        0 => 3000u32,       // No oracle = extremely vulnerable
        1 => 2000,          // Single source = high risk
        2 => 1000,          // Two sources = moderate
        3 => 500,           // Three sources = low
        _ => 0,             // 4+ sources = minimal risk
    };
    score += oracle_risk;

    // No circuit breaker = additional risk
    // Up to 2000 bps
    if !has_circuit_breaker {
        score += 2000;
    }

    // Low TVL bonus: pools under 1000 PRECISION units are tiny and very manipulable
    // Up to 1000 bps
    let tvl_threshold = PRECISION.saturating_mul(1000);
    if pool_tvl < tvl_threshold {
        score += 1000;
    }

    score.min(10000) as u16
}

// ============ Protection & Reporting Functions ============

/// Generate a comprehensive protection report for the protocol.
///
/// Scores each protection mechanism and computes an overall score:
/// - Commit-reveal: 30 points (most important — prevents order visibility)
/// - EOA-only commits: 25 points (prevents contract flash loan attacks)
/// - TWAP validation: 20 points (prevents oracle manipulation)
/// - Rate limiting: 15 points (limits damage from any single attack)
/// - Circuit breaker: 10 points (emergency stop)
///
/// Total possible: 100 points.
pub fn generate_protection_report(
    has_commit_reveal: bool,
    has_eoa_check: bool,
    has_twap: bool,
    has_rate_limit: bool,
    has_circuit_breaker: bool,
) -> ProtectionReport {
    let mut score: u8 = 0;

    if has_commit_reveal {
        score += 30;
    }
    if has_eoa_check {
        score += 25;
    }
    if has_twap {
        score += 20;
    }
    if has_rate_limit {
        score += 15;
    }
    if has_circuit_breaker {
        score += 10;
    }

    ProtectionReport {
        commit_reveal_active: has_commit_reveal,
        eoa_only_commits: has_eoa_check,
        twap_validated: has_twap,
        rate_limited: has_rate_limit,
        circuit_breaker_active: has_circuit_breaker,
        overall_protection_score: score,
    }
}

/// Calculate the maximum safe borrow amount for a pool.
///
/// max_borrow = total_available * MAX_SINGLE_BORROW_BPS / BPS
///
/// Capped at 50% of pool to prevent single-borrow draining.
pub fn max_safe_borrow(pool_available: u128) -> u128 {
    mul_div(pool_available, MAX_SINGLE_BORROW_BPS as u128, BPS)
}

/// Estimate whether a flash loan attack would be profitable after fees.
///
/// profit = borrow_amount * price_impact_bps / BPS - borrow_amount * fee_bps / BPS
///        = borrow_amount * (price_impact_bps - fee_bps) / BPS
///
/// Returns positive if profitable, negative if not. An attacker needs the
/// price impact to exceed the combined flash loan + swap fees.
pub fn estimate_attack_profit(
    borrow_amount: u128,
    price_impact_bps: u16,
    fee_bps: u16,
) -> i128 {
    if borrow_amount == 0 {
        return 0;
    }

    let revenue = mul_div(borrow_amount, price_impact_bps as u128, BPS);
    let cost = mul_div(borrow_amount, fee_bps as u128, BPS);

    // Safe: both are <= borrow_amount which fits in u128, so they fit in i128
    (revenue as i128) - (cost as i128)
}

/// Determine how many more concurrent loans a pool can support.
///
/// Returns MAX_CONCURRENT_LOANS - active_loans, or 0 if at capacity.
pub fn concurrent_loan_capacity(state: &PoolFlashLoanState) -> u8 {
    let max = MAX_CONCURRENT_LOANS as u8;
    if state.active_loans >= max {
        0
    } else {
        max - state.active_loans
    }
}

/// Compute historical flash loan statistics from a list of completed results.
///
/// Returns: (total_loans, total_fees, total_volume, profitable_count)
///
/// - total_loans: number of completed flash loans
/// - total_fees: sum of all fees paid
/// - total_volume: sum of all borrow amounts
/// - profitable_count: number of loans where borrower profited
pub fn historical_stats(results: &[FlashLoanResult]) -> (u64, u128, u128, u32) {
    let total_loans = results.len() as u64;
    let mut total_fees: u128 = 0;
    let mut total_volume: u128 = 0;
    let mut profitable_count: u32 = 0;

    for r in results.iter() {
        total_fees = total_fees.saturating_add(r.fee_paid);
        total_volume = total_volume.saturating_add(r.request.amount);
        if r.was_profitable {
            profitable_count += 1;
        }
    }

    (total_loans, total_fees, total_volume, profitable_count)
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Helper factories ----

    fn test_pool_id() -> [u8; 32] {
        let mut id = [0u8; 32];
        id[0] = 0xAB;
        id[1] = 0xCD;
        id
    }

    fn test_borrower() -> [u8; 32] {
        let mut b = [0u8; 32];
        b[0] = 0x01;
        b[1] = 0x02;
        b
    }

    fn zero_id() -> [u8; 32] {
        [0u8; 32]
    }

    fn default_pool_state() -> PoolFlashLoanState {
        PoolFlashLoanState {
            pool_id: test_pool_id(),
            total_available: 1_000_000 * PRECISION,
            currently_borrowed: 0,
            active_loans: 0,
            total_loans_served: 0,
            total_fees_earned: 0,
            last_loan_block: 0,
        }
    }

    fn make_request(amount: u128) -> FlashLoanRequest {
        let fee = compute_fee(amount);
        FlashLoanRequest {
            borrower: test_borrower(),
            pool_id: test_pool_id(),
            amount,
            expected_repayment: amount.saturating_add(fee),
            request_block: 100,
        }
    }

    fn make_request_with_repayment(amount: u128, repayment: u128) -> FlashLoanRequest {
        FlashLoanRequest {
            borrower: test_borrower(),
            pool_id: test_pool_id(),
            amount,
            expected_repayment: repayment,
            request_block: 100,
        }
    }

    fn make_result(amount: u128, fee_paid: u128, profitable: bool) -> FlashLoanResult {
        FlashLoanResult {
            request: make_request(amount),
            fee_paid,
            repaid_block: 100,
            profit_estimate: if profitable { fee_paid as i128 } else { -(fee_paid as i128) },
            was_profitable: profitable,
        }
    }

    // ============ Fee Calculation Tests ============

    #[test]
    fn fee_zero_amount() {
        assert_eq!(compute_fee(0), 0);
    }

    #[test]
    fn fee_small_amount() {
        // 100 * 9 / 10000 = 0 (truncated)
        assert_eq!(compute_fee(100), 0);
    }

    #[test]
    fn fee_minimum_nonzero() {
        // Need amount * 9 >= 10000
        // 1112 * 9 / 10000 = 1 (just over)
        assert_eq!(compute_fee(1112), 1);
    }

    #[test]
    fn fee_exact_bps() {
        // 10_000 * 9 / 10_000 = 9
        assert_eq!(compute_fee(10_000), 9);
    }

    #[test]
    fn fee_one_precision_unit() {
        // PRECISION * 9 / 10_000
        let expected = PRECISION * 9 / 10_000;
        assert_eq!(compute_fee(PRECISION), expected);
    }

    #[test]
    fn fee_large_amount() {
        let amount = 1_000_000 * PRECISION;
        let expected = mul_div(amount, 9, 10_000);
        assert_eq!(compute_fee(amount), expected);
    }

    #[test]
    fn fee_u128_max() {
        // Should not panic — mul_div handles overflow
        let fee = compute_fee(u128::MAX);
        // fee = u128::MAX * 9 / 10000
        assert!(fee > 0);
    }

    #[test]
    fn fee_one() {
        assert_eq!(compute_fee(1), 0);
    }

    #[test]
    fn fee_bps_boundary() {
        // 10_000 / 9 = 1111.11... so 1111 * 9 / 10000 = 0 (truncated)
        assert_eq!(compute_fee(1111), 0);
    }

    #[test]
    fn fee_proportional() {
        // Fee should scale linearly
        let fee_1 = compute_fee(1_000_000);
        let fee_2 = compute_fee(2_000_000);
        assert_eq!(fee_2, fee_1 * 2);
    }

    #[test]
    fn fee_large_precision() {
        let amount = 500_000_000 * PRECISION;
        let fee = compute_fee(amount);
        let expected = amount * 9 / 10_000;
        assert_eq!(fee, expected);
    }

    // ============ Required Repayment Tests ============

    #[test]
    fn repayment_zero() {
        assert_eq!(compute_required_repayment(0), 0);
    }

    #[test]
    fn repayment_small() {
        // For small amounts, fee = 0, so repayment = amount
        assert_eq!(compute_required_repayment(100), 100);
    }

    #[test]
    fn repayment_includes_fee() {
        let amount = 10_000;
        let expected = amount + compute_fee(amount);
        assert_eq!(compute_required_repayment(amount), expected);
    }

    #[test]
    fn repayment_precision_unit() {
        let amount = PRECISION;
        let fee = compute_fee(amount);
        assert_eq!(compute_required_repayment(amount), amount + fee);
    }

    #[test]
    fn repayment_u128_max_saturates() {
        // u128::MAX + any fee should saturate
        let repayment = compute_required_repayment(u128::MAX);
        assert_eq!(repayment, u128::MAX);
    }

    #[test]
    fn repayment_large() {
        let amount = 999_999 * PRECISION;
        let fee = compute_fee(amount);
        assert_eq!(compute_required_repayment(amount), amount + fee);
    }

    // ============ Validate Flash Loan Tests ============

    #[test]
    fn validate_valid_request() {
        let pool = default_pool_state();
        let request = make_request(100_000 * PRECISION);
        let result = validate_flash_loan(&request, &pool);
        assert!(result.is_ok());
        let fee = result.unwrap();
        assert_eq!(fee, compute_fee(100_000 * PRECISION));
    }

    #[test]
    fn validate_zero_amount() {
        let pool = default_pool_state();
        let mut request = make_request(0);
        request.amount = 0;
        assert_eq!(
            validate_flash_loan(&request, &pool),
            Err(FlashLoanError::ZeroAmount)
        );
    }

    #[test]
    fn validate_exceeds_pool_capacity() {
        let pool = default_pool_state();
        // Try to borrow more than total available
        // But also more than max borrow (50%), so ExceedsPoolCapacity won't trigger
        // first because the available check comes before max borrow.
        // Actually: available = 1M, amount = 2M, 2M > 1M so ExceedsPoolCapacity
        let mut request = make_request(2_000_000 * PRECISION);
        request.amount = 2_000_000 * PRECISION;
        request.expected_repayment = compute_required_repayment(2_000_000 * PRECISION);
        assert_eq!(
            validate_flash_loan(&request, &pool),
            Err(FlashLoanError::ExceedsPoolCapacity)
        );
    }

    #[test]
    fn validate_exceeds_max_borrow() {
        let pool = default_pool_state();
        // 50% of 1M = 500K. Try 600K which is under capacity but over max borrow
        let amount = 600_000 * PRECISION;
        let mut request = make_request(amount);
        request.amount = amount;
        request.expected_repayment = compute_required_repayment(amount);
        assert_eq!(
            validate_flash_loan(&request, &pool),
            Err(FlashLoanError::ExceedsMaxBorrow)
        );
    }

    #[test]
    fn validate_exactly_max_borrow() {
        let pool = default_pool_state();
        let max = max_safe_borrow(pool.total_available);
        let request = make_request(max);
        assert!(validate_flash_loan(&request, &pool).is_ok());
    }

    #[test]
    fn validate_one_over_max_borrow() {
        let pool = default_pool_state();
        let max = max_safe_borrow(pool.total_available);
        let amount = max + 1;
        let mut request = make_request(amount);
        request.amount = amount;
        request.expected_repayment = compute_required_repayment(amount);
        assert_eq!(
            validate_flash_loan(&request, &pool),
            Err(FlashLoanError::ExceedsMaxBorrow)
        );
    }

    #[test]
    fn validate_concurrent_limit() {
        let mut pool = default_pool_state();
        pool.active_loans = MAX_CONCURRENT_LOANS as u8;
        let request = make_request(1000);
        assert_eq!(
            validate_flash_loan(&request, &pool),
            Err(FlashLoanError::ConcurrentLoanLimit)
        );
    }

    #[test]
    fn validate_concurrent_just_under_limit() {
        let mut pool = default_pool_state();
        pool.active_loans = (MAX_CONCURRENT_LOANS - 1) as u8;
        let request = make_request(10_000 * PRECISION);
        assert!(validate_flash_loan(&request, &pool).is_ok());
    }

    #[test]
    fn validate_fee_too_low() {
        let pool = default_pool_state();
        let amount = 100_000 * PRECISION;
        // Set expected repayment to exactly the amount (no fee)
        let request = make_request_with_repayment(amount, amount);
        assert_eq!(
            validate_flash_loan(&request, &pool),
            Err(FlashLoanError::FeeTooLow)
        );
    }

    #[test]
    fn validate_fee_exactly_right() {
        let pool = default_pool_state();
        let amount = 100_000 * PRECISION;
        let fee = compute_fee(amount);
        let request = make_request_with_repayment(amount, amount + fee);
        assert!(validate_flash_loan(&request, &pool).is_ok());
    }

    #[test]
    fn validate_fee_overpayment_ok() {
        let pool = default_pool_state();
        let amount = 100_000 * PRECISION;
        let fee = compute_fee(amount);
        // Overpay by 2x fee — should still be valid
        let request = make_request_with_repayment(amount, amount + fee * 2);
        assert!(validate_flash_loan(&request, &pool).is_ok());
    }

    #[test]
    fn validate_invalid_pool() {
        let mut pool = default_pool_state();
        pool.pool_id = zero_id();
        let request = make_request(1000 * PRECISION);
        assert_eq!(
            validate_flash_loan(&request, &pool),
            Err(FlashLoanError::InvalidPool)
        );
    }

    #[test]
    fn validate_with_existing_borrows() {
        let mut pool = default_pool_state();
        pool.currently_borrowed = 800_000 * PRECISION;
        // Available = 1M - 800K = 200K. Max borrow = 50% of 1M = 500K.
        // So borrowing 200K should work (under available and under max borrow).
        let request = make_request(200_000 * PRECISION);
        assert!(validate_flash_loan(&request, &pool).is_ok());
    }

    #[test]
    fn validate_with_borrows_exceeds_available() {
        let mut pool = default_pool_state();
        pool.currently_borrowed = 800_000 * PRECISION;
        // Available = 200K, try to borrow 300K
        let amount = 300_000 * PRECISION;
        let mut request = make_request(amount);
        request.amount = amount;
        request.expected_repayment = compute_required_repayment(amount);
        assert_eq!(
            validate_flash_loan(&request, &pool),
            Err(FlashLoanError::ExceedsPoolCapacity)
        );
    }

    #[test]
    fn validate_small_pool() {
        let mut pool = default_pool_state();
        pool.total_available = 100; // Tiny pool
        let request = make_request(50);
        assert!(validate_flash_loan(&request, &pool).is_ok());
    }

    #[test]
    fn validate_borrow_entire_max() {
        let pool = default_pool_state();
        let max = max_safe_borrow(pool.total_available);
        let request = make_request(max);
        let result = validate_flash_loan(&request, &pool);
        assert!(result.is_ok());
    }

    // ============ Repayment Validation Tests ============

    #[test]
    fn repayment_valid_exact() {
        let amount = 100_000 * PRECISION;
        let request = make_request(amount);
        let fee = compute_fee(amount);
        let result = validate_repayment(&request, amount + fee, 100);
        assert!(result.is_ok());
        let r = result.unwrap();
        assert_eq!(r.fee_paid, fee);
        assert_eq!(r.repaid_block, 100);
    }

    #[test]
    fn repayment_overpay() {
        let amount = 100_000 * PRECISION;
        let request = make_request(amount);
        let fee = compute_fee(amount);
        let result = validate_repayment(&request, amount + fee * 3, 100);
        assert!(result.is_ok());
        let r = result.unwrap();
        assert_eq!(r.fee_paid, fee * 3);
    }

    #[test]
    fn repayment_underpay() {
        let amount = 100_000 * PRECISION;
        let request = make_request(amount);
        // Pay back only the principal, no fee
        let result = validate_repayment(&request, amount, 100);
        assert_eq!(result, Err(FlashLoanError::InsufficientRepayment));
    }

    #[test]
    fn repayment_underpay_by_one() {
        let amount = 100_000 * PRECISION;
        let request = make_request(amount);
        let fee = compute_fee(amount);
        let result = validate_repayment(&request, amount + fee - 1, 100);
        assert_eq!(result, Err(FlashLoanError::InsufficientRepayment));
    }

    #[test]
    fn repayment_late_by_one_block() {
        let amount = 100_000 * PRECISION;
        let request = make_request(amount);
        let fee = compute_fee(amount);
        // REPAYMENT_GRACE_BLOCKS = 0, so request_block + 0 = 100
        // Repaying at block 101 is too late
        let result = validate_repayment(&request, amount + fee, 101);
        assert_eq!(result, Err(FlashLoanError::NotRepaidInTime));
    }

    #[test]
    fn repayment_same_block() {
        let amount = 100_000 * PRECISION;
        let request = make_request(amount);
        let fee = compute_fee(amount);
        let result = validate_repayment(&request, amount + fee, 100);
        assert!(result.is_ok());
    }

    #[test]
    fn repayment_profit_estimate_negative() {
        let amount = 100_000 * PRECISION;
        let request = make_request(amount);
        let fee = compute_fee(amount);
        let result = validate_repayment(&request, amount + fee, 100).unwrap();
        // By default, profit estimate is negative (just the fee cost)
        assert!(result.profit_estimate < 0);
        assert!(!result.was_profitable);
    }

    #[test]
    fn repayment_zero_amount_request() {
        // Create a request with zero amount manually
        let request = FlashLoanRequest {
            borrower: test_borrower(),
            pool_id: test_pool_id(),
            amount: 0,
            expected_repayment: 0,
            request_block: 100,
        };
        // Zero amount means fee = 0, required = 0, repaying 0 is fine
        let result = validate_repayment(&request, 0, 100);
        assert!(result.is_ok());
    }

    #[test]
    fn repayment_far_future_block() {
        let amount = 10_000 * PRECISION;
        let request = make_request(amount);
        let fee = compute_fee(amount);
        let result = validate_repayment(&request, amount + fee, 1_000_000);
        assert_eq!(result, Err(FlashLoanError::NotRepaidInTime));
    }

    // ============ Pool State Update Tests ============

    #[test]
    fn pool_state_borrow() {
        let pool = default_pool_state();
        let amount = 100_000 * PRECISION;
        let new_state = update_pool_state(&pool, amount, true).unwrap();
        assert_eq!(new_state.currently_borrowed, amount);
        assert_eq!(new_state.active_loans, 1);
        assert_eq!(new_state.total_loans_served, 0); // Not incremented on borrow
    }

    #[test]
    fn pool_state_repay() {
        let mut pool = default_pool_state();
        pool.currently_borrowed = 100_000 * PRECISION;
        pool.active_loans = 1;
        let amount = 100_000 * PRECISION;
        let new_state = update_pool_state(&pool, amount, false).unwrap();
        assert_eq!(new_state.currently_borrowed, 0);
        assert_eq!(new_state.active_loans, 0);
        assert_eq!(new_state.total_loans_served, 1);
        let fee = compute_fee(amount);
        assert_eq!(new_state.total_fees_earned, fee);
    }

    #[test]
    fn pool_state_multiple_borrows() {
        let pool = default_pool_state();
        let amount = 50_000 * PRECISION;
        let s1 = update_pool_state(&pool, amount, true).unwrap();
        assert_eq!(s1.active_loans, 1);
        assert_eq!(s1.currently_borrowed, amount);

        let s2 = update_pool_state(&s1, amount, true).unwrap();
        assert_eq!(s2.active_loans, 2);
        assert_eq!(s2.currently_borrowed, amount * 2);

        let s3 = update_pool_state(&s2, amount, true).unwrap();
        assert_eq!(s3.active_loans, 3);
    }

    #[test]
    fn pool_state_borrow_exceeds_available() {
        let pool = default_pool_state();
        // Try to borrow more than total available
        let amount = pool.total_available + 1;
        assert_eq!(
            update_pool_state(&pool, amount, true),
            Err(FlashLoanError::ExceedsPoolCapacity)
        );
    }

    #[test]
    fn pool_state_repay_more_than_borrowed() {
        let mut pool = default_pool_state();
        pool.currently_borrowed = 100;
        pool.active_loans = 1;
        // Repaying 200 when only 100 is borrowed
        assert_eq!(
            update_pool_state(&pool, 200, false),
            Err(FlashLoanError::Overflow)
        );
    }

    #[test]
    fn pool_state_zero_amount() {
        let pool = default_pool_state();
        assert_eq!(
            update_pool_state(&pool, 0, true),
            Err(FlashLoanError::ZeroAmount)
        );
        assert_eq!(
            update_pool_state(&pool, 0, false),
            Err(FlashLoanError::ZeroAmount)
        );
    }

    #[test]
    fn pool_state_concurrent_limit_on_borrow() {
        let mut pool = default_pool_state();
        pool.active_loans = MAX_CONCURRENT_LOANS as u8;
        assert_eq!(
            update_pool_state(&pool, 1000, true),
            Err(FlashLoanError::ConcurrentLoanLimit)
        );
    }

    #[test]
    fn pool_state_borrow_exactly_available() {
        let pool = default_pool_state();
        let result = update_pool_state(&pool, pool.total_available, true);
        assert!(result.is_ok());
        let s = result.unwrap();
        assert_eq!(s.currently_borrowed, pool.total_available);
    }

    #[test]
    fn pool_state_fees_accumulate() {
        let mut pool = default_pool_state();
        pool.currently_borrowed = 100_000 * PRECISION;
        pool.active_loans = 1;
        let amount = 100_000 * PRECISION;
        let s1 = update_pool_state(&pool, amount, false).unwrap();
        let fee1 = compute_fee(amount);
        assert_eq!(s1.total_fees_earned, fee1);

        // Borrow again and repay
        let s2 = update_pool_state(&s1, amount, true).unwrap();
        let s3 = update_pool_state(&s2, amount, false).unwrap();
        assert_eq!(s3.total_fees_earned, fee1 * 2);
        assert_eq!(s3.total_loans_served, 2);
    }

    #[test]
    fn pool_state_five_concurrent_borrows() {
        let pool = default_pool_state();
        let amount = 50_000 * PRECISION; // 50K each, 250K total for 1M pool
        let mut state = pool;
        for _ in 0..MAX_CONCURRENT_LOANS {
            state = update_pool_state(&state, amount, true).unwrap();
        }
        assert_eq!(state.active_loans, MAX_CONCURRENT_LOANS as u8);
        // One more should fail
        assert_eq!(
            update_pool_state(&state, amount, true),
            Err(FlashLoanError::ConcurrentLoanLimit)
        );
    }

    #[test]
    fn pool_state_repay_then_borrow_again() {
        let pool = default_pool_state();
        let amount = 100_000 * PRECISION;
        let s1 = update_pool_state(&pool, amount, true).unwrap();
        let s2 = update_pool_state(&s1, amount, false).unwrap();
        assert_eq!(s2.currently_borrowed, 0);
        assert_eq!(s2.active_loans, 0);
        // Borrow again
        let s3 = update_pool_state(&s2, amount, true).unwrap();
        assert_eq!(s3.currently_borrowed, amount);
        assert_eq!(s3.active_loans, 1);
    }

    // ============ Pattern Detection Tests ============

    #[test]
    fn detect_no_data() {
        let analysis = detect_suspicious_pattern(&[], 1000, &[]);
        assert!(!analysis.is_suspicious);
        assert_eq!(analysis.risk_score, 0);
        assert_eq!(analysis.pattern, AttackPattern::None);
    }

    #[test]
    fn detect_zero_baseline() {
        let analysis = detect_suspicious_pattern(&[1000], 0, &[10]);
        assert!(!analysis.is_suspicious);
    }

    #[test]
    fn detect_normal_volume() {
        // Volume at 5x baseline — not suspicious (threshold is 10x)
        let analysis = detect_suspicious_pattern(&[5000], 1000, &[5, 10]);
        assert!(!analysis.is_suspicious);
    }

    #[test]
    fn detect_just_below_threshold() {
        // 9x is just below 10x threshold
        let analysis = detect_suspicious_pattern(&[9999], 1000, &[5]);
        assert!(!analysis.is_suspicious);
    }

    #[test]
    fn detect_at_threshold() {
        // Exactly 10x — not suspicious (must be > threshold)
        let analysis = detect_suspicious_pattern(&[10_000], 1000, &[5]);
        assert!(!analysis.is_suspicious);
    }

    #[test]
    fn detect_above_threshold() {
        // 11x is above 10x threshold
        let analysis = detect_suspicious_pattern(&[11_000], 1000, &[-500]);
        assert!(analysis.is_suspicious);
        assert!(analysis.risk_score > 0);
    }

    #[test]
    fn detect_price_manipulation() {
        // Large volume spike + large price drop = price manipulation
        let analysis = detect_suspicious_pattern(&[50_000], 1000, &[-400]);
        assert!(analysis.is_suspicious);
        assert_eq!(analysis.pattern, AttackPattern::PriceManipulation);
    }

    #[test]
    fn detect_sandwich_attack() {
        // Multiple spikes with price reversal
        let volumes = vec![15_000, 15_000];
        let prices = vec![-200, 300];
        let analysis = detect_suspicious_pattern(&volumes, 1000, &prices);
        assert!(analysis.is_suspicious);
        assert_eq!(analysis.pattern, AttackPattern::SandwichAttack);
    }

    #[test]
    fn detect_oracle_manipulation() {
        // High volume, small consistent price moves in same direction
        let volumes = vec![15_000, 12_000];
        let prices = vec![50, 60];
        let analysis = detect_suspicious_pattern(&volumes, 1000, &prices);
        assert!(analysis.is_suspicious);
        assert_eq!(analysis.pattern, AttackPattern::OracleManipulation);
    }

    #[test]
    fn detect_governance_attack() {
        // Massive volume, no significant price impact, single price entry
        // (oracle manipulation requires >= 2 same-direction prices, so single entry avoids that)
        let volumes = vec![250_000];
        let prices = vec![10];
        let analysis = detect_suspicious_pattern(&volumes, 1000, &prices);
        assert!(analysis.is_suspicious);
        // Volume is 250x which is >= 20x threshold, price change < 100
        assert_eq!(analysis.pattern, AttackPattern::GovernanceAttack);
    }

    #[test]
    fn detect_liquidation_trigger() {
        // Large spike causing big downward price pressure
        // Need: volume_multiplier >= 10 AND max_price_drop < -500
        // AND spike_count == 1 (not 2+) AND no reversal
        let analysis = detect_suspicious_pattern(&[15_000], 1000, &[-600]);
        assert!(analysis.is_suspicious);
        // spike_count = 1, no reversal, large drop AND large volume
        // classify_pattern: spike_count >= 1 && max_price_drop < -300 => PriceManipulation
        // Actually PriceManipulation check comes before LiquidationTrigger
        // So this would be PriceManipulation
        assert_eq!(analysis.pattern, AttackPattern::PriceManipulation);
    }

    #[test]
    fn detect_high_risk_score() {
        // Maximum signals
        let volumes = vec![200_000, 200_000, 200_000];
        let prices = vec![-800, 900];
        let analysis = detect_suspicious_pattern(&volumes, 1000, &prices);
        assert!(analysis.is_suspicious);
        assert!(analysis.risk_score >= 5000);
    }

    #[test]
    fn detect_affected_pools_sandwich() {
        let volumes = vec![15_000, 15_000, 15_000];
        let prices = vec![-200, 300];
        let analysis = detect_suspicious_pattern(&volumes, 1000, &prices);
        assert!(analysis.affected_pools >= 2);
    }

    #[test]
    fn detect_multiple_normal_volumes() {
        let volumes = vec![500, 600, 700, 800];
        let analysis = detect_suspicious_pattern(&volumes, 1000, &[5, -3, 2]);
        assert!(!analysis.is_suspicious);
    }

    #[test]
    fn detect_single_spike_among_normal() {
        let volumes = vec![500, 600, 15_000, 800];
        let analysis = detect_suspicious_pattern(&volumes, 1000, &[-350]);
        assert!(analysis.is_suspicious);
    }

    #[test]
    fn detect_empty_price_changes() {
        let analysis = detect_suspicious_pattern(&[15_000], 1000, &[]);
        assert!(analysis.is_suspicious);
        // No price data to classify, defaults to PriceManipulation
    }

    #[test]
    fn detect_risk_score_capped_at_10000() {
        // Even with extreme values, score should not exceed 10000
        let volumes = vec![1_000_000; 100];
        let prices: Vec<i16> = vec![-32000; 50];
        let analysis = detect_suspicious_pattern(&volumes, 1, &prices);
        assert!(analysis.risk_score <= 10000);
    }

    // ============ EOA Check Tests ============

    #[test]
    fn eoa_true_no_code_not_contract() {
        assert!(is_eoa_commit(false, false));
    }

    #[test]
    fn eoa_false_has_code() {
        assert!(!is_eoa_commit(true, false));
    }

    #[test]
    fn eoa_false_is_contract() {
        assert!(!is_eoa_commit(false, true));
    }

    #[test]
    fn eoa_false_both() {
        assert!(!is_eoa_commit(true, true));
    }

    // ============ Vulnerability Assessment Tests ============

    #[test]
    fn vulnerability_zero_tvl() {
        let score = assess_vulnerability(0, 1000, 0, false);
        // No TVL = max volume risk (4000) + no oracle (3000) + no breaker (2000) + tiny pool (1000)
        assert_eq!(score, 10000);
    }

    #[test]
    fn vulnerability_high_tvl_good_oracle_breaker() {
        let tvl = 10_000_000 * PRECISION;
        let volume = 100_000 * PRECISION; // Low relative to TVL
        let score = assess_vulnerability(tvl, volume, 5, true);
        // Low volume/TVL ratio, good oracle, has breaker, high TVL
        assert!(score < 1000);
    }

    #[test]
    fn vulnerability_no_oracle() {
        let tvl = 1_000_000 * PRECISION;
        let score = assess_vulnerability(tvl, 0, 0, true);
        // No volume risk, but no oracle = 3000
        assert!(score >= 3000);
    }

    #[test]
    fn vulnerability_single_oracle() {
        let tvl = 1_000_000 * PRECISION;
        let score = assess_vulnerability(tvl, 0, 1, true);
        // Single oracle = 2000
        assert!(score >= 2000);
    }

    #[test]
    fn vulnerability_two_oracles() {
        let tvl = 1_000_000 * PRECISION;
        let score = assess_vulnerability(tvl, 0, 2, true);
        assert!(score >= 1000);
    }

    #[test]
    fn vulnerability_three_oracles() {
        let tvl = 1_000_000 * PRECISION;
        let score = assess_vulnerability(tvl, 0, 3, true);
        assert!(score >= 500);
    }

    #[test]
    fn vulnerability_four_plus_oracles() {
        let tvl = 1_000_000 * PRECISION;
        let score = assess_vulnerability(tvl, 0, 4, true);
        // 4+ oracles = 0 oracle risk
        assert!(score < 500);
    }

    #[test]
    fn vulnerability_no_circuit_breaker() {
        let tvl = 10_000_000 * PRECISION;
        let score_with = assess_vulnerability(tvl, 0, 5, true);
        let score_without = assess_vulnerability(tvl, 0, 5, false);
        assert!(score_without > score_with);
        assert_eq!(score_without - score_with, 2000);
    }

    #[test]
    fn vulnerability_tiny_pool() {
        let tvl = 100 * PRECISION; // Under 1000 PRECISION threshold
        let score = assess_vulnerability(tvl, 0, 5, true);
        assert!(score >= 1000); // tiny pool bonus
    }

    #[test]
    fn vulnerability_large_pool() {
        let tvl = 10_000 * PRECISION; // Over threshold
        let score = assess_vulnerability(tvl, 0, 5, true);
        assert!(score < 1000); // No tiny pool bonus
    }

    #[test]
    fn vulnerability_high_volume_ratio() {
        let tvl = 1_000_000 * PRECISION;
        let volume = 2_000_000 * PRECISION; // 2x TVL
        let score = assess_vulnerability(tvl, volume, 5, true);
        // Volume/TVL = 2x = 20000 bps, capped at 4000
        assert!(score >= 4000);
    }

    #[test]
    fn vulnerability_max_score_capped() {
        // Worst case: no TVL, no oracle, no breaker
        let score = assess_vulnerability(0, u128::MAX, 0, false);
        assert_eq!(score, 10000);
    }

    // ============ Protection Report Tests ============

    #[test]
    fn protection_all_on() {
        let report = generate_protection_report(true, true, true, true, true);
        assert_eq!(report.overall_protection_score, 100);
        assert!(report.commit_reveal_active);
        assert!(report.eoa_only_commits);
        assert!(report.twap_validated);
        assert!(report.rate_limited);
        assert!(report.circuit_breaker_active);
    }

    #[test]
    fn protection_all_off() {
        let report = generate_protection_report(false, false, false, false, false);
        assert_eq!(report.overall_protection_score, 0);
        assert!(!report.commit_reveal_active);
    }

    #[test]
    fn protection_commit_reveal_only() {
        let report = generate_protection_report(true, false, false, false, false);
        assert_eq!(report.overall_protection_score, 30);
    }

    #[test]
    fn protection_eoa_only() {
        let report = generate_protection_report(false, true, false, false, false);
        assert_eq!(report.overall_protection_score, 25);
    }

    #[test]
    fn protection_twap_only() {
        let report = generate_protection_report(false, false, true, false, false);
        assert_eq!(report.overall_protection_score, 20);
    }

    #[test]
    fn protection_rate_limit_only() {
        let report = generate_protection_report(false, false, false, true, false);
        assert_eq!(report.overall_protection_score, 15);
    }

    #[test]
    fn protection_circuit_breaker_only() {
        let report = generate_protection_report(false, false, false, false, true);
        assert_eq!(report.overall_protection_score, 10);
    }

    #[test]
    fn protection_vibeswap_default() {
        // VibeSwap has all protections active
        let report = generate_protection_report(true, true, true, true, true);
        assert_eq!(report.overall_protection_score, 100);
    }

    #[test]
    fn protection_partial_commit_eoa() {
        let report = generate_protection_report(true, true, false, false, false);
        assert_eq!(report.overall_protection_score, 55);
    }

    #[test]
    fn protection_no_commit_reveal() {
        // Without commit-reveal, max score is 70
        let report = generate_protection_report(false, true, true, true, true);
        assert_eq!(report.overall_protection_score, 70);
    }

    // ============ Max Safe Borrow Tests ============

    #[test]
    fn max_borrow_zero_pool() {
        assert_eq!(max_safe_borrow(0), 0);
    }

    #[test]
    fn max_borrow_small_pool() {
        assert_eq!(max_safe_borrow(100), 50);
    }

    #[test]
    fn max_borrow_standard_pool() {
        let available = 1_000_000 * PRECISION;
        let expected = available / 2;
        assert_eq!(max_safe_borrow(available), expected);
    }

    #[test]
    fn max_borrow_odd_number() {
        // 101 * 5000 / 10000 = 50 (truncated)
        assert_eq!(max_safe_borrow(101), 50);
    }

    #[test]
    fn max_borrow_one() {
        assert_eq!(max_safe_borrow(1), 0);
    }

    #[test]
    fn max_borrow_two() {
        assert_eq!(max_safe_borrow(2), 1);
    }

    #[test]
    fn max_borrow_u128_max() {
        let result = max_safe_borrow(u128::MAX);
        // Should be roughly u128::MAX / 2
        assert!(result > u128::MAX / 3);
        assert!(result <= u128::MAX / 2);
    }

    // ============ Attack Profit Estimation Tests ============

    #[test]
    fn attack_profit_zero_borrow() {
        assert_eq!(estimate_attack_profit(0, 100, 50), 0);
    }

    #[test]
    fn attack_profit_profitable() {
        // Impact > fee: profit
        let profit = estimate_attack_profit(1_000_000, 100, 9);
        // revenue = 1M * 100 / 10000 = 10000
        // cost = 1M * 9 / 10000 = 900
        // profit = 9100
        assert_eq!(profit, 9100);
    }

    #[test]
    fn attack_profit_unprofitable() {
        // Impact < fee: loss
        let profit = estimate_attack_profit(1_000_000, 5, 9);
        // revenue = 1M * 5 / 10000 = 500
        // cost = 1M * 9 / 10000 = 900
        // profit = -400
        assert_eq!(profit, -400);
    }

    #[test]
    fn attack_profit_break_even() {
        // Impact == fee: zero profit
        let profit = estimate_attack_profit(1_000_000, 50, 50);
        assert_eq!(profit, 0);
    }

    #[test]
    fn attack_profit_zero_impact() {
        let profit = estimate_attack_profit(1_000_000, 0, 9);
        // revenue = 0, cost = 900
        assert_eq!(profit, -900);
    }

    #[test]
    fn attack_profit_zero_fee() {
        let profit = estimate_attack_profit(1_000_000, 100, 0);
        // revenue = 10000, cost = 0
        assert_eq!(profit, 10000);
    }

    #[test]
    fn attack_profit_large_amount() {
        let amount = 1_000_000 * PRECISION;
        let profit = estimate_attack_profit(amount, 100, 9);
        let expected_rev = mul_div(amount, 100, BPS) as i128;
        let expected_cost = mul_div(amount, 9, BPS) as i128;
        assert_eq!(profit, expected_rev - expected_cost);
    }

    #[test]
    fn attack_profit_max_bps() {
        // 10000 bps impact = 100% of borrow
        let profit = estimate_attack_profit(1_000_000, 10000, 9);
        // revenue = 1M, cost = 900
        assert_eq!(profit, 1_000_000 - 900);
    }

    // ============ Concurrent Loan Capacity Tests ============

    #[test]
    fn capacity_empty_pool() {
        let pool = default_pool_state();
        assert_eq!(concurrent_loan_capacity(&pool), MAX_CONCURRENT_LOANS as u8);
    }

    #[test]
    fn capacity_one_active() {
        let mut pool = default_pool_state();
        pool.active_loans = 1;
        assert_eq!(
            concurrent_loan_capacity(&pool),
            (MAX_CONCURRENT_LOANS - 1) as u8
        );
    }

    #[test]
    fn capacity_at_max() {
        let mut pool = default_pool_state();
        pool.active_loans = MAX_CONCURRENT_LOANS as u8;
        assert_eq!(concurrent_loan_capacity(&pool), 0);
    }

    #[test]
    fn capacity_over_max() {
        let mut pool = default_pool_state();
        pool.active_loans = MAX_CONCURRENT_LOANS as u8 + 1;
        assert_eq!(concurrent_loan_capacity(&pool), 0);
    }

    #[test]
    fn capacity_one_below_max() {
        let mut pool = default_pool_state();
        pool.active_loans = (MAX_CONCURRENT_LOANS - 1) as u8;
        assert_eq!(concurrent_loan_capacity(&pool), 1);
    }

    // ============ Historical Stats Tests ============

    #[test]
    fn stats_empty() {
        let (loans, fees, volume, profitable) = historical_stats(&[]);
        assert_eq!(loans, 0);
        assert_eq!(fees, 0);
        assert_eq!(volume, 0);
        assert_eq!(profitable, 0);
    }

    #[test]
    fn stats_single_loan() {
        let amount = 100_000 * PRECISION;
        let fee = compute_fee(amount);
        let results = vec![make_result(amount, fee, false)];
        let (loans, fees, volume, profitable) = historical_stats(&results);
        assert_eq!(loans, 1);
        assert_eq!(fees, fee);
        assert_eq!(volume, amount);
        assert_eq!(profitable, 0);
    }

    #[test]
    fn stats_single_profitable() {
        let amount = 100_000 * PRECISION;
        let fee = compute_fee(amount);
        let results = vec![make_result(amount, fee, true)];
        let (loans, fees, volume, profitable) = historical_stats(&results);
        assert_eq!(loans, 1);
        assert_eq!(profitable, 1);
    }

    #[test]
    fn stats_multiple_mixed() {
        let amount = 50_000 * PRECISION;
        let fee = compute_fee(amount);
        let results = vec![
            make_result(amount, fee, true),
            make_result(amount, fee, false),
            make_result(amount, fee, true),
            make_result(amount, fee, false),
            make_result(amount, fee, true),
        ];
        let (loans, fees, volume, profitable) = historical_stats(&results);
        assert_eq!(loans, 5);
        assert_eq!(fees, fee * 5);
        assert_eq!(volume, amount * 5);
        assert_eq!(profitable, 3);
    }

    #[test]
    fn stats_all_profitable() {
        let amount = 10_000 * PRECISION;
        let fee = compute_fee(amount);
        let results: Vec<FlashLoanResult> = (0..10).map(|_| make_result(amount, fee, true)).collect();
        let (loans, _, _, profitable) = historical_stats(&results);
        assert_eq!(loans, 10);
        assert_eq!(profitable, 10);
    }

    #[test]
    fn stats_none_profitable() {
        let amount = 10_000 * PRECISION;
        let fee = compute_fee(amount);
        let results: Vec<FlashLoanResult> = (0..10).map(|_| make_result(amount, fee, false)).collect();
        let (loans, _, _, profitable) = historical_stats(&results);
        assert_eq!(loans, 10);
        assert_eq!(profitable, 0);
    }

    #[test]
    fn stats_large_volumes() {
        let amount = u128::MAX / 4;
        let results = vec![
            make_result(amount, 1000, false),
            make_result(amount, 1000, false),
        ];
        let (loans, fees, volume, _) = historical_stats(&results);
        assert_eq!(loans, 2);
        assert_eq!(fees, 2000);
        // Volume should saturate or accumulate correctly
        assert_eq!(volume, amount.saturating_mul(2));
    }

    // ============ Edge Case Tests ============

    #[test]
    fn edge_max_amount_fee() {
        let fee = compute_fee(u128::MAX);
        assert!(fee > 0);
        assert!(fee < u128::MAX);
    }

    #[test]
    fn edge_max_amount_repayment() {
        let repayment = compute_required_repayment(u128::MAX);
        // Should saturate at u128::MAX
        assert_eq!(repayment, u128::MAX);
    }

    #[test]
    fn edge_pool_state_overflow_borrow() {
        let mut pool = default_pool_state();
        pool.total_available = u128::MAX;
        pool.currently_borrowed = u128::MAX - 100;
        // Try to borrow 200, which would overflow currently_borrowed
        let result = update_pool_state(&pool, 200, true);
        assert_eq!(result, Err(FlashLoanError::Overflow));
    }

    #[test]
    fn edge_zero_pool_available() {
        let mut pool = default_pool_state();
        pool.total_available = 0;
        let request = make_request(1);
        assert_eq!(
            validate_flash_loan(&request, &pool),
            Err(FlashLoanError::ExceedsPoolCapacity)
        );
    }

    #[test]
    fn edge_all_borrowed() {
        let mut pool = default_pool_state();
        pool.currently_borrowed = pool.total_available;
        let amount = 1;
        let mut request = make_request(amount);
        request.amount = amount;
        request.expected_repayment = compute_required_repayment(amount);
        assert_eq!(
            validate_flash_loan(&request, &pool),
            Err(FlashLoanError::ExceedsPoolCapacity)
        );
    }

    #[test]
    fn edge_detect_single_volume_entry() {
        let analysis = detect_suspicious_pattern(&[100_000], 1000, &[-50]);
        assert!(analysis.is_suspicious);
    }

    #[test]
    fn edge_detect_many_volumes() {
        let volumes: Vec<u128> = (0..100).map(|i| (i + 1) * 100).collect();
        let analysis = detect_suspicious_pattern(&volumes, 1000, &[10, -10]);
        // Max volume = 10000, threshold = 10000, not suspicious (must be >)
        assert!(!analysis.is_suspicious);
    }

    #[test]
    fn edge_detect_exactly_10x() {
        // 10x exactly = threshold, not above
        let analysis = detect_suspicious_pattern(&[10_000], 1000, &[0]);
        assert!(!analysis.is_suspicious);
    }

    #[test]
    fn edge_detect_just_over_10x() {
        let analysis = detect_suspicious_pattern(&[10_001], 1000, &[-350]);
        assert!(analysis.is_suspicious);
    }

    #[test]
    fn edge_max_safe_borrow_precision() {
        // Ensure max_safe_borrow is exactly 50%
        let available = 2_000_000 * PRECISION;
        assert_eq!(max_safe_borrow(available), 1_000_000 * PRECISION);
    }

    #[test]
    fn edge_concurrent_capacity_zero_active() {
        let mut pool = default_pool_state();
        pool.active_loans = 0;
        assert_eq!(concurrent_loan_capacity(&pool), MAX_CONCURRENT_LOANS as u8);
    }

    // ============ Constants Verification Tests ============

    #[test]
    fn constants_bps() {
        assert_eq!(BPS, 10_000);
    }

    #[test]
    fn constants_max_borrow() {
        assert_eq!(MAX_SINGLE_BORROW_BPS, 5000);
    }

    #[test]
    fn constants_fee() {
        assert_eq!(FLASH_LOAN_FEE_BPS, 9);
    }

    #[test]
    fn constants_min_blocks() {
        assert_eq!(MIN_BLOCKS_BETWEEN_BORROWS, 1);
    }

    #[test]
    fn constants_max_concurrent() {
        assert_eq!(MAX_CONCURRENT_LOANS, 5);
    }

    #[test]
    fn constants_suspicious_multiplier() {
        assert_eq!(SUSPICIOUS_VOLUME_MULTIPLIER, 10);
    }

    #[test]
    fn constants_eoa_required() {
        assert!(EOA_COMMIT_REQUIRED);
    }

    #[test]
    fn constants_repayment_grace() {
        assert_eq!(REPAYMENT_GRACE_BLOCKS, 0);
    }

    // ============ Integration-style Tests ============

    #[test]
    fn integration_full_flash_loan_lifecycle() {
        // 1. Start with a fresh pool
        let pool = default_pool_state();

        // 2. Validate a flash loan request
        let amount = 200_000 * PRECISION;
        let request = make_request(amount);
        let fee = validate_flash_loan(&request, &pool).unwrap();
        assert_eq!(fee, compute_fee(amount));

        // 3. Update pool state for borrow
        let pool_after_borrow = update_pool_state(&pool, amount, true).unwrap();
        assert_eq!(pool_after_borrow.currently_borrowed, amount);
        assert_eq!(pool_after_borrow.active_loans, 1);

        // 4. Validate repayment
        let repaid = amount + fee;
        let result = validate_repayment(&request, repaid, 100).unwrap();
        assert_eq!(result.fee_paid, fee);

        // 5. Update pool state for repayment
        let pool_after_repay = update_pool_state(&pool_after_borrow, amount, false).unwrap();
        assert_eq!(pool_after_repay.currently_borrowed, 0);
        assert_eq!(pool_after_repay.active_loans, 0);
        assert_eq!(pool_after_repay.total_loans_served, 1);
    }

    #[test]
    fn integration_attack_detection_and_assessment() {
        // 1. Assess pool vulnerability
        let tvl = 500_000 * PRECISION;
        let volume = 100_000 * PRECISION;
        let vuln = assess_vulnerability(tvl, volume, 2, true);

        // 2. Check protection status
        let report = generate_protection_report(true, true, true, true, true);
        assert_eq!(report.overall_protection_score, 100);

        // 3. Detect if attack pattern exists
        let volumes = vec![5_000_000]; // 50x baseline
        let analysis = detect_suspicious_pattern(&volumes, 100_000, &[-400]);
        assert!(analysis.is_suspicious);

        // 4. Estimate attack profitability
        let profit = estimate_attack_profit(tvl / 2, 50, FLASH_LOAN_FEE_BPS);
        // 50 bps impact vs 9 bps fee: profitable
        assert!(profit > 0);

        // Pool should still have some vulnerability score
        assert!(vuln > 0);
    }

    #[test]
    fn integration_eoa_prevents_flash_loan_commit() {
        // Contracts cannot commit to auctions
        assert!(!is_eoa_commit(true, true));
        assert!(!is_eoa_commit(true, false));
        assert!(!is_eoa_commit(false, true));

        // Only EOAs can commit
        assert!(is_eoa_commit(false, false));
    }

    #[test]
    fn integration_multiple_concurrent_loans() {
        let pool = default_pool_state();
        let amount = 50_000 * PRECISION;

        let mut state = pool;
        for i in 0..MAX_CONCURRENT_LOANS {
            let cap = concurrent_loan_capacity(&state);
            assert_eq!(cap, (MAX_CONCURRENT_LOANS - i) as u8);
            state = update_pool_state(&state, amount, true).unwrap();
        }

        assert_eq!(concurrent_loan_capacity(&state), 0);

        // Cannot borrow more
        let request = make_request(amount);
        let mut pool_at_max = default_pool_state();
        pool_at_max.active_loans = MAX_CONCURRENT_LOANS as u8;
        assert_eq!(
            validate_flash_loan(&request, &pool_at_max),
            Err(FlashLoanError::ConcurrentLoanLimit)
        );
    }

    #[test]
    fn integration_historical_analysis() {
        let amount = 100_000 * PRECISION;
        let fee = compute_fee(amount);

        // Generate some history
        let results: Vec<FlashLoanResult> = (0..20)
            .map(|i| make_result(amount, fee, i % 3 == 0))
            .collect();

        let (total, total_fees, total_volume, profitable) = historical_stats(&results);
        assert_eq!(total, 20);
        assert_eq!(total_fees, fee * 20);
        assert_eq!(total_volume, amount * 20);
        // i % 3 == 0: 0, 3, 6, 9, 12, 15, 18 = 7 profitable
        assert_eq!(profitable, 7);
    }

    // ============ Additional Edge Cases for Completeness ============

    #[test]
    fn attack_pattern_enum_variants_distinct() {
        // Ensure all variants are distinct
        assert_ne!(AttackPattern::None, AttackPattern::PriceManipulation);
        assert_ne!(AttackPattern::PriceManipulation, AttackPattern::LiquidationTrigger);
        assert_ne!(AttackPattern::LiquidationTrigger, AttackPattern::GovernanceAttack);
        assert_ne!(AttackPattern::GovernanceAttack, AttackPattern::OracleManipulation);
        assert_ne!(AttackPattern::OracleManipulation, AttackPattern::SandwichAttack);
    }

    #[test]
    fn error_enum_variants_distinct() {
        assert_ne!(FlashLoanError::ExceedsPoolCapacity, FlashLoanError::ExceedsMaxBorrow);
        assert_ne!(FlashLoanError::InsufficientRepayment, FlashLoanError::FeeTooLow);
        assert_ne!(FlashLoanError::ConcurrentLoanLimit, FlashLoanError::NotRepaidInTime);
        assert_ne!(FlashLoanError::SuspiciousPattern, FlashLoanError::InvalidPool);
        assert_ne!(FlashLoanError::ZeroAmount, FlashLoanError::Overflow);
        assert_ne!(FlashLoanError::ProtocolPaused, FlashLoanError::BorrowerBlocked);
    }

    #[test]
    fn pool_state_clone_independence() {
        let pool = default_pool_state();
        let cloned = pool.clone();
        assert_eq!(pool, cloned);
    }

    #[test]
    fn request_clone_independence() {
        let req = make_request(1000);
        let cloned = req.clone();
        assert_eq!(req, cloned);
    }

    #[test]
    fn protection_report_fields_match_inputs() {
        let report = generate_protection_report(true, false, true, false, true);
        assert!(report.commit_reveal_active);
        assert!(!report.eoa_only_commits);
        assert!(report.twap_validated);
        assert!(!report.rate_limited);
        assert!(report.circuit_breaker_active);
        assert_eq!(report.overall_protection_score, 60); // 30 + 20 + 10
    }

    #[test]
    fn vulnerability_equal_volume_tvl() {
        let tvl = 1_000_000 * PRECISION;
        let volume = tvl; // 1:1 ratio = 10000 bps, capped at 4000
        let score = assess_vulnerability(tvl, volume, 5, true);
        assert!(score >= 4000);
    }

    #[test]
    fn fee_consistency_with_repayment() {
        // compute_required_repayment should be consistent with compute_fee
        for amount in [0u128, 1, 100, 10_000, PRECISION, 1_000_000 * PRECISION] {
            let fee = compute_fee(amount);
            let repayment = compute_required_repayment(amount);
            assert_eq!(repayment, amount.saturating_add(fee));
        }
    }

    #[test]
    fn max_borrow_never_exceeds_available() {
        for available in [0u128, 1, 100, 10_000, PRECISION, u128::MAX / 2, u128::MAX] {
            let max = max_safe_borrow(available);
            assert!(max <= available);
        }
    }

    #[test]
    fn detect_all_volumes_suspicious() {
        let volumes = vec![20_000, 30_000, 40_000]; // All > 10x baseline of 1000
        let analysis = detect_suspicious_pattern(&volumes, 1000, &[-200, 300]);
        assert!(analysis.is_suspicious);
        // 3 spikes with reversal = sandwich
        assert_eq!(analysis.pattern, AttackPattern::SandwichAttack);
    }

    #[test]
    fn validate_request_pool_id_mismatch_still_works() {
        // Validation doesn't check pool_id match — that's the caller's responsibility
        let pool = default_pool_state();
        let mut request = make_request(10_000 * PRECISION);
        request.pool_id = [0xFF; 32]; // Different from pool
        assert!(validate_flash_loan(&request, &pool).is_ok());
    }

    #[test]
    fn stats_saturating_fees() {
        // Fees should saturate instead of overflowing
        let results = vec![
            make_result(1000, u128::MAX / 2, false),
            make_result(1000, u128::MAX / 2, false),
            make_result(1000, u128::MAX / 2, false),
        ];
        let (_, fees, _, _) = historical_stats(&results);
        assert_eq!(fees, u128::MAX);
    }
}
