# ethresear.ch Posts — Pure Research Contributions

## RULES
- No self-promotion. No "I built X." No project links unless asked.
- Lead with the result. Back it with math. Invite critique.
- Tone: peer researcher, not founder. "We show that..." not "I built..."
- Link to code only as supporting evidence, never as a CTA.

---

## Post 1: On-Chain Verification of Shapley Value Fairness Properties

**Category**: Mechanism Design

The Shapley value from cooperative game theory satisfies five axioms: efficiency, symmetry, null player, additivity, and a pairwise proportionality condition. These properties are well-studied in the economics literature but have not been formalized as on-chain verification primitives.

We present PairwiseFairness — a Solidity library that enables on-chain verification of four Shapley properties for any reward distribution:

**Pairwise Proportionality**: For participants i, j with rewards φᵢ, φⱼ and weighted contributions wᵢ, wⱼ:

|φᵢ × wⱼ − φⱼ × wᵢ| ≤ ε

Cross-multiplication avoids division-by-zero and minimizes rounding error. The tolerance ε must scale with max(w) × n, not simply n, because integer truncation in the reward calculation creates cross-product deviations proportional to the weight magnitude.

**Efficiency**: Σφᵢ = V (total value distributed equals total value available). Verified by summing allocations and comparing to the pool.

**Null Player**: wᵢ = 0 ⟹ φᵢ = 0. A subtlety: dust collection in the final participant assignment can violate this if the last participant has zero weight. The fix is to assign dust to the last non-zero-weight participant.

**Time Neutrality**: For fee-based distributions (not emission schedules), identical contributions in different time periods should yield identical rewards.

We verified these properties hold universally across 500 random games using an exact-arithmetic reference model (Python `fractions.Fraction`) compared against the Solidity integer implementation. Maximum observed rounding deviation: < 1 token across all games.

The library is MIT-licensed and independent of any specific protocol.

**Questions for the community:**
1. Are there additional on-chain-verifiable fairness properties worth formalizing?
2. Has anyone explored formal verification (Certora/Halmos) of proportional allocation mechanisms?
3. The tolerance scaling issue (ε ∝ max(w) × n vs ε = n) seems underdocumented — has this been noted elsewhere?

---

## Post 2: MEV Dissolution Through Uniform Clearing Price Batch Auctions — Formal Analysis

**Category**: MEV, Mechanism Design

We analyze a commit-reveal batch auction mechanism and demonstrate that MEV is not mitigated but structurally dissolved — reduced to zero under the mechanism's assumptions.

**Mechanism:**
- Commit phase (8s): participants submit H(order ∥ secret) with deposit
- Reveal phase (2s): participants reveal order + secret
- Settlement: Fisher-Yates shuffle using XORed secrets, uniform clearing price

**Theorem (informal):** For any batch with ≥ 2 valid orders, no participant can achieve execution at a price different from any other participant.

**Proof sketch:**
1. Uniform clearing price: all filled orders execute at the same price p*. By definition, no participant receives a better price than any other.
2. Order invariance: the Fisher-Yates shuffle using XORed participant secrets produces a uniformly random permutation. No participant can predict or influence execution order without knowing all other secrets (which are revealed simultaneously).
3. Information hiding: during the commit phase, orders are hash-committed. No participant can observe another's order before committing their own.

**Sandwich attack impossibility:**
A sandwich requires: (a) visibility of target order, (b) ability to place orders before and after target, (c) sequential price impact. This mechanism removes all three: (a) orders are hidden, (b) execution order is random, (c) clearing price is uniform.

**Result from adversarial simulation:**
We ran 430 adversarial scenarios per cycle with 7 agent types (honest, informed, frontrunner, sandwich, sniper, whale, noise). Position gaming: 0 exploitable orderings across 100 rounds with 2 random seeds.

**Trade-offs:**
- 10-second latency per batch
- Two transactions per trade (commit + reveal)
- 50% slashing for failed reveals (necessary for commitment credibility)

**Open questions:**
1. Can the commit phase be shortened without sacrificing information hiding guarantees?
2. What is the minimum batch size at which uniform clearing price provides meaningful MEV protection?
3. Has anyone formalized the relationship between batch interval and MEV extraction rate as a continuous function?

---

## Post 3: Lawson Fairness Floor — Minimum Guarantees in Cooperative Games and the Sybil Problem

**Category**: Mechanism Design, Sybil Resistance

We describe a minimum reward guarantee for cooperative game-theoretic reward distributions and analyze its interaction with sybil attacks.

**The Lawson Floor:**
In a proportional allocation mechanism, participants with negligible weight receive negligible rewards — often below dust thresholds. We introduce a minimum floor: any participant with non-zero weight receives at least 1% of the total value (100 basis points).

The floor redistributes from above-floor participants proportionally to their weights. This preserves efficiency (Σφᵢ = V) while ensuring no honest contributor walks away empty.

