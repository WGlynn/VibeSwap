// ============ Rollup Module ============
// Data Rollup & Aggregation — compressing transaction data into period summaries
// for efficient on-chain storage. On CKB's cell model, cells have limited capacity,
// so rollups aggregate many events into compact summaries.

use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

// ============ Constants ============

const HOUR_MS: u64 = 3_600_000;
const DAY_MS: u64 = 86_400_000;
const WEEK_MS: u64 = 604_800_000;
const EPOCH_MS: u64 = 14_400_000; // ~4 hours
const PRICE_SCALE: u128 = 100_000_000; // 1e8

/// Estimated bytes for a serialized PeriodSummary on CKB.
const SUMMARY_BYTES: u64 = 256;

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum RollupError {
    EmptyRecords,
    PeriodMismatch,
    TimestampOutOfRange,
    OverlapDetected,
    InvalidPeriod,
    ConfigError,
    MerkleError,
    Overflow,
    InsufficientData,
    GapDetected,
}

// ============ Data Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum RollupPeriod {
    Hourly,
    Daily,
    Weekly,
    Epoch,
    Custom(u64),
}

#[derive(Debug, Clone)]
pub struct TxRecord {
    pub tx_hash: [u8; 32],
    pub timestamp: u64,
    pub sender: [u8; 32],
    pub pool_id: [u8; 32],
    pub amount_in: u64,
    pub amount_out: u64,
    pub fee: u64,
    pub is_buy: bool,
}

#[derive(Debug, Clone)]
pub struct PeriodSummary {
    pub period_start: u64,
    pub period_end: u64,
    pub period_type: RollupPeriod,
    pub tx_count: u64,
    pub total_volume_in: u128,
    pub total_volume_out: u128,
    pub total_fees: u128,
    pub unique_traders: u64,
    pub buy_count: u64,
    pub sell_count: u64,
    pub open_price: u64,
    pub close_price: u64,
    pub high_price: u64,
    pub low_price: u64,
    pub vwap: u64,
    pub merkle_root: [u8; 32],
}

#[derive(Debug, Clone)]
pub struct PoolRollup {
    pub pool_id: [u8; 32],
    pub summaries: Vec<PeriodSummary>,
    pub total_tx_count: u64,
    pub total_volume: u128,
    pub first_timestamp: u64,
    pub last_timestamp: u64,
}

#[derive(Debug, Clone)]
pub struct RollupConfig {
    pub period: RollupPeriod,
    pub max_records_per_rollup: u64,
    pub compression_enabled: bool,
    pub retain_raw_count: u64,
    pub auto_rollup: bool,
}

#[derive(Debug, Clone)]
pub struct RollupStats {
    pub total_rollups: u64,
    pub total_records_processed: u64,
    pub avg_records_per_rollup: u64,
    pub compression_ratio_bps: u64,
    pub time_span_ms: u64,
    pub data_points: u64,
}

#[derive(Debug, Clone)]
pub struct CandlestickData {
    pub timestamp: u64,
    pub open: u64,
    pub high: u64,
    pub low: u64,
    pub close: u64,
    pub volume: u128,
}

// ============ Config ============

pub fn default_config(period: RollupPeriod) -> RollupConfig {
    RollupConfig {
        period,
        max_records_per_rollup: 1000,
        compression_enabled: true,
        retain_raw_count: 100,
        auto_rollup: true,
    }
}

pub fn period_duration_ms(period: &RollupPeriod) -> u64 {
    match period {
        RollupPeriod::Hourly => HOUR_MS,
        RollupPeriod::Daily => DAY_MS,
        RollupPeriod::Weekly => WEEK_MS,
        RollupPeriod::Epoch => EPOCH_MS,
        RollupPeriod::Custom(ms) => *ms,
    }
}

pub fn validate_config(config: &RollupConfig) -> Result<(), RollupError> {
    if let RollupPeriod::Custom(ms) = &config.period {
        if *ms == 0 {
            return Err(RollupError::InvalidPeriod);
        }
    }
    if config.max_records_per_rollup == 0 {
        return Err(RollupError::ConfigError);
    }
    Ok(())
}

// ============ Core Rollup ============

pub fn rollup_records(
    records: &[TxRecord],
    period: &RollupPeriod,
) -> Result<Vec<PeriodSummary>, RollupError> {
    if records.is_empty() {
        return Err(RollupError::EmptyRecords);
    }
    let buckets = split_by_period(records, period);
    let mut summaries = Vec::new();
    for bucket in &buckets {
        if bucket.is_empty() {
            continue;
        }
        let (start, end) = period_for_timestamp(bucket[0].timestamp, period);
        summaries.push(create_summary(bucket, start, end, period.clone())?);
    }
    Ok(summaries)
}

pub fn create_summary(
    records: &[TxRecord],
    period_start: u64,
    period_end: u64,
    period_type: RollupPeriod,
) -> Result<PeriodSummary, RollupError> {
    if records.is_empty() {
        return Err(RollupError::EmptyRecords);
    }

    let mut total_volume_in: u128 = 0;
    let mut total_volume_out: u128 = 0;
    let mut total_fees: u128 = 0;
    let mut buy_count: u64 = 0;
    let mut sell_count: u64 = 0;

    let mut traders: BTreeMap<[u8; 32], bool> = BTreeMap::new();

    // Sort by timestamp for OHLC
    let mut sorted: Vec<&TxRecord> = records.iter().collect();
    sorted.sort_by_key(|r| r.timestamp);

    for r in &sorted {
        total_volume_in = total_volume_in.checked_add(r.amount_in as u128)
            .ok_or(RollupError::Overflow)?;
        total_volume_out = total_volume_out.checked_add(r.amount_out as u128)
            .ok_or(RollupError::Overflow)?;
        total_fees = total_fees.checked_add(r.fee as u128)
            .ok_or(RollupError::Overflow)?;
        if r.is_buy {
            buy_count += 1;
        } else {
            sell_count += 1;
        }
        traders.insert(r.sender, true);
    }

    let (open, high, low, close) = compute_ohlc_from_sorted(&sorted);
    let vwap = compute_vwap_internal(&sorted);
    let merkle_root = compute_merkle_root_from_records(records);

    Ok(PeriodSummary {
        period_start,
        period_end,
        period_type,
        tx_count: records.len() as u64,
        total_volume_in,
        total_volume_out,
        total_fees,
        unique_traders: traders.len() as u64,
        buy_count,
        sell_count,
        open_price: open,
        close_price: close,
        high_price: high,
        low_price: low,
        vwap,
        merkle_root,
    })
}

pub fn merge_summaries(
    a: &PeriodSummary,
    b: &PeriodSummary,
) -> Result<PeriodSummary, RollupError> {
    // Ensure no overlap: a must end before or at b start (or vice versa)
    let (first, second) = if a.period_start <= b.period_start {
        (a, b)
    } else {
        (b, a)
    };

    if first.period_end > second.period_start {
        return Err(RollupError::OverlapDetected);
    }

    let total_volume_in = first.total_volume_in.checked_add(second.total_volume_in)
        .ok_or(RollupError::Overflow)?;
    let total_volume_out = first.total_volume_out.checked_add(second.total_volume_out)
        .ok_or(RollupError::Overflow)?;
    let total_fees = first.total_fees.checked_add(second.total_fees)
        .ok_or(RollupError::Overflow)?;

    let high = if first.high_price > second.high_price {
        first.high_price
    } else {
        second.high_price
    };
    let low = if first.low_price < second.low_price {
        first.low_price
    } else {
        second.low_price
    };

    // VWAP: weighted combination
    let total_vol = total_volume_in;
    let vwap = if total_vol > 0 {
        let w1 = (first.vwap as u128)
            .checked_mul(first.total_volume_in)
            .ok_or(RollupError::Overflow)?;
        let w2 = (second.vwap as u128)
            .checked_mul(second.total_volume_in)
            .ok_or(RollupError::Overflow)?;
        let sum = w1.checked_add(w2).ok_or(RollupError::Overflow)?;
        (sum / total_vol) as u64
    } else {
        0
    };

    // Merkle root: hash of the two roots
    let mut hasher = Sha256::new();
    hasher.update(first.merkle_root);
    hasher.update(second.merkle_root);
    let result = hasher.finalize();
    let mut merkle_root = [0u8; 32];
    merkle_root.copy_from_slice(&result);

    Ok(PeriodSummary {
        period_start: first.period_start,
        period_end: second.period_end,
        period_type: first.period_type.clone(),
        tx_count: first.tx_count + second.tx_count,
        total_volume_in,
        total_volume_out,
        total_fees,
        unique_traders: first.unique_traders + second.unique_traders, // upper bound
        buy_count: first.buy_count + second.buy_count,
        sell_count: first.sell_count + second.sell_count,
        open_price: first.open_price,
        close_price: second.close_price,
        high_price: high,
        low_price: low,
        vwap,
        merkle_root,
    })
}

pub fn split_by_period(records: &[TxRecord], period: &RollupPeriod) -> Vec<Vec<TxRecord>> {
    if records.is_empty() {
        return Vec::new();
    }

    let dur = period_duration_ms(period);
    let mut buckets: BTreeMap<u64, Vec<TxRecord>> = BTreeMap::new();

    for r in records {
        let bucket_start = (r.timestamp / dur) * dur;
        buckets.entry(bucket_start).or_default().push(r.clone());
    }

    buckets.into_values().collect()
}

pub fn period_for_timestamp(timestamp: u64, period: &RollupPeriod) -> (u64, u64) {
    let dur = period_duration_ms(period);
    let start = (timestamp / dur) * dur;
    (start, start + dur)
}

// ============ Price Computation ============

pub fn compute_vwap(records: &[TxRecord]) -> u64 {
    let mut sorted: Vec<&TxRecord> = records.iter().collect();
    sorted.sort_by_key(|r| r.timestamp);
    compute_vwap_internal(&sorted)
}

fn compute_vwap_internal(sorted: &[&TxRecord]) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let mut weighted_sum: u128 = 0;
    let mut total_in: u128 = 0;
    for r in sorted {
        if r.amount_in == 0 {
            continue;
        }
        let price = (r.amount_out as u128)
            .saturating_mul(PRICE_SCALE)
            / (r.amount_in as u128);
        weighted_sum = weighted_sum.saturating_add(price.saturating_mul(r.amount_in as u128));
        total_in = total_in.saturating_add(r.amount_in as u128);
    }
    if total_in == 0 {
        return 0;
    }
    (weighted_sum / total_in) as u64
}

pub fn compute_ohlc(records: &[TxRecord]) -> (u64, u64, u64, u64) {
    let mut sorted: Vec<&TxRecord> = records.iter().collect();
    sorted.sort_by_key(|r| r.timestamp);
    compute_ohlc_from_sorted(&sorted)
}

fn compute_ohlc_from_sorted(sorted: &[&TxRecord]) -> (u64, u64, u64, u64) {
    if sorted.is_empty() {
        return (0, 0, 0, 0);
    }

    let prices: Vec<u64> = sorted
        .iter()
        .filter(|r| r.amount_in > 0)
        .map(|r| price_from_amounts(r.amount_in, r.amount_out))
        .collect();

    if prices.is_empty() {
        return (0, 0, 0, 0);
    }

    let open = prices[0];
    let close = prices[prices.len() - 1];
    let high = prices.iter().copied().max().unwrap_or(0);
    let low = prices.iter().copied().min().unwrap_or(0);
    (open, high, low, close)
}

pub fn to_candlestick(summary: &PeriodSummary) -> CandlestickData {
    CandlestickData {
        timestamp: summary.period_start,
        open: summary.open_price,
        high: summary.high_price,
        low: summary.low_price,
        close: summary.close_price,
        volume: summary.total_volume_in,
    }
}

pub fn candlestick_series(summaries: &[PeriodSummary]) -> Vec<CandlestickData> {
    summaries.iter().map(|s| to_candlestick(s)).collect()
}

pub fn price_from_amounts(amount_in: u64, amount_out: u64) -> u64 {
    if amount_in == 0 {
        return 0;
    }
    ((amount_out as u128).saturating_mul(PRICE_SCALE) / (amount_in as u128)) as u64
}

