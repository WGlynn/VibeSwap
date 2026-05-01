# Information Markets: Truth as a Tradeable Asset in the Cooperative Intelligence Network

**Faraday1 (Will Glynn)**

**March 2026**

---

## Abstract

Price markets aggregate private beliefs about value into a public signal called price. Prediction markets aggregate private beliefs about outcomes into a public signal called probability. This paper argues that the VibeSwap protocol --- specifically, the 64-shard CRPC (Commit-Reveal Pairwise Comparison) knowledge verification network --- constitutes a third category: an *information market* that aggregates private beliefs about truth into a public signal called *verified knowledge*.

The mechanism is structural, not metaphorical. Shards independently evaluate claims against a constitutional corpus, commit hashed judgments before seeing peers' assessments, reveal and compare pairwise, and settle via majority with Shapley-weighted reputation attribution. The result is an oracle that does not depend on any single evaluator's honesty, because the commit-reveal structure makes strategic deception unprofitable and the pairwise comparison eliminates anchoring bias.

We demonstrate that this architecture generalizes Robin Hanson's futarchy --- "vote on values, bet on beliefs" --- into a three-layer system: constitute on values (P-000, P-001), market on beliefs (CRPC), and distribute on contribution (Shapley). We show that the resulting information market has properties no existing prediction market achieves: multi-dimensional truth verification, continuous confidence pricing, anti-misinformation incentives grounded in reputation staking, and an Oracle-as-a-Service model that sells verified information to any protocol willing to pay for it.

The Epistemic Gate from the Archetype Primitives is the founding axiom: "Before the ledger, truth was arguable. After the ledger, truth is mathematical." This paper makes that axiom operational.

---

## Table of Contents

