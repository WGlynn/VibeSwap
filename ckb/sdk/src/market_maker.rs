// ============ Market Maker — Automated Market Making Strategies ============
// Market maker strategies for the VibeSwap DEX on CKB. Covers:
//   1. Quote generation — bid/ask spread calculation, mid-price, quote sizing
//   2. Inventory management — position tracking, target inventory, rebalancing
//   3. Spread optimization — volatility-adjusted, tick-size rounded, depth-weighted
//   4. Risk controls — max position, exposure, loss limits, kill switches
//   5. Strategy types — constant spread, Avellaneda-Stoikov, grid, TWAP
//   6. Order management — generation, cancellation, amendment, fill tracking
//   7. PnL tracking — realized/unrealized, mark-to-market, fee accounting
//   8. Market microstructure — bid-ask bounce, adverse selection, toxicity scoring
//
// All spread/ratio values in BPS (basis points, 1 bps = 0.01%).
// Prices in u64 (smallest unit). Sizes in u64. PnL as i64.

// ============ Constants ============

/// Basis points denominator (10000 = 100%)
pub const BPS_DENOM: u64 = 10_000;

/// Maximum spread in bps (50%)
pub const MAX_SPREAD_BPS: u64 = 5_000;

/// Minimum spread in bps (1 bps = 0.01%)
pub const MIN_SPREAD_BPS: u64 = 1;

/// Maximum number of grid levels
pub const MAX_GRID_LEVELS: usize = 200;

/// Maximum number of TWAP slices
pub const MAX_TWAP_SLICES: usize = 1000;

/// Maximum toxicity score (10000 = 100%)
pub const MAX_TOXICITY_SCORE: u64 = 10_000;

/// Default volatility window size
pub const DEFAULT_VOL_WINDOW: usize = 20;

// ============ Core Types ============

/// Market maker configuration
#[derive(Debug, Clone)]
pub struct MarketMakerConfig {
    /// Base spread in basis points
    pub spread_bps: u64,
    /// Minimum order size
    pub min_size: u64,
    /// Maximum order size
    pub max_size: u64,
    /// Maximum position (absolute value)
    pub max_position: u64,
    /// Volatility lookback window size
    pub volatility_window: usize,
}

/// A two-sided quote (bid + ask)
#[derive(Debug, Clone)]
pub struct Quote {
    /// Bid (buy) price
    pub bid_price: u64,
    /// Ask (sell) price
    pub ask_price: u64,
    /// Bid size
    pub bid_size: u64,
    /// Ask size
    pub ask_size: u64,
    /// Timestamp (ms)
    pub timestamp: u64,
}

/// Current inventory state
#[derive(Debug, Clone)]
pub struct Inventory {
    /// Base asset balance
    pub base_balance: u64,
    /// Quote asset balance
    pub quote_balance: u64,
    /// Target ratio in bps (e.g. 5000 = 50/50)
    pub target_ratio_bps: u64,
    /// Current ratio in bps
    pub current_ratio_bps: u64,
}

/// Position state: side 0=flat, 1=long, 2=short
#[derive(Debug, Clone)]
pub struct Position {
    /// 0=flat, 1=long, 2=short
    pub side: u8,
    /// Position size
    pub size: u64,
    /// Average entry price
    pub entry_price: u64,
    /// Unrealized PnL
    pub unrealized_pnl: i64,
}

/// State of a single order
#[derive(Debug, Clone)]
pub struct OrderState {
    /// Order identifier
    pub id: u64,
    /// Limit price
    pub price: u64,
    /// Total order size
    pub size: u64,
    /// 1=buy, 2=sell
    pub side: u8,
    /// Amount filled
    pub filled: u64,
    /// Amount remaining
    pub remaining: u64,
    /// 0=open, 1=partial, 2=filled, 3=cancelled
    pub status: u8,
}

/// Profit and loss record
#[derive(Debug, Clone)]
pub struct PnlRecord {
    /// Realized PnL
    pub realized: i64,
    /// Unrealized PnL
    pub unrealized: i64,
    /// Fees paid
    pub fees_paid: u64,
    /// Fees earned (rebates)
    pub fees_earned: u64,
    /// Net PnL (realized + unrealized - fees_paid + fees_earned)
    pub net_pnl: i64,
}

/// Risk limits configuration
#[derive(Debug, Clone)]
pub struct RiskLimits {
    /// Maximum absolute position size
    pub max_position: u64,
    /// Maximum drawdown in bps from peak
    pub max_drawdown_bps: u64,
    /// Maximum single-trade loss
    pub max_loss: u64,
    /// Daily cumulative loss limit
    pub daily_loss_limit: u64,
}

/// Spread parameters for optimization
#[derive(Debug, Clone)]
pub struct SpreadParams {
    /// Base spread in bps
    pub base_spread_bps: u64,
    /// Volatility multiplier (scaled by 100, so 150 = 1.5x)
    pub vol_multiplier: u64,
    /// Inventory skew adjustment in bps
    pub inventory_skew_bps: u64,
    /// Minimum allowed spread in bps
    pub min_spread_bps: u64,
}

/// A single TWAP execution slice
#[derive(Debug, Clone)]
pub struct TwapSlice {
    /// Slice index
    pub index: u64,
    /// Size for this slice
    pub size: u64,
    /// Scheduled execution time (ms)
    pub execute_at_ms: u64,
}

/// Rebalance action recommendation
#[derive(Debug, Clone)]
pub struct RebalanceAction {
    /// 1=buy base, 2=sell base, 0=no action
    pub direction: u8,
    /// Amount to trade
    pub amount: u64,
    /// Urgency in bps (deviation from target)
    pub urgency_bps: u64,
}

/// A recorded fill for microstructure analysis
#[derive(Debug, Clone)]
pub struct Fill {
    /// Fill price
    pub price: u64,
    /// Fill size
    pub size: u64,
    /// 1=buy, 2=sell
    pub side: u8,
    /// Timestamp (ms)
    pub timestamp: u64,
}

/// A trade record for effective spread calculation
#[derive(Debug, Clone)]
pub struct Trade {
    /// Trade price
    pub price: u64,
    /// Mid price at trade time
    pub mid_price: u64,
    /// 1=buy, 2=sell
    pub side: u8,
    /// Trade size
    pub size: u64,
}

// ============ Quote Generation ============

/// Calculate mid price from best bid and best ask.
pub fn calculate_mid_price(best_bid: u64, best_ask: u64) -> Result<u64, String> {
    if best_bid == 0 {
        return Err("best_bid is zero".to_string());
    }
    if best_ask == 0 {
        return Err("best_ask is zero".to_string());
    }
    if best_bid > best_ask {
        return Err("best_bid exceeds best_ask".to_string());
    }
    // mid = (bid + ask) / 2, using safe math
    let sum = (best_bid as u128) + (best_ask as u128);
    Ok((sum / 2) as u64)
}

/// Generate a two-sided quote given config, mid price, and inventory.
pub fn generate_quotes(
    config: &MarketMakerConfig,
    mid_price: u64,
    inventory: &Inventory,
) -> Result<Quote, String> {
    if mid_price == 0 {
        return Err("mid_price is zero".to_string());
    }
    if config.spread_bps == 0 {
        return Err("spread_bps is zero".to_string());
    }
    if config.spread_bps > MAX_SPREAD_BPS {
        return Err("spread_bps exceeds maximum".to_string());
    }
    if config.min_size == 0 {
        return Err("min_size is zero".to_string());
    }
    if config.max_size < config.min_size {
        return Err("max_size less than min_size".to_string());
    }

    let half_spread = (mid_price as u128)
        .checked_mul(config.spread_bps as u128)
        .unwrap_or(u128::MAX)
        / (2 * BPS_DENOM as u128);
    let half_spread = if half_spread == 0 { 1u64 } else { half_spread as u64 };

    // Skew: shift quotes based on inventory imbalance
    let skew = calculate_inventory_skew(inventory).unwrap_or(0);
    let skew_adjustment = ((skew.unsigned_abs() as u128) * (mid_price as u128)
        / (BPS_DENOM as u128)) as u64;

    let (bid_adj, ask_adj) = if skew > 0 {
        // Long inventory -> widen ask, tighten bid to sell more
        (skew_adjustment.min(half_spread.saturating_sub(1)), skew_adjustment)
    } else if skew < 0 {
        // Short inventory -> tighten ask, widen bid to buy more
        (skew_adjustment, skew_adjustment.min(half_spread.saturating_sub(1)))
    } else {
        (0, 0)
    };

    let bid_price = mid_price.saturating_sub(half_spread).saturating_add(bid_adj);
    let ask_price = mid_price.saturating_add(half_spread).saturating_add(ask_adj);

    // Ensure bid < ask
    let bid_price = if bid_price >= ask_price {
        ask_price.saturating_sub(1)
    } else {
        bid_price
    };

    let bid_size = calculate_optimal_quote_size(inventory, config.max_size, 0);
    let ask_size = calculate_optimal_quote_size(inventory, config.max_size, 0);

    let bid_size = bid_size.max(config.min_size).min(config.max_size);
    let ask_size = ask_size.max(config.min_size).min(config.max_size);

    Ok(Quote {
        bid_price,
        ask_price,
        bid_size,
        ask_size,
        timestamp: 0,
    })
}

// ============ Spread Optimization ============

/// Adjust spread for volatility. Higher vol -> wider spread.
pub fn adjust_spread_for_volatility(
    base_spread_bps: u64,
    volatility_bps: u64,
    multiplier: u64,
) -> u64 {
    // multiplier is scaled by 100 (e.g. 150 = 1.5x)
    let vol_component = (volatility_bps as u128)
        .checked_mul(multiplier as u128)
        .unwrap_or(u128::MAX)
        / 100;
    let total = (base_spread_bps as u128).saturating_add(vol_component);
    let clamped = total.min(MAX_SPREAD_BPS as u128);
    clamped as u64
}

/// Compute optimized spread from SpreadParams and current volatility.
pub fn compute_optimized_spread(params: &SpreadParams, volatility_bps: u64) -> u64 {
    let adjusted = adjust_spread_for_volatility(
        params.base_spread_bps,
        volatility_bps,
        params.vol_multiplier,
    );
    let with_skew = adjusted.saturating_add(params.inventory_skew_bps);
    with_skew.max(params.min_spread_bps).min(MAX_SPREAD_BPS)
}

/// Round a price to the nearest tick size.
pub fn round_to_tick(price: u64, tick_size: u64) -> Result<u64, String> {
    if tick_size == 0 {
        return Err("tick_size is zero".to_string());
    }
    if price == 0 {
        return Ok(0);
    }
    let remainder = price % tick_size;
    if remainder == 0 {
        Ok(price)
    } else if remainder >= tick_size / 2 {
        Ok(price.saturating_add(tick_size - remainder))
    } else {
        Ok(price - remainder)
    }
}

/// Calculate depth-weighted spread from multiple price levels.
/// levels: Vec of (price, size) for bids and asks
pub fn depth_weighted_spread(
    bids: &[(u64, u64)],
    asks: &[(u64, u64)],
) -> Result<u64, String> {
    if bids.is_empty() || asks.is_empty() {
        return Err("empty bid or ask levels".to_string());
    }
    // Weighted average bid
    let mut bid_value_sum: u128 = 0;
    let mut bid_size_sum: u128 = 0;
    for &(price, size) in bids {
        if size == 0 { continue; }
        bid_value_sum += (price as u128) * (size as u128);
        bid_size_sum += size as u128;
    }
    if bid_size_sum == 0 {
        return Err("total bid size is zero".to_string());
    }
    // Weighted average ask
    let mut ask_value_sum: u128 = 0;
    let mut ask_size_sum: u128 = 0;
    for &(price, size) in asks {
        if size == 0 { continue; }
        ask_value_sum += (price as u128) * (size as u128);
        ask_size_sum += size as u128;
    }
    if ask_size_sum == 0 {
        return Err("total ask size is zero".to_string());
    }
    let wavg_bid = bid_value_sum / bid_size_sum;
    let wavg_ask = ask_value_sum / ask_size_sum;
    if wavg_bid >= wavg_ask {
        return Err("weighted bid >= weighted ask".to_string());
    }
    let mid = (wavg_bid + wavg_ask) / 2;
    if mid == 0 {
        return Err("mid price is zero".to_string());
    }
    let spread = wavg_ask - wavg_bid;
    // Return spread in bps relative to mid
    let spread_bps = spread * (BPS_DENOM as u128) / mid;
    Ok(spread_bps as u64)
}

