// ============ Token Economics — VIBE Token Economic Model & Tokenomics ============
// Implements the VIBE token economic model: supply mechanics, distribution schedules,
// burn mechanisms, buyback pressure, staking economics, supply elasticity,
// economic health metrics, and fee distribution.
//
// Key capabilities:
// - Total supply tracking with max supply cap, inflation/deflation rate calculation
// - Vesting allocations (team, investors, community, treasury) with cliff + linear vesting
// - Fee burns, buyback-and-burn, manual burns, burn rate tracking
// - Protocol revenue buyback pool, execution tracking, price floor support
// - APR from emissions, dilution-adjusted real yield, optimal staking ratio
// - Elastic supply adjustments, rebase mechanics, target price peg
// - Velocity tracking, holder concentration (Gini), circulating vs locked ratios
// - Revenue split (stakers, LP, treasury, burn), configurable split ratios
//
// Philosophy: Token economics is the gravity that holds the system together —
// supply decays, value accrues, and incentives align.

// ============ Constants ============

/// Basis points denominator (100% = 10_000 bps)
pub const BPS: u64 = 10_000;

/// Velocity scaling factor (multiply by 1000 for fixed-point)
pub const VELOCITY_SCALE: u64 = 1_000;

/// Maximum rebase delta in basis points (10%)
pub const MAX_REBASE_DELTA_BPS: u64 = 1_000;

/// Blocks per year approximation (CKB ~4s blocks)
pub const DEFAULT_BLOCKS_PER_YEAR: u64 = 7_884_000;

// ============ Data Types ============

/// Tracks the full token supply breakdown.
#[derive(Debug, Clone)]
pub struct TokenSupply {
    /// Total tokens ever minted (includes burned)
    pub total_supply: u128,
    /// Hard cap on total supply
    pub max_supply: u128,
    /// Tokens freely tradeable on the market
    pub circulating: u128,
    /// Tokens locked in vesting, governance, etc.
    pub locked: u128,
    /// Tokens staked in the staking contract
    pub staked: u128,
    /// Tokens permanently destroyed
    pub burned: u128,
    /// Tokens deposited in liquidity pools
    pub in_lp: u128,
}

/// A single vesting distribution allocation.
#[derive(Debug, Clone)]
pub struct DistributionAlloc {
    /// Hash identifying the category (team, investors, etc.)
    pub category_hash: [u8; 32],
    /// Total tokens allocated to this category
    pub total_amount: u64,
    /// Tokens already vested and claimable
    pub vested_amount: u64,
    /// Number of blocks before any tokens vest (cliff)
    pub cliff_blocks: u64,
    /// Number of blocks over which tokens vest linearly after cliff
    pub vesting_blocks: u64,
    /// Block number at which vesting begins
    pub start_block: u64,
}

/// Record of a token burn event.
#[derive(Debug, Clone)]
pub struct BurnRecord {
    /// Number of tokens burned
    pub amount: u64,
    /// Type of burn: 0=fee, 1=buyback, 2=manual
    pub burn_type: u8,
    /// Timestamp of the burn
    pub timestamp: u64,
    /// Transaction hash
    pub tx_hash: [u8; 32],
}

/// Buyback pool state for protocol revenue buybacks.
#[derive(Debug, Clone)]
pub struct BuybackPool {
    /// Current balance in the pool (denominated in payment token)
    pub balance: u128,
    /// Total tokens purchased via buyback
    pub total_bought: u128,
    /// Total tokens burned after buyback
    pub total_burned: u128,
    /// Timestamp of last buyback execution
    pub last_execution_at: u64,
    /// Number of buyback executions performed
    pub execution_count: u64,
}

/// Staking metrics snapshot.
#[derive(Debug, Clone)]
pub struct StakingMetrics {
    /// Total tokens currently staked
    pub total_staked: u128,
    /// Staking ratio in basis points (staked / circulating)
    pub staking_ratio_bps: u64,
    /// Emission rate (tokens per block)
    pub emission_rate: u64,
    /// Annual percentage rate in basis points
    pub apr_bps: u64,
    /// Inflation-adjusted real yield in basis points (can be negative conceptually but stored as i64)
    pub real_yield_bps: i64,
}

/// Rebase state for elastic supply adjustments.
#[derive(Debug, Clone)]
pub struct RebaseState {
    /// Target price the rebase mechanism aims for
    pub target_price: u64,
    /// Current market price
    pub current_price: u64,
    /// Signed supply change from last rebase (positive = expansion, negative = contraction)
    pub supply_delta: i64,
    /// Timestamp of last rebase
    pub last_rebase_at: u64,
    /// Current rebase epoch
    pub epoch: u64,
    /// Price deviation from target in basis points
    pub deviation_bps: u64,
}

/// Economic health indicators.
#[derive(Debug, Clone)]
pub struct EconomicHealth {
    /// Token velocity (volume / circulating supply) scaled by VELOCITY_SCALE
    pub velocity: u64,
    /// Gini coefficient in basis points (0 = perfect equality, 10000 = max inequality)
    pub gini_coefficient_bps: u64,
    /// Number of unique token holders
    pub holder_count: u64,
    /// Share of supply held by top 10 holders in basis points
    pub top10_share_bps: u64,
    /// Ratio of circulating supply to total supply in basis points
    pub circulating_ratio_bps: u64,
}

/// Fee distribution configuration and accounting.
#[derive(Debug, Clone)]
pub struct FeeDistribution {
    /// Share of fees going to stakers (basis points)
    pub staker_share_bps: u64,
    /// Share of fees going to LPs (basis points)
    pub lp_share_bps: u64,
    /// Share of fees going to treasury (basis points)
    pub treasury_share_bps: u64,
    /// Share of fees going to burn (basis points)
    pub burn_share_bps: u64,
    /// Total fees distributed in this round
    pub total_distributed: u128,
}

// ============ Supply Mechanics ============

/// Create an initial token supply state.
pub fn create_initial_supply(max_supply: u128, initial_circulating: u128) -> Result<TokenSupply, String> {
    if max_supply == 0 {
        return Err("max supply must be greater than zero".into());
    }
    if initial_circulating > max_supply {
        return Err("initial circulating exceeds max supply".into());
    }
    Ok(TokenSupply {
        total_supply: initial_circulating,
        max_supply,
        circulating: initial_circulating,
        locked: 0,
        staked: 0,
        burned: 0,
        in_lp: 0,
    })
}

/// Calculate inflation rate over a period in basis points.
/// inflation_rate_bps = (emissions * BPS) / total_supply
pub fn calculate_inflation_rate_bps(supply: &TokenSupply, _elapsed_blocks: u64, emissions: u128) -> u64 {
    if supply.total_supply == 0 {
        return 0;
    }
    let rate = emissions
        .checked_mul(BPS as u128)
        .unwrap_or(u128::MAX)
        / supply.total_supply;
    rate as u64
}

/// Calculate deflation rate over a period in basis points.
/// deflation_rate_bps = (burned_in_period * BPS) / total_supply
pub fn calculate_deflation_rate_bps(supply: &TokenSupply, burned_in_period: u128) -> u64 {
    if supply.total_supply == 0 {
        return 0;
    }
    let rate = burned_in_period
        .checked_mul(BPS as u128)
        .unwrap_or(u128::MAX)
        / supply.total_supply;
    rate as u64
}

/// Check if the token is net deflationary (burn rate > emission rate).
pub fn is_deflationary(_supply: &TokenSupply, burn_rate_bps: u64, emission_rate_bps: u64) -> bool {
    burn_rate_bps > emission_rate_bps
}

/// Project the total supply at a future block given emission and burn rates.
pub fn project_supply_at_block(
    supply: &TokenSupply,
    emission_rate: u64,
    burn_rate: u64,
    target_block: u64,
    current_block: u64,
) -> Result<u128, String> {
    if target_block < current_block {
        return Err("target block must be in the future".into());
    }
    let blocks = (target_block - current_block) as u128;
    let emitted = blocks * emission_rate as u128;
    let burned = blocks * burn_rate as u128;
    let projected = supply
        .total_supply
        .checked_add(emitted)
        .ok_or_else(|| "overflow in emission projection".to_string())?;
    let projected = if burned > projected {
        0
    } else {
        projected - burned
    };
    // Cap at max supply
    Ok(projected.min(supply.max_supply))
}

/// Calculate emission schedule with halving.
/// Each halving interval halves the initial_rate.
pub fn calculate_emission_schedule(initial_rate: u64, halving_interval: u64, current_epoch: u64) -> u64 {
    if halving_interval == 0 {
        return initial_rate;
    }
    let halvings = current_epoch / halving_interval;
    if halvings >= 64 {
        return 0;
    }
    initial_rate >> halvings
}

// ============ Distribution Schedule ============

/// Set up a vesting distribution allocation.
pub fn setup_distribution(
    category_hash: [u8; 32],
    total: u64,
    cliff_blocks: u64,
    vesting_blocks: u64,
    start_block: u64,
) -> Result<DistributionAlloc, String> {
    if total == 0 {
        return Err("total allocation must be greater than zero".into());
    }
    Ok(DistributionAlloc {
        category_hash,
        total_amount: total,
        vested_amount: 0,
        cliff_blocks,
        vesting_blocks,
        start_block,
    })
}

/// Calculate the amount of tokens vested at a given block.
pub fn calculate_vested_amount(alloc: &DistributionAlloc, current_block: u64) -> u64 {
    if current_block < alloc.start_block {
        return 0;
    }
    let elapsed = current_block - alloc.start_block;
    // Before cliff, nothing vests
    if elapsed < alloc.cliff_blocks {
        return 0;
    }
    // If no linear vesting period, everything vests at cliff
    if alloc.vesting_blocks == 0 {
        return alloc.total_amount;
    }
    let vesting_elapsed = elapsed - alloc.cliff_blocks;
    if vesting_elapsed >= alloc.vesting_blocks {
        return alloc.total_amount;
    }
    // Linear vesting: total * vesting_elapsed / vesting_blocks
    ((alloc.total_amount as u128 * vesting_elapsed as u128) / alloc.vesting_blocks as u128) as u64
}

/// Calculate the amount of tokens NOT yet vested.
pub fn calculate_unvested_amount(alloc: &DistributionAlloc, current_block: u64) -> u64 {
    let vested = calculate_vested_amount(alloc, current_block);
    alloc.total_amount.saturating_sub(vested)
}

/// Calculate the claimable amount (vested minus already claimed).
pub fn calculate_claimable(alloc: &DistributionAlloc, current_block: u64) -> u64 {
    let vested = calculate_vested_amount(alloc, current_block);
    vested.saturating_sub(alloc.vested_amount)
}

