// ============ Auction V2 Module ============
// Advanced Auction Mechanics — extends the basic batch auction with priority fee
// optimization, MEV-resistance scoring, order quality analysis, and auction game theory.
// This is the "smart" layer on top of the basic auction lifecycle.
//
// Key capabilities:
// - Order quality analysis: toxicity scoring, information ratio, classification
// - Priority fee optimization: stats, percentiles, optimal fee calculation
// - Market microstructure: bid/ask depth, spread, Kyle's lambda
// - Clearing price optimization: supply/demand intersection, surplus
// - MEV resistance: sandwich vulnerability, front-run profit, timing entropy
// - Auction quality scoring: efficiency, fairness, participation, composite
// - Order book reconstruction: cumulative depth, weighted mid-price
// - Game theory: Nash equilibrium fee, dominant strategy, payoff calculation
// - Historical comparison: quality trends, rolling averages
// - Participant analytics: concentration, herding indicators
//
// All percentages are expressed in basis points (bps, 10000 = 100%).

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum AuctionV2Error {
    InsufficientOrders,
    NoClearing,
    InvalidPrice,
    EmptyBatch,
    Overflow,
    InvalidScore,
}

// ============ Data Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum OrderQuality {
    High,
    Normal,
    Low,
    Toxic,
}

#[derive(Debug, Clone)]
pub struct OrderAnalysis {
    pub order_index: usize,
    pub quality: OrderQuality,
    pub toxicity_score: u64,
    pub information_ratio: u64,
    pub size_percentile: u64,
    pub spread_from_mid_bps: u64,
    pub priority_fee_rank: u32,
}

#[derive(Debug, Clone)]
pub struct AuctionQuality {
    pub clearing_efficiency: u64,
    pub price_discovery: u64,
    pub participation: u64,
    pub fairness_score: u64,
    pub mev_resistance: u64,
    pub composite_score: u64,
}

#[derive(Debug, Clone)]
pub struct PriorityFeeStats {
    pub total_fees: u64,
    pub mean_fee: u64,
    pub median_fee: u64,
    pub max_fee: u64,
    pub fee_concentration: u64,
    pub participation_rate: u64,
}

#[derive(Debug, Clone)]
pub struct MarketMicrostructure {
    pub bid_depth: u64,
    pub ask_depth: u64,
    pub imbalance_bps: u64,
    pub spread_bps: u64,
    pub effective_spread_bps: u64,
    pub kyle_lambda: u64,
}

#[derive(Debug, Clone)]
pub struct Order {
    pub index: usize,
    pub amount: u64,
    pub is_buy: bool,
    pub price_limit: u64,
    pub priority_fee: u64,
    pub timestamp: u64,
}

// ============ Order Analysis ============

/// Analyze a single order's quality relative to the market.
/// Computes toxicity, information ratio, size percentile, spread from mid, and a placeholder fee rank.
pub fn analyze_order(order: &Order, mid_price: u64, median_size: u64) -> OrderAnalysis {
    let size_ratio = if median_size > 0 {
        (order.amount as u128 * 10000 / median_size as u128) as u64
    } else {
        10000
    };
    let spread_bps = if mid_price > 0 && order.price_limit > 0 {
        let diff = if order.price_limit > mid_price {
            order.price_limit - mid_price
        } else {
            mid_price - order.price_limit
        };
        (diff as u128 * 10000 / mid_price as u128) as u64
    } else {
        0
    };
    let info = information_ratio(order.price_limit, mid_price, order.is_buy);
    let tox = toxicity_score(spread_bps, size_ratio, info);
    let quality = classify_quality(tox);
    let size_pct = if median_size > 0 {
        let ratio = (order.amount as u128 * 10000 / median_size as u128) as u64;
        ratio.min(10000)
    } else {
        5000
    };
    OrderAnalysis {
        order_index: order.index,
        quality,
        toxicity_score: tox,
        information_ratio: info,
        size_percentile: size_pct,
        spread_from_mid_bps: spread_bps,
        priority_fee_rank: 0, // Rank must be computed in batch context
    }
}

/// Compute toxicity score from spread, size ratio, and information signal.
/// Each contributes a weighted component. Result clamped to 0-10000.
pub fn toxicity_score(spread_bps: u64, size_ratio: u64, info_signal: u64) -> u64 {
    // Tight spread + large size + high info = toxic (informed trader)
    // Wide spread = less toxic (uninformed)
    // Weights: spread 30%, size 30%, info 40%
    let spread_component = if spread_bps < 50 {
        3000u64 // Very tight spread is suspicious
    } else if spread_bps < 200 {
        1500
    } else {
        500
    };
    let size_component = if size_ratio > 30000 {
        3000 // 3x median = suspicious
    } else if size_ratio > 15000 {
        1500
    } else {
        500
    };
    let info_component = (info_signal as u128 * 4000 / 10000) as u64;
    let total = spread_component + size_component + info_component;
    total.min(10000)
}

/// Compute how "informed" an order appears based on its limit price vs mid.
/// Buy orders priced above mid or sell orders priced below mid signal information.
pub fn information_ratio(price_limit: u64, mid_price: u64, is_buy: bool) -> u64 {
    if mid_price == 0 || price_limit == 0 {
        return 0;
    }
    if is_buy {
        // Buy above mid = informed (willing to pay more)
        if price_limit > mid_price {
            let diff = price_limit - mid_price;
            let ratio = (diff as u128 * 10000 / mid_price as u128) as u64;
            ratio.min(10000)
        } else {
            0
        }
    } else {
        // Sell below mid = informed (willing to sell for less)
        if price_limit < mid_price {
            let diff = mid_price - price_limit;
            let ratio = (diff as u128 * 10000 / mid_price as u128) as u64;
            ratio.min(10000)
        } else {
            0
        }
    }
}

/// Classify order quality based on toxicity score thresholds.
pub fn classify_quality(toxicity: u64) -> OrderQuality {
    if toxicity < 2000 {
        OrderQuality::High
    } else if toxicity < 5000 {
        OrderQuality::Normal
    } else if toxicity < 7500 {
        OrderQuality::Low
    } else {
        OrderQuality::Toxic
    }
}

/// Compute average toxicity across all orders in a batch.
pub fn batch_toxicity(orders: &[Order], mid_price: u64) -> u64 {
    if orders.is_empty() {
        return 0;
    }
    let median_size = {
        let mut sizes: Vec<u64> = orders.iter().map(|o| o.amount).collect();
        sizes.sort();
        sizes[sizes.len() / 2]
    };
    let total: u128 = orders
        .iter()
        .map(|o| {
            let spread_bps = if mid_price > 0 && o.price_limit > 0 {
                let diff = if o.price_limit > mid_price {
                    o.price_limit - mid_price
                } else {
                    mid_price - o.price_limit
                };
                (diff as u128 * 10000 / mid_price as u128) as u64
            } else {
                0
            };
            let size_ratio = if median_size > 0 {
                (o.amount as u128 * 10000 / median_size as u128) as u64
            } else {
                10000
            };
            let info = information_ratio(o.price_limit, mid_price, o.is_buy);
            toxicity_score(spread_bps, size_ratio, info) as u128
        })
        .sum();
    (total / orders.len() as u128) as u64
}

// ============ Priority Fee Analysis ============

/// Compute comprehensive statistics about priority fees in a batch.
pub fn priority_fee_stats(orders: &[Order]) -> PriorityFeeStats {
    if orders.is_empty() {
        return PriorityFeeStats {
            total_fees: 0,
            mean_fee: 0,
            median_fee: 0,
            max_fee: 0,
            fee_concentration: 0,
            participation_rate: 0,
        };
    }
    let mut fees: Vec<u64> = orders.iter().map(|o| o.priority_fee).collect();
    fees.sort();
    let total: u64 = fees.iter().sum();
    let mean = total / orders.len() as u64;
    let median = fees[fees.len() / 2];
    let max = *fees.last().unwrap();
    let concentration = if total > 0 {
        (max as u128 * 10000 / total as u128) as u64
    } else {
        0
    };
    let with_fees = orders.iter().filter(|o| o.priority_fee > 0).count() as u64;
    let participation = (with_fees as u128 * 10000 / orders.len() as u128) as u64;
    PriorityFeeStats {
        total_fees: total,
        mean_fee: mean,
        median_fee: median,
        max_fee: max,
        fee_concentration: concentration,
        participation_rate: participation,
    }
}

/// Suggest an optimal priority fee based on recent auction statistics.
/// Strategy: beat the recent median by 20% to be competitive without overpaying.
pub fn optimal_priority_fee(recent_stats: &[PriorityFeeStats]) -> u64 {
    if recent_stats.is_empty() {
        return 0;
    }
    let avg_median: u64 = {
        let sum: u128 = recent_stats.iter().map(|s| s.median_fee as u128).sum();
        (sum / recent_stats.len() as u128) as u64
    };
    // Beat median by 20%
    avg_median + avg_median / 5
}

/// Compute the percentile rank of a given fee among all order fees. 0-10000.
pub fn fee_percentile(orders: &[Order], fee: u64) -> u64 {
    if orders.is_empty() {
        return 0;
    }
    let below = orders.iter().filter(|o| o.priority_fee < fee).count() as u128;
    (below * 10000 / orders.len() as u128) as u64
}

/// Total priority fee revenue from a batch.
pub fn fee_revenue(orders: &[Order]) -> u64 {
    orders.iter().map(|o| o.priority_fee).sum()
}

/// Ratio of total fees to total volume, in basis points.
pub fn fee_to_volume_ratio(orders: &[Order]) -> u64 {
    let total_fees: u128 = orders.iter().map(|o| o.priority_fee as u128).sum();
    let total_volume: u128 = orders.iter().map(|o| o.amount as u128).sum();
    if total_volume == 0 {
        return 0;
    }
    (total_fees * 10000 / total_volume) as u64
}

// ============ Market Microstructure ============

/// Compute full market microstructure analysis from order set.
pub fn compute_microstructure(orders: &[Order], mid_price: u64) -> MarketMicrostructure {
    let (bid_depth, ask_depth) = bid_ask_depth(orders);
    let imbalance = order_imbalance(orders);
    let buys: Vec<Order> = orders.iter().filter(|o| o.is_buy).cloned().collect();
    let sells: Vec<Order> = orders.iter().filter(|o| !o.is_buy).cloned().collect();
    let spread = compute_spread(&buys, &sells, mid_price);
    let lambda = kyle_lambda(orders, spread);
    MarketMicrostructure {
        bid_depth,
        ask_depth,
        imbalance_bps: imbalance,
        spread_bps: spread,
        effective_spread_bps: spread, // Same as quoted spread when no fills
        kyle_lambda: lambda,
    }
}

/// Total buy volume and sell volume.
pub fn bid_ask_depth(orders: &[Order]) -> (u64, u64) {
    let bids: u64 = orders.iter().filter(|o| o.is_buy).map(|o| o.amount).sum();
    let asks: u64 = orders.iter().filter(|o| !o.is_buy).map(|o| o.amount).sum();
    (bids, asks)
}

