# Augmented Bonding Curves: Conservation-Invariant Token Economics on CKB

*Nervos Talks Post — W. Glynn (Faraday1)*
*March 2026*

---

## TL;DR

Bonding curves — automated pricing functions that mint tokens when you buy and burn when you sell — are elegant but dangerous. Unaugmented, they're pump-and-dump machines. **Augmented Bonding Curves (ABCs)** add four formal mechanisms (bond-to-mint, burn-to-withdraw, allocate-with-rebond, deposit) that preserve a conservation invariant `V(R,S) = S^k / R = V₀` through every state transition. Entry/exit tributes fund a commons pool. We implemented this with 512-bit intermediate arithmetic, Newton's method for inverse power computation, and verified correctness through 62 tests including fuzz and invariant suites with 1M+ randomized operations. CKB's cell model makes conservation invariants *structural* rather than computational — the type script enforces `V₀` preservation, making invariant violations not just detectable but impossible to construct.

---

## The Problem with Raw Bonding Curves

A bonding curve prices tokens algorithmically: `P = f(S)` where P is price and S is supply. Buy tokens → supply increases → price rises. Sell → supply decreases → price falls. Sounds fair.

In practice, raw bonding curves create:

```
Early buyer advantage:     First movers get lowest price, dump on latecomers
Flash loan attacks:        Borrow → buy → inflate → sell → repay → profit
No commons funding:        100% of value captured by speculators, 0% for builders
Reserve drainage:          Coordinated sell-off can empty the reserve pool
```

Every raw bonding curve is a pump-and-dump waiting to happen. Friend.tech proved this — their bonding curve crashed 98% because there was no mechanism preventing extraction.

---

## The Augmented Bonding Curve

Based on Zargham, Shorish, and Paruch (ICBC 2020), our ABC operates on a 2-manifold configuration space:

```
X_C = {(R, S, P, F) | V(R,S) = V₀, P = kR/S}
```

- **R** = Reserve pool (collateral backing)
- **S** = Supply (total tokens)
- **P** = Spot price (derived, never stored)
- **F** = Funding pool (commons allocation)
- **k** = Kappa (curvature exponent, 2 ≤ k ≤ 10)

### Four Formal Mechanisms

**1. Bond-to-Mint**: Deposit reserve → mint supply. Entry tribute (e.g., 5%) routes to funding pool.
```
R' = R + deposit - tribute
S' = (V₀ × R')^(1/k)
F' = F + tribute
```

**2. Burn-to-Withdraw**: Burn supply → withdraw reserve. Exit tribute routes to funding pool.
```
S' = S - burned
R' = S'^k / V₀
withdrawal = R - R' - tribute
```

**3. Allocate-with-Rebond**: Move funding to reserve, mint to recipient (governance-driven).

**4. Deposit**: External revenue to funding pool (no curve effect).

### The Conservation Invariant

All four mechanisms preserve `V(R,S) = S^k / R = V₀`. This is the central correctness property. Every state transition must land back on the invariant manifold. If it doesn't, the mechanism is broken.

---

## Implementation: Fighting Overflow at 256 Bits

With S = 500M tokens (18-decimal fixed-point) and k = 6:

```
Step 4 of S^6: 6.25e52 × 5e26 = 3.125e79 > 2^256  ← OVERFLOW
```

**Solution**: OpenZeppelin's `Math.mulDiv(a, b, c)` computes `(a × b) / c` using 512-bit intermediates:

```solidity
result = Math.mulDiv(result, b, PRECISION);
```

For inverse power (nth root), we use Newton's method with supply hints:

```solidity
function _nthRoot(uint256 value, uint256 n, uint256 hint) internal pure returns (uint256) {
    uint256 x = hint > 0 ? hint : value;
    for (uint256 i = 0; i < 100; i++) {
        uint256 xNew = ((n - 1) * x + value / _pow(x, n - 1)) / n;
        if (_withinTolerance(x, xNew)) return xNew;
        x = xNew;
    }
}
```

The supply hint dramatically reduces Newton iterations — from ~80 down to 3-5 — because the previous supply is always close to the next supply for reasonable trades.

