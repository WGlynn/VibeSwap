# From MEV to GEV: An Architecture for Generalized Extractable Value Resistance

**William Glynn**
*VibeSwap -- Independent Research*
*April 2026*

---

## Abstract

Maximal Extractable Value (MEV) has dominated DeFi security discourse since its formalization by Daian et al. (2019). Current solutions -- private mempools, MEV auctions, proposer-builder separation, encrypted order flow -- treat MEV as an isolated pathology. We argue that MEV is a *feature* of transparent mempools and sequential execution, not a bug. The real threat is **Generalized Extractable Value (GEV)**: any value that a privileged actor can capture from a system's participants by exploiting structural asymmetries in information, governance, timing, or capital access. We identify seven distinct GEV vectors present across major DeFi protocols and present a nine-component architecture that eliminates GEV through structural design rather than social promises.

The architecture comprises: (1) commit-reveal batch auctions with 8-second commit and 2-second reveal windows; (2) uniform clearing prices that eliminate intra-batch price discrimination; (3) Fisher-Yates shuffle using XORed user secrets for unpredictable execution ordering; (4) 50% slashing for invalid reveals as a credible commitment device; (5) Shapley value distribution for contribution-proportional rewards; (6) a six-layer defense stack spanning reentrancy through game theory; (7) zero protocol fees as a structural non-extraction constraint (Policy P-001); (8) rate-of-change guards that bound state variable velocity; and (9) collateral path independence requiring every code path to validate independently.

53 rounds of adversarial review produced 128+ findings across 9 contracts, all resolved to 100% closure on CRITICAL, HIGH, and LOW severities. The system has reached discovery ceiling -- the point at which sustained adversarial review produces zero new findings. The central claim is architectural: MEV-resistance is a feature; GEV-resistance is a design principle that must be applied at every layer of a financial system, not bolted onto one.

**Keywords:** MEV, extractable value, mechanism design, Shapley values, cooperative game theory, DeFi, rent-seeking, batch auctions

---

## 1. Introduction

### 1.1 MEV as Feature, Not Bug

Every blockchain with a transparent mempool and sequential transaction execution produces MEV. This is not a failure of implementation. It is a consequence of two architectural choices that most blockchains share: pending transactions are visible before execution, and their ordering determines economic outcomes. Given these two properties, the existence of actors who exploit ordering for profit is not surprising -- it is inevitable.

Flashbots reports cumulative MEV extraction exceeding $680 million on Ethereum mainnet through 2024 [5]. The annual run rate continues to accelerate with DeFi volume growth. Sandwich attacks, front-running, back-running, and just-in-time liquidity provision are not pathologies of a broken system. They are the rational strategies of economically motivated actors operating within a system whose architecture rewards ordering advantage.

Recognizing MEV as a feature rather than a bug is the first step toward a correct solution. Systems that treat MEV as a bug to be patched inevitably produce partial fixes -- private mempools that shift trust to relay operators, MEV auctions that redistribute extraction rather than eliminating it, encrypted mempools that defer extraction to the decryption moment. These solutions address symptoms. The architecture we present addresses the structure.

### 1.2 The Insufficiency of Current Solutions

**Flashbots Protect / MEV-Share.** Transactions are routed through a private relay to avoid the public mempool. The relay operator and connected builders have full visibility into order flow. MEV-Share explicitly preserves extraction as a revenue stream, sharing profits between searchers and users. The trust model shifts from "anyone can extract" to "the relay chooses who extracts." Extraction is redistributed, not eliminated.

**Proposer-Builder Separation (PBS).** Ethereum's PBS separates block proposal (selecting which block to build) from block building (constructing the block's contents and ordering). This reduces but does not eliminate the builder's ability to extract. The builder still sees all transactions and controls their ordering within the block. PBS is a governance reform of the extraction supply chain, not a structural fix.

**Encrypted Mempools (Shutter Network, threshold encryption).** Transactions are encrypted until a threshold of key holders collaboratively decrypts them. This prevents frontrunning during the encrypted period but reintroduces MEV at the moment of decryption: once orders are visible and processed sequentially, ordering advantage returns. The trust model depends on the threshold committee's honesty and liveness.

**Private Order Flow (CoW Protocol).** Off-chain solvers find Coincidences of Wants (CoWs) and batch-match orders when possible. When CoWs do not exist, orders are routed to on-chain AMMs subject to standard MEV. Protection is conditional on the existence of matching counterparties, not structural.

Each of these solutions addresses MEV specifically -- the extraction of value through transaction ordering manipulation. None addresses the broader class of extraction that we define in the next section.

### 1.3 Beyond MEV

Every major DeFi protocol solves a real problem. Chainlink solved oracle reliability. AAVE solved permissionless lending. Curve solved low-slippage stablecoin trading. Synthetix solved synthetic asset issuance. Then each one installed a tollbooth in front of the solution.

LINK holders extract rent from oracle queries without providing data. AAVE governance token holders extract protocol revenue without providing liquidity. CRV's vote-escrow mechanism created a permanent governance aristocracy monetized through bribe markets (Convex, Votium). SNX stakers bear socialized debt risk without attribution of their marginal contribution.

These are not bugs. They are features -- features designed to capture value for intermediaries at the expense of the users who generate it. MEV is merely the most visible instance because it operates on millisecond timescales and leaves on-chain evidence. But the extraction is the same whether it takes milliseconds (sandwich attacks), months (VC lockup dumps), or is continuous (token rent on every transaction).

We propose that the correct unit of analysis is not MEV but **GEV** -- the total extractable value across all structural asymmetries in a protocol. A system is GEV-resistant when no participant can extract disproportionate value relative to their marginal contribution.

---

## 2. GEV: A Generalized Framework

### 2.1 Formal Definition

Let $P$ be a protocol with participant set $N = \{1, 2, \ldots, n\}$. For each participant $i$, define:

- $v_i$ -- the value participant $i$ generates for the protocol (liquidity provision, trade volume, data contribution)
- $\phi_i$ -- participant $i$'s Shapley value: their marginal contribution averaged across all possible coalitions
- $r_i$ -- the value participant $i$ actually receives from the protocol

**Definition.** The **Generalized Extractable Value** of protocol $P$ is:

$$GEV(P) = \sum_{i \in N} \max(0, r_i - \phi_i)$$

This is the total value received by participants in excess of their Shapley-fair share. A protocol is **GEV-resistant** if and only if $GEV(P) = 0$ -- no participant receives more than their marginal contribution warrants.

### 2.2 The Seven Vectors

We identify seven distinct GEV vectors, each exploiting a different structural asymmetry:

| Vector | Abbreviation | Asymmetry Exploited | Who Extracts | Who Pays |
|--------|-------------|---------------------|--------------|----------|
| Transaction Ordering | MEV | Mempool visibility + sequential execution | Builders, searchers, validators | Traders (worse execution prices) |
| Governance | GoEV | Concentrated governance token control | Large token holders, bribe markets | Users subject to governance parameters |
| Token Rent-Seeking | TrEV | Mandatory token intermediation | Token holders earning rent | Users paying inflated service costs |
| Capital Formation | CfEV | Asymmetric pre-public token access | VCs, insiders, advisors | Public market participants |
| Oracle | OrEV | Control of off-chain to on-chain data pipeline | Oracle operators, latency arbitrageurs | Protocols consuming price feeds |
| Platform | PlEV | Platform control over user relationships and data | Platform operators, data brokers | Users whose activity generates value |
| Liquidation | LqEV | Priority access to liquidation transactions | Liquidation bots, sequencer operators | Borrowers receiving worse prices |

### 2.3 Properties of GEV

**Comprehensiveness.** MEV captures only transaction-ordering extraction. GEV captures all structural extraction, including governance, tokenomics, capital formation, and platform effects.

**Shapley grounding.** GEV is measured against the Shapley value -- the unique allocation satisfying efficiency, symmetry, linearity, and the null player property. This is not an arbitrary fairness criterion; it is the only allocation that satisfies all four axioms of cooperative game theory simultaneously (Shapley, 1953).

**Structural, not behavioral.** GEV measures extraction potential embedded in protocol design, not individual bad behavior. A protocol with GEV > 0 enables extraction even if no participant currently exploits it. The vulnerability is structural, and the fix must be structural.

### 2.4 The Conservation of Extraction

A protocol that eliminates MEV but retains GoEV is not GEV-resistant. The governance token holders will extract value through parameter manipulation even if they cannot frontrun trades. The extraction relocates to the governance layer.

**Extraction is conserved across layers.** Eliminating it at one layer without eliminating it at all layers merely redirects it. MEV-resistant protocols with rent-seeking governance tokens have not reduced GEV -- they have relocated it.

**Corollary:** GEV-resistance must be applied at every layer simultaneously. It is an architectural property, not a feature.

---

## 3. Architecture

The architecture comprises nine components, each addressing one or more GEV vectors. No single component is sufficient. Their composition is the contribution.

### 3.1 Commit-Reveal Batch Auctions

**GEV vectors addressed:** MEV, LqEV

Orders are submitted as cryptographic commitments during an 8-second commit phase:

```
commitHash = keccak256(trader, tokenIn, tokenOut, amountIn, minAmountOut, secret)
```

The hash is a one-way function. No observer can determine the order's contents. The trader also submits a deposit (minimum 0.001 ETH or 5% of estimated trade value) as collateral against failure to reveal.

During the 2-second reveal phase, traders broadcast their original order parameters and their secret. The contract reconstructs the hash and verifies it matches the stored commitment.

This is a sealed-bid auction. Under the revelation principle, truthful bidding is weakly dominant. Orders are invisible during the commit phase, so there is nothing to frontrun. The 10-second batch window replaces the continuous order flow that creates MEV opportunity.

The same mechanism applies to liquidations in the perpetual trading engine (VibePerpEngine). Liquidations are batched, shuffled, and settled at uniform clearing prices -- eliminating the liquidation MEV (LqEV) that dominates protocols like Hyperliquid and dYdX where the sequencer has privileged access to liquidation ordering.

**Flash loan protection.** The contract enforces single-block interaction limits: `lastInteractionBlock[msg.sender] == block.number` causes revert. This prevents flash loan attacks where an attacker borrows capital, commits, reveals, and repays within a single transaction.

### 3.2 Uniform Clearing Price

**GEV vectors addressed:** MEV, LqEV

All orders in a batch execute at a single price computed to maximize matched volume -- the intersection of aggregate supply and demand curves:

$$p^* = \arg\max_p \min(D(p), S(p))$$

Every buy order at or above $p^*$ fills. Every sell order at or below $p^*$ fills. There is no individual price impact. A trader buying 100 tokens and a trader buying 100,000 tokens pay the same price per token.

This is the property that makes sandwich attacks structurally impossible. A sandwich attack requires price differential between the attacker's transactions and the victim's. When every order in a batch executes at the same price, there is no differential to capture. The attack produces zero expected profit regardless of the attacker's information, capital, or ordering capability.

**TWAP validation.** The clearing price is checked against the time-weighted average price oracle. If the clearing price deviates more than 5% from the TWAP, the batch is flagged for review or rejected. This prevents oracle manipulation and stale-price exploitation.

### 3.3 Fisher-Yates Shuffle

**GEV vectors addressed:** MEV

The execution order of non-priority orders is determined by a Fisher-Yates shuffle (the standard algorithm for generating uniformly random permutations). The shuffle seed is generated in two stages:

1. XOR all revealed user secrets: `seed = secret_1 XOR secret_2 XOR ... XOR secret_n`
2. Mix in unpredictable block entropy: `finalSeed = keccak256(seed, blockhash(revealEndBlock), batchId, n)`

The XOR of secrets ensures every participant contributes to the randomness. The block entropy (from a block produced *after* the reveal phase ends) ensures that even the last revealer cannot predict the final seed, because `blockhash(revealEndBlock)` is unknown during the reveal phase. The Fisher-Yates algorithm then produces a uniformly random permutation of order indices.

Randomness derivation is iterative: `currentSeed = keccak256(seed, i)` and `j = uint256(currentSeed) % (i + 1)`. The permutation is deterministic given the seed, so any verifier can independently reproduce and confirm the execution order.

For batches with priority orders (explicit bids for earlier execution), the `DeterministicShuffle` library uses `partitionAndShuffle`: priority orders occupy the first positions sorted by bid amount descending; only regular orders are shuffled.

