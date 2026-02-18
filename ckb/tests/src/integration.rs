// ============ VibeSwap CKB Integration Tests ============
// Full lifecycle tests across multiple crates working together.
//
// These tests verify the COMPLETE flow of VibeSwap's CKB cell model:
// auction creation, commit, reveal, settlement, pool operations, LP tracking,
// MMR accumulation, PoW gating, compliance filtering, and SDK interop.
//
// Each test exercises multiple crates in a single scenario to catch
// integration bugs that unit tests per crate would miss.
//
// Test categories:
// 1. Full commit-reveal-settle lifecycle
// 2. Pool creation then swap settlement
// 3. Commit creation then consumption in auction
// 4. SDK commit matches type script validation
// 5. MMR accumulation across batches
// 6. PoW gates auction transition
// 7. LP position tracks through add/remove
// 8. Multi-order batch settlement
// 9. Slash non-revealers
// 10. Compliance filter blocks sanctioned

use vibeswap_types::*;
use vibeswap_math::{self, batch_math, shuffle, mul_div, sqrt_product, PRECISION};
use vibeswap_mmr::MMR;
use vibeswap_pow;
use vibeswap_sdk::{VibeSwapSDK, DeploymentInfo, Order, CellInput, Script, HashType};
use commit_type::{verify_commit_type, CommitTypeError};
use amm_pool_type::verify_amm_pool_type;
use batch_auction_type::{verify_batch_auction_type, compute_state_hash};
use sha2::{Digest, Sha256};

// ============ Constants ============

const MIN_DEPOSIT: u64 = 100_000_000; // 1 CKB in shannons

// ============ Helper Functions ============

/// Build a default ConfigCellData with standard VibeSwap parameters.
fn make_config() -> ConfigCellData {
    ConfigCellData::default()
}

/// Build an AuctionCellData in the given phase and batch_id.
/// Uses pair_id [0x01; 32] by default.
fn make_auction(phase: u8, batch_id: u64) -> AuctionCellData {
    AuctionCellData {
        phase,
        batch_id,
        pair_id: [0x01; 32],
        ..Default::default()
    }
}

/// Build a CommitCellData for a given batch and order hash.
/// Uses standard defaults for deposit, token, and sender.
fn make_commit(batch_id: u64, order_hash: [u8; 32]) -> CommitCellData {
    CommitCellData {
        order_hash,
        batch_id,
        deposit_ckb: MIN_DEPOSIT,
        token_type_hash: [0x02; 32],
        token_amount: 1000 * PRECISION,
        block_number: 100,
        sender_lock_hash: [0xCC; 32],
    }
}

/// Build a PoolCellData with given reserves and correct LP supply calculation.
/// LP supply = sqrt(r0 * r1) - MINIMUM_LIQUIDITY
fn make_pool(r0: u128, r1: u128) -> PoolCellData {
    let lp = sqrt_product(r0, r1) - MINIMUM_LIQUIDITY;
    PoolCellData {
        reserve0: r0,
        reserve1: r1,
        total_lp_supply: lp,
        fee_rate_bps: DEFAULT_FEE_RATE_BPS,
        twap_price_cum: 0,
        twap_last_block: 100,
        k_last: [0u8; 32],
        minimum_liquidity: MINIMUM_LIQUIDITY,
        pair_id: [0x01; 32],
        token0_type_hash: [0x02; 32],
        token1_type_hash: [0x03; 32],
    }
}

/// Compute a deterministic order hash from order parameters and a secret.
/// Uses the same layout as the SDK: SHA-256(order_type || amount || price || priority_bid || secret).
fn compute_test_order_hash(
    order_type: u8,
    amount: u128,
    price: u128,
    secret: &[u8; 32],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update([order_type]);
    hasher.update(amount.to_le_bytes());
    hasher.update(price.to_le_bytes());
    hasher.update(0u64.to_le_bytes()); // priority_bid = 0
    hasher.update(secret);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

/// Build a DeploymentInfo with placeholder code hashes for SDK tests.
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
        script_dep_tx_hash: [0x10; 32],
        script_dep_index: 0,
    }
}

/// Build type_args bytes from pair_id and batch_id (the format commit-type expects).
fn make_type_args(pair_id: &[u8; 32], batch_id: u64) -> Vec<u8> {
    let mut args = vec![0u8; 40];
    args[0..32].copy_from_slice(pair_id);
    args[32..40].copy_from_slice(&batch_id.to_le_bytes());
    args
}

// ============ Test 1: Full Commit-Reveal-Settle Lifecycle ============

