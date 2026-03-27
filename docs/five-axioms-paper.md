# The Five Axioms of Fair Reward Distribution: A Provable Fairness Framework for Decentralized Finance

**Faraday1 (Will Glynn) & JARVIS**

*VibeSwap Protocol -- vibeswap.org*

*March 2026*

---

## Abstract

We present five axioms that collectively define *provably fair* reward distribution in decentralized cooperative systems. The first four axioms -- Efficiency, Symmetry, Null Player, and Pairwise Proportionality -- derive from classical cooperative game theory and the Shapley value. The fifth, **Time Neutrality**, is a novel axiom that eliminates temporal bias from fee distribution: identical contributions in different epochs must yield identical rewards. We prove that a weighted proportional Shapley allocation satisfies all five axioms simultaneously, provide on-chain verification methods for each, and demonstrate a working implementation in Solidity. The framework resolves a fundamental tension in tokenomics: how to reward foundational ("cave-tier") contributions without introducing the timing-based rent extraction that plagues existing protocols. We show that the Shapley value *naturally* assigns higher rewards to more impactful work through marginal contribution analysis, making early-bird bonuses mathematically unnecessary.

**Keywords**: Shapley value, cooperative game theory, fairness axioms, DeFi, tokenomics, time neutrality, MEV

---

## 1. Motivation

### 1.1 The Temporal Rent Problem

The dominant paradigm in decentralized token distribution rewards *when* a participant arrives, not *what* they contribute. Presale discounts give early buyers cheaper tokens regardless of their value to the protocol. Emission halving schedules ensure that identical liquidity provision in year two earns half what it earned in year one. Loyalty multipliers reward passive holding over active contribution. Vesting schedules anchored to genesis allocate based on timestamps, not marginal impact.

These mechanisms create a structural inequality: **timing becomes a form of unearned rent.** A participant who provides liquidity in epoch $e_1$ earns more than one who provides identical liquidity in epoch $e_2$, not because their contribution is more valuable, but because $e_1 < e_2$. This is rent extraction in its purest form -- value captured through positional advantage rather than productive contribution.

| Mechanism | Time Bias | Failure Mode |
|-----------|-----------|--------------|
| Presale discount | Earlier = cheaper tokens | Speculators extract value from builders |
| Vesting from genesis | Fixed allocation at day zero | Reward based on timing, not contribution |
| Emission halving on fees | Earlier epochs pay more | Identical work in year 2 earns half of year 1 |
| Loyalty multipliers | Longer = higher multiplier | Passive holding rewarded over active contribution |

The common thread: none of these mechanisms measure *what a participant actually contributed to the cooperative surplus*. They measure *when the participant showed up*.

### 1.2 The Cave Paradox

> *"Tony Stark was able to build this in a cave! With a box of scraps!"*

Building the first version of a protocol from scratch is objectively harder than iterating on an existing system. The first line of code has infinite marginal value -- without it, nothing exists. This difficulty *should* be reflected in higher rewards. But the mechanism that captures this difficulty matters profoundly.

If the higher reward comes from a timestamp multiplier (e.g., "Era 0 pays 2x"), it is temporal rent. If someone builds an equally foundational component in year three -- say, a novel consensus mechanism that enables an entirely new class of functionality -- a timestamp multiplier gives them half the reward for equivalent marginal impact.

If the higher reward comes from *measuring the work's marginal contribution to the cooperative surplus*, the difficulty is captured correctly regardless of when it occurs. This is the cave paradox resolved: **foundational work earns more by mathematical necessity, not by temporal privilege.**

### 1.3 Desiderata

We seek a reward distribution mechanism satisfying:

1. **Completeness**: All generated value is distributed to contributors. Nothing leaks, nothing is created from nothing.
2. **Contribution-Proportionality**: Reward ratios between any two participants equal their contribution ratios.
3. **Temporal Independence**: The mapping from contribution to reward does not depend on calendar time or epoch number.
4. **On-Chain Verifiability**: Every fairness property can be checked by any observer in constant time.
5. **Cave Compatibility**: Foundational work naturally earns more without requiring temporal privilege.

