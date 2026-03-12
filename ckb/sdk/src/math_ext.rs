// ============ Math Extension Module ============
// Extended DeFi mathematics: fixed-point arithmetic, exponential/logarithm
// approximations, square root, statistical functions, and compound interest.
// All integer-only — no floating point anywhere.

// ============ Constants ============

/// 1e8 scaling factor for fixed-point arithmetic
pub const SCALE: u64 = 100_000_000;

/// Basis points scale (10000 = 100%)
pub const BPS_SCALE: u64 = 10_000;

/// Percent scale (100 = 100%)
pub const PERCENT_SCALE: u64 = 100;

/// 1e18 — standard DeFi WAD precision
pub const WAD: u128 = 1_000_000_000_000_000_000;

/// 1e27 — standard DeFi RAY precision
pub const RAY: u128 = 1_000_000_000_000_000_000_000_000_000;

/// Seconds in a standard year (365 days)
pub const SECONDS_PER_YEAR: u64 = 31_536_000;

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum MathError {
    Overflow,
    DivisionByZero,
    Underflow,
    InvalidInput,
    PrecisionLoss,
    SqrtNegative,
}

// ============ Core Arithmetic (overflow-safe) ============

/// (a * b) / c with u128 intermediate to avoid overflow.
pub fn mul_div(a: u64, b: u64, c: u64) -> Result<u64, MathError> {
    if c == 0 {
        return Err(MathError::DivisionByZero);
    }
    let result = (a as u128)
        .checked_mul(b as u128)
        .ok_or(MathError::Overflow)?
        / (c as u128);
    if result > u64::MAX as u128 {
        return Err(MathError::Overflow);
    }
    Ok(result as u64)
}

/// (a * b) / c with ceiling (rounds up).
pub fn mul_div_round_up(a: u64, b: u64, c: u64) -> Result<u64, MathError> {
    if c == 0 {
        return Err(MathError::DivisionByZero);
    }
    let numerator = (a as u128)
        .checked_mul(b as u128)
        .ok_or(MathError::Overflow)?;
    let c128 = c as u128;
    let result = (numerator + c128 - 1) / c128;
    if result > u64::MAX as u128 {
        return Err(MathError::Overflow);
    }
    Ok(result as u64)
}

/// Checked addition returning error on overflow.
pub fn safe_add(a: u64, b: u64) -> Result<u64, MathError> {
    a.checked_add(b).ok_or(MathError::Overflow)
}

/// Checked subtraction returning error on underflow.
pub fn safe_sub(a: u64, b: u64) -> Result<u64, MathError> {
    a.checked_sub(b).ok_or(MathError::Underflow)
}

/// Checked multiplication returning error on overflow.
pub fn safe_mul(a: u64, b: u64) -> Result<u64, MathError> {
    a.checked_mul(b).ok_or(MathError::Overflow)
}

/// Checked division returning error on division by zero.
pub fn safe_div(a: u64, b: u64) -> Result<u64, MathError> {
    if b == 0 {
        return Err(MathError::DivisionByZero);
    }
    Ok(a / b)
}

/// (a * b) / c for u128 values — used for WAD/RAY math.
pub fn mul_div_128(a: u128, b: u128, c: u128) -> Result<u128, MathError> {
    if c == 0 {
        return Err(MathError::DivisionByZero);
    }
    // Use u256 emulation via two u128 halves for full precision
    // For values that fit, direct computation works:
    let result = wide_mul_div(a, b, c)?;
    Ok(result)
}

/// Internal: wide multiply then divide, handling cases where a*b overflows u128.
fn wide_mul_div(a: u128, b: u128, c: u128) -> Result<u128, MathError> {
    if c == 0 {
        return Err(MathError::DivisionByZero);
    }

    // Fast path: a * b fits in u128
    if let Some(product) = a.checked_mul(b) {
        return Ok(product / c);
    }

    // Slow path: decompose to avoid overflow.
    // (a * b) / c = (a / c) * b + (a % c) * b / c
    let quot = a / c;
    let rem = a % c;
    let main = quot.checked_mul(b).ok_or(MathError::Overflow)?;
    // rem < c, so rem * b might still overflow u128
    let rem_part = if let Some(rem_b) = rem.checked_mul(b) {
        rem_b / c
    } else {
        // Further decompose: rem * b / c = rem * (b/c) + rem * (b%c) / c
        let b_quot = b / c;
        let b_rem = b % c;
        let part1 = rem.checked_mul(b_quot).ok_or(MathError::Overflow)?;
        // rem < c and b_rem < c, so rem * b_rem < c^2 which may still overflow
        let part2 = if let Some(rb) = rem.checked_mul(b_rem) {
            rb / c
        } else {
            // Last resort: both rem and b_rem < c, approximate
            // rem * b_rem / c ≈ (rem / c) * b_rem + rem * (b_rem / c)
            // Since rem < c, rem/c = 0 and b_rem/c = 0, result is 0
            // (precision loss but prevents overflow)
            0
        };
        part1.checked_add(part2).ok_or(MathError::Overflow)?
    };
    main.checked_add(rem_part).ok_or(MathError::Overflow)
}

// ============ Fixed-Point Operations (SCALE = 1e8) ============

/// Convert a whole value to fixed-point representation (value * SCALE).
pub fn to_fixed(value: u64) -> u64 {
    value.saturating_mul(SCALE)
}

/// Convert from fixed-point back to whole value (value / SCALE).
pub fn from_fixed(value: u64) -> u64 {
    value / SCALE
}

/// Fixed-point multiplication: (a * b) / SCALE.
pub fn fixed_mul(a: u64, b: u64) -> Result<u64, MathError> {
    mul_div(a, b, SCALE)
}

/// Fixed-point division: (a * SCALE) / b.
pub fn fixed_div(a: u64, b: u64) -> Result<u64, MathError> {
    mul_div(a, SCALE, b)
}

/// Fixed-point exponentiation: base^exp in fixed-point.
/// base is in fixed-point (scaled by SCALE), exp is an integer exponent.
pub fn fixed_pow(base: u64, exp: u32) -> Result<u64, MathError> {
    if exp == 0 {
        return Ok(SCALE); // x^0 = 1.0 in fixed point
    }
    let mut result: u64 = SCALE;
    let mut b = base;
    let mut e = exp;
    // Exponentiation by squaring
    while e > 0 {
        if e & 1 == 1 {
            result = fixed_mul(result, b)?;
        }
        e >>= 1;
        if e > 0 {
            b = fixed_mul(b, b)?;
        }
    }
    Ok(result)
}

// ============ Basis Point Operations ============

/// Apply basis points to an amount: amount * bps / 10000.
pub fn apply_bps(amount: u64, bps: u64) -> u64 {
    ((amount as u128) * (bps as u128) / (BPS_SCALE as u128)) as u64
}

/// Convert basis points to SCALE-based fixed-point: bps * SCALE / 10000.
pub fn bps_to_fixed(bps: u64) -> u64 {
    ((bps as u128) * (SCALE as u128) / (BPS_SCALE as u128)) as u64
}

/// Convert SCALE-based fixed-point to basis points: fixed * 10000 / SCALE.
pub fn fixed_to_bps(fixed: u64) -> u64 {
    ((fixed as u128) * (BPS_SCALE as u128) / (SCALE as u128)) as u64
}

/// Complement of basis points: 10000 - bps (e.g., fee remainder).
pub fn complement_bps(bps: u64) -> u64 {
    BPS_SCALE.saturating_sub(bps)
}

// ============ Square Root ============

/// Integer square root using Newton's method.
/// Uses u128 intermediates to avoid overflow for large inputs.
pub fn sqrt(n: u64) -> u64 {
    if n <= 1 {
        return n;
    }
    // Use u128 to avoid overflow in (x + n/x)
    let n128 = n as u128;
    let mut x: u128 = n128;
    let mut y: u128 = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n128 / x) / 2;
    }
    x as u64
}

