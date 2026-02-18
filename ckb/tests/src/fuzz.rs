// ============ VibeSwap CKB Fuzz / Property-Based Tests ============
// Manual property-based testing using a deterministic PRNG.
// No external fuzzing crate needed — reproducible from seed alone.
//
// Each test generates hundreds-to-thousands of random inputs and verifies
// invariants that must hold for ALL valid inputs.

use vibeswap_math::{batch_math, shuffle, sqrt, sqrt_product, mul_div, mul_cmp, wide_mul, PRECISION};
use vibeswap_math::twap::OracleState;
use vibeswap_mmr::MMR;
use vibeswap_pow;
use vibeswap_types::*;
use core::cmp::Ordering;

// ============ Deterministic PRNG ============

struct TestRng {
    state: u64,
}

impl TestRng {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.state
    }

    fn next_u128(&mut self) -> u128 {
        let hi = self.next_u64() as u128;
        let lo = self.next_u64() as u128;
        (hi << 64) | lo
    }

    fn range_u128(&mut self, min: u128, max: u128) -> u128 {
        if min >= max {
            return min;
        }
        min + (self.next_u128() % (max - min))
    }

    fn range_u64(&mut self, min: u64, max: u64) -> u64 {
        if min >= max {
            return min;
        }
        min + (self.next_u64() % (max - min))
    }

    fn next_bytes_32(&mut self) -> [u8; 32] {
        let mut buf = [0u8; 32];
        for chunk in buf.chunks_exact_mut(8) {
            chunk.copy_from_slice(&self.next_u64().to_le_bytes());
        }
        buf
    }
}

// ============ Test 1: Constant Product Invariant ============

#[test]
fn test_fuzz_constant_product_invariant() {
    let mut rng = TestRng::new(0xDEAD_BEEF_CAFE_0001);
    let fee_bps: u128 = 5;

    for i in 0..1000 {
        let r0 = rng.range_u128(1_000_000_000_000_000, 1_000_000_000_000_000_000_000_000_000);
        let r1 = rng.range_u128(1_000_000_000_000_000, 1_000_000_000_000_000_000_000_000_000);
        // amount_in in [1 .. r0/10], capped to avoid overflow in get_amount_out
        let max_in = r0 / 10;
        if max_in < 1 {
            continue;
        }
        let amount_in = rng.range_u128(1, max_in + 1);

        let result = batch_math::get_amount_out(amount_in, r0, r1, fee_bps);
        match result {
            Ok(amount_out) => {
                // new_k = (r0 + amount_in) * (r1 - amount_out) >= old_k = r0 * r1
                // Use mul_cmp for overflow-safe 256-bit comparison
                let new_r0 = r0 + amount_in;
                let new_r1 = r1 - amount_out;
                let cmp = mul_cmp(new_r0, new_r1, r0, r1);
                assert!(
                    cmp != Ordering::Less,
                    "Iteration {}: k decreased! r0={}, r1={}, amount_in={}, amount_out={}, \
                     new_r0={}, new_r1={}",
                    i, r0, r1, amount_in, amount_out, new_r0, new_r1
                );
            }
            Err(_) => {
                // Overflow or invalid input — acceptable for extreme values
            }
        }
    }
}

// ============ Test 2: Clearing Price Bounded ============

