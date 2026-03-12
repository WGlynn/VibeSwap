// ============ Settlement — Batch Auction Resolution & Order Matching ============
// Implements phase 3 of VibeSwap's commit-reveal batch auction:
//   1. fisher_yates_shuffle()      → Deterministic shuffle using XORed secrets
//   2. discover_clearing_price()   → Find uniform clearing price
//   3. match_orders()              → Fill orders at clearing price
//   4. compute_fill()              → Single order fill computation
//   5. is_fillable()               → Check if order fills at clearing price
//   6. compute_proceeds()          → What user receives after fill
//   7. distribute_fees()           → Split priority fees between LPs and protocol
//   8. validate_batch()            → Pre-settlement validation
//   9. compute_xor_seed()          → XOR all secrets into deterministic seed
//  10. batch_summary()             → Post-settlement analytics
//  11. priority_ordering()         → Priority-fee-weighted ordering within shuffle
//  12. estimate_clearing_price()   → Quick estimate from order book tuples
//  13. partial_fill_amount()       → Compute partial fill against remaining liquidity
//  14. settlement_quality()        → Quality score (0-10000) for settlement outcome
//
// All prices use PRECISION (1e18) fixed-point scaling.
// Math overflow is handled via vibeswap_math::mul_div (256-bit intermediate).

use vibeswap_math::PRECISION;
use vibeswap_math::mul_div;

// ============ Constants ============

/// Basis points denominator (10000 = 100%)
pub const BPS: u128 = 10_000;

/// Maximum orders in a single batch
pub const MAX_ORDERS_PER_BATCH: usize = 256;

/// Minimum fill amount (0.000001 VIBE in base units)
pub const MIN_FILL_AMOUNT: u128 = 1_000_000_000_000;

/// Share of priority fees that go to LPs (50%)
pub const PRIORITY_FEE_SHARE_BPS: u16 = 5000;

/// Settlement fee charged on matched volume (0.05%)
pub const SETTLEMENT_FEE_BPS: u16 = 5;

/// Maximum number of distinct price levels for clearing price search
pub const MAX_PRICE_LEVELS: usize = 50;

/// Amounts below this are considered dust and won't be filled
pub const DUST_THRESHOLD: u128 = 1_000;

// ============ Error Types ============

/// Errors returned by settlement functions.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SettlementError {
    /// No orders in the batch
    EmptyBatch,
    /// No buy/sell orders can be matched at any price
    NoMatchingOrders,
    /// Not enough liquidity on one side to fill any orders
    InsufficientLiquidity,
    /// Order has invalid fields
    InvalidOrder,
    /// Could not discover a clearing price
    PriceDiscoveryFailed,
    /// Fisher-Yates shuffle encountered an error
    ShuffleError,
    /// Amount is zero where a positive value is required
    ZeroAmount,
    /// Price is zero where a positive value is required
    ZeroPrice,
    /// Arithmetic overflow during computation
    Overflow,
    /// Batch exceeds MAX_ORDERS_PER_BATCH
    TooManyOrders,
    /// Secret is invalid (all zeros)
    InvalidSecret,
}

// ============ Data Types ============

/// Order side: buy or sell
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OrderType {
    Buy,
    Sell,
}

/// A revealed order ready for settlement
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RevealedOrder {
    /// Owner's public key hash (32 bytes)
    pub owner: [u8; 32],
    /// Buy or Sell
    pub order_type: OrderType,
    /// Amount in base units
    pub amount: u128,
    /// Limit price (PRECISION scale). 0 = market order
    pub limit_price: u128,
    /// Priority fee bid (higher = earlier execution within shuffled order)
    pub priority_fee: u128,
    /// Secret used in commit-reveal (for shuffle seed)
    pub secret: [u8; 32],
    /// Original index in the batch (pre-shuffle)
    pub original_index: u16,
}

/// A single order fill result
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fill {
    /// Owner's public key hash
    pub owner: [u8; 32],
    /// Buy or Sell
    pub order_type: OrderType,
    /// Amount the user originally requested
    pub requested_amount: u128,
    /// Amount actually filled
    pub filled_amount: u128,
    /// Price at which the fill executed (= clearing price)
    pub fill_price: u128,
    /// What the user receives (tokens for buy, payment for sell)
    pub proceeds: u128,
    /// Priority fee paid by this order
    pub priority_fee_paid: u128,
    /// Whether the order was completely filled
    pub is_fully_filled: bool,
}

/// Result of the Fisher-Yates shuffle
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShuffleResult {
    /// Shuffled indices (maps position -> original index)
    pub order: [u16; 256],
    /// Number of valid entries in the order array
    pub count: u16,
    /// XOR of all secrets used as the deterministic seed
    pub xor_seed: [u8; 32],
}

/// Complete settlement result for a batch
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SettlementResult {
    /// Uniform clearing price at which all orders execute
    pub clearing_price: u128,
    /// Total buy-side volume (sum of all buy amounts)
    pub total_buy_volume: u128,
    /// Total sell-side volume (sum of all sell amounts)
    pub total_sell_volume: u128,
    /// Volume actually matched (min of fillable buy/sell)
    pub matched_volume: u128,
    /// Number of orders that received a fill
    pub fill_count: u32,
    /// Number of orders that did not fill
    pub unfilled_count: u32,
    /// Sum of all priority fees from filled orders
    pub total_priority_fees: u128,
    /// Priority fees allocated to liquidity providers
    pub lp_fee_share: u128,
    /// Protocol fee (settlement fee on matched volume)
    pub protocol_fee: u128,
    /// Individual fill records
    pub fills: [Fill; 256],
    /// Actual number of valid fills in the array
    pub fill_count_actual: u16,
}

/// Post-settlement batch summary
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BatchSummary {
    /// Batch identifier
    pub batch_id: u64,
    /// Total orders in the batch
    pub order_count: u32,
    /// Number of buy orders
    pub buy_count: u32,
    /// Number of sell orders
    pub sell_count: u32,
    /// Clearing price at which settlement occurred
    pub clearing_price: u128,
    /// Total matched volume
    pub matched_volume: u128,
    /// Fill rate in basis points (filled / total * 10000)
    pub fill_rate_bps: u16,
    /// Average priority fee across all orders
    pub avg_priority_fee: u128,
    /// Price improvement vs reference price in basis points
    pub price_improvement_bps: u16,
}

// ============ Default Implementations ============

impl Default for Fill {
    fn default() -> Self {
        Fill {
            owner: [0u8; 32],
            order_type: OrderType::Buy,
            requested_amount: 0,
            filled_amount: 0,
            fill_price: 0,
            proceeds: 0,
            priority_fee_paid: 0,
            is_fully_filled: false,
        }
    }
}

// ============ Core Functions ============

/// Compute the XOR of all secrets to produce a deterministic seed.
///
/// Every participant contributes entropy via their secret. XORing all secrets
/// ensures no single party can predict or bias the shuffle outcome (as long as
/// at least one secret is honestly random).
pub fn compute_xor_seed(secrets: &[[u8; 32]]) -> [u8; 32] {
    let mut seed = [0u8; 32];
    for secret in secrets {
        for i in 0..32 {
            seed[i] ^= secret[i];
        }
    }
    seed
}

/// Fisher-Yates shuffle of order indices using XORed secrets as entropy.
///
/// This produces a deterministic, verifiable permutation of the order indices.
/// The shuffle prevents front-running by ensuring execution order cannot be
/// predicted before all secrets are revealed.
///
/// Algorithm:
///   1. XOR all secrets to produce a 32-byte seed
///   2. Initialize indices [0, 1, 2, ..., count-1]
///   3. For i from count-1 down to 1:
///      - Use 2 bytes from seed (cycling) to compute j = seed_bytes % (i+1)
///      - Swap indices[i] and indices[j]
pub fn fisher_yates_shuffle(secrets: &[[u8; 32]], count: u16) -> ShuffleResult {
    let xor_seed = compute_xor_seed(secrets);

    let mut order = [0u16; 256];
    let n = count as usize;

    // Initialize identity permutation
    for i in 0..n {
        order[i] = i as u16;
    }

    if n <= 1 {
        return ShuffleResult {
            order,
            count,
            xor_seed,
        };
    }

    // Fisher-Yates: iterate from last to second element
    let mut seed_pos: usize = 0;
    for i in (1..n).rev() {
        // Extract 2 bytes from seed for randomness, cycling through seed
        let b0 = xor_seed[seed_pos % 32] as usize;
        let b1 = xor_seed[(seed_pos + 1) % 32] as usize;
        seed_pos += 2;

        let rand_val = (b0 << 8) | b1;
        let j = rand_val % (i + 1);

        // Swap
        order.swap(i, j);
    }

    ShuffleResult {
        order,
        count,
        xor_seed,
    }
}

/// Check if a single order is fillable at the given clearing price.
///
/// - Buy orders fill if: limit_price >= clearing_price OR limit_price == 0 (market order)
/// - Sell orders fill if: limit_price <= clearing_price OR limit_price == 0 (market order)
/// - Orders with zero amount are never fillable
/// - Orders below DUST_THRESHOLD are never fillable
pub fn is_fillable(order: &RevealedOrder, clearing_price: u128) -> bool {
    if order.amount == 0 || order.amount < DUST_THRESHOLD {
        return false;
    }

    match order.order_type {
        OrderType::Buy => {
            // Market orders always fill; limit orders fill if willing to pay >= clearing
            order.limit_price == 0 || order.limit_price >= clearing_price
        }
        OrderType::Sell => {
            // Market orders always fill; limit orders fill if willing to sell at <= clearing
            order.limit_price == 0 || order.limit_price <= clearing_price
        }
    }
}

/// Compute what the user receives from a fill.
///
/// - Buyers pay `amount` of quote currency, receive `amount * PRECISION / clearing_price` tokens
/// - Sellers provide `amount` of tokens, receive `amount * clearing_price / PRECISION` quote currency
pub fn compute_proceeds(fill_amount: u128, clearing_price: u128, order_type: &OrderType) -> u128 {
    if fill_amount == 0 || clearing_price == 0 {
        return 0;
    }

    match order_type {
        OrderType::Buy => {
            // Buyer spends fill_amount of quote, gets tokens
            // tokens = fill_amount * PRECISION / clearing_price
            mul_div(fill_amount, PRECISION, clearing_price)
        }
        OrderType::Sell => {
            // Seller provides fill_amount of tokens, gets quote
            // quote = fill_amount * clearing_price / PRECISION
            mul_div(fill_amount, clearing_price, PRECISION)
        }
    }
}

/// Compute the fill result for a single order at the given clearing price.
pub fn compute_fill(order: &RevealedOrder, clearing_price: u128) -> Fill {
    let fillable = is_fillable(order, clearing_price);

    if !fillable {
        return Fill {
            owner: order.owner,
            order_type: order.order_type,
            requested_amount: order.amount,
            filled_amount: 0,
            fill_price: clearing_price,
            proceeds: 0,
            priority_fee_paid: 0,
            is_fully_filled: false,
        };
    }

    let proceeds = compute_proceeds(order.amount, clearing_price, &order.order_type);

    Fill {
        owner: order.owner,
        order_type: order.order_type,
        requested_amount: order.amount,
        filled_amount: order.amount,
        fill_price: clearing_price,
        proceeds,
        priority_fee_paid: order.priority_fee,
        is_fully_filled: true,
    }
}

/// Distribute fees between LPs and protocol.
///
/// - LP share: `total_priority_fees * PRIORITY_FEE_SHARE_BPS / BPS`
/// - Protocol share: `matched_volume * SETTLEMENT_FEE_BPS / BPS`
///
/// Returns `(lp_share, protocol_share)`.
pub fn distribute_fees(total_priority_fees: u128, matched_volume: u128) -> (u128, u128) {
    let lp_share = mul_div(total_priority_fees, PRIORITY_FEE_SHARE_BPS as u128, BPS);
    let protocol_share = mul_div(matched_volume, SETTLEMENT_FEE_BPS as u128, BPS);
    (lp_share, protocol_share)
}

/// Validate a batch of revealed orders before settlement.
///
/// Checks:
/// - Batch is not empty
/// - Batch does not exceed MAX_ORDERS_PER_BATCH
/// - No order has zero amount
/// - No secret is all zeros (invalid entropy)
pub fn validate_batch(orders: &[RevealedOrder]) -> Result<(), SettlementError> {
    if orders.is_empty() {
        return Err(SettlementError::EmptyBatch);
    }

    if orders.len() > MAX_ORDERS_PER_BATCH {
        return Err(SettlementError::TooManyOrders);
    }

    for order in orders {
        if order.amount == 0 {
            return Err(SettlementError::ZeroAmount);
        }
        if order.secret == [0u8; 32] {
            return Err(SettlementError::InvalidSecret);
        }
    }

    Ok(())
}

