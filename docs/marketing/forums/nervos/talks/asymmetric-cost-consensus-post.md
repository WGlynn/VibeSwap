# Asymmetric Cost Consensus: Making Cooperation Cheaper Than Attack

**Authors:** Faraday1 & JARVIS -- vibeswap.io
**Date:** March 2026

---

## TL;DR

We designed a consensus model where **honest participation gets cheaper over time while attacking stays expensive**. Traditional consensus (PoW, PoS) is memoryless -- a 5-year honest validator pays the same cost as a day-one attacker. Our model composes three independent cost dimensions (Proof of Work, Proof of Mind, Proof of Stake) into a multiplicative cost surface where cooperation earns compounding discounts and attack earns nothing. The result: a flywheel that drops the viral threshold from ~10,000 participants (PoW) to ~30 participants (3D model). We think CKB's cell model is the natural substrate for encoding this cost surface, and this post explains why.

**Full paper:** [Asymmetric Cost Consensus: Making Cooperation Cheaper Than Attack](../../../../research/papers/asymmetric-cost-consensus.md)

---

## The Symmetry Problem

Every consensus mechanism you know is symmetric. The cost of defending the network equals the cost of attacking it.

In Proof of Work:

```
Cost_honest = Cost_attack = f(hash_rate * energy_price * time)
```

In Proof of Stake:

```
Cost_honest = Cost_attack = f(stake * opportunity_cost * time)
```

There is no learning curve. No reputation. No compounding. A miner who has been honest for five years pays the same electricity bill as a miner who joined yesterday. The cost function is **memoryless** -- history provides zero advantage.

This means there is no flywheel. Each new participant adds linear security but creates no superlinear incentive for others to join. The viral threshold -- the number of participants where growth becomes self-sustaining -- is determined entirely by external subsidies: block rewards, MEV, staking yield. Take away the subsidies and growth stalls.

---

## Breaking Symmetry: The 3D Cost Surface

Our model introduces an asymmetric cost function where the honest-to-attack cost ratio approaches zero over time:

```
Cost_honest(t) = Base_cost * D(reputation(t))     where D < 1 for reputation > 0
Cost_attack(t) = Base_cost * A(sybil_overhead(t))  where A > 1 for sybil networks

lim(t -> infinity) Cost_honest(t) / Cost_attack(t) -> 0
```

The mechanism composes three orthogonal dimensions:

### Dimension 1: Proof of Work (Computational)

Standard Sybil resistance. Every participant demonstrates computational work. Purchasable (you can rent hash power), but computation without contribution earns nothing. Necessary but not sufficient.

### Dimension 2: Proof of Mind (Cognitive)

This is where asymmetry lives. A mind contributing for 6 months accumulates:

- **ContributionDAG trust edges** -- bidirectional vouches from established participants, 15% decay per hop
- **Shapley history** -- marginal contribution measurements over time
- **SoulboundIdentity XP** -- non-transferable experience: code (100 XP), proposals (50 XP), posts (10 XP), replies (5 XP)
- **VibeCode fingerprint** -- behavioral signature derived from full contribution history

The critical property: **PoM is not purchasable.** You cannot buy 6 months of coherent cognitive contribution. You cannot rent a trust graph. You cannot flash-loan a reputation score. The cost of faking PoM converges to the cost of actually contributing -- which is the cost of being honest. Attempted fakery converges to honest participation.

### Dimension 3: Proof of Stake (Economic)

Standard PoS with capital at risk of slashing. Purchasable but lossable.

### The Multiplicative Composition

An attacker must simultaneously sustain cost across all three dimensions:

```
Cost_attack = PoW_cost * PoM_cost * PoS_cost
```

Because PoM_cost grows over time (maintaining fake identities gets harder as the trust graph deepens), total attack cost grows even when PoW and PoS costs stay flat. Meanwhile, honest cost gets a reputation discount:

```
Cost_honest = PoW_cost * (1 / (1 + log(reputation))) * PoS_cost
```

The resulting divergence:

```
Time=0:   Cost_honest ~ Cost_attack     (new participant, no reputation)
Time=6mo: Cost_honest ~ 0.6 * Cost_attack
Time=1yr: Cost_honest ~ 0.4 * Cost_attack
Time=2yr: Cost_honest ~ 0.3 * Cost_attack
```

---

## The Progressive Difficulty Discount

The core mechanism: honest participants earn a computational discount proportional to their accumulated PoM score.

```
difficulty(participant) = base_difficulty / (1 + alpha * log(1 + reputation_score))
```

Where `alpha = 0.5` by default. This gives:

- **Newcomer (score 0)**: Full difficulty (divisor = 1)
- **Active contributor (score 100)**: ~77% reduction
- **Veteran**: Diminishing returns (never reaches zero)

The security budget doesn't shrink because newcomers compensate for veteran discounts. If the network has N participants with average reputation R_avg:

```
Lower cost -> More participants -> Higher total security -> More trust edges
-> Higher average reputation -> Even lower individual cost -> Even more participants
```

The discount is not a subsidy. It is the economic recognition that **reputation is security**. A contributor who has earned reputation is providing ongoing security through their trust edges, their Shapley contributions, and their vested interest in the network's continued health.

### Why Sybils Can't Exploit the Discount

1. **Reputation requires trust edges** -- BFS from founders with 15% decay. Sybil cluster with no founder edges = score 0 = full difficulty.
2. **Trust edges require genuine relationships** -- circular vouch rings between Sybils are detected by diversity scoring (>80% mutual vouches = up to 100% penalty).
3. **XP requires content-hashed contributions** -- spamming low-quality messages yields 5 XP per reply vs. 100 XP per code contribution.
4. **Shapley requires marginal contribution** -- free-riders receive Shapley approximately 0.

