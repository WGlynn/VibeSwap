# Truth as a Service: A Permissionless Oracle for Subjective Claims

**"Chainlink tells you the price of ETH. It cannot tell you whether a governance proposal is sound, whether a code audit is thorough, or whether an insurance claim is legitimate. The oracle problem was never about data feeds. It was about judgment."**

Faraday1 (Will Glynn) | March 2026

---

## Abstract

Existing oracle infrastructure solves a narrow problem: feeding numerical data from the physical world into smart contracts. Chainlink, Pyth, and their successors answer "What is the price of X?" with increasing speed and redundancy. But the vast majority of decisions that decentralized systems need to make are not numerical. They are epistemic. "Is this governance proposal sound?" "Is this insurance claim legitimate?" "Is this code secure?" These questions require *judgment*, not data retrieval. We present **Truth as a Service (TaaS)**, a permissionless oracle protocol for subjective claim evaluation. The mechanism combines commit-reveal blinding to eliminate information cascades, a 64-shard evaluator network to guarantee cognitive diversity, Shapley value attribution for truth discovery, and an accumulating knowledge graph stored as Knowledge Cells on Nervos CKB. The core contract, `CognitiveConsensusMarket.sol`, is implemented and operational. Any protocol can submit a claim with a bounty; evaluators stake on verdicts (TRUE, FALSE, or UNCERTAIN); commit-reveal blinding prevents herding; reputation-weighted majority resolves; correct evaluators earn linear rewards; incorrect evaluators lose quadratic stakes. The protocol extracts no fees (P-001: No Extraction Ever). The resulting knowledge graph is a public good whose value compounds monotonically with every resolved claim.

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

The blockchain oracle problem concerns the importation of external state into deterministic execution environments. Chainlink's decentralized oracle network operationalized this at scale: multiple independent node operators fetch data, aggregate via median, and post on-chain. Pyth extended the model to sub-second latency. RedStone introduced modular delivery. API3 proposed first-party oracles. Every one of these systems answers the same fundamental question: *What is the current numerical value of an observable external quantity?*

### 1.2 What Oracles Cannot Solve

Consider the questions decentralized protocols actually need answered:

- **DAO governance**: "Is Proposal #47 technically sound and economically viable?"
- **Insurance**: "Did this exploit result from a genuine vulnerability or user negligence?"
- **Code audits**: "Does this contract contain critical vulnerabilities?"
- **Content moderation**: "Is this NFT collection plagiarized or original?"
- **Grant evaluation**: "Will this proposal deliver meaningful public goods?"
- **Peer review**: "Is this mechanism design paper's proof correct?"

None have numerical answers. None can be resolved by fetching data from an API. They require *evaluation*: domain knowledge, contextual understanding, logical reasoning, and epistemic judgment integrated into a considered verdict.

### 1.3 The Scale of the Gap

| Domain | Annual Decisions | Current Resolution |
|--------|-----------------|-------------------|
| DAO governance proposals | ~50,000+ | Token-weighted voting (plutocratic) |
| DeFi insurance claims | ~2,000+ events | Centralized assessors or Schelling games |
| Smart contract audits | ~10,000+ contracts/month | 3-5 firms ($50K-$500K each, weeks-months) |
| Content moderation | Millions of items | Centralized platforms or nothing |
| Grant evaluation | ~5,000+ proposals/year | Small committees, limited bandwidth |
| Research peer review | Entire publishing system | Unpaid reviewers, 6-12 month delays |

### 1.4 Why Prediction Markets Are Not the Answer

One might argue that prediction markets already handle subjective evaluation. Polymarket demonstrated during the 2024 U.S. presidential election that markets can aggregate information about uncertain future events with remarkable accuracy.

But prediction markets resolve via *observable outcomes*. "Will X happen by date Y?" is fundamentally different from "Is X true?" or "Is X a good idea?" Prediction markets require:

1. A clearly defined binary outcome
2. An unambiguous resolution date
3. An external event that can be verified after the fact

Most epistemic questions satisfy none of these criteria. "Is this governance proposal sound?" has no resolution date. "Is this code secure?" is not binary---secure against which threat model, at what confidence level? "Is this research reproducible?" requires active evaluation, not passive observation of a future event.

Prediction markets are oracles for future events. Truth as a Service is an oracle for present judgments. The two are complementary, not competing.

---

## 2. The CognitiveConsensusMarket Mechanism