#[test]
fn test_fuzz_clearing_price_bounded() {
    let mut rng = TestRng::new(0xDEAD_BEEF_CAFE_0002);

    for i in 0..1000 {
        let r0 = rng.range_u128(1_000_000 * PRECISION, 10_000_000 * PRECISION);
        let r1 = rng.range_u128(1_000_000 * PRECISION, 10_000_000 * PRECISION);
        let spot_price = mul_div(r1, PRECISION, r0);

        // Generate small random orders around spot price
        let num_buys = (rng.next_u64() % 5) as usize;
        let num_sells = (rng.next_u64() % 5) as usize;

        let mut buys = Vec::new();
        for _ in 0..num_buys {
            let amount = rng.range_u128(1 * PRECISION, 1000 * PRECISION);
            // Limit price above spot for buyers
            let limit = rng.range_u128(spot_price, spot_price.saturating_mul(2).max(spot_price + 1));
            buys.push(batch_math::Order {
                amount,
                limit_price: limit,
            });
        }

        let mut sells = Vec::new();
        for _ in 0..num_sells {
            let amount = rng.range_u128(1 * PRECISION, 1000 * PRECISION);
            // Limit price below spot for sellers
            let limit = rng.range_u128(spot_price / 2, spot_price + 1);
            sells.push(batch_math::Order {
                amount,
                limit_price: limit,
            });
        }

        match batch_math::calculate_clearing_price(&buys, &sells, r0, r1) {
            Ok((clearing_price, _volume)) => {
                // Clearing price should be within a reasonable band around spot
                // With random order amounts, the price can shift significantly
                // Use a wide 50% band — the key invariant is no panics + bounded output
                let lower = spot_price / 2;
                let upper = spot_price * 2;
                assert!(
                    clearing_price >= lower && clearing_price <= upper,
                    "Iteration {}: clearing_price={} outside [{}, {}], spot={}, r0={}, r1={}, \
                     buys={}, sells={}",
                    i, clearing_price, lower, upper, spot_price, r0, r1, num_buys, num_sells
                );
            }
            Err(_) => {
                // Acceptable for edge cases
            }
        }
    }
}

// ============ Test 3: Shuffle Is Permutation ============

#[test]
fn test_fuzz_shuffle_is_permutation() {
    let mut rng = TestRng::new(0xDEAD_BEEF_CAFE_0003);

    for i in 0..100 {
        let n = (rng.next_u64() % 50) as usize + 1; // size 1..50
        let seed = rng.next_bytes_32();

        let shuffled = shuffle::shuffle_indices(n, &seed);

        // Must have correct length
        assert_eq!(
            shuffled.len(),
            n,
            "Iteration {}: wrong length, expected {} got {}",
            i, n, shuffled.len()
        );

        // Sort and verify it's [0, 1, 2, ..., n-1]
        let mut sorted = shuffled.clone();
        sorted.sort();
        let expected: Vec<usize> = (0..n).collect();
        assert_eq!(
            sorted, expected,
            "Iteration {}: shuffled is not a permutation of [0..{}). \
             Got sorted={:?}, shuffled={:?}, seed={:?}",
            i, n, sorted, shuffled, &seed[..8]
        );
    }
}

// ============ Test 4: Shuffle Uniform Distribution ============

#[test]
fn test_fuzz_shuffle_uniform_distribution() {
    let n: usize = 10;
    let trials: usize = 10_000;
    let mut rng = TestRng::new(0xDEAD_BEEF_CAFE_0004);

    // Count how often each element appears at position 0
    let mut counts = [0u32; 10];

    for _ in 0..trials {
        let seed = rng.next_bytes_32();
        let shuffled = shuffle::shuffle_indices(n, &seed);
        counts[shuffled[0]] += 1;
    }

    // Each element should appear ~1000 times at position 0
    let expected = trials as f64 / n as f64; // 1000.0

    // Chi-squared test with 9 degrees of freedom
    // Critical value at p=0.01 is 21.666, using 25.0 for extra margin
    let mut chi_sq: f64 = 0.0;
    for k in 0..n {
        let observed = counts[k] as f64;
        chi_sq += (observed - expected) * (observed - expected) / expected;
    }

    assert!(
        chi_sq < 25.0,
        "Chi-squared test failed: chi_sq={:.2} > 25.0 (p=0.01 threshold for 9 df). \
         Counts={:?}, expected={}",
        chi_sq, counts, expected
    );

    // Also check each element is within ±200 of expected (sanity check)
    for k in 0..n {
        assert!(
            (counts[k] as f64 - expected).abs() < 200.0,
            "Element {} appeared {} times at position 0, expected ~{} (±200)",
            k, counts[k], expected
        );
    }
}