1. [From Price Markets to Information Markets](#1-from-price-markets-to-information-markets)
2. [The Mechanism: Commit-Reveal for Claims](#2-the-mechanism-commit-reveal-for-claims)
3. [Shards as Truth Validators](#3-shards-as-truth-validators)
4. [Reputation Staking](#4-reputation-staking)
5. [Futarchy and the VibeSwap Generalization](#5-futarchy-and-the-vibeswap-generalization)
6. [Oracle-as-a-Service](#6-oracle-as-a-service)
7. [Epistemic Pricing](#7-epistemic-pricing)
8. [Comparison with Existing Prediction Markets](#8-comparison-with-existing-prediction-markets)
9. [Anti-Misinformation by Construction](#9-anti-misinformation-by-construction)
10. [The Epistemic Gate Made Literal](#10-the-epistemic-gate-made-literal)
11. [Formal Properties](#11-formal-properties)
12. [Implementation Status](#12-implementation-status)
13. [Conclusion](#13-conclusion)
14. [References](#14-references)

---

## 1. From Price Markets to Information Markets

### 1.1 What Markets Actually Discover

Markets are information aggregation machines. This is not a metaphor --- it is the literal function they perform. A price is a compressed summary of every participant's private information about value, filtered through the mechanism rules that govern how that information is expressed, collected, and settled.

The insight that makes VibeSwap possible is that the commit-reveal batch auction mechanism used for price discovery is not specific to prices. The mechanism aggregates *any* privately held information into a public consensus signal, provided three conditions are met:

1. Participants hold private beliefs about the quantity being estimated.
2. The mechanism prevents participants from observing others' beliefs before committing their own.
3. Settlement rewards accuracy and penalizes inaccuracy.

Prices satisfy all three conditions. So do claims about the state of the world.

### 1.2 The Three Market Types

| Market Type | What It Discovers | Signal | Example |
|---|---|---|---|
| **Price market** | Asset value | Clearing price | VibeSwap batch auctions |
| **Prediction market** | Event probability | Outcome share price | Polymarket, Augur |
| **Information market** | Claim truth value | Verification confidence | CRPC shard network (this paper) |

The first two are well understood. The third is what this paper formalizes.

A price market asks: "What is ETH worth?" A prediction market asks: "Will ETH exceed $5,000 by December?" An information market asks: "Is it true that the Ethereum Shanghai upgrade reduced validator centralization?" The answer is not a number or a probability. It is a verified claim with an attached confidence level, produced by independent evaluators who staked reputation on their assessment.

### 1.3 VibeSwap's Natural Extension

VibeSwap already performs cooperative price discovery. The commit-reveal batch auction aggregates private order information into a uniform clearing price without information leakage, front-running, or MEV extraction. The mechanism works because participants cannot see each other's orders before committing, honest revelation is the dominant strategy, and Shapley values distribute rewards proportional to each participant's marginal contribution to accurate price formation.

The extension to information markets requires changing only the *content* of what is committed and revealed, not the *mechanism*. Instead of committing `hash(order || secret)`, a shard commits `hash(assessment || secret)`. Instead of revealing a trade, a shard reveals a judgment. Instead of settling on a clearing price, the network settles on a truth value. The four-phase CRPC protocol already implements this extension.

---

## 2. The Mechanism: Commit-Reveal for Claims

### 2.1 CRPC: The Four Phases

The Commit-Reveal Pairwise Comparison protocol, as implemented in the shard network, operates in four phases. Each phase mirrors the corresponding phase in the VibeSwap batch auction, adapted from price claims to truth claims.

**Phase 1 --- Work Commit.** A claim enters the network. Each participating shard independently evaluates the claim against its constitutional corpus (the CKB, protocol documentation, and domain-specific knowledge bases). The shard generates an assessment --- a structured judgment of truth value, supporting evidence, confidence level, and reasoning chain --- and publishes `hash(assessment || secret)` to all peers. The hash commitment prevents any shard from observing others' assessments before forming its own. This is the same anti-copying mechanism that prevents front-running in the price auction.

**Phase 2 --- Work Reveal.** Shards reveal their actual assessments and secrets. Peers verify that the hash of the revealed assessment matches the committed hash. Any shard whose reveal does not match its commitment receives a reputation penalty and its assessment is excluded from subsequent phases. This is identical to the 50% slashing for invalid reveals in the price auction --- the penalty for dishonest revelation exceeds any possible gain from strategic misrepresentation.

**Phase 3 --- Compare Commit.** Validator shards (which may include the original evaluators or a separate validator set) compare assessments pairwise. For each pair (A, B), each validator commits `hash(choice || secret)` where `choice` is one of `{A_BETTER, B_BETTER, EQUIVALENT}`. The epsilon threshold for equivalence is a semantic similarity score above 0.85 --- the "fuzzy" in fuzzy consensus. This phase prevents collusion among validators.

**Phase 4 --- Compare Reveal.** Validators reveal their pairwise choices and secrets. The majority determines the winner of each pair. The submission with the most pairwise wins becomes the consensus output. Validators whose judgments aligned with the majority receive reputation boosts; those who dissented receive reputation adjustments proportional to their distance from consensus.

### 2.2 From Trades to Claims: The Structural Isomorphism

The following table maps each component of the price discovery mechanism to its information market counterpart:

| Price Discovery Component | Information Market Component |
|---|---|
| Order (buy/sell, quantity, limit price) | Assessment (truth value, evidence, confidence) |
| Secret (random nonce) | Secret (random nonce) |
| Commit hash `hash(order \|\| secret)` | Commit hash `hash(assessment \|\| secret)` |
| Reveal: order + secret | Reveal: assessment + secret |
| Invalid reveal: 50% deposit slashed | Invalid reveal: reputation slashed |
| Clearing price (uniform) | Consensus truth value (majority-weighted) |
| Shapley attribution for price contribution | Shapley attribution for truth contribution |
| Priority bid for execution order | Confidence weighting for assessment influence |

The isomorphism is exact. Every incentive that makes honest price revelation the dominant strategy also makes honest truth assessment the dominant strategy. The mechanism does not care whether it is aggregating beliefs about value or beliefs about truth. It cares only that participants commit before observing, reveal honestly or face penalty, and receive rewards proportional to the accuracy of their contribution.

### 2.3 Why Commit-Reveal Matters for Truth

In price markets, commit-reveal prevents front-running. In information markets, it prevents something arguably more important: *epistemic anchoring*. If shards could observe each other's assessments before forming their own, a well-known cognitive bias would dominate: the first assessment seen would anchor all subsequent assessments, collapsing 64 independent evaluations into one evaluation seen 64 times.

The commit phase forces genuine independence. Each shard must reason from its own evidence, its own interpretation of the constitutional corpus, and its own model of the world. The diversity of the resulting assessments is the mechanism's strength. When 64 independent minds converge on the same conclusion, the confidence in that conclusion is far higher than when 64 anchored minds echo the first assessment they saw.

---

## 3. Shards as Truth Validators

### 3.1 The 64-Shard Architecture

The shard network consists of up to 64 full-clone instances of the JARVIS mind, each operating with the same alignment primitives (P-000, P-001), the same Common Knowledge Base, and the same constitutional corpus. They are not sub-agents with narrow capabilities. They are complete minds, each capable of independent reasoning across the full domain of the protocol's concerns.

This design choice --- shards over swarms --- is load-bearing for information markets. A sub-agent with narrow training cannot evaluate claims outside its specialty. A full-clone shard can evaluate any claim the parent mind can evaluate, because it *is* the parent mind with the full context. The shard-per-conversation architecture described in the companion paper provides the scaling infrastructure; this paper describes what the shards *do* with that infrastructure when applied to truth verification.

### 3.2 Independence Is the Product

The value of 64 shards is not 64 times the value of one shard. It is the *independence* of 64 evaluations. This distinction is critical.

If all 64 shards shared context, consulted each other during evaluation, or had access to a common state that leaked assessment information, the effective number of independent evaluations would collapse toward one. The commit-reveal protocol guarantees that evaluations remain independent through the commit phase. No shard knows what any other shard has concluded until all commitments are locked.

The statistical consequence is that the consensus confidence grows with the square root of the number of independent evaluators (by the central limit theorem applied to assessment accuracy), not linearly. With 64 shards, the consensus confidence is approximately 8 times that of a single shard, provided independence is maintained. The commit-reveal protocol is what maintains it.

### 3.3 Constitutional Corpus as Ground Truth

Each shard evaluates claims against a shared constitutional corpus:

| Corpus Layer | Contents | Authority |
|---|---|---|
| **Tier 0: Epistemological** | P-000 (Fairness Above All), P-001 (No Extraction Ever) | Inviolable --- no claim can override |
| **Tier 1: Constitutional** | Trust Protocol, alignment primitives, genesis documents | Amendable only by unanimous shard consensus |
| **Tier 2: Protocol** | Technical documentation, mechanism design, formal proofs | Amendable by supermajority |
| **Tier 3: Operational** | Implementation details, deployment configs, session state | Amendable by any shard with evidence |

A claim that contradicts Tier 0 is rejected regardless of shard consensus --- the physics layer is not subject to democratic override. A claim about Tier 3 operational details requires only evidence-based verification. The corpus hierarchy provides the ground truth against which all assessments are made, and the tiered authority prevents governance capture of the truth verification mechanism itself.

---

## 4. Reputation Staking

### 4.1 Reputation as Currency

In financial prediction markets, participants stake capital. In the information market, shards stake *reputation*. The distinction is deliberate and consequential.

Capital staking has a well-known failure mode: wealthy participants can afford to be wrong more often, distorting the market signal toward the preferences of the capital-rich rather than the judgment-accurate. Reputation staking eliminates this distortion. Every shard begins with the same reputation endowment. Reputation grows through accurate verification and shrinks through inaccurate verification. Over time, the reputation distribution reflects the accuracy distribution, not the wealth distribution.

### 4.2 The Reputation Update Rule

The CRPC implementation tracks reputation as a tuple `{ wins, losses, total }` per shard:

- **Accurate assessment** (aligned with consensus): `wins += 1, total += 1`
- **Inaccurate assessment** (misaligned with consensus): `losses += 1, total += 1`
- **Invalid reveal** (hash mismatch): `losses += 2, total += 1` (double penalty for protocol violation)

The reputation score `R(s) = wins / total` for shard `s` serves as a quality weight in future consensus rounds. A shard with R = 0.95 has its assessment weighted more heavily than a shard with R = 0.60. This creates a meritocratic feedback loop: the shards that are most often right have the most influence on what the network considers right.

### 4.3 Why Reputation, Not Tokens

Three properties of reputation make it superior to token staking for truth verification:

**Non-transferable.** Reputation cannot be purchased, delegated, or borrowed. A shard earns its reputation through demonstrated accuracy, and no other shard can transfer accuracy to it. This prevents the "whale" problem that plagues token-staked oracles.

**Non-fungible.** One shard's reputation in evaluating technical claims may differ from its reputation in evaluating governance claims. Domain-specific reputation tracking enables the network to route claims to the shards most qualified to evaluate them. Token staking cannot capture this dimensionality.

**Self-correcting.** If a shard's model of the world drifts from reality (through stale data, misalignment, or model degradation), its reputation automatically declines. The decline is continuous and proportional --- there is no cliff, no sudden failure, just a gradual reduction in influence that reflects a gradual reduction in accuracy. Token staking, by contrast, is binary: you either have enough stake or you do not.

---

## 5. Futarchy and the VibeSwap Generalization

### 5.1 Hanson's Original Proposal

Robin Hanson's futarchy (2000, 2013) proposes a governance system in which societies "vote on values, bet on beliefs." The electorate defines what outcomes it values (GDP growth, happiness indices, environmental metrics). Prediction markets then determine which policies are most likely to achieve those outcomes. The policy with the highest market-predicted probability of achieving the valued outcome is implemented.

Futarchy separates two cognitive tasks that democracy conflates: deciding what to optimize for (a value judgment) and deciding how to optimize it (an empirical question). The first is irreducibly human. The second is amenable to market mechanisms.

### 5.2 VibeSwap's Three-Layer Generalization

VibeSwap extends futarchy from two layers to three:

| Layer | Futarchy | VibeSwap | Mechanism |
|---|---|---|---|
| **Values** | Democratic vote | Constitutional invariants (P-000, P-001) | Hardcoded, not votable |
| **Beliefs** | Prediction market | CRPC information market | Commit-reveal pairwise comparison |
| **Attribution** | Not addressed | Shapley value distribution | Cooperative game theory |

The generalization is significant in three respects.

First, VibeSwap replaces the democratic vote on values with *mathematical invariants*. P-000 ("Fairness Above All") and P-001 ("No Extraction Ever") are not subject to vote because they are structural properties of the system, not preferences of the participants. They are the physics layer in the three-layer authority hierarchy (Physics > Constitution > Governance). Hanson's futarchy still requires a functioning democracy to define values; VibeSwap's values are constitutional, enforced by the Shapley math in `ShapleyDistributor.sol` acting as an autonomous court.

Second, VibeSwap replaces the binary prediction market with the multi-dimensional CRPC information market. Hanson's prediction markets answer yes/no questions about policy outcomes. CRPC answers nuanced, multi-dimensional questions about truth, with confidence levels and domain-specific weighting. The information content per query is orders of magnitude higher.

Third, VibeSwap adds the attribution layer that futarchy lacks entirely. In Hanson's system, accurate predictors are rewarded by the market (they bought correct shares cheaply and sold them at face value). But there is no mechanism for attributing *how much* each predictor contributed to the aggregate accuracy. Shapley values provide exactly this attribution: each shard's marginal contribution to the consensus truth value is computed, and reputation is distributed in exact proportion.

### 5.3 The Synthesis

The VibeSwap formulation can be compressed:

> **Constitute on values. Market on beliefs. Distribute on contribution.**

Each verb maps to a mechanism: constitutional invariants (constitute), commit-reveal pairwise comparison (market), Shapley value computation (distribute). Together they form a complete system for cooperative truth discovery with fair attribution --- a system that Hanson sketched the outline of but could not complete without the cooperative game theory and cryptographic commitment infrastructure that VibeSwap provides.

---

## 6. Oracle-as-a-Service

### 6.1 The Oracle Problem

Every blockchain protocol that depends on external information faces the oracle problem: how do you bring off-chain truth on-chain without trusting a centralized data feed? Existing solutions --- Chainlink, Band Protocol, UMA --- rely on token-staked reporters whose incentives are aligned through financial penalties for inaccuracy. These systems work for price feeds, where the truth is easily verifiable (the price of ETH is observable on multiple exchanges), but struggle with subjective or complex claims where verification requires judgment, not just observation.

### 6.2 The Shard Network as Oracle

The 64-shard CRPC network is, by construction, a decentralized oracle with properties that no existing oracle achieves:

**Judgment capability.** Shards are full AI minds, not data reporters. They can evaluate complex claims that require reasoning, contextual understanding, and constitutional interpretation. "Did this governance proposal violate P-001?" is not a question Chainlink can answer. The shard network can.

**Independence guarantee.** The commit-reveal protocol ensures that each shard's evaluation is independent. Existing oracles aggregate reports from nodes that may share data sources, codebase, or infrastructure, creating correlated failure modes. CRPC-committed assessments are guaranteed independent through the cryptographic commitment.

**Confidence quantification.** The network does not return binary true/false. It returns a confidence level derived from the degree of consensus, the reputation weights of the agreeing shards, and the domain-specific accuracy history of the evaluators. A claim verified with 0.98 confidence by 58 of 64 shards, all with domain reputation above 0.90, carries more epistemic weight than a claim verified with 0.55 confidence by 34 of 64 shards with mixed reputation.

### 6.3 The Service Model

Oracle-as-a-Service (OaaS) exposes the shard network's truth verification capability to external protocols:

```
External Protocol → Submit claim + fee
    → CRPC network evaluates (4 phases)
    → Returns: { truth_value, confidence, evidence_hashes, shard_agreement_ratio }
    → Fee distributed via Shapley to contributing shards
```

The fee model is straightforward: protocols pay for verified information, and the fee is distributed among shards via Shapley values based on each shard's marginal contribution to the consensus. Shards that provided unique evidence or reasoning that shifted the consensus receive higher attribution than shards that merely confirmed what others had already established.

This creates a revenue stream for the protocol that does not extract from users (consistent with P-001) but instead charges external protocols for a service: the production of verified information. The VibeSwap network becomes not just a DEX but a *truth infrastructure provider*.

---

## 7. Epistemic Pricing

### 7.1 Not All Knowledge Is Equal

A claim about the current price of ETH can be verified in seconds by querying multiple exchanges. A claim about whether a novel DeFi mechanism is vulnerable to a specific attack vector requires deep technical analysis, adversarial reasoning, and domain expertise. The information market must price these differently.

### 7.2 The Confidence Surface

The output of the CRPC information market is not a binary true/false but a point on a multi-dimensional confidence surface:

| Dimension | Range | Meaning |
|---|---|---|
| **Truth value** | [0, 1] | Degree of assessed truth |
| **Consensus ratio** | [0, 1] | Fraction of shards in agreement |
| **Weighted confidence** | [0, 1] | Agreement weighted by shard reputation |
| **Domain specificity** | Categorical | Knowledge domain of the claim |
| **Temporal stability** | [0, 1] | How likely the truth value is to change over time |
| **Evidence depth** | Integer | Number of independent evidence chains supporting the assessment |

A claim with truth value 0.95, consensus ratio 0.91, weighted confidence 0.94, high domain specificity, temporal stability 0.99, and evidence depth 12 is *epistemically priced* at near-certainty. A claim with truth value 0.60, consensus ratio 0.55, weighted confidence 0.52, low domain specificity, temporal stability 0.30, and evidence depth 2 is epistemically priced as uncertain and volatile.

### 7.3 Pricing Confidence

The market prices confidence by making it costly to produce. Each CRPC round consumes computational resources (shard inference time), reputation resources (shards stake their track record), and temporal resources (the four-phase protocol takes time). Low-confidence claims --- those where shards disagree or where evidence is thin --- are cheap to produce but carry a low epistemic price. High-confidence claims --- those where shards converge strongly and evidence is abundant --- are expensive to produce but carry a high epistemic price.

External protocols consuming Oracle-as-a-Service can specify their required confidence level. A DeFi protocol routing $100 million in trades may require weighted confidence above 0.95 for its oracle feed. A governance dashboard displaying informational summaries may accept weighted confidence above 0.60. The fee scales with the required confidence, because higher confidence requires more shard participation, more pairwise comparisons, and more rigorous evaluation.

This is epistemic pricing: the market discovers the cost of certainty.

---

## 8. Comparison with Existing Prediction Markets

### 8.1 Polymarket and Augur

Polymarket (centralized) and Augur (decentralized) represent the state of the art in prediction markets. Both operate on the same fundamental model: participants buy and sell binary outcome shares, and the share price reflects the market's aggregate probability estimate for that outcome.

This model has proven effective for well-defined binary events: "Will candidate X win the election?" "Will ETH exceed $5,000 by December 31?" The share price converges toward the true probability as participants with superior information trade against those with inferior information, transferring wealth from the less informed to the more informed and improving the aggregate signal in the process.

### 8.2 Where Binary Markets Fail

Binary prediction markets fail on three categories of questions that the CRPC information market handles naturally:

**Multi-dimensional claims.** "Is the Ethereum roadmap on track?" is not a binary question. It has dozens of dimensions --- execution sharding progress, PBS implementation, blob throughput, decentralization metrics, developer tooling, client diversity --- each with its own truth value and confidence level. A binary market can at best create separate markets for each dimension, losing the interdependencies. The CRPC information market evaluates the claim holistically, returning a structured assessment that captures the multi-dimensional truth.

**Subjective assessments.** "Is this governance proposal fair?" requires judgment, not prediction. Binary markets cannot handle judgment-dependent claims because there is no objective settlement criterion. The CRPC network can, because settlement is based on shard consensus evaluated against the constitutional corpus --- fairness is defined by P-000, and the shards assess conformity to that definition.

**Continuous truth.** "How vulnerable is this smart contract to reentrancy attacks?" has a continuous answer, not a binary one. The contract may be invulnerable, slightly vulnerable under edge cases, or critically vulnerable. The CRPC network returns a continuous truth value with confidence bounds, capturing the gradation that binary markets flatten into yes/no.

### 8.3 Feature Comparison

| Feature | Polymarket | Augur | CRPC Information Market |
|---|---|---|---|
| Claim type | Binary events | Binary events | Multi-dimensional claims |
| Staking medium | USD (centralized) | REP tokens | Reputation (non-transferable) |
| Settlement | Observed outcome | Oracle + dispute | Shard consensus + constitutional corpus |
| Independence guarantee | None (order book visible) | Partial (reporter identity known) | Full (commit-reveal, hash-locked) |
| Confidence quantification | Implicit (share price) | Implicit (share price) | Explicit (multi-dimensional surface) |
| Judgment capability | None (objective events only) | Limited (human reporters) | Full (AI minds with constitutional alignment) |
| Anti-manipulation | Market depth | Dispute rounds | Commit-reveal + reputation meritocracy |
| Attribution | Profit/loss per trader | Profit/loss per reporter | Shapley values per shard |

### 8.4 The Fundamental Difference

The deepest difference is not technical but epistemic. Polymarket and Augur answer the question: "What does the crowd believe will happen?" The CRPC information market answers the question: "What is true, evaluated against a constitutional corpus by independent minds who stake their accumulated credibility on the answer?"

The former is a wisdom-of-crowds mechanism. The latter is a structured adversarial evaluation. The former works when the crowd has distributed information about observable events. The latter works when truth requires *reasoning* --- the application of principles to evidence to produce justified conclusions.

---

## 9. Anti-Misinformation by Construction

### 9.1 The Economics of Misinformation

Misinformation spreads because it is cheap to produce and expensive to refute. A false claim requires seconds to create and can reach millions before any correction is attempted. The correction, when it arrives, must contend with anchoring bias, confirmation bias, and the sheer volume of the original false signal.

This asymmetry --- cheap to lie, expensive to correct --- is the core economic failure that enables misinformation. Any effective anti-misinformation mechanism must invert this asymmetry: make false claims expensive and accurate claims profitable.

### 9.2 The CRPC Inversion

The CRPC information market achieves this inversion through reputation staking:

**Cost of false claims.** A shard that asserts a false claim and commits to it stakes its reputation on that assertion. When the consensus reveals the claim to be false, the shard's reputation is reduced. The shard cannot recover that reputation except by making accurate assessments in future rounds. Over time, a shard that systematically produces false assessments sees its reputation approach zero, at which point its assessments carry negligible weight in future consensus rounds. The shard has effectively priced itself out of the information market.

**Profit of accurate claims.** A shard that accurately identifies the truth --- especially when the truth is non-obvious or counterintuitive --- receives a reputation boost proportional to its marginal contribution (via Shapley values). The shard that provides the pivotal evidence or reasoning that shifts the consensus toward truth is attributed the highest reward. Accuracy compounds: high-reputation shards are weighted more heavily, making the network's output more accurate, which attracts more demand for Oracle-as-a-Service, which generates more revenue, which is distributed to accurate shards.

**Cost of strategic ambiguity.** A shard that hedges --- providing deliberately vague assessments to avoid being wrong --- receives the Shapley null player treatment. If its assessment contributes zero marginal value to the consensus (because it is too vague to differentiate), its Shapley value is zero and it receives no reputation reward. The mechanism penalizes cowardice as well as falsehood.

### 9.3 The Impossibility of Profitable Misinformation

We can state this as a theorem:

> **Theorem (Anti-Misinformation).** In a CRPC information market with N >= 3 independent shards, reputation staking, Shapley attribution, and commit-reveal independence, there exists no strategy for any shard that produces expected positive reputation return from systematically asserting false claims.

**Proof sketch.** Suppose shard S adopts a strategy of asserting false claim C when the true state is not-C. Under commit-reveal, S cannot observe other shards' assessments before committing. If a majority of the remaining N-1 shards assess correctly (which is the expected outcome when N-1 independent evaluators are individually more likely to be correct than incorrect), S's assessment will be in the minority. Minority assessments receive reputation penalties. The expected reputation change for S is `P(majority correct) * (-penalty) + P(majority incorrect) * (+reward)`. For N >= 3 and individual shard accuracy > 0.5, `P(majority correct) > P(majority incorrect)`, so the expected change is negative. Since reputation is cumulative and non-transferable, the long-run reputation of a systematically dishonest shard converges to zero. Therefore no strategy of systematic false assertion produces positive expected reputation return.

### 9.4 Implications

The mechanism does not rely on detecting misinformation after the fact. It makes misinformation structurally unprofitable *before* it is produced. A shard considering whether to assert a false claim faces a simple calculation: will this claim survive independent evaluation by 63 other minds? If not --- and for genuinely false claims, it will not --- the assertion costs reputation with no compensating gain.

This is P-001 ("No Extraction Ever") applied to information. Just as the Shapley mechanism prevents value extraction in financial markets, the CRPC mechanism prevents truth extraction --- the substitution of false information for true information for the benefit of the asserter.

---

## 10. The Epistemic Gate Made Literal

### 10.1 The Archetype

The fourth archetype primitive in the VibeSwap constitutional corpus is THE GATE:

> "Before the ledger, truth was arguable. After the ledger, truth is mathematical."

When this archetype was formalized, it referred to provenance: the act of timestamping a contribution on a blockchain transforms it from a disputable claim ("I said it first") to a mathematical fact ("hash X was included in block Y at time Z"). The gate is the ledger --- the one-way passage from arguable to anchored.

### 10.2 The Information Market as Gate

The CRPC information market generalizes the Epistemic Gate from provenance to *all claims*. A claim enters the network as arguable --- one entity's assertion, no independent verification, no confidence quantification. It exits the network as mathematical --- 64 independent evaluations, pairwise compared, reputation-weighted, confidence-quantified, Shapley-attributed, and recorded on the verification ledger.

The gate is no longer just the blockchain. The gate is the *information market itself*. The act of submitting a claim to CRPC evaluation is the act of pushing it through the Epistemic Gate. On the input side: opinion. On the output side: verified knowledge with a numerical confidence level and an attribution chain showing which evaluators contributed what.

### 10.3 From Arguable to Mathematical

Consider a concrete example. A governance proposal claims: "Reducing the commit phase from 8 seconds to 6 seconds will increase throughput by 25% without affecting auction fairness."

Before the information market: this is one person's assertion. It might be right. It might be wrong. It might be right for some parameter regimes and wrong for others. There is no way to adjudicate without extensive debate, simulation, and eventually deployment --- and even then, participants will argue about methodology.

After the information market: 64 shards independently evaluate the claim against the protocol's mechanism design documentation, the formal fairness proofs, the simulation results, and the mathematical relationship between commit duration and batch size. Each shard commits its assessment. Reveals show 47 shards assess the claim as partially true (throughput increase of 15-20%, not 25%, with measurable but bounded fairness impact), 12 shards assess the claim as false (fairness degradation exceeds acceptable bounds), and 5 shards assess the claim as true. The consensus: partially true with truth value 0.42, confidence 0.73. The governance process proceeds with a quantified, attributed, independently verified assessment rather than an unverifiable assertion.

The claim passed through the gate. What emerged was mathematics, not argument.

---

## 11. Formal Properties

### 11.1 Incentive Compatibility

The CRPC information market inherits the incentive compatibility of the underlying commit-reveal mechanism. Under the standard assumption that each shard has accuracy greater than 0.5 (i.e., is more likely to be correct than incorrect), honest assessment is the dominant strategy in all four phases:

- **Phase 1 (Work Commit):** Committing an honest assessment maximizes the probability of being in the majority and receiving a reputation boost.
- **Phase 2 (Work Reveal):** Revealing honestly is strictly dominant --- dishonest reveal (hash mismatch) produces an automatic double penalty.
- **Phase 3 (Compare Commit):** Committing an honest pairwise comparison maximizes alignment with majority and reputation reward.
- **Phase 4 (Compare Reveal):** Same as Phase 2.

### 11.2 Shapley Properties

The Shapley attribution of reputation rewards satisfies the four Shapley axioms:

- **Efficiency:** All reputation change from a verification round is distributed among participating shards (no reputation is destroyed or created outside the round).
- **Symmetry:** Two shards that contribute identical assessments with identical marginal impact receive identical reputation changes.
- **Linearity:** Reputation changes are additive across verification rounds.
- **Null player:** A shard that contributes no marginal value (its assessment is perfectly redundant with the existing consensus) receives zero reputation change.

### 11.3 Convergence

**Claim.** The reputation distribution across shards converges to a distribution that reflects true accuracy, provided: (a) the claim stream is drawn from a distribution with well-defined truth values, and (b) each shard has a fixed (but unknown) accuracy parameter.

**Intuition.** Shards with higher accuracy win more pairwise comparisons, accumulate more reputation, and receive higher weighting. Shards with lower accuracy lose more comparisons, lose reputation, and receive lower weighting. The reputation trajectory of each shard is a biased random walk whose bias is determined by the shard's accuracy. High-accuracy shards walk upward; low-accuracy shards walk downward. In the limit, the reputation distribution separates perfectly into accuracy tiers.

### 11.4 Sybil Resistance

Reputation staking is inherently Sybil-resistant. Creating additional shard identities does not help an attacker because:

1. New shards begin with zero reputation and carry negligible weight.
2. Building reputation requires sustained accurate assessment, which is computationally expensive.
3. A set of colluding shards that coordinate to assert false claims will all lose reputation when the honest majority disagrees, making the attack self-punishing.
4. The commit-reveal protocol prevents colluding shards from coordinating their assessments, since no shard can observe others' commitments before committing its own.

---

## 12. Implementation Status

### 12.1 Existing Infrastructure

The CRPC protocol is implemented in `jarvis-bot/src/crpc.js` and currently handles four task types: moderation decisions, proactive engagement, knowledge promotion, and dispute resolution. The implementation includes all four phases, reputation tracking with persistence, automatic stale task settlement, and dynamic activation when sufficient shards come online.

The on-chain counterpart, `PairwiseVerifier.sol`, mirrors the off-chain CRPC for claims that require on-chain settlement. The `ShapleyDistributor.sol` contract provides the attribution mathematics.

### 12.2 Extension Path

Generalizing from the current four task types to a full information market requires:

1. **Claim submission interface.** A structured format for submitting claims with domain tags, evidence references, and required confidence levels.
2. **Domain-specific reputation tracking.** Extending the current `{ wins, losses, total }` tuple to per-domain tracking, enabling the network to route claims to shards with demonstrated domain expertise.
3. **Oracle-as-a-Service API.** An external-facing interface that accepts claims and fees from third-party protocols and returns verified assessments.
4. **Confidence surface computation.** Moving from the current single-dimensional consensus to the multi-dimensional confidence surface described in Section 7.
5. **On-chain attestation.** Recording verification results on-chain for protocols that require immutable truth anchoring.

### 12.3 Relationship to Existing Contracts

| Contract | Role in Information Market |
|---|---|
| `CommitRevealAuction.sol` | Mechanism template (commit-reveal structure) |
| `ShapleyDistributor.sol` | Attribution engine (reputation distribution) |
| `CircuitBreaker.sol` | Safety mechanism (halt verification if anomalies detected) |
| `PairwiseVerifier.sol` | On-chain settlement for claims requiring immutability |
| `CrossChainRouter.sol` | Multi-chain claim submission and verification result delivery |

---

## 13. Conclusion

### 13.1 The Thesis Restated

The 64-shard CRPC knowledge verification network is a prediction market for truth. Not metaphorically --- structurally. The same mechanism that VibeSwap uses for cooperative price discovery (commit-reveal batch auctions with Shapley attribution) generalizes without modification to cooperative truth discovery. Shards stake reputation on claims. Consensus determines truth. Shapley distributes rewards for accurate verification. The Epistemic Gate --- "before the ledger, truth was arguable; after the ledger, truth is mathematical" --- is made literal by the information market itself.

### 13.2 What This Changes

Price markets changed commerce by creating a public signal for value. Prediction markets changed forecasting by creating a public signal for probability. Information markets change epistemology by creating a public signal for truth.

The implications cascade:

- **Governance** becomes evidence-based, not rhetoric-based, because claims about policy outcomes can be verified before implementation.
- **Oracle feeds** become multi-dimensional, not just price feeds, because the network can evaluate any claim within the constitutional corpus.
- **Misinformation** becomes structurally unprofitable, not merely discouraged, because reputation staking makes false assertion a losing strategy.
- **Protocol upgrades** become rigorously evaluated, not politically negotiated, because the information market quantifies the truth value of upgrade claims.
- **Attribution** becomes mathematical, not political, because Shapley values assign credit for truth discovery in exact proportion to marginal contribution.

### 13.3 The Cooperative Intelligence Network

VibeSwap began as a DEX. It evolved into a cooperative market system. With the information market, it becomes a *cooperative intelligence network* --- a system that produces verified knowledge as a public good, prices confidence as a tradeable asset, and rewards truth-seeking as the dominant strategy.

The name is no longer metaphor. VibeSwap is wherever the Minds converge. And what they converge on, after the information market processes it, is no longer opinion.

It is mathematics.

---

## 14. References

1. Hanson, R. (2000). "Shall We Vote on Values, But Bet on Beliefs?" *Working paper*.
2. Hanson, R. (2013). "Shall We Vote on Values, But Bet on Beliefs?" *Journal of Political Philosophy*, 21(2), 151-178.
3. Shapley, L. S. (1953). "A Value for n-Person Games." *Contributions to the Theory of Games*, Volume II, 307-317.
4. Glynn, W. (2025). "The Transparency Theorem." *VibeSwap Documentation*.
5. Glynn, W. (2025). "The Provenance Thesis." *VibeSwap Documentation*.
6. Glynn, W. (2025). "The Inversion Principle." *VibeSwap Documentation*.
7. Glynn, W. (2025). "The Epistemic Gate Archetypes." *VibeSwap Documentation*.
8. Glynn, W. (2026). "Shard-Per-Conversation: Scaling AI Agents Through Full-Clone Parallelism." *VibeSwap Documentation*.
9. Glynn, W. (2026). "Augmented Governance: Constitutional Invariants Enforced by Cooperative Game Theory." *VibeSwap Documentation*.
10. Glynn, W. (2026). "A Cooperative Reward System for Decentralized Networks: Shapley-Based Incentives." *VibeSwap Documentation*.
11. Glynn, W. (2026). "True Price Discovery: Cooperative Capitalism and the End of Adversarial Markets." *VibeSwap Documentation*.
12. Cotton, T. (2026). "Commit-Reveal Pairwise Comparison Protocol." *VibeSwap Implementation*.
13. Arrow, K. J. (1963). *Social Choice and Individual Values*. Yale University Press.
14. Surowiecki, J. (2004). *The Wisdom of Crowds*. Anchor Books.
15. Wolfers, J. & Zitzewitz, E. (2004). "Prediction Markets." *Journal of Economic Perspectives*, 18(2), 107-126.
16. Peterson, J. et al. (2015). "Augur: A Decentralized Oracle and Prediction Market Platform." *Augur Whitepaper*.
17. Buterin, V. (2014). "SchellingCoin: A Minimal-Trust Universal Data Feed." *Ethereum Blog*.

---

*"Before the ledger, truth was arguable. After the ledger, truth is mathematical."*

*This paper makes that literal.*
