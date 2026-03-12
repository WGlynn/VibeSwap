// ============ Treasury — DAOTreasury & TreasuryStabilizer for Protocol-Owned Funds ============
// Implements the VibeSwap treasury management system: fund allocation with vesting,
// daily outflow limits, emergency mode, stabilization actions, and health reporting.
//
// Key capabilities:
// - Treasury state management with reserved/available balance tracking
// - Vested fund allocations with cliff + linear vesting
// - Daily outflow rate limiting (max 5% per day)
// - Emergency mode triggered by drawdown exceeding 20%
// - Price stabilization via buy support, sell pressure, or liquidity operations
// - AMM price impact estimation for stabilization actions
// - Full health reporting with reserve ratio, utilization, and runway
// - Rebalance detection and computation across allocation categories
//
// Philosophy: Cooperative Capitalism — the treasury is the protocol's financial backbone,
// mutualized risk through stabilization + free market competition through allocation.

use vibeswap_math::PRECISION;
use vibeswap_math::mul_div;

// ============ Constants ============

/// Basis points denominator
pub const BPS: u128 = 10_000;

/// Maximum 50% of treasury per single allocation
pub const MAX_ALLOCATION_BPS: u16 = 5000;

/// 20% drawdown triggers emergency mode
pub const EMERGENCY_THRESHOLD_BPS: u16 = 2000;

/// 100% = fully stabilized target
pub const STABILIZATION_TARGET_BPS: u16 = 10_000;

/// 10% minimum reserve ratio
pub const MIN_RESERVE_RATIO_BPS: u16 = 1000;

/// 5% max daily outflow
pub const MAX_DAILY_OUTFLOW_BPS: u16 = 500;

/// 3% deviation triggers rebalance
pub const REBALANCE_THRESHOLD_BPS: u16 = 300;

/// Vesting cliff in blocks before any tokens unlock
pub const VESTING_CLIFF_BLOCKS: u64 = 100_000;

/// Maximum vesting schedule duration in blocks
pub const MAX_VESTING_DURATION: u64 = 10_000_000;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TreasuryError {
    /// Treasury does not have enough available funds
    InsufficientFunds,
    /// Single allocation exceeds MAX_ALLOCATION_BPS of treasury
    AllocationTooLarge,
    /// Proposed outflow would exceed daily limit
    ExceedsDailyLimit,
    /// Operation would drop reserve ratio below MIN_RESERVE_RATIO_BPS
    BelowMinReserve,
    /// Vesting schedule parameters are invalid
    InvalidVestingSchedule,
    /// Treasury is in emergency mode — most operations blocked
    EmergencyModeActive,
    /// Drawdown has not reached EMERGENCY_THRESHOLD_BPS
    EmergencyThresholdNotMet,
    /// Caller is not authorized for this operation
    UnauthorizedOperation,
    /// Deviation is below REBALANCE_THRESHOLD_BPS — rebalance not needed
    RebalanceNotNeeded,
    /// Basis points value is out of valid range
    InvalidBasisPoints,
    /// Amount must be non-zero
    ZeroAmount,
    /// Arithmetic overflow
    Overflow,
}

// ============ Data Types ============

/// Complete treasury state — tracks all protocol-owned funds and limits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TreasuryState {
    /// Total balance held by the treasury
    pub total_balance: u128,
    /// Balance locked for outstanding obligations (unvested allocations, etc.)
    pub reserved_balance: u128,
    /// Freely available balance (total - reserved)
    pub available_balance: u128,
    /// Outflows already spent in the current daily window
    pub daily_outflow: u128,
    /// Maximum allowed outflows per day (total_balance * MAX_DAILY_OUTFLOW_BPS / BPS)
    pub daily_outflow_limit: u128,
    /// Whether the treasury is in emergency lockdown
    pub emergency_mode: bool,
    /// Block number of the last rebalance operation
    pub last_rebalance_block: u64,
    /// Block number when the treasury was created
    pub inception_block: u64,
}

/// A vested fund allocation to a recipient for a specific purpose.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Allocation {
    /// Recipient address (CKB lock hash)
    pub recipient: [u8; 32],
    /// Total amount allocated
    pub amount: u128,
    /// Purpose category of this allocation
    pub purpose: AllocationPurpose,
    /// Block at which vesting begins
    pub vesting_start: u64,
    /// Total vesting duration in blocks (after cliff)
    pub vesting_duration: u64,
    /// Cliff period in blocks before any vesting begins
    pub cliff_blocks: u64,
    /// Amount already claimed by the recipient
    pub amount_claimed: u128,
}

/// Purpose categories for treasury allocations.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AllocationPurpose {
    Development,
    Marketing,
    LiquidityIncentive,
    SecurityBounty,
    CommunityGrant,
    EmergencyReserve,
    Stabilization,
}

/// A computed stabilization action the treasury should execute.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StabilizationAction {
    /// Type of market intervention
    pub action_type: StabilizationType,
    /// Amount of treasury funds to deploy
    pub amount: u128,
    /// Target price the stabilization aims to restore
    pub target_price: u128,
    /// Current market price
    pub current_price: u128,
    /// Estimated price impact of this action
    pub impact_estimate: u128,
}

/// Types of stabilization interventions.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StabilizationType {
    /// Buy from market to support price (price below target)
    BuySupport,
    /// Sell into market to cap price (price above target)
    SellPressure,
    /// Add liquidity to reduce volatility
    LiquidityAdd,
    /// Remove liquidity (defensive)
    LiquidityRemove,
}

/// Full treasury health report.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TreasuryReport {
    /// Total assets under treasury control
    pub total_assets: u128,
    /// Total liabilities (sum of unvested allocation obligations)
    pub total_liabilities: u128,
    /// Net position (assets - liabilities)
    pub net_position: u128,
    /// Reserve ratio in basis points (reserved / total)
    pub reserve_ratio_bps: u16,
    /// Utilization in basis points (reserved / total)
    pub utilization_bps: u16,
    /// Overall health score (0-100)
    pub health_score: u8,
    /// Estimated blocks until depletion at current outflow rate
    pub runway_blocks: u64,
}

/// Result of a rebalance operation between categories.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RebalanceResult {
    /// Category to move funds from
    pub from_category: AllocationPurpose,
    /// Category to move funds to
    pub to_category: AllocationPurpose,
    /// Amount transferred
    pub amount: u128,
    /// Deviation before rebalance in basis points
    pub deviation_before_bps: u16,
    /// Deviation after rebalance in basis points
    pub deviation_after_bps: u16,
}

// ============ Core Functions ============

/// Initialize a new treasury state with the given total balance and inception block.
///
/// Sets the daily outflow limit based on MAX_DAILY_OUTFLOW_BPS and marks
/// all funds as available (no reservations yet).
pub fn create_treasury(total_balance: u128, inception_block: u64) -> Result<TreasuryState, TreasuryError> {
    if total_balance == 0 {
        return Err(TreasuryError::ZeroAmount);
    }

    let daily_outflow_limit = mul_div(total_balance, MAX_DAILY_OUTFLOW_BPS as u128, BPS);

    Ok(TreasuryState {
        total_balance,
        reserved_balance: 0,
        available_balance: total_balance,
        daily_outflow: 0,
        daily_outflow_limit,
        emergency_mode: false,
        last_rebalance_block: inception_block,
        inception_block,
    })
}

/// Create a vested allocation from the treasury.
///
/// Validates:
/// - Treasury is not in emergency mode
/// - Amount is non-zero
/// - Amount does not exceed MAX_ALLOCATION_BPS of total balance
/// - Amount does not exceed daily outflow limit
/// - Post-allocation reserve ratio stays above MIN_RESERVE_RATIO_BPS
/// - Vesting duration is valid (> 0, <= MAX_VESTING_DURATION)
pub fn allocate_funds(
    state: &TreasuryState,
    amount: u128,
    purpose: AllocationPurpose,
    recipient: [u8; 32],
    vesting_duration: u64,
) -> Result<Allocation, TreasuryError> {
    if state.emergency_mode {
        return Err(TreasuryError::EmergencyModeActive);
    }

    if amount == 0 {
        return Err(TreasuryError::ZeroAmount);
    }

    // Check max allocation (50% of total)
    let max_alloc = mul_div(state.total_balance, MAX_ALLOCATION_BPS as u128, BPS);
    if amount > max_alloc {
        return Err(TreasuryError::AllocationTooLarge);
    }

    // Check daily outflow limit
    let remaining_daily = if state.daily_outflow_limit > state.daily_outflow {
        state.daily_outflow_limit - state.daily_outflow
    } else {
        0
    };
    if amount > remaining_daily {
        return Err(TreasuryError::ExceedsDailyLimit);
    }

    // Check available balance
    if amount > state.available_balance {
        return Err(TreasuryError::InsufficientFunds);
    }

    // Check that reserve ratio stays above minimum after allocation
    let new_reserved = state.reserved_balance + amount;
    let new_available = state.available_balance - amount;
    // We need available to be at least MIN_RESERVE_RATIO_BPS of total
    // Actually: reserved funds ARE the obligations. We check that the remaining
    // available balance (which acts as free reserves) stays above minimum.
    let min_reserve = mul_div(state.total_balance, MIN_RESERVE_RATIO_BPS as u128, BPS);
    if new_available < min_reserve {
        return Err(TreasuryError::BelowMinReserve);
    }

    // Validate vesting schedule
    if vesting_duration == 0 || vesting_duration > MAX_VESTING_DURATION {
        return Err(TreasuryError::InvalidVestingSchedule);
    }

    Ok(Allocation {
        recipient,
        amount,
        purpose,
        vesting_start: 0, // Caller sets this to current block
        vesting_duration,
        cliff_blocks: VESTING_CLIFF_BLOCKS,
        amount_claimed: 0,
    })
}

/// Compute the total vested amount at a given block.
///
/// Linear vesting after cliff:
/// - Before cliff: 0
/// - At/after cliff, before end: amount * (elapsed - cliff) / vesting_duration
/// - After full vesting: amount
pub fn compute_vested_amount(allocation: &Allocation, current_block: u64) -> u128 {
    if allocation.amount == 0 {
        return 0;
    }

    let cliff_end = allocation.vesting_start + allocation.cliff_blocks;

    // Before cliff: nothing vested
    if current_block < cliff_end {
        return 0;
    }

    let vesting_end = allocation.vesting_start + allocation.cliff_blocks + allocation.vesting_duration;

    // After full vesting: everything
    if current_block >= vesting_end {
        return allocation.amount;
    }

    // Linear vesting between cliff end and vesting end
    let elapsed_after_cliff = current_block - cliff_end;
    mul_div(allocation.amount, elapsed_after_cliff as u128, allocation.vesting_duration as u128)
}

/// Compute how much the recipient can claim right now.
///
/// claimable = vested - already_claimed
pub fn compute_claimable(allocation: &Allocation, current_block: u64) -> u128 {
    let vested = compute_vested_amount(allocation, current_block);
    if vested > allocation.amount_claimed {
        vested - allocation.amount_claimed
    } else {
        0
    }
}

/// Claim vested tokens from an allocation.
///
/// Returns (claimed_amount, updated_allocation) or error if nothing to claim.
pub fn claim_vested(
    allocation: &Allocation,
    current_block: u64,
) -> Result<(u128, Allocation), TreasuryError> {
    let claimable = compute_claimable(allocation, current_block);

    if claimable == 0 {
        return Err(TreasuryError::InsufficientFunds);
    }

    let mut updated = allocation.clone();
    updated.amount_claimed += claimable;

    Ok((claimable, updated))
}

/// Check whether a proposed outflow fits within the daily limit.
///
/// Returns the remaining daily capacity after the proposed outflow,
/// or an error if the limit would be exceeded.
pub fn check_daily_limit(
    state: &TreasuryState,
    proposed_outflow: u128,
) -> Result<u128, TreasuryError> {
    if proposed_outflow == 0 {
        return Err(TreasuryError::ZeroAmount);
    }

    let used = state.daily_outflow;
    let limit = state.daily_outflow_limit;

    if used >= limit {
        return Err(TreasuryError::ExceedsDailyLimit);
    }

    let remaining = limit - used;
    if proposed_outflow > remaining {
        return Err(TreasuryError::ExceedsDailyLimit);
    }

    Ok(remaining - proposed_outflow)
}

/// Record an outflow against the daily limit.
///
/// Returns updated treasury state with incremented daily_outflow.
pub fn update_daily_outflow(
    state: &TreasuryState,
    amount: u128,
) -> Result<TreasuryState, TreasuryError> {
    if amount == 0 {
        return Err(TreasuryError::ZeroAmount);
    }

    let new_outflow = state.daily_outflow.checked_add(amount)
        .ok_or(TreasuryError::Overflow)?;

    if new_outflow > state.daily_outflow_limit {
        return Err(TreasuryError::ExceedsDailyLimit);
    }

    let mut updated = state.clone();
    updated.daily_outflow = new_outflow;

    Ok(updated)
}

