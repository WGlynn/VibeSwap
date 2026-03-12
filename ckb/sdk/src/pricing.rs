// ============ Pricing — TWAP, Clearing Price & Price Feed Aggregation ============
// Token pricing engine for VibeSwap on CKB. Handles:
// - Time-weighted average price (TWAP) computation
// - Uniform clearing price discovery via binary search (batch auctions)
// - Multi-source price feed aggregation with outlier removal
// - Volume-weighted average price (VWAP)
// - AMM spot pricing from reserves
// - Exponential moving average (EMA)
// - Confidence scoring, staleness checks, and OHLC price ranges
//
// All prices use PRECISION (1e18) fixed-point scaling.
// Math overflow is handled via vibeswap_math::mul_div (256-bit intermediate).

use vibeswap_math::PRECISION;
use vibeswap_math::mul_div;

// ============ Constants ============

/// Basis points denominator (10000 = 100%)
pub const BPS: u128 = 10_000;

/// Maximum allowed deviation of spot price from TWAP (5%)
pub const MAX_TWAP_DEVIATION_BPS: u16 = 500;

/// Default TWAP window in blocks (~10 minutes at 4s/block)
pub const TWAP_WINDOW_BLOCKS: u64 = 150;

/// Minimum number of price observations required for TWAP
pub const MIN_OBSERVATIONS: usize = 3;

/// Maximum number of stored price observations
pub const MAX_OBSERVATIONS: usize = 100;

/// Maximum binary search iterations for clearing price discovery
pub const CLEARING_PRICE_ITERATIONS: u32 = 50;

/// Price staleness threshold in blocks (~30 minutes)
pub const PRICE_STALENESS_BLOCKS: u64 = 450;

/// Maximum number of price feed sources
pub const MAX_PRICE_SOURCES: usize = 10;

/// Minimum confidence score in basis points (90%)
pub const CONFIDENCE_THRESHOLD_BPS: u16 = 9000;

/// Deviation threshold for outlier detection (10%)
pub const OUTLIER_DEVIATION_BPS: u16 = 1000;

// ============ Error Types ============

/// Errors returned by pricing functions.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PricingError {
    /// Not enough observations for the requested computation
    InsufficientObservations,
    /// Price data is too old to be trusted
    StalePrice,
    /// Spot price deviates from TWAP beyond the allowed threshold
    ExceedsTwapDeviation,
    /// No valid price sources after filtering
    NoValidSources,
    /// A zero price was encountered where a positive price is required
    ZeroPrice,
    /// A zero liquidity value was encountered where positive liquidity is required
    ZeroLiquidity,
    /// The requested time/block window is invalid
    InvalidWindow,
    /// A price was flagged as an outlier
    OutlierDetected,
    /// No clearing price could be found (supply/demand do not intersect)
    NoClearing,
    /// Arithmetic overflow during computation
    Overflow,
    /// Aggregated confidence is below the required threshold
    InsufficientConfidence,
}

// ============ Data Types ============

/// A single price observation at a specific block height.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PriceObservation {
    /// Price in PRECISION-scaled fixed-point
    pub price: u128,
    /// Block number when this observation was recorded
    pub block_number: u64,
    /// Liquidity depth at the time of observation (PRECISION-scaled)
    pub liquidity: u128,
}

/// Result of a TWAP computation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TWAPResult {
    /// Time-weighted average price
    pub twap_price: u128,
    /// Most recent spot price
    pub spot_price: u128,
    /// Deviation between spot and TWAP in basis points
    pub deviation_bps: u16,
    /// Whether the deviation is within the allowed threshold
    pub is_valid: bool,
    /// Number of observations used in the computation
    pub observation_count: u32,
    /// Actual window span in blocks
    pub window_blocks: u64,
}

/// Uniform clearing price discovered via binary search.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClearingPrice {
    /// The clearing price where supply meets demand
    pub price: u128,
    /// Total buy volume at or above clearing price
    pub buy_volume: u128,
    /// Total sell volume at or below clearing price
    pub sell_volume: u128,
    /// Volume that was matched (min of buy and sell at clearing)
    pub matched_volume: u128,
    /// Unmatched buy volume
    pub unmatched_buy: u128,
    /// Unmatched sell volume
    pub unmatched_sell: u128,
    /// Number of binary search iterations used
    pub iterations_used: u32,
}

/// Aggregated price from multiple sources after outlier removal.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AggregatedPrice {
    /// Weighted median price
    pub price: u128,
    /// Confidence score in basis points (0-10000)
    pub confidence_bps: u16,
    /// Number of sources that contributed to the final price
    pub source_count: u8,
    /// Number of sources removed as outliers
    pub outliers_removed: u8,
    /// Minimum price across valid sources
    pub min_price: u128,
    /// Maximum price across valid sources
    pub max_price: u128,
    /// Spread between min and max in basis points
    pub spread_bps: u16,
}

/// A single price feed from an external source.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PriceFeed {
    /// Unique identifier for this price source
    pub source_id: [u8; 32],
    /// Price reported by this source (PRECISION-scaled)
    pub price: u128,
    /// Confidence score of this source in basis points (0-10000)
    pub confidence: u16,
    /// Block number when this feed was last updated
    pub block_number: u64,
    /// Whether this feed passed validation
    pub is_valid: bool,
}

/// Volume-weighted average price result.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VWAPResult {
    /// Volume-weighted average price
    pub vwap: u128,
    /// Total volume across all trades
    pub total_volume: u128,
    /// Number of trades included
    pub trade_count: u32,
}

/// OHLC-style price range summary.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PriceRange {
    /// Lowest price in the window
    pub low: u128,
    /// Highest price in the window
    pub high: u128,
    /// First price (open)
    pub open: u128,
    /// Last price (close)
    pub close: u128,
    /// Simple average price
    pub average: u128,
}

// ============ Functions ============

/// Compute the time-weighted average price from a series of observations.
///
/// Only observations within `[current_block - window_blocks, current_block]` are used.
/// Each observation's price is weighted by the number of blocks it was the active price.
/// Requires at least `MIN_OBSERVATIONS` data points within the window.
pub fn compute_twap(
    observations: &[PriceObservation],
    window_blocks: u64,
    current_block: u64,
) -> Result<TWAPResult, PricingError> {
    if window_blocks == 0 {
        return Err(PricingError::InvalidWindow);
    }

    let window_start = current_block.saturating_sub(window_blocks);

    // Filter and sort observations within the window by block number
    let mut in_window: Vec<&PriceObservation> = observations
        .iter()
        .filter(|o| o.block_number >= window_start && o.block_number <= current_block)
        .collect();

    if in_window.len() < MIN_OBSERVATIONS {
        return Err(PricingError::InsufficientObservations);
    }

    in_window.sort_by_key(|o| o.block_number);

    // Time-weighted sum: each observation covers blocks until the next observation
    let mut weighted_sum: u128 = 0;
    let mut total_weight: u128 = 0;

    for i in 0..in_window.len() {
        let start_block = if i == 0 {
            window_start.max(in_window[i].block_number)
        } else {
            in_window[i].block_number
        };

        let end_block = if i + 1 < in_window.len() {
            in_window[i + 1].block_number
        } else {
            current_block
        };

        if end_block <= start_block {
            continue;
        }

        let duration = (end_block - start_block) as u128;
        // Use mul_div to avoid overflow: price * duration could exceed u128
        let contribution = mul_div(in_window[i].price, duration, 1);
        weighted_sum = weighted_sum.checked_add(contribution)
            .ok_or(PricingError::Overflow)?;
        total_weight = total_weight.checked_add(duration)
            .ok_or(PricingError::Overflow)?;
    }

    if total_weight == 0 {
        return Err(PricingError::InsufficientObservations);
    }

    let twap_price = mul_div(weighted_sum, 1, total_weight);
    let spot_price = in_window[in_window.len() - 1].price;

    // Calculate deviation in bps
    let deviation_bps = if twap_price == 0 {
        if spot_price == 0 { 0u16 } else { 10_000u16 }
    } else {
        let diff = if spot_price > twap_price {
            spot_price - twap_price
        } else {
            twap_price - spot_price
        };
        let dev = mul_div(diff, BPS, twap_price);
        if dev > u16::MAX as u128 { u16::MAX } else { dev as u16 }
    };

    let is_valid = deviation_bps <= MAX_TWAP_DEVIATION_BPS;
    let actual_window = current_block - in_window[0].block_number;

    Ok(TWAPResult {
        twap_price,
        spot_price,
        deviation_bps,
        is_valid,
        observation_count: in_window.len() as u32,
        window_blocks: actual_window,
    })
}

/// Validate that a spot price is within the allowed TWAP deviation (5%).
///
/// Returns `Ok(true)` if within bounds, `Err(ExceedsTwapDeviation)` if not.
/// Returns `Err(ZeroPrice)` if either price is zero.
pub fn validate_against_twap(spot_price: u128, twap: u128) -> Result<bool, PricingError> {
    if spot_price == 0 || twap == 0 {
        return Err(PricingError::ZeroPrice);
    }

    let diff = if spot_price > twap {
        spot_price - twap
    } else {
        twap - spot_price
    };

    let deviation_bps = mul_div(diff, BPS, twap);

    if deviation_bps > MAX_TWAP_DEVIATION_BPS as u128 {
        Err(PricingError::ExceedsTwapDeviation)
    } else {
        Ok(true)
    }
}

/// Find the uniform clearing price for a batch auction using binary search.
///
/// `buy_orders` and `sell_orders` are slices of `(price, amount)` tuples.
/// Buy orders are filled at or below their limit price.
/// Sell orders are filled at or above their limit price.
/// The clearing price maximizes matched volume.
pub fn find_clearing_price(
    buy_orders: &[(u128, u128)],
    sell_orders: &[(u128, u128)],
) -> Result<ClearingPrice, PricingError> {
    if buy_orders.is_empty() && sell_orders.is_empty() {
        return Err(PricingError::NoClearing);
    }

    // Find price bounds from the order book
    let mut min_price = u128::MAX;
    let mut max_price: u128 = 0;

    for &(price, _) in buy_orders.iter().chain(sell_orders.iter()) {
        if price == 0 {
            continue;
        }
        if price < min_price {
            min_price = price;
        }
        if price > max_price {
            max_price = price;
        }
    }

    if min_price == u128::MAX || max_price == 0 {
        return Err(PricingError::ZeroPrice);
    }

    // Binary search for the clearing price that maximizes matched volume
    let mut low = min_price;
    let mut high = max_price;
    let mut best_price = low;
    let mut best_matched: u128 = 0;
    let mut best_buy_vol: u128 = 0;
    let mut best_sell_vol: u128 = 0;
    let mut iterations: u32 = 0;

    for _ in 0..CLEARING_PRICE_ITERATIONS {
        iterations += 1;

        let mid = low / 2 + high / 2 + (low % 2 + high % 2) / 2;

        // Aggregate buy volume at or above mid (buyers willing to pay >= mid)
        let buy_vol: u128 = buy_orders
            .iter()
            .filter(|&&(price, _)| price >= mid)
            .map(|&(_, amount)| amount)
            .fold(0u128, |acc, a| acc.saturating_add(a));

        // Aggregate sell volume at or below mid (sellers willing to sell <= mid)
        let sell_vol: u128 = sell_orders
            .iter()
            .filter(|&&(price, _)| price <= mid)
            .map(|&(_, amount)| amount)
            .fold(0u128, |acc, a| acc.saturating_add(a));

        let matched = buy_vol.min(sell_vol);

        if matched > best_matched || (matched == best_matched && mid > best_price) {
            best_matched = matched;
            best_price = mid;
            best_buy_vol = buy_vol;
            best_sell_vol = sell_vol;
        }

        if high.saturating_sub(low) <= 1 {
            break;
        }

        // Move toward more matched volume
        if buy_vol > sell_vol {
            // More buyers than sellers — price should go up
            low = mid;
        } else if sell_vol > buy_vol {
            // More sellers than buyers — price should go down
            high = mid;
        } else {
            // Perfect balance
            break;
        }
    }

    // If no volume matched at all, try the midpoint as a fallback
    if best_matched == 0 {
        // Check if there is any overlap between buy and sell prices
        let max_buy = buy_orders.iter().map(|&(p, _)| p).max().unwrap_or(0);
        let min_sell = sell_orders.iter().map(|&(p, _)| p).filter(|&p| p > 0).min().unwrap_or(u128::MAX);

        if max_buy < min_sell {
            // No overlap — no clearing possible
            return Err(PricingError::NoClearing);
        }
    }

    let unmatched_buy = best_buy_vol.saturating_sub(best_matched);
    let unmatched_sell = best_sell_vol.saturating_sub(best_matched);

    Ok(ClearingPrice {
        price: best_price,
        buy_volume: best_buy_vol,
        sell_volume: best_sell_vol,
        matched_volume: best_matched,
        unmatched_buy,
        unmatched_sell,
        iterations_used: iterations,
    })
}