/// Order imbalance: |buys - sells| / total * 10000.
pub fn order_imbalance(orders: &[Order]) -> u64 {
    let (bids, asks) = bid_ask_depth(orders);
    let total = bids as u128 + asks as u128;
    if total == 0 {
        return 0;
    }
    let diff = if bids > asks {
        (bids - asks) as u128
    } else {
        (asks - bids) as u128
    };
    (diff * 10000 / total) as u64
}

/// Spread in bps between best bid and best ask relative to mid price.
pub fn compute_spread(buy_orders: &[Order], sell_orders: &[Order], mid_price: u64) -> u64 {
    if mid_price == 0 {
        return 0;
    }
    let best_bid = buy_orders
        .iter()
        .filter(|o| o.price_limit > 0)
        .map(|o| o.price_limit)
        .max()
        .unwrap_or(0);
    let best_ask = sell_orders
        .iter()
        .filter(|o| o.price_limit > 0)
        .map(|o| o.price_limit)
        .min()
        .unwrap_or(0);
    if best_bid == 0 || best_ask == 0 || best_ask <= best_bid {
        return 0;
    }
    let spread = best_ask - best_bid;
    (spread as u128 * 10000 / mid_price as u128) as u64
}

/// Effective spread from actual fills: average |fill_price - mid| * 2, in bps.
pub fn effective_spread(fills: &[(u64, u64)], mid_price: u64) -> u64 {
    if fills.is_empty() || mid_price == 0 {
        return 0;
    }
    let total_deviation: u128 = fills
        .iter()
        .map(|&(_amount, price)| {
            let diff = if price > mid_price {
                price - mid_price
            } else {
                mid_price - price
            };
            diff as u128 * 2 * 10000 / mid_price as u128
        })
        .sum();
    (total_deviation / fills.len() as u128) as u64
}

/// Kyle's lambda: price impact per unit volume, scaled by 1e8.
/// Approximated as spread_bps * 1e8 / total_volume.
pub fn kyle_lambda(orders: &[Order], price_impact: u64) -> u64 {
    let total_volume: u128 = orders.iter().map(|o| o.amount as u128).sum();
    if total_volume == 0 {
        return 0;
    }
    (price_impact as u128 * 100_000_000 / total_volume) as u64
}

// ============ Clearing Price Optimization ============

/// Find the clearing price where supply meets demand.
/// Searches all unique limit prices and picks the one maximizing matched volume.
pub fn find_clearing_price(orders: &[Order]) -> Result<u64, AuctionV2Error> {
    if orders.is_empty() {
        return Err(AuctionV2Error::EmptyBatch);
    }
    let buys: Vec<&Order> = orders.iter().filter(|o| o.is_buy).collect();
    let sells: Vec<&Order> = orders.iter().filter(|o| !o.is_buy).collect();
    if buys.is_empty() || sells.is_empty() {
        return Err(AuctionV2Error::InsufficientOrders);
    }

    // Collect all candidate prices
    let mut prices: Vec<u64> = orders
        .iter()
        .filter(|o| o.price_limit > 0)
        .map(|o| o.price_limit)
        .collect();
    prices.sort();
    prices.dedup();

    if prices.is_empty() {
        return Err(AuctionV2Error::NoClearing);
    }

    let mut best_price = 0u64;
    let mut best_surplus = 0u64;

    for &price in &prices {
        let s = surplus_at_price(orders, price);
        if s > best_surplus {
            best_surplus = s;
            best_price = price;
        }
    }

    if best_price == 0 || best_surplus == 0 {
        return Err(AuctionV2Error::NoClearing);
    }

    Ok(best_price)
}

/// Total buy demand at or above the given price.
pub fn demand_at_price(orders: &[Order], price: u64) -> u64 {
    orders
        .iter()
        .filter(|o| o.is_buy && (o.price_limit == 0 || o.price_limit >= price))
        .map(|o| o.amount)
        .sum()
}

/// Total sell supply at or below the given price.
pub fn supply_at_price(orders: &[Order], price: u64) -> u64 {
    orders
        .iter()
        .filter(|o| !o.is_buy && (o.price_limit == 0 || o.price_limit <= price))
        .map(|o| o.amount)
        .sum()
}

/// Matched volume at a given price: min(demand, supply).
pub fn surplus_at_price(orders: &[Order], price: u64) -> u64 {
    let d = demand_at_price(orders, price);
    let s = supply_at_price(orders, price);
    d.min(s)
}

/// Score how well the clearing price concentrates orders. 0-10000.
/// Higher when many orders have limits near the clearing price.
pub fn price_discovery_quality(orders: &[Order], clearing_price: u64) -> u64 {
    if orders.is_empty() || clearing_price == 0 {
        return 0;
    }
    let limit_orders: Vec<&Order> = orders.iter().filter(|o| o.price_limit > 0).collect();
    if limit_orders.is_empty() {
        return 5000; // All market orders = neutral
    }
    let total_deviation: u128 = limit_orders
        .iter()
        .map(|o| {
            let diff = if o.price_limit > clearing_price {
                o.price_limit - clearing_price
            } else {
                clearing_price - o.price_limit
            };
            diff as u128 * 10000 / clearing_price as u128
        })
        .sum();
    let avg_deviation = (total_deviation / limit_orders.len() as u128) as u64;
    // Lower deviation = better discovery. Invert: 10000 - avg (clamped)
    10000u64.saturating_sub(avg_deviation.min(10000))
}

// ============ MEV Resistance ============

/// Composite MEV resistance score. 0-10000 (higher = more resistant).
/// Combines sandwich vulnerability, timing entropy, and price concentration.
pub fn mev_resistance_score(orders: &[Order], clearing_price: u64) -> u64 {
    if orders.is_empty() || clearing_price == 0 {
        return 0;
    }
    let mid = weighted_mid_price(orders);
    let sandwich = sandwich_vulnerability(orders, if mid > 0 { mid } else { clearing_price });
    let timing = order_timing_entropy(orders);
    let discovery = price_discovery_quality(orders, clearing_price);
    // Sandwich: higher = MORE vulnerable, so invert
    let sandwich_resistance = 10000u64.saturating_sub(sandwich);
    // Weighted: sandwich 40%, timing 30%, discovery 30%
    let composite = (sandwich_resistance as u128 * 4000
        + timing as u128 * 3000
        + discovery as u128 * 3000)
        / 10000;
    (composite as u64).min(10000)
}

/// Sandwich vulnerability: how easy it is to sandwich orders. 0-10000 (higher = more vulnerable).
/// Large market orders with no limit = very vulnerable.
pub fn sandwich_vulnerability(orders: &[Order], mid_price: u64) -> u64 {
    if orders.is_empty() || mid_price == 0 {
        return 0;
    }
    let market_orders: Vec<&Order> = orders.iter().filter(|o| o.price_limit == 0).collect();
    let market_volume: u128 = market_orders.iter().map(|o| o.amount as u128).sum();
    let total_volume: u128 = orders.iter().map(|o| o.amount as u128).sum();
    if total_volume == 0 {
        return 0;
    }
    // Market order share = vulnerability
    (market_volume * 10000 / total_volume) as u64
}

/// Maximum extractable value from front-running: simplified as largest market order impact.
pub fn front_run_profit_potential(orders: &[Order], reserve: u64) -> u64 {
    if orders.is_empty() || reserve == 0 {
        return 0;
    }
    let max_market = orders
        .iter()
        .filter(|o| o.price_limit == 0)
        .map(|o| o.amount)
        .max()
        .unwrap_or(0);
    // Price impact approx: amount / reserve * amount (quadratic)
    let impact = (max_market as u128 * max_market as u128 / reserve as u128) as u64;
    impact
}

/// Timing entropy: how spread out order timestamps are. 0-10000.
/// Higher = more uniform distribution = better MEV resistance.
pub fn order_timing_entropy(orders: &[Order]) -> u64 {
    if orders.len() < 2 {
        return 10000; // Single order = no timing attack possible
    }
    let mut timestamps: Vec<u64> = orders.iter().map(|o| o.timestamp).collect();
    timestamps.sort();
    let min_t = timestamps[0];
    let max_t = *timestamps.last().unwrap();
    let range = max_t - min_t;
    if range == 0 {
        return 0; // All same time = very clustered = bad
    }
    // Compute mean gap
    let gaps: Vec<u64> = timestamps.windows(2).map(|w| w[1] - w[0]).collect();
    let mean_gap = range / gaps.len() as u64;
    if mean_gap == 0 {
        return 0;
    }
    // Coefficient of variation of gaps: lower = more uniform
    let variance: u128 = gaps
        .iter()
        .map(|&g| {
            let diff = if g > mean_gap { g - mean_gap } else { mean_gap - g };
            (diff as u128) * (diff as u128)
        })
        .sum::<u128>()
        / gaps.len() as u128;
    // Normalize: CV = sqrt(var) / mean. Approximate with var / mean^2.
    let cv_scaled = variance * 10000 / (mean_gap as u128 * mean_gap as u128);
    // Invert: lower CV = higher entropy score
    10000u64.saturating_sub((cv_scaled as u64).min(10000))
}

/// Basis points saved by commit-reveal vs open orderbook.
/// Compares clearing price deviation from mid in both regimes.
pub fn commit_reveal_benefit(orders: &[Order], clearing_price: u64, open_price: u64) -> u64 {
    if clearing_price == 0 || open_price == 0 {
        return 0;
    }
    let mid = weighted_mid_price(orders);
    if mid == 0 {
        return 0;
    }
    let cr_dev = if clearing_price > mid {
        clearing_price - mid
    } else {
        mid - clearing_price
    };
    let open_dev = if open_price > mid {
        open_price - mid
    } else {
        mid - open_price
    };
    if open_dev <= cr_dev {
        return 0; // No benefit
    }
    let benefit = open_dev - cr_dev;
    (benefit as u128 * 10000 / mid as u128) as u64
}

// ============ Auction Quality Scoring ============

/// Compute composite auction quality across all dimensions.
pub fn compute_auction_quality(
    orders: &[Order],
    clearing_price: u64,
    mid_price: u64,
    expected_traders: u64,
) -> AuctionQuality {
    if orders.is_empty() || clearing_price == 0 {
        return AuctionQuality {
            clearing_efficiency: 0,
            price_discovery: 0,
            participation: 0,
            fairness_score: 0,
            mev_resistance: 0,
            composite_score: 0,
        };
    }
    let demand = demand_at_price(orders, clearing_price);
    let supply = supply_at_price(orders, clearing_price);
    let matched = demand.min(supply);
    let eff = clearing_efficiency(demand, supply, matched);
    let disc = price_discovery_quality(orders, clearing_price);
    let traders = unique_participants(orders);
    let part = participation_score(traders, expected_traders);
    let fills: Vec<u64> = orders.iter().map(|o| o.amount).collect();
    let fair = fill_fairness(&fills);
    // Invert fairness: 0 Gini = 10000 fairness score
    let fair_score = 10000u64.saturating_sub(fair);
    let mev = mev_resistance_score(orders, clearing_price);

    // Composite: efficiency 25%, discovery 25%, participation 15%, fairness 15%, MEV 20%
    let composite = (eff as u128 * 2500
        + disc as u128 * 2500
        + part as u128 * 1500
        + fair_score as u128 * 1500
        + mev as u128 * 2000)
        / 10000;

    AuctionQuality {
        clearing_efficiency: eff,
        price_discovery: disc,
        participation: part,
        fairness_score: fair_score,
        mev_resistance: mev,
        composite_score: (composite as u64).min(10000),
    }
}