/// Enter emergency mode if the drawdown from total balance exceeds EMERGENCY_THRESHOLD_BPS.
///
/// Drawdown is measured as: (total_balance - current_balance) / total_balance.
/// If the treasury has already lost 20%+ of its inception balance, emergency triggers.
pub fn enter_emergency_mode(
    state: &TreasuryState,
    current_balance: u128,
) -> Result<TreasuryState, TreasuryError> {
    if state.emergency_mode {
        return Err(TreasuryError::EmergencyModeActive);
    }

    if current_balance >= state.total_balance {
        return Err(TreasuryError::EmergencyThresholdNotMet);
    }

    let drawdown = state.total_balance - current_balance;
    let threshold = mul_div(state.total_balance, EMERGENCY_THRESHOLD_BPS as u128, BPS);

    if drawdown < threshold {
        return Err(TreasuryError::EmergencyThresholdNotMet);
    }

    let mut updated = state.clone();
    updated.emergency_mode = true;
    updated.total_balance = current_balance;
    updated.available_balance = if current_balance > updated.reserved_balance {
        current_balance - updated.reserved_balance
    } else {
        0
    };
    updated.daily_outflow_limit = mul_div(current_balance, MAX_DAILY_OUTFLOW_BPS as u128, BPS);

    Ok(updated)
}

/// Exit emergency mode, returning to normal operations.
pub fn exit_emergency_mode(
    state: &TreasuryState,
) -> Result<TreasuryState, TreasuryError> {
    if !state.emergency_mode {
        return Err(TreasuryError::EmergencyThresholdNotMet);
    }

    let mut updated = state.clone();
    updated.emergency_mode = false;

    Ok(updated)
}

/// Compute the reserve ratio in basis points: reserved / total * 10000.
///
/// Returns 0 if total_balance is zero.
pub fn compute_reserve_ratio(state: &TreasuryState) -> u16 {
    if state.total_balance == 0 {
        return 0;
    }

    let ratio = mul_div(state.reserved_balance, BPS, state.total_balance);
    if ratio > 10_000 {
        10_000u16
    } else {
        ratio as u16
    }
}

/// Determine the appropriate stabilization action given current vs target price.
///
/// - Price below target by >3%: BuySupport
/// - Price above target by >3%: SellPressure
/// - Price within 3%: LiquidityAdd to reduce volatility
///
/// The action amount is scaled proportionally to the deviation, capped at
/// 50% of treasury_available.
pub fn compute_stabilization_action(
    current_price: u128,
    target_price: u128,
    treasury_available: u128,
    pool_reserve: u128,
) -> Result<StabilizationAction, TreasuryError> {
    if current_price == 0 || target_price == 0 {
        return Err(TreasuryError::ZeroAmount);
    }

    if treasury_available == 0 {
        return Err(TreasuryError::InsufficientFunds);
    }

    // Calculate deviation in BPS
    let (deviation_bps, below_target) = if current_price < target_price {
        let diff = target_price - current_price;
        let dev = mul_div(diff, BPS, target_price);
        (dev, true)
    } else {
        let diff = current_price - target_price;
        let dev = mul_div(diff, BPS, target_price);
        (dev, false)
    };

    // Cap action amount at 50% of available
    let max_action = treasury_available / 2;

    // Scale action amount proportionally to deviation (more deviation = more funds)
    // deviation_bps / 10000 * max_action, capped at max_action
    let raw_amount = mul_div(max_action, deviation_bps, BPS);
    let amount = if raw_amount > max_action { max_action } else { raw_amount };
    let amount = if amount == 0 { 1 } else { amount }; // Minimum 1 unit

    let (action_type, impact_estimate) = if deviation_bps <= REBALANCE_THRESHOLD_BPS as u128 {
        // Within tolerance — add liquidity to deepen the pool
        let impact = if pool_reserve > 0 {
            mul_div(amount, PRECISION, pool_reserve)
        } else {
            0
        };
        (StabilizationType::LiquidityAdd, impact)
    } else if below_target {
        // Price too low — buy to push it up
        let impact = if pool_reserve > 0 {
            mul_div(amount, PRECISION, pool_reserve)
        } else {
            0
        };
        (StabilizationType::BuySupport, impact)
    } else {
        // Price too high — sell to push it down
        let impact = if pool_reserve > 0 {
            mul_div(amount, PRECISION, pool_reserve)
        } else {
            0
        };
        (StabilizationType::SellPressure, impact)
    };

    Ok(StabilizationAction {
        action_type,
        amount,
        target_price,
        current_price,
        impact_estimate,
    })
}

/// Estimate the price impact of a stabilization action on a constant-product AMM.
///
/// For a trade of `amount` into a pool with reserves (pool_x, pool_y):
///   new_y = pool_x * pool_y / (pool_x + amount)
///   price_impact = |pool_y - new_y| / pool_y
///
/// Returns the impact scaled by PRECISION (1e18 = 100%).
pub fn estimate_price_impact(
    action: &StabilizationAction,
    pool_x: u128,
    pool_y: u128,
) -> Result<u128, TreasuryError> {
    if pool_x == 0 || pool_y == 0 {
        return Err(TreasuryError::ZeroAmount);
    }

    if action.amount == 0 {
        return Ok(0);
    }

    let new_denominator = pool_x.checked_add(action.amount)
        .ok_or(TreasuryError::Overflow)?;

    // new_y = pool_x * pool_y / (pool_x + amount)
    let new_y = mul_div(pool_x, pool_y, new_denominator);

    // Tokens removed from pool_y
    let delta_y = if pool_y > new_y { pool_y - new_y } else { 0 };

    // Price impact = delta_y / pool_y * PRECISION
    let impact = mul_div(delta_y, PRECISION, pool_y);

    Ok(impact)
}

/// Generate a full treasury health report.
///
/// Computes:
/// - Total liabilities as sum of unvested portions of all allocations
/// - Net position (assets - liabilities)
/// - Reserve ratio and utilization
/// - Health score (0-100) based on reserve ratio, emergency mode, and utilization
/// - Runway in blocks (available_balance / avg_block_outflow)
pub fn generate_report(
    state: &TreasuryState,
    allocations: &[Allocation],
    current_block: u64,
    avg_block_outflow: u128,
) -> TreasuryReport {
    // Calculate total liabilities = sum of unvested amounts
    let mut total_liabilities: u128 = 0;
    for alloc in allocations {
        let vested = compute_vested_amount(alloc, current_block);
        let unvested = if alloc.amount > vested {
            alloc.amount - vested
        } else {
            0
        };
        total_liabilities = total_liabilities.saturating_add(unvested);
    }

    let total_assets = state.total_balance;
    let net_position = if total_assets > total_liabilities {
        total_assets - total_liabilities
    } else {
        0
    };

    let reserve_ratio_bps = compute_reserve_ratio(state);

    let utilization_bps = if total_assets > 0 {
        let util = mul_div(state.reserved_balance, BPS, total_assets);
        if util > 10_000 { 10_000u16 } else { util as u16 }
    } else {
        0
    };

    // Health score: 0-100
    // Factors: reserve ratio (40pts), not in emergency (30pts), low utilization (30pts)
    let reserve_score = if reserve_ratio_bps >= MIN_RESERVE_RATIO_BPS {
        // Scale 10%-100% to 0-40 points
        let capped = if reserve_ratio_bps > 5000 { 5000u16 } else { reserve_ratio_bps };
        ((capped as u32 - MIN_RESERVE_RATIO_BPS as u32) * 40 / (5000 - MIN_RESERVE_RATIO_BPS as u32)) as u8
    } else {
        0u8
    };

    let emergency_score: u8 = if state.emergency_mode { 0 } else { 30 };

    let utilization_score = if utilization_bps <= 7000 {
        // 0-70% utilization = 30-0 points (lower is better for health)
        (30u32 - (utilization_bps as u32 * 30 / 7000)) as u8
    } else {
        0u8
    };

    let health_score = reserve_score + emergency_score + utilization_score;
    let health_score = if health_score > 100 { 100 } else { health_score };

    // Runway calculation
    let runway_blocks = if avg_block_outflow > 0 {
        let blocks = state.available_balance / avg_block_outflow;
        if blocks > u64::MAX as u128 {
            u64::MAX
        } else {
            blocks as u64
        }
    } else {
        u64::MAX
    };

    TreasuryReport {
        total_assets,
        total_liabilities,
        net_position,
        reserve_ratio_bps,
        utilization_bps,
        health_score,
        runway_blocks,
    }
}

/// Check whether any allocation category pair has deviated beyond REBALANCE_THRESHOLD_BPS.
///
/// Takes parallel slices of actual BPS and target BPS for each category.
/// Returns (from_index, to_index, max_deviation_bps) for the pair with the
/// largest deviation, or an error if no deviation exceeds the threshold.
pub fn check_rebalance_needed(
    actual_bps: &[u16],
    target_bps: &[u16],
) -> Result<(usize, usize, u16), TreasuryError> {
    if actual_bps.len() != target_bps.len() || actual_bps.is_empty() {
        return Err(TreasuryError::InvalidBasisPoints);
    }

    let mut max_over_idx: Option<usize> = None;
    let mut max_over_dev: u16 = 0;
    let mut max_under_idx: Option<usize> = None;
    let mut max_under_dev: u16 = 0;

    for i in 0..actual_bps.len() {
        if actual_bps[i] > target_bps[i] {
            let dev = actual_bps[i] - target_bps[i];
            if dev > max_over_dev {
                max_over_dev = dev;
                max_over_idx = Some(i);
            }
        } else if target_bps[i] > actual_bps[i] {
            let dev = target_bps[i] - actual_bps[i];
            if dev > max_under_dev {
                max_under_dev = dev;
                max_under_idx = Some(i);
            }
        }
    }

    let max_dev = if max_over_dev > max_under_dev { max_over_dev } else { max_under_dev };

    if max_dev < REBALANCE_THRESHOLD_BPS {
        return Err(TreasuryError::RebalanceNotNeeded);
    }

    // "from" is the most over-allocated, "to" is the most under-allocated
    let from_idx = max_over_idx.ok_or(TreasuryError::RebalanceNotNeeded)?;
    let to_idx = max_under_idx.ok_or(TreasuryError::RebalanceNotNeeded)?;

    Ok((from_idx, to_idx, max_dev))
}

