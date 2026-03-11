// ============ Assembler Integration Tests ============
// End-to-end tests proving the transaction assembler works with every
// SDK builder function. Each test: build unsigned tx → sign → verify.
//
// This validates the "last mile" — that every builder output can be
// assembled into a valid signed transaction through the signing pipeline.

use vibeswap_types::*;
use vibeswap_math::PRECISION;
use vibeswap_sdk::{
    VibeSwapSDK, DeploymentInfo, Order, CellInput, CellOutput, Script, HashType, DepType,
    CellDep, UnsignedTransaction,
    assembler::{
        WitnessArgs, MockSigner,
        assemble, assemble_single_signer, assemble_with_fee,
        validate_unsigned,
        SECP256K1_SIGNATURE_SIZE, DEFAULT_FEE_RATE, MIN_FEE,
    },
    token::{
        XudtConfig, mint_token, transfer_token, burn_token,
        parse_token_amount,
    },
    collector::{
        LiveCell, merge_cells, split_cell,
    },
};

// ============ Test Helpers ============

fn make_deployment() -> DeploymentInfo {
    DeploymentInfo {
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
    }
}

fn test_xudt_config() -> XudtConfig {
    XudtConfig {
        xudt_code_hash: [0xDD; 32],
        xudt_hash_type: HashType::Data1,
        xudt_cell_dep_tx_hash: [0xEE; 32],
        xudt_cell_dep_index: 0,
        xudt_cell_dep_type: DepType::Code,
    }
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
        index: id as u32,
        since: 0,
    }
}

fn alice_lock() -> Script { test_lock(0xA1) }
fn bob_lock() -> Script { test_lock(0xB0) }
fn alice_signer() -> MockSigner { MockSigner::new(alice_lock()) }
fn bob_signer() -> MockSigner { MockSigner::new(bob_lock()) }

/// Helper: verify a signed transaction has valid structure
fn verify_signed_tx(signed: &vibeswap_sdk::assembler::SignedTransaction) {
    assert!(!signed.inputs.is_empty(), "Must have inputs");
    assert!(!signed.outputs.is_empty(), "Must have outputs");
    assert!(signed.witnesses.len() >= signed.inputs.len(), "Must have witness per input");

    let has_signature = signed.witnesses.iter().any(|w| !w.is_empty());
    assert!(has_signature, "Must have at least one signature witness");

    for w in &signed.witnesses {
        if !w.is_empty() {
            let wa = WitnessArgs::deserialize(w).expect("Should be valid WitnessArgs");
            assert!(wa.lock.is_some(), "WitnessArgs should have lock");
            assert_eq!(wa.lock.unwrap().len(), SECP256K1_SIGNATURE_SIZE);
            break;
        }
    }
}

// ============ Test: Commit Operation → Assemble ============

#[test]
fn test_assemble_commit_transaction() {
    let sdk = VibeSwapSDK::new(make_deployment());
    let order = Order {
        order_type: 0,
        amount_in: 100 * PRECISION,
        limit_price: 2000 * PRECISION,
        priority_bid: 0,
    };
    let secret = [0x42; 32];

    let unsigned = sdk.create_commit(
        &order, &secret,
        200_000_000_000,
        100 * PRECISION,
        [0xAA; 32],
        [0xBB; 32],
        1,
        alice_lock(),
        test_input(0x01),
    );

    validate_unsigned(&unsigned).unwrap();
    let signed = assemble_single_signer(&unsigned, &alice_signer()).unwrap();
    verify_signed_tx(&signed);

    assert_eq!(signed.outputs[0].data.len(), CommitCellData::SERIALIZED_SIZE);
    let commit = CommitCellData::deserialize(&signed.outputs[0].data).unwrap();
    assert_eq!(commit.batch_id, 1);
    assert_eq!(commit.deposit_ckb, 200_000_000_000);
}

// ============ Test: Pool Creation → Assemble ============

