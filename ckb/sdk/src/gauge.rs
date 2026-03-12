// ============ Gauge — veVIBE Gauge Voting & Liquidity Incentive Allocation ============
// Implements the gauge voting and liquidity incentive system for VibeSwap.
// veVIBE holders direct emissions to pools via gauge weights.
//
// VibeSwap uses a 3-sink emission model:
//   50% Shapley / 35% Gauge / 15% Staking
//
// The gauge system lets veVIBE holders vote on which pools receive the 35%
// gauge allocation. This is the core DeFi incentive alignment mechanism —
// capital goes where voters direct it.
//
// Key capabilities:
// - Gauge creation, deactivation (kill), and revival
// - Multi-pool vote splitting with BPS-weighted allocations
// - Per-epoch vote tallying and emission distribution
// - veVIBE boost for LP rewards (40% base, up to 2.5x)
// - Vote weight decay if positions are not refreshed
// - APR estimation from emission rates and pool TVL
//
// All functions are standalone pub fn — no impl blocks, no traits.
// All state is passed in and returned out — pure functional, UTXO-friendly.

use vibeswap_math::PRECISION;
use vibeswap_math::mul_div;

// ============ Constants ============

/// Basis points denominator (100%)
pub const BPS: u128 = 10_000;

/// Blocks per voting epoch
pub const EPOCH_DURATION: u64 = 100_000;

/// Maximum number of pools that can have active gauges
pub const MAX_GAUGES: usize = 50;

/// Minimum vote weight: 1 VIBE (18 decimals)
pub const MIN_VOTE_WEIGHT: u128 = 1_000_000_000_000_000_000;

/// Maximum number of pools a single voter can split votes across
pub const MAX_VOTE_SPLIT: usize = 10;

/// Maximum boost multiplier: 2.5x (in BPS)
pub const BOOST_MAX_BPS: u16 = 2500;

/// Base reward share without any boost (40%)
pub const BOOST_BASE_BPS: u16 = 4000;

/// Vote weight decay per epoch if not refreshed (1%)
pub const DECAY_RATE_BPS: u16 = 100;

/// Gauge system's share of total emissions (35%)
pub const EMISSION_SHARE_BPS: u16 = 3500;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GaugeError {
    /// No gauge found for the given pool_id
    GaugeNotFound,
    /// A gauge already exists for this pool_id
    GaugeAlreadyExists,
    /// Cannot create more gauges — MAX_GAUGES limit reached
    MaxGaugesReached,
    /// Voter does not have enough veVIBE voting power
    InsufficientVotingPower,
    /// Voter is splitting across too many pools (> MAX_VOTE_SPLIT)
    TooManySplits,
    /// Allocation BPS sum exceeds 10000
    SplitBpsExceed10000,
    /// Weight is zero after calculation
    ZeroWeight,
    /// Epoch number is invalid (e.g. in the future or nonsensical)
    InvalidEpoch,
    /// Epoch has not been finalized yet
    EpochNotFinalized,
    /// Voter has already cast a vote for this epoch
    AlreadyVoted,
    /// Gauge has been killed (deactivated)
    GaugeKilled,
    /// Emission amount is zero
    ZeroEmission,
    /// Arithmetic overflow
    Overflow,
}

// ============ Data Types ============

/// A single gauge attached to a liquidity pool.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Gauge {
    /// Unique pool identifier (CKB lock hash or pool cell type hash)
    pub pool_id: [u8; 32],
    /// Total vote weight accumulated in the current epoch
    pub total_weight: u128,
    /// Number of unique voters who voted for this gauge in the current epoch
    pub voter_count: u32,
    /// Epoch in which this gauge was created
    pub created_epoch: u64,
    /// Whether this gauge accepts votes (false = killed)
    pub is_active: bool,
    /// Lifetime cumulative emissions received by this gauge
    pub cumulative_emissions: u128,
    /// Last epoch in which this gauge received emissions
    pub last_emission_epoch: u64,
}

/// A single pool allocation within a voter's vote.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolAllocation {
    /// Pool identifier to direct emissions to
    pub pool_id: [u8; 32],
    /// Basis points of the voter's power allocated to this pool
    pub weight_bps: u16,
}

/// A voter's complete vote allocation for a single epoch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VoteAllocation {
    /// Voter's on-chain address (CKB lock hash)
    pub voter: [u8; 32],
    /// Fixed-size array of pool allocations (up to MAX_VOTE_SPLIT)
    pub allocations: [PoolAllocation; 10],
    /// Number of active allocations in the array
    pub allocation_count: u8,
    /// Voter's total veVIBE voting power at time of vote
    pub voting_power: u128,
    /// Epoch in which this vote was cast
    pub epoch: u64,
}

/// Per-gauge emission result within a finalized epoch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GaugeEmission {
    /// Pool identifier
    pub pool_id: [u8; 32],
    /// Absolute weight this gauge received
    pub weight: u128,
    /// Gauge's share of total weight in BPS
    pub weight_bps: u16,
    /// Token emission allocated to this gauge
    pub emission_amount: u128,
}

/// Finalized results for a complete epoch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EpochResult {
    /// Epoch number
    pub epoch: u64,
    /// Sum of all gauge weights
    pub total_weight: u128,
    /// Total emission budget for this epoch (the 35% gauge share)
    pub total_emission: u128,
    /// Per-gauge emission breakdown (fixed array, up to MAX_GAUGES)
    pub gauge_emissions: [GaugeEmission; 50],
    /// Number of active gauges in this epoch
    pub gauge_count: u8,
}

/// Boost calculation result for a single LP position.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BoostInfo {
    /// Reward amount before boost (base_reward scaled to base share)
    pub base_reward: u128,
    /// Reward amount after boost is applied
    pub boosted_reward: u128,
    /// Effective boost multiplier in BPS (4000 = 1x, 10000 = 2.5x)
    pub boost_multiplier_bps: u16,
    /// User's veVIBE voting power
    pub user_voting_power: u128,
    /// Total veVIBE voting power across all users
    pub total_voting_power: u128,
    /// User's share of the pool's LP tokens in BPS
    pub user_lp_share_bps: u16,
}

// ============ Helper — default constructors for fixed arrays ============

fn default_pool_allocation() -> PoolAllocation {
    PoolAllocation {
        pool_id: [0u8; 32],
        weight_bps: 0,
    }
}

fn default_gauge_emission() -> GaugeEmission {
    GaugeEmission {
        pool_id: [0u8; 32],
        weight: 0,
        weight_bps: 0,
        emission_amount: 0,
    }
}

fn default_allocations() -> [PoolAllocation; 10] {
    [
        default_pool_allocation(),
        default_pool_allocation(),
        default_pool_allocation(),
        default_pool_allocation(),
        default_pool_allocation(),
        default_pool_allocation(),
        default_pool_allocation(),
        default_pool_allocation(),
        default_pool_allocation(),
        default_pool_allocation(),
    ]
}

fn default_gauge_emissions() -> [GaugeEmission; 50] {
    [
        default_gauge_emission(), default_gauge_emission(), default_gauge_emission(),
        default_gauge_emission(), default_gauge_emission(), default_gauge_emission(),
        default_gauge_emission(), default_gauge_emission(), default_gauge_emission(),
        default_gauge_emission(), default_gauge_emission(), default_gauge_emission(),
        default_gauge_emission(), default_gauge_emission(), default_gauge_emission(),
        default_gauge_emission(), default_gauge_emission(), default_gauge_emission(),
        default_gauge_emission(), default_gauge_emission(), default_gauge_emission(),
        default_gauge_emission(), default_gauge_emission(), default_gauge_emission(),
        default_gauge_emission(), default_gauge_emission(), default_gauge_emission(),
        default_gauge_emission(), default_gauge_emission(), default_gauge_emission(),
        default_gauge_emission(), default_gauge_emission(), default_gauge_emission(),
        default_gauge_emission(), default_gauge_emission(), default_gauge_emission(),
        default_gauge_emission(), default_gauge_emission(), default_gauge_emission(),
        default_gauge_emission(), default_gauge_emission(), default_gauge_emission(),
        default_gauge_emission(), default_gauge_emission(), default_gauge_emission(),
        default_gauge_emission(), default_gauge_emission(), default_gauge_emission(),
        default_gauge_emission(), default_gauge_emission(),
    ]
}

// ============ Core Functions ============

/// Create a new gauge for a liquidity pool.
///
/// Returns a fresh Gauge with zero weight, active, and no accumulated emissions.
pub fn create_gauge(pool_id: [u8; 32], epoch: u64) -> Gauge {
    Gauge {
        pool_id,
        total_weight: 0,
        voter_count: 0,
        created_epoch: epoch,
        is_active: true,
        cumulative_emissions: 0,
        last_emission_epoch: 0,
    }
}

/// Cast a vote distributing voting power across one or more pools.
///
/// Validates:
/// - voting_power >= MIN_VOTE_WEIGHT
/// - allocations.len() <= MAX_VOTE_SPLIT
/// - sum of allocation BPS <= 10000
/// - no individual allocation has 0 BPS
///
/// Returns a VoteAllocation on success.
pub fn cast_vote(
    voter: [u8; 32],
    voting_power: u128,
    allocations: &[([u8; 32], u16)],
    epoch: u64,
) -> Result<VoteAllocation, GaugeError> {
    if voting_power < MIN_VOTE_WEIGHT {
        return Err(GaugeError::InsufficientVotingPower);
    }
    if allocations.is_empty() {
        return Err(GaugeError::ZeroWeight);
    }
    if allocations.len() > MAX_VOTE_SPLIT {
        return Err(GaugeError::TooManySplits);
    }

    let mut total_bps: u32 = 0;
    for &(_, bps) in allocations {
        if bps == 0 {
            return Err(GaugeError::ZeroWeight);
        }
        total_bps += bps as u32;
    }
    if total_bps > 10_000 {
        return Err(GaugeError::SplitBpsExceed10000);
    }

    let mut allocs = default_allocations();
    for (i, &(pool_id, bps)) in allocations.iter().enumerate() {
        allocs[i] = PoolAllocation {
            pool_id,
            weight_bps: bps,
        };
    }

    Ok(VoteAllocation {
        voter,
        allocations: allocs,
        allocation_count: allocations.len() as u8,
        voting_power,
        epoch,
    })
}

/// Apply a set of votes to a set of gauges, tallying weights.
///
/// Takes a slice of existing gauges and a slice of vote allocations.
/// Returns a new array of gauges with updated total_weight and voter_count.
///
/// Votes for pools that don't have a gauge or whose gauge is killed are silently skipped.
pub fn apply_votes(
    gauges: &[Gauge],
    votes: &[VoteAllocation],
) -> Result<[Gauge; 50], GaugeError> {
    if gauges.len() > MAX_GAUGES {
        return Err(GaugeError::MaxGaugesReached);
    }

    // Clone gauges into fixed array, reset weights for fresh tally
    let mut result = [
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
        create_gauge([0u8; 32], 0), create_gauge([0u8; 32], 0),
    ];

    let gauge_count = gauges.len();
    for i in 0..gauge_count {
        result[i] = gauges[i].clone();
        // Reset per-epoch tallies
        result[i].total_weight = 0;
        result[i].voter_count = 0;
    }

    // Tally votes
    for vote in votes {
        for a in 0..vote.allocation_count as usize {
            let alloc = &vote.allocations[a];
            // Calculate absolute weight from voter's power and BPS allocation
            let weight = mul_div(vote.voting_power, alloc.weight_bps as u128, BPS);

            // Find matching gauge
            for g in 0..gauge_count {
                if result[g].pool_id == alloc.pool_id && result[g].is_active {
                    result[g].total_weight = result[g]
                        .total_weight
                        .checked_add(weight)
                        .ok_or(GaugeError::Overflow)?;
                    // Increment voter count (simplistic — counts each allocation as a vote)
                    result[g].voter_count += 1;
                    break;
                }
            }
        }
    }

    Ok(result)
}

