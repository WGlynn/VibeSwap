// ============ CKB Lending Math Library ============
// Integer-only lending protocol math for Nervos CKB.
// Reusable by any CKB DeFi builder — not VibeSwap-specific.
//
// All arithmetic uses u128 with 18 decimal precision (1e18).
// NO floating-point anywhere (P-101: Consensus Determinism Constraint).
// Every function is deterministic across all platforms.

#![cfg_attr(feature = "no_std", no_std)]

#[cfg(feature = "no_std")]
extern crate alloc;

// ============ Constants ============

pub const PRECISION: u128 = 1_000_000_000_000_000_000; // 1e18
pub const BPS_DENOMINATOR: u128 = 10_000;
pub const PERCENT_DENOMINATOR: u128 = 100;

/// ~2,628,000 blocks/year at CKB's ~12s block time
/// (365.25 days * 24h * 60m * 60s / 12s)
pub const BLOCKS_PER_YEAR: u128 = 2_628_000;

/// Maximum health factor precision for comparisons
pub const HEALTH_FACTOR_PRECISION: u128 = PRECISION;

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LendingError {
    ZeroDeposits,
    ZeroDebt,
    ZeroCollateral,
    ZeroPrice,
    InvalidUtilization,
    InvalidRate,
    InvalidFactor,
    OverCollateralized,
    UnderCollateralized,
    ExceedsCloseLimit,
    Overflow,
    InvalidBlockDelta,
    InsufficientLiquidity,
}

// ============ Interest Rate Model (Kinked Utilization Curve) ============
//
// The standard DeFi interest rate model (Compound V2 / Aave):
// - Below optimal utilization: gentle slope encourages borrowing
// - Above optimal utilization: steep slope incentivizes repayment
//
// Borrow rate:
//   if U <= U_optimal:
//     R = base_rate + U * slope1 / U_optimal
//   else:
//     R = base_rate + slope1 + (U - U_optimal) * slope2 / (1 - U_optimal)
//
// All values scaled by PRECISION (1e18).

pub mod interest {
    use super::*;

    /// Interest rate model parameters (all scaled by PRECISION)
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct RateModel {
        /// Base borrow rate at 0% utilization (e.g., 2% = 0.02e18)
        pub base_rate: u128,
        /// Slope below optimal utilization (e.g., 4% = 0.04e18)
        pub slope1: u128,
        /// Slope above optimal utilization (e.g., 300% = 3.0e18)
        pub slope2: u128,
        /// Optimal utilization target (e.g., 80% = 0.8e18)
        pub optimal_utilization: u128,
        /// Reserve factor — fraction of interest that goes to protocol (e.g., 10% = 0.1e18)
        pub reserve_factor: u128,
    }

    impl RateModel {
        /// Default conservative model: 2% base, 4% slope1, 300% slope2, 80% kink
        pub fn default_stable() -> Self {
            Self {
                base_rate: 20_000_000_000_000_000,        // 2%
                slope1: 40_000_000_000_000_000,            // 4%
                slope2: 3_000_000_000_000_000_000,         // 300%
                optimal_utilization: 800_000_000_000_000_000, // 80%
                reserve_factor: 100_000_000_000_000_000,   // 10%
            }
        }

        /// Volatile asset model: higher base rate, steeper slopes
        pub fn default_volatile() -> Self {
            Self {
                base_rate: 50_000_000_000_000_000,         // 5%
                slope1: 80_000_000_000_000_000,            // 8%
                slope2: 5_000_000_000_000_000_000,         // 500%
                optimal_utilization: 650_000_000_000_000_000, // 65%
                reserve_factor: 200_000_000_000_000_000,   // 20%
            }
        }
    }

    /// Calculate utilization rate: U = totalBorrows / totalDeposits
    /// Returns value scaled by PRECISION (0 to 1e18)
    pub fn utilization_rate(
        total_borrows: u128,
        total_deposits: u128,
    ) -> Result<u128, LendingError> {
        if total_deposits == 0 {
            if total_borrows == 0 {
                return Ok(0);
            }
            return Err(LendingError::ZeroDeposits);
        }
        Ok(mul_div(total_borrows, PRECISION, total_deposits))
    }

    /// Calculate borrow rate per year given utilization
    /// Returns annual rate scaled by PRECISION
    pub fn borrow_rate(
        utilization: u128,
        model: &RateModel,
    ) -> Result<u128, LendingError> {
        if utilization > PRECISION {
            return Err(LendingError::InvalidUtilization);
        }

        if utilization <= model.optimal_utilization {
            // Below kink: base + U * slope1 / U_optimal
            let variable = if model.optimal_utilization == 0 {
                0
            } else {
                mul_div(utilization, model.slope1, model.optimal_utilization)
            };
            Ok(model.base_rate + variable)
        } else {
            // Above kink: base + slope1 + (U - U_opt) * slope2 / (1 - U_opt)
            let excess = utilization - model.optimal_utilization;
            let denominator = PRECISION - model.optimal_utilization;
            if denominator == 0 {
                return Ok(model.base_rate + model.slope1 + model.slope2);
            }
            let steep = mul_div(excess, model.slope2, denominator);
            Ok(model.base_rate + model.slope1 + steep)
        }
    }

    /// Calculate supply rate: R_supply = R_borrow * U * (1 - reserveFactor)
    pub fn supply_rate(
        borrow_rate_annual: u128,
        utilization: u128,
        reserve_factor: u128,
    ) -> Result<u128, LendingError> {
        if reserve_factor > PRECISION {
            return Err(LendingError::InvalidFactor);
        }
        let one_minus_rf = PRECISION - reserve_factor;
        // supply = borrow_rate * utilization * (1 - rf) / PRECISION^2
        let intermediate = mul_div(borrow_rate_annual, utilization, PRECISION);
        Ok(mul_div(intermediate, one_minus_rf, PRECISION))
    }

    /// Calculate per-block borrow rate from annual rate
    pub fn per_block_rate(annual_rate: u128) -> u128 {
        annual_rate / BLOCKS_PER_YEAR
    }

    /// Accrue interest over a number of blocks using linear approximation.
    /// For CKB's ~12s blocks, the per-block rate is tiny (~1e-9),
    /// so linear approximation error is negligible for typical accrual windows.
    ///
    /// Returns: (new_total_borrows, interest_accrued, protocol_share)
    pub fn accrue_interest(
        total_borrows: u128,
        annual_rate: u128,
        blocks_elapsed: u128,
        reserve_factor: u128,
    ) -> Result<(u128, u128, u128), LendingError> {
        if blocks_elapsed == 0 {
            return Ok((total_borrows, 0, 0));
        }

        let block_rate = per_block_rate(annual_rate);
        let interest = mul_div(total_borrows, block_rate * blocks_elapsed, PRECISION);
        let protocol_share = mul_div(interest, reserve_factor, PRECISION);
        let new_borrows = total_borrows + interest;

        Ok((new_borrows, interest, protocol_share))
    }

    /// Compound interest for large block gaps using exponentiation by squaring.
    /// Computes: principal * (1 + rate_per_block)^blocks
    /// Uses fixed-point integer arithmetic throughout.
    ///
    /// For most lending accruals, `accrue_interest` (linear) is sufficient.
    /// Use this only when blocks_elapsed is very large (>100,000).
    pub fn compound_interest(
        principal: u128,
        annual_rate: u128,
        blocks_elapsed: u128,
    ) -> Result<u128, LendingError> {
        if blocks_elapsed == 0 || principal == 0 {
            return Ok(principal);
        }

        let rate_per_block = per_block_rate(annual_rate);

        // (1 + r) in fixed-point
        let base = PRECISION + rate_per_block;

        // Exponentiation by squaring: base^blocks in fixed-point
        let multiplier = exp_by_squaring(base, blocks_elapsed);

        Ok(mul_div(principal, multiplier, PRECISION))
    }
}

// ============ Collateral & Health Factor ============

pub mod collateral {
    use super::*;

    /// Collateral parameters for an asset
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct CollateralParams {
        /// Collateral factor (e.g., 75% = 0.75e18 means $1 of collateral supports $0.75 of debt)
        pub collateral_factor: u128,
        /// Liquidation threshold (e.g., 80% = 0.8e18 — liquidate when collateral value * LT < debt)
        pub liquidation_threshold: u128,
        /// Liquidation incentive (e.g., 5% = 0.05e18 bonus for liquidators)
        pub liquidation_incentive: u128,
        /// Close factor — max fraction of debt liquidatable in one tx (e.g., 50% = 0.5e18)
        pub close_factor: u128,
    }

    impl CollateralParams {
        /// Default conservative parameters
        pub fn default_stable() -> Self {
            Self {
                collateral_factor: 750_000_000_000_000_000,    // 75%
                liquidation_threshold: 800_000_000_000_000_000, // 80%
                liquidation_incentive: 50_000_000_000_000_000,  // 5%
                close_factor: 500_000_000_000_000_000,          // 50%
            }
        }

