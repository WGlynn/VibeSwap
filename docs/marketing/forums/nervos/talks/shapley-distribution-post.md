# Shapley Value Distribution: Fair Reward Allocation Through Cooperative Game Theory

*Nervos Talks Post -- Faraday1*
*March 2026*

---

## TL;DR

Every DEX distributes trading fees proportionally to capital deposited. This is unfair. The bootstrapper who enters an empty pool and absorbs initial volatility gets the same per-unit reward as the whale who shows up after the market stabilizes. We built the first on-chain Shapley value distributor -- a cooperative game theory mechanism that rewards *marginal contribution*, not just presence. And CKB's cell model turns out to be the ideal substrate for it.

---

## The Problem Nobody Talks About

Here is a scenario that plays out on every AMM, every day:

1. Alice provides 10 ETH to a new pool. She is the first LP. Without her, the pool does not exist.
2. The pool attracts traders. Fees accumulate. Alice absorbs volatility.
3. Three months later, Bob deposits 1,000 ETH. The pool is now mature and stable. Bob's risk is minimal.
4. Fees are distributed pro-rata. Bob earns 99x Alice's reward because he has 99x the capital.

Is this fair? Alice enabled the pool to exist. Bob arrived after the hard part was over. Pro-rata distribution measures *presence* (how much capital is in the pool) but ignores *contribution* (how much value that capital created).

This is not an edge case. It is the default outcome of every fee distribution mechanism in DeFi today.

---

## The Shapley Value: A 70-Year-Old Solution

In 1953, Lloyd Shapley proved that there is exactly one distribution function that satisfies four fairness axioms simultaneously. It is called the Shapley value, and it measures the average marginal contribution of each participant across all possible coalition orderings.

The intuition comes from the "glove game":

- A left glove alone = worthless
- A right glove alone = worthless
- A pair = $1

Neither player "deserves" the whole dollar. The Shapley value splits it 50/50. Value exists *only because of cooperation*.

In a batch auction with 80% buy orders and 20% sell orders, the sell-side LPs are the "right gloves." Without them, nothing executes. Pro-rata gives them 20% of fees. Shapley recognizes their enabling contribution and gives them more.

---

## Five Axioms, On-Chain

Our `ShapleyDistributor.sol` satisfies five formal axioms:

| Axiom | What It Means | How It's Enforced |
|-------|--------------|-------------------|
| **Efficiency** | All value is distributed, none wasted | Remainder-to-last pattern prevents dust loss |
| **Symmetry** | Equal contributors = equal rewards | Identical inputs produce identical weights |
| **Null Player** | No contribution = no reward | `NoReward` revert for zero-weight participants |
| **Pairwise Proportionality** | Reward ratio = contribution ratio | Cross-multiplication verification on-chain |
| **Time Neutrality** | Same work = same fee reward, regardless of when | Two-track split: fees are neutral, emissions halve |

The fifth axiom (Time Neutrality) is our extension. It states that for fee distribution, identical contributions must yield identical rewards regardless of when the game occurs. Token emissions intentionally violate this through Bitcoin-style halving -- a bootstrapping incentive, not a fairness claim.

---

## How It Works: Four Dimensions of Contribution

We decompose each participant's contribution into four weighted dimensions:

```
weightedContribution =
    directContribution  * 40%   (raw liquidity/volume)
  + timeScore           * 30%   (enabling: how long in pool)
  + scarcityScore       * 20%   (providing the scarce side)
  + stabilityScore      * 10%   (staying during volatility)
```

### Direct (40%)
Raw capital or volume. The baseline.

### Enabling (30%)
Logarithmic time scaling: `log2(days + 1) * 0.1`. One day = 1x. Seven days = 1.9x. Thirty days = 2.7x. A year = 4.2x. The first week matters more than the next month -- because early liquidity is structurally more enabling.

### Scarcity (20%)
The glove game on-chain. In an imbalanced batch, the scarce side scores higher (up to 7500 BPS vs. 2500 BPS for the abundant side). Major contributors to the scarce side get an additional bonus of up to 1000 BPS.

### Stability (10%)
Did you stay when things got volatile? Liquidity during crashes is worth more than liquidity during calm markets. This dimension rewards presence when it matters most.

---

## Two Tracks: Fees vs. Emissions

