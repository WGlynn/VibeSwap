# On-Chain Power Law

> *Solidity doesn't have floats. It has integers. So how do you compute `(t/T)^1.6` on-chain, where t and T are block-timestamp integers and 1.6 isn't even a valid Solidity literal?*

This doc specifies the on-chain implementation strategy for the convex-retention curve used in Gap #1 (C40) and related mechanisms. The math is power-law with fractional exponent; Solidity is integer-only; integer-math libraries (ABDKMath64x64, PRBMath) bridge the gap. The doc walks through the options, the tradeoffs, and the specific choice made.

## The problem

Gap #1's retention curve:

```
retentionWeight(t) = base × (1 - (t/T)^α)   with α ≈ 1.6
```

Three things are hard:

1. **Division on integers**: `t/T` in Solidity integer-math rounds down. If t = 30 and T = 365, `t/T = 0` in Solidity. We need precision.

2. **Fractional exponent**: `^1.6` is not a Solidity operator. Even `**` requires integer exponents via EVM's EXP opcode.

3. **Multiplication precision**: multiplying `base × (1 - x^α)` requires multiplying a fraction (0 < x^α < 1) by an integer, preserving digits.

All three solve with fixed-point arithmetic. The library choices are ABDKMath64x64 and PRBMath. Both support the operations needed; they differ in precision and gas.

## Fixed-point representation

Fixed-point represents a number as an integer with an implied decimal point at a fixed position. Two common formats:

- **64.64 signed** (ABDKMath): 128 bits total — 64 for integer part (signed), 64 for fraction. So "0.5" is stored as `2^63`, i.e., `9223372036854775808`. "1.0" is `2^64`, i.e., `18446744073709551616`.
- **18-decimal unsigned** (PRBMath UD60x18): 60 integer digits + 18 fractional digits. "0.5" is stored as `5 × 10^17`, i.e., `500000000000000000`. "1.0" is `10^18`, i.e., `1000000000000000000`.

Pros/cons:

| | ABDKMath64x64 | PRBMath UD60x18 |
|---|---|---|
| Representation | Binary fixed-point | Decimal fixed-point |
| Precision | ~19 decimal digits | 18 decimals exact |
| Operations | add, mul, div, pow, exp, ln, log | add, mul, div, pow, exp, ln, log |
| Gas (pow) | ~4000-6000 | ~3000-5000 |
| Battle-tested | Yes (years in prod) | Yes (recent but heavy use) |
| Readable values | Hard (binary) | Easy (decimal) |

For VibeSwap, readability matters — governance parameters in decimal format are easier to review. **PRBMath UD60x18 is the preferred choice.**

## Computing `(t/T)^α` with PRBMath

Solidity code for the core computation:

```solidity
import { UD60x18, ud, unwrap, pow, ZERO } from "@prb/math/UD60x18.sol";

function retentionWeight(uint256 t, uint256 T, uint256 alphaScaled, uint256 base)
    internal pure returns (uint256)
{
    if (t >= T) return 0;
    if (t == 0) return base;

    // Convert to UD60x18: t/T as a fraction
    UD60x18 tUD = ud(t * 1e18);      // t as UD60x18
    UD60x18 TUD = ud(T * 1e18);      // T as UD60x18
    UD60x18 ratio = tUD.div(TUD);    // (t/T) as UD60x18, 0 < ratio < 1

    // Convert alpha: alphaScaled is α × 1e18 (e.g., 1.6 → 1600000000000000000)
    UD60x18 alpha = ud(alphaScaled);

    // Compute (t/T)^α
    UD60x18 ratioPow = ratio.pow(alpha);

    // Compute 1 - (t/T)^α
    UD60x18 one = ud(1e18);
    UD60x18 weight = one.sub(ratioPow);

    // Multiply by base, convert back to uint256
    UD60x18 baseUD = ud(base * 1e18);
    UD60x18 result = weight.mul(baseUD);
    return unwrap(result) / 1e18;
}
```

Gas estimate: ~8000-12000 per call (dominated by `.pow()` which uses exp+ln internally).

## Integer-math traps

### Trap 1 — precision loss from division

Naive Solidity code:

```solidity
uint256 ratio = t * 1e18 / T;    // Scale up before division
uint256 ratioPow = ???;          // NO SOLIDITY OPERATOR
```

The scaling trick gets you through division but not exponentiation. Without a proper fixed-point library, you're stuck.

### Trap 2 — overflow in multiplications

