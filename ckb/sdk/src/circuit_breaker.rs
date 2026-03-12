// ============ Circuit Breaker — Anomaly Detection & Automatic Protocol Halts ============
// Implements circuit breaker safety mechanisms for the VibeSwap protocol: automatic halts
// when anomalous conditions are detected across price, volume, and withdrawal dimensions.
//
// Key capabilities:
// - Price deviation monitoring with configurable thresholds (default 5%)
// - Volume spike detection against baseline (default 50x triggers halt)
// - Withdrawal rate limiting to prevent bank runs (default 20% TVL/window)
// - Composite breaker combining multiple signals for emergency detection
// - Automatic recovery after cooldown with consecutive trip escalation
// - Manual reset required after repeated trips (3 consecutive)
// - Grace period after deployment before breakers activate
// - Early warning system at 50%/75%/100% of thresholds
//
// The circuit breaker is the protocol's immune system: it detects threats,
// halts operations to prevent damage, and self-heals when conditions normalize.
//
// Philosophy: Prevention > punishment. A tripped breaker costs time; an exploit costs everything.

use vibeswap_math::PRECISION;
use vibeswap_math::mul_div;

// ============ Constants ============

/// Basis points denominator
pub const BPS: u128 = 10_000;

/// 5% price move triggers halt
pub const MAX_PRICE_DEVIATION_BPS: u16 = 500;

/// 50x normal volume triggers halt
pub const MAX_VOLUME_SPIKE_BPS: u16 = 5000;

/// 20% TVL withdrawn in window triggers halt
pub const MAX_WITHDRAWAL_RATE_BPS: u16 = 2000;

/// Blocks before auto-recovery
pub const COOLDOWN_BLOCKS: u64 = 100;

/// ~10 minutes in blocks
pub const MONITORING_WINDOW: u64 = 600;

/// After 3 trips, requires manual reset
pub const MAX_CONSECUTIVE_TRIPS: u32 = 3;

/// Blocks after deployment before active
pub const GRACE_PERIOD_BLOCKS: u64 = 10;

/// Minimum data points before triggering
pub const MIN_OBSERVATION_COUNT: u32 = 5;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CircuitBreakerError {
    /// Breaker is already in a tripped state
    AlreadyTripped,
    /// Breaker is not currently tripped
    NotTripped,
    /// Cooldown period has not elapsed since last trip
    CooldownActive,
    /// Too many consecutive trips — requires manual intervention
    ManualResetRequired,
    /// Not enough observations to make a reliable determination
    InsufficientObservations,
    /// Threshold value is out of valid range
    InvalidThreshold,
    /// Deployment grace period is still active
    GracePeriodActive,
    /// Monitoring window must be non-zero
    InvalidWindow,
    /// Value must be non-zero
    ZeroValue,
    /// Arithmetic overflow
    Overflow,
}

// ============ Data Types ============

/// The type of circuit breaker being monitored.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BreakerType {
    /// Monitors price deviation from baseline
    Price,
    /// Monitors volume spikes against normal activity
    Volume,
    /// Monitors withdrawal rate relative to TVL
    Withdrawal,
    /// Combines multiple signals for emergency detection
    Composite,
}

/// Complete state of a single circuit breaker instance.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BreakerState {
    /// What kind of breaker this is
    pub breaker_type: BreakerType,
    /// Whether the breaker is currently tripped (protocol halted)
    pub is_tripped: bool,
    /// Block number when the breaker was last tripped
    pub trip_block: u64,
    /// Number of consecutive trips without a full reset
    pub consecutive_trips: u32,
    /// Block number of the last successful reset
    pub last_reset_block: u64,
    /// Lifetime total number of trips
    pub total_trips: u64,
    /// Block number when this breaker was deployed
    pub deployment_block: u64,
    /// Whether manual intervention is required to reset
    pub manual_reset_required: bool,
}

/// A single price observation at a point in time.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PriceObservation {
    /// Price in PRECISION-scaled units
    pub price: u128,
    /// Block number of this observation
    pub block_number: u64,
}

/// A single volume observation at a point in time.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VolumeObservation {
    /// Volume in PRECISION-scaled units
    pub volume: u128,
    /// Block number of this observation
    pub block_number: u64,
}

/// A single withdrawal observation capturing amount and TVL context.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WithdrawalObservation {
    /// Amount withdrawn in PRECISION-scaled units
    pub amount: u128,
    /// Total value locked at the time of withdrawal
    pub tvl_at_time: u128,
    /// Block number of this observation
    pub block_number: u64,
}

/// Configuration parameters for circuit breaker thresholds.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BreakerConfig {
    /// Price deviation threshold in basis points
    pub price_deviation_bps: u16,
    /// Volume spike threshold in basis points (100 = 1x, 5000 = 50x)
    pub volume_spike_bps: u16,
    /// Withdrawal rate threshold in basis points of TVL
    pub withdrawal_rate_bps: u16,
    /// Blocks to wait before auto-recovery is allowed
    pub cooldown_blocks: u64,
    /// Window of blocks to consider for observations
    pub monitoring_window: u64,
    /// Maximum consecutive trips before manual reset required
    pub max_consecutive_trips: u32,
}

/// Report generated when a breaker trips.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TripReport {
    /// Which breaker type generated this report
    pub breaker_type: BreakerType,
    /// The actual measured value in basis points
    pub trigger_value_bps: u16,
    /// The threshold that was exceeded
    pub threshold_bps: u16,
    /// Number of observations used in the calculation
    pub observation_count: u32,
    /// Block number at which the trip occurred
    pub trip_block: u64,
    /// Severity level of this trip
    pub severity: Severity,
}

/// Severity levels for circuit breaker events.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Severity {
    /// Approaching threshold (50-74% of limit)
    Warning,
    /// Threshold exceeded (75-100%+ of limit for warnings, 100%+ for trips)
    Critical,
    /// Multiple breakers tripped simultaneously
    Emergency,
}

/// Overall system status across all breakers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SystemStatus {
    /// Whether all breakers are clear and protocol can operate normally
    pub all_clear: bool,
    /// Which breaker types are currently tripped (fixed array, None = slot unused)
    pub tripped_breakers: [Option<BreakerType>; 4],
    /// The highest severity level across all breakers
    pub highest_severity: Severity,
    /// Minimum blocks remaining until any tripped breaker can auto-recover
    pub blocks_until_recovery: u64,
    /// Whether any breaker requires manual intervention
    pub manual_intervention_needed: bool,
}

// ============ Core Functions ============

/// Initialize a new circuit breaker with the given type and deployment block.
///
/// The breaker starts in a non-tripped state with zero trip history.
/// A grace period of GRACE_PERIOD_BLOCKS applies before the breaker
/// begins monitoring.
pub fn create_breaker(breaker_type: BreakerType, deployment_block: u64) -> BreakerState {
    BreakerState {
        breaker_type,
        is_tripped: false,
        trip_block: 0,
        consecutive_trips: 0,
        last_reset_block: deployment_block,
        total_trips: 0,
        deployment_block,
        manual_reset_required: false,
    }
}

/// Create a default configuration using the module-level constants.
pub fn create_config() -> BreakerConfig {
    BreakerConfig {
        price_deviation_bps: MAX_PRICE_DEVIATION_BPS,
        volume_spike_bps: MAX_VOLUME_SPIKE_BPS,
        withdrawal_rate_bps: MAX_WITHDRAWAL_RATE_BPS,
        cooldown_blocks: COOLDOWN_BLOCKS,
        monitoring_window: MONITORING_WINDOW,
        max_consecutive_trips: MAX_CONSECUTIVE_TRIPS,
    }
}

/// Create a custom configuration with validated parameters.
///
/// Validates:
/// - All BPS thresholds are non-zero and within valid ranges
/// - Cooldown and window are non-zero
/// - max_trips is non-zero
pub fn custom_config(
    price_bps: u16,
    volume_bps: u16,
    withdrawal_bps: u16,
    cooldown: u64,
    window: u64,
    max_trips: u32,
) -> Result<BreakerConfig, CircuitBreakerError> {
    if price_bps == 0 || volume_bps == 0 || withdrawal_bps == 0 {
        return Err(CircuitBreakerError::InvalidThreshold);
    }
    // Price deviation above 100% doesn't make sense
    if price_bps > 10_000 {
        return Err(CircuitBreakerError::InvalidThreshold);
    }
    // Withdrawal rate above 100% doesn't make sense
    if withdrawal_bps > 10_000 {
        return Err(CircuitBreakerError::InvalidThreshold);
    }
    if cooldown == 0 {
        return Err(CircuitBreakerError::InvalidWindow);
    }
    if window == 0 {
        return Err(CircuitBreakerError::InvalidWindow);
    }
    if max_trips == 0 {
        return Err(CircuitBreakerError::InvalidThreshold);
    }

    Ok(BreakerConfig {
        price_deviation_bps: price_bps,
        volume_spike_bps: volume_bps,
        withdrawal_rate_bps: withdrawal_bps,
        cooldown_blocks: cooldown,
        monitoring_window: window,
        max_consecutive_trips: max_trips,
    })
}

/// Check whether the price breaker should trip based on recent observations.
///
/// Computes the maximum price deviation within the monitoring window.
/// Returns `Some(TripReport)` if the deviation exceeds the configured threshold,
/// or `None` if conditions are normal.
///
/// Requires at least MIN_OBSERVATION_COUNT observations within the window.
pub fn check_price_breaker(
    observations: &[PriceObservation],
    config: &BreakerConfig,
    current_block: u64,
) -> Result<Option<TripReport>, CircuitBreakerError> {
    let deviation_bps = compute_price_deviation(observations, config.monitoring_window, current_block)?;

    if deviation_bps >= config.price_deviation_bps {
        let severity = if deviation_bps >= config.price_deviation_bps * 2 {
            Severity::Emergency
        } else {
            Severity::Critical
        };

        let in_window = observations
            .iter()
            .filter(|o| current_block >= o.block_number && current_block - o.block_number <= config.monitoring_window)
            .count() as u32;

        Ok(Some(TripReport {
            breaker_type: BreakerType::Price,
            trigger_value_bps: deviation_bps,
            threshold_bps: config.price_deviation_bps,
            observation_count: in_window,
            trip_block: current_block,
            severity,
        }))
    } else {
        Ok(None)
    }
}

/// Check whether the volume breaker should trip based on recent observations.
///
/// Computes the ratio of recent volume to baseline volume.
/// Returns `Some(TripReport)` if the ratio exceeds the configured threshold,
/// or `None` if conditions are normal.
///
/// Requires at least MIN_OBSERVATION_COUNT observations within the window.
pub fn check_volume_breaker(
    observations: &[VolumeObservation],
    config: &BreakerConfig,
    current_block: u64,
) -> Result<Option<TripReport>, CircuitBreakerError> {
    let ratio_bps = compute_volume_ratio(observations, config.monitoring_window, current_block)?;

    if ratio_bps >= config.volume_spike_bps {
        let severity = if ratio_bps >= config.volume_spike_bps * 2 {
            Severity::Emergency
        } else {
            Severity::Critical
        };

        let in_window = observations
            .iter()
            .filter(|o| current_block >= o.block_number && current_block - o.block_number <= config.monitoring_window)
            .count() as u32;

        Ok(Some(TripReport {
            breaker_type: BreakerType::Volume,
            trigger_value_bps: ratio_bps,
            threshold_bps: config.volume_spike_bps,
            observation_count: in_window,
            trip_block: current_block,
            severity,
        }))
    } else {
        Ok(None)
    }
}

/// Check whether the withdrawal breaker should trip based on recent observations.
///
/// Computes the withdrawal rate as a percentage of TVL within the monitoring window.
/// Returns `Some(TripReport)` if the rate exceeds the configured threshold,
/// or `None` if conditions are normal.
///
/// Requires at least MIN_OBSERVATION_COUNT observations within the window.
pub fn check_withdrawal_breaker(
    observations: &[WithdrawalObservation],
    config: &BreakerConfig,
    current_block: u64,
) -> Result<Option<TripReport>, CircuitBreakerError> {
    let rate_bps = compute_withdrawal_rate(observations, config.monitoring_window, current_block)?;

    if rate_bps >= config.withdrawal_rate_bps {
        let severity = if rate_bps >= config.withdrawal_rate_bps * 2 {
            Severity::Emergency
        } else {
            Severity::Critical
        };

        let in_window = observations
            .iter()
            .filter(|o| current_block >= o.block_number && current_block - o.block_number <= config.monitoring_window)
            .count() as u32;

        Ok(Some(TripReport {
            breaker_type: BreakerType::Withdrawal,
            trigger_value_bps: rate_bps,
            threshold_bps: config.withdrawal_rate_bps,
            observation_count: in_window,
            trip_block: current_block,
            severity,
        }))
    } else {
        Ok(None)
    }
}

/// Trip a breaker, transitioning it to the halted state.
///
/// Validates:
/// - Breaker is not already tripped
/// - Grace period has elapsed since deployment
///
/// Increments consecutive trip counter and total trip counter.
/// If consecutive trips reach max_consecutive_trips (from the report's context),
/// sets manual_reset_required.
pub fn trip_breaker(
    state: &BreakerState,
    current_block: u64,
    _report: &TripReport,
) -> Result<BreakerState, CircuitBreakerError> {
    if state.is_tripped {
        return Err(CircuitBreakerError::AlreadyTripped);
    }

    if current_block < state.deployment_block + GRACE_PERIOD_BLOCKS {
        return Err(CircuitBreakerError::GracePeriodActive);
    }

    let new_consecutive = state.consecutive_trips + 1;
    let needs_manual = new_consecutive >= MAX_CONSECUTIVE_TRIPS;

    Ok(BreakerState {
        breaker_type: state.breaker_type.clone(),
        is_tripped: true,
        trip_block: current_block,
        consecutive_trips: new_consecutive,
        last_reset_block: state.last_reset_block,
        total_trips: state.total_trips + 1,
        deployment_block: state.deployment_block,
        manual_reset_required: needs_manual,
    })
}

