// ============ Lending — Pool Interaction, Position Management & Liquidation Strategy ============
// High-level lending protocol SDK for VibeSwap on CKB.
//
// Provides helpers for:
// - Interest rate analysis (kinked utilization curve model)
// - Position health monitoring and borrow capacity calculation
// - Liquidation opportunity detection and profit estimation
// - Deposit/share accounting (cToken-style exchange rates)
// - Repayment scheduling and debt projection
// - Pool-level aggregate statistics
//
// All arithmetic is integer-only using mul_div with 1e18 PRECISION.
// Self-contained — does NOT import from vibeswap-lending-math; re-implements
// necessary formulas using vibeswap_math primitives.
//
// Philosophy: Cooperative Capitalism — mutualized risk through insurance pools,
// graduated de-risking over predatory liquidation (P-105).

use vibeswap_math::PRECISION;
use vibeswap_math::mul_div;

// ============ Constants ============

/// Health factor = 1.0 at PRECISION scale — the liquidation threshold
pub const MIN_HEALTH_FACTOR: u128 = PRECISION;

/// Health factor = 1.5 — considered safe
pub const SAFE_HEALTH_FACTOR: u128 = PRECISION * 15 / 10;

/// Default close factor: 50% of debt can be liquidated per tx
pub const DEFAULT_CLOSE_FACTOR_BPS: u16 = 5000;

/// Default liquidation bonus: 5% incentive for liquidators
pub const DEFAULT_LIQUIDATION_BONUS_BPS: u16 = 500;

/// Blocks per year (~12s block time on CKB: 365.25 * 24 * 3600 / 12)
pub const BLOCKS_PER_YEAR: u64 = 7_884_000;

/// Maximum utilization in basis points
pub const MAX_UTILIZATION_BPS: u16 = 10_000;

/// Basis points denominator
pub const BPS: u128 = 10_000;

// ============ Error Types ============

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LendingError {
    /// Collateral value insufficient to support the requested borrow
    InsufficientCollateral,
    /// Position health factor is below liquidation threshold
    Undercollateralized,
    /// Pool has reached maximum capacity
    PoolFull,
    /// Operation requires a non-zero amount
    ZeroAmount,
    /// Interest rate parameter is out of valid range
    InvalidRate,
    /// Position has no outstanding debt
    NoDebt,
    /// Position health factor is above liquidation threshold (cannot liquidate)
    HealthFactorSafe,
    /// Oracle price is stale or zero
    StalePrice,
    /// Repayment amount exceeds total debt
    ExcessRepayment,
    /// Utilization value is out of valid range
    InvalidUtilization,
}

// ============ Data Types ============

/// Lending pool state — tracks deposits, borrows, shares, and rate model parameters.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LendingPool {
    /// Unique pool identifier
    pub pool_id: [u8; 32],
    /// Total deposited capital in the pool
    pub total_deposits: u128,
    /// Total outstanding borrows
    pub total_borrows: u128,
    /// Total deposit shares outstanding
    pub total_shares: u128,
    /// Cumulative borrow index (starts at PRECISION = 1e18)
    pub borrow_index: u128,
    /// Reserve factor in basis points (protocol's cut of interest)
    pub reserve_factor_bps: u16,
    /// Base borrow rate at 0% utilization (bps)
    pub base_rate_bps: u16,
    /// Slope below optimal utilization (bps)
    pub slope1_bps: u16,
    /// Slope above optimal utilization (bps)
    pub slope2_bps: u16,
    /// Optimal utilization target (bps)
    pub optimal_utilization_bps: u16,
    /// Last block at which interest was accrued
    pub last_accrual_block: u64,
}

/// User's lending position — collateral, debt, and oracle prices.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UserPosition {
    /// Owner address hash
    pub owner: [u8; 32],
    /// Amount of collateral deposited
    pub collateral_amount: u128,
    /// Debt shares (not raw amount — multiply by borrow_index to get actual debt)
    pub debt_shares: u128,
    /// Current collateral price (scaled by PRECISION)
    pub collateral_price: u128,
    /// Current debt asset price (scaled by PRECISION)
    pub debt_price: u128,
    /// Collateral factor in basis points (max LTV for borrowing)
    pub collateral_factor_bps: u16,
    /// Liquidation threshold in basis points (HF trigger)
    pub liquidation_threshold_bps: u16,
}

/// Borrow capacity breakdown for a position.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BorrowCapacity {
    /// Maximum borrow value allowed by collateral factor
    pub max_borrow_value: u128,
    /// Current debt value in base currency
    pub current_debt_value: u128,
    /// Remaining borrow capacity (max - current, floored at 0)
    pub remaining_capacity: u128,
    /// Current utilization of borrow capacity in bps
    pub utilization_bps: u16,
}

/// Full interest rate breakdown for a pool.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InterestRateInfo {
    /// Current pool utilization in bps
    pub utilization_bps: u16,
    /// Current borrow rate in bps (annualized)
    pub borrow_rate_bps: u16,
    /// Current supply rate in bps (annualized)
    pub supply_rate_bps: u16,
    /// Borrow APY in bps (compound approximation)
    pub borrow_apy_bps: u16,
    /// Supply APY in bps (compound approximation)
    pub supply_apy_bps: u16,
}

/// Liquidation opportunity analysis.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LiquidationOpportunity {
    /// Owner of the vault being liquidated
    pub vault_owner: [u8; 32],
    /// Current health factor (PRECISION scale)
    pub health_factor: u128,
    /// Amount of debt to repay
    pub debt_to_repay: u128,
    /// Amount of collateral to seize
    pub collateral_to_seize: u128,
    /// Estimated profit for the liquidator (collateral value - debt repaid)
    pub profit: u128,
    /// Close factor used (bps)
    pub close_factor_bps: u16,
}

/// Aggregate pool statistics.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolSummary {
    /// Total value locked (deposits)
    pub tvl: u128,
    /// Total outstanding borrows
    pub total_borrowed: u128,
    /// Available liquidity for new borrows
    pub available_liquidity: u128,
    /// Pool utilization in bps
    pub utilization_bps: u16,
    /// Number of depositors
    pub depositor_count: u32,
    /// Number of borrowers
    pub borrower_count: u32,
}

/// Repayment schedule projection.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RepaymentSchedule {
    /// Total owed (principal + interest)
    pub total_owed: u128,
    /// Original principal
    pub principal: u128,
    /// Interest accrued
    pub interest_accrued: u128,
    /// Blocks elapsed since borrow
    pub blocks_elapsed: u64,
    /// Interest per block at current rate
    pub per_block_interest: u128,
}

// ============ Interest Rate Functions ============

/// Calculate current pool utilization in basis points.
///
/// utilization = total_borrows * 10000 / total_deposits
/// Returns 0 if pool is empty (no deposits and no borrows).
pub fn utilization_rate(pool: &LendingPool) -> u16 {
    if pool.total_deposits == 0 {
        return 0;
    }
    let util = mul_div(pool.total_borrows, BPS, pool.total_deposits);
    if util > BPS {
        MAX_UTILIZATION_BPS
    } else {
        util as u16
    }
}

/// Calculate current borrow rate in basis points using the kinked curve model.
///
/// Below optimal utilization:
///   rate = base_rate + slope1 * utilization / optimal
/// Above optimal utilization:
///   rate = base_rate + slope1 + slope2 * (utilization - optimal) / (10000 - optimal)
pub fn borrow_rate_bps(pool: &LendingPool) -> u16 {
    let util = utilization_rate(pool) as u128;
    let optimal = pool.optimal_utilization_bps as u128;
    let base = pool.base_rate_bps as u128;
    let s1 = pool.slope1_bps as u128;
    let s2 = pool.slope2_bps as u128;

    if util <= optimal {
        // Below or at kink
        if optimal == 0 {
            return base as u16;
        }
        let variable = mul_div(util, s1, optimal);
        (base + variable) as u16
    } else {
        // Above kink
        let excess = util - optimal;
        let denom = BPS - optimal;
        if denom == 0 {
            return (base + s1 + s2) as u16;
        }
        let steep = mul_div(excess, s2, denom);
        (base + s1 + steep) as u16
    }
}

/// Calculate current supply rate in basis points.
///
/// supply_rate = borrow_rate * utilization * (1 - reserve_factor) / 10000^2
/// Depositors earn less than borrowers pay because of the reserve factor
/// and because not all deposits are utilized.
pub fn supply_rate_bps(pool: &LendingPool) -> u16 {
    let br = borrow_rate_bps(pool) as u128;
    let util = utilization_rate(pool) as u128;
    let rf = pool.reserve_factor_bps as u128;
    let one_minus_rf = BPS - rf;

    // supply = borrow_rate * utilization / BPS * (1 - rf) / BPS
    let intermediate = mul_div(br, util, BPS);
    let result = mul_div(intermediate, one_minus_rf, BPS);
    result as u16
}

/// Get full interest rate breakdown for a pool.
///
/// Includes utilization, borrow/supply rates, and APY approximations.
/// APY is approximated as: apy = rate * (1 + rate/blocks_per_year)^(blocks_per_year) - 1
/// We use a simple linear approximation: apy ≈ rate (for small rates this is close enough,
/// and avoids complex exponentiation in integer math).
pub fn interest_rate_info(pool: &LendingPool) -> InterestRateInfo {
    let util = utilization_rate(pool);
    let br = borrow_rate_bps(pool);
    let sr = supply_rate_bps(pool);

    // APY approximation: for DeFi-typical rates (2-50% APR), the difference
    // between APR and APY is small. We add a compounding adjustment:
    // apy ≈ apr + apr^2 / (2 * 10000)
    // This captures the first-order compounding effect.
    let borrow_apy = apy_from_apr_bps(br);
    let supply_apy = apy_from_apr_bps(sr);

    InterestRateInfo {
        utilization_bps: util,
        borrow_rate_bps: br,
        supply_rate_bps: sr,
        borrow_apy_bps: borrow_apy,
        supply_apy_bps: supply_apy,
    }
}

/// Approximate APY from APR in basis points.
/// apy ≈ apr + apr^2 / (2 * 10000)
fn apy_from_apr_bps(apr_bps: u16) -> u16 {
    let apr = apr_bps as u128;
    let compound_adjustment = mul_div(apr, apr, 2 * BPS);
    let apy = apr + compound_adjustment;
    if apy > u16::MAX as u128 {
        u16::MAX
    } else {
        apy as u16
    }
}

// ============ Health & Position Functions ============

/// Calculate the health factor for a position.
///
/// HF = (collateral_value * liquidation_threshold_bps / BPS) / debt_value
/// Returned at PRECISION scale (1e18 = 1.0).
/// If there is no debt, returns u128::MAX (infinitely healthy).
pub fn health_factor(position: &UserPosition, borrow_index: u128) -> u128 {
    let actual_debt = debt_from_shares(position.debt_shares, borrow_index);
    if actual_debt == 0 {
        return u128::MAX;
    }

    let col_value = mul_div(position.collateral_amount, position.collateral_price, PRECISION);
    let adjusted_col = mul_div(col_value, position.liquidation_threshold_bps as u128, BPS);
    let dv = mul_div(actual_debt, position.debt_price, PRECISION);

    if dv == 0 {
        return u128::MAX;
    }

    mul_div(adjusted_col, PRECISION, dv)
}

/// Calculate remaining borrow capacity for a position.
///
/// max_borrow_value = collateral_value * collateral_factor_bps / BPS
/// remaining = max_borrow_value - current_debt_value (floored at 0)
pub fn borrow_capacity(position: &UserPosition, borrow_index: u128) -> BorrowCapacity {
    let col_value = mul_div(position.collateral_amount, position.collateral_price, PRECISION);
    let max_borrow_value = mul_div(col_value, position.collateral_factor_bps as u128, BPS);

    let actual_debt = debt_from_shares(position.debt_shares, borrow_index);
    let current_debt_value = mul_div(actual_debt, position.debt_price, PRECISION);

    let remaining_capacity = max_borrow_value.saturating_sub(current_debt_value);

    let utilization_bps = if max_borrow_value == 0 {
        0
    } else {
        let u = mul_div(current_debt_value, BPS, max_borrow_value);
        if u > BPS { MAX_UTILIZATION_BPS } else { u as u16 }
    };

    BorrowCapacity {
        max_borrow_value,
        current_debt_value,
        remaining_capacity,
        utilization_bps,
    }
}