**Why this matters even with uniform pricing.** In batches where liquidity is insufficient to fill all orders, execution order determines which orders are fully filled versus partially filled. Without the shuffle, an attacker controlling execution order could ensure their orders fill first. The shuffle makes fill priority random, eliminating this residual MEV vector.

### 3.4 50% Slashing for Invalid Reveals

**GEV vectors addressed:** MEV (griefing), general manipulation

The 50% slashing rate on invalid reveals creates a credible commitment device. Three deviation strategies and their costs:

**Not revealing (strategic withdrawal).** Cost: 50% deposit slashed. The expected loss exceeds the expected benefit of selective withdrawal in all but extreme edge cases, because the 2-second reveal window provides limited signal from other reveals.

**False commitment (committing one order, revealing another).** Cost: hash mismatch triggers automatic 50% slashing. Benefit: none; the contract enforces cryptographic binding.

**Flooding with fake commits.** Cost: each commitment requires a deposit; unrevealed commitments are slashed 50%. The attacker pays `n * deposit * 0.5` for `n` fake commits. The clearing price is computed only from *revealed* orders, so fake commits have no effect on price.

The 50% rate satisfies two constraints: high enough to deter griefing (1% would permit cheap batch pollution), low enough to not deter honest participation (99% would scare users afraid of network-latency-induced reveal failures). Slashing proceeds flow to the DAO treasury, funding cooperative mechanisms rather than being burned.

### 3.5 Shapley Value Distribution

**GEV vectors addressed:** TrEV, CfEV, GoEV, PlEV

The `ShapleyDistributor` contract implements cooperative game theory for reward allocation. Each economic event -- batch settlement, fee distribution, token emission -- is an independent cooperative game. Participants receive rewards proportional to their *marginal contribution* across four dimensions:

| Dimension | Weight | BPS | Purpose |
|-----------|--------|-----|---------|
| Direct contribution | 40% | 4000 | Raw liquidity/volume provided |
| Enabling duration | 30% | 3000 | Time in pool (enabled others to trade) |
| Scarcity supply | 20% | 2000 | Providing the scarce side of the market |
| Volatility persistence | 10% | 1000 | Remaining during adverse conditions |

The multi-dimensional scoring is load-bearing. A whale who deposits $10 million for one block earns a high direct score but near-zero enabling, scarcity, and stability scores. A smaller LP who provides $10,000 for six months, stays during a crash, and supplies the scarce side of a buy-heavy market earns lower direct scores but high scores in the other three dimensions. The Shapley weighting can cause the smaller LP's proportional reward to exceed the whale's, because the smaller LP's *marginal contribution to the cooperative game* is greater.

The implementation satisfies five axioms:

1. **Efficiency:** `SUM(phi_i) = v(N)`. All value is distributed.
2. **Symmetry:** Equal contributors receive equal rewards regardless of identity.
3. **Null player:** Zero contribution yields zero reward.
4. **Pairwise Proportionality:** For any two participants, `|phi_i * w_j - phi_j * w_i| <= epsilon`. Verified on-chain in O(1) via cross-multiplication in `PairwiseFairness.sol`.
5. **Time Neutrality:** For fee distribution games, identical contributions yield identical rewards regardless of when the game occurs.

The pairwise verification formula enables any participant to verify their allocation is fair without trusting the protocol. This is O(1) on-chain checking -- no off-chain computation required for verification.

**The Cave Theorem.** Foundational contributions (early liquidity provision, pool creation) earn more by the mathematics of Shapley values because they appear in more coalitions. This is not a timestamp advantage or insider access -- it is the mathematical consequence of marginal contribution being higher when the coalition is small.

### 3.6 Six-Layer Defense Stack

**GEV vectors addressed:** All vectors (defense-in-depth)

Six independent defense layers operate at different abstraction levels. Each addresses a distinct attack surface. No single layer is sufficient; their composition creates defense-in-depth where an attacker must simultaneously breach all layers.

**Layer 1: Reentrancy guards.** All state-mutating functions use OpenZeppelin's `ReentrancyGuardUpgradeable`. The `nonReentrant` modifier prevents callback-based attacks where a malicious contract re-enters during execution to manipulate state. This is the innermost defense -- it prevents the most basic class of smart contract exploits.

**Layer 2: Flash loan protection.** The `lastInteractionBlock` mapping enforces that each address can interact at most once per block. This prevents flash loan attacks where an attacker borrows unlimited capital, manipulates state, and repays within a single transaction. The one-interaction-per-block constraint forces attackers to hold capital across blocks, exposing them to price risk and capital costs.

**Layer 3: TWAP validation.** Clearing prices are validated against time-weighted average prices. Maximum deviation is 5% (`TWAP_MAX_DEVIATION`). This catches oracle manipulation attacks where an attacker pushes the spot price away from the true market price to create favorable clearing prices. The TWAP smooths over short-term price spikes, requiring sustained manipulation over multiple windows to move the reference price.

**Layer 4: Circuit breakers.** Five independent breaker types -- volume, price, withdrawal, true price, and cross-validation -- monitor different attack surfaces using rolling-window accumulators. When a threshold is breached, trading halts automatically with graduated fee surcharges (50-500 basis points) rather than binary pauses. The circuit breaker system operates autonomously: no multisig, no governance vote, no human in the loop. Protocol constants, not pool parameters -- cannot be weakened by pool creators.

```
Volume breaker:     10M tokens/hour cumulative threshold
Price breaker:      5% deviation from TWAP
Withdrawal breaker: 25% of TVL in rolling window
True price:         Kalman filter regime detection
Cross-validation:   Disagreement between independent oracle sources
```

**Layer 5: Rate limiting.** Individual users are capped at 100,000 tokens per hour, preventing batch domination by any single actor. Trade sizes are capped at 10% of pool reserves (`MAX_TRADE_SIZE_BPS = 1000`). These are per-user, per-pool limits that prevent a single actor from monopolizing a batch or draining a pool.

**Layer 6: Game-theoretic incentives.** The Shapley distribution, slashing mechanism, priority auction, and loyalty rewards create an incentive landscape where honest participation is the dominant strategy. Defection is not merely punishable -- it is economically irrational given the mechanism design. The 50% slashing on invalid reveals, the loyalty penalty redistribution from early exits, and the reputation-gated insurance discounts all align individual incentives with collective welfare.

