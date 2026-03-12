// ============ Monitoring Module ============
// Protocol Health Monitoring — real-time monitoring of protocol health metrics,
// anomaly detection, alert thresholds, and automated diagnostics. Aggregates
// data from pools, oracles, circuit breakers, and governance.
//
// All functions are standalone pub fn. No traits, no impl blocks.

// ============ Constants ============

/// Default maximum samples retained
pub const DEFAULT_MAX_SAMPLES: usize = 10_000;

/// Default check interval in milliseconds (60 seconds)
pub const DEFAULT_CHECK_INTERVAL_MS: u64 = 60_000;

/// Basis points denominator
pub const BPS: u64 = 10_000;

/// Health score thresholds
pub const HEALTHY_THRESHOLD: u64 = 9000;
pub const DEGRADED_THRESHOLD: u64 = 7000;
pub const WARNING_THRESHOLD: u64 = 5000;
pub const CRITICAL_THRESHOLD: u64 = 3000;

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum MonitorError {
    NoData,
    ThresholdNotFound,
    AlertNotFound,
    MetricNotFound,
    InsufficientSamples,
    InvalidThreshold,
    CooldownActive,
    Overflow,
}

// ============ Data Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Warning,
    Critical,
    Down,
}

#[derive(Debug, Clone, PartialEq)]
pub enum MetricType {
    Tvl,
    Volume,
    Price,
    Utilization,
    LatencyMs,
    ErrorRate,
    GasPrice,
    PendingTx,
    ActiveUsers,
    ReserveRatio,
}

#[derive(Debug, Clone)]
pub struct MetricSample {
    pub metric_type: MetricType,
    pub value: u64,
    pub timestamp: u64,
    pub source: [u8; 32],
}

#[derive(Debug, Clone)]
pub struct AlertThreshold {
    pub metric_type: MetricType,
    pub warning_above: Option<u64>,
    pub warning_below: Option<u64>,
    pub critical_above: Option<u64>,
    pub critical_below: Option<u64>,
    pub cooldown_ms: u64,
    pub last_triggered: u64,
}

#[derive(Debug, Clone)]
pub struct Alert {
    pub alert_id: u64,
    pub metric_type: MetricType,
    pub status: HealthStatus,
    pub value: u64,
    pub threshold: u64,
    pub timestamp: u64,
    pub source: [u8; 32],
    pub acknowledged: bool,
}

#[derive(Debug, Clone)]
pub struct HealthReport {
    pub overall_status: HealthStatus,
    pub pool_health: u64,
    pub oracle_health: u64,
    pub governance_health: u64,
    pub network_health: u64,
    pub composite_score: u64,
    pub active_alerts: u32,
    pub degraded_components: u32,
    pub generated_at: u64,
}

#[derive(Debug, Clone)]
pub struct Monitor {
    pub samples: Vec<MetricSample>,
    pub thresholds: Vec<AlertThreshold>,
    pub alerts: Vec<Alert>,
    pub max_samples: usize,
    pub next_alert_id: u64,
    pub check_interval_ms: u64,
    pub last_check: u64,
}

#[derive(Debug, Clone)]
pub struct AnomalyResult {
    pub is_anomaly: bool,
    pub z_score: u64,
    pub expected: u64,
    pub actual: u64,
    pub deviation_bps: u64,
}

// ============ Monitor Setup ============

/// Create a new monitor with specified capacity and check interval
pub fn create_monitor(max_samples: usize, check_interval_ms: u64) -> Monitor {
    Monitor {
        samples: Vec::new(),
        thresholds: Vec::new(),
        alerts: Vec::new(),
        max_samples,
        next_alert_id: 1,
        check_interval_ms,
        last_check: 0,
    }
}

/// Create a default monitor: 10000 samples, 60s interval
pub fn default_monitor() -> Monitor {
    create_monitor(DEFAULT_MAX_SAMPLES, DEFAULT_CHECK_INTERVAL_MS)
}

/// Add a threshold configuration to the monitor
pub fn add_threshold(monitor: &mut Monitor, threshold: AlertThreshold) -> Result<(), MonitorError> {
    // Validate: critical thresholds must be more extreme than warning thresholds
    if let (Some(wa), Some(ca)) = (threshold.warning_above, threshold.critical_above) {
        if ca < wa {
            return Err(MonitorError::InvalidThreshold);
        }
    }
    if let (Some(wb), Some(cb)) = (threshold.warning_below, threshold.critical_below) {
        if cb > wb {
            return Err(MonitorError::InvalidThreshold);
        }
    }
    // Replace existing threshold for same metric type
    monitor.thresholds.retain(|t| t.metric_type != threshold.metric_type);
    monitor.thresholds.push(threshold);
    Ok(())
}

/// Remove a threshold for a given metric type
pub fn remove_threshold(monitor: &mut Monitor, metric_type: &MetricType) -> Result<(), MonitorError> {
    let before = monitor.thresholds.len();
    monitor.thresholds.retain(|t| &t.metric_type != metric_type);
    if monitor.thresholds.len() == before {
        return Err(MonitorError::ThresholdNotFound);
    }
    Ok(())
}

/// Return sensible default thresholds for all metric types
pub fn default_thresholds() -> Vec<AlertThreshold> {
    vec![
        AlertThreshold {
            metric_type: MetricType::Tvl,
            warning_above: None,
            warning_below: Some(100_000),
            critical_above: None,
            critical_below: Some(10_000),
            cooldown_ms: 300_000,
            last_triggered: 0,
        },
        AlertThreshold {
            metric_type: MetricType::Volume,
            warning_above: Some(10_000_000),
            warning_below: Some(1_000),
            critical_above: Some(50_000_000),
            critical_below: Some(100),
            cooldown_ms: 300_000,
            last_triggered: 0,
        },
        AlertThreshold {
            metric_type: MetricType::Price,
            warning_above: Some(1_000_000),
            warning_below: Some(100),
            critical_above: Some(10_000_000),
            critical_below: Some(10),
            cooldown_ms: 60_000,
            last_triggered: 0,
        },
        AlertThreshold {
            metric_type: MetricType::Utilization,
            warning_above: Some(9000),
            warning_below: None,
            critical_above: Some(9500),
            critical_below: None,
            cooldown_ms: 120_000,
            last_triggered: 0,
        },
        AlertThreshold {
            metric_type: MetricType::LatencyMs,
            warning_above: Some(5000),
            warning_below: None,
            critical_above: Some(15000),
            critical_below: None,
            cooldown_ms: 60_000,
            last_triggered: 0,
        },
        AlertThreshold {
            metric_type: MetricType::ErrorRate,
            warning_above: Some(500),
            warning_below: None,
            critical_above: Some(2000),
            critical_below: None,
            cooldown_ms: 60_000,
            last_triggered: 0,
        },
        AlertThreshold {
            metric_type: MetricType::GasPrice,
            warning_above: Some(500_000),
            warning_below: None,
            critical_above: Some(2_000_000),
            critical_below: None,
            cooldown_ms: 120_000,
            last_triggered: 0,
        },
        AlertThreshold {
            metric_type: MetricType::PendingTx,
            warning_above: Some(1000),
            warning_below: None,
            critical_above: Some(5000),
            critical_below: None,
            cooldown_ms: 60_000,
            last_triggered: 0,
        },
        AlertThreshold {
            metric_type: MetricType::ActiveUsers,
            warning_above: None,
            warning_below: Some(10),
            critical_above: None,
            critical_below: Some(2),
            cooldown_ms: 600_000,
            last_triggered: 0,
        },
        AlertThreshold {
            metric_type: MetricType::ReserveRatio,
            warning_above: None,
            warning_below: Some(5000),
            critical_above: None,
            critical_below: Some(2000),
            cooldown_ms: 300_000,
            last_triggered: 0,
        },
    ]
}

// ============ Sample Collection ============

/// Record a metric sample, trimming oldest if over max capacity
pub fn record_sample(monitor: &mut Monitor, sample: MetricSample) {
    monitor.samples.push(sample);
    while monitor.samples.len() > monitor.max_samples {
        monitor.samples.remove(0);
    }
}

/// Convenience: record a value with metric type, source, and timestamp
pub fn record_value(monitor: &mut Monitor, metric_type: MetricType, value: u64, source: [u8; 32], now: u64) {
    let sample = MetricSample {
        metric_type,
        value,
        timestamp: now,
        source,
    };
    record_sample(monitor, sample);
}

/// Get the most recent sample for a given metric type
pub fn latest_sample<'a>(monitor: &'a Monitor, metric_type: &MetricType) -> Option<&'a MetricSample> {
    monitor.samples.iter().rev().find(|s| &s.metric_type == metric_type)
}

/// Get all samples for a given metric type
pub fn samples_for<'a>(monitor: &'a Monitor, metric_type: &MetricType) -> Vec<&'a MetricSample> {
    monitor.samples.iter().filter(|s| &s.metric_type == metric_type).collect()
}

/// Get samples for a metric type within a time range [start, end]
pub fn samples_in_range<'a>(monitor: &'a Monitor, metric_type: &MetricType, start: u64, end: u64) -> Vec<&'a MetricSample> {
    monitor.samples.iter()
        .filter(|s| &s.metric_type == metric_type && s.timestamp >= start && s.timestamp <= end)
        .collect()
}

/// Count samples for a metric type
pub fn sample_count(monitor: &Monitor, metric_type: &MetricType) -> usize {
    monitor.samples.iter().filter(|s| &s.metric_type == metric_type).count()
}

// ============ Alert Detection ============

/// Check all latest metric values against their thresholds, return new alerts
pub fn check_thresholds(monitor: &mut Monitor, now: u64) -> Vec<Alert> {
    let mut new_alerts = Vec::new();
    let metric_types = vec![
        MetricType::Tvl, MetricType::Volume, MetricType::Price,
        MetricType::Utilization, MetricType::LatencyMs, MetricType::ErrorRate,
        MetricType::GasPrice, MetricType::PendingTx, MetricType::ActiveUsers,
        MetricType::ReserveRatio,
    ];

    for mt in &metric_types {
        let sample = match monitor.samples.iter().rev().find(|s| &s.metric_type == mt) {
            Some(s) => s.clone(),
            None => continue,
        };
        let threshold = match monitor.thresholds.iter().find(|t| &t.metric_type == mt) {
            Some(t) => t.clone(),
            None => continue,
        };

        if let Some(alert) = evaluate_sample(&sample, &threshold, now) {
            // Check cooldown
            if now.saturating_sub(threshold.last_triggered) >= threshold.cooldown_ms {
                let alert_id = trigger_alert(monitor, alert.clone());
                let mut final_alert = alert;
                final_alert.alert_id = alert_id;
                new_alerts.push(final_alert);
                // Update last_triggered on the threshold
                if let Some(t) = monitor.thresholds.iter_mut().find(|t| &t.metric_type == mt) {
                    t.last_triggered = now;
                }
            }
        }
    }

    monitor.last_check = now;
    new_alerts
}

/// Evaluate a single sample against a threshold, returning an alert if triggered
pub fn evaluate_sample(sample: &MetricSample, threshold: &AlertThreshold, now: u64) -> Option<Alert> {
    // Check critical first (more severe)
    if let Some(ca) = threshold.critical_above {
        if sample.value > ca {
            return Some(Alert {
                alert_id: 0,
                metric_type: sample.metric_type.clone(),
                status: HealthStatus::Critical,
                value: sample.value,
                threshold: ca,
                timestamp: now,
                source: sample.source,
                acknowledged: false,
            });
        }
    }
    if let Some(cb) = threshold.critical_below {
        if sample.value < cb {
            return Some(Alert {
                alert_id: 0,
                metric_type: sample.metric_type.clone(),
                status: HealthStatus::Critical,
                value: sample.value,
                threshold: cb,
                timestamp: now,
                source: sample.source,
                acknowledged: false,
            });
        }
    }
    // Then warning
    if let Some(wa) = threshold.warning_above {
        if sample.value > wa {
            return Some(Alert {
                alert_id: 0,
                metric_type: sample.metric_type.clone(),
                status: HealthStatus::Warning,
                value: sample.value,
                threshold: wa,
                timestamp: now,
                source: sample.source,
                acknowledged: false,
            });
        }
    }
    if let Some(wb) = threshold.warning_below {
        if sample.value < wb {
            return Some(Alert {
                alert_id: 0,
                metric_type: sample.metric_type.clone(),
                status: HealthStatus::Warning,
                value: sample.value,
                threshold: wb,
                timestamp: now,
                source: sample.source,
                acknowledged: false,
            });
        }
    }
    None
}

/// Add an alert to the monitor, returning its assigned alert_id
pub fn trigger_alert(monitor: &mut Monitor, mut alert: Alert) -> u64 {
    let id = monitor.next_alert_id;
    alert.alert_id = id;
    monitor.next_alert_id += 1;
    monitor.alerts.push(alert);
    id
}