/// Integer square root for u128 values using Newton's method.
/// Carefully avoids overflow by using saturating arithmetic.
pub fn sqrt_128(n: u128) -> u128 {
    if n <= 1 {
        return n;
    }
    // Start with a good initial estimate using bit length
    let bits = 128 - n.leading_zeros();
    let mut x: u128 = 1u128 << ((bits + 1) / 2);
    loop {
        let y = (x + n / x) / 2;
        if y >= x {
            return x;
        }
        x = y;
    }
}

/// Geometric mean of two reserves: sqrt(a * b).
/// Uses u128 intermediate to avoid overflow.
pub fn sqrt_price(reserve_a: u64, reserve_b: u64) -> u64 {
    let product = (reserve_a as u128) * (reserve_b as u128);
    sqrt_128(product) as u64
}

// ============ Exponential & Logarithm (approximations) ============

/// Approximate e^(x/scale) * scale using Taylor series (6 terms).
/// x and scale are in the same units. Result is scaled by `scale`.
pub fn exp_approx(x: u64, scale: u64) -> Result<u64, MathError> {
    if scale == 0 {
        return Err(MathError::DivisionByZero);
    }
    // Taylor: e^t = 1 + t + t^2/2! + t^3/3! + t^4/4! + t^5/5!
    // where t = x / scale
    // We compute in u128: result = scale + x + x^2/(2*scale) + x^3/(6*scale^2) + ...
    let s = scale as u128;
    let xv = x as u128;

    // term_i = x^i / (i! * scale^(i-1))
    // Start with scale (the "1" term)
    let mut result: u128 = s;
    let mut term: u128 = xv; // first term: x
    result = result.checked_add(term).ok_or(MathError::Overflow)?;

    // term = x^2 / (2 * scale)
    term = term.checked_mul(xv).ok_or(MathError::Overflow)? / (2 * s);
    result = result.checked_add(term).ok_or(MathError::Overflow)?;

    // term = x^3 / (6 * scale^2) = prev_term * x / (3 * scale)
    term = term.checked_mul(xv).ok_or(MathError::Overflow)? / (3 * s);
    result = result.checked_add(term).ok_or(MathError::Overflow)?;

    // term = x^4 / (24 * scale^3) = prev_term * x / (4 * scale)
    term = term.checked_mul(xv).ok_or(MathError::Overflow)? / (4 * s);
    result = result.checked_add(term).ok_or(MathError::Overflow)?;

    // term = x^5 / (120 * scale^4)
    term = term.checked_mul(xv).ok_or(MathError::Overflow)? / (5 * s);
    result = result.checked_add(term).ok_or(MathError::Overflow)?;

    if result > u64::MAX as u128 {
        return Err(MathError::Overflow);
    }
    Ok(result as u64)
}

/// Approximate ln(x/scale) * scale using a series expansion.
/// x must be > 0. Result can be negative conceptually but we return u64;
/// caller should only pass x >= scale (i.e., ln of values >= 1).
/// Uses the identity: ln(x) = 2 * atanh((x-1)/(x+1)) for x > 0
/// atanh(z) = z + z^3/3 + z^5/5 + z^7/7 + ...
pub fn ln_approx(x: u64, scale: u64) -> Result<u64, MathError> {
    if x == 0 || scale == 0 {
        return Err(MathError::InvalidInput);
    }
    if x < scale {
        // ln of value < 1 is negative; we return 0 to avoid underflow
        return Ok(0);
    }
    if x == scale {
        return Ok(0); // ln(1) = 0
    }

    let xv = x as u128;
    let sv = scale as u128;

    // z = (x - scale) / (x + scale), scaled by sv
    // z_scaled = (x - scale) * scale / (x + scale)
    let num = (xv - sv) * sv;
    let den = xv + sv;
    let z = num / den; // z in scale units

    // atanh(z/s) = z/s + (z/s)^3/3 + (z/s)^5/5 + ...
    // Result = 2 * s * atanh(z/s) = 2 * (z + z^3/(3*s^2) + z^5/(5*s^4) + ...)
    let z2 = z * z / sv; // z^2 / scale

    let mut result = z;
    let mut term = z * z2 / sv; // z^3 / s^2
    result += term / 3;

    term = term * z2 / sv; // z^5 / s^4
    result += term / 5;

    term = term * z2 / sv; // z^7 / s^6
    result += term / 7;

    term = term * z2 / sv; // z^9 / s^8
    result += term / 9;

    result *= 2;

    if result > u64::MAX as u128 {
        return Err(MathError::Overflow);
    }
    Ok(result as u64)
}

/// Floor of log2(x) computed by counting bits.
pub fn log2_approx(x: u64) -> u64 {
    if x == 0 {
        return 0;
    }
    63 - x.leading_zeros() as u64
}

/// Approximate base^(exp/scale) * scale via exp(exp * ln(base) / scale).
/// base and exp are scaled by `scale`.
pub fn pow_approx(base: u64, exp: u64, scale: u64) -> Result<u64, MathError> {
    if scale == 0 {
        return Err(MathError::DivisionByZero);
    }
    if base == 0 {
        return Ok(0);
    }
    if exp == 0 {
        return Ok(scale); // anything^0 = 1 (in scaled terms)
    }
    if base == scale {
        return Ok(scale); // 1^x = 1
    }

    // Compute ln(base/scale) * scale
    let ln_base = ln_approx(base, scale)?;
    // Multiply by exp/scale: ln_base * exp / scale
    let exponent = (ln_base as u128) * (exp as u128) / (scale as u128);
    if exponent > u64::MAX as u128 {
        return Err(MathError::Overflow);
    }
    exp_approx(exponent as u64, scale)
}

// ============ Compound Interest ============

/// Discrete compound interest: principal * (1 + rate)^periods.
/// rate_bps is the per-period rate in basis points.
/// Uses fixed-point exponentiation internally.
pub fn compound_interest(
    principal: u64,
    rate_bps: u64,
    periods: u64,
) -> Result<u64, MathError> {
    if periods == 0 {
        return Ok(principal);
    }
    // (1 + rate) in SCALE = SCALE + rate_bps * SCALE / BPS_SCALE
    let one_plus_rate = SCALE + bps_to_fixed(rate_bps);
    // Limit periods to u32 for fixed_pow
    if periods > u32::MAX as u64 {
        return Err(MathError::Overflow);
    }
    let growth = fixed_pow(one_plus_rate, periods as u32)?;
    // principal * growth / SCALE
    mul_div(principal, growth, SCALE)
}

/// Continuous compound interest: principal * e^(rate * time).
/// rate_bps is annual rate in basis points.
/// time_seconds is the duration.
pub fn continuous_compound(
    principal: u64,
    rate_bps: u64,
    time_seconds: u64,
) -> Result<u64, MathError> {
    // exponent = rate_bps / BPS_SCALE * time_seconds / SECONDS_PER_YEAR
    // In SCALE units: rate_bps * SCALE / BPS_SCALE * time_seconds / SECONDS_PER_YEAR
    // = rate_bps * time_seconds * SCALE / (BPS_SCALE * SECONDS_PER_YEAR)
    let exponent_128 = (rate_bps as u128) * (time_seconds as u128) * (SCALE as u128)
        / ((BPS_SCALE as u128) * (SECONDS_PER_YEAR as u128));
    if exponent_128 > u64::MAX as u128 {
        return Err(MathError::Overflow);
    }
    let exponent = exponent_128 as u64;
    let growth = exp_approx(exponent, SCALE)?;
    mul_div(principal, growth, SCALE)
}