The layers compose multiplicatively: an attack must breach reentrancy protection AND survive flash loan checks AND pass TWAP validation AND avoid circuit breaker activation AND stay within rate limits AND overcome game-theoretic penalties. The product of breach probabilities approaches zero.

### 3.7 Zero Protocol Fees (P-001: No Extraction Ever)

**GEV vectors addressed:** PlEV, TrEV

Policy P-001 is a structural constraint, not a governance promise: the protocol itself cannot extract rent from users. This is expressed as a code-level invariant, not a parameter that governance can modify.

100% of trading fees flow to liquidity providers via Shapley distribution. Zero percent accrues to the protocol or to governance token holders as rent. Bridge transfers carry 0% protocol fees. The DAO treasury is funded exclusively by priority auction bids (voluntary) and slashing penalties (punitive) -- never by taxing normal user activity.

This eliminates PlEV and TrEV simultaneously. If the protocol charges no fees and requires no token intermediation, there is no rent to extract and no tollbooth to capture. The token (VIBE) is a governance instrument, not a rent-collection mechanism.

**Why this is structural, not promised.** Governance decisions can be captured. Fee parameters set by governance can be modified by token holder votes. P-001 removes fees from the governance surface entirely. The fee rate is a protocol constant, not a governance-adjustable parameter. Changing it requires a contract upgrade, not a vote -- and the upgrade is constrained by the UUPS proxy pattern with owner authorization.

**Revenue model without extraction.** The protocol sustains itself through: priority auction bids (users voluntarily pay for execution priority within a fairly-priced batch), slashing penalties (bad actors fund the treasury through their own failed manipulation attempts), and cross-chain bridge usage fees (optional, currently 0%, available as future revenue if needed). All revenue sources are either voluntary or punitive -- never extractive from normal honest usage.

### 3.8 Rate-of-Change Guards

**GEV vectors addressed:** MEV, OrEV (temporal manipulation)

Absolute bounds on state variables are necessary but insufficient. An attacker can swing a value from negative maximum to positive maximum in a single transaction if there is no velocity limit. Rate-of-change guards bound the first derivative of critical state variables.

**Formal principle:** For every externally-observable state variable $x$, define $|dx/dt| < R$ where $R$ is the maximum permitted rate of change per time window.

Concrete implementations:

- **TWAP oracle:** Per-window drift caps prevent sudden price jumps from propagating into reference prices. The TWAP smooths over a configurable window (default: 30 minutes), and the maximum per-window deviation is 5%.
- **Liquidity sync:** Cross-chain liquidity messages enforce percentage change limits per message. A single LayerZero message cannot report a liquidity change exceeding the maximum permitted delta.
- **Circuit breaker accumulation:** After a breaker trips and cools down, the accumulator resets. This prevents slow-burn attacks that accumulate value just below the threshold over many windows and then spike to exploit the accumulated headroom.

This pattern was identified across three independent findings in adversarial review rounds R24, R41, and R48 (see Section 5). The architectural fix -- velocity bounds on every externally-observable state variable -- is now applied as a design principle across the entire codebase, not as individual patches.

### 3.9 Collateral Path Independence

**GEV vectors addressed:** All vectors (defense-in-depth)

Multiple code paths can reach the same state change: direct reveal, batch reveal via `VibeSwapCore`, cross-chain reveal via `CrossChainRouter`. If only one path validates collateral, the others are bypass vectors.

**Principle:** Every path that touches user funds validates independently. Defense in depth at the leaf function, not the entry point.

This means the `CommitRevealAuction` contract validates collateral requirements regardless of whether the call originates from a user's direct transaction, from the core orchestrator, or from a cross-chain message relay. No function assumes "the caller must have checked." Every function that modifies economic state performs its own validation.

The principle extends to circuit breakers: every entry point checks breaker status independently. Every path that can pause or unpause validates authority independently. Every path that can slash validates the slashing conditions independently. Shared trust assumptions between code paths are treated as vulnerabilities, not optimizations.

---

## 4. Composability Constraints

GEV-resistance is not compositional by default. Two GEV-resistant modules can create GEV when composed if their interface permits extraction.

**Example:** A GEV-resistant lending protocol composed with a GEV-resistant oracle can still create OrEV if the lending protocol's liquidation threshold depends on oracle latency that a sophisticated actor can anticipate.

Three composability constraints ensure GEV-resistance is preserved under module composition:

1. **Unified Shapley attribution.** All modules read `ShapleyDistributor` for reward distribution. There is one canonical attribution mechanism, not per-module attribution that could be gamed across boundaries.

2. **Unified contribution tracking.** All modules write to `ContributionDAG` for credit. Cross-module contributions are tracked in a single directed acyclic graph, preventing double-counting or attribution gaps at module boundaries.

3. **Unified circuit breaking.** All modules use `CircuitBreaker` for safety. Volume, price, and withdrawal circuit breakers apply globally, preventing cross-module cascading failures that create extraction opportunities.

If every value flow passes through Shapley attribution, every credit is recorded in one graph, and every risk is bounded by one breaker, then no cross-module extraction is possible that is not caught by one of the three constraints.

---

## 5. Security Analysis: 53 Rounds of Adversarial Review

### 5.1 Methodology

The Trinity Recursion Protocol (TRP) is a structured adversarial review process. Each round targets specific contracts with defined scope. R1-type rounds (adversarial code review) identify vulnerabilities. Findings are classified by severity (CRITICAL, HIGH, MEDIUM, LOW), fixed, and verified in subsequent rounds.

53 rounds were conducted across 9 core contracts between sessions 16 and 53 of the development process. Each round produced a formal finding report with severity classification, root cause analysis, and fix verification.

### 5.2 Aggregate Results

| Severity | Found | Closed | Open | Closure Rate |
|----------|-------|--------|------|-------------|
| CRITICAL | 3 | 3 | 0 | 100% |
| HIGH | 27 | 27 | 0 | 100% |
| MEDIUM | 48 | 47 | 1* | 98% |
| LOW | 18 | 18 | 0 | 100% |
| **Total** | **96+** | **95** | **1** | **99%** |

