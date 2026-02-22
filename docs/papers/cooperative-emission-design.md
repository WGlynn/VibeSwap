# Cooperative Emission Design: Wall-Clock Halving with Shapley Accumulation

**W. Glynn, JARVIS** | February 2026 | VibeSwap Research

---

## Abstract

We present a token emission mechanism that combines Bitcoin-style halving with cooperative game theory distribution. The EmissionController implements wall-clock halving (rate = baseRate >> era) with three distribution sinks: a Shapley accumulation pool for contribution rewards, a liquidity gauge for LP incentives, and a staking reward stream. The accumulation pool creates natural incentive waves by accruing tokens between contribution games, rewarding bursty participation patterns that mirror real value creation. We prove the mechanism satisfies five key invariants and demonstrate correctness through 51 tests including fuzz and invariant testing.

---

## 1. Introduction

### 1.1 The Pre-mine Problem

The dominant token launch model in DeFi follows a pattern: pre-mine tokens, allocate to team/investors/treasury, launch with a fraction available to the public. This creates asymmetric information and incentives — insiders have tokens before the protocol proves value, and their rational strategy is often extraction rather than building.

Bitcoin's innovation was not just proof of work — it was the elimination of this asymmetry. Every bitcoin was earned through computation. The founder mined alongside everyone else. No special allocations. No backdoor deals.

### 1.2 From Mining to Contributing

VIBE extends Bitcoin's principle to contribution-based issuance. Instead of hash computations, VIBE is earned through demonstrated contribution to the cooperative game — liquidity provision, code development, governance participation, market-making during volatility.

The Shapley value [1] provides the mathematical foundation: in a cooperative game, each participant's reward equals their marginal contribution averaged over all possible orderings. This satisfies efficiency (all value distributed), symmetry (equal contributors earn equally), and the null player property (no contribution = no reward).

### 1.3 The Accumulation Insight

Standard reward streaming (Synthetix-style [2]) distributes tokens linearly over time. This rewards time-in-protocol above all else — a liquidity provider who provides $1M for 1 second earns the same rate as one who provides $1M during a market crash.

The accumulation pool introduces a different dynamic: tokens accrue during quiet periods and are distributed in punctuated events. This creates:

- **Incentive waves**: larger pools attract more participation
- **Natural timing**: games happen when there's enough to distribute
- **Anti-mercenary**: can't flash-provide liquidity to capture a stream

---

## 2. Mechanism Design

### 2.1 Emission Rate

The base emission rate R_0 is calibrated to emit approximately half the supply in the first era:

```
R_0 = MAX_SUPPLY / (2 * ERA_DURATION)
    = 21,000,000 * 10^18 / (2 * 31,557,600)
    ≈ 332,880,110,000,000,000 wei/second
```

For era e, the rate is:

```
R(e) = R_0 >> e = R_0 / 2^e
```

The total emission over the full schedule converges to MAX_SUPPLY:

```
Sum_{e=0}^{inf} R(e) * ERA_DURATION = R_0 * ERA_DURATION * Sum_{e=0}^{inf} 1/2^e
                                     = R_0 * ERA_DURATION * 2
                                     = MAX_SUPPLY
```

### 2.2 Cross-Era Accrual

When drip() is called after time spanning multiple eras, the contract computes:

```
pending = Sum_{e=0}^{MAX_ERAS} R(e) * overlap(e, lastDripTime, now)
```

Where:

```
overlap(e, t_last, t_now) = max(0, min(t_now, eraEnd(e)) - max(t_last, eraStart(e)))
eraStart(e) = genesis + e * ERA_DURATION
eraEnd(e) = genesis + (e+1) * ERA_DURATION
```

This loop is bounded at MAX_ERAS = 32 iterations, ensuring O(1) gas regardless of time gap.

### 2.3 Budget Split

Each drip produces amount P, split as:

```
shapleyShare = P * shapleyBps / BPS
gaugeShare = P * gaugeBps / BPS
stakingShare = P - shapleyShare - gaugeShare  (remainder avoids dust)
```

The remainder assignment to staking ensures exact accounting: `shapleyShare + gaugeShare + stakingShare = P` always.

### 2.4 Accumulation Pool Dynamics

The Shapley pool S follows:

```
On drip:  S += shapleyShare
On drain: S -= drainAmount, where drainAmount = S * drainBps / BPS
```

The drain is bounded:

```
minDrainBps / BPS * S <= drainAmount <= maxDrainBps / BPS * S
```

Note the minimum is percentage-based, not absolute. This is critical: an absolute minimum (e.g., 100 VIBE) becomes a barrier under price appreciation ($10,000/VIBE = $1M minimum). A percentage minimum scales naturally with both pool size and token price.

### 2.5 Game Creation

When the pool is drained, the EmissionController:

1. Transfers VIBE to ShapleyDistributor
2. Creates a FEE_DISTRIBUTION game (avoiding double-halving)
3. Immediately settles the game (computes Shapley values)

Using FEE_DISTRIBUTION rather than TOKEN_EMISSION is essential: the EmissionController has already applied wall-clock halving to the emission rate. If the ShapleyDistributor also applied its own game-count halving, the effective reward would be halved twice — punishing contributors unfairly.

---

## 3. Invariants