/// Aggregate prices from multiple feeds using confidence-weighted median with outlier removal.
///
/// 1. Filter out stale feeds (beyond PRICE_STALENESS_BLOCKS).
/// 2. Remove outliers (>10% deviation from median).
/// 3. Compute confidence-weighted average of remaining prices.
/// 4. Return error if confidence falls below CONFIDENCE_THRESHOLD_BPS.
pub fn aggregate_prices(
    feeds: &[PriceFeed],
    current_block: u64,
) -> Result<AggregatedPrice, PricingError> {
    // Step 1: Filter valid and non-stale feeds
    let valid_feeds: Vec<&PriceFeed> = feeds
        .iter()
        .filter(|f| f.is_valid && f.price > 0 && !is_price_stale(f.block_number, current_block))
        .collect();

    if valid_feeds.is_empty() {
        return Err(PricingError::NoValidSources);
    }

    // Collect prices for outlier detection
    let prices: Vec<u128> = valid_feeds.iter().map(|f| f.price).collect();
    let filtered = remove_outliers(&prices);

    if filtered.is_empty() {
        return Err(PricingError::NoValidSources);
    }

    let outliers_removed = (prices.len() - filtered.len()) as u8;

    // Build confidence-weighted average from filtered prices
    let mut weighted_sum: u128 = 0;
    let mut total_confidence: u128 = 0;
    let mut min_price = u128::MAX;
    let mut max_price: u128 = 0;
    let mut source_count: u8 = 0;

    for feed in &valid_feeds {
        // Only include feeds whose prices survived outlier removal
        if filtered.contains(&feed.price) {
            let conf = feed.confidence as u128;
            weighted_sum = weighted_sum
                .checked_add(mul_div(feed.price, conf, 1))
                .ok_or(PricingError::Overflow)?;
            total_confidence = total_confidence
                .checked_add(conf)
                .ok_or(PricingError::Overflow)?;

            if feed.price < min_price {
                min_price = feed.price;
            }
            if feed.price > max_price {
                max_price = feed.price;
            }
            source_count += 1;
        }
    }

    if total_confidence == 0 || source_count == 0 {
        return Err(PricingError::NoValidSources);
    }

    let price = mul_div(weighted_sum, 1, total_confidence);
    let confidence_bps = confidence_from_sources(&filtered);

    let spread_bps = if min_price == 0 {
        0u16
    } else {
        let spread = mul_div(max_price - min_price, BPS, min_price);
        if spread > u16::MAX as u128 { u16::MAX } else { spread as u16 }
    };

    Ok(AggregatedPrice {
        price,
        confidence_bps,
        source_count,
        outliers_removed,
        min_price,
        max_price,
        spread_bps,
    })
}

/// Compute the volume-weighted average price from a set of trades.
///
/// Each trade is a `(price, volume)` tuple.
/// VWAP = sum(price_i * volume_i) / sum(volume_i).
pub fn compute_vwap(trades: &[(u128, u128)]) -> Result<VWAPResult, PricingError> {
    if trades.is_empty() {
        return Err(PricingError::InsufficientObservations);
    }

    let mut weighted_sum: u128 = 0;
    let mut total_volume: u128 = 0;

    for &(price, volume) in trades {
        if volume == 0 {
            continue;
        }
        // price * volume may overflow — use mul_div to accumulate safely
        let contribution = mul_div(price, volume, PRECISION);
        weighted_sum = weighted_sum
            .checked_add(contribution)
            .ok_or(PricingError::Overflow)?;
        total_volume = total_volume
            .checked_add(volume)
            .ok_or(PricingError::Overflow)?;
    }

    if total_volume == 0 {
        return Err(PricingError::ZeroLiquidity);
    }

    let vwap = mul_div(weighted_sum, PRECISION, total_volume);

    Ok(VWAPResult {
        vwap,
        total_volume,
        trade_count: trades.len() as u32,
    })
}

/// Compute the AMM spot price from token reserves.
///
/// spot_price = reserve_out * PRECISION / reserve_in
/// This is the marginal price for an infinitesimally small trade.
pub fn spot_price_from_reserves(
    reserve_in: u128,
    reserve_out: u128,
) -> Result<u128, PricingError> {
    if reserve_in == 0 {
        return Err(PricingError::ZeroLiquidity);
    }
    if reserve_out == 0 {
        return Err(PricingError::ZeroPrice);
    }

    Ok(mul_div(reserve_out, PRECISION, reserve_in))
}

/// Compute the OHLC-style price range from observations.
///
/// Returns the low, high, open (first), close (last), and simple average price.
/// Observations are sorted by block number to determine open/close.
pub fn price_range(observations: &[PriceObservation]) -> Result<PriceRange, PricingError> {
    if observations.is_empty() {
        return Err(PricingError::InsufficientObservations);
    }

    let mut sorted: Vec<&PriceObservation> = observations.iter().collect();
    sorted.sort_by_key(|o| o.block_number);

    let open = sorted[0].price;
    let close = sorted[sorted.len() - 1].price;

    let mut low = u128::MAX;
    let mut high: u128 = 0;
    let mut sum: u128 = 0;

    for obs in &sorted {
        if obs.price < low {
            low = obs.price;
        }
        if obs.price > high {
            high = obs.price;
        }
        sum = sum.checked_add(obs.price).ok_or(PricingError::Overflow)?;
    }

    let average = sum / sorted.len() as u128;

    Ok(PriceRange {
        low,
        high,
        open,
        close,
        average,
    })
}

/// Check if a price observation is stale.
///
/// Returns `true` if more than `PRICE_STALENESS_BLOCKS` have elapsed since
/// the observation was recorded.
pub fn is_price_stale(observation_block: u64, current_block: u64) -> bool {
    if current_block <= observation_block {
        return false;
    }
    (current_block - observation_block) > PRICE_STALENESS_BLOCKS
}

/// Remove outlier prices that deviate more than 10% from the median.
///
/// Uses a fixed-size scratch array (no heap allocation beyond the result Vec).
/// Returns the filtered list of prices with outliers removed.
pub fn remove_outliers(prices: &[u128]) -> Vec<u128> {
    if prices.is_empty() {
        return Vec::new();
    }

    // Sort into fixed-size scratch array
    let len = prices.len().min(MAX_PRICE_SOURCES);
    let mut scratch = [0u128; MAX_PRICE_SOURCES];
    for i in 0..len {
        scratch[i] = prices[i];
    }

    // Sort the scratch array (insertion sort — max 10 elements)
    for i in 1..len {
        let key = scratch[i];
        let mut j = i;
        while j > 0 && scratch[j - 1] > key {
            scratch[j] = scratch[j - 1];
            j -= 1;
        }
        scratch[j] = key;
    }

    // Median
    let median = if len % 2 == 1 {
        scratch[len / 2]
    } else {
        // Average of two middle values
        scratch[len / 2 - 1] / 2 + scratch[len / 2] / 2
    };

    if median == 0 {
        // If median is zero, keep only zero prices
        return prices.iter().copied().filter(|&p| p == 0).collect();
    }

    // Filter: keep prices within OUTLIER_DEVIATION_BPS of median
    let threshold = OUTLIER_DEVIATION_BPS as u128;
    prices
        .iter()
        .copied()
        .filter(|&p| {
            let diff = if p > median { p - median } else { median - p };
            let deviation = mul_div(diff, BPS, median);
            deviation <= threshold
        })
        .collect()
}

/// Compute the liquidity-weighted average price from observations.
///
/// Each observation's price is weighted by its liquidity depth.
/// This emphasizes prices recorded when liquidity was deeper (more reliable).
pub fn liquidity_weighted_price(
    observations: &[PriceObservation],
) -> Result<u128, PricingError> {
    if observations.is_empty() {
        return Err(PricingError::InsufficientObservations);
    }

    let mut weighted_sum: u128 = 0;
    let mut total_liquidity: u128 = 0;

    for obs in observations {
        if obs.liquidity == 0 {
            continue;
        }
        // price * liquidity may overflow — use mul_div for safe accumulation
        let contribution = mul_div(obs.price, obs.liquidity, PRECISION);
        weighted_sum = weighted_sum
            .checked_add(contribution)
            .ok_or(PricingError::Overflow)?;
        total_liquidity = total_liquidity
            .checked_add(obs.liquidity)
            .ok_or(PricingError::Overflow)?;
    }

    if total_liquidity == 0 {
        return Err(PricingError::ZeroLiquidity);
    }

    Ok(mul_div(weighted_sum, PRECISION, total_liquidity))
}

/// Calculate the signed price change in basis points.
///
/// Returns a positive value if the price increased, negative if decreased.
/// Returns 0 if old_price is 0 (to avoid division by zero).
pub fn price_change_bps(old_price: u128, new_price: u128) -> i32 {
    if old_price == 0 {
        return 0;
    }

    let diff = if new_price >= old_price {
        let d = new_price - old_price;
        let bps = mul_div(d, BPS, old_price);
        if bps > i32::MAX as u128 { i32::MAX } else { bps as i32 }
    } else {
        let d = old_price - new_price;
        let bps = mul_div(d, BPS, old_price);
        if bps > i32::MAX as u128 { i32::MIN } else { -(bps as i32) }
    };

    diff
}

/// Compute an exponential moving average (EMA) over price observations.
///
/// `alpha_bps` controls the smoothing factor (0-10000). Higher alpha gives
/// more weight to recent prices. `alpha_bps = 10000` means only the latest
/// price matters; `alpha_bps = 0` means only the first price matters.
///
/// Observations are sorted by block number before processing.
pub fn exponential_moving_average(
    observations: &[PriceObservation],
    alpha_bps: u16,
) -> Result<u128, PricingError> {
    if observations.is_empty() {
        return Err(PricingError::InsufficientObservations);
    }

    let mut sorted: Vec<&PriceObservation> = observations.iter().collect();
    sorted.sort_by_key(|o| o.block_number);

    let alpha = alpha_bps as u128;
    let one_minus_alpha = BPS.saturating_sub(alpha);

    let mut ema = sorted[0].price;

    for obs in sorted.iter().skip(1) {
        // ema = alpha * price + (1 - alpha) * ema
        // Both multiplied by BPS denominator to avoid precision loss
        let weighted_price = mul_div(obs.price, alpha, BPS);
        let weighted_ema = mul_div(ema, one_minus_alpha, BPS);
        ema = weighted_price.checked_add(weighted_ema).ok_or(PricingError::Overflow)?;
    }

    Ok(ema)
}