\*AMM-07 (fee path inconsistency) intentionally deferred as a design decision, not a bug.

Additional findings in documentation, test infrastructure, and integration patterns bring the total above 128.

### 5.3 Discovery Density by Contract

| Contract | Findings | Ceiling Round | Status |
|----------|----------|---------------|--------|
| CrossChainRouter | 25+ | R48 | Saturated |
| CommitRevealAuction | 15+ | R46 | Saturated |
| ShapleyDistributor | 15+ | R43 | Saturated |
| VibeAMM | 10+ | R41 | Saturated (1 design defer) |
| CircuitBreaker | 9 | R40 | Saturated |
| FeeController | 3 | R17 | Saturated |
| VibeSwapCore | 2 | R25 | Saturated |

"Saturated" means 3+ consecutive rounds with zero new findings on that contract. The system reached global discovery ceiling at R50-R53, where rounds shifted entirely to test infrastructure verification rather than contract logic review.

### 5.4 The 12 Recurring Vulnerability Patterns

The 128+ individual findings cluster around 12 recurring architectural patterns. These patterns generalize beyond VibeSwap to any protocol with batch processing, cross-chain messaging, game-theoretic incentives, or proxy architectures:

1. **Deposit Identity Propagation** (10+ findings). When a proxy acts on behalf of a user, `msg.sender` becomes the proxy. Every downstream operation recording "who deposited" captures the wrong address. Fix: explicit `address depositor` parameter threading.

2. **Settlement-Time Binding** (3 findings). Parameters bound at game creation time but read at settlement create TOCTOU manipulation windows. Fix: read economic parameters at settlement time or snapshot at commitment time.

3. **Rate-of-Change Guards** (3 findings). Absolute bounds without velocity bounds allow single-transaction max-to-min swings. Fix: `|dx/dt| < RATE` for every externally-observable state variable. (See Section 3.8.)

4. **Collateral Path Independence** (3 findings). Multiple code paths reaching the same state change with inconsistent validation. Fix: every path validates independently. (See Section 3.9.)

5. **Batch Invariant Verification** (3 findings). Sequential operations within a batch creating ordering advantages when invariants are checked mid-batch. Fix: snapshot before batch, execute all operations, verify invariant after batch.

6. **State Accounting Invariants** (9 findings). Single counters tracking aggregate state breaking under multi-entity conditions. Fix: per-entity tracking with explicit `sum(individual) == aggregate` invariant on every mutation.

7. **Parameter Validation** (7 findings). Admin setters accepting zero as valid, enabling denial-of-service (rate limit = 0 means no messages). Fix: every setter validates non-zero where applicable, within documented range.

8. **Proxy Pattern Consistency** (4 findings). Contracts using `Initializable` without `UUPSUpgradeable`, or upgradeable by anyone. Fix: uniform UUPS pattern across all upgradeable contracts.

9. **Emergency Recovery Paths** (4 findings). Contracts holding user funds without withdrawal/recovery mechanisms. Fix: emergency withdrawal (owner-gated with timelock), stale game cancellation, expired deposit recovery.

10. **Documentation Contradictions** (8+ findings). NatSpec, interfaces, and catalogues contradicting actual behavior. Fix: generate docs from code where possible; periodic cross-reference audits.

11. **Integration Convergence** (3 findings). Shared infrastructure integrated differently across contracts. Fix: single code path for critical operations via base contract inheritance.

12. **Discovery Ceiling** (meta-pattern). When review produces zero new findings across 3+ consecutive rounds, the target has reached saturation. This is the stopping criterion: recognize saturation and reallocate effort from finding to verification.

### 5.5 Security Implications for GEV-Resistance

The 12 patterns map directly to GEV vectors:

- Patterns 1 and 4 (identity propagation, path independence) address MEV and LqEV -- ensuring that cross-chain and proxy-mediated transactions cannot bypass collateral validation to extract value.
- Pattern 3 (rate-of-change guards) addresses OrEV -- preventing oracle price manipulation through velocity-bounded state transitions.
- Pattern 5 (batch invariants) addresses MEV -- ensuring that intra-batch ordering cannot exploit partially-updated state.
- Pattern 6 (state accounting) addresses TrEV and PlEV -- ensuring that multi-entity value flows are tracked precisely without phantom balances.
- Pattern 2 (settlement-time binding) addresses GoEV -- preventing manipulation of parameters between game creation and settlement.

The discovery ceiling at R50-R53 provides empirical evidence that the nine architectural components, as implemented, do not contain known GEV-exploitable vulnerabilities after sustained adversarial pressure.

---

## 6. Comparison with Existing Approaches

### 6.1 Flashbots Protect

**Mechanism:** Private relay routes transactions to trusted builders, hiding them from the public mempool. MEV-Share extends this by sharing extraction profits with users.

**GEV coverage:** MEV only (~14% of total GEV). Does not address governance extraction, token rent-seeking, capital formation asymmetry, oracle rent, platform extraction, or liquidation MEV.

**Trust model:** Centralized relay operator. Users must trust that the relay does not front-run or sell order flow.

**Structural assessment:** Redistribution of extraction, not elimination. The relay operator replaces the public mempool as the information chokepoint.

### 6.2 CoW Protocol

**Mechanism:** Off-chain solver network finds Coincidences of Wants for direct matching. Batch auction when CoWs exist; on-chain AMM routing when they do not.

**GEV coverage:** Partial MEV coverage. When CoWs exist, both parties receive MEV-free execution. When CoWs do not exist, orders route to on-chain AMMs with standard MEV exposure. No coverage of other GEV vectors.

**Trust model:** Semi-centralized solver network. Solvers compete to find the best execution, but the solver selection mechanism itself is a trust assumption.

**Structural assessment:** Conditional protection. The quality of MEV defense depends on whether matching counterparties exist in the current batch -- a property outside the protocol's control.

### 6.3 Penumbra

**Mechanism:** Private transactions using zero-knowledge proofs. Shielded swaps on a custom Cosmos-SDK chain with a sealed-bid batch auction DEX.

