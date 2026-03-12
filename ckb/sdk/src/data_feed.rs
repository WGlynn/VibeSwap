// ============ Oracle Data Feed & Price Aggregation ============
// Multi-source price aggregation, outlier filtering, freshness validation,
// and Chainlink-style round tracking for VibeSwap on CKB.
//
// Key capabilities:
// - Price aggregation: median, TWAP, VWAP, weighted average
// - Source management: register/deregister, weight assignment, reliability
// - Outlier detection: z-score filtering, IQR-based removal
// - Freshness validation: staleness checks, heartbeat tracking, health scoring
// - Round management: Chainlink-style round IDs, historical lookback
// - Confidence scoring: source count, agreement, freshness
// - Price deviation alerts: sudden move detection, configurable thresholds
// - Feed composition: derived feeds, cross-rate calculation
//
// All percentages in basis points (10000 = 100%).
// All arithmetic is integer-only (u64/u128). No floating point.

// ============ Constants ============

/// Basis points denominator (10000 = 100%)
pub const BPS: u64 = 10_000;

/// Default minimum oracle sources for aggregation
pub const DEFAULT_MIN_SOURCES: u64 = 3;

/// Default max staleness in milliseconds (5 minutes)
pub const DEFAULT_MAX_STALENESS_MS: u64 = 300_000;

/// Default heartbeat interval in milliseconds (60 seconds)
pub const DEFAULT_HEARTBEAT_MS: u64 = 60_000;

/// Default outlier threshold in bps (10%)
pub const DEFAULT_OUTLIER_THRESHOLD_BPS: u64 = 1_000;

/// Default deviation alert threshold in bps (5%)
pub const DEFAULT_DEVIATION_ALERT_BPS: u64 = 500;

/// Maximum number of oracle sources per feed
pub const MAX_SOURCES: usize = 32;

/// Maximum number of rounds to retain in history
pub const MAX_ROUNDS: usize = 1000;

/// Full reliability score in bps
pub const FULL_RELIABILITY_BPS: u64 = 10_000;

/// Minimum reliability before a source is considered degraded (50%)
pub const MIN_RELIABILITY_BPS: u64 = 5_000;

/// Precision multiplier for intermediate calculations
pub const PRECISION: u128 = 1_000_000_000_000_000_000; // 1e18

// ============ Aggregation Method Codes ============

pub const METHOD_MEDIAN: u8 = 0;
pub const METHOD_TWAP: u8 = 1;
pub const METHOD_VWAP: u8 = 2;
pub const METHOD_WEIGHTED_AVG: u8 = 3;

// ============ Data Types ============

/// A single price report from an oracle source.
#[derive(Debug, Clone)]
pub struct PriceReport {
    pub source_id: u64,
    pub pair_id: u64,
    pub price: u64,
    pub timestamp: u64,
    pub confidence_bps: u64,
    pub round_id: u64,
}

/// An oracle source with reliability tracking.
#[derive(Debug, Clone)]
pub struct OracleSource {
    pub id: u64,
    pub name_hash: u64,
    pub weight_bps: u64,
    pub reliability_bps: u64,
    pub last_report_at: u64,
    pub total_reports: u64,
    pub stale_count: u64,
}

/// Aggregated price result from multiple sources.
#[derive(Debug, Clone)]
pub struct AggregatedPrice {
    pub pair_id: u64,
    pub price: u64,
    pub timestamp: u64,
    pub source_count: u64,
    pub confidence_bps: u64,
    pub method: u8,
}

/// Configuration for a price feed.
#[derive(Debug, Clone)]
pub struct FeedConfig {
    pub pair_id: u64,
    pub min_sources: u64,
    pub max_staleness_ms: u64,
    pub outlier_threshold_bps: u64,
    pub heartbeat_interval_ms: u64,
    pub deviation_alert_bps: u64,
}

/// Chainlink-style round data.
#[derive(Debug, Clone)]
pub struct RoundData {
    pub round_id: u64,
    pub price: u64,
    pub timestamp: u64,
    pub started_at: u64,
    pub updated_at: u64,
    pub answered_in_round: u64,
}

/// Alert generated when price deviates beyond threshold.
#[derive(Debug, Clone)]
pub struct DeviationAlert {
    pub pair_id: u64,
    pub old_price: u64,
    pub new_price: u64,
    pub deviation_bps: u64,
    pub timestamp: u64,
    pub source_id: u64,
}

/// A derived feed computed from two base feeds (cross-rate).
#[derive(Debug, Clone)]
pub struct DerivedFeed {
    pub pair_id: u64,
    pub base_pair_id: u64,
    pub quote_pair_id: u64,
    pub last_computed_price: u64,
    pub last_computed_at: u64,
}

/// Health assessment for a price feed.
#[derive(Debug, Clone)]
pub struct FeedHealth {
    pub pair_id: u64,
    pub active_sources: u64,
    pub stale_sources: u64,
    pub avg_freshness_ms: u64,
    pub confidence_bps: u64,
}

// ============ Helper: Integer Square Root ============

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

// ============ Sorting & Statistics ============

/// Sort reports by price ascending, return new vec.
pub fn sort_reports_by_price(reports: &[PriceReport]) -> Vec<PriceReport> {
    let mut sorted = reports.to_vec();
    sorted.sort_by_key(|r| r.price);
    sorted
}

/// Calculate arithmetic mean of prices.
pub fn calculate_mean(prices: &[u64]) -> u64 {
    if prices.is_empty() {
        return 0;
    }
    let sum: u128 = prices.iter().map(|&p| p as u128).sum();
    (sum / prices.len() as u128) as u64
}

/// Integer approximation of standard deviation.
/// Uses sqrt of mean of squared deviations.
pub fn calculate_std_dev_approx(prices: &[u64], mean: u64) -> u64 {
    if prices.len() <= 1 {
        return 0;
    }
    let variance_sum: u128 = prices
        .iter()
        .map(|&p| {
            let diff = if p > mean { p - mean } else { mean - p };
            (diff as u128) * (diff as u128)
        })
        .sum();
    let variance = variance_sum / prices.len() as u128;
    isqrt(variance) as u64
}

/// Calculate IQR (interquartile range) from sorted prices.
/// Returns (Q1, Q3).
pub fn calculate_iqr(sorted_prices: &[u64]) -> (u64, u64) {
    let n = sorted_prices.len();
    if n == 0 {
        return (0, 0);
    }
    if n == 1 {
        return (sorted_prices[0], sorted_prices[0]);
    }
    // Q1 = median of lower half, Q3 = median of upper half
    let mid = n / 2;
    let q1 = median_of_slice(&sorted_prices[..mid]);
    let q3 = if n % 2 == 0 {
        median_of_slice(&sorted_prices[mid..])
    } else {
        median_of_slice(&sorted_prices[(mid + 1)..])
    };
    (q1, q3)
}

/// Median of a slice (assumes sorted).
fn median_of_slice(sorted: &[u64]) -> u64 {
    let n = sorted.len();
    if n == 0 {
        return 0;
    }
    if n % 2 == 1 {
        sorted[n / 2]
    } else {
        let a = sorted[n / 2 - 1] as u128;
        let b = sorted[n / 2] as u128;
        ((a + b) / 2) as u64
    }
}

// ============ Price Aggregation ============

/// Aggregate prices using median. Requires at least 1 report.
pub fn aggregate_median(reports: &[PriceReport]) -> Result<u64, String> {
    if reports.is_empty() {
        return Err("no reports provided".to_string());
    }
    let sorted = sort_reports_by_price(reports);
    let n = sorted.len();
    if n % 2 == 1 {
        Ok(sorted[n / 2].price)
    } else {
        let a = sorted[n / 2 - 1].price as u128;
        let b = sorted[n / 2].price as u128;
        Ok(((a + b) / 2) as u64)
    }
}

/// Aggregate time-weighted average price over a window.
/// Reports outside the window are excluded.
pub fn aggregate_twap(reports: &[PriceReport], window_ms: u64) -> Result<u64, String> {
    if reports.is_empty() {
        return Err("no reports provided".to_string());
    }
    if window_ms == 0 {
        return Err("window must be positive".to_string());
    }
    // Sort by timestamp
    let mut sorted = reports.to_vec();
    sorted.sort_by_key(|r| r.timestamp);

    let latest_ts = sorted.last().unwrap().timestamp;
    let window_start = latest_ts.saturating_sub(window_ms);

    // Filter to window
    let in_window: Vec<&PriceReport> = sorted
        .iter()
        .filter(|r| r.timestamp >= window_start)
        .collect();

    if in_window.is_empty() {
        return Err("no reports within window".to_string());
    }
    if in_window.len() == 1 {
        return Ok(in_window[0].price);
    }

    // Weighted by time duration each price was active
    let mut weighted_sum: u128 = 0;
    let mut total_duration: u128 = 0;

    for i in 0..in_window.len() - 1 {
        let duration = (in_window[i + 1].timestamp - in_window[i].timestamp) as u128;
        weighted_sum += in_window[i].price as u128 * duration;
        total_duration += duration;
    }

    // Last report holds until now (latest_ts)
    // Add a small weight for the last report
    if total_duration == 0 {
        // All reports at same timestamp — simple average
        let sum: u128 = in_window.iter().map(|r| r.price as u128).sum();
        return Ok((sum / in_window.len() as u128) as u64);
    }

    Ok((weighted_sum / total_duration) as u64)
}

/// Aggregate volume-weighted average price.
/// `volumes` must be same length as `reports`.
pub fn aggregate_vwap(reports: &[PriceReport], volumes: &[u64]) -> Result<u64, String> {
    if reports.is_empty() {
        return Err("no reports provided".to_string());
    }
    if reports.len() != volumes.len() {
        return Err("reports and volumes length mismatch".to_string());
    }
    let mut weighted_sum: u128 = 0;
    let mut total_volume: u128 = 0;
    for (r, &v) in reports.iter().zip(volumes.iter()) {
        weighted_sum += r.price as u128 * v as u128;
        total_volume += v as u128;
    }
    if total_volume == 0 {
        return Err("total volume is zero".to_string());
    }
    Ok((weighted_sum / total_volume) as u64)
}

/// Aggregate weighted average using source weights.
pub fn aggregate_weighted(reports: &[PriceReport], sources: &[OracleSource]) -> Result<u64, String> {
    if reports.is_empty() {
        return Err("no reports provided".to_string());
    }
    let mut weighted_sum: u128 = 0;
    let mut total_weight: u128 = 0;

    for report in reports {
        let weight = sources
            .iter()
            .find(|s| s.id == report.source_id)
            .map(|s| s.weight_bps)
            .unwrap_or(0);
        if weight > 0 {
            weighted_sum += report.price as u128 * weight as u128;
            total_weight += weight as u128;
        }
    }
    if total_weight == 0 {
        return Err("total weight is zero".to_string());
    }
    Ok((weighted_sum / total_weight) as u64)
}

// ============ Source Management ============

/// Register a new oracle source. Fails if already registered or at capacity.
pub fn register_source(sources: &mut Vec<OracleSource>, source: OracleSource) -> Result<(), String> {
    if sources.len() >= MAX_SOURCES {
        return Err("max sources reached".to_string());
    }
    if sources.iter().any(|s| s.id == source.id) {
        return Err("source already registered".to_string());
    }
    sources.push(source);
    Ok(())
}

