// ============ Analytics — Protocol-Wide Metrics & Reporting ============
// Aggregates data across all VibeSwap subsystems to provide TVL, volume,
// APY, user metrics, and protocol health dashboards.
//
// Key capabilities:
// - Protocol metrics: aggregate TVL, volume, user count, revenue
// - Pool ranking: sort pools by TVL, volume, fee APR, trade count
// - Volume analysis: moving averages, trend detection over block windows
// - TVL composition: per-pool share of total TVL in basis points
// - Fee APR: annualized fee yield from pool earnings
// - User metrics: retention, leaderboards, loyalty scoring
// - Protocol health: composite score from TVL/volume trends and utilization
// - Concentration index: Herfindahl-like measure of pool distribution
//
// All percentages are expressed in basis points (bps, 10000 = 100%).
// All ratios use PRECISION (1e18) scaling for safe fixed-point arithmetic.

use vibeswap_math::PRECISION;
use vibeswap_math::mul_div;

// ============ Constants ============

/// CKB produces a block roughly every 4 seconds
pub const BLOCKS_PER_DAY: u64 = 21_600;

/// ~365.25 days worth of blocks
pub const BLOCKS_PER_YEAR: u64 = 7_884_000;

/// Minimum data points required for trend analysis
pub const MIN_DATA_POINTS: usize = 3;

/// Change within +/- 1% is considered flat
pub const TREND_FLAT_THRESHOLD_BPS: u16 = 100;

/// Pool utilization above 80% is considered high
pub const HIGH_UTILIZATION_BPS: u16 = 8_000;

/// Insurance coverage above 50% is considered healthy
pub const HEALTHY_COVERAGE_BPS: u16 = 5_000;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AnalyticsError {
    /// Not enough data points to perform the requested analysis
    InsufficientData,
    /// Time range is invalid (zero window, end before start, etc.)
    InvalidTimeRange,
    /// Attempted division by zero in a metric calculation
    DivisionByZero,
    /// No pools provided for an operation that requires at least one
    NoPoolsFound,
}

// ============ Data Types ============

/// Protocol-wide aggregate metrics.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProtocolMetrics {
    /// Total value locked across all pools (PRECISION-scaled)
    pub total_tvl: u128,
    /// Total trading volume in the last 24h window (PRECISION-scaled)
    pub total_volume_24h: u128,
    /// Total unique users who have ever interacted
    pub total_users: u32,
    /// Number of active liquidity pools
    pub total_pools: u32,
    /// Total transactions processed
    pub total_txs: u64,
    /// Average number of orders per batch
    pub avg_batch_size: u32,
    /// Cumulative protocol revenue (fees collected)
    pub protocol_revenue: u128,
}

/// Per-pool performance metrics.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolMetrics {
    /// Unique pair identifier
    pub pair_id: [u8; 32],
    /// Total value locked in this pool
    pub tvl: u128,
    /// 24h trading volume
    pub volume_24h: u128,
    /// Annualized fee APR in basis points
    pub fee_apr_bps: u16,
    /// Current utilization in basis points
    pub utilization_bps: u16,
    /// Total number of trades executed
    pub trade_count: u64,
    /// Number of unique traders
    pub unique_traders: u32,
}

/// A single volume observation at a given block height.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VolumeSnapshot {
    /// Block height at which the snapshot was taken
    pub block: u64,
    /// Volume observed at this block
    pub volume: u128,
}

/// A generic time-series data point.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TimeSeriesPoint {
    /// Block height
    pub block: u64,
    /// Value at this block
    pub value: u128,
}

/// Direction of a measured trend.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TrendDirection {
    Up,
    Down,
    Flat,
}

/// Result of trend analysis over a time series.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrendAnalysis {
    /// Overall trend direction
    pub direction: TrendDirection,
    /// Magnitude of change in basis points (absolute value)
    pub change_bps: u16,
    /// Number of data points analyzed
    pub data_points: u32,
    /// Confidence in the trend (higher = more consistent, bps)
    pub confidence_bps: u16,
}

/// Per-user activity metrics.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UserMetrics {
    /// User's identity (pubkey hash or lock hash)
    pub address: [u8; 32],
    /// Lifetime trading volume
    pub total_volume: u128,
    /// Lifetime fees paid
    pub total_fees_paid: u128,
    /// Number of pools the user has traded in
    pub pool_count: u32,
    /// Block of first interaction
    pub first_active_block: u64,
    /// Block of most recent interaction
    pub last_active_block: u64,
    /// Loyalty score (computed from tenure + activity)
    pub loyalty_score: u64,
}

/// A single entry in a leaderboard ranking.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LeaderboardEntry {
    /// User's identity
    pub address: [u8; 32],
    /// Score used for ranking
    pub score: u128,
    /// 1-based rank position
    pub rank: u32,
}

/// Composite protocol health assessment.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProtocolHealth {
    /// TVL trend direction
    pub tvl_trend: TrendDirection,
    /// Volume trend direction
    pub volume_trend: TrendDirection,
    /// User growth rate in bps (current vs previous period)
    pub user_growth_bps: u16,
    /// Average pool utilization in bps
    pub pool_utilization_bps: u16,
    /// Insurance coverage ratio in bps
    pub insurance_coverage_bps: u16,
    /// Composite risk score (0 = safe, higher = riskier)
    pub risk_score: u16,
}

/// Sort criteria for pool ranking.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SortBy {
    Tvl,
    Volume,
    FeeApr,
    TradeCount,
}

// ============ Core Functions ============

/// Aggregate protocol-wide metrics from individual pool data.
///
/// Sums TVL and volume across all pools, computes average batch size
/// from total transactions and pool count.
pub fn protocol_metrics(
    pools: &[PoolMetrics],
    revenue: u128,
    users: u32,
    txs: u64,
) -> ProtocolMetrics {
    let mut total_tvl: u128 = 0;
    let mut total_volume_24h: u128 = 0;

    for pool in pools {
        total_tvl = total_tvl.saturating_add(pool.tvl);
        total_volume_24h = total_volume_24h.saturating_add(pool.volume_24h);
    }

    let total_pools = pools.len() as u32;
    let avg_batch_size = if total_pools > 0 && txs > 0 {
        (txs / total_pools as u64) as u32
    } else {
        0
    };

    ProtocolMetrics {
        total_tvl,
        total_volume_24h,
        total_users: users,
        total_pools,
        total_txs: txs,
        avg_batch_size,
        protocol_revenue: revenue,
    }
}

/// Rank pools by the specified criteria, returning (original_index, pool_ref) pairs
/// sorted in descending order.
pub fn pool_ranking<'a>(
    pools: &'a [PoolMetrics],
    sort_by: SortBy,
) -> Vec<(usize, &'a PoolMetrics)> {
    let mut indexed: Vec<(usize, &PoolMetrics)> = pools.iter().enumerate().collect();

    indexed.sort_by(|a, b| {
        let key = |p: &PoolMetrics| -> u128 {
            match sort_by {
                SortBy::Tvl => p.tvl,
                SortBy::Volume => p.volume_24h,
                SortBy::FeeApr => p.fee_apr_bps as u128,
                SortBy::TradeCount => p.trade_count as u128,
            }
        };
        // Descending order; ties broken by original index (ascending) for stability
        key(b.1).cmp(&key(a.1)).then(a.0.cmp(&b.0))
    });

    indexed
}

/// Compute a simple moving average of volume over a block window.
///
/// Only snapshots whose block height falls within `[max_block - window + 1, max_block]`
/// are included. Returns the arithmetic mean of their volumes.
pub fn volume_moving_average(
    snapshots: &[VolumeSnapshot],
    window: u64,
) -> Result<u128, AnalyticsError> {
    if snapshots.is_empty() {
        return Err(AnalyticsError::InsufficientData);
    }
    if window == 0 {
        return Err(AnalyticsError::InvalidTimeRange);
    }

    // Find the maximum block height
    let max_block = snapshots.iter().map(|s| s.block).max().unwrap();

    // Determine the start of the window
    let window_start = if max_block >= window - 1 {
        max_block - window + 1
    } else {
        0
    };

    let mut sum: u128 = 0;
    let mut count: u64 = 0;

    for snap in snapshots {
        if snap.block >= window_start && snap.block <= max_block {
            sum = sum.saturating_add(snap.volume);
            count += 1;
        }
    }

    if count == 0 {
        return Err(AnalyticsError::InsufficientData);
    }

    Ok(sum / count as u128)
}

/// Detect trend direction from a time series using first-vs-last comparison.
///
/// Computes the change between the average of the first third and last third
/// of data points. Uses a confidence metric based on consistency of direction
/// across consecutive pairs.
pub fn trend_analysis(series: &[TimeSeriesPoint]) -> Result<TrendAnalysis, AnalyticsError> {
    if series.len() < MIN_DATA_POINTS {
        return Err(AnalyticsError::InsufficientData);
    }

    let n = series.len();
    let data_points = n as u32;

    // Sort by block to ensure chronological order
    let mut sorted: Vec<&TimeSeriesPoint> = series.iter().collect();
    sorted.sort_by_key(|p| p.block);

    // Average of first third vs last third
    let third = n / 3;
    let first_third = if third == 0 { 1 } else { third };
    let last_third_start = n - first_third;

    let first_avg = {
        let sum: u128 = sorted[..first_third].iter().map(|p| p.value).sum();
        sum / first_third as u128
    };
    let last_avg = {
        let sum: u128 = sorted[last_third_start..].iter().map(|p| p.value).sum();
        sum / (n - last_third_start) as u128
    };

    // Compute change in bps
    let (direction, change_bps) = if first_avg == 0 && last_avg == 0 {
        (TrendDirection::Flat, 0u16)
    } else if first_avg == 0 {
        // From zero to something is a massive up-trend; cap at 10000 bps
        (TrendDirection::Up, 10_000u16)
    } else {
        let change = if last_avg >= first_avg {
            mul_div(last_avg - first_avg, 10_000, first_avg)
        } else {
            mul_div(first_avg - last_avg, 10_000, first_avg)
        };

        let change_bps_val = if change > u16::MAX as u128 {
            u16::MAX
        } else {
            change as u16
        };

        if change_bps_val <= TREND_FLAT_THRESHOLD_BPS {
            (TrendDirection::Flat, change_bps_val)
        } else if last_avg >= first_avg {
            (TrendDirection::Up, change_bps_val)
        } else {
            (TrendDirection::Down, change_bps_val)
        }
    };

    // Confidence: what fraction of consecutive pairs move in the trend direction?
    let mut consistent = 0u32;
    let total_pairs = (n - 1) as u32;
    for i in 0..n - 1 {
        let going_up = sorted[i + 1].value >= sorted[i].value;
        let matches = match direction {
            TrendDirection::Up => going_up,
            TrendDirection::Down => !going_up,
            TrendDirection::Flat => {
                // For flat, consider pairs with small change as consistent
                let diff = if sorted[i + 1].value >= sorted[i].value {
                    sorted[i + 1].value - sorted[i].value
                } else {
                    sorted[i].value - sorted[i + 1].value
                };
                if sorted[i].value == 0 {
                    diff == 0
                } else {
                    let pair_change = mul_div(diff, 10_000, sorted[i].value);
                    pair_change <= TREND_FLAT_THRESHOLD_BPS as u128
                }
            }
        };
        if matches {
            consistent += 1;
        }
    }

    let confidence_bps = if total_pairs > 0 {
        ((consistent as u64 * 10_000) / total_pairs as u64) as u16
    } else {
        0
    };

    Ok(TrendAnalysis {
        direction,
        change_bps,
        data_points,
        confidence_bps,
    })
}

