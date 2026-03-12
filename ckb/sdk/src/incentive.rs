// ============ Incentive — Protocol Incentive Engine ============
// Computes and distributes protocol incentives including liquidity mining,
// trading rewards, referral bonuses, loyalty multipliers, and airdrop
// calculations for the VibeSwap protocol on CKB.
//
// Key capabilities:
// - Incentive pool lifecycle: creation, distribution, utilization tracking
// - Liquidity mining with proportional share and boost mechanics
// - Trading reward rebates with volume-tiered multipliers
// - Multi-level referral system with lifetime caps
// - Loyalty tier progression: Bronze → Silver → Gold → Platinum
// - Streak bonuses for consecutive daily activity
// - Airdrop computation (equal or pro-rata) with eligibility filtering
// - Reward claiming, auto-compounding, and analytics
// - Governance participation rewards
// - Multi-pool analytics: APR comparison, fairness (Gini), expiry detection
//
// Philosophy: Cooperative Capitalism — positive-sum incentives reward
// long-term participation and community growth, not extraction.

use vibeswap_math::mul_div;

// ============ Constants ============

/// Basis points denominator
pub const BPS: u128 = 10_000;

/// Scaling factor for reward-per-share calculations (1e8)
pub const RPS_SCALE: u128 = 100_000_000;

/// Seconds in one year (365.25 days)
pub const SECONDS_PER_YEAR: u64 = 31_557_600;

/// Seconds in one day
pub const SECONDS_PER_DAY: u64 = 86_400;

/// Maximum streak bonus in basis points (30%)
pub const MAX_STREAK_BONUS_BPS: u64 = 3_000;

/// Streak bonus per day in basis points (1%)
pub const STREAK_BONUS_PER_DAY_BPS: u64 = 100;

/// Default referral depth
pub const DEFAULT_REFERRAL_DEPTH: u32 = 1;

/// Maximum referral depth allowed
pub const MAX_REFERRAL_DEPTH: u32 = 5;

/// Depth decay factor in basis points (50% per level)
pub const REFERRAL_DEPTH_DECAY_BPS: u64 = 5_000;

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum IncentiveError {
    /// Pool has passed its end_time
    PoolExpired,
    /// Pool budget is fully distributed
    PoolDepleted,
    /// Amount is below minimum qualifying threshold
    BelowMinimum,
    /// Reward has already been claimed
    AlreadyClaimed,
    /// Start/end time configuration is invalid
    InvalidPeriod,
    /// User does not meet eligibility criteria
    NotEligible,
    /// Lifetime or per-pool cap has been reached
    CapReached,
    /// Multiplier value is invalid (zero or unreasonable)
    InvalidMultiplier,
    /// Referenced pool does not exist
    PoolNotFound,
    /// Referenced user does not exist
    UserNotFound,
    /// Arithmetic overflow
    Overflow,
    /// Amount is zero
    ZeroAmount,
    /// Referral configuration is invalid
    InvalidReferral,
    /// User attempted to refer themselves
    SelfReferral,
    /// Referral chain forms a cycle
    CircularReferral,
}

// ============ Data Types ============

/// Type of incentive program
#[derive(Debug, Clone, PartialEq)]
pub enum IncentiveType {
    /// Rewards for liquidity providers
    LiquidityMining,
    /// Fee rebates for traders
    TradingReward,
    /// Referrer + referee rewards
    ReferralBonus,
    /// Boost for long-term users
    LoyaltyMultiplier,
    /// One-time token distributions
    Airdrop,
    /// veVIBE staking rewards
    StakingReward,
    /// Voting participation rewards
    GovernanceReward,
}

/// An incentive pool with budget, schedule, and distribution tracking
#[derive(Debug, Clone)]
pub struct IncentivePool {
    pub pool_id: [u8; 32],
    pub incentive_type: IncentiveType,
    pub total_budget: u64,
    pub distributed: u64,
    pub remaining: u64,
    pub start_time: u64,
    pub end_time: u64,
    pub rate_per_second: u64,
    pub participants: u64,
    pub min_qualifying_amount: u64,
}

/// Per-user incentive state within a pool
#[derive(Debug, Clone)]
pub struct UserIncentive {
    pub user: [u8; 32],
    pub pool_id: [u8; 32],
    pub earned: u64,
    pub claimed: u64,
    pub unclaimed: u64,
    pub loyalty_multiplier_bps: u64,
    pub referral_count: u32,
    pub last_action_time: u64,
    pub streak_days: u32,
}

/// Configuration for the referral reward program
#[derive(Debug, Clone)]
pub struct ReferralConfig {
    pub referrer_reward_bps: u64,
    pub referee_discount_bps: u64,
    pub max_referral_depth: u32,
    pub min_referee_volume: u64,
    pub lifetime_cap: u64,
}

/// Configuration for an airdrop distribution
#[derive(Debug, Clone)]
pub struct AirdropConfig {
    pub total_amount: u64,
    pub snapshot_height: u64,
    pub criteria_min_balance: u64,
    pub criteria_min_volume: u64,
    pub criteria_min_age_blocks: u64,
    pub pro_rata: bool,
}

/// A loyalty tier with benefits
#[derive(Debug, Clone)]
pub struct LoyaltyTier {
    pub name_hash: [u8; 32],
    pub min_days: u32,
    pub multiplier_bps: u64,
    pub fee_discount_bps: u64,
    pub priority_access: bool,
}

/// Aggregate incentive statistics across pools and users
#[derive(Debug, Clone)]
pub struct IncentiveStats {
    pub total_distributed: u128,
    pub total_participants: u64,
    pub avg_reward_per_user: u64,
    pub distribution_gini: u64,
    pub active_pools: u64,
    pub total_referrals: u64,
    pub avg_loyalty_multiplier: u64,
}

// ============ Pool Management ============

/// Create a new incentive pool with the given parameters.
/// Computes rate_per_second from budget and duration.
pub fn create_pool(
    pool_id: [u8; 32],
    itype: IncentiveType,
    budget: u64,
    start: u64,
    end: u64,
    min_amount: u64,
) -> Result<IncentivePool, IncentiveError> {
    if budget == 0 {
        return Err(IncentiveError::ZeroAmount);
    }
    if end <= start {
        return Err(IncentiveError::InvalidPeriod);
    }
    let duration = end - start;
    // rate_per_second scaled by 1e8 for precision
    let rate = mul_div(budget as u128, RPS_SCALE, duration as u128) as u64;
    Ok(IncentivePool {
        pool_id,
        incentive_type: itype,
        total_budget: budget,
        distributed: 0,
        remaining: budget,
        start_time: start,
        end_time: end,
        rate_per_second: rate,
        participants: 0,
        min_qualifying_amount: min_amount,
    })
}

/// Distribute tokens from a pool. Returns the actual amount distributed
/// (capped by remaining budget). Validates pool is active.
pub fn distribute(
    pool: &mut IncentivePool,
    amount: u64,
    now: u64,
) -> Result<u64, IncentiveError> {
    if amount == 0 {
        return Err(IncentiveError::ZeroAmount);
    }
    if !is_active(pool, now) {
        if now >= pool.end_time {
            return Err(IncentiveError::PoolExpired);
        }
    }
    if pool.remaining == 0 {
        return Err(IncentiveError::PoolDepleted);
    }
    let actual = if amount > pool.remaining {
        pool.remaining
    } else {
        amount
    };
    pool.distributed += actual;
    pool.remaining -= actual;
    Ok(actual)
}

/// Pool utilization in basis points: distributed / budget * 10000
pub fn pool_utilization_bps(pool: &IncentivePool) -> u64 {
    if pool.total_budget == 0 {
        return 0;
    }
    mul_div(pool.distributed as u128, BPS, pool.total_budget as u128) as u64
}

/// Seconds remaining until pool end_time. Returns 0 if already past.
pub fn time_remaining(pool: &IncentivePool, now: u64) -> u64 {
    if now >= pool.end_time {
        0
    } else {
        pool.end_time - now
    }
}

/// Whether a pool is currently active (within time bounds and has budget).
pub fn is_active(pool: &IncentivePool, now: u64) -> bool {
    now >= pool.start_time && now < pool.end_time && pool.remaining > 0
}

/// Projected timestamp when the pool will be depleted at current rate.
/// Returns end_time if rate would deplete after pool expires.
pub fn projected_depletion(pool: &IncentivePool, now: u64) -> u64 {
    if pool.remaining == 0 || pool.rate_per_second == 0 {
        return now;
    }
    // rate_per_second is scaled by 1e8, so seconds = remaining * 1e8 / rate
    let seconds_left =
        mul_div(pool.remaining as u128, RPS_SCALE, pool.rate_per_second as u128) as u64;
    let depletion = now.saturating_add(seconds_left);
    if depletion > pool.end_time {
        pool.end_time
    } else {
        depletion
    }
}

// ============ Liquidity Mining ============

/// Compute proportional LP reward: lp_shares / total_shares * reward_per_period
pub fn compute_lp_reward(lp_shares: u64, total_shares: u64, reward_per_period: u64) -> u64 {
    if total_shares == 0 || lp_shares == 0 {
        return 0;
    }
    mul_div(lp_shares as u128, reward_per_period as u128, total_shares as u128) as u64
}

/// Apply a boost multiplier to a base reward: base * boost_bps / 10000
pub fn boosted_lp_reward(base_reward: u64, boost_bps: u64) -> u64 {
    if base_reward == 0 || boost_bps == 0 {
        return 0;
    }
    mul_div(base_reward as u128, boost_bps as u128, BPS) as u64
}

/// Accumulated reward per LP share over elapsed_seconds.
/// Returns value scaled by 1e8 (RPS_SCALE).
pub fn reward_per_share(
    pool: &IncentivePool,
    total_shares: u64,
    elapsed_seconds: u64,
) -> u64 {
    if total_shares == 0 || elapsed_seconds == 0 {
        return 0;
    }
    // total_reward = rate_per_second * elapsed / RPS_SCALE (unscale rate)
    // rps = total_reward * RPS_SCALE / total_shares
    // Simplifies to: rate_per_second * elapsed / total_shares
    let total_reward = mul_div(
        pool.rate_per_second as u128,
        elapsed_seconds as u128,
        RPS_SCALE,
    );
    mul_div(total_reward, RPS_SCALE, total_shares as u128) as u64
}