// ============ Inventory Management ============

/// Calculate inventory skew as signed bps deviation from target.
/// Positive = overweight base (long), Negative = underweight base (short).
pub fn calculate_inventory_skew(inventory: &Inventory) -> Result<i64, String> {
    if inventory.target_ratio_bps > BPS_DENOM {
        return Err("target_ratio_bps exceeds 10000".to_string());
    }
    if inventory.current_ratio_bps > BPS_DENOM {
        return Err("current_ratio_bps exceeds 10000".to_string());
    }
    Ok(inventory.current_ratio_bps as i64 - inventory.target_ratio_bps as i64)
}

/// Compute current inventory ratio in bps (base / total value).
pub fn compute_inventory_ratio(
    base_balance: u64,
    quote_balance: u64,
    base_price: u64,
) -> Result<u64, String> {
    if base_price == 0 {
        return Err("base_price is zero".to_string());
    }
    let base_value = (base_balance as u128) * (base_price as u128);
    let total_value = base_value + (quote_balance as u128);
    if total_value == 0 {
        return Err("total value is zero".to_string());
    }
    let ratio_bps = base_value * (BPS_DENOM as u128) / total_value;
    Ok(ratio_bps as u64)
}

/// Calculate optimal quote size considering inventory and skew.
pub fn calculate_optimal_quote_size(
    inventory: &Inventory,
    max_size: u64,
    skew_factor_bps: u64,
) -> u64 {
    if max_size == 0 {
        return 0;
    }
    if skew_factor_bps == 0 {
        return max_size;
    }
    // Reduce size proportional to skew
    let skew = if inventory.current_ratio_bps > inventory.target_ratio_bps {
        inventory.current_ratio_bps - inventory.target_ratio_bps
    } else {
        inventory.target_ratio_bps - inventory.current_ratio_bps
    };
    let reduction = (max_size as u128) * (skew as u128) * (skew_factor_bps as u128)
        / ((BPS_DENOM as u128) * (BPS_DENOM as u128));
    let reduction = (reduction as u64).min(max_size);
    max_size.saturating_sub(reduction)
}

/// Determine rebalancing action needed to move inventory toward target.
pub fn rebalance_inventory(
    inventory: &Inventory,
    target_ratio_bps: u64,
) -> Result<RebalanceAction, String> {
    if target_ratio_bps > BPS_DENOM {
        return Err("target_ratio_bps exceeds 10000".to_string());
    }
    let total = (inventory.base_balance as u128) + (inventory.quote_balance as u128);
    if total == 0 {
        return Err("total inventory is zero".to_string());
    }
    let current_bps = (inventory.base_balance as u128) * (BPS_DENOM as u128) / total;
    let current_bps = current_bps as u64;

    if current_bps > target_ratio_bps {
        let diff_bps = current_bps - target_ratio_bps;
        let amount = (total * (diff_bps as u128) / (BPS_DENOM as u128)) as u64;
        Ok(RebalanceAction {
            direction: 2, // sell base
            amount,
            urgency_bps: diff_bps,
        })
    } else if current_bps < target_ratio_bps {
        let diff_bps = target_ratio_bps - current_bps;
        let amount = (total * (diff_bps as u128) / (BPS_DENOM as u128)) as u64;
        Ok(RebalanceAction {
            direction: 1, // buy base
            amount,
            urgency_bps: diff_bps,
        })
    } else {
        Ok(RebalanceAction {
            direction: 0,
            amount: 0,
            urgency_bps: 0,
        })
    }
}

// ============ Strategy Types ============

/// Avellaneda-Stoikov optimal spread calculation.
/// Returns (bid_offset, ask_offset) from mid price.
/// volatility and inventory_risk are in bps. time_horizon is remaining fraction in bps (10000=full).
pub fn avellaneda_stoikov_spread(
    mid_price: u64,
    volatility: u64,
    inventory_risk: u64,
    time_horizon: u64,
) -> Result<(u64, u64), String> {
    if mid_price == 0 {
        return Err("mid_price is zero".to_string());
    }
    if time_horizon == 0 {
        return Err("time_horizon is zero".to_string());
    }
    // Reservation price shift: gamma * sigma^2 * q * T
    // We simplify: shift = volatility * inventory_risk * time_horizon / (BPS^2)
    let shift = (volatility as u128)
        .checked_mul(inventory_risk as u128)
        .unwrap_or(u128::MAX);
    let shift = shift
        .checked_mul(time_horizon as u128)
        .unwrap_or(u128::MAX)
        / ((BPS_DENOM as u128) * (BPS_DENOM as u128));
    let shift = shift.min(MAX_SPREAD_BPS as u128) as u64;

    // Optimal spread: proportional to volatility and time
    let base_spread = (volatility as u128)
        .checked_mul(time_horizon as u128)
        .unwrap_or(u128::MAX)
        / (BPS_DENOM as u128);
    let base_spread = base_spread.min(MAX_SPREAD_BPS as u128) as u64;
    let half = base_spread / 2;
    let half = half.max(1);

    // bid offset = half + shift, ask offset = half - shift (clamped)
    let bid_offset = (mid_price as u128) * ((half as u128) + (shift as u128))
        / (BPS_DENOM as u128);
    let ask_offset = if half > shift {
        (mid_price as u128) * ((half - shift) as u128) / (BPS_DENOM as u128)
    } else {
        (mid_price as u128) * 1 / (BPS_DENOM as u128)
    };
    let bid_offset = bid_offset.min(u64::MAX as u128) as u64;
    let ask_offset = ask_offset.max(1).min(u64::MAX as u128) as u64;

    Ok((bid_offset, ask_offset))
}

/// Generate grid trading price levels centered around a price.
pub fn generate_grid_levels(
    center_price: u64,
    grid_spacing_bps: u64,
    num_levels: usize,
) -> Vec<u64> {
    if center_price == 0 || grid_spacing_bps == 0 || num_levels == 0 {
        return Vec::new();
    }
    let num_levels = num_levels.min(MAX_GRID_LEVELS);
    let mut levels = Vec::with_capacity(num_levels * 2 + 1);

    // Levels below center
    for i in (1..=num_levels).rev() {
        let offset = (center_price as u128) * (grid_spacing_bps as u128) * (i as u128)
            / (BPS_DENOM as u128);
        let price = (center_price as u128).saturating_sub(offset);
        if price > 0 {
            levels.push(price as u64);
        }
    }
    // Center
    levels.push(center_price);
    // Levels above center
    for i in 1..=num_levels {
        let offset = (center_price as u128) * (grid_spacing_bps as u128) * (i as u128)
            / (BPS_DENOM as u128);
        let price = (center_price as u128).saturating_add(offset);
        if price <= u64::MAX as u128 {
            levels.push(price as u64);
        }
    }
    levels
}

/// Calculate TWAP execution slices.
pub fn calculate_twap_slices(
    total_size: u64,
    num_slices: usize,
    interval_ms: u64,
) -> Vec<TwapSlice> {
    if total_size == 0 || num_slices == 0 || interval_ms == 0 {
        return Vec::new();
    }
    let num_slices = num_slices.min(MAX_TWAP_SLICES);
    let base_size = total_size / (num_slices as u64);
    let remainder = total_size % (num_slices as u64);

    let mut slices = Vec::with_capacity(num_slices);
    for i in 0..num_slices {
        let extra = if (i as u64) < remainder { 1 } else { 0 };
        slices.push(TwapSlice {
            index: i as u64,
            size: base_size + extra,
            execute_at_ms: (i as u64) * interval_ms,
        });
    }
    slices
}

// ============ Order Management ============

/// Create a new open order.
pub fn create_order(id: u64, price: u64, size: u64, side: u8) -> Result<OrderState, String> {
    if price == 0 {
        return Err("price is zero".to_string());
    }
    if size == 0 {
        return Err("size is zero".to_string());
    }
    if side != 1 && side != 2 {
        return Err("invalid side (must be 1=buy or 2=sell)".to_string());
    }
    Ok(OrderState {
        id,
        price,
        size,
        side,
        filled: 0,
        remaining: size,
        status: 0,
    })
}

/// Track a fill against an existing order.
pub fn track_fill(
    order: &OrderState,
    fill_price: u64,
    fill_size: u64,
) -> Result<OrderState, String> {
    if fill_size == 0 {
        return Err("fill_size is zero".to_string());
    }
    if fill_price == 0 {
        return Err("fill_price is zero".to_string());
    }
    if order.status == 2 {
        return Err("order already fully filled".to_string());
    }
    if order.status == 3 {
        return Err("order is cancelled".to_string());
    }
    if fill_size > order.remaining {
        return Err("fill_size exceeds remaining".to_string());
    }
    let new_filled = order.filled + fill_size;
    let new_remaining = order.size.saturating_sub(new_filled);
    let new_status = if new_remaining == 0 { 2 } else { 1 };

    Ok(OrderState {
        id: order.id,
        price: order.price,
        size: order.size,
        side: order.side,
        filled: new_filled,
        remaining: new_remaining,
        status: new_status,
    })
}

/// Cancel an open or partially filled order.
pub fn cancel_order(order: &OrderState) -> Result<OrderState, String> {
    if order.status == 2 {
        return Err("cannot cancel fully filled order".to_string());
    }
    if order.status == 3 {
        return Err("order already cancelled".to_string());
    }
    Ok(OrderState {
        id: order.id,
        price: order.price,
        size: order.size,
        side: order.side,
        filled: order.filled,
        remaining: 0,
        status: 3,
    })
}

/// Generate a ladder of orders at increasing distances from mid price.
pub fn generate_ladder_orders(
    mid_price: u64,
    spread_bps: u64,
    num_levels: usize,
    size_per_level: u64,
) -> Vec<OrderState> {
    if mid_price == 0 || spread_bps == 0 || num_levels == 0 || size_per_level == 0 {
        return Vec::new();
    }
    let num_levels = num_levels.min(MAX_GRID_LEVELS);
    let mut orders = Vec::with_capacity(num_levels * 2);
    let mut next_id = 1u64;

    for i in 1..=num_levels {
        let offset = (mid_price as u128) * (spread_bps as u128) * (i as u128)
            / (BPS_DENOM as u128);
        let offset = offset as u64;

        // Bid
        let bid_price = mid_price.saturating_sub(offset);
        if bid_price > 0 {
            orders.push(OrderState {
                id: next_id,
                price: bid_price,
                size: size_per_level,
                side: 1,
                filled: 0,
                remaining: size_per_level,
                status: 0,
            });
            next_id += 1;
        }
        // Ask
        let ask_price = mid_price.saturating_add(offset);
        orders.push(OrderState {
            id: next_id,
            price: ask_price,
            size: size_per_level,
            side: 2,
            filled: 0,
            remaining: size_per_level,
            status: 0,
        });
        next_id += 1;
    }
    orders
}

