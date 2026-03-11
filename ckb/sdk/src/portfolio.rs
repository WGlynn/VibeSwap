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
}