/// Finalize an epoch: calculate per-gauge emissions proportional to weight.
///
/// Each gauge receives: emission_i = total_emission * (weight_i / total_weight)
/// Uses remainder-based rounding to ensure emissions sum exactly to total_emission.
pub fn finalize_epoch(
    gauges: &[Gauge],
    total_emission: u128,
    epoch: u64,
) -> Result<EpochResult, GaugeError> {
    if total_emission == 0 {
        return Err(GaugeError::ZeroEmission);
    }

    let gauge_count = gauges.len();
    if gauge_count == 0 || gauge_count > MAX_GAUGES {
        return Err(GaugeError::MaxGaugesReached);
    }

    // Sum total weight across all active gauges
    let mut total_weight: u128 = 0;
    for g in gauges.iter().take(gauge_count) {
        if g.is_active && g.total_weight > 0 {
            total_weight = total_weight
                .checked_add(g.total_weight)
                .ok_or(GaugeError::Overflow)?;
        }
    }

    let mut emissions = default_gauge_emissions();
    let mut distributed: u128 = 0;

    if total_weight == 0 {
        // No votes cast — return empty epoch (emissions go back to treasury)
        return Ok(EpochResult {
            epoch,
            total_weight: 0,
            total_emission,
            gauge_emissions: emissions,
            gauge_count: 0,
        });
    }

    // Calculate proportional emissions
    let mut idx: u8 = 0;
    for g in gauges.iter().take(gauge_count) {
        if !g.is_active || g.total_weight == 0 {
            continue;
        }
        let weight_bps = mul_div(g.total_weight, BPS, total_weight) as u16;
        let emission_amount = mul_div(total_emission, g.total_weight, total_weight);

        emissions[idx as usize] = GaugeEmission {
            pool_id: g.pool_id,
            weight: g.total_weight,
            weight_bps,
            emission_amount,
        };
        distributed = distributed
            .checked_add(emission_amount)
            .ok_or(GaugeError::Overflow)?;
        idx += 1;
    }

    // Assign rounding remainder to the largest gauge (index 0 of active set)
    if distributed < total_emission && idx > 0 {
        let remainder = total_emission - distributed;
        // Find the gauge with the largest weight and give it the remainder
        let mut max_idx = 0usize;
        let mut max_weight = 0u128;
        for i in 0..idx as usize {
            if emissions[i].weight > max_weight {
                max_weight = emissions[i].weight;
                max_idx = i;
            }
        }
        emissions[max_idx].emission_amount += remainder;
    }

    Ok(EpochResult {
        epoch,
        total_weight,
        total_emission,
        gauge_emissions: emissions,
        gauge_count: idx,
    })
}

/// Compute the veVIBE boost for a user's LP rewards.
///
/// Boost formula:
///   multiplier = min(BOOST_MAX, BOOST_BASE + (user_vp / total_vp) * (BOOST_MAX - BOOST_BASE))
///
/// Where:
///   BOOST_BASE = 4000 BPS (40% of max = 1x effective)
///   BOOST_MAX  = 2500 BPS → represents 2.5x multiplier = 10000 BPS in "multiplier space"
///
/// The actual multiplier BPS range is [BOOST_BASE_BPS, 10000]:
///   - BOOST_BASE_BPS (4000) = no boost (1x of base reward = 40% of max)
///   - 10000 = full boost (2.5x of base reward = 100% of max)
///
/// boosted_reward = base_reward * multiplier_bps / BOOST_BASE_BPS
pub fn compute_boost(
    user_voting_power: u128,
    total_voting_power: u128,
    user_lp_bps: u16,
    base_reward: u128,
) -> BoostInfo {
    // If no voting power exists, everyone gets base reward
    if total_voting_power == 0 || user_voting_power == 0 {
        return BoostInfo {
            base_reward,
            boosted_reward: base_reward,
            boost_multiplier_bps: BOOST_BASE_BPS,
            user_voting_power,
            total_voting_power,
            user_lp_share_bps: user_lp_bps,
        };
    }

    // vp_ratio = user_voting_power / total_voting_power (in BPS)
    let vp_ratio_bps = mul_div(user_voting_power, BPS, total_voting_power) as u16;

    // boost_range = 10000 - BOOST_BASE_BPS (the range from base to max)
    let boost_range: u16 = 10_000 - BOOST_BASE_BPS;

    // bonus = vp_ratio * boost_range / 10000
    let bonus = (vp_ratio_bps as u32 * boost_range as u32 / 10_000) as u16;

    // multiplier = BOOST_BASE + bonus, capped at 10000
    let multiplier_bps = if BOOST_BASE_BPS + bonus > 10_000 {
        10_000u16
    } else {
        BOOST_BASE_BPS + bonus
    };

    // boosted_reward = base_reward * multiplier / BOOST_BASE
    let boosted_reward = mul_div(base_reward, multiplier_bps as u128, BOOST_BASE_BPS as u128);

    BoostInfo {
        base_reward,
        boosted_reward,
        boost_multiplier_bps: multiplier_bps,
        user_voting_power,
        total_voting_power,
        user_lp_share_bps: user_lp_bps,
    }
}

/// Apply vote weight decay to a gauge.
///
/// Each epoch without refresh, weight decays by DECAY_RATE_BPS (1%).
/// new_weight = weight * (10000 - DECAY_RATE)^epochs / 10000^epochs
/// Implemented iteratively to avoid exponentiation overflow.
pub fn apply_decay(gauge: &Gauge, epochs_elapsed: u64) -> Gauge {
    let mut result = gauge.clone();
    if epochs_elapsed == 0 || result.total_weight == 0 {
        return result;
    }

    let decay_factor = BPS - DECAY_RATE_BPS as u128; // 9900

    for _ in 0..epochs_elapsed {
        result.total_weight = mul_div(result.total_weight, decay_factor, BPS);
        if result.total_weight == 0 {
            break;
        }
    }

    result
}

/// Kill (deactivate) a gauge so it can no longer receive votes.
///
/// Fails if the gauge is already killed.
pub fn kill_gauge(gauge: &Gauge) -> Result<Gauge, GaugeError> {
    if !gauge.is_active {
        return Err(GaugeError::GaugeKilled);
    }
    let mut result = gauge.clone();
    result.is_active = false;
    result.total_weight = 0;
    result.voter_count = 0;
    Ok(result)
}

/// Revive a killed gauge, making it eligible for votes again.
///
/// Fails if the gauge is already active.
pub fn revive_gauge(gauge: &Gauge, epoch: u64) -> Result<Gauge, GaugeError> {
    if gauge.is_active {
        return Err(GaugeError::GaugeAlreadyExists);
    }
    let mut result = gauge.clone();
    result.is_active = true;
    result.total_weight = 0;
    result.voter_count = 0;
    result.last_emission_epoch = epoch;
    Ok(result)
}

/// Estimate annualized APR for a gauge in basis points.
///
/// apr_bps = (emission_per_epoch * epochs_per_year * token_price) / pool_tvl * 10000
///
/// Returns 0 if pool_tvl is zero. All values are in PRECISION (1e18) scale.
pub fn estimate_apr(
    emission_per_epoch: u128,
    pool_tvl: u128,
    token_price: u128,
    epochs_per_year: u64,
) -> u128 {
    if pool_tvl == 0 {
        return 0;
    }
    // annual_emission_value = emission_per_epoch * epochs_per_year * token_price / PRECISION
    let annual_emission = emission_per_epoch
        .checked_mul(epochs_per_year as u128)
        .unwrap_or(u128::MAX);
    if annual_emission == u128::MAX {
        return u128::MAX;
    }
    let annual_value = mul_div(annual_emission, token_price, PRECISION);
    // apr_bps = annual_value * 10000 / pool_tvl
    mul_div(annual_value, BPS, pool_tvl)
}

/// Calculate a vote's decayed weight at a target epoch.
///
/// Decays by DECAY_RATE_BPS per epoch elapsed since the vote was cast.
/// Returns 0 if target_epoch is before the vote epoch.
pub fn vote_weight_at_epoch(vote: &VoteAllocation, target_epoch: u64) -> u128 {
    if target_epoch < vote.epoch {
        return 0;
    }
    let epochs_elapsed = target_epoch - vote.epoch;
    if epochs_elapsed == 0 {
        return vote.voting_power;
    }

    let decay_factor = BPS - DECAY_RATE_BPS as u128; // 9900
    let mut weight = vote.voting_power;
    for _ in 0..epochs_elapsed {
        weight = mul_div(weight, decay_factor, BPS);
        if weight == 0 {
            break;
        }
    }
    weight
}

/// Calculate a gauge's relative weight as a share of total weight in BPS.
///
/// Returns 0 if total_weight is 0.
pub fn relative_weight(gauge: &Gauge, total_weight: u128) -> u16 {
    if total_weight == 0 || gauge.total_weight == 0 {
        return 0;
    }
    mul_div(gauge.total_weight, BPS, total_weight) as u16
}