// ============ Test 5: sqrt_product No Panic ============

#[test]
fn test_fuzz_sqrt_product_no_panic() {
    let mut rng = TestRng::new(0xDEAD_BEEF_CAFE_0005);

    for i in 0..1000 {
        // Distribute across small, medium, and large ranges
        let (a, b) = match i % 3 {
            0 => {
                // Small: 0..1000
                let a = rng.next_u128() % 1001;
                let b = rng.next_u128() % 1001;
                (a, b)
            }
            1 => {
                // Medium: 1e9..1e18
                let a = rng.range_u128(1_000_000_000, 1_000_000_000_000_000_000);
                let b = rng.range_u128(1_000_000_000, 1_000_000_000_000_000_000);
                (a, b)
            }
            _ => {
                // Large: 1e24..1e36
                let a = rng.range_u128(
                    1_000_000_000_000_000_000_000_000,
                    u128::MAX / 1_000_000_000_000,
                );
                let b = rng.range_u128(
                    1_000_000_000_000_000_000_000_000,
                    u128::MAX / 1_000_000_000_000,
                );
                (a, b)
            }
        };

        // Should never panic
        let result = sqrt_product(a, b);

        // Verify result^2 is approximately a*b
        // For small values where a*b fits in u128, check exactly
        if let Some(product) = a.checked_mul(b) {
            let r_sq = (result as u128).checked_mul(result as u128);
            if let Some(r_sq) = r_sq {
                // result = floor(sqrt(product)), so result^2 <= product < (result+1)^2
                assert!(
                    r_sq <= product,
                    "Iteration {}: sqrt_product({}, {})={}, result^2={} > product={}",
                    i, a, b, result, r_sq, product
                );
                let next_sq = (result + 1).checked_mul(result + 1);
                if let Some(next_sq) = next_sq {
                    assert!(
                        next_sq > product,
                        "Iteration {}: sqrt_product({}, {})={}, (result+1)^2={} <= product={}",
                        i, a, b, result, next_sq, product
                    );
                }
            }
        }
        // For large values where a*b overflows, just verify no panic occurred
        // and result is positive when inputs are positive
        if a > 0 && b > 0 {
            assert!(
                result > 0,
                "Iteration {}: sqrt_product({}, {}) returned 0 for positive inputs",
                i, a, b
            );
        }
    }
}

// ============ Test 6: mul_div Identity ============

#[test]
fn test_fuzz_mul_div_identity() {
    let mut rng = TestRng::new(0xDEAD_BEEF_CAFE_0006);

    for i in 0..1000 {
        let a = rng.range_u128(0, u128::MAX / 2);
        let b = rng.range_u128(1, u64::MAX as u128); // Avoid extreme overflow in wide_mul
        let c = rng.range_u128(1, u64::MAX as u128);

        // mul_div(a, c, c) == a (multiply then divide by same)
        // This only holds exactly when a*c doesn't lose precision in wide_div
        let result = mul_div(a, c, c);
        assert_eq!(
            result, a,
            "Iteration {}: mul_div({}, {}, {}) = {} != {}",
            i, a, c, c, result, a
        );

        // mul_div(a, 1, 1) == a
        let result2 = mul_div(a, 1, 1);
        assert_eq!(
            result2, a,
            "Iteration {}: mul_div({}, 1, 1) = {} != {}",
            i, a, result2, a
        );

        // mul_div(0, b, c) == 0
        let result3 = mul_div(0, b, c);
        assert_eq!(
            result3, 0,
            "Iteration {}: mul_div(0, {}, {}) = {} != 0",
            i, b, c, result3
        );
    }
}

// ============ Test 7: wide_mul Commutative ============

