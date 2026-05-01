# Shapley Value Distribution: Fair Reward Allocation Through Cooperative Game Theory

**Faraday1 & JARVIS**
**vibeswap.io | March 2026**

---

## Abstract

We present the first on-chain implementation of Shapley value distribution for decentralized exchange reward allocation. The `ShapleyDistributor` contract replaces the industry-standard pro-rata fee model with a cooperative game theory framework in which each economic event -- batch settlement, fee distribution, token emission -- constitutes an independent cooperative game. Participants receive rewards proportional to their *marginal contribution* across four dimensions: direct liquidity provision, enabling duration, scarce-side supply, and volatility persistence. The system satisfies five formal axioms (Efficiency, Symmetry, Null Player, Pairwise Proportionality, Time Neutrality) with on-chain verifiable proofs via the `PairwiseFairness` library. A two-track distribution separates time-neutral fee rewards from Bitcoin-style halving token emissions, and a trust-weighted quality multiplier from `ContributionDAG` prevents Sybil attacks on the reward mechanism. We prove that the architecture is anti-MLM by construction: rewards are bounded by realized value, compounding is limited to discrete events, and no participant can extract more than their marginal contribution regardless of entry time or network position.

---

## 1. Introduction

### 1.1 The Pro-Rata Problem

Every major decentralized exchange distributes trading fees proportionally to capital deposited. This creates three structural unfairnesses:

1. **The Bootstrapper Penalty.** An LP who enters an empty pool, absorbs initial volatility, and attracts the first traders receives the same per-unit reward as a whale who deposits after the market stabilizes. The bootstrapper's risk was higher, their contribution was enabling, and their reward is identical.

2. **The Mercenary Capital Extraction.** Large deposits that arrive for a single high-fee period and withdraw immediately capture fees proportional to capital, not commitment. The pro-rata model cannot distinguish a 1-day mercenary deposit from a 1-year committed position.

3. **The Scarce-Side Blindness.** In a batch auction with 80% buy orders and 20% sell orders, the sell-side LPs are structurally more valuable -- without them, no trades execute. Pro-rata distribution ignores this asymmetry entirely.

These are not edge cases. They are the default outcome of every AMM fee distribution mechanism deployed today. The root cause is that pro-rata distribution measures *presence* (how much capital is in the pool) rather than *contribution* (how much value that capital created).

### 1.2 Cooperative Game Theory as Solution

Lloyd Shapley's 1953 formulation of the value function for cooperative games provides a mathematically unique solution to this problem. The Shapley value is the only distribution that satisfies the four classical axioms of fair allocation -- and VibeSwap extends it with a fifth (Time Neutrality) that addresses the temporal dimension unique to blockchain protocols.

The key insight is reframing reward distribution as a cooperative game. Each batch settlement is a game. Each fee period is a game. Each token emission event is a game. Participants are coalition members whose contributions create the game's value. The Shapley value tells us exactly how much each member contributed, accounting for synergistic and enabling effects.

### 1.3 The Glove Game Intuition

The foundational intuition comes from the "glove game" in combinatorial game theory:

- A left glove alone has zero value.
- A right glove alone has zero value.
- A left-right pair has value $1.

Neither player "deserves" the entire payoff. Value exists *only because of cooperation*. The Shapley value splits the surplus: each player receives $0.50.

In VibeSwap's batch auctions, the same principle applies. A pool with 100 ETH of buy orders and zero sell orders executes nothing. Adding 50 ETH of sell orders enables 50 ETH of matched volume. The scarce sell-side contribution is enabling -- it created value that did not exist before its arrival. Pro-rata distribution would give sell-side LPs only their proportional share. Shapley distribution recognizes their enabling contribution.

---

## 2. Formal Framework

### 2.1 Cooperative Games

A cooperative game is a pair (N, v) where:
- N = {1, 2, ..., n} is the set of participants
- v: 2^N -> R is the characteristic function, mapping each coalition S to its value v(S)
- v({}) = 0 (the empty coalition has no value)

### 2.2 The Shapley Value

For a cooperative game (N, v), the Shapley value of participant i is:

```
phi_i(v) = SUM over S in N\{i}: [ |S|! * (|N| - |S| - 1)! / |N|! ] * [ v(S U {i}) - v(S) ]
```

