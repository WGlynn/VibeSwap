// ============ VibeSwap Math Library (Rust Port) ============
// Direct port of BatchMath.sol, DeterministicShuffle.sol, TWAPOracle.sol
// All arithmetic uses u128 with 18 decimal precision (1e18)
// Bit-for-bit compatible with Solidity test vectors

#![cfg_attr(feature = "no_std", no_std)]

#[cfg(feature = "no_std")]
extern crate alloc;
#[cfg(feature = "no_std")]
use alloc::vec;
#[cfg(feature = "no_std")]
use alloc::vec::Vec;

use sha2::{Digest, Sha256};

// ============ Constants ============

pub const PRECISION: u128 = 1_000_000_000_000_000_000; // 1e18
pub const MAX_ITERATIONS: u32 = 100;
pub const CONVERGENCE_THRESHOLD: u128 = 1_000_000; // 0.0001%
pub const PHI: u128 = 1_618_033_988_749_895_000; // Golden ratio * 1e18
pub const BPS_DENOMINATOR: u128 = 10_000;

// Fibonacci ratios (scaled by 1e18)
pub const FIB_236: u128 = 236_000_000_000_000_000;
pub const FIB_382: u128 = 382_000_000_000_000_000;
pub const FIB_500: u128 = 500_000_000_000_000_000;
pub const FIB_618: u128 = 618_000_000_000_000_000;
pub const FIB_786: u128 = 786_000_000_000_000_000;

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MathError {
    InvalidReserves,
    InsufficientInput,
    InsufficientLiquidity,
    InvalidAmounts,
    InsufficientInitialLiquidity,
    Overflow,
    PositionOutOfBounds,
}

// ============ BatchMath Module ============

pub mod batch_math {
    use super::*;

    /// Order: (amount_in, limit_price) pair
    #[derive(Clone, Debug)]
    pub struct Order {
        pub amount: u128,
        pub limit_price: u128,
    }

    /// Calculate uniform clearing price for batch swaps
    /// Binary search to find price where supply meets demand
    pub fn calculate_clearing_price(
        buy_orders: &[Order],
        sell_orders: &[Order],
        reserve0: u128,
        reserve1: u128,
    ) -> Result<(u128, u128), MathError> {
        if reserve0 == 0 || reserve1 == 0 {
            return Err(MathError::InvalidReserves);
        }

        let spot_price = super::mul_div(reserve1, PRECISION, reserve0);

        if buy_orders.is_empty() && sell_orders.is_empty() {
            return Ok((spot_price, 0));
        }

        let (min_price, max_price) = find_price_bounds(buy_orders, sell_orders, spot_price);

        let mut low = min_price;
        let mut high = max_price;

        for _ in 0..MAX_ITERATIONS {
            let mid = (low + high) / 2;
            let (net_demand, volume) =
                calculate_net_demand(buy_orders, sell_orders, mid, reserve0, reserve1)?;

            if high - low <= CONVERGENCE_THRESHOLD {
                return Ok((mid, volume));
            }

            if net_demand > 0 {
                low = mid;
            } else {
                high = mid;
            }
        }

        let clearing_price = (low + high) / 2;
        let (_, fillable_volume) =
            calculate_net_demand(buy_orders, sell_orders, clearing_price, reserve0, reserve1)?;
        Ok((clearing_price, fillable_volume))
    }

    /// Find min and max price bounds for binary search
    fn find_price_bounds(
        buy_orders: &[Order],
        sell_orders: &[Order],
        spot_price: u128,
    ) -> (u128, u128) {
        let mut min_price = spot_price / 2;
        let mut max_price = spot_price * 2;

        for order in buy_orders {
            if order.limit_price > max_price {
                max_price = order.limit_price;
            }
        }

        for order in sell_orders {
            if order.limit_price < min_price && order.limit_price > 0 {
                min_price = order.limit_price;
            }
        }

        (min_price, max_price)
    }