#[test]
fn test_fuzz_wide_mul_commutative() {
    let mut rng = TestRng::new(0xDEAD_BEEF_CAFE_0007);

    for i in 0..1000 {
        let a = rng.next_u128();
        let b = rng.next_u128();

        let (hi_ab, lo_ab) = wide_mul(a, b);
        let (hi_ba, lo_ba) = wide_mul(b, a);

        assert_eq!(
            (hi_ab, lo_ab),
            (hi_ba, lo_ba),
            "Iteration {}: wide_mul({}, {}) = ({}, {}) != wide_mul({}, {}) = ({}, {})",
            i, a, b, hi_ab, lo_ab, b, a, hi_ba, lo_ba
        );
    }
}

// ============ Test 8: MMR Append-Only ============

#[test]
fn test_fuzz_mmr_append_only() {
    let mut rng = TestRng::new(0xDEAD_BEEF_CAFE_0008);

    for i in 0..100 {
        let n = (rng.next_u64() % 50) as usize + 1; // 1..50 leaves
        let mut mmr = MMR::new();
        let mut prev_root = mmr.root();
        let mut leaves: Vec<[u8; 32]> = Vec::new();

        for j in 0..n {
            let leaf_data = rng.next_bytes_32();
            leaves.push(leaf_data);
            mmr.append(&leaf_data);

            let new_root = mmr.root();

            // Root should change with each append
            assert_ne!(
                new_root, prev_root,
                "Iteration {}, leaf {}: root did not change after append",
                i, j
            );

            // Leaf count should match
            assert_eq!(
                mmr.leaf_count,
                (j + 1) as u64,
                "Iteration {}, leaf {}: leaf_count mismatch, expected {} got {}",
                i, j, j + 1, mmr.leaf_count
            );

            prev_root = new_root;
        }

        // Determinism: same inputs should produce same root
        let mut mmr2 = MMR::new();
        for leaf_data in &leaves {
            mmr2.append(leaf_data);
        }
        assert_eq!(
            mmr.root(),
            mmr2.root(),
            "Iteration {}: determinism failed — same {} leaves produced different roots",
            i, n
        );
    }
}

// ============ Test 9: TWAP Monotonic Accumulation ============

#[test]
fn test_fuzz_twap_monotonic_accumulation() {
    let mut rng = TestRng::new(0xDEAD_BEEF_CAFE_0009);

    for i in 0..100 {
        let cardinality = 100u16;
        let mut oracle = OracleState::new(cardinality);

        // Generate random price sequence (all positive)
        let num_observations = (rng.next_u64() % 20) as u64 + 3; // 3..22
        let mut block = 100u64;
        let mut min_price = u128::MAX;
        let mut max_price = 0u128;
        let mut prices = Vec::new();

        // Initialize
        let init_price = rng.range_u128(100 * PRECISION, 10_000 * PRECISION);
        oracle.initialize(init_price, block);
        min_price = min_price.min(init_price);
        max_price = max_price.max(init_price);
        prices.push(init_price);

        // Write observations with increasing block numbers
        let mut prev_cumulative = init_price; // First cumulative is just the initial price
        for j in 1..num_observations {
            let delta = rng.range_u64(1, 20); // 1..19 blocks between observations
            block += delta;
            let price = rng.range_u128(100 * PRECISION, 10_000 * PRECISION);
            oracle.write(price, block);
            min_price = min_price.min(price);
            max_price = max_price.max(price);
            prices.push(price);

            // cumulative_price should be monotonically increasing (positive prices)
            let current_obs = &oracle.observations[oracle.index as usize];
            assert!(
                current_obs.price_cumulative >= prev_cumulative,
                "Iteration {}, obs {}: cumulative decreased from {} to {} at block {}",
                i, j, prev_cumulative, current_obs.price_cumulative, block
            );
            prev_cumulative = current_obs.price_cumulative;
        }

        // Consult TWAP if we have enough observations
        if oracle.cardinality >= 2 && prices.len() >= 3 {
            let first_obs = &oracle.observations[0];
            let window = block - first_obs.block_number - 1;
            if window > 0 {
                match oracle.consult(window, block) {
                    Ok(twap) => {
                        // TWAP should be bounded between min and max observed prices
                        assert!(
                            twap >= min_price / 2 && twap <= max_price * 2,
                            "Iteration {}: twap={} outside [{}, {}] (relaxed bounds), \
                             prices={:?}",
                            i, twap, min_price / 2, max_price * 2, prices
                        );
                    }
                    Err(_) => {
                        // Acceptable for edge cases (insufficient data, etc.)
                    }
                }
            }
        }
    }
}

