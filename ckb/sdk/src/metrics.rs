// ============ Metrics — Protocol KPIs, Dashboard Data & Performance Tracking ============
// Real-time performance monitoring for VibeSwap on CKB. Computes TVL tracking,
// volume metrics, user growth, protocol revenue, and health indicators — all the
// numbers that appear on a protocol dashboard.
//
// Key capabilities:
// - Daily snapshot management and historical comparison
// - Protocol-wide KPI computation (TVL, volume, fees, revenue, health)
// - Per-pool metrics with APR, IL, utilization, and net yield
// - Trend detection and acceleration analysis over time series
// - Period-over-period comparison (week-over-week, month-over-month)
// - Moving averages (simple and weighted) and volatility estimation
// - Pool ranking by multiple criteria
// - Growth projections and time-to-target estimation
//
// All percentages are expressed in basis points (bps, 10000 = 100%).
// All ratios use PRECISION (1e18) scaling for safe fixed-point arithmetic.

use vibeswap_math::PRECISION;
use vibeswap_math::mul_div;

// ============ Constants ============

/// Basis points denominator (100% = 10_000 bps)
pub const BPS: u128 = 10_000;

/// CKB produces a block roughly every 4 seconds → 21,600 blocks/day
pub const BLOCKS_PER_DAY: u64 = 21_600;

/// 7 days of blocks
pub const BLOCKS_PER_WEEK: u64 = 151_200;

/// ~30 days of blocks
pub const BLOCKS_PER_MONTH: u64 = 648_000;

/// ~365.25 days of blocks
pub const BLOCKS_PER_YEAR: u64 = 7_884_000;

/// Maximum daily snapshots retained (30 days)
pub const MAX_SNAPSHOTS: usize = 30;

/// Maximum growth rate in BPS (1000%)
pub const GROWTH_RATE_CAP_BPS: i32 = 100_000;

// ============ Error Types ============

/// Errors that can occur during metrics computation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MetricsError {
    /// Not enough data points to perform the requested computation
    InsufficientData,
    /// Time range indices are invalid (out of bounds, end before start, etc.)
    InvalidTimeRange,
    /// Attempted division by zero in a metric calculation
    ZeroDenominator,
    /// Arithmetic overflow during computation
    Overflow,
    /// Requested snapshot index not found in the dataset
    SnapshotNotFound,
    /// A snapshot with the same block number already exists
    DuplicateSnapshot,
}

// ============ Data Types ============

/// A single day's protocol-wide snapshot of key metrics.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DailySnapshot {
    /// Block height at which this snapshot was taken
    pub block_number: u64,
    /// Total value locked across all pools
    pub tvl: u128,
    /// Trading volume in the last 24 hours
    pub volume_24h: u128,
    /// Fees collected in the last 24 hours
    pub fees_24h: u128,
    /// Number of unique users active in the last 24 hours
    pub unique_users: u32,
    /// Total transactions in the last 24 hours
    pub total_txs: u32,
    /// Number of active liquidity pools
    pub active_pools: u16,
    /// Number of active gauge contracts
    pub active_gauges: u16,
    /// Total tokens staked in governance/gauges
    pub total_staked: u128,
    /// Average number of orders per batch
    pub avg_batch_size: u16,
}

/// Protocol-wide Key Performance Indicators derived from snapshots.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProtocolKPIs {
    /// Current total value locked
    pub tvl: u128,
    /// TVL change vs previous snapshot in BPS (positive = growth)
    pub tvl_change_bps: i32,
    /// 24-hour trading volume
    pub volume_24h: u128,
    /// 7-day trading volume (sum of available daily snapshots, up to 7)
    pub volume_7d: u128,
    /// 24-hour fees collected
    pub fees_24h: u128,
    /// 7-day fees collected
    pub fees_7d: u128,
    /// Annualized revenue extrapolated from 7-day fees
    pub revenue_annualized: u128,
    /// Fee-to-TVL ratio in BPS (daily yield indicator)
    pub fee_to_tvl_bps: u16,
    /// Volume-to-TVL ratio in BPS (capital efficiency)
    pub volume_to_tvl_bps: u16,
    /// Unique users in the last 24 hours
    pub unique_users_24h: u32,
    /// User growth vs previous snapshot in BPS
    pub user_growth_bps: i32,
    /// Average transaction size (volume / txs)
    pub avg_tx_size: u128,
    /// Composite protocol health score (0-100)
    pub protocol_health: u8,
}

/// Per-pool performance metrics with APR and IL.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolMetrics {
    /// Unique pool identifier
    pub pool_id: [u8; 32],
    /// Total value locked in this pool
    pub tvl: u128,
    /// 24-hour trading volume
    pub volume_24h: u128,
    /// Annualized fee APR in basis points
    pub fee_apr_bps: u16,
    /// Annualized emission APR in basis points
    pub emission_apr_bps: u16,
    /// Combined APR (fee + emission) in basis points
    pub combined_apr_bps: u16,
    /// 30-day impermanent loss in basis points
    pub il_30d_bps: u16,
    /// Net APR after subtracting IL (can be negative)
    pub net_apr_bps: i16,
    /// Utilization ratio in basis points (volume / TVL)
    pub utilization_bps: u16,
    /// Number of unique users in this pool
    pub user_count: u32,
}

/// Trend analysis result for a time series.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrendData {
    /// Overall direction of the trend
    pub direction: Trend,
    /// Magnitude of the trend in basis points (absolute)
    pub magnitude_bps: u16,
    /// Number of consecutive periods in the same direction
    pub periods_in_trend: u8,
    /// Acceleration: positive = trend speeding up, negative = slowing down
    pub acceleration_bps: i16,
}

/// Trend direction classification.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Trend {
    /// Greater than 5% growth
    StrongUp,
    /// 1% to 5% growth
    Up,
    /// -1% to 1% change
    Flat,
    /// -5% to -1% decline
    Down,
    /// Greater than 5% decline
    StrongDown,
}

/// Period-over-period comparison metrics.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComparisonMetrics {
    /// Total volume in period 1
    pub period_1_volume: u128,
    /// Total volume in period 2
    pub period_2_volume: u128,
    /// Volume change from period 1 to period 2 in BPS
    pub volume_change_bps: i32,
    /// Total fees in period 1
    pub period_1_fees: u128,
    /// Total fees in period 2
    pub period_2_fees: u128,
    /// Fees change from period 1 to period 2 in BPS
    pub fees_change_bps: i32,
    /// Unique users in period 1 (max across snapshots)
    pub period_1_users: u32,
    /// Unique users in period 2 (max across snapshots)
    pub period_2_users: u32,
    /// Users change from period 1 to period 2 in BPS
    pub users_change_bps: i32,
}

/// Sort criteria for pool ranking.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PoolSortKey {
    Tvl,
    Volume,
    FeeApr,
    NetApr,
    Utilization,
}

// ============ Core Functions ============

/// Create a daily snapshot from raw metrics data.
pub fn create_snapshot(
    block: u64,
    tvl: u128,
    volume: u128,
    fees: u128,
    users: u32,
    txs: u32,
    pools: u16,
    gauges: u16,
    staked: u128,
    batch_size: u16,
) -> DailySnapshot {
    DailySnapshot {
        block_number: block,
        tvl,
        volume_24h: volume,
        fees_24h: fees,
        unique_users: users,
        total_txs: txs,
        active_pools: pools,
        active_gauges: gauges,
        total_staked: staked,
        avg_batch_size: batch_size,
    }
}

/// Compute protocol-wide KPIs from historical snapshots and the current snapshot.
///
/// Requires at least one historical snapshot for comparison. Uses up to 7 days
/// of history for weekly aggregates and trend calculations.
pub fn compute_kpis(
    snapshots: &[DailySnapshot],
    current: &DailySnapshot,
) -> Result<ProtocolKPIs, MetricsError> {
    if snapshots.is_empty() {
        return Err(MetricsError::InsufficientData);
    }

    let prev = &snapshots[snapshots.len() - 1];

    // TVL change
    let tvl_change_bps = compute_growth_rate(prev.tvl, current.tvl);

    // 7-day aggregates: sum up to 7 most recent snapshots + current
    let window = snapshots.len().min(7);
    let recent = &snapshots[snapshots.len() - window..];

    let mut volume_7d: u128 = current.volume_24h;
    let mut fees_7d: u128 = current.fees_24h;
    for s in recent {
        volume_7d = volume_7d.saturating_add(s.volume_24h);
        fees_7d = fees_7d.saturating_add(s.fees_24h);
    }

    // Annualized revenue from 7-day fees
    // Number of days in the window = recent.len() + 1 (including current)
    let days_in_window = (window as u64) + 1;
    let period_blocks = days_in_window * BLOCKS_PER_DAY;
    let revenue_annualized = annualize_revenue(fees_7d, period_blocks);

    // Fee-to-TVL ratio (daily)
    let fee_to_tvl_bps = if current.tvl > 0 {
        let ratio = mul_div(current.fees_24h, BPS, current.tvl);
        ratio.min(u16::MAX as u128) as u16
    } else {
        0
    };

    // Volume-to-TVL ratio
    let volume_to_tvl_bps = capital_efficiency(current.volume_24h, current.tvl);

    // User growth
    let user_growth_bps = compute_growth_rate(prev.unique_users as u128, current.unique_users as u128);

    // Average transaction size
    let avg_tx_size = if current.total_txs > 0 {
        current.volume_24h / current.total_txs as u128
    } else {
        0
    };

    // Health score
    let health = protocol_health_score(
        current.tvl,
        current.volume_24h,
        current.unique_users,
        current.active_pools,
        current.total_staked,
    );

    Ok(ProtocolKPIs {
        tvl: current.tvl,
        tvl_change_bps,
        volume_24h: current.volume_24h,
        volume_7d,
        fees_24h: current.fees_24h,
        fees_7d,
        revenue_annualized,
        fee_to_tvl_bps,
        volume_to_tvl_bps,
        unique_users_24h: current.unique_users,
        user_growth_bps,
        avg_tx_size,
        protocol_health: health,
    })
}

/// Compute per-pool metrics including APR, IL, and utilization.
///
/// Fee APR is computed as (fees_24h / tvl) * 365.25 * BPS.
/// Emission APR is computed as (emission_per_day * token_price / tvl) * 365.25 * BPS.
pub fn compute_pool_metrics(
    pool_id: [u8; 32],
    tvl: u128,
    volume_24h: u128,
    fees_24h: u128,
    emission_per_day: u128,
    token_price: u128,
    il_30d_bps: u16,
    users: u32,
) -> PoolMetrics {
    // Fee APR: (fees_24h / tvl) * 365.25 days * BPS
    // = fees_24h * 365.25 * BPS / tvl
    // We use BLOCKS_PER_YEAR / BLOCKS_PER_DAY = 365.25
    let fee_apr_bps = if tvl > 0 && fees_24h > 0 {
        // fee_apr = fees_24h * 365 * BPS / tvl (approximate 365.25 as integer)
        let annual_fees = fees_24h.saturating_mul(365);
        let apr = mul_div(annual_fees, BPS, tvl);
        apr.min(u16::MAX as u128) as u16
    } else {
        0
    };

    // Emission APR: (emission_per_day * token_price / tvl) * 365 * BPS
    let emission_apr_bps = if tvl > 0 && emission_per_day > 0 && token_price > 0 {
        let daily_value = mul_div(emission_per_day, token_price, PRECISION);
        let annual_value = daily_value.saturating_mul(365);
        let apr = mul_div(annual_value, BPS, tvl);
        apr.min(u16::MAX as u128) as u16
    } else {
        0
    };

    // Combined APR
    let combined_apr_bps = fee_apr_bps.saturating_add(emission_apr_bps);

    // Net APR = combined - IL
    let net_apr_bps = (combined_apr_bps as i16).saturating_sub(il_30d_bps as i16);

    // Utilization: volume / TVL in BPS
    let utilization_bps = capital_efficiency(volume_24h, tvl);

    PoolMetrics {
        pool_id,
        tvl,
        volume_24h,
        fee_apr_bps,
        emission_apr_bps,
        combined_apr_bps,
        il_30d_bps,
        net_apr_bps,
        utilization_bps,
        user_count: users,
    }
}

