// ============ Rewards — Shapley Distribution, Loyalty, Staking & Vesting ============
// Core incentives module implementing VibeSwap's game theory-based reward design.
// Rewards are distributed using Shapley-value approximations that weight each
// participant's marginal contribution to the protocol.
//
// Key capabilities:
// - Shapley-weighted reward distribution across contributor types
// - Linear vesting with cliff for token releases
// - Time-weighted staking with lock duration multipliers
// - Loyalty tier system with fee discounts and boost multipliers
// - Epoch reward breakdown (fees, emissions, bonuses)
//
// Contributor types reflect the full VibeSwap ecosystem:
//   LiquidityProvider, Trader, Relayer, OracleOperator, Validator, KeeperBot, Governance
//
// Each contributor's Shapley weight approximates their marginal value-add to the
// protocol without requiring exponential coalition enumeration. Weights are provided
// by callers (computed off-chain or by keeper bots) and validated here.
//
// Philosophy: Cooperative Capitalism — reward cooperation, not extraction.

use std::collections::BTreeMap;

use vibeswap_math::PRECISION;
use vibeswap_math::mul_div;

// ============ Constants ============

/// Maximum number of contributors in a single distribution
pub const MAX_CONTRIBUTORS: usize = 256;

/// Minimum stake lock duration (blocks)
pub const MIN_STAKE_DURATION: u64 = 1000;

/// Maximum stake lock duration (~27 hours at CKB speed)
pub const MAX_STAKE_DURATION: u64 = 500_000;

/// Maximum staking time multiplier (3x boost = 30000 bps)
pub const MAX_MULTIPLIER_BPS: u16 = 30_000;

/// Base loyalty points awarded per epoch of active participation
pub const BASE_LOYALTY_POINTS_PER_EPOCH: u64 = 100;

/// Bonus for consecutive epoch participation (5% per consecutive epoch)
pub const CONSECUTIVE_EPOCH_BONUS_BPS: u16 = 500;

/// Maximum number of loyalty tiers
pub const MAX_LOYALTY_TIERS: usize = 8;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RewardsError {
    /// No contributors provided for distribution
    NoContributions,
    /// A contributor weight is zero or weights overflow
    InvalidWeight,
    /// Vesting has not started yet (current_block < start_block)
    VestingNotStarted,
    /// Vesting schedule is fully complete and all tokens released
    VestingComplete,
    /// Cliff period has not been reached
    CliffNotReached,
    /// Stake amount is below minimum or zero
    InsufficientStake,
    /// Stake is still within its lock duration
    StakeLocked,
    /// Duration parameter is invalid (zero or out of range)
    InvalidDuration,
    /// Computed reward amount is zero
    ZeroReward,
    /// Total allocation exceeds available reward pool
    OverAllocation,
}

// ============ Data Types ============

/// Type of contribution to the VibeSwap protocol.
/// Each type has different Shapley marginal contribution characteristics.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum ContributionType {
    /// Provides liquidity to AMM pools — depth and stability
    LiquidityProvider,
    /// Executes swaps — volume and fee generation
    Trader,
    /// Relays cross-chain messages via LayerZero
    Relayer,
    /// Operates Kalman filter price oracle
    OracleOperator,
    /// Validates commit-reveal batch settlements
    Validator,
    /// Runs automated keeper tasks (liquidations, epoch transitions)
    KeeperBot,
    /// Participates in governance voting and proposals
    Governance,
}

/// A contributor's share in the reward distribution.
/// Weight represents their marginal contribution (Shapley approximation).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContributorShare {
    /// Contributor's on-chain address (CKB lock hash)
    pub address: [u8; 32],
    /// Shapley weight — proportional to marginal contribution
    pub weight: u128,
    /// What type of contribution this represents
    pub contribution_type: ContributionType,
}

/// Result of Shapley reward distribution for a single contributor.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShapleyAllocation {
    /// Recipient address
    pub address: [u8; 32],
    /// Amount of reward tokens allocated
    pub amount: u128,
    /// Share of total distribution in basis points
    pub share_bps: u16,
    /// Contribution type for this allocation
    pub contribution_type: ContributionType,
}

/// Linear vesting schedule with cliff.
/// Tokens vest linearly from start_block + cliff_blocks to start_block + duration_blocks.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VestingSchedule {
    /// Beneficiary address
    pub beneficiary: [u8; 32],
    /// Total tokens to be vested
    pub total_amount: u128,
    /// Tokens already released/claimed
    pub released: u128,
    /// Block at which vesting begins
    pub start_block: u64,
    /// Cliff duration in blocks (no tokens vest before cliff)
    pub cliff_blocks: u64,
    /// Total vesting duration in blocks (from start_block)
    pub duration_blocks: u64,
}

/// A staking position with time-weighted multiplier.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StakePosition {
    /// Staker's address
    pub staker: [u8; 32],
    /// Amount of tokens staked
    pub amount: u128,
    /// Block at which stake was created
    pub start_block: u64,
    /// Lock duration in blocks (cannot unstake before expiry)
    pub lock_duration: u64,
    /// Current multiplier in basis points (grows with time)
    pub multiplier_bps: u16,
}

/// A loyalty tier with associated benefits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LoyaltyTier {
    /// Tier identifier (0 = base, higher = better)
    pub tier_id: u8,
    /// Minimum loyalty points to qualify for this tier
    pub min_points: u64,
    /// Fee discount in basis points (e.g., 500 = 5% discount)
    pub fee_discount_bps: u16,
    /// Reward boost multiplier in basis points (e.g., 12000 = 1.2x)
    pub boost_multiplier_bps: u16,
}

/// Aggregate statistics for a set of reward allocations.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RewardsSummary {
    /// Total tokens distributed
    pub total_distributed: u128,
    /// Total tokens pending (in vesting, staking, etc.)
    pub total_pending: u128,
    /// Number of unique recipients
    pub unique_recipients: u32,
    /// Average reward per recipient
    pub avg_reward: u128,
    /// Largest single contributor's share in bps
    pub top_contributor_share_bps: u16,
}

/// Epoch reward breakdown by source.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EpochRewards {
    /// Epoch identifier
    pub epoch: u64,
    /// Total rewards for this epoch (sum of all sources)
    pub total_rewards: u128,
    /// Rewards sourced from protocol fees
    pub fee_rewards: u128,
    /// Rewards from token emission schedule
    pub emission_rewards: u128,
    /// Bonus pool rewards (loyalty bonuses, one-time incentives)
    pub bonus_rewards: u128,
}