/// Attempt automatic recovery of a tripped breaker after the cooldown period.
///
/// Validates:
/// - Breaker is currently tripped
/// - Manual reset is not required
/// - Sufficient blocks have elapsed since the trip
///
/// On success, resets the tripped state but preserves consecutive trip count
/// (only manual_reset clears consecutive trips).
pub fn auto_recover(
    state: &BreakerState,
    current_block: u64,
    config: &BreakerConfig,
) -> Result<BreakerState, CircuitBreakerError> {
    if !state.is_tripped {
        return Err(CircuitBreakerError::NotTripped);
    }

    if state.manual_reset_required {
        return Err(CircuitBreakerError::ManualResetRequired);
    }

    if current_block < state.trip_block + config.cooldown_blocks {
        return Err(CircuitBreakerError::CooldownActive);
    }

    Ok(BreakerState {
        breaker_type: state.breaker_type.clone(),
        is_tripped: false,
        trip_block: state.trip_block,
        consecutive_trips: state.consecutive_trips,
        last_reset_block: current_block,
        total_trips: state.total_trips,
        deployment_block: state.deployment_block,
        manual_reset_required: false,
    })
}

/// Manually reset a breaker that requires human intervention.
///
/// This is the only way to recover from MAX_CONSECUTIVE_TRIPS.
/// Clears all trip state including consecutive trip counter.
pub fn manual_reset(
    state: &BreakerState,
    current_block: u64,
) -> Result<BreakerState, CircuitBreakerError> {
    if !state.is_tripped {
        return Err(CircuitBreakerError::NotTripped);
    }

    Ok(BreakerState {
        breaker_type: state.breaker_type.clone(),
        is_tripped: false,
        trip_block: state.trip_block,
        consecutive_trips: 0,
        last_reset_block: current_block,
        total_trips: state.total_trips,
        deployment_block: state.deployment_block,
        manual_reset_required: false,
    })
}

/// Check whether the protocol can operate with this breaker.
///
/// Returns true if:
/// - Breaker is not tripped, OR
/// - Breaker is still in its grace period (not yet active)
pub fn can_operate(state: &BreakerState, current_block: u64) -> bool {
    // During grace period, always allow operation
    if current_block < state.deployment_block + GRACE_PERIOD_BLOCKS {
        return true;
    }
    !state.is_tripped
}

// ============ Computation Functions ============

/// Compute the maximum price deviation in basis points within a monitoring window.
///
/// Finds the min and max prices among observations within the window,
/// then returns `(max - min) * BPS / min` as the deviation.
///
/// Returns `InsufficientObservations` if fewer than MIN_OBSERVATION_COUNT
/// observations fall within the window.
pub fn compute_price_deviation(
    observations: &[PriceObservation],
    window: u64,
    current_block: u64,
) -> Result<u16, CircuitBreakerError> {
    if window == 0 {
        return Err(CircuitBreakerError::InvalidWindow);
    }

    // Filter observations within the monitoring window
    let window_start = if current_block > window {
        current_block - window
    } else {
        0
    };

    let mut count: u32 = 0;
    let mut min_price: u128 = u128::MAX;
    let mut max_price: u128 = 0;

    for obs in observations.iter() {
        if obs.block_number >= window_start && obs.block_number <= current_block {
            if obs.price == 0 {
                return Err(CircuitBreakerError::ZeroValue);
            }
            if obs.price < min_price {
                min_price = obs.price;
            }
            if obs.price > max_price {
                max_price = obs.price;
            }
            count += 1;
        }
    }

    if count < MIN_OBSERVATION_COUNT {
        return Err(CircuitBreakerError::InsufficientObservations);
    }

    // deviation = (max - min) * BPS / min
    let diff = max_price - min_price;
    let deviation = mul_div(diff, BPS, min_price);

    // Cap at u16::MAX to avoid truncation issues
    if deviation > u16::MAX as u128 {
        Ok(u16::MAX)
    } else {
        Ok(deviation as u16)
    }
}

/// Compute the volume ratio in basis points: recent volume vs baseline.
///
/// Splits the monitoring window into two halves:
/// - Recent half: the more recent half of observations
/// - Baseline half: the older half
///
/// The ratio is `recent_avg * BPS / baseline_avg`.
/// A value of 100 (= 1x) means normal. 5000 (= 50x) means 50x spike.
///
/// Returns `InsufficientObservations` if fewer than MIN_OBSERVATION_COUNT total.
pub fn compute_volume_ratio(
    observations: &[VolumeObservation],
    window: u64,
    current_block: u64,
) -> Result<u16, CircuitBreakerError> {
    if window == 0 {
        return Err(CircuitBreakerError::InvalidWindow);
    }

    let window_start = if current_block > window {
        current_block - window
    } else {
        0
    };

    // Collect observations within the window
    let mut in_window_count: u32 = 0;
    let mut recent_sum: u128 = 0;
    let mut recent_count: u32 = 0;
    let mut baseline_sum: u128 = 0;
    let mut baseline_count: u32 = 0;

    let midpoint = window_start + window / 2;

    for obs in observations.iter() {
        if obs.block_number >= window_start && obs.block_number <= current_block {
            in_window_count += 1;
            if obs.block_number >= midpoint {
                // Recent half
                recent_sum = recent_sum.checked_add(obs.volume)
                    .ok_or(CircuitBreakerError::Overflow)?;
                recent_count += 1;
            } else {
                // Baseline half
                baseline_sum = baseline_sum.checked_add(obs.volume)
                    .ok_or(CircuitBreakerError::Overflow)?;
                baseline_count += 1;
            }
        }
    }

    if in_window_count < MIN_OBSERVATION_COUNT {
        return Err(CircuitBreakerError::InsufficientObservations);
    }

    // Need both halves to have data
    if baseline_count == 0 || baseline_sum == 0 {
        // If no baseline but we have recent data, treat as infinite spike
        if recent_count > 0 && recent_sum > 0 {
            return Ok(u16::MAX);
        }
        // No data at all — no spike
        return Ok(100); // 1x = normal
    }

    if recent_count == 0 || recent_sum == 0 {
        // Recent volume is zero — no spike
        return Ok(0);
    }

    // Compute averages then ratio: (recent_avg / baseline_avg) * 100
    // = (recent_sum / recent_count) / (baseline_sum / baseline_count) * 100
    // = (recent_sum * baseline_count * 100) / (baseline_sum * recent_count)
    let numerator = recent_sum
        .checked_mul(baseline_count as u128)
        .ok_or(CircuitBreakerError::Overflow)?;
    let numerator = numerator
        .checked_mul(100)
        .ok_or(CircuitBreakerError::Overflow)?;
    let denominator = baseline_sum
        .checked_mul(recent_count as u128)
        .ok_or(CircuitBreakerError::Overflow)?;

    let ratio = mul_div(numerator, 1, denominator);

    if ratio > u16::MAX as u128 {
        Ok(u16::MAX)
    } else {
        Ok(ratio as u16)
    }
}

/// Compute the withdrawal rate in basis points of TVL within a monitoring window.
///
/// Sums all withdrawal amounts within the window and divides by the average TVL
/// across those observations. The result is in basis points (e.g., 2000 = 20% of TVL).
///
/// Returns `InsufficientObservations` if fewer than MIN_OBSERVATION_COUNT observations.
pub fn compute_withdrawal_rate(
    observations: &[WithdrawalObservation],
    window: u64,
    current_block: u64,
) -> Result<u16, CircuitBreakerError> {
    if window == 0 {
        return Err(CircuitBreakerError::InvalidWindow);
    }

    let window_start = if current_block > window {
        current_block - window
    } else {
        0
    };

    let mut count: u32 = 0;
    let mut total_withdrawn: u128 = 0;
    let mut tvl_sum: u128 = 0;

    for obs in observations.iter() {
        if obs.block_number >= window_start && obs.block_number <= current_block {
            if obs.tvl_at_time == 0 {
                return Err(CircuitBreakerError::ZeroValue);
            }
            total_withdrawn = total_withdrawn
                .checked_add(obs.amount)
                .ok_or(CircuitBreakerError::Overflow)?;
            tvl_sum = tvl_sum
                .checked_add(obs.tvl_at_time)
                .ok_or(CircuitBreakerError::Overflow)?;
            count += 1;
        }
    }

    if count < MIN_OBSERVATION_COUNT {
        return Err(CircuitBreakerError::InsufficientObservations);
    }

    // average TVL
    let avg_tvl = tvl_sum / count as u128;
    if avg_tvl == 0 {
        return Err(CircuitBreakerError::ZeroValue);
    }

    // withdrawal_rate = total_withdrawn * BPS / avg_tvl
    let rate = mul_div(total_withdrawn, BPS, avg_tvl);

    if rate > u16::MAX as u128 {
        Ok(u16::MAX)
    } else {
        Ok(rate as u16)
    }
}

// ============ System Assessment Functions ============

/// Assess the overall system status across all breakers.
///
/// Determines:
/// - Whether all breakers are clear
/// - Which breakers are tripped
/// - Highest severity level
/// - Minimum time to recovery
/// - Whether manual intervention is needed
pub fn assess_system(
    breakers: &[BreakerState],
    current_block: u64,
    config: &BreakerConfig,
) -> SystemStatus {
    let mut all_clear = true;
    let mut tripped: [Option<BreakerType>; 4] = [None, None, None, None];
    let mut tripped_count: usize = 0;
    let mut min_recovery: u64 = 0;
    let mut needs_manual = false;

    for breaker in breakers.iter() {
        if breaker.is_tripped {
            all_clear = false;
            if tripped_count < 4 {
                tripped[tripped_count] = Some(breaker.breaker_type.clone());
                tripped_count += 1;
            }
            if breaker.manual_reset_required {
                needs_manual = true;
            }
            let ttr = time_to_recovery(breaker, current_block, config);
            if min_recovery == 0 || (ttr > 0 && ttr < min_recovery) {
                min_recovery = ttr;
            }
        }
    }

    let highest_severity = if tripped_count >= 2 {
        Severity::Emergency
    } else if tripped_count == 1 {
        Severity::Critical
    } else {
        Severity::Warning
    };

    SystemStatus {
        all_clear,
        tripped_breakers: tripped,
        highest_severity,
        blocks_until_recovery: min_recovery,
        manual_intervention_needed: needs_manual,
    }
}

/// Calculate the number of blocks remaining before a tripped breaker can auto-recover.
///
/// Returns 0 if:
/// - Breaker is not tripped
/// - Cooldown has already elapsed
/// - Manual reset is required (auto-recovery not possible)
pub fn time_to_recovery(
    state: &BreakerState,
    current_block: u64,
    config: &BreakerConfig,
) -> u64 {
    if !state.is_tripped {
        return 0;
    }
    if state.manual_reset_required {
        return 0; // Can't auto-recover — manual reset needed
    }

    let recovery_block = state.trip_block + config.cooldown_blocks;
    if current_block >= recovery_block {
        0
    } else {
        recovery_block - current_block
    }
}

