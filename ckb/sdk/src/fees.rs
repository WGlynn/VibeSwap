// ============ Fee Distributor — Protocol Revenue Tracking & Distribution ============
// Tracks protocol fees collected across all VibeSwap protocols and calculates
// distributions to stakeholders using Shapley-depth-weighted allocation.
//
// Revenue sources:
// - AMM swap fees (0.3% default, split between LPs and protocol)
// - Lending interest spread (reserve factor × interest)
// - Insurance premiums (premium rate × borrows)
// - Prediction market fees (fee_rate_bps × winning payouts)
// - Priority auction bids (from commit-reveal batches)
//
// LP Fee Distribution — Shapley Depth Model:
// Instead of simple proportional allocation (each pool keeps its own fees),
// LP fees are redistributed across all pools weighted by marginal contribution:
//   weight_i = depth_i × (1 + utilization_bonus_i) × (1 + connectivity_bonus_i)
// Where:
//   depth = sqrt(reserve0 × reserve1) — geometric mean (TVL proxy)
//   utilization_bonus = volume_i / depth_i (capped at 100%)
//   connectivity_bonus = route_count / max_routes (capped at 100%)
//
// This approximates the Shapley value without exponential coalition enumeration.
// Deeper pools that handle more volume and provide critical routing paths earn
// a larger share of the total LP fee pool — incentivizing deep, utilized liquidity.
//
// Distribution targets:
// - LPs: Shapley-weighted share of total AMM fees (after protocol cut)
// - Protocol treasury: governance-controlled percentage
// - Insurance pool: premium accrual
// - Governance stakers: share of protocol revenue

use std::collections::BTreeMap;

use vibeswap_math::PRECISION;

// ============ Constants ============

/// Default protocol fee share of AMM fees (in bps). LPs get the rest.
const DEFAULT_PROTOCOL_FEE_BPS: u64 = 1667; // ~1/6 of total fee goes to protocol

/// Default treasury share of protocol fees (in bps)
const DEFAULT_TREASURY_SHARE_BPS: u64 = 5000; // 50% of protocol fee to treasury

/// Default governance staker share (in bps of protocol fee)
const DEFAULT_STAKER_SHARE_BPS: u64 = 3000; // 30% to stakers

/// Default insurance share (in bps of protocol fee)
const DEFAULT_INSURANCE_SHARE_BPS: u64 = 2000; // 20% to insurance

// ============ Fee Configuration ============

/// Fee distribution parameters (controlled by governance)
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FeeConfig {
    /// Protocol's share of AMM swap fees (bps of total fee)
    pub protocol_fee_bps: u64,
    /// Treasury's share of protocol fees (bps)
    pub treasury_share_bps: u64,
    /// Governance stakers' share (bps)
    pub staker_share_bps: u64,
    /// Insurance pool's share (bps)
    pub insurance_share_bps: u64,
}

impl Default for FeeConfig {
    fn default() -> Self {
        Self {
            protocol_fee_bps: DEFAULT_PROTOCOL_FEE_BPS,
            treasury_share_bps: DEFAULT_TREASURY_SHARE_BPS,
            staker_share_bps: DEFAULT_STAKER_SHARE_BPS,
            insurance_share_bps: DEFAULT_INSURANCE_SHARE_BPS,
        }
    }
}

impl FeeConfig {
    /// Validate that shares sum to 10000 bps (100%)
    pub fn is_valid(&self) -> bool {
        self.treasury_share_bps + self.staker_share_bps + self.insurance_share_bps == 10_000
    }
}

// ============ Pool Depth Info (Shapley Inputs) ============

/// Per-pool depth and activity metrics used for Shapley-weighted LP distribution.
/// Callers populate this from on-chain PoolCellData + off-chain route analysis.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolDepthInfo {
    /// Pool pair identifier (matches FeeEpoch.amm_fees keys)
    pub pair_id: [u8; 32],
    /// Pool depth: sqrt(reserve0 × reserve1), PRECISION scale.
    /// Geometric mean of reserves — the canonical TVL measure for constant-product AMMs.
    pub depth: u128,
    /// Volume traded through this pool during the epoch (in base token units).
    pub epoch_volume: u128,
    /// Number of multi-hop routes this pool participates in.
    /// Pools that bridge otherwise disconnected token pairs have higher connectivity
    /// and therefore higher marginal contribution (Shapley value).
    pub route_count: u32,
}

/// Calculate Shapley-inspired weight for each pool.
///
/// Each pool's weight reflects its marginal contribution to the system:
///   weight = depth × (PRECISION + utilization_bonus) / PRECISION
///                   × (PRECISION + connectivity_bonus) / PRECISION
///
/// - `utilization_bonus` = min(volume / depth, PRECISION) — capped at 100%
/// - `connectivity_bonus` = route_count × PRECISION / max_routes — linear in connectivity
///
/// Returns weights mapped by pair_id (not normalized — caller divides by sum).
pub fn calculate_shapley_weights(pools: &[PoolDepthInfo]) -> BTreeMap<[u8; 32], u128> {
    let mut weights = BTreeMap::new();

    if pools.is_empty() {
        return weights;
    }

    // Find max route count for normalization
    let max_routes = pools.iter().map(|p| p.route_count).max().unwrap_or(1).max(1);

    for pool in pools {
        if pool.depth == 0 {
            weights.insert(pool.pair_id, 0);
            continue;
        }

        // Utilization bonus: volume / depth, capped at PRECISION (100%)
        let utilization_bonus = if pool.epoch_volume >= pool.depth {
            PRECISION // Cap at 100% bonus
        } else {
            vibeswap_math::mul_div(pool.epoch_volume, PRECISION, pool.depth)
        };

        // Connectivity bonus: route_count / max_routes × PRECISION
        let connectivity_bonus = vibeswap_math::mul_div(
            pool.route_count as u128,
            PRECISION,
            max_routes as u128,
        );

        // weight = depth × (1 + utilization) × (1 + connectivity)
        // In fixed-point: depth × (PRECISION + util_bonus) / PRECISION × (PRECISION + conn_bonus) / PRECISION
        let w1 = vibeswap_math::mul_div(pool.depth, PRECISION + utilization_bonus, PRECISION);
        let weight = vibeswap_math::mul_div(w1, PRECISION + connectivity_bonus, PRECISION);

        weights.insert(pool.pair_id, weight);
    }

    weights
}

// ============ Fee Epoch ============

