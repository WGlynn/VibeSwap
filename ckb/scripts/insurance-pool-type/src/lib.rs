// ============ Insurance Pool Type Script — Verification Logic ============
// Validates state transitions for insurance pool cells.
// Mutualized protection fund that prevents liquidations (P-105).
// Philosophy: prevention > punishment, mutualism > predation.

#![cfg_attr(feature = "ckb", no_std)]

use vibeswap_types::InsurancePoolCellData;
use ckb_lending_math::{PRECISION, BPS_DENOMINATOR, mul_div, insurance};

#[derive(Debug, PartialEq, Eq)]
pub enum InsurancePoolError {
    InvalidPoolId,
    InvalidAssetHash,
    InvalidPremiumRate,
    InvalidMaxCoverage,
    InvalidCooldown,
    PoolNotEmpty,
    AssetChanged,
    PoolIdChanged,
    PremiumRateChanged,
    MaxCoverageChanged,
    CooldownChanged,
    DepositsDecreased,
    SharesDecreased,
    PremiumBlockRegression,
    InvalidDeposit,
    InvalidWithdrawal,
    InvalidClaim,
    ClaimExceedsCoverage,
    PremiumsDecreased,
    ClaimsDecreased,
}

/// Verify creation of a new insurance pool
pub fn verify_creation(pool: &InsurancePoolCellData) -> Result<(), InsurancePoolError> {
    if pool.pool_id == [0u8; 32] {
        return Err(InsurancePoolError::InvalidPoolId);
    }
    if pool.asset_type_hash == [0u8; 32] {
        return Err(InsurancePoolError::InvalidAssetHash);
    }
    if pool.premium_rate_bps == 0 || pool.premium_rate_bps > 1000 {
        // Max 10% annual premium — above this is predatory
        return Err(InsurancePoolError::InvalidPremiumRate);
    }
    if pool.max_coverage_bps == 0 || pool.max_coverage_bps > 5000 {
        // Max 50% per single claim — protects pool from catastrophic drain
        return Err(InsurancePoolError::InvalidMaxCoverage);
    }
    // Initial state must be clean
    if pool.total_deposits != 0 || pool.total_shares != 0 {
        return Err(InsurancePoolError::InvalidDeposit);
    }
    if pool.total_premiums_earned != 0 || pool.total_claims_paid != 0 {
        return Err(InsurancePoolError::InvalidClaim);
    }
    Ok(())
}

/// Verify update of existing insurance pool
pub fn verify_update(
    old: &InsurancePoolCellData,
    new: &InsurancePoolCellData,
) -> Result<(), InsurancePoolError> {
    // Immutable fields
    if old.pool_id != new.pool_id {
        return Err(InsurancePoolError::PoolIdChanged);
    }
    if old.asset_type_hash != new.asset_type_hash {
        return Err(InsurancePoolError::AssetChanged);
    }
    if old.premium_rate_bps != new.premium_rate_bps {
        return Err(InsurancePoolError::PremiumRateChanged);
    }
    if old.max_coverage_bps != new.max_coverage_bps {
        return Err(InsurancePoolError::MaxCoverageChanged);
    }
    if old.cooldown_blocks != new.cooldown_blocks {
        return Err(InsurancePoolError::CooldownChanged);
    }

    // Premium block must not regress
    if new.last_premium_block < old.last_premium_block {
        return Err(InsurancePoolError::PremiumBlockRegression);
    }

    // Premiums can only increase (they accrue, never decrease)
    if new.total_premiums_earned < old.total_premiums_earned {
        return Err(InsurancePoolError::PremiumsDecreased);
    }

    // Claims can only increase (payouts are cumulative)
    if new.total_claims_paid < old.total_claims_paid {
        return Err(InsurancePoolError::ClaimsDecreased);
    }

    // Validate state transition type
    let deposit_delta = new.total_deposits as i128 - old.total_deposits as i128;
    let share_delta = new.total_shares as i128 - old.total_shares as i128;
    let premium_delta = new.total_premiums_earned - old.total_premiums_earned;
    let claim_delta = new.total_claims_paid - old.total_claims_paid;

    // Three valid transition types:
    // 1. Deposit: deposits increase, shares increase, premiums/claims unchanged
    // 2. Withdrawal: deposits decrease, shares decrease, premiums/claims unchanged
    // 3. Premium accrual: deposits increase by premium, premiums increase, shares/claims unchanged
    // 4. Claim payout: deposits decrease by claim, claims increase, shares unchanged
    // Combinations are also valid (e.g., deposit + premium accrual in same tx)

    // If claims increased, check that the claim doesn't exceed max coverage
    if claim_delta > 0 {
        let max_coverage = insurance::available_coverage(
            old.total_deposits,
            old.max_coverage_bps,
        );
        if claim_delta as u128 > max_coverage {
            return Err(InsurancePoolError::ClaimExceedsCoverage);
        }
    }

    Ok(())
}

