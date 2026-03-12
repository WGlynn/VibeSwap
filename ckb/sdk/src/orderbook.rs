// ============ Orderbook SDK — Limit Order Book Analysis & Management ============
// Off-chain order book analysis, price level aggregation, and order management
// helpers for VibeSwap's batch auction system.
//
// While VibeSwap uses commit-reveal batch auctions (not a traditional CLOB),
// this module provides:
//   1. build_snapshot()         → aggregate orders into price levels
//   2. match_orders()           → price-time priority matching
//   3. simulate_market_order()  → simulate filling against the book
//   4. book_depth()             → depth and imbalance metrics
//   5. vwap()                   → volume-weighted average price
//   6. price_impact()           → market impact estimation in bps
//   7. cancel_order()           → remove order by ID
//   8. sort_orders_price_time() → price-time priority sorting

use vibeswap_math::PRECISION;
use vibeswap_math::mul_div;

// ============ Constants ============

/// Maximum number of price levels per side
pub const MAX_PRICE_LEVELS: usize = 100;

/// Maximum number of orders at a single price level
pub const MAX_ORDERS_PER_LEVEL: usize = 256;

/// Minimum order amount (must be at least 1)
pub const MIN_ORDER_AMOUNT: u128 = 1;

/// Maximum spread in basis points before book is considered illiquid (50%)
pub const MAX_SPREAD_BPS: u16 = 5000;

/// Basis point denominator
const BPS_DENOM: u128 = 10_000;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OrderbookError {
    /// No orders in the book
    EmptyBook,
    /// Price is zero or invalid
    InvalidPrice,
    /// Amount is zero or below minimum
    InvalidAmount,
    /// Order with given ID not found
    OrderNotFound(u64),
    /// Order with this ID already exists
    DuplicateOrder(u64),
    /// Too many orders at a single price level
    PriceLevelFull(u128),
    /// Too many price levels in the book
    BookFull,
    /// Not enough liquidity to fill the order
    InsufficientDepth { requested: u128, available: u128 },
}

// ============ Core Types ============

/// Order side: bid (buy) or ask (sell)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Bid,
    Ask,
}

/// A single limit order in the book
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Order {
    /// Unique order identifier
    pub order_id: u64,
    /// Owner's public key hash or address
    pub owner: [u8; 32],
    /// Bid or Ask
    pub side: Side,
    /// Limit price (PRECISION scale, e.g., 1e18 = 1.0)
    pub price: u128,
    /// Order amount in base units
    pub amount: u128,
    /// Timestamp for time priority (lower = earlier)
    pub timestamp: u64,
    /// Amount already filled
    pub filled: u128,
}

impl Order {
    /// Returns the remaining unfilled amount
    pub fn remaining(&self) -> u128 {
        self.amount.saturating_sub(self.filled)
    }
}

/// Aggregated price level (all orders at the same price)
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PriceLevel {
    /// The price at this level (PRECISION scale)
    pub price: u128,
    /// Total amount across all orders at this level
    pub total_amount: u128,
    /// Number of orders at this level
    pub order_count: u32,
    /// Side of the book
    pub side: Side,
}

/// A snapshot of the entire order book
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BookSnapshot {
    /// Bid levels sorted by price descending (best bid first)
    pub bids: Vec<PriceLevel>,
    /// Ask levels sorted by price ascending (best ask first)
    pub asks: Vec<PriceLevel>,
    /// Best (highest) bid price
    pub best_bid: Option<u128>,
    /// Best (lowest) ask price
    pub best_ask: Option<u128>,
    /// Spread (best_ask - best_bid), None if either side is empty
    pub spread: Option<u128>,
    /// Spread in basis points
    pub spread_bps: Option<u16>,
    /// Midpoint price between best bid and best ask
    pub midpoint: Option<u128>,
}

/// Result of matching two orders
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MatchResult {
    /// ID of the resting (maker) order
    pub maker_id: u64,
    /// ID of the incoming (taker) order
    pub taker_id: u64,
    /// Execution price (maker's price)
    pub price: u128,
    /// Amount filled
    pub amount: u128,
    /// Side of the taker order
    pub side: Side,
}

/// Depth metrics for the order book
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BookDepth {
    /// Total bid-side depth (sum of all bid amounts)
    pub bid_depth: u128,
    /// Total ask-side depth (sum of all ask amounts)
    pub ask_depth: u128,
    /// Total depth (bid + ask)
    pub total_depth: u128,
    /// Imbalance in signed basis points (positive = bid heavy, negative = ask heavy)
    pub imbalance_bps: i32,
    /// Total number of price levels across both sides
    pub levels: u32,
}

/// Result of simulating a market order fill
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OrderFill {
    /// ID of the order being simulated (0 for anonymous simulation)
    pub order_id: u64,
    /// Total amount filled
    pub filled_amount: u128,
    /// Remaining amount unfilled
    pub remaining: u128,
    /// Volume-weighted average execution price (PRECISION scale)
    pub avg_price: u128,
    /// Total cost in quote currency (PRECISION scale)
    pub total_cost: u128,
}

/// VWAP calculation result
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VWAPResult {
    /// Volume-weighted average price (PRECISION scale)
    pub vwap: u128,
    /// Total volume consumed
    pub total_volume: u128,
    /// Number of price levels consumed
    pub levels_consumed: u32,
}

// ============ Core Functions ============

/// Build an order book snapshot from a list of orders.
///
/// Aggregates orders into price levels, computes best bid/ask, spread,
/// and midpoint. Bids are sorted descending, asks ascending.
pub fn build_snapshot(orders: &[Order]) -> BookSnapshot {
    if orders.is_empty() {
        return BookSnapshot {
            bids: Vec::new(),
            asks: Vec::new(),
            best_bid: None,
            best_ask: None,
            spread: None,
            spread_bps: None,
            midpoint: None,
        };
    }

    // Separate bids and asks, only consider unfilled amounts
    let mut bid_levels: Vec<(u128, u128, u32)> = Vec::new(); // (price, total_amount, count)
    let mut ask_levels: Vec<(u128, u128, u32)> = Vec::new();

    for order in orders {
        let remaining = order.remaining();
        if remaining == 0 {
            continue;
        }

        let levels = match order.side {
            Side::Bid => &mut bid_levels,
            Side::Ask => &mut ask_levels,
        };

        if let Some(level) = levels.iter_mut().find(|(p, _, _)| *p == order.price) {
            level.1 = level.1.saturating_add(remaining);
            level.2 += 1;
        } else {
            levels.push((order.price, remaining, 1));
        }
    }

    // Sort bids descending by price (best bid first)
    bid_levels.sort_by(|a, b| b.0.cmp(&a.0));
    // Sort asks ascending by price (best ask first)
    ask_levels.sort_by(|a, b| a.0.cmp(&b.0));

    let bids: Vec<PriceLevel> = bid_levels
        .iter()
        .map(|(price, total_amount, count)| PriceLevel {
            price: *price,
            total_amount: *total_amount,
            order_count: *count,
            side: Side::Bid,
        })
        .collect();

    let asks: Vec<PriceLevel> = ask_levels
        .iter()
        .map(|(price, total_amount, count)| PriceLevel {
            price: *price,
            total_amount: *total_amount,
            order_count: *count,
            side: Side::Ask,
        })
        .collect();

    let bb = bids.first().map(|l| l.price);
    let ba = asks.first().map(|l| l.price);

    let (spread, spread_bps_val, mid) = match (bb, ba) {
        (Some(bid), Some(ask)) if ask >= bid => {
            let s = ask - bid;
            let sbps = spread_bps(bid, ask);
            let m = midpoint(bid, ask);
            (Some(s), Some(sbps), Some(m))
        }
        (Some(bid), Some(ask)) => {
            // Crossed book (bid > ask) — spread is 0
            let m = midpoint(bid, ask);
            (Some(0), Some(0), Some(m))
        }
        _ => (None, None, None),
    };

    BookSnapshot {
        bids,
        asks,
        best_bid: bb,
        best_ask: ba,
        spread,
        spread_bps: spread_bps_val,
        midpoint: mid,
    }
}

/// Match bids and asks using price-time priority.
///
/// Returns a vector of match results. Matches occur when bid price >= ask price.
/// Execution happens at the maker (resting) order's price.
/// Orders are matched in price-time priority: best price first, then earliest timestamp.
pub fn match_orders(bids: &[Order], asks: &[Order]) -> Vec<MatchResult> {
    if bids.is_empty() || asks.is_empty() {
        return Vec::new();
    }

    // Clone and sort for matching
    let mut sorted_bids: Vec<Order> = bids.to_vec();
    let mut sorted_asks: Vec<Order> = asks.to_vec();
    sort_orders_price_time(&mut sorted_bids, Side::Bid);
    sort_orders_price_time(&mut sorted_asks, Side::Ask);

    let mut results = Vec::new();
    let mut bid_idx = 0;
    let mut ask_idx = 0;

    // Track remaining amounts for each order during matching
    let mut bid_remaining: Vec<u128> = sorted_bids.iter().map(|o| o.remaining()).collect();
    let mut ask_remaining: Vec<u128> = sorted_asks.iter().map(|o| o.remaining()).collect();

    while bid_idx < sorted_bids.len() && ask_idx < sorted_asks.len() {
        let bid = &sorted_bids[bid_idx];
        let ask = &sorted_asks[ask_idx];

        // No match if bid price < ask price
        if bid.price < ask.price {
            break;
        }

        let br = bid_remaining[bid_idx];
        let ar = ask_remaining[ask_idx];

        if br == 0 {
            bid_idx += 1;
            continue;
        }
        if ar == 0 {
            ask_idx += 1;
            continue;
        }

        // Match at the maker's price (the resting order).
        // For a crossing book, use the ask's price (the earlier resting order convention).
        let match_price = ask.price;
        let match_amount = br.min(ar);

        results.push(MatchResult {
            maker_id: ask.order_id,
            taker_id: bid.order_id,
            price: match_price,
            amount: match_amount,
            side: Side::Bid,
        });

        bid_remaining[bid_idx] -= match_amount;
        ask_remaining[ask_idx] -= match_amount;

        if bid_remaining[bid_idx] == 0 {
            bid_idx += 1;
        }
        if ask_remaining[ask_idx] == 0 {
            ask_idx += 1;
        }
    }

    results
}

/// Simulate filling a market order against the book snapshot.
///
/// For a buy (Bid), walks up the ask side consuming liquidity.
/// For a sell (Ask), walks down the bid side consuming liquidity.
/// Returns fill details including average price and total cost.
pub fn simulate_market_order(
    book: &BookSnapshot,
    side: Side,
    amount: u128,
) -> Result<OrderFill, OrderbookError> {
    if amount == 0 {
        return Err(OrderbookError::InvalidAmount);
    }

    let levels = match side {
        Side::Bid => &book.asks, // Buyer consumes ask side
        Side::Ask => &book.bids, // Seller consumes bid side
    };

    if levels.is_empty() {
        return Err(OrderbookError::EmptyBook);
    }

    let mut filled = 0u128;
    let mut total_cost = 0u128;
    let mut remaining = amount;

    for level in levels {
        if remaining == 0 {
            break;
        }

        let fill_at_level = remaining.min(level.total_amount);
        // cost = fill_amount * price / PRECISION (in quote terms)
        // But we keep everything in PRECISION scale: cost = fill * price
        let cost_at_level = mul_div(fill_at_level, level.price, PRECISION);
        total_cost = total_cost.saturating_add(cost_at_level);
        filled = filled.saturating_add(fill_at_level);
        remaining = remaining.saturating_sub(fill_at_level);
    }

    if filled == 0 {
        return Err(OrderbookError::EmptyBook);
    }

    let avg_price = if filled > 0 {
        mul_div(total_cost, PRECISION, filled)
    } else {
        0
    };

    if remaining > 0 {
        return Err(OrderbookError::InsufficientDepth {
            requested: amount,
            available: filled,
        });
    }

    Ok(OrderFill {
        order_id: 0,
        filled_amount: filled,
        remaining,
        avg_price,
        total_cost,
    })
}

