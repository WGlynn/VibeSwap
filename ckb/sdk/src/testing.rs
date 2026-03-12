// ============ Testing Module ============
// Test Utilities & Fixtures — helper functions for creating test data,
// mock objects, and common patterns used across all SDK module tests.
// Makes testing infrastructure reusable.
//
// Key capabilities:
// - Address/hash generation: deterministic, reproducible test identities
// - Pool fixtures: balanced, imbalanced, high-fee, low-fee configurations
// - User fixtures: whales, dust, stakers with varying parameters
// - Order fixtures: buy, sell, market, balanced orderbooks
// - Cell/Transaction fixtures: mock CKB cells and transactions
// - Scenario builders: pre-built multi-entity test setups
// - AMM simulation: swap simulation with k-value tracking
// - Assertion helpers: approximate equality, monotonicity, sum checks
// - Test vectors: known-good (input, output) pairs for verification

use sha2::{Digest, Sha256};

// ============ Constants ============

/// Basis points denominator
const BPS: u64 = 10_000;

/// Price scale factor (1e8)
const PRICE_SCALE: u64 = 100_000_000;

/// Default fee rate for mock pools: 30 bps
const DEFAULT_FEE_BPS: u64 = 30;

/// High fee rate: 100 bps
const HIGH_FEE_BPS: u64 = 100;

/// Low fee rate: 1 bps
const LOW_FEE_BPS: u64 = 1;

/// Whale balance: 1 billion tokens
const WHALE_BALANCE: u64 = 1_000_000_000;

/// Dust balance: 1 token
const DUST_BALANCE: u64 = 1;

/// CKB Shannon per CKB (1 CKB = 1e8 Shannon)
const CKB_SHANNON: u64 = 100_000_000;

// ============ Data Types ============

#[derive(Debug, Clone)]
pub struct MockPool {
    pub pool_id: [u8; 32],
    pub reserve_a: u64,
    pub reserve_b: u64,
    pub fee_bps: u64,
    pub total_lp: u64,
}

#[derive(Debug, Clone)]
pub struct MockUser {
    pub address: [u8; 32],
    pub balance: u64,
    pub staked: u64,
    pub voting_power: u64,
    pub nonce: u64,
}

#[derive(Debug, Clone)]
pub struct MockOrder {
    pub amount: u64,
    pub is_buy: bool,
    pub price_limit: u64,
    pub priority_fee: u64,
    pub timestamp: u64,
}

#[derive(Debug, Clone)]
pub struct MockTransaction {
    pub sender: [u8; 32],
    pub inputs: Vec<MockCell>,
    pub outputs: Vec<MockCell>,
    pub timestamp: u64,
}

#[derive(Debug, Clone)]
pub struct MockCell {
    pub capacity: u64,
    pub lock_hash: [u8; 32],
    pub type_hash: Option<[u8; 32]>,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct TestScenario {
    pub name: String,
    pub pools: Vec<MockPool>,
    pub users: Vec<MockUser>,
    pub orders: Vec<MockOrder>,
    pub block_height: u64,
    pub timestamp: u64,
}

#[derive(Debug, Clone)]
pub struct SimulationResult {
    pub initial_k: u128,
    pub final_k: u128,
    pub k_preserved: bool,
    pub total_fees: u64,
    pub price_impact_bps: u64,
    pub trades_executed: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TestVector {
    pub input: Vec<u64>,
    pub expected_output: Vec<u64>,
    pub description: String,
}

// ============ Address Generation ============

/// Deterministic address from a single byte seed. Fills all 32 bytes with seed.
pub fn mock_address(seed: u8) -> [u8; 32] {
    [seed; 32]
}

/// Deterministic address from a u64 seed. Distributes seed bytes across the address.
pub fn mock_address_from_u64(seed: u64) -> [u8; 32] {
    let bytes = seed.to_le_bytes();
    let mut addr = [0u8; 32];
    for i in 0..32 {
        addr[i] = bytes[i % 8];
    }
    addr
}

/// Pseudo-random address deterministic from nonce. Uses SHA-256 for distribution.
pub fn random_address(nonce: u64) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"random_address:");
    hasher.update(nonce.to_le_bytes());
    let result = hasher.finalize();
    let mut addr = [0u8; 32];
    addr.copy_from_slice(&result);
    addr
}

/// All-zero address.
pub fn zero_address() -> [u8; 32] {
    [0u8; 32]
}

/// All-0xFF address (maximum address).
pub fn max_address() -> [u8; 32] {
    [0xFF; 32]
}

/// Generate N unique addresses using sequential seeds.
pub fn unique_addresses(count: usize) -> Vec<[u8; 32]> {
    (0..count).map(|i| random_address(i as u64)).collect()
}

// ============ Hash Generation ============

/// Deterministic hash from a single byte seed.
pub fn mock_hash(seed: u8) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update([seed]);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

