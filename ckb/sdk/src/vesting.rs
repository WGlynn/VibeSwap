// ============ Vesting — Token Vesting Schedules for Team, Investors & Ecosystem ============
// Implements structured token distribution for the VibeSwap protocol on CKB:
// cliff-based linear vesting, milestone-based step releases, graded (periodic) schedules,
// revocation with penalty, acceleration, extension, and aggregate reporting.
//
// Key capabilities:
// - Linear vesting with configurable cliff and duration
// - Milestone-based releases at specific block heights with cumulative BPS unlocks
// - Graded (step) vesting: discrete periodic unlocks (monthly, quarterly, etc.)
// - Revocation with 20% early termination penalty returned to protocol
// - Schedule acceleration (up to 50% reduction) and extension
// - Per-schedule status and multi-schedule summary aggregation
// - Next-unlock-block computation for UI countdown timers
//
// Philosophy: Cooperative Capitalism — structured token distribution aligns long-term
// incentives between team, investors, and community. Revocation penalties discourage
// premature exits while protecting protocol treasury.

use vibeswap_math::mul_div;

// ============ Constants ============

/// Basis points denominator
pub const BPS: u128 = 10_000;

/// Maximum number of vesting schedules per beneficiary
pub const MAX_SCHEDULES_PER_BENEFICIARY: usize = 5;

/// Maximum number of milestones in a milestone-based schedule
pub const MAX_MILESTONES: usize = 10;

/// Minimum cliff duration in blocks
pub const MIN_CLIFF_BLOCKS: u64 = 1_000;

/// Maximum vesting duration in blocks (~2.5 years at 4s blocks)
pub const MAX_VESTING_DURATION: u64 = 20_000_000;

/// Minimum vesting amount (1 VIBE, 18 decimals)
pub const MIN_VESTING_AMOUNT: u128 = 1_000_000_000_000_000_000;

/// Early termination penalty in basis points (20%)
pub const EARLY_TERMINATION_PENALTY_BPS: u16 = 2000;

/// Maximum acceleration in basis points (50% reduction)
pub const MAX_ACCELERATION_BPS: u16 = 5000;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum VestingError {
    /// Amount is zero
    ZeroAmount,
    /// Duration is zero
    ZeroDuration,
    /// Amount is below MIN_VESTING_AMOUNT
    BelowMinAmount,
    /// Duration exceeds MAX_VESTING_DURATION
    ExceedsMaxDuration,
    /// Cliff period exceeds total duration
    CliffExceedsDuration,
    /// Cliff is below MIN_CLIFF_BLOCKS
    BelowMinCliff,
    /// Schedule has already been revoked
    AlreadyRevoked,
    /// No tokens available to claim
    NothingToClaim,
    /// Schedule is already fully vested
    FullyVested,
    /// Milestone parameters are invalid
    InvalidMilestone,
    /// Milestone blocks are not in ascending order
    MilestonesNotSorted,
    /// Cumulative milestone BPS exceeds 10000
    MilestonesBpsExceed10000,
    /// Too many milestones (exceeds MAX_MILESTONES)
    TooManyMilestones,
    /// Beneficiary has too many schedules (exceeds MAX_SCHEDULES_PER_BENEFICIARY)
    TooManySchedules,
    /// Schedule not found
    ScheduleNotFound,
    /// Acceleration BPS is invalid (zero or exceeds MAX_ACCELERATION_BPS)
    InvalidAcceleration,
    /// Schedule is not revocable
    NotRevocable,
    /// Arithmetic overflow
    Overflow,
}

// ============ Data Types ============

/// A single vesting schedule for a beneficiary.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VestingSchedule {
    /// Beneficiary address (CKB lock hash)
    pub beneficiary: [u8; 32],
    /// Total amount of tokens in this schedule
    pub total_amount: u128,
    /// Amount already claimed by the beneficiary
    pub claimed_amount: u128,
    /// Block at which vesting begins
    pub start_block: u64,
    /// Cliff period in blocks before any tokens unlock
    pub cliff_blocks: u64,
    /// Total vesting duration in blocks (including cliff)
    pub duration_blocks: u64,
    /// Type of vesting schedule
    pub schedule_type: ScheduleType,
    /// Whether this schedule can be revoked by the grantor
    pub revocable: bool,
    /// Whether this schedule has been revoked
    pub revoked: bool,
    /// Block at which this schedule was revoked (0 if not revoked)
    pub revoked_block: u64,
}

/// Type of vesting schedule determining the unlock curve.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ScheduleType {
    /// Continuous linear vesting after cliff
    Linear,
    /// Step-function releases at specific milestone blocks
    Milestone {
        milestones: [MilestonePoint; 10],
        count: u8,
    },
    /// Linear but in discrete steps (e.g., monthly, quarterly)
    Graded { steps: u16 },
}

/// A single milestone point in a milestone-based schedule.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MilestonePoint {
    /// Block at which this milestone unlocks
    pub block: u64,
    /// Cumulative BPS unlocked at this milestone (out of 10000)
    pub bps: u16,
}

impl Default for MilestonePoint {
    fn default() -> Self {
        Self { block: 0, bps: 0 }
    }
}

/// Full status of a vesting schedule at a specific block.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VestingStatus {
    /// Total tokens in the schedule
    pub total_amount: u128,
    /// Tokens vested so far
    pub vested_amount: u128,
    /// Tokens already claimed
    pub claimed_amount: u128,
    /// Tokens available to claim now (vested - claimed)
    pub claimable_amount: u128,
    /// Tokens not yet vested
    pub remaining_amount: u128,
    /// Percentage vested in basis points
    pub percent_vested_bps: u16,
    /// Whether the schedule is fully vested
    pub is_fully_vested: bool,
    /// Whether the schedule has been revoked
    pub is_revoked: bool,
    /// Next block where new tokens unlock
    pub next_unlock_block: u64,
    /// Blocks until next unlock (0 if fully vested or continuous)
    pub blocks_until_next_unlock: u64,
}

/// Aggregate summary across multiple vesting schedules.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VestingSummary {
    /// Total tokens allocated across all schedules
    pub total_allocated: u128,
    /// Total tokens vested across all schedules
    pub total_vested: u128,
    /// Total tokens claimed across all schedules
    pub total_claimed: u128,
    /// Total tokens not yet vested
    pub total_unvested: u128,
    /// Number of active (not revoked, not fully vested) schedules
    pub active_schedules: u32,
    /// Number of revoked schedules
    pub revoked_schedules: u32,
    /// Number of fully vested schedules
    pub fully_vested_schedules: u32,
}

// ============ Core Functions ============

/// Create a linear vesting schedule with cliff and continuous unlock.
///
/// After the cliff period, tokens vest linearly block-by-block until the full
/// duration is reached.
pub fn create_linear(
    beneficiary: [u8; 32],
    amount: u128,
    start: u64,
    cliff: u64,
    duration: u64,
    revocable: bool,
) -> Result<VestingSchedule, VestingError> {
    validate_common(amount, cliff, duration)?;

    Ok(VestingSchedule {
        beneficiary,
        total_amount: amount,
        claimed_amount: 0,
        start_block: start,
        cliff_blocks: cliff,
        duration_blocks: duration,
        schedule_type: ScheduleType::Linear,
        revocable,
        revoked: false,
        revoked_block: 0,
    })
}

/// Create a milestone-based vesting schedule.
///
/// Tokens unlock in discrete steps at specific block heights. Each milestone
/// specifies a cumulative BPS of the total allocation that is unlocked.
/// Milestones must be sorted by block height and the final BPS must not exceed 10000.
pub fn create_milestone(
    beneficiary: [u8; 32],
    amount: u128,
    start: u64,
    milestones: &[(u64, u16)],
    revocable: bool,
) -> Result<VestingSchedule, VestingError> {
    if amount == 0 {
        return Err(VestingError::ZeroAmount);
    }
    if amount < MIN_VESTING_AMOUNT {
        return Err(VestingError::BelowMinAmount);
    }
    if milestones.is_empty() {
        return Err(VestingError::InvalidMilestone);
    }
    if milestones.len() > MAX_MILESTONES {
        return Err(VestingError::TooManyMilestones);
    }

    // Validate sorted and BPS
    let mut prev_block: u64 = 0;
    for (i, &(block, bps)) in milestones.iter().enumerate() {
        if block == 0 {
            return Err(VestingError::InvalidMilestone);
        }
        if i > 0 && block <= prev_block {
            return Err(VestingError::MilestonesNotSorted);
        }
        if bps == 0 || bps > 10_000 {
            return Err(VestingError::InvalidMilestone);
        }
        // Check cumulative ordering (each milestone must have higher BPS than previous)
        if i > 0 && bps <= milestones[i - 1].1 {
            return Err(VestingError::MilestonesNotSorted);
        }
        prev_block = block;
    }

    // Check last milestone BPS doesn't exceed 10000
    if milestones.last().map_or(false, |&(_, bps)| bps > 10_000) {
        return Err(VestingError::MilestonesBpsExceed10000);
    }

    // Compute duration as last milestone block relative to start
    let last_block = milestones.last().unwrap().0;
    let duration = if last_block > start {
        last_block - start
    } else {
        // Milestones are absolute blocks; if all before start, duration is 0-ish
        // but we still need a non-zero duration
        return Err(VestingError::InvalidMilestone);
    };
    if duration > MAX_VESTING_DURATION {
        return Err(VestingError::ExceedsMaxDuration);
    }

    let mut milestone_array = [MilestonePoint::default(); 10];
    for (i, &(block, bps)) in milestones.iter().enumerate() {
        milestone_array[i] = MilestonePoint { block, bps };
    }

    Ok(VestingSchedule {
        beneficiary,
        total_amount: amount,
        claimed_amount: 0,
        start_block: start,
        cliff_blocks: 0, // Milestones don't use cliff — first milestone acts as cliff
        duration_blocks: duration,
        schedule_type: ScheduleType::Milestone {
            milestones: milestone_array,
            count: milestones.len() as u8,
        },
        revocable,
        revoked: false,
        revoked_block: 0,
    })
}

/// Create a graded (step) vesting schedule.
///
/// Similar to linear but tokens unlock in discrete periodic steps rather than
/// continuously. For example, with 12 steps over 12 months, tokens unlock
/// monthly in equal portions after the cliff.
pub fn create_graded(
    beneficiary: [u8; 32],
    amount: u128,
    start: u64,
    cliff: u64,
    duration: u64,
    steps: u16,
    revocable: bool,
) -> Result<VestingSchedule, VestingError> {
    validate_common(amount, cliff, duration)?;
    if steps == 0 {
        return Err(VestingError::ZeroDuration);
    }

    Ok(VestingSchedule {
        beneficiary,
        total_amount: amount,
        claimed_amount: 0,
        start_block: start,
        cliff_blocks: cliff,
        duration_blocks: duration,
        schedule_type: ScheduleType::Graded { steps },
        revocable,
        revoked: false,
        revoked_block: 0,
    })
}

/// Compute the total vested amount at a given block.
///
/// For revoked schedules, vesting stops at the revocation block.
/// Returns the raw vested amount (not accounting for claims).
pub fn compute_vested(schedule: &VestingSchedule, current_block: u64) -> u128 {
    let effective_block = if schedule.revoked && current_block > schedule.revoked_block {
        schedule.revoked_block
    } else {
        current_block
    };

    // Before start: nothing vested
    if effective_block < schedule.start_block {
        return 0;
    }

    let elapsed = effective_block - schedule.start_block;

    match &schedule.schedule_type {
        ScheduleType::Linear => {
            compute_vested_linear(schedule.total_amount, elapsed, schedule.cliff_blocks, schedule.duration_blocks)
        }
        ScheduleType::Milestone { milestones, count } => {
            compute_vested_milestone(schedule.total_amount, effective_block, milestones, *count)
        }
        ScheduleType::Graded { steps } => {
            compute_vested_graded(
                schedule.total_amount,
                elapsed,
                schedule.cliff_blocks,
                schedule.duration_blocks,
                *steps,
            )
        }
    }
}