#[test]
fn test_assemble_create_pool() {
    let sdk = VibeSwapSDK::new(make_deployment());

    let unsigned = sdk.create_pool(
        [0xAA; 32],
        [0xBB; 32],
        [0xCC; 32],
        1_000 * PRECISION,
        2_000 * PRECISION,
        alice_lock(),
        vec![test_input(0x01), test_input(0x02)],
        100,
    ).unwrap();

    validate_unsigned(&unsigned).unwrap();
    let signed = assemble_single_signer(&unsigned, &alice_signer()).unwrap();
    verify_signed_tx(&signed);

    // Pool creation produces 3 outputs: pool + auction + LP position
    assert_eq!(signed.outputs.len(), 3);
}

// ============ Test: Add Liquidity → Assemble ============

#[test]
fn test_assemble_add_liquidity() {
    let sdk = VibeSwapSDK::new(make_deployment());

    let pool = PoolCellData {
        reserve0: 10_000 * PRECISION,
        reserve1: 20_000 * PRECISION,
        total_lp_supply: 14_142 * PRECISION,
        fee_rate_bps: 30,
        twap_price_cum: 0,
        twap_last_block: 100,
        k_last: [0u8; 32],
        minimum_liquidity: MINIMUM_LIQUIDITY,
        pair_id: [0xAA; 32],
        token0_type_hash: [0xBB; 32],
        token1_type_hash: [0xCC; 32],
    };

    let unsigned = sdk.add_liquidity(
        test_input(0x01),
        &pool,
        1_000 * PRECISION,
        2_000 * PRECISION,
        alice_lock(),
        vec![test_input(0x02)],
        101,
    ).unwrap();

    validate_unsigned(&unsigned).unwrap();
    let signed = assemble_single_signer(&unsigned, &alice_signer()).unwrap();
    verify_signed_tx(&signed);

    // 2 outputs: updated pool + LP position
    assert_eq!(signed.outputs.len(), 2);
}

// ============ Test: Remove Liquidity → Assemble ============

#[test]
fn test_assemble_remove_liquidity() {
    let sdk = VibeSwapSDK::new(make_deployment());

    let pool = PoolCellData {
        reserve0: 10_000 * PRECISION,
        reserve1: 20_000 * PRECISION,
        total_lp_supply: 14_142 * PRECISION,
        fee_rate_bps: 30,
        twap_price_cum: 0,
        twap_last_block: 100,
        k_last: [0u8; 32],
        minimum_liquidity: MINIMUM_LIQUIDITY,
        pair_id: [0xAA; 32],
        token0_type_hash: [0xBB; 32],
        token1_type_hash: [0xCC; 32],
    };

    let lp = LPPositionCellData {
        lp_amount: 1_000 * PRECISION,
        entry_price: 2 * PRECISION,
        pool_id: [0xAA; 32],
        deposit_block: 50,
    };

    let unsigned = sdk.remove_liquidity(
        test_input(0x01),
        &pool,
        test_input(0x02),
        &lp,
        alice_lock(),
        110,
    ).unwrap();

    validate_unsigned(&unsigned).unwrap();
    let signed = assemble_single_signer(&unsigned, &alice_signer()).unwrap();
    verify_signed_tx(&signed);
}

// ============ Test: Mint Token → Assemble ============

#[test]
fn test_assemble_mint_token() {
    let config = test_xudt_config();
    let (unsigned, token_hash) = mint_token(
        &config,
        alice_lock(),
        bob_lock(),
        1_000_000 * PRECISION,
        test_input(0x01),
    );

    validate_unsigned(&unsigned).unwrap();
    let signed = assemble_single_signer(&unsigned, &alice_signer()).unwrap();
    verify_signed_tx(&signed);

    let amount = parse_token_amount(&signed.outputs[0].data).unwrap();
    assert_eq!(amount, 1_000_000 * PRECISION);
    assert_ne!(token_hash, [0u8; 32]);
}

// ============ Test: Transfer Token → Assemble ============