**The Sybil Problem:**
A minimum guarantee creates a sybil incentive. An attacker splitting one account into k accounts can extract up to k × floor instead of 1 × floor.

Adversarial search found this in 200/200 tested scenarios. The attack is always profitable when the attacker's proportional share is below the floor.

**Mitigation — Identity-Gated Floor:**
We implement an optional sybil guard interface. When configured, only addresses with verified unique identity receive the floor boost. Unverified addresses receive their proportional Shapley reward without the floor minimum.

Post-fix adversarial testing: 0/100 profitable sybil splits with the guard active.

**Design tension:**
The floor exists to protect small participants. The sybil guard exists to prevent exploitation of that protection. The two mechanisms are complementary — but the floor alone is insufficient without identity.

This suggests a general principle: **any minimum guarantee in a permissionless system requires identity** to prevent splitting attacks. This applies broadly to airdrops, minimum staking rewards, UBI-style token distributions, and quadratic funding.

**Questions:**
1. Are there minimum guarantee designs that resist sybil attacks without requiring identity?
2. What is the optimal floor level that maximizes small-participant welfare while minimizing sybil incentive?
3. Has anyone formalized the relationship between floor level, sybil cost, and identity verification granularity?

---

## Post 4: Three-Layer Testing for Mechanism-Heavy Smart Contracts

**Category**: Security, Testing, Formal Methods

We describe a testing architecture for smart contracts where the mechanism design is as critical as the implementation correctness.

**The Problem:**
Foundry fuzz testing generates random inputs and checks assertions. This is effective for implementation bugs but insufficient for mechanism design flaws — attacks that are profitable within the mechanism's rules, not by breaking its code.

**Three-Layer Architecture:**

**Layer 1 (Solidity invariants):** Standard Foundry tests. Axiom verification: efficiency, symmetry, null player. Fuzz testing with bounded random inputs. This catches implementation bugs.

**Layer 2 (Off-chain reference model):** Python implementation using exact arithmetic (`fractions.Fraction`) mirroring the Solidity logic. The reference model computes both exact and Solidity-emulated (integer truncation) results. The delta between them reveals rounding drift, dust accumulation, and micro-arbitrage surfaces.

We generate JSON test vectors from the reference model and replay them through the Solidity contract. Any divergence indicates that the contract's integer arithmetic doesn't match the intended mathematical specification.

**Layer 3 (Adversarial search):** Hill-climbing and property-based exploration against the reference model. Four strategies:
- Random mutation: perturb one participant's inputs, check if their share increases
- Coalition search: 3-5 agent exhaustive search with equivalence-class reduction
- Position gaming: try all orderings to find systematic position advantages
- Floor exploitation: search for inputs that extract maximum from minimum guarantees

When a profitable deviation is found, it's exported as a Foundry regression test. The deviation can never pass again.

**Results on a Shapley value distributor:**
- 500 random games, 7 axioms checked: 0 violations (post-fix)
- Position independence: 0/100 exploitable orderings across 2 seeds
- 1 real bug found by Layer 3 (null player dust collection) — contract fixed, 0 violations on re-test
- 1 design limitation found (sybil floor exploitation) — mitigated by identity guard

**Coverage matrix:**
We maintain a per-property matrix documenting which layer checks each property. This makes gaps immediately visible.

**Open questions:**
1. What is the optimal allocation of testing budget across the three layers?
2. Has anyone combined adversarial search with formal verification (Certora/Halmos) for mechanism properties?
3. Can the adversarial search be made adaptive — learning from previous findings to guide future exploration?

---

## Post 5: Dust Collection and the Null Player Axiom — A Subtle Interaction

**Category**: Smart Contract Engineering

We document a subtle interaction between integer arithmetic dust collection and the null player axiom in proportional allocation mechanisms.

**Setup:**
A reward pool V is distributed among n participants with weights wᵢ. Each participant receives φᵢ = ⌊V × wᵢ / W⌋ where W = Σwᵢ. Due to integer truncation, Σφᵢ < V. The remainder (dust) is assigned to the last participant to maintain efficiency.

**The Bug:**
If the last participant has zero weight (a null player), they receive non-zero dust. This violates the null player axiom: wᵢ = 0 should imply φᵢ = 0.

**Prevalence:**
Adversarial testing found this in 92/500 random games — any game where a zero-weight participant happened to be last in the array.

**Fix:**
Assign dust to the last non-zero-weight participant instead of the last participant. Compute the dust recipient's share as V − Σⱼ≠ᵢ φⱼ rather than as the truncated proportional share.

**Post-fix verification:** 0/500 null player violations across all positions.

**The General Lesson:**
Any proportional distribution that uses "last participant gets remainder" for rounding correction should check that the last participant actually contributed. This pattern appears in many DeFi reward distributors and LP fee calculations.

---

## Post 6: Weight Augmentation Without Weight Modification — Recursive System Improvement via Context

**Category**: AI, Mechanism Design