/// Compute claimable amount (vested minus already claimed).
pub fn compute_claimable(schedule: &VestingSchedule, current_block: u64) -> u128 {
    let vested = compute_vested(schedule, current_block);
    vested.saturating_sub(schedule.claimed_amount)
}

/// Claim available vested tokens.
///
/// Returns (claimed_amount, updated_schedule) on success.
/// Fails if nothing is available to claim.
pub fn claim(
    schedule: &VestingSchedule,
    current_block: u64,
) -> Result<(u128, VestingSchedule), VestingError> {
    let claimable = compute_claimable(schedule, current_block);
    if claimable == 0 {
        return Err(VestingError::NothingToClaim);
    }

    let mut updated = schedule.clone();
    updated.claimed_amount = schedule
        .claimed_amount
        .checked_add(claimable)
        .ok_or(VestingError::Overflow)?;

    Ok((claimable, updated))
}

/// Revoke a vesting schedule.
///
/// Returns (beneficiary_gets, returned_to_grantor, updated_schedule).
/// The beneficiary keeps all already-vested tokens. The grantor receives the
/// unvested portion minus the EARLY_TERMINATION_PENALTY_BPS penalty (which is
/// effectively burned or sent to treasury).
pub fn revoke(
    schedule: &VestingSchedule,
    current_block: u64,
) -> Result<(u128, u128, VestingSchedule), VestingError> {
    if !schedule.revocable {
        return Err(VestingError::NotRevocable);
    }
    if schedule.revoked {
        return Err(VestingError::AlreadyRevoked);
    }

    let vested = compute_vested(schedule, current_block);
    let unvested = schedule.total_amount.saturating_sub(vested);

    // Penalty on the unvested portion
    let penalty = mul_div(unvested, EARLY_TERMINATION_PENALTY_BPS as u128, BPS);
    let returned_to_grantor = unvested.saturating_sub(penalty);
    let beneficiary_gets = vested;

    let mut updated = schedule.clone();
    updated.revoked = true;
    updated.revoked_block = current_block;

    Ok((beneficiary_gets, returned_to_grantor, updated))
}

/// Get full status of a vesting schedule at a specific block.
pub fn get_status(schedule: &VestingSchedule, current_block: u64) -> VestingStatus {
    let vested = compute_vested(schedule, current_block);
    let claimable = vested.saturating_sub(schedule.claimed_amount);
    let remaining = schedule.total_amount.saturating_sub(vested);
    let is_fully = vested >= schedule.total_amount;
    let percent_bps = if schedule.total_amount == 0 {
        0u16
    } else {
        mul_div(vested, BPS, schedule.total_amount) as u16
    };
    let next_block = next_unlock_block(schedule, current_block);
    let blocks_until = if next_block > current_block {
        next_block - current_block
    } else {
        0
    };

    VestingStatus {
        total_amount: schedule.total_amount,
        vested_amount: vested,
        claimed_amount: schedule.claimed_amount,
        claimable_amount: claimable,
        remaining_amount: remaining,
        percent_vested_bps: percent_bps,
        is_fully_vested: is_fully,
        is_revoked: schedule.revoked,
        next_unlock_block: next_block,
        blocks_until_next_unlock: blocks_until,
    }
}

/// Accelerate a vesting schedule by reducing its duration.
///
/// The acceleration_bps parameter specifies the percentage reduction (e.g., 2500 = 25%
/// shorter duration). Capped at MAX_ACCELERATION_BPS (50%).
pub fn accelerate(
    schedule: &VestingSchedule,
    acceleration_bps: u16,
) -> Result<VestingSchedule, VestingError> {
    if acceleration_bps == 0 || acceleration_bps > MAX_ACCELERATION_BPS {
        return Err(VestingError::InvalidAcceleration);
    }
    if schedule.revoked {
        return Err(VestingError::AlreadyRevoked);
    }

    let reduction = mul_div(
        schedule.duration_blocks as u128,
        acceleration_bps as u128,
        BPS,
    );
    let new_duration = (schedule.duration_blocks as u128)
        .saturating_sub(reduction);

    // Ensure new duration is at least the cliff
    let new_duration = if new_duration < schedule.cliff_blocks as u128 {
        schedule.cliff_blocks as u128
    } else {
        new_duration
    };

    let mut updated = schedule.clone();
    updated.duration_blocks = new_duration as u64;

    // For milestone schedules, accelerate milestone blocks proportionally
    if let ScheduleType::Milestone { ref milestones, count } = schedule.schedule_type {
        let mut new_milestones = [MilestonePoint::default(); 10];
        for i in 0..count as usize {
            let original_offset = if milestones[i].block > schedule.start_block {
                milestones[i].block - schedule.start_block
            } else {
                0
            };
            let new_offset = mul_div(
                original_offset as u128,
                BPS - acceleration_bps as u128,
                BPS,
            );
            new_milestones[i] = MilestonePoint {
                block: schedule.start_block + new_offset as u64,
                bps: milestones[i].bps,
            };
        }
        updated.schedule_type = ScheduleType::Milestone {
            milestones: new_milestones,
            count,
        };
    }

    Ok(updated)
}

/// Extend a vesting schedule's duration.
///
/// Adds additional blocks to the total duration. Fails if the result would
/// exceed MAX_VESTING_DURATION or overflow.
pub fn extend(
    schedule: &VestingSchedule,
    additional_blocks: u64,
) -> Result<VestingSchedule, VestingError> {
    if schedule.revoked {
        return Err(VestingError::AlreadyRevoked);
    }
    if additional_blocks == 0 {
        return Err(VestingError::ZeroDuration);
    }

    let new_duration = schedule
        .duration_blocks
        .checked_add(additional_blocks)
        .ok_or(VestingError::Overflow)?;
    if new_duration > MAX_VESTING_DURATION {
        return Err(VestingError::ExceedsMaxDuration);
    }

    let mut updated = schedule.clone();
    updated.duration_blocks = new_duration;

    Ok(updated)
}

/// Aggregate statistics across multiple vesting schedules.
pub fn summarize(schedules: &[VestingSchedule], current_block: u64) -> VestingSummary {
    let mut total_allocated: u128 = 0;
    let mut total_vested: u128 = 0;
    let mut total_claimed: u128 = 0;
    let mut active: u32 = 0;
    let mut revoked: u32 = 0;
    let mut fully_vested: u32 = 0;

    for s in schedules {
        total_allocated = total_allocated.saturating_add(s.total_amount);
        let v = compute_vested(s, current_block);
        total_vested = total_vested.saturating_add(v);
        total_claimed = total_claimed.saturating_add(s.claimed_amount);

        if s.revoked {
            revoked += 1;
        } else if v >= s.total_amount {
            fully_vested += 1;
        } else {
            active += 1;
        }
    }

    VestingSummary {
        total_allocated,
        total_vested,
        total_claimed,
        total_unvested: total_allocated.saturating_sub(total_vested),
        active_schedules: active,
        revoked_schedules: revoked,
        fully_vested_schedules: fully_vested,
    }
}

/// Compute the next block at which new tokens will unlock.
///
/// For linear schedules: current_block + 1 (continuous vesting).
/// For milestone schedules: the next milestone block after current.
/// For graded schedules: the next step boundary.
/// Returns current_block if fully vested or revoked.
pub fn next_unlock_block(schedule: &VestingSchedule, current_block: u64) -> u64 {
    if schedule.revoked {
        return current_block;
    }

    let end_block = schedule.start_block.saturating_add(schedule.duration_blocks);

    // If fully vested, no more unlocks
    if current_block >= end_block {
        return current_block;
    }

    // If before start, next unlock is at start + cliff (or first milestone)
    match &schedule.schedule_type {
        ScheduleType::Linear => {
            let cliff_end = schedule.start_block.saturating_add(schedule.cliff_blocks);
            if current_block < cliff_end {
                cliff_end
            } else {
                // Linear vests every block
                current_block + 1
            }
        }
        ScheduleType::Milestone { milestones, count } => {
            // Find the next milestone block after current_block
            for i in 0..*count as usize {
                if milestones[i].block > current_block {
                    return milestones[i].block;
                }
            }
            // All milestones passed
            current_block
        }
        ScheduleType::Graded { steps } => {
            let cliff_end = schedule.start_block.saturating_add(schedule.cliff_blocks);
            if current_block < cliff_end {
                return cliff_end;
            }
            // Compute step size in blocks
            let vesting_after_cliff = schedule.duration_blocks.saturating_sub(schedule.cliff_blocks);
            if *steps == 0 || vesting_after_cliff == 0 {
                return current_block;
            }
            let step_size = vesting_after_cliff / *steps as u64;
            if step_size == 0 {
                return current_block;
            }
            let elapsed_after_cliff = current_block.saturating_sub(cliff_end);
            let steps_completed = elapsed_after_cliff / step_size;
            let next_step = steps_completed + 1;
            if next_step >= *steps as u64 {
                end_block
            } else {
                cliff_end + next_step * step_size
            }
        }
    }
}

/// Compute remaining blocks until the schedule is fully vested.
///
/// Returns 0 if already fully vested or revoked.
pub fn remaining_duration(schedule: &VestingSchedule, current_block: u64) -> u64 {
    if schedule.revoked {
        return 0;
    }
    let end_block = schedule.start_block.saturating_add(schedule.duration_blocks);
    if current_block >= end_block {
        0
    } else {
        end_block - current_block
    }
}

// ============ Internal Helpers ============

/// Validate common parameters for linear and graded schedules.
fn validate_common(amount: u128, cliff: u64, duration: u64) -> Result<(), VestingError> {
    if amount == 0 {
        return Err(VestingError::ZeroAmount);
    }
    if amount < MIN_VESTING_AMOUNT {
        return Err(VestingError::BelowMinAmount);
    }
    if duration == 0 {
        return Err(VestingError::ZeroDuration);
    }
    if duration > MAX_VESTING_DURATION {
        return Err(VestingError::ExceedsMaxDuration);
    }
    if cliff > duration {
        return Err(VestingError::CliffExceedsDuration);
    }
    if cliff > 0 && cliff < MIN_CLIFF_BLOCKS {
        return Err(VestingError::BelowMinCliff);
    }
    Ok(())
}

/// Compute vested amount for linear schedule.
fn compute_vested_linear(total: u128, elapsed: u64, cliff: u64, duration: u64) -> u128 {
    if elapsed < cliff {
        return 0;
    }
    if elapsed >= duration {
        return total;
    }
    mul_div(total, elapsed as u128, duration as u128)
}

/// Compute vested amount for milestone schedule.
fn compute_vested_milestone(
    total: u128,
    current_block: u64,
    milestones: &[MilestonePoint; 10],
    count: u8,
) -> u128 {
    let mut cumulative_bps: u16 = 0;

    for i in 0..count as usize {
        if current_block >= milestones[i].block {
            cumulative_bps = milestones[i].bps;
        } else {
            break;
        }
    }

    mul_div(total, cumulative_bps as u128, BPS)
}