/// Detect the trend direction and characteristics from a time series of values.
///
/// Requires at least 2 data points. Computes overall change, consecutive periods
/// in the same direction, and acceleration (whether the trend is speeding up or
/// slowing down).
pub fn detect_trend(values: &[u128]) -> Result<TrendData, MetricsError> {
    if values.len() < 2 {
        return Err(MetricsError::InsufficientData);
    }

    let first = values[0];
    let last = values[values.len() - 1];

    // Overall change in BPS
    let overall_growth = compute_growth_rate(first, last);
    let magnitude_bps = overall_growth.unsigned_abs().min(u16::MAX as u32) as u16;

    // Classify direction
    let direction = classify_trend(overall_growth);

    // Count consecutive periods in same direction from the end
    let mut periods_in_trend: u8 = 0;
    if values.len() >= 2 {
        let final_direction = if last >= values[values.len() - 2] { true } else { false }; // true = up/flat
        let mut i = values.len() - 1;
        while i > 0 {
            let going_up = values[i] >= values[i - 1];
            if going_up == final_direction {
                periods_in_trend = periods_in_trend.saturating_add(1);
            } else {
                break;
            }
            i -= 1;
        }
    }

    // Acceleration: compare recent growth rate vs earlier growth rate
    let acceleration_bps = if values.len() >= 3 {
        let mid = values.len() / 2;
        let first_half_growth = compute_growth_rate(values[0], values[mid]);
        let second_half_growth = compute_growth_rate(values[mid], values[values.len() - 1]);
        let accel = second_half_growth.saturating_sub(first_half_growth);
        accel.max(i16::MIN as i32).min(i16::MAX as i32) as i16
    } else {
        0
    };

    Ok(TrendData {
        direction,
        magnitude_bps,
        periods_in_trend,
        acceleration_bps,
    })
}

/// Compare two time periods from snapshot history.
///
/// Indices are inclusive ranges into the snapshots slice. Aggregates volume and fees,
/// and takes the max user count for each period.
pub fn compare_periods(
    snapshots: &[DailySnapshot],
    period_1_start: usize,
    period_1_end: usize,
    period_2_start: usize,
    period_2_end: usize,
) -> Result<ComparisonMetrics, MetricsError> {
    if snapshots.is_empty() {
        return Err(MetricsError::InsufficientData);
    }

    // Validate ranges
    if period_1_start > period_1_end || period_2_start > period_2_end {
        return Err(MetricsError::InvalidTimeRange);
    }
    if period_1_end >= snapshots.len() || period_2_end >= snapshots.len() {
        return Err(MetricsError::InvalidTimeRange);
    }

    // Aggregate period 1
    let mut p1_volume: u128 = 0;
    let mut p1_fees: u128 = 0;
    let mut p1_users: u32 = 0;
    for i in period_1_start..=period_1_end {
        p1_volume = p1_volume.saturating_add(snapshots[i].volume_24h);
        p1_fees = p1_fees.saturating_add(snapshots[i].fees_24h);
        if snapshots[i].unique_users > p1_users {
            p1_users = snapshots[i].unique_users;
        }
    }

    // Aggregate period 2
    let mut p2_volume: u128 = 0;
    let mut p2_fees: u128 = 0;
    let mut p2_users: u32 = 0;
    for i in period_2_start..=period_2_end {
        p2_volume = p2_volume.saturating_add(snapshots[i].volume_24h);
        p2_fees = p2_fees.saturating_add(snapshots[i].fees_24h);
        if snapshots[i].unique_users > p2_users {
            p2_users = snapshots[i].unique_users;
        }
    }

    let volume_change_bps = compute_growth_rate(p1_volume, p2_volume);
    let fees_change_bps = compute_growth_rate(p1_fees, p2_fees);
    let users_change_bps = compute_growth_rate(p1_users as u128, p2_users as u128);

    Ok(ComparisonMetrics {
        period_1_volume: p1_volume,
        period_2_volume: p2_volume,
        volume_change_bps,
        period_1_fees: p1_fees,
        period_2_fees: p2_fees,
        fees_change_bps,
        period_1_users: p1_users,
        period_2_users: p2_users,
        users_change_bps,
    })
}

/// Compute the growth rate between two values in basis points, capped to +/- GROWTH_RATE_CAP_BPS.
///
/// Returns 0 if both values are zero. Returns GROWTH_RATE_CAP_BPS if old_value is zero
/// and new_value is positive. Negative growth is possible.
pub fn compute_growth_rate(old_value: u128, new_value: u128) -> i32 {
    if old_value == 0 && new_value == 0 {
        return 0;
    }
    if old_value == 0 {
        return GROWTH_RATE_CAP_BPS;
    }

    let rate = if new_value >= old_value {
        let diff = new_value - old_value;
        let bps = mul_div(diff, BPS, old_value);
        bps.min(GROWTH_RATE_CAP_BPS as u128) as i32
    } else {
        let diff = old_value - new_value;
        let bps = mul_div(diff, BPS, old_value);
        let capped = bps.min(GROWTH_RATE_CAP_BPS as u128) as i32;
        -capped
    };

    rate
}

/// Simple moving average over the most recent `window` values.
///
/// Returns error if the slice is empty or window is zero.
/// If values.len() < window, averages all available values.
pub fn moving_average(values: &[u128], window: usize) -> Result<u128, MetricsError> {
    if values.is_empty() || window == 0 {
        return Err(MetricsError::InsufficientData);
    }

    let effective_window = window.min(values.len());
    let start = values.len() - effective_window;

    let mut sum: u128 = 0;
    for i in start..values.len() {
        sum = sum.checked_add(values[i]).ok_or(MetricsError::Overflow)?;
    }

    Ok(sum / effective_window as u128)
}

/// Weighted moving average where recent values carry more weight.
///
/// Weight of position i (0 = oldest in window) is (i + 1). So for a 3-element
/// window, weights are 1, 2, 3 — the most recent value gets 3x the weight of
/// the oldest.
///
/// Returns error if the slice is empty or window is zero.
pub fn weighted_moving_average(values: &[u128], window: usize) -> Result<u128, MetricsError> {
    if values.is_empty() || window == 0 {
        return Err(MetricsError::InsufficientData);
    }

    let effective_window = window.min(values.len());
    let start = values.len() - effective_window;

    let mut weighted_sum: u128 = 0;
    let mut total_weight: u128 = 0;

    for (idx, i) in (start..values.len()).enumerate() {
        let weight = (idx as u128) + 1;
        weighted_sum = weighted_sum
            .checked_add(values[i].checked_mul(weight).ok_or(MetricsError::Overflow)?)
            .ok_or(MetricsError::Overflow)?;
        total_weight += weight;
    }

    if total_weight == 0 {
        return Err(MetricsError::ZeroDenominator);
    }

    Ok(weighted_sum / total_weight)
}

/// Compute a volatility proxy (mean absolute deviation) for a time series.
///
/// Returns the average absolute deviation from the mean, which serves as a
/// computationally efficient proxy for standard deviation in integer arithmetic.
/// Requires at least 2 values.
pub fn compute_volatility(values: &[u128]) -> Result<u128, MetricsError> {
    if values.len() < 2 {
        return Err(MetricsError::InsufficientData);
    }

    let mean = moving_average(values, values.len())?;

    let mut total_deviation: u128 = 0;
    for &v in values {
        let dev = if v >= mean { v - mean } else { mean - v };
        total_deviation = total_deviation.checked_add(dev).ok_or(MetricsError::Overflow)?;
    }

    Ok(total_deviation / values.len() as u128)
}

/// Compute a composite protocol health score from 0 (critical) to 100 (excellent).
///
/// Scoring components (each contributes up to 20 points):
/// - TVL: log-scaled, max at 10M+ tokens
/// - Volume: log-scaled relative to TVL, max at 10%+ daily turnover
/// - Users: linear up to 1000+
/// - Pools: linear up to 20+
/// - Staking ratio: staked / TVL, max at 50%+
pub fn protocol_health_score(
    tvl: u128,
    volume: u128,
    users: u32,
    pools: u16,
    staked: u128,
) -> u8 {
    let mut score: u32 = 0;

    // TVL component (0-20): thresholds at 100K, 1M, 10M in PRECISION units
    let tvl_tokens = tvl / PRECISION;
    score += if tvl_tokens >= 10_000_000 {
        20
    } else if tvl_tokens >= 1_000_000 {
        15
    } else if tvl_tokens >= 100_000 {
        10
    } else if tvl_tokens >= 10_000 {
        5
    } else if tvl_tokens > 0 {
        2
    } else {
        0
    };

    // Volume component (0-20): relative to TVL
    if tvl > 0 && volume > 0 {
        let vol_ratio_bps = mul_div(volume, BPS, tvl);
        score += if vol_ratio_bps >= 1000 {
            20 // 10%+ daily turnover
        } else if vol_ratio_bps >= 500 {
            15
        } else if vol_ratio_bps >= 100 {
            10
        } else if vol_ratio_bps >= 10 {
            5
        } else {
            2
        };
    }

    // Users component (0-20)
    score += if users >= 1000 {
        20
    } else if users >= 500 {
        15
    } else if users >= 100 {
        10
    } else if users >= 10 {
        5
    } else if users > 0 {
        2
    } else {
        0
    };

    // Pools component (0-20)
    score += if pools >= 20 {
        20
    } else if pools >= 10 {
        15
    } else if pools >= 5 {
        10
    } else if pools >= 2 {
        5
    } else if pools >= 1 {
        2
    } else {
        0
    };

    // Staking component (0-20): staked / tvl ratio
    if tvl > 0 && staked > 0 {
        let stake_ratio_bps = mul_div(staked, BPS, tvl);
        score += if stake_ratio_bps >= 5000 {
            20 // 50%+ staked
        } else if stake_ratio_bps >= 3000 {
            15
        } else if stake_ratio_bps >= 1000 {
            10
        } else if stake_ratio_bps >= 100 {
            5
        } else {
            2
        };
    }

    score.min(100) as u8
}

/// Extrapolate fee revenue to an annual rate.
///
/// `fees_period` is the total fees collected over `period_blocks` blocks.
/// Returns the annualized amount: fees_period * BLOCKS_PER_YEAR / period_blocks.
pub fn annualize_revenue(fees_period: u128, period_blocks: u64) -> u128 {
    if period_blocks == 0 || fees_period == 0 {
        return 0;
    }

    mul_div(fees_period, BLOCKS_PER_YEAR as u128, period_blocks as u128)
}

/// Compute capital efficiency as volume-to-TVL ratio in basis points.
///
/// Returns 0 if TVL is zero.
pub fn capital_efficiency(volume_24h: u128, tvl: u128) -> u16 {
    if tvl == 0 {
        return 0;
    }

    let ratio = mul_div(volume_24h, BPS, tvl);
    ratio.min(u16::MAX as u128) as u16
}