#[test]
fn test_assemble_transfer_token() {
    let config = test_xudt_config();

    let (mint_tx, _) = mint_token(
        &config, alice_lock(), alice_lock(),
        10_000 * PRECISION, test_input(0x01),
    );

    let token_type_script = mint_tx.outputs[0].type_script.clone().unwrap();

    let unsigned = transfer_token(
        &config,
        token_type_script,
        alice_lock(),
        bob_lock(),
        3_000 * PRECISION,
        vec![(CellInput { tx_hash: [0x42; 32], index: 0, since: 0 }, 10_000 * PRECISION)],
    ).unwrap();

    validate_unsigned(&unsigned).unwrap();
    let signed = assemble_single_signer(&unsigned, &alice_signer()).unwrap();
    verify_signed_tx(&signed);

    let recv_amount = parse_token_amount(&signed.outputs[0].data).unwrap();
    assert_eq!(recv_amount, 3_000 * PRECISION);

    let change_amount = parse_token_amount(&signed.outputs[1].data).unwrap();
    assert_eq!(change_amount, 7_000 * PRECISION);
}

// ============ Test: Burn Token → Assemble ============

#[test]
fn test_assemble_burn_token() {
    let config = test_xudt_config();

    let (mint_tx, _) = mint_token(
        &config, alice_lock(), alice_lock(),
        10_000 * PRECISION, test_input(0x01),
    );

    let token_type_script = mint_tx.outputs[0].type_script.clone().unwrap();

    let unsigned = burn_token(
        &config,
        token_type_script,
        2_000 * PRECISION,
        alice_lock(),
        vec![(CellInput { tx_hash: [0x42; 32], index: 0, since: 0 }, 10_000 * PRECISION)],
    ).unwrap();

    validate_unsigned(&unsigned).unwrap();
    let signed = assemble_single_signer(&unsigned, &alice_signer()).unwrap();
    verify_signed_tx(&signed);

    let remaining = parse_token_amount(&signed.outputs[0].data).unwrap();
    assert_eq!(remaining, 8_000 * PRECISION);
}

// ============ Test: Cell Collector → Assemble ============

#[test]
fn test_assemble_merge_cells() {
    let cells: Vec<LiveCell> = (0..5).map(|i| LiveCell {
        tx_hash: [i + 1; 32],
        index: 0,
        capacity: 10_000_000_000,
        data: (1_000u128 * PRECISION).to_le_bytes().to_vec(),
        lock_script: alice_lock(),
        type_script: Some(Script {
            code_hash: [0xDD; 32],
            hash_type: HashType::Data1,
            args: vec![0x42; 36],
        }),
    }).collect();

    let unsigned = merge_cells(&cells, alice_lock()).unwrap();
    validate_unsigned(&unsigned).unwrap();

    let signed = assemble_single_signer(&unsigned, &alice_signer()).unwrap();
    verify_signed_tx(&signed);

    assert_eq!(signed.inputs.len(), 5);
    assert_eq!(signed.outputs.len(), 1);

    let merged = parse_token_amount(&signed.outputs[0].data).unwrap();
    assert_eq!(merged, 5_000 * PRECISION);
}

// ============ Test: Split Cell → Assemble ============

#[test]
fn test_assemble_split_cell() {
    let cell = LiveCell {
        tx_hash: [0x42; 32],
        index: 0,
        capacity: 500_000_000_000,
        data: (10_000u128 * PRECISION).to_le_bytes().to_vec(),
        lock_script: alice_lock(),
        type_script: Some(Script {
            code_hash: [0xDD; 32],
            hash_type: HashType::Data1,
            args: vec![0x42; 36],
        }),
    };

    let splits = vec![3_000 * PRECISION, 3_000 * PRECISION, 4_000 * PRECISION];
    let unsigned = split_cell(&cell, &splits, alice_lock()).unwrap();
    validate_unsigned(&unsigned).unwrap();

    let signed = assemble_single_signer(&unsigned, &alice_signer()).unwrap();
    verify_signed_tx(&signed);

    assert_eq!(signed.outputs.len(), 3);

    let total: u128 = signed.outputs.iter()
        .filter_map(|o| parse_token_amount(&o.data))
        .sum();
    assert_eq!(total, 10_000 * PRECISION);
}

// ============ Test: Multi-Signer Transaction ============