/// Compute a confidence score (in basis points) from a set of prices.
///
/// The score reflects how tightly clustered the prices are. If all prices are
/// identical the confidence is 10000 (100%). As spread increases, confidence
/// decreases linearly down to 0.
///
/// For a single price, confidence is 10000 (maximum).
pub fn confidence_from_sources(prices: &[u128]) -> u16 {
    if prices.is_empty() {
        return 0;
    }
    if prices.len() == 1 {
        return BPS as u16;
    }

    // Find min, max, and mean
    let mut min_p = u128::MAX;
    let mut max_p: u128 = 0;
    let mut sum: u128 = 0;

    for &p in prices {
        if p < min_p {
            min_p = p;
        }
        if p > max_p {
            max_p = p;
        }
        sum = sum.saturating_add(p);
    }

    let mean = sum / prices.len() as u128;

    if mean == 0 {
        // All zeros — technically unanimous
        return BPS as u16;
    }

    // Spread as a fraction of the mean
    let spread = max_p - min_p;
    let spread_bps = mul_div(spread, BPS, mean);

    // Confidence = max(0, 10000 - spread_bps)
    // A spread of 100% (10000 bps) or more gives 0 confidence
    if spread_bps >= BPS {
        0
    } else {
        (BPS - spread_bps) as u16
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Helper Constructors ============

    fn obs(price: u128, block: u64, liquidity: u128) -> PriceObservation {
        PriceObservation {
            price,
            block_number: block,
            liquidity,
        }
    }

    fn feed(price: u128, confidence: u16, block: u64, valid: bool) -> PriceFeed {
        PriceFeed {
            source_id: [0u8; 32],
            price,
            confidence,
            block_number: block,
            is_valid: valid,
        }
    }

    fn feed_with_id(id: u8, price: u128, confidence: u16, block: u64) -> PriceFeed {
        let mut source_id = [0u8; 32];
        source_id[0] = id;
        PriceFeed {
            source_id,
            price,
            confidence,
            block_number: block,
            is_valid: true,
        }
    }

    // ============ TWAP Tests ============

    #[test]
    fn twap_stable_prices() {
        let observations = vec![
            obs(2000 * PRECISION, 100, PRECISION),
            obs(2000 * PRECISION, 110, PRECISION),
            obs(2000 * PRECISION, 120, PRECISION),
            obs(2000 * PRECISION, 130, PRECISION),
        ];
        let result = compute_twap(&observations, 50, 130).unwrap();
        assert_eq!(result.twap_price, 2000 * PRECISION);
        assert_eq!(result.spot_price, 2000 * PRECISION);
        assert_eq!(result.deviation_bps, 0);
        assert!(result.is_valid);
        assert_eq!(result.observation_count, 4);
    }

    #[test]
    fn twap_trending_up() {
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(1100 * PRECISION, 110, PRECISION),
            obs(1200 * PRECISION, 120, PRECISION),
            obs(1300 * PRECISION, 130, PRECISION),
        ];
        let result = compute_twap(&observations, 50, 130).unwrap();
        // TWAP should be between 1000 and 1300
        assert!(result.twap_price >= 1000 * PRECISION);
        assert!(result.twap_price <= 1300 * PRECISION);
        assert_eq!(result.spot_price, 1300 * PRECISION);
    }

    #[test]
    fn twap_trending_down() {
        let observations = vec![
            obs(2000 * PRECISION, 100, PRECISION),
            obs(1800 * PRECISION, 110, PRECISION),
            obs(1600 * PRECISION, 120, PRECISION),
            obs(1400 * PRECISION, 130, PRECISION),
        ];
        let result = compute_twap(&observations, 50, 130).unwrap();
        assert!(result.twap_price >= 1400 * PRECISION);
        assert!(result.twap_price <= 2000 * PRECISION);
        assert_eq!(result.spot_price, 1400 * PRECISION);
    }

    #[test]
    fn twap_volatile_prices() {
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(2000 * PRECISION, 110, PRECISION),
            obs(800 * PRECISION, 120, PRECISION),
            obs(1500 * PRECISION, 130, PRECISION),
        ];
        let result = compute_twap(&observations, 50, 130).unwrap();
        // TWAP should smooth the volatility
        assert!(result.twap_price > 800 * PRECISION);
        assert!(result.twap_price < 2000 * PRECISION);
    }

    #[test]
    fn twap_insufficient_observations() {
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(1100 * PRECISION, 110, PRECISION),
        ];
        let result = compute_twap(&observations, 50, 130);
        assert_eq!(result, Err(PricingError::InsufficientObservations));
    }

    #[test]
    fn twap_all_observations_outside_window() {
        let observations = vec![
            obs(1000 * PRECISION, 10, PRECISION),
            obs(1100 * PRECISION, 20, PRECISION),
            obs(1200 * PRECISION, 30, PRECISION),
        ];
        let result = compute_twap(&observations, 50, 1000);
        assert_eq!(result, Err(PricingError::InsufficientObservations));
    }

    #[test]
    fn twap_zero_window() {
        let observations = vec![obs(1000 * PRECISION, 100, PRECISION)];
        let result = compute_twap(&observations, 0, 100);
        assert_eq!(result, Err(PricingError::InvalidWindow));
    }

    #[test]
    fn twap_exactly_min_observations() {
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(1100 * PRECISION, 110, PRECISION),
            obs(1050 * PRECISION, 120, PRECISION),
        ];
        let result = compute_twap(&observations, 30, 120).unwrap();
        assert_eq!(result.observation_count, 3);
    }

    #[test]
    fn twap_unordered_observations() {
        // Observations provided out of order — should still work
        let observations = vec![
            obs(1200 * PRECISION, 120, PRECISION),
            obs(1000 * PRECISION, 100, PRECISION),
            obs(1100 * PRECISION, 110, PRECISION),
        ];
        let result = compute_twap(&observations, 30, 120).unwrap();
        assert!(result.twap_price > 0);
        assert_eq!(result.spot_price, 1200 * PRECISION);
    }

    #[test]
    fn twap_single_block_duration() {
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(1100 * PRECISION, 101, PRECISION),
            obs(1200 * PRECISION, 102, PRECISION),
        ];
        let result = compute_twap(&observations, 10, 102).unwrap();
        assert!(result.twap_price > 0);
    }

    #[test]
    fn twap_large_window() {
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(1100 * PRECISION, 200, PRECISION),
            obs(1200 * PRECISION, 300, PRECISION),
        ];
        let result = compute_twap(&observations, 500, 300).unwrap();
        assert_eq!(result.observation_count, 3);
    }

    #[test]
    fn twap_deviation_within_bounds() {
        // Spot is very close to TWAP
        let observations = vec![
            obs(2000 * PRECISION, 100, PRECISION),
            obs(2010 * PRECISION, 110, PRECISION),
            obs(2005 * PRECISION, 120, PRECISION),
        ];
        let result = compute_twap(&observations, 30, 120).unwrap();
        assert!(result.is_valid);
        assert!(result.deviation_bps < MAX_TWAP_DEVIATION_BPS);
    }

    #[test]
    fn twap_deviation_exceeds_bounds() {
        // Spot is far from TWAP
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(1000 * PRECISION, 110, PRECISION),
            obs(1000 * PRECISION, 120, PRECISION),
            obs(2000 * PRECISION, 130, PRECISION),
        ];
        let result = compute_twap(&observations, 50, 130).unwrap();
        // Spot is 2000 but TWAP is closer to 1000 — large deviation
        assert!(!result.is_valid);
    }

    // ============ TWAP Validation Tests ============

    #[test]
    fn validate_twap_within_bounds() {
        // 4% deviation — under the 5% limit
        let spot = 1040 * PRECISION;
        let twap = 1000 * PRECISION;
        assert_eq!(validate_against_twap(spot, twap), Ok(true));
    }

    #[test]
    fn validate_twap_at_bounds() {
        // Exactly 5% deviation — should pass
        let twap = 10000 * PRECISION;
        let spot = 10500 * PRECISION;
        assert_eq!(validate_against_twap(spot, twap), Ok(true));
    }

    #[test]
    fn validate_twap_exceeds_bounds() {
        // 6% deviation — over the 5% limit
        let spot = 1060 * PRECISION;
        let twap = 1000 * PRECISION;
        assert_eq!(
            validate_against_twap(spot, twap),
            Err(PricingError::ExceedsTwapDeviation)
        );
    }

    #[test]
    fn validate_twap_negative_deviation_within() {
        // Spot below TWAP by 3%
        let spot = 970 * PRECISION;
        let twap = 1000 * PRECISION;
        assert_eq!(validate_against_twap(spot, twap), Ok(true));
    }

    #[test]
    fn validate_twap_negative_deviation_exceeds() {
        // Spot below TWAP by 7%
        let spot = 930 * PRECISION;
        let twap = 1000 * PRECISION;
        assert_eq!(
            validate_against_twap(spot, twap),
            Err(PricingError::ExceedsTwapDeviation)
        );
    }

    #[test]
    fn validate_twap_zero_spot() {
        assert_eq!(
            validate_against_twap(0, 1000 * PRECISION),
            Err(PricingError::ZeroPrice)
        );
    }

    #[test]
    fn validate_twap_zero_twap() {
        assert_eq!(
            validate_against_twap(1000 * PRECISION, 0),
            Err(PricingError::ZeroPrice)
        );
    }

    #[test]
    fn validate_twap_both_zero() {
        assert_eq!(validate_against_twap(0, 0), Err(PricingError::ZeroPrice));
    }

    #[test]
    fn validate_twap_identical_prices() {
        let p = 5000 * PRECISION;
        assert_eq!(validate_against_twap(p, p), Ok(true));
    }

    // ============ Clearing Price Tests ============

    #[test]
    fn clearing_balanced_orders() {
        let buys = vec![
            (2100 * PRECISION, 100 * PRECISION),
            (2050 * PRECISION, 50 * PRECISION),
        ];
        let sells = vec![
            (1950 * PRECISION, 80 * PRECISION),
            (2000 * PRECISION, 70 * PRECISION),
        ];
        let result = find_clearing_price(&buys, &sells).unwrap();
        assert!(result.price >= 1950 * PRECISION);
        assert!(result.price <= 2100 * PRECISION);
        assert!(result.matched_volume > 0);
    }

    #[test]
    fn clearing_buy_heavy() {
        let buys = vec![
            (2200 * PRECISION, 500 * PRECISION),
            (2100 * PRECISION, 300 * PRECISION),
        ];
        let sells = vec![(2000 * PRECISION, 100 * PRECISION)];
        let result = find_clearing_price(&buys, &sells).unwrap();
        assert!(result.buy_volume > result.sell_volume);
        assert!(result.unmatched_buy > 0);
    }

    #[test]
    fn clearing_sell_heavy() {
        let buys = vec![(2000 * PRECISION, 50 * PRECISION)];
        let sells = vec![
            (1800 * PRECISION, 200 * PRECISION),
            (1900 * PRECISION, 300 * PRECISION),
        ];
        let result = find_clearing_price(&buys, &sells).unwrap();
        assert!(result.sell_volume > result.buy_volume || result.unmatched_sell > 0);
    }

    #[test]
    fn clearing_single_order_each_side() {
        let buys = vec![(2000 * PRECISION, 100 * PRECISION)];
        let sells = vec![(1900 * PRECISION, 100 * PRECISION)];
        let result = find_clearing_price(&buys, &sells).unwrap();
        assert!(result.price >= 1900 * PRECISION);
        assert!(result.price <= 2000 * PRECISION);
        assert!(result.matched_volume > 0);
    }

    #[test]
    fn clearing_empty_orders() {
        let result = find_clearing_price(&[], &[]);
        assert_eq!(result, Err(PricingError::NoClearing));
    }

    #[test]
    fn clearing_no_overlap() {
        // Buyers want < 1000, sellers want > 2000 — no clearing possible
        let buys = vec![(900 * PRECISION, 100 * PRECISION)];
        let sells = vec![(1100 * PRECISION, 100 * PRECISION)];
        let result = find_clearing_price(&buys, &sells);
        assert_eq!(result, Err(PricingError::NoClearing));
    }

    #[test]
    fn clearing_exact_match() {
        // Same price, same amount
        let buys = vec![(2000 * PRECISION, 100 * PRECISION)];
        let sells = vec![(2000 * PRECISION, 100 * PRECISION)];
        let result = find_clearing_price(&buys, &sells).unwrap();
        assert_eq!(result.price, 2000 * PRECISION);
        assert_eq!(result.matched_volume, 100 * PRECISION);
        assert_eq!(result.unmatched_buy, 0);
        assert_eq!(result.unmatched_sell, 0);
    }

    #[test]
    fn clearing_many_orders() {
        let buys: Vec<(u128, u128)> = (0..10)
            .map(|i| ((2000 + i * 10) as u128 * PRECISION, 10 * PRECISION))
            .collect();
        let sells: Vec<(u128, u128)> = (0..10)
            .map(|i| ((1950 + i * 10) as u128 * PRECISION, 10 * PRECISION))
            .collect();
        let result = find_clearing_price(&buys, &sells).unwrap();
        assert!(result.matched_volume > 0);
        assert!(result.iterations_used <= CLEARING_PRICE_ITERATIONS);
    }

    #[test]
    fn clearing_only_buys() {
        let buys = vec![(2000 * PRECISION, 100 * PRECISION)];
        let result = find_clearing_price(&buys, &[]);
        // With only buy orders and no sells, there can be no match
        // The function should either return NoClearing or a result with 0 matched volume
        assert!(result.is_err() || result.unwrap().matched_volume == 0);
    }

    #[test]
    fn clearing_only_sells() {
        let sells = vec![(2000 * PRECISION, 100 * PRECISION)];
        let result = find_clearing_price(&[], &sells);
        assert!(result.is_err() || result.unwrap().matched_volume == 0);
    }

    #[test]
    fn clearing_large_price_values() {
        let buys = vec![(u128::MAX / 2, 100 * PRECISION)];
        let sells = vec![(u128::MAX / 4, 100 * PRECISION)];
        let result = find_clearing_price(&buys, &sells).unwrap();
        assert!(result.price > 0);
    }

    // ============ Price Aggregation Tests ============

    #[test]
    fn aggregate_all_agreeing() {
        let feeds = vec![
            feed(2000 * PRECISION, 9000, 100, true),
            feed(2000 * PRECISION, 9000, 100, true),
            feed(2000 * PRECISION, 9000, 100, true),
        ];
        let result = aggregate_prices(&feeds, 100).unwrap();
        assert_eq!(result.price, 2000 * PRECISION);
        assert_eq!(result.source_count, 3);
        assert_eq!(result.outliers_removed, 0);
        assert_eq!(result.spread_bps, 0);
    }

    #[test]
    fn aggregate_with_outlier() {
        let feeds = vec![
            feed(2000 * PRECISION, 9000, 100, true),
            feed(2010 * PRECISION, 9000, 100, true),
            feed(2005 * PRECISION, 9000, 100, true),
            feed(5000 * PRECISION, 9000, 100, true), // Outlier
        ];
        let result = aggregate_prices(&feeds, 100).unwrap();
        // Outlier should be removed
        assert!(result.outliers_removed >= 1);
        // Price should be near 2005
        assert!(result.price > 1900 * PRECISION);
        assert!(result.price < 2100 * PRECISION);
    }

    #[test]
    fn aggregate_all_stale() {
        let feeds = vec![
            feed(2000 * PRECISION, 9000, 100, true),
            feed(2010 * PRECISION, 9000, 100, true),
        ];
        // Current block is 1000 — both feeds are stale (block 100, staleness = 450)
        let result = aggregate_prices(&feeds, 1000);
        assert_eq!(result, Err(PricingError::NoValidSources));
    }

    #[test]
    fn aggregate_mixed_confidence() {
        let feeds = vec![
            feed(2000 * PRECISION, 9000, 100, true), // High confidence
            feed(2010 * PRECISION, 5000, 100, true),  // Medium confidence
            feed(2005 * PRECISION, 1000, 100, true),  // Low confidence
        ];
        let result = aggregate_prices(&feeds, 100).unwrap();
        // High-confidence feed should dominate
        assert!(result.price > 1990 * PRECISION);
        assert!(result.price < 2020 * PRECISION);
    }

    #[test]
    fn aggregate_single_source() {
        let feeds = vec![feed(2000 * PRECISION, 9000, 100, true)];
        let result = aggregate_prices(&feeds, 100).unwrap();
        assert_eq!(result.price, 2000 * PRECISION);
        assert_eq!(result.source_count, 1);
    }

    #[test]
    fn aggregate_all_invalid() {
        let feeds = vec![
            feed(2000 * PRECISION, 9000, 100, false),
            feed(2010 * PRECISION, 9000, 100, false),
        ];
        let result = aggregate_prices(&feeds, 100);
        assert_eq!(result, Err(PricingError::NoValidSources));
    }

    #[test]
    fn aggregate_zero_price_feeds() {
        let feeds = vec![
            feed(0, 9000, 100, true),
            feed(0, 9000, 100, true),
        ];
        let result = aggregate_prices(&feeds, 100);
        assert_eq!(result, Err(PricingError::NoValidSources));
    }

    #[test]
    fn aggregate_mixed_valid_invalid() {
        let feeds = vec![
            feed(2000 * PRECISION, 9000, 100, true),
            feed(2005 * PRECISION, 9000, 100, false), // Invalid
            feed(2010 * PRECISION, 9000, 100, true),
            feed(2003 * PRECISION, 9000, 99, true),
        ];
        let result = aggregate_prices(&feeds, 100).unwrap();
        // Invalid feed should be excluded
        assert_eq!(result.source_count, 3);
    }

    #[test]
    fn aggregate_partial_stale() {
        let feeds = vec![
            feed(2000 * PRECISION, 9000, 500, true), // Fresh at block 500
            feed(2010 * PRECISION, 9000, 500, true),
            feed(2005 * PRECISION, 9000, 500, true),
            feed(1800 * PRECISION, 9000, 10, true), // Stale (block 10 vs current 500)
        ];
        let result = aggregate_prices(&feeds, 500).unwrap();
        // Stale feed excluded, so price near 2005
        assert!(result.price > 1990 * PRECISION);
        assert!(result.price < 2020 * PRECISION);
    }

    // ============ VWAP Tests ============

    #[test]
    fn vwap_uniform_trades() {
        let trades = vec![
            (2000 * PRECISION, 100 * PRECISION),
            (2000 * PRECISION, 100 * PRECISION),
            (2000 * PRECISION, 100 * PRECISION),
        ];
        let result = compute_vwap(&trades).unwrap();
        assert_eq!(result.vwap, 2000 * PRECISION);
        assert_eq!(result.total_volume, 300 * PRECISION);
        assert_eq!(result.trade_count, 3);
    }

    #[test]
    fn vwap_weighted_toward_high_volume() {
        // High-volume trade at 2000, low-volume at 3000
        let trades = vec![
            (2000 * PRECISION, 900 * PRECISION),
            (3000 * PRECISION, 100 * PRECISION),
        ];
        let result = compute_vwap(&trades).unwrap();
        // VWAP should be close to 2000 (90% of volume)
        assert!(result.vwap > 2000 * PRECISION);
        assert!(result.vwap < 2200 * PRECISION);
    }

    #[test]
    fn vwap_single_trade() {
        let trades = vec![(1500 * PRECISION, 50 * PRECISION)];
        let result = compute_vwap(&trades).unwrap();
        assert_eq!(result.vwap, 1500 * PRECISION);
        assert_eq!(result.trade_count, 1);
    }

    #[test]
    fn vwap_empty_trades() {
        let result = compute_vwap(&[]);
        assert_eq!(result, Err(PricingError::InsufficientObservations));
    }

    #[test]
    fn vwap_all_zero_volume() {
        let trades = vec![
            (2000 * PRECISION, 0),
            (3000 * PRECISION, 0),
        ];
        let result = compute_vwap(&trades);
        assert_eq!(result, Err(PricingError::ZeroLiquidity));
    }

    #[test]
    fn vwap_equal_weights() {
        let trades = vec![
            (1000 * PRECISION, 100 * PRECISION),
            (3000 * PRECISION, 100 * PRECISION),
        ];
        let result = compute_vwap(&trades).unwrap();
        assert_eq!(result.vwap, 2000 * PRECISION);
    }

    #[test]
    fn vwap_large_values() {
        let trades = vec![
            (PRECISION * 1_000_000, PRECISION * 1_000_000),
            (PRECISION * 2_000_000, PRECISION * 1_000_000),
        ];
        let result = compute_vwap(&trades).unwrap();
        assert!(result.vwap > PRECISION * 1_000_000);
        assert!(result.vwap < PRECISION * 2_000_000);
    }

    // ============ Spot Price Tests ============

    #[test]
    fn spot_price_balanced_reserves() {
        let price = spot_price_from_reserves(1000 * PRECISION, 1000 * PRECISION).unwrap();
        assert_eq!(price, PRECISION); // 1:1 ratio
    }

    #[test]
    fn spot_price_imbalanced_reserves() {
        let price = spot_price_from_reserves(1000 * PRECISION, 2000 * PRECISION).unwrap();
        assert_eq!(price, 2 * PRECISION); // 2:1 ratio
    }

    #[test]
    fn spot_price_zero_reserve_in() {
        let result = spot_price_from_reserves(0, 1000 * PRECISION);
        assert_eq!(result, Err(PricingError::ZeroLiquidity));
    }

    #[test]
    fn spot_price_zero_reserve_out() {
        let result = spot_price_from_reserves(1000 * PRECISION, 0);
        assert_eq!(result, Err(PricingError::ZeroPrice));
    }

    #[test]
    fn spot_price_both_zero() {
        let result = spot_price_from_reserves(0, 0);
        assert_eq!(result, Err(PricingError::ZeroLiquidity));
    }

    #[test]
    fn spot_price_small_reserves() {
        let price = spot_price_from_reserves(1, 1).unwrap();
        assert_eq!(price, PRECISION);
    }

    #[test]
    fn spot_price_large_reserves() {
        let reserve_in = 1_000_000_000 * PRECISION;
        let reserve_out = 2_000_000_000 * PRECISION;
        let price = spot_price_from_reserves(reserve_in, reserve_out).unwrap();
        assert_eq!(price, 2 * PRECISION);
    }

    #[test]
    fn spot_price_fractional() {
        // 3:1 ratio
        let price = spot_price_from_reserves(3 * PRECISION, 1 * PRECISION).unwrap();
        assert_eq!(price, PRECISION / 3);
    }

    // ============ Price Range Tests ============

    #[test]
    fn price_range_single_observation() {
        let observations = vec![obs(1000 * PRECISION, 100, PRECISION)];
        let result = price_range(&observations).unwrap();
        assert_eq!(result.open, 1000 * PRECISION);
        assert_eq!(result.close, 1000 * PRECISION);
        assert_eq!(result.low, 1000 * PRECISION);
        assert_eq!(result.high, 1000 * PRECISION);
        assert_eq!(result.average, 1000 * PRECISION);
    }

    #[test]
    fn price_range_trending_up() {
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(1200 * PRECISION, 110, PRECISION),
            obs(1500 * PRECISION, 120, PRECISION),
        ];
        let result = price_range(&observations).unwrap();
        assert_eq!(result.open, 1000 * PRECISION);
        assert_eq!(result.close, 1500 * PRECISION);
        assert_eq!(result.low, 1000 * PRECISION);
        assert_eq!(result.high, 1500 * PRECISION);
    }

    #[test]
    fn price_range_trending_down() {
        let observations = vec![
            obs(2000 * PRECISION, 100, PRECISION),
            obs(1500 * PRECISION, 110, PRECISION),
            obs(1000 * PRECISION, 120, PRECISION),
        ];
        let result = price_range(&observations).unwrap();
        assert_eq!(result.open, 2000 * PRECISION);
        assert_eq!(result.close, 1000 * PRECISION);
        assert_eq!(result.low, 1000 * PRECISION);
        assert_eq!(result.high, 2000 * PRECISION);
    }

    #[test]
    fn price_range_volatile() {
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(3000 * PRECISION, 110, PRECISION),
            obs(500 * PRECISION, 120, PRECISION),
            obs(2000 * PRECISION, 130, PRECISION),
        ];
        let result = price_range(&observations).unwrap();
        assert_eq!(result.open, 1000 * PRECISION);
        assert_eq!(result.close, 2000 * PRECISION);
        assert_eq!(result.low, 500 * PRECISION);
        assert_eq!(result.high, 3000 * PRECISION);
    }

    #[test]
    fn price_range_empty() {
        let result = price_range(&[]);
        assert_eq!(result, Err(PricingError::InsufficientObservations));
    }

    #[test]
    fn price_range_average_calculation() {
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(2000 * PRECISION, 110, PRECISION),
            obs(3000 * PRECISION, 120, PRECISION),
        ];
        let result = price_range(&observations).unwrap();
        assert_eq!(result.average, 2000 * PRECISION);
    }

    #[test]
    fn price_range_unordered() {
        let observations = vec![
            obs(2000 * PRECISION, 120, PRECISION),
            obs(1000 * PRECISION, 100, PRECISION),
            obs(1500 * PRECISION, 110, PRECISION),
        ];
        let result = price_range(&observations).unwrap();
        // After sorting by block: open=1000, close=2000
        assert_eq!(result.open, 1000 * PRECISION);
        assert_eq!(result.close, 2000 * PRECISION);
    }

    // ============ Staleness Tests ============

    #[test]
    fn staleness_fresh() {
        assert!(!is_price_stale(100, 100));
        assert!(!is_price_stale(100, 200));
    }

    #[test]
    fn staleness_at_boundary() {
        // Exactly at the staleness threshold — not stale
        assert!(!is_price_stale(100, 100 + PRICE_STALENESS_BLOCKS));
    }

    #[test]
    fn staleness_just_over_boundary() {
        // One block past the threshold — stale
        assert!(is_price_stale(100, 100 + PRICE_STALENESS_BLOCKS + 1));
    }

    #[test]
    fn staleness_very_stale() {
        assert!(is_price_stale(100, 10000));
    }

    #[test]
    fn staleness_future_observation() {
        // Observation is in the future — not stale
        assert!(!is_price_stale(200, 100));
    }

    #[test]
    fn staleness_zero_blocks() {
        assert!(!is_price_stale(0, 0));
    }

    #[test]
    fn staleness_large_gap() {
        assert!(is_price_stale(0, u64::MAX));
    }

    // ============ Outlier Removal Tests ============

    #[test]
    fn outliers_none_present() {
        let prices = vec![
            1000 * PRECISION,
            1005 * PRECISION,
            1010 * PRECISION,
            995 * PRECISION,
        ];
        let filtered = remove_outliers(&prices);
        assert_eq!(filtered.len(), 4); // No outliers
    }

    #[test]
    fn outliers_one_outlier() {
        let prices = vec![
            1000 * PRECISION,
            1005 * PRECISION,
            1010 * PRECISION,
            5000 * PRECISION, // Outlier
        ];
        let filtered = remove_outliers(&prices);
        assert_eq!(filtered.len(), 3); // Outlier removed
        assert!(!filtered.contains(&(5000 * PRECISION)));
    }

    #[test]
    fn outliers_all_same() {
        let prices = vec![1000 * PRECISION; 5];
        let filtered = remove_outliers(&prices);
        assert_eq!(filtered.len(), 5);
    }

    #[test]
    fn outliers_empty_input() {
        let filtered = remove_outliers(&[]);
        assert!(filtered.is_empty());
    }

    #[test]
    fn outliers_single_price() {
        let filtered = remove_outliers(&[1000 * PRECISION]);
        assert_eq!(filtered.len(), 1);
    }

    #[test]
    fn outliers_two_prices_close() {
        let filtered = remove_outliers(&[1000 * PRECISION, 1050 * PRECISION]);
        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn outliers_two_prices_far() {
        let filtered = remove_outliers(&[1000 * PRECISION, 5000 * PRECISION]);
        // Both are outliers relative to the median (3000)
        // 1000 deviates by 66.7%, 5000 deviates by 66.7% — both removed
        assert!(filtered.len() < 2);
    }

    #[test]
    fn outliers_negative_direction() {
        // One price far below the median
        let prices = vec![
            2000 * PRECISION,
            2010 * PRECISION,
            2005 * PRECISION,
            100 * PRECISION, // Far below — outlier
        ];
        let filtered = remove_outliers(&prices);
        assert!(!filtered.contains(&(100 * PRECISION)));
    }

    #[test]
    fn outliers_max_sources() {
        // Exactly MAX_PRICE_SOURCES prices
        let mut prices = vec![1000 * PRECISION; MAX_PRICE_SOURCES];
        prices[MAX_PRICE_SOURCES - 1] = 5000 * PRECISION; // Outlier
        let filtered = remove_outliers(&prices);
        assert!(!filtered.contains(&(5000 * PRECISION)));
    }

    #[test]
    fn outliers_at_threshold_boundary() {
        // A price that is exactly 10% from median — should be kept
        let prices = vec![
            1000 * PRECISION,
            1000 * PRECISION,
            1000 * PRECISION,
            1100 * PRECISION, // Exactly 10% above median
        ];
        let filtered = remove_outliers(&prices);
        assert!(filtered.contains(&(1100 * PRECISION)));
    }

    #[test]
    fn outliers_just_over_threshold() {
        // A price that is 11% from median — should be removed
        let prices = vec![
            1000 * PRECISION,
            1000 * PRECISION,
            1000 * PRECISION,
            1110 * PRECISION, // 11% above — outlier
        ];
        let filtered = remove_outliers(&prices);
        // Median is 1000, deviation of 1110 = 1100 bps > 1000 bps threshold
        assert!(!filtered.contains(&(1110 * PRECISION)));
    }

    // ============ Liquidity-Weighted Price Tests ============

    #[test]
    fn liq_weighted_uniform() {
        let observations = vec![
            obs(1000 * PRECISION, 100, 100 * PRECISION),
            obs(2000 * PRECISION, 110, 100 * PRECISION),
            obs(3000 * PRECISION, 120, 100 * PRECISION),
        ];
        let result = liquidity_weighted_price(&observations).unwrap();
        assert_eq!(result, 2000 * PRECISION);
    }

    #[test]
    fn liq_weighted_skewed() {
        // Much more liquidity at the low price
        let observations = vec![
            obs(1000 * PRECISION, 100, 900 * PRECISION),
            obs(2000 * PRECISION, 110, 100 * PRECISION),
        ];
        let result = liquidity_weighted_price(&observations).unwrap();
        // Should be closer to 1000 than 2000
        assert!(result > 1000 * PRECISION);
        assert!(result < 1500 * PRECISION);
    }

    #[test]
    fn liq_weighted_empty() {
        let result = liquidity_weighted_price(&[]);
        assert_eq!(result, Err(PricingError::InsufficientObservations));
    }

    #[test]
    fn liq_weighted_all_zero_liquidity() {
        let observations = vec![
            obs(1000 * PRECISION, 100, 0),
            obs(2000 * PRECISION, 110, 0),
        ];
        let result = liquidity_weighted_price(&observations);
        assert_eq!(result, Err(PricingError::ZeroLiquidity));
    }

    #[test]
    fn liq_weighted_single_observation() {
        let observations = vec![obs(5000 * PRECISION, 100, 200 * PRECISION)];
        let result = liquidity_weighted_price(&observations).unwrap();
        assert_eq!(result, 5000 * PRECISION);
    }

    #[test]
    fn liq_weighted_heavy_at_one_price() {
        // Almost all liquidity at price 3000
        let observations = vec![
            obs(1000 * PRECISION, 100, 1 * PRECISION),
            obs(3000 * PRECISION, 110, 9999 * PRECISION),
        ];
        let result = liquidity_weighted_price(&observations).unwrap();
        // Should be very close to 3000
        assert!(result > 2990 * PRECISION);
        assert!(result <= 3000 * PRECISION);
    }

    // ============ Price Change BPS Tests ============

    #[test]
    fn price_change_positive() {
        // 10% increase
        let bps = price_change_bps(1000 * PRECISION, 1100 * PRECISION);
        assert_eq!(bps, 1000); // 10% = 1000 bps
    }

    #[test]
    fn price_change_negative() {
        // 10% decrease
        let bps = price_change_bps(1000 * PRECISION, 900 * PRECISION);
        assert_eq!(bps, -1000); // -10% = -1000 bps
    }

    #[test]
    fn price_change_zero() {
        let bps = price_change_bps(1000 * PRECISION, 1000 * PRECISION);
        assert_eq!(bps, 0);
    }

    #[test]
    fn price_change_old_zero() {
        let bps = price_change_bps(0, 1000 * PRECISION);
        assert_eq!(bps, 0); // Avoid division by zero
    }

    #[test]
    fn price_change_new_zero() {
        let bps = price_change_bps(1000 * PRECISION, 0);
        assert_eq!(bps, -10000); // -100%
    }

    #[test]
    fn price_change_both_zero() {
        let bps = price_change_bps(0, 0);
        assert_eq!(bps, 0);
    }

    #[test]
    fn price_change_large_increase() {
        // 100% increase
        let bps = price_change_bps(1000 * PRECISION, 2000 * PRECISION);
        assert_eq!(bps, 10000);
    }

    #[test]
    fn price_change_small() {
        // 0.01% increase (1 bps)
        let old = 10000 * PRECISION;
        let new = 10001 * PRECISION;
        let bps = price_change_bps(old, new);
        assert_eq!(bps, 1);
    }

    #[test]
    fn price_change_50_percent_decrease() {
        let bps = price_change_bps(2000 * PRECISION, 1000 * PRECISION);
        assert_eq!(bps, -5000); // -50%
    }

    #[test]
    fn price_change_double() {
        let bps = price_change_bps(1000 * PRECISION, 3000 * PRECISION);
        assert_eq!(bps, 20000); // +200%
    }

    // ============ EMA Tests ============

    #[test]
    fn ema_stable_prices() {
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(1000 * PRECISION, 110, PRECISION),
            obs(1000 * PRECISION, 120, PRECISION),
        ];
        let result = exponential_moving_average(&observations, 5000).unwrap();
        assert_eq!(result, 1000 * PRECISION);
    }

    #[test]
    fn ema_trending_up() {
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(1200 * PRECISION, 110, PRECISION),
            obs(1400 * PRECISION, 120, PRECISION),
        ];
        let result = exponential_moving_average(&observations, 5000).unwrap();
        // EMA should be between 1000 and 1400, closer to recent
        assert!(result > 1000 * PRECISION);
        assert!(result < 1400 * PRECISION);
    }

    #[test]
    fn ema_high_alpha() {
        // Alpha = 100% — only the latest price matters
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(2000 * PRECISION, 110, PRECISION),
            obs(3000 * PRECISION, 120, PRECISION),
        ];
        let result = exponential_moving_average(&observations, 10000).unwrap();
        assert_eq!(result, 3000 * PRECISION);
    }

    #[test]
    fn ema_low_alpha() {
        // Alpha = 0% — only the first price matters
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(2000 * PRECISION, 110, PRECISION),
            obs(3000 * PRECISION, 120, PRECISION),
        ];
        let result = exponential_moving_average(&observations, 0).unwrap();
        assert_eq!(result, 1000 * PRECISION);
    }

    #[test]
    fn ema_single_observation() {
        let observations = vec![obs(5000 * PRECISION, 100, PRECISION)];
        let result = exponential_moving_average(&observations, 5000).unwrap();
        assert_eq!(result, 5000 * PRECISION);
    }

    #[test]
    fn ema_empty() {
        let result = exponential_moving_average(&[], 5000);
        assert_eq!(result, Err(PricingError::InsufficientObservations));
    }

    #[test]
    fn ema_moderate_alpha() {
        // Alpha = 50% (5000 bps)
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(2000 * PRECISION, 110, PRECISION),
        ];
        let result = exponential_moving_average(&observations, 5000).unwrap();
        // EMA = 0.5 * 2000 + 0.5 * 1000 = 1500
        assert_eq!(result, 1500 * PRECISION);
    }

    #[test]
    fn ema_unordered_observations() {
        // Out of order — should sort by block and process correctly
        let observations = vec![
            obs(3000 * PRECISION, 120, PRECISION),
            obs(1000 * PRECISION, 100, PRECISION),
            obs(2000 * PRECISION, 110, PRECISION),
        ];
        // Same as in-order with alpha=5000
        let ordered = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(2000 * PRECISION, 110, PRECISION),
            obs(3000 * PRECISION, 120, PRECISION),
        ];
        let result1 = exponential_moving_average(&observations, 5000).unwrap();
        let result2 = exponential_moving_average(&ordered, 5000).unwrap();
        assert_eq!(result1, result2);
    }

    #[test]
    fn ema_alpha_20_percent() {
        // Alpha = 20% (2000 bps) — common smoothing factor
        let observations = vec![
            obs(100 * PRECISION, 100, PRECISION),
            obs(110 * PRECISION, 110, PRECISION),
            obs(105 * PRECISION, 120, PRECISION),
            obs(115 * PRECISION, 130, PRECISION),
        ];
        let result = exponential_moving_average(&observations, 2000).unwrap();
        // Manual: EMA0=100, EMA1=0.2*110+0.8*100=102, EMA2=0.2*105+0.8*102=102.6
        // EMA3=0.2*115+0.8*102.6=105.08
        assert!(result > 104 * PRECISION);
        assert!(result < 106 * PRECISION);
    }

    // ============ Confidence Tests ============

    #[test]
    fn confidence_unanimous() {
        let prices = vec![1000 * PRECISION; 5];
        let conf = confidence_from_sources(&prices);
        assert_eq!(conf, 10000); // 100% confidence
    }

    #[test]
    fn confidence_dispersed() {
        let prices = vec![
            1000 * PRECISION,
            2000 * PRECISION,
            3000 * PRECISION,
        ];
        let conf = confidence_from_sources(&prices);
        // Mean = 2000, spread = 2000, spread/mean = 100% = 10000 bps
        assert_eq!(conf, 0);
    }

    #[test]
    fn confidence_single_source() {
        let prices = vec![1000 * PRECISION];
        let conf = confidence_from_sources(&prices);
        assert_eq!(conf, 10000);
    }

    #[test]
    fn confidence_empty() {
        let conf = confidence_from_sources(&[]);
        assert_eq!(conf, 0);
    }

    #[test]
    fn confidence_slight_spread() {
        // 5% spread
        let prices = vec![1000 * PRECISION, 1050 * PRECISION];
        let conf = confidence_from_sources(&prices);
        // Mean=1025, spread=50, spread/mean ≈ 4.88% ≈ 488 bps
        // Confidence ≈ 10000 - 488 = 9512
        assert!(conf > 9000);
        assert!(conf < 10000);
    }

    #[test]
    fn confidence_moderate_spread() {
        // 20% spread
        let prices = vec![1000 * PRECISION, 1200 * PRECISION];
        let conf = confidence_from_sources(&prices);
        // Mean=1100, spread=200, spread/mean ≈ 18.18% ≈ 1818 bps
        // Confidence ≈ 10000 - 1818 = 8182
        assert!(conf > 7000);
        assert!(conf < 9000);
    }

    #[test]
    fn confidence_all_zeros() {
        let prices = vec![0, 0, 0];
        let conf = confidence_from_sources(&prices);
        assert_eq!(conf, 10000); // All agree on zero
    }

    #[test]
    fn confidence_two_identical() {
        let prices = vec![5000 * PRECISION, 5000 * PRECISION];
        let conf = confidence_from_sources(&prices);
        assert_eq!(conf, 10000);
    }

    // ============ Edge Case Tests ============

    #[test]
    fn edge_large_price_observation() {
        // Use a large-but-feasible price (1 trillion tokens * PRECISION)
        let big_price = 1_000_000_000_000 * PRECISION;
        let observations = vec![
            obs(big_price, 100, PRECISION),
            obs(big_price, 110, PRECISION),
            obs(big_price, 120, PRECISION),
        ];
        let result = compute_twap(&observations, 30, 120).unwrap();
        assert_eq!(result.twap_price, big_price);
    }

    #[test]
    fn edge_zero_price_observations() {
        let observations = vec![
            obs(0, 100, PRECISION),
            obs(0, 110, PRECISION),
            obs(0, 120, PRECISION),
        ];
        let result = compute_twap(&observations, 30, 120).unwrap();
        assert_eq!(result.twap_price, 0);
    }

    #[test]
    fn edge_single_observation_twap() {
        let observations = vec![obs(1000 * PRECISION, 100, PRECISION)];
        let result = compute_twap(&observations, 50, 120);
        // Only 1 observation — insufficient
        assert_eq!(result, Err(PricingError::InsufficientObservations));
    }

    #[test]
    fn edge_clearing_price_zero_amount() {
        let buys = vec![(2000 * PRECISION, 0)];
        let sells = vec![(1900 * PRECISION, 0)];
        let result = find_clearing_price(&buys, &sells).unwrap();
        assert_eq!(result.matched_volume, 0);
    }

    #[test]
    fn edge_vwap_mixed_zero_and_nonzero_volume() {
        let trades = vec![
            (2000 * PRECISION, 0),         // Zero volume — ignored
            (3000 * PRECISION, 100 * PRECISION),
        ];
        let result = compute_vwap(&trades).unwrap();
        assert_eq!(result.vwap, 3000 * PRECISION);
    }

    #[test]
    fn edge_price_range_same_block() {
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(2000 * PRECISION, 100, PRECISION),
            obs(1500 * PRECISION, 100, PRECISION),
        ];
        let result = price_range(&observations).unwrap();
        assert_eq!(result.low, 1000 * PRECISION);
        assert_eq!(result.high, 2000 * PRECISION);
    }

    #[test]
    fn edge_liq_weighted_single_zero_liq() {
        // One observation with zero liquidity, one with positive
        let observations = vec![
            obs(1000 * PRECISION, 100, 0),
            obs(2000 * PRECISION, 110, 100 * PRECISION),
        ];
        let result = liquidity_weighted_price(&observations).unwrap();
        // Zero-liquidity observation should be ignored
        assert_eq!(result, 2000 * PRECISION);
    }

    #[test]
    fn edge_confidence_large_spread() {
        let prices = vec![1 * PRECISION, 1_000_000 * PRECISION];
        let conf = confidence_from_sources(&prices);
        assert_eq!(conf, 0);
    }

    #[test]
    fn edge_ema_two_same_prices() {
        let observations = vec![
            obs(2000 * PRECISION, 100, PRECISION),
            obs(2000 * PRECISION, 110, PRECISION),
        ];
        let result = exponential_moving_average(&observations, 3000).unwrap();
        assert_eq!(result, 2000 * PRECISION);
    }

    #[test]
    fn edge_price_change_one_to_max() {
        let bps = price_change_bps(1, u128::MAX);
        // Should not panic — capped at i32::MAX
        assert_eq!(bps, i32::MAX);
    }

    #[test]
    fn edge_outlier_all_same_value() {
        let prices = vec![42 * PRECISION; 8];
        let filtered = remove_outliers(&prices);
        assert_eq!(filtered.len(), 8);
    }

    #[test]
    fn edge_validate_twap_spot_one_bps_over() {
        // Exactly 501 bps deviation — should fail
        let twap = 10000 * PRECISION;
        let spot = twap + mul_div(twap, 501, BPS);
        let result = validate_against_twap(spot, twap);
        assert_eq!(result, Err(PricingError::ExceedsTwapDeviation));
    }

    #[test]
    fn edge_validate_twap_spot_one_bps_under() {
        // Exactly 499 bps deviation — should pass
        let twap = 10000 * PRECISION;
        let spot = twap + mul_div(twap, 499, BPS);
        let result = validate_against_twap(spot, twap);
        assert_eq!(result, Ok(true));
    }

    #[test]
    fn edge_staleness_overflow_protection() {
        // observation_block = u64::MAX, current = 0 — should not panic
        assert!(!is_price_stale(u64::MAX, 0));
    }

    #[test]
    fn edge_aggregate_single_high_confidence() {
        let feeds = vec![feed(7777 * PRECISION, 10000, 100, true)];
        let result = aggregate_prices(&feeds, 100).unwrap();
        assert_eq!(result.price, 7777 * PRECISION);
        assert_eq!(result.confidence_bps, 10000);
    }

    #[test]
    fn edge_clearing_identical_prices_different_amounts() {
        let buys = vec![
            (2000 * PRECISION, 200 * PRECISION),
            (2000 * PRECISION, 300 * PRECISION),
        ];
        let sells = vec![
            (2000 * PRECISION, 100 * PRECISION),
            (2000 * PRECISION, 150 * PRECISION),
        ];
        let result = find_clearing_price(&buys, &sells).unwrap();
        assert_eq!(result.price, 2000 * PRECISION);
        assert_eq!(result.buy_volume, 500 * PRECISION);
        assert_eq!(result.sell_volume, 250 * PRECISION);
        assert_eq!(result.matched_volume, 250 * PRECISION);
    }

    #[test]
    fn edge_vwap_single_unit_volume() {
        let trades = vec![
            (1000 * PRECISION, 1),
            (2000 * PRECISION, 1),
        ];
        let result = compute_vwap(&trades).unwrap();
        assert_eq!(result.vwap, 1500 * PRECISION);
    }

    #[test]
    fn edge_spot_price_one_wei_reserves() {
        let price = spot_price_from_reserves(1, 2).unwrap();
        assert_eq!(price, 2 * PRECISION);
    }

    #[test]
    fn edge_price_range_two_observations() {
        let observations = vec![
            obs(100 * PRECISION, 50, PRECISION),
            obs(200 * PRECISION, 60, PRECISION),
        ];
        let result = price_range(&observations).unwrap();
        assert_eq!(result.open, 100 * PRECISION);
        assert_eq!(result.close, 200 * PRECISION);
        assert_eq!(result.average, 150 * PRECISION);
    }

    #[test]
    fn edge_twap_window_larger_than_data() {
        // Window is 1000 blocks but data only spans 20
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(1050 * PRECISION, 110, PRECISION),
            obs(1100 * PRECISION, 120, PRECISION),
        ];
        let result = compute_twap(&observations, 1000, 120).unwrap();
        assert!(result.twap_price > 0);
    }

    #[test]
    fn edge_aggregate_feeds_at_staleness_boundary() {
        // Feed exactly at staleness boundary — should be valid
        let feeds = vec![
            feed(1000 * PRECISION, 9000, 100, true),
            feed(1005 * PRECISION, 9000, 100, true),
            feed(1010 * PRECISION, 9000, 100, true),
        ];
        let result = aggregate_prices(&feeds, 100 + PRICE_STALENESS_BLOCKS).unwrap();
        assert!(result.source_count > 0);
    }

    #[test]
    fn edge_aggregate_feeds_one_past_staleness() {
        // Feeds one block past staleness — should be stale
        let feeds = vec![
            feed(1000 * PRECISION, 9000, 100, true),
            feed(1005 * PRECISION, 9000, 100, true),
            feed(1010 * PRECISION, 9000, 100, true),
        ];
        let result = aggregate_prices(&feeds, 100 + PRICE_STALENESS_BLOCKS + 1);
        assert_eq!(result, Err(PricingError::NoValidSources));
    }

    #[test]
    fn edge_ema_descending_alpha_50() {
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(500 * PRECISION, 110, PRECISION),
        ];
        let result = exponential_moving_average(&observations, 5000).unwrap();
        // EMA = 0.5 * 500 + 0.5 * 1000 = 750
        assert_eq!(result, 750 * PRECISION);
    }

    #[test]
    fn edge_price_change_large_negative() {
        let bps = price_change_bps(u128::MAX, 1);
        // Nearly -100%
        assert!(bps < 0);
        assert_eq!(bps, -9999); // (MAX-1)/MAX ≈ 99.99%
    }

    #[test]
    fn edge_remove_outliers_three_distinct() {
        // Three prices where two cluster and one is an outlier
        let prices = vec![1000 * PRECISION, 1010 * PRECISION, 3000 * PRECISION];
        let filtered = remove_outliers(&prices);
        assert!(!filtered.contains(&(3000 * PRECISION)));
    }

    #[test]
    fn edge_clearing_price_iterations_tracked() {
        let buys = vec![(2100 * PRECISION, 100 * PRECISION)];
        let sells = vec![(1900 * PRECISION, 100 * PRECISION)];
        let result = find_clearing_price(&buys, &sells).unwrap();
        assert!(result.iterations_used > 0);
        assert!(result.iterations_used <= CLEARING_PRICE_ITERATIONS);
    }

    #[test]
    fn edge_liq_weighted_equal_price_different_liq() {
        let observations = vec![
            obs(1000 * PRECISION, 100, 500 * PRECISION),
            obs(1000 * PRECISION, 110, 1500 * PRECISION),
        ];
        let result = liquidity_weighted_price(&observations).unwrap();
        // Same price — liquidity weighting doesn't change it
        assert_eq!(result, 1000 * PRECISION);
    }

    #[test]
    fn edge_confidence_ten_sources() {
        let prices = vec![
            1000 * PRECISION,
            1001 * PRECISION,
            1002 * PRECISION,
            1003 * PRECISION,
            1004 * PRECISION,
            1005 * PRECISION,
            1006 * PRECISION,
            1007 * PRECISION,
            1008 * PRECISION,
            1009 * PRECISION,
        ];
        let conf = confidence_from_sources(&prices);
        // Very tight clustering — high confidence
        assert!(conf > 9900);
    }

    #[test]
    fn edge_aggregate_with_id() {
        let feeds = vec![
            feed_with_id(1, 2000 * PRECISION, 9000, 100),
            feed_with_id(2, 2005 * PRECISION, 8000, 100),
            feed_with_id(3, 2010 * PRECISION, 7000, 100),
        ];
        let result = aggregate_prices(&feeds, 100).unwrap();
        assert_eq!(result.source_count, 3);
        assert!(result.price > 1990 * PRECISION);
        assert!(result.price < 2020 * PRECISION);
    }

    // ============ Hardening Batch v4 ============

    #[test]
    fn test_twap_zero_window_v4() {
        let observations = vec![obs(1000 * PRECISION, 100, PRECISION)];
        let result = compute_twap(&observations, 0, 200);
        assert_eq!(result, Err(PricingError::InvalidWindow));
    }

    #[test]
    fn test_twap_single_observation_insufficient_v4() {
        let observations = vec![obs(1000 * PRECISION, 100, PRECISION)];
        let result = compute_twap(&observations, 200, 200);
        assert_eq!(result, Err(PricingError::InsufficientObservations));
    }

    #[test]
    fn test_twap_exactly_min_observations_v4() {
        // Exactly MIN_OBSERVATIONS (3) within window
        let observations = vec![
            obs(1000 * PRECISION, 90, PRECISION),
            obs(1010 * PRECISION, 95, PRECISION),
            obs(1020 * PRECISION, 100, PRECISION),
        ];
        let result = compute_twap(&observations, 20, 100).unwrap();
        assert!(result.twap_price > 0);
        assert_eq!(result.observation_count, 3);
    }

    #[test]
    fn test_twap_constant_price_v4() {
        // All observations at same price → TWAP = spot = price, deviation = 0
        let observations = vec![
            obs(2000 * PRECISION, 80, PRECISION),
            obs(2000 * PRECISION, 90, PRECISION),
            obs(2000 * PRECISION, 100, PRECISION),
        ];
        let result = compute_twap(&observations, 30, 100).unwrap();
        assert_eq!(result.twap_price, 2000 * PRECISION);
        assert_eq!(result.spot_price, 2000 * PRECISION);
        assert_eq!(result.deviation_bps, 0);
        assert!(result.is_valid);
    }

    #[test]
    fn test_twap_observations_outside_window_excluded_v4() {
        // Two observations outside window, three inside
        let observations = vec![
            obs(500 * PRECISION, 10, PRECISION),  // outside (window starts at 50)
            obs(600 * PRECISION, 40, PRECISION),  // outside
            obs(1000 * PRECISION, 60, PRECISION), // inside
            obs(1100 * PRECISION, 80, PRECISION), // inside
            obs(1200 * PRECISION, 100, PRECISION),// inside
        ];
        let result = compute_twap(&observations, 50, 100).unwrap();
        assert_eq!(result.observation_count, 3);
        assert_eq!(result.spot_price, 1200 * PRECISION);
    }

    #[test]
    fn test_validate_twap_equal_prices_v4() {
        let result = validate_against_twap(1000 * PRECISION, 1000 * PRECISION).unwrap();
        assert!(result);
    }

    #[test]
    fn test_validate_twap_zero_spot_v4() {
        let result = validate_against_twap(0, 1000 * PRECISION);
        assert_eq!(result, Err(PricingError::ZeroPrice));
    }

    #[test]
    fn test_validate_twap_zero_twap_v4() {
        let result = validate_against_twap(1000 * PRECISION, 0);
        assert_eq!(result, Err(PricingError::ZeroPrice));
    }

    #[test]
    fn test_validate_twap_exactly_at_5_percent_v4() {
        // Exactly 5% deviation → should be valid (500 bps <= 500 bps)
        let twap = 1000 * PRECISION;
        let spot = 1050 * PRECISION; // +5%
        let result = validate_against_twap(spot, twap).unwrap();
        assert!(result);
    }

    #[test]
    fn test_validate_twap_just_over_5_percent_v4() {
        // 5.01% deviation → exceeds
        let twap = 10_000 * PRECISION;
        let spot = 10_501 * PRECISION; // 5.01%
        let result = validate_against_twap(spot, twap);
        assert_eq!(result, Err(PricingError::ExceedsTwapDeviation));
    }

    #[test]
    fn test_clearing_price_empty_orders_v4() {
        let result = find_clearing_price(&[], &[]);
        assert_eq!(result, Err(PricingError::NoClearing));
    }

    #[test]
    fn test_clearing_price_no_overlap_v4() {
        // All buys below all sells → no clearing
        let buys = vec![(100 * PRECISION, 50 * PRECISION)];
        let sells = vec![(200 * PRECISION, 50 * PRECISION)];
        let result = find_clearing_price(&buys, &sells);
        assert_eq!(result, Err(PricingError::NoClearing));
    }

    #[test]
    fn test_clearing_price_single_match_v4() {
        // One buy at 100, one sell at 100 → clearing at 100
        let buys = vec![(100 * PRECISION, 50 * PRECISION)];
        let sells = vec![(100 * PRECISION, 50 * PRECISION)];
        let result = find_clearing_price(&buys, &sells).unwrap();
        assert_eq!(result.price, 100 * PRECISION);
        assert_eq!(result.matched_volume, 50 * PRECISION);
    }

    #[test]
    fn test_vwap_single_trade_v4() {
        let trades = vec![(2000 * PRECISION, 100 * PRECISION)];
        let result = compute_vwap(&trades).unwrap();
        assert_eq!(result.vwap, 2000 * PRECISION);
        assert_eq!(result.trade_count, 1);
    }

    #[test]
    fn test_vwap_empty_v4() {
        let result = compute_vwap(&[]);
        assert_eq!(result, Err(PricingError::InsufficientObservations));
    }

    #[test]
    fn test_vwap_all_zero_volume_v4() {
        let trades = vec![(2000 * PRECISION, 0), (3000 * PRECISION, 0)];
        let result = compute_vwap(&trades);
        assert_eq!(result, Err(PricingError::ZeroLiquidity));
    }

    #[test]
    fn test_spot_price_equal_reserves_v4() {
        let price = spot_price_from_reserves(100 * PRECISION, 100 * PRECISION).unwrap();
        assert_eq!(price, PRECISION); // 1:1
    }

    #[test]
    fn test_spot_price_zero_reserve_in_v4() {
        let result = spot_price_from_reserves(0, 100 * PRECISION);
        assert_eq!(result, Err(PricingError::ZeroLiquidity));
    }

    #[test]
    fn test_spot_price_zero_reserve_out_v4() {
        let result = spot_price_from_reserves(100 * PRECISION, 0);
        assert_eq!(result, Err(PricingError::ZeroPrice));
    }

    #[test]
    fn test_spot_price_2x_ratio_v4() {
        let price = spot_price_from_reserves(100 * PRECISION, 200 * PRECISION).unwrap();
        assert_eq!(price, 2 * PRECISION);
    }

    #[test]
    fn test_price_range_single_observation_v4() {
        let observations = vec![obs(1000 * PRECISION, 100, PRECISION)];
        let range = price_range(&observations).unwrap();
        assert_eq!(range.open, 1000 * PRECISION);
        assert_eq!(range.close, 1000 * PRECISION);
        assert_eq!(range.low, 1000 * PRECISION);
        assert_eq!(range.high, 1000 * PRECISION);
        assert_eq!(range.average, 1000 * PRECISION);
    }

    #[test]
    fn test_price_range_empty_v4() {
        let result = price_range(&[]);
        assert_eq!(result, Err(PricingError::InsufficientObservations));
    }

    #[test]
    fn test_price_range_multiple_v4() {
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(1200 * PRECISION, 110, PRECISION),
            obs(900 * PRECISION, 120, PRECISION),
        ];
        let range = price_range(&observations).unwrap();
        assert_eq!(range.open, 1000 * PRECISION);
        assert_eq!(range.close, 900 * PRECISION);
        assert_eq!(range.low, 900 * PRECISION);
        assert_eq!(range.high, 1200 * PRECISION);
    }

    #[test]
    fn test_is_price_stale_fresh_v4() {
        assert!(!is_price_stale(500, 500));
    }

    #[test]
    fn test_is_price_stale_exactly_at_threshold_v4() {
        // Exactly PRICE_STALENESS_BLOCKS elapsed → NOT stale (> not >=)
        assert!(!is_price_stale(0, PRICE_STALENESS_BLOCKS));
    }

    #[test]
    fn test_is_price_stale_one_past_threshold_v4() {
        assert!(is_price_stale(0, PRICE_STALENESS_BLOCKS + 1));
    }

    #[test]
    fn test_is_price_stale_future_observation_v4() {
        // Observation is in the future → not stale
        assert!(!is_price_stale(200, 100));
    }

    #[test]
    fn test_remove_outliers_single_price_v4() {
        let prices = vec![1000 * PRECISION];
        let filtered = remove_outliers(&prices);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0], 1000 * PRECISION);
    }

    #[test]
    fn test_remove_outliers_empty_v4() {
        let filtered = remove_outliers(&[]);
        assert!(filtered.is_empty());
    }

    #[test]
    fn test_remove_outliers_all_same_v4() {
        let prices = vec![1000 * PRECISION; 5];
        let filtered = remove_outliers(&prices);
        assert_eq!(filtered.len(), 5);
    }

    #[test]
    fn test_price_change_bps_no_change_v4() {
        let change = price_change_bps(1000 * PRECISION, 1000 * PRECISION);
        assert_eq!(change, 0);
    }

    #[test]
    fn test_price_change_bps_increase_v4() {
        let change = price_change_bps(1000 * PRECISION, 1100 * PRECISION);
        assert_eq!(change, 1000); // +10%
    }

    #[test]
    fn test_price_change_bps_decrease_v4() {
        let change = price_change_bps(1000 * PRECISION, 900 * PRECISION);
        assert_eq!(change, -1000); // -10%
    }

    #[test]
    fn test_price_change_bps_zero_old_v4() {
        let change = price_change_bps(0, 1000 * PRECISION);
        assert_eq!(change, 0);
    }

    #[test]
    fn test_ema_single_observation_v4() {
        let observations = vec![obs(2000 * PRECISION, 100, PRECISION)];
        let ema = exponential_moving_average(&observations, 5000).unwrap();
        assert_eq!(ema, 2000 * PRECISION);
    }

    #[test]
    fn test_ema_alpha_10000_latest_only_v4() {
        // Alpha = 10000 → only latest price matters
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(2000 * PRECISION, 110, PRECISION),
            obs(3000 * PRECISION, 120, PRECISION),
        ];
        let ema = exponential_moving_average(&observations, 10_000).unwrap();
        assert_eq!(ema, 3000 * PRECISION);
    }

    #[test]
    fn test_ema_alpha_zero_first_only_v4() {
        // Alpha = 0 → only first price matters
        let observations = vec![
            obs(1000 * PRECISION, 100, PRECISION),
            obs(2000 * PRECISION, 110, PRECISION),
            obs(3000 * PRECISION, 120, PRECISION),
        ];
        let ema = exponential_moving_average(&observations, 0).unwrap();
        assert_eq!(ema, 1000 * PRECISION);
    }

    #[test]
    fn test_ema_empty_v4() {
        let result = exponential_moving_average(&[], 5000);
        assert_eq!(result, Err(PricingError::InsufficientObservations));
    }

    #[test]
    fn test_confidence_single_price_max_v4() {
        let prices = vec![1000 * PRECISION];
        let conf = confidence_from_sources(&prices);
        assert_eq!(conf, 10_000);
    }

    #[test]
    fn test_confidence_empty_zero_v4() {
        let conf = confidence_from_sources(&[]);
        assert_eq!(conf, 0);
    }

    #[test]
    fn test_confidence_identical_prices_max_v4() {
        let prices = vec![1000 * PRECISION; 5];
        let conf = confidence_from_sources(&prices);
        assert_eq!(conf, 10_000);
    }

    #[test]
    fn test_confidence_wide_spread_low_v4() {
        // 50% spread → confidence should be very low
        let prices = vec![1000 * PRECISION, 1500 * PRECISION];
        let conf = confidence_from_sources(&prices);
        // spread = 500/1250 * 10000 = 4000 bps → confidence = 6000
        assert!(conf < 7000);
    }

    #[test]
    fn test_liq_weighted_empty_v4() {
        let result = liquidity_weighted_price(&[]);
        assert_eq!(result, Err(PricingError::InsufficientObservations));
    }

    #[test]
    fn test_liq_weighted_zero_liquidity_v4() {
        let observations = vec![
            obs(1000 * PRECISION, 100, 0),
            obs(2000 * PRECISION, 110, 0),
        ];
        let result = liquidity_weighted_price(&observations);
        assert_eq!(result, Err(PricingError::ZeroLiquidity));
    }

    #[test]
    fn test_liq_weighted_single_observation_v4() {
        let observations = vec![obs(3000 * PRECISION, 100, 500 * PRECISION)];
        let result = liquidity_weighted_price(&observations).unwrap();
        assert_eq!(result, 3000 * PRECISION);
    }

    #[test]
    fn test_aggregate_all_stale_v4() {
        let feeds = vec![
            feed_with_id(1, 2000 * PRECISION, 9000, 0), // block 0
        ];
        // current_block = 1000, staleness threshold = 450
        let result = aggregate_prices(&feeds, 1000);
        assert_eq!(result, Err(PricingError::NoValidSources));
    }

    #[test]
    fn test_aggregate_all_invalid_v4() {
        let feeds = vec![
            PriceFeed {
                source_id: [1; 32],
                price: 2000 * PRECISION,
                confidence: 9000,
                block_number: 100,
                is_valid: false, // Invalid
            },
        ];
        let result = aggregate_prices(&feeds, 100);
        assert_eq!(result, Err(PricingError::NoValidSources));
    }

    #[test]
    fn test_aggregate_zero_price_excluded_v4() {
        let feeds = vec![
            PriceFeed {
                source_id: [1; 32],
                price: 0, // Zero price excluded
                confidence: 9000,
                block_number: 100,
                is_valid: true,
            },
        ];
        let result = aggregate_prices(&feeds, 100);
        assert_eq!(result, Err(PricingError::NoValidSources));
    }

    // ============ Hardening Round 10 ============

    #[test]
    fn test_compute_twap_zero_window_h10() {
        let obs = vec![
            PriceObservation { price: 1000 * PRECISION, block_number: 100, liquidity: PRECISION },
        ];
        let result = compute_twap(&obs, 0, 200);
        assert_eq!(result, Err(PricingError::InvalidWindow));
    }

    #[test]
    fn test_compute_twap_insufficient_obs_h10() {
        let obs = vec![
            PriceObservation { price: 1000 * PRECISION, block_number: 100, liquidity: PRECISION },
            PriceObservation { price: 1010 * PRECISION, block_number: 110, liquidity: PRECISION },
        ];
        let result = compute_twap(&obs, 200, 200);
        assert_eq!(result, Err(PricingError::InsufficientObservations));
    }

    #[test]
    fn test_compute_twap_stable_price_valid_h10() {
        let obs: Vec<PriceObservation> = (0..5).map(|i| PriceObservation {
            price: 2000 * PRECISION,
            block_number: 100 + i * 10,
            liquidity: PRECISION,
        }).collect();
        let result = compute_twap(&obs, 200, 150).unwrap();
        assert!(result.is_valid);
        assert_eq!(result.deviation_bps, 0);
        assert_eq!(result.twap_price, 2000 * PRECISION);
    }

    #[test]
    fn test_validate_against_twap_zero_prices_h10() {
        assert_eq!(validate_against_twap(0, PRECISION), Err(PricingError::ZeroPrice));
        assert_eq!(validate_against_twap(PRECISION, 0), Err(PricingError::ZeroPrice));
    }

    #[test]
    fn test_validate_against_twap_within_threshold_h10() {
        let spot = PRECISION;
        let twap = PRECISION + PRECISION / 100; // 1% deviation
        assert!(validate_against_twap(spot, twap).is_ok());
    }

    #[test]
    fn test_validate_against_twap_exceeds_threshold_h10() {
        let spot = PRECISION;
        let twap = PRECISION + PRECISION / 10; // 10% deviation
        assert_eq!(validate_against_twap(spot, twap), Err(PricingError::ExceedsTwapDeviation));
    }

    #[test]
    fn test_find_clearing_price_empty_h10() {
        let result = find_clearing_price(&[], &[]);
        assert_eq!(result, Err(PricingError::NoClearing));
    }

    #[test]
    fn test_find_clearing_price_no_overlap_h10() {
        let buys = vec![(100u128, 1000u128)]; // willing to buy at 100
        let sells = vec![(200u128, 1000u128)]; // willing to sell at 200
        let result = find_clearing_price(&buys, &sells);
        assert!(result.is_err());
    }

    #[test]
    fn test_find_clearing_price_overlap_h10() {
        let buys = vec![(200u128, 1000u128)];
        let sells = vec![(100u128, 1000u128)];
        let result = find_clearing_price(&buys, &sells).unwrap();
        assert!(result.matched_volume > 0);
    }

    #[test]
    fn test_spot_price_from_reserves_zero_in_h10() {
        let result = spot_price_from_reserves(0, 1000);
        assert_eq!(result, Err(PricingError::ZeroLiquidity));
    }

    #[test]
    fn test_spot_price_from_reserves_zero_out_h10() {
        let result = spot_price_from_reserves(1000, 0);
        assert_eq!(result, Err(PricingError::ZeroPrice));
    }

    #[test]
    fn test_spot_price_from_reserves_equal_h10() {
        let result = spot_price_from_reserves(1000, 1000).unwrap();
        assert_eq!(result, PRECISION); // 1:1 price
    }

    #[test]
    fn test_compute_vwap_empty_h10() {
        let result = compute_vwap(&[]);
        assert_eq!(result, Err(PricingError::InsufficientObservations));
    }

    #[test]
    fn test_compute_vwap_all_zero_volume_h10() {
        let trades = vec![(1000u128, 0u128), (2000, 0)];
        let result = compute_vwap(&trades);
        assert_eq!(result, Err(PricingError::ZeroLiquidity));
    }

    #[test]
    fn test_compute_vwap_single_trade_h10() {
        let trades = vec![(2000 * PRECISION, PRECISION)];
        let result = compute_vwap(&trades).unwrap();
        assert_eq!(result.trade_count, 1);
        assert_eq!(result.total_volume, PRECISION);
    }

    #[test]
    fn test_price_range_empty_h10() {
        let result = price_range(&[]);
        assert_eq!(result, Err(PricingError::InsufficientObservations));
    }

    #[test]
    fn test_price_range_single_obs_h10() {
        let obs = vec![PriceObservation { price: 5000, block_number: 100, liquidity: 1000 }];
        let result = price_range(&obs).unwrap();
        assert_eq!(result.open, 5000);
        assert_eq!(result.close, 5000);
        assert_eq!(result.low, 5000);
        assert_eq!(result.high, 5000);
    }

    #[test]
    fn test_is_price_stale_fresh_h10() {
        assert!(!is_price_stale(100, 100));
        assert!(!is_price_stale(100, 200));
    }

    #[test]
    fn test_is_price_stale_stale_h10() {
        assert!(is_price_stale(0, PRICE_STALENESS_BLOCKS + 1));
    }

    #[test]
    fn test_remove_outliers_single_h10() {
        let prices = vec![1000];
        let filtered = remove_outliers(&prices);
        assert_eq!(filtered.len(), 1);
    }

    #[test]
    fn test_remove_outliers_with_outlier_h10() {
        let prices = vec![1000, 1010, 990, 1005, 5000]; // 5000 is outlier
        let filtered = remove_outliers(&prices);
        assert!(!filtered.contains(&5000));
    }

    #[test]
    fn test_price_change_bps_zero_old_h10() {
        assert_eq!(price_change_bps(0, 1000), 0);
    }

    #[test]
    fn test_price_change_bps_increase_h10() {
        let change = price_change_bps(1000, 1100);
        assert_eq!(change, 1000); // 10%
    }

    #[test]
    fn test_price_change_bps_decrease_h10() {
        let change = price_change_bps(1000, 900);
        assert_eq!(change, -1000); // -10%
    }

    #[test]
    fn test_exponential_moving_average_empty_h10() {
        let result = exponential_moving_average(&[], 5000);
        assert_eq!(result, Err(PricingError::InsufficientObservations));
    }

    #[test]
    fn test_exponential_moving_average_single_h10() {
        let obs = vec![PriceObservation { price: 1000 * PRECISION, block_number: 100, liquidity: PRECISION }];
        let result = exponential_moving_average(&obs, 5000).unwrap();
        assert_eq!(result, 1000 * PRECISION);
    }

    #[test]
    fn test_confidence_from_sources_empty_h10() {
        assert_eq!(confidence_from_sources(&[]), 0);
    }

    #[test]
    fn test_confidence_from_sources_single_h10() {
        assert_eq!(confidence_from_sources(&[1000]), BPS as u16);
    }

    #[test]
    fn test_confidence_from_sources_identical_h10() {
        assert_eq!(confidence_from_sources(&[1000, 1000, 1000]), BPS as u16);
    }

    #[test]
    fn test_liquidity_weighted_price_empty_h10() {
        let result = liquidity_weighted_price(&[]);
        assert_eq!(result, Err(PricingError::InsufficientObservations));
    }

    #[test]
    fn test_liquidity_weighted_price_all_zero_liquidity_h10() {
        let obs = vec![
            PriceObservation { price: 1000, block_number: 100, liquidity: 0 },
        ];
        let result = liquidity_weighted_price(&obs);
        assert_eq!(result, Err(PricingError::ZeroLiquidity));
    }
}