        /// Parameters for volatile assets (lower factors, higher incentives)
        pub fn default_volatile() -> Self {
            Self {
                collateral_factor: 500_000_000_000_000_000,    // 50%
                liquidation_threshold: 650_000_000_000_000_000, // 65%
                liquidation_incentive: 100_000_000_000_000_000, // 10%
                close_factor: 500_000_000_000_000_000,          // 50%
            }
        }
    }

    /// Calculate collateral value in base currency units
    /// collateral_value = amount * price / PRECISION
    pub fn collateral_value(amount: u128, price: u128) -> u128 {
        mul_div(amount, price, PRECISION)
    }

    /// Calculate maximum borrow capacity given collateral
    /// max_borrow = collateral_value * collateral_factor / PRECISION
    pub fn max_borrow(
        collateral_amount: u128,
        collateral_price: u128,
        collateral_factor: u128,
    ) -> Result<u128, LendingError> {
        if collateral_price == 0 {
            return Err(LendingError::ZeroPrice);
        }
        let value = collateral_value(collateral_amount, collateral_price);
        Ok(mul_div(value, collateral_factor, PRECISION))
    }

    /// Calculate health factor: HF = (collateral_value * liquidation_threshold) / debt_value
    /// HF > 1.0 (1e18) = safe, HF < 1.0 = liquidatable
    pub fn health_factor(
        collateral_amount: u128,
        collateral_price: u128,
        debt_amount: u128,
        debt_price: u128,
        liquidation_threshold: u128,
    ) -> Result<u128, LendingError> {
        if debt_amount == 0 {
            // No debt = infinite health (return max)
            return Ok(u128::MAX);
        }
        if collateral_price == 0 || debt_price == 0 {
            return Err(LendingError::ZeroPrice);
        }

        let col_value = collateral_value(collateral_amount, collateral_price);
        let adjusted = mul_div(col_value, liquidation_threshold, PRECISION);
        let debt_value = collateral_value(debt_amount, debt_price);

        Ok(mul_div(adjusted, PRECISION, debt_value))
    }

    /// Check if a position is liquidatable
    pub fn is_liquidatable(
        collateral_amount: u128,
        collateral_price: u128,
        debt_amount: u128,
        debt_price: u128,
        liquidation_threshold: u128,
    ) -> Result<bool, LendingError> {
        let hf = health_factor(
            collateral_amount,
            collateral_price,
            debt_amount,
            debt_price,
            liquidation_threshold,
        )?;
        Ok(hf < PRECISION)
    }

    /// Calculate maximum liquidatable amount respecting close factor
    /// Returns (max_debt_to_repay, collateral_to_seize)
    pub fn liquidation_amounts(
        collateral_amount: u128,
        collateral_price: u128,
        debt_amount: u128,
        debt_price: u128,
        params: &CollateralParams,
    ) -> Result<(u128, u128), LendingError> {
        // Verify position is liquidatable
        if !is_liquidatable(
            collateral_amount,
            collateral_price,
            debt_amount,
            debt_price,
            params.liquidation_threshold,
        )? {
            return Err(LendingError::OverCollateralized);
        }

        // Max debt repayable = debt * close_factor
        let max_repay = mul_div(debt_amount, params.close_factor, PRECISION);

        // Collateral seized per unit of debt repaid:
        // seized_value = repay_value * (1 + incentive)
        // seized_amount = seized_value / collateral_price
        let repay_value = collateral_value(max_repay, debt_price);
        let seized_value = mul_div(
            repay_value,
            PRECISION + params.liquidation_incentive,
            PRECISION,
        );
        let seized_amount = mul_div(seized_value, PRECISION, collateral_price);

        // Cap seized amount at available collateral
        let actual_seized = if seized_amount > collateral_amount {
            collateral_amount
        } else {
            seized_amount
        };

        // Back-calculate actual repay from actual seized
        let actual_repay = if seized_amount > collateral_amount {
            // We're seizing all collateral, so repay less
            let seized_value = collateral_value(collateral_amount, collateral_price);
            let repay_value = mul_div(
                seized_value,
                PRECISION,
                PRECISION + params.liquidation_incentive,
            );
            mul_div(repay_value, PRECISION, debt_price)
        } else {
            max_repay
        };

        Ok((actual_repay, actual_seized))
    }

    /// Calculate bad debt after a liquidation where collateral < debt
    /// Returns the socialized loss amount
    pub fn bad_debt(
        collateral_amount: u128,
        collateral_price: u128,
        debt_amount: u128,
        debt_price: u128,
    ) -> u128 {
        let col_value = collateral_value(collateral_amount, collateral_price);
        let debt_value_total = collateral_value(debt_amount, debt_price);

        if col_value >= debt_value_total {
            0
        } else {
            // Bad debt in debt token terms
            let shortfall_value = debt_value_total - col_value;
            mul_div(shortfall_value, PRECISION, debt_price)
        }
    }
}

// ============ Exchange Rate (Deposit Shares) ============
//
// Lenders receive shares (like cTokens/aTokens) representing their pool share.
// Exchange rate grows as interest accrues.

pub mod shares {
    use super::*;

    /// Calculate shares to mint for a deposit
    /// If pool is empty: shares = deposit amount (1:1)
    /// Otherwise: shares = deposit * total_shares / total_underlying
    pub fn deposit_to_shares(
        deposit_amount: u128,
        total_shares: u128,
        total_underlying: u128,
    ) -> Result<u128, LendingError> {
        if deposit_amount == 0 {
            return Ok(0);
        }
        if total_shares == 0 || total_underlying == 0 {
            // First depositor: 1:1 ratio
            return Ok(deposit_amount);
        }
        Ok(mul_div(deposit_amount, total_shares, total_underlying))
    }

    /// Calculate underlying amount for share redemption
    pub fn shares_to_underlying(
        shares_amount: u128,
        total_shares: u128,
        total_underlying: u128,
    ) -> Result<u128, LendingError> {
        if shares_amount == 0 {
            return Ok(0);
        }
        if total_shares == 0 {
            return Err(LendingError::ZeroDeposits);
        }
        Ok(mul_div(shares_amount, total_underlying, total_shares))
    }

    /// Calculate current exchange rate: underlying per share
    pub fn exchange_rate(
        total_shares: u128,
        total_underlying: u128,
    ) -> u128 {
        if total_shares == 0 {
            return PRECISION; // 1:1 default
        }
        mul_div(total_underlying, PRECISION, total_shares)
    }
}

// ============ Pool Accounting ============

pub mod pool {
    use super::*;
    use super::interest::RateModel;

    /// Snapshot of lending pool state (for validation in CKB scripts)
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct PoolState {
        pub total_deposits: u128,
        pub total_borrows: u128,
        pub total_shares: u128,
        pub total_reserves: u128,
        pub last_accrual_block: u64,
        pub borrow_index: u128, // Cumulative interest index (starts at 1e18)
    }

    impl PoolState {
        pub fn new() -> Self {
            Self {
                total_deposits: 0,
                total_borrows: 0,
                total_shares: 0,
                total_reserves: 0,
                last_accrual_block: 0,
                borrow_index: PRECISION,
            }
        }

        /// Calculate total underlying assets (deposits + interest - reserves)
        pub fn total_underlying(&self) -> u128 {
            // Cash (deposits not borrowed) + total borrows (including accrued interest)
            let cash = self.total_deposits.saturating_sub(self.total_borrows);
            cash + self.total_borrows
        }

        /// Available liquidity for new borrows
        pub fn available_liquidity(&self) -> u128 {
            self.total_deposits.saturating_sub(self.total_borrows)
        }
    }

    /// Accrue interest and return updated pool state
    pub fn accrue(
        state: &PoolState,
        current_block: u64,
        model: &RateModel,
    ) -> Result<PoolState, LendingError> {
        if current_block <= state.last_accrual_block {
            return Ok(state.clone());
        }

        let blocks_elapsed = (current_block - state.last_accrual_block) as u128;

        if state.total_borrows == 0 {
            return Ok(PoolState {
                last_accrual_block: current_block,
                ..state.clone()
            });
        }

        let util = interest::utilization_rate(state.total_borrows, state.total_deposits)?;
        let annual_rate = interest::borrow_rate(util, model)?;

        let (new_borrows, interest_accrued, protocol_share) =
            interest::accrue_interest(
                state.total_borrows,
                annual_rate,
                blocks_elapsed,
                model.reserve_factor,
            )?;

        // Update borrow index: index_new = index_old * (1 + interest / borrows)
        let new_index = if state.total_borrows > 0 {
            mul_div(
                state.borrow_index,
                PRECISION + mul_div(interest_accrued, PRECISION, state.total_borrows),
                PRECISION,
            )
        } else {
            state.borrow_index
        };

        Ok(PoolState {
            total_deposits: state.total_deposits + interest_accrued - protocol_share,
            total_borrows: new_borrows,
            total_shares: state.total_shares,
            total_reserves: state.total_reserves + protocol_share,
            last_accrual_block: current_block,
            borrow_index: new_index,
        })
    }

    /// Calculate a borrower's current debt given their principal and index snapshot
    pub fn current_debt(
        principal: u128,
        borrow_index_at_open: u128,
        current_borrow_index: u128,
    ) -> u128 {
        if borrow_index_at_open == 0 {
            return principal;
        }
        mul_div(principal, current_borrow_index, borrow_index_at_open)
    }
}