/// Pending reward for a user: shares * reward_per_share / RPS_SCALE - debt
pub fn pending_reward(
    user_shares: u64,
    reward_per_share: u64,
    user_reward_debt: u64,
) -> u64 {
    let gross = mul_div(user_shares as u128, reward_per_share as u128, RPS_SCALE) as u64;
    gross.saturating_sub(user_reward_debt)
}

// ============ Trading Rewards ============

/// Compute trading reward rebate: fee_paid * rebate_bps / 10000
pub fn compute_trading_reward(volume: u64, fee_paid: u64, rebate_bps: u64) -> u64 {
    let _ = volume; // Volume tracked for analytics; rebate is on fees
    if fee_paid == 0 || rebate_bps == 0 {
        return 0;
    }
    mul_div(fee_paid as u128, rebate_bps as u128, BPS) as u64
}

/// Determine the multiplier for a given volume from tier thresholds.
/// `tiers` is sorted ascending by threshold: [(threshold, multiplier_bps)].
/// Returns the highest qualifying multiplier, or 10000 (1x) if none match.
pub fn volume_tier_multiplier(volume: u64, tiers: &[(u64, u64)]) -> u64 {
    let mut result = 10_000u64; // 1x default
    for &(threshold, mult) in tiers {
        if volume >= threshold {
            result = mult;
        }
    }
    result
}

/// Split a fee between maker and taker rewards.
/// Returns (maker_reward, taker_reward) where maker gets maker_bps/10000.
pub fn maker_taker_split(fee: u64, maker_bps: u64) -> (u64, u64) {
    if fee == 0 {
        return (0, 0);
    }
    let maker = mul_div(fee as u128, maker_bps as u128, BPS) as u64;
    let taker = fee.saturating_sub(maker);
    (maker, taker)
}

// ============ Referral System ============

/// Compute referral rewards: referrer gets referrer_reward_bps of referee fees,
/// referee gets fee discount. Returns (referrer_reward, referee_discount).
pub fn compute_referral_reward(
    referee_fees: u64,
    config: &ReferralConfig,
) -> (u64, u64) {
    if referee_fees == 0 {
        return (0, 0);
    }
    let referrer_reward = mul_div(
        referee_fees as u128,
        config.referrer_reward_bps as u128,
        BPS,
    ) as u64;
    let referee_discount = mul_div(
        referee_fees as u128,
        config.referee_discount_bps as u128,
        BPS,
    ) as u64;
    (referrer_reward, referee_discount)
}

/// Validate that a referral relationship is valid.
/// No self-referrals, no zero addresses.
pub fn validate_referral(
    referrer: &[u8; 32],
    referee: &[u8; 32],
) -> Result<(), IncentiveError> {
    if referrer == referee {
        return Err(IncentiveError::SelfReferral);
    }
    if *referrer == [0u8; 32] || *referee == [0u8; 32] {
        return Err(IncentiveError::InvalidReferral);
    }
    Ok(())
}

/// Compute rewards at each depth level of a referral chain.
/// Each level decays by REFERRAL_DEPTH_DECAY_BPS (50%).
/// Returns a vector of rewards from depth 0 to min(depth, max_referral_depth).
pub fn referral_chain_reward(
    fees: u64,
    config: &ReferralConfig,
    depth: u32,
) -> Vec<u64> {
    let max_depth = depth.min(config.max_referral_depth);
    let mut rewards = Vec::with_capacity(max_depth as usize);
    let base_reward = mul_div(fees as u128, config.referrer_reward_bps as u128, BPS) as u64;
    let mut current = base_reward;
    for _ in 0..max_depth {
        rewards.push(current);
        current = mul_div(current as u128, REFERRAL_DEPTH_DECAY_BPS as u128, BPS) as u64;
    }
    rewards
}

/// Cap a referral reward to the remaining lifetime cap.
pub fn cap_referral_reward(reward: u64, earned_so_far: u64, lifetime_cap: u64) -> u64 {
    if earned_so_far >= lifetime_cap {
        return 0;
    }
    let remaining = lifetime_cap - earned_so_far;
    if reward > remaining {
        remaining
    } else {
        reward
    }
}

// ============ Loyalty System ============

/// Create the default loyalty tier progression.
/// Bronze (0d, 1x), Silver (30d, 1.2x), Gold (90d, 1.5x), Platinum (365d, 2x).
pub fn default_loyalty_tiers() -> Vec<LoyaltyTier> {
    vec![
        LoyaltyTier {
            name_hash: {
                let mut h = [0u8; 32];
                h[0] = b'B';
                h[1] = b'r';
                h[2] = b'o';
                h[3] = b'n';
                h
            },
            min_days: 0,
            multiplier_bps: 10_000,
            fee_discount_bps: 0,
            priority_access: false,
        },
        LoyaltyTier {
            name_hash: {
                let mut h = [0u8; 32];
                h[0] = b'S';
                h[1] = b'i';
                h[2] = b'l';
                h[3] = b'v';
                h
            },
            min_days: 30,
            multiplier_bps: 12_000,
            fee_discount_bps: 200,
            priority_access: false,
        },
        LoyaltyTier {
            name_hash: {
                let mut h = [0u8; 32];
                h[0] = b'G';
                h[1] = b'o';
                h[2] = b'l';
                h[3] = b'd';
                h
            },
            min_days: 90,
            multiplier_bps: 15_000,
            fee_discount_bps: 400,
            priority_access: true,
        },
        LoyaltyTier {
            name_hash: {
                let mut h = [0u8; 32];
                h[0] = b'P';
                h[1] = b'l';
                h[2] = b'a';
                h[3] = b't';
                h
            },
            min_days: 365,
            multiplier_bps: 20_000,
            fee_discount_bps: 500,
            priority_access: true,
        },
    ]
}

/// Find the highest qualifying loyalty tier for a given number of active days.
pub fn compute_loyalty_tier<'a>(
    active_days: u32,
    tiers: &'a [LoyaltyTier],
) -> Option<&'a LoyaltyTier> {
    let mut best: Option<&LoyaltyTier> = None;
    for tier in tiers {
        if active_days >= tier.min_days {
            match best {
                None => best = Some(tier),
                Some(b) => {
                    if tier.min_days >= b.min_days {
                        best = Some(tier);
                    }
                }
            }
        }
    }
    best
}

/// Get the multiplier_bps for the user's current loyalty tier.
/// Returns 10000 (1x) if no tier matches.
pub fn loyalty_multiplier(active_days: u32, tiers: &[LoyaltyTier]) -> u64 {
    match compute_loyalty_tier(active_days, tiers) {
        Some(tier) => tier.multiplier_bps,
        None => 10_000,
    }
}

/// Compute streak bonus: 1% per consecutive day, max 30%.
/// Returns additional reward amount.
pub fn streak_bonus(streak_days: u32, base_reward: u64) -> u64 {
    if streak_days == 0 || base_reward == 0 {
        return 0;
    }
    let bonus_bps = (streak_days as u64 * STREAK_BONUS_PER_DAY_BPS).min(MAX_STREAK_BONUS_BPS);
    mul_div(base_reward as u128, bonus_bps as u128, BPS) as u64
}

/// Check if a user is within one day of their last action (maintains streak).
/// `day_ms` is the duration of one day in the time unit being used.
pub fn check_streak(last_action: u64, now: u64, day_ms: u64) -> bool {
    if now < last_action || day_ms == 0 {
        return false;
    }
    let elapsed = now - last_action;
    elapsed <= day_ms
}

/// Update a user's streak: increment if within one day, reset otherwise.
/// `day_ms` is the duration of one day in the time unit being used.
pub fn update_streak(user: &mut UserIncentive, now: u64, day_ms: u64) {
    if day_ms == 0 {
        return;
    }
    if user.last_action_time == 0 {
        // First action ever
        user.streak_days = 1;
    } else if check_streak(user.last_action_time, now, day_ms) {
        // Check they've actually been away for at least half a day
        // to avoid double-counting within the same day
        let elapsed = now.saturating_sub(user.last_action_time);
        if elapsed >= day_ms / 2 {
            user.streak_days += 1;
        }
    } else {
        // Streak broken — reset
        user.streak_days = 1;
    }
    user.last_action_time = now;
}

// ============ Airdrop ============

/// Compute equal airdrop amount per eligible user.
pub fn compute_airdrop_equal(config: &AirdropConfig, eligible_count: u64) -> u64 {
    if eligible_count == 0 || config.total_amount == 0 {
        return 0;
    }
    config.total_amount / eligible_count
}

/// Compute pro-rata airdrop amount for a user based on balance share.
pub fn compute_airdrop_prorata(
    config: &AirdropConfig,
    user_balance: u64,
    total_eligible_balance: u64,
) -> u64 {
    if total_eligible_balance == 0 || user_balance == 0 || config.total_amount == 0 {
        return 0;
    }
    mul_div(
        config.total_amount as u128,
        user_balance as u128,
        total_eligible_balance as u128,
    ) as u64
}

/// Check if a user meets all airdrop eligibility criteria.
pub fn is_airdrop_eligible(
    balance: u64,
    volume: u64,
    account_age: u64,
    config: &AirdropConfig,
) -> bool {
    balance >= config.criteria_min_balance
        && volume >= config.criteria_min_volume
        && account_age >= config.criteria_min_age_blocks
}

/// Compute airdrop distribution for all users.
/// Filters eligible users by criteria_min_balance, then distributes
/// either equally or pro-rata based on config.pro_rata.
pub fn airdrop_distribution(
    config: &AirdropConfig,
    balances: &[([u8; 32], u64)],
) -> Vec<([u8; 32], u64)> {
    // Filter eligible users (using balance as the only filter here,
    // since we only have balance data in this call)
    let eligible: Vec<_> = balances
        .iter()
        .filter(|(_, bal)| *bal >= config.criteria_min_balance)
        .collect();

    if eligible.is_empty() || config.total_amount == 0 {
        return Vec::new();
    }

    if config.pro_rata {
        let total_balance: u128 = eligible.iter().map(|(_, b)| *b as u128).sum();
        if total_balance == 0 {
            return Vec::new();
        }
        eligible
            .iter()
            .map(|(addr, bal)| {
                let share =
                    mul_div(config.total_amount as u128, *bal as u128, total_balance) as u64;
                (*addr, share)
            })
            .collect()
    } else {
        let per_user = config.total_amount / eligible.len() as u64;
        eligible.iter().map(|(addr, _)| (*addr, per_user)).collect()
    }
}