/// Remove an oracle source by ID. Returns the removed source.
pub fn deregister_source(sources: &mut Vec<OracleSource>, source_id: u64) -> Result<OracleSource, String> {
    let pos = sources
        .iter()
        .position(|s| s.id == source_id)
        .ok_or_else(|| "source not found".to_string())?;
    Ok(sources.remove(pos))
}

/// Update source reliability after a report (success or failure).
/// Reliability is an exponential moving average in bps.
pub fn update_source_reliability(source: &OracleSource, success: bool) -> OracleSource {
    let mut updated = source.clone();
    updated.total_reports += 1;

    if success {
        // Move reliability toward 10000 bps (100%)
        // new = old + (10000 - old) / 10
        let gap = BPS.saturating_sub(updated.reliability_bps);
        updated.reliability_bps += gap / 10;
    } else {
        // Move reliability toward 0
        // new = old - old / 5
        updated.stale_count += 1;
        let penalty = updated.reliability_bps / 5;
        updated.reliability_bps = updated.reliability_bps.saturating_sub(penalty);
    }
    updated
}

// ============ Outlier Detection ============

/// Filter out reports whose price is more than `threshold_bps` standard deviations
/// from the mean (z-score based). Returns reports that pass the filter.
pub fn filter_outliers_zscore(reports: &[PriceReport], threshold_bps: u64) -> Vec<PriceReport> {
    if reports.len() <= 2 {
        return reports.to_vec();
    }
    let prices: Vec<u64> = reports.iter().map(|r| r.price).collect();
    let mean = calculate_mean(&prices);
    let std_dev = calculate_std_dev_approx(&prices, mean);

    if std_dev == 0 {
        return reports.to_vec();
    }

    // threshold_bps is in bps of std_dev (e.g., 20000 = 2.0 std devs)
    // A report is an outlier if |price - mean| * BPS > threshold_bps * std_dev
    reports
        .iter()
        .filter(|r| {
            let diff = if r.price > mean {
                r.price - mean
            } else {
                mean - r.price
            };
            // diff * BPS <= threshold_bps * std_dev
            (diff as u128) * (BPS as u128) <= (threshold_bps as u128) * (std_dev as u128)
        })
        .cloned()
        .collect()
}

/// Filter outliers using IQR method.
/// `multiplier_bps` scales the IQR fence (15000 = 1.5x, standard Tukey fence).
/// Reports outside [Q1 - mult*IQR, Q3 + mult*IQR] are removed.
pub fn filter_outliers_iqr(reports: &[PriceReport], multiplier_bps: u64) -> Vec<PriceReport> {
    if reports.len() <= 2 {
        return reports.to_vec();
    }
    let sorted = sort_reports_by_price(reports);
    let sorted_prices: Vec<u64> = sorted.iter().map(|r| r.price).collect();
    let (q1, q3) = calculate_iqr(&sorted_prices);
    let iqr = q3.saturating_sub(q1);

    if iqr == 0 {
        return reports.to_vec();
    }

    // fence_extension = iqr * multiplier_bps / BPS
    let fence_ext = (iqr as u128 * multiplier_bps as u128 / BPS as u128) as u64;
    let lower = q1.saturating_sub(fence_ext);
    let upper = q3.saturating_add(fence_ext);

    reports
        .iter()
        .filter(|r| r.price >= lower && r.price <= upper)
        .cloned()
        .collect()
}

// ============ Freshness Validation ============

/// Check if a report is stale relative to current time.
pub fn is_stale(report: &PriceReport, current_time: u64, max_staleness_ms: u64) -> bool {
    if current_time <= report.timestamp {
        return false;
    }
    (current_time - report.timestamp) > max_staleness_ms
}

/// Filter reports to only those that are fresh.
pub fn filter_fresh_reports(
    reports: &[PriceReport],
    current_time: u64,
    max_staleness_ms: u64,
) -> Vec<PriceReport> {
    reports
        .iter()
        .filter(|r| !is_stale(r, current_time, max_staleness_ms))
        .cloned()
        .collect()
}

/// Calculate heartbeat health for a source.
/// Returns health score in bps (10000 = perfectly on time).
pub fn calculate_heartbeat_health(
    source: &OracleSource,
    current_time: u64,
    expected_interval_ms: u64,
) -> u64 {
    if expected_interval_ms == 0 || source.last_report_at == 0 {
        return 0;
    }
    if current_time <= source.last_report_at {
        return BPS; // report is in the future or now — healthy
    }
    let elapsed = current_time - source.last_report_at;
    if elapsed <= expected_interval_ms {
        // On time or early — full health
        BPS
    } else {
        // Late — decay linearly. At 2x interval = 0 health.
        let overshoot = elapsed - expected_interval_ms;
        if overshoot >= expected_interval_ms {
            0
        } else {
            let remaining = expected_interval_ms - overshoot;
            (remaining as u128 * BPS as u128 / expected_interval_ms as u128) as u64
        }
    }
}

// ============ Round Management ============

/// Start a new round.
pub fn start_round(round_id: u64, current_time: u64) -> RoundData {
    RoundData {
        round_id,
        price: 0,
        timestamp: current_time,
        started_at: current_time,
        updated_at: current_time,
        answered_in_round: 0,
    }
}

/// Update an existing round with a new price.
pub fn update_round(round: &RoundData, price: u64, current_time: u64) -> RoundData {
    RoundData {
        round_id: round.round_id,
        price,
        timestamp: current_time,
        started_at: round.started_at,
        updated_at: current_time,
        answered_in_round: round.round_id,
    }
}

/// Get the latest round (highest round_id).
pub fn get_latest_round(rounds: &[RoundData]) -> Option<RoundData> {
    rounds.iter().max_by_key(|r| r.round_id).cloned()
}

/// Get a specific round by ID.
pub fn get_round_by_id(rounds: &[RoundData], round_id: u64) -> Option<RoundData> {
    rounds.iter().find(|r| r.round_id == round_id).cloned()
}

// ============ Confidence Scoring ============

/// Calculate aggregate confidence based on source count, agreement, and freshness.
/// Each factor contributes equally (1/3 weight).
pub fn calculate_confidence(
    source_count: u64,
    min_sources: u64,
    agreement_bps: u64,
    freshness_bps: u64,
) -> u64 {
    if min_sources == 0 {
        return 0;
    }
    // Source factor: min(source_count / min_sources, 1) * BPS
    let source_factor = if source_count >= min_sources {
        BPS
    } else {
        source_count * BPS / min_sources
    };

    // Equal weight: (source_factor + agreement + freshness) / 3
    let total = source_factor as u128 + agreement_bps as u128 + freshness_bps as u128;
    (total / 3) as u64
}

/// Calculate agreement: fraction of sources within 1% of the median, in bps.
pub fn calculate_agreement(reports: &[PriceReport]) -> u64 {
    if reports.is_empty() {
        return 0;
    }
    if reports.len() == 1 {
        return BPS;
    }
    let median = aggregate_median(reports).unwrap_or(0);
    if median == 0 {
        return 0;
    }
    // Count sources within 1% (100 bps) of median
    let threshold = median as u128 * 100 / BPS as u128;
    let within = reports
        .iter()
        .filter(|r| {
            let diff = if r.price > median {
                r.price - median
            } else {
                median - r.price
            };
            (diff as u128) <= threshold
        })
        .count();

    (within as u64 * BPS / reports.len() as u64)
}

// ============ Deviation Alerts ============

/// Calculate absolute price change in bps.
pub fn price_change_bps(old_price: u64, new_price: u64) -> u64 {
    if old_price == 0 {
        if new_price == 0 {
            return 0;
        }
        return BPS; // from zero = 100% change capped at BPS
    }
    let diff = if new_price > old_price {
        new_price - old_price
    } else {
        old_price - new_price
    };
    (diff as u128 * BPS as u128 / old_price as u128) as u64
}

/// Check if the price deviation exceeds threshold. Returns alert if so.
pub fn check_deviation(
    old_price: u64,
    new_price: u64,
    threshold_bps: u64,
) -> Option<DeviationAlert> {
    let deviation = price_change_bps(old_price, new_price);
    if deviation > threshold_bps {
        Some(DeviationAlert {
            pair_id: 0,
            old_price,
            new_price,
            deviation_bps: deviation,
            timestamp: 0,
            source_id: 0,
        })
    } else {
        None
    }
}

// ============ Feed Composition ============

/// Compute a derived cross-rate price.
/// E.g., ETH/BTC = ETH/USD * (1 / BTC/USD) = ETH/USD * PRECISION / BTC/USD
/// Prices are in fixed-point with implicit 1e8 scaling.
pub fn compute_derived_price(base_price: u64, quote_price: u64) -> Result<u64, String> {
    if quote_price == 0 {
        return Err("quote price is zero".to_string());
    }
    if base_price == 0 {
        return Ok(0);
    }
    // cross_rate = base_price * SCALE / quote_price
    // Using u128 to avoid overflow
    let scale: u128 = 100_000_000; // 1e8
    let result = (base_price as u128) * scale / (quote_price as u128);
    if result > u64::MAX as u128 {
        return Err("derived price overflow".to_string());
    }
    Ok(result as u64)
}

// ============ Composite Functions ============

/// Build a fully aggregated price from reports, applying freshness filter,
/// outlier removal, and median aggregation.
pub fn build_aggregated_price(
    reports: &[PriceReport],
    sources: &[OracleSource],
    config: &FeedConfig,
    current_time: u64,
) -> Result<AggregatedPrice, String> {
    if reports.is_empty() {
        return Err("no reports provided".to_string());
    }

    // 1. Filter fresh reports
    let fresh = filter_fresh_reports(reports, current_time, config.max_staleness_ms);
    if fresh.is_empty() {
        return Err("all reports are stale".to_string());
    }

    // 2. Filter outliers (IQR with 1.5x multiplier)
    let filtered = filter_outliers_iqr(&fresh, 15_000);
    if filtered.is_empty() {
        return Err("all reports filtered as outliers".to_string());
    }

    // 3. Check minimum sources
    if (filtered.len() as u64) < config.min_sources {
        return Err("insufficient sources after filtering".to_string());
    }

    // 4. Aggregate via median
    let price = aggregate_median(&filtered)?;

    // 5. Calculate confidence
    let agreement = calculate_agreement(&filtered);
    let avg_freshness = calculate_avg_freshness(&filtered, current_time);
    let freshness_bps = if config.max_staleness_ms == 0 {
        0
    } else {
        let ratio = avg_freshness as u128 * BPS as u128 / config.max_staleness_ms as u128;
        BPS.saturating_sub(ratio.min(BPS as u128) as u64)
    };
    let confidence = calculate_confidence(
        filtered.len() as u64,
        config.min_sources,
        agreement,
        freshness_bps,
    );

    // 6. Use latest timestamp from filtered reports
    let timestamp = filtered.iter().map(|r| r.timestamp).max().unwrap_or(current_time);

    Ok(AggregatedPrice {
        pair_id: config.pair_id,
        price,
        timestamp,
        source_count: filtered.len() as u64,
        confidence_bps: confidence,
        method: METHOD_MEDIAN,
    })
}