This computes the average marginal contribution of player i across all possible orderings of the coalition. The term `v(S U {i}) - v(S)` is the marginal contribution: the additional value created when player i joins coalition S.

### 2.3 The Five Axioms

VibeSwap's implementation satisfies five axioms:

**Axiom 1 -- Efficiency.** All generated value is distributed. No value is retained by the mechanism, no value is destroyed.

```
SUM over i in N: phi_i(v) = v(N)
```

In `ShapleyDistributor.sol`, this is enforced by the remainder-to-last-participant pattern (line 428-429): the final participant receives `game.totalValue - distributed`, guaranteeing zero dust loss.

**Axiom 2 -- Symmetry.** If participants i and j make identical contributions to every coalition, they receive identical rewards.

```
If v(S U {i}) = v(S U {j}) for all S in N\{i,j}, then phi_i(v) = phi_j(v)
```

In the weighted contribution model, identical inputs (directContribution, timeInPool, scarcityScore, stabilityScore) with identical quality weights produce identical weighted contributions, and therefore identical reward shares.

**Axiom 3 -- Null Player.** If participant i contributes nothing to any coalition, they receive nothing.

```
If v(S U {i}) = v(S) for all S, then phi_i(v) = 0
```

Enforced by the `NoReward` revert (line 455) and the null player verification function in `PairwiseFairness.sol`.

**Axiom 4 -- Pairwise Proportionality.** For any two participants i, j, their reward ratio equals their contribution ratio.

```
phi_i / phi_j = w_i / w_j
```

Verified on-chain via cross-multiplication in `PairwiseFairness.verifyPairwiseProportionality`:
```
|phi_i * w_j - phi_j * w_i| <= tolerance
```

Cross-multiplication avoids division-by-zero and minimizes rounding error. The tolerance is bounded by `totalWeightedContrib` to account for integer division artifacts.

**Axiom 5 -- Time Neutrality.** For fee distribution games, identical contributions yield identical rewards regardless of when the game occurs.

```
If contributions(i, game_1) = contributions(i, game_2), then phi_i(game_1) = phi_i(game_2)
```

This axiom applies only to `FEE_DISTRIBUTION` games (Track 1). Token emission games (Track 2) intentionally violate time neutrality through halving, creating bootstrapping incentives analogous to Bitcoin block rewards.

---

## 3. On-Chain Implementation

### 3.1 Architecture

`ShapleyDistributor.sol` is a UUPS-upgradeable contract (OpenZeppelin v5.0.1) with `ReentrancyGuard` protection. It operates through a three-phase lifecycle:

```
Phase 1: Game Creation     ->  createGame() / createGameTyped() / createGameFull()
Phase 2: Shapley Computation  ->  computeShapleyValues()
Phase 3: Reward Claims     ->  claimReward()
```

Each phase is access-controlled: only authorized creators (IncentiveController, VibeSwapCore) can create games and compute values. Claims are permissionless but guarded by `nonReentrant`.

### 3.2 Weighted Contribution Model

Computing exact Shapley values requires evaluating all 2^n coalitions -- O(2^n) complexity, infeasible on-chain for n > ~20. VibeSwap uses a weighted approximation that is O(n) and preserves all five axioms for the linear characteristic function:

```
weightedContribution(i) =
    directContribution(i)  *  DIRECT_WEIGHT    (4000 / 40%)
  + timeScore(i)           *  ENABLING_WEIGHT   (3000 / 30%)
  + scarcityScore(i)       *  SCARCITY_WEIGHT   (2000 / 20%)
  + stabilityScore(i)      *  STABILITY_WEIGHT  (1000 / 10%)
```

These constants (lines 66-69 of `ShapleyDistributor.sol`) are fixed at deployment:

| Component | Weight | BPS | Purpose |
|-----------|--------|-----|---------|
| Direct | 40% | 4000 | Raw liquidity/volume provision |
| Enabling | 30% | 3000 | Time in pool (enabled others to trade) |
| Scarcity | 20% | 2000 | Providing the scarce side of the market |
| Stability | 10% | 1000 | Remaining during volatility |

The result is normalized against the total weighted contribution and multiplied by the game's total distributable value.

### 3.3 Time Score: Logarithmic Enabling Recognition

Time-in-pool is scored logarithmically to recognize enabling contributions with diminishing returns:

```
timeScore = log2(daysInPool + 1) * PRECISION / 10
```

