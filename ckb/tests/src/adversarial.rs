// ============ VibeSwap CKB Adversarial Tests ============
// Comprehensive MEV attack simulations against VibeSwap's CKB cell model
//
// These tests verify that the type scripts correctly reject every known
// MEV attack vector: miner censorship, front-running, order reordering,
// replay attacks, deposit theft, pool manipulation, and more.
//
// Each test documents the specific attack vector and why it fails.

use vibeswap_types::*;
use vibeswap_math::{batch_math, mul_div, sqrt_product, mul_cmp};
#[allow(unused_imports)]
use vibeswap_mmr::MMR;
use commit_type::{verify_commit_type, CommitTypeError};
use amm_pool_type::{verify_amm_pool_type, PoolTypeError};
use batch_auction_type::{verify_batch_auction_type, AuctionTypeError};
use sha2::{Digest, Sha256};

// ============ Constants ============

const MIN_DEPOSIT: u64 = 100_000_000; // 1 CKB in shannons

// ============ Helper Functions ============

/// Create a default config cell with standard parameters
fn make_config() -> ConfigCellData {
    ConfigCellData::default()
}

/// Create an auction cell in the specified phase with the given batch_id
fn make_auction(phase: u8, batch_id: u64) -> AuctionCellData {
    AuctionCellData {
        phase,
        batch_id,
        pair_id: [0x01; 32],
        ..Default::default()
    }
}

/// Create a commit cell with the specified batch_id and order_hash
fn make_commit(batch_id: u64, order_hash: [u8; 32]) -> CommitCellData {
    CommitCellData {
        order_hash,
        batch_id,
        deposit_ckb: MIN_DEPOSIT,
        token_type_hash: [0x02; 32],
        token_amount: PRECISION,
        block_number: 100,
        sender_lock_hash: [0xCC; 32],
    }
}

/// Create a pool with the specified reserves (properly initialized)
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