A naive system would apply the same distribution to everything. But fee rewards and token emissions serve different purposes:

**Track 1 -- Fee Distribution (Time-Neutral)**
- Trading fees distributed via pure Shapley
- No halving -- same work earns same reward in year 1 or year 10
- Satisfies all five axioms

**Track 2 -- Token Emission (Halving Schedule)**
- Protocol tokens follow Bitcoin-style halving: 100% -> 50% -> 25% -> ...
- `DEFAULT_GAMES_PER_ERA = 52,560` (~1 year at 1 game per 10 minutes)
- `MAX_HALVING_ERAS = 32`
- Bit-shifted for gas efficiency: `INITIAL_EMISSION >> era`
- Intentionally NOT time-neutral (bootstrapping incentive)

The two tracks use the same Shapley computation engine. The only difference is whether `totalValue` is adjusted by halving before distribution.

---

## Anti-MLM by Construction

This is the part that matters most for credibility.

Multi-level marketing fails because rewards compound across levels and eventually exceed real value creation. Shapley distribution is structurally incapable of this:

1. **Efficiency axiom**: `SUM(rewards) = totalValue`. No phantom value is created.
2. **Event-bounded compounding**: Rewards in game G1 do not multiply rewards in game G2. Each game is independent.
3. **Marginal contribution ceiling**: No participant can receive more than their proportional share of totalValue.
4. **No positional advantage**: Two participants with identical contributions get identical rewards, regardless of when they joined.
5. **Revenue-bounded**: Rewards cannot exceed the fees and emissions the protocol actually generates.

**Rewards cannot exceed revenue.** This is the fundamental sustainability constraint that every MLM violates and Shapley distribution enforces mathematically.

---

## On-Chain Fairness Verification

We shipped a `PairwiseFairness` library that lets *anyone* audit the fairness of any settled game on-chain. Four verification functions:

**Pairwise Proportionality**: `|rewardA * weightB - rewardB * weightA| <= tolerance`
Uses cross-multiplication to avoid division-by-zero. Anyone can check whether two participants' reward ratio matches their contribution ratio.

**Time Neutrality**: `|reward_game1 - reward_game2| <= tolerance`
For identical contributions in two fee distribution games, rewards must match.

**Efficiency**: `|SUM(allocations) - totalValue| <= tolerance`
All value must be distributed.

**Null Player**: If weight is zero, reward must be zero.

The `verifyAllPairs` function checks every pair in O(n^2) -- designed for dispute resolution. If you believe your allocation is unfair, you can prove it cryptographically on-chain.

---

## Trust Integration: ContributionDAG

Shapley without identity is vulnerable to Sybil attacks (splitting liquidity across wallets to game scarcity scores). Our `ContributionDAG` contract provides the defense:

- Users vouch for each other; bidirectional vouches form "handshakes"
- BFS from founder nodes computes trust scores with 15% decay per hop
- Max depth: 6 hops. Max vouches per user: 10.
- Trust scores feed into Shapley quality weights

A Sybil attacker with fresh wallets gets a 0.5x quality multiplier (minimum). A trusted participant with vouches gets up to 1.5x. This makes splitting unprofitable unless the attacker controls the trust graph itself.

---

## Why CKB Is the Natural Substrate

This is what I want the Nervos community to think about.

### Contribution Events as Cells

On CKB, each contribution event maps to a cell. Each scoring dimension (direct, enabling, scarcity, stability) can be an independent cell with its own type script. They compose at the transaction level:

| Shapley Concept | CKB Representation |
|----------------|--------------------|
| Cooperative game | Transaction consuming inputs, producing reward cells |
| Participant contribution | Cell data with four scoring dimensions |
| Quality weight | Separate cell, type script enforces update rules |
| Trust score | ContributionDAG cell, lock script requires vouch verification |
| Shapley value | Output cell with calculated reward |

### Off-Chain Compute, On-Chain Verify

CKB's model is "compute off-chain, verify on-chain." For Shapley distribution, this is transformative:

- **Off-chain**: Compute exact Shapley values (O(2^n) or Monte Carlo approximation)
- **On-chain**: Verify the result satisfies all five axioms via type scripts using `PairwiseFairness` checks
- If verification fails, the transaction is rejected -- no invalid distribution is committed