// ============ Shapley Distribution ============

/// Distribute rewards proportional to Shapley weights.
///
/// Each contributor receives: `total_reward * weight_i / sum(weights)`
///
/// Rounding dust (total_reward - sum(allocations)) is given to the largest contributor
/// to ensure exact conservation of the reward pool.
///
/// # Errors
/// - `NoContributions` if the contributor list is empty
/// - `InvalidWeight` if any weight is zero or the list exceeds MAX_CONTRIBUTORS
/// - `ZeroReward` if total_reward is zero
pub fn shapley_distribute(
    total_reward: u128,
    contributors: &[ContributorShare],
) -> Result<Vec<ShapleyAllocation>, RewardsError> {
    if contributors.is_empty() {
        return Err(RewardsError::NoContributions);
    }
    if contributors.len() > MAX_CONTRIBUTORS {
        return Err(RewardsError::InvalidWeight);
    }
    if total_reward == 0 {
        return Err(RewardsError::ZeroReward);
    }

    validate_weights(contributors)?;

    let total_weight: u128 = contributors.iter().map(|c| c.weight).sum();
    // total_weight cannot be zero here because validate_weights ensures all weights > 0

    let mut allocations = Vec::with_capacity(contributors.len());
    let mut distributed: u128 = 0;
    let mut max_idx: usize = 0;
    let mut max_amount: u128 = 0;

    for (i, contributor) in contributors.iter().enumerate() {
        let amount = mul_div(total_reward, contributor.weight, total_weight);
        let share_bps = mul_div(contributor.weight, 10_000, total_weight) as u16;

        if amount > max_amount {
            max_amount = amount;
            max_idx = i;
        }

        distributed += amount;
        allocations.push(ShapleyAllocation {
            address: contributor.address,
            amount,
            share_bps,
            contribution_type: contributor.contribution_type.clone(),
        });
    }

    // Assign rounding dust to the largest contributor
    let dust = total_reward.saturating_sub(distributed);
    if dust > 0 && !allocations.is_empty() {
        allocations[max_idx].amount += dust;
    }

    Ok(allocations)
}

// ============ Vesting ============

/// Calculate the amount of tokens currently claimable from a vesting schedule.
///
/// Linear vesting with cliff:
/// - Before start_block: VestingNotStarted
/// - Before cliff: CliffNotReached
/// - After cliff, before end: linear proportion minus already released
/// - After end: total_amount minus already released
///
/// # Errors
/// - `VestingNotStarted` if current_block < start_block
/// - `CliffNotReached` if still in cliff period
/// - `VestingComplete` if all tokens have already been released
pub fn vesting_claimable(
    schedule: &VestingSchedule,
    current_block: u64,
) -> Result<u128, RewardsError> {
    if current_block < schedule.start_block {
        return Err(RewardsError::VestingNotStarted);
    }

    if schedule.released >= schedule.total_amount {
        return Err(RewardsError::VestingComplete);
    }

    let elapsed = current_block - schedule.start_block;

    if elapsed < schedule.cliff_blocks {
        return Err(RewardsError::CliffNotReached);
    }

    let vested = if elapsed >= schedule.duration_blocks {
        schedule.total_amount
    } else {
        mul_div(schedule.total_amount, elapsed as u128, schedule.duration_blocks as u128)
    };

    let claimable = vested.saturating_sub(schedule.released);
    Ok(claimable)
}

/// Calculate vesting progress in basis points (0 = none, 10000 = fully vested).
///
/// Returns 0 if before start, 10000 if after end, linear interpolation between.
pub fn vesting_progress_bps(schedule: &VestingSchedule, current_block: u64) -> u16 {
    if current_block <= schedule.start_block {
        return 0;
    }

    let elapsed = current_block - schedule.start_block;

    if elapsed >= schedule.duration_blocks {
        return 10_000;
    }

    mul_div(elapsed as u128, 10_000, schedule.duration_blocks as u128) as u16
}

// ============ Staking ============

/// Calculate staking reward with time-weighted multiplier.
///
/// reward = base_reward * multiplier_bps / 10000
///
/// The multiplier grows linearly with how long the stake has been active,
/// up to MAX_MULTIPLIER_BPS. If the stake hasn't started yet or current_block
/// is before start_block, returns 0.
pub fn stake_reward(
    position: &StakePosition,
    base_reward: u128,
    current_block: u64,
) -> u128 {
    if current_block < position.start_block || base_reward == 0 || position.amount == 0 {
        return 0;
    }

    let elapsed = current_block - position.start_block;
    let multiplier = time_weighted_multiplier(
        elapsed,
        position.lock_duration,
        MAX_MULTIPLIER_BPS,
    );

    mul_div(base_reward, multiplier as u128, 10_000)
}

/// Calculate a linear time-weighted multiplier.
///
/// Starts at 10000 bps (1x) and grows linearly to max_multiplier_bps
/// as stake_duration approaches max_duration.
///
/// multiplier = 10000 + (max_multiplier_bps - 10000) * min(stake_duration, max_duration) / max_duration
///
/// Returns 10000 (1x) if max_duration is 0.
pub fn time_weighted_multiplier(
    stake_duration: u64,
    max_duration: u64,
    max_multiplier_bps: u16,
) -> u16 {
    if max_duration == 0 || max_multiplier_bps <= 10_000 {
        return 10_000;
    }

    let capped_duration = stake_duration.min(max_duration);
    let bonus_range = (max_multiplier_bps as u64).saturating_sub(10_000);
    let bonus = mul_div(bonus_range as u128, capped_duration as u128, max_duration as u128) as u64;

    (10_000 + bonus) as u16
}

// ============ Loyalty ============

/// Find the highest loyalty tier that a user qualifies for based on their points.
///
/// Tiers are searched in order; returns the tier with the highest min_points
/// that is still <= the user's points. Returns None if no tier qualifies.
pub fn loyalty_tier<'a>(points: u64, tiers: &'a [LoyaltyTier]) -> Option<&'a LoyaltyTier> {
    tiers
        .iter()
        .filter(|t| points >= t.min_points)
        .max_by_key(|t| t.min_points)
}