/// Compute each pool's share of total TVL in basis points.
///
/// Returns (original_index, share_bps) pairs. If total TVL is zero,
/// all shares are zero.
pub fn tvl_composition(pools: &[PoolMetrics]) -> Vec<(usize, u16)> {
    let total_tvl: u128 = pools.iter().map(|p| p.tvl).sum();

    if total_tvl == 0 {
        return pools.iter().enumerate().map(|(i, _)| (i, 0u16)).collect();
    }

    pools
        .iter()
        .enumerate()
        .map(|(i, pool)| {
            let share = mul_div(pool.tvl, 10_000, total_tvl);
            let share_bps = if share > u16::MAX as u128 {
                u16::MAX
            } else {
                share as u16
            };
            (i, share_bps)
        })
        .collect()
}

/// Calculate annualized fee APR in basis points.
///
/// Formula: (fees_earned / tvl) * (blocks_per_year / blocks_elapsed) * 10000
/// Returns 0 if tvl or blocks_elapsed is zero.
pub fn fee_apr(
    fees_earned: u128,
    tvl: u128,
    blocks_elapsed: u64,
    blocks_per_year: u64,
) -> u16 {
    if tvl == 0 || blocks_elapsed == 0 {
        return 0;
    }

    // (fees / tvl) scaled to bps, then annualized
    // = fees * 10000 * blocks_per_year / (tvl * blocks_elapsed)
    let numerator = mul_div(fees_earned, 10_000, tvl);
    let annualized = mul_div(numerator, blocks_per_year as u128, blocks_elapsed as u128);

    if annualized > u16::MAX as u128 {
        u16::MAX
    } else {
        annualized as u16
    }
}

/// Calculate user retention rate in basis points.
///
/// Retention = (active_current - new_current) / active_prev * 10000
/// A rate of 10000 means 100% of previous users are still active.
/// If active_prev is zero, returns 0.
pub fn user_retention_rate(active_prev: u32, active_current: u32, new_current: u32) -> u16 {
    if active_prev == 0 {
        return 0;
    }

    // Returning users = active_current - new_current (clamped to 0)
    let returning = if active_current >= new_current {
        active_current - new_current
    } else {
        0
    };

    // Cap at active_prev to avoid > 100%
    let returning = if returning > active_prev {
        active_prev
    } else {
        returning
    };

    let rate = (returning as u64 * 10_000) / active_prev as u64;
    rate as u16
}

/// Build a leaderboard of top users ranked by total volume.
///
/// Returns at most `top_n` entries. Ties in volume are broken by
/// lower address bytes (lexicographic).
pub fn leaderboard(users: &[UserMetrics], top_n: usize) -> Vec<LeaderboardEntry> {
    if users.is_empty() || top_n == 0 {
        return Vec::new();
    }

    let mut indexed: Vec<(usize, &UserMetrics)> = users.iter().enumerate().collect();

    // Sort descending by volume, ties broken by address (ascending)
    indexed.sort_by(|a, b| {
        b.1.total_volume
            .cmp(&a.1.total_volume)
            .then(a.1.address.cmp(&b.1.address))
    });

    let limit = if top_n > indexed.len() {
        indexed.len()
    } else {
        top_n
    };

    indexed[..limit]
        .iter()
        .enumerate()
        .map(|(rank, (_, user))| LeaderboardEntry {
            address: user.address,
            score: user.total_volume,
            rank: (rank + 1) as u32,
        })
        .collect()
}

/// Compute composite protocol health from multiple signals.
pub fn protocol_health(
    tvl_series: &[TimeSeriesPoint],
    vol_series: &[TimeSeriesPoint],
    users_prev: u32,
    users_current: u32,
    pool_utils: &[u16],
    insurance_coverage_bps: u16,
) -> Result<ProtocolHealth, AnalyticsError> {
    let tvl_trend_result = trend_analysis(tvl_series)?;
    let vol_trend_result = trend_analysis(vol_series)?;

    // User growth
    let user_growth_bps = if users_prev == 0 {
        if users_current > 0 {
            10_000u16
        } else {
            0u16
        }
    } else {
        let growth = if users_current >= users_prev {
            ((users_current - users_prev) as u64 * 10_000) / users_prev as u64
        } else {
            0
        };
        if growth > u16::MAX as u64 {
            u16::MAX
        } else {
            growth as u16
        }
    };

    // Average pool utilization
    let pool_utilization_bps = if pool_utils.is_empty() {
        0
    } else {
        let sum: u64 = pool_utils.iter().map(|&u| u as u64).sum();
        (sum / pool_utils.len() as u64) as u16
    };

    // Risk score: higher when TVL trending down, low coverage, high utilization
    let mut risk: u32 = 0;

    // TVL declining adds risk
    if tvl_trend_result.direction == TrendDirection::Down {
        risk += tvl_trend_result.change_bps as u32;
    }

    // Volume declining adds minor risk
    if vol_trend_result.direction == TrendDirection::Down {
        risk += vol_trend_result.change_bps as u32 / 2;
    }

    // Low insurance coverage adds risk
    if insurance_coverage_bps < HEALTHY_COVERAGE_BPS {
        risk += (HEALTHY_COVERAGE_BPS - insurance_coverage_bps) as u32;
    }

    // High average utilization adds risk
    if pool_utilization_bps > HIGH_UTILIZATION_BPS {
        risk += (pool_utilization_bps - HIGH_UTILIZATION_BPS) as u32;
    }

    let risk_score = if risk > u16::MAX as u32 {
        u16::MAX
    } else {
        risk as u16
    };

    Ok(ProtocolHealth {
        tvl_trend: tvl_trend_result.direction,
        volume_trend: vol_trend_result.direction,
        user_growth_bps,
        pool_utilization_bps,
        insurance_coverage_bps,
        risk_score,
    })
}

/// Compute a Herfindahl-like concentration index from pool TVLs.
///
/// Index = sum of (share_i)^2 where share_i is each pool's share in bps.
/// Result is in bps: 10000 = single pool monopoly, lower = more distributed.
/// Equal distribution among N pools gives 10000/N.
/// Returns 0 for empty input or zero total TVL.
pub fn concentration_index(pool_tvls: &[u128]) -> u16 {
    if pool_tvls.is_empty() {
        return 0;
    }

    let total: u128 = pool_tvls.iter().sum();
    if total == 0 {
        return 0;
    }

    // sum of (share_bps)^2 / 10000 to keep it in bps scale
    let mut hhi: u128 = 0;
    for &tvl in pool_tvls {
        let share_bps = mul_div(tvl, 10_000, total);
        // share_bps^2 / 10000 gives contribution in bps
        hhi += (share_bps * share_bps) / 10_000;
    }

    if hhi > u16::MAX as u128 {
        u16::MAX
    } else {
        hhi as u16
    }
}

/// Capital efficiency metric: volume / TVL at PRECISION scale.
///
/// Higher values indicate more capital-efficient pools.
/// Returns 0 if tvl is zero.
pub fn volume_to_tvl_ratio(volume: u128, tvl: u128) -> u128 {
    if tvl == 0 {
        return 0;
    }
    mul_div(volume, PRECISION, tvl)
}