// ============ Mutualist Liquidation Prevention ============
//
// P-105: Prevention over punishment.
// Traditional liquidation rewards vultures for exploiting distress.
// Mutualist liquidation PREVENTS the distress in the first place.
//
// Graduated de-risking thresholds:
//   HF < 1.5 → Warning (notify user on-chain)
//   HF < 1.3 → Auto-deleverage (convert deposit shares to repay)
//   HF < 1.1 → Soft liquidation (incremental collateral release)
//   HF < 1.0 → Hard liquidation (last resort)

pub mod prevention {
    use super::*;

    /// Health factor thresholds for graduated de-risking
    pub const HF_WARNING: u128 = PRECISION * 150 / 100;      // 1.5
    pub const HF_AUTO_DELEVERAGE: u128 = PRECISION * 130 / 100; // 1.3
    pub const HF_SOFT_LIQUIDATION: u128 = PRECISION * 110 / 100; // 1.1
    pub const HF_HARD_LIQUIDATION: u128 = PRECISION;            // 1.0

    /// Maximum number of soft liquidation steps (prevents infinite loop)
    pub const MAX_SOFT_STEPS: u128 = 20;

    /// Risk tier based on health factor
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum RiskTier {
        /// HF >= 1.5 — Safe
        Safe,
        /// 1.3 <= HF < 1.5 — Warning zone
        Warning,
        /// 1.1 <= HF < 1.3 — Auto-deleverage eligible
        AutoDeleverage,
        /// 1.0 <= HF < 1.1 — Soft liquidation zone
        SoftLiquidation,
        /// HF < 1.0 — Hard liquidation
        HardLiquidation,
    }

    /// Classify a position's risk tier based on health factor
    pub fn classify_risk(health_factor: u128) -> RiskTier {
        if health_factor >= HF_WARNING {
            RiskTier::Safe
        } else if health_factor >= HF_AUTO_DELEVERAGE {
            RiskTier::Warning
        } else if health_factor >= HF_SOFT_LIQUIDATION {
            RiskTier::AutoDeleverage
        } else if health_factor >= HF_HARD_LIQUIDATION {
            RiskTier::SoftLiquidation
        } else {
            RiskTier::HardLiquidation
        }
    }

    /// Calculate auto-deleverage amount: how much debt to repay using deposit shares
    ///
    /// When HF < 1.3, the protocol converts the user's deposit shares to underlying
    /// and uses them to repay debt, bringing HF back above the threshold.
    ///
    /// Returns: (shares_to_redeem, debt_to_repay)
    /// Returns (0, 0) if user has no deposit shares or is already safe
    pub fn auto_deleverage_amount(
        collateral_amount: u128,
        collateral_price: u128,
        debt_amount: u128,
        debt_price: u128,
        liquidation_threshold: u128,
        deposit_shares: u128,
        total_shares: u128,
        total_underlying: u128,
    ) -> (u128, u128) {
        if deposit_shares == 0 || total_shares == 0 || total_underlying == 0 {
            return (0, 0);
        }

        // Current health factor
        let hf = match collateral::health_factor(
            collateral_amount, collateral_price,
            debt_amount, debt_price,
            liquidation_threshold,
        ) {
            Ok(h) => h,
            Err(_) => return (0, 0),
        };

        if hf >= HF_AUTO_DELEVERAGE {
            return (0, 0); // Already safe
        }

        // Target: bring HF to 1.3
        // HF_target = (col_value * LT) / ((debt - repay) * debt_price / PRECISION)
        // Solving for repay:
        // repay = debt - (col_value * LT) / (HF_target * debt_price / PRECISION)
        let col_value = collateral::collateral_value(collateral_amount, collateral_price);
        let adjusted_col = mul_div(col_value, liquidation_threshold, PRECISION);
        let target_debt_value = mul_div(adjusted_col, PRECISION, HF_AUTO_DELEVERAGE);
        let current_debt_value = collateral::collateral_value(debt_amount, debt_price);

        if target_debt_value >= current_debt_value {
            return (0, 0); // No repayment needed
        }

        let repay_value = current_debt_value - target_debt_value;
        let debt_to_repay = mul_div(repay_value, PRECISION, debt_price);

        // Cap by available deposit shares
        let max_underlying = mul_div(deposit_shares, total_underlying, total_shares);
        let actual_repay = debt_to_repay.min(max_underlying);

        // Convert to shares
        let shares_to_redeem = if actual_repay == max_underlying {
            deposit_shares
        } else {
            mul_div(actual_repay, total_shares, total_underlying)
        };

        (shares_to_redeem, actual_repay)
    }

    /// Calculate soft liquidation step: incremental collateral release
    ///
    /// Instead of 50% close factor at once, soft liquidation does 5% per step
    /// over multiple blocks. This spreads selling pressure and prevents cascades.
    ///
    /// Returns: (debt_to_repay, collateral_to_release) for one step
    /// Returns (0, 0) if position doesn't qualify for soft liquidation
    pub fn soft_liquidation_step(
        collateral_amount: u128,
        collateral_price: u128,
        debt_amount: u128,
        debt_price: u128,
        liquidation_threshold: u128,
        liquidation_incentive: u128,
        step_factor: u128, // e.g., 5% = 0.05e18
    ) -> (u128, u128) {
        // Check health factor is in soft liquidation range
        let hf = match collateral::health_factor(
            collateral_amount, collateral_price,
            debt_amount, debt_price,
            liquidation_threshold,
        ) {
            Ok(h) => h,
            Err(_) => return (0, 0),
        };

        if hf >= HF_SOFT_LIQUIDATION || hf < HF_HARD_LIQUIDATION {
            return (0, 0); // Not in soft liquidation range
        }

        // Step size: step_factor of total debt
        let step_repay = mul_div(debt_amount, step_factor, PRECISION);
        if step_repay == 0 {
            return (0, 0);
        }

        // Collateral released = repay_value * (1 + reduced_incentive) / col_price
        // Soft liquidation uses half the normal incentive (less predatory)
        let reduced_incentive = liquidation_incentive / 2;
        let repay_value = collateral::collateral_value(step_repay, debt_price);
        let release_value = mul_div(
            repay_value,
            PRECISION + reduced_incentive,
            PRECISION,
        );
        let collateral_release = mul_div(release_value, PRECISION, collateral_price);

        // Cap at available collateral
        let actual_release = collateral_release.min(collateral_amount);

        (step_repay, actual_release)
    }

    /// Calculate insurance pool contribution needed to prevent liquidation
    ///
    /// The insurance pool absorbs the first loss, topping up collateral value
    /// before any liquidation occurs. This is mutualized — all users contribute
    /// a fraction of the reserve factor to the pool.
    ///
    /// Returns: amount of insurance tokens needed to bring HF above threshold
    /// Returns 0 if position is already safe or insurance can't help
    pub fn insurance_needed(
        collateral_amount: u128,
        collateral_price: u128,
        debt_amount: u128,
        debt_price: u128,
        liquidation_threshold: u128,
        target_hf: u128, // Where to bring HF to (e.g., 1.1)
    ) -> u128 {
        let hf = match collateral::health_factor(
            collateral_amount, collateral_price,
            debt_amount, debt_price,
            liquidation_threshold,
        ) {
            Ok(h) => h,
            Err(_) => return 0,
        };

        if hf >= target_hf {
            return 0; // Already safe
        }

        // Need to reduce debt_value to bring HF to target
        // target_hf = adjusted_col / new_debt_value
        // new_debt_value = adjusted_col / target_hf
        // insurance_amount = (current_debt_value - new_debt_value) / debt_price
        let col_value = collateral::collateral_value(collateral_amount, collateral_price);
        let adjusted_col = mul_div(col_value, liquidation_threshold, PRECISION);
        let target_debt_value = mul_div(adjusted_col, PRECISION, target_hf);
        let current_debt_value = collateral::collateral_value(debt_amount, debt_price);

        if target_debt_value >= current_debt_value {
            return 0;
        }

        let shortfall_value = current_debt_value - target_debt_value;
        mul_div(shortfall_value, PRECISION, debt_price)
    }

    /// Check if a position would survive a price drop of given percentage
    ///
    /// Used for stress testing: "if ETH drops 20%, does this vault survive?"
    /// Returns health factor at the stressed price
    pub fn stress_test(
        collateral_amount: u128,
        collateral_price: u128,
        debt_amount: u128,
        debt_price: u128,
        liquidation_threshold: u128,
        price_drop_bps: u128, // basis points (e.g., 2000 = 20% drop)
    ) -> u128 {
        let stressed_price = mul_div(
            collateral_price,
            BPS_DENOMINATOR - price_drop_bps,
            BPS_DENOMINATOR,
        );

        match collateral::health_factor(
            collateral_amount, stressed_price,
            debt_amount, debt_price,
            liquidation_threshold,
        ) {
            Ok(hf) => hf,
            Err(_) => 0,
        }
    }
}