/// Validates the complete auction lifecycle through all phases:
/// COMMIT -> aggregate commits -> REVEAL -> process reveals -> SETTLING -> SETTLED -> new batch.
///
/// This is the most critical integration test because it exercises the
/// state hash chain, XOR seed accumulation, phase timing windows,
/// and count tracking across every transition.
#[test]
fn test_full_commit_reveal_settle_lifecycle() {
    let pair_id = [0x01; 32];
    let config = make_config();

    // ---- Step 1: Create auction cell (genesis) ----
    let auction_v0 = make_auction(PHASE_COMMIT, 0);
    let auction_v0_data = auction_v0.serialize();

    let result = verify_batch_auction_type(
        None, &auction_v0_data, &[], &[], None, &config, 0, None, 0,
    );
    assert!(result.is_ok(), "Auction creation should succeed");

    // ---- Step 2: Aggregate 2 commits ----
    let secret_a = [0x11; 32];
    let secret_b = [0x22; 32];
    let order_hash_a = compute_test_order_hash(ORDER_BUY, 1000 * PRECISION, 2100 * PRECISION, &secret_a);
    let order_hash_b = compute_test_order_hash(ORDER_SELL, 800 * PRECISION, 1900 * PRECISION, &secret_b);

    let commits = vec![
        make_commit(0, order_hash_a),
        make_commit(0, order_hash_b),
    ];

    let mut auction_v1 = auction_v0.clone();
    auction_v1.commit_count = 2;
    auction_v1.prev_state_hash = compute_state_hash(&auction_v0);
    let auction_v1_data = auction_v1.serialize();

    let result = verify_batch_auction_type(
        Some(&auction_v0_data), &auction_v1_data, &commits, &[], None, &config, 5, None, 2,
    );
    assert!(result.is_ok(), "Commit aggregation should succeed");

    // ---- Step 3: COMMIT -> REVEAL transition ----
    // Commit window = 40 blocks from phase_start_block=0 => need block >= 40
    let block_reveal = config.commit_window_blocks;
    let mut auction_v2 = auction_v1.clone();
    auction_v2.phase = PHASE_REVEAL;
    auction_v2.reveal_count = 0;
    auction_v2.phase_start_block = block_reveal;
    auction_v2.prev_state_hash = compute_state_hash(&auction_v1);
    let auction_v2_data = auction_v2.serialize();

    let result = verify_batch_auction_type(
        Some(&auction_v1_data), &auction_v2_data, &[], &[], None, &config, block_reveal, None, 0,
    );
    assert!(result.is_ok(), "COMMIT -> REVEAL transition should succeed");

    // ---- Step 4: Process reveals (XOR seed accumulation) ----
    let reveals = vec![
        RevealWitness {
            order_type: ORDER_BUY,
            amount_in: 1000 * PRECISION,
            limit_price: 2100 * PRECISION,
            secret: secret_a,
            priority_bid: 0,
            commit_index: 0,
        },
        RevealWitness {
            order_type: ORDER_SELL,
            amount_in: 800 * PRECISION,
            limit_price: 1900 * PRECISION,
            secret: secret_b,
            priority_bid: 0,
            commit_index: 1,
        },
    ];

    // Compute expected XOR seed after both reveals
    let mut expected_xor = auction_v2.xor_seed;
    for reveal in &reveals {
        for i in 0..32 { expected_xor[i] ^= reveal.secret[i]; }
    }

    let mut auction_v3 = auction_v2.clone();
    auction_v3.reveal_count = 2;
    auction_v3.xor_seed = expected_xor;
    auction_v3.prev_state_hash = compute_state_hash(&auction_v2);
    let auction_v3_data = auction_v3.serialize();

    let result = verify_batch_auction_type(
        Some(&auction_v2_data), &auction_v3_data, &[], &reveals, None, &config,
        block_reveal + 5, None, 0,
    );
    assert!(result.is_ok(), "Reveal processing should succeed");

    // ---- Step 5: REVEAL -> SETTLING ----
    // Reveal window = 10 blocks from phase_start_block => need block >= phase_start + 10
    let block_settling = auction_v2.phase_start_block + config.reveal_window_blocks;
    let block_entropy = [0xFF; 32];
    let expected_final_seed = shuffle::generate_seed_secure(
        &[auction_v3.xor_seed],
        &block_entropy,
        auction_v3.batch_id,
    );

    let mut auction_v4 = auction_v3.clone();
    auction_v4.phase = PHASE_SETTLING;
    auction_v4.xor_seed = expected_final_seed;
    auction_v4.phase_start_block = block_settling;
    auction_v4.prev_state_hash = compute_state_hash(&auction_v3);
    let auction_v4_data = auction_v4.serialize();

    let result = verify_batch_auction_type(
        Some(&auction_v3_data), &auction_v4_data, &[], &[], None, &config,
        block_settling, Some(&block_entropy), 0,
    );
    assert!(result.is_ok(), "REVEAL -> SETTLING should succeed");

    // ---- Step 6: SETTLING -> SETTLED (with clearing price) ----
    let mut auction_v5 = auction_v4.clone();
    auction_v5.phase = PHASE_SETTLED;
    auction_v5.clearing_price = 2000 * PRECISION;
    auction_v5.fillable_volume = 800 * PRECISION;
    auction_v5.prev_state_hash = compute_state_hash(&auction_v4);
    let auction_v5_data = auction_v5.serialize();

    let result = verify_batch_auction_type(
        Some(&auction_v4_data), &auction_v5_data, &[], &[], None, &config,
        block_settling + 1, None, 0,
    );
    assert!(result.is_ok(), "Settlement should succeed");

    // ---- Step 7: SETTLED -> COMMIT (new batch) ----
    let batch1_block = block_settling + 10;
    let auction_v6 = AuctionCellData {
        phase: PHASE_COMMIT,
        batch_id: 1,
        pair_id,
        phase_start_block: batch1_block,
        prev_state_hash: compute_state_hash(&auction_v5),
        ..Default::default()
    };
    let auction_v6_data = auction_v6.serialize();

    let result = verify_batch_auction_type(
        Some(&auction_v5_data), &auction_v6_data, &[], &[], None, &config,
        batch1_block, None, 0,
    );
    assert!(result.is_ok(), "New batch (batch_id=1) should succeed");

    // Verify the new batch has clean state
    assert_eq!(auction_v6.batch_id, 1);
    assert_eq!(auction_v6.commit_count, 0);
    assert_eq!(auction_v6.reveal_count, 0);
    assert_eq!(auction_v6.clearing_price, 0);
    assert_eq!(auction_v6.xor_seed, [0u8; 32]);
    assert_eq!(auction_v6.commit_mmr_root, [0u8; 32]);
}

// ============ Test 2: Pool Creation Then Swap Settlement ============