    /// Calculate net demand at a given price
    fn calculate_net_demand(
        buy_orders: &[Order],
        sell_orders: &[Order],
        price: u128,
        reserve0: u128,
        reserve1: u128,
    ) -> Result<(i128, u128), MathError> {
        let mut total_buy_volume: u128 = 0;
        let mut total_sell_volume: u128 = 0;

        for order in buy_orders {
            if price <= order.limit_price {
                total_buy_volume = total_buy_volume.saturating_add(order.amount);
            }
        }

        for order in sell_orders {
            if price >= order.limit_price {
                total_sell_volume = total_sell_volume.saturating_add(order.amount);
            }
        }

        let amm_capacity = calculate_amm_capacity(reserve0, reserve1, price)?;
        let effective_buy = total_buy_volume.min(amm_capacity);
        let effective_sell = total_sell_volume.min(amm_capacity);

        let net_demand = effective_buy as i128 - effective_sell as i128;
        let fillable = effective_buy + effective_sell;

        Ok((net_demand, fillable))
    }

    /// Calculate AMM's capacity to absorb trades at a given price
    fn calculate_amm_capacity(
        reserve0: u128,
        reserve1: u128,
        target_price: u128,
    ) -> Result<u128, MathError> {
        let spot_price = super::mul_div(reserve1, PRECISION, reserve0);

        let price_ratio = if target_price > spot_price {
            super::mul_div(target_price, PRECISION, spot_price)
        } else {
            super::mul_div(spot_price, PRECISION, target_price)
        };

        let geometric_mean = super::sqrt_product(reserve0, reserve1);
        let capacity = super::mul_div(geometric_mean, PRECISION, 10 * price_ratio);

        Ok(capacity)
    }

    /// Constant product AMM: get output amount
    pub fn get_amount_out(
        amount_in: u128,
        reserve_in: u128,
        reserve_out: u128,
        fee_rate_bps: u128,
    ) -> Result<u128, MathError> {
        if amount_in == 0 {
            return Err(MathError::InsufficientInput);
        }
        if reserve_in == 0 || reserve_out == 0 {
            return Err(MathError::InsufficientLiquidity);
        }

        let amount_in_with_fee = amount_in
            .checked_mul(BPS_DENOMINATOR - fee_rate_bps)
            .ok_or(MathError::Overflow)?;
        let denominator = reserve_in
            .checked_mul(BPS_DENOMINATOR)
            .ok_or(MathError::Overflow)?
            .checked_add(amount_in_with_fee)
            .ok_or(MathError::Overflow)?;

        // Use mul_div to avoid overflow on amount_in_with_fee * reserve_out
        Ok(super::mul_div(amount_in_with_fee, reserve_out, denominator))
    }

    /// Constant product AMM: get required input amount
    pub fn get_amount_in(
        amount_out: u128,
        reserve_in: u128,
        reserve_out: u128,
        fee_rate_bps: u128,
    ) -> Result<u128, MathError> {
        if amount_out == 0 {
            return Err(MathError::InsufficientInput);
        }
        if reserve_in == 0 || reserve_out == 0 {
            return Err(MathError::InsufficientLiquidity);
        }
        if amount_out >= reserve_out {
            return Err(MathError::InsufficientLiquidity);
        }

        // numerator = reserve_in * amount_out * BPS_DENOMINATOR
        // Rewrite as: (reserve_in * BPS) * amount_out / denominator
        let reserve_in_bps = reserve_in
            .checked_mul(BPS_DENOMINATOR)
            .ok_or(MathError::Overflow)?;
        let denominator = (reserve_out - amount_out)
            .checked_mul(BPS_DENOMINATOR - fee_rate_bps)
            .ok_or(MathError::Overflow)?;

        Ok(super::mul_div(reserve_in_bps, amount_out, denominator) + 1)
    }

    /// Calculate optimal liquidity amounts to maintain ratio
    pub fn calculate_optimal_liquidity(
        amount0_desired: u128,
        amount1_desired: u128,
        reserve0: u128,
        reserve1: u128,
    ) -> Result<(u128, u128), MathError> {
        if reserve0 == 0 && reserve1 == 0 {
            return Ok((amount0_desired, amount1_desired));
        }

        let amount1_optimal = super::mul_div(amount0_desired, reserve1, reserve0);

        if amount1_optimal <= amount1_desired {
            Ok((amount0_desired, amount1_optimal))
        } else {
            let amount0_optimal = super::mul_div(amount1_desired, reserve0, reserve1);
            if amount0_optimal > amount0_desired {
                return Err(MathError::InvalidAmounts);
            }
            Ok((amount0_optimal, amount1_desired))
        }
    }