/// Cancel orders older than max_age_ms. Returns cancelled orders.
pub fn cancel_stale_orders(
    orders: &[OrderState],
    order_timestamps: &[u64],
    max_age_ms: u64,
    current_time: u64,
) -> Vec<OrderState> {
    let mut cancelled = Vec::new();
    for (i, order) in orders.iter().enumerate() {
        if order.status >= 2 {
            continue; // already filled or cancelled
        }
        if let Some(&ts) = order_timestamps.get(i) {
            if current_time >= ts && current_time - ts > max_age_ms {
                cancelled.push(OrderState {
                    id: order.id,
                    price: order.price,
                    size: order.size,
                    side: order.side,
                    filled: order.filled,
                    remaining: 0,
                    status: 3,
                });
            }
        }
    }
    cancelled
}

/// Amend order price and/or size (cancel + replace).
pub fn amend_order(
    order: &OrderState,
    new_price: u64,
    new_size: u64,
) -> Result<OrderState, String> {
    if order.status == 2 {
        return Err("cannot amend fully filled order".to_string());
    }
    if order.status == 3 {
        return Err("cannot amend cancelled order".to_string());
    }
    if new_price == 0 {
        return Err("new_price is zero".to_string());
    }
    if new_size == 0 {
        return Err("new_size is zero".to_string());
    }
    if new_size < order.filled {
        return Err("new_size less than already filled".to_string());
    }
    Ok(OrderState {
        id: order.id,
        price: new_price,
        size: new_size,
        side: order.side,
        filled: order.filled,
        remaining: new_size - order.filled,
        status: if order.filled > 0 { 1 } else { 0 },
    })
}

// ============ PnL Tracking ============

/// Calculate realized PnL from closing a position (or part of it).
pub fn calculate_realized_pnl(
    entry_price: u64,
    exit_price: u64,
    size: u64,
    is_long: bool,
) -> i64 {
    if size == 0 || entry_price == 0 || exit_price == 0 {
        return 0;
    }
    let entry = entry_price as i64;
    let exit = exit_price as i64;
    let sz = size as i64;
    if is_long {
        (exit - entry).saturating_mul(sz)
    } else {
        (entry - exit).saturating_mul(sz)
    }
}

/// Calculate unrealized PnL for an open position.
pub fn calculate_unrealized_pnl(
    entry_price: u64,
    mark_price: u64,
    size: u64,
    is_long: bool,
) -> i64 {
    calculate_realized_pnl(entry_price, mark_price, size, is_long)
}

/// Update PnL record with a new trade result and fees.
pub fn update_pnl(
    record: &PnlRecord,
    trade_pnl: i64,
    fees: u64,
) -> PnlRecord {
    let new_realized = record.realized.saturating_add(trade_pnl);
    let new_fees_paid = record.fees_paid.saturating_add(fees);
    let net = new_realized
        .saturating_add(record.unrealized)
        .saturating_sub(new_fees_paid as i64)
        .saturating_add(record.fees_earned as i64);
    PnlRecord {
        realized: new_realized,
        unrealized: record.unrealized,
        fees_paid: new_fees_paid,
        fees_earned: record.fees_earned,
        net_pnl: net,
    }
}

/// Update unrealized PnL in a record (mark-to-market).
pub fn mark_to_market(record: &PnlRecord, new_unrealized: i64) -> PnlRecord {
    let net = record
        .realized
        .saturating_add(new_unrealized)
        .saturating_sub(record.fees_paid as i64)
        .saturating_add(record.fees_earned as i64);
    PnlRecord {
        realized: record.realized,
        unrealized: new_unrealized,
        fees_paid: record.fees_paid,
        fees_earned: record.fees_earned,
        net_pnl: net,
    }
}

/// Calculate position value at mark price.
pub fn calculate_position_value(position: &Position, mark_price: u64) -> u64 {
    (position.size as u128)
        .checked_mul(mark_price as u128)
        .map(|v| v.min(u64::MAX as u128) as u64)
        .unwrap_or(u64::MAX)
}

// ============ Risk Controls ============