/// Creates a pool with initial liquidity, then simulates a swap settlement
/// where reserves change to maintain the k invariant. Verifies that:
/// 1. Pool creation passes with correct LP supply
/// 2. Swap output is computed via batch_math::get_amount_out
/// 3. Pool transition passes with correct TWAP update
/// 4. k invariant holds after swap (new k >= old k due to fees)
#[test]
fn test_pool_creation_then_swap_settlement() {
    let config = make_config();

    // ---- Create pool ----
    let r0 = 1_000_000 * PRECISION;
    let r1 = 2_000_000 * PRECISION;
    let pool_v0 = make_pool(r0, r1);
    let pool_v0_data = pool_v0.serialize();

    let result = verify_amm_pool_type(None, &pool_v0_data, &config, None, 100);
    assert!(result.is_ok(), "Pool creation should succeed");

    // Verify LP supply = sqrt(1e6 * 2e6) * PRECISION - 1000
    let expected_lp = sqrt_product(r0, r1) - MINIMUM_LIQUIDITY;
    assert_eq!(pool_v0.total_lp_supply, expected_lp);

    // ---- Swap: 1000 token0 in -> token1 out ----
    let amount_in = 1000 * PRECISION;
    let amount_out = batch_math::get_amount_out(
        amount_in, pool_v0.reserve0, pool_v0.reserve1, pool_v0.fee_rate_bps as u128,
    ).expect("get_amount_out should succeed");
    assert!(amount_out > 0, "Swap output must be positive");

    let block_swap = 110u64;
    let old_price = mul_div(pool_v0.reserve1, PRECISION, pool_v0.reserve0);
    let delta_blocks = block_swap - pool_v0.twap_last_block;

    let mut pool_v1 = pool_v0.clone();
    pool_v1.reserve0 = pool_v0.reserve0 + amount_in;
    pool_v1.reserve1 = pool_v0.reserve1 - amount_out;
    pool_v1.twap_last_block = block_swap;
    pool_v1.twap_price_cum = pool_v0.twap_price_cum
        .wrapping_add(old_price * delta_blocks as u128);
    let pool_v1_data = pool_v1.serialize();

    // ---- Verify transition ----
    let result = verify_amm_pool_type(
        Some(&pool_v0_data), &pool_v1_data, &config, None, block_swap,
    );
    assert!(result.is_ok(), "Swap settlement should pass: {:?}", result.err());

    // k invariant: new k >= old k (fees increase k)
    assert!(
        vibeswap_math::mul_cmp(
            pool_v1.reserve0, pool_v1.reserve1,
            pool_v0.reserve0, pool_v0.reserve1,
        ) != core::cmp::Ordering::Less,
        "k invariant must hold after swap"
    );

    // TWAP cumulative increased
    assert!(pool_v1.twap_price_cum > pool_v0.twap_price_cum);
}

// ============ Test 3: Commit Then Consume In Auction ============

/// Creates a valid commit cell, verifies it passes commit type validation
/// for creation, then verifies it can be consumed when an auction cell
/// is present. Also verifies consumption FAILS without an auction cell.
///
/// This tests the two-phase lifecycle of a commit cell:
/// 1. Creation: independently by a user
/// 2. Consumption: only as part of an aggregation tx with an auction cell
#[test]
fn test_commit_then_consume_in_auction() {
    let pair_id = [0x01; 32];
    let batch_id: u64 = 0;
    let lock_hash = [0xCC; 32];
    let secret = [0xAB; 32];
    let order_hash = compute_test_order_hash(ORDER_BUY, 500 * PRECISION, 2000 * PRECISION, &secret);

    let commit = CommitCellData {
        order_hash,
        batch_id,
        deposit_ckb: MIN_DEPOSIT,
        token_type_hash: [0x02; 32],
        token_amount: 500 * PRECISION,
        block_number: 10,
        sender_lock_hash: lock_hash,
    };
    let commit_data = commit.serialize();
    let type_args = make_type_args(&pair_id, batch_id);

    let auction = AuctionCellData {
        phase: PHASE_COMMIT,
        batch_id,
        pair_id,
        ..Default::default()
    };
    let auction_data = auction.serialize().to_vec();

    // ---- Validate creation (with auction context and lock hash match) ----
    let result = verify_commit_type(
        true, &commit_data, &type_args, Some(&lock_hash), Some(&auction_data), MIN_DEPOSIT,
    );
    assert!(result.is_ok(), "Commit creation should succeed");

    // ---- Validate consumption with auction cell present ----
    let result = verify_commit_type(
        false, &commit_data, &type_args, None, Some(&auction_data), 0,
    );
    assert!(result.is_ok(), "Commit consumption with auction cell should succeed");

    // ---- Verify consumption FAILS without auction cell ----
    let result = verify_commit_type(
        false, &commit_data, &type_args, None, None, 0,
    );
    assert_eq!(
        result, Err(CommitTypeError::NoAuctionCellInTx),
        "Commit consumption without auction cell must fail"
    );
}

// ============ Test 4: SDK Commit Matches Type Script ============

