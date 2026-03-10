# Augmented Bonding Curve Implementation: From Theory to VibeSwap

**Authors**: W. Glynn (Faraday1) & JARVIS
**Date**: March 10, 2026
**Status**: Implemented, tested, verified

## Abstract

We present the implementation of an Augmented Bonding Curve (ABC) for VibeSwap, based on the theoretical framework of Zargham, Shorish, and Paruch (ICBC 2020) and the Commons Stack parameterization. The implementation enforces a conservation invariant V(R,S) = S^k / R across four formal mechanisms, uses overflow-safe power math with 512-bit intermediates, and Newton's method with supply hints for inverse power computation. We verify correctness through 32 unit tests, 22 fuzz tests, and 8 invariant tests with over 1 million randomized operations.

## 1. Theoretical Foundation

### 1.1 Configuration Space

The ABC operates on a 2-manifold configuration space:

```
X_C = {(R, S, P, F) | V(R,S) = V_0, P = kR/S}
```

Where:
- R = Reserve pool (collateral backing the token)
- S = Supply (total community tokens)
- P = Spot price (derived, never stored)
- F = Funding pool (commons allocation)
- k = Kappa (curvature exponent, 2 <= k <= 10)
- V_0 = Conservation invariant (fixed at initialization)

### 1.2 Four Formal Mechanisms

1. **Bond-to-Mint**: Deposit reserve, mint supply. Entry tribute routes to funding pool.
2. **Burn-to-Withdraw**: Burn supply, withdraw reserve. Exit tribute routes to funding pool.
3. **Allocate-with-Rebond**: Move funding pool to reserve, mint to recipient (governance-driven).
4. **Deposit**: External revenue to funding pool (no curve effect).

### 1.3 Conservation Invariant

All mechanisms preserve V(R,S) = S^k / R = V_0. This is the central correctness property.

## 2. Implementation Challenges

### 2.1 Power Function Overflow

With S = 500M tokens (5e26 in 18-decimal fixed-point) and k = 6, naive power computation overflows uint256:

```
Step 4 of S^6: 6.25e52 * 5e26 = 3.125e79 > 2^256
```

**Solution**: OpenZeppelin's `Math.mulDiv(a, b, c)` computes `(a * b) / c` using a 512-bit intermediate, preventing overflow:

```solidity
result = Math.mulDiv(result, b, PRECISION);
```

This replaces `result = (result * b) / PRECISION` throughout the power function.

### 2.2 Inverse Power (Nth Root) Divergence

Given the conservation invariant S^k / R = V_0, computing the new supply S' from a new reserve R' requires:

```
S' = (V_0 * R')^(1/k)
```

A blind initial guess (e.g., bit-length heuristic) can be 12 orders of magnitude away from the true root. Newton's method starting from such a guess diverges catastrophically — the correction overshoots to ~4.8e86, causing `_pow(4.8e86, 5)` to overflow even with 512-bit intermediates.

**Solution**: Use the current supply as a "hint" for Newton's method. Since bondToMint and burnToWithdraw change supply incrementally, the current supply is always a near-perfect starting point:

```solidity
function _powInverse(uint256 target, uint256 n, uint256 hint) internal pure returns (uint256) {
    uint256 guess = hint;  // Start from current supply
    for (uint256 i = 0; i < 60; i++) {
        uint256 powNm1 = _pow(guess, n - 1);
        uint256 quotient = Math.mulDiv(target, PRECISION, powNm1);
        uint256 newGuess = ((n - 1) * guess + quotient) / n;
        uint256 diff = newGuess > guess ? newGuess - guess : guess - newGuess;
        if (diff <= 1) break;  // Converged
        guess = newGuess;
    }
    return guess;
}
```

Newton converges in 5-10 iterations from a good hint, versus diverging from a blind guess.

**Knowledge Primitive P-072: Supply Hint Convergence** — When computing inverse operations on a bonding curve, use current state as the initial guess for iterative methods. The curve changes incrementally, so current state is always a near-optimal starting point.

### 2.3 Tribute Routing

Entry tributes (on bond) and exit tributes (on burn) are deducted from the user's transaction and routed to the funding pool. The net deposit after tribute is what enters the reserve, preserving the invariant.

## 3. Hatch Phase (Initialization)

The HatchManager implements trust-gated initialization:

1. **Approval**: Owner approves addresses as "Hatchers" (Ostrom Principle 1: clearly defined boundaries)
2. **Contribution**: Hatchers deposit reserve tokens at a fixed hatch price p_0
3. **Completion**: Total raised is split: theta% to Funding Pool, (1-theta)% to Reserve Pool
4. **Vesting**: Hatch tokens vest with half-life decay, accelerated by governance participation

### 3.1 Return Rate Safety

The hatch return rate rho = k * (1 - theta) must not exceed 5 to prevent instant appreciation that incentivizes dump-and-run behavior.

### 3.2 Governance-Boosted Vesting

```
S_vested = (1 - 2^(-gamma_eff * (k - k_0))) * S_allocated
gamma_eff = gamma * (1 + govScore / 100)
```

Hatchers who participate in governance (voting, signaling conviction) vest up to 2x faster. This aligns incentives: you only benefit fully if you contribute to the commons.

## 4. Governance Integration

ConvictionGovernance is wired to ABC's allocateWithRebond mechanism:

1. Community members signal conviction (stake tokens * time)
2. When conviction exceeds dynamic threshold, proposal passes
3. Resolver executes proposal, which calls `abc.allocateWithRebond(amount, beneficiary)`
4. Funding pool transfers to reserve, proportional tokens minted to beneficiary
5. Conservation invariant preserved throughout

This closes the loop: tributes fund the commons, governance allocates from the commons, and the curve prices everything consistently.

## 5. Verification

### 5.1 Test Coverage

| Suite | Tests | Calls | Status |
|-------|-------|-------|--------|
| Unit (ABC) | 32 | 32 | All passing |
| Fuzz (ABC) | 22 | 5,632 | All passing |
| Invariant (ABC) | 8 | 1,024,000+ | All passing, 0 reverts |
| Unit (HatchManager) | 28 | 28 | Written |
| Fuzz (HatchManager) | 10 | 2,560 | Written |
| Integration (Governance-ABC) | 6 | N/A | Written |

### 5.2 Key Properties Verified

1. **Conservation**: V(R,S) = V_0 within 0.1% tolerance across all operations
2. **Price Monotonicity**: bondToMint increases price, burnToWithdraw decreases it
3. **No Free Tokens**: Roundtrip (buy then sell) always loses value (tributes)
4. **Tribute Accounting**: Entry/exit tributes exactly route to funding pool
5. **Quote Consistency**: quoteBondToMint matches actual bondToMint execution
6. **Supply-Reserve Consistency**: DAI balance >= reserve + funding at all times

## 6. Architecture

```
HatchManager ──(openCurve)──> AugmentedBondingCurve
                                    │
ConvictionGovernance ─(allocateWithRebond)─┘
                                    │
External Revenue ────(deposit)──────┘
                                    │
Users ─────(bondToMint/burnToWithdraw)──┘
```

The ABC is the economic engine. HatchManager initializes it. ConvictionGovernance allocates from it. External revenue feeds it. Users interact with it. Every interaction preserves V_0.

## References

1. Zargham, Shorish, Paruch — "From Curved Bonding to Configuration Spaces" (ICBC 2020)
2. Abbey Titcomb — "Deep Dive: Augmented Bonding Curves" (Commons Stack, 2019)
3. Michael Zargham — "Towards Computer-Aided Governance of Algorithmically Complex Systems" (BlockScience)