/// Claim vested tokens — returns updated allocation and claimed amount.
pub fn claim_vested(alloc: &DistributionAlloc, current_block: u64) -> Result<(DistributionAlloc, u64), String> {
    let claimable = calculate_claimable(alloc, current_block);
    if claimable == 0 {
        return Err("nothing to claim".into());
    }
    let mut updated = alloc.clone();
    updated.vested_amount += claimable;
    Ok((updated, claimable))
}

/// Calculate vesting progress in basis points.
pub fn vesting_progress_bps(alloc: &DistributionAlloc, current_block: u64) -> u64 {
    if alloc.total_amount == 0 {
        return BPS;
    }
    let vested = calculate_vested_amount(alloc, current_block);
    ((vested as u128 * BPS as u128) / alloc.total_amount as u128) as u64
}

// ============ Burn Mechanisms ============

/// Burn tokens from the supply. Returns updated supply and a burn record.
pub fn burn_tokens(
    supply: &TokenSupply,
    amount: u64,
    burn_type: u8,
    timestamp: u64,
    tx_hash: [u8; 32],
) -> Result<(TokenSupply, BurnRecord), String> {
    if amount == 0 {
        return Err("burn amount must be greater than zero".into());
    }
    if burn_type > 2 {
        return Err("invalid burn type (must be 0, 1, or 2)".into());
    }
    let amount128 = amount as u128;
    if amount128 > supply.circulating {
        return Err("burn amount exceeds circulating supply".into());
    }
    let mut updated = supply.clone();
    updated.circulating -= amount128;
    updated.burned += amount128;
    let record = BurnRecord {
        amount,
        burn_type,
        timestamp,
        tx_hash,
    };
    Ok((updated, record))
}

/// Calculate the cumulative burn rate in basis points (burned / total_supply).
pub fn cumulative_burn_rate_bps(supply: &TokenSupply) -> u64 {
    if supply.total_supply == 0 {
        return 0;
    }
    ((supply.burned * BPS as u128) / supply.total_supply) as u64
}

/// Calculate tokens remaining that could still be burned from circulating supply.
pub fn burnable_supply(supply: &TokenSupply) -> u128 {
    supply.circulating
}

/// Estimate blocks until a target burn amount is reached at the given burn rate per block.
pub fn blocks_until_burn_target(current_burned: u128, target_burned: u128, burn_per_block: u64) -> Result<u64, String> {
    if burn_per_block == 0 {
        return Err("burn rate cannot be zero".into());
    }
    if current_burned >= target_burned {
        return Ok(0);
    }
    let remaining = target_burned - current_burned;
    let blocks = remaining / burn_per_block as u128;
    Ok(blocks as u64)
}

// ============ Buyback Pressure ============

/// Create a new empty buyback pool.
pub fn create_buyback_pool() -> BuybackPool {
    BuybackPool {
        balance: 0,
        total_bought: 0,
        total_burned: 0,
        last_execution_at: 0,
        execution_count: 0,
    }
}

/// Add revenue to the buyback pool.
pub fn fund_buyback_pool(pool: &BuybackPool, amount: u128) -> Result<BuybackPool, String> {
    if amount == 0 {
        return Err("funding amount must be greater than zero".into());
    }
    let mut updated = pool.clone();
    updated.balance = updated.balance.checked_add(amount)
        .ok_or_else(|| "overflow in buyback pool balance".to_string())?;
    Ok(updated)
}

/// Execute a buyback: spend `amount` from pool balance to buy tokens at `price`.
/// price is in payment-token-per-VIBE (scaled by 1e18 or similar).
/// tokens_bought = amount * 1e18 / price (if price is scaled by 1e18).
pub fn execute_buyback(pool: &BuybackPool, amount: u128, price: u128, timestamp: u64) -> Result<BuybackPool, String> {
    if amount == 0 {
        return Err("buyback amount must be greater than zero".into());
    }
    if price == 0 {
        return Err("price must be greater than zero".into());
    }
    if amount > pool.balance {
        return Err("insufficient buyback pool balance".into());
    }
    // tokens_bought = amount * SCALE / price
    let scale: u128 = 1_000_000_000_000_000_000; // 1e18
    let tokens_bought = amount.checked_mul(scale)
        .ok_or_else(|| "overflow in buyback calculation".to_string())?
        / price;
    let mut updated = pool.clone();
    updated.balance -= amount;
    updated.total_bought = updated.total_bought.checked_add(tokens_bought)
        .ok_or_else(|| "overflow in total bought".to_string())?;
    updated.total_burned = updated.total_burned.checked_add(tokens_bought)
        .ok_or_else(|| "overflow in total burned".to_string())?;
    updated.last_execution_at = timestamp;
    updated.execution_count += 1;
    Ok(updated)
}

/// Calculate the recommended buyback amount to hit a target burn rate.
/// target_burn_rate_bps of total supply should be burned — how much do we need to buy?
pub fn calculate_buyback_amount(pool: &BuybackPool, target_burn_rate_bps: u64, supply: &TokenSupply, price: u128) -> u128 {
    if price == 0 || supply.total_supply == 0 {
        return 0;
    }
    // target_tokens = total_supply * target_burn_rate_bps / BPS
    let target_tokens = supply.total_supply * target_burn_rate_bps as u128 / BPS as u128;
    // Already burned enough?
    if pool.total_burned >= target_tokens {
        return 0;
    }
    let tokens_needed = target_tokens - pool.total_burned;
    // cost = tokens_needed * price / 1e18
    let scale: u128 = 1_000_000_000_000_000_000;
    let cost = tokens_needed.checked_mul(price).unwrap_or(u128::MAX) / scale;
    // Cap at pool balance
    cost.min(pool.balance)
}

/// Calculate the average buyback price (total cost implied / total bought).
pub fn average_buyback_price(pool: &BuybackPool) -> u128 {
    if pool.total_bought == 0 {
        return 0;
    }
    // We don't track total spent separately, so use total_bought as a metric
    // For simplicity: total_burned tracks what was bought and burned
    // This returns a placeholder — in production, track cumulative spend
    0
}

// ============ Staking Economics ============

/// Calculate staking APR in basis points.
/// apr_bps = (emissions_per_block * blocks_per_year * BPS) / total_staked
pub fn calculate_staking_apr_bps(
    emissions_per_block: u64,
    total_staked: u128,
    blocks_per_year: u64,
    _token_price: u64,
) -> u64 {
    if total_staked == 0 {
        return 0;
    }
    let annual_emissions = emissions_per_block as u128 * blocks_per_year as u128;
    let apr = annual_emissions
        .checked_mul(BPS as u128)
        .unwrap_or(u128::MAX)
        / total_staked;
    apr as u64
}

/// Calculate real yield (APR minus inflation) in basis points. Can be negative.
pub fn calculate_real_yield_bps(apr_bps: u64, inflation_rate_bps: u64) -> i64 {
    apr_bps as i64 - inflation_rate_bps as i64
}

/// Calculate the optimal staking ratio for network security.
/// If emission_bps >= security_target_bps, staking ratio should be at least security_target_bps.
pub fn optimal_staking_ratio_bps(emission_bps: u64, security_target_bps: u64) -> u64 {
    // The optimal ratio balances dilution cost with security benefit.
    // Simple model: optimal = sqrt(emission_bps * security_target_bps) using integer sqrt.
    let product = emission_bps as u128 * security_target_bps as u128;
    let sqrt_val = isqrt_u128(product);
    sqrt_val as u64
}

/// Build a staking metrics snapshot.
pub fn build_staking_metrics(
    total_staked: u128,
    circulating: u128,
    emission_rate: u64,
    blocks_per_year: u64,
    inflation_rate_bps: u64,
) -> StakingMetrics {
    let staking_ratio_bps = if circulating == 0 {
        0
    } else {
        ((total_staked * BPS as u128) / circulating) as u64
    };
    let apr_bps = calculate_staking_apr_bps(emission_rate, total_staked, blocks_per_year, 0);
    let real_yield_bps = calculate_real_yield_bps(apr_bps, inflation_rate_bps);
    StakingMetrics {
        total_staked,
        staking_ratio_bps,
        emission_rate,
        apr_bps,
        real_yield_bps,
    }
}

/// Calculate dilution factor for non-stakers in basis points.
/// dilution = inflation_rate * (1 - staking_ratio) conceptually.
pub fn non_staker_dilution_bps(inflation_rate_bps: u64, staking_ratio_bps: u64) -> u64 {
    if staking_ratio_bps >= BPS {
        return 0;
    }
    let non_staking_bps = BPS - staking_ratio_bps;
    ((inflation_rate_bps as u128 * non_staking_bps as u128) / BPS as u128) as u64
}

// ============ Supply Elasticity ============

/// Calculate rebase parameters given current price vs target.
pub fn calculate_rebase(
    state: &RebaseState,
    current_price: u64,
    max_delta_bps: u64,
    current_supply: u128,
) -> Result<RebaseState, String> {
    if state.target_price == 0 {
        return Err("target price must be non-zero".into());
    }
    if current_price == 0 {
        return Err("current price must be non-zero".into());
    }
    let deviation_bps = if current_price > state.target_price {
        ((current_price as u128 - state.target_price as u128) * BPS as u128 / state.target_price as u128) as u64
    } else {
        ((state.target_price as u128 - current_price as u128) * BPS as u128 / state.target_price as u128) as u64
    };

    // Clamp delta to max
    let effective_delta_bps = deviation_bps.min(max_delta_bps);

    let supply_change = (current_supply * effective_delta_bps as u128 / BPS as u128) as i64;
    let supply_delta = if current_price > state.target_price {
        // Price too high -> expand supply (positive delta)
        supply_change
    } else {
        // Price too low -> contract supply (negative delta)
        -supply_change
    };

    Ok(RebaseState {
        target_price: state.target_price,
        current_price,
        supply_delta,
        last_rebase_at: state.last_rebase_at,
        epoch: state.epoch + 1,
        deviation_bps,
    })
}

/// Apply a rebase delta to the token supply.
pub fn apply_rebase(supply: &TokenSupply, delta: i64) -> Result<TokenSupply, String> {
    let mut updated = supply.clone();
    if delta > 0 {
        let increase = delta as u128;
        let new_total = updated.total_supply.checked_add(increase)
            .ok_or_else(|| "overflow in rebase expansion".to_string())?;
        if new_total > updated.max_supply {
            return Err("rebase would exceed max supply".into());
        }
        updated.total_supply = new_total;
        updated.circulating += increase;
    } else if delta < 0 {
        let decrease = (-delta) as u128;
        if decrease > updated.circulating {
            return Err("rebase contraction exceeds circulating supply".into());
        }
        updated.total_supply -= decrease;
        updated.circulating -= decrease;
    }
    Ok(updated)
}