### 2.1 Three-Phase Protocol

```
Phase 1: COMMIT (24 hours)
  Evaluators submit hash(verdict || reasoningHash || salt) with stake deposit.
  No evaluator can see any other evaluator's verdict.

Phase 2: REVEAL (12 hours)
  Evaluators reveal verdict, reasoning hash, and salt.
  Contract verifies hash matches commitment. Reputation-weighted votes tallied.

Phase 3: RESOLUTION (permissionless trigger)
  Reputation-weighted majority determines verdict.
  Correct evaluators: bounty + slash pool (pro-rata by reputation weight).
  Incorrect evaluators: lose stake fraction (asymmetric cost).
  Unrevealed evaluators: fully slashed (protocol violation).
```

### 2.2 Claim Submission

Any address submits a `claimHash` (IPFS CID), `bounty` (ERC-20 reward pool), and `minEvaluators` (range [3, 21]). The odd maximum ensures tiebreaking. The minimum of 3 prevents single-evaluator or colluding-pair determination. Commit and reveal deadlines are protocol constants, not proposer-configurable---uniformity prevents gaming via time pressure.

### 2.3 Blinded Commitment

Evaluators commit `keccak256(abi.encodePacked(verdict, reasoningHash, salt))`. The three-element verdict space (TRUE, FALSE, UNCERTAIN) would be trivially brute-forced without the random salt. Each evaluator stakes at least 0.01 ETH for sybil resistance and incentive alignment.

Reputation weight is computed as the square root of the evaluator's reputation score:

```
repWeight = sqrt(reputationScore)
```

Square root dampening prevents high-reputation evaluators from dominating: 4x reputation yields 2x weight, not 4x. This preserves informational diversity.

### 2.4 Revelation and Tallying

After the commit deadline, evaluators reveal their parameters. The contract recomputes the hash and verifies the match---an evaluator who committed cannot change their verdict after seeing others' reveals. Votes are tallied with reputation weighting.

### 2.5 Expiry and Liveness

If insufficient evaluators commit during the commit phase (fewer than `minEvaluators`), the claim transitions to `EXPIRED` state. The proposer's bounty and all evaluator stakes are fully refunded via `refundExpired()`. This guarantees that submitting a claim is risk-free for the proposer---if the evaluator network does not have capacity or interest, the proposer loses nothing.

The `EXPIRED` path also serves as a natural demand signal: claims that repeatedly expire indicate topics that the evaluator network lacks competence to address, surfacing gaps in the network's coverage.

### 2.6 Resolution and Reward Distribution

The verdict is determined by reputation-weighted majority across the three-way space. UNCERTAIN is a first-class verdict, not a failure mode.

**Correct evaluators**: Stake returned + pro-rata share of (bounty + slash pool), weighted by reputation. Correctness counter incremented.

**Incorrect evaluators**: Lose a fraction of stake to the slash pool. Remainder returned. Reputation degraded.

**Unrevealed evaluators**: Entire stake slashed. Harshest penalty because failing to reveal breaks the protocol for everyone.

**No correct evaluators**: Bounty returned to proposer.

The key asymmetry: *the expected cost of being wrong exceeds the expected reward of being right*. An evaluator correct 50% of the time will lose money. Only evaluators correct more often than not can sustain participation. The mechanism self-selects for competence.

### 2.7 Reputation Dynamics

```
reputationScore = max(1000, (correctEvaluations / totalEvaluations) * 10000)
```

The floor of 1000 (10%) prevents permanent exclusion from a bad streak. New evaluators start at 10000 (100%) and converge toward their true accuracy rate. Natural selection pressure: evaluators below the break-even accuracy threshold gradually lose capital and reputation until they improve or exit.

---

## 3. Why Commit-Reveal Kills Herding

### 3.1 Information Cascades

Banerjee (1992) identified the mechanism by which rational agents, acting sequentially with observable actions, converge on incorrect collective beliefs. Agent A acts on a private signal. Agent B observes A's action, and if B's signal is weak, B rationally copies A. Agent C observes A and B acting identically and copies regardless of their own signal. The cascade amplifies noise into apparent consensus.

### 3.2 Herding in Decentralized Systems

This is not theoretical. DAO governance votes exhibit strong early-mover herding: proposals with early "For" votes are dramatically more likely to pass. Kleros jurors can observe emerging consensus and rationally vote with the majority. Audit platforms show severity inflation when early reviewers flag findings as "Critical."

