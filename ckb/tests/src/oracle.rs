// ============ Oracle Integration Tests ============
// End-to-end testing of oracle price feeds integrated with lending operations.
// Tests the full pipeline: oracle validation → price aggregation →
// borrow/liquidate/keeper with on-chain verifiable prices.

use vibeswap_types::*;
use vibeswap_sdk::oracle::{self, OraclePrice, PricePair};
use vibeswap_sdk::{VibeSwapSDK, DeploymentInfo, CellInput, Script, HashType};
use ckb_lending_math::{
    collateral, PRECISION,
    prevention,
};
use vibeswap_sdk::keeper::{self, KeeperAction};

// ============ Helpers ============

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
        script_dep_tx_hash: [0x10; 32],
        script_dep_index: 0,
    })
}

fn test_input(id: u8) -> CellInput {
    CellInput { tx_hash: [id; 32], index: 0, since: 0 }
}

fn test_lock(id: u8) -> Script {
    Script { code_hash: [id; 32], hash_type: HashType::Type, args: vec![id; 20] }
}

fn eth_pair_id() -> [u8; 32] {
    let mut id = [0u8; 32];
    id[0..4].copy_from_slice(b"ETH\0");
    id
}

fn usdc_pair_id() -> [u8; 32] {
    let mut id = [0u8; 32];
    id[0..5].copy_from_slice(b"USDC\0");
    id
}

fn make_oracle(price: u128, block: u64, confidence: u8, pair_id: [u8; 32]) -> OracleCellData {
    OracleCellData {
        price,
        block_number: block,
        confidence,
        source_hash: [0xAA; 32],
        pair_id,
    }
}