// ============ Volume Analytics ============

pub fn total_volume(summaries: &[PeriodSummary]) -> u128 {
    summaries.iter().map(|s| s.total_volume_in).sum()
}

pub fn avg_volume_per_period(summaries: &[PeriodSummary]) -> u128 {
    if summaries.is_empty() {
        return 0;
    }
    total_volume(summaries) / summaries.len() as u128
}

pub fn volume_trend(summaries: &[PeriodSummary]) -> i64 {
    if summaries.len() < 2 {
        return 0;
    }
    let mid = summaries.len() / 2;
    let first_half: u128 = summaries[..mid].iter().map(|s| s.total_volume_in).sum();
    let second_half: u128 = summaries[mid..].iter().map(|s| s.total_volume_in).sum();

    if first_half == 0 {
        return if second_half > 0 { 10000 } else { 0 };
    }

    let change = (second_half as i128) - (first_half as i128);
    ((change * 10000) / (first_half as i128)) as i64
}

pub fn peak_volume_period(summaries: &[PeriodSummary]) -> Option<usize> {
    if summaries.is_empty() {
        return None;
    }
    summaries
        .iter()
        .enumerate()
        .max_by_key(|(_, s)| s.total_volume_in)
        .map(|(i, _)| i)
}

pub fn volume_distribution(summaries: &[PeriodSummary]) -> Vec<u64> {
    let total = total_volume(summaries);
    if total == 0 {
        return summaries.iter().map(|_| 0).collect();
    }
    summaries
        .iter()
        .map(|s| ((s.total_volume_in * 10000) / total) as u64)
        .collect()
}

// ============ Trader Analytics ============

pub fn unique_traders(records: &[TxRecord]) -> u64 {
    let mut seen: BTreeMap<[u8; 32], bool> = BTreeMap::new();
    for r in records {
        seen.insert(r.sender, true);
    }
    seen.len() as u64
}

pub fn top_traders(records: &[TxRecord], count: usize) -> Vec<([u8; 32], u128)> {
    let mut volumes: BTreeMap<[u8; 32], u128> = BTreeMap::new();
    for r in records {
        let entry = volumes.entry(r.sender).or_insert(0);
        *entry = entry.saturating_add(r.amount_in as u128);
    }
    let mut sorted: Vec<([u8; 32], u128)> = volumes.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));
    sorted.truncate(count);
    sorted
}

pub fn buy_sell_ratio(summary: &PeriodSummary) -> (u64, u64) {
    let total = summary.buy_count + summary.sell_count;
    if total == 0 {
        return (5000, 5000);
    }
    let buy_bps = (summary.buy_count as u128 * 10000 / total as u128) as u64;
    let sell_bps = 10000 - buy_bps;
    (buy_bps, sell_bps)
}

pub fn avg_trade_size(summary: &PeriodSummary) -> u64 {
    if summary.tx_count == 0 {
        return 0;
    }
    (summary.total_volume_in / summary.tx_count as u128) as u64
}

// ============ Pool Rollup ============

pub fn create_pool_rollup(pool_id: [u8; 32]) -> PoolRollup {
    PoolRollup {
        pool_id,
        summaries: Vec::new(),
        total_tx_count: 0,
        total_volume: 0,
        first_timestamp: 0,
        last_timestamp: 0,
    }
}

pub fn add_summary(
    rollup: &mut PoolRollup,
    summary: PeriodSummary,
) -> Result<(), RollupError> {
    // Check overlap with existing summaries
    for existing in &rollup.summaries {
        let no_overlap = summary.period_end <= existing.period_start
            || summary.period_start >= existing.period_end;
        if !no_overlap {
            return Err(RollupError::OverlapDetected);
        }
    }

    rollup.total_tx_count += summary.tx_count;
    rollup.total_volume = rollup.total_volume.saturating_add(summary.total_volume_in);

    if rollup.summaries.is_empty() {
        rollup.first_timestamp = summary.period_start;
        rollup.last_timestamp = summary.period_end;
    } else {
        if summary.period_start < rollup.first_timestamp {
            rollup.first_timestamp = summary.period_start;
        }
        if summary.period_end > rollup.last_timestamp {
            rollup.last_timestamp = summary.period_end;
        }
    }

    rollup.summaries.push(summary);
    rollup.summaries.sort_by_key(|s| s.period_start);
    Ok(())
}

pub fn pool_total_volume(rollup: &PoolRollup) -> u128 {
    rollup.total_volume
}

pub fn pool_total_fees(rollup: &PoolRollup) -> u128 {
    rollup.summaries.iter().map(|s| s.total_fees).sum()
}

pub fn pool_active_periods(rollup: &PoolRollup) -> usize {
    rollup.summaries.iter().filter(|s| s.tx_count > 0).count()
}

pub fn pool_time_span_ms(rollup: &PoolRollup) -> u64 {
    if rollup.summaries.is_empty() {
        return 0;
    }
    rollup.last_timestamp.saturating_sub(rollup.first_timestamp)
}

// ============ Merkle ============

pub fn compute_tx_hash(record: &TxRecord) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(record.tx_hash);
    hasher.update(record.timestamp.to_le_bytes());
    hasher.update(record.sender);
    hasher.update(record.pool_id);
    hasher.update(record.amount_in.to_le_bytes());
    hasher.update(record.amount_out.to_le_bytes());
    hasher.update(record.fee.to_le_bytes());
    hasher.update([if record.is_buy { 1u8 } else { 0u8 }]);
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

pub fn compute_merkle_root_from_records(records: &[TxRecord]) -> [u8; 32] {
    if records.is_empty() {
        return [0u8; 32];
    }
    let leaves: Vec<[u8; 32]> = records.iter().map(|r| compute_tx_hash(r)).collect();
    compute_merkle_root_internal(&leaves)
}

fn compute_merkle_root_internal(leaves: &[[u8; 32]]) -> [u8; 32] {
    if leaves.is_empty() {
        return [0u8; 32];
    }
    if leaves.len() == 1 {
        return leaves[0];
    }

    let mut current_level: Vec<[u8; 32]> = leaves.to_vec();

    while current_level.len() > 1 {
        let mut next_level = Vec::new();
        let mut i = 0;
        while i < current_level.len() {
            let left = current_level[i];
            let right = if i + 1 < current_level.len() {
                current_level[i + 1]
            } else {
                current_level[i]
            };
            let mut hasher = Sha256::new();
            hasher.update(left);
            hasher.update(right);
            let result = hasher.finalize();
            let mut hash = [0u8; 32];
            hash.copy_from_slice(&result);
            next_level.push(hash);
            i += 2;
        }
        current_level = next_level;
    }

    current_level[0]
}

pub fn verify_tx_inclusion(
    root: &[u8; 32],
    tx_hash: &[u8; 32],
    proof: &[[u8; 32]],
    path: &[bool],
) -> bool {
    if proof.len() != path.len() {
        return false;
    }

    let mut current = *tx_hash;

    for (sibling, &is_right) in proof.iter().zip(path.iter()) {
        let mut hasher = Sha256::new();
        if is_right {
            hasher.update(sibling);
            hasher.update(current);
        } else {
            hasher.update(current);
            hasher.update(sibling);
        }
        let result = hasher.finalize();
        current = [0u8; 32];
        current.copy_from_slice(&result);
    }

    current == *root
}

// ============ Compression ============

pub fn compression_ratio(raw_count: u64, summary_count: u64) -> u64 {
    if summary_count == 0 {
        return 0;
    }
    raw_count.saturating_mul(10000) / summary_count
}

pub fn estimated_cell_size(summary: &PeriodSummary) -> u64 {
    // Base fields + merkle root + period type discriminant
    let _ = summary;
    SUMMARY_BYTES
}

pub fn summaries_fit_in_cell(summaries: &[PeriodSummary], cell_capacity: u64) -> usize {
    let mut total: u64 = 0;
    for (i, s) in summaries.iter().enumerate() {
        let size = estimated_cell_size(s);
        if total.saturating_add(size) > cell_capacity {
            return i;
        }
        total += size;
    }
    summaries.len()
}

// ============ Multi-Period Aggregation ============

pub fn daily_from_hourly(
    hourly: &[PeriodSummary],
) -> Result<Vec<PeriodSummary>, RollupError> {
    if hourly.is_empty() {
        return Err(RollupError::EmptyRecords);
    }
    for s in hourly {
        if s.period_type != RollupPeriod::Hourly {
            return Err(RollupError::PeriodMismatch);
        }
    }
    aggregate_to_period(hourly, &RollupPeriod::Daily)
}

pub fn weekly_from_daily(
    daily: &[PeriodSummary],
) -> Result<Vec<PeriodSummary>, RollupError> {
    if daily.is_empty() {
        return Err(RollupError::EmptyRecords);
    }
    for s in daily {
        if s.period_type != RollupPeriod::Daily {
            return Err(RollupError::PeriodMismatch);
        }
    }
    aggregate_to_period(daily, &RollupPeriod::Weekly)
}

pub fn resample(
    summaries: &[PeriodSummary],
    new_period: &RollupPeriod,
) -> Result<Vec<PeriodSummary>, RollupError> {
    if summaries.is_empty() {
        return Err(RollupError::EmptyRecords);
    }
    aggregate_to_period(summaries, new_period)
}

fn aggregate_to_period(
    summaries: &[PeriodSummary],
    target_period: &RollupPeriod,
) -> Result<Vec<PeriodSummary>, RollupError> {
    let target_dur = period_duration_ms(target_period);

    let mut buckets: BTreeMap<u64, Vec<&PeriodSummary>> = BTreeMap::new();
    for s in summaries {
        let bucket_start = (s.period_start / target_dur) * target_dur;
        buckets.entry(bucket_start).or_default().push(s);
    }

    let mut result = Vec::new();
    for (bucket_start, group) in &buckets {
        let bucket_end = bucket_start + target_dur;

        let mut merged = PeriodSummary {
            period_start: *bucket_start,
            period_end: bucket_end,
            period_type: target_period.clone(),
            tx_count: 0,
            total_volume_in: 0,
            total_volume_out: 0,
            total_fees: 0,
            unique_traders: 0,
            buy_count: 0,
            sell_count: 0,
            open_price: 0,
            close_price: 0,
            high_price: 0,
            low_price: u64::MAX,
            vwap: 0,
            merkle_root: [0u8; 32],
        };

        // Sort group by period_start for correct OHLC
        let mut sorted_group: Vec<&&PeriodSummary> = group.iter().collect();
        sorted_group.sort_by_key(|s| s.period_start);

        let mut weighted_vwap: u128 = 0;

        for (i, s) in sorted_group.iter().enumerate() {
            merged.tx_count += s.tx_count;
            merged.total_volume_in = merged.total_volume_in.saturating_add(s.total_volume_in);
            merged.total_volume_out = merged.total_volume_out.saturating_add(s.total_volume_out);
            merged.total_fees = merged.total_fees.saturating_add(s.total_fees);
            merged.unique_traders += s.unique_traders;
            merged.buy_count += s.buy_count;
            merged.sell_count += s.sell_count;

            if i == 0 {
                merged.open_price = s.open_price;
            }
            merged.close_price = s.close_price;

            if s.high_price > merged.high_price {
                merged.high_price = s.high_price;
            }
            if s.low_price < merged.low_price {
                merged.low_price = s.low_price;
            }

            weighted_vwap = weighted_vwap
                .saturating_add((s.vwap as u128).saturating_mul(s.total_volume_in));
        }

        if merged.total_volume_in > 0 {
            merged.vwap = (weighted_vwap / merged.total_volume_in) as u64;
        }

        if merged.low_price == u64::MAX {
            merged.low_price = 0;
        }

        // Merkle root: hash all sub-roots together
        let sub_roots: Vec<[u8; 32]> = sorted_group.iter().map(|s| s.merkle_root).collect();
        merged.merkle_root = compute_merkle_root_internal(&sub_roots);

        result.push(merged);
    }

    Ok(result)
}

// ============ Validation ============

