# Truth as a Service: A Permissionless Oracle for Subjective Claims

**"Chainlink tells you the price of ETH. It cannot tell you whether a governance proposal is sound, whether a code audit is thorough, or whether an insurance claim is legitimate. The oracle problem was never about data feeds. It was about judgment."**

Faraday1 (Will Glynn) | March 2026

---

## Abstract

Existing oracle infrastructure solves a narrow problem: feeding numerical data from the physical world into smart contracts. Chainlink, Pyth, and their successors answer "What is the price of X?" with increasing speed and redundancy. But the vast majority of decisions that decentralized systems need to make are not numerical. They are epistemic. "Is this governance proposal sound?" "Is this insurance claim legitimate?" "Is this code secure?" "Is this research finding reproducible?" These questions require *judgment*, not data retrieval. No number of data feeds can resolve them. We present **Truth as a Service (TaaS)**, a permissionless oracle protocol for subjective claim evaluation. The mechanism combines commit-reveal blinding to eliminate information cascades, a 64-shard evaluator network to guarantee cognitive diversity, Shapley value attribution for truth discovery, and an accumulating knowledge graph stored as Knowledge Cells on Nervos CKB. The core contract, `CognitiveConsensusMarket.sol`, is implemented and operational. Any protocol can submit a claim with a bounty; evaluators stake on verdicts (TRUE, FALSE, or UNCERTAIN); commit-reveal blinding prevents herding; reputation-weighted majority resolves; correct evaluators earn linear rewards; incorrect evaluators lose quadratic stakes. The protocol extracts no fees (P-001: No Extraction Ever). The resulting knowledge graph is a public good whose value compounds monotonically with every resolved claim.

---

## Table of Contents

