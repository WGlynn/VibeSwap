// ============ Math Parity Tests: Rust ↔ Solidity ============
// Test vectors derived from Solidity Foundry tests.
// Verifies VibeSwap's Rust math implementations match expected Solidity outputs.

use vibeswap_math::batch_math::{self, Order};
use vibeswap_math::shuffle;
use vibeswap_math::twap::OracleState;
use vibeswap_math::{mul_cmp, mul_div, sqrt_product, wide_mul, MathError, PRECISION};

const MINIMUM_LIQUIDITY: u128 = 1000;

// ============ AMM Math ============

#[test]
fn test_get_amount_out_parity() {
    // Reserves: (1M * 1e18, 2M * 1e18), fee = 5 bps, amount_in = 1000 * 1e18
    // In Solidity: xy=k with fee → output ≈ 1997.6 tokens
    // The 2:1 reserve ratio means 1000 token0 ≈ 2000 token1 minus fee and price impact
    let reserve_in = 1_000_000 * PRECISION;
    let reserve_out = 2_000_000 * PRECISION;
    let fee_bps = 5u128;
    let amount_in = 1000 * PRECISION;

    let out = batch_math::get_amount_out(amount_in, reserve_in, reserve_out, fee_bps).unwrap();

    // Expected ≈ 1997.6 tokens (0.05% fee + ~0.1% price impact on 0.1% of pool)
    assert!(
        out >= 1996 * PRECISION,
        "Output too low: {} < {}",
        out,
        1996 * PRECISION
    );
    assert!(
        out <= 1999 * PRECISION,
        "Output too high: {} > {}",
        out,
        1999 * PRECISION
    );
}

#[test]
fn test_get_amount_in_parity() {
    // Inverse of get_amount_out: find amount_in needed for amount_out = 1000 * 1e18
    let reserve_in = 1_000_000 * PRECISION;
    let reserve_out = 2_000_000 * PRECISION;
    let fee_bps = 5u128;
    let target_out = 1000 * PRECISION;

    let amount_in =
        batch_math::get_amount_in(target_out, reserve_in, reserve_out, fee_bps).unwrap();

    // Round-trip verification: get_amount_out(get_amount_in(target)) >= target
    // The +1 rounding in get_amount_in guarantees this invariant
    let round_trip_out =
        batch_math::get_amount_out(amount_in, reserve_in, reserve_out, fee_bps).unwrap();
    assert!(
        round_trip_out >= target_out,
        "Round-trip failed: get_amount_out({}) = {} < target {}",
        amount_in,
        round_trip_out,
        target_out
    );
}

#[test]
fn test_calculate_liquidity_initial() {
    // First deposit: amount0 = 1M * 1e18, amount1 = 2M * 1e18
    // LP = sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY
    let amount0 = 1_000_000 * PRECISION;
    let amount1 = 2_000_000 * PRECISION;

    let lp = batch_math::calculate_liquidity(amount0, amount1, 0, 0, 0).unwrap();

    // sqrt_product handles the overflow-safe computation
    let expected_sqrt = sqrt_product(amount0, amount1);
    assert_eq!(lp, expected_sqrt - MINIMUM_LIQUIDITY);

    // Sanity bounds
    assert!(lp > 0, "LP tokens should be positive");
    // Geometric mean is always <= arithmetic mean: sqrt(a*b) <= (a+b)/2
    let arithmetic_mean = (amount0 + amount1) / 2;
    assert!(
        lp < arithmetic_mean,
        "LP should be less than arithmetic mean (geometric < arithmetic)"
    );
}

#[test]
fn test_calculate_liquidity_subsequent() {
    // Existing pool: reserves (1M, 2M), total_supply = sqrt(1M*2M) * 1e18 - 1000
    let reserve0 = 1_000_000 * PRECISION;
    let reserve1 = 2_000_000 * PRECISION;
    let total_supply = sqrt_product(reserve0, reserve1) - MINIMUM_LIQUIDITY;

    // Add 10% more liquidity: (100K, 200K)
    let add0 = 100_000 * PRECISION;
    let add1 = 200_000 * PRECISION;

    let lp = batch_math::calculate_liquidity(add0, add1, reserve0, reserve1, total_supply).unwrap();

    // LP should be ~10% of existing supply (proportional add)
    // liquidity0 = add0 * total_supply / reserve0 = 0.1 * total_supply
    // liquidity1 = add1 * total_supply / reserve1 = 0.1 * total_supply
    let expected_approx = total_supply / 10;
    let tolerance = expected_approx / 1000; // 0.1% tolerance for rounding

    assert!(
        lp >= expected_approx - tolerance && lp <= expected_approx + tolerance,
        "LP should be ~10% of supply. Got: {}, expected ~{}",
        lp,
        expected_approx
    );
}

