# Epistemic Staking: Knowledge-Weighted Governance for Decentralized Systems

**"Being right should matter more than being rich."**

Faraday1 (Will Glynn) | March 2026

---

## Abstract

Every decentralized autonomous organization (DAO) that uses token-weighted voting is a plutocracy. One-token-one-vote is one-dollar-one-vote. The result is predictable: governance capture by capital, not competence. We propose **Epistemic Staking**, a governance framework where voting weight is a function of demonstrated accuracy, domain expertise, and contribution history rather than capital staked. Governance participants earn influence by being *right*, not by being *rich*. We define the Epistemic Score, implement evaluation via commit-reveal pairwise comparison (CRPC), prove truth-convergence via Condorcet's Jury Theorem, and show how soulbound epistemic tokens prevent commodification of governance influence. Epistemic Staking operates within VibeSwap's augmented governance hierarchy, where Shapley math enforces constitutional invariants (P-000, P-001) and epistemic weight determines legislative power within those bounds.

---

## Table of Contents

1. [The Plutocracy Problem](#1-the-plutocracy-problem)
2. [Epistemic Staking Defined](#2-epistemic-staking-defined)
3. [The Epistemic Score](#3-the-epistemic-score)
4. [Implementation via Pairwise Comparison](#4-implementation-via-pairwise-comparison)
5. [Soulbound Epistemic Tokens](#5-soulbound-epistemic-tokens)
6. [The Condorcet Connection](#6-the-condorcet-connection)
7. [Connection to Augmented Governance](#7-connection-to-augmented-governance)
8. [Connection to Composable Fairness](#8-connection-to-composable-fairness)
9. [Anti-Gaming Mechanisms](#9-anti-gaming-mechanisms)
10. [Formal Properties](#10-formal-properties)
11. [Implementation Roadmap](#11-implementation-roadmap)
12. [Conclusion](#12-conclusion)

---

## 1. The Plutocracy Problem

### 1.1 One-Token-One-Vote Is One-Dollar-One-Vote

The standard DAO governance model assigns voting power proportional to token holdings:

```
VotingWeight(i) = Balance(i) / TotalSupply
```

This is mathematically identical to shareholder voting in traditional corporations. The framing changed—"decentralized governance" sounds democratic—but the mechanism did not. Those with the most capital have the most voice.

| System | Influence Allocation | Who Governs |
|--------|---------------------|-------------|
| Shareholder voting | Shares held | The wealthy |
| Token-weighted DAO | Tokens held | The wealthy |
| Representative democracy | One person, one vote | The majority |
| **Epistemic Staking** | **Demonstrated knowledge** | **The competent** |

### 1.2 The Empirical Record of Governance Capture

The theoretical concern is not hypothetical. Governance capture has occurred repeatedly and systematically across DeFi:

**Compound (2022)**: A single whale accumulated enough COMP to pass Proposal 117, voting to redirect approximately $25 million in COMP rewards to a protocol they controlled. Token-weighted governance allowed one actor with sufficient capital to override the collective interest of thousands of smaller participants. The "decentralized" governance was, in practice, an auction where the highest bidder wrote the rules.

**Curve Wars (2020-present)**: Convex, Yearn, and others recognized that controlling CRV governance (via veCRV) was more profitable than using Curve as a DEX. The result: governance capture became a *business model*. Protocols compete to accumulate veCRV not to improve Curve but to direct CRV emissions toward their own pools. The governance system designed to align Curve's development with user interests instead became a market for influence, priced in dollars.

**MakerDAO**: Repeated governance attacks attempted to drain the surplus buffer. The protocol's safety margin depended on the assumption that token holders would act in the protocol's long-term interest. Some did not. Some were short-term speculators who would happily drain reserves for immediate profit.

### 1.3 The Structural Flaw

These are not failures of specific implementations. They are the inevitable consequence of a structural flaw:

```
Capital ≠ Competence
Capital ≠ Alignment
Capital ≠ Knowledge

Yet: Governance Weight = f(Capital)

Therefore: Governance Weight ≠ f(Competence, Alignment, Knowledge)
```

A whale who purchased $10M of governance tokens yesterday has more voting power than a developer who has contributed code for three years. A fund that acquired tokens through a leveraged position has more influence than a researcher who identified a critical vulnerability. The person who *understands* the protocol the least can govern it the most, provided they can afford to.

This is not governance. It is plutocracy with extra steps.

### 1.4 Why Delegation Does Not Solve It

Some protocols (Compound, Uniswap, ENS) introduced delegation: token holders can delegate voting power to knowledgeable representatives. This is an improvement in theory but not in structure:

- Delegation is voluntary and revocable—the capital holder retains ultimate control
- Delegates have no structural accountability for outcomes
- Nothing prevents delegation to self or to aligned parties
- The underlying power still derives from capital, not knowledge

Delegation adds a layer of indirection. It does not change the foundation. The question remains: *why should governance power be a function of wealth at all?*

---

## 2. Epistemic Staking Defined

### 2.1 Core Thesis

**Epistemic Staking** replaces capital-weighted governance with knowledge-weighted governance:

```
Traditional:    GovernanceWeight(i) = f(tokens_held(i))
Epistemic:      GovernanceWeight(i) = f(accuracy(i), expertise(i), contribution(i))
```

You do not stake tokens to earn governance influence. You stake *knowledge*—predictions, assessments, proposals—and earn influence when your knowledge proves correct. Being right, consistently, across relevant domains, is the only path to governance power.

### 2.2 The Mechanism in Brief

1. **Claim**: A governance participant makes a verifiable claim (e.g., "Proposal X will increase liquidity by 15% within 30 days")
2. **Stake**: The claim is committed on-chain with their epistemic reputation at risk
3. **Evaluate**: After the outcome is observable, the claim is scored against reality
4. **Update**: The participant's Epistemic Score is updated based on accuracy
5. **Govern**: Voting weight in future decisions is proportional to cumulative Epistemic Score

The governance participant who has been right most often, most consistently, across the most relevant domains, has the most influence. Not the one who bought the most tokens.

### 2.3 What Counts as "Knowledge"

Epistemic Staking does not reward opinion. It rewards *demonstrated accuracy*:

| Rewarded | Not Rewarded |
|----------|-------------|
| Correct predictions about protocol outcomes | Loud opinions with no track record |
| Accurate risk assessments | Confident assertions without evidence |
| Proposals that achieve stated goals | Proposals that sound good but fail |
| Identification of vulnerabilities that prove real | Alarmism without substance |
| Domain expertise validated by outcomes | Self-declared expertise |

The distinction is critical. Epistemic Staking is not a popularity contest or a credential system. It is a *prediction market for governance competence*, settled against reality.

---

## 3. The Epistemic Score

### 3.1 Formal Definition

The Epistemic Score for participant `i` is a composite of five components:

```
ES(i) = w_a · Accuracy(i) + w_e · Expertise(i) + w_c · Contribution(i)
       + w_s · Consistency(i) + w_k · Accountability(i)

where:
  w_a + w_e + w_c + w_s + w_k = 1
  w_a > max(w_e, w_c, w_s, w_k)   (accuracy dominates)
```

Accuracy is weighted highest because it is the hardest to game and the most directly relevant to governance quality. You can fake expertise, inflate contributions, and perform accountability theater. You cannot fake being right about outcomes that have not yet occurred.

### 3.2 Component Definitions

**Accuracy(i) — Prediction Track Record**

```
Accuracy(i) = Σ_t [ α^(T-t) · score(prediction_t, outcome_t) ] / Σ_t [ α^(T-t) ]

where:
  t = time of prediction
  T = current time
  α ∈ (0, 1) = decay factor (recent accuracy weighted more)
  score() ∈ [0, 1] = continuous scoring rule (Brier score or logarithmic)
```

Were your past governance votes aligned with good outcomes? Did the proposals you supported achieve their stated goals? Did the risks you identified materialize? Every governance action becomes a prediction about the future state of the protocol, and every prediction is scored.

**Expertise(i) — Domain Knowledge**

```
Expertise(i, d) = Accuracy(i) | restricted to domain d

Expertise(i) = Σ_d [ relevance(d, proposal) · Expertise(i, d) ]
```

Expertise is not self-declared. It is *domain-specific accuracy*. If your prediction accuracy within DeFi mechanism design is 0.85 but your prediction accuracy within marketing strategy is 0.45, your epistemic weight on mechanism design proposals is high and your epistemic weight on marketing proposals is low. Expertise is what you have proven you know, measured by outcomes.

**Contribution(i) — Shapley-Weighted Protocol Value**

```
Contribution(i) = ShapleyValue(i, protocol_value_function)
```

This component draws directly from VibeSwap's existing ShapleyDistributor. The Shapley value measures each participant's marginal contribution to the protocol's total value. Code contributions, liquidity provision, bug reports, documentation—all measured by their counterfactual impact on protocol health. This is not a subjective assessment. It is the cooperative game theory answer to "how much worse off would the protocol be without participant i?"

**Consistency(i) — Stability of Accuracy**

```
Consistency(i) = 1 - σ(accuracy_window) / μ(accuracy_window)

where:
  σ = standard deviation of accuracy over sliding window
  μ = mean accuracy over sliding window
```

One lucky call does not make an expert. Consistency measures whether accuracy is stable over time or whether it reflects a single high-variance event. A participant who is right 70% of the time, every quarter, for two years has higher consistency than a participant who was right 95% once and 40% three other times. Governance requires reliable judgment, not occasional brilliance.

**Accountability(i) — Reasoning Transparency**

```
Accountability(i) = f(reasoning_provided, reasoning_quality, skin_in_game)
```

Did you explain *why* you voted the way you did? Was the reasoning coherent and falsifiable? Did you stake something meaningful on your position? Accountability is the only subjective component, and it receives the lowest weight. It serves as a tiebreaker and an incentive for governance participants to show their work. Evaluated via CRPC (Section 4).

### 3.3 Score Properties

The Epistemic Score satisfies several desirable properties:

| Property | Guarantee |
|----------|-----------|
| **Bounded** | ES(i) ∈ [0, 1] — normalized, comparable across participants |
| **Monotonic in accuracy** | Higher prediction accuracy always increases ES |
| **Decay-adjusted** | Recent performance weighted more than distant history |
| **Non-transferable** | Computed from on-chain history, not from a token balance |
| **Domain-specific** | Expertise is context-dependent, not universal |
| **Sybil-resistant** | Splitting into multiple identities does not increase total ES |

---

## 4. Implementation via Pairwise Comparison

### 4.1 The Evaluation Problem

Some governance outcomes are objectively measurable: "Did liquidity increase by 15%?" can be verified on-chain. But many governance decisions involve qualitative judgments: Is this proposal well-designed? Is this risk assessment thorough? Is this contribution valuable?

Epistemic Staking requires a robust method for evaluating claims that do not have simple numerical outcomes. We use **Commit-Reveal Pairwise Comparison (CRPC)**.

### 4.2 CRPC for Epistemic Evaluation

The protocol presents evaluators with pairs of governance contributions and asks: "Which of these two is better along dimension D?"

**Dimensions evaluated:**

| Dimension | Question |
|-----------|----------|
| Accuracy | Which prediction proved more correct? |
| Clarity | Which reasoning is more transparent and falsifiable? |
| Usefulness | Which contribution had more impact on protocol health? |
| Novelty | Which identified a risk or opportunity others missed? |

**Process:**

1. **Commit Phase**: Evaluators submit `hash(pairwise_ranking || secret)` for each pair
2. **Reveal Phase**: Rankings revealed, verified against commitments
3. **Aggregation**: Bradley-Terry model computes global ranking from pairwise comparisons

### 4.3 The Bradley-Terry Model

The Bradley-Terry model is a generalization of pairwise comparison that produces a global ranking from local (pairwise) judgments:

```
P(i beats j) = π_i / (π_i + π_j)

where π_i = "strength" parameter for participant i
```

Given a set of pairwise comparisons, maximum likelihood estimation recovers the strength parameters:

```
π_i* = argmax Π_{(i,j) ∈ comparisons} [ π_i / (π_i + π_j) ]^{w_ij}

where w_ij = number of times i was preferred over j
```

**Why Bradley-Terry?**

The Bradley-Terry model has a deep connection to the Shapley value. Both decompose a collective outcome into individual contributions. Shapley asks: "What is player i's marginal contribution to the coalition?" Bradley-Terry asks: "What is the probability that player i's judgment is better than player j's?" Both satisfy axioms of symmetry and efficiency. Bradley-Terry is, in a precise sense, the Shapley value generalized from coalition games to pairwise preference data.

### 4.4 Why Commit-Reveal Is Essential

Without commit-reveal, pairwise evaluation is vulnerable to:

- **Influence signaling**: Evaluators see how high-reputation participants voted and follow them
- **Coordination attacks**: Groups agree in advance to rank each other highly
- **Anchoring bias**: Early votes anchor later votes

Commit-reveal eliminates all three. During the commit phase, no evaluator knows how any other evaluator ranked the pair. The evaluation is independent by construction.

### 4.5 Ordered Reveal

After commitments are finalized, reveals proceed in order of *ascending* epistemic score:

```
Reveal order: ES_lowest → ES_highest
```

This prevents whale-following in the temporal dimension. Even after commitments are revealed, the ordering ensures that lower-influence participants reveal first, preventing post-hoc rationalization by high-influence participants ("I was going to vote that way anyway").

---

## 5. Soulbound Epistemic Tokens

### 5.1 The Non-Transferability Requirement

If epistemic governance weight were transferable, it would immediately be commodified:

```
Transferable epistemic weight → market for governance influence
Market for governance influence → highest bidder controls governance
Highest bidder controls governance → plutocracy (back where we started)
```

The entire point of epistemic staking is that governance influence must be *earned*, not *purchased*. This requires non-transferable representation.

### 5.2 Soulbound Token Design

Epistemic governance weight is represented as a **soulbound token (SBT)** — a non-transferable, non-delegatable on-chain credential:

```
Properties:
  - Non-transferable: transfer() reverts unconditionally
  - Non-delegatable: no approve() or delegation mechanism
  - Dynamic balance: balance = f(ES(i)), updated each epoch
  - Decay-subject: balance decreases if accuracy drops
  - Soul-specific: bound to address + proof-of-personhood
```

### 5.3 What Soulbound Tokens Prevent

| Attack | Transferable Token | Soulbound Token |
|--------|-------------------|-----------------|
| Buy governance power | Purchase tokens on market | Impossible — no market exists |
| Rent governance power | Borrow tokens via DeFi | Impossible — no transfer function |
| Accumulate via capital | Buy more tokens | Impossible — must demonstrate accuracy |
| Sell after vote | Dump tokens post-governance | Impossible — tokens are permanent |
| Flash loan governance | Borrow tokens for one block | Impossible — no transfer mechanism |

### 5.4 The Accountability Loop

Soulbound epistemic tokens create a closed accountability loop:

```
Make predictions → Predictions scored → Score updates ES → ES updates SBT balance
       ↑                                                            │
       └────────────── Higher ES = more governance power ───────────┘
```

There is no exit from this loop except through accuracy. You cannot buy in, sell out, delegate away, or borrow temporarily. Your governance power is your demonstrated competence, updated continuously, decaying if you stop contributing or start being wrong.

---

## 6. The Condorcet Connection

### 6.1 Condorcet's Jury Theorem (1785)

The Marquis de Condorcet proved a remarkable result about majority voting:

> **Theorem (Condorcet, 1785)**: If each voter independently has a probability p > 0.5 of choosing the correct option, then the probability that the majority vote is correct approaches 1 as the number of voters approaches infinity.

Formally:

```
P(majority correct) = Σ_{k=⌈n/2⌉}^{n} C(n,k) · p^k · (1-p)^(n-k)

lim_{n→∞} P(majority correct) = 1    when p > 0.5
```

The converse is equally important: if p < 0.5, the majority is *reliably wrong*, and increasing the number of voters makes things worse, not better.

### 6.2 The Critical Assumption

Condorcet's theorem has a critical assumption: each voter must be independently more likely to be right than wrong (p > 0.5). In standard DAO governance, this assumption is not enforced and frequently violated:

- Token holders may have no understanding of the proposal
- Whales may vote for extraction, not correctness
- Delegated voters may rubber-stamp without analysis
- Sybil accounts may vote strategically, not truthfully

The theorem still holds—it just converges on the wrong answer.

### 6.3 Epistemic Staking Satisfies Condorcet

Epistemic Staking does not merely hope that voters are competent. It *measures* competence and *weights* accordingly:

```
Standard voting:     Each vote counts equally, p unknown
Epistemic voting:    Vote weight ∝ ES(i), where ES(i) is a calibrated estimate of p(i)
```

By weighting votes toward participants with demonstrated accuracy (p > 0.5, verified empirically), Epistemic Staking ensures the Condorcet conditions are satisfied by construction:

```
Weighted majority = Σ_i [ ES(i) · vote(i) ] / Σ_i [ ES(i) ]

Since ES(i) is monotonically increasing in accuracy:
  → High-accuracy voters (p >> 0.5) get high weight
  → Low-accuracy voters (p ≈ 0.5) get low weight
  → Consistently wrong voters (p < 0.5) get negligible weight

Therefore: the effective p of the weighted ensemble exceeds 0.5
Therefore: Condorcet convergence applies
Therefore: governance decisions converge on truth as participation grows
```

### 6.4 The Provable Guarantee

This is not an aspiration. It is a mathematical guarantee:

**Theorem**: Under Epistemic Staking with bounded rationality (average individual accuracy > 0.5), weighted majority voting converges to the correct governance decision with probability approaching 1 as the number of epistemically scored participants increases.

```
Proof sketch:
1. ES(i) ∝ empirical accuracy(i) (by construction of the Epistemic Score)
2. Weighted vote = Σ ES(i) · vote(i) overweights accurate voters
3. Effective ensemble accuracy p_eff > max(p_avg, 0.5)
4. By Condorcet: P(correct) → 1 as n → ∞  ∎
```

No capital-weighted governance system can make this claim. A system where voting power comes from wealth has no mechanism to ensure that wealth correlates with accuracy. Epistemic Staking makes the correlation structural.

---

## 7. Connection to Augmented Governance

### 7.1 The Governance Hierarchy

VibeSwap's governance operates within a strict hierarchy:

```
┌─────────────────────────────────────────────────┐
│  Level 1: PHYSICS (P-001)                       │
│  Shapley invariants, self-correction             │
│  Cannot be overridden by any governance action   │
│                                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │  Level 2: CONSTITUTION (P-000)              │ │
│  │  Fairness Above All                         │ │
│  │  Amendable only when the math agrees        │ │
│  │                                             │ │
│  │  ┌─────────────────────────────────────────┐│ │
│  │  │  Level 3: LEGISLATURE                   ││ │
│  │  │  ← Epistemic Staking operates HERE →    ││ │
│  │  │  DAO proposals, parameter adjustments   ││ │
│  │  │  Free to act within Levels 1 and 2      ││ │
│  │  └─────────────────────────────────────────┘│ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

Epistemic Staking determines *who has influence* within the legislature. Augmented governance (Shapley math as constitutional court) determines *what the legislature can do*. Neither constrains physics.

### 7.2 Why Both Are Necessary

Augmented governance alone prevents extraction but does not ensure competence:

```
Augmented governance without epistemic staking:
  → Extraction-proof but potentially incompetent
  → Bad proposals that don't violate P-001 still pass
  → Whale can still dominate non-extractive decisions
```

Epistemic staking alone ensures competence but does not prevent extraction:

```
Epistemic staking without augmented governance:
  → Competent but potentially extractive
  → A smart actor could design proposals that extract value cleverly
  → High ES does not guarantee alignment with fairness
```

Together:

```
Augmented governance + Epistemic staking:
  → Extraction-proof AND competent
  → Shapley blocks extraction, ES ensures quality
  → The legislature is staffed by experts and bound by the constitution
```

### 7.3 The Constitutional Court Analogy (Extended)

| Concept | Real-World Analogy | VibeSwap Implementation |
|---------|-------------------|------------------------|
| Physics | Laws of nature | P-001: Shapley invariants |
| Constitution | Written constitution | P-000: Fairness Above All |
| Constitutional court | Supreme Court | ShapleyDistributor + CircuitBreaker |
| Legislature | Parliament/Congress | DAO with epistemic-weighted voting |
| Qualification for office | Electoral process | Epistemic Score accumulation |
| Impeachment | Removal for misconduct | ES decay for inaccuracy |

In constitutional democracies, the legislature is powerful but bounded. It can pass any law that does not violate the constitution. The constitutional court reviews laws for compliance. Legislators are elected based on (in theory) competence and alignment.

Epistemic Staking is the meritocratic election mechanism. Augmented governance is the constitutional court. Together, they produce governance that is simultaneously free, bounded, and competent.

---

## 8. Connection to Composable Fairness

### 8.1 Fairness Across Knowledge Types

Not all knowledge is equal for all decisions. A DeFi mechanism designer's judgment on AMM curve parameters should carry more weight than a marketing specialist's. But for a community growth proposal, the reverse is true.

Epistemic Staking is fairness across *knowledge types*:

```
For proposal P in domain D:

  EffectiveWeight(i, P) = ES(i) · DomainRelevance(i, D)

where:
  DomainRelevance(i, D) = Expertise(i, D) / max_j(Expertise(j, D))
```

### 8.2 Domain Taxonomy

| Domain | Example Proposals | Required Expertise |
|--------|------------------|-------------------|
| Mechanism Design | AMM parameters, auction timing, fee structure | Track record on mechanism outcomes |
| Security | Circuit breaker thresholds, oracle parameters | History of identifying real vulnerabilities |
| Economics | Token emission schedule, treasury allocation | Accuracy of economic impact predictions |
| Community | Marketing spend, partnership approval | Track record on growth-related outcomes |
| Technical | Contract upgrades, infrastructure changes | History of code quality assessments |

### 8.3 Why Domain Specificity Prevents Capture

In capital-weighted governance, a whale can dominate *every* domain by purchasing tokens. In epistemic governance, dominating one domain does not grant influence in another:

```
Capital-weighted:
  Whale buys 51% of tokens → controls ALL governance decisions

Epistemic-weighted:
  Expert in DeFi mechanisms → high weight on mechanism proposals ONLY
  Expert in marketing → high weight on marketing proposals ONLY
  No single participant dominates all domains (practically impossible)
```

This is **composable fairness**: the system is fair within each domain and fair across domains, because influence is always proportional to demonstrated competence in the *relevant* domain.

---

## 9. Anti-Gaming Mechanisms

### 9.1 Threat Model

An adversary attempting to manipulate epistemic governance might try:

| Attack | Description |
|--------|-------------|
| Sybil farming | Create many accounts to accumulate ES through volume |
| Influence signaling | Reveal votes to pressure others to follow |
| Reputation washing | Build ES on easy predictions, exploit on hard ones |
| Coalition gaming | Coordinate evaluators to inflate allies' scores |
| Whale-following | Copy high-ES participants' votes |

### 9.2 Commit-Reveal Defense

All governance actions and evaluations use commit-reveal:

```
Commit phase:  Submit hash(vote || secret) — no one sees your vote
Reveal phase:  Reveal vote + secret — verified against commitment
Settlement:    Votes tallied after all reveals complete
```

During the commit phase, no participant knows how any other participant voted. Influence signaling is impossible because there is nothing to signal. Whale-following is impossible because there is no whale to follow.

### 9.3 Ordered Reveal Defense

Reveals proceed in order of ascending epistemic score:

```
Reveal order: ES_1 ≤ ES_2 ≤ ... ≤ ES_n

Lowest-influence participants reveal first.
Highest-influence participants reveal last.
```

Even after the commit phase, this ordering prevents high-ES participants from selectively revealing to influence remaining reveals. By the time a high-ES participant reveals, all lower-ES participants have already committed and revealed—their votes cannot change.

### 9.4 Reputation Decay Defense

Epistemic Scores decay over time:

```
ES(i, t) = ES(i, t-1) · λ + (1-λ) · recent_accuracy(i)

where λ ∈ (0.8, 0.95) = decay parameter
```

This prevents three attacks:

1. **Resting on laurels**: Past accuracy does not guarantee permanent influence. You must continue demonstrating competence.
2. **Reputation washing**: Building easy ES early does not create a permanent buffer. The decay erodes unearned influence.
3. **Dormant accounts**: Inactive participants lose governance weight automatically, preventing accumulation without contribution.

### 9.5 Soulbound Defense

Non-transferable tokens prevent:

1. **Buying influence**: No market for epistemic tokens, no price, no purchase
2. **Selling influence**: No transfer function, no delegation, no proxy voting
3. **Flash loan attacks**: Cannot borrow governance power for one block
4. **Influence markets**: No secondary market can form around a non-transferable asset

### 9.6 Sybil Resistance

Splitting into multiple identities does not increase total epistemic weight:

```
Single identity:   ES(i) computed from full history
Split into i_1, i_2: ES(i_1) + ES(i_2) ≤ ES(i)

Because:
  - Each sub-identity has less history → lower Consistency score
  - Shapley value of fragmented contributions ≤ Shapley value of unified contribution
  - Proof-of-personhood limits identities per real person
```

The Shapley subadditivity property is critical here. Splitting a single contributor into two half-contributors does not preserve the marginal contribution. The whole is worth more than the sum of the parts, which means Sybil splitting is self-defeating.

---

## 10. Formal Properties

### 10.1 Axioms

Epistemic Staking satisfies the following axioms:

**Axiom 1 — Accuracy Dominance**
```
∀ i, j: Accuracy(i) > Accuracy(j) ∧ other_components_equal → ES(i) > ES(j)
```
A more accurate participant always has higher epistemic weight, all else equal.

**Axiom 2 — Non-Purchasability**
```
∀ i: ∂ES(i)/∂capital(i) = 0
```
Capital has zero marginal effect on epistemic score. Governance influence cannot be purchased at any price.

**Axiom 3 — Domain Locality**
```
∀ i, d_1, d_2: Expertise(i, d_1) does not affect EffectiveWeight(i, d_2) for d_1 ≠ d_2
```
Expertise in one domain does not transfer to governance weight in another domain.

**Axiom 4 — Decay Convergence**
```
∀ i: lim_{t→∞} ES(i, t) = recent_accuracy(i) if no new contributions
```
Without ongoing contribution, epistemic score converges to recent accuracy, preventing permanent rents from historical performance.

**Axiom 5 — Sybil Subadditivity**
```
∀ i split into {i_1, ..., i_k}: Σ_j ES(i_j) ≤ ES(i)
```
Fragmenting identity does not increase total governance weight.

**Axiom 6 — Condorcet Compatibility**
```
Given sufficient participants with ES > 0:
  P(weighted majority = correct) > P(unweighted majority = correct)
```
Epistemic weighting always improves collective accuracy relative to unweighted majority.

### 10.2 Impossibility Result

**Theorem (Epistemic Governance Trilemma)**: No governance system can simultaneously satisfy:

1. Capital-based influence (purchasable weight)
2. Sybil resistance (identity cannot be profitably split)
3. Truth convergence (governance decisions approach correctness)

```
Proof sketch:
- (1) + (2): Purchasable weight + Sybil resistance → whale can buy total control
  → Truth convergence fails (whale's preferences override collective accuracy)
- (1) + (3): Purchasable weight + truth convergence → accuracy must dominate
  → But capital can always override accuracy → contradiction
- (2) + (3): Sybil resistance + truth convergence → Epistemic Staking (this paper)
  → Capital has zero governance weight → (1) is violated

Therefore: (1) is incompatible with (2) ∧ (3).
Epistemic Staking achieves (2) ∧ (3) by explicitly abandoning (1).  ∎
```

This is the fundamental tradeoff. You can have governance that is purchasable, or governance that converges on truth, but not both. Every DAO that uses token-weighted voting has implicitly chosen purchasability over truth. Epistemic Staking makes the opposite choice.

---

## 11. Implementation Roadmap

### 11.1 Phase 1 — Outcome Tracking

Deploy on-chain tracking of governance proposal outcomes:

- Record what each proposal predicted/promised
- Measure actual outcomes after implementation
- Build historical accuracy data for all governance participants

This phase requires no mechanism change—only observation infrastructure.

### 11.2 Phase 2 — Epistemic Scoring

Deploy the Epistemic Score computation:

- Accuracy scoring against recorded outcomes
- Domain classification of proposals
- Consistency and accountability evaluation via CRPC
- Integration with existing ShapleyDistributor for contribution component

### 11.3 Phase 3 — Soulbound Tokens

Deploy soulbound epistemic tokens:

- Non-transferable ERC-721 with dynamic metadata
- Balance reflects current ES, updated each epoch
- Integration with governance contracts for weighted voting

### 11.4 Phase 4 — Full Epistemic Governance

Replace token-weighted voting with epistemic-weighted voting:

- GovernanceGuard contract checks proposals against P-001 (augmented governance)
- Voting weight drawn from soulbound epistemic tokens (epistemic staking)
- Domain-specific weighting activated for categorized proposals
- Commit-reveal voting with ordered reveals

---

## 12. Conclusion

### 12.1 The Core Argument

Governance weight should come from demonstrated accuracy and domain knowledge, not capital. This is not a moral argument—it is a mathematical one. Condorcet's theorem proves that knowledge-weighted voting converges on truth. Capital-weighted voting makes no such guarantee. The empirical record of DAO governance capture confirms the theoretical prediction: when influence is purchasable, it is purchased, and the purchaser's interests diverge from the collective's.

### 12.2 What Epistemic Staking Achieves

| Property | Token-Weighted | Epistemic-Weighted |
|----------|---------------|-------------------|
| Influence source | Capital | Demonstrated accuracy |
| Capture resistance | None (purchasable) | Structural (non-transferable) |
| Truth convergence | Not guaranteed | Provable (Condorcet) |
| Domain sensitivity | None (one weight for all) | Full (per-domain expertise) |
| Temporal dynamics | Static (hold tokens = have power) | Dynamic (must maintain accuracy) |
| Sybil resistance | Weak (buy more tokens) | Strong (subadditive fragmentation) |

### 12.3 The Integration

Epistemic Staking does not stand alone. It is one layer in a governance architecture:

- **P-001 (Shapley invariants)**: The physics. Cannot be overridden. Prevents extraction.
- **P-000 (Fairness Above All)**: The constitution. Amendable only when math agrees.
- **Augmented Governance**: The constitutional court. Shapley math vetoes extractive proposals.
- **Epistemic Staking**: The legislature. Knowledge-weighted, domain-specific, truth-convergent.

Each layer serves a different function. Together, they produce governance that is simultaneously fair, competent, and incorruptible—not because participants are virtuous, but because the mechanism makes incompetence and extraction structurally disadvantaged.

### 12.4 The Philosophical Claim

One-token-one-vote was never decentralization. It was the same power structure with different aesthetics. True decentralization requires that no single resource—capital, computation, social influence—can unilaterally control governance outcomes. Epistemic Staking takes the first step: it makes governance influence a function of what you know and what you have proven, not what you own.

Being right should matter more than being rich. Now it does.

---

## References

1. Condorcet, M. de. (1785). *Essai sur l'application de l'analyse a la probabilite des decisions rendues a la pluralite des voix*. Paris.
2. Bradley, R. A., & Terry, M. E. (1952). "Rank analysis of incomplete block designs: I. The method of paired comparisons." *Biometrika*, 39(3/4), 324-345.
3. Shapley, L. S. (1953). "A value for n-person games." In *Contributions to the Theory of Games II*, Annals of Mathematics Studies 28, 307-317.
4. Weyl, E. G., Ohlhaver, P., & Buterin, V. (2022). "Decentralized Society: Finding Web3's Soul." *SSRN*.
5. Glynn, W. (2026). "Cooperative Markets: A Mathematical Foundation." VibeSwap Documentation.
6. Glynn, W. (2026). "Augmented Governance: Constitutional Invariants Enforced by Cooperative Game Theory." VibeSwap Primitives.
7. Glynn, W. (2026). "Intrinsically Incentivized Altruism: Empirical Verification." VibeSwap Documentation.
8. Buterin, V. (2021). "Moving beyond coin voting governance." *vitalik.ca*.

---

*Faraday1 (Will Glynn) — March 2026*
*VibeSwap: Wherever the Minds converge.*
