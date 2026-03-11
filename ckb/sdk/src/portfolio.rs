// ============ Portfolio Analytics — Cross-Protocol Position Tracking ============
// Aggregates a user's positions across all VibeSwap protocols into a unified
// portfolio view with risk metrics, yield estimates, and rebalancing suggestions.
//
// A portfolio consists of:
// - AMM LP positions (pool shares, impermanent loss tracking)
// - Lending vaults (collateral, debt, health factor)
// - Insurance deposits (shares, premium yield)
// - Prediction market positions (active bets, settled claims)
// - Token balances (raw xUDT holdings)
//
// All values are denominated in a common unit (the "quote" token, typically USD-like)
// using oracle prices for conversion.

use std::collections::BTreeMap;

use vibeswap_types::*;
use vibeswap_math::PRECISION;

// ============ Constants ============

/// Minimum position value to include (dust filter)
const MIN_POSITION_VALUE: u128 = 1_000; // 0.001 in 1e6 terms

/// Blocks per year estimate for APY calculations (CKB ~4s blocks)
const BLOCKS_PER_YEAR: u128 = 7_884_000; // 365.25 * 24 * 3600 / 4

// ============ Position Types ============

/// A user's LP position in an AMM pool
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LPPosition {
    pub pool_id: [u8; 32],
    pub lp_amount: u128,
    pub entry_price: u128,
    pub deposit_block: u64,
    /// Current value of token0 share (calculated from reserves)
    pub token0_value: u128,
    /// Current value of token1 share (calculated from reserves)
    pub token1_value: u128,
    /// Impermanent loss in basis points (0 = no IL, positive = loss)
    pub il_bps: u16,
}

/// A user's lending vault position
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LendingPosition {
    pub pool_id: [u8; 32],
    pub collateral_amount: u128,
    pub collateral_value: u128,
    pub debt_amount: u128,
    pub debt_value: u128,
    pub health_factor: u128,
    pub deposit_shares: u128,
    pub deposit_value: u128,
    pub net_value: u128, // collateral_value + deposit_value - debt_value
}

/// A user's insurance pool deposit
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InsurancePosition {
    pub pool_id: [u8; 32],
    pub shares: u128,
    pub underlying_value: u128,
    pub premium_yield_bps: u16,
}

/// A user's prediction market bet
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PredictionPosition {
    pub market_id: [u8; 32],
    pub tier_index: u8,
    pub amount: u128,
    pub potential_payout: u128,
    pub is_settled: bool,
}

/// A raw token balance
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TokenBalance {
    pub token_type_hash: [u8; 32],
    pub amount: u128,
    pub value: u128, // In quote denomination
}

// ============ Portfolio Summary ============

/// Complete portfolio snapshot for a single user
#[derive(Clone, Debug)]
pub struct Portfolio {
    /// Owner's lock script hash
    pub owner_lock_hash: [u8; 32],
    /// LP positions across all pools
    pub lp_positions: Vec<LPPosition>,
    /// Lending vault positions
    pub lending_positions: Vec<LendingPosition>,
    /// Insurance deposits
    pub insurance_positions: Vec<InsurancePosition>,
    /// Prediction market bets
    pub prediction_positions: Vec<PredictionPosition>,
    /// Token balances
    pub token_balances: Vec<TokenBalance>,
    /// Aggregate metrics
    pub summary: PortfolioSummary,
}

/// Aggregate portfolio metrics
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PortfolioSummary {
    /// Total portfolio value in quote denomination
    pub total_value: u128,
    /// Total value in LP positions
    pub lp_value: u128,
    /// Total value in lending (net = collateral + deposits - debt)
    pub lending_net_value: u128,
    /// Total value in insurance deposits
    pub insurance_value: u128,
    /// Total value in prediction positions
    pub prediction_value: u128,
    /// Total token balances value
    pub token_value: u128,
    /// Total collateral across all vaults
    pub total_collateral: u128,
    /// Total debt across all vaults
    pub total_debt: u128,
    /// Worst health factor across all vaults (u128::MAX if no vaults)
    pub worst_health_factor: u128,
    /// Estimated annual yield in basis points (weighted average)
    pub estimated_apy_bps: u64,
    /// Portfolio concentration: largest position as % of total (bps)
    pub concentration_bps: u64,
    /// Number of distinct protocols used
    pub protocol_count: u8,
}

// ============ Oracle Prices ============

/// Price map: token_type_hash → price in quote denomination
pub type PriceMap = BTreeMap<[u8; 32], u128>;

// ============ Portfolio Builder ============

/// Build a portfolio from on-chain cell data
pub struct PortfolioBuilder {
    owner: [u8; 32],
    prices: PriceMap,
    lp_data: Vec<(LPPositionCellData, PoolCellData)>,
    vaults: Vec<(VaultCellData, LendingPoolCellData)>,
    insurance: Vec<(InsurancePoolCellData, u128)>, // (pool_data, user_shares)
    predictions: Vec<(PredictionMarketCellData, PredictionPositionCellData)>,
    tokens: Vec<([u8; 32], u128)>, // (token_type_hash, amount)
}

impl PortfolioBuilder {
    pub fn new(owner: [u8; 32], prices: PriceMap) -> Self {
        Self {
            owner,
            prices,
            lp_data: Vec::new(),
            vaults: Vec::new(),
            insurance: Vec::new(),
            predictions: Vec::new(),
            tokens: Vec::new(),
        }
    }

    /// Add an LP position with its pool's current state
    pub fn add_lp(&mut self, lp: LPPositionCellData, pool: PoolCellData) -> &mut Self {
        self.lp_data.push((lp, pool));
        self
    }

    /// Add a lending vault with its pool's current state
    pub fn add_vault(&mut self, vault: VaultCellData, pool: LendingPoolCellData) -> &mut Self {
        self.vaults.push((vault, pool));
        self
    }

    /// Add an insurance position (pool data + user's share count)
    pub fn add_insurance(&mut self, pool: InsurancePoolCellData, user_shares: u128) -> &mut Self {
        self.insurance.push((pool, user_shares));
        self
    }

    /// Add a prediction market position
    pub fn add_prediction(
        &mut self,
        market: PredictionMarketCellData,
        position: PredictionPositionCellData,
    ) -> &mut Self {
        self.predictions.push((market, position));
        self
    }

    /// Add a raw token balance
    pub fn add_token(&mut self, token_type_hash: [u8; 32], amount: u128) -> &mut Self {
        self.tokens.push((token_type_hash, amount));
        self
    }

    /// Build the complete portfolio snapshot
    pub fn build(&self) -> Portfolio {
        let lp_positions = self.build_lp_positions();
        let lending_positions = self.build_lending_positions();
        let insurance_positions = self.build_insurance_positions();
        let prediction_positions = self.build_prediction_positions();
        let token_balances = self.build_token_balances();

        let summary = self.compute_summary(
            &lp_positions,
            &lending_positions,
            &insurance_positions,
            &prediction_positions,
            &token_balances,
        );

        Portfolio {
            owner_lock_hash: self.owner,
            lp_positions,
            lending_positions,
            insurance_positions,
            prediction_positions,
            token_balances,
            summary,
        }
    }

    // ============ Position Builders ============

    fn build_lp_positions(&self) -> Vec<LPPosition> {
        self.lp_data
            .iter()
            .map(|(lp, pool)| {
                // User's share of reserves
                let token0_share = if pool.total_lp_supply > 0 {
                    vibeswap_math::mul_div(lp.lp_amount, pool.reserve0, pool.total_lp_supply)
                } else {
                    0
                };
                let token1_share = if pool.total_lp_supply > 0 {
                    vibeswap_math::mul_div(lp.lp_amount, pool.reserve1, pool.total_lp_supply)
                } else {
                    0
                };

                let price0 = self.prices.get(&pool.token0_type_hash).copied().unwrap_or(0);
                let price1 = self.prices.get(&pool.token1_type_hash).copied().unwrap_or(0);

                let token0_value = vibeswap_math::mul_div(token0_share, price0, PRECISION);
                let token1_value = vibeswap_math::mul_div(token1_share, price1, PRECISION);

                let il_bps = calculate_il(lp.entry_price, pool, price0, price1);

                LPPosition {
                    pool_id: pool.pair_id,
                    lp_amount: lp.lp_amount,
                    entry_price: lp.entry_price,
                    deposit_block: lp.deposit_block,
                    token0_value,
                    token1_value,
                    il_bps,
                }
            })
            .collect()
    }

    fn build_lending_positions(&self) -> Vec<LendingPosition> {
        self.vaults
            .iter()
            .map(|(vault, pool)| {
                let collateral_price = self
                    .prices
                    .get(&vault.collateral_type_hash)
                    .copied()
                    .unwrap_or(0);
                let debt_price = self
                    .prices
                    .get(&pool.asset_type_hash)
                    .copied()
                    .unwrap_or(PRECISION);

                // Current debt with interest accrual
                let current_debt = if vault.borrow_index_snapshot > 0 {
                    vibeswap_math::mul_div(
                        vault.debt_shares,
                        pool.borrow_index,
                        vault.borrow_index_snapshot,
                    )
                } else {
                    vault.debt_shares
                };

                let collateral_value = vibeswap_math::mul_div(
                    vault.collateral_amount,
                    collateral_price,
                    PRECISION,
                );
                let debt_value =
                    vibeswap_math::mul_div(current_debt, debt_price, PRECISION);

                // Deposit share value
                let deposit_value = if pool.total_shares > 0 {
                    let underlying = vibeswap_math::mul_div(
                        vault.deposit_shares,
                        pool.total_deposits,
                        pool.total_shares,
                    );
                    vibeswap_math::mul_div(underlying, debt_price, PRECISION)
                } else {
                    0
                };

                // Health factor
                let hf = if current_debt > 0 {
                    vibeswap_math::mul_div(
                        vibeswap_math::mul_div(
                            vault.collateral_amount,
                            collateral_price,
                            PRECISION,
                        ),
                        pool.liquidation_threshold,
                        vibeswap_math::mul_div(current_debt, debt_price, PRECISION),
                    )
                } else {
                    u128::MAX
                };

                let net_value = collateral_value
                    .saturating_add(deposit_value)
                    .saturating_sub(debt_value);

                LendingPosition {
                    pool_id: vault.pool_id,
                    collateral_amount: vault.collateral_amount,
                    collateral_value,
                    debt_amount: current_debt,
                    debt_value,
                    health_factor: hf,
                    deposit_shares: vault.deposit_shares,
                    deposit_value,
                    net_value,
                }
            })
            .collect()
    }

    fn build_insurance_positions(&self) -> Vec<InsurancePosition> {
        self.insurance
            .iter()
            .map(|(pool, user_shares)| {
                let underlying = if pool.total_shares > 0 {
                    vibeswap_math::mul_div(
                        *user_shares,
                        pool.total_deposits + pool.total_premiums_earned
                            - pool.total_claims_paid,
                        pool.total_shares,
                    )
                } else {
                    0
                };

                let price = self
                    .prices
                    .get(&pool.asset_type_hash)
                    .copied()
                    .unwrap_or(PRECISION);
                let value = vibeswap_math::mul_div(underlying, price, PRECISION);

                // Approximate premium yield
                let yield_bps = if pool.total_deposits > 0 {
                    ((pool.total_premiums_earned.saturating_sub(pool.total_claims_paid))
                        * 10_000
                        / pool.total_deposits) as u16
                } else {
                    0
                };

                InsurancePosition {
                    pool_id: pool.pool_id,
                    shares: *user_shares,
                    underlying_value: value,
                    premium_yield_bps: yield_bps,
                }
            })
            .collect()
    }

    fn build_prediction_positions(&self) -> Vec<PredictionPosition> {
        self.predictions
            .iter()
            .map(|(market, position)| {
                let is_settled = market.status >= vibeswap_types::MARKET_SETTLED;

                // Potential payout depends on tier's share of total pool
                let tier_idx = position.tier_index as usize;
                let tier_pool = if tier_idx < market.num_tiers as usize {
                    market.tier_pools[tier_idx]
                } else {
                    0
                };

                let total_pool: u128 = market.tier_pools[..market.num_tiers as usize]
                    .iter()
                    .sum();

                let potential_payout = if tier_pool > 0 {
                    vibeswap_math::mul_div(position.amount, total_pool, tier_pool)
                } else {
                    0
                };

                PredictionPosition {
                    market_id: market.market_id,
                    tier_index: position.tier_index,
                    amount: position.amount,
                    potential_payout,
                    is_settled,
                }
            })
            .collect()
    }

    fn build_token_balances(&self) -> Vec<TokenBalance> {
        self.tokens
            .iter()
            .map(|(token_hash, amount)| {
                let price = self.prices.get(token_hash).copied().unwrap_or(0);
                let value = vibeswap_math::mul_div(*amount, price, PRECISION);
                TokenBalance {
                    token_type_hash: *token_hash,
                    amount: *amount,
                    value,
                }
            })
            .collect()
    }