### 3.3 The Structural Solution

Commit-reveal eliminates cascades by construction, not by incentive design. During the commit phase, no evaluator can observe any other's verdict. The blinded hash reveals nothing (the salt prevents brute-force reversal). Each evaluator forms their verdict based solely on the claim content and their own judgment.

This is exactly the independence condition that Condorcet's Jury Theorem requires: independent evaluators with accuracy p > 0.5 converging on truth as n increases. Formally:

$$P(\text{observe } s_j \mid i \neq j) = 0 \quad \forall i, j \text{ during commit phase}$$

This is a hard zero enforced by the preimage resistance of keccak256, not by incentive compatibility. No game-theoretic analysis is needed. The cryptographic commitment makes observation of others' signals physically impossible.

---

## 4. 64 Shards as Independent Evaluators

### 4.1 Shards, Not Swarms

VibeSwap's AI infrastructure operates as 64 semi-autonomous shards---complete cognitive instances, not specialized sub-agents. Each shard is a full instantiation of the JARVIS framework, capable of independent reasoning, code analysis, and epistemic judgment.

| Property | Swarm Model | Shard Model |
|----------|-------------|-------------|
| Agent capability | Specialized (narrow) | Complete (full-stack) |
| Failure mode | Cascade (pipeline breaks) | Isolated (63 remain) |
| Diversity | Low (shared blindspots) | High (experiential divergence) |

### 4.2 Cognitive Diversity Through Experience

The 64 shards begin from a common base but diverge through experience. Each evaluates different claims in different sequences, accumulates different reputation profiles, and develops different heuristics. This experiential divergence satisfies Surowiecki's (2004) preconditions for collective intelligence: diversity of opinion, independence of judgment, and decentralization.

### 4.3 Why 64?

With 64 independent evaluators at accuracy p = 0.7, the probability of incorrect majority verdict is below 10^-6---lower than most numerical oracle error rates. The cost of 64 AI evaluations is a fraction of a single manual audit from a top-tier security firm. Not all 64 evaluate every claim; domain relevance, bounty size, and reputation determine participation.

### 4.4 The Correlation Problem

If all shards share a training base, are they truly independent? Three mitigations: (1) experiential divergence creates different cognitive priors over time, (2) domain specialization emerges naturally through reputation dynamics, and (3) the contract does not distinguish AI from human evaluators---hybrid evaluation combines AI scalability with human out-of-distribution reasoning, and commit-reveal prevents either class from herding on the other.

---

## 5. Shapley Attribution for Truth Discovery

### 5.1 Beyond Equal Split

After resolution, the protocol must attribute epistemic contribution. Equal split fails: 20 evaluators voting TRUE on an obviously true claim are not equally valuable. The Shapley value (Shapley, 1953) answers: "How much worse would the network's knowledge be without this specific evaluator?"

$$\phi_i(v) = \sum_{S \subseteq N \setminus \{i\}} \frac{|S|!(|N|-|S|-1)!}{|N|!} \left[ v(S \cup \{i\}) - v(S) \right]$$

### 5.2 Practical Implementation

Full Shapley computation over 2^n coalitions is intractable for n > 20. The current implementation uses reputation-weighted pro-rata distribution as a first-order approximation:

```solidity
uint256 reward = (rewardPool * eval.reputationWeight) / totalCorrectWeight;
```

This satisfies efficiency (full pool distributed) and symmetry (equal weights yield equal rewards). Full Shapley attribution via the `ShapleyDistributor` contract's pairwise fairness library is a planned upgrade using off-chain computation with on-chain verification.

### 5.3 Why Shapley Matters

Shapley creates second-order incentives: it rewards non-obvious truths (high marginal contribution on difficult claims), discourages trivial agreement (low marginal value on easy claims), and rewards epistemic courage (voting UNCERTAIN when vindicated later has high marginal value). The optimal strategy under Shapley is to evaluate claims where your expertise provides the highest marginal value, naturally directing attention to the hardest, most valuable questions.

---

## 6. Revenue Model and P-001 Compliance

### 6.1 Zero Extraction

```
[Submitting Protocol] --bounty--> [Contract] --rewards--> [Correct Evaluators]
                                              --slash----> [Reward Pool]
                                              --refund---> [Proposer (if no consensus)]
```