/// Compute vested amount for graded (step) schedule.
fn compute_vested_graded(
    total: u128,
    elapsed: u64,
    cliff: u64,
    duration: u64,
    steps: u16,
) -> u128 {
    if elapsed < cliff {
        return 0;
    }
    if elapsed >= duration {
        return total;
    }

    let vesting_after_cliff = duration - cliff;
    if vesting_after_cliff == 0 || steps == 0 {
        return total;
    }

    let elapsed_after_cliff = elapsed - cliff;
    let step_size = vesting_after_cliff / steps as u64;
    if step_size == 0 {
        return total;
    }

    let steps_completed = elapsed_after_cliff / step_size;
    let effective_steps = steps_completed.min(steps as u64);

    mul_div(total, effective_steps as u128, steps as u128)
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Test helpers ----

    fn beneficiary_a() -> [u8; 32] {
        [0xAA; 32]
    }

    fn beneficiary_b() -> [u8; 32] {
        [0xBB; 32]
    }

    const ONE_VIBE: u128 = MIN_VESTING_AMOUNT; // 1e18
    const TEN_VIBE: u128 = 10 * ONE_VIBE;
    const HUNDRED_VIBE: u128 = 100 * ONE_VIBE;
    const THOUSAND_VIBE: u128 = 1000 * ONE_VIBE;

    // ============ Linear Creation Tests ============

    #[test]
    fn linear_create_basic() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 100, 5_000, 1_000_000, true).unwrap();
        assert_eq!(s.total_amount, THOUSAND_VIBE);
        assert_eq!(s.claimed_amount, 0);
        assert_eq!(s.start_block, 100);
        assert_eq!(s.cliff_blocks, 5_000);
        assert_eq!(s.duration_blocks, 1_000_000);
        assert!(s.revocable);
        assert!(!s.revoked);
        assert_eq!(s.revoked_block, 0);
        assert_eq!(s.schedule_type, ScheduleType::Linear);
    }

    #[test]
    fn linear_create_not_revocable() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 2_000, 500_000, false).unwrap();
        assert!(!s.revocable);
    }

    #[test]
    fn linear_create_zero_cliff() {
        // Zero cliff is allowed (no cliff)
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 500_000, true).unwrap();
        assert_eq!(s.cliff_blocks, 0);
    }

    #[test]
    fn linear_create_min_cliff() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, MIN_CLIFF_BLOCKS, 500_000, true).unwrap();
        assert_eq!(s.cliff_blocks, MIN_CLIFF_BLOCKS);
    }

    #[test]
    fn linear_create_max_duration() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, MAX_VESTING_DURATION, true).unwrap();
        assert_eq!(s.duration_blocks, MAX_VESTING_DURATION);
    }

    // ============ Linear Creation Validation Tests ============

    #[test]
    fn linear_create_zero_amount() {
        let err = create_linear(beneficiary_a(), 0, 0, 5_000, 1_000_000, true).unwrap_err();
        assert_eq!(err, VestingError::ZeroAmount);
    }

    #[test]
    fn linear_create_below_min_amount() {
        let err = create_linear(beneficiary_a(), MIN_VESTING_AMOUNT - 1, 0, 5_000, 1_000_000, true).unwrap_err();
        assert_eq!(err, VestingError::BelowMinAmount);
    }

    #[test]
    fn linear_create_zero_duration() {
        let err = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 0, true).unwrap_err();
        assert_eq!(err, VestingError::ZeroDuration);
    }

    #[test]
    fn linear_create_exceeds_max_duration() {
        let err = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, MAX_VESTING_DURATION + 1, true).unwrap_err();
        assert_eq!(err, VestingError::ExceedsMaxDuration);
    }

    #[test]
    fn linear_create_cliff_exceeds_duration() {
        let err = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 100_000, 50_000, true).unwrap_err();
        assert_eq!(err, VestingError::CliffExceedsDuration);
    }

    #[test]
    fn linear_create_below_min_cliff() {
        let err = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 500, 1_000_000, true).unwrap_err();
        assert_eq!(err, VestingError::BelowMinCliff);
    }

    #[test]
    fn linear_create_cliff_equals_duration() {
        // Cliff == duration is valid (everything unlocks at cliff end)
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 1_000_000, 1_000_000, true).unwrap();
        assert_eq!(s.cliff_blocks, 1_000_000);
    }

    #[test]
    fn linear_create_exact_min_amount() {
        let s = create_linear(beneficiary_a(), MIN_VESTING_AMOUNT, 0, 2_000, 500_000, true).unwrap();
        assert_eq!(s.total_amount, MIN_VESTING_AMOUNT);
    }

    // ============ Linear Vesting Computation Tests ============

    #[test]
    fn linear_vested_before_start() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 1000, 5_000, 100_000, true).unwrap();
        assert_eq!(compute_vested(&s, 0), 0);
        assert_eq!(compute_vested(&s, 999), 0);
    }

    #[test]
    fn linear_vested_at_start() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 1000, 5_000, 100_000, true).unwrap();
        assert_eq!(compute_vested(&s, 1000), 0);
    }

    #[test]
    fn linear_vested_during_cliff() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 1000, 5_000, 100_000, true).unwrap();
        assert_eq!(compute_vested(&s, 2000), 0);
        assert_eq!(compute_vested(&s, 5999), 0);
    }

    #[test]
    fn linear_vested_at_cliff_end() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 1000, 5_000, 100_000, true).unwrap();
        // Cliff ends at block 6000 (start 1000 + cliff 5000)
        // elapsed = 5000, duration = 100000
        // vested = 1000 * 5000 / 100000 = 50 VIBE
        let vested = compute_vested(&s, 6000);
        assert_eq!(vested, mul_div(THOUSAND_VIBE, 5_000, 100_000));
    }

    #[test]
    fn linear_vested_halfway() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let vested = compute_vested(&s, 50_000);
        assert_eq!(vested, THOUSAND_VIBE / 2);
    }

    #[test]
    fn linear_vested_at_end() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let vested = compute_vested(&s, 100_000);
        assert_eq!(vested, THOUSAND_VIBE);
    }

    #[test]
    fn linear_vested_after_end() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let vested = compute_vested(&s, 200_000);
        assert_eq!(vested, THOUSAND_VIBE);
    }

    #[test]
    fn linear_vested_no_cliff() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        // At block 1, should have 1/100000 of total
        let vested = compute_vested(&s, 1);
        assert_eq!(vested, mul_div(THOUSAND_VIBE, 1, 100_000));
    }

    #[test]
    fn linear_vested_quarter() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let vested = compute_vested(&s, 25_000);
        assert_eq!(vested, THOUSAND_VIBE / 4);
    }

    #[test]
    fn linear_vested_three_quarters() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let vested = compute_vested(&s, 75_000);
        assert_eq!(vested, mul_div(THOUSAND_VIBE, 75_000, 100_000));
    }

    // ============ Milestone Creation Tests ============

    #[test]
    fn milestone_create_basic() {
        let milestones = vec![(10_000u64, 2500u16), (20_000, 5000), (30_000, 7500), (40_000, 10000)];
        let s = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap();
        assert_eq!(s.total_amount, THOUSAND_VIBE);
        assert_eq!(s.duration_blocks, 40_000);
        if let ScheduleType::Milestone { count, .. } = s.schedule_type {
            assert_eq!(count, 4);
        } else {
            panic!("Expected Milestone schedule type");
        }
    }

    #[test]
    fn milestone_create_single() {
        let milestones = vec![(50_000u64, 10000u16)];
        let s = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, false).unwrap();
        assert!(!s.revocable);
    }

    #[test]
    fn milestone_create_max_milestones() {
        let milestones: Vec<(u64, u16)> = (1..=10).map(|i| (i as u64 * 10_000, i as u16 * 1000)).collect();
        let s = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap();
        if let ScheduleType::Milestone { count, .. } = s.schedule_type {
            assert_eq!(count, 10);
        }
    }

    // ============ Milestone Creation Validation Tests ============

    #[test]
    fn milestone_create_empty() {
        let err = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &[], true).unwrap_err();
        assert_eq!(err, VestingError::InvalidMilestone);
    }

    #[test]
    fn milestone_create_too_many() {
        let milestones: Vec<(u64, u16)> = (1..=11).map(|i| (i as u64 * 10_000, i as u16 * 100)).collect();
        let err = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap_err();
        assert_eq!(err, VestingError::TooManyMilestones);
    }

    #[test]
    fn milestone_create_unsorted() {
        let milestones = vec![(20_000u64, 5000u16), (10_000, 2500)];
        let err = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap_err();
        assert_eq!(err, VestingError::MilestonesNotSorted);
    }

    #[test]
    fn milestone_create_duplicate_blocks() {
        let milestones = vec![(10_000u64, 2500u16), (10_000, 5000)];
        let err = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap_err();
        assert_eq!(err, VestingError::MilestonesNotSorted);
    }

    #[test]
    fn milestone_create_zero_block() {
        let milestones = vec![(0u64, 5000u16)];
        let err = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap_err();
        assert_eq!(err, VestingError::InvalidMilestone);
    }

    #[test]
    fn milestone_create_zero_bps() {
        let milestones = vec![(10_000u64, 0u16)];
        let err = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap_err();
        assert_eq!(err, VestingError::InvalidMilestone);
    }

    #[test]
    fn milestone_create_non_increasing_bps() {
        let milestones = vec![(10_000u64, 5000u16), (20_000, 5000)];
        let err = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap_err();
        assert_eq!(err, VestingError::MilestonesNotSorted);
    }

    #[test]
    fn milestone_create_decreasing_bps() {
        let milestones = vec![(10_000u64, 5000u16), (20_000, 3000)];
        let err = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap_err();
        assert_eq!(err, VestingError::MilestonesNotSorted);
    }

    #[test]
    fn milestone_create_zero_amount() {
        let milestones = vec![(10_000u64, 5000u16)];
        let err = create_milestone(beneficiary_a(), 0, 0, &milestones, true).unwrap_err();
        assert_eq!(err, VestingError::ZeroAmount);
    }

    #[test]
    fn milestone_create_below_min_amount() {
        let milestones = vec![(10_000u64, 5000u16)];
        let err = create_milestone(beneficiary_a(), MIN_VESTING_AMOUNT - 1, 0, &milestones, true).unwrap_err();
        assert_eq!(err, VestingError::BelowMinAmount);
    }

    #[test]
    fn milestone_create_all_before_start() {
        // If start is after the last milestone block, should fail
        let milestones = vec![(100u64, 10000u16)];
        let err = create_milestone(beneficiary_a(), THOUSAND_VIBE, 500, &milestones, true).unwrap_err();
        assert_eq!(err, VestingError::InvalidMilestone);
    }

    // ============ Milestone Vesting Computation Tests ============

    #[test]
    fn milestone_vested_before_first() {
        let milestones = vec![(10_000u64, 2500u16), (20_000, 5000), (30_000, 10000)];
        let s = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap();
        assert_eq!(compute_vested(&s, 0), 0);
        assert_eq!(compute_vested(&s, 9_999), 0);
    }

    #[test]
    fn milestone_vested_at_first() {
        let milestones = vec![(10_000u64, 2500u16), (20_000, 5000), (30_000, 10000)];
        let s = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap();
        let vested = compute_vested(&s, 10_000);
        assert_eq!(vested, THOUSAND_VIBE / 4); // 25%
    }

    #[test]
    fn milestone_vested_between_first_and_second() {
        let milestones = vec![(10_000u64, 2500u16), (20_000, 5000), (30_000, 10000)];
        let s = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap();
        // Between milestones: still at first milestone's BPS
        let vested = compute_vested(&s, 15_000);
        assert_eq!(vested, THOUSAND_VIBE / 4);
    }

    #[test]
    fn milestone_vested_at_second() {
        let milestones = vec![(10_000u64, 2500u16), (20_000, 5000), (30_000, 10000)];
        let s = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap();
        let vested = compute_vested(&s, 20_000);
        assert_eq!(vested, THOUSAND_VIBE / 2); // 50%
    }

    #[test]
    fn milestone_vested_at_last() {
        let milestones = vec![(10_000u64, 2500u16), (20_000, 5000), (30_000, 10000)];
        let s = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap();
        let vested = compute_vested(&s, 30_000);
        assert_eq!(vested, THOUSAND_VIBE); // 100%
    }

    #[test]
    fn milestone_vested_after_last() {
        let milestones = vec![(10_000u64, 2500u16), (20_000, 5000), (30_000, 10000)];
        let s = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap();
        let vested = compute_vested(&s, 100_000);
        assert_eq!(vested, THOUSAND_VIBE);
    }

    #[test]
    fn milestone_vested_exact_boundaries() {
        let milestones = vec![(1_000u64, 1000u16), (2_000, 5000), (3_000, 10000)];
        let s = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap();
        // Block 999: nothing
        assert_eq!(compute_vested(&s, 999), 0);
        // Block 1000: 10%
        assert_eq!(compute_vested(&s, 1_000), THOUSAND_VIBE / 10);
        // Block 1001: still 10%
        assert_eq!(compute_vested(&s, 1_001), THOUSAND_VIBE / 10);
        // Block 1999: still 10%
        assert_eq!(compute_vested(&s, 1_999), THOUSAND_VIBE / 10);
        // Block 2000: 50%
        assert_eq!(compute_vested(&s, 2_000), THOUSAND_VIBE / 2);
        // Block 2999: 50%
        assert_eq!(compute_vested(&s, 2_999), THOUSAND_VIBE / 2);
        // Block 3000: 100%
        assert_eq!(compute_vested(&s, 3_000), THOUSAND_VIBE);
    }

    #[test]
    fn milestone_vested_with_start_offset() {
        let milestones = vec![(10_100u64, 5000u16), (10_200, 10000)];
        let s = create_milestone(beneficiary_a(), THOUSAND_VIBE, 10_000, &milestones, true).unwrap();
        assert_eq!(compute_vested(&s, 10_000), 0);
        assert_eq!(compute_vested(&s, 10_099), 0);
        assert_eq!(compute_vested(&s, 10_100), THOUSAND_VIBE / 2);
        assert_eq!(compute_vested(&s, 10_200), THOUSAND_VIBE);
    }

    // ============ Graded Creation Tests ============

    #[test]
    fn graded_create_basic() {
        let s = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 500_000, 12, true).unwrap();
        assert_eq!(s.total_amount, THOUSAND_VIBE);
        assert_eq!(s.duration_blocks, 500_000);
        if let ScheduleType::Graded { steps } = s.schedule_type {
            assert_eq!(steps, 12);
        } else {
            panic!("Expected Graded schedule type");
        }
    }

    #[test]
    fn graded_create_single_step() {
        let s = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 2_000, 100_000, 1, false).unwrap();
        if let ScheduleType::Graded { steps } = s.schedule_type {
            assert_eq!(steps, 1);
        }
    }

    #[test]
    fn graded_create_zero_steps() {
        let err = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 2_000, 100_000, 0, true).unwrap_err();
        assert_eq!(err, VestingError::ZeroDuration);
    }

    // ============ Graded Vesting Computation Tests ============

    #[test]
    fn graded_vested_before_cliff() {
        let s = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 10_000, 100_000, 10, true).unwrap();
        assert_eq!(compute_vested(&s, 0), 0);
        assert_eq!(compute_vested(&s, 9_999), 0);
    }

    #[test]
    fn graded_vested_at_cliff() {
        let s = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 10_000, 100_000, 10, true).unwrap();
        // At cliff: 0 complete steps after cliff
        let vested = compute_vested(&s, 10_000);
        assert_eq!(vested, 0);
    }

    #[test]
    fn graded_vested_at_first_step() {
        // 10 steps over 90000 blocks (after 10000 cliff), step_size = 9000
        let s = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 10_000, 100_000, 10, true).unwrap();
        // First step completes at block 10000 + 9000 = 19000
        let vested = compute_vested(&s, 19_000);
        assert_eq!(vested, THOUSAND_VIBE / 10);
    }

    #[test]
    fn graded_vested_between_steps() {
        let s = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 10_000, 100_000, 10, true).unwrap();
        // Between step 1 (19000) and step 2 (28000) — still at step 1 value
        let vested = compute_vested(&s, 20_000);
        assert_eq!(vested, THOUSAND_VIBE / 10);
    }

    #[test]
    fn graded_vested_at_full() {
        let s = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, 10, true).unwrap();
        assert_eq!(compute_vested(&s, 100_000), THOUSAND_VIBE);
    }

    #[test]
    fn graded_vested_after_full() {
        let s = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, 10, true).unwrap();
        assert_eq!(compute_vested(&s, 200_000), THOUSAND_VIBE);
    }

    #[test]
    fn graded_vested_no_cliff_steps() {
        // 4 steps over 100000 blocks, no cliff. step_size = 25000
        let s = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, 4, true).unwrap();
        assert_eq!(compute_vested(&s, 0), 0);
        // After 1 step (25000 blocks)
        assert_eq!(compute_vested(&s, 25_000), THOUSAND_VIBE / 4);
        // After 2 steps (50000 blocks)
        assert_eq!(compute_vested(&s, 50_000), THOUSAND_VIBE / 2);
        // After 3 steps (75000 blocks)
        assert_eq!(compute_vested(&s, 75_000), mul_div(THOUSAND_VIBE, 3, 4));
        // After 4 steps = full
        assert_eq!(compute_vested(&s, 100_000), THOUSAND_VIBE);
    }

    #[test]
    fn graded_vested_single_step() {
        let s = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, 1, true).unwrap();
        assert_eq!(compute_vested(&s, 0), 0);
        assert_eq!(compute_vested(&s, 50_000), 0);
        assert_eq!(compute_vested(&s, 99_999), 0);
        assert_eq!(compute_vested(&s, 100_000), THOUSAND_VIBE);
    }

    // ============ Claiming Tests ============

    #[test]
    fn claim_partial() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (amount, updated) = claim(&s, 50_000).unwrap();
        assert_eq!(amount, THOUSAND_VIBE / 2);
        assert_eq!(updated.claimed_amount, THOUSAND_VIBE / 2);
    }

    #[test]
    fn claim_full() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (amount, updated) = claim(&s, 100_000).unwrap();
        assert_eq!(amount, THOUSAND_VIBE);
        assert_eq!(updated.claimed_amount, THOUSAND_VIBE);
    }

    #[test]
    fn claim_nothing_before_cliff() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 100_000, true).unwrap();
        let err = claim(&s, 1_000).unwrap_err();
        assert_eq!(err, VestingError::NothingToClaim);
    }

    #[test]
    fn claim_nothing_before_start() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 1000, 5_000, 100_000, true).unwrap();
        let err = claim(&s, 500).unwrap_err();
        assert_eq!(err, VestingError::NothingToClaim);
    }

    #[test]
    fn claim_double_idempotent() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (amount1, updated1) = claim(&s, 50_000).unwrap();
        assert_eq!(amount1, THOUSAND_VIBE / 2);
        // Claim again at same block — nothing new
        let err = claim(&updated1, 50_000).unwrap_err();
        assert_eq!(err, VestingError::NothingToClaim);
    }

    #[test]
    fn claim_incremental() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (amount1, updated1) = claim(&s, 25_000).unwrap();
        assert_eq!(amount1, THOUSAND_VIBE / 4);

        let (amount2, updated2) = claim(&updated1, 75_000).unwrap();
        // Vested at 75000 = 750, already claimed 250, so claimable = 500
        assert_eq!(amount2, THOUSAND_VIBE / 2);
        assert_eq!(updated2.claimed_amount, mul_div(THOUSAND_VIBE, 75_000, 100_000));
    }

    #[test]
    fn claim_after_full_vest() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (amount, updated) = claim(&s, 200_000).unwrap();
        assert_eq!(amount, THOUSAND_VIBE);
        // Claim again — nothing
        let err = claim(&updated, 300_000).unwrap_err();
        assert_eq!(err, VestingError::NothingToClaim);
    }

    #[test]
    fn claim_milestone_at_boundary() {
        let milestones = vec![(10_000u64, 5000u16), (20_000, 10000)];
        let s = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap();

        let (amount1, updated1) = claim(&s, 10_000).unwrap();
        assert_eq!(amount1, THOUSAND_VIBE / 2);

        // Between milestones: nothing new
        let err = claim(&updated1, 15_000).unwrap_err();
        assert_eq!(err, VestingError::NothingToClaim);

        // At second milestone
        let (amount2, updated2) = claim(&updated1, 20_000).unwrap();
        assert_eq!(amount2, THOUSAND_VIBE / 2);
        assert_eq!(updated2.claimed_amount, THOUSAND_VIBE);
    }

    #[test]
    fn claim_graded() {
        let s = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, 4, true).unwrap();
        // At block 25000: 1 step complete = 25%
        let (amount, _) = claim(&s, 25_000).unwrap();
        assert_eq!(amount, THOUSAND_VIBE / 4);
    }

    // ============ Revocation Tests ============

    #[test]
    fn revoke_basic() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (ben, grantor, updated) = revoke(&s, 50_000).unwrap();
        // Beneficiary gets vested amount (50%)
        assert_eq!(ben, THOUSAND_VIBE / 2);
        // Grantor gets unvested (50%) minus 20% penalty
        let unvested = THOUSAND_VIBE / 2;
        let penalty = mul_div(unvested, EARLY_TERMINATION_PENALTY_BPS as u128, BPS);
        assert_eq!(grantor, unvested - penalty);
        assert!(updated.revoked);
        assert_eq!(updated.revoked_block, 50_000);
    }

    #[test]
    fn revoke_not_revocable() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, false).unwrap();
        let err = revoke(&s, 50_000).unwrap_err();
        assert_eq!(err, VestingError::NotRevocable);
    }

    #[test]
    fn revoke_already_revoked() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (_, _, updated) = revoke(&s, 50_000).unwrap();
        let err = revoke(&updated, 60_000).unwrap_err();
        assert_eq!(err, VestingError::AlreadyRevoked);
    }

    #[test]
    fn revoke_before_start() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 1000, 5_000, 100_000, true).unwrap();
        let (ben, grantor, _) = revoke(&s, 500).unwrap();
        assert_eq!(ben, 0); // Nothing vested
        let penalty = mul_div(THOUSAND_VIBE, EARLY_TERMINATION_PENALTY_BPS as u128, BPS);
        assert_eq!(grantor, THOUSAND_VIBE - penalty);
    }

    #[test]
    fn revoke_after_full_vest() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (ben, grantor, _) = revoke(&s, 200_000).unwrap();
        assert_eq!(ben, THOUSAND_VIBE);
        assert_eq!(grantor, 0); // Nothing to return
    }

    #[test]
    fn revoke_penalty_calculation() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (ben, grantor, _) = revoke(&s, 0).unwrap();
        // Nothing vested at block 0
        assert_eq!(ben, 0);
        // 20% penalty on full unvested amount
        let penalty = mul_div(THOUSAND_VIBE, 2000, 10_000);
        assert_eq!(grantor, THOUSAND_VIBE - penalty);
        // Verify: penalty is exactly 20%
        assert_eq!(penalty, THOUSAND_VIBE / 5);
    }

    #[test]
    fn revoke_stops_vesting() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (_, _, revoked) = revoke(&s, 50_000).unwrap();
        // After revocation, vesting is frozen at revocation block
        assert_eq!(compute_vested(&revoked, 50_000), THOUSAND_VIBE / 2);
        assert_eq!(compute_vested(&revoked, 75_000), THOUSAND_VIBE / 2);
        assert_eq!(compute_vested(&revoked, 100_000), THOUSAND_VIBE / 2);
    }

    #[test]
    fn revoke_claim_after_revocation() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (_, _, revoked) = revoke(&s, 50_000).unwrap();
        // Can still claim vested amount
        let (amount, claimed) = claim(&revoked, 75_000).unwrap();
        assert_eq!(amount, THOUSAND_VIBE / 2);
        // No more claims after that
        let err = claim(&claimed, 100_000).unwrap_err();
        assert_eq!(err, VestingError::NothingToClaim);
    }

    #[test]
    fn revoke_milestone_between() {
        let milestones = vec![(10_000u64, 2500u16), (20_000, 5000), (30_000, 10000)];
        let s = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap();
        let (ben, grantor, _) = revoke(&s, 15_000).unwrap();
        // At block 15000: first milestone (25%) is hit
        assert_eq!(ben, THOUSAND_VIBE / 4);
        let unvested = THOUSAND_VIBE - THOUSAND_VIBE / 4;
        let penalty = mul_div(unvested, EARLY_TERMINATION_PENALTY_BPS as u128, BPS);
        assert_eq!(grantor, unvested - penalty);
    }

    // ============ Acceleration Tests ============

    #[test]
    fn accelerate_basic() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 100_000, true).unwrap();
        let acc = accelerate(&s, 2500).unwrap(); // 25% reduction
        assert_eq!(acc.duration_blocks, 75_000);
    }

    #[test]
    fn accelerate_max() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 100_000, true).unwrap();
        let acc = accelerate(&s, MAX_ACCELERATION_BPS).unwrap(); // 50% reduction
        assert_eq!(acc.duration_blocks, 50_000);
    }

    #[test]
    fn accelerate_exceeds_max() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 100_000, true).unwrap();
        let err = accelerate(&s, MAX_ACCELERATION_BPS + 1).unwrap_err();
        assert_eq!(err, VestingError::InvalidAcceleration);
    }

    #[test]
    fn accelerate_zero() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 100_000, true).unwrap();
        let err = accelerate(&s, 0).unwrap_err();
        assert_eq!(err, VestingError::InvalidAcceleration);
    }

    #[test]
    fn accelerate_already_revoked() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (_, _, revoked) = revoke(&s, 50_000).unwrap();
        let err = accelerate(&revoked, 2500).unwrap_err();
        assert_eq!(err, VestingError::AlreadyRevoked);
    }

    #[test]
    fn accelerate_clamped_to_cliff() {
        // If acceleration would make duration shorter than cliff, clamp to cliff
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 80_000, 100_000, true).unwrap();
        let acc = accelerate(&s, 5000).unwrap(); // 50% reduction -> 50000 < cliff 80000
        assert_eq!(acc.duration_blocks, 80_000);
    }

    #[test]
    fn accelerate_milestone_schedule() {
        let milestones = vec![(10_000u64, 5000u16), (20_000, 10000)];
        let s = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap();
        let acc = accelerate(&s, 5000).unwrap(); // 50% reduction
        if let ScheduleType::Milestone { milestones: m, count } = &acc.schedule_type {
            assert_eq!(*count, 2);
            // Milestones should be shifted: 10000 * 50% = 5000, 20000 * 50% = 10000
            assert_eq!(m[0].block, 5_000);
            assert_eq!(m[1].block, 10_000);
        } else {
            panic!("Expected Milestone type");
        }
    }

    #[test]
    fn accelerate_graded() {
        let s = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, 10, true).unwrap();
        let acc = accelerate(&s, 2000).unwrap(); // 20% reduction
        assert_eq!(acc.duration_blocks, 80_000);
        // Steps remain the same
        if let ScheduleType::Graded { steps } = acc.schedule_type {
            assert_eq!(steps, 10);
        }
    }

    #[test]
    fn accelerate_small_bps() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let acc = accelerate(&s, 1).unwrap(); // 0.01% reduction
        assert_eq!(acc.duration_blocks, 99_990);
    }

    // ============ Extension Tests ============

    #[test]
    fn extend_basic() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let ext = extend(&s, 50_000).unwrap();
        assert_eq!(ext.duration_blocks, 150_000);
    }

    #[test]
    fn extend_zero() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let err = extend(&s, 0).unwrap_err();
        assert_eq!(err, VestingError::ZeroDuration);
    }

    #[test]
    fn extend_exceeds_max() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, MAX_VESTING_DURATION, true).unwrap();
        let err = extend(&s, 1).unwrap_err();
        assert_eq!(err, VestingError::ExceedsMaxDuration);
    }

    #[test]
    fn extend_overflow() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let err = extend(&s, u64::MAX).unwrap_err();
        assert_eq!(err, VestingError::Overflow);
    }

    #[test]
    fn extend_already_revoked() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (_, _, revoked) = revoke(&s, 50_000).unwrap();
        let err = extend(&revoked, 10_000).unwrap_err();
        assert_eq!(err, VestingError::AlreadyRevoked);
    }

    #[test]
    fn extend_up_to_max() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let ext = extend(&s, MAX_VESTING_DURATION - 100_000).unwrap();
        assert_eq!(ext.duration_blocks, MAX_VESTING_DURATION);
    }

    // ============ Status Tests ============

    #[test]
    fn status_before_start() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 1000, 5_000, 100_000, true).unwrap();
        let st = get_status(&s, 500);
        assert_eq!(st.total_amount, THOUSAND_VIBE);
        assert_eq!(st.vested_amount, 0);
        assert_eq!(st.claimed_amount, 0);
        assert_eq!(st.claimable_amount, 0);
        assert_eq!(st.remaining_amount, THOUSAND_VIBE);
        assert_eq!(st.percent_vested_bps, 0);
        assert!(!st.is_fully_vested);
        assert!(!st.is_revoked);
    }

    #[test]
    fn status_at_cliff_end() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 10_000, 100_000, true).unwrap();
        let st = get_status(&s, 10_000);
        assert_eq!(st.vested_amount, mul_div(THOUSAND_VIBE, 10_000, 100_000));
        assert_eq!(st.claimable_amount, st.vested_amount);
        assert_eq!(st.percent_vested_bps, 1000); // 10%
    }

    #[test]
    fn status_halfway() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let st = get_status(&s, 50_000);
        assert_eq!(st.vested_amount, THOUSAND_VIBE / 2);
        assert_eq!(st.remaining_amount, THOUSAND_VIBE / 2);
        assert_eq!(st.percent_vested_bps, 5000);
        assert!(!st.is_fully_vested);
    }

    #[test]
    fn status_fully_vested() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let st = get_status(&s, 100_000);
        assert_eq!(st.vested_amount, THOUSAND_VIBE);
        assert_eq!(st.remaining_amount, 0);
        assert_eq!(st.percent_vested_bps, 10000);
        assert!(st.is_fully_vested);
    }

    #[test]
    fn status_after_claim() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (_, updated) = claim(&s, 50_000).unwrap();
        let st = get_status(&updated, 75_000);
        assert_eq!(st.vested_amount, mul_div(THOUSAND_VIBE, 75_000, 100_000));
        assert_eq!(st.claimed_amount, THOUSAND_VIBE / 2);
        assert_eq!(st.claimable_amount, st.vested_amount - st.claimed_amount);
    }

    #[test]
    fn status_revoked() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (_, _, revoked) = revoke(&s, 50_000).unwrap();
        let st = get_status(&revoked, 75_000);
        assert!(st.is_revoked);
        assert_eq!(st.vested_amount, THOUSAND_VIBE / 2);
    }

    #[test]
    fn status_next_unlock_linear_before_cliff() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 10_000, 100_000, true).unwrap();
        let st = get_status(&s, 5_000);
        assert_eq!(st.next_unlock_block, 10_000);
        assert_eq!(st.blocks_until_next_unlock, 5_000);
    }

    #[test]
    fn status_next_unlock_linear_after_cliff() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 10_000, 100_000, true).unwrap();
        let st = get_status(&s, 50_000);
        assert_eq!(st.next_unlock_block, 50_001);
        assert_eq!(st.blocks_until_next_unlock, 1);
    }

    #[test]
    fn status_zero_amount() {
        // Edge case: if somehow total_amount was 0 (shouldn't happen with validation, but test defensively)
        let mut s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        s.total_amount = 0; // Force for test
        let st = get_status(&s, 50_000);
        assert_eq!(st.percent_vested_bps, 0);
    }

    // ============ Summary Tests ============

    #[test]
    fn summary_empty() {
        let summary = summarize(&[], 50_000);
        assert_eq!(summary.total_allocated, 0);
        assert_eq!(summary.total_vested, 0);
        assert_eq!(summary.total_claimed, 0);
        assert_eq!(summary.total_unvested, 0);
        assert_eq!(summary.active_schedules, 0);
        assert_eq!(summary.revoked_schedules, 0);
        assert_eq!(summary.fully_vested_schedules, 0);
    }

    #[test]
    fn summary_single_active() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let summary = summarize(&[s], 50_000);
        assert_eq!(summary.total_allocated, THOUSAND_VIBE);
        assert_eq!(summary.total_vested, THOUSAND_VIBE / 2);
        assert_eq!(summary.total_claimed, 0);
        assert_eq!(summary.total_unvested, THOUSAND_VIBE / 2);
        assert_eq!(summary.active_schedules, 1);
        assert_eq!(summary.revoked_schedules, 0);
        assert_eq!(summary.fully_vested_schedules, 0);
    }

    #[test]
    fn summary_mixed() {
        let s1 = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let s2 = create_linear(beneficiary_b(), THOUSAND_VIBE, 0, 0, 50_000, true).unwrap();
        let (_, _, s3) = revoke(
            &create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap(),
            25_000,
        ).unwrap();

        let summary = summarize(&[s1, s2, s3], 100_000);
        assert_eq!(summary.total_allocated, 3 * THOUSAND_VIBE);
        assert_eq!(summary.active_schedules, 0); // s1 and s2 fully vested
        assert_eq!(summary.fully_vested_schedules, 2);
        assert_eq!(summary.revoked_schedules, 1);
    }

    #[test]
    fn summary_all_fully_vested() {
        let s1 = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let s2 = create_linear(beneficiary_b(), HUNDRED_VIBE, 0, 0, 50_000, false).unwrap();
        let summary = summarize(&[s1, s2], 200_000);
        assert_eq!(summary.fully_vested_schedules, 2);
        assert_eq!(summary.active_schedules, 0);
        assert_eq!(summary.total_vested, THOUSAND_VIBE + HUNDRED_VIBE);
        assert_eq!(summary.total_unvested, 0);
    }

    #[test]
    fn summary_with_claims() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (_, claimed) = claim(&s, 50_000).unwrap();
        let summary = summarize(&[claimed], 50_000);
        assert_eq!(summary.total_claimed, THOUSAND_VIBE / 2);
    }

    // ============ Next Unlock Block Tests ============

    #[test]
    fn next_unlock_linear_before_start() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 1000, 5_000, 100_000, true).unwrap();
        assert_eq!(next_unlock_block(&s, 500), 6_000); // start + cliff
    }

    #[test]
    fn next_unlock_linear_during_cliff() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 10_000, 100_000, true).unwrap();
        assert_eq!(next_unlock_block(&s, 5_000), 10_000);
    }

    #[test]
    fn next_unlock_linear_after_cliff() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 10_000, 100_000, true).unwrap();
        assert_eq!(next_unlock_block(&s, 50_000), 50_001);
    }

    #[test]
    fn next_unlock_linear_fully_vested() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        assert_eq!(next_unlock_block(&s, 100_000), 100_000);
    }

    #[test]
    fn next_unlock_milestone_before_first() {
        let milestones = vec![(10_000u64, 5000u16), (20_000, 10000)];
        let s = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap();
        assert_eq!(next_unlock_block(&s, 5_000), 10_000);
    }

    #[test]
    fn next_unlock_milestone_between() {
        let milestones = vec![(10_000u64, 5000u16), (20_000, 10000)];
        let s = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap();
        assert_eq!(next_unlock_block(&s, 15_000), 20_000);
    }

    #[test]
    fn next_unlock_milestone_after_all() {
        let milestones = vec![(10_000u64, 5000u16), (20_000, 10000)];
        let s = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap();
        assert_eq!(next_unlock_block(&s, 25_000), 25_000);
    }

    #[test]
    fn next_unlock_graded_before_cliff() {
        let s = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 10_000, 100_000, 10, true).unwrap();
        assert_eq!(next_unlock_block(&s, 5_000), 10_000);
    }

    #[test]
    fn next_unlock_graded_after_cliff() {
        // step_size = (100000 - 10000) / 10 = 9000
        let s = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 10_000, 100_000, 10, true).unwrap();
        // At block 10000 (cliff end), next is first step at 10000 + 9000 = 19000
        assert_eq!(next_unlock_block(&s, 10_000), 19_000);
    }

    #[test]
    fn next_unlock_graded_at_step() {
        let s = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 10_000, 100_000, 10, true).unwrap();
        // At block 19000 (first step), next is 28000
        assert_eq!(next_unlock_block(&s, 19_000), 28_000);
    }

    #[test]
    fn next_unlock_revoked() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (_, _, revoked) = revoke(&s, 50_000).unwrap();
        assert_eq!(next_unlock_block(&revoked, 60_000), 60_000);
    }

    // ============ Remaining Duration Tests ============

    #[test]
    fn remaining_before_start() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 1000, 5_000, 100_000, true).unwrap();
        assert_eq!(remaining_duration(&s, 0), 101_000); // start + duration - current
    }

    #[test]
    fn remaining_halfway() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        assert_eq!(remaining_duration(&s, 50_000), 50_000);
    }

    #[test]
    fn remaining_at_end() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        assert_eq!(remaining_duration(&s, 100_000), 0);
    }

    #[test]
    fn remaining_after_end() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        assert_eq!(remaining_duration(&s, 200_000), 0);
    }

    #[test]
    fn remaining_revoked() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (_, _, revoked) = revoke(&s, 50_000).unwrap();
        assert_eq!(remaining_duration(&revoked, 50_000), 0);
    }

    // ============ Edge Case Tests ============

    #[test]
    fn edge_start_block_zero() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        assert_eq!(s.start_block, 0);
        assert_eq!(compute_vested(&s, 0), 0);
        // Block 1 should vest something
        assert!(compute_vested(&s, 1) > 0);
    }

    #[test]
    fn edge_large_amount() {
        let large = u128::MAX / 2;
        // This will fail validation (below min check is fine since large > MIN)
        // but duration check should pass
        let s = create_linear(beneficiary_a(), large, 0, 0, 100_000, true).unwrap();
        let vested = compute_vested(&s, 50_000);
        assert_eq!(vested, mul_div(large, 50_000, 100_000));
    }

    #[test]
    fn edge_one_block_duration() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 1, true).unwrap();
        assert_eq!(compute_vested(&s, 0), 0);
        assert_eq!(compute_vested(&s, 1), THOUSAND_VIBE);
    }

    #[test]
    fn edge_cliff_equals_duration() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 100_000, 100_000, true).unwrap();
        assert_eq!(compute_vested(&s, 0), 0);
        assert_eq!(compute_vested(&s, 99_999), 0);
        assert_eq!(compute_vested(&s, 100_000), THOUSAND_VIBE);
    }

    #[test]
    fn edge_vested_at_block_just_before_cliff_end() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 100_000, true).unwrap();
        assert_eq!(compute_vested(&s, 4_999), 0);
    }

    #[test]
    fn edge_multiple_claims_accumulate() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (a1, u1) = claim(&s, 10_000).unwrap();
        let (a2, u2) = claim(&u1, 20_000).unwrap();
        let (a3, u3) = claim(&u2, 30_000).unwrap();
        let total_claimed = a1 + a2 + a3;
        assert_eq!(total_claimed, mul_div(THOUSAND_VIBE, 30_000, 100_000));
        assert_eq!(u3.claimed_amount, total_claimed);
    }

    #[test]
    fn edge_graded_many_steps() {
        let s = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, 1000, true).unwrap();
        // step_size = 100000 / 1000 = 100 blocks
        assert_eq!(compute_vested(&s, 100), THOUSAND_VIBE / 1000);
        assert_eq!(compute_vested(&s, 50_000), THOUSAND_VIBE / 2);
    }

    #[test]
    fn edge_graded_step_size_remainder() {
        // Duration 100 with 3 steps: step_size = 33
        // Steps at 33, 66, 99. Block 100 = full
        let s = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100, 3, true).unwrap();
        assert_eq!(compute_vested(&s, 33), THOUSAND_VIBE / 3);
        assert_eq!(compute_vested(&s, 66), mul_div(THOUSAND_VIBE, 2, 3));
        assert_eq!(compute_vested(&s, 99), THOUSAND_VIBE);
        assert_eq!(compute_vested(&s, 100), THOUSAND_VIBE);
    }

    #[test]
    fn edge_milestone_partial_bps() {
        // Milestone that only unlocks 75%
        let milestones = vec![(10_000u64, 2500u16), (20_000, 7500)];
        let s = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap();
        let vested = compute_vested(&s, 30_000);
        // Only 75% unlocked even though all milestones passed
        assert_eq!(vested, mul_div(THOUSAND_VIBE, 7500, 10000));
    }

    #[test]
    fn edge_revoke_at_start() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 1000, 5_000, 100_000, true).unwrap();
        let (ben, grantor, _) = revoke(&s, 1000).unwrap();
        assert_eq!(ben, 0);
        let penalty = mul_div(THOUSAND_VIBE, EARLY_TERMINATION_PENALTY_BPS as u128, BPS);
        assert_eq!(grantor, THOUSAND_VIBE - penalty);
    }

    #[test]
    fn edge_accelerate_then_vest() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let acc = accelerate(&s, 5000).unwrap(); // 50% faster -> 50000 blocks
        assert_eq!(acc.duration_blocks, 50_000);
        // Now at block 25000: should be 50% vested (was 25% before acceleration)
        assert_eq!(compute_vested(&acc, 25_000), THOUSAND_VIBE / 2);
        // Fully vested at 50000 instead of 100000
        assert_eq!(compute_vested(&acc, 50_000), THOUSAND_VIBE);
    }

    #[test]
    fn edge_extend_then_vest() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let ext = extend(&s, 100_000).unwrap(); // doubled to 200000
        assert_eq!(ext.duration_blocks, 200_000);
        // At 100000: 50% vested instead of 100%
        assert_eq!(compute_vested(&ext, 100_000), THOUSAND_VIBE / 2);
        assert_eq!(compute_vested(&ext, 200_000), THOUSAND_VIBE);
    }

    #[test]
    fn edge_beneficiary_identity() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        assert_eq!(s.beneficiary, beneficiary_a());
        assert_ne!(s.beneficiary, beneficiary_b());
    }

    #[test]
    fn edge_max_duration_boundary() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, MAX_VESTING_DURATION, true).unwrap();
        assert_eq!(compute_vested(&s, MAX_VESTING_DURATION / 2), THOUSAND_VIBE / 2);
        assert_eq!(compute_vested(&s, MAX_VESTING_DURATION), THOUSAND_VIBE);
    }

    // ============ Compute Claimable Tests ============

    #[test]
    fn claimable_before_cliff() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 100_000, true).unwrap();
        assert_eq!(compute_claimable(&s, 1_000), 0);
    }

    #[test]
    fn claimable_after_cliff() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 100_000, true).unwrap();
        let claimable = compute_claimable(&s, 50_000);
        assert_eq!(claimable, mul_div(THOUSAND_VIBE, 50_000, 100_000));
    }

    #[test]
    fn claimable_after_partial_claim() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (_, updated) = claim(&s, 25_000).unwrap();
        let claimable = compute_claimable(&updated, 50_000);
        let vested_50k = mul_div(THOUSAND_VIBE, 50_000, 100_000);
        let claimed_25k = mul_div(THOUSAND_VIBE, 25_000, 100_000);
        assert_eq!(claimable, vested_50k - claimed_25k);
    }

    #[test]
    fn claimable_fully_claimed() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (_, updated) = claim(&s, 100_000).unwrap();
        assert_eq!(compute_claimable(&updated, 200_000), 0);
    }

    // ============ Cross-type Consistency Tests ============

    #[test]
    fn consistency_linear_vs_graded_many_steps() {
        // A graded schedule with many steps should approximate linear
        let linear = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let graded = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, 10_000, true).unwrap();
        // step_size = 10 blocks. Check at 50000 (exact step boundary)
        assert_eq!(compute_vested(&linear, 50_000), compute_vested(&graded, 50_000));
    }

    #[test]
    fn consistency_milestone_100pct_matches_full() {
        let milestones = vec![(50_000u64, 10000u16)];
        let s = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap();
        assert_eq!(compute_vested(&s, 50_000), THOUSAND_VIBE);
    }

    #[test]
    fn consistency_all_types_zero_before_start() {
        let linear = create_linear(beneficiary_a(), THOUSAND_VIBE, 1000, 5_000, 100_000, true).unwrap();
        let milestones = vec![(11_000u64, 5000u16), (21_000, 10000)];
        let milestone = create_milestone(beneficiary_a(), THOUSAND_VIBE, 1000, &milestones, true).unwrap();
        let graded = create_graded(beneficiary_a(), THOUSAND_VIBE, 1000, 5_000, 100_000, 10, true).unwrap();

        assert_eq!(compute_vested(&linear, 500), 0);
        assert_eq!(compute_vested(&milestone, 500), 0);
        assert_eq!(compute_vested(&graded, 500), 0);
    }

    // ============ Stress / Boundary Tests ============

    #[test]
    fn stress_many_claims() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 1_000_000, true).unwrap();
        let mut current = s;
        let mut total_claimed: u128 = 0;
        for block in (100_000..=1_000_000).step_by(100_000) {
            let (amount, updated) = claim(&current, block as u64).unwrap();
            total_claimed += amount;
            current = updated;
        }
        assert_eq!(total_claimed, THOUSAND_VIBE);
    }

    #[test]
    fn stress_revoke_then_claim_exactly() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (ben_gets, _, revoked) = revoke(&s, 50_000).unwrap();
        assert_eq!(ben_gets, THOUSAND_VIBE / 2);
        let (claimed, updated) = claim(&revoked, 100_000).unwrap();
        assert_eq!(claimed, THOUSAND_VIBE / 2);
        assert_eq!(updated.claimed_amount, THOUSAND_VIBE / 2);
        let err = claim(&updated, 200_000).unwrap_err();
        assert_eq!(err, VestingError::NothingToClaim);
    }

    #[test]
    fn stress_accelerate_multiple_times() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let a1 = accelerate(&s, 1000).unwrap(); // 10% -> 90000
        assert_eq!(a1.duration_blocks, 90_000);
        let a2 = accelerate(&a1, 1000).unwrap(); // 10% of 90000 -> 81000
        assert_eq!(a2.duration_blocks, 81_000);
    }

    #[test]
    fn stress_extend_multiple_times() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let e1 = extend(&s, 50_000).unwrap();
        assert_eq!(e1.duration_blocks, 150_000);
        let e2 = extend(&e1, 50_000).unwrap();
        assert_eq!(e2.duration_blocks, 200_000);
    }

    #[test]
    fn stress_summary_five_schedules() {
        let schedules: Vec<VestingSchedule> = (0..5).map(|i| {
            create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000 * (i + 1) as u64, true).unwrap()
        }).collect();
        let summary = summarize(&schedules, 50_000);
        assert_eq!(summary.total_allocated, 5 * THOUSAND_VIBE);
        // All active since none are fully vested at 50000 (shortest is 100000)
        assert_eq!(summary.active_schedules, 5);
    }

    #[test]
    fn stress_graded_exact_step_boundaries() {
        // 5 steps over 50000 blocks, no cliff. step_size = 10000
        let s = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 0, 50_000, 5, true).unwrap();
        for step in 0..5u64 {
            let block = (step + 1) * 10_000;
            let expected = mul_div(THOUSAND_VIBE, (step + 1) as u128, 5);
            assert_eq!(compute_vested(&s, block), expected, "Failed at step {}", step);
        }
    }

    #[test]
    fn stress_milestone_claim_each() {
        let milestones = vec![
            (10_000u64, 2000u16),
            (20_000, 4000),
            (30_000, 6000),
            (40_000, 8000),
            (50_000, 10000),
        ];
        let s = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true).unwrap();
        let mut current = s;
        let mut total_claimed: u128 = 0;
        for &(block, _) in &milestones {
            let (amount, updated) = claim(&current, block).unwrap();
            total_claimed += amount;
            current = updated;
        }
        assert_eq!(total_claimed, THOUSAND_VIBE);
    }

    // ============ Next Unlock Block Edge Tests ============

    #[test]
    fn next_unlock_linear_no_cliff() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        assert_eq!(next_unlock_block(&s, 0), 1);
        assert_eq!(next_unlock_block(&s, 50_000), 50_001);
    }

    #[test]
    fn next_unlock_graded_last_step() {
        let s = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, 10, true).unwrap();
        // step_size = 10000, at step 9 (block 90000), next is end (100000)
        assert_eq!(next_unlock_block(&s, 90_000), 100_000);
    }

    #[test]
    fn next_unlock_graded_fully_vested() {
        let s = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, 10, true).unwrap();
        assert_eq!(next_unlock_block(&s, 100_000), 100_000);
    }

    // ============ Additional Validation Tests ============

    #[test]
    fn validate_cliff_999_fails() {
        let err = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 999, 100_000, true).unwrap_err();
        assert_eq!(err, VestingError::BelowMinCliff);
    }

    #[test]
    fn validate_cliff_1000_succeeds() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 1000, 100_000, true).unwrap();
        assert_eq!(s.cliff_blocks, 1000);
    }

    #[test]
    fn validate_amount_exactly_min() {
        let s = create_linear(beneficiary_a(), MIN_VESTING_AMOUNT, 0, 0, 100_000, true).unwrap();
        assert_eq!(s.total_amount, MIN_VESTING_AMOUNT);
    }

    #[test]
    fn validate_duration_exactly_max() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, MAX_VESTING_DURATION, true).unwrap();
        assert_eq!(s.duration_blocks, MAX_VESTING_DURATION);
    }

    #[test]
    fn validate_duration_one_over_max() {
        let err = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, MAX_VESTING_DURATION + 1, true).unwrap_err();
        assert_eq!(err, VestingError::ExceedsMaxDuration);
    }

    #[test]
    fn validate_graded_validation_inherits_common() {
        let err = create_graded(beneficiary_a(), 0, 0, 0, 100_000, 10, true).unwrap_err();
        assert_eq!(err, VestingError::ZeroAmount);
    }

    // ============ Revocation Penalty Precision Tests ============

    #[test]
    fn revoke_penalty_precision_small() {
        // Small amount: 10 VIBE
        let s = create_linear(beneficiary_a(), TEN_VIBE, 0, 0, 100_000, true).unwrap();
        let (_, grantor, _) = revoke(&s, 0).unwrap();
        let penalty = mul_div(TEN_VIBE, EARLY_TERMINATION_PENALTY_BPS as u128, BPS);
        assert_eq!(grantor, TEN_VIBE - penalty);
        assert_eq!(penalty, TEN_VIBE / 5); // Exactly 20%
    }

    #[test]
    fn revoke_penalty_precision_large() {
        let large = 999_999_999_999_999_999_999u128; // Odd number
        let s = create_linear(beneficiary_a(), large, 0, 0, 100_000, true).unwrap();
        let (ben, grantor, _) = revoke(&s, 50_000).unwrap();
        let vested = mul_div(large, 50_000, 100_000);
        assert_eq!(ben, vested);
        let unvested = large - vested;
        let penalty = mul_div(unvested, 2000, 10_000);
        assert_eq!(grantor, unvested - penalty);
    }

    // ============ Revoked Schedule Behavior Tests ============

    #[test]
    fn revoked_schedule_claimable() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (_, _, revoked) = revoke(&s, 30_000).unwrap();
        let claimable = compute_claimable(&revoked, 50_000);
        assert_eq!(claimable, mul_div(THOUSAND_VIBE, 30_000, 100_000));
    }

    #[test]
    fn revoked_schedule_status_frozen() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (_, _, revoked) = revoke(&s, 25_000).unwrap();
        let st1 = get_status(&revoked, 25_000);
        let st2 = get_status(&revoked, 75_000);
        assert_eq!(st1.vested_amount, st2.vested_amount);
    }

    #[test]
    fn revoked_remaining_duration_zero() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (_, _, revoked) = revoke(&s, 50_000).unwrap();
        assert_eq!(remaining_duration(&revoked, 50_000), 0);
        assert_eq!(remaining_duration(&revoked, 75_000), 0);
    }

    // ============ Hardening Tests v4 ============

    #[test]
    fn linear_vested_one_block_before_cliff_end_v4() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 100_000, true).unwrap();
        assert_eq!(compute_vested(&s, 4_999), 0);
    }

    #[test]
    fn linear_vested_exactly_at_cliff_end_v4() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 100_000, true).unwrap();
        let v = compute_vested(&s, 5_000);
        // At cliff end, vested = total * 5000 / 100000 = 5%
        assert_eq!(v, mul_div(THOUSAND_VIBE, 5_000, 100_000));
    }

    #[test]
    fn linear_vested_one_block_after_cliff_v4() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 100_000, true).unwrap();
        let v = compute_vested(&s, 5_001);
        assert_eq!(v, mul_div(THOUSAND_VIBE, 5_001, 100_000));
    }

    #[test]
    fn graded_step_boundaries_exact_v4() {
        // 10 steps over 10000 blocks (cliff=0), each step = 1000 blocks
        let s = create_graded(beneficiary_a(), TEN_VIBE, 0, 0, 10_000, 10, true).unwrap();
        // At exactly step 1 boundary (block 1000), should get 1/10
        assert_eq!(compute_vested(&s, 1_000), TEN_VIBE / 10);
        // At block 999, should get 0/10 (step not yet complete)
        assert_eq!(compute_vested(&s, 999), 0);
    }

    #[test]
    fn graded_step_last_step_boundary_v4() {
        let s = create_graded(beneficiary_a(), TEN_VIBE, 0, 0, 10_000, 10, true).unwrap();
        // At exactly the last step (block 10000), should be fully vested
        assert_eq!(compute_vested(&s, 10_000), TEN_VIBE);
    }

    #[test]
    fn milestone_create_bps_over_10000_v4() {
        let result = create_milestone(
            beneficiary_a(),
            TEN_VIBE,
            0,
            &[(1_000, 5_000), (2_000, 10_001)],
            true,
        );
        assert_eq!(result, Err(VestingError::InvalidMilestone));
    }

    #[test]
    fn milestone_create_exactly_10000_bps_v4() {
        let result = create_milestone(
            beneficiary_a(),
            TEN_VIBE,
            0,
            &[(1_000, 5_000), (2_000, 10_000)],
            true,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn claim_returns_updated_schedule_v4() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (amount, updated) = claim(&s, 50_000).unwrap();
        assert_eq!(updated.claimed_amount, amount);
        assert_eq!(updated.beneficiary, s.beneficiary);
        assert_eq!(updated.total_amount, s.total_amount);
    }

    #[test]
    fn claim_nothing_when_fully_claimed_v4() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (_, updated) = claim(&s, 100_000).unwrap();
        // Already fully claimed
        let result = claim(&updated, 100_000);
        assert_eq!(result, Err(VestingError::NothingToClaim));
    }

    #[test]
    fn revoke_unvested_portion_calculation_v4() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (beneficiary_gets, returned, _updated) = revoke(&s, 50_000).unwrap();
        // At 50% vested: beneficiary gets 500, unvested = 500
        // Penalty = 500 * 2000/10000 = 100
        // Returned = 500 - 100 = 400
        let expected_vested = THOUSAND_VIBE / 2;
        let expected_unvested = THOUSAND_VIBE - expected_vested;
        let expected_penalty = mul_div(expected_unvested, EARLY_TERMINATION_PENALTY_BPS as u128, BPS);
        let expected_returned = expected_unvested - expected_penalty;
        assert_eq!(beneficiary_gets, expected_vested);
        assert_eq!(returned, expected_returned);
    }

    #[test]
    fn revoke_fully_vested_returns_zero_v4() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (beneficiary_gets, returned, _updated) = revoke(&s, 100_000).unwrap();
        assert_eq!(beneficiary_gets, THOUSAND_VIBE);
        assert_eq!(returned, 0);
    }

    #[test]
    fn accelerate_preserves_beneficiary_v4() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 100_000, true).unwrap();
        let accel = accelerate(&s, 2500).unwrap();
        assert_eq!(accel.beneficiary, beneficiary_a());
        assert_eq!(accel.total_amount, THOUSAND_VIBE);
    }

    #[test]
    fn accelerate_duration_decreases_v4() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 100_000, true).unwrap();
        let accel = accelerate(&s, 2500).unwrap();
        assert!(accel.duration_blocks < s.duration_blocks);
        // 25% reduction: 100000 * 2500/10000 = 25000, new = 75000
        assert_eq!(accel.duration_blocks, 75_000);
    }

    #[test]
    fn extend_increases_duration_v4() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 100_000, true).unwrap();
        let extended = extend(&s, 50_000).unwrap();
        assert_eq!(extended.duration_blocks, 150_000);
    }

    #[test]
    fn extend_to_exactly_max_v4() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 100_000, true).unwrap();
        let additional = MAX_VESTING_DURATION - s.duration_blocks;
        let extended = extend(&s, additional).unwrap();
        assert_eq!(extended.duration_blocks, MAX_VESTING_DURATION);
    }

    #[test]
    fn extend_one_over_max_fails_v4() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 100_000, true).unwrap();
        let additional = MAX_VESTING_DURATION - s.duration_blocks + 1;
        assert_eq!(extend(&s, additional), Err(VestingError::ExceedsMaxDuration));
    }

    #[test]
    fn summarize_empty_schedules_v4() {
        let summary = summarize(&[], 50_000);
        assert_eq!(summary.total_allocated, 0);
        assert_eq!(summary.total_vested, 0);
        assert_eq!(summary.active_schedules, 0);
        assert_eq!(summary.revoked_schedules, 0);
        assert_eq!(summary.fully_vested_schedules, 0);
    }

    #[test]
    fn summarize_counts_revoked_v4() {
        let s1 = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (_, _, revoked) = revoke(&s1, 50_000).unwrap();
        let summary = summarize(&[revoked], 60_000);
        assert_eq!(summary.revoked_schedules, 1);
        assert_eq!(summary.active_schedules, 0);
    }

    #[test]
    fn next_unlock_graded_between_steps_v4() {
        // 4 steps over 40000 blocks, cliff=0, step_size=10000
        let s = create_graded(beneficiary_a(), TEN_VIBE, 0, 0, 40_000, 4, true).unwrap();
        // At block 5000 (between step 0 and step 1), next unlock = 10000
        assert_eq!(next_unlock_block(&s, 5_000), 10_000);
        // At block 15000, next unlock = 20000
        assert_eq!(next_unlock_block(&s, 15_000), 20_000);
    }

    #[test]
    fn remaining_duration_at_start_v4() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 100, 5_000, 100_000, true).unwrap();
        assert_eq!(remaining_duration(&s, 100), 100_000);
    }

    #[test]
    fn remaining_duration_before_start_v4() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 100, 5_000, 100_000, true).unwrap();
        assert_eq!(remaining_duration(&s, 50), 100_050);
    }

    #[test]
    fn status_milestone_next_unlock_v4() {
        let s = create_milestone(
            beneficiary_a(),
            TEN_VIBE,
            0,
            &[(1_000, 2_500), (2_000, 5_000), (3_000, 10_000)],
            true,
        ).unwrap();
        let status = get_status(&s, 500);
        assert_eq!(status.next_unlock_block, 1_000);
        assert_eq!(status.blocks_until_next_unlock, 500);
    }

    #[test]
    fn compute_claimable_after_partial_claim_v4() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (_, updated) = claim(&s, 50_000).unwrap();
        // At block 75000, vested = 75%, claimed = 50% → claimable = 25%
        let claimable = compute_claimable(&updated, 75_000);
        let expected = mul_div(THOUSAND_VIBE, 75_000, 100_000) - updated.claimed_amount;
        assert_eq!(claimable, expected);
    }

    #[test]
    fn revoke_then_claim_exactly_vested_v4() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 0, 100_000, true).unwrap();
        let (_, _, revoked) = revoke(&s, 50_000).unwrap();
        // After revocation at 50000, vested amount is frozen at 50%
        let (claimed, _) = claim(&revoked, 100_000).unwrap();
        assert_eq!(claimed, THOUSAND_VIBE / 2);
    }

    #[test]
    fn linear_create_cliff_at_min_boundary_v4() {
        // cliff = MIN_CLIFF_BLOCKS should succeed
        let result = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, MIN_CLIFF_BLOCKS, 100_000, true);
        assert!(result.is_ok());
    }

    #[test]
    fn linear_create_cliff_just_below_min_v4() {
        // cliff = MIN_CLIFF_BLOCKS - 1 should fail
        let result = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, MIN_CLIFF_BLOCKS - 1, 100_000, true);
        assert_eq!(result, Err(VestingError::BelowMinCliff));
    }

    #[test]
    fn graded_vested_many_steps_exact_v4() {
        // 100 steps, verifying vesting at step boundaries
        let s = create_graded(beneficiary_a(), HUNDRED_VIBE, 0, 0, 100_000, 100, true).unwrap();
        // Each step = 1000 blocks. At block 1000 = 1/100
        assert_eq!(compute_vested(&s, 1_000), HUNDRED_VIBE / 100);
        // At block 50000 = 50/100
        assert_eq!(compute_vested(&s, 50_000), HUNDRED_VIBE / 2);
    }

    // ============ Hardening Round 9 ============

    #[test]
    fn linear_create_zero_amount_h9() {
        let result = create_linear(beneficiary_a(), 0, 0, 5_000, 1_000_000, true);
        assert_eq!(result, Err(VestingError::ZeroAmount));
    }

    #[test]
    fn linear_create_below_min_amount_h9() {
        let result = create_linear(beneficiary_a(), MIN_VESTING_AMOUNT - 1, 0, 5_000, 1_000_000, true);
        assert_eq!(result, Err(VestingError::BelowMinAmount));
    }

    #[test]
    fn linear_create_exceeds_max_duration_h9() {
        let result = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, MAX_VESTING_DURATION + 1, true);
        assert_eq!(result, Err(VestingError::ExceedsMaxDuration));
    }

    #[test]
    fn linear_create_cliff_exceeds_duration_h9() {
        let result = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 200_000, 100_000, true);
        assert_eq!(result, Err(VestingError::CliffExceedsDuration));
    }

    #[test]
    fn linear_vested_before_start_h9() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 100, 5_000, 1_000_000, true).unwrap();
        assert_eq!(compute_vested(&s, 50), 0);
    }

    #[test]
    fn linear_vested_during_cliff_h9() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 1_000_000, true).unwrap();
        assert_eq!(compute_vested(&s, 4_999), 0);
    }

    #[test]
    fn linear_vested_at_cliff_end_h9() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 1_000_000, true).unwrap();
        let vested = compute_vested(&s, 5_000);
        // 5000/1000000 of total
        let expected = THOUSAND_VIBE * 5_000 / 1_000_000;
        assert_eq!(vested, expected);
    }

    #[test]
    fn linear_fully_vested_h9() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 1_000_000, true).unwrap();
        assert_eq!(compute_vested(&s, 1_000_000), THOUSAND_VIBE);
    }

    #[test]
    fn linear_vested_past_end_h9() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 1_000_000, true).unwrap();
        // Past end should still return total
        assert_eq!(compute_vested(&s, 2_000_000), THOUSAND_VIBE);
    }

    #[test]
    fn claim_nothing_available_h9() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 100, 5_000, 1_000_000, true).unwrap();
        let result = claim(&s, 50); // Before start
        assert_eq!(result, Err(VestingError::NothingToClaim));
    }

    #[test]
    fn claim_partial_h9() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 1_000_000, true).unwrap();
        let (claimed, updated) = claim(&s, 500_000).unwrap(); // Halfway
        assert!(claimed > 0);
        assert_eq!(updated.claimed_amount, claimed);
    }

    #[test]
    fn revoke_non_revocable_h9() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 1_000_000, false).unwrap();
        let result = revoke(&s, 500_000);
        assert_eq!(result, Err(VestingError::NotRevocable));
    }

    #[test]
    fn revoke_already_revoked_h9() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 1_000_000, true).unwrap();
        let (_, _, updated) = revoke(&s, 500_000).unwrap();
        let result = revoke(&updated, 600_000);
        assert_eq!(result, Err(VestingError::AlreadyRevoked));
    }

    #[test]
    fn revoke_penalty_deduction_h9() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 1_000_000, true).unwrap();
        let (beneficiary_gets, returned, updated) = revoke(&s, 0).unwrap();
        // At block 0 (start), nothing vested, all unvested
        assert_eq!(beneficiary_gets, 0);
        // 20% penalty on unvested
        let unvested = THOUSAND_VIBE;
        let penalty = unvested * EARLY_TERMINATION_PENALTY_BPS as u128 / BPS;
        assert_eq!(returned, unvested - penalty);
        assert!(updated.revoked);
    }

    #[test]
    fn accelerate_zero_bps_h9() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 1_000_000, true).unwrap();
        let result = accelerate(&s, 0);
        assert_eq!(result, Err(VestingError::InvalidAcceleration));
    }

    #[test]
    fn accelerate_exceeds_max_h9() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 1_000_000, true).unwrap();
        let result = accelerate(&s, MAX_ACCELERATION_BPS + 1);
        assert_eq!(result, Err(VestingError::InvalidAcceleration));
    }

    #[test]
    fn accelerate_revoked_h9() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 1_000_000, true).unwrap();
        let (_, _, revoked) = revoke(&s, 500_000).unwrap();
        let result = accelerate(&revoked, 2500);
        assert_eq!(result, Err(VestingError::AlreadyRevoked));
    }

    #[test]
    fn accelerate_reduces_duration_h9() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 1_000_000, true).unwrap();
        let updated = accelerate(&s, 2500).unwrap(); // 25% reduction
        assert!(updated.duration_blocks < s.duration_blocks);
        assert_eq!(updated.duration_blocks, 750_000);
    }

    #[test]
    fn extend_zero_blocks_h9() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 1_000_000, true).unwrap();
        let result = extend(&s, 0);
        assert_eq!(result, Err(VestingError::ZeroDuration));
    }

    #[test]
    fn extend_exceeds_max_h9() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, MAX_VESTING_DURATION - 100, true).unwrap();
        let result = extend(&s, 200);
        assert_eq!(result, Err(VestingError::ExceedsMaxDuration));
    }

    #[test]
    fn extend_revoked_h9() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 1_000_000, true).unwrap();
        let (_, _, revoked) = revoke(&s, 500_000).unwrap();
        let result = extend(&revoked, 100_000);
        assert_eq!(result, Err(VestingError::AlreadyRevoked));
    }

    #[test]
    fn get_status_before_start_h9() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 100, 5_000, 1_000_000, true).unwrap();
        let status = get_status(&s, 50);
        assert_eq!(status.vested_amount, 0);
        assert_eq!(status.claimable_amount, 0);
        assert!(!status.is_fully_vested);
    }

    #[test]
    fn summarize_empty_h9() {
        let summary = summarize(&[], 1000);
        assert_eq!(summary.total_allocated, 0);
        assert_eq!(summary.active_schedules, 0);
    }

    #[test]
    fn summarize_mixed_schedules_h9() {
        let s1 = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 1_000_000, true).unwrap();
        let s2 = create_linear(beneficiary_b(), HUNDRED_VIBE, 0, 5_000, 100_000, true).unwrap();
        let summary = summarize(&[s1, s2], 50_000);
        assert_eq!(summary.total_allocated, THOUSAND_VIBE + HUNDRED_VIBE);
        assert!(summary.total_vested > 0);
    }

    #[test]
    fn remaining_duration_fully_vested_h9() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 1_000_000, true).unwrap();
        assert_eq!(remaining_duration(&s, 2_000_000), 0);
    }

    #[test]
    fn remaining_duration_revoked_h9() {
        let s = create_linear(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 1_000_000, true).unwrap();
        let (_, _, revoked) = revoke(&s, 500_000).unwrap();
        assert_eq!(remaining_duration(&revoked, 600_000), 0);
    }

    #[test]
    fn milestone_create_empty_milestones_h9() {
        let result = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &[], true);
        assert_eq!(result, Err(VestingError::InvalidMilestone));
    }

    #[test]
    fn milestone_create_too_many_milestones_h9() {
        let milestones: Vec<(u64, u16)> = (1..=11).map(|i| (i * 1000, (i * 1000) as u16)).collect();
        let result = create_milestone(beneficiary_a(), THOUSAND_VIBE, 0, &milestones, true);
        assert_eq!(result, Err(VestingError::TooManyMilestones));
    }

    #[test]
    fn graded_zero_steps_h9() {
        let result = create_graded(beneficiary_a(), THOUSAND_VIBE, 0, 5_000, 1_000_000, 0, true);
        assert_eq!(result, Err(VestingError::ZeroDuration));
    }
}