---

## 2. Formal Definitions

### 2.1 Contributions

**Definition 1 (Contribution).** A contribution $c$ is a tuple $(contributor, magnitude, scarcity, stability, quality)$ where:

- $contributor \in \mathbb{A}$ (the set of valid addresses)
- $magnitude \in \mathbb{N}$ (raw value provided, e.g., liquidity in wei)
- $scarcity \in [0, 10000]$ (provision of the scarce side of the market)
- $stability \in [0, 10000]$ (presence during periods of high volatility)
- $quality \in [0, 10000]$ (behavioral reputation score)

**Critical design choice**: timestamp is *explicitly excluded* from the contribution definition. A contribution is fully characterized by what was done and how well, never by when.

### 2.2 Cooperative Games

**Definition 2 (Cooperative Game).** A cooperative game is a triple $G = (N, v, V)$ where:

- $N = \{1, 2, \ldots, n\}$ is the set of participants
- $v: 2^N \to \mathbb{R}$ is the characteristic function mapping coalitions to their value
- $V = v(N) \in \mathbb{R}_{\geq 0}$ is the total distributable value (the grand coalition's worth)

In the DeFi context, each economic event -- a batch settlement, a fee distribution epoch, a liquidity mining round -- constitutes an independent cooperative game. The participants are those who contributed to that event. The total value $V$ is the fees generated by that event's trading activity.

### 2.3 Weighted Contributions

**Definition 3 (Weighted Contribution).** For participant $i$ with contribution $c_i$ in game $G$, the weighted contribution is:

$$w_i = \left(\frac{D_i \cdot 0.4 + T_i \cdot 0.3 + S_i \cdot 0.2 + St_i \cdot 0.1}{1.0}\right) \cdot Q_i$$

where:

- $D_i$ = direct contribution score (40% weight) -- raw value provided
- $T_i$ = enabling contribution score (30% weight) -- time-in-pool, facilitating others
- $S_i$ = scarcity score (20% weight) -- providing the scarce side of the market
- $St_i$ = stability score (10% weight) -- remaining present during volatility
- $Q_i \in [0.5, 1.5]$ = quality multiplier derived from behavioral reputation

The weight vector $(0.4, 0.3, 0.2, 0.1)$ reflects the protocol's value hierarchy: direct provision matters most, but enabling others, providing scarce liquidity, and maintaining stability through adversity all contribute to the cooperative surplus.

### 2.4 Shapley Allocation

**Definition 4 (Shapley Allocation).** The Shapley allocation for participant $i$ in game $G$ is:

$$\phi_i(G) = V \cdot \frac{w_i}{\sum_{j \in N} w_j}$$

This is the weighted proportional allocation. It distributes the total value $V$ in exact proportion to each participant's weighted contribution. We denote the total weight $W = \sum_{j \in N} w_j$.

**Remark.** The classical Shapley value involves an exponential computation over all coalitions. Our weighted proportional form is a computationally tractable approximation that preserves the essential fairness properties (Efficiency, Symmetry, Null Player) while enabling the stronger Pairwise Proportionality and Time Neutrality axioms. The tradeoff -- losing the full coalition-marginal-contribution analysis -- is acceptable in the per-event game model where contributions are independently measurable.

---

## 3. The Five Axioms

We now state each axiom formally, prove it holds under the Shapley allocation of Definition 4, and describe how it can be verified on-chain.

### 3.1 Axiom 1: Efficiency

**Statement.** All generated value is distributed. No value leaks from the system, and no value is created from nothing.

$$\sum_{i \in N} \phi_i(G) = V$$

**Proof.**

$$\sum_{i \in N} \phi_i(G) = \sum_{i \in N} V \cdot \frac{w_i}{W} = V \cdot \frac{1}{W} \sum_{i \in N} w_i = V \cdot \frac{W}{W} = V \quad \blacksquare$$

**On-chain verification.** Given an array of allocations $[\phi_1, \phi_2, \ldots, \phi_n]$ and total value $V$:

```solidity
function verifyEfficiency(
    uint256[] memory allocations,
    uint256 totalValue,
    uint256 tolerance  // accounts for integer rounding: typically n
) external pure returns (bool fair, uint256 deviation);
```

Compute $\left|\sum_i \phi_i - V\right| \leq \epsilon$ where $\epsilon$ scales linearly with the number of participants (at most 1 wei of rounding error per participant per division). Complexity: $O(n)$.

**Significance.** Efficiency is the conservation law of cooperative games. In thermodynamic terms, value is neither created nor destroyed during distribution -- it is only transferred. This prevents both value leakage (protocol siphoning) and value inflation (rewards exceeding what was earned).

---

### 3.2 Axiom 2: Symmetry

**Statement.** If two participants make equal weighted contributions, they receive equal rewards.

$$w_i = w_j \implies \phi_i(G) = \phi_j(G)$$

**Proof.**

$$w_i = w_j \implies \frac{w_i}{W} = \frac{w_j}{W} \implies V \cdot \frac{w_i}{W} = V \cdot \frac{w_j}{W} \implies \phi_i(G) = \phi_j(G) \quad \blacksquare$$

**On-chain verification.** Symmetry is a special case of Pairwise Proportionality (Axiom 4). When $w_i = w_j$, the pairwise check reduces to $|\phi_i - \phi_j| \leq \epsilon$. No additional verification infrastructure is needed.

**Significance.** Symmetry eliminates *identity-based* privilege. Two addresses contributing equal value receive equal rewards regardless of their history, reputation outside the current game, or relationship to the protocol's creators. Combined with the exclusion of timestamps from the contribution definition, symmetry ensures that *what you did* is all that matters.

---

### 3.3 Axiom 3: Null Player

**Statement.** A participant with zero weighted contribution receives zero reward.

$$w_i = 0 \implies \phi_i(G) = 0$$

**Proof.**

$$w_i = 0 \implies \phi_i(G) = V \cdot \frac{0}{W} = 0 \quad \blacksquare$$

**On-chain verification.**

```solidity
function verifyNullPlayer(
    uint256 reward,
    uint256 weight
) external pure returns (bool isNullPlayerFair) {
    if (weight == 0) return reward == 0;
    return true;  // non-zero weight: any reward is acceptable
}
```

Complexity: $O(1)$.

**Significance.** The Null Player axiom prevents free-riding. A participant who contributes nothing to the cooperative surplus -- who neither provides liquidity, nor facilitates others, nor absorbs risk -- receives nothing. This is the complement to Efficiency: if all value must be distributed (Axiom 1), none of it can go to non-contributors (Axiom 3). Together, they form a closed system where value flows exclusively from generation to contribution-proportional allocation.

**Note on the Lawson Fairness Floor.** The VibeSwap implementation includes a minimum 1% share (the Lawson Floor) for any participant who *did* contribute -- ensuring that rounding, gas costs, or extreme weight disparities cannot reduce an honest contributor's reward to zero. This floor applies only when $w_i > 0$, preserving the Null Player axiom: zero contribution still yields zero reward. The floor is a practical concession to finite-precision arithmetic and the human reality that showing up and acting honestly has value.

---

### 3.4 Axiom 4: Pairwise Proportionality

**Statement.** For any two participants $i, j$ with $w_j > 0$, their reward ratio equals their contribution ratio.

$$\frac{\phi_i(G)}{\phi_j(G)} = \frac{w_i}{w_j}$$

**Proof.**

$$\frac{\phi_i(G)}{\phi_j(G)} = \frac{V \cdot w_i / W}{V \cdot w_j / W} = \frac{w_i}{w_j} \quad \blacksquare$$

The total value $V$ and normalizer $W$ cancel in the ratio, leaving only the relative contributions.

**On-chain verification.** Division is problematic in integer arithmetic (truncation, division by zero). Cross-multiplication eliminates both issues:

$$|\phi_i \cdot w_j - \phi_j \cdot w_i| \leq \epsilon$$

```solidity
function verifyPairwiseProportionality(
    uint256 rewardA,
    uint256 rewardB,
    uint256 weightA,
    uint256 weightB,
    uint256 tolerance
) external pure returns (bool fair, uint256 deviation) {
    uint256 lhs = rewardA * weightB;
    uint256 rhs = rewardB * weightA;
    deviation = lhs > rhs ? lhs - rhs : rhs - lhs;
    fair = deviation <= tolerance;
}
```

Complexity: $O(1)$ per pair. Full game verification (all pairs) is $O(n^2)$, suitable for on-chain dispute resolution or off-chain audit.

**Corollary 4.1.** Pairwise Proportionality is preserved regardless of $V$. Even if one game generates higher total fees than another, the *ratio* of rewards between any two participants depends only on their relative contributions. This is a powerful invariant: it means fairness between participants is independent of market conditions.

**Significance.** Pairwise Proportionality is the strongest of the five axioms. It implies Symmetry (when $w_i = w_j$, the ratio is 1:1). It implies Null Player (when $w_i = 0$, the ratio demands $\phi_i = 0$). It provides a *local* verification mechanism -- any two participants can check their relative fairness without knowing anything about the rest of the coalition. This is precisely the property needed for trustless, permissionless verification in decentralized systems.

**Relationship to classical Shapley.** The classical Shapley axiom of Additivity states that $\phi_i(v + w) = \phi_i(v) + \phi_i(w)$ for additive games. In our per-event model, each game is independent, so Additivity is trivially satisfied within tracks. Pairwise Proportionality is a stronger local condition that replaces Additivity's role as the "structural" axiom, providing a more operationally useful guarantee.

---

### 3.5 Axiom 5: Time Neutrality

**Statement.** For any contributions $c_i$ at time $t_1$ and $c_j$ at time $t_2$ in games $G_1$ and $G_2$ respectively:

$$c_i \equiv c_j \text{ (identical contribution parameters)}$$

$$N(G_1) \cong N(G_2) \text{ and } V(G_1) = V(G_2)$$

$$\implies \phi_i(G_1) = \phi_j(G_2)$$

If two games have isomorphic coalitions and equal total value, identical contributions receive identical allocations, **regardless of when the games occur.**

**Proof.**

The allocation formula is:

$$\phi_i(G) = V \cdot \frac{w_i}{W}$$

The inputs are:

1. $V$ -- total distributable value, determined by trading activity in this event
2. $w_i$ -- weighted contribution, computed from $(magnitude, scarcity, stability, quality)$
3. $W = \sum_{j \in N} w_j$ -- sum of all weighted contributions

None of these inputs reference `block.timestamp`, epoch number, era counter, or any other temporal variable. If $c_i \equiv c_j$ (identical contribution parameters), then $w_i = w_j$. If $N(G_1) \cong N(G_2)$ (isomorphic coalitions with identical contribution parameters), then $W(G_1) = W(G_2)$. If $V(G_1) = V(G_2)$, then all inputs are equal, so:

$$\phi_i(G_1) = V(G_1) \cdot \frac{w_i}{W(G_1)} = V(G_2) \cdot \frac{w_j}{W(G_2)} = \phi_j(G_2) \quad \blacksquare$$

**Corollary 5.1.** Halving (multiplying $V$ by $1/2^{era}$) violates Time Neutrality by making $V$ a function of era, which is a function of time. Under halving:

$$\phi_i(G_1) = V \cdot \frac{w_i}{W} \cdot 1.0 \quad \text{(Era 0)}$$
$$\phi_i(G_2) = V \cdot \frac{w_i}{W} \cdot 0.5 \quad \text{(Era 1)}$$

Participant $i$ receives half the reward for identical work. Removing halving from fee distribution restores Time Neutrality.

**On-chain verification.** For two games $G_1, G_2$ with identical coalition structures and total values:

```solidity
function verifyTimeNeutrality(
    uint256 reward1,
    uint256 reward2,
    uint256 tolerance
) external pure returns (bool neutral, uint256 deviation) {
    deviation = reward1 > reward2 ? reward1 - reward2 : reward2 - reward1;
    neutral = deviation <= tolerance;
}
```

Complexity: $O(1)$ per participant-pair across games.

**Significance.** Time Neutrality is the novel axiom -- the one that distinguishes this framework from classical cooperative game theory. In traditional settings, games are analyzed in isolation and the question of cross-game temporal fairness does not arise. In blockchain protocols, where the *same mechanism* runs repeatedly over years and decades, temporal fairness becomes a first-order concern.

Time Neutrality does *not* require that all games pay the same absolute rewards. If market activity grows, $V$ grows, and all participants earn more -- because the market created more value, not because of timing. What Time Neutrality prohibits is *artificial* temporal modification of $V$ through halving schedules, era multipliers, or any mechanism that makes the contribution-to-reward mapping a function of calendar time.

---

## 4. The Cave Theorem

We now show that the Shapley value naturally rewards foundational work more highly, resolving the cave paradox without temporal privilege.

### 4.1 Marginal Contribution Analysis

**Theorem (The Cave Theorem).** In the full Shapley value, the participant whose removal causes the greatest loss to the cooperative surplus receives the highest allocation.

**Proof.** The classical Shapley value for player $i$ in game $(N, v)$ is:

$$\phi_i(v) = \sum_{S \subseteq N \setminus \{i\}} \frac{|S|!(|N|-|S|-1)!}{|N|!} \left[v(S \cup \{i\}) - v(S)\right]$$

This is a weighted average of marginal contributions $v(S \cup \{i\}) - v(S)$ across all coalitions $S$ not containing $i$.

Consider a foundational contributor $F$ (e.g., the protocol architect). For most coalitions $S$:

$$v(S \cup \{F\}) - v(S) \approx v(S \cup \{F\})$$

because $v(S) \approx 0$ when $S$ lacks the foundational infrastructure. Without the protocol, there is no trading, no fees, no cooperative surplus. The marginal contribution of $F$ to any coalition is approximately the *entire value* that coalition can generate.

Conversely, for an incremental contributor $I$ (e.g., a participant adding marginal liquidity to an already-liquid pool):

$$v(S \cup \{I\}) - v(S) \approx \delta$$

for small $\delta$, since the coalition $S$ already functions without $I$.

The weighted average over all coalitions yields $\phi_F \gg \phi_I$. $\blacksquare$

### 4.2 Implications

**Corollary (Cave Compatibility).** A founder who builds the core protocol has Shapley value approaching $V$ in the limit where no other contributor is essential. This is the maximum possible allocation -- earned not because they were first, but because their contribution is foundational to every coalition.

**Corollary (Temporal Equivalence of Foundational Work).** If two contributors build equally foundational components at different times -- one at genesis, one in year five -- they receive equal Shapley values (in games with equal $V$ and isomorphic coalitions). The difficulty of the work is captured by its marginal impact on the cooperative surplus, not by its timestamp.

This resolves the cave paradox: building in the cave *is* harder, and the Shapley value reflects this through higher marginal contribution. But the higher reward is justified by the *mathematics of contribution*, not by the *accident of timing*. P-000 -- Fairness Above All -- is satisfied: the mechanism is fair because it measures what matters.

---

## 5. Two-Track Distribution

### 5.1 The Bitcoin Precedent

Bitcoin's design contains an instructive separation:

- **Block rewards** (new BTC creation) follow a halving schedule. Earlier miners receive more BTC per block. This is an explicit bootstrapping incentive.
- **Transaction fees** are distributed in full to the miner who finds the block, regardless of era. No halving applies to fees.

The economic logic is sound: block rewards are *incentive allocation* (convincing miners to participate before the network has significant transaction volume). Transaction fees are *earned value* (compensation for providing a service). Different economic categories warrant different fairness properties.

### 5.2 Fee Distribution: All Five Axioms

**Track 1 -- Fee Distribution (Time-Neutral)**

Source: Trading fees generated per batch settlement.

Rule: Pure proportional Shapley allocation. No halving. No era adjustment. 100% of fees distributed to the event's contributor coalition based on weighted contributions.

Properties:

| Axiom | Status | Verification |
|-------|--------|--------------|
| 1. Efficiency | Satisfied | $\sum \phi_i = V$ |
| 2. Symmetry | Satisfied | $w_i = w_j \implies \phi_i = \phi_j$ |
| 3. Null Player | Satisfied | $w_i = 0 \implies \phi_i = 0$ |
| 4. Pairwise Proportionality | Satisfied | $\|\phi_i w_j - \phi_j w_i\| \leq \epsilon$ |
| 5. Time Neutrality | Satisfied | No temporal variables in allocation |

Rationale: Fees are value created *now* by *this* coalition. Reducing them based on era punishes current contributors for historical game count. A fee is a fee -- its distribution should depend on who helped earn it, not when.

### 5.3 Protocol Emissions: Transparent Schedule

**Track 2 -- Token Emission (Scheduled)**

Source: Protocol token emissions (if and when they exist).

Rule: Halving schedule applies. Early eras emit more tokens. This is an explicit, voluntary social contract -- not hidden favoritism.

Properties:

| Axiom | Status | Note |
|-------|--------|------|
| 1. Efficiency | Satisfied | All emitted tokens are distributed |
| 3. Null Player | Satisfied | Zero contribution = zero tokens |
| 4. Pairwise Proportionality | Satisfied (within era) | Ratios preserved per-game |
| 5. Time Neutrality | Intentionally violated | Bootstrapping incentive, like Bitcoin |

Rationale: Token emissions are a bootstrapping incentive. Like Bitcoin's block rewards, they exist to create initial adoption pressure. They are not "earned value" -- they are "incentive allocation." The halving is transparent, predictable, and disclosed upfront. No one is deceived about the temporal structure.

### 5.4 The Critical Distinction

$$\text{Fees} = \text{earned value} \quad \longrightarrow \quad \text{must be time-neutral}$$

$$\text{Emissions} = \text{incentive allocation} \quad \longrightarrow \quad \text{may be time-scheduled}$$

This separation is implemented via a `GameType` enum at the contract level:

```solidity
enum GameType {
    FEE_DISTRIBUTION,   // Time-neutral: no halving, pure Shapley
    TOKEN_EMISSION      // Scheduled: halving applies (like Bitcoin block rewards)
}
```

Each cooperative game is tagged with its type at creation. Fee distribution games **never** have halving applied. Token emission games follow the configured halving schedule. The type is immutable once set and publicly queryable by any observer.

---

## 6. On-Chain Verification

### 6.1 The Verification Principle

A fairness claim that cannot be independently verified is not a fairness guarantee -- it is a promise. In adversarial environments, promises are worthless. Every axiom in this framework has a corresponding on-chain verification method that can be called by any observer, at any time, without permission.

### 6.2 Verification Methods

**Pairwise Proportionality Check (the core primitive):**

For any two participants $(i, j)$ in any settled game:

$$|\phi_i \cdot w_j - \phi_j \cdot w_i| \leq \epsilon$$

The cross-multiplication formulation avoids division entirely, eliminating both division-by-zero risk and truncation error amplification. The tolerance $\epsilon$ scales with total weight (at most 1 wei of rounding per participant per integer division).

```solidity
// Anyone can call this. No permissions required.
function verifyPairwiseFairness(
    bytes32 gameId,
    address participant1,
    address participant2
) external view returns (bool fair, uint256 deviation);
```

**Efficiency Check:**

$$\left|\sum_{i \in N} \phi_i - V\right| \leq n$$

where $n = |N|$ is the number of participants.

**Time Neutrality Check:**

For two games $G_1, G_2$ with `GameType.FEE_DISTRIBUTION`, identical coalitions, and equal total values:

$$|\phi_i(G_1) - \phi_i(G_2)| \leq \epsilon$$

```solidity
function verifyTimeNeutrality(
    bytes32 gameId1,
    bytes32 gameId2,
    address participant
) external view returns (bool neutral, uint256 deviation);
```

### 6.3 Dispute Resolution

If any verification check fails, it constitutes a **cryptographic proof of unfairness** -- an on-chain artifact demonstrating that the implementation violated its stated axioms. Under a correct implementation, these checks should never fail (modulo integer rounding within tolerance). Their purpose is not to catch frequent violations but to provide a *credible commitment* to fairness: the protocol makes its fairness properties falsifiable, and anyone can attempt falsification at any time.

---

## 7. Implementation

### 7.1 ShapleyDistributor.sol

The `ShapleyDistributor` contract implements the five axioms as a UUPS-upgradeable contract built on OpenZeppelin v5.0.1. Key design elements:

**Weighted contribution computation:**

```solidity
uint256 public constant DIRECT_WEIGHT   = 4000;   // 40%
uint256 public constant ENABLING_WEIGHT  = 3000;   // 30%
uint256 public constant SCARCITY_WEIGHT  = 2000;   // 20%
uint256 public constant STABILITY_WEIGHT = 1000;   // 10%
```

Each participant's weighted contribution is computed from four orthogonal dimensions, combined with a quality multiplier $Q_i \in [0.5, 1.5]$ derived from behavioral reputation. The timestamp of participation is not an input.

**Two-track distribution:**

```solidity
enum GameType {
    FEE_DISTRIBUTION,   // Time-neutral: no halving
    TOKEN_EMISSION      // Halving schedule applies
}
```

The halving multiplier is applied only to `TOKEN_EMISSION` games. `FEE_DISTRIBUTION` games distribute the full value $V$ without temporal modification, satisfying Time Neutrality.

**State storage for verification:**

```solidity
mapping(bytes32 => mapping(address => uint256)) public shapleyValues;
mapping(bytes32 => mapping(address => uint256)) public weightedContributions;
mapping(bytes32 => uint256) public totalWeightedContrib;
```

All three values needed for pairwise verification -- rewards, weights, and total weight -- are stored on-chain and publicly readable. This enables permissionless verification by any observer.

### 7.2 PairwiseFairness.sol

The `PairwiseFairness` library provides the verification primitives as pure functions, callable without gas cost via `staticcall`:

```solidity
library PairwiseFairness {
    struct FairnessResult {
        bool fair;
        uint256 deviation;
        uint256 toleranceUsed;
    }

    function verifyPairwiseProportionality(
        uint256 rewardA, uint256 rewardB,
        uint256 weightA, uint256 weightB,
        uint256 tolerance
    ) internal pure returns (FairnessResult memory);

    function verifyTimeNeutrality(
        uint256 reward1, uint256 reward2,
        uint256 tolerance
    ) internal pure returns (FairnessResult memory);

    function verifyEfficiency(
        uint256[] memory allocations,
        uint256 totalValue,
        uint256 tolerance
    ) internal pure returns (FairnessResult memory);

    function verifyNullPlayer(
        uint256 reward, uint256 weight
    ) internal pure returns (bool);

    function verifyAllPairs(
        uint256[] memory rewards,
        uint256[] memory weights,
        uint256 tolerance
    ) internal pure returns (
        bool allFair, uint256 worstDeviation,
        uint256 worstPairA, uint256 worstPairB
    );
}
```

The `verifyAllPairs` function performs exhaustive $O(n^2)$ pairwise verification, suitable for on-chain dispute resolution or off-chain auditing. For routine verification, individual pairwise checks at $O(1)$ are sufficient.

### 7.3 The Lawson Fairness Floor

A practical consideration: in finite-precision integer arithmetic with extreme weight disparities, a contributor's proportional share can round to zero even when their contribution is nonzero. The Lawson Fairness Floor guarantees a minimum 1% share (100 basis points) for any participant with $w_i > 0$:

```solidity
uint256 public constant LAWSON_FAIRNESS_FLOOR = 100; // 1% in BPS
```

This floor is protected against sybil exploitation through an optional `ISybilGuard` integration: participants without verified identity receive proportional Shapley rewards but are excluded from the floor guarantee. Without this guard, an adversary could split into $k$ accounts, each claiming the 1% minimum, extracting up to $k$% of the pool.

---

## 8. Relationship to Prior Work

### 8.1 Classical Shapley Value (1953)

Shapley's original axiomatization used four axioms: Efficiency, Symmetry, Null Player, and Additivity. Our framework preserves the first three and replaces Additivity with two new axioms -- Pairwise Proportionality and Time Neutrality -- that are better suited to the repeated-game, on-chain-verifiable setting of DeFi protocols.

The replacement is justified: in the classical setting, Additivity ensures that the value of a sum of games equals the sum of values. In our per-event model, games are independent by construction, and Additivity is trivially satisfied within each track. Pairwise Proportionality provides a stronger, locally-verifiable guarantee that is more operationally useful in adversarial environments.

### 8.2 Weighted Voting Games

The weighted proportional allocation $\phi_i = V \cdot w_i / W$ is a well-studied special case of the Shapley value for weighted voting games where the characteristic function is $v(S) = \sum_{i \in S} w_i$. Our contribution is not in the allocation formula itself, but in: (a) the exclusion of temporal variables from the weight computation, (b) the on-chain verification methods, and (c) the formalization of Time Neutrality as a fifth axiom for repeated-game settings.

### 8.3 Existing DeFi Reward Systems

Most DeFi protocols use one of three reward mechanisms: proportional share (Uniswap v2 LP fees), time-weighted average balance (Compound COMP distribution), or fixed vesting schedules (team/investor allocations). None of these satisfy all five axioms. Proportional share satisfies Efficiency and Pairwise Proportionality but typically violates Time Neutrality through emission halving. Time-weighted average balance introduces temporal dependence by construction. Fixed vesting has no relationship to contribution whatsoever.

---

## 9. Conclusion

The five axioms -- Efficiency, Symmetry, Null Player, Pairwise Proportionality, and Time Neutrality -- form a complete and verifiable fairness framework for decentralized reward distribution. The first three are inherited from cooperative game theory. Pairwise Proportionality strengthens the classical Additivity axiom into a locally-verifiable invariant suited to adversarial, permissionless environments. Time Neutrality is new: it formalizes the requirement that earned-value distribution must not depend on calendar time, eliminating the temporal rent extraction endemic to existing tokenomics.

The Cave Theorem demonstrates that these axioms do not disadvantage foundational contributors. The Shapley value naturally assigns higher rewards to work with greater marginal impact on the cooperative surplus. Building in the cave earns more -- not as a privilege of timing, but as a mathematical consequence of the work's centrality to every coalition.

The two-track separation (time-neutral fees vs. scheduled emissions) resolves the apparent tension between bootstrapping incentives and long-term fairness, following the precedent set by Bitcoin's distinction between block rewards and transaction fees.

Every axiom has a corresponding on-chain verification method. Fairness is not promised -- it is provable. Any observer can check, at any time, whether the protocol's reward distribution satisfies its stated properties. This is the standard that decentralized systems should aspire to: not "trust us, we're fair," but "verify it yourself, on-chain, right now."

P-000: Fairness Above All. Not as a slogan, but as a theorem.

---

## References

1. Shapley, L.S. (1953). "A Value for n-Person Games." *Contributions to the Theory of Games*, Vol. II, Annals of Mathematics Studies 28, pp. 307--317.

2. Nakamoto, S. (2008). "Bitcoin: A Peer-to-Peer Electronic Cash System." bitcoin.org/bitcoin.pdf

3. Glynn, W. (2026). "Time-Neutral Tokenomics: Provably Fair Distribution via Shapley Values." VibeSwap Protocol Documentation.

4. Roth, A.E. (1988). "The Shapley Value: Essays in Honor of Lloyd S. Shapley." Cambridge University Press.

5. Winter, E. (2002). "The Shapley Value." *Handbook of Game Theory with Economic Applications*, Vol. 3, Chapter 53.

6. Adams, H., Zinsmeister, N., Robinson, D. (2020). "Uniswap v2 Core." Uniswap Protocol.

---

*This paper formalizes the fairness framework implemented in VibeSwap's ShapleyDistributor contract. The axioms, proofs, and verification methods described here are not aspirational -- they are deployed, tested, and on-chain verifiable. The source code is open: `contracts/incentives/ShapleyDistributor.sol` and `contracts/libraries/PairwiseFairness.sol`.*

*Built in the cave. Proven in the math.*