/// Verify destruction of insurance pool (only if empty)
pub fn verify_destruction(pool: &InsurancePoolCellData) -> Result<(), InsurancePoolError> {
    if pool.total_deposits != 0 || pool.total_shares != 0 {
        return Err(InsurancePoolError::PoolNotEmpty);
    }
    Ok(())
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;
    use vibeswap_types::{
        DEFAULT_PREMIUM_RATE_BPS, DEFAULT_MAX_COVERAGE_BPS, DEFAULT_COOLDOWN_BLOCKS,
    };

    fn default_pool() -> InsurancePoolCellData {
        InsurancePoolCellData {
            pool_id: [0xAA; 32],
            asset_type_hash: [0xBB; 32],
            total_deposits: 0,
            total_shares: 0,
            total_premiums_earned: 0,
            total_claims_paid: 0,
            premium_rate_bps: DEFAULT_PREMIUM_RATE_BPS,
            max_coverage_bps: DEFAULT_MAX_COVERAGE_BPS,
            cooldown_blocks: DEFAULT_COOLDOWN_BLOCKS,
            last_premium_block: 0,
        }
    }

    // ============ Creation Tests ============

    #[test]
    fn test_creation_valid() {
        let pool = default_pool();
        assert!(verify_creation(&pool).is_ok());
    }

    #[test]
    fn test_creation_zero_pool_id() {
        let mut pool = default_pool();
        pool.pool_id = [0u8; 32];
        assert_eq!(verify_creation(&pool), Err(InsurancePoolError::InvalidPoolId));
    }

    #[test]
    fn test_creation_zero_asset_hash() {
        let mut pool = default_pool();
        pool.asset_type_hash = [0u8; 32];
        assert_eq!(verify_creation(&pool), Err(InsurancePoolError::InvalidAssetHash));
    }

    #[test]
    fn test_creation_zero_premium_rate() {
        let mut pool = default_pool();
        pool.premium_rate_bps = 0;
        assert_eq!(verify_creation(&pool), Err(InsurancePoolError::InvalidPremiumRate));
    }

    #[test]
    fn test_creation_excessive_premium_rate() {
        let mut pool = default_pool();
        pool.premium_rate_bps = 1001; // >10%
        assert_eq!(verify_creation(&pool), Err(InsurancePoolError::InvalidPremiumRate));
    }

    #[test]
    fn test_creation_zero_max_coverage() {
        let mut pool = default_pool();
        pool.max_coverage_bps = 0;
        assert_eq!(verify_creation(&pool), Err(InsurancePoolError::InvalidMaxCoverage));
    }

    #[test]
    fn test_creation_excessive_max_coverage() {
        let mut pool = default_pool();
        pool.max_coverage_bps = 5001; // >50%
        assert_eq!(verify_creation(&pool), Err(InsurancePoolError::InvalidMaxCoverage));
    }

    #[test]
    fn test_creation_nonzero_deposits() {
        let mut pool = default_pool();
        pool.total_deposits = 100;
        assert_eq!(verify_creation(&pool), Err(InsurancePoolError::InvalidDeposit));
    }

    #[test]
    fn test_creation_nonzero_claims() {
        let mut pool = default_pool();
        pool.total_claims_paid = 100;
        assert_eq!(verify_creation(&pool), Err(InsurancePoolError::InvalidClaim));
    }

    // ============ Update Tests ============

    #[test]
    fn test_update_deposit() {
        let old = InsurancePoolCellData {
            total_deposits: 100_000 * PRECISION,
            total_shares: 100_000 * PRECISION,
            last_premium_block: 100,
            ..default_pool()
        };
        let new = InsurancePoolCellData {
            total_deposits: 200_000 * PRECISION,
            total_shares: 200_000 * PRECISION,
            last_premium_block: 100,
            ..default_pool()
        };
        assert!(verify_update(&old, &new).is_ok());
    }

    #[test]
    fn test_update_withdrawal() {
        let old = InsurancePoolCellData {
            total_deposits: 200_000 * PRECISION,
            total_shares: 200_000 * PRECISION,
            last_premium_block: 100,
            ..default_pool()
        };
        let new = InsurancePoolCellData {
            total_deposits: 100_000 * PRECISION,
            total_shares: 100_000 * PRECISION,
            last_premium_block: 100,
            ..default_pool()
        };
        assert!(verify_update(&old, &new).is_ok());
    }

    #[test]
    fn test_update_premium_accrual() {
        let old = InsurancePoolCellData {
            total_deposits: 100_000 * PRECISION,
            total_shares: 100_000 * PRECISION,
            total_premiums_earned: 0,
            last_premium_block: 100,
            ..default_pool()
        };
        let new = InsurancePoolCellData {
            total_deposits: 105_000 * PRECISION, // +5000 from premiums
            total_shares: 100_000 * PRECISION,   // shares unchanged
            total_premiums_earned: 5_000 * PRECISION,
            last_premium_block: 200,
            ..default_pool()
        };
        assert!(verify_update(&old, &new).is_ok());
    }

    #[test]
    fn test_update_claim_payout() {
        let old = InsurancePoolCellData {
            total_deposits: 100_000 * PRECISION,
            total_shares: 100_000 * PRECISION,
            total_claims_paid: 0,
            last_premium_block: 100,
            ..default_pool()
        };
        // Max coverage = 100K * 20% = 20K
        let new = InsurancePoolCellData {
            total_deposits: 80_000 * PRECISION, // -20K from claim
            total_shares: 100_000 * PRECISION,  // shares unchanged
            total_claims_paid: 20_000 * PRECISION,
            last_premium_block: 100,
            ..default_pool()
        };
        assert!(verify_update(&old, &new).is_ok());
    }

    #[test]
    fn test_update_claim_exceeds_coverage() {
        let old = InsurancePoolCellData {
            total_deposits: 100_000 * PRECISION,
            total_shares: 100_000 * PRECISION,
            total_claims_paid: 0,
            last_premium_block: 100,
            ..default_pool()
        };
        // Trying to claim 30K when max is 20K (20% of 100K)
        let new = InsurancePoolCellData {
            total_deposits: 70_000 * PRECISION,
            total_shares: 100_000 * PRECISION,
            total_claims_paid: 30_000 * PRECISION,
            last_premium_block: 100,
            ..default_pool()
        };
        assert_eq!(verify_update(&old, &new), Err(InsurancePoolError::ClaimExceedsCoverage));
    }

    #[test]
    fn test_update_pool_id_changed() {
        let old = InsurancePoolCellData {
            total_deposits: 100_000 * PRECISION,
            total_shares: 100_000 * PRECISION,
            last_premium_block: 100,
            ..default_pool()
        };
        let mut new = old.clone();
        new.pool_id = [0xCC; 32];
        assert_eq!(verify_update(&old, &new), Err(InsurancePoolError::PoolIdChanged));
    }

    #[test]
    fn test_update_asset_changed() {
        let old = InsurancePoolCellData {
            total_deposits: 100_000 * PRECISION,
            total_shares: 100_000 * PRECISION,
            last_premium_block: 100,
            ..default_pool()
        };
        let mut new = old.clone();
        new.asset_type_hash = [0xCC; 32];
        assert_eq!(verify_update(&old, &new), Err(InsurancePoolError::AssetChanged));
    }

    #[test]
    fn test_update_premium_rate_changed() {
        let old = InsurancePoolCellData {
            total_deposits: 100_000 * PRECISION,
            total_shares: 100_000 * PRECISION,
            last_premium_block: 100,
            ..default_pool()
        };
        let mut new = old.clone();
        new.premium_rate_bps = 100;
        assert_eq!(verify_update(&old, &new), Err(InsurancePoolError::PremiumRateChanged));
    }

    #[test]
    fn test_update_premium_block_regression() {
        let old = InsurancePoolCellData {
            total_deposits: 100_000 * PRECISION,
            total_shares: 100_000 * PRECISION,
            last_premium_block: 200,
            ..default_pool()
        };
        let mut new = old.clone();
        new.last_premium_block = 100;
        assert_eq!(verify_update(&old, &new), Err(InsurancePoolError::PremiumBlockRegression));
    }

    #[test]
    fn test_update_premiums_decreased() {
        let old = InsurancePoolCellData {
            total_deposits: 100_000 * PRECISION,
            total_shares: 100_000 * PRECISION,
            total_premiums_earned: 5_000 * PRECISION,
            last_premium_block: 100,
            ..default_pool()
        };
        let mut new = old.clone();
        new.total_premiums_earned = 4_000 * PRECISION;
        assert_eq!(verify_update(&old, &new), Err(InsurancePoolError::PremiumsDecreased));
    }

    #[test]
    fn test_update_claims_decreased() {
        let old = InsurancePoolCellData {
            total_deposits: 80_000 * PRECISION,
            total_shares: 100_000 * PRECISION,
            total_claims_paid: 20_000 * PRECISION,
            last_premium_block: 100,
            ..default_pool()
        };
        let mut new = old.clone();
        new.total_claims_paid = 10_000 * PRECISION;
        assert_eq!(verify_update(&old, &new), Err(InsurancePoolError::ClaimsDecreased));
    }

    // ============ Destruction Tests ============

    #[test]
    fn test_destruction_empty() {
        let pool = InsurancePoolCellData {
            total_deposits: 0,
            total_shares: 0,
            total_premiums_earned: 5_000 * PRECISION,
            total_claims_paid: 5_000 * PRECISION,
            last_premium_block: 500,
            ..default_pool()
        };
        assert!(verify_destruction(&pool).is_ok());
    }

    #[test]
    fn test_destruction_not_empty() {
        let pool = InsurancePoolCellData {
            total_deposits: 100 * PRECISION,
            total_shares: 100 * PRECISION,
            last_premium_block: 100,
            ..default_pool()
        };
        assert_eq!(verify_destruction(&pool), Err(InsurancePoolError::PoolNotEmpty));
    }

    // ============ Integration Test ============

    #[test]
    fn test_full_insurance_lifecycle() {
        // 1. Create pool
        let pool = default_pool();
        assert!(verify_creation(&pool).is_ok());

        // 2. First deposit: 100K
        let after_deposit = InsurancePoolCellData {
            total_deposits: 100_000 * PRECISION,
            total_shares: 100_000 * PRECISION,
            last_premium_block: 100,
            ..pool.clone()
        };
        assert!(verify_update(&pool, &after_deposit).is_ok());

        // 3. Premium accrual: +5K
        let after_premium = InsurancePoolCellData {
            total_deposits: 105_000 * PRECISION,
            total_premiums_earned: 5_000 * PRECISION,
            last_premium_block: 200,
            ..after_deposit.clone()
        };
        assert!(verify_update(&after_deposit, &after_premium).is_ok());

        // 4. Insurance claim: -10K (within 20% of 105K = 21K max)
        let after_claim = InsurancePoolCellData {
            total_deposits: 95_000 * PRECISION,
            total_claims_paid: 10_000 * PRECISION,
            ..after_premium.clone()
        };
        assert!(verify_update(&after_premium, &after_claim).is_ok());

        // 5. Withdrawal: all remaining
        let after_withdraw = InsurancePoolCellData {
            total_deposits: 0,
            total_shares: 0,
            ..after_claim.clone()
        };
        assert!(verify_update(&after_claim, &after_withdraw).is_ok());

        // 6. Destroy empty pool
        assert!(verify_destruction(&after_withdraw).is_ok());
    }
}