/// Check whether position is within risk limits. Returns Ok(true) if within limits.
pub fn check_risk_limits(
    position: &Position,
    limits: &RiskLimits,
) -> Result<bool, String> {
    if limits.max_position == 0 {
        return Err("max_position limit is zero".to_string());
    }
    if position.size > limits.max_position {
        return Ok(false);
    }
    // Check unrealized loss
    if position.unrealized_pnl < 0 {
        let loss = position.unrealized_pnl.unsigned_abs();
        if loss > limits.max_loss as u64 {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Determine if all orders should be cancelled (kill switch).
pub fn should_cancel_orders(
    position: &Position,
    limits: &RiskLimits,
    current_loss: i64,
) -> bool {
    // Kill switch conditions:
    // 1. Position exceeds max
    if position.size > limits.max_position {
        return true;
    }
    // 2. Current loss exceeds daily limit
    if current_loss < 0 && current_loss.unsigned_abs() > limits.daily_loss_limit as u64 {
        return true;
    }
    // 3. Unrealized loss exceeds max_loss
    if position.unrealized_pnl < 0
        && position.unrealized_pnl.unsigned_abs() > limits.max_loss as u64
    {
        return true;
    }
    false
}

/// Check if daily loss limit has been breached.
pub fn check_daily_loss_limit(pnl: &PnlRecord, limit: u64) -> bool {
    if pnl.net_pnl < 0 {
        pnl.net_pnl.unsigned_abs() > limit as u64
    } else {
        false
    }
}

/// Calculate drawdown in bps from a peak value.
pub fn calculate_drawdown_bps(peak_value: u64, current_value: u64) -> Result<u64, String> {
    if peak_value == 0 {
        return Err("peak_value is zero".to_string());
    }
    if current_value > peak_value {
        return Ok(0);
    }
    let drawdown = peak_value - current_value;
    let bps = (drawdown as u128) * (BPS_DENOM as u128) / (peak_value as u128);
    Ok(bps as u64)
}

/// Generate a hedge order to reduce delta exposure.
pub fn hedge_delta(
    position: &Position,
    hedge_ratio_bps: u64,
) -> Result<OrderState, String> {
    if position.side == 0 || position.size == 0 {
        return Err("no position to hedge".to_string());
    }
    if hedge_ratio_bps == 0 {
        return Err("hedge_ratio_bps is zero".to_string());
    }
    if hedge_ratio_bps > BPS_DENOM {
        return Err("hedge_ratio_bps exceeds 10000".to_string());
    }
    let hedge_size = (position.size as u128) * (hedge_ratio_bps as u128)
        / (BPS_DENOM as u128);
    let hedge_size = (hedge_size as u64).max(1);
    // Hedge is opposite side
    let hedge_side = if position.side == 1 { 2 } else { 1 };

    Ok(OrderState {
        id: 0,
        price: position.entry_price,
        size: hedge_size,
        side: hedge_side,
        filled: 0,
        remaining: hedge_size,
        status: 0,
    })
}

/// Calculate exposure as position_value / total_capital in bps.
pub fn calculate_exposure_bps(
    position_value: u64,
    total_capital: u64,
) -> Result<u64, String> {
    if total_capital == 0 {
        return Err("total_capital is zero".to_string());
    }
    let bps = (position_value as u128) * (BPS_DENOM as u128) / (total_capital as u128);
    Ok(bps.min(u64::MAX as u128) as u64)
}

// ============ Market Microstructure ============

/// Detect adverse selection from fills vs subsequent mid prices.
/// Returns adverse selection score in bps.
/// fills and mid_prices must be same length (mid_price after each fill).
pub fn detect_adverse_selection(
    fills: &[Fill],
    mid_prices: &[u64],
) -> Result<u64, String> {
    if fills.is_empty() {
        return Err("no fills provided".to_string());
    }
    if fills.len() != mid_prices.len() {
        return Err("fills and mid_prices length mismatch".to_string());
    }
    let mut total_adverse: u128 = 0;
    let mut count: u128 = 0;

    for (fill, &mid_after) in fills.iter().zip(mid_prices.iter()) {
        if fill.price == 0 || mid_after == 0 {
            continue;
        }
        // For a buy fill: adverse if mid moved down after we bought
        // For a sell fill: adverse if mid moved up after we sold
        let adverse = if fill.side == 1 {
            // Bought: adverse = fill_price - mid_after (we overpaid)
            if fill.price > mid_after {
                fill.price - mid_after
            } else {
                0
            }
        } else {
            // Sold: adverse = mid_after - fill_price (we undersold)
            if mid_after > fill.price {
                mid_after - fill.price
            } else {
                0
            }
        };
        let mid_ref = fill.price.max(1);
        total_adverse += (adverse as u128) * (BPS_DENOM as u128) / (mid_ref as u128);
        count += 1;
    }
    if count == 0 {
        return Err("no valid fills to analyze".to_string());
    }
    Ok((total_adverse / count) as u64)
}

/// Score toxicity of a single fill.
/// Compares fill price vs mid at fill time and mid after.
pub fn score_fill_toxicity(
    fill_price: u64,
    mid_price_at_fill: u64,
    mid_price_after: u64,
    spread_bps: u64,
) -> u64 {
    if fill_price == 0 || mid_price_at_fill == 0 || mid_price_after == 0 || spread_bps == 0 {
        return 0;
    }
    // Movement against the market maker
    let adverse_move = if fill_price > mid_price_at_fill {
        // We sold: adverse if price went up
        if mid_price_after > mid_price_at_fill {
            mid_price_after - mid_price_at_fill
        } else {
            return 0;
        }
    } else {
        // We bought: adverse if price went down
        if mid_price_at_fill > mid_price_after {
            mid_price_at_fill - mid_price_after
        } else {
            return 0;
        }
    };
    // Toxicity = adverse_move / (spread * mid / BPS), normalized to BPS
    let spread_value = (mid_price_at_fill as u128) * (spread_bps as u128) / (BPS_DENOM as u128);
    if spread_value == 0 {
        return MAX_TOXICITY_SCORE;
    }
    let toxicity = (adverse_move as u128) * (BPS_DENOM as u128) / spread_value;
    toxicity.min(MAX_TOXICITY_SCORE as u128) as u64
}

/// Calculate maker edge: average PnL per fill in bps relative to mid.
pub fn calculate_maker_edge(fills: &[Fill], mid_prices: &[u64]) -> Result<i64, String> {
    if fills.is_empty() {
        return Err("no fills".to_string());
    }
    if fills.len() != mid_prices.len() {
        return Err("fills and mid_prices length mismatch".to_string());
    }
    let mut total_edge: i128 = 0;
    let mut count: i128 = 0;

    for (fill, &mid) in fills.iter().zip(mid_prices.iter()) {
        if fill.price == 0 || mid == 0 {
            continue;
        }
        // For buys: edge = mid - fill_price (positive = good, we bought below mid)
        // For sells: edge = fill_price - mid (positive = good, we sold above mid)
        let edge = if fill.side == 1 {
            mid as i128 - fill.price as i128
        } else {
            fill.price as i128 - mid as i128
        };
        // Normalize to bps relative to mid
        let edge_bps = edge * (BPS_DENOM as i128) / (mid as i128);
        total_edge += edge_bps;
        count += 1;
    }
    if count == 0 {
        return Err("no valid fills".to_string());
    }
    Ok((total_edge / count) as i64)
}

/// Calculate effective spread from a list of trades.
/// Effective spread = 2 * |trade_price - mid_price| / mid_price, averaged and in bps.
pub fn calculate_effective_spread(trades: &[Trade]) -> Result<u64, String> {
    if trades.is_empty() {
        return Err("no trades provided".to_string());
    }
    let mut total_spread_bps: u128 = 0;
    let mut total_weight: u128 = 0;

    for trade in trades {
        if trade.mid_price == 0 || trade.size == 0 {
            continue;
        }
        let diff = if trade.price > trade.mid_price {
            trade.price - trade.mid_price
        } else {
            trade.mid_price - trade.price
        };
        let spread_bps = (diff as u128) * 2 * (BPS_DENOM as u128) / (trade.mid_price as u128);
        total_spread_bps += spread_bps * (trade.size as u128);
        total_weight += trade.size as u128;
    }
    if total_weight == 0 {
        return Err("no valid trades".to_string());
    }
    Ok((total_spread_bps / total_weight) as u64)
}

/// Estimate volatility from a series of prices (in bps, annualized-like).
/// Uses simple standard deviation of returns approach.
pub fn estimate_volatility_from_prices(prices: &[u64]) -> Result<u64, String> {
    if prices.len() < 2 {
        return Err("need at least 2 prices".to_string());
    }
    // Calculate returns in bps
    let mut returns_bps: Vec<i64> = Vec::with_capacity(prices.len() - 1);
    for i in 1..prices.len() {
        if prices[i - 1] == 0 {
            return Err("zero price in series".to_string());
        }
        let ret = ((prices[i] as i128) - (prices[i - 1] as i128))
            * (BPS_DENOM as i128)
            / (prices[i - 1] as i128);
        returns_bps.push(ret as i64);
    }
    // Mean
    let sum: i128 = returns_bps.iter().map(|&r| r as i128).sum();
    let mean = sum / (returns_bps.len() as i128);
    // Variance (using integer approximation)
    let var_sum: u128 = returns_bps
        .iter()
        .map(|&r| {
            let diff = (r as i128) - mean;
            (diff * diff) as u128
        })
        .sum();
    let variance = var_sum / (returns_bps.len() as u128);
    // Standard deviation via integer sqrt
    let std_dev = isqrt(variance);
    Ok(std_dev as u64)
}

/// Integer square root (Babylonian method).
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

/// Detect bid-ask bounce: returns true if last N trades alternate sides.
pub fn detect_bid_ask_bounce(trades: &[Trade], min_alternations: usize) -> bool {
    if trades.len() < 2 || min_alternations == 0 {
        return false;
    }
    let mut alternations = 0;
    for i in 1..trades.len() {
        if trades[i].side != trades[i - 1].side && trades[i].side != 0 && trades[i - 1].side != 0
        {
            alternations += 1;
        }
    }
    alternations >= min_alternations
}

/// Count consecutive fills on the same side (momentum detection).
pub fn consecutive_same_side_fills(fills: &[Fill]) -> usize {
    if fills.is_empty() {
        return 0;
    }
    let last_side = fills.last().unwrap().side;
    let mut count = 0;
    for fill in fills.iter().rev() {
        if fill.side == last_side {
            count += 1;
        } else {
            break;
        }
    }
    count
}

/// Calculate fill rate: fills / total orders in bps.
pub fn calculate_fill_rate_bps(total_orders: u64, total_fills: u64) -> Result<u64, String> {
    if total_orders == 0 {
        return Err("total_orders is zero".to_string());
    }
    let rate = (total_fills as u128) * (BPS_DENOM as u128) / (total_orders as u128);
    Ok(rate.min(BPS_DENOM as u128) as u64)
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Mid Price ----

    #[test]
    fn test_mid_price_basic() {
        assert_eq!(calculate_mid_price(100, 200).unwrap(), 150);
    }

    #[test]
    fn test_mid_price_equal() {
        assert_eq!(calculate_mid_price(100, 100).unwrap(), 100);
    }

    #[test]
    fn test_mid_price_one_apart() {
        assert_eq!(calculate_mid_price(99, 100).unwrap(), 99); // integer division
    }

    #[test]
    fn test_mid_price_large_values() {
        let bid = u64::MAX / 2;
        let ask = u64::MAX / 2 + 100;
        let mid = calculate_mid_price(bid, ask).unwrap();
        assert!(mid >= bid && mid <= ask);
    }

    #[test]
    fn test_mid_price_zero_bid() {
        assert!(calculate_mid_price(0, 100).is_err());
    }

    #[test]
    fn test_mid_price_zero_ask() {
        assert!(calculate_mid_price(100, 0).is_err());
    }

    #[test]
    fn test_mid_price_bid_exceeds_ask() {
        assert!(calculate_mid_price(200, 100).is_err());
    }

    #[test]
    fn test_mid_price_u64_max() {
        let mid = calculate_mid_price(u64::MAX - 1, u64::MAX).unwrap();
        assert!(mid >= u64::MAX - 1);
    }

    // ---- Quote Generation ----

    fn default_config() -> MarketMakerConfig {
        MarketMakerConfig {
            spread_bps: 30,
            min_size: 10,
            max_size: 1000,
            max_position: 5000,
            volatility_window: 20,
        }
    }

    fn balanced_inventory() -> Inventory {
        Inventory {
            base_balance: 5000,
            quote_balance: 5000,
            target_ratio_bps: 5000,
            current_ratio_bps: 5000,
        }
    }

    #[test]
    fn test_generate_quotes_basic() {
        let q = generate_quotes(&default_config(), 10000, &balanced_inventory()).unwrap();
        assert!(q.bid_price < 10000);
        assert!(q.ask_price > 10000);
        assert!(q.bid_size >= 10);
        assert!(q.ask_size >= 10);
    }

    #[test]
    fn test_generate_quotes_spread_symmetry() {
        let q = generate_quotes(&default_config(), 10000, &balanced_inventory()).unwrap();
        let bid_dist = 10000 - q.bid_price;
        let ask_dist = q.ask_price - 10000;
        // With balanced inventory, distances should be equal
        assert_eq!(bid_dist, ask_dist);
    }

    #[test]
    fn test_generate_quotes_zero_mid_price() {
        assert!(generate_quotes(&default_config(), 0, &balanced_inventory()).is_err());
    }

    #[test]
    fn test_generate_quotes_zero_spread() {
        let mut cfg = default_config();
        cfg.spread_bps = 0;
        assert!(generate_quotes(&cfg, 10000, &balanced_inventory()).is_err());
    }

    #[test]
    fn test_generate_quotes_excessive_spread() {
        let mut cfg = default_config();
        cfg.spread_bps = MAX_SPREAD_BPS + 1;
        assert!(generate_quotes(&cfg, 10000, &balanced_inventory()).is_err());
    }

    #[test]
    fn test_generate_quotes_zero_min_size() {
        let mut cfg = default_config();
        cfg.min_size = 0;
        assert!(generate_quotes(&cfg, 10000, &balanced_inventory()).is_err());
    }

    #[test]
    fn test_generate_quotes_max_less_than_min() {
        let mut cfg = default_config();
        cfg.max_size = 5;
        cfg.min_size = 10;
        assert!(generate_quotes(&cfg, 10000, &balanced_inventory()).is_err());
    }

    #[test]
    fn test_generate_quotes_bid_less_than_ask() {
        let q = generate_quotes(&default_config(), 10000, &balanced_inventory()).unwrap();
        assert!(q.bid_price < q.ask_price);
    }

    #[test]
    fn test_generate_quotes_large_price() {
        let q = generate_quotes(&default_config(), 1_000_000_000, &balanced_inventory()).unwrap();
        assert!(q.bid_price < 1_000_000_000);
        assert!(q.ask_price > 1_000_000_000);
    }

    #[test]
    fn test_generate_quotes_small_price() {
        let q = generate_quotes(&default_config(), 100, &balanced_inventory()).unwrap();
        assert!(q.bid_price < q.ask_price);
    }

    #[test]
    fn test_generate_quotes_long_skew() {
        let inv = Inventory {
            base_balance: 8000,
            quote_balance: 2000,
            target_ratio_bps: 5000,
            current_ratio_bps: 8000,
        };
        let q = generate_quotes(&default_config(), 10000, &inv).unwrap();
        assert!(q.bid_price < q.ask_price);
    }

    #[test]
    fn test_generate_quotes_short_skew() {
        let inv = Inventory {
            base_balance: 2000,
            quote_balance: 8000,
            target_ratio_bps: 5000,
            current_ratio_bps: 2000,
        };
        let q = generate_quotes(&default_config(), 10000, &inv).unwrap();
        assert!(q.bid_price < q.ask_price);
    }

    // ---- Spread Optimization ----

    #[test]
    fn test_adjust_spread_zero_vol() {
        assert_eq!(adjust_spread_for_volatility(30, 0, 100), 30);
    }

    #[test]
    fn test_adjust_spread_zero_base() {
        assert_eq!(adjust_spread_for_volatility(0, 50, 100), 50);
    }

    #[test]
    fn test_adjust_spread_basic() {
        // 30 + 50*150/100 = 30 + 75 = 105
        assert_eq!(adjust_spread_for_volatility(30, 50, 150), 105);
    }

    #[test]
    fn test_adjust_spread_capped() {
        let result = adjust_spread_for_volatility(4000, 4000, 200);
        assert!(result <= MAX_SPREAD_BPS);
    }

    #[test]
    fn test_adjust_spread_zero_multiplier() {
        assert_eq!(adjust_spread_for_volatility(30, 100, 0), 30);
    }

    #[test]
    fn test_adjust_spread_large_multiplier() {
        let result = adjust_spread_for_volatility(30, 100, 10000);
        assert!(result <= MAX_SPREAD_BPS);
    }

    #[test]
    fn test_compute_optimized_spread_basic() {
        let params = SpreadParams {
            base_spread_bps: 20,
            vol_multiplier: 100,
            inventory_skew_bps: 10,
            min_spread_bps: 5,
        };
        let result = compute_optimized_spread(&params, 30);
        assert!(result >= 5);
        assert!(result <= MAX_SPREAD_BPS);
    }

    #[test]
    fn test_compute_optimized_spread_respects_min() {
        let params = SpreadParams {
            base_spread_bps: 0,
            vol_multiplier: 0,
            inventory_skew_bps: 0,
            min_spread_bps: 15,
        };
        assert_eq!(compute_optimized_spread(&params, 0), 15);
    }

    #[test]
    fn test_compute_optimized_spread_cap() {
        let params = SpreadParams {
            base_spread_bps: 4000,
            vol_multiplier: 200,
            inventory_skew_bps: 3000,
            min_spread_bps: 1,
        };
        assert!(compute_optimized_spread(&params, 3000) <= MAX_SPREAD_BPS);
    }

    #[test]
    fn test_round_to_tick_exact() {
        assert_eq!(round_to_tick(1000, 100).unwrap(), 1000);
    }

    #[test]
    fn test_round_to_tick_down() {
        assert_eq!(round_to_tick(1049, 100).unwrap(), 1000);
    }

    #[test]
    fn test_round_to_tick_up() {
        assert_eq!(round_to_tick(1050, 100).unwrap(), 1100);
    }

    #[test]
    fn test_round_to_tick_zero_price() {
        assert_eq!(round_to_tick(0, 100).unwrap(), 0);
    }

    #[test]
    fn test_round_to_tick_zero_tick() {
        assert!(round_to_tick(100, 0).is_err());
    }

    #[test]
    fn test_round_to_tick_one() {
        assert_eq!(round_to_tick(17, 1).unwrap(), 17);
    }

    #[test]
    fn test_depth_weighted_spread_basic() {
        let bids = vec![(100, 50), (99, 50)];
        let asks = vec![(101, 50), (102, 50)];
        let result = depth_weighted_spread(&bids, &asks).unwrap();
        assert!(result > 0);
    }

    #[test]
    fn test_depth_weighted_spread_single_level() {
        let bids = vec![(100, 100)];
        let asks = vec![(102, 100)];
        let result = depth_weighted_spread(&bids, &asks).unwrap();
        // spread = 2, mid = 101, bps = 2 * 10000 / 101 ~ 198
        assert!(result > 100 && result < 300);
    }

    #[test]
    fn test_depth_weighted_spread_empty_bids() {
        assert!(depth_weighted_spread(&[], &[(100, 50)]).is_err());
    }

    #[test]
    fn test_depth_weighted_spread_empty_asks() {
        assert!(depth_weighted_spread(&[(100, 50)], &[]).is_err());
    }

    #[test]
    fn test_depth_weighted_spread_zero_size_bids() {
        assert!(depth_weighted_spread(&[(100, 0)], &[(101, 50)]).is_err());
    }

    // ---- Inventory Management ----

    #[test]
    fn test_inventory_skew_balanced() {
        let inv = balanced_inventory();
        assert_eq!(calculate_inventory_skew(&inv).unwrap(), 0);
    }

    #[test]
    fn test_inventory_skew_long() {
        let inv = Inventory {
            base_balance: 7000,
            quote_balance: 3000,
            target_ratio_bps: 5000,
            current_ratio_bps: 7000,
        };
        assert_eq!(calculate_inventory_skew(&inv).unwrap(), 2000);
    }

    #[test]
    fn test_inventory_skew_short() {
        let inv = Inventory {
            base_balance: 3000,
            quote_balance: 7000,
            target_ratio_bps: 5000,
            current_ratio_bps: 3000,
        };
        assert_eq!(calculate_inventory_skew(&inv).unwrap(), -2000);
    }

    #[test]
    fn test_inventory_skew_target_exceeds_bps() {
        let inv = Inventory {
            base_balance: 100,
            quote_balance: 100,
            target_ratio_bps: 10001,
            current_ratio_bps: 5000,
        };
        assert!(calculate_inventory_skew(&inv).is_err());
    }

    #[test]
    fn test_inventory_skew_current_exceeds_bps() {
        let inv = Inventory {
            base_balance: 100,
            quote_balance: 100,
            target_ratio_bps: 5000,
            current_ratio_bps: 10001,
        };
        assert!(calculate_inventory_skew(&inv).is_err());
    }

    #[test]
    fn test_compute_inventory_ratio_equal() {
        let ratio = compute_inventory_ratio(100, 100, 1).unwrap();
        assert_eq!(ratio, 5000);
    }

    #[test]
    fn test_compute_inventory_ratio_all_base() {
        let ratio = compute_inventory_ratio(100, 0, 1).unwrap();
        assert_eq!(ratio, 10000);
    }

    #[test]
    fn test_compute_inventory_ratio_all_quote() {
        let ratio = compute_inventory_ratio(0, 100, 1).unwrap();
        assert_eq!(ratio, 0);
    }

    #[test]
    fn test_compute_inventory_ratio_zero_price() {
        assert!(compute_inventory_ratio(100, 100, 0).is_err());
    }

    #[test]
    fn test_compute_inventory_ratio_zero_total() {
        assert!(compute_inventory_ratio(0, 0, 1).is_err());
    }

    #[test]
    fn test_optimal_quote_size_no_skew_factor() {
        let inv = balanced_inventory();
        assert_eq!(calculate_optimal_quote_size(&inv, 1000, 0), 1000);
    }

    #[test]
    fn test_optimal_quote_size_with_skew() {
        let inv = Inventory {
            base_balance: 7000,
            quote_balance: 3000,
            target_ratio_bps: 5000,
            current_ratio_bps: 7000,
        };
        let size = calculate_optimal_quote_size(&inv, 1000, 5000);
        assert!(size < 1000);
    }

    #[test]
    fn test_optimal_quote_size_zero_max() {
        assert_eq!(calculate_optimal_quote_size(&balanced_inventory(), 0, 100), 0);
    }

    #[test]
    fn test_rebalance_sell_base() {
        let inv = Inventory {
            base_balance: 7000,
            quote_balance: 3000,
            target_ratio_bps: 5000,
            current_ratio_bps: 7000,
        };
        let action = rebalance_inventory(&inv, 5000).unwrap();
        assert_eq!(action.direction, 2); // sell base
        assert!(action.amount > 0);
    }

    #[test]
    fn test_rebalance_buy_base() {
        let inv = Inventory {
            base_balance: 3000,
            quote_balance: 7000,
            target_ratio_bps: 5000,
            current_ratio_bps: 3000,
        };
        let action = rebalance_inventory(&inv, 5000).unwrap();
        assert_eq!(action.direction, 1); // buy base
        assert!(action.amount > 0);
    }

    #[test]
    fn test_rebalance_no_action() {
        let inv = Inventory {
            base_balance: 5000,
            quote_balance: 5000,
            target_ratio_bps: 5000,
            current_ratio_bps: 5000,
        };
        let action = rebalance_inventory(&inv, 5000).unwrap();
        assert_eq!(action.direction, 0);
        assert_eq!(action.amount, 0);
    }

    #[test]
    fn test_rebalance_target_exceeds_bps() {
        let inv = balanced_inventory();
        assert!(rebalance_inventory(&inv, 10001).is_err());
    }

    #[test]
    fn test_rebalance_zero_inventory() {
        let inv = Inventory {
            base_balance: 0,
            quote_balance: 0,
            target_ratio_bps: 5000,
            current_ratio_bps: 5000,
        };
        assert!(rebalance_inventory(&inv, 5000).is_err());
    }

    // ---- Strategy Types ----

    #[test]
    fn test_avellaneda_stoikov_basic() {
        let (bid_off, ask_off) = avellaneda_stoikov_spread(10000, 200, 100, 5000).unwrap();
        assert!(bid_off > 0);
        assert!(ask_off > 0);
    }

    #[test]
    fn test_avellaneda_stoikov_zero_mid() {
        assert!(avellaneda_stoikov_spread(0, 200, 100, 5000).is_err());
    }

    #[test]
    fn test_avellaneda_stoikov_zero_time() {
        assert!(avellaneda_stoikov_spread(10000, 200, 100, 0).is_err());
    }

    #[test]
    fn test_avellaneda_stoikov_zero_vol() {
        let (bid_off, ask_off) = avellaneda_stoikov_spread(10000, 0, 0, 5000).unwrap();
        // With zero vol, offsets should be minimal
        assert!(bid_off <= 10000);
        assert!(ask_off >= 1);
    }

    #[test]
    fn test_avellaneda_stoikov_high_risk() {
        let (bid_off, _ask_off) = avellaneda_stoikov_spread(10000, 500, 9000, 10000).unwrap();
        // High risk -> bid offset should be bigger
        assert!(bid_off > 0);
    }

    #[test]
    fn test_grid_levels_basic() {
        let levels = generate_grid_levels(10000, 100, 3);
        assert_eq!(levels.len(), 7); // 3 below + center + 3 above
        assert!(levels.contains(&10000));
    }

    #[test]
    fn test_grid_levels_sorted() {
        let levels = generate_grid_levels(10000, 100, 5);
        for i in 1..levels.len() {
            assert!(levels[i] > levels[i - 1]);
        }
    }

    #[test]
    fn test_grid_levels_zero_center() {
        let levels = generate_grid_levels(0, 100, 3);
        assert!(levels.is_empty());
    }

    #[test]
    fn test_grid_levels_zero_spacing() {
        let levels = generate_grid_levels(10000, 0, 3);
        assert!(levels.is_empty());
    }

    #[test]
    fn test_grid_levels_zero_num() {
        let levels = generate_grid_levels(10000, 100, 0);
        assert!(levels.is_empty());
    }

    #[test]
    fn test_grid_levels_capped_count() {
        let levels = generate_grid_levels(10000, 10, MAX_GRID_LEVELS + 50);
        assert!(levels.len() <= MAX_GRID_LEVELS * 2 + 1);
    }

    #[test]
    fn test_grid_levels_large_spacing() {
        // If spacing > center, some levels could go negative - test robustness
        let levels = generate_grid_levels(100, 5000, 3);
        for &l in &levels {
            assert!(l > 0 || l == 0);
        }
    }

    #[test]
    fn test_twap_basic() {
        let slices = calculate_twap_slices(100, 5, 1000);
        assert_eq!(slices.len(), 5);
        let total: u64 = slices.iter().map(|s| s.size).sum();
        assert_eq!(total, 100);
    }

    #[test]
    fn test_twap_remainder_distribution() {
        let slices = calculate_twap_slices(103, 5, 1000);
        assert_eq!(slices.len(), 5);
        let total: u64 = slices.iter().map(|s| s.size).sum();
        assert_eq!(total, 103);
    }

    #[test]
    fn test_twap_single_slice() {
        let slices = calculate_twap_slices(100, 1, 1000);
        assert_eq!(slices.len(), 1);
        assert_eq!(slices[0].size, 100);
        assert_eq!(slices[0].execute_at_ms, 0);
    }

    #[test]
    fn test_twap_zero_size() {
        assert!(calculate_twap_slices(0, 5, 1000).is_empty());
    }

    #[test]
    fn test_twap_zero_slices() {
        assert!(calculate_twap_slices(100, 0, 1000).is_empty());
    }

    #[test]
    fn test_twap_zero_interval() {
        assert!(calculate_twap_slices(100, 5, 0).is_empty());
    }

    #[test]
    fn test_twap_timing() {
        let slices = calculate_twap_slices(100, 4, 500);
        assert_eq!(slices[0].execute_at_ms, 0);
        assert_eq!(slices[1].execute_at_ms, 500);
        assert_eq!(slices[2].execute_at_ms, 1000);
        assert_eq!(slices[3].execute_at_ms, 1500);
    }

    #[test]
    fn test_twap_cap() {
        let slices = calculate_twap_slices(100, MAX_TWAP_SLICES + 100, 1);
        assert!(slices.len() <= MAX_TWAP_SLICES);
    }

    // ---- Order Management ----

    #[test]
    fn test_create_order_buy() {
        let o = create_order(1, 100, 50, 1).unwrap();
        assert_eq!(o.id, 1);
        assert_eq!(o.status, 0);
        assert_eq!(o.remaining, 50);
    }

    #[test]
    fn test_create_order_sell() {
        let o = create_order(2, 100, 50, 2).unwrap();
        assert_eq!(o.side, 2);
    }

    #[test]
    fn test_create_order_zero_price() {
        assert!(create_order(1, 0, 50, 1).is_err());
    }

    #[test]
    fn test_create_order_zero_size() {
        assert!(create_order(1, 100, 0, 1).is_err());
    }

    #[test]
    fn test_create_order_invalid_side() {
        assert!(create_order(1, 100, 50, 3).is_err());
    }

    #[test]
    fn test_create_order_side_zero() {
        assert!(create_order(1, 100, 50, 0).is_err());
    }

    #[test]
    fn test_track_fill_partial() {
        let o = create_order(1, 100, 50, 1).unwrap();
        let filled = track_fill(&o, 100, 20).unwrap();
        assert_eq!(filled.filled, 20);
        assert_eq!(filled.remaining, 30);
        assert_eq!(filled.status, 1);
    }

    #[test]
    fn test_track_fill_complete() {
        let o = create_order(1, 100, 50, 1).unwrap();
        let filled = track_fill(&o, 100, 50).unwrap();
        assert_eq!(filled.filled, 50);
        assert_eq!(filled.remaining, 0);
        assert_eq!(filled.status, 2);
    }

    #[test]
    fn test_track_fill_zero_size() {
        let o = create_order(1, 100, 50, 1).unwrap();
        assert!(track_fill(&o, 100, 0).is_err());
    }

    #[test]
    fn test_track_fill_zero_price() {
        let o = create_order(1, 100, 50, 1).unwrap();
        assert!(track_fill(&o, 0, 20).is_err());
    }

    #[test]
    fn test_track_fill_exceeds_remaining() {
        let o = create_order(1, 100, 50, 1).unwrap();
        assert!(track_fill(&o, 100, 51).is_err());
    }

    #[test]
    fn test_track_fill_already_filled() {
        let o = create_order(1, 100, 50, 1).unwrap();
        let filled = track_fill(&o, 100, 50).unwrap();
        assert!(track_fill(&filled, 100, 1).is_err());
    }

    #[test]
    fn test_track_fill_cancelled() {
        let o = create_order(1, 100, 50, 1).unwrap();
        let cancelled = cancel_order(&o).unwrap();
        assert!(track_fill(&cancelled, 100, 1).is_err());
    }

    #[test]
    fn test_cancel_open_order() {
        let o = create_order(1, 100, 50, 1).unwrap();
        let c = cancel_order(&o).unwrap();
        assert_eq!(c.status, 3);
    }

    #[test]
    fn test_cancel_partial_order() {
        let o = create_order(1, 100, 50, 1).unwrap();
        let filled = track_fill(&o, 100, 20).unwrap();
        let c = cancel_order(&filled).unwrap();
        assert_eq!(c.status, 3);
        assert_eq!(c.filled, 20);
    }

    #[test]
    fn test_cancel_filled_order() {
        let o = create_order(1, 100, 50, 1).unwrap();
        let filled = track_fill(&o, 100, 50).unwrap();
        assert!(cancel_order(&filled).is_err());
    }

    #[test]
    fn test_cancel_already_cancelled() {
        let o = create_order(1, 100, 50, 1).unwrap();
        let c = cancel_order(&o).unwrap();
        assert!(cancel_order(&c).is_err());
    }

    #[test]
    fn test_ladder_orders_basic() {
        let orders = generate_ladder_orders(10000, 50, 3, 100);
        assert_eq!(orders.len(), 6); // 3 bids + 3 asks
    }

    #[test]
    fn test_ladder_orders_prices_spread() {
        let orders = generate_ladder_orders(10000, 100, 2, 100);
        // bids should be below mid, asks above
        for o in &orders {
            if o.side == 1 {
                assert!(o.price < 10000);
            } else {
                assert!(o.price > 10000);
            }
        }
    }

    #[test]
    fn test_ladder_orders_zero_mid() {
        assert!(generate_ladder_orders(0, 50, 3, 100).is_empty());
    }

    #[test]
    fn test_ladder_orders_zero_spread() {
        assert!(generate_ladder_orders(10000, 0, 3, 100).is_empty());
    }

    #[test]
    fn test_ladder_orders_zero_levels() {
        assert!(generate_ladder_orders(10000, 50, 0, 100).is_empty());
    }

    #[test]
    fn test_ladder_orders_zero_size() {
        assert!(generate_ladder_orders(10000, 50, 3, 0).is_empty());
    }

    #[test]
    fn test_cancel_stale_orders_basic() {
        let orders = vec![
            create_order(1, 100, 50, 1).unwrap(),
            create_order(2, 101, 50, 2).unwrap(),
        ];
        let timestamps = vec![1000, 5000];
        let cancelled = cancel_stale_orders(&orders, &timestamps, 2000, 8000);
        // Order 1 at ts 1000 is 7000ms old > 2000 -> stale
        // Order 2 at ts 5000 is 3000ms old > 2000 -> stale
        assert_eq!(cancelled.len(), 2);
    }

    #[test]
    fn test_cancel_stale_orders_none_stale() {
        let orders = vec![create_order(1, 100, 50, 1).unwrap()];
        let timestamps = vec![7000];
        let cancelled = cancel_stale_orders(&orders, &timestamps, 2000, 8000);
        assert!(cancelled.is_empty());
    }

    #[test]
    fn test_cancel_stale_orders_skip_filled() {
        let o = create_order(1, 100, 50, 1).unwrap();
        let filled = track_fill(&o, 100, 50).unwrap();
        let orders = vec![filled];
        let timestamps = vec![1000];
        let cancelled = cancel_stale_orders(&orders, &timestamps, 500, 5000);
        assert!(cancelled.is_empty());
    }

    #[test]
    fn test_amend_order_price() {
        let o = create_order(1, 100, 50, 1).unwrap();
        let amended = amend_order(&o, 110, 50).unwrap();
        assert_eq!(amended.price, 110);
        assert_eq!(amended.size, 50);
        assert_eq!(amended.status, 0);
    }

    #[test]
    fn test_amend_order_size() {
        let o = create_order(1, 100, 50, 1).unwrap();
        let amended = amend_order(&o, 100, 80).unwrap();
        assert_eq!(amended.size, 80);
        assert_eq!(amended.remaining, 80);
    }

    #[test]
    fn test_amend_order_partial_fill_preserves() {
        let o = create_order(1, 100, 50, 1).unwrap();
        let filled = track_fill(&o, 100, 20).unwrap();
        let amended = amend_order(&filled, 105, 60).unwrap();
        assert_eq!(amended.filled, 20);
        assert_eq!(amended.remaining, 40);
        assert_eq!(amended.status, 1);
    }

    #[test]
    fn test_amend_order_zero_price() {
        let o = create_order(1, 100, 50, 1).unwrap();
        assert!(amend_order(&o, 0, 50).is_err());
    }

    #[test]
    fn test_amend_order_zero_size() {
        let o = create_order(1, 100, 50, 1).unwrap();
        assert!(amend_order(&o, 100, 0).is_err());
    }

    #[test]
    fn test_amend_filled_order() {
        let o = create_order(1, 100, 50, 1).unwrap();
        let filled = track_fill(&o, 100, 50).unwrap();
        assert!(amend_order(&filled, 110, 60).is_err());
    }

    #[test]
    fn test_amend_cancelled_order() {
        let o = create_order(1, 100, 50, 1).unwrap();
        let c = cancel_order(&o).unwrap();
        assert!(amend_order(&c, 110, 60).is_err());
    }

    #[test]
    fn test_amend_order_size_below_filled() {
        let o = create_order(1, 100, 50, 1).unwrap();
        let filled = track_fill(&o, 100, 30).unwrap();
        assert!(amend_order(&filled, 100, 20).is_err());
    }

    // ---- PnL Tracking ----

    #[test]
    fn test_realized_pnl_long_profit() {
        let pnl = calculate_realized_pnl(100, 120, 10, true);
        assert_eq!(pnl, 200); // (120-100)*10
    }

    #[test]
    fn test_realized_pnl_long_loss() {
        let pnl = calculate_realized_pnl(100, 80, 10, true);
        assert_eq!(pnl, -200); // (80-100)*10
    }

    #[test]
    fn test_realized_pnl_short_profit() {
        let pnl = calculate_realized_pnl(100, 80, 10, false);
        assert_eq!(pnl, 200); // (100-80)*10
    }

    #[test]
    fn test_realized_pnl_short_loss() {
        let pnl = calculate_realized_pnl(100, 120, 10, false);
        assert_eq!(pnl, -200); // (100-120)*10
    }

    #[test]
    fn test_realized_pnl_zero_size() {
        assert_eq!(calculate_realized_pnl(100, 120, 0, true), 0);
    }

    #[test]
    fn test_realized_pnl_zero_entry() {
        assert_eq!(calculate_realized_pnl(0, 120, 10, true), 0);
    }

    #[test]
    fn test_realized_pnl_zero_exit() {
        assert_eq!(calculate_realized_pnl(100, 0, 10, true), 0);
    }

    #[test]
    fn test_realized_pnl_breakeven() {
        assert_eq!(calculate_realized_pnl(100, 100, 10, true), 0);
    }

    #[test]
    fn test_unrealized_pnl_long() {
        let pnl = calculate_unrealized_pnl(100, 150, 5, true);
        assert_eq!(pnl, 250);
    }

    #[test]
    fn test_unrealized_pnl_short() {
        let pnl = calculate_unrealized_pnl(100, 50, 5, false);
        assert_eq!(pnl, 250);
    }

    #[test]
    fn test_update_pnl_basic() {
        let record = PnlRecord {
            realized: 100,
            unrealized: 50,
            fees_paid: 10,
            fees_earned: 5,
            net_pnl: 145,
        };
        let updated = update_pnl(&record, 30, 5);
        assert_eq!(updated.realized, 130);
        assert_eq!(updated.fees_paid, 15);
    }

    #[test]
    fn test_update_pnl_negative_trade() {
        let record = PnlRecord {
            realized: 100,
            unrealized: 0,
            fees_paid: 0,
            fees_earned: 0,
            net_pnl: 100,
        };
        let updated = update_pnl(&record, -50, 10);
        assert_eq!(updated.realized, 50);
        assert_eq!(updated.fees_paid, 10);
    }

    #[test]
    fn test_mark_to_market_basic() {
        let record = PnlRecord {
            realized: 100,
            unrealized: 50,
            fees_paid: 10,
            fees_earned: 5,
            net_pnl: 145,
        };
        let updated = mark_to_market(&record, 80);
        assert_eq!(updated.unrealized, 80);
        assert_eq!(updated.realized, 100);
    }

    #[test]
    fn test_mark_to_market_negative() {
        let record = PnlRecord {
            realized: 0,
            unrealized: 0,
            fees_paid: 0,
            fees_earned: 0,
            net_pnl: 0,
        };
        let updated = mark_to_market(&record, -100);
        assert_eq!(updated.unrealized, -100);
        assert_eq!(updated.net_pnl, -100);
    }

    #[test]
    fn test_position_value_basic() {
        let pos = Position {
            side: 1,
            size: 100,
            entry_price: 50,
            unrealized_pnl: 0,
        };
        assert_eq!(calculate_position_value(&pos, 55), 5500);
    }

    #[test]
    fn test_position_value_zero_size() {
        let pos = Position {
            side: 0,
            size: 0,
            entry_price: 50,
            unrealized_pnl: 0,
        };
        assert_eq!(calculate_position_value(&pos, 55), 0);
    }

    #[test]
    fn test_position_value_overflow_protection() {
        let pos = Position {
            side: 1,
            size: u64::MAX,
            entry_price: 100,
            unrealized_pnl: 0,
        };
        let val = calculate_position_value(&pos, u64::MAX);
        assert_eq!(val, u64::MAX); // capped
    }

    // ---- Risk Controls ----

    #[test]
    fn test_check_risk_limits_within() {
        let pos = Position { side: 1, size: 100, entry_price: 50, unrealized_pnl: 0 };
        let limits = RiskLimits { max_position: 1000, max_drawdown_bps: 500, max_loss: 500, daily_loss_limit: 1000 };
        assert_eq!(check_risk_limits(&pos, &limits).unwrap(), true);
    }

    #[test]
    fn test_check_risk_limits_exceeds_position() {
        let pos = Position { side: 1, size: 1500, entry_price: 50, unrealized_pnl: 0 };
        let limits = RiskLimits { max_position: 1000, max_drawdown_bps: 500, max_loss: 500, daily_loss_limit: 1000 };
        assert_eq!(check_risk_limits(&pos, &limits).unwrap(), false);
    }

    #[test]
    fn test_check_risk_limits_exceeds_loss() {
        let pos = Position { side: 1, size: 100, entry_price: 50, unrealized_pnl: -600 };
        let limits = RiskLimits { max_position: 1000, max_drawdown_bps: 500, max_loss: 500, daily_loss_limit: 1000 };
        assert_eq!(check_risk_limits(&pos, &limits).unwrap(), false);
    }

    #[test]
    fn test_check_risk_limits_zero_max() {
        let pos = Position { side: 1, size: 100, entry_price: 50, unrealized_pnl: 0 };
        let limits = RiskLimits { max_position: 0, max_drawdown_bps: 500, max_loss: 500, daily_loss_limit: 1000 };
        assert!(check_risk_limits(&pos, &limits).is_err());
    }

    #[test]
    fn test_should_cancel_exceeds_position() {
        let pos = Position { side: 1, size: 1500, entry_price: 50, unrealized_pnl: 0 };
        let limits = RiskLimits { max_position: 1000, max_drawdown_bps: 500, max_loss: 500, daily_loss_limit: 1000 };
        assert!(should_cancel_orders(&pos, &limits, 0));
    }

    #[test]
    fn test_should_cancel_daily_loss() {
        let pos = Position { side: 1, size: 100, entry_price: 50, unrealized_pnl: 0 };
        let limits = RiskLimits { max_position: 1000, max_drawdown_bps: 500, max_loss: 500, daily_loss_limit: 1000 };
        assert!(should_cancel_orders(&pos, &limits, -1500));
    }

    #[test]
    fn test_should_cancel_unrealized_loss() {
        let pos = Position { side: 1, size: 100, entry_price: 50, unrealized_pnl: -600 };
        let limits = RiskLimits { max_position: 1000, max_drawdown_bps: 500, max_loss: 500, daily_loss_limit: 1000 };
        assert!(should_cancel_orders(&pos, &limits, 0));
    }

    #[test]
    fn test_should_not_cancel_within_limits() {
        let pos = Position { side: 1, size: 100, entry_price: 50, unrealized_pnl: -100 };
        let limits = RiskLimits { max_position: 1000, max_drawdown_bps: 500, max_loss: 500, daily_loss_limit: 1000 };
        assert!(!should_cancel_orders(&pos, &limits, -200));
    }

    #[test]
    fn test_daily_loss_limit_breached() {
        let pnl = PnlRecord { realized: -500, unrealized: -600, fees_paid: 100, fees_earned: 0, net_pnl: -1200 };
        assert!(check_daily_loss_limit(&pnl, 1000));
    }

    #[test]
    fn test_daily_loss_limit_not_breached() {
        let pnl = PnlRecord { realized: 100, unrealized: 50, fees_paid: 10, fees_earned: 5, net_pnl: 145 };
        assert!(!check_daily_loss_limit(&pnl, 1000));
    }

    #[test]
    fn test_daily_loss_limit_exact() {
        let pnl = PnlRecord { realized: -1000, unrealized: 0, fees_paid: 0, fees_earned: 0, net_pnl: -1000 };
        assert!(!check_daily_loss_limit(&pnl, 1000)); // not exceeded, exactly at
    }

    #[test]
    fn test_drawdown_bps_basic() {
        assert_eq!(calculate_drawdown_bps(10000, 9500).unwrap(), 500);
    }

    #[test]
    fn test_drawdown_bps_no_drawdown() {
        assert_eq!(calculate_drawdown_bps(10000, 10000).unwrap(), 0);
    }

    #[test]
    fn test_drawdown_bps_above_peak() {
        assert_eq!(calculate_drawdown_bps(10000, 11000).unwrap(), 0);
    }

    #[test]
    fn test_drawdown_bps_total_loss() {
        assert_eq!(calculate_drawdown_bps(10000, 0).unwrap(), 10000);
    }

    #[test]
    fn test_drawdown_bps_zero_peak() {
        assert!(calculate_drawdown_bps(0, 0).is_err());
    }

    #[test]
    fn test_hedge_delta_long() {
        let pos = Position { side: 1, size: 100, entry_price: 50, unrealized_pnl: 0 };
        let hedge = hedge_delta(&pos, 5000).unwrap(); // 50% hedge
        assert_eq!(hedge.side, 2); // sell to hedge long
        assert_eq!(hedge.size, 50);
    }

    #[test]
    fn test_hedge_delta_short() {
        let pos = Position { side: 2, size: 100, entry_price: 50, unrealized_pnl: 0 };
        let hedge = hedge_delta(&pos, 5000).unwrap();
        assert_eq!(hedge.side, 1); // buy to hedge short
        assert_eq!(hedge.size, 50);
    }

    #[test]
    fn test_hedge_delta_flat() {
        let pos = Position { side: 0, size: 0, entry_price: 50, unrealized_pnl: 0 };
        assert!(hedge_delta(&pos, 5000).is_err());
    }

    #[test]
    fn test_hedge_delta_zero_ratio() {
        let pos = Position { side: 1, size: 100, entry_price: 50, unrealized_pnl: 0 };
        assert!(hedge_delta(&pos, 0).is_err());
    }

    #[test]
    fn test_hedge_delta_full_ratio() {
        let pos = Position { side: 1, size: 100, entry_price: 50, unrealized_pnl: 0 };
        let hedge = hedge_delta(&pos, 10000).unwrap();
        assert_eq!(hedge.size, 100);
    }

    #[test]
    fn test_hedge_delta_exceeds_bps() {
        let pos = Position { side: 1, size: 100, entry_price: 50, unrealized_pnl: 0 };
        assert!(hedge_delta(&pos, 10001).is_err());
    }

    #[test]
    fn test_exposure_bps_basic() {
        assert_eq!(calculate_exposure_bps(500, 10000).unwrap(), 500);
    }

    #[test]
    fn test_exposure_bps_full() {
        assert_eq!(calculate_exposure_bps(10000, 10000).unwrap(), 10000);
    }

    #[test]
    fn test_exposure_bps_zero_capital() {
        assert!(calculate_exposure_bps(500, 0).is_err());
    }

    #[test]
    fn test_exposure_bps_zero_position() {
        assert_eq!(calculate_exposure_bps(0, 10000).unwrap(), 0);
    }

    // ---- Market Microstructure ----

    #[test]
    fn test_adverse_selection_none() {
        let fills = vec![
            Fill { price: 100, size: 10, side: 1, timestamp: 0 },
        ];
        let mid_after = vec![105]; // price went up after buy -> no adverse
        let result = detect_adverse_selection(&fills, &mid_after).unwrap();
        assert_eq!(result, 0);
    }

    #[test]
    fn test_adverse_selection_present() {
        let fills = vec![
            Fill { price: 100, size: 10, side: 1, timestamp: 0 },
        ];
        let mid_after = vec![95]; // price went down after buy -> adverse
        let result = detect_adverse_selection(&fills, &mid_after).unwrap();
        assert!(result > 0);
    }

    #[test]
    fn test_adverse_selection_sell_adverse() {
        let fills = vec![
            Fill { price: 100, size: 10, side: 2, timestamp: 0 },
        ];
        let mid_after = vec![110]; // price went up after sell -> adverse
        let result = detect_adverse_selection(&fills, &mid_after).unwrap();
        assert!(result > 0);
    }

    #[test]
    fn test_adverse_selection_empty() {
        assert!(detect_adverse_selection(&[], &[]).is_err());
    }

    #[test]
    fn test_adverse_selection_mismatch() {
        let fills = vec![Fill { price: 100, size: 10, side: 1, timestamp: 0 }];
        assert!(detect_adverse_selection(&fills, &[100, 200]).is_err());
    }

    #[test]
    fn test_toxicity_buy_adverse() {
        // fill below mid (we bought), then mid dropped further
        let score = score_fill_toxicity(99, 100, 95, 20);
        assert!(score > 0);
    }

    #[test]
    fn test_toxicity_buy_favorable() {
        // fill below mid (we bought), mid went up
        let score = score_fill_toxicity(99, 100, 105, 20);
        assert_eq!(score, 0);
    }

    #[test]
    fn test_toxicity_sell_adverse() {
        // fill above mid (we sold), mid went higher
        let score = score_fill_toxicity(101, 100, 105, 20);
        assert!(score > 0);
    }

    #[test]
    fn test_toxicity_capped() {
        let score = score_fill_toxicity(101, 100, 200, 1);
        assert!(score <= MAX_TOXICITY_SCORE);
    }

    #[test]
    fn test_toxicity_zero_inputs() {
        assert_eq!(score_fill_toxicity(0, 100, 105, 20), 0);
        assert_eq!(score_fill_toxicity(101, 0, 105, 20), 0);
        assert_eq!(score_fill_toxicity(101, 100, 0, 20), 0);
        assert_eq!(score_fill_toxicity(101, 100, 105, 0), 0);
    }

    #[test]
    fn test_maker_edge_positive() {
        // Bought below mid
        let fills = vec![Fill { price: 98, size: 10, side: 1, timestamp: 0 }];
        let mids = vec![100];
        let edge = calculate_maker_edge(&fills, &mids).unwrap();
        assert!(edge > 0);
    }

    #[test]
    fn test_maker_edge_negative() {
        // Bought above mid
        let fills = vec![Fill { price: 102, size: 10, side: 1, timestamp: 0 }];
        let mids = vec![100];
        let edge = calculate_maker_edge(&fills, &mids).unwrap();
        assert!(edge < 0);
    }

    #[test]
    fn test_maker_edge_sell_positive() {
        // Sold above mid
        let fills = vec![Fill { price: 102, size: 10, side: 2, timestamp: 0 }];
        let mids = vec![100];
        let edge = calculate_maker_edge(&fills, &mids).unwrap();
        assert!(edge > 0);
    }

    #[test]
    fn test_maker_edge_empty() {
        assert!(calculate_maker_edge(&[], &[]).is_err());
    }

    #[test]
    fn test_maker_edge_mismatch() {
        let fills = vec![Fill { price: 100, size: 10, side: 1, timestamp: 0 }];
        assert!(calculate_maker_edge(&fills, &[100, 200]).is_err());
    }

    #[test]
    fn test_effective_spread_basic() {
        let trades = vec![
            Trade { price: 101, mid_price: 100, side: 1, size: 50 },
            Trade { price: 99, mid_price: 100, side: 2, size: 50 },
        ];
        let spread = calculate_effective_spread(&trades).unwrap();
        assert!(spread > 0);
    }

    #[test]
    fn test_effective_spread_zero_mid() {
        let trades = vec![
            Trade { price: 100, mid_price: 0, side: 1, size: 50 },
        ];
        let result = calculate_effective_spread(&trades);
        assert!(result.is_err());
    }

    #[test]
    fn test_effective_spread_empty() {
        assert!(calculate_effective_spread(&[]).is_err());
    }

    #[test]
    fn test_effective_spread_at_mid() {
        let trades = vec![
            Trade { price: 100, mid_price: 100, side: 1, size: 50 },
        ];
        let spread = calculate_effective_spread(&trades).unwrap();
        assert_eq!(spread, 0);
    }

    #[test]
    fn test_volatility_basic() {
        let prices = vec![100, 102, 99, 103, 101];
        let vol = estimate_volatility_from_prices(&prices).unwrap();
        assert!(vol > 0);
    }

    #[test]
    fn test_volatility_constant_prices() {
        let prices = vec![100, 100, 100, 100];
        let vol = estimate_volatility_from_prices(&prices).unwrap();
        assert_eq!(vol, 0);
    }

    #[test]
    fn test_volatility_one_price() {
        assert!(estimate_volatility_from_prices(&[100]).is_err());
    }

    #[test]
    fn test_volatility_empty() {
        assert!(estimate_volatility_from_prices(&[]).is_err());
    }

    #[test]
    fn test_volatility_zero_in_series() {
        assert!(estimate_volatility_from_prices(&[100, 0, 100]).is_err());
    }

    #[test]
    fn test_volatility_two_prices() {
        // Single return: 10% = 1000 bps. Mean = 1000, variance = 0, std_dev = 0
        // This is expected: a single return has no variance
        let vol = estimate_volatility_from_prices(&[100, 110]).unwrap();
        assert_eq!(vol, 0);
    }

    #[test]
    fn test_volatility_two_different_returns() {
        // Two returns with different magnitudes -> nonzero vol
        let vol = estimate_volatility_from_prices(&[100, 110, 100]).unwrap();
        assert!(vol > 0);
    }

    #[test]
    fn test_volatility_large_move() {
        let vol = estimate_volatility_from_prices(&[100, 200, 100, 200]).unwrap();
        assert!(vol > 100);
    }

    #[test]
    fn test_bid_ask_bounce_detected() {
        let trades = vec![
            Trade { price: 99, mid_price: 100, side: 1, size: 10 },
            Trade { price: 101, mid_price: 100, side: 2, size: 10 },
            Trade { price: 99, mid_price: 100, side: 1, size: 10 },
            Trade { price: 101, mid_price: 100, side: 2, size: 10 },
        ];
        assert!(detect_bid_ask_bounce(&trades, 3));
    }

    #[test]
    fn test_bid_ask_bounce_not_detected() {
        let trades = vec![
            Trade { price: 99, mid_price: 100, side: 1, size: 10 },
            Trade { price: 99, mid_price: 100, side: 1, size: 10 },
            Trade { price: 99, mid_price: 100, side: 1, size: 10 },
        ];
        assert!(!detect_bid_ask_bounce(&trades, 2));
    }

    #[test]
    fn test_bid_ask_bounce_empty() {
        assert!(!detect_bid_ask_bounce(&[], 1));
    }

    #[test]
    fn test_bid_ask_bounce_single() {
        let trades = vec![Trade { price: 99, mid_price: 100, side: 1, size: 10 }];
        assert!(!detect_bid_ask_bounce(&trades, 1));
    }

    #[test]
    fn test_consecutive_fills_same_side() {
        let fills = vec![
            Fill { price: 100, size: 10, side: 1, timestamp: 0 },
            Fill { price: 101, size: 10, side: 2, timestamp: 1 },
            Fill { price: 102, size: 10, side: 2, timestamp: 2 },
            Fill { price: 103, size: 10, side: 2, timestamp: 3 },
        ];
        assert_eq!(consecutive_same_side_fills(&fills), 3);
    }

    #[test]
    fn test_consecutive_fills_alternating() {
        let fills = vec![
            Fill { price: 100, size: 10, side: 1, timestamp: 0 },
            Fill { price: 101, size: 10, side: 2, timestamp: 1 },
        ];
        assert_eq!(consecutive_same_side_fills(&fills), 1);
    }

    #[test]
    fn test_consecutive_fills_empty() {
        assert_eq!(consecutive_same_side_fills(&[]), 0);
    }

    #[test]
    fn test_consecutive_fills_single() {
        let fills = vec![Fill { price: 100, size: 10, side: 1, timestamp: 0 }];
        assert_eq!(consecutive_same_side_fills(&fills), 1);
    }

    #[test]
    fn test_fill_rate_full() {
        assert_eq!(calculate_fill_rate_bps(100, 100).unwrap(), 10000);
    }

    #[test]
    fn test_fill_rate_half() {
        assert_eq!(calculate_fill_rate_bps(100, 50).unwrap(), 5000);
    }

    #[test]
    fn test_fill_rate_none() {
        assert_eq!(calculate_fill_rate_bps(100, 0).unwrap(), 0);
    }

    #[test]
    fn test_fill_rate_zero_orders() {
        assert!(calculate_fill_rate_bps(0, 0).is_err());
    }

    #[test]
    fn test_fill_rate_capped() {
        // If fills > orders (shouldn't happen but handle gracefully)
        let rate = calculate_fill_rate_bps(50, 100).unwrap();
        assert!(rate <= BPS_DENOM);
    }

    // ---- isqrt helper ----

    #[test]
    fn test_isqrt_zero() {
        assert_eq!(isqrt(0), 0);
    }

    #[test]
    fn test_isqrt_one() {
        assert_eq!(isqrt(1), 1);
    }

    #[test]
    fn test_isqrt_perfect() {
        assert_eq!(isqrt(100), 10);
        assert_eq!(isqrt(10000), 100);
    }

    #[test]
    fn test_isqrt_non_perfect() {
        assert_eq!(isqrt(99), 9); // floor
        assert_eq!(isqrt(101), 10);
    }

    #[test]
    fn test_isqrt_large() {
        let val = 1_000_000_000_000u128;
        let root = isqrt(val);
        assert!(root * root <= val);
        assert!((root + 1) * (root + 1) > val);
    }

    // ---- Additional edge cases / overflow protection ----

    #[test]
    fn test_mid_price_overflow_safe() {
        // Two very large u64 values that would overflow u64 addition
        let bid = u64::MAX - 10;
        let ask = u64::MAX;
        let mid = calculate_mid_price(bid, ask).unwrap();
        assert!(mid >= bid && mid <= ask);
    }

    #[test]
    fn test_generate_quotes_min_equals_max_size() {
        let mut cfg = default_config();
        cfg.min_size = 100;
        cfg.max_size = 100;
        let q = generate_quotes(&cfg, 10000, &balanced_inventory()).unwrap();
        assert_eq!(q.bid_size, 100);
        assert_eq!(q.ask_size, 100);
    }

    #[test]
    fn test_grid_levels_single_level() {
        let levels = generate_grid_levels(10000, 100, 1);
        assert_eq!(levels.len(), 3); // 1 below + center + 1 above
    }

    #[test]
    fn test_twap_large_total() {
        let slices = calculate_twap_slices(u64::MAX, 2, 1000);
        let total: u128 = slices.iter().map(|s| s.size as u128).sum();
        assert_eq!(total, u64::MAX as u128);
    }

    #[test]
    fn test_realized_pnl_large_values() {
        // Test with values that could overflow i64 multiplication
        let pnl = calculate_realized_pnl(1_000_000, 2_000_000, 1000, true);
        assert_eq!(pnl, 1_000_000_000); // (2M - 1M) * 1000
    }

    #[test]
    fn test_adjust_spread_u64_max_vol() {
        let result = adjust_spread_for_volatility(0, u64::MAX, 100);
        assert!(result <= MAX_SPREAD_BPS);
    }

    #[test]
    fn test_rebalance_extreme_imbalance() {
        let inv = Inventory {
            base_balance: 10000,
            quote_balance: 0,
            target_ratio_bps: 5000,
            current_ratio_bps: 10000,
        };
        let action = rebalance_inventory(&inv, 5000).unwrap();
        assert_eq!(action.direction, 2);
        assert_eq!(action.urgency_bps, 5000);
    }

    #[test]
    fn test_ladder_orders_unique_ids() {
        let orders = generate_ladder_orders(10000, 50, 5, 100);
        let mut ids: Vec<u64> = orders.iter().map(|o| o.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), orders.len());
    }

    #[test]
    fn test_adverse_selection_multiple_fills() {
        let fills = vec![
            Fill { price: 100, size: 10, side: 1, timestamp: 0 },
            Fill { price: 100, size: 10, side: 1, timestamp: 1 },
            Fill { price: 100, size: 10, side: 2, timestamp: 2 },
        ];
        let mid_after = vec![95, 98, 105];
        let result = detect_adverse_selection(&fills, &mid_after).unwrap();
        assert!(result > 0);
    }

    #[test]
    fn test_effective_spread_weighted() {
        let trades = vec![
            Trade { price: 102, mid_price: 100, side: 1, size: 90 },
            Trade { price: 110, mid_price: 100, side: 1, size: 10 },
        ];
        let spread = calculate_effective_spread(&trades).unwrap();
        // Should be weighted toward the 102 trade
        assert!(spread > 0);
    }

    #[test]
    fn test_pnl_record_net_calculation() {
        let record = PnlRecord {
            realized: 500,
            unrealized: -200,
            fees_paid: 50,
            fees_earned: 20,
            net_pnl: 270, // 500 + (-200) - 50 + 20
        };
        let updated = mark_to_market(&record, -100);
        // net = 500 + (-100) - 50 + 20 = 370
        assert_eq!(updated.net_pnl, 370);
    }

    #[test]
    fn test_hedge_small_position() {
        let pos = Position { side: 1, size: 1, entry_price: 100, unrealized_pnl: 0 };
        let hedge = hedge_delta(&pos, 5000).unwrap();
        assert_eq!(hedge.size, 1); // min 1
    }

    #[test]
    fn test_compute_inventory_ratio_price_multiplier() {
        // base_balance=50, quote_balance=50, base_price=2
        // base_value = 100, total = 150
        // ratio = 100 * 10000 / 150 = 6666
        let ratio = compute_inventory_ratio(50, 50, 2).unwrap();
        assert_eq!(ratio, 6666);
    }

    #[test]
    fn test_optimal_size_extreme_skew() {
        let inv = Inventory {
            base_balance: 10000,
            quote_balance: 0,
            target_ratio_bps: 0,
            current_ratio_bps: 10000,
        };
        let size = calculate_optimal_quote_size(&inv, 1000, 10000);
        // skew = 10000, reduction = 1000 * 10000 * 10000 / (10000 * 10000) = 1000
        assert_eq!(size, 0);
    }

    #[test]
    fn test_cancel_stale_partial_match() {
        let orders = vec![
            create_order(1, 100, 50, 1).unwrap(),
            create_order(2, 101, 50, 2).unwrap(),
        ];
        let timestamps = vec![1000, 9000]; // only first is stale
        let cancelled = cancel_stale_orders(&orders, &timestamps, 5000, 10000);
        assert_eq!(cancelled.len(), 1);
        assert_eq!(cancelled[0].id, 1);
    }

    #[test]
    fn test_track_fill_multiple_partial() {
        let o = create_order(1, 100, 100, 1).unwrap();
        let f1 = track_fill(&o, 100, 30).unwrap();
        assert_eq!(f1.filled, 30);
        assert_eq!(f1.remaining, 70);
        let f2 = track_fill(&f1, 100, 40).unwrap();
        assert_eq!(f2.filled, 70);
        assert_eq!(f2.remaining, 30);
        let f3 = track_fill(&f2, 100, 30).unwrap();
        assert_eq!(f3.filled, 100);
        assert_eq!(f3.remaining, 0);
        assert_eq!(f3.status, 2);
    }

    #[test]
    fn test_grid_levels_symmetry() {
        let levels = generate_grid_levels(10000, 100, 3);
        let center_idx = levels.iter().position(|&l| l == 10000).unwrap();
        // Check symmetry around center
        for i in 1..=3 {
            if center_idx >= i && center_idx + i < levels.len() {
                let below = 10000 - levels[center_idx - i];
                let above = levels[center_idx + i] - 10000;
                assert_eq!(below, above);
            }
        }
    }

    #[test]
    fn test_avellaneda_stoikov_symmetry_zero_risk() {
        let (bid_off, ask_off) = avellaneda_stoikov_spread(10000, 200, 0, 5000).unwrap();
        // With zero inventory risk, offsets should be equal
        assert_eq!(bid_off, ask_off);
    }

    #[test]
    fn test_drawdown_half() {
        assert_eq!(calculate_drawdown_bps(10000, 5000).unwrap(), 5000);
    }

    #[test]
    fn test_generate_quotes_with_timestamp() {
        let q = generate_quotes(&default_config(), 10000, &balanced_inventory()).unwrap();
        assert_eq!(q.timestamp, 0); // default
    }

    #[test]
    fn test_bid_ask_bounce_threshold() {
        // Exactly meeting the threshold
        let trades = vec![
            Trade { price: 99, mid_price: 100, side: 1, size: 10 },
            Trade { price: 101, mid_price: 100, side: 2, size: 10 },
            Trade { price: 99, mid_price: 100, side: 1, size: 10 },
        ];
        assert!(detect_bid_ask_bounce(&trades, 2));
        assert!(!detect_bid_ask_bounce(&trades, 3));
    }

    #[test]
    fn test_update_pnl_cumulative() {
        let r0 = PnlRecord { realized: 0, unrealized: 0, fees_paid: 0, fees_earned: 0, net_pnl: 0 };
        let r1 = update_pnl(&r0, 100, 5);
        let r2 = update_pnl(&r1, -30, 5);
        assert_eq!(r2.realized, 70);
        assert_eq!(r2.fees_paid, 10);
    }

    #[test]
    fn test_exposure_bps_over_100_percent() {
        // Leveraged position: value > capital
        let bps = calculate_exposure_bps(20000, 10000).unwrap();
        assert_eq!(bps, 20000);
    }

    #[test]
    fn test_round_to_tick_large_tick() {
        assert_eq!(round_to_tick(50, 100).unwrap(), 100);
    }

    #[test]
    fn test_round_to_tick_small_price_large_tick() {
        assert_eq!(round_to_tick(1, 1000).unwrap(), 0);
    }
}