/// Acknowledge an alert by id
pub fn acknowledge_alert(monitor: &mut Monitor, alert_id: u64) -> Result<(), MonitorError> {
    match monitor.alerts.iter_mut().find(|a| a.alert_id == alert_id) {
        Some(alert) => {
            alert.acknowledged = true;
            Ok(())
        }
        None => Err(MonitorError::AlertNotFound),
    }
}

/// Resolve (remove) an alert by id
pub fn resolve_alert(monitor: &mut Monitor, alert_id: u64) -> Result<(), MonitorError> {
    let before = monitor.alerts.len();
    monitor.alerts.retain(|a| a.alert_id != alert_id);
    if monitor.alerts.len() == before {
        Err(MonitorError::AlertNotFound)
    } else {
        Ok(())
    }
}

/// Get all unresolved alerts
pub fn active_alerts(monitor: &Monitor) -> Vec<&Alert> {
    monitor.alerts.iter().collect()
}

/// Get all unacknowledged alerts
pub fn unacknowledged_alerts(monitor: &Monitor) -> Vec<&Alert> {
    monitor.alerts.iter().filter(|a| !a.acknowledged).collect()
}

/// Get alerts matching a specific health status
pub fn alerts_by_status<'a>(monitor: &'a Monitor, status: &HealthStatus) -> Vec<&'a Alert> {
    monitor.alerts.iter().filter(|a| &a.status == status).collect()
}

// ============ Anomaly Detection ============

/// Detect if a new value is anomalous relative to historical samples using z-score.
/// z_score is scaled by 100 (250 = 2.5 sigma). Anomaly if z_score > 200.
pub fn detect_anomaly(samples: &[u64], new_value: u64) -> AnomalyResult {
    if samples.is_empty() {
        return AnomalyResult {
            is_anomaly: false,
            z_score: 0,
            expected: 0,
            actual: new_value,
            deviation_bps: 0,
        };
    }

    let n = samples.len() as u128;
    let sum: u128 = samples.iter().map(|&v| v as u128).sum();
    let mean = (sum / n) as u64;

    if samples.len() < 2 {
        let deviation_bps = if mean > 0 {
            let diff = if new_value > mean { new_value - mean } else { mean - new_value };
            ((diff as u128 * BPS as u128) / mean as u128) as u64
        } else {
            0
        };
        return AnomalyResult {
            is_anomaly: false,
            z_score: 0,
            expected: mean,
            actual: new_value,
            deviation_bps,
        };
    }

    // Compute variance
    let variance: u128 = samples.iter().map(|&v| {
        let diff = if v > mean { v - mean } else { mean - v };
        (diff as u128) * (diff as u128)
    }).sum::<u128>() / n;

    // Integer square root of variance = standard deviation
    let std_dev = isqrt(variance);

    let diff = if new_value > mean {
        (new_value - mean) as u128
    } else {
        (mean - new_value) as u128
    };

    let z_score = if std_dev > 0 {
        ((diff * 100) / std_dev) as u64
    } else {
        if diff > 0 { 999 } else { 0 }
    };

    let deviation_bps = if mean > 0 {
        ((diff * BPS as u128) / mean as u128) as u64
    } else {
        0
    };

    AnomalyResult {
        is_anomaly: z_score > 200,
        z_score,
        expected: mean,
        actual: new_value,
        deviation_bps,
    }
}

/// Simple moving average with given window size
pub fn moving_average(samples: &[u64], window: usize) -> Vec<u64> {
    if window == 0 || samples.is_empty() {
        return Vec::new();
    }
    let mut result = Vec::new();
    for i in 0..samples.len() {
        let start = if i + 1 >= window { i + 1 - window } else { 0 };
        let slice = &samples[start..=i];
        let sum: u128 = slice.iter().map(|&v| v as u128).sum();
        result.push((sum / slice.len() as u128) as u64);
    }
    result
}

/// Exponential moving average. alpha_bps in [0, 10000] where 10000 = weight fully on new value
pub fn exponential_moving_average(samples: &[u64], alpha_bps: u64) -> Vec<u64> {
    if samples.is_empty() || alpha_bps > BPS {
        return Vec::new();
    }
    let mut result = Vec::with_capacity(samples.len());
    let mut ema = samples[0] as u128;
    result.push(samples[0]);
    for i in 1..samples.len() {
        let val = samples[i] as u128;
        // ema = alpha * val + (1 - alpha) * ema, all in bps
        ema = (alpha_bps as u128 * val + (BPS as u128 - alpha_bps as u128) * ema) / BPS as u128;
        result.push(ema as u64);
    }
    result
}

/// Compute rate of change (differences) between consecutive samples
pub fn rate_of_change(samples: &[u64]) -> Vec<i64> {
    if samples.len() < 2 {
        return Vec::new();
    }
    let mut result = Vec::with_capacity(samples.len() - 1);
    for i in 1..samples.len() {
        result.push(samples[i] as i64 - samples[i - 1] as i64);
    }
    result
}

/// Check if the last `window` values are strictly increasing
pub fn is_trending_up(samples: &[u64], window: usize) -> bool {
    if window < 2 || samples.len() < window {
        return false;
    }
    let start = samples.len() - window;
    for i in start + 1..samples.len() {
        if samples[i] <= samples[i - 1] {
            return false;
        }
    }
    true
}

/// Check if the last `window` values are strictly decreasing
pub fn is_trending_down(samples: &[u64], window: usize) -> bool {
    if window < 2 || samples.len() < window {
        return false;
    }
    let start = samples.len() - window;
    for i in start + 1..samples.len() {
        if samples[i] >= samples[i - 1] {
            return false;
        }
    }
    true
}

// ============ Health Scoring ============

/// Compute a full health report from the monitor's current state
pub fn compute_health_report(monitor: &Monitor, now: u64) -> HealthReport {
    // Pool health from TVL + Volume + Utilization
    let pool_samples: Vec<u64> = samples_for(monitor, &MetricType::Tvl).iter().map(|s| s.value).collect();
    let pool_thresh = monitor.thresholds.iter().find(|t| t.metric_type == MetricType::Tvl);
    let pool_h = match pool_thresh {
        Some(t) => component_health(&pool_samples, t),
        None => if pool_samples.is_empty() { 5000 } else { 8000 },
    };

    // Oracle health from Price + LatencyMs
    let oracle_samples: Vec<u64> = samples_for(monitor, &MetricType::LatencyMs).iter().map(|s| s.value).collect();
    let oracle_thresh = monitor.thresholds.iter().find(|t| t.metric_type == MetricType::LatencyMs);
    let oracle_h = match oracle_thresh {
        Some(t) => component_health(&oracle_samples, t),
        None => if oracle_samples.is_empty() { 5000 } else { 8000 },
    };

    // Governance health from ActiveUsers
    let gov_samples: Vec<u64> = samples_for(monitor, &MetricType::ActiveUsers).iter().map(|s| s.value).collect();
    let gov_thresh = monitor.thresholds.iter().find(|t| t.metric_type == MetricType::ActiveUsers);
    let gov_h = match gov_thresh {
        Some(t) => component_health(&gov_samples, t),
        None => if gov_samples.is_empty() { 5000 } else { 8000 },
    };

    // Network health from ErrorRate + PendingTx
    let net_samples: Vec<u64> = samples_for(monitor, &MetricType::ErrorRate).iter().map(|s| s.value).collect();
    let net_thresh = monitor.thresholds.iter().find(|t| t.metric_type == MetricType::ErrorRate);
    let net_h = match net_thresh {
        Some(t) => component_health(&net_samples, t),
        None => if net_samples.is_empty() { 5000 } else { 8000 },
    };

    let comp = composite_score(pool_h, oracle_h, gov_h, net_h);
    let overall = status_from_score(comp);
    let active = monitor.alerts.len() as u32;
    let mut degraded_count = 0u32;
    if pool_h < HEALTHY_THRESHOLD { degraded_count += 1; }
    if oracle_h < HEALTHY_THRESHOLD { degraded_count += 1; }
    if gov_h < HEALTHY_THRESHOLD { degraded_count += 1; }
    if net_h < HEALTHY_THRESHOLD { degraded_count += 1; }

    HealthReport {
        overall_status: overall,
        pool_health: pool_h,
        oracle_health: oracle_h,
        governance_health: gov_h,
        network_health: net_h,
        composite_score: comp,
        active_alerts: active,
        degraded_components: degraded_count,
        generated_at: now,
    }
}

/// Compute health score (0-10000) for a component from its samples and threshold.
/// Higher = healthier. If no threshold violations, returns 10000.
pub fn component_health(samples: &[u64], threshold: &AlertThreshold) -> u64 {
    if samples.is_empty() {
        return 5000; // unknown = middle
    }
    let latest = samples[samples.len() - 1];

    // Check critical first
    if let Some(ca) = threshold.critical_above {
        if latest > ca {
            return 2000;
        }
    }
    if let Some(cb) = threshold.critical_below {
        if latest < cb {
            return 2000;
        }
    }
    // Check warning
    if let Some(wa) = threshold.warning_above {
        if latest > wa {
            return 6000;
        }
    }
    if let Some(wb) = threshold.warning_below {
        if latest < wb {
            return 6000;
        }
    }
    // All clear
    10000
}

/// Weighted composite score: pool 40%, oracle 30%, governance 15%, network 15%
pub fn composite_score(pool: u64, oracle: u64, gov: u64, network: u64) -> u64 {
    let weighted = pool as u128 * 40 + oracle as u128 * 30 + gov as u128 * 15 + network as u128 * 15;
    (weighted / 100) as u64
}

/// Map a score (0-10000) to a HealthStatus
pub fn status_from_score(score: u64) -> HealthStatus {
    if score >= HEALTHY_THRESHOLD {
        HealthStatus::Healthy
    } else if score >= DEGRADED_THRESHOLD {
        HealthStatus::Degraded
    } else if score >= WARNING_THRESHOLD {
        HealthStatus::Warning
    } else if score >= CRITICAL_THRESHOLD {
        HealthStatus::Critical
    } else {
        HealthStatus::Down
    }
}

/// Return the worst (most severe) status from a list
pub fn worst_status(statuses: &[HealthStatus]) -> HealthStatus {
    let mut worst = HealthStatus::Healthy;
    for s in statuses {
        let rank = status_rank(s);
        if rank > status_rank(&worst) {
            worst = s.clone();
        }
    }
    worst
}

// ============ Trend Analysis ============

/// Compute trend direction in bps. Positive = up, negative = down, 0 = flat.
/// Compares first half average to second half average.
pub fn trend_direction(samples: &[u64]) -> i64 {
    if samples.len() < 2 {
        return 0;
    }
    let mid = samples.len() / 2;
    let first_half = &samples[..mid];
    let second_half = &samples[mid..];

    let avg_first: u128 = first_half.iter().map(|&v| v as u128).sum::<u128>() / first_half.len() as u128;
    let avg_second: u128 = second_half.iter().map(|&v| v as u128).sum::<u128>() / second_half.len() as u128;

    if avg_first == 0 {
        if avg_second > 0 { return BPS as i64; }
        return 0;
    }

    let diff = avg_second as i128 - avg_first as i128;
    ((diff * BPS as i128) / avg_first as i128) as i64
}

/// Coefficient of variation in bps (std_dev / mean * 10000)
pub fn volatility(samples: &[u64]) -> u64 {
    if samples.len() < 2 {
        return 0;
    }
    let n = samples.len() as u128;
    let sum: u128 = samples.iter().map(|&v| v as u128).sum();
    let mean = sum / n;
    if mean == 0 {
        return 0;
    }

    let variance: u128 = samples.iter().map(|&v| {
        let diff = if (v as u128) > mean { v as u128 - mean } else { mean - v as u128 };
        diff * diff
    }).sum::<u128>() / n;

    let std_dev = isqrt(variance);
    ((std_dev * BPS as u128) / mean) as u64
}

/// Pearson correlation * 10000 between two series. Returns value in [-10000, 10000].
/// Series must be equal length and >= 2 elements.
pub fn correlation(a: &[u64], b: &[u64]) -> i64 {
    if a.len() != b.len() || a.len() < 2 {
        return 0;
    }
    let n = a.len() as i128;
    let sum_a: i128 = a.iter().map(|&v| v as i128).sum();
    let sum_b: i128 = b.iter().map(|&v| v as i128).sum();
    let mean_a = sum_a / n;
    let mean_b = sum_b / n;

    let mut cov: i128 = 0;
    let mut var_a: i128 = 0;
    let mut var_b: i128 = 0;

    for i in 0..a.len() {
        let da = a[i] as i128 - mean_a;
        let db = b[i] as i128 - mean_b;
        cov += da * db;
        var_a += da * da;
        var_b += db * db;
    }

    if var_a == 0 || var_b == 0 {
        return 0;
    }

    // correlation = cov / sqrt(var_a * var_b)
    // scaled: result = cov * 10000 / sqrt(var_a * var_b)
    let product = var_a as u128 * var_b as u128;
    let denom = isqrt(product);
    if denom == 0 {
        return 0;
    }

    ((cov * BPS as i128) / denom as i128) as i64
}