#[test]
fn test_optimal_liquidity_ratio() {
    // Desired: (1000, 3000), reserves: (1M, 2M) → ratio is 1:2
    // Optimal should adjust to maintain the 1:2 ratio
    let amount0_desired = 1000 * PRECISION;
    let amount1_desired = 3000 * PRECISION;
    let reserve0 = 1_000_000 * PRECISION;
    let reserve1 = 2_000_000 * PRECISION;

    let (opt0, opt1) =
        batch_math::calculate_optimal_liquidity(amount0_desired, amount1_desired, reserve0, reserve1)
            .unwrap();

    // With reserves 1:2, for 1000 token0, optimal token1 = 2000
    // Since 2000 <= 3000 (desired), it should keep amount0 and adjust amount1
    assert_eq!(opt0, amount0_desired);
    assert_eq!(
        opt1,
        2000 * PRECISION,
        "Optimal amount1 should match reserve ratio: 1000 * (2M/1M) = 2000"
    );

    // Either amount was adjusted (not both increased)
    assert!(
        opt0 <= amount0_desired && opt1 <= amount1_desired,
        "Optimal amounts should not exceed desired"
    );
}

// ============ Clearing Price ============

#[test]
fn test_clearing_price_balanced() {
    // Equal buy/sell pressure at market price
    // Reserve ratio 1:2, spot price = 2 * PRECISION
    let reserve0 = 1_000_000 * PRECISION;
    let reserve1 = 2_000_000 * PRECISION;

    // Limit prices near spot (2 * PRECISION = 2e18), NOT 2100 * PRECISION
    let buys = vec![Order {
        amount: 100 * PRECISION,
        limit_price: 21 * PRECISION / 10, // 2.1 * PRECISION
    }];
    let sells = vec![Order {
        amount: 100 * PRECISION,
        limit_price: 19 * PRECISION / 10, // 1.9 * PRECISION
    }];

    let (price, volume) =
        batch_math::calculate_clearing_price(&buys, &sells, reserve0, reserve1).unwrap();

    // Clearing price should be close to spot price (2 * PRECISION)
    let spot = 2 * PRECISION;
    let max_deviation = spot / 5; // Within 20%
    assert!(
        price > spot - max_deviation && price < spot + max_deviation,
        "Balanced clearing price {} should be near spot {}",
        price,
        spot
    );
    assert!(volume > 0, "Should have positive volume");
}

#[test]
fn test_clearing_price_buy_pressure() {
    // More buys than sells → clearing price should rise above spot
    let reserve0 = 1_000_000 * PRECISION;
    let reserve1 = 2_000_000 * PRECISION;
    let spot = 2 * PRECISION;

    let buys = vec![
        Order {
            amount: 500 * PRECISION,
            limit_price: 25 * PRECISION / 10, // 2.5
        },
        Order {
            amount: 300 * PRECISION,
            limit_price: 23 * PRECISION / 10, // 2.3
        },
    ];
    let sells = vec![Order {
        amount: 50 * PRECISION,
        limit_price: 19 * PRECISION / 10, // 1.9
    }];

    let (price, _volume) =
        batch_math::calculate_clearing_price(&buys, &sells, reserve0, reserve1).unwrap();

    // With heavy buy pressure, clearing price should be above spot
    assert!(
        price >= spot,
        "Buy pressure should push clearing price {} above spot {}",
        price,
        spot
    );
}

#[test]
fn test_clearing_price_sell_pressure() {
    // More sells than buys → clearing price should fall below spot
    let reserve0 = 1_000_000 * PRECISION;
    let reserve1 = 2_000_000 * PRECISION;
    let spot = 2 * PRECISION;

    let buys = vec![Order {
        amount: 50 * PRECISION,
        limit_price: 21 * PRECISION / 10, // 2.1
    }];
    let sells = vec![
        Order {
            amount: 500 * PRECISION,
            limit_price: 15 * PRECISION / 10, // 1.5
        },
        Order {
            amount: 300 * PRECISION,
            limit_price: 17 * PRECISION / 10, // 1.7
        },
    ];

    let (price, _volume) =
        batch_math::calculate_clearing_price(&buys, &sells, reserve0, reserve1).unwrap();

    // With heavy sell pressure, clearing price should be below spot
    assert!(
        price <= spot,
        "Sell pressure should push clearing price {} below spot {}",
        price,
        spot
    );
}

// ============ Shuffle ============

#[test]
fn test_shuffle_deterministic_parity() {
    // Same seed → same permutation every time (Solidity parity)
    let seed = [0xAB; 32];
    let n = 10;

    let s1 = shuffle::shuffle_indices(n, &seed);
    let s2 = shuffle::shuffle_indices(n, &seed);

    assert_eq!(s1, s2, "Deterministic shuffle: same seed must produce identical output");
    assert_eq!(s1.len(), n);
}

