# Recursive Batch Auctions: Fractal Time Structure for Multi-Scale Coordination

**Author**: Faraday1 (Will Glynn)
**Date**: March 2026
**Affiliation**: VibeSwap Protocol — vibeswap.org
**Status**: Working Paper

---

## Abstract

Batch auctions eliminate miner-extractable value (MEV) by decoupling order submission from
execution via commit-reveal schemes and uniform clearing prices. VibeSwap demonstrates this
at a fixed 10-second cadence: 8 seconds of commits, 2 seconds of reveals, then settlement.
However, financial coordination spans temporal scales that a single cadence cannot serve.
High-frequency arbitrage needs sub-second resolution. Cross-chain settlement requires minutes.
Governance demands weeks.

This paper introduces **Recursive Batch Auctions (RBA)**, a fractal time structure in which
batches nest inside batches, each inheriting the same fairness guarantees from the level
below. The core insight is that if a single commit-reveal batch auction satisfies the
properties of temporal decoupling, uniform clearing, and Shapley-fair distribution, then a
recursive composition of such auctions preserves those properties at every temporal scale.
The result is a unified coordination mechanism that spans milliseconds to months without
sacrificing the MEV resistance or cooperative equilibrium of the base layer.

---

## 1. Introduction: The Single-Scale Limitation

### 1.1 What VibeSwap Does Today

The VibeSwap `CommitRevealAuction` contract operates on a fixed 10-second batch cycle defined
by two protocol constants:

```
COMMIT_DURATION = 8 seconds
REVEAL_DURATION = 2 seconds
BATCH_DURATION  = COMMIT_DURATION + REVEAL_DURATION = 10 seconds
```

Within each batch:

1. **Commit phase**: Participants submit `keccak256(order || secret)` along with a 5%
   collateral deposit. No order content is visible to anyone.
2. **Reveal phase**: Participants reveal their orders and secrets. Unrevealed commits are
   slashed at 50%.
3. **Settlement**: A Fisher-Yates shuffle seeded by the XOR of all revealed secrets
   (augmented with future-block entropy) determines execution order. All matched orders
   clear at a single uniform price.

This design satisfies three properties simultaneously:

- **Temporal decoupling** (P-001): The decision to trade is separated from the information
  environment at execution time. No participant can condition their order on others' orders.
- **Uniform clearing**: Every participant in a batch receives the same price, eliminating
  intra-batch front-running.
- **Shapley-fair distribution**: Post-settlement rewards are allocated by marginal
  contribution, not by speed or privilege.

### 1.2 The Problem with Fixed Cadence

Ten seconds is a reasonable compromise for standard token swaps. It is short enough that
traders do not experience unacceptable latency and long enough to accumulate sufficient
order flow for meaningful price discovery. But coordination is not monolithic:

| Coordination Need             | Optimal Cadence | Why 10s Fails                              |
|-------------------------------|----------------|--------------------------------------------|
| On-chain arbitrage            | 1-2 seconds    | Stale by the time the batch settles         |
| Standard token swaps          | 10 seconds     | Works (current design)                      |
| Cross-chain settlement        | 1 minute       | LayerZero messages arrive asynchronously    |
| Protocol parameter updates    | 1 hour         | Too much churn if parameters shift per batch|
| Governance decisions          | 1 week         | Deliberation requires calendar time         |

Forcing all coordination into a single temporal window creates two failure modes:

1. **Latency mismatch**: Actors who need faster coordination are forced to wait, losing
   opportunities or creating off-protocol shortcuts that reintroduce MEV.
2. **Granularity mismatch**: Actors who need slower, more deliberate coordination are
   overwhelmed by per-batch noise, making stable decisions impossible.

The question becomes: can we offer multiple coordination speeds while preserving the same
fairness invariants at every level?

### 1.3 Thesis

**Batches within batches.** Different time horizons require different coordination speeds,
but all can share the same fairness properties. A recursive batch auction is a batch auction
whose constituent orders are themselves the aggregated outcomes of finer-grained batch
auctions, and whose own output feeds into coarser-grained batch auctions above it. If the
base mechanism is fair, the recursion preserves fairness.

---

## 2. The Fractal Batch Hierarchy

### 2.1 Five Temporal Scales

We define five batch levels, each serving a distinct coordination function:

**Level 0 — Micro-batches (1-2 seconds)**
Intra-block coordination. Multiple micro-batches can execute within a single blockchain
block (assuming ~12-second block times on Ethereum). This level serves high-frequency
coordination: arbitrage, oracle price updates, and latency-sensitive rebalancing. The
commit-reveal cycle compresses to sub-second commits with near-instant reveals. Micro-batches
are the atomic unit of the system.

**Level 1 — Meso-batches (10 seconds)**
Standard trading. This is the current VibeSwap design. A meso-batch aggregates the outcomes
of approximately 5-10 micro-batches. Retail and institutional swaps, LP position adjustments,
and routine market operations occur at this cadence. The meso-batch is the primary user-facing
coordination layer.