/// Find indices where the value jumps by more than threshold_bps from the previous value
pub fn detect_spike(samples: &[u64], threshold_bps: u64) -> Vec<usize> {
    let mut spikes = Vec::new();
    if samples.len() < 2 {
        return spikes;
    }
    for i in 1..samples.len() {
        let prev = samples[i - 1];
        let curr = samples[i];
        if prev == 0 {
            if curr > 0 {
                spikes.push(i);
            }
            continue;
        }
        let diff = if curr > prev { curr - prev } else { prev - curr };
        let change_bps = (diff as u128 * BPS as u128 / prev as u128) as u64;
        if change_bps > threshold_bps {
            spikes.push(i);
        }
    }
    spikes
}

// ============ Reporting ============

/// Summarize a metric: (min, max, mean, median, count)
pub fn summarize_metric(monitor: &Monitor, metric_type: &MetricType) -> (u64, u64, u64, u64, u64) {
    let values: Vec<u64> = samples_for(monitor, metric_type).iter().map(|s| s.value).collect();
    if values.is_empty() {
        return (0, 0, 0, 0, 0);
    }
    let min = *values.iter().min().unwrap();
    let max = *values.iter().max().unwrap();
    let sum: u128 = values.iter().map(|&v| v as u128).sum();
    let mean = (sum / values.len() as u128) as u64;
    let mut sorted = values.clone();
    sorted.sort();
    let median = sorted[sorted.len() / 2];
    (min, max, mean, median, values.len() as u64)
}

/// Percentage of time (in bps) that a metric was above a threshold within a window
pub fn uptime_bps(monitor: &Monitor, metric_type: &MetricType, threshold: u64, now: u64, window_ms: u64) -> u64 {
    let start = now.saturating_sub(window_ms);
    let in_range = samples_in_range(monitor, metric_type, start, now);
    if in_range.is_empty() {
        return 0;
    }
    let above: usize = in_range.iter().filter(|s| s.value >= threshold).count();
    ((above as u128 * BPS as u128) / in_range.len() as u128) as u64
}

/// Milliseconds since the last alert for a given metric type
pub fn time_since_last_alert(monitor: &Monitor, metric_type: &MetricType, now: u64) -> u64 {
    let last = monitor.alerts.iter()
        .filter(|a| &a.metric_type == metric_type)
        .map(|a| a.timestamp)
        .max();
    match last {
        Some(t) => now.saturating_sub(t),
        None => now, // no alert ever = "since the beginning"
    }
}

// ============ Diagnostics ============

/// Per-metric status and short reason string
pub fn diagnose(monitor: &Monitor, now: u64) -> Vec<(MetricType, HealthStatus, String)> {
    let metric_types = vec![
        MetricType::Tvl, MetricType::Volume, MetricType::Price,
        MetricType::Utilization, MetricType::LatencyMs, MetricType::ErrorRate,
        MetricType::GasPrice, MetricType::PendingTx, MetricType::ActiveUsers,
        MetricType::ReserveRatio,
    ];
    let mut results = Vec::new();

    for mt in metric_types {
        let sample = match monitor.samples.iter().rev().find(|s| s.metric_type == mt) {
            Some(s) => s,
            None => {
                results.push((mt, HealthStatus::Warning, "no_data".to_string()));
                continue;
            }
        };
        let threshold = match monitor.thresholds.iter().find(|t| t.metric_type == mt) {
            Some(t) => t,
            None => {
                results.push((mt, HealthStatus::Healthy, "no_threshold".to_string()));
                continue;
            }
        };
        match evaluate_sample(sample, threshold, now) {
            Some(alert) => {
                let reason = match &alert.status {
                    HealthStatus::Critical => {
                        if threshold.critical_above.map_or(false, |ca| sample.value > ca) {
                            "above_critical".to_string()
                        } else {
                            "below_critical".to_string()
                        }
                    }
                    HealthStatus::Warning => {
                        if threshold.warning_above.map_or(false, |wa| sample.value > wa) {
                            "above_warning".to_string()
                        } else {
                            "below_warning".to_string()
                        }
                    }
                    _ => "threshold_breach".to_string(),
                };
                results.push((mt, alert.status, reason));
            }
            None => {
                results.push((mt, HealthStatus::Healthy, "ok".to_string()));
            }
        }
    }
    results
}

/// Human-readable recommended action for a health status
pub fn recommend_action(status: &HealthStatus) -> &'static str {
    match status {
        HealthStatus::Healthy => "no action needed",
        HealthStatus::Degraded => "monitor closely, prepare contingency",
        HealthStatus::Warning => "investigate root cause, alert team",
        HealthStatus::Critical => "immediate intervention required",
        HealthStatus::Down => "emergency protocol: halt operations, escalate",
    }
}

// ============ Cleanup ============

/// Remove samples older than max_age_ms relative to now. Returns count removed.
pub fn trim_samples(monitor: &mut Monitor, max_age_ms: u64, now: u64) -> usize {
    let cutoff = now.saturating_sub(max_age_ms);
    let before = monitor.samples.len();
    monitor.samples.retain(|s| s.timestamp >= cutoff);
    before - monitor.samples.len()
}

/// Remove all acknowledged alerts. Returns count removed.
pub fn clear_resolved_alerts(monitor: &mut Monitor) -> usize {
    let before = monitor.alerts.len();
    monitor.alerts.retain(|a| !a.acknowledged);
    before - monitor.alerts.len()
}

/// Remove alerts with timestamp before the given time. Returns count removed.
pub fn prune_old_alerts(monitor: &mut Monitor, before_ts: u64) -> usize {
    let before = monitor.alerts.len();
    monitor.alerts.retain(|a| a.timestamp >= before_ts);
    before - monitor.alerts.len()
}

// ============ Statistics ============

/// (total_samples, total_alerts, active_alerts, threshold_count)
pub fn monitor_stats(monitor: &Monitor) -> (u64, u64, u64, u64) {
    (
        monitor.samples.len() as u64,
        monitor.next_alert_id - 1, // total ever created
        monitor.alerts.len() as u64,
        monitor.thresholds.len() as u64,
    )
}

/// Count of alerts within the given window
pub fn alert_rate(monitor: &Monitor, window_ms: u64, now: u64) -> u64 {
    let cutoff = now.saturating_sub(window_ms);
    monitor.alerts.iter().filter(|a| a.timestamp >= cutoff).count() as u64
}

/// Average time to acknowledge alerts (ms). Only counts acknowledged alerts.
pub fn mean_time_to_acknowledge(monitor: &Monitor) -> u64 {
    // We don't store ack timestamp separately, so we approximate:
    // For acknowledged alerts, use 0 (already handled).
    // This is a simplified version — in production we'd track ack_timestamp.
    // Here, we return the average age at time of latest sample as proxy.
    let acked: Vec<&Alert> = monitor.alerts.iter().filter(|a| a.acknowledged).collect();
    if acked.is_empty() {
        return 0;
    }
    // Use the last sample timestamp as a proxy for "now"
    let latest_ts = monitor.samples.iter().map(|s| s.timestamp).max().unwrap_or(0);
    if latest_ts == 0 {
        return 0;
    }
    let total: u128 = acked.iter().map(|a| latest_ts.saturating_sub(a.timestamp) as u128).sum();
    (total / acked.len() as u128) as u64
}

/// Ratio of acknowledged (resolved) alerts to total alerts, in bps (0-10000)
pub fn false_alert_rate(monitor: &Monitor) -> u64 {
    if monitor.alerts.is_empty() {
        return 0;
    }
    let acked = monitor.alerts.iter().filter(|a| a.acknowledged).count() as u128;
    let total = monitor.alerts.len() as u128;
    ((acked * BPS as u128) / total) as u64
}

// ============ Internal Helpers ============

