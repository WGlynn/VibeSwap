// ============ xUDT Token Integration Tests ============
// End-to-end tests connecting the token SDK module to VibeSwap's
// trading infrastructure. Proves the full pipeline:
// mint xUDT → create pool → commit order → settle batch
//
// These tests verify that the token_type_hash computed during minting
// is the same hash used throughout the trading system.

use vibeswap_types::*;
use vibeswap_math::PRECISION;
use vibeswap_sdk::{
    VibeSwapSDK, DeploymentInfo, Order, CellInput, Script, HashType,
    token::{
        XudtConfig, TokenInfo,
        mint_token, mint_batch, transfer_token, burn_token,
        create_token_info, parse_token_amount, build_xudt_args,
        compute_token_type_hash,
    },
};
use sha2::{Digest, Sha256};

// ============ Test Helpers ============

fn test_xudt_config() -> XudtConfig {
    XudtConfig {
        xudt_code_hash: [0xDD; 32],
        xudt_hash_type: HashType::Data1,
        xudt_cell_dep_tx_hash: [0xEE; 32],
        xudt_cell_dep_index: 0,
        xudt_cell_dep_type: vibeswap_sdk::DepType::Code,
    }
}

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
        prediction_market_type_code_hash: [0x0D; 32],
        script_dep_tx_hash: [0x10; 32],
        script_dep_index: 0,
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
        index: 0,
        since: 0,
    }
}