**Level 2 — Macro-batches (1 minute)**
Cross-chain settlement aggregation. A macro-batch collects the results of approximately 6
meso-batches and reconciles them across chains. LayerZero messages from different source
chains arrive asynchronously within the macro-batch window. Settlement at this level produces
a cross-chain clearing price that accounts for all inter-chain order flow within the window.

**Level 3 — Epoch-batches (1 hour)**
Protocol parameter updates. An epoch-batch aggregates approximately 60 macro-batches and
uses their collective data to update protocol parameters: fee tiers, circuit breaker
thresholds, oracle confidence intervals, rate limits. Changes at this level are slow enough
to be predictable but fast enough to respond to changing market conditions.

**Level 4 — Era-batches (1 week)**
Protocol evolution. An era-batch spans approximately 168 epoch-batches and governs
structural decisions: contract upgrades, new pool types, emission schedule adjustments,
constitutional amendments. Era-level decisions require broad participation and extended
deliberation, mirroring the cadence of governance in mature protocols.

### 2.2 The Nesting Structure

Each level is defined recursively:

```
Level(n) = BatchAuction(
    orders  = [aggregate_outcome(Level(n-1), batch_i) for i in 1..k],
    commit  = commit_duration(n),
    reveal  = reveal_duration(n),
    settle  = uniform_clearing(n)
)
```

Where `k` is the number of sub-batches that constitute one parent batch. The aggregate
outcome of a sub-batch becomes a single "order" in the parent batch. Concretely:

- A micro-batch settles and produces a clearing price and a set of matched trades.
- That clearing price and net order flow become inputs to the enclosing meso-batch.
- The meso-batch aggregates multiple micro-batch outcomes and settles at a coarser
  price that reflects the full 10-second window.
- This meso-outcome feeds into the enclosing macro-batch, and so on.

The recursion bottoms out at Level 0 (micro-batches contain individual orders, not
sub-batches) and tops out at Level 4 (era-batches produce governance decisions, not
trading outcomes).

### 2.3 Formal Definition

Let $\mathcal{B}_n$ denote a batch at level $n$. Each batch is a tuple:

$$\mathcal{B}_n = (C_n, R_n, S_n, \Phi_n)$$

where:
- $C_n$ is the commit phase (duration $\tau_n^c$),
- $R_n$ is the reveal phase (duration $\tau_n^r$),
- $S_n$ is the settlement function producing a uniform clearing price $p_n^*$,
- $\Phi_n$ is the Shapley distribution function for that level's rewards.

The recursive relationship:

$$\mathcal{B}_n.\text{inputs} = \{S_{n-1}(\mathcal{B}_{n-1}^{(i)}) \mid i = 1, \ldots, k_n\}$$

That is, the inputs to a level-$n$ batch are the settlement outputs of all level-$(n-1)$
batches that fall within its temporal window. The number of sub-batches $k_n$ is determined
by the ratio of batch durations: $k_n = \lfloor \tau_n / \tau_{n-1} \rfloor$.

---

## 3. Fairness Inheritance

### 3.1 The Three Invariants

We claim that three properties hold at every level of the recursion:

**Invariant 1: Temporal Decoupling.**
At level $n$, no participant can observe the content of other participants' orders before
the commit phase closes. This holds because each level implements its own independent
commit-reveal cycle. The commit hash at level $n$ is:

$$h_n = \text{keccak256}(\text{order}_n \| \text{secret}_n)$$

where $\text{order}_n$ may itself be a function of level-$(n-1)$ outcomes. The crucial
point is that the level-$n$ commit is submitted *before* the level-$n$ reveal of any
other participant, regardless of what information is available from lower levels.

**Invariant 2: Uniform Clearing.**
Each level produces a single clearing price $p_n^*$ for all orders within that batch.
At level 0, this is the standard batch auction clearing price. At level $n > 0$, the
clearing price is computed over the aggregated order flow from all sub-batches. No
participant within a level-$n$ batch receives a better price than any other participant
for the same asset pair.

**Invariant 3: Shapley Distribution.**
Rewards at each level are distributed according to Shapley values computed for the
cooperative game defined by that level's participants. The Shapley value satisfies
efficiency (all value distributed), symmetry (equal contributors earn equally), and the
null player property (no contribution implies no reward). At level $n$, the relevant
cooperative game is defined by the marginal contributions of level-$(n-1)$ outcomes to
the level-$n$ settlement.

### 3.2 Proof Sketch: Fairness Composition

The composition argument proceeds by induction on the level number.

**Base case** ($n = 0$): Micro-batches are standard commit-reveal batch auctions.
Temporal decoupling, uniform clearing, and Shapley distribution hold by the existing
VibeSwap mechanism design (see `CommitRevealAuction.sol` and `ShapleyDistributor.sol`).