/// Signed growth rate in basis points.
///
/// Positive = growth, negative = decline.
/// Returns 0 if previous is zero and current is also zero.
/// Returns 10000 (100%) if previous is zero and current > 0.
pub fn growth_rate_bps(previous: u128, current: u128) -> i32 {
    if previous == 0 {
        if current == 0 {
            return 0;
        }
        return 10_000; // infinite growth capped at 100%
    }

    if current >= previous {
        let rate = mul_div(current - previous, 10_000, previous);
        if rate > i32::MAX as u128 {
            i32::MAX
        } else {
            rate as i32
        }
    } else {
        let rate = mul_div(previous - current, 10_000, previous);
        if rate > i32::MAX as u128 {
            i32::MIN
        } else {
            -(rate as i32)
        }
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn make_pool(pair_byte: u8, tvl: u128, volume: u128, apr: u16, trades: u64) -> PoolMetrics {
        PoolMetrics {
            pair_id: [pair_byte; 32],
            tvl,
            volume_24h: volume,
            fee_apr_bps: apr,
            utilization_bps: 5000,
            trade_count: trades,
            unique_traders: 10,
        }
    }

    fn make_user(addr_byte: u8, volume: u128, fees: u128) -> UserMetrics {
        UserMetrics {
            address: [addr_byte; 32],
            total_volume: volume,
            total_fees_paid: fees,
            pool_count: 3,
            first_active_block: 100,
            last_active_block: 10000,
            loyalty_score: 500,
        }
    }

    fn make_series(values: &[u128]) -> Vec<TimeSeriesPoint> {
        values
            .iter()
            .enumerate()
            .map(|(i, &v)| TimeSeriesPoint {
                block: (i as u64 + 1) * 100,
                value: v,
            })
            .collect()
    }

    fn make_snapshots(volumes: &[u128]) -> Vec<VolumeSnapshot> {
        volumes
            .iter()
            .enumerate()
            .map(|(i, &v)| VolumeSnapshot {
                block: (i as u64 + 1) * 100,
                volume: v,
            })
            .collect()
    }

    // ============ Protocol Metrics Tests ============

    #[test]
    fn protocol_metrics_empty_pools() {
        let m = protocol_metrics(&[], 0, 0, 0);
        assert_eq!(m.total_tvl, 0);
        assert_eq!(m.total_volume_24h, 0);
        assert_eq!(m.total_pools, 0);
        assert_eq!(m.avg_batch_size, 0);
        assert_eq!(m.protocol_revenue, 0);
    }

    #[test]
    fn protocol_metrics_single_pool() {
        let pools = vec![make_pool(0x01, 1_000_000, 500_000, 300, 100)];
        let m = protocol_metrics(&pools, 5000, 50, 100);
        assert_eq!(m.total_tvl, 1_000_000);
        assert_eq!(m.total_volume_24h, 500_000);
        assert_eq!(m.total_pools, 1);
        assert_eq!(m.total_users, 50);
        assert_eq!(m.total_txs, 100);
        assert_eq!(m.avg_batch_size, 100); // 100 txs / 1 pool
        assert_eq!(m.protocol_revenue, 5000);
    }

    #[test]
    fn protocol_metrics_many_pools() {
        let pools = vec![
            make_pool(0x01, 1_000_000, 500_000, 300, 100),
            make_pool(0x02, 2_000_000, 1_000_000, 200, 200),
            make_pool(0x03, 3_000_000, 1_500_000, 100, 300),
        ];
        let m = protocol_metrics(&pools, 15000, 200, 600);
        assert_eq!(m.total_tvl, 6_000_000);
        assert_eq!(m.total_volume_24h, 3_000_000);
        assert_eq!(m.total_pools, 3);
        assert_eq!(m.avg_batch_size, 200); // 600 / 3
    }

    #[test]
    fn protocol_metrics_overflow_protection() {
        let pools = vec![
            make_pool(0x01, u128::MAX / 2, u128::MAX / 2, 300, 100),
            make_pool(0x02, u128::MAX / 2 + 1, u128::MAX / 2 + 1, 200, 200),
        ];
        let m = protocol_metrics(&pools, 0, 0, 0);
        // saturating_add should cap at u128::MAX
        assert_eq!(m.total_tvl, u128::MAX);
        assert_eq!(m.total_volume_24h, u128::MAX);
    }

    #[test]
    fn protocol_metrics_zero_txs_nonzero_pools() {
        let pools = vec![make_pool(0x01, 1_000, 500, 100, 0)];
        let m = protocol_metrics(&pools, 0, 10, 0);
        assert_eq!(m.avg_batch_size, 0); // 0 txs
    }

    // ============ Pool Ranking Tests ============

    #[test]
    fn pool_ranking_by_tvl() {
        let pools = vec![
            make_pool(0x01, 100, 50, 300, 10),
            make_pool(0x02, 300, 30, 100, 5),
            make_pool(0x03, 200, 40, 200, 8),
        ];
        let ranked = pool_ranking(&pools, SortBy::Tvl);
        assert_eq!(ranked[0].0, 1); // pool 0x02 with TVL 300
        assert_eq!(ranked[1].0, 2); // pool 0x03 with TVL 200
        assert_eq!(ranked[2].0, 0); // pool 0x01 with TVL 100
    }

    #[test]
    fn pool_ranking_by_volume() {
        let pools = vec![
            make_pool(0x01, 100, 50, 300, 10),
            make_pool(0x02, 300, 30, 100, 5),
            make_pool(0x03, 200, 40, 200, 8),
        ];
        let ranked = pool_ranking(&pools, SortBy::Volume);
        assert_eq!(ranked[0].0, 0); // 50
        assert_eq!(ranked[1].0, 2); // 40
        assert_eq!(ranked[2].0, 1); // 30
    }

    #[test]
    fn pool_ranking_by_fee_apr() {
        let pools = vec![
            make_pool(0x01, 100, 50, 300, 10),
            make_pool(0x02, 300, 30, 100, 5),
            make_pool(0x03, 200, 40, 200, 8),
        ];
        let ranked = pool_ranking(&pools, SortBy::FeeApr);
        assert_eq!(ranked[0].0, 0); // 300
        assert_eq!(ranked[1].0, 2); // 200
        assert_eq!(ranked[2].0, 1); // 100
    }

    #[test]
    fn pool_ranking_by_trade_count() {
        let pools = vec![
            make_pool(0x01, 100, 50, 300, 10),
            make_pool(0x02, 300, 30, 100, 5),
            make_pool(0x03, 200, 40, 200, 8),
        ];
        let ranked = pool_ranking(&pools, SortBy::TradeCount);
        assert_eq!(ranked[0].0, 0); // 10
        assert_eq!(ranked[1].0, 2); // 8
        assert_eq!(ranked[2].0, 1); // 5
    }

    #[test]
    fn pool_ranking_empty() {
        let ranked = pool_ranking(&[], SortBy::Tvl);
        assert!(ranked.is_empty());
    }

    #[test]
    fn pool_ranking_ties_stable_by_index() {
        let pools = vec![
            make_pool(0x01, 100, 50, 300, 10),
            make_pool(0x02, 100, 50, 300, 10),
            make_pool(0x03, 100, 50, 300, 10),
        ];
        let ranked = pool_ranking(&pools, SortBy::Tvl);
        // All equal, should be sorted by ascending index
        assert_eq!(ranked[0].0, 0);
        assert_eq!(ranked[1].0, 1);
        assert_eq!(ranked[2].0, 2);
    }

    // ============ Volume Moving Average Tests ============

    #[test]
    fn volume_ma_normal() {
        let snaps = make_snapshots(&[100, 200, 300, 400, 500]);
        // Window of 300 blocks covers blocks 300..500 → snaps at 300, 400, 500
        let ma = volume_moving_average(&snaps, 300).unwrap();
        // (300 + 400 + 500) / 3 = 400
        assert_eq!(ma, 400);
    }

    #[test]
    fn volume_ma_single_snapshot() {
        let snaps = make_snapshots(&[1000]);
        let ma = volume_moving_average(&snaps, 100).unwrap();
        assert_eq!(ma, 1000);
    }

    #[test]
    fn volume_ma_insufficient_data() {
        let result = volume_moving_average(&[], 100);
        assert_eq!(result, Err(AnalyticsError::InsufficientData));
    }

    #[test]
    fn volume_ma_zero_window() {
        let snaps = make_snapshots(&[100]);
        let result = volume_moving_average(&snaps, 0);
        assert_eq!(result, Err(AnalyticsError::InvalidTimeRange));
    }

    #[test]
    fn volume_ma_window_larger_than_range() {
        // All blocks fit in the window
        let snaps = make_snapshots(&[100, 200, 300]);
        let ma = volume_moving_average(&snaps, 10_000).unwrap();
        assert_eq!(ma, 200); // (100 + 200 + 300) / 3
    }

    #[test]
    fn volume_ma_window_of_one() {
        // Window=1 means only max_block is included
        let snaps = make_snapshots(&[100, 200, 300]);
        // max_block = 300, window_start = 300
        let ma = volume_moving_average(&snaps, 1).unwrap();
        assert_eq!(ma, 300);
    }

    // ============ Trend Analysis Tests ============

    #[test]
    fn trend_analysis_uptrend() {
        let series = make_series(&[100, 150, 200, 250, 300]);
        let t = trend_analysis(&series).unwrap();
        assert_eq!(t.direction, TrendDirection::Up);
        assert!(t.change_bps > TREND_FLAT_THRESHOLD_BPS);
        assert_eq!(t.data_points, 5);
    }

    #[test]
    fn trend_analysis_downtrend() {
        let series = make_series(&[300, 250, 200, 150, 100]);
        let t = trend_analysis(&series).unwrap();
        assert_eq!(t.direction, TrendDirection::Down);
        assert!(t.change_bps > TREND_FLAT_THRESHOLD_BPS);
    }

    #[test]
    fn trend_analysis_flat() {
        let series = make_series(&[1000, 1001, 999, 1000, 1002]);
        let t = trend_analysis(&series).unwrap();
        assert_eq!(t.direction, TrendDirection::Flat);
        assert!(t.change_bps <= TREND_FLAT_THRESHOLD_BPS);
    }

    #[test]
    fn trend_analysis_volatile_but_upward() {
        // Zig-zag but overall upward
        let series = make_series(&[100, 300, 150, 350, 200, 400]);
        let t = trend_analysis(&series).unwrap();
        assert_eq!(t.direction, TrendDirection::Up);
        // Confidence should be lower due to volatility
    }

    #[test]
    fn trend_analysis_insufficient_data() {
        let series = make_series(&[100, 200]);
        let result = trend_analysis(&series);
        assert_eq!(result, Err(AnalyticsError::InsufficientData));
    }

    #[test]
    fn trend_analysis_single_point() {
        let series = make_series(&[100]);
        let result = trend_analysis(&series);
        assert_eq!(result, Err(AnalyticsError::InsufficientData));
    }

    #[test]
    fn trend_analysis_empty() {
        let result = trend_analysis(&[]);
        assert_eq!(result, Err(AnalyticsError::InsufficientData));
    }

    #[test]
    fn trend_analysis_constant_values() {
        let series = make_series(&[500, 500, 500, 500, 500]);
        let t = trend_analysis(&series).unwrap();
        assert_eq!(t.direction, TrendDirection::Flat);
        assert_eq!(t.change_bps, 0);
    }

    #[test]
    fn trend_analysis_all_zero() {
        let series = make_series(&[0, 0, 0, 0, 0]);
        let t = trend_analysis(&series).unwrap();
        assert_eq!(t.direction, TrendDirection::Flat);
        assert_eq!(t.change_bps, 0);
    }

    #[test]
    fn trend_analysis_from_zero_to_value() {
        let series = make_series(&[0, 0, 100, 200, 300]);
        let t = trend_analysis(&series).unwrap();
        assert_eq!(t.direction, TrendDirection::Up);
        assert_eq!(t.change_bps, 10_000); // capped
    }

    #[test]
    fn trend_analysis_high_confidence_uptrend() {
        // Strictly increasing = 100% consistency
        let series = make_series(&[100, 200, 300, 400, 500, 600]);
        let t = trend_analysis(&series).unwrap();
        assert_eq!(t.direction, TrendDirection::Up);
        assert_eq!(t.confidence_bps, 10_000); // all pairs go up
    }

    #[test]
    fn trend_analysis_minimum_data_points() {
        let series = make_series(&[100, 200, 300]);
        let t = trend_analysis(&series).unwrap();
        assert_eq!(t.direction, TrendDirection::Up);
        assert_eq!(t.data_points, 3);
    }

    // ============ TVL Composition Tests ============

    #[test]
    fn tvl_composition_single_pool() {
        let pools = vec![make_pool(0x01, 1_000_000, 0, 0, 0)];
        let comp = tvl_composition(&pools);
        assert_eq!(comp.len(), 1);
        assert_eq!(comp[0], (0, 10_000)); // 100%
    }

    #[test]
    fn tvl_composition_equal_split() {
        let pools = vec![
            make_pool(0x01, 1_000, 0, 0, 0),
            make_pool(0x02, 1_000, 0, 0, 0),
        ];
        let comp = tvl_composition(&pools);
        assert_eq!(comp[0], (0, 5_000)); // 50%
        assert_eq!(comp[1], (1, 5_000)); // 50%
    }

    #[test]
    fn tvl_composition_skewed() {
        let pools = vec![
            make_pool(0x01, 9_000, 0, 0, 0),
            make_pool(0x02, 1_000, 0, 0, 0),
        ];
        let comp = tvl_composition(&pools);
        assert_eq!(comp[0], (0, 9_000)); // 90%
        assert_eq!(comp[1], (1, 1_000)); // 10%
    }

    #[test]
    fn tvl_composition_three_way() {
        let pools = vec![
            make_pool(0x01, 5_000, 0, 0, 0),
            make_pool(0x02, 3_000, 0, 0, 0),
            make_pool(0x03, 2_000, 0, 0, 0),
        ];
        let comp = tvl_composition(&pools);
        assert_eq!(comp[0], (0, 5_000)); // 50%
        assert_eq!(comp[1], (1, 3_000)); // 30%
        assert_eq!(comp[2], (2, 2_000)); // 20%
    }

    #[test]
    fn tvl_composition_empty() {
        let comp = tvl_composition(&[]);
        assert!(comp.is_empty());
    }

    #[test]
    fn tvl_composition_zero_tvl() {
        let pools = vec![
            make_pool(0x01, 0, 0, 0, 0),
            make_pool(0x02, 0, 0, 0, 0),
        ];
        let comp = tvl_composition(&pools);
        assert_eq!(comp[0], (0, 0));
        assert_eq!(comp[1], (1, 0));
    }

    // ============ Fee APR Tests ============

    #[test]
    fn fee_apr_normal() {
        // 100 fees on 10000 TVL over 1 year = 1% = 100 bps
        let apr = fee_apr(100, 10_000, BLOCKS_PER_YEAR, BLOCKS_PER_YEAR);
        assert_eq!(apr, 100);
    }

    #[test]
    fn fee_apr_half_year() {
        // 100 fees on 10000 TVL over half a year → annualized = 2% = 200 bps
        let apr = fee_apr(100, 10_000, BLOCKS_PER_YEAR / 2, BLOCKS_PER_YEAR);
        assert_eq!(apr, 200);
    }

    #[test]
    fn fee_apr_zero_tvl() {
        let apr = fee_apr(100, 0, BLOCKS_PER_YEAR, BLOCKS_PER_YEAR);
        assert_eq!(apr, 0);
    }

    #[test]
    fn fee_apr_zero_blocks() {
        let apr = fee_apr(100, 10_000, 0, BLOCKS_PER_YEAR);
        assert_eq!(apr, 0);
    }

    #[test]
    fn fee_apr_large_values() {
        // Very high fee yield should cap at u16::MAX
        let apr = fee_apr(PRECISION, 1, BLOCKS_PER_YEAR, BLOCKS_PER_YEAR);
        assert_eq!(apr, u16::MAX);
    }

    #[test]
    fn fee_apr_zero_fees() {
        let apr = fee_apr(0, 10_000, BLOCKS_PER_YEAR, BLOCKS_PER_YEAR);
        assert_eq!(apr, 0);
    }

    #[test]
    fn fee_apr_one_day() {
        // 10 fees on 10000 TVL over 1 day → annualized
        let apr = fee_apr(10, 10_000, BLOCKS_PER_DAY, BLOCKS_PER_YEAR);
        // 10/10000 = 0.1%, annualized: 0.1% * 365.25 = 36.525% = 3652 bps
        // 10 * 10000 / 10000 = 10 bps per day
        // 10 * 7884000 / 21600 = 3650 bps
        assert_eq!(apr, 3650);
    }

    // ============ User Retention Tests ============

    #[test]
    fn retention_100_percent() {
        // 100 prev users, 100 current, 0 new → 100% retention
        let rate = user_retention_rate(100, 100, 0);
        assert_eq!(rate, 10_000);
    }

    #[test]
    fn retention_0_percent() {
        // 100 prev users, 50 current, 50 new → 0 returning → 0%
        let rate = user_retention_rate(100, 50, 50);
        assert_eq!(rate, 0);
    }

    #[test]
    fn retention_typical() {
        // 100 prev, 120 current, 40 new → 80 returning → 80%
        let rate = user_retention_rate(100, 120, 40);
        assert_eq!(rate, 8_000);
    }

    #[test]
    fn retention_no_previous_users() {
        let rate = user_retention_rate(0, 50, 50);
        assert_eq!(rate, 0);
    }

    #[test]
    fn retention_new_exceeds_active() {
        // Edge case: new > active (data inconsistency) → 0 returning
        let rate = user_retention_rate(100, 50, 60);
        assert_eq!(rate, 0);
    }

    #[test]
    fn retention_all_new() {
        // 0 prev, 100 current, 100 new
        let rate = user_retention_rate(0, 100, 100);
        assert_eq!(rate, 0);
    }

    #[test]
    fn retention_growth_with_retention() {
        // 50 prev, 80 current, 30 new → 50 returning → 100%
        let rate = user_retention_rate(50, 80, 30);
        assert_eq!(rate, 10_000);
    }

    #[test]
    fn retention_returning_exceeds_prev() {
        // Capped: 50 prev, 100 current, 0 new → 100 returning but capped at 50
        let rate = user_retention_rate(50, 100, 0);
        assert_eq!(rate, 10_000);
    }

    // ============ Leaderboard Tests ============

    #[test]
    fn leaderboard_normal() {
        let users = vec![
            make_user(0x01, 1000, 10),
            make_user(0x02, 3000, 30),
            make_user(0x03, 2000, 20),
        ];
        let lb = leaderboard(&users, 3);
        assert_eq!(lb.len(), 3);
        assert_eq!(lb[0].address, [0x02; 32]); // highest volume
        assert_eq!(lb[0].rank, 1);
        assert_eq!(lb[1].address, [0x03; 32]);
        assert_eq!(lb[1].rank, 2);
        assert_eq!(lb[2].address, [0x01; 32]);
        assert_eq!(lb[2].rank, 3);
    }

    #[test]
    fn leaderboard_top_n_less_than_users() {
        let users = vec![
            make_user(0x01, 1000, 10),
            make_user(0x02, 3000, 30),
            make_user(0x03, 2000, 20),
        ];
        let lb = leaderboard(&users, 2);
        assert_eq!(lb.len(), 2);
        assert_eq!(lb[0].rank, 1);
        assert_eq!(lb[1].rank, 2);
    }

    #[test]
    fn leaderboard_top_n_exceeds_users() {
        let users = vec![make_user(0x01, 1000, 10)];
        let lb = leaderboard(&users, 10);
        assert_eq!(lb.len(), 1);
        assert_eq!(lb[0].rank, 1);
    }

    #[test]
    fn leaderboard_empty_users() {
        let lb = leaderboard(&[], 5);
        assert!(lb.is_empty());
    }

    #[test]
    fn leaderboard_zero_top_n() {
        let users = vec![make_user(0x01, 1000, 10)];
        let lb = leaderboard(&users, 0);
        assert!(lb.is_empty());
    }

    #[test]
    fn leaderboard_ties_broken_by_address() {
        let users = vec![
            make_user(0x03, 1000, 10), // same volume, higher address
            make_user(0x01, 1000, 10), // same volume, lower address
            make_user(0x02, 1000, 10), // same volume, middle address
        ];
        let lb = leaderboard(&users, 3);
        // Ties broken by address ascending
        assert_eq!(lb[0].address, [0x01; 32]);
        assert_eq!(lb[1].address, [0x02; 32]);
        assert_eq!(lb[2].address, [0x03; 32]);
    }

    #[test]
    fn leaderboard_scores_match_volume() {
        let users = vec![make_user(0x01, 5000, 50)];
        let lb = leaderboard(&users, 1);
        assert_eq!(lb[0].score, 5000);
    }

    // ============ Protocol Health Tests ============

    #[test]
    fn protocol_health_healthy() {
        let tvl = make_series(&[100, 150, 200, 250, 300]);
        let vol = make_series(&[50, 60, 70, 80, 90]);
        let h = protocol_health(&tvl, &vol, 100, 120, &[5000, 6000], 7000).unwrap();
        assert_eq!(h.tvl_trend, TrendDirection::Up);
        assert_eq!(h.volume_trend, TrendDirection::Up);
        assert!(h.user_growth_bps > 0);
        assert_eq!(h.pool_utilization_bps, 5500); // (5000+6000)/2
        assert_eq!(h.insurance_coverage_bps, 7000);
        assert_eq!(h.risk_score, 0); // everything is healthy
    }

    #[test]
    fn protocol_health_degraded() {
        let tvl = make_series(&[300, 250, 200, 150, 100]);
        let vol = make_series(&[90, 80, 70, 60, 50]);
        let h = protocol_health(&tvl, &vol, 100, 80, &[9000, 9500], 3000).unwrap();
        assert_eq!(h.tvl_trend, TrendDirection::Down);
        assert_eq!(h.volume_trend, TrendDirection::Down);
        // risk_score should be > 0 due to declining TVL, low coverage, high util
        assert!(h.risk_score > 0);
    }

    #[test]
    fn protocol_health_insufficient_tvl_data() {
        let tvl = make_series(&[100, 200]); // only 2 points
        let vol = make_series(&[50, 60, 70, 80, 90]);
        let result = protocol_health(&tvl, &vol, 100, 120, &[5000], 7000);
        assert_eq!(result, Err(AnalyticsError::InsufficientData));
    }

    #[test]
    fn protocol_health_insufficient_vol_data() {
        let tvl = make_series(&[100, 200, 300, 400, 500]);
        let vol = make_series(&[50]); // only 1 point
        let result = protocol_health(&tvl, &vol, 100, 120, &[5000], 7000);
        assert_eq!(result, Err(AnalyticsError::InsufficientData));
    }

    #[test]
    fn protocol_health_no_previous_users() {
        let tvl = make_series(&[100, 200, 300]);
        let vol = make_series(&[50, 60, 70]);
        let h = protocol_health(&tvl, &vol, 0, 50, &[5000], 7000).unwrap();
        assert_eq!(h.user_growth_bps, 10_000); // 100% growth from 0
    }

    #[test]
    fn protocol_health_empty_pool_utils() {
        let tvl = make_series(&[100, 200, 300]);
        let vol = make_series(&[50, 60, 70]);
        let h = protocol_health(&tvl, &vol, 50, 60, &[], 7000).unwrap();
        assert_eq!(h.pool_utilization_bps, 0);
    }

    #[test]
    fn protocol_health_low_insurance_adds_risk() {
        let tvl = make_series(&[100, 100, 100]); // flat
        let vol = make_series(&[50, 50, 50]); // flat
        let h = protocol_health(&tvl, &vol, 100, 100, &[5000], 2000).unwrap();
        // Low insurance (2000 < 5000) should add risk
        assert!(h.risk_score > 0);
    }

    #[test]
    fn protocol_health_high_utilization_adds_risk() {
        let tvl = make_series(&[100, 100, 100]);
        let vol = make_series(&[50, 50, 50]);
        let h = protocol_health(&tvl, &vol, 100, 100, &[9000, 9500], 7000).unwrap();
        // High utilization (9250 > 8000) should add risk
        assert!(h.risk_score > 0);
    }

    // ============ Concentration Index Tests ============

    #[test]
    fn concentration_single_pool() {
        let index = concentration_index(&[1_000_000]);
        assert_eq!(index, 10_000); // monopoly
    }

    #[test]
    fn concentration_two_equal_pools() {
        let index = concentration_index(&[500, 500]);
        // Each has 5000 bps share. HHI = 2 * (5000^2 / 10000) = 2 * 2500 = 5000
        assert_eq!(index, 5_000);
    }

    #[test]
    fn concentration_four_equal_pools() {
        let index = concentration_index(&[250, 250, 250, 250]);
        // Each has 2500 bps. HHI = 4 * (2500^2 / 10000) = 4 * 625 = 2500
        assert_eq!(index, 2_500);
    }

    #[test]
    fn concentration_skewed() {
        let index = concentration_index(&[9000, 500, 500]);
        // 9000/10000 = 9000 bps, 500/10000 = 500 bps each
        // HHI = 9000^2/10000 + 2*(500^2/10000) = 8100 + 50 = 8150
        assert_eq!(index, 8_150);
    }

    #[test]
    fn concentration_empty() {
        let index = concentration_index(&[]);
        assert_eq!(index, 0);
    }

    #[test]
    fn concentration_all_zero() {
        let index = concentration_index(&[0, 0, 0]);
        assert_eq!(index, 0);
    }

    #[test]
    fn concentration_single_zero_and_one_nonzero() {
        let index = concentration_index(&[0, 1000]);
        // Only one pool has TVL, so 100% concentration
        assert_eq!(index, 10_000);
    }

    // ============ Volume to TVL Ratio Tests ============

    #[test]
    fn volume_tvl_normal() {
        // 1:1 ratio = 1.0 * PRECISION
        let ratio = volume_to_tvl_ratio(1000, 1000);
        assert_eq!(ratio, PRECISION);
    }

    #[test]
    fn volume_tvl_double() {
        // 2:1 ratio = 2.0 * PRECISION
        let ratio = volume_to_tvl_ratio(2000, 1000);
        assert_eq!(ratio, 2 * PRECISION);
    }

    #[test]
    fn volume_tvl_half() {
        // 0.5:1 ratio
        let ratio = volume_to_tvl_ratio(500, 1000);
        assert_eq!(ratio, PRECISION / 2);
    }

    #[test]
    fn volume_tvl_zero_tvl() {
        let ratio = volume_to_tvl_ratio(1000, 0);
        assert_eq!(ratio, 0);
    }

    #[test]
    fn volume_tvl_zero_volume() {
        let ratio = volume_to_tvl_ratio(0, 1000);
        assert_eq!(ratio, 0);
    }

    #[test]
    fn volume_tvl_both_zero() {
        let ratio = volume_to_tvl_ratio(0, 0);
        assert_eq!(ratio, 0);
    }

    // ============ Growth Rate Tests ============

    #[test]
    fn growth_rate_positive() {
        // 100 → 150 = +50%
        let rate = growth_rate_bps(100, 150);
        assert_eq!(rate, 5_000);
    }

    #[test]
    fn growth_rate_negative() {
        // 200 → 100 = -50%
        let rate = growth_rate_bps(200, 100);
        assert_eq!(rate, -5_000);
    }

    #[test]
    fn growth_rate_zero_change() {
        let rate = growth_rate_bps(100, 100);
        assert_eq!(rate, 0);
    }

    #[test]
    fn growth_rate_from_zero_to_value() {
        let rate = growth_rate_bps(0, 500);
        assert_eq!(rate, 10_000); // capped at 100%
    }

    #[test]
    fn growth_rate_from_zero_to_zero() {
        let rate = growth_rate_bps(0, 0);
        assert_eq!(rate, 0);
    }

    #[test]
    fn growth_rate_double() {
        // 100 → 200 = +100%
        let rate = growth_rate_bps(100, 200);
        assert_eq!(rate, 10_000);
    }

    #[test]
    fn growth_rate_to_zero() {
        // 100 → 0 = -100%
        let rate = growth_rate_bps(100, 0);
        assert_eq!(rate, -10_000);
    }

    #[test]
    fn growth_rate_small_change() {
        // 10000 → 10050 = +0.5% = 50 bps
        let rate = growth_rate_bps(10_000, 10_050);
        assert_eq!(rate, 50);
    }

    #[test]
    fn growth_rate_large_growth() {
        // 1 → 1000 = 99900% = 999_000_0 bps
        let rate = growth_rate_bps(1, 1000);
        assert_eq!(rate, 9_990_000);
    }

    // ============ Additional Edge Case Tests ============

    // --- Protocol Metrics: saturating addition with many pools ---

    #[test]
    fn protocol_metrics_three_pools_at_max() {
        let pools = vec![
            make_pool(0x01, u128::MAX, u128::MAX, 0, 0),
            make_pool(0x02, u128::MAX, u128::MAX, 0, 0),
            make_pool(0x03, u128::MAX, u128::MAX, 0, 0),
        ];
        let m = protocol_metrics(&pools, u128::MAX, u32::MAX, u64::MAX);
        assert_eq!(m.total_tvl, u128::MAX);
        assert_eq!(m.total_volume_24h, u128::MAX);
        assert_eq!(m.total_users, u32::MAX);
        assert_eq!(m.protocol_revenue, u128::MAX);
    }

    #[test]
    fn protocol_metrics_avg_batch_size_truncates() {
        // 7 txs / 3 pools = 2 (integer truncation)
        let pools = vec![
            make_pool(0x01, 100, 50, 100, 10),
            make_pool(0x02, 200, 60, 200, 20),
            make_pool(0x03, 300, 70, 300, 30),
        ];
        let m = protocol_metrics(&pools, 0, 0, 7);
        assert_eq!(m.avg_batch_size, 2);
    }

    // --- Pool Ranking: single pool ---

    #[test]
    fn pool_ranking_single_pool() {
        let pools = vec![make_pool(0x01, 500, 200, 100, 50)];
        let ranked = pool_ranking(&pools, SortBy::Tvl);
        assert_eq!(ranked.len(), 1);
        assert_eq!(ranked[0].0, 0);
        assert_eq!(ranked[0].1.tvl, 500);
    }

    // --- Volume Moving Average: all snapshots outside window ---

    #[test]
    fn volume_ma_saturating_addition() {
        // Large volumes that would overflow without saturating_add
        let snaps = vec![
            VolumeSnapshot { block: 100, volume: u128::MAX / 2 },
            VolumeSnapshot { block: 200, volume: u128::MAX / 2 },
        ];
        // window covers both; sum saturates, then divide by 2
        let ma = volume_moving_average(&snaps, 200).unwrap();
        // saturating_add(MAX/2, MAX/2) = MAX-1, then /2 = (MAX-1)/2
        assert_eq!(ma, (u128::MAX - 1) / 2);
    }

    #[test]
    fn volume_ma_non_contiguous_blocks() {
        // Snapshots at blocks 10, 1000, 5000; window of 100
        // max_block=5000, window_start=4901
        // Only snapshot at block 5000 is in range
        let snaps = vec![
            VolumeSnapshot { block: 10, volume: 100 },
            VolumeSnapshot { block: 1000, volume: 200 },
            VolumeSnapshot { block: 5000, volume: 999 },
        ];
        let ma = volume_moving_average(&snaps, 100).unwrap();
        assert_eq!(ma, 999);
    }

    #[test]
    fn volume_ma_window_exact_boundary() {
        // max_block=300, window=200, window_start=101
        // block 100 is OUTSIDE (100 < 101), blocks 200 and 300 are inside
        let snaps = make_snapshots(&[100, 200, 300]);
        let ma = volume_moving_average(&snaps, 200).unwrap();
        assert_eq!(ma, (200 + 300) / 2);
    }

    // --- Trend Analysis: exactly 3 points (minimum) with down trend ---

    #[test]
    fn trend_analysis_minimum_data_points_downtrend() {
        let series = make_series(&[300, 200, 100]);
        let t = trend_analysis(&series).unwrap();
        assert_eq!(t.direction, TrendDirection::Down);
        assert_eq!(t.data_points, 3);
    }

    #[test]
    fn trend_analysis_large_values_no_overflow() {
        // Values near u128 max that could overflow naive arithmetic
        let series = make_series(&[
            PRECISION * 1000,
            PRECISION * 2000,
            PRECISION * 3000,
        ]);
        let t = trend_analysis(&series).unwrap();
        assert_eq!(t.direction, TrendDirection::Up);
    }

    #[test]
    fn trend_analysis_unsorted_blocks() {
        // Blocks given out of order; function should sort internally
        let series = vec![
            TimeSeriesPoint { block: 500, value: 300 },
            TimeSeriesPoint { block: 100, value: 100 },
            TimeSeriesPoint { block: 300, value: 200 },
        ];
        let t = trend_analysis(&series).unwrap();
        // After sorting: 100->200->300, clear uptrend
        assert_eq!(t.direction, TrendDirection::Up);
    }

    #[test]
    fn trend_analysis_exactly_at_flat_threshold() {
        // Construct series where change_bps is exactly TREND_FLAT_THRESHOLD_BPS (100)
        // first_avg=10000, last_avg=10100 → change = (100/10000)*10000 = 100 bps
        let series = make_series(&[10000, 10050, 10100]);
        let t = trend_analysis(&series).unwrap();
        assert_eq!(t.direction, TrendDirection::Flat);
        assert!(t.change_bps <= TREND_FLAT_THRESHOLD_BPS);
    }

    #[test]
    fn trend_analysis_just_above_flat_threshold() {
        // first_avg=10000, last_avg=10200 → change = 200 bps > 100 threshold
        let series = make_series(&[10000, 10100, 10200]);
        let t = trend_analysis(&series).unwrap();
        assert_eq!(t.direction, TrendDirection::Up);
        assert!(t.change_bps > TREND_FLAT_THRESHOLD_BPS);
    }

    // --- TVL Composition: single pool with zero TVL among nonzero ---

    #[test]
    fn tvl_composition_one_zero_among_nonzero() {
        let pools = vec![
            make_pool(0x01, 1000, 0, 0, 0),
            make_pool(0x02, 0, 0, 0, 0),
        ];
        let comp = tvl_composition(&pools);
        assert_eq!(comp[0], (0, 10_000)); // 100%
        assert_eq!(comp[1], (1, 0));       // 0%
    }

    #[test]
    fn tvl_composition_many_tiny_pools() {
        // 100 pools with TVL=1 each
        let pools: Vec<PoolMetrics> = (0..100u8)
            .map(|i| make_pool(i, 1, 0, 0, 0))
            .collect();
        let comp = tvl_composition(&pools);
        // Each pool has 1/100 = 100 bps = 1%
        for (i, &(idx, share)) in comp.iter().enumerate() {
            assert_eq!(idx, i);
            assert_eq!(share, 100);
        }
    }

    // --- Fee APR: both zero fees AND zero TVL ---

    #[test]
    fn fee_apr_both_zero() {
        let apr = fee_apr(0, 0, BLOCKS_PER_YEAR, BLOCKS_PER_YEAR);
        assert_eq!(apr, 0);
    }

    #[test]
    fn fee_apr_very_short_period() {
        // 1 fee on 100 TVL over 1 block, annualized over 7.884M blocks
        let apr = fee_apr(1, 100, 1, BLOCKS_PER_YEAR);
        // (1/100)*10000 = 100 bps per block; *7_884_000 = huge, capped at u16::MAX
        assert_eq!(apr, u16::MAX);
    }

    // --- Retention: all users are returning ---

    #[test]
    fn retention_all_returning_no_new() {
        // 200 prev, 200 current, 0 new → 200 returning → 100%
        let rate = user_retention_rate(200, 200, 0);
        assert_eq!(rate, 10_000);
    }

    #[test]
    fn retention_one_prev_user() {
        // 1 prev, 1 current, 0 new → 100%
        let rate = user_retention_rate(1, 1, 0);
        assert_eq!(rate, 10_000);
    }

    #[test]
    fn retention_one_prev_user_lost() {
        // 1 prev, 1 current, 1 new → 0 returning → 0%
        let rate = user_retention_rate(1, 1, 1);
        assert_eq!(rate, 0);
    }

    // --- Leaderboard: all zero volumes ---

    #[test]
    fn leaderboard_all_zero_volume() {
        let users = vec![
            make_user(0x03, 0, 0),
            make_user(0x01, 0, 0),
            make_user(0x02, 0, 0),
        ];
        let lb = leaderboard(&users, 3);
        assert_eq!(lb.len(), 3);
        // All tied at 0; sorted by address ascending
        assert_eq!(lb[0].address, [0x01; 32]);
        assert_eq!(lb[1].address, [0x02; 32]);
        assert_eq!(lb[2].address, [0x03; 32]);
        assert_eq!(lb[0].score, 0);
    }

    #[test]
    fn leaderboard_top_1_many_users() {
        let users = vec![
            make_user(0x01, 500, 5),
            make_user(0x02, 900, 9),
            make_user(0x03, 100, 1),
            make_user(0x04, 700, 7),
        ];
        let lb = leaderboard(&users, 1);
        assert_eq!(lb.len(), 1);
        assert_eq!(lb[0].address, [0x02; 32]);
        assert_eq!(lb[0].rank, 1);
        assert_eq!(lb[0].score, 900);
    }

    // --- Protocol Health: zero users prev AND current ---

    #[test]
    fn protocol_health_zero_users_both_periods() {
        let tvl = make_series(&[100, 200, 300]);
        let vol = make_series(&[50, 60, 70]);
        let h = protocol_health(&tvl, &vol, 0, 0, &[5000], 7000).unwrap();
        assert_eq!(h.user_growth_bps, 0);
    }

    #[test]
    fn protocol_health_declining_users_no_growth() {
        let tvl = make_series(&[100, 200, 300]);
        let vol = make_series(&[50, 60, 70]);
        // users_current < users_prev: growth is 0 (clamped, no negative)
        let h = protocol_health(&tvl, &vol, 200, 100, &[5000], 7000).unwrap();
        assert_eq!(h.user_growth_bps, 0);
    }

    #[test]
    fn protocol_health_max_risk_accumulation() {
        // Declining TVL (strong), declining volume, low insurance, high utilization
        let tvl = make_series(&[1000, 500, 100]);
        let vol = make_series(&[500, 250, 50]);
        let h = protocol_health(&tvl, &vol, 100, 100, &[9500, 10000], 1000).unwrap();
        assert_eq!(h.tvl_trend, TrendDirection::Down);
        assert_eq!(h.volume_trend, TrendDirection::Down);
        // Risk score should be non-trivially large
        assert!(h.risk_score > 1000);
    }

    // --- Concentration Index: large number of equal pools ---

    #[test]
    fn concentration_ten_equal_pools() {
        let tvls = vec![100u128; 10];
        let index = concentration_index(&tvls);
        // Each has 1000 bps share. HHI = 10 * (1000^2/10000) = 10 * 100 = 1000
        assert_eq!(index, 1_000);
    }

    #[test]
    fn concentration_one_dominant_one_tiny() {
        let index = concentration_index(&[999_999, 1]);
        // Dominant pool has ~10000 bps, tiny has ~0 bps
        // HHI ~ 10000^2/10000 = 10000
        // With rounding: 999_999/1_000_000 * 10000 = 9999 bps
        // 9999^2/10000 = 9998, tiny ~ 0
        assert!(index >= 9_990);
    }

    // --- Volume to TVL: extreme values ---

    #[test]
    fn volume_tvl_very_small_tvl() {
        // Volume much larger than TVL
        let ratio = volume_to_tvl_ratio(PRECISION * 100, 1);
        assert!(ratio > 0);
    }

    #[test]
    fn volume_tvl_equal_precision_values() {
        let ratio = volume_to_tvl_ratio(PRECISION, PRECISION);
        assert_eq!(ratio, PRECISION); // 1:1
    }

    // --- Growth Rate: near i32 boundaries ---

    #[test]
    fn growth_rate_massive_growth_caps_at_i32_max() {
        // previous=1, current=u128::MAX → rate exceeds i32::MAX
        let rate = growth_rate_bps(1, u128::MAX);
        assert_eq!(rate, i32::MAX);
    }

    #[test]
    fn growth_rate_tiny_decline() {
        // 10000 → 9999 = -0.01% = -1 bps
        let rate = growth_rate_bps(10_000, 9_999);
        assert_eq!(rate, -1);
    }

    #[test]
    fn growth_rate_symmetry() {
        // +50% and -50% from appropriate bases
        let up = growth_rate_bps(100, 150);
        let down = growth_rate_bps(150, 100);
        assert_eq!(up, 5_000);
        // 50/150 * 10000 = 3333 bps (not symmetric due to different base)
        assert_eq!(down, -3_333);
    }

    #[test]
    fn growth_rate_one_to_two() {
        // 1 → 2 = +100%
        let rate = growth_rate_bps(1, 2);
        assert_eq!(rate, 10_000);
    }

    #[test]
    fn growth_rate_large_equal_values() {
        // Both large, no change
        let rate = growth_rate_bps(u128::MAX / 2, u128::MAX / 2);
        assert_eq!(rate, 0);
    }

    // --- Constants verification ---

    #[test]
    fn constants_blocks_per_year_consistent() {
        // BLOCKS_PER_YEAR = BLOCKS_PER_DAY * 365
        assert_eq!(BLOCKS_PER_YEAR, BLOCKS_PER_DAY * 365);
        // Sanity: each block ~4 seconds, so ~21600 blocks/day
        assert_eq!(BLOCKS_PER_DAY, 86_400 / 4);
    }

    // ============ Hardening Batch: Additional Edge Cases ============

    #[test]
    fn protocol_metrics_single_pool_zero_everything() {
        let pools = vec![make_pool(0x01, 0, 0, 0, 0)];
        let m = protocol_metrics(&pools, 0, 0, 0);
        assert_eq!(m.total_tvl, 0);
        assert_eq!(m.total_volume_24h, 0);
        assert_eq!(m.total_pools, 1);
        assert_eq!(m.avg_batch_size, 0);
    }

    #[test]
    fn protocol_metrics_revenue_preserved() {
        let pools = vec![make_pool(0x01, 100, 50, 30, 10)];
        let m = protocol_metrics(&pools, 42_000 * PRECISION, 5, 20);
        assert_eq!(m.protocol_revenue, 42_000 * PRECISION);
    }

    #[test]
    fn pool_ranking_two_pools_same_tvl_different_volume() {
        let pools = vec![
            make_pool(0x01, 500, 100, 300, 10),
            make_pool(0x02, 500, 200, 100, 5),
        ];
        // By TVL: tied, so index 0 comes first
        let ranked = pool_ranking(&pools, SortBy::Tvl);
        assert_eq!(ranked[0].0, 0);
        assert_eq!(ranked[1].0, 1);
        // By Volume: pool 0x02 wins
        let ranked_v = pool_ranking(&pools, SortBy::Volume);
        assert_eq!(ranked_v[0].0, 1);
    }

    #[test]
    fn pool_ranking_large_number_of_pools() {
        let pools: Vec<PoolMetrics> = (0..50u8)
            .map(|i| make_pool(i, (i as u128 + 1) * 100, 50, 100, 10))
            .collect();
        let ranked = pool_ranking(&pools, SortBy::Tvl);
        assert_eq!(ranked.len(), 50);
        // Highest TVL is last pool (index 49, tvl = 5000)
        assert_eq!(ranked[0].0, 49);
    }

    #[test]
    fn volume_ma_all_zero_volumes() {
        let snaps = make_snapshots(&[0, 0, 0, 0]);
        let ma = volume_moving_average(&snaps, 1000).unwrap();
        assert_eq!(ma, 0);
    }

    #[test]
    fn volume_ma_single_large_volume() {
        let snaps = vec![VolumeSnapshot { block: 100, volume: u128::MAX }];
        let ma = volume_moving_average(&snaps, 200).unwrap();
        assert_eq!(ma, u128::MAX);
    }

    #[test]
    fn trend_analysis_six_points_sharp_decline() {
        let series = make_series(&[1000, 800, 600, 400, 200, 100]);
        let t = trend_analysis(&series).unwrap();
        assert_eq!(t.direction, TrendDirection::Down);
        assert_eq!(t.data_points, 6);
        assert!(t.change_bps > 5000, "Sharp decline should be > 50% change");
    }

    #[test]
    fn trend_analysis_v_shaped_recovery() {
        // Down then up: overall trend depends on first third vs last third
        let series = make_series(&[500, 200, 100, 100, 200, 500]);
        let t = trend_analysis(&series).unwrap();
        // first_third = [500, 200], avg=350; last_third = [200, 500], avg=350 → flat
        assert_eq!(t.direction, TrendDirection::Flat);
    }

    #[test]
    fn trend_analysis_ten_points_monotonic() {
        let values: Vec<u128> = (1..=10).map(|i| i * 100).collect();
        let series = make_series(&values);
        let t = trend_analysis(&series).unwrap();
        assert_eq!(t.direction, TrendDirection::Up);
        assert_eq!(t.confidence_bps, 10_000); // Perfectly monotonic
        assert_eq!(t.data_points, 10);
    }

    #[test]
    fn tvl_composition_precision_values() {
        // Use PRECISION-scaled TVLs
        let pools = vec![
            make_pool(0x01, 7 * PRECISION, 0, 0, 0),
            make_pool(0x02, 3 * PRECISION, 0, 0, 0),
        ];
        let comp = tvl_composition(&pools);
        assert_eq!(comp[0], (0, 7_000)); // 70%
        assert_eq!(comp[1], (1, 3_000)); // 30%
    }

    #[test]
    fn tvl_composition_single_tiny_pool() {
        let pools = vec![make_pool(0x01, 1, 0, 0, 0)];
        let comp = tvl_composition(&pools);
        assert_eq!(comp[0], (0, 10_000)); // 100%
    }

    #[test]
    fn fee_apr_one_block_high_fee_on_small_tvl() {
        // Extreme annualization: should cap at u16::MAX
        let apr = fee_apr(1000, 1, 1, BLOCKS_PER_YEAR);
        assert_eq!(apr, u16::MAX);
    }

    #[test]
    fn fee_apr_realistic_scenario() {
        // Pool with $1M TVL, earning $10K fees over 30 days
        let fees = 10_000 * PRECISION;
        let tvl = 1_000_000 * PRECISION;
        let blocks = 30 * BLOCKS_PER_DAY;
        let apr = fee_apr(fees, tvl, blocks as u64, BLOCKS_PER_YEAR);
        // 1% per month ≈ 12% per year ≈ 1200 bps
        assert!(apr > 1100 && apr < 1300, "APR should be ~1217 bps, got {}", apr);
    }

    #[test]
    fn retention_equal_to_max_u32() {
        // Large values should not overflow
        let rate = user_retention_rate(u32::MAX, u32::MAX, 0);
        assert_eq!(rate, 10_000);
    }

    #[test]
    fn retention_half_retained() {
        // 200 prev, 150 current, 50 new → 100 returning → 50%
        let rate = user_retention_rate(200, 150, 50);
        assert_eq!(rate, 5_000);
    }

    #[test]
    fn leaderboard_exact_top_n() {
        // top_n == number of users
        let users = vec![
            make_user(0x01, 100, 1),
            make_user(0x02, 200, 2),
        ];
        let lb = leaderboard(&users, 2);
        assert_eq!(lb.len(), 2);
        assert_eq!(lb[0].address, [0x02; 32]);
        assert_eq!(lb[1].address, [0x01; 32]);
    }

    #[test]
    fn leaderboard_single_user_top_zero() {
        let users = vec![make_user(0x01, 100, 1)];
        let lb = leaderboard(&users, 0);
        assert!(lb.is_empty());
    }

    #[test]
    fn concentration_three_equal_pools() {
        let index = concentration_index(&[333, 333, 334]);
        // shares: ~3333, ~3333, ~3334 bps
        // HHI ≈ 3 * (3333^2 / 10000) ≈ 3333
        assert!(index > 3300 && index < 3400, "3-pool HHI should be ~3333, got {}", index);
    }

    #[test]
    fn concentration_one_pool_with_dust() {
        // Dominant pool + dust → nearly monopoly
        let index = concentration_index(&[1_000_000, 1]);
        assert!(index >= 9990, "Near-monopoly HHI should be ~10000, got {}", index);
    }

    #[test]
    fn volume_tvl_large_volume_small_tvl() {
        // Capital efficiency > 1.0 → high ratio
        let ratio = volume_to_tvl_ratio(10 * PRECISION, PRECISION);
        assert_eq!(ratio, 10 * PRECISION);
    }

    #[test]
    fn growth_rate_quarter_decline() {
        // 100 → 75 = -25%
        let rate = growth_rate_bps(100, 75);
        assert_eq!(rate, -2_500);
    }

    #[test]
    fn growth_rate_ten_percent_increase() {
        // 1000 → 1100 = +10%
        let rate = growth_rate_bps(1000, 1100);
        assert_eq!(rate, 1_000);
    }

    #[test]
    fn growth_rate_near_zero_values() {
        // 1 → 1 = 0% change
        let rate = growth_rate_bps(1, 1);
        assert_eq!(rate, 0);
    }

    #[test]
    fn protocol_health_all_flat_no_risk() {
        let tvl = make_series(&[1000, 1000, 1000]);
        let vol = make_series(&[500, 500, 500]);
        let h = protocol_health(&tvl, &vol, 100, 100, &[5000], 6000).unwrap();
        assert_eq!(h.tvl_trend, TrendDirection::Flat);
        assert_eq!(h.volume_trend, TrendDirection::Flat);
        assert_eq!(h.user_growth_bps, 0);
        // Insurance at 6000 > 5000 threshold, utilization at 5000 < 8000 → no risk
        assert_eq!(h.risk_score, 0);
    }

    #[test]
    fn protocol_health_extreme_user_growth() {
        let tvl = make_series(&[100, 200, 300]);
        let vol = make_series(&[50, 60, 70]);
        // 1 prev user, 10000 current → massive growth, caps at u16::MAX if needed
        let h = protocol_health(&tvl, &vol, 1, 10_000, &[5000], 7000).unwrap();
        assert!(h.user_growth_bps > 0);
    }

    #[test]
    fn volume_ma_duplicate_block_numbers() {
        // Multiple snapshots at same block → all included in window
        let snaps = vec![
            VolumeSnapshot { block: 100, volume: 50 },
            VolumeSnapshot { block: 100, volume: 150 },
            VolumeSnapshot { block: 100, volume: 100 },
        ];
        let ma = volume_moving_average(&snaps, 1).unwrap();
        assert_eq!(ma, 100); // (50+150+100)/3
    }

    #[test]
    fn trend_analysis_confidence_half_consistent() {
        // Alternating: up, down, up, down, up (3/4 pairs don't go same direction for down)
        let series = make_series(&[100, 200, 150, 250, 200]);
        let t = trend_analysis(&series).unwrap();
        // Overall direction determined by first_third vs last_third averages
        // Confidence should reflect the inconsistency
        assert!(t.confidence_bps < 10_000, "Volatile series should have < 100% confidence");
    }

    #[test]
    fn fee_apr_blocks_per_year_one() {
        // blocks_per_year = 1 → no annualization scaling beyond the ratio
        let apr = fee_apr(100, 10_000, 1, 1);
        // (100/10000) * 10000 * (1/1) = 100 bps
        assert_eq!(apr, 100);
    }

    #[test]
    fn concentration_single_zero_value_pool() {
        let index = concentration_index(&[0]);
        assert_eq!(index, 0);
    }

    #[test]
    fn growth_rate_massive_decline() {
        // u128::MAX → 1 → should be near -100% = -9999 or -10000 (rounding)
        let rate = growth_rate_bps(u128::MAX, 1);
        assert!(rate <= -9999, "Massive decline should be near -10000, got {}", rate);
    }

    // ============ Hardening Round 5 ============

    #[test]
    fn protocol_metrics_two_pools_different_tvl_v5() {
        let pools = vec![
            make_pool(1, 1_000 * PRECISION, 500 * PRECISION, 200, 100),
            make_pool(2, 3_000 * PRECISION, 200 * PRECISION, 100, 50),
        ];
        let m = protocol_metrics(&pools, 100 * PRECISION, 500, 1000);
        assert_eq!(m.total_tvl, 4_000 * PRECISION);
        assert_eq!(m.total_volume_24h, 700 * PRECISION);
        assert_eq!(m.total_pools, 2);
        assert_eq!(m.total_users, 500);
        assert_eq!(m.total_txs, 1000);
    }

    #[test]
    fn pool_ranking_by_tvl_descending_v5() {
        let pools = vec![
            make_pool(1, 100, 0, 0, 0),
            make_pool(2, 300, 0, 0, 0),
            make_pool(3, 200, 0, 0, 0),
        ];
        let ranked = pool_ranking(&pools, SortBy::Tvl);
        assert_eq!(ranked[0].0, 1); // index 1 has TVL 300
        assert_eq!(ranked[1].0, 2); // index 2 has TVL 200
        assert_eq!(ranked[2].0, 0); // index 0 has TVL 100
    }

    #[test]
    fn volume_ma_two_snapshots_window_covers_both_v5() {
        let snaps = vec![
            VolumeSnapshot { block: 10, volume: 100 },
            VolumeSnapshot { block: 20, volume: 200 },
        ];
        let avg = volume_moving_average(&snaps, 100).unwrap();
        assert_eq!(avg, 150);
    }

    #[test]
    fn volume_ma_window_excludes_old_v5() {
        let snaps = vec![
            VolumeSnapshot { block: 1, volume: 999_999 },
            VolumeSnapshot { block: 100, volume: 200 },
            VolumeSnapshot { block: 101, volume: 300 },
        ];
        let avg = volume_moving_average(&snaps, 2).unwrap();
        assert_eq!(avg, 250); // Only blocks 100,101 included
    }

    #[test]
    fn trend_analysis_strong_uptrend_v5() {
        let series: Vec<TimeSeriesPoint> = (0..10)
            .map(|i| TimeSeriesPoint { block: i, value: (i as u128 + 1) * 1000 })
            .collect();
        let result = trend_analysis(&series).unwrap();
        assert_eq!(result.direction, TrendDirection::Up);
        assert!(result.change_bps > 0);
    }

    #[test]
    fn trend_analysis_strong_downtrend_v5() {
        let series: Vec<TimeSeriesPoint> = (0..10)
            .map(|i| TimeSeriesPoint { block: i, value: (10 - i as u128) * 1000 })
            .collect();
        let result = trend_analysis(&series).unwrap();
        assert_eq!(result.direction, TrendDirection::Down);
    }

    #[test]
    fn tvl_composition_three_pools_one_dominant_v5() {
        let pools = vec![
            make_pool(1, 9000, 0, 0, 0),
            make_pool(2, 500, 0, 0, 0),
            make_pool(3, 500, 0, 0, 0),
        ];
        let comp = tvl_composition(&pools);
        assert_eq!(comp[0].1, 9000); // 90%
        assert_eq!(comp[1].1, 500);  // 5%
        assert_eq!(comp[2].1, 500);  // 5%
    }

    #[test]
    fn fee_apr_one_year_period_v5() {
        // 100 fees on 10000 TVL over 1 year → 100 bps
        let apr = fee_apr(100, 10_000, BLOCKS_PER_YEAR, BLOCKS_PER_YEAR);
        assert_eq!(apr, 100);
    }

    #[test]
    fn fee_apr_half_year_double_v5() {
        // 100 fees on 10000 TVL over half year → 200 bps annualized
        let apr = fee_apr(100, 10_000, BLOCKS_PER_YEAR / 2, BLOCKS_PER_YEAR);
        assert_eq!(apr, 200);
    }

    #[test]
    fn retention_50_percent_v5() {
        // 100 prev users, 80 current, 30 new → 50 returning → 50%
        let rate = user_retention_rate(100, 80, 30);
        assert_eq!(rate, 5000);
    }

    #[test]
    fn retention_100_percent_no_new_v5() {
        // 100 prev, 100 current, 0 new → all returning
        let rate = user_retention_rate(100, 100, 0);
        assert_eq!(rate, 10_000);
    }

    #[test]
    fn leaderboard_three_users_sorted_v5() {
        let users = vec![
            make_user(1, 100, 10),
            make_user(2, 300, 30),
            make_user(3, 200, 20),
        ];
        let lb = leaderboard(&users, 3);
        assert_eq!(lb.len(), 3);
        assert_eq!(lb[0].rank, 1);
        assert_eq!(lb[0].score, 300);
        assert_eq!(lb[1].score, 200);
        assert_eq!(lb[2].score, 100);
    }

    #[test]
    fn concentration_two_pools_80_20_v5() {
        // 80/20 split: HHI = (8000^2 + 2000^2) / 10000 = 6800
        let idx = concentration_index(&[80, 20]);
        assert_eq!(idx, 6800);
    }

    #[test]
    fn concentration_five_equal_pools_v5() {
        let idx = concentration_index(&[100, 100, 100, 100, 100]);
        assert_eq!(idx, 2000); // 5 * (2000^2/10000) = 2000
    }

    #[test]
    fn volume_tvl_ratio_2x_v5() {
        let ratio = volume_to_tvl_ratio(2 * PRECISION, PRECISION);
        assert_eq!(ratio, 2 * PRECISION);
    }

    #[test]
    fn volume_tvl_ratio_half_v5() {
        let ratio = volume_to_tvl_ratio(PRECISION / 2, PRECISION);
        assert_eq!(ratio, PRECISION / 2);
    }

    #[test]
    fn growth_rate_100_percent_v5() {
        let rate = growth_rate_bps(100, 200);
        assert_eq!(rate, 10_000);
    }

    #[test]
    fn growth_rate_50_percent_decline_v5() {
        let rate = growth_rate_bps(200, 100);
        assert_eq!(rate, -5000);
    }

    #[test]
    fn growth_rate_no_change_v5() {
        let rate = growth_rate_bps(500, 500);
        assert_eq!(rate, 0);
    }

    #[test]
    fn protocol_health_rising_tvl_and_volume_v5() {
        let tvl_series: Vec<TimeSeriesPoint> = vec![
            TimeSeriesPoint { block: 0, value: 100 },
            TimeSeriesPoint { block: 1, value: 200 },
            TimeSeriesPoint { block: 2, value: 300 },
        ];
        let vol_series = tvl_series.clone();
        let health = protocol_health(&tvl_series, &vol_series, 100, 150, &[5000], 6000).unwrap();
        assert_eq!(health.tvl_trend, TrendDirection::Up);
        assert_eq!(health.volume_trend, TrendDirection::Up);
    }

    #[test]
    fn analytics_error_variants_distinct_v5() {
        let variants: Vec<AnalyticsError> = vec![
            AnalyticsError::InsufficientData,
            AnalyticsError::InvalidTimeRange,
            AnalyticsError::DivisionByZero,
            AnalyticsError::NoPoolsFound,
        ];
        for i in 0..variants.len() {
            for j in (i + 1)..variants.len() {
                assert_ne!(variants[i], variants[j]);
            }
        }
    }

    #[test]
    fn sort_by_variants_distinct_v5() {
        assert_ne!(SortBy::Tvl, SortBy::Volume);
        assert_ne!(SortBy::Volume, SortBy::FeeApr);
        assert_ne!(SortBy::FeeApr, SortBy::TradeCount);
    }

    #[test]
    fn trend_direction_debug_clone_v5() {
        let up = TrendDirection::Up;
        let down = TrendDirection::Down;
        let flat = TrendDirection::Flat;
        assert_eq!(up.clone(), TrendDirection::Up);
        assert_ne!(up, down);
        assert_ne!(down, flat);
        assert_eq!(format!("{:?}", flat), "Flat");
    }

    #[test]
    fn protocol_metrics_preserves_revenue_v5() {
        let pools = vec![make_pool(1, 100, 50, 10, 5)];
        let m = protocol_metrics(&pools, 999_999, 10, 100);
        assert_eq!(m.protocol_revenue, 999_999);
    }

    #[test]
    fn volume_ma_large_volumes_saturate_v5() {
        let snaps = vec![
            VolumeSnapshot { block: 1, volume: u128::MAX / 2 },
            VolumeSnapshot { block: 2, volume: u128::MAX / 2 },
        ];
        // Should not panic due to saturating_add
        let avg = volume_moving_average(&snaps, 10).unwrap();
        assert!(avg > 0);
    }

    #[test]
    fn tvl_composition_sum_near_10000_v5() {
        let pools = vec![
            make_pool(1, 333, 0, 0, 0),
            make_pool(2, 333, 0, 0, 0),
            make_pool(3, 334, 0, 0, 0),
        ];
        let comp = tvl_composition(&pools);
        let sum: u16 = comp.iter().map(|(_, bps)| bps).sum();
        assert!(sum >= 9999 && sum <= 10000);
    }
}