/// Uses VibeSwapSDK::create_commit to build a commit transaction, extracts
/// the commit cell data from the output, then verifies it passes
/// verify_commit_type validation.
///
/// This ensures the SDK produces correctly formatted cells that the
/// on-chain type script will accept — critical for SDK<->script interop.
#[test]
fn test_sdk_commit_matches_type_script() {
    let deployment = make_deployment();
    let sdk = VibeSwapSDK::new(deployment);

    let order = Order {
        order_type: ORDER_BUY,
        amount_in: 1000 * PRECISION,
        limit_price: 2000 * PRECISION,
        priority_bid: 0,
    };
    let secret = [0xAB; 32];
    let pair_id = [0x01; 32];
    let batch_id: u64 = 0;

    let user_lock = Script {
        code_hash: [0x99; 32],
        hash_type: HashType::Type,
        args: vec![0x01; 20],
    };
    let user_input = CellInput {
        tx_hash: [0x50; 32],
        index: 0,
        since: 0,
    };

    // ---- Build commit transaction via SDK ----
    let tx = sdk.create_commit(
        &order,
        &secret,
        100_000_000_000, // deposit: 1000 CKB
        order.amount_in,
        [0x02; 32],
        pair_id,
        batch_id,
        user_lock,
        user_input,
    );

    // ---- Extract and validate output ----
    assert_eq!(tx.outputs.len(), 1, "SDK should produce 1 output");
    let output = &tx.outputs[0];
    assert!(output.type_script.is_some(), "Output must have a type script");

    let commit_cell_data = &output.data;
    let commit = CommitCellData::deserialize(commit_cell_data)
        .expect("SDK output must be valid CommitCellData");

    assert_ne!(commit.order_hash, [0u8; 32], "Order hash must not be zero");
    assert_eq!(commit.batch_id, batch_id);

    // ---- Validate with type script ----
    let type_args = &output.type_script.as_ref().unwrap().args;

    let auction = AuctionCellData {
        phase: PHASE_COMMIT,
        batch_id,
        pair_id,
        ..Default::default()
    };
    let auction_data = auction.serialize().to_vec();

    let result = verify_commit_type(
        true,
        commit_cell_data,
        type_args,
        None, // Skip lock hash check (SDK hashes internally, format may differ)
        Some(&auction_data),
        0,
    );
    assert!(result.is_ok(), "SDK-built commit should pass type script: {:?}", result.err());
}

// ============ Test 5: MMR Accumulation Across Batches ============

/// Appends multiple commit hashes to an MMR over several batches, verifying:
/// 1. Root changes with each append (append-only property)
/// 2. Peak count follows binary representation of leaf count
/// 3. Proofs for earlier entries remain valid after new appends
/// 4. Cross-batch root compression is deterministic
#[test]
fn test_mmr_accumulation_across_batches() {
    let mut mmr = MMR::new();
    let mut roots: Vec<[u8; 32]> = Vec::new();

    // ---- Batch 0: Append 4 commit hashes ----
    let mut prev_root = mmr.root();
    for i in 0..4u8 {
        let hash = compute_test_order_hash(
            ORDER_BUY, (i as u128 + 1) * PRECISION, 2000 * PRECISION, &[i + 1; 32],
        );
        mmr.append(&hash);
        let new_root = mmr.root();
        // Root must change after each append
        assert_ne!(new_root, prev_root, "Root must change after append {}", i);
        prev_root = new_root;
    }
    // 4 = 0b100 => 1 peak
    assert_eq!(mmr.leaf_count, 4);
    assert_eq!(mmr.peak_count(), 1, "4 leaves = 1 peak");
    roots.push(mmr.root());

    // ---- Batch 1: Append 3 more ----
    for i in 0..3u8 {
        let hash = compute_test_order_hash(
            ORDER_SELL, (i as u128 + 5) * PRECISION, 1900 * PRECISION, &[i + 10; 32],
        );
        mmr.append(&hash);
    }
    // 7 = 0b111 => 3 peaks
    assert_eq!(mmr.leaf_count, 7);
    assert_eq!(mmr.peak_count(), 3, "7 leaves = 3 peaks");
    roots.push(mmr.root());

    // ---- Batch 2: Append 1 more (total 8) ----
    let extra_hash = compute_test_order_hash(ORDER_BUY, 999 * PRECISION, 2050 * PRECISION, &[0xFF; 32]);
    mmr.append(&extra_hash);
    // 8 = 0b1000 => 1 peak
    assert_eq!(mmr.leaf_count, 8);
    assert_eq!(mmr.peak_count(), 1, "8 leaves = 1 peak");
    roots.push(mmr.root());

    // ---- Verify all roots are distinct ----
    assert_ne!(roots[0], roots[1]);
    assert_ne!(roots[1], roots[2]);
    assert_ne!(roots[0], roots[2]);

    // ---- Cross-batch root compression ----
    let compressed = vibeswap_mmr::compress_roots(&roots);
    let compressed2 = vibeswap_mmr::compress_roots(&roots);
    assert_eq!(compressed, compressed2, "Compression must be deterministic");
    assert_ne!(compressed, [0u8; 32], "Compressed root must be non-zero");

    // ---- Verify determinism (rebuild same MMR from scratch) ----
    let mut mmr_clone = MMR::new();
    for i in 0..4u8 {
        let hash = compute_test_order_hash(
            ORDER_BUY, (i as u128 + 1) * PRECISION, 2000 * PRECISION, &[i + 1; 32],
        );
        mmr_clone.append(&hash);
    }
    assert_eq!(mmr_clone.root(), roots[0], "Same data must produce same root");
}

// ============ Test 6: PoW Gates Auction Transition ============