This enables *exact* Shapley computation for games with up to ~30 participants, since the computational constraint moves off-chain while verification remains O(n^2) on-chain. On EVM, we are limited to the O(n) weighted approximation because both compute and verify happen on-chain.

### UTXO Parallelism

Games touching different pools operate on disjoint cell sets and can be settled in parallel transactions. On EVM, all games share the same contract storage, creating sequential bottlenecks.

### Since-Based Temporal Scoring

The enabling dimension (time-in-pool) maps naturally to CKB's `Since` field. A cell that represents an LP position can only be consumed after the lock script's timelock expires. The temporal scoring is *structural* (enforced by the substrate) rather than *conditional* (enforced by `require` checks that can be bypassed).

---

## The Numbers

From `ShapleyDistributor.sol`:

| Constant | Value | Purpose |
|----------|-------|---------|
| `PRECISION` | 1e18 | Fixed-point arithmetic scale |
| `BPS_PRECISION` | 10000 | Basis points scale |
| `DIRECT_WEIGHT` | 4000 (40%) | Raw liquidity provision |
| `ENABLING_WEIGHT` | 3000 (30%) | Time-based enabling |
| `SCARCITY_WEIGHT` | 2000 (20%) | Scarce-side provision |
| `STABILITY_WEIGHT` | 1000 (10%) | Volatility persistence |
| `PIONEER_BONUS_MAX_BPS` | 5000 (50%) | Max pioneer multiplier bonus |
| `LAWSON_FAIRNESS_FLOOR` | 100 (1%) | Minimum reward share |
| `DEFAULT_GAMES_PER_ERA` | 52,560 | ~1 year of games |
| `MAX_HALVING_ERAS` | 32 | Emission approaches zero |
| `maxParticipants` | 100 | On-chain computation limit |

---

## Comparison

| Property | Pro-Rata | Time-Weighted | Quadratic Funding | **Shapley** |
|----------|---------|---------------|-------------------|-------------|
| Measures | Presence | Presence * time | Breadth of support | **Marginal contribution** |
| Enabling recognition | None | Partial | None | **30% weight** |
| Scarcity recognition | None | None | None | **20% weight** |
| Sybil resistance | None | None | Low | **Trust-weighted** |
| On-chain verifiable | Trivial | Trivial | Matching only | **All 5 axioms** |
| Anti-MLM | N/A | N/A | By design | **By construction** |
| Computational cost | O(1) | O(1) | O(n) | **O(n)** |

---

## Discussion

Questions for the Nervos community:

1. **CKB-native Shapley patterns.** The off-chain compute / on-chain verify model could enable exact Shapley computation for moderately-sized games. Has anyone explored cooperative game theory verification in type scripts?

2. **Cell-based contribution tracking.** Each LP position as a cell, with type scripts that track time-in-pool and scarcity exposure natively. Is there existing infrastructure for this kind of continuous state tracking on CKB?

3. **Cross-chain Shapley.** VibeSwap is omnichain (LayerZero V2). Contribution events happen on multiple chains. Could CKB serve as the settlement layer where Shapley values are computed and verified, with results bridged back to execution chains?

4. **Governance over weights.** We fixed the weights (40/30/20/10) at deployment. Should they be governable? Our position: fixed parameters prevent governance capture. The community may disagree.

The formal paper is available in our repo: `docs/papers/shapley-value-distribution.md`

---

*"Fairness Above All."*
*-- P-000, VibeSwap Protocol*

*Full paper: [shapley-value-distribution.md](https://github.com/wglynn/vibeswap/blob/master/docs/papers/shapley-value-distribution.md)*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*

---

## See Also

- [Shapley Value Distribution (paper)](../../../../research/papers/shapley-value-distribution.md) — Full paper with five axioms and CKB cell model
- [Shapley Reward System](../../../../concepts/shapley/SHAPLEY_REWARD_SYSTEM.md) — Core Shapley-based reward distribution
- [Cross-Domain Shapley](../../../../concepts/shapley/CROSS_DOMAIN_SHAPLEY.md) — Fair value distribution across heterogeneous platforms
- [Atomized Shapley (paper)](../../../../research/papers/atomized-shapley.md) — Universal fair measurement for all protocol interactions
- [Formal Fairness Proofs](../../../../research/proofs/FORMAL_FAIRNESS_PROOFS.md) — Axiom verification and omniscient adversary proofs