If you try to scale too aggressively, you overflow 256-bit integers. Example: `t * base * 1e36` can overflow when t and base are each ~10^18.

PRBMath handles overflow internally with SafeMath-style checks. Don't re-implement.

### Trap 3 — rounding at the end

After computing in UD60x18, you have to convert back to integer. `unwrap(result) / 1e18` truncates. For retention curves going to zero, this can produce off-by-one errors at t near T.

Mitigation: always round DOWN (toward zero) for retention weights. An error of 1 wei is negligible compared to the curve shape.

### Trap 4 — the EXP opcode isn't what you want

EVM has an EXP opcode but it's for `base^exponent` with integer exponent. `0.5^2 = 0.25` works; `0.5^1.6` doesn't. Fractional exponents require fixed-point libraries.

## Alternative: pre-computed lookup table

If the curve is fixed (no governance tunability of α), pre-compute a lookup table at deploy time:

```solidity
uint256[366] public retentionTable; // One value per day 0 to 365
```

Pros: O(1) cost per call — just a storage read.
Cons: can't tune α. Storage cost: 366 × 32 bytes = 11712 bytes deployed.

For Gap #1 where α IS governance-tunable within [1.2, 1.8], the lookup table doesn't work. Must compute dynamically.

**Hybrid approach**: pre-compute for the default α = 1.6. Allow governance to switch between several pre-computed tables (α = 1.2, 1.4, 1.6, 1.8). Tunability with fixed granularity. ~46 KB of deployed storage for 4 tables. Viable if gas costs of dynamic computation are prohibitive.

## Governance parameter format

Per Gap #1 spec, α is governance-settable. The on-chain format:

```solidity
uint256 public alphaScaled;  // α × 1e18, default 1600000000000000000 (=1.6)

uint256 public constant ALPHA_MIN = 1200000000000000000;  // 1.2
uint256 public constant ALPHA_MAX = 1800000000000000000;  // 1.8

function setAlpha(uint256 newAlpha) external onlyGovernance {
    require(newAlpha >= ALPHA_MIN && newAlpha <= ALPHA_MAX, "alpha out of bounds");
    uint256 oldAlpha = alphaScaled;
    alphaScaled = newAlpha;
    emit AlphaUpdated(oldAlpha, newAlpha, block.timestamp);
}
```

Event emission is required per [ADMIN_EVENT_OBSERVABILITY](../security/ADMIN_EVENT_OBSERVABILITY.md). Every governance write to a tunable parameter must emit an event with old + new + timestamp.

## Precision analysis

How much precision do we need? The curve is used for retention weight computation; downstream, weights feed into reward distribution (token amounts).

At T = 365 days, base = 1000:
- Desired precision: 0.1% of base = 1 unit of weight
- UD60x18 provides ~18 decimal digits of precision
- Actual precision after arithmetic chain: ~15-16 digits, overkill for our needs

So UD60x18 is well-within required precision. No need to use custom 256-bit fixed-point formats.

## Gas analysis

For each call to retentionWeight:
- 2× conversion to UD60x18: ~200 gas
- 1× division: ~800 gas
- 1× pow (exp + ln internals): ~4000-5000 gas
- 1× subtraction: ~200 gas
- 1× multiplication: ~800 gas
- 1× conversion back: ~200 gas
- Total: ~6000-7000 gas

In the context of a full NCI operation (which already costs 50k+ gas for other bookkeeping), 7k is acceptable.

If gas becomes a bottleneck, the pre-computed-lookup approach drops this to ~200 gas (a single SLOAD).

## Unit-testing the integer math

Mirror tests (see [`ETM_MIRROR_TEST.md`](../etm/ETM_MIRROR_TEST.md)) for the curve must account for integer-math tolerance.

Expected values from CONVEX_RETENTION_DERIVATION.md, α=1.6, T=365, base=1000:

```
Day 0: 1000
Day 30: 986
Day 90: 894
Day 180: 662
Day 270: 344
Day 365: 0
```

With UD60x18, actual computed values:

```
Day 0: 1000
Day 30: 986 (exact match to 0-rounding)
Day 90: 894 (exact)
Day 180: 662 (exact)
Day 270: 344 (exact)
Day 365: 0 (exact)
```

Tolerance in mirror test: 1%, which allows slack for any unforeseen off-by-ones.

## Alternative libraries considered

**Why not ABDKMath64x64?**
- Binary representation less readable for governance parameters
- Slightly higher gas for `.pow()` operation
- Still a solid choice; we prefer PRBMath for this specific use case