/// SHA-256 hash of a string.
pub fn mock_hash_from_str(s: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

/// Generate N sequential hashes using indices as seeds.
pub fn sequential_hashes(count: usize) -> Vec<[u8; 32]> {
    (0..count).map(|i| mock_hash(i as u8)).collect()
}

// ============ Pool Fixtures ============

/// Create a mock pool with custom reserves.
pub fn mock_pool(seed: u8, reserve_a: u64, reserve_b: u64) -> MockPool {
    MockPool {
        pool_id: mock_hash(seed),
        reserve_a,
        reserve_b,
        fee_bps: DEFAULT_FEE_BPS,
        total_lp: isqrt_u128((reserve_a as u128) * (reserve_b as u128)),
    }
}

/// Create a balanced pool with equal reserves.
pub fn balanced_pool(seed: u8, reserve: u64) -> MockPool {
    mock_pool(seed, reserve, reserve)
}

/// Create an imbalanced pool. `ratio_bps` is reserve_a's share of total (e.g. 8000 = 80% in A).
pub fn imbalanced_pool(seed: u8, ratio_bps: u64, total: u64) -> MockPool {
    let capped_ratio = if ratio_bps > BPS { BPS } else { ratio_bps };
    let reserve_a = (total as u128 * capped_ratio as u128 / BPS as u128) as u64;
    let reserve_b = total.saturating_sub(reserve_a);
    let mut pool = mock_pool(seed, reserve_a, reserve_b);
    pool.fee_bps = DEFAULT_FEE_BPS;
    pool
}

/// Pool with 100 bps (1%) fee.
pub fn high_fee_pool(seed: u8, reserve: u64) -> MockPool {
    let mut pool = balanced_pool(seed, reserve);
    pool.fee_bps = HIGH_FEE_BPS;
    pool
}

/// Pool with 1 bps (0.01%) fee.
pub fn low_fee_pool(seed: u8, reserve: u64) -> MockPool {
    let mut pool = balanced_pool(seed, reserve);
    pool.fee_bps = LOW_FEE_BPS;
    pool
}

/// Create a pool whose reserves produce the given k value at the given ratio.
/// `ratio_bps` is reserve_a's share (e.g. 5000 = balanced).
pub fn pool_with_k(k: u128, ratio_bps: u64) -> MockPool {
    // k = reserve_a * reserve_b
    // Let total² * ratio * (1-ratio) / BPS² = k
    // reserve_a = sqrt(k * ratio / (BPS - ratio))
    // reserve_b = k / reserve_a
    let capped = if ratio_bps == 0 || ratio_bps >= BPS {
        5000u64
    } else {
        ratio_bps
    };
    let complement = BPS - capped;
    // reserve_a = sqrt(k * ratio / complement)
    let numerator = k * capped as u128;
    let denominator = complement as u128;
    let a_squared = numerator / denominator;
    let reserve_a = isqrt_u128(a_squared);
    let reserve_b = if reserve_a == 0 { 0 } else { k / reserve_a as u128 };
    let reserve_a = reserve_a as u64;
    let reserve_b = reserve_b as u64;
    MockPool {
        pool_id: mock_hash(0),
        reserve_a,
        reserve_b,
        fee_bps: DEFAULT_FEE_BPS,
        total_lp: isqrt_u128(reserve_a as u128 * reserve_b as u128),
    }
}

// ============ User Fixtures ============

/// Create a mock user with the given balance.
pub fn mock_user(seed: u8, balance: u64) -> MockUser {
    MockUser {
        address: mock_address(seed),
        balance,
        staked: 0,
        voting_power: 0,
        nonce: 0,
    }
}

/// Whale user with 1 billion tokens.
pub fn whale_user(seed: u8) -> MockUser {
    MockUser {
        address: mock_address(seed),
        balance: WHALE_BALANCE,
        staked: 0,
        voting_power: WHALE_BALANCE / 10,
        nonce: 0,
    }
}

/// Dust user with minimal balance (1 token).
pub fn dust_user(seed: u8) -> MockUser {
    MockUser {
        address: mock_address(seed),
        balance: DUST_BALANCE,
        staked: 0,
        voting_power: 0,
        nonce: 0,
    }
}

/// Staker user with specified staked amount and voting power.
pub fn staker_user(seed: u8, staked: u64, power: u64) -> MockUser {
    MockUser {
        address: mock_address(seed),
        balance: staked,
        staked,
        voting_power: power,
        nonce: 0,
    }
}

/// Generate N users with varying balances. Each user gets `base_balance * (i+1)`.
pub fn mock_users(count: usize, base_balance: u64) -> Vec<MockUser> {
    (0..count)
        .map(|i| {
            let balance = base_balance.saturating_mul((i as u64) + 1);
            MockUser {
                address: random_address(i as u64),
                balance,
                staked: 0,
                voting_power: 0,
                nonce: i as u64,
            }
        })
        .collect()
}

// ============ Order Fixtures ============

/// Create a buy order at the given price limit.
pub fn mock_buy_order(amount: u64, price: u64) -> MockOrder {
    MockOrder {
        amount,
        is_buy: true,
        price_limit: price,
        priority_fee: 0,
        timestamp: 1000,
    }
}

/// Create a sell order at the given price limit.
pub fn mock_sell_order(amount: u64, price: u64) -> MockOrder {
    MockOrder {
        amount,
        is_buy: false,
        price_limit: price,
        priority_fee: 0,
        timestamp: 1000,
    }
}

/// Create a market order (price_limit = 0 for buy, u64::MAX for sell).
pub fn mock_market_order(amount: u64, is_buy: bool) -> MockOrder {
    MockOrder {
        amount,
        is_buy,
        price_limit: if is_buy { u64::MAX } else { 0 },
        priority_fee: 0,
        timestamp: 1000,
    }
}

/// Generate deterministic "random" orders. `buy_ratio_bps` controls what fraction are buys.
pub fn random_orders(count: usize, max_amount: u64, buy_ratio_bps: u64) -> Vec<MockOrder> {
    (0..count)
        .map(|i| {
            // Deterministic pseudo-random amount using a simple hash
            let hash_val = simple_hash_u64(i as u64);
            let amount = if max_amount == 0 {
                1
            } else {
                (hash_val % max_amount).max(1)
            };
            // Determine buy/sell based on ratio
            let threshold = (BPS as u128 * i as u128) / count.max(1) as u128;
            let is_buy = (threshold as u64) < buy_ratio_bps;
            let price = (hash_val / 1000).max(1);
            MockOrder {
                amount,
                is_buy,
                price_limit: price,
                priority_fee: (i as u64) % 10,
                timestamp: 1000 + i as u64,
            }
        })
        .collect()
}

/// Create a balanced orderbook with orders around a mid price.
/// Half buys (below mid), half sells (above mid). Spread controlled by `spread_bps`.
pub fn balanced_orderbook(order_count: usize, mid_price: u64, spread_bps: u64) -> Vec<MockOrder> {
    let half = order_count / 2;
    let spread_amount = (mid_price as u128 * spread_bps as u128 / BPS as u128) as u64;
    let mut orders = Vec::with_capacity(order_count);

    // Buy orders (below mid price)
    for i in 0..half {
        let offset = if half == 0 {
            0
        } else {
            spread_amount * (i as u64 + 1) / (half as u64)
        };
        let price = mid_price.saturating_sub(offset);
        orders.push(MockOrder {
            amount: 1000 + (i as u64 * 100),
            is_buy: true,
            price_limit: price,
            priority_fee: 0,
            timestamp: 1000 + i as u64,
        });
    }

    // Sell orders (above mid price)
    for i in 0..half {
        let offset = if half == 0 {
            0
        } else {
            spread_amount * (i as u64 + 1) / (half as u64)
        };
        let price = mid_price.saturating_add(offset);
        orders.push(MockOrder {
            amount: 1000 + (i as u64 * 100),
            is_buy: false,
            price_limit: price,
            priority_fee: 0,
            timestamp: 1000 + half as u64 + i as u64,
        });
    }

    orders
}

// ============ Cell Fixtures ============

/// Create a basic mock cell.
pub fn mock_cell(capacity: u64, seed: u8) -> MockCell {
    MockCell {
        capacity,
        lock_hash: mock_hash(seed),
        type_hash: None,
        data: Vec::new(),
    }
}

/// Create a mock cell with attached data.
pub fn mock_cell_with_data(capacity: u64, data: Vec<u8>, seed: u8) -> MockCell {
    MockCell {
        capacity,
        lock_hash: mock_hash(seed),
        type_hash: None,
        data,
    }
}

/// Create a mock cell with both lock and type hashes.
pub fn mock_typed_cell(capacity: u64, type_seed: u8, lock_seed: u8) -> MockCell {
    MockCell {
        capacity,
        lock_hash: mock_hash(lock_seed),
        type_hash: Some(mock_hash(type_seed)),
        data: Vec::new(),
    }
}

/// Create a plain CKB cell where capacity = ckb_amount * 1e8 (Shannon conversion).
pub fn ckb_cell(ckb_amount: u64) -> MockCell {
    MockCell {
        capacity: ckb_amount.saturating_mul(CKB_SHANNON),
        lock_hash: [0u8; 32],
        type_hash: None,
        data: Vec::new(),
    }
}

// ============ Transaction Fixtures ============

/// Create a mock transaction with the given number of inputs and outputs.
pub fn mock_transaction(sender_seed: u8, input_count: usize, output_count: usize) -> MockTransaction {
    let inputs = (0..input_count)
        .map(|i| mock_cell(1000 * (i as u64 + 1), sender_seed.wrapping_add(i as u8)))
        .collect();
    let outputs = (0..output_count)
        .map(|i| mock_cell(900 * (i as u64 + 1), sender_seed.wrapping_add(100).wrapping_add(i as u8)))
        .collect();
    MockTransaction {
        sender: mock_address(sender_seed),
        inputs,
        outputs,
        timestamp: 1000,
    }
}

/// Create a transfer transaction from one user to another.
pub fn transfer_transaction(from: u8, to: u8, amount: u64) -> MockTransaction {
    let input = MockCell {
        capacity: amount,
        lock_hash: mock_hash(from),
        type_hash: None,
        data: Vec::new(),
    };
    let output = MockCell {
        capacity: amount,
        lock_hash: mock_hash(to),
        type_hash: None,
        data: Vec::new(),
    };
    MockTransaction {
        sender: mock_address(from),
        inputs: vec![input],
        outputs: vec![output],
        timestamp: 1000,
    }
}

// ============ Scenario Builders ============

/// Empty scenario with just a name.
pub fn empty_scenario(name: &str) -> TestScenario {
    TestScenario {
        name: name.to_string(),
        pools: Vec::new(),
        users: Vec::new(),
        orders: Vec::new(),
        block_height: 0,
        timestamp: 0,
    }
}

/// Basic swap scenario: 1 balanced pool, 2 users, 1 buy + 1 sell order.
pub fn basic_swap_scenario() -> TestScenario {
    let pool = balanced_pool(1, 1_000_000);
    let user_a = mock_user(1, 100_000);
    let user_b = mock_user(2, 100_000);
    let buy = mock_buy_order(10_000, PRICE_SCALE as u64);
    let sell = mock_sell_order(10_000, PRICE_SCALE as u64);

    TestScenario {
        name: "basic_swap".to_string(),
        pools: vec![pool],
        users: vec![user_a, user_b],
        orders: vec![buy, sell],
        block_height: 100,
        timestamp: 1000,
    }
}

/// Batch auction scenario with one pool and many orders.
pub fn batch_auction_scenario(order_count: usize) -> TestScenario {
    let pool = balanced_pool(1, 10_000_000);
    let users = mock_users(order_count.min(20), 50_000);
    let orders = random_orders(order_count, 100_000, 5000);

    TestScenario {
        name: format!("batch_auction_{}", order_count),
        pools: vec![pool],
        users,
        orders,
        block_height: 500,
        timestamp: 5000,
    }
}

/// Stress scenario with many pools and users.
pub fn stress_scenario(pool_count: usize, user_count: usize) -> TestScenario {
    let pools: Vec<MockPool> = (0..pool_count)
        .map(|i| {
            let reserve = 1_000_000u64.saturating_mul((i as u64) + 1);
            mock_pool(i as u8, reserve, reserve)
        })
        .collect();
    let users = mock_users(user_count, 10_000);
    let order_count = pool_count * 5;
    let orders = random_orders(order_count, 50_000, 5000);

    TestScenario {
        name: format!("stress_{}p_{}u", pool_count, user_count),
        pools,
        users,
        orders,
        block_height: 10_000,
        timestamp: 100_000,
    }
}

// ============ AMM Simulation Helpers ============

/// Simulate a single swap on a mock pool. Updates pool reserves in-place.
/// Returns a SimulationResult tracking k-value preservation and fees.
pub fn simulate_swap(pool: &mut MockPool, amount_in: u64, is_a_to_b: bool) -> SimulationResult {
    let initial_k = compute_mock_k(pool);
    let initial_price = compute_mock_price(pool);

    if amount_in == 0 || pool.reserve_a == 0 || pool.reserve_b == 0 {
        return SimulationResult {
            initial_k,
            final_k: initial_k,
            k_preserved: true,
            total_fees: 0,
            price_impact_bps: 0,
            trades_executed: 0,
        };
    }

    // Calculate fee
    let fee = (amount_in as u128 * pool.fee_bps as u128 / BPS as u128) as u64;
    let amount_in_after_fee = amount_in.saturating_sub(fee);

    // Constant product: amount_out = (reserve_out * amount_in_after_fee) / (reserve_in + amount_in_after_fee)
    let (reserve_in, reserve_out) = if is_a_to_b {
        (pool.reserve_a as u128, pool.reserve_b as u128)
    } else {
        (pool.reserve_b as u128, pool.reserve_a as u128)
    };

    let numerator = reserve_out * amount_in_after_fee as u128;
    let denominator = reserve_in + amount_in_after_fee as u128;
    let amount_out = if denominator == 0 { 0u64 } else { (numerator / denominator) as u64 };

    // Update reserves
    if is_a_to_b {
        pool.reserve_a = pool.reserve_a.saturating_add(amount_in);
        pool.reserve_b = pool.reserve_b.saturating_sub(amount_out);
    } else {
        pool.reserve_b = pool.reserve_b.saturating_add(amount_in);
        pool.reserve_a = pool.reserve_a.saturating_sub(amount_out);
    }

    let final_k = compute_mock_k(pool);
    let final_price = compute_mock_price(pool);

    // Price impact in bps
    let price_impact_bps = if initial_price == 0 {
        0
    } else {
        let diff = if final_price > initial_price {
            final_price - initial_price
        } else {
            initial_price - final_price
        };
        ((diff as u128 * BPS as u128) / initial_price as u128) as u64
    };

    SimulationResult {
        initial_k,
        final_k,
        k_preserved: final_k >= initial_k,
        total_fees: fee,
        price_impact_bps,
        trades_executed: 1,
    }
}

/// Simulate multiple swaps on a pool. Accumulates fees and tracks k-value.
pub fn simulate_multi_swap(pool: &mut MockPool, swaps: &[(u64, bool)]) -> SimulationResult {
    let initial_k = compute_mock_k(pool);
    let mut total_fees = 0u64;
    let mut trades_executed = 0u64;
    let initial_price = compute_mock_price(pool);

    for &(amount, is_a_to_b) in swaps {
        let result = simulate_swap(pool, amount, is_a_to_b);
        total_fees = total_fees.saturating_add(result.total_fees);
        trades_executed += result.trades_executed;
    }

    let final_k = compute_mock_k(pool);
    let final_price = compute_mock_price(pool);
    let price_impact_bps = if initial_price == 0 {
        0
    } else {
        let diff = if final_price > initial_price {
            final_price - initial_price
        } else {
            initial_price - final_price
        };
        ((diff as u128 * BPS as u128) / initial_price as u128) as u64
    };

    SimulationResult {
        initial_k,
        final_k,
        k_preserved: final_k >= initial_k,
        total_fees,
        price_impact_bps,
        trades_executed,
    }
}

/// Compute the constant product k = reserve_a * reserve_b.
pub fn compute_mock_k(pool: &MockPool) -> u128 {
    pool.reserve_a as u128 * pool.reserve_b as u128
}

/// Compute the spot price = (reserve_b * 1e8) / reserve_a.
pub fn compute_mock_price(pool: &MockPool) -> u64 {
    if pool.reserve_a == 0 {
        return 0;
    }
    (pool.reserve_b as u128 * PRICE_SCALE as u128 / pool.reserve_a as u128) as u64
}

// ============ Assertion Helpers ============

/// Check if actual is within `tolerance_bps` of expected.
pub fn assert_approximately_equal(actual: u64, expected: u64, tolerance_bps: u64) -> bool {
    if expected == 0 {
        return actual == 0;
    }
    let diff = if actual > expected {
        actual - expected
    } else {
        expected - actual
    };
    let tolerance = (expected as u128 * tolerance_bps as u128 / BPS as u128) as u64;
    diff <= tolerance
}

/// Check if value is within [min, max] inclusive.
pub fn assert_within_range(value: u64, min: u64, max: u64) -> bool {
    value >= min && value <= max
}

/// Check if values are monotonically increasing (each >= previous).
pub fn assert_monotonic_increasing(values: &[u64]) -> bool {
    if values.len() <= 1 {
        return true;
    }
    for i in 1..values.len() {
        if values[i] < values[i - 1] {
            return false;
        }
    }
    true
}

/// Check if values are monotonically decreasing (each <= previous).
pub fn assert_monotonic_decreasing(values: &[u64]) -> bool {
    if values.len() <= 1 {
        return true;
    }
    for i in 1..values.len() {
        if values[i] > values[i - 1] {
            return false;
        }
    }
    true
}

/// Check if parts sum exactly to total.
pub fn assert_sum_equals(parts: &[u64], total: u64) -> bool {
    let sum: u64 = parts.iter().sum();
    sum == total
}

/// Check that k did not decrease (fees should only grow k).
pub fn assert_k_preserved(initial_k: u128, final_k: u128) -> bool {
    final_k >= initial_k
}

// ============ Test Vectors ============

/// Known (input, sqrt) pairs for verification.
pub fn known_sqrt_vectors() -> Vec<TestVector> {
    vec![
        TestVector {
            input: vec![0],
            expected_output: vec![0],
            description: "sqrt(0) = 0".to_string(),
        },
        TestVector {
            input: vec![1],
            expected_output: vec![1],
            description: "sqrt(1) = 1".to_string(),
        },
        TestVector {
            input: vec![4],
            expected_output: vec![2],
            description: "sqrt(4) = 2".to_string(),
        },
        TestVector {
            input: vec![9],
            expected_output: vec![3],
            description: "sqrt(9) = 3".to_string(),
        },
        TestVector {
            input: vec![16],
            expected_output: vec![4],
            description: "sqrt(16) = 4".to_string(),
        },
        TestVector {
            input: vec![25],
            expected_output: vec![5],
            description: "sqrt(25) = 5".to_string(),
        },
        TestVector {
            input: vec![100],
            expected_output: vec![10],
            description: "sqrt(100) = 10".to_string(),
        },
        TestVector {
            input: vec![10000],
            expected_output: vec![100],
            description: "sqrt(10000) = 100".to_string(),
        },
        TestVector {
            input: vec![1_000_000],
            expected_output: vec![1000],
            description: "sqrt(1M) = 1000".to_string(),
        },
        TestVector {
            input: vec![1_000_000_000_000],
            expected_output: vec![1_000_000],
            description: "sqrt(1T) = 1M".to_string(),
        },
        TestVector {
            input: vec![2],
            expected_output: vec![1],
            description: "sqrt(2) = 1 (floor)".to_string(),
        },
        TestVector {
            input: vec![3],
            expected_output: vec![1],
            description: "sqrt(3) = 1 (floor)".to_string(),
        },
        TestVector {
            input: vec![8],
            expected_output: vec![2],
            description: "sqrt(8) = 2 (floor)".to_string(),
        },
    ]
}

/// Known AMM swap vectors: (reserve_in, reserve_out, amount_in, expected_out).
/// Uses constant product formula: out = (reserve_out * amount_in) / (reserve_in + amount_in).
/// No fees applied in these vectors.
pub fn known_amm_vectors() -> Vec<TestVector> {
    vec![
        TestVector {
            input: vec![1_000_000, 1_000_000, 1000],
            expected_output: vec![999],
            description: "balanced pool, small swap".to_string(),
        },
        TestVector {
            input: vec![1_000_000, 1_000_000, 10_000],
            expected_output: vec![9900],
            description: "balanced pool, medium swap".to_string(),
        },
        TestVector {
            input: vec![1_000_000, 1_000_000, 100_000],
            expected_output: vec![90909],
            description: "balanced pool, large swap".to_string(),
        },
        TestVector {
            input: vec![1_000_000, 2_000_000, 10_000],
            expected_output: vec![19801],
            description: "2:1 pool ratio".to_string(),
        },
        TestVector {
            input: vec![2_000_000, 1_000_000, 10_000],
            expected_output: vec![4975],
            description: "1:2 pool ratio".to_string(),
        },
        TestVector {
            input: vec![1_000_000, 1_000_000, 1],
            expected_output: vec![0],
            description: "dust swap, rounds to 0".to_string(),
        },
        TestVector {
            input: vec![100, 100, 50],
            expected_output: vec![33],
            description: "tiny pool, 50% of reserves".to_string(),
        },
        TestVector {
            input: vec![1_000_000, 1_000_000, 500_000],
            expected_output: vec![333_333],
            description: "50% reserve swap".to_string(),
        },
    ]
}

/// Known compound interest vectors: (principal, rate_bps, periods, expected).
/// Compound: A = P * (1 + r)^n, approximated by integer math.
pub fn known_compound_interest_vectors() -> Vec<TestVector> {
    vec![
        TestVector {
            input: vec![1_000_000, 100, 1],
            expected_output: vec![1_010_000],
            description: "1M principal, 1% rate, 1 period".to_string(),
        },
        TestVector {
            input: vec![1_000_000, 100, 2],
            expected_output: vec![1_020_100],
            description: "1M principal, 1% rate, 2 periods".to_string(),
        },
        TestVector {
            input: vec![1_000_000, 100, 10],
            expected_output: vec![1_104_620],
            description: "1M principal, 1% rate, 10 periods".to_string(),
        },
        TestVector {
            input: vec![1_000_000, 500, 1],
            expected_output: vec![1_050_000],
            description: "1M principal, 5% rate, 1 period".to_string(),
        },
        TestVector {
            input: vec![1_000_000, 500, 5],
            expected_output: vec![1_276_281],
            description: "1M principal, 5% rate, 5 periods".to_string(),
        },
        TestVector {
            input: vec![1_000_000, 0, 100],
            expected_output: vec![1_000_000],
            description: "zero rate, no growth".to_string(),
        },
        TestVector {
            input: vec![0, 500, 10],
            expected_output: vec![0],
            description: "zero principal, stays zero".to_string(),
        },
        TestVector {
            input: vec![1_000_000, 1000, 1],
            expected_output: vec![1_100_000],
            description: "1M principal, 10% rate, 1 period".to_string(),
        },
    ]
}

// ============ Internal Helpers ============

/// Integer square root via Newton's method for u128.
fn isqrt_u128(n: u128) -> u64 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x as u64
}