// ============ Claiming ============

/// Claim rewards from a pool. Updates both user and pool state.
/// Returns the actual amount claimed.
pub fn claim_reward(
    user: &mut UserIncentive,
    pool: &mut IncentivePool,
    amount: u64,
    now: u64,
) -> Result<u64, IncentiveError> {
    if amount == 0 {
        return Err(IncentiveError::ZeroAmount);
    }
    if user.unclaimed == 0 {
        return Err(IncentiveError::AlreadyClaimed);
    }
    if now >= pool.end_time && pool.remaining == 0 && user.unclaimed == 0 {
        return Err(IncentiveError::PoolDepleted);
    }
    let actual = amount.min(user.unclaimed);
    user.claimed += actual;
    user.unclaimed -= actual;
    user.last_action_time = now;
    Ok(actual)
}

/// Return the claimable (unclaimed) amount for a user.
pub fn claimable_amount(user: &UserIncentive) -> u64 {
    user.unclaimed
}

/// Auto-compound: reinvest a portion of unclaimed rewards.
/// compound_rate_bps determines what fraction to reinvest (e.g. 5000 = 50%).
/// Returns the compounded amount.
pub fn auto_compound(user: &mut UserIncentive, compound_rate_bps: u64) -> u64 {
    if user.unclaimed == 0 || compound_rate_bps == 0 {
        return 0;
    }
    let compound = mul_div(user.unclaimed as u128, compound_rate_bps as u128, BPS) as u64;
    // Move compounded amount from unclaimed to earned (reinvested)
    user.unclaimed -= compound;
    user.earned += compound;
    compound
}

// ============ Analytics ============

/// Compute aggregate incentive statistics across all pools and users.
pub fn compute_stats(pools: &[IncentivePool], users: &[UserIncentive]) -> IncentiveStats {
    let total_distributed: u128 = pools.iter().map(|p| p.distributed as u128).sum();
    let total_participants: u64 = pools.iter().map(|p| p.participants).sum();
    let avg_reward = if users.is_empty() {
        0
    } else {
        (users.iter().map(|u| u.earned as u128).sum::<u128>() / users.len() as u128) as u64
    };

    let rewards: Vec<u64> = users.iter().map(|u| u.earned).collect();
    let gini = distribution_fairness(&rewards);

    let now_active = pools.iter().filter(|p| p.remaining > 0).count() as u64;
    let total_refs: u64 = users.iter().map(|u| u.referral_count as u64).sum();
    let avg_loyalty = if users.is_empty() {
        0
    } else {
        (users.iter().map(|u| u.loyalty_multiplier_bps as u128).sum::<u128>()
            / users.len() as u128) as u64
    };

    IncentiveStats {
        total_distributed,
        total_participants,
        avg_reward_per_user: avg_reward,
        distribution_gini: gini,
        active_pools: now_active,
        total_referrals: total_refs,
        avg_loyalty_multiplier: avg_loyalty,
    }
}

/// Estimate APR for a pool: (rate_per_second / RPS_SCALE * SECONDS_PER_YEAR) / total_staked * 10000
/// Returns annual return in basis points.
pub fn apr_estimate(pool: &IncentivePool, total_staked_value: u64) -> u64 {
    if total_staked_value == 0 || pool.rate_per_second == 0 {
        return 0;
    }
    // Annual emission = rate_per_second * SECONDS_PER_YEAR / RPS_SCALE
    // APR_bps = annual_emission * 10000 / total_staked
    let annual = mul_div(
        pool.rate_per_second as u128,
        SECONDS_PER_YEAR as u128,
        RPS_SCALE,
    );
    mul_div(annual, BPS, total_staked_value as u128) as u64
}

/// Compute Gini coefficient for a reward distribution.
/// Returns 0 (perfect equality) to 10000 (one takes all).
pub fn distribution_fairness(rewards: &[u64]) -> u64 {
    if rewards.is_empty() || rewards.len() == 1 {
        return 0;
    }
    let n = rewards.len() as u128;
    let total: u128 = rewards.iter().map(|&r| r as u128).sum();
    if total == 0 {
        return 0;
    }

    // Gini = sum_i sum_j |x_i - x_j| / (2 * n * total)
    let mut abs_diff_sum: u128 = 0;
    for i in 0..rewards.len() {
        for j in 0..rewards.len() {
            let a = rewards[i] as u128;
            let b = rewards[j] as u128;
            abs_diff_sum += if a > b { a - b } else { b - a };
        }
    }

    // Gini = abs_diff_sum / (2 * n * total), scaled to 10000
    let denominator = 2 * n * total;
    if denominator == 0 {
        return 0;
    }
    mul_div(abs_diff_sum, BPS, denominator) as u64
}

/// Return the top N earners sorted by earned amount (descending).
pub fn top_earners<'a>(users: &'a [UserIncentive], count: usize) -> Vec<&'a UserIncentive> {
    let mut indexed: Vec<(usize, u64)> = users.iter().enumerate().map(|(i, u)| (i, u.earned)).collect();
    indexed.sort_by(|a, b| b.1.cmp(&a.1));
    indexed
        .iter()
        .take(count)
        .map(|(i, _)| &users[*i])
        .collect()
}

/// Participation rate: participants / total_eligible * 10000
pub fn participation_rate(pool: &IncentivePool, total_eligible: u64) -> u64 {
    if total_eligible == 0 {
        return 0;
    }
    mul_div(pool.participants as u128, BPS, total_eligible as u128) as u64
}

// ============ Multi-Pool ============

/// Sum of all unclaimed rewards across all user records.
pub fn total_unclaimed(users: &[UserIncentive]) -> u128 {
    users.iter().map(|u| u.unclaimed as u128).sum()
}

/// Index of the pool with the highest APR. Returns None if no pools.
pub fn highest_apr_pool(pools: &[IncentivePool], staked_values: &[u64]) -> Option<usize> {
    if pools.is_empty() || staked_values.is_empty() {
        return None;
    }
    let mut best_idx = 0usize;
    let mut best_apr = 0u64;
    for i in 0..pools.len().min(staked_values.len()) {
        let apr = apr_estimate(&pools[i], staked_values[i]);
        if apr > best_apr {
            best_apr = apr;
            best_idx = i;
        }
    }
    if best_apr == 0 {
        None
    } else {
        Some(best_idx)
    }
}

/// Indices of all currently active pools.
pub fn active_pools(pools: &[IncentivePool], now: u64) -> Vec<usize> {
    pools
        .iter()
        .enumerate()
        .filter(|(_, p)| is_active(p, now))
        .map(|(i, _)| i)
        .collect()
}

/// Indices of pools expiring within the given window.
pub fn expiring_pools(pools: &[IncentivePool], now: u64, window_ms: u64) -> Vec<usize> {
    pools
        .iter()
        .enumerate()
        .filter(|(_, p)| {
            p.end_time > now && p.end_time <= now.saturating_add(window_ms)
        })
        .map(|(i, _)| i)
        .collect()
}

// ============ Governance Rewards ============

/// Compute governance reward proportional to voting power.
pub fn governance_reward(voting_power: u64, total_power: u64, reward_budget: u64) -> u64 {
    if total_power == 0 || voting_power == 0 || reward_budget == 0 {
        return 0;
    }
    mul_div(
        reward_budget as u128,
        voting_power as u128,
        total_power as u128,
    ) as u64
}

/// Bonus for participating in a governance proposal vote.
/// If voted, returns base_reward + base_reward * bonus_bps / 10000.
pub fn proposal_participation_bonus(voted: bool, base_reward: u64, bonus_bps: u64) -> u64 {
    if !voted || base_reward == 0 {
        return base_reward;
    }
    let bonus = mul_div(base_reward as u128, bonus_bps as u128, BPS) as u64;
    base_reward.saturating_add(bonus)
}

// ============ Utilities ============

/// Apply a multiplier: amount * multiplier_bps / 10000
pub fn apply_multiplier(amount: u64, multiplier_bps: u64) -> u64 {
    if amount == 0 || multiplier_bps == 0 {
        return 0;
    }
    mul_div(amount as u128, multiplier_bps as u128, BPS) as u64
}

/// Apply a fee discount: fee * (10000 - discount_bps) / 10000
pub fn apply_discount(fee: u64, discount_bps: u64) -> u64 {
    if fee == 0 {
        return 0;
    }
    if discount_bps >= 10_000 {
        return 0;
    }
    mul_div(fee as u128, (10_000 - discount_bps) as u128, BPS) as u64
}

/// Discrete compound rate: (1 + rate_bps/10000)^periods - 1, in bps.
/// Uses iterative multiplication for integer math safety.
pub fn compound_rate(base_rate: u64, periods: u64) -> u64 {
    if periods == 0 || base_rate == 0 {
        return 0;
    }
    // Start with 10000 (= 1.0 in bps), multiply by (10000 + rate) each period
    let factor = 10_000u128 + base_rate as u128;
    let mut result = BPS; // 10000
    for _ in 0..periods.min(100) {
        // Cap iterations to prevent excessive computation
        result = mul_div(result, factor, BPS);
    }
    // Result - 10000 = net compound rate in bps
    (result.saturating_sub(BPS)) as u64
}

/// Annualize a rate: scale a per-period rate to annual bps.
/// period_seconds is the length of one period.
pub fn annualize_rate(rate_bps: u64, period_seconds: u64) -> u64 {
    if period_seconds == 0 || rate_bps == 0 {
        return 0;
    }
    let periods_per_year = SECONDS_PER_YEAR / period_seconds;
    rate_bps.saturating_mul(periods_per_year)
}