/// Integer square root via Newton's method
fn isqrt(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

/// Numeric rank for HealthStatus (higher = worse)
fn status_rank(s: &HealthStatus) -> u8 {
    match s {
        HealthStatus::Healthy => 0,
        HealthStatus::Degraded => 1,
        HealthStatus::Warning => 2,
        HealthStatus::Critical => 3,
        HealthStatus::Down => 4,
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn src() -> [u8; 32] { [1u8; 32] }
    fn src2() -> [u8; 32] { [2u8; 32] }

    fn make_sample(mt: MetricType, value: u64, ts: u64) -> MetricSample {
        MetricSample { metric_type: mt, value, timestamp: ts, source: src() }
    }

    fn make_threshold(mt: MetricType) -> AlertThreshold {
        AlertThreshold {
            metric_type: mt,
            warning_above: Some(8000),
            warning_below: Some(1000),
            critical_above: Some(15000),
            critical_below: Some(100),
            cooldown_ms: 1000,
            last_triggered: 0,
        }
    }

    fn populated_monitor() -> Monitor {
        let mut m = create_monitor(100, 1000);
        for i in 0..10 {
            record_value(&mut m, MetricType::Tvl, 5000 + i * 100, src(), 1000 + i * 100);
            record_value(&mut m, MetricType::Volume, 2000 + i * 50, src(), 1000 + i * 100);
            record_value(&mut m, MetricType::LatencyMs, 200 + i * 10, src(), 1000 + i * 100);
        }
        let _ = add_threshold(&mut m, make_threshold(MetricType::Tvl));
        let _ = add_threshold(&mut m, make_threshold(MetricType::Volume));
        let _ = add_threshold(&mut m, make_threshold(MetricType::LatencyMs));
        m
    }

    // ---- Monitor Setup (tests 1-18) ----

    #[test]
    fn test_create_monitor_custom() {
        let m = create_monitor(500, 30_000);
        assert_eq!(m.max_samples, 500);
        assert_eq!(m.check_interval_ms, 30_000);
        assert!(m.samples.is_empty());
        assert!(m.thresholds.is_empty());
        assert!(m.alerts.is_empty());
        assert_eq!(m.next_alert_id, 1);
    }

    #[test]
    fn test_create_monitor_zero_samples() {
        let m = create_monitor(0, 1000);
        assert_eq!(m.max_samples, 0);
    }

    #[test]
    fn test_default_monitor() {
        let m = default_monitor();
        assert_eq!(m.max_samples, DEFAULT_MAX_SAMPLES);
        assert_eq!(m.check_interval_ms, DEFAULT_CHECK_INTERVAL_MS);
    }

    #[test]
    fn test_add_threshold_basic() {
        let mut m = default_monitor();
        let t = make_threshold(MetricType::Tvl);
        assert!(add_threshold(&mut m, t).is_ok());
        assert_eq!(m.thresholds.len(), 1);
    }

    #[test]
    fn test_add_threshold_replaces_existing() {
        let mut m = default_monitor();
        let t1 = make_threshold(MetricType::Tvl);
        let _ = add_threshold(&mut m, t1);
        let mut t2 = make_threshold(MetricType::Tvl);
        t2.warning_above = Some(9999);
        let _ = add_threshold(&mut m, t2);
        assert_eq!(m.thresholds.len(), 1);
        assert_eq!(m.thresholds[0].warning_above, Some(9999));
    }

    #[test]
    fn test_add_threshold_invalid_above() {
        let mut m = default_monitor();
        let t = AlertThreshold {
            metric_type: MetricType::Tvl,
            warning_above: Some(10000),
            warning_below: None,
            critical_above: Some(5000), // critical < warning = invalid
            critical_below: None,
            cooldown_ms: 1000,
            last_triggered: 0,
        };
        assert_eq!(add_threshold(&mut m, t), Err(MonitorError::InvalidThreshold));
    }

    #[test]
    fn test_add_threshold_invalid_below() {
        let mut m = default_monitor();
        let t = AlertThreshold {
            metric_type: MetricType::Tvl,
            warning_above: None,
            warning_below: Some(100),
            critical_above: None,
            critical_below: Some(500), // critical > warning = invalid for below
            cooldown_ms: 1000,
            last_triggered: 0,
        };
        assert_eq!(add_threshold(&mut m, t), Err(MonitorError::InvalidThreshold));
    }

    #[test]
    fn test_add_threshold_no_limits_ok() {
        let mut m = default_monitor();
        let t = AlertThreshold {
            metric_type: MetricType::Price,
            warning_above: None,
            warning_below: None,
            critical_above: None,
            critical_below: None,
            cooldown_ms: 0,
            last_triggered: 0,
        };
        assert!(add_threshold(&mut m, t).is_ok());
    }

    #[test]
    fn test_remove_threshold_success() {
        let mut m = default_monitor();
        let _ = add_threshold(&mut m, make_threshold(MetricType::Tvl));
        assert!(remove_threshold(&mut m, &MetricType::Tvl).is_ok());
        assert!(m.thresholds.is_empty());
    }

    #[test]
    fn test_remove_threshold_not_found() {
        let mut m = default_monitor();
        assert_eq!(remove_threshold(&mut m, &MetricType::Tvl), Err(MonitorError::ThresholdNotFound));
    }

    #[test]
    fn test_default_thresholds_count() {
        let t = default_thresholds();
        assert_eq!(t.len(), 10); // one per MetricType
    }

    #[test]
    fn test_default_thresholds_tvl_has_below_only() {
        let t = default_thresholds();
        let tvl = t.iter().find(|x| x.metric_type == MetricType::Tvl).unwrap();
        assert!(tvl.warning_above.is_none());
        assert!(tvl.warning_below.is_some());
    }

    #[test]
    fn test_add_multiple_thresholds() {
        let mut m = default_monitor();
        for t in default_thresholds() {
            assert!(add_threshold(&mut m, t).is_ok());
        }
        assert_eq!(m.thresholds.len(), 10);
    }

    #[test]
    fn test_add_threshold_equal_warning_critical_ok() {
        let mut m = default_monitor();
        let t = AlertThreshold {
            metric_type: MetricType::Tvl,
            warning_above: Some(5000),
            warning_below: None,
            critical_above: Some(5000), // equal is ok
            critical_below: None,
            cooldown_ms: 100,
            last_triggered: 0,
        };
        assert!(add_threshold(&mut m, t).is_ok());
    }

    #[test]
    fn test_create_monitor_large_capacity() {
        let m = create_monitor(1_000_000, 1);
        assert_eq!(m.max_samples, 1_000_000);
    }

    #[test]
    fn test_default_monitor_last_check_zero() {
        let m = default_monitor();
        assert_eq!(m.last_check, 0);
    }

    #[test]
    fn test_default_monitor_next_alert_id() {
        let m = default_monitor();
        assert_eq!(m.next_alert_id, 1);
    }

    #[test]
    fn test_remove_threshold_doesnt_affect_others() {
        let mut m = default_monitor();
        let _ = add_threshold(&mut m, make_threshold(MetricType::Tvl));
        let _ = add_threshold(&mut m, make_threshold(MetricType::Volume));
        let _ = remove_threshold(&mut m, &MetricType::Tvl);
        assert_eq!(m.thresholds.len(), 1);
        assert_eq!(m.thresholds[0].metric_type, MetricType::Volume);
    }

    // ---- Sample Collection (tests 19-36) ----

    #[test]
    fn test_record_sample_basic() {
        let mut m = create_monitor(10, 1000);
        record_sample(&mut m, make_sample(MetricType::Tvl, 5000, 100));
        assert_eq!(m.samples.len(), 1);
    }

    #[test]
    fn test_record_sample_trims() {
        let mut m = create_monitor(3, 1000);
        for i in 0..5 {
            record_sample(&mut m, make_sample(MetricType::Tvl, i, i as u64));
        }
        assert_eq!(m.samples.len(), 3);
        assert_eq!(m.samples[0].value, 2);
    }

    #[test]
    fn test_record_value_convenience() {
        let mut m = create_monitor(10, 1000);
        record_value(&mut m, MetricType::Price, 42, src(), 500);
        assert_eq!(m.samples.len(), 1);
        assert_eq!(m.samples[0].value, 42);
    }

    #[test]
    fn test_latest_sample_found() {
        let mut m = create_monitor(10, 1000);
        record_sample(&mut m, make_sample(MetricType::Tvl, 100, 1));
        record_sample(&mut m, make_sample(MetricType::Tvl, 200, 2));
        let s = latest_sample(&m, &MetricType::Tvl).unwrap();
        assert_eq!(s.value, 200);
    }

    #[test]
    fn test_latest_sample_none() {
        let m = create_monitor(10, 1000);
        assert!(latest_sample(&m, &MetricType::Tvl).is_none());
    }

    #[test]
    fn test_latest_sample_correct_type() {
        let mut m = create_monitor(10, 1000);
        record_sample(&mut m, make_sample(MetricType::Tvl, 100, 1));
        record_sample(&mut m, make_sample(MetricType::Price, 200, 2));
        let s = latest_sample(&m, &MetricType::Tvl).unwrap();
        assert_eq!(s.value, 100);
    }

    #[test]
    fn test_samples_for_filters() {
        let mut m = create_monitor(100, 1000);
        record_sample(&mut m, make_sample(MetricType::Tvl, 100, 1));
        record_sample(&mut m, make_sample(MetricType::Price, 200, 2));
        record_sample(&mut m, make_sample(MetricType::Tvl, 300, 3));
        let tvl = samples_for(&m, &MetricType::Tvl);
        assert_eq!(tvl.len(), 2);
    }

    #[test]
    fn test_samples_for_empty() {
        let m = create_monitor(10, 1000);
        assert!(samples_for(&m, &MetricType::Tvl).is_empty());
    }

    #[test]
    fn test_samples_in_range() {
        let mut m = create_monitor(100, 1000);
        for i in 0..10 {
            record_sample(&mut m, make_sample(MetricType::Tvl, i * 100, i * 1000));
        }
        let range = samples_in_range(&m, &MetricType::Tvl, 3000, 6000);
        assert_eq!(range.len(), 4); // timestamps 3000,4000,5000,6000
    }

    #[test]
    fn test_samples_in_range_empty() {
        let mut m = create_monitor(100, 1000);
        record_sample(&mut m, make_sample(MetricType::Tvl, 100, 500));
        let range = samples_in_range(&m, &MetricType::Tvl, 1000, 2000);
        assert!(range.is_empty());
    }

    #[test]
    fn test_sample_count() {
        let mut m = create_monitor(100, 1000);
        record_sample(&mut m, make_sample(MetricType::Tvl, 100, 1));
        record_sample(&mut m, make_sample(MetricType::Tvl, 200, 2));
        record_sample(&mut m, make_sample(MetricType::Price, 300, 3));
        assert_eq!(sample_count(&m, &MetricType::Tvl), 2);
        assert_eq!(sample_count(&m, &MetricType::Price), 1);
        assert_eq!(sample_count(&m, &MetricType::Volume), 0);
    }

    #[test]
    fn test_record_sample_zero_capacity() {
        let mut m = create_monitor(0, 1000);
        record_sample(&mut m, make_sample(MetricType::Tvl, 100, 1));
        assert_eq!(m.samples.len(), 0); // trimmed immediately
    }

    #[test]
    fn test_record_sample_capacity_one() {
        let mut m = create_monitor(1, 1000);
        record_sample(&mut m, make_sample(MetricType::Tvl, 100, 1));
        record_sample(&mut m, make_sample(MetricType::Tvl, 200, 2));
        assert_eq!(m.samples.len(), 1);
        assert_eq!(m.samples[0].value, 200);
    }

    #[test]
    fn test_samples_in_range_inclusive_bounds() {
        let mut m = create_monitor(100, 1000);
        record_sample(&mut m, make_sample(MetricType::Tvl, 100, 5000));
        let range = samples_in_range(&m, &MetricType::Tvl, 5000, 5000);
        assert_eq!(range.len(), 1); // exact match on both bounds
    }

    #[test]
    fn test_record_value_source() {
        let mut m = create_monitor(10, 1000);
        record_value(&mut m, MetricType::Tvl, 42, src2(), 100);
        assert_eq!(m.samples[0].source, src2());
    }

    #[test]
    fn test_latest_sample_many_types() {
        let mut m = create_monitor(100, 1000);
        let types = vec![MetricType::Tvl, MetricType::Volume, MetricType::Price,
                         MetricType::Utilization, MetricType::LatencyMs];
        for (i, mt) in types.iter().enumerate() {
            record_sample(&mut m, make_sample(mt.clone(), (i * 100) as u64, i as u64));
        }
        assert_eq!(latest_sample(&m, &MetricType::Price).unwrap().value, 200);
    }

    #[test]
    fn test_samples_for_preserves_order() {
        let mut m = create_monitor(100, 1000);
        record_sample(&mut m, make_sample(MetricType::Tvl, 10, 1));
        record_sample(&mut m, make_sample(MetricType::Tvl, 20, 2));
        record_sample(&mut m, make_sample(MetricType::Tvl, 30, 3));
        let s = samples_for(&m, &MetricType::Tvl);
        assert_eq!(s[0].value, 10);
        assert_eq!(s[2].value, 30);
    }

    // ---- Alert Detection (tests 37-62) ----

    #[test]
    fn test_evaluate_sample_critical_above() {
        let s = make_sample(MetricType::Tvl, 20000, 100);
        let t = make_threshold(MetricType::Tvl);
        let alert = evaluate_sample(&s, &t, 100).unwrap();
        assert_eq!(alert.status, HealthStatus::Critical);
        assert_eq!(alert.threshold, 15000);
    }

    #[test]
    fn test_evaluate_sample_critical_below() {
        let s = make_sample(MetricType::Tvl, 50, 100);
        let t = make_threshold(MetricType::Tvl);
        let alert = evaluate_sample(&s, &t, 100).unwrap();
        assert_eq!(alert.status, HealthStatus::Critical);
        assert_eq!(alert.threshold, 100);
    }

    #[test]
    fn test_evaluate_sample_warning_above() {
        let s = make_sample(MetricType::Tvl, 10000, 100);
        let t = make_threshold(MetricType::Tvl);
        let alert = evaluate_sample(&s, &t, 100).unwrap();
        assert_eq!(alert.status, HealthStatus::Warning);
    }

    #[test]
    fn test_evaluate_sample_warning_below() {
        let s = make_sample(MetricType::Tvl, 500, 100);
        let t = make_threshold(MetricType::Tvl);
        let alert = evaluate_sample(&s, &t, 100).unwrap();
        assert_eq!(alert.status, HealthStatus::Warning);
    }

    #[test]
    fn test_evaluate_sample_ok() {
        let s = make_sample(MetricType::Tvl, 5000, 100);
        let t = make_threshold(MetricType::Tvl);
        assert!(evaluate_sample(&s, &t, 100).is_none());
    }

    #[test]
    fn test_evaluate_sample_at_warning_boundary() {
        let s = make_sample(MetricType::Tvl, 8000, 100);
        let t = make_threshold(MetricType::Tvl);
        // 8000 is not > 8000, so no alert
        assert!(evaluate_sample(&s, &t, 100).is_none());
    }

    #[test]
    fn test_evaluate_sample_at_critical_boundary() {
        let s = make_sample(MetricType::Tvl, 15000, 100);
        let t = make_threshold(MetricType::Tvl);
        // 15000 is not > 15000, so only warning
        let alert = evaluate_sample(&s, &t, 100).unwrap();
        assert_eq!(alert.status, HealthStatus::Warning);
    }

    #[test]
    fn test_trigger_alert_returns_id() {
        let mut m = default_monitor();
        let a = Alert {
            alert_id: 0,
            metric_type: MetricType::Tvl,
            status: HealthStatus::Warning,
            value: 10000,
            threshold: 8000,
            timestamp: 100,
            source: src(),
            acknowledged: false,
        };
        let id = trigger_alert(&mut m, a);
        assert_eq!(id, 1);
        assert_eq!(m.next_alert_id, 2);
    }

    #[test]
    fn test_trigger_alert_increments_id() {
        let mut m = default_monitor();
        for _ in 0..3 {
            let a = Alert {
                alert_id: 0,
                metric_type: MetricType::Tvl,
                status: HealthStatus::Warning,
                value: 10000,
                threshold: 8000,
                timestamp: 100,
                source: src(),
                acknowledged: false,
            };
            trigger_alert(&mut m, a);
        }
        assert_eq!(m.next_alert_id, 4);
        assert_eq!(m.alerts[2].alert_id, 3);
    }

    #[test]
    fn test_acknowledge_alert_success() {
        let mut m = default_monitor();
        let a = Alert {
            alert_id: 0, metric_type: MetricType::Tvl,
            status: HealthStatus::Warning, value: 10000, threshold: 8000,
            timestamp: 100, source: src(), acknowledged: false,
        };
        let id = trigger_alert(&mut m, a);
        assert!(acknowledge_alert(&mut m, id).is_ok());
        assert!(m.alerts[0].acknowledged);
    }

    #[test]
    fn test_acknowledge_alert_not_found() {
        let mut m = default_monitor();
        assert_eq!(acknowledge_alert(&mut m, 999), Err(MonitorError::AlertNotFound));
    }

    #[test]
    fn test_resolve_alert_success() {
        let mut m = default_monitor();
        let a = Alert {
            alert_id: 0, metric_type: MetricType::Tvl,
            status: HealthStatus::Warning, value: 10000, threshold: 8000,
            timestamp: 100, source: src(), acknowledged: false,
        };
        let id = trigger_alert(&mut m, a);
        assert!(resolve_alert(&mut m, id).is_ok());
        assert!(m.alerts.is_empty());
    }

    #[test]
    fn test_resolve_alert_not_found() {
        let mut m = default_monitor();
        assert_eq!(resolve_alert(&mut m, 42), Err(MonitorError::AlertNotFound));
    }

    #[test]
    fn test_active_alerts_returns_all() {
        let mut m = default_monitor();
        for i in 0..3 {
            let a = Alert {
                alert_id: 0, metric_type: MetricType::Tvl,
                status: HealthStatus::Warning, value: i, threshold: 0,
                timestamp: 100, source: src(), acknowledged: false,
            };
            trigger_alert(&mut m, a);
        }
        assert_eq!(active_alerts(&m).len(), 3);
    }

    #[test]
    fn test_unacknowledged_alerts() {
        let mut m = default_monitor();
        for _ in 0..3 {
            let a = Alert {
                alert_id: 0, metric_type: MetricType::Tvl,
                status: HealthStatus::Warning, value: 0, threshold: 0,
                timestamp: 100, source: src(), acknowledged: false,
            };
            trigger_alert(&mut m, a);
        }
        let _ = acknowledge_alert(&mut m, 1);
        assert_eq!(unacknowledged_alerts(&m).len(), 2);
    }

    #[test]
    fn test_alerts_by_status() {
        let mut m = default_monitor();
        let a1 = Alert {
            alert_id: 0, metric_type: MetricType::Tvl,
            status: HealthStatus::Warning, value: 0, threshold: 0,
            timestamp: 100, source: src(), acknowledged: false,
        };
        let a2 = Alert {
            alert_id: 0, metric_type: MetricType::Tvl,
            status: HealthStatus::Critical, value: 0, threshold: 0,
            timestamp: 100, source: src(), acknowledged: false,
        };
        trigger_alert(&mut m, a1);
        trigger_alert(&mut m, a2);
        assert_eq!(alerts_by_status(&m, &HealthStatus::Warning).len(), 1);
        assert_eq!(alerts_by_status(&m, &HealthStatus::Critical).len(), 1);
        assert_eq!(alerts_by_status(&m, &HealthStatus::Healthy).len(), 0);
    }

    #[test]
    fn test_check_thresholds_triggers_alerts() {
        let mut m = create_monitor(100, 1000);
        let _ = add_threshold(&mut m, make_threshold(MetricType::Tvl));
        record_value(&mut m, MetricType::Tvl, 20000, src(), 5000); // above critical
        let alerts = check_thresholds(&mut m, 5000);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].status, HealthStatus::Critical);
    }

    #[test]
    fn test_check_thresholds_respects_cooldown() {
        let mut m = create_monitor(100, 1000);
        let _ = add_threshold(&mut m, make_threshold(MetricType::Tvl)); // cooldown=1000
        record_value(&mut m, MetricType::Tvl, 20000, src(), 5000);
        let a1 = check_thresholds(&mut m, 5000);
        assert_eq!(a1.len(), 1);
        // Check again within cooldown
        let a2 = check_thresholds(&mut m, 5500);
        assert_eq!(a2.len(), 0);
        // After cooldown
        let a3 = check_thresholds(&mut m, 6001);
        assert_eq!(a3.len(), 1);
    }

    #[test]
    fn test_check_thresholds_no_samples() {
        let mut m = create_monitor(100, 1000);
        let _ = add_threshold(&mut m, make_threshold(MetricType::Tvl));
        let alerts = check_thresholds(&mut m, 1000);
        assert!(alerts.is_empty());
    }

    #[test]
    fn test_check_thresholds_no_threshold() {
        let mut m = create_monitor(100, 1000);
        record_value(&mut m, MetricType::Tvl, 20000, src(), 5000);
        let alerts = check_thresholds(&mut m, 5000);
        assert!(alerts.is_empty());
    }

    #[test]
    fn test_check_thresholds_updates_last_check() {
        let mut m = create_monitor(100, 1000);
        check_thresholds(&mut m, 42000);
        assert_eq!(m.last_check, 42000);
    }

    #[test]
    fn test_evaluate_sample_no_thresholds_set() {
        let s = make_sample(MetricType::Tvl, 5000, 100);
        let t = AlertThreshold {
            metric_type: MetricType::Tvl,
            warning_above: None, warning_below: None,
            critical_above: None, critical_below: None,
            cooldown_ms: 0, last_triggered: 0,
        };
        assert!(evaluate_sample(&s, &t, 100).is_none());
    }

    #[test]
    fn test_alert_source_propagation() {
        let s = make_sample(MetricType::Tvl, 20000, 100);
        let t = make_threshold(MetricType::Tvl);
        let alert = evaluate_sample(&s, &t, 100).unwrap();
        assert_eq!(alert.source, src());
    }

    #[test]
    fn test_evaluate_sample_critical_takes_priority() {
        // Value is both above warning and above critical — critical wins
        let s = make_sample(MetricType::Tvl, 20000, 100);
        let t = make_threshold(MetricType::Tvl);
        let alert = evaluate_sample(&s, &t, 100).unwrap();
        assert_eq!(alert.status, HealthStatus::Critical);
    }

    // ---- Anomaly Detection (tests 63-90) ----

    #[test]
    fn test_detect_anomaly_empty() {
        let r = detect_anomaly(&[], 100);
        assert!(!r.is_anomaly);
        assert_eq!(r.actual, 100);
    }

    #[test]
    fn test_detect_anomaly_single_sample() {
        let r = detect_anomaly(&[100], 100);
        assert!(!r.is_anomaly);
        assert_eq!(r.expected, 100);
    }

    #[test]
    fn test_detect_anomaly_normal_value() {
        let samples = vec![100, 102, 98, 101, 99, 100, 103, 97];
        let r = detect_anomaly(&samples, 101);
        assert!(!r.is_anomaly);
    }

    #[test]
    fn test_detect_anomaly_outlier() {
        let samples = vec![100, 100, 100, 100, 100, 100, 100, 100];
        let r = detect_anomaly(&samples, 500);
        assert!(r.is_anomaly);
        assert!(r.z_score > 200);
    }

    #[test]
    fn test_detect_anomaly_z_score_scaling() {
        let samples = vec![100, 100, 100, 100];
        let r = detect_anomaly(&samples, 100);
        assert_eq!(r.z_score, 0);
    }

    #[test]
    fn test_detect_anomaly_deviation_bps() {
        let samples = vec![1000, 1000, 1000, 1000];
        let r = detect_anomaly(&samples, 1100);
        assert_eq!(r.deviation_bps, 1000); // 10% = 1000 bps
    }

    #[test]
    fn test_moving_average_basic() {
        let samples = vec![10, 20, 30, 40, 50];
        let ma = moving_average(&samples, 3);
        assert_eq!(ma.len(), 5);
        assert_eq!(ma[0], 10); // only 1 element in window
        assert_eq!(ma[2], 20); // (10+20+30)/3
        assert_eq!(ma[4], 40); // (30+40+50)/3
    }

    #[test]
    fn test_moving_average_window_one() {
        let samples = vec![10, 20, 30];
        let ma = moving_average(&samples, 1);
        assert_eq!(ma, vec![10, 20, 30]);
    }

    #[test]
    fn test_moving_average_empty() {
        let ma = moving_average(&[], 3);
        assert!(ma.is_empty());
    }

    #[test]
    fn test_moving_average_zero_window() {
        let ma = moving_average(&[1, 2, 3], 0);
        assert!(ma.is_empty());
    }

    #[test]
    fn test_moving_average_window_larger_than_data() {
        let samples = vec![10, 20];
        let ma = moving_average(&samples, 5);
        assert_eq!(ma[0], 10);
        assert_eq!(ma[1], 15);
    }

    #[test]
    fn test_ema_basic() {
        let samples = vec![100, 200, 300];
        let ema = exponential_moving_average(&samples, 5000); // alpha=0.5
        assert_eq!(ema.len(), 3);
        assert_eq!(ema[0], 100);
        assert_eq!(ema[1], 150); // 0.5*200 + 0.5*100
        assert_eq!(ema[2], 225); // 0.5*300 + 0.5*150
    }

    #[test]
    fn test_ema_alpha_zero() {
        let samples = vec![100, 200, 300];
        let ema = exponential_moving_average(&samples, 0);
        // alpha=0 means fully weighted on previous, so all stay at first
        assert_eq!(ema, vec![100, 100, 100]);
    }

    #[test]
    fn test_ema_alpha_full() {
        let samples = vec![100, 200, 300];
        let ema = exponential_moving_average(&samples, 10000);
        // alpha=1 means fully weighted on new value
        assert_eq!(ema, vec![100, 200, 300]);
    }

    #[test]
    fn test_ema_empty() {
        let ema = exponential_moving_average(&[], 5000);
        assert!(ema.is_empty());
    }

    #[test]
    fn test_ema_invalid_alpha() {
        let ema = exponential_moving_average(&[100], 10001);
        assert!(ema.is_empty());
    }

    #[test]
    fn test_rate_of_change_basic() {
        let roc = rate_of_change(&[100, 110, 105, 120]);
        assert_eq!(roc, vec![10, -5, 15]);
    }

    #[test]
    fn test_rate_of_change_single() {
        assert!(rate_of_change(&[100]).is_empty());
    }

    #[test]
    fn test_rate_of_change_empty() {
        assert!(rate_of_change(&[]).is_empty());
    }

    #[test]
    fn test_rate_of_change_flat() {
        let roc = rate_of_change(&[50, 50, 50]);
        assert_eq!(roc, vec![0, 0]);
    }

    #[test]
    fn test_is_trending_up_true() {
        assert!(is_trending_up(&[10, 20, 30, 40, 50], 3));
    }

    #[test]
    fn test_is_trending_up_false() {
        assert!(!is_trending_up(&[10, 20, 30, 25, 50], 3));
    }

    #[test]
    fn test_is_trending_up_too_few() {
        assert!(!is_trending_up(&[10], 2));
    }

    #[test]
    fn test_is_trending_up_equal_not_up() {
        assert!(!is_trending_up(&[10, 20, 20], 3));
    }

    #[test]
    fn test_is_trending_down_true() {
        assert!(is_trending_down(&[50, 40, 30, 20, 10], 3));
    }

    #[test]
    fn test_is_trending_down_false() {
        assert!(!is_trending_down(&[50, 40, 45, 20, 25], 3)); // last 3: [45,20,25] not decreasing
    }

    #[test]
    fn test_is_trending_down_too_few() {
        assert!(!is_trending_down(&[50], 2));
    }

    #[test]
    fn test_is_trending_down_window_equals_len() {
        assert!(is_trending_down(&[30, 20, 10], 3));
    }

    #[test]
    fn test_detect_anomaly_below_mean() {
        let samples = vec![1000, 1000, 1000, 1000, 1000];
        let r = detect_anomaly(&samples, 1);
        assert!(r.is_anomaly);
    }

    // ---- Health Scoring (tests 91-115) ----

    #[test]
    fn test_composite_score_all_healthy() {
        assert_eq!(composite_score(10000, 10000, 10000, 10000), 10000);
    }

    #[test]
    fn test_composite_score_all_zero() {
        assert_eq!(composite_score(0, 0, 0, 0), 0);
    }

    #[test]
    fn test_composite_score_weighted() {
        // pool=10000(40%), oracle=0(30%), gov=0(15%), net=0(15%)
        assert_eq!(composite_score(10000, 0, 0, 0), 4000);
    }

    #[test]
    fn test_composite_score_oracle_weight() {
        assert_eq!(composite_score(0, 10000, 0, 0), 3000);
    }

    #[test]
    fn test_composite_score_gov_weight() {
        assert_eq!(composite_score(0, 0, 10000, 0), 1500);
    }

    #[test]
    fn test_composite_score_network_weight() {
        assert_eq!(composite_score(0, 0, 0, 10000), 1500);
    }

    #[test]
    fn test_status_from_score_healthy() {
        assert_eq!(status_from_score(9000), HealthStatus::Healthy);
        assert_eq!(status_from_score(10000), HealthStatus::Healthy);
    }

    #[test]
    fn test_status_from_score_degraded() {
        assert_eq!(status_from_score(7000), HealthStatus::Degraded);
        assert_eq!(status_from_score(8999), HealthStatus::Degraded);
    }

    #[test]
    fn test_status_from_score_warning() {
        assert_eq!(status_from_score(5000), HealthStatus::Warning);
        assert_eq!(status_from_score(6999), HealthStatus::Warning);
    }

    #[test]
    fn test_status_from_score_critical() {
        assert_eq!(status_from_score(3000), HealthStatus::Critical);
        assert_eq!(status_from_score(4999), HealthStatus::Critical);
    }

    #[test]
    fn test_status_from_score_down() {
        assert_eq!(status_from_score(0), HealthStatus::Down);
        assert_eq!(status_from_score(2999), HealthStatus::Down);
    }

    #[test]
    fn test_worst_status_all_healthy() {
        assert_eq!(worst_status(&[HealthStatus::Healthy, HealthStatus::Healthy]), HealthStatus::Healthy);
    }

    #[test]
    fn test_worst_status_mixed() {
        assert_eq!(worst_status(&[HealthStatus::Healthy, HealthStatus::Critical, HealthStatus::Warning]), HealthStatus::Critical);
    }

    #[test]
    fn test_worst_status_down() {
        assert_eq!(worst_status(&[HealthStatus::Down, HealthStatus::Critical]), HealthStatus::Down);
    }

    #[test]
    fn test_worst_status_empty() {
        assert_eq!(worst_status(&[]), HealthStatus::Healthy);
    }

    #[test]
    fn test_component_health_ok() {
        let t = make_threshold(MetricType::Tvl);
        assert_eq!(component_health(&[5000], &t), 10000);
    }

    #[test]
    fn test_component_health_warning() {
        let t = make_threshold(MetricType::Tvl);
        assert_eq!(component_health(&[500], &t), 6000); // below warning
    }

    #[test]
    fn test_component_health_critical() {
        let t = make_threshold(MetricType::Tvl);
        assert_eq!(component_health(&[50], &t), 2000); // below critical
    }

    #[test]
    fn test_component_health_empty() {
        let t = make_threshold(MetricType::Tvl);
        assert_eq!(component_health(&[], &t), 5000);
    }

    #[test]
    fn test_component_health_above_warning() {
        let t = make_threshold(MetricType::Tvl);
        assert_eq!(component_health(&[10000], &t), 6000); // above warning_above=8000
    }

    #[test]
    fn test_component_health_above_critical() {
        let t = make_threshold(MetricType::Tvl);
        assert_eq!(component_health(&[20000], &t), 2000); // above critical_above=15000
    }

    #[test]
    fn test_compute_health_report_empty_monitor() {
        let m = default_monitor();
        let r = compute_health_report(&m, 1000);
        assert_eq!(r.pool_health, 5000);
        assert_eq!(r.oracle_health, 5000);
        assert_eq!(r.active_alerts, 0);
    }

    #[test]
    fn test_compute_health_report_populated() {
        let m = populated_monitor();
        let r = compute_health_report(&m, 2000);
        assert!(r.composite_score > 0);
        assert_eq!(r.generated_at, 2000);
    }

    #[test]
    fn test_compute_health_report_with_alerts() {
        let mut m = populated_monitor();
        let a = Alert {
            alert_id: 0, metric_type: MetricType::Tvl,
            status: HealthStatus::Warning, value: 0, threshold: 0,
            timestamp: 100, source: src(), acknowledged: false,
        };
        trigger_alert(&mut m, a);
        let r = compute_health_report(&m, 2000);
        assert_eq!(r.active_alerts, 1);
    }

    #[test]
    fn test_compute_health_report_degraded_components() {
        let mut m = create_monitor(100, 1000);
        // Only populate TVL with healthy values — others get 5000 (below 9000=degraded)
        record_value(&mut m, MetricType::Tvl, 5000, src(), 1000);
        let _ = add_threshold(&mut m, make_threshold(MetricType::Tvl));
        let r = compute_health_report(&m, 2000);
        // TVL is healthy (10000), but oracle/gov/net have no threshold → 5000 or 8000
        assert!(r.degraded_components >= 1);
    }

    #[test]
    fn test_worst_status_single() {
        assert_eq!(worst_status(&[HealthStatus::Warning]), HealthStatus::Warning);
    }

    // ---- Trend Analysis (tests 116-140) ----

    #[test]
    fn test_trend_direction_up() {
        let t = trend_direction(&[100, 100, 200, 200]);
        assert!(t > 0);
    }

    #[test]
    fn test_trend_direction_down() {
        let t = trend_direction(&[200, 200, 100, 100]);
        assert!(t < 0);
    }

    #[test]
    fn test_trend_direction_flat() {
        let t = trend_direction(&[100, 100, 100, 100]);
        assert_eq!(t, 0);
    }

    #[test]
    fn test_trend_direction_single() {
        assert_eq!(trend_direction(&[100]), 0);
    }

    #[test]
    fn test_trend_direction_empty() {
        assert_eq!(trend_direction(&[]), 0);
    }

    #[test]
    fn test_trend_direction_double_gives_bps() {
        // First half avg=100, second half avg=200 → 100% up → 10000 bps
        let t = trend_direction(&[100, 100, 200, 200]);
        assert_eq!(t, 10000);
    }

    #[test]
    fn test_volatility_zero_for_constant() {
        assert_eq!(volatility(&[100, 100, 100, 100]), 0);
    }

    #[test]
    fn test_volatility_nonzero() {
        let v = volatility(&[100, 200, 100, 200]);
        assert!(v > 0);
    }

    #[test]
    fn test_volatility_single() {
        assert_eq!(volatility(&[100]), 0);
    }

    #[test]
    fn test_volatility_empty() {
        assert_eq!(volatility(&[]), 0);
    }

    #[test]
    fn test_volatility_all_zero() {
        assert_eq!(volatility(&[0, 0, 0]), 0);
    }

    #[test]
    fn test_correlation_perfect_positive() {
        let c = correlation(&[1, 2, 3, 4, 5], &[10, 20, 30, 40, 50]);
        assert!(c > 9900); // near 10000
    }

    #[test]
    fn test_correlation_perfect_negative() {
        let c = correlation(&[1, 2, 3, 4, 5], &[50, 40, 30, 20, 10]);
        assert!(c < -9900);
    }

    #[test]
    fn test_correlation_uncorrelated() {
        let c = correlation(&[1, 2, 3, 2, 1], &[3, 1, 3, 1, 3]);
        // roughly zero
        assert!(c.abs() < 5000);
    }

    #[test]
    fn test_correlation_mismatched_length() {
        assert_eq!(correlation(&[1, 2], &[1, 2, 3]), 0);
    }

    #[test]
    fn test_correlation_too_short() {
        assert_eq!(correlation(&[1], &[2]), 0);
    }

    #[test]
    fn test_correlation_constant() {
        assert_eq!(correlation(&[5, 5, 5], &[5, 5, 5]), 0); // zero variance
    }

    #[test]
    fn test_detect_spike_basic() {
        let spikes = detect_spike(&[100, 100, 200, 100, 100], 5000); // 50% threshold
        // jump up at 2 (100->200 = 100% > 50%), jump down at 3 (200->100 = 50%, not > 50%)
        assert_eq!(spikes, vec![2]);
    }

    #[test]
    fn test_detect_spike_none() {
        let spikes = detect_spike(&[100, 101, 102, 103], 5000);
        assert!(spikes.is_empty());
    }

    #[test]
    fn test_detect_spike_empty() {
        assert!(detect_spike(&[], 1000).is_empty());
    }

    #[test]
    fn test_detect_spike_single() {
        assert!(detect_spike(&[100], 1000).is_empty());
    }

    #[test]
    fn test_detect_spike_from_zero() {
        let spikes = detect_spike(&[0, 100], 1000);
        assert_eq!(spikes, vec![1]);
    }

    #[test]
    fn test_detect_spike_threshold_bps() {
        // 10% change = 1000 bps threshold
        let spikes = detect_spike(&[100, 112], 1000);
        assert_eq!(spikes, vec![1]); // 12% > 10%
    }

    #[test]
    fn test_detect_spike_exact_threshold_no_trigger() {
        // exactly 10% = 1000 bps, should not trigger (> not >=)
        let spikes = detect_spike(&[100, 110], 1000);
        assert!(spikes.is_empty());
    }

    // ---- Reporting (tests 141-155) ----

    #[test]
    fn test_summarize_metric_basic() {
        let m = populated_monitor();
        let (min, max, mean, median, count) = summarize_metric(&m, &MetricType::Tvl);
        assert_eq!(count, 10);
        assert_eq!(min, 5000);
        assert_eq!(max, 5900);
        assert!(mean >= 5000 && mean <= 5900);
        assert!(median >= 5000 && median <= 5900);
    }

    #[test]
    fn test_summarize_metric_empty() {
        let m = default_monitor();
        let (min, max, mean, median, count) = summarize_metric(&m, &MetricType::Tvl);
        assert_eq!(count, 0);
        assert_eq!(min, 0);
        assert_eq!(max, 0);
    }

    #[test]
    fn test_summarize_metric_single() {
        let mut m = create_monitor(10, 1000);
        record_value(&mut m, MetricType::Tvl, 42, src(), 100);
        let (min, max, mean, median, count) = summarize_metric(&m, &MetricType::Tvl);
        assert_eq!(count, 1);
        assert_eq!(min, 42);
        assert_eq!(max, 42);
        assert_eq!(mean, 42);
        assert_eq!(median, 42);
    }

    #[test]
    fn test_uptime_bps_all_above() {
        let mut m = create_monitor(100, 1000);
        for i in 0..10 {
            record_value(&mut m, MetricType::Tvl, 5000, src(), 100 + i);
        }
        let u = uptime_bps(&m, &MetricType::Tvl, 1000, 200, 200);
        assert_eq!(u, 10000); // 100%
    }

    #[test]
    fn test_uptime_bps_none_above() {
        let mut m = create_monitor(100, 1000);
        for i in 0..10 {
            record_value(&mut m, MetricType::Tvl, 500, src(), 100 + i);
        }
        let u = uptime_bps(&m, &MetricType::Tvl, 1000, 200, 200);
        assert_eq!(u, 0);
    }

    #[test]
    fn test_uptime_bps_half() {
        let mut m = create_monitor(100, 1000);
        for i in 0..10 {
            let val = if i < 5 { 500 } else { 5000 };
            record_value(&mut m, MetricType::Tvl, val, src(), 100 + i);
        }
        let u = uptime_bps(&m, &MetricType::Tvl, 1000, 200, 200);
        assert_eq!(u, 5000); // 50%
    }

    #[test]
    fn test_uptime_bps_empty() {
        let m = default_monitor();
        assert_eq!(uptime_bps(&m, &MetricType::Tvl, 100, 200, 200), 0);
    }

    #[test]
    fn test_time_since_last_alert_exists() {
        let mut m = default_monitor();
        let a = Alert {
            alert_id: 0, metric_type: MetricType::Tvl,
            status: HealthStatus::Warning, value: 0, threshold: 0,
            timestamp: 5000, source: src(), acknowledged: false,
        };
        trigger_alert(&mut m, a);
        assert_eq!(time_since_last_alert(&m, &MetricType::Tvl, 8000), 3000);
    }

    #[test]
    fn test_time_since_last_alert_none() {
        let m = default_monitor();
        assert_eq!(time_since_last_alert(&m, &MetricType::Tvl, 8000), 8000);
    }

    #[test]
    fn test_time_since_last_alert_uses_latest() {
        let mut m = default_monitor();
        for ts in &[1000u64, 3000, 5000] {
            let a = Alert {
                alert_id: 0, metric_type: MetricType::Tvl,
                status: HealthStatus::Warning, value: 0, threshold: 0,
                timestamp: *ts, source: src(), acknowledged: false,
            };
            trigger_alert(&mut m, a);
        }
        assert_eq!(time_since_last_alert(&m, &MetricType::Tvl, 8000), 3000); // 8000-5000
    }

    #[test]
    fn test_summarize_metric_volume() {
        let m = populated_monitor();
        let (min, max, _mean, _median, count) = summarize_metric(&m, &MetricType::Volume);
        assert_eq!(count, 10);
        assert_eq!(min, 2000);
        assert_eq!(max, 2450);
    }

    #[test]
    fn test_uptime_bps_window_boundaries() {
        let mut m = create_monitor(100, 1000);
        record_value(&mut m, MetricType::Tvl, 5000, src(), 50);  // outside window
        record_value(&mut m, MetricType::Tvl, 5000, src(), 150); // inside window
        let u = uptime_bps(&m, &MetricType::Tvl, 1000, 200, 100);
        // window = [100, 200], only ts=150 matches
        assert_eq!(u, 10000); // 1/1 = 100%
    }

    // ---- Diagnostics (tests 156-165) ----

    #[test]
    fn test_diagnose_healthy() {
        let m = populated_monitor();
        let diag = diagnose(&m, 2000);
        let tvl_diag = diag.iter().find(|d| d.0 == MetricType::Tvl).unwrap();
        assert_eq!(tvl_diag.1, HealthStatus::Healthy);
        assert_eq!(tvl_diag.2, "ok");
    }

    #[test]
    fn test_diagnose_no_data() {
        let m = default_monitor();
        let diag = diagnose(&m, 1000);
        // All should be "no_data" warning since no samples
        for d in &diag {
            assert_eq!(d.2, "no_data");
        }
    }

    #[test]
    fn test_diagnose_above_critical() {
        let mut m = create_monitor(100, 1000);
        let _ = add_threshold(&mut m, make_threshold(MetricType::Tvl));
        record_value(&mut m, MetricType::Tvl, 20000, src(), 1000);
        let diag = diagnose(&m, 1000);
        let tvl_diag = diag.iter().find(|d| d.0 == MetricType::Tvl).unwrap();
        assert_eq!(tvl_diag.1, HealthStatus::Critical);
        assert_eq!(tvl_diag.2, "above_critical");
    }

    #[test]
    fn test_diagnose_below_warning() {
        let mut m = create_monitor(100, 1000);
        let _ = add_threshold(&mut m, make_threshold(MetricType::Tvl));
        record_value(&mut m, MetricType::Tvl, 500, src(), 1000);
        let diag = diagnose(&m, 1000);
        let tvl_diag = diag.iter().find(|d| d.0 == MetricType::Tvl).unwrap();
        assert_eq!(tvl_diag.1, HealthStatus::Warning);
        assert_eq!(tvl_diag.2, "below_warning");
    }

    #[test]
    fn test_diagnose_no_threshold_set() {
        let mut m = create_monitor(100, 1000);
        record_value(&mut m, MetricType::Tvl, 5000, src(), 1000);
        // No threshold added for TVL
        let diag = diagnose(&m, 1000);
        let tvl_diag = diag.iter().find(|d| d.0 == MetricType::Tvl).unwrap();
        assert_eq!(tvl_diag.2, "no_threshold");
    }

    #[test]
    fn test_diagnose_below_critical() {
        let mut m = create_monitor(100, 1000);
        let _ = add_threshold(&mut m, make_threshold(MetricType::Tvl));
        record_value(&mut m, MetricType::Tvl, 50, src(), 1000);
        let diag = diagnose(&m, 1000);
        let tvl_diag = diag.iter().find(|d| d.0 == MetricType::Tvl).unwrap();
        assert_eq!(tvl_diag.1, HealthStatus::Critical);
        assert_eq!(tvl_diag.2, "below_critical");
    }

    #[test]
    fn test_diagnose_covers_all_metrics() {
        let m = default_monitor();
        let diag = diagnose(&m, 1000);
        assert_eq!(diag.len(), 10);
    }

    #[test]
    fn test_recommend_action_healthy() {
        assert_eq!(recommend_action(&HealthStatus::Healthy), "no action needed");
    }

    #[test]
    fn test_recommend_action_critical() {
        assert_eq!(recommend_action(&HealthStatus::Critical), "immediate intervention required");
    }

    #[test]
    fn test_recommend_action_down() {
        assert_eq!(recommend_action(&HealthStatus::Down), "emergency protocol: halt operations, escalate");
    }

    // ---- Cleanup (tests 166-175) ----

    #[test]
    fn test_trim_samples_removes_old() {
        let mut m = create_monitor(100, 1000);
        record_value(&mut m, MetricType::Tvl, 100, src(), 1000);
        record_value(&mut m, MetricType::Tvl, 200, src(), 5000);
        record_value(&mut m, MetricType::Tvl, 300, src(), 9000);
        let removed = trim_samples(&mut m, 5000, 10000);
        assert_eq!(removed, 1); // ts=1000 removed (10000-5000=5000 cutoff)
        assert_eq!(m.samples.len(), 2);
    }

    #[test]
    fn test_trim_samples_none_old() {
        let mut m = create_monitor(100, 1000);
        record_value(&mut m, MetricType::Tvl, 100, src(), 9000);
        let removed = trim_samples(&mut m, 5000, 10000);
        assert_eq!(removed, 0);
    }

    #[test]
    fn test_trim_samples_all_old() {
        let mut m = create_monitor(100, 1000);
        record_value(&mut m, MetricType::Tvl, 100, src(), 100);
        record_value(&mut m, MetricType::Tvl, 200, src(), 200);
        let removed = trim_samples(&mut m, 100, 10000);
        assert_eq!(removed, 2);
        assert!(m.samples.is_empty());
    }

    #[test]
    fn test_clear_resolved_alerts() {
        let mut m = default_monitor();
        for _ in 0..3 {
            let a = Alert {
                alert_id: 0, metric_type: MetricType::Tvl,
                status: HealthStatus::Warning, value: 0, threshold: 0,
                timestamp: 100, source: src(), acknowledged: false,
            };
            trigger_alert(&mut m, a);
        }
        let _ = acknowledge_alert(&mut m, 1);
        let _ = acknowledge_alert(&mut m, 2);
        let removed = clear_resolved_alerts(&mut m);
        assert_eq!(removed, 2);
        assert_eq!(m.alerts.len(), 1);
    }

    #[test]
    fn test_clear_resolved_alerts_none_acknowledged() {
        let mut m = default_monitor();
        let a = Alert {
            alert_id: 0, metric_type: MetricType::Tvl,
            status: HealthStatus::Warning, value: 0, threshold: 0,
            timestamp: 100, source: src(), acknowledged: false,
        };
        trigger_alert(&mut m, a);
        assert_eq!(clear_resolved_alerts(&mut m), 0);
    }

    #[test]
    fn test_prune_old_alerts() {
        let mut m = default_monitor();
        for ts in &[100u64, 500, 1000] {
            let a = Alert {
                alert_id: 0, metric_type: MetricType::Tvl,
                status: HealthStatus::Warning, value: 0, threshold: 0,
                timestamp: *ts, source: src(), acknowledged: false,
            };
            trigger_alert(&mut m, a);
        }
        let removed = prune_old_alerts(&mut m, 500);
        assert_eq!(removed, 1); // ts=100 removed
        assert_eq!(m.alerts.len(), 2);
    }

    #[test]
    fn test_prune_old_alerts_none_removed() {
        let mut m = default_monitor();
        let a = Alert {
            alert_id: 0, metric_type: MetricType::Tvl,
            status: HealthStatus::Warning, value: 0, threshold: 0,
            timestamp: 1000, source: src(), acknowledged: false,
        };
        trigger_alert(&mut m, a);
        assert_eq!(prune_old_alerts(&mut m, 500), 0);
    }

    #[test]
    fn test_trim_samples_boundary() {
        let mut m = create_monitor(100, 1000);
        record_value(&mut m, MetricType::Tvl, 100, src(), 5000); // exactly at cutoff
        let removed = trim_samples(&mut m, 5000, 10000);
        assert_eq!(removed, 0); // cutoff=5000, timestamp=5000 >= 5000, kept
    }

    #[test]
    fn test_prune_old_alerts_boundary() {
        let mut m = default_monitor();
        let a = Alert {
            alert_id: 0, metric_type: MetricType::Tvl,
            status: HealthStatus::Warning, value: 0, threshold: 0,
            timestamp: 500, source: src(), acknowledged: false,
        };
        trigger_alert(&mut m, a);
        assert_eq!(prune_old_alerts(&mut m, 500), 0); // 500 >= 500, kept
    }

    // ---- Statistics (tests 176-190) ----

    #[test]
    fn test_monitor_stats_empty() {
        let m = default_monitor();
        let (samples, total, active, thresholds) = monitor_stats(&m);
        assert_eq!(samples, 0);
        assert_eq!(total, 0);
        assert_eq!(active, 0);
        assert_eq!(thresholds, 0);
    }

    #[test]
    fn test_monitor_stats_populated() {
        let mut m = populated_monitor();
        let a = Alert {
            alert_id: 0, metric_type: MetricType::Tvl,
            status: HealthStatus::Warning, value: 0, threshold: 0,
            timestamp: 100, source: src(), acknowledged: false,
        };
        trigger_alert(&mut m, a);
        let (samples, total, active, thresholds) = monitor_stats(&m);
        assert_eq!(samples, 30); // 10 each for Tvl, Volume, LatencyMs
        assert_eq!(total, 1);
        assert_eq!(active, 1);
        assert_eq!(thresholds, 3);
    }

    #[test]
    fn test_alert_rate_within_window() {
        let mut m = default_monitor();
        for ts in &[100u64, 200, 300, 400, 500] {
            let a = Alert {
                alert_id: 0, metric_type: MetricType::Tvl,
                status: HealthStatus::Warning, value: 0, threshold: 0,
                timestamp: *ts, source: src(), acknowledged: false,
            };
            trigger_alert(&mut m, a);
        }
        assert_eq!(alert_rate(&m, 300, 500), 4); // ts 200,300,400,500
    }

    #[test]
    fn test_alert_rate_empty() {
        let m = default_monitor();
        assert_eq!(alert_rate(&m, 1000, 5000), 0);
    }

    #[test]
    fn test_mean_time_to_acknowledge_none() {
        let m = default_monitor();
        assert_eq!(mean_time_to_acknowledge(&m), 0);
    }

    #[test]
    fn test_mean_time_to_acknowledge_with_acked() {
        let mut m = create_monitor(100, 1000);
        record_value(&mut m, MetricType::Tvl, 100, src(), 5000); // latest sample ts=5000
        let a = Alert {
            alert_id: 0, metric_type: MetricType::Tvl,
            status: HealthStatus::Warning, value: 0, threshold: 0,
            timestamp: 3000, source: src(), acknowledged: false,
        };
        let id = trigger_alert(&mut m, a);
        let _ = acknowledge_alert(&mut m, id);
        let mtta = mean_time_to_acknowledge(&m);
        assert_eq!(mtta, 2000); // 5000-3000
    }

    #[test]
    fn test_false_alert_rate_none() {
        let m = default_monitor();
        assert_eq!(false_alert_rate(&m), 0);
    }

    #[test]
    fn test_false_alert_rate_all_acked() {
        let mut m = default_monitor();
        let a = Alert {
            alert_id: 0, metric_type: MetricType::Tvl,
            status: HealthStatus::Warning, value: 0, threshold: 0,
            timestamp: 100, source: src(), acknowledged: false,
        };
        let id = trigger_alert(&mut m, a);
        let _ = acknowledge_alert(&mut m, id);
        assert_eq!(false_alert_rate(&m), 10000); // 100%
    }

    #[test]
    fn test_false_alert_rate_half() {
        let mut m = default_monitor();
        for _ in 0..4 {
            let a = Alert {
                alert_id: 0, metric_type: MetricType::Tvl,
                status: HealthStatus::Warning, value: 0, threshold: 0,
                timestamp: 100, source: src(), acknowledged: false,
            };
            trigger_alert(&mut m, a);
        }
        let _ = acknowledge_alert(&mut m, 1);
        let _ = acknowledge_alert(&mut m, 2);
        assert_eq!(false_alert_rate(&m), 5000); // 50%
    }

    #[test]
    fn test_alert_rate_all_in_window() {
        let mut m = default_monitor();
        for ts in &[100u64, 200, 300] {
            let a = Alert {
                alert_id: 0, metric_type: MetricType::Tvl,
                status: HealthStatus::Warning, value: 0, threshold: 0,
                timestamp: *ts, source: src(), acknowledged: false,
            };
            trigger_alert(&mut m, a);
        }
        assert_eq!(alert_rate(&m, 1000, 500), 3);
    }

    #[test]
    fn test_monitor_stats_after_resolve() {
        let mut m = default_monitor();
        let a = Alert {
            alert_id: 0, metric_type: MetricType::Tvl,
            status: HealthStatus::Warning, value: 0, threshold: 0,
            timestamp: 100, source: src(), acknowledged: false,
        };
        let id = trigger_alert(&mut m, a);
        let _ = resolve_alert(&mut m, id);
        let (_, total, active, _) = monitor_stats(&m);
        assert_eq!(total, 1); // 1 ever created
        assert_eq!(active, 0); // resolved
    }

    #[test]
    fn test_isqrt_basic() {
        assert_eq!(isqrt(0), 0);
        assert_eq!(isqrt(1), 1);
        assert_eq!(isqrt(4), 2);
        assert_eq!(isqrt(9), 3);
        assert_eq!(isqrt(100), 10);
        assert_eq!(isqrt(8), 2); // floor
    }

    #[test]
    fn test_status_rank_ordering() {
        assert!(status_rank(&HealthStatus::Healthy) < status_rank(&HealthStatus::Degraded));
        assert!(status_rank(&HealthStatus::Degraded) < status_rank(&HealthStatus::Warning));
        assert!(status_rank(&HealthStatus::Warning) < status_rank(&HealthStatus::Critical));
        assert!(status_rank(&HealthStatus::Critical) < status_rank(&HealthStatus::Down));
    }

    #[test]
    fn test_trend_direction_large_increase() {
        // First half avg=100, second half avg=1000 → 900% = 90000 bps
        let t = trend_direction(&[100, 100, 1000, 1000]);
        assert!(t > 0);
    }

    #[test]
    fn test_volatility_high() {
        // Very volatile: 1, 10000, 1, 10000
        let v = volatility(&[1, 10000, 1, 10000]);
        assert!(v > 5000);
    }

    // ============ Hardening Round 8 ============

    #[test]
    fn test_create_monitor_custom_h8() {
        let m = create_monitor(500, 30_000);
        assert_eq!(m.max_samples, 500);
        assert_eq!(m.check_interval_ms, 30_000);
        assert!(m.samples.is_empty());
        assert!(m.thresholds.is_empty());
        assert!(m.alerts.is_empty());
    }

    #[test]
    fn test_default_monitor_h8() {
        let m = default_monitor();
        assert_eq!(m.max_samples, DEFAULT_MAX_SAMPLES);
        assert_eq!(m.check_interval_ms, DEFAULT_CHECK_INTERVAL_MS);
    }

    #[test]
    fn test_add_threshold_valid_h8() {
        let mut m = default_monitor();
        let t = make_threshold(MetricType::Tvl);
        assert!(add_threshold(&mut m, t).is_ok());
        assert_eq!(m.thresholds.len(), 1);
    }

    #[test]
    fn test_add_threshold_invalid_critical_below_warning_h8() {
        let mut m = default_monitor();
        let t = AlertThreshold {
            metric_type: MetricType::Tvl,
            warning_above: Some(100),
            warning_below: None,
            critical_above: Some(50), // critical < warning = invalid
            critical_below: None,
            cooldown_ms: 1000,
            last_triggered: 0,
        };
        assert_eq!(add_threshold(&mut m, t), Err(MonitorError::InvalidThreshold));
    }

    #[test]
    fn test_add_threshold_replaces_existing_h8() {
        let mut m = default_monitor();
        let t1 = make_threshold(MetricType::Tvl);
        let mut t2 = make_threshold(MetricType::Tvl);
        t2.warning_above = Some(9999);
        add_threshold(&mut m, t1).unwrap();
        add_threshold(&mut m, t2).unwrap();
        assert_eq!(m.thresholds.len(), 1);
        assert_eq!(m.thresholds[0].warning_above, Some(9999));
    }

    #[test]
    fn test_remove_threshold_not_found_h8() {
        let mut m = default_monitor();
        let result = remove_threshold(&mut m, &MetricType::Tvl);
        assert_eq!(result, Err(MonitorError::ThresholdNotFound));
    }

    #[test]
    fn test_record_sample_trims_h8() {
        let mut m = create_monitor(3, 1000);
        for i in 0..5 {
            record_value(&mut m, MetricType::Tvl, i * 100, src(), i);
        }
        assert_eq!(m.samples.len(), 3); // Trimmed to max_samples
    }

    #[test]
    fn test_latest_sample_h8() {
        let mut m = default_monitor();
        record_value(&mut m, MetricType::Tvl, 100, src(), 1);
        record_value(&mut m, MetricType::Tvl, 200, src(), 2);
        record_value(&mut m, MetricType::Volume, 300, src(), 3);
        let latest = latest_sample(&m, &MetricType::Tvl).unwrap();
        assert_eq!(latest.value, 200);
    }

    #[test]
    fn test_latest_sample_not_found_h8() {
        let m = default_monitor();
        assert!(latest_sample(&m, &MetricType::Price).is_none());
    }

    #[test]
    fn test_samples_for_metric_h8() {
        let mut m = default_monitor();
        record_value(&mut m, MetricType::Tvl, 100, src(), 1);
        record_value(&mut m, MetricType::Volume, 200, src(), 2);
        record_value(&mut m, MetricType::Tvl, 300, src(), 3);
        assert_eq!(samples_for(&m, &MetricType::Tvl).len(), 2);
        assert_eq!(samples_for(&m, &MetricType::Volume).len(), 1);
    }

    #[test]
    fn test_samples_in_range_h8() {
        let mut m = default_monitor();
        record_value(&mut m, MetricType::Tvl, 100, src(), 10);
        record_value(&mut m, MetricType::Tvl, 200, src(), 20);
        record_value(&mut m, MetricType::Tvl, 300, src(), 30);
        let range = samples_in_range(&m, &MetricType::Tvl, 15, 25);
        assert_eq!(range.len(), 1);
        assert_eq!(range[0].value, 200);
    }

    #[test]
    fn test_sample_count_h8() {
        let mut m = default_monitor();
        record_value(&mut m, MetricType::Tvl, 100, src(), 1);
        record_value(&mut m, MetricType::Tvl, 200, src(), 2);
        assert_eq!(sample_count(&m, &MetricType::Tvl), 2);
        assert_eq!(sample_count(&m, &MetricType::Price), 0);
    }

    #[test]
    fn test_evaluate_sample_critical_above_h8() {
        let s = make_sample(MetricType::Tvl, 20000, 100);
        let t = make_threshold(MetricType::Tvl); // critical_above=15000
        let alert = evaluate_sample(&s, &t, 100).unwrap();
        assert_eq!(alert.status, HealthStatus::Critical);
    }

    #[test]
    fn test_evaluate_sample_warning_below_h8() {
        let s = make_sample(MetricType::Tvl, 500, 100);
        let t = make_threshold(MetricType::Tvl); // warning_below=1000
        let alert = evaluate_sample(&s, &t, 100).unwrap();
        assert_eq!(alert.status, HealthStatus::Warning);
    }

    #[test]
    fn test_evaluate_sample_no_alert_h8() {
        let s = make_sample(MetricType::Tvl, 5000, 100);
        let t = make_threshold(MetricType::Tvl);
        assert!(evaluate_sample(&s, &t, 100).is_none());
    }

    #[test]
    fn test_acknowledge_alert_h8() {
        let mut m = default_monitor();
        let a = Alert {
            alert_id: 0, metric_type: MetricType::Tvl,
            status: HealthStatus::Warning, value: 500, threshold: 1000,
            timestamp: 100, source: src(), acknowledged: false,
        };
        let id = trigger_alert(&mut m, a);
        assert!(acknowledge_alert(&mut m, id).is_ok());
        assert!(m.alerts[0].acknowledged);
    }

    #[test]
    fn test_acknowledge_alert_not_found_h8() {
        let mut m = default_monitor();
        assert_eq!(acknowledge_alert(&mut m, 999), Err(MonitorError::AlertNotFound));
    }

    #[test]
    fn test_resolve_alert_h8() {
        let mut m = default_monitor();
        let a = Alert {
            alert_id: 0, metric_type: MetricType::Tvl,
            status: HealthStatus::Warning, value: 500, threshold: 1000,
            timestamp: 100, source: src(), acknowledged: false,
        };
        let id = trigger_alert(&mut m, a);
        assert!(resolve_alert(&mut m, id).is_ok());
        assert!(m.alerts.is_empty());
    }

    #[test]
    fn test_resolve_alert_not_found_h8() {
        let mut m = default_monitor();
        assert_eq!(resolve_alert(&mut m, 999), Err(MonitorError::AlertNotFound));
    }

    #[test]
    fn test_detect_anomaly_empty_h8() {
        let result = detect_anomaly(&[], 100);
        assert!(!result.is_anomaly);
        assert_eq!(result.expected, 0);
    }

    #[test]
    fn test_detect_anomaly_single_sample_h8() {
        let result = detect_anomaly(&[100], 200);
        assert!(!result.is_anomaly); // Not enough samples for z-score
        assert_eq!(result.expected, 100);
    }

    #[test]
    fn test_detect_anomaly_normal_value_h8() {
        let samples = vec![100, 102, 98, 101, 99, 100, 103, 97];
        let result = detect_anomaly(&samples, 101);
        assert!(!result.is_anomaly);
    }

    #[test]
    fn test_moving_average_empty_h8() {
        assert!(moving_average(&[], 3).is_empty());
        assert!(moving_average(&[1, 2, 3], 0).is_empty());
    }

    #[test]
    fn test_moving_average_window_one_h8() {
        let result = moving_average(&[10, 20, 30], 1);
        assert_eq!(result, vec![10, 20, 30]);
    }

    #[test]
    fn test_exponential_moving_average_alpha_over_bps_h8() {
        let result = exponential_moving_average(&[100, 200], BPS + 1);
        assert!(result.is_empty());
    }

    #[test]
    fn test_rate_of_change_h8() {
        let result = rate_of_change(&[100, 150, 120]);
        assert_eq!(result, vec![50, -30]);
    }

    #[test]
    fn test_rate_of_change_single_h8() {
        assert!(rate_of_change(&[100]).is_empty());
    }

    #[test]
    fn test_is_trending_up_h8() {
        assert!(is_trending_up(&[1, 2, 3, 4, 5], 3));
        assert!(!is_trending_up(&[1, 2, 5, 4, 5], 3)); // 4 < 5 then 5 > 4, but 4 < 5 breaks
    }

    #[test]
    fn test_is_trending_down_h8() {
        assert!(is_trending_down(&[5, 4, 3, 2, 1], 3));
        assert!(!is_trending_down(&[5, 4, 1, 2, 1], 3)); // 2 > 1 breaks
    }

    #[test]
    fn test_composite_score_all_healthy_h8() {
        let score = composite_score(10000, 10000, 10000, 10000);
        assert_eq!(score, 10000);
    }

    #[test]
    fn test_composite_score_weighted_h8() {
        // pool=40%, oracle=30%, gov=15%, network=15%
        let score = composite_score(10000, 0, 0, 0);
        assert_eq!(score, 4000);
    }

    #[test]
    fn test_status_from_score_h8() {
        assert_eq!(status_from_score(9500), HealthStatus::Healthy);
        assert_eq!(status_from_score(8000), HealthStatus::Degraded);
        assert_eq!(status_from_score(6000), HealthStatus::Warning);
        assert_eq!(status_from_score(3500), HealthStatus::Critical);
        assert_eq!(status_from_score(2000), HealthStatus::Down);
    }

    #[test]
    fn test_worst_status_h8() {
        let statuses = vec![HealthStatus::Healthy, HealthStatus::Warning, HealthStatus::Degraded];
        assert_eq!(worst_status(&statuses), HealthStatus::Warning);
    }

    #[test]
    fn test_worst_status_empty_h8() {
        assert_eq!(worst_status(&[]), HealthStatus::Healthy);
    }

    #[test]
    fn test_trim_samples_h8() {
        let mut m = default_monitor();
        record_value(&mut m, MetricType::Tvl, 100, src(), 10);
        record_value(&mut m, MetricType::Tvl, 200, src(), 20);
        record_value(&mut m, MetricType::Tvl, 300, src(), 30);
        let removed = trim_samples(&mut m, 15, 30);
        assert_eq!(removed, 1); // sample at t=10 removed
        assert_eq!(m.samples.len(), 2);
    }

    #[test]
    fn test_clear_resolved_alerts_h8() {
        let mut m = default_monitor();
        let a1 = Alert {
            alert_id: 0, metric_type: MetricType::Tvl,
            status: HealthStatus::Warning, value: 0, threshold: 0,
            timestamp: 100, source: src(), acknowledged: true,
        };
        let a2 = Alert {
            alert_id: 0, metric_type: MetricType::Volume,
            status: HealthStatus::Critical, value: 0, threshold: 0,
            timestamp: 100, source: src(), acknowledged: false,
        };
        trigger_alert(&mut m, a1);
        trigger_alert(&mut m, a2);
        let removed = clear_resolved_alerts(&mut m);
        assert_eq!(removed, 1);
        assert_eq!(m.alerts.len(), 1);
    }

    #[test]
    fn test_recommend_action_h8() {
        assert_eq!(recommend_action(&HealthStatus::Healthy), "no action needed");
        assert_eq!(recommend_action(&HealthStatus::Down), "emergency protocol: halt operations, escalate");
    }

    #[test]
    fn test_detect_spike_h8() {
        let samples = vec![100, 100, 500, 100]; // 400% jump at index 2
        let spikes = detect_spike(&samples, 1000); // 10% threshold
        assert!(spikes.contains(&2));
        assert!(spikes.contains(&3));
    }

    #[test]
    fn test_detect_spike_no_spikes_h8() {
        let samples = vec![100, 101, 102, 103];
        let spikes = detect_spike(&samples, 500); // 5% threshold
        assert!(spikes.is_empty());
    }

    #[test]
    fn test_correlation_identical_series_h8() {
        let a = vec![1, 2, 3, 4, 5];
        let corr = correlation(&a, &a);
        assert!(corr >= 9900); // ~1.0
    }

    #[test]
    fn test_correlation_different_lengths_h8() {
        assert_eq!(correlation(&[1, 2, 3], &[1, 2]), 0);
    }

    #[test]
    fn test_volatility_constant_h8() {
        let v = volatility(&[100, 100, 100, 100]);
        assert_eq!(v, 0);
    }

    #[test]
    fn test_volatility_single_sample_h8() {
        assert_eq!(volatility(&[100]), 0);
    }
}