**Inductive step**: Assume all three invariants hold at level $n-1$. We show they hold
at level $n$.

*Temporal decoupling at level $n$*: A level-$n$ commit is formed after observing
level-$(n-1)$ outcomes (which are public post-settlement). However, no level-$n$
participant can observe *other participants' level-$n$ commits* before the level-$n$
commit phase closes. The information from level $n-1$ is symmetric: all level-$n$
participants observe the same sub-batch outcomes. Therefore, information advantage within
level $n$ is zero. Temporal decoupling holds.

*Uniform clearing at level $n$*: The settlement function $S_n$ takes as input the
aggregate order flow from all sub-batches and computes a single clearing price. Since
all level-$n$ participants face the same clearing price, uniformity holds.

*Shapley distribution at level $n$*: The cooperative game at level $n$ is well-defined
because the inputs (sub-batch outcomes) have known, verified values (by the inductive
hypothesis). The Shapley value computed over these inputs satisfies the standard axioms.

Therefore, by induction, all three invariants hold at every level. $\square$

### 3.3 Connection to the Composition Theorem

This result is an instance of a more general principle: **mechanism composition preserves
fairness when the interface between mechanisms is itself fair**. The interface between
levels is the settlement output of the lower level, which by hypothesis satisfies uniform
clearing. Since no level can distort the outputs of the level below it (they are committed
and verified on-chain), the composition is sound.

This is precisely the structure of **Composable Fairness** as described in VibeSwap's
mechanism design: each batch level is a mechanism, and recursive composition preserves
fairness by the Composition Theorem. The key requirement is that the inter-level interface
does not leak private information or create asymmetric access — a requirement satisfied by
the commit-reveal structure at each level.

---

## 4. Information Flow: Bottom-Up Aggregation

### 4.1 The Aggregation Pipeline

Information flows upward through the hierarchy. Each level aggregates, compresses, and
publishes a summary of the activity below it:

```
Micro-batch outcome:
    {clearing_price, volume, num_orders, net_direction, entropy_seed}
        │
        ▼
Meso-batch aggregation:
    {TWAP over micro-prices, total_volume, order_count, VWAP, volatility_estimate}
        │
        ▼
Macro-batch aggregation:
    {cross_chain_clearing_price, per_chain_volumes, imbalance_direction, bridge_flows}
        │
        ▼
Epoch-batch aggregation:
    {parameter_adjustment_signals, circuit_breaker_status, oracle_confidence, utilization}
        │
        ▼
Era-batch aggregation:
    {governance_proposals, voting_outcomes, protocol_health_metrics, emission_schedule}
```

### 4.2 Information Compression

Each level compresses the information from below, discarding intra-batch details that are
irrelevant at the higher timescale. This is not merely a performance optimization; it is a
*privacy* feature. Individual micro-batch orders are not visible at the macro-batch level.
Only aggregate statistics propagate upward. This prevents higher-level actors (governance
participants, cross-chain settlers) from reconstructing individual trading behavior.

The compression ratio at each level is approximately $k_n : 1$, where $k_n$ is the number
of sub-batches. Over the full hierarchy:

```
Micro → Era compression: ~302,400 : 1
(604,800 seconds per week / 2 seconds per micro-batch)
```

A week of micro-batch activity compresses to a single era-batch summary. This is analogous
to how blockchain state commitments compress transaction history into a single root hash,
except here the compression operates over *time* rather than *state*.

### 4.3 Analogy to the Verkle Context Tree

This temporal hierarchy mirrors the **Verkle Context Tree** structure used in VibeSwap's
context management system, where episodic memory is organized into epochs, eras, and a
root summary. In the Verkle Context Tree, decisions never drop, relationships survive if
they are load-bearing, and filler dies at the epoch level. The same principle applies to
Recursive Batch Auctions:

| Verkle Context Tree          | Recursive Batch Auctions          |
|------------------------------|-----------------------------------|
| Epoch (recent memory)        | Micro/Meso-batch (recent trades)  |
| Era (compressed history)     | Macro/Epoch-batch (aggregated)    |
| Root (permanent knowledge)   | Era-batch (protocol decisions)    |
| Filler dies at epoch level   | Order details die at meso level   |
| Load-bearing relationships   | Clearing prices propagate upward  |

The Verkle Context Tree applies fractal structure to *memory*. Recursive Batch Auctions
apply fractal structure to *time*. Both are instances of the same underlying pattern:
hierarchical commitment with selective propagation.

---

## 5. Authority Flow: Top-Down Governance

### 5.1 The Constraint Pipeline

If information flows upward, *authority* flows downward. Higher levels constrain the
behavior of lower levels:

```
Era-batch:
    Sets constitutional parameters, upgrade paths, emission schedules
        │
        ▼
Epoch-batch:
    Sets operational parameters within era constraints
    (fee tiers, circuit breaker thresholds, rate limits)
        │
        ▼
Macro-batch:
    Sets cross-chain routing rules within epoch constraints
    (bridge limits, chain priorities, settlement windows)
        │
        ▼
Meso-batch:
    Executes standard trades within macro constraints
    (max trade size, slippage bounds, collateral requirements)
        │
        ▼
Micro-batch:
    Executes high-frequency operations within meso constraints
    (tick size, minimum order, gas optimization)
```

### 5.2 The Separation of Powers

This dual-flow architecture creates a natural separation of powers:

- **Lower levels** have *operational authority*: they execute quickly, with high throughput,
  but within tightly defined boundaries.
- **Higher levels** have *constitutional authority*: they change the rules slowly, with
  broad participation, but cannot directly execute individual trades.

No single level can both set the rules and execute within them simultaneously. This is
the temporal analog of the separation between `CommitRevealAuction.sol` (execution) and
`DAOTreasury.sol` (governance) in the current VibeSwap architecture — extended across a
continuous spectrum of timescales.

### 5.3 Immutability Gradient

Authority is not merely hierarchical; it is *increasingly immutable* as one ascends:

- **Micro-batch parameters** change every 1-2 seconds (the clearing price itself is a
  parameter of the next micro-batch's context).
- **Meso-batch parameters** change every 10 seconds (new batches may have different order
  flow characteristics).
- **Macro-batch parameters** change every minute (cross-chain routing may shift).
- **Epoch-batch parameters** change every hour (protocol parameters update slowly).
- **Era-batch parameters** change every week (constitutional changes require extended
  deliberation and supermajority consent).

The higher the level, the more costly and deliberate a change must be. This creates a
natural Schelling point for stability: participants can rely on era-level parameters being
stable for the duration of their planning horizon.

---

## 6. Cross-Chain Coordination

### 6.1 The Multi-Chain Timing Problem

Different blockchains produce blocks at different rates:

| Chain      | Block Time | Finality    |
|------------|-----------|-------------|
| Ethereum   | ~12s      | ~15 min     |
| Base       | ~2s       | ~15 min     |
| Arbitrum   | ~0.25s    | ~15 min     |
| Nervos CKB | ~10-36s   | ~30 min     |

A fixed 10-second batch does not align naturally with any of these. LayerZero messages
between chains have variable latency depending on source and destination chain finality
requirements, validator set activity, and network congestion.

### 6.2 The Macro-Batch as Cross-Chain Aggregator

The macro-batch (1 minute) is designed to absorb this variance. Its window is long enough
that:

1. Multiple block confirmations occur on all supported chains.
2. LayerZero messages from the fastest chain (Arbitrum, ~0.25s blocks) and the slowest
   chain (Nervos CKB, up to ~36s blocks) both arrive within the window.
3. Sufficient order flow accumulates for meaningful cross-chain price discovery.

The `CrossChainRouter` contract currently handles asynchronous message arrival. In the
recursive framework, it becomes the **Level 2 aggregator**: collecting `CrossChainCommit`
and `CrossChainReveal` messages from multiple source chains, buffering them until the
macro-batch closes, then computing a unified cross-chain clearing price.

### 6.3 Chain-Specific Sub-Batch Frequencies

Different chains naturally operate at different micro-batch and meso-batch frequencies:

```
Arbitrum:    micro = 0.5s,  meso = 5s   (fast chain, short batches)
Base:        micro = 2s,    meso = 10s  (standard)
Ethereum:    micro = 4s,    meso = 12s  (aligned with block time)
Nervos CKB:  micro = 10s,   meso = 36s  (aligned with block time)
```

These chain-specific cadences feed into a *common* macro-batch that synchronizes them.
The macro-batch does not require all chains to operate at the same speed; it only requires
that all chains submit their aggregated meso-batch outcomes before the macro-batch closes.
Chains that produce more meso-batches per macro-batch contribute more granular price
information; chains that produce fewer contribute coarser but still valid information.

### 6.4 Latency Tolerance via Hierarchical Buffering

The recursive structure provides natural latency tolerance. If a LayerZero message from
a slow chain arrives after the current meso-batch has closed but before the macro-batch
closes, it is simply included in the macro-batch aggregation. If it arrives after the
macro-batch closes, it rolls into the next macro-batch. No message is ever dropped or
rejected due to timing; it is simply assigned to the appropriate level of the hierarchy
based on its arrival time.

This is a significant improvement over flat batch architectures, where a late-arriving
cross-chain message either delays the entire batch (reducing throughput) or is excluded
(reducing fairness).

---

## 7. Game-Theoretic Properties

### 7.1 Cross-Level MEV Resistance

The central game-theoretic concern in a multi-scale system is **cross-level MEV**: the
possibility that information from one level could be exploited at another level to extract
value.

**Threat model**: An attacker observes the outcome of a micro-batch and uses that
information to front-run the enclosing meso-batch.

**Defense**: The meso-batch has its own commit-reveal cycle. By the time the micro-batch
outcome is known (post-settlement), the meso-batch commit phase may already be closed.
Even if it is still open, the attacker's meso-batch commit cannot reference the
micro-batch outcome because:

1. The meso-batch commit must be submitted as `keccak256(order || secret)` *before* the
   micro-batch settles (since micro-batches settle during the meso-batch's commit phase).
2. Even if the attacker submits a meso-batch commit *after* seeing a micro-batch outcome,
   they gain no advantage because all meso-batch participants observe the same micro-batch
   outcomes (symmetric information).
3. The meso-batch clearing price is determined by the *aggregate* of all meso-level orders,
   not by any individual micro-batch outcome.

The same argument applies at every level boundary. Commit-reveal at each level ensures
that cross-level information is either (a) symmetric (all participants see the same
sub-batch outcomes) or (b) concealed (commit hashes are opaque). There is no position
from which an attacker can see more than anyone else.

### 7.2 Nested Commitment Games

Each level defines a commitment game. At level $n$, the strategy space is:

- **Commit honestly**: Submit a genuine order and reveal truthfully.
- **Commit speculatively**: Submit multiple orders at level $n-1$ to probe the market,
  then commit at level $n$ based on sub-batch outcomes.
- **Withhold**: Commit but do not reveal (accept the 50% slash).

Speculative probing at lower levels is not an exploit; it is legitimate price discovery.
The critical property is that speculative probing at level $n-1$ does not give the prober
an *asymmetric* advantage at level $n$, because all level-$n$ participants observe the
same level-$(n-1)$ outcomes. The prober may have better *interpretive* ability (they know
which probe was theirs), but the raw information is public.

Withholding is deterred at every level by the same mechanism: a 50% collateral slash.
The recursive structure does not weaken this deterrent because each level requires its
own independent collateral deposit.

### 7.3 Cooperative Equilibrium Across Levels

The Shapley distribution at each level creates a cooperative equilibrium: participants
earn in proportion to their marginal contribution. In the recursive setting, a
participant's contribution at level $n$ is defined by how much value their level-$(n-1)$
outcomes add to the level-$n$ settlement.

This creates a virtuous cycle: honest participation at level $n-1$ produces valuable
outcomes that earn Shapley rewards at level $n$. Attempting to manipulate level $n-1$
outcomes reduces their quality (e.g., by creating artificial price dislocations that the
level-$n$ settlement corrects), which reduces the manipulator's Shapley value at level $n$.

The equilibrium is **recursively stable**: manipulation at any level reduces rewards at
the level above, and this penalty propagates upward through the hierarchy.

---

## 8. The Fibonacci Connection

### 8.1 Harmonic Scaling

The batch durations in Section 2.1 (2s, 10s, 60s, 3600s, 604800s) are chosen for
practical alignment with blockchain cadences and human timescales. However, there is a
more principled approach: **Fibonacci scaling**.

The Fibonacci sequence (1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, ...) has the property
that each term is the sum of the two preceding terms. In the context of batch auctions,
Fibonacci scaling means:

```
Level 0:  F(1)  = 1 second
Level 1:  F(3)  = 2 seconds
Level 2:  F(5)  = 5 seconds
Level 3:  F(7)  = 13 seconds
Level 4:  F(9)  = 34 seconds
Level 5:  F(11) = 89 seconds
Level 6:  F(13) = 233 seconds (~4 minutes)
Level 7:  F(15) = 610 seconds (~10 minutes)
...
```

### 8.2 Why Fibonacci?

Fibonacci scaling has three desirable properties for batch hierarchies:

**1. Golden ratio convergence.** The ratio between consecutive Fibonacci numbers converges
to the golden ratio $\phi \approx 1.618$. This means each level is approximately 1.618
times longer than the level below — a gentle, self-similar scaling that avoids the jarring
jumps of powers-of-ten scaling (where one level is 10x longer than the previous).

**2. Additive composability.** A Fibonacci-duration batch at level $n$ can be decomposed
into exactly two sub-batches at levels $n-1$ and $n-2$: $F(n) = F(n-1) + F(n-2)$. This
means a level-$n$ batch naturally contains one level-$(n-1)$ sub-batch and one
level-$(n-2)$ sub-batch, creating an overlapping hierarchical structure rather than a
strict nesting.

**3. Natural resonance.** Fibonacci numbers appear in biological timing systems (circadian
rhythms, neural oscillation frequencies, population dynamics). A batch hierarchy that
follows Fibonacci scaling may resonate more naturally with human decision-making cadences
than arbitrary geometric sequences.

### 8.3 Practical Considerations

Pure Fibonacci scaling may not align well with blockchain block times or human expectations
(traders expect round numbers). A hybrid approach uses Fibonacci ratios as *guidelines* for
scaling while rounding to practical durations:

```
Theoretical Fibonacci:  1s,  2s,   5s,  13s,  34s,  89s,   233s
Practical rounding:     1s,  2s,   5s,  12s,  30s,  60s,   300s
```

The rounding preserves the approximate golden-ratio scaling while aligning with blockchain
realities (12-second Ethereum blocks, 1-minute human attention spans, 5-minute candle
periods).

---

## 9. Implementation Considerations

### 9.1 Contract Architecture

The recursive batch auction can be implemented as a generalization of the existing
`CommitRevealAuction` contract. The key modification is parameterizing batch duration
and adding an `aggregation` function that compresses sub-batch outcomes into parent-batch
inputs:

```solidity
// Conceptual interface (simplified)
interface IRecursiveBatchAuction {
    /// @notice Batch level (0 = micro, 1 = meso, etc.)
    function level() external view returns (uint8);

    /// @notice Duration of commit phase at this level
    function commitDuration() external view returns (uint256);

    /// @notice Duration of reveal phase at this level
    function revealDuration() external view returns (uint256);

    /// @notice Reference to the child-level auction contract
    function childAuction() external view returns (IRecursiveBatchAuction);

    /// @notice Aggregate sub-batch outcomes into a parent-batch input
    function aggregate(uint64[] calldata childBatchIds)
        external
        view
        returns (AggregatedOutcome memory);

    /// @notice Commit to this level's batch (order may reference child outcomes)
    function commit(bytes32 hash, uint256 deposit) external payable;

    /// @notice Reveal and settle follows standard commit-reveal pattern
    function reveal(bytes32 commitId, bytes calldata order, bytes32 secret) external;
}
```

Each level is a separate contract instance (or a parameterized deployment of the same
contract) with a pointer to its child level. Level 0 has `childAuction = address(0)` and
accepts raw orders. Levels 1-4 accept aggregated outcomes from their children.

### 9.2 Gas Considerations

Recursive settlement introduces gas overhead from aggregation at each level. However, the
compression ratio works in our favor: a macro-batch aggregates ~6 meso-batch summaries,
not ~6 * ~5 individual orders. The aggregation at each level is $O(k_n)$ where $k_n$ is
small (typically 3-10). Total gas for a full recursive settlement is:

$$\text{Gas}_{total} = \sum_{n=0}^{4} \text{Gas}_{settle}(n) \approx \sum_{n=0}^{4} O(k_n)$$

Since the $k_n$ are small constants, the overhead is linear in the number of levels, not
exponential in the number of orders. For a 5-level hierarchy, this adds approximately 5x
the gas of a single-level settlement — a manageable overhead given that higher-level
settlements occur much less frequently.

### 9.3 Oracle Integration

The existing Kalman filter oracle feeds naturally into the recursive structure. The oracle
currently estimates a "true price" by filtering noisy observations. In the recursive
framework:

- **Micro-batch prices** are raw observations.
- **Meso-batch TWAP** (time-weighted average price) is a first-order filter.
- **Macro-batch cross-chain price** incorporates multi-chain observations.
- **Epoch-batch confidence interval** represents the oracle's uncertainty estimate.

Each level provides a progressively more refined and confident price estimate, exactly as
the Kalman filter accumulates observations over time.

---

## 10. Composable Fairness and the Composition Theorem

### 10.1 Mechanisms as Composable Units

Each batch level is a **mechanism** in the formal sense: a game form that maps participant
strategies to outcomes. The Composition Theorem for fair mechanisms states:

> If mechanism $M_1$ is fair (satisfies temporal decoupling, uniform clearing, and Shapley
> distribution) and mechanism $M_2$ is fair, then the sequential composition
> $M_2 \circ M_1$ (where $M_1$'s output feeds into $M_2$'s input) is fair, provided the
> interface between them does not introduce information asymmetry.

The Recursive Batch Auction is a tower of such compositions:

$$\mathcal{M} = M_4 \circ M_3 \circ M_2 \circ M_1 \circ M_0$$

where each $M_n$ is a level-$n$ batch auction and $\circ$ denotes "output of left feeds
into input of right." By repeated application of the Composition Theorem, the entire
tower inherits fairness from the base.

### 10.2 The Interface Condition

The Composition Theorem requires that the interface between mechanisms does not introduce
information asymmetry. In the recursive batch auction, the interface is the **settlement
output** of each level: a clearing price, a volume, and a set of matched trades. This
output is:

1. **Public**: posted on-chain, visible to all participants.
2. **Immutable**: committed to the blockchain, cannot be retroactively altered.
3. **Verified**: validated by the settlement function's on-chain logic.

No participant has privileged access to any other participant's pending orders at the
interface boundary. The interface is clean.

### 10.3 Failure Modes and Circuit Breakers

The recursive structure introduces a new failure mode: **cascade failure**, where a
problem at a lower level propagates upward. For example, if micro-batch settlement fails
(due to a bug, a gas spike, or an attack), the meso-batch that depends on it cannot
settle correctly.

The defense is **level-specific circuit breakers**. Each level monitors the health of
its sub-batches and can:

1. **Pause**: Halt its own settlement until the sub-level issue is resolved.
2. **Fallback**: Use the last known good sub-batch outcome as a substitute.
3. **Escalate**: Propagate the failure upward as a signal to the epoch or era level,
   which may trigger parameter adjustments or governance intervention.

This mirrors the existing `CircuitBreaker.sol` contract in VibeSwap, extended to operate
at each level of the hierarchy with level-appropriate thresholds.

---

## 11. Discussion

### 11.1 Relationship to Existing Literature

Recursive batch auctions draw on several traditions:

- **Frequent batch auctions** (Budish, Cramton, and Shim, 2015): The original proposal
  for discrete-time trading to replace continuous limit order books. VibeSwap's 10-second
  batch is an implementation of this idea with commit-reveal for MEV resistance.
- **Hierarchical mechanism design** (Mookherjee, 2006): The study of mechanism design
  across organizational layers, where higher layers delegate to lower layers.
- **Fractal markets hypothesis** (Peters, 1994): The observation that financial markets
  exhibit self-similar behavior across timescales, suggesting that coordination mechanisms
  should be similarly self-similar.
- **Composable mechanism design** (various, 2020s): The emerging study of how individual
  mechanisms can be composed without losing their desirable properties.

Recursive Batch Auctions synthesize these threads into a single, implementable framework.

### 11.2 What This Is Not

This paper does not claim that all coordination problems can be solved by recursive batch
auctions. Specifically:

- **Real-time applications** (e.g., high-frequency market making with sub-millisecond
  requirements) cannot be served even by micro-batches. Such applications are outside the
  scope of decentralized, on-chain coordination.
- **Non-financial coordination** (e.g., social governance, dispute resolution) may require
  mechanisms that are not batch auctions at all. The era-batch level interfaces with
  governance but does not replace it.
- **Privacy-preserving computation** (e.g., MPC-based order matching) is orthogonal to
  the temporal structure and can be composed with it.

### 11.3 The Deeper Pattern

The recursive batch auction is an instance of a pattern that recurs throughout VibeSwap's
architecture: **self-similar structures that preserve properties across scales**. The
Verkle Context Tree preserves decision coherence across memory timescales. The Shapley
distribution preserves fairness across different types of contribution. The commit-reveal
mechanism preserves information symmetry across different phases of a batch.

Recursive Batch Auctions extend this pattern to the temporal dimension of market
coordination. The unifying insight is that fairness is not a property of a specific
mechanism at a specific scale — it is a *structural invariant* that can be maintained
across a hierarchy of mechanisms at any scale, provided the composition is done correctly.

This is, ultimately, an expression of P-000 (Fairness Above All) extended from a static
principle to a dynamic, multi-scale architecture. The mechanism does not merely enforce
fairness at one timescale; it *generates* fairness at every timescale through recursive
application of the same fundamental primitives.

---

## 12. Conclusion

The fixed 10-second batch auction is the correct foundation. It is simple, battle-tested,
and satisfies the three fairness invariants that VibeSwap requires. But the world does not
coordinate at a single speed. Cross-chain settlement, high-frequency arbitrage, and
protocol governance each demand their own temporal cadence.

Recursive Batch Auctions provide a principled answer: nest batches within batches, with
each level inheriting the fairness properties of the level below. Information flows upward
through aggregation; authority flows downward through constraint. The result is a unified
coordination framework that spans seven orders of magnitude in time (seconds to weeks)
while maintaining the same MEV resistance, uniform clearing, and Shapley-fair distribution
at every level.

The fractal structure is not an arbitrary design choice. It emerges naturally from the
requirement that fairness must hold at every scale. If a 10-second batch is fair, then a
1-minute batch composed of six fair sub-batches is fair. If a 1-minute batch is fair, then
a 1-hour batch composed of sixty fair sub-batches is fair. The recursion is the proof.

What begins as a mechanism for fair trading becomes, through recursive application, a
mechanism for fair coordination at any timescale — from the microsecond tick of an
arbitrage opportunity to the week-long deliberation of a protocol upgrade. This is the
promise of composable fairness: build one mechanism correctly, and the tower stands at
any height.

---

## References

1. Budish, E., Cramton, P., & Shim, J. (2015). The High-Frequency Trading Arms Race:
   Frequent Batch Auctions as a Market Design Response. *Quarterly Journal of Economics*,
   130(4), 1547-1621.

2. Daian, P., Goldfeder, S., Kell, T., Li, Y., Zhao, X., Bentov, I., Breidenbach, L.,
   & Juels, A. (2020). Flash Boys 2.0: Frontrunning in Decentralized Exchanges, Miner
   Extractable Value, and Consensus Instability. *IEEE S&P*.

3. Glynn, W. (2026). Cooperative Markets: A Mathematical Foundation for Fair Exchange.
   VibeSwap Working Paper.

4. Glynn, W. (2026). Mechanism Insulation: Why Fees and Governance Must Be Separate.
   VibeSwap Technical Note.

5. Mookherjee, D. (2006). Decentralization, Hierarchies, and Incentives: A Mechanism
   Design Perspective. *Journal of Economic Literature*, 44(2), 367-390.

6. Peters, E. (1994). *Fractal Market Analysis: Applying Chaos Theory to Investment and
   Economics*. John Wiley & Sons.

7. Shapley, L. S. (1953). A Value for N-Person Games. In H. W. Kuhn & A. W. Tucker (Eds.),
   *Contributions to the Theory of Games II* (pp. 307-317). Princeton University Press.

8. Roughgarden, T. (2021). Transaction Fee Mechanism Design. *ACM Conference on Economics
   and Computation*.

---

## Appendix A: Batch Duration Table

| Level | Name         | Duration   | Sub-batches | Commit Phase | Reveal Phase | Function                          |
|-------|-------------|------------|-------------|--------------|--------------|-----------------------------------|
| 0     | Micro-batch | 1-2s       | N/A (atomic)| ~1.5s        | ~0.5s        | High-frequency coordination       |
| 1     | Meso-batch  | 10s        | 5-10 micro  | 8s           | 2s           | Standard trading                  |
| 2     | Macro-batch | 60s        | 6 meso      | 48s          | 12s          | Cross-chain settlement            |
| 3     | Epoch-batch | 3600s      | 60 macro    | 2880s        | 720s         | Parameter updates                 |
| 4     | Era-batch   | 604800s    | 168 epoch   | 483840s      | 120960s      | Protocol evolution / governance   |

Note: Commit/reveal ratios maintain the 80/20 split from the base VibeSwap design at every
level. This ratio is a protocol constant, not a level-specific parameter.

## Appendix B: Cross-Level MEV Impossibility (Informal Argument)

**Claim**: No strategy that observes level-$(n-1)$ outcomes and acts at level $n$ can
extract MEV that would not be available to any other level-$n$ participant.

**Argument**: Level-$(n-1)$ settlement is public. All level-$n$ participants observe the
same sub-batch outcomes. Any strategy based on sub-batch observation is available to all
participants equally. In a commit-reveal setting, the only way to gain advantage is to
see others' commits before committing yourself — which the commit-reveal mechanism at
level $n$ prevents. Therefore, cross-level information does not create asymmetric advantage.

The key subtlety: a participant who *also* participated in the level-$(n-1)$ batch knows
which orders were theirs. This gives them interpretive context that other level-$n$
participants lack. However, this interpretive advantage is bounded: knowing your own
order does not reveal others' orders, and the level-$n$ clearing price depends on the
*aggregate* of all level-$n$ orders, which is hidden during the commit phase.

## Appendix C: Notation Summary

| Symbol              | Meaning                                                      |
|---------------------|--------------------------------------------------------------|
| $\mathcal{B}_n$     | Batch at level $n$                                           |
| $C_n, R_n, S_n$     | Commit, Reveal, Settlement functions at level $n$            |
| $\Phi_n$            | Shapley distribution function at level $n$                   |
| $\tau_n$            | Total batch duration at level $n$                            |
| $\tau_n^c, \tau_n^r$| Commit and reveal durations at level $n$                     |
| $p_n^*$             | Uniform clearing price at level $n$                          |
| $k_n$               | Number of sub-batches in a level-$n$ batch                   |
| $M_n$               | Mechanism at level $n$ (formal game-theoretic sense)         |
| $\phi$              | Golden ratio ($\approx 1.618$)                               |
| $F(n)$              | $n$-th Fibonacci number                                      |

---

*"The mechanism does not merely enforce fairness at one timescale; it generates fairness
at every timescale through recursive application of the same fundamental primitives."*

*P-000: Fairness Above All. At every scale.*

---

## See Also

- [Commit-Reveal Batch Auctions (paper)](../research/papers/commit-reveal-batch-auctions.md) — Core mechanism: temporal decoupling, Fisher-Yates shuffle, uniform clearing
- [From MEV to GEV (paper)](../research/papers/from-mev-to-gev.md) — Nine-component GEV resistance architecture
- [Five-Layer MEV Defense on CKB](../research/papers/five-layer-mev-defense-ckb.md) — CKB-specific five-layer defense analysis
- [Commit-Reveal (Nervos post)](../marketing/forums/nervos/talks/commit-reveal-batch-auctions-post.md) — CKB cell model advantages and temporal enforcement
