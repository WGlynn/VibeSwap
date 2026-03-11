// ============ Insurance Pool Integration Tests ============
// End-to-end tests for the mutualist insurance pool (P-105/P-106).
// Tests the full lifecycle: create → deposit → premium → claim → withdraw → destroy.

use vibeswap_sdk::*;
use vibeswap_types::*;
use insurance_pool_type::{verify_creation, verify_update, verify_destruction};
use ckb_lending_math::{PRECISION, BLOCKS_PER_YEAR, mul_div, insurance, prevention};

fn test_sdk() -> VibeSwapSDK {
    VibeSwapSDK::new(DeploymentInfo {
        pow_lock_code_hash: [0x01; 32],
        batch_auction_type_code_hash: [0x02; 32],
        commit_type_code_hash: [0x03; 32],
        amm_pool_type_code_hash: [0x04; 32],
        lp_position_type_code_hash: [0x05; 32],
        compliance_type_code_hash: [0x06; 32],
        config_type_code_hash: [0x07; 32],
        oracle_type_code_hash: [0x08; 32],
        knowledge_type_code_hash: [0x09; 32],
        lending_pool_type_code_hash: [0x0A; 32],
        vault_type_code_hash: [0x0B; 32],
        insurance_pool_type_code_hash: [0x0C; 32],
        prediction_market_type_code_hash: [0x0D; 32],
            prediction_position_type_code_hash: [0x0E; 32],
        script_dep_tx_hash: [0x10; 32],
        script_dep_index: 0,
    })
}

fn test_lock(id: u8) -> Script {
    Script {
        code_hash: [id; 32],
        hash_type: HashType::Type,
        args: vec![id; 20],
    }
}

fn test_input(id: u8) -> CellInput {
    CellInput {
        tx_hash: [id; 32],
        index: 0,
        since: 0,
    }
}