/// Calculate depth metrics for the order book.
pub fn book_depth(book: &BookSnapshot) -> BookDepth {
    let bid_depth: u128 = book.bids.iter().map(|l| l.total_amount).sum();
    let ask_depth: u128 = book.asks.iter().map(|l| l.total_amount).sum();
    let total_depth = bid_depth.saturating_add(ask_depth);
    let levels = (book.bids.len() + book.asks.len()) as u32;

    let imbalance_bps = order_imbalance_bps(bid_depth, ask_depth);

    BookDepth {
        bid_depth,
        ask_depth,
        total_depth,
        imbalance_bps,
        levels,
    }
}

/// Compute the volume-weighted average price (VWAP) for consuming a given
/// amount from the specified price levels.
///
/// Levels should be pre-sorted (best first): asks ascending, bids descending.
pub fn vwap(levels: &[PriceLevel], amount: u128) -> Result<VWAPResult, OrderbookError> {
    if amount == 0 {
        return Err(OrderbookError::InvalidAmount);
    }
    if levels.is_empty() {
        return Err(OrderbookError::EmptyBook);
    }

    let mut remaining = amount;
    let mut weighted_sum = 0u128;
    let mut total_volume = 0u128;
    let mut levels_consumed = 0u32;

    for level in levels {
        if remaining == 0 {
            break;
        }

        let fill = remaining.min(level.total_amount);
        // weighted_sum += fill * price
        weighted_sum = weighted_sum.saturating_add(mul_div(fill, level.price, PRECISION));
        total_volume = total_volume.saturating_add(fill);
        remaining = remaining.saturating_sub(fill);
        levels_consumed += 1;
    }

    if total_volume == 0 {
        return Err(OrderbookError::EmptyBook);
    }

    if remaining > 0 {
        return Err(OrderbookError::InsufficientDepth {
            requested: amount,
            available: total_volume,
        });
    }

    // vwap = weighted_sum * PRECISION / total_volume
    let vwap_price = mul_div(weighted_sum, PRECISION, total_volume);

    Ok(VWAPResult {
        vwap: vwap_price,
        total_volume,
        levels_consumed,
    })
}

/// Estimate the price impact of a market order in basis points.
///
/// Compares the VWAP of filling `amount` against the best price on that side.
/// A buy order (Bid) consumes asks; a sell order (Ask) consumes bids.
pub fn price_impact(
    book: &BookSnapshot,
    side: Side,
    amount: u128,
) -> Result<u16, OrderbookError> {
    if amount == 0 {
        return Err(OrderbookError::InvalidAmount);
    }

    let (levels, reference_price) = match side {
        Side::Bid => {
            let best = book.best_ask.ok_or(OrderbookError::EmptyBook)?;
            (&book.asks, best)
        }
        Side::Ask => {
            let best = book.best_bid.ok_or(OrderbookError::EmptyBook)?;
            (&book.bids, best)
        }
    };

    let vwap_result = vwap(levels, amount)?;

    // Impact = |vwap - reference| * BPS_DENOM / reference
    let impact = if vwap_result.vwap >= reference_price {
        mul_div(
            vwap_result.vwap - reference_price,
            BPS_DENOM,
            reference_price,
        )
    } else {
        mul_div(
            reference_price - vwap_result.vwap,
            BPS_DENOM,
            reference_price,
        )
    };

    // Cap at u16::MAX
    Ok(impact.min(u16::MAX as u128) as u16)
}

/// Returns the best (highest) bid price from a list of orders.
pub fn best_bid(orders: &[Order]) -> Option<u128> {
    orders
        .iter()
        .filter(|o| o.side == Side::Bid && o.remaining() > 0)
        .map(|o| o.price)
        .max()
}

/// Returns the best (lowest) ask price from a list of orders.
pub fn best_ask(orders: &[Order]) -> Option<u128> {
    orders
        .iter()
        .filter(|o| o.side == Side::Ask && o.remaining() > 0)
        .map(|o| o.price)
        .min()
}

/// Compute the spread in basis points between best bid and best ask.
///
/// spread_bps = (ask - bid) * 10000 / bid
/// Returns 0 if crossed (bid >= ask).
pub fn spread_bps(best_bid: u128, best_ask: u128) -> u16 {
    if best_bid == 0 || best_ask <= best_bid {
        return 0;
    }
    let diff = best_ask - best_bid;
    let bps = mul_div(diff, BPS_DENOM, best_bid);
    bps.min(u16::MAX as u128) as u16
}

/// Compute the midpoint price between best bid and best ask.
///
/// midpoint = (bid + ask) / 2
pub fn midpoint(best_bid: u128, best_ask: u128) -> u128 {
    // Use (a/2 + b/2) to avoid overflow for very large values
    (best_bid / 2).saturating_add(best_ask / 2)
}

/// Return the total volume at an exact price for a given side.
pub fn depth_at_price(orders: &[Order], price: u128, side: Side) -> u128 {
    orders
        .iter()
        .filter(|o| o.side == side && o.price == price && o.remaining() > 0)
        .map(|o| o.remaining())
        .sum()
}

/// Cumulative depth up to (and including) a given price.
///
/// For bids: sums all bid levels with price >= up_to_price (walking down from best).
/// For asks: sums all ask levels with price <= up_to_price (walking up from best).
pub fn cumulative_depth(levels: &[PriceLevel], up_to_price: u128, side: Side) -> u128 {
    match side {
        Side::Bid => {
            // Levels assumed sorted descending; include prices >= up_to_price
            levels
                .iter()
                .filter(|l| l.side == Side::Bid && l.price >= up_to_price)
                .map(|l| l.total_amount)
                .sum()
        }
        Side::Ask => {
            // Levels assumed sorted ascending; include prices <= up_to_price
            levels
                .iter()
                .filter(|l| l.side == Side::Ask && l.price <= up_to_price)
                .map(|l| l.total_amount)
                .sum()
        }
    }
}

/// Calculate signed order imbalance in basis points.
///
/// Positive = bid heavy (more buy pressure), negative = ask heavy.
/// Returns 0 if both volumes are 0.
/// Formula: (bid - ask) * 10000 / (bid + ask)
pub fn order_imbalance_bps(bid_volume: u128, ask_volume: u128) -> i32 {
    let total = bid_volume.saturating_add(ask_volume);
    if total == 0 {
        return 0;
    }

    if bid_volume >= ask_volume {
        let diff = bid_volume - ask_volume;
        let bps = mul_div(diff, BPS_DENOM, total);
        bps.min(i32::MAX as u128) as i32
    } else {
        let diff = ask_volume - bid_volume;
        let bps = mul_div(diff, BPS_DENOM, total);
        -(bps.min(i32::MAX as u128) as i32)
    }
}

/// Remove an order from the book by ID. Returns the removed order.
pub fn cancel_order(orders: &mut Vec<Order>, order_id: u64) -> Result<Order, OrderbookError> {
    let pos = orders
        .iter()
        .position(|o| o.order_id == order_id)
        .ok_or(OrderbookError::OrderNotFound(order_id))?;
    Ok(orders.remove(pos))
}