/// Calculate loyalty points earned for an epoch of activity.
///
/// points = BASE_LOYALTY_POINTS_PER_EPOCH
///        + volume_bonus (1 point per PRECISION of volume, capped at 500)
///        + consecutive_bonus (BASE * consecutive_epochs * CONSECUTIVE_EPOCH_BONUS_BPS / 10000)
///
/// The consecutive epoch bonus rewards long-term participation.
pub fn loyalty_points_earned(volume_traded: u128, consecutive_epochs: u64) -> u64 {
    let base = BASE_LOYALTY_POINTS_PER_EPOCH;

    // Volume bonus: 1 point per PRECISION unit of volume, capped at 500
    let volume_bonus = (volume_traded / PRECISION).min(500) as u64;

    // Consecutive epoch bonus: 5% of base per consecutive epoch
    let consecutive_bonus = mul_div(
        base as u128 * consecutive_epochs as u128,
        CONSECUTIVE_EPOCH_BONUS_BPS as u128,
        10_000,
    ) as u64;

    base + volume_bonus + consecutive_bonus
}

/// Calculate the discounted fee based on a loyalty tier's discount.
///
/// discounted_fee = base_fee * (10000 - fee_discount_bps) / 10000
pub fn fee_discount(tier: &LoyaltyTier, base_fee: u128) -> u128 {
    if tier.fee_discount_bps >= 10_000 {
        return 0;
    }
    mul_div(base_fee, (10_000 - tier.fee_discount_bps) as u128, 10_000)
}

// ============ Epoch Rewards ============

/// Break down an epoch's total rewards by source.
///
/// total_rewards = total_fees + emission_rate + bonus_pool
pub fn epoch_rewards_breakdown(
    total_fees: u128,
    emission_rate: u128,
    epoch: u64,
    bonus_pool: u128,
) -> EpochRewards {
    EpochRewards {
        epoch,
        total_rewards: total_fees + emission_rate + bonus_pool,
        fee_rewards: total_fees,
        emission_rewards: emission_rate,
        bonus_rewards: bonus_pool,
    }
}

// ============ Summary & Validation ============

/// Aggregate statistics from a set of Shapley allocations.
///
/// Computes total distributed, unique recipients, average reward,
/// and the top contributor's share in bps.
pub fn reward_summary(allocations: &[ShapleyAllocation]) -> RewardsSummary {
    if allocations.is_empty() {
        return RewardsSummary {
            total_distributed: 0,
            total_pending: 0,
            unique_recipients: 0,
            avg_reward: 0,
            top_contributor_share_bps: 0,
        };
    }

    let total_distributed: u128 = allocations.iter().map(|a| a.amount).sum();

    // Count unique addresses
    let mut unique_addrs: Vec<[u8; 32]> = allocations.iter().map(|a| a.address).collect();
    unique_addrs.sort();
    unique_addrs.dedup();
    let unique_recipients = unique_addrs.len() as u32;

    let avg_reward = if unique_recipients > 0 {
        total_distributed / unique_recipients as u128
    } else {
        0
    };

    let top_share = allocations.iter().map(|a| a.share_bps).max().unwrap_or(0);

    RewardsSummary {
        total_distributed,
        total_pending: 0,
        unique_recipients,
        avg_reward,
        top_contributor_share_bps: top_share,
    }
}

/// Validate that contributor weights are all non-zero and the list is within bounds.
///
/// # Errors
/// - `InvalidWeight` if any weight is zero or the list exceeds MAX_CONTRIBUTORS
/// - `NoContributions` if the list is empty
pub fn validate_weights(contributors: &[ContributorShare]) -> Result<(), RewardsError> {
    if contributors.is_empty() {
        return Err(RewardsError::NoContributions);
    }
    if contributors.len() > MAX_CONTRIBUTORS {
        return Err(RewardsError::InvalidWeight);
    }
    for c in contributors {
        if c.weight == 0 {
            return Err(RewardsError::InvalidWeight);
        }
    }
    Ok(())
}