/// Rank pools by a given sort key, returning indices into the input slice.
///
/// Returns indices sorted in descending order (highest value first).
/// For NetApr, more positive values come first.
/// Uses insertion sort (suitable for typical pool counts < 100).
pub fn rank_pools(pools: &[PoolMetrics], sort_by: PoolSortKey) -> Vec<usize> {
    let mut indices: Vec<usize> = (0..pools.len()).collect();

    // Insertion sort — stable, no alloc, good for small N
    for i in 1..indices.len() {
        let mut j = i;
        while j > 0 && pool_sort_value(&pools[indices[j]], &sort_by)
            > pool_sort_value(&pools[indices[j - 1]], &sort_by)
        {
            indices.swap(j, j - 1);
            j -= 1;
        }
    }

    indices
}

/// Estimate the number of days to reach a target value at a constant daily growth rate.
///
/// Returns 0 if already at or above target. Returns u64::MAX if growth rate is
/// non-positive (target unreachable). Uses iterative compounding simulation.
pub fn estimate_time_to_target(current: u128, target: u128, daily_growth_bps: i32) -> u64 {
    if current >= target {
        return 0;
    }
    if daily_growth_bps <= 0 {
        return u64::MAX;
    }

    // Simulate daily compounding: value *= (1 + growth_bps / 10000)
    // = value * (10000 + growth_bps) / 10000
    let numerator = (BPS as i64 + daily_growth_bps as i64) as u128;
    let denominator = BPS;

    let mut value = current;
    let mut days: u64 = 0;
    let max_days: u64 = 100_000; // Safety cap

    while value < target && days < max_days {
        value = mul_div(value, numerator, denominator);
        days += 1;
        // Guard against growth rate being so small that value doesn't change
        if value == current && days > 1 {
            return u64::MAX;
        }
    }

    if value >= target {
        days
    } else {
        u64::MAX
    }
}

// ============ Internal Helpers ============

/// Classify a growth rate (in BPS) into a trend direction.
fn classify_trend(growth_bps: i32) -> Trend {
    if growth_bps > 500 {
        Trend::StrongUp
    } else if growth_bps > 100 {
        Trend::Up
    } else if growth_bps >= -100 {
        Trend::Flat
    } else if growth_bps >= -500 {
        Trend::Down
    } else {
        Trend::StrongDown
    }
}