/// Simple deterministic hash of a u64 for pseudo-random generation.
fn simple_hash_u64(n: u64) -> u64 {
    let mut x = n.wrapping_add(0x9e3779b97f4a7c15);
    x = (x ^ (x >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94d049bb133111eb);
    x ^ (x >> 31)
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Address Generation Tests ============

    #[test]
    fn test_mock_address_deterministic() {
        let a1 = mock_address(42);
        let a2 = mock_address(42);
        assert_eq!(a1, a2);
    }

    #[test]
    fn test_mock_address_different_seeds() {
        let a1 = mock_address(1);
        let a2 = mock_address(2);
        assert_ne!(a1, a2);
    }

    #[test]
    fn test_mock_address_fills_all_bytes() {
        let addr = mock_address(0xAB);
        for byte in &addr {
            assert_eq!(*byte, 0xAB);
        }
    }

    #[test]
    fn test_mock_address_zero_seed() {
        let addr = mock_address(0);
        assert_eq!(addr, [0u8; 32]);
    }

    #[test]
    fn test_mock_address_max_seed() {
        let addr = mock_address(255);
        assert_eq!(addr, [255u8; 32]);
    }

    #[test]
    fn test_mock_address_from_u64_deterministic() {
        let a1 = mock_address_from_u64(12345);
        let a2 = mock_address_from_u64(12345);
        assert_eq!(a1, a2);
    }

    #[test]
    fn test_mock_address_from_u64_different_seeds() {
        let a1 = mock_address_from_u64(1);
        let a2 = mock_address_from_u64(2);
        assert_ne!(a1, a2);
    }

    #[test]
    fn test_mock_address_from_u64_zero() {
        let addr = mock_address_from_u64(0);
        assert_eq!(addr, [0u8; 32]);
    }

    #[test]
    fn test_mock_address_from_u64_pattern_repeats() {
        let addr = mock_address_from_u64(0x0102030405060708);
        // Bytes repeat every 8 positions
        assert_eq!(addr[0], addr[8]);
        assert_eq!(addr[1], addr[9]);
        assert_eq!(addr[7], addr[15]);
    }

    #[test]
    fn test_random_address_deterministic() {
        let a1 = random_address(99);
        let a2 = random_address(99);
        assert_eq!(a1, a2);
    }

    #[test]
    fn test_random_address_different_nonces() {
        let a1 = random_address(0);
        let a2 = random_address(1);
        assert_ne!(a1, a2);
    }

    #[test]
    fn test_random_address_well_distributed() {
        // Different nonces should produce very different addresses
        let a1 = random_address(0);
        let a2 = random_address(1);
        let mut diff_count = 0;
        for i in 0..32 {
            if a1[i] != a2[i] {
                diff_count += 1;
            }
        }
        // At least half the bytes should differ
        assert!(diff_count >= 16, "Only {} bytes differ", diff_count);
    }

    #[test]
    fn test_zero_address() {
        let addr = zero_address();
        assert_eq!(addr, [0u8; 32]);
    }

    #[test]
    fn test_max_address() {
        let addr = max_address();
        assert_eq!(addr, [0xFF; 32]);
    }

    #[test]
    fn test_unique_addresses_count() {
        let addrs = unique_addresses(10);
        assert_eq!(addrs.len(), 10);
    }

    #[test]
    fn test_unique_addresses_are_unique() {
        let addrs = unique_addresses(100);
        for i in 0..addrs.len() {
            for j in (i + 1)..addrs.len() {
                assert_ne!(addrs[i], addrs[j], "Collision at {} and {}", i, j);
            }
        }
    }

    #[test]
    fn test_unique_addresses_empty() {
        let addrs = unique_addresses(0);
        assert!(addrs.is_empty());
    }

    #[test]
    fn test_unique_addresses_single() {
        let addrs = unique_addresses(1);
        assert_eq!(addrs.len(), 1);
        assert_eq!(addrs[0], random_address(0));
    }

    // ============ Hash Generation Tests ============

    #[test]
    fn test_mock_hash_deterministic() {
        let h1 = mock_hash(7);
        let h2 = mock_hash(7);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_mock_hash_different_seeds() {
        let h1 = mock_hash(0);
        let h2 = mock_hash(1);
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_mock_hash_length() {
        let h = mock_hash(42);
        assert_eq!(h.len(), 32);
    }

    #[test]
    fn test_mock_hash_from_str_deterministic() {
        let h1 = mock_hash_from_str("hello");
        let h2 = mock_hash_from_str("hello");
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_mock_hash_from_str_different_inputs() {
        let h1 = mock_hash_from_str("hello");
        let h2 = mock_hash_from_str("world");
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_mock_hash_from_str_empty() {
        let h = mock_hash_from_str("");
        // SHA-256 of empty string is a known value
        assert_eq!(h.len(), 32);
    }

    #[test]
    fn test_mock_hash_from_str_known_sha256() {
        // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        let h = mock_hash_from_str("");
        assert_eq!(h[0], 0xe3);
        assert_eq!(h[1], 0xb0);
    }

    #[test]
    fn test_sequential_hashes_count() {
        let hashes = sequential_hashes(5);
        assert_eq!(hashes.len(), 5);
    }

    #[test]
    fn test_sequential_hashes_unique() {
        let hashes = sequential_hashes(50);
        for i in 0..hashes.len() {
            for j in (i + 1)..hashes.len() {
                assert_ne!(hashes[i], hashes[j]);
            }
        }
    }

    #[test]
    fn test_sequential_hashes_match_mock_hash() {
        let hashes = sequential_hashes(5);
        for i in 0..5 {
            assert_eq!(hashes[i], mock_hash(i as u8));
        }
    }

    #[test]
    fn test_sequential_hashes_empty() {
        let hashes = sequential_hashes(0);
        assert!(hashes.is_empty());
    }

    // ============ Pool Fixture Tests ============

    #[test]
    fn test_mock_pool_reserves() {
        let pool = mock_pool(1, 1000, 2000);
        assert_eq!(pool.reserve_a, 1000);
        assert_eq!(pool.reserve_b, 2000);
    }

    #[test]
    fn test_mock_pool_default_fee() {
        let pool = mock_pool(1, 1000, 1000);
        assert_eq!(pool.fee_bps, DEFAULT_FEE_BPS);
    }

    #[test]
    fn test_mock_pool_lp_computed() {
        let pool = mock_pool(1, 1_000_000, 1_000_000);
        // LP = sqrt(reserve_a * reserve_b) = sqrt(1e12) = 1e6
        assert_eq!(pool.total_lp, 1_000_000);
    }

    #[test]
    fn test_mock_pool_id_is_hash() {
        let pool = mock_pool(1, 1000, 1000);
        assert_eq!(pool.pool_id, mock_hash(1));
    }

    #[test]
    fn test_balanced_pool_equal_reserves() {
        let pool = balanced_pool(1, 5000);
        assert_eq!(pool.reserve_a, pool.reserve_b);
        assert_eq!(pool.reserve_a, 5000);
    }

    #[test]
    fn test_balanced_pool_price_is_one() {
        let pool = balanced_pool(1, 1_000_000);
        let price = compute_mock_price(&pool);
        assert_eq!(price, PRICE_SCALE as u64);
    }

    #[test]
    fn test_imbalanced_pool_80_20() {
        let pool = imbalanced_pool(1, 8000, 10_000);
        assert_eq!(pool.reserve_a, 8000);
        assert_eq!(pool.reserve_b, 2000);
    }

    #[test]
    fn test_imbalanced_pool_50_50() {
        let pool = imbalanced_pool(1, 5000, 10_000);
        assert_eq!(pool.reserve_a, 5000);
        assert_eq!(pool.reserve_b, 5000);
    }

    #[test]
    fn test_imbalanced_pool_caps_ratio() {
        // ratio > BPS should cap at BPS
        let pool = imbalanced_pool(1, 15000, 10_000);
        assert_eq!(pool.reserve_a, 10_000);
        assert_eq!(pool.reserve_b, 0);
    }

    #[test]
    fn test_imbalanced_pool_zero_ratio() {
        let pool = imbalanced_pool(1, 0, 10_000);
        assert_eq!(pool.reserve_a, 0);
        assert_eq!(pool.reserve_b, 10_000);
    }

    #[test]
    fn test_high_fee_pool_fee() {
        let pool = high_fee_pool(1, 1000);
        assert_eq!(pool.fee_bps, HIGH_FEE_BPS);
    }

    #[test]
    fn test_high_fee_pool_balanced() {
        let pool = high_fee_pool(1, 5000);
        assert_eq!(pool.reserve_a, pool.reserve_b);
    }

    #[test]
    fn test_low_fee_pool_fee() {
        let pool = low_fee_pool(1, 1000);
        assert_eq!(pool.fee_bps, LOW_FEE_BPS);
    }

    #[test]
    fn test_low_fee_pool_balanced() {
        let pool = low_fee_pool(1, 5000);
        assert_eq!(pool.reserve_a, pool.reserve_b);
    }

    #[test]
    fn test_pool_with_k_balanced() {
        let pool = pool_with_k(1_000_000_000_000, 5000);
        let k = compute_mock_k(&pool);
        // Should be approximately the requested k (integer rounding may cause small deviation)
        assert!(
            assert_approximately_equal(k as u64, 1_000_000_000_000u64, 100),
            "k={} not close to 1T",
            k
        );
    }

    #[test]
    fn test_pool_with_k_imbalanced() {
        let pool = pool_with_k(1_000_000_000_000, 8000);
        let k = compute_mock_k(&pool);
        // k should be approximately right
        assert!(k > 0);
        // reserve_a should be larger than reserve_b
        assert!(pool.reserve_a > pool.reserve_b);
    }

    #[test]
    fn test_pool_with_k_zero_ratio_defaults_balanced() {
        let pool = pool_with_k(1_000_000, 0);
        // ratio=0 is invalid, defaults to 5000
        assert!(pool.reserve_a > 0);
        assert!(pool.reserve_b > 0);
    }

    #[test]
    fn test_pool_with_k_small_k() {
        let pool = pool_with_k(100, 5000);
        let k = compute_mock_k(&pool);
        assert_eq!(k, 100);
    }

    // ============ User Fixture Tests ============

    #[test]
    fn test_mock_user_balance() {
        let user = mock_user(1, 50_000);
        assert_eq!(user.balance, 50_000);
    }

    #[test]
    fn test_mock_user_address() {
        let user = mock_user(5, 100);
        assert_eq!(user.address, mock_address(5));
    }

    #[test]
    fn test_mock_user_default_fields() {
        let user = mock_user(1, 100);
        assert_eq!(user.staked, 0);
        assert_eq!(user.voting_power, 0);
        assert_eq!(user.nonce, 0);
    }

    #[test]
    fn test_whale_user_balance() {
        let user = whale_user(1);
        assert_eq!(user.balance, WHALE_BALANCE);
    }

    #[test]
    fn test_whale_user_voting_power() {
        let user = whale_user(1);
        assert_eq!(user.voting_power, WHALE_BALANCE / 10);
    }

    #[test]
    fn test_dust_user_balance() {
        let user = dust_user(1);
        assert_eq!(user.balance, DUST_BALANCE);
    }

    #[test]
    fn test_dust_user_no_power() {
        let user = dust_user(1);
        assert_eq!(user.voting_power, 0);
        assert_eq!(user.staked, 0);
    }

    #[test]
    fn test_staker_user_fields() {
        let user = staker_user(1, 5000, 3000);
        assert_eq!(user.staked, 5000);
        assert_eq!(user.voting_power, 3000);
        assert_eq!(user.balance, 5000);
    }

    #[test]
    fn test_mock_users_count() {
        let users = mock_users(10, 1000);
        assert_eq!(users.len(), 10);
    }

    #[test]
    fn test_mock_users_varying_balances() {
        let users = mock_users(5, 1000);
        assert_eq!(users[0].balance, 1000);
        assert_eq!(users[1].balance, 2000);
        assert_eq!(users[2].balance, 3000);
        assert_eq!(users[3].balance, 4000);
        assert_eq!(users[4].balance, 5000);
    }

    #[test]
    fn test_mock_users_unique_addresses() {
        let users = mock_users(20, 100);
        for i in 0..users.len() {
            for j in (i + 1)..users.len() {
                assert_ne!(users[i].address, users[j].address);
            }
        }
    }

    #[test]
    fn test_mock_users_nonces() {
        let users = mock_users(5, 100);
        for (i, user) in users.iter().enumerate() {
            assert_eq!(user.nonce, i as u64);
        }
    }

    #[test]
    fn test_mock_users_empty() {
        let users = mock_users(0, 1000);
        assert!(users.is_empty());
    }

    #[test]
    fn test_mock_users_overflow_protection() {
        // base_balance * (count) should saturate instead of overflow
        let users = mock_users(3, u64::MAX / 2);
        assert_eq!(users[0].balance, u64::MAX / 2);
        assert_eq!(users[1].balance, u64::MAX - 1); // saturating_mul
        assert_eq!(users[2].balance, u64::MAX);     // saturates
    }

    // ============ Order Fixture Tests ============

    #[test]
    fn test_mock_buy_order() {
        let order = mock_buy_order(1000, 50_000);
        assert_eq!(order.amount, 1000);
        assert!(order.is_buy);
        assert_eq!(order.price_limit, 50_000);
    }

    #[test]
    fn test_mock_sell_order() {
        let order = mock_sell_order(2000, 60_000);
        assert_eq!(order.amount, 2000);
        assert!(!order.is_buy);
        assert_eq!(order.price_limit, 60_000);
    }

    #[test]
    fn test_mock_market_order_buy() {
        let order = mock_market_order(500, true);
        assert!(order.is_buy);
        assert_eq!(order.price_limit, u64::MAX);
    }

    #[test]
    fn test_mock_market_order_sell() {
        let order = mock_market_order(500, false);
        assert!(!order.is_buy);
        assert_eq!(order.price_limit, 0);
    }

    #[test]
    fn test_mock_order_default_timestamp() {
        let order = mock_buy_order(100, 100);
        assert_eq!(order.timestamp, 1000);
    }

    #[test]
    fn test_mock_order_default_priority_fee() {
        let order = mock_sell_order(100, 100);
        assert_eq!(order.priority_fee, 0);
    }

    #[test]
    fn test_random_orders_count() {
        let orders = random_orders(50, 10_000, 5000);
        assert_eq!(orders.len(), 50);
    }

    #[test]
    fn test_random_orders_deterministic() {
        let o1 = random_orders(10, 10_000, 5000);
        let o2 = random_orders(10, 10_000, 5000);
        for i in 0..10 {
            assert_eq!(o1[i].amount, o2[i].amount);
            assert_eq!(o1[i].is_buy, o2[i].is_buy);
        }
    }

    #[test]
    fn test_random_orders_amounts_bounded() {
        let orders = random_orders(100, 10_000, 5000);
        for order in &orders {
            assert!(order.amount >= 1);
            assert!(order.amount <= 10_000);
        }
    }

    #[test]
    fn test_random_orders_has_both_sides() {
        let orders = random_orders(100, 10_000, 5000);
        let buys = orders.iter().filter(|o| o.is_buy).count();
        let sells = orders.iter().filter(|o| !o.is_buy).count();
        assert!(buys > 0, "No buy orders generated");
        assert!(sells > 0, "No sell orders generated");
    }

    #[test]
    fn test_random_orders_all_buys() {
        // buy_ratio_bps = 10000 means everything should be a buy
        let orders = random_orders(20, 10_000, BPS);
        for order in &orders {
            assert!(order.is_buy);
        }
    }

    #[test]
    fn test_random_orders_all_sells() {
        let orders = random_orders(20, 10_000, 0);
        for order in &orders {
            assert!(!order.is_buy);
        }
    }

    #[test]
    fn test_random_orders_max_amount_zero() {
        let orders = random_orders(5, 0, 5000);
        for order in &orders {
            assert_eq!(order.amount, 1); // min clamped to 1
        }
    }

    #[test]
    fn test_balanced_orderbook_count() {
        let orders = balanced_orderbook(10, 100_000, 500);
        assert_eq!(orders.len(), 10);
    }

    #[test]
    fn test_balanced_orderbook_equal_sides() {
        let orders = balanced_orderbook(20, 100_000, 500);
        let buys = orders.iter().filter(|o| o.is_buy).count();
        let sells = orders.iter().filter(|o| !o.is_buy).count();
        assert_eq!(buys, 10);
        assert_eq!(sells, 10);
    }

    #[test]
    fn test_balanced_orderbook_buy_prices_below_mid() {
        let mid = 100_000u64;
        let orders = balanced_orderbook(10, mid, 500);
        for order in orders.iter().filter(|o| o.is_buy) {
            assert!(order.price_limit <= mid, "Buy price {} > mid {}", order.price_limit, mid);
        }
    }

    #[test]
    fn test_balanced_orderbook_sell_prices_above_mid() {
        let mid = 100_000u64;
        let orders = balanced_orderbook(10, mid, 500);
        for order in orders.iter().filter(|o| !o.is_buy) {
            assert!(order.price_limit >= mid, "Sell price {} < mid {}", order.price_limit, mid);
        }
    }

    #[test]
    fn test_balanced_orderbook_zero_spread() {
        let mid = 100_000u64;
        let orders = balanced_orderbook(10, mid, 0);
        for order in &orders {
            assert_eq!(order.price_limit, mid);
        }
    }

    #[test]
    fn test_balanced_orderbook_empty() {
        let orders = balanced_orderbook(0, 100_000, 500);
        assert!(orders.is_empty());
    }

    #[test]
    fn test_balanced_orderbook_two_orders() {
        let orders = balanced_orderbook(2, 100_000, 1000);
        assert_eq!(orders.len(), 2);
        assert!(orders[0].is_buy);
        assert!(!orders[1].is_buy);
    }

    // ============ Cell Fixture Tests ============

    #[test]
    fn test_mock_cell_capacity() {
        let cell = mock_cell(5000, 1);
        assert_eq!(cell.capacity, 5000);
    }

    #[test]
    fn test_mock_cell_no_type_hash() {
        let cell = mock_cell(1000, 1);
        assert!(cell.type_hash.is_none());
    }

    #[test]
    fn test_mock_cell_empty_data() {
        let cell = mock_cell(1000, 1);
        assert!(cell.data.is_empty());
    }

    #[test]
    fn test_mock_cell_lock_hash() {
        let cell = mock_cell(1000, 5);
        assert_eq!(cell.lock_hash, mock_hash(5));
    }

    #[test]
    fn test_mock_cell_with_data_contains_data() {
        let data = vec![1, 2, 3, 4, 5];
        let cell = mock_cell_with_data(1000, data.clone(), 1);
        assert_eq!(cell.data, data);
    }

    #[test]
    fn test_mock_cell_with_data_empty() {
        let cell = mock_cell_with_data(1000, vec![], 1);
        assert!(cell.data.is_empty());
    }

    #[test]
    fn test_mock_typed_cell_has_type_hash() {
        let cell = mock_typed_cell(1000, 2, 3);
        assert!(cell.type_hash.is_some());
        assert_eq!(cell.type_hash.unwrap(), mock_hash(2));
    }

    #[test]
    fn test_mock_typed_cell_lock_hash() {
        let cell = mock_typed_cell(1000, 2, 3);
        assert_eq!(cell.lock_hash, mock_hash(3));
    }

    #[test]
    fn test_ckb_cell_capacity() {
        let cell = ckb_cell(100);
        assert_eq!(cell.capacity, 100 * CKB_SHANNON);
    }

    #[test]
    fn test_ckb_cell_zero() {
        let cell = ckb_cell(0);
        assert_eq!(cell.capacity, 0);
    }

    #[test]
    fn test_ckb_cell_overflow_saturates() {
        let cell = ckb_cell(u64::MAX);
        assert_eq!(cell.capacity, u64::MAX); // saturating mul
    }

    #[test]
    fn test_ckb_cell_plain() {
        let cell = ckb_cell(10);
        assert_eq!(cell.lock_hash, [0u8; 32]);
        assert!(cell.type_hash.is_none());
        assert!(cell.data.is_empty());
    }

    // ============ Transaction Fixture Tests ============

    #[test]
    fn test_mock_transaction_input_count() {
        let tx = mock_transaction(1, 3, 2);
        assert_eq!(tx.inputs.len(), 3);
    }

    #[test]
    fn test_mock_transaction_output_count() {
        let tx = mock_transaction(1, 3, 2);
        assert_eq!(tx.outputs.len(), 2);
    }

    #[test]
    fn test_mock_transaction_sender() {
        let tx = mock_transaction(5, 1, 1);
        assert_eq!(tx.sender, mock_address(5));
    }

    #[test]
    fn test_mock_transaction_timestamp() {
        let tx = mock_transaction(1, 1, 1);
        assert_eq!(tx.timestamp, 1000);
    }

    #[test]
    fn test_mock_transaction_empty() {
        let tx = mock_transaction(1, 0, 0);
        assert!(tx.inputs.is_empty());
        assert!(tx.outputs.is_empty());
    }

    #[test]
    fn test_transfer_transaction_from_to() {
        let tx = transfer_transaction(1, 2, 5000);
        assert_eq!(tx.sender, mock_address(1));
        assert_eq!(tx.inputs[0].lock_hash, mock_hash(1));
        assert_eq!(tx.outputs[0].lock_hash, mock_hash(2));
    }

    #[test]
    fn test_transfer_transaction_amount() {
        let tx = transfer_transaction(1, 2, 5000);
        assert_eq!(tx.inputs[0].capacity, 5000);
        assert_eq!(tx.outputs[0].capacity, 5000);
    }

    #[test]
    fn test_transfer_transaction_single_io() {
        let tx = transfer_transaction(1, 2, 5000);
        assert_eq!(tx.inputs.len(), 1);
        assert_eq!(tx.outputs.len(), 1);
    }

    // ============ Scenario Builder Tests ============

    #[test]
    fn test_empty_scenario_name() {
        let s = empty_scenario("test_one");
        assert_eq!(s.name, "test_one");
    }

    #[test]
    fn test_empty_scenario_empty() {
        let s = empty_scenario("empty");
        assert!(s.pools.is_empty());
        assert!(s.users.is_empty());
        assert!(s.orders.is_empty());
        assert_eq!(s.block_height, 0);
        assert_eq!(s.timestamp, 0);
    }

    #[test]
    fn test_basic_swap_scenario_structure() {
        let s = basic_swap_scenario();
        assert_eq!(s.pools.len(), 1);
        assert_eq!(s.users.len(), 2);
        assert_eq!(s.orders.len(), 2);
    }

    #[test]
    fn test_basic_swap_scenario_has_buy_and_sell() {
        let s = basic_swap_scenario();
        assert!(s.orders[0].is_buy);
        assert!(!s.orders[1].is_buy);
    }

    #[test]
    fn test_basic_swap_scenario_balanced_pool() {
        let s = basic_swap_scenario();
        assert_eq!(s.pools[0].reserve_a, s.pools[0].reserve_b);
    }

    #[test]
    fn test_batch_auction_scenario_orders() {
        let s = batch_auction_scenario(50);
        assert_eq!(s.orders.len(), 50);
    }

    #[test]
    fn test_batch_auction_scenario_name() {
        let s = batch_auction_scenario(100);
        assert_eq!(s.name, "batch_auction_100");
    }

    #[test]
    fn test_batch_auction_scenario_has_pool() {
        let s = batch_auction_scenario(10);
        assert_eq!(s.pools.len(), 1);
    }

    #[test]
    fn test_stress_scenario_pools() {
        let s = stress_scenario(5, 10);
        assert_eq!(s.pools.len(), 5);
    }

    #[test]
    fn test_stress_scenario_users() {
        let s = stress_scenario(5, 10);
        assert_eq!(s.users.len(), 10);
    }

    #[test]
    fn test_stress_scenario_orders() {
        let s = stress_scenario(5, 10);
        assert_eq!(s.orders.len(), 25); // pool_count * 5
    }

    #[test]
    fn test_stress_scenario_name() {
        let s = stress_scenario(3, 7);
        assert_eq!(s.name, "stress_3p_7u");
    }

    #[test]
    fn test_stress_scenario_varying_reserves() {
        let s = stress_scenario(5, 1);
        for (i, pool) in s.pools.iter().enumerate() {
            let expected = 1_000_000u64 * (i as u64 + 1);
            assert_eq!(pool.reserve_a, expected);
        }
    }

    // ============ AMM Simulation Tests ============

    #[test]
    fn test_simulate_swap_basic() {
        let mut pool = balanced_pool(1, 1_000_000);
        let result = simulate_swap(&mut pool, 10_000, true);
        assert_eq!(result.trades_executed, 1);
        assert!(result.total_fees > 0);
    }

    #[test]
    fn test_simulate_swap_k_preserved() {
        let mut pool = balanced_pool(1, 1_000_000);
        let result = simulate_swap(&mut pool, 10_000, true);
        assert!(result.k_preserved, "k decreased: {} -> {}", result.initial_k, result.final_k);
    }

    #[test]
    fn test_simulate_swap_k_grows_from_fees() {
        let mut pool = balanced_pool(1, 1_000_000);
        let result = simulate_swap(&mut pool, 100_000, true);
        assert!(result.final_k > result.initial_k, "k should grow from fees");
    }

    #[test]
    fn test_simulate_swap_zero_amount() {
        let mut pool = balanced_pool(1, 1_000_000);
        let result = simulate_swap(&mut pool, 0, true);
        assert_eq!(result.trades_executed, 0);
        assert_eq!(result.total_fees, 0);
        assert_eq!(result.initial_k, result.final_k);
    }

    #[test]
    fn test_simulate_swap_empty_pool() {
        let mut pool = mock_pool(1, 0, 0);
        let result = simulate_swap(&mut pool, 1000, true);
        assert_eq!(result.trades_executed, 0);
    }

    #[test]
    fn test_simulate_swap_a_to_b() {
        let mut pool = balanced_pool(1, 1_000_000);
        let initial_a = pool.reserve_a;
        let initial_b = pool.reserve_b;
        simulate_swap(&mut pool, 10_000, true);
        assert!(pool.reserve_a > initial_a);
        assert!(pool.reserve_b < initial_b);
    }

    #[test]
    fn test_simulate_swap_b_to_a() {
        let mut pool = balanced_pool(1, 1_000_000);
        let initial_a = pool.reserve_a;
        let initial_b = pool.reserve_b;
        simulate_swap(&mut pool, 10_000, false);
        assert!(pool.reserve_a < initial_a);
        assert!(pool.reserve_b > initial_b);
    }

    #[test]
    fn test_simulate_swap_price_impact() {
        let mut pool = balanced_pool(1, 1_000_000);
        let result = simulate_swap(&mut pool, 100_000, true);
        assert!(result.price_impact_bps > 0, "Large swap should have price impact");
    }

    #[test]
    fn test_simulate_swap_small_price_impact() {
        let mut pool = balanced_pool(1, 1_000_000);
        let result = simulate_swap(&mut pool, 100, true);
        // Very small swap relative to pool — price impact should be tiny
        assert!(result.price_impact_bps <= 10, "Tiny swap impact too high: {}", result.price_impact_bps);
    }

    #[test]
    fn test_simulate_swap_fees_proportional() {
        let mut pool = balanced_pool(1, 1_000_000);
        let result = simulate_swap(&mut pool, 10_000, true);
        // Fee should be amount * fee_bps / BPS = 10000 * 30 / 10000 = 30
        assert_eq!(result.total_fees, 30);
    }

    #[test]
    fn test_simulate_multi_swap_accumulates() {
        let mut pool = balanced_pool(1, 1_000_000);
        let swaps = vec![(1000, true), (2000, false), (1500, true)];
        let result = simulate_multi_swap(&mut pool, &swaps);
        assert_eq!(result.trades_executed, 3);
        assert!(result.total_fees > 0);
    }

    #[test]
    fn test_simulate_multi_swap_k_preserved() {
        let mut pool = balanced_pool(1, 1_000_000);
        let swaps = vec![(5000, true), (5000, false), (3000, true), (3000, false)];
        let result = simulate_multi_swap(&mut pool, &swaps);
        assert!(result.k_preserved);
    }

    #[test]
    fn test_simulate_multi_swap_empty() {
        let mut pool = balanced_pool(1, 1_000_000);
        let initial_k = compute_mock_k(&pool);
        let result = simulate_multi_swap(&mut pool, &[]);
        assert_eq!(result.trades_executed, 0);
        assert_eq!(result.final_k, initial_k);
    }

    #[test]
    fn test_simulate_multi_swap_single() {
        let mut pool1 = balanced_pool(1, 1_000_000);
        let mut pool2 = balanced_pool(1, 1_000_000);
        let multi = simulate_multi_swap(&mut pool1, &[(10_000, true)]);
        let single = simulate_swap(&mut pool2, 10_000, true);
        assert_eq!(multi.total_fees, single.total_fees);
    }

    #[test]
    fn test_compute_mock_k() {
        let pool = mock_pool(1, 1000, 2000);
        assert_eq!(compute_mock_k(&pool), 2_000_000);
    }

    #[test]
    fn test_compute_mock_k_zero() {
        let pool = mock_pool(1, 0, 1000);
        assert_eq!(compute_mock_k(&pool), 0);
    }

    #[test]
    fn test_compute_mock_k_large() {
        let pool = mock_pool(1, u64::MAX, u64::MAX);
        let k = compute_mock_k(&pool);
        assert_eq!(k, u64::MAX as u128 * u64::MAX as u128);
    }

    #[test]
    fn test_compute_mock_price_balanced() {
        let pool = balanced_pool(1, 1_000_000);
        let price = compute_mock_price(&pool);
        assert_eq!(price, PRICE_SCALE as u64);
    }

    #[test]
    fn test_compute_mock_price_2x() {
        let pool = mock_pool(1, 1_000_000, 2_000_000);
        let price = compute_mock_price(&pool);
        assert_eq!(price, 2 * PRICE_SCALE as u64);
    }

    #[test]
    fn test_compute_mock_price_zero_reserve_a() {
        let pool = mock_pool(1, 0, 1000);
        let price = compute_mock_price(&pool);
        assert_eq!(price, 0);
    }

    // ============ Assertion Helper Tests ============

    #[test]
    fn test_approximately_equal_exact() {
        assert!(assert_approximately_equal(1000, 1000, 0));
    }

    #[test]
    fn test_approximately_equal_within_tolerance() {
        // 1% tolerance: 100 bps
        assert!(assert_approximately_equal(1005, 1000, 100));
    }

    #[test]
    fn test_approximately_equal_outside_tolerance() {
        // 1% tolerance
        assert!(!assert_approximately_equal(1020, 1000, 100));
    }

    #[test]
    fn test_approximately_equal_zero() {
        assert!(assert_approximately_equal(0, 0, 100));
    }

    #[test]
    fn test_approximately_equal_zero_expected_nonzero_actual() {
        assert!(!assert_approximately_equal(1, 0, 100));
    }

    #[test]
    fn test_approximately_equal_boundary() {
        // Exactly at boundary: 10 is 1% of 1000
        assert!(assert_approximately_equal(1010, 1000, 100));
    }

    #[test]
    fn test_approximately_equal_just_over() {
        assert!(!assert_approximately_equal(1011, 1000, 100));
    }

    #[test]
    fn test_within_range_inside() {
        assert!(assert_within_range(50, 10, 100));
    }

    #[test]
    fn test_within_range_at_min() {
        assert!(assert_within_range(10, 10, 100));
    }

    #[test]
    fn test_within_range_at_max() {
        assert!(assert_within_range(100, 10, 100));
    }

    #[test]
    fn test_within_range_below() {
        assert!(!assert_within_range(5, 10, 100));
    }

    #[test]
    fn test_within_range_above() {
        assert!(!assert_within_range(101, 10, 100));
    }

    #[test]
    fn test_monotonic_increasing_valid() {
        assert!(assert_monotonic_increasing(&[1, 2, 3, 4, 5]));
    }

    #[test]
    fn test_monotonic_increasing_with_equals() {
        assert!(assert_monotonic_increasing(&[1, 1, 2, 2, 3]));
    }

    #[test]
    fn test_monotonic_increasing_invalid() {
        assert!(!assert_monotonic_increasing(&[1, 3, 2, 4]));
    }

    #[test]
    fn test_monotonic_increasing_single() {
        assert!(assert_monotonic_increasing(&[42]));
    }

    #[test]
    fn test_monotonic_increasing_empty() {
        assert!(assert_monotonic_increasing(&[]));
    }

    #[test]
    fn test_monotonic_decreasing_valid() {
        assert!(assert_monotonic_decreasing(&[5, 4, 3, 2, 1]));
    }

    #[test]
    fn test_monotonic_decreasing_with_equals() {
        assert!(assert_monotonic_decreasing(&[5, 5, 3, 3, 1]));
    }

    #[test]
    fn test_monotonic_decreasing_invalid() {
        assert!(!assert_monotonic_decreasing(&[5, 3, 4, 1]));
    }

    #[test]
    fn test_monotonic_decreasing_single() {
        assert!(assert_monotonic_decreasing(&[42]));
    }

    #[test]
    fn test_monotonic_decreasing_empty() {
        assert!(assert_monotonic_decreasing(&[]));
    }

    #[test]
    fn test_sum_equals_valid() {
        assert!(assert_sum_equals(&[10, 20, 30], 60));
    }

    #[test]
    fn test_sum_equals_invalid() {
        assert!(!assert_sum_equals(&[10, 20, 30], 100));
    }

    #[test]
    fn test_sum_equals_empty() {
        assert!(assert_sum_equals(&[], 0));
    }

    #[test]
    fn test_sum_equals_single() {
        assert!(assert_sum_equals(&[42], 42));
    }

    #[test]
    fn test_k_preserved_equal() {
        assert!(assert_k_preserved(1000, 1000));
    }

    #[test]
    fn test_k_preserved_increased() {
        assert!(assert_k_preserved(1000, 1001));
    }

    #[test]
    fn test_k_preserved_decreased() {
        assert!(!assert_k_preserved(1001, 1000));
    }

    #[test]
    fn test_k_preserved_zero() {
        assert!(assert_k_preserved(0, 0));
    }

    // ============ Test Vector Tests ============

    #[test]
    fn test_sqrt_vectors_count() {
        let vectors = known_sqrt_vectors();
        assert!(vectors.len() >= 10, "Need at least 10 sqrt vectors");
    }

    #[test]
    fn test_sqrt_vectors_correctness() {
        let vectors = known_sqrt_vectors();
        for v in &vectors {
            let input = v.input[0] as u128;
            let expected = v.expected_output[0];
            let actual = isqrt_u128(input);
            assert_eq!(actual, expected, "Failed: {}", v.description);
        }
    }

    #[test]
    fn test_sqrt_vectors_all_have_descriptions() {
        let vectors = known_sqrt_vectors();
        for v in &vectors {
            assert!(!v.description.is_empty());
        }
    }

    #[test]
    fn test_amm_vectors_count() {
        let vectors = known_amm_vectors();
        assert!(vectors.len() >= 5, "Need at least 5 AMM vectors");
    }

    #[test]
    fn test_amm_vectors_correctness() {
        let vectors = known_amm_vectors();
        for v in &vectors {
            let reserve_in = v.input[0] as u128;
            let reserve_out = v.input[1] as u128;
            let amount_in = v.input[2] as u128;
            let expected_out = v.expected_output[0];
            // out = (reserve_out * amount_in) / (reserve_in + amount_in)
            let actual = if reserve_in + amount_in == 0 {
                0
            } else {
                (reserve_out * amount_in / (reserve_in + amount_in)) as u64
            };
            assert_eq!(actual, expected_out, "Failed: {}", v.description);
        }
    }

    #[test]
    fn test_amm_vectors_all_have_descriptions() {
        let vectors = known_amm_vectors();
        for v in &vectors {
            assert!(!v.description.is_empty());
        }
    }

    #[test]
    fn test_compound_interest_vectors_count() {
        let vectors = known_compound_interest_vectors();
        assert!(vectors.len() >= 5, "Need at least 5 compound interest vectors");
    }

    #[test]
    fn test_compound_interest_vectors_correctness() {
        let vectors = known_compound_interest_vectors();
        for v in &vectors {
            let principal = v.input[0] as u128;
            let rate_bps = v.input[1] as u128;
            let periods = v.input[2];
            let expected = v.expected_output[0];

            // Compute compound interest: A = P * (1 + rate/BPS)^n
            let mut amount = principal;
            for _ in 0..periods {
                amount = amount + amount * rate_bps / BPS as u128;
            }
            let actual = amount as u64;
            assert_eq!(actual, expected, "Failed: {}", v.description);
        }
    }

    #[test]
    fn test_compound_interest_zero_rate() {
        let vectors = known_compound_interest_vectors();
        let zero_rate: Vec<_> = vectors.iter().filter(|v| v.input[1] == 0).collect();
        for v in &zero_rate {
            assert_eq!(v.input[0], v.expected_output[0], "Zero rate should preserve principal");
        }
    }

    #[test]
    fn test_compound_interest_zero_principal() {
        let vectors = known_compound_interest_vectors();
        let zero_princ: Vec<_> = vectors.iter().filter(|v| v.input[0] == 0).collect();
        for v in &zero_princ {
            assert_eq!(v.expected_output[0], 0, "Zero principal should stay zero");
        }
    }

    // ============ Cross-Cutting / Integration Tests ============

    #[test]
    fn test_scenario_with_simulation() {
        let s = basic_swap_scenario();
        let mut pool = s.pools[0].clone();
        let result = simulate_swap(&mut pool, s.orders[0].amount, true);
        assert!(result.k_preserved);
        assert_eq!(result.trades_executed, 1);
    }

    #[test]
    fn test_pool_price_after_swap() {
        let mut pool = balanced_pool(1, 1_000_000);
        let price_before = compute_mock_price(&pool);
        simulate_swap(&mut pool, 50_000, true); // buy A -> price of B in A goes down
        let price_after = compute_mock_price(&pool);
        // After buying B with A, B becomes scarcer => price increases initially was wrong
        // Actually: adding A, removing B means reserve_a up, reserve_b down
        // price = reserve_b / reserve_a => price goes down
        assert!(price_after < price_before);
    }

    #[test]
    fn test_roundtrip_swap_price_recovery() {
        let mut pool = balanced_pool(1, 1_000_000);
        let price_before = compute_mock_price(&pool);
        simulate_swap(&mut pool, 10_000, true);
        simulate_swap(&mut pool, 10_000, false);
        let price_after = compute_mock_price(&pool);
        // Due to fees, price won't recover exactly but should be close
        assert!(assert_approximately_equal(price_after, price_before, 100));
    }

    #[test]
    fn test_many_small_swaps_k_grows() {
        let mut pool = balanced_pool(1, 1_000_000);
        let initial_k = compute_mock_k(&pool);
        for _ in 0..100 {
            simulate_swap(&mut pool, 1000, true);
            simulate_swap(&mut pool, 1000, false);
        }
        let final_k = compute_mock_k(&pool);
        assert!(final_k > initial_k, "k should grow from accumulated fees");
    }

    #[test]
    fn test_stress_scenario_all_pools_valid() {
        let s = stress_scenario(10, 5);
        for pool in &s.pools {
            assert!(pool.reserve_a > 0);
            assert!(pool.reserve_b > 0);
            assert!(compute_mock_k(pool) > 0);
        }
    }

    #[test]
    fn test_mock_user_can_afford_order() {
        let user = mock_user(1, 100_000);
        let order = mock_buy_order(50_000, 100_000);
        assert!(user.balance >= order.amount);
    }

    #[test]
    fn test_dust_user_cannot_afford_whale_order() {
        let user = dust_user(1);
        let order = mock_buy_order(1_000_000, 100_000);
        assert!(user.balance < order.amount);
    }

    #[test]
    fn test_test_vector_equality() {
        let v1 = TestVector {
            input: vec![1, 2, 3],
            expected_output: vec![4, 5, 6],
            description: "test".to_string(),
        };
        let v2 = v1.clone();
        assert_eq!(v1, v2);
    }

    #[test]
    fn test_test_vector_inequality() {
        let v1 = TestVector {
            input: vec![1],
            expected_output: vec![1],
            description: "a".to_string(),
        };
        let v2 = TestVector {
            input: vec![2],
            expected_output: vec![1],
            description: "b".to_string(),
        };
        assert_ne!(v1, v2);
    }

    #[test]
    fn test_simulation_result_fields() {
        let mut pool = balanced_pool(1, 1_000_000);
        let result = simulate_swap(&mut pool, 10_000, true);
        assert!(result.initial_k > 0);
        assert!(result.final_k > 0);
        assert!(result.total_fees > 0);
        assert!(result.price_impact_bps > 0 || result.price_impact_bps == 0);
    }

    #[test]
    fn test_batch_auction_scenario_deterministic() {
        let s1 = batch_auction_scenario(20);
        let s2 = batch_auction_scenario(20);
        assert_eq!(s1.orders.len(), s2.orders.len());
        for i in 0..s1.orders.len() {
            assert_eq!(s1.orders[i].amount, s2.orders[i].amount);
        }
    }

    #[test]
    fn test_all_address_types_32_bytes() {
        assert_eq!(mock_address(1).len(), 32);
        assert_eq!(mock_address_from_u64(1).len(), 32);
        assert_eq!(random_address(1).len(), 32);
        assert_eq!(zero_address().len(), 32);
        assert_eq!(max_address().len(), 32);
    }

    #[test]
    fn test_pool_clone_independence() {
        let mut pool = balanced_pool(1, 1_000_000);
        let snapshot = pool.clone();
        simulate_swap(&mut pool, 50_000, true);
        // Original clone should be unchanged
        assert_eq!(snapshot.reserve_a, 1_000_000);
        assert_eq!(snapshot.reserve_b, 1_000_000);
        // Mutated pool should differ
        assert_ne!(pool.reserve_a, snapshot.reserve_a);
    }

    #[test]
    fn test_isqrt_perfect_squares() {
        assert_eq!(isqrt_u128(0), 0);
        assert_eq!(isqrt_u128(1), 1);
        assert_eq!(isqrt_u128(4), 2);
        assert_eq!(isqrt_u128(9), 3);
        assert_eq!(isqrt_u128(16), 4);
        assert_eq!(isqrt_u128(10000), 100);
    }

    #[test]
    fn test_isqrt_non_perfect() {
        // Floor of sqrt
        assert_eq!(isqrt_u128(2), 1);
        assert_eq!(isqrt_u128(3), 1);
        assert_eq!(isqrt_u128(5), 2);
        assert_eq!(isqrt_u128(8), 2);
        assert_eq!(isqrt_u128(15), 3);
    }

    #[test]
    fn test_simple_hash_deterministic() {
        let h1 = simple_hash_u64(42);
        let h2 = simple_hash_u64(42);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_simple_hash_different_inputs() {
        let h1 = simple_hash_u64(0);
        let h2 = simple_hash_u64(1);
        assert_ne!(h1, h2);
    }

    // ============ Hardening Round 10 ============

    #[test]
    fn test_mock_pool_k_value_h10() {
        let pool = mock_pool(1, 1000, 2000);
        let k = compute_mock_k(&pool);
        assert_eq!(k, 1000u128 * 2000u128);
    }

    #[test]
    fn test_mock_pool_zero_reserves_h10() {
        let pool = mock_pool(1, 0, 0);
        assert_eq!(pool.reserve_a, 0);
        assert_eq!(pool.reserve_b, 0);
        assert_eq!(pool.total_lp, 0);
    }

    #[test]
    fn test_balanced_pool_equal_reserves_h10() {
        let pool = balanced_pool(5, 999_999);
        assert_eq!(pool.reserve_a, pool.reserve_b);
        assert_eq!(pool.reserve_a, 999_999);
    }

    #[test]
    fn test_imbalanced_pool_ratio_h10() {
        let pool = imbalanced_pool(1, 8000, 10_000);
        assert_eq!(pool.reserve_a, 8000);
        assert_eq!(pool.reserve_b, 2000);
    }

    #[test]
    fn test_imbalanced_pool_capped_ratio_h10() {
        // Ratio > BPS should be capped
        let pool = imbalanced_pool(1, 15_000, 10_000);
        // Capped to BPS=10000, so reserve_a = total, reserve_b = 0
        assert_eq!(pool.reserve_a, 10_000);
        assert_eq!(pool.reserve_b, 0);
    }

    #[test]
    fn test_high_fee_pool_fee_h10() {
        let pool = high_fee_pool(1, 1_000_000);
        assert_eq!(pool.fee_bps, HIGH_FEE_BPS);
        assert_eq!(pool.reserve_a, pool.reserve_b);
    }

    #[test]
    fn test_low_fee_pool_fee_h10() {
        let pool = low_fee_pool(1, 1_000_000);
        assert_eq!(pool.fee_bps, LOW_FEE_BPS);
    }

    #[test]
    fn test_pool_with_k_balanced_h10() {
        let pool = pool_with_k(1_000_000, 5000);
        let actual_k = pool.reserve_a as u128 * pool.reserve_b as u128;
        // Should be approximately k (integer rounding may cause small diff)
        let diff = if actual_k > 1_000_000 { actual_k - 1_000_000 } else { 1_000_000 - actual_k };
        assert!(diff < 100, "k deviated by {}", diff);
    }

    #[test]
    fn test_pool_with_k_zero_ratio_h10() {
        let pool = pool_with_k(1_000_000, 0);
        // Should default to 5000 (balanced)
        assert!(pool.reserve_a > 0);
        assert!(pool.reserve_b > 0);
    }

    #[test]
    fn test_whale_user_balance_h10() {
        let user = whale_user(1);
        assert_eq!(user.balance, WHALE_BALANCE);
        assert_eq!(user.voting_power, WHALE_BALANCE / 10);
    }

    #[test]
    fn test_dust_user_balance_h10() {
        let user = dust_user(1);
        assert_eq!(user.balance, DUST_BALANCE);
        assert_eq!(user.voting_power, 0);
    }

    #[test]
    fn test_staker_user_fields_h10() {
        let user = staker_user(1, 5000, 2500);
        assert_eq!(user.staked, 5000);
        assert_eq!(user.voting_power, 2500);
        assert_eq!(user.balance, 5000);
    }

    #[test]
    fn test_mock_users_scaling_h10() {
        let users = mock_users(5, 100);
        assert_eq!(users.len(), 5);
        assert_eq!(users[0].balance, 100);
        assert_eq!(users[4].balance, 500);
    }

    #[test]
    fn test_mock_users_zero_count_h10() {
        let users = mock_users(0, 100);
        assert!(users.is_empty());
    }

    #[test]
    fn test_mock_buy_order_fields_h10() {
        let order = mock_buy_order(5000, 200);
        assert!(order.is_buy);
        assert_eq!(order.amount, 5000);
        assert_eq!(order.price_limit, 200);
    }

    #[test]
    fn test_mock_sell_order_fields_h10() {
        let order = mock_sell_order(3000, 150);
        assert!(!order.is_buy);
        assert_eq!(order.amount, 3000);
        assert_eq!(order.price_limit, 150);
    }

    #[test]
    fn test_mock_market_order_buy_h10() {
        let order = mock_market_order(1000, true);
        assert!(order.is_buy);
        assert_eq!(order.price_limit, u64::MAX);
    }

    #[test]
    fn test_mock_market_order_sell_h10() {
        let order = mock_market_order(1000, false);
        assert!(!order.is_buy);
        assert_eq!(order.price_limit, 0);
    }

    #[test]
    fn test_random_orders_count_h10() {
        let orders = random_orders(50, 10_000, 5000);
        assert_eq!(orders.len(), 50);
    }

    #[test]
    fn test_random_orders_zero_max_amount_h10() {
        let orders = random_orders(5, 0, 5000);
        // Should still produce orders with amount = 1
        for order in &orders {
            assert!(order.amount >= 1);
        }
    }

    #[test]
    fn test_balanced_orderbook_equal_sides_h10() {
        let orders = balanced_orderbook(10, 1000, 100);
        let buys = orders.iter().filter(|o| o.is_buy).count();
        let sells = orders.iter().filter(|o| !o.is_buy).count();
        assert_eq!(buys, sells);
    }

    #[test]
    fn test_balanced_orderbook_zero_count_h10() {
        let orders = balanced_orderbook(0, 1000, 100);
        assert!(orders.is_empty());
    }

    #[test]
    fn test_simulate_swap_zero_amount_h10() {
        let mut pool = balanced_pool(1, 1_000_000);
        let result = simulate_swap(&mut pool, 0, true);
        assert!(result.k_preserved);
        assert_eq!(result.total_fees, 0);
        assert_eq!(result.trades_executed, 0);
    }

    #[test]
    fn test_simulate_swap_preserves_k_h10() {
        let mut pool = balanced_pool(1, 1_000_000);
        let result = simulate_swap(&mut pool, 10_000, true);
        assert!(result.k_preserved, "k should not decrease after swap with fees");
        assert!(result.total_fees > 0);
    }

    #[test]
    fn test_simulate_multi_swap_roundtrip_h10() {
        let mut pool = balanced_pool(1, 1_000_000);
        let swaps = vec![(10_000, true), (10_000, false)];
        let result = simulate_multi_swap(&mut pool, &swaps);
        assert_eq!(result.trades_executed, 2);
        assert!(result.k_preserved);
    }

    #[test]
    fn test_assert_approximately_equal_exact_h10() {
        assert!(assert_approximately_equal(100, 100, 0));
    }

    #[test]
    fn test_assert_approximately_equal_within_tolerance_h10() {
        assert!(assert_approximately_equal(101, 100, 200)); // 1% diff, 2% tolerance
    }

    #[test]
    fn test_assert_approximately_equal_zero_expected_h10() {
        assert!(!assert_approximately_equal(1, 0, 100));
        assert!(assert_approximately_equal(0, 0, 100));
    }

    #[test]
    fn test_assert_within_range_boundary_h10() {
        assert!(assert_within_range(5, 5, 10));
        assert!(assert_within_range(10, 5, 10));
        assert!(!assert_within_range(4, 5, 10));
        assert!(!assert_within_range(11, 5, 10));
    }

    #[test]
    fn test_assert_monotonic_empty_and_single_h10() {
        assert!(assert_monotonic_increasing(&[]));
        assert!(assert_monotonic_increasing(&[42]));
        assert!(assert_monotonic_decreasing(&[]));
        assert!(assert_monotonic_decreasing(&[42]));
    }

    #[test]
    fn test_assert_sum_equals_h10() {
        assert!(assert_sum_equals(&[1, 2, 3], 6));
        assert!(!assert_sum_equals(&[1, 2, 3], 7));
    }

    #[test]
    fn test_ckb_cell_conversion_h10() {
        let cell = ckb_cell(100);
        assert_eq!(cell.capacity, 100 * CKB_SHANNON);
    }

    #[test]
    fn test_mock_typed_cell_hashes_h10() {
        let cell = mock_typed_cell(500, 1, 2);
        assert!(cell.type_hash.is_some());
        assert_eq!(cell.type_hash.unwrap(), mock_hash(1));
        assert_eq!(cell.lock_hash, mock_hash(2));
    }

    #[test]
    fn test_transfer_transaction_structure_h10() {
        let tx = transfer_transaction(1, 2, 5000);
        assert_eq!(tx.inputs.len(), 1);
        assert_eq!(tx.outputs.len(), 1);
        assert_eq!(tx.inputs[0].capacity, 5000);
        assert_eq!(tx.outputs[0].capacity, 5000);
    }

    #[test]
    fn test_empty_scenario_fields_h10() {
        let s = empty_scenario("test");
        assert_eq!(s.name, "test");
        assert!(s.pools.is_empty());
        assert!(s.users.is_empty());
        assert!(s.orders.is_empty());
    }

    #[test]
    fn test_basic_swap_scenario_contents_h10() {
        let s = basic_swap_scenario();
        assert_eq!(s.pools.len(), 1);
        assert_eq!(s.users.len(), 2);
        assert_eq!(s.orders.len(), 2);
    }

    #[test]
    fn test_known_sqrt_vectors_valid_h10() {
        let vectors = known_sqrt_vectors();
        for v in &vectors {
            let input = v.input[0];
            let expected = v.expected_output[0];
            assert_eq!(isqrt_u128(input as u128), expected, "Failed for {}", v.description);
        }
    }
}