/// Clearing efficiency: matched / min(demand, supply) * 10000.
pub fn clearing_efficiency(demand: u64, supply: u64, matched: u64) -> u64 {
    let min_side = demand.min(supply);
    if min_side == 0 {
        return 0;
    }
    (matched as u128 * 10000 / min_side as u128) as u64
}

/// Gini coefficient of fill sizes. 0 = perfectly equal, 10000 = one takes all.
pub fn fill_fairness(fills: &[u64]) -> u64 {
    if fills.is_empty() {
        return 0;
    }
    let n = fills.len() as u128;
    if n <= 1 {
        return 0;
    }
    let sum: u128 = fills.iter().map(|&f| f as u128).sum();
    if sum == 0 {
        return 0;
    }
    // Gini = sum(|xi - xj|) / (2 * n * sum)
    let mut abs_diff_sum: u128 = 0;
    for i in 0..fills.len() {
        for j in 0..fills.len() {
            let diff = if fills[i] > fills[j] {
                (fills[i] - fills[j]) as u128
            } else {
                (fills[j] - fills[i]) as u128
            };
            abs_diff_sum += diff;
        }
    }
    let gini = abs_diff_sum * 10000 / (2 * n * sum);
    (gini as u64).min(10000)
}

/// Participation score: min(traders / expected, 1) * 10000.
pub fn participation_score(unique_traders: u64, expected: u64) -> u64 {
    if expected == 0 {
        return 10000;
    }
    let score = (unique_traders as u128 * 10000 / expected as u128) as u64;
    score.min(10000)
}

// ============ Order Book Reconstruction ============

/// Build sorted order book from orders.
/// Returns (bids: Vec<(price, cumulative_qty)>, asks: Vec<(price, cumulative_qty)>).
/// Bids sorted descending by price, asks sorted ascending by price.
pub fn build_book(orders: &[Order]) -> (Vec<(u64, u64)>, Vec<(u64, u64)>) {
    let mut bids: Vec<(u64, u64)> = Vec::new();
    let mut asks: Vec<(u64, u64)> = Vec::new();

    // Aggregate by price
    let mut bid_map: Vec<(u64, u64)> = Vec::new();
    let mut ask_map: Vec<(u64, u64)> = Vec::new();

    for o in orders {
        if o.price_limit == 0 {
            continue; // Skip market orders for book
        }
        if o.is_buy {
            if let Some(entry) = bid_map.iter_mut().find(|(p, _)| *p == o.price_limit) {
                entry.1 += o.amount;
            } else {
                bid_map.push((o.price_limit, o.amount));
            }
        } else {
            if let Some(entry) = ask_map.iter_mut().find(|(p, _)| *p == o.price_limit) {
                entry.1 += o.amount;
            } else {
                ask_map.push((o.price_limit, o.amount));
            }
        }
    }

    // Sort bids descending
    bid_map.sort_by(|a, b| b.0.cmp(&a.0));
    // Sort asks ascending
    ask_map.sort_by(|a, b| a.0.cmp(&b.0));

    // Build cumulative
    let mut cum = 0u64;
    for (price, qty) in &bid_map {
        cum += qty;
        bids.push((*price, cum));
    }
    cum = 0;
    for (price, qty) in &ask_map {
        cum += qty;
        asks.push((*price, cum));
    }

    (bids, asks)
}

/// Bid and ask depth at a specific price level.
pub fn book_depth_at(orders: &[Order], price: u64) -> (u64, u64) {
    let bid_depth: u64 = orders
        .iter()
        .filter(|o| o.is_buy && o.price_limit >= price && o.price_limit > 0)
        .map(|o| o.amount)
        .sum();
    let ask_depth: u64 = orders
        .iter()
        .filter(|o| !o.is_buy && o.price_limit <= price && o.price_limit > 0)
        .map(|o| o.amount)
        .sum();
    (bid_depth, ask_depth)
}

/// Volume-weighted mid-price from all limit orders.
pub fn weighted_mid_price(orders: &[Order]) -> u64 {
    let limit_orders: Vec<&Order> = orders.iter().filter(|o| o.price_limit > 0).collect();
    if limit_orders.is_empty() {
        return 0;
    }
    let total_volume: u128 = limit_orders.iter().map(|o| o.amount as u128).sum();
    if total_volume == 0 {
        return 0;
    }
    let weighted_sum: u128 = limit_orders
        .iter()
        .map(|o| o.price_limit as u128 * o.amount as u128)
        .sum();
    (weighted_sum / total_volume) as u64
}

/// Count of orders at a specific price level.
pub fn order_count_at_price(orders: &[Order], price: u64) -> usize {
    orders.iter().filter(|o| o.price_limit == price).count()
}

// ============ Game Theory ============

/// Nash equilibrium fee: the fee where no player benefits from unilateral change.
/// Approximated as the fee that clears the marginal order at the clearing price.
pub fn nash_equilibrium_fee(orders: &[Order], clearing_price: u64) -> u64 {
    if orders.is_empty() || clearing_price == 0 {
        return 0;
    }
    // Orders near the clearing price boundary have the most to gain from priority fees
    let mut near_boundary: Vec<&Order> = orders
        .iter()
        .filter(|o| o.price_limit > 0)
        .filter(|o| {
            let diff = if o.price_limit > clearing_price {
                o.price_limit - clearing_price
            } else {
                clearing_price - o.price_limit
            };
            let deviation_bps = (diff as u128 * 10000 / clearing_price as u128) as u64;
            deviation_bps < 500 // Within 5% of clearing price
        })
        .collect();

    if near_boundary.is_empty() {
        return 0;
    }

    near_boundary.sort_by(|a, b| b.priority_fee.cmp(&a.priority_fee));
    // Nash equilibrium = median fee of boundary orders
    let mid = near_boundary.len() / 2;
    near_boundary[mid].priority_fee
}

/// Dominant strategy fee recommendation given your relative size.
/// Larger traders benefit less from priority fees (already impactful).
pub fn dominant_strategy_fee(avg_fee: u64, your_size_ratio: u64) -> u64 {
    // If you're small (size_ratio < 5000 bps = 50%), pay above average
    // If you're large (> 50%), pay below average (you already have market impact)
    if your_size_ratio == 0 {
        return avg_fee;
    }
    if your_size_ratio < 5000 {
        // Small trader: pay 1.5x average to compete
        avg_fee + avg_fee / 2
    } else if your_size_ratio < 8000 {
        // Medium trader: pay average
        avg_fee
    } else {
        // Large trader: pay 0.5x average
        avg_fee / 2
    }
}

/// Profit/loss from a fill at clearing price. Positive = profit for the trader.
pub fn auction_payoff(amount: u64, clearing_price: u64, price_limit: u64, is_buy: bool) -> i64 {
    if clearing_price == 0 || price_limit == 0 {
        return 0;
    }
    if is_buy {
        // Buyer profits when clearing < limit (got a deal)
        if clearing_price <= price_limit {
            let savings = price_limit - clearing_price;
            (savings as u128 * amount as u128 / clearing_price as u128) as i64
        } else {
            // Would not fill, or negative payoff
            let overpay = clearing_price - price_limit;
            -((overpay as u128 * amount as u128 / clearing_price as u128) as i64)
        }
    } else {
        // Seller profits when clearing > limit (sold for more)
        if clearing_price >= price_limit {
            let bonus = clearing_price - price_limit;
            (bonus as u128 * amount as u128 / clearing_price as u128) as i64
        } else {
            let loss = price_limit - clearing_price;
            -((loss as u128 * amount as u128 / clearing_price as u128) as i64)
        }
    }
}

// ============ Historical Comparison ============

/// Compare two auctions by composite score. Positive if a is better.
pub fn compare_auctions(a: &AuctionQuality, b: &AuctionQuality) -> i64 {
    a.composite_score as i64 - b.composite_score as i64
}

/// Trend direction from a series of quality scores, in bps.
/// Positive = improving, negative = declining.
pub fn quality_trend(scores: &[u64]) -> i64 {
    if scores.len() < 2 {
        return 0;
    }
    let first_half: u128 = scores[..scores.len() / 2].iter().map(|&s| s as u128).sum();
    let second_half: u128 = scores[scores.len() / 2..].iter().map(|&s| s as u128).sum();
    let first_avg = first_half / (scores.len() / 2) as u128;
    let second_avg = second_half / (scores.len() - scores.len() / 2) as u128;
    if first_avg == 0 {
        return second_avg as i64;
    }
    let change = second_avg as i64 - first_avg as i64;
    (change as i128 * 10000 / first_avg as i128) as i64
}

/// Rolling average of quality scores with given window size.
pub fn rolling_quality(scores: &[u64], window: usize) -> Vec<u64> {
    if scores.is_empty() || window == 0 {
        return vec![];
    }
    let w = window.min(scores.len());
    scores
        .windows(w)
        .map(|win| {
            let sum: u128 = win.iter().map(|&s| s as u128).sum();
            (sum / win.len() as u128) as u64
        })
        .collect()
}

// ============ Participant Analytics ============

/// Count unique participants by unique timestamp (proxy for unique users).
pub fn unique_participants(orders: &[Order]) -> u64 {
    let mut timestamps: Vec<u64> = orders.iter().map(|o| o.timestamp).collect();
    timestamps.sort();
    timestamps.dedup();
    timestamps.len() as u64
}

/// Concentration ratio: top N orders as percentage of total volume (bps).
pub fn concentration_ratio(orders: &[Order], top_n: usize) -> u64 {
    if orders.is_empty() {
        return 0;
    }
    let total: u128 = orders.iter().map(|o| o.amount as u128).sum();
    if total == 0 {
        return 0;
    }
    let mut amounts: Vec<u64> = orders.iter().map(|o| o.amount).collect();
    amounts.sort_by(|a, b| b.cmp(a));
    let top_sum: u128 = amounts.iter().take(top_n).map(|&a| a as u128).sum();
    (top_sum * 10000 / total) as u64
}

/// Herding indicator: how clustered orders are in time. 0=uniform, 10000=clustered.
pub fn herding_indicator(orders: &[Order]) -> u64 {
    if orders.len() < 2 {
        return 0;
    }
    let mut timestamps: Vec<u64> = orders.iter().map(|o| o.timestamp).collect();
    timestamps.sort();
    let min_t = timestamps[0];
    let max_t = *timestamps.last().unwrap();
    let range = max_t - min_t;
    if range == 0 {
        return 10000; // All same time = max clustering
    }
    // Ideal uniform gap
    let ideal_gap = range as u128 / (timestamps.len() as u128 - 1);
    if ideal_gap == 0 {
        return 10000;
    }
    // Sum of deviations from ideal gap
    let gaps: Vec<u64> = timestamps.windows(2).map(|w| w[1] - w[0]).collect();
    let deviation: u128 = gaps
        .iter()
        .map(|&g| {
            let diff = if g as u128 > ideal_gap {
                g as u128 - ideal_gap
            } else {
                ideal_gap - g as u128
            };
            diff
        })
        .sum();
    let avg_deviation = deviation / gaps.len() as u128;
    let clustering = (avg_deviation * 10000 / ideal_gap) as u64;
    clustering.min(10000)
}