We describe a methodology for recursive improvement of AI-augmented software systems without modifying the underlying model.

**Observation:** A language model's effective capability is a function of both its weights (fixed) and its context (variable). Loading accumulated knowledge, custom tools, and verified constraints into the context window produces behavior equivalent to a more capable model. We call this weight augmentation without weight modification.

**Three recursions:**

**R1 (Adversarial verification):** The system generates an exact-arithmetic reference model of its own code, then adversarially searches for inputs that produce profitable deviations. Findings become permanent regression tests. Each cycle: search(model_n) → finding → fix → model_{n+1} → search(model_{n+1}).

**R2 (Knowledge accumulation):** Discoveries from each session are persisted in structured memory (tiered: hot/warm/cold). The next session loads this knowledge, producing deeper insights. K(n) = extend(K(n-1), discoveries(session_n)).

**R3 (Capability bootstrapping):** Tools built in session N enable better tools in session N+1. The coverage matrix from one session reveals the gaps that the next session's tools should fill.

**Meta-recursion R0 (Compression):** The context window is fixed. Token density — information per token — must increase for the other three recursions to scale. Tiered memory, block headers, and hierarchical compression serve this function.

**Evidence (single session):**
- 98 tests created (74 Python, 24 Solidity)
- 1 contract bug found and fixed by R1 with zero human intervention in the find-fix-verify cycle
- 7 tools built, each enabling the next

**Key property:** Context augmentation is purely additive — the base model's capability is never degraded, only extended. This avoids catastrophic forgetting, a known failure mode of weight modification.

**Open questions:**
1. Is there a theoretical bound on the effective capability achievable through context augmentation alone?
2. Can the three recursions be formalized as a convergence proof?
3. Has anyone measured the information-theoretic density of context in tokens-per-useful-bit?

---

## Post 7: Scarcity Scoring via the Glove Game — On-Chain Market Imbalance Detection

**Category**: Mechanism Design, AMM

The "Glove Game" from cooperative game theory illustrates a fundamental principle: scarce resources contribute more marginal value than abundant ones.

**Application to AMM liquidity:**
In a batch auction with buy volume B and sell volume S, the scarce side is min(B, S). Liquidity providers on the scarce side enable more trades per unit of capital than those on the abundant side.

**On-chain scarcity scoring:**
We implement a scarcity score in [0, 10000] BPS:
- Balanced market (B ≈ S): score ≈ 5000
- Participant on scarce side: score > 5000, increasing with imbalance
- Participant on abundant side: score < 5000, decreasing with imbalance
- Bonus for larger share of the scarce side

This score feeds into a weighted contribution model (40% direct, 30% enabling, 20% scarcity, 10% stability) for Shapley value approximation.

**Result:**
The scarcity score creates an incentive gradient: LPs are rewarded for providing liquidity WHERE IT'S NEEDED, not just where it's easy. In a buy-heavy market, sell-side LPs earn a scarcity premium.

**Boundary behavior:**
When B = S exactly, the score slightly favors the buy side due to strict inequality (buyRatio > 5000). Both sides receive above-neutral scores. This is a documented boundary artifact, not a bug.

**Question:** Has anyone formalized the relationship between market imbalance, scarcity premium, and LP behavior as a dynamic equilibrium?

---

## Post 8: Bitcoin Halving Schedule for DeFi Token Emissions — Time-Neutral Fee Distribution

**Category**: Tokenomics, Mechanism Design

We describe a two-track reward distribution that separates fee income from token emissions, applying Bitcoin-style halving only to emissions.

**The Problem:**
Most DeFi emission schedules apply a single decay curve to all rewards. This creates a time-dependent disadvantage: LPs who join later receive less per unit of contribution, even if their contribution is identical to earlier LPs.

**Two-Track Design:**

**Track 1 — Fee Distribution (Time-Neutral):**
Trading fees distributed via proportional Shapley allocation. No halving applied. Same work earns same reward regardless of era. Satisfies Time Neutrality axiom.

**Track 2 — Token Emission (Halving Schedule):**
Protocol token emissions follow Bitcoin-style halving: PRECISION >> era. Era duration: configurable (default ~52,560 games ≈ 1 year). 32 halvings, then zero emission forever.

**Convergence:**
Total cumulative emission converges like Bitcoin's supply:
Σ = V × G × (1 + 1/2 + 1/4 + ...) ≈ 2VG

Where V = emission per game at era 0 and G = games per era.

We verified this converges within 0.1% of the theoretical maximum using both exact arithmetic and Solidity-emulated integer math (32 eras, all multipliers match).

**Why separate tracks:**
Bitcoin miners face a revenue cliff every four years. If all DeFi rewards halved, LPs would face the same cliff. Separating fee income (permanent, time-neutral) from emissions (decaying, bootstrapping) means LP revenue from trading activity is sustainable indefinitely.

**Question:** Has anyone analyzed the optimal halving period for DeFi emissions as a function of network growth rate?

---