    // ============ Summary Computation ============

    fn compute_summary(
        &self,
        lp: &[LPPosition],
        lending: &[LendingPosition],
        insurance: &[InsurancePosition],
        prediction: &[PredictionPosition],
        tokens: &[TokenBalance],
    ) -> PortfolioSummary {
        let lp_value: u128 = lp.iter().map(|p| p.token0_value + p.token1_value).sum();
        let lending_net: u128 = lending.iter().map(|p| p.net_value).sum();
        let insurance_value: u128 = insurance.iter().map(|p| p.underlying_value).sum();
        let prediction_value: u128 = prediction.iter().map(|p| p.amount).sum();
        let token_value: u128 = tokens.iter().map(|t| t.value).sum();

        let total_value = lp_value
            .saturating_add(lending_net)
            .saturating_add(insurance_value)
            .saturating_add(prediction_value)
            .saturating_add(token_value);

        let total_collateral: u128 = lending.iter().map(|p| p.collateral_value).sum();
        let total_debt: u128 = lending.iter().map(|p| p.debt_value).sum();

        let worst_hf = lending
            .iter()
            .map(|p| p.health_factor)
            .min()
            .unwrap_or(u128::MAX);

        // Concentration: largest single position as % of total
        let mut all_values = Vec::new();
        for p in lp {
            all_values.push(p.token0_value + p.token1_value);
        }
        for p in lending {
            all_values.push(p.net_value);
        }
        for p in insurance {
            all_values.push(p.underlying_value);
        }
        for p in prediction {
            all_values.push(p.amount);
        }
        for t in tokens {
            all_values.push(t.value);
        }

        let max_position = all_values.iter().copied().max().unwrap_or(0);
        let concentration_bps = if total_value > 0 {
            ((max_position * 10_000) / total_value) as u64
        } else {
            0
        };

        // Protocol count
        let mut protocols = 0u8;
        if !lp.is_empty() {
            protocols += 1;
        }
        if !lending.is_empty() {
            protocols += 1;
        }
        if !insurance.is_empty() {
            protocols += 1;
        }
        if !prediction.is_empty() {
            protocols += 1;
        }
        if !tokens.is_empty() {
            protocols += 1;
        }

        // Estimated APY: weighted average of insurance yield + lending deposit yield
        let estimated_apy = estimate_portfolio_apy(insurance, lending);

        PortfolioSummary {
            total_value,
            lp_value,
            lending_net_value: lending_net,
            insurance_value,
            prediction_value,
            token_value,
            total_collateral,
            total_debt,
            worst_health_factor: worst_hf,
            estimated_apy_bps: estimated_apy,
            concentration_bps,
            protocol_count: protocols,
        }
    }
}

// ============ Helper Functions ============

/// Calculate impermanent loss in basis points.
/// Compares current pool ratio to entry price ratio.
fn calculate_il(
    entry_price: u128,
    pool: &PoolCellData,
    _price0: u128,
    _price1: u128,
) -> u16 {
    if entry_price == 0 || pool.reserve0 == 0 {
        return 0;
    }

    // Current price = reserve1 / reserve0
    let current_price = vibeswap_math::mul_div(pool.reserve1, PRECISION, pool.reserve0);

    // Price ratio = current / entry
    let ratio = if current_price > entry_price {
        vibeswap_math::mul_div(current_price, PRECISION, entry_price)
    } else {
        vibeswap_math::mul_div(entry_price, PRECISION, current_price)
    };

    // IL formula: IL = 2 * sqrt(r) / (1 + r) - 1
    // Where r = price_ratio
    // Approximate: for small changes, IL ≈ (r - 1)^2 / (4 * r) in bps
    if ratio <= PRECISION {
        return 0; // No price change
    }

    let diff = ratio - PRECISION;
    // IL_bps ≈ diff^2 / (4 * ratio) * 10000 / PRECISION
    let il = vibeswap_math::mul_div(
        vibeswap_math::mul_div(diff, diff, PRECISION),
        10_000,
        4 * ratio,
    );

    il.min(10_000) as u16
}