/// Assess overall feed health.
pub fn assess_feed_health(
    sources: &[OracleSource],
    config: &FeedConfig,
    current_time: u64,
) -> FeedHealth {
    let mut active: u64 = 0;
    let mut stale: u64 = 0;
    let mut total_freshness: u128 = 0;

    for source in sources {
        if source.last_report_at == 0 {
            stale += 1;
            continue;
        }
        let elapsed = current_time.saturating_sub(source.last_report_at);
        if elapsed > config.max_staleness_ms {
            stale += 1;
        } else {
            active += 1;
        }
        total_freshness += elapsed as u128;
    }

    let avg_freshness_ms = if sources.is_empty() {
        0
    } else {
        (total_freshness / sources.len() as u128) as u64
    };

    // Confidence based on active source ratio and average freshness
    let source_ratio_bps = if sources.is_empty() {
        0
    } else {
        active * BPS / sources.len() as u64
    };
    let freshness_score = if config.max_staleness_ms == 0 {
        0
    } else {
        let ratio = avg_freshness_ms as u128 * BPS as u128 / config.max_staleness_ms as u128;
        BPS.saturating_sub(ratio.min(BPS as u128) as u64)
    };
    let confidence_bps = (source_ratio_bps as u128 + freshness_score as u128) as u64 / 2;

    FeedHealth {
        pair_id: config.pair_id,
        active_sources: active,
        stale_sources: stale,
        avg_freshness_ms,
        confidence_bps,
    }
}

// ============ Internal Helpers ============

/// Average age of reports in ms.
fn calculate_avg_freshness(reports: &[PriceReport], current_time: u64) -> u64 {
    if reports.is_empty() {
        return 0;
    }
    let total: u128 = reports
        .iter()
        .map(|r| current_time.saturating_sub(r.timestamp) as u128)
        .sum();
    (total / reports.len() as u128) as u64
}

/// Create a default feed config.
pub fn default_feed_config(pair_id: u64) -> FeedConfig {
    FeedConfig {
        pair_id,
        min_sources: DEFAULT_MIN_SOURCES,
        max_staleness_ms: DEFAULT_MAX_STALENESS_MS,
        outlier_threshold_bps: DEFAULT_OUTLIER_THRESHOLD_BPS,
        heartbeat_interval_ms: DEFAULT_HEARTBEAT_MS,
        deviation_alert_bps: DEFAULT_DEVIATION_ALERT_BPS,
    }
}

/// Validate that a feed config is sane.
pub fn validate_feed_config(config: &FeedConfig) -> Result<(), String> {
    if config.min_sources == 0 {
        return Err("min_sources must be positive".to_string());
    }
    if config.max_staleness_ms == 0 {
        return Err("max_staleness_ms must be positive".to_string());
    }
    if config.heartbeat_interval_ms == 0 {
        return Err("heartbeat_interval_ms must be positive".to_string());
    }
    if config.outlier_threshold_bps == 0 {
        return Err("outlier_threshold_bps must be positive".to_string());
    }
    if config.deviation_alert_bps == 0 {
        return Err("deviation_alert_bps must be positive".to_string());
    }
    Ok(())
}

/// Count unique source IDs in a set of reports.
pub fn count_unique_sources(reports: &[PriceReport]) -> u64 {
    let mut ids: Vec<u64> = reports.iter().map(|r| r.source_id).collect();
    ids.sort();
    ids.dedup();
    ids.len() as u64
}

/// Find the source with highest reliability.
pub fn best_source(sources: &[OracleSource]) -> Option<OracleSource> {
    sources.iter().max_by_key(|s| s.reliability_bps).cloned()
}

/// Find the source with lowest reliability.
pub fn worst_source(sources: &[OracleSource]) -> Option<OracleSource> {
    sources.iter().min_by_key(|s| s.reliability_bps).cloned()
}

/// Get total weight of all sources (should sum to BPS for normalized weights).
pub fn total_source_weight(sources: &[OracleSource]) -> u64 {
    sources.iter().map(|s| s.weight_bps).sum()
}

/// Normalize source weights to sum to BPS.
pub fn normalize_weights(sources: &[OracleSource]) -> Vec<OracleSource> {
    let total = total_source_weight(sources);
    if total == 0 || sources.is_empty() {
        return sources.to_vec();
    }
    sources
        .iter()
        .map(|s| {
            let mut ns = s.clone();
            ns.weight_bps = (s.weight_bps as u128 * BPS as u128 / total as u128) as u64;
            ns
        })
        .collect()
}

/// Check if source has degraded reliability.
pub fn is_degraded(source: &OracleSource) -> bool {
    source.reliability_bps < MIN_RELIABILITY_BPS
}

/// Get reports for a specific pair.
pub fn filter_reports_by_pair(reports: &[PriceReport], pair_id: u64) -> Vec<PriceReport> {
    reports
        .iter()
        .filter(|r| r.pair_id == pair_id)
        .cloned()
        .collect()
}

/// Get reports from a specific source.
pub fn filter_reports_by_source(reports: &[PriceReport], source_id: u64) -> Vec<PriceReport> {
    reports
        .iter()
        .filter(|r| r.source_id == source_id)
        .cloned()
        .collect()
}

/// Get latest report per source (deduplicate by taking most recent).
pub fn deduplicate_reports(reports: &[PriceReport]) -> Vec<PriceReport> {
    let mut latest: std::collections::HashMap<u64, PriceReport> = std::collections::HashMap::new();
    for r in reports {
        let entry = latest.entry(r.source_id).or_insert_with(|| r.clone());
        if r.timestamp > entry.timestamp {
            *entry = r.clone();
        }
    }
    let mut result: Vec<PriceReport> = latest.into_values().collect();
    result.sort_by_key(|r| r.source_id);
    result
}

/// Compute price range (min, max) from reports.
pub fn price_range(reports: &[PriceReport]) -> (u64, u64) {
    if reports.is_empty() {
        return (0, 0);
    }
    let min = reports.iter().map(|r| r.price).min().unwrap_or(0);
    let max = reports.iter().map(|r| r.price).max().unwrap_or(0);
    (min, max)
}