// ============ Insurance Pool Math (P-105 Implementation) ============
//
// The insurance pool is the mechanism that makes mutualist liquidation prevention
// economically viable. Instead of relying on liquidators (who profit from others'
// distress), the pool aggregates premiums from normal lending operations and uses
// them to de-risk positions before liquidation becomes necessary.
//
// Key operations:
//   - Premium accrual: lending pools pay a fraction of interest to insurance
//   - Share accounting: depositors earn premiums proportional to their share
//   - Coverage calculation: how much can be claimed for a distressed vault
//   - Claim execution: actually paying out to prevent liquidation

pub mod insurance {
    use super::*;

    /// Calculate premium owed by a lending pool to insurance for a period.
    ///
    /// Premium = total_borrows * premium_rate_bps / BPS_DENOMINATOR / BLOCKS_PER_YEAR * blocks
    /// This is a linear approximation — fine for short periods between accruals.
    ///
    /// Returns: premium amount in underlying token units
    pub fn calculate_premium(
        total_borrows: u128,
        premium_rate_bps: u64,
        blocks_elapsed: u64,
    ) -> u128 {
        if total_borrows == 0 || premium_rate_bps == 0 || blocks_elapsed == 0 {
            return 0;
        }
        // annual_premium = borrows * rate / 10000
        // per_block = annual / BLOCKS_PER_YEAR
        // total = per_block * blocks
        let annual_premium = mul_div(
            total_borrows,
            premium_rate_bps as u128,
            BPS_DENOMINATOR,
        );
        mul_div(annual_premium, blocks_elapsed as u128, BLOCKS_PER_YEAR)
    }

    /// Calculate insurance shares for a new deposit.
    ///
    /// First deposit: 1:1 shares. Subsequent: proportional to existing pool.
    /// Same mechanics as cToken/aToken deposit shares.
    pub fn deposit_to_shares(
        deposit_amount: u128,
        total_shares: u128,
        total_deposits: u128,
    ) -> Result<u128, LendingError> {
        if deposit_amount == 0 {
            return Ok(0);
        }
        if total_shares == 0 || total_deposits == 0 {
            return Ok(deposit_amount); // First depositor gets 1:1
        }
        Ok(mul_div(deposit_amount, total_shares, total_deposits))
    }

    /// Calculate underlying tokens for a share redemption.
    pub fn shares_to_underlying(
        shares_amount: u128,
        total_shares: u128,
        total_deposits: u128,
    ) -> Result<u128, LendingError> {
        if shares_amount == 0 {
            return Ok(0);
        }
        if total_shares == 0 {
            return Err(LendingError::ZeroDeposits);
        }
        Ok(mul_div(shares_amount, total_deposits, total_shares))
    }

    /// Calculate available coverage for a single claim.
    ///
    /// Coverage is capped at max_coverage_bps of total_deposits.
    /// This prevents a single large claim from draining the entire pool.
    pub fn available_coverage(
        total_deposits: u128,
        max_coverage_bps: u64,
    ) -> u128 {
        mul_div(total_deposits, max_coverage_bps as u128, BPS_DENOMINATOR)
    }

    /// Calculate the actual claim amount for a distressed vault.
    ///
    /// The claim covers the shortfall needed to bring HF above the target threshold.
    /// Capped by: (1) available coverage, (2) actual shortfall needed.
    ///
    /// Returns: (claim_amount, new_hf_estimate)
    /// claim_amount = 0 if vault doesn't need insurance or pool can't help
    pub fn calculate_claim(
        collateral_amount: u128,
        collateral_price: u128,
        debt_amount: u128,
        debt_price: u128,
        liquidation_threshold: u128,
        target_hf: u128,
        pool_total_deposits: u128,
        max_coverage_bps: u64,
    ) -> (u128, u128) {
        // How much insurance is needed?
        let needed = prevention::insurance_needed(
            collateral_amount,
            collateral_price,
            debt_amount,
            debt_price,
            liquidation_threshold,
            target_hf,
        );

        if needed == 0 {
            // Already safe or no debt
            let hf = match collateral::health_factor(
                collateral_amount, collateral_price,
                debt_amount, debt_price,
                liquidation_threshold,
            ) {
                Ok(h) => h,
                Err(_) => u128::MAX,
            };
            return (0, hf);
        }

        // Cap by pool capacity
        let max_claim = available_coverage(pool_total_deposits, max_coverage_bps);
        let actual_claim = needed.min(max_claim);

        // Estimate new HF after claim (claim repays debt)
        let new_debt = if actual_claim >= debt_amount {
            0
        } else {
            debt_amount - actual_claim
        };

        let new_hf = if new_debt == 0 {
            u128::MAX
        } else {
            match collateral::health_factor(
                collateral_amount, collateral_price,
                new_debt, debt_price,
                liquidation_threshold,
            ) {
                Ok(h) => h,
                Err(_) => u128::MAX,
            }
        };

        (actual_claim, new_hf)
    }

    /// Calculate the exchange rate for insurance pool shares.
    ///
    /// After premiums accrue, each share is worth more underlying.
    /// rate = (total_deposits + pending_premiums) / total_shares
    pub fn exchange_rate(
        total_shares: u128,
        total_deposits: u128,
    ) -> u128 {
        if total_shares == 0 {
            return PRECISION; // Initial 1:1
        }
        mul_div(total_deposits, PRECISION, total_shares)
    }

    /// Check if a withdrawal respects the cooldown period.
    ///
    /// Returns true if withdrawal is allowed (enough blocks have passed).
    pub fn cooldown_satisfied(
        deposit_block: u64,
        current_block: u64,
        cooldown_blocks: u64,
    ) -> bool {
        if cooldown_blocks == 0 {
            return true;
        }
        current_block >= deposit_block + cooldown_blocks
    }

    /// Calculate the insurance pool's "coverage ratio" — how much of the
    /// linked lending pool's total borrows are covered by insurance.
    ///
    /// A higher ratio means better protection for borrowers.
    /// Returns: ratio scaled by PRECISION (e.g., 0.2e18 = 20% coverage)
    pub fn coverage_ratio(
        insurance_deposits: u128,
        lending_total_borrows: u128,
    ) -> u128 {
        if lending_total_borrows == 0 {
            return PRECISION; // Fully covered if nothing to cover
        }
        if insurance_deposits == 0 {
            return 0;
        }
        mul_div(insurance_deposits, PRECISION, lending_total_borrows).min(PRECISION)
    }

    /// Calculate the insurance pool's yield (APY for depositors).
    ///
    /// yield = total_premiums_earned_per_year / total_deposits
    /// This is the incentive for people to deposit into insurance.
    pub fn insurance_apy(
        annual_premiums: u128,
        total_deposits: u128,
    ) -> u128 {
        if total_deposits == 0 {
            return 0;
        }
        mul_div(annual_premiums, PRECISION, total_deposits)
    }
}

// ============ Integer Math Helpers ============

/// Compute (a * b) / c using 256-bit intermediate to avoid overflow.
pub fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    assert!(c > 0, "mul_div: division by zero");
    match a.checked_mul(b) {
        Some(product) => product / c,
        None => {
            let (hi, lo) = wide_mul(a, b);
            wide_div(hi, lo, c)
        }
    }
}

/// Multiply two u128 values, returning (hi, lo) as a 256-bit result.
pub fn wide_mul(a: u128, b: u128) -> (u128, u128) {
    let mask: u128 = u64::MAX as u128;
    let a_lo = a & mask;
    let a_hi = a >> 64;
    let b_lo = b & mask;
    let b_hi = b >> 64;

    let p0 = a_lo * b_lo;
    let p1 = a_lo * b_hi;
    let p2 = a_hi * b_lo;
    let p3 = a_hi * b_hi;

    let mid = (p0 >> 64) + (p1 & mask) + (p2 & mask);
    let lo = (p0 & mask) | ((mid & mask) << 64);
    let hi = p3 + (p1 >> 64) + (p2 >> 64) + (mid >> 64);

    (hi, lo)
}

/// Divide a 256-bit number (hi, lo) by a u128 divisor.
fn wide_div(hi: u128, lo: u128, d: u128) -> u128 {
    if hi == 0 {
        return lo / d;
    }

    let mut low: u128 = 0;
    let mut high: u128 = u128::MAX;

    while low < high {
        let diff = high - low;
        let mid = low + diff / 2 + diff % 2;
        let (mh, ml) = wide_mul(mid, d);
        if mh > hi || (mh == hi && ml > lo) {
            high = mid - 1;
        } else {
            low = mid;
        }
    }
    low
}