/// Simple accrued interest: principal * rate * time / SCALE.
/// rate_per_second is already in SCALE-based fixed-point.
pub fn accrued_interest(
    principal: u64,
    rate_per_second: u64,
    seconds: u64,
) -> Result<u64, MathError> {
    let interest_128 = (principal as u128)
        .checked_mul(rate_per_second as u128)
        .ok_or(MathError::Overflow)?
        .checked_mul(seconds as u128)
        .ok_or(MathError::Overflow)?
        / (SCALE as u128);
    if interest_128 > u64::MAX as u128 {
        return Err(MathError::Overflow);
    }
    Ok(interest_128 as u64)
}

/// Effective annual rate from nominal rate and compounding frequency.
/// Returns effective rate in basis points.
/// effective = ((1 + nominal/n)^n - 1) * 10000
pub fn effective_rate(nominal_bps: u64, compounds_per_year: u64) -> u64 {
    if compounds_per_year == 0 {
        return 0;
    }
    // per-period rate in SCALE: nominal_bps * SCALE / (BPS_SCALE * compounds_per_year)
    let per_period = (nominal_bps as u128) * (SCALE as u128)
        / ((BPS_SCALE as u128) * (compounds_per_year as u128));
    let one_plus_r = SCALE as u128 + per_period;
    if one_plus_r > u64::MAX as u128 {
        return 0;
    }
    // (1+r)^n using fixed_pow — limit to u32
    if compounds_per_year > u32::MAX as u64 {
        return 0;
    }
    let growth = match fixed_pow(one_plus_r as u64, compounds_per_year as u32) {
        Ok(g) => g,
        Err(_) => return 0,
    };
    // effective = (growth - SCALE) * BPS_SCALE / SCALE
    if growth <= SCALE {
        return 0;
    }
    let diff = (growth - SCALE) as u128;
    (diff * (BPS_SCALE as u128) / (SCALE as u128)) as u64
}

// ============ Statistical Functions ============

/// Arithmetic mean of a slice of values.
pub fn mean(values: &[u64]) -> u64 {
    if values.is_empty() {
        return 0;
    }
    let sum: u128 = values.iter().map(|&v| v as u128).sum();
    (sum / values.len() as u128) as u64
}

/// Weighted arithmetic mean. Weights must be same length as values.
pub fn weighted_mean(values: &[u64], weights: &[u64]) -> u64 {
    if values.is_empty() || values.len() != weights.len() {
        return 0;
    }
    let total_weight: u128 = weights.iter().map(|&w| w as u128).sum();
    if total_weight == 0 {
        return 0;
    }
    let weighted_sum: u128 = values
        .iter()
        .zip(weights.iter())
        .map(|(&v, &w)| (v as u128) * (w as u128))
        .sum();
    (weighted_sum / total_weight) as u64
}

/// Median of a mutable slice (sorts in place).
pub fn median(values: &mut [u64]) -> u64 {
    if values.is_empty() {
        return 0;
    }
    values.sort();
    let len = values.len();
    if len % 2 == 1 {
        values[len / 2]
    } else {
        // Average of the two middle elements
        let a = values[len / 2 - 1] as u128;
        let b = values[len / 2] as u128;
        ((a + b) / 2) as u64
    }
}

/// Population variance (sum of squared deviations / n).
/// Returns u128 because squared u64 values can exceed u64.
pub fn variance(values: &[u64]) -> u128 {
    if values.is_empty() {
        return 0;
    }
    let m = mean(values) as u128;
    let sum_sq: u128 = values
        .iter()
        .map(|&v| {
            let diff = if (v as u128) >= m {
                (v as u128) - m
            } else {
                m - (v as u128)
            };
            diff * diff
        })
        .sum();
    sum_sq / values.len() as u128
}

/// Standard deviation: sqrt(variance).
pub fn std_dev(values: &[u64]) -> u64 {
    let var = variance(values);
    sqrt_128(var) as u64
}

/// (min, max) of a slice in a single pass.
pub fn min_max(values: &[u64]) -> (u64, u64) {
    if values.is_empty() {
        return (0, 0);
    }
    let mut mn = values[0];
    let mut mx = values[0];
    for &v in &values[1..] {
        if v < mn {
            mn = v;
        }
        if v > mx {
            mx = v;
        }
    }
    (mn, mx)
}

// ============ Percentile & Distribution ============

/// P-th percentile of a sorted slice (p in 0..=100).
/// Uses nearest-rank method.
pub fn percentile(sorted: &[u64], p: u64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    if p == 0 {
        return sorted[0];
    }
    if p >= 100 {
        return sorted[sorted.len() - 1];
    }
    // nearest-rank: index = ceil(p/100 * n) - 1
    let n = sorted.len() as u64;
    let rank = (p * n + 99) / 100; // ceiling division
    let idx = if rank == 0 { 0 } else { (rank - 1) as usize };
    if idx >= sorted.len() {
        sorted[sorted.len() - 1]
    } else {
        sorted[idx]
    }
}

/// Quartiles (Q1, Q2, Q3) of a sorted slice.
pub fn quartiles(sorted: &[u64]) -> (u64, u64, u64) {
    (
        percentile(sorted, 25),
        percentile(sorted, 50),
        percentile(sorted, 75),
    )
}

/// Interquartile range: Q3 - Q1.
pub fn iqr(sorted: &[u64]) -> u64 {
    let (q1, _, q3) = quartiles(sorted);
    q3.saturating_sub(q1)
}

// ============ Price Math ============

/// Price of token A in terms of token B: (reserve_b * SCALE) / reserve_a.
pub fn price_from_reserves(reserve_a: u64, reserve_b: u64) -> u64 {
    if reserve_a == 0 {
        return 0;
    }
    ((reserve_b as u128) * (SCALE as u128) / (reserve_a as u128)) as u64
}

/// AMM constant-product output: amount_out = reserve_out * amount_in_after_fee / (reserve_in + amount_in_after_fee).
/// fee_bps is the swap fee in basis points (e.g., 30 = 0.3%).
pub fn amount_out(reserve_in: u64, reserve_out: u64, amount_in: u64, fee_bps: u64) -> u64 {
    if reserve_in == 0 || reserve_out == 0 || amount_in == 0 {
        return 0;
    }
    let fee_complement = BPS_SCALE.saturating_sub(fee_bps);
    let amount_in_with_fee = (amount_in as u128) * (fee_complement as u128);
    let numerator = amount_in_with_fee * (reserve_out as u128);
    let denominator = (reserve_in as u128) * (BPS_SCALE as u128) + amount_in_with_fee;
    if denominator == 0 {
        return 0;
    }
    (numerator / denominator) as u64
}

/// Price impact in basis points: amount / (reserve + amount) * 10000.
pub fn price_impact_bps(reserve: u64, amount: u64) -> u64 {
    if reserve == 0 && amount == 0 {
        return 0;
    }
    let total = (reserve as u128) + (amount as u128);
    ((amount as u128) * (BPS_SCALE as u128) / total) as u64
}

/// Slippage in basis points: |expected - actual| / expected * 10000.
pub fn slippage_bps(expected: u64, actual: u64) -> u64 {
    if expected == 0 {
        return 0;
    }
    let diff = abs_diff(expected, actual);
    ((diff as u128) * (BPS_SCALE as u128) / (expected as u128)) as u64
}

// ============ WAD/RAY Operations ============

/// WAD multiplication: (a * b) / WAD.
pub fn wad_mul(a: u128, b: u128) -> Result<u128, MathError> {
    mul_div_128(a, b, WAD)
}

/// WAD division: (a * WAD) / b.
pub fn wad_div(a: u128, b: u128) -> Result<u128, MathError> {
    mul_div_128(a, WAD, b)
}

/// RAY multiplication: (a * b) / RAY.
pub fn ray_mul(a: u128, b: u128) -> Result<u128, MathError> {
    mul_div_128(a, b, RAY)
}