/// Estimate weighted average APY across yield-bearing positions
fn estimate_portfolio_apy(
    insurance: &[InsurancePosition],
    lending: &[LendingPosition],
) -> u64 {
    let mut total_yield_value: u128 = 0;
    let mut total_earning_value: u128 = 0;

    for pos in insurance {
        if pos.underlying_value > 0 {
            total_yield_value += pos.underlying_value as u128 * pos.premium_yield_bps as u128;
            total_earning_value += pos.underlying_value;
        }
    }

    // Lending deposits earn the supply rate
    for pos in lending {
        if pos.deposit_value > 0 {
            // Approximate supply rate from pool utilization
            // (simplified — in production, compute from rate model)
            total_earning_value += pos.deposit_value;
            // Add a nominal 3% APY estimate for deposits
            total_yield_value += pos.deposit_value * 300;
        }
    }

    if total_earning_value > 0 {
        (total_yield_value / total_earning_value) as u64
    } else {
        0
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    fn token(id: u8) -> [u8; 32] {
        let mut h = [0u8; 32];
        h[0] = id;
        h
    }

    fn make_prices() -> PriceMap {
        let mut m = BTreeMap::new();
        m.insert(token(1), 3_000 * PRECISION);  // ETH = $3000
        m.insert(token(2), PRECISION);           // USDC = $1
        m.insert(token(3), 60_000 * PRECISION);  // BTC = $60000
        m
    }

    fn make_pool(t0: u8, t1: u8, r0: u128, r1: u128) -> PoolCellData {
        PoolCellData {
            reserve0: r0,
            reserve1: r1,
            total_lp_supply: vibeswap_math::sqrt_product(r0, r1),
            fee_rate_bps: 30,
            twap_price_cum: 0,
            twap_last_block: 100,
            k_last: [0; 32],
            minimum_liquidity: 1000,
            pair_id: {
                let mut p = [0u8; 32];
                p[0] = t0;
                p[1] = t1;
                p
            },
            token0_type_hash: token(t0),
            token1_type_hash: token(t1),
        }
    }

    fn make_lp(lp_amount: u128, entry_price: u128) -> LPPositionCellData {
        LPPositionCellData {
            lp_amount,
            entry_price,
            pool_id: [0; 32],
            deposit_block: 100,
        }
    }

    fn make_vault(collateral: u128, debt: u128) -> VaultCellData {
        VaultCellData {
            owner_lock_hash: [0x11; 32],
            pool_id: [0x22; 32],
            collateral_amount: collateral,
            collateral_type_hash: token(1), // ETH
            debt_shares: debt,
            borrow_index_snapshot: PRECISION,
            deposit_shares: 0,
            last_update_block: 100,
        }
    }

    fn make_lending_pool() -> LendingPoolCellData {
        LendingPoolCellData {
            total_deposits: 1_000_000 * PRECISION,
            total_borrows: 500_000 * PRECISION,
            total_shares: 1_000_000 * PRECISION,
            total_reserves: 0,
            borrow_index: PRECISION,
            last_accrual_block: 100,
            asset_type_hash: token(2), // USDC
            pool_id: [0x22; 32],
            base_rate: DEFAULT_BASE_RATE,
            slope1: DEFAULT_SLOPE1,
            slope2: DEFAULT_SLOPE2,
            optimal_utilization: DEFAULT_OPTIMAL_UTILIZATION,
            reserve_factor: DEFAULT_RESERVE_FACTOR,
            collateral_factor: DEFAULT_COLLATERAL_FACTOR,
            liquidation_threshold: DEFAULT_LIQUIDATION_THRESHOLD,
            liquidation_incentive: DEFAULT_LIQUIDATION_INCENTIVE,
        }
    }

    fn make_insurance() -> InsurancePoolCellData {
        InsurancePoolCellData {
            pool_id: [0x22; 32],
            asset_type_hash: token(2),
            total_deposits: 100_000 * PRECISION,
            total_shares: 100_000 * PRECISION,
            total_premiums_earned: 5_000 * PRECISION,
            total_claims_paid: 1_000 * PRECISION,
            premium_rate_bps: DEFAULT_PREMIUM_RATE_BPS,
            max_coverage_bps: DEFAULT_MAX_COVERAGE_BPS,
            cooldown_blocks: DEFAULT_COOLDOWN_BLOCKS,
            last_premium_block: 100,
        }
    }

    // ============ Empty Portfolio ============

    #[test]
    fn test_empty_portfolio() {
        let builder = PortfolioBuilder::new([0x11; 32], make_prices());
        let portfolio = builder.build();

        assert_eq!(portfolio.summary.total_value, 0);
        assert_eq!(portfolio.summary.protocol_count, 0);
        assert_eq!(portfolio.summary.worst_health_factor, u128::MAX);
        assert!(portfolio.lp_positions.is_empty());
    }

    // ============ LP Position ============

    #[test]
    fn test_lp_position_value() {
        let prices = make_prices();
        let pool = make_pool(1, 2, 100 * PRECISION, 300_000 * PRECISION);
        let lp = make_lp(pool.total_lp_supply / 10, 3_000 * PRECISION); // 10% of pool

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_lp(lp, pool);
        let portfolio = builder.build();

        assert_eq!(portfolio.lp_positions.len(), 1);
        let pos = &portfolio.lp_positions[0];

        // 10% of 100 ETH = 10 ETH @ $3000 = $30,000
        assert!(pos.token0_value > 29_000 * PRECISION);
        assert!(pos.token0_value < 31_000 * PRECISION);

        // 10% of 300,000 USDC = 30,000 USDC @ $1
        assert!(pos.token1_value > 29_000 * PRECISION);
        assert!(pos.token1_value < 31_000 * PRECISION);

        assert_eq!(portfolio.summary.protocol_count, 1);
    }

    #[test]
    fn test_lp_impermanent_loss_zero() {
        let pool = make_pool(1, 2, 100 * PRECISION, 300_000 * PRECISION);
        // Entry price matches current price: no IL
        let current_price = vibeswap_math::mul_div(pool.reserve1, PRECISION, pool.reserve0);
        let il = calculate_il(current_price, &pool, 3_000 * PRECISION, PRECISION);
        assert_eq!(il, 0);
    }

    #[test]
    fn test_lp_impermanent_loss_with_price_change() {
        // Entry at 1:1 ratio
        let pool = PoolCellData {
            reserve0: 100 * PRECISION,
            reserve1: 200 * PRECISION, // Price moved to 2:1
            ..make_pool(1, 2, 100 * PRECISION, 100 * PRECISION)
        };
        let entry_price = PRECISION; // Was 1:1

        let il = calculate_il(entry_price, &pool, 0, 0);
        // 2x price change should give meaningful IL
        assert!(il > 0, "IL should be positive after 2x price move");
        assert!(il < 2000, "IL should be reasonable for 2x move: {} bps", il);
    }

    // ============ Lending Position ============

    #[test]
    fn test_lending_position_value() {
        let prices = make_prices();
        let vault = make_vault(10 * PRECISION, 15_000 * PRECISION);
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        assert_eq!(portfolio.lending_positions.len(), 1);
        let pos = &portfolio.lending_positions[0];

        // 10 ETH @ $3000 = $30,000 collateral
        assert_eq!(pos.collateral_value, 30_000 * PRECISION);
        // 15,000 USDC debt @ $1 = $15,000
        assert_eq!(pos.debt_value, 15_000 * PRECISION);
        // Net = 30K - 15K = 15K
        assert_eq!(pos.net_value, 15_000 * PRECISION);
        // HF should be > 1 (healthy)
        assert!(pos.health_factor > PRECISION);
    }

    #[test]
    fn test_lending_zero_debt() {
        let prices = make_prices();
        let vault = make_vault(10 * PRECISION, 0);
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lending_positions[0];
        assert_eq!(pos.health_factor, u128::MAX);
        assert_eq!(pos.debt_value, 0);
    }

    #[test]
    fn test_lending_with_deposits() {
        let prices = make_prices();
        let vault = VaultCellData {
            deposit_shares: 50_000 * PRECISION,
            ..make_vault(10 * PRECISION, 15_000 * PRECISION)
        };
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lending_positions[0];
        // deposit_shares = 50K, total_shares = 1M, total_deposits = 1M
        // underlying = 50K/1M * 1M = 50K USDC = $50K
        assert_eq!(pos.deposit_value, 50_000 * PRECISION);
        // Net = 30K collateral + 50K deposits - 15K debt = 65K
        assert_eq!(pos.net_value, 65_000 * PRECISION);
    }

    #[test]
    fn test_lending_borrow_index_accrual() {
        let prices = make_prices();
        let vault = make_vault(10 * PRECISION, 10_000 * PRECISION);
        // Borrow index doubled — effective debt is 2x
        let pool = LendingPoolCellData {
            borrow_index: 2 * PRECISION,
            ..make_lending_pool()
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lending_positions[0];
        // Effective debt = 10K * (2.0/1.0) = 20K
        assert_eq!(pos.debt_amount, 20_000 * PRECISION);
        assert_eq!(pos.debt_value, 20_000 * PRECISION);
    }

    // ============ Insurance Position ============

    #[test]
    fn test_insurance_position_value() {
        let prices = make_prices();
        let ins = make_insurance();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_insurance(ins, 10_000 * PRECISION); // 10% of shares
        let portfolio = builder.build();

        assert_eq!(portfolio.insurance_positions.len(), 1);
        let pos = &portfolio.insurance_positions[0];

        // Shares = 10K of 100K = 10% of (100K + 5K earned - 1K claimed) = 10.4K
        // At USDC $1, value = 10.4K
        assert!(pos.underlying_value > 10_000 * PRECISION);
    }

    #[test]
    fn test_insurance_premium_yield() {
        let ins = make_insurance();
        // Earned 5K, paid 1K on 100K deposits = 4% net yield
        let prices = make_prices();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_insurance(ins, 10_000 * PRECISION);
        let portfolio = builder.build();

        let pos = &portfolio.insurance_positions[0];
        assert_eq!(pos.premium_yield_bps, 400); // 4%
    }

    // ============ Prediction Position ============

    #[test]
    fn test_prediction_position() {
        let market = PredictionMarketCellData {
            market_id: [0x42; 32],
            num_tiers: 3,
            tier_pools: {
                let mut t = [0u128; 8];
                t[0] = 100_000 * PRECISION;
                t[1] = 200_000 * PRECISION;
                t[2] = 50_000 * PRECISION;
                t
            },
            status: vibeswap_types::MARKET_ACTIVE,
            ..Default::default()
        };

        let position = PredictionPositionCellData {
            market_id: [0x42; 32],
            tier_index: 1,
            amount: 10_000 * PRECISION,
            owner_lock_hash: [0x11; 32],
            created_block: 100,
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_prediction(market, position);
        let portfolio = builder.build();

        assert_eq!(portfolio.prediction_positions.len(), 1);
        let pos = &portfolio.prediction_positions[0];

        // User bet 10K on tier 1 (200K pool) out of 350K total
        // Potential payout = 10K * 350K / 200K = 17.5K
        let expected = vibeswap_math::mul_div(
            10_000 * PRECISION,
            350_000 * PRECISION,
            200_000 * PRECISION,
        );
        assert_eq!(pos.potential_payout, expected);
        assert!(!pos.is_settled);
    }

    // ============ Token Balance ============

    #[test]
    fn test_token_balance_value() {
        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_token(token(1), 5 * PRECISION); // 5 ETH
        builder.add_token(token(2), 10_000 * PRECISION); // 10K USDC
        let portfolio = builder.build();

        assert_eq!(portfolio.token_balances.len(), 2);
        // 5 ETH @ $3000 = $15,000
        assert_eq!(portfolio.token_balances[0].value, 15_000 * PRECISION);
        // 10K USDC @ $1 = $10,000
        assert_eq!(portfolio.token_balances[1].value, 10_000 * PRECISION);
    }

    #[test]
    fn test_token_unknown_price() {
        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_token(token(99), 1_000 * PRECISION); // Unknown token
        let portfolio = builder.build();

        // Unknown price → 0 value
        assert_eq!(portfolio.token_balances[0].value, 0);
    }

    // ============ Summary Metrics ============

    #[test]
    fn test_summary_total_value() {
        let prices = make_prices();
        let pool = make_pool(1, 2, 100 * PRECISION, 300_000 * PRECISION);
        let lp = make_lp(pool.total_lp_supply / 10, 3_000 * PRECISION);

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_lp(lp, pool);
        builder.add_token(token(2), 5_000 * PRECISION);
        let portfolio = builder.build();

        // LP value ≈ 60K + token 5K = ~65K
        assert!(portfolio.summary.total_value > 60_000 * PRECISION);
        assert_eq!(portfolio.summary.protocol_count, 2);
    }

    #[test]
    fn test_summary_worst_health_factor() {
        let prices = make_prices();
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(make_vault(100 * PRECISION, 5_000 * PRECISION), pool.clone());
        builder.add_vault(make_vault(10 * PRECISION, 25_000 * PRECISION), pool);
        let portfolio = builder.build();

        // Second vault has much lower HF
        assert!(portfolio.summary.worst_health_factor < portfolio.lending_positions[0].health_factor);
    }

    #[test]
    fn test_summary_concentration() {
        let prices = make_prices();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_token(token(1), 100 * PRECISION); // 100 ETH = $300K
        builder.add_token(token(2), 1_000 * PRECISION); // 1K USDC = $1K
        let portfolio = builder.build();

        // ETH is 300K / 301K ≈ 99.7% of portfolio
        assert!(portfolio.summary.concentration_bps > 9900);
    }

    #[test]
    fn test_summary_debt_tracking() {
        let prices = make_prices();
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(make_vault(10 * PRECISION, 15_000 * PRECISION), pool.clone());
        builder.add_vault(make_vault(20 * PRECISION, 30_000 * PRECISION), pool);
        let portfolio = builder.build();

        // Total collateral: (10+20) ETH @ $3000 = $90K
        assert_eq!(portfolio.summary.total_collateral, 90_000 * PRECISION);
        // Total debt: (15K + 30K) = $45K
        assert_eq!(portfolio.summary.total_debt, 45_000 * PRECISION);
    }

    // ============ Multi-Protocol Portfolio ============

    #[test]
    fn test_full_multi_protocol_portfolio() {
        let prices = make_prices();
        let amm_pool = make_pool(1, 2, 100 * PRECISION, 300_000 * PRECISION);
        let lp = make_lp(amm_pool.total_lp_supply / 10, 3_000 * PRECISION);
        let lending_pool = make_lending_pool();
        let ins = make_insurance();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder
            .add_lp(lp, amm_pool)
            .add_vault(make_vault(10 * PRECISION, 15_000 * PRECISION), lending_pool)
            .add_insurance(ins, 10_000 * PRECISION)
            .add_token(token(2), 50_000 * PRECISION);

        let portfolio = builder.build();

        // All protocol types present
        assert_eq!(portfolio.summary.protocol_count, 4);
        assert!(portfolio.summary.total_value > 0);
        assert!(portfolio.summary.lp_value > 0);
        assert!(portfolio.summary.lending_net_value > 0);
        assert!(portfolio.summary.insurance_value > 0);
        assert!(portfolio.summary.token_value > 0);
    }

    #[test]
    fn test_portfolio_apy_with_insurance() {
        let prices = make_prices();
        let ins = make_insurance(); // 4% yield

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_insurance(ins, 50_000 * PRECISION);
        let portfolio = builder.build();

        // Should have some estimated APY from insurance premiums
        assert!(portfolio.summary.estimated_apy_bps > 0);
    }

    // ============ Edge Cases ============

    #[test]
    fn test_zero_reserves_pool() {
        let prices = make_prices();
        let pool = PoolCellData {
            total_lp_supply: 0,
            ..make_pool(1, 2, 0, 0)
        };
        let lp = make_lp(1000, PRECISION);

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_lp(lp, pool);
        let portfolio = builder.build();

        // Zero LP supply → zero value
        assert_eq!(portfolio.lp_positions[0].token0_value, 0);
        assert_eq!(portfolio.lp_positions[0].token1_value, 0);
    }

    #[test]
    fn test_zero_shares_insurance() {
        let ins = InsurancePoolCellData {
            total_shares: 0,
            ..make_insurance()
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_insurance(ins, 1_000 * PRECISION);
        let portfolio = builder.build();

        assert_eq!(portfolio.insurance_positions[0].underlying_value, 0);
    }

    #[test]
    fn test_multiple_lp_positions() {
        let prices = make_prices();
        let pool1 = make_pool(1, 2, 100 * PRECISION, 300_000 * PRECISION);
        let pool2 = make_pool(1, 3, 10 * PRECISION, 600_000 * PRECISION);
        let lp1 = make_lp(pool1.total_lp_supply / 10, 3_000 * PRECISION);
        let lp2 = make_lp(pool2.total_lp_supply / 20, 60_000 * PRECISION);

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_lp(lp1, pool1).add_lp(lp2, pool2);
        let portfolio = builder.build();

        assert_eq!(portfolio.lp_positions.len(), 2);
        assert!(portfolio.summary.lp_value > 0);
    }

    // ============ New Hardening Tests ============

    #[test]
    fn test_empty_portfolio_all_summaries_zero() {
        let builder = PortfolioBuilder::new([0xAA; 32], make_prices());
        let p = builder.build();

        assert_eq!(p.summary.lp_value, 0);
        assert_eq!(p.summary.lending_net_value, 0);
        assert_eq!(p.summary.insurance_value, 0);
        assert_eq!(p.summary.prediction_value, 0);
        assert_eq!(p.summary.token_value, 0);
        assert_eq!(p.summary.total_collateral, 0);
        assert_eq!(p.summary.total_debt, 0);
        assert_eq!(p.summary.estimated_apy_bps, 0);
        assert_eq!(p.summary.concentration_bps, 0);
        assert_eq!(p.owner_lock_hash, [0xAA; 32]);
    }

    #[test]
    fn test_il_zero_entry_price() {
        // Entry price = 0 should return IL = 0 (guard clause)
        let pool = make_pool(1, 2, 100 * PRECISION, 300_000 * PRECISION);
        let il = calculate_il(0, &pool, 3_000 * PRECISION, PRECISION);
        assert_eq!(il, 0);
    }

    #[test]
    fn test_il_extreme_price_move_10x() {
        // 10x price move: reserve ratio shifted dramatically
        let pool = PoolCellData {
            reserve0: 10 * PRECISION,
            reserve1: 1_000 * PRECISION, // current price = 100
            ..make_pool(1, 2, 10 * PRECISION, 1_000 * PRECISION)
        };
        let entry_price = 10 * PRECISION; // was 10, now 100 → 10x move

        let il = calculate_il(entry_price, &pool, 0, 0);
        // 10x move should produce significant IL (capped at 10000 bps)
        assert!(il > 0, "IL should be positive for 10x move");
        assert!(il <= 10_000, "IL should be capped at 10000 bps");
    }

    #[test]
    fn test_lending_near_liquidation_health_factor() {
        // Vault near liquidation: large debt relative to collateral
        let prices = make_prices();
        // 10 ETH @ $3000 = $30K collateral
        // Debt = 30K USDC → HF = (30K * 0.8) / 30K = 0.8 (below 1 = liquidatable)
        let vault = make_vault(10 * PRECISION, 30_000 * PRECISION);
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lending_positions[0];
        // HF should be below PRECISION (unhealthy)
        assert!(
            pos.health_factor < PRECISION,
            "HF should be below 1.0 for near-liquidation vault: {}",
            pos.health_factor
        );
        assert_eq!(portfolio.summary.worst_health_factor, pos.health_factor);
    }

    #[test]
    fn test_lending_zero_collateral() {
        // Zero collateral but some deposit shares: deposit-only position
        let prices = make_prices();
        let vault = VaultCellData {
            collateral_amount: 0,
            debt_shares: 0,
            deposit_shares: 100_000 * PRECISION,
            ..make_vault(0, 0)
        };
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lending_positions[0];
        assert_eq!(pos.collateral_value, 0);
        assert_eq!(pos.debt_value, 0);
        assert_eq!(pos.health_factor, u128::MAX);
        // deposit_shares = 100K of total 1M → 100K USDC at $1 = 100K
        assert_eq!(pos.deposit_value, 100_000 * PRECISION);
        assert_eq!(pos.net_value, 100_000 * PRECISION);
    }

    #[test]
    fn test_insurance_claims_exceed_premiums() {
        // Edge: claims paid > premiums earned → net yield is negative → clamped to 0 by saturating_sub
        let ins = InsurancePoolCellData {
            total_premiums_earned: 2_000 * PRECISION,
            total_claims_paid: 5_000 * PRECISION,   // claims > premiums
            ..make_insurance()
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_insurance(ins, 10_000 * PRECISION);
        let portfolio = builder.build();

        let pos = &portfolio.insurance_positions[0];
        // yield_bps uses saturating_sub, so (2K - 5K) saturates to 0
        assert_eq!(pos.premium_yield_bps, 0);
        // Underlying value: user_shares * (deposits + premiums - claims) / total_shares
        // = 10K * (100K + 2K - 5K) / 100K = 10K * 97K / 100K = 9.7K USDC
        assert!(pos.underlying_value > 9_000 * PRECISION);
        assert!(pos.underlying_value < 10_000 * PRECISION);
    }

    #[test]
    fn test_prediction_settled_market() {
        let market = PredictionMarketCellData {
            market_id: [0x55; 32],
            num_tiers: 2,
            tier_pools: {
                let mut t = [0u128; 8];
                t[0] = 50_000 * PRECISION;
                t[1] = 50_000 * PRECISION;
                t
            },
            status: vibeswap_types::MARKET_SETTLED,
            ..Default::default()
        };

        let position = PredictionPositionCellData {
            market_id: [0x55; 32],
            tier_index: 0,
            amount: 5_000 * PRECISION,
            owner_lock_hash: [0x11; 32],
            created_block: 200,
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_prediction(market, position);
        let portfolio = builder.build();

        let pos = &portfolio.prediction_positions[0];
        assert!(pos.is_settled);
        // 50/50 split: payout = 5K * 100K / 50K = 10K
        assert_eq!(pos.potential_payout, 10_000 * PRECISION);
    }

    #[test]
    fn test_prediction_zero_tier_pool() {
        // Tier pool = 0 → potential_payout = 0
        let market = PredictionMarketCellData {
            market_id: [0x66; 32],
            num_tiers: 3,
            tier_pools: {
                let mut t = [0u128; 8];
                t[0] = 100_000 * PRECISION;
                t[1] = 0; // empty tier
                t[2] = 50_000 * PRECISION;
                t
            },
            status: vibeswap_types::MARKET_ACTIVE,
            ..Default::default()
        };

        let position = PredictionPositionCellData {
            market_id: [0x66; 32],
            tier_index: 1, // bet on empty tier
            amount: 10_000 * PRECISION,
            owner_lock_hash: [0x11; 32],
            created_block: 100,
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_prediction(market, position);
        let portfolio = builder.build();

        assert_eq!(portfolio.prediction_positions[0].potential_payout, 0);
    }

    #[test]
    fn test_portfolio_only_lending_deposits_apy() {
        // APY from lending deposits only (no insurance) → nominal 300 bps (3%)
        let prices = make_prices();
        let vault = VaultCellData {
            collateral_amount: 0,
            debt_shares: 0,
            deposit_shares: 200_000 * PRECISION,
            ..make_vault(0, 0)
        };
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        // Lending deposits get a nominal 300 bps (3%) in estimate_portfolio_apy
        assert_eq!(portfolio.summary.estimated_apy_bps, 300);
    }

    #[test]
    fn test_mixed_apy_insurance_and_lending() {
        // Both insurance (4% yield) and lending deposits (3% nominal) contribute
        let prices = make_prices();
        let ins = make_insurance(); // 4% yield = 400 bps

        let vault = VaultCellData {
            collateral_amount: 0,
            debt_shares: 0,
            deposit_shares: 100_000 * PRECISION, // = 100K USDC deposit value
            ..make_vault(0, 0)
        };
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_insurance(ins, 50_000 * PRECISION); // 50K shares → ~52K value
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        // Weighted average should be between 300 and 400 bps
        let apy = portfolio.summary.estimated_apy_bps;
        assert!(
            apy > 300 && apy < 400,
            "Mixed APY should be between 300 and 400 bps, got {}",
            apy
        );
    }

    #[test]
    fn test_full_five_protocol_portfolio() {
        // All 5 position types present → protocol_count = 5
        let prices = make_prices();
        let amm_pool = make_pool(1, 2, 100 * PRECISION, 300_000 * PRECISION);
        let lp = make_lp(amm_pool.total_lp_supply / 10, 3_000 * PRECISION);
        let lending_pool = make_lending_pool();
        let ins = make_insurance();

        let market = PredictionMarketCellData {
            market_id: [0x77; 32],
            num_tiers: 2,
            tier_pools: {
                let mut t = [0u128; 8];
                t[0] = 80_000 * PRECISION;
                t[1] = 120_000 * PRECISION;
                t
            },
            status: vibeswap_types::MARKET_ACTIVE,
            ..Default::default()
        };
        let position = PredictionPositionCellData {
            market_id: [0x77; 32],
            tier_index: 0,
            amount: 5_000 * PRECISION,
            owner_lock_hash: [0x11; 32],
            created_block: 100,
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder
            .add_lp(lp, amm_pool)
            .add_vault(make_vault(10 * PRECISION, 15_000 * PRECISION), lending_pool)
            .add_insurance(ins, 10_000 * PRECISION)
            .add_prediction(market, position)
            .add_token(token(3), PRECISION); // 1 BTC

        let portfolio = builder.build();

        assert_eq!(portfolio.summary.protocol_count, 5);
        assert!(portfolio.summary.lp_value > 0);
        assert!(portfolio.summary.lending_net_value > 0);
        assert!(portfolio.summary.insurance_value > 0);
        assert!(portfolio.summary.prediction_value > 0);
        assert!(portfolio.summary.token_value > 0);
        // Total > sum of individual minimums
        assert!(portfolio.summary.total_value > 100_000 * PRECISION);
    }

    #[test]
    fn test_concentration_single_position() {
        // Single position → 100% concentration
        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_token(token(1), 10 * PRECISION);
        let portfolio = builder.build();

        assert_eq!(portfolio.summary.concentration_bps, 10_000);
    }

    #[test]
    fn test_concentration_equal_split() {
        // Two equal value positions → ~50% concentration each
        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        // ETH @ $3000: need 10 ETH = $30K, and 30K USDC = $30K
        builder.add_token(token(1), 10 * PRECISION);  // $30,000
        builder.add_token(token(2), 30_000 * PRECISION); // $30,000
        let portfolio = builder.build();

        assert_eq!(portfolio.summary.concentration_bps, 5_000);
    }

    #[test]
    fn test_lp_with_unknown_token_prices() {
        // Pool tokens not in price map → values are 0
        let prices = BTreeMap::new();
        // Only add token(10) and token(11) which have no prices
        let pool = make_pool(10, 11, 500 * PRECISION, 500 * PRECISION);
        let lp = make_lp(pool.total_lp_supply / 5, PRECISION);

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_lp(lp, pool);
        let portfolio = builder.build();

        assert_eq!(portfolio.lp_positions[0].token0_value, 0);
        assert_eq!(portfolio.lp_positions[0].token1_value, 0);
        assert_eq!(portfolio.summary.lp_value, 0);
    }

    // ============ Additional Hardening Tests ============

    #[test]
    fn test_token_zero_amount() {
        // Adding a token with zero amount should produce zero value
        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_token(token(1), 0); // 0 ETH
        let portfolio = builder.build();

        assert_eq!(portfolio.token_balances.len(), 1);
        assert_eq!(portfolio.token_balances[0].amount, 0);
        assert_eq!(portfolio.token_balances[0].value, 0);
        assert_eq!(portfolio.summary.token_value, 0);
    }

    #[test]
    fn test_prediction_out_of_bounds_tier_index() {
        // tier_index >= num_tiers should use tier_pool = 0 → payout = 0
        let market = PredictionMarketCellData {
            market_id: [0x88; 32],
            num_tiers: 2,
            tier_pools: {
                let mut t = [0u128; 8];
                t[0] = 100_000 * PRECISION;
                t[1] = 100_000 * PRECISION;
                t
            },
            status: vibeswap_types::MARKET_ACTIVE,
            ..Default::default()
        };

        let position = PredictionPositionCellData {
            market_id: [0x88; 32],
            tier_index: 5, // out of bounds (num_tiers = 2)
            amount: 10_000 * PRECISION,
            owner_lock_hash: [0x11; 32],
            created_block: 100,
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_prediction(market, position);
        let portfolio = builder.build();

        // tier_pool = 0 because index >= num_tiers → payout = 0
        assert_eq!(portfolio.prediction_positions[0].potential_payout, 0);
    }

    #[test]
    fn test_multiple_insurance_positions() {
        // Two insurance positions should sum correctly in summary
        let ins1 = make_insurance();
        let ins2 = InsurancePoolCellData {
            pool_id: [0x33; 32],
            total_deposits: 50_000 * PRECISION,
            total_shares: 50_000 * PRECISION,
            total_premiums_earned: 2_500 * PRECISION,
            total_claims_paid: 500 * PRECISION,
            ..make_insurance()
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_insurance(ins1, 10_000 * PRECISION);
        builder.add_insurance(ins2, 5_000 * PRECISION);
        let portfolio = builder.build();

        assert_eq!(portfolio.insurance_positions.len(), 2);
        // Both should have positive value
        assert!(portfolio.insurance_positions[0].underlying_value > 0);
        assert!(portfolio.insurance_positions[1].underlying_value > 0);
        // Summary should be sum of both
        let sum = portfolio.insurance_positions[0].underlying_value
            + portfolio.insurance_positions[1].underlying_value;
        assert_eq!(portfolio.summary.insurance_value, sum);
    }

    #[test]
    fn test_lending_zero_borrow_index_snapshot() {
        // borrow_index_snapshot = 0 → debt = debt_shares (fallback branch)
        let prices = make_prices();
        let vault = VaultCellData {
            borrow_index_snapshot: 0,
            ..make_vault(10 * PRECISION, 5_000 * PRECISION)
        };
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lending_positions[0];
        // With zero snapshot, debt_amount = debt_shares directly
        assert_eq!(pos.debt_amount, 5_000 * PRECISION);
    }

    #[test]
    fn test_il_price_decreased() {
        // Price went DOWN (reverse direction) — IL should still be positive
        let pool = PoolCellData {
            reserve0: 200 * PRECISION,
            reserve1: 100 * PRECISION, // Price = 0.5
            ..make_pool(1, 2, 200 * PRECISION, 100 * PRECISION)
        };
        let entry_price = 2 * PRECISION; // Was 2:1, now 0.5:1 = 4x ratio

        let il = calculate_il(entry_price, &pool, 0, 0);
        assert!(il > 0, "IL should be positive when price decreases significantly");
    }

    #[test]
    fn test_insurance_zero_deposits_yield() {
        // total_deposits = 0 → yield_bps = 0 (avoid division by zero)
        let ins = InsurancePoolCellData {
            total_deposits: 0,
            total_shares: 100 * PRECISION,
            total_premiums_earned: 0,
            total_claims_paid: 0,
            ..make_insurance()
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_insurance(ins, 50 * PRECISION);
        let portfolio = builder.build();

        assert_eq!(portfolio.insurance_positions[0].premium_yield_bps, 0);
    }

    #[test]
    fn test_prediction_equal_tier_pools() {
        // All tiers have equal pools → payout = amount * num_tiers
        let market = PredictionMarketCellData {
            market_id: [0x99; 32],
            num_tiers: 4,
            tier_pools: {
                let mut t = [0u128; 8];
                t[0] = 25_000 * PRECISION;
                t[1] = 25_000 * PRECISION;
                t[2] = 25_000 * PRECISION;
                t[3] = 25_000 * PRECISION;
                t
            },
            status: vibeswap_types::MARKET_ACTIVE,
            ..Default::default()
        };

        let position = PredictionPositionCellData {
            market_id: [0x99; 32],
            tier_index: 2,
            amount: 5_000 * PRECISION,
            owner_lock_hash: [0x11; 32],
            created_block: 100,
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_prediction(market, position);
        let portfolio = builder.build();

        // 5K * 100K / 25K = 20K payout (4x since 4 equal tiers)
        let expected = vibeswap_math::mul_div(
            5_000 * PRECISION,
            100_000 * PRECISION,
            25_000 * PRECISION,
        );
        assert_eq!(portfolio.prediction_positions[0].potential_payout, expected);
    }

    #[test]
    fn test_portfolio_only_predictions_apy_zero() {
        // Portfolio with only prediction positions should have 0 APY
        let market = PredictionMarketCellData {
            market_id: [0xAA; 32],
            num_tiers: 2,
            tier_pools: {
                let mut t = [0u128; 8];
                t[0] = 50_000 * PRECISION;
                t[1] = 50_000 * PRECISION;
                t
            },
            status: vibeswap_types::MARKET_ACTIVE,
            ..Default::default()
        };

        let position = PredictionPositionCellData {
            market_id: [0xAA; 32],
            tier_index: 0,
            amount: 10_000 * PRECISION,
            owner_lock_hash: [0x11; 32],
            created_block: 100,
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_prediction(market, position);
        let portfolio = builder.build();

        assert_eq!(portfolio.summary.estimated_apy_bps, 0);
        assert_eq!(portfolio.summary.protocol_count, 1);
    }

    #[test]
    fn test_btc_token_value() {
        // Verify BTC pricing from price map works correctly
        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_token(token(3), 2 * PRECISION); // 2 BTC @ $60,000
        let portfolio = builder.build();

        assert_eq!(portfolio.token_balances[0].value, 120_000 * PRECISION);
        assert_eq!(portfolio.summary.token_value, 120_000 * PRECISION);
        assert_eq!(portfolio.summary.total_value, 120_000 * PRECISION);
    }

    #[test]
    fn test_concentration_many_equal_positions() {
        // 5 equal-value token positions → concentration = 20% (2000 bps)
        let mut prices = BTreeMap::new();
        for i in 1u8..=5 {
            prices.insert(token(i), PRECISION); // all $1
        }

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        for i in 1u8..=5 {
            builder.add_token(token(i), 1_000 * PRECISION); // $1000 each
        }
        let portfolio = builder.build();

        // Each position is 1000/5000 = 20% = 2000 bps
        assert_eq!(portfolio.summary.concentration_bps, 2_000);
        assert_eq!(portfolio.summary.total_value, 5_000 * PRECISION);
    }

    #[test]
    fn test_empty_price_map_all_positions() {
        // No prices at all: LP values 0, token values 0, lending uses defaults
        let empty_prices = BTreeMap::new();
        let pool = make_pool(1, 2, 100 * PRECISION, 300_000 * PRECISION);
        let lp = make_lp(pool.total_lp_supply / 10, 3_000 * PRECISION);

        let mut builder = PortfolioBuilder::new([0x11; 32], empty_prices);
        builder.add_lp(lp, pool);
        builder.add_token(token(1), 50 * PRECISION);
        let portfolio = builder.build();

        // No prices → everything is 0
        assert_eq!(portfolio.lp_positions[0].token0_value, 0);
        assert_eq!(portfolio.lp_positions[0].token1_value, 0);
        assert_eq!(portfolio.token_balances[0].value, 0);
        assert_eq!(portfolio.summary.total_value, 0);
    }

    #[test]
    fn test_insurance_zero_user_shares() {
        // User has 0 shares in an insurance pool
        let ins = make_insurance();

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_insurance(ins, 0);
        let portfolio = builder.build();

        assert_eq!(portfolio.insurance_positions[0].shares, 0);
        assert_eq!(portfolio.insurance_positions[0].underlying_value, 0);
    }

    #[test]
    fn test_builder_chaining_returns_same_builder() {
        // Verify fluent chaining works and all positions are present
        let prices = make_prices();
        let pool = make_pool(1, 2, 100 * PRECISION, 300_000 * PRECISION);
        let lp = make_lp(pool.total_lp_supply / 10, 3_000 * PRECISION);

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder
            .add_lp(lp.clone(), pool.clone())
            .add_lp(lp, pool)
            .add_token(token(1), PRECISION)
            .add_token(token(2), 100 * PRECISION)
            .add_token(token(3), PRECISION);
        let portfolio = builder.build();

        assert_eq!(portfolio.lp_positions.len(), 2);
        assert_eq!(portfolio.token_balances.len(), 3);
        assert_eq!(portfolio.summary.protocol_count, 2); // LP + tokens
    }

    #[test]
    fn test_lending_debt_exceeds_collateral() {
        // Debt value > collateral value → net_value saturates to 0
        let prices = make_prices();
        // 1 ETH @ $3000 = $3K collateral, 10K USDC debt
        let vault = make_vault(1 * PRECISION, 10_000 * PRECISION);
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lending_positions[0];
        assert_eq!(pos.collateral_value, 3_000 * PRECISION);
        assert_eq!(pos.debt_value, 10_000 * PRECISION);
        // net_value = collateral + deposits - debt, saturating
        // = 3K + 0 - 10K → saturates to 0
        assert_eq!(pos.net_value, 0);
        // HF should be very low (well below 1.0)
        assert!(pos.health_factor < PRECISION);
    }

    #[test]
    fn test_lending_pool_zero_total_shares() {
        // total_shares = 0 in lending pool → deposit_value = 0
        let prices = make_prices();
        let vault = VaultCellData {
            deposit_shares: 100_000 * PRECISION,
            ..make_vault(10 * PRECISION, 5_000 * PRECISION)
        };
        let pool = LendingPoolCellData {
            total_shares: 0,
            ..make_lending_pool()
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lending_positions[0];
        // total_shares = 0 → deposit_value = 0
        assert_eq!(pos.deposit_value, 0);
    }

    // ============ New Edge Case & Boundary Tests ============

    #[test]
    fn test_lp_position_deposit_block_preserved() {
        // Verify that the deposit_block from LPPositionCellData is preserved in the output
        let prices = make_prices();
        let pool = make_pool(1, 2, 100 * PRECISION, 300_000 * PRECISION);
        let lp = LPPositionCellData {
            lp_amount: pool.total_lp_supply / 10,
            entry_price: 3_000 * PRECISION,
            pool_id: pool.pair_id,
            deposit_block: 42_000,
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_lp(lp, pool);
        let portfolio = builder.build();

        assert_eq!(portfolio.lp_positions[0].deposit_block, 42_000);
    }

    #[test]
    fn test_lp_position_pool_id_preserved() {
        // Verify LP position tracks the correct pool_id
        let prices = make_prices();
        let mut pool = make_pool(1, 2, 100 * PRECISION, 300_000 * PRECISION);
        pool.pair_id = [0xDE; 32];
        let lp = make_lp(pool.total_lp_supply / 5, 3_000 * PRECISION);

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_lp(lp, pool);
        let portfolio = builder.build();

        assert_eq!(portfolio.lp_positions[0].pool_id, [0xDE; 32]);
    }

    #[test]
    fn test_lending_multiple_vaults_worst_hf() {
        // Three vaults: worst HF should be the minimum across all
        let prices = make_prices();
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        // Vault 1: very safe (100 ETH collateral, 5K debt) → HF very high
        builder.add_vault(make_vault(100 * PRECISION, 5_000 * PRECISION), pool.clone());
        // Vault 2: moderate (10 ETH, 20K debt) → HF moderate
        builder.add_vault(make_vault(10 * PRECISION, 20_000 * PRECISION), pool.clone());
        // Vault 3: tight (5 ETH, 15K debt) → HF low
        builder.add_vault(make_vault(5 * PRECISION, 15_000 * PRECISION), pool);
        let portfolio = builder.build();

        assert_eq!(portfolio.lending_positions.len(), 3);
        // Worst HF should match the lowest individual HF
        let min_hf = portfolio.lending_positions.iter()
            .map(|p| p.health_factor)
            .min()
            .unwrap();
        assert_eq!(portfolio.summary.worst_health_factor, min_hf);
    }

    #[test]
    fn test_token_balance_preserves_type_hash() {
        // Verify the token_type_hash is correctly preserved in the output
        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_token(token(1), 5 * PRECISION);
        let portfolio = builder.build();

        assert_eq!(portfolio.token_balances[0].token_type_hash, token(1));
    }

    #[test]
    fn test_insurance_pool_id_preserved() {
        // Verify pool_id is correctly propagated
        let mut ins = make_insurance();
        ins.pool_id = [0xBE; 32];

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_insurance(ins, 10_000 * PRECISION);
        let portfolio = builder.build();

        assert_eq!(portfolio.insurance_positions[0].pool_id, [0xBE; 32]);
    }

    #[test]
    fn test_prediction_multiple_markets() {
        // Multiple prediction positions from different markets
        let make_market = |id: u8, pools: [u128; 2]| PredictionMarketCellData {
            market_id: [id; 32],
            num_tiers: 2,
            tier_pools: {
                let mut t = [0u128; 8];
                t[0] = pools[0];
                t[1] = pools[1];
                t
            },
            status: vibeswap_types::MARKET_ACTIVE,
            ..Default::default()
        };
        let make_pos = |id: u8, tier: u8, amount: u128| PredictionPositionCellData {
            market_id: [id; 32],
            tier_index: tier,
            amount,
            owner_lock_hash: [0x11; 32],
            created_block: 100,
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_prediction(
            make_market(1, [50_000 * PRECISION, 50_000 * PRECISION]),
            make_pos(1, 0, 10_000 * PRECISION),
        );
        builder.add_prediction(
            make_market(2, [30_000 * PRECISION, 70_000 * PRECISION]),
            make_pos(2, 1, 5_000 * PRECISION),
        );
        let portfolio = builder.build();

        assert_eq!(portfolio.prediction_positions.len(), 2);
        // Total prediction value = sum of amounts
        assert_eq!(portfolio.summary.prediction_value, 15_000 * PRECISION);
    }

    #[test]
    fn test_summary_total_value_is_sum_of_components() {
        // Verify total_value == lp + lending_net + insurance + prediction + token
        let prices = make_prices();
        let amm_pool = make_pool(1, 2, 100 * PRECISION, 300_000 * PRECISION);
        let lp = make_lp(amm_pool.total_lp_supply / 10, 3_000 * PRECISION);

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_lp(lp, amm_pool);
        builder.add_token(token(2), 5_000 * PRECISION);
        let portfolio = builder.build();

        let expected = portfolio.summary.lp_value
            .saturating_add(portfolio.summary.lending_net_value)
            .saturating_add(portfolio.summary.insurance_value)
            .saturating_add(portfolio.summary.prediction_value)
            .saturating_add(portfolio.summary.token_value);
        assert_eq!(portfolio.summary.total_value, expected,
            "Total value must be the sum of all component values");
    }

    #[test]
    fn test_lp_tiny_shares_in_large_pool() {
        // User has 1 unit of LP in a very large pool → values should be very small but non-zero
        let prices = make_prices();
        let pool = make_pool(1, 2, 1_000_000 * PRECISION, 3_000_000_000 * PRECISION);
        let lp = make_lp(1, 3_000 * PRECISION); // Just 1 unit of LP

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_lp(lp, pool);
        let portfolio = builder.build();

        // With 1 unit out of a huge total_lp_supply, values should be tiny or zero
        // (depending on rounding) but the test should not panic
        assert_eq!(portfolio.lp_positions.len(), 1);
    }

    #[test]
    fn test_lending_vault_pool_id_preserved() {
        // Verify pool_id from VaultCellData is preserved in LendingPosition
        let prices = make_prices();
        let vault = VaultCellData {
            pool_id: [0xFE; 32],
            ..make_vault(10 * PRECISION, 5_000 * PRECISION)
        };
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        assert_eq!(portfolio.lending_positions[0].pool_id, [0xFE; 32]);
    }

    #[test]
    fn test_il_same_price_ratio_is_zero() {
        // When current price ratio equals entry price, IL should be 0
        let pool = make_pool(1, 2, 50 * PRECISION, 150_000 * PRECISION);
        let current_price = vibeswap_math::mul_div(pool.reserve1, PRECISION, pool.reserve0);

        let il = calculate_il(current_price, &pool, 3_000 * PRECISION, PRECISION);
        assert_eq!(il, 0, "No price change should produce 0 IL");
    }

    // ============ Batch 4: Additional Coverage Tests ============

    #[test]
    fn test_lending_interest_accrual_doubles_debt() {
        // borrow_index doubled since snapshot → debt should double
        let prices = make_prices();
        let vault = VaultCellData {
            borrow_index_snapshot: PRECISION,
            debt_shares: 10_000 * PRECISION,
            ..make_vault(100 * PRECISION, 10_000 * PRECISION)
        };
        let pool = LendingPoolCellData {
            borrow_index: 2 * PRECISION, // Index doubled
            ..make_lending_pool()
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lending_positions[0];
        assert_eq!(pos.debt_amount, 20_000 * PRECISION,
            "Debt should double when borrow_index doubles");
    }

    #[test]
    fn test_concentration_with_one_dominant_position() {
        // 90% of value in one position → concentration = 9000 bps
        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_token(token(1), 30 * PRECISION); // 30 ETH = $90,000
        builder.add_token(token(2), 10_000 * PRECISION); // 10K USDC = $10,000
        let portfolio = builder.build();

        // Total = $100K, max position = $90K → 90% = 9000 bps
        assert_eq!(portfolio.summary.concentration_bps, 9000);
    }

    #[test]
    fn test_prediction_cancelled_market_is_settled() {
        // MARKET_CANCELLED status should also count as settled (>= MARKET_SETTLED)
        let market = PredictionMarketCellData {
            market_id: [0xCC; 32],
            num_tiers: 2,
            tier_pools: {
                let mut t = [0u128; 8];
                t[0] = 50_000 * PRECISION;
                t[1] = 50_000 * PRECISION;
                t
            },
            status: vibeswap_types::MARKET_CANCELLED,
            ..Default::default()
        };

        let position = PredictionPositionCellData {
            market_id: [0xCC; 32],
            tier_index: 0,
            amount: 5_000 * PRECISION,
            owner_lock_hash: [0x11; 32],
            created_block: 100,
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_prediction(market, position);
        let portfolio = builder.build();

        assert!(portfolio.prediction_positions[0].is_settled,
            "Cancelled market should be treated as settled");
    }

    #[test]
    fn test_lp_full_pool_share() {
        // User owns 100% of pool → should get all reserves' value
        let prices = make_prices();
        let pool = make_pool(1, 2, 50 * PRECISION, 150_000 * PRECISION);
        let lp = make_lp(pool.total_lp_supply, 3_000 * PRECISION); // All LP tokens

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_lp(lp, pool.clone());
        let portfolio = builder.build();

        let pos = &portfolio.lp_positions[0];
        // 50 ETH @ $3000 = $150,000
        assert_eq!(pos.token0_value, 150_000 * PRECISION);
        // 150,000 USDC @ $1 = $150,000
        assert_eq!(pos.token1_value, 150_000 * PRECISION);
    }

    #[test]
    fn test_portfolio_total_collateral_and_debt_sums() {
        // Multiple vaults: total_collateral and total_debt should sum correctly
        let prices = make_prices();
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(make_vault(10 * PRECISION, 5_000 * PRECISION), pool.clone());
        builder.add_vault(make_vault(20 * PRECISION, 8_000 * PRECISION), pool);
        let portfolio = builder.build();

        let expected_collateral = (10 * 3_000 + 20 * 3_000) * PRECISION; // $30K + $60K
        let expected_debt = (5_000 + 8_000) * PRECISION; // $5K + $8K
        assert_eq!(portfolio.summary.total_collateral, expected_collateral);
        assert_eq!(portfolio.summary.total_debt, expected_debt);
    }

    #[test]
    fn test_insurance_large_premiums_yield_calculation() {
        // Premium yield = (premiums - claims) * 10000 / deposits
        let ins = InsurancePoolCellData {
            total_premiums_earned: 20_000 * PRECISION,
            total_claims_paid: 5_000 * PRECISION,
            total_deposits: 100_000 * PRECISION,
            total_shares: 100_000 * PRECISION,
            ..make_insurance()
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_insurance(ins, 10_000 * PRECISION);
        let portfolio = builder.build();

        // yield_bps = (20K - 5K) * 10000 / 100K = 1500 bps = 15%
        assert_eq!(portfolio.insurance_positions[0].premium_yield_bps, 1500);
    }

    #[test]
    fn test_il_reserve0_zero() {
        // reserve0 = 0 should return IL = 0 (guard clause)
        let pool = PoolCellData {
            reserve0: 0,
            reserve1: 100_000 * PRECISION,
            ..make_pool(1, 2, 0, 100_000 * PRECISION)
        };

        let il = calculate_il(3_000 * PRECISION, &pool, 3_000 * PRECISION, PRECISION);
        assert_eq!(il, 0, "Zero reserve0 should return 0 IL");
    }

    #[test]
    fn test_prediction_single_tier_payout_equals_total() {
        // With 1 tier, payout = total_pool (all money in one tier)
        let market = PredictionMarketCellData {
            market_id: [0xDD; 32],
            num_tiers: 1,
            tier_pools: {
                let mut t = [0u128; 8];
                t[0] = 100_000 * PRECISION;
                t
            },
            status: vibeswap_types::MARKET_ACTIVE,
            ..Default::default()
        };

        let position = PredictionPositionCellData {
            market_id: [0xDD; 32],
            tier_index: 0,
            amount: 50_000 * PRECISION,
            owner_lock_hash: [0x11; 32],
            created_block: 100,
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_prediction(market, position);
        let portfolio = builder.build();

        // 50K * 100K / 100K = 50K (payout = amount when single tier)
        assert_eq!(portfolio.prediction_positions[0].potential_payout, 50_000 * PRECISION);
    }

    #[test]
    fn test_lending_deposit_only_no_borrowing() {
        // User has deposits but no collateral or debt → pure earning position
        let prices = make_prices();
        let vault = VaultCellData {
            collateral_amount: 0,
            debt_shares: 0,
            deposit_shares: 500_000 * PRECISION, // Half of total
            ..make_vault(0, 0)
        };
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lending_positions[0];
        // 500K / 1M total_shares * 1M total_deposits = 500K underlying @ $1 = 500K
        assert_eq!(pos.deposit_value, 500_000 * PRECISION);
        assert_eq!(pos.collateral_value, 0);
        assert_eq!(pos.debt_value, 0);
        assert_eq!(pos.net_value, 500_000 * PRECISION);
        assert_eq!(pos.health_factor, u128::MAX);
    }

    // ============ Batch 5: Edge Cases, Boundaries & Coverage ============

    #[test]
    fn test_lp_zero_lp_amount_in_valid_pool() {
        // User has 0 LP tokens in a pool with real reserves → values should be 0
        let prices = make_prices();
        let pool = make_pool(1, 2, 100 * PRECISION, 300_000 * PRECISION);
        let lp = make_lp(0, 3_000 * PRECISION);

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_lp(lp, pool);
        let portfolio = builder.build();

        assert_eq!(portfolio.lp_positions[0].lp_amount, 0);
        assert_eq!(portfolio.lp_positions[0].token0_value, 0);
        assert_eq!(portfolio.lp_positions[0].token1_value, 0);
        assert_eq!(portfolio.summary.lp_value, 0);
    }

    #[test]
    fn test_lending_high_borrow_index_10x_accrual() {
        // borrow_index 10x since snapshot → debt should be 10x
        let prices = make_prices();
        let vault = VaultCellData {
            borrow_index_snapshot: PRECISION,
            debt_shares: 1_000 * PRECISION,
            ..make_vault(100 * PRECISION, 1_000 * PRECISION)
        };
        let pool = LendingPoolCellData {
            borrow_index: 10 * PRECISION,
            ..make_lending_pool()
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lending_positions[0];
        assert_eq!(pos.debt_amount, 10_000 * PRECISION,
            "Debt should be 10x with 10x borrow index");
        assert_eq!(pos.debt_value, 10_000 * PRECISION);
    }

    #[test]
    fn test_insurance_user_owns_all_shares() {
        // User holds 100% of insurance pool shares
        let ins = make_insurance();
        // total_shares = 100K, so user gets 100K shares
        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_insurance(ins, 100_000 * PRECISION);
        let portfolio = builder.build();

        let pos = &portfolio.insurance_positions[0];
        // Underlying = 100% of (100K + 5K - 1K) = 104K USDC at $1 = $104K
        assert_eq!(pos.underlying_value, 104_000 * PRECISION);
        assert_eq!(pos.shares, 100_000 * PRECISION);
    }

    #[test]
    fn test_prediction_max_valid_tier_index() {
        // tier_index = 7 (last valid index in 8-element array) with num_tiers = 8
        let market = PredictionMarketCellData {
            market_id: [0xEE; 32],
            num_tiers: 8,
            tier_pools: {
                let mut t = [0u128; 8];
                for i in 0..8 {
                    t[i] = 10_000 * PRECISION;
                }
                t
            },
            status: vibeswap_types::MARKET_ACTIVE,
            ..Default::default()
        };

        let position = PredictionPositionCellData {
            market_id: [0xEE; 32],
            tier_index: 7, // last valid tier
            amount: 5_000 * PRECISION,
            owner_lock_hash: [0x11; 32],
            created_block: 100,
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_prediction(market, position);
        let portfolio = builder.build();

        // 5K * 80K / 10K = 40K payout (8 equal tiers)
        let expected = vibeswap_math::mul_div(
            5_000 * PRECISION,
            80_000 * PRECISION,
            10_000 * PRECISION,
        );
        assert_eq!(portfolio.prediction_positions[0].potential_payout, expected);
    }

    #[test]
    fn test_multiple_tokens_same_type_hash() {
        // Adding the same token type hash twice results in two separate entries
        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_token(token(1), 5 * PRECISION);
        builder.add_token(token(1), 3 * PRECISION);
        let portfolio = builder.build();

        assert_eq!(portfolio.token_balances.len(), 2);
        // Both should have correct values: 5 ETH = $15K, 3 ETH = $9K
        assert_eq!(portfolio.token_balances[0].value, 15_000 * PRECISION);
        assert_eq!(portfolio.token_balances[1].value, 9_000 * PRECISION);
        // Token value in summary = sum
        assert_eq!(portfolio.summary.token_value, 24_000 * PRECISION);
    }

    #[test]
    fn test_concentration_zero_total_value() {
        // All positions with zero value → concentration = 0
        let empty_prices = BTreeMap::new();
        let mut builder = PortfolioBuilder::new([0x11; 32], empty_prices);
        builder.add_token(token(99), 1_000 * PRECISION); // No price → 0 value
        let portfolio = builder.build();

        assert_eq!(portfolio.summary.total_value, 0);
        assert_eq!(portfolio.summary.concentration_bps, 0);
    }

    #[test]
    fn test_lp_entry_price_preserved() {
        // Verify entry_price is correctly propagated to LPPosition
        let prices = make_prices();
        let pool = make_pool(1, 2, 100 * PRECISION, 300_000 * PRECISION);
        let entry = 2_500 * PRECISION;
        let lp = make_lp(pool.total_lp_supply / 10, entry);

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_lp(lp, pool);
        let portfolio = builder.build();

        assert_eq!(portfolio.lp_positions[0].entry_price, entry);
    }

    #[test]
    fn test_insurance_premiums_exactly_equal_claims() {
        // premiums = claims → net yield = 0
        let ins = InsurancePoolCellData {
            total_premiums_earned: 5_000 * PRECISION,
            total_claims_paid: 5_000 * PRECISION,
            ..make_insurance()
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_insurance(ins, 10_000 * PRECISION);
        let portfolio = builder.build();

        assert_eq!(portfolio.insurance_positions[0].premium_yield_bps, 0);
        // Underlying = 10K/100K * (100K + 5K - 5K) = 10K
        assert_eq!(portfolio.insurance_positions[0].underlying_value, 10_000 * PRECISION);
    }

    #[test]
    fn test_lending_all_three_components_net_value() {
        // Vault with collateral + deposits + debt: verify net_value = col + dep - debt
        let prices = make_prices();
        let vault = VaultCellData {
            collateral_amount: 10 * PRECISION,       // 10 ETH
            debt_shares: 10_000 * PRECISION,          // 10K USDC debt
            deposit_shares: 200_000 * PRECISION,      // 200K deposit shares
            ..make_vault(10 * PRECISION, 10_000 * PRECISION)
        };
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lending_positions[0];
        // collateral = 10 ETH * $3000 = $30K
        assert_eq!(pos.collateral_value, 30_000 * PRECISION);
        // debt = 10K USDC * $1 = $10K
        assert_eq!(pos.debt_value, 10_000 * PRECISION);
        // deposit = 200K/1M * 1M = 200K USDC * $1 = $200K
        assert_eq!(pos.deposit_value, 200_000 * PRECISION);
        // net = 30K + 200K - 10K = 220K
        assert_eq!(pos.net_value, 220_000 * PRECISION);
    }

    #[test]
    fn test_prediction_zero_amount_bet() {
        // User bet 0 → payout = 0, prediction_value in summary = 0
        let market = PredictionMarketCellData {
            market_id: [0xAB; 32],
            num_tiers: 2,
            tier_pools: {
                let mut t = [0u128; 8];
                t[0] = 50_000 * PRECISION;
                t[1] = 50_000 * PRECISION;
                t
            },
            status: vibeswap_types::MARKET_ACTIVE,
            ..Default::default()
        };

        let position = PredictionPositionCellData {
            market_id: [0xAB; 32],
            tier_index: 0,
            amount: 0,
            owner_lock_hash: [0x11; 32],
            created_block: 100,
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_prediction(market, position);
        let portfolio = builder.build();

        assert_eq!(portfolio.prediction_positions[0].amount, 0);
        assert_eq!(portfolio.prediction_positions[0].potential_payout, 0);
        assert_eq!(portfolio.summary.prediction_value, 0);
    }

    #[test]
    fn test_lp_asymmetric_large_reserves() {
        // One side has very large reserves, the other is tiny
        let prices = make_prices();
        let pool = make_pool(1, 2, 1 * PRECISION, 3_000_000 * PRECISION);
        let lp = make_lp(pool.total_lp_supply / 2, 3_000 * PRECISION); // 50%

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_lp(lp, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lp_positions[0];
        // Should not panic, and values should reflect 50% of each side
        // 50% of 1 ETH @ $3000 = $1500
        // 50% of 3M USDC @ $1 = $1.5M
        assert!(pos.token0_value > 0);
        assert!(pos.token1_value > 0);
    }

    #[test]
    fn test_lending_borrow_index_3x_accrual() {
        // Non-power-of-2 multiplier: 3x accrual
        let prices = make_prices();
        let vault = VaultCellData {
            borrow_index_snapshot: PRECISION,
            debt_shares: 7_000 * PRECISION,
            ..make_vault(100 * PRECISION, 7_000 * PRECISION)
        };
        let pool = LendingPoolCellData {
            borrow_index: 3 * PRECISION,
            ..make_lending_pool()
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lending_positions[0];
        assert_eq!(pos.debt_amount, 21_000 * PRECISION,
            "Debt should be 3x with 3x borrow index");
    }

    #[test]
    fn test_portfolio_owner_hash_propagation() {
        // Verify the owner lock hash is correctly stored in the portfolio
        let owner = [0x42; 32];
        let builder = PortfolioBuilder::new(owner, make_prices());
        let portfolio = builder.build();

        assert_eq!(portfolio.owner_lock_hash, owner);
    }

    #[test]
    fn test_concentration_with_lending_positions_only() {
        // Concentration should work with lending net_value, not just tokens
        let prices = make_prices();
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        // Vault 1: 100 ETH collateral, 0 debt → net = $300K
        builder.add_vault(make_vault(100 * PRECISION, 0), pool.clone());
        // Vault 2: 1 ETH collateral, 0 debt → net = $3K
        builder.add_vault(make_vault(1 * PRECISION, 0), pool);
        let portfolio = builder.build();

        // Total = $303K, max = $300K → ~99% concentration
        assert!(portfolio.summary.concentration_bps > 9800,
            "Concentration should reflect dominant lending position: {}",
            portfolio.summary.concentration_bps);
    }

    #[test]
    fn test_apy_with_zero_value_insurance() {
        // Insurance position present but underlying_value = 0 → shouldn't contribute to APY
        let ins = InsurancePoolCellData {
            total_shares: 0, // zero shares → zero value
            ..make_insurance()
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_insurance(ins, 0); // 0 user shares
        let portfolio = builder.build();

        // No earning value → APY = 0
        assert_eq!(portfolio.summary.estimated_apy_bps, 0);
    }

    #[test]
    fn test_prediction_two_bets_same_market_different_tiers() {
        // Two positions on the same market, different tiers
        let market = PredictionMarketCellData {
            market_id: [0xBC; 32],
            num_tiers: 3,
            tier_pools: {
                let mut t = [0u128; 8];
                t[0] = 40_000 * PRECISION;
                t[1] = 30_000 * PRECISION;
                t[2] = 30_000 * PRECISION;
                t
            },
            status: vibeswap_types::MARKET_ACTIVE,
            ..Default::default()
        };

        let pos0 = PredictionPositionCellData {
            market_id: [0xBC; 32],
            tier_index: 0,
            amount: 10_000 * PRECISION,
            owner_lock_hash: [0x11; 32],
            created_block: 100,
        };
        let pos2 = PredictionPositionCellData {
            market_id: [0xBC; 32],
            tier_index: 2,
            amount: 5_000 * PRECISION,
            owner_lock_hash: [0x11; 32],
            created_block: 110,
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_prediction(market.clone(), pos0);
        builder.add_prediction(market, pos2);
        let portfolio = builder.build();

        assert_eq!(portfolio.prediction_positions.len(), 2);
        // Total prediction value = 10K + 5K = 15K
        assert_eq!(portfolio.summary.prediction_value, 15_000 * PRECISION);
        // Tier 0 payout: 10K * 100K / 40K = 25K
        let payout0 = vibeswap_math::mul_div(
            10_000 * PRECISION, 100_000 * PRECISION, 40_000 * PRECISION,
        );
        assert_eq!(portfolio.prediction_positions[0].potential_payout, payout0);
        // Tier 2 payout: 5K * 100K / 30K = ~16.67K
        let payout2 = vibeswap_math::mul_div(
            5_000 * PRECISION, 100_000 * PRECISION, 30_000 * PRECISION,
        );
        assert_eq!(portfolio.prediction_positions[1].potential_payout, payout2);
    }

    #[test]
    fn test_lending_collateral_value_with_unknown_price() {
        // Collateral token not in price map → collateral price = 0 → collateral_value = 0
        let mut prices = make_prices();
        // Remove ETH price so collateral has no price
        prices.remove(&token(1));

        let vault = make_vault(10 * PRECISION, 5_000 * PRECISION);
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lending_positions[0];
        assert_eq!(pos.collateral_value, 0, "Unknown collateral price → 0 value");
        // HF should be 0 since collateral_value = 0 but debt > 0
        // HF = (0 * liquidation_threshold) / debt_value = 0
        assert_eq!(pos.health_factor, 0);
    }

    #[test]
    fn test_lending_debt_token_unknown_price_uses_precision() {
        // Debt token (asset_type_hash) not in price map → defaults to PRECISION (=$1)
        let mut prices = make_prices();
        // Remove USDC from prices — but the lending pool's asset is USDC (token(2))
        prices.remove(&token(2));

        let vault = make_vault(10 * PRECISION, 5_000 * PRECISION);
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lending_positions[0];
        // Debt price defaults to PRECISION (1.0), so debt_value = 5K * 1 = 5K
        assert_eq!(pos.debt_value, 5_000 * PRECISION);
    }

    #[test]
    fn test_insurance_asset_price_defaults_to_precision() {
        // Insurance asset not in price map → defaults to PRECISION ($1)
        let mut ins = make_insurance();
        ins.asset_type_hash = token(99); // Token not in price map

        let empty_prices = BTreeMap::new();
        let mut builder = PortfolioBuilder::new([0x11; 32], empty_prices);
        builder.add_insurance(ins, 10_000 * PRECISION);
        let portfolio = builder.build();

        // Price defaults to PRECISION, so value should still be computed
        // underlying = 10K/100K * (100K + 5K - 1K) = 10.4K
        // value = 10.4K * PRECISION / PRECISION = 10.4K
        assert_eq!(portfolio.insurance_positions[0].underlying_value, 10_400 * PRECISION);
    }

    #[test]
    fn test_summary_protocol_count_tokens_only() {
        // Only token positions → protocol_count = 1
        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_token(token(1), PRECISION);
        let portfolio = builder.build();

        assert_eq!(portfolio.summary.protocol_count, 1);
    }

    #[test]
    fn test_summary_protocol_count_lending_only() {
        // Only lending → protocol_count = 1
        let prices = make_prices();
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(make_vault(10 * PRECISION, 5_000 * PRECISION), pool);
        let portfolio = builder.build();

        assert_eq!(portfolio.summary.protocol_count, 1);
    }

    #[test]
    fn test_il_small_price_change_low_il() {
        // Small price change (e.g., 10%) should produce low IL
        let pool = PoolCellData {
            reserve0: 100 * PRECISION,
            reserve1: 110 * PRECISION, // current price = 1.1
            ..make_pool(1, 2, 100 * PRECISION, 110 * PRECISION)
        };
        let entry_price = PRECISION; // entry was 1.0, now 1.1 = 10% move

        let il = calculate_il(entry_price, &pool, 0, 0);
        // 10% price change should give very small IL (< 100 bps = 1%)
        assert!(il < 100, "10% price change should give < 100 bps IL, got: {}", il);
        assert!(il > 0, "10% price change should give non-zero IL");
    }

    #[test]
    fn test_lp_half_pool_share_values() {
        // User owns exactly 50% of pool
        let prices = make_prices();
        let pool = make_pool(1, 2, 200 * PRECISION, 600_000 * PRECISION);
        let lp = make_lp(pool.total_lp_supply / 2, 3_000 * PRECISION);

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_lp(lp, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lp_positions[0];
        // 50% of 200 ETH = 100 ETH @ $3000 = ~$300,000 (mul_div rounding)
        let expected_t0 = 300_000 * PRECISION;
        assert!(pos.token0_value > expected_t0 - PRECISION && pos.token0_value <= expected_t0,
            "token0_value should be ~$300K: {}", pos.token0_value);
        // 50% of 600K USDC @ $1 = ~$300,000
        let expected_t1 = 300_000 * PRECISION;
        assert!(pos.token1_value > expected_t1 - PRECISION && pos.token1_value <= expected_t1,
            "token1_value should be ~$300K: {}", pos.token1_value);
        // Total LP value should be ~$600K
        assert!(portfolio.summary.lp_value > 599_000 * PRECISION,
            "lp_value should be ~$600K: {}", portfolio.summary.lp_value);
    }

    // ============ Batch 6: Hardening Tests (Target 105+) ============

    #[test]
    fn test_lp_position_lp_amount_preserved() {
        // Verify lp_amount from the input is carried through to the output
        let prices = make_prices();
        let pool = make_pool(1, 2, 100 * PRECISION, 300_000 * PRECISION);
        let target_amount = 42_000 * PRECISION;
        let lp = make_lp(target_amount, 3_000 * PRECISION);

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_lp(lp, pool);
        let portfolio = builder.build();

        assert_eq!(portfolio.lp_positions[0].lp_amount, target_amount);
    }

    #[test]
    fn test_lending_fractional_borrow_index_150_percent() {
        // borrow_index = 1.5x snapshot -> debt should be 1.5x
        let prices = make_prices();
        let vault = VaultCellData {
            borrow_index_snapshot: PRECISION,
            debt_shares: 10_000 * PRECISION,
            ..make_vault(100 * PRECISION, 10_000 * PRECISION)
        };
        let pool = LendingPoolCellData {
            borrow_index: PRECISION * 3 / 2, // 1.5x
            ..make_lending_pool()
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lending_positions[0];
        assert_eq!(pos.debt_amount, 15_000 * PRECISION,
            "Debt should be 1.5x with 1.5x borrow index");
    }

    #[test]
    fn test_il_very_small_price_change_near_zero_il() {
        // Very small price deviation (1%) should give negligible IL
        let pool = PoolCellData {
            reserve0: 100 * PRECISION,
            reserve1: 101 * PRECISION, // current price = 1.01
            ..make_pool(1, 2, 100 * PRECISION, 101 * PRECISION)
        };
        let entry_price = PRECISION; // entry was 1.0

        let il = calculate_il(entry_price, &pool, 0, 0);
        // 1% price change should give extremely small IL
        assert!(il < 10, "1% price change should give < 10 bps IL, got: {}", il);
    }

    #[test]
    fn test_summary_lending_net_value_with_negative_position() {
        // When debt > collateral on one vault but positive on another,
        // total lending_net should be the sum of saturated net values
        let prices = make_prices();
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        // Vault 1: underwater (1 ETH = $3K col, 10K debt) -> net saturates to 0
        builder.add_vault(make_vault(1 * PRECISION, 10_000 * PRECISION), pool.clone());
        // Vault 2: healthy (100 ETH = $300K col, 5K debt) -> net = 295K
        builder.add_vault(make_vault(100 * PRECISION, 5_000 * PRECISION), pool);
        let portfolio = builder.build();

        // First vault net saturates to 0
        assert_eq!(portfolio.lending_positions[0].net_value, 0);
        // Second vault net = 300K - 5K = 295K
        assert_eq!(portfolio.lending_positions[1].net_value, 295_000 * PRECISION);
        // Total lending_net = 0 + 295K = 295K
        assert_eq!(portfolio.summary.lending_net_value, 295_000 * PRECISION);
    }

    #[test]
    fn test_prediction_tier_index_exactly_at_boundary() {
        // tier_index == num_tiers (out of bounds) vs tier_index == num_tiers - 1 (valid)
        let market = PredictionMarketCellData {
            market_id: [0xF1; 32],
            num_tiers: 3,
            tier_pools: {
                let mut t = [0u128; 8];
                t[0] = 30_000 * PRECISION;
                t[1] = 30_000 * PRECISION;
                t[2] = 40_000 * PRECISION;
                t
            },
            status: vibeswap_types::MARKET_ACTIVE,
            ..Default::default()
        };

        // Valid: tier_index = 2 (last valid for num_tiers=3)
        let pos_valid = PredictionPositionCellData {
            market_id: [0xF1; 32],
            tier_index: 2,
            amount: 5_000 * PRECISION,
            owner_lock_hash: [0x11; 32],
            created_block: 100,
        };

        // Invalid: tier_index = 3 (out of bounds for num_tiers=3)
        let pos_invalid = PredictionPositionCellData {
            market_id: [0xF1; 32],
            tier_index: 3,
            amount: 5_000 * PRECISION,
            owner_lock_hash: [0x11; 32],
            created_block: 100,
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_prediction(market.clone(), pos_valid);
        builder.add_prediction(market, pos_invalid);
        let portfolio = builder.build();

        // Valid tier gets a payout
        assert!(portfolio.prediction_positions[0].potential_payout > 0);
        // Invalid tier gets 0
        assert_eq!(portfolio.prediction_positions[1].potential_payout, 0);
    }

    #[test]
    fn test_insurance_huge_premiums_relative_to_deposits() {
        // When premiums earned greatly exceed deposits, yield_bps can be very large
        let ins = InsurancePoolCellData {
            total_premiums_earned: 500_000 * PRECISION,
            total_claims_paid: 0,
            total_deposits: 100_000 * PRECISION,
            total_shares: 100_000 * PRECISION,
            ..make_insurance()
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_insurance(ins, 10_000 * PRECISION);
        let portfolio = builder.build();

        // yield_bps = 500K * 10000 / 100K = 50000 bps = 500%
        assert_eq!(portfolio.insurance_positions[0].premium_yield_bps, 50000);
    }

    #[test]
    fn test_portfolio_total_value_additivity() {
        // Building incrementally should produce the same total as building all at once
        let prices = make_prices();
        let pool = make_pool(1, 2, 100 * PRECISION, 300_000 * PRECISION);
        let lp = make_lp(pool.total_lp_supply / 10, 3_000 * PRECISION);

        // Portfolio with LP only
        let mut b1 = PortfolioBuilder::new([0x11; 32], prices.clone());
        b1.add_lp(lp.clone(), pool.clone());
        let p1 = b1.build();

        // Portfolio with tokens only
        let mut b2 = PortfolioBuilder::new([0x11; 32], prices.clone());
        b2.add_token(token(2), 5_000 * PRECISION);
        let p2 = b2.build();

        // Combined portfolio
        let mut b3 = PortfolioBuilder::new([0x11; 32], prices);
        b3.add_lp(lp, pool);
        b3.add_token(token(2), 5_000 * PRECISION);
        let p3 = b3.build();

        // Total should be sum of individual component values
        let expected = p1.summary.lp_value + p2.summary.token_value;
        assert_eq!(p3.summary.total_value, expected,
            "Combined total should equal sum of individual component values");
    }

    #[test]
    fn test_concentration_with_prediction_and_insurance() {
        // Concentration considers all position types including prediction and insurance
        let prices = make_prices();
        let ins = make_insurance();

        let market = PredictionMarketCellData {
            market_id: [0xF2; 32],
            num_tiers: 2,
            tier_pools: {
                let mut t = [0u128; 8];
                t[0] = 50_000 * PRECISION;
                t[1] = 50_000 * PRECISION;
                t
            },
            status: vibeswap_types::MARKET_ACTIVE,
            ..Default::default()
        };
        let position = PredictionPositionCellData {
            market_id: [0xF2; 32],
            tier_index: 0,
            amount: 1_000 * PRECISION, // Small bet
            owner_lock_hash: [0x11; 32],
            created_block: 100,
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        // ~$10.4K from insurance
        builder.add_insurance(ins, 10_000 * PRECISION);
        // $1K from prediction
        builder.add_prediction(market, position);
        let portfolio = builder.build();

        // Insurance should dominate: ~10.4K / ~11.4K
        assert!(portfolio.summary.concentration_bps > 8000,
            "Insurance should dominate concentration: {}", portfolio.summary.concentration_bps);
    }

    #[test]
    fn test_lending_deposit_shares_exceeds_total_shares() {
        // Edge: user's deposit_shares > pool total_shares (shouldn't happen but test robustness)
        let prices = make_prices();
        let vault = VaultCellData {
            deposit_shares: 2_000_000 * PRECISION, // 2x total
            ..make_vault(10 * PRECISION, 5_000 * PRECISION)
        };
        let pool = make_lending_pool(); // total_shares = 1M

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lending_positions[0];
        // 2M / 1M * 1M deposits = 2M underlying at $1 = $2M
        assert_eq!(pos.deposit_value, 2_000_000 * PRECISION);
    }

    #[test]
    fn test_lp_three_pools_summary_aggregation() {
        // Three LP positions across different pools, verify summary aggregates all
        let prices = make_prices();
        let pool1 = make_pool(1, 2, 100 * PRECISION, 300_000 * PRECISION);
        let pool2 = make_pool(1, 2, 50 * PRECISION, 150_000 * PRECISION);
        let pool3 = make_pool(1, 2, 200 * PRECISION, 600_000 * PRECISION);
        let lp1 = make_lp(pool1.total_lp_supply / 10, 3_000 * PRECISION);
        let lp2 = make_lp(pool2.total_lp_supply / 10, 3_000 * PRECISION);
        let lp3 = make_lp(pool3.total_lp_supply / 10, 3_000 * PRECISION);

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_lp(lp1, pool1).add_lp(lp2, pool2).add_lp(lp3, pool3);
        let portfolio = builder.build();

        assert_eq!(portfolio.lp_positions.len(), 3);
        // Summary lp_value should be sum of all three positions
        let manual_sum: u128 = portfolio.lp_positions.iter()
            .map(|p| p.token0_value + p.token1_value)
            .sum();
        assert_eq!(portfolio.summary.lp_value, manual_sum);
        assert_eq!(portfolio.summary.protocol_count, 1); // All LP
    }

    #[test]
    fn test_prediction_market_id_preserved() {
        // Verify market_id is correctly propagated to the output
        let market = PredictionMarketCellData {
            market_id: [0xAB; 32],
            num_tiers: 2,
            tier_pools: {
                let mut t = [0u128; 8];
                t[0] = 50_000 * PRECISION;
                t[1] = 50_000 * PRECISION;
                t
            },
            status: vibeswap_types::MARKET_ACTIVE,
            ..Default::default()
        };
        let position = PredictionPositionCellData {
            market_id: [0xAB; 32],
            tier_index: 0,
            amount: 1_000 * PRECISION,
            owner_lock_hash: [0x11; 32],
            created_block: 100,
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_prediction(market, position);
        let portfolio = builder.build();

        assert_eq!(portfolio.prediction_positions[0].market_id, [0xAB; 32]);
    }

    #[test]
    fn test_prediction_tier_index_preserved() {
        // Verify tier_index is correctly propagated
        let market = PredictionMarketCellData {
            market_id: [0xCD; 32],
            num_tiers: 4,
            tier_pools: {
                let mut t = [0u128; 8];
                for i in 0..4 { t[i] = 25_000 * PRECISION; }
                t
            },
            status: vibeswap_types::MARKET_ACTIVE,
            ..Default::default()
        };
        let position = PredictionPositionCellData {
            market_id: [0xCD; 32],
            tier_index: 3,
            amount: 2_000 * PRECISION,
            owner_lock_hash: [0x11; 32],
            created_block: 100,
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_prediction(market, position);
        let portfolio = builder.build();

        assert_eq!(portfolio.prediction_positions[0].tier_index, 3);
    }

    #[test]
    fn test_lending_collateral_amount_preserved() {
        // Verify collateral_amount is correctly propagated
        let prices = make_prices();
        let vault = make_vault(77 * PRECISION, 5_000 * PRECISION);
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        assert_eq!(portfolio.lending_positions[0].collateral_amount, 77 * PRECISION);
    }

    #[test]
    fn test_lending_deposit_shares_preserved() {
        // Verify deposit_shares is correctly propagated
        let prices = make_prices();
        let vault = VaultCellData {
            deposit_shares: 33_333 * PRECISION,
            ..make_vault(10 * PRECISION, 5_000 * PRECISION)
        };
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        assert_eq!(portfolio.lending_positions[0].deposit_shares, 33_333 * PRECISION);
    }

    // ============ Batch 7: Hardening to 120+ Tests ============

    #[test]
    fn test_empty_portfolio_protocol_count_zero() {
        let builder = PortfolioBuilder::new([0x11; 32], make_prices());
        let portfolio = builder.build();
        assert_eq!(portfolio.summary.protocol_count, 0);
    }

    #[test]
    fn test_empty_portfolio_worst_hf_is_max() {
        let builder = PortfolioBuilder::new([0x11; 32], make_prices());
        let portfolio = builder.build();
        assert_eq!(portfolio.summary.worst_health_factor, u128::MAX);
    }

    #[test]
    fn test_lp_positions_empty_in_empty_portfolio() {
        let builder = PortfolioBuilder::new([0x11; 32], make_prices());
        let portfolio = builder.build();
        assert!(portfolio.lp_positions.is_empty());
        assert!(portfolio.lending_positions.is_empty());
        assert!(portfolio.insurance_positions.is_empty());
        assert!(portfolio.prediction_positions.is_empty());
        assert!(portfolio.token_balances.is_empty());
    }

    #[test]
    fn test_lending_health_factor_exactly_one() {
        // Construct a vault where HF = exactly 1.0 (PRECISION)
        // HF = (collateral_value * liquidation_threshold) / debt_value
        // With LTV 80% (8000 bps): HF = 1.0 when col*0.8 = debt
        // col = 10 ETH * $3000 = $30K, debt = $24K → HF = 30K*0.8/24K = 1.0
        let prices = make_prices();
        let vault = make_vault(10 * PRECISION, 24_000 * PRECISION);
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lending_positions[0];
        assert_eq!(pos.health_factor, PRECISION, "HF should be exactly 1.0");
    }

    #[test]
    fn test_insurance_position_shares_preserved() {
        let ins = make_insurance();
        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_insurance(ins, 42_000 * PRECISION);
        let portfolio = builder.build();

        assert_eq!(portfolio.insurance_positions[0].shares, 42_000 * PRECISION);
    }

    #[test]
    fn test_prediction_amount_preserved() {
        let market = PredictionMarketCellData {
            market_id: [0xF3; 32],
            num_tiers: 2,
            tier_pools: {
                let mut t = [0u128; 8];
                t[0] = 50_000 * PRECISION;
                t[1] = 50_000 * PRECISION;
                t
            },
            status: vibeswap_types::MARKET_ACTIVE,
            ..Default::default()
        };
        let position = PredictionPositionCellData {
            market_id: [0xF3; 32],
            tier_index: 1,
            amount: 7_777 * PRECISION,
            owner_lock_hash: [0x11; 32],
            created_block: 100,
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_prediction(market, position);
        let portfolio = builder.build();

        assert_eq!(portfolio.prediction_positions[0].amount, 7_777 * PRECISION);
    }

    #[test]
    fn test_token_balance_amount_preserved() {
        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_token(token(1), 123 * PRECISION);
        let portfolio = builder.build();

        assert_eq!(portfolio.token_balances[0].amount, 123 * PRECISION);
    }

    #[test]
    fn test_summary_total_value_empty_is_zero() {
        let builder = PortfolioBuilder::new([0x11; 32], make_prices());
        let portfolio = builder.build();
        assert_eq!(portfolio.summary.total_value, 0);
    }

    #[test]
    fn test_lp_position_il_bps_type() {
        // IL should be a u16 value (0..=10000)
        let prices = make_prices();
        let pool = PoolCellData {
            reserve0: 100 * PRECISION,
            reserve1: 200 * PRECISION,
            ..make_pool(1, 2, 100 * PRECISION, 200 * PRECISION)
        };
        let lp = make_lp(pool.total_lp_supply / 10, PRECISION);

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_lp(lp, pool);
        let portfolio = builder.build();

        assert!(portfolio.lp_positions[0].il_bps <= 10_000);
    }

    #[test]
    fn test_lending_net_value_with_deposits_only() {
        // No collateral, no debt, just deposits → net = deposit_value
        let prices = make_prices();
        let vault = VaultCellData {
            collateral_amount: 0,
            debt_shares: 0,
            deposit_shares: 50_000 * PRECISION,
            ..make_vault(0, 0)
        };
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(vault, pool);
        let portfolio = builder.build();

        let pos = &portfolio.lending_positions[0];
        assert_eq!(pos.net_value, pos.deposit_value);
    }

    #[test]
    fn test_summary_lending_net_is_sum() {
        // Total lending_net_value should be sum of all positions' net_value
        let prices = make_prices();
        let pool = make_lending_pool();

        let mut builder = PortfolioBuilder::new([0x11; 32], prices);
        builder.add_vault(make_vault(10 * PRECISION, 5_000 * PRECISION), pool.clone());
        builder.add_vault(make_vault(20 * PRECISION, 10_000 * PRECISION), pool);
        let portfolio = builder.build();

        let manual_sum: u128 = portfolio.lending_positions.iter()
            .map(|p| p.net_value)
            .sum();
        assert_eq!(portfolio.summary.lending_net_value, manual_sum);
    }

    #[test]
    fn test_summary_insurance_value_is_sum() {
        // Total insurance_value should be sum of all positions' underlying_value
        let ins1 = make_insurance();
        let ins2 = InsurancePoolCellData {
            pool_id: [0x44; 32],
            ..make_insurance()
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_insurance(ins1, 10_000 * PRECISION);
        builder.add_insurance(ins2, 20_000 * PRECISION);
        let portfolio = builder.build();

        let manual_sum: u128 = portfolio.insurance_positions.iter()
            .map(|p| p.underlying_value)
            .sum();
        assert_eq!(portfolio.summary.insurance_value, manual_sum);
    }

    #[test]
    fn test_summary_prediction_value_is_sum_of_amounts() {
        // prediction_value in summary should be sum of all position amounts
        let make_market = |id: u8| PredictionMarketCellData {
            market_id: [id; 32],
            num_tiers: 2,
            tier_pools: {
                let mut t = [0u128; 8];
                t[0] = 50_000 * PRECISION;
                t[1] = 50_000 * PRECISION;
                t
            },
            status: vibeswap_types::MARKET_ACTIVE,
            ..Default::default()
        };
        let make_pos = |id: u8, amount: u128| PredictionPositionCellData {
            market_id: [id; 32],
            tier_index: 0,
            amount,
            owner_lock_hash: [0x11; 32],
            created_block: 100,
        };

        let mut builder = PortfolioBuilder::new([0x11; 32], make_prices());
        builder.add_prediction(make_market(1), make_pos(1, 3_000 * PRECISION));
        builder.add_prediction(make_market(2), make_pos(2, 7_000 * PRECISION));
        let portfolio = builder.build();

        assert_eq!(portfolio.summary.prediction_value, 10_000 * PRECISION);
    }
}