### Verification

```
Unit tests:      32 (all mechanisms, edge cases, revert conditions)
Fuzz tests:      22 (random inputs to bond/burn/allocate)
Invariant tests: 8 (V₀ preservation across 1M+ random operations)
```

Zero failures. The conservation invariant held across every randomized state transition.

---

## Why CKB Is the Natural Home for Bonding Curves

### Conservation as Cell Property

On Ethereum, the conservation invariant is a `require()` check:

```solidity
require(newSupply ** k / newReserve == V0, "Invariant violated");
```

If you miss this check in one code path, the invariant breaks silently.

On CKB, the bonding curve state is a cell:

```
BondingCurve Cell {
  capacity: [reserve R in CKB]
  data: [supply S, kappa k, V₀, funding_pool F]
  type_script: abc_validator  // Enforces V(R,S) = V₀
}
```

The type script validates every state transition against the conservation invariant. There is no code path that can modify R or S without the type script verifying `V₀` preservation. The invariant isn't checked — it's **enforced by the substrate**.

### Tribute as Cell Split

Entry/exit tributes on Ethereum require careful accounting across storage slots. On CKB, a tribute is a cell split:

```
Input:  BondingCurve Cell (R, S, F)
Output: BondingCurve Cell (R', S', F) + Tribute Cell (tribute amount)
```

The tribute amount is visible, auditable, and can be independently verified by inspecting the transaction outputs. No hidden accounting.

### Funding Pool as Independent Cell

The commons funding pool is a separate cell governed by the DAO:

```
FundingPool Cell {
  capacity: [accumulated tributes]
  type_script: dao_governed
  lock_script: multisig or conviction_vote
}
```

This cell is independent from the bonding curve cell. The DAO can allocate funds (allocate-with-rebond) without any coupling to the curve's internal state beyond the type script validation.

### Overflow Safety at the VM Level

CKB-VM operates on RISC-V, which natively supports arbitrary-precision arithmetic through library calls. The 512-bit intermediate computation that requires OpenZeppelin's specialized `mulDiv` on the EVM is a straightforward library function on CKB-VM. No special tricks needed.

---

## The Anti-Extraction Properties

The ABC satisfies all three IIA conditions:

| IIA Condition | How ABC Satisfies It |
|---|---|
| Extractive Strategy Elimination | Entry/exit tributes make pump-and-dump unprofitable. Conservation invariant prevents reserve drainage. |
| Uniform Treatment | Same tribute rate, same curve, same mechanisms for every participant. |
| Value Conservation | All tribute flows to the commons. No protocol extraction. No intermediary rent. |

The conservation invariant is the mathematical embodiment of "no value created or destroyed" — only transformed between reserve, supply, and funding pool.

---

## Open Questions for Discussion

1. **Kappa optimization on CKB**: The curvature parameter k determines how steeply the curve rises. Could CKB cells store historical price data to enable adaptive kappa that responds to market conditions?

2. **Multi-currency bonding curves**: CKB's cell model naturally supports multiple asset types. Could a bonding curve accept multiple reserve currencies simultaneously, each in its own cell?

3. **Composable curves**: If Curve A's output token is Curve B's input reserve, you get a curve pipeline. Could CKB's cell references make curve composition a first-class primitive?

4. **Governance over allocation**: The allocate-with-rebond mechanism is governance-driven. What CKB-native governance patterns would best control this powerful mechanism?

5. **Formal verification on RISC-V**: CKB-VM's RISC-V base means existing formal verification toolchains (SAIL, riscv-formal) could potentially verify the bonding curve type script. Has anyone explored this?

---

## Further Reading

- **Full paper**: [augmented-bonding-curve-implementation.md](https://github.com/wglynn/vibeswap/blob/master/docs/papers/augmented-bonding-curve-implementation.md)
- **Related**: [Augmented Mechanism Design](https://github.com/wglynn/vibeswap/blob/master/docs/papers/augmented-mechanism-design.md)
- **Code**: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)

---

*"Fairness Above All."*
*— P-000, VibeSwap Protocol*