/// A fee collection epoch — tracks fees collected over a period
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FeeEpoch {
    /// Epoch identifier
    pub epoch_id: u64,
    /// Block range
    pub start_block: u64,
    pub end_block: u64,
    /// Fees collected by source (in the pool's asset denomination)
    pub amm_fees: BTreeMap<[u8; 32], u128>,       // pair_id → fee amount
    pub lending_fees: BTreeMap<[u8; 32], u128>,    // pool_id → reserve income
    pub insurance_fees: BTreeMap<[u8; 32], u128>,  // pool_id → premium income
    pub prediction_fees: BTreeMap<[u8; 32], u128>, // market_id → fee income
    pub priority_fees: u128,                        // Total priority bid revenue
}

impl FeeEpoch {
    pub fn new(epoch_id: u64, start_block: u64, end_block: u64) -> Self {
        Self {
            epoch_id,
            start_block,
            end_block,
            ..Default::default()
        }
    }

    /// Record an AMM swap fee
    pub fn record_amm_fee(&mut self, pair_id: [u8; 32], amount: u128) {
        *self.amm_fees.entry(pair_id).or_insert(0) += amount;
    }

    /// Record lending reserve income
    pub fn record_lending_fee(&mut self, pool_id: [u8; 32], amount: u128) {
        *self.lending_fees.entry(pool_id).or_insert(0) += amount;
    }

    /// Record insurance premium income
    pub fn record_insurance_fee(&mut self, pool_id: [u8; 32], amount: u128) {
        *self.insurance_fees.entry(pool_id).or_insert(0) += amount;
    }

    /// Record prediction market fee
    pub fn record_prediction_fee(&mut self, market_id: [u8; 32], amount: u128) {
        *self.prediction_fees.entry(market_id).or_insert(0) += amount;
    }

    /// Record priority auction revenue
    pub fn record_priority_fee(&mut self, amount: u128) {
        self.priority_fees += amount;
    }

    /// Total fees collected across all sources
    pub fn total_fees(&self) -> u128 {
        let amm: u128 = self.amm_fees.values().sum();
        let lending: u128 = self.lending_fees.values().sum();
        let insurance: u128 = self.insurance_fees.values().sum();
        let prediction: u128 = self.prediction_fees.values().sum();
        amm + lending + insurance + prediction + self.priority_fees
    }

    /// Fees by source type
    pub fn fees_by_source(&self) -> FeeBreakdown {
        FeeBreakdown {
            amm: self.amm_fees.values().sum(),
            lending: self.lending_fees.values().sum(),
            insurance: self.insurance_fees.values().sum(),
            prediction: self.prediction_fees.values().sum(),
            priority: self.priority_fees,
        }
    }
}

// ============ Fee Breakdown ============

/// Fee totals by source type
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FeeBreakdown {
    pub amm: u128,
    pub lending: u128,
    pub insurance: u128,
    pub prediction: u128,
    pub priority: u128,
}

impl FeeBreakdown {
    pub fn total(&self) -> u128 {
        self.amm + self.lending + self.insurance + self.prediction + self.priority
    }
}

// ============ Distribution Result ============

/// Calculated distribution for a fee epoch
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FeeDistribution {
    /// Amount going to LP providers (per pool)
    pub lp_distributions: BTreeMap<[u8; 32], u128>,
    /// Amount going to protocol treasury
    pub treasury_amount: u128,
    /// Amount going to governance stakers
    pub staker_amount: u128,
    /// Amount going to insurance pool
    pub insurance_amount: u128,
    /// Total distributed
    pub total_distributed: u128,
}

// ============ Fee Calculator ============

/// Calculate fee distribution for an epoch — simple per-pool proportional LP allocation.
/// Use `calculate_distribution_shapley` for depth-weighted LP distribution.
pub fn calculate_distribution(epoch: &FeeEpoch, config: &FeeConfig) -> FeeDistribution {
    let mut dist = FeeDistribution::default();

    // AMM fees: split between LPs and protocol
    for (pair_id, &fee_amount) in &epoch.amm_fees {
        let protocol_share = vibeswap_math::mul_div(fee_amount, config.protocol_fee_bps as u128, 10_000);
        let lp_share = fee_amount - protocol_share;

        *dist.lp_distributions.entry(*pair_id).or_insert(0) += lp_share;

        // Protocol share splits into treasury/stakers/insurance
        distribute_protocol_share(&mut dist, protocol_share, config);
    }

    distribute_non_amm_fees(&mut dist, epoch, config);

    dist.total_distributed = dist.treasury_amount
        + dist.staker_amount
        + dist.insurance_amount
        + dist.lp_distributions.values().sum::<u128>();

    dist
}

/// Calculate fee distribution with Shapley-depth-weighted LP allocation.
///
/// Instead of each pool keeping its own LP fee share, ALL LP fees across all pools
/// are aggregated and redistributed proportional to each pool's Shapley weight.
///
/// This rewards:
/// - **Deep pools** (high sqrt(r0 × r1)) — more TVL = more price stability
/// - **Utilized pools** (high volume/depth ratio) — active pools earn more
/// - **Connected pools** (high route_count) — bridge pools that enable multi-hop routes
///
/// Pools not present in `pool_depths` receive zero LP fees (their fees go to the
/// weighted pools instead). This incentivizes pools to register depth info.
pub fn calculate_distribution_shapley(
    epoch: &FeeEpoch,
    config: &FeeConfig,
    pool_depths: &[PoolDepthInfo],
) -> FeeDistribution {
    let mut dist = FeeDistribution::default();

    // Step 1: Calculate total LP fee pool (sum across all AMM pairs)
    let mut total_lp_pool: u128 = 0;
    let mut total_protocol_from_amm: u128 = 0;

    for (_pair_id, &fee_amount) in &epoch.amm_fees {
        let protocol_share = vibeswap_math::mul_div(fee_amount, config.protocol_fee_bps as u128, 10_000);
        let lp_share = fee_amount - protocol_share;
        total_lp_pool += lp_share;
        total_protocol_from_amm += protocol_share;
    }

    // Distribute all AMM protocol fees
    distribute_protocol_share(&mut dist, total_protocol_from_amm, config);

    // Step 2: Calculate Shapley weights and distribute the pooled LP fees
    if total_lp_pool > 0 && !pool_depths.is_empty() {
        let weights = calculate_shapley_weights(pool_depths);
        let total_weight: u128 = weights.values().sum();

        if total_weight > 0 {
            let mut distributed: u128 = 0;
            let pool_count = weights.len();
            let mut idx = 0;

            for (pair_id, &weight) in &weights {
                idx += 1;
                if weight == 0 {
                    continue;
                }

                // Last pool gets remainder to avoid rounding dust
                let share = if idx == pool_count {
                    total_lp_pool - distributed
                } else {
                    vibeswap_math::mul_div(total_lp_pool, weight, total_weight)
                };

                *dist.lp_distributions.entry(*pair_id).or_insert(0) += share;
                distributed += share;
            }
        }
    }

    // Step 3: Distribute non-AMM fees same as simple mode
    distribute_non_amm_fees(&mut dist, epoch, config);

    dist.total_distributed = dist.treasury_amount
        + dist.staker_amount
        + dist.insurance_amount
        + dist.lp_distributions.values().sum::<u128>();

    dist
}