/// Discover the uniform clearing price from a set of revealed orders.
///
/// The clearing price is the price at which the cumulative buy volume
/// (orders willing to buy at >= price) meets or exceeds the cumulative
/// sell volume (orders willing to sell at <= price).
///
/// Algorithm:
///   1. Collect all non-zero limit prices from orders
///   2. Add midpoints between adjacent prices for finer resolution
///   3. For each candidate price, compute fillable buy and sell volume
///   4. Select the price that maximizes matched volume (min of buy, sell)
///   5. Among ties, prefer the price closest to the midpoint of buy/sell ranges
pub fn discover_clearing_price(orders: &[RevealedOrder]) -> Result<u128, SettlementError> {
    if orders.is_empty() {
        return Err(SettlementError::EmptyBatch);
    }

    // Separate buy and sell orders
    let mut has_buys = false;
    let mut has_sells = false;
    for order in orders {
        match order.order_type {
            OrderType::Buy => has_buys = true,
            OrderType::Sell => has_sells = true,
        }
    }

    if !has_buys || !has_sells {
        return Err(SettlementError::NoMatchingOrders);
    }

    // Collect all unique limit prices as candidate clearing prices
    let mut candidates: Vec<u128> = Vec::new();
    for order in orders {
        if order.limit_price > 0 && !candidates.contains(&order.limit_price) {
            candidates.push(order.limit_price);
        }
    }

    if candidates.is_empty() {
        // All market orders — no limit prices to anchor clearing price
        return Err(SettlementError::PriceDiscoveryFailed);
    }

    candidates.sort();

    // Add midpoints between adjacent prices for finer resolution
    let mut with_midpoints: Vec<u128> = Vec::new();
    for i in 0..candidates.len() {
        with_midpoints.push(candidates[i]);
        if i + 1 < candidates.len() {
            let mid = candidates[i] / 2 + candidates[i + 1] / 2;
            if mid > candidates[i] && mid < candidates[i + 1] {
                with_midpoints.push(mid);
            }
        }
    }

    // For each candidate, compute fillable volume on each side
    let mut best_price: u128 = 0;
    let mut best_matched: u128 = 0;

    for &price in &with_midpoints {
        let mut buy_vol: u128 = 0;
        let mut sell_vol: u128 = 0;

        for order in orders {
            if is_fillable(order, price) {
                match order.order_type {
                    OrderType::Buy => {
                        buy_vol = buy_vol.saturating_add(order.amount);
                    }
                    OrderType::Sell => {
                        sell_vol = sell_vol.saturating_add(order.amount);
                    }
                }
            }
        }

        // Matched volume is limited by the smaller side
        let matched = buy_vol.min(sell_vol);

        if matched > best_matched || (matched == best_matched && best_price == 0) {
            best_matched = matched;
            best_price = price;
        }
    }

    if best_price == 0 || best_matched == 0 {
        return Err(SettlementError::NoMatchingOrders);
    }

    Ok(best_price)
}

/// Match orders at the uniform clearing price and produce settlement results.
///
/// This is the main settlement function. After discovering the clearing price,
/// it fills all eligible orders, computes proceeds, distributes fees, and
/// returns the complete settlement result.
pub fn match_orders(
    orders: &[RevealedOrder],
    clearing_price: u128,
) -> Result<SettlementResult, SettlementError> {
    if orders.is_empty() {
        return Err(SettlementError::EmptyBatch);
    }

    if clearing_price == 0 {
        return Err(SettlementError::ZeroPrice);
    }

    let mut total_buy_volume: u128 = 0;
    let mut total_sell_volume: u128 = 0;
    let mut matched_buy: u128 = 0;
    let mut matched_sell: u128 = 0;
    let mut total_priority_fees: u128 = 0;
    let mut fill_count: u32 = 0;
    let mut unfilled_count: u32 = 0;

    // Use default-initialized array for fills
    const DEFAULT_FILL: Fill = Fill {
        owner: [0u8; 32],
        order_type: OrderType::Buy,
        requested_amount: 0,
        filled_amount: 0,
        fill_price: 0,
        proceeds: 0,
        priority_fee_paid: 0,
        is_fully_filled: false,
    };
    let mut fills = [DEFAULT_FILL; 256];
    let mut fill_idx: u16 = 0;

    for order in orders {
        match order.order_type {
            OrderType::Buy => total_buy_volume = total_buy_volume.saturating_add(order.amount),
            OrderType::Sell => total_sell_volume = total_sell_volume.saturating_add(order.amount),
        }

        let fill = compute_fill(order, clearing_price);

        if fill.filled_amount > 0 {
            match fill.order_type {
                OrderType::Buy => matched_buy = matched_buy.saturating_add(fill.filled_amount),
                OrderType::Sell => matched_sell = matched_sell.saturating_add(fill.filled_amount),
            }
            total_priority_fees = total_priority_fees.saturating_add(fill.priority_fee_paid);
            fill_count += 1;
        } else {
            unfilled_count += 1;
        }

        if (fill_idx as usize) < 256 {
            fills[fill_idx as usize] = fill;
            fill_idx += 1;
        }
    }

    let matched_volume = matched_buy.min(matched_sell);
    let (lp_fee_share, protocol_fee) = distribute_fees(total_priority_fees, matched_volume);

    Ok(SettlementResult {
        clearing_price,
        total_buy_volume,
        total_sell_volume,
        matched_volume,
        fill_count,
        unfilled_count,
        total_priority_fees,
        lp_fee_share,
        protocol_fee,
        fills,
        fill_count_actual: fill_idx,
    })
}

/// Produce a priority-ordered list of indices.
///
/// Within the shuffled order, orders with higher priority fees are moved
/// earlier. This rewards participants who bid for priority without breaking
/// the fairness guarantee (since the shuffle still prevents front-running;
/// priority only gives earlier execution within an already-shuffled batch).
///
/// Returns a fixed-size array of indices in execution order.
pub fn priority_ordering(orders: &[RevealedOrder], shuffle: &ShuffleResult) -> [u16; 256] {
    let n = shuffle.count as usize;
    let mut result = [0u16; 256];

    if n == 0 {
        return result;
    }

    // Build (shuffled_position, priority_fee, original_index) tuples
    let mut indexed: Vec<(usize, u128, u16)> = Vec::new();
    for pos in 0..n {
        let order_idx = shuffle.order[pos] as usize;
        let priority_fee = if order_idx < orders.len() {
            orders[order_idx].priority_fee
        } else {
            0
        };
        indexed.push((pos, priority_fee, shuffle.order[pos]));
    }

    // Stable sort by priority fee descending (higher fee = earlier execution)
    // Among equal fees, preserve shuffle order (stable sort maintains original position)
    indexed.sort_by(|a, b| b.1.cmp(&a.1));

    for (i, (_, _, idx)) in indexed.iter().enumerate() {
        result[i] = *idx;
    }

    result
}

/// Quick estimate of clearing price from (price, amount) tuples.
///
/// Takes separate buy and sell order books as `(price, amount)` pairs.
/// Finds the price where cumulative buy volume >= cumulative sell volume.
pub fn estimate_clearing_price(
    buy_orders: &[(u128, u128)],
    sell_orders: &[(u128, u128)],
) -> Result<u128, SettlementError> {
    if buy_orders.is_empty() || sell_orders.is_empty() {
        return Err(SettlementError::NoMatchingOrders);
    }

    // Collect all unique prices
    let mut prices: Vec<u128> = Vec::new();
    for (p, _) in buy_orders {
        if *p > 0 && !prices.contains(p) {
            prices.push(*p);
        }
    }
    for (p, _) in sell_orders {
        if *p > 0 && !prices.contains(p) {
            prices.push(*p);
        }
    }

    if prices.is_empty() {
        return Err(SettlementError::PriceDiscoveryFailed);
    }

    prices.sort();

    let mut best_price: u128 = 0;
    let mut best_matched: u128 = 0;

    for &price in &prices {
        // Buy volume at this price: buys with limit >= price (or price == 0 for market)
        let buy_vol: u128 = buy_orders
            .iter()
            .filter(|(p, _)| *p == 0 || *p >= price)
            .map(|(_, a)| a)
            .fold(0u128, |acc, a| acc.saturating_add(*a));

        // Sell volume at this price: sells with limit <= price (or price == 0 for market)
        let sell_vol: u128 = sell_orders
            .iter()
            .filter(|(p, _)| *p == 0 || *p <= price)
            .map(|(_, a)| a)
            .fold(0u128, |acc, a| acc.saturating_add(*a));

        let matched = buy_vol.min(sell_vol);

        if matched > best_matched {
            best_matched = matched;
            best_price = price;
        }
    }

    if best_price == 0 {
        return Err(SettlementError::PriceDiscoveryFailed);
    }

    Ok(best_price)
}

/// Compute partial fill amount when remaining liquidity is less than the full order.
///
/// Returns the amount of the order that can be filled given `remaining_volume`.
/// Amounts below MIN_FILL_AMOUNT or DUST_THRESHOLD are returned as zero.
pub fn partial_fill_amount(
    order: &RevealedOrder,
    clearing_price: u128,
    remaining_volume: u128,
) -> u128 {
    if !is_fillable(order, clearing_price) {
        return 0;
    }

    let fill = order.amount.min(remaining_volume);

    if fill < MIN_FILL_AMOUNT || fill < DUST_THRESHOLD {
        return 0;
    }

    fill
}

/// Generate a post-settlement batch summary with analytics.
///
/// The `reference_price` is the best available on-chain price before settlement,
/// used to compute price improvement.
pub fn batch_summary(
    batch_id: u64,
    result: &SettlementResult,
    reference_price: u128,
) -> BatchSummary {
    let order_count = result.fill_count + result.unfilled_count;

    // Count buy and sell orders from fills
    let mut buy_count: u32 = 0;
    let mut sell_count: u32 = 0;
    let mut total_priority: u128 = 0;

    for i in 0..result.fill_count_actual as usize {
        match result.fills[i].order_type {
            OrderType::Buy => buy_count += 1,
            OrderType::Sell => sell_count += 1,
        }
        total_priority = total_priority.saturating_add(result.fills[i].priority_fee_paid);
    }

    let avg_priority_fee = if order_count > 0 {
        total_priority / order_count as u128
    } else {
        0
    };

    // Fill rate = fill_count / order_count * 10000
    let fill_rate_bps = if order_count > 0 {
        ((result.fill_count as u64 * 10_000) / order_count as u64) as u16
    } else {
        0
    };

    // Price improvement vs reference price
    // Positive improvement means clearing price is better for participants
    let price_improvement_bps = if reference_price > 0 && result.clearing_price > 0 {
        let diff = if result.clearing_price > reference_price {
            result.clearing_price - reference_price
        } else {
            reference_price - result.clearing_price
        };
        // improvement_bps = diff * 10000 / reference_price
        let bps = mul_div(diff, 10_000, reference_price);
        if bps > u16::MAX as u128 {
            u16::MAX
        } else {
            bps as u16
        }
    } else {
        0
    };

    BatchSummary {
        batch_id,
        order_count,
        buy_count,
        sell_count,
        clearing_price: result.clearing_price,
        matched_volume: result.matched_volume,
        fill_rate_bps,
        avg_priority_fee,
        price_improvement_bps,
    }
}