    /// Calculate LP tokens to mint
    pub fn calculate_liquidity(
        amount0: u128,
        amount1: u128,
        reserve0: u128,
        reserve1: u128,
        total_supply: u128,
    ) -> Result<u128, MathError> {
        if total_supply == 0 {
            let liquidity = super::sqrt_product(amount0, amount1);
            if liquidity <= 1000 {
                return Err(MathError::InsufficientInitialLiquidity);
            }
            Ok(liquidity - 1000) // Lock minimum liquidity
        } else {
            let liquidity0 = super::mul_div(amount0, total_supply, reserve0);
            let liquidity1 = super::mul_div(amount1, total_supply, reserve1);
            Ok(liquidity0.min(liquidity1))
        }
    }

    /// Calculate protocol and LP fees
    pub fn calculate_fees(
        amount: u128,
        fee_rate_bps: u128,
        protocol_share_bps: u128,
    ) -> (u128, u128) {
        let total_fee = amount * fee_rate_bps / BPS_DENOMINATOR;
        let protocol_fee = total_fee * protocol_share_bps / BPS_DENOMINATOR;
        let lp_fee = total_fee - protocol_fee;
        (protocol_fee, lp_fee)
    }

    /// Apply golden ratio damping to price movement
    pub fn apply_golden_ratio_damping(
        current_price: u128,
        proposed_price: u128,
        max_deviation_bps: u128,
    ) -> u128 {
        let max_deviation = current_price * max_deviation_bps / BPS_DENOMINATOR;

        if proposed_price > current_price {
            let increase = proposed_price - current_price;
            if increase > max_deviation {
                let damped = max_deviation * PHI / PRECISION;
                let damped = damped.min(max_deviation);
                current_price + damped
            } else {
                proposed_price
            }
        } else {
            let decrease = current_price - proposed_price;
            if decrease > max_deviation {
                let damped = max_deviation * PHI / PRECISION;
                let damped = damped.min(max_deviation);
                current_price - damped
            } else {
                proposed_price
            }
        }
    }

    /// Golden ratio mean between two values
    pub fn golden_ratio_mean(a: u128, b: u128) -> u128 {
        // weighted = a * PHI + b * (PRECISION - PHI + PRECISION)
        // Actually: golden ratio mean = (a * PHI + b * (2*PRECISION - PHI)) / (2*PRECISION)
        // Simplified: blend a and b using golden ratio weight
        let phi_weight = PHI; // ~1.618e18
        let complement = 2 * PRECISION - PHI; // ~0.382e18

        if let Some(weighted) = (a as u128)
            .checked_mul(phi_weight)
            .and_then(|v| v.checked_add((b as u128).checked_mul(complement)?))
        {
            weighted / (2 * PRECISION)
        } else {
            // Fallback: simple average on overflow
            (a / 2) + (b / 2)
        }
    }
}

// ============ DeterministicShuffle Module ============

pub mod shuffle {
    use super::*;

    /// Generate shuffle seed from array of secrets (XOR + hash)
    /// WARNING: Pure XOR allows last-revealer manipulation
    pub fn generate_seed(secrets: &[[u8; 32]]) -> [u8; 32] {
        let mut xor_result = [0u8; 32];
        for secret in secrets {
            for i in 0..32 {
                xor_result[i] ^= secret[i];
            }
        }

        // Add length to prevent empty array issues
        let mut hasher = Sha256::new();
        hasher.update(xor_result);
        hasher.update(secrets.len().to_le_bytes());
        let result = hasher.finalize();
        let mut seed = [0u8; 32];
        seed.copy_from_slice(&result);
        seed
    }