This produces the following scaling:

| Duration | log2 Multiplier | Interpretation |
|----------|----------------|----------------|
| 1 day | 1.0x | Baseline |
| 7 days | ~1.9x | Active LP |
| 30 days | ~2.7x | Committed LP |
| 365 days | ~4.2x | Long-term partner |

The logarithmic curve means that the first week matters more than the next month, and the first month matters more than the next year. This reflects reality: the enabling value of early liquidity is highest when the pool is new and uncertain.

### 3.4 Scarcity Score: The Glove Game On-Chain

The `calculateScarcityScore` function (lines 566-606) implements the glove game principle for batch auctions:

```
Given: buyVolume, sellVolume in a batch
If buyRatio > 50%: sell-side is scarce
If buyRatio < 50%: buy-side is scarce

Scarce-side score:  5000 + (imbalance / 2)   ->  range [5000, 7500]
Abundant-side score: 5000 - (imbalance / 2)   ->  range [2500, 5000]
Bonus: major contributor to scarce side gets up to +1000 BPS
```

In an 80/20 buy/sell batch, the imbalance is 3000 BPS. A sell-side LP would score 6500 BPS, while a buy-side LP would score 3500 BPS. The sell-side LP's weighted contribution for the scarcity component is 1.86x that of the buy-side LP -- reflecting the structural truth that the scarce side's presence enabled the batch to clear.

### 3.5 Quality Weight Integration

When `useQualityWeights` is enabled (default: true), each participant's weighted contribution is modulated by a quality multiplier derived from three reputation dimensions:

```
qualityMultiplier = 0.5 + (avgQuality / BPS_PRECISION)
where avgQuality = (activityScore + reputationScore + economicScore) / 3
Range: 0.5x (zero quality) to 1.5x (maximum quality)
```

Quality weights are updated per epoch by authorized controllers (IncentiveController) and stored as `QualityWeight` structs with:
- `activityScore` (0-10000 BPS): recent participation frequency
- `reputationScore` (0-10000 BPS): long-term behavioral track record
- `economicScore` (0-10000 BPS): cumulative value contributed
- `lastUpdate`: timestamp of last quality assessment

### 3.6 Pioneer Bonus

When a `PriorityRegistry` is configured and a game has a `scopeId` (typically a pool identifier), participants who were pioneers for that scope receive a bonus multiplier:

```
pioneerMultiplier = 1.0 + (pioneerScore / 20000)
```

| Pioneer Score | Multiplier | Meaning |
|---------------|-----------|---------|
| 0 | 1.0x | Non-pioneer |
| 5000 | 1.25x | Early participant |
| 10000 | 1.5x | Pool creator |
| 17500 | 1.875x | Pool creator + first LP |
| 20000 (cap) | 2.0x | Maximum pioneer bonus |

The pioneer score is capped at `2 * BPS_PRECISION` (20000) to prevent unbounded multipliers. This recognizes that pool creation and early liquidity provision are enabling contributions that subsequent participants benefit from.

### 3.7 The Lawson Fairness Floor

A minimum reward share of 1% (100 BPS) is guaranteed for any participant who contributed to a cooperative game:

```solidity
uint256 public constant LAWSON_FAIRNESS_FLOOR = 100; // 1% in BPS
```

This ensures that nobody who showed up and acted honestly walks away with zero -- a floor on fairness, not a ceiling on meritocracy.

---

## 4. Two-Track Distribution

### 4.1 Design Rationale

A naive application of time neutrality to all rewards would mean token emissions in year 10 are identical to year 1. This prevents bootstrapping incentives. Conversely, applying halving to fee distributions would penalize late participants for identical work -- violating fairness.

The solution is a two-track model:

### 4.2 Track 1: Fee Distribution (Time-Neutral)

Trading fees are distributed via pure proportional Shapley with no halving. The `GameType.FEE_DISTRIBUTION` enum triggers this path. Same work earns same reward, regardless of era.

This satisfies all five axioms, including Time Neutrality: if Alice provides 10 ETH of liquidity for 7 days in era 0 and Bob provides 10 ETH of liquidity for 7 days in era 5, and both games have equal total value and coalition structure, Alice and Bob receive identical rewards.

### 4.3 Track 2: Token Emission (Halving Schedule)