fn make_oracle_price(price: u128, block: u64, confidence: u8, pair_id: [u8; 32], tx_id: u8) -> OraclePrice {
    OraclePrice {
        data: make_oracle(price, block, confidence, pair_id),
        cell_dep: oracle::build_oracle_cell_dep([tx_id; 32], 0),
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

// ============ Oracle → Borrow Integration ============

#[test]
fn test_oracle_validated_borrow() {
    // Full flow: validate oracle → extract price → borrow using validated price
    let sdk = test_sdk();
    let pool = active_pool();
    let vault = VaultCellData {
        owner_lock_hash: [0x11; 32],
        pool_id: [0xBB; 32],
        collateral_amount: 100 * PRECISION,
        collateral_type_hash: [0xCC; 32],
        debt_shares: 0,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 0,
        last_update_block: 100,
    };

    let current_block = 150u64;

    // Step 1: Get and validate oracle prices
    let eth_oracle = make_oracle(2000 * PRECISION, 140, 85, eth_pair_id());
    let usdc_oracle = make_oracle(1 * PRECISION, 142, 90, usdc_pair_id());

    oracle::validate_for_lending(&eth_oracle, &eth_pair_id(), current_block).unwrap();
    oracle::validate_for_lending(&usdc_oracle, &usdc_pair_id(), current_block).unwrap();

    // Step 2: Use validated prices in borrow operation
    let tx = sdk.borrow_from_lending_pool(
        test_input(0x01), &pool,
        test_input(0x02), &vault,
        50_000 * PRECISION,
        eth_oracle.price,
        usdc_oracle.price,
        test_lock(0x03),
        current_block,
    ).unwrap();

    let new_vault = VaultCellData::deserialize(&tx.outputs[1].data).unwrap();
    assert!(new_vault.debt_shares > 0);

    // Step 3: Oracle cell deps would be included in the real transaction
    let eth_dep = oracle::build_oracle_cell_dep([0xE1; 32], 0);
    let usdc_dep = oracle::build_oracle_cell_dep([0xE2; 32], 1);
    assert_eq!(eth_dep.index, 0);
    assert_eq!(usdc_dep.index, 1);
}

#[test]
fn test_stale_oracle_blocks_borrow() {
    let current_block = 300u64;

    // Oracle is 200 blocks old — stale (max 100)
    let stale_eth = make_oracle(2000 * PRECISION, 99, 85, eth_pair_id());

    let result = oracle::validate_for_lending(&stale_eth, &eth_pair_id(), current_block);
    assert!(result.is_err(), "Stale oracle should block borrow");
}

#[test]
fn test_low_confidence_blocks_borrow() {
    let current_block = 150u64;

    // Oracle has low confidence (30 < 50 minimum for lending)
    let low_conf = make_oracle(2000 * PRECISION, 140, 30, eth_pair_id());

    let result = oracle::validate_for_lending(&low_conf, &eth_pair_id(), current_block);
    assert!(result.is_err(), "Low confidence should block lending");

    // But liquidation would still work (lower bar of 25)
    let result = oracle::validate_for_liquidation(&low_conf, &eth_pair_id(), current_block);
    assert!(result.is_ok(), "Liquidation should accept lower confidence");
}

#[test]
fn test_wrong_pair_id_blocks_borrow() {
    let current_block = 150u64;
    let btc_pair = {
        let mut id = [0u8; 32];
        id[0..4].copy_from_slice(b"BTC\0");
        id
    };

    // Oracle has BTC pair_id but we expect ETH
    let wrong_pair = make_oracle(2000 * PRECISION, 140, 85, btc_pair);

    let result = oracle::validate_for_lending(&wrong_pair, &eth_pair_id(), current_block);
    assert!(result.is_err(), "Wrong pair_id should block operation");
}

// ============ Oracle → Liquidation Integration ============

#[test]
fn test_oracle_validated_liquidation() {
    let sdk = test_sdk();
    let pool = LendingPoolCellData {
        total_deposits: 100_000 * PRECISION,
        total_borrows: 50_000 * PRECISION,
        total_shares: 100_000 * PRECISION,
        ..active_pool()
    };

    // Underwater vault — price crashed
    let vault = VaultCellData {
        owner_lock_hash: [0xB0; 32],
        pool_id: pool.pool_id,
        collateral_amount: 10 * PRECISION,
        collateral_type_hash: [0xCC; 32],
        debt_shares: 20_000 * PRECISION,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 0,
        last_update_block: 100,
    };

    let current_block = 150u64;

    // Multiple oracle sources for manipulation resistance
    let eth_oracles = vec![
        make_oracle(1000 * PRECISION, 148, 90, eth_pair_id()),
        make_oracle(1005 * PRECISION, 149, 85, eth_pair_id()),
        make_oracle(998 * PRECISION, 147, 80, eth_pair_id()),
    ];

    // Aggregate → median
    let eth_price = oracle::aggregate_prices(&eth_oracles, &eth_pair_id(), current_block).unwrap();
    assert_eq!(eth_price, 1000 * PRECISION); // Sorted: 998, 1000, 1005 → median = 1000

    let usdc_oracle = make_oracle(1 * PRECISION, 149, 95, usdc_pair_id());
    oracle::validate_for_liquidation(&usdc_oracle, &usdc_pair_id(), current_block).unwrap();

    // Verify vault is actually underwater with aggregated price
    let hf = collateral::health_factor(
        vault.collateral_amount, eth_price,
        vault.debt_shares, usdc_oracle.price,
        pool.liquidation_threshold,
    ).unwrap();
    assert!(hf < PRECISION, "Vault should be underwater at $1000/ETH");

    // Execute liquidation with oracle-validated prices
    let tx = sdk.liquidate(
        test_input(0x01), &pool,
        test_input(0x02), &vault,
        eth_price,
        usdc_oracle.price,
        5000 * PRECISION,
        test_lock(0xC3),
        vec![test_input(0x03)],
        current_block,
    ).unwrap();

    let new_vault = VaultCellData::deserialize(&tx.outputs[1].data).unwrap();
    assert!(new_vault.debt_shares < vault.debt_shares);
    assert!(new_vault.collateral_amount < vault.collateral_amount);
}

#[test]
fn test_oracle_prevents_manipulation_liquidation() {
    // Attacker tries to manipulate one oracle to trigger liquidation
    // But multi-oracle aggregation catches the deviation
    let current_block = 150u64;

    let oracles = vec![
        make_oracle(2000 * PRECISION, 148, 90, eth_pair_id()),
        make_oracle(500 * PRECISION, 149, 80, eth_pair_id()),  // Manipulated!
    ];

    // Deviation: (2000-500)/500 = 300% > 10% max
    let result = oracle::aggregate_prices(&oracles, &eth_pair_id(), current_block);
    assert!(result.is_err(), "Large deviation should block — manipulation detected");
}

// ============ Oracle → Keeper Integration ============

#[test]
fn test_oracle_keeper_risk_assessment() {
    let pool = active_pool();
    let current_block = 150u64;

    // Vault with borderline health
    let vault = VaultCellData {
        owner_lock_hash: [0xB0; 32],
        pool_id: pool.pool_id,
        collateral_amount: 10 * PRECISION,
        collateral_type_hash: [0xCC; 32],
        debt_shares: 12_000 * PRECISION,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 1000 * PRECISION,
        last_update_block: 100,
    };

    // Fresh oracle prices
    let eth_oracle = make_oracle(2000 * PRECISION, 148, 90, eth_pair_id());
    let usdc_oracle = make_oracle(PRECISION, 149, 95, usdc_pair_id());

    oracle::validate_for_lending(&eth_oracle, &eth_pair_id(), current_block).unwrap();
    oracle::validate_for_lending(&usdc_oracle, &usdc_pair_id(), current_block).unwrap();

    // Use oracle prices for keeper assessment
    let assessment = keeper::assess_vault(
        &vault,
        &pool,
        None,
        eth_oracle.price,
        usdc_oracle.price,
    );

    // At $2000: HF = (10 * 2000 * 0.8) / 12000 = 1.33
    // Risk tier should be Warning (1.3-1.5)
    assert!(assessment.health_factor > PRECISION);
    assert!(assessment.health_factor < 150 * PRECISION / 100); // < 1.5
    assert!(matches!(assessment.action,
        KeeperAction::Warn { .. } | KeeperAction::Safe { .. } | KeeperAction::AutoDeleverage { .. }
    ));
}

#[test]
fn test_oracle_price_drop_triggers_escalation() {
    let pool = active_pool();
    let current_block = 150u64;

    let vault = VaultCellData {
        owner_lock_hash: [0xB0; 32],
        pool_id: pool.pool_id,
        collateral_amount: 10 * PRECISION,
        collateral_type_hash: [0xCC; 32],
        debt_shares: 12_000 * PRECISION,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 1000 * PRECISION,
        last_update_block: 100,
    };

    // Price was $2000, now dropped to $1500
    let old_price = 2000 * PRECISION;
    let new_price = 1500 * PRECISION;

    let change_bps = oracle::price_change_bps(old_price, new_price);
    assert_eq!(change_bps, 2500); // 25% drop

    // Reassess with new price
    let assessment = keeper::assess_vault(
        &vault, &pool, None, new_price, PRECISION,
    );

    // At $1500: HF = (10 * 1500 * 0.8) / 12000 = 1.0
    // This is right at the hard liquidation threshold
    assert!(assessment.health_factor <= PRECISION);
}

// ============ Multi-Oracle Scenarios ============

#[test]
fn test_three_source_median_accurate() {
    let current_block = 200u64;

    // Three exchanges report slightly different ETH prices
    let oracles = vec![
        make_oracle(2998 * PRECISION, 195, 90, eth_pair_id()), // Binance
        make_oracle(3005 * PRECISION, 196, 85, eth_pair_id()), // Coinbase
        make_oracle(3001 * PRECISION, 197, 88, eth_pair_id()), // Kraken
    ];

    let median = oracle::aggregate_prices(&oracles, &eth_pair_id(), current_block).unwrap();
    // Sorted: 2998, 3001, 3005 → median = 3001
    assert_eq!(median, 3001 * PRECISION);
}

#[test]
fn test_weighted_price_favors_high_confidence() {
    let current_block = 200u64;

    let oracles = vec![
        make_oracle(3000 * PRECISION, 195, 95, eth_pair_id()), // High confidence
        make_oracle(3100 * PRECISION, 196, 50, eth_pair_id()), // Low confidence
    ];

    let weighted = oracle::weighted_price(&oracles, &eth_pair_id(), current_block).unwrap();
    // 3000 * 95/145 + 3100 * 50/145 ≈ 3000 * 0.655 + 3100 * 0.345 ≈ 1966 + 1069 ≈ 3034
    assert!(weighted > 3000 * PRECISION);
    assert!(weighted < 3050 * PRECISION); // Closer to 3000 due to higher weight
}

#[test]
fn test_single_oracle_fallback() {
    let current_block = 200u64;

    // Only one oracle available — still works
    let oracles = vec![
        make_oracle(3000 * PRECISION, 198, 80, eth_pair_id()),
    ];

    let median = oracle::aggregate_prices(&oracles, &eth_pair_id(), current_block).unwrap();
    assert_eq!(median, 3000 * PRECISION);

    let weighted = oracle::weighted_price(&oracles, &eth_pair_id(), current_block).unwrap();
    assert_eq!(weighted, 3000 * PRECISION);
}

// ============ Price Pair + Cell Deps ============

#[test]
fn test_price_pair_extraction_and_deps() {
    let pair = PricePair {
        collateral: make_oracle_price(3000 * PRECISION, 195, 90, eth_pair_id(), 0xE1),
        debt: make_oracle_price(1 * PRECISION, 196, 95, usdc_pair_id(), 0xE2),
    };

    // Extract prices
    let (col_price, debt_price) = oracle::extract_prices(&pair);
    assert_eq!(col_price, 3000 * PRECISION);
    assert_eq!(debt_price, 1 * PRECISION);

    // Build cell deps for transaction inclusion
    let deps = oracle::build_price_pair_deps(&pair);
    assert_eq!(deps.len(), 2);
    assert_eq!(deps[0].tx_hash, [0xE1; 32]);
    assert_eq!(deps[1].tx_hash, [0xE2; 32]);

    // Exchange rate
    let rate = oracle::exchange_rate(col_price, debt_price).unwrap();
    assert_eq!(rate, 3000 * PRECISION); // 1 ETH = 3000 USDC
}

// ============ Oracle → Prevention Chain ============

#[test]
fn test_oracle_driven_prevention_cascade() {
    // Full mutualist cascade: oracle detects price drop →
    // keeper assesses → prevention module recommends graduated action
    let pool = active_pool();

    let vault = VaultCellData {
        owner_lock_hash: [0xB0; 32],
        pool_id: pool.pool_id,
        collateral_amount: 10 * PRECISION,
        collateral_type_hash: [0xCC; 32],
        debt_shares: 10_000 * PRECISION,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 5_000 * PRECISION,
        last_update_block: 100,
    };

    // Scenario: ETH slowly drops from $2000 → $1800 → $1500 → $1200 → $900
    let prices = [
        2000 * PRECISION,
        1800 * PRECISION,
        1500 * PRECISION,
        1200 * PRECISION,
        900 * PRECISION,
    ];

    let mut prev_tier = prevention::RiskTier::Safe;
    let mut tiers = Vec::new();

    for &price in &prices {
        let hf = collateral::health_factor(
            vault.collateral_amount, price,
            vault.debt_shares, PRECISION,
            pool.liquidation_threshold,
        ).unwrap();
        let tier = prevention::classify_risk(hf);
        tiers.push((price / PRECISION, hf, tier.clone()));

        // Tier should only escalate or stay the same as price drops
        assert!(
            tier_severity(&tier) >= tier_severity(&prev_tier),
            "Risk should escalate: {:?} -> {:?} at price {}",
            prev_tier, tier, price / PRECISION
        );
        prev_tier = tier;
    }

    // At $2000: HF = (10*2000*0.8)/10000 = 1.6 → Safe
    assert!(matches!(tiers[0].2, prevention::RiskTier::Safe));
    // At $900: HF = (10*900*0.8)/10000 = 0.72 → HardLiquidation
    assert!(matches!(tiers[4].2, prevention::RiskTier::HardLiquidation));
}

fn tier_severity(tier: &prevention::RiskTier) -> u8 {
    match tier {
        prevention::RiskTier::Safe => 0,
        prevention::RiskTier::Warning => 1,
        prevention::RiskTier::AutoDeleverage => 2,
        prevention::RiskTier::SoftLiquidation => 3,
        prevention::RiskTier::HardLiquidation => 4,
    }
}

#[test]
fn test_oracle_price_change_detection() {
    // Keeper monitors oracle updates and flags large price movements
    let old_eth = make_oracle(3000 * PRECISION, 100, 90, eth_pair_id());
    let new_eth = make_oracle(2700 * PRECISION, 200, 90, eth_pair_id());

    let change = oracle::price_change_bps(old_eth.price, new_eth.price);
    assert_eq!(change, 1000); // 10% drop

    // 10% drop should trigger re-assessment of all vaults
    let threshold_bps = 500u64; // Alert on >5% moves
    assert!(change > threshold_bps, "10% drop should trigger keeper action");
}

// ============ Oracle → Insurance Integration ============

#[test]
fn test_oracle_insurance_claim_validation() {
    // Insurance claims need oracle prices to verify the vault is actually at risk
    let pool = active_pool();
    let current_block = 200u64;

    // Vault nearing liquidation
    let vault = VaultCellData {
        owner_lock_hash: [0xB0; 32],
        pool_id: pool.pool_id,
        collateral_amount: 10 * PRECISION,
        collateral_type_hash: [0xCC; 32],
        debt_shares: 13_000 * PRECISION,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 0,
        last_update_block: 100,
    };

    // Oracle reports ETH at $1400
    let eth_oracles = vec![
        make_oracle(1395 * PRECISION, 198, 90, eth_pair_id()),
        make_oracle(1400 * PRECISION, 199, 88, eth_pair_id()),
        make_oracle(1405 * PRECISION, 197, 85, eth_pair_id()),
    ];
    let eth_price = oracle::aggregate_prices(&eth_oracles, &eth_pair_id(), current_block).unwrap();
    assert_eq!(eth_price, 1400 * PRECISION);

    // HF = (10 * 1400 * 0.8) / 13000 = 0.862 → needs insurance
    let hf = collateral::health_factor(
        vault.collateral_amount, eth_price,
        vault.debt_shares, PRECISION,
        pool.liquidation_threshold,
    ).unwrap();
    assert!(hf < PRECISION);

    // Insurance needed to bring HF to 1.3 target
    let target_hf = 130 * PRECISION / 100; // 1.3
    let needed = prevention::insurance_needed(
        vault.collateral_amount, eth_price,
        vault.debt_shares, PRECISION,
        pool.liquidation_threshold, target_hf,
    );
    assert!(needed > 0, "Insurance should be needed when HF < 1.0");

    // After insurance claim, verify HF improvement
    let new_debt = vault.debt_shares - needed;
    let new_hf = collateral::health_factor(
        vault.collateral_amount, eth_price,
        new_debt, PRECISION,
        pool.liquidation_threshold,
    ).unwrap();
    assert!(new_hf > hf, "Insurance claim should improve HF");
}

// ============ Oracle Update + Lending Consistency ============

#[test]
fn test_oracle_update_then_borrow() {
    // Simulate: relayer updates oracle → user borrows with fresh price
    let sdk = test_sdk();

    // Step 1: Update oracle
    let old_oracle = OracleCellData {
        price: 2000 * PRECISION,
        block_number: 100,
        confidence: 80,
        source_hash: [0xAA; 32],
        pair_id: eth_pair_id(),
    };

    let update_tx = sdk.update_oracle(
        test_input(0xE0),
        &old_oracle,
        2500 * PRECISION, // Price went up
        200,
        90,
        [0xAA; 32],
        test_lock(0xF0),
    ).unwrap();

    let updated_oracle = OracleCellData::deserialize(&update_tx.outputs[0].data).unwrap();
    assert_eq!(updated_oracle.price, 2500 * PRECISION);
    assert_eq!(updated_oracle.block_number, 200);
    assert_eq!(updated_oracle.pair_id, eth_pair_id());

    // Step 2: Validate updated oracle for lending
    oracle::validate_for_lending(&updated_oracle, &eth_pair_id(), 250).unwrap();

    // Step 3: Borrow using the updated price
    let pool = active_pool();
    let vault = VaultCellData {
        owner_lock_hash: [0x11; 32],
        pool_id: pool.pool_id,
        collateral_amount: 100 * PRECISION,
        collateral_type_hash: [0xCC; 32],
        debt_shares: 0,
        borrow_index_snapshot: PRECISION,
        deposit_shares: 0,
        last_update_block: 200,
    };

    // Max borrow at $2500: 100 * 2500 * 0.75 = 187,500
    let borrow_tx = sdk.borrow_from_lending_pool(
        test_input(0x01), &pool,
        test_input(0x02), &vault,
        150_000 * PRECISION, // Well within max
        updated_oracle.price,
        PRECISION,
        test_lock(0x03),
        250,
    ).unwrap();

    let borrowed = u128::from_le_bytes(borrow_tx.outputs[2].data[0..16].try_into().unwrap());
    assert_eq!(borrowed, 150_000 * PRECISION);
}

// ============ Stress Test: Oracle → Batch Vault Assessment ============

#[test]
fn test_oracle_batch_vault_assessment() {
    let pool = active_pool();

    // 5 vaults with different risk profiles
    let vaults: Vec<VaultCellData> = (0..5).map(|i| {
        VaultCellData {
            owner_lock_hash: [0x20 + i as u8; 32],
            pool_id: pool.pool_id,
            collateral_amount: 10 * PRECISION,
            collateral_type_hash: [0xCC; 32],
            // Increasing debt = increasing risk
            debt_shares: (5_000 + i * 3_000) as u128 * PRECISION,
            borrow_index_snapshot: PRECISION,
            deposit_shares: 0,
            last_update_block: 100,
        }
    }).collect();

    // Oracle-validated ETH price at $1500
    let eth_price = 1500 * PRECISION;

    // Assess all vaults
    let assessments: Vec<_> = vaults.iter().map(|v| {
        keeper::assess_vault(v, &pool, None, eth_price, PRECISION)
    }).collect();

    // Verify assessments are ordered by risk (increasing debt = decreasing HF)
    for i in 1..assessments.len() {
        assert!(
            assessments[i].health_factor <= assessments[i - 1].health_factor,
            "Higher debt should mean lower HF"
        );
    }

    // First vault (5K debt): HF = (10*1500*0.8)/5000 = 2.4 → Safe
    assert!(matches!(assessments[0].action, KeeperAction::Safe { .. }));

    // Last vault (17K debt): HF = (10*1500*0.8)/17000 = 0.706 → should need action
    assert!(assessments[4].health_factor < PRECISION);
}

// ============ Oracle Exchange Rate for Cross-Asset ============

#[test]
fn test_oracle_exchange_rate_cross_asset() {
    // ETH/BTC exchange rate derived from two oracle prices
    let btc_pair_id = {
        let mut id = [0u8; 32];
        id[0..4].copy_from_slice(b"BTC\0");
        id
    };

    let eth_oracle = make_oracle(3000 * PRECISION, 195, 90, eth_pair_id());
    let btc_oracle = make_oracle(60_000 * PRECISION, 196, 88, btc_pair_id);

    // ETH/BTC = 3000/60000 = 0.05
    let rate = oracle::exchange_rate(eth_oracle.price, btc_oracle.price).unwrap();
    assert_eq!(rate, PRECISION / 20); // 0.05
}

// ============ Edge Cases ============

#[test]
fn test_oracle_zero_price_rejected() {
    let result = oracle::validate_for_lending(
        &make_oracle(0, 100, 90, eth_pair_id()),
        &eth_pair_id(),
        150,
    );
    assert!(result.is_err());
}

#[test]
fn test_oracle_confidence_100_ok() {
    let result = oracle::validate_for_lending(
        &make_oracle(3000 * PRECISION, 100, 100, eth_pair_id()),
        &eth_pair_id(),
        150,
    );
    assert!(result.is_ok());
}

#[test]
fn test_oracle_exactly_at_staleness_boundary() {
    // Block 100, current = 200, max staleness = 100 → exactly at boundary (OK)
    let result = oracle::validate_freshness(
        &make_oracle(3000 * PRECISION, 100, 90, eth_pair_id()),
        200,
    );
    assert!(result.is_ok());

    // Block 99, current = 200 → 101 blocks stale (NOT OK)
    let result = oracle::validate_freshness(
        &make_oracle(3000 * PRECISION, 99, 90, eth_pair_id()),
        200,
    );
    assert!(result.is_err());
}