/// Check if a position is liquidatable and compute the liquidation opportunity.
///
/// Returns Ok(LiquidationOpportunity) if HF < 1.0, Err otherwise.
/// The liquidator repays close_factor_bps% of debt and seizes collateral
/// worth (1 + liquidation_bonus_bps/BPS) times the repaid value.
pub fn liquidation_check(
    position: &UserPosition,
    borrow_index: u128,
    close_factor_bps: u16,
    liquidation_bonus_bps: u16,
) -> Result<LiquidationOpportunity, LendingError> {
    let hf = health_factor(position, borrow_index);

    if hf >= MIN_HEALTH_FACTOR {
        return Err(LendingError::HealthFactorSafe);
    }

    let actual_debt = debt_from_shares(position.debt_shares, borrow_index);
    if actual_debt == 0 {
        return Err(LendingError::NoDebt);
    }

    // Max debt to repay = actual_debt * close_factor / BPS
    let debt_to_repay = mul_div(actual_debt, close_factor_bps as u128, BPS);

    // Value of debt being repaid
    let repay_value = mul_div(debt_to_repay, position.debt_price, PRECISION);

    // Collateral to seize = repay_value * (1 + bonus) / collateral_price
    let bonus_multiplier = BPS + liquidation_bonus_bps as u128;
    let seize_value = mul_div(repay_value, bonus_multiplier, BPS);
    let collateral_to_seize_raw = mul_div(seize_value, PRECISION, position.collateral_price);

    // Cap at available collateral
    let collateral_to_seize = collateral_to_seize_raw.min(position.collateral_amount);

    // Profit = collateral seized value - debt repaid value
    let actual_seize_value = mul_div(collateral_to_seize, position.collateral_price, PRECISION);
    let profit = actual_seize_value.saturating_sub(repay_value);

    Ok(LiquidationOpportunity {
        vault_owner: position.owner,
        health_factor: hf,
        debt_to_repay,
        collateral_to_seize,
        profit,
        close_factor_bps,
    })
}

// ============ Pool State Functions ============

/// Accrue interest on a lending pool and return the updated state.
///
/// Uses linear interest approximation: interest = borrows * rate * blocks / blocks_per_year
/// Updates borrow_index proportionally to track per-share debt growth.
pub fn accrue_interest(pool: &LendingPool, current_block: u64) -> LendingPool {
    if current_block <= pool.last_accrual_block || pool.total_borrows == 0 {
        return LendingPool {
            last_accrual_block: if current_block > pool.last_accrual_block {
                current_block
            } else {
                pool.last_accrual_block
            },
            ..pool.clone()
        };
    }

    let blocks_elapsed = current_block - pool.last_accrual_block;
    let br = borrow_rate_bps(pool) as u128;

    // Annual interest in absolute terms = borrows * borrow_rate_bps / BPS
    // Per-block = annual / BLOCKS_PER_YEAR
    // Total for elapsed = per_block * blocks_elapsed
    let annual_interest = mul_div(pool.total_borrows, br, BPS);
    let interest_accrued = mul_div(annual_interest, blocks_elapsed as u128, BLOCKS_PER_YEAR as u128);

    // Protocol's cut
    let protocol_share = mul_div(interest_accrued, pool.reserve_factor_bps as u128, BPS);

    // Update borrow index: new_index = old_index * (1 + interest / borrows)
    let new_index = if pool.total_borrows > 0 {
        let ratio = mul_div(interest_accrued, PRECISION, pool.total_borrows);
        mul_div(pool.borrow_index, PRECISION + ratio, PRECISION)
    } else {
        pool.borrow_index
    };

    LendingPool {
        pool_id: pool.pool_id,
        total_deposits: pool.total_deposits + interest_accrued - protocol_share,
        total_borrows: pool.total_borrows + interest_accrued,
        total_shares: pool.total_shares,
        borrow_index: new_index,
        reserve_factor_bps: pool.reserve_factor_bps,
        base_rate_bps: pool.base_rate_bps,
        slope1_bps: pool.slope1_bps,
        slope2_bps: pool.slope2_bps,
        optimal_utilization_bps: pool.optimal_utilization_bps,
        last_accrual_block: current_block,
    }
}

// ============ Share Accounting Functions ============

/// Convert a deposit amount to shares.
///
/// First deposit: 1:1 ratio.
/// Subsequent deposits: shares = amount * total_shares / total_underlying
pub fn deposit_to_shares(amount: u128, total_shares: u128, total_underlying: u128) -> u128 {
    if amount == 0 {
        return 0;
    }
    if total_shares == 0 || total_underlying == 0 {
        return amount;
    }
    mul_div(amount, total_shares, total_underlying)
}

/// Convert shares to underlying asset amount.
///
/// underlying = shares * total_underlying / total_shares
pub fn shares_to_underlying(shares: u128, total_shares: u128, total_underlying: u128) -> u128 {
    if shares == 0 || total_shares == 0 {
        return 0;
    }
    mul_div(shares, total_underlying, total_shares)
}

// ============ Debt & Repayment Functions ============

/// Calculate actual debt from debt shares and borrow index.
///
/// Debt shares represent a proportion of the pool's total debt.
/// actual_debt = debt_shares * borrow_index / PRECISION
fn debt_from_shares(debt_shares: u128, borrow_index: u128) -> u128 {
    mul_div(debt_shares, borrow_index, PRECISION)
}

/// Project a repayment schedule given debt parameters.
///
/// Calculates principal (from initial index), interest accrued, total owed,
/// and per-block interest at the current rate.
pub fn repayment_schedule(
    debt_shares: u128,
    borrow_index: u128,
    initial_index: u128,
    per_block_rate: u128,
    blocks: u64,
) -> RepaymentSchedule {
    let principal = if initial_index == 0 {
        debt_shares
    } else {
        mul_div(debt_shares, initial_index, PRECISION)
    };

    let total_owed = debt_from_shares(debt_shares, borrow_index);
    let interest_accrued = total_owed.saturating_sub(principal);

    // Per-block interest at current rate
    let per_block_interest = mul_div(total_owed, per_block_rate, PRECISION);

    RepaymentSchedule {
        total_owed,
        principal,
        interest_accrued,
        blocks_elapsed: blocks,
        per_block_interest,
    }
}

// ============ Summary & Analysis Functions ============

/// Generate aggregate pool statistics.
pub fn pool_summary(pool: &LendingPool, depositors: u32, borrowers: u32) -> PoolSummary {
    let available = pool.total_deposits.saturating_sub(pool.total_borrows);
    let util = utilization_rate(pool);

    PoolSummary {
        tvl: pool.total_deposits,
        total_borrowed: pool.total_borrows,
        available_liquidity: available,
        utilization_bps: util,
        depositor_count: depositors,
        borrower_count: borrowers,
    }
}

/// Calculate the maximum safe borrow value given collateral and existing debt.
///
/// max_safe = collateral_value * collateral_factor_bps / BPS - existing_debt_value
/// Floored at zero.
pub fn max_safe_borrow(
    collateral_value: u128,
    collateral_factor_bps: u16,
    existing_debt_value: u128,
) -> u128 {
    let max_value = mul_div(collateral_value, collateral_factor_bps as u128, BPS);
    max_value.saturating_sub(existing_debt_value)
}