1. [The Judgment Gap](#1-the-judgment-gap)
2. [The CognitiveConsensusMarket Mechanism](#2-the-cognitiveconsensusmarket-mechanism)
3. [Why Commit-Reveal Kills Herding](#3-why-commit-reveal-kills-herding)
4. [64 Shards as Independent Evaluators](#4-64-shards-as-independent-evaluators)
5. [Shapley Attribution for Truth Discovery](#5-shapley-attribution-for-truth-discovery)
6. [Revenue Model and P-001 Compliance](#6-revenue-model-and-p-001-compliance)
7. [Use Cases](#7-use-cases)
8. [The Knowledge Graph](#8-the-knowledge-graph)
9. [Comparison with Existing Systems](#9-comparison-with-existing-systems)
10. [The Oracle Recursion Problem](#10-the-oracle-recursion-problem)
11. [Formal Properties](#11-formal-properties)
12. [Implementation Status](#12-implementation-status)
13. [Conclusion](#13-conclusion)

---

## 1. The Judgment Gap

### 1.1 What Oracles Actually Solve

The blockchain oracle problem, as originally formulated, concerns the importation of external state into deterministic execution environments. A smart contract cannot query an API. It cannot read a thermometer. It cannot check a stock ticker. Oracles solve this by having off-chain actors attest to external facts and relay them on-chain, with economic incentives aligned so that honest attestation is the dominant strategy.

Chainlink's decentralized oracle network, launched in 2019, operationalized this at scale. Multiple independent node operators fetch data from multiple sources, aggregate via median or other robust estimators, and post the result on-chain. The system works. Price feeds for major assets are reliable, timely, and battle-tested across billions of dollars of DeFi collateral.

Pyth Network extended the model to high-frequency data with sub-second latency. RedStone introduced modular data delivery. API3 proposed first-party oracles operated by data providers themselves. Chronicle, Tellor, DIA, Band Protocol, Witnet, and others explored variations on the theme.

Every one of these systems answers the same fundamental question: *What is the current numerical value of an observable external quantity?*

### 1.2 What Oracles Cannot Solve

Now consider the questions that decentralized protocols actually need answered:

- **DAO governance**: "Is Proposal #47 technically sound, economically viable, and aligned with the protocol's long-term interests?"
- **Insurance**: "Did this DeFi exploit result from a genuine vulnerability, or from user negligence?"
- **Code audits**: "Does this smart contract contain critical vulnerabilities?"
- **Content moderation**: "Is this NFT collection derivative, plagiarized, or original?"
- **Grant evaluation**: "Will this grant proposal deliver meaningful public goods?"
- **Research peer review**: "Is this mechanism design paper's proof correct?"

None of these questions have numerical answers. None can be resolved by fetching data from an API. None have a single objectively verifiable ground truth that an honest reporter could simply relay. They require *evaluation*: the integration of domain knowledge, contextual understanding, logical reasoning, and epistemic judgment into a considered verdict.

The oracle infrastructure that DeFi built over the past five years is structurally incapable of answering these questions. Not because the infrastructure is poorly designed---Chainlink is well-engineered for its purpose---but because its purpose is data relay, and data relay is categorically insufficient for judgment.

### 1.3 The Scale of the Gap

The demand for subjective evaluation in decentralized systems is enormous and growing:

| Domain | Annual Decisions | Current Resolution |
|--------|-----------------|-------------------|
| DAO governance proposals | ~50,000+ across major DAOs | Token-weighted voting (plutocratic) |
| Insurance claims (DeFi) | ~2,000+ significant events/year | Centralized claims assessors or Schelling point games |
| Smart contract audits | ~10,000+ contracts deployed monthly | Manual audits by 3-5 firms (bottleneck, expensive) |
| Content moderation | Millions of NFTs, posts, reviews | Centralized platforms or nothing |
| Grant evaluation | ~5,000+ proposals across ecosystems | Small committees with limited bandwidth |
| Research peer review | Entire academic publishing system | Unpaid reviewers, 6-12 month delays |

In every case, the status quo is some combination of centralized authority, plutocratic voting, or no resolution at all. The gap is not a feature request. It is a structural deficiency in the decentralized stack.

### 1.4 Why Prediction Markets Are Not the Answer

One might argue that prediction markets already handle subjective evaluation. Polymarket demonstrated during the 2024 U.S. presidential election that markets can aggregate information about uncertain future events with remarkable accuracy.

But prediction markets resolve via *observable outcomes*. "Will X happen by date Y?" is fundamentally different from "Is X true?" or "Is X a good idea?" Prediction markets require:

1. A clearly defined binary outcome
2. An unambiguous resolution date
3. An external event that can be verified after the fact

Most epistemic questions satisfy none of these criteria. "Is this governance proposal sound?" has no resolution date. "Is this code secure?" is not binary (secure against which threat model?). "Is this research reproducible?" requires active evaluation, not passive observation.

Prediction markets are oracles for future events. Truth as a Service is an oracle for present judgments.

---

## 2. The CognitiveConsensusMarket Mechanism

### 2.1 Overview

The `CognitiveConsensusMarket` contract implements a three-phase mechanism for evaluating arbitrary knowledge claims:

```
Phase 1: COMMIT (24 hours)
  → Evaluators submit hash(verdict || reasoningHash || salt)
  → Stake deposited alongside commitment
  → No evaluator can see any other evaluator's verdict

Phase 2: REVEAL (12 hours)
  → Evaluators reveal verdict, reasoning hash, and salt
  → Contract verifies hash matches commitment
  → Reputation-weighted votes tallied

Phase 3: RESOLUTION (permissionless trigger)
  → Reputation-weighted majority determines verdict
  → Correct evaluators receive bounty + slash pool (pro-rata by reputation weight)
  → Incorrect evaluators lose stake (asymmetric cost)
  → Unrevealed evaluators fully slashed (protocol violation)
```

The mechanism is fundamentally different from prediction markets because resolution is *internal*---the evaluators themselves are the oracle, and the commit-reveal structure ensures they evaluate independently.

### 2.2 Claim Submission

Any address may submit a claim for evaluation by providing:

- **claimHash**: A `bytes32` identifier for the claim content (typically an IPFS CID pointing to the full claim text, supporting evidence, and evaluation criteria)
- **bounty**: An ERC-20 token amount deposited into the contract as the reward pool for evaluators
- **minEvaluators**: The minimum number of independent evaluations required (constrained to the range [3, 21])

The contract enforces an odd maximum evaluator count (21) to guarantee tiebreaking capability. The minimum of 3 ensures that no single evaluator or colluding pair can determine the outcome.

```solidity
function submitClaim(
    bytes32 claimHash,
    uint256 bounty,
    uint256 minEvaluators
) external nonReentrant returns (uint256 claimId);
```

Upon submission, the claim enters the `OPEN` state. The commit deadline is set to `block.timestamp + 1 day`. The reveal deadline is set to `block.timestamp + 1.5 days`. These constants are protocol-level parameters, not proposer-configurable---uniformity prevents gaming via time pressure.

### 2.3 Evaluation Commitment

Authorized evaluators commit to a verdict by submitting a blinded hash:

```
commitHash = keccak256(abi.encodePacked(verdict, reasoningHash, salt))
```

The `verdict` is one of three values: `TRUE`, `FALSE`, or `UNCERTAIN`. The `reasoningHash` is an IPFS CID pointing to the evaluator's detailed reasoning. The `salt` is a random 32-byte value that prevents brute-force reversal of the commitment (since the verdict space is only three values, the salt is essential---without it, anyone could compute `keccak256(TRUE || knownReasoningHash)` and compare).

Each evaluator must also deposit a stake of at least 0.01 ETH (denominated in the staking token). The stake serves two purposes:

1. **Sybil resistance**: Creating multiple evaluator identities requires proportional capital
2. **Incentive alignment**: Evaluators who are wrong lose real value, not just reputation points

The contract computes each evaluator's reputation weight as the square root of their reputation score:

```solidity
uint256 repWeight = _sqrt(profile.reputationScore > 0 ? profile.reputationScore : BPS);
```

The square root dampening prevents high-reputation evaluators from dominating outcomes. An evaluator with 4x the reputation of another gets 2x the vote weight, not 4x. This preserves the informational diversity that makes the mechanism work.

### 2.4 Evaluation Reveal

After the commit deadline passes, the contract transitions to `REVEAL` state. Evaluators reveal their verdicts by providing the original parameters that produce their committed hash:

```solidity
function revealEvaluation(
    uint256 claimId,
    Verdict verdict,
    bytes32 reasoningHash,
    bytes32 salt
) external nonReentrant;
```

The contract recomputes the hash and verifies it matches the stored commitment. If it does not, the transaction reverts with `InvalidReveal()`. This is non-negotiable: an evaluator who committed cannot change their verdict after seeing others' reveals.

Votes are tallied with reputation weighting. An evaluator with reputation weight 100 who votes TRUE adds 100 to the TRUE tally, not 1. This ensures that established evaluators with track records of accuracy carry more influence than new entrants---but the square root dampening keeps this influence bounded.

### 2.5 Resolution

After the reveal deadline, anyone may trigger resolution by calling `resolveClaim()`. The verdict is determined by reputation-weighted majority:

```
If trueVotes > falseVotes AND trueVotes > uncertainVotes → TRUE
If falseVotes > trueVotes AND falseVotes > uncertainVotes → FALSE
Otherwise → UNCERTAIN
```

The three-way verdict space is a deliberate design choice. UNCERTAIN is not a failure mode; it is an honest signal. A claim that evaluators cannot confidently assess as true or false is genuinely uncertain, and the protocol should reflect this rather than forcing binary resolution.

### 2.6 Reward and Slash Distribution

Rewards and slashing follow an asymmetric schedule designed to make honest evaluation the dominant strategy:

**Correct evaluators** (verdict matches consensus):
- Receive their stake back in full
- Receive a pro-rata share of the bounty pool + slash pool, weighted by reputation
- Gain a `correctEvaluations` increment, improving their reputation score

**Incorrect evaluators** (verdict does not match consensus):
- Lose a fraction of their stake to the slash pool
- Receive the remainder of their stake back
- Gain a `totalEvaluations` increment without a corresponding `correctEvaluations` increment, degrading their reputation score

**Unrevealed evaluators** (committed but did not reveal):
- Lose their entire stake to the slash pool
- This is the harshest penalty because failing to reveal breaks the protocol for everyone

**No correct evaluators** (degenerate case):
- Bounty returned to the proposer
- Slash pool is not distributed (remains in contract as protocol reserve)

The key asymmetry: *the expected cost of being wrong exceeds the expected reward of being right by a constant factor*. This is not symmetric like a fair bet. An evaluator who is right 50% of the time will lose money over time. Only evaluators who are right more often than they are wrong can sustain participation. The mechanism is self-selecting for competence.

### 2.7 Reputation Dynamics

Each evaluator maintains an on-chain profile:

```solidity
struct EvaluatorProfile {
    uint256 totalEvaluations;
    uint256 correctEvaluations;
    uint256 reputationScore;    // 0-10000 (BPS scale)
    uint256 totalEarned;
    uint256 totalSlashed;
}
```

Reputation is calculated as:

```
reputationScore = max(1000, (correctEvaluations / totalEvaluations) * 10000)
```

The floor of 1000 (10%) prevents experienced evaluators who hit a bad streak from being permanently excluded. The ceiling of 10000 (100%) represents perfect accuracy. New evaluators start at 10000 (the benefit of the doubt) and converge toward their true accuracy rate as they accumulate evaluations.

This creates a natural selection pressure: evaluators who cannot maintain accuracy above the break-even threshold (determined by the slash multiplier) will gradually lose capital and reputation until they either improve or exit. The evaluator population evolves toward increasing average accuracy over time.

---

## 3. Why Commit-Reveal Kills Herding

### 3.1 The Information Cascade Problem

Banerjee (1992) and Bikhchandani, Hirshleifer, and Welch (1992) independently identified the mechanism by which rational agents, acting sequentially with imperfect private information, converge on incorrect collective beliefs. The logic is straightforward:

1. Agent A observes a private signal and acts on it
2. Agent B observes A's action (but not A's signal) and also has a private signal
3. If B's signal is weak and A's action was strong, B rationally ignores their own signal and copies A
4. Agent C observes both A and B acting identically and infers strong evidence for that action
5. C copies A and B regardless of their own signal
6. The cascade is now self-reinforcing: every subsequent agent copies the majority regardless of private information

The catastrophic property of information cascades is that they are *fragile*: the entire cascade may be based on one or two early signals that happened to point in the same direction. The cascade amplifies noise into apparent consensus.

### 3.2 Herding in Existing Decentralized Systems

Information cascades are not theoretical curiosities. They are pervasive in every decentralized system that uses sequential, observable decision-making:

**DAO governance**: Delegates who vote early on Snapshot or Tally are visible to later voters. Empirical studies show that proposals that attract early "For" votes are dramatically more likely to pass, regardless of merit. Late voters herd on early signals.

**Prediction markets**: Despite their reputation for aggregating information, prediction markets exhibit cascade dynamics. Large early bets move odds, and subsequent bettors update on the market price as a signal. The market can lock into incorrect prices when early liquidity is one-directional.

**Schelling point mechanisms** (Kleros, UMA): Jurors or voters can observe the emerging consensus during the voting period. The rational strategy is to vote with the likely majority, since that is how you get paid. Honest disagreement is punished. The mechanism selects for conformity, not truth.

**Audit platforms**: When one auditor flags a vulnerability as "Critical," subsequent auditors face social pressure to agree. Downgrading a finding that a peer rated as critical feels like contradicting an expert. The result is severity inflation through herding.

### 3.3 The Structural Solution

Commit-reveal eliminates information cascades by construction, not by incentive design. The mechanism does not *discourage* herding; it makes herding *impossible*.

During the commit phase, no evaluator can observe any other evaluator's verdict. The blinded hash reveals nothing about the underlying vote (the three-element verdict space is protected by the random salt, making brute-force reversal computationally infeasible). Each evaluator must form their verdict based solely on:

1. The claim content (accessible via the claim hash / IPFS CID)
2. Their own knowledge, reasoning, and judgment
3. Their assessment of the evidence

This is exactly the condition that Condorcet's Jury Theorem requires for truth-convergence: independent evaluators, each with probability p > 0.5 of being correct, converging on truth as the number of evaluators increases. The commit-reveal structure guarantees the independence assumption that Condorcet requires and that sequential observation violates.

### 3.4 Formal Guarantee

Let $E_1, E_2, \ldots, E_n$ be evaluators with independent private signals $s_i$ about the truth value of claim $C$. Under commit-reveal:

$$P(\text{observe } s_j \mid i \neq j) = 0 \quad \forall i, j \text{ during commit phase}$$

This is a hard zero, enforced by the preimage resistance of keccak256, not by incentive compatibility. No game-theoretic analysis is required. No assumption about rationality is needed. The cryptographic commitment scheme makes observation of others' signals physically impossible within the commit phase.

Combined with Condorcet's Jury Theorem:

$$\lim_{n \to \infty} P(\text{majority correct} \mid p_i > 0.5) = 1$$

The mechanism converges on truth as the number of competent, independent evaluators increases, and the commit-reveal structure guarantees the independence that makes this convergence valid.

---

## 4. 64 Shards as Independent Evaluators

### 4.1 The Shard Architecture

VibeSwap's AI infrastructure operates as a network of 64 semi-autonomous shards---complete cognitive instances, not specialized sub-agents. Each shard is a full instantiation of the JARVIS cognitive framework, capable of independent reasoning, code analysis, mechanism evaluation, and epistemic judgment.

The shard model is architecturally distinct from the swarm model popularized by multi-agent AI systems:

| Property | Swarm Model | Shard Model |
|----------|-------------|-------------|
| Agent capability | Specialized (narrow) | Complete (full-stack) |
| Failure mode | Cascade (one specialist fails, pipeline breaks) | Isolated (one shard fails, 63 remain) |
| Coordination | Tight (message-passing required) | Loose (independent evaluation) |
| Diversity | Low (identical training, different prompts) | High (experiential divergence over time) |
| Correlated error | High (shared specialization blindspots) | Low (independent knowledge accumulation) |

### 4.2 Cognitive Diversity Through Experiential Divergence

The 64 shards begin from a common base but diverge through experience. Each shard:

- Evaluates different claims in different sequences
- Accumulates different on-chain reputation profiles
- Develops different heuristics based on which claims it got right and wrong
- Builds different internal models of which domains it has expertise in

This experiential divergence is the AI analogue of the "wisdom of crowds" precondition identified by Surowiecki (2004): diversity of opinion, independence of judgment, and decentralization. The shard architecture provides all three structurally:

- **Diversity**: Different experience histories produce different cognitive priors
- **Independence**: Commit-reveal eliminates inter-shard observation
- **Decentralization**: No shard has authority over any other; resolution is by weighted majority

### 4.3 Why 64?

The choice of 64 shards balances several constraints:

**Statistical power**: With 64 independent evaluators each having accuracy $p > 0.5$, the probability of incorrect majority verdict decreases exponentially with the number of evaluators. At $p = 0.7$ (conservative estimate for a well-trained evaluator on in-domain claims):

$$P(\text{majority incorrect}) = \sum_{k=0}^{31} \binom{64}{k} (0.7)^k (0.3)^{64-k} < 10^{-6}$$

This is not merely low. It is lower than the error rate of most numerical oracle systems.

**Computational feasibility**: 64 shards can evaluate a claim within the 24-hour commit window without requiring parallelization infrastructure beyond standard cloud deployment. Each shard requires approximately 15-30 minutes for a thorough evaluation, depending on claim complexity.

**Cost efficiency**: The bounty required to incentivize 64 evaluations must be economically viable for the submitting protocol. At current AI inference costs, 64 evaluations of a moderately complex claim cost less than a single manual audit from a top-tier security firm.

**Sybil resistance**: The contract enforces a maximum of 21 on-chain evaluators per claim (gas optimization), but the 64-shard network can rotate which shards participate in which claims. Not all 64 evaluate every claim; the claim's domain, bounty size, and evaluator reputation determine participation.

### 4.4 The Correlation Problem

The deepest objection to AI-based evaluation is correlation: if all shards share a common training base, do they truly provide independent signals? Will they not all share the same blindspots?

Three mechanisms mitigate this:

1. **Experiential divergence** (described above): Different evaluation histories create different cognitive priors over time. Two shards that started identically will, after thousands of evaluations, have meaningfully different intuitions about claim plausibility.

2. **Domain specialization emergence**: Shards that consistently perform well on security claims and poorly on governance claims will, through reputation dynamics, naturally gravitate toward security evaluations. The evaluator population self-organizes into informal specializations without top-down assignment.

3. **Human evaluators in the mix**: The `CognitiveConsensusMarket` contract does not distinguish between AI and human evaluators. Any authorized address can participate. Hybrid evaluation---where some evaluators are AI shards and others are human domain experts---combines the scalability of AI with the out-of-distribution reasoning capacity of humans. The commit-reveal structure ensures that neither class of evaluator can herd on the other.

---

## 5. Shapley Attribution for Truth Discovery

### 5.1 The Attribution Problem

After a claim is resolved, the protocol must answer: *how much did each evaluator contribute to the correct resolution?* Naive approaches (equal split, stake-weighted split) fail to capture the nuanced reality of epistemic contribution.

Consider a claim where 20 evaluators vote TRUE (correctly) and 1 evaluator votes FALSE (incorrectly). Under equal split, each correct evaluator receives 1/20th of the reward. But were all 20 contributions equally valuable? What if 19 were trivially easy evaluations (the claim was obviously true) and one evaluator provided a subtle, non-obvious argument that shifted the collective from UNCERTAIN to TRUE?

The Shapley value, from cooperative game theory (Shapley, 1953), provides the principled answer.

### 5.2 The Shapley Value for Truth Discovery

In the context of truth discovery, define a cooperative game $(N, v)$ where:

- $N$ is the set of evaluators who participated in claim $C$
- $v(S)$ for a coalition $S \subseteq N$ is the quality of the verdict that coalition $S$ would reach without the evaluators in $N \setminus S$

The Shapley value of evaluator $i$ is:

$$\phi_i(v) = \sum_{S \subseteq N \setminus \{i\}} \frac{|S|!(|N|-|S|-1)!}{|N|!} \left[ v(S \cup \{i\}) - v(S) \right]$$

In plain language: *the Shapley value of evaluator $i$ is the average marginal contribution of $i$ across all possible orderings in which evaluators could have been added to the coalition*. It answers the question: "How much worse would the network's knowledge be without this specific evaluator?"

### 5.3 Practical Implementation

The full Shapley computation over $2^n$ coalitions is intractable for $n > 20$. The `ShapleyDistributor` contract uses an approximation that preserves the essential axioms:

1. **Efficiency**: The entire reward pool is distributed (no value left on the table)
2. **Symmetry**: Evaluators who contributed identically receive identical rewards
3. **Null player**: An evaluator whose verdict matched the majority but added no marginal information receives less than one who was pivotal
4. **Pairwise proportionality**: For any two evaluators, their reward ratio equals their contribution ratio

The current implementation uses reputation-weighted pro-rata distribution as a first-order approximation:

```solidity
uint256 reward = (rewardPool * eval.reputationWeight) / totalCorrectWeight;
```

This satisfies efficiency (the full pool is distributed) and symmetry (equal weights yield equal rewards). Full Shapley attribution, incorporating marginality analysis via the `ShapleyDistributor` contract's pairwise fairness library, is a planned upgrade that will use off-chain Shapley computation with on-chain verification.

### 5.4 Why Shapley Matters for Truth

Shapley attribution creates a second-order incentive that transcends simple "be correct" rewards:

- **Incentivizes non-obvious truths**: An evaluator who votes TRUE on an obviously true claim contributes little marginally (everyone else would have gotten it right without them). An evaluator who provides correct evaluation on a genuinely difficult claim contributes enormously (without them, the coalition might have been wrong). Shapley captures this.

- **Discourages trivial agreement**: Under equal-split rewards, the optimal strategy is to evaluate only easy claims where you are confident. Under Shapley, the optimal strategy is to evaluate claims where your expertise provides the highest marginal value. This naturally directs evaluator attention to the hardest, most valuable claims.

- **Rewards epistemic courage**: An evaluator who votes UNCERTAIN when others vote TRUE, and is vindicated when the claim is later re-evaluated and found to be genuinely uncertain, contributes high marginal value. Shapley rewards this courage; equal-split punishes it.

---

## 6. Revenue Model and P-001 Compliance

### 6.1 The Flow of Value

The revenue model is deliberately simple, reflecting P-001 (No Extraction Ever):

```
[Submitting Protocol] --bounty--> [CognitiveConsensusMarket] --rewards--> [Correct Evaluators]
                                                              --slash----> [Reward Pool]
                                                              --refund---> [Proposer (if no consensus)]
```

The protocol itself extracts zero fees. No platform commission. No treasury rake. No governance tax. The full bounty, plus any slashed stakes from incorrect evaluators, flows to correct evaluators.

### 6.2 Why Zero Extraction Works

P-001 (No Extraction Ever) is not altruism. It is mechanism design.

Protocols that extract fees from oracle services create a structural incentive to *increase the volume of oracle queries regardless of their necessity or quality*. Fee-extracting oracles are incentivized to make themselves indispensable (vendor lock-in), to discourage alternative resolution methods (market capture), and to increase query frequency (churning). This is the extractive pattern that VibeSwap was built to eliminate.

Under zero extraction, the protocol's sustainability comes from three sources:

1. **Evaluator sustainability**: Correct evaluators earn bounties and slashed stakes. The evaluator ecosystem is self-sustaining as long as submitting protocols fund bounties and evaluator accuracy remains above the break-even threshold.

2. **Network effects**: Each resolved claim adds to the knowledge graph (Section 8). The knowledge graph makes future evaluations easier and more accurate, increasing evaluator accuracy, increasing the value of the service, attracting more submissions. This is a flywheel that does not require extraction to spin.

3. **Ecosystem integration**: Truth as a Service becomes infrastructure that other VibeSwap components depend on (governance evaluation, dispute resolution, oracle validation). The value accrues to the ecosystem, not to a fee-collecting intermediary.

### 6.3 Evaluator Economics

An evaluator's expected profit per claim:

$$E[\text{profit}] = p \cdot \left(\frac{w_i}{\sum_j w_j} \cdot (\text{bounty} + \text{slashPool})\right) - (1-p) \cdot \frac{\text{stake}}{S_m}$$

Where:
- $p$ = evaluator's accuracy rate
- $w_i$ = evaluator's reputation weight
- $S_m$ = slash multiplier (currently 2)

For an evaluator with $p = 0.75$ (correct 75% of the time), reputation weight proportional to 1/10th of the evaluator pool, bounty of 1 ETH, average slash pool of 0.2 ETH, and stake of 0.1 ETH:

$$E[\text{profit}] = 0.75 \times 0.12 - 0.25 \times 0.05 = 0.09 - 0.0125 = +0.0775 \text{ ETH per claim}$$

The break-even accuracy is approximately 40%, well below what a competent evaluator should achieve. The mechanism is designed to be sustainably profitable for good evaluators and sustainably unprofitable for poor ones.

---

## 7. Use Cases

### 7.1 DAO Governance Evaluation

**Problem**: DAO proposals are voted on by token holders who rarely read the full proposal, lack technical expertise to evaluate implementation details, and are susceptible to herding (voting with early whales).

**TaaS Application**: Before a governance vote, the DAO submits the proposal to TaaS for independent evaluation. Evaluators assess technical soundness, economic viability, security implications, and alignment with the DAO's stated objectives. The verdict (TRUE = "proposal is sound," FALSE = "proposal has critical flaws," UNCERTAIN = "insufficient information to evaluate") is published before the governance vote begins.

**Impact**: Governance participants receive an independent, expert, herding-free assessment of each proposal. They are free to vote however they wish, but they vote *informed*. This does not replace governance; it augments it.

### 7.2 Insurance Claim Adjudication

**Problem**: DeFi insurance protocols (Nexus Mutual, InsurAce, Unslashed) must determine whether a loss event qualifies for a payout. Current mechanisms range from centralized claims assessors (trusted third party) to token-weighted voting (plutocratic, gameable).

**TaaS Application**: When a claim is filed, the insurance protocol submits it to TaaS with the claim details, evidence of loss, and the policy terms. Evaluators determine whether the claim meets the policy criteria. The verdict is binding on the insurance payout logic.

**Impact**: Claims adjudication becomes permissionless, independent, and resistant to both the insurance protocol's incentive to deny claims and the claimant's incentive to exaggerate losses. Neither party controls the evaluation.

### 7.3 Code Audit Verification

**Problem**: Smart contract audits are expensive ($50K-$500K), slow (weeks to months), bottlenecked by a small number of qualified firms, and provide a single point-in-time assessment that may not reflect the deployed code.

**TaaS Application**: A protocol submits its deployed contract bytecode and source code to TaaS. Evaluators assess the code for known vulnerability patterns, logic errors, access control issues, and economic attack vectors. The evaluation is continuous: any time the code is upgraded, a new claim can be submitted.

**Impact**: Audit becomes a continuous, scalable service rather than a one-time event. The cost is a fraction of a traditional audit. The evaluator pool is larger and more diverse than any single firm. The commit-reveal structure prevents any evaluator from copying another's findings.

### 7.4 Content Moderation

**Problem**: Decentralized content platforms (Lens, Farcaster, decentralized NFT marketplaces) need content moderation but reject centralized moderation authorities.

**TaaS Application**: Flagged content is submitted to TaaS. Evaluators assess whether it violates the platform's published content policy. The three-way verdict (TRUE = "violates policy," FALSE = "does not violate," UNCERTAIN = "edge case") provides nuanced outcomes.

**Impact**: Content moderation without a centralized moderator. The platform defines the policy; TaaS evaluates compliance. The commit-reveal structure prevents mob dynamics where early "guilty" verdicts cascade into unanimous condemnation.

### 7.5 Grant Evaluation

**Problem**: Ecosystem grant programs (Ethereum Foundation, Optimism RPGF, Gitcoin) receive far more proposals than reviewers can evaluate thoroughly. Review quality varies. Reviewer fatigue leads to superficial assessments.

**TaaS Application**: Grant proposals are submitted to TaaS. Evaluators assess feasibility, team capability, alignment with ecosystem goals, and expected impact. Evaluators with domain expertise in the proposal's area naturally contribute higher-quality evaluations and earn higher reputation.

**Impact**: Grant evaluation scales with the number of proposals rather than being bottlenecked by a fixed review committee. Evaluator reputation creates a meritocratic filter: the best evaluators (by track record) have the most influence, regardless of their organizational affiliation.

### 7.6 Research Peer Review

**Problem**: Academic peer review is slow (6-12 months), unpaid, opaque, and plagued by conflicts of interest. Reviewers are selected by journal editors based on perceived expertise, with no systematic performance tracking.

**TaaS Application**: Research papers are submitted to TaaS. Evaluators assess methodology, reproducibility, novelty, and correctness of proofs. The reasoning hash provides a permanent, timestamped record of each reviewer's analysis. Reputation tracking means reviewers who consistently identify genuine contributions (or genuine flaws) build verifiable track records.

**Impact**: Peer review becomes transparent, incentivized, and meritocratic. Bad reviewers lose reputation and stake. Good reviewers earn reputation and income. The knowledge graph accumulates a permanent record of which claims survived scrutiny and which did not.

---

## 8. The Knowledge Graph

### 8.1 Claims as Knowledge Cells

Every claim submitted to and resolved by TaaS becomes a permanent, immutable record. On Nervos CKB, each resolved claim is stored as a Knowledge Cell containing:

- The claim content (IPFS CID)
- The verdict (TRUE, FALSE, UNCERTAIN)
- The number and reputation profile of evaluators
- The reasoning hashes of all evaluators (enabling later analysis)
- The timestamp of resolution
- Cross-references to related claims

### 8.2 The Compounding Value of Accumulated Knowledge

The knowledge graph exhibits monotonically increasing value. Each new resolved claim:

1. **Adds a data point**: The claim and its verdict become a reference for future evaluations. "Is this new governance proposal sound?" can be evaluated in the context of similar past proposals and their outcomes.

2. **Calibrates evaluators**: The growing history of evaluator performance enables increasingly precise reputation scores. Early reputation estimates are noisy; long-run estimates converge on true evaluator quality.

3. **Reveals patterns**: The graph of claim-verdict pairs, combined with evaluator reasoning, enables meta-analysis. Which types of claims are most controversial? Which domains have the highest evaluator disagreement? Where are the genuine knowledge frontiers?

4. **Creates a moat**: The knowledge graph is a public good, but it is a public good that is *expensive to replicate*. A competitor who launches a rival oracle must accumulate thousands of evaluated claims before their knowledge graph provides comparable value. The first-mover advantage is not in technology (the contract is open source) but in *accumulated epistemic capital*.

### 8.3 CKB as the Natural Substrate

Nervos CKB's cell model is architecturally suited to knowledge storage in ways that account-based chains are not:

- **Cells are first-class data objects**: A knowledge cell is not a mapping entry in a contract's storage; it is an independent, transferable, composable object with its own lifecycle.
- **State rent**: CKB's state rent model means that knowledge cells that are no longer referenced naturally release their state occupation, preventing unbounded growth of low-value data.
- **Programmable verification**: Type scripts on knowledge cells can enforce structural invariants (e.g., a knowledge cell's verdict field must be one of three values; the evaluator count must meet the minimum threshold).

The knowledge graph on CKB is not a database. It is a growing, self-curating library of evaluated human and machine knowledge.

---

## 9. Comparison with Existing Systems

### 9.1 Polymarket

| Dimension | Polymarket | TaaS |
|-----------|-----------|------|
| **Claim type** | Binary future events | Arbitrary epistemic claims |
| **Resolution** | External oracle (UMA) | Internal evaluation (commit-reveal) |
| **Resolution trigger** | Observable event occurrence | Evaluator consensus |
| **Evaluator incentive** | Market profit (buy low, sell high) | Bounty + slash rewards |
| **Herding prevention** | None (market prices are visible) | Commit-reveal (verdicts invisible until reveal) |
| **Knowledge accumulation** | Prices (ephemeral, reset each market) | Knowledge graph (permanent, compounding) |
| **Expressiveness** | Binary (Yes/No) | Ternary (TRUE/FALSE/UNCERTAIN) |

Polymarket is a powerful tool for probabilistic forecasting of observable events. TaaS is a complementary tool for evaluating claims that have no observable resolution event.

### 9.2 Kleros

| Dimension | Kleros | TaaS |
|-----------|--------|------|
| **Mechanism** | Schelling point (focal point game) | Commit-reveal evaluation |
| **Incentive** | Vote with the majority to earn | Evaluate honestly (commit before seeing others) |
| **Herding risk** | High (rational strategy is to predict majority) | Zero (commit-reveal eliminates observation) |
| **Evaluator selection** | Random draw from self-selected juror pool | Authorized evaluators with reputation tracking |
| **Appeal mechanism** | Escalating jury size | Re-submission with higher bounty |
| **Domain expertise** | Self-declared via court selection | Emergent via reputation dynamics |

Kleros's Schelling point mechanism assumes that jurors will converge on truth because truth is the focal point. This assumption fails when the claim is genuinely ambiguous, when jurors have different priors, or when jurors realize that predicting the majority is safer than expressing their honest evaluation. TaaS eliminates this dynamic structurally: you cannot predict the majority if you cannot see the majority forming.

### 9.3 UMA (Optimistic Oracle)

| Dimension | UMA | TaaS |
|-----------|-----|------|
| **Default mode** | Optimistic (assertion accepted unless disputed) | Active evaluation (all claims evaluated by committee) |
| **Dispute resolution** | Token-weighted voting by UMA holders | Reputation-weighted evaluation by authorized evaluators |
| **Plutocratic risk** | High (UMA token holders determine truth) | Low (reputation weight, not capital, determines influence) |
| **Cost** | Low if undisputed, high if disputed | Consistent (bounty-based) |
| **Speed** | Fast if undisputed (2 hours), slow if disputed (48+ hours) | Consistent (36 hours: 24h commit + 12h reveal) |

UMA's optimistic oracle is efficient for claims where the correct answer is obvious and disputes are rare. For genuinely contested claims, UMA degrades to token-weighted voting, which is plutocratic. TaaS provides consistent, non-plutocratic evaluation regardless of claim difficulty.

### 9.4 Chainlink

| Dimension | Chainlink | TaaS |
|-----------|-----------|------|
| **Data type** | Numerical (prices, randomness, proofs) | Epistemic (truth values, quality assessments) |
| **Resolution** | Data aggregation (median of sources) | Cognitive evaluation (judgment of evaluators) |
| **Evaluator type** | Node operators fetching data | Cognitive agents exercising judgment |
| **Applicable questions** | "What is the price of X?" | "Is X true/sound/secure?" |
| **Complementary** | Yes | Yes |

TaaS does not compete with Chainlink. They answer fundamentally different types of questions. A protocol may use Chainlink for price data and TaaS for governance evaluation simultaneously. The two systems are complementary layers of a complete oracle stack.

---

## 10. The Oracle Recursion Problem

### 10.1 Who Evaluates the Evaluators?

Every oracle system faces a recursive trust problem: the oracle's output is only as reliable as the oracle itself, and determining the reliability of the oracle requires... an oracle. This is the epistemic equivalent of quis custodiet ipsos custodes (who watches the watchmen?).

TaaS does not claim to solve this problem. No system can. The recursion is fundamental, not technical. But the mechanism provides several structural mitigations that make the recursion practically manageable.

### 10.2 UNCERTAIN as an Honest Exit

The three-way verdict space includes UNCERTAIN as a first-class option. This is critical because it provides evaluators with an honest exit when they genuinely cannot determine the truth of a claim.

In binary systems (TRUE/FALSE only), an evaluator who is genuinely uncertain is forced to guess. Guessing introduces noise. Noise degrades the accuracy of the collective verdict. Worse, an evaluator who is uncertain but forced to choose will adopt a strategy---perhaps always voting with their prior, or always voting TRUE on the theory that submitted claims are more likely to be true than false. These strategies introduce correlated error, which is the most dangerous form of error in a voting system.

UNCERTAIN allows evaluators to express calibrated uncertainty. An evaluator who frequently votes UNCERTAIN on claims outside their expertise and TRUE/FALSE on claims within their expertise is behaving rationally and honestly. The reputation system does not penalize UNCERTAIN verdicts (they neither increment nor decrement the correctness ratio); it simply does not reward them.

### 10.3 Asymmetric Costs

The slash multiplier (currently 2x) creates an asymmetry between the cost of being wrong and the benefit of being right. This asymmetry is the mechanism's primary defense against low-quality evaluation.

An evaluator who submits random verdicts (p = 0.33 for three-way) will lose money on average:

$$E[\text{random}] = 0.33 \times \text{reward} - 0.67 \times \text{slash} < 0$$

An evaluator who submits lazy evaluations (p = 0.5, slightly better than random) will still lose money:

$$E[\text{lazy}] = 0.5 \times \text{reward} - 0.5 \times \text{slash} < 0 \quad (\text{because slash} > \text{reward for a single evaluator})$$

Only evaluators with accuracy above the break-even threshold (approximately p > 0.4, depending on pool dynamics) are profitable. The mechanism does not prevent bad evaluators from participating; it *bankrupt them out of existence over time*.

### 10.4 Reputation Decay

Reputation in the current implementation is a running accuracy ratio with no time weighting. A planned upgrade introduces exponential decay:

$$\text{reputationScore}_{t+1} = \lambda \cdot \text{reputationScore}_t + (1 - \lambda) \cdot \text{currentAccuracy}$$

Where $\lambda \in (0, 1)$ is the decay parameter. This ensures that an evaluator cannot rest on historical performance. A previously excellent evaluator who begins submitting low-quality evaluations will see their reputation degrade within dozens of evaluations, reducing their influence on future verdicts.

Decay also addresses the adversarial scenario where an attacker builds reputation through honest evaluation of easy claims, then uses their accumulated reputation weight to manipulate the verdict on a high-value claim. With decay, the attacker must maintain honest behavior continuously, not just during a reputation-building phase.

### 10.5 Experiential Diversity as a Structural Defense

The 64-shard architecture provides a defense that no single-evaluator or small-committee system can match: diversity of failure modes.

A single evaluator can be bribed, hacked, confused, or simply wrong. A small committee can be captured or suffer groupthink. But 64 independent evaluators with divergent experience histories, each blinded from the others via commit-reveal, represent 64 independent assessments. Compromising the verdict requires compromising a majority of evaluators, which requires:

1. Identifying the evaluators (their addresses are known, but not which specific claim they will evaluate)
2. Bribing or compromising 33+ of them simultaneously
3. Doing so without any of the compromised evaluators defecting (since defection---honestly evaluating and being correct---is more profitable than accepting a bribe smaller than the expected honest reward)

The economic cost of attack scales linearly with the number of evaluators and the bounty size. For high-value claims with large bounties, the cost of corrupting the verdict exceeds the value of doing so.

### 10.6 The Residual Risk

After all mitigations, residual risk remains. The evaluator network could systematically err on claims that fall outside its collective competence. A sufficiently resourced adversary could, in theory, register many sybil evaluators and build reputation over time. The UNCERTAIN verdict could be underused if evaluators believe that expressing uncertainty signals incompetence.

These are genuine risks. They are also risks that every oracle system faces in some form. The relevant comparison is not TaaS versus a perfect oracle (which does not exist) but TaaS versus the status quo: centralized adjudicators, plutocratic voting, and Schelling point games. On every dimension---herding resistance, plutocratic resistance, scalability, and knowledge accumulation---TaaS offers structural improvements.

---

## 11. Formal Properties

### 11.1 Incentive Compatibility

**Theorem 1 (Honest Evaluation Dominance)**: For an evaluator with accuracy $p > p^*$ (the break-even threshold), honest evaluation is the strictly dominant strategy.

*Proof sketch*: Under commit-reveal, an evaluator cannot condition their verdict on others' verdicts. Their expected payoff is determined solely by their accuracy $p$ and the reward/slash structure. For $p > p^*$:

$$E[\text{honest}] = p \cdot r - (1-p) \cdot s > 0$$

Any deviation from honest evaluation (random voting, always voting one way, etc.) reduces $p$ and thus reduces expected payoff. The evaluator maximizes expected payoff by maximizing accuracy, which is achieved by honest evaluation.

### 11.2 Sybil Resistance

**Theorem 2 (Capital-Bounded Sybil)**: An attacker controlling $k$ sybil identities with total capital $C$ cannot achieve higher expected payoff than a single identity with capital $C$ and equal accuracy.

*Proof sketch*: Each sybil identity must stake independently. Reputation weight is computed per-identity (square root dampening). The total vote weight of $k$ identities with capital $C/k$ each is:

$$\sum_{i=1}^{k} \sqrt{C/k} = k \cdot \sqrt{C/k} = \sqrt{kC}$$

The vote weight of a single identity with capital $C$ is $\sqrt{C}$. The sybil attacker's total weight $\sqrt{kC} > \sqrt{C}$, so sybil creation does increase vote weight. However, each sybil must also maintain independent reputation, and the *accuracy* of each sybil is the same (same attacker, same knowledge). The increased weight does not increase accuracy, so the break-even threshold still applies per-identity.

The mitigation is not perfect (sybil creation does increase weight), which is why the authorized evaluator registry exists as an additional gatekeeper. Future versions will incorporate stake-weighted quadratic voting to further penalize sybil strategies.

### 11.3 Truth Convergence

**Theorem 3 (Condorcet Convergence)**: For $n$ independent evaluators each with accuracy $p > 0.5$, the probability that the reputation-weighted majority verdict is correct approaches 1 as $n$ increases.

This follows directly from the Condorcet Jury Theorem, with the independence assumption guaranteed by commit-reveal (Section 3.4). The reputation weighting strengthens convergence (higher-accuracy evaluators have more weight), but even with uniform weighting, convergence holds.

### 11.4 Liveness

**Theorem 4 (Guaranteed Resolution)**: Every submitted claim either resolves with a verdict or expires with full refunds within a bounded time window.

*Proof sketch*: The claim lifecycle is bounded by `COMMIT_DURATION + REVEAL_DURATION = 36 hours`. If fewer than `minEvaluators` commit, the claim expires and all stakes and the bounty are refunded. If enough evaluators commit, the claim reaches REVEAL phase and eventually RESOLUTION. The `resolveClaim()` function is permissionless---anyone can trigger it after the reveal deadline. There is no state in which a claim can be permanently stuck.

---

## 12. Implementation Status

### 12.1 Deployed Contracts

The `CognitiveConsensusMarket` contract is implemented in Solidity 0.8.20, located at:

```
contracts/mechanism/CognitiveConsensusMarket.sol
```

The contract implements:
- Claim submission with configurable evaluator bounds [3, 21]
- Commit-reveal evaluation with keccak256 blinding
- Reputation-weighted tallying with square root dampening
- Asymmetric reward/slash distribution
- Expired claim refund mechanism
- On-chain evaluator reputation profiles

### 12.2 Integration with VibeSwap Infrastructure

The `CognitiveConsensusMarket` builds on VibeSwap's existing commit-reveal infrastructure, originally developed for MEV-resistant batch auctions in `CommitRevealAuction.sol`. The same cryptographic primitives (hash commitment, timed phases, deterministic resolution) are repurposed from trade execution to knowledge evaluation.

The `ShapleyDistributor` contract provides the mathematical framework for fair reward attribution. Its pairwise fairness library and Shapley approximation algorithms are directly applicable to evaluator reward distribution.

### 12.3 Roadmap

| Phase | Description | Status |
|-------|-------------|--------|
| 1. Core contract | `CognitiveConsensusMarket.sol` | Complete |
| 2. Shard integration | 64-shard evaluator network connected to contract | In progress |
| 3. Full Shapley rewards | Off-chain Shapley computation with on-chain verification | Planned |
| 4. Knowledge Cells on CKB | Resolved claims stored as CKB Knowledge Cells | Planned |
| 5. Reputation decay | Time-weighted reputation with exponential decay | Planned |
| 6. Quadratic sybil resistance | Stake-weighted quadratic voting to penalize sybil identities | Planned |
| 7. Cross-chain claims | LayerZero integration for multi-chain claim submission | Planned |

---

## 13. Conclusion

The oracle problem in decentralized systems has been half-solved. Numerical data feeds are reliable, fast, and battle-tested. But the harder half---evaluating claims that require judgment, not data retrieval---remains unaddressed at the infrastructure level.

Truth as a Service fills this gap with a mechanism that is:

1. **Herding-proof**: Commit-reveal eliminates information cascades by construction, not by incentive
2. **Scalable**: 64 independent evaluators provide statistical power exceeding manual review committees
3. **Meritocratic**: Reputation-weighted evaluation rewards accuracy, not capital
4. **Non-extractive**: Zero protocol fees (P-001 compliant)
5. **Knowledge-accumulating**: Every resolved claim becomes a permanent Knowledge Cell, building a compounding public good

The contract exists. The mechanism is defined. The evaluator network is being assembled. What remains is integration, iteration, and the slow accumulation of a knowledge graph that, given enough time and enough honest evaluators, becomes the most valuable oracle on any chain---not because it has the fastest feeds or the most nodes, but because it contains something no other oracle offers: *evaluated human and machine judgment, accumulated and curated, available as a permissionless service to any protocol that needs to know whether something is true*.

The true oracle was never a data feed. It was a mind.

---

## References

- Banerjee, A. V. (1992). "A simple model of herd behavior." *The Quarterly Journal of Economics*, 107(3), 797-817.
- Bikhchandani, S., Hirshleifer, D., & Welch, I. (1992). "A theory of fads, fashion, custom, and cultural change as informational cascades." *Journal of Political Economy*, 100(5), 992-1026.
- Condorcet, M. de (1785). *Essai sur l'application de l'analyse a la probabilite des decisions rendues a la pluralite des voix*.
- Glynn, W. (2026). "Epistemic Staking: Knowledge-Weighted Governance for Decentralized Systems." VibeSwap Documentation.
- Glynn, W. (2026). "Cooperative Reward Systems with Shapley Value Attribution." VibeSwap Documentation.
- Lesaege, C., Ast, F., & George, W. (2019). "Kleros: Short Paper." Kleros Cooperative.
- Shapley, L. S. (1953). "A value for n-person games." In *Contributions to the Theory of Games*, vol. II, 307-317.
- Surowiecki, J. (2004). *The Wisdom of Crowds*. Doubleday.
- UMA Protocol. (2020). "Optimistic Oracle." UMA Documentation.

---

*This paper formalizes the mechanism implemented in `contracts/mechanism/CognitiveConsensusMarket.sol`. The contract is the specification; this paper is the explanation.*

*P-000: Fairness Above All. P-001: No Extraction Ever. The truth should be free.*