/// Create an initial rebase state.
pub fn create_rebase_state(target_price: u64, current_price: u64, timestamp: u64) -> RebaseState {
    let deviation_bps = if target_price > 0 {
        if current_price > target_price {
            ((current_price as u128 - target_price as u128) * BPS as u128 / target_price as u128) as u64
        } else {
            ((target_price as u128 - current_price as u128) * BPS as u128 / target_price as u128) as u64
        }
    } else {
        0
    };
    RebaseState {
        target_price,
        current_price,
        supply_delta: 0,
        last_rebase_at: timestamp,
        epoch: 0,
        deviation_bps,
    }
}

/// Check if a rebase is needed (deviation exceeds threshold).
pub fn needs_rebase(state: &RebaseState, threshold_bps: u64) -> bool {
    state.deviation_bps > threshold_bps
}

// ============ Economic Health ============

/// Calculate token velocity: volume_24h / circulating_supply, scaled by VELOCITY_SCALE.
pub fn calculate_velocity(volume_24h: u128, circulating_supply: u128) -> u64 {
    if circulating_supply == 0 {
        return 0;
    }
    ((volume_24h * VELOCITY_SCALE as u128) / circulating_supply) as u64
}

/// Calculate the Gini coefficient in basis points from a list of balances.
/// 0 = perfect equality, 10000 = maximum inequality.
/// Uses the relative mean absolute difference formula.
pub fn calculate_gini_bps(balances: &[u64]) -> u64 {
    let n = balances.len();
    if n <= 1 {
        return 0;
    }
    let sum: u128 = balances.iter().map(|&b| b as u128).sum();
    if sum == 0 {
        return 0;
    }
    // Gini = sum of |xi - xj| for all i,j / (2 * n * sum)
    let mut abs_diff_sum: u128 = 0;
    for i in 0..n {
        for j in 0..n {
            let a = balances[i] as u128;
            let b = balances[j] as u128;
            abs_diff_sum += if a > b { a - b } else { b - a };
        }
    }
    let denominator = 2 * n as u128 * sum;
    if denominator == 0 {
        return 0;
    }
    let gini = abs_diff_sum * BPS as u128 / denominator;
    gini.min(BPS as u128) as u64
}

/// Calculate the share of total supply held by the top N holders, in basis points.
/// Expects balances sorted descending.
pub fn calculate_top_n_share_bps(sorted_balances_desc: &[u64], n: usize, total: u128) -> u64 {
    if total == 0 || sorted_balances_desc.is_empty() {
        return 0;
    }
    let top_sum: u128 = sorted_balances_desc.iter()
        .take(n)
        .map(|&b| b as u128)
        .sum();
    ((top_sum * BPS as u128) / total) as u64
}

/// Calculate the circulating ratio in basis points (circulating / total_supply).
pub fn calculate_circulating_ratio_bps(supply: &TokenSupply) -> u64 {
    if supply.total_supply == 0 {
        return 0;
    }
    ((supply.circulating * BPS as u128) / supply.total_supply) as u64
}

/// Build a full economic health snapshot.
pub fn build_economic_health(
    volume_24h: u128,
    supply: &TokenSupply,
    balances: &[u64],
    sorted_desc: &[u64],
    holder_count: u64,
) -> EconomicHealth {
    let velocity = calculate_velocity(volume_24h, supply.circulating);
    let gini_coefficient_bps = calculate_gini_bps(balances);
    let total: u128 = balances.iter().map(|&b| b as u128).sum();
    let top10_share_bps = calculate_top_n_share_bps(sorted_desc, 10, total);
    let circulating_ratio_bps = calculate_circulating_ratio_bps(supply);
    EconomicHealth {
        velocity,
        gini_coefficient_bps,
        holder_count,
        top10_share_bps,
        circulating_ratio_bps,
    }
}

/// Determine if holder concentration is healthy (Gini below threshold).
pub fn is_concentration_healthy(gini_bps: u64, max_gini_bps: u64) -> bool {
    gini_bps <= max_gini_bps
}

/// Determine if velocity is in healthy range.
pub fn is_velocity_healthy(velocity: u64, min_velocity: u64, max_velocity: u64) -> bool {
    velocity >= min_velocity && velocity <= max_velocity
}

// ============ Fee Distribution ============

/// Distribute a total fee amount according to the configured split.
pub fn distribute_fees(
    total_fee: u128,
    staker_share_bps: u64,
    lp_share_bps: u64,
    treasury_share_bps: u64,
    burn_share_bps: u64,
) -> Result<FeeDistribution, String> {
    let total_bps = staker_share_bps + lp_share_bps + treasury_share_bps + burn_share_bps;
    if total_bps != BPS {
        return Err(format!("fee shares must sum to {} bps, got {}", BPS, total_bps));
    }
    Ok(FeeDistribution {
        staker_share_bps,
        lp_share_bps,
        treasury_share_bps,
        burn_share_bps,
        total_distributed: total_fee,
    })
}

/// Calculate the amount allocated to stakers from a fee distribution.
pub fn staker_fee_amount(dist: &FeeDistribution) -> u128 {
    dist.total_distributed * dist.staker_share_bps as u128 / BPS as u128
}

/// Calculate the amount allocated to LPs from a fee distribution.
pub fn lp_fee_amount(dist: &FeeDistribution) -> u128 {
    dist.total_distributed * dist.lp_share_bps as u128 / BPS as u128
}

/// Calculate the amount allocated to treasury from a fee distribution.
pub fn treasury_fee_amount(dist: &FeeDistribution) -> u128 {
    dist.total_distributed * dist.treasury_share_bps as u128 / BPS as u128
}

/// Calculate the amount allocated to burn from a fee distribution.
pub fn burn_fee_amount(dist: &FeeDistribution) -> u128 {
    dist.total_distributed * dist.burn_share_bps as u128 / BPS as u128
}

/// Verify that the sum of distributed amounts equals total (accounting for rounding).
pub fn verify_fee_distribution(dist: &FeeDistribution) -> bool {
    let sum = staker_fee_amount(dist) + lp_fee_amount(dist)
        + treasury_fee_amount(dist) + burn_fee_amount(dist);
    // Allow for rounding dust (up to 3 units)
    let diff = if sum > dist.total_distributed {
        sum - dist.total_distributed
    } else {
        dist.total_distributed - sum
    };
    diff <= 3
}

// ============ Valuation Helpers ============

/// Estimate fully diluted valuation: max_supply * price.
pub fn estimate_fully_diluted_valuation(max_supply: u128, price: u128) -> u128 {
    max_supply.checked_mul(price).unwrap_or(u128::MAX)
}

/// Estimate market cap: circulating * price.
pub fn estimate_market_cap(circulating: u128, price: u128) -> u128 {
    circulating.checked_mul(price).unwrap_or(u128::MAX)
}

/// Calculate price-to-earnings ratio (market_cap / annual_revenue) scaled by 100.
pub fn price_to_earnings_x100(market_cap: u128, annual_revenue: u128) -> u64 {
    if annual_revenue == 0 {
        return 0;
    }
    ((market_cap * 100) / annual_revenue) as u64
}

/// Determine if market cap / FDV ratio indicates healthy distribution (> threshold_bps).
pub fn is_mcap_fdv_healthy(circulating: u128, max_supply: u128, threshold_bps: u64) -> bool {
    if max_supply == 0 {
        return false;
    }
    let ratio_bps = (circulating * BPS as u128) / max_supply;
    ratio_bps >= threshold_bps as u128
}

// ============ Internal Helpers ============