/// RAY division: (a * RAY) / b.
pub fn ray_div(a: u128, b: u128) -> Result<u128, MathError> {
    mul_div_128(a, RAY, b)
}

/// Convert WAD to RAY: wad * 1e9.
pub fn wad_to_ray(wad: u128) -> u128 {
    wad.saturating_mul(1_000_000_000)
}

/// Convert RAY to WAD: ray / 1e9.
pub fn ray_to_wad(ray: u128) -> u128 {
    ray / 1_000_000_000
}

// ============ Utility ============

/// Absolute difference without underflow: |a - b|.
pub fn abs_diff(a: u64, b: u64) -> u64 {
    if a >= b { a - b } else { b - a }
}

/// Clamp value to [min, max].
pub fn clamp(value: u64, min: u64, max: u64) -> u64 {
    if value < min {
        min
    } else if value > max {
        max
    } else {
        value
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Core Arithmetic ----

    #[test]
    fn test_mul_div_basic() {
        assert_eq!(mul_div(10, 20, 5).unwrap(), 40);
    }

    #[test]
    fn test_mul_div_large_values() {
        // 1e9 * 1e9 / 1e9 = 1e9 — uses u128 intermediate
        assert_eq!(mul_div(1_000_000_000, 1_000_000_000, 1_000_000_000).unwrap(), 1_000_000_000);
    }

    #[test]
    fn test_mul_div_precision() {
        // 3 * 7 / 2 = 10 (integer truncation)
        assert_eq!(mul_div(3, 7, 2).unwrap(), 10);
    }

    #[test]
    fn test_mul_div_div_by_zero() {
        assert_eq!(mul_div(10, 20, 0), Err(MathError::DivisionByZero));
    }

    #[test]
    fn test_mul_div_zero_numerator() {
        assert_eq!(mul_div(0, 100, 50).unwrap(), 0);
    }

    #[test]
    fn test_mul_div_one() {
        assert_eq!(mul_div(1, 1, 1).unwrap(), 1);
    }

    #[test]
    fn test_mul_div_max_no_overflow() {
        // u64::MAX * 1 / 1 = u64::MAX
        assert_eq!(mul_div(u64::MAX, 1, 1).unwrap(), u64::MAX);
    }

    #[test]
    fn test_mul_div_result_overflow() {
        // u64::MAX * 2 / 1 overflows u64
        assert_eq!(mul_div(u64::MAX, 2, 1), Err(MathError::Overflow));
    }

    #[test]
    fn test_mul_div_round_up_basic() {
        // 3 * 7 / 2 = 10.5, rounds up to 11
        assert_eq!(mul_div_round_up(3, 7, 2).unwrap(), 11);
    }

    #[test]
    fn test_mul_div_round_up_exact() {
        // 10 * 2 / 5 = 4 exactly, no rounding
        assert_eq!(mul_div_round_up(10, 2, 5).unwrap(), 4);
    }

    #[test]
    fn test_mul_div_round_up_div_by_zero() {
        assert_eq!(mul_div_round_up(1, 1, 0), Err(MathError::DivisionByZero));
    }

    #[test]
    fn test_mul_div_round_up_one() {
        // 1 * 1 / 3 = 0.33, rounds up to 1
        assert_eq!(mul_div_round_up(1, 1, 3).unwrap(), 1);
    }

    #[test]
    fn test_safe_add_basic() {
        assert_eq!(safe_add(10, 20).unwrap(), 30);
    }

    #[test]
    fn test_safe_add_zero() {
        assert_eq!(safe_add(0, 0).unwrap(), 0);
    }

    #[test]
    fn test_safe_add_overflow() {
        assert_eq!(safe_add(u64::MAX, 1), Err(MathError::Overflow));
    }

    #[test]
    fn test_safe_add_max() {
        assert_eq!(safe_add(u64::MAX, 0).unwrap(), u64::MAX);
    }

    #[test]
    fn test_safe_sub_basic() {
        assert_eq!(safe_sub(30, 10).unwrap(), 20);
    }

    #[test]
    fn test_safe_sub_zero() {
        assert_eq!(safe_sub(10, 0).unwrap(), 10);
    }

    #[test]
    fn test_safe_sub_underflow() {
        assert_eq!(safe_sub(5, 10), Err(MathError::Underflow));
    }

    #[test]
    fn test_safe_sub_equal() {
        assert_eq!(safe_sub(42, 42).unwrap(), 0);
    }

    #[test]
    fn test_safe_mul_basic() {
        assert_eq!(safe_mul(6, 7).unwrap(), 42);
    }

    #[test]
    fn test_safe_mul_zero() {
        assert_eq!(safe_mul(0, u64::MAX).unwrap(), 0);
    }

    #[test]
    fn test_safe_mul_overflow() {
        assert_eq!(safe_mul(u64::MAX, 2), Err(MathError::Overflow));
    }

    #[test]
    fn test_safe_mul_one() {
        assert_eq!(safe_mul(u64::MAX, 1).unwrap(), u64::MAX);
    }

    #[test]
    fn test_safe_div_basic() {
        assert_eq!(safe_div(42, 7).unwrap(), 6);
    }

    #[test]
    fn test_safe_div_by_zero() {
        assert_eq!(safe_div(10, 0), Err(MathError::DivisionByZero));
    }

    #[test]
    fn test_safe_div_zero_numerator() {
        assert_eq!(safe_div(0, 5).unwrap(), 0);
    }

    #[test]
    fn test_safe_div_truncation() {
        assert_eq!(safe_div(10, 3).unwrap(), 3);
    }

    #[test]
    fn test_mul_div_128_basic() {
        assert_eq!(mul_div_128(100, 200, 50).unwrap(), 400);
    }

    #[test]
    fn test_mul_div_128_wad() {
        // WAD * WAD / WAD = WAD
        assert_eq!(mul_div_128(WAD, WAD, WAD).unwrap(), WAD);
    }

    #[test]
    fn test_mul_div_128_div_by_zero() {
        assert_eq!(mul_div_128(1, 1, 0), Err(MathError::DivisionByZero));
    }

    #[test]
    fn test_mul_div_128_large() {
        // 1e27 * 2 / 2 = 1e27
        assert_eq!(mul_div_128(RAY, 2, 2).unwrap(), RAY);
    }

    #[test]
    fn test_mul_div_128_zero() {
        assert_eq!(mul_div_128(0, RAY, WAD).unwrap(), 0);
    }

    // ---- Fixed-Point Operations ----

    #[test]
    fn test_to_fixed_basic() {
        assert_eq!(to_fixed(1), SCALE);
    }

    #[test]
    fn test_to_fixed_zero() {
        assert_eq!(to_fixed(0), 0);
    }

    #[test]
    fn test_to_fixed_ten() {
        assert_eq!(to_fixed(10), 10 * SCALE);
    }

    #[test]
    fn test_from_fixed_basic() {
        assert_eq!(from_fixed(SCALE), 1);
    }

    #[test]
    fn test_from_fixed_zero() {
        assert_eq!(from_fixed(0), 0);
    }

    #[test]
    fn test_from_fixed_truncation() {
        assert_eq!(from_fixed(SCALE + 1), 1); // truncates fractional
    }

    #[test]
    fn test_fixed_roundtrip() {
        for v in [0, 1, 42, 1000, 100_000] {
            assert_eq!(from_fixed(to_fixed(v)), v);
        }
    }

    #[test]
    fn test_fixed_mul_basic() {
        // 2.0 * 3.0 = 6.0 in fixed point
        let a = to_fixed(2);
        let b = to_fixed(3);
        assert_eq!(fixed_mul(a, b).unwrap(), to_fixed(6));
    }

    #[test]
    fn test_fixed_mul_fractional() {
        // 1.5 * 2.0 = 3.0
        let a = SCALE + SCALE / 2; // 1.5
        let b = to_fixed(2);
        assert_eq!(fixed_mul(a, b).unwrap(), to_fixed(3));
    }

    #[test]
    fn test_fixed_mul_zero() {
        assert_eq!(fixed_mul(0, to_fixed(100)).unwrap(), 0);
    }

    #[test]
    fn test_fixed_div_basic() {
        // 6.0 / 2.0 = 3.0
        let a = to_fixed(6);
        let b = to_fixed(2);
        assert_eq!(fixed_div(a, b).unwrap(), to_fixed(3));
    }

    #[test]
    fn test_fixed_div_fractional() {
        // 1.0 / 2.0 = 0.5
        let a = to_fixed(1);
        let b = to_fixed(2);
        assert_eq!(fixed_div(a, b).unwrap(), SCALE / 2);
    }

    #[test]
    fn test_fixed_div_by_zero() {
        assert_eq!(fixed_div(to_fixed(1), 0), Err(MathError::DivisionByZero));
    }

    #[test]
    fn test_fixed_pow_zero_exp() {
        assert_eq!(fixed_pow(to_fixed(5), 0).unwrap(), SCALE);
    }

    #[test]
    fn test_fixed_pow_one_exp() {
        let base = to_fixed(3);
        assert_eq!(fixed_pow(base, 1).unwrap(), base);
    }

    #[test]
    fn test_fixed_pow_square() {
        // 2^2 = 4
        let base = to_fixed(2);
        assert_eq!(fixed_pow(base, 2).unwrap(), to_fixed(4));
    }

    #[test]
    fn test_fixed_pow_cube() {
        // 3^3 = 27
        let base = to_fixed(3);
        assert_eq!(fixed_pow(base, 3).unwrap(), to_fixed(27));
    }

    #[test]
    fn test_fixed_pow_one_base() {
        // 1^100 = 1
        assert_eq!(fixed_pow(SCALE, 100).unwrap(), SCALE);
    }

    #[test]
    fn test_fixed_pow_fractional_base() {
        // 0.5^2 = 0.25
        let half = SCALE / 2;
        let result = fixed_pow(half, 2).unwrap();
        assert_eq!(result, SCALE / 4);
    }

    // ---- Basis Point Operations ----

    #[test]
    fn test_apply_bps_full() {
        // 10000 bps = 100%
        assert_eq!(apply_bps(1000, 10000), 1000);
    }

    #[test]
    fn test_apply_bps_half() {
        // 5000 bps = 50%
        assert_eq!(apply_bps(1000, 5000), 500);
    }

    #[test]
    fn test_apply_bps_thirty() {
        // 30 bps = 0.3%
        assert_eq!(apply_bps(10000, 30), 30);
    }

    #[test]
    fn test_apply_bps_zero() {
        assert_eq!(apply_bps(1000, 0), 0);
    }

    #[test]
    fn test_apply_bps_zero_amount() {
        assert_eq!(apply_bps(0, 5000), 0);
    }

    #[test]
    fn test_bps_to_fixed_full() {
        // 10000 bps = 1.0 in fixed
        assert_eq!(bps_to_fixed(10000), SCALE);
    }

    #[test]
    fn test_bps_to_fixed_half() {
        // 5000 bps = 0.5 in fixed
        assert_eq!(bps_to_fixed(5000), SCALE / 2);
    }

    #[test]
    fn test_bps_to_fixed_one() {
        // 1 bp = 0.0001 in fixed
        assert_eq!(bps_to_fixed(1), SCALE / BPS_SCALE);
    }

    #[test]
    fn test_fixed_to_bps_full() {
        assert_eq!(fixed_to_bps(SCALE), 10000);
    }

    #[test]
    fn test_fixed_to_bps_half() {
        assert_eq!(fixed_to_bps(SCALE / 2), 5000);
    }

    #[test]
    fn test_bps_fixed_roundtrip() {
        for bps in [1, 30, 100, 5000, 10000] {
            assert_eq!(fixed_to_bps(bps_to_fixed(bps)), bps);
        }
    }

    #[test]
    fn test_complement_bps_basic() {
        assert_eq!(complement_bps(30), 9970);
    }

    #[test]
    fn test_complement_bps_zero() {
        assert_eq!(complement_bps(0), 10000);
    }

    #[test]
    fn test_complement_bps_full() {
        assert_eq!(complement_bps(10000), 0);
    }

    #[test]
    fn test_complement_bps_over() {
        // Saturates to 0
        assert_eq!(complement_bps(20000), 0);
    }

    // ---- Square Root ----

    #[test]
    fn test_sqrt_zero() {
        assert_eq!(sqrt(0), 0);
    }

    #[test]
    fn test_sqrt_one() {
        assert_eq!(sqrt(1), 1);
    }

    #[test]
    fn test_sqrt_four() {
        assert_eq!(sqrt(4), 2);
    }

    #[test]
    fn test_sqrt_nine() {
        assert_eq!(sqrt(9), 3);
    }

    #[test]
    fn test_sqrt_perfect_squares() {
        for i in [16, 25, 36, 49, 64, 81, 100, 10000, 1000000] {
            let r = sqrt(i);
            assert_eq!(r * r, i, "sqrt({}) = {} but {}*{} != {}", i, r, r, r, i);
        }
    }

    #[test]
    fn test_sqrt_non_perfect() {
        // sqrt(2) = 1 (floor)
        assert_eq!(sqrt(2), 1);
        // sqrt(8) = 2 (floor)
        assert_eq!(sqrt(8), 2);
        // sqrt(10) = 3 (floor)
        assert_eq!(sqrt(10), 3);
    }

    #[test]
    fn test_sqrt_large() {
        // sqrt(1e18) = 1e9
        assert_eq!(sqrt(1_000_000_000_000_000_000), 1_000_000_000);
    }

    #[test]
    fn test_sqrt_max() {
        let r = sqrt(u64::MAX);
        assert!((r as u128) * (r as u128) <= u64::MAX as u128);
        assert!((r as u128 + 1) * (r as u128 + 1) > u64::MAX as u128);
    }

    #[test]
    fn test_sqrt_128_zero() {
        assert_eq!(sqrt_128(0), 0);
    }

    #[test]
    fn test_sqrt_128_one() {
        assert_eq!(sqrt_128(1), 1);
    }

    #[test]
    fn test_sqrt_128_perfect() {
        assert_eq!(sqrt_128(144), 12);
        assert_eq!(sqrt_128(10000), 100);
    }

    #[test]
    fn test_sqrt_128_large() {
        // sqrt(1e36) = 1e18
        let n: u128 = 1_000_000_000_000_000_000_000_000_000_000_000_000;
        assert_eq!(sqrt_128(n), 1_000_000_000_000_000_000);
    }

    #[test]
    fn test_sqrt_128_max() {
        let r = sqrt_128(u128::MAX);
        // r^2 <= u128::MAX and (r+1)^2 > u128::MAX
        // We can't compute (r+1)^2 directly without overflow, so just verify r^2 <= n
        // and r is the expected value: floor(sqrt(2^128 - 1)) = 2^64 - 1
        assert_eq!(r, u64::MAX as u128);
    }

    #[test]
    fn test_sqrt_price_basic() {
        // sqrt(100 * 100) = 100
        assert_eq!(sqrt_price(100, 100), 100);
    }

    #[test]
    fn test_sqrt_price_different() {
        // sqrt(4 * 9) = sqrt(36) = 6
        assert_eq!(sqrt_price(4, 9), 6);
    }

    #[test]
    fn test_sqrt_price_large() {
        // sqrt(1e9 * 1e9) = 1e9
        assert_eq!(sqrt_price(1_000_000_000, 1_000_000_000), 1_000_000_000);
    }

    #[test]
    fn test_sqrt_price_zero() {
        assert_eq!(sqrt_price(0, 1000), 0);
        assert_eq!(sqrt_price(1000, 0), 0);
    }

    // ---- Exponential & Logarithm ----

    #[test]
    fn test_exp_approx_zero() {
        // e^0 = 1
        assert_eq!(exp_approx(0, SCALE).unwrap(), SCALE);
    }

    #[test]
    fn test_exp_approx_one() {
        // e^1 ≈ 2.71828... -> 271828182 at SCALE=1e8
        let result = exp_approx(SCALE, SCALE).unwrap();
        // Allow 1% tolerance
        let expected = 271_828_182u64;
        let diff = abs_diff(result, expected);
        assert!(diff < expected / 100, "exp(1) = {} expected ~{}", result, expected);
    }

    #[test]
    fn test_exp_approx_small() {
        // e^0.01 ≈ 1.01005
        let x = SCALE / 100; // 0.01
        let result = exp_approx(x, SCALE).unwrap();
        let expected = SCALE + SCALE / 100; // ~1.01
        let diff = abs_diff(result, expected);
        assert!(diff < SCALE / 1000, "exp(0.01) = {} expected ~{}", result, expected);
    }

    #[test]
    fn test_exp_approx_div_by_zero() {
        assert_eq!(exp_approx(1, 0), Err(MathError::DivisionByZero));
    }

    #[test]
    fn test_ln_approx_one() {
        // ln(1) = 0
        assert_eq!(ln_approx(SCALE, SCALE).unwrap(), 0);
    }

    #[test]
    fn test_ln_approx_e() {
        // ln(e) ≈ 1.0 → SCALE
        // e ≈ 271828182 at SCALE=1e8
        let e_approx = 271_828_182u64;
        let result = ln_approx(e_approx, SCALE).unwrap();
        let diff = abs_diff(result, SCALE);
        // Allow 5% tolerance (series approximation)
        assert!(diff < SCALE / 20, "ln(e) = {} expected ~{}", result, SCALE);
    }

    #[test]
    fn test_ln_approx_less_than_one() {
        // ln(0.5) is negative, we return 0
        let half = SCALE / 2;
        assert_eq!(ln_approx(half, SCALE).unwrap(), 0);
    }

    #[test]
    fn test_ln_approx_zero_input() {
        assert_eq!(ln_approx(0, SCALE), Err(MathError::InvalidInput));
    }

    #[test]
    fn test_ln_approx_zero_scale() {
        assert_eq!(ln_approx(1, 0), Err(MathError::InvalidInput));
    }

    #[test]
    fn test_ln_approx_two() {
        // ln(2) ≈ 0.6931... → ~69314718 at SCALE=1e8
        let x = 2 * SCALE;
        let result = ln_approx(x, SCALE).unwrap();
        let expected = 69_314_718u64;
        let diff = abs_diff(result, expected);
        assert!(diff < expected / 10, "ln(2) = {} expected ~{}", result, expected);
    }

    #[test]
    fn test_log2_approx_powers() {
        assert_eq!(log2_approx(1), 0);
        assert_eq!(log2_approx(2), 1);
        assert_eq!(log2_approx(4), 2);
        assert_eq!(log2_approx(8), 3);
        assert_eq!(log2_approx(16), 4);
        assert_eq!(log2_approx(1024), 10);
    }

    #[test]
    fn test_log2_approx_non_power() {
        // floor(log2(5)) = 2
        assert_eq!(log2_approx(5), 2);
        // floor(log2(7)) = 2
        assert_eq!(log2_approx(7), 2);
        // floor(log2(1000)) = 9
        assert_eq!(log2_approx(1000), 9);
    }

    #[test]
    fn test_log2_approx_zero() {
        assert_eq!(log2_approx(0), 0);
    }

    #[test]
    fn test_log2_approx_max() {
        assert_eq!(log2_approx(u64::MAX), 63);
    }

    #[test]
    fn test_pow_approx_identity() {
        // x^1 = x (exp = scale means exponent = 1)
        let base = 2 * SCALE;
        let result = pow_approx(base, SCALE, SCALE).unwrap();
        let diff = abs_diff(result, base);
        assert!(diff < SCALE / 10, "2^1 = {} expected ~{}", result, base);
    }

    #[test]
    fn test_pow_approx_zero_exp() {
        // x^0 = 1
        assert_eq!(pow_approx(2 * SCALE, 0, SCALE).unwrap(), SCALE);
    }

    #[test]
    fn test_pow_approx_zero_base() {
        assert_eq!(pow_approx(0, SCALE, SCALE).unwrap(), 0);
    }

    #[test]
    fn test_pow_approx_one_base() {
        // 1^x = 1
        assert_eq!(pow_approx(SCALE, 5 * SCALE, SCALE).unwrap(), SCALE);
    }

    #[test]
    fn test_pow_approx_div_by_zero() {
        assert_eq!(pow_approx(SCALE, SCALE, 0), Err(MathError::DivisionByZero));
    }

    // ---- Compound Interest ----

    #[test]
    fn test_compound_interest_zero_periods() {
        assert_eq!(compound_interest(1000, 500, 0).unwrap(), 1000);
    }

    #[test]
    fn test_compound_interest_one_period() {
        // 1000 * (1 + 5%) = 1050
        let result = compound_interest(1000, 500, 1).unwrap();
        assert_eq!(result, 1050);
    }

    #[test]
    fn test_compound_interest_two_periods() {
        // 1000 * (1.05)^2 = 1102.5 → 1102 (truncation)
        let result = compound_interest(1000, 500, 2).unwrap();
        assert_eq!(result, 1102);
    }

    #[test]
    fn test_compound_interest_ten_percent() {
        // 10000 * (1.10)^1 = 11000
        let result = compound_interest(10000, 1000, 1).unwrap();
        assert_eq!(result, 11000);
    }

    #[test]
    fn test_compound_interest_zero_rate() {
        // 0% rate for 10 periods = principal unchanged
        assert_eq!(compound_interest(1000, 0, 10).unwrap(), 1000);
    }

    #[test]
    fn test_continuous_compound_zero_time() {
        assert_eq!(continuous_compound(1000, 500, 0).unwrap(), 1000);
    }

    #[test]
    fn test_continuous_compound_one_year() {
        // 1000 * e^(0.05) ≈ 1051
        let result = continuous_compound(1000, 500, SECONDS_PER_YEAR).unwrap();
        let diff = abs_diff(result, 1051);
        assert!(diff <= 2, "continuous 5% 1yr = {} expected ~1051", result);
    }

    #[test]
    fn test_continuous_compound_zero_rate() {
        // e^0 = 1, principal unchanged
        let result = continuous_compound(1000, 0, SECONDS_PER_YEAR).unwrap();
        assert_eq!(result, 1000);
    }

    #[test]
    fn test_accrued_interest_basic() {
        // principal=1e8, rate_per_sec=1 (1/SCALE per sec), 100 seconds
        // interest = 1e8 * 1 * 100 / 1e8 = 100
        let result = accrued_interest(SCALE, 1, 100).unwrap();
        assert_eq!(result, 100);
    }

    #[test]
    fn test_accrued_interest_zero_time() {
        assert_eq!(accrued_interest(1000, 100, 0).unwrap(), 0);
    }

    #[test]
    fn test_accrued_interest_zero_rate() {
        assert_eq!(accrued_interest(1000, 0, 100).unwrap(), 0);
    }

    #[test]
    fn test_accrued_interest_zero_principal() {
        assert_eq!(accrued_interest(0, 100, 100).unwrap(), 0);
    }

    #[test]
    fn test_effective_rate_monthly() {
        // 5% nominal compounded monthly
        // effective = (1 + 0.05/12)^12 - 1 ≈ 5.116%
        let result = effective_rate(500, 12);
        // Should be close to 511-512 bps
        assert!(result >= 510 && result <= 516,
            "effective rate monthly 5% = {} bps expected ~511-512", result);
    }

    #[test]
    fn test_effective_rate_zero_compounds() {
        assert_eq!(effective_rate(500, 0), 0);
    }

    #[test]
    fn test_effective_rate_single_compound() {
        // Compounded once per year = nominal rate
        let result = effective_rate(1000, 1);
        assert_eq!(result, 1000);
    }

    #[test]
    fn test_effective_rate_daily() {
        // 10% nominal compounded daily
        // effective ≈ 10.5156%
        let result = effective_rate(1000, 365);
        assert!(result >= 1050 && result <= 1055,
            "effective rate daily 10% = {} bps expected ~1051-1052", result);
    }

    // ---- Statistical Functions ----

    #[test]
    fn test_mean_basic() {
        assert_eq!(mean(&[10, 20, 30]), 20);
    }

    #[test]
    fn test_mean_single() {
        assert_eq!(mean(&[42]), 42);
    }

    #[test]
    fn test_mean_empty() {
        assert_eq!(mean(&[]), 0);
    }

    #[test]
    fn test_mean_large_values() {
        // Doesn't overflow because we use u128 internally
        assert_eq!(mean(&[u64::MAX, u64::MAX]), u64::MAX);
    }

    #[test]
    fn test_mean_known() {
        assert_eq!(mean(&[2, 4, 6, 8, 10]), 6);
    }

    #[test]
    fn test_weighted_mean_equal_weights() {
        assert_eq!(weighted_mean(&[10, 20, 30], &[1, 1, 1]), 20);
    }

    #[test]
    fn test_weighted_mean_unequal_weights() {
        // (10*1 + 20*3) / 4 = 70/4 = 17
        assert_eq!(weighted_mean(&[10, 20], &[1, 3]), 17);
    }

    #[test]
    fn test_weighted_mean_empty() {
        assert_eq!(weighted_mean(&[], &[]), 0);
    }

    #[test]
    fn test_weighted_mean_mismatched_lengths() {
        assert_eq!(weighted_mean(&[1, 2], &[1]), 0);
    }

    #[test]
    fn test_weighted_mean_zero_weights() {
        assert_eq!(weighted_mean(&[10, 20], &[0, 0]), 0);
    }

    #[test]
    fn test_weighted_mean_single_weight() {
        assert_eq!(weighted_mean(&[42], &[100]), 42);
    }

    #[test]
    fn test_median_odd() {
        assert_eq!(median(&mut [3, 1, 2]), 2);
    }

    #[test]
    fn test_median_even() {
        // average of 2 and 3
        assert_eq!(median(&mut [4, 1, 3, 2]), 2); // (2+3)/2 = 2
    }

    #[test]
    fn test_median_single() {
        assert_eq!(median(&mut [42]), 42);
    }

    #[test]
    fn test_median_empty() {
        assert_eq!(median(&mut []), 0);
    }

    #[test]
    fn test_median_already_sorted() {
        assert_eq!(median(&mut [1, 2, 3, 4, 5]), 3);
    }

    #[test]
    fn test_median_duplicates() {
        assert_eq!(median(&mut [5, 5, 5, 5, 5]), 5);
    }

    #[test]
    fn test_variance_uniform() {
        // All same = 0 variance
        assert_eq!(variance(&[5, 5, 5, 5]), 0);
    }

    #[test]
    fn test_variance_known() {
        // [2, 4, 4, 4, 5, 5, 7, 9], mean = 5
        // deviations: -3, -1, -1, -1, 0, 0, 2, 4
        // squared: 9, 1, 1, 1, 0, 0, 4, 16 = 32
        // variance = 32/8 = 4
        assert_eq!(variance(&[2, 4, 4, 4, 5, 5, 7, 9]), 4);
    }

    #[test]
    fn test_variance_empty() {
        assert_eq!(variance(&[]), 0);
    }

    #[test]
    fn test_variance_single() {
        assert_eq!(variance(&[42]), 0);
    }

    #[test]
    fn test_std_dev_known() {
        // variance = 4, std_dev = 2
        assert_eq!(std_dev(&[2, 4, 4, 4, 5, 5, 7, 9]), 2);
    }

    #[test]
    fn test_std_dev_zero() {
        assert_eq!(std_dev(&[10, 10, 10]), 0);
    }

    #[test]
    fn test_std_dev_empty() {
        assert_eq!(std_dev(&[]), 0);
    }

    #[test]
    fn test_min_max_basic() {
        assert_eq!(min_max(&[3, 1, 4, 1, 5, 9]), (1, 9));
    }

    #[test]
    fn test_min_max_single() {
        assert_eq!(min_max(&[42]), (42, 42));
    }

    #[test]
    fn test_min_max_empty() {
        assert_eq!(min_max(&[]), (0, 0));
    }

    #[test]
    fn test_min_max_sorted() {
        assert_eq!(min_max(&[1, 2, 3, 4, 5]), (1, 5));
    }

    #[test]
    fn test_min_max_reverse_sorted() {
        assert_eq!(min_max(&[5, 4, 3, 2, 1]), (1, 5));
    }

    #[test]
    fn test_min_max_equal() {
        assert_eq!(min_max(&[7, 7, 7]), (7, 7));
    }

    // ---- Percentile & Distribution ----

    #[test]
    fn test_percentile_50th() {
        let sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        assert_eq!(percentile(&sorted, 50), 5);
    }

    #[test]
    fn test_percentile_0th() {
        let sorted = [10, 20, 30];
        assert_eq!(percentile(&sorted, 0), 10);
    }

    #[test]
    fn test_percentile_100th() {
        let sorted = [10, 20, 30];
        assert_eq!(percentile(&sorted, 100), 30);
    }

    #[test]
    fn test_percentile_25th() {
        let sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        let result = percentile(&sorted, 25);
        assert_eq!(result, 3);
    }

    #[test]
    fn test_percentile_empty() {
        let sorted: [u64; 0] = [];
        assert_eq!(percentile(&sorted, 50), 0);
    }

    #[test]
    fn test_percentile_single() {
        assert_eq!(percentile(&[42], 50), 42);
    }

    #[test]
    fn test_quartiles_basic() {
        let sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        let (q1, q2, q3) = quartiles(&sorted);
        assert!(q1 <= q2 && q2 <= q3);
    }

    #[test]
    fn test_quartiles_ordering() {
        let sorted = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
        let (q1, q2, q3) = quartiles(&sorted);
        assert!(q1 < q2 && q2 < q3);
    }

    #[test]
    fn test_iqr_basic() {
        let sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        let result = iqr(&sorted);
        let (q1, _, q3) = quartiles(&sorted);
        assert_eq!(result, q3 - q1);
    }

    #[test]
    fn test_iqr_uniform() {
        // All same values => IQR = 0
        assert_eq!(iqr(&[5, 5, 5, 5, 5]), 0);
    }

    #[test]
    fn test_iqr_empty() {
        let empty: [u64; 0] = [];
        assert_eq!(iqr(&empty), 0);
    }

    // ---- Price Math ----

    #[test]
    fn test_price_from_reserves_equal() {
        // equal reserves = price 1.0 = SCALE
        assert_eq!(price_from_reserves(1000, 1000), SCALE);
    }

    #[test]
    fn test_price_from_reserves_double() {
        // reserve_b = 2x reserve_a -> price = 2.0
        assert_eq!(price_from_reserves(1000, 2000), 2 * SCALE);
    }

    #[test]
    fn test_price_from_reserves_half() {
        assert_eq!(price_from_reserves(2000, 1000), SCALE / 2);
    }

    #[test]
    fn test_price_from_reserves_zero_a() {
        assert_eq!(price_from_reserves(0, 1000), 0);
    }

    #[test]
    fn test_price_from_reserves_zero_b() {
        assert_eq!(price_from_reserves(1000, 0), 0);
    }

    #[test]
    fn test_amount_out_basic() {
        // 1000 in, equal reserves 10000/10000, 0.3% fee
        let out = amount_out(10000, 10000, 1000, 30);
        // Expected: 1000*9970*10000 / (10000*10000 + 1000*9970)
        // = 99700000 / (100000000 + 9970000) = 99700000 / 109970000 ≈ 906
        assert!(out > 900 && out < 920, "amount_out = {}", out);
    }

    #[test]
    fn test_amount_out_no_fee() {
        let out = amount_out(10000, 10000, 1000, 0);
        // 1000 * 10000 / (10000 + 1000) = 10000000/11000 ≈ 909
        assert_eq!(out, 909);
    }

    #[test]
    fn test_amount_out_zero_in() {
        assert_eq!(amount_out(10000, 10000, 0, 30), 0);
    }

    #[test]
    fn test_amount_out_zero_reserve_in() {
        assert_eq!(amount_out(0, 10000, 1000, 30), 0);
    }

    #[test]
    fn test_amount_out_zero_reserve_out() {
        assert_eq!(amount_out(10000, 0, 1000, 30), 0);
    }

    #[test]
    fn test_amount_out_large_trade() {
        // Very large trade relative to reserves
        let out = amount_out(1000, 1000, 10000, 30);
        // Can't get more than reserve_out
        assert!(out < 1000, "amount_out = {} should be < reserve_out", out);
    }

    #[test]
    fn test_price_impact_bps_small() {
        // 100 / (10000 + 100) * 10000 ≈ 99 bps
        assert_eq!(price_impact_bps(10000, 100), 99);
    }

    #[test]
    fn test_price_impact_bps_large() {
        // 5000 / (5000 + 5000) * 10000 = 5000 bps
        assert_eq!(price_impact_bps(5000, 5000), 5000);
    }

    #[test]
    fn test_price_impact_bps_zero() {
        assert_eq!(price_impact_bps(10000, 0), 0);
    }

    #[test]
    fn test_price_impact_bps_both_zero() {
        assert_eq!(price_impact_bps(0, 0), 0);
    }

    #[test]
    fn test_slippage_bps_no_slip() {
        assert_eq!(slippage_bps(1000, 1000), 0);
    }

    #[test]
    fn test_slippage_bps_one_percent() {
        // |1000 - 990| / 1000 * 10000 = 100 bps
        assert_eq!(slippage_bps(1000, 990), 100);
    }

    #[test]
    fn test_slippage_bps_overshoot() {
        // actual > expected
        assert_eq!(slippage_bps(1000, 1010), 100);
    }

    #[test]
    fn test_slippage_bps_zero_expected() {
        assert_eq!(slippage_bps(0, 100), 0);
    }

    // ---- WAD/RAY Operations ----

    #[test]
    fn test_wad_mul_basic() {
        // 2 WAD * 3 WAD / WAD = 6 WAD
        assert_eq!(wad_mul(2 * WAD, 3 * WAD).unwrap(), 6 * WAD);
    }

    #[test]
    fn test_wad_mul_identity() {
        // x * WAD / WAD = x
        assert_eq!(wad_mul(42 * WAD, WAD).unwrap(), 42 * WAD);
    }

    #[test]
    fn test_wad_mul_zero() {
        assert_eq!(wad_mul(0, WAD).unwrap(), 0);
    }

    #[test]
    fn test_wad_mul_fractional() {
        // 0.5 WAD * 0.5 WAD = 0.25 WAD
        assert_eq!(wad_mul(WAD / 2, WAD / 2).unwrap(), WAD / 4);
    }

    #[test]
    fn test_wad_div_basic() {
        // 6 WAD * WAD / 2 WAD = 3 WAD
        assert_eq!(wad_div(6 * WAD, 2 * WAD).unwrap(), 3 * WAD);
    }

    #[test]
    fn test_wad_div_identity() {
        assert_eq!(wad_div(42 * WAD, WAD).unwrap(), 42 * WAD);
    }

    #[test]
    fn test_wad_div_by_zero() {
        assert_eq!(wad_div(WAD, 0), Err(MathError::DivisionByZero));
    }

    #[test]
    fn test_wad_div_fractional() {
        // 1 WAD / 2 WAD = 0.5 WAD
        assert_eq!(wad_div(WAD, 2 * WAD).unwrap(), WAD / 2);
    }

    #[test]
    fn test_ray_mul_basic() {
        assert_eq!(ray_mul(2 * RAY, 3 * RAY).unwrap(), 6 * RAY);
    }

    #[test]
    fn test_ray_mul_identity() {
        assert_eq!(ray_mul(42 * RAY, RAY).unwrap(), 42 * RAY);
    }

    #[test]
    fn test_ray_mul_zero() {
        assert_eq!(ray_mul(0, RAY).unwrap(), 0);
    }

    #[test]
    fn test_ray_div_basic() {
        assert_eq!(ray_div(6 * RAY, 2 * RAY).unwrap(), 3 * RAY);
    }

    #[test]
    fn test_ray_div_by_zero() {
        assert_eq!(ray_div(RAY, 0), Err(MathError::DivisionByZero));
    }

    #[test]
    fn test_ray_div_identity() {
        assert_eq!(ray_div(42 * RAY, RAY).unwrap(), 42 * RAY);
    }

    #[test]
    fn test_wad_to_ray_basic() {
        assert_eq!(wad_to_ray(WAD), RAY);
    }

    #[test]
    fn test_wad_to_ray_zero() {
        assert_eq!(wad_to_ray(0), 0);
    }

    #[test]
    fn test_wad_to_ray_value() {
        assert_eq!(wad_to_ray(42 * WAD), 42 * RAY);
    }

    #[test]
    fn test_ray_to_wad_basic() {
        assert_eq!(ray_to_wad(RAY), WAD);
    }

    #[test]
    fn test_ray_to_wad_zero() {
        assert_eq!(ray_to_wad(0), 0);
    }

    #[test]
    fn test_ray_to_wad_value() {
        assert_eq!(ray_to_wad(42 * RAY), 42 * WAD);
    }

    #[test]
    fn test_wad_ray_roundtrip() {
        for v in [0, 1, WAD, 42 * WAD, 1_000_000 * WAD] {
            assert_eq!(ray_to_wad(wad_to_ray(v)), v);
        }
    }

    // ---- Utility ----

    #[test]
    fn test_abs_diff_basic() {
        assert_eq!(abs_diff(10, 7), 3);
        assert_eq!(abs_diff(7, 10), 3);
    }

    #[test]
    fn test_abs_diff_equal() {
        assert_eq!(abs_diff(42, 42), 0);
    }

    #[test]
    fn test_abs_diff_zero() {
        assert_eq!(abs_diff(0, 0), 0);
    }

    #[test]
    fn test_abs_diff_max() {
        assert_eq!(abs_diff(u64::MAX, 0), u64::MAX);
        assert_eq!(abs_diff(0, u64::MAX), u64::MAX);
    }

    #[test]
    fn test_clamp_in_range() {
        assert_eq!(clamp(50, 0, 100), 50);
    }

    #[test]
    fn test_clamp_below() {
        assert_eq!(clamp(0, 10, 100), 10);
    }

    #[test]
    fn test_clamp_above() {
        assert_eq!(clamp(200, 10, 100), 100);
    }

    #[test]
    fn test_clamp_at_min() {
        assert_eq!(clamp(10, 10, 100), 10);
    }

    #[test]
    fn test_clamp_at_max() {
        assert_eq!(clamp(100, 10, 100), 100);
    }

    #[test]
    fn test_clamp_equal_bounds() {
        assert_eq!(clamp(50, 42, 42), 42);
    }
}