/// Merge two contributor lists, summing weights for duplicate addresses.
///
/// If the same address appears in both lists, their weights are summed.
/// The contribution_type from the first occurrence is kept.
pub fn merge_contributions(
    a: &[ContributorShare],
    b: &[ContributorShare],
) -> Vec<ContributorShare> {
    let mut map: BTreeMap<[u8; 32], (u128, ContributionType)> = BTreeMap::new();

    for c in a.iter().chain(b.iter()) {
        map.entry(c.address)
            .and_modify(|(w, _)| *w += c.weight)
            .or_insert((c.weight, c.contribution_type.clone()));
    }

    map.into_iter()
        .map(|(address, (weight, contribution_type))| ContributorShare {
            address,
            weight,
            contribution_type,
        })
        .collect()
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn addr(id: u8) -> [u8; 32] {
        let mut a = [0u8; 32];
        a[0] = id;
        a
    }

    fn make_contributor(id: u8, weight: u128, ctype: ContributionType) -> ContributorShare {
        ContributorShare {
            address: addr(id),
            weight,
            contribution_type: ctype,
        }
    }

    fn make_schedule(
        total: u128,
        released: u128,
        start: u64,
        cliff: u64,
        duration: u64,
    ) -> VestingSchedule {
        VestingSchedule {
            beneficiary: addr(1),
            total_amount: total,
            released,
            start_block: start,
            cliff_blocks: cliff,
            duration_blocks: duration,
        }
    }

    fn make_stake(amount: u128, start: u64, lock: u64) -> StakePosition {
        StakePosition {
            staker: addr(1),
            amount,
            start_block: start,
            lock_duration: lock,
            multiplier_bps: 10_000,
        }
    }

    fn default_tiers() -> Vec<LoyaltyTier> {
        vec![
            LoyaltyTier {
                tier_id: 0,
                min_points: 0,
                fee_discount_bps: 0,
                boost_multiplier_bps: 10_000,
            },
            LoyaltyTier {
                tier_id: 1,
                min_points: 100,
                fee_discount_bps: 200,
                boost_multiplier_bps: 11_000,
            },
            LoyaltyTier {
                tier_id: 2,
                min_points: 500,
                fee_discount_bps: 500,
                boost_multiplier_bps: 12_500,
            },
            LoyaltyTier {
                tier_id: 3,
                min_points: 2000,
                fee_discount_bps: 1000,
                boost_multiplier_bps: 15_000,
            },
            LoyaltyTier {
                tier_id: 4,
                min_points: 10_000,
                fee_discount_bps: 2000,
                boost_multiplier_bps: 20_000,
            },
        ]
    }

    // ============ Shapley Distribution Tests ============

    #[test]
    fn test_shapley_single_contributor() {
        let contributors = vec![make_contributor(1, 100, ContributionType::LiquidityProvider)];
        let result = shapley_distribute(1_000_000, &contributors).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].amount, 1_000_000);
        assert_eq!(result[0].share_bps, 10_000);
    }

    #[test]
    fn test_shapley_two_equal_contributors() {
        let contributors = vec![
            make_contributor(1, 50, ContributionType::LiquidityProvider),
            make_contributor(2, 50, ContributionType::Trader),
        ];
        let result = shapley_distribute(1_000_000, &contributors).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].amount, 500_000);
        assert_eq!(result[1].amount, 500_000);
        assert_eq!(result[0].share_bps, 5_000);
        assert_eq!(result[1].share_bps, 5_000);
    }

    #[test]
    fn test_shapley_three_equal_contributors() {
        let contributors = vec![
            make_contributor(1, 100, ContributionType::LiquidityProvider),
            make_contributor(2, 100, ContributionType::Trader),
            make_contributor(3, 100, ContributionType::Relayer),
        ];
        let result = shapley_distribute(999, &contributors).unwrap();
        // 999 / 3 = 333 each, plus 0 dust
        let total: u128 = result.iter().map(|a| a.amount).sum();
        assert_eq!(total, 999);
        assert_eq!(result[0].amount, 333);
        assert_eq!(result[1].amount, 333);
        assert_eq!(result[2].amount, 333);
    }

    #[test]
    fn test_shapley_weighted_distribution() {
        let contributors = vec![
            make_contributor(1, 70, ContributionType::LiquidityProvider),
            make_contributor(2, 30, ContributionType::Trader),
        ];
        let result = shapley_distribute(10_000, &contributors).unwrap();
        assert_eq!(result[0].amount, 7_000);
        assert_eq!(result[1].amount, 3_000);
        assert_eq!(result[0].share_bps, 7_000);
        assert_eq!(result[1].share_bps, 3_000);
    }

    #[test]
    fn test_shapley_rounding_dust_goes_to_largest() {
        // 100 reward, 3 equal contributors: 33 + 33 + 33 = 99, dust=1 goes to first (all equal, first is max_idx=0)
        let contributors = vec![
            make_contributor(1, 1, ContributionType::Validator),
            make_contributor(2, 1, ContributionType::Validator),
            make_contributor(3, 1, ContributionType::Validator),
        ];
        let result = shapley_distribute(100, &contributors).unwrap();
        let total: u128 = result.iter().map(|a| a.amount).sum();
        assert_eq!(total, 100); // Perfect conservation
        // Dust assigned to first contributor (all equal, first one encountered)
        assert_eq!(result[0].amount, 34);
        assert_eq!(result[1].amount, 33);
        assert_eq!(result[2].amount, 33);
    }

    #[test]
    fn test_shapley_zero_total_reward() {
        let contributors = vec![make_contributor(1, 100, ContributionType::Trader)];
        let result = shapley_distribute(0, &contributors);
        assert_eq!(result, Err(RewardsError::ZeroReward));
    }

    #[test]
    fn test_shapley_empty_contributors() {
        let result = shapley_distribute(1_000_000, &[]);
        assert_eq!(result, Err(RewardsError::NoContributions));
    }

    #[test]
    fn test_shapley_zero_weight_contributor() {
        let contributors = vec![
            make_contributor(1, 100, ContributionType::LiquidityProvider),
            make_contributor(2, 0, ContributionType::Trader),
        ];
        let result = shapley_distribute(1_000_000, &contributors);
        assert_eq!(result, Err(RewardsError::InvalidWeight));
    }

    #[test]
    fn test_shapley_many_contributors() {
        let contributors: Vec<ContributorShare> = (1..=50)
            .map(|i| make_contributor(i as u8, 100, ContributionType::Trader))
            .collect();
        let result = shapley_distribute(50_000, &contributors).unwrap();
        assert_eq!(result.len(), 50);
        let total: u128 = result.iter().map(|a| a.amount).sum();
        assert_eq!(total, 50_000);
        // Each gets 1000
        for alloc in &result {
            assert_eq!(alloc.amount, 1_000);
        }
    }

    #[test]
    fn test_shapley_large_reward() {
        let contributors = vec![
            make_contributor(1, PRECISION, ContributionType::LiquidityProvider),
            make_contributor(2, PRECISION, ContributionType::Trader),
        ];
        let total = PRECISION * 1_000_000; // 1M tokens at 1e18
        let result = shapley_distribute(total, &contributors).unwrap();
        assert_eq!(result[0].amount, total / 2);
        assert_eq!(result[1].amount, total / 2);
    }

    #[test]
    fn test_shapley_all_contribution_types() {
        let contributors = vec![
            make_contributor(1, 30, ContributionType::LiquidityProvider),
            make_contributor(2, 20, ContributionType::Trader),
            make_contributor(3, 15, ContributionType::Relayer),
            make_contributor(4, 15, ContributionType::OracleOperator),
            make_contributor(5, 10, ContributionType::Validator),
            make_contributor(6, 5, ContributionType::KeeperBot),
            make_contributor(7, 5, ContributionType::Governance),
        ];
        let result = shapley_distribute(10_000, &contributors).unwrap();
        assert_eq!(result.len(), 7);
        let total: u128 = result.iter().map(|a| a.amount).sum();
        assert_eq!(total, 10_000);
        assert_eq!(result[0].contribution_type, ContributionType::LiquidityProvider);
        assert_eq!(result[6].contribution_type, ContributionType::Governance);
    }

    #[test]
    fn test_shapley_too_many_contributors() {
        let contributors: Vec<ContributorShare> = (0..257)
            .map(|i| make_contributor((i % 256) as u8, 1, ContributionType::Trader))
            .collect();
        let result = shapley_distribute(1_000_000, &contributors);
        assert_eq!(result, Err(RewardsError::InvalidWeight));
    }

    #[test]
    fn test_shapley_share_bps_sum_approximately_10000() {
        let contributors = vec![
            make_contributor(1, 60, ContributionType::LiquidityProvider),
            make_contributor(2, 25, ContributionType::Trader),
            make_contributor(3, 15, ContributionType::Relayer),
        ];
        let result = shapley_distribute(10_000_000, &contributors).unwrap();
        let bps_sum: u16 = result.iter().map(|a| a.share_bps).sum();
        // Due to truncation, sum may be slightly less than 10000
        assert!(bps_sum <= 10_000);
        assert!(bps_sum >= 9_997); // Should be very close
    }

    #[test]
    fn test_shapley_reward_of_one() {
        // Minimal reward: only one unit to distribute
        let contributors = vec![
            make_contributor(1, 50, ContributionType::LiquidityProvider),
            make_contributor(2, 50, ContributionType::Trader),
        ];
        let result = shapley_distribute(1, &contributors).unwrap();
        let total: u128 = result.iter().map(|a| a.amount).sum();
        assert_eq!(total, 1); // Conservation
    }

    // ============ Vesting Tests ============

    #[test]
    fn test_vesting_before_start() {
        let schedule = make_schedule(1_000_000, 0, 100, 10, 100);
        let result = vesting_claimable(&schedule, 50);
        assert_eq!(result, Err(RewardsError::VestingNotStarted));
    }

    #[test]
    fn test_vesting_at_start_before_cliff() {
        let schedule = make_schedule(1_000_000, 0, 100, 10, 100);
        let result = vesting_claimable(&schedule, 100);
        assert_eq!(result, Err(RewardsError::CliffNotReached));
    }

    #[test]
    fn test_vesting_during_cliff() {
        let schedule = make_schedule(1_000_000, 0, 100, 50, 200);
        let result = vesting_claimable(&schedule, 140);
        assert_eq!(result, Err(RewardsError::CliffNotReached));
    }

    #[test]
    fn test_vesting_at_cliff() {
        let schedule = make_schedule(1_000_000, 0, 100, 50, 200);
        let result = vesting_claimable(&schedule, 150).unwrap();
        // 50 blocks elapsed out of 200 = 25%
        assert_eq!(result, 250_000);
    }

    #[test]
    fn test_vesting_linear_midpoint() {
        let schedule = make_schedule(1_000_000, 0, 100, 0, 200);
        let result = vesting_claimable(&schedule, 200).unwrap();
        // 100 blocks elapsed out of 200 = 50%
        assert_eq!(result, 500_000);
    }

    #[test]
    fn test_vesting_three_quarters() {
        let schedule = make_schedule(1_000_000, 0, 100, 0, 200);
        let result = vesting_claimable(&schedule, 250).unwrap();
        // 150 blocks elapsed out of 200 = 75%
        assert_eq!(result, 750_000);
    }

    #[test]
    fn test_vesting_fully_vested() {
        let schedule = make_schedule(1_000_000, 0, 100, 0, 200);
        let result = vesting_claimable(&schedule, 300).unwrap();
        assert_eq!(result, 1_000_000);
    }

    #[test]
    fn test_vesting_partially_claimed() {
        let schedule = make_schedule(1_000_000, 400_000, 100, 0, 200);
        // At block 200, 50% vested = 500_000, minus 400_000 already claimed
        let result = vesting_claimable(&schedule, 200).unwrap();
        assert_eq!(result, 100_000);
    }

    #[test]
    fn test_vesting_fully_claimed() {
        let schedule = make_schedule(1_000_000, 1_000_000, 100, 0, 200);
        let result = vesting_claimable(&schedule, 300);
        assert_eq!(result, Err(RewardsError::VestingComplete));
    }

    #[test]
    fn test_vesting_zero_cliff() {
        let schedule = make_schedule(1_000_000, 0, 100, 0, 100);
        // No cliff, at start block exactly
        let result = vesting_claimable(&schedule, 100).unwrap();
        assert_eq!(result, 0); // 0 blocks elapsed = 0%
    }

    #[test]
    fn test_vesting_exact_end_block() {
        let schedule = make_schedule(1_000_000, 0, 100, 0, 200);
        let result = vesting_claimable(&schedule, 300).unwrap(); // block 300 = start + duration
        assert_eq!(result, 1_000_000);
    }

    // ============ Vesting Progress Tests ============

    #[test]
    fn test_vesting_progress_before_start() {
        let schedule = make_schedule(1_000_000, 0, 100, 0, 200);
        assert_eq!(vesting_progress_bps(&schedule, 50), 0);
    }

    #[test]
    fn test_vesting_progress_at_start() {
        let schedule = make_schedule(1_000_000, 0, 100, 0, 200);
        assert_eq!(vesting_progress_bps(&schedule, 100), 0);
    }

    #[test]
    fn test_vesting_progress_midpoint() {
        let schedule = make_schedule(1_000_000, 0, 100, 0, 200);
        assert_eq!(vesting_progress_bps(&schedule, 200), 5_000);
    }

    #[test]
    fn test_vesting_progress_fully_vested() {
        let schedule = make_schedule(1_000_000, 0, 100, 0, 200);
        assert_eq!(vesting_progress_bps(&schedule, 300), 10_000);
    }

    #[test]
    fn test_vesting_progress_beyond_end() {
        let schedule = make_schedule(1_000_000, 0, 100, 0, 200);
        assert_eq!(vesting_progress_bps(&schedule, 500), 10_000);
    }

    // ============ Staking Tests ============

    #[test]
    fn test_stake_reward_fresh_stake() {
        let pos = make_stake(1_000_000, 100, 10_000);
        // At start block, 0 elapsed, multiplier = 1x
        let reward = stake_reward(&pos, 1_000, 100);
        assert_eq!(reward, 1_000); // 1x multiplier
    }

    #[test]
    fn test_stake_reward_half_duration() {
        let pos = make_stake(1_000_000, 100, 10_000);
        // 5000 blocks elapsed, half of lock duration
        let reward = stake_reward(&pos, 10_000, 5_100);
        // multiplier = 10000 + (30000-10000)*5000/10000 = 10000 + 10000 = 20000 bps = 2x
        assert_eq!(reward, 20_000);
    }

    #[test]
    fn test_stake_reward_full_duration() {
        let pos = make_stake(1_000_000, 100, 10_000);
        // Full duration elapsed
        let reward = stake_reward(&pos, 10_000, 10_100);
        // multiplier = 30000 bps = 3x
        assert_eq!(reward, 30_000);
    }

    #[test]
    fn test_stake_reward_beyond_max_duration() {
        let pos = make_stake(1_000_000, 100, 10_000);
        // Way beyond lock duration — capped at max
        let reward = stake_reward(&pos, 10_000, 100_100);
        // multiplier still 30000 bps = 3x (capped)
        assert_eq!(reward, 30_000);
    }

    #[test]
    fn test_stake_reward_before_start() {
        let pos = make_stake(1_000_000, 100, 10_000);
        let reward = stake_reward(&pos, 10_000, 50);
        assert_eq!(reward, 0);
    }

    #[test]
    fn test_stake_reward_zero_base() {
        let pos = make_stake(1_000_000, 100, 10_000);
        let reward = stake_reward(&pos, 0, 5_100);
        assert_eq!(reward, 0);
    }

    #[test]
    fn test_stake_reward_zero_amount() {
        let pos = make_stake(0, 100, 10_000);
        let reward = stake_reward(&pos, 10_000, 5_100);
        assert_eq!(reward, 0);
    }

    // ============ Time Weighted Multiplier Tests ============

    #[test]
    fn test_time_multiplier_zero_duration() {
        assert_eq!(time_weighted_multiplier(1000, 0, MAX_MULTIPLIER_BPS), 10_000);
    }

    #[test]
    fn test_time_multiplier_max_below_base() {
        // If max_multiplier_bps <= 10000, return base (1x)
        assert_eq!(time_weighted_multiplier(1000, 10_000, 10_000), 10_000);
        assert_eq!(time_weighted_multiplier(1000, 10_000, 5_000), 10_000);
    }

    #[test]
    fn test_time_multiplier_linear_growth() {
        // 25% of max_duration -> 25% of bonus range
        // bonus_range = 30000 - 10000 = 20000, 25% = 5000
        // multiplier = 10000 + 5000 = 15000
        assert_eq!(time_weighted_multiplier(2_500, 10_000, 30_000), 15_000);
    }

    #[test]
    fn test_time_multiplier_at_max() {
        assert_eq!(time_weighted_multiplier(10_000, 10_000, 30_000), 30_000);
    }

    #[test]
    fn test_time_multiplier_beyond_max() {
        assert_eq!(time_weighted_multiplier(50_000, 10_000, 30_000), 30_000);
    }

    #[test]
    fn test_time_multiplier_zero_elapsed() {
        assert_eq!(time_weighted_multiplier(0, 10_000, 30_000), 10_000);
    }

    // ============ Loyalty Tier Tests ============

    #[test]
    fn test_loyalty_tier_base() {
        let tiers = default_tiers();
        let tier = loyalty_tier(0, &tiers).unwrap();
        assert_eq!(tier.tier_id, 0);
    }

    #[test]
    fn test_loyalty_tier_exact_threshold() {
        let tiers = default_tiers();
        let tier = loyalty_tier(100, &tiers).unwrap();
        assert_eq!(tier.tier_id, 1);
    }

    #[test]
    fn test_loyalty_tier_between_thresholds() {
        let tiers = default_tiers();
        let tier = loyalty_tier(300, &tiers).unwrap();
        assert_eq!(tier.tier_id, 1); // 300 >= 100 but < 500
    }

    #[test]
    fn test_loyalty_tier_highest() {
        let tiers = default_tiers();
        let tier = loyalty_tier(50_000, &tiers).unwrap();
        assert_eq!(tier.tier_id, 4);
    }

    #[test]
    fn test_loyalty_tier_empty_tiers() {
        let tiers: Vec<LoyaltyTier> = vec![];
        assert!(loyalty_tier(1000, &tiers).is_none());
    }

    #[test]
    fn test_loyalty_tier_discount_values() {
        let tiers = default_tiers();
        let tier = loyalty_tier(2000, &tiers).unwrap();
        assert_eq!(tier.fee_discount_bps, 1000);
        assert_eq!(tier.boost_multiplier_bps, 15_000);
    }

    // ============ Loyalty Points Tests ============

    #[test]
    fn test_loyalty_points_base_only() {
        let points = loyalty_points_earned(0, 0);
        assert_eq!(points, BASE_LOYALTY_POINTS_PER_EPOCH); // 100
    }

    #[test]
    fn test_loyalty_points_with_volume() {
        // 10 PRECISION units of volume = 10 bonus points
        let points = loyalty_points_earned(PRECISION * 10, 0);
        assert_eq!(points, 110); // 100 base + 10 volume
    }

    #[test]
    fn test_loyalty_points_volume_cap() {
        // Huge volume, capped at 500
        let points = loyalty_points_earned(PRECISION * 1_000_000, 0);
        assert_eq!(points, 600); // 100 base + 500 capped
    }

    #[test]
    fn test_loyalty_points_consecutive_bonus() {
        // 10 consecutive epochs: 100 * 10 * 500 / 10000 = 50
        let points = loyalty_points_earned(0, 10);
        assert_eq!(points, 150); // 100 base + 50 consecutive
    }

    #[test]
    fn test_loyalty_points_combined() {
        // 5 PRECISION volume + 5 consecutive epochs
        // base=100, volume=5, consecutive=100*5*500/10000=25
        let points = loyalty_points_earned(PRECISION * 5, 5);
        assert_eq!(points, 130); // 100 + 5 + 25
    }

    // ============ Fee Discount Tests ============

    #[test]
    fn test_fee_discount_base_tier() {
        let tier = LoyaltyTier {
            tier_id: 0,
            min_points: 0,
            fee_discount_bps: 0,
            boost_multiplier_bps: 10_000,
        };
        assert_eq!(fee_discount(&tier, 1_000), 1_000); // No discount
    }

    #[test]
    fn test_fee_discount_silver() {
        let tier = LoyaltyTier {
            tier_id: 1,
            min_points: 100,
            fee_discount_bps: 500, // 5%
            boost_multiplier_bps: 11_000,
        };
        assert_eq!(fee_discount(&tier, 10_000), 9_500);
    }

    #[test]
    fn test_fee_discount_max_discount() {
        let tier = LoyaltyTier {
            tier_id: 4,
            min_points: 10_000,
            fee_discount_bps: 10_000, // 100%
            boost_multiplier_bps: 20_000,
        };
        assert_eq!(fee_discount(&tier, 10_000), 0); // Full discount
    }

    #[test]
    fn test_fee_discount_zero_base_fee() {
        let tier = LoyaltyTier {
            tier_id: 2,
            min_points: 500,
            fee_discount_bps: 500,
            boost_multiplier_bps: 12_500,
        };
        assert_eq!(fee_discount(&tier, 0), 0);
    }

    #[test]
    fn test_fee_discount_large_amount() {
        let tier = LoyaltyTier {
            tier_id: 3,
            min_points: 2000,
            fee_discount_bps: 1000, // 10%
            boost_multiplier_bps: 15_000,
        };
        let base = PRECISION * 100; // 100 tokens
        let discounted = fee_discount(&tier, base);
        assert_eq!(discounted, mul_div(base, 9_000, 10_000));
    }

    // ============ Epoch Rewards Tests ============

    #[test]
    fn test_epoch_rewards_normal() {
        let er = epoch_rewards_breakdown(1_000, 500, 42, 200);
        assert_eq!(er.epoch, 42);
        assert_eq!(er.total_rewards, 1_700);
        assert_eq!(er.fee_rewards, 1_000);
        assert_eq!(er.emission_rewards, 500);
        assert_eq!(er.bonus_rewards, 200);
    }

    #[test]
    fn test_epoch_rewards_zero_fees() {
        let er = epoch_rewards_breakdown(0, 500, 1, 100);
        assert_eq!(er.total_rewards, 600);
        assert_eq!(er.fee_rewards, 0);
    }

    #[test]
    fn test_epoch_rewards_zero_emission() {
        let er = epoch_rewards_breakdown(1_000, 0, 2, 100);
        assert_eq!(er.total_rewards, 1_100);
        assert_eq!(er.emission_rewards, 0);
    }

    #[test]
    fn test_epoch_rewards_zero_bonus() {
        let er = epoch_rewards_breakdown(1_000, 500, 3, 0);
        assert_eq!(er.total_rewards, 1_500);
        assert_eq!(er.bonus_rewards, 0);
    }

    #[test]
    fn test_epoch_rewards_all_zero() {
        let er = epoch_rewards_breakdown(0, 0, 0, 0);
        assert_eq!(er.total_rewards, 0);
    }

    // ============ Summary Tests ============

    #[test]
    fn test_summary_empty() {
        let summary = reward_summary(&[]);
        assert_eq!(summary.total_distributed, 0);
        assert_eq!(summary.unique_recipients, 0);
        assert_eq!(summary.avg_reward, 0);
        assert_eq!(summary.top_contributor_share_bps, 0);
    }

    #[test]
    fn test_summary_single_allocation() {
        let allocs = vec![ShapleyAllocation {
            address: addr(1),
            amount: 5_000,
            share_bps: 10_000,
            contribution_type: ContributionType::LiquidityProvider,
        }];
        let summary = reward_summary(&allocs);
        assert_eq!(summary.total_distributed, 5_000);
        assert_eq!(summary.unique_recipients, 1);
        assert_eq!(summary.avg_reward, 5_000);
        assert_eq!(summary.top_contributor_share_bps, 10_000);
    }

    #[test]
    fn test_summary_multiple_allocations() {
        let allocs = vec![
            ShapleyAllocation {
                address: addr(1),
                amount: 7_000,
                share_bps: 7_000,
                contribution_type: ContributionType::LiquidityProvider,
            },
            ShapleyAllocation {
                address: addr(2),
                amount: 3_000,
                share_bps: 3_000,
                contribution_type: ContributionType::Trader,
            },
        ];
        let summary = reward_summary(&allocs);
        assert_eq!(summary.total_distributed, 10_000);
        assert_eq!(summary.unique_recipients, 2);
        assert_eq!(summary.avg_reward, 5_000);
        assert_eq!(summary.top_contributor_share_bps, 7_000);
    }

    #[test]
    fn test_summary_duplicate_addresses() {
        // Same address appears twice — should count as 1 unique
        let allocs = vec![
            ShapleyAllocation {
                address: addr(1),
                amount: 3_000,
                share_bps: 3_000,
                contribution_type: ContributionType::LiquidityProvider,
            },
            ShapleyAllocation {
                address: addr(1),
                amount: 7_000,
                share_bps: 7_000,
                contribution_type: ContributionType::Trader,
            },
        ];
        let summary = reward_summary(&allocs);
        assert_eq!(summary.total_distributed, 10_000);
        assert_eq!(summary.unique_recipients, 1);
        assert_eq!(summary.avg_reward, 10_000); // 10000 / 1 unique
    }

    // ============ Weight Validation Tests ============

    #[test]
    fn test_validate_weights_valid() {
        let contributors = vec![
            make_contributor(1, 100, ContributionType::LiquidityProvider),
            make_contributor(2, 200, ContributionType::Trader),
        ];
        assert!(validate_weights(&contributors).is_ok());
    }

    #[test]
    fn test_validate_weights_empty() {
        let result = validate_weights(&[]);
        assert_eq!(result, Err(RewardsError::NoContributions));
    }

    #[test]
    fn test_validate_weights_zero_weight() {
        let contributors = vec![
            make_contributor(1, 100, ContributionType::LiquidityProvider),
            make_contributor(2, 0, ContributionType::Trader),
        ];
        assert_eq!(validate_weights(&contributors), Err(RewardsError::InvalidWeight));
    }

    #[test]
    fn test_validate_weights_too_many() {
        let contributors: Vec<ContributorShare> = (0..257)
            .map(|i| make_contributor((i % 256) as u8, 1, ContributionType::Trader))
            .collect();
        assert_eq!(validate_weights(&contributors), Err(RewardsError::InvalidWeight));
    }

    #[test]
    fn test_validate_weights_exactly_max() {
        let contributors: Vec<ContributorShare> = (0..256)
            .map(|i| make_contributor(i as u8, 1, ContributionType::Trader))
            .collect();
        assert!(validate_weights(&contributors).is_ok());
    }

    #[test]
    fn test_validate_weights_single_contributor() {
        let contributors = vec![make_contributor(1, 1, ContributionType::Governance)];
        assert!(validate_weights(&contributors).is_ok());
    }

    #[test]
    fn test_validate_weights_large_weights() {
        let contributors = vec![
            make_contributor(1, u128::MAX / 2, ContributionType::LiquidityProvider),
            make_contributor(2, u128::MAX / 2, ContributionType::Trader),
        ];
        assert!(validate_weights(&contributors).is_ok());
    }

    // ============ Merge Contributions Tests ============

    #[test]
    fn test_merge_disjoint() {
        let a = vec![make_contributor(1, 100, ContributionType::LiquidityProvider)];
        let b = vec![make_contributor(2, 200, ContributionType::Trader)];
        let merged = merge_contributions(&a, &b);
        assert_eq!(merged.len(), 2);
        // BTreeMap iterates in key order — addr(1) < addr(2)
        assert_eq!(merged[0].address, addr(1));
        assert_eq!(merged[0].weight, 100);
        assert_eq!(merged[1].address, addr(2));
        assert_eq!(merged[1].weight, 200);
    }

    #[test]
    fn test_merge_overlapping() {
        let a = vec![make_contributor(1, 100, ContributionType::LiquidityProvider)];
        let b = vec![make_contributor(1, 200, ContributionType::Trader)];
        let merged = merge_contributions(&a, &b);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].weight, 300); // Summed
        // First occurrence wins for contribution_type
        assert_eq!(merged[0].contribution_type, ContributionType::LiquidityProvider);
    }

    #[test]
    fn test_merge_both_empty() {
        let merged = merge_contributions(&[], &[]);
        assert!(merged.is_empty());
    }

    #[test]
    fn test_merge_one_empty() {
        let a = vec![
            make_contributor(1, 100, ContributionType::LiquidityProvider),
            make_contributor(2, 50, ContributionType::Trader),
        ];
        let merged = merge_contributions(&a, &[]);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].weight, 100);
        assert_eq!(merged[1].weight, 50);
    }

    #[test]
    fn test_merge_complex() {
        let a = vec![
            make_contributor(1, 100, ContributionType::LiquidityProvider),
            make_contributor(2, 200, ContributionType::Trader),
            make_contributor(3, 300, ContributionType::Relayer),
        ];
        let b = vec![
            make_contributor(2, 50, ContributionType::Validator),
            make_contributor(4, 400, ContributionType::OracleOperator),
        ];
        let merged = merge_contributions(&a, &b);
        assert_eq!(merged.len(), 4);
        // addr(2) should have summed weight
        let addr2 = merged.iter().find(|c| c.address == addr(2)).unwrap();
        assert_eq!(addr2.weight, 250);
        assert_eq!(addr2.contribution_type, ContributionType::Trader); // First wins
    }

    // ============ Integration / Cross-Function Tests ============

    #[test]
    fn test_distribute_then_summarize() {
        let contributors = vec![
            make_contributor(1, 60, ContributionType::LiquidityProvider),
            make_contributor(2, 30, ContributionType::Trader),
            make_contributor(3, 10, ContributionType::Relayer),
        ];
        let allocs = shapley_distribute(1_000_000, &contributors).unwrap();
        let summary = reward_summary(&allocs);
        assert_eq!(summary.total_distributed, 1_000_000);
        assert_eq!(summary.unique_recipients, 3);
        assert_eq!(summary.top_contributor_share_bps, 6_000);
    }

    #[test]
    fn test_merge_then_distribute() {
        let a = vec![make_contributor(1, 100, ContributionType::LiquidityProvider)];
        let b = vec![
            make_contributor(1, 50, ContributionType::LiquidityProvider),
            make_contributor(2, 150, ContributionType::Trader),
        ];
        let merged = merge_contributions(&a, &b);
        // addr(1) = 150, addr(2) = 150 — equal
        let allocs = shapley_distribute(10_000, &merged).unwrap();
        assert_eq!(allocs.len(), 2);
        let total: u128 = allocs.iter().map(|a| a.amount).sum();
        assert_eq!(total, 10_000);
        assert_eq!(allocs[0].amount, 5_000);
        assert_eq!(allocs[1].amount, 5_000);
    }

    #[test]
    fn test_vesting_and_staking_combined() {
        // User has a vesting schedule and a stake
        let schedule = make_schedule(1_000_000, 0, 100, 50, 200);
        let pos = make_stake(500_000, 100, 10_000);

        let current = 200; // 100 blocks after start

        let vested = vesting_claimable(&schedule, current).unwrap();
        assert_eq!(vested, 500_000); // 100/200 = 50%

        let staking = stake_reward(&pos, 10_000, current);
        // 100 blocks elapsed out of 10000 lock
        // multiplier = 10000 + 20000 * 100/10000 = 10000 + 200 = 10200
        assert_eq!(staking, 10_200);
    }

    #[test]
    fn test_loyalty_tier_then_fee_discount() {
        let tiers = default_tiers();
        let tier = loyalty_tier(2500, &tiers).unwrap();
        assert_eq!(tier.tier_id, 3); // 2500 >= 2000
        let discounted = fee_discount(tier, 10_000);
        assert_eq!(discounted, 9_000); // 10% discount
    }

    #[test]
    fn test_epoch_rewards_then_distribute() {
        let er = epoch_rewards_breakdown(5_000, 3_000, 10, 2_000);
        assert_eq!(er.total_rewards, 10_000);

        let contributors = vec![
            make_contributor(1, 70, ContributionType::LiquidityProvider),
            make_contributor(2, 30, ContributionType::Trader),
        ];
        let allocs = shapley_distribute(er.total_rewards, &contributors).unwrap();
        assert_eq!(allocs[0].amount, 7_000);
        assert_eq!(allocs[1].amount, 3_000);
    }

    #[test]
    fn test_full_lifecycle() {
        // Epoch rewards -> Shapley distribute -> Summary -> Loyalty points -> Fee discount
        let er = epoch_rewards_breakdown(50_000, 30_000, 1, 20_000);

        let contributors = vec![
            make_contributor(1, 50, ContributionType::LiquidityProvider),
            make_contributor(2, 30, ContributionType::Trader),
            make_contributor(3, 20, ContributionType::Validator),
        ];

        let allocs = shapley_distribute(er.total_rewards, &contributors).unwrap();
        let summary = reward_summary(&allocs);
        assert_eq!(summary.total_distributed, 100_000);
        assert_eq!(summary.unique_recipients, 3);

        // Trader earns loyalty from trading volume
        let points = loyalty_points_earned(PRECISION * 50, 10);
        assert!(points > BASE_LOYALTY_POINTS_PER_EPOCH);

        let tiers = default_tiers();
        let tier = loyalty_tier(points, &tiers).unwrap();
        let discounted = fee_discount(tier, 1_000);
        assert!(discounted < 1_000); // Got some discount
    }
}