/// Calculate current debt value in base currency.
///
/// debt_value = debt_shares * borrow_index / PRECISION * debt_price / PRECISION
pub fn debt_value(debt_shares: u128, borrow_index: u128, debt_price: u128) -> u128 {
    let actual_debt = debt_from_shares(debt_shares, borrow_index);
    mul_div(actual_debt, debt_price, PRECISION)
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Test Helpers ============

    fn default_pool() -> LendingPool {
        LendingPool {
            pool_id: [0u8; 32],
            total_deposits: 1_000_000 * PRECISION,
            total_borrows: 500_000 * PRECISION,
            total_shares: 1_000_000 * PRECISION,
            borrow_index: PRECISION,
            reserve_factor_bps: 1000, // 10%
            base_rate_bps: 200,       // 2%
            slope1_bps: 400,          // 4%
            slope2_bps: 30000,        // 300%
            optimal_utilization_bps: 8000, // 80%
            last_accrual_block: 100,
        }
    }

    fn default_position() -> UserPosition {
        UserPosition {
            owner: [1u8; 32],
            collateral_amount: 10 * PRECISION, // 10 tokens
            debt_shares: 5 * PRECISION,         // 5 debt shares
            collateral_price: 2000 * PRECISION, // $2000 per token
            debt_price: PRECISION,              // $1 per debt token
            collateral_factor_bps: 7500,        // 75%
            liquidation_threshold_bps: 8000,    // 80%
        }
    }

    // ============ Utilization Rate Tests ============

    #[test]
    fn test_utilization_rate_zero_deposits() {
        let pool = LendingPool {
            total_deposits: 0,
            total_borrows: 0,
            ..default_pool()
        };
        assert_eq!(utilization_rate(&pool), 0);
    }

    #[test]
    fn test_utilization_rate_zero_borrows() {
        let pool = LendingPool {
            total_borrows: 0,
            ..default_pool()
        };
        assert_eq!(utilization_rate(&pool), 0);
    }

    #[test]
    fn test_utilization_rate_50_percent() {
        let pool = LendingPool {
            total_deposits: 1_000 * PRECISION,
            total_borrows: 500 * PRECISION,
            ..default_pool()
        };
        assert_eq!(utilization_rate(&pool), 5000);
    }

    #[test]
    fn test_utilization_rate_100_percent() {
        let pool = LendingPool {
            total_deposits: 1_000 * PRECISION,
            total_borrows: 1_000 * PRECISION,
            ..default_pool()
        };
        assert_eq!(utilization_rate(&pool), 10000);
    }

    #[test]
    fn test_utilization_rate_fully_borrowed() {
        let pool = LendingPool {
            total_deposits: 500 * PRECISION,
            total_borrows: 500 * PRECISION,
            ..default_pool()
        };
        assert_eq!(utilization_rate(&pool), 10000);
    }

    #[test]
    fn test_utilization_rate_small_borrow() {
        let pool = LendingPool {
            total_deposits: 10_000 * PRECISION,
            total_borrows: 1 * PRECISION,
            ..default_pool()
        };
        assert_eq!(utilization_rate(&pool), 1); // 0.01%
    }

    #[test]
    fn test_utilization_rate_capped_at_max() {
        // Borrows somehow exceed deposits
        let pool = LendingPool {
            total_deposits: 100 * PRECISION,
            total_borrows: 200 * PRECISION,
            ..default_pool()
        };
        assert_eq!(utilization_rate(&pool), MAX_UTILIZATION_BPS);
    }

    // ============ Borrow Rate Tests ============

    #[test]
    fn test_borrow_rate_zero_utilization() {
        let pool = LendingPool {
            total_borrows: 0,
            ..default_pool()
        };
        assert_eq!(borrow_rate_bps(&pool), 200); // Just base rate
    }

    #[test]
    fn test_borrow_rate_below_optimal() {
        // 50% utilization, optimal = 80%
        let pool = default_pool(); // 50% util
        let rate = borrow_rate_bps(&pool);
        // rate = 200 + 400 * 5000 / 8000 = 200 + 250 = 450
        assert_eq!(rate, 450);
    }

    #[test]
    fn test_borrow_rate_at_optimal() {
        let pool = LendingPool {
            total_deposits: 1_000 * PRECISION,
            total_borrows: 800 * PRECISION,
            ..default_pool()
        };
        let rate = borrow_rate_bps(&pool);
        // rate = 200 + 400 * 8000 / 8000 = 200 + 400 = 600
        assert_eq!(rate, 600);
    }

    #[test]
    fn test_borrow_rate_above_optimal() {
        let pool = LendingPool {
            total_deposits: 1_000 * PRECISION,
            total_borrows: 900 * PRECISION,
            ..default_pool()
        };
        let rate = borrow_rate_bps(&pool);
        // util = 9000 bps
        // rate = 200 + 400 + 30000 * (9000 - 8000) / (10000 - 8000)
        //      = 200 + 400 + 30000 * 1000 / 2000
        //      = 200 + 400 + 15000 = 15600
        assert_eq!(rate, 15600);
    }

    #[test]
    fn test_borrow_rate_100_percent_utilization() {
        let pool = LendingPool {
            total_deposits: 1_000 * PRECISION,
            total_borrows: 1_000 * PRECISION,
            ..default_pool()
        };
        let rate = borrow_rate_bps(&pool);
        // rate = 200 + 400 + 30000 * (10000 - 8000) / (10000 - 8000)
        //      = 200 + 400 + 30000 = 30600
        assert_eq!(rate, 30600);
    }

    #[test]
    fn test_borrow_rate_zero_optimal() {
        let pool = LendingPool {
            total_borrows: 0,
            optimal_utilization_bps: 0,
            ..default_pool()
        };
        let rate = borrow_rate_bps(&pool);
        assert_eq!(rate, 200); // Just base rate when no borrows
    }

    #[test]
    fn test_borrow_rate_extreme_slope2() {
        let pool = LendingPool {
            total_deposits: 1_000 * PRECISION,
            total_borrows: 950 * PRECISION,
            slope2_bps: 50000, // 500%
            ..default_pool()
        };
        let rate = borrow_rate_bps(&pool);
        // util = 9500
        // excess = 9500 - 8000 = 1500
        // steep = 50000 * 1500 / 2000 = 37500
        // rate = 200 + 400 + 37500 = 38100
        assert_eq!(rate, 38100);
    }

    // ============ Supply Rate Tests ============

    #[test]
    fn test_supply_rate_zero_borrows() {
        let pool = LendingPool {
            total_borrows: 0,
            ..default_pool()
        };
        assert_eq!(supply_rate_bps(&pool), 0);
    }

    #[test]
    fn test_supply_rate_normal() {
        let pool = default_pool(); // 50% util, 10% reserve
        let sr = supply_rate_bps(&pool);
        // borrow_rate = 450
        // supply = 450 * 5000 / 10000 * 9000 / 10000
        //        = 225 * 9000 / 10000 = 202
        assert_eq!(sr, 202);
    }

    #[test]
    fn test_supply_rate_zero_reserve_factor() {
        let pool = LendingPool {
            reserve_factor_bps: 0,
            ..default_pool()
        };
        let sr = supply_rate_bps(&pool);
        // borrow_rate = 450, util = 5000
        // supply = 450 * 5000 / 10000 * 10000 / 10000 = 225
        assert_eq!(sr, 225);
    }

    #[test]
    fn test_supply_rate_high_reserve_factor() {
        let pool = LendingPool {
            reserve_factor_bps: 5000, // 50% reserve
            ..default_pool()
        };
        let sr = supply_rate_bps(&pool);
        // supply = 450 * 5000 / 10000 * 5000 / 10000 = 112
        assert_eq!(sr, 112);
    }

    #[test]
    fn test_supply_rate_full_utilization() {
        let pool = LendingPool {
            total_deposits: 1_000 * PRECISION,
            total_borrows: 1_000 * PRECISION,
            ..default_pool()
        };
        let sr = supply_rate_bps(&pool);
        let br = borrow_rate_bps(&pool) as u128; // 30600
        // supply = 30600 * 10000 / 10000 * 9000 / 10000 = 27540
        let expected = mul_div(br, 9000, BPS);
        assert_eq!(sr, expected as u16);
    }

    // ============ Interest Rate Info Tests ============

    #[test]
    fn test_interest_rate_info_normal() {
        let pool = default_pool();
        let info = interest_rate_info(&pool);
        assert_eq!(info.utilization_bps, 5000);
        assert_eq!(info.borrow_rate_bps, 450);
        assert!(info.borrow_apy_bps >= info.borrow_rate_bps);
        assert!(info.supply_apy_bps >= info.supply_rate_bps);
    }

    #[test]
    fn test_interest_rate_info_empty_pool() {
        let pool = LendingPool {
            total_deposits: 0,
            total_borrows: 0,
            ..default_pool()
        };
        let info = interest_rate_info(&pool);
        assert_eq!(info.utilization_bps, 0);
        assert_eq!(info.borrow_rate_bps, 200); // base rate only
        assert_eq!(info.supply_rate_bps, 0);
    }

    #[test]
    fn test_apy_from_apr_zero() {
        assert_eq!(apy_from_apr_bps(0), 0);
    }

    #[test]
    fn test_apy_from_apr_small() {
        // 2% APR = 200 bps
        // apy = 200 + 200*200/(2*10000) = 200 + 2 = 202
        assert_eq!(apy_from_apr_bps(200), 202);
    }

    #[test]
    fn test_apy_from_apr_large() {
        // 100% APR = 10000 bps
        // apy = 10000 + 10000*10000/(2*10000) = 10000 + 5000 = 15000
        assert_eq!(apy_from_apr_bps(10000), 15000);
    }

    // ============ Health Factor Tests ============

    #[test]
    fn test_health_factor_safe_position() {
        let pos = default_position();
        let hf = health_factor(&pos, PRECISION);
        // col_value = 10 * 2000 = 20000 (at PRECISION scale)
        // adjusted = 20000 * 8000 / 10000 = 16000
        // debt = 5 * 1 = 5
        // debt_value = 5
        // hf = 16000 / 5 = 3200 (at PRECISION scale)
        let expected = 3200 * PRECISION;
        assert_eq!(hf, expected);
    }

    #[test]
    fn test_health_factor_no_debt() {
        let pos = UserPosition {
            debt_shares: 0,
            ..default_position()
        };
        let hf = health_factor(&pos, PRECISION);
        assert_eq!(hf, u128::MAX);
    }

    #[test]
    fn test_health_factor_borderline() {
        // Set up so HF is exactly 1.0
        // col_value = col_amount * col_price / PRECISION
        // adjusted = col_value * LT / BPS
        // debt_value = debt_shares * borrow_index / PRECISION * debt_price / PRECISION
        // HF = adjusted * PRECISION / debt_value
        //
        // For HF = 1.0: adjusted = debt_value
        // col_amount * col_price * LT / (BPS * PRECISION) = debt_shares * debt_price * index / PRECISION^2
        //
        // Use: col=10, col_price=100*P, LT=8000, debt=8*P, debt_price=P, index=P
        // col_value = 10 * 100 = 1000
        // adjusted = 1000 * 8000/10000 = 800
        // debt_value = 8
        // HF = 800/8 = 100 => too high
        //
        // Let's just make debt large enough:
        // We want HF = PRECISION
        // adjusted = col * col_p / P * LT / BPS = 10 * 2000P / P * 8000 / 10000 = 16000
        // debt_value = debt_shares * index / P * debt_p / P = debt_shares * 1
        // So debt_shares = 16000 * PRECISION for HF = 1.0
        let pos = UserPosition {
            debt_shares: 16_000 * PRECISION,
            ..default_position()
        };
        let hf = health_factor(&pos, PRECISION);
        assert_eq!(hf, PRECISION); // Exactly 1.0
    }

    #[test]
    fn test_health_factor_underwater() {
        let pos = UserPosition {
            debt_shares: 20_000 * PRECISION,
            ..default_position()
        };
        let hf = health_factor(&pos, PRECISION);
        // adjusted = 16000, debt_value = 20000
        // hf = 16000/20000 * PRECISION = 0.8 * PRECISION
        let expected = mul_div(16000 * PRECISION, PRECISION, 20000 * PRECISION);
        assert_eq!(hf, expected);
        assert!(hf < PRECISION); // Below 1.0
    }

    #[test]
    fn test_health_factor_with_higher_borrow_index() {
        // Borrow index of 2.0 means debt has doubled
        let pos = default_position();
        let hf_normal = health_factor(&pos, PRECISION);
        let hf_doubled = health_factor(&pos, 2 * PRECISION);
        // Doubled debt means HF should halve
        assert_eq!(hf_doubled, hf_normal / 2);
    }

    #[test]
    fn test_health_factor_zero_collateral_price() {
        let pos = UserPosition {
            collateral_price: 0,
            ..default_position()
        };
        let hf = health_factor(&pos, PRECISION);
        // col_value = 0, adjusted = 0, so hf = 0
        assert_eq!(hf, 0);
    }

    // ============ Borrow Capacity Tests ============

    #[test]
    fn test_borrow_capacity_plenty_of_room() {
        let pos = default_position();
        let cap = borrow_capacity(&pos, PRECISION);
        // max_borrow = 10 * 2000 * 7500/10000 = 15000
        // debt_value = 5 * 1 = 5
        // remaining = 14995
        assert_eq!(cap.max_borrow_value, 15_000 * PRECISION);
        assert_eq!(cap.current_debt_value, 5 * PRECISION);
        assert_eq!(cap.remaining_capacity, 14_995 * PRECISION);
    }

    #[test]
    fn test_borrow_capacity_at_limit() {
        let pos = UserPosition {
            debt_shares: 15_000 * PRECISION,
            ..default_position()
        };
        let cap = borrow_capacity(&pos, PRECISION);
        assert_eq!(cap.remaining_capacity, 0);
        assert_eq!(cap.utilization_bps, MAX_UTILIZATION_BPS);
    }

    #[test]
    fn test_borrow_capacity_overextended() {
        let pos = UserPosition {
            debt_shares: 20_000 * PRECISION,
            ..default_position()
        };
        let cap = borrow_capacity(&pos, PRECISION);
        assert_eq!(cap.remaining_capacity, 0); // Saturating sub
        assert_eq!(cap.utilization_bps, MAX_UTILIZATION_BPS);
    }

    #[test]
    fn test_borrow_capacity_no_collateral() {
        let pos = UserPosition {
            collateral_amount: 0,
            ..default_position()
        };
        let cap = borrow_capacity(&pos, PRECISION);
        assert_eq!(cap.max_borrow_value, 0);
        assert_eq!(cap.remaining_capacity, 0);
    }

    #[test]
    fn test_borrow_capacity_no_debt() {
        let pos = UserPosition {
            debt_shares: 0,
            ..default_position()
        };
        let cap = borrow_capacity(&pos, PRECISION);
        assert_eq!(cap.current_debt_value, 0);
        assert_eq!(cap.remaining_capacity, cap.max_borrow_value);
        assert_eq!(cap.utilization_bps, 0);
    }

    // ============ Liquidation Check Tests ============

    #[test]
    fn test_liquidation_not_eligible() {
        let pos = default_position(); // Very healthy
        let result = liquidation_check(&pos, PRECISION, DEFAULT_CLOSE_FACTOR_BPS, DEFAULT_LIQUIDATION_BONUS_BPS);
        assert_eq!(result, Err(LendingError::HealthFactorSafe));
    }

    #[test]
    fn test_liquidation_eligible() {
        // Make position underwater
        let pos = UserPosition {
            debt_shares: 20_000 * PRECISION,
            ..default_position()
        };
        let result = liquidation_check(&pos, PRECISION, DEFAULT_CLOSE_FACTOR_BPS, DEFAULT_LIQUIDATION_BONUS_BPS);
        assert!(result.is_ok());
        let opp = result.unwrap();
        assert_eq!(opp.close_factor_bps, DEFAULT_CLOSE_FACTOR_BPS);
        assert!(opp.health_factor < PRECISION);
    }

    #[test]
    fn test_liquidation_debt_to_repay() {
        let pos = UserPosition {
            debt_shares: 20_000 * PRECISION,
            ..default_position()
        };
        let opp = liquidation_check(&pos, PRECISION, DEFAULT_CLOSE_FACTOR_BPS, DEFAULT_LIQUIDATION_BONUS_BPS).unwrap();
        // debt_to_repay = 20000 * 5000/10000 = 10000
        assert_eq!(opp.debt_to_repay, 10_000 * PRECISION);
    }

    #[test]
    fn test_liquidation_collateral_seize_with_bonus() {
        // Position: 10 tokens at $2000 = $20000 collateral
        // Debt: 20000 tokens at $1 = $20000 debt
        // Close factor: 50%, so repay $10000 of debt
        // Bonus: 5%, so seize $10500 worth of collateral = 5.25 tokens
        let pos = UserPosition {
            debt_shares: 20_000 * PRECISION,
            ..default_position()
        };
        let opp = liquidation_check(&pos, PRECISION, DEFAULT_CLOSE_FACTOR_BPS, DEFAULT_LIQUIDATION_BONUS_BPS).unwrap();
        // seize_value = 10000 * 10500/10000 = 10500 (in debt terms)
        // collateral_to_seize = 10500 / 2000 = 5.25 tokens
        let expected_seize = mul_div(10_500 * PRECISION, PRECISION, 2000 * PRECISION);
        assert_eq!(opp.collateral_to_seize, expected_seize);
    }

    #[test]
    fn test_liquidation_profit_calculation() {
        let pos = UserPosition {
            debt_shares: 20_000 * PRECISION,
            ..default_position()
        };
        let opp = liquidation_check(&pos, PRECISION, DEFAULT_CLOSE_FACTOR_BPS, DEFAULT_LIQUIDATION_BONUS_BPS).unwrap();
        // Profit = seized value - repaid value
        // repaid = 10000, seized_value = 5.25 * 2000 = 10500
        // profit = 500
        assert_eq!(opp.profit, 500 * PRECISION);
    }

    #[test]
    fn test_liquidation_collateral_capped() {
        // Huge debt but little collateral
        let pos = UserPosition {
            collateral_amount: 1 * PRECISION, // Only 1 token ($2000)
            debt_shares: 100_000 * PRECISION,  // $100000 debt
            ..default_position()
        };
        let opp = liquidation_check(&pos, PRECISION, DEFAULT_CLOSE_FACTOR_BPS, DEFAULT_LIQUIDATION_BONUS_BPS).unwrap();
        // Collateral to seize is capped at available collateral
        assert_eq!(opp.collateral_to_seize, 1 * PRECISION);
    }

    #[test]
    fn test_liquidation_no_debt() {
        let pos = UserPosition {
            debt_shares: 0,
            ..default_position()
        };
        let result = liquidation_check(&pos, PRECISION, DEFAULT_CLOSE_FACTOR_BPS, DEFAULT_LIQUIDATION_BONUS_BPS);
        assert_eq!(result, Err(LendingError::HealthFactorSafe));
    }

    #[test]
    fn test_liquidation_higher_close_factor() {
        let pos = UserPosition {
            debt_shares: 20_000 * PRECISION,
            ..default_position()
        };
        let opp = liquidation_check(&pos, PRECISION, 8000, DEFAULT_LIQUIDATION_BONUS_BPS).unwrap();
        // debt_to_repay = 20000 * 8000/10000 = 16000
        assert_eq!(opp.debt_to_repay, 16_000 * PRECISION);
    }

    #[test]
    fn test_liquidation_higher_bonus() {
        let pos = UserPosition {
            debt_shares: 20_000 * PRECISION,
            ..default_position()
        };
        let opp = liquidation_check(&pos, PRECISION, DEFAULT_CLOSE_FACTOR_BPS, 1000).unwrap(); // 10% bonus
        // repay = 10000, seize_value = 10000 * 11000/10000 = 11000
        // seize_amount = 11000 / 2000 = 5.5 tokens
        let expected_seize = mul_div(11_000 * PRECISION, PRECISION, 2000 * PRECISION);
        assert_eq!(opp.collateral_to_seize, expected_seize);
    }

    #[test]
    fn test_liquidation_at_exactly_threshold() {
        // HF = exactly 1.0 means NOT liquidatable (>= check)
        let pos = UserPosition {
            debt_shares: 16_000 * PRECISION,
            ..default_position()
        };
        let hf = health_factor(&pos, PRECISION);
        assert_eq!(hf, PRECISION);
        let result = liquidation_check(&pos, PRECISION, DEFAULT_CLOSE_FACTOR_BPS, DEFAULT_LIQUIDATION_BONUS_BPS);
        assert_eq!(result, Err(LendingError::HealthFactorSafe));
    }

    // ============ Accrue Interest Tests ============

    #[test]
    fn test_accrue_interest_zero_elapsed() {
        let pool = default_pool();
        let accrued = accrue_interest(&pool, 100); // Same block
        assert_eq!(accrued.total_borrows, pool.total_borrows);
        assert_eq!(accrued.borrow_index, pool.borrow_index);
    }

    #[test]
    fn test_accrue_interest_past_block() {
        let pool = default_pool(); // last_accrual_block = 100
        let accrued = accrue_interest(&pool, 50); // Before last accrual
        assert_eq!(accrued.total_borrows, pool.total_borrows);
        assert_eq!(accrued.last_accrual_block, 100);
    }

    #[test]
    fn test_accrue_interest_normal() {
        let pool = default_pool();
        let accrued = accrue_interest(&pool, 200); // 100 blocks elapsed
        assert!(accrued.total_borrows > pool.total_borrows);
        assert!(accrued.borrow_index > pool.borrow_index);
        assert_eq!(accrued.last_accrual_block, 200);
    }

    #[test]
    fn test_accrue_interest_deposits_grow() {
        let pool = default_pool();
        let accrued = accrue_interest(&pool, 200);
        // Deposits should grow by (interest - protocol_share)
        assert!(accrued.total_deposits > pool.total_deposits);
    }

    #[test]
    fn test_accrue_interest_no_borrows() {
        let pool = LendingPool {
            total_borrows: 0,
            ..default_pool()
        };
        let accrued = accrue_interest(&pool, 200);
        assert_eq!(accrued.total_borrows, 0);
        assert_eq!(accrued.total_deposits, pool.total_deposits);
        assert_eq!(accrued.last_accrual_block, 200);
    }

    #[test]
    fn test_accrue_interest_large_gap() {
        let pool = default_pool();
        let accrued = accrue_interest(&pool, BLOCKS_PER_YEAR + 100);
        // After a full year, significant interest should have accrued
        assert!(accrued.total_borrows > pool.total_borrows);
        assert!(accrued.borrow_index > pool.borrow_index);
    }

    #[test]
    fn test_accrue_interest_index_grows_proportionally() {
        let pool = default_pool();
        let accrued1 = accrue_interest(&pool, 200);
        let accrued2 = accrue_interest(&pool, 300);
        // More blocks = higher index
        assert!(accrued2.borrow_index > accrued1.borrow_index);
    }

    // ============ Deposit/Share Tests ============

    #[test]
    fn test_deposit_to_shares_first_deposit() {
        let shares = deposit_to_shares(1000 * PRECISION, 0, 0);
        assert_eq!(shares, 1000 * PRECISION); // 1:1
    }

    #[test]
    fn test_deposit_to_shares_proportional() {
        // Pool has 1000 shares backing 2000 underlying (2:1 ratio)
        let shares = deposit_to_shares(500 * PRECISION, 1000 * PRECISION, 2000 * PRECISION);
        // 500 * 1000/2000 = 250
        assert_eq!(shares, 250 * PRECISION);
    }

    #[test]
    fn test_deposit_to_shares_zero_amount() {
        let shares = deposit_to_shares(0, 1000, 2000);
        assert_eq!(shares, 0);
    }

    #[test]
    fn test_deposit_to_shares_equal_ratio() {
        let shares = deposit_to_shares(100 * PRECISION, 1000 * PRECISION, 1000 * PRECISION);
        assert_eq!(shares, 100 * PRECISION); // 1:1 when shares == underlying
    }

    #[test]
    fn test_shares_to_underlying_normal() {
        // 250 shares, 1000 total shares, 2000 total underlying
        let underlying = shares_to_underlying(250 * PRECISION, 1000 * PRECISION, 2000 * PRECISION);
        assert_eq!(underlying, 500 * PRECISION);
    }

    #[test]
    fn test_shares_to_underlying_zero_shares() {
        let underlying = shares_to_underlying(0, 1000, 2000);
        assert_eq!(underlying, 0);
    }

    #[test]
    fn test_shares_to_underlying_zero_total_shares() {
        let underlying = shares_to_underlying(100, 0, 2000);
        assert_eq!(underlying, 0);
    }

    #[test]
    fn test_shares_to_underlying_all_shares() {
        let underlying = shares_to_underlying(1000 * PRECISION, 1000 * PRECISION, 2000 * PRECISION);
        assert_eq!(underlying, 2000 * PRECISION);
    }

    #[test]
    fn test_deposit_and_redeem_roundtrip() {
        let total_shares = 1000 * PRECISION;
        let total_underlying = 1500 * PRECISION;
        let deposit = 300 * PRECISION;

        let shares = deposit_to_shares(deposit, total_shares, total_underlying);
        let new_total_shares = total_shares + shares;
        let new_total_underlying = total_underlying + deposit;

        let redeemed = shares_to_underlying(shares, new_total_shares, new_total_underlying);
        // Should get back approximately the same amount (may lose 1 unit to rounding)
        assert!(redeemed <= deposit);
        assert!(deposit - redeemed <= 1);
    }

    // ============ Repayment Schedule Tests ============

    #[test]
    fn test_repayment_schedule_no_interest() {
        let schedule = repayment_schedule(
            100 * PRECISION, // debt_shares
            PRECISION,       // borrow_index (1.0)
            PRECISION,       // initial_index (1.0)
            0,               // per_block_rate
            0,               // blocks
        );
        assert_eq!(schedule.principal, 100 * PRECISION);
        assert_eq!(schedule.total_owed, 100 * PRECISION);
        assert_eq!(schedule.interest_accrued, 0);
    }

    #[test]
    fn test_repayment_schedule_with_interest() {
        // Index doubled means debt doubled
        let schedule = repayment_schedule(
            100 * PRECISION,     // debt_shares
            2 * PRECISION,       // borrow_index (2.0)
            PRECISION,           // initial_index (1.0)
            1_000_000,           // per_block_rate
            1000,                // blocks
        );
        assert_eq!(schedule.principal, 100 * PRECISION);
        assert_eq!(schedule.total_owed, 200 * PRECISION);
        assert_eq!(schedule.interest_accrued, 100 * PRECISION);
        assert_eq!(schedule.blocks_elapsed, 1000);
    }

    #[test]
    fn test_repayment_schedule_zero_blocks() {
        let schedule = repayment_schedule(
            100 * PRECISION,
            PRECISION * 11 / 10, // 1.1x index
            PRECISION,
            1_000_000,
            0,
        );
        assert_eq!(schedule.blocks_elapsed, 0);
        // Still shows interest from index growth
        assert!(schedule.interest_accrued > 0);
    }

    #[test]
    fn test_repayment_schedule_zero_initial_index() {
        let schedule = repayment_schedule(
            100 * PRECISION,
            PRECISION,
            0, // initial_index = 0
            0,
            100,
        );
        // When initial_index is 0, principal = debt_shares
        assert_eq!(schedule.principal, 100 * PRECISION);
    }

    #[test]
    fn test_repayment_per_block_interest() {
        let per_block = PRECISION / 1_000_000; // tiny rate
        let schedule = repayment_schedule(
            1000 * PRECISION,
            PRECISION,
            PRECISION,
            per_block,
            100,
        );
        // per_block_interest = total_owed * per_block_rate / PRECISION
        let expected = mul_div(1000 * PRECISION, per_block, PRECISION);
        assert_eq!(schedule.per_block_interest, expected);
    }

    // ============ Pool Summary Tests ============

    #[test]
    fn test_pool_summary_normal() {
        let pool = default_pool();
        let summary = pool_summary(&pool, 50, 20);
        assert_eq!(summary.tvl, pool.total_deposits);
        assert_eq!(summary.total_borrowed, pool.total_borrows);
        assert_eq!(summary.available_liquidity, pool.total_deposits - pool.total_borrows);
        assert_eq!(summary.utilization_bps, 5000);
        assert_eq!(summary.depositor_count, 50);
        assert_eq!(summary.borrower_count, 20);
    }

    #[test]
    fn test_pool_summary_empty() {
        let pool = LendingPool {
            total_deposits: 0,
            total_borrows: 0,
            ..default_pool()
        };
        let summary = pool_summary(&pool, 0, 0);
        assert_eq!(summary.tvl, 0);
        assert_eq!(summary.available_liquidity, 0);
        assert_eq!(summary.utilization_bps, 0);
    }

    #[test]
    fn test_pool_summary_fully_utilized() {
        let pool = LendingPool {
            total_deposits: 1000 * PRECISION,
            total_borrows: 1000 * PRECISION,
            ..default_pool()
        };
        let summary = pool_summary(&pool, 10, 10);
        assert_eq!(summary.available_liquidity, 0);
        assert_eq!(summary.utilization_bps, 10000);
    }

    // ============ Max Safe Borrow Tests ============

    #[test]
    fn test_max_safe_borrow_no_existing_debt() {
        let result = max_safe_borrow(10_000 * PRECISION, 7500, 0);
        // 10000 * 7500 / 10000 = 7500
        assert_eq!(result, 7_500 * PRECISION);
    }

    #[test]
    fn test_max_safe_borrow_with_existing_debt() {
        let result = max_safe_borrow(10_000 * PRECISION, 7500, 3_000 * PRECISION);
        // 7500 - 3000 = 4500
        assert_eq!(result, 4_500 * PRECISION);
    }

    #[test]
    fn test_max_safe_borrow_at_limit() {
        let result = max_safe_borrow(10_000 * PRECISION, 7500, 7_500 * PRECISION);
        assert_eq!(result, 0);
    }

    #[test]
    fn test_max_safe_borrow_over_limit() {
        let result = max_safe_borrow(10_000 * PRECISION, 7500, 8_000 * PRECISION);
        assert_eq!(result, 0); // Saturating sub
    }

    #[test]
    fn test_max_safe_borrow_zero_collateral() {
        let result = max_safe_borrow(0, 7500, 0);
        assert_eq!(result, 0);
    }

    #[test]
    fn test_max_safe_borrow_100_percent_factor() {
        let result = max_safe_borrow(10_000 * PRECISION, 10000, 0);
        assert_eq!(result, 10_000 * PRECISION);
    }

    // ============ Debt Value Tests ============

    #[test]
    fn test_debt_value_normal() {
        let dv = debt_value(100 * PRECISION, PRECISION, 2000 * PRECISION);
        // actual_debt = 100 * 1.0 = 100
        // value = 100 * 2000 = 200000
        assert_eq!(dv, 200_000 * PRECISION);
    }

    #[test]
    fn test_debt_value_zero_shares() {
        let dv = debt_value(0, PRECISION, 2000 * PRECISION);
        assert_eq!(dv, 0);
    }

    #[test]
    fn test_debt_value_zero_price() {
        let dv = debt_value(100 * PRECISION, PRECISION, 0);
        assert_eq!(dv, 0);
    }

    #[test]
    fn test_debt_value_with_index() {
        // Borrow index of 1.5 means debt grew 50%
        let dv = debt_value(100 * PRECISION, PRECISION * 15 / 10, PRECISION);
        // actual_debt = 100 * 1.5 = 150
        // value = 150 * 1 = 150
        assert_eq!(dv, 150 * PRECISION);
    }

    #[test]
    fn test_debt_value_high_price() {
        let dv = debt_value(1 * PRECISION, PRECISION, 50_000 * PRECISION);
        assert_eq!(dv, 50_000 * PRECISION);
    }

    // ============ Constants Tests ============

    #[test]
    fn test_min_health_factor_is_one() {
        assert_eq!(MIN_HEALTH_FACTOR, PRECISION);
    }

    #[test]
    fn test_safe_health_factor_is_one_point_five() {
        assert_eq!(SAFE_HEALTH_FACTOR, PRECISION * 15 / 10);
    }

    #[test]
    fn test_default_close_factor() {
        assert_eq!(DEFAULT_CLOSE_FACTOR_BPS, 5000);
    }

    #[test]
    fn test_default_liquidation_bonus() {
        assert_eq!(DEFAULT_LIQUIDATION_BONUS_BPS, 500);
    }

    #[test]
    fn test_bps_constant() {
        assert_eq!(BPS, 10_000);
    }

    // ============ Edge Case Tests ============

    #[test]
    fn test_utilization_rate_1_wei_deposit() {
        let pool = LendingPool {
            total_deposits: 1,
            total_borrows: 1,
            ..default_pool()
        };
        assert_eq!(utilization_rate(&pool), 10000);
    }

    #[test]
    fn test_borrow_rate_with_zero_base() {
        let pool = LendingPool {
            base_rate_bps: 0,
            ..default_pool()
        };
        let rate = borrow_rate_bps(&pool);
        // rate = 0 + 400 * 5000 / 8000 = 250
        assert_eq!(rate, 250);
    }

    #[test]
    fn test_health_factor_tiny_debt() {
        let pos = UserPosition {
            debt_shares: 1, // 1 wei of debt
            ..default_position()
        };
        let hf = health_factor(&pos, PRECISION);
        // Huge collateral vs tiny debt = very high HF
        assert!(hf > SAFE_HEALTH_FACTOR);
    }

    #[test]
    fn test_accrue_interest_preserves_shares() {
        let pool = default_pool();
        let accrued = accrue_interest(&pool, 1000);
        // Shares should never change from interest accrual
        assert_eq!(accrued.total_shares, pool.total_shares);
    }

    #[test]
    fn test_accrue_interest_preserves_rate_params() {
        let pool = default_pool();
        let accrued = accrue_interest(&pool, 1000);
        assert_eq!(accrued.base_rate_bps, pool.base_rate_bps);
        assert_eq!(accrued.slope1_bps, pool.slope1_bps);
        assert_eq!(accrued.slope2_bps, pool.slope2_bps);
        assert_eq!(accrued.optimal_utilization_bps, pool.optimal_utilization_bps);
        assert_eq!(accrued.reserve_factor_bps, pool.reserve_factor_bps);
    }

    #[test]
    fn test_liquidation_with_zero_bonus() {
        let pos = UserPosition {
            debt_shares: 20_000 * PRECISION,
            ..default_position()
        };
        let opp = liquidation_check(&pos, PRECISION, DEFAULT_CLOSE_FACTOR_BPS, 0).unwrap();
        // No bonus means seize value = repay value exactly
        assert_eq!(opp.profit, 0);
    }

    #[test]
    fn test_deposit_shares_with_interest_accrued() {
        // After interest, underlying > shares, so new deposits get fewer shares
        let shares = deposit_to_shares(100 * PRECISION, 1000 * PRECISION, 1200 * PRECISION);
        // 100 * 1000/1200 = 83.33...
        let expected = mul_div(100 * PRECISION, 1000 * PRECISION, 1200 * PRECISION);
        assert_eq!(shares, expected);
        assert!(shares < 100 * PRECISION);
    }

    #[test]
    fn test_supply_rate_always_less_than_borrow_rate() {
        let pool = default_pool();
        let br = borrow_rate_bps(&pool);
        let sr = supply_rate_bps(&pool);
        assert!(sr < br);
    }

    #[test]
    fn test_pool_summary_borrows_exceed_deposits() {
        // Edge case: borrows somehow exceed deposits (bad debt scenario)
        let pool = LendingPool {
            total_deposits: 100 * PRECISION,
            total_borrows: 200 * PRECISION,
            ..default_pool()
        };
        let summary = pool_summary(&pool, 1, 1);
        assert_eq!(summary.available_liquidity, 0); // Saturating sub
    }

    #[test]
    fn test_interest_rate_info_consistency() {
        let pool = default_pool();
        let info = interest_rate_info(&pool);
        assert_eq!(info.utilization_bps, utilization_rate(&pool));
        assert_eq!(info.borrow_rate_bps, borrow_rate_bps(&pool));
        assert_eq!(info.supply_rate_bps, supply_rate_bps(&pool));
    }

    #[test]
    fn test_health_factor_equal_prices() {
        let pos = UserPosition {
            collateral_price: PRECISION,
            debt_price: PRECISION,
            collateral_amount: 100 * PRECISION,
            debt_shares: 50 * PRECISION,
            liquidation_threshold_bps: 8000,
            ..default_position()
        };
        let hf = health_factor(&pos, PRECISION);
        // col_value = 100, adjusted = 80, debt_value = 50
        // hf = 80/50 = 1.6
        assert_eq!(hf, PRECISION * 16 / 10);
    }

    #[test]
    fn test_max_safe_borrow_low_factor() {
        let result = max_safe_borrow(10_000 * PRECISION, 100, 0); // 1% factor
        assert_eq!(result, 100 * PRECISION);
    }

    #[test]
    fn test_debt_value_fractional_index() {
        // Index at 1.0001 (tiny growth)
        let idx = PRECISION + PRECISION / 10_000;
        let dv = debt_value(10_000 * PRECISION, idx, PRECISION);
        // actual_debt = 10000 * 1.0001 = 10001
        let expected_debt = mul_div(10_000 * PRECISION, idx, PRECISION);
        let expected = mul_div(expected_debt, PRECISION, PRECISION);
        assert_eq!(dv, expected);
        assert!(dv > 10_000 * PRECISION);
    }

    #[test]
    fn test_borrow_capacity_utilization_bps_midrange() {
        let pos = UserPosition {
            debt_shares: 7_500 * PRECISION, // Half of max_borrow
            ..default_position()
        };
        let cap = borrow_capacity(&pos, PRECISION);
        // max = 15000, debt = 7500, util = 5000 bps
        assert_eq!(cap.utilization_bps, 5000);
    }

    // ============ Batch 6: Hardening — Edge Cases, Boundaries, Overflow ============

    #[test]
    fn test_utilization_rate_near_100_percent() {
        // Borrows just below deposits
        let pool = LendingPool {
            total_deposits: 1_000 * PRECISION,
            total_borrows: 999 * PRECISION,
            ..default_pool()
        };
        assert_eq!(utilization_rate(&pool), 9990);
    }

    #[test]
    fn test_utilization_rate_1_wei_borrow_large_deposit() {
        let pool = LendingPool {
            total_deposits: u128::MAX / 2,
            total_borrows: 1,
            ..default_pool()
        };
        // 1 * 10000 / (u128::MAX/2) == 0 in integer division
        assert_eq!(utilization_rate(&pool), 0);
    }

    #[test]
    fn test_borrow_rate_optimal_at_10000_bps() {
        // Edge: optimal = 10000 means the "above kink" branch has denom = 0
        let pool = LendingPool {
            total_deposits: 1_000 * PRECISION,
            total_borrows: 1_000 * PRECISION,
            optimal_utilization_bps: 10000,
            ..default_pool()
        };
        let rate = borrow_rate_bps(&pool);
        // util = 10000, optimal = 10000, so util <= optimal
        // rate = base + slope1 * 10000 / 10000 = 200 + 400 = 600
        assert_eq!(rate, 600);
    }

    #[test]
    fn test_borrow_rate_zero_slopes() {
        // Both slopes at zero — rate is always base rate
        let pool = LendingPool {
            slope1_bps: 0,
            slope2_bps: 0,
            ..default_pool()
        };
        let rate = borrow_rate_bps(&pool);
        assert_eq!(rate, 200); // Just base rate
    }

    #[test]
    fn test_supply_rate_100_percent_reserve_factor() {
        // 100% reserve factor — protocol takes all interest, suppliers earn zero
        let pool = LendingPool {
            reserve_factor_bps: 10000,
            ..default_pool()
        };
        let sr = supply_rate_bps(&pool);
        assert_eq!(sr, 0);
    }

    #[test]
    fn test_apy_from_apr_max_u16() {
        // APR at u16::MAX should not overflow and should cap at u16::MAX
        let apy = apy_from_apr_bps(u16::MAX);
        // apr = 65535, apr^2/(2*10000) = 65535*65535/20000 = 214_726
        // total = 65535 + 214726 > u16::MAX, so capped
        assert_eq!(apy, u16::MAX);
    }

    #[test]
    fn test_health_factor_zero_debt_price() {
        // If debt_price is zero, debt_value is zero, so HF = u128::MAX
        let pos = UserPosition {
            debt_price: 0,
            debt_shares: 5 * PRECISION,
            ..default_position()
        };
        let hf = health_factor(&pos, PRECISION);
        assert_eq!(hf, u128::MAX);
    }

    #[test]
    fn test_health_factor_zero_liquidation_threshold() {
        // LT = 0 means adjusted_col = 0, so HF = 0 if debt > 0
        let pos = UserPosition {
            liquidation_threshold_bps: 0,
            ..default_position()
        };
        let hf = health_factor(&pos, PRECISION);
        assert_eq!(hf, 0);
    }

    #[test]
    fn test_borrow_capacity_zero_collateral_factor() {
        // Collateral factor = 0 means max_borrow = 0 regardless of collateral
        let pos = UserPosition {
            collateral_factor_bps: 0,
            debt_shares: 0,
            ..default_position()
        };
        let cap = borrow_capacity(&pos, PRECISION);
        assert_eq!(cap.max_borrow_value, 0);
        assert_eq!(cap.remaining_capacity, 0);
    }

    #[test]
    fn test_borrow_capacity_100_percent_collateral_factor() {
        // 100% collateral factor
        let pos = UserPosition {
            collateral_factor_bps: 10000,
            debt_shares: 0,
            ..default_position()
        };
        let cap = borrow_capacity(&pos, PRECISION);
        // max_borrow = 10 * 2000 * 10000/10000 = 20000
        assert_eq!(cap.max_borrow_value, 20_000 * PRECISION);
    }

    #[test]
    fn test_liquidation_100_percent_close_factor() {
        // Close factor = 100% means liquidator repays all debt at once
        let pos = UserPosition {
            debt_shares: 20_000 * PRECISION,
            ..default_position()
        };
        let opp = liquidation_check(&pos, PRECISION, 10000, DEFAULT_LIQUIDATION_BONUS_BPS).unwrap();
        assert_eq!(opp.debt_to_repay, 20_000 * PRECISION);
    }

    #[test]
    fn test_liquidation_zero_close_factor() {
        // Close factor = 0 means nothing can be liquidated
        let pos = UserPosition {
            debt_shares: 20_000 * PRECISION,
            ..default_position()
        };
        let opp = liquidation_check(&pos, PRECISION, 0, DEFAULT_LIQUIDATION_BONUS_BPS).unwrap();
        assert_eq!(opp.debt_to_repay, 0);
        assert_eq!(opp.collateral_to_seize, 0);
    }

    #[test]
    fn test_accrue_interest_preserves_pool_id() {
        let pool = default_pool();
        let accrued = accrue_interest(&pool, 500);
        assert_eq!(accrued.pool_id, pool.pool_id);
    }

    #[test]
    fn test_accrue_interest_one_block() {
        let pool = default_pool();
        let accrued = accrue_interest(&pool, 101); // 1 block elapsed
        // Should accrue some tiny interest
        assert!(accrued.total_borrows > pool.total_borrows);
        assert!(accrued.borrow_index > pool.borrow_index);
    }

    #[test]
    fn test_deposit_to_shares_underlying_greater_than_shares() {
        // When underlying > shares, depositor gets fewer shares per token
        let shares = deposit_to_shares(100 * PRECISION, 500 * PRECISION, 1000 * PRECISION);
        // 100 * 500 / 1000 = 50
        assert_eq!(shares, 50 * PRECISION);
    }

    #[test]
    fn test_deposit_to_shares_shares_greater_than_underlying() {
        // Rare case: shares > underlying (deflation scenario)
        let shares = deposit_to_shares(100 * PRECISION, 2000 * PRECISION, 1000 * PRECISION);
        // 100 * 2000 / 1000 = 200
        assert_eq!(shares, 200 * PRECISION);
    }

    #[test]
    fn test_shares_to_underlying_single_share_all_underlying() {
        // 1 share out of 1 total, backed by huge underlying
        let underlying = shares_to_underlying(1 * PRECISION, 1 * PRECISION, 1_000_000 * PRECISION);
        assert_eq!(underlying, 1_000_000 * PRECISION);
    }

    #[test]
    fn test_repayment_schedule_high_index_growth() {
        // Index went from 1.0 to 10.0 — debt grew 10x
        let schedule = repayment_schedule(
            100 * PRECISION,
            10 * PRECISION,   // borrow_index = 10.0
            PRECISION,        // initial_index = 1.0
            0,
            1000,
        );
        assert_eq!(schedule.principal, 100 * PRECISION);
        assert_eq!(schedule.total_owed, 1000 * PRECISION);
        assert_eq!(schedule.interest_accrued, 900 * PRECISION);
    }

    #[test]
    fn test_pool_summary_single_depositor_single_borrower() {
        let pool = default_pool();
        let summary = pool_summary(&pool, 1, 1);
        assert_eq!(summary.depositor_count, 1);
        assert_eq!(summary.borrower_count, 1);
        assert!(summary.available_liquidity > 0);
    }

    #[test]
    fn test_max_safe_borrow_zero_collateral_factor() {
        let result = max_safe_borrow(10_000 * PRECISION, 0, 0);
        assert_eq!(result, 0);
    }

    #[test]
    fn test_debt_value_double_index() {
        // Borrow index 2x means actual debt is 2x shares
        let dv = debt_value(50 * PRECISION, 2 * PRECISION, 1000 * PRECISION);
        // actual_debt = 50 * 2 = 100
        // value = 100 * 1000 = 100_000
        assert_eq!(dv, 100_000 * PRECISION);
    }

    #[test]
    fn test_interest_rate_info_high_utilization() {
        let pool = LendingPool {
            total_deposits: 1_000 * PRECISION,
            total_borrows: 950 * PRECISION,
            ..default_pool()
        };
        let info = interest_rate_info(&pool);
        assert_eq!(info.utilization_bps, 9500);
        // Above optimal, so borrow rate is steep
        assert!(info.borrow_rate_bps > 600);
        assert!(info.borrow_apy_bps >= info.borrow_rate_bps);
    }

    #[test]
    fn test_borrow_capacity_with_higher_borrow_index() {
        // Higher borrow index inflates debt, reducing remaining capacity
        let pos = default_position(); // debt_shares = 5, debt_price = $1
        let cap_normal = borrow_capacity(&pos, PRECISION);
        let cap_inflated = borrow_capacity(&pos, 2 * PRECISION); // index doubled
        assert!(cap_inflated.remaining_capacity < cap_normal.remaining_capacity,
            "Higher borrow index should reduce borrow capacity");
        assert!(cap_inflated.utilization_bps > cap_normal.utilization_bps,
            "Higher borrow index should increase utilization");
    }

    #[test]
    fn test_liquidation_profit_increases_with_bonus() {
        let pos = UserPosition {
            debt_shares: 20_000 * PRECISION,
            ..default_position()
        };
        let opp_low = liquidation_check(&pos, PRECISION, DEFAULT_CLOSE_FACTOR_BPS, 100).unwrap();  // 1%
        let opp_high = liquidation_check(&pos, PRECISION, DEFAULT_CLOSE_FACTOR_BPS, 2000).unwrap(); // 20%
        assert!(opp_high.profit > opp_low.profit,
            "Higher bonus should yield higher profit");
    }

    // ============ Batch 7: Hardening to 145+ Tests ============

    #[test]
    fn test_utilization_rate_equal_deposits_and_borrows() {
        let pool = LendingPool {
            total_deposits: 7_777 * PRECISION,
            total_borrows: 7_777 * PRECISION,
            ..default_pool()
        };
        assert_eq!(utilization_rate(&pool), 10000);
    }

    #[test]
    fn test_utilization_rate_tiny_fraction() {
        let pool = LendingPool {
            total_deposits: 1_000_000 * PRECISION,
            total_borrows: 100 * PRECISION,
            ..default_pool()
        };
        // 100 / 1_000_000 * 10000 = 1
        assert_eq!(utilization_rate(&pool), 1);
    }

    #[test]
    fn test_borrow_rate_just_above_optimal() {
        let pool = LendingPool {
            total_deposits: 10_000 * PRECISION,
            total_borrows: 8_001 * PRECISION,
            optimal_utilization_bps: 8000,
            ..default_pool()
        };
        let rate = borrow_rate_bps(&pool);
        // util = 8001 (just above 8000), so above-kink branch
        // rate = 200 + 400 + slope2 * (8001-8000)/(10000-8000) = 600 + 30000*1/2000 = 615
        assert!(rate > 600, "Rate just above kink should exceed kink rate: {}", rate);
    }

    #[test]
    fn test_supply_rate_at_optimal_utilization() {
        let pool = LendingPool {
            total_deposits: 1_000 * PRECISION,
            total_borrows: 800 * PRECISION,
            ..default_pool()
        };
        let sr = supply_rate_bps(&pool);
        // br = 600, util = 8000, rf = 1000
        // supply = 600 * 8000 / 10000 * 9000 / 10000 = 480 * 9000 / 10000 = 432
        assert_eq!(sr, 432);
    }

    #[test]
    fn test_apy_from_apr_moderate() {
        // 50% APR = 5000 bps
        // apy = 5000 + 5000*5000/(2*10000) = 5000 + 1250 = 6250
        assert_eq!(apy_from_apr_bps(5000), 6250);
    }

    #[test]
    fn test_health_factor_with_triple_borrow_index() {
        let pos = default_position();
        let hf1 = health_factor(&pos, PRECISION);
        let hf3 = health_factor(&pos, 3 * PRECISION);
        // Tripled debt => HF should be 1/3
        assert_eq!(hf3, hf1 / 3);
    }

    #[test]
    fn test_health_factor_100_percent_lt() {
        // LT = 100% means adjusted = full collateral value
        let pos = UserPosition {
            liquidation_threshold_bps: 10000,
            debt_shares: 20_000 * PRECISION,
            ..default_position()
        };
        let hf = health_factor(&pos, PRECISION);
        // adjusted = 10 * 2000 = 20000, debt = 20000
        // hf = 20000/20000 = 1.0
        assert_eq!(hf, PRECISION);
    }

    #[test]
    fn test_borrow_capacity_partial_utilization() {
        let pos = UserPosition {
            debt_shares: 3_750 * PRECISION,
            ..default_position()
        };
        let cap = borrow_capacity(&pos, PRECISION);
        // max = 15000, debt = 3750, util = 3750*10000/15000 = 2500
        assert_eq!(cap.utilization_bps, 2500);
        assert_eq!(cap.remaining_capacity, 11_250 * PRECISION);
    }

    #[test]
    fn test_liquidation_barely_underwater() {
        // HF just below 1.0
        let pos = UserPosition {
            debt_shares: 16_001 * PRECISION,
            ..default_position()
        };
        let hf = health_factor(&pos, PRECISION);
        assert!(hf < PRECISION, "Should be just below 1.0");
        let result = liquidation_check(&pos, PRECISION, DEFAULT_CLOSE_FACTOR_BPS, DEFAULT_LIQUIDATION_BONUS_BPS);
        assert!(result.is_ok());
    }

    #[test]
    fn test_accrue_interest_deposit_growth_matches_protocol_split() {
        let pool = default_pool();
        let accrued = accrue_interest(&pool, 200);
        // interest = borrows_grew = accrued.total_borrows - pool.total_borrows
        let interest = accrued.total_borrows - pool.total_borrows;
        let protocol_share = mul_div(interest, pool.reserve_factor_bps as u128, BPS);
        let depositor_share = interest - protocol_share;
        // deposits should grow by depositor_share
        assert_eq!(accrued.total_deposits - pool.total_deposits, depositor_share);
    }

    #[test]
    fn test_accrue_interest_multiple_calls_equivalent() {
        // Two separate accruals should equal one combined accrual (approximately)
        let pool = default_pool();
        let combined = accrue_interest(&pool, 300); // 200 blocks
        let step1 = accrue_interest(&pool, 200);    // 100 blocks
        let step2 = accrue_interest(&step1, 300);    // another 100 blocks
        // The step2 result should have approximately the same total_borrows
        // They may differ slightly due to compounding within each step
        let diff = if combined.total_borrows > step2.total_borrows {
            combined.total_borrows - step2.total_borrows
        } else {
            step2.total_borrows - combined.total_borrows
        };
        assert!(diff < PRECISION, "Difference should be negligible: {}", diff);
    }

    #[test]
    fn test_deposit_to_shares_1_wei_deposit() {
        let shares = deposit_to_shares(1, 1_000 * PRECISION, 2_000 * PRECISION);
        // 1 * 1000P / 2000P = 0 (rounds down to 0)
        assert_eq!(shares, 0);
    }

    #[test]
    fn test_shares_to_underlying_1_wei_share() {
        let underlying = shares_to_underlying(1, 1_000 * PRECISION, 2_000 * PRECISION);
        // 1 * 2000P / 1000P = 2
        assert_eq!(underlying, 2);
    }

    #[test]
    fn test_repayment_schedule_huge_index_growth() {
        // Index went from 1.0 to 100.0 — debt grew 100x
        let schedule = repayment_schedule(
            10 * PRECISION,
            100 * PRECISION,
            PRECISION,
            0,
            5000,
        );
        assert_eq!(schedule.principal, 10 * PRECISION);
        assert_eq!(schedule.total_owed, 1000 * PRECISION);
        assert_eq!(schedule.interest_accrued, 990 * PRECISION);
    }

    #[test]
    fn test_pool_summary_large_numbers() {
        let pool = LendingPool {
            total_deposits: u128::MAX / 2,
            total_borrows: u128::MAX / 4,
            ..default_pool()
        };
        let summary = pool_summary(&pool, 1000, 500);
        assert_eq!(summary.tvl, pool.total_deposits);
        assert_eq!(summary.total_borrowed, pool.total_borrows);
        assert_eq!(summary.available_liquidity, pool.total_deposits - pool.total_borrows);
        // With very large u128 values, integer division may round down by 1 bps
        assert!(summary.utilization_bps >= 4999 && summary.utilization_bps <= 5000);
    }

    #[test]
    fn test_max_safe_borrow_exact_half_factor() {
        let result = max_safe_borrow(20_000 * PRECISION, 5000, 0);
        assert_eq!(result, 10_000 * PRECISION);
    }

    #[test]
    fn test_debt_value_with_small_index() {
        // Index at 0.5 (half) means actual debt is halved
        let dv = debt_value(100 * PRECISION, PRECISION / 2, PRECISION);
        assert_eq!(dv, 50 * PRECISION);
    }

    #[test]
    fn test_interest_rate_info_at_kink() {
        let pool = LendingPool {
            total_deposits: 1_000 * PRECISION,
            total_borrows: 800 * PRECISION,
            ..default_pool()
        };
        let info = interest_rate_info(&pool);
        assert_eq!(info.utilization_bps, 8000);
        assert_eq!(info.borrow_rate_bps, 600); // base + slope1
    }

    #[test]
    fn test_borrow_rate_near_100_percent_utilization() {
        let pool = LendingPool {
            total_deposits: 1_000 * PRECISION,
            total_borrows: 999 * PRECISION,
            ..default_pool()
        };
        let rate = borrow_rate_bps(&pool);
        // util = 9990, above optimal
        // excess = 9990 - 8000 = 1990
        // steep = 30000 * 1990 / 2000 = 29850
        // rate = 200 + 400 + 29850 = 30450
        assert_eq!(rate, 30450);
    }

    #[test]
    fn test_supply_rate_monotonically_increases_with_utilization() {
        let mut prev_sr = 0u16;
        for util_pct in [10, 30, 50, 70, 80, 90, 95, 100u128] {
            let borrows = util_pct * 10 * PRECISION;
            let pool = LendingPool {
                total_deposits: 1_000 * PRECISION,
                total_borrows: borrows,
                ..default_pool()
            };
            let sr = supply_rate_bps(&pool);
            assert!(sr >= prev_sr,
                "Supply rate should increase with utilization: at {}%, sr={}, prev={}",
                util_pct, sr, prev_sr);
            prev_sr = sr;
        }
    }

    #[test]
    fn test_health_factor_large_collateral_small_debt() {
        let pos = UserPosition {
            collateral_amount: 1_000_000 * PRECISION,
            debt_shares: 1,
            collateral_price: PRECISION,
            debt_price: PRECISION,
            ..default_position()
        };
        let hf = health_factor(&pos, PRECISION);
        // Enormous collateral vs tiny debt
        assert!(hf > 1_000_000 * PRECISION);
    }

    #[test]
    fn test_liquidation_with_max_bonus() {
        let pos = UserPosition {
            debt_shares: 20_000 * PRECISION,
            ..default_position()
        };
        // 100% bonus (10000 bps)
        let opp = liquidation_check(&pos, PRECISION, DEFAULT_CLOSE_FACTOR_BPS, 10000).unwrap();
        // seize_value = 10000 * 20000/10000 = 20000
        // seize_amount = 20000 / 2000 = 10 tokens
        // But capped at collateral = 10 tokens
        assert_eq!(opp.collateral_to_seize, 10 * PRECISION);
    }

    #[test]
    fn test_debt_value_zero_index() {
        let dv = debt_value(100 * PRECISION, 0, PRECISION);
        assert_eq!(dv, 0, "Zero borrow index should give zero debt value");
    }

    #[test]
    fn test_pool_summary_zero_borrowers() {
        let pool = LendingPool {
            total_borrows: 0,
            ..default_pool()
        };
        let summary = pool_summary(&pool, 100, 0);
        assert_eq!(summary.borrower_count, 0);
        assert_eq!(summary.available_liquidity, pool.total_deposits);
    }

    #[test]
    fn test_repayment_schedule_per_block_interest_zero_rate() {
        let schedule = repayment_schedule(
            100 * PRECISION,
            PRECISION,
            PRECISION,
            0,        // zero per_block_rate
            1000,
        );
        assert_eq!(schedule.per_block_interest, 0);
    }

    #[test]
    fn test_accrue_interest_zero_reserve_factor() {
        let pool = LendingPool {
            reserve_factor_bps: 0,
            ..default_pool()
        };
        let accrued = accrue_interest(&pool, 200);
        let interest = accrued.total_borrows - pool.total_borrows;
        // With 0% reserve factor, all interest goes to depositors
        assert_eq!(accrued.total_deposits - pool.total_deposits, interest);
    }

    #[test]
    fn test_deposit_to_shares_zero_underlying_first_deposit() {
        // total_shares > 0 but total_underlying = 0 should still return amount (first deposit path)
        let shares = deposit_to_shares(500, 0, 0);
        assert_eq!(shares, 500);
    }

    #[test]
    fn test_borrow_capacity_with_zero_debt_price() {
        let pos = UserPosition {
            debt_price: 0,
            ..default_position()
        };
        let cap = borrow_capacity(&pos, PRECISION);
        // debt_value = 0, so remaining = max_borrow
        assert_eq!(cap.current_debt_value, 0);
        assert_eq!(cap.remaining_capacity, cap.max_borrow_value);
    }

    #[test]
    fn test_liquidation_with_very_high_borrow_index() {
        // borrow_index = 10x, debt_shares = 2000 → actual_debt = 20000
        let pos = UserPosition {
            debt_shares: 2_000 * PRECISION,
            ..default_position()
        };
        let opp = liquidation_check(&pos, 10 * PRECISION, DEFAULT_CLOSE_FACTOR_BPS, DEFAULT_LIQUIDATION_BONUS_BPS).unwrap();
        // actual_debt = 2000 * 10 = 20000
        assert_eq!(opp.debt_to_repay, 10_000 * PRECISION);
    }

    #[test]
    fn test_interest_rate_info_zero_utilization_apy() {
        let pool = LendingPool {
            total_borrows: 0,
            ..default_pool()
        };
        let info = interest_rate_info(&pool);
        assert_eq!(info.supply_apy_bps, 0);
        // borrow_apy from base rate: apy = 200 + 200*200/20000 = 200+2 = 202
        assert_eq!(info.borrow_apy_bps, 202);
    }

    // ============ Hardening Round 5 — 25 new tests ============

    #[test]
    fn test_utilization_rate_75_percent_v5() {
        let pool = LendingPool {
            total_deposits: 1_000_000 * PRECISION,
            total_borrows: 750_000 * PRECISION,
            ..default_pool()
        };
        assert_eq!(utilization_rate(&pool), 7500);
    }

    #[test]
    fn test_utilization_rate_1_percent_v5() {
        let pool = LendingPool {
            total_deposits: 100_000_000 * PRECISION,
            total_borrows: 1_000_000 * PRECISION,
            ..default_pool()
        };
        assert_eq!(utilization_rate(&pool), 100);
    }

    #[test]
    fn test_borrow_rate_at_50_percent_utilization_v5() {
        let pool = default_pool(); // 50% utilization, optimal=80%
        let rate = borrow_rate_bps(&pool);
        // util=50, optimal=80: variable = 50 * 400 / 80 = 250
        // rate = 200 + 250 = 450
        assert_eq!(rate, 450);
    }

    #[test]
    fn test_supply_rate_always_lte_borrow_rate_v5() {
        for util_pct in [10u128, 30, 50, 70, 90, 95, 99] {
            let pool = LendingPool {
                total_deposits: 100 * PRECISION,
                total_borrows: util_pct * PRECISION,
                ..default_pool()
            };
            assert!(supply_rate_bps(&pool) <= borrow_rate_bps(&pool));
        }
    }

    #[test]
    fn test_health_factor_no_debt_returns_max_v5() {
        let pos = UserPosition {
            debt_shares: 0,
            ..default_position()
        };
        assert_eq!(health_factor(&pos, PRECISION), u128::MAX);
    }

    #[test]
    fn test_health_factor_decreases_with_more_debt_v5() {
        let pos1 = UserPosition {
            debt_shares: 5 * PRECISION,
            ..default_position()
        };
        let pos2 = UserPosition {
            debt_shares: 10 * PRECISION,
            ..default_position()
        };
        let hf1 = health_factor(&pos1, PRECISION);
        let hf2 = health_factor(&pos2, PRECISION);
        assert!(hf1 > hf2);
    }

    #[test]
    fn test_health_factor_increases_with_collateral_price_v5() {
        let pos1 = UserPosition {
            collateral_price: 1000 * PRECISION,
            ..default_position()
        };
        let pos2 = UserPosition {
            collateral_price: 3000 * PRECISION,
            ..default_position()
        };
        let hf1 = health_factor(&pos1, PRECISION);
        let hf2 = health_factor(&pos2, PRECISION);
        assert!(hf2 > hf1);
    }

    #[test]
    fn test_borrow_capacity_zero_when_fully_utilized_v5() {
        let pos = UserPosition {
            collateral_amount: 10 * PRECISION,
            collateral_price: 1000 * PRECISION,
            debt_shares: 10_000 * PRECISION, // debt > max borrow value
            debt_price: PRECISION,
            collateral_factor_bps: 7500,
            ..default_position()
        };
        let cap = borrow_capacity(&pos, PRECISION);
        assert_eq!(cap.remaining_capacity, 0);
    }

    #[test]
    fn test_borrow_capacity_full_when_no_debt_v5() {
        let pos = UserPosition {
            debt_shares: 0,
            ..default_position()
        };
        let cap = borrow_capacity(&pos, PRECISION);
        assert_eq!(cap.current_debt_value, 0);
        assert!(cap.remaining_capacity > 0);
        assert_eq!(cap.utilization_bps, 0);
    }

    #[test]
    fn test_liquidation_check_safe_position_returns_err_v5() {
        let pos = default_position(); // Should be safe
        let result = liquidation_check(&pos, PRECISION, 5000, 500);
        assert_eq!(result, Err(LendingError::HealthFactorSafe));
    }

    #[test]
    fn test_liquidation_check_underwater_returns_ok_v5() {
        let pos = UserPosition {
            collateral_amount: 1 * PRECISION,
            collateral_price: 100 * PRECISION,
            debt_shares: 200 * PRECISION, // debt > collateral
            debt_price: PRECISION,
            liquidation_threshold_bps: 8000,
            ..default_position()
        };
        let result = liquidation_check(&pos, PRECISION, 5000, 500);
        assert!(result.is_ok());
    }

    #[test]
    fn test_accrue_interest_updates_last_accrual_block_v5() {
        let pool = default_pool();
        let updated = accrue_interest(&pool, 200);
        assert_eq!(updated.last_accrual_block, 200);
    }

    #[test]
    fn test_accrue_interest_increases_total_borrows_v5() {
        let pool = default_pool();
        let updated = accrue_interest(&pool, 10_000); // Many blocks elapsed
        assert!(updated.total_borrows > pool.total_borrows);
    }

    #[test]
    fn test_accrue_interest_increases_borrow_index_v5() {
        let pool = default_pool();
        let updated = accrue_interest(&pool, 10_000);
        assert!(updated.borrow_index > pool.borrow_index);
    }

    #[test]
    fn test_deposit_to_shares_first_deposit_one_to_one_v5() {
        let shares = deposit_to_shares(1000, 0, 0);
        assert_eq!(shares, 1000);
    }

    #[test]
    fn test_deposit_to_shares_proportional_v5() {
        // Pool: 2000 shares, 4000 underlying -> 1:2 ratio
        let shares = deposit_to_shares(2000, 2000, 4000);
        assert_eq!(shares, 1000); // 2000 * 2000 / 4000 = 1000
    }

    #[test]
    fn test_shares_to_underlying_proportional_v5() {
        let underlying = shares_to_underlying(1000, 2000, 4000);
        assert_eq!(underlying, 2000); // 1000 * 4000 / 2000 = 2000
    }

    #[test]
    fn test_shares_to_underlying_zero_shares_v5() {
        let underlying = shares_to_underlying(0, 2000, 4000);
        assert_eq!(underlying, 0);
    }

    #[test]
    fn test_repayment_schedule_zero_blocks_no_interest_v5() {
        let schedule = repayment_schedule(1000, PRECISION, PRECISION, 0, 0);
        assert_eq!(schedule.blocks_elapsed, 0);
        assert_eq!(schedule.interest_accrued, 0);
        assert_eq!(schedule.total_owed, schedule.principal);
    }

    #[test]
    fn test_repayment_schedule_interest_grows_with_index_v5() {
        let s1 = repayment_schedule(1000 * PRECISION, PRECISION * 11 / 10, PRECISION, 100, 1000);
        let s2 = repayment_schedule(1000 * PRECISION, PRECISION * 12 / 10, PRECISION, 100, 1000);
        assert!(s2.interest_accrued > s1.interest_accrued);
    }

    #[test]
    fn test_pool_summary_available_liquidity_v5() {
        let pool = default_pool(); // 1M deposits, 500K borrows
        let summary = pool_summary(&pool, 10, 5);
        assert_eq!(summary.available_liquidity, 500_000 * PRECISION);
    }

    #[test]
    fn test_pool_summary_utilization_50_percent_v5() {
        let pool = default_pool();
        let summary = pool_summary(&pool, 10, 5);
        assert_eq!(summary.utilization_bps, 5000);
    }

    #[test]
    fn test_max_safe_borrow_no_debt_v5() {
        let max = max_safe_borrow(10_000 * PRECISION, 7500, 0);
        assert_eq!(max, 7_500 * PRECISION);
    }

    #[test]
    fn test_max_safe_borrow_at_limit_v5() {
        let max = max_safe_borrow(10_000 * PRECISION, 7500, 7_500 * PRECISION);
        assert_eq!(max, 0);
    }

    #[test]
    fn test_debt_value_scales_with_price_v5() {
        let dv1 = debt_value(1000 * PRECISION, PRECISION, 100 * PRECISION);
        let dv2 = debt_value(1000 * PRECISION, PRECISION, 200 * PRECISION);
        assert_eq!(dv2, dv1 * 2);
    }

    #[test]
    fn test_debt_value_scales_with_index_v5() {
        let dv1 = debt_value(1000 * PRECISION, PRECISION, PRECISION);
        let dv2 = debt_value(1000 * PRECISION, 2 * PRECISION, PRECISION);
        assert_eq!(dv2, dv1 * 2);
    }

    // ============ Hardening Round 7 ============

    #[test]
    fn test_utilization_rate_zero_deposits_h7() {
        let mut pool = default_pool();
        pool.total_deposits = 0;
        pool.total_borrows = 0;
        assert_eq!(utilization_rate(&pool), 0);
    }

    #[test]
    fn test_utilization_rate_100_percent_h7() {
        let mut pool = default_pool();
        pool.total_deposits = 1_000_000 * PRECISION;
        pool.total_borrows = 1_000_000 * PRECISION;
        assert_eq!(utilization_rate(&pool), 10_000);
    }

    #[test]
    fn test_borrow_rate_at_zero_utilization_h7() {
        let mut pool = default_pool();
        pool.total_borrows = 0;
        let rate = borrow_rate_bps(&pool);
        assert_eq!(rate, pool.base_rate_bps); // Just the base rate
    }

    #[test]
    fn test_borrow_rate_above_optimal_h7() {
        let mut pool = default_pool();
        pool.total_borrows = 900_000 * PRECISION; // 90% utilization, above 80% optimal
        let rate = borrow_rate_bps(&pool);
        assert!(rate > pool.base_rate_bps + pool.slope1_bps);
    }

    #[test]
    fn test_supply_rate_zero_borrows_h7() {
        let mut pool = default_pool();
        pool.total_borrows = 0;
        assert_eq!(supply_rate_bps(&pool), 0);
    }

    #[test]
    fn test_supply_rate_less_than_borrow_rate_h7() {
        let pool = default_pool();
        let sr = supply_rate_bps(&pool);
        let br = borrow_rate_bps(&pool);
        assert!(sr < br);
    }

    #[test]
    fn test_interest_rate_info_consistent_h7() {
        let pool = default_pool();
        let info = interest_rate_info(&pool);
        assert_eq!(info.utilization_bps, utilization_rate(&pool));
        assert_eq!(info.borrow_rate_bps, borrow_rate_bps(&pool));
        assert_eq!(info.supply_rate_bps, supply_rate_bps(&pool));
    }

    #[test]
    fn test_health_factor_no_debt_h7() {
        let mut pos = default_position();
        pos.debt_shares = 0;
        assert_eq!(health_factor(&pos, PRECISION), u128::MAX);
    }

    #[test]
    fn test_health_factor_zero_collateral_price_h7() {
        let mut pos = default_position();
        pos.collateral_price = 0;
        let hf = health_factor(&pos, PRECISION);
        assert_eq!(hf, 0);
    }

    #[test]
    fn test_borrow_capacity_no_debt_h7() {
        let mut pos = default_position();
        pos.debt_shares = 0;
        let cap = borrow_capacity(&pos, PRECISION);
        assert_eq!(cap.current_debt_value, 0);
        assert!(cap.remaining_capacity > 0);
        assert_eq!(cap.utilization_bps, 0);
    }

    #[test]
    fn test_borrow_capacity_max_utilization_h7() {
        let pos = default_position();
        // With default position: collateral=10*PREC, price=2000*PREC, CF=75%
        // max_borrow_value = 10*2000*7500/10000 = 15000
        let cap = borrow_capacity(&pos, PRECISION);
        assert!(cap.max_borrow_value > 0);
    }

    #[test]
    fn test_liquidation_check_safe_position_h7() {
        let pos = default_position();
        let res = liquidation_check(&pos, PRECISION, 5000, 500);
        assert_eq!(res, Err(LendingError::HealthFactorSafe));
    }

    #[test]
    fn test_liquidation_check_no_debt_h7() {
        let mut pos = default_position();
        pos.debt_shares = 0;
        let res = liquidation_check(&pos, PRECISION, 5000, 500);
        assert_eq!(res, Err(LendingError::HealthFactorSafe)); // HF=MAX
    }

    #[test]
    fn test_accrue_interest_no_borrows_h7() {
        let mut pool = default_pool();
        pool.total_borrows = 0;
        let updated = accrue_interest(&pool, 200);
        assert_eq!(updated.total_borrows, 0);
        assert_eq!(updated.borrow_index, PRECISION);
    }

    #[test]
    fn test_accrue_interest_same_block_h7() {
        let pool = default_pool();
        let updated = accrue_interest(&pool, pool.last_accrual_block);
        assert_eq!(updated.total_borrows, pool.total_borrows);
    }

    #[test]
    fn test_accrue_interest_increases_borrows_h7() {
        let pool = default_pool();
        let updated = accrue_interest(&pool, pool.last_accrual_block + 1000);
        assert!(updated.total_borrows > pool.total_borrows);
        assert!(updated.borrow_index > pool.borrow_index);
    }

    #[test]
    fn test_deposit_to_shares_first_deposit_h7() {
        let shares = deposit_to_shares(1000 * PRECISION, 0, 0);
        assert_eq!(shares, 1000 * PRECISION);
    }

    #[test]
    fn test_deposit_to_shares_zero_amount_h7() {
        let shares = deposit_to_shares(0, 1000 * PRECISION, 1000 * PRECISION);
        assert_eq!(shares, 0);
    }

    #[test]
    fn test_deposit_to_shares_proportional_h7() {
        let shares = deposit_to_shares(500 * PRECISION, 1000 * PRECISION, 2000 * PRECISION);
        // shares = 500 * 1000 / 2000 = 250
        assert_eq!(shares, 250 * PRECISION);
    }

    #[test]
    fn test_shares_to_underlying_zero_h7() {
        assert_eq!(shares_to_underlying(0, 1000, 2000), 0);
    }

    #[test]
    fn test_shares_to_underlying_round_trip_h7() {
        let total_shares = 1000 * PRECISION;
        let total_underlying = 2000 * PRECISION;
        let deposit_amount = 500 * PRECISION;
        let shares = deposit_to_shares(deposit_amount, total_shares, total_underlying);
        let back = shares_to_underlying(shares, total_shares, total_underlying);
        assert_eq!(back, deposit_amount);
    }

    #[test]
    fn test_repayment_schedule_zero_blocks_h7() {
        let schedule = repayment_schedule(1000 * PRECISION, PRECISION, PRECISION, 0, 0);
        assert_eq!(schedule.blocks_elapsed, 0);
        assert_eq!(schedule.interest_accrued, 0);
    }

    #[test]
    fn test_max_safe_borrow_over_limit_h7() {
        let max = max_safe_borrow(10_000 * PRECISION, 7500, 10_000 * PRECISION);
        assert_eq!(max, 0); // debt exceeds max
    }

    #[test]
    fn test_debt_value_zero_shares_h7() {
        let dv = debt_value(0, PRECISION, 100 * PRECISION);
        assert_eq!(dv, 0);
    }

    #[test]
    fn test_pool_summary_zero_borrows_h7() {
        let mut pool = default_pool();
        pool.total_borrows = 0;
        let summary = pool_summary(&pool, 5, 0);
        assert_eq!(summary.available_liquidity, pool.total_deposits);
        assert_eq!(summary.utilization_bps, 0);
    }
}