/// Return the top N gauges by weight from the gauge array.
///
/// Returns a fixed-size array of (index, weight) pairs, sorted descending by weight.
/// Unused slots have weight = 0.
pub fn top_gauges(gauges: &[Gauge], n: usize) -> [(usize, u128); 50] {
    let mut result = [(0usize, 0u128); 50];
    let count = gauges.len().min(MAX_GAUGES);
    let n = n.min(count);

    // Collect active gauges with non-zero weight
    let mut candidates = [(0usize, 0u128); 50];
    let mut candidate_count = 0usize;
    for i in 0..count {
        if gauges[i].is_active && gauges[i].total_weight > 0 {
            candidates[candidate_count] = (i, gauges[i].total_weight);
            candidate_count += 1;
        }
    }

    // Selection sort top N (sufficient for MAX_GAUGES=50)
    for i in 0..n.min(candidate_count) {
        let mut max_idx = i;
        for j in (i + 1)..candidate_count {
            if candidates[j].1 > candidates[max_idx].1 {
                max_idx = j;
            }
        }
        // Swap
        let tmp = candidates[i];
        candidates[i] = candidates[max_idx];
        candidates[max_idx] = tmp;

        result[i] = candidates[i];
    }

    result
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // Helper: create a pool_id from a single byte for readability
    fn pid(b: u8) -> [u8; 32] {
        let mut id = [0u8; 32];
        id[0] = b;
        id
    }

    // Helper: create a voter id from a single byte
    fn vid(b: u8) -> [u8; 32] {
        let mut id = [0u8; 32];
        id[0] = b;
        id
    }

    // Helper: 1 VIBE in wei
    const ONE_VIBE: u128 = 1_000_000_000_000_000_000;

    // ============ Gauge Creation ============

    #[test]
    fn test_create_gauge_basic() {
        let g = create_gauge(pid(1), 0);
        assert_eq!(g.pool_id, pid(1));
        assert_eq!(g.total_weight, 0);
        assert_eq!(g.voter_count, 0);
        assert_eq!(g.created_epoch, 0);
        assert!(g.is_active);
        assert_eq!(g.cumulative_emissions, 0);
        assert_eq!(g.last_emission_epoch, 0);
    }

    #[test]
    fn test_create_gauge_nonzero_epoch() {
        let g = create_gauge(pid(5), 42);
        assert_eq!(g.created_epoch, 42);
        assert!(g.is_active);
    }

    #[test]
    fn test_create_gauge_different_pool_ids() {
        let g1 = create_gauge(pid(1), 0);
        let g2 = create_gauge(pid(2), 0);
        assert_ne!(g1.pool_id, g2.pool_id);
    }

    #[test]
    fn test_create_gauge_zero_pool_id() {
        let g = create_gauge([0u8; 32], 0);
        assert_eq!(g.pool_id, [0u8; 32]);
        assert!(g.is_active);
    }

    #[test]
    fn test_create_gauge_max_epoch() {
        let g = create_gauge(pid(1), u64::MAX);
        assert_eq!(g.created_epoch, u64::MAX);
    }

    // ============ Kill / Revive Lifecycle ============

    #[test]
    fn test_kill_gauge_active() {
        let g = create_gauge(pid(1), 0);
        let killed = kill_gauge(&g).unwrap();
        assert!(!killed.is_active);
        assert_eq!(killed.total_weight, 0);
        assert_eq!(killed.voter_count, 0);
    }

    #[test]
    fn test_kill_gauge_already_killed() {
        let g = create_gauge(pid(1), 0);
        let killed = kill_gauge(&g).unwrap();
        let err = kill_gauge(&killed).unwrap_err();
        assert_eq!(err, GaugeError::GaugeKilled);
    }

    #[test]
    fn test_kill_gauge_preserves_cumulative_emissions() {
        let mut g = create_gauge(pid(1), 0);
        g.cumulative_emissions = 1_000_000;
        let killed = kill_gauge(&g).unwrap();
        assert_eq!(killed.cumulative_emissions, 1_000_000);
    }

    #[test]
    fn test_kill_gauge_preserves_pool_id() {
        let g = create_gauge(pid(42), 5);
        let killed = kill_gauge(&g).unwrap();
        assert_eq!(killed.pool_id, pid(42));
        assert_eq!(killed.created_epoch, 5);
    }

    #[test]
    fn test_kill_gauge_clears_weight() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = 999_999;
        g.voter_count = 10;
        let killed = kill_gauge(&g).unwrap();
        assert_eq!(killed.total_weight, 0);
        assert_eq!(killed.voter_count, 0);
    }

    #[test]
    fn test_revive_gauge_killed() {
        let g = create_gauge(pid(1), 0);
        let killed = kill_gauge(&g).unwrap();
        let revived = revive_gauge(&killed, 10).unwrap();
        assert!(revived.is_active);
        assert_eq!(revived.total_weight, 0);
        assert_eq!(revived.last_emission_epoch, 10);
    }

    #[test]
    fn test_revive_gauge_already_active() {
        let g = create_gauge(pid(1), 0);
        let err = revive_gauge(&g, 10).unwrap_err();
        assert_eq!(err, GaugeError::GaugeAlreadyExists);
    }

    #[test]
    fn test_kill_revive_kill_cycle() {
        let g = create_gauge(pid(1), 0);
        let k1 = kill_gauge(&g).unwrap();
        let r1 = revive_gauge(&k1, 5).unwrap();
        let k2 = kill_gauge(&r1).unwrap();
        assert!(!k2.is_active);
        let r2 = revive_gauge(&k2, 10).unwrap();
        assert!(r2.is_active);
        assert_eq!(r2.last_emission_epoch, 10);
    }

    #[test]
    fn test_revive_preserves_cumulative_emissions() {
        let mut g = create_gauge(pid(1), 0);
        g.cumulative_emissions = 5_000_000;
        g.is_active = false;
        let revived = revive_gauge(&g, 7).unwrap();
        assert_eq!(revived.cumulative_emissions, 5_000_000);
    }

    // ============ Vote Casting — Valid ============

    #[test]
    fn test_cast_vote_single_pool() {
        let allocs = vec![(pid(1), 10_000u16)];
        let vote = cast_vote(vid(1), ONE_VIBE, &allocs, 0).unwrap();
        assert_eq!(vote.allocation_count, 1);
        assert_eq!(vote.allocations[0].pool_id, pid(1));
        assert_eq!(vote.allocations[0].weight_bps, 10_000);
        assert_eq!(vote.voting_power, ONE_VIBE);
        assert_eq!(vote.epoch, 0);
    }

    #[test]
    fn test_cast_vote_two_pools_equal_split() {
        let allocs = vec![(pid(1), 5_000), (pid(2), 5_000)];
        let vote = cast_vote(vid(1), ONE_VIBE * 10, &allocs, 1).unwrap();
        assert_eq!(vote.allocation_count, 2);
        assert_eq!(vote.allocations[0].weight_bps, 5_000);
        assert_eq!(vote.allocations[1].weight_bps, 5_000);
    }

    #[test]
    fn test_cast_vote_max_splits() {
        let allocs: Vec<([u8; 32], u16)> = (0..10).map(|i| (pid(i as u8), 1_000)).collect();
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &allocs, 0).unwrap();
        assert_eq!(vote.allocation_count, 10);
    }

    #[test]
    fn test_cast_vote_partial_allocation() {
        // Only allocate 50% of voting power
        let allocs = vec![(pid(1), 5_000)];
        let vote = cast_vote(vid(1), ONE_VIBE * 5, &allocs, 0).unwrap();
        assert_eq!(vote.allocation_count, 1);
        assert_eq!(vote.allocations[0].weight_bps, 5_000);
    }

    #[test]
    fn test_cast_vote_minimum_voting_power() {
        let allocs = vec![(pid(1), 10_000)];
        let vote = cast_vote(vid(1), MIN_VOTE_WEIGHT, &allocs, 0).unwrap();
        assert_eq!(vote.voting_power, MIN_VOTE_WEIGHT);
    }

    #[test]
    fn test_cast_vote_large_voting_power() {
        let allocs = vec![(pid(1), 10_000)];
        let vote = cast_vote(vid(1), ONE_VIBE * 1_000_000, &allocs, 0).unwrap();
        assert_eq!(vote.voting_power, ONE_VIBE * 1_000_000);
    }

    #[test]
    fn test_cast_vote_uneven_split() {
        let allocs = vec![(pid(1), 7_000), (pid(2), 3_000)];
        let vote = cast_vote(vid(1), ONE_VIBE * 10, &allocs, 0).unwrap();
        assert_eq!(vote.allocations[0].weight_bps, 7_000);
        assert_eq!(vote.allocations[1].weight_bps, 3_000);
    }

    #[test]
    fn test_cast_vote_three_way_split() {
        let allocs = vec![(pid(1), 5_000), (pid(2), 3_000), (pid(3), 2_000)];
        let vote = cast_vote(vid(1), ONE_VIBE * 50, &allocs, 0).unwrap();
        assert_eq!(vote.allocation_count, 3);
    }

    #[test]
    fn test_cast_vote_preserves_epoch() {
        let allocs = vec![(pid(1), 10_000)];
        let vote = cast_vote(vid(1), ONE_VIBE, &allocs, 999).unwrap();
        assert_eq!(vote.epoch, 999);
    }

    #[test]
    fn test_cast_vote_preserves_voter() {
        let allocs = vec![(pid(1), 10_000)];
        let vote = cast_vote(vid(42), ONE_VIBE, &allocs, 0).unwrap();
        assert_eq!(vote.voter, vid(42));
    }

    // ============ Vote Casting — Invalid ============

    #[test]
    fn test_cast_vote_insufficient_power() {
        let allocs = vec![(pid(1), 10_000)];
        let err = cast_vote(vid(1), MIN_VOTE_WEIGHT - 1, &allocs, 0).unwrap_err();
        assert_eq!(err, GaugeError::InsufficientVotingPower);
    }

    #[test]
    fn test_cast_vote_zero_power() {
        let allocs = vec![(pid(1), 10_000)];
        let err = cast_vote(vid(1), 0, &allocs, 0).unwrap_err();
        assert_eq!(err, GaugeError::InsufficientVotingPower);
    }

    #[test]
    fn test_cast_vote_too_many_splits() {
        let allocs: Vec<([u8; 32], u16)> = (0..11).map(|i| (pid(i as u8), 909)).collect();
        let err = cast_vote(vid(1), ONE_VIBE * 100, &allocs, 0).unwrap_err();
        assert_eq!(err, GaugeError::TooManySplits);
    }

    #[test]
    fn test_cast_vote_bps_exceed_10000() {
        let allocs = vec![(pid(1), 6_000), (pid(2), 5_000)];
        let err = cast_vote(vid(1), ONE_VIBE * 10, &allocs, 0).unwrap_err();
        assert_eq!(err, GaugeError::SplitBpsExceed10000);
    }

    #[test]
    fn test_cast_vote_single_allocation_exceeds_10000() {
        let allocs = vec![(pid(1), 10_001)];
        let err = cast_vote(vid(1), ONE_VIBE, &allocs, 0).unwrap_err();
        assert_eq!(err, GaugeError::SplitBpsExceed10000);
    }

    #[test]
    fn test_cast_vote_zero_bps_allocation() {
        let allocs = vec![(pid(1), 0)];
        let err = cast_vote(vid(1), ONE_VIBE, &allocs, 0).unwrap_err();
        assert_eq!(err, GaugeError::ZeroWeight);
    }

    #[test]
    fn test_cast_vote_empty_allocations() {
        let allocs: Vec<([u8; 32], u16)> = vec![];
        let err = cast_vote(vid(1), ONE_VIBE, &allocs, 0).unwrap_err();
        assert_eq!(err, GaugeError::ZeroWeight);
    }

    #[test]
    fn test_cast_vote_mixed_zero_and_valid_bps() {
        let allocs = vec![(pid(1), 5_000), (pid(2), 0)];
        let err = cast_vote(vid(1), ONE_VIBE * 10, &allocs, 0).unwrap_err();
        assert_eq!(err, GaugeError::ZeroWeight);
    }

    #[test]
    fn test_cast_vote_exactly_one_below_min() {
        let allocs = vec![(pid(1), 10_000)];
        let err = cast_vote(vid(1), MIN_VOTE_WEIGHT - 1, &allocs, 0).unwrap_err();
        assert_eq!(err, GaugeError::InsufficientVotingPower);
    }

    // ============ Vote Application — Single Voter ============

    #[test]
    fn test_apply_votes_single_voter_single_gauge() {
        let gauges = vec![create_gauge(pid(1), 0)];
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 10_000)], 0).unwrap();
        let result = apply_votes(&gauges, &[vote]).unwrap();
        assert_eq!(result[0].total_weight, ONE_VIBE * 100);
        assert_eq!(result[0].voter_count, 1);
    }

    #[test]
    fn test_apply_votes_single_voter_split_two_gauges() {
        let gauges = vec![create_gauge(pid(1), 0), create_gauge(pid(2), 0)];
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 6_000), (pid(2), 4_000)], 0).unwrap();
        let result = apply_votes(&gauges, &[vote]).unwrap();
        // 100 VIBE * 60% = 60 VIBE
        assert_eq!(result[0].total_weight, ONE_VIBE * 60);
        // 100 VIBE * 40% = 40 VIBE
        assert_eq!(result[1].total_weight, ONE_VIBE * 40);
    }

    #[test]
    fn test_apply_votes_single_voter_partial_allocation() {
        let gauges = vec![create_gauge(pid(1), 0)];
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 5_000)], 0).unwrap();
        let result = apply_votes(&gauges, &[vote]).unwrap();
        assert_eq!(result[0].total_weight, ONE_VIBE * 50);
    }

    #[test]
    fn test_apply_votes_vote_for_nonexistent_gauge_ignored() {
        let gauges = vec![create_gauge(pid(1), 0)];
        let vote = cast_vote(vid(1), ONE_VIBE, &[(pid(99), 10_000)], 0).unwrap();
        let result = apply_votes(&gauges, &[vote]).unwrap();
        assert_eq!(result[0].total_weight, 0);
    }

    #[test]
    fn test_apply_votes_vote_for_killed_gauge_ignored() {
        let g = create_gauge(pid(1), 0);
        let killed = kill_gauge(&g).unwrap();
        let gauges = vec![killed];
        let vote = cast_vote(vid(1), ONE_VIBE, &[(pid(1), 10_000)], 0).unwrap();
        let result = apply_votes(&gauges, &[vote]).unwrap();
        assert_eq!(result[0].total_weight, 0);
    }

    // ============ Vote Application — Multiple Voters ============

    #[test]
    fn test_apply_votes_two_voters_same_gauge() {
        let gauges = vec![create_gauge(pid(1), 0)];
        let v1 = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 10_000)], 0).unwrap();
        let v2 = cast_vote(vid(2), ONE_VIBE * 200, &[(pid(1), 10_000)], 0).unwrap();
        let result = apply_votes(&gauges, &[v1, v2]).unwrap();
        assert_eq!(result[0].total_weight, ONE_VIBE * 300);
        assert_eq!(result[0].voter_count, 2);
    }

    #[test]
    fn test_apply_votes_two_voters_different_gauges() {
        let gauges = vec![create_gauge(pid(1), 0), create_gauge(pid(2), 0)];
        let v1 = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 10_000)], 0).unwrap();
        let v2 = cast_vote(vid(2), ONE_VIBE * 200, &[(pid(2), 10_000)], 0).unwrap();
        let result = apply_votes(&gauges, &[v1, v2]).unwrap();
        assert_eq!(result[0].total_weight, ONE_VIBE * 100);
        assert_eq!(result[1].total_weight, ONE_VIBE * 200);
    }

    #[test]
    fn test_apply_votes_three_voters_overlapping() {
        let gauges = vec![create_gauge(pid(1), 0), create_gauge(pid(2), 0)];
        let v1 = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 5_000), (pid(2), 5_000)], 0).unwrap();
        let v2 = cast_vote(vid(2), ONE_VIBE * 200, &[(pid(1), 10_000)], 0).unwrap();
        let v3 = cast_vote(vid(3), ONE_VIBE * 50, &[(pid(2), 10_000)], 0).unwrap();
        let result = apply_votes(&gauges, &[v1, v2, v3]).unwrap();
        // Gauge 1: 50 + 200 = 250
        assert_eq!(result[0].total_weight, ONE_VIBE * 250);
        // Gauge 2: 50 + 50 = 100
        assert_eq!(result[1].total_weight, ONE_VIBE * 100);
    }

    #[test]
    fn test_apply_votes_no_votes() {
        let gauges = vec![create_gauge(pid(1), 0)];
        let result = apply_votes(&gauges, &[]).unwrap();
        assert_eq!(result[0].total_weight, 0);
        assert_eq!(result[0].voter_count, 0);
    }

    #[test]
    fn test_apply_votes_resets_previous_weights() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = 999_999;
        g.voter_count = 42;
        let gauges = vec![g];
        let result = apply_votes(&gauges, &[]).unwrap();
        assert_eq!(result[0].total_weight, 0);
        assert_eq!(result[0].voter_count, 0);
    }

    #[test]
    fn test_apply_votes_many_voters_same_gauge() {
        let gauges = vec![create_gauge(pid(1), 0)];
        let votes: Vec<VoteAllocation> = (0..20)
            .map(|i| cast_vote(vid(i as u8), ONE_VIBE * 10, &[(pid(1), 10_000)], 0).unwrap())
            .collect();
        let result = apply_votes(&gauges, &votes).unwrap();
        assert_eq!(result[0].total_weight, ONE_VIBE * 200);
        assert_eq!(result[0].voter_count, 20);
    }

    #[test]
    fn test_apply_votes_preserves_gauge_metadata() {
        let mut g = create_gauge(pid(1), 5);
        g.cumulative_emissions = 12345;
        g.last_emission_epoch = 4;
        let gauges = vec![g];
        let vote = cast_vote(vid(1), ONE_VIBE, &[(pid(1), 10_000)], 0).unwrap();
        let result = apply_votes(&gauges, &[vote]).unwrap();
        assert_eq!(result[0].created_epoch, 5);
        assert_eq!(result[0].cumulative_emissions, 12345);
        assert_eq!(result[0].last_emission_epoch, 4);
    }

    // ============ Epoch Finalization ============

    #[test]
    fn test_finalize_epoch_single_gauge() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE * 100;
        let gauges = vec![g];
        let result = finalize_epoch(&gauges, ONE_VIBE * 1000, 1).unwrap();
        assert_eq!(result.epoch, 1);
        assert_eq!(result.total_weight, ONE_VIBE * 100);
        assert_eq!(result.gauge_count, 1);
        assert_eq!(result.gauge_emissions[0].emission_amount, ONE_VIBE * 1000);
    }

    #[test]
    fn test_finalize_epoch_two_equal_gauges() {
        let mut g1 = create_gauge(pid(1), 0);
        g1.total_weight = ONE_VIBE * 50;
        let mut g2 = create_gauge(pid(2), 0);
        g2.total_weight = ONE_VIBE * 50;
        let gauges = vec![g1, g2];
        let result = finalize_epoch(&gauges, ONE_VIBE * 1000, 1).unwrap();
        assert_eq!(result.gauge_count, 2);
        assert_eq!(result.gauge_emissions[0].emission_amount, ONE_VIBE * 500);
        assert_eq!(result.gauge_emissions[1].emission_amount, ONE_VIBE * 500);
    }

    #[test]
    fn test_finalize_epoch_unequal_gauges() {
        let mut g1 = create_gauge(pid(1), 0);
        g1.total_weight = ONE_VIBE * 75;
        let mut g2 = create_gauge(pid(2), 0);
        g2.total_weight = ONE_VIBE * 25;
        let gauges = vec![g1, g2];
        let result = finalize_epoch(&gauges, ONE_VIBE * 1000, 1).unwrap();
        assert_eq!(result.gauge_emissions[0].emission_amount, ONE_VIBE * 750);
        assert_eq!(result.gauge_emissions[1].emission_amount, ONE_VIBE * 250);
    }

    #[test]
    fn test_finalize_epoch_weight_bps() {
        let mut g1 = create_gauge(pid(1), 0);
        g1.total_weight = ONE_VIBE * 60;
        let mut g2 = create_gauge(pid(2), 0);
        g2.total_weight = ONE_VIBE * 40;
        let gauges = vec![g1, g2];
        let result = finalize_epoch(&gauges, ONE_VIBE * 1000, 1).unwrap();
        assert_eq!(result.gauge_emissions[0].weight_bps, 6_000);
        assert_eq!(result.gauge_emissions[1].weight_bps, 4_000);
    }

    #[test]
    fn test_finalize_epoch_zero_emission_error() {
        let gauges = vec![create_gauge(pid(1), 0)];
        let err = finalize_epoch(&gauges, 0, 0).unwrap_err();
        assert_eq!(err, GaugeError::ZeroEmission);
    }

    #[test]
    fn test_finalize_epoch_empty_gauges() {
        let gauges: Vec<Gauge> = vec![];
        let err = finalize_epoch(&gauges, ONE_VIBE, 0).unwrap_err();
        assert_eq!(err, GaugeError::MaxGaugesReached);
    }

    #[test]
    fn test_finalize_epoch_all_zero_weight() {
        let g1 = create_gauge(pid(1), 0);
        let g2 = create_gauge(pid(2), 0);
        let gauges = vec![g1, g2];
        let result = finalize_epoch(&gauges, ONE_VIBE * 1000, 1).unwrap();
        // No weights — emissions go back to treasury
        assert_eq!(result.gauge_count, 0);
        assert_eq!(result.total_weight, 0);
    }

    #[test]
    fn test_finalize_epoch_killed_gauge_excluded() {
        let mut g1 = create_gauge(pid(1), 0);
        g1.total_weight = ONE_VIBE * 100;
        let mut g2 = create_gauge(pid(2), 0);
        g2.total_weight = ONE_VIBE * 100;
        g2.is_active = false;
        let gauges = vec![g1, g2];
        let result = finalize_epoch(&gauges, ONE_VIBE * 1000, 1).unwrap();
        assert_eq!(result.gauge_count, 1);
        assert_eq!(result.gauge_emissions[0].emission_amount, ONE_VIBE * 1000);
    }

    #[test]
    fn test_finalize_epoch_remainder_rounding() {
        // 3 gauges with equal weight — 1000 / 3 doesn't divide evenly
        let mut g1 = create_gauge(pid(1), 0);
        g1.total_weight = ONE_VIBE;
        let mut g2 = create_gauge(pid(2), 0);
        g2.total_weight = ONE_VIBE;
        let mut g3 = create_gauge(pid(3), 0);
        g3.total_weight = ONE_VIBE;
        let gauges = vec![g1, g2, g3];
        let total = ONE_VIBE * 1000;
        let result = finalize_epoch(&gauges, total, 1).unwrap();
        // Sum of emissions should equal total (remainder assigned to largest)
        let sum: u128 = (0..result.gauge_count as usize)
            .map(|i| result.gauge_emissions[i].emission_amount)
            .sum();
        assert_eq!(sum, total);
    }

    #[test]
    fn test_finalize_epoch_preserves_epoch_number() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE;
        let result = finalize_epoch(&[g], ONE_VIBE * 100, 42).unwrap();
        assert_eq!(result.epoch, 42);
    }

    #[test]
    fn test_finalize_epoch_total_emission_stored() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE;
        let result = finalize_epoch(&[g], ONE_VIBE * 777, 1).unwrap();
        assert_eq!(result.total_emission, ONE_VIBE * 777);
    }

    #[test]
    fn test_finalize_epoch_dominant_gauge() {
        let mut g1 = create_gauge(pid(1), 0);
        g1.total_weight = ONE_VIBE * 990;
        let mut g2 = create_gauge(pid(2), 0);
        g2.total_weight = ONE_VIBE * 10;
        let gauges = vec![g1, g2];
        let result = finalize_epoch(&gauges, ONE_VIBE * 1000, 1).unwrap();
        assert_eq!(result.gauge_emissions[0].weight_bps, 9_900);
        assert_eq!(result.gauge_emissions[1].weight_bps, 100);
    }

    // ============ Boost ============

    #[test]
    fn test_boost_no_voting_power() {
        let info = compute_boost(0, ONE_VIBE * 1000, 5_000, ONE_VIBE * 100);
        assert_eq!(info.boost_multiplier_bps, BOOST_BASE_BPS);
        assert_eq!(info.boosted_reward, ONE_VIBE * 100);
    }

    #[test]
    fn test_boost_zero_total_vp() {
        let info = compute_boost(ONE_VIBE * 100, 0, 5_000, ONE_VIBE * 100);
        assert_eq!(info.boost_multiplier_bps, BOOST_BASE_BPS);
        assert_eq!(info.boosted_reward, ONE_VIBE * 100);
    }

    #[test]
    fn test_boost_full_voting_power() {
        // User has 100% of voting power
        let info = compute_boost(ONE_VIBE * 1000, ONE_VIBE * 1000, 10_000, ONE_VIBE * 100);
        assert_eq!(info.boost_multiplier_bps, 10_000);
        // boosted = 100 * 10000 / 4000 = 250
        assert_eq!(info.boosted_reward, ONE_VIBE * 250);
    }

    #[test]
    fn test_boost_half_voting_power() {
        // User has 50% of voting power
        let info = compute_boost(ONE_VIBE * 500, ONE_VIBE * 1000, 5_000, ONE_VIBE * 100);
        // vp_ratio = 5000 BPS, boost_range = 6000
        // bonus = 5000 * 6000 / 10000 = 3000
        // multiplier = 4000 + 3000 = 7000
        assert_eq!(info.boost_multiplier_bps, 7_000);
        // boosted = 100 * 7000 / 4000 = 175
        assert_eq!(info.boosted_reward, ONE_VIBE * 175);
    }

    #[test]
    fn test_boost_small_voting_power() {
        // User has 1% of voting power
        let info = compute_boost(ONE_VIBE * 10, ONE_VIBE * 1000, 1_000, ONE_VIBE * 100);
        // vp_ratio = 100 BPS, boost_range = 6000
        // bonus = 100 * 6000 / 10000 = 60
        // multiplier = 4000 + 60 = 4060
        assert_eq!(info.boost_multiplier_bps, 4_060);
    }

    #[test]
    fn test_boost_preserves_user_info() {
        let info = compute_boost(ONE_VIBE * 42, ONE_VIBE * 100, 3_000, ONE_VIBE * 50);
        assert_eq!(info.user_voting_power, ONE_VIBE * 42);
        assert_eq!(info.total_voting_power, ONE_VIBE * 100);
        assert_eq!(info.user_lp_share_bps, 3_000);
        assert_eq!(info.base_reward, ONE_VIBE * 50);
    }

    #[test]
    fn test_boost_base_always_lte_boosted() {
        let info = compute_boost(ONE_VIBE, ONE_VIBE * 100, 500, ONE_VIBE * 100);
        assert!(info.boosted_reward >= info.base_reward);
    }

    #[test]
    fn test_boost_max_cap() {
        // Even with more VP than total (shouldn't happen but test the cap)
        let info = compute_boost(ONE_VIBE * 2000, ONE_VIBE * 1000, 10_000, ONE_VIBE * 100);
        // vp_ratio would be > 10000, but mul_div handles it; cap at 10000
        assert!(info.boost_multiplier_bps <= 10_000);
    }

    #[test]
    fn test_boost_zero_base_reward() {
        let info = compute_boost(ONE_VIBE * 500, ONE_VIBE * 1000, 5_000, 0);
        assert_eq!(info.boosted_reward, 0);
        assert_eq!(info.base_reward, 0);
    }

    #[test]
    fn test_boost_tiny_voting_power() {
        // User has 0.01% of voting power
        let info = compute_boost(ONE_VIBE / 10, ONE_VIBE * 1000, 500, ONE_VIBE * 100);
        // Very small bonus, should still be >= base
        assert!(info.boost_multiplier_bps >= BOOST_BASE_BPS);
        assert!(info.boosted_reward >= info.base_reward);
    }

    #[test]
    fn test_boost_equal_vp_base_increases() {
        // As user VP increases, boost should increase
        let info1 = compute_boost(ONE_VIBE * 10, ONE_VIBE * 100, 5_000, ONE_VIBE * 100);
        let info2 = compute_boost(ONE_VIBE * 50, ONE_VIBE * 100, 5_000, ONE_VIBE * 100);
        let info3 = compute_boost(ONE_VIBE * 100, ONE_VIBE * 100, 5_000, ONE_VIBE * 100);
        assert!(info1.boosted_reward <= info2.boosted_reward);
        assert!(info2.boosted_reward <= info3.boosted_reward);
    }

    // ============ Decay ============

    #[test]
    fn test_decay_zero_epochs() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE * 100;
        let decayed = apply_decay(&g, 0);
        assert_eq!(decayed.total_weight, ONE_VIBE * 100);
    }

    #[test]
    fn test_decay_single_epoch() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE * 100;
        let decayed = apply_decay(&g, 1);
        // 100 * 9900 / 10000 = 99
        assert_eq!(decayed.total_weight, ONE_VIBE * 99);
    }

    #[test]
    fn test_decay_two_epochs() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE * 100;
        let decayed = apply_decay(&g, 2);
        // 100 * 0.99^2 = 98.01
        assert_eq!(decayed.total_weight, mul_div(ONE_VIBE * 100, 9900 * 9900, 10000 * 10000));
    }

    #[test]
    fn test_decay_ten_epochs() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE * 100;
        let decayed = apply_decay(&g, 10);
        // After 10 epochs of 1% decay, weight should be ~90.44% of original
        // 100 * 0.99^10 ≈ 90.438...
        assert!(decayed.total_weight < ONE_VIBE * 91);
        assert!(decayed.total_weight > ONE_VIBE * 90);
    }

    #[test]
    fn test_decay_many_epochs_approaches_zero() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE * 100;
        let decayed = apply_decay(&g, 1000);
        // 0.99^1000 ≈ 4.3e-5, so ~0.0043 VIBE
        assert!(decayed.total_weight < ONE_VIBE / 100);
    }

    #[test]
    fn test_decay_floors_at_zero() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = 1; // 1 wei
        let decayed = apply_decay(&g, 1);
        // 1 * 9900 / 10000 = 0 (integer division)
        assert_eq!(decayed.total_weight, 0);
    }

    #[test]
    fn test_decay_zero_weight_unchanged() {
        let g = create_gauge(pid(1), 0);
        let decayed = apply_decay(&g, 10);
        assert_eq!(decayed.total_weight, 0);
    }

    #[test]
    fn test_decay_preserves_other_fields() {
        let mut g = create_gauge(pid(42), 7);
        g.total_weight = ONE_VIBE * 100;
        g.cumulative_emissions = 5_000;
        g.voter_count = 3;
        let decayed = apply_decay(&g, 1);
        assert_eq!(decayed.pool_id, pid(42));
        assert_eq!(decayed.created_epoch, 7);
        assert_eq!(decayed.cumulative_emissions, 5_000);
        assert_eq!(decayed.voter_count, 3);
        assert!(decayed.is_active);
    }

    #[test]
    fn test_decay_large_weight() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = u128::MAX / 2;
        let decayed = apply_decay(&g, 1);
        let expected = mul_div(u128::MAX / 2, 9900, 10000);
        assert_eq!(decayed.total_weight, expected);
    }

    #[test]
    fn test_decay_compound_vs_sequential() {
        // Applying decay 3 times individually should equal applying once with epochs=3
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE * 100;

        let sequential = apply_decay(&apply_decay(&apply_decay(&g, 1), 1), 1);
        let compound = apply_decay(&g, 3);
        assert_eq!(sequential.total_weight, compound.total_weight);
    }

    // ============ APR Estimation ============

    #[test]
    fn test_estimate_apr_basic() {
        // 100 VIBE per epoch, 365 epochs/year, $1 price, $100k TVL
        let emission = ONE_VIBE * 100;
        let tvl = ONE_VIBE * 100_000;
        let price = ONE_VIBE; // $1
        let epochs = 365u64;
        let apr = estimate_apr(emission, tvl, price, epochs);
        // annual = 100 * 365 = 36500, value = 36500 * 1 = 36500
        // apr_bps = 36500 * 10000 / 100000 = 3650
        assert_eq!(apr, 3650);
    }

    #[test]
    fn test_estimate_apr_zero_tvl() {
        let apr = estimate_apr(ONE_VIBE * 100, 0, ONE_VIBE, 365);
        assert_eq!(apr, 0);
    }

    #[test]
    fn test_estimate_apr_zero_emission() {
        let apr = estimate_apr(0, ONE_VIBE * 100_000, ONE_VIBE, 365);
        assert_eq!(apr, 0);
    }

    #[test]
    fn test_estimate_apr_zero_price() {
        let apr = estimate_apr(ONE_VIBE * 100, ONE_VIBE * 100_000, 0, 365);
        assert_eq!(apr, 0);
    }

    #[test]
    fn test_estimate_apr_high_emission_low_tvl() {
        // High APR scenario
        let emission = ONE_VIBE * 1000;
        let tvl = ONE_VIBE * 1000;
        let price = ONE_VIBE * 10; // $10
        let epochs = 365u64;
        let apr = estimate_apr(emission, tvl, price, epochs);
        // annual = 1000 * 365 = 365000, value = 365000 * 10 = 3650000
        // apr_bps = 3650000 * 10000 / 1000 = 36500000
        assert_eq!(apr, 36_500_000);
    }

    #[test]
    fn test_estimate_apr_low_emission_high_tvl() {
        let emission = ONE_VIBE;
        let tvl = ONE_VIBE * 10_000_000;
        let price = ONE_VIBE;
        let epochs = 365u64;
        let apr = estimate_apr(emission, tvl, price, epochs);
        // annual = 365, value = 365
        // apr_bps = 365 * 10000 / 10000000 = 0 (integer division)
        assert_eq!(apr, 0);
    }

    #[test]
    fn test_estimate_apr_one_epoch_per_year() {
        let emission = ONE_VIBE * 100;
        let tvl = ONE_VIBE * 1000;
        let price = ONE_VIBE;
        let apr = estimate_apr(emission, tvl, price, 1);
        // annual = 100, value = 100, apr_bps = 100 * 10000 / 1000 = 1000
        assert_eq!(apr, 1000);
    }

    #[test]
    fn test_estimate_apr_high_price() {
        let emission = ONE_VIBE * 10;
        let tvl = ONE_VIBE * 100_000;
        let price = ONE_VIBE * 100; // $100
        let epochs = 365u64;
        let apr = estimate_apr(emission, tvl, price, epochs);
        // annual = 3650, value = 365000, apr_bps = 365000 * 10000 / 100000 = 36500
        assert_eq!(apr, 36_500);
    }

    // ============ Vote Weight at Epoch ============

    #[test]
    fn test_vote_weight_same_epoch() {
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 10_000)], 5).unwrap();
        let weight = vote_weight_at_epoch(&vote, 5);
        assert_eq!(weight, ONE_VIBE * 100);
    }

    #[test]
    fn test_vote_weight_one_epoch_later() {
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 10_000)], 5).unwrap();
        let weight = vote_weight_at_epoch(&vote, 6);
        assert_eq!(weight, ONE_VIBE * 99);
    }

    #[test]
    fn test_vote_weight_before_vote_epoch() {
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 10_000)], 5).unwrap();
        let weight = vote_weight_at_epoch(&vote, 3);
        assert_eq!(weight, 0);
    }

    #[test]
    fn test_vote_weight_many_epochs_later() {
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 10_000)], 0).unwrap();
        let weight = vote_weight_at_epoch(&vote, 100);
        // 100 * 0.99^100 ≈ 36.6
        assert!(weight < ONE_VIBE * 37);
        assert!(weight > ONE_VIBE * 36);
    }

    #[test]
    fn test_vote_weight_decays_to_near_zero() {
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 10_000)], 0).unwrap();
        let weight = vote_weight_at_epoch(&vote, 5000);
        assert!(weight < ONE_VIBE / 1_000_000);
    }

    #[test]
    fn test_vote_weight_monotonically_decreasing() {
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 10_000)], 0).unwrap();
        let mut prev = vote_weight_at_epoch(&vote, 0);
        for e in 1..20 {
            let current = vote_weight_at_epoch(&vote, e);
            assert!(current <= prev, "Weight should decrease: epoch {}", e);
            prev = current;
        }
    }

    // ============ Relative Weight ============

    #[test]
    fn test_relative_weight_single_gauge() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE * 100;
        let rw = relative_weight(&g, ONE_VIBE * 100);
        assert_eq!(rw, 10_000);
    }

    #[test]
    fn test_relative_weight_half() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE * 50;
        let rw = relative_weight(&g, ONE_VIBE * 100);
        assert_eq!(rw, 5_000);
    }

    #[test]
    fn test_relative_weight_zero_total() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE * 50;
        let rw = relative_weight(&g, 0);
        assert_eq!(rw, 0);
    }

    #[test]
    fn test_relative_weight_zero_gauge() {
        let g = create_gauge(pid(1), 0);
        let rw = relative_weight(&g, ONE_VIBE * 100);
        assert_eq!(rw, 0);
    }

    #[test]
    fn test_relative_weight_dominant() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE * 99;
        let rw = relative_weight(&g, ONE_VIBE * 100);
        assert_eq!(rw, 9_900);
    }

    #[test]
    fn test_relative_weight_tiny_share() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE;
        let rw = relative_weight(&g, ONE_VIBE * 10_000);
        assert_eq!(rw, 1); // 1 BPS = 0.01%
    }

    #[test]
    fn test_relative_weight_equal_gauges() {
        // 5 equal gauges: each should be 2000 BPS
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE * 20;
        let rw = relative_weight(&g, ONE_VIBE * 100);
        assert_eq!(rw, 2_000);
    }

    // ============ Top Gauges ============

    #[test]
    fn test_top_gauges_single() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE * 100;
        let top = top_gauges(&[g], 1);
        assert_eq!(top[0], (0, ONE_VIBE * 100));
    }

    #[test]
    fn test_top_gauges_sorted_descending() {
        let mut g1 = create_gauge(pid(1), 0);
        g1.total_weight = ONE_VIBE * 50;
        let mut g2 = create_gauge(pid(2), 0);
        g2.total_weight = ONE_VIBE * 100;
        let mut g3 = create_gauge(pid(3), 0);
        g3.total_weight = ONE_VIBE * 75;
        let top = top_gauges(&[g1, g2, g3], 3);
        assert_eq!(top[0].1, ONE_VIBE * 100); // g2
        assert_eq!(top[1].1, ONE_VIBE * 75);  // g3
        assert_eq!(top[2].1, ONE_VIBE * 50);  // g1
    }

    #[test]
    fn test_top_gauges_n_exceeds_count() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE * 100;
        let top = top_gauges(&[g], 10);
        assert_eq!(top[0].1, ONE_VIBE * 100);
        assert_eq!(top[1].1, 0); // Empty slots
    }

    #[test]
    fn test_top_gauges_excludes_killed() {
        let mut g1 = create_gauge(pid(1), 0);
        g1.total_weight = ONE_VIBE * 100;
        let mut g2 = create_gauge(pid(2), 0);
        g2.total_weight = ONE_VIBE * 200;
        g2.is_active = false;
        let top = top_gauges(&[g1, g2], 2);
        assert_eq!(top[0].1, ONE_VIBE * 100);
        assert_eq!(top[1].1, 0);
    }

    #[test]
    fn test_top_gauges_excludes_zero_weight() {
        let mut g1 = create_gauge(pid(1), 0);
        g1.total_weight = ONE_VIBE * 100;
        let g2 = create_gauge(pid(2), 0);
        let top = top_gauges(&[g1, g2], 2);
        assert_eq!(top[0].1, ONE_VIBE * 100);
        assert_eq!(top[1].1, 0);
    }

    #[test]
    fn test_top_gauges_empty() {
        let top = top_gauges(&[], 5);
        assert_eq!(top[0].1, 0);
    }

    #[test]
    fn test_top_gauges_preserves_index() {
        let g1 = create_gauge(pid(1), 0);
        let mut g2 = create_gauge(pid(2), 0);
        g2.total_weight = ONE_VIBE * 100;
        let g3 = create_gauge(pid(3), 0);
        let top = top_gauges(&[g1, g2, g3], 1);
        assert_eq!(top[0].0, 1); // Index of g2
    }

    #[test]
    fn test_top_gauges_top_1_of_many() {
        let gauges: Vec<Gauge> = (0..10).map(|i| {
            let mut g = create_gauge(pid(i as u8), 0);
            g.total_weight = ONE_VIBE * (i as u128 + 1);
            g
        }).collect();
        let top = top_gauges(&gauges, 1);
        assert_eq!(top[0].0, 9); // Last gauge has highest weight
        assert_eq!(top[0].1, ONE_VIBE * 10);
    }

    #[test]
    fn test_top_gauges_n_zero() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE * 100;
        let top = top_gauges(&[g], 0);
        assert_eq!(top[0].1, 0); // n=0 means no results
    }

    // ============ Integration: Full Epoch Lifecycle ============

    #[test]
    fn test_full_lifecycle_create_vote_finalize() {
        // Create 3 gauges
        let g1 = create_gauge(pid(1), 0);
        let g2 = create_gauge(pid(2), 0);
        let g3 = create_gauge(pid(3), 0);

        // 3 voters cast votes
        let v1 = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 5_000), (pid(2), 5_000)], 0).unwrap();
        let v2 = cast_vote(vid(2), ONE_VIBE * 200, &[(pid(2), 7_000), (pid(3), 3_000)], 0).unwrap();
        let v3 = cast_vote(vid(3), ONE_VIBE * 50, &[(pid(1), 10_000)], 0).unwrap();

        // Apply votes
        let tallied = apply_votes(&[g1, g2, g3], &[v1, v2, v3]).unwrap();

        // Expected weights:
        // Gauge 1: 100*50% + 50*100% = 50 + 50 = 100 VIBE
        assert_eq!(tallied[0].total_weight, ONE_VIBE * 100);
        // Gauge 2: 100*50% + 200*70% = 50 + 140 = 190 VIBE
        assert_eq!(tallied[1].total_weight, ONE_VIBE * 190);
        // Gauge 3: 200*30% = 60 VIBE
        assert_eq!(tallied[2].total_weight, ONE_VIBE * 60);

        // Finalize
        let total_emission = ONE_VIBE * 3500; // 3500 VIBE
        let epoch = finalize_epoch(&tallied[..3], total_emission, 0).unwrap();
        assert_eq!(epoch.gauge_count, 3);

        // Check proportional distribution
        let total_weight = ONE_VIBE * 350; // 100 + 190 + 60
        assert_eq!(epoch.total_weight, total_weight);

        // Verify emissions sum to total
        let sum: u128 = (0..epoch.gauge_count as usize)
            .map(|i| epoch.gauge_emissions[i].emission_amount)
            .sum();
        assert_eq!(sum, total_emission);
    }

    #[test]
    fn test_full_lifecycle_with_decay() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE * 100;

        // After 5 epochs of decay
        let decayed = apply_decay(&g, 5);
        // 100 * 0.99^5 ≈ 95.099
        assert!(decayed.total_weight < ONE_VIBE * 96);
        assert!(decayed.total_weight > ONE_VIBE * 95);

        // Kill it
        let killed = kill_gauge(&decayed).unwrap();
        assert!(!killed.is_active);

        // Revive it
        let revived = revive_gauge(&killed, 10).unwrap();
        assert!(revived.is_active);
        assert_eq!(revived.total_weight, 0); // Reset on revive
    }

    #[test]
    fn test_full_lifecycle_boost_after_vote() {
        // User stakes and gets voting power, then checks boost
        let user_vp = ONE_VIBE * 100;
        let total_vp = ONE_VIBE * 1000;
        let user_lp_bps = 5_000u16; // 50% of pool
        let base_reward = ONE_VIBE * 100;

        let boost = compute_boost(user_vp, total_vp, user_lp_bps, base_reward);
        // 10% VP → moderate boost
        assert!(boost.boosted_reward > base_reward);
        assert!(boost.boosted_reward < ONE_VIBE * 250); // Less than max boost
    }

    // ============ Edge Cases ============

    #[test]
    fn test_edge_max_gauges_apply_votes() {
        let gauges: Vec<Gauge> = (0..MAX_GAUGES)
            .map(|i| create_gauge(pid(i as u8), 0))
            .collect();
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(0), 10_000)], 0).unwrap();
        let result = apply_votes(&gauges, &[vote]).unwrap();
        assert_eq!(result[0].total_weight, ONE_VIBE * 100);
    }

    #[test]
    fn test_edge_exceed_max_gauges() {
        let gauges: Vec<Gauge> = (0..=MAX_GAUGES)
            .map(|i| create_gauge(pid(i as u8), 0))
            .collect();
        let err = apply_votes(&gauges, &[]).unwrap_err();
        assert_eq!(err, GaugeError::MaxGaugesReached);
    }

    #[test]
    fn test_edge_large_voting_power_overflow_protection() {
        let gauges = vec![create_gauge(pid(1), 0)];
        let v1 = cast_vote(vid(1), u128::MAX / 4, &[(pid(1), 10_000)], 0).unwrap();
        let v2 = cast_vote(vid(2), u128::MAX / 4, &[(pid(1), 10_000)], 0).unwrap();
        // Should not overflow because weights are fractional of voting power
        let result = apply_votes(&gauges, &[v1, v2]);
        assert!(result.is_ok());
    }

    #[test]
    fn test_edge_one_bps_allocation() {
        let allocs = vec![(pid(1), 1u16)]; // Minimum possible BPS
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &allocs, 0).unwrap();
        assert_eq!(vote.allocations[0].weight_bps, 1);
    }

    #[test]
    fn test_edge_9999_bps_leaves_1_unused() {
        let allocs = vec![(pid(1), 9_999)];
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &allocs, 0).unwrap();
        assert_eq!(vote.allocations[0].weight_bps, 9_999);
    }

    #[test]
    fn test_edge_multiple_voters_same_voter_id() {
        // Same voter voting twice (duplicate detection is caller's responsibility)
        let gauges = vec![create_gauge(pid(1), 0)];
        let v1 = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 10_000)], 0).unwrap();
        let v2 = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 10_000)], 0).unwrap();
        let result = apply_votes(&gauges, &[v1, v2]).unwrap();
        // Both count — dedup is caller's responsibility
        assert_eq!(result[0].total_weight, ONE_VIBE * 200);
    }

    #[test]
    fn test_edge_finalize_with_one_wei_emission() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE;
        let result = finalize_epoch(&[g], 1, 0).unwrap();
        assert_eq!(result.gauge_emissions[0].emission_amount, 1);
    }

    #[test]
    fn test_edge_vote_weight_at_epoch_zero_elapsed() {
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 10_000)], 0).unwrap();
        assert_eq!(vote_weight_at_epoch(&vote, 0), ONE_VIBE * 100);
    }

    #[test]
    fn test_edge_apr_all_zeros() {
        assert_eq!(estimate_apr(0, 0, 0, 0), 0);
    }

    #[test]
    fn test_edge_apr_zero_epochs_per_year() {
        assert_eq!(estimate_apr(ONE_VIBE * 100, ONE_VIBE * 1000, ONE_VIBE, 0), 0);
    }

    #[test]
    fn test_edge_decay_u128_max_weight() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = u128::MAX;
        let decayed = apply_decay(&g, 1);
        let expected = mul_div(u128::MAX, 9900, 10000);
        assert_eq!(decayed.total_weight, expected);
    }

    // ============ Constants Validation ============

    #[test]
    fn test_constants_bps() {
        assert_eq!(BPS, 10_000);
    }

    #[test]
    fn test_constants_epoch_duration() {
        assert_eq!(EPOCH_DURATION, 100_000);
    }

    #[test]
    fn test_constants_max_gauges() {
        assert_eq!(MAX_GAUGES, 50);
    }

    #[test]
    fn test_constants_min_vote_weight() {
        assert_eq!(MIN_VOTE_WEIGHT, PRECISION);
    }

    #[test]
    fn test_constants_max_vote_split() {
        assert_eq!(MAX_VOTE_SPLIT, 10);
    }

    #[test]
    fn test_constants_boost_base_lt_max_effective() {
        assert!(BOOST_BASE_BPS < 10_000);
    }

    #[test]
    fn test_constants_decay_rate_within_bounds() {
        assert!(DECAY_RATE_BPS > 0);
        assert!(DECAY_RATE_BPS < 10_000);
    }

    #[test]
    fn test_constants_emission_share() {
        assert_eq!(EMISSION_SHARE_BPS, 3500);
    }

    // ============ Additional Boost Tests ============

    #[test]
    fn test_boost_quarter_vp() {
        let info = compute_boost(ONE_VIBE * 250, ONE_VIBE * 1000, 5_000, ONE_VIBE * 100);
        // vp_ratio = 2500 BPS, boost_range = 6000
        // bonus = 2500 * 6000 / 10000 = 1500
        // multiplier = 4000 + 1500 = 5500
        assert_eq!(info.boost_multiplier_bps, 5_500);
        // boosted = 100 * 5500 / 4000 = 137.5
        assert_eq!(info.boosted_reward, ONE_VIBE * 137 + ONE_VIBE / 2);
    }

    #[test]
    fn test_boost_three_quarter_vp() {
        let info = compute_boost(ONE_VIBE * 750, ONE_VIBE * 1000, 5_000, ONE_VIBE * 100);
        // vp_ratio = 7500 BPS, boost_range = 6000
        // bonus = 7500 * 6000 / 10000 = 4500
        // multiplier = 4000 + 4500 = 8500
        assert_eq!(info.boost_multiplier_bps, 8_500);
        // boosted = 100 * 8500 / 4000 = 212.5
        assert_eq!(info.boosted_reward, ONE_VIBE * 212 + ONE_VIBE / 2);
    }

    // ============ Additional Vote Application Tests ============

    #[test]
    fn test_apply_votes_voter_splits_across_all_gauges() {
        let gauges: Vec<Gauge> = (0..5).map(|i| create_gauge(pid(i as u8), 0)).collect();
        let allocs: Vec<([u8; 32], u16)> = (0..5).map(|i| (pid(i as u8), 2_000)).collect();
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &allocs, 0).unwrap();
        let result = apply_votes(&gauges, &[vote]).unwrap();
        for i in 0..5 {
            assert_eq!(result[i].total_weight, ONE_VIBE * 20);
        }
    }

    #[test]
    fn test_apply_votes_multiple_voters_complex_splits() {
        let gauges = vec![
            create_gauge(pid(1), 0),
            create_gauge(pid(2), 0),
            create_gauge(pid(3), 0),
        ];
        // Voter 1: 40% pool1, 60% pool2
        let v1 = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 4_000), (pid(2), 6_000)], 0).unwrap();
        // Voter 2: 100% pool3
        let v2 = cast_vote(vid(2), ONE_VIBE * 300, &[(pid(3), 10_000)], 0).unwrap();
        // Voter 3: 33%/33%/34% split
        let v3 = cast_vote(vid(3), ONE_VIBE * 150, &[(pid(1), 3_300), (pid(2), 3_300), (pid(3), 3_400)], 0).unwrap();

        let result = apply_votes(&gauges, &[v1, v2, v3]).unwrap();
        // Pool 1: 100*40% + 150*33% = 40 + 49.5 = 89.5
        let expected_p1 = mul_div(ONE_VIBE * 100, 4_000, 10_000) + mul_div(ONE_VIBE * 150, 3_300, 10_000);
        assert_eq!(result[0].total_weight, expected_p1);
        // Pool 2: 100*60% + 150*33% = 60 + 49.5 = 109.5
        let expected_p2 = mul_div(ONE_VIBE * 100, 6_000, 10_000) + mul_div(ONE_VIBE * 150, 3_300, 10_000);
        assert_eq!(result[1].total_weight, expected_p2);
        // Pool 3: 300 + 150*34% = 300 + 51 = 351
        let expected_p3 = ONE_VIBE * 300 + mul_div(ONE_VIBE * 150, 3_400, 10_000);
        assert_eq!(result[2].total_weight, expected_p3);
    }

    // ============ Additional Finalize Tests ============

    #[test]
    fn test_finalize_five_gauges_various_weights() {
        let mut gauges = Vec::new();
        for i in 1..=5 {
            let mut g = create_gauge(pid(i), 0);
            g.total_weight = ONE_VIBE * (i as u128 * 10);
            gauges.push(g);
        }
        let total = ONE_VIBE * 10_000;
        let result = finalize_epoch(&gauges, total, 1).unwrap();
        assert_eq!(result.gauge_count, 5);

        // Verify proportionality
        let sum: u128 = (0..5).map(|i| result.gauge_emissions[i].emission_amount).sum();
        assert_eq!(sum, total);
    }

    #[test]
    fn test_finalize_mixed_active_and_killed() {
        let mut g1 = create_gauge(pid(1), 0);
        g1.total_weight = ONE_VIBE * 100;
        let mut g2 = create_gauge(pid(2), 0);
        g2.total_weight = ONE_VIBE * 100;
        g2.is_active = false;
        let mut g3 = create_gauge(pid(3), 0);
        g3.total_weight = ONE_VIBE * 100;

        let result = finalize_epoch(&[g1, g2, g3], ONE_VIBE * 1000, 1).unwrap();
        assert_eq!(result.gauge_count, 2);
        // Each active gauge gets 500
        assert_eq!(result.gauge_emissions[0].emission_amount, ONE_VIBE * 500);
        assert_eq!(result.gauge_emissions[1].emission_amount, ONE_VIBE * 500);
    }

    // ============ Stress / Boundary Tests ============

    #[test]
    fn test_stress_many_voters() {
        let gauges = vec![create_gauge(pid(1), 0), create_gauge(pid(2), 0)];
        let votes: Vec<VoteAllocation> = (0..100)
            .map(|i| {
                if i % 2 == 0 {
                    cast_vote(vid(i as u8), ONE_VIBE * 10, &[(pid(1), 10_000)], 0).unwrap()
                } else {
                    cast_vote(vid(i as u8), ONE_VIBE * 10, &[(pid(2), 10_000)], 0).unwrap()
                }
            })
            .collect();
        let result = apply_votes(&gauges, &votes).unwrap();
        assert_eq!(result[0].total_weight, ONE_VIBE * 500);
        assert_eq!(result[1].total_weight, ONE_VIBE * 500);
        assert_eq!(result[0].voter_count, 50);
        assert_eq!(result[1].voter_count, 50);
    }

    #[test]
    fn test_decay_exact_100_epochs() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE * 1000;
        let decayed = apply_decay(&g, 100);
        // 0.99^100 ≈ 0.366
        assert!(decayed.total_weight > ONE_VIBE * 365);
        assert!(decayed.total_weight < ONE_VIBE * 367);
    }

    #[test]
    fn test_relative_weight_very_small_gauge() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = 1; // 1 wei
        let rw = relative_weight(&g, ONE_VIBE * 1_000_000);
        assert_eq!(rw, 0); // Too small to register 1 BPS
    }

    #[test]
    fn test_boost_exactly_base_reward() {
        // No VP should give exactly base reward
        let info = compute_boost(0, ONE_VIBE * 1000, 5_000, ONE_VIBE * 77);
        assert_eq!(info.boosted_reward, ONE_VIBE * 77);
    }

    #[test]
    fn test_vote_cast_exactly_10000_bps_multi_split() {
        let allocs = vec![
            (pid(1), 2_500),
            (pid(2), 2_500),
            (pid(3), 2_500),
            (pid(4), 2_500),
        ];
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &allocs, 0).unwrap();
        assert_eq!(vote.allocation_count, 4);
        let total: u32 = (0..4).map(|i| vote.allocations[i].weight_bps as u32).sum();
        assert_eq!(total, 10_000);
    }

    #[test]
    fn test_finalize_epoch_single_gauge_gets_all() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE;
        let result = finalize_epoch(&[g], ONE_VIBE * 7777, 5).unwrap();
        assert_eq!(result.gauge_emissions[0].emission_amount, ONE_VIBE * 7777);
        assert_eq!(result.gauge_emissions[0].weight_bps, 10_000);
    }

    #[test]
    fn test_top_gauges_returns_correct_indices() {
        let mut gauges = Vec::new();
        for i in 0..5 {
            let mut g = create_gauge(pid(i as u8), 0);
            // Weights: 10, 50, 30, 40, 20
            g.total_weight = match i {
                0 => ONE_VIBE * 10,
                1 => ONE_VIBE * 50,
                2 => ONE_VIBE * 30,
                3 => ONE_VIBE * 40,
                4 => ONE_VIBE * 20,
                _ => 0,
            };
            gauges.push(g);
        }
        let top = top_gauges(&gauges, 3);
        assert_eq!(top[0], (1, ONE_VIBE * 50));
        assert_eq!(top[1], (3, ONE_VIBE * 40));
        assert_eq!(top[2], (2, ONE_VIBE * 30));
    }

    #[test]
    fn test_apply_votes_mixed_active_killed_gauges() {
        let g1 = create_gauge(pid(1), 0);
        let mut g2 = create_gauge(pid(2), 0);
        g2.is_active = false;
        let g3 = create_gauge(pid(3), 0);

        let vote = cast_vote(
            vid(1),
            ONE_VIBE * 90,
            &[(pid(1), 3_000), (pid(2), 3_000), (pid(3), 4_000)],
            0,
        ).unwrap();
        let result = apply_votes(&[g1, g2, g3], &[vote]).unwrap();
        assert_eq!(result[0].total_weight, mul_div(ONE_VIBE * 90, 3_000, 10_000));
        assert_eq!(result[1].total_weight, 0); // Killed — skipped
        assert_eq!(result[2].total_weight, mul_div(ONE_VIBE * 90, 4_000, 10_000));
    }

    #[test]
    fn test_full_lifecycle_vote_decay_revote() {
        // Epoch 0: vote
        let g = create_gauge(pid(1), 0);
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 10_000)], 0).unwrap();
        let tallied = apply_votes(&[g], &[vote]).unwrap();
        assert_eq!(tallied[0].total_weight, ONE_VIBE * 100);

        // Epoch 3: decay (no revote)
        let decayed = apply_decay(&tallied[0], 3);
        // 100 * 0.99^3 ≈ 97.0299
        let expected = mul_div(mul_div(mul_div(ONE_VIBE * 100, 9900, 10000), 9900, 10000), 9900, 10000);
        assert_eq!(decayed.total_weight, expected);

        // Epoch 3: revote with fresh power
        let fresh_vote = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 10_000)], 3).unwrap();
        let re_tallied = apply_votes(&[decayed], &[fresh_vote]).unwrap();
        // After apply_votes, weights are reset and re-tallied
        assert_eq!(re_tallied[0].total_weight, ONE_VIBE * 100);
    }

    #[test]
    fn test_vote_weight_at_epoch_consistent_with_gauge_decay() {
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 10_000)], 0).unwrap();
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = ONE_VIBE * 100;

        // Vote weight decay and gauge decay use same formula
        for e in 0..10 {
            let vw = vote_weight_at_epoch(&vote, e);
            let gd = apply_decay(&g, e);
            // Since the gauge starts at the same weight as the vote's power,
            // they should track identically
            assert_eq!(vw, gd.total_weight, "Mismatch at epoch {}", e);
        }
    }

    // ============ Hardening Round 5 ============

    #[test]
    fn test_create_gauge_all_ff_pool_id_v5() {
        let g = create_gauge([0xFF; 32], 999);
        assert_eq!(g.pool_id, [0xFF; 32]);
        assert_eq!(g.created_epoch, 999);
        assert!(g.is_active);
        assert_eq!(g.cumulative_emissions, 0);
    }

    #[test]
    fn test_cast_vote_exactly_10000_bps_single_v5() {
        let result = cast_vote(vid(1), ONE_VIBE * 50, &[(pid(1), 10_000)], 0);
        assert!(result.is_ok());
        let v = result.unwrap();
        assert_eq!(v.allocation_count, 1);
        assert_eq!(v.allocations[0].weight_bps, 10_000);
    }

    #[test]
    fn test_cast_vote_exactly_10001_bps_rejected_v5() {
        let result = cast_vote(vid(1), ONE_VIBE * 50, &[(pid(1), 10_001)], 0);
        assert_eq!(result, Err(GaugeError::SplitBpsExceed10000));
    }

    #[test]
    fn test_apply_votes_empty_gauges_v5() {
        let vote = cast_vote(vid(1), ONE_VIBE * 10, &[(pid(99), 10_000)], 0).unwrap();
        let result = apply_votes(&[], &[vote]).unwrap();
        // No gauges, so all zero
        assert_eq!(result[0].total_weight, 0);
    }

    #[test]
    fn test_finalize_epoch_three_equal_remainder_v5() {
        // 3 gauges, 100 emission, each gets 33, remainder 1 to largest
        let mut g1 = create_gauge(pid(1), 0);
        let mut g2 = create_gauge(pid(2), 0);
        let mut g3 = create_gauge(pid(3), 0);
        g1.total_weight = 1000;
        g2.total_weight = 1000;
        g3.total_weight = 1000;

        let result = finalize_epoch(&[g1, g2, g3], 100, 0).unwrap();
        let mut total = 0u128;
        for i in 0..result.gauge_count as usize {
            total += result.gauge_emissions[i].emission_amount;
        }
        assert_eq!(total, 100); // Sum exactly matches total emission
    }

    #[test]
    fn test_boost_one_percent_vp_v5() {
        // 1% of total voting power
        let info = compute_boost(ONE_VIBE, ONE_VIBE * 100, 5000, 1_000_000);
        assert!(info.boosted_reward >= info.base_reward);
        // 1% VP → small bonus above base
        assert!(info.boost_multiplier_bps > BOOST_BASE_BPS);
        assert!(info.boost_multiplier_bps < 5000);
    }

    #[test]
    fn test_boost_large_base_reward_v5() {
        let large_reward = u128::MAX / 2;
        let info = compute_boost(ONE_VIBE * 50, ONE_VIBE * 100, 5000, large_reward);
        assert!(info.boosted_reward >= info.base_reward);
    }

    #[test]
    fn test_decay_single_epoch_exact_99_percent_v5() {
        let mut g = create_gauge(pid(1), 0);
        g.total_weight = 10_000;
        let decayed = apply_decay(&g, 1);
        // 10000 * 9900 / 10000 = 9900
        assert_eq!(decayed.total_weight, 9900);
    }

    #[test]
    fn test_decay_preserves_pool_id_v5() {
        let mut g = create_gauge(pid(42), 5);
        g.total_weight = 100_000;
        g.cumulative_emissions = 999;
        let decayed = apply_decay(&g, 10);
        assert_eq!(decayed.pool_id, pid(42));
        assert_eq!(decayed.cumulative_emissions, 999);
        assert_eq!(decayed.created_epoch, 5);
    }

    #[test]
    fn test_estimate_apr_large_tvl_small_emission_v5() {
        let apr = estimate_apr(1, PRECISION * 1_000_000_000, PRECISION, 100);
        assert_eq!(apr, 0); // Negligible emission relative to huge TVL
    }

    #[test]
    fn test_vote_weight_at_epoch_max_u64_epoch_v5() {
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 10_000)], 0).unwrap();
        // After many epochs of 1% decay, weight should be very small
        let w = vote_weight_at_epoch(&vote, 1000);
        // 100 * 0.99^1000 is extremely small but with fixed-point it may not be exactly 0
        assert!(w < ONE_VIBE, "Weight should be nearly zero after 1000 epochs: {}", w);
    }

    #[test]
    fn test_relative_weight_all_equal_three_gauges_v5() {
        let mut g1 = create_gauge(pid(1), 0);
        let mut g2 = create_gauge(pid(2), 0);
        let mut g3 = create_gauge(pid(3), 0);
        g1.total_weight = 1000;
        g2.total_weight = 1000;
        g3.total_weight = 1000;
        let rw = relative_weight(&g1, 3000);
        assert_eq!(rw, 3333); // 1000/3000 * 10000 = 3333
    }

    #[test]
    fn test_top_gauges_preserves_weight_values_v5() {
        let mut g1 = create_gauge(pid(1), 0);
        let mut g2 = create_gauge(pid(2), 0);
        g1.total_weight = 999;
        g2.total_weight = 1001;
        let top = top_gauges(&[g1, g2], 2);
        assert_eq!(top[0].1, 1001);
        assert_eq!(top[1].1, 999);
    }

    #[test]
    fn test_kill_gauge_then_revive_at_later_epoch_v5() {
        let g = create_gauge(pid(1), 0);
        let killed = kill_gauge(&g).unwrap();
        assert!(!killed.is_active);
        let revived = revive_gauge(&killed, 50).unwrap();
        assert!(revived.is_active);
        assert_eq!(revived.last_emission_epoch, 50);
    }

    #[test]
    fn test_apply_votes_large_power_split_ten_ways_v5() {
        let mut allocs = Vec::new();
        for i in 1..=10u8 {
            allocs.push((pid(i), 1_000u16)); // 10 x 10% = 100%
        }
        let vote = cast_vote(vid(1), ONE_VIBE * 1000, &allocs, 0).unwrap();
        assert_eq!(vote.allocation_count, 10);

        // Create 10 gauges
        let gauges: Vec<Gauge> = (1..=10u8).map(|i| create_gauge(pid(i), 0)).collect();
        let result = apply_votes(&gauges, &[vote]).unwrap();

        for i in 0..10 {
            // Each gauge should get 10% of 1000 VIBE
            assert_eq!(result[i].total_weight, mul_div(ONE_VIBE * 1000, 1_000, 10_000));
        }
    }

    #[test]
    fn test_finalize_epoch_single_active_among_killed_v5() {
        let mut g1 = create_gauge(pid(1), 0);
        let mut g2 = create_gauge(pid(2), 0);
        let mut g3 = create_gauge(pid(3), 0);
        g1.is_active = false;
        g2.total_weight = 500;
        g3.is_active = false;

        let result = finalize_epoch(&[g1, g2, g3], 1000, 0).unwrap();
        assert_eq!(result.gauge_count, 1);
        assert_eq!(result.gauge_emissions[0].emission_amount, 1000);
    }

    #[test]
    fn test_cast_vote_preserves_allocation_order_v5() {
        let allocs = vec![(pid(3), 3000), (pid(1), 2000), (pid(7), 5000)];
        let vote = cast_vote(vid(1), ONE_VIBE * 10, &allocs, 0).unwrap();
        assert_eq!(vote.allocations[0].pool_id, pid(3));
        assert_eq!(vote.allocations[1].pool_id, pid(1));
        assert_eq!(vote.allocations[2].pool_id, pid(7));
    }

    #[test]
    fn test_estimate_apr_overflow_safe_v5() {
        // Very large values should not panic
        let apr = estimate_apr(u128::MAX / 2, PRECISION, PRECISION, 1);
        assert!(apr > 0);
    }

    #[test]
    fn test_apply_votes_voter_count_increments_per_allocation_v5() {
        let g = create_gauge(pid(1), 0);
        let v1 = cast_vote(vid(1), ONE_VIBE * 10, &[(pid(1), 5000)], 0).unwrap();
        let v2 = cast_vote(vid(2), ONE_VIBE * 10, &[(pid(1), 5000)], 0).unwrap();
        let result = apply_votes(&[g], &[v1, v2]).unwrap();
        assert_eq!(result[0].voter_count, 2);
    }

    #[test]
    fn test_finalize_epoch_weight_bps_sum_near_10000_v5() {
        let mut g1 = create_gauge(pid(1), 0);
        let mut g2 = create_gauge(pid(2), 0);
        g1.total_weight = 7000;
        g2.total_weight = 3000;

        let result = finalize_epoch(&[g1, g2], 10_000, 0).unwrap();
        let bps_sum: u16 = (0..result.gauge_count as usize)
            .map(|i| result.gauge_emissions[i].weight_bps)
            .sum();
        // BPS sum should be 10000 (or close due to rounding)
        assert!(bps_sum >= 9999 && bps_sum <= 10000);
    }

    #[test]
    fn test_boost_zero_user_nonzero_total_v5() {
        let info = compute_boost(0, ONE_VIBE * 100, 5000, 1_000_000);
        assert_eq!(info.boosted_reward, info.base_reward);
        assert_eq!(info.boost_multiplier_bps, BOOST_BASE_BPS);
    }

    #[test]
    fn test_decay_500_epochs_significantly_reduced_v5() {
        let mut g = create_gauge(pid(1), 0);
        let original = ONE_VIBE * 1_000_000;
        g.total_weight = original;
        let decayed = apply_decay(&g, 500);
        // 500 epochs of 1% decay should reduce by >99%
        assert!(decayed.total_weight < original / 100,
            "Should be <1% of original: {} vs {}", decayed.total_weight, original);
    }

    #[test]
    fn test_relative_weight_99_vs_1_v5() {
        let mut big = create_gauge(pid(1), 0);
        let mut small = create_gauge(pid(2), 0);
        big.total_weight = 99_000;
        small.total_weight = 1_000;

        let rw_big = relative_weight(&big, 100_000);
        let rw_small = relative_weight(&small, 100_000);
        assert_eq!(rw_big, 9900);
        assert_eq!(rw_small, 100);
    }

    #[test]
    fn test_gauge_error_variants_distinct_v5() {
        let variants: Vec<GaugeError> = vec![
            GaugeError::GaugeNotFound,
            GaugeError::GaugeAlreadyExists,
            GaugeError::MaxGaugesReached,
            GaugeError::InsufficientVotingPower,
            GaugeError::TooManySplits,
            GaugeError::SplitBpsExceed10000,
            GaugeError::ZeroWeight,
            GaugeError::InvalidEpoch,
            GaugeError::EpochNotFinalized,
            GaugeError::AlreadyVoted,
            GaugeError::GaugeKilled,
            GaugeError::ZeroEmission,
            GaugeError::Overflow,
        ];
        for i in 0..variants.len() {
            for j in (i + 1)..variants.len() {
                assert_ne!(variants[i], variants[j]);
            }
        }
    }

    // ============ Hardening Round 6 ============

    #[test]
    fn test_create_gauge_preserves_all_defaults_h6() {
        let g = create_gauge(pid(99), 500);
        assert_eq!(g.total_weight, 0);
        assert_eq!(g.voter_count, 0);
        assert_eq!(g.cumulative_emissions, 0);
        assert_eq!(g.last_emission_epoch, 0);
        assert!(g.is_active);
    }

    #[test]
    fn test_cast_vote_five_pool_split_h6() {
        let allocs: Vec<([u8; 32], u16)> = (1..=5).map(|i| (pid(i), 2000)).collect();
        let vote = cast_vote(vid(1), ONE_VIBE * 10, &allocs, 1).unwrap();
        assert_eq!(vote.allocation_count, 5);
    }

    #[test]
    fn test_cast_vote_9999_bps_total_h6() {
        let allocs = vec![(pid(1), 5000), (pid(2), 4999)];
        let vote = cast_vote(vid(1), ONE_VIBE, &allocs, 0).unwrap();
        assert_eq!(vote.allocation_count, 2);
    }

    #[test]
    fn test_cast_vote_exact_min_power_boundary_h6() {
        let result = cast_vote(vid(1), MIN_VOTE_WEIGHT - 1, &[(pid(1), 10000)], 0);
        assert_eq!(result, Err(GaugeError::InsufficientVotingPower));
        let result = cast_vote(vid(1), MIN_VOTE_WEIGHT, &[(pid(1), 10000)], 0);
        assert!(result.is_ok());
    }

    #[test]
    fn test_apply_votes_five_voters_accumulates_h6() {
        let g = create_gauge(pid(1), 0);
        let votes: Vec<VoteAllocation> = (1..=5)
            .map(|i| cast_vote(vid(i), ONE_VIBE * 100, &[(pid(1), 10000)], 0).unwrap())
            .collect();
        let result = apply_votes(&[g], &votes).unwrap();
        assert_eq!(result[0].voter_count, 5);
        assert!(result[0].total_weight > 0);
    }

    #[test]
    fn test_apply_votes_ignores_nonexistent_pool_h6() {
        let g = create_gauge(pid(1), 0);
        // Vote for pool 99 which has no gauge
        let vote = cast_vote(vid(1), ONE_VIBE * 10, &[(pid(99), 10000)], 0).unwrap();
        let result = apply_votes(&[g], &[vote]).unwrap();
        assert_eq!(result[0].total_weight, 0);
        assert_eq!(result[0].voter_count, 0);
    }

    #[test]
    fn test_finalize_epoch_three_gauges_proportional_h6() {
        let g1 = Gauge { pool_id: pid(1), total_weight: 500, voter_count: 1, created_epoch: 0, is_active: true, cumulative_emissions: 0, last_emission_epoch: 0 };
        let g2 = Gauge { pool_id: pid(2), total_weight: 300, voter_count: 1, created_epoch: 0, is_active: true, cumulative_emissions: 0, last_emission_epoch: 0 };
        let g3 = Gauge { pool_id: pid(3), total_weight: 200, voter_count: 1, created_epoch: 0, is_active: true, cumulative_emissions: 0, last_emission_epoch: 0 };
        let result = finalize_epoch(&[g1, g2, g3], 10000, 1).unwrap();
        assert_eq!(result.gauge_count, 3);
        let total_emitted: u128 = (0..3).map(|i| result.gauge_emissions[i].emission_amount).sum();
        assert_eq!(total_emitted, 10000);
    }

    #[test]
    fn test_finalize_epoch_single_gauge_gets_everything_h6() {
        let g = Gauge { pool_id: pid(1), total_weight: 1000, voter_count: 5, created_epoch: 0, is_active: true, cumulative_emissions: 0, last_emission_epoch: 0 };
        let result = finalize_epoch(&[g], 50000, 10).unwrap();
        assert_eq!(result.gauge_emissions[0].emission_amount, 50000);
    }

    #[test]
    fn test_boost_10_percent_vp_h6() {
        let info = compute_boost(ONE_VIBE * 10, ONE_VIBE * 100, 5000, 1000);
        assert!(info.boosted_reward >= info.base_reward);
        assert!(info.boost_multiplier_bps >= BOOST_BASE_BPS);
    }

    #[test]
    fn test_boost_99_percent_vp_h6() {
        let info = compute_boost(ONE_VIBE * 99, ONE_VIBE * 100, 9900, 10000);
        // Nearly full voting power, boost should be near max
        assert!(info.boost_multiplier_bps > 9000);
    }

    #[test]
    fn test_boost_base_reward_zero_returns_zero_h6() {
        let info = compute_boost(ONE_VIBE * 50, ONE_VIBE * 100, 5000, 0);
        assert_eq!(info.boosted_reward, 0);
        assert_eq!(info.base_reward, 0);
    }

    #[test]
    fn test_decay_five_epochs_monotonic_h6() {
        let g = Gauge { pool_id: pid(1), total_weight: 1_000_000, voter_count: 1, created_epoch: 0, is_active: true, cumulative_emissions: 0, last_emission_epoch: 0 };
        let d1 = apply_decay(&g, 1);
        let d3 = apply_decay(&g, 3);
        let d5 = apply_decay(&g, 5);
        assert!(d1.total_weight > d3.total_weight);
        assert!(d3.total_weight > d5.total_weight);
    }

    #[test]
    fn test_decay_preserves_is_active_h6() {
        let g = Gauge { pool_id: pid(1), total_weight: 1000, voter_count: 3, created_epoch: 5, is_active: true, cumulative_emissions: 100, last_emission_epoch: 4 };
        let decayed = apply_decay(&g, 10);
        assert!(decayed.is_active);
        assert_eq!(decayed.created_epoch, 5);
        assert_eq!(decayed.cumulative_emissions, 100);
    }

    #[test]
    fn test_kill_gauge_resets_voter_count_h6() {
        let g = Gauge { pool_id: pid(1), total_weight: 5000, voter_count: 10, created_epoch: 0, is_active: true, cumulative_emissions: 0, last_emission_epoch: 0 };
        let killed = kill_gauge(&g).unwrap();
        assert_eq!(killed.voter_count, 0);
        assert_eq!(killed.total_weight, 0);
        assert!(!killed.is_active);
    }

    #[test]
    fn test_revive_gauge_sets_last_emission_epoch_h6() {
        let g = Gauge { pool_id: pid(1), total_weight: 0, voter_count: 0, created_epoch: 0, is_active: false, cumulative_emissions: 500, last_emission_epoch: 0 };
        let revived = revive_gauge(&g, 42).unwrap();
        assert_eq!(revived.last_emission_epoch, 42);
        assert!(revived.is_active);
    }

    #[test]
    fn test_estimate_apr_realistic_values_h6() {
        // 100 tokens per epoch, 365 epochs/year, price = 2 PRECISION, TVL = 1M PRECISION
        let apr = estimate_apr(100 * PRECISION, 1_000_000 * PRECISION, 2 * PRECISION, 365);
        assert!(apr > 0);
    }

    #[test]
    fn test_estimate_apr_very_high_emission_h6() {
        let apr = estimate_apr(u128::MAX / 10000, PRECISION, PRECISION, 1);
        // Should not panic, may saturate
        assert!(apr > 0 || apr == 0); // Just ensure no panic
    }

    #[test]
    fn test_vote_weight_decays_over_100_epochs_h6() {
        let vote = cast_vote(vid(1), ONE_VIBE * 1000, &[(pid(1), 10000)], 0).unwrap();
        let w0 = vote_weight_at_epoch(&vote, 0);
        let w100 = vote_weight_at_epoch(&vote, 100);
        assert_eq!(w0, ONE_VIBE * 1000);
        assert!(w100 < w0);
        assert!(w100 > 0); // 1% decay per epoch, 100 epochs -> ~36% remaining
    }

    #[test]
    fn test_vote_weight_before_vote_returns_zero_h6() {
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 10000)], 50).unwrap();
        assert_eq!(vote_weight_at_epoch(&vote, 49), 0);
    }

    #[test]
    fn test_relative_weight_two_equal_gauges_h6() {
        let g = Gauge { pool_id: pid(1), total_weight: 500, voter_count: 1, created_epoch: 0, is_active: true, cumulative_emissions: 0, last_emission_epoch: 0 };
        let rw = relative_weight(&g, 1000);
        assert_eq!(rw, 5000); // 50%
    }

    #[test]
    fn test_relative_weight_tiny_gauge_large_total_h6() {
        let g = Gauge { pool_id: pid(1), total_weight: 1, voter_count: 1, created_epoch: 0, is_active: true, cumulative_emissions: 0, last_emission_epoch: 0 };
        let rw = relative_weight(&g, 1_000_000);
        assert_eq!(rw, 0); // rounds to 0 bps
    }

    #[test]
    fn test_top_gauges_three_returns_sorted_h6() {
        let g1 = Gauge { pool_id: pid(1), total_weight: 100, voter_count: 1, created_epoch: 0, is_active: true, cumulative_emissions: 0, last_emission_epoch: 0 };
        let g2 = Gauge { pool_id: pid(2), total_weight: 300, voter_count: 1, created_epoch: 0, is_active: true, cumulative_emissions: 0, last_emission_epoch: 0 };
        let g3 = Gauge { pool_id: pid(3), total_weight: 200, voter_count: 1, created_epoch: 0, is_active: true, cumulative_emissions: 0, last_emission_epoch: 0 };
        let top = top_gauges(&[g1, g2, g3], 3);
        assert_eq!(top[0].1, 300);
        assert_eq!(top[1].1, 200);
        assert_eq!(top[2].1, 100);
    }

    #[test]
    fn test_top_gauges_request_more_than_available_h6() {
        let g1 = Gauge { pool_id: pid(1), total_weight: 100, voter_count: 1, created_epoch: 0, is_active: true, cumulative_emissions: 0, last_emission_epoch: 0 };
        let top = top_gauges(&[g1], 10);
        assert_eq!(top[0].1, 100);
        assert_eq!(top[1].1, 0); // rest empty
    }

    #[test]
    fn test_finalize_epoch_with_max_gauges_h6() {
        // Create MAX_GAUGES gauges with different weights
        let gauges: Vec<Gauge> = (0..MAX_GAUGES).map(|i| {
            Gauge { pool_id: pid((i + 1) as u8), total_weight: (i as u128 + 1) * 100, voter_count: 1, created_epoch: 0, is_active: true, cumulative_emissions: 0, last_emission_epoch: 0 }
        }).collect();
        let result = finalize_epoch(&gauges, 1_000_000, 1).unwrap();
        assert_eq!(result.gauge_count as usize, MAX_GAUGES);
    }

    #[test]
    fn test_apply_votes_killed_gauge_gets_zero_h6() {
        let g = Gauge { pool_id: pid(1), total_weight: 0, voter_count: 0, created_epoch: 0, is_active: false, cumulative_emissions: 0, last_emission_epoch: 0 };
        let vote = cast_vote(vid(1), ONE_VIBE * 100, &[(pid(1), 10000)], 0).unwrap();
        let result = apply_votes(&[g], &[vote]).unwrap();
        assert_eq!(result[0].total_weight, 0);
    }

    #[test]
    fn test_boost_multiplier_never_exceeds_10000_h6() {
        // Even with massive voting power
        let info = compute_boost(ONE_VIBE * 1_000_000, ONE_VIBE * 1, 10000, 10000);
        assert!(info.boost_multiplier_bps <= 10_000);
    }

    #[test]
    fn test_decay_one_epoch_exact_99_percent_h6() {
        let g = Gauge { pool_id: pid(1), total_weight: 10_000, voter_count: 1, created_epoch: 0, is_active: true, cumulative_emissions: 0, last_emission_epoch: 0 };
        let decayed = apply_decay(&g, 1);
        assert_eq!(decayed.total_weight, 9900); // 10000 * 9900 / 10000
    }

    #[test]
    fn test_cast_vote_eleven_splits_rejected_h6() {
        let allocs: Vec<([u8; 32], u16)> = (1..=11).map(|i| (pid(i), 909)).collect();
        let result = cast_vote(vid(1), ONE_VIBE * 10, &allocs, 0);
        assert_eq!(result, Err(GaugeError::TooManySplits));
    }
}