**GEV coverage:** Strong MEV coverage through sealed-bid batching and shielded transactions. Privacy-preserving design prevents information leakage. However, Penumbra is a single-chain system -- cross-chain GEV is not addressed. Governance extraction through the Cosmos SDK governance module remains possible. Token economics (staking rewards) follow standard PoS rent-seeking patterns.

**Trust model:** Relies on the soundness of the zero-knowledge proof system (Groth16 / Plonk variants) and the Cosmos validator set.

**Structural assessment:** Strong MEV defense within its chain but limited to a single execution environment. Does not address GoEV, TrEV, CfEV, or PlEV. The zero-knowledge approach provides stronger privacy guarantees than commit-reveal but at higher computational cost and with a trusted setup requirement.

### 6.4 Osmosis

**Mechanism:** Cosmos-based DEX with a threshold-encrypted mempool. Transactions are encrypted using a threshold key shared among validators. Block builders cannot see transaction contents until after inclusion.

**GEV coverage:** MEV reduction through encrypted mempools. However: (a) threshold encryption relies on honest validator majority -- if 2/3 of validators collude, all pending transactions are visible; (b) MEV returns at the decryption moment when transactions are processed sequentially; (c) Osmosis governance (OSMO token) retains full control over protocol parameters including fee structures, creating GoEV surface; (d) superfluid staking creates token rent-seeking (TrEV) by requiring OSMO for LP participation in governance.

**Trust model:** Threshold encryption committee (the validator set). Liveness and honesty assumptions on 2/3 of validators.

**Structural assessment:** Encryption-based privacy that defers rather than eliminates MEV. The validator set is both the encryption committee and the consensus mechanism, creating a single trust dependency. Governance token (OSMO) retains extractive properties.

### 6.5 Comparative Summary

| Property | Flashbots | CoW | Penumbra | Osmosis | VibeSwap |
|----------|-----------|-----|---------|---------|----------|
| MEV eliminated (not redistributed) | No | Partial | Yes | Partial | **Yes** |
| GoEV addressed | No | No | No | No | **Yes** |
| TrEV addressed | No | No | No | No | **Yes** |
| CfEV addressed | No | No | No | No | **Yes** |
| OrEV addressed | No | No | No | No | **Yes** |
| PlEV addressed | No | No | No | No | **Yes** |
| LqEV addressed | No | No | Partial | No | **Yes** |
| No trusted third party | No | No | Yes* | No | **Yes** |
| Cross-chain native | No | No | No | Partial (IBC) | **Yes** (LayerZero V2) |
| On-chain fairness verification | No | No | No | No | **Yes** (PairwiseFairness) |
| Zero protocol fees | No | No | No | No | **Yes** (P-001) |
| Adversarial review (rounds) | N/A | N/A | N/A | N/A | **53 rounds, 128+ findings** |

\*Penumbra requires trusted setup for ZK proofs.

The key differentiator is not that VibeSwap has better solutions for any single vector -- Penumbra's zero-knowledge approach provides stronger privacy than commit-reveal for MEV specifically. The differentiator is that VibeSwap applies GEV-resistance as an architectural constraint across every layer, ensuring extraction cannot relocate from one vector to another.

---

## 7. Economic Analysis

### 7.1 The Zero-Fee Model

Standard DeFi economics: protocols charge fees (0.3% typical on Uniswap, 0.04-1% on Curve, variable on Balancer) and direct a portion to governance token holders. This creates PlEV (the protocol itself extracts rent) and GoEV (token holders control fee parameters).

VibeSwap's model: 100% of trading fees flow to liquidity providers. Zero percent to the protocol. The protocol sustains itself through:

- **Priority auction bids:** Users voluntarily pay for execution priority within a batch. This is cooperative MEV capture -- the value of ordering preference is channeled through a transparent auction into protocol-owned revenue instead of being extracted by opaque searchers.
- **Slashing penalties:** Invalid reveals forfeit 50% of deposits to the treasury. Bad actors fund the protocol through their own failed manipulation.
- **Cross-chain fees:** Currently 0%. Available as future revenue if needed, but capped by LayerZero's underlying messaging costs.

This revenue model is anti-fragile: as the system grows and trading volume increases, priority auction revenue grows proportionally (more competition for execution priority in larger batches) and slashing revenue grows with attack attempts (which increase with the value at stake). Neither revenue source taxes honest users.

### 7.2 LP-First Design

Every economic design decision prioritizes liquidity providers:

**Fee routing:** 100% of trading fees to LPs via Shapley distribution. No protocol take.

**Impermanent loss protection:** The `ILProtectionVault` provides tiered IL insurance funded by protocol revenue. Traders benefit from deep liquidity; their fees fund LP loss protection; protected LPs provide more liquidity. Self-reinforcing loop.

**Loyalty rewards:** The `LoyaltyRewardsManager` implements time-weighted rewards with early exit penalties. Penalties from mercenary capital are *redistributed* to loyal LPs, inverting the standard dynamic where mercenary capital dilutes long-term participants.

**Shapley scoring:** The four-dimensional scoring (direct, enabling, scarcity, stability) structurally favors LPs who provide sustained, balanced, volatility-persistent liquidity over those who arrive for single high-fee periods.

### 7.3 Shapley Fairness in Practice

The mathematical properties of Shapley distribution have concrete economic consequences:

**The bootstrapper reward.** An LP who enters an empty pool absorbs initial volatility and attracts the first traders. In pro-rata systems, they receive the same per-unit reward as a whale who deposits after the market stabilizes. In Shapley distribution, the bootstrapper's enabling score (30% weight) and scarcity score (20% weight) recognize that their presence created value that did not exist before. The Cave Theorem formalizes this: early contributions appear in more coalitions, so their marginal contribution is mathematically higher.

**The glove game.** In a batch with 80% buy orders and 20% sell orders, the sell-side is structurally more valuable -- without them, no trades execute. Pro-rata distribution ignores this asymmetry. Shapley distribution gives sell-side providers a scarcity score of 6500 BPS versus 3500 BPS for buy-side, reflecting the cooperative game-theoretic truth that the scarce side's contribution is enabling.