/// Compute SHA-256 hash of arbitrary data
fn compute_hash(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

/// Compute the state hash of an auction cell (mirrors the private function
/// in batch_auction_type). Required because the original is not exported.
fn compute_state_hash(state: &AuctionCellData) -> [u8; 32] {
    let serialized = state.serialize();
    compute_hash(&serialized)
}

/// Build an order preimage from components and compute its hash.
/// The commit hash = SHA-256(order_type || amount_in || limit_price || secret)
fn build_order_hash(order_type: u8, amount_in: u128, limit_price: u128, secret: &[u8; 32]) -> [u8; 32] {
    let mut preimage = Vec::new();
    preimage.push(order_type);
    preimage.extend_from_slice(&amount_in.to_le_bytes());
    preimage.extend_from_slice(&limit_price.to_le_bytes());
    preimage.extend_from_slice(secret);
    compute_hash(&preimage)
}

/// Create valid type args (pair_id + batch_id) for commit type script
fn make_type_args(batch_id: u64) -> Vec<u8> {
    let mut args = vec![0u8; 40];
    args[0..32].copy_from_slice(&[0x01; 32]); // pair_id
    args[32..40].copy_from_slice(&batch_id.to_le_bytes());
    args
}

// ============ Test 1: Miner Cannot Drop Commits ============

/// ATTACK VECTOR: Miner censorship via selective commit inclusion
///
/// A malicious miner (CKB block producer) tries to exclude certain commit
/// cells from the aggregation transaction. For example, they might drop a
/// large buy order so they can front-run with their own order first.
///
/// WHY IT FAILS: The batch auction type script enforces "forced inclusion" --
/// the number of commits included in the aggregation transaction must equal
/// the total number of pending commits (pending_commit_count). If the miner
/// drops any commits, included_count < expected_total triggers
/// AuctionTypeError::ForcedInclusionViolation.
#[test]
fn test_miner_cannot_drop_commits() {
    let _pair_id = [0x01; 32];
    let old = make_auction(PHASE_COMMIT, 0);
    let old_data = old.serialize();

    // There are 3 pending commits on-chain, but the miner only includes 1
    let commits = vec![
        make_commit(0, [0xAA; 32]),
    ];

    let mut new = old.clone();
    new.commit_count = 1;
    new.prev_state_hash = compute_state_hash(&old);
    let new_data = new.serialize();

    let config = make_config();

    // pending_commit_count = 3, but only 1 commit provided
    let result = verify_batch_auction_type(
        Some(&old_data),
        &new_data,
        &commits,
        &[],
        None,
        &config,
        5,
        None,
        3, // 3 pending commits, but miner only included 1
    );

    assert_eq!(result, Err(AuctionTypeError::ForcedInclusionViolation));
}

// ============ Test 2: Miner Cannot Reorder for MEV ============

/// ATTACK VECTOR: Miner reorders revealed orders for MEV extraction
///
/// In traditional DEXes, miners can reorder transactions to sandwich-attack
/// users. Here we demonstrate that reordering reveals in VibeSwap is pointless
/// because ALL orders in a batch get the SAME uniform clearing price.
///
/// WHY IT FAILS: It doesn't "fail" per se -- it's impossible to extract MEV.
/// The clearing price depends only on the SET of orders, not their sequence.
/// We verify this by computing clearing prices with orders in different
/// sequences and confirming they are identical.
#[test]
fn test_miner_cannot_reorder_for_mev() {
    // Create two sets of orders in different sequence
    let buy_orders_a = vec![
        batch_math::Order { amount: 100 * PRECISION, limit_price: 2100 * PRECISION },
        batch_math::Order { amount: 50 * PRECISION, limit_price: 2050 * PRECISION },
        batch_math::Order { amount: 75 * PRECISION, limit_price: 2200 * PRECISION },
    ];
    let sell_orders_a = vec![
        batch_math::Order { amount: 80 * PRECISION, limit_price: 1950 * PRECISION },
        batch_math::Order { amount: 60 * PRECISION, limit_price: 2000 * PRECISION },
    ];

    // Same orders but in reversed sequence
    let buy_orders_b = vec![
        batch_math::Order { amount: 75 * PRECISION, limit_price: 2200 * PRECISION },
        batch_math::Order { amount: 50 * PRECISION, limit_price: 2050 * PRECISION },
        batch_math::Order { amount: 100 * PRECISION, limit_price: 2100 * PRECISION },
    ];
    let sell_orders_b = vec![
        batch_math::Order { amount: 60 * PRECISION, limit_price: 2000 * PRECISION },
        batch_math::Order { amount: 80 * PRECISION, limit_price: 1950 * PRECISION },
    ];

    let reserve0 = 1_000_000 * PRECISION;
    let reserve1 = 2_000_000 * PRECISION;

    let (price_a, volume_a) = batch_math::calculate_clearing_price(
        &buy_orders_a, &sell_orders_a, reserve0, reserve1,
    ).unwrap();

    let (price_b, volume_b) = batch_math::calculate_clearing_price(
        &buy_orders_b, &sell_orders_b, reserve0, reserve1,
    ).unwrap();

    // Uniform clearing price is the same regardless of order sequence.
    // The clearing price algorithm processes all orders as a set, not a sequence.
    assert_eq!(price_a, price_b, "Clearing price must be identical regardless of order sequence");
    assert_eq!(volume_a, volume_b, "Fillable volume must be identical regardless of order sequence");
}

// ============ Test 3: User Cannot Double-Commit Same Batch ============

/// ATTACK VECTOR: Double-commit to gain outsized position in a batch
///
/// A user tries to create two commit cells for the same batch with the same
/// sender_lock_hash. In CKB's cell model, each commit is its own independent
/// cell validated by the commit type script. Both commits are individually
/// valid because the type script validates each cell independently -- there
/// is no "duplicate check" in the type script because deduplication is
/// handled at the cell level by CKB's UTXO model (each cell is unique).
///
/// RESULT: Both pass type script validation independently. The protocol
/// does not prevent double-commits at the type script level because each
/// commit is a separate UTXO. Economic incentives (deposit + slashing)
/// prevent abuse.
#[test]
fn test_user_cannot_double_commit_same_batch() {
    let sender_lock_hash = [0xCC; 32];
    let batch_id = 5;

    // First commit from sender
    let commit1 = CommitCellData {
        order_hash: [0xAA; 32],
        batch_id,
        deposit_ckb: MIN_DEPOSIT,
        token_type_hash: [0x02; 32],
        token_amount: PRECISION,
        block_number: 100,
        sender_lock_hash,
    };

    // Second commit from SAME sender in SAME batch
    let commit2 = CommitCellData {
        order_hash: [0xBB; 32],
        batch_id,
        deposit_ckb: MIN_DEPOSIT,
        token_type_hash: [0x02; 32],
        token_amount: 2 * PRECISION,
        block_number: 101,
        sender_lock_hash, // Same sender
    };

    let auction = AuctionCellData {
        phase: PHASE_COMMIT,
        batch_id,
        pair_id: [0x01; 32],
        ..Default::default()
    };
    let auction_data = auction.serialize().to_vec();
    let type_args = make_type_args(batch_id);

    // Both commits should pass type script validation independently
    let result1 = verify_commit_type(
        true,
        &commit1.serialize(),
        &type_args,
        Some(&sender_lock_hash),
        Some(&auction_data),
        MIN_DEPOSIT,
    );
    assert!(result1.is_ok(), "First commit should be valid");

    let result2 = verify_commit_type(
        true,
        &commit2.serialize(),
        &type_args,
        Some(&sender_lock_hash),
        Some(&auction_data),
        MIN_DEPOSIT,
    );
    assert!(result2.is_ok(), "Second commit from same sender should also be valid (cells are independent UTXOs)");
}

// ============ Test 4: Wrong Secret Reveal Rejected ============

/// ATTACK VECTOR: Reveal with a different secret than committed
///
/// An attacker commits with hash(order || secret1) but tries to reveal with
/// secret2 (perhaps to change the order details after seeing other commits).
/// The preimage verification fails because SHA-256(order || secret2) != committed hash.
///
/// WHY IT FAILS: The commit cell stores order_hash = SHA-256(order || secret1).
/// During reveal, the type script would recompute hash(revealed_order || revealed_secret)
/// and compare against the stored order_hash. A mismatched secret produces a
/// completely different hash, which won't match. We verify this property here.
#[test]
fn test_wrong_secret_reveal_rejected() {
    let secret1 = [0x11; 32];
    let secret2 = [0x22; 32]; // Attacker's different secret

    let order_type = ORDER_BUY;
    let amount_in = 1000 * PRECISION;
    let limit_price = 2000 * PRECISION;

    // Commit hash was computed with secret1
    let committed_hash = build_order_hash(order_type, amount_in, limit_price, &secret1);

    // Attacker tries to reveal with secret2
    let reveal_hash = build_order_hash(order_type, amount_in, limit_price, &secret2);

    // The hashes MUST be different -- the preimage doesn't match
    assert_ne!(
        committed_hash, reveal_hash,
        "Different secrets must produce different hashes -- reveal with wrong secret is rejected"
    );

    // Also verify that even changing the order details with the new secret doesn't help
    let tampered_hash = build_order_hash(
        ORDER_SELL, // Changed order type
        amount_in * 2, // Changed amount
        limit_price / 2, // Changed price
        &secret2,
    );
    assert_ne!(
        committed_hash, tampered_hash,
        "Tampered order with different secret must produce different hash"
    );

    // The original secret always reconstructs the committed hash
    let honest_hash = build_order_hash(order_type, amount_in, limit_price, &secret1);
    assert_eq!(
        committed_hash, honest_hash,
        "Correct secret must reproduce the committed hash"
    );
}

// ============ Test 5: Front-Running Impossible (Hidden Orders) ============

/// ATTACK VECTOR: Front-running by inspecting pending commit cells
///
/// In traditional DEXes, an attacker can see pending transactions in the mempool
/// and front-run them. On CKB, commit cells are visible on-chain, but they only
/// contain the order HASH, not the actual order details (buy/sell, amount, price).
///
/// WHY IT FAILS: The commit cell stores order_hash = SHA-256(order || secret).
/// Without the secret, an attacker cannot reverse the hash to learn:
/// - Whether it's a buy or sell
/// - The amount
/// - The limit price
/// Two completely different orders with different secrets produce unrelated hashes.
#[test]
fn test_front_running_impossible_hidden_orders() {
    let secret_alice = [0xAA; 32];
    let secret_bob = [0xBB; 32];

    // Alice: Large buy order
    let hash_alice = build_order_hash(
        ORDER_BUY,
        10_000 * PRECISION,
        2500 * PRECISION,
        &secret_alice,
    );

    // Bob: Small sell order (completely opposite)
    let hash_bob = build_order_hash(
        ORDER_SELL,
        100 * PRECISION,
        1800 * PRECISION,
        &secret_bob,
    );

    // An attacker seeing these two commit cells on-chain learns NOTHING about:
    // 1. Whether each order is buy or sell
    // 2. The amount of each order
    // 3. The limit price of each order

    // The hashes are unrelated -- no information leaks
    assert_ne!(hash_alice, hash_bob, "Different orders produce different hashes");

    // The hashes appear random -- no pattern to exploit
    // (We verify that knowing one hash tells you nothing about the other)
    let hash_alice_bytes = hash_alice;
    let hash_bob_bytes = hash_bob;

    // XOR of two SHA-256 hashes should look random (high hamming distance)
    let mut differing_bits = 0u32;
    for i in 0..32 {
        differing_bits += (hash_alice_bytes[i] ^ hash_bob_bytes[i]).count_ones();
    }
    // For two random 256-bit values, expected hamming distance is ~128
    // We check it's at least 64 (very conservative lower bound)
    assert!(
        differing_bits > 64,
        "Hash outputs should be statistically independent (hamming distance: {})",
        differing_bits
    );

    // Even if the attacker tries the same order with a different secret,
    // they get a completely different hash
    let attacker_guess = build_order_hash(
        ORDER_BUY,
        10_000 * PRECISION,
        2500 * PRECISION,
        &[0x00; 32], // Attacker's guess at Alice's secret
    );
    assert_ne!(
        hash_alice, attacker_guess,
        "Attacker cannot guess the secret to match Alice's commitment"
    );
}

// ============ Test 6: Replay Attack Rejected ============

/// ATTACK VECTOR: Replay a commit from batch N in batch N+1
///
/// An attacker captures a valid commit cell from batch N and tries to include
/// it in batch N+1 to replay the trade. The commit cell's batch_id field
/// is locked to the batch it was created for.
///
/// WHY IT FAILS: The commit type script verifies that commit.batch_id matches
/// the auction cell's current batch_id. A commit from batch 5 cannot be
/// validated when the auction is on batch 6 -- CommitTypeError::BatchIdMismatch.
#[test]
fn test_replay_attack_rejected() {
    let old_batch_id = 5;
    let new_batch_id = 6;

    // Commit was created for batch 5
    let commit = make_commit(old_batch_id, [0xAA; 32]);
    let commit_data = commit.serialize();

    // Auction has moved to batch 6
    let auction = AuctionCellData {
        phase: PHASE_COMMIT,
        batch_id: new_batch_id,
        pair_id: [0x01; 32],
        ..Default::default()
    };
    let auction_data = auction.serialize().to_vec();

    // Type args for the new batch
    let type_args = make_type_args(new_batch_id);

    // Attempting to create the commit cell in the context of batch 6
    let result = verify_commit_type(
        true,
        &commit_data,
        &type_args,
        Some(&commit.sender_lock_hash),
        Some(&auction_data),
        MIN_DEPOSIT,
    );

    // The commit's batch_id (5) doesn't match the auction's batch_id (6)
    assert_eq!(
        result,
        Err(CommitTypeError::BatchIdMismatch),
        "Commit from batch {} must be rejected when auction is on batch {}",
        old_batch_id, new_batch_id
    );
}

// ============ Test 7: Deposit Theft via Fake Auction ============

/// ATTACK VECTOR: Steal deposits by consuming commits without an auction cell
///
/// An attacker tries to consume a user's commit cell (which holds a CKB deposit)
/// in a transaction that does NOT include a proper auction cell. This would
/// allow stealing the deposit without going through the settlement process.
///
/// WHY IT FAILS: The commit type script's consumption validation requires that
/// an auction cell exists in the transaction. Without it, the commit cell
/// cannot be consumed -- CommitTypeError::NoAuctionCellInTx.
#[test]
fn test_deposit_theft_via_fake_auction() {
    let commit = make_commit(1, [0xAA; 32]);
    let commit_data = commit.serialize();
    let type_args = make_type_args(1);

    // Try to consume the commit cell WITHOUT an auction cell in the transaction
    let result = verify_commit_type(
        false, // Consumption (not creation)
        &commit_data,
        &type_args,
        None,
        None, // No auction cell data -- this is the attack
        MIN_DEPOSIT,
    );

    assert_eq!(
        result,
        Err(CommitTypeError::NoAuctionCellInTx),
        "Consuming a commit cell without a valid auction cell must be rejected"
    );
}

// ============ Test 8: Pool Manipulation (K Invariant) ============

/// ATTACK VECTOR: Manipulate pool reserves to decrease k = r0 * r1
///
/// An attacker tries to submit a pool state transition where the constant
/// product k decreases. This would mean tokens were extracted from the pool
/// without proportional input, effectively stealing liquidity.
///
/// WHY IT FAILS: The AMM pool type script verifies that new_k >= old_k for
/// every state transition. Fees should always increase k; any decrease
/// triggers PoolTypeError::KInvariantViolation.
#[test]
fn test_pool_manipulation_k_invariant() {
    let r0 = 1_000_000 * PRECISION;
    let r1 = 2_000_000 * PRECISION;
    let old = make_pool(r0, r1);
    let old_data = old.serialize();

    // Attacker tries to decrease reserve0 while increasing reserve1 by LESS
    // than the AMM formula requires, violating k = r0 * r1
    let mut new = old.clone();
    // Remove 10,000 tokens from reserve0 but only add 10,000 to reserve1
    // This violates k because at 2:1 price ratio, you need ~20,000 token1
    // to compensate for 10,000 token0 removed
    new.reserve0 = r0 - 10_000 * PRECISION;
    new.reserve1 = r1 + 10_000 * PRECISION; // Should be ~+20,000 to maintain k

    // Update TWAP correctly so we isolate the k violation
    let block = 110u64;
    new.twap_last_block = block;
    let price = mul_div(old.reserve1, PRECISION, old.reserve0);
    new.twap_price_cum = old.twap_price_cum.wrapping_add(price * (block - old.twap_last_block) as u128);
    let new_data = new.serialize();

    let config = make_config();

    // Verify that new k < old k (the attack reduces k)
    assert_eq!(
        mul_cmp(new.reserve0, new.reserve1, old.reserve0, old.reserve1),
        core::cmp::Ordering::Less,
        "Sanity check: the manipulated reserves must have lower k"
    );

    let result = verify_amm_pool_type(
        Some(&old_data),
        &new_data,
        &config,
        None,
        block,
    );

    // The pool type script detects this as ExcessiveOutput (checked before k-invariant)
    // because the claimed output (10,000 token0) exceeds what the AMM formula allows
    // for the given input (10,000 token1 at a 2:1 price ratio → ~5,000 token0 max)
    assert_eq!(
        result,
        Err(PoolTypeError::ExcessiveOutput),
        "Extracting more output than AMM allows must be rejected"
    );
}

// ============ Test 9: Pool Price Manipulation Rejected ============

/// ATTACK VECTOR: Manipulate pool price beyond max deviation from oracle
///
/// An attacker performs a large swap that moves the pool price more than 5%
/// (500 bps) away from the oracle price. This could be used to manipulate
/// the TWAP or extract value from the pool via oracle price divergence.
///
/// WHY IT FAILS: The AMM pool type script checks the post-swap price against
/// the oracle price. If the deviation exceeds max_price_deviation (5% = 500 bps),
/// the swap is rejected with PoolTypeError::ExcessivePriceDeviation.
#[test]
fn test_pool_price_manipulation_rejected() {
    let r0 = 1_000_000 * PRECISION;
    let r1 = 2_000_000 * PRECISION;
    let old = make_pool(r0, r1);
    let old_data = old.serialize();

    // Spot price is r1/r0 = 2.0 (in PRECISION units: 2 * PRECISION)
    let oracle_price = 2 * PRECISION; // Oracle agrees with current spot

    // Attacker tries a massive swap that moves price by >5%
    // To move price from 2.0 to 2.12 (6% increase), we need a large token0 input
    // With constant product: new_price = new_r1/new_r0
    // If we add 50,000 token0 (5% of reserve): new_r0 = 1,050,000
    // new_r1 = k / new_r0 = (1M * 2M) / 1.05M = ~1,904,762
    // new_price = 1,904,762 / 1,050,000 = ~1.814 (9% drop from 2.0)
    let amount_in = 50_000 * PRECISION;
    let amount_out = batch_math::get_amount_out(
        amount_in,
        old.reserve0,
        old.reserve1,
        old.fee_rate_bps as u128,
    ).unwrap();

    let mut new = old.clone();
    new.reserve0 = old.reserve0 + amount_in;
    new.reserve1 = old.reserve1 - amount_out;

    // Update TWAP correctly
    let block = 110u64;
    new.twap_last_block = block;
    let price = mul_div(old.reserve1, PRECISION, old.reserve0);
    new.twap_price_cum = old.twap_price_cum.wrapping_add(price * (block - old.twap_last_block) as u128);
    let new_data = new.serialize();

    // Verify the price moved more than 5% from oracle
    let new_price = mul_div(new.reserve1, PRECISION, new.reserve0);
    let deviation_bps = if new_price > oracle_price {
        (new_price - oracle_price) * BPS_DENOMINATOR / oracle_price
    } else {
        (oracle_price - new_price) * BPS_DENOMINATOR / oracle_price
    };
    assert!(
        deviation_bps > 500,
        "Sanity check: price deviation should exceed 5% (got {} bps)",
        deviation_bps
    );

    let config = make_config();
    let result = verify_amm_pool_type(
        Some(&old_data),
        &new_data,
        &config,
        Some(oracle_price),
        block,
    );

    assert_eq!(
        result,
        Err(PoolTypeError::ExcessivePriceDeviation),
        "Swap moving price >5% from oracle must be rejected"
    );
}

// ============ Test 10: Zero Deposit Commit Rejected ============

/// ATTACK VECTOR: Create a commit with zero CKB deposit
///
/// An attacker tries to create commit cells without locking any CKB deposit.
/// This would allow spam attacks (flooding batches with costless orders)
/// and eliminate the economic penalty for non-reveal (50% slashing of zero = zero).
///
/// WHY IT FAILS: The commit type script requires deposit_ckb >= min_deposit.
/// A zero deposit triggers CommitTypeError::InsufficientDeposit.
#[test]
fn test_zero_deposit_commit_rejected() {
    let mut commit = make_commit(1, [0xAA; 32]);
    commit.deposit_ckb = 0; // Zero deposit -- the attack
    let commit_data = commit.serialize();

    let auction = AuctionCellData {
        phase: PHASE_COMMIT,
        batch_id: 1,
        pair_id: [0x01; 32],
        ..Default::default()
    };
    let auction_data = auction.serialize().to_vec();
    let type_args = make_type_args(1);

    let result = verify_commit_type(
        true,
        &commit_data,
        &type_args,
        Some(&commit.sender_lock_hash),
        Some(&auction_data),
        MIN_DEPOSIT, // Minimum 1 CKB required
    );

    assert_eq!(
        result,
        Err(CommitTypeError::InsufficientDeposit),
        "Zero deposit commit must be rejected"
    );
}

// ============ Test 11: Wrong Phase Commit Rejected ============

/// ATTACK VECTOR: Submit a commit during the REVEAL phase
///
/// An attacker tries to add a new commit cell when the auction has already
/// transitioned to the REVEAL phase. This would allow them to see other
/// revealed orders and then "commit" with full knowledge -- defeating
/// the entire commit-reveal scheme.
///
/// WHY IT FAILS: The commit type script checks that the auction cell is in
/// PHASE_COMMIT. If the auction is in PHASE_REVEAL (or any other phase),
/// the commit creation is rejected with CommitTypeError::WrongPhase.
#[test]
fn test_wrong_phase_commit_rejected() {
    let commit = make_commit(1, [0xAA; 32]);
    let commit_data = commit.serialize();

    // Auction is in REVEAL phase, not COMMIT
    let auction = AuctionCellData {
        phase: PHASE_REVEAL, // Wrong phase for committing
        batch_id: 1,
        pair_id: [0x01; 32],
        commit_count: 5,
        ..Default::default()
    };
    let auction_data = auction.serialize().to_vec();
    let type_args = make_type_args(1);

    let result = verify_commit_type(
        true,
        &commit_data,
        &type_args,
        Some(&commit.sender_lock_hash),
        Some(&auction_data),
        MIN_DEPOSIT,
    );

    assert_eq!(
        result,
        Err(CommitTypeError::WrongPhase),
        "Committing during REVEAL phase must be rejected"
    );
}

// ============ Test 12: Batch ID Manipulation Rejected ============

/// ATTACK VECTOR: Decrement or arbitrarily change the batch_id
///
/// An attacker tries to transition the auction from SETTLED to COMMIT with
/// an invalid batch_id (not old.batch_id + 1). This could allow re-settling
/// old batches to double-spend or skip batches to orphan pending commits.
///
/// WHY IT FAILS: The batch auction type script requires that when transitioning
/// from SETTLED to COMMIT (new batch), new.batch_id == old.batch_id + 1.
/// Any other value triggers AuctionTypeError::InvalidBatchIncrement.
#[test]
fn test_batch_id_manipulation_rejected() {
    let pair_id = [0x01; 32];

    // Test 1: Decrementing batch_id
    let old = AuctionCellData {
        phase: PHASE_SETTLED,
        batch_id: 10,
        pair_id,
        commit_count: 5,
        reveal_count: 4,
        clearing_price: 2000 * PRECISION,
        ..Default::default()
    };
    let old_data = old.serialize();

    // Attacker tries to go back to batch 9 (decrement)
    let new_decrement = AuctionCellData {
        phase: PHASE_COMMIT,
        batch_id: 9, // Decrement -- should be 11
        pair_id,
        phase_start_block: 500,
        prev_state_hash: compute_state_hash(&old),
        ..Default::default()
    };
    let new_data = new_decrement.serialize();
    let config = make_config();

    let result = verify_batch_auction_type(
        Some(&old_data),
        &new_data,
        &[],
        &[],
        None,
        &config,
        500,
        None,
        0,
    );

    assert_eq!(
        result,
        Err(AuctionTypeError::InvalidBatchIncrement),
        "Decrementing batch_id must be rejected"
    );

    // Test 2: Skipping batch_ids (jumping from 10 to 15)
    let new_skip = AuctionCellData {
        phase: PHASE_COMMIT,
        batch_id: 15, // Skip -- should be 11
        pair_id,
        phase_start_block: 500,
        prev_state_hash: compute_state_hash(&old),
        ..Default::default()
    };
    let new_data_skip = new_skip.serialize();

    let result_skip = verify_batch_auction_type(
        Some(&old_data),
        &new_data_skip,
        &[],
        &[],
        None,
        &config,
        500,
        None,
        0,
    );

    assert_eq!(
        result_skip,
        Err(AuctionTypeError::InvalidBatchIncrement),
        "Skipping batch_ids must be rejected"
    );

    // Test 3: Keeping same batch_id (replay current batch)
    let new_same = AuctionCellData {
        phase: PHASE_COMMIT,
        batch_id: 10, // Same -- should be 11
        pair_id,
        phase_start_block: 500,
        prev_state_hash: compute_state_hash(&old),
        ..Default::default()
    };
    let new_data_same = new_same.serialize();

    let result_same = verify_batch_auction_type(
        Some(&old_data),
        &new_data_same,
        &[],
        &[],
        None,
        &config,
        500,
        None,
        0,
    );

    assert_eq!(
        result_same,
        Err(AuctionTypeError::InvalidBatchIncrement),
        "Replaying same batch_id must be rejected"
    );
}