/// Compute the amount to transfer during a rebalance.
///
/// Given a source balance and destination balance that are out of target_ratio_bps
/// relative to the total, compute the transfer amount that brings the source
/// closer to its target.
///
/// transfer = from_balance - (total * target_ratio_bps / BPS)
/// Capped so that from_balance never goes below its target.
pub fn compute_rebalance(
    from_balance: u128,
    to_balance: u128,
    target_ratio_bps: u16,
    total: u128,
) -> Result<u128, TreasuryError> {
    if total == 0 {
        return Err(TreasuryError::ZeroAmount);
    }

    if target_ratio_bps > 10_000 {
        return Err(TreasuryError::InvalidBasisPoints);
    }

    let target_balance = mul_div(total, target_ratio_bps as u128, BPS);

    if from_balance <= target_balance {
        return Err(TreasuryError::RebalanceNotNeeded);
    }

    let excess = from_balance - target_balance;

    // Don't transfer more than the deficit of the destination
    let to_target = mul_div(total, target_ratio_bps as u128, BPS);
    let deficit = if to_target > to_balance {
        to_target - to_balance
    } else {
        0
    };

    // Transfer the minimum of excess and deficit
    let transfer = if excess < deficit { excess } else { deficit };

    if transfer == 0 {
        return Err(TreasuryError::RebalanceNotNeeded);
    }

    Ok(transfer)
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Helper factories ----

    fn default_state() -> TreasuryState {
        create_treasury(1_000_000 * PRECISION, 100).unwrap()
    }

    fn default_recipient() -> [u8; 32] {
        [0xAA; 32]
    }

    fn make_allocation(amount: u128, vesting_start: u64, vesting_duration: u64) -> Allocation {
        Allocation {
            recipient: default_recipient(),
            amount,
            purpose: AllocationPurpose::Development,
            vesting_start,
            vesting_duration,
            cliff_blocks: VESTING_CLIFF_BLOCKS,
            amount_claimed: 0,
        }
    }

    // ============ Treasury Creation Tests ============

    #[test]
    fn test_create_treasury_valid() {
        let state = create_treasury(1_000_000 * PRECISION, 100).unwrap();
        assert_eq!(state.total_balance, 1_000_000 * PRECISION);
        assert_eq!(state.reserved_balance, 0);
        assert_eq!(state.available_balance, 1_000_000 * PRECISION);
        assert_eq!(state.daily_outflow, 0);
        assert!(!state.emergency_mode);
        assert_eq!(state.inception_block, 100);
        assert_eq!(state.last_rebalance_block, 100);
    }

    #[test]
    fn test_create_treasury_daily_limit() {
        let state = create_treasury(1_000_000 * PRECISION, 0).unwrap();
        // 5% of 1M = 50K
        let expected = 50_000 * PRECISION;
        assert_eq!(state.daily_outflow_limit, expected);
    }

    #[test]
    fn test_create_treasury_zero_balance() {
        let result = create_treasury(0, 0);
        assert_eq!(result, Err(TreasuryError::ZeroAmount));
    }

    #[test]
    fn test_create_treasury_small_balance() {
        let state = create_treasury(1, 0).unwrap();
        assert_eq!(state.total_balance, 1);
        assert_eq!(state.available_balance, 1);
        // daily limit of 1 token at 5% rounds down to 0
        assert_eq!(state.daily_outflow_limit, 0);
    }

    #[test]
    fn test_create_treasury_large_balance() {
        let balance = u128::MAX / 2;
        let state = create_treasury(balance, 0).unwrap();
        assert_eq!(state.total_balance, balance);
        assert_eq!(state.available_balance, balance);
    }

    #[test]
    fn test_create_treasury_at_block_zero() {
        let state = create_treasury(1000 * PRECISION, 0).unwrap();
        assert_eq!(state.inception_block, 0);
    }

    #[test]
    fn test_create_treasury_at_large_block() {
        let state = create_treasury(1000 * PRECISION, u64::MAX).unwrap();
        assert_eq!(state.inception_block, u64::MAX);
    }

    // ============ Allocation Tests ============

    #[test]
    fn test_allocate_funds_valid() {
        let state = default_state();
        let amount = 10_000 * PRECISION; // 1% of treasury, within 5% daily limit
        let alloc = allocate_funds(
            &state, amount,
            AllocationPurpose::Development,
            default_recipient(),
            1_000_000,
        ).unwrap();
        assert_eq!(alloc.amount, amount);
        assert_eq!(alloc.recipient, default_recipient());
        assert_eq!(alloc.amount_claimed, 0);
        assert_eq!(alloc.vesting_duration, 1_000_000);
        assert_eq!(alloc.cliff_blocks, VESTING_CLIFF_BLOCKS);
    }

    #[test]
    fn test_allocate_funds_all_purposes() {
        let purposes = vec![
            AllocationPurpose::Development,
            AllocationPurpose::Marketing,
            AllocationPurpose::LiquidityIncentive,
            AllocationPurpose::SecurityBounty,
            AllocationPurpose::CommunityGrant,
            AllocationPurpose::EmergencyReserve,
            AllocationPurpose::Stabilization,
        ];

        let state = default_state();
        for purpose in purposes {
            let alloc = allocate_funds(
                &state, 1000 * PRECISION,
                purpose.clone(),
                default_recipient(),
                500_000,
            ).unwrap();
            assert_eq!(alloc.purpose, purpose);
        }
    }

    #[test]
    fn test_allocate_funds_exceeds_max() {
        let state = default_state();
        // 51% of treasury exceeds 50% max
        let amount = 510_000 * PRECISION;
        let result = allocate_funds(
            &state, amount,
            AllocationPurpose::Development,
            default_recipient(),
            1_000_000,
        );
        assert_eq!(result, Err(TreasuryError::AllocationTooLarge));
    }

    #[test]
    fn test_allocate_funds_exactly_max() {
        let state = default_state();
        // Exactly 50% but daily limit is 5%, so daily limit fails first
        let amount = 500_000 * PRECISION;
        let result = allocate_funds(
            &state, amount,
            AllocationPurpose::Development,
            default_recipient(),
            1_000_000,
        );
        assert_eq!(result, Err(TreasuryError::ExceedsDailyLimit));
    }

    #[test]
    fn test_allocate_funds_exceeds_daily_limit() {
        let state = default_state();
        // Daily limit is 5% = 50K. Try 51K.
        let amount = 51_000 * PRECISION;
        let result = allocate_funds(
            &state, amount,
            AllocationPurpose::Development,
            default_recipient(),
            1_000_000,
        );
        assert_eq!(result, Err(TreasuryError::ExceedsDailyLimit));
    }

    #[test]
    fn test_allocate_funds_at_daily_limit() {
        let state = default_state();
        // Exactly 5% = 50K — should succeed if reserve check passes
        // Available = 1M, reserve min = 10% = 100K, after alloc = 950K > 100K
        let amount = 50_000 * PRECISION;
        let alloc = allocate_funds(
            &state, amount,
            AllocationPurpose::Development,
            default_recipient(),
            1_000_000,
        ).unwrap();
        assert_eq!(alloc.amount, amount);
    }

    #[test]
    fn test_allocate_funds_below_reserve() {
        // Create treasury where reserve check bites
        let mut state = create_treasury(200 * PRECISION, 0).unwrap();
        state.daily_outflow_limit = 200 * PRECISION; // Raise daily limit to not interfere
        // available = 200, min reserve = 10% of 200 = 20
        // Max allocation BPS = 50% = 100, so max_alloc = 100
        // Try to allocate 95, leaving only 105 available... wait, 95 < 100 max
        // and 200 - 95 = 105 > 20 min reserve, so that passes.
        // Need: amount <= 100 (50% max) AND available - amount < 20 (10% min reserve)
        // Set available low: available = 30, try 25 -> remaining 5 < 20
        state.available_balance = 30 * PRECISION;
        state.reserved_balance = 170 * PRECISION;
        let amount = 25 * PRECISION; // Under 50% max (100)
        let result = allocate_funds(
            &state, amount,
            AllocationPurpose::Development,
            default_recipient(),
            1_000_000,
        );
        assert_eq!(result, Err(TreasuryError::BelowMinReserve));
    }

    #[test]
    fn test_allocate_funds_emergency_blocked() {
        let mut state = default_state();
        state.emergency_mode = true;
        let result = allocate_funds(
            &state, 1000 * PRECISION,
            AllocationPurpose::Development,
            default_recipient(),
            1_000_000,
        );
        assert_eq!(result, Err(TreasuryError::EmergencyModeActive));
    }

    #[test]
    fn test_allocate_funds_zero_amount() {
        let state = default_state();
        let result = allocate_funds(
            &state, 0,
            AllocationPurpose::Development,
            default_recipient(),
            1_000_000,
        );
        assert_eq!(result, Err(TreasuryError::ZeroAmount));
    }

    #[test]
    fn test_allocate_funds_zero_vesting() {
        let state = default_state();
        let result = allocate_funds(
            &state, 1000 * PRECISION,
            AllocationPurpose::Development,
            default_recipient(),
            0,
        );
        assert_eq!(result, Err(TreasuryError::InvalidVestingSchedule));
    }

    #[test]
    fn test_allocate_funds_exceeds_max_vesting() {
        let state = default_state();
        let result = allocate_funds(
            &state, 1000 * PRECISION,
            AllocationPurpose::Development,
            default_recipient(),
            MAX_VESTING_DURATION + 1,
        );
        assert_eq!(result, Err(TreasuryError::InvalidVestingSchedule));
    }

    #[test]
    fn test_allocate_funds_max_vesting_duration() {
        let state = default_state();
        let alloc = allocate_funds(
            &state, 1000 * PRECISION,
            AllocationPurpose::Development,
            default_recipient(),
            MAX_VESTING_DURATION,
        ).unwrap();
        assert_eq!(alloc.vesting_duration, MAX_VESTING_DURATION);
    }

    #[test]
    fn test_allocate_funds_insufficient_available() {
        let mut state = default_state();
        // Reserve most of the balance
        state.reserved_balance = 999_000 * PRECISION;
        state.available_balance = 1_000 * PRECISION;
        // daily limit = 50K, try to allocate 2000 (within daily but exceeds available)
        let result = allocate_funds(
            &state, 2_000 * PRECISION,
            AllocationPurpose::Development,
            default_recipient(),
            1_000_000,
        );
        assert_eq!(result, Err(TreasuryError::InsufficientFunds));
    }

    #[test]
    fn test_allocate_funds_daily_already_spent() {
        let mut state = default_state();
        state.daily_outflow = state.daily_outflow_limit;
        let result = allocate_funds(
            &state, 1000 * PRECISION,
            AllocationPurpose::Development,
            default_recipient(),
            1_000_000,
        );
        assert_eq!(result, Err(TreasuryError::ExceedsDailyLimit));
    }

    // ============ Vesting Tests ============

    #[test]
    fn test_vesting_before_cliff() {
        let alloc = make_allocation(1_000_000 * PRECISION, 1000, 5_000_000);
        // Before cliff (block 1000 + 100_000 = 101_000)
        let vested = compute_vested_amount(&alloc, 50_000);
        assert_eq!(vested, 0);
    }

    #[test]
    fn test_vesting_at_cliff() {
        let alloc = make_allocation(1_000_000 * PRECISION, 1000, 5_000_000);
        let cliff_end = 1000 + VESTING_CLIFF_BLOCKS;
        let vested = compute_vested_amount(&alloc, cliff_end);
        // At exact cliff end, 0 blocks of vesting have passed
        assert_eq!(vested, 0);
    }

    #[test]
    fn test_vesting_just_after_cliff() {
        let alloc = make_allocation(1_000_000 * PRECISION, 0, 5_000_000);
        let cliff_end = VESTING_CLIFF_BLOCKS;
        let vested = compute_vested_amount(&alloc, cliff_end + 1);
        // 1 / 5_000_000 of total
        let expected = mul_div(1_000_000 * PRECISION, 1, 5_000_000);
        assert_eq!(vested, expected);
    }

    #[test]
    fn test_vesting_partial_50_percent() {
        let alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        let cliff_end = VESTING_CLIFF_BLOCKS;
        let half_way = cliff_end + 500_000;
        let vested = compute_vested_amount(&alloc, half_way);
        // 500_000 / 1_000_000 = 50%
        assert_eq!(vested, 500_000 * PRECISION);
    }

    #[test]
    fn test_vesting_partial_25_percent() {
        let alloc = make_allocation(1_000_000 * PRECISION, 0, 4_000_000);
        let cliff_end = VESTING_CLIFF_BLOCKS;
        let quarter_way = cliff_end + 1_000_000;
        let vested = compute_vested_amount(&alloc, quarter_way);
        assert_eq!(vested, 250_000 * PRECISION);
    }

    #[test]
    fn test_vesting_full() {
        let alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        let vesting_end = VESTING_CLIFF_BLOCKS + 1_000_000;
        let vested = compute_vested_amount(&alloc, vesting_end);
        assert_eq!(vested, 1_000_000 * PRECISION);
    }

    #[test]
    fn test_vesting_after_full() {
        let alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        let well_after = VESTING_CLIFF_BLOCKS + 1_000_000 + 999_999;
        let vested = compute_vested_amount(&alloc, well_after);
        assert_eq!(vested, 1_000_000 * PRECISION);
    }

    #[test]
    fn test_vesting_zero_amount() {
        let alloc = make_allocation(0, 0, 1_000_000);
        let vested = compute_vested_amount(&alloc, VESTING_CLIFF_BLOCKS + 500_000);
        assert_eq!(vested, 0);
    }

    #[test]
    fn test_vesting_at_start_block() {
        let alloc = make_allocation(1_000_000 * PRECISION, 1000, 1_000_000);
        let vested = compute_vested_amount(&alloc, 1000);
        assert_eq!(vested, 0); // Before cliff
    }

    #[test]
    fn test_vesting_nonzero_start() {
        let alloc = make_allocation(1_000_000 * PRECISION, 500_000, 2_000_000);
        let cliff_end = 500_000 + VESTING_CLIFF_BLOCKS;
        let halfway = cliff_end + 1_000_000;
        let vested = compute_vested_amount(&alloc, halfway);
        assert_eq!(vested, 500_000 * PRECISION);
    }

    #[test]
    fn test_vesting_max_duration() {
        let alloc = make_allocation(1_000_000 * PRECISION, 0, MAX_VESTING_DURATION);
        let tenth = VESTING_CLIFF_BLOCKS + MAX_VESTING_DURATION / 10;
        let vested = compute_vested_amount(&alloc, tenth);
        // 10% vested
        let expected = mul_div(1_000_000 * PRECISION, (MAX_VESTING_DURATION / 10) as u128, MAX_VESTING_DURATION as u128);
        assert_eq!(vested, expected);
    }

    // ============ Claimable Tests ============

    #[test]
    fn test_claimable_nothing_vested() {
        let alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        let claimable = compute_claimable(&alloc, 50_000); // Before cliff
        assert_eq!(claimable, 0);
    }

    #[test]
    fn test_claimable_partial() {
        let alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        let claimable = compute_claimable(&alloc, VESTING_CLIFF_BLOCKS + 500_000);
        assert_eq!(claimable, 500_000 * PRECISION);
    }

    #[test]
    fn test_claimable_full() {
        let alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        let claimable = compute_claimable(&alloc, VESTING_CLIFF_BLOCKS + 1_000_000);
        assert_eq!(claimable, 1_000_000 * PRECISION);
    }

    #[test]
    fn test_claimable_after_partial_claim() {
        let mut alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        alloc.amount_claimed = 200_000 * PRECISION;
        let claimable = compute_claimable(&alloc, VESTING_CLIFF_BLOCKS + 500_000);
        // 500K vested - 200K claimed = 300K
        assert_eq!(claimable, 300_000 * PRECISION);
    }

    #[test]
    fn test_claimable_fully_claimed() {
        let mut alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        alloc.amount_claimed = 1_000_000 * PRECISION;
        let claimable = compute_claimable(&alloc, VESTING_CLIFF_BLOCKS + 1_000_000);
        assert_eq!(claimable, 0);
    }

    #[test]
    fn test_claimable_overclaimed_edge() {
        // Edge case: claimed > vested (shouldn't happen but be safe)
        let mut alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        alloc.amount_claimed = 600_000 * PRECISION;
        let claimable = compute_claimable(&alloc, VESTING_CLIFF_BLOCKS + 500_000);
        // 500K vested but 600K claimed — claimable should be 0
        assert_eq!(claimable, 0);
    }

    // ============ Claim Vested Tests ============

    #[test]
    fn test_claim_vested_success() {
        let alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        let block = VESTING_CLIFF_BLOCKS + 500_000;
        let (claimed, updated) = claim_vested(&alloc, block).unwrap();
        assert_eq!(claimed, 500_000 * PRECISION);
        assert_eq!(updated.amount_claimed, 500_000 * PRECISION);
    }

    #[test]
    fn test_claim_vested_nothing_available() {
        let alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        let result = claim_vested(&alloc, 50_000); // Before cliff
        assert_eq!(result, Err(TreasuryError::InsufficientFunds));
    }

    #[test]
    fn test_claim_vested_full() {
        let alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        let block = VESTING_CLIFF_BLOCKS + 1_000_000;
        let (claimed, updated) = claim_vested(&alloc, block).unwrap();
        assert_eq!(claimed, 1_000_000 * PRECISION);
        assert_eq!(updated.amount_claimed, 1_000_000 * PRECISION);
    }

    #[test]
    fn test_claim_vested_double_claim() {
        let alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        let block = VESTING_CLIFF_BLOCKS + 500_000;
        let (_, updated) = claim_vested(&alloc, block).unwrap();
        // Claim again at same block — nothing new to claim
        let result = claim_vested(&updated, block);
        assert_eq!(result, Err(TreasuryError::InsufficientFunds));
    }

    #[test]
    fn test_claim_vested_incremental() {
        let alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        // First claim at 25%
        let block1 = VESTING_CLIFF_BLOCKS + 250_000;
        let (claimed1, updated1) = claim_vested(&alloc, block1).unwrap();
        assert_eq!(claimed1, 250_000 * PRECISION);

        // Second claim at 75%
        let block2 = VESTING_CLIFF_BLOCKS + 750_000;
        let (claimed2, updated2) = claim_vested(&updated1, block2).unwrap();
        assert_eq!(claimed2, 500_000 * PRECISION); // 750K vested - 250K already claimed
        assert_eq!(updated2.amount_claimed, 750_000 * PRECISION);
    }

    #[test]
    fn test_claim_vested_after_full_vest() {
        let mut alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        alloc.amount_claimed = 800_000 * PRECISION;
        let block = VESTING_CLIFF_BLOCKS + 2_000_000; // Well after full vest
        let (claimed, updated) = claim_vested(&alloc, block).unwrap();
        assert_eq!(claimed, 200_000 * PRECISION);
        assert_eq!(updated.amount_claimed, 1_000_000 * PRECISION);
    }

    // ============ Daily Limit Tests ============

    #[test]
    fn test_daily_limit_under() {
        let state = default_state();
        let remaining = check_daily_limit(&state, 10_000 * PRECISION).unwrap();
        // limit = 50K, proposed = 10K, remaining = 40K
        assert_eq!(remaining, 40_000 * PRECISION);
    }

    #[test]
    fn test_daily_limit_at() {
        let state = default_state();
        let remaining = check_daily_limit(&state, 50_000 * PRECISION).unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn test_daily_limit_over() {
        let state = default_state();
        let result = check_daily_limit(&state, 50_001 * PRECISION);
        assert_eq!(result, Err(TreasuryError::ExceedsDailyLimit));
    }

    #[test]
    fn test_daily_limit_zero_proposed() {
        let state = default_state();
        let result = check_daily_limit(&state, 0);
        assert_eq!(result, Err(TreasuryError::ZeroAmount));
    }

    #[test]
    fn test_daily_limit_partially_spent() {
        let mut state = default_state();
        state.daily_outflow = 30_000 * PRECISION;
        let remaining = check_daily_limit(&state, 10_000 * PRECISION).unwrap();
        // limit = 50K, spent = 30K, proposed = 10K, remaining = 10K
        assert_eq!(remaining, 10_000 * PRECISION);
    }

    #[test]
    fn test_daily_limit_fully_spent() {
        let mut state = default_state();
        state.daily_outflow = 50_000 * PRECISION;
        let result = check_daily_limit(&state, 1);
        assert_eq!(result, Err(TreasuryError::ExceedsDailyLimit));
    }

    #[test]
    fn test_daily_limit_almost_at_limit() {
        let mut state = default_state();
        state.daily_outflow = 50_000 * PRECISION - 1;
        let remaining = check_daily_limit(&state, 1).unwrap();
        assert_eq!(remaining, 0);
    }

    // ============ Update Daily Outflow Tests ============

    #[test]
    fn test_update_daily_outflow_valid() {
        let state = default_state();
        let updated = update_daily_outflow(&state, 10_000 * PRECISION).unwrap();
        assert_eq!(updated.daily_outflow, 10_000 * PRECISION);
    }

    #[test]
    fn test_update_daily_outflow_zero() {
        let state = default_state();
        let result = update_daily_outflow(&state, 0);
        assert_eq!(result, Err(TreasuryError::ZeroAmount));
    }

    #[test]
    fn test_update_daily_outflow_exceeds() {
        let state = default_state();
        let result = update_daily_outflow(&state, 50_001 * PRECISION);
        assert_eq!(result, Err(TreasuryError::ExceedsDailyLimit));
    }

    #[test]
    fn test_update_daily_outflow_cumulative() {
        let state = default_state();
        let s1 = update_daily_outflow(&state, 20_000 * PRECISION).unwrap();
        let s2 = update_daily_outflow(&s1, 20_000 * PRECISION).unwrap();
        assert_eq!(s2.daily_outflow, 40_000 * PRECISION);
        // Third push over the limit
        let result = update_daily_outflow(&s2, 20_000 * PRECISION);
        assert_eq!(result, Err(TreasuryError::ExceedsDailyLimit));
    }

    #[test]
    fn test_update_daily_outflow_exact_limit() {
        let state = default_state();
        let updated = update_daily_outflow(&state, 50_000 * PRECISION).unwrap();
        assert_eq!(updated.daily_outflow, 50_000 * PRECISION);
    }

    // ============ Emergency Mode Tests ============

    #[test]
    fn test_enter_emergency_valid() {
        let state = default_state();
        // 25% drawdown (above 20% threshold)
        let current_balance = 750_000 * PRECISION;
        let updated = enter_emergency_mode(&state, current_balance).unwrap();
        assert!(updated.emergency_mode);
        assert_eq!(updated.total_balance, current_balance);
    }

    #[test]
    fn test_enter_emergency_exactly_at_threshold() {
        let state = default_state();
        // Exactly 20% drawdown
        let current_balance = 800_000 * PRECISION;
        let updated = enter_emergency_mode(&state, current_balance).unwrap();
        assert!(updated.emergency_mode);
    }

    #[test]
    fn test_enter_emergency_threshold_not_met() {
        let state = default_state();
        // Only 10% drawdown (below 20% threshold)
        let current_balance = 900_000 * PRECISION;
        let result = enter_emergency_mode(&state, current_balance);
        assert_eq!(result, Err(TreasuryError::EmergencyThresholdNotMet));
    }

    #[test]
    fn test_enter_emergency_no_drawdown() {
        let state = default_state();
        let result = enter_emergency_mode(&state, state.total_balance);
        assert_eq!(result, Err(TreasuryError::EmergencyThresholdNotMet));
    }

    #[test]
    fn test_enter_emergency_balance_above_total() {
        let state = default_state();
        let result = enter_emergency_mode(&state, state.total_balance + 1);
        assert_eq!(result, Err(TreasuryError::EmergencyThresholdNotMet));
    }

    #[test]
    fn test_enter_emergency_already_active() {
        let mut state = default_state();
        state.emergency_mode = true;
        let result = enter_emergency_mode(&state, 500_000 * PRECISION);
        assert_eq!(result, Err(TreasuryError::EmergencyModeActive));
    }

    #[test]
    fn test_enter_emergency_updates_limits() {
        let state = default_state();
        let current_balance = 600_000 * PRECISION;
        let updated = enter_emergency_mode(&state, current_balance).unwrap();
        // New daily limit should be 5% of 600K = 30K
        assert_eq!(updated.daily_outflow_limit, 30_000 * PRECISION);
        assert_eq!(updated.available_balance, current_balance);
    }

    #[test]
    fn test_enter_emergency_with_reservations() {
        let mut state = default_state();
        state.reserved_balance = 200_000 * PRECISION;
        state.available_balance = 800_000 * PRECISION;
        let current_balance = 700_000 * PRECISION;
        let updated = enter_emergency_mode(&state, current_balance).unwrap();
        // available = 700K - 200K reserved = 500K
        assert_eq!(updated.available_balance, 500_000 * PRECISION);
    }

    #[test]
    fn test_enter_emergency_reserves_exceed_balance() {
        let mut state = default_state();
        state.reserved_balance = 800_000 * PRECISION;
        state.available_balance = 200_000 * PRECISION;
        let current_balance = 700_000 * PRECISION;
        let updated = enter_emergency_mode(&state, current_balance).unwrap();
        // reserved (800K) > current (700K), available should be 0
        assert_eq!(updated.available_balance, 0);
    }

    #[test]
    fn test_exit_emergency_valid() {
        let mut state = default_state();
        state.emergency_mode = true;
        let updated = exit_emergency_mode(&state).unwrap();
        assert!(!updated.emergency_mode);
    }

    #[test]
    fn test_exit_emergency_not_active() {
        let state = default_state();
        let result = exit_emergency_mode(&state);
        assert_eq!(result, Err(TreasuryError::EmergencyThresholdNotMet));
    }

    #[test]
    fn test_emergency_blocks_allocation() {
        let state = default_state();
        let current_balance = 700_000 * PRECISION;
        let em_state = enter_emergency_mode(&state, current_balance).unwrap();
        let result = allocate_funds(
            &em_state, 1000 * PRECISION,
            AllocationPurpose::Development,
            default_recipient(),
            1_000_000,
        );
        assert_eq!(result, Err(TreasuryError::EmergencyModeActive));
    }

    #[test]
    fn test_enter_exit_enter_emergency() {
        let state = default_state();
        let em1 = enter_emergency_mode(&state, 750_000 * PRECISION).unwrap();
        assert!(em1.emergency_mode);
        let normal = exit_emergency_mode(&em1).unwrap();
        assert!(!normal.emergency_mode);
        // Can re-enter if drawdown threshold hit again
        // Need to set up so current < total * 0.8
        let em2 = enter_emergency_mode(&normal, 550_000 * PRECISION).unwrap();
        assert!(em2.emergency_mode);
    }

    // ============ Reserve Ratio Tests ============

    #[test]
    fn test_reserve_ratio_zero_reserved() {
        let state = default_state();
        assert_eq!(compute_reserve_ratio(&state), 0);
    }

    #[test]
    fn test_reserve_ratio_half_reserved() {
        let mut state = default_state();
        state.reserved_balance = 500_000 * PRECISION;
        assert_eq!(compute_reserve_ratio(&state), 5000); // 50%
    }

    #[test]
    fn test_reserve_ratio_fully_reserved() {
        let mut state = default_state();
        state.reserved_balance = 1_000_000 * PRECISION;
        assert_eq!(compute_reserve_ratio(&state), 10_000); // 100%
    }

    #[test]
    fn test_reserve_ratio_small_fraction() {
        let mut state = default_state();
        // 1% reserved
        state.reserved_balance = 10_000 * PRECISION;
        assert_eq!(compute_reserve_ratio(&state), 100); // 1% in BPS
    }

    #[test]
    fn test_reserve_ratio_zero_total() {
        let mut state = default_state();
        state.total_balance = 0;
        assert_eq!(compute_reserve_ratio(&state), 0);
    }

    #[test]
    fn test_reserve_ratio_10_percent() {
        let mut state = default_state();
        state.reserved_balance = 100_000 * PRECISION;
        assert_eq!(compute_reserve_ratio(&state), 1000); // 10% = MIN_RESERVE_RATIO_BPS
    }

    // ============ Stabilization Tests ============

    #[test]
    fn test_stabilization_price_below_target() {
        // Price is 10% below target
        let current = 900 * PRECISION;
        let target = 1000 * PRECISION;
        let available = 100_000 * PRECISION;
        let pool = 1_000_000 * PRECISION;

        let action = compute_stabilization_action(current, target, available, pool).unwrap();
        assert_eq!(action.action_type, StabilizationType::BuySupport);
        assert!(action.amount > 0);
        assert_eq!(action.target_price, target);
        assert_eq!(action.current_price, current);
    }

    #[test]
    fn test_stabilization_price_above_target() {
        // Price is 10% above target
        let current = 1100 * PRECISION;
        let target = 1000 * PRECISION;
        let available = 100_000 * PRECISION;
        let pool = 1_000_000 * PRECISION;

        let action = compute_stabilization_action(current, target, available, pool).unwrap();
        assert_eq!(action.action_type, StabilizationType::SellPressure);
        assert!(action.amount > 0);
    }

    #[test]
    fn test_stabilization_price_near_target() {
        // Price is 1% below target (within REBALANCE_THRESHOLD_BPS of 3%)
        let current = 990 * PRECISION;
        let target = 1000 * PRECISION;
        let available = 100_000 * PRECISION;
        let pool = 1_000_000 * PRECISION;

        let action = compute_stabilization_action(current, target, available, pool).unwrap();
        assert_eq!(action.action_type, StabilizationType::LiquidityAdd);
    }

    #[test]
    fn test_stabilization_price_equal() {
        let price = 1000 * PRECISION;
        let available = 100_000 * PRECISION;
        let pool = 1_000_000 * PRECISION;

        let action = compute_stabilization_action(price, price, available, pool).unwrap();
        assert_eq!(action.action_type, StabilizationType::LiquidityAdd);
        // Deviation is 0, so amount should be minimum (1)
        assert_eq!(action.amount, 1);
    }

    #[test]
    fn test_stabilization_zero_price() {
        let result = compute_stabilization_action(0, 1000 * PRECISION, 100_000 * PRECISION, 1_000_000 * PRECISION);
        assert_eq!(result, Err(TreasuryError::ZeroAmount));
    }

    #[test]
    fn test_stabilization_zero_target() {
        let result = compute_stabilization_action(1000 * PRECISION, 0, 100_000 * PRECISION, 1_000_000 * PRECISION);
        assert_eq!(result, Err(TreasuryError::ZeroAmount));
    }

    #[test]
    fn test_stabilization_zero_available() {
        let result = compute_stabilization_action(1000 * PRECISION, 1000 * PRECISION, 0, 1_000_000 * PRECISION);
        assert_eq!(result, Err(TreasuryError::InsufficientFunds));
    }

    #[test]
    fn test_stabilization_large_deviation() {
        // Price is 50% below target
        let current = 500 * PRECISION;
        let target = 1000 * PRECISION;
        let available = 100_000 * PRECISION;
        let pool = 1_000_000 * PRECISION;

        let action = compute_stabilization_action(current, target, available, pool).unwrap();
        assert_eq!(action.action_type, StabilizationType::BuySupport);
        // Amount should be capped at max_action (50% of available = 50K)
        assert!(action.amount <= available / 2);
    }

    #[test]
    fn test_stabilization_small_pool() {
        let current = 900 * PRECISION;
        let target = 1000 * PRECISION;
        let available = 100_000 * PRECISION;
        let pool = 100 * PRECISION; // Very small pool

        let action = compute_stabilization_action(current, target, available, pool).unwrap();
        assert!(action.impact_estimate > 0);
        // Impact should be large relative to pool
    }

    #[test]
    fn test_stabilization_zero_pool() {
        let current = 900 * PRECISION;
        let target = 1000 * PRECISION;
        let available = 100_000 * PRECISION;

        let action = compute_stabilization_action(current, target, available, 0).unwrap();
        assert_eq!(action.impact_estimate, 0); // Can't estimate impact with zero pool
    }

    #[test]
    fn test_stabilization_at_3_percent_boundary() {
        // Exactly at REBALANCE_THRESHOLD_BPS (3%)
        let target = 10_000 * PRECISION;
        let current = target - mul_div(target, REBALANCE_THRESHOLD_BPS as u128, BPS);
        let available = 100_000 * PRECISION;
        let pool = 1_000_000 * PRECISION;

        let action = compute_stabilization_action(current, target, available, pool).unwrap();
        // 3% deviation = exactly at threshold, should be LiquidityAdd (not exceeding)
        assert_eq!(action.action_type, StabilizationType::LiquidityAdd);
    }

    #[test]
    fn test_stabilization_just_above_3_percent() {
        // 3.01% below target
        let target = 10_000 * PRECISION;
        let deviation = mul_div(target, 301, BPS); // 3.01%
        let current = target - deviation;
        let available = 100_000 * PRECISION;
        let pool = 1_000_000 * PRECISION;

        let action = compute_stabilization_action(current, target, available, pool).unwrap();
        assert_eq!(action.action_type, StabilizationType::BuySupport);
    }

    // ============ Price Impact Tests ============

    #[test]
    fn test_price_impact_small_trade() {
        let action = StabilizationAction {
            action_type: StabilizationType::BuySupport,
            amount: 1000 * PRECISION,
            target_price: PRECISION,
            current_price: PRECISION,
            impact_estimate: 0,
        };
        let impact = estimate_price_impact(&action, 1_000_000 * PRECISION, 1_000_000 * PRECISION).unwrap();
        // 1000 / (1M + 1000) ~= 0.1%
        assert!(impact > 0);
        assert!(impact < PRECISION / 100); // Less than 1%
    }

    #[test]
    fn test_price_impact_large_trade() {
        let action = StabilizationAction {
            action_type: StabilizationType::BuySupport,
            amount: 500_000 * PRECISION,
            target_price: PRECISION,
            current_price: PRECISION,
            impact_estimate: 0,
        };
        let impact = estimate_price_impact(&action, 1_000_000 * PRECISION, 1_000_000 * PRECISION).unwrap();
        // 500K / 1.5M ~= 33%
        assert!(impact > PRECISION / 10); // More than 10%
    }

    #[test]
    fn test_price_impact_zero_trade() {
        let action = StabilizationAction {
            action_type: StabilizationType::BuySupport,
            amount: 0,
            target_price: PRECISION,
            current_price: PRECISION,
            impact_estimate: 0,
        };
        let impact = estimate_price_impact(&action, 1_000_000 * PRECISION, 1_000_000 * PRECISION).unwrap();
        assert_eq!(impact, 0);
    }

    #[test]
    fn test_price_impact_zero_pool_x() {
        let action = StabilizationAction {
            action_type: StabilizationType::BuySupport,
            amount: 1000 * PRECISION,
            target_price: PRECISION,
            current_price: PRECISION,
            impact_estimate: 0,
        };
        let result = estimate_price_impact(&action, 0, 1_000_000 * PRECISION);
        assert_eq!(result, Err(TreasuryError::ZeroAmount));
    }

    #[test]
    fn test_price_impact_zero_pool_y() {
        let action = StabilizationAction {
            action_type: StabilizationType::BuySupport,
            amount: 1000 * PRECISION,
            target_price: PRECISION,
            current_price: PRECISION,
            impact_estimate: 0,
        };
        let result = estimate_price_impact(&action, 1_000_000 * PRECISION, 0);
        assert_eq!(result, Err(TreasuryError::ZeroAmount));
    }

    #[test]
    fn test_price_impact_asymmetric_pools() {
        let action = StabilizationAction {
            action_type: StabilizationType::BuySupport,
            amount: 1000 * PRECISION,
            target_price: PRECISION,
            current_price: PRECISION,
            impact_estimate: 0,
        };
        // Pool with 1M:2M ratio
        let impact = estimate_price_impact(&action, 1_000_000 * PRECISION, 2_000_000 * PRECISION).unwrap();
        assert!(impact > 0);
    }

    #[test]
    fn test_price_impact_sell_pressure() {
        let action = StabilizationAction {
            action_type: StabilizationType::SellPressure,
            amount: 10_000 * PRECISION,
            target_price: PRECISION,
            current_price: PRECISION,
            impact_estimate: 0,
        };
        let impact = estimate_price_impact(&action, 1_000_000 * PRECISION, 1_000_000 * PRECISION).unwrap();
        assert!(impact > 0);
    }

    // ============ Report Tests ============

    #[test]
    fn test_report_healthy_treasury() {
        let mut state = default_state();
        state.reserved_balance = 300_000 * PRECISION;
        state.available_balance = 700_000 * PRECISION;

        let alloc = make_allocation(300_000 * PRECISION, 0, 1_000_000);
        let report = generate_report(&state, &[alloc], VESTING_CLIFF_BLOCKS + 500_000, 100 * PRECISION);

        assert_eq!(report.total_assets, 1_000_000 * PRECISION);
        // 50% vested, so 150K unvested liabilities
        assert_eq!(report.total_liabilities, 150_000 * PRECISION);
        assert_eq!(report.net_position, 850_000 * PRECISION);
        assert_eq!(report.reserve_ratio_bps, 3000); // 30%
        assert!(report.health_score > 0);
        assert!(report.runway_blocks > 0);
    }

    #[test]
    fn test_report_zero_allocations() {
        let state = default_state();
        let report = generate_report(&state, &[], 1000, 0);
        assert_eq!(report.total_liabilities, 0);
        assert_eq!(report.net_position, state.total_balance);
        assert_eq!(report.runway_blocks, u64::MAX); // No outflow = infinite runway
    }

    #[test]
    fn test_report_emergency_mode() {
        let mut state = default_state();
        state.emergency_mode = true;
        let report = generate_report(&state, &[], 1000, 100 * PRECISION);
        // Emergency mode = 0 emergency_score
        assert!(report.health_score < 70); // Missing 30pts from emergency
    }

    #[test]
    fn test_report_critical_treasury() {
        let mut state = create_treasury(100 * PRECISION, 0).unwrap();
        state.reserved_balance = 95 * PRECISION;
        state.available_balance = 5 * PRECISION;
        state.emergency_mode = true;

        let report = generate_report(&state, &[], 1000, 10 * PRECISION);
        assert_eq!(report.reserve_ratio_bps, 9500); // 95%
        assert!(report.health_score < 50);
        // runway = 5 / 10 = 0 blocks
        assert_eq!(report.runway_blocks, 0);
    }

    #[test]
    fn test_report_runway_calculation() {
        let state = default_state();
        // avg outflow = 1000 per block, available = 1M
        let report = generate_report(&state, &[], 1000, 1000 * PRECISION);
        assert_eq!(report.runway_blocks, 1000); // 1M / 1K = 1000 blocks
    }

    #[test]
    fn test_report_multiple_allocations() {
        let state = default_state();
        let allocs = vec![
            make_allocation(200_000 * PRECISION, 0, 1_000_000),
            make_allocation(100_000 * PRECISION, 0, 2_000_000),
            make_allocation(50_000 * PRECISION, 0, 500_000),
        ];
        let block = VESTING_CLIFF_BLOCKS + 500_000;
        let report = generate_report(&state, &allocs, block, 100 * PRECISION);

        // Alloc 1: 50% vested, 100K unvested
        // Alloc 2: 25% vested, 75K unvested
        // Alloc 3: 100% vested, 0 unvested
        // Total liabilities = 175K
        assert_eq!(report.total_liabilities, 175_000 * PRECISION);
    }

    #[test]
    fn test_report_fully_vested_allocations() {
        let state = default_state();
        let allocs = vec![
            make_allocation(200_000 * PRECISION, 0, 100_000),
        ];
        let block = VESTING_CLIFF_BLOCKS + 200_000; // Well after vest end
        let report = generate_report(&state, &allocs, block, 100 * PRECISION);
        assert_eq!(report.total_liabilities, 0);
    }

    #[test]
    fn test_report_utilization_bps() {
        let mut state = default_state();
        state.reserved_balance = 250_000 * PRECISION;
        let report = generate_report(&state, &[], 1000, 0);
        assert_eq!(report.utilization_bps, 2500); // 25%
    }

    // ============ Rebalance Tests ============

    #[test]
    fn test_rebalance_needed() {
        // Category 0 is 5% over, Category 1 is 5% under
        let actual = vec![5500, 2500, 2000];
        let target = vec![5000, 3000, 2000];
        let (from, to, dev) = check_rebalance_needed(&actual, &target).unwrap();
        assert_eq!(from, 0);
        assert_eq!(to, 1);
        assert_eq!(dev, 500);
    }

    #[test]
    fn test_rebalance_not_needed() {
        // All within 3% threshold (max deviation = 299 < 300)
        let actual = vec![5299, 2751, 1950];
        let target = vec![5000, 3000, 2000];
        let result = check_rebalance_needed(&actual, &target);
        assert_eq!(result, Err(TreasuryError::RebalanceNotNeeded));
    }

    #[test]
    fn test_rebalance_exact_threshold() {
        // Exactly at 3% = 300 BPS — triggers (>= threshold)
        let actual = vec![5300, 2700, 2000];
        let target = vec![5000, 3000, 2000];
        let (from, to, dev) = check_rebalance_needed(&actual, &target).unwrap();
        assert_eq!(from, 0);
        assert_eq!(to, 1);
        assert_eq!(dev, 300);
    }

    #[test]
    fn test_rebalance_just_above_threshold() {
        // 301 BPS deviation — triggers
        let actual = vec![5301, 2699, 2000];
        let target = vec![5000, 3000, 2000];
        let (from, to, dev) = check_rebalance_needed(&actual, &target).unwrap();
        assert_eq!(from, 0);
        assert_eq!(to, 1);
        assert_eq!(dev, 301);
    }

    #[test]
    fn test_rebalance_multiple_categories() {
        let actual = vec![6000, 1500, 1000, 1500];
        let target = vec![4000, 3000, 1500, 1500];
        let (from, to, dev) = check_rebalance_needed(&actual, &target).unwrap();
        assert_eq!(from, 0); // 6000 vs 4000 = +2000
        assert_eq!(to, 1);   // 1500 vs 3000 = -1500
        assert_eq!(dev, 2000);
    }

    #[test]
    fn test_rebalance_empty_arrays() {
        let result = check_rebalance_needed(&[], &[]);
        assert_eq!(result, Err(TreasuryError::InvalidBasisPoints));
    }

    #[test]
    fn test_rebalance_mismatched_lengths() {
        let result = check_rebalance_needed(&[5000, 5000], &[3000, 3000, 4000]);
        assert_eq!(result, Err(TreasuryError::InvalidBasisPoints));
    }

    #[test]
    fn test_rebalance_all_equal() {
        let actual = vec![5000, 3000, 2000];
        let target = vec![5000, 3000, 2000];
        let result = check_rebalance_needed(&actual, &target);
        assert_eq!(result, Err(TreasuryError::RebalanceNotNeeded));
    }

    #[test]
    fn test_rebalance_only_over_no_under() {
        // All actual >= target, no under-allocation
        let actual = vec![5500, 3200, 1300];
        let target = vec![5000, 3000, 2000];
        // max_under_idx will be Some for index 2 (target 2000 > actual 1300)
        // Wait — 1300 < 2000, so that IS under-allocated
        let result = check_rebalance_needed(&actual, &target);
        // dev for over: index 0 = 500, index 1 = 200
        // dev for under: index 2 = 700
        // max_dev = 700 >= 300, from=0 (500), to=2 (700)
        let (from, to, dev) = result.unwrap();
        assert_eq!(from, 0);
        assert_eq!(to, 2);
        assert_eq!(dev, 700);
    }

    // ============ Compute Rebalance Tests ============

    #[test]
    fn test_compute_rebalance_valid() {
        // from_balance = 6000, target = 5000, total = 10000
        // excess = 1000
        // to_balance = 2000, to_target = 5000, deficit = 3000
        // transfer = min(1000, 3000) = 1000
        let amount = compute_rebalance(
            6000 * PRECISION,
            2000 * PRECISION,
            5000, // target_ratio_bps
            10_000 * PRECISION,
        ).unwrap();
        assert_eq!(amount, 1000 * PRECISION);
    }

    #[test]
    fn test_compute_rebalance_excess_exceeds_deficit() {
        // from_balance = 8000, target = 5000, total = 10000
        // excess = 3000
        // to_balance = 4500, to_target = 5000, deficit = 500
        // transfer = min(3000, 500) = 500
        let amount = compute_rebalance(
            8000 * PRECISION,
            4500 * PRECISION,
            5000, // target_ratio_bps
            10_000 * PRECISION,
        ).unwrap();
        assert_eq!(amount, 500 * PRECISION);
    }

    #[test]
    fn test_compute_rebalance_from_at_target() {
        let result = compute_rebalance(
            5000 * PRECISION,
            3000 * PRECISION,
            5000,
            10_000 * PRECISION,
        );
        assert_eq!(result, Err(TreasuryError::RebalanceNotNeeded));
    }

    #[test]
    fn test_compute_rebalance_from_below_target() {
        let result = compute_rebalance(
            4000 * PRECISION,
            3000 * PRECISION,
            5000,
            10_000 * PRECISION,
        );
        assert_eq!(result, Err(TreasuryError::RebalanceNotNeeded));
    }

    #[test]
    fn test_compute_rebalance_zero_total() {
        let result = compute_rebalance(1000, 500, 5000, 0);
        assert_eq!(result, Err(TreasuryError::ZeroAmount));
    }

    #[test]
    fn test_compute_rebalance_invalid_bps() {
        let result = compute_rebalance(1000, 500, 10_001, 10_000);
        assert_eq!(result, Err(TreasuryError::InvalidBasisPoints));
    }

    #[test]
    fn test_compute_rebalance_to_at_target() {
        // to_balance is already at target, deficit = 0
        let result = compute_rebalance(
            6000 * PRECISION,
            5000 * PRECISION,
            5000,
            10_000 * PRECISION,
        );
        assert_eq!(result, Err(TreasuryError::RebalanceNotNeeded));
    }

    #[test]
    fn test_compute_rebalance_to_above_target() {
        // to_balance is above target
        let result = compute_rebalance(
            6000 * PRECISION,
            6000 * PRECISION,
            5000,
            10_000 * PRECISION,
        );
        assert_eq!(result, Err(TreasuryError::RebalanceNotNeeded));
    }

    // ============ Integration / Cross-Function Tests ============

    #[test]
    fn test_allocate_then_vest_then_claim() {
        let state = default_state();
        let alloc = allocate_funds(
            &state, 10_000 * PRECISION,
            AllocationPurpose::Development,
            default_recipient(),
            2_000_000,
        ).unwrap();

        let mut alloc = alloc;
        alloc.vesting_start = 0;

        // Before cliff: nothing
        assert_eq!(compute_claimable(&alloc, 50_000), 0);

        // After cliff + 50%: 50%
        let half = VESTING_CLIFF_BLOCKS + 1_000_000;
        assert_eq!(compute_claimable(&alloc, half), 5_000 * PRECISION);

        // Claim
        let (claimed, updated) = claim_vested(&alloc, half).unwrap();
        assert_eq!(claimed, 5_000 * PRECISION);

        // After full vest
        let full = VESTING_CLIFF_BLOCKS + 2_000_000;
        let (claimed2, _) = claim_vested(&updated, full).unwrap();
        assert_eq!(claimed2, 5_000 * PRECISION);
    }

    #[test]
    fn test_daily_limit_then_allocate() {
        let state = default_state();
        // Spend 40K daily
        let updated = update_daily_outflow(&state, 40_000 * PRECISION).unwrap();
        // Only 10K daily remaining — try to allocate 15K
        let result = allocate_funds(
            &updated, 15_000 * PRECISION,
            AllocationPurpose::Marketing,
            default_recipient(),
            1_000_000,
        );
        assert_eq!(result, Err(TreasuryError::ExceedsDailyLimit));

        // Allocate 5K — should succeed
        let alloc = allocate_funds(
            &updated, 5_000 * PRECISION,
            AllocationPurpose::Marketing,
            default_recipient(),
            1_000_000,
        ).unwrap();
        assert_eq!(alloc.amount, 5_000 * PRECISION);
    }

    #[test]
    fn test_emergency_then_stabilize() {
        let state = default_state();
        let em = enter_emergency_mode(&state, 700_000 * PRECISION).unwrap();
        assert!(em.emergency_mode);

        // Stabilization action should still compute (it's read-only)
        let action = compute_stabilization_action(
            800 * PRECISION,
            1000 * PRECISION,
            em.available_balance,
            1_000_000 * PRECISION,
        ).unwrap();
        assert_eq!(action.action_type, StabilizationType::BuySupport);
    }

    #[test]
    fn test_full_lifecycle() {
        // Create
        let state = create_treasury(10_000_000 * PRECISION, 0).unwrap();

        // Allocate
        let alloc = allocate_funds(
            &state, 100_000 * PRECISION,
            AllocationPurpose::LiquidityIncentive,
            [0xBB; 32],
            5_000_000,
        ).unwrap();

        let mut alloc = alloc;
        alloc.vesting_start = 0;

        // Update outflow
        let state = update_daily_outflow(&state, 100_000 * PRECISION).unwrap();
        assert_eq!(state.daily_outflow, 100_000 * PRECISION);

        // Report
        let report = generate_report(&state, &[alloc.clone()], VESTING_CLIFF_BLOCKS, 1000 * PRECISION);
        assert_eq!(report.total_assets, 10_000_000 * PRECISION);
        assert_eq!(report.total_liabilities, 100_000 * PRECISION); // Nothing vested yet at cliff start

        // Vest + claim
        let block = VESTING_CLIFF_BLOCKS + 2_500_000;
        let (claimed, _) = claim_vested(&alloc, block).unwrap();
        assert_eq!(claimed, 50_000 * PRECISION); // 50%
    }

    #[test]
    fn test_reserve_ratio_matches_report() {
        let mut state = default_state();
        state.reserved_balance = 400_000 * PRECISION;
        state.available_balance = 600_000 * PRECISION;

        let ratio = compute_reserve_ratio(&state);
        let report = generate_report(&state, &[], 1000, 0);
        assert_eq!(ratio, report.reserve_ratio_bps);
    }

    #[test]
    fn test_price_impact_consistency() {
        // Stabilization action's impact_estimate should be in the same ballpark
        // as estimate_price_impact
        let current = 800 * PRECISION;
        let target = 1000 * PRECISION;
        let available = 100_000 * PRECISION;
        let pool = 1_000_000 * PRECISION;

        let action = compute_stabilization_action(current, target, available, pool).unwrap();
        let impact = estimate_price_impact(&action, pool, pool).unwrap();

        // Both should be positive and non-zero for a meaningful trade
        assert!(impact > 0);
        assert!(action.impact_estimate > 0);
    }

    // ============ Edge Case Tests ============

    #[test]
    fn test_vesting_cliff_equals_zero() {
        let mut alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        alloc.cliff_blocks = 0;
        // With zero cliff, vesting starts immediately
        let vested = compute_vested_amount(&alloc, 500_000);
        assert_eq!(vested, 500_000 * PRECISION);
    }

    #[test]
    fn test_single_unit_allocation() {
        let mut state = default_state();
        state.daily_outflow_limit = BPS; // Set to allow small amounts
        let alloc = allocate_funds(
            &state, 1,
            AllocationPurpose::SecurityBounty,
            default_recipient(),
            1_000_000,
        ).unwrap();
        assert_eq!(alloc.amount, 1);
    }

    #[test]
    fn test_daily_outflow_overflow_protection() {
        let mut state = default_state();
        state.daily_outflow = u128::MAX - 1;
        state.daily_outflow_limit = u128::MAX;
        // Adding 2 would overflow
        let result = update_daily_outflow(&state, 2);
        assert_eq!(result, Err(TreasuryError::Overflow));
    }

    #[test]
    fn test_stabilization_precision_handling() {
        // Test with very precise values
        let current = PRECISION + 1; // Just above 1.0
        let target = PRECISION;
        let available = 1_000 * PRECISION;
        let pool = 1_000_000 * PRECISION;

        let action = compute_stabilization_action(current, target, available, pool).unwrap();
        // Very tiny deviation — should be LiquidityAdd
        assert_eq!(action.action_type, StabilizationType::LiquidityAdd);
    }

    #[test]
    fn test_report_health_score_range() {
        // Test various states to ensure health_score is always 0-100
        let states = vec![
            default_state(),
            {
                let mut s = default_state();
                s.emergency_mode = true;
                s
            },
            {
                let mut s = default_state();
                s.reserved_balance = s.total_balance;
                s.available_balance = 0;
                s
            },
        ];

        for state in states {
            let report = generate_report(&state, &[], 1000, 100 * PRECISION);
            assert!(report.health_score <= 100, "Health score {} exceeds 100", report.health_score);
        }
    }

    #[test]
    fn test_compute_rebalance_precision() {
        // Very small amounts
        let amount = compute_rebalance(
            60,
            20,
            5000,
            100,
        ).unwrap();
        // target = 100 * 5000 / 10000 = 50
        // excess = 60 - 50 = 10
        // deficit = 50 - 20 = 30
        // transfer = min(10, 30) = 10
        assert_eq!(amount, 10);
    }

    #[test]
    fn test_allocation_recipient_preserved() {
        let state = default_state();
        let recipient = [0x42; 32];
        let alloc = allocate_funds(
            &state, 1_000 * PRECISION,
            AllocationPurpose::CommunityGrant,
            recipient,
            500_000,
        ).unwrap();
        assert_eq!(alloc.recipient, recipient);
    }

    #[test]
    fn test_multiple_claims_sum_to_total() {
        let alloc = make_allocation(1_000_000 * PRECISION, 0, 4_000_000);
        let mut current_alloc = alloc;
        let mut total_claimed: u128 = 0;

        // Claim at 25%, 50%, 75%, 100%
        for i in 1..=4 {
            let block = VESTING_CLIFF_BLOCKS + (i * 1_000_000);
            let (claimed, updated) = claim_vested(&current_alloc, block).unwrap();
            total_claimed += claimed;
            current_alloc = updated;
        }

        assert_eq!(total_claimed, 1_000_000 * PRECISION);
        assert_eq!(current_alloc.amount_claimed, 1_000_000 * PRECISION);
    }

    #[test]
    fn test_emergency_mode_round_trip() {
        let state = default_state();
        assert!(!state.emergency_mode);

        let em = enter_emergency_mode(&state, 700_000 * PRECISION).unwrap();
        assert!(em.emergency_mode);

        let normal = exit_emergency_mode(&em).unwrap();
        assert!(!normal.emergency_mode);
    }

    #[test]
    fn test_report_with_pre_cliff_allocations() {
        let state = default_state();
        let alloc = make_allocation(500_000 * PRECISION, 0, 1_000_000);
        // Query at block 50_000 — before cliff (100_000)
        let report = generate_report(&state, &[alloc], 50_000, 100 * PRECISION);
        // Nothing vested, full 500K is liability
        assert_eq!(report.total_liabilities, 500_000 * PRECISION);
    }

    #[test]
    fn test_stabilization_action_amount_scaling() {
        // 10% deviation
        let action = compute_stabilization_action(
            900 * PRECISION,
            1000 * PRECISION,
            200_000 * PRECISION,
            1_000_000 * PRECISION,
        ).unwrap();
        // max_action = 100K, deviation = 10% = 1000 bps
        // raw = 100K * 1000 / 10000 = 10K
        assert_eq!(action.amount, 10_000 * PRECISION);

        // 50% deviation
        let action2 = compute_stabilization_action(
            500 * PRECISION,
            1000 * PRECISION,
            200_000 * PRECISION,
            1_000_000 * PRECISION,
        ).unwrap();
        // max_action = 100K, deviation = 50% = 5000 bps
        // raw = 100K * 5000 / 10000 = 50K
        assert_eq!(action2.amount, 50_000 * PRECISION);
    }

    #[test]
    fn test_daily_limit_small_treasury() {
        let state = create_treasury(100, 0).unwrap();
        // 5% of 100 = 5
        assert_eq!(state.daily_outflow_limit, 5);
        // 6 should exceed the limit
        let result = update_daily_outflow(&state, 6);
        assert_eq!(result, Err(TreasuryError::ExceedsDailyLimit));
        // 5 should be exactly at limit
        let updated = update_daily_outflow(&state, 5).unwrap();
        assert_eq!(updated.daily_outflow, 5);
    }

    #[test]
    fn test_check_rebalance_single_category() {
        // Only one category — can't have from AND to
        let actual = vec![10_000];
        let target = vec![10_000];
        let result = check_rebalance_needed(&actual, &target);
        assert_eq!(result, Err(TreasuryError::RebalanceNotNeeded));
    }

    #[test]
    fn test_estimate_impact_overflow_safe() {
        // Large amounts that could overflow
        let action = StabilizationAction {
            action_type: StabilizationType::BuySupport,
            amount: u128::MAX / 4,
            target_price: PRECISION,
            current_price: PRECISION,
            impact_estimate: 0,
        };
        // Pool is small relative to action — should not panic
        let result = estimate_price_impact(&action, u128::MAX / 4, u128::MAX / 4);
        // This may overflow in pool_x + amount, which is fine — we handle it
        assert!(result.is_ok() || result == Err(TreasuryError::Overflow));
    }

    #[test]
    fn test_vesting_block_zero_start() {
        let alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        // At block 0
        let vested = compute_vested_amount(&alloc, 0);
        assert_eq!(vested, 0);
    }

    #[test]
    fn test_create_treasury_one_wei() {
        let state = create_treasury(1, 0).unwrap();
        assert_eq!(state.total_balance, 1);
    }

    #[test]
    fn test_allocation_purpose_equality() {
        assert_eq!(AllocationPurpose::Development, AllocationPurpose::Development);
        assert_ne!(AllocationPurpose::Development, AllocationPurpose::Marketing);
        assert_ne!(AllocationPurpose::SecurityBounty, AllocationPurpose::CommunityGrant);
    }

    #[test]
    fn test_treasury_state_clone() {
        let state = default_state();
        let cloned = state.clone();
        assert_eq!(state, cloned);
    }

    #[test]
    fn test_allocation_clone() {
        let alloc = make_allocation(1000, 0, 100);
        let cloned = alloc.clone();
        assert_eq!(alloc, cloned);
    }

    // ============ Hardening Batch v4 ============

    #[test]
    fn test_create_treasury_max_u128_v4() {
        // u128::MAX treasury — daily limit should not overflow via mul_div
        let state = create_treasury(u128::MAX, 0).unwrap();
        assert_eq!(state.total_balance, u128::MAX);
        // daily limit = MAX * 500 / 10000 via mul_div (256-bit safe)
        assert!(state.daily_outflow_limit > 0);
    }

    #[test]
    fn test_allocate_funds_exactly_daily_remaining_v4() {
        // Spend some daily, then allocate exactly the remaining
        let mut state = default_state();
        state.daily_outflow = 40_000 * PRECISION;
        // Remaining daily = 50K - 40K = 10K
        let alloc = allocate_funds(
            &state, 10_000 * PRECISION,
            AllocationPurpose::LiquidityIncentive,
            default_recipient(),
            1_000_000,
        ).unwrap();
        assert_eq!(alloc.amount, 10_000 * PRECISION);
    }

    #[test]
    fn test_allocate_funds_one_over_daily_remaining_v4() {
        let mut state = default_state();
        state.daily_outflow = 40_000 * PRECISION;
        // Remaining = 10K, try 10K + 1 wei
        let result = allocate_funds(
            &state, 10_000 * PRECISION + 1,
            AllocationPurpose::Development,
            default_recipient(),
            1_000_000,
        );
        assert_eq!(result, Err(TreasuryError::ExceedsDailyLimit));
    }

    #[test]
    fn test_vesting_one_block_before_full_v4() {
        let alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        let one_before = VESTING_CLIFF_BLOCKS + 999_999;
        let vested = compute_vested_amount(&alloc, one_before);
        let expected = mul_div(1_000_000 * PRECISION, 999_999, 1_000_000);
        assert_eq!(vested, expected);
        assert!(vested < 1_000_000 * PRECISION);
    }

    #[test]
    fn test_vesting_exactly_at_full_v4() {
        let alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        let vesting_end = VESTING_CLIFF_BLOCKS + 1_000_000;
        let vested = compute_vested_amount(&alloc, vesting_end);
        assert_eq!(vested, 1_000_000 * PRECISION);
    }

    #[test]
    fn test_vesting_u64_max_block_v4() {
        // Current block = u64::MAX, well after full vesting
        let alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        let vested = compute_vested_amount(&alloc, u64::MAX);
        assert_eq!(vested, 1_000_000 * PRECISION);
    }

    #[test]
    fn test_claim_vested_incremental_three_claims_v4() {
        let alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        // Claim at 25%, 50%, 100%
        let (c1, u1) = claim_vested(&alloc, VESTING_CLIFF_BLOCKS + 250_000).unwrap();
        assert_eq!(c1, 250_000 * PRECISION);

        let (c2, u2) = claim_vested(&u1, VESTING_CLIFF_BLOCKS + 500_000).unwrap();
        assert_eq!(c2, 250_000 * PRECISION);

        let (c3, u3) = claim_vested(&u2, VESTING_CLIFF_BLOCKS + 1_000_000).unwrap();
        assert_eq!(c3, 500_000 * PRECISION);
        assert_eq!(u3.amount_claimed, 1_000_000 * PRECISION);
    }

    #[test]
    fn test_update_daily_outflow_overflow_v4() {
        // Overflow in checked_add
        let mut state = default_state();
        state.daily_outflow = u128::MAX;
        state.daily_outflow_limit = u128::MAX;
        let result = update_daily_outflow(&state, 1);
        assert_eq!(result, Err(TreasuryError::Overflow));
    }

    #[test]
    fn test_check_daily_limit_one_remaining_v4() {
        let mut state = default_state();
        state.daily_outflow = state.daily_outflow_limit - 1;
        let remaining = check_daily_limit(&state, 1).unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn test_enter_emergency_total_loss_v4() {
        // Current balance = 0 → 100% drawdown
        let state = default_state();
        let updated = enter_emergency_mode(&state, 0).unwrap();
        assert!(updated.emergency_mode);
        assert_eq!(updated.total_balance, 0);
        assert_eq!(updated.available_balance, 0);
        assert_eq!(updated.daily_outflow_limit, 0);
    }

    #[test]
    fn test_enter_emergency_just_barely_meets_threshold_v4() {
        // Exactly 20% drawdown → threshold = 200_000, drawdown = 200_000 → meets
        let state = default_state();
        let threshold = mul_div(state.total_balance, EMERGENCY_THRESHOLD_BPS as u128, BPS);
        let current = state.total_balance - threshold;
        let updated = enter_emergency_mode(&state, current).unwrap();
        assert!(updated.emergency_mode);
    }

    #[test]
    fn test_enter_emergency_one_below_threshold_v4() {
        // 19.99...% drawdown → just below threshold
        let state = default_state();
        let threshold = mul_div(state.total_balance, EMERGENCY_THRESHOLD_BPS as u128, BPS);
        let current = state.total_balance - threshold + 1; // one unit less drawdown
        let result = enter_emergency_mode(&state, current);
        assert_eq!(result, Err(TreasuryError::EmergencyThresholdNotMet));
    }

    #[test]
    fn test_compute_reserve_ratio_over_100_percent_capped_v4() {
        // reserved > total (shouldn't happen but test the cap)
        let mut state = default_state();
        state.reserved_balance = state.total_balance + 1;
        let ratio = compute_reserve_ratio(&state);
        assert_eq!(ratio, 10_000); // Capped at 100%
    }

    #[test]
    fn test_stabilization_price_50_percent_above_v4() {
        // Price is 50% above target → SellPressure
        let current = 1500 * PRECISION;
        let target = 1000 * PRECISION;
        let available = 100_000 * PRECISION;
        let pool = 1_000_000 * PRECISION;

        let action = compute_stabilization_action(current, target, available, pool).unwrap();
        assert_eq!(action.action_type, StabilizationType::SellPressure);
        assert!(action.amount <= available / 2);
    }

    #[test]
    fn test_stabilization_extreme_deviation_cap_v4() {
        // 200% above target → capped amount at max_action
        let current = 3000 * PRECISION;
        let target = 1000 * PRECISION;
        let available = 100_000 * PRECISION;
        let pool = 1_000_000 * PRECISION;

        let action = compute_stabilization_action(current, target, available, pool).unwrap();
        assert_eq!(action.action_type, StabilizationType::SellPressure);
        // raw_amount = max_action * deviation_bps / BPS
        // deviation = 200% = 20000 bps → raw = 50K * 20000 / 10000 = 100K > 50K cap
        assert_eq!(action.amount, available / 2); // Capped
    }

    #[test]
    fn test_stabilization_1_wei_available_v4() {
        // Very small treasury
        let current = 900 * PRECISION;
        let target = 1000 * PRECISION;
        let available = 1;
        let pool = 1_000_000 * PRECISION;

        let action = compute_stabilization_action(current, target, available, pool).unwrap();
        // max_action = 1/2 = 0, raw_amount = 0, but minimum is 1
        assert_eq!(action.amount, 1);
    }

    #[test]
    fn test_price_impact_equal_pools_v4() {
        // Symmetric pool, trade = 10% of pool
        let action = StabilizationAction {
            action_type: StabilizationType::BuySupport,
            amount: 100_000 * PRECISION,
            target_price: PRECISION,
            current_price: PRECISION,
            impact_estimate: 0,
        };
        let impact = estimate_price_impact(&action, 1_000_000 * PRECISION, 1_000_000 * PRECISION).unwrap();
        // 100K / 1.1M ≈ 9.09%
        assert!(impact > PRECISION / 20); // > 5%
        assert!(impact < PRECISION / 5);  // < 20%
    }

    #[test]
    fn test_report_zero_outflow_infinite_runway_v4() {
        let state = default_state();
        let report = generate_report(&state, &[], 1000, 0);
        assert_eq!(report.runway_blocks, u64::MAX);
    }

    #[test]
    fn test_report_high_utilization_low_health_v4() {
        let mut state = default_state();
        state.reserved_balance = 900_000 * PRECISION; // 90% utilization
        state.available_balance = 100_000 * PRECISION;
        let report = generate_report(&state, &[], 1000, 100 * PRECISION);
        // 90% utilization > 70% → utilization_score = 0
        assert!(report.utilization_bps >= 9000);
    }

    #[test]
    fn test_report_no_allocations_zero_liabilities_v4() {
        let state = default_state();
        let report = generate_report(&state, &[], 1000, 100 * PRECISION);
        assert_eq!(report.total_liabilities, 0);
        assert_eq!(report.net_position, state.total_balance);
    }

    #[test]
    fn test_check_rebalance_single_category_v4() {
        let actual = vec![10_000];
        let target = vec![10_000];
        let result = check_rebalance_needed(&actual, &target);
        assert_eq!(result, Err(TreasuryError::RebalanceNotNeeded));
    }

    #[test]
    fn test_check_rebalance_two_categories_exactly_at_v4() {
        // One category 300 bps over, other 300 bps under → exactly at threshold
        let actual = vec![5300, 4700];
        let target = vec![5000, 5000];
        let (from, to, dev) = check_rebalance_needed(&actual, &target).unwrap();
        assert_eq!(from, 0);
        assert_eq!(to, 1);
        assert_eq!(dev, 300);
    }

    #[test]
    fn test_compute_rebalance_zero_bps_target_v4() {
        // target_ratio = 0 bps → target_balance = 0
        // from_balance must be > 0 → excess = from_balance
        // to_target = 0 → deficit = 0 if to_balance >= 0 → transfer 0 → RebalanceNotNeeded
        let result = compute_rebalance(1000, 0, 0, 10_000);
        assert_eq!(result, Err(TreasuryError::RebalanceNotNeeded));
    }

    #[test]
    fn test_compute_rebalance_100_percent_target_v4() {
        // target_ratio = 10000 bps (100%) → target = total
        // from_balance = 6000, total = 10000, target = 10000 → from < target → NotNeeded
        let result = compute_rebalance(
            6000 * PRECISION, 2000 * PRECISION,
            10_000, 10_000 * PRECISION,
        );
        assert_eq!(result, Err(TreasuryError::RebalanceNotNeeded));
    }

    #[test]
    fn test_allocate_then_report_liabilities_v4() {
        // Allocate, then verify report shows correct liabilities
        let state = default_state();
        let alloc = allocate_funds(
            &state, 20_000 * PRECISION,
            AllocationPurpose::SecurityBounty,
            default_recipient(),
            2_000_000,
        ).unwrap();
        let mut alloc = alloc;
        alloc.vesting_start = 0;

        // At cliff end: 0 vested, all 20K is liability
        let report = generate_report(&state, &[alloc.clone()], VESTING_CLIFF_BLOCKS, 100 * PRECISION);
        assert_eq!(report.total_liabilities, 20_000 * PRECISION);

        // After half vesting: 10K vested, 10K liability
        let report = generate_report(&state, &[alloc], VESTING_CLIFF_BLOCKS + 1_000_000, 100 * PRECISION);
        assert_eq!(report.total_liabilities, 10_000 * PRECISION);
    }

    #[test]
    fn test_exit_emergency_preserves_other_fields_v4() {
        let mut state = default_state();
        state.emergency_mode = true;
        state.reserved_balance = 500_000 * PRECISION;
        state.daily_outflow = 10_000 * PRECISION;
        let updated = exit_emergency_mode(&state).unwrap();
        assert!(!updated.emergency_mode);
        // Other fields preserved
        assert_eq!(updated.reserved_balance, 500_000 * PRECISION);
        assert_eq!(updated.daily_outflow, 10_000 * PRECISION);
    }

    #[test]
    fn test_stabilization_action_impact_with_zero_amount_v4() {
        // LiquidityAdd with deviation=0 gives amount=1
        let action = compute_stabilization_action(
            1000 * PRECISION, 1000 * PRECISION,
            100_000 * PRECISION, 1_000_000 * PRECISION,
        ).unwrap();
        assert_eq!(action.amount, 1);
        assert_eq!(action.action_type, StabilizationType::LiquidityAdd);
    }

    #[test]
    fn test_update_daily_outflow_preserves_state_v4() {
        let state = default_state();
        let updated = update_daily_outflow(&state, 10_000 * PRECISION).unwrap();
        // Everything except daily_outflow should be the same
        assert_eq!(updated.total_balance, state.total_balance);
        assert_eq!(updated.reserved_balance, state.reserved_balance);
        assert_eq!(updated.available_balance, state.available_balance);
        assert_eq!(updated.emergency_mode, state.emergency_mode);
        assert_eq!(updated.daily_outflow_limit, state.daily_outflow_limit);
    }

    // ============ Hardening Round 6 ============

    #[test]
    fn test_create_treasury_available_equals_total_h6() {
        let state = create_treasury(5_000_000 * PRECISION, 0).unwrap();
        assert_eq!(state.available_balance, state.total_balance);
        assert_eq!(state.reserved_balance, 0);
    }

    #[test]
    fn test_create_treasury_daily_limit_is_5_percent_h6() {
        let total = 10_000 * PRECISION;
        let state = create_treasury(total, 0).unwrap();
        let expected = mul_div(total, MAX_DAILY_OUTFLOW_BPS as u128, BPS);
        assert_eq!(state.daily_outflow_limit, expected);
    }

    #[test]
    fn test_allocate_funds_valid_development_h6() {
        let state = default_state();
        let alloc = allocate_funds(&state, 10_000 * PRECISION, AllocationPurpose::Development, default_recipient(), 1_000_000).unwrap();
        assert_eq!(alloc.amount, 10_000 * PRECISION);
        assert_eq!(alloc.purpose, AllocationPurpose::Development);
        assert_eq!(alloc.amount_claimed, 0);
    }

    #[test]
    fn test_allocate_funds_security_bounty_h6() {
        let state = default_state();
        let alloc = allocate_funds(&state, 5_000 * PRECISION, AllocationPurpose::SecurityBounty, default_recipient(), 500_000).unwrap();
        assert_eq!(alloc.purpose, AllocationPurpose::SecurityBounty);
    }

    #[test]
    fn test_allocate_funds_exactly_50_percent_h6() {
        let state = default_state();
        let max = mul_div(state.total_balance, MAX_ALLOCATION_BPS as u128, BPS);
        let result = allocate_funds(&state, max, AllocationPurpose::Development, default_recipient(), 1_000_000);
        // May fail due to daily limit or reserve, but should not fail on allocation size
        if let Err(e) = &result {
            assert_ne!(*e, TreasuryError::AllocationTooLarge);
        }
    }

    #[test]
    fn test_allocate_funds_over_50_percent_fails_h6() {
        let state = default_state();
        let over_max = mul_div(state.total_balance, MAX_ALLOCATION_BPS as u128 + 1, BPS);
        let result = allocate_funds(&state, over_max, AllocationPurpose::Development, default_recipient(), 1_000_000);
        assert_eq!(result, Err(TreasuryError::AllocationTooLarge));
    }

    #[test]
    fn test_vesting_linear_halfway_h6() {
        let alloc = make_allocation(1000 * PRECISION, 0, 200_000);
        let halfway = VESTING_CLIFF_BLOCKS + 100_000;
        let vested = compute_vested_amount(&alloc, halfway);
        assert_eq!(vested, 500 * PRECISION);
    }

    #[test]
    fn test_vesting_one_block_after_cliff_h6() {
        let alloc = make_allocation(1_000_000 * PRECISION, 0, 1_000_000);
        let one_after = VESTING_CLIFF_BLOCKS + 1;
        let vested = compute_vested_amount(&alloc, one_after);
        // 1/1_000_000 of total
        assert_eq!(vested, mul_div(1_000_000 * PRECISION, 1, 1_000_000));
    }

    #[test]
    fn test_claimable_before_cliff_zero_h6() {
        let alloc = make_allocation(1000 * PRECISION, 0, 200_000);
        assert_eq!(compute_claimable(&alloc, 0), 0);
        assert_eq!(compute_claimable(&alloc, VESTING_CLIFF_BLOCKS - 1), 0);
    }

    #[test]
    fn test_claim_vested_partial_then_rest_h6() {
        let alloc = make_allocation(1000 * PRECISION, 0, 200_000);
        let mid = VESTING_CLIFF_BLOCKS + 100_000;
        let (claimed1, updated) = claim_vested(&alloc, mid).unwrap();
        assert_eq!(claimed1, 500 * PRECISION);

        let end = VESTING_CLIFF_BLOCKS + 200_000;
        let (claimed2, final_alloc) = claim_vested(&updated, end).unwrap();
        assert_eq!(claimed2, 500 * PRECISION);
        assert_eq!(final_alloc.amount_claimed, 1000 * PRECISION);
    }

    #[test]
    fn test_claim_vested_nothing_before_cliff_h6() {
        let alloc = make_allocation(1000 * PRECISION, 0, 200_000);
        let result = claim_vested(&alloc, VESTING_CLIFF_BLOCKS - 1);
        assert_eq!(result, Err(TreasuryError::InsufficientFunds));
    }

    #[test]
    fn test_check_daily_limit_exact_remaining_h6() {
        let state = default_state();
        let remaining = check_daily_limit(&state, 1).unwrap();
        assert_eq!(remaining, state.daily_outflow_limit - 1);
    }

    #[test]
    fn test_check_daily_limit_zero_proposed_fails_h6() {
        let state = default_state();
        let result = check_daily_limit(&state, 0);
        assert_eq!(result, Err(TreasuryError::ZeroAmount));
    }

    #[test]
    fn test_update_daily_outflow_increments_h6() {
        let state = default_state();
        let updated = update_daily_outflow(&state, 100).unwrap();
        assert_eq!(updated.daily_outflow, 100);
        let updated2 = update_daily_outflow(&updated, 200).unwrap();
        assert_eq!(updated2.daily_outflow, 300);
    }

    #[test]
    fn test_enter_emergency_exactly_20_percent_loss_h6() {
        let state = default_state();
        // 20% loss = 200_000 * PRECISION
        let current = state.total_balance - mul_div(state.total_balance, EMERGENCY_THRESHOLD_BPS as u128, BPS);
        let result = enter_emergency_mode(&state, current);
        assert!(result.is_ok());
        assert!(result.unwrap().emergency_mode);
    }

    #[test]
    fn test_enter_emergency_19_percent_loss_fails_h6() {
        let state = default_state();
        // 19% loss
        let current = state.total_balance - mul_div(state.total_balance, 1900, BPS);
        let result = enter_emergency_mode(&state, current);
        assert_eq!(result, Err(TreasuryError::EmergencyThresholdNotMet));
    }

    #[test]
    fn test_exit_emergency_when_not_in_emergency_fails_h6() {
        let state = default_state();
        assert_eq!(exit_emergency_mode(&state), Err(TreasuryError::EmergencyThresholdNotMet));
    }

    #[test]
    fn test_exit_emergency_preserves_balances_h6() {
        let state = default_state();
        let current = state.total_balance / 2; // 50% loss
        let emergency = enter_emergency_mode(&state, current).unwrap();
        let exited = exit_emergency_mode(&emergency).unwrap();
        assert!(!exited.emergency_mode);
        assert_eq!(exited.total_balance, emergency.total_balance);
    }

    #[test]
    fn test_reserve_ratio_50_percent_h6() {
        let mut state = default_state();
        state.reserved_balance = state.total_balance / 2;
        let ratio = compute_reserve_ratio(&state);
        assert_eq!(ratio, 5000);
    }

    #[test]
    fn test_stabilization_buy_support_h6() {
        let result = compute_stabilization_action(
            900 * PRECISION,     // current below target
            1000 * PRECISION,    // target
            100_000 * PRECISION, // treasury available
            1_000_000 * PRECISION, // pool reserve
        ).unwrap();
        assert_eq!(result.action_type, StabilizationType::BuySupport);
    }

    #[test]
    fn test_stabilization_sell_pressure_h6() {
        let result = compute_stabilization_action(
            1100 * PRECISION,    // current above target
            1000 * PRECISION,    // target
            100_000 * PRECISION,
            1_000_000 * PRECISION,
        ).unwrap();
        assert_eq!(result.action_type, StabilizationType::SellPressure);
    }

    #[test]
    fn test_stabilization_liquidity_add_when_close_h6() {
        let result = compute_stabilization_action(
            1010 * PRECISION,    // 1% above target, within 3% threshold
            1000 * PRECISION,
            100_000 * PRECISION,
            1_000_000 * PRECISION,
        ).unwrap();
        assert_eq!(result.action_type, StabilizationType::LiquidityAdd);
    }

    #[test]
    fn test_price_impact_small_amount_h6() {
        let action = StabilizationAction {
            action_type: StabilizationType::BuySupport,
            amount: 100 * PRECISION,
            target_price: PRECISION,
            current_price: PRECISION,
            impact_estimate: 0,
        };
        let impact = estimate_price_impact(&action, 1_000_000 * PRECISION, 1_000_000 * PRECISION).unwrap();
        assert!(impact > 0);
        assert!(impact < PRECISION / 100); // Less than 1%
    }

    #[test]
    fn test_price_impact_zero_amount_h6() {
        let action = StabilizationAction {
            action_type: StabilizationType::BuySupport,
            amount: 0,
            target_price: PRECISION,
            current_price: PRECISION,
            impact_estimate: 0,
        };
        let impact = estimate_price_impact(&action, 1_000_000 * PRECISION, 1_000_000 * PRECISION).unwrap();
        assert_eq!(impact, 0);
    }

    #[test]
    fn test_report_healthy_treasury_high_score_h6() {
        let state = default_state();
        let report = generate_report(&state, &[], 100, 0);
        assert!(report.health_score >= 60);
        assert_eq!(report.total_liabilities, 0);
        assert_eq!(report.total_assets, state.total_balance);
    }

    #[test]
    fn test_report_with_allocation_liabilities_h6() {
        let state = default_state();
        let alloc = make_allocation(100_000 * PRECISION, 0, 500_000);
        let report = generate_report(&state, &[alloc], VESTING_CLIFF_BLOCKS + 250_000, 0);
        // 50% vested, so liabilities = 50% of allocation
        assert!(report.total_liabilities > 0);
        assert!(report.total_liabilities < 100_000 * PRECISION);
    }

    #[test]
    fn test_report_runway_infinite_with_zero_outflow_h6() {
        let state = default_state();
        let report = generate_report(&state, &[], 100, 0);
        assert_eq!(report.runway_blocks, u64::MAX);
    }

    // removed: test_check_rebalance_large_deviation_h6 — contradictory assertions (from==0 then from==1)

    #[test]
    fn test_check_rebalance_below_threshold_h6() {
        let actual = vec![3300u16, 3400, 3300];
        let target = vec![3333u16, 3334, 3333];
        let result = check_rebalance_needed(&actual, &target);
        assert_eq!(result, Err(TreasuryError::RebalanceNotNeeded));
    }

    #[test]
    fn test_compute_rebalance_excess_capped_by_deficit_h6() {
        // from has 6000 with target 3000 (excess=3000), to has 1000 with target 3000 (deficit=2000)
        let transfer = compute_rebalance(6000, 1000, 3000, 10000).unwrap();
        assert_eq!(transfer, 2000); // min(excess=3000, deficit=2000)
    }

    #[test]
    fn test_compute_rebalance_from_at_target_fails_h6() {
        let result = compute_rebalance(3000, 1000, 3000, 10000);
        assert_eq!(result, Err(TreasuryError::RebalanceNotNeeded));
    }

    #[test]
    fn test_allocation_purpose_variants_h6() {
        let purposes = vec![
            AllocationPurpose::Development,
            AllocationPurpose::Marketing,
            AllocationPurpose::LiquidityIncentive,
            AllocationPurpose::SecurityBounty,
            AllocationPurpose::CommunityGrant,
            AllocationPurpose::EmergencyReserve,
            AllocationPurpose::Stabilization,
        ];
        for i in 0..purposes.len() {
            for j in (i+1)..purposes.len() {
                assert_ne!(purposes[i], purposes[j]);
            }
        }
    }
}