#[test]
fn test_assemble_multi_signer_transaction() {
    let unsigned = UnsignedTransaction {
        cell_deps: vec![CellDep {
            tx_hash: [0xFF; 32],
            index: 0,
            dep_type: DepType::DepGroup,
        }],
        inputs: vec![test_input(0xA1), test_input(0xB0)],
        outputs: vec![
            CellOutput {
                capacity: 100_000_000_000,
                lock_script: alice_lock(),
                type_script: None,
                data: vec![],
            },
            CellOutput {
                capacity: 100_000_000_000,
                lock_script: bob_lock(),
                type_script: None,
                data: vec![],
            },
        ],
        witnesses: vec![vec![], vec![]],
    };

    let signer_a = alice_signer();
    let signer_b = bob_signer();
    let locks = vec![alice_lock(), bob_lock()];

    let signed = assemble(&unsigned, &[&signer_a, &signer_b], &locks).unwrap();
    verify_signed_tx(&signed);

    let wa0 = WitnessArgs::deserialize(&signed.witnesses[0]).unwrap();
    let wa1 = WitnessArgs::deserialize(&signed.witnesses[1]).unwrap();
    assert!(wa0.lock.is_some());
    assert!(wa1.lock.is_some());
    assert_ne!(wa0.lock.unwrap(), wa1.lock.unwrap());
}

// ============ Test: Fee Deduction ============

#[test]
fn test_assemble_with_fee_deduction() {
    let mut unsigned = UnsignedTransaction {
        cell_deps: vec![CellDep {
            tx_hash: [0xFF; 32],
            index: 0,
            dep_type: DepType::DepGroup,
        }],
        inputs: vec![test_input(0x01)],
        outputs: vec![CellOutput {
            capacity: 1_000_000_000_000,
            lock_script: alice_lock(),
            type_script: None,
            data: vec![],
        }],
        witnesses: vec![vec![]],
    };

    let original_cap = unsigned.outputs[0].capacity;
    let signer = alice_signer();
    let locks = vec![alice_lock()];

    let signed = assemble_with_fee(&mut unsigned, &[&signer], &locks, DEFAULT_FEE_RATE).unwrap();

    assert!(signed.outputs[0].capacity < original_cap);
    let fee = original_cap - signed.outputs[0].capacity;
    assert!(fee >= MIN_FEE);
    assert!(fee < 10_000);
}

// ============ Test: Oracle Update → Assemble ============

#[test]
fn test_assemble_oracle_update() {
    let sdk = VibeSwapSDK::new(make_deployment());

    let old_oracle = OracleCellData {
        price: 2000 * PRECISION,
        block_number: 100,
        confidence: 95,
        source_hash: [0x11; 32],
        pair_id: [0xAA; 32],
    };

    let unsigned = sdk.update_oracle(
        test_input(0x01),
        &old_oracle,
        2050 * PRECISION,
        101,
        98,
        [0x22; 32],
        alice_lock(),
    ).unwrap();

    validate_unsigned(&unsigned).unwrap();
    let signed = assemble_single_signer(&unsigned, &alice_signer()).unwrap();
    verify_signed_tx(&signed);

    let oracle = OracleCellData::deserialize(&signed.outputs[0].data).unwrap();
    assert_eq!(oracle.price, 2050 * PRECISION);
    assert_eq!(oracle.block_number, 101);
}

// ============ Test: Lending Pool → Assemble ============

#[test]
fn test_assemble_create_lending_pool() {
    let sdk = VibeSwapSDK::new(make_deployment());

    let unsigned = sdk.create_lending_pool(
        [0xBB; 32], // pool_id
        [0xAA; 32], // asset_type_hash
        1_000 * PRECISION, // initial_deposit
        alice_lock(),
        test_input(0x01),
        100, // block_number
    );

    validate_unsigned(&unsigned).unwrap();
    let signed = assemble_single_signer(&unsigned, &alice_signer()).unwrap();
    verify_signed_tx(&signed);

    assert_eq!(signed.outputs.len(), 2);

    let pool = LendingPoolCellData::deserialize(&signed.outputs[0].data).unwrap();
    assert_eq!(pool.asset_type_hash, [0xAA; 32]);
    assert_eq!(pool.pool_id, [0xBB; 32]);
    assert_eq!(pool.borrow_index, PRECISION);
}

// ============ Test: Vault → Assemble ============

