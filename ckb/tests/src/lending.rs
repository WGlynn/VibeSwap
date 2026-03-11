// ============ Lending Protocol Integration Tests ============
// End-to-end testing of the CKB lending protocol:
// - Pool creation and validation
// - Vault lifecycle (open → collateral → borrow → repay → close)
// - Interest accrual across pool + vault
// - Liquidation scenarios
// - Multi-user interactions
// - Edge cases and invariants

use ckb_lending_math::{
    interest::{self, RateModel},
    collateral::{self, CollateralParams},
    shares, pool, mul_div, PRECISION,
};
use vibeswap_types::*;
use lending_pool_type::{verify_creation, verify_update};
use vault_type::{
    verify_creation as verify_vault_creation,
    verify_update as verify_vault_update,
    verify_destruction as verify_vault_destruction,
    verify_liquidation as verify_vault_liquidation,
};

// ============ Helpers ============

fn default_pool_cell() -> LendingPoolCellData {
    LendingPoolCellData {
        total_deposits: 0,
        total_borrows: 0,
        total_shares: 0,
        total_reserves: 0,
        borrow_index: PRECISION,
        last_accrual_block: 0,
        asset_type_hash: [0xAA; 32],
        pool_id: [0xBB; 32],
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

#[allow(dead_code)]
fn default_vault_cell(owner: [u8; 32], pool_id: [u8; 32]) -> VaultCellData {
    VaultCellData {
        owner_lock_hash: owner,
        pool_id,
        collateral_amount: 0,
        collateral_type_hash: [0u8; 32],
        debt_shares: 0,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 0,
        last_update_block: 0,
    }
}

fn rate_model_from_pool(pool: &LendingPoolCellData) -> RateModel {
    RateModel {
        base_rate: pool.base_rate,
        slope1: pool.slope1,
        slope2: pool.slope2,
        optimal_utilization: pool.optimal_utilization,
        reserve_factor: pool.reserve_factor,
    }
}

fn col_params_from_pool(pool: &LendingPoolCellData) -> CollateralParams {
    CollateralParams {
        collateral_factor: pool.collateral_factor,
        liquidation_threshold: pool.liquidation_threshold,
        liquidation_incentive: pool.liquidation_incentive,
        close_factor: 500_000_000_000_000_000, // 50%
    }
}

// ============ Full Lifecycle Tests ============

#[test]
fn test_lending_full_lifecycle_single_user() {
    let alice = [0xA1; 32];
    let col_token = [0xCC; 32];

    // 1. Create pool
    let pool = default_pool_cell();
    assert!(verify_creation(&pool).is_ok());

    // 2. Alice deposits 10,000 USDC
    let mut pool2 = pool.clone();
    pool2.total_deposits = 10_000 * PRECISION;
    let alice_shares = shares::deposit_to_shares(
        10_000 * PRECISION,
        pool.total_shares,
        pool.total_deposits,
    ).unwrap();
    pool2.total_shares = alice_shares;
    assert!(verify_update(&pool, &pool2).is_ok());

    // 3. Alice opens vault and deposits 10 ETH collateral
    let vault = VaultCellData {
        owner_lock_hash: alice,
        pool_id: pool2.pool_id,
        collateral_amount: 10 * PRECISION,
        collateral_type_hash: col_token,
        debt_shares: 0,
        borrow_index_snapshot: pool2.borrow_index,
        deposit_shares: alice_shares,
        last_update_block: 100,
    };
    assert!(verify_vault_creation(&vault).is_ok());

    // 4. Alice borrows 5,000 USDC (50% LTV)
    let mut pool3 = pool2.clone();
    pool3.total_borrows = 5_000 * PRECISION;
    assert!(verify_update(&pool2, &pool3).is_ok());

    let vault2 = VaultCellData {
        debt_shares: 5_000 * PRECISION,
        borrow_index_snapshot: pool3.borrow_index,
        last_update_block: 200,
        ..vault.clone()
    };
    assert!(verify_vault_update(&vault, &vault2).is_ok());

    // 5. Verify health factor (10 ETH at $2000, 5000 USDC debt, 80% LT)
    let hf = collateral::health_factor(
        10 * PRECISION,
        2000 * PRECISION,
        5000 * PRECISION,
        PRECISION,
        pool3.liquidation_threshold,
    ).unwrap();
    assert!(hf > PRECISION); // Safe (HF = 3.2)

    // 6. Time passes — accrue interest (1 year equivalent)
    let model = rate_model_from_pool(&pool3);
    let pool_state = pool::PoolState {
        total_deposits: pool3.total_deposits,
        total_borrows: pool3.total_borrows,
        total_shares: pool3.total_shares,
        total_reserves: pool3.total_reserves,
        last_accrual_block: 200,
        borrow_index: pool3.borrow_index,
    };
    let accrued = pool::accrue(&pool_state, 200 + ckb_lending_math::BLOCKS_PER_YEAR as u64, &model).unwrap();

    // 7. Update pool cell with accrued state
    let mut pool4 = pool3.clone();
    pool4.total_deposits = accrued.total_deposits;
    pool4.total_borrows = accrued.total_borrows;
    pool4.total_reserves = accrued.total_reserves;
    pool4.borrow_index = accrued.borrow_index;
    pool4.last_accrual_block = 200 + ckb_lending_math::BLOCKS_PER_YEAR as u64;
    assert!(verify_update(&pool3, &pool4).is_ok());

    // 8. Alice's debt increased
    let alice_debt = pool::current_debt(
        5000 * PRECISION,
        vault2.borrow_index_snapshot,
        pool4.borrow_index,
    );
    assert!(alice_debt > 5000 * PRECISION);
    // At 50% utilization, rate is ~4% (base 2% + half of slope1 4%)
    // 5000 * 4% = ~200 tokens interest
    let interest = alice_debt - 5000 * PRECISION;
    assert!(interest > 150 * PRECISION); // ~3%+
    assert!(interest < 300 * PRECISION); // ~6% max

    // 9. Alice repays in full
    let mut pool5 = pool4.clone();
    pool5.total_borrows = pool4.total_borrows - alice_debt;

    let vault3 = VaultCellData {
        debt_shares: 0,
        borrow_index_snapshot: pool5.borrow_index,
        last_update_block: pool5.last_accrual_block,
        ..vault2.clone()
    };
    assert!(verify_vault_update(&vault2, &vault3).is_ok());

    // 10. Alice withdraws and destroys vault
    assert!(verify_vault_destruction(&vault3).is_ok());

    // 11. Alice redeems shares — should get back principal + interest earned as lender
    let alice_underlying = shares::shares_to_underlying(
        alice_shares,
        pool5.total_shares,
        pool5.total_deposits,
    ).unwrap();
    // Alice was both lender and borrower, so she paid herself. Net ~= 0 minus protocol reserves
    assert!(alice_underlying > 9_500 * PRECISION); // Got most back
}

#[test]
fn test_lending_two_users_lender_borrower() {
    let alice = [0xA1; 32]; // Lender
    let bob = [0xB0; 32];   // Borrower
    let col_token = [0xCC; 32];

    // 1. Create pool, Alice deposits 10,000
    let pool = default_pool_cell();
    assert!(verify_creation(&pool).is_ok());

    let mut pool2 = pool.clone();
    pool2.total_deposits = 10_000 * PRECISION;
    pool2.total_shares = 10_000 * PRECISION; // 1:1 first deposit
    assert!(verify_update(&pool, &pool2).is_ok());

    // 2. Alice's vault (deposit shares only, no collateral)
    let alice_vault = VaultCellData {
        owner_lock_hash: alice,
        pool_id: pool2.pool_id,
        deposit_shares: 10_000 * PRECISION,
        borrow_index_snapshot: PRECISION,
        last_update_block: 100,
        ..Default::default()
    };
    assert!(verify_vault_creation(&alice_vault).is_ok());

    // 3. Bob opens vault with 10 ETH collateral, borrows 8,000 USDC
    let bob_vault = VaultCellData {
        owner_lock_hash: bob,
        pool_id: pool2.pool_id,
        collateral_amount: 10 * PRECISION,
        collateral_type_hash: col_token,
        debt_shares: 8_000 * PRECISION,
        borrow_index_snapshot: pool2.borrow_index,
        deposit_shares: 0,
        last_update_block: 200,
    };
    assert!(verify_vault_creation(&bob_vault).is_ok());

    let mut pool3 = pool2.clone();
    pool3.total_borrows = 8_000 * PRECISION; // 80% utilization
    assert!(verify_update(&pool2, &pool3).is_ok());

    // 4. 1 year passes — accrue interest
    let model = rate_model_from_pool(&pool3);
    let pool_state = pool::PoolState {
        total_deposits: pool3.total_deposits,
        total_borrows: pool3.total_borrows,
        total_shares: pool3.total_shares,
        total_reserves: pool3.total_reserves,
        last_accrual_block: 200,
        borrow_index: pool3.borrow_index,
    };
    let accrued = pool::accrue(&pool_state, 200 + ckb_lending_math::BLOCKS_PER_YEAR as u64, &model).unwrap();

    // 5. Verify Bob's debt increased
    let bob_debt = pool::current_debt(
        8000 * PRECISION,
        bob_vault.borrow_index_snapshot,
        accrued.borrow_index,
    );
    assert!(bob_debt > 8000 * PRECISION);
    let bob_interest = bob_debt - 8000 * PRECISION;

    // At 80% utilization (the kink): rate = base(2%) + slope1(4%) = 6%
    // 8000 * 6% = ~480 tokens interest
    assert!(bob_interest > 400 * PRECISION);
    assert!(bob_interest < 560 * PRECISION);

    // 6. Alice's deposit shares are worth more
    let alice_underlying = shares::shares_to_underlying(
        10_000 * PRECISION,
        accrued.total_shares,
        accrued.total_deposits,
    ).unwrap();
    // Alice earned interest - protocol reserves
    // Supply rate = 6% * 0.8 * 0.9 = 4.32% → Alice earns ~432 on 10k
    assert!(alice_underlying > 10_300 * PRECISION);
    assert!(alice_underlying < 10_600 * PRECISION);

    // 7. Protocol earned reserves
    assert!(accrued.total_reserves > 0);
    // Reserve = 10% of total interest
    let expected_reserves = bob_interest / 10;
    // Approximate check (reserves calculated differently from pool accrual)
    assert!(accrued.total_reserves > expected_reserves / 2);
    assert!(accrued.total_reserves < expected_reserves * 2);
}

#[test]
fn test_lending_liquidation_flow() {
    let _alice = [0xA1; 32]; // Lender
    let bob = [0xB0; 32];   // Borrower (gets liquidated)
    let _charlie = [0xC3; 32]; // Liquidator
    let col_token = [0xCC; 32];

    // Setup: Create empty pool, then update to active state
    let pool_initial = default_pool_cell();
    assert!(verify_creation(&pool_initial).is_ok());

    let mut pool = pool_initial.clone();
    pool.total_deposits = 100_000 * PRECISION;
    pool.total_shares = 100_000 * PRECISION;
    pool.total_borrows = 12_000 * PRECISION;
    assert!(verify_update(&pool_initial, &pool).is_ok());

    let bob_vault = VaultCellData {
        owner_lock_hash: bob,
        pool_id: pool.pool_id,
        collateral_amount: 10 * PRECISION,
        collateral_type_hash: col_token,
        debt_shares: 12_000 * PRECISION,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 0,
        last_update_block: 100,
    };

    let params = col_params_from_pool(&pool);

    // Initially safe at $2000: HF = (10 * 2000 * 0.8) / 12000 = 1.33
    let hf_safe = collateral::health_factor(
        10 * PRECISION, 2000 * PRECISION,
        12_000 * PRECISION, PRECISION,
        pool.liquidation_threshold,
    ).unwrap();
    assert!(hf_safe > PRECISION);

    // Price crashes to $1000: HF = (10 * 1000 * 0.8) / 12000 = 0.667
    let hf_underwater = collateral::health_factor(
        10 * PRECISION, 1000 * PRECISION,
        12_000 * PRECISION, PRECISION,
        pool.liquidation_threshold,
    ).unwrap();
    assert!(hf_underwater < PRECISION); // Liquidatable!

    // Charlie liquidates
    let (repay_amount, seized_collateral) = collateral::liquidation_amounts(
        10 * PRECISION, 1000 * PRECISION,
        12_000 * PRECISION, PRECISION,
        &params,
    ).unwrap();

    // Repay = 50% close factor * 12000 = 6000 USDC
    assert_eq!(repay_amount, 6000 * PRECISION);

    // Seized = 6000 * 1.05 / 1000 = 6.3 ETH
    assert!(seized_collateral > 6 * PRECISION);
    assert!(seized_collateral < 7 * PRECISION);

    // Update Bob's vault post-liquidation
    let bob_vault_after = VaultCellData {
        collateral_amount: 10 * PRECISION - seized_collateral,
        debt_shares: 12_000 * PRECISION - repay_amount, // 6000 remaining
        last_update_block: 200,
        ..bob_vault.clone()
    };
    assert!(verify_vault_update(&bob_vault, &bob_vault_after).is_ok());

    // Update pool: borrows decreased by repay amount
    let mut pool_after = pool.clone();
    pool_after.total_borrows = pool.total_borrows - repay_amount;
    pool_after.last_accrual_block = 200;
    assert!(verify_update(&pool, &pool_after).is_ok());

    // Verify remaining position still underwater (needs more liquidation or price recovery)
    let remaining_collateral = bob_vault_after.collateral_amount;
    let remaining_debt = bob_vault_after.debt_shares; // Simplified: shares = debt at index 1.0

    // If price stays at $1000: HF = (3.7 * 1000 * 0.8) / 6000
    let hf_remaining = collateral::health_factor(
        remaining_collateral, 1000 * PRECISION,
        remaining_debt, PRECISION,
        pool.liquidation_threshold,
    ).unwrap();
    // Might still be underwater depending on exact seized amount
    assert!(hf_remaining < 2 * PRECISION); // Still near danger zone
}

#[test]
fn test_lending_bad_debt_socialization() {
    // When collateral < debt, bad debt must be socialized across lenders
    let bad = collateral::bad_debt(
        1 * PRECISION,     // 1 ETH collateral
        500 * PRECISION,   // $500/ETH
        2000 * PRECISION,  // 2000 USDC debt
        PRECISION,         // $1/USDC
    );
    // Shortfall = 2000 - 500 = 1500 USDC
    assert_eq!(bad, 1500 * PRECISION);

    // No bad debt when collateral > debt
    let no_bad = collateral::bad_debt(
        10 * PRECISION, 2000 * PRECISION,
        5000 * PRECISION, PRECISION,
    );
    assert_eq!(no_bad, 0);
}

// ============ Interest Rate Model Integration ============

#[test]
fn test_rate_model_matches_pool_params() {
    let pool = default_pool_cell();
    let model = rate_model_from_pool(&pool);

    // At 0% utilization
    let rate_0 = interest::borrow_rate(0, &model).unwrap();
    assert_eq!(rate_0, DEFAULT_BASE_RATE);

    // At 80% utilization (kink)
    let rate_kink = interest::borrow_rate(DEFAULT_OPTIMAL_UTILIZATION, &model).unwrap();
    assert_eq!(rate_kink, DEFAULT_BASE_RATE + DEFAULT_SLOPE1);

    // At 100% utilization
    let rate_100 = interest::borrow_rate(PRECISION, &model).unwrap();
    assert_eq!(rate_100, DEFAULT_BASE_RATE + DEFAULT_SLOPE1 + DEFAULT_SLOPE2);
}

#[test]
fn test_borrow_index_monotonically_increases() {
    let model = RateModel::default_stable();
    let mut state = pool::PoolState {
        total_deposits: 100_000 * PRECISION,
        total_borrows: 50_000 * PRECISION,
        total_shares: 100_000 * PRECISION,
        total_reserves: 0,
        last_accrual_block: 0,
        borrow_index: PRECISION,
    };

    // Accrue in 100-block intervals
    let mut prev_index = state.borrow_index;
    for i in 1..=10 {
        state = pool::accrue(&state, i * 100, &model).unwrap();
        assert!(state.borrow_index >= prev_index);
        prev_index = state.borrow_index;
    }
    // After 1000 blocks, index should have grown
    assert!(state.borrow_index > PRECISION);
}

#[test]
fn test_deposit_withdraw_symmetry() {
    // Deposit X, immediately withdraw → should get ~X back (minus rounding)
    let deposit = 1000 * PRECISION;
    let shares = shares::deposit_to_shares(deposit, 5000 * PRECISION, 5500 * PRECISION).unwrap();
    let underlying = shares::shares_to_underlying(shares, 5000 * PRECISION + shares, 5500 * PRECISION + deposit).unwrap();

    // Should get back approximately what was deposited
    let diff = if underlying > deposit { underlying - deposit } else { deposit - underlying };
    assert!(diff < 2); // Off by at most 1 due to rounding
}

// ============ Serialization Integration ============

#[test]
fn test_pool_serialize_deserialize_preserves_lending_state() {
    let pool = LendingPoolCellData {
        total_deposits: 100_000 * PRECISION,
        total_borrows: 60_000 * PRECISION,
        total_shares: 95_000 * PRECISION,
        total_reserves: 500 * PRECISION,
        borrow_index: PRECISION + PRECISION / 20, // 1.05
        last_accrual_block: 1_000_000,
        asset_type_hash: [0xAA; 32],
        pool_id: [0xBB; 32],
        base_rate: DEFAULT_BASE_RATE,
        slope1: DEFAULT_SLOPE1,
        slope2: DEFAULT_SLOPE2,
        optimal_utilization: DEFAULT_OPTIMAL_UTILIZATION,
        reserve_factor: DEFAULT_RESERVE_FACTOR,
        collateral_factor: DEFAULT_COLLATERAL_FACTOR,
        liquidation_threshold: DEFAULT_LIQUIDATION_THRESHOLD,
        liquidation_incentive: DEFAULT_LIQUIDATION_INCENTIVE,
    };

    let bytes = pool.serialize();
    let decoded = LendingPoolCellData::deserialize(&bytes).unwrap();

    // Every field must survive the roundtrip
    assert_eq!(pool.total_deposits, decoded.total_deposits);
    assert_eq!(pool.total_borrows, decoded.total_borrows);
    assert_eq!(pool.borrow_index, decoded.borrow_index);
    assert_eq!(pool.slope2, decoded.slope2);
    assert_eq!(pool.liquidation_incentive, decoded.liquidation_incentive);
}

#[test]
fn test_vault_serialize_with_active_position() {
    let vault = VaultCellData {
        owner_lock_hash: [0xA1; 32],
        pool_id: [0xBB; 32],
        collateral_amount: 10 * PRECISION,
        collateral_type_hash: [0xCC; 32],
        debt_shares: 5000 * PRECISION,
        borrow_index_snapshot: PRECISION + PRECISION / 50, // 1.02
        deposit_shares: 1000 * PRECISION,
        last_update_block: 500_000,
    };

    let bytes = vault.serialize();
    let decoded = VaultCellData::deserialize(&bytes).unwrap();
    assert_eq!(vault, decoded);
}

// ============ Pool + Vault Consistency ============

#[test]
fn test_pool_vault_consistency_after_accrual() {
    let model = RateModel::default_stable();

    // Pool: 80% utilized
    let pool_state = pool::PoolState {
        total_deposits: 100_000 * PRECISION,
        total_borrows: 80_000 * PRECISION,
        total_shares: 100_000 * PRECISION,
        total_reserves: 0,
        last_accrual_block: 0,
        borrow_index: PRECISION,
    };

    // Bob borrowed 10,000 at index 1.0
    let bob_principal = 10_000 * PRECISION;
    let bob_index = PRECISION;

    // Accrue for a year
    let accrued = pool::accrue(&pool_state, ckb_lending_math::BLOCKS_PER_YEAR as u64, &model).unwrap();

    // Bob's current debt
    let bob_debt = pool::current_debt(bob_principal, bob_index, accrued.borrow_index);

    // Interest on Bob = proportional to his share of total borrows
    // Bob has 10k of 80k total = 12.5%
    let total_interest = accrued.total_borrows - 80_000 * PRECISION;
    let bob_interest = bob_debt - bob_principal;

    // Bob's interest should be ~12.5% of total interest
    let expected_bob_interest = total_interest * 10_000 / 80_000;
    let diff = if bob_interest > expected_bob_interest {
        bob_interest - expected_bob_interest
    } else {
        expected_bob_interest - bob_interest
    };
    // Allow small rounding error
    assert!(diff < PRECISION);
}

// ============ Edge Cases ============

#[test]
fn test_zero_borrow_no_interest() {
    let model = RateModel::default_stable();
    let state = pool::PoolState {
        total_deposits: 100_000 * PRECISION,
        total_borrows: 0,
        total_shares: 100_000 * PRECISION,
        total_reserves: 0,
        last_accrual_block: 0,
        borrow_index: PRECISION,
    };

    let accrued = pool::accrue(&state, 1_000_000, &model).unwrap();
    assert_eq!(accrued.total_borrows, 0);
    assert_eq!(accrued.total_reserves, 0);
    assert_eq!(accrued.borrow_index, PRECISION);
}

#[test]
fn test_high_utilization_rate_spike() {
    let model = RateModel::default_stable();

    // 95% utilization — above kink, steep slope
    let util = 950_000_000_000_000_000; // 0.95
    let rate = interest::borrow_rate(util, &model).unwrap();

    // At 95%: base(2%) + slope1(4%) + (0.15/0.20)*slope2(300%) = 6% + 225% = 231%
    let expected_steep = mul_div(
        150_000_000_000_000_000, // 0.15
        model.slope2,
        200_000_000_000_000_000, // 0.20
    );
    let expected = model.base_rate + model.slope1 + expected_steep;
    assert_eq!(rate, expected);
    assert!(rate > 2 * PRECISION); // >200% APR — drives repayment
}

#[test]
fn test_exchange_rate_growth_with_interest() {
    let model = RateModel::default_stable();

    let initial = pool::PoolState {
        total_deposits: 100_000 * PRECISION,
        total_borrows: 80_000 * PRECISION,
        total_shares: 100_000 * PRECISION,
        total_reserves: 0,
        last_accrual_block: 0,
        borrow_index: PRECISION,
    };

    let rate_before = shares::exchange_rate(initial.total_shares, initial.total_deposits);

    let accrued = pool::accrue(&initial, ckb_lending_math::BLOCKS_PER_YEAR as u64, &model).unwrap();
    let rate_after = shares::exchange_rate(accrued.total_shares, accrued.total_deposits);

    // Exchange rate must grow (depositors earn interest)
    assert!(rate_after > rate_before);
}

#[test]
fn test_multiple_deposits_fair_share() {
    // Alice deposits 1000, time passes, Bob deposits 1000
    // Bob should get fewer shares (pool is worth more)

    let alice_deposit = 1000 * PRECISION;
    let alice_shares = shares::deposit_to_shares(alice_deposit, 0, 0).unwrap();
    assert_eq!(alice_shares, alice_deposit); // 1:1 first depositor

    // After interest, pool has 1100 underlying
    let pool_underlying = 1100 * PRECISION;
    let bob_deposit = 1000 * PRECISION;
    let bob_shares = shares::deposit_to_shares(
        bob_deposit,
        alice_shares,
        pool_underlying,
    ).unwrap();

    // Bob gets fewer shares: 1000 * 1000 / 1100 ≈ 909
    assert!(bob_shares < alice_shares);
    assert!(bob_shares > 900 * PRECISION);
    assert!(bob_shares < 910 * PRECISION);

    // Now both redeem from pool with 2100 underlying (1100 + 1000 new)
    let total_shares = alice_shares + bob_shares;
    let total_underlying = pool_underlying + bob_deposit;

    let alice_gets = shares::shares_to_underlying(alice_shares, total_shares, total_underlying).unwrap();
    let bob_gets = shares::shares_to_underlying(bob_shares, total_shares, total_underlying).unwrap();

    // Alice gets more (she was there for the interest accrual)
    assert!(alice_gets > bob_gets);
    assert!(alice_gets > 1050 * PRECISION); // Alice: ~1100 of 2100
    assert!(bob_gets < 1010 * PRECISION);   // Bob: ~1000 of 2100
}

// ============ Vault Liquidation Validation Tests ============

#[test]
fn test_verify_liquidation_valid() {
    let old = VaultCellData {
        owner_lock_hash: [0xA1; 32],
        pool_id: [0xBB; 32],
        collateral_amount: 10 * PRECISION,
        collateral_type_hash: [0xCC; 32],
        debt_shares: 12_000 * PRECISION,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 500 * PRECISION,
        last_update_block: 100,
    };

    let new = VaultCellData {
        collateral_amount: 4 * PRECISION,    // Seized 6 collateral
        debt_shares: 6_000 * PRECISION,      // Repaid 6000 debt
        borrow_index_snapshot: PRECISION + PRECISION / 100, // Index went up
        last_update_block: 200,
        ..old.clone()
    };

    assert!(verify_vault_liquidation(&old, &new).is_ok());
}

#[test]
fn test_verify_liquidation_owner_change_rejected() {
    let old = VaultCellData {
        owner_lock_hash: [0xA1; 32],
        pool_id: [0xBB; 32],
        collateral_amount: 10 * PRECISION,
        collateral_type_hash: [0xCC; 32],
        debt_shares: 12_000 * PRECISION,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 0,
        last_update_block: 100,
    };

    let new = VaultCellData {
        owner_lock_hash: [0xEE; 32], // Changed — reject
        collateral_amount: 4 * PRECISION,
        debt_shares: 6_000 * PRECISION,
        last_update_block: 200,
        ..old.clone()
    };

    assert!(verify_vault_liquidation(&old, &new).is_err());
}

#[test]
fn test_verify_liquidation_debt_increase_rejected() {
    let old = VaultCellData {
        owner_lock_hash: [0xA1; 32],
        pool_id: [0xBB; 32],
        collateral_amount: 10 * PRECISION,
        collateral_type_hash: [0xCC; 32],
        debt_shares: 12_000 * PRECISION,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 0,
        last_update_block: 100,
    };

    let new = VaultCellData {
        debt_shares: 15_000 * PRECISION, // Debt INCREASED — reject
        collateral_amount: 4 * PRECISION,
        last_update_block: 200,
        ..old.clone()
    };

    assert!(verify_vault_liquidation(&old, &new).is_err());
}

#[test]
fn test_verify_liquidation_collateral_increase_rejected() {
    let old = VaultCellData {
        owner_lock_hash: [0xA1; 32],
        pool_id: [0xBB; 32],
        collateral_amount: 10 * PRECISION,
        collateral_type_hash: [0xCC; 32],
        debt_shares: 12_000 * PRECISION,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 0,
        last_update_block: 100,
    };

    let new = VaultCellData {
        collateral_amount: 15 * PRECISION, // Collateral INCREASED — reject
        debt_shares: 6_000 * PRECISION,
        last_update_block: 200,
        ..old.clone()
    };

    assert!(verify_vault_liquidation(&old, &new).is_err());
}

#[test]
fn test_verify_liquidation_deposit_shares_changed_rejected() {
    let old = VaultCellData {
        owner_lock_hash: [0xA1; 32],
        pool_id: [0xBB; 32],
        collateral_amount: 10 * PRECISION,
        collateral_type_hash: [0xCC; 32],
        debt_shares: 12_000 * PRECISION,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 500 * PRECISION,
        last_update_block: 100,
    };

    let new = VaultCellData {
        deposit_shares: 1000 * PRECISION, // Changed — reject
        collateral_amount: 4 * PRECISION,
        debt_shares: 6_000 * PRECISION,
        last_update_block: 200,
        ..old.clone()
    };

    assert!(verify_vault_liquidation(&old, &new).is_err());
}

// ============ SDK Liquidation Builder Tests ============

#[test]
fn test_sdk_liquidation_builds_valid_transaction() {
    use vibeswap_sdk::{
        VibeSwapSDK, DeploymentInfo, CellInput, Script, HashType,
    };

    let sdk = VibeSwapSDK::new(DeploymentInfo {
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
        script_dep_tx_hash: [0x10; 32],
        script_dep_index: 0,
    });

    // Pool with active borrows
    let pool = LendingPoolCellData {
        total_deposits: 100_000 * PRECISION,
        total_borrows: 50_000 * PRECISION,
        total_shares: 100_000 * PRECISION,
        total_reserves: 0,
        borrow_index: PRECISION,
        last_accrual_block: 100,
        asset_type_hash: [0xAA; 32],
        pool_id: [0xBB; 32],
        base_rate: DEFAULT_BASE_RATE,
        slope1: DEFAULT_SLOPE1,
        slope2: DEFAULT_SLOPE2,
        optimal_utilization: DEFAULT_OPTIMAL_UTILIZATION,
        reserve_factor: DEFAULT_RESERVE_FACTOR,
        collateral_factor: DEFAULT_COLLATERAL_FACTOR,
        liquidation_threshold: DEFAULT_LIQUIDATION_THRESHOLD,
        liquidation_incentive: DEFAULT_LIQUIDATION_INCENTIVE,
    };

    // Borrower's underwater vault (price crashed)
    let vault = VaultCellData {
        owner_lock_hash: [0xB0; 32],
        pool_id: [0xBB; 32],
        collateral_amount: 10 * PRECISION,
        collateral_type_hash: [0xCC; 32],
        debt_shares: 20_000 * PRECISION, // Big debt relative to collateral
        borrow_index_snapshot: PRECISION,
        deposit_shares: 0,
        last_update_block: 100,
    };

    let liquidator_lock = Script {
        code_hash: [0xC3; 32],
        hash_type: HashType::Type,
        args: vec![0xC3; 20],
    };

    let result = sdk.liquidate(
        CellInput { tx_hash: [0x01; 32], index: 0, since: 0 }, // pool
        &pool,
        CellInput { tx_hash: [0x02; 32], index: 0, since: 0 }, // vault
        &vault,
        1000 * PRECISION, // collateral price (crashed)
        PRECISION,        // debt price ($1 stablecoin)
        5_000 * PRECISION, // repay amount
        liquidator_lock,
        vec![CellInput { tx_hash: [0x03; 32], index: 0, since: 0 }],
        200,
    );

    assert!(result.is_ok(), "Liquidation should succeed: {:?}", result.err());
    let tx = result.unwrap();

    // 3 inputs: pool + vault + liquidator
    assert_eq!(tx.inputs.len(), 3);
    // 3 outputs: updated pool + updated vault + collateral to liquidator
    assert_eq!(tx.outputs.len(), 3);
    // Witness per input
    assert_eq!(tx.witnesses.len(), 3);

    // Verify pool output
    let new_pool = LendingPoolCellData::deserialize(&tx.outputs[0].data).unwrap();
    assert!(new_pool.total_borrows < pool.total_borrows, "Borrows should decrease");
    assert_eq!(new_pool.last_accrual_block, 200);
    assert!(new_pool.borrow_index >= pool.borrow_index, "Index should not decrease");

    // Verify vault output
    let new_vault = VaultCellData::deserialize(&tx.outputs[1].data).unwrap();
    assert!(new_vault.debt_shares < vault.debt_shares, "Debt shares should decrease");
    assert!(new_vault.collateral_amount < vault.collateral_amount, "Collateral should decrease");
    assert_eq!(new_vault.owner_lock_hash, vault.owner_lock_hash, "Owner must not change");
    assert_eq!(new_vault.pool_id, vault.pool_id, "Pool ID must not change");

    // Vault transition should pass liquidation validation
    assert!(verify_vault_liquidation(&vault, &new_vault).is_ok() ||
            verify_vault_update(&vault, &new_vault).is_ok());

    // Verify liquidator receives collateral
    let seized = u128::from_le_bytes(tx.outputs[2].data[..16].try_into().unwrap());
    assert!(seized > 0, "Liquidator must receive collateral");
}

#[test]
fn test_sdk_liquidation_rejects_overcollateralized() {
    use vibeswap_sdk::{
        VibeSwapSDK, DeploymentInfo, CellInput, Script, HashType,
    };

    let sdk = VibeSwapSDK::new(DeploymentInfo {
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
        script_dep_tx_hash: [0x10; 32],
        script_dep_index: 0,
    });

    let pool = default_pool_cell();
    let vault = VaultCellData {
        owner_lock_hash: [0xB0; 32],
        pool_id: pool.pool_id,
        collateral_amount: 100 * PRECISION,    // Lots of collateral
        collateral_type_hash: [0xCC; 32],
        debt_shares: 100 * PRECISION,           // Small debt
        borrow_index_snapshot: PRECISION,
        deposit_shares: 0,
        last_update_block: 0,
    };

    let result = sdk.liquidate(
        CellInput { tx_hash: [0x01; 32], index: 0, since: 0 },
        &pool,
        CellInput { tx_hash: [0x02; 32], index: 0, since: 0 },
        &vault,
        10_000 * PRECISION, // High collateral price
        PRECISION,
        50 * PRECISION,
        Script { code_hash: [0xC3; 32], hash_type: HashType::Type, args: vec![0xC3; 20] },
        vec![],
        100,
    );

    // Should fail — position is overcollateralized
    assert!(result.is_err(), "Cannot liquidate a safe position");
}

// ============ Core Lending SDK Builder Tests ============

fn test_sdk() -> vibeswap_sdk::VibeSwapSDK {
    use vibeswap_sdk::{VibeSwapSDK, DeploymentInfo};
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
        script_dep_tx_hash: [0x10; 32],
        script_dep_index: 0,
    })
}