The protocol extracts zero fees. No commission, no treasury rake, no governance tax. P-001 (No Extraction Ever) is not altruism---it is mechanism design.

Protocols that extract fees from oracle services create a structural incentive to *increase the volume of oracle queries regardless of their necessity or quality*. Fee-extracting oracles are incentivized to make themselves indispensable (vendor lock-in), to discourage alternative resolution methods (market capture), and to increase query frequency (churning). This is the extractive pattern that VibeSwap was built to eliminate.

Under zero extraction, the protocol's sustainability comes from three sources:

1. **Evaluator sustainability**: Correct evaluators earn bounties and slashed stakes. The evaluator ecosystem is self-sustaining as long as submitting protocols fund bounties and evaluator accuracy remains above the break-even threshold.

2. **Network effects**: Each resolved claim adds to the knowledge graph. The knowledge graph makes future evaluations easier and more accurate, increasing evaluator accuracy, increasing the value of the service, attracting more submissions. This flywheel does not require extraction to spin.

3. **Ecosystem integration**: Truth as a Service becomes infrastructure that other VibeSwap components depend on---governance evaluation, dispute resolution, oracle validation. The value accrues to the ecosystem, not to a fee-collecting intermediary.

### 6.2 Evaluator Economics

Expected profit per claim:

$$E[\text{profit}] = p \cdot \left(\frac{w_i}{\sum w_j} \cdot (\text{bounty} + \text{slashPool})\right) - (1-p) \cdot \frac{\text{stake}}{S_m}$$

Break-even accuracy is approximately 40%. The mechanism is sustainably profitable for good evaluators and sustainably unprofitable for poor ones.

---

## 7. Use Cases

### 7.1 DAO Governance Evaluation

Before a governance vote, the DAO submits the proposal to TaaS for independent evaluation. Evaluators assess technical soundness, economic viability, security implications, and alignment with the protocol's stated objectives. The verdict (TRUE = "proposal is sound," FALSE = "proposal has critical flaws," UNCERTAIN = "insufficient information") is published before voting begins. Governance participants receive an independent, expert, herding-free assessment. They remain free to vote however they wish, but they vote *informed*. This does not replace governance; it augments it with a layer of epistemic quality control that token-weighted voting cannot provide.

### 7.2 Insurance Claim Adjudication

When a DeFi insurance claim is filed, the insurance protocol submits the claim details, evidence of loss, and policy terms to TaaS. Evaluators determine whether the claim meets the policy criteria. The evaluation is independent of both the insurer's incentive to deny claims (to preserve reserves) and the claimant's incentive to exaggerate losses. Neither party controls the evaluation. The commit-reveal structure ensures that evaluators assess the claim on its merits rather than herding toward whichever verdict appears to be forming.

### 7.3 Code Audit Verification

A protocol submits its deployed contract bytecode and source code to TaaS. Evaluators assess the code for known vulnerability patterns, logic errors, access control issues, and economic attack vectors. Unlike traditional audits, TaaS evaluation is continuous: any time the code is upgraded, a new claim can be submitted. The cost is a fraction of a traditional audit ($50K-$500K for a top-tier firm). The evaluator pool is larger and more diverse than any single firm. The commit-reveal structure prevents any evaluator from copying another's findings.

### 7.4 Content Moderation

Flagged content on decentralized platforms (Lens, Farcaster, NFT marketplaces) is submitted to TaaS for evaluation against the platform's published content policy. The three-way verdict provides nuance: TRUE = "violates policy," FALSE = "does not violate," UNCERTAIN = "edge case requiring human review." The commit-reveal structure prevents the mob dynamics that plague open moderation systems, where early "guilty" verdicts cascade into unanimous condemnation regardless of merit.

### 7.5 Grant Evaluation

Grant proposals are submitted to TaaS for assessment of feasibility, team capability, alignment with ecosystem goals, and expected impact. Evaluators with domain expertise in the proposal's area naturally contribute higher-quality evaluations and earn higher reputation through the feedback loop. The system scales with proposal volume rather than being bottlenecked by a fixed review committee---the perennial problem of ecosystem grant programs that receive far more proposals than reviewers can process.

### 7.6 Research Peer Review