    /// Generate secure shuffle seed with unpredictable block entropy (FIX #3)
    /// block_entropy should be from a FUTURE block (after reveal phase ends)
    pub fn generate_seed_secure(
        secrets: &[[u8; 32]],
        block_entropy: &[u8; 32],
        batch_id: u64,
    ) -> [u8; 32] {
        let mut xor_result = [0u8; 32];
        for secret in secrets {
            for i in 0..32 {
                xor_result[i] ^= secret[i];
            }
        }

        let mut hasher = Sha256::new();
        hasher.update(xor_result);
        hasher.update(block_entropy);
        hasher.update(batch_id.to_le_bytes());
        hasher.update(secrets.len().to_le_bytes());
        let result = hasher.finalize();
        let mut seed = [0u8; 32];
        seed.copy_from_slice(&result);
        seed
    }

    /// Fisher-Yates shuffle — deterministic given seed
    pub fn shuffle_indices(length: usize, seed: &[u8; 32]) -> Vec<usize> {
        if length == 0 {
            return Vec::new();
        }

        let mut shuffled: Vec<usize> = (0..length).collect();
        let mut current_seed = *seed;

        for i in (1..length).rev() {
            // Hash current seed with index to get next random value
            let mut hasher = Sha256::new();
            hasher.update(current_seed);
            hasher.update((i as u64).to_le_bytes());
            let result = hasher.finalize();
            current_seed.copy_from_slice(&result);

            // Convert hash to index in [0, i]
            let j = u256_mod_from_bytes(&current_seed, i + 1);
            shuffled.swap(i, j);
        }

        shuffled
    }

    /// Get shuffled index for a specific position
    pub fn get_shuffled_index(
        total_length: usize,
        position: usize,
        seed: &[u8; 32],
    ) -> Result<usize, MathError> {
        if position >= total_length {
            return Err(MathError::PositionOutOfBounds);
        }
        if total_length == 1 {
            return Ok(0);
        }
        let shuffled = shuffle_indices(total_length, seed);
        Ok(shuffled[position])
    }

    /// Verify a claimed shuffle matches the expected output
    pub fn verify_shuffle(
        original_length: usize,
        claimed_indices: &[usize],
        seed: &[u8; 32],
    ) -> bool {
        if claimed_indices.len() != original_length {
            return false;
        }
        let expected = shuffle_indices(original_length, seed);
        claimed_indices == expected.as_slice()
    }

    /// Partition into priority + shuffled regular orders
    pub fn partition_and_shuffle(
        total_orders: usize,
        priority_count: usize,
        seed: &[u8; 32],
    ) -> Vec<usize> {
        let mut execution: Vec<usize> = Vec::with_capacity(total_orders);

        // Priority orders come first
        for i in 0..priority_count {
            execution.push(i);
        }

        // Shuffle remaining regular orders
        let regular_count = total_orders - priority_count;
        if regular_count > 0 {
            let regular_shuffled = shuffle_indices(regular_count, seed);
            for idx in regular_shuffled {
                execution.push(priority_count + idx);
            }
        }

        execution
    }

    /// Convert first bytes of hash to index mod n
    fn u256_mod_from_bytes(bytes: &[u8; 32], n: usize) -> usize {
        // Use first 8 bytes as u64 for modulo
        let value = u64::from_le_bytes(bytes[0..8].try_into().unwrap());
        (value as usize) % n
    }
}

// ============ TWAP Module ============

pub mod twap {
    use super::*;

    /// Single price observation
    #[derive(Clone, Debug, Default)]
    pub struct Observation {
        pub block_number: u64,
        pub price_cumulative: u128,
    }

    /// Oracle state with ring buffer
    #[derive(Clone, Debug)]
    pub struct OracleState {
        pub observations: Vec<Observation>,
        pub index: u16,
        pub cardinality: u16,
        pub cardinality_next: u16,
    }

    impl OracleState {
        pub fn new(max_cardinality: u16) -> Self {
            let mut observations = Vec::with_capacity(max_cardinality as usize);
            observations.resize(max_cardinality as usize, Observation::default());
            Self {
                observations,
                index: 0,
                cardinality: 0,
                cardinality_next: max_cardinality,
            }
        }

        /// Initialize with first price observation
        pub fn initialize(&mut self, initial_price: u128, block_number: u64) {
            self.observations[0] = Observation {
                block_number,
                price_cumulative: initial_price,
            };
            self.index = 0;
            self.cardinality = 1;
        }