fn default_insurance_pool() -> InsurancePoolCellData {
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

// ============ SDK Builder Tests ============

#[test]
fn test_create_insurance_pool_sdk() {
    let sdk = test_sdk();
    let tx = sdk.create_insurance_pool(
        [0xAA; 32],
        [0xBB; 32],
        DEFAULT_PREMIUM_RATE_BPS,
        DEFAULT_MAX_COVERAGE_BPS,
        DEFAULT_COOLDOWN_BLOCKS,
        test_lock(0x01),
        test_input(0x01),
    ).unwrap();

    assert_eq!(tx.inputs.len(), 1);
    assert_eq!(tx.outputs.len(), 1);
    assert_eq!(tx.witnesses.len(), 1);

    // Verify the output data is a valid InsurancePoolCellData
    let pool_data = InsurancePoolCellData::deserialize(&tx.outputs[0].data).unwrap();
    assert_eq!(pool_data.pool_id, [0xAA; 32]);
    assert_eq!(pool_data.asset_type_hash, [0xBB; 32]);
    assert_eq!(pool_data.total_deposits, 0);
    assert_eq!(pool_data.total_shares, 0);
    assert_eq!(pool_data.premium_rate_bps, DEFAULT_PREMIUM_RATE_BPS);

    // Type script validation
    assert!(verify_creation(&pool_data).is_ok());
}

#[test]
fn test_deposit_insurance_sdk() {
    let sdk = test_sdk();
    let pool = InsurancePoolCellData {
        total_deposits: 100_000 * PRECISION,
        total_shares: 100_000 * PRECISION,
        last_premium_block: 100,
        ..default_insurance_pool()
    };

    let tx = sdk.deposit_insurance(
        test_input(0x01),
        &pool,
        50_000 * PRECISION,
        test_lock(0x02),
        test_input(0x02),
        200,
    ).unwrap();

    assert_eq!(tx.inputs.len(), 2); // pool + depositor
    assert_eq!(tx.outputs.len(), 2); // pool + change

    let new_pool = InsurancePoolCellData::deserialize(&tx.outputs[0].data).unwrap();
    assert_eq!(new_pool.total_deposits, 150_000 * PRECISION);
    assert_eq!(new_pool.total_shares, 150_000 * PRECISION); // 1:1 since no premiums yet

    // Validate state transition
    assert!(verify_update(&pool, &new_pool).is_ok());
}

#[test]
fn test_deposit_insurance_with_premiums_accrued() {
    let sdk = test_sdk();
    // Pool has accrued premiums: 100K shares for 110K deposits (10% premium)
    let pool = InsurancePoolCellData {
        total_deposits: 110_000 * PRECISION,
        total_shares: 100_000 * PRECISION,
        total_premiums_earned: 10_000 * PRECISION,
        last_premium_block: 100,
        ..default_insurance_pool()
    };

    let tx = sdk.deposit_insurance(
        test_input(0x01),
        &pool,
        11_000 * PRECISION, // deposit 11K
        test_lock(0x02),
        test_input(0x02),
        200,
    ).unwrap();

    let new_pool = InsurancePoolCellData::deserialize(&tx.outputs[0].data).unwrap();
    // 11K * 100K/110K = 10K shares (proportional)
    let expected_shares = mul_div(11_000 * PRECISION, 100_000 * PRECISION, 110_000 * PRECISION);
    assert_eq!(new_pool.total_shares, 100_000 * PRECISION + expected_shares);
    assert_eq!(new_pool.total_deposits, 121_000 * PRECISION);
}

#[test]
fn test_deposit_insurance_zero_amount_rejected() {
    let sdk = test_sdk();
    let pool = InsurancePoolCellData {
        total_deposits: 100_000 * PRECISION,
        total_shares: 100_000 * PRECISION,
        last_premium_block: 100,
        ..default_insurance_pool()
    };

    let result = sdk.deposit_insurance(
        test_input(0x01),
        &pool,
        0, // zero deposit
        test_lock(0x02),
        test_input(0x02),
        200,
    );
    assert!(result.is_err());
}

#[test]
fn test_withdraw_insurance_sdk() {
    let sdk = test_sdk();
    let pool = InsurancePoolCellData {
        total_deposits: 100_000 * PRECISION,
        total_shares: 100_000 * PRECISION,
        last_premium_block: 100,
        ..default_insurance_pool()
    };

    let tx = sdk.withdraw_insurance(
        test_input(0x01),
        &pool,
        25_000 * PRECISION, // burn 25K shares
        test_lock(0x02),
        200,
    ).unwrap();

    assert_eq!(tx.inputs.len(), 1); // pool
    assert_eq!(tx.outputs.len(), 2); // pool + withdrawal

    let new_pool = InsurancePoolCellData::deserialize(&tx.outputs[0].data).unwrap();
    assert_eq!(new_pool.total_deposits, 75_000 * PRECISION);
    assert_eq!(new_pool.total_shares, 75_000 * PRECISION);

    // Withdrawal output has the withdrawn amount
    let withdrawn = u128::from_le_bytes(tx.outputs[1].data[0..16].try_into().unwrap());
    assert_eq!(withdrawn, 25_000 * PRECISION);

    assert!(verify_update(&pool, &new_pool).is_ok());
}

#[test]
fn test_withdraw_insurance_with_yield() {
    let sdk = test_sdk();
    // Pool has 110K deposits for 100K shares (10% yield)
    let pool = InsurancePoolCellData {
        total_deposits: 110_000 * PRECISION,
        total_shares: 100_000 * PRECISION,
        total_premiums_earned: 10_000 * PRECISION,
        last_premium_block: 100,
        ..default_insurance_pool()
    };

    let tx = sdk.withdraw_insurance(
        test_input(0x01),
        &pool,
        50_000 * PRECISION, // burn 50% of shares
        test_lock(0x02),
        200,
    ).unwrap();

    let new_pool = InsurancePoolCellData::deserialize(&tx.outputs[0].data).unwrap();
    // 50K shares * 110K/100K = 55K underlying
    let expected_underlying = mul_div(50_000 * PRECISION, 110_000 * PRECISION, 100_000 * PRECISION);
    assert_eq!(new_pool.total_deposits, 110_000 * PRECISION - expected_underlying);
    assert_eq!(new_pool.total_shares, 50_000 * PRECISION);

    let withdrawn = u128::from_le_bytes(tx.outputs[1].data[0..16].try_into().unwrap());
    assert_eq!(withdrawn, expected_underlying);
}

#[test]
fn test_withdraw_insurance_excess_rejected() {
    let sdk = test_sdk();
    let pool = InsurancePoolCellData {
        total_deposits: 100_000 * PRECISION,
        total_shares: 100_000 * PRECISION,
        last_premium_block: 100,
        ..default_insurance_pool()
    };

    // Try to burn more shares than exist
    let result = sdk.withdraw_insurance(
        test_input(0x01),
        &pool,
        200_000 * PRECISION,
        test_lock(0x02),
        200,
    );
    assert!(result.is_err());
}

#[test]
fn test_accrue_premium_sdk() {
    let sdk = test_sdk();
    let pool = InsurancePoolCellData {
        total_deposits: 100_000 * PRECISION,
        total_shares: 100_000 * PRECISION,
        last_premium_block: 0,
        ..default_insurance_pool()
    };

    // 1M borrows, 50 bps rate, 1 year
    let tx = sdk.accrue_insurance_premium(
        test_input(0x01),
        &pool,
        1_000_000 * PRECISION,
        BLOCKS_PER_YEAR as u64,
    ).unwrap();

    let new_pool = InsurancePoolCellData::deserialize(&tx.outputs[0].data).unwrap();
    // Premium = 1M * 0.005 = 5K
    assert_eq!(new_pool.total_premiums_earned, 5_000 * PRECISION);
    assert_eq!(new_pool.total_deposits, 105_000 * PRECISION);
    assert_eq!(new_pool.last_premium_block, BLOCKS_PER_YEAR as u64);
    assert_eq!(new_pool.total_shares, 100_000 * PRECISION); // shares unchanged

    assert!(verify_update(&pool, &new_pool).is_ok());
}

#[test]
fn test_accrue_premium_stale_block_rejected() {
    let sdk = test_sdk();
    let pool = InsurancePoolCellData {
        total_deposits: 100_000 * PRECISION,
        total_shares: 100_000 * PRECISION,
        last_premium_block: 1000,
        ..default_insurance_pool()
    };

    // Block number <= last_premium_block
    let result = sdk.accrue_insurance_premium(
        test_input(0x01),
        &pool,
        1_000_000 * PRECISION,
        500, // before last premium
    );
    assert!(result.is_err());
}

#[test]
fn test_claim_insurance_sdk() {
    let sdk = test_sdk();

    // Insurance pool with 100K deposits
    let insurance = InsurancePoolCellData {
        total_deposits: 100_000 * PRECISION,
        total_shares: 100_000 * PRECISION,
        last_premium_block: 100,
        ..default_insurance_pool()
    };

    // Distressed vault: 10 ETH at $1000, 8000 USDC debt, 80% LT → HF = 1.0
    let vault = VaultCellData {
        owner_lock_hash: [0x11; 32],
        pool_id: [0x22; 32],
        collateral_amount: 10 * PRECISION,
        collateral_type_hash: [0x33; 32],
        debt_shares: 8_000 * PRECISION,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 0,
        last_update_block: 50,
    };

    let lending_pool = LendingPoolCellData {
        total_deposits: 100_000 * PRECISION,
        total_borrows: 50_000 * PRECISION,
        total_shares: 100_000 * PRECISION,
        total_reserves: 0,
        borrow_index: PRECISION, // No interest accrued yet
        last_accrual_block: 100,
        asset_type_hash: [0xBB; 32],
        pool_id: [0x22; 32],
        base_rate: DEFAULT_BASE_RATE,
        slope1: DEFAULT_SLOPE1,
        slope2: DEFAULT_SLOPE2,
        optimal_utilization: DEFAULT_OPTIMAL_UTILIZATION,
        reserve_factor: DEFAULT_RESERVE_FACTOR,
        collateral_factor: DEFAULT_COLLATERAL_FACTOR,
        liquidation_threshold: DEFAULT_LIQUIDATION_THRESHOLD,
        liquidation_incentive: DEFAULT_LIQUIDATION_INCENTIVE,
    };

    let tx = sdk.claim_insurance(
        test_input(0x01),
        &insurance,
        test_input(0x02),
        &vault,
        &lending_pool,
        1000 * PRECISION, // ETH at $1000
        PRECISION,        // USDC at $1
        200,
    ).unwrap();

    assert_eq!(tx.inputs.len(), 2);  // insurance + vault
    assert_eq!(tx.outputs.len(), 2); // insurance + vault

    let new_insurance = InsurancePoolCellData::deserialize(&tx.outputs[0].data).unwrap();
    let new_vault = VaultCellData::deserialize(&tx.outputs[1].data).unwrap();

    // Insurance deposits decreased
    assert!(new_insurance.total_deposits < insurance.total_deposits);
    // Claims increased
    assert!(new_insurance.total_claims_paid > 0);
    // Vault debt decreased
    assert!(new_vault.debt_shares < vault.debt_shares);
    // Collateral unchanged (insurance repays debt, doesn't seize collateral)
    assert_eq!(new_vault.collateral_amount, vault.collateral_amount);
    // Owner unchanged
    assert_eq!(new_vault.owner_lock_hash, vault.owner_lock_hash);

    // Validate insurance state transition
    assert!(verify_update(&insurance, &new_insurance).is_ok());
}

#[test]
fn test_claim_insurance_safe_vault_rejected() {
    let sdk = test_sdk();

    let insurance = InsurancePoolCellData {
        total_deposits: 100_000 * PRECISION,
        total_shares: 100_000 * PRECISION,
        last_premium_block: 100,
        ..default_insurance_pool()
    };

    // Safe vault: HF = 3.2
    let vault = VaultCellData {
        owner_lock_hash: [0x11; 32],
        pool_id: [0x22; 32],
        collateral_amount: 10 * PRECISION,
        collateral_type_hash: [0x33; 32],
        debt_shares: 5_000 * PRECISION,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 0,
        last_update_block: 50,
    };

    let lending_pool = LendingPoolCellData {
        borrow_index: PRECISION,
        liquidation_threshold: DEFAULT_LIQUIDATION_THRESHOLD,
        ..LendingPoolCellData::default()
    };

    let result = sdk.claim_insurance(
        test_input(0x01),
        &insurance,
        test_input(0x02),
        &vault,
        &lending_pool,
        2000 * PRECISION, // ETH at $2000 — very safe
        PRECISION,
        200,
    );
    // Safe vault should be rejected — no claim needed
    assert!(result.is_err());
}

// ============ Full Lifecycle Tests ============

#[test]
fn test_insurance_full_lifecycle() {
    let sdk = test_sdk();

    // 1. CREATE POOL
    let create_tx = sdk.create_insurance_pool(
        [0xAA; 32],
        [0xBB; 32],
        DEFAULT_PREMIUM_RATE_BPS,
        DEFAULT_MAX_COVERAGE_BPS,
        DEFAULT_COOLDOWN_BLOCKS,
        test_lock(0x01),
        test_input(0x01),
    ).unwrap();
    let pool = InsurancePoolCellData::deserialize(&create_tx.outputs[0].data).unwrap();
    assert!(verify_creation(&pool).is_ok());

    // 2. DEPOSIT 100K
    let deposit_tx = sdk.deposit_insurance(
        test_input(0x02),
        &pool,
        100_000 * PRECISION,
        test_lock(0x02),
        test_input(0x03),
        100,
    ).unwrap();
    let after_deposit = InsurancePoolCellData::deserialize(&deposit_tx.outputs[0].data).unwrap();
    assert!(verify_update(&pool, &after_deposit).is_ok());
    assert_eq!(after_deposit.total_deposits, 100_000 * PRECISION);
    assert_eq!(after_deposit.total_shares, 100_000 * PRECISION);

    // 3. PREMIUM ACCRUAL (1M borrows, 1 year → 5K premium)
    let premium_tx = sdk.accrue_insurance_premium(
        test_input(0x04),
        &after_deposit,
        1_000_000 * PRECISION,
        BLOCKS_PER_YEAR as u64 + 100, // +100 because last_premium_block was 100
    ).unwrap();
    let after_premium = InsurancePoolCellData::deserialize(&premium_tx.outputs[0].data).unwrap();
    assert!(verify_update(&after_deposit, &after_premium).is_ok());
    assert_eq!(after_premium.total_premiums_earned, 5_000 * PRECISION);
    assert_eq!(after_premium.total_deposits, 105_000 * PRECISION);

    // 4. Exchange rate check — shares are worth more
    let rate = insurance::exchange_rate(
        after_premium.total_shares,
        after_premium.total_deposits,
    );
    assert!(rate > PRECISION); // 105K / 100K = 1.05

    // 5. CLAIM INSURANCE for a distressed vault
    let vault = VaultCellData {
        owner_lock_hash: [0x11; 32],
        pool_id: [0x22; 32],
        collateral_amount: 10 * PRECISION,
        collateral_type_hash: [0x33; 32],
        debt_shares: 8_000 * PRECISION,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 0,
        last_update_block: 50,
    };
    let lending_pool = LendingPoolCellData {
        total_deposits: 100_000 * PRECISION,
        total_borrows: 50_000 * PRECISION,
        total_shares: 100_000 * PRECISION,
        borrow_index: PRECISION,
        last_accrual_block: 100,
        asset_type_hash: [0xBB; 32],
        pool_id: [0x22; 32],
        base_rate: DEFAULT_BASE_RATE,
        slope1: DEFAULT_SLOPE1,
        slope2: DEFAULT_SLOPE2,
        optimal_utilization: DEFAULT_OPTIMAL_UTILIZATION,
        reserve_factor: DEFAULT_RESERVE_FACTOR,
        collateral_factor: DEFAULT_COLLATERAL_FACTOR,
        liquidation_threshold: DEFAULT_LIQUIDATION_THRESHOLD,
        liquidation_incentive: DEFAULT_LIQUIDATION_INCENTIVE,
        total_reserves: 0,
    };

    let claim_tx = sdk.claim_insurance(
        test_input(0x05),
        &after_premium,
        test_input(0x06),
        &vault,
        &lending_pool,
        1000 * PRECISION, // ETH at $1000 → HF = 1.0
        PRECISION,
        BLOCKS_PER_YEAR as u64 + 200,
    ).unwrap();
    let after_claim = InsurancePoolCellData::deserialize(&claim_tx.outputs[0].data).unwrap();
    let after_claim_vault = VaultCellData::deserialize(&claim_tx.outputs[1].data).unwrap();
    assert!(verify_update(&after_premium, &after_claim).is_ok());
    assert!(after_claim.total_claims_paid > 0);
    assert!(after_claim_vault.debt_shares < vault.debt_shares);

    // 6. WITHDRAW remaining (all shares)
    let withdraw_tx = sdk.withdraw_insurance(
        test_input(0x07),
        &after_claim,
        after_claim.total_shares,
        test_lock(0x03),
        BLOCKS_PER_YEAR as u64 + 300,
    ).unwrap();
    let after_withdraw = InsurancePoolCellData::deserialize(&withdraw_tx.outputs[0].data).unwrap();
    assert!(verify_update(&after_claim, &after_withdraw).is_ok());
    assert_eq!(after_withdraw.total_deposits, 0);
    assert_eq!(after_withdraw.total_shares, 0);

    // 7. DESTROY empty pool
    assert!(verify_destruction(&after_withdraw).is_ok());
}

#[test]
fn test_insurance_multiple_depositors() {
    let sdk = test_sdk();

    // Alice deposits 100K
    let pool = default_insurance_pool();
    let alice_tx = sdk.deposit_insurance(
        test_input(0x01),
        &pool,
        100_000 * PRECISION,
        test_lock(0x01),
        test_input(0x02),
        100,
    ).unwrap();
    let after_alice = InsurancePoolCellData::deserialize(&alice_tx.outputs[0].data).unwrap();
    let alice_shares = after_alice.total_shares; // 100K shares

    // Premium accrues: +10K (pool now 110K deposits, 100K shares)
    let after_premium = InsurancePoolCellData {
        total_deposits: 110_000 * PRECISION,
        total_premiums_earned: 10_000 * PRECISION,
        last_premium_block: 200,
        ..after_alice
    };

    // Bob deposits 11K (gets 10K shares since rate is 1.1)
    let bob_tx = sdk.deposit_insurance(
        test_input(0x03),
        &after_premium,
        11_000 * PRECISION,
        test_lock(0x02),
        test_input(0x04),
        300,
    ).unwrap();
    let after_bob = InsurancePoolCellData::deserialize(&bob_tx.outputs[0].data).unwrap();
    let bob_shares = after_bob.total_shares - alice_shares;

    // Bob should have ~10K shares (11K * 100K/110K)
    let expected_bob_shares = mul_div(11_000 * PRECISION, 100_000 * PRECISION, 110_000 * PRECISION);
    assert_eq!(bob_shares, expected_bob_shares);

    // Alice withdraws all her shares — gets more than she deposited
    let alice_underlying = insurance::shares_to_underlying(
        alice_shares,
        after_bob.total_shares,
        after_bob.total_deposits,
    ).unwrap();
    assert!(alice_underlying > 100_000 * PRECISION, "Alice should earn yield from premiums");

    // Bob withdraws — gets approximately what he deposited (no premium since he joined late)
    let bob_underlying = insurance::shares_to_underlying(
        bob_shares,
        after_bob.total_shares,
        after_bob.total_deposits,
    ).unwrap();
    // Bob should get back ~11K (he joined after premium accrual, so roughly what he put in)
    assert!(bob_underlying >= 10_900 * PRECISION);
    assert!(bob_underlying <= 11_100 * PRECISION);
}

#[test]
fn test_insurance_coverage_limits() {
    let sdk = test_sdk();

    // Small insurance pool: 1000 tokens
    let insurance = InsurancePoolCellData {
        total_deposits: 1_000 * PRECISION,
        total_shares: 1_000 * PRECISION,
        last_premium_block: 100,
        ..default_insurance_pool()
    };

    // Vault with massive debt: needs way more than pool has
    // 10 ETH at $500, 8000 USDC debt → HF = 0.5
    let vault = VaultCellData {
        owner_lock_hash: [0x11; 32],
        pool_id: [0x22; 32],
        collateral_amount: 10 * PRECISION,
        collateral_type_hash: [0x33; 32],
        debt_shares: 8_000 * PRECISION,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 0,
        last_update_block: 50,
    };

    let lending_pool = LendingPoolCellData {
        borrow_index: PRECISION,
        liquidation_threshold: DEFAULT_LIQUIDATION_THRESHOLD,
        ..LendingPoolCellData::default()
    };

    let tx = sdk.claim_insurance(
        test_input(0x01),
        &insurance,
        test_input(0x02),
        &vault,
        &lending_pool,
        500 * PRECISION,
        PRECISION,
        200,
    ).unwrap();

    let new_insurance = InsurancePoolCellData::deserialize(&tx.outputs[0].data).unwrap();
    // Claim should be capped at 20% of 1000 = 200 tokens
    let max_coverage = insurance::available_coverage(
        insurance.total_deposits,
        insurance.max_coverage_bps,
    );
    assert_eq!(new_insurance.total_claims_paid, max_coverage);
    assert_eq!(new_insurance.total_deposits, insurance.total_deposits - max_coverage);
}

#[test]
fn test_insurance_premium_yield_calculation() {
    // Verify APY math matches real-world expectations
    let total_deposits = 100_000 * PRECISION;
    let lending_borrows = 1_000_000 * PRECISION;
    let premium_rate = DEFAULT_PREMIUM_RATE_BPS; // 50 bps = 0.5%

    // Annual premium
    let annual_premium = insurance::calculate_premium(
        lending_borrows,
        premium_rate,
        BLOCKS_PER_YEAR as u64,
    );
    assert_eq!(annual_premium, 5_000 * PRECISION);

    // APY for insurance depositors
    let apy = insurance::insurance_apy(annual_premium, total_deposits);
    assert_eq!(apy, 50_000_000_000_000_000); // 5%

    // Coverage ratio
    let ratio = insurance::coverage_ratio(total_deposits, lending_borrows);
    assert_eq!(ratio, 100_000_000_000_000_000); // 10%
}

#[test]
fn test_insurance_prevention_integration() {
    // Test that insurance claim actually prevents liquidation
    let collateral = 10 * PRECISION;
    let col_price = 1050 * PRECISION; // ETH at $1050
    let debt = 8_000 * PRECISION;
    let debt_price = PRECISION; // USDC at $1
    let lt = DEFAULT_LIQUIDATION_THRESHOLD;

    // HF = (10*1050*0.8)/8000 = 8400/8000 = 1.05 — in soft liquidation range
    let hf = ckb_lending_math::collateral::health_factor(
        collateral, col_price, debt, debt_price, lt,
    ).unwrap();
    let tier = prevention::classify_risk(hf);
    assert_eq!(tier, prevention::RiskTier::SoftLiquidation);

    // Insurance needed to bring HF to 1.1
    let needed = prevention::insurance_needed(
        collateral, col_price, debt, debt_price, lt,
        prevention::HF_SOFT_LIQUIDATION,
    );
    assert!(needed > 0);

    // After insurance pays out
    let new_debt = debt - needed;
    let new_hf = ckb_lending_math::collateral::health_factor(
        collateral, col_price, new_debt, debt_price, lt,
    ).unwrap();
    let new_tier = prevention::classify_risk(new_hf);

    // Should be out of soft liquidation range
    assert!(new_hf >= prevention::HF_SOFT_LIQUIDATION - PRECISION / 100);
    assert!(new_tier != prevention::RiskTier::SoftLiquidation);
    assert!(new_tier != prevention::RiskTier::HardLiquidation);
}

#[test]
fn test_insurance_repeated_claims() {
    let sdk = test_sdk();

    // Insurance pool with 100K
    let mut pool = InsurancePoolCellData {
        total_deposits: 100_000 * PRECISION,
        total_shares: 100_000 * PRECISION,
        last_premium_block: 100,
        ..default_insurance_pool()
    };

    let vault = VaultCellData {
        owner_lock_hash: [0x11; 32],
        pool_id: [0x22; 32],
        collateral_amount: 10 * PRECISION,
        collateral_type_hash: [0x33; 32],
        debt_shares: 8_000 * PRECISION,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 0,
        last_update_block: 50,
    };

    let lending_pool = LendingPoolCellData {
        borrow_index: PRECISION,
        liquidation_threshold: DEFAULT_LIQUIDATION_THRESHOLD,
        ..LendingPoolCellData::default()
    };

    // First claim
    let tx1 = sdk.claim_insurance(
        test_input(0x01), &pool, test_input(0x02),
        &vault, &lending_pool,
        1000 * PRECISION, PRECISION, 200,
    ).unwrap();
    let pool_after_1 = InsurancePoolCellData::deserialize(&tx1.outputs[0].data).unwrap();

    // Pool should still have deposits after one claim
    assert!(pool_after_1.total_deposits > 0);
    let first_claim = pool_after_1.total_claims_paid;
    assert!(first_claim > 0);

    // Second claim on the updated pool (debt still distressed)
    pool = pool_after_1;
    let tx2 = sdk.claim_insurance(
        test_input(0x03), &pool, test_input(0x04),
        &vault, &lending_pool,
        1000 * PRECISION, PRECISION, 300,
    ).unwrap();
    let pool_after_2 = InsurancePoolCellData::deserialize(&tx2.outputs[0].data).unwrap();

    // Claims should accumulate
    assert!(pool_after_2.total_claims_paid > first_claim);
    // Pool depleting but still valid
    assert!(verify_update(&pool, &pool_after_2).is_ok());
}