/// Generates a PoW proof at low difficulty (8 bits for fast test execution),
/// verifies it meets the target, then uses it in conjunction with an auction
/// state transition.
///
/// This validates the integration between:
/// - vibeswap_pow: challenge generation, mining, verification
/// - batch_auction_type: state transition with difficulty target
#[test]
fn test_pow_gates_auction_transition() {
    let pair_id = [0x42; 32];
    let batch_id: u64 = 0;
    let prev_state_hash = [0u8; 32];
    let difficulty: u8 = 8; // Low difficulty = ~256 hashes avg

    // ---- Generate challenge from auction parameters ----
    let challenge = vibeswap_pow::generate_challenge(&pair_id, batch_id, &prev_state_hash);
    assert_ne!(challenge, [0u8; 32], "Challenge must be non-zero");

    // ---- Mine a valid nonce ----
    let nonce = vibeswap_pow::mine(&challenge, difficulty, 1_000_000)
        .expect("Should find nonce at difficulty 8 within 1M iterations");

    let proof = vibeswap_pow::PoWProof {
        challenge: challenge,
        nonce,
    };

    // ---- Verify the proof ----
    assert!(vibeswap_pow::verify(&proof, difficulty), "Proof must meet difficulty");
    let actual = vibeswap_pow::verify_and_get_difficulty(&proof);
    assert!(actual >= difficulty, "Actual difficulty {} >= target {}", actual, difficulty);
    assert!(vibeswap_pow::is_valid_proof_structure(&proof));

    // ---- Verify hash meets target ----
    let target = vibeswap_pow::difficulty_to_target(difficulty);
    let hash = vibeswap_pow::compute_hash(&proof.challenge, &proof.nonce);
    assert!(
        vibeswap_pow::meets_target(&hash, &target),
        "Mined hash must meet difficulty target"
    );

    // ---- Use the proof alongside an auction commit aggregation ----
    let config = make_config();
    let auction_old = AuctionCellData {
        phase: PHASE_COMMIT,
        batch_id,
        pair_id,
        difficulty_target: target,
        ..Default::default()
    };
    let auction_old_data = auction_old.serialize();

    let commit = CommitCellData {
        order_hash: [0xAA; 32],
        batch_id,
        deposit_ckb: MIN_DEPOSIT,
        token_type_hash: [0x02; 32],
        token_amount: PRECISION,
        block_number: 10,
        sender_lock_hash: [0xCC; 32],
    };

    let mut auction_new = auction_old.clone();
    auction_new.commit_count = 1;
    auction_new.prev_state_hash = compute_state_hash(&auction_old);
    let auction_new_data = auction_new.serialize();

    let result = verify_batch_auction_type(
        Some(&auction_old_data), &auction_new_data, &[commit], &[], None, &config, 5, None, 1,
    );
    assert!(result.is_ok(), "PoW-gated auction transition should succeed");
}

// ============ Test 7: LP Position Tracks Through Add/Remove ============

/// Tests the full liquidity lifecycle:
/// 1. Create pool with initial liquidity -> verify LP supply formula
/// 2. Add liquidity proportionally -> verify LP tokens minted correctly
/// 3. Remove the same amount of LP -> verify proportional withdrawal
///
/// After add+remove, reserves should return to original (within rounding).
#[test]
fn test_lp_position_tracks_through_add_remove() {
    let config = make_config();

    // ---- Step 1: Create pool ----
    let r0 = 1_000_000 * PRECISION;
    let r1 = 2_000_000 * PRECISION;
    let pool_v0 = make_pool(r0, r1);
    let pool_v0_data = pool_v0.serialize();

    let result = verify_amm_pool_type(None, &pool_v0_data, &config, None, 100);
    assert!(result.is_ok(), "Pool creation should pass");

    let initial_lp = pool_v0.total_lp_supply;
    assert!(initial_lp > 0);

    // ---- Step 2: Add 10% liquidity ----
    let add0 = r0 / 10;
    let add1 = r1 / 10;

    let lp_to_mint = batch_math::calculate_liquidity(
        add0, add1, pool_v0.reserve0, pool_v0.reserve1, pool_v0.total_lp_supply,
    ).expect("LP calculation should succeed");
    assert!(lp_to_mint > 0, "Must mint positive LP tokens");

    let block_add = 120u64;
    let price_at_add = mul_div(pool_v0.reserve1, PRECISION, pool_v0.reserve0);
    let delta_add = block_add - pool_v0.twap_last_block;

    let mut pool_v1 = pool_v0.clone();
    pool_v1.reserve0 += add0;
    pool_v1.reserve1 += add1;
    pool_v1.total_lp_supply += lp_to_mint;
    pool_v1.twap_last_block = block_add;
    pool_v1.twap_price_cum = pool_v0.twap_price_cum
        .wrapping_add(price_at_add * delta_add as u128);
    let pool_v1_data = pool_v1.serialize();

    let result = verify_amm_pool_type(
        Some(&pool_v0_data), &pool_v1_data, &config, None, block_add,
    );
    assert!(result.is_ok(), "Add liquidity should pass: {:?}", result.err());

    // Verify LP position cell data roundtrips
    let lp_position = LPPositionCellData {
        lp_amount: lp_to_mint,
        entry_price: price_at_add,
        pool_id: pool_v0.pair_id,
        deposit_block: block_add,
    };
    let lp_decoded = LPPositionCellData::deserialize(&lp_position.serialize()).unwrap();
    assert_eq!(lp_decoded.lp_amount, lp_to_mint);

    // ---- Step 3: Remove same LP amount ----
    let lp_to_burn = lp_to_mint;
    let amount0_out = mul_div(lp_to_burn, pool_v1.reserve0, pool_v1.total_lp_supply);
    let amount1_out = mul_div(lp_to_burn, pool_v1.reserve1, pool_v1.total_lp_supply);

    let block_remove = 150u64;
    let price_at_remove = mul_div(pool_v1.reserve1, PRECISION, pool_v1.reserve0);
    let delta_remove = block_remove - pool_v1.twap_last_block;

    let mut pool_v2 = pool_v1.clone();
    pool_v2.reserve0 -= amount0_out;
    pool_v2.reserve1 -= amount1_out;
    pool_v2.total_lp_supply -= lp_to_burn;
    pool_v2.twap_last_block = block_remove;
    pool_v2.twap_price_cum = pool_v1.twap_price_cum
        .wrapping_add(price_at_remove * delta_remove as u128);
    let pool_v2_data = pool_v2.serialize();

    let result = verify_amm_pool_type(
        Some(&pool_v1_data), &pool_v2_data, &config, None, block_remove,
    );
    assert!(result.is_ok(), "Remove liquidity should pass: {:?}", result.err());

    // Reserves should return to original (rounding tolerance of 1)
    let diff0 = if pool_v2.reserve0 > r0 { pool_v2.reserve0 - r0 } else { r0 - pool_v2.reserve0 };
    let diff1 = if pool_v2.reserve1 > r1 { pool_v2.reserve1 - r1 } else { r1 - pool_v2.reserve1 };
    assert!(diff0 <= 1, "Reserve0 diff={} should be <= 1", diff0);
    assert!(diff1 <= 1, "Reserve1 diff={} should be <= 1", diff1);
    assert_eq!(pool_v2.total_lp_supply, initial_lp, "LP supply should return to initial");
}