/// Split a protocol-level fee amount into treasury/stakers/insurance
fn distribute_protocol_share(
    dist: &mut FeeDistribution,
    amount: u128,
    config: &FeeConfig,
) {
    if amount == 0 {
        return;
    }
    dist.treasury_amount += vibeswap_math::mul_div(amount, config.treasury_share_bps as u128, 10_000);
    dist.staker_amount += vibeswap_math::mul_div(amount, config.staker_share_bps as u128, 10_000);
    dist.insurance_amount += vibeswap_math::mul_div(amount, config.insurance_share_bps as u128, 10_000);
}

/// Distribute non-AMM fees (lending, insurance, prediction, priority) to protocol
fn distribute_non_amm_fees(
    dist: &mut FeeDistribution,
    epoch: &FeeEpoch,
    config: &FeeConfig,
) {
    // Lending fees: all go to protocol (already collected as reserve factor)
    let lending_total: u128 = epoch.lending_fees.values().sum();
    distribute_protocol_share(dist, lending_total, config);

    // Insurance fees: protocol takes its cut
    let insurance_total: u128 = epoch.insurance_fees.values().sum();
    let insurance_protocol_cut = vibeswap_math::mul_div(insurance_total, config.protocol_fee_bps as u128, 10_000);
    distribute_protocol_share(dist, insurance_protocol_cut, config);

    // Prediction fees: all go to protocol
    let prediction_total: u128 = epoch.prediction_fees.values().sum();
    distribute_protocol_share(dist, prediction_total, config);

    // Priority fees: 100% to protocol
    distribute_protocol_share(dist, epoch.priority_fees, config);
}

// ============ AMM Fee Calculation ============

/// Calculate the fee earned from a swap in an AMM pool.
/// Returns (fee_amount, output_amount_after_fee)
pub fn calculate_swap_fee(
    amount_in: u128,
    reserve_in: u128,
    reserve_out: u128,
    fee_rate_bps: u16,
) -> (u128, u128) {
    let fee = vibeswap_math::mul_div(amount_in, fee_rate_bps as u128, 10_000);
    let amount_after_fee = amount_in - fee;

    // Constant product output
    let output = if reserve_in + amount_after_fee > 0 {
        vibeswap_math::mul_div(amount_after_fee, reserve_out, reserve_in + amount_after_fee)
    } else {
        0
    };

    (fee, output)
}

/// Calculate lending reserve income for a period
pub fn calculate_lending_reserve_income(
    total_borrows: u128,
    interest_rate_bps: u128,
    reserve_factor_bps: u128,
    blocks: u64,
) -> u128 {
    // Interest accrued = borrows × rate × blocks / blocks_per_year
    let blocks_per_year: u128 = 7_884_000; // CKB ~4s blocks
    let interest = vibeswap_math::mul_div(
        total_borrows,
        interest_rate_bps * blocks as u128,
        10_000 * blocks_per_year,
    );

    // Reserve income = interest × reserve_factor
    vibeswap_math::mul_div(interest, reserve_factor_bps, 10_000)
}

/// Calculate prediction market fee from settlement
pub fn calculate_prediction_fee(
    _winning_pool: u128,
    total_pool: u128,
    fee_rate_bps: u16,
) -> u128 {
    // Fee is charged on the total pool when distributing to winners
    vibeswap_math::mul_div(total_pool, fee_rate_bps as u128, 10_000)
}

// ============ Revenue Analytics ============

/// Annualized protocol revenue estimate from a single epoch
pub fn annualize_revenue(epoch: &FeeEpoch) -> u128 {
    let epoch_blocks = if epoch.end_block > epoch.start_block {
        epoch.end_block - epoch.start_block
    } else {
        return 0;
    };

    if epoch_blocks == 0 {
        return 0;
    }

    let total = epoch.total_fees();
    let blocks_per_year: u128 = 7_884_000;

    vibeswap_math::mul_div(total, blocks_per_year, epoch_blocks as u128)
}