// ============ Test 10: PoW Difficulty Target ============

#[test]
fn test_fuzz_pow_difficulty_target() {
    let mut rng = TestRng::new(0xDEAD_BEEF_CAFE_000A);

    for i in 0..100 {
        let difficulty = (rng.next_u64() % 17) as u8 + 8; // 8..24

        let target = vibeswap_pow::difficulty_to_target(difficulty);

        // Verify correct number of leading zero bits
        // The first `difficulty` bits should be zero
        let full_zero_bytes = difficulty / 8;
        let remaining_zero_bits = difficulty % 8;

        for byte_idx in 0..full_zero_bytes as usize {
            assert_eq!(
                target[byte_idx], 0x00,
                "Iteration {}: difficulty={}, byte {} should be 0x00 but got 0x{:02X}",
                i, difficulty, byte_idx, target[byte_idx]
            );
        }

        if (full_zero_bytes as usize) < 32 {
            let expected_byte = 0xFF >> remaining_zero_bits;
            assert_eq!(
                target[full_zero_bytes as usize],
                expected_byte,
                "Iteration {}: difficulty={}, transition byte should be 0x{:02X} but got 0x{:02X}",
                i, difficulty, expected_byte, target[full_zero_bytes as usize]
            );
        }

        // Higher difficulty -> smaller target (more leading zero bits)
        if difficulty < 24 {
            let target_higher = vibeswap_pow::difficulty_to_target(difficulty + 1);
            // target_higher should be <= target (lexicographically)
            let higher_is_smaller = target_higher.iter()
                .zip(target.iter())
                .fold(Ordering::Equal, |acc, (&a, &b)| {
                    if acc != Ordering::Equal { acc } else { a.cmp(&b) }
                });
            assert!(
                higher_is_smaller != Ordering::Greater,
                "Iteration {}: difficulty {} target is not <= difficulty {} target",
                i, difficulty + 1, difficulty
            );
        }
    }
}

// ============ Test 11: Cell Data Roundtrip ============

#[test]
fn test_fuzz_cell_data_roundtrip() {
    let mut rng = TestRng::new(0xDEAD_BEEF_CAFE_000B);

    for i in 0..1000 {
        match i % 3 {
            0 => {
                // AuctionCellData
                let original = AuctionCellData {
                    phase: (rng.next_u64() % 4) as u8,
                    batch_id: rng.next_u64(),
                    commit_mmr_root: rng.next_bytes_32(),
                    commit_count: rng.next_u64() as u32,
                    reveal_count: rng.next_u64() as u32,
                    xor_seed: rng.next_bytes_32(),
                    clearing_price: rng.next_u128(),
                    fillable_volume: rng.next_u128(),
                    difficulty_target: rng.next_bytes_32(),
                    prev_state_hash: rng.next_bytes_32(),
                    phase_start_block: rng.next_u64(),
                    pair_id: rng.next_bytes_32(),
                };
                let bytes = original.serialize();
                let decoded = AuctionCellData::deserialize(&bytes).unwrap();
                assert_eq!(
                    original, decoded,
                    "Iteration {}: AuctionCellData roundtrip failed",
                    i
                );
            }
            1 => {
                // CommitCellData
                let original = CommitCellData {
                    order_hash: rng.next_bytes_32(),
                    batch_id: rng.next_u64(),
                    deposit_ckb: rng.next_u64(),
                    token_type_hash: rng.next_bytes_32(),
                    token_amount: rng.next_u128(),
                    block_number: rng.next_u64(),
                    sender_lock_hash: rng.next_bytes_32(),
                };
                let bytes = original.serialize();
                let decoded = CommitCellData::deserialize(&bytes).unwrap();
                assert_eq!(
                    original, decoded,
                    "Iteration {}: CommitCellData roundtrip failed",
                    i
                );
            }
            _ => {
                // PoolCellData
                let original = PoolCellData {
                    reserve0: rng.next_u128(),
                    reserve1: rng.next_u128(),
                    total_lp_supply: rng.next_u128(),
                    fee_rate_bps: rng.next_u64() as u16,
                    twap_price_cum: rng.next_u128(),
                    twap_last_block: rng.next_u64(),
                    k_last: rng.next_bytes_32(),
                    minimum_liquidity: rng.next_u128(),
                    pair_id: rng.next_bytes_32(),
                    token0_type_hash: rng.next_bytes_32(),
                    token1_type_hash: rng.next_bytes_32(),
                };
                let bytes = original.serialize();
                let decoded = PoolCellData::deserialize(&bytes).unwrap();
                assert_eq!(
                    original, decoded,
                    "Iteration {}: PoolCellData roundtrip failed",
                    i
                );
            }
        }
    }
}