/// Compute a quality score (0-10000) for the settlement outcome.
///
/// Score components:
/// - Fill rate (50%): Higher fill rate = better
/// - Price accuracy (50%): Closer to reference price = better
///
/// A perfect score of 10000 means all orders filled at exactly the reference price.
pub fn settlement_quality(result: &SettlementResult, reference_price: u128) -> u16 {
    let total_orders = result.fill_count + result.unfilled_count;

    // Fill rate component (0-5000)
    let fill_rate_score: u128 = if total_orders > 0 {
        (result.fill_count as u128 * 5000) / total_orders as u128
    } else {
        0
    };

    // Price accuracy component (0-5000)
    let price_score: u128 = if reference_price > 0 && result.clearing_price > 0 {
        let diff = if result.clearing_price > reference_price {
            result.clearing_price - reference_price
        } else {
            reference_price - result.clearing_price
        };

        // deviation_bps = diff * 10000 / reference_price
        let deviation_bps = mul_div(diff, 10_000, reference_price);

        // Score decreases with deviation: 5000 * max(0, 1 - deviation/10000)
        if deviation_bps >= 10_000 {
            0
        } else {
            ((10_000 - deviation_bps) * 5000) / 10_000
        }
    } else if reference_price == 0 {
        // No reference price available, give full marks for price component
        5000
    } else {
        0
    };

    let total = fill_rate_score + price_score;
    if total > 10_000 {
        10_000u16
    } else {
        total as u16
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn make_order(
        order_type: OrderType,
        amount: u128,
        limit_price: u128,
        priority_fee: u128,
        secret: [u8; 32],
        index: u16,
    ) -> RevealedOrder {
        RevealedOrder {
            owner: [index as u8; 32],
            order_type,
            amount,
            limit_price,
            priority_fee,
            secret,
            original_index: index,
        }
    }

    fn make_buy(amount: u128, limit_price: u128) -> RevealedOrder {
        make_order(OrderType::Buy, amount, limit_price, 0, [0xAA; 32], 0)
    }

    fn make_sell(amount: u128, limit_price: u128) -> RevealedOrder {
        make_order(OrderType::Sell, amount, limit_price, 0, [0xBB; 32], 1)
    }

    fn make_buy_with_index(amount: u128, limit_price: u128, index: u16) -> RevealedOrder {
        make_order(OrderType::Buy, amount, limit_price, 0, [0xAA; 32], index)
    }

    fn make_sell_with_index(amount: u128, limit_price: u128, index: u16) -> RevealedOrder {
        make_order(OrderType::Sell, amount, limit_price, 0, [0xBB; 32], index)
    }

    fn make_buy_market(amount: u128) -> RevealedOrder {
        make_buy(amount, 0)
    }

    fn make_sell_market(amount: u128) -> RevealedOrder {
        make_sell(amount, 0)
    }

    fn make_buy_with_priority(amount: u128, limit_price: u128, priority: u128) -> RevealedOrder {
        make_order(OrderType::Buy, amount, limit_price, priority, [0xAA; 32], 0)
    }

    fn make_sell_with_priority(amount: u128, limit_price: u128, priority: u128) -> RevealedOrder {
        make_order(OrderType::Sell, amount, limit_price, priority, [0xBB; 32], 1)
    }

    fn default_fill() -> Fill {
        Fill::default()
    }

    // ============ XOR Seed Tests ============

    #[test]
    fn test_xor_seed_single_secret() {
        let secret = [0x42u8; 32];
        let seed = compute_xor_seed(&[secret]);
        assert_eq!(seed, secret);
    }

    #[test]
    fn test_xor_seed_two_identical_secrets_cancel() {
        let secret = [0x42u8; 32];
        let seed = compute_xor_seed(&[secret, secret]);
        assert_eq!(seed, [0u8; 32]);
    }

    #[test]
    fn test_xor_seed_different_secrets() {
        let s1 = [0xFFu8; 32];
        let s2 = [0x00u8; 32];
        let seed = compute_xor_seed(&[s1, s2]);
        assert_eq!(seed, [0xFFu8; 32]);
    }

    #[test]
    fn test_xor_seed_three_secrets() {
        let s1 = [0xAA; 32];
        let s2 = [0x55; 32];
        let s3 = [0xFF; 32];
        let seed = compute_xor_seed(&[s1, s2, s3]);
        // AA ^ 55 = FF, FF ^ FF = 00
        assert_eq!(seed, [0x00; 32]);
    }

    #[test]
    fn test_xor_seed_commutative() {
        let s1 = [0x12; 32];
        let s2 = [0x34; 32];
        let s3 = [0x56; 32];
        let seed_123 = compute_xor_seed(&[s1, s2, s3]);
        let seed_321 = compute_xor_seed(&[s3, s2, s1]);
        let seed_213 = compute_xor_seed(&[s2, s1, s3]);
        assert_eq!(seed_123, seed_321);
        assert_eq!(seed_123, seed_213);
    }

    #[test]
    fn test_xor_seed_empty() {
        let seed = compute_xor_seed(&[]);
        assert_eq!(seed, [0u8; 32]);
    }

    #[test]
    fn test_xor_seed_all_zeros() {
        let seed = compute_xor_seed(&[[0u8; 32], [0u8; 32]]);
        assert_eq!(seed, [0u8; 32]);
    }

    #[test]
    fn test_xor_seed_mixed_bytes() {
        let mut s1 = [0u8; 32];
        let mut s2 = [0u8; 32];
        s1[0] = 0xAB;
        s1[31] = 0xCD;
        s2[0] = 0x12;
        s2[31] = 0x34;
        let seed = compute_xor_seed(&[s1, s2]);
        assert_eq!(seed[0], 0xAB ^ 0x12);
        assert_eq!(seed[31], 0xCD ^ 0x34);
        assert_eq!(seed[1], 0x00);
    }

    // ============ Fisher-Yates Shuffle Tests ============

    #[test]
    fn test_shuffle_single_order() {
        let secrets = [[0xAA; 32]];
        let result = fisher_yates_shuffle(&secrets, 1);
        assert_eq!(result.count, 1);
        assert_eq!(result.order[0], 0);
    }

    #[test]
    fn test_shuffle_deterministic_same_secrets() {
        let secrets = [[0xAA; 32], [0xBB; 32], [0xCC; 32]];
        let r1 = fisher_yates_shuffle(&secrets, 3);
        let r2 = fisher_yates_shuffle(&secrets, 3);
        assert_eq!(r1.order[..3], r2.order[..3]);
        assert_eq!(r1.xor_seed, r2.xor_seed);
    }

    #[test]
    fn test_shuffle_different_secrets_different_order() {
        let secrets_a = [[0xAA; 32], [0xBB; 32], [0xCC; 32], [0xDD; 32]];
        let secrets_b = [[0x11; 32], [0x22; 32], [0x33; 32], [0x44; 32]];
        let ra = fisher_yates_shuffle(&secrets_a, 4);
        let rb = fisher_yates_shuffle(&secrets_b, 4);
        // Seeds must differ
        assert_ne!(ra.xor_seed, rb.xor_seed);
        // Orders very likely differ (not guaranteed but extremely unlikely to match)
        // We test seed difference as the guaranteed property
    }

    #[test]
    fn test_shuffle_preserves_all_indices() {
        let secrets = [[0x12; 32], [0x34; 32], [0x56; 32], [0x78; 32], [0x9A; 32]];
        let result = fisher_yates_shuffle(&secrets, 5);

        let mut sorted: Vec<u16> = result.order[..5].to_vec();
        sorted.sort();
        assert_eq!(sorted, vec![0, 1, 2, 3, 4]);
    }

    #[test]
    fn test_shuffle_two_orders() {
        let secrets = [[0xFF; 32], [0x00; 32]];
        let result = fisher_yates_shuffle(&secrets, 2);
        assert_eq!(result.count, 2);
        // Both indices must be present
        let mut sorted: Vec<u16> = result.order[..2].to_vec();
        sorted.sort();
        assert_eq!(sorted, vec![0, 1]);
    }

    #[test]
    fn test_shuffle_xor_seed_matches_compute() {
        let secrets = [[0xAA; 32], [0xBB; 32]];
        let result = fisher_yates_shuffle(&secrets, 2);
        let expected_seed = compute_xor_seed(&secrets);
        assert_eq!(result.xor_seed, expected_seed);
    }

    #[test]
    fn test_shuffle_zero_count() {
        let secrets: [[u8; 32]; 0] = [];
        let result = fisher_yates_shuffle(&secrets, 0);
        assert_eq!(result.count, 0);
    }

    #[test]
    fn test_shuffle_max_orders() {
        let mut secrets = Vec::new();
        for i in 0..256u16 {
            let mut s = [0u8; 32];
            s[0] = (i & 0xFF) as u8;
            s[1] = ((i >> 8) & 0xFF) as u8;
            secrets.push(s);
        }
        let result = fisher_yates_shuffle(&secrets, 256);
        assert_eq!(result.count, 256);

        // All indices present
        let mut sorted: Vec<u16> = result.order.to_vec();
        sorted.sort();
        for i in 0..256u16 {
            assert_eq!(sorted[i as usize], i);
        }
    }

    #[test]
    fn test_shuffle_is_permutation_10() {
        let mut secrets = Vec::new();
        for i in 0..10u8 {
            secrets.push([i; 32]);
        }
        let result = fisher_yates_shuffle(&secrets, 10);
        let mut sorted: Vec<u16> = result.order[..10].to_vec();
        sorted.sort();
        let expected: Vec<u16> = (0..10).collect();
        assert_eq!(sorted, expected);
    }

    #[test]
    fn test_shuffle_secret_order_matters_for_seed() {
        // Different ordering of same secrets produces same XOR seed
        let s1 = [0x11; 32];
        let s2 = [0x22; 32];
        let seed_12 = compute_xor_seed(&[s1, s2]);
        let seed_21 = compute_xor_seed(&[s2, s1]);
        assert_eq!(seed_12, seed_21);
    }

    // ============ is_fillable Tests ============

    #[test]
    fn test_fillable_buy_at_limit() {
        let order = make_buy(PRECISION, PRECISION);
        assert!(is_fillable(&order, PRECISION));
    }

    #[test]
    fn test_fillable_buy_above_limit() {
        let order = make_buy(PRECISION, 2 * PRECISION);
        assert!(is_fillable(&order, PRECISION));
    }

    #[test]
    fn test_not_fillable_buy_below_limit() {
        let order = make_buy(PRECISION, PRECISION / 2);
        assert!(!is_fillable(&order, PRECISION));
    }

    #[test]
    fn test_fillable_sell_at_limit() {
        let order = make_sell(PRECISION, PRECISION);
        assert!(is_fillable(&order, PRECISION));
    }

    #[test]
    fn test_fillable_sell_below_limit() {
        let order = make_sell(PRECISION, PRECISION / 2);
        assert!(is_fillable(&order, PRECISION));
    }

    #[test]
    fn test_not_fillable_sell_above_limit() {
        let order = make_sell(PRECISION, 2 * PRECISION);
        assert!(!is_fillable(&order, PRECISION));
    }

    #[test]
    fn test_fillable_buy_market_order() {
        let order = make_buy_market(PRECISION);
        assert!(is_fillable(&order, PRECISION));
        assert!(is_fillable(&order, u128::MAX / 2));
    }

    #[test]
    fn test_fillable_sell_market_order() {
        let order = make_sell_market(PRECISION);
        assert!(is_fillable(&order, PRECISION));
        assert!(is_fillable(&order, 1));
    }

    #[test]
    fn test_not_fillable_zero_amount() {
        let order = make_buy(0, PRECISION);
        assert!(!is_fillable(&order, PRECISION));
    }

    #[test]
    fn test_not_fillable_dust_amount() {
        let order = make_buy(DUST_THRESHOLD - 1, PRECISION);
        assert!(!is_fillable(&order, PRECISION));
    }

    #[test]
    fn test_fillable_at_dust_threshold() {
        let order = make_buy(DUST_THRESHOLD, PRECISION);
        assert!(is_fillable(&order, PRECISION));
    }

    #[test]
    fn test_fillable_min_fill_amount() {
        let order = make_buy(MIN_FILL_AMOUNT, PRECISION);
        assert!(is_fillable(&order, PRECISION));
    }

    // ============ compute_proceeds Tests ============

    #[test]
    fn test_proceeds_buy_basic() {
        // Buy: spend 2e18 quote at price 1e18, get 2e18 tokens
        let proceeds = compute_proceeds(2 * PRECISION, PRECISION, &OrderType::Buy);
        assert_eq!(proceeds, 2 * PRECISION);
    }

    #[test]
    fn test_proceeds_sell_basic() {
        // Sell: provide 2e18 tokens at price 1e18, get 2e18 quote
        let proceeds = compute_proceeds(2 * PRECISION, PRECISION, &OrderType::Sell);
        assert_eq!(proceeds, 2 * PRECISION);
    }

    #[test]
    fn test_proceeds_buy_higher_price() {
        // Buy: spend 1e18 at price 2e18, get 0.5e18 tokens
        let proceeds = compute_proceeds(PRECISION, 2 * PRECISION, &OrderType::Buy);
        assert_eq!(proceeds, PRECISION / 2);
    }

    #[test]
    fn test_proceeds_sell_higher_price() {
        // Sell: provide 1e18 tokens at price 2e18, get 2e18 quote
        let proceeds = compute_proceeds(PRECISION, 2 * PRECISION, &OrderType::Sell);
        assert_eq!(proceeds, 2 * PRECISION);
    }

    #[test]
    fn test_proceeds_buy_lower_price() {
        // Buy: spend 1e18 at price 0.5e18, get 2e18 tokens
        let proceeds = compute_proceeds(PRECISION, PRECISION / 2, &OrderType::Buy);
        assert_eq!(proceeds, 2 * PRECISION);
    }

    #[test]
    fn test_proceeds_sell_lower_price() {
        // Sell: provide 1e18 tokens at price 0.5e18, get 0.5e18 quote
        let proceeds = compute_proceeds(PRECISION, PRECISION / 2, &OrderType::Sell);
        assert_eq!(proceeds, PRECISION / 2);
    }

    #[test]
    fn test_proceeds_zero_fill() {
        assert_eq!(compute_proceeds(0, PRECISION, &OrderType::Buy), 0);
        assert_eq!(compute_proceeds(0, PRECISION, &OrderType::Sell), 0);
    }

    #[test]
    fn test_proceeds_zero_price() {
        assert_eq!(compute_proceeds(PRECISION, 0, &OrderType::Buy), 0);
        assert_eq!(compute_proceeds(PRECISION, 0, &OrderType::Sell), 0);
    }

    #[test]
    fn test_proceeds_large_amounts() {
        // Test with large values to verify overflow handling via mul_div
        let large = PRECISION * 1_000_000; // 1M tokens
        let price = PRECISION * 100;       // price = 100
        let buy_proceeds = compute_proceeds(large, price, &OrderType::Buy);
        // tokens = 1M * 1e18 / (100 * 1e18) = 10_000 * 1e18
        assert_eq!(buy_proceeds, PRECISION * 10_000);
    }

    #[test]
    fn test_proceeds_sell_large_amounts() {
        let large = PRECISION * 1_000_000;
        let price = PRECISION * 100;
        let sell_proceeds = compute_proceeds(large, price, &OrderType::Sell);
        // quote = 1M * 100 * 1e18 / 1e18 = 100M * 1e18
        assert_eq!(sell_proceeds, PRECISION * 100_000_000);
    }

    // ============ compute_fill Tests ============

    #[test]
    fn test_fill_buy_at_clearing() {
        let order = make_buy(PRECISION, PRECISION);
        let fill = compute_fill(&order, PRECISION);
        assert_eq!(fill.filled_amount, PRECISION);
        assert_eq!(fill.fill_price, PRECISION);
        assert_eq!(fill.proceeds, PRECISION); // 1:1 at price 1.0
        assert!(fill.is_fully_filled);
    }

    #[test]
    fn test_fill_sell_at_clearing() {
        let order = make_sell(PRECISION, PRECISION);
        let fill = compute_fill(&order, PRECISION);
        assert_eq!(fill.filled_amount, PRECISION);
        assert_eq!(fill.proceeds, PRECISION);
        assert!(fill.is_fully_filled);
    }

    #[test]
    fn test_fill_buy_below_limit() {
        // Buy limit at 1.0, clearing at 2.0 → doesn't fill
        let order = make_buy(PRECISION, PRECISION);
        let fill = compute_fill(&order, 2 * PRECISION);
        assert_eq!(fill.filled_amount, 0);
        assert_eq!(fill.proceeds, 0);
        assert!(!fill.is_fully_filled);
    }

    #[test]
    fn test_fill_sell_above_limit() {
        // Sell limit at 2.0, clearing at 1.0 → doesn't fill
        let order = make_sell(PRECISION, 2 * PRECISION);
        let fill = compute_fill(&order, PRECISION);
        assert_eq!(fill.filled_amount, 0);
        assert_eq!(fill.proceeds, 0);
        assert!(!fill.is_fully_filled);
    }

    #[test]
    fn test_fill_market_buy() {
        let order = make_buy_market(PRECISION);
        let fill = compute_fill(&order, PRECISION);
        assert_eq!(fill.filled_amount, PRECISION);
        assert!(fill.is_fully_filled);
    }

    #[test]
    fn test_fill_market_sell() {
        let order = make_sell_market(PRECISION);
        let fill = compute_fill(&order, PRECISION);
        assert_eq!(fill.filled_amount, PRECISION);
        assert!(fill.is_fully_filled);
    }

    #[test]
    fn test_fill_preserves_owner() {
        let mut order = make_buy(PRECISION, PRECISION);
        order.owner = [0xDE; 32];
        let fill = compute_fill(&order, PRECISION);
        assert_eq!(fill.owner, [0xDE; 32]);
    }

    #[test]
    fn test_fill_preserves_order_type() {
        let buy = make_buy(PRECISION, PRECISION);
        let sell = make_sell(PRECISION, PRECISION);
        assert_eq!(compute_fill(&buy, PRECISION).order_type, OrderType::Buy);
        assert_eq!(compute_fill(&sell, PRECISION).order_type, OrderType::Sell);
    }

    #[test]
    fn test_fill_with_priority_fee() {
        let order = make_buy_with_priority(PRECISION, PRECISION, 1000);
        let fill = compute_fill(&order, PRECISION);
        assert_eq!(fill.priority_fee_paid, 1000);
        assert!(fill.is_fully_filled);
    }

    #[test]
    fn test_fill_zero_amount_unfilled() {
        let order = make_buy(0, PRECISION);
        let fill = compute_fill(&order, PRECISION);
        assert_eq!(fill.filled_amount, 0);
        assert!(!fill.is_fully_filled);
    }

    // ============ Fee Distribution Tests ============

    #[test]
    fn test_fees_basic_split() {
        let (lp, protocol) = distribute_fees(10_000, 1_000_000);
        // LP: 10000 * 5000 / 10000 = 5000
        assert_eq!(lp, 5000);
        // Protocol: 1000000 * 5 / 10000 = 500
        assert_eq!(protocol, 500);
    }

    #[test]
    fn test_fees_zero_priority() {
        let (lp, protocol) = distribute_fees(0, 1_000_000);
        assert_eq!(lp, 0);
        assert_eq!(protocol, 500);
    }

    #[test]
    fn test_fees_zero_volume() {
        let (lp, protocol) = distribute_fees(10_000, 0);
        assert_eq!(lp, 5000);
        assert_eq!(protocol, 0);
    }

    #[test]
    fn test_fees_both_zero() {
        let (lp, protocol) = distribute_fees(0, 0);
        assert_eq!(lp, 0);
        assert_eq!(protocol, 0);
    }

    #[test]
    fn test_fees_large_values() {
        let large_fees = PRECISION * 1_000_000;
        let large_volume = PRECISION * 100_000_000;
        let (lp, protocol) = distribute_fees(large_fees, large_volume);
        // LP = large_fees / 2
        assert_eq!(lp, PRECISION * 500_000);
        // Protocol = large_volume * 5 / 10000
        assert_eq!(protocol, PRECISION * 50_000);
    }

    #[test]
    fn test_fees_odd_priority_fee() {
        // 10001 * 5000 / 10000 = 5000 (integer division)
        let (lp, _) = distribute_fees(10_001, 0);
        assert_eq!(lp, 5000);
    }

    #[test]
    fn test_fees_small_volume() {
        // Volume below 10000/5 = 2000 gives 0 protocol fee
        let (_, protocol) = distribute_fees(0, 1999);
        assert_eq!(protocol, 0);
    }

    #[test]
    fn test_fees_exact_protocol_threshold() {
        // Volume = 2000: 2000 * 5 / 10000 = 1
        let (_, protocol) = distribute_fees(0, 2_000);
        assert_eq!(protocol, 1);
    }

    // ============ Batch Validation Tests ============

    #[test]
    fn test_validate_valid_batch() {
        let orders = vec![
            make_buy(PRECISION, PRECISION),
            make_sell(PRECISION, PRECISION),
        ];
        assert!(validate_batch(&orders).is_ok());
    }

    #[test]
    fn test_validate_empty_batch() {
        let orders: Vec<RevealedOrder> = vec![];
        assert_eq!(validate_batch(&orders), Err(SettlementError::EmptyBatch));
    }

    #[test]
    fn test_validate_too_many_orders() {
        let mut orders = Vec::new();
        for i in 0..257 {
            orders.push(make_buy_with_index(PRECISION, PRECISION, i as u16));
        }
        assert_eq!(validate_batch(&orders), Err(SettlementError::TooManyOrders));
    }

    #[test]
    fn test_validate_max_orders_ok() {
        let mut orders = Vec::new();
        for i in 0..256 {
            let mut o = make_buy_with_index(PRECISION, PRECISION, i as u16);
            o.secret = [((i % 255) + 1) as u8; 32]; // non-zero
            orders.push(o);
        }
        assert!(validate_batch(&orders).is_ok());
    }

    #[test]
    fn test_validate_zero_amount() {
        let orders = vec![make_buy(0, PRECISION)];
        assert_eq!(validate_batch(&orders), Err(SettlementError::ZeroAmount));
    }

    #[test]
    fn test_validate_zero_secret() {
        let mut order = make_buy(PRECISION, PRECISION);
        order.secret = [0u8; 32];
        let orders = vec![order];
        assert_eq!(validate_batch(&orders), Err(SettlementError::InvalidSecret));
    }

    #[test]
    fn test_validate_mixed_valid() {
        let orders = vec![
            make_buy(PRECISION, 2 * PRECISION),
            make_sell(PRECISION * 2, PRECISION),
            make_buy_market(PRECISION),
            make_sell_market(PRECISION * 3),
        ];
        assert!(validate_batch(&orders).is_ok());
    }

    #[test]
    fn test_validate_zero_amount_in_middle() {
        let mut orders = vec![
            make_buy(PRECISION, PRECISION),
            make_buy(0, PRECISION), // zero amount
            make_sell(PRECISION, PRECISION),
        ];
        orders[1].secret = [0x11; 32];
        assert_eq!(validate_batch(&orders), Err(SettlementError::ZeroAmount));
    }

    #[test]
    fn test_validate_single_order() {
        let orders = vec![make_buy(PRECISION, PRECISION)];
        assert!(validate_batch(&orders).is_ok());
    }

    // ============ Clearing Price Discovery Tests ============

    #[test]
    fn test_clearing_balanced() {
        let orders = vec![
            make_buy(PRECISION, PRECISION),
            make_sell(PRECISION, PRECISION),
        ];
        let price = discover_clearing_price(&orders).unwrap();
        assert_eq!(price, PRECISION);
    }

    #[test]
    fn test_clearing_buy_heavy() {
        let orders = vec![
            make_buy_with_index(PRECISION * 5, 2 * PRECISION, 0),
            make_buy_with_index(PRECISION * 3, 2 * PRECISION, 1),
            make_sell_with_index(PRECISION * 2, PRECISION, 2),
        ];
        let price = discover_clearing_price(&orders).unwrap();
        // Both buy limits at 2*PRECISION, sell limit at PRECISION
        // At price PRECISION: buys fill (limit >= price), sell fills (limit <= price) → matched = min(8, 2) = 2
        // At price 2*PRECISION: buys fill (limit >= price), sell fills (limit <= price) → matched = min(8, 2) = 2
        // Either price works, both match 2
        assert!(price > 0);
    }

    #[test]
    fn test_clearing_sell_heavy() {
        let orders = vec![
            make_buy_with_index(PRECISION, 2 * PRECISION, 0),
            make_sell_with_index(PRECISION * 5, PRECISION, 1),
            make_sell_with_index(PRECISION * 3, PRECISION, 2),
        ];
        let price = discover_clearing_price(&orders).unwrap();
        assert!(price > 0);
    }

    #[test]
    fn test_clearing_single_each_side() {
        let orders = vec![
            make_buy(PRECISION * 10, 2 * PRECISION),
            make_sell(PRECISION * 10, PRECISION),
        ];
        let price = discover_clearing_price(&orders).unwrap();
        assert!(price >= PRECISION && price <= 2 * PRECISION);
    }

    #[test]
    fn test_clearing_no_buys_fails() {
        let orders = vec![
            make_sell(PRECISION, PRECISION),
            make_sell(PRECISION, PRECISION),
        ];
        assert_eq!(
            discover_clearing_price(&orders),
            Err(SettlementError::NoMatchingOrders)
        );
    }

    #[test]
    fn test_clearing_no_sells_fails() {
        let orders = vec![
            make_buy(PRECISION, PRECISION),
            make_buy(PRECISION, PRECISION),
        ];
        assert_eq!(
            discover_clearing_price(&orders),
            Err(SettlementError::NoMatchingOrders)
        );
    }

    #[test]
    fn test_clearing_empty_fails() {
        let orders: Vec<RevealedOrder> = vec![];
        assert_eq!(
            discover_clearing_price(&orders),
            Err(SettlementError::EmptyBatch)
        );
    }

    #[test]
    fn test_clearing_all_market_fails() {
        // All market orders → no limit prices to anchor clearing price
        let orders = vec![
            make_buy_market(PRECISION),
            make_sell_market(PRECISION),
        ];
        assert_eq!(
            discover_clearing_price(&orders),
            Err(SettlementError::PriceDiscoveryFailed)
        );
    }

    #[test]
    fn test_clearing_no_overlap_fails() {
        // Buyers willing to pay up to 1.0, sellers want at least 2.0
        let orders = vec![
            make_buy(PRECISION, PRECISION),          // buy limit 1.0
            make_sell(PRECISION, 2 * PRECISION),     // sell limit 2.0
        ];
        assert_eq!(
            discover_clearing_price(&orders),
            Err(SettlementError::NoMatchingOrders)
        );
    }

    #[test]
    fn test_clearing_multiple_price_levels() {
        let orders = vec![
            make_buy_with_index(PRECISION, 3 * PRECISION, 0),  // buy at up to 3.0
            make_buy_with_index(PRECISION, 2 * PRECISION, 1),  // buy at up to 2.0
            make_buy_with_index(PRECISION, PRECISION, 2),       // buy at up to 1.0
            make_sell_with_index(PRECISION, PRECISION, 3),      // sell at 1.0+
            make_sell_with_index(PRECISION, 2 * PRECISION, 4),  // sell at 2.0+
            make_sell_with_index(PRECISION, 3 * PRECISION, 5),  // sell at 3.0+
        ];
        let price = discover_clearing_price(&orders).unwrap();
        // The clearing price should maximize matched volume
        assert!(price > 0);
    }

    #[test]
    fn test_clearing_limit_and_market_mixed() {
        let orders = vec![
            make_buy_market(PRECISION),
            make_buy_with_index(PRECISION, 2 * PRECISION, 1),
            make_sell_with_index(PRECISION, PRECISION, 2),
            make_sell_market(PRECISION),
        ];
        let price = discover_clearing_price(&orders).unwrap();
        assert!(price > 0);
    }

    #[test]
    fn test_clearing_same_price_all_orders() {
        let orders = vec![
            make_buy_with_index(PRECISION * 5, PRECISION, 0),
            make_sell_with_index(PRECISION * 5, PRECISION, 1),
        ];
        let price = discover_clearing_price(&orders).unwrap();
        assert_eq!(price, PRECISION);
    }

    // ============ match_orders Tests ============

    #[test]
    fn test_match_balanced_orders() {
        let orders = vec![
            make_buy(PRECISION, PRECISION),
            make_sell(PRECISION, PRECISION),
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        assert_eq!(result.clearing_price, PRECISION);
        assert_eq!(result.total_buy_volume, PRECISION);
        assert_eq!(result.total_sell_volume, PRECISION);
        assert_eq!(result.matched_volume, PRECISION);
        assert_eq!(result.fill_count, 2);
        assert_eq!(result.unfilled_count, 0);
    }

    #[test]
    fn test_match_empty_fails() {
        let orders: Vec<RevealedOrder> = vec![];
        assert_eq!(
            match_orders(&orders, PRECISION),
            Err(SettlementError::EmptyBatch)
        );
    }

    #[test]
    fn test_match_zero_price_fails() {
        let orders = vec![make_buy(PRECISION, PRECISION)];
        assert_eq!(
            match_orders(&orders, 0),
            Err(SettlementError::ZeroPrice)
        );
    }

    #[test]
    fn test_match_partial_fills() {
        // Buyer wants 3e18, seller has 1e18
        let orders = vec![
            make_buy(3 * PRECISION, 2 * PRECISION),
            make_sell(PRECISION, PRECISION),
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        // Both fill (limit prices compatible), matched = min(buy, sell) = 1
        assert_eq!(result.matched_volume, PRECISION);
        assert_eq!(result.fill_count, 2);
    }

    #[test]
    fn test_match_no_matching_orders() {
        // Buy limit 1.0, sell limit 2.0, clearing at 1.5 → buy doesn't fill
        let orders = vec![
            make_buy(PRECISION, PRECISION),
            make_sell(PRECISION, 2 * PRECISION),
        ];
        let result = match_orders(&orders, PRECISION + PRECISION / 2).unwrap();
        // Buy limit 1.0 < clearing 1.5 → unfilled
        // Sell limit 2.0 > clearing 1.5 → unfilled
        assert_eq!(result.fill_count, 0);
        assert_eq!(result.unfilled_count, 2);
        assert_eq!(result.matched_volume, 0);
    }

    #[test]
    fn test_match_all_market_orders() {
        let orders = vec![
            make_buy_market(PRECISION),
            make_sell_market(PRECISION),
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        assert_eq!(result.fill_count, 2);
        assert_eq!(result.matched_volume, PRECISION);
    }

    #[test]
    fn test_match_mixed_limit_market() {
        let orders = vec![
            make_buy_market(PRECISION),
            make_buy(PRECISION, 2 * PRECISION),
            make_sell_market(PRECISION),
            make_sell(PRECISION, PRECISION / 2),
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        assert_eq!(result.fill_count, 4);
        assert_eq!(result.total_buy_volume, 2 * PRECISION);
        assert_eq!(result.total_sell_volume, 2 * PRECISION);
        assert_eq!(result.matched_volume, 2 * PRECISION);
    }

    #[test]
    fn test_match_with_priority_fees() {
        let orders = vec![
            make_buy_with_priority(PRECISION, PRECISION, 500),
            make_sell_with_priority(PRECISION, PRECISION, 300),
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        assert_eq!(result.total_priority_fees, 800);
        // LP gets 50% of priority fees
        assert_eq!(result.lp_fee_share, 400);
    }

    #[test]
    fn test_match_fill_count_actual() {
        let orders = vec![
            make_buy_with_index(PRECISION, PRECISION, 0),
            make_sell_with_index(PRECISION, PRECISION, 1),
            make_buy_with_index(PRECISION, PRECISION / 2, 2), // won't fill at PRECISION
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        assert_eq!(result.fill_count_actual, 3); // All 3 are recorded (even unfilled)
        assert_eq!(result.fill_count, 2);        // Only 2 actually filled
        assert_eq!(result.unfilled_count, 1);
    }

    #[test]
    fn test_match_protocol_fee() {
        let orders = vec![
            make_buy(PRECISION * 100, PRECISION),
            make_sell(PRECISION * 100, PRECISION),
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        // protocol_fee = matched_volume * 5 / 10000
        let expected_protocol = mul_div(PRECISION * 100, 5, 10_000);
        assert_eq!(result.protocol_fee, expected_protocol);
    }

    #[test]
    fn test_match_buy_heavy_volume() {
        let orders = vec![
            make_buy_with_index(PRECISION * 10, PRECISION, 0),
            make_sell_with_index(PRECISION * 3, PRECISION, 1),
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        assert_eq!(result.total_buy_volume, PRECISION * 10);
        assert_eq!(result.total_sell_volume, PRECISION * 3);
        assert_eq!(result.matched_volume, PRECISION * 3); // limited by sell side
    }

    #[test]
    fn test_match_sell_heavy_volume() {
        let orders = vec![
            make_buy_with_index(PRECISION * 2, PRECISION, 0),
            make_sell_with_index(PRECISION * 8, PRECISION, 1),
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        assert_eq!(result.matched_volume, PRECISION * 2); // limited by buy side
    }

    // ============ Priority Ordering Tests ============

    #[test]
    fn test_priority_no_fees() {
        let orders = vec![
            make_buy_with_index(PRECISION, PRECISION, 0),
            make_sell_with_index(PRECISION, PRECISION, 1),
        ];
        let shuffle = fisher_yates_shuffle(&[orders[0].secret, orders[1].secret], 2);
        let result = priority_ordering(&orders, &shuffle);
        // No priority fees, so order is just the shuffle order
        let mut indices: Vec<u16> = result[..2].to_vec();
        indices.sort();
        assert_eq!(indices, vec![0, 1]);
    }

    #[test]
    fn test_priority_higher_fee_first() {
        let o1 = make_order(OrderType::Buy, PRECISION, PRECISION, 1000, [0xAA; 32], 0);
        let o2 = make_order(OrderType::Buy, PRECISION, PRECISION, 500, [0xBB; 32], 1);
        let o3 = make_order(OrderType::Buy, PRECISION, PRECISION, 2000, [0xCC; 32], 2);

        let orders = vec![o1, o2, o3];
        let shuffle = ShuffleResult {
            order: {
                let mut arr = [0u16; 256];
                arr[0] = 0;
                arr[1] = 1;
                arr[2] = 2;
                arr
            },
            count: 3,
            xor_seed: [0; 32],
        };

        let result = priority_ordering(&orders, &shuffle);
        // Order 2 has highest priority (2000), then order 0 (1000), then order 1 (500)
        assert_eq!(result[0], 2);
        assert_eq!(result[1], 0);
        assert_eq!(result[2], 1);
    }

    #[test]
    fn test_priority_uniform_fees() {
        let orders = vec![
            make_order(OrderType::Buy, PRECISION, PRECISION, 100, [0xAA; 32], 0),
            make_order(OrderType::Sell, PRECISION, PRECISION, 100, [0xBB; 32], 1),
            make_order(OrderType::Buy, PRECISION, PRECISION, 100, [0xCC; 32], 2),
        ];
        let shuffle = ShuffleResult {
            order: {
                let mut arr = [0u16; 256];
                arr[0] = 2;
                arr[1] = 0;
                arr[2] = 1;
                arr
            },
            count: 3,
            xor_seed: [0; 32],
        };
        let result = priority_ordering(&orders, &shuffle);
        // All same priority → stable sort preserves shuffle order
        let indices: Vec<u16> = result[..3].to_vec();
        let mut sorted = indices.clone();
        sorted.sort();
        assert_eq!(sorted, vec![0, 1, 2]);
    }

    #[test]
    fn test_priority_empty() {
        let orders: Vec<RevealedOrder> = vec![];
        let shuffle = ShuffleResult {
            order: [0u16; 256],
            count: 0,
            xor_seed: [0; 32],
        };
        let result = priority_ordering(&orders, &shuffle);
        // All zeros, nothing to check
        assert_eq!(result[0], 0);
    }

    #[test]
    fn test_priority_single_order() {
        let orders = vec![make_buy_with_priority(PRECISION, PRECISION, 1000)];
        let shuffle = ShuffleResult {
            order: {
                let mut arr = [0u16; 256];
                arr[0] = 0;
                arr
            },
            count: 1,
            xor_seed: [0; 32],
        };
        let result = priority_ordering(&orders, &shuffle);
        assert_eq!(result[0], 0);
    }

    #[test]
    fn test_priority_mixed_fees() {
        let orders = vec![
            make_order(OrderType::Buy, PRECISION, PRECISION, 0, [0xAA; 32], 0),
            make_order(OrderType::Sell, PRECISION, PRECISION, 5000, [0xBB; 32], 1),
            make_order(OrderType::Buy, PRECISION, PRECISION, 100, [0xCC; 32], 2),
        ];
        let shuffle = ShuffleResult {
            order: {
                let mut arr = [0u16; 256];
                arr[0] = 0;
                arr[1] = 1;
                arr[2] = 2;
                arr
            },
            count: 3,
            xor_seed: [0; 32],
        };
        let result = priority_ordering(&orders, &shuffle);
        // Sorted by priority descending: 1 (5000), 2 (100), 0 (0)
        assert_eq!(result[0], 1);
        assert_eq!(result[1], 2);
        assert_eq!(result[2], 0);
    }

    // ============ estimate_clearing_price Tests ============

    #[test]
    fn test_estimate_balanced() {
        let buys = vec![(PRECISION, PRECISION)];
        let sells = vec![(PRECISION, PRECISION)];
        let price = estimate_clearing_price(&buys, &sells).unwrap();
        assert_eq!(price, PRECISION);
    }

    #[test]
    fn test_estimate_no_buys() {
        let sells = vec![(PRECISION, PRECISION)];
        assert_eq!(
            estimate_clearing_price(&[], &sells),
            Err(SettlementError::NoMatchingOrders)
        );
    }

    #[test]
    fn test_estimate_no_sells() {
        let buys = vec![(PRECISION, PRECISION)];
        assert_eq!(
            estimate_clearing_price(&buys, &[]),
            Err(SettlementError::NoMatchingOrders)
        );
    }

    #[test]
    fn test_estimate_multiple_levels() {
        let buys = vec![
            (3 * PRECISION, PRECISION),
            (2 * PRECISION, PRECISION),
            (PRECISION, PRECISION),
        ];
        let sells = vec![
            (PRECISION, PRECISION),
            (2 * PRECISION, PRECISION),
            (3 * PRECISION, PRECISION),
        ];
        let price = estimate_clearing_price(&buys, &sells).unwrap();
        assert!(price > 0);
    }

    #[test]
    fn test_estimate_no_overlap() {
        let buys = vec![(PRECISION, PRECISION)];
        let sells = vec![(2 * PRECISION, PRECISION)];
        // Buy willing to pay 1.0, sell wants 2.0 → no match
        assert_eq!(
            estimate_clearing_price(&buys, &sells),
            Err(SettlementError::PriceDiscoveryFailed)
        );
    }

    #[test]
    fn test_estimate_all_zero_prices() {
        let buys = vec![(0u128, PRECISION)];
        let sells = vec![(0u128, PRECISION)];
        assert_eq!(
            estimate_clearing_price(&buys, &sells),
            Err(SettlementError::PriceDiscoveryFailed)
        );
    }

    #[test]
    fn test_estimate_market_and_limit() {
        let buys = vec![(0, PRECISION), (2 * PRECISION, PRECISION)];
        let sells = vec![(PRECISION, PRECISION)];
        let price = estimate_clearing_price(&buys, &sells).unwrap();
        // Only non-zero prices are candidates: 2*PRECISION, PRECISION
        // At PRECISION: buys with limit >= PRECISION or market (limit 0) → volume = 2*PRECISION; sells <= PRECISION → volume = PRECISION → matched = 1
        // At 2*PRECISION: buys >= 2*PRECISION or market → volume = 2*PRECISION; sells <= 2*PRECISION → volume = PRECISION → matched = 1
        // Both match the same, either is valid
        assert!(price > 0);
    }

    // ============ partial_fill_amount Tests ============

    #[test]
    fn test_partial_exact_remaining() {
        let order = make_buy(PRECISION, PRECISION);
        let fill = partial_fill_amount(&order, PRECISION, PRECISION);
        assert_eq!(fill, PRECISION);
    }

    #[test]
    fn test_partial_more_than_remaining() {
        let order = make_buy(PRECISION * 5, PRECISION);
        let fill = partial_fill_amount(&order, PRECISION, PRECISION * 2);
        assert_eq!(fill, PRECISION * 2);
    }

    #[test]
    fn test_partial_less_than_order() {
        let order = make_buy(PRECISION, PRECISION);
        let fill = partial_fill_amount(&order, PRECISION, PRECISION / 2);
        assert_eq!(fill, PRECISION / 2);
    }

    #[test]
    fn test_partial_unfillable_order() {
        let order = make_buy(PRECISION, PRECISION / 2); // limit below clearing
        let fill = partial_fill_amount(&order, PRECISION, PRECISION);
        assert_eq!(fill, 0);
    }

    #[test]
    fn test_partial_below_min_fill() {
        let order = make_buy(MIN_FILL_AMOUNT - 1, PRECISION);
        // Amount is below dust threshold (1000) or below MIN_FILL_AMOUNT
        // DUST_THRESHOLD = 1000, and MIN_FILL_AMOUNT - 1 > DUST_THRESHOLD
        // But remaining_volume might be less
        let fill = partial_fill_amount(&order, PRECISION, 500);
        assert_eq!(fill, 0); // 500 < DUST_THRESHOLD
    }

    #[test]
    fn test_partial_dust_remaining() {
        let order = make_buy(PRECISION, PRECISION);
        let fill = partial_fill_amount(&order, PRECISION, DUST_THRESHOLD - 1);
        assert_eq!(fill, 0); // Below dust threshold
    }

    #[test]
    fn test_partial_at_dust_threshold() {
        let order = make_buy(PRECISION, PRECISION);
        // DUST_THRESHOLD = 1000 which is < MIN_FILL_AMOUNT = 1e12
        // So this will be 0 because 1000 < MIN_FILL_AMOUNT
        let fill = partial_fill_amount(&order, PRECISION, DUST_THRESHOLD);
        assert_eq!(fill, 0);
    }

    #[test]
    fn test_partial_at_min_fill() {
        let order = make_buy(PRECISION, PRECISION);
        let fill = partial_fill_amount(&order, PRECISION, MIN_FILL_AMOUNT);
        assert_eq!(fill, MIN_FILL_AMOUNT);
    }

    #[test]
    fn test_partial_zero_remaining() {
        let order = make_buy(PRECISION, PRECISION);
        let fill = partial_fill_amount(&order, PRECISION, 0);
        assert_eq!(fill, 0);
    }

    #[test]
    fn test_partial_market_order() {
        let order = make_buy_market(PRECISION);
        let fill = partial_fill_amount(&order, PRECISION, PRECISION / 2);
        assert_eq!(fill, PRECISION / 2);
    }

    // ============ settlement_quality Tests ============

    #[test]
    fn test_quality_perfect_settlement() {
        let orders = vec![
            make_buy(PRECISION, PRECISION),
            make_sell(PRECISION, PRECISION),
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        let quality = settlement_quality(&result, PRECISION);
        // All filled (5000/5000) + exact price match (5000/5000) = 10000
        assert_eq!(quality, 10000);
    }

    #[test]
    fn test_quality_no_fills() {
        // Create a result with no fills
        let orders = vec![
            make_buy(PRECISION, PRECISION / 2),  // limit below clearing
            make_sell(PRECISION, 2 * PRECISION),  // limit above clearing
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        let quality = settlement_quality(&result, PRECISION);
        // No fills → fill rate = 0, price exact → 0 + 5000 = 5000
        assert_eq!(quality, 5000);
    }

    #[test]
    fn test_quality_price_deviation() {
        let orders = vec![
            make_buy(PRECISION, 2 * PRECISION),
            make_sell(PRECISION, PRECISION),
        ];
        let result = match_orders(&orders, 2 * PRECISION).unwrap();
        // Reference price = PRECISION, clearing = 2*PRECISION → 100% deviation
        let quality = settlement_quality(&result, PRECISION);
        // fill_rate = 1/2 = 2500, price: deviation = 10000 bps → 0
        // But only sell fills at 2*PRECISION (sell limit PRECISION <= clearing 2*PRECISION ✓)
        // Buy fills at 2*PRECISION (buy limit 2*PRECISION >= clearing 2*PRECISION ✓)
        // So fill_count = 2, total = 2 → fill_rate = 5000
        // price deviation = 100% = 10000 bps → price_score = 0
        // Total = 5000
        assert_eq!(quality, 5000);
    }

    #[test]
    fn test_quality_small_deviation() {
        let orders = vec![
            make_buy(PRECISION, PRECISION + PRECISION / 100),   // limit 1.01
            make_sell(PRECISION, PRECISION),                     // limit 1.0
        ];
        // Clearing at 1.005 * PRECISION (slight deviation from reference of PRECISION)
        let clearing = PRECISION + PRECISION / 200; // 1.005
        let result = match_orders(&orders, clearing).unwrap();
        let quality = settlement_quality(&result, PRECISION);
        // Both should fill
        // deviation = 0.5% = 50 bps
        // price_score = (10000 - 50) * 5000 / 10000 = 4975
        // fill_rate = 2/2 * 5000 = 5000
        // total = 9975
        assert_eq!(quality, 9975);
    }

    #[test]
    fn test_quality_no_reference_price() {
        let orders = vec![
            make_buy(PRECISION, PRECISION),
            make_sell(PRECISION, PRECISION),
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        let quality = settlement_quality(&result, 0);
        // No reference: full price marks + fill rate
        // fill_rate = 5000, price = 5000 → 10000
        assert_eq!(quality, 10000);
    }

    #[test]
    fn test_quality_half_filled() {
        let orders = vec![
            make_buy_with_index(PRECISION, PRECISION, 0),
            make_sell_with_index(PRECISION, PRECISION, 1),
            make_buy_with_index(PRECISION, PRECISION / 2, 2), // won't fill
            make_sell_with_index(PRECISION, 2 * PRECISION, 3), // won't fill
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        let quality = settlement_quality(&result, PRECISION);
        // 2 of 4 filled → fill_rate = 2500
        // exact price → price_score = 5000
        // total = 7500
        assert_eq!(quality, 7500);
    }

    #[test]
    fn test_quality_score_range() {
        // Quality should always be 0-10000
        let orders = vec![
            make_buy(PRECISION, PRECISION * 1000),
            make_sell(PRECISION, 1),
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        let quality = settlement_quality(&result, PRECISION);
        assert!(quality <= 10000);
    }

    // ============ batch_summary Tests ============

    #[test]
    fn test_summary_basic() {
        let orders = vec![
            make_buy(PRECISION, PRECISION),
            make_sell(PRECISION, PRECISION),
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        let summary = batch_summary(42, &result, PRECISION);
        assert_eq!(summary.batch_id, 42);
        assert_eq!(summary.order_count, 2);
        assert_eq!(summary.buy_count, 1);
        assert_eq!(summary.sell_count, 1);
        assert_eq!(summary.clearing_price, PRECISION);
        assert_eq!(summary.matched_volume, PRECISION);
        assert_eq!(summary.fill_rate_bps, 10_000); // 100% fill rate
        assert_eq!(summary.price_improvement_bps, 0); // exact match
    }

    #[test]
    fn test_summary_price_improvement() {
        let orders = vec![
            make_buy(PRECISION, 2 * PRECISION),
            make_sell(PRECISION, PRECISION),
        ];
        let result = match_orders(&orders, 2 * PRECISION).unwrap();
        let summary = batch_summary(1, &result, PRECISION);
        // Clearing at 2.0 vs reference 1.0 → 100% improvement = 10000 bps
        assert_eq!(summary.price_improvement_bps, 10000);
    }

    #[test]
    fn test_summary_partial_fill_rate() {
        let orders = vec![
            make_buy_with_index(PRECISION, PRECISION, 0),
            make_sell_with_index(PRECISION, PRECISION, 1),
            make_buy_with_index(PRECISION, PRECISION / 2, 2),  // won't fill
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        let summary = batch_summary(1, &result, PRECISION);
        // 2 of 3 orders filled
        assert_eq!(summary.fill_rate_bps, 6666); // 2/3 * 10000 = 6666
    }

    #[test]
    fn test_summary_avg_priority_fee() {
        let orders = vec![
            make_buy_with_priority(PRECISION, PRECISION, 1000),
            make_sell_with_priority(PRECISION, PRECISION, 2000),
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        let summary = batch_summary(1, &result, PRECISION);
        // Total priority = 3000, order_count = 2 → avg = 1500
        assert_eq!(summary.avg_priority_fee, 1500);
    }

    #[test]
    fn test_summary_zero_reference_price() {
        let orders = vec![
            make_buy(PRECISION, PRECISION),
            make_sell(PRECISION, PRECISION),
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        let summary = batch_summary(1, &result, 0);
        assert_eq!(summary.price_improvement_bps, 0);
    }

    // ============ Default Fill Tests ============

    #[test]
    fn test_default_fill() {
        let fill = default_fill();
        assert_eq!(fill.owner, [0u8; 32]);
        assert_eq!(fill.order_type, OrderType::Buy);
        assert_eq!(fill.requested_amount, 0);
        assert_eq!(fill.filled_amount, 0);
        assert_eq!(fill.fill_price, 0);
        assert_eq!(fill.proceeds, 0);
        assert_eq!(fill.priority_fee_paid, 0);
        assert!(!fill.is_fully_filled);
    }

    // ============ Integration / Edge Case Tests ============

    #[test]
    fn test_full_settlement_flow() {
        // Simulate complete settlement: validate → shuffle → discover price → match
        let orders = vec![
            make_order(OrderType::Buy, PRECISION * 10, 2 * PRECISION, 500, [0x11; 32], 0),
            make_order(OrderType::Buy, PRECISION * 5, PRECISION + PRECISION / 2, 100, [0x22; 32], 1),
            make_order(OrderType::Sell, PRECISION * 8, PRECISION, 200, [0x33; 32], 2),
            make_order(OrderType::Sell, PRECISION * 3, PRECISION + PRECISION / 4, 300, [0x44; 32], 3),
        ];

        // 1. Validate
        assert!(validate_batch(&orders).is_ok());

        // 2. Shuffle
        let secrets: Vec<[u8; 32]> = orders.iter().map(|o| o.secret).collect();
        let shuffle = fisher_yates_shuffle(&secrets, 4);
        assert_eq!(shuffle.count, 4);

        // 3. Priority ordering
        let _prio = priority_ordering(&orders, &shuffle);

        // 4. Discover clearing price
        let clearing = discover_clearing_price(&orders).unwrap();
        assert!(clearing > 0);

        // 5. Match orders
        let result = match_orders(&orders, clearing).unwrap();
        assert!(result.fill_count > 0);
        assert!(result.matched_volume > 0);

        // 6. Summary
        let summary = batch_summary(1, &result, PRECISION);
        assert_eq!(summary.batch_id, 1);
        assert!(summary.fill_rate_bps > 0);
    }

    #[test]
    fn test_full_settlement_all_fill() {
        let orders = vec![
            make_order(OrderType::Buy, PRECISION * 5, PRECISION, 0, [0xAA; 32], 0),
            make_order(OrderType::Sell, PRECISION * 5, PRECISION, 0, [0xBB; 32], 1),
        ];

        validate_batch(&orders).unwrap();
        let clearing = discover_clearing_price(&orders).unwrap();
        let result = match_orders(&orders, clearing).unwrap();

        assert_eq!(result.fill_count, 2);
        assert_eq!(result.unfilled_count, 0);
        assert_eq!(result.matched_volume, PRECISION * 5);

        let quality = settlement_quality(&result, PRECISION);
        assert_eq!(quality, 10000);
    }

    #[test]
    fn test_large_batch() {
        let mut orders = Vec::new();
        // 128 buys, 128 sells
        for i in 0..128u16 {
            let mut buy = make_buy_with_index(PRECISION, PRECISION, i);
            // Ensure secret is never all-zeros: use (i % 254) + 1 so range is [1, 255]
            buy.secret = [((i % 254) as u8) + 1; 32];
            // Differentiate secrets by setting second byte to the high byte of i
            buy.secret[1] = (i >> 8) as u8;
            orders.push(buy);
        }
        for i in 0..128u16 {
            let mut sell = make_sell_with_index(PRECISION, PRECISION, 128 + i);
            sell.secret = [((i % 254) as u8) + 1; 32];
            sell.secret[1] = ((i >> 8) as u8).wrapping_add(1); // different from buy secrets
            orders.push(sell);
        }

        validate_batch(&orders).unwrap();
        let clearing = discover_clearing_price(&orders).unwrap();
        let result = match_orders(&orders, clearing).unwrap();
        assert_eq!(result.fill_count, 256);
        assert_eq!(result.matched_volume, PRECISION * 128);
    }

    #[test]
    fn test_one_buy_many_sells() {
        let mut orders = vec![
            make_buy_with_index(PRECISION * 10, PRECISION, 0),
        ];
        for i in 1..11u16 {
            let mut sell = make_sell_with_index(PRECISION, PRECISION, i);
            sell.secret = [i as u8; 32];
            orders.push(sell);
        }

        let clearing = discover_clearing_price(&orders).unwrap();
        let result = match_orders(&orders, clearing).unwrap();
        // 1 buy (10P) vs 10 sells (1P each = 10P) → fully matched
        assert_eq!(result.matched_volume, PRECISION * 10);
    }

    #[test]
    fn test_many_buys_one_sell() {
        let mut orders = Vec::new();
        for i in 0..10u16 {
            let mut buy = make_buy_with_index(PRECISION, PRECISION, i);
            buy.secret = [(i as u8).wrapping_add(1); 32];
            orders.push(buy);
        }
        let mut sell = make_sell_with_index(PRECISION * 10, PRECISION, 10);
        sell.secret = [0xFF; 32];
        orders.push(sell);

        let clearing = discover_clearing_price(&orders).unwrap();
        let result = match_orders(&orders, clearing).unwrap();
        assert_eq!(result.matched_volume, PRECISION * 10);
    }

    #[test]
    fn test_settlement_with_dust_orders() {
        let mut orders = vec![
            make_buy_with_index(PRECISION, PRECISION, 0),
            make_sell_with_index(PRECISION, PRECISION, 1),
        ];
        // Add a dust order
        let mut dust = make_buy_with_index(DUST_THRESHOLD - 1, PRECISION, 2);
        dust.secret = [0xDD; 32];
        // Dust orders will fail validation if amount > 0 but < DUST_THRESHOLD
        // but validation only checks amount == 0, not dust threshold
        // Dust check is in is_fillable
        orders.push(dust);

        let result = match_orders(&orders, PRECISION).unwrap();
        // Dust order won't be filled
        assert_eq!(result.fill_count, 2);
        assert_eq!(result.unfilled_count, 1);
    }

    #[test]
    fn test_clearing_price_with_wide_spread() {
        let orders = vec![
            make_buy_with_index(PRECISION, PRECISION * 100, 0),  // buy up to 100
            make_sell_with_index(PRECISION, PRECISION, 1),        // sell at 1+
        ];
        let price = discover_clearing_price(&orders).unwrap();
        // Both limits are valid candidates; either should work
        assert!(price >= PRECISION && price <= PRECISION * 100);
    }

    #[test]
    fn test_clearing_price_tight_spread() {
        let orders = vec![
            make_buy_with_index(PRECISION, PRECISION + 1, 0),
            make_sell_with_index(PRECISION, PRECISION, 1),
        ];
        let price = discover_clearing_price(&orders).unwrap();
        assert!(price >= PRECISION && price <= PRECISION + 1);
    }

    #[test]
    fn test_settlement_u128_max_amount() {
        // Use large but not max amounts (to avoid overflow in mul_div)
        let large = u128::MAX / (PRECISION * 2);
        let orders = vec![
            make_buy(large, PRECISION),
            make_sell(large, PRECISION),
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        assert_eq!(result.fill_count, 2);
        assert_eq!(result.matched_volume, large);
    }

    #[test]
    fn test_settlement_single_buy_single_sell() {
        let orders = vec![
            make_buy(MIN_FILL_AMOUNT, PRECISION),
            make_sell(MIN_FILL_AMOUNT, PRECISION),
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        assert_eq!(result.fill_count, 2);
        assert_eq!(result.matched_volume, MIN_FILL_AMOUNT);
    }

    #[test]
    fn test_settlement_all_same_price() {
        let price = PRECISION * 42;
        let mut orders = Vec::new();
        for i in 0..5u16 {
            let mut buy = make_buy_with_index(PRECISION, price, i);
            buy.secret = [(i as u8).wrapping_add(1); 32];
            orders.push(buy);
        }
        for i in 0..5u16 {
            let mut sell = make_sell_with_index(PRECISION, price, 5 + i);
            sell.secret = [(i as u8).wrapping_add(6); 32];
            orders.push(sell);
        }

        let clearing = discover_clearing_price(&orders).unwrap();
        assert_eq!(clearing, price);
        let result = match_orders(&orders, clearing).unwrap();
        assert_eq!(result.fill_count, 10);
    }

    #[test]
    fn test_proceeds_symmetry() {
        // At price 1.0: buying X tokens costs X quote, selling X tokens yields X quote
        let amount = PRECISION * 7;
        let buy_proceeds = compute_proceeds(amount, PRECISION, &OrderType::Buy);
        let sell_proceeds = compute_proceeds(amount, PRECISION, &OrderType::Sell);
        assert_eq!(buy_proceeds, sell_proceeds);
    }

    #[test]
    fn test_xor_seed_used_in_shuffle() {
        let s1 = [0x11; 32];
        let s2 = [0x22; 32];
        let expected_seed = compute_xor_seed(&[s1, s2]);
        let shuffle = fisher_yates_shuffle(&[s1, s2], 2);
        assert_eq!(shuffle.xor_seed, expected_seed);
    }

    #[test]
    fn test_fees_consistency_in_match() {
        let orders = vec![
            make_buy_with_priority(PRECISION * 100, PRECISION, 10_000),
            make_sell_with_priority(PRECISION * 100, PRECISION, 5_000),
        ];
        let result = match_orders(&orders, PRECISION).unwrap();

        // Verify fee distribution matches standalone computation
        let (lp, protocol) = distribute_fees(result.total_priority_fees, result.matched_volume);
        assert_eq!(result.lp_fee_share, lp);
        assert_eq!(result.protocol_fee, protocol);
    }

    #[test]
    fn test_fill_count_matches_fills_array() {
        let orders = vec![
            make_buy_with_index(PRECISION, PRECISION, 0),
            make_sell_with_index(PRECISION, PRECISION, 1),
            make_buy_with_index(PRECISION, PRECISION / 2, 2), // won't fill
        ];
        let result = match_orders(&orders, PRECISION).unwrap();

        // Count non-zero fills in the array
        let actual_fills = result.fills[..result.fill_count_actual as usize]
            .iter()
            .filter(|f| f.filled_amount > 0)
            .count() as u32;
        assert_eq!(actual_fills, result.fill_count);
    }

    #[test]
    fn test_unfilled_orders_in_result() {
        let orders = vec![
            make_buy(PRECISION, PRECISION),
            make_sell(PRECISION, 2 * PRECISION), // limit above clearing → won't fill
        ];
        let result = match_orders(&orders, PRECISION).unwrap();

        // The sell order won't fill because its limit (2P) > clearing (1P)
        assert_eq!(result.unfilled_count, 1);
        assert_eq!(result.fill_count, 1);
        // matched_volume = min(buy_filled, sell_filled) = min(1P, 0) = 0
        assert_eq!(result.matched_volume, 0);
    }

    #[test]
    fn test_priority_ordering_all_zero_fees() {
        let orders = vec![
            make_order(OrderType::Buy, PRECISION, PRECISION, 0, [0xAA; 32], 0),
            make_order(OrderType::Sell, PRECISION, PRECISION, 0, [0xBB; 32], 1),
            make_order(OrderType::Buy, PRECISION, PRECISION, 0, [0xCC; 32], 2),
            make_order(OrderType::Sell, PRECISION, PRECISION, 0, [0xDD; 32], 3),
        ];
        let shuffle = fisher_yates_shuffle(
            &[orders[0].secret, orders[1].secret, orders[2].secret, orders[3].secret],
            4,
        );
        let result = priority_ordering(&orders, &shuffle);
        // All zero fees → same as shuffle order
        let mut present: Vec<u16> = result[..4].to_vec();
        present.sort();
        assert_eq!(present, vec![0, 1, 2, 3]);
    }

    #[test]
    fn test_partial_fill_market_order_large_remaining() {
        let order = make_buy_market(PRECISION);
        let fill = partial_fill_amount(&order, PRECISION, PRECISION * 100);
        // Order amount is PRECISION, remaining is 100*PRECISION → fill = PRECISION
        assert_eq!(fill, PRECISION);
    }

    #[test]
    fn test_estimate_single_pair() {
        let buys = vec![(PRECISION * 2, PRECISION * 10)];
        let sells = vec![(PRECISION, PRECISION * 10)];
        let price = estimate_clearing_price(&buys, &sells).unwrap();
        // At PRECISION: buy vol = 10P (2P >= 1P), sell vol = 10P (1P <= 1P) → matched = 10P
        // At 2*PRECISION: buy vol = 10P (2P >= 2P), sell vol = 10P (1P <= 2P) → matched = 10P
        // Both valid, should pick one
        assert!(price > 0);
    }

    #[test]
    fn test_compute_proceeds_precision() {
        // 1 token at price 3.0 → buyer pays 1 token equivalent, gets 1/3
        let proceeds = compute_proceeds(PRECISION, 3 * PRECISION, &OrderType::Buy);
        // tokens = 1e18 * 1e18 / 3e18 = 1e18/3 = 333333333333333333
        assert_eq!(proceeds, PRECISION / 3);
    }

    #[test]
    fn test_clearing_price_maximizes_volume() {
        // At price 1.0: buy vol = 3P (all 3 buys fill), sell vol = 3P (all 3 sells fill) → matched = 3
        // At price 2.0: buy vol = 2P (only buys with limit >= 2), sell vol = 3P → matched = 2
        // At price 3.0: buy vol = 1P (only buy with limit >= 3), sell vol = 3P → matched = 1
        // Price 1.0 should be selected
        let orders = vec![
            make_buy_with_index(PRECISION, 3 * PRECISION, 0),
            make_buy_with_index(PRECISION, 2 * PRECISION, 1),
            make_buy_with_index(PRECISION, PRECISION, 2),
            make_sell_with_index(PRECISION, PRECISION, 3),
            make_sell_with_index(PRECISION, PRECISION, 4),
            make_sell_with_index(PRECISION, PRECISION, 5),
        ];
        let price = discover_clearing_price(&orders).unwrap();
        assert_eq!(price, PRECISION);
    }

    #[test]
    fn test_match_orders_clearing_price_stored() {
        let orders = vec![
            make_buy(PRECISION, PRECISION),
            make_sell(PRECISION, PRECISION),
        ];
        let result = match_orders(&orders, 42 * PRECISION).unwrap();
        assert_eq!(result.clearing_price, 42 * PRECISION);
    }

    #[test]
    fn test_batch_summary_zero_orders() {
        // Create a result with zero order_count by direct construction
        let result = SettlementResult {
            clearing_price: PRECISION,
            total_buy_volume: 0,
            total_sell_volume: 0,
            matched_volume: 0,
            fill_count: 0,
            unfilled_count: 0,
            total_priority_fees: 0,
            lp_fee_share: 0,
            protocol_fee: 0,
            fills: [Fill::default(); 256],
            fill_count_actual: 0,
        };
        let summary = batch_summary(1, &result, PRECISION);
        assert_eq!(summary.order_count, 0);
        assert_eq!(summary.fill_rate_bps, 0);
        assert_eq!(summary.avg_priority_fee, 0);
    }

    #[test]
    fn test_settlement_quality_extreme_deviation() {
        let result = SettlementResult {
            clearing_price: PRECISION * 1000,
            total_buy_volume: PRECISION,
            total_sell_volume: PRECISION,
            matched_volume: PRECISION,
            fill_count: 2,
            unfilled_count: 0,
            total_priority_fees: 0,
            lp_fee_share: 0,
            protocol_fee: 0,
            fills: [Fill::default(); 256],
            fill_count_actual: 2,
        };
        let quality = settlement_quality(&result, PRECISION);
        // deviation = 999 * PRECISION / PRECISION * 10000 = 9990000 bps → way over 10000 → price_score = 0
        // fill_rate = 2/2 * 5000 = 5000
        // total = 5000
        assert_eq!(quality, 5000);
    }

    #[test]
    fn test_is_fillable_buy_exact_clearing() {
        let order = make_buy(PRECISION, PRECISION * 5);
        // limit = 5P, clearing = 5P → buy fills (limit >= clearing)
        assert!(is_fillable(&order, PRECISION * 5));
    }

    #[test]
    fn test_is_fillable_sell_exact_clearing() {
        let order = make_sell(PRECISION, PRECISION * 5);
        // limit = 5P, clearing = 5P → sell fills (limit <= clearing)
        assert!(is_fillable(&order, PRECISION * 5));
    }

    #[test]
    fn test_shuffle_invariant_count() {
        for n in 0..20u16 {
            let mut secrets = Vec::new();
            for i in 0..n {
                secrets.push([(i as u8).wrapping_add(1); 32]);
            }
            let result = fisher_yates_shuffle(&secrets, n);
            assert_eq!(result.count, n);
        }
    }

    #[test]
    fn test_match_orders_all_unfilled() {
        // All buys below clearing, all sells above clearing
        let orders = vec![
            make_buy_with_index(PRECISION, PRECISION / 2, 0),     // limit 0.5 < clearing 1.0
            make_sell_with_index(PRECISION, 2 * PRECISION, 1),    // limit 2.0 > clearing 1.0
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        assert_eq!(result.fill_count, 0);
        assert_eq!(result.unfilled_count, 2);
        assert_eq!(result.matched_volume, 0);
    }

    #[test]
    fn test_clearing_with_many_price_levels() {
        let mut orders = Vec::new();
        for i in 1..=20u16 {
            let mut buy = make_buy_with_index(PRECISION, PRECISION * i as u128, i - 1);
            buy.secret = [i as u8; 32];
            orders.push(buy);
        }
        for i in 1..=20u16 {
            let mut sell = make_sell_with_index(PRECISION, PRECISION * i as u128, 19 + i);
            sell.secret = [(i as u8).wrapping_add(20); 32];
            orders.push(sell);
        }

        let price = discover_clearing_price(&orders).unwrap();
        assert!(price > 0);
    }

    #[test]
    fn test_partial_fill_sell_order() {
        let order = make_sell(PRECISION * 5, PRECISION);
        let fill = partial_fill_amount(&order, PRECISION, PRECISION * 3);
        assert_eq!(fill, PRECISION * 3);
    }

    #[test]
    fn test_compute_fill_sell_market_at_high_price() {
        let order = make_sell_market(PRECISION);
        let fill = compute_fill(&order, PRECISION * 100);
        assert!(fill.is_fully_filled);
        assert_eq!(fill.filled_amount, PRECISION);
        // proceeds = 1e18 * 100e18 / 1e18 = 100e18
        assert_eq!(fill.proceeds, PRECISION * 100);
    }

    #[test]
    fn test_compute_fill_buy_market_at_low_price() {
        let order = make_buy_market(PRECISION);
        let fill = compute_fill(&order, PRECISION / 100);
        assert!(fill.is_fully_filled);
        // proceeds = 1e18 * 1e18 / (1e18/100) = 100e18
        assert_eq!(fill.proceeds, PRECISION * 100);
    }

    #[test]
    fn test_estimate_clearing_price_multiple_buys_one_sell() {
        let buys = vec![
            (PRECISION * 3, PRECISION),
            (PRECISION * 2, PRECISION),
            (PRECISION, PRECISION),
        ];
        let sells = vec![(PRECISION, PRECISION * 2)];
        let price = estimate_clearing_price(&buys, &sells).unwrap();
        assert!(price > 0);
    }

    #[test]
    fn test_estimate_clearing_price_one_buy_multiple_sells() {
        let buys = vec![(PRECISION * 3, PRECISION * 3)];
        let sells = vec![
            (PRECISION, PRECISION),
            (PRECISION * 2, PRECISION),
            (PRECISION * 3, PRECISION),
        ];
        let price = estimate_clearing_price(&buys, &sells).unwrap();
        assert!(price > 0);
    }

    #[test]
    fn test_batch_summary_all_buys_no_sells() {
        // Direct construction: no sells → matched = 0
        let result = SettlementResult {
            clearing_price: PRECISION,
            total_buy_volume: PRECISION * 5,
            total_sell_volume: 0,
            matched_volume: 0,
            fill_count: 0,
            unfilled_count: 5,
            total_priority_fees: 0,
            lp_fee_share: 0,
            protocol_fee: 0,
            fills: [Fill::default(); 256],
            fill_count_actual: 5,
        };
        let summary = batch_summary(99, &result, PRECISION);
        assert_eq!(summary.order_count, 5);
        assert_eq!(summary.fill_rate_bps, 0);
        assert_eq!(summary.matched_volume, 0);
    }

    #[test]
    fn test_settlement_quality_zero_clearing_price() {
        let result = SettlementResult {
            clearing_price: 0,
            total_buy_volume: 0,
            total_sell_volume: 0,
            matched_volume: 0,
            fill_count: 0,
            unfilled_count: 0,
            total_priority_fees: 0,
            lp_fee_share: 0,
            protocol_fee: 0,
            fills: [Fill::default(); 256],
            fill_count_actual: 0,
        };
        let quality = settlement_quality(&result, PRECISION);
        // fill_rate = 0 (no orders), price: clearing = 0 with reference > 0 → price_score = 0
        assert_eq!(quality, 0);
    }

    #[test]
    fn test_match_orders_fills_array_capacity() {
        // 256 orders = max capacity
        let mut orders = Vec::new();
        for i in 0..128u16 {
            let mut buy = make_buy_with_index(PRECISION, PRECISION, i);
            buy.secret = [((i % 254) as u8) + 1; 32];
            buy.secret[1] = (i >> 8) as u8;
            orders.push(buy);
        }
        for i in 0..128u16 {
            let mut sell = make_sell_with_index(PRECISION, PRECISION, 128 + i);
            sell.secret = [((i % 254) as u8) + 1; 32];
            sell.secret[1] = ((i >> 8) as u8).wrapping_add(1);
            orders.push(sell);
        }

        let result = match_orders(&orders, PRECISION).unwrap();
        assert_eq!(result.fill_count_actual, 256);
        assert_eq!(result.fill_count, 256);
    }

    #[test]
    fn test_validate_batch_single_buy() {
        let orders = vec![make_buy(PRECISION, PRECISION)];
        assert!(validate_batch(&orders).is_ok());
    }

    #[test]
    fn test_validate_batch_single_sell() {
        let orders = vec![make_sell(PRECISION, PRECISION)];
        assert!(validate_batch(&orders).is_ok());
    }

    #[test]
    fn test_xor_seed_four_secrets() {
        let s1 = [0x01; 32];
        let s2 = [0x02; 32];
        let s3 = [0x04; 32];
        let s4 = [0x08; 32];
        let seed = compute_xor_seed(&[s1, s2, s3, s4]);
        assert_eq!(seed, [0x01 ^ 0x02 ^ 0x04 ^ 0x08; 32]);
        assert_eq!(seed, [0x0F; 32]);
    }

    #[test]
    fn test_match_orders_priority_fees_sum() {
        let orders = vec![
            make_order(OrderType::Buy, PRECISION, PRECISION, 100, [0xAA; 32], 0),
            make_order(OrderType::Buy, PRECISION, PRECISION, 200, [0xBB; 32], 1),
            make_order(OrderType::Sell, PRECISION * 2, PRECISION, 300, [0xCC; 32], 2),
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        assert_eq!(result.total_priority_fees, 100 + 200 + 300);
    }

    #[test]
    fn test_proceeds_buy_very_low_price() {
        // Buy at very low price → many tokens
        let proceeds = compute_proceeds(PRECISION, 1, &OrderType::Buy);
        // tokens = PRECISION * PRECISION / 1 = PRECISION^2
        assert_eq!(proceeds, PRECISION * PRECISION);
    }

    #[test]
    fn test_proceeds_sell_very_high_price() {
        // Sell at very high price → large proceeds
        let price = PRECISION * 1_000_000;
        let proceeds = compute_proceeds(PRECISION, price, &OrderType::Sell);
        assert_eq!(proceeds, PRECISION * 1_000_000);
    }

    #[test]
    fn test_shuffle_three_orders_permutation() {
        let secrets = [[0x11; 32], [0x22; 32], [0x33; 32]];
        let result = fisher_yates_shuffle(&secrets, 3);
        let mut sorted: Vec<u16> = result.order[..3].to_vec();
        sorted.sort();
        assert_eq!(sorted, vec![0, 1, 2]);
    }

    #[test]
    fn test_clearing_with_overlapping_ranges() {
        // Buy limits: [5, 10], Sell limits: [3, 7]
        // Overlap at 5-7
        let orders = vec![
            make_buy_with_index(PRECISION, PRECISION * 5, 0),
            make_buy_with_index(PRECISION, PRECISION * 10, 1),
            make_sell_with_index(PRECISION, PRECISION * 3, 2),
            make_sell_with_index(PRECISION, PRECISION * 7, 3),
        ];
        let price = discover_clearing_price(&orders).unwrap();
        assert!(price > 0);
    }

    #[test]
    fn test_match_orders_preserves_owners() {
        let mut buy = make_buy(PRECISION, PRECISION);
        buy.owner = [0xDE; 32];
        let mut sell = make_sell(PRECISION, PRECISION);
        sell.owner = [0xAD; 32];

        let result = match_orders(&[buy, sell], PRECISION).unwrap();
        assert_eq!(result.fills[0].owner, [0xDE; 32]);
        assert_eq!(result.fills[1].owner, [0xAD; 32]);
    }

    #[test]
    fn test_settlement_quality_50_percent_deviation() {
        let result = SettlementResult {
            clearing_price: PRECISION + PRECISION / 2, // 1.5
            total_buy_volume: PRECISION,
            total_sell_volume: PRECISION,
            matched_volume: PRECISION,
            fill_count: 2,
            unfilled_count: 0,
            total_priority_fees: 0,
            lp_fee_share: 0,
            protocol_fee: 0,
            fills: [Fill::default(); 256],
            fill_count_actual: 2,
        };
        let quality = settlement_quality(&result, PRECISION);
        // fill_rate = 5000, deviation = 50% = 5000 bps → price_score = (10000-5000)*5000/10000 = 2500
        // total = 7500
        assert_eq!(quality, 7500);
    }

    #[test]
    fn test_batch_summary_counts_buy_sell() {
        let orders = vec![
            make_buy_with_index(PRECISION, PRECISION, 0),
            make_buy_with_index(PRECISION, PRECISION, 1),
            make_buy_with_index(PRECISION, PRECISION, 2),
            make_sell_with_index(PRECISION * 3, PRECISION, 3),
        ];
        let result = match_orders(&orders, PRECISION).unwrap();
        let summary = batch_summary(1, &result, PRECISION);
        assert_eq!(summary.buy_count, 3);
        assert_eq!(summary.sell_count, 1);
    }

    #[test]
    fn test_partial_fill_sell_unfillable() {
        // Sell limit 2.0 at clearing 1.0 → unfillable
        let order = make_sell(PRECISION, 2 * PRECISION);
        let fill = partial_fill_amount(&order, PRECISION, PRECISION);
        assert_eq!(fill, 0);
    }

    #[test]
    fn test_fees_priority_share_exact_half() {
        let (lp, _) = distribute_fees(BPS as u128 * 2, 0);
        // 20000 * 5000 / 10000 = 10000
        assert_eq!(lp, BPS);
    }
}