pub fn validate_summary(summary: &PeriodSummary) -> Result<(), RollupError> {
    if summary.period_end <= summary.period_start {
        return Err(RollupError::InvalidPeriod);
    }
    if summary.tx_count != summary.buy_count + summary.sell_count {
        return Err(RollupError::PeriodMismatch);
    }
    // OHLC consistency
    if summary.tx_count > 0 {
        if summary.high_price < summary.low_price {
            return Err(RollupError::PeriodMismatch);
        }
        if summary.high_price < summary.open_price || summary.high_price < summary.close_price {
            return Err(RollupError::PeriodMismatch);
        }
        if summary.low_price > summary.open_price || summary.low_price > summary.close_price {
            return Err(RollupError::PeriodMismatch);
        }
    }
    Ok(())
}

pub fn validate_sequence(summaries: &[PeriodSummary]) -> Result<(), RollupError> {
    if summaries.is_empty() {
        return Err(RollupError::EmptyRecords);
    }
    for i in 1..summaries.len() {
        if summaries[i].period_start < summaries[i - 1].period_start {
            return Err(RollupError::TimestampOutOfRange);
        }
        if summaries[i].period_start < summaries[i - 1].period_end {
            return Err(RollupError::OverlapDetected);
        }
        if summaries[i].period_start > summaries[i - 1].period_end {
            return Err(RollupError::GapDetected);
        }
    }
    Ok(())
}

pub fn detect_gaps(summaries: &[PeriodSummary]) -> Vec<(u64, u64)> {
    let mut gaps = Vec::new();
    for i in 1..summaries.len() {
        if summaries[i].period_start > summaries[i - 1].period_end {
            gaps.push((summaries[i - 1].period_end, summaries[i].period_start));
        }
    }
    gaps
}

pub fn is_contiguous(summaries: &[PeriodSummary]) -> bool {
    detect_gaps(summaries).is_empty() && summaries.len() > 0
}

// ============ Statistics ============

pub fn compute_rollup_stats(summaries: &[PeriodSummary]) -> RollupStats {
    if summaries.is_empty() {
        return RollupStats {
            total_rollups: 0,
            total_records_processed: 0,
            avg_records_per_rollup: 0,
            compression_ratio_bps: 0,
            time_span_ms: 0,
            data_points: 0,
        };
    }

    let total_rollups = summaries.len() as u64;
    let total_records: u64 = summaries.iter().map(|s| s.tx_count).sum();
    let avg = if total_rollups > 0 {
        total_records / total_rollups
    } else {
        0
    };

    let min_start = summaries.iter().map(|s| s.period_start).min().unwrap_or(0);
    let max_end = summaries.iter().map(|s| s.period_end).max().unwrap_or(0);

    let ratio = if total_rollups > 0 {
        compression_ratio(total_records, total_rollups)
    } else {
        0
    };

    RollupStats {
        total_rollups,
        total_records_processed: total_records,
        avg_records_per_rollup: avg,
        compression_ratio_bps: ratio,
        time_span_ms: max_end.saturating_sub(min_start),
        data_points: total_rollups,
    }
}

pub fn price_volatility(summaries: &[PeriodSummary]) -> u64 {
    if summaries.len() < 2 {
        return 0;
    }

    let prices: Vec<u64> = summaries.iter().map(|s| s.close_price).collect();
    let sum: u128 = prices.iter().map(|&p| p as u128).sum();
    let mean = sum / prices.len() as u128;

    if mean == 0 {
        return 0;
    }

    let variance: u128 = prices
        .iter()
        .map(|&p| {
            let diff = if (p as u128) > mean {
                (p as u128) - mean
            } else {
                mean - (p as u128)
            };
            diff * diff
        })
        .sum::<u128>()
        / prices.len() as u128;

    // Approximate sqrt via integer Newton's method
    let std_dev = isqrt(variance);

    (std_dev * 10000 / mean) as u64
}

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