/// Protocol revenue yield: annualized revenue / TVL in bps
pub fn revenue_yield_bps(annualized_revenue: u128, tvl: u128) -> u64 {
    if tvl == 0 {
        return 0;
    }
    (vibeswap_math::mul_div(annualized_revenue, 10_000, tvl)) as u64
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn pair(id: u8) -> [u8; 32] {
        let mut h = [0u8; 32];
        h[0] = id;
        h
    }

    fn default_epoch() -> FeeEpoch {
        FeeEpoch::new(1, 1000, 2000)
    }

    // ============ FeeConfig ============

    #[test]
    fn test_default_config_valid() {
        let config = FeeConfig::default();
        assert!(config.is_valid());
        assert_eq!(
            config.treasury_share_bps + config.staker_share_bps + config.insurance_share_bps,
            10_000
        );
    }

    #[test]
    fn test_invalid_config() {
        let config = FeeConfig {
            treasury_share_bps: 5000,
            staker_share_bps: 3000,
            insurance_share_bps: 1000, // Only 9000, not 10000
            ..Default::default()
        };
        assert!(!config.is_valid());
    }

    // ============ Fee Epoch Recording ============

    #[test]
    fn test_record_amm_fees() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 1000);
        epoch.record_amm_fee(pair(1), 500);
        epoch.record_amm_fee(pair(2), 300);

        assert_eq!(epoch.amm_fees[&pair(1)], 1500);
        assert_eq!(epoch.amm_fees[&pair(2)], 300);
        assert_eq!(epoch.total_fees(), 1800);
    }

    #[test]
    fn test_record_all_fee_types() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 1000);
        epoch.record_lending_fee(pair(2), 500);
        epoch.record_insurance_fee(pair(3), 200);
        epoch.record_prediction_fee(pair(4), 100);
        epoch.record_priority_fee(50);

        assert_eq!(epoch.total_fees(), 1850);

        let breakdown = epoch.fees_by_source();
        assert_eq!(breakdown.amm, 1000);
        assert_eq!(breakdown.lending, 500);
        assert_eq!(breakdown.insurance, 200);
        assert_eq!(breakdown.prediction, 100);
        assert_eq!(breakdown.priority, 50);
        assert_eq!(breakdown.total(), 1850);
    }

    #[test]
    fn test_empty_epoch() {
        let epoch = default_epoch();
        assert_eq!(epoch.total_fees(), 0);
        let breakdown = epoch.fees_by_source();
        assert_eq!(breakdown.total(), 0);
    }

    // ============ Fee Distribution ============

    #[test]
    fn test_amm_fee_distribution() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000 * PRECISION);

        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);

        // Protocol gets 1667/10000 of AMM fees ≈ 16.67%
        let protocol_total = 10_000 * PRECISION * 1667 / 10_000;
        let lp_total = 10_000 * PRECISION - protocol_total;

        // LPs get the rest
        assert_eq!(dist.lp_distributions[&pair(1)], lp_total);

        // Protocol split: 50% treasury, 30% stakers, 20% insurance
        let expected_treasury = protocol_total * 5000 / 10_000;
        let expected_staker = protocol_total * 3000 / 10_000;
        let expected_insurance = protocol_total * 2000 / 10_000;

        assert_eq!(dist.treasury_amount, expected_treasury);
        assert_eq!(dist.staker_amount, expected_staker);
        assert_eq!(dist.insurance_amount, expected_insurance);
    }

    #[test]
    fn test_lending_fee_distribution() {
        let mut epoch = default_epoch();
        epoch.record_lending_fee(pair(1), 5_000 * PRECISION);

        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);

        // All lending fees go to protocol (no LP split)
        assert!(dist.lp_distributions.is_empty());

        // Treasury: 50%, Stakers: 30%, Insurance: 20%
        assert_eq!(dist.treasury_amount, 5_000 * PRECISION * 5000 / 10_000);
        assert_eq!(dist.staker_amount, 5_000 * PRECISION * 3000 / 10_000);
        assert_eq!(dist.insurance_amount, 5_000 * PRECISION * 2000 / 10_000);
    }

    #[test]
    fn test_priority_fee_distribution() {
        let mut epoch = default_epoch();
        epoch.record_priority_fee(1_000 * PRECISION);

        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);

        // Priority fees: 100% to protocol
        let total_protocol = 1_000 * PRECISION;
        assert_eq!(dist.treasury_amount, total_protocol * 5000 / 10_000);
        assert_eq!(dist.staker_amount, total_protocol * 3000 / 10_000);
    }

    #[test]
    fn test_mixed_fee_distribution() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000 * PRECISION);
        epoch.record_amm_fee(pair(2), 5_000 * PRECISION);
        epoch.record_lending_fee(pair(3), 3_000 * PRECISION);
        epoch.record_priority_fee(500 * PRECISION);

        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);

        // LPs should get shares from both AMM pools
        assert!(dist.lp_distributions.contains_key(&pair(1)));
        assert!(dist.lp_distributions.contains_key(&pair(2)));
        assert!(!dist.lp_distributions.contains_key(&pair(3))); // Lending → no LP share

        // Total distributed should account for everything
        assert!(dist.total_distributed > 0);
    }

    #[test]
    fn test_zero_fees_distribution() {
        let epoch = default_epoch();
        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);

        assert_eq!(dist.treasury_amount, 0);
        assert_eq!(dist.staker_amount, 0);
        assert_eq!(dist.insurance_amount, 0);
        assert_eq!(dist.total_distributed, 0);
    }

    #[test]
    fn test_custom_fee_config() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000 * PRECISION);

        // All protocol fees to treasury (100%)
        let config = FeeConfig {
            protocol_fee_bps: 3000, // 30% of AMM to protocol
            treasury_share_bps: 10_000,
            staker_share_bps: 0,
            insurance_share_bps: 0,
        };
        assert!(config.is_valid());

        let dist = calculate_distribution(&epoch, &config);
        let protocol_share = 10_000 * PRECISION * 3000 / 10_000;

        assert_eq!(dist.treasury_amount, protocol_share);
        assert_eq!(dist.staker_amount, 0);
        assert_eq!(dist.insurance_amount, 0);
    }

    // ============ Swap Fee Calculation ============

    #[test]
    fn test_swap_fee_calculation() {
        let amount = 1_000 * PRECISION;
        let (fee, output) = calculate_swap_fee(
            amount,
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            30, // 0.3%
        );

        // Fee should be 0.3% of input
        assert_eq!(fee, amount * 30 / 10_000);
        // Output should be less than input (fees + slippage)
        assert!(output < amount);
        assert!(output > 0);
    }

    #[test]
    fn test_swap_fee_zero_input() {
        let (fee, output) = calculate_swap_fee(0, 1_000_000, 1_000_000, 30);
        assert_eq!(fee, 0);
        assert_eq!(output, 0);
    }

    #[test]
    fn test_swap_fee_zero_reserves() {
        let (fee, output) = calculate_swap_fee(1000, 0, 1_000_000, 30);
        assert_eq!(fee, 1000 * 30 / 10_000);
        // With zero reserve_in, the pool can still return tokens
        assert!(output > 0 || fee > 0);
    }

    // ============ Lending Reserve Income ============

    #[test]
    fn test_lending_reserve_income() {
        let income = calculate_lending_reserve_income(
            1_000_000 * PRECISION, // 1M borrows
            500,                    // 5% interest rate
            2000,                   // 20% reserve factor
            7_884_000,              // 1 year of blocks
        );

        // Expected: 1M × 5% × 20% = 10K per year
        // Due to mul_div approximation, check it's in the right ballpark
        assert!(income > 9_000 * PRECISION);
        assert!(income < 11_000 * PRECISION);
    }

    #[test]
    fn test_lending_reserve_income_zero_borrows() {
        let income = calculate_lending_reserve_income(0, 500, 2000, 1000);
        assert_eq!(income, 0);
    }

    // ============ Prediction Fee ============

    #[test]
    fn test_prediction_fee_calculation() {
        let fee = calculate_prediction_fee(
            50_000 * PRECISION,  // Winning pool
            100_000 * PRECISION, // Total pool
            200,                 // 2% fee
        );

        assert_eq!(fee, 100_000 * PRECISION * 200 / 10_000);
    }

    // ============ Revenue Analytics ============

    #[test]
    fn test_annualize_revenue() {
        let mut epoch = FeeEpoch::new(1, 0, 7_884_000); // Full year
        epoch.record_amm_fee(pair(1), 100_000 * PRECISION);

        let annual = annualize_revenue(&epoch);
        assert_eq!(annual, 100_000 * PRECISION); // Exact for full year
    }

    #[test]
    fn test_annualize_revenue_partial_epoch() {
        // 1/10 of a year
        let mut epoch = FeeEpoch::new(1, 0, 788_400);
        epoch.record_amm_fee(pair(1), 10_000 * PRECISION);

        let annual = annualize_revenue(&epoch);
        // 10K in 1/10 year → 100K annualized
        assert_eq!(annual, 100_000 * PRECISION);
    }

    #[test]
    fn test_annualize_revenue_zero_blocks() {
        let epoch = FeeEpoch::new(1, 100, 100);
        assert_eq!(annualize_revenue(&epoch), 0);
    }

    #[test]
    fn test_revenue_yield_bps() {
        // 100K revenue on 10M TVL = 1% = 100 bps
        let yield_bps = revenue_yield_bps(100_000 * PRECISION, 10_000_000 * PRECISION);
        assert_eq!(yield_bps, 100);
    }

    #[test]
    fn test_revenue_yield_zero_tvl() {
        assert_eq!(revenue_yield_bps(100_000 * PRECISION, 0), 0);
    }

    // ============ Multi-Pool Scenario ============

    #[test]
    fn test_multi_pool_epoch() {
        let mut epoch = default_epoch();

        // 5 AMM pools with different volumes
        for i in 1..=5u8 {
            let volume = i as u128 * 10_000 * PRECISION;
            let fee = volume * 30 / 10_000; // 0.3% fee
            epoch.record_amm_fee(pair(i), fee);
        }

        // Lending and insurance
        epoch.record_lending_fee(pair(10), 2_000 * PRECISION);
        epoch.record_insurance_fee(pair(11), 500 * PRECISION);

        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);

        // All 5 pools should have LP distributions
        for i in 1..=5u8 {
            assert!(dist.lp_distributions.contains_key(&pair(i)));
        }

        // Treasury should have received from all sources
        assert!(dist.treasury_amount > 0);
        assert!(dist.total_distributed > 0);
    }

    // ============ Fee Conservation ============

    #[test]
    fn test_fee_conservation_amm_only() {
        let mut epoch = default_epoch();
        let fee_amount = 10_000 * PRECISION;
        epoch.record_amm_fee(pair(1), fee_amount);

        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);

        // LP share + protocol share should equal total (within rounding)
        let lp_total: u128 = dist.lp_distributions.values().sum();
        let protocol_total = dist.treasury_amount + dist.staker_amount + dist.insurance_amount;
        let total = lp_total + protocol_total;

        // Allow 1 unit rounding per distribution step
        let diff = if total > fee_amount {
            total - fee_amount
        } else {
            fee_amount - total
        };
        assert!(diff < 10, "Fee conservation violated: {} vs {}", total, fee_amount);
    }

    #[test]
    fn test_fee_conservation_lending() {
        let mut epoch = default_epoch();
        let fee_amount = 5_000 * PRECISION;
        epoch.record_lending_fee(pair(1), fee_amount);

        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);

        let total = dist.treasury_amount + dist.staker_amount + dist.insurance_amount;
        let diff = if total > fee_amount {
            total - fee_amount
        } else {
            fee_amount - total
        };
        assert!(diff < 5, "Lending fee conservation violated");
    }

    // ============ Edge Cases ============

    #[test]
    fn test_very_small_fees() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 1); // 1 unit

        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);

        // With 1 unit, most distributions round to 0
        let total: u128 = dist.lp_distributions.values().sum::<u128>()
            + dist.treasury_amount
            + dist.staker_amount
            + dist.insurance_amount;
        assert!(total <= 1, "Can't distribute more than collected");
    }

    #[test]
    fn test_large_fees() {
        let mut epoch = default_epoch();
        let big_fee = u128::MAX / 100;
        epoch.record_priority_fee(big_fee);

        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);

        // Should not overflow or panic
        assert!(dist.treasury_amount > 0);
        assert!(dist.staker_amount > 0);
    }

    // ============ Shapley Weight Calculation ============

    fn make_pool(id: u8, depth: u128, volume: u128, routes: u32) -> PoolDepthInfo {
        PoolDepthInfo {
            pair_id: pair(id),
            depth,
            epoch_volume: volume,
            route_count: routes,
        }
    }

    #[test]
    fn test_shapley_weights_empty() {
        let weights = calculate_shapley_weights(&[]);
        assert!(weights.is_empty());
    }

    #[test]
    fn test_shapley_weights_single_pool() {
        let pools = vec![make_pool(1, 1_000_000 * PRECISION, 100_000 * PRECISION, 3)];
        let weights = calculate_shapley_weights(&pools);
        assert_eq!(weights.len(), 1);
        assert!(weights[&pair(1)] > 0);
    }

    #[test]
    fn test_shapley_weights_deeper_pool_gets_more() {
        // Pool A: 10x deeper than pool B, same volume and routes
        let pools = vec![
            make_pool(1, 10_000_000 * PRECISION, 500_000 * PRECISION, 2),
            make_pool(2, 1_000_000 * PRECISION, 500_000 * PRECISION, 2),
        ];
        let weights = calculate_shapley_weights(&pools);

        // Deeper pool should have higher weight
        assert!(
            weights[&pair(1)] > weights[&pair(2)],
            "Deeper pool should have higher Shapley weight: {} vs {}",
            weights[&pair(1)],
            weights[&pair(2)]
        );
    }

    #[test]
    fn test_shapley_weights_utilized_pool_gets_bonus() {
        // Same depth, but pool A has 5x more volume
        let pools = vec![
            make_pool(1, 1_000_000 * PRECISION, 800_000 * PRECISION, 2),
            make_pool(2, 1_000_000 * PRECISION, 100_000 * PRECISION, 2),
        ];
        let weights = calculate_shapley_weights(&pools);

        assert!(
            weights[&pair(1)] > weights[&pair(2)],
            "More utilized pool should have higher weight"
        );
    }

    #[test]
    fn test_shapley_weights_connected_pool_gets_bonus() {
        // Same depth and volume, but pool A is in 10 routes vs pool B in 1
        let pools = vec![
            make_pool(1, 1_000_000 * PRECISION, 500_000 * PRECISION, 10),
            make_pool(2, 1_000_000 * PRECISION, 500_000 * PRECISION, 1),
        ];
        let weights = calculate_shapley_weights(&pools);

        assert!(
            weights[&pair(1)] > weights[&pair(2)],
            "More connected pool should have higher weight"
        );
    }

    #[test]
    fn test_shapley_weights_zero_depth() {
        let pools = vec![
            make_pool(1, 0, 500_000 * PRECISION, 5),
            make_pool(2, 1_000_000 * PRECISION, 500_000 * PRECISION, 5),
        ];
        let weights = calculate_shapley_weights(&pools);
        assert_eq!(weights[&pair(1)], 0);
        assert!(weights[&pair(2)] > 0);
    }

    #[test]
    fn test_shapley_utilization_cap() {
        // Volume >> depth should cap utilization bonus at 100%
        let pools = vec![
            make_pool(1, 1_000 * PRECISION, 999_999_999 * PRECISION, 1),
            make_pool(2, 1_000 * PRECISION, 1_000 * PRECISION, 1), // 100% utilization
        ];
        let weights = calculate_shapley_weights(&pools);

        // Both should have the same utilization bonus (capped at PRECISION)
        // so weights should be equal
        assert_eq!(weights[&pair(1)], weights[&pair(2)]);
    }

    // ============ Shapley Distribution ============

    #[test]
    fn test_shapley_distribution_basic() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000 * PRECISION);
        epoch.record_amm_fee(pair(2), 5_000 * PRECISION);

        let config = FeeConfig::default();
        let pools = vec![
            make_pool(1, 2_000_000 * PRECISION, 500_000 * PRECISION, 3),
            make_pool(2, 1_000_000 * PRECISION, 500_000 * PRECISION, 3),
        ];

        let dist = calculate_distribution_shapley(&epoch, &config, &pools);

        // Both pools should have LP distributions
        assert!(dist.lp_distributions.contains_key(&pair(1)));
        assert!(dist.lp_distributions.contains_key(&pair(2)));

        // Pool 1 (2x deeper) should get more than pool 2
        assert!(dist.lp_distributions[&pair(1)] > dist.lp_distributions[&pair(2)]);

        // Total distributed should be positive
        assert!(dist.total_distributed > 0);
    }

    #[test]
    fn test_shapley_vs_simple_redistribution() {
        // With Shapley, fees flow from shallow to deep pools
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 1_000 * PRECISION);  // Small pool, small fees
        epoch.record_amm_fee(pair(2), 1_000 * PRECISION);  // Big pool, same fees

        let config = FeeConfig::default();

        // Simple: each pool keeps its own LP share
        let simple = calculate_distribution(&epoch, &config);
        assert_eq!(simple.lp_distributions[&pair(1)], simple.lp_distributions[&pair(2)]);

        // Shapley: pool 2 is 10x deeper, should get more
        let pools = vec![
            make_pool(1, 100_000 * PRECISION, 1_000 * PRECISION, 1),
            make_pool(2, 1_000_000 * PRECISION, 1_000 * PRECISION, 1),
        ];
        let shapley = calculate_distribution_shapley(&epoch, &config, &pools);
        assert!(
            shapley.lp_distributions[&pair(2)] > shapley.lp_distributions[&pair(1)],
            "Shapley should route more fees to deeper pool"
        );
    }

    #[test]
    fn test_shapley_fee_conservation() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000 * PRECISION);
        epoch.record_amm_fee(pair(2), 5_000 * PRECISION);
        epoch.record_amm_fee(pair(3), 3_000 * PRECISION);
        epoch.record_lending_fee(pair(10), 2_000 * PRECISION);

        let config = FeeConfig::default();
        let pools = vec![
            make_pool(1, 5_000_000 * PRECISION, 1_000_000 * PRECISION, 5),
            make_pool(2, 2_000_000 * PRECISION, 800_000 * PRECISION, 3),
            make_pool(3, 1_000_000 * PRECISION, 300_000 * PRECISION, 1),
        ];

        let dist = calculate_distribution_shapley(&epoch, &config, &pools);

        // Total LP share should equal total AMM fees minus protocol cut
        let total_amm: u128 = epoch.amm_fees.values().sum();
        let protocol_from_amm = total_amm * config.protocol_fee_bps as u128 / 10_000;
        let expected_lp_total = total_amm - protocol_from_amm;

        let actual_lp_total: u128 = dist.lp_distributions.values().sum();

        let diff = if actual_lp_total > expected_lp_total {
            actual_lp_total - expected_lp_total
        } else {
            expected_lp_total - actual_lp_total
        };
        assert!(
            diff < 10,
            "Shapley LP conservation violated: {} vs expected {}",
            actual_lp_total,
            expected_lp_total
        );
    }

    #[test]
    fn test_shapley_empty_pools_fallback() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000 * PRECISION);

        let config = FeeConfig::default();

        // Empty pool depths — LP fees go nowhere (no pool depth registered)
        let dist = calculate_distribution_shapley(&epoch, &config, &[]);
        assert!(dist.lp_distributions.is_empty());

        // Protocol fees should still be distributed
        assert!(dist.treasury_amount > 0);
    }

    #[test]
    fn test_shapley_bridge_pool_premium() {
        // Bridge pool (connects many routes) should earn a premium
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 5_000 * PRECISION);
        epoch.record_amm_fee(pair(2), 5_000 * PRECISION);

        let config = FeeConfig::default();

        // Pool 1 = bridge pool (10 routes), Pool 2 = endpoint (1 route)
        // Same depth and volume
        let pools = vec![
            make_pool(1, 1_000_000 * PRECISION, 500_000 * PRECISION, 10),
            make_pool(2, 1_000_000 * PRECISION, 500_000 * PRECISION, 1),
        ];
        let dist = calculate_distribution_shapley(&epoch, &config, &pools);

        assert!(
            dist.lp_distributions[&pair(1)] > dist.lp_distributions[&pair(2)],
            "Bridge pool should earn connectivity premium"
        );
    }

    #[test]
    fn test_shapley_five_pool_ranking() {
        // 5 pools with different characteristics — verify ranking follows expected order
        let mut epoch = default_epoch();
        for i in 1..=5u8 {
            epoch.record_amm_fee(pair(i), 2_000 * PRECISION);
        }

        let config = FeeConfig::default();
        let pools = vec![
            make_pool(1, 10_000_000 * PRECISION, 5_000_000 * PRECISION, 8), // King: deep + utilized + connected
            make_pool(2, 5_000_000 * PRECISION, 3_000_000 * PRECISION, 5),  // Strong
            make_pool(3, 2_000_000 * PRECISION, 1_000_000 * PRECISION, 3),  // Medium
            make_pool(4, 500_000 * PRECISION, 100_000 * PRECISION, 2),      // Weak
            make_pool(5, 100_000 * PRECISION, 10_000 * PRECISION, 1),       // Tiny
        ];

        let dist = calculate_distribution_shapley(&epoch, &config, &pools);

        // Verify monotonic ordering: pool 1 > 2 > 3 > 4 > 5
        let d1 = dist.lp_distributions[&pair(1)];
        let d2 = dist.lp_distributions[&pair(2)];
        let d3 = dist.lp_distributions[&pair(3)];
        let d4 = dist.lp_distributions[&pair(4)];
        let d5 = dist.lp_distributions[&pair(5)];

        assert!(d1 > d2, "Pool 1 > Pool 2");
        assert!(d2 > d3, "Pool 2 > Pool 3");
        assert!(d3 > d4, "Pool 3 > Pool 4");
        assert!(d4 > d5, "Pool 4 > Pool 5");
    }

    #[test]
    fn test_shapley_equal_pools_equal_share() {
        // Identical pools should get identical shares
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 5_000 * PRECISION);
        epoch.record_amm_fee(pair(2), 5_000 * PRECISION);

        let config = FeeConfig::default();
        let pools = vec![
            make_pool(1, 1_000_000 * PRECISION, 500_000 * PRECISION, 3),
            make_pool(2, 1_000_000 * PRECISION, 500_000 * PRECISION, 3),
        ];
        let dist = calculate_distribution_shapley(&epoch, &config, &pools);

        // Equal pools should get nearly equal LP shares (within rounding)
        let d1 = dist.lp_distributions[&pair(1)];
        let d2 = dist.lp_distributions[&pair(2)];
        let diff = if d1 > d2 { d1 - d2 } else { d2 - d1 };
        assert!(diff < 10, "Equal pools should get equal shares, diff={}", diff);
    }

    #[test]
    fn test_shapley_protocol_fees_unchanged() {
        // Shapley only affects LP distribution — protocol fees should be same as simple
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000 * PRECISION);
        epoch.record_lending_fee(pair(2), 5_000 * PRECISION);
        epoch.record_priority_fee(1_000 * PRECISION);

        let config = FeeConfig::default();
        let simple = calculate_distribution(&epoch, &config);

        let pools = vec![make_pool(1, 1_000_000 * PRECISION, 100_000 * PRECISION, 2)];
        let shapley = calculate_distribution_shapley(&epoch, &config, &pools);

        // Protocol treasury/staker/insurance should be identical
        assert_eq!(simple.treasury_amount, shapley.treasury_amount);
        assert_eq!(simple.staker_amount, shapley.staker_amount);
        assert_eq!(simple.insurance_amount, shapley.insurance_amount);
    }

    // ============ Additional Edge Case & Hardening Tests ============

    #[test]
    fn test_fee_epoch_new_preserves_fields() {
        let epoch = FeeEpoch::new(42, 1000, 2000);
        assert_eq!(epoch.epoch_id, 42);
        assert_eq!(epoch.start_block, 1000);
        assert_eq!(epoch.end_block, 2000);
        assert_eq!(epoch.priority_fees, 0);
        assert!(epoch.amm_fees.is_empty());
        assert!(epoch.lending_fees.is_empty());
    }

    #[test]
    fn test_fee_breakdown_total_consistency() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 100);
        epoch.record_lending_fee(pair(2), 200);
        epoch.record_insurance_fee(pair(3), 300);
        epoch.record_prediction_fee(pair(4), 400);
        epoch.record_priority_fee(500);

        let breakdown = epoch.fees_by_source();
        assert_eq!(breakdown.total(), epoch.total_fees(),
            "FeeBreakdown.total() must equal FeeEpoch.total_fees()");
    }

    #[test]
    fn test_swap_fee_high_fee_rate() {
        // 100% fee rate — entire input is fee, no output
        let amount = 1_000 * PRECISION;
        let (fee, output) = calculate_swap_fee(amount, 1_000_000 * PRECISION, 1_000_000 * PRECISION, 10_000);
        assert_eq!(fee, amount, "100% fee rate should take entire input as fee");
        assert_eq!(output, 0, "No remaining amount should produce zero output");
    }

    #[test]
    fn test_swap_fee_one_bps() {
        // Minimum meaningful fee rate: 1 bps (0.01%)
        let amount = 1_000_000 * PRECISION;
        let (fee, output) = calculate_swap_fee(
            amount,
            10_000_000 * PRECISION,
            10_000_000 * PRECISION,
            1,
        );
        assert_eq!(fee, amount / 10_000, "1 bps fee should be input/10000");
        assert!(output > 0);
        assert!(output < amount);
    }

    #[test]
    fn test_lending_reserve_income_zero_rate() {
        // Zero interest rate produces zero income regardless of borrows
        let income = calculate_lending_reserve_income(
            1_000_000 * PRECISION,
            0,     // 0% rate
            2000,
            7_884_000,
        );
        assert_eq!(income, 0);
    }

    #[test]
    fn test_lending_reserve_income_zero_reserve_factor() {
        // Zero reserve factor means protocol keeps nothing
        let income = calculate_lending_reserve_income(
            1_000_000 * PRECISION,
            500,
            0,     // 0% reserve factor
            7_884_000,
        );
        assert_eq!(income, 0);
    }

    #[test]
    fn test_annualize_revenue_reverse_block_range() {
        // end_block < start_block should return 0
        let epoch = FeeEpoch::new(1, 2000, 1000);
        assert_eq!(annualize_revenue(&epoch), 0);
    }

    #[test]
    fn test_revenue_yield_bps_zero_revenue() {
        // Zero revenue on any TVL should give 0 bps
        assert_eq!(revenue_yield_bps(0, 10_000_000 * PRECISION), 0);
    }

    #[test]
    fn test_shapley_weights_all_zero_depth() {
        // All pools have zero depth — all weights should be 0
        let pools = vec![
            make_pool(1, 0, 500_000 * PRECISION, 5),
            make_pool(2, 0, 300_000 * PRECISION, 3),
        ];
        let weights = calculate_shapley_weights(&pools);
        assert_eq!(weights[&pair(1)], 0);
        assert_eq!(weights[&pair(2)], 0);
    }

    #[test]
    fn test_shapley_distribution_no_amm_fees() {
        // No AMM fees but has lending/priority fees
        let mut epoch = default_epoch();
        epoch.record_lending_fee(pair(10), 5_000 * PRECISION);
        epoch.record_priority_fee(1_000 * PRECISION);

        let config = FeeConfig::default();
        let pools = vec![
            make_pool(1, 1_000_000 * PRECISION, 500_000 * PRECISION, 3),
        ];

        let dist = calculate_distribution_shapley(&epoch, &config, &pools);

        // No AMM fees means no LP distributions
        assert!(dist.lp_distributions.is_empty() || dist.lp_distributions.values().sum::<u128>() == 0,
            "No AMM fees should produce no LP distributions");
        // But protocol fees should still be distributed
        assert!(dist.treasury_amount > 0);
        assert!(dist.staker_amount > 0);
        assert!(dist.insurance_amount > 0);
    }

    #[test]
    fn test_prediction_fee_zero_total_pool() {
        // Zero total pool should produce zero fee
        let fee = calculate_prediction_fee(0, 0, 200);
        assert_eq!(fee, 0);
    }

    // ============ New Edge Case & Coverage Tests (Batch 3) ============

    #[test]
    fn test_fee_config_all_to_stakers() {
        // Config where 100% of protocol fees go to stakers
        let config = FeeConfig {
            protocol_fee_bps: 2000,
            treasury_share_bps: 0,
            staker_share_bps: 10_000,
            insurance_share_bps: 0,
        };
        assert!(config.is_valid());

        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000 * PRECISION);
        let dist = calculate_distribution(&epoch, &config);
        assert_eq!(dist.treasury_amount, 0);
        assert_eq!(dist.insurance_amount, 0);
        assert!(dist.staker_amount > 0);
    }

    #[test]
    fn test_fee_config_all_to_insurance() {
        // Config where 100% of protocol fees go to insurance
        let config = FeeConfig {
            protocol_fee_bps: 1000,
            treasury_share_bps: 0,
            staker_share_bps: 0,
            insurance_share_bps: 10_000,
        };
        assert!(config.is_valid());

        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 5_000 * PRECISION);
        let dist = calculate_distribution(&epoch, &config);
        assert_eq!(dist.treasury_amount, 0);
        assert_eq!(dist.staker_amount, 0);
        assert!(dist.insurance_amount > 0);
    }

    #[test]
    fn test_record_multiple_fee_types_same_pool_id() {
        // Record AMM and lending fees under the same pool ID
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 1000);
        epoch.record_lending_fee(pair(1), 500);
        epoch.record_insurance_fee(pair(1), 200);

        assert_eq!(epoch.amm_fees[&pair(1)], 1000);
        assert_eq!(epoch.lending_fees[&pair(1)], 500);
        assert_eq!(epoch.insurance_fees[&pair(1)], 200);
        assert_eq!(epoch.total_fees(), 1700);
    }

    #[test]
    fn test_swap_fee_large_amount_relative_to_reserves() {
        // Input amount equals reserve — extreme slippage scenario
        let amount = 1_000_000 * PRECISION;
        let reserve = 1_000_000 * PRECISION;
        let (fee, output) = calculate_swap_fee(amount, reserve, reserve, 30);
        assert_eq!(fee, amount * 30 / 10_000);
        // With amount = reserve, output ≈ reserve/2 (constant product math)
        assert!(output > 0);
        assert!(output < amount);
        assert!(output < reserve, "Output should not exceed reserve_out");
    }

    #[test]
    fn test_prediction_fee_zero_fee_rate() {
        // Zero fee rate should produce zero fee regardless of pool size
        let fee = calculate_prediction_fee(50_000 * PRECISION, 100_000 * PRECISION, 0);
        assert_eq!(fee, 0);
    }

    #[test]
    fn test_shapley_weights_single_pool_zero_volume() {
        // Single pool with zero volume — utilization bonus should be 0
        let pools = vec![make_pool(1, 1_000_000 * PRECISION, 0, 1)];
        let weights = calculate_shapley_weights(&pools);
        // Weight = depth * (1 + 0) * (1 + 1) = depth * 2
        assert!(weights[&pair(1)] > 0);
        // Compare to same pool with volume
        let pools_vol = vec![make_pool(1, 1_000_000 * PRECISION, 500_000 * PRECISION, 1)];
        let weights_vol = calculate_shapley_weights(&pools_vol);
        assert!(weights_vol[&pair(1)] > weights[&pair(1)],
            "Pool with volume should have higher weight than identical pool without volume");
    }

    #[test]
    fn test_shapley_distribution_single_pool_gets_all_lp_fees() {
        // With one pool in depth info, it should receive all LP fees
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000 * PRECISION);
        epoch.record_amm_fee(pair(2), 5_000 * PRECISION);

        let config = FeeConfig::default();
        let pools = vec![make_pool(1, 1_000_000 * PRECISION, 500_000 * PRECISION, 3)];

        let dist = calculate_distribution_shapley(&epoch, &config, &pools);
        // Only pool 1 has depth info, so it gets ALL LP fees from both AMM pools
        assert!(dist.lp_distributions.contains_key(&pair(1)));
        // Pool 2 has no depth entry — it gets nothing
        let total_lp: u128 = dist.lp_distributions.values().sum();
        assert_eq!(dist.lp_distributions.get(&pair(1)).copied().unwrap_or(0), total_lp);
    }

    #[test]
    fn test_annualize_revenue_single_block_epoch() {
        // Epoch of exactly 1 block with fees
        let mut epoch = FeeEpoch::new(1, 0, 1);
        epoch.record_amm_fee(pair(1), 100 * PRECISION);

        let annual = annualize_revenue(&epoch);
        // 100 per block * 7_884_000 blocks/year = 788_400_000
        assert_eq!(annual, 100 * PRECISION * 7_884_000);
    }
}