fn hash_script_sha256(script: &Script) -> [u8; 32] {
    let ht_byte = match script.hash_type {
        HashType::Data => 0u8,
        HashType::Type => 1,
        HashType::Data1 => 2,
        HashType::Data2 => 4,
    };
    let mut hasher = Sha256::new();
    hasher.update(&script.code_hash);
    hasher.update(&[ht_byte]);
    hasher.update(&script.args);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

// ============ Test 1: Mint Token Then Create Pool ============

/// Mints two xUDT tokens (token0 and token1), then creates an AMM pool
/// using their token_type_hashes. Verifies the pool cell correctly
/// references the minted tokens.
#[test]
fn test_mint_tokens_then_create_pool() {
    let xudt_config = test_xudt_config();
    let sdk = VibeSwapSDK::new(make_deployment());

    // Mint token0 (issuer A)
    let issuer_a = test_lock(0x01);
    let (mint_tx_0, token0_type_hash) = mint_token(
        &xudt_config,
        issuer_a.clone(),
        test_lock(0x10), // recipient
        1_000_000 * PRECISION,
        test_input(0x50),
    );
    assert_eq!(parse_token_amount(&mint_tx_0.outputs[0].data).unwrap(), 1_000_000 * PRECISION);

    // Mint token1 (issuer B)
    let issuer_b = test_lock(0x02);
    let (mint_tx_1, token1_type_hash) = mint_token(
        &xudt_config,
        issuer_b.clone(),
        test_lock(0x10),
        2_000_000 * PRECISION,
        test_input(0x51),
    );
    assert_eq!(parse_token_amount(&mint_tx_1.outputs[0].data).unwrap(), 2_000_000 * PRECISION);

    // Different issuers produce different tokens
    assert_ne!(token0_type_hash, token1_type_hash);

    // Create pool using the minted token type hashes
    let pair_id = {
        let mut hasher = Sha256::new();
        hasher.update(&token0_type_hash);
        hasher.update(&token1_type_hash);
        let result = hasher.finalize();
        let mut id = [0u8; 32];
        id.copy_from_slice(&result);
        id
    };

    let pool_tx = sdk.create_pool(
        pair_id,
        token0_type_hash,
        token1_type_hash,
        1_000 * PRECISION,
        2_000 * PRECISION,
        test_lock(0x10),
        vec![test_input(0x60)],
        100,
    ).unwrap();

    // Pool should have 3 outputs: pool, auction, LP
    assert_eq!(pool_tx.outputs.len(), 3);

    // Verify pool data references correct token hashes
    let pool_data = PoolCellData::deserialize(&pool_tx.outputs[0].data).unwrap();
    assert_eq!(pool_data.token0_type_hash, token0_type_hash);
    assert_eq!(pool_data.token1_type_hash, token1_type_hash);
    assert_eq!(pool_data.pair_id, pair_id);
}

// ============ Test 2: Mint → Commit → Verify Token Hash Consistency ============

/// Mints a token, then creates a commit cell referencing that token's
/// type hash. Verifies the commit cell data correctly stores the hash
/// and the hash is consistent with what compute_token_type_hash produces.
#[test]
fn test_mint_then_commit_hash_consistency() {
    let xudt_config = test_xudt_config();
    let sdk = VibeSwapSDK::new(make_deployment());

    // Mint token
    let issuer = test_lock(0x01);
    let (_, token_type_hash) = mint_token(
        &xudt_config,
        issuer.clone(),
        test_lock(0x10),
        1_000_000 * PRECISION,
        test_input(0x50),
    );

    // Verify compute_token_type_hash produces the same hash
    let issuer_lock_hash = hash_script_sha256(&issuer);
    let computed_hash = compute_token_type_hash(
        &xudt_config.xudt_code_hash,
        &xudt_config.xudt_hash_type,
        &issuer_lock_hash,
    );
    assert_eq!(token_type_hash, computed_hash);

    // Create commit using this token
    let order = Order {
        order_type: ORDER_BUY,
        amount_in: 100 * PRECISION,
        limit_price: 2000 * PRECISION,
        priority_bid: 0,
    };
    let secret = [0xAB; 32];

    let commit_tx = sdk.create_commit(
        &order,
        &secret,
        100_000_000_000, // 1000 CKB
        100 * PRECISION,
        token_type_hash,
        [0x01; 32], // pair_id
        0,           // batch_id
        test_lock(0x10),
        test_input(0x60),
    );

    // Verify commit cell contains the correct token type hash
    let commit_data = CommitCellData::deserialize(&commit_tx.outputs[0].data).unwrap();
    assert_eq!(commit_data.token_type_hash, token_type_hash);
    assert_eq!(commit_data.token_amount, 100 * PRECISION);
}

// ============ Test 3: Full Pipeline — Mint → Pool → Commit → Settle ============

/// The grand integration test. Exercises the complete trading pipeline:
/// 1. Mint two tokens
/// 2. Create pool with them
/// 3. Create commit orders referencing the tokens
/// 4. Settle via SDK
/// Verifies token hashes flow consistently through every layer.
#[test]
fn test_full_pipeline_mint_pool_commit_settle() {
    let xudt_config = test_xudt_config();
    let sdk = VibeSwapSDK::new(make_deployment());

    // ---- Step 1: Mint tokens ----
    let (_, token0_hash) = mint_token(
        &xudt_config,
        test_lock(0x01),
        test_lock(0x10),
        10_000_000 * PRECISION,
        test_input(0x50),
    );
    let (_, token1_hash) = mint_token(
        &xudt_config,
        test_lock(0x02),
        test_lock(0x10),
        20_000_000 * PRECISION,
        test_input(0x51),
    );

    // ---- Step 2: Create pool ----
    let pair_id = [0x42; 32];
    let initial_r0 = 100_000 * PRECISION;
    let initial_r1 = 200_000 * PRECISION;

    let pool_tx = sdk.create_pool(
        pair_id,
        token0_hash,
        token1_hash,
        initial_r0,
        initial_r1,
        test_lock(0x10),
        vec![test_input(0x60)],
        100,
    ).unwrap();

    let pool_data = PoolCellData::deserialize(&pool_tx.outputs[0].data).unwrap();
    assert_eq!(pool_data.reserve0, initial_r0);
    assert_eq!(pool_data.reserve1, initial_r1);

    // ---- Step 3: Create commit (buy order) ----
    let buy_order = Order {
        order_type: ORDER_BUY,
        amount_in: 500 * PRECISION,
        limit_price: 2100 * PRECISION,
        priority_bid: 0,
    };
    let buy_secret = [0x11; 32];

    let commit_tx = sdk.create_commit(
        &buy_order,
        &buy_secret,
        100_000_000_000,
        500 * PRECISION,
        token0_hash, // buying token0
        pair_id,
        0,
        test_lock(0x20),
        test_input(0x70),
    );
    let commit_data = CommitCellData::deserialize(&commit_tx.outputs[0].data).unwrap();
    assert_eq!(commit_data.token_type_hash, token0_hash);

    // ---- Step 4: Create reveal ----
    let reveal_data = sdk.create_reveal(&buy_order, &buy_secret, 0);
    let reveal = RevealWitness::deserialize(&reveal_data).unwrap();
    assert_eq!(reveal.order_type, ORDER_BUY);
    assert_eq!(reveal.amount_in, 500 * PRECISION);
    assert_eq!(reveal.secret, buy_secret);

    // ---- Step 5: Settle batch via SDK ----
    let auction = AuctionCellData {
        phase: PHASE_REVEAL,
        batch_id: 0,
        pair_id,
        reveal_count: 1,
        commit_count: 1,
        xor_seed: buy_secret, // Single order, XOR = secret itself
        ..Default::default()
    };

    let sell_order = RevealWitness {
        order_type: ORDER_SELL,
        amount_in: 300 * PRECISION,
        limit_price: 1900 * PRECISION,
        secret: [0x22; 32],
        priority_bid: 0,
        commit_index: 1,
    };

    let pow_proof = vibeswap_pow::PoWProof {
        challenge: [0x33; 32],
        nonce: [0x44; 32],
    };

    let settle_tx = sdk.create_settle_batch(
        test_input(0x80), // auction outpoint
        &auction,
        test_input(0x81), // pool outpoint
        &pool_data,
        &[reveal, sell_order],
        &pow_proof,
        200,
    ).unwrap();

    // Settlement should produce: pool + settled auction + next auction = 3 outputs
    assert_eq!(settle_tx.outputs.len(), 3);

    // Verify pool reserves changed
    let new_pool = PoolCellData::deserialize(&settle_tx.outputs[0].data).unwrap();
    // Pool should have been modified by the trades
    assert!(new_pool.reserve0 != initial_r0 || new_pool.reserve1 != initial_r1,
        "Reserves should change after settlement");

    // Token hashes preserved in settled pool
    assert_eq!(new_pool.token0_type_hash, token0_hash);
    assert_eq!(new_pool.token1_type_hash, token1_hash);
}

// ============ Test 4: Token Transfer Then Deposit To Lending Pool ============

/// Mints tokens, transfers some to a borrower, then uses the token
/// as collateral in a lending vault. Verifies token hashes are
/// consistent between the xUDT module and the lending module.
#[test]
fn test_token_transfer_then_lending_deposit() {
    let xudt_config = test_xudt_config();
    let sdk = VibeSwapSDK::new(make_deployment());

    // Mint collateral token
    let issuer = test_lock(0x01);
    let (_, collateral_hash) = mint_token(
        &xudt_config,
        issuer.clone(),
        test_lock(0x10), // Alice
        1_000_000 * PRECISION,
        test_input(0x50),
    );

    // Alice transfers some to Bob
    let type_script = Script {
        code_hash: xudt_config.xudt_code_hash,
        hash_type: xudt_config.xudt_hash_type.clone(),
        args: build_xudt_args(&hash_script_sha256(&issuer)),
    };

    let transfer_tx = transfer_token(
        &xudt_config,
        type_script,
        test_lock(0x10), // Alice
        test_lock(0x20), // Bob
        300_000 * PRECISION,
        vec![(test_input(0x60), 1_000_000 * PRECISION)],
    ).unwrap();

    assert_eq!(parse_token_amount(&transfer_tx.outputs[0].data).unwrap(), 300_000 * PRECISION);
    assert_eq!(parse_token_amount(&transfer_tx.outputs[1].data).unwrap(), 700_000 * PRECISION);

    // Bob opens a vault with the collateral
    let pool_id = [0x99; 32];
    let vault_tx = sdk.open_vault(
        pool_id,
        300_000 * PRECISION,
        collateral_hash, // Same hash from minting
        test_lock(0x20), // Bob's lock
        test_input(0x70),
        200,
    );

    let vault = VaultCellData::deserialize(&vault_tx.outputs[0].data).unwrap();
    assert_eq!(vault.collateral_type_hash, collateral_hash);
    assert_eq!(vault.collateral_amount, 300_000 * PRECISION);
}

// ============ Test 5: Batch Mint For Airdrop + Pool Bootstrap ============

/// Simulates a token launch: batch mint to multiple users,
/// then use the same token to create a trading pool.
#[test]
fn test_batch_mint_airdrop_then_pool() {
    let xudt_config = test_xudt_config();
    let sdk = VibeSwapSDK::new(make_deployment());

    // Batch mint to 5 recipients
    let issuer = test_lock(0x01);
    let recipients = vec![
        (test_lock(0x10), 10_000 * PRECISION),
        (test_lock(0x11), 20_000 * PRECISION),
        (test_lock(0x12), 30_000 * PRECISION),
        (test_lock(0x13), 40_000 * PRECISION),
        (test_lock(0x14), 50_000 * PRECISION),
    ];

    let (mint_tx, token_hash) = mint_batch(
        &xudt_config,
        issuer,
        &recipients,
        test_input(0x50),
    );

    // Verify all 5 outputs
    assert_eq!(mint_tx.outputs.len(), 5);
    let total_minted: u128 = mint_tx.outputs.iter()
        .map(|o| parse_token_amount(&o.data).unwrap())
        .sum();
    assert_eq!(total_minted, 150_000 * PRECISION);

    // Mint a second token for the pair
    let (_, token1_hash) = mint_token(
        &xudt_config,
        test_lock(0x02),
        test_lock(0x10),
        500_000 * PRECISION,
        test_input(0x51),
    );

    // Create pool with token_hash (from batch mint) and token1_hash
    let pair_id = [0x77; 32];
    let pool_tx = sdk.create_pool(
        pair_id,
        token_hash,
        token1_hash,
        50_000 * PRECISION,
        100_000 * PRECISION,
        test_lock(0x10),
        vec![test_input(0x60)],
        100,
    ).unwrap();

    let pool = PoolCellData::deserialize(&pool_tx.outputs[0].data).unwrap();
    assert_eq!(pool.token0_type_hash, token_hash);
    assert_eq!(pool.token1_type_hash, token1_hash);
}

// ============ Test 6: Token Info Persistence ============

/// Creates a token info cell and verifies metadata roundtrips correctly.
/// Then verifies the token_type_hash in the info cell matches the minted token.
#[test]
fn test_token_info_links_to_minted_token() {
    let xudt_config = test_xudt_config();

    // Mint token
    let issuer = test_lock(0x01);
    let (_, token_hash) = mint_token(
        &xudt_config,
        issuer.clone(),
        test_lock(0x10),
        1_000_000 * PRECISION,
        test_input(0x50),
    );

    // Create info cell
    let info = TokenInfo {
        name: "VibeSwap Governance".to_string(),
        symbol: "VIBE".to_string(),
        decimals: 18,
        description: "Governance token for the VibeSwap DEX protocol".to_string(),
        max_supply: 1_000_000_000 * PRECISION, // 1 billion
    };

    let info_tx = create_token_info(
        &xudt_config,
        token_hash,
        &info,
        issuer,
        test_input(0x51),
    );

    // Verify info data roundtrips
    let parsed = TokenInfo::deserialize(&info_tx.outputs[0].data).unwrap();
    assert_eq!(parsed.name, "VibeSwap Governance");
    assert_eq!(parsed.symbol, "VIBE");
    assert_eq!(parsed.decimals, 18);
    assert_eq!(parsed.max_supply, 1_000_000_000 * PRECISION);

    // Verify info cell's type script args contain the token_type_hash
    let info_type_script = info_tx.outputs[0].type_script.as_ref().unwrap();
    assert_eq!(info_type_script.args, token_hash.to_vec());
}

// ============ Test 7: Burn Tokens Then Verify Supply ============

/// Mints tokens, burns some, verifies the remaining supply is correct.
/// Then creates a pool with the reduced supply amount.
#[test]
fn test_burn_then_pool_with_remaining() {
    let xudt_config = test_xudt_config();
    let sdk = VibeSwapSDK::new(make_deployment());

    // Mint 1M tokens
    let issuer = test_lock(0x01);
    let (_, token_hash) = mint_token(
        &xudt_config,
        issuer.clone(),
        issuer.clone(),
        1_000_000 * PRECISION,
        test_input(0x50),
    );

    // Burn 200k
    let type_script = Script {
        code_hash: xudt_config.xudt_code_hash,
        hash_type: xudt_config.xudt_hash_type.clone(),
        args: build_xudt_args(&hash_script_sha256(&issuer)),
    };

    let burn_tx = burn_token(
        &xudt_config,
        type_script,
        200_000 * PRECISION,
        issuer.clone(),
        vec![(test_input(0x60), 1_000_000 * PRECISION)],
    ).unwrap();

    let remaining = parse_token_amount(&burn_tx.outputs[0].data).unwrap();
    assert_eq!(remaining, 800_000 * PRECISION);

    // Use remaining for pool liquidity
    let (_, token1_hash) = mint_token(
        &xudt_config,
        test_lock(0x02),
        test_lock(0x10),
        1_600_000 * PRECISION,
        test_input(0x51),
    );

    let pool_tx = sdk.create_pool(
        [0x55; 32],
        token_hash,
        token1_hash,
        remaining, // 800k after burn
        1_600_000 * PRECISION,
        issuer,
        vec![test_input(0x70)],
        100,
    ).unwrap();

    let pool = PoolCellData::deserialize(&pool_tx.outputs[0].data).unwrap();
    assert_eq!(pool.reserve0, 800_000 * PRECISION);
    assert_eq!(pool.reserve1, 1_600_000 * PRECISION);
}

// ============ Test 8: Multi-Hop Transfer Chain ============

/// Simulates A → B → C → D transfer chain, verifying amounts
/// are preserved through the UTXO chain and each transfer
/// correctly splits input cells.
#[test]
fn test_multi_hop_transfer_chain() {
    let xudt_config = test_xudt_config();
    let issuer = test_lock(0x01);

    // Mint 10000 to Alice
    let (_, _token_hash) = mint_token(
        &xudt_config,
        issuer.clone(),
        test_lock(0x10), // Alice
        10_000,
        test_input(0x50),
    );

    let type_script = Script {
        code_hash: xudt_config.xudt_code_hash,
        hash_type: xudt_config.xudt_hash_type.clone(),
        args: build_xudt_args(&hash_script_sha256(&issuer)),
    };

    // Alice → Bob: 3000 (change: 7000)
    let tx1 = transfer_token(
        &xudt_config,
        type_script.clone(),
        test_lock(0x10),
        test_lock(0x20),
        3000,
        vec![(test_input(0x60), 10_000)],
    ).unwrap();
    assert_eq!(parse_token_amount(&tx1.outputs[0].data).unwrap(), 3000);
    assert_eq!(parse_token_amount(&tx1.outputs[1].data).unwrap(), 7000);

    // Bob → Charlie: 1500 (change: 1500)
    let tx2 = transfer_token(
        &xudt_config,
        type_script.clone(),
        test_lock(0x20),
        test_lock(0x30),
        1500,
        vec![(test_input(0x61), 3000)], // Bob's cell from tx1
    ).unwrap();
    assert_eq!(parse_token_amount(&tx2.outputs[0].data).unwrap(), 1500);
    assert_eq!(parse_token_amount(&tx2.outputs[1].data).unwrap(), 1500);

    // Charlie → Dave: 1500 (exact, no change)
    let tx3 = transfer_token(
        &xudt_config,
        type_script.clone(),
        test_lock(0x30),
        test_lock(0x40),
        1500,
        vec![(test_input(0x62), 1500)], // Charlie's cell from tx2
    ).unwrap();
    assert_eq!(tx3.outputs.len(), 1); // No change
    assert_eq!(parse_token_amount(&tx3.outputs[0].data).unwrap(), 1500);

    // Conservation: Alice(7000) + Bob(1500) + Dave(1500) = 10000
}

// ============ Test 9: Token Hash Stability Across Operations ============

/// Verifies that token_type_hash remains stable regardless of
/// which operation mints, how much is minted, or who receives it.
/// This is critical: the hash is the token's permanent identity.
#[test]
fn test_token_hash_stability() {
    let xudt_config = test_xudt_config();
    let issuer = test_lock(0x01);

    // Mint different amounts to different recipients
    let (_, hash_a) = mint_token(&xudt_config, issuer.clone(), test_lock(0x10), 100, test_input(0x50));
    let (_, hash_b) = mint_token(&xudt_config, issuer.clone(), test_lock(0x20), 999999, test_input(0x51));
    let (_, hash_c) = mint_batch(&xudt_config, issuer.clone(), &[
        (test_lock(0x30), 1),
        (test_lock(0x40), 2),
    ], test_input(0x52));

    // compute_token_type_hash should match
    let issuer_hash = hash_script_sha256(&issuer);
    let hash_d = compute_token_type_hash(
        &xudt_config.xudt_code_hash,
        &xudt_config.xudt_hash_type,
        &issuer_hash,
    );

    // All hashes from same issuer are identical
    assert_eq!(hash_a, hash_b);
    assert_eq!(hash_b, hash_c);
    assert_eq!(hash_c, hash_d);
}

// ============ Test 10: Lending Pool With Minted Token ============

/// Creates a lending pool using a minted xUDT token as the lendable asset.
/// Verifies asset_type_hash in the pool matches the minted token's hash.
#[test]
fn test_lending_pool_with_minted_asset() {
    let xudt_config = test_xudt_config();
    let sdk = VibeSwapSDK::new(make_deployment());

    // Mint the lending asset
    let issuer = test_lock(0x01);
    let (_, asset_hash) = mint_token(
        &xudt_config,
        issuer,
        test_lock(0x10),
        10_000_000 * PRECISION,
        test_input(0x50),
    );

    // Create lending pool for this asset
    let pool_id = [0xAA; 32];
    let initial_deposit = 1_000_000 * PRECISION;

    let pool_tx = sdk.create_lending_pool(
        pool_id,
        asset_hash, // From mint
        initial_deposit,
        test_lock(0x10),
        test_input(0x60),
        100,
    );

    // Verify pool and vault outputs
    assert_eq!(pool_tx.outputs.len(), 2); // Pool + vault

    let pool = LendingPoolCellData::deserialize(&pool_tx.outputs[0].data).unwrap();
    assert_eq!(pool.asset_type_hash, asset_hash);
    assert_eq!(pool.total_deposits, initial_deposit);
    assert_eq!(pool.pool_id, pool_id);

    let vault = VaultCellData::deserialize(&pool_tx.outputs[1].data).unwrap();
    assert_eq!(vault.pool_id, pool_id);
    assert_eq!(vault.deposit_shares, initial_deposit);
}

// ============ Test 11: Two-Token Lending With Collateral ============

/// Mints two tokens: one for lending, one for collateral.
/// Creates lending pool for the lend token, opens vault with collateral token.
/// Verifies both token hashes are correctly tracked.
#[test]
fn test_two_token_lending_collateral() {
    let xudt_config = test_xudt_config();
    let sdk = VibeSwapSDK::new(make_deployment());

    // Mint lend token (USDC-like)
    let (_, lend_hash) = mint_token(
        &xudt_config,
        test_lock(0x01),
        test_lock(0x10),
        10_000_000 * PRECISION,
        test_input(0x50),
    );

    // Mint collateral token (ETH-like)
    let (_, collateral_hash) = mint_token(
        &xudt_config,
        test_lock(0x02),
        test_lock(0x20),
        5_000 * PRECISION,
        test_input(0x51),
    );

    assert_ne!(lend_hash, collateral_hash);

    // Create lending pool for USDC
    let pool_id = [0xBB; 32];
    let pool_tx = sdk.create_lending_pool(
        pool_id,
        lend_hash,
        5_000_000 * PRECISION,
        test_lock(0x10),
        test_input(0x60),
        100,
    );

    let pool = LendingPoolCellData::deserialize(&pool_tx.outputs[0].data).unwrap();
    assert_eq!(pool.asset_type_hash, lend_hash);

    // Bob opens vault with ETH collateral
    let vault_tx = sdk.open_vault(
        pool_id,
        100 * PRECISION,
        collateral_hash,
        test_lock(0x20),
        test_input(0x70),
        200,
    );

    let vault = VaultCellData::deserialize(&vault_tx.outputs[0].data).unwrap();
    assert_eq!(vault.collateral_type_hash, collateral_hash);
    assert_eq!(vault.pool_id, pool_id);
    assert_ne!(vault.collateral_type_hash, lend_hash); // Different tokens
}

// ============ Test 12: TokenInfo Metadata For Pool Discovery ============

/// Creates token info cells for both tokens in a pair, then creates
/// the pool. Simulates how a frontend would discover token metadata
/// for a given trading pair.
#[test]
fn test_token_info_for_pool_discovery() {
    let xudt_config = test_xudt_config();
    let sdk = VibeSwapSDK::new(make_deployment());

    // Mint and info for token0
    let (_, token0_hash) = mint_token(
        &xudt_config, test_lock(0x01), test_lock(0x10),
        1_000_000 * PRECISION, test_input(0x50),
    );
    let info0 = TokenInfo {
        name: "Wrapped Bitcoin".to_string(),
        symbol: "WBTC".to_string(),
        decimals: 8,
        description: "Tokenized Bitcoin on CKB".to_string(),
        max_supply: 21_000_000 * 100_000_000, // 21M with 8 decimals
    };
    let info0_tx = create_token_info(&xudt_config, token0_hash, &info0, test_lock(0x01), test_input(0x51));

    // Mint and info for token1
    let (_, token1_hash) = mint_token(
        &xudt_config, test_lock(0x02), test_lock(0x10),
        10_000_000_000 * PRECISION, test_input(0x52),
    );
    let info1 = TokenInfo {
        name: "USD Coin".to_string(),
        symbol: "USDC".to_string(),
        decimals: 6,
        description: "Stablecoin pegged to USD".to_string(),
        max_supply: 0, // Unlimited
    };
    let info1_tx = create_token_info(&xudt_config, token1_hash, &info1, test_lock(0x02), test_input(0x53));

    // Create pool
    let pair_id = [0x88; 32];
    let pool_tx = sdk.create_pool(
        pair_id, token0_hash, token1_hash,
        100 * 100_000_000, // 100 WBTC (8 decimals)
        6_000_000 * 1_000_000, // 6M USDC (6 decimals)
        test_lock(0x10), vec![test_input(0x60)], 100,
    ).unwrap();

    let pool = PoolCellData::deserialize(&pool_tx.outputs[0].data).unwrap();

    // Frontend discovery: given pool.token0_type_hash, look up info cell
    // Info cell has type_script.args == token_type_hash
    let info0_link = &info0_tx.outputs[0].type_script.as_ref().unwrap().args;
    assert_eq!(info0_link.as_slice(), &pool.token0_type_hash);

    let info1_link = &info1_tx.outputs[0].type_script.as_ref().unwrap().args;
    assert_eq!(info1_link.as_slice(), &pool.token1_type_hash);

    // Parse metadata
    let meta0 = TokenInfo::deserialize(&info0_tx.outputs[0].data).unwrap();
    let meta1 = TokenInfo::deserialize(&info1_tx.outputs[0].data).unwrap();
    assert_eq!(meta0.symbol, "WBTC");
    assert_eq!(meta1.symbol, "USDC");
    assert_eq!(meta0.decimals, 8);
    assert_eq!(meta1.decimals, 6);
}