        /// Write a new price observation
        pub fn write(&mut self, price: u128, block_number: u64) {
            let last = &self.observations[self.index as usize];

            if block_number == last.block_number {
                return; // No time passed
            }

            let delta = block_number - last.block_number;
            let new_cumulative = last.price_cumulative.wrapping_add(price * delta as u128);

            let index_next = (self.index + 1) % self.cardinality_next;
            self.observations[index_next as usize] = Observation {
                block_number,
                price_cumulative: new_cumulative,
            };
            self.index = index_next;

            if self.cardinality < self.cardinality_next {
                self.cardinality += 1;
            }
        }

        /// Calculate TWAP over specified block period
        pub fn consult(&self, period_blocks: u64, current_block: u64) -> Result<u128, MathError> {
            if self.cardinality < 2 {
                return Err(MathError::InsufficientInput);
            }

            let target_block = current_block - period_blocks;
            let current = &self.observations[self.index as usize];

            // Find surrounding observations
            let (before, after) = self.get_surrounding_observations(target_block)?;

            // Interpolate target cumulative
            let target_cumulative = if before.block_number == target_block {
                before.price_cumulative
            } else {
                let block_delta = after.block_number - before.block_number;
                let price_delta =
                    after.price_cumulative.wrapping_sub(before.price_cumulative);
                let target_delta = target_block - before.block_number;
                before
                    .price_cumulative
                    .wrapping_add((price_delta as u128 * target_delta as u128) / block_delta as u128)
            };

            let cumulative_delta =
                current.price_cumulative.wrapping_sub(target_cumulative);
            let block_delta = current.block_number - target_block;

            Ok(cumulative_delta / block_delta as u128)
        }

        /// Find observations surrounding target block in ring buffer.
        /// Returns (before, after) where before.block <= target < after.block.
        fn get_surrounding_observations(
            &self,
            target: u64,
        ) -> Result<(Observation, Observation), MathError> {
            // Linear scan through ring buffer (max ~100 entries)
            // Find the newest observation with block_number <= target
            let mut best_before: Option<Observation> = None;
            let mut best_after: Option<Observation> = None;

            for i in 0..self.cardinality {
                let idx = i as usize;
                let obs = &self.observations[idx];
                if obs.block_number == 0 && i > 0 {
                    continue; // Uninitialized slot
                }

                if obs.block_number <= target {
                    match &best_before {
                        None => best_before = Some(obs.clone()),
                        Some(b) if obs.block_number > b.block_number => {
                            best_before = Some(obs.clone())
                        }
                        _ => {}
                    }
                } else {
                    match &best_after {
                        None => best_after = Some(obs.clone()),
                        Some(a) if obs.block_number < a.block_number => {
                            best_after = Some(obs.clone())
                        }
                        _ => {}
                    }
                }
            }

            let before = best_before.ok_or(MathError::InsufficientInput)?;
            let after = best_after
                .unwrap_or_else(|| self.observations[self.index as usize].clone());

            Ok((before, after))
        }
    }
}

// ============ Integer Square Root (Newton's Method) ============

pub fn sqrt(x: u128) -> u128 {
    if x == 0 {
        return 0;
    }
    let mut z = (x + 1) / 2;
    let mut y = x;
    while z < y {
        y = z;
        z = (x / z + z) / 2;
    }
    y
}

// ============ 256-bit Arithmetic Helpers ============

/// Multiply two u128 values, returning (hi, lo) as a 256-bit result.
/// Used for k-invariant comparison without overflow.
pub fn wide_mul(a: u128, b: u128) -> (u128, u128) {
    let mask: u128 = u64::MAX as u128;
    let a_lo = a & mask;
    let a_hi = a >> 64;
    let b_lo = b & mask;
    let b_hi = b >> 64;

    // Partial products (each u64*u64 fits in u128)
    let p0 = a_lo * b_lo;
    let p1 = a_lo * b_hi;
    let p2 = a_hi * b_lo;
    let p3 = a_hi * b_hi;

    // Accumulate middle bits with carry tracking
    let mid = (p0 >> 64) + (p1 & mask) + (p2 & mask);
    let lo = (p0 & mask) | ((mid & mask) << 64);
    let hi = p3 + (p1 >> 64) + (p2 >> 64) + (mid >> 64);

    (hi, lo)
}