**Anti-MLM by construction.** Five properties prevent pyramid dynamics: (a) rewards are bounded by realized value (Efficiency axiom); (b) rewards do not compound across events; (c) no participant can receive more than their marginal contribution; (d) identical contributions receive identical rewards regardless of entry time (Symmetry); (e) total rewards exactly equal total value generated. The formal guarantee: `R_total = SUM(v(N_j)) = V_total`. Rewards cannot exceed revenue.

### 7.4 Treasury Sustainability

The `DAOTreasury` accumulates priority bid revenue and slashing penalties. The `TreasuryStabilizer` deploys these reserves counter-cyclically -- providing backstop liquidity during bear markets and withdrawing during bull markets. This is the DeFi equivalent of a central bank's open market operations, executed autonomously by code with transparent rules.

All withdrawals require timelocks: 2-day default, 6-hour emergency with guardian co-sign, 1-hour minimum, 30-day maximum. No withdrawal is instant. Every withdrawal is publicly queued and observable before execution, providing a governance window for community response.

---

## 8. Discussion: Cooperative Capitalism vs. Extractive DeFi

### 8.1 The False Dichotomy

DeFi's founding premise was that removing intermediaries would remove rent-seeking. This hypothesis failed because removing *human* intermediaries replaced them with *structural* intermediaries: MEV searchers, governance token holders, protocol fee captures, VC lockup dumps. The intermediaries changed form, not function.

Traditional finance responded with regulated capitalism: compliance regimes, KYC gates, accredited investor restrictions. This reduced extraction but introduced gatekeeping. The 1.4 billion unbanked adults worldwide are excluded not because they are untrustworthy, but because the regulatory apparatus optimizes for control over access.

Neither system serves users. Extractive DeFi treats every participant as a target. Regulated TradFi treats every participant as a suspect. Both produce systems where the dominant strategy is adversarial.

### 8.2 The Layer Separation Principle

Cooperative capitalism proposes a third path: **mutualize the risk layer, compete on the value layer.**

```
COMPETITIVE LAYER (Value Creation)
+-- Arbitrage            -- price discovery
+-- Liquidity provision  -- capital efficiency
+-- Priority bidding     -- honest urgency expression
+-- Plugin marketplace   -- innovation
         | generates fees and proceeds |
         v
COOPERATIVE LAYER (Risk Mutualization)
+-- ShapleyDistributor    -- fair reward distribution
+-- VibeInsurance         -- mutualized risk pooling
+-- DAOTreasury           -- collective reserves
+-- TreasuryStabilizer    -- counter-cyclical stabilization
+-- ILProtectionVault     -- impermanent loss insurance
+-- LoyaltyRewardsManager -- long-term alignment
         | funded by competitive layer    |
         | provides stability for competitive layer |
```

The layers are connected by a funding loop. The competitive layer generates revenue that funds the cooperative layer. The cooperative layer provides stability and insurance that make the competitive layer viable for non-professional participants.

The equilibrium is cooperative dominance: as the protocol grows, the cooperative layer captures an increasing share of the value that extractors would otherwise take, making extraction progressively less profitable relative to honest participation.

### 8.3 Policy as Physics

The distinction between governance promises and structural constraints is the core of GEV-resistance.

A governance promise: "We will not raise fees above 0.3%." This promise is only as strong as the governance mechanism protecting it. If governance tokens concentrate, the promise can be broken by a vote. This is GoEV.

A structural constraint: "The fee rate is a protocol constant that cannot be modified by governance." This constraint is enforced by the contract's code. Changing it requires a contract upgrade, not a vote. The upgrade is constrained by the UUPS proxy pattern requiring owner authorization and timelock.

P-001 (No Extraction Ever) is the generalization: every parameter that could enable extraction is either a protocol constant (requiring upgrade to change) or controlled by a PID feedback loop (adjusting automatically based on on-chain signals). Governance retains control only over non-extractable parameters -- the parameters that do not affect who gets how much.

**Policy becomes physics.** The rules are not promises that can be broken by captured governance. They are invariants enforced by the execution environment. This is the architectural property that makes GEV-resistance permanent rather than contingent.

### 8.4 What Cooperative Capitalism Is Not

It is not altruism. Every cooperative mechanism is incentive-compatible: cooperation is the dominant strategy for rational agents because the mechanism design makes cooperation more profitable than defection. LPs who stay during volatility earn higher Shapley stability scores. Community members who build reputation earn insurance discounts. Protocols that integrate mutualistally earn retroactive Shapley rewards.

It is not communism. The competitive layer is explicitly free-market. Arbitrageurs compete on speed and capital efficiency. LPs compete on capital deployment. Plugin developers compete on innovation. The competitive pressure drives efficiency where efficiency matters.

It is not regulation. There are no gatekeepers, no KYC requirements, no accredited investor restrictions. Access is permissionless. The protection comes from mechanism design, not from excluding the unverified.

It is mechanism design applied to the correct granularity: cooperation where cooperation produces value (risk mutualization, fair attribution, collective reserves) and competition where competition produces value (price discovery, capital efficiency, innovation).

---

## 9. Limitations and Open Questions

### 9.1 Shapley Computation Complexity

Exact Shapley values require evaluating $2^n$ coalitions. For large participant sets, this is computationally infeasible. The implementation uses a weighted approximation that is O(n) and preserves all five axioms for the linear characteristic function. The security of on-chain verification depends on the `PairwiseFairness` library's ability to detect incorrect Shapley values -- an active area of formal verification.

### 9.2 PID Controller Robustness

PID auto-tuning eliminates GoEV by removing human control over parameters. But PID controllers can be manipulated through their input signals. An attacker who influences the on-chain observables that the PID reads (utilization rate, peg deviation) can indirectly control the parameters. TWAP validation and circuit breakers mitigate this, but the formal robustness guarantee against adversarial PID manipulation remains an open problem.

### 9.3 Fork Escape as Deterrent

The Fractal Fork Network's GEV-resistance for PlEV depends on the credibility of the fork threat. In practice, forking a protocol with significant network effects (liquidity, integrations, user base) is costly despite being technically free. The GEV = 0 argument assumes rational actors who will fork when extraction exceeds forking costs. If forking costs are high due to network effects, some PlEV may persist.

### 9.4 Cross-Chain GEV