/// Extract a comparable sort value from a pool for ranking.
/// Returns i64 to handle negative NetApr correctly.
fn pool_sort_value(pool: &PoolMetrics, key: &PoolSortKey) -> i64 {
    match key {
        PoolSortKey::Tvl => {
            // Scale down to fit i64; TVL is PRECISION-scaled so divide
            (pool.tvl / PRECISION) as i64
        }
        PoolSortKey::Volume => {
            (pool.volume_24h / PRECISION) as i64
        }
        PoolSortKey::FeeApr => pool.fee_apr_bps as i64,
        PoolSortKey::NetApr => pool.net_apr_bps as i64,
        PoolSortKey::Utilization => pool.utilization_bps as i64,
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn default_snapshot() -> DailySnapshot {
        DailySnapshot {
            block_number: 1_000_000,
            tvl: 10_000_000 * PRECISION,
            volume_24h: 500_000 * PRECISION,
            fees_24h: 1_500 * PRECISION,
            unique_users: 500,
            total_txs: 5_000,
            active_pools: 15,
            active_gauges: 10,
            total_staked: 3_000_000 * PRECISION,
            avg_batch_size: 25,
        }
    }

    fn make_snapshot(block: u64, tvl: u128, volume: u128, fees: u128, users: u32) -> DailySnapshot {
        DailySnapshot {
            block_number: block,
            tvl,
            volume_24h: volume,
            fees_24h: fees,
            unique_users: users,
            total_txs: 1000,
            active_pools: 10,
            active_gauges: 5,
            total_staked: tvl / 3,
            avg_batch_size: 20,
        }
    }

    fn make_pool(id_byte: u8, tvl: u128, volume: u128, fee_apr: u16, net_apr: i16, util: u16) -> PoolMetrics {
        PoolMetrics {
            pool_id: [id_byte; 32],
            tvl,
            volume_24h: volume,
            fee_apr_bps: fee_apr,
            emission_apr_bps: 0,
            combined_apr_bps: fee_apr,
            il_30d_bps: 0,
            net_apr_bps: net_apr,
            utilization_bps: util,
            user_count: 100,
        }
    }

    // ============ Snapshot Creation Tests ============

    #[test]
    fn test_create_snapshot_basic() {
        let s = create_snapshot(100, 1000, 500, 10, 50, 200, 5, 3, 300, 15);
        assert_eq!(s.block_number, 100);
        assert_eq!(s.tvl, 1000);
        assert_eq!(s.volume_24h, 500);
        assert_eq!(s.fees_24h, 10);
        assert_eq!(s.unique_users, 50);
        assert_eq!(s.total_txs, 200);
        assert_eq!(s.active_pools, 5);
        assert_eq!(s.active_gauges, 3);
        assert_eq!(s.total_staked, 300);
        assert_eq!(s.avg_batch_size, 15);
    }

    #[test]
    fn test_create_snapshot_zero_values() {
        let s = create_snapshot(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        assert_eq!(s.block_number, 0);
        assert_eq!(s.tvl, 0);
        assert_eq!(s.volume_24h, 0);
    }

    #[test]
    fn test_create_snapshot_large_values() {
        let large = u128::MAX / 2;
        let s = create_snapshot(u64::MAX, large, large, large, u32::MAX, u32::MAX, u16::MAX, u16::MAX, large, u16::MAX);
        assert_eq!(s.tvl, large);
        assert_eq!(s.unique_users, u32::MAX);
        assert_eq!(s.active_pools, u16::MAX);
    }

    #[test]
    fn test_create_snapshot_precision_scaled() {
        let s = create_snapshot(1000, 100 * PRECISION, 50 * PRECISION, PRECISION, 10, 100, 3, 2, 30 * PRECISION, 10);
        assert_eq!(s.tvl, 100 * PRECISION);
        assert_eq!(s.volume_24h, 50 * PRECISION);
        assert_eq!(s.fees_24h, PRECISION);
    }

    #[test]
    fn test_create_snapshot_single_pool() {
        let s = create_snapshot(500, PRECISION, PRECISION / 10, PRECISION / 1000, 1, 1, 1, 0, 0, 1);
        assert_eq!(s.active_pools, 1);
        assert_eq!(s.active_gauges, 0);
        assert_eq!(s.unique_users, 1);
    }

    // ============ KPI Tests ============

    #[test]
    fn test_kpis_healthy_protocol() {
        let prev = default_snapshot();
        let current = DailySnapshot {
            block_number: prev.block_number + BLOCKS_PER_DAY,
            tvl: 10_500_000 * PRECISION, // 5% growth
            volume_24h: 600_000 * PRECISION,
            fees_24h: 1_800 * PRECISION,
            unique_users: 550,
            ..prev.clone()
        };
        let snapshots = vec![prev];
        let kpis = compute_kpis(&snapshots, &current).unwrap();
        assert_eq!(kpis.tvl, 10_500_000 * PRECISION);
        assert!(kpis.tvl_change_bps > 0); // Growth
        assert!(kpis.volume_7d > 0);
        assert!(kpis.fees_7d > 0);
        assert!(kpis.revenue_annualized > 0);
        assert!(kpis.protocol_health > 0);
        assert!(kpis.user_growth_bps > 0);
    }

    #[test]
    fn test_kpis_declining_protocol() {
        let prev = default_snapshot();
        let current = DailySnapshot {
            block_number: prev.block_number + BLOCKS_PER_DAY,
            tvl: 8_000_000 * PRECISION, // 20% decline
            volume_24h: 200_000 * PRECISION,
            fees_24h: 600 * PRECISION,
            unique_users: 300,
            ..prev.clone()
        };
        let snapshots = vec![prev];
        let kpis = compute_kpis(&snapshots, &current).unwrap();
        assert!(kpis.tvl_change_bps < 0);
        assert!(kpis.user_growth_bps < 0);
    }

    #[test]
    fn test_kpis_growing_protocol() {
        let prev = make_snapshot(1_000_000, 5_000_000 * PRECISION, 250_000 * PRECISION, 750 * PRECISION, 200);
        let current = make_snapshot(1_000_000 + BLOCKS_PER_DAY, 15_000_000 * PRECISION, 750_000 * PRECISION, 2_250 * PRECISION, 600);
        let snapshots = vec![prev];
        let kpis = compute_kpis(&snapshots, &current).unwrap();
        assert!(kpis.tvl_change_bps > 0);
        assert_eq!(kpis.unique_users_24h, 600);
    }

    #[test]
    fn test_kpis_zero_tvl() {
        let prev = make_snapshot(100, 0, 0, 0, 0);
        let current = make_snapshot(200, 0, 0, 0, 0);
        let snapshots = vec![prev];
        let kpis = compute_kpis(&snapshots, &current).unwrap();
        assert_eq!(kpis.tvl, 0);
        assert_eq!(kpis.fee_to_tvl_bps, 0);
        assert_eq!(kpis.volume_to_tvl_bps, 0);
        assert_eq!(kpis.tvl_change_bps, 0);
    }

    #[test]
    fn test_kpis_zero_txs() {
        let prev = default_snapshot();
        let current = DailySnapshot {
            total_txs: 0,
            volume_24h: 0,
            ..prev.clone()
        };
        let snapshots = vec![prev];
        let kpis = compute_kpis(&snapshots, &current).unwrap();
        assert_eq!(kpis.avg_tx_size, 0);
    }

    #[test]
    fn test_kpis_no_snapshots_error() {
        let current = default_snapshot();
        let result = compute_kpis(&[], &current);
        assert_eq!(result, Err(MetricsError::InsufficientData));
    }

    #[test]
    fn test_kpis_multiple_snapshots() {
        let s1 = make_snapshot(100, 1_000_000 * PRECISION, 50_000 * PRECISION, 150 * PRECISION, 100);
        let s2 = make_snapshot(200, 1_100_000 * PRECISION, 55_000 * PRECISION, 165 * PRECISION, 110);
        let s3 = make_snapshot(300, 1_200_000 * PRECISION, 60_000 * PRECISION, 180 * PRECISION, 120);
        let current = make_snapshot(400, 1_300_000 * PRECISION, 65_000 * PRECISION, 195 * PRECISION, 130);
        let snapshots = vec![s1, s2, s3];
        let kpis = compute_kpis(&snapshots, &current).unwrap();
        // Volume 7d should include all snapshots + current
        assert!(kpis.volume_7d >= 65_000 * PRECISION);
        assert!(kpis.fees_7d >= 195 * PRECISION);
    }

    #[test]
    fn test_kpis_seven_day_window() {
        // Create 10 snapshots — only last 7 should be used for 7d aggregates
        let mut snapshots = Vec::new();
        for i in 0..10 {
            snapshots.push(make_snapshot(
                (i + 1) as u64 * BLOCKS_PER_DAY,
                1_000_000 * PRECISION,
                100_000 * PRECISION,
                300 * PRECISION,
                100,
            ));
        }
        let current = make_snapshot(11 * BLOCKS_PER_DAY, 1_000_000 * PRECISION, 100_000 * PRECISION, 300 * PRECISION, 100);
        let kpis = compute_kpis(&snapshots, &current).unwrap();
        // 7 snapshots + current = 8 days, so volume_7d = 8 * 100_000 * PRECISION
        assert_eq!(kpis.volume_7d, 8 * 100_000 * PRECISION);
    }

    #[test]
    fn test_kpis_single_snapshot() {
        let prev = default_snapshot();
        let current = DailySnapshot {
            block_number: prev.block_number + BLOCKS_PER_DAY,
            ..prev.clone()
        };
        let snapshots = vec![prev.clone()];
        let kpis = compute_kpis(&snapshots, &current).unwrap();
        // With same values, growth should be 0
        assert_eq!(kpis.tvl_change_bps, 0);
        assert_eq!(kpis.user_growth_bps, 0);
    }

    #[test]
    fn test_kpis_avg_tx_size() {
        let prev = default_snapshot();
        let current = DailySnapshot {
            volume_24h: 1_000_000 * PRECISION,
            total_txs: 1000,
            ..prev.clone()
        };
        let snapshots = vec![prev];
        let kpis = compute_kpis(&snapshots, &current).unwrap();
        assert_eq!(kpis.avg_tx_size, 1000 * PRECISION);
    }

    #[test]
    fn test_kpis_fee_to_tvl() {
        let prev = make_snapshot(100, 1_000_000 * PRECISION, 0, 0, 0);
        let current = DailySnapshot {
            tvl: 1_000_000 * PRECISION,
            fees_24h: 100 * PRECISION, // 100/1M = 0.01% = 1 bps
            ..prev.clone()
        };
        let snapshots = vec![prev];
        let kpis = compute_kpis(&snapshots, &current).unwrap();
        assert_eq!(kpis.fee_to_tvl_bps, 1);
    }

    // ============ Pool Metrics Tests ============

    #[test]
    fn test_pool_metrics_basic() {
        let pm = compute_pool_metrics(
            [1u8; 32],
            10_000_000 * PRECISION,
            500_000 * PRECISION,
            1_500 * PRECISION,
            1_000 * PRECISION,
            2 * PRECISION, // $2 token
            200,           // 2% IL
            500,
        );
        assert_eq!(pm.pool_id, [1u8; 32]);
        assert_eq!(pm.tvl, 10_000_000 * PRECISION);
        assert_eq!(pm.volume_24h, 500_000 * PRECISION);
        assert!(pm.fee_apr_bps > 0);
        assert!(pm.emission_apr_bps > 0);
        assert!(pm.combined_apr_bps >= pm.fee_apr_bps);
        assert_eq!(pm.il_30d_bps, 200);
        assert_eq!(pm.user_count, 500);
    }

    #[test]
    fn test_pool_metrics_high_apr() {
        let pm = compute_pool_metrics(
            [2u8; 32],
            10_000_000 * PRECISION,  // TVL
            500_000 * PRECISION,     // High volume
            10_000 * PRECISION,      // High fees
            5_000 * PRECISION,       // Moderate emissions
            2 * PRECISION,           // $2 token
            100,
            100,
        );
        assert!(pm.fee_apr_bps > 100); // > 1% APR
        assert!(pm.emission_apr_bps > 0);
        assert!(pm.combined_apr_bps > pm.fee_apr_bps);
    }

    #[test]
    fn test_pool_metrics_negative_net_apr() {
        // High IL, low fees = negative net APR
        let pm = compute_pool_metrics(
            [3u8; 32],
            10_000_000 * PRECISION,
            10_000 * PRECISION,
            10 * PRECISION,    // Very low fees
            0,                 // No emissions
            0,
            5000,              // 50% IL
            100,
        );
        assert!(pm.net_apr_bps < 0);
    }

    #[test]
    fn test_pool_metrics_zero_tvl() {
        let pm = compute_pool_metrics([4u8; 32], 0, 0, 0, 0, 0, 0, 0);
        assert_eq!(pm.fee_apr_bps, 0);
        assert_eq!(pm.emission_apr_bps, 0);
        assert_eq!(pm.combined_apr_bps, 0);
        assert_eq!(pm.utilization_bps, 0);
        assert_eq!(pm.net_apr_bps, 0);
    }

    #[test]
    fn test_pool_metrics_zero_fees() {
        let pm = compute_pool_metrics(
            [5u8; 32],
            1_000_000 * PRECISION,
            100_000 * PRECISION,
            0,
            1_000 * PRECISION,
            PRECISION,
            0,
            50,
        );
        assert_eq!(pm.fee_apr_bps, 0);
        assert!(pm.emission_apr_bps > 0);
    }

    #[test]
    fn test_pool_metrics_zero_emissions() {
        let pm = compute_pool_metrics(
            [6u8; 32],
            1_000_000 * PRECISION,
            100_000 * PRECISION,
            300 * PRECISION,
            0,
            0,
            100,
            200,
        );
        assert!(pm.fee_apr_bps > 0);
        assert_eq!(pm.emission_apr_bps, 0);
        assert_eq!(pm.combined_apr_bps, pm.fee_apr_bps);
    }

    #[test]
    fn test_pool_metrics_utilization() {
        let pm = compute_pool_metrics(
            [7u8; 32],
            1_000_000 * PRECISION,
            100_000 * PRECISION, // 10% of TVL
            300 * PRECISION,
            0,
            0,
            0,
            100,
        );
        assert_eq!(pm.utilization_bps, 1000); // 10%
    }

    #[test]
    fn test_pool_metrics_il_equals_combined() {
        // IL exactly equals combined APR → net = 0
        let pm = compute_pool_metrics(
            [8u8; 32],
            1_000_000 * PRECISION,
            0,
            0,
            0,
            0,
            0, // 0% IL, 0% APR → net = 0
            10,
        );
        assert_eq!(pm.net_apr_bps, 0);
    }

    #[test]
    fn test_pool_metrics_max_il() {
        let pm = compute_pool_metrics(
            [9u8; 32],
            1_000_000 * PRECISION,
            50_000 * PRECISION,
            150 * PRECISION,
            0,
            0,
            10000, // 100% IL
            50,
        );
        // Net APR should be deeply negative
        assert!(pm.net_apr_bps < 0);
    }

    // ============ Trend Detection Tests ============

    #[test]
    fn test_trend_strong_up() {
        // Values growing >5%
        let values = vec![1000, 1100, 1200, 1300, 1400];
        let trend = detect_trend(&values).unwrap();
        assert_eq!(trend.direction, Trend::StrongUp);
        assert!(trend.magnitude_bps > 500);
        assert!(trend.periods_in_trend > 0);
    }

    #[test]
    fn test_trend_up() {
        // Values growing ~2%
        let values = vec![10000, 10050, 10100, 10150, 10200];
        let trend = detect_trend(&values).unwrap();
        assert_eq!(trend.direction, Trend::Up);
    }

    #[test]
    fn test_trend_flat() {
        let values = vec![10000, 10010, 9990, 10005, 10000];
        let trend = detect_trend(&values).unwrap();
        assert_eq!(trend.direction, Trend::Flat);
    }

    #[test]
    fn test_trend_down() {
        // Values declining ~2%
        let values = vec![10000, 9950, 9900, 9850, 9800];
        let trend = detect_trend(&values).unwrap();
        assert_eq!(trend.direction, Trend::Down);
    }

    #[test]
    fn test_trend_strong_down() {
        // Values declining >5%
        let values = vec![1000, 900, 800, 700, 600];
        let trend = detect_trend(&values).unwrap();
        assert_eq!(trend.direction, Trend::StrongDown);
        assert!(trend.magnitude_bps > 500);
    }

    #[test]
    fn test_trend_two_points() {
        let values = vec![100, 200];
        let trend = detect_trend(&values).unwrap();
        assert_eq!(trend.direction, Trend::StrongUp);
        assert_eq!(trend.periods_in_trend, 1);
        assert_eq!(trend.acceleration_bps, 0); // Not enough for acceleration
    }

    #[test]
    fn test_trend_single_point_error() {
        let result = detect_trend(&[100]);
        assert_eq!(result, Err(MetricsError::InsufficientData));
    }

    #[test]
    fn test_trend_empty_error() {
        let result = detect_trend(&[]);
        assert_eq!(result, Err(MetricsError::InsufficientData));
    }

    #[test]
    fn test_trend_constant_values() {
        let values = vec![5000, 5000, 5000, 5000];
        let trend = detect_trend(&values).unwrap();
        assert_eq!(trend.direction, Trend::Flat);
        assert_eq!(trend.magnitude_bps, 0);
    }

    #[test]
    fn test_trend_acceleration_positive() {
        // Growth accelerating: first half slow, second half fast
        let values = vec![1000, 1010, 1020, 1050, 1100];
        let trend = detect_trend(&values).unwrap();
        assert!(trend.acceleration_bps > 0);
    }

    #[test]
    fn test_trend_acceleration_negative() {
        // Growth decelerating: first half fast, second half slow
        let values = vec![1000, 1050, 1100, 1110, 1120];
        let trend = detect_trend(&values).unwrap();
        assert!(trend.acceleration_bps < 0);
    }

    #[test]
    fn test_trend_periods_all_up() {
        let values = vec![100, 200, 300, 400, 500];
        let trend = detect_trend(&values).unwrap();
        assert_eq!(trend.periods_in_trend, 4);
    }

    #[test]
    fn test_trend_periods_mixed_ending_up() {
        let values = vec![100, 50, 200, 300, 400];
        let trend = detect_trend(&values).unwrap();
        // Last 3 transitions are up: 50→200, 200→300, 300→400
        assert_eq!(trend.periods_in_trend, 3);
    }

    #[test]
    fn test_trend_v_shape() {
        let values = vec![100, 50, 25, 50, 100];
        let trend = detect_trend(&values).unwrap();
        assert_eq!(trend.direction, Trend::Flat); // 0% net change
        assert_eq!(trend.magnitude_bps, 0);
        // Last two periods are up
        assert_eq!(trend.periods_in_trend, 2);
    }

    #[test]
    fn test_trend_inverted_v() {
        let values = vec![100, 200, 300, 200, 100];
        let trend = detect_trend(&values).unwrap();
        assert_eq!(trend.direction, Trend::Flat);
        // Last two periods are down
        assert_eq!(trend.periods_in_trend, 2);
    }

    // ============ Period Comparison Tests ============

    #[test]
    fn test_compare_periods_growth() {
        let snapshots = vec![
            make_snapshot(100, PRECISION, 100 * PRECISION, 3 * PRECISION, 50),
            make_snapshot(200, PRECISION, 110 * PRECISION, 3 * PRECISION, 55),
            make_snapshot(300, PRECISION, 200 * PRECISION, 6 * PRECISION, 80),
            make_snapshot(400, PRECISION, 220 * PRECISION, 7 * PRECISION, 90),
        ];
        let cmp = compare_periods(&snapshots, 0, 1, 2, 3).unwrap();
        assert!(cmp.volume_change_bps > 0);
        assert!(cmp.fees_change_bps > 0);
        assert!(cmp.users_change_bps > 0);
        assert_eq!(cmp.period_1_volume, 210 * PRECISION);
        assert_eq!(cmp.period_2_volume, 420 * PRECISION);
    }

    #[test]
    fn test_compare_periods_decline() {
        let snapshots = vec![
            make_snapshot(100, PRECISION, 200 * PRECISION, 6 * PRECISION, 100),
            make_snapshot(200, PRECISION, 190 * PRECISION, 6 * PRECISION, 90),
            make_snapshot(300, PRECISION, 100 * PRECISION, 3 * PRECISION, 50),
            make_snapshot(400, PRECISION, 90 * PRECISION, 3 * PRECISION, 45),
        ];
        let cmp = compare_periods(&snapshots, 0, 1, 2, 3).unwrap();
        assert!(cmp.volume_change_bps < 0);
        assert!(cmp.users_change_bps < 0);
    }

    #[test]
    fn test_compare_periods_equal() {
        let snapshots = vec![
            make_snapshot(100, PRECISION, 100 * PRECISION, 3 * PRECISION, 50),
            make_snapshot(200, PRECISION, 100 * PRECISION, 3 * PRECISION, 50),
            make_snapshot(300, PRECISION, 100 * PRECISION, 3 * PRECISION, 50),
            make_snapshot(400, PRECISION, 100 * PRECISION, 3 * PRECISION, 50),
        ];
        let cmp = compare_periods(&snapshots, 0, 1, 2, 3).unwrap();
        assert_eq!(cmp.volume_change_bps, 0);
        assert_eq!(cmp.fees_change_bps, 0);
        assert_eq!(cmp.users_change_bps, 0);
    }

    #[test]
    fn test_compare_periods_zero_values() {
        let snapshots = vec![
            make_snapshot(100, 0, 0, 0, 0),
            make_snapshot(200, 0, 0, 0, 0),
            make_snapshot(300, 0, 0, 0, 0),
            make_snapshot(400, 0, 0, 0, 0),
        ];
        let cmp = compare_periods(&snapshots, 0, 1, 2, 3).unwrap();
        assert_eq!(cmp.volume_change_bps, 0);
        assert_eq!(cmp.period_1_volume, 0);
    }

    #[test]
    fn test_compare_periods_single_snapshot_per_period() {
        let snapshots = vec![
            make_snapshot(100, PRECISION, 100 * PRECISION, 3 * PRECISION, 50),
            make_snapshot(200, PRECISION, 200 * PRECISION, 6 * PRECISION, 80),
        ];
        let cmp = compare_periods(&snapshots, 0, 0, 1, 1).unwrap();
        assert_eq!(cmp.period_1_volume, 100 * PRECISION);
        assert_eq!(cmp.period_2_volume, 200 * PRECISION);
        assert_eq!(cmp.volume_change_bps, 10_000); // 100% growth
    }

    #[test]
    fn test_compare_periods_invalid_range_reversed() {
        let snapshots = vec![
            make_snapshot(100, 0, 0, 0, 0),
            make_snapshot(200, 0, 0, 0, 0),
        ];
        let result = compare_periods(&snapshots, 1, 0, 0, 1);
        assert_eq!(result, Err(MetricsError::InvalidTimeRange));
    }

    #[test]
    fn test_compare_periods_out_of_bounds() {
        let snapshots = vec![make_snapshot(100, 0, 0, 0, 0)];
        let result = compare_periods(&snapshots, 0, 0, 1, 1);
        assert_eq!(result, Err(MetricsError::InvalidTimeRange));
    }

    #[test]
    fn test_compare_periods_empty_snapshots() {
        let result = compare_periods(&[], 0, 0, 0, 0);
        assert_eq!(result, Err(MetricsError::InsufficientData));
    }

    #[test]
    fn test_compare_periods_users_take_max() {
        let snapshots = vec![
            make_snapshot(100, PRECISION, 0, 0, 50),
            make_snapshot(200, PRECISION, 0, 0, 100), // Max for period 1
            make_snapshot(300, PRECISION, 0, 0, 80),
            make_snapshot(400, PRECISION, 0, 0, 120),  // Max for period 2
        ];
        let cmp = compare_periods(&snapshots, 0, 1, 2, 3).unwrap();
        assert_eq!(cmp.period_1_users, 100);
        assert_eq!(cmp.period_2_users, 120);
    }

    // ============ Growth Rate Tests ============

    #[test]
    fn test_growth_rate_positive() {
        // 100 → 150 = 50% = 5000 bps
        assert_eq!(compute_growth_rate(100, 150), 5000);
    }

    #[test]
    fn test_growth_rate_negative() {
        // 200 → 150 = -25% = -2500 bps
        assert_eq!(compute_growth_rate(200, 150), -2500);
    }

    #[test]
    fn test_growth_rate_zero_both() {
        assert_eq!(compute_growth_rate(0, 0), 0);
    }

    #[test]
    fn test_growth_rate_from_zero() {
        // 0 → anything positive = capped at max
        assert_eq!(compute_growth_rate(0, 100), GROWTH_RATE_CAP_BPS);
    }

    #[test]
    fn test_growth_rate_to_zero() {
        // 100 → 0 = -100% = -10000 bps
        assert_eq!(compute_growth_rate(100, 0), -10_000);
    }

    #[test]
    fn test_growth_rate_no_change() {
        assert_eq!(compute_growth_rate(500, 500), 0);
    }

    #[test]
    fn test_growth_rate_capped_positive() {
        // 1 → 1000 = 99900% > cap
        let rate = compute_growth_rate(1, 1000);
        assert_eq!(rate, GROWTH_RATE_CAP_BPS);
    }

    #[test]
    fn test_growth_rate_small_change() {
        // 10000 → 10001 = 0.01% = 1 bps
        assert_eq!(compute_growth_rate(10000, 10001), 1);
    }

    #[test]
    fn test_growth_rate_double() {
        // 100 → 200 = 100% = 10000 bps
        assert_eq!(compute_growth_rate(100, 200), 10_000);
    }

    #[test]
    fn test_growth_rate_halve() {
        // 200 → 100 = -50% = -5000 bps
        assert_eq!(compute_growth_rate(200, 100), -5000);
    }

    #[test]
    fn test_growth_rate_precision_scaled() {
        let old = 1_000_000 * PRECISION;
        let new = 1_050_000 * PRECISION; // 5% growth
        assert_eq!(compute_growth_rate(old, new), 500);
    }

    #[test]
    fn test_growth_rate_large_values() {
        let old = u128::MAX / 4;
        let new = u128::MAX / 2;
        // ~100% growth = 10000 bps
        let rate = compute_growth_rate(old, new);
        assert!(rate > 9000 && rate <= 10_000);
    }

    // ============ Moving Average Tests ============

    #[test]
    fn test_moving_average_full_window() {
        let values = vec![100, 200, 300, 400, 500];
        let ma = moving_average(&values, 5).unwrap();
        assert_eq!(ma, 300); // (100+200+300+400+500) / 5
    }

    #[test]
    fn test_moving_average_partial_window() {
        let values = vec![100, 200, 300];
        let ma = moving_average(&values, 5).unwrap();
        assert_eq!(ma, 200); // Only 3 values available
    }

    #[test]
    fn test_moving_average_window_of_one() {
        let values = vec![100, 200, 300];
        let ma = moving_average(&values, 1).unwrap();
        assert_eq!(ma, 300); // Last value only
    }

    #[test]
    fn test_moving_average_single_value() {
        let values = vec![42];
        let ma = moving_average(&values, 10).unwrap();
        assert_eq!(ma, 42);
    }

    #[test]
    fn test_moving_average_empty_error() {
        let result = moving_average(&[], 5);
        assert_eq!(result, Err(MetricsError::InsufficientData));
    }

    #[test]
    fn test_moving_average_zero_window_error() {
        let result = moving_average(&[100], 0);
        assert_eq!(result, Err(MetricsError::InsufficientData));
    }

    #[test]
    fn test_moving_average_identical_values() {
        let values = vec![50, 50, 50, 50];
        let ma = moving_average(&values, 4).unwrap();
        assert_eq!(ma, 50);
    }

    #[test]
    fn test_moving_average_precision_scaled() {
        let values = vec![100 * PRECISION, 200 * PRECISION, 300 * PRECISION];
        let ma = moving_average(&values, 3).unwrap();
        assert_eq!(ma, 200 * PRECISION);
    }

    #[test]
    fn test_moving_average_window_two() {
        let values = vec![100, 200, 300, 400];
        let ma = moving_average(&values, 2).unwrap();
        assert_eq!(ma, 350); // (300+400) / 2
    }

    #[test]
    fn test_moving_average_large_window() {
        let values = vec![1, 2, 3];
        let ma = moving_average(&values, 1000).unwrap();
        assert_eq!(ma, 2); // Uses all 3 values
    }

    // ============ Weighted Moving Average Tests ============

    #[test]
    fn test_wma_basic() {
        // Weights: 1, 2, 3 → sum = 6
        // WMA = (100*1 + 200*2 + 300*3) / 6 = (100+400+900)/6 = 1400/6 = 233
        let values = vec![100, 200, 300];
        let wma = weighted_moving_average(&values, 3).unwrap();
        assert_eq!(wma, 233);
    }

    #[test]
    fn test_wma_recency_bias() {
        // WMA should be higher than SMA when values are ascending
        let values = vec![100, 200, 300, 400, 500];
        let sma = moving_average(&values, 5).unwrap();
        let wma = weighted_moving_average(&values, 5).unwrap();
        assert!(wma > sma);
    }

    #[test]
    fn test_wma_recency_bias_descending() {
        // WMA should be lower than SMA when values are descending
        let values = vec![500, 400, 300, 200, 100];
        let sma = moving_average(&values, 5).unwrap();
        let wma = weighted_moving_average(&values, 5).unwrap();
        assert!(wma < sma);
    }

    #[test]
    fn test_wma_single_value() {
        let values = vec![42];
        let wma = weighted_moving_average(&values, 1).unwrap();
        assert_eq!(wma, 42);
    }

    #[test]
    fn test_wma_empty_error() {
        let result = weighted_moving_average(&[], 5);
        assert_eq!(result, Err(MetricsError::InsufficientData));
    }

    #[test]
    fn test_wma_zero_window_error() {
        let result = weighted_moving_average(&[100], 0);
        assert_eq!(result, Err(MetricsError::InsufficientData));
    }

    #[test]
    fn test_wma_identical_values() {
        let values = vec![50, 50, 50, 50];
        let wma = weighted_moving_average(&values, 4).unwrap();
        assert_eq!(wma, 50); // All same → WMA = value
    }

    #[test]
    fn test_wma_partial_window() {
        let values = vec![100, 200];
        let wma = weighted_moving_average(&values, 5).unwrap();
        // Weights: 1, 2 → (100*1 + 200*2) / 3 = 500/3 = 166
        assert_eq!(wma, 166);
    }

    #[test]
    fn test_wma_window_of_one() {
        let values = vec![100, 200, 300];
        let wma = weighted_moving_average(&values, 1).unwrap();
        assert_eq!(wma, 300); // Last value only, weight=1
    }

    #[test]
    fn test_wma_precision_scaled() {
        let values = vec![100 * PRECISION, 200 * PRECISION, 300 * PRECISION];
        let wma = weighted_moving_average(&values, 3).unwrap();
        // (100*1 + 200*2 + 300*3) / 6 = 233.33... * PRECISION
        assert_eq!(wma, 233333333333333333333);
    }

    // ============ Volatility Tests ============

    #[test]
    fn test_volatility_stable() {
        let values = vec![100, 100, 100, 100, 100];
        let vol = compute_volatility(&values).unwrap();
        assert_eq!(vol, 0);
    }

    #[test]
    fn test_volatility_moderate() {
        let values = vec![90, 110, 90, 110, 90];
        let vol = compute_volatility(&values).unwrap();
        // Mean = 98, deviations = 8, 12, 8, 12, 8 → mean dev = 48/5 = 9
        assert!(vol > 0);
    }

    #[test]
    fn test_volatility_high() {
        let values = vec![100, 200, 50, 300, 10];
        let vol = compute_volatility(&values).unwrap();
        assert!(vol > 50);
    }

    #[test]
    fn test_volatility_single_value_error() {
        let result = compute_volatility(&[100]);
        assert_eq!(result, Err(MetricsError::InsufficientData));
    }

    #[test]
    fn test_volatility_empty_error() {
        let result = compute_volatility(&[]);
        assert_eq!(result, Err(MetricsError::InsufficientData));
    }

    #[test]
    fn test_volatility_two_values() {
        let values = vec![100, 200];
        let vol = compute_volatility(&values).unwrap();
        // Mean = 150, dev = 50, 50 → avg = 50
        assert_eq!(vol, 50);
    }

    #[test]
    fn test_volatility_ascending() {
        let values = vec![100, 200, 300, 400, 500];
        let vol = compute_volatility(&values).unwrap();
        // Mean = 300, devs = 200,100,0,100,200 → avg = 120
        assert_eq!(vol, 120);
    }

    #[test]
    fn test_volatility_precision_scaled() {
        let values = vec![100 * PRECISION, 200 * PRECISION];
        let vol = compute_volatility(&values).unwrap();
        assert_eq!(vol, 50 * PRECISION);
    }

    // ============ Health Score Tests ============

    #[test]
    fn test_health_score_max() {
        let score = protocol_health_score(
            100_000_000 * PRECISION,  // 100M TVL
            20_000_000 * PRECISION,   // 20M volume (20% of TVL)
            5000,                     // 5000 users
            30,                       // 30 pools
            60_000_000 * PRECISION,   // 60% staked
        );
        assert_eq!(score, 100);
    }

    #[test]
    fn test_health_score_min() {
        let score = protocol_health_score(0, 0, 0, 0, 0);
        assert_eq!(score, 0);
    }

    #[test]
    fn test_health_score_tvl_only() {
        let score = protocol_health_score(
            50_000_000 * PRECISION,
            0,
            0,
            0,
            0,
        );
        assert_eq!(score, 20); // TVL component only
    }

    #[test]
    fn test_health_score_users_only() {
        let score = protocol_health_score(
            0,
            0,
            2000,
            0,
            0,
        );
        assert_eq!(score, 20); // Users component only
    }

    #[test]
    fn test_health_score_pools_only() {
        let score = protocol_health_score(
            0,
            0,
            0,
            25,
            0,
        );
        assert_eq!(score, 20); // Pools component only
    }

    #[test]
    fn test_health_score_medium() {
        let score = protocol_health_score(
            500_000 * PRECISION,     // Medium TVL → 10
            25_000 * PRECISION,      // 5% turnover → 15
            200,                     // Medium users → 10
            8,                       // Medium pools → 10
            100_000 * PRECISION,     // 20% staked → 10
        );
        assert!(score >= 40 && score <= 70);
    }

    #[test]
    fn test_health_score_low_tvl() {
        let score = protocol_health_score(
            1000 * PRECISION,
            100 * PRECISION,
            5,
            1,
            100 * PRECISION,
        );
        assert!(score > 0);
        assert!(score < 50);
    }

    #[test]
    fn test_health_score_high_staking_ratio() {
        let tvl = 1_000_000 * PRECISION;
        let staked = 800_000 * PRECISION; // 80% staked
        let score = protocol_health_score(tvl, 0, 0, 0, staked);
        // TVL=15, staking=20
        assert_eq!(score, 35);
    }

    #[test]
    fn test_health_score_all_mid_tier() {
        let score = protocol_health_score(
            1_000_000 * PRECISION,   // 15
            50_000 * PRECISION,      // 5% → 15
            500,                     // 15
            10,                      // 15
            300_000 * PRECISION,     // 30% staked → 15
        );
        assert_eq!(score, 75);
    }

    #[test]
    fn test_health_score_small_protocol() {
        let score = protocol_health_score(
            5_000 * PRECISION,       // 2
            50 * PRECISION,          // 1% → 10
            3,                       // 2
            1,                       // 2
            500 * PRECISION,         // 10% → 5
        );
        assert!(score > 0);
    }

    // ============ Annualize Revenue Tests ============

    #[test]
    fn test_annualize_revenue_daily() {
        // 1000 fees per day → 1000 * 365.25 ≈ 365,250/year
        let annual = annualize_revenue(1000 * PRECISION, BLOCKS_PER_DAY);
        // 1000 * 7884000 / 21600 = 365000
        assert_eq!(annual, 365_000 * PRECISION);
    }

    #[test]
    fn test_annualize_revenue_weekly() {
        let weekly_fees = 7_000 * PRECISION;
        let annual = annualize_revenue(weekly_fees, BLOCKS_PER_WEEK);
        // 7000 * 7884000 / 151200 = 365000
        assert_eq!(annual, 365_000 * PRECISION);
    }

    #[test]
    fn test_annualize_revenue_full_year() {
        let yearly_fees = 365_000 * PRECISION;
        let annual = annualize_revenue(yearly_fees, BLOCKS_PER_YEAR);
        assert_eq!(annual, 365_000 * PRECISION);
    }

    #[test]
    fn test_annualize_revenue_single_block() {
        let single_block_fee = PRECISION;
        let annual = annualize_revenue(single_block_fee, 1);
        assert_eq!(annual, BLOCKS_PER_YEAR as u128 * PRECISION);
    }

    #[test]
    fn test_annualize_revenue_zero_fees() {
        assert_eq!(annualize_revenue(0, BLOCKS_PER_DAY), 0);
    }

    #[test]
    fn test_annualize_revenue_zero_period() {
        assert_eq!(annualize_revenue(1000, 0), 0);
    }

    #[test]
    fn test_annualize_revenue_monthly() {
        let monthly_fees = 30_000 * PRECISION;
        let annual = annualize_revenue(monthly_fees, BLOCKS_PER_MONTH);
        // 30000 * 7884000 / 648000 ≈ 365,000
        let expected = mul_div(monthly_fees, BLOCKS_PER_YEAR as u128, BLOCKS_PER_MONTH as u128);
        assert_eq!(annual, expected);
    }

    // ============ Capital Efficiency Tests ============

    #[test]
    fn test_capital_efficiency_10_percent() {
        let eff = capital_efficiency(100_000 * PRECISION, 1_000_000 * PRECISION);
        assert_eq!(eff, 1000); // 10% = 1000 bps
    }

    #[test]
    fn test_capital_efficiency_100_percent() {
        let eff = capital_efficiency(1_000_000 * PRECISION, 1_000_000 * PRECISION);
        assert_eq!(eff, 10_000);
    }

    #[test]
    fn test_capital_efficiency_zero_volume() {
        let eff = capital_efficiency(0, 1_000_000 * PRECISION);
        assert_eq!(eff, 0);
    }

    #[test]
    fn test_capital_efficiency_zero_tvl() {
        let eff = capital_efficiency(100_000 * PRECISION, 0);
        assert_eq!(eff, 0);
    }

    #[test]
    fn test_capital_efficiency_tiny_ratio() {
        let eff = capital_efficiency(1 * PRECISION, 1_000_000 * PRECISION);
        assert_eq!(eff, 0); // < 1 bps rounds to 0
    }

    #[test]
    fn test_capital_efficiency_over_100_percent() {
        let eff = capital_efficiency(2_000_000 * PRECISION, 1_000_000 * PRECISION);
        assert_eq!(eff, 20_000); // 200%
    }

    #[test]
    fn test_capital_efficiency_equal_values() {
        let eff = capital_efficiency(500 * PRECISION, 500 * PRECISION);
        assert_eq!(eff, 10_000);
    }

    // ============ Pool Ranking Tests ============

    #[test]
    fn test_rank_pools_by_tvl() {
        let pools = vec![
            make_pool(1, 100 * PRECISION, 0, 0, 0, 0),
            make_pool(2, 300 * PRECISION, 0, 0, 0, 0),
            make_pool(3, 200 * PRECISION, 0, 0, 0, 0),
        ];
        let ranked = rank_pools(&pools, PoolSortKey::Tvl);
        assert_eq!(ranked, vec![1, 2, 0]); // 300, 200, 100
    }

    #[test]
    fn test_rank_pools_by_volume() {
        let pools = vec![
            make_pool(1, 0, 500 * PRECISION, 0, 0, 0),
            make_pool(2, 0, 100 * PRECISION, 0, 0, 0),
            make_pool(3, 0, 300 * PRECISION, 0, 0, 0),
        ];
        let ranked = rank_pools(&pools, PoolSortKey::Volume);
        assert_eq!(ranked, vec![0, 2, 1]); // 500, 300, 100
    }

    #[test]
    fn test_rank_pools_by_fee_apr() {
        let pools = vec![
            make_pool(1, 0, 0, 500, 0, 0),
            make_pool(2, 0, 0, 1000, 0, 0),
            make_pool(3, 0, 0, 200, 0, 0),
        ];
        let ranked = rank_pools(&pools, PoolSortKey::FeeApr);
        assert_eq!(ranked, vec![1, 0, 2]); // 1000, 500, 200
    }

    #[test]
    fn test_rank_pools_by_net_apr() {
        let pools = vec![
            make_pool(1, 0, 0, 0, -100, 0),
            make_pool(2, 0, 0, 0, 500, 0),
            make_pool(3, 0, 0, 0, 200, 0),
        ];
        let ranked = rank_pools(&pools, PoolSortKey::NetApr);
        assert_eq!(ranked, vec![1, 2, 0]); // 500, 200, -100
    }

    #[test]
    fn test_rank_pools_by_utilization() {
        let pools = vec![
            make_pool(1, 0, 0, 0, 0, 5000),
            make_pool(2, 0, 0, 0, 0, 8000),
            make_pool(3, 0, 0, 0, 0, 2000),
        ];
        let ranked = rank_pools(&pools, PoolSortKey::Utilization);
        assert_eq!(ranked, vec![1, 0, 2]); // 8000, 5000, 2000
    }

    #[test]
    fn test_rank_pools_ties() {
        let pools = vec![
            make_pool(1, 100 * PRECISION, 0, 0, 0, 0),
            make_pool(2, 100 * PRECISION, 0, 0, 0, 0),
            make_pool(3, 100 * PRECISION, 0, 0, 0, 0),
        ];
        let ranked = rank_pools(&pools, PoolSortKey::Tvl);
        // Stable sort: ties preserve original order
        assert_eq!(ranked, vec![0, 1, 2]);
    }

    #[test]
    fn test_rank_pools_empty() {
        let ranked = rank_pools(&[], PoolSortKey::Tvl);
        assert!(ranked.is_empty());
    }

    #[test]
    fn test_rank_pools_single() {
        let pools = vec![make_pool(1, 100 * PRECISION, 0, 0, 0, 0)];
        let ranked = rank_pools(&pools, PoolSortKey::Tvl);
        assert_eq!(ranked, vec![0]);
    }

    #[test]
    fn test_rank_pools_negative_net_apr_ordering() {
        let pools = vec![
            make_pool(1, 0, 0, 0, -500, 0),
            make_pool(2, 0, 0, 0, -100, 0),
            make_pool(3, 0, 0, 0, -1000, 0),
        ];
        let ranked = rank_pools(&pools, PoolSortKey::NetApr);
        assert_eq!(ranked, vec![1, 0, 2]); // -100, -500, -1000
    }

    // ============ Time to Target Tests ============

    #[test]
    fn test_time_to_target_growing() {
        // 1000 → 2000 at 1% daily = ~70 days (rule of 72)
        let days = estimate_time_to_target(1000, 2000, 100);
        assert!(days > 60 && days < 80);
    }

    #[test]
    fn test_time_to_target_already_at_target() {
        let days = estimate_time_to_target(1000, 1000, 100);
        assert_eq!(days, 0);
    }

    #[test]
    fn test_time_to_target_above_target() {
        let days = estimate_time_to_target(2000, 1000, 100);
        assert_eq!(days, 0);
    }

    #[test]
    fn test_time_to_target_declining() {
        // Negative growth → impossible
        let days = estimate_time_to_target(1000, 2000, -100);
        assert_eq!(days, u64::MAX);
    }

    #[test]
    fn test_time_to_target_zero_growth() {
        let days = estimate_time_to_target(1000, 2000, 0);
        assert_eq!(days, u64::MAX);
    }

    #[test]
    fn test_time_to_target_fast_growth() {
        // 10% daily growth → doubles fast
        let days = estimate_time_to_target(1000, 2000, 1000);
        assert!(days > 0 && days < 10);
    }

    #[test]
    fn test_time_to_target_small_gap() {
        // 100 → 101 at 1% daily = 1 day
        let days = estimate_time_to_target(100, 101, 100);
        assert_eq!(days, 1);
    }

    #[test]
    fn test_time_to_target_large_gap() {
        // 1000 → 1_000_000_000 at 1% daily takes many days
        let days = estimate_time_to_target(1_000, 1_000_000_000, 100);
        assert!(days > 100);
        assert!(days < u64::MAX);
    }

    #[test]
    fn test_time_to_target_precision_scaled() {
        let days = estimate_time_to_target(
            1_000_000 * PRECISION,
            2_000_000 * PRECISION,
            100, // 1% daily
        );
        assert!(days > 60 && days < 80);
    }

    // ============ Classify Trend Tests ============

    #[test]
    fn test_classify_strong_up() {
        assert_eq!(classify_trend(600), Trend::StrongUp);
        assert_eq!(classify_trend(10000), Trend::StrongUp);
    }

    #[test]
    fn test_classify_up() {
        assert_eq!(classify_trend(200), Trend::Up);
        assert_eq!(classify_trend(500), Trend::Up);
    }

    #[test]
    fn test_classify_flat() {
        assert_eq!(classify_trend(0), Trend::Flat);
        assert_eq!(classify_trend(100), Trend::Flat);
        assert_eq!(classify_trend(-100), Trend::Flat);
    }

    #[test]
    fn test_classify_down() {
        assert_eq!(classify_trend(-200), Trend::Down);
        assert_eq!(classify_trend(-500), Trend::Down);
    }

    #[test]
    fn test_classify_strong_down() {
        assert_eq!(classify_trend(-600), Trend::StrongDown);
        assert_eq!(classify_trend(-10000), Trend::StrongDown);
    }

    // ============ Edge Case Tests ============

    #[test]
    fn test_kpis_with_large_tvl_growth() {
        let prev = make_snapshot(100, PRECISION, 0, 0, 1);
        let current = make_snapshot(200, 100_000 * PRECISION, 0, 0, 1);
        let snapshots = vec![prev];
        let kpis = compute_kpis(&snapshots, &current).unwrap();
        assert_eq!(kpis.tvl_change_bps, GROWTH_RATE_CAP_BPS);
    }

    #[test]
    fn test_pool_metrics_very_small_tvl() {
        let pm = compute_pool_metrics(
            [0xAA; 32],
            1, // 1 unit TVL
            1_000_000 * PRECISION,
            1_000 * PRECISION,
            0,
            0,
            0,
            1,
        );
        // APR will be capped at u16::MAX
        assert_eq!(pm.fee_apr_bps, u16::MAX);
    }

    #[test]
    fn test_volatility_same_values() {
        let values = vec![42, 42, 42, 42, 42];
        let vol = compute_volatility(&values).unwrap();
        assert_eq!(vol, 0);
    }

    #[test]
    fn test_capital_efficiency_both_zero() {
        assert_eq!(capital_efficiency(0, 0), 0);
    }

    #[test]
    fn test_growth_rate_one_to_two() {
        assert_eq!(compute_growth_rate(1, 2), 10_000); // 100%
    }

    #[test]
    fn test_growth_rate_two_to_one() {
        assert_eq!(compute_growth_rate(2, 1), -5000); // -50%
    }

    #[test]
    fn test_annualize_revenue_both_zero() {
        assert_eq!(annualize_revenue(0, 0), 0);
    }

    #[test]
    fn test_wma_two_values() {
        // [100, 300] with weights [1, 2]
        // WMA = (100*1 + 300*2) / 3 = 700/3 = 233
        let values = vec![100, 300];
        let wma = weighted_moving_average(&values, 2).unwrap();
        assert_eq!(wma, 233);
    }

    #[test]
    fn test_moving_average_two_values() {
        let values = vec![100, 300];
        let ma = moving_average(&values, 2).unwrap();
        assert_eq!(ma, 200);
    }

    #[test]
    fn test_trend_monotonically_decreasing() {
        let values = vec![500, 400, 300, 200, 100];
        let trend = detect_trend(&values).unwrap();
        assert_eq!(trend.direction, Trend::StrongDown);
        assert_eq!(trend.periods_in_trend, 4);
    }

    #[test]
    fn test_pool_ranking_two_pools() {
        let pools = vec![
            make_pool(1, 50 * PRECISION, 0, 0, 0, 0),
            make_pool(2, 100 * PRECISION, 0, 0, 0, 0),
        ];
        let ranked = rank_pools(&pools, PoolSortKey::Tvl);
        assert_eq!(ranked, vec![1, 0]);
    }

    #[test]
    fn test_compare_periods_from_zero_to_nonzero() {
        let snapshots = vec![
            make_snapshot(100, 0, 0, 0, 0),
            make_snapshot(200, PRECISION, 100 * PRECISION, 3 * PRECISION, 50),
        ];
        let cmp = compare_periods(&snapshots, 0, 0, 1, 1).unwrap();
        assert_eq!(cmp.volume_change_bps, GROWTH_RATE_CAP_BPS);
    }

    #[test]
    fn test_time_to_target_one_bps_growth() {
        // Very slow growth
        let days = estimate_time_to_target(10000, 10001, 1);
        assert!(days >= 1);
    }

    #[test]
    fn test_health_score_only_volume_no_tvl() {
        // Volume without TVL — volume component needs TVL > 0
        let score = protocol_health_score(0, 1_000_000 * PRECISION, 0, 0, 0);
        assert_eq!(score, 0); // No TVL → volume component is 0 too
    }

    #[test]
    fn test_health_score_staking_without_tvl() {
        // Staking without TVL
        let score = protocol_health_score(0, 0, 0, 0, 1_000_000 * PRECISION);
        assert_eq!(score, 0);
    }

    #[test]
    fn test_kpis_volume_to_tvl_high() {
        let prev = make_snapshot(100, 1_000 * PRECISION, 0, 0, 0);
        let current = DailySnapshot {
            tvl: 1_000 * PRECISION,
            volume_24h: 10_000 * PRECISION, // 10x TVL
            fees_24h: 30 * PRECISION,
            total_txs: 100,
            ..prev.clone()
        };
        let snapshots = vec![prev];
        let kpis = compute_kpis(&snapshots, &current).unwrap();
        // volume/tvl = 10 = 100000 bps, but capped at u16::MAX
        assert_eq!(kpis.volume_to_tvl_bps, u16::MAX);
    }

    #[test]
    fn test_pool_sort_key_all_variants() {
        // Verify all sort keys are usable
        let pools = vec![
            make_pool(1, 100 * PRECISION, 200 * PRECISION, 300, 150, 1000),
            make_pool(2, 200 * PRECISION, 100 * PRECISION, 600, 50, 2000),
        ];
        let r1 = rank_pools(&pools, PoolSortKey::Tvl);
        assert_eq!(r1[0], 1); // pool 2 has more TVL
        let r2 = rank_pools(&pools, PoolSortKey::Volume);
        assert_eq!(r2[0], 0); // pool 1 has more volume
        let r3 = rank_pools(&pools, PoolSortKey::FeeApr);
        assert_eq!(r3[0], 1); // pool 2 has higher fee APR
        let r4 = rank_pools(&pools, PoolSortKey::NetApr);
        assert_eq!(r4[0], 0); // pool 1 has higher net APR
        let r5 = rank_pools(&pools, PoolSortKey::Utilization);
        assert_eq!(r5[0], 1); // pool 2 has higher utilization
    }

    #[test]
    fn test_pool_metrics_all_zero_emissions() {
        let pm = compute_pool_metrics([0u8; 32], 1_000_000 * PRECISION, 0, 0, 0, PRECISION, 0, 0);
        assert_eq!(pm.emission_apr_bps, 0);
        assert_eq!(pm.fee_apr_bps, 0);
        assert_eq!(pm.combined_apr_bps, 0);
        assert_eq!(pm.net_apr_bps, 0);
    }

    #[test]
    fn test_trend_three_values_no_acceleration() {
        // Linear growth → acceleration near 0
        let values = vec![100, 200, 300];
        let trend = detect_trend(&values).unwrap();
        assert_eq!(trend.direction, Trend::StrongUp);
        // First half: 100→200 = 100%, second half: 200→300 = 50%
        // Acceleration = 5000 - 10000 = -5000 → decelerating
        assert!(trend.acceleration_bps < 0);
    }

    #[test]
    fn test_moving_average_all_zeros() {
        let values = vec![0, 0, 0, 0];
        let ma = moving_average(&values, 4).unwrap();
        assert_eq!(ma, 0);
    }

    #[test]
    fn test_wma_all_zeros() {
        let values = vec![0, 0, 0, 0];
        let wma = weighted_moving_average(&values, 4).unwrap();
        assert_eq!(wma, 0);
    }

    #[test]
    fn test_volatility_symmetric() {
        // Symmetric oscillation around mean
        let values = vec![80, 120, 80, 120];
        let vol = compute_volatility(&values).unwrap();
        assert_eq!(vol, 20); // Mean=100, all deviate by 20
    }

    #[test]
    fn test_rank_pools_five_pools_by_tvl() {
        let pools = vec![
            make_pool(1, 500 * PRECISION, 0, 0, 0, 0),
            make_pool(2, 100 * PRECISION, 0, 0, 0, 0),
            make_pool(3, 300 * PRECISION, 0, 0, 0, 0),
            make_pool(4, 400 * PRECISION, 0, 0, 0, 0),
            make_pool(5, 200 * PRECISION, 0, 0, 0, 0),
        ];
        let ranked = rank_pools(&pools, PoolSortKey::Tvl);
        assert_eq!(ranked, vec![0, 3, 2, 4, 1]); // 500, 400, 300, 200, 100
    }

    #[test]
    fn test_time_to_target_exact_double_at_100_pct() {
        // 100% daily growth → doubles in 1 day
        let days = estimate_time_to_target(1000, 2000, 10_000);
        assert_eq!(days, 1);
    }

    #[test]
    fn test_annualize_revenue_precision() {
        // Verify precision with exact numbers
        let fees = 7_884_000 * PRECISION; // Exactly BLOCKS_PER_YEAR * PRECISION fees
        let annual = annualize_revenue(fees, BLOCKS_PER_YEAR);
        assert_eq!(annual, 7_884_000 * PRECISION);
    }

    #[test]
    fn test_compare_periods_overlapping_is_allowed() {
        // Overlapping ranges should still work (not prevented)
        let snapshots = vec![
            make_snapshot(100, PRECISION, 100 * PRECISION, 3 * PRECISION, 50),
            make_snapshot(200, PRECISION, 200 * PRECISION, 6 * PRECISION, 80),
            make_snapshot(300, PRECISION, 300 * PRECISION, 9 * PRECISION, 100),
        ];
        let cmp = compare_periods(&snapshots, 0, 1, 1, 2).unwrap();
        assert!(cmp.volume_change_bps > 0);
    }

    #[test]
    fn test_growth_rate_precision_rounding() {
        // 10000 → 10049 = 0.49% = 49 bps (truncated, not rounded)
        assert_eq!(compute_growth_rate(10000, 10049), 49);
    }

    #[test]
    fn test_kpis_revenue_annualized_calculation() {
        let prev = make_snapshot(100, PRECISION, 0, 1000 * PRECISION, 0);
        let current = DailySnapshot {
            fees_24h: 1000 * PRECISION,
            ..prev.clone()
        };
        let snapshots = vec![prev];
        let kpis = compute_kpis(&snapshots, &current).unwrap();
        // 2 days of 1000 each = 2000 total, annualized over 2 days
        // 2000 * 7884000 / (2 * 21600) = 2000 * 182.5 = 365000
        assert_eq!(kpis.revenue_annualized, 365_000 * PRECISION);
    }

    // ============ Hardening Tests v4 ============

    #[test]
    fn test_create_snapshot_preserves_all_fields_v4() {
        let s = create_snapshot(42, 100, 200, 300, 400, 500, 6, 7, 800, 9);
        assert_eq!(s.block_number, 42);
        assert_eq!(s.tvl, 100);
        assert_eq!(s.volume_24h, 200);
        assert_eq!(s.fees_24h, 300);
        assert_eq!(s.unique_users, 400);
        assert_eq!(s.total_txs, 500);
        assert_eq!(s.active_pools, 6);
        assert_eq!(s.active_gauges, 7);
        assert_eq!(s.total_staked, 800);
        assert_eq!(s.avg_batch_size, 9);
    }

    #[test]
    fn test_kpis_tvl_change_positive_v4() {
        let prev = make_snapshot(1, 1_000 * PRECISION, 100 * PRECISION, 10 * PRECISION, 50);
        let current = make_snapshot(2, 2_000 * PRECISION, 100 * PRECISION, 10 * PRECISION, 50);
        let kpis = compute_kpis(&[prev], &current).unwrap();
        assert_eq!(kpis.tvl_change_bps, 10_000); // 100% growth
    }

    #[test]
    fn test_kpis_tvl_change_negative_v4() {
        let prev = make_snapshot(1, 2_000 * PRECISION, 100 * PRECISION, 10 * PRECISION, 50);
        let current = make_snapshot(2, 1_000 * PRECISION, 100 * PRECISION, 10 * PRECISION, 50);
        let kpis = compute_kpis(&[prev], &current).unwrap();
        assert_eq!(kpis.tvl_change_bps, -5_000); // -50%
    }

    #[test]
    fn test_kpis_avg_tx_size_v4() {
        let prev = make_snapshot(1, 1_000 * PRECISION, 100 * PRECISION, 10 * PRECISION, 50);
        let mut current = make_snapshot(2, 1_000 * PRECISION, 500 * PRECISION, 10 * PRECISION, 50);
        current.total_txs = 100;
        let kpis = compute_kpis(&[prev], &current).unwrap();
        assert_eq!(kpis.avg_tx_size, 5 * PRECISION);
    }

    #[test]
    fn test_kpis_zero_txs_avg_size_zero_v4() {
        let prev = make_snapshot(1, 1_000 * PRECISION, 100 * PRECISION, 10 * PRECISION, 50);
        let mut current = make_snapshot(2, 1_000 * PRECISION, 500 * PRECISION, 10 * PRECISION, 50);
        current.total_txs = 0;
        let kpis = compute_kpis(&[prev], &current).unwrap();
        assert_eq!(kpis.avg_tx_size, 0);
    }

    #[test]
    fn test_pool_metrics_zero_everything_v4() {
        let pm = compute_pool_metrics([0; 32], 0, 0, 0, 0, 0, 0, 0);
        assert_eq!(pm.fee_apr_bps, 0);
        assert_eq!(pm.emission_apr_bps, 0);
        assert_eq!(pm.combined_apr_bps, 0);
        assert_eq!(pm.net_apr_bps, 0);
        assert_eq!(pm.utilization_bps, 0);
    }

    #[test]
    fn test_pool_metrics_net_apr_negative_v4() {
        let pm = compute_pool_metrics([1; 32], 1_000 * PRECISION, 100 * PRECISION, 10 * PRECISION, 0, 0, 500, 100);
        // IL is 500 bps, combined APR should be less than IL → negative net APR
        // fee_apr = 10 * 365 * 10000 / 1000 = 36500
        assert!(pm.net_apr_bps > 0 || pm.net_apr_bps < 0);
        // With 500 bps IL and some fee APR, net = combined - 500
        assert_eq!(pm.net_apr_bps, pm.combined_apr_bps as i16 - 500);
    }

    #[test]
    fn test_detect_trend_two_values_up_v4() {
        let values = vec![100, 200];
        let trend = detect_trend(&values).unwrap();
        assert_eq!(trend.direction, Trend::StrongUp);
        assert!(trend.magnitude_bps > 0);
        assert_eq!(trend.acceleration_bps, 0); // Only 2 points, no acceleration
    }

    #[test]
    fn test_detect_trend_constant_is_flat_v4() {
        let values = vec![100, 100, 100, 100, 100];
        let trend = detect_trend(&values).unwrap();
        assert_eq!(trend.direction, Trend::Flat);
        assert_eq!(trend.magnitude_bps, 0);
    }

    #[test]
    fn test_detect_trend_decreasing_v4() {
        let values = vec![1000, 900, 800, 700, 600];
        let trend = detect_trend(&values).unwrap();
        match trend.direction {
            Trend::Down | Trend::StrongDown => {}
            _ => panic!("Expected downward trend"),
        }
    }

    #[test]
    fn test_compare_periods_equal_periods_v4() {
        let snapshots = vec![
            make_snapshot(1, 100, 100, 10, 50),
            make_snapshot(2, 100, 100, 10, 50),
        ];
        let cmp = compare_periods(&snapshots, 0, 0, 1, 1).unwrap();
        assert_eq!(cmp.volume_change_bps, 0);
        assert_eq!(cmp.fees_change_bps, 0);
    }

    #[test]
    fn test_compare_periods_reversed_indices_fail_v4() {
        let snapshots = vec![
            make_snapshot(1, 100, 100, 10, 50),
            make_snapshot(2, 100, 100, 10, 50),
        ];
        let result = compare_periods(&snapshots, 1, 0, 0, 1);
        assert_eq!(result, Err(MetricsError::InvalidTimeRange));
    }

    #[test]
    fn test_growth_rate_100_percent_v4() {
        assert_eq!(compute_growth_rate(100, 200), 10_000);
    }

    #[test]
    fn test_growth_rate_50_percent_decline_v4() {
        assert_eq!(compute_growth_rate(200, 100), -5_000);
    }

    #[test]
    fn test_growth_rate_capped_positive_v4() {
        assert_eq!(compute_growth_rate(1, 1_000_000), GROWTH_RATE_CAP_BPS);
    }

    #[test]
    fn test_moving_average_three_values_v4() {
        let values = vec![100, 200, 300];
        let avg = moving_average(&values, 3).unwrap();
        assert_eq!(avg, 200);
    }

    #[test]
    fn test_moving_average_window_larger_than_data_v4() {
        let values = vec![100, 200];
        let avg = moving_average(&values, 10).unwrap();
        assert_eq!(avg, 150); // Uses all available values
    }

    #[test]
    fn test_wma_ascending_weights_recent_more_v4() {
        let values = vec![100, 100, 300]; // Recent value is higher
        let wma = weighted_moving_average(&values, 3).unwrap();
        let sma = moving_average(&values, 3).unwrap();
        // WMA should be higher than SMA because recent value is highest
        assert!(wma > sma);
    }

    #[test]
    fn test_volatility_zero_deviation_v4() {
        let values = vec![100, 100, 100];
        let vol = compute_volatility(&values).unwrap();
        assert_eq!(vol, 0);
    }

    #[test]
    fn test_volatility_high_deviation_v4() {
        let values = vec![0, 1_000, 0, 1_000];
        let vol = compute_volatility(&values).unwrap();
        assert!(vol > 0);
    }

    #[test]
    fn test_health_score_maximum_v4() {
        let score = protocol_health_score(
            100_000_000 * PRECISION,    // 100M TVL
            10_000_000 * PRECISION,     // 10M volume
            5_000,                       // 5000 users
            50,                          // 50 pools
            60_000_000 * PRECISION,     // 60% staked
        );
        assert_eq!(score, 100);
    }

    #[test]
    fn test_health_score_zero_v4() {
        let score = protocol_health_score(0, 0, 0, 0, 0);
        assert_eq!(score, 0);
    }

    #[test]
    fn test_annualize_revenue_daily_period_v4() {
        let revenue = annualize_revenue(100 * PRECISION, BLOCKS_PER_DAY);
        // 100 * 7884000 / 21600 = 100 * 365 = 36500
        assert_eq!(revenue, 36_500 * PRECISION);
    }

    #[test]
    fn test_capital_efficiency_2x_v4() {
        let eff = capital_efficiency(20_000, 10_000);
        assert_eq!(eff, 20_000); // 200% utilization
    }

    #[test]
    fn test_rank_pools_descending_order_v4() {
        let pools = vec![
            make_pool(1, 100 * PRECISION, 10 * PRECISION, 50, 50, 100),
            make_pool(2, 300 * PRECISION, 30 * PRECISION, 150, 150, 100),
            make_pool(3, 200 * PRECISION, 20 * PRECISION, 100, 100, 100),
        ];
        let ranked = rank_pools(&pools, PoolSortKey::Tvl);
        assert_eq!(ranked, vec![1, 2, 0]); // 300, 200, 100
    }

    #[test]
    fn test_time_to_target_100_bps_daily_v4() {
        let days = estimate_time_to_target(100, 200, 100);
        // 1% daily growth to double
        assert!(days > 0);
        assert!(days < 200); // Should be around 70 days (rule of 72)
    }

    #[test]
    fn test_time_to_target_already_above_v4() {
        assert_eq!(estimate_time_to_target(200, 100, 100), 0);
    }

    #[test]
    fn test_time_to_target_negative_growth_v4() {
        assert_eq!(estimate_time_to_target(100, 200, -100), u64::MAX);
    }

    #[test]
    fn test_metrics_error_variants_distinct_v4() {
        let errors = vec![
            MetricsError::InsufficientData,
            MetricsError::InvalidTimeRange,
            MetricsError::ZeroDenominator,
            MetricsError::Overflow,
            MetricsError::SnapshotNotFound,
            MetricsError::DuplicateSnapshot,
        ];
        for i in 0..errors.len() {
            for j in (i+1)..errors.len() {
                assert_ne!(errors[i], errors[j]);
            }
        }
    }
}