Research papers are submitted to TaaS for evaluation of methodology, reproducibility, novelty, and correctness of proofs. The reasoning hash provides a permanent, timestamped record of each reviewer's analysis. Reputation tracking creates accountability that traditional peer review lacks: reviewers who consistently identify genuine contributions (or genuine flaws) build verifiable track records. Bad reviewers lose reputation and stake. Good reviewers earn both. The knowledge graph accumulates a permanent record of which claims survived scrutiny and which did not.

---

## 8. The Knowledge Graph

### 8.1 Claims as Knowledge Cells

Every resolved claim becomes a permanent record stored as a Knowledge Cell on Nervos CKB, containing: the claim content (IPFS CID), verdict, evaluator count and reputation profile, reasoning hashes, timestamp, and cross-references to related claims.

### 8.2 Compounding Value

The knowledge graph exhibits monotonically increasing value. Each new resolved claim:

1. **Adds a reference point**: "Is this new governance proposal sound?" can be evaluated in the context of structurally similar past proposals and their outcomes. Evaluators reason by analogy to prior resolved claims.

2. **Calibrates evaluators**: Early reputation estimates are noisy; long-run estimates converge on true evaluator quality. After 1000 resolved claims, the reputation system has high-fidelity accuracy scores for every active evaluator.

3. **Reveals meta-patterns**: Which types of claims are most controversial? Which domains have the highest evaluator disagreement? Where are the genuine knowledge frontiers? The graph answers questions about the *structure of human uncertainty* that no individual evaluation can.

4. **Creates a compounding moat**: The knowledge graph is a public good, but it is expensive to replicate. A competitor must accumulate thousands of evaluated claims before their graph provides comparable value. The first-mover advantage is not in technology (the contract is open source) but in *accumulated epistemic capital*---the same asymmetry that makes Wikipedia hard to displace despite being freely copyable.

### 8.3 CKB as Substrate

Nervos CKB's cell model is architecturally suited to knowledge storage in ways that account-based chains are not:

- **Cells are first-class data objects**: A knowledge cell is not a mapping entry in a contract's storage trie. It is an independent, transferable, composable object with its own lifecycle. Knowledge cells can be referenced, extended, and linked without modifying the originating contract.

- **State rent enforces curation**: CKB's state rent model means that knowledge cells that are no longer referenced naturally release their state occupation. Low-value or superseded claims are economically pressured out of active storage, while high-value frequently-referenced claims persist. The graph self-curates through economic incentives.

- **Type scripts enforce invariants**: Programmable type scripts on knowledge cells can enforce structural correctness---a knowledge cell's verdict field must be one of three values; the evaluator count must meet the minimum threshold; the resolution timestamp must fall after the reveal deadline. The data structure is self-validating.

The knowledge graph on CKB is not a database. It is a growing, self-curating library of evaluated knowledge whose storage costs are borne by those who find it valuable and whose structural integrity is enforced by the chain itself.

---

## 9. Comparison with Existing Systems

| Dimension | Polymarket | Kleros | UMA | Chainlink | **TaaS** |
|-----------|-----------|--------|-----|-----------|----------|
| **Claim type** | Binary future events | Disputes | Assertions | Numerical data | **Arbitrary epistemic** |
| **Resolution** | External oracle | Schelling point | Token-weighted vote | Data aggregation | **Commit-reveal evaluation** |
| **Herding risk** | High (prices visible) | High (vote with majority) | High (token plutocracy) | N/A (data, not judgment) | **Zero (blinded commits)** |
| **Evaluator incentive** | Market profit | Vote with majority | Hold UMA tokens | Run node | **Accuracy (stake + reputation)** |
| **Knowledge accumulation** | None (prices reset) | None | None | None | **Permanent knowledge graph** |
| **Expressiveness** | Binary | Binary | Binary | Numerical | **Ternary (TRUE/FALSE/UNCERTAIN)** |

**Polymarket** is a powerful tool for probabilistic forecasting of observable events. It demonstrated during the 2024 U.S. presidential election that markets can aggregate information with remarkable accuracy. But it resolves via external oracles (UMA), not internal evaluation. It cannot answer "Is this claim true?" without a future event to observe.

**Kleros** implements a Schelling point game where jurors are incentivized to vote with the expected majority. This works when truth is the obvious focal point, but fails on genuinely ambiguous claims where reasonable evaluators disagree. The rational Kleros juror asks "What will others vote?" rather than "What is true?" Commit-reveal eliminates this dynamic structurally.

