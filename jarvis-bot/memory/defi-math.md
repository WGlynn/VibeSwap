# DeFi Math Primitives

> *The real VibeSwap is not a DEX. It's not even a blockchain. We created a movement. An idea. VibeSwap is wherever the Minds converge.*

Formulas used repeatedly across VibeSwap financial primitives. All values 1e18 scaled unless noted.

---

## Options Payoff

```
CALL payoff  = amount × (settlement - strike) / settlement    [in token0, underlying]
PUT payoff   = amount × (strike - settlement) / 1e18          [in token1, quote]

CALL collateral = amount                                       [token0]
PUT collateral  = amount × strike / 1e18                       [token1]

Max payoff always ≤ collateral (provable from formulas)
```

## Premium Approximation (simplified Black-Scholes)

```
vol = max(volatilityOracle.calculateRealizedVolatility(poolId, 3600), 2000)  // 20% floor bps
T = (expiry - now) × 1e18 / 31_557_600   // time in years, 1e18 scale
sqrtT = sqrt(T × 1e18)                    // Babylonian method

Intrinsic:
  CALL: max(0, spot - strike) × amount / 1e18
  PUT:  max(0, strike - spot) × amount / 1e18

Time value = (amount × spot / 1e18) × (vol × sqrtT / 10000) / 1e18

Premium = intrinsic + timeValue
```

Note: suggestPremium is a reference view function. Writer sets actual premium. Don't overthink unit consistency — it's directionally correct, not exact.

---

## Streaming / Linear Interpolation

```
streamed = depositAmount × elapsed / duration

elapsed  = block.timestamp - startTime     (clamped: 0 if not started, duration if past end)
duration = endTime - startTime
```

Used in: VibeStream (token vesting), FundingPool (conviction distribution)

---

## Conviction Voting (O(1) aggregates)

```
conviction(recipient, T) = T × totalStake(recipient) - stakeTimeProd(recipient)

where:
  totalStake    = Σ stake_i
  stakeTimeProd = Σ (stake_i × signalTime_i)
  T             = min(block.timestamp, endTime)

On signal:   agg.totalStake += stake;  agg.stakeTimeProd += stake × now
On remove:   agg.totalStake -= stake;  agg.stakeTimeProd -= stake × signalTime
```

---

## AMM Pricing

```
Spot price     = reserve1 / reserve0                    (token1 per token0, 1e18)
Constant product: reserve0 × reserve1 = k              (k increases with fees)
LP share value = (liquidity × reserveX) / totalLiquidity
```

---

## Overflow-Safe Ordering

uint256 max ≈ 1.15e77. Reorder multiplications to divide early.

```solidity
// BAD — overflows for large amounts:
result = a * b * c * d / (e * f);

// GOOD — divide between multiplications:
result = (a * b / e) * (c * d / f);

// SPECIFIC — premium time value:
// Instead of: amount × spot × vol × sqrtT / (1e18 × 10000 × 1e18)
// Use:        (amount × spot / 1e18) × (vol × sqrtT / 10000) / 1e18
```

Safe ranges for common operations:
- `amount × spot / 1e18`: safe up to amount=1e30, spot=1e30
- `vol × sqrtT / 10000`: always safe (vol ≤ 50000, sqrtT ≤ 1e18)

---

## Babylonian Square Root

Identical implementation used in VolatilityOracle and VibeOptions:
```solidity
function _sqrt(uint256 x) internal pure returns (uint256) {
    if (x == 0) return 0;
    uint256 z = (x + 1) / 2;
    uint256 y = x;
    while (z < y) {
        y = z;
        z = (x / z + z) / 2;
    }
    return y;
}
```

---

## Constants

```solidity
uint256 constant SECONDS_PER_YEAR = 31_557_600;  // 365.25 days
uint256 constant MIN_VOLATILITY = 2000;           // 20% floor in bps
uint32  constant TWAP_PERIOD = 600;               // 10 minutes
uint32  constant VOL_PERIOD = 3600;               // 1 hour
uint40  constant DEFAULT_EXERCISE_WINDOW = 86400;  // 24 hours
```