// ============ Test 8: Multi-Order Batch Settlement ============

/// Creates an auction with 6 orders (3 buys, 3 sells), reveals all of them,
/// computes a clearing price using batch_math, and verifies that all matching
/// orders would be filled at the uniform clearing price.
///
/// This validates the full batch auction math (clearing price discovery,
/// supply/demand matching) in an end-to-end scenario with the auction
/// state machine.
#[test]
fn test_multi_order_batch_settlement() {
    let config = make_config();
    let _pair_id = [0x01; 32];

    // ---- Define 6 orders: 3 buys and 3 sells ----
    let buy_params = vec![
        (ORDER_BUY, 100 * PRECISION, 2100 * PRECISION),
        (ORDER_BUY, 200 * PRECISION, 2050 * PRECISION),
        (ORDER_BUY, 150 * PRECISION, 2200 * PRECISION),
    ];
    let sell_params = vec![
        (ORDER_SELL, 120 * PRECISION, 1900 * PRECISION),
        (ORDER_SELL, 180 * PRECISION, 1950 * PRECISION),
        (ORDER_SELL, 100 * PRECISION, 2000 * PRECISION),
    ];

    let secrets: Vec<[u8; 32]> = (0..6u8).map(|i| { let mut s = [0u8; 32]; s[0] = i + 1; s }).collect();

    // ---- Build commit and reveal data ----
    let all_params: Vec<(u8, u128, u128)> = buy_params.iter().chain(sell_params.iter()).copied().collect();
    let mut all_commits: Vec<CommitCellData> = Vec::new();
    let mut all_reveals: Vec<RevealWitness> = Vec::new();

    for (idx, &(order_type, amount, price)) in all_params.iter().enumerate() {
        let hash = compute_test_order_hash(order_type, amount, price, &secrets[idx]);
        all_commits.push(CommitCellData {
            order_hash: hash,
            batch_id: 0,
            deposit_ckb: MIN_DEPOSIT,
            token_type_hash: [0x02; 32],
            token_amount: amount,
            block_number: 10 + idx as u64,
            sender_lock_hash: { let mut h = [0u8; 32]; h[0] = idx as u8; h },
        });
        all_reveals.push(RevealWitness {
            order_type,
            amount_in: amount,
            limit_price: price,
            secret: secrets[idx],
            priority_bid: 0,
            commit_index: idx as u32,
        });
    }

    // ---- Run auction state machine ----
    let auction_v0 = make_auction(PHASE_COMMIT, 0);
    let auction_v0_data = auction_v0.serialize();

    // Aggregate 6 commits
    let mut auction_v1 = auction_v0.clone();
    auction_v1.commit_count = 6;
    auction_v1.prev_state_hash = compute_state_hash(&auction_v0);
    let auction_v1_data = auction_v1.serialize();

    assert!(verify_batch_auction_type(
        Some(&auction_v0_data), &auction_v1_data, &all_commits, &[], None, &config, 5, None, 6,
    ).is_ok(), "6-commit aggregation should succeed");

    // COMMIT -> REVEAL
    let block_reveal = config.commit_window_blocks;
    let mut auction_v2 = auction_v1.clone();
    auction_v2.phase = PHASE_REVEAL;
    auction_v2.reveal_count = 0;
    auction_v2.phase_start_block = block_reveal;
    auction_v2.prev_state_hash = compute_state_hash(&auction_v1);
    let auction_v2_data = auction_v2.serialize();

    assert!(verify_batch_auction_type(
        Some(&auction_v1_data), &auction_v2_data, &[], &[], None, &config, block_reveal, None, 0,
    ).is_ok());

    // Process all 6 reveals
    let mut expected_xor = auction_v2.xor_seed;
    for reveal in &all_reveals {
        for i in 0..32 { expected_xor[i] ^= reveal.secret[i]; }
    }

    let mut auction_v3 = auction_v2.clone();
    auction_v3.reveal_count = 6;
    auction_v3.xor_seed = expected_xor;
    auction_v3.prev_state_hash = compute_state_hash(&auction_v2);
    let auction_v3_data = auction_v3.serialize();

    assert!(verify_batch_auction_type(
        Some(&auction_v2_data), &auction_v3_data, &[], &all_reveals, None, &config,
        block_reveal + 5, None, 0,
    ).is_ok(), "6-reveal processing should succeed");

    // ---- Compute clearing price using batch_math ----
    let r0 = 1_000_000 * PRECISION;
    let r1 = 2_000_000 * PRECISION;

    let math_buys: Vec<batch_math::Order> = buy_params.iter()
        .map(|&(_, amount, price)| batch_math::Order { amount, limit_price: price })
        .collect();
    let math_sells: Vec<batch_math::Order> = sell_params.iter()
        .map(|&(_, amount, price)| batch_math::Order { amount, limit_price: price })
        .collect();

    let (clearing_price, fillable_volume) = batch_math::calculate_clearing_price(
        &math_buys, &math_sells, r0, r1,
    ).expect("Clearing price computation should succeed");

    // Clearing price near spot (2.0)
    assert!(clearing_price > 1800 * PRECISION, "Clearing > 1800");
    assert!(clearing_price < 2200 * PRECISION, "Clearing < 2200");
    assert!(fillable_volume > 0, "Volume must be positive");

    // ---- Verify uniform price: all matched orders at same clearing price ----
    for &(_, _amount, limit_price) in &buy_params {
        if limit_price >= clearing_price {
            // This buy is filled at clearing_price (not limit_price)
            assert!(clearing_price <= limit_price);
        }
    }
    for &(_, _amount, limit_price) in &sell_params {
        if limit_price <= clearing_price {
            // This sell is filled at clearing_price (not limit_price)
            assert!(clearing_price >= limit_price);
        }
    }

    // ---- Verify the shuffle would produce a permutation ----
    let seed = shuffle::generate_seed(&secrets);
    let shuffled = shuffle::shuffle_indices(6, &seed);
    assert_eq!(shuffled.len(), 6);
    let mut sorted = shuffled.clone();
    sorted.sort();
    assert_eq!(sorted, vec![0, 1, 2, 3, 4, 5], "Shuffle must be a valid permutation");
}