/// Convert annual rate to daily: annual_bps / 365
pub fn daily_from_annual(annual_bps: u64) -> u64 {
    annual_bps / 365
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Helpers ============

    fn test_pool_id(n: u8) -> [u8; 32] {
        let mut id = [0u8; 32];
        id[0] = n;
        id
    }

    fn test_user_id(n: u8) -> [u8; 32] {
        let mut id = [0u8; 32];
        id[31] = n;
        id
    }

    fn make_pool(budget: u64, start: u64, end: u64) -> IncentivePool {
        create_pool(
            test_pool_id(1),
            IncentiveType::LiquidityMining,
            budget,
            start,
            end,
            0,
        )
        .unwrap()
    }

    fn make_user(earned: u64, unclaimed: u64) -> UserIncentive {
        UserIncentive {
            user: test_user_id(1),
            pool_id: test_pool_id(1),
            earned,
            claimed: 0,
            unclaimed,
            loyalty_multiplier_bps: 10_000,
            referral_count: 0,
            last_action_time: 0,
            streak_days: 0,
        }
    }

    fn make_referral_config() -> ReferralConfig {
        ReferralConfig {
            referrer_reward_bps: 500,  // 5%
            referee_discount_bps: 300, // 3%
            max_referral_depth: 3,
            min_referee_volume: 1_000,
            lifetime_cap: 100_000,
        }
    }

    fn make_airdrop_config(total: u64, pro_rata: bool) -> AirdropConfig {
        AirdropConfig {
            total_amount: total,
            snapshot_height: 1_000_000,
            criteria_min_balance: 100,
            criteria_min_volume: 0,
            criteria_min_age_blocks: 0,
            pro_rata,
        }
    }

    // ============ Pool Management Tests ============

    #[test]
    fn test_create_pool_basic() {
        let pool = create_pool(
            test_pool_id(1),
            IncentiveType::LiquidityMining,
            1_000_000,
            100,
            200,
            50,
        )
        .unwrap();
        assert_eq!(pool.total_budget, 1_000_000);
        assert_eq!(pool.distributed, 0);
        assert_eq!(pool.remaining, 1_000_000);
        assert_eq!(pool.start_time, 100);
        assert_eq!(pool.end_time, 200);
        assert_eq!(pool.min_qualifying_amount, 50);
        assert_eq!(pool.participants, 0);
    }

    #[test]
    fn test_create_pool_rate_computation() {
        let pool = create_pool(
            test_pool_id(1),
            IncentiveType::TradingReward,
            10_000,
            0,
            100,
            0,
        )
        .unwrap();
        // rate = 10000 * 1e8 / 100 = 10_000_000_000
        assert_eq!(pool.rate_per_second, 10_000_000_000);
    }

    #[test]
    fn test_create_pool_zero_budget() {
        let res = create_pool(test_pool_id(1), IncentiveType::Airdrop, 0, 0, 100, 0);
        assert_eq!(res.unwrap_err(), IncentiveError::ZeroAmount);
    }

    #[test]
    fn test_create_pool_invalid_period_equal() {
        let res = create_pool(test_pool_id(1), IncentiveType::Airdrop, 100, 50, 50, 0);
        assert_eq!(res.unwrap_err(), IncentiveError::InvalidPeriod);
    }

    #[test]
    fn test_create_pool_invalid_period_reversed() {
        let res = create_pool(test_pool_id(1), IncentiveType::Airdrop, 100, 200, 100, 0);
        assert_eq!(res.unwrap_err(), IncentiveError::InvalidPeriod);
    }

    #[test]
    fn test_create_pool_all_types() {
        let types = vec![
            IncentiveType::LiquidityMining,
            IncentiveType::TradingReward,
            IncentiveType::ReferralBonus,
            IncentiveType::LoyaltyMultiplier,
            IncentiveType::Airdrop,
            IncentiveType::StakingReward,
            IncentiveType::GovernanceReward,
        ];
        for (i, t) in types.into_iter().enumerate() {
            let pool = create_pool(test_pool_id(i as u8), t.clone(), 1000, 0, 100, 0).unwrap();
            assert_eq!(pool.incentive_type, t);
        }
    }

    #[test]
    fn test_distribute_basic() {
        let mut pool = make_pool(1000, 0, 100);
        let actual = distribute(&mut pool, 300, 50).unwrap();
        assert_eq!(actual, 300);
        assert_eq!(pool.distributed, 300);
        assert_eq!(pool.remaining, 700);
    }

    #[test]
    fn test_distribute_caps_to_remaining() {
        let mut pool = make_pool(100, 0, 100);
        let actual = distribute(&mut pool, 150, 50).unwrap();
        assert_eq!(actual, 100);
        assert_eq!(pool.remaining, 0);
    }

    #[test]
    fn test_distribute_zero_amount() {
        let mut pool = make_pool(1000, 0, 100);
        let res = distribute(&mut pool, 0, 50);
        assert_eq!(res.unwrap_err(), IncentiveError::ZeroAmount);
    }

    #[test]
    fn test_distribute_pool_expired() {
        let mut pool = make_pool(1000, 0, 100);
        let res = distribute(&mut pool, 100, 200);
        assert_eq!(res.unwrap_err(), IncentiveError::PoolExpired);
    }

    #[test]
    fn test_distribute_pool_depleted() {
        let mut pool = make_pool(100, 0, 1000);
        distribute(&mut pool, 100, 50).unwrap();
        let res = distribute(&mut pool, 50, 60);
        assert_eq!(res.unwrap_err(), IncentiveError::PoolDepleted);
    }

    #[test]
    fn test_distribute_multiple_partial() {
        let mut pool = make_pool(1000, 0, 1000);
        distribute(&mut pool, 300, 100).unwrap();
        distribute(&mut pool, 400, 200).unwrap();
        assert_eq!(pool.distributed, 700);
        assert_eq!(pool.remaining, 300);
    }

    #[test]
    fn test_pool_utilization_bps_zero() {
        let pool = make_pool(1000, 0, 100);
        assert_eq!(pool_utilization_bps(&pool), 0);
    }

    #[test]
    fn test_pool_utilization_bps_half() {
        let mut pool = make_pool(1000, 0, 1000);
        distribute(&mut pool, 500, 50).unwrap();
        assert_eq!(pool_utilization_bps(&pool), 5000);
    }

    #[test]
    fn test_pool_utilization_bps_full() {
        let mut pool = make_pool(1000, 0, 1000);
        distribute(&mut pool, 1000, 50).unwrap();
        assert_eq!(pool_utilization_bps(&pool), 10000);
    }

    #[test]
    fn test_pool_utilization_bps_empty_budget() {
        let pool = IncentivePool {
            pool_id: test_pool_id(1),
            incentive_type: IncentiveType::Airdrop,
            total_budget: 0,
            distributed: 0,
            remaining: 0,
            start_time: 0,
            end_time: 100,
            rate_per_second: 0,
            participants: 0,
            min_qualifying_amount: 0,
        };
        assert_eq!(pool_utilization_bps(&pool), 0);
    }

    #[test]
    fn test_time_remaining_active() {
        let pool = make_pool(1000, 0, 100);
        assert_eq!(time_remaining(&pool, 30), 70);
    }

    #[test]
    fn test_time_remaining_expired() {
        let pool = make_pool(1000, 0, 100);
        assert_eq!(time_remaining(&pool, 200), 0);
    }

    #[test]
    fn test_time_remaining_at_boundary() {
        let pool = make_pool(1000, 0, 100);
        assert_eq!(time_remaining(&pool, 100), 0);
    }

    #[test]
    fn test_is_active_true() {
        let pool = make_pool(1000, 10, 100);
        assert!(is_active(&pool, 50));
    }

    #[test]
    fn test_is_active_before_start() {
        let pool = make_pool(1000, 10, 100);
        assert!(!is_active(&pool, 5));
    }

    #[test]
    fn test_is_active_after_end() {
        let pool = make_pool(1000, 10, 100);
        assert!(!is_active(&pool, 100));
    }

    #[test]
    fn test_is_active_depleted() {
        let mut pool = make_pool(100, 0, 1000);
        distribute(&mut pool, 100, 50).unwrap();
        assert!(!is_active(&pool, 60));
    }

    #[test]
    fn test_is_active_at_start_boundary() {
        let pool = make_pool(1000, 10, 100);
        assert!(is_active(&pool, 10));
    }

    #[test]
    fn test_projected_depletion_basic() {
        let pool = make_pool(1000, 0, 100);
        // rate = 1000 * 1e8 / 100 = 1_000_000_000
        // seconds_left = 1000 * 1e8 / 1_000_000_000 = 100
        let dep = projected_depletion(&pool, 0);
        assert_eq!(dep, 100); // matches end_time
    }

    #[test]
    fn test_projected_depletion_partially_distributed() {
        let mut pool = make_pool(1000, 0, 200);
        distribute(&mut pool, 500, 50).unwrap();
        let dep = projected_depletion(&pool, 100);
        // remaining = 500, rate = 1000 * 1e8 / 200 = 500_000_000
        // seconds_left = 500 * 1e8 / 500_000_000 = 100
        // depletion = 100 + 100 = 200 = end_time
        assert_eq!(dep, 200);
    }

    #[test]
    fn test_projected_depletion_already_depleted() {
        let mut pool = make_pool(100, 0, 1000);
        distribute(&mut pool, 100, 50).unwrap();
        assert_eq!(projected_depletion(&pool, 60), 60);
    }

    // ============ Liquidity Mining Tests ============

    #[test]
    fn test_compute_lp_reward_proportional() {
        assert_eq!(compute_lp_reward(100, 1000, 500), 50);
    }

    #[test]
    fn test_compute_lp_reward_full_share() {
        assert_eq!(compute_lp_reward(1000, 1000, 500), 500);
    }

    #[test]
    fn test_compute_lp_reward_zero_total() {
        assert_eq!(compute_lp_reward(100, 0, 500), 0);
    }

    #[test]
    fn test_compute_lp_reward_zero_shares() {
        assert_eq!(compute_lp_reward(0, 1000, 500), 0);
    }

    #[test]
    fn test_compute_lp_reward_small_fraction() {
        // 1 share out of 10000, reward = 10000 => gets 1
        assert_eq!(compute_lp_reward(1, 10_000, 10_000), 1);
    }

    #[test]
    fn test_boosted_lp_reward_no_boost() {
        assert_eq!(boosted_lp_reward(1000, 10_000), 1000);
    }

    #[test]
    fn test_boosted_lp_reward_1_5x() {
        assert_eq!(boosted_lp_reward(1000, 15_000), 1500);
    }

    #[test]
    fn test_boosted_lp_reward_2x() {
        assert_eq!(boosted_lp_reward(1000, 20_000), 2000);
    }

    #[test]
    fn test_boosted_lp_reward_zero_base() {
        assert_eq!(boosted_lp_reward(0, 15_000), 0);
    }

    #[test]
    fn test_boosted_lp_reward_zero_boost() {
        assert_eq!(boosted_lp_reward(1000, 0), 0);
    }

    #[test]
    fn test_reward_per_share_basic() {
        let pool = make_pool(10_000, 0, 100);
        let rps = reward_per_share(&pool, 1_000, 10);
        // rate = 10000 * 1e8 / 100 = 10_000_000_000
        // total_reward = 10_000_000_000 * 10 / 1e8 = 1000
        // rps = 1000 * 1e8 / 1000 = 100_000_000
        assert_eq!(rps, 100_000_000);
    }

    #[test]
    fn test_reward_per_share_zero_shares() {
        let pool = make_pool(10_000, 0, 100);
        assert_eq!(reward_per_share(&pool, 0, 10), 0);
    }

    #[test]
    fn test_reward_per_share_zero_elapsed() {
        let pool = make_pool(10_000, 0, 100);
        assert_eq!(reward_per_share(&pool, 1000, 0), 0);
    }

    #[test]
    fn test_pending_reward_basic() {
        // rps = 100_000_000 (1 token per share scaled)
        let pr = pending_reward(100, 100_000_000, 0);
        // 100 * 100_000_000 / 1e8 = 100
        assert_eq!(pr, 100);
    }

    #[test]
    fn test_pending_reward_with_debt() {
        let pr = pending_reward(100, 100_000_000, 50);
        // gross = 100, debt = 50, net = 50
        assert_eq!(pr, 50);
    }

    #[test]
    fn test_pending_reward_debt_exceeds_gross() {
        let pr = pending_reward(100, 100_000_000, 200);
        assert_eq!(pr, 0); // saturating_sub
    }

    #[test]
    fn test_pending_reward_zero_shares() {
        assert_eq!(pending_reward(0, 100_000_000, 0), 0);
    }

    // ============ Trading Rewards Tests ============

    #[test]
    fn test_compute_trading_reward_basic() {
        // 10% rebate on 1000 fee
        assert_eq!(compute_trading_reward(50_000, 1000, 1000), 100);
    }

    #[test]
    fn test_compute_trading_reward_zero_fee() {
        assert_eq!(compute_trading_reward(50_000, 0, 1000), 0);
    }

    #[test]
    fn test_compute_trading_reward_zero_rebate() {
        assert_eq!(compute_trading_reward(50_000, 1000, 0), 0);
    }

    #[test]
    fn test_compute_trading_reward_full_rebate() {
        assert_eq!(compute_trading_reward(50_000, 1000, 10_000), 1000);
    }

    #[test]
    fn test_volume_tier_multiplier_no_tiers() {
        assert_eq!(volume_tier_multiplier(1000, &[]), 10_000);
    }

    #[test]
    fn test_volume_tier_multiplier_below_all() {
        let tiers = vec![(1000, 12_000), (5000, 15_000)];
        assert_eq!(volume_tier_multiplier(500, &tiers), 10_000);
    }

    #[test]
    fn test_volume_tier_multiplier_first_tier() {
        let tiers = vec![(1000, 12_000), (5000, 15_000)];
        assert_eq!(volume_tier_multiplier(2000, &tiers), 12_000);
    }

    #[test]
    fn test_volume_tier_multiplier_top_tier() {
        let tiers = vec![(1000, 12_000), (5000, 15_000), (10_000, 20_000)];
        assert_eq!(volume_tier_multiplier(50_000, &tiers), 20_000);
    }

    #[test]
    fn test_volume_tier_multiplier_exact_threshold() {
        let tiers = vec![(1000, 12_000)];
        assert_eq!(volume_tier_multiplier(1000, &tiers), 12_000);
    }

    #[test]
    fn test_maker_taker_split_50_50() {
        let (maker, taker) = maker_taker_split(1000, 5000);
        assert_eq!(maker, 500);
        assert_eq!(taker, 500);
    }

    #[test]
    fn test_maker_taker_split_70_30() {
        let (maker, taker) = maker_taker_split(1000, 7000);
        assert_eq!(maker, 700);
        assert_eq!(taker, 300);
    }

    #[test]
    fn test_maker_taker_split_zero_fee() {
        let (maker, taker) = maker_taker_split(0, 5000);
        assert_eq!(maker, 0);
        assert_eq!(taker, 0);
    }

    #[test]
    fn test_maker_taker_split_all_maker() {
        let (maker, taker) = maker_taker_split(1000, 10_000);
        assert_eq!(maker, 1000);
        assert_eq!(taker, 0);
    }

    #[test]
    fn test_maker_taker_split_conservation() {
        let fee = 9999;
        let (maker, taker) = maker_taker_split(fee, 3333);
        assert_eq!(maker + taker, fee);
    }

    // ============ Referral System Tests ============

    #[test]
    fn test_compute_referral_reward_basic() {
        let config = make_referral_config();
        let (referrer, referee) = compute_referral_reward(10_000, &config);
        // 5% of 10000 = 500, 3% of 10000 = 300
        assert_eq!(referrer, 500);
        assert_eq!(referee, 300);
    }

    #[test]
    fn test_compute_referral_reward_zero_fees() {
        let config = make_referral_config();
        let (referrer, referee) = compute_referral_reward(0, &config);
        assert_eq!(referrer, 0);
        assert_eq!(referee, 0);
    }

    #[test]
    fn test_validate_referral_valid() {
        let r1 = test_user_id(1);
        let r2 = test_user_id(2);
        assert!(validate_referral(&r1, &r2).is_ok());
    }

    #[test]
    fn test_validate_referral_self() {
        let r1 = test_user_id(1);
        assert_eq!(
            validate_referral(&r1, &r1).unwrap_err(),
            IncentiveError::SelfReferral
        );
    }

    #[test]
    fn test_validate_referral_zero_referrer() {
        let zero = [0u8; 32];
        let r2 = test_user_id(2);
        assert_eq!(
            validate_referral(&zero, &r2).unwrap_err(),
            IncentiveError::InvalidReferral
        );
    }

    #[test]
    fn test_validate_referral_zero_referee() {
        let r1 = test_user_id(1);
        let zero = [0u8; 32];
        assert_eq!(
            validate_referral(&r1, &zero).unwrap_err(),
            IncentiveError::InvalidReferral
        );
    }

    #[test]
    fn test_referral_chain_reward_depth_1() {
        let config = make_referral_config();
        let rewards = referral_chain_reward(10_000, &config, 1);
        assert_eq!(rewards.len(), 1);
        assert_eq!(rewards[0], 500); // 5% of 10000
    }

    #[test]
    fn test_referral_chain_reward_depth_3() {
        let config = make_referral_config();
        let rewards = referral_chain_reward(10_000, &config, 3);
        assert_eq!(rewards.len(), 3);
        assert_eq!(rewards[0], 500);  // 5% of 10000
        assert_eq!(rewards[1], 250);  // 50% of 500
        assert_eq!(rewards[2], 125);  // 50% of 250
    }

    #[test]
    fn test_referral_chain_reward_capped_by_max_depth() {
        let config = make_referral_config(); // max_depth = 3
        let rewards = referral_chain_reward(10_000, &config, 10);
        assert_eq!(rewards.len(), 3); // capped at config max
    }

    #[test]
    fn test_referral_chain_reward_depth_zero() {
        let config = make_referral_config();
        let rewards = referral_chain_reward(10_000, &config, 0);
        assert!(rewards.is_empty());
    }

    #[test]
    fn test_referral_chain_reward_decay() {
        let config = make_referral_config();
        let rewards = referral_chain_reward(10_000, &config, 3);
        // Each level should be ~50% of previous
        for i in 1..rewards.len() {
            assert!(rewards[i] <= rewards[i - 1]);
        }
    }

    #[test]
    fn test_cap_referral_reward_under_cap() {
        assert_eq!(cap_referral_reward(100, 500, 1000), 100);
    }

    #[test]
    fn test_cap_referral_reward_at_cap() {
        assert_eq!(cap_referral_reward(100, 1000, 1000), 0);
    }

    #[test]
    fn test_cap_referral_reward_exceeds_remaining() {
        assert_eq!(cap_referral_reward(200, 900, 1000), 100);
    }

    #[test]
    fn test_cap_referral_reward_over_cap() {
        assert_eq!(cap_referral_reward(100, 1500, 1000), 0);
    }

    // ============ Loyalty System Tests ============

    #[test]
    fn test_default_loyalty_tiers_count() {
        let tiers = default_loyalty_tiers();
        assert_eq!(tiers.len(), 4);
    }

    #[test]
    fn test_default_loyalty_tiers_order() {
        let tiers = default_loyalty_tiers();
        assert_eq!(tiers[0].min_days, 0);
        assert_eq!(tiers[1].min_days, 30);
        assert_eq!(tiers[2].min_days, 90);
        assert_eq!(tiers[3].min_days, 365);
    }

    #[test]
    fn test_default_loyalty_tiers_multipliers() {
        let tiers = default_loyalty_tiers();
        assert_eq!(tiers[0].multiplier_bps, 10_000);
        assert_eq!(tiers[1].multiplier_bps, 12_000);
        assert_eq!(tiers[2].multiplier_bps, 15_000);
        assert_eq!(tiers[3].multiplier_bps, 20_000);
    }

    #[test]
    fn test_default_loyalty_tiers_priority() {
        let tiers = default_loyalty_tiers();
        assert!(!tiers[0].priority_access);
        assert!(!tiers[1].priority_access);
        assert!(tiers[2].priority_access);
        assert!(tiers[3].priority_access);
    }

    #[test]
    fn test_compute_loyalty_tier_bronze() {
        let tiers = default_loyalty_tiers();
        let tier = compute_loyalty_tier(0, &tiers).unwrap();
        assert_eq!(tier.multiplier_bps, 10_000);
    }

    #[test]
    fn test_compute_loyalty_tier_silver() {
        let tiers = default_loyalty_tiers();
        let tier = compute_loyalty_tier(30, &tiers).unwrap();
        assert_eq!(tier.multiplier_bps, 12_000);
    }

    #[test]
    fn test_compute_loyalty_tier_gold() {
        let tiers = default_loyalty_tiers();
        let tier = compute_loyalty_tier(90, &tiers).unwrap();
        assert_eq!(tier.multiplier_bps, 15_000);
    }

    #[test]
    fn test_compute_loyalty_tier_platinum() {
        let tiers = default_loyalty_tiers();
        let tier = compute_loyalty_tier(365, &tiers).unwrap();
        assert_eq!(tier.multiplier_bps, 20_000);
    }

    #[test]
    fn test_compute_loyalty_tier_between_tiers() {
        let tiers = default_loyalty_tiers();
        let tier = compute_loyalty_tier(60, &tiers).unwrap();
        // 60 days qualifies for Silver (30d) but not Gold (90d)
        assert_eq!(tier.multiplier_bps, 12_000);
    }

    #[test]
    fn test_compute_loyalty_tier_empty() {
        assert!(compute_loyalty_tier(100, &[]).is_none());
    }

    #[test]
    fn test_loyalty_multiplier_new_user() {
        let tiers = default_loyalty_tiers();
        assert_eq!(loyalty_multiplier(5, &tiers), 10_000);
    }

    #[test]
    fn test_loyalty_multiplier_veteran() {
        let tiers = default_loyalty_tiers();
        assert_eq!(loyalty_multiplier(400, &tiers), 20_000);
    }

    #[test]
    fn test_loyalty_multiplier_no_tiers() {
        assert_eq!(loyalty_multiplier(100, &[]), 10_000);
    }

    #[test]
    fn test_streak_bonus_zero_days() {
        assert_eq!(streak_bonus(0, 1000), 0);
    }

    #[test]
    fn test_streak_bonus_one_day() {
        // 1% of 1000 = 10
        assert_eq!(streak_bonus(1, 1000), 10);
    }

    #[test]
    fn test_streak_bonus_ten_days() {
        // 10% of 1000 = 100
        assert_eq!(streak_bonus(10, 1000), 100);
    }

    #[test]
    fn test_streak_bonus_max_cap() {
        // 30 days -> 30% cap, 100 days still 30%
        let at_30 = streak_bonus(30, 1000);
        let at_100 = streak_bonus(100, 1000);
        assert_eq!(at_30, 300);
        assert_eq!(at_100, 300); // capped
    }

    #[test]
    fn test_streak_bonus_zero_reward() {
        assert_eq!(streak_bonus(10, 0), 0);
    }

    #[test]
    fn test_check_streak_within_day() {
        assert!(check_streak(100, 150, 100));
    }

    #[test]
    fn test_check_streak_exactly_one_day() {
        assert!(check_streak(100, 200, 100));
    }

    #[test]
    fn test_check_streak_broken() {
        assert!(!check_streak(100, 300, 100));
    }

    #[test]
    fn test_check_streak_zero_day() {
        assert!(!check_streak(100, 200, 0));
    }

    #[test]
    fn test_check_streak_future_action() {
        // now < last_action
        assert!(!check_streak(200, 100, 100));
    }

    #[test]
    fn test_update_streak_first_action() {
        let mut user = make_user(0, 0);
        update_streak(&mut user, 1000, 86400);
        assert_eq!(user.streak_days, 1);
        assert_eq!(user.last_action_time, 1000);
    }

    #[test]
    fn test_update_streak_continue() {
        let mut user = make_user(0, 0);
        user.last_action_time = 1000;
        user.streak_days = 5;
        // Action within one day but after half a day
        update_streak(&mut user, 1000 + 50_000, 86400);
        assert_eq!(user.streak_days, 6);
    }

    #[test]
    fn test_update_streak_broken() {
        let mut user = make_user(0, 0);
        user.last_action_time = 1000;
        user.streak_days = 10;
        // Action more than one day later
        update_streak(&mut user, 1000 + 200_000, 86400);
        assert_eq!(user.streak_days, 1); // reset
    }

    #[test]
    fn test_update_streak_same_day_no_double_count() {
        let mut user = make_user(0, 0);
        user.last_action_time = 1000;
        user.streak_days = 5;
        // Action too soon (less than half a day)
        update_streak(&mut user, 1000 + 100, 86400);
        assert_eq!(user.streak_days, 5); // no increment
    }

    #[test]
    fn test_update_streak_zero_day_ms() {
        let mut user = make_user(0, 0);
        update_streak(&mut user, 1000, 0);
        assert_eq!(user.streak_days, 0); // no change
    }

    // ============ Airdrop Tests ============

    #[test]
    fn test_compute_airdrop_equal_basic() {
        let config = make_airdrop_config(10_000, false);
        assert_eq!(compute_airdrop_equal(&config, 10), 1000);
    }

    #[test]
    fn test_compute_airdrop_equal_zero_eligible() {
        let config = make_airdrop_config(10_000, false);
        assert_eq!(compute_airdrop_equal(&config, 0), 0);
    }

    #[test]
    fn test_compute_airdrop_equal_zero_amount() {
        let config = make_airdrop_config(0, false);
        assert_eq!(compute_airdrop_equal(&config, 10), 0);
    }

    #[test]
    fn test_compute_airdrop_equal_remainder() {
        let config = make_airdrop_config(10, false);
        // 10 / 3 = 3 (integer division, dust stays)
        assert_eq!(compute_airdrop_equal(&config, 3), 3);
    }

    #[test]
    fn test_compute_airdrop_prorata_half() {
        let config = make_airdrop_config(10_000, true);
        assert_eq!(compute_airdrop_prorata(&config, 500, 1000), 5000);
    }

    #[test]
    fn test_compute_airdrop_prorata_full() {
        let config = make_airdrop_config(10_000, true);
        assert_eq!(compute_airdrop_prorata(&config, 1000, 1000), 10_000);
    }

    #[test]
    fn test_compute_airdrop_prorata_zero_balance() {
        let config = make_airdrop_config(10_000, true);
        assert_eq!(compute_airdrop_prorata(&config, 0, 1000), 0);
    }

    #[test]
    fn test_compute_airdrop_prorata_zero_total() {
        let config = make_airdrop_config(10_000, true);
        assert_eq!(compute_airdrop_prorata(&config, 500, 0), 0);
    }

    #[test]
    fn test_is_airdrop_eligible_all_pass() {
        let config = make_airdrop_config(10_000, true);
        assert!(is_airdrop_eligible(1000, 500, 100, &config));
    }

    #[test]
    fn test_is_airdrop_eligible_low_balance() {
        let config = AirdropConfig {
            criteria_min_balance: 1000,
            ..make_airdrop_config(10_000, true)
        };
        assert!(!is_airdrop_eligible(500, 500, 100, &config));
    }

    #[test]
    fn test_is_airdrop_eligible_low_volume() {
        let config = AirdropConfig {
            criteria_min_volume: 1000,
            ..make_airdrop_config(10_000, true)
        };
        assert!(!is_airdrop_eligible(1000, 500, 100, &config));
    }

    #[test]
    fn test_is_airdrop_eligible_young_account() {
        let config = AirdropConfig {
            criteria_min_age_blocks: 1000,
            ..make_airdrop_config(10_000, true)
        };
        assert!(!is_airdrop_eligible(1000, 500, 100, &config));
    }

    #[test]
    fn test_airdrop_distribution_equal() {
        let config = make_airdrop_config(10_000, false);
        let balances = vec![
            (test_user_id(1), 500),
            (test_user_id(2), 300),
            (test_user_id(3), 200),
        ];
        let dist = airdrop_distribution(&config, &balances);
        assert_eq!(dist.len(), 3);
        // 10000 / 3 = 3333
        assert_eq!(dist[0].1, 3333);
        assert_eq!(dist[1].1, 3333);
        assert_eq!(dist[2].1, 3333);
    }

    #[test]
    fn test_airdrop_distribution_prorata() {
        let config = make_airdrop_config(10_000, true);
        let balances = vec![
            (test_user_id(1), 500),
            (test_user_id(2), 300),
            (test_user_id(3), 200),
        ];
        let dist = airdrop_distribution(&config, &balances);
        assert_eq!(dist.len(), 3);
        assert_eq!(dist[0].1, 5000); // 500/1000 * 10000
        assert_eq!(dist[1].1, 3000); // 300/1000 * 10000
        assert_eq!(dist[2].1, 2000); // 200/1000 * 10000
    }

    #[test]
    fn test_airdrop_distribution_filters_ineligible() {
        let config = make_airdrop_config(10_000, false);
        let balances = vec![
            (test_user_id(1), 500),
            (test_user_id(2), 50),  // below min_balance of 100
            (test_user_id(3), 200),
        ];
        let dist = airdrop_distribution(&config, &balances);
        assert_eq!(dist.len(), 2);
    }

    #[test]
    fn test_airdrop_distribution_empty() {
        let config = make_airdrop_config(10_000, false);
        let dist = airdrop_distribution(&config, &[]);
        assert!(dist.is_empty());
    }

    #[test]
    fn test_airdrop_distribution_all_ineligible() {
        let config = make_airdrop_config(10_000, false);
        let balances = vec![(test_user_id(1), 10), (test_user_id(2), 50)];
        let dist = airdrop_distribution(&config, &balances);
        assert!(dist.is_empty());
    }

    // ============ Claiming Tests ============

    #[test]
    fn test_claim_reward_basic() {
        let mut user = make_user(1000, 500);
        let mut pool = make_pool(10_000, 0, 1000);
        let claimed = claim_reward(&mut user, &mut pool, 200, 50).unwrap();
        assert_eq!(claimed, 200);
        assert_eq!(user.claimed, 200);
        assert_eq!(user.unclaimed, 300);
    }

    #[test]
    fn test_claim_reward_all_unclaimed() {
        let mut user = make_user(1000, 500);
        let mut pool = make_pool(10_000, 0, 1000);
        let claimed = claim_reward(&mut user, &mut pool, 1000, 50).unwrap();
        assert_eq!(claimed, 500); // capped to unclaimed
    }

    #[test]
    fn test_claim_reward_zero_amount() {
        let mut user = make_user(1000, 500);
        let mut pool = make_pool(10_000, 0, 1000);
        let res = claim_reward(&mut user, &mut pool, 0, 50);
        assert_eq!(res.unwrap_err(), IncentiveError::ZeroAmount);
    }

    #[test]
    fn test_claim_reward_already_claimed() {
        let mut user = make_user(1000, 0); // nothing unclaimed
        let mut pool = make_pool(10_000, 0, 1000);
        let res = claim_reward(&mut user, &mut pool, 100, 50);
        assert_eq!(res.unwrap_err(), IncentiveError::AlreadyClaimed);
    }

    #[test]
    fn test_claim_reward_updates_timestamp() {
        let mut user = make_user(1000, 500);
        let mut pool = make_pool(10_000, 0, 1000);
        claim_reward(&mut user, &mut pool, 100, 777).unwrap();
        assert_eq!(user.last_action_time, 777);
    }

    #[test]
    fn test_claimable_amount() {
        let user = make_user(1000, 350);
        assert_eq!(claimable_amount(&user), 350);
    }

    #[test]
    fn test_claimable_amount_zero() {
        let user = make_user(1000, 0);
        assert_eq!(claimable_amount(&user), 0);
    }

    #[test]
    fn test_auto_compound_half() {
        let mut user = make_user(1000, 500);
        let compounded = auto_compound(&mut user, 5000); // 50%
        assert_eq!(compounded, 250);
        assert_eq!(user.unclaimed, 250);
        assert_eq!(user.earned, 1250);
    }

    #[test]
    fn test_auto_compound_full() {
        let mut user = make_user(1000, 500);
        let compounded = auto_compound(&mut user, 10_000); // 100%
        assert_eq!(compounded, 500);
        assert_eq!(user.unclaimed, 0);
        assert_eq!(user.earned, 1500);
    }

    #[test]
    fn test_auto_compound_zero_unclaimed() {
        let mut user = make_user(1000, 0);
        assert_eq!(auto_compound(&mut user, 5000), 0);
    }

    #[test]
    fn test_auto_compound_zero_rate() {
        let mut user = make_user(1000, 500);
        assert_eq!(auto_compound(&mut user, 0), 0);
    }

    // ============ Analytics Tests ============

    #[test]
    fn test_compute_stats_basic() {
        let pools = vec![make_pool(10_000, 0, 1000)];
        let users = vec![
            make_user(500, 100),
            make_user(300, 200),
        ];
        let stats = compute_stats(&pools, &users);
        assert_eq!(stats.total_distributed, 0);
        assert_eq!(stats.avg_reward_per_user, 400); // (500+300)/2
    }

    #[test]
    fn test_compute_stats_empty() {
        let stats = compute_stats(&[], &[]);
        assert_eq!(stats.total_distributed, 0);
        assert_eq!(stats.total_participants, 0);
        assert_eq!(stats.avg_reward_per_user, 0);
    }

    #[test]
    fn test_compute_stats_active_pools() {
        let pools = vec![
            make_pool(1000, 0, 100),
            {
                let mut p = make_pool(1000, 0, 1000);
                p.remaining = 0;
                p
            },
        ];
        let stats = compute_stats(&pools, &[]);
        assert_eq!(stats.active_pools, 1);
    }

    #[test]
    fn test_apr_estimate_basic() {
        let pool = make_pool(31_557_600, 0, 31_557_600); // 1 token/sec for a year
        // rate = 31557600 * 1e8 / 31557600 = 1e8
        // annual = 1e8 * 31557600 / 1e8 = 31557600
        // apr = 31557600 * 10000 / 1000000 = 315576
        let apr = apr_estimate(&pool, 1_000_000);
        assert_eq!(apr, 315_576);
    }

    #[test]
    fn test_apr_estimate_zero_staked() {
        let pool = make_pool(1000, 0, 100);
        assert_eq!(apr_estimate(&pool, 0), 0);
    }

    #[test]
    fn test_apr_estimate_zero_rate() {
        let mut pool = make_pool(1000, 0, 100);
        pool.rate_per_second = 0;
        assert_eq!(apr_estimate(&pool, 1000), 0);
    }

    #[test]
    fn test_distribution_fairness_equal() {
        let rewards = vec![100, 100, 100, 100];
        assert_eq!(distribution_fairness(&rewards), 0);
    }

    #[test]
    fn test_distribution_fairness_unequal() {
        let rewards = vec![0, 0, 0, 1000];
        let gini = distribution_fairness(&rewards);
        // Should be high (close to 10000)
        assert!(gini > 5000);
    }

    #[test]
    fn test_distribution_fairness_empty() {
        assert_eq!(distribution_fairness(&[]), 0);
    }

    #[test]
    fn test_distribution_fairness_single() {
        assert_eq!(distribution_fairness(&[100]), 0);
    }

    #[test]
    fn test_distribution_fairness_all_zero() {
        assert_eq!(distribution_fairness(&[0, 0, 0]), 0);
    }

    #[test]
    fn test_distribution_fairness_two_values() {
        // One has everything, one has nothing => Gini = 5000
        let gini = distribution_fairness(&[0, 100]);
        assert_eq!(gini, 5000);
    }

    #[test]
    fn test_top_earners_basic() {
        let users = vec![
            make_user(100, 0),
            make_user(500, 0),
            make_user(300, 0),
        ];
        let top = top_earners(&users, 2);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0].earned, 500);
        assert_eq!(top[1].earned, 300);
    }

    #[test]
    fn test_top_earners_more_than_available() {
        let users = vec![make_user(100, 0)];
        let top = top_earners(&users, 5);
        assert_eq!(top.len(), 1);
    }

    #[test]
    fn test_top_earners_empty() {
        let top = top_earners(&[], 3);
        assert!(top.is_empty());
    }

    #[test]
    fn test_participation_rate_full() {
        let mut pool = make_pool(1000, 0, 100);
        pool.participants = 100;
        assert_eq!(participation_rate(&pool, 100), 10_000);
    }

    #[test]
    fn test_participation_rate_half() {
        let mut pool = make_pool(1000, 0, 100);
        pool.participants = 50;
        assert_eq!(participation_rate(&pool, 100), 5000);
    }

    #[test]
    fn test_participation_rate_zero_eligible() {
        let pool = make_pool(1000, 0, 100);
        assert_eq!(participation_rate(&pool, 0), 0);
    }

    // ============ Multi-Pool Tests ============

    #[test]
    fn test_total_unclaimed_basic() {
        let users = vec![
            make_user(0, 100),
            make_user(0, 200),
            make_user(0, 300),
        ];
        assert_eq!(total_unclaimed(&users), 600);
    }

    #[test]
    fn test_total_unclaimed_empty() {
        assert_eq!(total_unclaimed(&[]), 0);
    }

    #[test]
    fn test_highest_apr_pool_basic() {
        let pools = vec![
            make_pool(1000, 0, 100),
            make_pool(5000, 0, 100), // higher budget = higher rate
        ];
        let staked = vec![1000, 1000];
        let idx = highest_apr_pool(&pools, &staked).unwrap();
        assert_eq!(idx, 1);
    }

    #[test]
    fn test_highest_apr_pool_empty() {
        assert!(highest_apr_pool(&[], &[]).is_none());
    }

    #[test]
    fn test_highest_apr_pool_all_zero_staked() {
        let pools = vec![make_pool(1000, 0, 100)];
        let staked = vec![0];
        assert!(highest_apr_pool(&pools, &staked).is_none());
    }

    #[test]
    fn test_active_pools_basic() {
        let pools = vec![
            make_pool(1000, 0, 100),   // active at t=50
            make_pool(1000, 200, 300), // not yet started at t=50
            make_pool(1000, 0, 50),    // ended at t=50
        ];
        let active = active_pools(&pools, 50);
        assert_eq!(active, vec![0]);
    }

    #[test]
    fn test_active_pools_none() {
        let pools = vec![make_pool(1000, 0, 10)];
        let active = active_pools(&pools, 100);
        assert!(active.is_empty());
    }

    #[test]
    fn test_active_pools_all() {
        let pools = vec![
            make_pool(1000, 0, 100),
            make_pool(1000, 0, 100),
        ];
        let active = active_pools(&pools, 50);
        assert_eq!(active, vec![0, 1]);
    }

    #[test]
    fn test_expiring_pools_basic() {
        let pools = vec![
            make_pool(1000, 0, 150),  // expires within window
            make_pool(1000, 0, 500),  // expires outside window
            make_pool(1000, 0, 50),   // already expired
        ];
        let expiring = expiring_pools(&pools, 100, 100);
        assert_eq!(expiring, vec![0]);
    }

    #[test]
    fn test_expiring_pools_none() {
        let pools = vec![make_pool(1000, 0, 1000)];
        let expiring = expiring_pools(&pools, 100, 50);
        assert!(expiring.is_empty());
    }

    #[test]
    fn test_expiring_pools_at_boundary() {
        let pools = vec![make_pool(1000, 0, 200)];
        // end_time=200, now=100, window=100 => 200 <= 200, included
        let expiring = expiring_pools(&pools, 100, 100);
        assert_eq!(expiring, vec![0]);
    }

    // ============ Governance Rewards Tests ============

    #[test]
    fn test_governance_reward_proportional() {
        assert_eq!(governance_reward(100, 1000, 5000), 500);
    }

    #[test]
    fn test_governance_reward_full_power() {
        assert_eq!(governance_reward(1000, 1000, 5000), 5000);
    }

    #[test]
    fn test_governance_reward_zero_power() {
        assert_eq!(governance_reward(0, 1000, 5000), 0);
    }

    #[test]
    fn test_governance_reward_zero_total() {
        assert_eq!(governance_reward(100, 0, 5000), 0);
    }

    #[test]
    fn test_governance_reward_zero_budget() {
        assert_eq!(governance_reward(100, 1000, 0), 0);
    }

    #[test]
    fn test_proposal_participation_bonus_voted() {
        let reward = proposal_participation_bonus(true, 1000, 2000);
        // 1000 + 1000 * 2000 / 10000 = 1000 + 200 = 1200
        assert_eq!(reward, 1200);
    }

    #[test]
    fn test_proposal_participation_bonus_not_voted() {
        let reward = proposal_participation_bonus(false, 1000, 2000);
        assert_eq!(reward, 1000); // base reward, no bonus
    }

    #[test]
    fn test_proposal_participation_bonus_zero_base() {
        assert_eq!(proposal_participation_bonus(true, 0, 2000), 0);
    }

    #[test]
    fn test_proposal_participation_bonus_zero_bps() {
        let reward = proposal_participation_bonus(true, 1000, 0);
        assert_eq!(reward, 1000); // no bonus added
    }

    // ============ Utility Tests ============

    #[test]
    fn test_apply_multiplier_1x() {
        assert_eq!(apply_multiplier(1000, 10_000), 1000);
    }

    #[test]
    fn test_apply_multiplier_2x() {
        assert_eq!(apply_multiplier(1000, 20_000), 2000);
    }

    #[test]
    fn test_apply_multiplier_half() {
        assert_eq!(apply_multiplier(1000, 5000), 500);
    }

    #[test]
    fn test_apply_multiplier_zero_amount() {
        assert_eq!(apply_multiplier(0, 15_000), 0);
    }

    #[test]
    fn test_apply_multiplier_zero_mult() {
        assert_eq!(apply_multiplier(1000, 0), 0);
    }

    #[test]
    fn test_apply_discount_10_percent() {
        assert_eq!(apply_discount(1000, 1000), 900);
    }

    #[test]
    fn test_apply_discount_zero() {
        assert_eq!(apply_discount(1000, 0), 1000);
    }

    #[test]
    fn test_apply_discount_full() {
        assert_eq!(apply_discount(1000, 10_000), 0);
    }

    #[test]
    fn test_apply_discount_zero_fee() {
        assert_eq!(apply_discount(0, 5000), 0);
    }

    #[test]
    fn test_apply_discount_over_100_percent() {
        assert_eq!(apply_discount(1000, 15_000), 0);
    }

    #[test]
    fn test_compound_rate_zero_periods() {
        assert_eq!(compound_rate(100, 0), 0);
    }

    #[test]
    fn test_compound_rate_zero_rate() {
        assert_eq!(compound_rate(0, 10), 0);
    }

    #[test]
    fn test_compound_rate_one_period() {
        // (1 + 0.01)^1 - 1 = 0.01 = 100 bps
        assert_eq!(compound_rate(100, 1), 100);
    }

    #[test]
    fn test_compound_rate_two_periods() {
        // (1 + 0.01)^2 - 1 = 0.0201 = 201 bps
        assert_eq!(compound_rate(100, 2), 201);
    }

    #[test]
    fn test_compound_rate_ten_periods() {
        // (1.01)^10 - 1 ≈ 0.10462 = ~1046 bps
        let rate = compound_rate(100, 10);
        assert!(rate >= 1040 && rate <= 1050);
    }

    #[test]
    fn test_compound_rate_capped_iterations() {
        // Even with huge periods, should not hang (capped at 100)
        let rate = compound_rate(100, 1_000_000);
        assert!(rate > 0);
    }

    #[test]
    fn test_annualize_rate_daily() {
        // 10 bps/day * 365 days ≈ annual
        let annual = annualize_rate(10, SECONDS_PER_DAY as u64);
        assert_eq!(annual, 10 * (SECONDS_PER_YEAR / SECONDS_PER_DAY));
    }

    #[test]
    fn test_annualize_rate_hourly() {
        let annual = annualize_rate(1, 3600);
        // 31557600 / 3600 = 8766 hours/year
        assert_eq!(annual, 8766);
    }

    #[test]
    fn test_annualize_rate_zero_period() {
        assert_eq!(annualize_rate(100, 0), 0);
    }

    #[test]
    fn test_annualize_rate_zero_rate() {
        assert_eq!(annualize_rate(0, 3600), 0);
    }

    #[test]
    fn test_daily_from_annual_basic() {
        assert_eq!(daily_from_annual(3650), 10);
    }

    #[test]
    fn test_daily_from_annual_small() {
        assert_eq!(daily_from_annual(100), 0); // integer truncation
    }

    #[test]
    fn test_daily_from_annual_zero() {
        assert_eq!(daily_from_annual(0), 0);
    }

    // ============ Integration / Edge Case Tests ============

    #[test]
    fn test_full_lifecycle_pool() {
        // Create -> distribute -> claim -> check stats
        let mut pool = create_pool(
            test_pool_id(1),
            IncentiveType::LiquidityMining,
            10_000,
            0,
            1000,
            100,
        )
        .unwrap();

        assert!(is_active(&pool, 500));
        assert_eq!(pool_utilization_bps(&pool), 0);

        distribute(&mut pool, 3000, 500).unwrap();
        assert_eq!(pool_utilization_bps(&pool), 3000);

        let mut user = UserIncentive {
            user: test_user_id(1),
            pool_id: test_pool_id(1),
            earned: 3000,
            claimed: 0,
            unclaimed: 3000,
            loyalty_multiplier_bps: 10_000,
            referral_count: 0,
            last_action_time: 0,
            streak_days: 0,
        };

        claim_reward(&mut user, &mut pool, 1000, 600).unwrap();
        assert_eq!(user.claimed, 1000);
        assert_eq!(user.unclaimed, 2000);
    }

    #[test]
    fn test_lp_reward_with_boost_and_streak() {
        let base = compute_lp_reward(100, 1000, 5000); // 500
        let boosted = boosted_lp_reward(base, 15_000);  // 750
        let streak = streak_bonus(10, boosted);          // 10% of 750 = 75
        let total = boosted + streak;
        assert_eq!(total, 825);
    }

    #[test]
    fn test_trading_reward_with_volume_tier() {
        let tiers = vec![(1000, 12_000), (10_000, 15_000)];
        let mult = volume_tier_multiplier(5000, &tiers); // 12000
        let base_reward = compute_trading_reward(5000, 50, 1000); // 50 * 1000 / 10000 = 5
        let boosted = apply_multiplier(base_reward, mult); // 5 * 12000 / 10000 = 6
        assert_eq!(boosted, 6);
    }

    #[test]
    fn test_referral_with_cap_and_loyalty() {
        let config = make_referral_config();
        let (ref_reward, _) = compute_referral_reward(10_000, &config);
        let capped = cap_referral_reward(ref_reward, 99_600, 100_000);
        assert_eq!(capped, 400); // only 400 remaining
    }

    #[test]
    fn test_loyalty_discount_on_fee() {
        let tiers = default_loyalty_tiers();
        let tier = compute_loyalty_tier(100, &tiers).unwrap(); // Gold
        let discounted_fee = apply_discount(1000, tier.fee_discount_bps);
        // Gold = 400 bps discount => 1000 * (10000 - 400) / 10000 = 960
        assert_eq!(discounted_fee, 960);
    }

    #[test]
    fn test_governance_with_participation_bonus() {
        let base = governance_reward(100, 1000, 5000); // 500
        let with_bonus = proposal_participation_bonus(true, base, 1000); // +10%
        assert_eq!(with_bonus, 550);
    }

    #[test]
    fn test_airdrop_prorata_conservation() {
        let config = make_airdrop_config(10_000, true);
        let balances = vec![
            (test_user_id(1), 100),
            (test_user_id(2), 200),
            (test_user_id(3), 300),
            (test_user_id(4), 400),
        ];
        let dist = airdrop_distribution(&config, &balances);
        let total: u64 = dist.iter().map(|(_, a)| a).sum();
        // Should be close to 10000 (may lose dust to integer division)
        assert!(total <= 10_000);
        assert!(total >= 9_990);
    }

    #[test]
    fn test_multi_pool_apr_comparison() {
        let pools = vec![
            make_pool(1_000_000, 0, SECONDS_PER_YEAR),  // high budget
            make_pool(100, 0, SECONDS_PER_YEAR),          // low budget
        ];
        let staked = vec![1_000_000, 1_000_000];
        let best = highest_apr_pool(&pools, &staked).unwrap();
        assert_eq!(best, 0); // pool 0 has higher APR
    }

    #[test]
    fn test_streak_across_multiple_days() {
        let mut user = make_user(0, 0);
        let day = 86400u64;

        // Day 1
        update_streak(&mut user, day, day);
        assert_eq!(user.streak_days, 1);

        // Day 2
        update_streak(&mut user, day * 2, day);
        assert_eq!(user.streak_days, 2);

        // Day 3
        update_streak(&mut user, day * 3, day);
        assert_eq!(user.streak_days, 3);

        // Skip day 4, act on day 5 — streak broken
        update_streak(&mut user, day * 5, day);
        assert_eq!(user.streak_days, 1);
    }

    #[test]
    fn test_compound_vs_simple_interest() {
        // Simple rate over 12 periods: 500 bps * 12 = 6000 bps
        let simple = 500u64 * 12;
        // Compound: (1 + 0.05)^12 - 1 > 0.6 (compound always exceeds simple)
        let compound = compound_rate(500, 12);
        // Compound should always be greater than simple for positive rates
        assert!(compound > simple, "compound {} should exceed simple {}", compound, simple);
    }

    #[test]
    fn test_large_numbers_no_overflow() {
        // Test with near-max u64 values
        let reward = compute_lp_reward(u64::MAX / 2, u64::MAX, 1000);
        // Integer division: (MAX/2) * 1000 / MAX ≈ 499 due to truncation
        assert!(reward >= 499 && reward <= 500);

        let boosted = boosted_lp_reward(u64::MAX / 10, 20_000);
        assert!(boosted > 0);

        let mult = apply_multiplier(u64::MAX / 10, 10_000);
        assert_eq!(mult, u64::MAX / 10); // 1x should be identity
    }

    #[test]
    fn test_zero_budget_pool_utilization() {
        let pool = IncentivePool {
            pool_id: test_pool_id(1),
            incentive_type: IncentiveType::Airdrop,
            total_budget: 0,
            distributed: 0,
            remaining: 0,
            start_time: 0,
            end_time: 100,
            rate_per_second: 0,
            participants: 0,
            min_qualifying_amount: 0,
        };
        assert_eq!(pool_utilization_bps(&pool), 0);
        assert_eq!(apr_estimate(&pool, 1000), 0);
    }

    #[test]
    fn test_incentive_type_equality() {
        assert_eq!(IncentiveType::LiquidityMining, IncentiveType::LiquidityMining);
        assert_ne!(IncentiveType::LiquidityMining, IncentiveType::TradingReward);
        assert_ne!(IncentiveType::Airdrop, IncentiveType::StakingReward);
    }

    #[test]
    fn test_error_equality() {
        assert_eq!(IncentiveError::PoolExpired, IncentiveError::PoolExpired);
        assert_ne!(IncentiveError::PoolExpired, IncentiveError::PoolDepleted);
        assert_ne!(IncentiveError::SelfReferral, IncentiveError::CircularReferral);
    }
}