#[test]
fn test_assemble_open_vault() {
    let sdk = VibeSwapSDK::new(make_deployment());

    let unsigned = sdk.open_vault(
        [0xBB; 32], // pool_id
        500 * PRECISION, // collateral_amount
        [0xCC; 32], // collateral_type_hash
        alice_lock(),
        test_input(0x01),
        100, // block_number
    );

    validate_unsigned(&unsigned).unwrap();
    let signed = assemble_single_signer(&unsigned, &alice_signer()).unwrap();
    verify_signed_tx(&signed);

    assert_eq!(signed.outputs.len(), 1);
    let vault = VaultCellData::deserialize(&signed.outputs[0].data).unwrap();
    assert_eq!(vault.pool_id, [0xBB; 32]);
    assert_eq!(vault.collateral_amount, 500 * PRECISION);
}

// ============ Test: Full Pipeline — Mint → Pool → Commit → Sign All ============

#[test]
fn test_full_pipeline_mint_pool_commit_assemble() {
    let sdk = VibeSwapSDK::new(make_deployment());
    let config = test_xudt_config();

    // Step 1: Mint token A
    let (mint_tx_a, token_hash_a) = mint_token(
        &config, alice_lock(), alice_lock(),
        100_000 * PRECISION, test_input(0x01),
    );
    let signed_mint_a = assemble_single_signer(&mint_tx_a, &alice_signer()).unwrap();
    verify_signed_tx(&signed_mint_a);

    // Step 2: Mint token B (different issuer lock)
    let issuer_b_lock = Script {
        code_hash: [0xBB; 32],
        hash_type: HashType::Type,
        args: vec![0xBB; 20],
    };
    let (mint_tx_b, token_hash_b) = mint_token(
        &config, issuer_b_lock.clone(), alice_lock(),
        200_000 * PRECISION, test_input(0x02),
    );
    let signed_mint_b = assemble_single_signer(&mint_tx_b, &MockSigner::new(issuer_b_lock)).unwrap();
    verify_signed_tx(&signed_mint_b);

    // Step 3: Create pool with minted tokens
    let pool_tx = sdk.create_pool(
        [0xAA; 32],
        token_hash_a,
        token_hash_b,
        10_000 * PRECISION,
        20_000 * PRECISION,
        alice_lock(),
        vec![test_input(0x03), test_input(0x04)],
        100,
    ).unwrap();
    let signed_pool = assemble_single_signer(&pool_tx, &alice_signer()).unwrap();
    verify_signed_tx(&signed_pool);

    // Step 4: Commit an order (Bob)
    let order = Order {
        order_type: 0,
        amount_in: 500 * PRECISION,
        limit_price: 2500 * PRECISION,
        priority_bid: 0,
    };
    let secret = [0x99; 32];

    let commit_tx = sdk.create_commit(
        &order, &secret,
        50_000_000_000,
        500 * PRECISION,
        token_hash_a,
        [0xAA; 32],
        1,
        bob_lock(),
        test_input(0x05),
    );
    let signed_commit = assemble_single_signer(&commit_tx, &bob_signer()).unwrap();
    verify_signed_tx(&signed_commit);

    // Verify cross-step consistency
    let commit_data = CommitCellData::deserialize(&signed_commit.outputs[0].data).unwrap();
    assert_eq!(commit_data.token_type_hash, token_hash_a);

    // All 4 transactions have unique tx hashes
    let hashes = [
        signed_mint_a.tx_hash(),
        signed_mint_b.tx_hash(),
        signed_pool.tx_hash(),
        signed_commit.tx_hash(),
    ];
    for i in 0..hashes.len() {
        for j in (i + 1)..hashes.len() {
            assert_ne!(hashes[i], hashes[j], "Tx hashes must be unique");
        }
    }
}

// ============ Test: WitnessArgs Preserves Type Script Witnesses ============

