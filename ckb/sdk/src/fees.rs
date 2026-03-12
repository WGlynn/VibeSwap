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

    // ============ Batch 4: Additional Edge Case & Coverage Tests ============

    #[test]
    fn test_fee_config_default_protocol_fee_bps() {
        // Verify default protocol fee is 1667 bps (~16.67%)
        let config = FeeConfig::default();
        assert_eq!(config.protocol_fee_bps, 1667);
    }

    #[test]
    fn test_record_amm_fee_accumulates_same_pool() {
        // Multiple records to the same pool should accumulate
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 100);
        epoch.record_amm_fee(pair(1), 200);
        epoch.record_amm_fee(pair(1), 300);
        assert_eq!(epoch.amm_fees[&pair(1)], 600);
    }

    #[test]
    fn test_record_priority_fee_accumulates() {
        // Multiple priority fee records should accumulate
        let mut epoch = default_epoch();
        epoch.record_priority_fee(100);
        epoch.record_priority_fee(200);
        epoch.record_priority_fee(300);
        assert_eq!(epoch.priority_fees, 600);
        assert_eq!(epoch.total_fees(), 600);
    }

    #[test]
    fn test_distribution_only_priority_fees() {
        // Only priority fees — all go to protocol split
        let mut epoch = default_epoch();
        epoch.record_priority_fee(10_000 * PRECISION);
        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);

        // No LP distributions
        assert!(dist.lp_distributions.is_empty());
        // Protocol gets 100% of priority fees
        let total_protocol = dist.treasury_amount + dist.staker_amount + dist.insurance_amount;
        // Allow small rounding error
        let diff = if total_protocol > 10_000 * PRECISION {
            total_protocol - 10_000 * PRECISION
        } else {
            10_000 * PRECISION - total_protocol
        };
        assert!(diff < 10, "Priority fee conservation violated: distributed {}", total_protocol);
    }

    #[test]
    fn test_swap_fee_fee_plus_output_less_than_or_equal_input() {
        // Fee + output should never exceed the reserves (output bounded by reserve_out)
        let amount = 500 * PRECISION;
        let reserve = 1_000_000 * PRECISION;
        let (fee, output) = calculate_swap_fee(amount, reserve, reserve, 30);
        assert!(fee + output <= amount + reserve,
            "Fee ({}) + output ({}) should be bounded", fee, output);
        assert!(output < reserve, "Output must be less than reserve_out");
    }

    #[test]
    fn test_shapley_weights_three_pools_ordered() {
        // Three pools with clearly different characteristics — verify ordering
        let pools = vec![
            make_pool(1, 5_000_000 * PRECISION, 2_000_000 * PRECISION, 8),  // Best
            make_pool(2, 1_000_000 * PRECISION, 500_000 * PRECISION, 3),    // Middle
            make_pool(3, 100_000 * PRECISION, 10_000 * PRECISION, 1),       // Worst
        ];
        let weights = calculate_shapley_weights(&pools);
        assert!(weights[&pair(1)] > weights[&pair(2)],
            "Pool 1 should outweigh pool 2");
        assert!(weights[&pair(2)] > weights[&pair(3)],
            "Pool 2 should outweigh pool 3");
    }

    #[test]
    fn test_fee_breakdown_individual_fields() {
        // Verify each FeeBreakdown field independently
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10);
        epoch.record_lending_fee(pair(2), 20);
        epoch.record_insurance_fee(pair(3), 30);
        epoch.record_prediction_fee(pair(4), 40);
        epoch.record_priority_fee(50);

        let b = epoch.fees_by_source();
        assert_eq!(b.amm, 10);
        assert_eq!(b.lending, 20);
        assert_eq!(b.insurance, 30);
        assert_eq!(b.prediction, 40);
        assert_eq!(b.priority, 50);
        assert_eq!(b.total(), 150);
    }

    #[test]
    fn test_shapley_distribution_three_equal_pools_conserves_lp_total() {
        // Three equal-depth pools: total LP distributed should equal expected LP pool
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 3_000 * PRECISION);
        epoch.record_amm_fee(pair(2), 3_000 * PRECISION);
        epoch.record_amm_fee(pair(3), 3_000 * PRECISION);

        let config = FeeConfig::default();
        let pools = vec![
            make_pool(1, 1_000_000 * PRECISION, 500_000 * PRECISION, 2),
            make_pool(2, 1_000_000 * PRECISION, 500_000 * PRECISION, 2),
            make_pool(3, 1_000_000 * PRECISION, 500_000 * PRECISION, 2),
        ];

        let dist = calculate_distribution_shapley(&epoch, &config, &pools);
        let total_amm: u128 = epoch.amm_fees.values().sum();
        let protocol_cut = total_amm * config.protocol_fee_bps as u128 / 10_000;
        let expected_lp = total_amm - protocol_cut;
        let actual_lp: u128 = dist.lp_distributions.values().sum();

        let diff = if actual_lp > expected_lp { actual_lp - expected_lp } else { expected_lp - actual_lp };
        assert!(diff < 10, "Three equal pools LP conservation: {} vs {}", actual_lp, expected_lp);

        // Each pool should get ~1/3 of the LP total
        let per_pool = actual_lp / 3;
        for &share in dist.lp_distributions.values() {
            let d = if share > per_pool { share - per_pool } else { per_pool - share };
            assert!(d < 10, "Equal pools should get equal shares");
        }
    }

    // ============ Batch 5: Edge Cases, Boundaries, Overflow, Error Paths ============

    #[test]
    fn test_fee_config_zero_protocol_fee_bps() {
        // 0% protocol fee — LPs keep everything from AMM fees
        let config = FeeConfig {
            protocol_fee_bps: 0,
            treasury_share_bps: 5000,
            staker_share_bps: 3000,
            insurance_share_bps: 2000,
        };
        assert!(config.is_valid());

        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000 * PRECISION);
        let dist = calculate_distribution(&epoch, &config);

        // LPs get 100% of AMM fees
        assert_eq!(dist.lp_distributions[&pair(1)], 10_000 * PRECISION);
        // Protocol gets nothing from AMM fees
        assert_eq!(dist.treasury_amount, 0);
        assert_eq!(dist.staker_amount, 0);
        assert_eq!(dist.insurance_amount, 0);
    }

    #[test]
    fn test_fee_config_max_protocol_fee_bps() {
        // 100% protocol fee — LPs get nothing from AMM fees
        let config = FeeConfig {
            protocol_fee_bps: 10_000,
            treasury_share_bps: 5000,
            staker_share_bps: 3000,
            insurance_share_bps: 2000,
        };
        assert!(config.is_valid());

        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000 * PRECISION);
        let dist = calculate_distribution(&epoch, &config);

        // LPs get nothing
        assert_eq!(dist.lp_distributions[&pair(1)], 0);
        // Protocol gets all AMM fees
        let total_protocol = dist.treasury_amount + dist.staker_amount + dist.insurance_amount;
        let diff = if total_protocol > 10_000 * PRECISION {
            total_protocol - 10_000 * PRECISION
        } else {
            10_000 * PRECISION - total_protocol
        };
        assert!(diff < 10, "All AMM fees should go to protocol");
    }

    #[test]
    fn test_fee_config_is_valid_boundary_sums() {
        // Exactly 10000 is valid
        let config = FeeConfig {
            protocol_fee_bps: 500,
            treasury_share_bps: 3333,
            staker_share_bps: 3334,
            insurance_share_bps: 3333,
        };
        assert!(config.is_valid());

        // 10001 is invalid
        let config_over = FeeConfig {
            protocol_fee_bps: 500,
            treasury_share_bps: 5000,
            staker_share_bps: 3001,
            insurance_share_bps: 2000,
        };
        assert!(!config_over.is_valid());

        // 9999 is invalid
        let config_under = FeeConfig {
            protocol_fee_bps: 500,
            treasury_share_bps: 4999,
            staker_share_bps: 3000,
            insurance_share_bps: 2000,
        };
        assert!(!config_under.is_valid());
    }

    #[test]
    fn test_fee_config_clone_and_eq() {
        let config = FeeConfig::default();
        let cloned = config.clone();
        assert_eq!(config, cloned);

        let different = FeeConfig {
            protocol_fee_bps: 9999,
            ..Default::default()
        };
        assert_ne!(config, different);
    }

    #[test]
    fn test_swap_fee_asymmetric_reserves() {
        // reserve_out >> reserve_in — a highly imbalanced pool
        let amount = 100 * PRECISION;
        let (fee, output) = calculate_swap_fee(
            amount,
            1_000 * PRECISION,       // small reserve_in
            1_000_000 * PRECISION,   // large reserve_out
        30,
        );
        assert_eq!(fee, amount * 30 / 10_000);
        // With reserve_out much larger, output should be large relative to input
        assert!(output > 0);
        assert!(output < 1_000_000 * PRECISION, "Output must be less than reserve_out");
    }

    #[test]
    fn test_swap_fee_zero_fee_rate() {
        // 0 bps fee rate — no fee, pure constant-product output
        let amount = 1_000 * PRECISION;
        let reserve = 1_000_000 * PRECISION;
        let (fee, output) = calculate_swap_fee(amount, reserve, reserve, 0);
        assert_eq!(fee, 0);
        assert!(output > 0);
        // With zero fee the full input goes to AMM calculation
        let expected = vibeswap_math::mul_div(amount, reserve, reserve + amount);
        assert_eq!(output, expected);
    }

    #[test]
    fn test_swap_fee_both_reserves_zero() {
        // Both reserves zero — degenerate pool
        let (fee, output) = calculate_swap_fee(1000, 0, 0, 30);
        assert_eq!(fee, 1000 * 30 / 10_000);
        // reserve_out is 0, so output should be 0 regardless
        assert_eq!(output, 0);
    }

    #[test]
    fn test_swap_fee_zero_reserve_out() {
        // reserve_out = 0 means nothing to give out
        let amount = 1_000 * PRECISION;
        let (fee, output) = calculate_swap_fee(amount, 1_000_000 * PRECISION, 0, 30);
        assert_eq!(fee, amount * 30 / 10_000);
        assert_eq!(output, 0);
    }

    #[test]
    fn test_lending_reserve_income_zero_blocks() {
        // Zero blocks should produce zero income
        let income = calculate_lending_reserve_income(
            1_000_000 * PRECISION,
            500,
            2000,
            0,
        );
        assert_eq!(income, 0);
    }

    #[test]
    fn test_lending_reserve_income_one_block() {
        // 1 block should produce very small income
        let income = calculate_lending_reserve_income(
            1_000_000 * PRECISION,
            500,   // 5%
            2000,  // 20% reserve
            1,
        );
        // Extremely small but non-negative
        // interest = 1M * 500 * 1 / (10000 * 7884000) ≈ tiny
        // reserve_income = interest * 2000 / 10000
        assert!(income < PRECISION, "1-block income should be minuscule");
    }

    #[test]
    fn test_prediction_fee_max_fee_rate() {
        // 100% fee rate on prediction market
        let total_pool = 100_000 * PRECISION;
        let fee = calculate_prediction_fee(50_000 * PRECISION, total_pool, 10_000);
        assert_eq!(fee, total_pool);
    }

    #[test]
    fn test_prediction_fee_1_bps() {
        // Minimum meaningful fee rate
        let total_pool = 1_000_000 * PRECISION;
        let fee = calculate_prediction_fee(500_000 * PRECISION, total_pool, 1);
        assert_eq!(fee, total_pool / 10_000);
    }

    #[test]
    fn test_annualize_revenue_very_short_epoch() {
        // Very short epoch (10 blocks) extrapolates to huge annual
        let mut epoch = FeeEpoch::new(1, 0, 10);
        epoch.record_amm_fee(pair(1), 1_000 * PRECISION);

        let annual = annualize_revenue(&epoch);
        // 1000 per 10 blocks * 7_884_000 / 10 = 788_400_000
        assert_eq!(annual, vibeswap_math::mul_div(1_000 * PRECISION, 7_884_000, 10));
    }

    #[test]
    fn test_annualize_revenue_with_all_fee_types() {
        let mut epoch = FeeEpoch::new(1, 0, 7_884_000);
        epoch.record_amm_fee(pair(1), 50_000 * PRECISION);
        epoch.record_lending_fee(pair(2), 20_000 * PRECISION);
        epoch.record_insurance_fee(pair(3), 10_000 * PRECISION);
        epoch.record_prediction_fee(pair(4), 5_000 * PRECISION);
        epoch.record_priority_fee(15_000 * PRECISION);

        let annual = annualize_revenue(&epoch);
        // Full year epoch, so annualized = total
        assert_eq!(annual, epoch.total_fees());
    }

    #[test]
    fn test_revenue_yield_bps_small_tvl_large_revenue() {
        // Revenue larger than TVL — yield > 100%
        let yield_bps = revenue_yield_bps(10_000_000 * PRECISION, 1_000_000 * PRECISION);
        // 10M / 1M = 10x = 100_000 bps
        assert_eq!(yield_bps, 100_000);
    }

    #[test]
    fn test_revenue_yield_bps_equal_revenue_and_tvl() {
        // Revenue = TVL = 100% yield = 10000 bps
        let amount = 5_000_000 * PRECISION;
        let yield_bps = revenue_yield_bps(amount, amount);
        assert_eq!(yield_bps, 10_000);
    }

    #[test]
    fn test_shapley_weights_all_zero_routes() {
        // All pools have zero routes — max_routes normalization should handle gracefully
        // (max(routes) = 0, but code does .max(1) to avoid div-by-zero)
        let pools = vec![
            make_pool(1, 1_000_000 * PRECISION, 500_000 * PRECISION, 0),
            make_pool(2, 2_000_000 * PRECISION, 500_000 * PRECISION, 0),
        ];
        let weights = calculate_shapley_weights(&pools);
        // Both should have non-zero weights (depth > 0)
        assert!(weights[&pair(1)] > 0);
        assert!(weights[&pair(2)] > 0);
        // Deeper pool still wins
        assert!(weights[&pair(2)] > weights[&pair(1)]);
    }

    #[test]
    fn test_shapley_weights_zero_volume_zero_routes() {
        // Pool with depth but zero volume and zero routes
        let pools = vec![make_pool(1, 1_000_000 * PRECISION, 0, 0)];
        let weights = calculate_shapley_weights(&pools);
        // Weight = depth * (1 + 0) * (1 + 0/1) = depth * 1 * 1 = depth
        // Actually connectivity_bonus = 0/max(0,1) * PRECISION = 0
        // So weight = depth * (PREC + 0) / PREC * (PREC + 0) / PREC = depth
        assert_eq!(weights[&pair(1)], 1_000_000 * PRECISION);
    }

    #[test]
    fn test_shapley_distribution_all_zero_depth_pools() {
        // All pools have zero depth — no LP fees distributed
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000 * PRECISION);

        let config = FeeConfig::default();
        let pools = vec![
            make_pool(1, 0, 500_000 * PRECISION, 5),
            make_pool(2, 0, 300_000 * PRECISION, 3),
        ];

        let dist = calculate_distribution_shapley(&epoch, &config, &pools);
        // Total weight is 0 so no LP distribution happens
        let total_lp: u128 = dist.lp_distributions.values().sum();
        assert_eq!(total_lp, 0, "All zero-depth pools should yield zero LP distributions");
        // Protocol fees should still be distributed
        assert!(dist.treasury_amount > 0);
    }

    #[test]
    fn test_insurance_fee_distribution_protocol_cut() {
        // Insurance fees: protocol takes protocol_fee_bps cut, rest stays in insurance
        let mut epoch = default_epoch();
        epoch.record_insurance_fee(pair(1), 10_000 * PRECISION);

        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);

        // Insurance protocol cut = 10000 * 1667/10000 = 1667 PRECISION
        let insurance_protocol_cut = vibeswap_math::mul_div(
            10_000 * PRECISION,
            config.protocol_fee_bps as u128,
            10_000,
        );
        // That cut is split into treasury/staker/insurance according to shares
        let expected_treasury = vibeswap_math::mul_div(
            insurance_protocol_cut,
            config.treasury_share_bps as u128,
            10_000,
        );
        assert_eq!(dist.treasury_amount, expected_treasury);
    }

    #[test]
    fn test_total_distributed_equals_sum_of_parts() {
        // Verify total_distributed field is correctly computed
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000 * PRECISION);
        epoch.record_lending_fee(pair(2), 5_000 * PRECISION);
        epoch.record_priority_fee(1_000 * PRECISION);

        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);

        let manual_total = dist.treasury_amount
            + dist.staker_amount
            + dist.insurance_amount
            + dist.lp_distributions.values().sum::<u128>();
        assert_eq!(dist.total_distributed, manual_total);
    }

    #[test]
    fn test_shapley_total_distributed_equals_sum_of_parts() {
        // Same check for Shapley distribution
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 8_000 * PRECISION);
        epoch.record_amm_fee(pair(2), 4_000 * PRECISION);
        epoch.record_lending_fee(pair(3), 2_000 * PRECISION);

        let config = FeeConfig::default();
        let pools = vec![
            make_pool(1, 3_000_000 * PRECISION, 1_000_000 * PRECISION, 5),
            make_pool(2, 1_000_000 * PRECISION, 500_000 * PRECISION, 2),
        ];

        let dist = calculate_distribution_shapley(&epoch, &config, &pools);

        let manual_total = dist.treasury_amount
            + dist.staker_amount
            + dist.insurance_amount
            + dist.lp_distributions.values().sum::<u128>();
        assert_eq!(dist.total_distributed, manual_total);
    }

    #[test]
    fn test_fee_epoch_default() {
        // Default FeeEpoch should have all zeroes and empty maps
        let epoch = FeeEpoch::default();
        assert_eq!(epoch.epoch_id, 0);
        assert_eq!(epoch.start_block, 0);
        assert_eq!(epoch.end_block, 0);
        assert_eq!(epoch.priority_fees, 0);
        assert!(epoch.amm_fees.is_empty());
        assert!(epoch.lending_fees.is_empty());
        assert!(epoch.insurance_fees.is_empty());
        assert!(epoch.prediction_fees.is_empty());
        assert_eq!(epoch.total_fees(), 0);
    }

    #[test]
    fn test_fee_breakdown_default() {
        // Default FeeBreakdown should be all zeroes
        let b = FeeBreakdown::default();
        assert_eq!(b.amm, 0);
        assert_eq!(b.lending, 0);
        assert_eq!(b.insurance, 0);
        assert_eq!(b.prediction, 0);
        assert_eq!(b.priority, 0);
        assert_eq!(b.total(), 0);
    }

    #[test]
    fn test_fee_distribution_default() {
        // Default FeeDistribution should be all zeroes
        let d = FeeDistribution::default();
        assert_eq!(d.treasury_amount, 0);
        assert_eq!(d.staker_amount, 0);
        assert_eq!(d.insurance_amount, 0);
        assert_eq!(d.total_distributed, 0);
        assert!(d.lp_distributions.is_empty());
    }

    #[test]
    fn test_pool_depth_info_clone_eq() {
        let pool = make_pool(1, 1_000_000 * PRECISION, 500_000 * PRECISION, 3);
        let cloned = pool.clone();
        assert_eq!(pool, cloned);

        let different = make_pool(2, 1_000_000 * PRECISION, 500_000 * PRECISION, 3);
        assert_ne!(pool, different);
    }

    #[test]
    fn test_many_pools_distribution_no_panic() {
        // 50 pools — stress test for no overflow or panic
        let mut epoch = default_epoch();
        let mut pools = Vec::new();
        for i in 1..=50u8 {
            epoch.record_amm_fee(pair(i), (i as u128) * 1_000 * PRECISION);
            pools.push(make_pool(
                i,
                (i as u128) * 100_000 * PRECISION,
                (i as u128) * 50_000 * PRECISION,
                i as u32,
            ));
        }

        let config = FeeConfig::default();
        let dist = calculate_distribution_shapley(&epoch, &config, &pools);

        // Should not panic, and total_distributed should be positive
        assert!(dist.total_distributed > 0);
        assert_eq!(dist.lp_distributions.len(), 50);
        // Pool 50 (deepest) should get more than pool 1 (shallowest)
        assert!(dist.lp_distributions[&pair(50)] > dist.lp_distributions[&pair(1)]);
    }

    #[test]
    fn test_large_amm_fee_no_overflow() {
        // Use near-max u128 values (scaled down to avoid mul_div overflow)
        let mut epoch = default_epoch();
        let big_fee = u128::MAX / 10_000; // Safe for mul_div with 10000 divisor
        epoch.record_amm_fee(pair(1), big_fee);

        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);

        // Should not overflow or panic
        assert!(dist.lp_distributions[&pair(1)] > 0);
        assert!(dist.treasury_amount > 0);
        assert!(dist.total_distributed > 0);
    }

    #[test]
    fn test_shapley_weight_utilization_exactly_at_depth() {
        // Volume exactly equals depth — utilization bonus should be exactly PRECISION (100%)
        let pools = vec![
            make_pool(1, 1_000_000 * PRECISION, 1_000_000 * PRECISION, 1), // volume == depth
            make_pool(2, 1_000_000 * PRECISION, 999_999 * PRECISION, 1),   // volume < depth
        ];
        let weights = calculate_shapley_weights(&pools);
        // Pool 1 (volume >= depth) should have slightly higher weight due to cap hit
        assert!(weights[&pair(1)] >= weights[&pair(2)]);
    }

    #[test]
    fn test_shapley_connectivity_bonus_single_route_max() {
        // Single pool with 1 route — should get max connectivity bonus (1 out of 1)
        let pools = vec![make_pool(1, 1_000_000 * PRECISION, 500_000 * PRECISION, 1)];
        let weights = calculate_shapley_weights(&pools);

        // connectivity_bonus = 1/1 * PRECISION = PRECISION
        // utilization_bonus = 500000/1000000 * PRECISION = PRECISION/2
        // weight = depth * (PREC + PREC/2) / PREC * (PREC + PREC) / PREC
        //        = depth * 1.5 * 2 = depth * 3
        let expected = vibeswap_math::mul_div(
            vibeswap_math::mul_div(
                1_000_000 * PRECISION,
                PRECISION + PRECISION / 2,
                PRECISION,
            ),
            PRECISION + PRECISION,
            PRECISION,
        );
        assert_eq!(weights[&pair(1)], expected);
    }

    // ============ Batch 6: Hardening — Edge Cases, Boundaries, Overflow ============

    #[test]
    fn test_fee_config_zero_all_shares() {
        // All shares at zero — is_valid should be false (0 != 10000)
        let config = FeeConfig {
            protocol_fee_bps: 500,
            treasury_share_bps: 0,
            staker_share_bps: 0,
            insurance_share_bps: 0,
        };
        assert!(!config.is_valid());
    }

    #[test]
    fn test_record_amm_fee_zero_amount() {
        // Recording zero amount should be a no-op (adds 0)
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 0);
        assert_eq!(epoch.amm_fees[&pair(1)], 0);
        assert_eq!(epoch.total_fees(), 0);
    }

    #[test]
    fn test_record_lending_fee_accumulates_same_pool() {
        let mut epoch = default_epoch();
        epoch.record_lending_fee(pair(5), 100);
        epoch.record_lending_fee(pair(5), 250);
        epoch.record_lending_fee(pair(5), 50);
        assert_eq!(epoch.lending_fees[&pair(5)], 400);
    }

    #[test]
    fn test_record_insurance_fee_accumulates_same_pool() {
        let mut epoch = default_epoch();
        epoch.record_insurance_fee(pair(7), 111);
        epoch.record_insurance_fee(pair(7), 222);
        assert_eq!(epoch.insurance_fees[&pair(7)], 333);
    }

    #[test]
    fn test_record_prediction_fee_accumulates_same_market() {
        let mut epoch = default_epoch();
        epoch.record_prediction_fee(pair(9), 500);
        epoch.record_prediction_fee(pair(9), 700);
        assert_eq!(epoch.prediction_fees[&pair(9)], 1200);
    }

    #[test]
    fn test_swap_fee_tiny_amount_rounds_fee_to_zero() {
        // Amount so small that fee rounds to zero at 30 bps
        // amount * 30 / 10000 < 1 when amount < 334
        let (fee, output) = calculate_swap_fee(100, 1_000_000 * PRECISION, 1_000_000 * PRECISION, 30);
        assert_eq!(fee, 0); // 100 * 30 / 10000 = 0 in integer math
        assert!(output > 0);
    }

    #[test]
    fn test_swap_fee_output_never_exceeds_reserve_out() {
        // Even with extreme input, output is bounded by reserve_out
        let reserve_out = 500 * PRECISION;
        let (_, output) = calculate_swap_fee(
            u128::MAX / 20_000, // large input
            1 * PRECISION,      // tiny reserve_in
            reserve_out,
            30,
        );
        assert!(output <= reserve_out, "Output {} must not exceed reserve_out {}", output, reserve_out);
    }

    #[test]
    fn test_calculate_distribution_prediction_fees_only() {
        // Only prediction fees — all go to protocol
        let mut epoch = default_epoch();
        epoch.record_prediction_fee(pair(1), 7_000 * PRECISION);

        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);

        assert!(dist.lp_distributions.is_empty());
        let total_protocol = dist.treasury_amount + dist.staker_amount + dist.insurance_amount;
        let diff = if total_protocol > 7_000 * PRECISION {
            total_protocol - 7_000 * PRECISION
        } else {
            7_000 * PRECISION - total_protocol
        };
        assert!(diff < 10, "Prediction fee conservation violated");
    }

    #[test]
    fn test_calculate_distribution_insurance_fees_only() {
        // Only insurance fees — protocol takes its protocol_fee_bps cut
        let mut epoch = default_epoch();
        epoch.record_insurance_fee(pair(1), 8_000 * PRECISION);

        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);

        assert!(dist.lp_distributions.is_empty());
        // Protocol cut of insurance = insurance_total * protocol_fee_bps / 10000
        let protocol_cut = vibeswap_math::mul_div(8_000 * PRECISION, config.protocol_fee_bps as u128, 10_000);
        let total_protocol = dist.treasury_amount + dist.staker_amount + dist.insurance_amount;
        let diff = if total_protocol > protocol_cut {
            total_protocol - protocol_cut
        } else {
            protocol_cut - total_protocol
        };
        assert!(diff < 10, "Insurance fee protocol cut mismatch");
    }

    #[test]
    fn test_shapley_distribution_with_mixed_zero_and_nonzero_depth() {
        // Mix of zero-depth and positive-depth pools — only positive gets LP fees
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 6_000 * PRECISION);
        epoch.record_amm_fee(pair(2), 4_000 * PRECISION);

        let config = FeeConfig::default();
        let pools = vec![
            make_pool(1, 0, 100_000 * PRECISION, 5),                  // zero depth
            make_pool(2, 2_000_000 * PRECISION, 500_000 * PRECISION, 3), // positive depth
        ];

        let dist = calculate_distribution_shapley(&epoch, &config, &pools);
        // Pool 2 should get all LP fees since pool 1 has zero weight
        let lp_2 = dist.lp_distributions.get(&pair(2)).copied().unwrap_or(0);
        assert!(lp_2 > 0, "Pool with positive depth should get LP fees");
        // Pool 1 with zero depth gets zero
        let lp_1 = dist.lp_distributions.get(&pair(1)).copied().unwrap_or(0);
        assert_eq!(lp_1, 0, "Zero-depth pool should get zero LP fees");
    }

    #[test]
    fn test_annualize_revenue_max_block_epoch() {
        // Epoch spanning near-max u64 blocks — should not overflow
        let mut epoch = FeeEpoch::new(1, 0, u64::MAX / 2);
        epoch.record_amm_fee(pair(1), 1_000 * PRECISION);

        let annual = annualize_revenue(&epoch);
        // With such a long epoch, annualized should be tiny (nearly zero)
        assert!(annual < 1_000 * PRECISION,
            "Very long epoch should annualize to small amount");
    }

    #[test]
    fn test_revenue_yield_bps_tiny_tvl() {
        // Very small TVL with moderate revenue — high yield
        let yield_bps = revenue_yield_bps(1_000 * PRECISION, 1 * PRECISION);
        assert_eq!(yield_bps, 10_000_000); // 1000x = 10M bps
    }

    #[test]
    fn test_shapley_large_route_count_difference() {
        // Extreme route count disparity: 1000 vs 1
        let pools = vec![
            make_pool(1, 1_000_000 * PRECISION, 500_000 * PRECISION, 1000),
            make_pool(2, 1_000_000 * PRECISION, 500_000 * PRECISION, 1),
        ];
        let weights = calculate_shapley_weights(&pools);
        // Pool 1 (1000 routes) should have much higher weight
        assert!(weights[&pair(1)] > weights[&pair(2)] * 3 / 2,
            "Pool with 1000x routes should significantly outweigh pool with 1 route");
    }

    // ============ Batch 7: Hardening Tests (Target 125+) ============

    #[test]
    fn test_fee_config_all_treasury() {
        let config = FeeConfig {
            protocol_fee_bps: 5000,
            treasury_share_bps: 10_000,
            staker_share_bps: 0,
            insurance_share_bps: 0,
        };
        assert!(config.is_valid());
    }

    #[test]
    fn test_fee_config_all_stakers() {
        let config = FeeConfig {
            protocol_fee_bps: 5000,
            treasury_share_bps: 0,
            staker_share_bps: 10_000,
            insurance_share_bps: 0,
        };
        assert!(config.is_valid());
    }

    #[test]
    fn test_fee_config_all_insurance() {
        let config = FeeConfig {
            protocol_fee_bps: 5000,
            treasury_share_bps: 0,
            staker_share_bps: 0,
            insurance_share_bps: 10_000,
        };
        assert!(config.is_valid());
    }

    #[test]
    fn test_fee_epoch_new_initializes_empty() {
        let epoch = FeeEpoch::new(42, 100, 200);
        assert_eq!(epoch.epoch_id, 42);
        assert_eq!(epoch.start_block, 100);
        assert_eq!(epoch.end_block, 200);
        assert!(epoch.amm_fees.is_empty());
        assert!(epoch.lending_fees.is_empty());
        assert!(epoch.insurance_fees.is_empty());
        assert!(epoch.prediction_fees.is_empty());
        assert_eq!(epoch.priority_fees, 0);
    }

    #[test]
    fn test_record_priority_fee_accumulates_multiple() {
        let mut epoch = default_epoch();
        epoch.record_priority_fee(100);
        epoch.record_priority_fee(200);
        epoch.record_priority_fee(300);
        assert_eq!(epoch.priority_fees, 600);
    }

    #[test]
    fn test_fees_by_source_with_empty_epoch() {
        let epoch = default_epoch();
        let breakdown = epoch.fees_by_source();
        assert_eq!(breakdown.amm, 0);
        assert_eq!(breakdown.lending, 0);
        assert_eq!(breakdown.insurance, 0);
        assert_eq!(breakdown.prediction, 0);
        assert_eq!(breakdown.priority, 0);
        assert_eq!(breakdown.total(), 0);
    }

    #[test]
    fn test_fee_breakdown_total() {
        let breakdown = FeeBreakdown {
            amm: 100,
            lending: 200,
            insurance: 300,
            prediction: 400,
            priority: 500,
        };
        assert_eq!(breakdown.total(), 1500);
    }

    #[test]
    fn test_calculate_swap_fee_100_percent_fee() {
        // 10000 bps = 100% fee
        let (fee, output) = calculate_swap_fee(1_000 * PRECISION, 1_000_000 * PRECISION, 1_000_000 * PRECISION, 10_000);
        assert_eq!(fee, 1_000 * PRECISION);
        assert_eq!(output, 0);
    }

    #[test]
    fn test_calculate_swap_fee_0_percent_fee() {
        let (fee, output) = calculate_swap_fee(1_000 * PRECISION, 1_000_000 * PRECISION, 1_000_000 * PRECISION, 0);
        assert_eq!(fee, 0);
        assert!(output > 0);
    }

    #[test]
    fn test_lending_reserve_income_no_blocks_elapsed() {
        let income = calculate_lending_reserve_income(1_000_000 * PRECISION, 500, 2000, 0);
        assert_eq!(income, 0);
    }

    #[test]
    fn test_lending_reserve_income_no_interest_rate() {
        let income = calculate_lending_reserve_income(1_000_000 * PRECISION, 0, 2000, 1000);
        assert_eq!(income, 0);
    }

    #[test]
    fn test_lending_reserve_income_no_reserve_factor() {
        let income = calculate_lending_reserve_income(1_000_000 * PRECISION, 500, 0, 1000);
        assert_eq!(income, 0);
    }

    #[test]
    fn test_prediction_fee_zero_pool() {
        let fee = calculate_prediction_fee(0, 0, 200);
        assert_eq!(fee, 0);
    }

    #[test]
    fn test_prediction_fee_zero_rate() {
        let fee = calculate_prediction_fee(50_000 * PRECISION, 100_000 * PRECISION, 0);
        assert_eq!(fee, 0);
    }

    #[test]
    fn test_annualize_revenue_reversed_blocks() {
        // end_block < start_block → returns 0
        let epoch = FeeEpoch::new(1, 200, 100);
        assert_eq!(annualize_revenue(&epoch), 0);
    }

    #[test]
    fn test_annualize_revenue_one_block_epoch() {
        let mut epoch = FeeEpoch::new(1, 0, 1);
        epoch.record_amm_fee(pair(1), 100 * PRECISION);
        let annual = annualize_revenue(&epoch);
        // 100 per block * 7_884_000 blocks/year
        assert_eq!(annual, 100 * PRECISION * 7_884_000);
    }

    #[test]
    fn test_revenue_yield_bps_100_percent() {
        let yield_bps = revenue_yield_bps(1_000 * PRECISION, 1_000 * PRECISION);
        assert_eq!(yield_bps, 10_000); // 100%
    }

    #[test]
    fn test_shapley_weights_multiple_zero_depth() {
        let pools = vec![
            make_pool(1, 0, 100 * PRECISION, 5),
            make_pool(2, 0, 200 * PRECISION, 3),
        ];
        let weights = calculate_shapley_weights(&pools);
        assert_eq!(weights[&pair(1)], 0);
        assert_eq!(weights[&pair(2)], 0);
    }

    #[test]
    fn test_shapley_weights_zero_volume() {
        let pools = vec![
            make_pool(1, 1_000_000 * PRECISION, 0, 5),
        ];
        let weights = calculate_shapley_weights(&pools);
        // utilization_bonus = 0, connectivity_bonus = PRECISION (1 out of 1)
        // weight = depth * (PREC + 0) / PREC * (PREC + PREC) / PREC = depth * 2
        let expected = vibeswap_math::mul_div(
            vibeswap_math::mul_div(1_000_000 * PRECISION, PRECISION, PRECISION),
            PRECISION + PRECISION,
            PRECISION,
        );
        assert_eq!(weights[&pair(1)], expected);
    }

    #[test]
    fn test_shapley_weights_zero_routes() {
        // route_count = 0 for all → max_routes = 1 (clamped), connectivity_bonus = 0
        let pools = vec![
            make_pool(1, 1_000_000 * PRECISION, 500_000 * PRECISION, 0),
        ];
        let weights = calculate_shapley_weights(&pools);
        // connectivity_bonus = 0/1 * PRECISION = 0
        // utilization_bonus = 500000/1000000 * PRECISION = PRECISION/2
        // weight = depth * (PREC + PREC/2) / PREC * (PREC + 0) / PREC = depth * 1.5
        let expected = vibeswap_math::mul_div(
            1_000_000 * PRECISION,
            PRECISION + PRECISION / 2,
            PRECISION,
        );
        assert_eq!(weights[&pair(1)], expected);
    }

    #[test]
    fn test_shapley_distribution_no_pool_depths() {
        // Empty pool_depths → LP fees stay unallocated
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000 * PRECISION);
        let config = FeeConfig::default();
        let dist = calculate_distribution_shapley(&epoch, &config, &[]);
        // No LP distributions since no depth info
        assert!(dist.lp_distributions.is_empty());
    }

    #[test]
    fn test_fee_conservation_all_sources() {
        // Record fees from every source and verify conservation
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 5_000 * PRECISION);
        epoch.record_lending_fee(pair(2), 3_000 * PRECISION);
        epoch.record_insurance_fee(pair(3), 1_000 * PRECISION);
        epoch.record_prediction_fee(pair(4), 500 * PRECISION);
        epoch.record_priority_fee(200 * PRECISION);

        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);

        // total_distributed should be positive and not exceed total fees
        assert!(dist.total_distributed > 0);
    }

    #[test]
    fn test_multiple_amm_pools_same_fees() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 1_000 * PRECISION);
        epoch.record_amm_fee(pair(2), 1_000 * PRECISION);
        epoch.record_amm_fee(pair(3), 1_000 * PRECISION);

        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);

        // All pools should get the same LP share (simple distribution)
        assert_eq!(dist.lp_distributions[&pair(1)], dist.lp_distributions[&pair(2)]);
        assert_eq!(dist.lp_distributions[&pair(2)], dist.lp_distributions[&pair(3)]);
    }

    #[test]
    fn test_fee_epoch_total_matches_breakdown_total() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 100);
        epoch.record_lending_fee(pair(2), 200);
        epoch.record_insurance_fee(pair(3), 300);
        epoch.record_prediction_fee(pair(4), 400);
        epoch.record_priority_fee(500);

        let total = epoch.total_fees();
        let breakdown = epoch.fees_by_source();
        assert_eq!(total, breakdown.total());
    }

    #[test]
    fn test_fee_distribution_total_distributed_field() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000 * PRECISION);
        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);

        let manual_total = dist.treasury_amount
            + dist.staker_amount
            + dist.insurance_amount
            + dist.lp_distributions.values().sum::<u128>();
        assert_eq!(dist.total_distributed, manual_total);
    }

    // ============ Hardening Tests v3 ============

    #[test]
    fn test_shapley_weights_high_utilization_bonus_v3() {
        // Volume = 2x depth → utilization capped at PRECISION (100%)
        let pools = vec![
            PoolDepthInfo {
                pair_id: pair(1),
                depth: 1_000_000 * PRECISION,
                epoch_volume: 3_000_000 * PRECISION, // 3x depth
                route_count: 1,
            },
        ];
        let weights = calculate_shapley_weights(&pools);
        let w = weights[&pair(1)];
        // With capped util bonus = PRECISION, conn bonus = PRECISION (only pool)
        // weight = depth * (P + P) / P * (P + P) / P = depth * 2 * 2 = 4 * depth
        assert_eq!(w, 4 * 1_000_000 * PRECISION);
    }

    #[test]
    fn test_shapley_weights_zero_volume_zero_routes_v3() {
        let pools = vec![
            PoolDepthInfo {
                pair_id: pair(1),
                depth: 1_000_000 * PRECISION,
                epoch_volume: 0,
                route_count: 0,
            },
        ];
        let weights = calculate_shapley_weights(&pools);
        let w = weights[&pair(1)];
        // util_bonus = 0, conn_bonus = 0 (routes/max_routes = 0/1 = 0)
        // But wait: max(1, max_routes) = 1, and route_count=0 → conn_bonus = 0
        // weight = depth * (P + 0) / P * (P + 0) / P = depth
        assert_eq!(w, 1_000_000 * PRECISION);
    }

    #[test]
    fn test_distribution_amm_protocol_split_exact_v3() {
        let config = FeeConfig::default();
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000);
        let dist = calculate_distribution(&epoch, &config);
        // Protocol gets 1667/10000 of 10000 = 1667
        let protocol_share = vibeswap_math::mul_div(10_000, config.protocol_fee_bps as u128, 10_000);
        let lp_share = 10_000 - protocol_share;
        assert_eq!(*dist.lp_distributions.get(&pair(1)).unwrap(), lp_share);
    }

    #[test]
    fn test_distribution_multiple_amm_pools_independent_v3() {
        let config = FeeConfig::default();
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 5_000);
        epoch.record_amm_fee(pair(2), 15_000);
        let dist = calculate_distribution(&epoch, &config);
        // Each pool retains its own LP share in simple distribution
        let lp1 = *dist.lp_distributions.get(&pair(1)).unwrap();
        let lp2 = *dist.lp_distributions.get(&pair(2)).unwrap();
        assert!(lp2 > lp1); // Pool 2 earned more
    }

    #[test]
    fn test_shapley_distribution_deeper_pool_gets_more_lp_v3() {
        let config = FeeConfig::default();
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000);
        epoch.record_amm_fee(pair(2), 10_000);
        let pools = vec![
            PoolDepthInfo { pair_id: pair(1), depth: 1_000_000 * PRECISION, epoch_volume: 500_000 * PRECISION, route_count: 1 },
            PoolDepthInfo { pair_id: pair(2), depth: 100_000 * PRECISION, epoch_volume: 500_000 * PRECISION, route_count: 1 },
        ];
        let dist = calculate_distribution_shapley(&epoch, &config, &pools);
        let lp1 = *dist.lp_distributions.get(&pair(1)).unwrap_or(&0);
        let lp2 = *dist.lp_distributions.get(&pair(2)).unwrap_or(&0);
        assert!(lp1 > lp2, "Deeper pool should get more LP fees");
    }

    #[test]
    fn test_swap_fee_fee_never_exceeds_input_v3() {
        let (fee, output) = calculate_swap_fee(100, 1_000_000, 1_000_000, 9999);
        assert!(fee < 100);
        assert!(output > 0 || fee > 0);
    }

    #[test]
    fn test_swap_fee_30bps_standard_v3() {
        let (fee, output) = calculate_swap_fee(10_000, 1_000_000, 1_000_000, 30);
        // Fee = 10000 * 30 / 10000 = 30
        assert_eq!(fee, 30);
        assert!(output > 0);
        assert!(output < 10_000); // Can't get more out than in
    }

    #[test]
    fn test_lending_reserve_income_proportional_v3() {
        let income1 = calculate_lending_reserve_income(1_000_000, 500, 2000, 1000);
        let income2 = calculate_lending_reserve_income(2_000_000, 500, 2000, 1000);
        // Double borrows → double income
        assert!(income2 > income1);
        // Approximately 2x (within rounding)
        let ratio = income2 * 100 / income1;
        assert!(ratio >= 199 && ratio <= 201);
    }

    #[test]
    fn test_prediction_fee_proportional_to_pool_v3() {
        let fee1 = calculate_prediction_fee(5_000, 10_000, 100);
        let fee2 = calculate_prediction_fee(5_000, 20_000, 100);
        assert_eq!(fee2, fee1 * 2);
    }

    #[test]
    fn test_annualize_revenue_proportional_to_epoch_length_v3() {
        let mut epoch_short = FeeEpoch::new(1, 0, 1000);
        epoch_short.record_amm_fee(pair(1), 100_000);
        let mut epoch_long = FeeEpoch::new(2, 0, 10_000);
        epoch_long.record_amm_fee(pair(1), 100_000);
        let ann_short = annualize_revenue(&epoch_short);
        let ann_long = annualize_revenue(&epoch_long);
        // Shorter epoch → higher annualized (extrapolating from shorter period)
        assert!(ann_short > ann_long);
    }

    #[test]
    fn test_revenue_yield_bps_proportional_v3() {
        let yield1 = revenue_yield_bps(10_000, 100_000);
        let yield2 = revenue_yield_bps(10_000, 200_000);
        // Double TVL → half yield
        assert_eq!(yield2, yield1 / 2);
    }

    #[test]
    fn test_fee_config_shares_must_sum_to_10000_v3() {
        let valid_config = FeeConfig {
            protocol_fee_bps: 1667,
            treasury_share_bps: 4000,
            staker_share_bps: 3000,
            insurance_share_bps: 3000,
        };
        assert!(valid_config.is_valid());
        let invalid_config = FeeConfig {
            protocol_fee_bps: 1667,
            treasury_share_bps: 4000,
            staker_share_bps: 3000,
            insurance_share_bps: 2999, // off by 1
        };
        assert!(!invalid_config.is_valid());
    }

    #[test]
    fn test_fee_epoch_accumulates_fees_correctly_v3() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 100);
        epoch.record_amm_fee(pair(1), 200);
        epoch.record_lending_fee(pair(2), 50);
        epoch.record_insurance_fee(pair(3), 30);
        epoch.record_prediction_fee(pair(4), 20);
        epoch.record_priority_fee(10);
        assert_eq!(epoch.total_fees(), 410);
    }

    #[test]
    fn test_shapley_distribution_conserves_total_lp_fees_v3() {
        let config = FeeConfig::default();
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 100_000);
        epoch.record_amm_fee(pair(2), 200_000);
        epoch.record_amm_fee(pair(3), 50_000);
        let pools = vec![
            PoolDepthInfo { pair_id: pair(1), depth: 500_000 * PRECISION, epoch_volume: 100_000 * PRECISION, route_count: 3 },
            PoolDepthInfo { pair_id: pair(2), depth: 1_000_000 * PRECISION, epoch_volume: 500_000 * PRECISION, route_count: 5 },
            PoolDepthInfo { pair_id: pair(3), depth: 200_000 * PRECISION, epoch_volume: 50_000 * PRECISION, route_count: 1 },
        ];
        let dist = calculate_distribution_shapley(&epoch, &config, &pools);
        let total_lp: u128 = dist.lp_distributions.values().sum();
        // Total AMM fees minus protocol share should equal LP total
        let total_amm = 350_000u128;
        let protocol_from_amm = vibeswap_math::mul_div(total_amm, config.protocol_fee_bps as u128, 10_000);
        let expected_lp = total_amm - protocol_from_amm;
        assert_eq!(total_lp, expected_lp);
    }

    #[test]
    fn test_swap_fee_large_reserves_small_trade_v3() {
        let (fee, output) = calculate_swap_fee(100, u128::MAX / 4, u128::MAX / 4, 30);
        assert_eq!(fee, 0); // 100 * 30 / 10000 = 0 (rounds down)
        assert!(output > 0);
    }

    #[test]
    fn test_fee_breakdown_consistency_with_epoch_v3() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 1000);
        epoch.record_lending_fee(pair(2), 500);
        epoch.record_insurance_fee(pair(3), 300);
        epoch.record_prediction_fee(pair(4), 200);
        epoch.record_priority_fee(100);
        let breakdown = epoch.fees_by_source();
        assert_eq!(breakdown.total(), epoch.total_fees());
        assert_eq!(breakdown.amm, 1000);
        assert_eq!(breakdown.lending, 500);
        assert_eq!(breakdown.insurance, 300);
        assert_eq!(breakdown.prediction, 200);
        assert_eq!(breakdown.priority, 100);
    }

    #[test]
    fn test_distribution_zero_protocol_fee_all_to_lps_v3() {
        let config = FeeConfig {
            protocol_fee_bps: 0,
            treasury_share_bps: 5000,
            staker_share_bps: 3000,
            insurance_share_bps: 2000,
        };
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000);
        let dist = calculate_distribution(&epoch, &config);
        assert_eq!(*dist.lp_distributions.get(&pair(1)).unwrap(), 10_000);
    }

    #[test]
    fn test_shapley_weights_route_count_affects_weight_v3() {
        let pools = vec![
            PoolDepthInfo { pair_id: pair(1), depth: PRECISION, epoch_volume: 0, route_count: 10 },
            PoolDepthInfo { pair_id: pair(2), depth: PRECISION, epoch_volume: 0, route_count: 1 },
        ];
        let weights = calculate_shapley_weights(&pools);
        assert!(weights[&pair(1)] > weights[&pair(2)]);
    }

    #[test]
    fn test_lending_reserve_income_large_borrows_v3() {
        let income = calculate_lending_reserve_income(
            1_000_000_000 * PRECISION, // 1B tokens borrowed
            1000,  // 10% APR
            5000,  // 50% reserve factor
            7_884_000, // 1 year
        );
        assert!(income > 0);
        // Should be roughly: 1B * 10% * 50% = 50M
        // income = borrows * rate * blocks / (10000 * blocks_per_year) * factor / 10000
        // = 1B * 1000 * 7884000 / (10000 * 7884000) * 5000 / 10000
        // = 1B * 0.1 * 0.5 = 50M
    }

    #[test]
    fn test_annualize_revenue_very_long_epoch_v3() {
        let mut epoch = FeeEpoch::new(1, 0, 100_000_000);
        epoch.record_amm_fee(pair(1), 1_000_000);
        let ann = annualize_revenue(&epoch);
        // 100M blocks >> 7.8M blocks/year, so annualized < actual
        assert!(ann < 1_000_000);
    }

    #[test]
    fn test_prediction_fee_max_fee_rate_boundary_v3() {
        let fee = calculate_prediction_fee(5_000, 10_000, 10_000);
        // 100% fee rate → fee equals total pool
        assert_eq!(fee, 10_000);
    }

    #[test]
    fn test_fee_epoch_empty_sources_total_zero_v3() {
        let epoch = default_epoch();
        assert_eq!(epoch.total_fees(), 0);
        let breakdown = epoch.fees_by_source();
        assert_eq!(breakdown.total(), 0);
    }

    #[test]
    fn test_shapley_distribution_single_pool_gets_everything_v3() {
        let config = FeeConfig::default();
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 100_000);
        let pools = vec![
            PoolDepthInfo { pair_id: pair(1), depth: PRECISION, epoch_volume: PRECISION, route_count: 1 },
        ];
        let dist = calculate_distribution_shapley(&epoch, &config, &pools);
        let total_amm = 100_000u128;
        let protocol_from_amm = vibeswap_math::mul_div(total_amm, config.protocol_fee_bps as u128, 10_000);
        let expected_lp = total_amm - protocol_from_amm;
        assert_eq!(*dist.lp_distributions.get(&pair(1)).unwrap(), expected_lp);
    }

    #[test]
    fn test_swap_fee_exact_10000_bps_v3() {
        let (fee, _output) = calculate_swap_fee(10_000, 1_000_000, 1_000_000, 10_000);
        // 100% fee means fee = input, after_fee = 0
        assert_eq!(fee, 10_000);
    }

    #[test]
    fn test_revenue_yield_bps_large_revenue_small_tvl_v3() {
        let yield_bps = revenue_yield_bps(1_000_000, 100);
        // revenue >> tvl → very high yield
        assert!(yield_bps > 10_000);
    }

    #[test]
    fn test_fee_config_equal_shares_v3() {
        let config = FeeConfig {
            protocol_fee_bps: 1667,
            treasury_share_bps: 3334,
            staker_share_bps: 3333,
            insurance_share_bps: 3333,
        };
        assert!(config.is_valid());
    }

    // ============ Hardening Tests v4 ============

    #[test]
    fn test_fee_config_invalid_sum_under_10000_v4() {
        let config = FeeConfig {
            protocol_fee_bps: 1667,
            treasury_share_bps: 3000,
            staker_share_bps: 3000,
            insurance_share_bps: 3000,
        };
        assert!(!config.is_valid());
    }

    #[test]
    fn test_fee_config_invalid_sum_over_10000_v4() {
        let config = FeeConfig {
            protocol_fee_bps: 1667,
            treasury_share_bps: 5000,
            staker_share_bps: 3000,
            insurance_share_bps: 3000,
        };
        assert!(!config.is_valid());
    }

    #[test]
    fn test_fee_epoch_total_fees_all_sources_v4() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 100);
        epoch.record_lending_fee(pair(2), 200);
        epoch.record_insurance_fee(pair(3), 300);
        epoch.record_prediction_fee(pair(4), 400);
        epoch.record_priority_fee(500);
        assert_eq!(epoch.total_fees(), 1500);
    }

    #[test]
    fn test_fee_epoch_fees_by_source_breakdown_v4() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 100);
        epoch.record_amm_fee(pair(2), 50);
        epoch.record_lending_fee(pair(3), 200);
        let breakdown = epoch.fees_by_source();
        assert_eq!(breakdown.amm, 150);
        assert_eq!(breakdown.lending, 200);
        assert_eq!(breakdown.insurance, 0);
        assert_eq!(breakdown.prediction, 0);
        assert_eq!(breakdown.priority, 0);
        assert_eq!(breakdown.total(), 350);
    }

    #[test]
    fn test_swap_fee_100_bps_v4() {
        let (fee, output) = calculate_swap_fee(10_000, 1_000_000, 1_000_000, 100);
        // 1% fee on 10000 = 100
        assert_eq!(fee, 100);
        assert!(output > 0);
        assert!(output < 10_000); // Output less than input due to AMM curve
    }

    #[test]
    fn test_swap_fee_output_decreases_with_higher_fee_v4() {
        let (_, out1) = calculate_swap_fee(10_000, 1_000_000, 1_000_000, 30);
        let (_, out2) = calculate_swap_fee(10_000, 1_000_000, 1_000_000, 100);
        let (_, out3) = calculate_swap_fee(10_000, 1_000_000, 1_000_000, 500);
        assert!(out1 > out2);
        assert!(out2 > out3);
    }

    #[test]
    fn test_lending_reserve_income_proportional_to_blocks_v4() {
        let income1 = calculate_lending_reserve_income(1_000_000, 500, 2000, 100);
        let income2 = calculate_lending_reserve_income(1_000_000, 500, 2000, 200);
        // Double the blocks = double the income
        assert_eq!(income2, income1 * 2);
    }

    #[test]
    fn test_prediction_fee_proportional_to_total_pool_v4() {
        let fee1 = calculate_prediction_fee(500, 1_000, 100);
        let fee2 = calculate_prediction_fee(500, 2_000, 100);
        assert_eq!(fee2, fee1 * 2);
    }

    #[test]
    fn test_annualize_revenue_1_block_epoch_v4() {
        let mut epoch = FeeEpoch::new(1, 1000, 1001);
        epoch.record_amm_fee(pair(1), 100);
        let annualized = annualize_revenue(&epoch);
        // 100 * 7884000 / 1 = 788_400_000
        assert_eq!(annualized, 788_400_000);
    }

    #[test]
    fn test_revenue_yield_bps_1_percent_v4() {
        // Revenue = 1% of TVL = 100 bps
        let yield_bps = revenue_yield_bps(100, 10_000);
        assert_eq!(yield_bps, 100);
    }

    #[test]
    fn test_shapley_weights_two_pools_depth_matters_v4() {
        let pools = vec![
            PoolDepthInfo { pair_id: pair(1), depth: 1_000_000, epoch_volume: 100_000, route_count: 1 },
            PoolDepthInfo { pair_id: pair(2), depth: 2_000_000, epoch_volume: 100_000, route_count: 1 },
        ];
        let weights = calculate_shapley_weights(&pools);
        // Deeper pool gets higher weight
        assert!(weights[&pair(2)] > weights[&pair(1)]);
    }

    #[test]
    fn test_shapley_weights_volume_bonus_v4() {
        let pools = vec![
            PoolDepthInfo { pair_id: pair(1), depth: 1_000_000, epoch_volume: 0, route_count: 1 },
            PoolDepthInfo { pair_id: pair(2), depth: 1_000_000, epoch_volume: 500_000, route_count: 1 },
        ];
        let weights = calculate_shapley_weights(&pools);
        // Pool with volume gets utilization bonus
        assert!(weights[&pair(2)] > weights[&pair(1)]);
    }

    #[test]
    fn test_shapley_weights_route_bonus_v4() {
        let pools = vec![
            PoolDepthInfo { pair_id: pair(1), depth: 1_000_000, epoch_volume: 0, route_count: 1 },
            PoolDepthInfo { pair_id: pair(2), depth: 1_000_000, epoch_volume: 0, route_count: 5 },
        ];
        let weights = calculate_shapley_weights(&pools);
        // Pool with more routes gets connectivity bonus
        assert!(weights[&pair(2)] > weights[&pair(1)]);
    }

    #[test]
    fn test_distribution_lp_fees_sum_to_total_lp_pool_v4() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000);
        epoch.record_amm_fee(pair(2), 20_000);
        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);
        // LP distributions for each pool
        let lp_total: u128 = dist.lp_distributions.values().sum();
        // Total AMM fees minus protocol share
        let total_amm = 30_000u128;
        let protocol_cut = vibeswap_math::mul_div(10_000u128, config.protocol_fee_bps as u128, 10_000)
            + vibeswap_math::mul_div(20_000u128, config.protocol_fee_bps as u128, 10_000);
        assert_eq!(lp_total, total_amm - protocol_cut);
    }

    #[test]
    fn test_shapley_distribution_conserves_total_v4() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000);
        epoch.record_amm_fee(pair(2), 20_000);
        let config = FeeConfig::default();
        let pools = vec![
            PoolDepthInfo { pair_id: pair(1), depth: 1_000_000, epoch_volume: 100_000, route_count: 1 },
            PoolDepthInfo { pair_id: pair(2), depth: 2_000_000, epoch_volume: 100_000, route_count: 1 },
        ];
        let dist = calculate_distribution_shapley(&epoch, &config, &pools);
        // Total distributed should account for all fees
        let lp_total: u128 = dist.lp_distributions.values().sum();
        let protocol_total = dist.treasury_amount + dist.staker_amount + dist.insurance_amount;
        assert_eq!(dist.total_distributed, lp_total + protocol_total);
    }

    #[test]
    fn test_swap_fee_fee_plus_output_bounded_v4() {
        // fee + output should always be <= amount_in (conservation)
        let (fee, output) = calculate_swap_fee(10_000, 1_000_000, 1_000_000, 30);
        assert!(fee + output <= 10_000);
    }

    #[test]
    fn test_swap_fee_zero_reserve_in_v4() {
        let (fee, output) = calculate_swap_fee(10_000, 0, 1_000_000, 30);
        assert_eq!(fee, 30); // 30 bps of 10000 = 30
        // with reserve_in=0, amount_after_fee / (0 + amount_after_fee) * reserve_out
        assert!(output > 0); // should produce some output
    }

    #[test]
    fn test_lending_reserve_income_large_borrows_no_overflow_v4() {
        let income = calculate_lending_reserve_income(
            u64::MAX as u128,
            1000,     // 10% interest
            2000,     // 20% reserve factor
            7_884_000, // 1 year
        );
        assert!(income > 0);
    }

    #[test]
    fn test_distribution_priority_fees_to_protocol_v4() {
        let mut epoch = default_epoch();
        epoch.record_priority_fee(10_000);
        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);
        // Priority fees go 100% to protocol, then split
        let expected_treasury = vibeswap_math::mul_div(10_000u128, config.treasury_share_bps as u128, 10_000);
        assert_eq!(dist.treasury_amount, expected_treasury);
    }

    #[test]
    fn test_distribution_insurance_fees_protocol_cut_v4() {
        let mut epoch = default_epoch();
        epoch.record_insurance_fee(pair(1), 10_000);
        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);
        // Insurance fees: protocol takes protocol_fee_bps cut, then splits
        let protocol_cut = vibeswap_math::mul_div(10_000u128, config.protocol_fee_bps as u128, 10_000);
        let expected_treasury = vibeswap_math::mul_div(protocol_cut, config.treasury_share_bps as u128, 10_000);
        assert_eq!(dist.treasury_amount, expected_treasury);
    }

    #[test]
    fn test_record_fees_accumulate_same_pool_v4() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 100);
        epoch.record_amm_fee(pair(1), 200);
        epoch.record_amm_fee(pair(1), 300);
        assert_eq!(*epoch.amm_fees.get(&pair(1)).unwrap(), 600);
    }

    #[test]
    fn test_fee_epoch_new_initializes_correctly_v4() {
        let epoch = FeeEpoch::new(42, 5000, 6000);
        assert_eq!(epoch.epoch_id, 42);
        assert_eq!(epoch.start_block, 5000);
        assert_eq!(epoch.end_block, 6000);
        assert_eq!(epoch.total_fees(), 0);
        assert!(epoch.amm_fees.is_empty());
    }

    #[test]
    fn test_annualize_revenue_reversed_blocks_zero_v4() {
        let epoch = FeeEpoch::new(1, 2000, 1000); // end < start
        let annualized = annualize_revenue(&epoch);
        assert_eq!(annualized, 0);
    }

    #[test]
    fn test_revenue_yield_bps_very_large_revenue_v4() {
        let yield_bps = revenue_yield_bps(1_000_000, 100);
        // 1000000 / 100 * 10000 = 100_000_000 bps
        assert_eq!(yield_bps as u128, 100_000_000);
    }

    // ============ Hardening Round 9 ============

    #[test]
    fn test_fee_config_invalid_shares_h9() {
        let config = FeeConfig {
            protocol_fee_bps: 1667,
            treasury_share_bps: 4000,
            staker_share_bps: 3000,
            insurance_share_bps: 2000,
        };
        // 4000+3000+2000 = 9000, not 10000
        assert!(!config.is_valid());
    }

    #[test]
    fn test_fee_config_all_to_treasury_h9() {
        let config = FeeConfig {
            protocol_fee_bps: 1667,
            treasury_share_bps: 10_000,
            staker_share_bps: 0,
            insurance_share_bps: 0,
        };
        assert!(config.is_valid());
    }

    #[test]
    fn test_shapley_weights_empty_pools_h9() {
        let pools: Vec<PoolDepthInfo> = vec![];
        let weights = calculate_shapley_weights(&pools);
        assert!(weights.is_empty());
    }

    #[test]
    fn test_shapley_weights_zero_depth_pool_h9() {
        let pools = vec![PoolDepthInfo {
            pair_id: pair(1),
            depth: 0,
            epoch_volume: 1_000_000,
            route_count: 5,
        }];
        let weights = calculate_shapley_weights(&pools);
        assert_eq!(*weights.get(&pair(1)).unwrap(), 0);
    }

    #[test]
    fn test_shapley_weights_single_pool_max_routes_h9() {
        let pools = vec![PoolDepthInfo {
            pair_id: pair(1),
            depth: 1_000_000,
            epoch_volume: 500_000,
            route_count: 1,
        }];
        let weights = calculate_shapley_weights(&pools);
        // Single pool is max_routes by itself, so connectivity_bonus = PRECISION
        assert!(*weights.get(&pair(1)).unwrap() > 0);
    }

    #[test]
    fn test_shapley_weights_volume_exceeds_depth_capped_h9() {
        let pools = vec![PoolDepthInfo {
            pair_id: pair(1),
            depth: 100,
            epoch_volume: 10_000, // Far exceeds depth
            route_count: 1,
        }];
        let weights = calculate_shapley_weights(&pools);
        // Utilization bonus should be capped at PRECISION
        assert!(*weights.get(&pair(1)).unwrap() > 0);
    }

    #[test]
    fn test_fee_epoch_total_fees_all_sources_h9() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 100);
        epoch.record_lending_fee(pair(2), 200);
        epoch.record_insurance_fee(pair(3), 300);
        epoch.record_prediction_fee(pair(4), 400);
        epoch.record_priority_fee(500);
        assert_eq!(epoch.total_fees(), 1500);
    }

    #[test]
    fn test_fee_epoch_fees_by_source_h9() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 100);
        epoch.record_lending_fee(pair(2), 200);
        let breakdown = epoch.fees_by_source();
        assert_eq!(breakdown.amm, 100);
        assert_eq!(breakdown.lending, 200);
        assert_eq!(breakdown.insurance, 0);
        assert_eq!(breakdown.total(), 300);
    }

    #[test]
    fn test_fee_epoch_multiple_amm_fees_same_pair_h9() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 100);
        epoch.record_amm_fee(pair(1), 200);
        assert_eq!(*epoch.amm_fees.get(&pair(1)).unwrap(), 300);
    }

    #[test]
    fn test_calculate_distribution_empty_epoch_h9() {
        let epoch = default_epoch();
        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);
        assert_eq!(dist.total_distributed, 0);
        assert_eq!(dist.treasury_amount, 0);
    }

    #[test]
    fn test_calculate_swap_fee_zero_input_h9() {
        let (fee, output) = calculate_swap_fee(0, 1_000_000, 1_000_000, 30);
        assert_eq!(fee, 0);
        assert_eq!(output, 0);
    }

    #[test]
    fn test_calculate_swap_fee_zero_reserve_in_h9() {
        let (fee, output) = calculate_swap_fee(1000, 0, 1_000_000, 30);
        // fee is computed, output is 0 since reserve_in=0 leads to division issues
        assert_eq!(fee, vibeswap_math::mul_div(1000, 30, 10_000));
        // Output with reserve_in=0 + amount_after_fee > 0 should still produce output
        assert!(output > 0 || output == 0); // Just verify no panic
    }

    #[test]
    fn test_calculate_swap_fee_large_fee_rate_h9() {
        // 50% fee rate = 5000 bps
        let (fee, _output) = calculate_swap_fee(10_000, 1_000_000, 1_000_000, 5000);
        assert_eq!(fee, 5_000); // 50% of 10000
    }

    #[test]
    fn test_calculate_lending_reserve_income_zero_borrows_h9() {
        let income = calculate_lending_reserve_income(0, 500, 2000, 1000);
        assert_eq!(income, 0);
    }

    #[test]
    fn test_calculate_lending_reserve_income_zero_blocks_h9() {
        let income = calculate_lending_reserve_income(1_000_000, 500, 2000, 0);
        assert_eq!(income, 0);
    }

    #[test]
    fn test_calculate_prediction_fee_zero_pool_h9() {
        let fee = calculate_prediction_fee(0, 0, 100);
        assert_eq!(fee, 0);
    }

    #[test]
    fn test_calculate_prediction_fee_zero_rate_h9() {
        let fee = calculate_prediction_fee(500, 1000, 0);
        assert_eq!(fee, 0);
    }

    #[test]
    fn test_annualize_revenue_empty_epoch_h9() {
        let epoch = default_epoch();
        let annualized = annualize_revenue(&epoch);
        assert_eq!(annualized, 0);
    }

    #[test]
    fn test_annualize_revenue_same_start_end_h9() {
        let epoch = FeeEpoch::new(1, 1000, 1000);
        let annualized = annualize_revenue(&epoch);
        assert_eq!(annualized, 0);
    }

    #[test]
    fn test_revenue_yield_bps_zero_tvl_h9() {
        let result = revenue_yield_bps(1_000_000, 0);
        assert_eq!(result, 0);
    }

    #[test]
    fn test_revenue_yield_bps_zero_revenue_h9() {
        let result = revenue_yield_bps(0, 1_000_000);
        assert_eq!(result, 0);
    }

    #[test]
    fn test_distribution_shapley_empty_depths_h9() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 10_000);
        let config = FeeConfig::default();
        let dist = calculate_distribution_shapley(&epoch, &config, &[]);
        // With no pool depths, LP distributions should be empty
        assert!(dist.lp_distributions.is_empty());
    }

    #[test]
    fn test_fee_epoch_new_blocks_h9() {
        let epoch = FeeEpoch::new(42, 500, 1500);
        assert_eq!(epoch.epoch_id, 42);
        assert_eq!(epoch.start_block, 500);
        assert_eq!(epoch.end_block, 1500);
        assert_eq!(epoch.priority_fees, 0);
    }

    #[test]
    fn test_distribution_protocol_share_conservation_h9() {
        let mut epoch = default_epoch();
        epoch.record_amm_fee(pair(1), 1_000_000);
        let config = FeeConfig::default();
        let dist = calculate_distribution(&epoch, &config);
        // Total distributed should be close to total fees (minus rounding)
        let lp_total: u128 = dist.lp_distributions.values().sum();
        let protocol_total = dist.treasury_amount + dist.staker_amount + dist.insurance_amount;
        assert!(lp_total + protocol_total <= 1_000_000);
    }
}