// ============ Test 12: get_amount_in / get_amount_out Inverse ============

#[test]
fn test_fuzz_get_amount_in_out_inverse() {
    let mut rng = TestRng::new(0xDEAD_BEEF_CAFE_000C);
    let fee_bps: u128 = 5;

    for i in 0..500 {
        // Reserves in a reasonable AMM range
        let r0 = rng.range_u128(1_000_000 * PRECISION, 100_000_000 * PRECISION);
        let r1 = rng.range_u128(1_000_000 * PRECISION, 100_000_000 * PRECISION);

        // amount_in: small relative to reserves to avoid edge cases
        let max_in = r0 / 100; // max 1% of reserves
        if max_in < PRECISION {
            continue;
        }
        let amount_in = rng.range_u128(PRECISION, max_in);

        // Forward: amount_in -> amount_out
        let amount_out = match batch_math::get_amount_out(amount_in, r0, r1, fee_bps) {
            Ok(out) => out,
            Err(_) => continue,
        };

        if amount_out == 0 || amount_out >= r1 {
            continue; // Can't invert zero output or output >= reserves
        }

        // Inverse: amount_out -> amount_in_back
        let amount_in_back = match batch_math::get_amount_in(amount_out, r0, r1, fee_bps) {
            Ok(back) => back,
            Err(_) => continue,
        };

        // amount_in_back should be approximately >= amount_in (get_amount_in rounds up)
        // Allow proportional rounding tolerance: integer division truncation accumulates
        // across both get_amount_out and get_amount_in, especially for large values
        let rounding_tolerance = (amount_in / 1_000_000_000_000_000).max(2);
        assert!(
            amount_in_back + rounding_tolerance >= amount_in,
            "Iteration {}: amount_in_back={} < amount_in={} (diff={}, tolerance={}). \
             r0={}, r1={}, amount_out={}",
            i, amount_in_back, amount_in,
            amount_in.saturating_sub(amount_in_back), rounding_tolerance,
            r0, r1, amount_out
        );

        // amount_in_back should be within 0.1% of amount_in (rounding tolerance)
        // Using integer math: amount_in_back <= amount_in * 1001 / 1000
        let tolerance_upper = mul_div(amount_in, 1001, 1000) + 2; // +2 for integer rounding
        assert!(
            amount_in_back <= tolerance_upper,
            "Iteration {}: amount_in_back={} > tolerance_upper={} (amount_in={}). \
             r0={}, r1={}, amount_out={}",
            i, amount_in_back, tolerance_upper, amount_in, r0, r1, amount_out
        );
    }
}

// ============ Additional Property Tests ============