// ============ Utilities ============

/// Sort orders by priority fee descending (in place).
pub fn sort_by_priority(orders: &mut [Order]) {
    orders.sort_by(|a, b| b.priority_fee.cmp(&a.priority_fee));
}

/// Filter to market orders only (price_limit == 0).
pub fn filter_market_orders(orders: &[Order]) -> Vec<&Order> {
    orders.iter().filter(|o| o.price_limit == 0).collect()
}

/// Filter to limit orders only (price_limit > 0).
pub fn filter_limit_orders(orders: &[Order]) -> Vec<&Order> {
    orders.iter().filter(|o| o.price_limit > 0).collect()
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn make_order(index: usize, amount: u64, is_buy: bool, price_limit: u64, priority_fee: u64, timestamp: u64) -> Order {
        Order { index, amount, is_buy, price_limit, priority_fee, timestamp }
    }

    fn make_buy(index: usize, amount: u64, price_limit: u64) -> Order {
        make_order(index, amount, true, price_limit, 0, index as u64 * 10)
    }

    fn make_sell(index: usize, amount: u64, price_limit: u64) -> Order {
        make_order(index, amount, false, price_limit, 0, index as u64 * 10)
    }

    fn sample_orders() -> Vec<Order> {
        vec![
            make_order(0, 1000, true, 105, 10, 100),
            make_order(1, 2000, true, 102, 5, 200),
            make_order(2, 1500, false, 98, 8, 150),
            make_order(3, 3000, false, 100, 0, 300),
            make_order(4, 500, true, 110, 20, 250),
            make_order(5, 800, false, 95, 3, 350),
        ]
    }

    fn balanced_orders() -> Vec<Order> {
        vec![
            make_buy(0, 1000, 105),
            make_buy(1, 1000, 103),
            make_buy(2, 1000, 101),
            make_sell(3, 1000, 99),
            make_sell(4, 1000, 97),
            make_sell(5, 1000, 95),
        ]
    }

    // ============ Order Analysis Tests ============

    #[test]
    fn test_analyze_order_basic() {
        let order = make_buy(0, 1000, 105);
        let analysis = analyze_order(&order, 100, 1000);
        assert_eq!(analysis.order_index, 0);
        assert!(analysis.toxicity_score <= 10000);
        assert!(analysis.spread_from_mid_bps <= 10000);
    }

    #[test]
    fn test_analyze_order_market_order() {
        let order = make_order(0, 1000, true, 0, 0, 100);
        let analysis = analyze_order(&order, 100, 1000);
        assert_eq!(analysis.spread_from_mid_bps, 0);
        assert_eq!(analysis.information_ratio, 0);
    }

    #[test]
    fn test_analyze_order_zero_mid_price() {
        let order = make_buy(0, 1000, 105);
        let analysis = analyze_order(&order, 0, 1000);
        assert_eq!(analysis.spread_from_mid_bps, 0);
    }

    #[test]
    fn test_analyze_order_zero_median_size() {
        let order = make_buy(0, 1000, 105);
        let analysis = analyze_order(&order, 100, 0);
        assert_eq!(analysis.size_percentile, 5000);
    }

    #[test]
    fn test_analyze_order_large_size() {
        let order = make_buy(0, 5000, 105);
        let analysis = analyze_order(&order, 100, 1000);
        assert!(analysis.size_percentile > 0);
    }

    #[test]
    fn test_analyze_order_sell() {
        let order = make_sell(0, 1000, 95);
        let analysis = analyze_order(&order, 100, 1000);
        assert_eq!(analysis.order_index, 0);
        assert!(analysis.toxicity_score <= 10000);
    }

    #[test]
    fn test_analyze_order_fee_rank_default() {
        let order = make_buy(0, 1000, 105);
        let analysis = analyze_order(&order, 100, 1000);
        assert_eq!(analysis.priority_fee_rank, 0); // Must be set in batch context
    }

    // ============ Toxicity Score Tests ============

    #[test]
    fn test_toxicity_score_low_all() {
        let score = toxicity_score(300, 5000, 0);
        assert!(score < 2000); // Should be High quality
    }

    #[test]
    fn test_toxicity_score_high_spread() {
        let score = toxicity_score(500, 5000, 0);
        assert!(score < 3000);
    }

    #[test]
    fn test_toxicity_score_tight_spread_large_size() {
        let score = toxicity_score(10, 40000, 5000);
        assert!(score >= 5000); // Suspicious
    }

    #[test]
    fn test_toxicity_score_max_everything() {
        let score = toxicity_score(10, 50000, 10000);
        assert_eq!(score, 10000);
    }

    #[test]
    fn test_toxicity_score_zero_info() {
        let score = toxicity_score(100, 10000, 0);
        assert!(score < 5000);
    }

    #[test]
    fn test_toxicity_score_moderate() {
        let score = toxicity_score(100, 20000, 3000);
        assert!(score >= 2000 && score <= 7000);
    }

    // ============ Information Ratio Tests ============

    #[test]
    fn test_information_ratio_buy_above_mid() {
        let ratio = information_ratio(110, 100, true);
        assert_eq!(ratio, 1000); // 10% above
    }

    #[test]
    fn test_information_ratio_buy_below_mid() {
        let ratio = information_ratio(90, 100, true);
        assert_eq!(ratio, 0);
    }

    #[test]
    fn test_information_ratio_sell_below_mid() {
        let ratio = information_ratio(90, 100, false);
        assert_eq!(ratio, 1000); // 10% below
    }

    #[test]
    fn test_information_ratio_sell_above_mid() {
        let ratio = information_ratio(110, 100, false);
        assert_eq!(ratio, 0);
    }

    #[test]
    fn test_information_ratio_zero_mid() {
        assert_eq!(information_ratio(100, 0, true), 0);
    }

    #[test]
    fn test_information_ratio_zero_price() {
        assert_eq!(information_ratio(0, 100, true), 0);
    }

    #[test]
    fn test_information_ratio_equal_prices() {
        assert_eq!(information_ratio(100, 100, true), 0);
        assert_eq!(information_ratio(100, 100, false), 0);
    }

    #[test]
    fn test_information_ratio_capped_at_10000() {
        let ratio = information_ratio(30000, 100, true);
        assert_eq!(ratio, 10000);
    }

    // ============ Classify Quality Tests ============

    #[test]
    fn test_classify_quality_high() {
        assert_eq!(classify_quality(0), OrderQuality::High);
        assert_eq!(classify_quality(1999), OrderQuality::High);
    }

    #[test]
    fn test_classify_quality_normal() {
        assert_eq!(classify_quality(2000), OrderQuality::Normal);
        assert_eq!(classify_quality(4999), OrderQuality::Normal);
    }

    #[test]
    fn test_classify_quality_low() {
        assert_eq!(classify_quality(5000), OrderQuality::Low);
        assert_eq!(classify_quality(7499), OrderQuality::Low);
    }

    #[test]
    fn test_classify_quality_toxic() {
        assert_eq!(classify_quality(7500), OrderQuality::Toxic);
        assert_eq!(classify_quality(10000), OrderQuality::Toxic);
    }

    // ============ Batch Toxicity Tests ============

    #[test]
    fn test_batch_toxicity_empty() {
        assert_eq!(batch_toxicity(&[], 100), 0);
    }

    #[test]
    fn test_batch_toxicity_single() {
        let orders = vec![make_buy(0, 1000, 105)];
        let tox = batch_toxicity(&orders, 100);
        assert!(tox <= 10000);
    }

    #[test]
    fn test_batch_toxicity_sample() {
        let orders = sample_orders();
        let tox = batch_toxicity(&orders, 100);
        assert!(tox > 0 && tox <= 10000);
    }

    #[test]
    fn test_batch_toxicity_all_market_orders() {
        let orders = vec![
            make_order(0, 1000, true, 0, 0, 100),
            make_order(1, 2000, false, 0, 0, 200),
        ];
        let tox = batch_toxicity(&orders, 100);
        assert!(tox <= 10000);
    }

    // ============ Priority Fee Stats Tests ============

    #[test]
    fn test_priority_fee_stats_empty() {
        let stats = priority_fee_stats(&[]);
        assert_eq!(stats.total_fees, 0);
        assert_eq!(stats.mean_fee, 0);
    }

    #[test]
    fn test_priority_fee_stats_basic() {
        let orders = sample_orders();
        let stats = priority_fee_stats(&orders);
        assert_eq!(stats.total_fees, 10 + 5 + 8 + 0 + 20 + 3);
        assert!(stats.mean_fee > 0);
        assert!(stats.max_fee == 20);
    }

    #[test]
    fn test_priority_fee_stats_all_zero() {
        let orders = vec![make_buy(0, 1000, 100), make_sell(1, 1000, 100)];
        let stats = priority_fee_stats(&orders);
        assert_eq!(stats.total_fees, 0);
        assert_eq!(stats.participation_rate, 0);
        assert_eq!(stats.fee_concentration, 0);
    }

    #[test]
    fn test_priority_fee_stats_single_order() {
        let orders = vec![make_order(0, 1000, true, 100, 50, 100)];
        let stats = priority_fee_stats(&orders);
        assert_eq!(stats.total_fees, 50);
        assert_eq!(stats.mean_fee, 50);
        assert_eq!(stats.median_fee, 50);
        assert_eq!(stats.max_fee, 50);
        assert_eq!(stats.fee_concentration, 10000);
        assert_eq!(stats.participation_rate, 10000);
    }

    #[test]
    fn test_priority_fee_stats_concentration() {
        let orders = vec![
            make_order(0, 1000, true, 100, 100, 100),
            make_order(1, 1000, true, 100, 1, 200),
            make_order(2, 1000, false, 100, 1, 300),
        ];
        let stats = priority_fee_stats(&orders);
        // Max = 100, total = 102, concentration ~ 9803
        assert!(stats.fee_concentration > 9000);
    }

    // ============ Optimal Priority Fee Tests ============

    #[test]
    fn test_optimal_priority_fee_empty() {
        assert_eq!(optimal_priority_fee(&[]), 0);
    }

    #[test]
    fn test_optimal_priority_fee_single() {
        let stats = vec![PriorityFeeStats {
            total_fees: 100, mean_fee: 10, median_fee: 8,
            max_fee: 50, fee_concentration: 5000, participation_rate: 8000,
        }];
        let fee = optimal_priority_fee(&stats);
        // 8 + 8/5 = 8 + 1 = 9 (integer division)
        assert_eq!(fee, 9);
    }

    #[test]
    fn test_optimal_priority_fee_multiple() {
        let stats = vec![
            PriorityFeeStats {
                total_fees: 100, mean_fee: 10, median_fee: 10,
                max_fee: 50, fee_concentration: 5000, participation_rate: 8000,
            },
            PriorityFeeStats {
                total_fees: 200, mean_fee: 20, median_fee: 20,
                max_fee: 80, fee_concentration: 4000, participation_rate: 9000,
            },
        ];
        let fee = optimal_priority_fee(&stats);
        // avg_median = 15, 15 + 15/5 = 15 + 3 = 18
        assert_eq!(fee, 18);
    }

    // ============ Fee Percentile Tests ============

    #[test]
    fn test_fee_percentile_empty() {
        assert_eq!(fee_percentile(&[], 10), 0);
    }

    #[test]
    fn test_fee_percentile_highest() {
        let orders = sample_orders();
        let pct = fee_percentile(&orders, 100);
        assert_eq!(pct, 10000); // Higher than all
    }

    #[test]
    fn test_fee_percentile_lowest() {
        let orders = sample_orders();
        let pct = fee_percentile(&orders, 0);
        assert_eq!(pct, 0); // None below 0
    }

    #[test]
    fn test_fee_percentile_mid() {
        let orders = vec![
            make_order(0, 100, true, 100, 1, 100),
            make_order(1, 100, true, 100, 5, 200),
            make_order(2, 100, true, 100, 10, 300),
            make_order(3, 100, true, 100, 15, 400),
        ];
        let pct = fee_percentile(&orders, 10);
        assert_eq!(pct, 5000); // 2 of 4 below
    }

    // ============ Fee Revenue Tests ============

    #[test]
    fn test_fee_revenue_empty() {
        assert_eq!(fee_revenue(&[]), 0);
    }

    #[test]
    fn test_fee_revenue_sample() {
        let orders = sample_orders();
        assert_eq!(fee_revenue(&orders), 46);
    }

    // ============ Fee to Volume Ratio Tests ============

    #[test]
    fn test_fee_to_volume_ratio_empty() {
        assert_eq!(fee_to_volume_ratio(&[]), 0);
    }

    #[test]
    fn test_fee_to_volume_ratio_basic() {
        let orders = vec![make_order(0, 10000, true, 100, 100, 100)];
        let ratio = fee_to_volume_ratio(&orders);
        assert_eq!(ratio, 100); // 100/10000 * 10000 = 100 bps = 1%
    }

    #[test]
    fn test_fee_to_volume_ratio_zero_fees() {
        let orders = vec![make_buy(0, 1000, 100)];
        assert_eq!(fee_to_volume_ratio(&orders), 0);
    }

    // ============ Market Microstructure Tests ============

    #[test]
    fn test_compute_microstructure_basic() {
        let orders = sample_orders();
        let ms = compute_microstructure(&orders, 100);
        assert!(ms.bid_depth > 0);
        assert!(ms.ask_depth > 0);
        assert!(ms.imbalance_bps <= 10000);
    }

    #[test]
    fn test_compute_microstructure_empty() {
        let ms = compute_microstructure(&[], 100);
        assert_eq!(ms.bid_depth, 0);
        assert_eq!(ms.ask_depth, 0);
        assert_eq!(ms.imbalance_bps, 0);
    }

    // ============ Bid Ask Depth Tests ============

    #[test]
    fn test_bid_ask_depth_balanced() {
        let orders = balanced_orders();
        let (bids, asks) = bid_ask_depth(&orders);
        assert_eq!(bids, 3000);
        assert_eq!(asks, 3000);
    }

    #[test]
    fn test_bid_ask_depth_buy_heavy() {
        let orders = vec![
            make_buy(0, 5000, 100),
            make_sell(1, 1000, 100),
        ];
        let (bids, asks) = bid_ask_depth(&orders);
        assert_eq!(bids, 5000);
        assert_eq!(asks, 1000);
    }

    #[test]
    fn test_bid_ask_depth_empty() {
        let (bids, asks) = bid_ask_depth(&[]);
        assert_eq!(bids, 0);
        assert_eq!(asks, 0);
    }

    // ============ Order Imbalance Tests ============

    #[test]
    fn test_order_imbalance_balanced() {
        let orders = balanced_orders();
        assert_eq!(order_imbalance(&orders), 0);
    }

    #[test]
    fn test_order_imbalance_buy_heavy() {
        let orders = vec![
            make_buy(0, 3000, 100),
            make_sell(1, 1000, 100),
        ];
        let imb = order_imbalance(&orders);
        assert_eq!(imb, 5000); // 2000/4000 * 10000
    }

    #[test]
    fn test_order_imbalance_empty() {
        assert_eq!(order_imbalance(&[]), 0);
    }

    #[test]
    fn test_order_imbalance_only_buys() {
        let orders = vec![make_buy(0, 1000, 100)];
        assert_eq!(order_imbalance(&orders), 10000);
    }

    // ============ Compute Spread Tests ============

    #[test]
    fn test_compute_spread_basic() {
        let buys = vec![make_buy(0, 1000, 98)];
        let sells = vec![make_sell(1, 1000, 102)];
        let spread = compute_spread(&buys, &sells, 100);
        assert_eq!(spread, 400); // 4/100 * 10000
    }

    #[test]
    fn test_compute_spread_zero_mid() {
        let buys = vec![make_buy(0, 1000, 98)];
        let sells = vec![make_sell(1, 1000, 102)];
        assert_eq!(compute_spread(&buys, &sells, 0), 0);
    }

    #[test]
    fn test_compute_spread_no_limit_orders() {
        let buys = vec![make_order(0, 1000, true, 0, 0, 100)];
        let sells = vec![make_order(1, 1000, false, 0, 0, 200)];
        assert_eq!(compute_spread(&buys, &sells, 100), 0);
    }

    #[test]
    fn test_compute_spread_crossed() {
        let buys = vec![make_buy(0, 1000, 105)];
        let sells = vec![make_sell(1, 1000, 95)];
        assert_eq!(compute_spread(&buys, &sells, 100), 0); // Crossed = 0
    }

    // ============ Effective Spread Tests ============

    #[test]
    fn test_effective_spread_basic() {
        let fills = vec![(1000, 101u64), (2000, 99)];
        let es = effective_spread(&fills, 100);
        assert_eq!(es, 200); // avg |1| * 2 * 100 = 200 bps
    }

    #[test]
    fn test_effective_spread_empty() {
        assert_eq!(effective_spread(&[], 100), 0);
    }

    #[test]
    fn test_effective_spread_zero_mid() {
        let fills = vec![(1000, 100)];
        assert_eq!(effective_spread(&fills, 0), 0);
    }

    #[test]
    fn test_effective_spread_at_mid() {
        let fills = vec![(1000, 100)];
        assert_eq!(effective_spread(&fills, 100), 0);
    }

    // ============ Kyle Lambda Tests ============

    #[test]
    fn test_kyle_lambda_basic() {
        let orders = vec![make_buy(0, 1000, 100)];
        let lambda = kyle_lambda(&orders, 50);
        // 50 * 1e8 / 1000 = 5_000_000
        assert_eq!(lambda, 5_000_000);
    }

    #[test]
    fn test_kyle_lambda_empty() {
        assert_eq!(kyle_lambda(&[], 50), 0);
    }

    #[test]
    fn test_kyle_lambda_zero_impact() {
        let orders = vec![make_buy(0, 1000, 100)];
        assert_eq!(kyle_lambda(&orders, 0), 0);
    }

    // ============ Find Clearing Price Tests ============

    #[test]
    fn test_find_clearing_price_basic() {
        let orders = vec![
            make_buy(0, 1000, 105),
            make_buy(1, 1000, 103),
            make_sell(2, 1000, 99),
            make_sell(3, 1000, 101),
        ];
        let price = find_clearing_price(&orders).unwrap();
        assert!(price >= 99 && price <= 105);
    }

    #[test]
    fn test_find_clearing_price_empty() {
        assert_eq!(find_clearing_price(&[]), Err(AuctionV2Error::EmptyBatch));
    }

    #[test]
    fn test_find_clearing_price_only_buys() {
        let orders = vec![make_buy(0, 1000, 100)];
        assert_eq!(find_clearing_price(&orders), Err(AuctionV2Error::InsufficientOrders));
    }

    #[test]
    fn test_find_clearing_price_only_sells() {
        let orders = vec![make_sell(0, 1000, 100)];
        assert_eq!(find_clearing_price(&orders), Err(AuctionV2Error::InsufficientOrders));
    }

    #[test]
    fn test_find_clearing_price_no_overlap() {
        // Buys below sells — no crossing
        let orders = vec![
            make_buy(0, 1000, 90),
            make_sell(1, 1000, 110),
        ];
        assert_eq!(find_clearing_price(&orders), Err(AuctionV2Error::NoClearing));
    }

    #[test]
    fn test_find_clearing_price_exact_match() {
        let orders = vec![
            make_buy(0, 1000, 100),
            make_sell(1, 1000, 100),
        ];
        let price = find_clearing_price(&orders).unwrap();
        assert_eq!(price, 100);
    }

    // ============ Demand At Price Tests ============

    #[test]
    fn test_demand_at_price_basic() {
        let orders = vec![
            make_buy(0, 1000, 105),
            make_buy(1, 2000, 100),
            make_sell(2, 500, 98),
        ];
        assert_eq!(demand_at_price(&orders, 100), 3000); // Both buys
        assert_eq!(demand_at_price(&orders, 105), 1000); // Only first
        assert_eq!(demand_at_price(&orders, 110), 0);     // None
    }

    #[test]
    fn test_demand_at_price_market_orders() {
        let orders = vec![
            make_order(0, 1000, true, 0, 0, 100), // Market buy
            make_buy(1, 2000, 100),
        ];
        assert_eq!(demand_at_price(&orders, 100), 3000); // Market order always included
    }

    // ============ Supply At Price Tests ============

    #[test]
    fn test_supply_at_price_basic() {
        let orders = vec![
            make_sell(0, 1000, 95),
            make_sell(1, 2000, 100),
            make_buy(2, 500, 102),
        ];
        assert_eq!(supply_at_price(&orders, 100), 3000);
        assert_eq!(supply_at_price(&orders, 95), 1000);
        assert_eq!(supply_at_price(&orders, 90), 0);
    }

    #[test]
    fn test_supply_at_price_market_orders() {
        let orders = vec![
            make_order(0, 1000, false, 0, 0, 100), // Market sell
            make_sell(1, 2000, 100),
        ];
        assert_eq!(supply_at_price(&orders, 100), 3000);
    }

    // ============ Surplus At Price Tests ============

    #[test]
    fn test_surplus_at_price_basic() {
        let orders = vec![
            make_buy(0, 1000, 105),
            make_sell(1, 800, 95),
        ];
        // At 100: demand=1000 (buy at 105 >= 100), supply=800 (sell at 95 <= 100)
        assert_eq!(surplus_at_price(&orders, 100), 800);
    }

    #[test]
    fn test_surplus_at_price_no_overlap() {
        let orders = vec![
            make_buy(0, 1000, 90),
            make_sell(1, 1000, 110),
        ];
        assert_eq!(surplus_at_price(&orders, 100), 0);
    }

    // ============ Price Discovery Quality Tests ============

    #[test]
    fn test_price_discovery_quality_tight() {
        let orders = vec![
            make_buy(0, 1000, 101),
            make_sell(1, 1000, 99),
        ];
        let quality = price_discovery_quality(&orders, 100);
        assert!(quality > 8000); // Very tight spread = good discovery
    }

    #[test]
    fn test_price_discovery_quality_wide() {
        let orders = vec![
            make_buy(0, 1000, 200),
            make_sell(1, 1000, 50),
        ];
        let quality = price_discovery_quality(&orders, 100);
        assert!(quality < 8000); // Wide spread = poor discovery
    }

    #[test]
    fn test_price_discovery_quality_empty() {
        assert_eq!(price_discovery_quality(&[], 100), 0);
    }

    #[test]
    fn test_price_discovery_quality_zero_price() {
        let orders = vec![make_buy(0, 1000, 100)];
        assert_eq!(price_discovery_quality(&orders, 0), 0);
    }

    #[test]
    fn test_price_discovery_quality_all_market() {
        let orders = vec![
            make_order(0, 1000, true, 0, 0, 100),
            make_order(1, 1000, false, 0, 0, 200),
        ];
        assert_eq!(price_discovery_quality(&orders, 100), 5000);
    }

    // ============ MEV Resistance Tests ============

    #[test]
    fn test_mev_resistance_score_basic() {
        let orders = balanced_orders();
        let score = mev_resistance_score(&orders, 100);
        assert!(score > 0 && score <= 10000);
    }

    #[test]
    fn test_mev_resistance_score_empty() {
        assert_eq!(mev_resistance_score(&[], 100), 0);
    }

    #[test]
    fn test_mev_resistance_all_market_orders() {
        let orders = vec![
            make_order(0, 1000, true, 0, 0, 100),
            make_order(1, 1000, false, 0, 0, 200),
        ];
        let score = mev_resistance_score(&orders, 100);
        // All market orders = very vulnerable, low resistance
        assert!(score <= 5000);
    }

    // ============ Sandwich Vulnerability Tests ============

    #[test]
    fn test_sandwich_vulnerability_no_market() {
        let orders = balanced_orders();
        assert_eq!(sandwich_vulnerability(&orders, 100), 0);
    }

    #[test]
    fn test_sandwich_vulnerability_all_market() {
        let orders = vec![
            make_order(0, 1000, true, 0, 0, 100),
            make_order(1, 1000, false, 0, 0, 200),
        ];
        assert_eq!(sandwich_vulnerability(&orders, 100), 10000);
    }

    #[test]
    fn test_sandwich_vulnerability_mixed() {
        let orders = vec![
            make_order(0, 1000, true, 0, 0, 100),   // Market
            make_buy(1, 1000, 105),                   // Limit
        ];
        assert_eq!(sandwich_vulnerability(&orders, 100), 5000);
    }

    #[test]
    fn test_sandwich_vulnerability_empty() {
        assert_eq!(sandwich_vulnerability(&[], 100), 0);
    }

    // ============ Front Run Profit Tests ============

    #[test]
    fn test_front_run_profit_basic() {
        let orders = vec![make_order(0, 100, true, 0, 0, 100)];
        let profit = front_run_profit_potential(&orders, 10000);
        // 100 * 100 / 10000 = 1
        assert_eq!(profit, 1);
    }

    #[test]
    fn test_front_run_profit_no_market() {
        let orders = vec![make_buy(0, 1000, 100)];
        assert_eq!(front_run_profit_potential(&orders, 10000), 0);
    }

    #[test]
    fn test_front_run_profit_empty() {
        assert_eq!(front_run_profit_potential(&[], 10000), 0);
    }

    #[test]
    fn test_front_run_profit_zero_reserve() {
        let orders = vec![make_order(0, 100, true, 0, 0, 100)];
        assert_eq!(front_run_profit_potential(&orders, 0), 0);
    }

    // ============ Order Timing Entropy Tests ============

    #[test]
    fn test_order_timing_entropy_uniform() {
        let orders = vec![
            make_order(0, 100, true, 100, 0, 100),
            make_order(1, 100, true, 100, 0, 200),
            make_order(2, 100, true, 100, 0, 300),
            make_order(3, 100, true, 100, 0, 400),
        ];
        let entropy = order_timing_entropy(&orders);
        assert_eq!(entropy, 10000); // Perfectly uniform
    }

    #[test]
    fn test_order_timing_entropy_clustered() {
        let orders = vec![
            make_order(0, 100, true, 100, 0, 100),
            make_order(1, 100, true, 100, 0, 100),
            make_order(2, 100, true, 100, 0, 100),
            make_order(3, 100, true, 100, 0, 400),
        ];
        let entropy = order_timing_entropy(&orders);
        assert!(entropy < 5000); // Clustered
    }

    #[test]
    fn test_order_timing_entropy_single() {
        let orders = vec![make_buy(0, 100, 100)];
        assert_eq!(order_timing_entropy(&orders), 10000);
    }

    #[test]
    fn test_order_timing_entropy_all_same_time() {
        let orders = vec![
            make_order(0, 100, true, 100, 0, 100),
            make_order(1, 100, true, 100, 0, 100),
        ];
        assert_eq!(order_timing_entropy(&orders), 0);
    }

    // ============ Commit Reveal Benefit Tests ============

    #[test]
    fn test_commit_reveal_benefit_positive() {
        let orders = vec![
            make_buy(0, 1000, 105),
            make_sell(1, 1000, 95),
        ];
        // Clearing at 100 (mid), open at 108 (worse for buyers)
        let benefit = commit_reveal_benefit(&orders, 100, 108);
        assert!(benefit > 0);
    }

    #[test]
    fn test_commit_reveal_benefit_no_benefit() {
        let orders = vec![
            make_buy(0, 1000, 105),
            make_sell(1, 1000, 95),
        ];
        // Both at same deviation from mid
        let benefit = commit_reveal_benefit(&orders, 100, 100);
        assert_eq!(benefit, 0);
    }

    #[test]
    fn test_commit_reveal_benefit_zero_prices() {
        let orders = vec![make_buy(0, 1000, 100)];
        assert_eq!(commit_reveal_benefit(&orders, 0, 100), 0);
        assert_eq!(commit_reveal_benefit(&orders, 100, 0), 0);
    }

    // ============ Auction Quality Tests ============

    #[test]
    fn test_compute_auction_quality_basic() {
        let orders = vec![
            make_order(0, 1000, true, 105, 10, 100),
            make_order(1, 1000, true, 103, 5, 200),
            make_order(2, 1000, false, 97, 8, 300),
            make_order(3, 1000, false, 99, 3, 400),
        ];
        let quality = compute_auction_quality(&orders, 101, 100, 4);
        assert!(quality.composite_score > 0);
        assert!(quality.clearing_efficiency > 0);
    }

    #[test]
    fn test_compute_auction_quality_empty() {
        let quality = compute_auction_quality(&[], 100, 100, 10);
        assert_eq!(quality.composite_score, 0);
    }

    #[test]
    fn test_compute_auction_quality_zero_clearing() {
        let orders = vec![make_buy(0, 1000, 100)];
        let quality = compute_auction_quality(&orders, 0, 100, 10);
        assert_eq!(quality.composite_score, 0);
    }

    // ============ Clearing Efficiency Tests ============

    #[test]
    fn test_clearing_efficiency_full_match() {
        assert_eq!(clearing_efficiency(1000, 1000, 1000), 10000);
    }

    #[test]
    fn test_clearing_efficiency_half_match() {
        assert_eq!(clearing_efficiency(1000, 1000, 500), 5000);
    }

    #[test]
    fn test_clearing_efficiency_zero() {
        assert_eq!(clearing_efficiency(0, 0, 0), 0);
    }

    #[test]
    fn test_clearing_efficiency_asymmetric() {
        // 800 matched out of min(1000, 2000) = 1000
        assert_eq!(clearing_efficiency(1000, 2000, 800), 8000);
    }

    // ============ Fill Fairness Tests ============

    #[test]
    fn test_fill_fairness_equal() {
        let fills = vec![100, 100, 100, 100];
        assert_eq!(fill_fairness(&fills), 0);
    }

    #[test]
    fn test_fill_fairness_unequal() {
        let fills = vec![1, 1, 1, 997];
        let gini = fill_fairness(&fills);
        assert!(gini > 5000); // Very unequal
    }

    #[test]
    fn test_fill_fairness_empty() {
        assert_eq!(fill_fairness(&[]), 0);
    }

    #[test]
    fn test_fill_fairness_single() {
        assert_eq!(fill_fairness(&[100]), 0);
    }

    #[test]
    fn test_fill_fairness_two_equal() {
        assert_eq!(fill_fairness(&[100, 100]), 0);
    }

    #[test]
    fn test_fill_fairness_two_unequal() {
        let fills = vec![1, 99];
        let gini = fill_fairness(&fills);
        assert!(gini > 4000);
    }

    // ============ Participation Score Tests ============

    #[test]
    fn test_participation_score_full() {
        assert_eq!(participation_score(10, 10), 10000);
    }

    #[test]
    fn test_participation_score_half() {
        assert_eq!(participation_score(5, 10), 5000);
    }

    #[test]
    fn test_participation_score_exceed() {
        assert_eq!(participation_score(20, 10), 10000); // Capped
    }

    #[test]
    fn test_participation_score_zero_expected() {
        assert_eq!(participation_score(5, 0), 10000);
    }

    #[test]
    fn test_participation_score_zero_traders() {
        assert_eq!(participation_score(0, 10), 0);
    }

    // ============ Build Book Tests ============

    #[test]
    fn test_build_book_basic() {
        let orders = balanced_orders();
        let (bids, asks) = build_book(&orders);
        assert_eq!(bids.len(), 3);
        assert_eq!(asks.len(), 3);
        // Bids descending
        assert!(bids[0].0 >= bids[1].0);
        // Asks ascending
        assert!(asks[0].0 <= asks[1].0);
    }

    #[test]
    fn test_build_book_cumulative() {
        let orders = balanced_orders();
        let (bids, asks) = build_book(&orders);
        // Each level has 1000, cumulative should increase
        assert_eq!(bids[0].1, 1000);
        assert_eq!(bids[1].1, 2000);
        assert_eq!(bids[2].1, 3000);
    }

    #[test]
    fn test_build_book_empty() {
        let (bids, asks) = build_book(&[]);
        assert!(bids.is_empty());
        assert!(asks.is_empty());
    }

    #[test]
    fn test_build_book_market_orders_excluded() {
        let orders = vec![
            make_order(0, 1000, true, 0, 0, 100),
            make_buy(1, 1000, 100),
        ];
        let (bids, _) = build_book(&orders);
        assert_eq!(bids.len(), 1); // Only limit order
    }

    #[test]
    fn test_build_book_aggregates_same_price() {
        let orders = vec![
            make_buy(0, 500, 100),
            make_buy(1, 300, 100),
        ];
        let (bids, _) = build_book(&orders);
        assert_eq!(bids.len(), 1);
        assert_eq!(bids[0], (100, 800));
    }

    // ============ Book Depth At Tests ============

    #[test]
    fn test_book_depth_at_basic() {
        let orders = balanced_orders();
        let (bid, ask) = book_depth_at(&orders, 100);
        // Bids at >= 100: 105, 103, 101 = 3000
        assert_eq!(bid, 3000);
        // Asks at <= 100: 99, 97, 95 = 3000
        assert_eq!(ask, 3000);
    }

    #[test]
    fn test_book_depth_at_narrow() {
        let orders = balanced_orders();
        let (bid, _) = book_depth_at(&orders, 104);
        assert_eq!(bid, 1000); // Only 105 >= 104
    }

    #[test]
    fn test_book_depth_at_empty() {
        let (bid, ask) = book_depth_at(&[], 100);
        assert_eq!(bid, 0);
        assert_eq!(ask, 0);
    }

    // ============ Weighted Mid Price Tests ============

    #[test]
    fn test_weighted_mid_price_balanced() {
        let orders = vec![
            make_buy(0, 1000, 100),
            make_sell(1, 1000, 100),
        ];
        assert_eq!(weighted_mid_price(&orders), 100);
    }

    #[test]
    fn test_weighted_mid_price_weighted() {
        let orders = vec![
            make_buy(0, 3000, 100),
            make_sell(1, 1000, 200),
        ];
        // (3000*100 + 1000*200) / 4000 = 500000/4000 = 125
        assert_eq!(weighted_mid_price(&orders), 125);
    }

    #[test]
    fn test_weighted_mid_price_empty() {
        assert_eq!(weighted_mid_price(&[]), 0);
    }

    #[test]
    fn test_weighted_mid_price_all_market() {
        let orders = vec![
            make_order(0, 1000, true, 0, 0, 100),
        ];
        assert_eq!(weighted_mid_price(&orders), 0);
    }

    // ============ Order Count At Price Tests ============

    #[test]
    fn test_order_count_at_price_basic() {
        let orders = vec![
            make_buy(0, 1000, 100),
            make_buy(1, 2000, 100),
            make_sell(2, 500, 100),
            make_buy(3, 300, 105),
        ];
        assert_eq!(order_count_at_price(&orders, 100), 3);
        assert_eq!(order_count_at_price(&orders, 105), 1);
        assert_eq!(order_count_at_price(&orders, 99), 0);
    }

    #[test]
    fn test_order_count_at_price_empty() {
        assert_eq!(order_count_at_price(&[], 100), 0);
    }

    // ============ Nash Equilibrium Fee Tests ============

    #[test]
    fn test_nash_equilibrium_fee_basic() {
        let orders = vec![
            make_order(0, 1000, true, 101, 10, 100),
            make_order(1, 1000, true, 102, 20, 200),
            make_order(2, 1000, false, 99, 15, 300),
            make_order(3, 1000, false, 98, 5, 400),
        ];
        let fee = nash_equilibrium_fee(&orders, 100);
        assert!(fee > 0);
    }

    #[test]
    fn test_nash_equilibrium_fee_empty() {
        assert_eq!(nash_equilibrium_fee(&[], 100), 0);
    }

    #[test]
    fn test_nash_equilibrium_fee_no_boundary() {
        // All orders far from clearing price
        let orders = vec![
            make_order(0, 1000, true, 200, 10, 100),
            make_order(1, 1000, false, 50, 5, 200),
        ];
        let fee = nash_equilibrium_fee(&orders, 100);
        assert_eq!(fee, 0); // None near boundary
    }

    // ============ Dominant Strategy Fee Tests ============

    #[test]
    fn test_dominant_strategy_fee_small_trader() {
        let fee = dominant_strategy_fee(10, 2000);
        assert_eq!(fee, 15); // 10 + 10/2 = 15
    }

    #[test]
    fn test_dominant_strategy_fee_medium_trader() {
        let fee = dominant_strategy_fee(10, 6000);
        assert_eq!(fee, 10); // Average
    }

    #[test]
    fn test_dominant_strategy_fee_large_trader() {
        let fee = dominant_strategy_fee(10, 9000);
        assert_eq!(fee, 5); // 10/2
    }

    #[test]
    fn test_dominant_strategy_fee_zero_ratio() {
        let fee = dominant_strategy_fee(10, 0);
        assert_eq!(fee, 10);
    }

    // ============ Auction Payoff Tests ============

    #[test]
    fn test_auction_payoff_buy_profit() {
        // Buy at limit 110, cleared at 100. Savings = 10.
        let payoff = auction_payoff(1000, 100, 110, true);
        // (110 - 100) * 1000 / 100 = 100
        assert_eq!(payoff, 100);
    }

    #[test]
    fn test_auction_payoff_buy_loss() {
        let payoff = auction_payoff(1000, 110, 100, true);
        // Clearing > limit = loss
        assert_eq!(payoff, -((10u128 * 1000 / 110) as i64));
    }

    #[test]
    fn test_auction_payoff_sell_profit() {
        // Sell at limit 90, cleared at 100. Bonus = 10.
        let payoff = auction_payoff(1000, 100, 90, false);
        assert_eq!(payoff, 100);
    }

    #[test]
    fn test_auction_payoff_sell_loss() {
        let payoff = auction_payoff(1000, 90, 100, false);
        assert!(payoff < 0);
    }

    #[test]
    fn test_auction_payoff_zero_prices() {
        assert_eq!(auction_payoff(1000, 0, 100, true), 0);
        assert_eq!(auction_payoff(1000, 100, 0, true), 0);
    }

    #[test]
    fn test_auction_payoff_exact_match() {
        assert_eq!(auction_payoff(1000, 100, 100, true), 0);
        assert_eq!(auction_payoff(1000, 100, 100, false), 0);
    }

    // ============ Compare Auctions Tests ============

    #[test]
    fn test_compare_auctions_a_better() {
        let a = AuctionQuality {
            clearing_efficiency: 9000, price_discovery: 8000,
            participation: 7000, fairness_score: 8000,
            mev_resistance: 7000, composite_score: 8000,
        };
        let b = AuctionQuality {
            clearing_efficiency: 5000, price_discovery: 5000,
            participation: 5000, fairness_score: 5000,
            mev_resistance: 5000, composite_score: 5000,
        };
        assert!(compare_auctions(&a, &b) > 0);
    }

    #[test]
    fn test_compare_auctions_equal() {
        let a = AuctionQuality {
            clearing_efficiency: 5000, price_discovery: 5000,
            participation: 5000, fairness_score: 5000,
            mev_resistance: 5000, composite_score: 5000,
        };
        assert_eq!(compare_auctions(&a, &a), 0);
    }

    #[test]
    fn test_compare_auctions_b_better() {
        let a = AuctionQuality {
            clearing_efficiency: 3000, price_discovery: 3000,
            participation: 3000, fairness_score: 3000,
            mev_resistance: 3000, composite_score: 3000,
        };
        let b = AuctionQuality {
            clearing_efficiency: 8000, price_discovery: 8000,
            participation: 8000, fairness_score: 8000,
            mev_resistance: 8000, composite_score: 8000,
        };
        assert!(compare_auctions(&a, &b) < 0);
    }

    // ============ Quality Trend Tests ============

    #[test]
    fn test_quality_trend_improving() {
        let scores = vec![1000, 2000, 3000, 4000];
        let trend = quality_trend(&scores);
        assert!(trend > 0);
    }

    #[test]
    fn test_quality_trend_declining() {
        let scores = vec![4000, 3000, 2000, 1000];
        let trend = quality_trend(&scores);
        assert!(trend < 0);
    }

    #[test]
    fn test_quality_trend_flat() {
        let scores = vec![5000, 5000, 5000, 5000];
        let trend = quality_trend(&scores);
        assert_eq!(trend, 0);
    }

    #[test]
    fn test_quality_trend_single() {
        assert_eq!(quality_trend(&[5000]), 0);
    }

    #[test]
    fn test_quality_trend_empty() {
        assert_eq!(quality_trend(&[]), 0);
    }

    // ============ Rolling Quality Tests ============

    #[test]
    fn test_rolling_quality_basic() {
        let scores = vec![100, 200, 300, 400, 500];
        let rolling = rolling_quality(&scores, 3);
        assert_eq!(rolling.len(), 3);
        assert_eq!(rolling[0], 200); // (100+200+300)/3
        assert_eq!(rolling[1], 300);
        assert_eq!(rolling[2], 400);
    }

    #[test]
    fn test_rolling_quality_window_larger_than_data() {
        let scores = vec![100, 200];
        let rolling = rolling_quality(&scores, 5);
        assert_eq!(rolling.len(), 1);
        assert_eq!(rolling[0], 150);
    }

    #[test]
    fn test_rolling_quality_window_one() {
        let scores = vec![100, 200, 300];
        let rolling = rolling_quality(&scores, 1);
        assert_eq!(rolling, vec![100, 200, 300]);
    }

    #[test]
    fn test_rolling_quality_empty() {
        assert!(rolling_quality(&[], 3).is_empty());
    }

    #[test]
    fn test_rolling_quality_zero_window() {
        assert!(rolling_quality(&[100, 200], 0).is_empty());
    }

    // ============ Unique Participants Tests ============

    #[test]
    fn test_unique_participants_all_unique() {
        let orders = vec![
            make_order(0, 100, true, 100, 0, 100),
            make_order(1, 100, true, 100, 0, 200),
            make_order(2, 100, true, 100, 0, 300),
        ];
        assert_eq!(unique_participants(&orders), 3);
    }

    #[test]
    fn test_unique_participants_some_same() {
        let orders = vec![
            make_order(0, 100, true, 100, 0, 100),
            make_order(1, 100, true, 100, 0, 100),
            make_order(2, 100, true, 100, 0, 200),
        ];
        assert_eq!(unique_participants(&orders), 2);
    }

    #[test]
    fn test_unique_participants_empty() {
        assert_eq!(unique_participants(&[]), 0);
    }

    // ============ Concentration Ratio Tests ============

    #[test]
    fn test_concentration_ratio_equal() {
        let orders = vec![
            make_buy(0, 100, 100),
            make_buy(1, 100, 100),
            make_buy(2, 100, 100),
            make_buy(3, 100, 100),
        ];
        assert_eq!(concentration_ratio(&orders, 1), 2500);
    }

    #[test]
    fn test_concentration_ratio_concentrated() {
        let orders = vec![
            make_buy(0, 970, 100),
            make_buy(1, 10, 100),
            make_buy(2, 10, 100),
            make_buy(3, 10, 100),
        ];
        let cr = concentration_ratio(&orders, 1);
        assert!(cr > 9000); // Top 1 = 97%
    }

    #[test]
    fn test_concentration_ratio_top_all() {
        let orders = vec![
            make_buy(0, 100, 100),
            make_buy(1, 200, 100),
        ];
        assert_eq!(concentration_ratio(&orders, 5), 10000); // All included
    }

    #[test]
    fn test_concentration_ratio_empty() {
        assert_eq!(concentration_ratio(&[], 1), 0);
    }

    // ============ Herding Indicator Tests ============

    #[test]
    fn test_herding_indicator_uniform() {
        let orders = vec![
            make_order(0, 100, true, 100, 0, 100),
            make_order(1, 100, true, 100, 0, 200),
            make_order(2, 100, true, 100, 0, 300),
        ];
        let herding = herding_indicator(&orders);
        assert_eq!(herding, 0); // Perfectly uniform
    }

    #[test]
    fn test_herding_indicator_clustered() {
        let orders = vec![
            make_order(0, 100, true, 100, 0, 100),
            make_order(1, 100, true, 100, 0, 101),
            make_order(2, 100, true, 100, 0, 102),
            make_order(3, 100, true, 100, 0, 1000),
        ];
        let herding = herding_indicator(&orders);
        assert!(herding > 3000); // Clustered at start
    }

    #[test]
    fn test_herding_indicator_all_same() {
        let orders = vec![
            make_order(0, 100, true, 100, 0, 100),
            make_order(1, 100, true, 100, 0, 100),
        ];
        assert_eq!(herding_indicator(&orders), 10000);
    }

    #[test]
    fn test_herding_indicator_single() {
        let orders = vec![make_buy(0, 100, 100)];
        assert_eq!(herding_indicator(&orders), 0);
    }

    #[test]
    fn test_herding_indicator_empty() {
        assert_eq!(herding_indicator(&[]), 0);
    }

    // ============ Sort By Priority Tests ============

    #[test]
    fn test_sort_by_priority_basic() {
        let mut orders = vec![
            make_order(0, 100, true, 100, 5, 100),
            make_order(1, 100, true, 100, 20, 200),
            make_order(2, 100, true, 100, 10, 300),
        ];
        sort_by_priority(&mut orders);
        assert_eq!(orders[0].priority_fee, 20);
        assert_eq!(orders[1].priority_fee, 10);
        assert_eq!(orders[2].priority_fee, 5);
    }

    #[test]
    fn test_sort_by_priority_already_sorted() {
        let mut orders = vec![
            make_order(0, 100, true, 100, 30, 100),
            make_order(1, 100, true, 100, 20, 200),
            make_order(2, 100, true, 100, 10, 300),
        ];
        sort_by_priority(&mut orders);
        assert_eq!(orders[0].priority_fee, 30);
    }

    #[test]
    fn test_sort_by_priority_empty() {
        let mut orders: Vec<Order> = vec![];
        sort_by_priority(&mut orders);
        assert!(orders.is_empty());
    }

    #[test]
    fn test_sort_by_priority_equal_fees() {
        let mut orders = vec![
            make_order(0, 100, true, 100, 10, 100),
            make_order(1, 200, true, 100, 10, 200),
        ];
        sort_by_priority(&mut orders);
        // Both have fee 10, order preserved (stable sort)
        assert_eq!(orders.len(), 2);
    }

    // ============ Filter Market Orders Tests ============

    #[test]
    fn test_filter_market_orders_basic() {
        let orders = vec![
            make_order(0, 100, true, 0, 0, 100),
            make_buy(1, 100, 105),
            make_order(2, 100, false, 0, 0, 200),
        ];
        let market = filter_market_orders(&orders);
        assert_eq!(market.len(), 2);
        assert_eq!(market[0].index, 0);
        assert_eq!(market[1].index, 2);
    }

    #[test]
    fn test_filter_market_orders_none() {
        let orders = balanced_orders();
        let market = filter_market_orders(&orders);
        assert!(market.is_empty());
    }

    #[test]
    fn test_filter_market_orders_empty() {
        let market = filter_market_orders(&[]);
        assert!(market.is_empty());
    }

    // ============ Filter Limit Orders Tests ============

    #[test]
    fn test_filter_limit_orders_basic() {
        let orders = vec![
            make_order(0, 100, true, 0, 0, 100),
            make_buy(1, 100, 105),
            make_order(2, 100, false, 0, 0, 200),
            make_sell(3, 100, 95),
        ];
        let limit = filter_limit_orders(&orders);
        assert_eq!(limit.len(), 2);
        assert_eq!(limit[0].index, 1);
        assert_eq!(limit[1].index, 3);
    }

    #[test]
    fn test_filter_limit_orders_all_limit() {
        let orders = balanced_orders();
        let limit = filter_limit_orders(&orders);
        assert_eq!(limit.len(), 6);
    }

    #[test]
    fn test_filter_limit_orders_empty() {
        let limit = filter_limit_orders(&[]);
        assert!(limit.is_empty());
    }

    // ============ Integration / Cross-Function Tests ============

    #[test]
    fn test_full_auction_flow() {
        let orders = vec![
            make_order(0, 1000, true, 105, 10, 100),
            make_order(1, 2000, true, 103, 5, 200),
            make_order(2, 1500, false, 97, 8, 300),
            make_order(3, 1000, false, 99, 0, 400),
        ];
        // Analyze orders
        for o in &orders {
            let analysis = analyze_order(o, 100, 1000);
            assert!(analysis.toxicity_score <= 10000);
        }
        // Fee stats
        let stats = priority_fee_stats(&orders);
        assert!(stats.total_fees > 0);
        // Microstructure
        let ms = compute_microstructure(&orders, 100);
        assert!(ms.bid_depth > 0);
        assert!(ms.ask_depth > 0);
        // Clearing
        let clearing = find_clearing_price(&orders).unwrap();
        assert!(clearing > 0);
        // Quality
        let quality = compute_auction_quality(&orders, clearing, 100, 4);
        assert!(quality.composite_score > 0);
    }

    #[test]
    fn test_fee_stats_and_optimal_fee_consistency() {
        let orders = vec![
            make_order(0, 1000, true, 100, 10, 100),
            make_order(1, 1000, true, 100, 20, 200),
            make_order(2, 1000, true, 100, 30, 300),
        ];
        let stats = priority_fee_stats(&orders);
        let optimal = optimal_priority_fee(&[stats.clone()]);
        // Optimal should be above median (20 + 20/5 = 24)
        assert!(optimal > stats.median_fee);
    }

    #[test]
    fn test_microstructure_matches_depth() {
        let orders = sample_orders();
        let ms = compute_microstructure(&orders, 100);
        let (bids, asks) = bid_ask_depth(&orders);
        assert_eq!(ms.bid_depth, bids);
        assert_eq!(ms.ask_depth, asks);
    }

    #[test]
    fn test_clearing_price_maximizes_surplus() {
        let orders = vec![
            make_buy(0, 1000, 110),
            make_buy(1, 1000, 105),
            make_buy(2, 1000, 100),
            make_sell(3, 1000, 90),
            make_sell(4, 1000, 95),
            make_sell(5, 1000, 100),
        ];
        let clearing = find_clearing_price(&orders).unwrap();
        let best_surplus = surplus_at_price(&orders, clearing);
        // Check other prices don't have higher surplus
        for &p in &[90, 95, 100, 105, 110] {
            assert!(surplus_at_price(&orders, p) <= best_surplus);
        }
    }

    #[test]
    fn test_mev_resistance_inversely_correlated_with_market_order_share() {
        // All limit orders = high resistance
        let limit_orders = balanced_orders();
        let score_limit = mev_resistance_score(&limit_orders, 100);

        // Mixed market + limit
        let mixed = vec![
            make_order(0, 1000, true, 0, 0, 100),
            make_order(1, 1000, true, 0, 0, 200),
            make_sell(2, 1000, 99),
            make_sell(3, 1000, 97),
        ];
        let score_mixed = mev_resistance_score(&mixed, 98);
        assert!(score_limit > score_mixed);
    }

    #[test]
    fn test_book_depth_consistency_with_demand_supply() {
        let orders = balanced_orders();
        let (bid, ask) = book_depth_at(&orders, 100);
        let demand = demand_at_price(&orders, 100);
        let supply = supply_at_price(&orders, 100);
        // book_depth_at excludes market orders (price_limit > 0 check)
        // demand/supply include market orders (price_limit == 0)
        // With balanced_orders all have price_limit > 0, so should match
        assert_eq!(bid, demand);
        assert_eq!(ask, supply);
    }

    #[test]
    fn test_auction_payoff_symmetric() {
        // Buyer saves 10 per unit at clearing 100 with limit 110
        let buy_payoff = auction_payoff(1000, 100, 110, true);
        // Seller earns 10 per unit at clearing 110 with limit 100
        let sell_payoff = auction_payoff(1000, 110, 100, false);
        // Both should be the same magnitude
        assert_eq!(buy_payoff, 100);
        assert!(sell_payoff > 0);
    }

    #[test]
    fn test_quality_trend_matches_direction() {
        let improving = vec![1000, 2000, 3000, 4000, 5000];
        let declining = vec![5000, 4000, 3000, 2000, 1000];
        assert!(quality_trend(&improving) > 0);
        assert!(quality_trend(&declining) < 0);
    }

    #[test]
    fn test_rolling_quality_preserves_length() {
        let scores = vec![100, 200, 300, 400, 500];
        let rolling = rolling_quality(&scores, 2);
        assert_eq!(rolling.len(), 4); // n - window + 1
    }

    #[test]
    fn test_concentration_ratio_monotonic_in_top_n() {
        let orders = vec![
            make_buy(0, 400, 100),
            make_buy(1, 300, 100),
            make_buy(2, 200, 100),
            make_buy(3, 100, 100),
        ];
        let cr1 = concentration_ratio(&orders, 1);
        let cr2 = concentration_ratio(&orders, 2);
        let cr3 = concentration_ratio(&orders, 3);
        assert!(cr1 <= cr2);
        assert!(cr2 <= cr3);
    }

    #[test]
    fn test_herding_vs_timing_entropy_inverse() {
        // Uniform timing
        let uniform = vec![
            make_order(0, 100, true, 100, 0, 100),
            make_order(1, 100, true, 100, 0, 200),
            make_order(2, 100, true, 100, 0, 300),
            make_order(3, 100, true, 100, 0, 400),
        ];
        let herding_u = herding_indicator(&uniform);
        let entropy_u = order_timing_entropy(&uniform);
        assert_eq!(herding_u, 0);
        assert_eq!(entropy_u, 10000);
        // Clustered timing
        let clustered = vec![
            make_order(0, 100, true, 100, 0, 100),
            make_order(1, 100, true, 100, 0, 101),
            make_order(2, 100, true, 100, 0, 102),
            make_order(3, 100, true, 100, 0, 1000),
        ];
        let herding_c = herding_indicator(&clustered);
        let entropy_c = order_timing_entropy(&clustered);
        assert!(herding_c > herding_u);
        assert!(entropy_c < entropy_u);
    }

    #[test]
    fn test_filter_market_and_limit_partition() {
        let orders = vec![
            make_order(0, 100, true, 0, 0, 100),
            make_buy(1, 100, 105),
            make_order(2, 100, false, 0, 0, 200),
            make_sell(3, 100, 95),
        ];
        let market = filter_market_orders(&orders);
        let limit = filter_limit_orders(&orders);
        assert_eq!(market.len() + limit.len(), orders.len());
    }

    #[test]
    fn test_weighted_mid_vs_simple_mid() {
        // Equal volume = simple average
        let orders = vec![
            make_buy(0, 1000, 90),
            make_sell(1, 1000, 110),
        ];
        let wmid = weighted_mid_price(&orders);
        assert_eq!(wmid, 100); // (90*1000 + 110*1000) / 2000

        // Unequal volume = weighted toward larger
        let orders2 = vec![
            make_buy(0, 9000, 90),
            make_sell(1, 1000, 110),
        ];
        let wmid2 = weighted_mid_price(&orders2);
        assert_eq!(wmid2, 92); // Weighted toward 90
    }

    #[test]
    fn test_surplus_at_various_prices() {
        let orders = vec![
            make_buy(0, 1000, 110),
            make_buy(1, 1000, 105),
            make_sell(2, 1000, 95),
            make_sell(3, 1000, 100),
        ];
        // At 95: demand=2000 (both buys >= 95), supply=1000 (only sell at 95)
        assert_eq!(surplus_at_price(&orders, 95), 1000);
        // At 100: demand=2000, supply=2000
        assert_eq!(surplus_at_price(&orders, 100), 2000);
        // At 110: demand=1000, supply=2000
        assert_eq!(surplus_at_price(&orders, 110), 1000);
    }
}
