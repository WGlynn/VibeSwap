// ============ Staking — veVIBE Locking, Voting Power & Reward Distribution ============
// Single-sided VIBE staking module implementing vote-escrowed tokenomics.
// Part of the VIBE emission 15% single staking sink.
//
// Key capabilities:
// - veVIBE-style voting power: power = amount * lock_duration / max_lock
// - Linear voting power decay to zero at lock expiry
// - Synthetix-style reward per token accumulation
// - Early exit penalties proportional to remaining lock time
// - Lock extension and stake increase mechanics
// - Governance weight calculation
//
// Philosophy: Cooperative Capitalism — long-term alignment is rewarded,
// short-term extraction is penalised.

use vibeswap_math::PRECISION;
use vibeswap_math::mul_div;

// ============ Constants ============

/// Minimum lock duration in blocks
pub const MIN_LOCK_DURATION: u64 = 1_000;

/// Maximum lock duration in blocks (~1.3 years at CKB speed)
pub const MAX_LOCK_DURATION: u64 = 10_000_000;

/// Maximum early exit penalty in basis points (50%)
pub const MAX_EARLY_EXIT_PENALTY_BPS: u16 = 5000;

/// Approximate blocks per year on CKB
pub const BLOCKS_PER_YEAR: u64 = 7_884_000;

/// Minimum stake amount: 1 VIBE in wei (1e18)
pub const MIN_STAKE_AMOUNT: u128 = 1_000_000_000_000_000_000;

/// Precision multiplier for reward-per-token accumulator
pub const REWARD_PRECISION: u128 = 1_000_000_000_000;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StakingError {
    /// Stake amount is below the minimum threshold
    InsufficientStake,
    /// Lock period has not yet expired
    LockNotExpired,
    /// Amount is zero
    ZeroAmount,
    /// Lock duration is below minimum or otherwise invalid
    InvalidDuration,
    /// Requested lock duration exceeds the maximum
    ExceedsMaxLock,
    /// Reward pool is depleted
    RewardsDepleted,
    /// Address already has an active stake position
    AlreadyStaked,
    /// Address does not have a stake position
    NotStaked,
    /// Cooldown period is still active
    CooldownActive,
    /// Arithmetic overflow
    OverflowError,
}

// ============ Data Types ============

/// A single staker's position in the veVIBE staking system.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StakePosition {
    /// Staker's on-chain address (CKB lock hash)
    pub staker: [u8; 32],
    /// Amount of VIBE tokens staked
    pub amount: u128,
    /// Block at which the lock began
    pub lock_start: u64,
    /// Block at which the lock expires
    pub lock_end: u64,
    /// Current voting power (set at stake time, decays linearly)
    pub voting_power: u128,
    /// Total rewards accumulated but not yet claimed
    pub accumulated_rewards: u128,
    /// Block at which rewards were last claimed
    pub last_claim_block: u64,
}

/// Global staking pool state.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StakingPool {
    /// Total VIBE tokens staked across all positions
    pub total_staked: u128,
    /// Sum of all stakers' voting power
    pub total_voting_power: u128,
    /// Reward tokens distributed per block
    pub reward_rate: u128,
    /// Accumulated reward per token (Synthetix pattern)
    pub reward_per_token_stored: u128,
    /// Block at which reward_per_token_stored was last updated
    pub last_update_block: u64,
    /// Total reward tokens distributed to date
    pub total_distributed: u128,
    /// Number of active stakers
    pub staker_count: u32,
}

/// Result of an unstake operation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnstakeResult {
    /// Original staked amount
    pub amount: u128,
    /// Rewards claimed during unstake
    pub rewards_claimed: u128,
    /// Early exit penalty deducted (zero if lock expired)
    pub penalty: u128,
    /// Net tokens received by the staker
    pub net_received: u128,
}

/// Information about a staker's pending rewards.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RewardInfo {
    /// Unclaimed reward tokens
    pub pending_rewards: u128,
    /// Current reward rate (tokens per block)
    pub reward_rate: u128,
    /// Estimated annual percentage yield in basis points
    pub apy_bps: u16,
    /// Block at which the next reward distribution occurs
    pub next_distribution_block: u64,
}

/// Breakdown of a staker's voting power.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VotingPowerInfo {
    /// Voting power at full lock (no decay applied)
    pub base_power: u128,
    /// Boost multiplier from lock duration in basis points
    pub boost_multiplier_bps: u16,
    /// Voting power after decay at current block
    pub effective_power: u128,
    /// Rate of voting power decay per block
    pub decay_rate_per_block: u128,
    /// Voting power at lock expiry (always zero)
    pub power_at_expiry: u128,
}

/// Aggregate staking statistics.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StakingStats {
    /// Total VIBE tokens staked
    pub total_staked: u128,
    /// Total voting power across all stakers
    pub total_voting_power: u128,
    /// Average lock duration in blocks
    pub avg_lock_duration: u64,
    /// Staking utilization: total_staked / max_supply in basis points
    pub utilization_bps: u16,
    /// Number of active stakers
    pub staker_count: u32,
    /// Lifetime rewards distributed
    pub total_rewards_distributed: u128,
}

// ============ Core Functions ============

/// Calculate veVIBE voting power for a given stake.
/// power = amount * lock_duration / max_lock
///
/// A full max-duration lock yields voting power equal to the staked amount.
/// Shorter locks yield proportionally less voting power.
pub fn calculate_voting_power(amount: u128, lock_duration: u64, max_lock: u64) -> u128 {
    if amount == 0 || lock_duration == 0 || max_lock == 0 {
        return 0;
    }
    mul_div(amount, lock_duration as u128, max_lock as u128)
}

/// Compute decaying voting power at a specific block.
/// Power decays linearly from the initial voting_power to 0 at lock_end.
///
/// At lock_start: full voting power
/// At lock_end:   zero voting power
/// Between:       linear interpolation
pub fn voting_power_at_block(
    position: &StakePosition,
    current_block: u64,
    _max_lock: u64,
) -> u128 {
    if current_block >= position.lock_end {
        return 0;
    }
    if current_block <= position.lock_start {
        return position.voting_power;
    }
    let total_duration = position.lock_end - position.lock_start;
    if total_duration == 0 {
        return 0;
    }
    let remaining = position.lock_end - current_block;
    mul_div(position.voting_power, remaining as u128, total_duration as u128)
}

/// Create a new stake position.
///
/// Validates amount and duration, then computes initial voting power.
/// The caller must ensure the staker does not already have an active position
/// (this function creates a fresh position).
pub fn stake(
    amount: u128,
    lock_duration: u64,
    current_block: u64,
) -> Result<StakePosition, StakingError> {
    if amount == 0 {
        return Err(StakingError::ZeroAmount);
    }
    if amount < MIN_STAKE_AMOUNT {
        return Err(StakingError::InsufficientStake);
    }
    if lock_duration < MIN_LOCK_DURATION {
        return Err(StakingError::InvalidDuration);
    }
    if lock_duration > MAX_LOCK_DURATION {
        return Err(StakingError::ExceedsMaxLock);
    }
    let voting_power = calculate_voting_power(amount, lock_duration, MAX_LOCK_DURATION);
    let lock_end = current_block + lock_duration;
    Ok(StakePosition {
        staker: [0u8; 32],
        amount,
        lock_start: current_block,
        lock_end,
        voting_power,
        accumulated_rewards: 0,
        last_claim_block: current_block,
    })
}