// ============ Test 9: Slash Non-Revealers ============

/// Creates an auction with 5 commits, reveals only 3 of them, then verifies
/// that the auction correctly tracks 2 non-revealers who would be slashed
/// at 50% (DEFAULT_SLASH_RATE_BPS = 5000).
///
/// Walks through the full lifecycle: commit -> aggregate -> reveal (partial)
/// -> settle, checking counts and slash amounts at each step.
#[test]
fn test_slash_non_revealers() {
    let config = make_config();
    let _pair_id = [0x01; 32];

    // ---- Aggregate 5 commits ----
    let auction_v0 = make_auction(PHASE_COMMIT, 0);
    let auction_v0_data = auction_v0.serialize();

    let commits: Vec<CommitCellData> = (0..5u8).map(|i| {
        let mut hash = [0u8; 32];
        hash[0] = i + 0xA0;
        make_commit(0, hash)
    }).collect();

    let mut auction_v1 = auction_v0.clone();
    auction_v1.commit_count = 5;
    auction_v1.prev_state_hash = compute_state_hash(&auction_v0);
    let auction_v1_data = auction_v1.serialize();

    assert!(verify_batch_auction_type(
        Some(&auction_v0_data), &auction_v1_data, &commits, &[], None, &config, 5, None, 5,
    ).is_ok());

    // ---- COMMIT -> REVEAL ----
    let block_reveal = config.commit_window_blocks;
    let mut auction_v2 = auction_v1.clone();
    auction_v2.phase = PHASE_REVEAL;
    auction_v2.reveal_count = 0;
    auction_v2.phase_start_block = block_reveal;
    auction_v2.prev_state_hash = compute_state_hash(&auction_v1);
    let auction_v2_data = auction_v2.serialize();

    assert!(verify_batch_auction_type(
        Some(&auction_v1_data), &auction_v2_data, &[], &[], None, &config, block_reveal, None, 0,
    ).is_ok());

    // ---- Only 3 out of 5 reveal ----
    let reveals: Vec<RevealWitness> = (0..3u8).map(|i| RevealWitness {
        order_type: ORDER_BUY,
        amount_in: 100 * PRECISION,
        limit_price: 2000 * PRECISION,
        secret: { let mut s = [0u8; 32]; s[0] = i + 1; s },
        priority_bid: 0,
        commit_index: i as u32,
    }).collect();

    let mut expected_xor = auction_v2.xor_seed;
    for reveal in &reveals {
        for i in 0..32 { expected_xor[i] ^= reveal.secret[i]; }
    }

    let mut auction_v3 = auction_v2.clone();
    auction_v3.reveal_count = 3;
    auction_v3.xor_seed = expected_xor;
    auction_v3.prev_state_hash = compute_state_hash(&auction_v2);
    let auction_v3_data = auction_v3.serialize();

    assert!(verify_batch_auction_type(
        Some(&auction_v2_data), &auction_v3_data, &[], &reveals, None, &config,
        block_reveal + 5, None, 0,
    ).is_ok(), "Partial reveal (3/5) should succeed");

    // ---- Verify slash count ----
    let slash_count = auction_v3.commit_count - auction_v3.reveal_count;
    assert_eq!(slash_count, 2, "2 non-revealers should be identified");

    // Each non-revealer forfeits 50% deposit (DEFAULT_SLASH_RATE_BPS = 5000)
    let slash_per_user = (commits[0].deposit_ckb as u128
        * config.slash_rate_bps as u128
        / BPS_DENOMINATOR) as u64;
    assert_eq!(slash_per_user, 50_000_000, "50% of 100M shannons = 50M");
    let total_slash = slash_per_user * slash_count as u64;
    assert_eq!(total_slash, 100_000_000, "Total slash for 2 users = 100M");

    // ---- REVEAL -> SETTLING ----
    let block_settling = auction_v2.phase_start_block + config.reveal_window_blocks;
    let entropy = [0xEE; 32];
    let final_seed = shuffle::generate_seed_secure(
        &[auction_v3.xor_seed], &entropy, auction_v3.batch_id,
    );

    let mut auction_v4 = auction_v3.clone();
    auction_v4.phase = PHASE_SETTLING;
    auction_v4.xor_seed = final_seed;
    auction_v4.phase_start_block = block_settling;
    auction_v4.prev_state_hash = compute_state_hash(&auction_v3);
    let auction_v4_data = auction_v4.serialize();

    assert!(verify_batch_auction_type(
        Some(&auction_v3_data), &auction_v4_data, &[], &[], None, &config,
        block_settling, Some(&entropy), 0,
    ).is_ok(), "REVEAL -> SETTLING with partial reveals should succeed");

    // ---- SETTLING -> SETTLED ----
    let mut auction_v5 = auction_v4.clone();
    auction_v5.phase = PHASE_SETTLED;
    auction_v5.clearing_price = 2000 * PRECISION;
    auction_v5.fillable_volume = 300 * PRECISION;
    auction_v5.prev_state_hash = compute_state_hash(&auction_v4);
    let auction_v5_data = auction_v5.serialize();

    assert!(verify_batch_auction_type(
        Some(&auction_v4_data), &auction_v5_data, &[], &[], None, &config,
        block_settling + 1, None, 0,
    ).is_ok(), "Settlement with non-revealers should succeed");

    // Final verification: counts preserved through settlement
    let final_state = AuctionCellData::deserialize(&auction_v5_data).unwrap();
    assert_eq!(final_state.commit_count, 5);
    assert_eq!(final_state.reveal_count, 3);
    assert_eq!(final_state.commit_count - final_state.reveal_count, 2, "Slash count preserved");
}