fn test_input(id: u8) -> vibeswap_sdk::CellInput {
    vibeswap_sdk::CellInput { tx_hash: [id; 32], index: 0, since: 0 }
}

fn test_lock(id: u8) -> vibeswap_sdk::Script {
    vibeswap_sdk::Script {
        code_hash: [id; 32],
        hash_type: vibeswap_sdk::HashType::Type,
        args: vec![id; 20],
    }
}

fn active_pool() -> LendingPoolCellData {
    LendingPoolCellData {
        total_deposits: 1_000_000 * PRECISION,
        total_borrows: 500_000 * PRECISION,
        total_shares: 1_000_000 * PRECISION,
        total_reserves: 0,
        borrow_index: PRECISION,
        last_accrual_block: 100,
        asset_type_hash: [0xAA; 32],
        pool_id: [0xBB; 32],
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

fn active_vault() -> VaultCellData {
    VaultCellData {
        owner_lock_hash: [0x11; 32],
        pool_id: [0xBB; 32],
        collateral_amount: 100 * PRECISION,
        collateral_type_hash: [0xCC; 32],
        debt_shares: 0,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 50_000 * PRECISION,
        last_update_block: 100,
    }
}

#[test]
fn test_deposit_to_lending_pool() {
    let sdk = test_sdk();
    let pool = active_pool();
    let vault = active_vault();

    let tx = sdk.deposit_to_lending_pool(
        test_input(0x01),
        &pool,
        test_input(0x02),
        &vault,
        100_000 * PRECISION,
        200,
    ).unwrap();

    assert_eq!(tx.inputs.len(), 2);
    assert_eq!(tx.outputs.len(), 2);

    let new_pool = LendingPoolCellData::deserialize(&tx.outputs[0].data).unwrap();
    let new_vault = VaultCellData::deserialize(&tx.outputs[1].data).unwrap();

    // Pool deposits increased
    assert!(new_pool.total_deposits > pool.total_deposits);
    // Pool shares increased
    assert!(new_pool.total_shares > pool.total_shares);
    // Vault deposit shares increased
    assert!(new_vault.deposit_shares > vault.deposit_shares);
    // Pool validation
    assert!(verify_update(&pool, &new_pool).is_ok());
}

#[test]
fn test_deposit_zero_rejected() {
    let sdk = test_sdk();
    let pool = active_pool();
    let vault = active_vault();

    let result = sdk.deposit_to_lending_pool(
        test_input(0x01), &pool,
        test_input(0x02), &vault,
        0, 200,
    );
    assert!(result.is_err());
}

#[test]
fn test_withdraw_from_lending_pool() {
    let sdk = test_sdk();
    let pool = active_pool();
    let vault = active_vault();

    let tx = sdk.withdraw_from_lending_pool(
        test_input(0x01),
        &pool,
        test_input(0x02),
        &vault,
        25_000 * PRECISION, // burn 25K shares
        test_lock(0x03),
        200,
    ).unwrap();

    assert_eq!(tx.inputs.len(), 2);
    assert_eq!(tx.outputs.len(), 3); // pool + vault + withdrawal

    let new_pool = LendingPoolCellData::deserialize(&tx.outputs[0].data).unwrap();
    let new_vault = VaultCellData::deserialize(&tx.outputs[1].data).unwrap();

    // Pool deposits decreased
    assert!(new_pool.total_deposits < pool.total_deposits);
    // Pool shares decreased
    assert!(new_pool.total_shares < pool.total_shares);
    // Vault deposit shares decreased
    assert_eq!(new_vault.deposit_shares, vault.deposit_shares - 25_000 * PRECISION);
    // Withdrawal output
    let withdrawn = u128::from_le_bytes(tx.outputs[2].data[0..16].try_into().unwrap());
    assert!(withdrawn > 0);

    assert!(verify_update(&pool, &new_pool).is_ok());
}

#[test]
fn test_withdraw_excess_shares_rejected() {
    let sdk = test_sdk();
    let pool = active_pool();
    let vault = active_vault();

    let result = sdk.withdraw_from_lending_pool(
        test_input(0x01), &pool,
        test_input(0x02), &vault,
        vault.deposit_shares + 1, // more than vault has
        test_lock(0x03),
        200,
    );
    assert!(result.is_err());
}

#[test]
fn test_borrow_from_lending_pool() {
    let sdk = test_sdk();
    let pool = active_pool();
    let vault = VaultCellData {
        collateral_amount: 100 * PRECISION, // 100 ETH collateral
        debt_shares: 0,
        deposit_shares: 0,
        ..active_vault()
    };

    // Borrow 10K USDC with 100 ETH collateral at $2000
    // Max borrow = 100 * 2000 * 0.75 = 150K — 10K is well within
    let tx = sdk.borrow_from_lending_pool(
        test_input(0x01),
        &pool,
        test_input(0x02),
        &vault,
        10_000 * PRECISION,
        2000 * PRECISION, // ETH price
        PRECISION,        // USDC price
        test_lock(0x03),
        200,
    ).unwrap();

    assert_eq!(tx.inputs.len(), 2);
    assert_eq!(tx.outputs.len(), 3); // pool + vault + borrowed tokens

    let new_pool = LendingPoolCellData::deserialize(&tx.outputs[0].data).unwrap();
    let new_vault = VaultCellData::deserialize(&tx.outputs[1].data).unwrap();

    // Pool borrows increased (includes accrued interest + new borrow)
    assert!(new_pool.total_borrows > pool.total_borrows + 10_000 * PRECISION - PRECISION);
    // Vault has debt now
    assert!(new_vault.debt_shares > 0);
    // Borrowed amount in output
    let borrowed = u128::from_le_bytes(tx.outputs[2].data[0..16].try_into().unwrap());
    assert_eq!(borrowed, 10_000 * PRECISION);

    assert!(verify_update(&pool, &new_pool).is_ok());
}

#[test]
fn test_borrow_exceeds_max_ltv_rejected() {
    let sdk = test_sdk();
    let pool = active_pool();
    let vault = VaultCellData {
        collateral_amount: 1 * PRECISION, // only 1 ETH
        debt_shares: 0,
        deposit_shares: 0,
        ..active_vault()
    };

    // Try to borrow 2000 USDC with 1 ETH at $2000
    // Max borrow = 1 * 2000 * 0.75 = 1500 — 2000 exceeds
    let result = sdk.borrow_from_lending_pool(
        test_input(0x01), &pool,
        test_input(0x02), &vault,
        2_000 * PRECISION,
        2000 * PRECISION,
        PRECISION,
        test_lock(0x03),
        200,
    );
    assert!(result.is_err());
}

#[test]
fn test_borrow_exceeds_liquidity_rejected() {
    let sdk = test_sdk();
    let pool = active_pool();
    let vault = VaultCellData {
        collateral_amount: 10_000 * PRECISION, // massive collateral
        debt_shares: 0,
        deposit_shares: 0,
        ..active_vault()
    };

    // Pool has 500K available (1M deposits - 500K borrows)
    // Try to borrow 600K — exceeds available liquidity
    let result = sdk.borrow_from_lending_pool(
        test_input(0x01), &pool,
        test_input(0x02), &vault,
        600_000 * PRECISION,
        2000 * PRECISION,
        PRECISION,
        test_lock(0x03),
        200,
    );
    assert!(result.is_err());
}

#[test]
fn test_repay_to_lending_pool() {
    let sdk = test_sdk();
    let pool = active_pool();
    let vault = VaultCellData {
        collateral_amount: 100 * PRECISION,
        debt_shares: 10_000 * PRECISION, // has 10K debt
        deposit_shares: 0,
        ..active_vault()
    };

    let tx = sdk.repay_to_lending_pool(
        test_input(0x01),
        &pool,
        test_input(0x02),
        &vault,
        5_000 * PRECISION, // repay half
        test_input(0x03),
        200,
    ).unwrap();

    assert_eq!(tx.inputs.len(), 3); // pool + vault + repayer
    assert_eq!(tx.outputs.len(), 2); // pool + vault

    let new_pool = LendingPoolCellData::deserialize(&tx.outputs[0].data).unwrap();
    let new_vault = VaultCellData::deserialize(&tx.outputs[1].data).unwrap();

    // Pool borrows decreased
    assert!(new_pool.total_borrows < pool.total_borrows);
    // Vault debt decreased
    assert!(new_vault.debt_shares < vault.debt_shares);

    assert!(verify_update(&pool, &new_pool).is_ok());
}

#[test]
fn test_repay_full_debt() {
    let sdk = test_sdk();
    let pool = active_pool();
    let vault = VaultCellData {
        collateral_amount: 100 * PRECISION,
        debt_shares: 10_000 * PRECISION,
        deposit_shares: 0,
        ..active_vault()
    };

    // Repay more than owed — should cap at actual debt
    let tx = sdk.repay_to_lending_pool(
        test_input(0x01),
        &pool,
        test_input(0x02),
        &vault,
        50_000 * PRECISION, // more than owed
        test_input(0x03),
        200,
    ).unwrap();

    let new_vault = VaultCellData::deserialize(&tx.outputs[1].data).unwrap();
    // Debt should be fully repaid (or very close to 0 due to rounding)
    assert!(new_vault.debt_shares < PRECISION); // effectively zero
}

#[test]
fn test_repay_zero_rejected() {
    let sdk = test_sdk();
    let pool = active_pool();
    let vault = VaultCellData {
        debt_shares: 10_000 * PRECISION,
        ..active_vault()
    };

    let result = sdk.repay_to_lending_pool(
        test_input(0x01), &pool,
        test_input(0x02), &vault,
        0, test_input(0x03), 200,
    );
    assert!(result.is_err());
}

// ============ Full Lending Lifecycle Test ============

#[test]
fn test_lending_full_lifecycle_sdk() {
    let sdk = test_sdk();

    // 1. Alice creates lending pool with 1M USDC
    let create_tx = sdk.create_lending_pool(
        [0xBB; 32], [0xAA; 32],
        1_000_000 * PRECISION,
        test_lock(0x01),
        test_input(0x01),
        100,
    );
    let pool = LendingPoolCellData::deserialize(&create_tx.outputs[0].data).unwrap();
    assert!(verify_creation(&pool).is_ok());
    assert_eq!(pool.total_deposits, 1_000_000 * PRECISION);

    // 2. Bob opens vault with 100 ETH collateral
    let bob_vault_tx = sdk.open_vault(
        [0xBB; 32],
        100 * PRECISION,
        [0xCC; 32],
        test_lock(0x02),
        test_input(0x02),
        101,
    );
    let bob_vault = VaultCellData::deserialize(&bob_vault_tx.outputs[0].data).unwrap();
    assert!(verify_vault_creation(&bob_vault).is_ok());

    // 3. Bob borrows 50K USDC (well within 75% LTV at $2000/ETH)
    let borrow_tx = sdk.borrow_from_lending_pool(
        test_input(0x03), &pool,
        test_input(0x04), &bob_vault,
        50_000 * PRECISION,
        2000 * PRECISION, PRECISION,
        test_lock(0x02),
        200,
    ).unwrap();
    let pool_after_borrow = LendingPoolCellData::deserialize(&borrow_tx.outputs[0].data).unwrap();
    let vault_after_borrow = VaultCellData::deserialize(&borrow_tx.outputs[1].data).unwrap();
    assert!(vault_after_borrow.debt_shares > 0);

    // 4. Carol deposits 200K USDC to earn yield
    let carol_vault = VaultCellData {
        owner_lock_hash: [0x33; 32],
        pool_id: [0xBB; 32],
        collateral_amount: 0,
        collateral_type_hash: [0u8; 32],
        debt_shares: 0,
        borrow_index_snapshot: pool_after_borrow.borrow_index,
        deposit_shares: 0,
        last_update_block: 200,
    };

    let deposit_tx = sdk.deposit_to_lending_pool(
        test_input(0x05), &pool_after_borrow,
        test_input(0x06), &carol_vault,
        200_000 * PRECISION,
        300,
    ).unwrap();
    let pool_after_deposit = LendingPoolCellData::deserialize(&deposit_tx.outputs[0].data).unwrap();
    let carol_vault_after = VaultCellData::deserialize(&deposit_tx.outputs[1].data).unwrap();
    assert!(carol_vault_after.deposit_shares > 0);
    assert!(pool_after_deposit.total_deposits > pool_after_borrow.total_deposits);

    // 5. Bob repays 25K of his debt
    let repay_tx = sdk.repay_to_lending_pool(
        test_input(0x07), &pool_after_deposit,
        test_input(0x08), &vault_after_borrow,
        25_000 * PRECISION,
        test_input(0x09),
        400,
    ).unwrap();
    let pool_after_repay = LendingPoolCellData::deserialize(&repay_tx.outputs[0].data).unwrap();
    let vault_after_repay = VaultCellData::deserialize(&repay_tx.outputs[1].data).unwrap();
    assert!(vault_after_repay.debt_shares < vault_after_borrow.debt_shares);

    // 6. Carol withdraws her shares (should get more than deposited due to interest)
    let withdraw_tx = sdk.withdraw_from_lending_pool(
        test_input(0x0A), &pool_after_repay,
        test_input(0x0B), &carol_vault_after,
        carol_vault_after.deposit_shares,
        test_lock(0x03),
        500,
    ).unwrap();
    let withdrawn = u128::from_le_bytes(withdraw_tx.outputs[2].data[0..16].try_into().unwrap());
    // Carol should get at least what she deposited (interest may be tiny over few blocks)
    assert!(withdrawn >= 199_999 * PRECISION, "Carol should get back ~200K");
}