/// Compute spread in bps between min and max price.
pub fn price_spread_bps(reports: &[PriceReport]) -> u64 {
    let (min, max) = price_range(reports);
    if min == 0 {
        return 0;
    }
    price_change_bps(min, max)
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Test helpers ----

    fn make_report(source_id: u64, price: u64, timestamp: u64) -> PriceReport {
        PriceReport {
            source_id,
            pair_id: 1,
            price,
            timestamp,
            confidence_bps: 9500,
            round_id: 1,
        }
    }

    fn make_report_with_pair(source_id: u64, pair_id: u64, price: u64, ts: u64) -> PriceReport {
        PriceReport {
            source_id,
            pair_id,
            price,
            timestamp: ts,
            confidence_bps: 9500,
            round_id: 1,
        }
    }

    fn make_source(id: u64, weight: u64, reliability: u64) -> OracleSource {
        OracleSource {
            id,
            name_hash: id * 1000,
            weight_bps: weight,
            reliability_bps: reliability,
            last_report_at: 1000,
            total_reports: 10,
            stale_count: 0,
        }
    }

    fn make_config(pair_id: u64) -> FeedConfig {
        FeedConfig {
            pair_id,
            min_sources: 3,
            max_staleness_ms: 300_000,
            outlier_threshold_bps: 1_000,
            heartbeat_interval_ms: 60_000,
            deviation_alert_bps: 500,
        }
    }

    // ============ calculate_mean tests ============

    #[test]
    fn test_mean_empty() {
        assert_eq!(calculate_mean(&[]), 0);
    }

    #[test]
    fn test_mean_single() {
        assert_eq!(calculate_mean(&[100]), 100);
    }

    #[test]
    fn test_mean_two_values() {
        assert_eq!(calculate_mean(&[100, 200]), 150);
    }

    #[test]
    fn test_mean_three_values() {
        assert_eq!(calculate_mean(&[100, 200, 300]), 200);
    }

    #[test]
    fn test_mean_identical_values() {
        assert_eq!(calculate_mean(&[500, 500, 500, 500]), 500);
    }

    #[test]
    fn test_mean_large_values() {
        assert_eq!(
            calculate_mean(&[u64::MAX / 2, u64::MAX / 2]),
            u64::MAX / 2
        );
    }

    #[test]
    fn test_mean_uneven_division() {
        // (10 + 20 + 31) / 3 = 20 (integer division)
        assert_eq!(calculate_mean(&[10, 20, 31]), 20);
    }

    // ============ calculate_std_dev_approx tests ============

    #[test]
    fn test_std_dev_empty() {
        assert_eq!(calculate_std_dev_approx(&[], 0), 0);
    }

    #[test]
    fn test_std_dev_single() {
        assert_eq!(calculate_std_dev_approx(&[100], 100), 0);
    }

    #[test]
    fn test_std_dev_identical() {
        assert_eq!(calculate_std_dev_approx(&[50, 50, 50], 50), 0);
    }

    #[test]
    fn test_std_dev_simple() {
        // values: [100, 200], mean=150, deviations: [50, 50]
        // variance = (2500+2500)/2 = 2500, sqrt(2500) = 50
        assert_eq!(calculate_std_dev_approx(&[100, 200], 150), 50);
    }

    #[test]
    fn test_std_dev_spread_values() {
        // [0, 100], mean=50 => variance = (2500+2500)/2=2500 => sqrt=50
        assert_eq!(calculate_std_dev_approx(&[0, 100], 50), 50);
    }

    #[test]
    fn test_std_dev_asymmetric() {
        // [10, 20, 30], mean=20
        // deviations: [10, 0, 10], variance = (100+0+100)/3 = 66
        // sqrt(66) = 8
        let result = calculate_std_dev_approx(&[10, 20, 30], 20);
        assert!(result >= 7 && result <= 9); // ~8.12
    }

    // ============ calculate_iqr tests ============

    #[test]
    fn test_iqr_empty() {
        assert_eq!(calculate_iqr(&[]), (0, 0));
    }

    #[test]
    fn test_iqr_single() {
        assert_eq!(calculate_iqr(&[100]), (100, 100));
    }

    #[test]
    fn test_iqr_two_values() {
        assert_eq!(calculate_iqr(&[100, 200]), (100, 200));
    }

    #[test]
    fn test_iqr_four_values() {
        // sorted: [10, 20, 30, 40]
        // lower half: [10, 20] => Q1 = 15
        // upper half: [30, 40] => Q3 = 35
        assert_eq!(calculate_iqr(&[10, 20, 30, 40]), (15, 35));
    }

    #[test]
    fn test_iqr_five_values() {
        // sorted: [10, 20, 30, 40, 50]
        // lower: [10, 20] => Q1=15, upper: [40, 50] => Q3=45
        assert_eq!(calculate_iqr(&[10, 20, 30, 40, 50]), (15, 45));
    }

    #[test]
    fn test_iqr_identical() {
        assert_eq!(calculate_iqr(&[100, 100, 100, 100]), (100, 100));
    }

    // ============ sort_reports_by_price tests ============

    #[test]
    fn test_sort_empty() {
        let result = sort_reports_by_price(&[]);
        assert!(result.is_empty());
    }

    #[test]
    fn test_sort_single_report() {
        let reports = vec![make_report(1, 100, 1000)];
        let sorted = sort_reports_by_price(&reports);
        assert_eq!(sorted.len(), 1);
        assert_eq!(sorted[0].price, 100);
    }

    #[test]
    fn test_sort_already_sorted() {
        let reports = vec![
            make_report(1, 100, 1000),
            make_report(2, 200, 1000),
            make_report(3, 300, 1000),
        ];
        let sorted = sort_reports_by_price(&reports);
        assert_eq!(sorted[0].price, 100);
        assert_eq!(sorted[2].price, 300);
    }

    #[test]
    fn test_sort_reverse_order() {
        let reports = vec![
            make_report(1, 300, 1000),
            make_report(2, 200, 1000),
            make_report(3, 100, 1000),
        ];
        let sorted = sort_reports_by_price(&reports);
        assert_eq!(sorted[0].price, 100);
        assert_eq!(sorted[1].price, 200);
        assert_eq!(sorted[2].price, 300);
    }

    #[test]
    fn test_sort_preserves_source_ids() {
        let reports = vec![
            make_report(1, 300, 1000),
            make_report(2, 100, 1000),
        ];
        let sorted = sort_reports_by_price(&reports);
        assert_eq!(sorted[0].source_id, 2);
        assert_eq!(sorted[1].source_id, 1);
    }

    // ============ aggregate_median tests ============

    #[test]
    fn test_median_empty_error() {
        assert!(aggregate_median(&[]).is_err());
    }

    #[test]
    fn test_median_single_report() {
        let reports = vec![make_report(1, 1000, 100)];
        assert_eq!(aggregate_median(&reports).unwrap(), 1000);
    }

    #[test]
    fn test_median_odd_count() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 300, 100),
            make_report(3, 200, 100),
        ];
        assert_eq!(aggregate_median(&reports).unwrap(), 200);
    }

    #[test]
    fn test_median_even_count() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 200, 100),
            make_report(3, 300, 100),
            make_report(4, 400, 100),
        ];
        assert_eq!(aggregate_median(&reports).unwrap(), 250);
    }

    #[test]
    fn test_median_all_same_price() {
        let reports = vec![
            make_report(1, 500, 100),
            make_report(2, 500, 100),
            make_report(3, 500, 100),
        ];
        assert_eq!(aggregate_median(&reports).unwrap(), 500);
    }

    #[test]
    fn test_median_two_reports() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 200, 100),
        ];
        assert_eq!(aggregate_median(&reports).unwrap(), 150);
    }

    #[test]
    fn test_median_with_outlier() {
        // Median is resistant to outliers
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 100, 100),
            make_report(3, 100, 100),
            make_report(4, 100, 100),
            make_report(5, 999_999, 100),
        ];
        assert_eq!(aggregate_median(&reports).unwrap(), 100);
    }

    #[test]
    fn test_median_large_prices() {
        let reports = vec![
            make_report(1, 1_000_000_000, 100),
            make_report(2, 2_000_000_000, 100),
            make_report(3, 3_000_000_000, 100),
        ];
        assert_eq!(aggregate_median(&reports).unwrap(), 2_000_000_000);
    }

    // ============ aggregate_twap tests ============

    #[test]
    fn test_twap_empty_error() {
        assert!(aggregate_twap(&[], 1000).is_err());
    }

    #[test]
    fn test_twap_zero_window_error() {
        let reports = vec![make_report(1, 100, 100)];
        assert!(aggregate_twap(&reports, 0).is_err());
    }

    #[test]
    fn test_twap_single_report() {
        let reports = vec![make_report(1, 500, 1000)];
        assert_eq!(aggregate_twap(&reports, 5000).unwrap(), 500);
    }

    #[test]
    fn test_twap_constant_price() {
        let reports = vec![
            make_report(1, 100, 1000),
            make_report(2, 100, 2000),
            make_report(3, 100, 3000),
        ];
        assert_eq!(aggregate_twap(&reports, 5000).unwrap(), 100);
    }

    #[test]
    fn test_twap_linear_increase() {
        // Price goes 100@t=0, 200@t=1000
        // TWAP = 100 (price at first point held for 1000ms)
        let reports = vec![
            make_report(1, 100, 0),
            make_report(2, 200, 1000),
        ];
        assert_eq!(aggregate_twap(&reports, 5000).unwrap(), 100);
    }

    #[test]
    fn test_twap_window_filters_old() {
        // Only reports in last 1000ms window from latest (t=3000)
        let reports = vec![
            make_report(1, 100, 1000),  // outside window
            make_report(2, 200, 2500),  // inside
            make_report(3, 300, 3000),  // inside
        ];
        let result = aggregate_twap(&reports, 1000).unwrap();
        // Within window: 200@2500, 300@3000
        // duration = 500, weighted = 200*500/500 = 200
        assert_eq!(result, 200);
    }

    #[test]
    fn test_twap_same_timestamp_average() {
        let reports = vec![
            make_report(1, 100, 1000),
            make_report(2, 200, 1000),
            make_report(3, 300, 1000),
        ];
        // All same timestamp => simple average = 200
        assert_eq!(aggregate_twap(&reports, 5000).unwrap(), 200);
    }

    // ============ aggregate_vwap tests ============

    #[test]
    fn test_vwap_empty_error() {
        assert!(aggregate_vwap(&[], &[]).is_err());
    }

    #[test]
    fn test_vwap_length_mismatch() {
        let reports = vec![make_report(1, 100, 100)];
        assert!(aggregate_vwap(&reports, &[100, 200]).is_err());
    }

    #[test]
    fn test_vwap_zero_total_volume() {
        let reports = vec![make_report(1, 100, 100)];
        assert!(aggregate_vwap(&reports, &[0]).is_err());
    }

    #[test]
    fn test_vwap_single() {
        let reports = vec![make_report(1, 100, 100)];
        assert_eq!(aggregate_vwap(&reports, &[500]).unwrap(), 100);
    }

    #[test]
    fn test_vwap_equal_volume() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 200, 100),
        ];
        // Equal volume => simple average
        assert_eq!(aggregate_vwap(&reports, &[100, 100]).unwrap(), 150);
    }

    #[test]
    fn test_vwap_skewed_volume() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 200, 100),
        ];
        // 90% volume at 100, 10% at 200
        // (100*900 + 200*100) / 1000 = (90000+20000)/1000 = 110
        assert_eq!(aggregate_vwap(&reports, &[900, 100]).unwrap(), 110);
    }

    #[test]
    fn test_vwap_three_sources() {
        let reports = vec![
            make_report(1, 1000, 100),
            make_report(2, 2000, 100),
            make_report(3, 3000, 100),
        ];
        // volumes: 100, 200, 300 => weighted = (100k+400k+900k)/600 = 1400k/600 = 2333
        assert_eq!(aggregate_vwap(&reports, &[100, 200, 300]).unwrap(), 2333);
    }

    // ============ aggregate_weighted tests ============

    #[test]
    fn test_weighted_empty_error() {
        assert!(aggregate_weighted(&[], &[]).is_err());
    }

    #[test]
    fn test_weighted_no_matching_sources() {
        let reports = vec![make_report(99, 100, 100)];
        let sources = vec![make_source(1, 5000, 9000)];
        assert!(aggregate_weighted(&reports, &sources).is_err());
    }

    #[test]
    fn test_weighted_equal_weights() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 200, 100),
        ];
        let sources = vec![
            make_source(1, 5000, 9000),
            make_source(2, 5000, 9000),
        ];
        assert_eq!(aggregate_weighted(&reports, &sources).unwrap(), 150);
    }

    #[test]
    fn test_weighted_skewed_weights() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 200, 100),
        ];
        let sources = vec![
            make_source(1, 9000, 9000),
            make_source(2, 1000, 9000),
        ];
        // (100*9000 + 200*1000) / 10000 = (900000+200000)/10000 = 110
        assert_eq!(aggregate_weighted(&reports, &sources).unwrap(), 110);
    }

    #[test]
    fn test_weighted_single_source() {
        let reports = vec![make_report(1, 500, 100)];
        let sources = vec![make_source(1, 10000, 9000)];
        assert_eq!(aggregate_weighted(&reports, &sources).unwrap(), 500);
    }

    // ============ register_source tests ============

    #[test]
    fn test_register_source_success() {
        let mut sources = vec![];
        let s = make_source(1, 5000, 9000);
        assert!(register_source(&mut sources, s).is_ok());
        assert_eq!(sources.len(), 1);
    }

    #[test]
    fn test_register_source_duplicate() {
        let mut sources = vec![make_source(1, 5000, 9000)];
        let s = make_source(1, 5000, 9000);
        assert!(register_source(&mut sources, s).is_err());
    }

    #[test]
    fn test_register_source_at_capacity() {
        let mut sources: Vec<OracleSource> = (0..MAX_SOURCES as u64)
            .map(|i| make_source(i, 100, 9000))
            .collect();
        let s = make_source(999, 100, 9000);
        assert!(register_source(&mut sources, s).is_err());
    }

    #[test]
    fn test_register_multiple_sources() {
        let mut sources = vec![];
        for i in 0..5 {
            assert!(register_source(&mut sources, make_source(i, 2000, 9000)).is_ok());
        }
        assert_eq!(sources.len(), 5);
    }

    // ============ deregister_source tests ============

    #[test]
    fn test_deregister_source_success() {
        let mut sources = vec![make_source(1, 5000, 9000), make_source(2, 5000, 9000)];
        let removed = deregister_source(&mut sources, 1).unwrap();
        assert_eq!(removed.id, 1);
        assert_eq!(sources.len(), 1);
    }

    #[test]
    fn test_deregister_source_not_found() {
        let mut sources = vec![make_source(1, 5000, 9000)];
        assert!(deregister_source(&mut sources, 99).is_err());
    }

    #[test]
    fn test_deregister_last_source() {
        let mut sources = vec![make_source(1, 10000, 9000)];
        let removed = deregister_source(&mut sources, 1).unwrap();
        assert_eq!(removed.id, 1);
        assert!(sources.is_empty());
    }

    // ============ update_source_reliability tests ============

    #[test]
    fn test_reliability_success_increases() {
        let source = make_source(1, 5000, 5000);
        let updated = update_source_reliability(&source, true);
        assert!(updated.reliability_bps > 5000);
    }

    #[test]
    fn test_reliability_failure_decreases() {
        let source = make_source(1, 5000, 8000);
        let updated = update_source_reliability(&source, false);
        assert!(updated.reliability_bps < 8000);
    }

    #[test]
    fn test_reliability_success_increments_reports() {
        let source = make_source(1, 5000, 5000);
        let updated = update_source_reliability(&source, true);
        assert_eq!(updated.total_reports, source.total_reports + 1);
    }

    #[test]
    fn test_reliability_failure_increments_stale_count() {
        let source = make_source(1, 5000, 5000);
        let updated = update_source_reliability(&source, false);
        assert_eq!(updated.stale_count, source.stale_count + 1);
    }

    #[test]
    fn test_reliability_at_max_stays_near_max() {
        let source = make_source(1, 5000, BPS);
        let updated = update_source_reliability(&source, true);
        assert_eq!(updated.reliability_bps, BPS);
    }

    #[test]
    fn test_reliability_at_zero_stays_zero_on_failure() {
        let source = OracleSource {
            id: 1,
            name_hash: 1000,
            weight_bps: 5000,
            reliability_bps: 0,
            last_report_at: 1000,
            total_reports: 10,
            stale_count: 5,
        };
        let updated = update_source_reliability(&source, false);
        assert_eq!(updated.reliability_bps, 0);
    }

    #[test]
    fn test_reliability_converges_upward() {
        let mut source = make_source(1, 5000, 1000);
        for _ in 0..100 {
            source = update_source_reliability(&source, true);
        }
        assert!(source.reliability_bps > 9000);
    }

    // ============ filter_outliers_zscore tests ============

    #[test]
    fn test_zscore_empty() {
        let result = filter_outliers_zscore(&[], 20000);
        assert!(result.is_empty());
    }

    #[test]
    fn test_zscore_single_report() {
        let reports = vec![make_report(1, 100, 100)];
        let result = filter_outliers_zscore(&reports, 20000);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_zscore_two_reports_kept() {
        let reports = vec![make_report(1, 100, 100), make_report(2, 200, 100)];
        let result = filter_outliers_zscore(&reports, 20000);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_zscore_removes_extreme_outlier() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 100, 100),
            make_report(3, 100, 100),
            make_report(4, 100, 100),
            make_report(5, 100, 100),
            make_report(6, 100, 100),
            make_report(7, 100, 100),
            make_report(8, 100, 100),
            make_report(9, 100, 100),
            make_report(10, 100_000, 100), // extreme outlier
        ];
        // Mean ~ 10090, std_dev is large but the outlier is extreme
        // With threshold 15000 (1.5 std devs), outlier should be removed
        let result = filter_outliers_zscore(&reports, 15000);
        assert!(result.len() < reports.len());
    }

    #[test]
    fn test_zscore_all_identical_keeps_all() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 100, 100),
            make_report(3, 100, 100),
        ];
        let result = filter_outliers_zscore(&reports, 20000);
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn test_zscore_tight_threshold_removes_more() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 110, 100),
            make_report(3, 120, 100),
            make_report(4, 200, 100),
        ];
        let loose = filter_outliers_zscore(&reports, 30000);
        let tight = filter_outliers_zscore(&reports, 10000);
        assert!(tight.len() <= loose.len());
    }

    // ============ filter_outliers_iqr tests ============

    #[test]
    fn test_iqr_filter_empty() {
        let result = filter_outliers_iqr(&[], 15000);
        assert!(result.is_empty());
    }

    #[test]
    fn test_iqr_filter_single() {
        let reports = vec![make_report(1, 100, 100)];
        let result = filter_outliers_iqr(&reports, 15000);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_iqr_filter_two_reports() {
        let reports = vec![make_report(1, 100, 100), make_report(2, 200, 100)];
        let result = filter_outliers_iqr(&reports, 15000);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_iqr_filter_removes_outlier() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 102, 100),
            make_report(3, 104, 100),
            make_report(4, 106, 100),
            make_report(5, 108, 100),
            make_report(6, 110, 100),
            make_report(7, 5000, 100), // extreme outlier
        ];
        // sorted: [100,102,104,106,108,110,5000], n=7
        // lower: [100,102,104] => Q1=102
        // upper: [108,110,5000] => Q3=110
        // IQR=8, fence_ext = 8*15000/10000 = 12
        // upper fence = 110+12=122. 5000 > 122 => removed
        let result = filter_outliers_iqr(&reports, 15000);
        assert!(result.len() < reports.len());
        assert!(result.iter().all(|r| r.price <= 122));
    }

    #[test]
    fn test_iqr_filter_all_same_keeps_all() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 100, 100),
            make_report(3, 100, 100),
            make_report(4, 100, 100),
        ];
        let result = filter_outliers_iqr(&reports, 15000);
        assert_eq!(result.len(), 4);
    }

    #[test]
    fn test_iqr_filter_wide_multiplier_keeps_more() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 110, 100),
            make_report(3, 120, 100),
            make_report(4, 200, 100),
        ];
        let tight = filter_outliers_iqr(&reports, 10000);
        let wide = filter_outliers_iqr(&reports, 30000);
        assert!(tight.len() <= wide.len());
    }

    // ============ is_stale tests ============

    #[test]
    fn test_stale_report_is_stale() {
        let r = make_report(1, 100, 1000);
        assert!(is_stale(&r, 500_000, 300_000));
    }

    #[test]
    fn test_fresh_report_not_stale() {
        let r = make_report(1, 100, 1000);
        assert!(!is_stale(&r, 1500, 300_000));
    }

    #[test]
    fn test_exact_boundary_not_stale() {
        let r = make_report(1, 100, 1000);
        assert!(!is_stale(&r, 301_000, 300_000));
    }

    #[test]
    fn test_one_past_boundary_is_stale() {
        let r = make_report(1, 100, 1000);
        assert!(is_stale(&r, 301_001, 300_000));
    }

    #[test]
    fn test_future_report_not_stale() {
        let r = make_report(1, 100, 5000);
        assert!(!is_stale(&r, 1000, 300_000));
    }

    #[test]
    fn test_same_time_not_stale() {
        let r = make_report(1, 100, 1000);
        assert!(!is_stale(&r, 1000, 300_000));
    }

    // ============ filter_fresh_reports tests ============

    #[test]
    fn test_filter_fresh_empty() {
        let result = filter_fresh_reports(&[], 1000, 300_000);
        assert!(result.is_empty());
    }

    #[test]
    fn test_filter_fresh_all_fresh() {
        let reports = vec![
            make_report(1, 100, 900),
            make_report(2, 200, 950),
        ];
        let result = filter_fresh_reports(&reports, 1000, 300_000);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_filter_fresh_all_stale() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 200, 200),
        ];
        let result = filter_fresh_reports(&reports, 1_000_000, 300_000);
        assert!(result.is_empty());
    }

    #[test]
    fn test_filter_fresh_mixed() {
        let reports = vec![
            make_report(1, 100, 100),       // stale
            make_report(2, 200, 900_000),   // fresh
        ];
        let result = filter_fresh_reports(&reports, 1_000_000, 300_000);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].source_id, 2);
    }

    // ============ calculate_heartbeat_health tests ============

    #[test]
    fn test_heartbeat_on_time() {
        let source = OracleSource {
            id: 1, name_hash: 1000, weight_bps: 5000,
            reliability_bps: 9000, last_report_at: 950,
            total_reports: 10, stale_count: 0,
        };
        assert_eq!(calculate_heartbeat_health(&source, 1000, 60_000), BPS);
    }

    #[test]
    fn test_heartbeat_slightly_late() {
        let source = OracleSource {
            id: 1, name_hash: 1000, weight_bps: 5000,
            reliability_bps: 9000, last_report_at: 30_000,
            total_reports: 10, stale_count: 0,
        };
        // elapsed = 90000-30000=60000+30000 overshoot? No:
        // elapsed = 60000, exactly on time => BPS
        // Let's use last_report_at=20000 => elapsed=70000, overshoot=10000
        // remaining = 60000-10000 = 50000, health = 50000*10000/60000 = 8333
        let source2 = OracleSource {
            id: 1, name_hash: 1000, weight_bps: 5000,
            reliability_bps: 9000, last_report_at: 20_000,
            total_reports: 10, stale_count: 0,
        };
        let health = calculate_heartbeat_health(&source2, 90_000, 60_000);
        // elapsed=70000, overshoot=10000, remaining=50000
        // 50000*10000/60000 = 8333
        assert_eq!(health, 8333);
    }

    #[test]
    fn test_heartbeat_very_late_zero() {
        let source = OracleSource {
            id: 1, name_hash: 1000, weight_bps: 5000,
            reliability_bps: 9000, last_report_at: 10_000,
            total_reports: 10, stale_count: 0,
        };
        // elapsed = 200000-10000=190000, interval=60000, overshoot=130000 >= interval
        let health = calculate_heartbeat_health(&source, 200_000, 60_000);
        assert_eq!(health, 0);
    }

    #[test]
    fn test_heartbeat_zero_interval() {
        let source = make_source(1, 5000, 9000);
        assert_eq!(calculate_heartbeat_health(&source, 2000, 0), 0);
    }

    #[test]
    fn test_heartbeat_never_reported() {
        let mut source = make_source(1, 5000, 9000);
        source.last_report_at = 0;
        assert_eq!(calculate_heartbeat_health(&source, 1000, 60_000), 0);
    }

    // ============ start_round tests ============

    #[test]
    fn test_start_round_initial_values() {
        let round = start_round(1, 5000);
        assert_eq!(round.round_id, 1);
        assert_eq!(round.price, 0);
        assert_eq!(round.started_at, 5000);
        assert_eq!(round.answered_in_round, 0);
    }

    #[test]
    fn test_start_round_different_ids() {
        let r1 = start_round(1, 1000);
        let r2 = start_round(100, 2000);
        assert_eq!(r1.round_id, 1);
        assert_eq!(r2.round_id, 100);
    }

    // ============ update_round tests ============

    #[test]
    fn test_update_round_sets_price() {
        let round = start_round(1, 1000);
        let updated = update_round(&round, 500, 2000);
        assert_eq!(updated.price, 500);
        assert_eq!(updated.updated_at, 2000);
        assert_eq!(updated.answered_in_round, 1);
    }

    #[test]
    fn test_update_round_preserves_started_at() {
        let round = start_round(1, 1000);
        let updated = update_round(&round, 500, 2000);
        assert_eq!(updated.started_at, 1000);
    }

    #[test]
    fn test_update_round_multiple_times() {
        let round = start_round(1, 1000);
        let u1 = update_round(&round, 100, 2000);
        let u2 = update_round(&u1, 200, 3000);
        assert_eq!(u2.price, 200);
        assert_eq!(u2.updated_at, 3000);
        assert_eq!(u2.started_at, 1000);
    }

    // ============ get_latest_round tests ============

    #[test]
    fn test_latest_round_empty() {
        let rounds: Vec<RoundData> = vec![];
        assert!(get_latest_round(&rounds).is_none());
    }

    #[test]
    fn test_latest_round_single() {
        let rounds = vec![start_round(1, 1000)];
        let latest = get_latest_round(&rounds).unwrap();
        assert_eq!(latest.round_id, 1);
    }

    #[test]
    fn test_latest_round_multiple() {
        let rounds = vec![
            start_round(1, 1000),
            start_round(5, 2000),
            start_round(3, 3000),
        ];
        let latest = get_latest_round(&rounds).unwrap();
        assert_eq!(latest.round_id, 5);
    }

    // ============ get_round_by_id tests ============

    #[test]
    fn test_get_round_found() {
        let rounds = vec![start_round(1, 1000), start_round(2, 2000)];
        let r = get_round_by_id(&rounds, 2).unwrap();
        assert_eq!(r.round_id, 2);
    }

    #[test]
    fn test_get_round_not_found() {
        let rounds = vec![start_round(1, 1000)];
        assert!(get_round_by_id(&rounds, 99).is_none());
    }

    #[test]
    fn test_get_round_empty_list() {
        assert!(get_round_by_id(&[], 1).is_none());
    }

    // ============ calculate_confidence tests ============

    #[test]
    fn test_confidence_full_marks() {
        // 5 sources, min=3, perfect agreement, perfect freshness
        let c = calculate_confidence(5, 3, BPS, BPS);
        assert_eq!(c, BPS); // all maxed out
    }

    #[test]
    fn test_confidence_zero_min_sources() {
        assert_eq!(calculate_confidence(5, 0, BPS, BPS), 0);
    }

    #[test]
    fn test_confidence_below_min_sources() {
        let c = calculate_confidence(1, 3, BPS, BPS);
        // source_factor = 1*10000/3 = 3333
        // (3333 + 10000 + 10000) / 3 = 7777
        assert_eq!(c, 7777);
    }

    #[test]
    fn test_confidence_zero_agreement() {
        let c = calculate_confidence(3, 3, 0, BPS);
        // (10000 + 0 + 10000) / 3 = 6666
        assert_eq!(c, 6666);
    }

    #[test]
    fn test_confidence_zero_freshness() {
        let c = calculate_confidence(3, 3, BPS, 0);
        assert_eq!(c, 6666);
    }

    #[test]
    fn test_confidence_all_zero() {
        let c = calculate_confidence(0, 3, 0, 0);
        assert_eq!(c, 0);
    }

    // ============ calculate_agreement tests ============

    #[test]
    fn test_agreement_empty() {
        assert_eq!(calculate_agreement(&[]), 0);
    }

    #[test]
    fn test_agreement_single() {
        let reports = vec![make_report(1, 100, 100)];
        assert_eq!(calculate_agreement(&reports), BPS);
    }

    #[test]
    fn test_agreement_all_same() {
        let reports = vec![
            make_report(1, 1000, 100),
            make_report(2, 1000, 100),
            make_report(3, 1000, 100),
        ];
        assert_eq!(calculate_agreement(&reports), BPS);
    }

    #[test]
    fn test_agreement_one_outlier() {
        let reports = vec![
            make_report(1, 1000, 100),
            make_report(2, 1000, 100),
            make_report(3, 5000, 100), // way off
        ];
        // Median is 1000, threshold = 1000*100/10000 = 10
        // Source 3 at 5000 is way off. 2 of 3 agree.
        let a = calculate_agreement(&reports);
        assert_eq!(a, 6666); // 2/3 * 10000
    }

    #[test]
    fn test_agreement_all_disagree() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 500, 100),
            make_report(3, 1000, 100),
        ];
        // Median is 500, threshold = 500*100/10000 = 5
        // Only source 2 is within 5 of 500
        let a = calculate_agreement(&reports);
        assert_eq!(a, 3333); // 1/3
    }

    // ============ price_change_bps tests ============

    #[test]
    fn test_price_change_zero_to_zero() {
        assert_eq!(price_change_bps(0, 0), 0);
    }

    #[test]
    fn test_price_change_from_zero() {
        assert_eq!(price_change_bps(0, 100), BPS);
    }

    #[test]
    fn test_price_change_no_change() {
        assert_eq!(price_change_bps(100, 100), 0);
    }

    #[test]
    fn test_price_change_increase() {
        // 100 -> 110 = 10% = 1000 bps
        assert_eq!(price_change_bps(100, 110), 1000);
    }

    #[test]
    fn test_price_change_decrease() {
        // 100 -> 90 = 10% = 1000 bps
        assert_eq!(price_change_bps(100, 90), 1000);
    }

    #[test]
    fn test_price_change_double() {
        // 100 -> 200 = 100% = 10000 bps
        assert_eq!(price_change_bps(100, 200), BPS);
    }

    #[test]
    fn test_price_change_half() {
        // 200 -> 100 = 50% = 5000 bps
        assert_eq!(price_change_bps(200, 100), 5000);
    }

    #[test]
    fn test_price_change_small_move() {
        // 10000 -> 10001 = 0.01% = 1 bps
        assert_eq!(price_change_bps(10000, 10001), 1);
    }

    // ============ check_deviation tests ============

    #[test]
    fn test_deviation_no_alert() {
        assert!(check_deviation(100, 104, 500).is_none());
    }

    #[test]
    fn test_deviation_triggers_alert() {
        let alert = check_deviation(100, 110, 500).unwrap();
        assert_eq!(alert.old_price, 100);
        assert_eq!(alert.new_price, 110);
        assert_eq!(alert.deviation_bps, 1000);
    }

    #[test]
    fn test_deviation_exact_threshold_no_alert() {
        // 100 -> 105 = 5% = 500 bps, threshold=500, not > so no alert
        assert!(check_deviation(100, 105, 500).is_none());
    }

    #[test]
    fn test_deviation_decrease_triggers_alert() {
        let alert = check_deviation(100, 80, 500).unwrap();
        assert_eq!(alert.deviation_bps, 2000);
    }

    // ============ compute_derived_price tests ============

    #[test]
    fn test_derived_price_basic() {
        // ETH=2000*1e8, BTC=40000*1e8 => ETH/BTC = 2000/40000 * 1e8 = 5000000
        let base = 200_000_000_000;  // 2000 * 1e8
        let quote = 4_000_000_000_000; // 40000 * 1e8
        let result = compute_derived_price(base, quote).unwrap();
        assert_eq!(result, 5_000_000); // 0.05 * 1e8
    }

    #[test]
    fn test_derived_price_equal() {
        let result = compute_derived_price(100_000_000, 100_000_000).unwrap();
        assert_eq!(result, 100_000_000); // 1.0 * 1e8
    }

    #[test]
    fn test_derived_price_zero_quote() {
        assert!(compute_derived_price(100, 0).is_err());
    }

    #[test]
    fn test_derived_price_zero_base() {
        assert_eq!(compute_derived_price(0, 100).unwrap(), 0);
    }

    #[test]
    fn test_derived_price_base_larger_than_quote() {
        // 500 / 100 * 1e8 = 500_000_000
        let result = compute_derived_price(500, 100).unwrap();
        assert_eq!(result, 500_000_000);
    }

    // ============ build_aggregated_price tests ============

    #[test]
    fn test_build_aggregated_success() {
        let reports = vec![
            make_report(1, 1000, 9000),
            make_report(2, 1010, 9100),
            make_report(3, 1005, 9200),
        ];
        let sources = vec![
            make_source(1, 3333, 9000),
            make_source(2, 3333, 9000),
            make_source(3, 3334, 9000),
        ];
        let config = make_config(1);
        let result = build_aggregated_price(&reports, &sources, &config, 10000).unwrap();
        assert_eq!(result.pair_id, 1);
        assert_eq!(result.price, 1005); // median
        assert_eq!(result.source_count, 3);
        assert_eq!(result.method, METHOD_MEDIAN);
    }

    #[test]
    fn test_build_aggregated_empty_error() {
        let config = make_config(1);
        assert!(build_aggregated_price(&[], &[], &config, 10000).is_err());
    }

    #[test]
    fn test_build_aggregated_all_stale() {
        let reports = vec![
            make_report(1, 1000, 100),
            make_report(2, 1010, 200),
            make_report(3, 1005, 300),
        ];
        let config = make_config(1);
        // current_time = 1_000_000, max_staleness = 300_000
        assert!(build_aggregated_price(&reports, &[], &config, 1_000_000).is_err());
    }

    #[test]
    fn test_build_aggregated_insufficient_after_filter() {
        let reports = vec![
            make_report(1, 1000, 9000),
            make_report(2, 1010, 9100),
            // Only 2 fresh reports, config requires 3
        ];
        let config = make_config(1);
        assert!(build_aggregated_price(&reports, &[], &config, 10000).is_err());
    }

    #[test]
    fn test_build_aggregated_confidence_is_reasonable() {
        let reports = vec![
            make_report(1, 1000, 9000),
            make_report(2, 1000, 9000),
            make_report(3, 1000, 9000),
        ];
        let sources = vec![
            make_source(1, 3333, 9000),
            make_source(2, 3333, 9000),
            make_source(3, 3334, 9000),
        ];
        let config = make_config(1);
        let result = build_aggregated_price(&reports, &sources, &config, 10000).unwrap();
        // All identical prices at very recent timestamps => high confidence
        assert!(result.confidence_bps > 5000);
    }

    // ============ assess_feed_health tests ============

    #[test]
    fn test_feed_health_all_active() {
        let sources = vec![
            OracleSource { id: 1, name_hash: 0, weight_bps: 5000, reliability_bps: 9000, last_report_at: 9500, total_reports: 10, stale_count: 0 },
            OracleSource { id: 2, name_hash: 0, weight_bps: 5000, reliability_bps: 9000, last_report_at: 9800, total_reports: 10, stale_count: 0 },
        ];
        let config = make_config(1);
        let health = assess_feed_health(&sources, &config, 10000);
        assert_eq!(health.active_sources, 2);
        assert_eq!(health.stale_sources, 0);
    }

    #[test]
    fn test_feed_health_all_stale() {
        let sources = vec![
            OracleSource { id: 1, name_hash: 0, weight_bps: 5000, reliability_bps: 9000, last_report_at: 100, total_reports: 10, stale_count: 0 },
            OracleSource { id: 2, name_hash: 0, weight_bps: 5000, reliability_bps: 9000, last_report_at: 200, total_reports: 10, stale_count: 0 },
        ];
        let config = make_config(1);
        let health = assess_feed_health(&sources, &config, 1_000_000);
        assert_eq!(health.active_sources, 0);
        assert_eq!(health.stale_sources, 2);
    }

    #[test]
    fn test_feed_health_empty_sources() {
        let config = make_config(1);
        let health = assess_feed_health(&[], &config, 10000);
        assert_eq!(health.active_sources, 0);
        assert_eq!(health.stale_sources, 0);
        assert_eq!(health.avg_freshness_ms, 0);
    }

    #[test]
    fn test_feed_health_mixed() {
        let sources = vec![
            OracleSource { id: 1, name_hash: 0, weight_bps: 5000, reliability_bps: 9000, last_report_at: 900_000, total_reports: 10, stale_count: 0 },
            OracleSource { id: 2, name_hash: 0, weight_bps: 5000, reliability_bps: 9000, last_report_at: 100, total_reports: 10, stale_count: 0 },
        ];
        let config = make_config(1); // max_staleness_ms = 300_000
        let health = assess_feed_health(&sources, &config, 1_000_000);
        // Source 1: elapsed = 1000000-900000 = 100000 < 300000 => active
        // Source 2: elapsed = 1000000-100 = 999900 > 300000 => stale
        assert_eq!(health.active_sources, 1);
        assert_eq!(health.stale_sources, 1);
    }

    // ============ default_feed_config tests ============

    #[test]
    fn test_default_config_values() {
        let config = default_feed_config(42);
        assert_eq!(config.pair_id, 42);
        assert_eq!(config.min_sources, DEFAULT_MIN_SOURCES);
        assert_eq!(config.max_staleness_ms, DEFAULT_MAX_STALENESS_MS);
    }

    // ============ validate_feed_config tests ============

    #[test]
    fn test_validate_config_valid() {
        let config = default_feed_config(1);
        assert!(validate_feed_config(&config).is_ok());
    }

    #[test]
    fn test_validate_config_zero_min_sources() {
        let mut config = default_feed_config(1);
        config.min_sources = 0;
        assert!(validate_feed_config(&config).is_err());
    }

    #[test]
    fn test_validate_config_zero_staleness() {
        let mut config = default_feed_config(1);
        config.max_staleness_ms = 0;
        assert!(validate_feed_config(&config).is_err());
    }

    #[test]
    fn test_validate_config_zero_heartbeat() {
        let mut config = default_feed_config(1);
        config.heartbeat_interval_ms = 0;
        assert!(validate_feed_config(&config).is_err());
    }

    #[test]
    fn test_validate_config_zero_outlier_threshold() {
        let mut config = default_feed_config(1);
        config.outlier_threshold_bps = 0;
        assert!(validate_feed_config(&config).is_err());
    }

    #[test]
    fn test_validate_config_zero_deviation_alert() {
        let mut config = default_feed_config(1);
        config.deviation_alert_bps = 0;
        assert!(validate_feed_config(&config).is_err());
    }

    // ============ count_unique_sources tests ============

    #[test]
    fn test_count_unique_empty() {
        assert_eq!(count_unique_sources(&[]), 0);
    }

    #[test]
    fn test_count_unique_all_different() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 200, 100),
            make_report(3, 300, 100),
        ];
        assert_eq!(count_unique_sources(&reports), 3);
    }

    #[test]
    fn test_count_unique_with_duplicates() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(1, 110, 200),
            make_report(2, 200, 100),
        ];
        assert_eq!(count_unique_sources(&reports), 2);
    }

    // ============ best_source / worst_source tests ============

    #[test]
    fn test_best_source_empty() {
        assert!(best_source(&[]).is_none());
    }

    #[test]
    fn test_best_source_single() {
        let sources = vec![make_source(1, 5000, 8000)];
        assert_eq!(best_source(&sources).unwrap().id, 1);
    }

    #[test]
    fn test_best_source_picks_highest_reliability() {
        let sources = vec![
            make_source(1, 5000, 7000),
            make_source(2, 5000, 9000),
            make_source(3, 5000, 8000),
        ];
        assert_eq!(best_source(&sources).unwrap().id, 2);
    }

    #[test]
    fn test_worst_source_picks_lowest_reliability() {
        let sources = vec![
            make_source(1, 5000, 7000),
            make_source(2, 5000, 9000),
            make_source(3, 5000, 8000),
        ];
        assert_eq!(worst_source(&sources).unwrap().id, 1);
    }

    // ============ total_source_weight tests ============

    #[test]
    fn test_total_weight_empty() {
        assert_eq!(total_source_weight(&[]), 0);
    }

    #[test]
    fn test_total_weight_sums_correctly() {
        let sources = vec![
            make_source(1, 3000, 9000),
            make_source(2, 3000, 9000),
            make_source(3, 4000, 9000),
        ];
        assert_eq!(total_source_weight(&sources), 10000);
    }

    // ============ normalize_weights tests ============

    #[test]
    fn test_normalize_empty() {
        let result = normalize_weights(&[]);
        assert!(result.is_empty());
    }

    #[test]
    fn test_normalize_already_normalized() {
        let sources = vec![
            make_source(1, 5000, 9000),
            make_source(2, 5000, 9000),
        ];
        let normalized = normalize_weights(&sources);
        assert_eq!(total_source_weight(&normalized), BPS);
    }

    #[test]
    fn test_normalize_uneven_weights() {
        let sources = vec![
            make_source(1, 100, 9000),
            make_source(2, 300, 9000),
        ];
        let normalized = normalize_weights(&sources);
        // 100/400 * 10000 = 2500, 300/400 * 10000 = 7500
        assert_eq!(normalized[0].weight_bps, 2500);
        assert_eq!(normalized[1].weight_bps, 7500);
    }

    #[test]
    fn test_normalize_zero_total_unchanged() {
        let sources = vec![
            make_source(1, 0, 9000),
            make_source(2, 0, 9000),
        ];
        let normalized = normalize_weights(&sources);
        assert_eq!(normalized[0].weight_bps, 0);
    }

    // ============ is_degraded tests ============

    #[test]
    fn test_is_degraded_below_threshold() {
        let source = make_source(1, 5000, 4000);
        assert!(is_degraded(&source));
    }

    #[test]
    fn test_is_not_degraded_above_threshold() {
        let source = make_source(1, 5000, 8000);
        assert!(!is_degraded(&source));
    }

    #[test]
    fn test_is_degraded_at_threshold() {
        let source = make_source(1, 5000, MIN_RELIABILITY_BPS);
        assert!(!is_degraded(&source));
    }

    // ============ filter_reports_by_pair tests ============

    #[test]
    fn test_filter_by_pair_empty() {
        assert!(filter_reports_by_pair(&[], 1).is_empty());
    }

    #[test]
    fn test_filter_by_pair_matches() {
        let reports = vec![
            make_report_with_pair(1, 1, 100, 100),
            make_report_with_pair(2, 2, 200, 100),
            make_report_with_pair(3, 1, 300, 100),
        ];
        let filtered = filter_reports_by_pair(&reports, 1);
        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn test_filter_by_pair_no_match() {
        let reports = vec![make_report_with_pair(1, 1, 100, 100)];
        assert!(filter_reports_by_pair(&reports, 99).is_empty());
    }

    // ============ filter_reports_by_source tests ============

    #[test]
    fn test_filter_by_source_matches() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 200, 100),
            make_report(1, 300, 200),
        ];
        let filtered = filter_reports_by_source(&reports, 1);
        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn test_filter_by_source_no_match() {
        let reports = vec![make_report(1, 100, 100)];
        assert!(filter_reports_by_source(&reports, 99).is_empty());
    }

    // ============ deduplicate_reports tests ============

    #[test]
    fn test_deduplicate_empty() {
        assert!(deduplicate_reports(&[]).is_empty());
    }

    #[test]
    fn test_deduplicate_no_duplicates() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 200, 100),
        ];
        let deduped = deduplicate_reports(&reports);
        assert_eq!(deduped.len(), 2);
    }

    #[test]
    fn test_deduplicate_keeps_latest() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(1, 200, 200), // newer
            make_report(2, 300, 100),
        ];
        let deduped = deduplicate_reports(&reports);
        assert_eq!(deduped.len(), 2);
        let s1 = deduped.iter().find(|r| r.source_id == 1).unwrap();
        assert_eq!(s1.price, 200); // kept the newer one
    }

    #[test]
    fn test_deduplicate_many_from_same_source() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(1, 200, 200),
            make_report(1, 300, 300),
            make_report(1, 400, 400),
        ];
        let deduped = deduplicate_reports(&reports);
        assert_eq!(deduped.len(), 1);
        assert_eq!(deduped[0].price, 400);
    }

    // ============ price_range tests ============

    #[test]
    fn test_price_range_empty() {
        assert_eq!(price_range(&[]), (0, 0));
    }

    #[test]
    fn test_price_range_single() {
        let reports = vec![make_report(1, 500, 100)];
        assert_eq!(price_range(&reports), (500, 500));
    }

    #[test]
    fn test_price_range_multiple() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 500, 100),
            make_report(3, 300, 100),
        ];
        assert_eq!(price_range(&reports), (100, 500));
    }

    // ============ price_spread_bps tests ============

    #[test]
    fn test_spread_empty() {
        assert_eq!(price_spread_bps(&[]), 0);
    }

    #[test]
    fn test_spread_single() {
        let reports = vec![make_report(1, 100, 100)];
        assert_eq!(price_spread_bps(&reports), 0);
    }

    #[test]
    fn test_spread_ten_percent() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 110, 100),
        ];
        assert_eq!(price_spread_bps(&reports), 1000);
    }

    #[test]
    fn test_spread_zero_min_price() {
        let reports = vec![
            make_report(1, 0, 100),
            make_report(2, 100, 100),
        ];
        assert_eq!(price_spread_bps(&reports), 0);
    }

    // ============ DerivedFeed struct tests ============

    #[test]
    fn test_derived_feed_struct() {
        let df = DerivedFeed {
            pair_id: 1,
            base_pair_id: 2,
            quote_pair_id: 3,
            last_computed_price: 500,
            last_computed_at: 1000,
        };
        assert_eq!(df.pair_id, 1);
        assert_eq!(df.base_pair_id, 2);
        assert_eq!(df.quote_pair_id, 3);
    }

    // ============ DeviationAlert struct tests ============

    #[test]
    fn test_deviation_alert_struct() {
        let alert = DeviationAlert {
            pair_id: 1,
            old_price: 100,
            new_price: 200,
            deviation_bps: 10000,
            timestamp: 5000,
            source_id: 7,
        };
        assert_eq!(alert.pair_id, 1);
        assert_eq!(alert.deviation_bps, 10000);
    }

    // ============ FeedHealth struct tests ============

    #[test]
    fn test_feed_health_struct() {
        let h = FeedHealth {
            pair_id: 1,
            active_sources: 5,
            stale_sources: 1,
            avg_freshness_ms: 30_000,
            confidence_bps: 8500,
        };
        assert_eq!(h.active_sources, 5);
        assert_eq!(h.confidence_bps, 8500);
    }

    // ============ Edge case / integration tests ============

    #[test]
    fn test_full_pipeline_with_outlier_removal() {
        // 5 sources, one outlier
        let reports = vec![
            make_report(1, 1000, 9000),
            make_report(2, 1005, 9100),
            make_report(3, 1010, 9200),
            make_report(4, 1003, 9300),
            make_report(5, 5000, 9400), // outlier
        ];
        let sources: Vec<OracleSource> = (1..=5)
            .map(|i| make_source(i, 2000, 9000))
            .collect();
        let config = FeedConfig {
            pair_id: 1,
            min_sources: 3,
            max_staleness_ms: 300_000,
            outlier_threshold_bps: 1000,
            heartbeat_interval_ms: 60_000,
            deviation_alert_bps: 500,
        };
        let result = build_aggregated_price(&reports, &sources, &config, 10000).unwrap();
        // After IQR outlier removal, the 5000 outlier should be gone
        assert!(result.price >= 1000 && result.price <= 1010);
        assert!(result.source_count >= 3);
    }

    #[test]
    fn test_full_pipeline_fresh_and_stale_mixed() {
        let reports = vec![
            make_report(1, 1000, 100),      // stale (current=500000)
            make_report(2, 1005, 100),      // stale
            make_report(3, 1010, 400_000),  // fresh
            make_report(4, 1003, 400_000),  // fresh
            make_report(5, 1007, 400_000),  // fresh
        ];
        let sources: Vec<OracleSource> = (1..=5).map(|i| make_source(i, 2000, 9000)).collect();
        let config = make_config(1);
        let result = build_aggregated_price(&reports, &sources, &config, 500_000).unwrap();
        assert_eq!(result.source_count, 3); // only 3 fresh
    }

    #[test]
    fn test_isqrt_helper() {
        assert_eq!(isqrt(0), 0);
        assert_eq!(isqrt(1), 1);
        assert_eq!(isqrt(4), 2);
        assert_eq!(isqrt(9), 3);
        assert_eq!(isqrt(100), 10);
        assert_eq!(isqrt(2), 1); // floor
        assert_eq!(isqrt(8), 2);
    }

    #[test]
    fn test_median_of_slice_helper() {
        assert_eq!(median_of_slice(&[]), 0);
        assert_eq!(median_of_slice(&[5]), 5);
        assert_eq!(median_of_slice(&[3, 7]), 5);
        assert_eq!(median_of_slice(&[1, 2, 3]), 2);
    }

    #[test]
    fn test_aggregate_weighted_ignores_zero_weight_sources() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 200, 100),
        ];
        let sources = vec![
            make_source(1, 10000, 9000),
            make_source(2, 0, 9000), // zero weight
        ];
        assert_eq!(aggregate_weighted(&reports, &sources).unwrap(), 100);
    }

    #[test]
    fn test_twap_all_outside_window() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 200, 200),
        ];
        // window_ms = 10, latest = 200, window_start = 190
        // report at 100 is outside, report at 200 is inside (single)
        let result = aggregate_twap(&reports, 10).unwrap();
        assert_eq!(result, 200);
    }

    #[test]
    fn test_reliability_repeated_success() {
        let mut s = make_source(1, 5000, 5000);
        for _ in 0..50 {
            s = update_source_reliability(&s, true);
        }
        assert!(s.reliability_bps > 9500);
        assert_eq!(s.total_reports, 60); // 10 initial + 50
    }

    #[test]
    fn test_reliability_repeated_failure() {
        let mut s = make_source(1, 5000, 10000);
        for _ in 0..50 {
            s = update_source_reliability(&s, false);
        }
        assert!(s.reliability_bps < 100);
        assert_eq!(s.stale_count, 50);
    }

    #[test]
    fn test_heartbeat_exactly_at_interval() {
        let source = OracleSource {
            id: 1, name_hash: 0, weight_bps: 5000,
            reliability_bps: 9000, last_report_at: 10_000,
            total_reports: 10, stale_count: 0,
        };
        // elapsed = 70000-10000 = 60000 = interval => on time
        assert_eq!(calculate_heartbeat_health(&source, 70_000, 60_000), BPS);
    }

    #[test]
    fn test_round_trip_start_update_get() {
        let r = start_round(42, 1000);
        let updated = update_round(&r, 999, 2000);
        let rounds = vec![updated.clone()];
        let found = get_round_by_id(&rounds, 42).unwrap();
        assert_eq!(found.price, 999);
        assert_eq!(found.started_at, 1000);
        assert_eq!(found.updated_at, 2000);
    }

    #[test]
    fn test_large_number_of_reports_median() {
        let reports: Vec<PriceReport> = (1..=101)
            .map(|i| make_report(i, i * 10, 1000))
            .collect();
        let median = aggregate_median(&reports).unwrap();
        assert_eq!(median, 510); // 51st value = 510
    }

    #[test]
    fn test_vwap_single_zero_volume_among_valid() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 200, 100),
            make_report(3, 300, 100),
        ];
        let volumes = vec![0, 100, 100];
        // (100*0 + 200*100 + 300*100) / 200 = 50000/200 = 250
        assert_eq!(aggregate_vwap(&reports, &volumes).unwrap(), 250);
    }

    #[test]
    fn test_price_change_bps_large_values() {
        let old = 1_000_000_000u64;
        let new = 1_100_000_000u64;
        assert_eq!(price_change_bps(old, new), 1000);
    }

    #[test]
    fn test_derived_price_small_values() {
        // 1/1 = 1e8
        assert_eq!(compute_derived_price(1, 1).unwrap(), 100_000_000);
    }

    #[test]
    fn test_assess_feed_health_source_never_reported() {
        let sources = vec![OracleSource {
            id: 1, name_hash: 0, weight_bps: 10000,
            reliability_bps: 9000, last_report_at: 0,
            total_reports: 0, stale_count: 0,
        }];
        let config = make_config(1);
        let health = assess_feed_health(&sources, &config, 10000);
        assert_eq!(health.stale_sources, 1);
        assert_eq!(health.active_sources, 0);
    }

    #[test]
    fn test_filter_fresh_zero_staleness_window() {
        let reports = vec![make_report(1, 100, 1000)];
        // max_staleness = 0 means everything is stale if any time has passed
        let result = filter_fresh_reports(&reports, 1001, 0);
        assert!(result.is_empty());
    }

    #[test]
    fn test_agreement_with_zero_median() {
        // All prices are 0
        let reports = vec![
            make_report(1, 0, 100),
            make_report(2, 0, 100),
            make_report(3, 0, 100),
        ];
        assert_eq!(calculate_agreement(&reports), 0);
    }

    #[test]
    fn test_confidence_exactly_at_min_sources() {
        let c = calculate_confidence(3, 3, 5000, 5000);
        // source_factor = BPS, (10000+5000+5000)/3 = 6666
        assert_eq!(c, 6666);
    }

    #[test]
    fn test_iqr_three_values() {
        // sorted: [10, 20, 30]
        // lower: [10] => Q1=10, upper: [30] => Q3=30
        assert_eq!(calculate_iqr(&[10, 20, 30]), (10, 30));
    }

    #[test]
    fn test_iqr_six_values() {
        // sorted: [1, 2, 3, 4, 5, 6]
        // lower: [1,2,3] => Q1=2, upper: [4,5,6] => Q3=5
        assert_eq!(calculate_iqr(&[1, 2, 3, 4, 5, 6]), (2, 5));
    }

    #[test]
    fn test_std_dev_large_spread() {
        // [0, 1000], mean=500
        // variance = (250000+250000)/2 = 250000, sqrt=500
        assert_eq!(calculate_std_dev_approx(&[0, 1000], 500), 500);
    }

    #[test]
    fn test_sort_preserves_all_fields() {
        let r = PriceReport {
            source_id: 42,
            pair_id: 7,
            price: 999,
            timestamp: 5555,
            confidence_bps: 8888,
            round_id: 3,
        };
        let sorted = sort_reports_by_price(&[r]);
        assert_eq!(sorted[0].source_id, 42);
        assert_eq!(sorted[0].pair_id, 7);
        assert_eq!(sorted[0].confidence_bps, 8888);
        assert_eq!(sorted[0].round_id, 3);
    }

    #[test]
    fn test_register_then_deregister_round_trip() {
        let mut sources = vec![];
        register_source(&mut sources, make_source(1, 5000, 9000)).unwrap();
        register_source(&mut sources, make_source(2, 5000, 9000)).unwrap();
        assert_eq!(sources.len(), 2);
        deregister_source(&mut sources, 1).unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].id, 2);
    }

    #[test]
    fn test_deduplicate_preserves_all_fields() {
        let r = PriceReport {
            source_id: 1,
            pair_id: 42,
            price: 999,
            timestamp: 5000,
            confidence_bps: 7777,
            round_id: 10,
        };
        let deduped = deduplicate_reports(&[r]);
        assert_eq!(deduped[0].pair_id, 42);
        assert_eq!(deduped[0].confidence_bps, 7777);
    }

    #[test]
    fn test_build_aggregated_price_timestamp_is_latest() {
        let reports = vec![
            make_report(1, 1000, 9000),
            make_report(2, 1005, 9500),
            make_report(3, 1010, 9200),
        ];
        let sources: Vec<OracleSource> = (1..=3).map(|i| make_source(i, 3333, 9000)).collect();
        let config = make_config(1);
        let result = build_aggregated_price(&reports, &sources, &config, 10000).unwrap();
        assert_eq!(result.timestamp, 9500);
    }

    #[test]
    fn test_check_deviation_large_drop() {
        let alert = check_deviation(1000, 100, 500).unwrap();
        assert_eq!(alert.deviation_bps, 9000); // 90%
    }

    #[test]
    fn test_check_deviation_no_change() {
        assert!(check_deviation(100, 100, 500).is_none());
    }

    #[test]
    fn test_isqrt_large_number() {
        assert_eq!(isqrt(1_000_000_000_000u128), 1_000_000);
    }

    #[test]
    fn test_isqrt_perfect_square() {
        assert_eq!(isqrt(144), 12);
        assert_eq!(isqrt(10000), 100);
    }

    #[test]
    fn test_mean_single_large_value() {
        assert_eq!(calculate_mean(&[u64::MAX]), u64::MAX);
    }

    #[test]
    fn test_filter_outliers_iqr_preserves_inliers() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 102, 100),
            make_report(3, 104, 100),
            make_report(4, 98, 100),
            make_report(5, 101, 100),
        ];
        let result = filter_outliers_iqr(&reports, 15000);
        assert_eq!(result.len(), 5); // all within IQR
    }

    #[test]
    fn test_twap_long_window_includes_all() {
        let reports = vec![
            make_report(1, 100, 0),
            make_report(2, 200, 500),
            make_report(3, 300, 1000),
        ];
        let result = aggregate_twap(&reports, 10000).unwrap();
        // Price 100 held for 500ms, price 200 held for 500ms
        // TWAP = (100*500 + 200*500) / 1000 = 150
        assert_eq!(result, 150);
    }

    #[test]
    fn test_weighted_three_sources_varied_weights() {
        let reports = vec![
            make_report(1, 100, 100),
            make_report(2, 200, 100),
            make_report(3, 300, 100),
        ];
        let sources = vec![
            make_source(1, 5000, 9000),
            make_source(2, 3000, 9000),
            make_source(3, 2000, 9000),
        ];
        // (100*5000 + 200*3000 + 300*2000) / 10000 = (500k + 600k + 600k)/10000 = 170
        assert_eq!(aggregate_weighted(&reports, &sources).unwrap(), 170);
    }

    #[test]
    fn test_derived_price_inverse() {
        // If base=quote, result should be 1e8
        let result = compute_derived_price(5000, 5000).unwrap();
        assert_eq!(result, 100_000_000);
    }

    #[test]
    fn test_derived_price_2x_ratio() {
        let result = compute_derived_price(2000, 1000).unwrap();
        assert_eq!(result, 200_000_000); // 2.0 * 1e8
    }

    #[test]
    fn test_feed_health_confidence_degrades_with_staleness() {
        let sources = vec![
            OracleSource { id: 1, name_hash: 0, weight_bps: 5000, reliability_bps: 9000, last_report_at: 100, total_reports: 10, stale_count: 0 },
            OracleSource { id: 2, name_hash: 0, weight_bps: 5000, reliability_bps: 9000, last_report_at: 200, total_reports: 10, stale_count: 0 },
        ];
        let config = make_config(1);
        let health_recent = assess_feed_health(&sources, &config, 300);
        let health_stale = assess_feed_health(&sources, &config, 1_000_000);
        assert!(health_recent.confidence_bps >= health_stale.confidence_bps);
    }

    #[test]
    fn test_normalize_single_source() {
        let sources = vec![make_source(1, 7777, 9000)];
        let normalized = normalize_weights(&sources);
        assert_eq!(normalized[0].weight_bps, BPS);
    }
}