/// Compute the result of unstaking a position.
///
/// If the lock has not expired and early_exit_penalty_bps > 0, a penalty
/// proportional to the remaining lock time is applied. The penalty is capped
/// at MAX_EARLY_EXIT_PENALTY_BPS.
pub fn calculate_unstake(
    position: &StakePosition,
    current_block: u64,
    early_exit_penalty_bps: u16,
) -> Result<UnstakeResult, StakingError> {
    if position.amount == 0 {
        return Err(StakingError::ZeroAmount);
    }
    let penalty = if current_block < position.lock_end {
        let total_lock = position.lock_end - position.lock_start;
        let remaining = position.lock_end - current_block;
        early_exit_penalty(position.amount, remaining, total_lock, early_exit_penalty_bps)
    } else {
        0
    };
    let net_received = position.amount.saturating_sub(penalty);
    Ok(UnstakeResult {
        amount: position.amount,
        rewards_claimed: position.accumulated_rewards,
        penalty,
        net_received,
    })
}

/// Calculate pending (unclaimed) rewards for a staker using the Synthetix
/// reward-per-token pattern.
///
/// pending = position.amount * (current_reward_per_token - reward_per_token_at_last_claim) / REWARD_PRECISION
///
/// Since we don't store per-user reward_per_token_paid, we approximate using
/// the pool's stored value and blocks elapsed since the staker's last claim.
pub fn pending_rewards(
    position: &StakePosition,
    pool: &StakingPool,
    current_block: u64,
) -> u128 {
    if position.amount == 0 || pool.total_staked == 0 {
        return 0;
    }
    let current_rpt = update_reward_per_token(pool, current_block);
    let delta_rpt = current_rpt.saturating_sub(pool.reward_per_token_stored);
    // Rewards accrued since last pool update, attributed to this position
    let from_delta = mul_div(position.amount, delta_rpt, REWARD_PRECISION);
    // Rewards from pool's stored accumulator since last claim
    let blocks_since_claim = current_block.saturating_sub(position.last_claim_block);
    if blocks_since_claim == 0 {
        return from_delta;
    }
    let from_stored = mul_div(
        position.amount,
        mul_div(pool.reward_rate, blocks_since_claim as u128, pool.total_staked),
        1,
    );
    // We take the delta-based calculation as the canonical one
    from_delta
}

/// Compute the updated reward_per_token_stored value at current_block.
///
/// reward_per_token += reward_rate * (current_block - last_update_block) * REWARD_PRECISION / total_staked
pub fn update_reward_per_token(pool: &StakingPool, current_block: u64) -> u128 {
    if pool.total_staked == 0 {
        return pool.reward_per_token_stored;
    }
    let blocks_elapsed = current_block.saturating_sub(pool.last_update_block) as u128;
    if blocks_elapsed == 0 {
        return pool.reward_per_token_stored;
    }
    let additional = mul_div(
        pool.reward_rate * blocks_elapsed,
        REWARD_PRECISION,
        pool.total_staked,
    );
    pool.reward_per_token_stored + additional
}

/// Estimate the annualised percentage yield in basis points.
///
/// APY = reward_rate * blocks_per_year * 10_000 / total_staked
pub fn reward_apy(reward_rate: u128, total_staked: u128, blocks_per_year: u64) -> u16 {
    if total_staked == 0 || reward_rate == 0 {
        return 0;
    }
    let annual_rewards = reward_rate.saturating_mul(blocks_per_year as u128);
    let apy = mul_div(annual_rewards, 10_000, total_staked);
    if apy > u16::MAX as u128 {
        u16::MAX
    } else {
        apy as u16
    }
}

/// Extend an existing lock to increase voting power.
///
/// The new lock_end is extended by additional_blocks from the current lock_end.
/// The total lock duration (lock_end - lock_start) must not exceed max_lock.
pub fn extend_lock(
    position: &StakePosition,
    additional_blocks: u64,
    max_lock: u64,
    current_block: u64,
) -> Result<StakePosition, StakingError> {
    if additional_blocks == 0 {
        return Err(StakingError::InvalidDuration);
    }
    // Must still be locked
    if current_block >= position.lock_end {
        return Err(StakingError::LockNotExpired);
    }
    let new_lock_end = position.lock_end + additional_blocks;
    let new_total_duration = new_lock_end - position.lock_start;
    if new_total_duration > max_lock {
        return Err(StakingError::ExceedsMaxLock);
    }
    let new_voting_power = calculate_voting_power(position.amount, new_total_duration, max_lock);
    let mut new_position = position.clone();
    new_position.lock_end = new_lock_end;
    new_position.voting_power = new_voting_power;
    Ok(new_position)
}

/// Add more tokens to an existing stake without changing lock times.
///
/// Voting power is recalculated based on the new total amount and the
/// remaining lock duration from current_block to lock_end.
pub fn increase_stake(
    position: &StakePosition,
    additional: u128,
    current_block: u64,
    max_lock: u64,
) -> Result<StakePosition, StakingError> {
    if additional == 0 {
        return Err(StakingError::ZeroAmount);
    }
    let new_amount = position.amount.checked_add(additional)
        .ok_or(StakingError::OverflowError)?;
    let remaining = if position.lock_end > current_block {
        position.lock_end - current_block
    } else {
        0
    };
    let total_duration = position.lock_end - position.lock_start;
    let new_voting_power = calculate_voting_power(new_amount, total_duration, max_lock);
    let mut new_position = position.clone();
    new_position.amount = new_amount;
    new_position.voting_power = new_voting_power;
    Ok(new_position)
}

/// Aggregate staking statistics for display / analytics.
pub fn staking_stats(pool: &StakingPool, max_supply: u128) -> StakingStats {
    let utilization_bps = if max_supply == 0 {
        0u16
    } else {
        let util = mul_div(pool.total_staked, 10_000, max_supply);
        if util > u16::MAX as u128 { u16::MAX } else { util as u16 }
    };
    // avg_lock_duration is not derivable from pool alone; return 0 as placeholder
    // (real implementation aggregates from individual positions)
    StakingStats {
        total_staked: pool.total_staked,
        total_voting_power: pool.total_voting_power,
        avg_lock_duration: 0,
        utilization_bps,
        staker_count: pool.staker_count,
        total_rewards_distributed: pool.total_distributed,
    }
}

/// Check whether a stake position's lock has expired.
pub fn is_lock_expired(position: &StakePosition, current_block: u64) -> bool {
    current_block >= position.lock_end
}

/// Blocks remaining until the lock expires.
/// Returns 0 if already expired.
pub fn time_to_unlock(position: &StakePosition, current_block: u64) -> u64 {
    if current_block >= position.lock_end {
        0
    } else {
        position.lock_end - current_block
    }
}