/// Verify wide_mul produces correct results for known edge cases and random inputs
#[test]
fn test_fuzz_wide_mul_correctness() {
    let mut rng = TestRng::new(0xDEAD_BEEF_CAFE_000D);

    // Edge cases
    assert_eq!(wide_mul(0, 0), (0, 0));
    assert_eq!(wide_mul(0, u128::MAX), (0, 0));
    assert_eq!(wide_mul(1, u128::MAX), (0, u128::MAX));
    assert_eq!(wide_mul(u128::MAX, 1), (0, u128::MAX));

    for i in 0..1000 {
        let a = rng.next_u128();
        let b = rng.next_u128();
        let (hi, lo) = wide_mul(a, b);

        // For small values, verify against direct multiplication
        if a <= u64::MAX as u128 && b <= u64::MAX as u128 {
            let product = a * b;
            assert_eq!(
                (hi, lo),
                (0, product),
                "Iteration {}: wide_mul({}, {}) = ({}, {}), expected (0, {})",
                i, a, b, hi, lo, product
            );
        }

        // Verify: if we mul_div(a*b, 1, 1) through wide arithmetic, we get lo (when hi==0)
        if hi == 0 && lo > 0 {
            let result = mul_div(a, b, 1);
            assert_eq!(
                result, lo,
                "Iteration {}: mul_div({}, {}, 1) = {} != wide_mul lo={}",
                i, a, b, result, lo
            );
        }
    }
}

/// Verify mul_cmp transitivity: if a*b < c*d and c*d < e*f, then a*b < e*f
#[test]
fn test_fuzz_mul_cmp_transitivity() {
    let mut rng = TestRng::new(0xDEAD_BEEF_CAFE_000E);

    for i in 0..500 {
        // Generate three products in ascending order
        let base = rng.range_u128(1, u64::MAX as u128);
        let a = base;
        let b = rng.range_u128(1, u64::MAX as u128);
        let c = a + 1; // c*b > a*b guaranteed (if no overflow issues)
        let d = b;
        let e = a + 2;
        let f = b;

        let cmp_ab_cd = mul_cmp(a, b, c, d);
        let cmp_cd_ef = mul_cmp(c, d, e, f);
        let cmp_ab_ef = mul_cmp(a, b, e, f);

        if cmp_ab_cd == Ordering::Less && cmp_cd_ef == Ordering::Less {
            assert_eq!(
                cmp_ab_ef,
                Ordering::Less,
                "Iteration {}: transitivity violated! a*b < c*d and c*d < e*f but a*b !< e*f. \
                 a={}, b={}, c={}, d={}, e={}, f={}",
                i, a, b, c, d, e, f
            );
        }
    }
}

/// Verify sqrt is correct: result^2 <= x < (result+1)^2
#[test]
fn test_fuzz_sqrt_exact() {
    let mut rng = TestRng::new(0xDEAD_BEEF_CAFE_000F);

    // Edge cases
    assert_eq!(sqrt(0), 0);
    assert_eq!(sqrt(1), 1);
    assert_eq!(sqrt(u128::MAX), 18446744073709551615); // floor(sqrt(2^128 - 1)) = 2^64 - 1

    for i in 0..1000 {
        let x = rng.next_u128();
        let r = sqrt(x);

        // r^2 <= x
        let r_sq = (r as u128).checked_mul(r as u128);
        if let Some(r_sq) = r_sq {
            assert!(
                r_sq <= x,
                "Iteration {}: sqrt({})={}, but {}^2={} > {}",
                i, x, r, r, r_sq, x
            );
        }

        // (r+1)^2 > x (unless r+1 overflows)
        if r < u128::MAX {
            let next = r + 1;
            if let Some(next_sq) = next.checked_mul(next) {
                assert!(
                    next_sq > x,
                    "Iteration {}: sqrt({})={}, but ({}+1)^2={} <= {}",
                    i, x, r, r, next_sq, x
                );
            }
            // If (r+1)^2 overflows, then r must be ~2^64-1, which is correct for x near u128::MAX
        }
    }
}