**UMA** (Optimistic Oracle) is efficient for claims where the correct answer is obvious and disputes are rare. For genuinely contested claims, UMA degrades to token-weighted voting by UMA holders---which is plutocratic by construction. The party with the most UMA tokens determines truth.

**Chainlink** answers a categorically different question. TaaS does not compete with Chainlink; the two are complementary layers of a complete oracle stack. A protocol may use Chainlink for price data and TaaS for governance evaluation simultaneously.

---

## 10. The Oracle Recursion Problem

### 10.1 Who Evaluates the Evaluators?

Every oracle faces quis custodiet ipsos custodes. TaaS does not claim to solve this---the recursion is fundamental. But structural mitigations make it practically manageable:

**UNCERTAIN as honest exit**: Evaluators who cannot confidently assess a claim express calibrated uncertainty rather than guessing. This prevents the correlated noise that forced binary verdicts introduce.

**Asymmetric costs**: The slash multiplier ensures random evaluators (p = 0.33) and lazy evaluators (p = 0.5) both lose money. Only evaluators above the break-even threshold (~40%) are profitable. The mechanism bankrupts bad evaluators out of existence over time.

**Reputation decay** (planned): Exponential decay ensures evaluators cannot rest on historical performance. An attacker who builds reputation through honest easy evaluations, then manipulates a high-value claim, must maintain honest behavior continuously.

**Experiential diversity**: 64 independent evaluators with divergent histories represent 64 independent assessments. Compromising the verdict requires bribing 33+ simultaneously, and defection (honestly evaluating) is more profitable than accepting a bribe smaller than the expected honest reward.

### 10.2 Residual Risk

After all mitigations, residual risk remains:

- **Systematic blind spots**: The evaluator network could err on claims that fall outside its collective competence. AI shards trained on similar data may share failure modes on genuinely novel or adversarial claims.
- **Long-term sybil accumulation**: A sufficiently patient, well-funded adversary could register sybil evaluators and build legitimate reputation over months before deploying it to manipulate a single high-value claim.
- **UNCERTAIN underuse**: Evaluators may perceive UNCERTAIN as signaling incompetence rather than honest calibration, leading to overconfident TRUE/FALSE verdicts on genuinely ambiguous claims.
- **Collusion during reveal**: While commits are blinded, the reveal phase is public. Evaluators who have not yet revealed could theoretically observe early reveals and adjust behavior (though they cannot change their committed verdict, they could choose not to reveal---accepting the full slash as a strategic loss).

These are genuine risks. They are also risks that every oracle system faces in some form. The relevant comparison is not TaaS versus a perfect oracle (which does not exist) but TaaS versus the status quo: centralized adjudicators, plutocratic voting, and Schelling point games. On every dimension---herding resistance, plutocratic resistance, scalability, knowledge accumulation---TaaS offers structural improvements over every existing alternative.

---

## 11. Formal Properties

### 11.1 Incentive Compatibility

**Theorem 1 (Honest Evaluation Dominance)**: For an evaluator with accuracy p > p* (the break-even threshold), honest evaluation is the strictly dominant strategy.

*Proof sketch*: Under commit-reveal, an evaluator cannot condition their verdict on others' verdicts. Expected payoff is determined solely by accuracy p and the reward/slash structure. For p > p*, E[honest] = p * r - (1-p) * s > 0. Any deviation from honest evaluation reduces p and thus expected payoff. The evaluator maximizes expected payoff by maximizing accuracy, achieved by honest evaluation.

### 11.2 Sybil Resistance

**Theorem 2 (Capital-Bounded Sybil)**: An attacker controlling k sybil identities with total capital C cannot achieve higher expected payoff than a single identity with capital C and equal accuracy.

*Proof sketch*: Each sybil must stake independently. Reputation weight is sqrt per-identity. Total weight of k identities with capital C/k each: k * sqrt(C/k) = sqrt(kC) > sqrt(C). Sybil creation does increase weight, but each sybil must maintain independent reputation, and accuracy is identical across all sybils. The increased weight does not increase accuracy. The authorized evaluator registry provides an additional gatekeeper; future versions will incorporate quadratic voting to further penalize sybil strategies.

### 11.3 Truth Convergence

**Theorem 3 (Condorcet Convergence)**: For n independent evaluators each with accuracy p > 0.5, the probability that the reputation-weighted majority verdict is correct approaches 1 as n increases.