#[test]
fn test_assemble_preserves_type_witnesses() {
    let wa = WitnessArgs {
        lock: None,
        input_type: Some(vec![0xAB; 64]),
        output_type: Some(vec![0xCD; 32]),
    };

    let unsigned = UnsignedTransaction {
        cell_deps: vec![CellDep {
            tx_hash: [0xFF; 32],
            index: 0,
            dep_type: DepType::DepGroup,
        }],
        inputs: vec![test_input(0x01)],
        outputs: vec![CellOutput {
            capacity: 100_000_000_000,
            lock_script: alice_lock(),
            type_script: None,
            data: vec![],
        }],
        witnesses: vec![wa.serialize()],
    };

    let locks = vec![alice_lock()];
    let signed = assemble(&unsigned, &[&alice_signer()], &locks).unwrap();

    let signed_wa = WitnessArgs::deserialize(&signed.witnesses[0]).unwrap();
    assert!(signed_wa.lock.is_some(), "Lock should be filled with signature");
    assert_eq!(signed_wa.input_type.unwrap(), vec![0xAB; 64], "input_type preserved");
    assert_eq!(signed_wa.output_type.unwrap(), vec![0xCD; 32], "output_type preserved");
}

// ============ Test: Transaction Size Estimation ============

#[test]
fn test_tx_size_estimation_consistent() {
    let sdk = VibeSwapSDK::new(make_deployment());

    let order = Order {
        order_type: 0,
        amount_in: 100,
        limit_price: 200,
        priority_bid: 0,
    };

    let commit = sdk.create_commit(
        &order, &[0x42; 32],
        100_000_000_000, 100, [0xAA; 32], [0xBB; 32], 1,
        alice_lock(), test_input(0x01),
    );
    let signed = assemble_single_signer(&commit, &alice_signer()).unwrap();
    let size = signed.estimated_size();
    assert!(size > 100 && size < 100_000, "Commit tx size {} out of range", size);

    let pool = sdk.create_pool(
        [0xAA; 32], [0xBB; 32], [0xCC; 32],
        1000, 2000, alice_lock(),
        vec![test_input(0x02), test_input(0x03)], 100,
    ).unwrap();
    let signed_pool = assemble_single_signer(&pool, &alice_signer()).unwrap();
    let size_pool = signed_pool.estimated_size();
    assert!(size_pool > 100 && size_pool < 100_000, "Pool tx size {} out of range", size_pool);
}

// ============ Test: Idempotent Signing ============

#[test]
fn test_assemble_idempotent() {
    let tx = UnsignedTransaction {
        cell_deps: vec![CellDep {
            tx_hash: [0xFF; 32],
            index: 0,
            dep_type: DepType::DepGroup,
        }],
        inputs: vec![test_input(0x01)],
        outputs: vec![CellOutput {
            capacity: 100_000_000_000,
            lock_script: alice_lock(),
            type_script: None,
            data: vec![],
        }],
        witnesses: vec![vec![]],
    };

    let signer = alice_signer();
    let signed1 = assemble_single_signer(&tx, &signer).unwrap();
    let signed2 = assemble_single_signer(&tx, &signer).unwrap();

    assert_eq!(signed1.tx_hash(), signed2.tx_hash());
    assert_eq!(signed1.witnesses, signed2.witnesses);
}

// ============ Test: Lending Pool + Vault Full Cycle ============

#[test]
fn test_assemble_lending_full_cycle() {
    let sdk = VibeSwapSDK::new(make_deployment());

    // Step 1: Create lending pool
    let pool_tx = sdk.create_lending_pool(
        [0xBB; 32],
        [0xAA; 32],
        10_000 * PRECISION,
        alice_lock(),
        test_input(0x01),
        100,
    );
    let signed_pool = assemble_single_signer(&pool_tx, &alice_signer()).unwrap();
    verify_signed_tx(&signed_pool);

    // Step 2: Bob opens vault with collateral
    let vault_tx = sdk.open_vault(
        [0xBB; 32],
        5_000 * PRECISION,
        [0xCC; 32], // collateral token
        bob_lock(),
        test_input(0x02),
        101,
    );
    let signed_vault = assemble_single_signer(&vault_tx, &bob_signer()).unwrap();
    verify_signed_tx(&signed_vault);

    // Verify pool → vault consistency (same pool_id)
    let pool = LendingPoolCellData::deserialize(&signed_pool.outputs[0].data).unwrap();
    let vault = VaultCellData::deserialize(&signed_vault.outputs[0].data).unwrap();
    assert_eq!(pool.pool_id, vault.pool_id);

    // Different signers = different tx hashes
    assert_ne!(signed_pool.tx_hash(), signed_vault.tx_hash());
}