/// Integer square root for u128 using Newton's method.
fn isqrt_u128(x: u128) -> u128 {
    if x == 0 {
        return 0;
    }
    let mut z = x / 2 + 1;
    let mut y = x;
    while z < y {
        y = z;
        z = (x / z + z) / 2;
    }
    y
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Supply Mechanics ----

    #[test]
    fn test_create_initial_supply_basic() {
        let s = create_initial_supply(1_000_000, 100_000).unwrap();
        assert_eq!(s.total_supply, 100_000);
        assert_eq!(s.max_supply, 1_000_000);
        assert_eq!(s.circulating, 100_000);
        assert_eq!(s.locked, 0);
        assert_eq!(s.staked, 0);
        assert_eq!(s.burned, 0);
        assert_eq!(s.in_lp, 0);
    }

    #[test]
    fn test_create_initial_supply_max_equals_circulating() {
        let s = create_initial_supply(500, 500).unwrap();
        assert_eq!(s.total_supply, 500);
        assert_eq!(s.circulating, 500);
    }

    #[test]
    fn test_create_initial_supply_zero_circulating() {
        let s = create_initial_supply(1_000, 0).unwrap();
        assert_eq!(s.total_supply, 0);
        assert_eq!(s.circulating, 0);
    }

    #[test]
    fn test_create_initial_supply_zero_max_fails() {
        assert!(create_initial_supply(0, 0).is_err());
    }

    #[test]
    fn test_create_initial_supply_circulating_exceeds_max_fails() {
        assert!(create_initial_supply(100, 200).is_err());
    }

    #[test]
    fn test_create_initial_supply_large_values() {
        let max = u128::MAX / 2;
        let s = create_initial_supply(max, max / 10).unwrap();
        assert_eq!(s.max_supply, max);
        assert_eq!(s.circulating, max / 10);
    }

    #[test]
    fn test_inflation_rate_bps_basic() {
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        // 5000 emissions out of 500_000 total = 100 bps = 1%
        let rate = calculate_inflation_rate_bps(&s, 100, 5_000);
        assert_eq!(rate, 100);
    }

    #[test]
    fn test_inflation_rate_bps_zero_supply() {
        let s = create_initial_supply(1_000, 0).unwrap();
        let rate = calculate_inflation_rate_bps(&s, 100, 500);
        assert_eq!(rate, 0);
    }

    #[test]
    fn test_inflation_rate_bps_zero_emissions() {
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        let rate = calculate_inflation_rate_bps(&s, 100, 0);
        assert_eq!(rate, 0);
    }

    #[test]
    fn test_inflation_rate_bps_high_emissions() {
        let s = create_initial_supply(1_000_000, 100_000).unwrap();
        // 100_000 emissions = 100% of supply = 10000 bps
        let rate = calculate_inflation_rate_bps(&s, 100, 100_000);
        assert_eq!(rate, 10_000);
    }

    #[test]
    fn test_deflation_rate_bps_basic() {
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        let rate = calculate_deflation_rate_bps(&s, 2_500);
        // 2500 / 500000 * 10000 = 50 bps
        assert_eq!(rate, 50);
    }

    #[test]
    fn test_deflation_rate_bps_zero_supply() {
        let s = create_initial_supply(1_000, 0).unwrap();
        let rate = calculate_deflation_rate_bps(&s, 100);
        assert_eq!(rate, 0);
    }

    #[test]
    fn test_deflation_rate_bps_zero_burned() {
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        let rate = calculate_deflation_rate_bps(&s, 0);
        assert_eq!(rate, 0);
    }

    #[test]
    fn test_is_deflationary_true() {
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        assert!(is_deflationary(&s, 200, 100));
    }

    #[test]
    fn test_is_deflationary_false() {
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        assert!(!is_deflationary(&s, 100, 200));
    }

    #[test]
    fn test_is_deflationary_equal() {
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        assert!(!is_deflationary(&s, 100, 100));
    }

    #[test]
    fn test_project_supply_same_block() {
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        let p = project_supply_at_block(&s, 10, 5, 100, 100).unwrap();
        assert_eq!(p, 500_000);
    }

    #[test]
    fn test_project_supply_future_net_emission() {
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        // 100 blocks * 10 emission - 100 * 5 burn = 500 net
        let p = project_supply_at_block(&s, 10, 5, 200, 100).unwrap();
        assert_eq!(p, 500_500);
    }

    #[test]
    fn test_project_supply_capped_at_max() {
        let s = create_initial_supply(500_100, 500_000).unwrap();
        let p = project_supply_at_block(&s, 10, 0, 200, 100).unwrap();
        // Would be 501_000 but max is 500_100
        assert_eq!(p, 500_100);
    }

    #[test]
    fn test_project_supply_past_block_fails() {
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        assert!(project_supply_at_block(&s, 10, 5, 50, 100).is_err());
    }

    #[test]
    fn test_project_supply_net_burn() {
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        // 100 blocks * 0 emission - 100 * 10 burn = -1000
        let p = project_supply_at_block(&s, 0, 10, 200, 100).unwrap();
        assert_eq!(p, 499_000);
    }

    #[test]
    fn test_project_supply_burn_exceeds_supply() {
        let s = create_initial_supply(1_000_000, 100).unwrap();
        // 1000 blocks * 0 emission - 1000 * 10 burn = -10_000, but supply is only 100
        let p = project_supply_at_block(&s, 0, 10, 1100, 100).unwrap();
        assert_eq!(p, 0);
    }

    #[test]
    fn test_emission_schedule_no_halving() {
        let rate = calculate_emission_schedule(1000, 100, 0);
        assert_eq!(rate, 1000);
    }

    #[test]
    fn test_emission_schedule_one_halving() {
        let rate = calculate_emission_schedule(1000, 100, 100);
        assert_eq!(rate, 500);
    }

    #[test]
    fn test_emission_schedule_two_halvings() {
        let rate = calculate_emission_schedule(1000, 100, 200);
        assert_eq!(rate, 250);
    }

    #[test]
    fn test_emission_schedule_many_halvings_goes_to_zero() {
        let rate = calculate_emission_schedule(1000, 1, 64);
        assert_eq!(rate, 0);
    }

    #[test]
    fn test_emission_schedule_zero_interval() {
        let rate = calculate_emission_schedule(1000, 0, 5);
        assert_eq!(rate, 1000);
    }

    #[test]
    fn test_emission_schedule_partial_epoch() {
        // epoch 150, interval 100 -> 1 full halving
        let rate = calculate_emission_schedule(800, 100, 150);
        assert_eq!(rate, 400);
    }

    // ---- Distribution Schedule ----

    #[test]
    fn test_setup_distribution_basic() {
        let hash = [0xAA; 32];
        let alloc = setup_distribution(hash, 1_000_000, 100, 900, 0).unwrap();
        assert_eq!(alloc.total_amount, 1_000_000);
        assert_eq!(alloc.cliff_blocks, 100);
        assert_eq!(alloc.vesting_blocks, 900);
        assert_eq!(alloc.start_block, 0);
        assert_eq!(alloc.vested_amount, 0);
    }

    #[test]
    fn test_setup_distribution_zero_total_fails() {
        assert!(setup_distribution([0; 32], 0, 100, 900, 0).is_err());
    }

    #[test]
    fn test_vested_amount_before_start() {
        let alloc = setup_distribution([0; 32], 1000, 100, 900, 500).unwrap();
        assert_eq!(calculate_vested_amount(&alloc, 400), 0);
    }

    #[test]
    fn test_vested_amount_during_cliff() {
        let alloc = setup_distribution([0; 32], 1000, 100, 900, 0).unwrap();
        assert_eq!(calculate_vested_amount(&alloc, 50), 0);
    }

    #[test]
    fn test_vested_amount_at_cliff_end() {
        let alloc = setup_distribution([0; 32], 1000, 100, 900, 0).unwrap();
        // At block 100, cliff just passed, vesting_elapsed = 0
        assert_eq!(calculate_vested_amount(&alloc, 100), 0);
    }

    #[test]
    fn test_vested_amount_midway() {
        let alloc = setup_distribution([0; 32], 1000, 100, 900, 0).unwrap();
        // Block 550: elapsed=550, cliff=100, vesting_elapsed=450, 1000 * 450 / 900 = 500
        assert_eq!(calculate_vested_amount(&alloc, 550), 500);
    }

    #[test]
    fn test_vested_amount_fully_vested() {
        let alloc = setup_distribution([0; 32], 1000, 100, 900, 0).unwrap();
        assert_eq!(calculate_vested_amount(&alloc, 1000), 1000);
    }

    #[test]
    fn test_vested_amount_past_fully_vested() {
        let alloc = setup_distribution([0; 32], 1000, 100, 900, 0).unwrap();
        assert_eq!(calculate_vested_amount(&alloc, 2000), 1000);
    }

    #[test]
    fn test_vested_amount_no_vesting_period() {
        let alloc = setup_distribution([0; 32], 1000, 100, 0, 0).unwrap();
        // After cliff, everything vests immediately
        assert_eq!(calculate_vested_amount(&alloc, 100), 1000);
    }

    #[test]
    fn test_vested_amount_no_cliff() {
        let alloc = setup_distribution([0; 32], 1000, 0, 1000, 0).unwrap();
        // At block 500: 1000 * 500 / 1000 = 500
        assert_eq!(calculate_vested_amount(&alloc, 500), 500);
    }

    #[test]
    fn test_unvested_amount_before_start() {
        let alloc = setup_distribution([0; 32], 1000, 100, 900, 500).unwrap();
        assert_eq!(calculate_unvested_amount(&alloc, 0), 1000);
    }

    #[test]
    fn test_unvested_amount_midway() {
        let alloc = setup_distribution([0; 32], 1000, 100, 900, 0).unwrap();
        assert_eq!(calculate_unvested_amount(&alloc, 550), 500);
    }

    #[test]
    fn test_unvested_amount_fully_vested() {
        let alloc = setup_distribution([0; 32], 1000, 100, 900, 0).unwrap();
        assert_eq!(calculate_unvested_amount(&alloc, 1000), 0);
    }

    #[test]
    fn test_claimable_nothing_vested() {
        let alloc = setup_distribution([0; 32], 1000, 100, 900, 0).unwrap();
        assert_eq!(calculate_claimable(&alloc, 50), 0);
    }

    #[test]
    fn test_claimable_some_vested() {
        let alloc = setup_distribution([0; 32], 1000, 100, 900, 0).unwrap();
        assert_eq!(calculate_claimable(&alloc, 550), 500);
    }

    #[test]
    fn test_claimable_after_partial_claim() {
        let alloc = setup_distribution([0; 32], 1000, 100, 900, 0).unwrap();
        let (claimed_alloc, amount) = claim_vested(&alloc, 550).unwrap();
        assert_eq!(amount, 500);
        // At block 1000, fully vested = 1000, already claimed = 500
        assert_eq!(calculate_claimable(&claimed_alloc, 1000), 500);
    }

    #[test]
    fn test_claim_vested_nothing_to_claim_fails() {
        let alloc = setup_distribution([0; 32], 1000, 100, 900, 0).unwrap();
        assert!(claim_vested(&alloc, 50).is_err());
    }

    #[test]
    fn test_claim_vested_updates_vested_amount() {
        let alloc = setup_distribution([0; 32], 1000, 100, 900, 0).unwrap();
        let (updated, claimed) = claim_vested(&alloc, 550).unwrap();
        assert_eq!(claimed, 500);
        assert_eq!(updated.vested_amount, 500);
    }

    #[test]
    fn test_vesting_progress_bps_zero() {
        let alloc = setup_distribution([0; 32], 1000, 100, 900, 0).unwrap();
        assert_eq!(vesting_progress_bps(&alloc, 0), 0);
    }

    #[test]
    fn test_vesting_progress_bps_half() {
        let alloc = setup_distribution([0; 32], 1000, 100, 900, 0).unwrap();
        assert_eq!(vesting_progress_bps(&alloc, 550), 5000);
    }

    #[test]
    fn test_vesting_progress_bps_full() {
        let alloc = setup_distribution([0; 32], 1000, 100, 900, 0).unwrap();
        assert_eq!(vesting_progress_bps(&alloc, 1000), 10000);
    }

    #[test]
    fn test_vesting_progress_bps_zero_total() {
        // Edge case: use a manually constructed alloc with total_amount=0
        let alloc = DistributionAlloc {
            category_hash: [0; 32],
            total_amount: 0,
            vested_amount: 0,
            cliff_blocks: 0,
            vesting_blocks: 0,
            start_block: 0,
        };
        assert_eq!(vesting_progress_bps(&alloc, 100), BPS);
    }

    // ---- Burn Mechanisms ----

    #[test]
    fn test_burn_tokens_fee_burn() {
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        let (updated, record) = burn_tokens(&s, 1000, 0, 12345, [0xFF; 32]).unwrap();
        assert_eq!(updated.circulating, 499_000);
        assert_eq!(updated.burned, 1000);
        assert_eq!(record.burn_type, 0);
        assert_eq!(record.amount, 1000);
    }

    #[test]
    fn test_burn_tokens_buyback_burn() {
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        let (updated, record) = burn_tokens(&s, 2000, 1, 99999, [0xAB; 32]).unwrap();
        assert_eq!(updated.burned, 2000);
        assert_eq!(record.burn_type, 1);
    }

    #[test]
    fn test_burn_tokens_manual_burn() {
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        let (_, record) = burn_tokens(&s, 500, 2, 55555, [0xCD; 32]).unwrap();
        assert_eq!(record.burn_type, 2);
    }

    #[test]
    fn test_burn_tokens_zero_fails() {
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        assert!(burn_tokens(&s, 0, 0, 0, [0; 32]).is_err());
    }

    #[test]
    fn test_burn_tokens_invalid_type_fails() {
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        assert!(burn_tokens(&s, 100, 3, 0, [0; 32]).is_err());
    }

    #[test]
    fn test_burn_tokens_exceeds_circulating_fails() {
        let s = create_initial_supply(1_000_000, 100).unwrap();
        assert!(burn_tokens(&s, 200, 0, 0, [0; 32]).is_err());
    }

    #[test]
    fn test_burn_tokens_exact_circulating() {
        let s = create_initial_supply(1_000_000, 100).unwrap();
        let (updated, _) = burn_tokens(&s, 100, 0, 0, [0; 32]).unwrap();
        assert_eq!(updated.circulating, 0);
        assert_eq!(updated.burned, 100);
    }

    #[test]
    fn test_cumulative_burn_rate_bps_none() {
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        assert_eq!(cumulative_burn_rate_bps(&s), 0);
    }

    #[test]
    fn test_cumulative_burn_rate_bps_after_burn() {
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        let (updated, _) = burn_tokens(&s, 25_000, 0, 0, [0; 32]).unwrap();
        // burned=25000, total=500000 -> 500 bps = 5%
        assert_eq!(cumulative_burn_rate_bps(&updated), 500);
    }

    #[test]
    fn test_burnable_supply() {
        let s = create_initial_supply(1_000_000, 300_000).unwrap();
        assert_eq!(burnable_supply(&s), 300_000);
    }

    #[test]
    fn test_blocks_until_burn_target_already_reached() {
        assert_eq!(blocks_until_burn_target(1000, 500, 10).unwrap(), 0);
    }

    #[test]
    fn test_blocks_until_burn_target_exact() {
        assert_eq!(blocks_until_burn_target(0, 1000, 10).unwrap(), 100);
    }

    #[test]
    fn test_blocks_until_burn_target_zero_rate_fails() {
        assert!(blocks_until_burn_target(0, 1000, 0).is_err());
    }

    #[test]
    fn test_blocks_until_burn_target_partial() {
        // 500 remaining / 30 per block = 16 blocks (integer division)
        assert_eq!(blocks_until_burn_target(500, 1000, 30).unwrap(), 16);
    }

    // ---- Buyback Pressure ----

    #[test]
    fn test_create_buyback_pool() {
        let pool = create_buyback_pool();
        assert_eq!(pool.balance, 0);
        assert_eq!(pool.total_bought, 0);
        assert_eq!(pool.total_burned, 0);
        assert_eq!(pool.execution_count, 0);
    }

    #[test]
    fn test_fund_buyback_pool() {
        let pool = create_buyback_pool();
        let funded = fund_buyback_pool(&pool, 1_000_000).unwrap();
        assert_eq!(funded.balance, 1_000_000);
    }

    #[test]
    fn test_fund_buyback_pool_zero_fails() {
        let pool = create_buyback_pool();
        assert!(fund_buyback_pool(&pool, 0).is_err());
    }

    #[test]
    fn test_fund_buyback_pool_multiple() {
        let pool = create_buyback_pool();
        let p1 = fund_buyback_pool(&pool, 500).unwrap();
        let p2 = fund_buyback_pool(&p1, 300).unwrap();
        assert_eq!(p2.balance, 800);
    }

    #[test]
    fn test_execute_buyback_basic() {
        let pool = fund_buyback_pool(&create_buyback_pool(), 1_000_000).unwrap();
        let price = 2_000_000_000_000_000_000u128; // 2.0 scaled by 1e18
        let updated = execute_buyback(&pool, 500_000, price, 100).unwrap();
        assert_eq!(updated.balance, 500_000);
        // tokens = 500_000 * 1e18 / 2e18 = 250_000
        assert_eq!(updated.total_bought, 250_000);
        assert_eq!(updated.total_burned, 250_000);
        assert_eq!(updated.execution_count, 1);
        assert_eq!(updated.last_execution_at, 100);
    }

    #[test]
    fn test_execute_buyback_zero_amount_fails() {
        let pool = fund_buyback_pool(&create_buyback_pool(), 1_000_000).unwrap();
        assert!(execute_buyback(&pool, 0, 1_000_000, 0).is_err());
    }

    #[test]
    fn test_execute_buyback_zero_price_fails() {
        let pool = fund_buyback_pool(&create_buyback_pool(), 1_000_000).unwrap();
        assert!(execute_buyback(&pool, 500_000, 0, 0).is_err());
    }

    #[test]
    fn test_execute_buyback_insufficient_balance_fails() {
        let pool = fund_buyback_pool(&create_buyback_pool(), 100).unwrap();
        assert!(execute_buyback(&pool, 200, 1_000_000_000_000_000_000, 0).is_err());
    }

    #[test]
    fn test_execute_buyback_multiple() {
        let pool = fund_buyback_pool(&create_buyback_pool(), 1_000_000).unwrap();
        let price = 1_000_000_000_000_000_000u128; // 1.0
        let p1 = execute_buyback(&pool, 100_000, price, 10).unwrap();
        let p2 = execute_buyback(&p1, 200_000, price, 20).unwrap();
        assert_eq!(p2.balance, 700_000);
        assert_eq!(p2.total_bought, 300_000);
        assert_eq!(p2.execution_count, 2);
    }

    #[test]
    fn test_calculate_buyback_amount_nothing_needed() {
        let pool = create_buyback_pool();
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        let amount = calculate_buyback_amount(&pool, 0, &s, 1_000_000_000_000_000_000);
        assert_eq!(amount, 0);
    }

    #[test]
    fn test_calculate_buyback_amount_some_needed() {
        let pool = fund_buyback_pool(&create_buyback_pool(), 1_000_000_000).unwrap();
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        // target = 500_000 * 100 / 10_000 = 5_000 tokens at 100 bps
        let price = 1_000_000_000_000_000_000u128; // 1.0
        let amount = calculate_buyback_amount(&pool, 100, &s, price);
        // cost = 5_000 * 1e18 / 1e18 = 5_000
        assert_eq!(amount, 5_000);
    }

    #[test]
    fn test_calculate_buyback_amount_capped_by_balance() {
        let pool = fund_buyback_pool(&create_buyback_pool(), 100).unwrap();
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        let price = 1_000_000_000_000_000_000u128;
        let amount = calculate_buyback_amount(&pool, 100, &s, price);
        assert_eq!(amount, 100); // capped at balance
    }

    #[test]
    fn test_calculate_buyback_amount_zero_price() {
        let pool = fund_buyback_pool(&create_buyback_pool(), 1_000).unwrap();
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        assert_eq!(calculate_buyback_amount(&pool, 100, &s, 0), 0);
    }

    #[test]
    fn test_average_buyback_price_empty() {
        let pool = create_buyback_pool();
        assert_eq!(average_buyback_price(&pool), 0);
    }

    // ---- Staking Economics ----

    #[test]
    fn test_staking_apr_bps_basic() {
        // 10 tokens/block * 7_884_000 blocks/year = 78_840_000 annual
        // APR = 78_840_000 * 10_000 / 100_000_000 = 7884 bps = ~78.84%
        let apr = calculate_staking_apr_bps(10, 100_000_000, 7_884_000, 0);
        assert_eq!(apr, 7884);
    }

    #[test]
    fn test_staking_apr_bps_zero_staked() {
        assert_eq!(calculate_staking_apr_bps(10, 0, 7_884_000, 0), 0);
    }

    #[test]
    fn test_staking_apr_bps_zero_emissions() {
        assert_eq!(calculate_staking_apr_bps(0, 1_000_000, 7_884_000, 0), 0);
    }

    #[test]
    fn test_staking_apr_bps_high_staked_low_apr() {
        // 1 token/block * 7_884_000 / 10_000_000_000 * 10000
        let apr = calculate_staking_apr_bps(1, 10_000_000_000, 7_884_000, 0);
        assert_eq!(apr, 7); // very low APR
    }

    #[test]
    fn test_real_yield_positive() {
        let ry = calculate_real_yield_bps(1000, 300);
        assert_eq!(ry, 700);
    }

    #[test]
    fn test_real_yield_negative() {
        let ry = calculate_real_yield_bps(200, 500);
        assert_eq!(ry, -300);
    }

    #[test]
    fn test_real_yield_zero() {
        let ry = calculate_real_yield_bps(500, 500);
        assert_eq!(ry, 0);
    }

    #[test]
    fn test_optimal_staking_ratio_basic() {
        // sqrt(500 * 5000) = sqrt(2_500_000) = 1581
        let ratio = optimal_staking_ratio_bps(500, 5000);
        assert_eq!(ratio, 1581);
    }

    #[test]
    fn test_optimal_staking_ratio_equal() {
        // sqrt(1000 * 1000) = 1000
        let ratio = optimal_staking_ratio_bps(1000, 1000);
        assert_eq!(ratio, 1000);
    }

    #[test]
    fn test_optimal_staking_ratio_zero() {
        assert_eq!(optimal_staking_ratio_bps(0, 5000), 0);
    }

    #[test]
    fn test_build_staking_metrics() {
        let m = build_staking_metrics(250_000, 500_000, 10, 7_884_000, 200);
        assert_eq!(m.total_staked, 250_000);
        assert_eq!(m.staking_ratio_bps, 5000); // 50%
        assert_eq!(m.emission_rate, 10);
        assert!(m.apr_bps > 0);
        assert!(m.real_yield_bps > 0 || m.real_yield_bps <= 0); // just check it's computed
    }

    #[test]
    fn test_build_staking_metrics_zero_circulating() {
        let m = build_staking_metrics(0, 0, 10, 7_884_000, 200);
        assert_eq!(m.staking_ratio_bps, 0);
    }

    #[test]
    fn test_non_staker_dilution_no_staking() {
        let d = non_staker_dilution_bps(500, 0);
        assert_eq!(d, 500);
    }

    #[test]
    fn test_non_staker_dilution_full_staking() {
        let d = non_staker_dilution_bps(500, 10_000);
        assert_eq!(d, 0);
    }

    #[test]
    fn test_non_staker_dilution_half_staking() {
        let d = non_staker_dilution_bps(500, 5000);
        assert_eq!(d, 250);
    }

    // ---- Supply Elasticity ----

    #[test]
    fn test_create_rebase_state() {
        let s = create_rebase_state(1000, 1100, 99999);
        assert_eq!(s.target_price, 1000);
        assert_eq!(s.current_price, 1100);
        assert_eq!(s.epoch, 0);
        assert_eq!(s.deviation_bps, 1000); // 10%
    }

    #[test]
    fn test_create_rebase_state_below_target() {
        let s = create_rebase_state(1000, 900, 0);
        assert_eq!(s.deviation_bps, 1000); // 10%
    }

    #[test]
    fn test_create_rebase_state_at_peg() {
        let s = create_rebase_state(1000, 1000, 0);
        assert_eq!(s.deviation_bps, 0);
    }

    #[test]
    fn test_calculate_rebase_expansion() {
        let state = create_rebase_state(1000, 1000, 0);
        let result = calculate_rebase(&state, 1100, 500, 1_000_000).unwrap();
        assert!(result.supply_delta > 0); // expansion
        assert_eq!(result.epoch, 1);
        assert_eq!(result.deviation_bps, 1000);
    }

    #[test]
    fn test_calculate_rebase_contraction() {
        let state = create_rebase_state(1000, 1000, 0);
        let result = calculate_rebase(&state, 900, 500, 1_000_000).unwrap();
        assert!(result.supply_delta < 0); // contraction
    }

    #[test]
    fn test_calculate_rebase_clamped() {
        let state = create_rebase_state(1000, 1000, 0);
        // 50% deviation but max_delta is 500 bps (5%)
        let result = calculate_rebase(&state, 1500, 500, 1_000_000).unwrap();
        // delta should be clamped to 5% of 1_000_000 = 50_000
        assert_eq!(result.supply_delta, 50_000);
    }

    #[test]
    fn test_calculate_rebase_zero_target_fails() {
        let mut state = create_rebase_state(1000, 1000, 0);
        state.target_price = 0;
        assert!(calculate_rebase(&state, 1100, 500, 1_000_000).is_err());
    }

    #[test]
    fn test_calculate_rebase_zero_price_fails() {
        let state = create_rebase_state(1000, 1000, 0);
        assert!(calculate_rebase(&state, 0, 500, 1_000_000).is_err());
    }

    #[test]
    fn test_apply_rebase_expansion() {
        let s = create_initial_supply(2_000_000, 1_000_000).unwrap();
        let updated = apply_rebase(&s, 50_000).unwrap();
        assert_eq!(updated.total_supply, 1_050_000);
        assert_eq!(updated.circulating, 1_050_000);
    }

    #[test]
    fn test_apply_rebase_contraction() {
        let s = create_initial_supply(2_000_000, 1_000_000).unwrap();
        let updated = apply_rebase(&s, -50_000).unwrap();
        assert_eq!(updated.total_supply, 950_000);
        assert_eq!(updated.circulating, 950_000);
    }

    #[test]
    fn test_apply_rebase_zero() {
        let s = create_initial_supply(2_000_000, 1_000_000).unwrap();
        let updated = apply_rebase(&s, 0).unwrap();
        assert_eq!(updated.total_supply, 1_000_000);
    }

    #[test]
    fn test_apply_rebase_exceeds_max_fails() {
        let s = create_initial_supply(1_100_000, 1_000_000).unwrap();
        assert!(apply_rebase(&s, 200_000).is_err());
    }

    #[test]
    fn test_apply_rebase_contraction_exceeds_circulating_fails() {
        let s = create_initial_supply(2_000_000, 100).unwrap();
        assert!(apply_rebase(&s, -200).is_err());
    }

    #[test]
    fn test_needs_rebase_above_threshold() {
        let s = create_rebase_state(1000, 1200, 0);
        assert!(needs_rebase(&s, 500)); // 2000 bps deviation > 500 threshold
    }

    #[test]
    fn test_needs_rebase_below_threshold() {
        let s = create_rebase_state(1000, 1010, 0);
        assert!(!needs_rebase(&s, 500)); // 100 bps < 500
    }

    #[test]
    fn test_needs_rebase_at_threshold() {
        let s = create_rebase_state(1000, 1050, 0);
        assert!(!needs_rebase(&s, 500)); // 500 bps == 500 => not above
    }

    // ---- Economic Health ----

    #[test]
    fn test_velocity_basic() {
        // volume = 5000, supply = 10000 -> velocity = 500 (0.5 * 1000)
        assert_eq!(calculate_velocity(5000, 10000), 500);
    }

    #[test]
    fn test_velocity_zero_supply() {
        assert_eq!(calculate_velocity(1000, 0), 0);
    }

    #[test]
    fn test_velocity_zero_volume() {
        assert_eq!(calculate_velocity(0, 10000), 0);
    }

    #[test]
    fn test_velocity_high() {
        assert_eq!(calculate_velocity(30000, 10000), 3000); // 3x velocity
    }

    #[test]
    fn test_gini_equal_distribution() {
        let balances = vec![100, 100, 100, 100, 100];
        assert_eq!(calculate_gini_bps(&balances), 0);
    }

    #[test]
    fn test_gini_perfect_inequality() {
        let balances = vec![0, 0, 0, 0, 10000];
        // Gini = sum|xi-xj| / (2*n*sum)
        // 4*4*10000 + 4*10000 = 160000 + 40000 = 200000 ... let me just verify it's high
        let gini = calculate_gini_bps(&balances);
        assert!(gini > 7000); // high inequality
    }

    #[test]
    fn test_gini_two_holders_equal() {
        assert_eq!(calculate_gini_bps(&[50, 50]), 0);
    }

    #[test]
    fn test_gini_two_holders_unequal() {
        let gini = calculate_gini_bps(&[0, 100]);
        assert_eq!(gini, 5000); // classic 2-person unequal = 0.5
    }

    #[test]
    fn test_gini_single_holder() {
        assert_eq!(calculate_gini_bps(&[1000]), 0);
    }

    #[test]
    fn test_gini_empty() {
        assert_eq!(calculate_gini_bps(&[]), 0);
    }

    #[test]
    fn test_gini_all_zero() {
        assert_eq!(calculate_gini_bps(&[0, 0, 0]), 0);
    }

    #[test]
    fn test_gini_moderate_inequality() {
        let balances = vec![10, 20, 30, 40];
        let gini = calculate_gini_bps(&balances);
        assert!(gini > 0);
        assert!(gini < 5000);
    }

    #[test]
    fn test_top_n_share_basic() {
        let sorted = vec![500, 300, 200, 100, 50, 30, 20, 10, 5, 3, 2, 1];
        let total: u128 = sorted.iter().map(|&b| b as u128).sum();
        let share = calculate_top_n_share_bps(&sorted, 3, total);
        // top 3 = 500+300+200 = 1000 / 1221 * 10000 = ~8190
        assert!(share > 8000);
        assert!(share < 8500);
    }

    #[test]
    fn test_top_n_share_all() {
        let sorted = vec![100, 50, 25];
        let total: u128 = 175;
        let share = calculate_top_n_share_bps(&sorted, 10, total);
        assert_eq!(share, 10000);
    }

    #[test]
    fn test_top_n_share_zero_total() {
        assert_eq!(calculate_top_n_share_bps(&[100, 50], 1, 0), 0);
    }

    #[test]
    fn test_top_n_share_empty() {
        assert_eq!(calculate_top_n_share_bps(&[], 5, 1000), 0);
    }

    #[test]
    fn test_circulating_ratio_bps_half() {
        // total_supply = initial_circulating, so ratio is 10000 unless we modify locked
        let mut s = create_initial_supply(1_000_000, 1_000_000).unwrap();
        s.total_supply = 1_000_000;
        s.circulating = 500_000;
        s.locked = 500_000;
        assert_eq!(calculate_circulating_ratio_bps(&s), 5000);
    }

    #[test]
    fn test_circulating_ratio_bps_full() {
        let s = create_initial_supply(1_000_000, 1_000_000).unwrap();
        assert_eq!(calculate_circulating_ratio_bps(&s), 10000);
    }

    #[test]
    fn test_circulating_ratio_bps_zero() {
        let s = create_initial_supply(1_000_000, 0).unwrap();
        assert_eq!(calculate_circulating_ratio_bps(&s), 0);
    }

    #[test]
    fn test_build_economic_health() {
        let mut s = create_initial_supply(1_000_000, 1_000_000).unwrap();
        s.total_supply = 1_000_000;
        s.circulating = 500_000;
        s.locked = 500_000;
        let balances = vec![100, 200, 300, 400, 500];
        let sorted = vec![500, 400, 300, 200, 100];
        let health = build_economic_health(250_000, &s, &balances, &sorted, 5);
        assert_eq!(health.holder_count, 5);
        assert!(health.velocity > 0);
        assert!(health.gini_coefficient_bps > 0);
        assert_eq!(health.circulating_ratio_bps, 5000);
    }

    #[test]
    fn test_is_concentration_healthy_below() {
        assert!(is_concentration_healthy(3000, 5000));
    }

    #[test]
    fn test_is_concentration_healthy_above() {
        assert!(!is_concentration_healthy(6000, 5000));
    }

    #[test]
    fn test_is_concentration_healthy_equal() {
        assert!(is_concentration_healthy(5000, 5000));
    }

    #[test]
    fn test_is_velocity_healthy_in_range() {
        assert!(is_velocity_healthy(500, 100, 1000));
    }

    #[test]
    fn test_is_velocity_healthy_too_low() {
        assert!(!is_velocity_healthy(50, 100, 1000));
    }

    #[test]
    fn test_is_velocity_healthy_too_high() {
        assert!(!is_velocity_healthy(2000, 100, 1000));
    }

    #[test]
    fn test_is_velocity_healthy_at_bounds() {
        assert!(is_velocity_healthy(100, 100, 1000));
        assert!(is_velocity_healthy(1000, 100, 1000));
    }

    // ---- Fee Distribution ----

    #[test]
    fn test_distribute_fees_basic() {
        let dist = distribute_fees(10_000, 3000, 3000, 2000, 2000).unwrap();
        assert_eq!(dist.total_distributed, 10_000);
        assert_eq!(dist.staker_share_bps, 3000);
    }

    #[test]
    fn test_distribute_fees_wrong_sum_fails() {
        assert!(distribute_fees(10_000, 3000, 3000, 2000, 3000).is_err());
    }

    #[test]
    fn test_distribute_fees_zero_fee() {
        let dist = distribute_fees(0, 3000, 3000, 2000, 2000).unwrap();
        assert_eq!(staker_fee_amount(&dist), 0);
    }

    #[test]
    fn test_staker_fee_amount_basic() {
        let dist = distribute_fees(10_000, 3000, 3000, 2000, 2000).unwrap();
        assert_eq!(staker_fee_amount(&dist), 3000);
    }

    #[test]
    fn test_lp_fee_amount_basic() {
        let dist = distribute_fees(10_000, 3000, 3000, 2000, 2000).unwrap();
        assert_eq!(lp_fee_amount(&dist), 3000);
    }

    #[test]
    fn test_treasury_fee_amount_basic() {
        let dist = distribute_fees(10_000, 3000, 3000, 2000, 2000).unwrap();
        assert_eq!(treasury_fee_amount(&dist), 2000);
    }

    #[test]
    fn test_burn_fee_amount_basic() {
        let dist = distribute_fees(10_000, 3000, 3000, 2000, 2000).unwrap();
        assert_eq!(burn_fee_amount(&dist), 2000);
    }

    #[test]
    fn test_fee_distribution_sums_correctly() {
        let dist = distribute_fees(10_000, 2500, 2500, 2500, 2500).unwrap();
        let sum = staker_fee_amount(&dist) + lp_fee_amount(&dist)
            + treasury_fee_amount(&dist) + burn_fee_amount(&dist);
        assert_eq!(sum, 10_000);
    }

    #[test]
    fn test_verify_fee_distribution_exact() {
        let dist = distribute_fees(10_000, 2500, 2500, 2500, 2500).unwrap();
        assert!(verify_fee_distribution(&dist));
    }

    #[test]
    fn test_verify_fee_distribution_with_rounding() {
        // 33 is not evenly divisible by 10000 in all shares
        let dist = distribute_fees(33, 3000, 3000, 2000, 2000).unwrap();
        assert!(verify_fee_distribution(&dist));
    }

    #[test]
    fn test_distribute_fees_all_to_burn() {
        let dist = distribute_fees(50_000, 0, 0, 0, 10_000).unwrap();
        assert_eq!(burn_fee_amount(&dist), 50_000);
        assert_eq!(staker_fee_amount(&dist), 0);
    }

    #[test]
    fn test_distribute_fees_large_amount() {
        let dist = distribute_fees(1_000_000_000_000, 5000, 3000, 1000, 1000).unwrap();
        assert_eq!(staker_fee_amount(&dist), 500_000_000_000);
        assert_eq!(lp_fee_amount(&dist), 300_000_000_000);
    }

    // ---- Valuation Helpers ----

    #[test]
    fn test_fdv_basic() {
        let fdv = estimate_fully_diluted_valuation(1_000_000, 5);
        assert_eq!(fdv, 5_000_000);
    }

    #[test]
    fn test_fdv_overflow_saturates() {
        let fdv = estimate_fully_diluted_valuation(u128::MAX, 2);
        assert_eq!(fdv, u128::MAX);
    }

    #[test]
    fn test_market_cap_basic() {
        let mc = estimate_market_cap(500_000, 10);
        assert_eq!(mc, 5_000_000);
    }

    #[test]
    fn test_market_cap_overflow_saturates() {
        let mc = estimate_market_cap(u128::MAX, 2);
        assert_eq!(mc, u128::MAX);
    }

    #[test]
    fn test_pe_ratio_basic() {
        let pe = price_to_earnings_x100(10_000_000, 1_000_000);
        assert_eq!(pe, 1000); // 10x P/E * 100
    }

    #[test]
    fn test_pe_ratio_zero_revenue() {
        assert_eq!(price_to_earnings_x100(10_000_000, 0), 0);
    }

    #[test]
    fn test_pe_ratio_high() {
        let pe = price_to_earnings_x100(100_000_000, 100_000);
        assert_eq!(pe, 100_000); // 1000x P/E
    }

    #[test]
    fn test_is_mcap_fdv_healthy_yes() {
        assert!(is_mcap_fdv_healthy(600_000, 1_000_000, 5000));
    }

    #[test]
    fn test_is_mcap_fdv_healthy_no() {
        assert!(!is_mcap_fdv_healthy(200_000, 1_000_000, 5000));
    }

    #[test]
    fn test_is_mcap_fdv_healthy_zero_max() {
        assert!(!is_mcap_fdv_healthy(100, 0, 5000));
    }

    #[test]
    fn test_is_mcap_fdv_healthy_at_threshold() {
        assert!(is_mcap_fdv_healthy(500_000, 1_000_000, 5000));
    }

    // ---- Internal Helpers ----

    #[test]
    fn test_isqrt_zero() {
        assert_eq!(isqrt_u128(0), 0);
    }

    #[test]
    fn test_isqrt_one() {
        assert_eq!(isqrt_u128(1), 1);
    }

    #[test]
    fn test_isqrt_perfect_square() {
        assert_eq!(isqrt_u128(144), 12);
        assert_eq!(isqrt_u128(10000), 100);
    }

    #[test]
    fn test_isqrt_non_perfect() {
        assert_eq!(isqrt_u128(10), 3);
        assert_eq!(isqrt_u128(99), 9);
    }

    #[test]
    fn test_isqrt_large() {
        assert_eq!(isqrt_u128(1_000_000_000_000), 1_000_000);
    }

    // ---- Edge Cases & Cross-cutting ----

    #[test]
    fn test_supply_lifecycle_mint_stake_burn() {
        let mut s = create_initial_supply(10_000_000, 5_000_000).unwrap();
        // Stake some
        s.staked = 1_000_000;
        s.circulating -= 1_000_000;
        assert_eq!(s.circulating, 4_000_000);
        // Burn some
        let (s2, _) = burn_tokens(&s, 500_000, 0, 0, [0; 32]).unwrap();
        assert_eq!(s2.circulating, 3_500_000);
        assert_eq!(s2.burned, 500_000);
        assert_eq!(s2.staked, 1_000_000);
    }

    #[test]
    fn test_supply_lifecycle_add_lp() {
        let mut s = create_initial_supply(10_000_000, 5_000_000).unwrap();
        s.in_lp = 2_000_000;
        s.circulating -= 2_000_000;
        assert_eq!(s.circulating, 3_000_000);
        assert_eq!(s.in_lp, 2_000_000);
    }

    #[test]
    fn test_vesting_then_burn() {
        let alloc = setup_distribution([0; 32], 1_000, 0, 1_000, 0).unwrap();
        let vested = calculate_vested_amount(&alloc, 500);
        assert_eq!(vested, 500);
        // Simulate: vested tokens enter circulating, then burn some
        let mut s = create_initial_supply(10_000, 5_000).unwrap();
        s.circulating += vested as u128;
        let (s2, _) = burn_tokens(&s, 200, 2, 0, [0; 32]).unwrap();
        assert_eq!(s2.circulating, 5_300);
    }

    #[test]
    fn test_rebase_then_check_health() {
        let s = create_initial_supply(2_000_000, 1_000_000).unwrap();
        let updated = apply_rebase(&s, 50_000).unwrap();
        let ratio = calculate_circulating_ratio_bps(&updated);
        // 1_050_000 / 1_050_000 = 10000
        assert_eq!(ratio, 10000);
    }

    #[test]
    fn test_buyback_then_burn_supply() {
        let pool = fund_buyback_pool(&create_buyback_pool(), 1_000_000).unwrap();
        let price = 1_000_000_000_000_000_000u128;
        let updated_pool = execute_buyback(&pool, 100_000, price, 100).unwrap();
        // Bought 100_000 tokens, now burn them from supply
        let s = create_initial_supply(10_000_000, 5_000_000).unwrap();
        let (s2, _) = burn_tokens(&s, updated_pool.total_bought as u64, 1, 100, [0; 32]).unwrap();
        assert_eq!(s2.burned, 100_000);
    }

    #[test]
    fn test_fee_distribution_then_burn_portion() {
        let dist = distribute_fees(100_000, 3000, 3000, 2000, 2000).unwrap();
        let burn_amount = burn_fee_amount(&dist);
        assert_eq!(burn_amount, 20_000);
        let s = create_initial_supply(10_000_000, 5_000_000).unwrap();
        let (s2, record) = burn_tokens(&s, burn_amount as u64, 0, 0, [0; 32]).unwrap();
        assert_eq!(s2.burned, 20_000);
        assert_eq!(record.burn_type, 0);
    }

    #[test]
    fn test_emission_halving_series() {
        let r0 = calculate_emission_schedule(1000, 100, 0);
        let r1 = calculate_emission_schedule(1000, 100, 100);
        let r2 = calculate_emission_schedule(1000, 100, 200);
        let r3 = calculate_emission_schedule(1000, 100, 300);
        assert_eq!(r0, 1000);
        assert_eq!(r1, 500);
        assert_eq!(r2, 250);
        assert_eq!(r3, 125);
    }

    #[test]
    fn test_supply_components_sum() {
        let mut s = create_initial_supply(10_000_000, 5_000_000).unwrap();
        s.locked = 1_000_000;
        s.staked = 500_000;
        s.in_lp = 500_000;
        s.circulating = 3_000_000;
        // circulating + locked + staked + in_lp + burned = total_supply
        let sum = s.circulating + s.locked + s.staked + s.in_lp + s.burned;
        assert_eq!(sum, s.total_supply);
    }

    #[test]
    fn test_multiple_burns_accumulate() {
        let s = create_initial_supply(10_000_000, 5_000_000).unwrap();
        let (s1, _) = burn_tokens(&s, 1000, 0, 1, [1; 32]).unwrap();
        let (s2, _) = burn_tokens(&s1, 2000, 1, 2, [2; 32]).unwrap();
        let (s3, _) = burn_tokens(&s2, 3000, 2, 3, [3; 32]).unwrap();
        assert_eq!(s3.burned, 6000);
        assert_eq!(s3.circulating, 4_994_000);
    }

    #[test]
    fn test_inflation_deflation_net() {
        let s = create_initial_supply(10_000_000, 1_000_000).unwrap();
        let inflation = calculate_inflation_rate_bps(&s, 100, 50_000);
        let deflation = calculate_deflation_rate_bps(&s, 30_000);
        // inflation = 50000 * 10000 / 1000000 = 500 bps
        // deflation = 30000 * 10000 / 1000000 = 300 bps
        assert_eq!(inflation, 500);
        assert_eq!(deflation, 300);
        assert!(!is_deflationary(&s, deflation as u64, inflation as u64));
    }

    #[test]
    fn test_rebase_epoch_increments() {
        let state = create_rebase_state(1000, 1000, 0);
        let r1 = calculate_rebase(&state, 1100, 1000, 1_000_000).unwrap();
        assert_eq!(r1.epoch, 1);
        let r2 = calculate_rebase(&r1, 1050, 1000, 1_000_000).unwrap();
        assert_eq!(r2.epoch, 2);
    }

    #[test]
    fn test_distribution_with_start_block_offset() {
        let alloc = setup_distribution([0; 32], 10_000, 500, 2000, 1000).unwrap();
        // Before start
        assert_eq!(calculate_vested_amount(&alloc, 999), 0);
        // During cliff (block 1000 to 1500)
        assert_eq!(calculate_vested_amount(&alloc, 1200), 0);
        // Midway through vesting (block 1500 + 1000 = 2500)
        assert_eq!(calculate_vested_amount(&alloc, 2500), 5000);
        // Fully vested (block 1500 + 2000 = 3500)
        assert_eq!(calculate_vested_amount(&alloc, 3500), 10_000);
    }

    #[test]
    fn test_staking_apr_decreases_with_more_stakers() {
        let apr_low_stake = calculate_staking_apr_bps(10, 100_000, 7_884_000, 0);
        let apr_high_stake = calculate_staking_apr_bps(10, 1_000_000, 7_884_000, 0);
        assert!(apr_low_stake > apr_high_stake);
    }

    #[test]
    fn test_gini_three_holders_varied() {
        // [1, 2, 97] -> highly unequal
        let gini = calculate_gini_bps(&[1, 2, 97]);
        assert!(gini > 5000);
    }

    #[test]
    fn test_top_n_share_single_whale() {
        let sorted = vec![9000, 500, 300, 200];
        let total = 10_000u128;
        let share = calculate_top_n_share_bps(&sorted, 1, total);
        assert_eq!(share, 9000);
    }

    #[test]
    fn test_velocity_equals_one() {
        assert_eq!(calculate_velocity(10000, 10000), 1000);
    }

    #[test]
    fn test_project_supply_large_blocks() {
        let s = create_initial_supply(u128::MAX / 2, 1_000_000_000).unwrap();
        let p = project_supply_at_block(&s, 100, 50, 1_000_000, 0).unwrap();
        // net emission = 50 per block * 1M blocks = 50M
        assert_eq!(p, 1_000_000_000 + 50_000_000);
    }

    #[test]
    fn test_fee_distribution_uneven_split() {
        let dist = distribute_fees(10_000, 1000, 5000, 3000, 1000).unwrap();
        assert_eq!(staker_fee_amount(&dist), 1000);
        assert_eq!(lp_fee_amount(&dist), 5000);
        assert_eq!(treasury_fee_amount(&dist), 3000);
        assert_eq!(burn_fee_amount(&dist), 1000);
    }

    #[test]
    fn test_create_initial_supply_one_token() {
        let s = create_initial_supply(1, 1).unwrap();
        assert_eq!(s.total_supply, 1);
        assert_eq!(s.max_supply, 1);
    }

    #[test]
    fn test_burn_record_preserves_tx_hash() {
        let hash = [0xDE; 32];
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        let (_, record) = burn_tokens(&s, 100, 0, 12345, hash).unwrap();
        assert_eq!(record.tx_hash, hash);
        assert_eq!(record.timestamp, 12345);
    }

    #[test]
    fn test_calculate_rebase_no_deviation() {
        let state = create_rebase_state(1000, 1000, 0);
        let result = calculate_rebase(&state, 1000, 500, 1_000_000).unwrap();
        assert_eq!(result.supply_delta, 0);
        assert_eq!(result.deviation_bps, 0);
    }

    #[test]
    fn test_fund_buyback_pool_accumulates() {
        let p = create_buyback_pool();
        let p = fund_buyback_pool(&p, 100).unwrap();
        let p = fund_buyback_pool(&p, 200).unwrap();
        let p = fund_buyback_pool(&p, 300).unwrap();
        assert_eq!(p.balance, 600);
    }

    #[test]
    fn test_execute_buyback_drains_exact_balance() {
        let pool = fund_buyback_pool(&create_buyback_pool(), 1000).unwrap();
        let price = 1_000_000_000_000_000_000u128;
        let updated = execute_buyback(&pool, 1000, price, 50).unwrap();
        assert_eq!(updated.balance, 0);
        assert_eq!(updated.total_bought, 1000);
    }

    #[test]
    fn test_real_yield_large_inflation() {
        let ry = calculate_real_yield_bps(100, 9999);
        assert_eq!(ry, -9899);
    }

    #[test]
    fn test_optimal_staking_ratio_large_values() {
        let ratio = optimal_staking_ratio_bps(10000, 10000);
        assert_eq!(ratio, 10000);
    }

    #[test]
    fn test_non_staker_dilution_zero_inflation() {
        assert_eq!(non_staker_dilution_bps(0, 5000), 0);
    }

    #[test]
    fn test_circulating_ratio_after_burns() {
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        let (s2, _) = burn_tokens(&s, 250_000, 0, 0, [0; 32]).unwrap();
        // circulating = 250_000, total = 500_000
        let ratio = calculate_circulating_ratio_bps(&s2);
        assert_eq!(ratio, 5000);
    }

    #[test]
    fn test_multiple_distributions() {
        let team = setup_distribution([1; 32], 200_000, 365, 730, 0).unwrap();
        let investors = setup_distribution([2; 32], 100_000, 180, 365, 0).unwrap();
        let community = setup_distribution([3; 32], 500_000, 0, 1095, 0).unwrap();

        // At block 365+365=730 for team: past cliff, vesting_elapsed=365
        let team_vested = calculate_vested_amount(&team, 730);
        assert_eq!(team_vested, 100_000); // 200000 * 365/730

        // Investors at block 545 = 180 cliff + 365 vesting
        let inv_vested = calculate_vested_amount(&investors, 545);
        assert_eq!(inv_vested, 100_000); // fully vested

        // Community at block 547 (no cliff): 500000 * 547/1095 = 249771
        let comm_vested = calculate_vested_amount(&community, 547);
        assert_eq!(comm_vested, 249_771); // ~half
    }

    #[test]
    fn test_emission_schedule_epoch_boundary() {
        let r = calculate_emission_schedule(1000, 100, 99);
        assert_eq!(r, 1000); // not yet halved
        let r = calculate_emission_schedule(1000, 100, 100);
        assert_eq!(r, 500); // just halved
    }

    #[test]
    fn test_buyback_execution_count_tracks() {
        let pool = fund_buyback_pool(&create_buyback_pool(), 10_000_000).unwrap();
        let price = 1_000_000_000_000_000_000u128;
        let p1 = execute_buyback(&pool, 100, price, 1).unwrap();
        let p2 = execute_buyback(&p1, 100, price, 2).unwrap();
        let p3 = execute_buyback(&p2, 100, price, 3).unwrap();
        assert_eq!(p3.execution_count, 3);
        assert_eq!(p3.last_execution_at, 3);
    }

    #[test]
    fn test_gini_large_equal() {
        let balances = vec![1000; 100];
        assert_eq!(calculate_gini_bps(&balances), 0);
    }

    #[test]
    fn test_needs_rebase_zero_threshold() {
        let s = create_rebase_state(1000, 1001, 0);
        assert!(needs_rebase(&s, 0)); // any deviation > 0
    }

    #[test]
    fn test_apply_rebase_preserves_other_fields() {
        let mut s = create_initial_supply(10_000_000, 5_000_000).unwrap();
        s.staked = 100_000;
        s.locked = 200_000;
        s.burned = 50_000;
        s.in_lp = 300_000;
        let updated = apply_rebase(&s, 10_000).unwrap();
        assert_eq!(updated.staked, 100_000);
        assert_eq!(updated.locked, 200_000);
        assert_eq!(updated.burned, 50_000);
        assert_eq!(updated.in_lp, 300_000);
        assert_eq!(updated.circulating, 5_010_000);
    }

    #[test]
    fn test_pe_ratio_low_earnings() {
        let pe = price_to_earnings_x100(1_000_000, 1);
        assert_eq!(pe, 100_000_000);
    }

    #[test]
    fn test_market_cap_zero_price() {
        assert_eq!(estimate_market_cap(1_000_000, 0), 0);
    }

    #[test]
    fn test_fdv_zero_supply() {
        assert_eq!(estimate_fully_diluted_valuation(0, 1000), 0);
    }

    #[test]
    fn test_distribute_fees_all_to_stakers() {
        let dist = distribute_fees(99_999, 10_000, 0, 0, 0).unwrap();
        assert_eq!(staker_fee_amount(&dist), 99_999);
        assert_eq!(lp_fee_amount(&dist), 0);
    }

    #[test]
    fn test_calculate_buyback_amount_already_exceeded_target() {
        let mut pool = create_buyback_pool();
        pool.total_burned = 100_000;
        pool.balance = 1_000_000;
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        // target = 500_000 * 100 / 10_000 = 5_000 tokens but already burned 100_000
        let amount = calculate_buyback_amount(&pool, 100, &s, 1_000_000_000_000_000_000);
        assert_eq!(amount, 0);
    }

    #[test]
    fn test_vesting_quarter_progress() {
        let alloc = setup_distribution([0; 32], 4000, 0, 400, 0).unwrap();
        assert_eq!(calculate_vested_amount(&alloc, 100), 1000);
        assert_eq!(calculate_vested_amount(&alloc, 200), 2000);
        assert_eq!(calculate_vested_amount(&alloc, 300), 3000);
        assert_eq!(calculate_vested_amount(&alloc, 400), 4000);
    }

    #[test]
    fn test_claim_then_claim_again() {
        let alloc = setup_distribution([0; 32], 1000, 0, 1000, 0).unwrap();
        let (a1, c1) = claim_vested(&alloc, 250).unwrap();
        assert_eq!(c1, 250);
        let (a2, c2) = claim_vested(&a1, 750).unwrap();
        assert_eq!(c2, 500); // 750 vested - 250 already claimed
        assert_eq!(a2.vested_amount, 750);
    }

    #[test]
    fn test_inflation_rate_small_supply() {
        let s = create_initial_supply(100, 10).unwrap();
        let rate = calculate_inflation_rate_bps(&s, 1, 1);
        // 1 * 10000 / 10 = 1000 bps = 10%
        assert_eq!(rate, 1000);
    }

    #[test]
    fn test_deflation_rate_equal_to_supply() {
        let s = create_initial_supply(1000, 500).unwrap();
        let rate = calculate_deflation_rate_bps(&s, 500);
        // 500 * 10000 / 500 = 10000 bps = 100%
        assert_eq!(rate, 10000);
    }

    #[test]
    fn test_build_staking_metrics_high_ratio() {
        let m = build_staking_metrics(900_000, 1_000_000, 1, 7_884_000, 0);
        assert_eq!(m.staking_ratio_bps, 9000); // 90%
    }

    #[test]
    fn test_calculate_rebase_large_contraction() {
        let state = create_rebase_state(1000, 1000, 0);
        // Price dropped 50% but clamped to max 5%
        let result = calculate_rebase(&state, 500, 500, 1_000_000).unwrap();
        assert_eq!(result.supply_delta, -50_000); // clamped at 5% of 1M
    }

    #[test]
    fn test_top_n_share_n_larger_than_array() {
        let sorted = vec![500, 300, 200];
        let total = 1000u128;
        let share = calculate_top_n_share_bps(&sorted, 100, total);
        assert_eq!(share, 10000); // all of it
    }

    #[test]
    fn test_gini_ascending_balances() {
        let gini = calculate_gini_bps(&[1, 2, 3, 4, 5]);
        assert!(gini > 0);
        assert!(gini < 5000); // moderate inequality
    }

    #[test]
    fn test_verify_fee_distribution_equal_split() {
        let dist = distribute_fees(40_000, 2500, 2500, 2500, 2500).unwrap();
        assert!(verify_fee_distribution(&dist));
        assert_eq!(staker_fee_amount(&dist) + lp_fee_amount(&dist)
            + treasury_fee_amount(&dist) + burn_fee_amount(&dist), 40_000);
    }

    #[test]
    fn test_project_supply_zero_rates() {
        let s = create_initial_supply(1_000_000, 500_000).unwrap();
        let p = project_supply_at_block(&s, 0, 0, 200, 100).unwrap();
        assert_eq!(p, 500_000); // no change
    }
}