/// Fixed-point exponentiation by squaring: base^exp in PRECISION scale.
/// base is in PRECISION scale (e.g., 1.0001e18 for 0.01% rate).
pub fn exp_by_squaring(base: u128, exp: u128) -> u128 {
    if exp == 0 {
        return PRECISION;
    }

    let mut result = PRECISION;
    let mut b = base;
    let mut e = exp;

    while e > 0 {
        if e & 1 == 1 {
            result = mul_div(result, b, PRECISION);
        }
        b = mul_div(b, b, PRECISION);
        e >>= 1;
    }

    result
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;
    use super::interest::*;
    use super::collateral::*;
    use super::shares::*;
    use super::pool::*;

    // ============ Interest Rate Tests ============

    #[test]
    fn test_utilization_zero_deposits_zero_borrows() {
        let u = utilization_rate(0, 0).unwrap();
        assert_eq!(u, 0);
    }

    #[test]
    fn test_utilization_zero_deposits_nonzero_borrows() {
        let result = utilization_rate(100, 0);
        assert_eq!(result, Err(LendingError::ZeroDeposits));
    }

    #[test]
    fn test_utilization_50_percent() {
        // 500 borrowed out of 1000 deposited = 50%
        let u = utilization_rate(500 * PRECISION, 1000 * PRECISION).unwrap();
        assert_eq!(u, 500_000_000_000_000_000); // 0.5e18
    }

    #[test]
    fn test_utilization_100_percent() {
        let u = utilization_rate(1000 * PRECISION, 1000 * PRECISION).unwrap();
        assert_eq!(u, PRECISION);
    }

    #[test]
    fn test_borrow_rate_zero_utilization() {
        let model = RateModel::default_stable();
        let rate = borrow_rate(0, &model).unwrap();
        assert_eq!(rate, model.base_rate); // Just base rate
    }

    #[test]
    fn test_borrow_rate_at_kink() {
        let model = RateModel::default_stable();
        let rate = borrow_rate(model.optimal_utilization, &model).unwrap();
        // At kink: base + slope1
        assert_eq!(rate, model.base_rate + model.slope1);
    }

    #[test]
    fn test_borrow_rate_below_kink() {
        let model = RateModel::default_stable();
        // 40% utilization (half of 80% kink)
        let util = 400_000_000_000_000_000; // 0.4e18
        let rate = borrow_rate(util, &model).unwrap();
        // base + 0.5 * slope1
        let expected = model.base_rate + model.slope1 / 2;
        assert_eq!(rate, expected);
    }

    #[test]
    fn test_borrow_rate_above_kink() {
        let model = RateModel::default_stable();
        // 90% utilization (above 80% kink)
        let util = 900_000_000_000_000_000; // 0.9e18
        let rate = borrow_rate(util, &model).unwrap();
        // base + slope1 + (0.1/0.2) * slope2 = base + slope1 + 0.5 * slope2
        let expected = model.base_rate + model.slope1
            + mul_div(
                util - model.optimal_utilization,
                model.slope2,
                PRECISION - model.optimal_utilization,
            );
        assert_eq!(rate, expected);
        // Rate should be significantly higher than at kink
        let kink_rate = borrow_rate(model.optimal_utilization, &model).unwrap();
        assert!(rate > kink_rate * 10); // Steep slope kicks in hard
    }

    #[test]
    fn test_borrow_rate_100_percent() {
        let model = RateModel::default_stable();
        let rate = borrow_rate(PRECISION, &model).unwrap();
        // base + slope1 + slope2 = 2% + 4% + 300% = 306%
        assert_eq!(rate, model.base_rate + model.slope1 + model.slope2);
    }

    #[test]
    fn test_supply_rate() {
        let model = RateModel::default_stable();
        let util = 800_000_000_000_000_000; // 80%
        let br = borrow_rate(util, &model).unwrap();
        let sr = supply_rate(br, util, model.reserve_factor).unwrap();

        // Supply rate should be less than borrow rate (utilization < 100% and reserve factor)
        assert!(sr < br);
        // Supply = borrow * util * (1 - rf) = borrow * 0.8 * 0.9
        let expected = mul_div(
            mul_div(br, util, PRECISION),
            PRECISION - model.reserve_factor,
            PRECISION,
        );
        assert_eq!(sr, expected);
    }

    #[test]
    fn test_per_block_rate() {
        let annual = 60_000_000_000_000_000; // 6% annual
        let block = per_block_rate(annual);
        // ~22.8 per block (very small, linear approx is fine)
        assert!(block > 0);
        assert!(block < annual);
        // Reconstruct: block * BLOCKS_PER_YEAR should be close to annual
        assert!(block * BLOCKS_PER_YEAR <= annual);
    }

    #[test]
    fn test_accrue_interest_zero_blocks() {
        let (new_borrows, interest, protocol) =
            accrue_interest(1000 * PRECISION, 60_000_000_000_000_000, 0, PRECISION / 10).unwrap();
        assert_eq!(new_borrows, 1000 * PRECISION);
        assert_eq!(interest, 0);
        assert_eq!(protocol, 0);
    }

    #[test]
    fn test_accrue_interest_one_year() {
        let borrows = 1_000_000 * PRECISION; // 1M tokens
        let annual_rate = 60_000_000_000_000_000; // 6%
        let reserve_factor = 100_000_000_000_000_000; // 10%

        let (new_borrows, interest, protocol) =
            accrue_interest(borrows, annual_rate, BLOCKS_PER_YEAR, reserve_factor).unwrap();

        // Interest should be ~6% of 1M = ~60K
        let expected_interest = borrows * 6 / 100;
        assert!(interest > expected_interest - PRECISION); // Within 1 token
        assert!(interest < expected_interest + PRECISION);

        // Protocol gets 10% of interest
        let expected_protocol = interest / 10;
        assert_eq!(protocol, expected_protocol);

        assert_eq!(new_borrows, borrows + interest);
    }

    #[test]
    fn test_compound_interest_small_gap() {
        let principal = 1_000_000 * PRECISION;
        let annual_rate = 60_000_000_000_000_000; // 6%

        // 100 blocks (~20 minutes) — linear and compound should be nearly identical
        let compound = compound_interest(principal, annual_rate, 100).unwrap();
        let (linear, _, _) = accrue_interest(
            principal,
            annual_rate,
            100,
            0,
        ).unwrap();

        // Difference should be negligible
        let diff = if compound > linear {
            compound - linear
        } else {
            linear - compound
        };
        assert!(diff < PRECISION); // Less than 1 token difference
    }

    // ============ Collateral & Health Factor Tests ============

    #[test]
    fn test_collateral_value() {
        // 10 ETH at $2000 = $20,000
        let value = collateral_value(10 * PRECISION, 2000 * PRECISION);
        assert_eq!(value, 20_000 * PRECISION);
    }

    #[test]
    fn test_max_borrow() {
        // 10 ETH at $2000, 75% collateral factor = can borrow up to $15,000
        let max = max_borrow(
            10 * PRECISION,
            2000 * PRECISION,
            750_000_000_000_000_000,
        ).unwrap();
        assert_eq!(max, 15_000 * PRECISION);
    }

    #[test]
    fn test_health_factor_safe() {
        // 10 ETH at $2000, 5000 USDC debt at $1, 80% LT
        // HF = (10 * 2000 * 0.8) / (5000 * 1) = 16000/5000 = 3.2
        let hf = health_factor(
            10 * PRECISION,
            2000 * PRECISION,
            5000 * PRECISION,
            PRECISION,
            800_000_000_000_000_000,
        ).unwrap();
        assert_eq!(hf, 3_200_000_000_000_000_000); // 3.2e18
    }

    #[test]
    fn test_health_factor_at_threshold() {
        // Exactly at liquidation: HF = 1.0
        // Need: col_value * LT = debt_value
        // 10 ETH at $1000, LT=80% -> adjusted = 8000
        // debt = 8000 USDC at $1
        let hf = health_factor(
            10 * PRECISION,
            1000 * PRECISION,
            8000 * PRECISION,
            PRECISION,
            800_000_000_000_000_000,
        ).unwrap();
        assert_eq!(hf, PRECISION); // Exactly 1.0
    }

    #[test]
    fn test_health_factor_liquidatable() {
        // 10 ETH at $500, 8000 USDC debt at $1, 80% LT
        // HF = (10 * 500 * 0.8) / 8000 = 4000/8000 = 0.5
        let hf = health_factor(
            10 * PRECISION,
            500 * PRECISION,
            8000 * PRECISION,
            PRECISION,
            800_000_000_000_000_000,
        ).unwrap();
        assert_eq!(hf, 500_000_000_000_000_000); // 0.5e18
    }

    #[test]
    fn test_health_factor_no_debt() {
        let hf = health_factor(
            10 * PRECISION,
            2000 * PRECISION,
            0,
            PRECISION,
            800_000_000_000_000_000,
        ).unwrap();
        assert_eq!(hf, u128::MAX);
    }

    #[test]
    fn test_is_liquidatable() {
        // Safe position
        assert!(!is_liquidatable(
            10 * PRECISION, 2000 * PRECISION,
            5000 * PRECISION, PRECISION,
            800_000_000_000_000_000,
        ).unwrap());

        // Underwater position
        assert!(is_liquidatable(
            10 * PRECISION, 500 * PRECISION,
            8000 * PRECISION, PRECISION,
            800_000_000_000_000_000,
        ).unwrap());
    }

    #[test]
    fn test_liquidation_amounts() {
        let params = CollateralParams::default_stable();

        // 10 ETH at $500, 8000 USDC debt — underwater
        let (repay, seized) = liquidation_amounts(
            10 * PRECISION,      // 10 ETH collateral
            500 * PRECISION,     // $500/ETH
            8000 * PRECISION,    // 8000 USDC debt
            PRECISION,           // $1/USDC
            &params,
        ).unwrap();

        // Max repay = 8000 * 50% close factor = 4000 USDC
        assert_eq!(repay, 4000 * PRECISION);

        // Seized = 4000 * 1.05 / 500 = 8.4 ETH
        let expected_seized = mul_div(
            mul_div(4000 * PRECISION, PRECISION + params.liquidation_incentive, PRECISION),
            PRECISION,
            500 * PRECISION,
        );
        assert_eq!(seized, expected_seized);
    }

    #[test]
    fn test_liquidation_overcollateralized_fails() {
        let params = CollateralParams::default_stable();
        let result = liquidation_amounts(
            10 * PRECISION, 2000 * PRECISION,
            5000 * PRECISION, PRECISION,
            &params,
        );
        assert_eq!(result, Err(LendingError::OverCollateralized));
    }

    #[test]
    fn test_bad_debt_none() {
        // Collateral > debt
        let bd = bad_debt(
            10 * PRECISION, 2000 * PRECISION,
            5000 * PRECISION, PRECISION,
        );
        assert_eq!(bd, 0);
    }

    #[test]
    fn test_bad_debt_exists() {
        // 1 ETH at $100, 500 USDC debt — shortfall = $400
        let bd = bad_debt(
            1 * PRECISION, 100 * PRECISION,
            500 * PRECISION, PRECISION,
        );
        assert_eq!(bd, 400 * PRECISION);
    }

    // ============ Share/Exchange Rate Tests ============

    #[test]
    fn test_first_deposit_1_to_1() {
        let shares = deposit_to_shares(1000 * PRECISION, 0, 0).unwrap();
        assert_eq!(shares, 1000 * PRECISION);
    }

    #[test]
    fn test_deposit_shares_proportional() {
        // Pool has 1000 shares, 1100 underlying (interest accrued)
        // Deposit 100 underlying -> 100 * 1000 / 1100 ≈ 90.9 shares
        let shares = deposit_to_shares(
            100 * PRECISION,
            1000 * PRECISION,
            1100 * PRECISION,
        ).unwrap();
        let expected = mul_div(100 * PRECISION, 1000 * PRECISION, 1100 * PRECISION);
        assert_eq!(shares, expected);
    }

    #[test]
    fn test_redeem_shares() {
        // 90.9 shares, pool has 1000 shares for 1100 underlying
        let shares_amount = mul_div(100 * PRECISION, 1000 * PRECISION, 1100 * PRECISION);
        let underlying = shares_to_underlying(
            shares_amount,
            1000 * PRECISION,
            1100 * PRECISION,
        ).unwrap();
        // Should get back ~100 tokens (minus rounding)
        assert!(underlying >= 99 * PRECISION);
        assert!(underlying <= 100 * PRECISION);
    }

    #[test]
    fn test_exchange_rate_initial() {
        assert_eq!(exchange_rate(0, 0), PRECISION); // 1:1
    }

    #[test]
    fn test_exchange_rate_after_interest() {
        // 1000 shares, 1100 underlying -> rate = 1.1
        let rate = exchange_rate(1000 * PRECISION, 1100 * PRECISION);
        assert_eq!(rate, 1_100_000_000_000_000_000); // 1.1e18
    }

    // ============ Pool Accounting Tests ============

    #[test]
    fn test_pool_new() {
        let state = PoolState::new();
        assert_eq!(state.total_deposits, 0);
        assert_eq!(state.borrow_index, PRECISION);
    }

    #[test]
    fn test_pool_accrue_no_borrows() {
        let state = PoolState {
            total_deposits: 1000 * PRECISION,
            total_borrows: 0,
            total_shares: 1000 * PRECISION,
            total_reserves: 0,
            last_accrual_block: 100,
            borrow_index: PRECISION,
        };

        let model = RateModel::default_stable();
        let new_state = accrue(&state, 200, &model).unwrap();

        // No borrows = no interest
        assert_eq!(new_state.total_borrows, 0);
        assert_eq!(new_state.total_reserves, 0);
        assert_eq!(new_state.last_accrual_block, 200);
    }

    #[test]
    fn test_pool_accrue_with_borrows() {
        let state = PoolState {
            total_deposits: 1000 * PRECISION,
            total_borrows: 800 * PRECISION, // 80% utilization (at kink)
            total_shares: 1000 * PRECISION,
            total_reserves: 0,
            last_accrual_block: 0,
            borrow_index: PRECISION,
        };

        let model = RateModel::default_stable();
        let new_state = accrue(&state, BLOCKS_PER_YEAR as u64, &model).unwrap();

        // Borrows should increase by ~6% (base 2% + slope1 4% at 80% util)
        assert!(new_state.total_borrows > 800 * PRECISION);
        let interest = new_state.total_borrows - 800 * PRECISION;
        let expected = 800 * PRECISION * 6 / 100; // ~48 tokens
        assert!(interest > expected - 2 * PRECISION); // Within 2 tokens
        assert!(interest < expected + 2 * PRECISION);

        // Reserves should be 10% of interest
        assert!(new_state.total_reserves > 0);

        // Borrow index should increase
        assert!(new_state.borrow_index > PRECISION);
    }

    #[test]
    fn test_current_debt_no_accrual() {
        let debt = current_debt(100 * PRECISION, PRECISION, PRECISION);
        assert_eq!(debt, 100 * PRECISION);
    }

    #[test]
    fn test_current_debt_with_accrual() {
        // Index went from 1.0 to 1.1 (10% interest)
        let debt = current_debt(
            100 * PRECISION,
            PRECISION,
            1_100_000_000_000_000_000,
        );
        assert_eq!(debt, 110 * PRECISION);
    }

    #[test]
    fn test_available_liquidity() {
        let state = PoolState {
            total_deposits: 1000 * PRECISION,
            total_borrows: 600 * PRECISION,
            total_shares: 1000 * PRECISION,
            total_reserves: 0,
            last_accrual_block: 0,
            borrow_index: PRECISION,
        };
        assert_eq!(state.available_liquidity(), 400 * PRECISION);
    }

    // ============ Math Helper Tests ============

    #[test]
    fn test_exp_by_squaring_zero() {
        assert_eq!(exp_by_squaring(PRECISION + 1000, 0), PRECISION);
    }

    #[test]
    fn test_exp_by_squaring_one() {
        let base = PRECISION + 1000; // 1.000000000000001
        assert_eq!(exp_by_squaring(base, 1), base);
    }

    #[test]
    fn test_exp_by_squaring_large() {
        // (1.0001)^10000 ≈ e^1 ≈ 2.718...
        let base = PRECISION + PRECISION / 10000; // 1.0001
        let result = exp_by_squaring(base, 10000);
        // Should be approximately e ≈ 2.718e18
        assert!(result > 2_710_000_000_000_000_000);
        assert!(result < 2_730_000_000_000_000_000);
    }

    // ============ Prevention (P-105) Tests ============

    #[test]
    fn test_risk_tier_safe() {
        use super::prevention::*;
        assert_eq!(classify_risk(2 * PRECISION), RiskTier::Safe);
        assert_eq!(classify_risk(HF_WARNING), RiskTier::Safe);
    }

    #[test]
    fn test_risk_tier_warning() {
        use super::prevention::*;
        assert_eq!(classify_risk(HF_WARNING - 1), RiskTier::Warning);
        assert_eq!(classify_risk(HF_AUTO_DELEVERAGE), RiskTier::Warning);
    }

    #[test]
    fn test_risk_tier_auto_deleverage() {
        use super::prevention::*;
        assert_eq!(classify_risk(HF_AUTO_DELEVERAGE - 1), RiskTier::AutoDeleverage);
        assert_eq!(classify_risk(HF_SOFT_LIQUIDATION), RiskTier::AutoDeleverage);
    }

    #[test]
    fn test_risk_tier_soft_liquidation() {
        use super::prevention::*;
        assert_eq!(classify_risk(HF_SOFT_LIQUIDATION - 1), RiskTier::SoftLiquidation);
        assert_eq!(classify_risk(PRECISION), RiskTier::SoftLiquidation);
    }

    #[test]
    fn test_risk_tier_hard_liquidation() {
        use super::prevention::*;
        assert_eq!(classify_risk(PRECISION - 1), RiskTier::HardLiquidation);
        assert_eq!(classify_risk(0), RiskTier::HardLiquidation);
    }

    #[test]
    fn test_auto_deleverage_safe_position() {
        use super::prevention::*;
        // HF = 3.2 — safe, no deleverage needed
        let (shares, repay) = auto_deleverage_amount(
            10 * PRECISION, 2000 * PRECISION,
            5000 * PRECISION, PRECISION,
            800_000_000_000_000_000, // 80% LT
            1000 * PRECISION, // deposit shares
            10000 * PRECISION,
            11000 * PRECISION,
        );
        assert_eq!(shares, 0);
        assert_eq!(repay, 0);
    }

    #[test]
    fn test_auto_deleverage_underwater() {
        use super::prevention::*;
        // 10 ETH at $1300, 8000 USDC debt, 80% LT
        // HF = (10 * 1300 * 0.8) / 8000 = 10400/8000 = 1.3 — right at threshold
        // Drop to $1200: HF = (10 * 1200 * 0.8) / 8000 = 9600/8000 = 1.2 — needs deleverage
        let (shares, repay) = auto_deleverage_amount(
            10 * PRECISION, 1200 * PRECISION,
            8000 * PRECISION, PRECISION,
            800_000_000_000_000_000,
            5000 * PRECISION, // has deposit shares
            100000 * PRECISION,
            110000 * PRECISION,
        );
        assert!(repay > 0, "Should recommend repayment");
        assert!(shares > 0, "Should redeem shares");
        assert!(repay < 8000 * PRECISION, "Should not repay all debt");
    }

    #[test]
    fn test_auto_deleverage_no_deposit_shares() {
        use super::prevention::*;
        let (shares, repay) = auto_deleverage_amount(
            10 * PRECISION, 1200 * PRECISION,
            8000 * PRECISION, PRECISION,
            800_000_000_000_000_000,
            0, // no deposit shares
            100000 * PRECISION,
            110000 * PRECISION,
        );
        assert_eq!(shares, 0);
        assert_eq!(repay, 0);
    }

    #[test]
    fn test_soft_liquidation_step_in_range() {
        use super::prevention::*;
        // HF between 1.0 and 1.1 — soft liquidation range
        // 10 ETH at $1050, 8000 USDC debt, 80% LT
        // HF = (10 * 1050 * 0.8) / 8000 = 8400/8000 = 1.05
        let (repay, release) = soft_liquidation_step(
            10 * PRECISION, 1050 * PRECISION,
            8000 * PRECISION, PRECISION,
            800_000_000_000_000_000,
            50_000_000_000_000_000,  // 5% incentive
            50_000_000_000_000_000,  // 5% step factor
        );
        assert!(repay > 0, "Should repay some debt");
        assert!(release > 0, "Should release some collateral");
        // Step should be 5% of 8000 = 400
        assert_eq!(repay, 400 * PRECISION);
        // Release should be about 400 * 1.025 / 1050
        assert!(release > 0);
        assert!(release < PRECISION); // Less than 1 ETH
    }

    #[test]
    fn test_soft_liquidation_not_in_range() {
        use super::prevention::*;
        // HF = 1.2 — in auto-deleverage range, NOT soft liquidation
        let (repay, release) = soft_liquidation_step(
            10 * PRECISION, 1200 * PRECISION,
            8000 * PRECISION, PRECISION,
            800_000_000_000_000_000,
            50_000_000_000_000_000,
            50_000_000_000_000_000,
        );
        assert_eq!(repay, 0);
        assert_eq!(release, 0);
    }

    #[test]
    fn test_insurance_needed_safe() {
        use super::prevention::*;
        let needed = insurance_needed(
            10 * PRECISION, 2000 * PRECISION,
            5000 * PRECISION, PRECISION,
            800_000_000_000_000_000,
            HF_SOFT_LIQUIDATION,
        );
        assert_eq!(needed, 0); // Already safe
    }

    #[test]
    fn test_insurance_needed_distressed() {
        use super::prevention::*;
        // 10 ETH at $1000, 8000 USDC debt, 80% LT
        // HF = (10*1000*0.8)/8000 = 1.0 — at threshold
        // Need insurance to bring HF to 1.1
        let needed = insurance_needed(
            10 * PRECISION, 1000 * PRECISION,
            8000 * PRECISION, PRECISION,
            800_000_000_000_000_000,
            HF_SOFT_LIQUIDATION, // target 1.1
        );
        assert!(needed > 0, "Should need insurance");
        // After insurance repays `needed` debt, HF should be ~1.1
        let new_debt = 8000 * PRECISION - needed;
        let new_hf = collateral::health_factor(
            10 * PRECISION, 1000 * PRECISION,
            new_debt, PRECISION,
            800_000_000_000_000_000,
        ).unwrap();
        // Should be approximately at target (within rounding)
        assert!(new_hf >= HF_SOFT_LIQUIDATION - PRECISION / 100);
    }

    #[test]
    fn test_stress_test_survives() {
        use super::prevention::*;
        // 10 ETH at $2000, 5000 USDC, 80% LT
        // 20% drop: price = $1600
        // HF = (10*1600*0.8)/5000 = 12800/5000 = 2.56
        let hf = stress_test(
            10 * PRECISION, 2000 * PRECISION,
            5000 * PRECISION, PRECISION,
            800_000_000_000_000_000,
            2000, // 20% drop
        );
        assert!(hf > PRECISION, "Should survive 20% drop");
    }

    #[test]
    fn test_stress_test_fails() {
        use super::prevention::*;
        // 10 ETH at $1000, 8000 USDC, 80% LT
        // 30% drop: price = $700
        // HF = (10*700*0.8)/8000 = 5600/8000 = 0.7
        let hf = stress_test(
            10 * PRECISION, 1000 * PRECISION,
            8000 * PRECISION, PRECISION,
            800_000_000_000_000_000,
            3000, // 30% drop
        );
        assert!(hf < PRECISION, "Should fail 30% drop");
    }

    #[test]
    fn test_mul_div_basic() {
        assert_eq!(mul_div(100, 200, 50), 400);
        assert_eq!(mul_div(PRECISION, PRECISION, PRECISION), PRECISION);
    }

    #[test]
    fn test_mul_div_overflow() {
        // Large values that overflow u128 in intermediate
        let a = 1_000_000 * PRECISION;
        let b = 2_000_000 * PRECISION;
        let result = mul_div(a, b, PRECISION);
        assert_eq!(result, 2_000_000_000_000 * PRECISION);
    }

    // ============ Integration Tests ============

    #[test]
    fn test_full_lending_lifecycle() {
        let model = RateModel::default_stable();

        // 1. Alice deposits 1000 USDC
        let mut state = PoolState::new();
        state.total_deposits = 1000 * PRECISION;
        let alice_shares = deposit_to_shares(
            1000 * PRECISION,
            state.total_shares,
            state.total_underlying(),
        ).unwrap();
        state.total_shares = alice_shares;

        // 2. Bob borrows 800 USDC (80% utilization)
        state.total_borrows = 800 * PRECISION;
        let bob_principal = 800 * PRECISION;
        let bob_index = state.borrow_index;

        // 3. Time passes — 1 year
        let accrued = accrue(&state, BLOCKS_PER_YEAR as u64, &model).unwrap();

        // 4. Bob's debt increased
        let bob_debt = current_debt(bob_principal, bob_index, accrued.borrow_index);
        assert!(bob_debt > bob_principal);

        // 5. Alice's shares are worth more
        let alice_underlying = shares_to_underlying(
            alice_shares,
            accrued.total_shares,
            accrued.total_underlying(),
        ).unwrap();
        assert!(alice_underlying > 1000 * PRECISION); // Earned interest

        // 6. Protocol earned reserves
        assert!(accrued.total_reserves > 0);
    }

    #[test]
    fn test_liquidation_lifecycle() {
        let params = CollateralParams::default_stable();

        // Bob deposits 10 ETH at $2000, borrows 12000 USDC
        let collateral = 10 * PRECISION;
        let debt = 12_000 * PRECISION;

        // Price crashes to $1000 — HF = (10 * 1000 * 0.8) / 12000 = 0.667
        let hf = health_factor(
            collateral, 1000 * PRECISION,
            debt, PRECISION,
            params.liquidation_threshold,
        ).unwrap();
        assert!(hf < PRECISION); // Liquidatable

        // Charlie liquidates
        let (repay, seized) = liquidation_amounts(
            collateral, 1000 * PRECISION,
            debt, PRECISION,
            &params,
        ).unwrap();

        // Repay should be 50% of debt = 6000 USDC
        assert_eq!(repay, 6000 * PRECISION);
        // Seized should be 6000 * 1.05 / 1000 = 6.3 ETH
        assert!(seized > 6 * PRECISION);
        assert!(seized < 7 * PRECISION);

        // Remaining position
        let remaining_collateral = collateral - seized;
        let remaining_debt = debt - repay;
        assert!(remaining_collateral > 0);
        assert!(remaining_debt > 0);
    }

    // ============ Insurance Pool Tests ============

    #[test]
    fn test_insurance_premium_calculation() {
        use super::insurance::*;
        // 1M borrowed, 50 bps annual rate, 1 year
        let premium = calculate_premium(
            1_000_000 * PRECISION,
            50, // 0.5%
            BLOCKS_PER_YEAR as u64,
        );
        // Expected: 1M * 0.005 = 5000 tokens
        assert_eq!(premium, 5_000 * PRECISION);
    }

    #[test]
    fn test_insurance_premium_partial_year() {
        use super::insurance::*;
        // 1M borrowed, 50 bps, half year
        let premium = calculate_premium(
            1_000_000 * PRECISION,
            50,
            BLOCKS_PER_YEAR as u64 / 2,
        );
        // Expected: ~2500 tokens
        assert_eq!(premium, 2_500 * PRECISION);
    }

    #[test]
    fn test_insurance_premium_zero_borrows() {
        use super::insurance::*;
        let premium = calculate_premium(0, 50, BLOCKS_PER_YEAR as u64);
        assert_eq!(premium, 0);
    }

    #[test]
    fn test_insurance_premium_zero_rate() {
        use super::insurance::*;
        let premium = calculate_premium(1_000_000 * PRECISION, 0, BLOCKS_PER_YEAR as u64);
        assert_eq!(premium, 0);
    }

    #[test]
    fn test_insurance_premium_zero_blocks() {
        use super::insurance::*;
        let premium = calculate_premium(1_000_000 * PRECISION, 50, 0);
        assert_eq!(premium, 0);
    }

    #[test]
    fn test_insurance_deposit_first() {
        use super::insurance::*;
        let shares = deposit_to_shares(1000 * PRECISION, 0, 0).unwrap();
        assert_eq!(shares, 1000 * PRECISION); // 1:1
    }

    #[test]
    fn test_insurance_deposit_proportional() {
        use super::insurance::*;
        // Pool has 1000 shares for 1100 deposits (premiums accrued)
        let shares = deposit_to_shares(
            100 * PRECISION,
            1000 * PRECISION,
            1100 * PRECISION,
        ).unwrap();
        // 100 * 1000 / 1100 ≈ 90.9
        let expected = mul_div(100 * PRECISION, 1000 * PRECISION, 1100 * PRECISION);
        assert_eq!(shares, expected);
    }

    #[test]
    fn test_insurance_redeem_shares() {
        use super::insurance::*;
        // 90.9 shares, pool has 1000 shares for 1100 deposits
        let shares_amount = mul_div(100 * PRECISION, 1000 * PRECISION, 1100 * PRECISION);
        let underlying = shares_to_underlying(
            shares_amount,
            1000 * PRECISION,
            1100 * PRECISION,
        ).unwrap();
        assert!(underlying >= 99 * PRECISION);
        assert!(underlying <= 100 * PRECISION);
    }

    #[test]
    fn test_insurance_redeem_zero_shares_pool() {
        use super::insurance::*;
        let result = shares_to_underlying(100 * PRECISION, 0, 100 * PRECISION);
        assert_eq!(result, Err(LendingError::ZeroDeposits));
    }

    #[test]
    fn test_insurance_available_coverage() {
        use super::insurance::*;
        // 500K deposits, 20% max per claim = 100K max
        let coverage = available_coverage(500_000 * PRECISION, 2000);
        assert_eq!(coverage, 100_000 * PRECISION);
    }

    #[test]
    fn test_insurance_claim_distressed_vault() {
        use super::insurance::*;
        // 10 ETH at $1000, 8000 USDC debt, 80% LT
        // HF = (10*1000*0.8)/8000 = 1.0 — at liquidation threshold
        // Target HF: 1.1
        let (claim, new_hf) = calculate_claim(
            10 * PRECISION, 1000 * PRECISION,
            8000 * PRECISION, PRECISION,
            800_000_000_000_000_000, // 80% LT
            super::prevention::HF_SOFT_LIQUIDATION, // target 1.1
            500_000 * PRECISION, // insurance pool deposits
            2000, // 20% max coverage
        );
        assert!(claim > 0, "Should claim insurance");
        assert!(new_hf > PRECISION, "New HF should be above 1.0");
    }

    #[test]
    fn test_insurance_claim_safe_vault() {
        use super::insurance::*;
        // HF = 3.2 — safe, no claim needed
        let (claim, _hf) = calculate_claim(
            10 * PRECISION, 2000 * PRECISION,
            5000 * PRECISION, PRECISION,
            800_000_000_000_000_000,
            super::prevention::HF_SOFT_LIQUIDATION,
            500_000 * PRECISION,
            2000,
        );
        assert_eq!(claim, 0);
    }

    #[test]
    fn test_insurance_claim_capped_by_coverage() {
        use super::insurance::*;
        // Very small insurance pool (100 tokens), large shortfall
        // 10 ETH at $500, 8000 USDC debt, 80% LT
        // HF = (10*500*0.8)/8000 = 0.5
        let (claim, new_hf) = calculate_claim(
            10 * PRECISION, 500 * PRECISION,
            8000 * PRECISION, PRECISION,
            800_000_000_000_000_000,
            super::prevention::HF_SOFT_LIQUIDATION,
            100 * PRECISION, // tiny pool
            2000, // 20% max = 20 tokens
        );
        // Claim should be capped at available coverage (20 tokens)
        let max = available_coverage(100 * PRECISION, 2000);
        assert_eq!(claim, max);
        // New HF won't reach target but should be better than before
        assert!(new_hf > 500_000_000_000_000_000); // > 0.5
    }

    #[test]
    fn test_insurance_exchange_rate_initial() {
        use super::insurance::*;
        assert_eq!(exchange_rate(0, 0), PRECISION);
    }

    #[test]
    fn test_insurance_exchange_rate_after_premiums() {
        use super::insurance::*;
        // 1000 shares, 1050 deposits (premiums accrued 5%)
        let rate = exchange_rate(1000 * PRECISION, 1050 * PRECISION);
        assert_eq!(rate, 1_050_000_000_000_000_000); // 1.05e18
    }

    #[test]
    fn test_insurance_cooldown_satisfied() {
        use super::insurance::*;
        // Deposit at block 100, cooldown 1000 blocks
        assert!(!cooldown_satisfied(100, 500, 1000));  // 500 < 100+1000
        assert!(cooldown_satisfied(100, 1100, 1000));  // 1100 >= 100+1000
        assert!(cooldown_satisfied(100, 1100, 0));     // No cooldown
    }

    #[test]
    fn test_insurance_coverage_ratio() {
        use super::insurance::*;
        // 100K insurance, 500K borrows = 20% coverage
        let ratio = coverage_ratio(100_000 * PRECISION, 500_000 * PRECISION);
        assert_eq!(ratio, 200_000_000_000_000_000); // 0.2e18 = 20%
    }

    #[test]
    fn test_insurance_coverage_ratio_full() {
        use super::insurance::*;
        // Insurance >= borrows — capped at 100%
        let ratio = coverage_ratio(600_000 * PRECISION, 500_000 * PRECISION);
        assert_eq!(ratio, PRECISION);
    }

    #[test]
    fn test_insurance_coverage_ratio_no_borrows() {
        use super::insurance::*;
        let ratio = coverage_ratio(100_000 * PRECISION, 0);
        assert_eq!(ratio, PRECISION);
    }

    #[test]
    fn test_insurance_apy() {
        use super::insurance::*;
        // 5000 tokens annual premiums, 100K deposits = 5% APY
        let apy = insurance_apy(5_000 * PRECISION, 100_000 * PRECISION);
        assert_eq!(apy, 50_000_000_000_000_000); // 0.05e18 = 5%
    }

    #[test]
    fn test_insurance_apy_zero_deposits() {
        use super::insurance::*;
        assert_eq!(insurance_apy(5_000 * PRECISION, 0), 0);
    }

    // ============ Insurance Integration Test ============

    #[test]
    fn test_insurance_full_lifecycle() {
        use super::insurance::*;
        use super::prevention;

        // 1. Create insurance pool with 100K USDC
        let mut total_deposits = 100_000 * PRECISION;
        let mut total_shares = 100_000 * PRECISION;

        // 2. Lending pool has 1M borrows, premium rate 50 bps
        let lending_borrows = 1_000_000 * PRECISION;
        let premium_rate = 50u64; // 0.5%

        // 3. After 1 year, premiums accrue
        let premium = calculate_premium(lending_borrows, premium_rate, BLOCKS_PER_YEAR as u64);
        assert_eq!(premium, 5_000 * PRECISION); // 5K USDC
        total_deposits += premium;

        // 4. Exchange rate increased — depositors earned yield
        let rate = exchange_rate(total_shares, total_deposits);
        assert!(rate > PRECISION); // Shares worth more

        // 5. APY check
        let apy = insurance_apy(premium, 100_000 * PRECISION);
        assert_eq!(apy, 50_000_000_000_000_000); // 5%

        // 6. Vault enters distress — need insurance
        // 10 ETH at $1000, 8000 USDC debt, 80% LT → HF = 1.0
        let (claim, new_hf) = calculate_claim(
            10 * PRECISION, 1000 * PRECISION,
            8000 * PRECISION, PRECISION,
            800_000_000_000_000_000,
            prevention::HF_SOFT_LIQUIDATION,
            total_deposits,
            2000,
        );
        assert!(claim > 0);
        assert!(new_hf >= prevention::HF_SOFT_LIQUIDATION - PRECISION / 100);

        // 7. After claim, pool deposits decrease
        total_deposits -= claim;
        assert!(total_deposits > 0);

        // 8. Coverage ratio check
        let coverage = coverage_ratio(total_deposits, lending_borrows);
        assert!(coverage > 0);

        // 9. New depositor joins after premium accrual — gets fewer shares
        let new_deposit = 1000 * PRECISION;
        let new_shares = deposit_to_shares(
            new_deposit,
            total_shares,
            total_deposits,
        ).unwrap();
        // Should get fewer shares since pool has accrued value (minus claim)
        // But pool was depleted by claim so could be close to 1:1
        assert!(new_shares > 0);
    }
}