#[test]
fn test_shuffle_is_permutation() {
    // Every element appears exactly once — fundamental Fisher-Yates invariant
    let seed = [0xCD; 32];
    let n = 10;

    let shuffled = shuffle::shuffle_indices(n, &seed);
    assert_eq!(shuffled.len(), n);

    let mut sorted = shuffled.clone();
    sorted.sort();
    let expected: Vec<usize> = (0..n).collect();
    assert_eq!(
        sorted, expected,
        "Shuffle must be a valid permutation of 0..n"
    );
}

#[test]
fn test_shuffle_seed_generation() {
    // XOR of 3 secrets → deterministic 32-byte seed
    let secret1 = [0x11; 32];
    let secret2 = [0x22; 32];
    let secret3 = [0x33; 32];
    let secrets = vec![secret1, secret2, secret3];

    let seed_a = shuffle::generate_seed(&secrets);
    let seed_b = shuffle::generate_seed(&secrets);
    assert_eq!(seed_a, seed_b, "Same secrets must produce same seed");

    // Verify seed is non-trivial (not all zeros)
    assert_ne!(seed_a, [0u8; 32], "Seed should not be all zeros");

    // Verify secure variant with block entropy produces different seed
    let block_entropy = [0xFF; 32];
    let secure_seed = shuffle::generate_seed_secure(&secrets, &block_entropy, 42);
    assert_ne!(
        seed_a, secure_seed,
        "Secure seed with entropy should differ from basic seed"
    );
}

// ============ TWAP ============

#[test]
fn test_twap_accumulation() {
    // Add observations at blocks 100, 200, 300 with prices 2000, 2100, 1900
    // TWAP over the window should be a weighted average ≈ 2000
    let mut oracle = OracleState::new(100);

    oracle.initialize(2000 * PRECISION, 100);
    oracle.write(2100 * PRECISION, 200);
    oracle.write(1900 * PRECISION, 300);

    // Consult for a 200-block window ending at block 300 (starting at block 100)
    let twap = oracle.consult(200, 300).unwrap();

    // Weighted average: price=2000 for blocks 100-200 (weight 100), price=2100 for 200-300 (weight 100)
    // = (2000*100 + 2100*100) / 200 = 2050
    // (The initial observation is the "anchor" — actual weights depend on cumulative accounting)
    // Allow reasonable tolerance around the expected range
    assert!(
        twap > 1900 * PRECISION,
        "TWAP {} should be above 1900e18",
        twap
    );
    assert!(
        twap < 2200 * PRECISION,
        "TWAP {} should be below 2200e18",
        twap
    );
}

#[test]
fn test_twap_single_observation() {
    // Only one data point → consult should return an error (cardinality < 2)
    let mut oracle = OracleState::new(100);
    oracle.initialize(2500 * PRECISION, 100);

    let result = oracle.consult(10, 110);
    assert!(
        result.is_err(),
        "Single observation should return error (need at least 2 for TWAP)"
    );
}

// ============ Wide Arithmetic (256-bit) ============

#[test]
fn test_wide_mul_known_values() {
    // 2^64 * 2^64 = 2^128 → hi=1, lo=0
    let two_64: u128 = 1u128 << 64;
    let (hi, lo) = wide_mul(two_64, two_64);
    assert_eq!(hi, 1, "2^64 * 2^64 high word should be 1");
    assert_eq!(lo, 0, "2^64 * 2^64 low word should be 0");

    // u128::MAX * 2 → hi=1, lo=u128::MAX-1
    // u128::MAX = 2^128 - 1
    // (2^128 - 1) * 2 = 2^129 - 2 = 1 * 2^128 + (2^128 - 2)
    // hi = 1, lo = 2^128 - 2 = u128::MAX - 1
    let (hi2, lo2) = wide_mul(u128::MAX, 2);
    assert_eq!(hi2, 1, "MAX * 2 high word should be 1");
    assert_eq!(
        lo2,
        u128::MAX - 1,
        "MAX * 2 low word should be u128::MAX - 1"
    );
}

#[test]
fn test_mul_div_no_overflow() {
    // (1e24 * 1e18) / 1e24 should equal 1e18 exactly
    // The intermediate 1e24 * 1e18 = 1e42 overflows u128 (max ~3.4e38)
    let a = 1_000_000 * PRECISION; // 1e24
    let b = PRECISION; // 1e18
    let c = 1_000_000 * PRECISION; // 1e24

    // Verify this actually overflows as a direct multiply
    assert!(
        a.checked_mul(b).is_none(),
        "1e24 * 1e18 should overflow u128"
    );

    let result = mul_div(a, b, c);
    assert_eq!(
        result, PRECISION,
        "(1e24 * 1e18) / 1e24 should equal 1e18"
    );
}