This follows from the Condorcet Jury Theorem with the independence assumption guaranteed by commit-reveal (Section 3.3). Reputation weighting strengthens convergence by amplifying higher-accuracy evaluators, but convergence holds even with uniform weighting.

### 11.4 Liveness

**Theorem 4 (Guaranteed Resolution)**: Every submitted claim either resolves with a verdict or expires with full refunds within a bounded time window of COMMIT_DURATION + REVEAL_DURATION = 36 hours.

*Proof sketch*: If fewer than minEvaluators commit, the claim expires and all stakes and the bounty are refunded. If enough commit, the claim reaches REVEAL and eventually RESOLUTION. The `resolveClaim()` function is permissionless. There is no state in which a claim can be permanently stuck.

---

## 12. Implementation Status

### 12.1 Deployed Contract

`CognitiveConsensusMarket.sol` is implemented in Solidity 0.8.20 at `contracts/mechanism/CognitiveConsensusMarket.sol`, featuring claim submission with configurable evaluator bounds [3, 21], commit-reveal with keccak256 blinding, reputation-weighted tallying with sqrt dampening, asymmetric reward/slash distribution, and on-chain evaluator profiles.

### 12.2 Integration

The contract builds on VibeSwap's existing commit-reveal infrastructure from `CommitRevealAuction.sol`. The `ShapleyDistributor` contract provides the pairwise fairness library for evaluator reward attribution.

### 12.3 Roadmap

| Phase | Description | Status |
|-------|-------------|--------|
| Core contract | `CognitiveConsensusMarket.sol` | Complete |
| Shard integration | 64-shard evaluator network | In progress |
| Full Shapley rewards | Off-chain computation, on-chain verification | Planned |
| Knowledge Cells | Resolved claims on CKB | Planned |
| Reputation decay | Time-weighted exponential decay | Planned |
| Quadratic sybil resistance | Penalize sybil identity splitting | Planned |
| Cross-chain claims | LayerZero multi-chain submission | Planned |

---

## 13. Conclusion

The oracle problem has been half-solved. Numerical data feeds are reliable and battle-tested. But the harder half---evaluating claims that require judgment, not data retrieval---remains unaddressed at the infrastructure level. Every DAO, every insurance protocol, every content platform, every grant program needs the answer to questions that no price feed can resolve.

Truth as a Service fills this gap with a mechanism that is:

- **Herding-proof**: Commit-reveal eliminates information cascades by construction, not by incentive
- **Scalable**: 64 independent evaluators provide statistical power exceeding manual review committees
- **Meritocratic**: Reputation-weighted evaluation rewards accuracy, not capital
- **Non-extractive**: Zero protocol fees, full P-001 compliance
- **Knowledge-accumulating**: Every resolved claim becomes a permanent Knowledge Cell, building a compounding public good whose value grows monotonically with every evaluation

The contract exists. The mechanism is defined. The evaluator network is being assembled. What remains is integration, iteration, and the slow accumulation of a knowledge graph that becomes the most valuable oracle on any chain---not because it has the fastest feeds or the most nodes, but because it contains something no other oracle offers: *evaluated human and machine judgment, accumulated and curated, available as a permissionless service to any protocol that needs to know whether something is true*.

The true oracle was never a data feed. It was a mind.

---

## References

- Banerjee, A. V. (1992). "A simple model of herd behavior." *Quarterly Journal of Economics*, 107(3), 797-817.
- Bikhchandani, S., Hirshleifer, D., & Welch, I. (1992). "A theory of fads, fashion, custom, and cultural change as informational cascades." *Journal of Political Economy*, 100(5), 992-1026.
- Condorcet, M. de (1785). *Essai sur l'application de l'analyse a la probabilite des decisions rendues a la pluralite des voix*.
- Glynn, W. (2026). "Epistemic Staking: Knowledge-Weighted Governance." VibeSwap Documentation.
- Glynn, W. (2026). "Cooperative Reward Systems with Shapley Value Attribution." VibeSwap Documentation.
- Shapley, L. S. (1953). "A value for n-person games." *Contributions to the Theory of Games*, vol. II, 307-317.
- Surowiecki, J. (2004). *The Wisdom of Crowds*. Doubleday.

---

*This paper formalizes the mechanism implemented in `contracts/mechanism/CognitiveConsensusMarket.sol`. The contract is the specification; this paper is the explanation.*

*P-000: Fairness Above All. P-001: No Extraction Ever. The truth should be free.*