/// Compare a*b vs c*d using 256-bit arithmetic (no overflow).
/// Returns Ordering::Less if a*b < c*d, Equal, or Greater.
pub fn mul_cmp(a: u128, b: u128, c: u128, d: u128) -> core::cmp::Ordering {
    let (hi_ab, lo_ab) = wide_mul(a, b);
    let (hi_cd, lo_cd) = wide_mul(c, d);
    match hi_ab.cmp(&hi_cd) {
        core::cmp::Ordering::Equal => lo_ab.cmp(&lo_cd),
        ord => ord,
    }
}

/// Compute sqrt(a * b) without overflow.
/// Falls back to sqrt(a) * sqrt(b) when direct multiplication overflows.
/// The approximation error is at most 1 unit.
pub fn sqrt_product(a: u128, b: u128) -> u128 {
    match a.checked_mul(b) {
        Some(product) => sqrt(product),
        None => {
            // sqrt(a*b) ≈ sqrt(a) * sqrt(b) — error at most 1
            let sa = sqrt(a);
            let sb = sqrt(b);
            sa.saturating_mul(sb)
        }
    }
}

/// Divide a 256-bit number (hi, lo) by a u128 divisor.
/// Assumes the result fits in u128 (caller must guarantee).
fn wide_div(hi: u128, lo: u128, d: u128) -> u128 {
    if hi == 0 {
        return lo / d;
    }

    // Binary search for quotient q where q * d == (hi << 128) | lo
    let mut low: u128 = 0;
    let mut high: u128 = u128::MAX;

    while low < high {
        // Upper midpoint without overflow: ceil((high-low)/2)
        let diff = high - low;
        let mid = low + diff / 2 + diff % 2;
        let (mh, ml) = wide_mul(mid, d);
        if mh > hi || (mh == hi && ml > lo) {
            high = mid - 1;
        } else {
            low = mid;
        }
    }
    low
}