/// Sort orders by price-time priority.
///
/// Bids: descending by price, then ascending by timestamp (earliest first).
/// Asks: ascending by price, then ascending by timestamp (earliest first).
pub fn sort_orders_price_time(orders: &mut [Order], side: Side) {
    match side {
        Side::Bid => {
            orders.sort_by(|a, b| {
                b.price
                    .cmp(&a.price)
                    .then_with(|| a.timestamp.cmp(&b.timestamp))
            });
        }
        Side::Ask => {
            orders.sort_by(|a, b| {
                a.price
                    .cmp(&b.price)
                    .then_with(|| a.timestamp.cmp(&b.timestamp))
            });
        }
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn make_bid(id: u64, price: u128, amount: u128, timestamp: u64) -> Order {
        Order {
            order_id: id,
            owner: [0u8; 32],
            side: Side::Bid,
            price,
            amount,
            timestamp,
            filled: 0,
        }
    }

    fn make_ask(id: u64, price: u128, amount: u128, timestamp: u64) -> Order {
        Order {
            order_id: id,
            owner: [0u8; 32],
            side: Side::Ask,
            price,
            amount,
            timestamp,
            filled: 0,
        }
    }

    fn make_bid_with_owner(id: u64, price: u128, amount: u128, owner: [u8; 32]) -> Order {
        Order {
            order_id: id,
            owner,
            side: Side::Bid,
            price,
            amount,
            timestamp: 1,
            filled: 0,
        }
    }

    fn make_partially_filled_bid(id: u64, price: u128, amount: u128, filled: u128) -> Order {
        Order {
            order_id: id,
            owner: [0u8; 32],
            side: Side::Bid,
            price,
            amount,
            timestamp: 1,
            filled,
        }
    }

    fn make_partially_filled_ask(id: u64, price: u128, amount: u128, filled: u128) -> Order {
        Order {
            order_id: id,
            owner: [0u8; 32],
            side: Side::Ask,
            price,
            amount,
            timestamp: 1,
            filled,
        }
    }

    /// Helper: 1.0 in PRECISION scale
    const P1: u128 = PRECISION;
    /// Helper: 2.0
    const P2: u128 = 2 * PRECISION;
    /// Helper: 0.5
    const P_HALF: u128 = PRECISION / 2;

    // ============ build_snapshot tests ============

    #[test]
    fn snapshot_empty_orders() {
        let snap = build_snapshot(&[]);
        assert!(snap.bids.is_empty());
        assert!(snap.asks.is_empty());
        assert_eq!(snap.best_bid, None);
        assert_eq!(snap.best_ask, None);
        assert_eq!(snap.spread, None);
        assert_eq!(snap.spread_bps, None);
        assert_eq!(snap.midpoint, None);
    }

    #[test]
    fn snapshot_single_bid() {
        let orders = vec![make_bid(1, P1, 100, 1)];
        let snap = build_snapshot(&orders);
        assert_eq!(snap.bids.len(), 1);
        assert_eq!(snap.bids[0].price, P1);
        assert_eq!(snap.bids[0].total_amount, 100);
        assert_eq!(snap.bids[0].order_count, 1);
        assert!(snap.asks.is_empty());
        assert_eq!(snap.best_bid, Some(P1));
        assert_eq!(snap.best_ask, None);
        assert_eq!(snap.spread, None);
    }

    #[test]
    fn snapshot_single_ask() {
        let orders = vec![make_ask(1, P2, 200, 1)];
        let snap = build_snapshot(&orders);
        assert!(snap.bids.is_empty());
        assert_eq!(snap.asks.len(), 1);
        assert_eq!(snap.asks[0].price, P2);
        assert_eq!(snap.asks[0].total_amount, 200);
        assert_eq!(snap.best_ask, Some(P2));
        assert_eq!(snap.best_bid, None);
    }

    #[test]
    fn snapshot_bids_and_asks() {
        let orders = vec![
            make_bid(1, P1, 100, 1),
            make_ask(2, P2, 200, 2),
        ];
        let snap = build_snapshot(&orders);
        assert_eq!(snap.best_bid, Some(P1));
        assert_eq!(snap.best_ask, Some(P2));
        assert_eq!(snap.spread, Some(P2 - P1));
    }

    #[test]
    fn snapshot_multiple_bid_levels() {
        let orders = vec![
            make_bid(1, P1, 100, 1),
            make_bid(2, P2, 200, 2),
            make_bid(3, P_HALF, 50, 3),
        ];
        let snap = build_snapshot(&orders);
        // Best bid should be highest: P2
        assert_eq!(snap.best_bid, Some(P2));
        assert_eq!(snap.bids.len(), 3);
        // Sorted descending
        assert_eq!(snap.bids[0].price, P2);
        assert_eq!(snap.bids[1].price, P1);
        assert_eq!(snap.bids[2].price, P_HALF);
    }

    #[test]
    fn snapshot_multiple_ask_levels() {
        let orders = vec![
            make_ask(1, P2, 200, 1),
            make_ask(2, P1, 100, 2),
            make_ask(3, 3 * PRECISION, 300, 3),
        ];
        let snap = build_snapshot(&orders);
        // Best ask should be lowest: P1
        assert_eq!(snap.best_ask, Some(P1));
        assert_eq!(snap.asks.len(), 3);
        // Sorted ascending
        assert_eq!(snap.asks[0].price, P1);
        assert_eq!(snap.asks[1].price, P2);
        assert_eq!(snap.asks[2].price, 3 * PRECISION);
    }

    #[test]
    fn snapshot_aggregates_same_price() {
        let orders = vec![
            make_bid(1, P1, 100, 1),
            make_bid(2, P1, 200, 2),
            make_bid(3, P1, 50, 3),
        ];
        let snap = build_snapshot(&orders);
        assert_eq!(snap.bids.len(), 1);
        assert_eq!(snap.bids[0].total_amount, 350);
        assert_eq!(snap.bids[0].order_count, 3);
    }

    #[test]
    fn snapshot_spread_calculation() {
        let bid_price = PRECISION; // 1.0
        let ask_price = PRECISION + PRECISION / 100; // 1.01
        let orders = vec![
            make_bid(1, bid_price, 100, 1),
            make_ask(2, ask_price, 100, 2),
        ];
        let snap = build_snapshot(&orders);
        assert_eq!(snap.spread, Some(ask_price - bid_price));
        // spread_bps = (0.01 / 1.0) * 10000 = 100 bps
        assert_eq!(snap.spread_bps, Some(100));
    }

    #[test]
    fn snapshot_midpoint_calculation() {
        let orders = vec![
            make_bid(1, PRECISION, 100, 1),     // 1.0
            make_ask(2, 2 * PRECISION, 100, 2),  // 2.0
        ];
        let snap = build_snapshot(&orders);
        // midpoint = (1.0 + 2.0) / 2 = 1.5
        assert_eq!(snap.midpoint, Some(PRECISION + PRECISION / 2));
    }

    #[test]
    fn snapshot_crossed_book() {
        // Bid > Ask (crossed book)
        let orders = vec![
            make_bid(1, 2 * PRECISION, 100, 1),
            make_ask(2, PRECISION, 100, 2),
        ];
        let snap = build_snapshot(&orders);
        assert_eq!(snap.spread, Some(0)); // crossed = 0 spread
        assert_eq!(snap.spread_bps, Some(0));
    }

    #[test]
    fn snapshot_ignores_fully_filled() {
        let mut order = make_bid(1, P1, 100, 1);
        order.filled = 100; // fully filled
        let orders = vec![order, make_ask(2, P2, 200, 2)];
        let snap = build_snapshot(&orders);
        assert!(snap.bids.is_empty());
        assert_eq!(snap.best_bid, None);
    }

    #[test]
    fn snapshot_partially_filled_shows_remaining() {
        let order = make_partially_filled_bid(1, P1, 100, 60);
        let orders = vec![order];
        let snap = build_snapshot(&orders);
        assert_eq!(snap.bids[0].total_amount, 40); // 100 - 60
    }

    // ============ match_orders tests ============

    #[test]
    fn match_empty_bids() {
        let asks = vec![make_ask(1, P1, 100, 1)];
        let results = match_orders(&[], &asks);
        assert!(results.is_empty());
    }

    #[test]
    fn match_empty_asks() {
        let bids = vec![make_bid(1, P1, 100, 1)];
        let results = match_orders(&bids, &[]);
        assert!(results.is_empty());
    }

    #[test]
    fn match_both_empty() {
        let results = match_orders(&[], &[]);
        assert!(results.is_empty());
    }

    #[test]
    fn match_exact_fill() {
        let bids = vec![make_bid(1, P1, 100, 1)];
        let asks = vec![make_ask(2, P1, 100, 1)];
        let results = match_orders(&bids, &asks);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].amount, 100);
        assert_eq!(results[0].price, P1);
        assert_eq!(results[0].taker_id, 1);
        assert_eq!(results[0].maker_id, 2);
    }

    #[test]
    fn match_partial_fill_bid_larger() {
        let bids = vec![make_bid(1, P1, 200, 1)];
        let asks = vec![make_ask(2, P1, 100, 1)];
        let results = match_orders(&bids, &asks);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].amount, 100); // only 100 fills
    }

    #[test]
    fn match_partial_fill_ask_larger() {
        let bids = vec![make_bid(1, P1, 50, 1)];
        let asks = vec![make_ask(2, P1, 100, 1)];
        let results = match_orders(&bids, &asks);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].amount, 50);
    }

    #[test]
    fn match_price_priority() {
        // Higher bid should match first
        let bids = vec![
            make_bid(1, P1, 100, 1),       // lower priority
            make_bid(2, P2, 100, 2),        // higher priority (higher price)
        ];
        let asks = vec![make_ask(3, P1, 100, 1)];
        let results = match_orders(&bids, &asks);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].taker_id, 2); // bid at P2 matches first
    }

    #[test]
    fn match_time_priority() {
        // Same price, earlier timestamp should match first
        let bids = vec![
            make_bid(1, P1, 100, 10), // later
            make_bid(2, P1, 100, 1),  // earlier
        ];
        let asks = vec![make_ask(3, P1, 100, 1)];
        let results = match_orders(&bids, &asks);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].taker_id, 2); // earlier bid matches
    }

    #[test]
    fn match_no_crossing() {
        // Bid at 1.0, Ask at 2.0 — no match
        let bids = vec![make_bid(1, P1, 100, 1)];
        let asks = vec![make_ask(2, P2, 100, 1)];
        let results = match_orders(&bids, &asks);
        assert!(results.is_empty());
    }

    #[test]
    fn match_multiple_fills() {
        let bids = vec![
            make_bid(1, P2, 100, 1),
            make_bid(2, P1, 100, 2),
        ];
        let asks = vec![
            make_ask(3, P_HALF, 50, 1),
            make_ask(4, P1, 80, 2),
        ];
        let results = match_orders(&bids, &asks);
        // Bid 1 (P2) matches Ask 3 (P_HALF, 50) fully
        // Bid 1 (P2) matches Ask 4 (P1, 80) — 50 remaining from bid1
        // Bid 2 (P1) matches Ask 4 (P1, 80) — 30 remaining from ask4
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].amount, 50);
        assert_eq!(results[1].amount, 50);
        assert_eq!(results[2].amount, 30);
    }

    #[test]
    fn match_crossed_book_uses_ask_price() {
        let bids = vec![make_bid(1, 2 * PRECISION, 100, 1)];
        let asks = vec![make_ask(2, PRECISION, 100, 1)];
        let results = match_orders(&bids, &asks);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].price, PRECISION); // ask's price
    }

    #[test]
    fn match_partially_filled_orders() {
        let bids = vec![make_partially_filled_bid(1, P1, 100, 60)]; // 40 remaining
        let asks = vec![make_ask(2, P1, 100, 1)];
        let results = match_orders(&bids, &asks);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].amount, 40);
    }

    // ============ simulate_market_order tests ============

    #[test]
    fn simulate_buy_full_fill() {
        let orders = vec![
            make_ask(1, P1, 100, 1),
            make_ask(2, P2, 100, 2),
        ];
        let snap = build_snapshot(&orders);
        let fill = simulate_market_order(&snap, Side::Bid, 100).unwrap();
        assert_eq!(fill.filled_amount, 100);
        assert_eq!(fill.remaining, 0);
        // All filled at P1 → avg_price = P1
        assert_eq!(fill.avg_price, P1);
    }

    #[test]
    fn simulate_buy_multi_level_fill() {
        let orders = vec![
            make_ask(1, P1, 50, 1),      // 50 @ 1.0
            make_ask(2, P2, 100, 2),     // 100 @ 2.0
        ];
        let snap = build_snapshot(&orders);
        // Buy 100: 50 @ 1.0, 50 @ 2.0
        let fill = simulate_market_order(&snap, Side::Bid, 100).unwrap();
        assert_eq!(fill.filled_amount, 100);
        // cost = 50*1 + 50*2 = 150 (in PRECISION scale: 150 raw units)
        // avg = 150 / 100 = 1.5 = 1.5 * PRECISION
        assert_eq!(fill.avg_price, PRECISION + PRECISION / 2);
    }

    #[test]
    fn simulate_sell_full_fill() {
        let orders = vec![
            make_bid(1, P2, 200, 1),
        ];
        let snap = build_snapshot(&orders);
        let fill = simulate_market_order(&snap, Side::Ask, 100).unwrap();
        assert_eq!(fill.filled_amount, 100);
        assert_eq!(fill.avg_price, P2);
    }

    #[test]
    fn simulate_insufficient_depth() {
        let orders = vec![make_ask(1, P1, 50, 1)];
        let snap = build_snapshot(&orders);
        let err = simulate_market_order(&snap, Side::Bid, 100).unwrap_err();
        assert_eq!(
            err,
            OrderbookError::InsufficientDepth {
                requested: 100,
                available: 50,
            }
        );
    }

    #[test]
    fn simulate_empty_book() {
        let snap = build_snapshot(&[]);
        let err = simulate_market_order(&snap, Side::Bid, 100).unwrap_err();
        assert_eq!(err, OrderbookError::EmptyBook);
    }

    #[test]
    fn simulate_zero_amount() {
        let orders = vec![make_ask(1, P1, 100, 1)];
        let snap = build_snapshot(&orders);
        let err = simulate_market_order(&snap, Side::Bid, 0).unwrap_err();
        assert_eq!(err, OrderbookError::InvalidAmount);
    }

    #[test]
    fn simulate_empty_opposite_side() {
        // Only bids, try to buy → no asks → EmptyBook
        let orders = vec![make_bid(1, P1, 100, 1)];
        let snap = build_snapshot(&orders);
        let err = simulate_market_order(&snap, Side::Bid, 100).unwrap_err();
        assert_eq!(err, OrderbookError::EmptyBook);
    }

    #[test]
    fn simulate_exact_depth() {
        let orders = vec![make_ask(1, P1, 100, 1)];
        let snap = build_snapshot(&orders);
        let fill = simulate_market_order(&snap, Side::Bid, 100).unwrap();
        assert_eq!(fill.filled_amount, 100);
        assert_eq!(fill.remaining, 0);
    }

    // ============ book_depth tests ============

    #[test]
    fn depth_balanced_book() {
        let orders = vec![
            make_bid(1, P1, 100, 1),
            make_ask(2, P2, 100, 2),
        ];
        let snap = build_snapshot(&orders);
        let depth = book_depth(&snap);
        assert_eq!(depth.bid_depth, 100);
        assert_eq!(depth.ask_depth, 100);
        assert_eq!(depth.total_depth, 200);
        assert_eq!(depth.imbalance_bps, 0);
        assert_eq!(depth.levels, 2);
    }

    #[test]
    fn depth_bid_heavy() {
        let orders = vec![
            make_bid(1, P1, 300, 1),
            make_ask(2, P2, 100, 2),
        ];
        let snap = build_snapshot(&orders);
        let depth = book_depth(&snap);
        assert_eq!(depth.bid_depth, 300);
        assert_eq!(depth.ask_depth, 100);
        // imbalance = (300-100)*10000/400 = 5000
        assert_eq!(depth.imbalance_bps, 5000);
    }

    #[test]
    fn depth_ask_heavy() {
        let orders = vec![
            make_bid(1, P1, 100, 1),
            make_ask(2, P2, 300, 2),
        ];
        let snap = build_snapshot(&orders);
        let depth = book_depth(&snap);
        assert_eq!(depth.imbalance_bps, -5000);
    }

    #[test]
    fn depth_single_side_bid() {
        let orders = vec![make_bid(1, P1, 100, 1)];
        let snap = build_snapshot(&orders);
        let depth = book_depth(&snap);
        assert_eq!(depth.bid_depth, 100);
        assert_eq!(depth.ask_depth, 0);
        assert_eq!(depth.total_depth, 100);
        assert_eq!(depth.imbalance_bps, 10000); // 100% bid heavy
    }

    #[test]
    fn depth_single_side_ask() {
        let orders = vec![make_ask(1, P1, 100, 1)];
        let snap = build_snapshot(&orders);
        let depth = book_depth(&snap);
        assert_eq!(depth.imbalance_bps, -10000); // 100% ask heavy
    }

    #[test]
    fn depth_empty_book() {
        let snap = build_snapshot(&[]);
        let depth = book_depth(&snap);
        assert_eq!(depth.bid_depth, 0);
        assert_eq!(depth.ask_depth, 0);
        assert_eq!(depth.total_depth, 0);
        assert_eq!(depth.imbalance_bps, 0);
        assert_eq!(depth.levels, 0);
    }

    #[test]
    fn depth_multiple_levels() {
        let orders = vec![
            make_bid(1, P1, 100, 1),
            make_bid(2, P_HALF, 50, 2),
            make_ask(3, P2, 200, 3),
            make_ask(4, 3 * PRECISION, 100, 4),
        ];
        let snap = build_snapshot(&orders);
        let depth = book_depth(&snap);
        assert_eq!(depth.bid_depth, 150);
        assert_eq!(depth.ask_depth, 300);
        assert_eq!(depth.levels, 4);
    }

    // ============ vwap tests ============

    #[test]
    fn vwap_single_level() {
        let levels = vec![PriceLevel {
            price: P1,
            total_amount: 100,
            order_count: 1,
            side: Side::Ask,
        }];
        let result = vwap(&levels, 50).unwrap();
        assert_eq!(result.vwap, P1);
        assert_eq!(result.total_volume, 50);
        assert_eq!(result.levels_consumed, 1);
    }

    #[test]
    fn vwap_multi_level() {
        let levels = vec![
            PriceLevel { price: P1, total_amount: 50, order_count: 1, side: Side::Ask },
            PriceLevel { price: P2, total_amount: 50, order_count: 1, side: Side::Ask },
        ];
        // Buy 100: 50 @ 1.0, 50 @ 2.0 → VWAP = 1.5
        let result = vwap(&levels, 100).unwrap();
        assert_eq!(result.vwap, PRECISION + PRECISION / 2);
        assert_eq!(result.total_volume, 100);
        assert_eq!(result.levels_consumed, 2);
    }

    #[test]
    fn vwap_partial_level() {
        let levels = vec![
            PriceLevel { price: P1, total_amount: 100, order_count: 2, side: Side::Ask },
        ];
        let result = vwap(&levels, 30).unwrap();
        assert_eq!(result.vwap, P1);
        assert_eq!(result.total_volume, 30);
        assert_eq!(result.levels_consumed, 1);
    }

    #[test]
    fn vwap_insufficient_depth() {
        let levels = vec![
            PriceLevel { price: P1, total_amount: 50, order_count: 1, side: Side::Ask },
        ];
        let err = vwap(&levels, 100).unwrap_err();
        assert_eq!(
            err,
            OrderbookError::InsufficientDepth {
                requested: 100,
                available: 50,
            }
        );
    }

    #[test]
    fn vwap_empty_levels() {
        let err = vwap(&[], 100).unwrap_err();
        assert_eq!(err, OrderbookError::EmptyBook);
    }

    #[test]
    fn vwap_zero_amount() {
        let levels = vec![
            PriceLevel { price: P1, total_amount: 100, order_count: 1, side: Side::Ask },
        ];
        let err = vwap(&levels, 0).unwrap_err();
        assert_eq!(err, OrderbookError::InvalidAmount);
    }

    #[test]
    fn vwap_three_levels_uneven() {
        let levels = vec![
            PriceLevel { price: P1, total_amount: 10, order_count: 1, side: Side::Ask },
            PriceLevel { price: P2, total_amount: 20, order_count: 1, side: Side::Ask },
            PriceLevel { price: 3 * PRECISION, total_amount: 30, order_count: 1, side: Side::Ask },
        ];
        // Buy 30: 10 @ 1.0, 20 @ 2.0
        // cost = 10 + 40 = 50 → VWAP = 50/30 * PRECISION
        let result = vwap(&levels, 30).unwrap();
        assert_eq!(result.total_volume, 30);
        assert_eq!(result.levels_consumed, 2);
        // weighted_sum = 10*1 + 20*2 = 50 → vwap = 50*P/30
        let expected_vwap = mul_div(50, PRECISION, 30);
        assert_eq!(result.vwap, expected_vwap);
    }

    // ============ price_impact tests ============

    #[test]
    fn impact_small_order() {
        let orders = vec![
            make_ask(1, P1, 1000, 1),
        ];
        let snap = build_snapshot(&orders);
        // Small order that fills entirely at best ask → 0 impact
        let impact = price_impact(&snap, Side::Bid, 10).unwrap();
        assert_eq!(impact, 0);
    }

    #[test]
    fn impact_large_order_crosses_levels() {
        let orders = vec![
            make_ask(1, PRECISION, 50, 1),          // 1.0
            make_ask(2, PRECISION + PRECISION / 10, 50, 2), // 1.1
        ];
        let snap = build_snapshot(&orders);
        // Buy 100: 50 @ 1.0, 50 @ 1.1 → VWAP = 1.05
        // Impact = (1.05 - 1.0) / 1.0 * 10000 = 500 bps
        let impact = price_impact(&snap, Side::Bid, 100).unwrap();
        assert_eq!(impact, 500);
    }

    #[test]
    fn impact_empty_side() {
        let orders = vec![make_bid(1, P1, 100, 1)]; // only bids
        let snap = build_snapshot(&orders);
        let err = price_impact(&snap, Side::Bid, 100).unwrap_err();
        assert_eq!(err, OrderbookError::EmptyBook);
    }

    #[test]
    fn impact_sell_side() {
        let orders = vec![
            make_bid(1, P2, 50, 1),          // 2.0
            make_bid(2, P1, 50, 2),          // 1.0
        ];
        let snap = build_snapshot(&orders);
        // Sell 100: 50 @ 2.0, 50 @ 1.0 → VWAP = 1.5
        // Impact = (2.0 - 1.5) / 2.0 * 10000 = 2500 bps
        let impact = price_impact(&snap, Side::Ask, 100).unwrap();
        assert_eq!(impact, 2500);
    }

    #[test]
    fn impact_zero_amount() {
        let orders = vec![make_ask(1, P1, 100, 1)];
        let snap = build_snapshot(&orders);
        let err = price_impact(&snap, Side::Bid, 0).unwrap_err();
        assert_eq!(err, OrderbookError::InvalidAmount);
    }

    #[test]
    fn impact_insufficient_depth() {
        let orders = vec![make_ask(1, P1, 50, 1)];
        let snap = build_snapshot(&orders);
        let err = price_impact(&snap, Side::Bid, 100).unwrap_err();
        assert_eq!(
            err,
            OrderbookError::InsufficientDepth {
                requested: 100,
                available: 50,
            }
        );
    }

    // ============ best_bid tests ============

    #[test]
    fn best_bid_empty() {
        assert_eq!(best_bid(&[]), None);
    }

    #[test]
    fn best_bid_single() {
        let orders = vec![make_bid(1, P1, 100, 1)];
        assert_eq!(best_bid(&orders), Some(P1));
    }

    #[test]
    fn best_bid_multiple() {
        let orders = vec![
            make_bid(1, P1, 100, 1),
            make_bid(2, P2, 100, 2),
            make_bid(3, P_HALF, 100, 3),
        ];
        assert_eq!(best_bid(&orders), Some(P2));
    }

    #[test]
    fn best_bid_ignores_asks() {
        let orders = vec![
            make_ask(1, P_HALF, 100, 1), // lower price but it's an ask
            make_bid(2, P1, 100, 2),
        ];
        assert_eq!(best_bid(&orders), Some(P1));
    }

    #[test]
    fn best_bid_ignores_fully_filled() {
        let mut order = make_bid(1, P2, 100, 1);
        order.filled = 100;
        let orders = vec![order, make_bid(2, P1, 50, 2)];
        assert_eq!(best_bid(&orders), Some(P1));
    }

    // ============ best_ask tests ============

    #[test]
    fn best_ask_empty() {
        assert_eq!(best_ask(&[]), None);
    }

    #[test]
    fn best_ask_single() {
        let orders = vec![make_ask(1, P1, 100, 1)];
        assert_eq!(best_ask(&orders), Some(P1));
    }

    #[test]
    fn best_ask_multiple() {
        let orders = vec![
            make_ask(1, P2, 100, 1),
            make_ask(2, P1, 100, 2),
            make_ask(3, 3 * PRECISION, 100, 3),
        ];
        assert_eq!(best_ask(&orders), Some(P1));
    }

    #[test]
    fn best_ask_ignores_bids() {
        let orders = vec![
            make_bid(1, 3 * PRECISION, 100, 1), // higher but it's a bid
            make_ask(2, P2, 100, 2),
        ];
        assert_eq!(best_ask(&orders), Some(P2));
    }

    #[test]
    fn best_ask_ignores_fully_filled() {
        let mut order = make_ask(1, P_HALF, 100, 1);
        order.filled = 100;
        let orders = vec![order, make_ask(2, P1, 50, 2)];
        assert_eq!(best_ask(&orders), Some(P1));
    }

    // ============ spread_bps tests ============

    #[test]
    fn spread_normal() {
        // bid=1.0, ask=1.01 → 100 bps
        let bps = spread_bps(PRECISION, PRECISION + PRECISION / 100);
        assert_eq!(bps, 100);
    }

    #[test]
    fn spread_crossed() {
        // bid > ask → 0
        let bps = spread_bps(P2, P1);
        assert_eq!(bps, 0);
    }

    #[test]
    fn spread_equal() {
        let bps = spread_bps(P1, P1);
        assert_eq!(bps, 0);
    }

    #[test]
    fn spread_wide() {
        // bid=1.0, ask=2.0 → 10000 bps (100%)
        let bps = spread_bps(PRECISION, 2 * PRECISION);
        assert_eq!(bps, 10000);
    }

    #[test]
    fn spread_tight() {
        // bid=1.0, ask=1.0001 → 1 bps
        let bps = spread_bps(PRECISION, PRECISION + PRECISION / 10000);
        assert_eq!(bps, 1);
    }

    #[test]
    fn spread_zero_bid() {
        let bps = spread_bps(0, P1);
        assert_eq!(bps, 0); // division by zero guard
    }

    // ============ midpoint tests ============

    #[test]
    fn midpoint_normal() {
        let mid = midpoint(PRECISION, 2 * PRECISION);
        assert_eq!(mid, PRECISION + PRECISION / 2);
    }

    #[test]
    fn midpoint_equal() {
        let mid = midpoint(P1, P1);
        assert_eq!(mid, P1);
    }

    #[test]
    fn midpoint_zero_and_value() {
        let mid = midpoint(0, P2);
        assert_eq!(mid, P1);
    }

    #[test]
    fn midpoint_large_values() {
        // Should not overflow even with large values
        // u128::MAX / 2 is odd (170141183460469231731687303715884105727)
        // midpoint uses a/2 + b/2 to avoid overflow, which truncates each half
        let large = u128::MAX / 2;
        let mid = midpoint(large, large);
        // Each half truncates: (large/2) + (large/2) = large - 1 when large is odd
        let expected = (large / 2) + (large / 2);
        assert_eq!(mid, expected);
    }

    // ============ depth_at_price tests ============

    #[test]
    fn depth_at_existing_price() {
        let orders = vec![
            make_bid(1, P1, 100, 1),
            make_bid(2, P1, 200, 2),
            make_bid(3, P2, 50, 3),
        ];
        assert_eq!(depth_at_price(&orders, P1, Side::Bid), 300);
    }

    #[test]
    fn depth_at_nonexistent_price() {
        let orders = vec![make_bid(1, P1, 100, 1)];
        assert_eq!(depth_at_price(&orders, P2, Side::Bid), 0);
    }

    #[test]
    fn depth_at_price_wrong_side() {
        let orders = vec![make_bid(1, P1, 100, 1)];
        assert_eq!(depth_at_price(&orders, P1, Side::Ask), 0);
    }

    #[test]
    fn depth_at_price_empty() {
        assert_eq!(depth_at_price(&[], P1, Side::Bid), 0);
    }

    #[test]
    fn depth_at_price_partially_filled() {
        let orders = vec![make_partially_filled_bid(1, P1, 100, 40)];
        assert_eq!(depth_at_price(&orders, P1, Side::Bid), 60);
    }

    // ============ cumulative_depth tests ============

    #[test]
    fn cumulative_depth_bids() {
        let levels = vec![
            PriceLevel { price: P2, total_amount: 100, order_count: 1, side: Side::Bid },
            PriceLevel { price: P1, total_amount: 200, order_count: 2, side: Side::Bid },
            PriceLevel { price: P_HALF, total_amount: 50, order_count: 1, side: Side::Bid },
        ];
        // Cumulative down to P1 (include P2 and P1)
        assert_eq!(cumulative_depth(&levels, P1, Side::Bid), 300);
    }

    #[test]
    fn cumulative_depth_asks() {
        let levels = vec![
            PriceLevel { price: P1, total_amount: 100, order_count: 1, side: Side::Ask },
            PriceLevel { price: P2, total_amount: 200, order_count: 2, side: Side::Ask },
            PriceLevel { price: 3 * PRECISION, total_amount: 50, order_count: 1, side: Side::Ask },
        ];
        // Cumulative up to P2 (include P1 and P2)
        assert_eq!(cumulative_depth(&levels, P2, Side::Ask), 300);
    }

    #[test]
    fn cumulative_depth_all_bids() {
        let levels = vec![
            PriceLevel { price: P2, total_amount: 100, order_count: 1, side: Side::Bid },
            PriceLevel { price: P1, total_amount: 200, order_count: 2, side: Side::Bid },
        ];
        // Price 0 means include everything (all bids >= 0)
        assert_eq!(cumulative_depth(&levels, 0, Side::Bid), 300);
    }

    #[test]
    fn cumulative_depth_none_matching() {
        let levels = vec![
            PriceLevel { price: P1, total_amount: 100, order_count: 1, side: Side::Ask },
        ];
        // Ask cumulative up to P_HALF — P1 is above, so nothing matches
        assert_eq!(cumulative_depth(&levels, P_HALF, Side::Ask), 0);
    }

    #[test]
    fn cumulative_depth_empty() {
        assert_eq!(cumulative_depth(&[], P1, Side::Bid), 0);
    }

    // ============ order_imbalance_bps tests ============

    #[test]
    fn imbalance_balanced() {
        assert_eq!(order_imbalance_bps(100, 100), 0);
    }

    #[test]
    fn imbalance_bid_heavy() {
        // (300-100)/400 * 10000 = 5000
        assert_eq!(order_imbalance_bps(300, 100), 5000);
    }

    #[test]
    fn imbalance_ask_heavy() {
        // -(300-100)/400 * 10000 = -5000
        assert_eq!(order_imbalance_bps(100, 300), -5000);
    }

    #[test]
    fn imbalance_all_bids() {
        assert_eq!(order_imbalance_bps(100, 0), 10000);
    }

    #[test]
    fn imbalance_all_asks() {
        assert_eq!(order_imbalance_bps(0, 100), -10000);
    }

    #[test]
    fn imbalance_both_zero() {
        assert_eq!(order_imbalance_bps(0, 0), 0);
    }

    #[test]
    fn imbalance_slight_bid() {
        // (51-49)/100 * 10000 = 200
        assert_eq!(order_imbalance_bps(51, 49), 200);
    }

    #[test]
    fn imbalance_slight_ask() {
        // -(51-49)/100 * 10000 = -200
        assert_eq!(order_imbalance_bps(49, 51), -200);
    }

    // ============ cancel_order tests ============

    #[test]
    fn cancel_existing_order() {
        let mut orders = vec![
            make_bid(1, P1, 100, 1),
            make_ask(2, P2, 200, 2),
            make_bid(3, P_HALF, 50, 3),
        ];
        let removed = cancel_order(&mut orders, 2).unwrap();
        assert_eq!(removed.order_id, 2);
        assert_eq!(removed.side, Side::Ask);
        assert_eq!(orders.len(), 2);
    }

    #[test]
    fn cancel_not_found() {
        let mut orders = vec![make_bid(1, P1, 100, 1)];
        let err = cancel_order(&mut orders, 999).unwrap_err();
        assert_eq!(err, OrderbookError::OrderNotFound(999));
    }

    #[test]
    fn cancel_from_empty() {
        let mut orders: Vec<Order> = Vec::new();
        let err = cancel_order(&mut orders, 1).unwrap_err();
        assert_eq!(err, OrderbookError::OrderNotFound(1));
    }

    #[test]
    fn cancel_first_order() {
        let mut orders = vec![
            make_bid(1, P1, 100, 1),
            make_bid(2, P2, 200, 2),
        ];
        let removed = cancel_order(&mut orders, 1).unwrap();
        assert_eq!(removed.order_id, 1);
        assert_eq!(orders.len(), 1);
        assert_eq!(orders[0].order_id, 2);
    }

    #[test]
    fn cancel_last_order() {
        let mut orders = vec![
            make_bid(1, P1, 100, 1),
            make_bid(2, P2, 200, 2),
        ];
        let removed = cancel_order(&mut orders, 2).unwrap();
        assert_eq!(removed.order_id, 2);
        assert_eq!(orders.len(), 1);
    }

    #[test]
    fn cancel_only_order() {
        let mut orders = vec![make_ask(42, P1, 100, 1)];
        let removed = cancel_order(&mut orders, 42).unwrap();
        assert_eq!(removed.order_id, 42);
        assert!(orders.is_empty());
    }

    #[test]
    fn cancel_duplicate_ids_removes_first() {
        // Edge case: two orders with same ID (shouldn't happen, but test behavior)
        let mut orders = vec![
            make_bid(1, P1, 100, 1),
            make_bid(1, P2, 200, 2),
        ];
        let removed = cancel_order(&mut orders, 1).unwrap();
        assert_eq!(removed.price, P1); // first one removed
        assert_eq!(orders.len(), 1);
        assert_eq!(orders[0].price, P2);
    }

    // ============ sort_orders_price_time tests ============

    #[test]
    fn sort_bids_descending_price() {
        let mut orders = vec![
            make_bid(1, P1, 100, 1),
            make_bid(2, P2, 100, 2),
            make_bid(3, P_HALF, 100, 3),
        ];
        sort_orders_price_time(&mut orders, Side::Bid);
        assert_eq!(orders[0].price, P2);
        assert_eq!(orders[1].price, P1);
        assert_eq!(orders[2].price, P_HALF);
    }

    #[test]
    fn sort_asks_ascending_price() {
        let mut orders = vec![
            make_ask(1, P2, 100, 1),
            make_ask(2, P_HALF, 100, 2),
            make_ask(3, P1, 100, 3),
        ];
        sort_orders_price_time(&mut orders, Side::Ask);
        assert_eq!(orders[0].price, P_HALF);
        assert_eq!(orders[1].price, P1);
        assert_eq!(orders[2].price, P2);
    }

    #[test]
    fn sort_time_tiebreaker_bids() {
        let mut orders = vec![
            make_bid(1, P1, 100, 10),
            make_bid(2, P1, 100, 1),
            make_bid(3, P1, 100, 5),
        ];
        sort_orders_price_time(&mut orders, Side::Bid);
        // Same price, sorted by timestamp ascending
        assert_eq!(orders[0].timestamp, 1);
        assert_eq!(orders[1].timestamp, 5);
        assert_eq!(orders[2].timestamp, 10);
    }

    #[test]
    fn sort_time_tiebreaker_asks() {
        let mut orders = vec![
            make_ask(1, P1, 100, 10),
            make_ask(2, P1, 100, 1),
            make_ask(3, P1, 100, 5),
        ];
        sort_orders_price_time(&mut orders, Side::Ask);
        assert_eq!(orders[0].timestamp, 1);
        assert_eq!(orders[1].timestamp, 5);
        assert_eq!(orders[2].timestamp, 10);
    }

    #[test]
    fn sort_single_order() {
        let mut orders = vec![make_bid(1, P1, 100, 1)];
        sort_orders_price_time(&mut orders, Side::Bid);
        assert_eq!(orders[0].order_id, 1);
    }

    #[test]
    fn sort_empty() {
        let mut orders: Vec<Order> = Vec::new();
        sort_orders_price_time(&mut orders, Side::Bid);
        assert!(orders.is_empty());
    }

    #[test]
    fn sort_mixed_price_and_time() {
        let mut orders = vec![
            make_bid(1, P1, 100, 5),
            make_bid(2, P2, 100, 10),
            make_bid(3, P1, 100, 1),
            make_bid(4, P2, 100, 3),
        ];
        sort_orders_price_time(&mut orders, Side::Bid);
        // P2 first (desc), then by time (asc)
        assert_eq!(orders[0].order_id, 4); // P2, t=3
        assert_eq!(orders[1].order_id, 2); // P2, t=10
        assert_eq!(orders[2].order_id, 3); // P1, t=1
        assert_eq!(orders[3].order_id, 1); // P1, t=5
    }

    // ============ Order::remaining tests ============

    #[test]
    fn remaining_unfilled() {
        let order = make_bid(1, P1, 100, 1);
        assert_eq!(order.remaining(), 100);
    }

    #[test]
    fn remaining_partially_filled() {
        let order = make_partially_filled_bid(1, P1, 100, 60);
        assert_eq!(order.remaining(), 40);
    }

    #[test]
    fn remaining_fully_filled() {
        let order = make_partially_filled_bid(1, P1, 100, 100);
        assert_eq!(order.remaining(), 0);
    }

    #[test]
    fn remaining_overfilled_saturates() {
        // Edge case: filled > amount — should not underflow
        let order = make_partially_filled_bid(1, P1, 100, 150);
        assert_eq!(order.remaining(), 0);
    }

    // ============ Integration / combined tests ============

    #[test]
    fn full_workflow_build_match_analyze() {
        // Build a book, take a snapshot, match, analyze
        let orders = vec![
            make_bid(1, 105 * PRECISION / 100, 200, 1), // 1.05
            make_bid(2, PRECISION, 300, 2),               // 1.00
            make_ask(3, 106 * PRECISION / 100, 150, 3),  // 1.06
            make_ask(4, 110 * PRECISION / 100, 250, 4),  // 1.10
        ];

        let snap = build_snapshot(&orders);
        assert_eq!(snap.best_bid, Some(105 * PRECISION / 100));
        assert_eq!(snap.best_ask, Some(106 * PRECISION / 100));

        // No crossing, so no matches
        let bids: Vec<Order> = orders.iter().filter(|o| o.side == Side::Bid).cloned().collect();
        let asks: Vec<Order> = orders.iter().filter(|o| o.side == Side::Ask).cloned().collect();
        let matches = match_orders(&bids, &asks);
        assert!(matches.is_empty());

        // Check depth
        let depth = book_depth(&snap);
        assert_eq!(depth.bid_depth, 500);
        assert_eq!(depth.ask_depth, 400);
        assert_eq!(depth.levels, 4);
    }

    #[test]
    fn full_workflow_match_and_fill() {
        let bids = vec![
            make_bid(1, 2 * PRECISION, 100, 1),
            make_bid(2, PRECISION + PRECISION / 2, 100, 2),
        ];
        let asks = vec![
            make_ask(3, PRECISION, 80, 1),
            make_ask(4, PRECISION + PRECISION / 4, 50, 2),
        ];

        let matches = match_orders(&bids, &asks);
        // Bid 1 (2.0) vs Ask 3 (1.0, 80) → 80 filled
        // Bid 1 (2.0) vs Ask 4 (1.25, 50) → 20 filled (bid has 20 remaining)
        // Bid 2 (1.5) vs Ask 4 (1.25, 50) → 30 filled (ask has 30 remaining)
        assert_eq!(matches.len(), 3);
        assert_eq!(matches[0].amount, 80);
        assert_eq!(matches[1].amount, 20);
        assert_eq!(matches[2].amount, 30);
    }

    #[test]
    fn simulate_then_impact() {
        let orders = vec![
            make_ask(1, PRECISION, 100, 1),
            make_ask(2, PRECISION + PRECISION / 10, 100, 2), // 1.1
            make_ask(3, PRECISION + PRECISION / 5, 100, 3),  // 1.2
        ];
        let snap = build_snapshot(&orders);

        // Small order → low impact
        let small_impact = price_impact(&snap, Side::Bid, 50).unwrap();
        assert_eq!(small_impact, 0);

        // Medium order → some impact
        let med_impact = price_impact(&snap, Side::Bid, 150).unwrap();
        assert!(med_impact > 0);

        // Fill simulation
        let fill = simulate_market_order(&snap, Side::Bid, 200).unwrap();
        assert_eq!(fill.filled_amount, 200);
        assert_eq!(fill.remaining, 0);
    }

    #[test]
    fn snapshot_with_many_levels() {
        let mut orders = Vec::new();
        for i in 0..50 {
            orders.push(make_bid(i, PRECISION * (50 - i as u128), 100, i));
            orders.push(make_ask(i + 50, PRECISION * (51 + i as u128), 100, i));
        }
        let snap = build_snapshot(&orders);
        assert_eq!(snap.bids.len(), 50);
        assert_eq!(snap.asks.len(), 50);
        assert_eq!(snap.best_bid, Some(50 * PRECISION));
        assert_eq!(snap.best_ask, Some(51 * PRECISION));
    }

    #[test]
    fn cancel_and_rebuild_snapshot() {
        let mut orders = vec![
            make_bid(1, P1, 100, 1),
            make_bid(2, P2, 200, 2),
            make_ask(3, 3 * PRECISION, 150, 3),
        ];

        let snap1 = build_snapshot(&orders);
        assert_eq!(snap1.best_bid, Some(P2));

        cancel_order(&mut orders, 2).unwrap();

        let snap2 = build_snapshot(&orders);
        assert_eq!(snap2.best_bid, Some(P1)); // P2 bid was cancelled
    }

    #[test]
    fn depth_at_price_multiple_orders() {
        let orders = vec![
            make_bid(1, P1, 50, 1),
            make_bid(2, P1, 75, 2),
            make_bid(3, P1, 25, 3),
            make_bid(4, P2, 100, 4),
        ];
        assert_eq!(depth_at_price(&orders, P1, Side::Bid), 150);
        assert_eq!(depth_at_price(&orders, P2, Side::Bid), 100);
    }

    #[test]
    fn vwap_exact_level_boundary() {
        let levels = vec![
            PriceLevel { price: P1, total_amount: 100, order_count: 1, side: Side::Ask },
            PriceLevel { price: P2, total_amount: 100, order_count: 1, side: Side::Ask },
        ];
        // Buy exactly the first level
        let result = vwap(&levels, 100).unwrap();
        assert_eq!(result.vwap, P1);
        assert_eq!(result.levels_consumed, 1);
    }

    #[test]
    fn spread_very_tight() {
        // 1 wei difference
        let bps = spread_bps(PRECISION, PRECISION + 1);
        // So tiny it rounds to 0 bps
        assert_eq!(bps, 0);
    }

    #[test]
    fn cumulative_depth_single_level_bid() {
        let levels = vec![
            PriceLevel { price: P1, total_amount: 500, order_count: 5, side: Side::Bid },
        ];
        assert_eq!(cumulative_depth(&levels, P1, Side::Bid), 500);
        assert_eq!(cumulative_depth(&levels, P2, Side::Bid), 0); // nothing >= P2
    }

    #[test]
    fn cumulative_depth_single_level_ask() {
        let levels = vec![
            PriceLevel { price: P1, total_amount: 500, order_count: 5, side: Side::Ask },
        ];
        assert_eq!(cumulative_depth(&levels, P1, Side::Ask), 500);
        assert_eq!(cumulative_depth(&levels, P_HALF, Side::Ask), 0); // nothing <= P_HALF
    }

    #[test]
    fn match_no_orders_at_all() {
        let results = match_orders(&[], &[]);
        assert!(results.is_empty());
    }

    #[test]
    fn match_with_fully_filled_orders() {
        let bids = vec![make_partially_filled_bid(1, P1, 100, 100)]; // 0 remaining
        let asks = vec![make_ask(2, P_HALF, 100, 1)];
        let results = match_orders(&bids, &asks);
        assert!(results.is_empty());
    }

    #[test]
    fn simulate_sell_multi_level() {
        let orders = vec![
            make_bid(1, P2, 50, 1),
            make_bid(2, P1, 50, 2),
        ];
        let snap = build_snapshot(&orders);
        // Sell 80: 50 @ 2.0, 30 @ 1.0
        let fill = simulate_market_order(&snap, Side::Ask, 80).unwrap();
        assert_eq!(fill.filled_amount, 80);
        // cost = 50*2 + 30*1 = 130 → avg = 130/80 * P
        let expected_avg = mul_div(130, PRECISION, 80);
        assert_eq!(fill.avg_price, expected_avg);
    }

    #[test]
    fn order_fill_has_zero_id_for_simulation() {
        let orders = vec![make_ask(1, P1, 100, 1)];
        let snap = build_snapshot(&orders);
        let fill = simulate_market_order(&snap, Side::Bid, 50).unwrap();
        assert_eq!(fill.order_id, 0); // anonymous simulation
    }

    #[test]
    fn book_depth_with_partial_fills() {
        let orders = vec![
            make_partially_filled_bid(1, P1, 100, 30),   // 70 remaining
            make_partially_filled_ask(2, P2, 200, 100),   // 100 remaining
        ];
        let snap = build_snapshot(&orders);
        let depth = book_depth(&snap);
        assert_eq!(depth.bid_depth, 70);
        assert_eq!(depth.ask_depth, 100);
    }

    #[test]
    fn owner_preserved_in_order() {
        let owner = [0xAB; 32];
        let order = make_bid_with_owner(1, P1, 100, owner);
        assert_eq!(order.owner, owner);
    }

    #[test]
    fn side_clone_and_eq() {
        let s1 = Side::Bid;
        let s2 = s1;
        assert_eq!(s1, s2);
        assert_ne!(Side::Bid, Side::Ask);
    }

    #[test]
    fn error_clone_and_eq() {
        let e1 = OrderbookError::EmptyBook;
        let e2 = e1.clone();
        assert_eq!(e1, e2);
    }

    #[test]
    fn error_variants_distinct() {
        assert_ne!(OrderbookError::EmptyBook, OrderbookError::InvalidPrice);
        assert_ne!(OrderbookError::InvalidAmount, OrderbookError::BookFull);
        assert_ne!(
            OrderbookError::OrderNotFound(1),
            OrderbookError::OrderNotFound(2)
        );
        assert_ne!(
            OrderbookError::DuplicateOrder(1),
            OrderbookError::PriceLevelFull(1)
        );
    }

    #[test]
    fn match_result_fields() {
        let mr = MatchResult {
            maker_id: 10,
            taker_id: 20,
            price: P1,
            amount: 500,
            side: Side::Bid,
        };
        assert_eq!(mr.maker_id, 10);
        assert_eq!(mr.taker_id, 20);
        assert_eq!(mr.price, P1);
        assert_eq!(mr.amount, 500);
        assert_eq!(mr.side, Side::Bid);
    }

    #[test]
    fn price_level_fields() {
        let pl = PriceLevel {
            price: P2,
            total_amount: 1000,
            order_count: 5,
            side: Side::Ask,
        };
        assert_eq!(pl.price, P2);
        assert_eq!(pl.total_amount, 1000);
        assert_eq!(pl.order_count, 5);
        assert_eq!(pl.side, Side::Ask);
    }

    #[test]
    fn book_snapshot_debug() {
        let snap = build_snapshot(&[]);
        // Just ensure Debug is implemented and doesn't panic
        let _ = format!("{:?}", snap);
    }

    #[test]
    fn vwap_result_debug() {
        let vr = VWAPResult {
            vwap: P1,
            total_volume: 100,
            levels_consumed: 1,
        };
        let _ = format!("{:?}", vr);
    }

    #[test]
    fn order_fill_debug() {
        let of = OrderFill {
            order_id: 0,
            filled_amount: 100,
            remaining: 0,
            avg_price: P1,
            total_cost: 100,
        };
        let _ = format!("{:?}", of);
    }

    #[test]
    fn book_depth_debug() {
        let bd = BookDepth {
            bid_depth: 100,
            ask_depth: 200,
            total_depth: 300,
            imbalance_bps: -3333,
            levels: 4,
        };
        let _ = format!("{:?}", bd);
    }

    // ============ Hardening Tests v3 ============

    #[test]
    fn snapshot_large_order_count_per_level_v3() {
        // Many orders at the same price should aggregate
        let mut orders = Vec::new();
        for i in 0..50 {
            orders.push(make_bid(i, P1, 10, i));
        }
        let snap = build_snapshot(&orders);
        assert_eq!(snap.bids.len(), 1);
        assert_eq!(snap.bids[0].total_amount, 500);
        assert_eq!(snap.bids[0].order_count, 50);
    }

    #[test]
    fn snapshot_mixed_filled_and_unfilled_v3() {
        let orders = vec![
            make_bid(1, P1, 100, 1),
            make_partially_filled_bid(2, P1, 200, 150), // 50 remaining
            make_partially_filled_bid(3, P1, 100, 100),  // 0 remaining (fully filled)
        ];
        let snap = build_snapshot(&orders);
        assert_eq!(snap.bids.len(), 1);
        assert_eq!(snap.bids[0].total_amount, 150); // 100 + 50 + 0
    }

    #[test]
    fn match_all_bids_filled_asks_remain_v3() {
        let bids = vec![make_bid(1, P2, 50, 1)];
        let asks = vec![make_ask(2, P1, 200, 1)];
        let results = match_orders(&bids, &asks);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].amount, 50); // limited by bid
    }

    #[test]
    fn match_all_asks_filled_bids_remain_v3() {
        let bids = vec![make_bid(1, P2, 200, 1)];
        let asks = vec![make_ask(2, P1, 50, 1)];
        let results = match_orders(&bids, &asks);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].amount, 50); // limited by ask
    }

    #[test]
    fn simulate_buy_exactly_first_level_boundary_v3() {
        let orders = vec![
            make_ask(1, P1, 100, 1),
            make_ask(2, P2, 100, 2),
        ];
        let snap = build_snapshot(&orders);
        let fill = simulate_market_order(&snap, Side::Bid, 100).unwrap();
        assert_eq!(fill.filled_amount, 100);
        assert_eq!(fill.avg_price, P1); // Only consumed first level
    }

    #[test]
    fn simulate_sell_exactly_first_level_boundary_v3() {
        let orders = vec![
            make_bid(1, P2, 100, 1),
            make_bid(2, P1, 100, 2),
        ];
        let snap = build_snapshot(&orders);
        let fill = simulate_market_order(&snap, Side::Ask, 100).unwrap();
        assert_eq!(fill.filled_amount, 100);
        assert_eq!(fill.avg_price, P2);
    }

    #[test]
    fn vwap_single_unit_amount_v3() {
        let levels = vec![
            PriceLevel { price: P1, total_amount: 1000, order_count: 5, side: Side::Ask },
        ];
        let result = vwap(&levels, 1).unwrap();
        assert_eq!(result.vwap, P1);
        assert_eq!(result.total_volume, 1);
        assert_eq!(result.levels_consumed, 1);
    }

    #[test]
    fn impact_buy_one_unit_minimal_v3() {
        let orders = vec![make_ask(1, P1, 1000, 1)];
        let snap = build_snapshot(&orders);
        let result = price_impact(&snap, Side::Bid, 1);
        assert!(result.is_ok());
        let impact = result.unwrap();
        assert_eq!(impact, 0); // 1 unit has zero impact against 1000
    }

    #[test]
    fn best_bid_partially_filled_still_counts_v3() {
        let orders = vec![
            make_partially_filled_bid(1, P2, 100, 50), // 50 remaining
            make_bid(2, P1, 100, 1),
        ];
        let bb = best_bid(&orders);
        assert_eq!(bb, Some(P2)); // P2 still has remaining amount
    }

    #[test]
    fn best_ask_partially_filled_still_counts_v3() {
        let orders = vec![
            make_partially_filled_ask(1, P1, 100, 50), // 50 remaining
            make_ask(2, P2, 100, 1),
        ];
        let ba = best_ask(&orders);
        assert_eq!(ba, Some(P1)); // P1 still has remaining amount
    }

    #[test]
    fn spread_very_wide_v3() {
        // bid=1, ask=10000
        let bps = spread_bps(PRECISION, 10000 * PRECISION);
        assert!(bps > 0);
    }

    #[test]
    fn midpoint_overflow_safe_v3() {
        // Large values should not overflow in midpoint
        let mid = midpoint(u128::MAX / 2, u128::MAX / 2 + 2);
        assert!(mid >= u128::MAX / 2);
    }

    #[test]
    fn depth_at_price_ask_side_v3() {
        let orders = vec![
            make_ask(1, P1, 100, 1),
            make_ask(2, P1, 200, 2),
            make_ask(3, P2, 300, 3),
        ];
        assert_eq!(depth_at_price(&orders, P1, Side::Ask), 300);
        assert_eq!(depth_at_price(&orders, P2, Side::Ask), 300);
        assert_eq!(depth_at_price(&orders, P1, Side::Bid), 0); // wrong side
    }

    #[test]
    fn cumulative_depth_bids_multiple_levels_v3() {
        let levels = vec![
            PriceLevel { price: 3 * PRECISION, total_amount: 100, order_count: 1, side: Side::Bid },
            PriceLevel { price: 2 * PRECISION, total_amount: 200, order_count: 1, side: Side::Bid },
            PriceLevel { price: PRECISION, total_amount: 300, order_count: 1, side: Side::Bid },
        ];
        // Bids: sum levels >= up_to_price
        assert_eq!(cumulative_depth(&levels, 2 * PRECISION, Side::Bid), 300); // 100 + 200
        assert_eq!(cumulative_depth(&levels, PRECISION, Side::Bid), 600); // all
    }

    #[test]
    fn imbalance_extreme_bid_heavy_v3() {
        let bps = order_imbalance_bps(10000, 1);
        assert!(bps > 9000); // Extremely bid-heavy
    }

    #[test]
    fn imbalance_extreme_ask_heavy_v3() {
        let bps = order_imbalance_bps(1, 10000);
        assert!(bps < -9000); // Extremely ask-heavy
    }

    #[test]
    fn cancel_middle_order_v3() {
        let mut orders = vec![
            make_bid(1, P1, 100, 1),
            make_bid(2, P2, 200, 2),
            make_bid(3, 3 * PRECISION, 300, 3),
        ];
        let removed = cancel_order(&mut orders, 2).unwrap();
        assert_eq!(removed.price, P2);
        assert_eq!(orders.len(), 2);
    }

    #[test]
    fn sort_bids_stable_equal_price_equal_time_v3() {
        let mut orders = vec![
            make_bid(1, P1, 100, 5),
            make_bid(2, P1, 200, 5),
            make_bid(3, P1, 300, 5),
        ];
        sort_orders_price_time(&mut orders, Side::Bid);
        // All same price and time — order should be deterministic
        assert_eq!(orders[0].price, P1);
        assert_eq!(orders[1].price, P1);
        assert_eq!(orders[2].price, P1);
    }

    #[test]
    fn sort_asks_many_prices_v3() {
        let mut orders = vec![
            make_ask(1, 5 * PRECISION, 100, 1),
            make_ask(2, PRECISION, 100, 2),
            make_ask(3, 3 * PRECISION, 100, 3),
            make_ask(4, 2 * PRECISION, 100, 4),
            make_ask(5, 4 * PRECISION, 100, 5),
        ];
        sort_orders_price_time(&mut orders, Side::Ask);
        // Should be ascending
        for i in 0..4 {
            assert!(orders[i].price <= orders[i + 1].price);
        }
    }

    #[test]
    fn match_three_bids_two_asks_partial_v3() {
        let bids = vec![
            make_bid(1, 3 * PRECISION, 100, 1),
            make_bid(2, 2 * PRECISION, 100, 2),
            make_bid(3, PRECISION, 100, 3),
        ];
        let asks = vec![
            make_ask(4, PRECISION, 150, 1),
            make_ask(5, 2 * PRECISION, 150, 2),
        ];
        let results = match_orders(&bids, &asks);
        let total_matched: u128 = results.iter().map(|r| r.amount).sum();
        assert!(total_matched > 0);
        assert!(total_matched <= 300); // Can't exceed total bid volume
    }

    #[test]
    fn snapshot_bid_ask_ordering_correct_v3() {
        let orders = vec![
            make_bid(1, 3 * PRECISION, 100, 1),
            make_bid(2, PRECISION, 100, 2),
            make_bid(3, 2 * PRECISION, 100, 3),
            make_ask(4, 4 * PRECISION, 100, 4),
            make_ask(5, 6 * PRECISION, 100, 5),
            make_ask(6, 5 * PRECISION, 100, 6),
        ];
        let snap = build_snapshot(&orders);
        // Bids should be descending
        for i in 0..snap.bids.len().saturating_sub(1) {
            assert!(snap.bids[i].price >= snap.bids[i + 1].price);
        }
        // Asks should be ascending
        for i in 0..snap.asks.len().saturating_sub(1) {
            assert!(snap.asks[i].price <= snap.asks[i + 1].price);
        }
    }

    #[test]
    fn vwap_exactly_two_full_levels_v3() {
        let levels = vec![
            PriceLevel { price: P1, total_amount: 100, order_count: 1, side: Side::Ask },
            PriceLevel { price: P2, total_amount: 100, order_count: 1, side: Side::Ask },
        ];
        let result = vwap(&levels, 200).unwrap();
        // VWAP = (100*P1 + 100*P2) / 200 = (P1 + P2) / 2
        let expected = mul_div(P1 + P2, PRECISION, 2 * PRECISION);
        // Use mul_div-based expected: (100*P1 + 100*P2) / 200
        let expected_vwap = mul_div(100 * P1 + 100 * P2, 1, 200);
        assert_eq!(result.vwap, expected_vwap);
        assert_eq!(result.levels_consumed, 2);
    }

    #[test]
    fn remaining_amount_zero_filled_v3() {
        let order = make_bid(1, P1, 500, 1);
        assert_eq!(order.remaining(), 500);
        assert_eq!(order.filled, 0);
    }

    #[test]
    fn book_depth_empty_snapshot_v3() {
        let snap = build_snapshot(&[]);
        let depth = book_depth(&snap);
        assert_eq!(depth.bid_depth, 0);
        assert_eq!(depth.ask_depth, 0);
        assert_eq!(depth.total_depth, 0);
        assert_eq!(depth.levels, 0);
    }

    // ============ Hardening Tests v6 ============

    #[test]
    fn snapshot_fully_filled_orders_ignored_v6() {
        // A fully filled order should not appear in the snapshot
        let orders = vec![
            make_partially_filled_bid(1, P1, 100, 100), // fully filled
            make_ask(2, P2, 200, 1),
        ];
        let snap = build_snapshot(&orders);
        assert!(snap.bids.is_empty());
        assert_eq!(snap.asks.len(), 1);
        assert_eq!(snap.best_bid, None);
    }

    #[test]
    fn snapshot_partially_filled_shows_remaining_v6() {
        let orders = vec![
            make_partially_filled_bid(1, P1, 100, 40),
        ];
        let snap = build_snapshot(&orders);
        assert_eq!(snap.bids[0].total_amount, 60);
    }

    #[test]
    fn snapshot_crossed_book_spread_zero_v6() {
        // Bid price > ask price = crossed book
        let orders = vec![
            make_bid(1, P2, 100, 1),
            make_ask(2, P1, 100, 1),
        ];
        let snap = build_snapshot(&orders);
        assert_eq!(snap.spread, Some(0));
        assert_eq!(snap.spread_bps, Some(0));
    }

    #[test]
    fn snapshot_multiple_orders_same_price_v6() {
        let orders = vec![
            make_bid(1, P1, 100, 1),
            make_bid(2, P1, 200, 2),
            make_bid(3, P1, 300, 3),
        ];
        let snap = build_snapshot(&orders);
        assert_eq!(snap.bids.len(), 1);
        assert_eq!(snap.bids[0].total_amount, 600);
        assert_eq!(snap.bids[0].order_count, 3);
    }

    #[test]
    fn match_orders_empty_bids_v6() {
        let asks = vec![make_ask(1, P1, 100, 1)];
        let results = match_orders(&[], &asks);
        assert!(results.is_empty());
    }

    #[test]
    fn match_orders_empty_asks_v6() {
        let bids = vec![make_bid(1, P2, 100, 1)];
        let results = match_orders(&bids, &[]);
        assert!(results.is_empty());
    }

    #[test]
    fn match_orders_no_overlap_v6() {
        // Bid at 1.0, ask at 2.0 — no crossing
        let bids = vec![make_bid(1, P1, 100, 1)];
        let asks = vec![make_ask(2, P2, 100, 1)];
        let results = match_orders(&bids, &asks);
        assert!(results.is_empty());
    }

    #[test]
    fn match_orders_exact_cross_v6() {
        // Bid at 2.0, ask at 1.0 — crosses
        let bids = vec![make_bid(1, P2, 50, 1)];
        let asks = vec![make_ask(2, P1, 50, 1)];
        let results = match_orders(&bids, &asks);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].amount, 50);
        assert_eq!(results[0].price, P1); // matches at ask's price
    }

    #[test]
    fn match_orders_partial_fill_v6() {
        let bids = vec![make_bid(1, P2, 100, 1)];
        let asks = vec![make_ask(2, P1, 30, 1)];
        let results = match_orders(&bids, &asks);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].amount, 30);
    }

    #[test]
    fn match_orders_multiple_asks_fill_one_bid_v6() {
        let bids = vec![make_bid(1, P2, 100, 1)];
        let asks = vec![
            make_ask(2, P1, 40, 1),
            make_ask(3, P1, 60, 2),
        ];
        let results = match_orders(&bids, &asks);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].amount + results[1].amount, 100);
    }

    #[test]
    fn simulate_market_order_zero_amount_v6() {
        let snap = build_snapshot(&[make_ask(1, P1, 100, 1)]);
        let result = simulate_market_order(&snap, Side::Bid, 0);
        assert_eq!(result, Err(OrderbookError::InvalidAmount));
    }

    #[test]
    fn simulate_market_order_empty_book_v6() {
        let snap = build_snapshot(&[]);
        let result = simulate_market_order(&snap, Side::Bid, 100);
        assert_eq!(result, Err(OrderbookError::EmptyBook));
    }

    #[test]
    fn simulate_market_order_exact_fill_v6() {
        let orders = vec![make_ask(1, P1, 100, 1)];
        let snap = build_snapshot(&orders);
        let fill = simulate_market_order(&snap, Side::Bid, 100).unwrap();
        assert_eq!(fill.filled_amount, 100);
        assert_eq!(fill.remaining, 0);
    }

    #[test]
    fn simulate_market_order_insufficient_depth_v6() {
        let orders = vec![make_ask(1, P1, 50, 1)];
        let snap = build_snapshot(&orders);
        let result = simulate_market_order(&snap, Side::Bid, 100);
        match result {
            Err(OrderbookError::InsufficientDepth { requested, available }) => {
                assert_eq!(requested, 100);
                assert_eq!(available, 50);
            }
            _ => panic!("Expected InsufficientDepth"),
        }
    }

    #[test]
    fn book_depth_bid_only_v6() {
        let orders = vec![make_bid(1, P1, 100, 1)];
        let snap = build_snapshot(&orders);
        let depth = book_depth(&snap);
        assert_eq!(depth.bid_depth, 100);
        assert_eq!(depth.ask_depth, 0);
        assert!(depth.imbalance_bps > 0); // bid heavy = positive
    }

    #[test]
    fn book_depth_ask_only_v6() {
        let orders = vec![make_ask(1, P1, 100, 1)];
        let snap = build_snapshot(&orders);
        let depth = book_depth(&snap);
        assert_eq!(depth.bid_depth, 0);
        assert_eq!(depth.ask_depth, 100);
        assert!(depth.imbalance_bps < 0); // ask heavy = negative
    }

    #[test]
    fn book_depth_balanced_v6() {
        let orders = vec![
            make_bid(1, P1, 100, 1),
            make_ask(2, P2, 100, 1),
        ];
        let snap = build_snapshot(&orders);
        let depth = book_depth(&snap);
        assert_eq!(depth.imbalance_bps, 0);
    }

    #[test]
    fn vwap_single_level_v6() {
        let levels = vec![PriceLevel {
            price: P1,
            total_amount: 100,
            order_count: 1,
            side: Side::Ask,
        }];
        let result = vwap(&levels, 50).unwrap();
        assert_eq!(result.vwap, P1);
        assert_eq!(result.total_volume, 50);
        assert_eq!(result.levels_consumed, 1);
    }

    #[test]
    fn vwap_zero_amount_error_v6() {
        let levels = vec![PriceLevel {
            price: P1,
            total_amount: 100,
            order_count: 1,
            side: Side::Ask,
        }];
        let result = vwap(&levels, 0);
        assert_eq!(result, Err(OrderbookError::InvalidAmount));
    }

    #[test]
    fn vwap_empty_levels_error_v6() {
        let result = vwap(&[], 100);
        assert_eq!(result, Err(OrderbookError::EmptyBook));
    }

    #[test]
    fn price_impact_zero_amount_v6() {
        let snap = build_snapshot(&[make_ask(1, P1, 100, 1)]);
        let result = price_impact(&snap, Side::Bid, 0);
        assert_eq!(result, Err(OrderbookError::InvalidAmount));
    }

    #[test]
    fn price_impact_small_order_low_impact_v6() {
        let orders = vec![
            make_ask(1, P1, 1000, 1),
            make_ask(2, P1 + P1 / 100, 1000, 2), // 1% higher
        ];
        let snap = build_snapshot(&orders);
        let impact = price_impact(&snap, Side::Bid, 1).unwrap();
        assert_eq!(impact, 0, "Tiny order should have near-zero impact");
    }

    #[test]
    fn spread_bps_zero_bid_v6() {
        assert_eq!(spread_bps(0, P1), 0);
    }

    #[test]
    fn spread_bps_crossed_v6() {
        // Ask < bid = crossed book
        assert_eq!(spread_bps(P2, P1), 0);
    }

    #[test]
    fn spread_bps_equal_v6() {
        assert_eq!(spread_bps(P1, P1), 0);
    }

    #[test]
    fn spread_bps_normal_v6() {
        let s = spread_bps(P1, P2);
        assert_eq!(s, 10000); // 100% spread
    }

    #[test]
    fn midpoint_calculation_v6() {
        let mid = midpoint(P1, P2);
        // (P1/2 + P2/2) = P1/2 + P1 = P1 * 1.5
        let expected = P1 / 2 + P2 / 2;
        assert_eq!(mid, expected);
    }

    #[test]
    fn depth_at_price_no_match_v6() {
        let orders = vec![make_bid(1, P1, 100, 1)];
        assert_eq!(depth_at_price(&orders, P2, Side::Bid), 0);
    }

    #[test]
    fn depth_at_price_exact_match_v6() {
        let orders = vec![
            make_bid(1, P1, 100, 1),
            make_bid(2, P1, 200, 2),
        ];
        assert_eq!(depth_at_price(&orders, P1, Side::Bid), 300);
    }

    #[test]
    fn cancel_order_success_v6() {
        let mut orders = vec![
            make_bid(1, P1, 100, 1),
            make_ask(2, P2, 200, 1),
        ];
        let removed = cancel_order(&mut orders, 1).unwrap();
        assert_eq!(removed.order_id, 1);
        assert_eq!(orders.len(), 1);
    }

    #[test]
    fn cancel_order_not_found_v6() {
        let mut orders = vec![make_bid(1, P1, 100, 1)];
        let result = cancel_order(&mut orders, 999);
        assert_eq!(result, Err(OrderbookError::OrderNotFound(999)));
    }

    #[test]
    fn sort_orders_bids_descending_v6() {
        let mut orders = vec![
            make_bid(1, P1, 100, 1),
            make_bid(2, P2, 100, 1),
            make_bid(3, P_HALF, 100, 1),
        ];
        sort_orders_price_time(&mut orders, Side::Bid);
        assert_eq!(orders[0].price, P2);
        assert_eq!(orders[1].price, P1);
        assert_eq!(orders[2].price, P_HALF);
    }

    #[test]
    fn sort_orders_asks_ascending_v6() {
        let mut orders = vec![
            make_ask(1, P2, 100, 1),
            make_ask(2, P1, 100, 1),
            make_ask(3, P_HALF, 100, 1),
        ];
        sort_orders_price_time(&mut orders, Side::Ask);
        assert_eq!(orders[0].price, P_HALF);
        assert_eq!(orders[1].price, P1);
        assert_eq!(orders[2].price, P2);
    }

    #[test]
    fn sort_orders_same_price_by_time_v6() {
        let mut orders = vec![
            make_bid(1, P1, 100, 3),
            make_bid(2, P1, 100, 1),
            make_bid(3, P1, 100, 2),
        ];
        sort_orders_price_time(&mut orders, Side::Bid);
        assert_eq!(orders[0].timestamp, 1);
        assert_eq!(orders[1].timestamp, 2);
        assert_eq!(orders[2].timestamp, 3);
    }

    #[test]
    fn order_imbalance_all_bids_v6() {
        let imb = order_imbalance_bps(1000, 0);
        assert_eq!(imb, 10000); // 100% bid heavy
    }

    #[test]
    fn order_imbalance_all_asks_v6() {
        let imb = order_imbalance_bps(0, 1000);
        assert_eq!(imb, -10000); // 100% ask heavy
    }

    #[test]
    fn order_imbalance_equal_v6() {
        let imb = order_imbalance_bps(500, 500);
        assert_eq!(imb, 0);
    }

    #[test]
    fn order_imbalance_zero_zero_v6() {
        let imb = order_imbalance_bps(0, 0);
        assert_eq!(imb, 0);
    }

    #[test]
    fn best_bid_none_for_empty_v6() {
        assert_eq!(best_bid(&[]), None);
    }

    #[test]
    fn best_ask_none_for_empty_v6() {
        assert_eq!(best_ask(&[]), None);
    }

    #[test]
    fn best_bid_ignores_asks_v6() {
        let orders = vec![make_ask(1, P1, 100, 1)];
        assert_eq!(best_bid(&orders), None);
    }

    #[test]
    fn best_ask_ignores_bids_v6() {
        let orders = vec![make_bid(1, P1, 100, 1)];
        assert_eq!(best_ask(&orders), None);
    }

    #[test]
    fn cumulative_depth_bid_side_v6() {
        let levels = vec![
            PriceLevel { price: P2, total_amount: 100, order_count: 1, side: Side::Bid },
            PriceLevel { price: P1, total_amount: 200, order_count: 1, side: Side::Bid },
            PriceLevel { price: P_HALF, total_amount: 300, order_count: 1, side: Side::Bid },
        ];
        // Cumulative depth at P1 includes P2 and P1 (prices >= P1)
        let depth = cumulative_depth(&levels, P1, Side::Bid);
        assert_eq!(depth, 300); // 100 + 200
    }

    #[test]
    fn cumulative_depth_ask_side_v6() {
        let levels = vec![
            PriceLevel { price: P_HALF, total_amount: 100, order_count: 1, side: Side::Ask },
            PriceLevel { price: P1, total_amount: 200, order_count: 1, side: Side::Ask },
            PriceLevel { price: P2, total_amount: 300, order_count: 1, side: Side::Ask },
        ];
        // Cumulative depth at P1 includes P_HALF and P1 (prices <= P1)
        let depth = cumulative_depth(&levels, P1, Side::Ask);
        assert_eq!(depth, 300); // 100 + 200
    }
}