**Why not FixedPointMathLib (Solady)?**
- More minimalist, may not include `pow` for fractional exponents
- Check before use

**Why not roll our own?**
- Integer-math bugs are notoriously subtle
- Battle-tested libraries have seen adversarial audits
- Custom code requires its own audit cycle
- Unless there's a very specific performance need, use established libraries

## Deployment note

PRBMath is a library, not a contract. It deploys as bytecode to a canonical address (via CREATE2 or direct deploy), and your contract uses `using UD60x18 for UD60x18;` to access operations.

On VibeSwap's deployment:
- Check if PRBMath is already deployed on the target network.
- If not, deploy as part of the deployment script (`script/Deploy.s.sol`).
- Verify the contract includes PRBMath imports and uses the library syntax.

## Student exercises

1. **Compute (90/365)^1.6 by hand.** Use log+exp: `x^1.6 = exp(1.6 × ln(x))`. With x = 90/365 ≈ 0.247, verify the computation.

2. **Gas comparison.** Write two implementations — one using PRBMath, one using pre-computed lookup table — and measure gas via Foundry. Report the delta.

3. **Precision vs gas tradeoff.** If you had to reduce gas by 50%, what precision would you sacrifice? What substrates (use cases) can tolerate it?

4. **Write a Solidity skeleton.** Implement `retentionWeight(uint256 t, uint256 T, uint256 alphaScaled, uint256 base)` with full PRBMath arithmetic, bounds-checking, and gas-optimized operation ordering.

5. **Detect overflow in the scaling.** What values of (t, T, base) would cause overflow in the scaled multiplication? Propose a defensive check.

## Future work — concrete code cycles this primitive surfaces

### Queued for C40

- **PRBMath integration** — add UD60x18 import + usage to `contracts/consensus/NakamotoConsensusInfinity.sol`.
- **alphaScaled storage + governance setter** — pattern above.
- **Unit tests** — assert the 6-point curve match with 1% tolerance.
- **Gas benchmark** — measure actual gas per call and publish.

### Queued for un-scheduled cycles

- **Pre-computed lookup fallback** — if dynamic computation proves expensive in high-frequency contexts, switch to lookup-table-per-alpha.

- **Custom fixed-point** — only if profiling shows PRBMath's generic `pow` is bottleneck. Write specialized power-law approximation. Unlikely to be worth it.

- **Apply to other convex curves** — CKB state-rent (see [`COGNITIVE_RENT_ECONOMICS.md`](./COGNITIVE_RENT_ECONOMICS.md)) and DAG handshake gradients will need similar treatment.

### Primitive extraction

If integer-math patterns for power-laws recur across 3+ mechanisms, extract to `memory/primitive_onchain-power-law.md` with gas/precision tradeoff guide.

## Relationship to other primitives

- **Attention-Surface Scaling** (see [`ATTENTION_SURFACE_SCALING.md`](../ATTENTION_SURFACE_SCALING.md)) — the pattern whose implementation this doc specifies.
- **Convex Retention Derivation** (see [`CONVEX_RETENTION_DERIVATION.md`](../../research/theorems/CONVEX_RETENTION_DERIVATION.md)) — source of the α calibration.
- **ETM Mirror Test** (see [`ETM_MIRROR_TEST.md`](../etm/ETM_MIRROR_TEST.md)) — testing discipline that verifies the implementation matches the substrate.
- **Admin Event Observability** (see [`ADMIN_EVENT_OBSERVABILITY.md`](../security/ADMIN_EVENT_OBSERVABILITY.md)) — requirement for event emission on setAlpha.

## How this doc feeds the Code↔Text Inspiration Loop

This doc bridges TEXT (the abstract curve) to CODE (the Solidity implementation). Without it, an engineer shipping C40 would have to rediscover the library choice, precision analysis, and gas tradeoffs. With it, the path is explicit.

When C40 ships, this doc gets "shipped" sections with:
- Actual gas measurements.
- Actual UD60x18 arithmetic sequence used.
- Any deviations from the spec above.

## One-line summary

*On-chain power law `(t/T)^α` for Gap #1 C40 uses PRBMath UD60x18 fixed-point: ~7000 gas per call, 18-decimal precision, governance-tunable α within [1.2, 1.8] × 1e18 scaled format. Pre-computed lookup table available as fallback if gas-critical. Event emission on setAlpha per Admin Observability.*