Protocol token emissions follow a Bitcoin-style halving schedule. The `GameType.TOKEN_EMISSION` enum triggers this path.

```
Emission multiplier = INITIAL_EMISSION >> era
Era 0: 100%     (1e18)
Era 1: 50%      (5e17)
Era 2: 25%      (2.5e17)
Era 3: 12.5%    (1.25e17)
...
Era 32: ~0%     (effectively zero)
```

Key constants:
- `DEFAULT_GAMES_PER_ERA = 52,560` (approximately 1 year at 1 game per 10 minutes)
- `MAX_HALVING_ERAS = 32` (after 32 halvings, emission approaches zero)
- `INITIAL_EMISSION = 1e18` (100% at PRECISION scale)

Halving is computed via bit-shifting (`INITIAL_EMISSION >> era`) for gas efficiency. The adjustment is applied at game creation time: when a `TOKEN_EMISSION` game is created, its `totalValue` is multiplied by the emission multiplier for the current era before Shapley computation occurs.

### 4.4 Separation Proof

The two tracks are compositionally independent. Fee distribution games and token emission games use the same `computeShapleyValues` function, the same weighted contribution model, and the same fairness verification. The only difference is whether `totalValue` is adjusted by halving before distribution. This means:

1. Fee rewards are time-neutral (Axiom 5 holds).
2. Token rewards create bootstrapping incentives (Axiom 5 intentionally relaxed).
3. Within any single era, token rewards are still pairwise proportional (Axiom 4 holds).

---

## 5. On-Chain Fairness Verification

### 5.1 The PairwiseFairness Library

A novel contribution of this work is the `PairwiseFairness` library -- a pure Solidity library that enables anyone to verify fairness properties on-chain, without trusting the distributor.

Four verification functions are provided:

**Pairwise Proportionality** (`verifyPairwiseProportionality`):
```
Input: rewardA, rewardB, weightA, weightB, tolerance
Check: |rewardA * weightB - rewardB * weightA| <= tolerance
Output: (fair: bool, deviation: uint256)
```

**Time Neutrality** (`verifyTimeNeutrality`):
```
Input: reward1, reward2, tolerance
Check: |reward1 - reward2| <= tolerance
Output: (fair: bool, deviation: uint256)
```

**Efficiency** (`verifyEfficiency`):
```
Input: allocations[], totalValue, tolerance
Check: |SUM(allocations) - totalValue| <= tolerance
Output: (fair: bool, deviation: uint256)
```

**Null Player** (`verifyNullPlayer`):
```
Input: reward, weight
Check: if weight == 0, then reward == 0
Output: isNullPlayerFair: bool
```

### 5.2 Full Game Audit

The `verifyAllPairs` function (O(n^2)) checks every pair in a settled game for pairwise proportionality. It returns the worst-case deviation and the indices of the offending pair. This is designed for dispute resolution: if any participant believes their allocation is unfair, they can call this function and present cryptographic evidence on-chain.

### 5.3 Tolerance Bounds

Integer division on the EVM introduces rounding errors bounded by the number of participants. The tolerance for pairwise verification is set to `totalWeightedContrib` -- the sum of all weighted contributions -- which bounds the maximum cross-multiplication error from integer division of `(game.totalValue * weights[i]) / totalWeight`.

---

## 6. Game Design: Event-Based Cooperative Games

### 6.1 Why Events, Not Networks

A naive implementation would model the entire protocol as one cooperative game. This has two fatal problems:

1. **Computational infeasibility.** With 10,000 participants, exact Shapley requires evaluating 2^10000 coalitions.
2. **Incentive diffusion.** In a massive game, each participant's marginal contribution approaches zero. There is no local signal connecting action to reward.

VibeSwap decomposes the protocol into discrete events, each constituting an independent game:

| Event Type | Game ID | Participants | Value |
|------------|---------|-------------|-------|
| Batch settlement | `keccak256(batchId, poolId)` | LPs + traders in batch | Trading fees |
| Fee distribution | `keccak256(epoch, poolId)` | Active LPs in epoch | Accumulated fees |
| Token emission | `keccak256(emissionId)` | All stakers | Protocol tokens |

### 6.2 Coalition Structure

In each event-game, the coalition is the set of participants whose contributions created the event's value. For a batch settlement:

- **LPs** contributed liquidity (direct + enabling + stability)
- **Traders** contributed volume (direct + scarcity)
- **The pool itself** contributed price discovery infrastructure

The characteristic function v(S) for a batch is the total trading fees generated by coalition S. If the batch has only buy orders (no sell-side LPs), v(S) = 0 -- nothing executes. Adding sell-side LPs changes the coalition value from zero to positive. This is the glove game in action.

### 6.3 Practical Constraints

The contract enforces:
- `minParticipants = 2` (a cooperative game needs at least two players)
- `maxParticipants = 100` (practical on-chain computation limit)
- Games are settled atomically in `computeShapleyValues` (no partial settlement)
- Each game is settled exactly once (`GameAlreadySettled` revert)

---

## 7. Anti-MLM Properties

### 7.1 The MLM Failure Mode

Multi-level marketing structures fail because:
1. Rewards compound across levels, potentially exceeding the actual value created
2. Early participants extract from later participants through positional advantage
3. The system requires exponential growth to sustain payouts

### 7.2 Why Shapley Distribution Cannot Become a Pyramid Scheme

**Property 1: Value-Bounded Rewards.** The Efficiency axiom guarantees that `SUM(phi_i) = v(N)`. No participant or coalition of participants can extract more than the total value of the game. There is no "phantom value" created by the mechanism.

**Property 2: Event-Bounded Compounding.** Rewards are distributed per event, not compounded across events. A participant's reward in game G_1 does not multiply their reward in game G_2. Each game is independent.

**Property 3: Marginal Contribution Ceiling.** No participant can receive more than their marginal contribution to the coalition. In the weighted model, this is enforced by proportional distribution: `share_i = (totalValue * weight_i) / totalWeight`. Even if weight_i is the largest weight, the share cannot exceed totalValue.

**Property 4: No Positional Advantage.** The Symmetry axiom ensures that two participants with identical contributions receive identical rewards, regardless of when they joined the protocol. The pioneer bonus recognizes enabling contributions (pool creation), not positional hierarchy.

**Property 5: Zero-Sum Impossibility.** Because rewards are bounded by realized value (trading fees, protocol revenue), the system cannot pay out more than it earns. There are no promises of future returns, no minimum guaranteed rates, and no rewards for recruitment alone.

### 7.3 Formal Anti-MLM Guarantee

Let R_total be the total rewards distributed across all games G_1, ..., G_k. Let V_total be the total value generated across all games. Then:

```
R_total = SUM over j: v(N_j) = V_total
```

Because each game's rewards sum to that game's value (Efficiency), and games are independent (no cross-game compounding), total rewards exactly equal total value. This is the fundamental sustainability constraint: **rewards cannot exceed revenue**.

---

## 8. Trust Integration: ContributionDAG

### 8.1 The Sybil Problem

Without identity verification, a single actor can create multiple wallets and appear as multiple participants, manipulating the Shapley distribution by fragmenting contributions across synthetic identities.

### 8.2 ContributionDAG as Defense

The `ContributionDAG` contract implements a directed acyclic graph of trust relationships:

- Users vouch for each other; bidirectional vouches form "handshakes"
- BFS from founder nodes computes distance-based trust scores with 15% decay per hop (`TRUST_DECAY_PER_HOP = 1500 BPS`)
- Maximum trust depth is 6 hops (`MAX_TRUST_HOPS = 6`)
- Each user can vouch for at most 10 others (`MAX_VOUCH_PER_USER = 10`)

Trust scores feed into `ShapleyDistributor` quality weights. A Sybil attacker creating fresh wallets would have:
- Zero trust score (no vouches from the trust graph)
- Quality multiplier of 0.5x (minimum)
- Effectively halved Shapley allocation versus a trusted participant with identical raw contributions

### 8.3 The Lawson Constant

The `ContributionDAG` contains a structural dependency:

```solidity
bytes32 public constant LAWSON_CONSTANT = keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026");
```

This is not decorative. It is load-bearing: the contribution graph anchors trust scores to their origin. Forks that remove attribution break the trust score calculation chain. Attribution is structural, not cosmetic -- without acknowledging who built the system, the system's trust properties collapse.

---

## 9. CKB Substrate Analysis

### 9.1 Contribution Events as Cells

On Nervos CKB, each contribution event maps naturally to a cell:

| Shapley Concept | CKB Representation |
|----------------|--------------------|
| Cooperative game | Transaction consuming input cells, producing reward cells |
| Participant contribution | Cell data: directContribution, timeInPool, scarcityScore, stabilityScore |
| Shapley value | Output cell with calculated reward amount |
| Quality weight | Separate cell with type script enforcing update rules |
| Trust score | ContributionDAG cell with lock script requiring vouch verification |

### 9.2 Off-Chain Compute, On-Chain Verify

CKB's programming model is "compute off-chain, verify on-chain." This is ideal for Shapley distribution:

1. **Off-chain**: Compute exact Shapley values (O(2^n) or Monte Carlo approximation) for the batch
2. **On-chain**: Verify the result satisfies all five axioms using `PairwiseFairness` checks in type scripts
3. **Dispute resolution**: If verification fails, the transaction is rejected -- no invalid distribution can be committed

This enables exact Shapley computation (not the O(n) weighted approximation) for games with up to ~30 participants, since the compute constraint moves off-chain while the verification constraint remains O(n^2) on-chain.

### 9.3 Cell Composition for Multi-Dimensional Scoring

Each scoring dimension (direct, enabling, scarcity, stability) can be an independent cell with its own type script:

- **Direct contribution cell**: Type script validates against pool state
- **Enabling duration cell**: Lock script enforces Since-based timelock, data tracks continuous presence
- **Scarcity score cell**: Type script reads batch composition from auction cells
- **Stability score cell**: Type script reads oracle cells for volatility data

These compose at the transaction level: a Shapley settlement transaction consumes all four score cells per participant and produces reward cells. The composition is atomic and verifiable without proxy patterns or delegatecall.

### 9.4 UTXO Parallelism

CKB's UTXO model enables parallel Shapley settlement: games touching different pools can be settled in parallel transactions because they operate on disjoint cell sets. On EVM, all games share the same contract storage, creating sequential bottlenecks.

---

## 10. Comparison with Alternative Distribution Mechanisms

### 10.1 Pro-Rata Distribution

```
reward_i = totalFees * (liquidity_i / totalLiquidity)
```

| Property | Pro-Rata | Shapley |
|----------|---------|---------|
| Measures | Presence | Contribution |
| Enabling recognition | None | 30% weight |
| Scarcity recognition | None | 20% weight |
| Stability recognition | None | 10% weight |
| Sybil resistance | None | Trust-weighted quality |
| Verifiable fairness | Trivial | On-chain PairwiseFairness |
| Time neutrality | Yes (trivially) | Yes (fees) / No (emissions) |
| Anti-MLM | N/A | By construction |

### 10.2 Time-Weighted Distribution

```
reward_i = totalFees * (liquidity_i * duration_i) / SUM(liquidity_j * duration_j)
```

Time-weighted distribution is a strict subset of Shapley distribution: it captures direct contribution and enabling duration but ignores scarcity and stability. It also lacks quality weighting and pioneer recognition.

### 10.3 Quadratic Funding

```
reward_i proportional to (SQRT(contribution_i))^2 matched from a pool
```

Quadratic funding optimizes for breadth of support (many small contributions preferred over few large ones). Shapley distribution optimizes for marginal contribution. These are complementary, not competing: quadratic funding is appropriate for public goods, Shapley distribution for cooperative value creation.

| Dimension | Quadratic Funding | Shapley Distribution |
|-----------|------------------|---------------------|
| Optimizes for | Breadth of support | Marginal contribution |
| Best suited for | Public goods | Cooperative value creation |
| Sybil vulnerability | High (multiple small wallets) | Low (trust-weighted) |
| On-chain verifiable | Matching formula only | All five axioms |

---

## 11. Security Analysis

### 11.1 Attack Vectors and Mitigations

**Sybil Splitting.** An attacker splits their liquidity across N wallets to game scarcity scoring. Mitigation: ContributionDAG trust weights reduce quality multiplier for unvouched wallets to 0.5x, making splitting unprofitable unless the attacker controls the trust graph.

**Timing Attacks.** An attacker deposits immediately before batch settlement to capture fees. Mitigation: time score uses logarithmic scaling -- a 1-minute deposit produces a timeScore of 0, while the 30% enabling weight requires sustained presence.

**Quality Weight Manipulation.** An attacker attempts to inflate their quality scores. Mitigation: quality weights are set by authorized controllers only (`onlyAuthorized` modifier), not self-reported.