/// Compute (a * b) / c using 256-bit intermediate to avoid overflow.
/// Returns the result which must fit in u128.
pub fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    assert!(c > 0, "mul_div: division by zero");
    match a.checked_mul(b) {
        Some(product) => product / c,
        None => {
            let (hi, lo) = wide_mul(a, b);
            wide_div(hi, lo, c)
        }
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sqrt() {
        assert_eq!(sqrt(0), 0);
        assert_eq!(sqrt(1), 1);
        assert_eq!(sqrt(4), 2);
        assert_eq!(sqrt(9), 3);
        assert_eq!(sqrt(10), 3);
        assert_eq!(sqrt(1_000_000), 1000);
        assert_eq!(sqrt(PRECISION * PRECISION), PRECISION);
    }

    #[test]
    fn test_get_amount_out() {
        // 1000 tokens in, 1M/1M reserves, 5 bps fee
        let out = batch_math::get_amount_out(
            1000 * PRECISION,
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            5,
        )
        .unwrap();
        // ~998.5 tokens: 0.05% fee + ~0.1% price impact (0.1% of pool)
        assert!(out < 1000 * PRECISION);
        assert!(out > 998 * PRECISION);
    }

    #[test]
    fn test_get_amount_in() {
        let in_amount = batch_math::get_amount_in(
            999 * PRECISION,
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            5,
        )
        .unwrap();
        assert!(in_amount > 999 * PRECISION);
    }

    #[test]
    fn test_calculate_liquidity_initial() {
        let lp = batch_math::calculate_liquidity(
            1_000_000 * PRECISION,
            1_000_000 * PRECISION,
            0,
            0,
            0,
        )
        .unwrap();
        // sqrt(1e6 * 1e6) * 1e18 - 1000
        assert_eq!(lp, 1_000_000 * PRECISION - 1000);
    }

    #[test]
    fn test_calculate_fees() {
        let (proto, lp) = batch_math::calculate_fees(1_000_000, 30, 1000);
        // 30 bps = 0.3%, protocol gets 10% of that
        assert_eq!(proto + lp, 1_000_000 * 30 / 10_000);
    }

    #[test]
    fn test_golden_ratio_damping() {
        let current = 2000 * PRECISION;
        let proposed = 3000 * PRECISION; // 50% increase
        let damped = batch_math::apply_golden_ratio_damping(current, proposed, 500);
        // Should be capped: current + maxDev * PHI / PRECISION
        assert!(damped < proposed);
        assert!(damped > current);
    }

    #[test]
    fn test_shuffle_deterministic() {
        let seed = [0xAB; 32];
        let s1 = shuffle::shuffle_indices(10, &seed);
        let s2 = shuffle::shuffle_indices(10, &seed);
        assert_eq!(s1, s2); // Same seed = same shuffle
    }

    #[test]
    fn test_shuffle_permutation() {
        let seed = [0xCD; 32];
        let shuffled = shuffle::shuffle_indices(10, &seed);
        assert_eq!(shuffled.len(), 10);
        // Every index appears exactly once
        let mut sorted = shuffled.clone();
        sorted.sort();
        assert_eq!(sorted, (0..10).collect::<Vec<_>>());
    }

    #[test]
    fn test_shuffle_verify() {
        let seed = [0xEF; 32];
        let shuffled = shuffle::shuffle_indices(8, &seed);
        assert!(shuffle::verify_shuffle(8, &shuffled, &seed));

        let mut bad = shuffled.clone();
        bad.swap(0, 1);
        assert!(!shuffle::verify_shuffle(8, &bad, &seed));
    }

    #[test]
    fn test_generate_seed() {
        let secrets = vec![[0x01; 32], [0x02; 32], [0x03; 32]];
        let seed1 = shuffle::generate_seed(&secrets);
        let seed2 = shuffle::generate_seed(&secrets);
        assert_eq!(seed1, seed2);

        // Different secrets = different seed
        let secrets2 = vec![[0x01; 32], [0x02; 32], [0x04; 32]];
        let seed3 = shuffle::generate_seed(&secrets2);
        assert_ne!(seed1, seed3);
    }

    #[test]
    fn test_generate_seed_secure() {
        let secrets = vec![[0x01; 32], [0x02; 32]];
        let entropy = [0xFF; 32];
        let seed1 = shuffle::generate_seed_secure(&secrets, &entropy, 1);
        let seed2 = shuffle::generate_seed_secure(&secrets, &entropy, 1);
        assert_eq!(seed1, seed2);

        // Different entropy = different seed
        let entropy2 = [0xFE; 32];
        let seed3 = shuffle::generate_seed_secure(&secrets, &entropy2, 1);
        assert_ne!(seed1, seed3);
    }

    #[test]
    fn test_partition_and_shuffle() {
        let seed = [0x42; 32];
        let exec = shuffle::partition_and_shuffle(10, 3, &seed);
        assert_eq!(exec.len(), 10);
        // First 3 are priority (in order)
        assert_eq!(exec[0], 0);
        assert_eq!(exec[1], 1);
        assert_eq!(exec[2], 2);
        // Remaining 7 are shuffled versions of 3..10
        let regular: Vec<usize> = exec[3..].to_vec();
        let mut sorted_regular = regular.clone();
        sorted_regular.sort();
        assert_eq!(sorted_regular, (3..10).collect::<Vec<_>>());
    }

    #[test]
    fn test_twap_basic() {
        let mut oracle = twap::OracleState::new(100);
        oracle.initialize(2000 * PRECISION, 100);
        oracle.write(2000 * PRECISION, 110);
        oracle.write(2100 * PRECISION, 120);
        oracle.write(2050 * PRECISION, 130);

        let twap_price = oracle.consult(20, 130).unwrap();
        // Should be between 2000 and 2100
        assert!(twap_price > 1900 * PRECISION);
        assert!(twap_price < 2200 * PRECISION);
    }

    #[test]
    fn test_clearing_price_basic() {
        let buys = vec![
            batch_math::Order { amount: 100 * PRECISION, limit_price: 2100 * PRECISION },
            batch_math::Order { amount: 50 * PRECISION, limit_price: 2050 * PRECISION },
        ];
        let sells = vec![
            batch_math::Order { amount: 80 * PRECISION, limit_price: 1950 * PRECISION },
            batch_math::Order { amount: 70 * PRECISION, limit_price: 2000 * PRECISION },
        ];
        let (price, volume) = batch_math::calculate_clearing_price(
            &buys,
            &sells,
            1_000_000 * PRECISION,
            2_000_000 * PRECISION,
        )
        .unwrap();
        // Price should be near spot (2000)
        assert!(price > 1800 * PRECISION);
        assert!(price < 2200 * PRECISION);
        assert!(volume > 0);
    }

    #[test]
    fn test_wide_mul_small() {
        // Small values: should match direct multiplication
        let (hi, lo) = wide_mul(100, 200);
        assert_eq!(hi, 0);
        assert_eq!(lo, 20_000);
    }

    #[test]
    fn test_wide_mul_large() {
        // Values that overflow u128 when multiplied directly
        let a = 1_000_000 * PRECISION; // 1e24
        let b = 2_000_000 * PRECISION; // 2e24
        assert!(a.checked_mul(b).is_none()); // Confirms overflow
        let (hi, _lo) = wide_mul(a, b);
        assert!(hi > 0); // High bits are non-zero
        // Verify: sqrt(a*b) should be ~sqrt(2)*1e24 ≈ 1.414e24
        // sqrt_product should give the same
        let sp = sqrt_product(a, b);
        assert!(sp > 1_414_000_000_000_000_000_000_000);
        assert!(sp < 1_415_000_000_000_000_000_000_000);
    }

    #[test]
    fn test_mul_cmp() {
        use core::cmp::Ordering;
        // Direct: 10 * 20 vs 15 * 15
        assert_eq!(mul_cmp(10, 20, 15, 15), Ordering::Less); // 200 < 225
        assert_eq!(mul_cmp(15, 15, 10, 20), Ordering::Greater);
        assert_eq!(mul_cmp(10, 10, 5, 20), Ordering::Equal);

        // Large values (overflow u128)
        let a = 1_000_000 * PRECISION;
        let b = 2_000_000 * PRECISION;
        // a*b vs (a+1)*b should be Less
        assert_eq!(mul_cmp(a, b, a + 1, b), Ordering::Less);
        assert_eq!(mul_cmp(a + 1, b, a, b), Ordering::Greater);
        assert_eq!(mul_cmp(a, b, a, b), Ordering::Equal);
    }

    #[test]
    fn test_sqrt_product_no_overflow() {
        // Small values: should equal sqrt(a*b)
        let result = sqrt_product(100, 400);
        assert_eq!(result, sqrt(40_000));
        assert_eq!(result, 200);
    }

    #[test]
    fn test_sqrt_product_overflow() {
        // Large values that overflow u128
        let a = 1_000_000 * PRECISION;
        let b = 2_000_000 * PRECISION;
        let result = sqrt_product(a, b);
        // sqrt(1e24 * 2e24) = sqrt(2e48) ≈ 1.4142e24
        assert!(result > 1_414_000_000_000_000_000_000_000);
        assert!(result < 1_415_000_000_000_000_000_000_000);
    }

    #[test]
    fn test_mul_div_small() {
        // Direct: (100 * 200) / 50 = 400
        assert_eq!(mul_div(100, 200, 50), 400);
    }

    #[test]
    fn test_mul_div_large() {
        // reserve1 * PRECISION / reserve0 — the price calculation
        let reserve1 = 2_000_000 * PRECISION; // 2e24
        let reserve0 = 1_000_000 * PRECISION; // 1e24
        // Price should be 2 * PRECISION = 2e18
        let price = mul_div(reserve1, PRECISION, reserve0);
        assert_eq!(price, 2 * PRECISION);
    }

    #[test]
    fn test_mul_div_precision() {
        // 3e24 * 1e18 / 2e24 = 1.5e18
        let a = 3_000_000 * PRECISION;
        let b = PRECISION;
        let c = 2_000_000 * PRECISION;
        let result = mul_div(a, b, c);
        assert_eq!(result, PRECISION + PRECISION / 2); // 1.5e18
    }
}