The system operates across chains via LayerZero V2. Cross-chain message latency creates a potential GEV vector: participants who observe state on one chain can act on another before the cross-chain message arrives. The rate-of-change guards on cross-chain liquidity sync messages (Section 3.8) reduce but may not eliminate this vector. Cross-chain GEV-resistance is an active area of development.

### 9.5 Batch Latency

The 10-second batch window introduces latency relative to continuous AMMs. Users needing sub-second execution will find this mechanism unsuitable. This is an intentional tradeoff: the latency is the cost of fairness. On L2s and alt-L1s where finality is fast, the batch window is competitive with L1 AMM confirmation times.

### 9.6 Thin Batches

When a batch contains very few orders, the uniform clearing price may not reflect true market conditions, and the shuffle provides limited anonymity. TWAP validation mitigates this by rejecting clearing prices that deviate from the oracle. Single-order batches execute at the AMM's spot price -- the same outcome as a standard swap.

---

## 10. Conclusion

MEV is not the disease. It is a symptom. The disease is structural extraction -- value captured by intermediaries through asymmetries in information, governance, timing, capital access, data control, and liquidation priority.

We have formalized this as Generalized Extractable Value (GEV) and identified seven distinct vectors. We have shown that partial solutions -- addressing MEV alone, or governance alone, or tokenomics alone -- merely relocate extraction to the unaddressed vectors. Extraction is conserved across layers.

The nine-component architecture demonstrates that GEV-resistance is achievable as an architectural property, not a feature. The mechanisms are not novel individually -- batch auctions, Shapley values, PID controllers, fair launches, and rate-of-change guards are established primitives. The contribution is compositional: applying all of them simultaneously, at every layer, with three composability constraints (unified Shapley attribution, unified contribution tracking, unified circuit breaking) that ensure GEV-resistance is preserved under composition.

53 rounds of adversarial review across 9 contracts produced 128+ findings clustered around 12 recurring patterns. All critical, high, and low severity findings are closed at 100%. The system has reached discovery ceiling. The 12 patterns themselves -- deposit identity propagation, settlement-time binding, rate-of-change guards, collateral path independence, and eight others -- generalize as a vulnerability taxonomy for any protocol with batch processing, cross-chain messaging, or game-theoretic incentives.

The result is a financial system where the answer to "who extracts?" is "nobody" -- not because extraction is prohibited by governance (which can be captured), but because extraction is impossible by construction. Policy becomes physics.

> Every protocol solved a real problem. Then they put a tollbooth in front of the solution. We remove the tollbooth and replace it with math.

---

## References

1. Daian, P., Goldfeder, S., Kell, T., et al. (2019). "Flash Boys 2.0: Frontrunning, Transaction Reordering, and Consensus Instability in Decentralized Exchanges." *IEEE S&P 2020*.

2. Shapley, L. S. (1953). "A Value for n-Person Games." *Contributions to the Theory of Games II*, Annals of Mathematics Studies 28, pp. 307-317. Princeton University Press.

3. Hirschman, A. O. (1970). *Exit, Voice, and Loyalty: Responses to Decline in Firms, Organizations, and States.* Harvard University Press.

4. Roughgarden, T. (2021). "Transaction Fee Mechanism Design." *ACM EC 2021*.

5. Flashbots. (2024). "MEV-Explore: Cumulative Extracted MEV." https://explore.flashbots.net.

6. Messari. (2024). "VC Token Unlock Impact Analysis." Messari Research Report.

7. Buterin, V. (2021). "Moving beyond coin voting governance." https://vitalik.eth.limo.

8. Buterin, V. (2021). "On Proposer-Builder Separation." Ethereum Research.

9. Knuth, D. "The Art of Computer Programming, Vol. 2: Seminumerical Algorithms." Section 3.4.2: Random Sampling and Shuffling.

10. CowSwap. "Coincidence of Wants Protocol." https://docs.cow.fi.

11. Penumbra. "Penumbra Protocol Specification." https://protocol.penumbra.zone.

12. Osmosis. "Osmosis Documentation." https://docs.osmosis.zone.

13. Breidenbach, L., Daian, P., Juels, A., et al. (2021). "Chainlink Fair Sequencing Services."

14. Glynn, W. (2026). "Commit-Reveal Batch Auctions: Eliminating MEV Through Temporal Decoupling." VibeSwap Research.

15. Glynn, W. (2026). "Shapley Value Distribution: Fair Reward Allocation Through Cooperative Game Theory." VibeSwap Research.

16. Glynn, W. (2026). "Cooperative Capitalism: Mechanism Design for Mutualized Risk and Free Market Competition." VibeSwap Research.

17. Glynn, W. (2026). "Five-Layer MEV Defense: PoW Locking, MMR Accumulation, Forced Inclusion, Fisher-Yates Shuffle, and Uniform Clearing on Nervos CKB." VibeSwap Research.

18. Glynn, W. (2026). "Autonomous Circuit Breakers: Multi-Dimensional Risk Detection Without Human Intervention." VibeSwap Research.

19. Glynn, W. (2026). "TRP Pattern Taxonomy: 53 Rounds of Adversarial Review." VibeSwap Research.

---

*Corresponding author: William Glynn -- github.com/wglynn/vibeswap*

*The contracts referenced in this paper are open source. The mechanism described here implements the philosophy of Cooperative Capitalism: mutualized risk through uniform clearing prices and insurance pools, combined with free-market competition through transparent priority auctions. GEV is not managed -- it is eliminated by construction.*

---

## See Also

- [Commit-Reveal Batch Auctions (paper)](commit-reveal-batch-auctions.md) — Core mechanism: temporal decoupling for MEV elimination
- [Five-Layer MEV Defense on CKB](five-layer-mev-defense-ckb.md) — CKB-specific five-layer defense analysis
- [Recursive Batch Auctions](../../architecture/RECURSIVE_BATCH_AUCTIONS.md) — Fractal time structure for multi-scale coordination
- [Commit-Reveal (Nervos post)](../../marketing/forums/nervos/talks/commit-reveal-batch-auctions-post.md) — CKB cell model advantages and temporal enforcement
- [How Commit-Reveal Eliminates MEV (blog)](../../blog/01_commit_reveal_mev.md) — Accessible walkthrough of the mechanism <!-- FIXME: ../../blog/01_commit_reveal_mev.md — no candidate found in docs/ tree. -->