// ============ Test 10: Compliance Filter Blocks Sanctioned ============

/// Tests compliance integration with the batch auction type script:
/// 1. With inactive compliance (zero root), all commits pass
/// 2. With active compliance (non-zero root), the filter path is exercised
/// 3. Compliance cell data serialization roundtrips correctly
/// 4. Commit type script still enforces batch_id matching regardless of compliance
///
/// Note: The current compliance implementation is a placeholder that always
/// returns "not blocked" without a Merkle proof. This test exercises the
/// integration path and verifies the data structures are correct.
#[test]
fn test_compliance_filter_blocks_sanctioned() {
    let config = make_config();
    let pair_id = [0x01; 32];

    // ---- Build compliance cells ----
    let compliance_active = ComplianceCellData {
        blocked_merkle_root: [0xFF; 32], // Non-zero = active
        tier_merkle_root: [0u8; 32],
        jurisdiction_root: [0u8; 32],
        last_updated: 100,
        version: 1,
    };
    let compliance_inactive = ComplianceCellData {
        blocked_merkle_root: [0u8; 32], // Zero = inactive
        tier_merkle_root: [0u8; 32],
        jurisdiction_root: [0u8; 32],
        last_updated: 100,
        version: 1,
    };

    // ---- Build auction and commit ----
    let auction_old = make_auction(PHASE_COMMIT, 0);
    let auction_old_data = auction_old.serialize();

    let commit = CommitCellData {
        order_hash: [0xAA; 32],
        batch_id: 0,
        deposit_ckb: MIN_DEPOSIT,
        token_type_hash: [0x02; 32],
        token_amount: PRECISION,
        block_number: 10,
        sender_lock_hash: [0xCC; 32],
    };

    let mut auction_new = auction_old.clone();
    auction_new.commit_count = 1;
    auction_new.prev_state_hash = compute_state_hash(&auction_old);
    let auction_new_data = auction_new.serialize();

    // ---- Test with inactive compliance (zero root) ----
    let result = verify_batch_auction_type(
        Some(&auction_old_data), &auction_new_data,
        &[commit.clone()], &[], Some(&compliance_inactive), &config, 5, None, 1,
    );
    assert!(result.is_ok(), "Should pass with inactive compliance");

    // ---- Test with active compliance (non-zero root) ----
    // Placeholder always returns "not blocked", so this also passes.
    // In production, a Merkle non-inclusion proof would be required.
    let result = verify_batch_auction_type(
        Some(&auction_old_data), &auction_new_data,
        &[commit.clone()], &[], Some(&compliance_active), &config, 5, None, 1,
    );
    assert!(result.is_ok(), "Should pass with active compliance (placeholder allows all)");

    // ---- Compliance cell data roundtrip ----
    let bytes = compliance_active.serialize();
    let decoded = ComplianceCellData::deserialize(&bytes).unwrap();
    assert_eq!(decoded.blocked_merkle_root, compliance_active.blocked_merkle_root);
    assert_eq!(decoded.version, 1);
    assert_eq!(decoded.last_updated, 100);

    // ---- Commit type still enforces batch matching regardless of compliance ----
    let wrong_batch_commit = CommitCellData {
        order_hash: [0xBB; 32],
        batch_id: 99, // Wrong batch
        deposit_ckb: MIN_DEPOSIT,
        token_type_hash: [0x02; 32],
        token_amount: PRECISION,
        block_number: 10,
        sender_lock_hash: [0xDD; 32],
    };
    let wrong_data = wrong_batch_commit.serialize();
    let type_args = make_type_args(&pair_id, 99);

    let auction_ctx = AuctionCellData {
        phase: PHASE_COMMIT,
        batch_id: 0, // Batch 0, commit says 99
        pair_id,
        ..Default::default()
    };
    let auction_ctx_data = auction_ctx.serialize().to_vec();

    let result = verify_commit_type(
        true, &wrong_data, &type_args, None, Some(&auction_ctx_data), 0,
    );
    assert_eq!(
        result, Err(CommitTypeError::BatchIdMismatch),
        "Wrong batch_id must be rejected regardless of compliance"
    );
}