**Pioneer Score Gaming.** An attacker creates empty pools to claim pioneer bonuses. Mitigation: pioneer scores are capped at 2x multiplier (`2 * BPS_PRECISION`), and the bonus only activates when both `PriorityRegistry` and `scopeId` are configured.

**Halving Arbitrage.** An attacker front-runs halving era transitions to capture higher emission rates. Mitigation: era transitions are based on `totalGamesCreated`, not timestamps. Games are created by authorized controllers in response to real economic events, not user-initiated.

### 11.2 Gas Considerations

The `computeShapleyValues` function is O(n) in participants. For `maxParticipants = 100`:
- Weight calculation: 100 iterations with 4 multiplications + log2 approximation each
- Distribution: 100 iterations with 1 multiplication + 1 division each
- Total: approximately 300-500k gas, well within block limits

---

## 12. Conclusion

VibeSwap's `ShapleyDistributor` demonstrates that cooperative game theory is not merely an academic framework but a practical, gas-efficient, on-chain mechanism for fair reward distribution. By decomposing protocol activity into independent cooperative games, computing weighted Shapley values across four contribution dimensions, and separating time-neutral fee rewards from halving-scheduled token emissions, the system achieves provable fairness guarantees that pro-rata distribution cannot match.

The `PairwiseFairness` library enables trustless on-chain verification of all five axioms, making the fairness claims auditable by any participant. The integration with `ContributionDAG` trust scores provides Sybil resistance without requiring identity verification. And the anti-MLM properties -- value-bounded rewards, event-bounded compounding, marginal contribution ceilings -- are structural, not policy-based.

The architecture is substrate-agnostic but finds its most natural expression on CKB's cell model, where contribution events map to cells, Shapley computation moves off-chain, and verification composes atomically at the transaction level.

The thesis is simple: **distribute rewards in proportion to actual contribution, including synergistic and enabling effects, without minting value from nothing.** The Shapley value is the unique mathematical solution that achieves this. VibeSwap is the first protocol to deploy it.

---

## References

1. Shapley, L.S. (1953). "A Value for n-Person Games." *Contributions to the Theory of Games II*, Annals of Mathematics Studies 28, pp. 307-317.
2. Roth, A.E. (1988). *The Shapley Value: Essays in Honor of Lloyd S. Shapley*. Cambridge University Press.
3. Glynn, W. (2026). "A Cooperative Reward System for Decentralized Networks: Shapley-Based Incentives for Fair, Sustainable Value Distribution." VibeSwap Technical Report.
4. Glynn, W. (2026). "Augmented Mechanism Design: Composable Armor for Economic Mechanisms." VibeSwap Papers.
5. Buterin, V. et al. (2019). "Liberal Radicalism: A Flexible Design For Philanthropic Matching Funds." *Management Science*.
6. Nakamoto, S. (2008). "Bitcoin: A Peer-to-Peer Electronic Cash System."
7. Nervos Network. (2019). "Nervos CKB: A Common Knowledge Base for Crypto-Economy."

---

*"Fairness Above All."*
*-- P-000, VibeSwap Protocol*

*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
*Contract: `contracts/incentives/ShapleyDistributor.sol`*
*Library: `contracts/libraries/PairwiseFairness.sol`*

---

## See Also

- [Shapley Reward System](../../concepts/shapley/SHAPLEY_REWARD_SYSTEM.md) — Core Shapley-based reward distribution with four axioms
- [Cross-Domain Shapley](../../concepts/shapley/CROSS_DOMAIN_SHAPLEY.md) — Fair value distribution across heterogeneous platforms
- [Composable Fairness](../../concepts/COMPOSABLE_FAIRNESS.md) — Shapley as unique solution to mechanism composition
- [Proof of Contribution](../../concepts/identity/PROOF_OF_CONTRIBUTION.md) — Shapley-based consensus for block production
- [Formal Fairness Proofs](../proofs/FORMAL_FAIRNESS_PROOFS.md) — Axiom verification and omniscient adversary proofs
- [Atomized Shapley](atomized-shapley.md) — Universal fair measurement for all protocol interactions
- [Shapley Distribution (Nervos post)](../../marketing/forums/nervos/talks/shapley-distribution-post.md) — Nervos community post on fair LP reward allocation