We prove five invariants that hold at all times:

### 3.1 Supply Cap

**Theorem:** `totalEmitted <= MAX_SUPPLY`

*Proof:* drip() caps pending emissions at `vibeToken.mintableSupply()`, which returns `MAX_SUPPLY - totalSupply()`. The VIBEToken's mint function independently reverts if `totalSupply() + amount > MAX_SUPPLY`. The cap is enforced at two independent layers.

### 3.2 Accounting Identity

**Theorem:** `shapleyPool + totalShapleyDrained + totalGaugeFunded + stakingPending + totalStakingFunded == totalEmitted`

*Proof:* Every VIBE minted in drip() is added to exactly one of {shapleyPool, totalGaugeFunded, stakingPending}. Every VIBE drained from shapleyPool is added to totalShapleyDrained. Every VIBE funded from stakingPending is added to totalStakingFunded. No VIBE is created or destroyed outside these paths.

### 3.3 Solvency

**Theorem:** `VIBE.balanceOf(EmissionController) >= shapleyPool + stakingPending`

*Proof:* drip() mints `pending` VIBE to self, transfers `gaugeShare` to gauge. Remaining in contract: `pending - gaugeShare = shapleyShare + stakingShare`. These are added to shapleyPool and stakingPending respectively. Drains transfer from contract to ShapleyDistributor, decreasing both balance and shapleyPool. Staking funding transfers from contract to SingleStaking, decreasing both balance and stakingPending.

### 3.4 Rate Monotonicity

**Theorem:** `getCurrentRate() <= BASE_EMISSION_RATE`

*Proof:* `getCurrentRate() = BASE_EMISSION_RATE >> era`, where era >= 0. Right-shifting a positive integer by a non-negative amount produces a result <= the original.

### 3.5 Era Bound

**Theorem:** `getCurrentEra() <= MAX_ERAS`

*Proof:* getCurrentEra() explicitly caps: `return era > MAX_ERAS ? MAX_ERAS : era`.

---

## 4. Comparison with Existing Mechanisms

| Mechanism | Pre-mine | Halving | Distribution | Price Dependency |
|-----------|----------|---------|-------------|-----------------|
| Bitcoin | None | Block-count | Mining (PoW) | None |
| Synthetix SNX | 100M pre-mint | None | Staking rewards | None |
| Curve CRV | 3.03B (62% community) | Epoch-based | Gauge voting | None |
| Pendle PENDLE | Pre-allocated | Weekly decay | LP + vePENDLE | None |
| **VIBE** | **None** | **Wall-clock** | **Shapley + Gauge + Staking** | **None** |

Key differentiators:
- **Zero pre-mine** (unlike Curve, Synthetix, Pendle)
- **Shapley-based distribution** (contribution-proportional, not time-proportional)
- **Accumulation pool** (bursty rewards, not linear streaming)
- **Percentage-based minimums** (self-scaling, no oracle dependency)

---

## 5. Implementation

The EmissionController is implemented in Solidity 0.8.20 as a UUPS upgradeable contract. It integrates with:

- **VIBEToken** — ERC20Votes with authorized minters, 21M cap
- **ShapleyDistributor** — Cooperative game theory reward distribution
- **LiquidityGauge** — Curve-style gauge for LP incentives
- **SingleStaking** — Synthetix-style staking rewards

### 5.1 Gas Analysis

| Operation | Gas Cost | Notes |
|-----------|----------|-------|
| drip() (single era) | ~220K | Mint + transfer + storage updates |
| drip() (cross-era) | ~280K | Additional iterations in accrual loop |
| createContributionGame() | ~380K | Transfer + game creation + settlement |
| fundStaking() | ~330K | Approve + notifyRewardAmount |
| pendingEmissions() (view) | ~25K | Pure computation, no state changes |

### 5.2 Test Coverage

51 tests across three suites:
- **38 unit tests**: Function coverage, edge cases, access control, event emission
- **6 fuzz tests** (256 runs each): Time ranges, budget splits, drain bounds, sequential operations
- **7 invariant tests** (256 runs, 128K calls each): All five invariants verified under random call sequences

---

## 6. Conclusion

The EmissionController demonstrates that Bitcoin's emission principles can be extended to contribution-based distribution without sacrificing the zero pre-mine property. The accumulation pool creates a natural incentive cycle that rewards genuine participation over passive holding. Percentage-based drain minimums ensure the mechanism remains functional regardless of price appreciation, without introducing trusted third parties.

The mechanism is fully permissionless in operation (anyone can drip, anyone can fund staking) while maintaining authorization for value-directing operations (only authorized drainers can create contribution games). This separation ensures the protocol runs automatically while preventing unauthorized value extraction.

---

## References

[1] L. S. Shapley, "A Value for n-Person Games," in *Contributions to the Theory of Games*, vol. II, H. W. Kuhn and A. W. Tucker, Eds. Princeton University Press, 1953, pp. 307-317.

[2] Synthetix, "SIP-31: sETH LP Reward Contract," 2019.

[3] S. Nakamoto, "Bitcoin: A Peer-to-Peer Electronic Cash System," 2008.

[4] M. Egorov, "Curve DAO Token Distribution," Curve Finance, 2020.

---

*VibeSwap Research — Building the practices that will define the future of development.*