pub fn fee_to_volume_ratio(summaries: &[PeriodSummary]) -> u64 {
    let total_fees: u128 = summaries.iter().map(|s| s.total_fees).sum();
    let total_vol: u128 = summaries.iter().map(|s| s.total_volume_in).sum();
    if total_vol == 0 {
        return 0;
    }
    (total_fees * 10000 / total_vol) as u64
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn make_record(timestamp: u64, amount_in: u64, amount_out: u64, is_buy: bool) -> TxRecord {
        make_record_with_sender(timestamp, amount_in, amount_out, is_buy, [1u8; 32])
    }

    fn make_record_with_sender(
        timestamp: u64,
        amount_in: u64,
        amount_out: u64,
        is_buy: bool,
        sender: [u8; 32],
    ) -> TxRecord {
        let mut tx_hash = [0u8; 32];
        tx_hash[0..8].copy_from_slice(&timestamp.to_le_bytes());
        tx_hash[8..16].copy_from_slice(&amount_in.to_le_bytes());
        TxRecord {
            tx_hash,
            timestamp,
            sender,
            pool_id: [0xAA; 32],
            amount_in,
            amount_out,
            fee: amount_in / 100, // 1% fee
            is_buy,
        }
    }

    fn make_records_in_hour(base_ts: u64, count: usize) -> Vec<TxRecord> {
        (0..count)
            .map(|i| {
                let ts = base_ts + (i as u64) * 1000; // 1s apart
                make_record(ts, 1000 + i as u64 * 10, 2000 + i as u64 * 20, i % 2 == 0)
            })
            .collect()
    }

    fn make_summary(
        period_start: u64,
        period_end: u64,
        period_type: RollupPeriod,
        tx_count: u64,
        volume_in: u128,
    ) -> PeriodSummary {
        let buy_count = tx_count / 2;
        let sell_count = tx_count - buy_count;
        PeriodSummary {
            period_start,
            period_end,
            period_type,
            tx_count,
            total_volume_in: volume_in,
            total_volume_out: volume_in * 2,
            total_fees: volume_in / 100,
            unique_traders: tx_count.min(10),
            buy_count,
            sell_count,
            open_price: 200_000_000,
            close_price: 210_000_000,
            high_price: 220_000_000,
            low_price: 190_000_000,
            vwap: 205_000_000,
            merkle_root: [0xBB; 32],
        }
    }

    fn make_hourly_summary(hour_index: u64, volume: u128) -> PeriodSummary {
        let start = hour_index * HOUR_MS;
        make_summary(start, start + HOUR_MS, RollupPeriod::Hourly, 10, volume)
    }

    fn make_daily_summary(day_index: u64, volume: u128) -> PeriodSummary {
        let start = day_index * DAY_MS;
        make_summary(start, start + DAY_MS, RollupPeriod::Daily, 100, volume)
    }

    // ============ Config Tests ============

    #[test]
    fn test_default_config_hourly() {
        let c = default_config(RollupPeriod::Hourly);
        assert_eq!(c.period, RollupPeriod::Hourly);
        assert_eq!(c.max_records_per_rollup, 1000);
        assert!(c.compression_enabled);
        assert!(c.auto_rollup);
    }

    #[test]
    fn test_default_config_daily() {
        let c = default_config(RollupPeriod::Daily);
        assert_eq!(c.period, RollupPeriod::Daily);
    }

    #[test]
    fn test_default_config_weekly() {
        let c = default_config(RollupPeriod::Weekly);
        assert_eq!(c.period, RollupPeriod::Weekly);
    }

    #[test]
    fn test_default_config_epoch() {
        let c = default_config(RollupPeriod::Epoch);
        assert_eq!(c.period, RollupPeriod::Epoch);
    }

    #[test]
    fn test_default_config_custom() {
        let c = default_config(RollupPeriod::Custom(5000));
        assert_eq!(c.period, RollupPeriod::Custom(5000));
    }

    #[test]
    fn test_period_duration_hourly() {
        assert_eq!(period_duration_ms(&RollupPeriod::Hourly), 3_600_000);
    }

    #[test]
    fn test_period_duration_daily() {
        assert_eq!(period_duration_ms(&RollupPeriod::Daily), 86_400_000);
    }

    #[test]
    fn test_period_duration_weekly() {
        assert_eq!(period_duration_ms(&RollupPeriod::Weekly), 604_800_000);
    }

    #[test]
    fn test_period_duration_epoch() {
        assert_eq!(period_duration_ms(&RollupPeriod::Epoch), 14_400_000);
    }

    #[test]
    fn test_period_duration_custom() {
        assert_eq!(period_duration_ms(&RollupPeriod::Custom(12345)), 12345);
    }

    #[test]
    fn test_validate_config_ok() {
        let c = default_config(RollupPeriod::Hourly);
        assert!(validate_config(&c).is_ok());
    }

    #[test]
    fn test_validate_config_zero_custom() {
        let c = default_config(RollupPeriod::Custom(0));
        assert_eq!(validate_config(&c), Err(RollupError::InvalidPeriod));
    }

    #[test]
    fn test_validate_config_zero_max_records() {
        let mut c = default_config(RollupPeriod::Hourly);
        c.max_records_per_rollup = 0;
        assert_eq!(validate_config(&c), Err(RollupError::ConfigError));
    }

    #[test]
    fn test_validate_config_custom_nonzero() {
        let c = default_config(RollupPeriod::Custom(1));
        assert!(validate_config(&c).is_ok());
    }

    // ============ Core Rollup Tests ============

    #[test]
    fn test_rollup_records_empty() {
        let result = rollup_records(&[], &RollupPeriod::Hourly);
        assert_eq!(result.unwrap_err(), RollupError::EmptyRecords);
    }

    #[test]
    fn test_rollup_records_single() {
        let records = vec![make_record(1000, 100, 200, true)];
        let summaries = rollup_records(&records, &RollupPeriod::Hourly).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].tx_count, 1);
    }

    #[test]
    fn test_rollup_records_same_period() {
        let records = make_records_in_hour(0, 10);
        let summaries = rollup_records(&records, &RollupPeriod::Hourly).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].tx_count, 10);
    }

    #[test]
    fn test_rollup_records_multiple_periods() {
        let mut records = make_records_in_hour(0, 5);
        records.extend(make_records_in_hour(HOUR_MS, 5));
        let summaries = rollup_records(&records, &RollupPeriod::Hourly).unwrap();
        assert_eq!(summaries.len(), 2);
    }

    #[test]
    fn test_rollup_records_three_hours() {
        let mut records = make_records_in_hour(0, 3);
        records.extend(make_records_in_hour(HOUR_MS, 4));
        records.extend(make_records_in_hour(2 * HOUR_MS, 5));
        let summaries = rollup_records(&records, &RollupPeriod::Hourly).unwrap();
        assert_eq!(summaries.len(), 3);
        assert_eq!(summaries[0].tx_count, 3);
        assert_eq!(summaries[1].tx_count, 4);
        assert_eq!(summaries[2].tx_count, 5);
    }

    #[test]
    fn test_create_summary_empty() {
        let result = create_summary(&[], 0, HOUR_MS, RollupPeriod::Hourly);
        assert_eq!(result.unwrap_err(), RollupError::EmptyRecords);
    }

    #[test]
    fn test_create_summary_single_buy() {
        let records = vec![make_record(100, 1000, 2000, true)];
        let s = create_summary(&records, 0, HOUR_MS, RollupPeriod::Hourly).unwrap();
        assert_eq!(s.tx_count, 1);
        assert_eq!(s.buy_count, 1);
        assert_eq!(s.sell_count, 0);
        assert_eq!(s.total_volume_in, 1000);
        assert_eq!(s.total_volume_out, 2000);
    }

    #[test]
    fn test_create_summary_single_sell() {
        let records = vec![make_record(100, 1000, 500, false)];
        let s = create_summary(&records, 0, HOUR_MS, RollupPeriod::Hourly).unwrap();
        assert_eq!(s.sell_count, 1);
        assert_eq!(s.buy_count, 0);
    }

    #[test]
    fn test_create_summary_volumes_accumulate() {
        let records = vec![
            make_record(100, 1000, 2000, true),
            make_record(200, 3000, 6000, false),
        ];
        let s = create_summary(&records, 0, HOUR_MS, RollupPeriod::Hourly).unwrap();
        assert_eq!(s.total_volume_in, 4000);
        assert_eq!(s.total_volume_out, 8000);
    }

    #[test]
    fn test_create_summary_fees_accumulate() {
        let records = vec![
            make_record(100, 1000, 2000, true),
            make_record(200, 2000, 4000, false),
        ];
        let s = create_summary(&records, 0, HOUR_MS, RollupPeriod::Hourly).unwrap();
        // fee = amount_in / 100
        assert_eq!(s.total_fees, 10 + 20);
    }

    #[test]
    fn test_create_summary_unique_traders() {
        let records = vec![
            make_record_with_sender(100, 1000, 2000, true, [1u8; 32]),
            make_record_with_sender(200, 1000, 2000, true, [2u8; 32]),
            make_record_with_sender(300, 1000, 2000, true, [1u8; 32]), // duplicate
        ];
        let s = create_summary(&records, 0, HOUR_MS, RollupPeriod::Hourly).unwrap();
        assert_eq!(s.unique_traders, 2);
    }

    #[test]
    fn test_create_summary_merkle_root_deterministic() {
        let records = vec![make_record(100, 1000, 2000, true)];
        let s1 = create_summary(&records, 0, HOUR_MS, RollupPeriod::Hourly).unwrap();
        let s2 = create_summary(&records, 0, HOUR_MS, RollupPeriod::Hourly).unwrap();
        assert_eq!(s1.merkle_root, s2.merkle_root);
    }

    #[test]
    fn test_merge_summaries_basic() {
        let a = make_summary(0, HOUR_MS, RollupPeriod::Hourly, 5, 1000);
        let b = make_summary(HOUR_MS, 2 * HOUR_MS, RollupPeriod::Hourly, 3, 2000);
        let merged = merge_summaries(&a, &b).unwrap();
        assert_eq!(merged.tx_count, 8);
        assert_eq!(merged.total_volume_in, 3000);
        assert_eq!(merged.period_start, 0);
        assert_eq!(merged.period_end, 2 * HOUR_MS);
    }

    #[test]
    fn test_merge_summaries_overlap() {
        let a = make_summary(0, HOUR_MS, RollupPeriod::Hourly, 5, 1000);
        let b = make_summary(HOUR_MS / 2, HOUR_MS + HOUR_MS / 2, RollupPeriod::Hourly, 3, 2000);
        assert_eq!(merge_summaries(&a, &b).unwrap_err(), RollupError::OverlapDetected);
    }

    #[test]
    fn test_merge_summaries_reversed_order() {
        let a = make_summary(HOUR_MS, 2 * HOUR_MS, RollupPeriod::Hourly, 3, 2000);
        let b = make_summary(0, HOUR_MS, RollupPeriod::Hourly, 5, 1000);
        let merged = merge_summaries(&a, &b).unwrap();
        assert_eq!(merged.period_start, 0);
        assert_eq!(merged.open_price, b.open_price);
    }

    #[test]
    fn test_merge_summaries_high_low() {
        let mut a = make_summary(0, HOUR_MS, RollupPeriod::Hourly, 5, 1000);
        let mut b = make_summary(HOUR_MS, 2 * HOUR_MS, RollupPeriod::Hourly, 5, 1000);
        a.high_price = 300_000_000;
        a.low_price = 100_000_000;
        b.high_price = 250_000_000;
        b.low_price = 150_000_000;
        let merged = merge_summaries(&a, &b).unwrap();
        assert_eq!(merged.high_price, 300_000_000);
        assert_eq!(merged.low_price, 100_000_000);
    }

    #[test]
    fn test_merge_summaries_vwap_weighted() {
        let mut a = make_summary(0, HOUR_MS, RollupPeriod::Hourly, 5, 1000);
        let mut b = make_summary(HOUR_MS, 2 * HOUR_MS, RollupPeriod::Hourly, 5, 3000);
        a.vwap = 100_000_000;
        b.vwap = 200_000_000;
        let merged = merge_summaries(&a, &b).unwrap();
        // (100M * 1000 + 200M * 3000) / 4000 = 175M
        assert_eq!(merged.vwap, 175_000_000);
    }

    #[test]
    fn test_merge_summaries_adjacent_touch() {
        let a = make_summary(0, HOUR_MS, RollupPeriod::Hourly, 5, 1000);
        let b = make_summary(HOUR_MS, 2 * HOUR_MS, RollupPeriod::Hourly, 5, 1000);
        assert!(merge_summaries(&a, &b).is_ok());
    }

    #[test]
    fn test_split_by_period_empty() {
        let result = split_by_period(&[], &RollupPeriod::Hourly);
        assert!(result.is_empty());
    }

    #[test]
    fn test_split_by_period_single_bucket() {
        let records = make_records_in_hour(0, 5);
        let buckets = split_by_period(&records, &RollupPeriod::Hourly);
        assert_eq!(buckets.len(), 1);
        assert_eq!(buckets[0].len(), 5);
    }

    #[test]
    fn test_split_by_period_two_buckets() {
        let mut records = make_records_in_hour(0, 3);
        records.extend(make_records_in_hour(HOUR_MS, 4));
        let buckets = split_by_period(&records, &RollupPeriod::Hourly);
        assert_eq!(buckets.len(), 2);
    }

    #[test]
    fn test_split_by_period_daily() {
        let mut records = make_records_in_hour(0, 3);
        records.extend(make_records_in_hour(HOUR_MS, 3));
        // All within same day
        let buckets = split_by_period(&records, &RollupPeriod::Daily);
        assert_eq!(buckets.len(), 1);
        assert_eq!(buckets[0].len(), 6);
    }

    #[test]
    fn test_period_for_timestamp_hourly() {
        let (start, end) = period_for_timestamp(500, &RollupPeriod::Hourly);
        assert_eq!(start, 0);
        assert_eq!(end, HOUR_MS);
    }

    #[test]
    fn test_period_for_timestamp_exactly_on_boundary() {
        let (start, end) = period_for_timestamp(HOUR_MS, &RollupPeriod::Hourly);
        assert_eq!(start, HOUR_MS);
        assert_eq!(end, 2 * HOUR_MS);
    }

    #[test]
    fn test_period_for_timestamp_daily() {
        let (start, end) = period_for_timestamp(DAY_MS + 1000, &RollupPeriod::Daily);
        assert_eq!(start, DAY_MS);
        assert_eq!(end, 2 * DAY_MS);
    }

    #[test]
    fn test_period_for_timestamp_custom() {
        let (start, end) = period_for_timestamp(7500, &RollupPeriod::Custom(5000));
        assert_eq!(start, 5000);
        assert_eq!(end, 10000);
    }

    // ============ Price Computation Tests ============

    #[test]
    fn test_price_from_amounts_basic() {
        // 1000 in, 2000 out => price = 2.0 * 1e8 = 200_000_000
        assert_eq!(price_from_amounts(1000, 2000), 200_000_000);
    }

    #[test]
    fn test_price_from_amounts_zero_in() {
        assert_eq!(price_from_amounts(0, 2000), 0);
    }

    #[test]
    fn test_price_from_amounts_zero_out() {
        assert_eq!(price_from_amounts(1000, 0), 0);
    }

    #[test]
    fn test_price_from_amounts_equal() {
        assert_eq!(price_from_amounts(1000, 1000), 100_000_000);
    }

    #[test]
    fn test_price_from_amounts_fractional() {
        // 3 in, 1 out => price = 0.333... * 1e8 = 33_333_333
        assert_eq!(price_from_amounts(3, 1), 33_333_333);
    }

    #[test]
    fn test_compute_vwap_empty() {
        assert_eq!(compute_vwap(&[]), 0);
    }

    #[test]
    fn test_compute_vwap_single() {
        let records = vec![make_record(100, 1000, 2000, true)];
        assert_eq!(compute_vwap(&records), 200_000_000);
    }

    #[test]
    fn test_compute_vwap_weighted() {
        let records = vec![
            make_record(100, 1000, 2000, true),  // price 2.0, weight 1000
            make_record(200, 3000, 9000, true),  // price 3.0, weight 3000
        ];
        // VWAP = (2.0*1000 + 3.0*3000) / 4000 = 11000/4000 = 2.75 => 275_000_000
        assert_eq!(compute_vwap(&records), 275_000_000);
    }

    #[test]
    fn test_compute_vwap_zero_amount_in_skipped() {
        let records = vec![
            make_record(100, 0, 2000, true),
            make_record(200, 1000, 3000, true),
        ];
        assert_eq!(compute_vwap(&records), 300_000_000);
    }

    #[test]
    fn test_compute_ohlc_empty() {
        assert_eq!(compute_ohlc(&[]), (0, 0, 0, 0));
    }

    #[test]
    fn test_compute_ohlc_single() {
        let records = vec![make_record(100, 1000, 2000, true)];
        let (o, h, l, c) = compute_ohlc(&records);
        assert_eq!(o, 200_000_000);
        assert_eq!(h, 200_000_000);
        assert_eq!(l, 200_000_000);
        assert_eq!(c, 200_000_000);
    }

    #[test]
    fn test_compute_ohlc_ascending() {
        let records = vec![
            make_record(100, 1000, 1000, true),  // price 1.0
            make_record(200, 1000, 2000, true),  // price 2.0
            make_record(300, 1000, 3000, true),  // price 3.0
        ];
        let (o, h, l, c) = compute_ohlc(&records);
        assert_eq!(o, 100_000_000);
        assert_eq!(h, 300_000_000);
        assert_eq!(l, 100_000_000);
        assert_eq!(c, 300_000_000);
    }

    #[test]
    fn test_compute_ohlc_descending() {
        let records = vec![
            make_record(100, 1000, 3000, true),
            make_record(200, 1000, 2000, true),
            make_record(300, 1000, 1000, true),
        ];
        let (o, h, l, c) = compute_ohlc(&records);
        assert_eq!(o, 300_000_000);
        assert_eq!(c, 100_000_000);
        assert_eq!(h, 300_000_000);
        assert_eq!(l, 100_000_000);
    }

    #[test]
    fn test_compute_ohlc_spike() {
        let records = vec![
            make_record(100, 1000, 1000, true),  // 1.0
            make_record(200, 1000, 5000, true),  // 5.0 (high)
            make_record(300, 1000, 2000, true),  // 2.0
        ];
        let (o, h, l, c) = compute_ohlc(&records);
        assert_eq!(o, 100_000_000);
        assert_eq!(h, 500_000_000);
        assert_eq!(l, 100_000_000);
        assert_eq!(c, 200_000_000);
    }

    #[test]
    fn test_to_candlestick() {
        let s = make_hourly_summary(0, 5000);
        let c = to_candlestick(&s);
        assert_eq!(c.timestamp, 0);
        assert_eq!(c.open, s.open_price);
        assert_eq!(c.high, s.high_price);
        assert_eq!(c.low, s.low_price);
        assert_eq!(c.close, s.close_price);
        assert_eq!(c.volume, s.total_volume_in);
    }

    #[test]
    fn test_candlestick_series_empty() {
        let result = candlestick_series(&[]);
        assert!(result.is_empty());
    }

    #[test]
    fn test_candlestick_series_multiple() {
        let summaries = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(1, 2000),
            make_hourly_summary(2, 3000),
        ];
        let candles = candlestick_series(&summaries);
        assert_eq!(candles.len(), 3);
        assert_eq!(candles[0].timestamp, 0);
        assert_eq!(candles[1].timestamp, HOUR_MS);
        assert_eq!(candles[2].timestamp, 2 * HOUR_MS);
    }

    // ============ Volume Analytics Tests ============

    #[test]
    fn test_total_volume_empty() {
        assert_eq!(total_volume(&[]), 0);
    }

    #[test]
    fn test_total_volume_single() {
        let s = vec![make_hourly_summary(0, 5000)];
        assert_eq!(total_volume(&s), 5000);
    }

    #[test]
    fn test_total_volume_multiple() {
        let s = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(1, 2000),
            make_hourly_summary(2, 3000),
        ];
        assert_eq!(total_volume(&s), 6000);
    }

    #[test]
    fn test_avg_volume_per_period_empty() {
        assert_eq!(avg_volume_per_period(&[]), 0);
    }

    #[test]
    fn test_avg_volume_per_period_single() {
        let s = vec![make_hourly_summary(0, 6000)];
        assert_eq!(avg_volume_per_period(&s), 6000);
    }

    #[test]
    fn test_avg_volume_per_period_multiple() {
        let s = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(1, 2000),
            make_hourly_summary(2, 3000),
        ];
        assert_eq!(avg_volume_per_period(&s), 2000);
    }

    #[test]
    fn test_volume_trend_empty() {
        assert_eq!(volume_trend(&[]), 0);
    }

    #[test]
    fn test_volume_trend_single() {
        let s = vec![make_hourly_summary(0, 1000)];
        assert_eq!(volume_trend(&s), 0);
    }

    #[test]
    fn test_volume_trend_increasing() {
        let s = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(1, 1000),
            make_hourly_summary(2, 2000),
            make_hourly_summary(3, 2000),
        ];
        // first_half = 2000, second_half = 4000, change = +100%
        assert_eq!(volume_trend(&s), 10000);
    }

    #[test]
    fn test_volume_trend_decreasing() {
        let s = vec![
            make_hourly_summary(0, 4000),
            make_hourly_summary(1, 4000),
            make_hourly_summary(2, 2000),
            make_hourly_summary(3, 2000),
        ];
        // first_half = 8000, second_half = 4000, change = -50%
        assert_eq!(volume_trend(&s), -5000);
    }

    #[test]
    fn test_volume_trend_flat() {
        let s = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(1, 1000),
            make_hourly_summary(2, 1000),
            make_hourly_summary(3, 1000),
        ];
        assert_eq!(volume_trend(&s), 0);
    }

    #[test]
    fn test_volume_trend_first_half_zero() {
        let s = vec![
            make_hourly_summary(0, 0),
            make_hourly_summary(1, 0),
            make_hourly_summary(2, 1000),
            make_hourly_summary(3, 1000),
        ];
        assert_eq!(volume_trend(&s), 10000);
    }

    #[test]
    fn test_peak_volume_period_empty() {
        assert_eq!(peak_volume_period(&[]), None);
    }

    #[test]
    fn test_peak_volume_period_basic() {
        let s = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(1, 5000),
            make_hourly_summary(2, 3000),
        ];
        assert_eq!(peak_volume_period(&s), Some(1));
    }

    #[test]
    fn test_peak_volume_period_first() {
        let s = vec![
            make_hourly_summary(0, 9000),
            make_hourly_summary(1, 1000),
        ];
        assert_eq!(peak_volume_period(&s), Some(0));
    }

    #[test]
    fn test_volume_distribution_empty() {
        let result = volume_distribution(&[]);
        assert!(result.is_empty());
    }

    #[test]
    fn test_volume_distribution_single() {
        let s = vec![make_hourly_summary(0, 1000)];
        let dist = volume_distribution(&s);
        assert_eq!(dist, vec![10000]);
    }

    #[test]
    fn test_volume_distribution_equal() {
        let s = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(1, 1000),
        ];
        let dist = volume_distribution(&s);
        assert_eq!(dist, vec![5000, 5000]);
    }

    #[test]
    fn test_volume_distribution_unequal() {
        let s = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(1, 3000),
        ];
        let dist = volume_distribution(&s);
        assert_eq!(dist, vec![2500, 7500]);
    }

    #[test]
    fn test_volume_distribution_all_zero() {
        let s = vec![
            make_hourly_summary(0, 0),
            make_hourly_summary(1, 0),
        ];
        let dist = volume_distribution(&s);
        assert_eq!(dist, vec![0, 0]);
    }

    // ============ Trader Analytics Tests ============

    #[test]
    fn test_unique_traders_empty() {
        assert_eq!(unique_traders(&[]), 0);
    }

    #[test]
    fn test_unique_traders_one() {
        let records = vec![make_record(100, 1000, 2000, true)];
        assert_eq!(unique_traders(&records), 1);
    }

    #[test]
    fn test_unique_traders_duplicates() {
        let records = vec![
            make_record_with_sender(100, 1000, 2000, true, [1u8; 32]),
            make_record_with_sender(200, 1000, 2000, true, [1u8; 32]),
            make_record_with_sender(300, 1000, 2000, true, [2u8; 32]),
        ];
        assert_eq!(unique_traders(&records), 2);
    }

    #[test]
    fn test_unique_traders_all_different() {
        let records = vec![
            make_record_with_sender(100, 1000, 2000, true, [1u8; 32]),
            make_record_with_sender(200, 1000, 2000, true, [2u8; 32]),
            make_record_with_sender(300, 1000, 2000, true, [3u8; 32]),
        ];
        assert_eq!(unique_traders(&records), 3);
    }

    #[test]
    fn test_top_traders_empty() {
        assert!(top_traders(&[], 5).is_empty());
    }

    #[test]
    fn test_top_traders_basic() {
        let records = vec![
            make_record_with_sender(100, 1000, 2000, true, [1u8; 32]),
            make_record_with_sender(200, 5000, 10000, true, [2u8; 32]),
            make_record_with_sender(300, 3000, 6000, true, [3u8; 32]),
        ];
        let top = top_traders(&records, 2);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0].0, [2u8; 32]); // highest volume
        assert_eq!(top[0].1, 5000);
        assert_eq!(top[1].0, [3u8; 32]);
    }

    #[test]
    fn test_top_traders_aggregates_same_sender() {
        let records = vec![
            make_record_with_sender(100, 1000, 2000, true, [1u8; 32]),
            make_record_with_sender(200, 2000, 4000, true, [1u8; 32]),
            make_record_with_sender(300, 500, 1000, true, [2u8; 32]),
        ];
        let top = top_traders(&records, 10);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0].0, [1u8; 32]);
        assert_eq!(top[0].1, 3000);
    }

    #[test]
    fn test_top_traders_truncate() {
        let records = vec![
            make_record_with_sender(100, 1000, 2000, true, [1u8; 32]),
            make_record_with_sender(200, 2000, 4000, true, [2u8; 32]),
            make_record_with_sender(300, 3000, 6000, true, [3u8; 32]),
        ];
        let top = top_traders(&records, 1);
        assert_eq!(top.len(), 1);
    }

    #[test]
    fn test_buy_sell_ratio_all_buys() {
        let mut s = make_hourly_summary(0, 1000);
        s.buy_count = 10;
        s.sell_count = 0;
        s.tx_count = 10;
        let (buy, sell) = buy_sell_ratio(&s);
        assert_eq!(buy, 10000);
        assert_eq!(sell, 0);
    }

    #[test]
    fn test_buy_sell_ratio_all_sells() {
        let mut s = make_hourly_summary(0, 1000);
        s.buy_count = 0;
        s.sell_count = 10;
        s.tx_count = 10;
        let (buy, sell) = buy_sell_ratio(&s);
        assert_eq!(buy, 0);
        assert_eq!(sell, 10000);
    }

    #[test]
    fn test_buy_sell_ratio_equal() {
        let mut s = make_hourly_summary(0, 1000);
        s.buy_count = 5;
        s.sell_count = 5;
        s.tx_count = 10;
        let (buy, sell) = buy_sell_ratio(&s);
        assert_eq!(buy, 5000);
        assert_eq!(sell, 5000);
    }

    #[test]
    fn test_buy_sell_ratio_zero_tx() {
        let mut s = make_hourly_summary(0, 0);
        s.buy_count = 0;
        s.sell_count = 0;
        s.tx_count = 0;
        let (buy, sell) = buy_sell_ratio(&s);
        assert_eq!(buy, 5000);
        assert_eq!(sell, 5000);
    }

    #[test]
    fn test_avg_trade_size_basic() {
        let mut s = make_hourly_summary(0, 10000);
        s.tx_count = 5;
        s.total_volume_in = 10000;
        assert_eq!(avg_trade_size(&s), 2000);
    }

    #[test]
    fn test_avg_trade_size_zero_tx() {
        let mut s = make_hourly_summary(0, 0);
        s.tx_count = 0;
        assert_eq!(avg_trade_size(&s), 0);
    }

    // ============ Pool Rollup Tests ============

    #[test]
    fn test_create_pool_rollup() {
        let pool_id = [0xAA; 32];
        let r = create_pool_rollup(pool_id);
        assert_eq!(r.pool_id, pool_id);
        assert!(r.summaries.is_empty());
        assert_eq!(r.total_tx_count, 0);
        assert_eq!(r.total_volume, 0);
    }

    #[test]
    fn test_add_summary_to_pool() {
        let mut r = create_pool_rollup([0xAA; 32]);
        let s = make_hourly_summary(0, 1000);
        assert!(add_summary(&mut r, s).is_ok());
        assert_eq!(r.summaries.len(), 1);
        assert_eq!(r.total_tx_count, 10);
        assert_eq!(r.total_volume, 1000);
    }

    #[test]
    fn test_add_summary_updates_timestamps() {
        let mut r = create_pool_rollup([0xAA; 32]);
        add_summary(&mut r, make_hourly_summary(1, 1000)).unwrap();
        assert_eq!(r.first_timestamp, HOUR_MS);
        assert_eq!(r.last_timestamp, 2 * HOUR_MS);
        add_summary(&mut r, make_hourly_summary(0, 500)).unwrap();
        assert_eq!(r.first_timestamp, 0);
        assert_eq!(r.last_timestamp, 2 * HOUR_MS);
    }

    #[test]
    fn test_add_summary_overlap_rejected() {
        let mut r = create_pool_rollup([0xAA; 32]);
        add_summary(&mut r, make_hourly_summary(0, 1000)).unwrap();
        // Same period => overlap
        let result = add_summary(&mut r, make_hourly_summary(0, 500));
        assert_eq!(result, Err(RollupError::OverlapDetected));
    }

    #[test]
    fn test_add_summary_sorted() {
        let mut r = create_pool_rollup([0xAA; 32]);
        add_summary(&mut r, make_hourly_summary(2, 3000)).unwrap();
        add_summary(&mut r, make_hourly_summary(0, 1000)).unwrap();
        add_summary(&mut r, make_hourly_summary(1, 2000)).unwrap();
        assert_eq!(r.summaries[0].period_start, 0);
        assert_eq!(r.summaries[1].period_start, HOUR_MS);
        assert_eq!(r.summaries[2].period_start, 2 * HOUR_MS);
    }

    #[test]
    fn test_pool_total_volume() {
        let mut r = create_pool_rollup([0xAA; 32]);
        add_summary(&mut r, make_hourly_summary(0, 1000)).unwrap();
        add_summary(&mut r, make_hourly_summary(1, 2000)).unwrap();
        assert_eq!(pool_total_volume(&r), 3000);
    }

    #[test]
    fn test_pool_total_fees() {
        let mut r = create_pool_rollup([0xAA; 32]);
        add_summary(&mut r, make_hourly_summary(0, 1000)).unwrap();
        add_summary(&mut r, make_hourly_summary(1, 2000)).unwrap();
        // fees = volume / 100
        assert_eq!(pool_total_fees(&r), 10 + 20);
    }

    #[test]
    fn test_pool_active_periods() {
        let mut r = create_pool_rollup([0xAA; 32]);
        add_summary(&mut r, make_hourly_summary(0, 1000)).unwrap();
        let mut empty = make_hourly_summary(1, 0);
        empty.tx_count = 0;
        add_summary(&mut r, empty).unwrap();
        assert_eq!(pool_active_periods(&r), 1);
    }

    #[test]
    fn test_pool_time_span_ms() {
        let mut r = create_pool_rollup([0xAA; 32]);
        add_summary(&mut r, make_hourly_summary(0, 1000)).unwrap();
        add_summary(&mut r, make_hourly_summary(5, 1000)).unwrap();
        assert_eq!(pool_time_span_ms(&r), 6 * HOUR_MS);
    }

    #[test]
    fn test_pool_time_span_empty() {
        let r = create_pool_rollup([0xAA; 32]);
        assert_eq!(pool_time_span_ms(&r), 0);
    }

    // ============ Merkle Tests ============

    #[test]
    fn test_compute_tx_hash_deterministic() {
        let r = make_record(100, 1000, 2000, true);
        let h1 = compute_tx_hash(&r);
        let h2 = compute_tx_hash(&r);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_compute_tx_hash_different_records() {
        let r1 = make_record(100, 1000, 2000, true);
        let r2 = make_record(200, 1000, 2000, true);
        assert_ne!(compute_tx_hash(&r1), compute_tx_hash(&r2));
    }

    #[test]
    fn test_compute_tx_hash_buy_vs_sell() {
        let r1 = make_record(100, 1000, 2000, true);
        let r2 = make_record(100, 1000, 2000, false);
        // tx_hash differs because the helper encodes timestamp into it
        // but the buy flag also changes compute_tx_hash
        assert_ne!(compute_tx_hash(&r1), compute_tx_hash(&r2));
    }

    #[test]
    fn test_merkle_root_empty() {
        assert_eq!(compute_merkle_root_from_records(&[]), [0u8; 32]);
    }

    #[test]
    fn test_merkle_root_single() {
        let r = make_record(100, 1000, 2000, true);
        let root = compute_merkle_root_from_records(&[r.clone()]);
        assert_eq!(root, compute_tx_hash(&r));
    }

    #[test]
    fn test_merkle_root_two_records() {
        let r1 = make_record(100, 1000, 2000, true);
        let r2 = make_record(200, 3000, 6000, false);
        let root = compute_merkle_root_from_records(&[r1.clone(), r2.clone()]);
        // Should be hash(hash(r1) || hash(r2))
        let h1 = compute_tx_hash(&r1);
        let h2 = compute_tx_hash(&r2);
        let mut hasher = Sha256::new();
        hasher.update(h1);
        hasher.update(h2);
        let result = hasher.finalize();
        let mut expected = [0u8; 32];
        expected.copy_from_slice(&result);
        assert_eq!(root, expected);
    }

    #[test]
    fn test_merkle_root_three_records() {
        let records = vec![
            make_record(100, 1000, 2000, true),
            make_record(200, 2000, 4000, false),
            make_record(300, 3000, 6000, true),
        ];
        let root = compute_merkle_root_from_records(&records);
        assert_ne!(root, [0u8; 32]);
    }

    #[test]
    fn test_merkle_root_deterministic() {
        let records = make_records_in_hour(0, 10);
        let r1 = compute_merkle_root_from_records(&records);
        let r2 = compute_merkle_root_from_records(&records);
        assert_eq!(r1, r2);
    }

    #[test]
    fn test_verify_tx_inclusion_single_leaf() {
        let r = make_record(100, 1000, 2000, true);
        let hash = compute_tx_hash(&r);
        let root = compute_merkle_root_from_records(&[r]);
        // Single leaf: no proof needed
        assert!(verify_tx_inclusion(&root, &hash, &[], &[]));
    }

    #[test]
    fn test_verify_tx_inclusion_two_leaves() {
        let r1 = make_record(100, 1000, 2000, true);
        let r2 = make_record(200, 3000, 6000, false);
        let root = compute_merkle_root_from_records(&[r1.clone(), r2.clone()]);
        let h1 = compute_tx_hash(&r1);
        let h2 = compute_tx_hash(&r2);
        // Prove r1: sibling is h2, path is [false] (r1 is left)
        assert!(verify_tx_inclusion(&root, &h1, &[h2], &[false]));
        // Prove r2: sibling is h1, path is [true] (r2 is right)
        assert!(verify_tx_inclusion(&root, &h2, &[h1], &[true]));
    }

    #[test]
    fn test_verify_tx_inclusion_wrong_root() {
        let r1 = make_record(100, 1000, 2000, true);
        let r2 = make_record(200, 3000, 6000, false);
        let root = compute_merkle_root_from_records(&[r1.clone(), r2.clone()]);
        let h1 = compute_tx_hash(&r1);
        let h2 = compute_tx_hash(&r2);
        let fake_root = [0xFF; 32];
        assert!(!verify_tx_inclusion(&fake_root, &h1, &[h2], &[false]));
        let _ = root; // suppress unused warning
    }

    #[test]
    fn test_verify_tx_inclusion_mismatched_lengths() {
        let root = [0xAA; 32];
        let hash = [0xBB; 32];
        assert!(!verify_tx_inclusion(&root, &hash, &[[0xCC; 32]], &[]));
    }

    // ============ Compression Tests ============

    #[test]
    fn test_compression_ratio_basic() {
        assert_eq!(compression_ratio(100, 1), 1_000_000);
    }

    #[test]
    fn test_compression_ratio_ten_to_one() {
        assert_eq!(compression_ratio(10, 1), 100_000);
    }

    #[test]
    fn test_compression_ratio_one_to_one() {
        assert_eq!(compression_ratio(1, 1), 10_000);
    }

    #[test]
    fn test_compression_ratio_zero_summaries() {
        assert_eq!(compression_ratio(100, 0), 0);
    }

    #[test]
    fn test_estimated_cell_size() {
        let s = make_hourly_summary(0, 1000);
        assert_eq!(estimated_cell_size(&s), SUMMARY_BYTES);
    }

    #[test]
    fn test_summaries_fit_in_cell_all_fit() {
        let summaries = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(1, 2000),
        ];
        let fits = summaries_fit_in_cell(&summaries, 1000);
        assert_eq!(fits, 2); // 256 * 2 = 512 < 1000
    }

    #[test]
    fn test_summaries_fit_in_cell_partial() {
        let summaries = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(1, 2000),
            make_hourly_summary(2, 3000),
        ];
        // 256 * 3 = 768, capacity 500 => only 1 fits (256 <= 500, 512 > 500)
        let fits = summaries_fit_in_cell(&summaries, 500);
        assert_eq!(fits, 1);
    }

    #[test]
    fn test_summaries_fit_in_cell_none() {
        let summaries = vec![make_hourly_summary(0, 1000)];
        let fits = summaries_fit_in_cell(&summaries, 100);
        assert_eq!(fits, 0);
    }

    #[test]
    fn test_summaries_fit_in_cell_empty() {
        let fits = summaries_fit_in_cell(&[], 1000);
        assert_eq!(fits, 0);
    }

    #[test]
    fn test_summaries_fit_exact_capacity() {
        let summaries = vec![make_hourly_summary(0, 1000)];
        let fits = summaries_fit_in_cell(&summaries, SUMMARY_BYTES);
        assert_eq!(fits, 1);
    }

    // ============ Multi-Period Aggregation Tests ============

    #[test]
    fn test_daily_from_hourly_empty() {
        assert_eq!(daily_from_hourly(&[]).unwrap_err(), RollupError::EmptyRecords);
    }

    #[test]
    fn test_daily_from_hourly_wrong_period() {
        let s = vec![make_daily_summary(0, 1000)];
        assert_eq!(daily_from_hourly(&s).unwrap_err(), RollupError::PeriodMismatch);
    }

    #[test]
    fn test_daily_from_hourly_single_day() {
        let hourly: Vec<PeriodSummary> = (0..24)
            .map(|h| make_hourly_summary(h, 1000))
            .collect();
        let daily = daily_from_hourly(&hourly).unwrap();
        assert_eq!(daily.len(), 1);
        assert_eq!(daily[0].tx_count, 240); // 24 * 10
        assert_eq!(daily[0].total_volume_in, 24000);
        assert_eq!(daily[0].period_type, RollupPeriod::Daily);
    }

    #[test]
    fn test_daily_from_hourly_two_days() {
        let hourly: Vec<PeriodSummary> = (0..48)
            .map(|h| make_hourly_summary(h, 1000))
            .collect();
        let daily = daily_from_hourly(&hourly).unwrap();
        assert_eq!(daily.len(), 2);
    }

    #[test]
    fn test_weekly_from_daily_empty() {
        assert_eq!(weekly_from_daily(&[]).unwrap_err(), RollupError::EmptyRecords);
    }

    #[test]
    fn test_weekly_from_daily_wrong_period() {
        let s = vec![make_hourly_summary(0, 1000)];
        assert_eq!(weekly_from_daily(&s).unwrap_err(), RollupError::PeriodMismatch);
    }

    #[test]
    fn test_weekly_from_daily_one_week() {
        let daily: Vec<PeriodSummary> = (0..7)
            .map(|d| make_daily_summary(d, 5000))
            .collect();
        let weekly = weekly_from_daily(&daily).unwrap();
        assert_eq!(weekly.len(), 1);
        assert_eq!(weekly[0].total_volume_in, 35000);
        assert_eq!(weekly[0].period_type, RollupPeriod::Weekly);
    }

    #[test]
    fn test_resample_empty() {
        assert_eq!(resample(&[], &RollupPeriod::Daily).unwrap_err(), RollupError::EmptyRecords);
    }

    #[test]
    fn test_resample_hourly_to_epoch() {
        // 4 hours = 1 epoch, EPOCH_MS = 14_400_000, HOUR_MS = 3_600_000
        let hourly: Vec<PeriodSummary> = (0..4)
            .map(|h| make_hourly_summary(h, 1000))
            .collect();
        let epochs = resample(&hourly, &RollupPeriod::Epoch).unwrap();
        assert_eq!(epochs.len(), 1);
        assert_eq!(epochs[0].total_volume_in, 4000);
    }

    #[test]
    fn test_resample_preserves_ohlc() {
        let mut h0 = make_hourly_summary(0, 1000);
        h0.open_price = 100_000_000;
        h0.high_price = 150_000_000;
        h0.low_price = 90_000_000;
        h0.close_price = 120_000_000;

        let mut h1 = make_hourly_summary(1, 2000);
        h1.open_price = 120_000_000;
        h1.high_price = 200_000_000;
        h1.low_price = 110_000_000;
        h1.close_price = 180_000_000;

        let daily = resample(&[h0, h1], &RollupPeriod::Daily).unwrap();
        assert_eq!(daily[0].open_price, 100_000_000);
        assert_eq!(daily[0].close_price, 180_000_000);
        assert_eq!(daily[0].high_price, 200_000_000);
        assert_eq!(daily[0].low_price, 90_000_000);
    }

    // ============ Validation Tests ============

    #[test]
    fn test_validate_summary_ok() {
        let s = make_hourly_summary(0, 1000);
        assert!(validate_summary(&s).is_ok());
    }

    #[test]
    fn test_validate_summary_end_before_start() {
        let mut s = make_hourly_summary(0, 1000);
        s.period_end = 0;
        s.period_start = HOUR_MS;
        assert_eq!(validate_summary(&s).unwrap_err(), RollupError::InvalidPeriod);
    }

    #[test]
    fn test_validate_summary_equal_start_end() {
        let mut s = make_hourly_summary(0, 1000);
        s.period_end = s.period_start;
        assert_eq!(validate_summary(&s).unwrap_err(), RollupError::InvalidPeriod);
    }

    #[test]
    fn test_validate_summary_count_mismatch() {
        let mut s = make_hourly_summary(0, 1000);
        s.tx_count = 20;
        s.buy_count = 5;
        s.sell_count = 3; // 5+3 != 20
        assert_eq!(validate_summary(&s).unwrap_err(), RollupError::PeriodMismatch);
    }

    #[test]
    fn test_validate_summary_high_less_than_low() {
        let mut s = make_hourly_summary(0, 1000);
        s.high_price = 100;
        s.low_price = 200;
        s.open_price = 100;
        s.close_price = 100;
        assert_eq!(validate_summary(&s).unwrap_err(), RollupError::PeriodMismatch);
    }

    #[test]
    fn test_validate_summary_high_less_than_open() {
        let mut s = make_hourly_summary(0, 1000);
        s.open_price = 300_000_000;
        s.high_price = 200_000_000;
        s.low_price = 100_000_000;
        s.close_price = 150_000_000;
        assert_eq!(validate_summary(&s).unwrap_err(), RollupError::PeriodMismatch);
    }

    #[test]
    fn test_validate_summary_low_greater_than_close() {
        let mut s = make_hourly_summary(0, 1000);
        s.open_price = 200_000_000;
        s.high_price = 300_000_000;
        s.low_price = 250_000_000; // > open
        s.close_price = 200_000_000;
        assert_eq!(validate_summary(&s).unwrap_err(), RollupError::PeriodMismatch);
    }

    #[test]
    fn test_validate_summary_zero_tx_any_prices_ok() {
        let mut s = make_hourly_summary(0, 0);
        s.tx_count = 0;
        s.buy_count = 0;
        s.sell_count = 0;
        s.high_price = 0;
        s.low_price = 999;
        // When tx_count == 0, OHLC not checked
        assert!(validate_summary(&s).is_ok());
    }

    #[test]
    fn test_validate_sequence_empty() {
        assert_eq!(validate_sequence(&[]).unwrap_err(), RollupError::EmptyRecords);
    }

    #[test]
    fn test_validate_sequence_single() {
        let s = vec![make_hourly_summary(0, 1000)];
        assert!(validate_sequence(&s).is_ok());
    }

    #[test]
    fn test_validate_sequence_contiguous() {
        let s = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(1, 2000),
            make_hourly_summary(2, 3000),
        ];
        assert!(validate_sequence(&s).is_ok());
    }

    #[test]
    fn test_validate_sequence_gap() {
        let s = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(3, 2000), // gap at hours 1-2
        ];
        assert_eq!(validate_sequence(&s).unwrap_err(), RollupError::GapDetected);
    }

    #[test]
    fn test_validate_sequence_overlap() {
        let s1 = make_hourly_summary(0, 1000);
        let mut s2 = make_hourly_summary(0, 2000);
        s2.period_start = HOUR_MS / 2;
        s2.period_end = HOUR_MS + HOUR_MS / 2;
        assert_eq!(validate_sequence(&[s1, s2]).unwrap_err(), RollupError::OverlapDetected);
    }

    #[test]
    fn test_validate_sequence_not_ascending() {
        let s = vec![
            make_hourly_summary(2, 1000),
            make_hourly_summary(0, 2000),
        ];
        assert_eq!(validate_sequence(&s).unwrap_err(), RollupError::TimestampOutOfRange);
    }

    #[test]
    fn test_detect_gaps_none() {
        let s = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(1, 2000),
        ];
        assert!(detect_gaps(&s).is_empty());
    }

    #[test]
    fn test_detect_gaps_one() {
        let s = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(3, 2000),
        ];
        let gaps = detect_gaps(&s);
        assert_eq!(gaps.len(), 1);
        assert_eq!(gaps[0], (HOUR_MS, 3 * HOUR_MS));
    }

    #[test]
    fn test_detect_gaps_multiple() {
        let s = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(2, 2000),
            make_hourly_summary(5, 3000),
        ];
        let gaps = detect_gaps(&s);
        assert_eq!(gaps.len(), 2);
    }

    #[test]
    fn test_detect_gaps_empty() {
        assert!(detect_gaps(&[]).is_empty());
    }

    #[test]
    fn test_is_contiguous_true() {
        let s = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(1, 2000),
            make_hourly_summary(2, 3000),
        ];
        assert!(is_contiguous(&s));
    }

    #[test]
    fn test_is_contiguous_false() {
        let s = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(5, 2000),
        ];
        assert!(!is_contiguous(&s));
    }

    #[test]
    fn test_is_contiguous_single() {
        let s = vec![make_hourly_summary(0, 1000)];
        assert!(is_contiguous(&s));
    }

    #[test]
    fn test_is_contiguous_empty() {
        assert!(!is_contiguous(&[]));
    }

    // ============ Statistics Tests ============

    #[test]
    fn test_compute_rollup_stats_empty() {
        let stats = compute_rollup_stats(&[]);
        assert_eq!(stats.total_rollups, 0);
        assert_eq!(stats.total_records_processed, 0);
    }

    #[test]
    fn test_compute_rollup_stats_basic() {
        let s = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(1, 2000),
        ];
        let stats = compute_rollup_stats(&s);
        assert_eq!(stats.total_rollups, 2);
        assert_eq!(stats.total_records_processed, 20); // 10 per summary
        assert_eq!(stats.avg_records_per_rollup, 10);
        assert_eq!(stats.time_span_ms, 2 * HOUR_MS);
        assert_eq!(stats.data_points, 2);
    }

    #[test]
    fn test_compute_rollup_stats_compression() {
        let s = vec![make_hourly_summary(0, 1000)];
        let stats = compute_rollup_stats(&s);
        // 10 records / 1 summary * 10000 = 100000
        assert_eq!(stats.compression_ratio_bps, 100000);
    }

    #[test]
    fn test_price_volatility_empty() {
        assert_eq!(price_volatility(&[]), 0);
    }

    #[test]
    fn test_price_volatility_single() {
        let s = vec![make_hourly_summary(0, 1000)];
        assert_eq!(price_volatility(&s), 0);
    }

    #[test]
    fn test_price_volatility_constant() {
        let mut s1 = make_hourly_summary(0, 1000);
        let mut s2 = make_hourly_summary(1, 1000);
        s1.close_price = 200_000_000;
        s2.close_price = 200_000_000;
        assert_eq!(price_volatility(&[s1, s2]), 0);
    }

    #[test]
    fn test_price_volatility_nonzero() {
        let mut s1 = make_hourly_summary(0, 1000);
        let mut s2 = make_hourly_summary(1, 1000);
        s1.close_price = 100_000_000;
        s2.close_price = 200_000_000;
        let vol = price_volatility(&[s1, s2]);
        assert!(vol > 0);
    }

    #[test]
    fn test_price_volatility_high_spread() {
        let mut s1 = make_hourly_summary(0, 1000);
        let mut s2 = make_hourly_summary(1, 1000);
        let mut s3 = make_hourly_summary(2, 1000);
        s1.close_price = 100_000_000;
        s2.close_price = 500_000_000;
        s3.close_price = 100_000_000;
        let vol = price_volatility(&[s1, s2, s3]);
        assert!(vol > 5000); // High volatility
    }

    #[test]
    fn test_price_volatility_zero_prices() {
        let mut s1 = make_hourly_summary(0, 1000);
        let mut s2 = make_hourly_summary(1, 1000);
        s1.close_price = 0;
        s2.close_price = 0;
        assert_eq!(price_volatility(&[s1, s2]), 0);
    }

    #[test]
    fn test_fee_to_volume_ratio_empty() {
        assert_eq!(fee_to_volume_ratio(&[]), 0);
    }

    #[test]
    fn test_fee_to_volume_ratio_basic() {
        let s = vec![make_hourly_summary(0, 10000)];
        // fees = 10000 / 100 = 100, volume = 10000
        // ratio = 100 * 10000 / 10000 = 100 bps = 1%
        assert_eq!(fee_to_volume_ratio(&s), 100);
    }

    #[test]
    fn test_fee_to_volume_ratio_zero_volume() {
        let s = vec![make_hourly_summary(0, 0)];
        assert_eq!(fee_to_volume_ratio(&s), 0);
    }

    #[test]
    fn test_fee_to_volume_ratio_multiple() {
        let s = vec![
            make_hourly_summary(0, 10000),
            make_hourly_summary(1, 20000),
        ];
        // total_fees = 100 + 200 = 300, total_vol = 30000
        // ratio = 300 * 10000 / 30000 = 100
        assert_eq!(fee_to_volume_ratio(&s), 100);
    }

    // ============ Integration Tests ============

    #[test]
    fn test_end_to_end_rollup_and_validate() {
        let records = make_records_in_hour(0, 20);
        let summaries = rollup_records(&records, &RollupPeriod::Hourly).unwrap();
        assert_eq!(summaries.len(), 1);
        assert!(validate_summary(&summaries[0]).is_ok());
    }

    #[test]
    fn test_end_to_end_multi_hour_validate_sequence() {
        let mut records = make_records_in_hour(0, 10);
        records.extend(make_records_in_hour(HOUR_MS, 10));
        records.extend(make_records_in_hour(2 * HOUR_MS, 10));
        let summaries = rollup_records(&records, &RollupPeriod::Hourly).unwrap();
        assert!(validate_sequence(&summaries).is_ok());
        assert!(is_contiguous(&summaries));
    }

    #[test]
    fn test_end_to_end_pool_rollup() {
        let mut pool = create_pool_rollup([0xAA; 32]);
        for i in 0..5 {
            let records = make_records_in_hour(i * HOUR_MS, 10);
            let summaries = rollup_records(&records, &RollupPeriod::Hourly).unwrap();
            add_summary(&mut pool, summaries.into_iter().next().unwrap()).unwrap();
        }
        assert_eq!(pool.summaries.len(), 5);
        assert_eq!(pool_active_periods(&pool), 5);
        assert!(pool_total_volume(&pool) > 0);
    }

    #[test]
    fn test_end_to_end_hourly_to_daily() {
        let mut all_records = Vec::new();
        for h in 0..24 {
            all_records.extend(make_records_in_hour(h * HOUR_MS, 5));
        }
        let hourly = rollup_records(&all_records, &RollupPeriod::Hourly).unwrap();
        assert_eq!(hourly.len(), 24);
        let daily = daily_from_hourly(&hourly).unwrap();
        assert_eq!(daily.len(), 1);
        assert_eq!(daily[0].tx_count, 120);
    }

    #[test]
    fn test_end_to_end_candlestick_from_rollup() {
        let mut all_records = Vec::new();
        for h in 0..3 {
            all_records.extend(make_records_in_hour(h * HOUR_MS, 5));
        }
        let summaries = rollup_records(&all_records, &RollupPeriod::Hourly).unwrap();
        let candles = candlestick_series(&summaries);
        assert_eq!(candles.len(), 3);
        for c in &candles {
            assert!(c.high >= c.low);
            assert!(c.volume > 0);
        }
    }

    #[test]
    fn test_end_to_end_compression_stats() {
        let records = make_records_in_hour(0, 50);
        let summaries = rollup_records(&records, &RollupPeriod::Hourly).unwrap();
        let stats = compute_rollup_stats(&summaries);
        assert_eq!(stats.total_records_processed, 50);
        assert_eq!(stats.total_rollups, 1);
        assert!(stats.compression_ratio_bps > 10000);
    }

    #[test]
    fn test_end_to_end_merkle_proof_via_summary() {
        let r1 = make_record(100, 1000, 2000, true);
        let r2 = make_record(200, 3000, 6000, false);
        let records = vec![r1.clone(), r2.clone()];
        let summary = create_summary(&records, 0, HOUR_MS, RollupPeriod::Hourly).unwrap();

        let h1 = compute_tx_hash(&r1);
        let h2 = compute_tx_hash(&r2);
        // Verify first tx is included
        assert!(verify_tx_inclusion(&summary.merkle_root, &h1, &[h2], &[false]));
    }

    #[test]
    fn test_split_records_preserves_all() {
        let mut records = make_records_in_hour(0, 5);
        records.extend(make_records_in_hour(HOUR_MS, 7));
        let buckets = split_by_period(&records, &RollupPeriod::Hourly);
        let total: usize = buckets.iter().map(|b| b.len()).sum();
        assert_eq!(total, 12);
    }

    #[test]
    fn test_resample_custom_period() {
        // Two hourly summaries resampled to 2-hour custom
        let summaries = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(1, 2000),
        ];
        let resampled = resample(&summaries, &RollupPeriod::Custom(2 * HOUR_MS)).unwrap();
        assert_eq!(resampled.len(), 1);
        assert_eq!(resampled[0].total_volume_in, 3000);
    }

    #[test]
    fn test_volume_trend_three_periods() {
        let s = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(1, 2000),
            make_hourly_summary(2, 3000),
        ];
        // first_half = [0] = 1000, second_half = [1,2] = 5000
        let trend = volume_trend(&s);
        assert!(trend > 0);
    }

    #[test]
    fn test_rollup_daily_period() {
        let records = make_records_in_hour(0, 10);
        let summaries = rollup_records(&records, &RollupPeriod::Daily).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].period_type, RollupPeriod::Daily);
    }

    #[test]
    fn test_rollup_epoch_period() {
        let records = make_records_in_hour(0, 10);
        let summaries = rollup_records(&records, &RollupPeriod::Epoch).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].period_type, RollupPeriod::Epoch);
    }

    #[test]
    fn test_merge_then_validate() {
        let a = make_hourly_summary(0, 1000);
        let b = make_hourly_summary(1, 2000);
        let merged = merge_summaries(&a, &b).unwrap();
        assert!(validate_summary(&merged).is_ok());
    }

    #[test]
    fn test_multiple_traders_analytics() {
        let records = vec![
            make_record_with_sender(100, 1000, 2000, true, [1u8; 32]),
            make_record_with_sender(200, 5000, 10000, true, [2u8; 32]),
            make_record_with_sender(300, 2000, 4000, false, [3u8; 32]),
            make_record_with_sender(400, 3000, 6000, false, [1u8; 32]),
            make_record_with_sender(500, 1000, 2000, true, [2u8; 32]),
        ];
        assert_eq!(unique_traders(&records), 3);
        let top = top_traders(&records, 2);
        assert_eq!(top[0].0, [2u8; 32]); // 5000 + 1000 = 6000
        assert_eq!(top[0].1, 6000);
        assert_eq!(top[1].0, [1u8; 32]); // 1000 + 3000 = 4000
        assert_eq!(top[1].1, 4000);
    }

    #[test]
    fn test_isqrt_known_values() {
        assert_eq!(isqrt(0), 0);
        assert_eq!(isqrt(1), 1);
        assert_eq!(isqrt(4), 2);
        assert_eq!(isqrt(9), 3);
        assert_eq!(isqrt(100), 10);
        assert_eq!(isqrt(10000), 100);
    }

    #[test]
    fn test_isqrt_non_perfect() {
        assert_eq!(isqrt(2), 1);
        assert_eq!(isqrt(5), 2);
        assert_eq!(isqrt(8), 2);
        assert_eq!(isqrt(15), 3);
    }

    // ============ Hardening Round 8 ============

    #[test]
    fn test_default_config_daily_h8() {
        let c = default_config(RollupPeriod::Daily);
        assert_eq!(c.period, RollupPeriod::Daily);
        assert!(c.max_records_per_rollup > 0);
    }

    #[test]
    fn test_period_duration_hourly_h8() {
        assert_eq!(period_duration_ms(&RollupPeriod::Hourly), HOUR_MS);
    }

    #[test]
    fn test_period_duration_daily_h8() {
        assert_eq!(period_duration_ms(&RollupPeriod::Daily), DAY_MS);
    }

    #[test]
    fn test_period_duration_weekly_h8() {
        assert_eq!(period_duration_ms(&RollupPeriod::Weekly), WEEK_MS);
    }

    #[test]
    fn test_period_duration_custom_h8() {
        assert_eq!(period_duration_ms(&RollupPeriod::Custom(12345)), 12345);
    }

    #[test]
    fn test_validate_config_zero_records_h8() {
        let mut c = default_config(RollupPeriod::Hourly);
        c.max_records_per_rollup = 0;
        assert_eq!(validate_config(&c), Err(RollupError::ConfigError));
    }

    #[test]
    fn test_validate_config_custom_zero_period_h8() {
        let c = default_config(RollupPeriod::Custom(0));
        assert_eq!(validate_config(&c), Err(RollupError::InvalidPeriod));
    }

    #[test]
    fn test_rollup_records_empty_h8() {
        let result = rollup_records(&[], &RollupPeriod::Hourly);
        assert!(matches!(result, Err(RollupError::EmptyRecords)));
    }

    #[test]
    fn test_create_summary_empty_h8() {
        let result = create_summary(&[], 0, HOUR_MS, RollupPeriod::Hourly);
        assert!(matches!(result, Err(RollupError::EmptyRecords)));
    }

    #[test]
    fn test_create_summary_single_record_h8() {
        let records = vec![make_record(100, 1000, 2000, true)];
        let summary = create_summary(&records, 0, HOUR_MS, RollupPeriod::Hourly).unwrap();
        assert_eq!(summary.tx_count, 1);
        assert_eq!(summary.buy_count, 1);
        assert_eq!(summary.sell_count, 0);
        assert_eq!(summary.total_volume_in, 1000);
    }

    #[test]
    fn test_merge_summaries_overlap_h8() {
        let a = make_summary(0, HOUR_MS, RollupPeriod::Hourly, 5, 1000);
        let b = make_summary(HOUR_MS / 2, HOUR_MS + HOUR_MS / 2, RollupPeriod::Hourly, 5, 2000);
        let result = merge_summaries(&a, &b);
        assert!(matches!(result, Err(RollupError::OverlapDetected)));
    }

    #[test]
    fn test_merge_summaries_valid_h8() {
        let a = make_hourly_summary(0, 1000);
        let b = make_hourly_summary(1, 2000);
        let merged = merge_summaries(&a, &b).unwrap();
        assert_eq!(merged.total_volume_in, 3000);
        assert_eq!(merged.period_start, a.period_start);
        assert_eq!(merged.period_end, b.period_end);
    }

    #[test]
    fn test_period_for_timestamp_h8() {
        let (start, end) = period_for_timestamp(HOUR_MS + 500, &RollupPeriod::Hourly);
        assert_eq!(start, HOUR_MS);
        assert_eq!(end, 2 * HOUR_MS);
    }

    #[test]
    fn test_compute_vwap_empty_h8() {
        assert_eq!(compute_vwap(&[]), 0);
    }

    #[test]
    fn test_compute_vwap_zero_amount_in_h8() {
        let records = vec![make_record(100, 0, 1000, true)];
        assert_eq!(compute_vwap(&records), 0);
    }

    #[test]
    fn test_compute_ohlc_single_record_h8() {
        let records = vec![make_record(100, 1000, 2000, true)];
        let (open, high, low, close) = compute_ohlc(&records);
        assert_eq!(open, close); // single record: open==close
        assert_eq!(high, low);   // single record: high==low
    }

    #[test]
    fn test_price_from_amounts_zero_in_h8() {
        assert_eq!(price_from_amounts(0, 1000), 0);
    }

    #[test]
    fn test_price_from_amounts_valid_h8() {
        let price = price_from_amounts(1000, 2000);
        assert_eq!(price, (2000u128 * PRICE_SCALE / 1000) as u64);
    }

    #[test]
    fn test_total_volume_empty_h8() {
        assert_eq!(total_volume(&[]), 0);
    }

    #[test]
    fn test_avg_volume_per_period_empty_h8() {
        assert_eq!(avg_volume_per_period(&[]), 0);
    }

    #[test]
    fn test_volume_trend_single_h8() {
        assert_eq!(volume_trend(&[make_hourly_summary(0, 1000)]), 0);
    }

    #[test]
    fn test_volume_trend_increasing_h8() {
        let summaries = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(1, 1000),
            make_hourly_summary(2, 2000),
            make_hourly_summary(3, 2000),
        ];
        assert!(volume_trend(&summaries) > 0);
    }

    #[test]
    fn test_peak_volume_period_h8() {
        let summaries = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(1, 5000),
            make_hourly_summary(2, 3000),
        ];
        assert_eq!(peak_volume_period(&summaries), Some(1));
    }

    #[test]
    fn test_peak_volume_period_empty_h8() {
        assert_eq!(peak_volume_period(&[]), None);
    }

    #[test]
    fn test_unique_traders_h8() {
        let records = vec![
            make_record_with_sender(100, 1000, 2000, true, [1u8; 32]),
            make_record_with_sender(200, 1000, 2000, true, [2u8; 32]),
            make_record_with_sender(300, 1000, 2000, true, [1u8; 32]),
        ];
        assert_eq!(unique_traders(&records), 2);
    }

    #[test]
    fn test_buy_sell_ratio_balanced_h8() {
        let s = make_summary(0, HOUR_MS, RollupPeriod::Hourly, 10, 1000);
        let (buy_bps, sell_bps) = buy_sell_ratio(&s);
        assert_eq!(buy_bps + sell_bps, 10000);
    }

    #[test]
    fn test_buy_sell_ratio_zero_count_h8() {
        let mut s = make_summary(0, HOUR_MS, RollupPeriod::Hourly, 0, 0);
        s.buy_count = 0;
        s.sell_count = 0;
        let (buy_bps, sell_bps) = buy_sell_ratio(&s);
        assert_eq!(buy_bps, 5000);
        assert_eq!(sell_bps, 5000);
    }

    #[test]
    fn test_avg_trade_size_zero_tx_h8() {
        let mut s = make_hourly_summary(0, 1000);
        s.tx_count = 0;
        assert_eq!(avg_trade_size(&s), 0);
    }

    #[test]
    fn test_compression_ratio_zero_summaries_h8() {
        assert_eq!(compression_ratio(100, 0), 0);
    }

    #[test]
    fn test_compression_ratio_valid_h8() {
        assert_eq!(compression_ratio(1000, 10), 1_000_000); // 100x
    }

    #[test]
    fn test_validate_summary_bad_period_h8() {
        let mut s = make_hourly_summary(0, 1000);
        s.period_end = s.period_start; // Invalid: end <= start
        assert_eq!(validate_summary(&s), Err(RollupError::InvalidPeriod));
    }

    #[test]
    fn test_validate_sequence_empty_h8() {
        assert_eq!(validate_sequence(&[]), Err(RollupError::EmptyRecords));
    }

    #[test]
    fn test_is_contiguous_h8() {
        let summaries = vec![make_hourly_summary(0, 1000), make_hourly_summary(1, 2000)];
        assert!(is_contiguous(&summaries));
    }

    #[test]
    fn test_detect_gaps_no_gaps_h8() {
        let summaries = vec![make_hourly_summary(0, 1000), make_hourly_summary(1, 2000)];
        assert!(detect_gaps(&summaries).is_empty());
    }

    #[test]
    fn test_create_pool_rollup_h8() {
        let rollup = create_pool_rollup([0xAA; 32]);
        assert_eq!(rollup.pool_id, [0xAA; 32]);
        assert!(rollup.summaries.is_empty());
        assert_eq!(rollup.total_tx_count, 0);
    }

    #[test]
    fn test_add_summary_to_rollup_h8() {
        let mut rollup = create_pool_rollup([0xAA; 32]);
        let s = make_hourly_summary(0, 1000);
        assert!(add_summary(&mut rollup, s).is_ok());
        assert_eq!(rollup.summaries.len(), 1);
        assert_eq!(rollup.total_volume, 1000);
    }

    #[test]
    fn test_add_summary_overlap_h8() {
        let mut rollup = create_pool_rollup([0xAA; 32]);
        let s1 = make_hourly_summary(0, 1000);
        let s2 = make_hourly_summary(0, 2000); // Same period = overlap
        add_summary(&mut rollup, s1).unwrap();
        assert!(matches!(add_summary(&mut rollup, s2), Err(RollupError::OverlapDetected)));
    }

    #[test]
    fn test_pool_time_span_empty_h8() {
        let rollup = create_pool_rollup([0xAA; 32]);
        assert_eq!(pool_time_span_ms(&rollup), 0);
    }

    #[test]
    fn test_to_candlestick_h8() {
        let s = make_hourly_summary(0, 1000);
        let c = to_candlestick(&s);
        assert_eq!(c.timestamp, s.period_start);
        assert_eq!(c.open, s.open_price);
        assert_eq!(c.high, s.high_price);
        assert_eq!(c.low, s.low_price);
        assert_eq!(c.close, s.close_price);
    }

    #[test]
    fn test_candlestick_series_len_h8() {
        let summaries = vec![make_hourly_summary(0, 1000), make_hourly_summary(1, 2000)];
        let series = candlestick_series(&summaries);
        assert_eq!(series.len(), 2);
    }

    #[test]
    fn test_volume_distribution_even_h8() {
        let summaries = vec![
            make_hourly_summary(0, 1000),
            make_hourly_summary(1, 1000),
        ];
        let dist = volume_distribution(&summaries);
        assert_eq!(dist[0], 5000);
        assert_eq!(dist[1], 5000);
    }

    #[test]
    fn test_summaries_fit_in_cell_h8() {
        let summaries = vec![make_hourly_summary(0, 1000), make_hourly_summary(1, 2000)];
        // Each summary is SUMMARY_BYTES=256
        let fits = summaries_fit_in_cell(&summaries, 300);
        assert_eq!(fits, 1); // Only 1 fits in 300 bytes
    }

    #[test]
    fn test_summaries_fit_in_cell_all_fit_h8() {
        let summaries = vec![make_hourly_summary(0, 1000), make_hourly_summary(1, 2000)];
        let fits = summaries_fit_in_cell(&summaries, 1000);
        assert_eq!(fits, 2);
    }
}