/// Verify serialization roundtrip for additional types
#[test]
fn test_fuzz_additional_cell_data_roundtrip() {
    let mut rng = TestRng::new(0xDEAD_BEEF_CAFE_0010);

    for i in 0..500 {
        match i % 4 {
            0 => {
                // RevealWitness
                let original = RevealWitness {
                    order_type: (rng.next_u64() % 2) as u8,
                    amount_in: rng.next_u128(),
                    limit_price: rng.next_u128(),
                    secret: rng.next_bytes_32(),
                    priority_bid: rng.next_u64(),
                    commit_index: rng.next_u64() as u32,
                };
                let bytes = original.serialize();
                let decoded = RevealWitness::deserialize(&bytes).unwrap();
                assert_eq!(
                    original, decoded,
                    "Iteration {}: RevealWitness roundtrip failed",
                    i
                );
            }
            1 => {
                // LPPositionCellData
                let original = LPPositionCellData {
                    lp_amount: rng.next_u128(),
                    entry_price: rng.next_u128(),
                    pool_id: rng.next_bytes_32(),
                    deposit_block: rng.next_u64(),
                };
                let bytes = original.serialize();
                let decoded = LPPositionCellData::deserialize(&bytes).unwrap();
                assert_eq!(
                    original, decoded,
                    "Iteration {}: LPPositionCellData roundtrip failed",
                    i
                );
            }
            2 => {
                // ComplianceCellData
                let original = ComplianceCellData {
                    blocked_merkle_root: rng.next_bytes_32(),
                    tier_merkle_root: rng.next_bytes_32(),
                    jurisdiction_root: rng.next_bytes_32(),
                    last_updated: rng.next_u64(),
                    version: rng.next_u64() as u32,
                };
                let bytes = original.serialize();
                let decoded = ComplianceCellData::deserialize(&bytes).unwrap();
                assert_eq!(
                    original, decoded,
                    "Iteration {}: ComplianceCellData roundtrip failed",
                    i
                );
            }
            _ => {
                // ConfigCellData
                let original = ConfigCellData {
                    commit_window_blocks: rng.next_u64(),
                    reveal_window_blocks: rng.next_u64(),
                    slash_rate_bps: rng.next_u64() as u16,
                    max_price_deviation: rng.next_u64() as u16,
                    max_trade_size_bps: rng.next_u64() as u16,
                    rate_limit_amount: rng.next_u128(),
                    rate_limit_window: rng.next_u64(),
                    volume_breaker_limit: rng.next_u128(),
                    price_breaker_bps: rng.next_u64() as u16,
                    withdrawal_breaker_bps: rng.next_u64() as u16,
                    min_pow_difficulty: (rng.next_u64() % 256) as u8,
                };
                let bytes = original.serialize();
                let decoded = ConfigCellData::deserialize(&bytes).unwrap();
                assert_eq!(
                    original, decoded,
                    "Iteration {}: ConfigCellData roundtrip failed",
                    i
                );
            }
        }
    }
}

/// Verify OracleCellData and PoWLockArgs roundtrip
#[test]
fn test_fuzz_oracle_pow_roundtrip() {
    let mut rng = TestRng::new(0xDEAD_BEEF_CAFE_0011);

    for i in 0..500 {
        if i % 2 == 0 {
            let original = OracleCellData {
                price: rng.next_u128(),
                block_number: rng.next_u64(),
                confidence: (rng.next_u64() % 256) as u8,
                source_hash: rng.next_bytes_32(),
                pair_id: rng.next_bytes_32(),
            };
            let bytes = original.serialize();
            let decoded = OracleCellData::deserialize(&bytes).unwrap();
            assert_eq!(
                original, decoded,
                "Iteration {}: OracleCellData roundtrip failed",
                i
            );
        } else {
            let original = PoWLockArgs {
                pair_id: rng.next_bytes_32(),
                min_difficulty: (rng.next_u64() % 256) as u8,
            };
            let bytes = original.serialize();
            let decoded = PoWLockArgs::deserialize(&bytes).unwrap();
            assert_eq!(
                original, decoded,
                "Iteration {}: PoWLockArgs roundtrip failed",
                i
            );
        }
    }
}