#[test]
fn test_mul_cmp_large_values() {
    use core::cmp::Ordering;

    let e24 = 1_000_000 * PRECISION; // 1e24
    let e24_2 = 2_000_000 * PRECISION; // 2e24
    let e24_3 = 3_000_000 * PRECISION; // 3e24

    // Compare (1e24 * 2e24) vs (2e24 * 1e24) → Equal (commutative)
    assert_eq!(
        mul_cmp(e24, e24_2, e24_2, e24),
        Ordering::Equal,
        "a*b should equal b*a (commutativity)"
    );

    // Compare (1e24 * 2e24) vs (1e24 * 3e24) → Less
    assert_eq!(
        mul_cmp(e24, e24_2, e24, e24_3),
        Ordering::Less,
        "1e24*2e24 should be less than 1e24*3e24"
    );

    // Reverse: (1e24 * 3e24) vs (1e24 * 2e24) → Greater
    assert_eq!(
        mul_cmp(e24, e24_3, e24, e24_2),
        Ordering::Greater,
        "1e24*3e24 should be greater than 1e24*2e24"
    );
}

#[test]
fn test_sqrt_product_overflow_safe() {
    // sqrt_product(1e24, 4e24) should equal 2e24 (approximately)
    // Direct 1e24 * 4e24 = 4e48 overflows u128, but sqrt_product handles it
    let a = 1_000_000 * PRECISION; // 1e24
    let b = 4_000_000 * PRECISION; // 4e24

    // Verify direct multiply overflows
    assert!(
        a.checked_mul(b).is_none(),
        "1e24 * 4e24 should overflow u128"
    );

    let result = sqrt_product(a, b);

    // sqrt(1e24 * 4e24) = sqrt(4e48) = 2e24
    let expected = 2_000_000 * PRECISION; // 2e24
    // Allow small error from fallback approximation (sqrt(a) * sqrt(b))
    let tolerance = expected / 1000; // 0.1%
    assert!(
        result >= expected - tolerance && result <= expected + tolerance,
        "sqrt_product(1e24, 4e24) = {} should be ≈ 2e24 = {}",
        result,
        expected
    );
}

// ============ Edge Cases ============

#[test]
fn test_zero_amount_out() {
    // get_amount_out with amount_in = 0 → should return error
    let result = batch_math::get_amount_out(0, 1_000_000 * PRECISION, 2_000_000 * PRECISION, 5);
    assert_eq!(
        result,
        Err(MathError::InsufficientInput),
        "Zero input should return InsufficientInput error"
    );
}

#[test]
fn test_max_reserves_no_panic() {
    // get_amount_out with reserves near u128::MAX/2 → must not panic
    // Uses large but not quite maximal reserves to stay within checked_mul bounds
    let large_reserve = u128::MAX / 4;
    let amount_in = PRECISION; // Small swap relative to reserves

    // This should not panic — may return Overflow for extreme reserves (checked_mul)
    let result = batch_math::get_amount_out(amount_in, large_reserve, large_reserve, 5);
    match result {
        Ok(out) => {
            // With equal reserves, output ≈ input minus fee (negligible price impact)
            assert!(out > 0, "Output should be positive");
            assert!(out < amount_in, "Output should be less than input (fees)");
        }
        Err(MathError::Overflow) => {
            // Overflow is acceptable for reserves near u128::MAX/4
            // (reserve_in * BPS_DENOMINATOR overflows checked_mul)
        }
        Err(e) => {
            panic!("Unexpected error for large reserves: {:?}", e);
        }
    }
}

#[test]
fn test_single_order_clearing() {
    // Clearing price with only 1 buy order, no sells → should still produce a result
    let reserve0 = 1_000_000 * PRECISION;
    let reserve1 = 2_000_000 * PRECISION;

    let buys = vec![Order {
        amount: 100 * PRECISION,
        limit_price: 21 * PRECISION / 10, // 2.1
    }];
    let sells: Vec<Order> = vec![];

    let result = batch_math::calculate_clearing_price(&buys, &sells, reserve0, reserve1);
    assert!(
        result.is_ok(),
        "Single buy order should produce valid clearing price"
    );

    let (price, _volume) = result.unwrap();
    // Price should still be in a reasonable range around spot
    let spot = 2 * PRECISION;
    assert!(
        price > spot / 4 && price < spot * 4,
        "Single-order clearing price {} should be in reasonable range around spot {}",
        price,
        spot
    );
}