---

## Reputation Staking: Where the Asymmetry Bites

Traditional PoS slashes tokens. We extend slashing to three dimensions:

1. **Token slash** -- standard capital loss
2. **Reputation slash** -- ContributionDAG trust score reduction + XP penalty
3. **Difficulty reset** -- progressive difficulty discount reverts to base (full cost)

The reputation slash is uniquely punitive because **reputation is not rebuyable**. A slashed participant must rebuild their trust graph from scratch. Years of relationship-building destroyed in one act.

The asymmetric loss property:

```
E[cost_honest] ~ 0              (honest behavior doesn't trigger slashing)
E[cost_attack] ~ reputation_value (attack = detection = slash)
```

Honest participants hold reputation at essentially zero expected cost. Attackers face guaranteed total loss. This creates natural selection: over time, only honest participants accumulate reputation, and the reputation pool becomes increasingly trustworthy.

---

## The Viral Threshold Drops by 10x

Traditional consensus needs thousands of participants to become self-sustaining. The 3D model needs approximately 30:

| Mechanism | Viral Threshold (n*) | Flywheel Speed |
|-----------|---------------------|----------------|
| PoW only | ~10,000 miners | None (linear security) |
| PoS only | ~1,000 validators | Slow (staking yield) |
| PoM only | ~100 contributors | Medium (reputation compounds) |
| PoW+PoM+PoS | ~30 contributors | Fast (3D compounding) |

Each contributor in the 3D model simultaneously adds security (PoW), adds unique capability and trust edges (PoM), adds economic commitment (PoS), receives progressive cost reduction, and creates new niches for future contributors. The threshold keeps shrinking as the network matures because new contribution dimensions always exist -- the contribution space never saturates.

---

## Why CKB Is the Right Substrate

### Cost Surface as Cell State

On CKB, each participant's position on the 3D cost surface can be represented as a **cell** containing their PoW contribution, PoM score, and PoS lockup. The type script enforces the logarithmic discount function on-chain. This makes the cost surface inspectable, verifiable, and composable -- not buried in contract storage slots like on EVM chains.

A reputation discount cell could look like:

```
Cell {
    data: { pow_contribution, mind_score, stake_amount, discount_factor }
    type_script: AsymmetricCostVerifier   // enforces discount formula
    lock_script: IdentityLock             // bound to SoulboundIdentity
}
```

### Multiplicative Verification in RISC-V

CKB's RISC-V VM handles the multiplicative cost computation natively. Verifying that `Cost_attack = PoW * PoM * PoS` and computing `D(reputation)` involves logarithmic and multiplication operations that RISC-V executes cleanly. No EVM opcode gymnastics required.

### State Economics Enforce Participation

CKB's state rent model naturally handles the "dead reputation" problem. Reputation cells occupy real CKBytes. Active participants maintain their cells and earn discounts. Inactive participants see their state become reclaimable. The cost surface stays clean without garbage collection.

### PoW-Anchored Temporal Security

The progressive difficulty discount depends on temporal ordering -- contributions must be sequenced honestly for the reputation score to be trustworthy. CKB's PoW consensus provides Bitcoin-class temporal guarantees. No sequencer can backdate a reputation update. No validator committee can reorder contributions to benefit allies.

### Shapley Distribution via Cell Composition

The Shapley cooperation rebate maps to CKB cell composition. Each participant's marginal contribution can be computed from the set of cells they've influenced, and the Shapley distribution can reference those cells directly in the settlement transaction. The cell model makes cooperative game theory a natural transaction shape.

---

## Discussion Questions

1. **Discount calibration**: The logarithmic discount function (`alpha = 0.5`) was chosen for reasonable diminishing returns. What discount curves would the CKB community consider appropriate? Should alpha be governance-adjustable?

2. **Cross-chain reputation**: The 3D cost surface is chain-specific. Could CKB serve as a canonical settlement layer for reputation scores earned on multiple chains, with Merkle proofs enabling cross-chain discount verification?

3. **Cold start**: At time=0, all participants are new -- the cost surface is symmetric. What CKB-native bootstrapping mechanisms (e.g., founder trust edges, initial PoW mining, early contributor bonuses) would best accelerate the divergence?

4. **Cell contention**: In a high-throughput scenario, many participants update their reputation cells simultaneously. How should CKB's cell model handle concurrent reputation updates -- shared cells with PoW locks, or individual cells with batch aggregation?

5. **Flywheel metrics**: We claim the viral threshold drops to ~30 participants. What observable CKB metrics (cell creation rate, trust edge density, discount factor distribution) would constitute evidence that the flywheel is active?

6. **AI agent discounts**: AI agents contribute at machine speed. Should the progressive discount have different temporal parameters for AI participants, or does the logarithmic scaling already handle the throughput difference naturally?

---

## Further Reading

- **Full paper**: [Asymmetric Cost Consensus](../../../../research/papers/asymmetric-cost-consensus.md)
- **Proof of Mind**: [Proof of Mind consensus post](proof-of-mind-post.md)
- **Shapley distribution**: [Shapley Distribution on CKB](shapley-distribution-post.md)
- **CKB integration**: [Nervos and VibeSwap Synergy](nervos-vibeswap-synergy.md)
- **Source code**: [github.com/WGlynn/VibeSwap](https://github.com/WGlynn/VibeSwap)

---

Fairness Above All. -- P-000, VibeSwap Protocol