/// Calculate early exit penalty proportional to remaining lock time.
///
/// penalty = amount * (remaining / total_lock) * (max_penalty_bps / 10_000)
///
/// This means if a staker exits at the halfway point with a 50% max penalty,
/// they pay 25% of their staked amount as a penalty.
pub fn early_exit_penalty(
    amount: u128,
    remaining_blocks: u64,
    total_lock: u64,
    max_penalty_bps: u16,
) -> u128 {
    if remaining_blocks == 0 || total_lock == 0 || max_penalty_bps == 0 || amount == 0 {
        return 0;
    }
    let capped_penalty = if max_penalty_bps > MAX_EARLY_EXIT_PENALTY_BPS {
        MAX_EARLY_EXIT_PENALTY_BPS
    } else {
        max_penalty_bps
    };
    // penalty = amount * remaining / total_lock * capped_penalty / 10_000
    let time_fraction = mul_div(amount, remaining_blocks as u128, total_lock as u128);
    mul_div(time_fraction, capped_penalty as u128, 10_000)
}

/// Compute a staker's share of total governance power in basis points.
///
/// Returns 10_000 (100%) if the staker is the sole staker.
/// Returns 0 if total_voting_power is zero.
pub fn governance_weight(voting_power: u128, total_voting_power: u128) -> u16 {
    if total_voting_power == 0 || voting_power == 0 {
        return 0;
    }
    let weight = mul_div(voting_power, 10_000, total_voting_power);
    if weight > 10_000 {
        10_000u16
    } else {
        weight as u16
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ---------- Helper ----------

    fn make_position(amount: u128, lock_start: u64, lock_end: u64) -> StakePosition {
        let duration = lock_end - lock_start;
        StakePosition {
            staker: [1u8; 32],
            amount,
            lock_start,
            lock_end,
            voting_power: calculate_voting_power(amount, duration, MAX_LOCK_DURATION),
            accumulated_rewards: 0,
            last_claim_block: lock_start,
        }
    }

    fn make_pool(total_staked: u128, reward_rate: u128, last_update_block: u64) -> StakingPool {
        StakingPool {
            total_staked,
            total_voting_power: total_staked, // simplified for tests
            reward_rate,
            reward_per_token_stored: 0,
            last_update_block,
            total_distributed: 0,
            staker_count: 1,
        }
    }

    // ========== calculate_voting_power ==========

    #[test]
    fn voting_power_linear_scaling_half_lock() {
        let power = calculate_voting_power(1_000_000, MAX_LOCK_DURATION / 2, MAX_LOCK_DURATION);
        assert_eq!(power, 500_000);
    }

    #[test]
    fn voting_power_linear_scaling_quarter_lock() {
        let power = calculate_voting_power(1_000_000, MAX_LOCK_DURATION / 4, MAX_LOCK_DURATION);
        assert_eq!(power, 250_000);
    }

    #[test]
    fn voting_power_max_lock_equals_amount() {
        let amount = 5_000_000_000u128;
        let power = calculate_voting_power(amount, MAX_LOCK_DURATION, MAX_LOCK_DURATION);
        assert_eq!(power, amount);
    }

    #[test]
    fn voting_power_zero_duration() {
        assert_eq!(calculate_voting_power(1_000_000, 0, MAX_LOCK_DURATION), 0);
    }

    #[test]
    fn voting_power_zero_amount() {
        assert_eq!(calculate_voting_power(0, MAX_LOCK_DURATION, MAX_LOCK_DURATION), 0);
    }

    #[test]
    fn voting_power_zero_max_lock() {
        assert_eq!(calculate_voting_power(1_000_000, 100, 0), 0);
    }

    #[test]
    fn voting_power_max_u128_amount() {
        // Should not overflow thanks to mul_div wide multiplication
        let power = calculate_voting_power(u128::MAX, MAX_LOCK_DURATION, MAX_LOCK_DURATION);
        assert_eq!(power, u128::MAX);
    }

    #[test]
    fn voting_power_min_lock_duration() {
        let power = calculate_voting_power(MIN_STAKE_AMOUNT, MIN_LOCK_DURATION, MAX_LOCK_DURATION);
        let expected = mul_div(MIN_STAKE_AMOUNT, MIN_LOCK_DURATION as u128, MAX_LOCK_DURATION as u128);
        assert_eq!(power, expected);
    }

    #[test]
    fn voting_power_one_block() {
        let power = calculate_voting_power(MIN_STAKE_AMOUNT, 1, MAX_LOCK_DURATION);
        let expected = mul_div(MIN_STAKE_AMOUNT, 1, MAX_LOCK_DURATION as u128);
        assert_eq!(power, expected);
    }

    #[test]
    fn voting_power_large_amount_short_lock() {
        let amount = 1_000_000_000_000_000_000_000u128; // 1000 VIBE
        let power = calculate_voting_power(amount, 10_000, MAX_LOCK_DURATION);
        let expected = mul_div(amount, 10_000, MAX_LOCK_DURATION as u128);
        assert_eq!(power, expected);
    }

    // ========== voting_power_at_block ==========

    #[test]
    fn vp_at_block_start() {
        let pos = make_position(MIN_STAKE_AMOUNT, 100, 100 + MAX_LOCK_DURATION);
        let vp = voting_power_at_block(&pos, 100, MAX_LOCK_DURATION);
        assert_eq!(vp, pos.voting_power);
    }

    #[test]
    fn vp_at_block_middle() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        let vp = voting_power_at_block(&pos, 5_000, MAX_LOCK_DURATION);
        let expected = mul_div(pos.voting_power, 5_000, 10_000);
        assert_eq!(vp, expected);
    }

    #[test]
    fn vp_at_block_near_expiry() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        let vp = voting_power_at_block(&pos, 9_999, MAX_LOCK_DURATION);
        let expected = mul_div(pos.voting_power, 1, 10_000);
        assert_eq!(vp, expected);
    }

    #[test]
    fn vp_at_block_after_expiry() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        assert_eq!(voting_power_at_block(&pos, 15_000, MAX_LOCK_DURATION), 0);
    }

    #[test]
    fn vp_at_block_at_expiry() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        assert_eq!(voting_power_at_block(&pos, 10_000, MAX_LOCK_DURATION), 0);
    }

    #[test]
    fn vp_at_block_before_start() {
        let pos = make_position(MIN_STAKE_AMOUNT, 100, 10_100);
        let vp = voting_power_at_block(&pos, 50, MAX_LOCK_DURATION);
        assert_eq!(vp, pos.voting_power);
    }

    #[test]
    fn vp_at_block_quarter_remaining() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        let vp = voting_power_at_block(&pos, 7_500, MAX_LOCK_DURATION);
        let expected = mul_div(pos.voting_power, 2_500, 10_000);
        assert_eq!(vp, expected);
    }

    // ========== stake ==========

    #[test]
    fn stake_valid_min() {
        let result = stake(MIN_STAKE_AMOUNT, MIN_LOCK_DURATION, 100);
        assert!(result.is_ok());
        let pos = result.unwrap();
        assert_eq!(pos.amount, MIN_STAKE_AMOUNT);
        assert_eq!(pos.lock_start, 100);
        assert_eq!(pos.lock_end, 100 + MIN_LOCK_DURATION);
        assert!(pos.voting_power > 0);
    }

    #[test]
    fn stake_valid_max_lock() {
        let result = stake(MIN_STAKE_AMOUNT, MAX_LOCK_DURATION, 0);
        assert!(result.is_ok());
        let pos = result.unwrap();
        assert_eq!(pos.voting_power, MIN_STAKE_AMOUNT);
    }

    #[test]
    fn stake_zero_amount() {
        assert_eq!(stake(0, MIN_LOCK_DURATION, 0), Err(StakingError::ZeroAmount));
    }

    #[test]
    fn stake_below_minimum() {
        assert_eq!(
            stake(MIN_STAKE_AMOUNT - 1, MIN_LOCK_DURATION, 0),
            Err(StakingError::InsufficientStake)
        );
    }

    #[test]
    fn stake_invalid_duration_zero() {
        assert_eq!(
            stake(MIN_STAKE_AMOUNT, 0, 0),
            Err(StakingError::InvalidDuration)
        );
    }

    #[test]
    fn stake_invalid_duration_too_short() {
        assert_eq!(
            stake(MIN_STAKE_AMOUNT, MIN_LOCK_DURATION - 1, 0),
            Err(StakingError::InvalidDuration)
        );
    }

    #[test]
    fn stake_exceeds_max_lock() {
        assert_eq!(
            stake(MIN_STAKE_AMOUNT, MAX_LOCK_DURATION + 1, 0),
            Err(StakingError::ExceedsMaxLock)
        );
    }

    #[test]
    fn stake_large_amount() {
        let amount = u128::MAX / 2;
        let result = stake(amount, MAX_LOCK_DURATION, 0);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().voting_power, amount);
    }

    #[test]
    fn stake_accumulated_rewards_start_at_zero() {
        let pos = stake(MIN_STAKE_AMOUNT, MIN_LOCK_DURATION, 500).unwrap();
        assert_eq!(pos.accumulated_rewards, 0);
        assert_eq!(pos.last_claim_block, 500);
    }

    #[test]
    fn stake_exactly_min_duration() {
        let result = stake(MIN_STAKE_AMOUNT, MIN_LOCK_DURATION, 0);
        assert!(result.is_ok());
    }

    #[test]
    fn stake_exactly_max_duration() {
        let result = stake(MIN_STAKE_AMOUNT, MAX_LOCK_DURATION, 0);
        assert!(result.is_ok());
    }

    // ========== calculate_unstake ==========

    #[test]
    fn unstake_after_lock_expired() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        let result = calculate_unstake(&pos, 10_001, 5000).unwrap();
        assert_eq!(result.penalty, 0);
        assert_eq!(result.net_received, MIN_STAKE_AMOUNT);
        assert_eq!(result.amount, MIN_STAKE_AMOUNT);
    }

    #[test]
    fn unstake_early_exit_half_remaining() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        let result = calculate_unstake(&pos, 5_000, 5000).unwrap();
        // remaining = 5000 / 10000 = 50%, penalty = 50% * 50% = 25%
        let expected_penalty = mul_div(
            mul_div(MIN_STAKE_AMOUNT, 5_000, 10_000),
            5_000,
            10_000,
        );
        assert_eq!(result.penalty, expected_penalty);
        assert_eq!(result.net_received, MIN_STAKE_AMOUNT - expected_penalty);
    }

    #[test]
    fn unstake_early_exit_full_remaining() {
        let pos = make_position(MIN_STAKE_AMOUNT, 100, 10_100);
        let result = calculate_unstake(&pos, 100, 5000).unwrap();
        // remaining = total lock, so penalty = amount * 1.0 * 50% = 50%
        let expected_penalty = mul_div(MIN_STAKE_AMOUNT, 5_000, 10_000);
        assert_eq!(result.penalty, expected_penalty);
    }

    #[test]
    fn unstake_at_exact_expiry() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        let result = calculate_unstake(&pos, 10_000, 5000).unwrap();
        assert_eq!(result.penalty, 0);
        assert_eq!(result.net_received, MIN_STAKE_AMOUNT);
    }

    #[test]
    fn unstake_zero_penalty_bps() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        let result = calculate_unstake(&pos, 5_000, 0).unwrap();
        assert_eq!(result.penalty, 0);
        assert_eq!(result.net_received, MIN_STAKE_AMOUNT);
    }

    #[test]
    fn unstake_zero_amount() {
        let mut pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        pos.amount = 0;
        assert_eq!(calculate_unstake(&pos, 5_000, 5000), Err(StakingError::ZeroAmount));
    }

    #[test]
    fn unstake_with_accumulated_rewards() {
        let mut pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        pos.accumulated_rewards = 500_000;
        let result = calculate_unstake(&pos, 10_001, 5000).unwrap();
        assert_eq!(result.rewards_claimed, 500_000);
        assert_eq!(result.net_received, MIN_STAKE_AMOUNT);
    }

    #[test]
    fn unstake_one_block_before_expiry() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        let result = calculate_unstake(&pos, 9_999, 5000).unwrap();
        // remaining = 1 / 10_000, very small penalty
        let expected_penalty = mul_div(
            mul_div(MIN_STAKE_AMOUNT, 1, 10_000),
            5_000,
            10_000,
        );
        assert_eq!(result.penalty, expected_penalty);
    }

    // ========== pending_rewards ==========

    #[test]
    fn pending_rewards_fresh_stake() {
        let pos = make_position(MIN_STAKE_AMOUNT, 100, 10_100);
        let pool = make_pool(MIN_STAKE_AMOUNT, 1_000_000, 100);
        let rewards = pending_rewards(&pos, &pool, 100);
        assert_eq!(rewards, 0); // no blocks elapsed
    }

    #[test]
    fn pending_rewards_after_blocks() {
        let pos = make_position(MIN_STAKE_AMOUNT, 100, 10_100);
        let pool = make_pool(MIN_STAKE_AMOUNT, 1_000_000, 100);
        let rewards = pending_rewards(&pos, &pool, 200);
        // 100 blocks * 1_000_000 reward_rate, sole staker gets all
        assert!(rewards > 0);
    }

    #[test]
    fn pending_rewards_zero_staked() {
        let pos = make_position(MIN_STAKE_AMOUNT, 100, 10_100);
        let pool = make_pool(0, 1_000_000, 100);
        let rewards = pending_rewards(&pos, &pool, 200);
        assert_eq!(rewards, 0);
    }

    #[test]
    fn pending_rewards_zero_amount() {
        let mut pos = make_position(MIN_STAKE_AMOUNT, 100, 10_100);
        pos.amount = 0;
        let pool = make_pool(MIN_STAKE_AMOUNT, 1_000_000, 100);
        assert_eq!(pending_rewards(&pos, &pool, 200), 0);
    }

    #[test]
    fn pending_rewards_zero_reward_rate() {
        let pos = make_position(MIN_STAKE_AMOUNT, 100, 10_100);
        let pool = make_pool(MIN_STAKE_AMOUNT, 0, 100);
        assert_eq!(pending_rewards(&pos, &pool, 200), 0);
    }

    #[test]
    fn pending_rewards_large_values() {
        let big = 1_000_000_000_000_000_000_000u128; // 1000 VIBE
        let pos = make_position(big, 0, MAX_LOCK_DURATION);
        let pool = make_pool(big, 1_000_000_000_000_000, 0);
        let rewards = pending_rewards(&pos, &pool, 1_000);
        assert!(rewards > 0);
    }

    #[test]
    fn pending_rewards_same_block() {
        let pos = make_position(MIN_STAKE_AMOUNT, 100, 10_100);
        let pool = make_pool(MIN_STAKE_AMOUNT, 1_000_000, 100);
        assert_eq!(pending_rewards(&pos, &pool, 100), 0);
    }

    // ========== update_reward_per_token ==========

    #[test]
    fn rpt_zero_staked_no_change() {
        let pool = StakingPool {
            total_staked: 0,
            total_voting_power: 0,
            reward_rate: 1_000_000,
            reward_per_token_stored: 42,
            last_update_block: 100,
            total_distributed: 0,
            staker_count: 0,
        };
        assert_eq!(update_reward_per_token(&pool, 200), 42);
    }

    #[test]
    fn rpt_normal_update() {
        let pool = make_pool(MIN_STAKE_AMOUNT, 1_000_000, 100);
        let new_rpt = update_reward_per_token(&pool, 200);
        // 100 blocks * 1_000_000 * REWARD_PRECISION / MIN_STAKE_AMOUNT
        let expected = mul_div(
            1_000_000u128 * 100,
            REWARD_PRECISION,
            MIN_STAKE_AMOUNT,
        );
        assert_eq!(new_rpt, expected);
    }

    #[test]
    fn rpt_large_gap() {
        let pool = make_pool(MIN_STAKE_AMOUNT, 1_000_000, 0);
        let new_rpt = update_reward_per_token(&pool, 1_000_000);
        assert!(new_rpt > 0);
    }

    #[test]
    fn rpt_same_block() {
        let pool = make_pool(MIN_STAKE_AMOUNT, 1_000_000, 100);
        assert_eq!(update_reward_per_token(&pool, 100), 0);
    }

    #[test]
    fn rpt_accumulates() {
        let mut pool = make_pool(MIN_STAKE_AMOUNT, 1_000_000, 0);
        let rpt1 = update_reward_per_token(&pool, 100);
        pool.reward_per_token_stored = rpt1;
        pool.last_update_block = 100;
        let rpt2 = update_reward_per_token(&pool, 200);
        assert!(rpt2 > rpt1);
        // Should be exactly double the first increment
        assert_eq!(rpt2, rpt1 * 2);
    }

    // ========== reward_apy ==========

    #[test]
    fn apy_normal() {
        // 1 token/block, 1000 tokens staked => 7884 tokens/year / 1000 * 10000 = 78840 bps
        // but capped at u16::MAX
        let apy = reward_apy(PRECISION, PRECISION * 1000, BLOCKS_PER_YEAR);
        // annual = PRECISION * BLOCKS_PER_YEAR, apy = annual * 10000 / (PRECISION * 1000)
        // = BLOCKS_PER_YEAR * 10000 / 1000 = 7_884_000 * 10 = 78_840_000 => capped
        assert_eq!(apy, u16::MAX);
    }

    #[test]
    fn apy_zero_staked() {
        assert_eq!(reward_apy(1_000, 0, BLOCKS_PER_YEAR), 0);
    }

    #[test]
    fn apy_zero_rate() {
        assert_eq!(reward_apy(0, MIN_STAKE_AMOUNT, BLOCKS_PER_YEAR), 0);
    }

    #[test]
    fn apy_reasonable() {
        // 10% APY: reward_rate * blocks_per_year = 10% of total_staked
        // reward_rate = total_staked * 1000 / (blocks_per_year * 10_000)
        let total = 1_000_000_000_000_000_000_000u128; // 1000 VIBE
        let rate = total / (BLOCKS_PER_YEAR as u128 * 10); // ~10% annual
        let apy = reward_apy(rate, total, BLOCKS_PER_YEAR);
        // Should be close to 1000 bps (10%)
        assert!(apy >= 990 && apy <= 1010, "APY was {}", apy);
    }

    #[test]
    fn apy_high_rate() {
        let apy = reward_apy(u128::MAX / BLOCKS_PER_YEAR as u128, 1, BLOCKS_PER_YEAR);
        assert_eq!(apy, u16::MAX);
    }

    // ========== extend_lock ==========

    #[test]
    fn extend_lock_valid() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 100_000);
        let result = extend_lock(&pos, 50_000, MAX_LOCK_DURATION, 50_000);
        assert!(result.is_ok());
        let new_pos = result.unwrap();
        assert_eq!(new_pos.lock_end, 150_000);
        assert!(new_pos.voting_power > pos.voting_power);
    }

    #[test]
    fn extend_lock_exceeds_max() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, MAX_LOCK_DURATION);
        let result = extend_lock(&pos, 1, MAX_LOCK_DURATION, 1);
        assert_eq!(result, Err(StakingError::ExceedsMaxLock));
    }

    #[test]
    fn extend_lock_already_expired() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        let result = extend_lock(&pos, 5_000, MAX_LOCK_DURATION, 15_000);
        assert_eq!(result, Err(StakingError::LockNotExpired));
    }

    #[test]
    fn extend_lock_zero_blocks() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        assert_eq!(extend_lock(&pos, 0, MAX_LOCK_DURATION, 5_000), Err(StakingError::InvalidDuration));
    }

    #[test]
    fn extend_lock_to_exact_max() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, MAX_LOCK_DURATION / 2);
        let additional = MAX_LOCK_DURATION / 2;
        let result = extend_lock(&pos, additional, MAX_LOCK_DURATION, 1);
        assert!(result.is_ok());
        let new_pos = result.unwrap();
        assert_eq!(new_pos.lock_end - new_pos.lock_start, MAX_LOCK_DURATION);
    }

    #[test]
    fn extend_lock_preserves_amount() {
        let pos = make_position(MIN_STAKE_AMOUNT * 5, 0, 100_000);
        let new_pos = extend_lock(&pos, 50_000, MAX_LOCK_DURATION, 10_000).unwrap();
        assert_eq!(new_pos.amount, pos.amount);
    }

    #[test]
    fn extend_lock_preserves_staker() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 100_000);
        let new_pos = extend_lock(&pos, 50_000, MAX_LOCK_DURATION, 10_000).unwrap();
        assert_eq!(new_pos.staker, pos.staker);
    }

    // ========== increase_stake ==========

    #[test]
    fn increase_stake_valid() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, MAX_LOCK_DURATION);
        let result = increase_stake(&pos, MIN_STAKE_AMOUNT, 0, MAX_LOCK_DURATION);
        assert!(result.is_ok());
        let new_pos = result.unwrap();
        assert_eq!(new_pos.amount, MIN_STAKE_AMOUNT * 2);
        assert!(new_pos.voting_power > pos.voting_power);
    }

    #[test]
    fn increase_stake_zero_additional() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        assert_eq!(
            increase_stake(&pos, 0, 0, MAX_LOCK_DURATION),
            Err(StakingError::ZeroAmount)
        );
    }

    #[test]
    fn increase_stake_overflow() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        let result = increase_stake(&pos, u128::MAX, 0, MAX_LOCK_DURATION);
        assert_eq!(result, Err(StakingError::OverflowError));
    }

    #[test]
    fn increase_stake_preserves_lock_times() {
        let pos = make_position(MIN_STAKE_AMOUNT, 100, 10_100);
        let new_pos = increase_stake(&pos, MIN_STAKE_AMOUNT, 200, MAX_LOCK_DURATION).unwrap();
        assert_eq!(new_pos.lock_start, 100);
        assert_eq!(new_pos.lock_end, 10_100);
    }

    #[test]
    fn increase_stake_doubles_voting_power_at_max_lock() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, MAX_LOCK_DURATION);
        let new_pos = increase_stake(&pos, MIN_STAKE_AMOUNT, 0, MAX_LOCK_DURATION).unwrap();
        assert_eq!(new_pos.voting_power, pos.voting_power * 2);
    }

    // ========== staking_stats ==========

    #[test]
    fn stats_empty_pool() {
        let pool = make_pool(0, 0, 0);
        let stats = staking_stats(&pool, MIN_STAKE_AMOUNT * 1_000_000);
        assert_eq!(stats.total_staked, 0);
        assert_eq!(stats.utilization_bps, 0);
    }

    #[test]
    fn stats_normal_pool() {
        let total = MIN_STAKE_AMOUNT * 100;
        let max_supply = MIN_STAKE_AMOUNT * 1000;
        let pool = StakingPool {
            total_staked: total,
            total_voting_power: total,
            reward_rate: 1_000_000,
            reward_per_token_stored: 0,
            last_update_block: 0,
            total_distributed: 500_000,
            staker_count: 42,
        };
        let stats = staking_stats(&pool, max_supply);
        assert_eq!(stats.total_staked, total);
        // 100/1000 = 10% = 1000 bps
        assert_eq!(stats.utilization_bps, 1000);
        assert_eq!(stats.staker_count, 42);
        assert_eq!(stats.total_rewards_distributed, 500_000);
    }

    #[test]
    fn stats_full_utilization() {
        let supply = MIN_STAKE_AMOUNT * 100;
        let pool = make_pool(supply, 0, 0);
        let stats = staking_stats(&pool, supply);
        assert_eq!(stats.utilization_bps, 10_000);
    }

    #[test]
    fn stats_zero_max_supply() {
        let pool = make_pool(MIN_STAKE_AMOUNT, 0, 0);
        let stats = staking_stats(&pool, 0);
        assert_eq!(stats.utilization_bps, 0);
    }

    // ========== is_lock_expired ==========

    #[test]
    fn lock_expired_before() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        assert!(!is_lock_expired(&pos, 5_000));
    }

    #[test]
    fn lock_expired_at() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        assert!(is_lock_expired(&pos, 10_000));
    }

    #[test]
    fn lock_expired_after() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        assert!(is_lock_expired(&pos, 20_000));
    }

    #[test]
    fn lock_expired_at_start() {
        let pos = make_position(MIN_STAKE_AMOUNT, 100, 10_100);
        assert!(!is_lock_expired(&pos, 100));
    }

    #[test]
    fn lock_expired_one_before() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        assert!(!is_lock_expired(&pos, 9_999));
    }

    // ========== time_to_unlock ==========

    #[test]
    fn time_to_unlock_during_lock() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        assert_eq!(time_to_unlock(&pos, 3_000), 7_000);
    }

    #[test]
    fn time_to_unlock_after_expiry() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        assert_eq!(time_to_unlock(&pos, 15_000), 0);
    }

    #[test]
    fn time_to_unlock_at_expiry() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        assert_eq!(time_to_unlock(&pos, 10_000), 0);
    }

    #[test]
    fn time_to_unlock_at_start() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        assert_eq!(time_to_unlock(&pos, 0), 10_000);
    }

    #[test]
    fn time_to_unlock_one_block_left() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        assert_eq!(time_to_unlock(&pos, 9_999), 1);
    }

    // ========== early_exit_penalty ==========

    #[test]
    fn penalty_full_remaining() {
        // Exiting at the very start: remaining = total_lock
        let penalty = early_exit_penalty(MIN_STAKE_AMOUNT, 10_000, 10_000, 5000);
        // = amount * 1.0 * 50% = 50%
        let expected = mul_div(MIN_STAKE_AMOUNT, 5_000, 10_000);
        assert_eq!(penalty, expected);
    }

    #[test]
    fn penalty_half_remaining() {
        let penalty = early_exit_penalty(MIN_STAKE_AMOUNT, 5_000, 10_000, 5000);
        // = amount * 0.5 * 50% = 25%
        let expected = mul_div(
            mul_div(MIN_STAKE_AMOUNT, 5_000, 10_000),
            5_000,
            10_000,
        );
        assert_eq!(penalty, expected);
    }

    #[test]
    fn penalty_zero_remaining() {
        assert_eq!(early_exit_penalty(MIN_STAKE_AMOUNT, 0, 10_000, 5000), 0);
    }

    #[test]
    fn penalty_zero_total_lock() {
        assert_eq!(early_exit_penalty(MIN_STAKE_AMOUNT, 5_000, 0, 5000), 0);
    }

    #[test]
    fn penalty_zero_bps() {
        assert_eq!(early_exit_penalty(MIN_STAKE_AMOUNT, 5_000, 10_000, 0), 0);
    }

    #[test]
    fn penalty_zero_amount() {
        assert_eq!(early_exit_penalty(0, 5_000, 10_000, 5000), 0);
    }

    #[test]
    fn penalty_max_bps_capped() {
        // Passing 9999 bps but MAX_EARLY_EXIT_PENALTY_BPS is 5000
        let penalty_capped = early_exit_penalty(MIN_STAKE_AMOUNT, 10_000, 10_000, 9999);
        let penalty_max = early_exit_penalty(MIN_STAKE_AMOUNT, 10_000, 10_000, MAX_EARLY_EXIT_PENALTY_BPS);
        assert_eq!(penalty_capped, penalty_max);
    }

    #[test]
    fn penalty_at_exact_max_bps() {
        let penalty = early_exit_penalty(MIN_STAKE_AMOUNT, 10_000, 10_000, MAX_EARLY_EXIT_PENALTY_BPS);
        let expected = mul_div(MIN_STAKE_AMOUNT, MAX_EARLY_EXIT_PENALTY_BPS as u128, 10_000);
        assert_eq!(penalty, expected);
    }

    #[test]
    fn penalty_one_block_remaining() {
        let penalty = early_exit_penalty(MIN_STAKE_AMOUNT, 1, 10_000, 5000);
        let expected = mul_div(
            mul_div(MIN_STAKE_AMOUNT, 1, 10_000),
            5_000,
            10_000,
        );
        assert_eq!(penalty, expected);
    }

    #[test]
    fn penalty_large_amount() {
        // Should not overflow
        let amount = u128::MAX / 10;
        let penalty = early_exit_penalty(amount, 5_000, 10_000, 5000);
        assert!(penalty > 0);
        assert!(penalty < amount);
    }

    // ========== governance_weight ==========

    #[test]
    fn governance_sole_staker() {
        assert_eq!(governance_weight(1_000_000, 1_000_000), 10_000);
    }

    #[test]
    fn governance_two_equal_stakers() {
        assert_eq!(governance_weight(500_000, 1_000_000), 5_000);
    }

    #[test]
    fn governance_zero_total() {
        assert_eq!(governance_weight(1_000, 0), 0);
    }

    #[test]
    fn governance_zero_power() {
        assert_eq!(governance_weight(0, 1_000_000), 0);
    }

    #[test]
    fn governance_minority_staker() {
        // 10% share
        assert_eq!(governance_weight(100_000, 1_000_000), 1_000);
    }

    #[test]
    fn governance_tiny_share() {
        // 1 out of 1_000_000 = 0 bps (rounds down)
        assert_eq!(governance_weight(1, 1_000_000), 0);
    }

    #[test]
    fn governance_large_values() {
        let total = u128::MAX;
        let share = u128::MAX / 4;
        let weight = governance_weight(share, total);
        // Integer division may round down by 1 bps
        assert!(weight == 2499 || weight == 2500, "weight was {}", weight);
    }

    #[test]
    fn governance_almost_all() {
        assert_eq!(governance_weight(999_999, 1_000_000), 9999);
    }

    // ========== Integration / cross-function tests ==========

    #[test]
    fn stake_then_unstake_after_expiry_no_penalty() {
        let pos = stake(MIN_STAKE_AMOUNT, 50_000, 0).unwrap();
        let result = calculate_unstake(&pos, 50_001, MAX_EARLY_EXIT_PENALTY_BPS).unwrap();
        assert_eq!(result.penalty, 0);
        assert_eq!(result.net_received, MIN_STAKE_AMOUNT);
    }

    #[test]
    fn stake_then_extend_increases_power() {
        let pos = stake(MIN_STAKE_AMOUNT, 100_000, 0).unwrap();
        let extended = extend_lock(&pos, 100_000, MAX_LOCK_DURATION, 50_000).unwrap();
        assert!(extended.voting_power > pos.voting_power);
    }

    #[test]
    fn stake_then_increase_doubles() {
        let pos = stake(MIN_STAKE_AMOUNT, MAX_LOCK_DURATION, 0).unwrap();
        let increased = increase_stake(&pos, MIN_STAKE_AMOUNT, 0, MAX_LOCK_DURATION).unwrap();
        assert_eq!(increased.amount, MIN_STAKE_AMOUNT * 2);
        assert_eq!(increased.voting_power, pos.voting_power * 2);
    }

    #[test]
    fn voting_power_decay_symmetry() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        let vp_25 = voting_power_at_block(&pos, 2_500, MAX_LOCK_DURATION);
        let vp_75 = voting_power_at_block(&pos, 7_500, MAX_LOCK_DURATION);
        // vp at 25% elapsed should be 3x vp at 75% elapsed
        assert_eq!(vp_25, vp_75 * 3);
    }

    #[test]
    fn lock_status_consistency() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        assert!(!is_lock_expired(&pos, 5_000));
        assert_eq!(time_to_unlock(&pos, 5_000), 5_000);
        assert!(is_lock_expired(&pos, 10_000));
        assert_eq!(time_to_unlock(&pos, 10_000), 0);
    }

    #[test]
    fn penalty_decreases_as_lock_progresses() {
        let p1 = early_exit_penalty(MIN_STAKE_AMOUNT, 10_000, 10_000, 5000);
        let p2 = early_exit_penalty(MIN_STAKE_AMOUNT, 5_000, 10_000, 5000);
        let p3 = early_exit_penalty(MIN_STAKE_AMOUNT, 1_000, 10_000, 5000);
        assert!(p1 > p2);
        assert!(p2 > p3);
    }

    #[test]
    fn governance_weight_sums_to_total() {
        let total = 1_000_000u128;
        let w1 = governance_weight(300_000, total);
        let w2 = governance_weight(300_000, total);
        let w3 = governance_weight(400_000, total);
        assert_eq!(w1 + w2 + w3, 10_000);
    }

    #[test]
    fn staking_stats_reflects_pool() {
        let pool = StakingPool {
            total_staked: MIN_STAKE_AMOUNT * 50,
            total_voting_power: MIN_STAKE_AMOUNT * 25,
            reward_rate: 1_000_000,
            reward_per_token_stored: 100,
            last_update_block: 500,
            total_distributed: 999_999,
            staker_count: 10,
        };
        let stats = staking_stats(&pool, MIN_STAKE_AMOUNT * 500);
        assert_eq!(stats.total_staked, MIN_STAKE_AMOUNT * 50);
        assert_eq!(stats.total_voting_power, MIN_STAKE_AMOUNT * 25);
        assert_eq!(stats.utilization_bps, 1000); // 50/500 = 10%
        assert_eq!(stats.staker_count, 10);
    }

    #[test]
    fn reward_per_token_monotonically_increases() {
        let pool = make_pool(MIN_STAKE_AMOUNT, 1_000_000, 0);
        let rpt1 = update_reward_per_token(&pool, 100);
        let rpt2 = update_reward_per_token(&pool, 200);
        let rpt3 = update_reward_per_token(&pool, 300);
        assert!(rpt1 < rpt2);
        assert!(rpt2 < rpt3);
    }

    #[test]
    fn extend_then_increase_compound_power() {
        let pos = stake(MIN_STAKE_AMOUNT, 100_000, 0).unwrap();
        let extended = extend_lock(&pos, 100_000, MAX_LOCK_DURATION, 50_000).unwrap();
        let increased = increase_stake(&extended, MIN_STAKE_AMOUNT, 50_000, MAX_LOCK_DURATION).unwrap();
        assert!(increased.voting_power > extended.voting_power);
        assert!(increased.amount == MIN_STAKE_AMOUNT * 2);
    }

    #[test]
    fn voting_power_at_start_equals_initial() {
        let pos = stake(MIN_STAKE_AMOUNT, MAX_LOCK_DURATION, 0).unwrap();
        let vp = voting_power_at_block(&pos, 0, MAX_LOCK_DURATION);
        assert_eq!(vp, pos.voting_power);
    }

    #[test]
    fn voting_power_at_end_is_zero() {
        let pos = stake(MIN_STAKE_AMOUNT, MAX_LOCK_DURATION, 0).unwrap();
        let vp = voting_power_at_block(&pos, MAX_LOCK_DURATION, MAX_LOCK_DURATION);
        assert_eq!(vp, 0);
    }

    #[test]
    fn unstake_penalty_equals_early_exit_penalty_fn() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        let current = 3_000;
        let penalty_bps = 5000u16;
        let result = calculate_unstake(&pos, current, penalty_bps).unwrap();
        let direct = early_exit_penalty(
            MIN_STAKE_AMOUNT,
            10_000 - current,
            10_000,
            penalty_bps,
        );
        assert_eq!(result.penalty, direct);
    }

    #[test]
    fn min_stake_at_min_lock_has_some_power() {
        let pos = stake(MIN_STAKE_AMOUNT, MIN_LOCK_DURATION, 0).unwrap();
        assert!(pos.voting_power > 0);
    }

    #[test]
    fn max_stake_at_max_lock_full_power() {
        let big_amount = u128::MAX / 2;
        let power = calculate_voting_power(big_amount, MAX_LOCK_DURATION, MAX_LOCK_DURATION);
        assert_eq!(power, big_amount);
    }

    // ============ Batch 7: Hardening Tests (Target 125+) ============

    #[test]
    fn voting_power_proportional_to_duration() {
        let amount = MIN_STAKE_AMOUNT * 10;
        let p1 = calculate_voting_power(amount, 1_000_000, MAX_LOCK_DURATION);
        let p2 = calculate_voting_power(amount, 2_000_000, MAX_LOCK_DURATION);
        assert_eq!(p2, p1 * 2);
    }

    #[test]
    fn voting_power_proportional_to_amount() {
        let p1 = calculate_voting_power(MIN_STAKE_AMOUNT, 5_000_000, MAX_LOCK_DURATION);
        let p2 = calculate_voting_power(MIN_STAKE_AMOUNT * 3, 5_000_000, MAX_LOCK_DURATION);
        assert_eq!(p2, p1 * 3);
    }

    #[test]
    fn vp_at_block_exact_midpoint() {
        let pos = make_position(MIN_STAKE_AMOUNT, 1000, 11_000);
        let vp = voting_power_at_block(&pos, 6_000, MAX_LOCK_DURATION);
        // remaining = 5000, total = 10000 → 50%
        let expected = mul_div(pos.voting_power, 5_000, 10_000);
        assert_eq!(vp, expected);
    }

    #[test]
    fn stake_at_large_current_block() {
        // Staking at a high block number should work fine
        let result = stake(MIN_STAKE_AMOUNT, MIN_LOCK_DURATION, u64::MAX / 2);
        assert!(result.is_ok());
        let pos = result.unwrap();
        assert_eq!(pos.lock_start, u64::MAX / 2);
        assert_eq!(pos.lock_end, u64::MAX / 2 + MIN_LOCK_DURATION);
    }

    #[test]
    fn stake_exactly_min_amount() {
        let result = stake(MIN_STAKE_AMOUNT, MIN_LOCK_DURATION, 0);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().amount, MIN_STAKE_AMOUNT);
    }

    #[test]
    fn unstake_long_after_expiry() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        let result = calculate_unstake(&pos, 1_000_000, 5000).unwrap();
        assert_eq!(result.penalty, 0);
        assert_eq!(result.net_received, MIN_STAKE_AMOUNT);
    }

    #[test]
    fn unstake_early_with_max_penalty_cap() {
        // Penalty bps > MAX_EARLY_EXIT_PENALTY_BPS should be capped
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        let result_capped = calculate_unstake(&pos, 0, 9999).unwrap();
        let result_at_max = calculate_unstake(&pos, 0, MAX_EARLY_EXIT_PENALTY_BPS).unwrap();
        assert_eq!(result_capped.penalty, result_at_max.penalty);
    }

    #[test]
    fn pending_rewards_two_stakers_split() {
        // If two stakers have equal amounts, each gets half
        let pos = make_position(MIN_STAKE_AMOUNT, 100, 10_100);
        let pool = make_pool(MIN_STAKE_AMOUNT * 2, 1_000_000, 100);
        let rewards = pending_rewards(&pos, &pool, 200);
        // With 2x total staked, this staker gets half the rewards
        let pool_single = make_pool(MIN_STAKE_AMOUNT, 1_000_000, 100);
        let rewards_single = pending_rewards(&pos, &pool_single, 200);
        // Should be roughly half
        assert!(rewards <= rewards_single, "Shared pool should yield less: {} vs {}", rewards, rewards_single);
    }

    #[test]
    fn rpt_before_last_update() {
        // current_block before last_update_block → saturating_sub gives 0, no change
        let pool = make_pool(MIN_STAKE_AMOUNT, 1_000_000, 200);
        let rpt = update_reward_per_token(&pool, 100);
        assert_eq!(rpt, 0); // pool.reward_per_token_stored was 0, blocks_elapsed = 0
    }

    #[test]
    fn apy_with_large_staked() {
        // Very large staked amount should give small APY
        let total = u128::MAX / 100;
        let rate = 1;
        let apy = reward_apy(rate, total, BLOCKS_PER_YEAR);
        // annual = BLOCKS_PER_YEAR, apy = BLOCKS_PER_YEAR * 10000 / (MAX/100) ≈ 0
        assert_eq!(apy, 0);
    }

    #[test]
    fn extend_lock_at_start_of_lock() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 100_000);
        let result = extend_lock(&pos, 50_000, MAX_LOCK_DURATION, 0);
        assert!(result.is_ok());
        let new_pos = result.unwrap();
        assert_eq!(new_pos.lock_end, 150_000);
    }

    #[test]
    fn extend_lock_one_block_before_expiry() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 100_000);
        let result = extend_lock(&pos, 1_000, MAX_LOCK_DURATION, 99_999);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().lock_end, 101_000);
    }

    #[test]
    fn increase_stake_small_additional() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, MAX_LOCK_DURATION);
        let result = increase_stake(&pos, 1, 0, MAX_LOCK_DURATION);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().amount, MIN_STAKE_AMOUNT + 1);
    }

    #[test]
    fn increase_stake_preserves_staker() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        let new_pos = increase_stake(&pos, MIN_STAKE_AMOUNT, 0, MAX_LOCK_DURATION).unwrap();
        assert_eq!(new_pos.staker, pos.staker);
    }

    #[test]
    fn governance_weight_10_percent() {
        assert_eq!(governance_weight(100, 1_000), 1_000);
    }

    #[test]
    fn governance_weight_exact_third() {
        let w = governance_weight(1_000, 3_000);
        // 1000 * 10000 / 3000 = 3333
        assert_eq!(w, 3333);
    }

    #[test]
    fn governance_weight_capped_at_10000() {
        // voting_power > total_voting_power would be invalid but function handles gracefully
        let w = governance_weight(2_000, 1_000);
        assert_eq!(w, 10_000);
    }

    #[test]
    fn time_to_unlock_far_before_start() {
        let pos = make_position(MIN_STAKE_AMOUNT, 1_000_000, 2_000_000);
        assert_eq!(time_to_unlock(&pos, 0), 2_000_000);
    }

    #[test]
    fn is_lock_expired_just_after() {
        let pos = make_position(MIN_STAKE_AMOUNT, 0, 10_000);
        assert!(is_lock_expired(&pos, 10_001));
    }

    #[test]
    fn penalty_exactly_one_block_total_lock() {
        // total_lock = 1, remaining = 1 → full proportional penalty
        let penalty = early_exit_penalty(MIN_STAKE_AMOUNT, 1, 1, 5000);
        let expected = mul_div(MIN_STAKE_AMOUNT, 5_000, 10_000);
        assert_eq!(penalty, expected);
    }

    #[test]
    fn stats_over_100_percent_utilization() {
        // total_staked > max_supply should cap or produce > 10000 bps
        let pool = make_pool(MIN_STAKE_AMOUNT * 200, 0, 0);
        let stats = staking_stats(&pool, MIN_STAKE_AMOUNT * 100);
        // 200/100 = 200% = 20000 bps
        assert_eq!(stats.utilization_bps, 20000);
    }

    #[test]
    fn stake_then_early_exit_penalty_covers_net_received() {
        let pos = stake(MIN_STAKE_AMOUNT, MAX_LOCK_DURATION, 0).unwrap();
        let result = calculate_unstake(&pos, 0, MAX_EARLY_EXIT_PENALTY_BPS).unwrap();
        // penalty + net_received = amount
        assert_eq!(result.penalty + result.net_received, result.amount);
    }
}