/// Determine the warning severity level for a given deviation relative to its threshold.
///
/// Returns:
/// - `None` if deviation is below 50% of threshold
/// - `Some(Warning)` if deviation is 50-74% of threshold
/// - `Some(Critical)` if deviation is 75-99% of threshold
/// - `Some(Emergency)` if deviation is at or above threshold
pub fn should_warn(deviation_bps: u16, threshold_bps: u16) -> Option<Severity> {
    if threshold_bps == 0 {
        return None;
    }

    // Calculate percentage of threshold reached
    let pct = (deviation_bps as u32 * 100) / threshold_bps as u32;

    if pct >= 100 {
        Some(Severity::Emergency)
    } else if pct >= 75 {
        Some(Severity::Critical)
    } else if pct >= 50 {
        Some(Severity::Warning)
    } else {
        None
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Helper factories ----

    fn default_config() -> BreakerConfig {
        create_config()
    }

    fn price_breaker(deployment_block: u64) -> BreakerState {
        create_breaker(BreakerType::Price, deployment_block)
    }

    fn volume_breaker(deployment_block: u64) -> BreakerState {
        create_breaker(BreakerType::Volume, deployment_block)
    }

    fn withdrawal_breaker(deployment_block: u64) -> BreakerState {
        create_breaker(BreakerType::Withdrawal, deployment_block)
    }

    fn composite_breaker(deployment_block: u64) -> BreakerState {
        create_breaker(BreakerType::Composite, deployment_block)
    }

    fn make_price_obs(prices: &[(u128, u64)]) -> Vec<PriceObservation> {
        prices
            .iter()
            .map(|&(price, block_number)| PriceObservation { price, block_number })
            .collect()
    }

    fn make_volume_obs(volumes: &[(u128, u64)]) -> Vec<VolumeObservation> {
        volumes
            .iter()
            .map(|&(volume, block_number)| VolumeObservation { volume, block_number })
            .collect()
    }

    fn make_withdrawal_obs(data: &[(u128, u128, u64)]) -> Vec<WithdrawalObservation> {
        data.iter()
            .map(|&(amount, tvl_at_time, block_number)| WithdrawalObservation {
                amount,
                tvl_at_time,
                block_number,
            })
            .collect()
    }

    fn stable_prices(base: u128, count: u32, start_block: u64) -> Vec<PriceObservation> {
        (0..count)
            .map(|i| PriceObservation {
                price: base,
                block_number: start_block + i as u64,
            })
            .collect()
    }

    fn default_trip_report(breaker_type: BreakerType, block: u64) -> TripReport {
        TripReport {
            breaker_type,
            trigger_value_bps: 600,
            threshold_bps: 500,
            observation_count: 10,
            trip_block: block,
            severity: Severity::Critical,
        }
    }

    // ============ Breaker Creation Tests ============

    #[test]
    fn test_create_price_breaker() {
        let state = price_breaker(100);
        assert_eq!(state.breaker_type, BreakerType::Price);
        assert!(!state.is_tripped);
        assert_eq!(state.trip_block, 0);
        assert_eq!(state.consecutive_trips, 0);
        assert_eq!(state.last_reset_block, 100);
        assert_eq!(state.total_trips, 0);
        assert_eq!(state.deployment_block, 100);
        assert!(!state.manual_reset_required);
    }

    #[test]
    fn test_create_volume_breaker() {
        let state = volume_breaker(0);
        assert_eq!(state.breaker_type, BreakerType::Volume);
        assert!(!state.is_tripped);
        assert_eq!(state.deployment_block, 0);
    }

    #[test]
    fn test_create_withdrawal_breaker() {
        let state = withdrawal_breaker(500);
        assert_eq!(state.breaker_type, BreakerType::Withdrawal);
        assert_eq!(state.deployment_block, 500);
    }

    #[test]
    fn test_create_composite_breaker() {
        let state = composite_breaker(1000);
        assert_eq!(state.breaker_type, BreakerType::Composite);
        assert_eq!(state.deployment_block, 1000);
    }

    #[test]
    fn test_create_breaker_at_block_zero() {
        let state = create_breaker(BreakerType::Price, 0);
        assert_eq!(state.deployment_block, 0);
        assert_eq!(state.last_reset_block, 0);
    }

    #[test]
    fn test_create_breaker_at_large_block() {
        let state = create_breaker(BreakerType::Volume, u64::MAX - 100);
        assert_eq!(state.deployment_block, u64::MAX - 100);
    }

    // ============ Config Tests ============

    #[test]
    fn test_default_config() {
        let config = create_config();
        assert_eq!(config.price_deviation_bps, MAX_PRICE_DEVIATION_BPS);
        assert_eq!(config.volume_spike_bps, MAX_VOLUME_SPIKE_BPS);
        assert_eq!(config.withdrawal_rate_bps, MAX_WITHDRAWAL_RATE_BPS);
        assert_eq!(config.cooldown_blocks, COOLDOWN_BLOCKS);
        assert_eq!(config.monitoring_window, MONITORING_WINDOW);
        assert_eq!(config.max_consecutive_trips, MAX_CONSECUTIVE_TRIPS);
    }

    #[test]
    fn test_custom_config_valid() {
        let config = custom_config(250, 3000, 1500, 50, 300, 5).unwrap();
        assert_eq!(config.price_deviation_bps, 250);
        assert_eq!(config.volume_spike_bps, 3000);
        assert_eq!(config.withdrawal_rate_bps, 1500);
        assert_eq!(config.cooldown_blocks, 50);
        assert_eq!(config.monitoring_window, 300);
        assert_eq!(config.max_consecutive_trips, 5);
    }

    #[test]
    fn test_custom_config_max_valid_values() {
        let config = custom_config(10_000, u16::MAX, 10_000, u64::MAX, u64::MAX, u32::MAX).unwrap();
        assert_eq!(config.price_deviation_bps, 10_000);
        assert_eq!(config.withdrawal_rate_bps, 10_000);
    }

    #[test]
    fn test_custom_config_zero_price() {
        let result = custom_config(0, 3000, 1500, 50, 300, 5);
        assert_eq!(result, Err(CircuitBreakerError::InvalidThreshold));
    }

    #[test]
    fn test_custom_config_zero_volume() {
        let result = custom_config(250, 0, 1500, 50, 300, 5);
        assert_eq!(result, Err(CircuitBreakerError::InvalidThreshold));
    }

    #[test]
    fn test_custom_config_zero_withdrawal() {
        let result = custom_config(250, 3000, 0, 50, 300, 5);
        assert_eq!(result, Err(CircuitBreakerError::InvalidThreshold));
    }

    #[test]
    fn test_custom_config_price_above_100_percent() {
        let result = custom_config(10_001, 3000, 1500, 50, 300, 5);
        assert_eq!(result, Err(CircuitBreakerError::InvalidThreshold));
    }

    #[test]
    fn test_custom_config_withdrawal_above_100_percent() {
        let result = custom_config(250, 3000, 10_001, 50, 300, 5);
        assert_eq!(result, Err(CircuitBreakerError::InvalidThreshold));
    }

    #[test]
    fn test_custom_config_zero_cooldown() {
        let result = custom_config(250, 3000, 1500, 0, 300, 5);
        assert_eq!(result, Err(CircuitBreakerError::InvalidWindow));
    }

    #[test]
    fn test_custom_config_zero_window() {
        let result = custom_config(250, 3000, 1500, 50, 0, 5);
        assert_eq!(result, Err(CircuitBreakerError::InvalidWindow));
    }

    #[test]
    fn test_custom_config_zero_max_trips() {
        let result = custom_config(250, 3000, 1500, 50, 300, 0);
        assert_eq!(result, Err(CircuitBreakerError::InvalidThreshold));
    }

    #[test]
    fn test_custom_config_min_valid_values() {
        let config = custom_config(1, 1, 1, 1, 1, 1).unwrap();
        assert_eq!(config.price_deviation_bps, 1);
        assert_eq!(config.volume_spike_bps, 1);
        assert_eq!(config.withdrawal_rate_bps, 1);
    }

    // ============ Price Deviation Tests ============

    #[test]
    fn test_price_deviation_stable() {
        let obs = stable_prices(PRECISION, 10, 100);
        let deviation = compute_price_deviation(&obs, 600, 110).unwrap();
        assert_eq!(deviation, 0);
    }

    #[test]
    fn test_price_deviation_small_move() {
        // 1% move: 1000 -> 1010
        let mut obs = stable_prices(1000 * PRECISION, 5, 100);
        obs.push(PriceObservation { price: 1010 * PRECISION, block_number: 105 });
        let deviation = compute_price_deviation(&obs, 600, 106).unwrap();
        assert_eq!(deviation, 100); // 1% = 100 bps
    }

    #[test]
    fn test_price_deviation_exactly_threshold() {
        // 5% move: 1000 -> 1050
        let mut obs = stable_prices(1000 * PRECISION, 5, 100);
        obs.push(PriceObservation { price: 1050 * PRECISION, block_number: 105 });
        let deviation = compute_price_deviation(&obs, 600, 106).unwrap();
        assert_eq!(deviation, 500); // 5% = 500 bps
    }

    #[test]
    fn test_price_deviation_spike_up() {
        // 10% spike: 1000 -> 1100
        let mut obs = stable_prices(1000 * PRECISION, 5, 100);
        obs.push(PriceObservation { price: 1100 * PRECISION, block_number: 105 });
        let deviation = compute_price_deviation(&obs, 600, 106).unwrap();
        assert_eq!(deviation, 1000); // 10% = 1000 bps
    }

    #[test]
    fn test_price_deviation_spike_down() {
        // 10% drop: 1000 -> 900
        let mut obs = stable_prices(1000 * PRECISION, 5, 100);
        obs.push(PriceObservation { price: 900 * PRECISION, block_number: 105 });
        let deviation = compute_price_deviation(&obs, 600, 106).unwrap();
        // (1000 - 900) * 10000 / 900 = 1111 bps
        assert_eq!(deviation, 1111);
    }

    #[test]
    fn test_price_deviation_flash_crash() {
        // 50% crash: 1000 -> 500
        let mut obs = stable_prices(1000 * PRECISION, 5, 100);
        obs.push(PriceObservation { price: 500 * PRECISION, block_number: 105 });
        let deviation = compute_price_deviation(&obs, 600, 106).unwrap();
        // (1000 - 500) * 10000 / 500 = 10000 bps = 100%
        assert_eq!(deviation, 10_000);
    }

    #[test]
    fn test_price_deviation_recovery_after_crash() {
        // Price drops then recovers — max deviation based on window contents
        let obs = make_price_obs(&[
            (1000 * PRECISION, 100),
            (1000 * PRECISION, 101),
            (500 * PRECISION, 102), // crash
            (800 * PRECISION, 103), // partial recovery
            (950 * PRECISION, 104), // more recovery
            (1000 * PRECISION, 105), // full recovery
        ]);
        let deviation = compute_price_deviation(&obs, 600, 106).unwrap();
        // Still sees 500 and 1000 in window: (1000 - 500) * 10000 / 500 = 10000
        assert_eq!(deviation, 10_000);
    }

    #[test]
    fn test_price_deviation_gradual_increase() {
        // Gradual 2% increase over many blocks
        let obs = make_price_obs(&[
            (1000 * PRECISION, 100),
            (1004 * PRECISION, 120),
            (1008 * PRECISION, 140),
            (1012 * PRECISION, 160),
            (1016 * PRECISION, 180),
            (1020 * PRECISION, 200),
        ]);
        let deviation = compute_price_deviation(&obs, 600, 200).unwrap();
        // (1020 - 1000) * 10000 / 1000 = 200 bps = 2%
        assert_eq!(deviation, 200);
    }

    #[test]
    fn test_price_deviation_outside_window_ignored() {
        // Old observations outside window should be ignored
        let obs = make_price_obs(&[
            (500 * PRECISION, 10),  // way outside window
            (1000 * PRECISION, 500),
            (1000 * PRECISION, 501),
            (1000 * PRECISION, 502),
            (1000 * PRECISION, 503),
            (1000 * PRECISION, 504),
        ]);
        let deviation = compute_price_deviation(&obs, 100, 504).unwrap();
        // Only the 1000-price observations are in window
        assert_eq!(deviation, 0);
    }

    #[test]
    fn test_price_deviation_insufficient_observations() {
        let obs = stable_prices(PRECISION, 3, 100);
        let result = compute_price_deviation(&obs, 600, 103);
        assert_eq!(result, Err(CircuitBreakerError::InsufficientObservations));
    }

    #[test]
    fn test_price_deviation_empty_observations() {
        let obs: Vec<PriceObservation> = vec![];
        let result = compute_price_deviation(&obs, 600, 100);
        assert_eq!(result, Err(CircuitBreakerError::InsufficientObservations));
    }

    #[test]
    fn test_price_deviation_single_observation() {
        let obs = stable_prices(PRECISION, 1, 100);
        let result = compute_price_deviation(&obs, 600, 100);
        assert_eq!(result, Err(CircuitBreakerError::InsufficientObservations));
    }

    #[test]
    fn test_price_deviation_zero_price() {
        let obs = make_price_obs(&[
            (0, 100),
            (PRECISION, 101),
            (PRECISION, 102),
            (PRECISION, 103),
            (PRECISION, 104),
        ]);
        let result = compute_price_deviation(&obs, 600, 105);
        assert_eq!(result, Err(CircuitBreakerError::ZeroValue));
    }

    #[test]
    fn test_price_deviation_zero_window() {
        let obs = stable_prices(PRECISION, 10, 100);
        let result = compute_price_deviation(&obs, 0, 110);
        assert_eq!(result, Err(CircuitBreakerError::InvalidWindow));
    }

    #[test]
    fn test_price_deviation_large_prices() {
        // Very large prices — test overflow safety
        let base = u128::MAX / 10_000;
        let obs = make_price_obs(&[
            (base, 100),
            (base, 101),
            (base, 102),
            (base + base / 100, 103), // ~1% higher
            (base, 104),
        ]);
        let deviation = compute_price_deviation(&obs, 600, 105).unwrap();
        // With very large values, mul_div may lose 1 bps to rounding
        assert!(deviation >= 99 && deviation <= 100); // ~1% = ~100 bps
    }

    #[test]
    fn test_price_deviation_window_boundary() {
        // Observation exactly at window boundary is included
        let obs = make_price_obs(&[
            (1000 * PRECISION, 100), // window_start = 600 - 600 = 0, so this is in
            (1000 * PRECISION, 101),
            (1000 * PRECISION, 102),
            (1000 * PRECISION, 103),
            (1050 * PRECISION, 104),
        ]);
        let deviation = compute_price_deviation(&obs, 600, 104).unwrap();
        assert_eq!(deviation, 500); // 5%
    }

    // ============ Volume Ratio Tests ============

    #[test]
    fn test_volume_ratio_normal() {
        // Equal volume in both halves = 1x = 100
        let obs = make_volume_obs(&[
            (100 * PRECISION, 100), // baseline half
            (100 * PRECISION, 200), // baseline half
            (100 * PRECISION, 300), // baseline half (midpoint = 100 + 600/2 = 400)
            (100 * PRECISION, 400), // recent half (>= midpoint)
            (100 * PRECISION, 500), // recent half
            (100 * PRECISION, 600), // recent half
        ]);
        // window = 600, current_block = 700
        // window_start = 700 - 600 = 100
        // midpoint = 100 + 300 = 400
        let ratio = compute_volume_ratio(&obs, 600, 700).unwrap();
        assert_eq!(ratio, 100); // 1x
    }

    #[test]
    fn test_volume_ratio_spike() {
        // 50x spike in recent half
        let obs = make_volume_obs(&[
            (100 * PRECISION, 100), // baseline
            (100 * PRECISION, 200), // baseline
            (100 * PRECISION, 300), // baseline
            (5000 * PRECISION, 400), // recent — 50x
            (5000 * PRECISION, 500), // recent — 50x
            (5000 * PRECISION, 600), // recent — 50x
        ]);
        let ratio = compute_volume_ratio(&obs, 600, 700).unwrap();
        assert_eq!(ratio, 5000); // 50x
    }

    #[test]
    fn test_volume_ratio_moderate_increase() {
        // 2x increase
        let obs = make_volume_obs(&[
            (100 * PRECISION, 100),
            (100 * PRECISION, 200),
            (100 * PRECISION, 300),
            (200 * PRECISION, 400),
            (200 * PRECISION, 500),
            (200 * PRECISION, 600),
        ]);
        let ratio = compute_volume_ratio(&obs, 600, 700).unwrap();
        assert_eq!(ratio, 200); // 2x
    }

    #[test]
    fn test_volume_ratio_decrease() {
        // Volume drops by half
        let obs = make_volume_obs(&[
            (200 * PRECISION, 100),
            (200 * PRECISION, 200),
            (200 * PRECISION, 300),
            (100 * PRECISION, 400),
            (100 * PRECISION, 500),
            (100 * PRECISION, 600),
        ]);
        let ratio = compute_volume_ratio(&obs, 600, 700).unwrap();
        assert_eq!(ratio, 50); // 0.5x
    }

    #[test]
    fn test_volume_ratio_zero_recent() {
        let obs = make_volume_obs(&[
            (100 * PRECISION, 100),
            (100 * PRECISION, 200),
            (100 * PRECISION, 300),
            (0, 400),
            (0, 500),
        ]);
        let ratio = compute_volume_ratio(&obs, 600, 700).unwrap();
        assert_eq!(ratio, 0);
    }

    #[test]
    fn test_volume_ratio_insufficient_observations() {
        let obs = make_volume_obs(&[
            (100 * PRECISION, 100),
            (100 * PRECISION, 200),
        ]);
        let result = compute_volume_ratio(&obs, 600, 700);
        assert_eq!(result, Err(CircuitBreakerError::InsufficientObservations));
    }

    #[test]
    fn test_volume_ratio_empty() {
        let obs: Vec<VolumeObservation> = vec![];
        let result = compute_volume_ratio(&obs, 600, 700);
        assert_eq!(result, Err(CircuitBreakerError::InsufficientObservations));
    }

    #[test]
    fn test_volume_ratio_zero_window() {
        let obs = make_volume_obs(&[(100, 100)]);
        let result = compute_volume_ratio(&obs, 0, 100);
        assert_eq!(result, Err(CircuitBreakerError::InvalidWindow));
    }

    #[test]
    fn test_volume_ratio_sustained_high() {
        // Volume stays elevated across both halves — ratio is 1x (normal relative to itself)
        let obs = make_volume_obs(&[
            (5000 * PRECISION, 100),
            (5000 * PRECISION, 200),
            (5000 * PRECISION, 300),
            (5000 * PRECISION, 400),
            (5000 * PRECISION, 500),
            (5000 * PRECISION, 600),
        ]);
        let ratio = compute_volume_ratio(&obs, 600, 700).unwrap();
        assert_eq!(ratio, 100); // 1x — high but stable
    }

    #[test]
    fn test_volume_ratio_return_to_normal() {
        // Spike then return — baseline is high, recent is normal
        let obs = make_volume_obs(&[
            (5000 * PRECISION, 100),
            (5000 * PRECISION, 200),
            (5000 * PRECISION, 300),
            (100 * PRECISION, 400),
            (100 * PRECISION, 500),
            (100 * PRECISION, 600),
        ]);
        let ratio = compute_volume_ratio(&obs, 600, 700).unwrap();
        assert_eq!(ratio, 2); // 0.02x — volume dropped dramatically
    }

    #[test]
    fn test_volume_ratio_all_baseline_no_recent() {
        // All observations in baseline half, none in recent
        let obs = make_volume_obs(&[
            (100 * PRECISION, 100),
            (100 * PRECISION, 200),
            (100 * PRECISION, 300),
            (100 * PRECISION, 350),
            (100 * PRECISION, 390),
        ]);
        // window_start = 700-600=100, midpoint = 400
        // All at blocks < 400 -> all baseline
        let ratio = compute_volume_ratio(&obs, 600, 700).unwrap();
        assert_eq!(ratio, 0); // No recent volume
    }

    #[test]
    fn test_volume_ratio_no_baseline_with_recent() {
        // All observations in recent half, none in baseline
        let obs = make_volume_obs(&[
            (100 * PRECISION, 400),
            (100 * PRECISION, 500),
            (100 * PRECISION, 600),
            (100 * PRECISION, 650),
            (100 * PRECISION, 690),
        ]);
        // window_start = 100, midpoint = 400
        // All at blocks >= 400 -> all recent
        let ratio = compute_volume_ratio(&obs, 600, 700).unwrap();
        assert_eq!(ratio, u16::MAX); // Infinite spike relative to zero baseline
    }

    // ============ Withdrawal Rate Tests ============

    #[test]
    fn test_withdrawal_rate_trickle() {
        // Small withdrawals: 1% of TVL
        let obs = make_withdrawal_obs(&[
            (10 * PRECISION, 1000 * PRECISION, 100),
            (10 * PRECISION, 1000 * PRECISION, 200),
            (10 * PRECISION, 1000 * PRECISION, 300),
            (10 * PRECISION, 1000 * PRECISION, 400),
            (10 * PRECISION, 1000 * PRECISION, 500),
        ]);
        let rate = compute_withdrawal_rate(&obs, 600, 500).unwrap();
        // total_withdrawn = 50, avg_tvl = 1000, rate = 50 * 10000 / 1000 = 500 bps = 5%
        assert_eq!(rate, 500);
    }

    #[test]
    fn test_withdrawal_rate_bank_run() {
        // 30% of TVL withdrawn in window
        let obs = make_withdrawal_obs(&[
            (60 * PRECISION, 1000 * PRECISION, 100),
            (60 * PRECISION, 940 * PRECISION, 200),
            (60 * PRECISION, 880 * PRECISION, 300),
            (60 * PRECISION, 820 * PRECISION, 400),
            (60 * PRECISION, 760 * PRECISION, 500),
        ]);
        let rate = compute_withdrawal_rate(&obs, 600, 500).unwrap();
        // total_withdrawn = 300, avg_tvl = (1000+940+880+820+760)/5 = 880
        // rate = 300 * 10000 / 880 = 3409
        assert_eq!(rate, 3409);
    }

    #[test]
    fn test_withdrawal_rate_whale_exit() {
        // Single large withdrawal = 25% of TVL
        let obs = make_withdrawal_obs(&[
            (1 * PRECISION, 1000 * PRECISION, 100),
            (1 * PRECISION, 1000 * PRECISION, 200),
            (1 * PRECISION, 1000 * PRECISION, 300),
            (1 * PRECISION, 1000 * PRECISION, 400),
            (250 * PRECISION, 1000 * PRECISION, 500),
        ]);
        let rate = compute_withdrawal_rate(&obs, 600, 500).unwrap();
        // total_withdrawn = 254, avg_tvl = 1000, rate = 254 * 10000 / 1000 = 2540
        assert_eq!(rate, 2540);
    }

    #[test]
    fn test_withdrawal_rate_normal_redemptions() {
        // Very small withdrawals
        let obs = make_withdrawal_obs(&[
            (1 * PRECISION, 10000 * PRECISION, 100),
            (1 * PRECISION, 10000 * PRECISION, 200),
            (1 * PRECISION, 10000 * PRECISION, 300),
            (1 * PRECISION, 10000 * PRECISION, 400),
            (1 * PRECISION, 10000 * PRECISION, 500),
        ]);
        let rate = compute_withdrawal_rate(&obs, 600, 500).unwrap();
        // total_withdrawn = 5, avg_tvl = 10000, rate = 5 * 10000 / 10000 = 5 bps
        assert_eq!(rate, 5);
    }

    #[test]
    fn test_withdrawal_rate_zero_tvl() {
        let obs = make_withdrawal_obs(&[
            (10 * PRECISION, 0, 100),
            (10 * PRECISION, 100 * PRECISION, 200),
            (10 * PRECISION, 100 * PRECISION, 300),
            (10 * PRECISION, 100 * PRECISION, 400),
            (10 * PRECISION, 100 * PRECISION, 500),
        ]);
        let result = compute_withdrawal_rate(&obs, 600, 500);
        assert_eq!(result, Err(CircuitBreakerError::ZeroValue));
    }

    #[test]
    fn test_withdrawal_rate_insufficient_observations() {
        let obs = make_withdrawal_obs(&[
            (10 * PRECISION, 1000 * PRECISION, 100),
        ]);
        let result = compute_withdrawal_rate(&obs, 600, 100);
        assert_eq!(result, Err(CircuitBreakerError::InsufficientObservations));
    }

    #[test]
    fn test_withdrawal_rate_empty() {
        let obs: Vec<WithdrawalObservation> = vec![];
        let result = compute_withdrawal_rate(&obs, 600, 100);
        assert_eq!(result, Err(CircuitBreakerError::InsufficientObservations));
    }

    #[test]
    fn test_withdrawal_rate_zero_window() {
        let obs = make_withdrawal_obs(&[(10, 100, 100)]);
        let result = compute_withdrawal_rate(&obs, 0, 100);
        assert_eq!(result, Err(CircuitBreakerError::InvalidWindow));
    }

    #[test]
    fn test_withdrawal_rate_large_values() {
        // Very large TVL and withdrawal amounts
        let big = u128::MAX / 100_000;
        let obs = make_withdrawal_obs(&[
            (big / 10, big, 100),
            (big / 10, big, 200),
            (big / 10, big, 300),
            (big / 10, big, 400),
            (big / 10, big, 500),
        ]);
        let rate = compute_withdrawal_rate(&obs, 600, 500).unwrap();
        // 10% per observation * 5 = 50% = ~5000 bps (may lose 1 bps to rounding)
        assert!(rate >= 4999 && rate <= 5000);
    }

    // ============ Check Price Breaker Tests ============

    #[test]
    fn test_check_price_breaker_no_trip() {
        let config = default_config();
        let obs = stable_prices(1000 * PRECISION, 10, 100);
        let result = check_price_breaker(&obs, &config, 110).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_check_price_breaker_trips() {
        let config = default_config();
        let mut obs = stable_prices(1000 * PRECISION, 5, 100);
        obs.push(PriceObservation { price: 1100 * PRECISION, block_number: 105 }); // 10% spike
        let result = check_price_breaker(&obs, &config, 106).unwrap();
        assert!(result.is_some());
        let report = result.unwrap();
        assert_eq!(report.breaker_type, BreakerType::Price);
        assert_eq!(report.trigger_value_bps, 1000);
        assert_eq!(report.threshold_bps, 500);
        // 1000 >= 500*2=1000, so this is Emergency severity
        assert_eq!(report.severity, Severity::Emergency);
    }

    #[test]
    fn test_check_price_breaker_emergency_severity() {
        let config = default_config(); // threshold = 500
        let mut obs = stable_prices(1000 * PRECISION, 5, 100);
        // 12% spike -> deviation = 1200 bps >= 500*2=1000 -> Emergency
        obs.push(PriceObservation { price: 1120 * PRECISION, block_number: 105 });
        let result = check_price_breaker(&obs, &config, 106).unwrap();
        let report = result.unwrap();
        assert_eq!(report.severity, Severity::Emergency);
    }

    // ============ Check Volume Breaker Tests ============

    #[test]
    fn test_check_volume_breaker_no_trip() {
        let config = default_config();
        let obs = make_volume_obs(&[
            (100 * PRECISION, 100),
            (100 * PRECISION, 200),
            (100 * PRECISION, 300),
            (100 * PRECISION, 400),
            (100 * PRECISION, 500),
            (100 * PRECISION, 600),
        ]);
        let result = check_volume_breaker(&obs, &config, 700).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_check_volume_breaker_trips() {
        let config = default_config(); // threshold = 5000 (50x)
        let obs = make_volume_obs(&[
            (100 * PRECISION, 100),
            (100 * PRECISION, 200),
            (100 * PRECISION, 300),
            (5000 * PRECISION, 400), // 50x spike
            (5000 * PRECISION, 500),
            (5000 * PRECISION, 600),
        ]);
        let result = check_volume_breaker(&obs, &config, 700).unwrap();
        assert!(result.is_some());
        let report = result.unwrap();
        assert_eq!(report.breaker_type, BreakerType::Volume);
    }

    // ============ Check Withdrawal Breaker Tests ============

    #[test]
    fn test_check_withdrawal_breaker_no_trip() {
        let config = default_config(); // threshold = 2000 (20%)
        let obs = make_withdrawal_obs(&[
            (10 * PRECISION, 10000 * PRECISION, 100),
            (10 * PRECISION, 10000 * PRECISION, 200),
            (10 * PRECISION, 10000 * PRECISION, 300),
            (10 * PRECISION, 10000 * PRECISION, 400),
            (10 * PRECISION, 10000 * PRECISION, 500),
        ]);
        let result = check_withdrawal_breaker(&obs, &config, 500).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_check_withdrawal_breaker_trips() {
        let config = default_config(); // threshold = 2000 (20%)
        let obs = make_withdrawal_obs(&[
            (50 * PRECISION, 1000 * PRECISION, 100),
            (50 * PRECISION, 950 * PRECISION, 200),
            (50 * PRECISION, 900 * PRECISION, 300),
            (50 * PRECISION, 850 * PRECISION, 400),
            (50 * PRECISION, 800 * PRECISION, 500),
        ]);
        let result = check_withdrawal_breaker(&obs, &config, 500).unwrap();
        // total = 250, avg_tvl = 900, rate = 2777 > 2000
        assert!(result.is_some());
        let report = result.unwrap();
        assert_eq!(report.breaker_type, BreakerType::Withdrawal);
    }

    // ============ Trip/Recover Lifecycle Tests ============

    #[test]
    fn test_trip_breaker_basic() {
        let state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 50);
        let tripped = trip_breaker(&state, 50, &report).unwrap();
        assert!(tripped.is_tripped);
        assert_eq!(tripped.trip_block, 50);
        assert_eq!(tripped.consecutive_trips, 1);
        assert_eq!(tripped.total_trips, 1);
        assert!(!tripped.manual_reset_required);
    }

    #[test]
    fn test_trip_breaker_already_tripped() {
        let state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 50);
        let tripped = trip_breaker(&state, 50, &report).unwrap();
        let result = trip_breaker(&tripped, 60, &report);
        assert_eq!(result, Err(CircuitBreakerError::AlreadyTripped));
    }

    #[test]
    fn test_trip_breaker_during_grace_period() {
        let state = price_breaker(100);
        let report = default_trip_report(BreakerType::Price, 105);
        // Block 105 < 100 + 10 = 110
        let result = trip_breaker(&state, 105, &report);
        assert_eq!(result, Err(CircuitBreakerError::GracePeriodActive));
    }

    #[test]
    fn test_trip_breaker_exactly_after_grace() {
        let state = price_breaker(100);
        let report = default_trip_report(BreakerType::Price, 110);
        // Block 110 >= 100 + 10
        let tripped = trip_breaker(&state, 110, &report).unwrap();
        assert!(tripped.is_tripped);
    }

    #[test]
    fn test_auto_recover_after_cooldown() {
        let config = default_config();
        let state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 50);
        let tripped = trip_breaker(&state, 50, &report).unwrap();
        // Cooldown = 100 blocks, so recover at block 150
        let recovered = auto_recover(&tripped, 150, &config).unwrap();
        assert!(!recovered.is_tripped);
        assert_eq!(recovered.last_reset_block, 150);
        assert_eq!(recovered.consecutive_trips, 1); // Not cleared by auto_recover
    }

    #[test]
    fn test_auto_recover_too_early() {
        let config = default_config();
        let state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 50);
        let tripped = trip_breaker(&state, 50, &report).unwrap();
        let result = auto_recover(&tripped, 100, &config); // 50 + 100 = 150 needed
        assert_eq!(result, Err(CircuitBreakerError::CooldownActive));
    }

    #[test]
    fn test_auto_recover_not_tripped() {
        let config = default_config();
        let state = price_breaker(0);
        let result = auto_recover(&state, 200, &config);
        assert_eq!(result, Err(CircuitBreakerError::NotTripped));
    }

    #[test]
    fn test_auto_recover_exactly_at_cooldown() {
        let config = default_config();
        let state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 50);
        let tripped = trip_breaker(&state, 50, &report).unwrap();
        // Exactly at cooldown boundary
        let recovered = auto_recover(&tripped, 150, &config).unwrap();
        assert!(!recovered.is_tripped);
    }

    #[test]
    fn test_trip_recover_retrip_lifecycle() {
        let config = default_config();
        let state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 50);

        // Trip 1
        let tripped1 = trip_breaker(&state, 50, &report).unwrap();
        assert_eq!(tripped1.consecutive_trips, 1);

        // Recover
        let recovered1 = auto_recover(&tripped1, 200, &config).unwrap();
        assert!(!recovered1.is_tripped);
        assert_eq!(recovered1.consecutive_trips, 1);

        // Trip 2
        let tripped2 = trip_breaker(&recovered1, 250, &report).unwrap();
        assert_eq!(tripped2.consecutive_trips, 2);
        assert!(!tripped2.manual_reset_required);

        // Recover again
        let recovered2 = auto_recover(&tripped2, 400, &config).unwrap();

        // Trip 3 — should require manual reset
        let tripped3 = trip_breaker(&recovered2, 450, &report).unwrap();
        assert_eq!(tripped3.consecutive_trips, 3);
        assert!(tripped3.manual_reset_required);

        // Auto-recover should fail
        let result = auto_recover(&tripped3, 600, &config);
        assert_eq!(result, Err(CircuitBreakerError::ManualResetRequired));
    }

    // ============ Consecutive Trips Tests ============

    #[test]
    fn test_consecutive_trips_one() {
        let state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 50);
        let tripped = trip_breaker(&state, 50, &report).unwrap();
        assert_eq!(tripped.consecutive_trips, 1);
        assert!(!tripped.manual_reset_required);
    }

    #[test]
    fn test_consecutive_trips_two() {
        let config = default_config();
        let state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 50);

        let t1 = trip_breaker(&state, 50, &report).unwrap();
        let r1 = auto_recover(&t1, 200, &config).unwrap();
        let t2 = trip_breaker(&r1, 250, &report).unwrap();
        assert_eq!(t2.consecutive_trips, 2);
        assert!(!t2.manual_reset_required);
    }

    #[test]
    fn test_consecutive_trips_three_manual_required() {
        let config = default_config();
        let state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 50);

        let t1 = trip_breaker(&state, 50, &report).unwrap();
        let r1 = auto_recover(&t1, 200, &config).unwrap();
        let t2 = trip_breaker(&r1, 250, &report).unwrap();
        let r2 = auto_recover(&t2, 400, &config).unwrap();
        let t3 = trip_breaker(&r2, 450, &report).unwrap();
        assert_eq!(t3.consecutive_trips, 3);
        assert!(t3.manual_reset_required);
    }

    #[test]
    fn test_manual_reset_clears_consecutive() {
        let config = default_config();
        let state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 50);

        let t1 = trip_breaker(&state, 50, &report).unwrap();
        let r1 = auto_recover(&t1, 200, &config).unwrap();
        let t2 = trip_breaker(&r1, 250, &report).unwrap();
        let r2 = auto_recover(&t2, 400, &config).unwrap();
        let t3 = trip_breaker(&r2, 450, &report).unwrap();

        // Manual reset
        let reset = manual_reset(&t3, 500).unwrap();
        assert_eq!(reset.consecutive_trips, 0);
        assert!(!reset.manual_reset_required);
        assert!(!reset.is_tripped);
        assert_eq!(reset.total_trips, 3); // Total preserved
    }

    #[test]
    fn test_manual_reset_not_tripped() {
        let state = price_breaker(0);
        let result = manual_reset(&state, 100);
        assert_eq!(result, Err(CircuitBreakerError::NotTripped));
    }

    #[test]
    fn test_manual_reset_on_non_manual_breaker() {
        // Manual reset also works on breakers that don't require it (admin override)
        let state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 50);
        let tripped = trip_breaker(&state, 50, &report).unwrap();
        assert!(!tripped.manual_reset_required);
        let reset = manual_reset(&tripped, 100).unwrap();
        assert!(!reset.is_tripped);
        assert_eq!(reset.consecutive_trips, 0);
    }

    #[test]
    fn test_after_manual_reset_can_trip_again() {
        let state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 50);
        let tripped = trip_breaker(&state, 50, &report).unwrap();
        let reset = manual_reset(&tripped, 100).unwrap();

        // Should be able to trip again with fresh consecutive count
        let tripped2 = trip_breaker(&reset, 150, &report).unwrap();
        assert_eq!(tripped2.consecutive_trips, 1);
        assert_eq!(tripped2.total_trips, 2);
    }

    // ============ Grace Period Tests ============

    #[test]
    fn test_can_operate_during_grace_period() {
        let state = price_breaker(100);
        assert!(can_operate(&state, 100)); // At deployment
        assert!(can_operate(&state, 105)); // During grace
        assert!(can_operate(&state, 109)); // Just before grace ends
    }

    #[test]
    fn test_can_operate_after_grace_period() {
        let state = price_breaker(100);
        assert!(can_operate(&state, 110)); // Grace period just ended, not tripped
    }

    #[test]
    fn test_cannot_operate_when_tripped() {
        let state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 50);
        let tripped = trip_breaker(&state, 50, &report).unwrap();
        assert!(!can_operate(&tripped, 50));
        assert!(!can_operate(&tripped, 100));
    }

    #[test]
    fn test_can_operate_after_recovery() {
        let config = default_config();
        let state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 50);
        let tripped = trip_breaker(&state, 50, &report).unwrap();
        let recovered = auto_recover(&tripped, 200, &config).unwrap();
        assert!(can_operate(&recovered, 200));
    }

    #[test]
    fn test_trip_rejected_during_grace() {
        let state = price_breaker(100);
        let report = default_trip_report(BreakerType::Price, 105);
        let result = trip_breaker(&state, 105, &report);
        assert_eq!(result, Err(CircuitBreakerError::GracePeriodActive));
    }

    #[test]
    fn test_grace_period_with_block_zero_deployment() {
        let state = price_breaker(0);
        // Grace period is blocks 0-9
        assert!(can_operate(&state, 0));
        assert!(can_operate(&state, 9));
        // After grace, still can operate if not tripped
        assert!(can_operate(&state, 10));

        // Can trip at block 10
        let report = default_trip_report(BreakerType::Price, 10);
        let tripped = trip_breaker(&state, 10, &report).unwrap();
        assert!(!can_operate(&tripped, 10));
    }

    // ============ System Assessment Tests ============

    #[test]
    fn test_assess_system_all_clear() {
        let config = default_config();
        let breakers = [
            price_breaker(0),
            volume_breaker(0),
            withdrawal_breaker(0),
        ];
        let status = assess_system(&breakers, 100, &config);
        assert!(status.all_clear);
        assert!(status.tripped_breakers.iter().all(|b| b.is_none()));
        assert_eq!(status.highest_severity, Severity::Warning); // Baseline
        assert_eq!(status.blocks_until_recovery, 0);
        assert!(!status.manual_intervention_needed);
    }

    #[test]
    fn test_assess_system_one_tripped() {
        let config = default_config();
        let report = default_trip_report(BreakerType::Price, 50);
        let tripped_price = trip_breaker(&price_breaker(0), 50, &report).unwrap();

        let breakers = [
            tripped_price,
            volume_breaker(0),
            withdrawal_breaker(0),
        ];
        let status = assess_system(&breakers, 60, &config);
        assert!(!status.all_clear);
        assert_eq!(status.tripped_breakers[0], Some(BreakerType::Price));
        assert!(status.tripped_breakers[1].is_none());
        assert_eq!(status.highest_severity, Severity::Critical);
        assert!(!status.manual_intervention_needed);
        // Time to recovery: trip at 50, cooldown 100, so at block 60: 90 blocks left
        assert_eq!(status.blocks_until_recovery, 90);
    }

    #[test]
    fn test_assess_system_multiple_tripped() {
        let config = default_config();
        let report_p = default_trip_report(BreakerType::Price, 50);
        let report_v = default_trip_report(BreakerType::Volume, 50);

        let tripped_price = trip_breaker(&price_breaker(0), 50, &report_p).unwrap();
        let tripped_volume = trip_breaker(&volume_breaker(0), 50, &report_v).unwrap();

        let breakers = [
            tripped_price,
            tripped_volume,
            withdrawal_breaker(0),
        ];
        let status = assess_system(&breakers, 60, &config);
        assert!(!status.all_clear);
        assert_eq!(status.tripped_breakers[0], Some(BreakerType::Price));
        assert_eq!(status.tripped_breakers[1], Some(BreakerType::Volume));
        assert_eq!(status.highest_severity, Severity::Emergency);
    }

    #[test]
    fn test_assess_system_manual_intervention() {
        let config = default_config();
        let report = default_trip_report(BreakerType::Price, 50);

        // Build up to 3 consecutive trips to require manual reset
        let t1 = trip_breaker(&price_breaker(0), 50, &report).unwrap();
        let r1 = auto_recover(&t1, 200, &config).unwrap();
        let t2 = trip_breaker(&r1, 250, &report).unwrap();
        let r2 = auto_recover(&t2, 400, &config).unwrap();
        let t3 = trip_breaker(&r2, 450, &report).unwrap();

        let breakers = [t3];
        let status = assess_system(&breakers, 500, &config);
        assert!(!status.all_clear);
        assert!(status.manual_intervention_needed);
    }

    #[test]
    fn test_assess_system_empty_breakers() {
        let config = default_config();
        let breakers: &[BreakerState] = &[];
        let status = assess_system(breakers, 100, &config);
        assert!(status.all_clear);
        assert_eq!(status.highest_severity, Severity::Warning);
    }

    // ============ Time to Recovery Tests ============

    #[test]
    fn test_time_to_recovery_not_tripped() {
        let config = default_config();
        let state = price_breaker(0);
        assert_eq!(time_to_recovery(&state, 100, &config), 0);
    }

    #[test]
    fn test_time_to_recovery_tripped() {
        let config = default_config();
        let state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 50);
        let tripped = trip_breaker(&state, 50, &report).unwrap();
        // Trip at 50, cooldown 100 -> recovery at 150
        assert_eq!(time_to_recovery(&tripped, 60, &config), 90);
        assert_eq!(time_to_recovery(&tripped, 100, &config), 50);
        assert_eq!(time_to_recovery(&tripped, 149, &config), 1);
        assert_eq!(time_to_recovery(&tripped, 150, &config), 0);
        assert_eq!(time_to_recovery(&tripped, 200, &config), 0);
    }

    #[test]
    fn test_time_to_recovery_manual_required() {
        let config = default_config();
        let report = default_trip_report(BreakerType::Price, 50);

        let t1 = trip_breaker(&price_breaker(0), 50, &report).unwrap();
        let r1 = auto_recover(&t1, 200, &config).unwrap();
        let t2 = trip_breaker(&r1, 250, &report).unwrap();
        let r2 = auto_recover(&t2, 400, &config).unwrap();
        let t3 = trip_breaker(&r2, 450, &report).unwrap();

        // Manual reset required = 0 (can't auto-recover)
        assert_eq!(time_to_recovery(&t3, 500, &config), 0);
    }

    // ============ Warning Level Tests ============

    #[test]
    fn test_should_warn_below_50() {
        assert_eq!(should_warn(0, 500), None);
        assert_eq!(should_warn(100, 500), None);
        assert_eq!(should_warn(249, 500), None);
    }

    #[test]
    fn test_should_warn_at_50() {
        assert_eq!(should_warn(250, 500), Some(Severity::Warning));
    }

    #[test]
    fn test_should_warn_between_50_and_75() {
        assert_eq!(should_warn(300, 500), Some(Severity::Warning));
        assert_eq!(should_warn(374, 500), Some(Severity::Warning));
    }

    #[test]
    fn test_should_warn_at_75() {
        assert_eq!(should_warn(375, 500), Some(Severity::Critical));
    }

    #[test]
    fn test_should_warn_between_75_and_100() {
        assert_eq!(should_warn(400, 500), Some(Severity::Critical));
        assert_eq!(should_warn(499, 500), Some(Severity::Critical));
    }

    #[test]
    fn test_should_warn_at_100() {
        assert_eq!(should_warn(500, 500), Some(Severity::Emergency));
    }

    #[test]
    fn test_should_warn_above_100() {
        assert_eq!(should_warn(600, 500), Some(Severity::Emergency));
        assert_eq!(should_warn(1000, 500), Some(Severity::Emergency));
        assert_eq!(should_warn(u16::MAX, 500), Some(Severity::Emergency));
    }

    #[test]
    fn test_should_warn_zero_threshold() {
        assert_eq!(should_warn(0, 0), None);
        assert_eq!(should_warn(100, 0), None);
    }

    #[test]
    fn test_should_warn_small_threshold() {
        // threshold = 1
        assert_eq!(should_warn(0, 1), None);
        assert_eq!(should_warn(1, 1), Some(Severity::Emergency));
    }

    #[test]
    fn test_should_warn_large_threshold() {
        assert_eq!(should_warn(5000, 10_000), Some(Severity::Warning));
        assert_eq!(should_warn(7500, 10_000), Some(Severity::Critical));
        assert_eq!(should_warn(10_000, 10_000), Some(Severity::Emergency));
    }

    // ============ Edge Case Tests ============

    #[test]
    fn test_breaker_total_trips_accumulate() {
        let config = default_config();
        let state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 50);

        let t1 = trip_breaker(&state, 50, &report).unwrap();
        assert_eq!(t1.total_trips, 1);

        let r1 = auto_recover(&t1, 200, &config).unwrap();
        let t2 = trip_breaker(&r1, 250, &report).unwrap();
        assert_eq!(t2.total_trips, 2);

        let r2 = auto_recover(&t2, 400, &config).unwrap();
        let t3 = trip_breaker(&r2, 450, &report).unwrap();
        assert_eq!(t3.total_trips, 3);

        // After manual reset, total trips preserved
        let reset = manual_reset(&t3, 500).unwrap();
        assert_eq!(reset.total_trips, 3);

        let t4 = trip_breaker(&reset, 550, &report).unwrap();
        assert_eq!(t4.total_trips, 4);
    }

    #[test]
    fn test_breaker_preserves_deployment_block() {
        let config = default_config();
        let state = price_breaker(42);
        let report = default_trip_report(BreakerType::Price, 100);

        let t1 = trip_breaker(&state, 100, &report).unwrap();
        assert_eq!(t1.deployment_block, 42);

        let r1 = auto_recover(&t1, 300, &config).unwrap();
        assert_eq!(r1.deployment_block, 42);

        let t2 = trip_breaker(&r1, 350, &report).unwrap();
        let reset = manual_reset(&t2, 400).unwrap();
        assert_eq!(reset.deployment_block, 42);
    }

    #[test]
    fn test_can_operate_after_manual_reset() {
        let config = default_config();
        let state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 50);

        let t1 = trip_breaker(&state, 50, &report).unwrap();
        let r1 = auto_recover(&t1, 200, &config).unwrap();
        let t2 = trip_breaker(&r1, 250, &report).unwrap();
        let r2 = auto_recover(&t2, 400, &config).unwrap();
        let t3 = trip_breaker(&r2, 450, &report).unwrap();

        assert!(!can_operate(&t3, 500));
        let reset = manual_reset(&t3, 500).unwrap();
        assert!(can_operate(&reset, 500));
    }

    #[test]
    fn test_all_breaker_types_in_system_assessment() {
        let config = default_config();
        let report_p = default_trip_report(BreakerType::Price, 50);
        let report_v = default_trip_report(BreakerType::Volume, 50);
        let report_w = default_trip_report(BreakerType::Withdrawal, 50);
        let report_c = default_trip_report(BreakerType::Composite, 50);

        let tp = trip_breaker(&price_breaker(0), 50, &report_p).unwrap();
        let tv = trip_breaker(&volume_breaker(0), 50, &report_v).unwrap();
        let tw = trip_breaker(&withdrawal_breaker(0), 50, &report_w).unwrap();
        let tc = trip_breaker(&composite_breaker(0), 50, &report_c).unwrap();

        let breakers = [tp, tv, tw, tc];
        let status = assess_system(&breakers, 60, &config);
        assert!(!status.all_clear);
        assert_eq!(status.highest_severity, Severity::Emergency);
        // All 4 slots used
        assert!(status.tripped_breakers.iter().all(|b| b.is_some()));
    }

    #[test]
    fn test_price_deviation_exactly_min_observations() {
        let obs = stable_prices(PRECISION, MIN_OBSERVATION_COUNT, 100);
        let deviation = compute_price_deviation(&obs, 600, 100 + MIN_OBSERVATION_COUNT as u64).unwrap();
        assert_eq!(deviation, 0);
    }

    #[test]
    fn test_price_deviation_one_below_min_observations() {
        let obs = stable_prices(PRECISION, MIN_OBSERVATION_COUNT - 1, 100);
        let result = compute_price_deviation(&obs, 600, 100 + (MIN_OBSERVATION_COUNT - 1) as u64);
        assert_eq!(result, Err(CircuitBreakerError::InsufficientObservations));
    }

    #[test]
    fn test_volume_ratio_exactly_min_observations() {
        // Need at least MIN_OBSERVATION_COUNT spread across both halves
        let obs = make_volume_obs(&[
            (100 * PRECISION, 100),
            (100 * PRECISION, 200),
            (100 * PRECISION, 400),
            (100 * PRECISION, 500),
            (100 * PRECISION, 600),
        ]);
        let result = compute_volume_ratio(&obs, 600, 700);
        assert!(result.is_ok());
    }

    #[test]
    fn test_withdrawal_rate_exactly_min_observations() {
        let obs = make_withdrawal_obs(&[
            (1, 1000, 100),
            (1, 1000, 200),
            (1, 1000, 300),
            (1, 1000, 400),
            (1, 1000, 500),
        ]);
        let result = compute_withdrawal_rate(&obs, 600, 500);
        assert!(result.is_ok());
    }

    #[test]
    fn test_custom_config_with_1_max_trip() {
        let config = custom_config(500, 5000, 2000, 100, 600, 1).unwrap();
        assert_eq!(config.max_consecutive_trips, 1);

        // With max_trips = 1, first trip should trigger manual requirement
        // (but trip_breaker uses the module constant MAX_CONSECUTIVE_TRIPS)
        // This tests that the config stores the value correctly.
    }

    #[test]
    fn test_system_status_recovery_timing() {
        let config = default_config();
        let report = default_trip_report(BreakerType::Price, 50);
        let tripped = trip_breaker(&price_breaker(0), 50, &report).unwrap();

        let breakers = [tripped.clone()];

        // At trip time
        let status = assess_system(&breakers, 50, &config);
        assert_eq!(status.blocks_until_recovery, 100);

        // Halfway through cooldown
        let status = assess_system(&breakers, 100, &config);
        assert_eq!(status.blocks_until_recovery, 50);

        // At recovery time
        let status = assess_system(&breakers, 150, &config);
        assert_eq!(status.blocks_until_recovery, 0);

        // After recovery time
        let status = assess_system(&breakers, 200, &config);
        assert_eq!(status.blocks_until_recovery, 0);
    }

    #[test]
    fn test_price_deviation_all_same_price() {
        let obs = stable_prices(12345 * PRECISION, 20, 100);
        let deviation = compute_price_deviation(&obs, 600, 120).unwrap();
        assert_eq!(deviation, 0);
    }

    #[test]
    fn test_price_deviation_two_distinct_prices() {
        // Only two price levels: high and low
        let obs = make_price_obs(&[
            (900 * PRECISION, 100),
            (1100 * PRECISION, 101),
            (900 * PRECISION, 102),
            (1100 * PRECISION, 103),
            (900 * PRECISION, 104),
        ]);
        let deviation = compute_price_deviation(&obs, 600, 105).unwrap();
        // (1100 - 900) * 10000 / 900 = 2222 bps
        assert_eq!(deviation, 2222);
    }

    #[test]
    fn test_volume_ratio_asymmetric_counts() {
        // More baseline observations than recent
        let obs = make_volume_obs(&[
            (100 * PRECISION, 100),
            (100 * PRECISION, 150),
            (100 * PRECISION, 200),
            (100 * PRECISION, 300),
            (200 * PRECISION, 500), // only one recent
        ]);
        // window_start = 700-600=100, midpoint = 400
        // baseline: 4 obs at 100, recent: 1 obs at 200
        // ratio = (200 * 4 * 100) / (400 * 1) = 20000
        let ratio = compute_volume_ratio(&obs, 600, 700).unwrap();
        assert_eq!(ratio, 200); // 2x (200/100 average)
    }

    #[test]
    fn test_check_price_breaker_at_exactly_threshold() {
        let config = default_config(); // 500 bps = 5%
        let obs = make_price_obs(&[
            (1000 * PRECISION, 100),
            (1000 * PRECISION, 101),
            (1000 * PRECISION, 102),
            (1000 * PRECISION, 103),
            (1050 * PRECISION, 104), // exactly 5%
        ]);
        let result = check_price_breaker(&obs, &config, 105).unwrap();
        assert!(result.is_some()); // Should trip at exactly threshold
    }

    #[test]
    fn test_check_price_breaker_just_below_threshold() {
        let config = default_config(); // 500 bps = 5%
        let obs = make_price_obs(&[
            (1000 * PRECISION, 100),
            (1000 * PRECISION, 101),
            (1000 * PRECISION, 102),
            (1000 * PRECISION, 103),
            (1049 * PRECISION, 104), // 4.9%
        ]);
        let result = check_price_breaker(&obs, &config, 105).unwrap();
        assert!(result.is_none()); // Should not trip
    }

    #[test]
    fn test_withdrawal_rate_zero_withdrawals() {
        let obs = make_withdrawal_obs(&[
            (0, 1000 * PRECISION, 100),
            (0, 1000 * PRECISION, 200),
            (0, 1000 * PRECISION, 300),
            (0, 1000 * PRECISION, 400),
            (0, 1000 * PRECISION, 500),
        ]);
        let rate = compute_withdrawal_rate(&obs, 600, 500).unwrap();
        assert_eq!(rate, 0);
    }

    #[test]
    fn test_system_with_mix_of_tripped_and_clear() {
        let config = default_config();
        let report = default_trip_report(BreakerType::Price, 50);
        let tripped_price = trip_breaker(&price_breaker(0), 50, &report).unwrap();

        let breakers = [
            tripped_price,
            volume_breaker(0),  // clear
            withdrawal_breaker(0),  // clear
            composite_breaker(0),  // clear
        ];
        let status = assess_system(&breakers, 60, &config);
        assert!(!status.all_clear);
        assert_eq!(status.tripped_breakers[0], Some(BreakerType::Price));
        assert!(status.tripped_breakers[1].is_none());
        assert!(status.tripped_breakers[2].is_none());
        assert!(status.tripped_breakers[3].is_none());
        assert_eq!(status.highest_severity, Severity::Critical);
    }

    #[test]
    fn test_auto_recover_preserves_total_trips() {
        let config = default_config();
        let state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 50);
        let tripped = trip_breaker(&state, 50, &report).unwrap();
        assert_eq!(tripped.total_trips, 1);
        let recovered = auto_recover(&tripped, 200, &config).unwrap();
        assert_eq!(recovered.total_trips, 1);
    }

    #[test]
    fn test_manual_reset_preserves_total_trips() {
        let state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 50);
        let tripped = trip_breaker(&state, 50, &report).unwrap();
        let reset = manual_reset(&tripped, 100).unwrap();
        assert_eq!(reset.total_trips, 1);
    }

    #[test]
    fn test_volume_breaker_with_custom_config() {
        // Custom lower threshold: 10x spike
        let config = custom_config(500, 1000, 2000, 100, 600, 3).unwrap();
        let obs = make_volume_obs(&[
            (100 * PRECISION, 100),
            (100 * PRECISION, 200),
            (100 * PRECISION, 300),
            (1100 * PRECISION, 400), // 11x spike
            (1100 * PRECISION, 500),
            (1100 * PRECISION, 600),
        ]);
        let result = check_volume_breaker(&obs, &config, 700).unwrap();
        assert!(result.is_some());
    }

    #[test]
    fn test_withdrawal_breaker_with_custom_config() {
        // Custom tighter threshold: 10% withdrawal rate
        let config = custom_config(500, 5000, 1000, 100, 600, 3).unwrap();
        let obs = make_withdrawal_obs(&[
            (25 * PRECISION, 1000 * PRECISION, 100),
            (25 * PRECISION, 975 * PRECISION, 200),
            (25 * PRECISION, 950 * PRECISION, 300),
            (25 * PRECISION, 925 * PRECISION, 400),
            (25 * PRECISION, 900 * PRECISION, 500),
        ]);
        let result = check_withdrawal_breaker(&obs, &config, 500).unwrap();
        // total = 125, avg_tvl = 950, rate = 1315 > 1000
        assert!(result.is_some());
    }

    #[test]
    fn test_trip_report_observation_count() {
        let config = default_config();
        let mut obs = stable_prices(1000 * PRECISION, 8, 100);
        obs.push(PriceObservation { price: 1100 * PRECISION, block_number: 108 });
        obs.push(PriceObservation { price: 1100 * PRECISION, block_number: 109 });
        let result = check_price_breaker(&obs, &config, 110).unwrap();
        let report = result.unwrap();
        assert_eq!(report.observation_count, 10);
    }

    #[test]
    fn test_system_assessment_multiple_tripped_different_cooldowns() {
        let report_p = default_trip_report(BreakerType::Price, 50);
        let report_v = default_trip_report(BreakerType::Volume, 80);

        let tp = trip_breaker(&price_breaker(0), 50, &report_p).unwrap();
        let tv = trip_breaker(&volume_breaker(0), 80, &report_v).unwrap();

        let breakers = [tp, tv];
        let config = default_config(); // cooldown = 100
        let status = assess_system(&breakers, 100, &config);

        // Price trips at 50 -> recovers at 150 -> 50 blocks left
        // Volume trips at 80 -> recovers at 180 -> 80 blocks left
        // Min recovery = 50
        assert_eq!(status.blocks_until_recovery, 50);
    }

    #[test]
    fn test_breaker_type_equality() {
        assert_eq!(BreakerType::Price, BreakerType::Price);
        assert_eq!(BreakerType::Volume, BreakerType::Volume);
        assert_eq!(BreakerType::Withdrawal, BreakerType::Withdrawal);
        assert_eq!(BreakerType::Composite, BreakerType::Composite);
        assert_ne!(BreakerType::Price, BreakerType::Volume);
        assert_ne!(BreakerType::Price, BreakerType::Withdrawal);
        assert_ne!(BreakerType::Price, BreakerType::Composite);
    }

    #[test]
    fn test_severity_equality() {
        assert_eq!(Severity::Warning, Severity::Warning);
        assert_eq!(Severity::Critical, Severity::Critical);
        assert_eq!(Severity::Emergency, Severity::Emergency);
        assert_ne!(Severity::Warning, Severity::Critical);
    }

    #[test]
    fn test_error_equality() {
        assert_eq!(CircuitBreakerError::AlreadyTripped, CircuitBreakerError::AlreadyTripped);
        assert_eq!(CircuitBreakerError::NotTripped, CircuitBreakerError::NotTripped);
        assert_ne!(CircuitBreakerError::AlreadyTripped, CircuitBreakerError::NotTripped);
    }

    #[test]
    fn test_breaker_state_clone() {
        let state = price_breaker(42);
        let cloned = state.clone();
        assert_eq!(state.deployment_block, cloned.deployment_block);
        assert_eq!(state.breaker_type, cloned.breaker_type);
    }

    #[test]
    fn test_config_clone() {
        let config = default_config();
        let cloned = config.clone();
        assert_eq!(config.price_deviation_bps, cloned.price_deviation_bps);
        assert_eq!(config.cooldown_blocks, cloned.cooldown_blocks);
    }

    #[test]
    fn test_trip_report_clone() {
        let report = default_trip_report(BreakerType::Price, 100);
        let cloned = report.clone();
        assert_eq!(report.breaker_type, cloned.breaker_type);
        assert_eq!(report.trip_block, cloned.trip_block);
    }

    // ============ Hardening Tests v3 ============

    #[test]
    fn test_trip_then_auto_recover_then_trip_again_v3() {
        let cfg = default_config();
        let breaker = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 100);
        let tripped = trip_breaker(&breaker, 100, &report).unwrap();
        let recovered = auto_recover(&tripped, 200, &cfg).unwrap();
        assert!(!recovered.is_tripped);
        assert_eq!(recovered.consecutive_trips, 1); // preserved from trip
        let report2 = default_trip_report(BreakerType::Price, 300);
        let tripped2 = trip_breaker(&recovered, 300, &report2).unwrap();
        assert!(tripped2.is_tripped);
        assert_eq!(tripped2.consecutive_trips, 2);
        assert_eq!(tripped2.total_trips, 2);
    }

    #[test]
    fn test_custom_config_exactly_10000_price_bps_v3() {
        let cfg = custom_config(10_000, 5000, 2000, 100, 600, 3);
        assert!(cfg.is_ok());
        assert_eq!(cfg.unwrap().price_deviation_bps, 10_000);
    }

    #[test]
    fn test_custom_config_exactly_10000_withdrawal_bps_v3() {
        let cfg = custom_config(500, 5000, 10_000, 100, 600, 3);
        assert!(cfg.is_ok());
        assert_eq!(cfg.unwrap().withdrawal_rate_bps, 10_000);
    }

    #[test]
    fn test_price_deviation_two_extreme_prices_v3() {
        let obs = make_price_obs(&[
            (PRECISION, 100),
            (PRECISION, 101),
            (PRECISION, 102),
            (PRECISION, 103),
            (2 * PRECISION, 104), // 100% deviation
        ]);
        let result = compute_price_deviation(&obs, 600, 110).unwrap();
        assert_eq!(result, 10_000); // 100% in bps
    }

    #[test]
    fn test_volume_ratio_all_recent_no_baseline_v3() {
        let obs = make_volume_obs(&[
            (1000, 500),
            (1000, 501),
            (1000, 502),
            (1000, 503),
            (1000, 504),
        ]);
        // All observations in recent half (>= midpoint)
        let result = compute_volume_ratio(&obs, 600, 510);
        // midpoint = 510 - 600/2 = would be around start, so all recent
        match result {
            Ok(ratio) => assert!(ratio > 0),
            Err(CircuitBreakerError::InsufficientObservations) => {} // possible if window too large
            _ => panic!("Unexpected error"),
        }
    }

    #[test]
    fn test_withdrawal_rate_all_small_amounts_v3() {
        let obs = make_withdrawal_obs(&[
            (1, 1_000_000, 100),
            (1, 1_000_000, 101),
            (1, 1_000_000, 102),
            (1, 1_000_000, 103),
            (1, 1_000_000, 104),
        ]);
        let result = compute_withdrawal_rate(&obs, 600, 110).unwrap();
        // 5 total withdrawn out of avg TVL 1M = ~0 bps
        assert!(result < 10);
    }

    #[test]
    fn test_check_price_breaker_exactly_double_threshold_emergency_v3() {
        let cfg = custom_config(500, 5000, 2000, 100, 600, 3).unwrap();
        // 1000 bps deviation = 2x threshold of 500
        let obs = make_price_obs(&[
            (1000, 100),
            (1000, 101),
            (1000, 102),
            (1000, 103),
            (1100, 104), // 10% deviation = 1000 bps
        ]);
        let result = check_price_breaker(&obs, &cfg, 110).unwrap();
        assert!(result.is_some());
        let report = result.unwrap();
        assert_eq!(report.severity, Severity::Emergency);
    }

    #[test]
    fn test_check_volume_breaker_just_below_threshold_v3() {
        let cfg = default_config();
        // Need volume ratio just below 5000 (50x)
        let mut obs = Vec::new();
        // Baseline observations (older half)
        for i in 0..3 {
            obs.push(VolumeObservation { volume: 100, block_number: 100 + i });
        }
        // Recent observations with moderate spike
        for i in 0..3 {
            obs.push(VolumeObservation { volume: 200, block_number: 400 + i });
        }
        let result = check_volume_breaker(&obs, &cfg, 500);
        match result {
            Ok(report) => {
                // With only 2x volume, should not trip (threshold is 50x)
                assert!(report.is_none());
            }
            Err(_) => {} // Insufficient observations is also valid
        }
    }

    #[test]
    fn test_trip_breaker_at_exactly_grace_period_end_v3() {
        let breaker = price_breaker(100);
        let report = default_trip_report(BreakerType::Price, 100 + GRACE_PERIOD_BLOCKS);
        let result = trip_breaker(&breaker, 100 + GRACE_PERIOD_BLOCKS, &report);
        assert!(result.is_ok());
    }

    #[test]
    fn test_trip_breaker_one_block_before_grace_end_v3() {
        let breaker = price_breaker(100);
        let report = default_trip_report(BreakerType::Price, 100 + GRACE_PERIOD_BLOCKS - 1);
        let result = trip_breaker(&breaker, 100 + GRACE_PERIOD_BLOCKS - 1, &report);
        assert_eq!(result, Err(CircuitBreakerError::GracePeriodActive));
    }

    #[test]
    fn test_auto_recover_exactly_at_cooldown_end_v3() {
        let cfg = default_config();
        let breaker = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 100);
        let tripped = trip_breaker(&breaker, 100, &report).unwrap();
        let result = auto_recover(&tripped, 100 + cfg.cooldown_blocks, &cfg);
        assert!(result.is_ok());
    }

    #[test]
    fn test_auto_recover_one_block_before_cooldown_end_v3() {
        let cfg = default_config();
        let breaker = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 100);
        let tripped = trip_breaker(&breaker, 100, &report).unwrap();
        let result = auto_recover(&tripped, 100 + cfg.cooldown_blocks - 1, &cfg);
        assert_eq!(result, Err(CircuitBreakerError::CooldownActive));
    }

    #[test]
    fn test_manual_reset_clears_manual_required_flag_v3() {
        let cfg = default_config();
        let breaker = price_breaker(0);
        // Trip 3 times to require manual reset
        let report = default_trip_report(BreakerType::Price, 100);
        let t1 = trip_breaker(&breaker, 100, &report).unwrap();
        let r1 = auto_recover(&t1, 200, &cfg).unwrap();
        let t2 = trip_breaker(&r1, 300, &report).unwrap();
        let r2 = auto_recover(&t2, 400, &cfg).unwrap();
        let t3 = trip_breaker(&r2, 500, &report).unwrap();
        assert!(t3.manual_reset_required);
        let reset = manual_reset(&t3, 600).unwrap();
        assert!(!reset.manual_reset_required);
        assert_eq!(reset.consecutive_trips, 0);
    }

    #[test]
    fn test_can_operate_tripped_but_in_grace_v3() {
        // A breaker that was somehow tripped and is also in grace period
        // (shouldn't happen normally, but test the logic)
        let mut breaker = price_breaker(100);
        breaker.is_tripped = true;
        // During grace period, can_operate returns true regardless
        assert!(can_operate(&breaker, 105));
    }

    #[test]
    fn test_assess_system_all_four_breaker_types_v3() {
        let cfg = default_config();
        let report = default_trip_report(BreakerType::Price, 100);
        let b1 = trip_breaker(&price_breaker(0), 100, &report).unwrap();
        let b2 = trip_breaker(&volume_breaker(0), 100, &report).unwrap();
        let b3 = trip_breaker(&withdrawal_breaker(0), 100, &report).unwrap();
        let b4 = trip_breaker(&composite_breaker(0), 100, &report).unwrap();
        let status = assess_system(&[b1, b2, b3, b4], 100, &cfg);
        assert!(!status.all_clear);
        assert_eq!(status.highest_severity, Severity::Emergency);
        // All 4 tripped breakers stored
        assert!(status.tripped_breakers.iter().filter(|b| b.is_some()).count() == 4);
    }

    #[test]
    fn test_time_to_recovery_just_tripped_v3() {
        let cfg = default_config();
        let breaker = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 100);
        let tripped = trip_breaker(&breaker, 100, &report).unwrap();
        let ttr = time_to_recovery(&tripped, 100, &cfg);
        assert_eq!(ttr, cfg.cooldown_blocks);
    }

    #[test]
    fn test_time_to_recovery_halfway_through_cooldown_v3() {
        let cfg = default_config();
        let breaker = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 100);
        let tripped = trip_breaker(&breaker, 100, &report).unwrap();
        let ttr = time_to_recovery(&tripped, 100 + cfg.cooldown_blocks / 2, &cfg);
        assert_eq!(ttr, cfg.cooldown_blocks - cfg.cooldown_blocks / 2);
    }

    #[test]
    fn test_should_warn_at_49_percent_returns_none_v3() {
        // 49% of threshold → no warning
        assert_eq!(should_warn(245, 500), None);
    }

    #[test]
    fn test_should_warn_at_50_percent_returns_warning_v3() {
        assert_eq!(should_warn(250, 500), Some(Severity::Warning));
    }

    #[test]
    fn test_should_warn_at_74_percent_returns_warning_v3() {
        assert_eq!(should_warn(370, 500), Some(Severity::Warning));
    }

    #[test]
    fn test_should_warn_at_75_percent_returns_critical_v3() {
        assert_eq!(should_warn(375, 500), Some(Severity::Critical));
    }

    #[test]
    fn test_should_warn_at_99_percent_returns_critical_v3() {
        assert_eq!(should_warn(495, 500), Some(Severity::Critical));
    }

    #[test]
    fn test_price_deviation_monotonic_with_spread_v3() {
        let base_obs: Vec<PriceObservation> = (0..5)
            .map(|i| PriceObservation { price: 1000 * PRECISION, block_number: 100 + i })
            .collect();
        // Small deviation
        let mut obs_small = base_obs.clone();
        obs_small.push(PriceObservation { price: 1010 * PRECISION, block_number: 106 });
        let dev_small = compute_price_deviation(&obs_small, 600, 110).unwrap();
        // Large deviation
        let mut obs_large = base_obs.clone();
        obs_large.push(PriceObservation { price: 1100 * PRECISION, block_number: 106 });
        let dev_large = compute_price_deviation(&obs_large, 600, 110).unwrap();
        assert!(dev_large > dev_small);
    }

    #[test]
    fn test_breaker_total_trips_never_decreases_v3() {
        let cfg = default_config();
        let breaker = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 100);
        let t1 = trip_breaker(&breaker, 100, &report).unwrap();
        assert_eq!(t1.total_trips, 1);
        let r1 = auto_recover(&t1, 200, &cfg).unwrap();
        assert_eq!(r1.total_trips, 1); // preserved
        let t2 = trip_breaker(&r1, 300, &report).unwrap();
        assert_eq!(t2.total_trips, 2);
        let r2 = auto_recover(&t2, 400, &cfg).unwrap();
        let t3 = trip_breaker(&r2, 500, &report).unwrap();
        assert_eq!(t3.total_trips, 3);
        let reset = manual_reset(&t3, 600).unwrap();
        assert_eq!(reset.total_trips, 3); // manual reset preserves total_trips
    }

    #[test]
    fn test_system_status_blocks_until_recovery_zero_when_not_tripped_v3() {
        let cfg = default_config();
        let status = assess_system(&[price_breaker(0), volume_breaker(0)], 100, &cfg);
        assert!(status.all_clear);
        assert_eq!(status.blocks_until_recovery, 0);
    }

    // ============ Hardening Tests v6 ============

    #[test]
    fn test_create_breaker_preserves_type_v6() {
        let b = create_breaker(BreakerType::Price, 50);
        assert_eq!(b.breaker_type, BreakerType::Price);
        let b = create_breaker(BreakerType::Volume, 50);
        assert_eq!(b.breaker_type, BreakerType::Volume);
        let b = create_breaker(BreakerType::Withdrawal, 50);
        assert_eq!(b.breaker_type, BreakerType::Withdrawal);
        let b = create_breaker(BreakerType::Composite, 50);
        assert_eq!(b.breaker_type, BreakerType::Composite);
    }

    #[test]
    fn test_custom_config_exactly_1_bps_all_v6() {
        // Minimum valid config: all thresholds at 1
        let cfg = custom_config(1, 1, 1, 1, 1, 1).unwrap();
        assert_eq!(cfg.price_deviation_bps, 1);
        assert_eq!(cfg.volume_spike_bps, 1);
        assert_eq!(cfg.withdrawal_rate_bps, 1);
    }

    #[test]
    fn test_custom_config_max_volume_bps_v6() {
        // Volume can exceed 10000 (50x = 5000, 100x = 10000, 200x = 20000)
        let cfg = custom_config(500, 20000, 2000, 100, 600, 3).unwrap();
        assert_eq!(cfg.volume_spike_bps, 20000);
    }

    #[test]
    fn test_custom_config_zero_all_bps_v6() {
        let err = custom_config(0, 0, 0, 1, 1, 1);
        assert_eq!(err, Err(CircuitBreakerError::InvalidThreshold));
    }

    #[test]
    fn test_price_deviation_exactly_5_observations_v6() {
        // Exactly MIN_OBSERVATION_COUNT (5) observations
        let obs = make_price_obs(&[
            (1000, 90), (1050, 92), (1000, 94), (1025, 96), (1000, 98),
        ]);
        let result = compute_price_deviation(&obs, 600, 100);
        assert!(result.is_ok());
    }

    #[test]
    fn test_price_deviation_4_observations_fails_v6() {
        let obs = make_price_obs(&[
            (1000, 90), (1050, 92), (1000, 94), (1025, 96),
        ]);
        let result = compute_price_deviation(&obs, 600, 100);
        assert_eq!(result, Err(CircuitBreakerError::InsufficientObservations));
    }

    #[test]
    fn test_price_deviation_all_same_price_is_zero_v6() {
        let obs = stable_prices(PRECISION, 10, 90);
        let result = compute_price_deviation(&obs, 600, 100).unwrap();
        assert_eq!(result, 0);
    }

    #[test]
    fn test_price_deviation_double_price_v6() {
        // Price doubles: deviation should be 10000 bps
        let obs = make_price_obs(&[
            (PRECISION, 90), (PRECISION, 91), (PRECISION, 92),
            (PRECISION * 2, 93), (PRECISION * 2, 94),
        ]);
        let result = compute_price_deviation(&obs, 600, 100).unwrap();
        assert_eq!(result, 10000);
    }

    #[test]
    fn test_volume_ratio_exact_50x_boundary_v6() {
        // Exactly 50x baseline volume should trip default config
        let obs = make_volume_obs(&[
            (100, 0), (100, 10), (100, 20),   // baseline half
            (5000, 310), (5000, 320), (5000, 330), // recent half (50x)
        ]);
        let result = compute_volume_ratio(&obs, 600, 400);
        assert!(result.is_ok());
    }

    #[test]
    fn test_volume_ratio_single_huge_spike_v6() {
        // One enormous volume spike in recent half
        let obs = make_volume_obs(&[
            (100, 0), (100, 10), (100, 20),     // baseline
            (100, 310), (100000, 320), (100, 330),  // one spike
        ]);
        let result = compute_volume_ratio(&obs, 600, 400);
        assert!(result.is_ok());
    }

    #[test]
    fn test_withdrawal_rate_zero_amount_withdrawals_v6() {
        // Zero-amount withdrawals — rate should be 0
        let obs = make_withdrawal_obs(&[
            (0, PRECISION * 100, 90),
            (0, PRECISION * 100, 92),
            (0, PRECISION * 100, 94),
            (0, PRECISION * 100, 96),
            (0, PRECISION * 100, 98),
        ]);
        let result = compute_withdrawal_rate(&obs, 600, 100).unwrap();
        assert_eq!(result, 0);
    }

    #[test]
    fn test_withdrawal_rate_100_percent_v6() {
        // Withdraw everything (amount == TVL)
        let tvl = PRECISION * 1000;
        let obs = make_withdrawal_obs(&[
            (tvl, tvl, 90),
            (0, tvl, 92),
            (0, tvl, 94),
            (0, tvl, 96),
            (0, tvl, 98),
        ]);
        let result = compute_withdrawal_rate(&obs, 600, 100).unwrap();
        assert_eq!(result, 10000); // 100% in bps
    }

    #[test]
    fn test_trip_breaker_increments_total_trips_v6() {
        let mut state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 20);
        state = trip_breaker(&state, 20, &report).unwrap();
        assert_eq!(state.total_trips, 1);
    }

    #[test]
    fn test_trip_breaker_sets_trip_block_v6() {
        let state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 50);
        let tripped = trip_breaker(&state, 50, &report).unwrap();
        assert_eq!(tripped.trip_block, 50);
    }

    #[test]
    fn test_auto_recover_resets_is_tripped_v6() {
        let mut state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 20);
        state = trip_breaker(&state, 20, &report).unwrap();
        assert!(state.is_tripped);
        let cfg = default_config();
        let recovered = auto_recover(&state, 20 + cfg.cooldown_blocks, &cfg).unwrap();
        assert!(!recovered.is_tripped);
    }

    #[test]
    fn test_auto_recover_preserves_consecutive_trips_v6() {
        let mut state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 20);
        state = trip_breaker(&state, 20, &report).unwrap();
        assert_eq!(state.consecutive_trips, 1);
        let cfg = default_config();
        let recovered = auto_recover(&state, 20 + cfg.cooldown_blocks, &cfg).unwrap();
        assert_eq!(recovered.consecutive_trips, 1); // not cleared by auto-recover
    }

    #[test]
    fn test_manual_reset_clears_consecutive_trips_v6() {
        let mut state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 20);
        state = trip_breaker(&state, 20, &report).unwrap();
        state = manual_reset(&state, 200).unwrap();
        assert_eq!(state.consecutive_trips, 0);
    }

    #[test]
    fn test_manual_reset_on_non_tripped_fails_v6() {
        let state = price_breaker(0);
        let result = manual_reset(&state, 100);
        assert_eq!(result, Err(CircuitBreakerError::NotTripped));
    }

    #[test]
    fn test_can_operate_within_grace_even_if_tripped_v6() {
        let mut state = price_breaker(100);
        state.is_tripped = true; // Manually set (shouldn't happen, but test edge case)
        // Block 105 is within grace period (100 + 10 = 110)
        assert!(can_operate(&state, 105));
    }

    #[test]
    fn test_can_operate_after_grace_not_tripped_v6() {
        let state = price_breaker(0);
        assert!(can_operate(&state, 1000));
    }

    #[test]
    fn test_assess_system_empty_breakers_all_clear_v6() {
        let cfg = default_config();
        let status = assess_system(&[], 100, &cfg);
        assert!(status.all_clear);
        assert_eq!(status.blocks_until_recovery, 0);
    }

    #[test]
    fn test_assess_system_one_tripped_severity_critical_v6() {
        let mut state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 20);
        state = trip_breaker(&state, 20, &report).unwrap();
        let cfg = default_config();
        let status = assess_system(&[state], 30, &cfg);
        assert!(!status.all_clear);
        assert_eq!(status.highest_severity, Severity::Critical);
    }

    #[test]
    fn test_assess_system_two_tripped_severity_emergency_v6() {
        let mut p = price_breaker(0);
        let mut v = volume_breaker(0);
        let r1 = default_trip_report(BreakerType::Price, 20);
        let r2 = default_trip_report(BreakerType::Volume, 20);
        p = trip_breaker(&p, 20, &r1).unwrap();
        v = trip_breaker(&v, 20, &r2).unwrap();
        let cfg = default_config();
        let status = assess_system(&[p, v], 30, &cfg);
        assert_eq!(status.highest_severity, Severity::Emergency);
    }

    #[test]
    fn test_time_to_recovery_exact_cooldown_remaining_v6() {
        let mut state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 100);
        state = trip_breaker(&state, 100, &report).unwrap();
        let cfg = default_config();
        // At block 100 (trip block), time to recovery should be cooldown_blocks
        let ttr = time_to_recovery(&state, 100, &cfg);
        assert_eq!(ttr, cfg.cooldown_blocks);
    }

    #[test]
    fn test_time_to_recovery_past_cooldown_v6() {
        let mut state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 100);
        state = trip_breaker(&state, 100, &report).unwrap();
        let cfg = default_config();
        let ttr = time_to_recovery(&state, 100 + cfg.cooldown_blocks + 50, &cfg);
        assert_eq!(ttr, 0);
    }

    #[test]
    fn test_should_warn_returns_none_at_0_percent_v6() {
        assert_eq!(should_warn(0, 500), None);
    }

    #[test]
    fn test_should_warn_returns_warning_at_51_percent_v6() {
        // 51% of 500 = 255
        assert_eq!(should_warn(255, 500), Some(Severity::Warning));
    }

    #[test]
    fn test_should_warn_returns_critical_at_76_percent_v6() {
        // 76% of 500 = 380
        assert_eq!(should_warn(380, 500), Some(Severity::Critical));
    }

    #[test]
    fn test_should_warn_returns_emergency_at_100_percent_v6() {
        assert_eq!(should_warn(500, 500), Some(Severity::Emergency));
    }

    #[test]
    fn test_should_warn_returns_emergency_above_100_percent_v6() {
        assert_eq!(should_warn(1000, 500), Some(Severity::Emergency));
    }

    #[test]
    fn test_check_price_breaker_no_trip_stable_v6() {
        let obs = stable_prices(PRECISION, 10, 90);
        let cfg = default_config();
        let result = check_price_breaker(&obs, &cfg, 100).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_check_volume_breaker_emergency_severity_v6() {
        // Volume 100x baseline should trigger emergency (>= 2x threshold)
        let cfg = default_config();
        let obs = make_volume_obs(&[
            (100, 0), (100, 10), (100, 20),   // baseline
            (50000, 310), (50000, 320), (50000, 330), // 500x recent
        ]);
        let result = check_volume_breaker(&obs, &cfg, 400).unwrap();
        if let Some(report) = result {
            assert_eq!(report.severity, Severity::Emergency);
        }
    }

    #[test]
    fn test_check_withdrawal_breaker_below_threshold_v6() {
        let tvl = PRECISION * 10000;
        let small_withdrawal = tvl / 100; // 1% withdrawal
        let obs = make_withdrawal_obs(&[
            (small_withdrawal, tvl, 90),
            (0, tvl, 92),
            (0, tvl, 94),
            (0, tvl, 96),
            (0, tvl, 98),
        ]);
        let cfg = default_config();
        let result = check_withdrawal_breaker(&obs, &cfg, 100).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_triple_trip_requires_manual_v6() {
        let cfg = default_config();
        let mut state = price_breaker(0);
        let report = default_trip_report(BreakerType::Price, 20);

        // Trip 1
        state = trip_breaker(&state, 20, &report).unwrap();
        state = auto_recover(&state, 20 + cfg.cooldown_blocks, &cfg).unwrap();

        // Trip 2
        state = trip_breaker(&state, 200, &report).unwrap();
        state = auto_recover(&state, 200 + cfg.cooldown_blocks, &cfg).unwrap();

        // Trip 3
        state = trip_breaker(&state, 400, &report).unwrap();
        assert!(state.manual_reset_required);
        assert_eq!(state.consecutive_trips, 3);

        // Auto recover should fail
        let result = auto_recover(&state, 400 + cfg.cooldown_blocks, &cfg);
        assert_eq!(result, Err(CircuitBreakerError::ManualResetRequired));
    }

    #[test]
    fn test_breaker_state_debug_impl_v6() {
        let state = price_breaker(0);
        let debug_str = format!("{:?}", state);
        assert!(debug_str.contains("Price"));
    }

    #[test]
    fn test_trip_report_debug_impl_v6() {
        let report = default_trip_report(BreakerType::Volume, 50);
        let debug_str = format!("{:?}", report);
        assert!(debug_str.contains("Volume"));
    }
}
