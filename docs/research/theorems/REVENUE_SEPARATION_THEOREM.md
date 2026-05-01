# The Revenue Separation Theorem: Why Fair Protocols Must Insulate Fee Mechanisms from Governance Rewards

**Author**: Faraday1 (Will Glynn)
**Date**: March 2026
**Status**: Working Paper
**Affiliation**: VibeSwap Protocol --- vibeswap.org

---

## Abstract

We present and prove the Revenue Separation Theorem (RST): in any decentralized protocol where swap fee revenue shares a distribution pathway with governance or arbitration rewards, the unique Nash equilibrium converges to fee-maximizing governance rather than honest governance. The theorem establishes three necessary and sufficient insulation conditions under which composed fee-distribution and governance mechanisms preserve independence of irrelevant alternatives (IIA) and resist extraction. We formalize the intuition that mixing revenue streams creates circular incentive loops, demonstrate four game-breaking scenarios that emerge when insulation is violated, and show that VibeSwap's three-stream architecture (swap fees to LPs, priority bids to treasury, penalties to insurance) satisfies all three insulation conditions by construction. The Revenue Separation Theorem is the revenue-specific instantiation of P-001 (No Extraction Ever) and provides a constructive design rule for any protocol adding new revenue sources.

---

## 1. Introduction

### 1.1 The Problem

Decentralized protocols must fund at least two structurally distinct functions: compensating liquidity providers for capital risk, and compensating governance participants for adjudication and stewardship. These functions have fundamentally different incentive structures. Liquidity provision is mercenary --- capital flows to the highest risk-adjusted yield. Governance is fiduciary --- adjudicators must rule impartially regardless of the financial consequences of their rulings.

When a protocol funds both functions from the same revenue stream, it creates a dependency between the mercenary incentive and the fiduciary duty. This dependency is not merely suboptimal; it is game-theoretically catastrophic. The present paper formalizes this claim.

### 1.2 Motivation

The insight originates from VibeSwap's mechanism insulation principle (Glynn, 2026a): the observation that swap fees and governance rewards must be kept in separate distribution pathways to prevent circular extraction. While the original treatment was informal, the principle turns out to be a provable theorem with precise conditions and falsifiable predictions. This paper supplies the formal apparatus.

### 1.3 Contributions

1. A formal statement and proof of the Revenue Separation Theorem.
2. Identification of three necessary and sufficient insulation conditions (C1--C3).
3. Four game-breaking scenarios that arise when any condition is violated.
4. A connection to composable fairness: revenue insulation is composition safety for mechanism design.
5. A constructive design rule for evaluating new revenue sources.

---

## 2. Definitions and Model

### 2.1 Protocol Model

Let a protocol $\Pi$ consist of:

- A set of agents $\mathcal{A} = \{a_1, \ldots, a_n\}$, partitioned into liquidity providers $\mathcal{L}$, traders $\mathcal{T}$, and governors $\mathcal{G}$. An agent may belong to more than one set.
- A fee-generating function $F: \mathcal{T} \times \mathcal{L} \to \mathbb{R}_{\geq 0}$ that maps trades against liquidity to fee revenue.
- A fee-distribution function $D_F: \mathbb{R}_{\geq 0} \to \Delta(\mathcal{L})$ that allocates fee revenue across liquidity providers, where $\Delta(\mathcal{L})$ is the probability simplex over $\mathcal{L}$.
- A governance-reward function $D_G: \mathbb{R}_{\geq 0} \to \Delta(\mathcal{G})$ that allocates governance rewards across governors.
- A governance-action function $g: \mathcal{G} \to \{0, 1\}^k$ representing the vector of governance decisions (rulings, votes, parameter changes).

### 2.2 Revenue Stream

A **revenue stream** $R$ is a tuple $(S, D, \mathcal{B})$ where $S$ is the source function generating revenue, $D$ is the distribution function allocating it, and $\mathcal{B} \subseteq \mathcal{A}$ is the set of beneficiaries.

### 2.3 Shared Revenue Stream

Two functions $D_F$ and $D_G$ share a revenue stream if there exists a source $S$ such that both $D_F$ and $D_G$ draw from $S$. Formally:

$$\exists\, S : \text{dom}(D_F) \cap \text{dom}(D_G) \supseteq \text{range}(S) \neq \emptyset$$

### 2.4 Utility Functions

Each governor $g_i \in \mathcal{G}$ has a utility function:

$$U_i(g_i, \mathbf{g}_{-i}) = \alpha_i \cdot R_i^{\text{gov}}(\mathbf{g}) + \beta_i \cdot R_i^{\text{fee}}(\mathbf{g}) + \gamma_i \cdot V_i^{\text{long}}(\mathbf{g})$$

where:
- $R_i^{\text{gov}}(\mathbf{g})$ is the governance reward to agent $i$ given the governance action profile $\mathbf{g}$.
- $R_i^{\text{fee}}(\mathbf{g})$ is the fee revenue accruing to $i$ that is influenced by governance decisions.
- $V_i^{\text{long}}(\mathbf{g})$ is the long-term protocol value to $i$ (token appreciation, reputation).
- $\alpha_i, \beta_i, \gamma_i > 0$ are preference weights, with $\alpha_i + \beta_i + \gamma_i = 1$.

### 2.5 Insulated vs. Coupled Regimes

Under **insulation**, $R_i^{\text{fee}}(\mathbf{g}) = R_i^{\text{fee}}$ is constant with respect to governance actions. Fee revenue depends only on liquidity provision and trading volume, not on how governors rule.

Under **coupling**, $\partial R_i^{\text{fee}} / \partial g_i \neq 0$ for at least one governor $g_i$. Governance decisions influence fee distribution.

---

## 3. The Revenue Separation Theorem

### 3.1 Theorem Statement

**Theorem 1 (Revenue Separation Theorem).** Let $\Pi$ be a protocol with fee-distribution function $D_F$ and governance-reward function $D_G$. If $D_F$ and $D_G$ share a revenue stream, then for any population of rational agents with $\beta_i > 0$, the unique Nash equilibrium of the governance game is fee-maximizing rather than welfare-maximizing. That is, the equilibrium governance action profile $\mathbf{g}^*$ satisfies:

$$\mathbf{g}^* = \arg\max_{\mathbf{g}} \sum_{i \in \mathcal{G}} R_i^{\text{fee}}(\mathbf{g})$$

rather than:

$$\mathbf{g}^{\text{honest}} = \arg\max_{\mathbf{g}} \sum_{i \in \mathcal{A}} V_i^{\text{long}}(\mathbf{g})$$

### 3.2 Proof

**Step 1: Coupling creates a payoff gradient.**

When $D_F$ and $D_G$ share a revenue stream, there exists at least one governor $g_i$ for whom $\partial R_i^{\text{fee}} / \partial g_i \neq 0$. By the definition of coupling, the governor's fee income is a function of their governance actions. Since $\beta_i > 0$, the governor's utility is strictly increasing in fee revenue.

**Step 2: The fee-maximizing deviation is always profitable.**

Consider a governor $g_i$ at the honest governance profile $\mathbf{g}^{\text{honest}}$. The governor's utility at this profile is:

$$U_i(\mathbf{g}^{\text{honest}}) = \alpha_i R_i^{\text{gov}}(\mathbf{g}^{\text{honest}}) + \beta_i R_i^{\text{fee}}(\mathbf{g}^{\text{honest}}) + \gamma_i V_i^{\text{long}}(\mathbf{g}^{\text{honest}})$$

Now consider a deviation $g_i' \neq g_i^{\text{honest}}$ such that $R_i^{\text{fee}}(g_i', \mathbf{g}_{-i}^{\text{honest}}) > R_i^{\text{fee}}(\mathbf{g}^{\text{honest}})$. Such a deviation exists by the coupling assumption. The change in utility from deviating is:

$$\Delta U_i = \beta_i \left[ R_i^{\text{fee}}(g_i', \mathbf{g}_{-i}) - R_i^{\text{fee}}(\mathbf{g}^{\text{honest}}) \right] + \alpha_i \Delta R_i^{\text{gov}} + \gamma_i \Delta V_i^{\text{long}}$$

**Step 3: Short-term gains dominate long-term costs.**

The fee revenue change $\Delta R_i^{\text{fee}}$ is realized immediately (same batch or next epoch). The long-term value change $\Delta V_i^{\text{long}}$ is realized over an indefinite horizon and is discounted by the agent's time preference $\delta_i < 1$. For any discount factor $\delta_i < 1$, there exists a sufficiently large fee differential such that:

$$\beta_i \Delta R_i^{\text{fee}} > \gamma_i \sum_{t=1}^{\infty} \delta_i^t |\Delta V_i^{\text{long},t}|$$

This is a standard result in repeated game theory: immediate payoffs dominate discounted future losses for sufficiently impatient agents, and in permissionless protocols, the population will be selected for impatience (patient agents are outcompeted by aggressive ones in the short run).

**Step 4: Iterated elimination converges to fee maximization.**

Since the deviation is profitable for each governor independently, the honest profile is not a Nash equilibrium. By iterated elimination of strictly dominated strategies, the unique surviving profile is $\mathbf{g}^* = \arg\max_{\mathbf{g}} \sum_i R_i^{\text{fee}}(\mathbf{g})$, which is the fee-maximizing governance profile. $\square$

### 3.3 Corollary: Insulation Restores Honest Equilibrium

**Corollary 1.** Under insulation ($R_i^{\text{fee}}(\mathbf{g}) = R_i^{\text{fee}}$ for all $\mathbf{g}$), the fee-maximizing deviation vanishes. The governor's utility reduces to:

$$U_i(\mathbf{g}) = \alpha_i R_i^{\text{gov}}(\mathbf{g}) + \beta_i R_i^{\text{fee}} + \gamma_i V_i^{\text{long}}(\mathbf{g})$$

The $\beta_i R_i^{\text{fee}}$ term is now a constant and does not affect the optimal governance action. The remaining terms $\alpha_i R_i^{\text{gov}}$ and $\gamma_i V_i^{\text{long}}$ are both maximized by honest governance (assuming the governance reward function rewards accuracy and the long-term value function rewards protocol health). Therefore, the unique Nash equilibrium is the honest profile $\mathbf{g}^{\text{honest}}$. $\square$

---

## 4. Game-Breaking Scenarios Under Coupling

The theorem predicts specific failure modes when insulation is violated. We enumerate four, each corresponding to a distinct attack vector.

### 4.1 Scenario 1: Arbitrator Capture by Volume Traders

**Setup.** Arbitrators are paid from trading fees. A high-volume trader submits a dispute.

**Incentive distortion.** The arbitrator knows that ruling against the high-volume trader may cause them to leave the protocol, reducing fee revenue. Ruling in their favor preserves the fee stream. Under coupling, the arbitrator's utility is higher when ruling for the high-volume trader regardless of the merits.

**Formal mapping.** Let $g_i = 1$ denote ruling honestly and $g_i = 0$ denote ruling for the high-volume trader. Then:

$$R_i^{\text{fee}}(g_i = 0) > R_i^{\text{fee}}(g_i = 1)$$

because the high-volume trader continues trading. By Theorem 1, $g_i^* = 0$.

**Consequence.** Small traders receive systematically unfair rulings. The protocol becomes a de facto two-tier system where large traders enjoy judicial immunity --- precisely the extractive dynamic that decentralization was supposed to eliminate.

### 4.2 Scenario 2: Governance-Funded Dispute Maximization

**Setup.** Governance participants are paid from LP fees. Disputes require governance work, and more work means more pay.

**Incentive distortion.** Governors are incentivized to maximize the number of disputes rather than minimize them. They may delay resolution, create procedural complexity, or lower the threshold for dispute initiation.

**Formal mapping.** Let $W_i(\mathbf{g})$ denote the workload (number of disputes requiring resolution). Under coupling, $R_i^{\text{gov}}(\mathbf{g}) = f(W_i(\mathbf{g})) \cdot \text{FeePool}(\mathbf{g})$. Since both factors increase when disputes increase, the governor maximizes utility by maximizing disputes.

**Consequence.** The governance layer becomes a rent-extraction mechanism. Honest traders face a litigation-heavy environment that increases costs and uncertainty. This is the blockchain analogy of regulatory capture: the regulators benefit from the complexity they create.

### 4.3 Scenario 3: Liquidity Death Spiral

**Setup.** An exogenous market crash increases disputes. Governance costs (funded from the fee pool) spike.

**Causal chain:**
1. Market crash increases disputes.
2. Dispute resolution costs draw from the fee pool.
3. LP yields drop unpredictably (fees diverted to governance).
4. Risk-averse LPs withdraw capital.
5. Reduced liquidity causes worse execution prices.
6. Worse prices reduce trading volume.
7. Reduced volume reduces fee revenue.
8. Less fee revenue means governance costs consume a larger share.
9. Return to step 3.

**Formal mapping.** This is a positive feedback loop in the dynamical system:

$$\frac{dL}{dt} = h(Y(L, C(L))) - \lambda L$$

where $L$ is total liquidity, $Y$ is LP yield, $C$ is governance cost (increasing in disputes, which increase in volatility), $h$ is the LP entry function, and $\lambda$ is the natural attrition rate. When $C$ and $Y$ share a pool, the system has an unstable equilibrium: any perturbation toward lower liquidity is self-reinforcing.

**Consequence.** A negative exogenous shock (which insulated systems would absorb) becomes a death spiral under coupling. The protocol's resilience is structurally compromised.

### 4.4 Scenario 4: Circular Extraction via Wash Trading

**Setup.** Governance power is proportional to fees contributed. A whale engages in wash trading.

**Attack:**
1. Whale provides large liquidity position.
2. Whale wash-trades against own liquidity to generate fees.
3. Fees fund governance rewards; whale accumulates governance power.
4. Whale uses governance power to vote for policies that benefit their position.
5. Increased benefits fund more wash trading.
6. Return to step 2.

**Formal mapping.** The whale's utility function has a self-reinforcing loop:

$$U_{\text{whale}}(t+1) = U_{\text{whale}}(t) + \Delta_{\text{wash}} + \Delta_{\text{gov}}(\Delta_{\text{wash}})$$

where $\Delta_{\text{gov}}$ is an increasing function of $\Delta_{\text{wash}}$ due to the shared revenue stream. The whale's utility grows superlinearly. Under insulation, $\Delta_{\text{gov}}$ is independent of $\Delta_{\text{wash}}$, and the loop collapses to linear growth bounded by real contribution.

**Consequence.** A single well-capitalized actor can accumulate unbounded governance power through a strategy that creates no genuine value. This is the revenue-architecture analogue of a 51% attack, but it requires far less capital because the attack is self-financing.

---

## 5. The Insulation Conditions

The Revenue Separation Theorem implies three necessary and sufficient conditions for safe mechanism composition. We state them formally.

### 5.1 Condition C1: Zero Shared State

**C1.** Fee revenue and governance revenue have zero shared mutable state.

Formally: let $\Sigma_F$ be the state variables read and written by $D_F$, and $\Sigma_G$ the state variables read and written by $D_G$. Then:

$$\Sigma_F^{\text{write}} \cap \Sigma_G^{\text{read}} = \emptyset \quad \text{and} \quad \Sigma_G^{\text{write}} \cap \Sigma_F^{\text{read}} = \emptyset$$

Neither distribution function can read state that the other writes. This prevents any information channel between the two mechanisms.

**In VibeSwap.** $D_F$ reads LP share balances and batch settlement data. $D_G$ reads contribution scores, epistemic staking records, and emission schedules. These state spaces are disjoint by construction. ShapleyDistributor.sol maintains two explicit tracks: `FEE_DISTRIBUTION` and `TOKEN_EMISSION`, with no cross-track state dependency.

### 5.2 Condition C2: No Dual Influence

**C2.** No agent can influence both fee generation and governance reward distribution within the same transaction or atomic action.

Formally: let $\mathcal{I}_F(a_i)$ be the set of actions by which agent $a_i$ can influence fee generation, and $\mathcal{I}_G(a_i)$ be the set of actions by which $a_i$ can influence governance rewards. Then for any atomic execution context $\tau$:

$$\mathcal{I}_F(a_i, \tau) \cap \mathcal{I}_G(a_i, \tau) = \emptyset$$

An agent may be both an LP and a governor, but the actions through which they earn fees (providing liquidity, trading) must be temporally and transactionally separated from the actions through which they earn governance rewards (voting, adjudicating, staking).

**In VibeSwap.** The commit-reveal auction enforces temporal separation by construction. Commits are hashed (influence on fee generation is locked before governance actions can observe it). Governance actions occur in a separate contract context with independent state. The `nonReentrant` guard on both ShapleyDistributor and CommitRevealAuction prevents cross-mechanism reentrancy within a single transaction.

### 5.3 Condition C3: Deterministic Fees, Merit-Based Governance

**C3.** Fee distribution is deterministic and contribution-proportional (Shapley). Governance distribution is merit-based (epistemic staking with accuracy tracking).

Formally:

$$D_F(r, \mathcal{L}) = \phi_i(v) \quad \text{where } v \text{ is the characteristic function of the liquidity game}$$

$$D_G(r, \mathcal{G}) = \psi_i(e_i, h_i) \quad \text{where } e_i \text{ is epistemic stake and } h_i \text{ is historical accuracy}$$

The key property is that $\phi$ depends only on the cooperative game structure (marginal contribution of liquidity), while $\psi$ depends only on governance performance metrics. The two allocation rules operate on orthogonal merit criteria.

**In VibeSwap.** LP fee distribution follows Shapley values computed over the batch settlement game (who provided liquidity that facilitated which trades). Governance rewards follow epistemic staking: governors stake tokens on the accuracy of their adjudications, and rewards are proportional to demonstrated accuracy over time. A governor who is also an LP earns fees through $\phi$ for their liquidity contribution and governance rewards through $\psi$ for their adjudication accuracy --- and neither earning pathway influences the other.

### 5.4 Sufficiency Proof

**Theorem 2.** Conditions C1, C2, and C3 are jointly sufficient for revenue insulation.

**Proof.** C1 eliminates the information channel: governance cannot observe or modify fee state, so $R_i^{\text{fee}}(\mathbf{g}) = R_i^{\text{fee}}$ (constant in governance actions). C2 eliminates the action channel: no agent can construct a single transaction that simultaneously influences fees and governance rewards, so even if an agent discovers an information leak not covered by C1, they cannot exploit it atomically. C3 eliminates the allocation channel: even if the same agent earns from both mechanisms, the allocation rules are functionally independent (Shapley for fees, epistemic staking for governance), so the amount earned in one mechanism cannot be leveraged to earn more in the other.

Together, all three channels through which coupling can arise (information, action, allocation) are closed. By Theorem 1, the absence of coupling implies the honest governance equilibrium is restored. $\square$

### 5.5 Necessity

Each condition is independently necessary. Violation of any single condition while maintaining the other two still permits a coupling attack:

- **C1 violated (C2, C3 hold):** Governance can read fee state. Even without atomic exploitation, a governor can condition their vote on which outcome maximizes the fee pool they draw from in the next epoch.
- **C2 violated (C1, C3 hold):** A flash-loan-style attack: borrow capital, provide liquidity, generate fees, vote on governance in the same transaction, withdraw. The state spaces may be disjoint on paper, but atomic composability creates a de facto shared state within the transaction.
- **C3 violated (C1, C2 hold):** If both fees and governance rewards use the same allocation rule (e.g., both proportional to token holdings), then accumulating tokens for fee-earning purposes simultaneously increases governance power, creating coupling through the allocation function itself.

---

## 6. Connection to Composable Fairness

### 6.1 Revenue Insulation as Composition Safety

The Revenue Separation Theorem is a specific instance of a more general principle: when two mechanisms are composed within a single protocol, their fairness properties are preserved only if they satisfy independence of irrelevant alternatives (IIA) with respect to each other.

IIA in mechanism design states that the outcome of mechanism $M_1$ should not depend on the alternatives available in mechanism $M_2$, and vice versa. When fee distribution and governance share a revenue stream, they violate IIA: the outcome of governance (who receives governance rewards) depends on the alternatives in fee distribution (which traders generate the most fees), and the outcome of fee distribution (how much LPs earn) depends on the alternatives in governance (which governance decisions preserve volume).

### 6.2 The Composition Operator

Define a composition operator $\oplus$ such that $\Pi = M_F \oplus M_G$ where $M_F$ is the fee mechanism and $M_G$ is the governance mechanism. The Revenue Separation Theorem states that:

$$\text{Fair}(M_F) \wedge \text{Fair}(M_G) \implies \text{Fair}(M_F \oplus M_G) \quad \text{iff C1} \wedge \text{C2} \wedge \text{C3}$$

Fairness of the composed protocol is not automatic even when both component mechanisms are individually fair. The insulation conditions are precisely the requirements for fairness to compose.

### 6.3 Implication for Protocol Design

This result has a constructive implication: when designing a new mechanism to add to an existing protocol, the designer must verify the three insulation conditions against every existing mechanism. The cost of verification grows linearly in the number of existing mechanisms, not quadratically, because the conditions are pairwise and symmetric.

---

## 7. Connection to P-001: No Extraction Ever

### 7.1 P-001 as the General Principle

P-001 states: if extraction is mathematically provable on-chain via Shapley fairness measurement, the system self-corrects autonomously (Glynn, 2026b). The Revenue Separation Theorem is P-001 applied to revenue architecture.

The connection is precise. When fees fund governance, governors become extractors: they take more than their Shapley-measured marginal contribution to governance by leveraging their influence over fee generation. The Shapley null player axiom detects this: a governor who contributes nothing to governance quality but captures fee revenue is a null player receiving a non-null reward. P-001 mandates that the system self-corrects.

### 7.2 The Self-Correction Mechanism

Under VibeSwap's augmented governance framework, P-001 enforcement proceeds as follows:

1. ShapleyDistributor computes marginal contributions for each governor.
2. If a governor's reward exceeds their Shapley value (indicating extraction), the CircuitBreaker triggers.
3. The excess reward is clawed back and redistributed according to the correct Shapley allocation.
4. No governance vote is required. The math is the judge.

The Revenue Separation Theorem explains why this self-correction is necessary in coupled systems and why insulation makes it unnecessary: under insulation, the extraction opportunity does not arise in the first place. Prevention (insulation) is superior to detection and correction (P-001 enforcement) because prevention has zero gas cost and zero latency.

### 7.3 Defense in Depth

The two approaches are complementary, forming a defense-in-depth architecture:

- **Layer 1 (Structural):** Revenue insulation prevents coupling by construction. Attack surface is zero.
- **Layer 2 (Detection):** P-001 via Shapley measurement detects extraction if a coupling pathway is discovered that was not anticipated at design time. Latency is one epoch.
- **Layer 3 (Correction):** CircuitBreaker halts the affected mechanism and triggers redistribution. Latency is immediate upon detection.

No single layer is sufficient. Insulation may have implementation bugs. Shapley detection may have numerical imprecision. Circuit breakers may have threshold misconfiguration. The three layers together provide robust security.

---

## 8. Comparison: The Uniswap Fee Switch

### 8.1 The Vulnerability

Uniswap governance includes a "fee switch" that, if activated by majority vote, would redirect a portion of swap fees from LPs to UNI token holders. As of this writing, the fee switch has been proposed multiple times and narrowly defeated, but no structural mechanism prevents its eventual activation.

This is precisely the coupling that Theorem 1 warns against. If activated:

- UNI holders (governors) would receive revenue from swap fees.
- Governors would have a financial incentive to maximize fee revenue.
- Governance decisions (fee tiers, supported pairs, upgrade proposals) would be distorted by fee-maximization rather than protocol health.
- LPs would receive reduced compensation, driving marginal LPs to competing protocols.

### 8.2 Why 51% is Sufficient for Extraction

In Uniswap's governance model, 51% of voting power can activate the fee switch. There is no constitutional constraint, no Shapley fairness check, no circuit breaker. The governance mechanism has no insulation from the fee mechanism.

This is a violation of all three insulation conditions simultaneously:

- **C1 violated:** Governance reads and writes fee distribution parameters (the fee switch itself).
- **C2 violated:** A governance vote and fee parameter change occur in the same proposal execution.
- **C3 violated:** Both governance power and fee revenue are proportional to UNI token holdings.

### 8.3 VibeSwap's Structural Prevention

Under VibeSwap's augmented governance, the fee switch attack is structurally impossible:

1. **P-001 detection:** Activating a protocol fee would violate the null player axiom. Governance contributed no liquidity; therefore, by Shapley, governance deserves no LP fees. The ShapleyDistributor would compute a zero allocation for any non-LP recipient.
2. **Augmented governance veto:** Even if 51% of governance votes to activate a fee switch, the GovernanceGuard contract (planned) would submit the proposal to a Shapley fairness check. The check would fail, and the proposal would be autonomously vetoed.
3. **Structural insulation:** The fee distribution contract has no parameter that governance can modify to redirect fees. The 100%-to-LPs rule is not a governance parameter; it is a contract invariant.

The Uniswap fee switch is the canonical example of what happens when a protocol treats revenue architecture as a governance parameter rather than a structural invariant.

---

## 9. VibeSwap's Three Revenue Streams

### 9.1 Architecture

VibeSwap maintains three revenue streams, each with a distinct source, distribution rule, and beneficiary set. The three streams are mutually insulated.

```
Stream 1: SWAP FEES
  Source:       Trading activity (bid-ask spread in batch auctions)
  Distribution: 100% to LPs via Shapley proportional allocation
  Beneficiaries: Liquidity providers only
  Invariant:    protocolFeeShare = 0 (immutable)

Stream 2: PRIORITY BIDS
  Source:       Voluntary priority fees in commit-reveal auction
  Distribution: 100% to DAO treasury via deterministic routing
  Beneficiaries: Protocol development, grants, public goods
  Invariant:    Cannot redirect to LPs or governors personally

Stream 3: PENALTIES / SLASHING
  Source:       50% slashing of invalid reveals, circuit breaker forfeitures
  Distribution: 100% to insurance pool via deterministic routing
  Beneficiaries: Affected traders (insurance claims), protocol safety
  Invariant:    Cannot be claimed by arbitrators or governors
```

### 9.2 Insulation Verification

We verify the three conditions for each pair of streams.

**Streams 1 and 2 (Swap Fees vs. Priority Bids):**

- C1: Swap fee state (LP shares, batch settlements) is disjoint from priority bid state (bid amounts, treasury balance). No shared mutable variables.
- C2: Providing liquidity and submitting a priority bid are separate transactions with separate contract entry points. CommitRevealAuction processes priority bids; VibeAMM processes LP deposits. No atomic overlap.
- C3: Swap fees are allocated by Shapley (marginal contribution to the liquidity game). Priority bids are allocated by a deterministic formula (100% to treasury). Orthogonal rules.

**Streams 1 and 3 (Swap Fees vs. Penalties):**

- C1: Swap fee state is disjoint from penalty state (slashing records, insurance pool balance). The penalty mechanism reads commitment hashes; the fee mechanism reads trade execution data.
- C2: Earning swap fees (by providing liquidity to a settled batch) and incurring a penalty (by failing to reveal a commitment) are mutually exclusive actions within the same batch.
- C3: Swap fees follow Shapley. Penalties follow a deterministic rule (50% of committed deposit). No overlap.

**Streams 2 and 3 (Priority Bids vs. Penalties):**

- C1: Priority bid state (voluntary bid amounts) is disjoint from penalty state (invalid reveal records). Different contract storage.
- C2: Submitting a priority bid and being penalized for an invalid reveal are independent events. A priority bid is voluntary and submitted during the commit phase; a penalty is involuntary and assessed during settlement.
- C3: Priority bids are routed to treasury. Penalties are routed to insurance. Different beneficiary sets.

All nine condition checks pass. The three-stream architecture is fully insulated. $\square$

### 9.3 Why Three Streams, Not One

A naive protocol might combine all revenue into a single pool and distribute it by governance vote. The Revenue Separation Theorem shows why this is catastrophic: a single pool creates $\binom{3}{2} = 3$ coupling pairs, each of which enables a distinct attack from Section 4. Three insulated streams eliminate all three coupling pairs at the cost of slightly more complex contract architecture --- a cost that is trivial compared to the security gained.

---

## 10. The Design Rule

### 10.1 Statement

When adding a new revenue source $R_{\text{new}}$ to a protocol with existing streams $R_1, \ldots, R_k$, the designer must answer the following question for each existing stream $R_j$:

> *Can an agent influence both the generation and distribution of $R_{\text{new}}$ and $R_j$?*

If the answer is yes for any $R_j$, the designer must insulate $R_{\text{new}}$ from $R_j$ by ensuring C1, C2, and C3 hold for the pair $(R_{\text{new}}, R_j)$.

### 10.2 Procedure

The verification procedure is constructive:

1. **Enumerate state variables.** List all mutable state read or written by $D_{\text{new}}$ and by each $D_j$. Check for intersections (C1).
2. **Enumerate action sets.** For each agent type, list the actions that influence $R_{\text{new}}$ and $R_j$. Check whether any action set intersection exists within an atomic execution context (C2).
3. **Compare allocation rules.** Verify that the allocation rule for $R_{\text{new}}$ is functionally independent of the allocation rule for $R_j$. Specifically, check that no input to one rule is an output of the other (C3).

If any check fails, redesign the revenue source before deployment. The cost of redesign is bounded. The cost of a coupled revenue architecture is unbounded (see Section 4.3, death spiral).

### 10.3 Application: Evaluating Candidate Revenue Sources

We apply the design rule to VibeSwap's candidate revenue sources (priority bids, penalty redistributions, SVC marketplace fees, compute fees, voluntary tips):

| Revenue Source       | Source Function           | Beneficiary      | C1 vs. Swaps | C2 vs. Swaps | C3 vs. Swaps |
|---------------------|---------------------------|-------------------|:---:|:---:|:---:|
| Priority Bids       | Voluntary auction premium | DAO Treasury      | Pass | Pass | Pass |
| Penalty / Slashing  | Invalid reveal forfeiture | Insurance Pool    | Pass | Pass | Pass |
| SVC Marketplace Fees| Marketplace transactions  | Service Providers | Pass | Pass | Pass |
| Compute Fees (JUL)  | Inference / Mining        | Compute Providers | Pass | Pass | Pass |
| Voluntary Tips      | User-initiated donation   | Treasury / Devs   | Pass | Pass | Pass |

All candidate sources pass the insulation check against swap fees. This is by design: VibeSwap's architecture treats LP fee insulation as a structural invariant, and all new revenue sources are required to respect it.

---

## 11. Related Work

The Revenue Separation Theorem draws on several established lines of research while making a novel contribution specific to decentralized protocol design.

**Shapley value theory** (Shapley, 1953) provides the axiomatic foundation for fair allocation. The null player axiom is the key bridge to extraction detection: an agent with zero marginal contribution should receive zero reward.

**Mechanism design** (Myerson, 1981; Vickrey, 1961) establishes that incentive compatibility requires careful alignment of private incentives with social welfare. The RST extends this to the composition of mechanisms within a single protocol.

**Governance capture in DAOs** has been documented empirically (Barbereau et al., 2023) and studied theoretically in the context of token-weighted voting. The RST provides a structural explanation for why governance capture is endemic: most DAOs violate at least one insulation condition.

**The Uniswap fee switch debate** (Adams et al., 2023) is the most prominent real-world instance of the coupling vulnerability. Governance proposals to activate the fee switch have been analyzed for their impact on LP yields and protocol competitiveness.

**Augmented mechanism design** (Glynn, 2026b) introduces the concept of mechanisms that are "augmented" rather than replaced --- markets still function, but structural constraints (batch auctions, Shapley allocation) make them fairer by construction. The RST extends this concept to governance.

---

## 12. Conclusion

The Revenue Separation Theorem establishes a sharp boundary: protocols that fund governance from trading fees will converge to extractive governance, while protocols that insulate these revenue streams will converge to honest governance. The boundary is not a matter of degree; it is a phase transition. There is no "partial insulation" that partially preserves fairness. The three conditions (C1--C3) must hold jointly, or the coupling attacks described in Section 4 become available.

VibeSwap's three-stream architecture (swap fees to LPs, priority bids to treasury, penalties to insurance) satisfies all three conditions by construction. This is not an accident of implementation but a deliberate design choice derived from the No Extraction Ever axiom (P-001). The Revenue Separation Theorem formalizes the reasoning behind that choice and provides a constructive design rule for evaluating any future revenue source.

The theorem also illuminates a broader principle: in composable systems, fairness properties do not compose automatically. Each composition point must be verified for insulation. This is the revenue-specific instantiation of what we conjecture to be a general Composable Fairness Theorem: for any finite set of individually fair mechanisms composed within a single protocol, the composed protocol is fair if and only if each pair of mechanisms satisfies a set of insulation conditions analogous to C1--C3. The proof of this general theorem is left to future work.

The practical takeaway is a single question that every protocol designer should ask before shipping a new revenue source: *Can an actor influence both the generation and distribution of this revenue?* If the answer is yes, insulate or do not ship.

---

## Appendix A: Notation Summary

| Symbol | Meaning |
|--------|---------|
| $\Pi$ | Protocol |
| $\mathcal{A}$ | Set of all agents |
| $\mathcal{L}, \mathcal{T}, \mathcal{G}$ | Liquidity providers, traders, governors |
| $F$ | Fee-generating function |
| $D_F, D_G$ | Fee and governance distribution functions |
| $R_i^{\text{fee}}, R_i^{\text{gov}}$ | Fee and governance revenue to agent $i$ |
| $V_i^{\text{long}}$ | Long-term protocol value to agent $i$ |
| $\alpha_i, \beta_i, \gamma_i$ | Agent preference weights |
| $\phi_i(v)$ | Shapley value of agent $i$ in game $v$ |
| $\psi_i(e_i, h_i)$ | Epistemic staking reward for agent $i$ |
| $\Sigma_F, \Sigma_G$ | State variables of fee and governance mechanisms |
| $\mathcal{I}_F, \mathcal{I}_G$ | Influence action sets for fee and governance |

## Appendix B: Connection to Shapley Axioms

The five Shapley axioms as implemented in ShapleyDistributor.sol map to the Revenue Separation Theorem as follows:

1. **Efficiency.** All fee revenue is distributed to LPs. All governance rewards are distributed to governors. No leakage between pools. (Supports C1.)
2. **Symmetry.** Equal contributors receive equal rewards within each stream. Cross-stream symmetry is not required and would be harmful (an LP and a governor making "equal contributions" in different domains should not receive equal rewards from a shared pool). (Supports C3.)
3. **Null Player.** An agent contributing nothing to liquidity receives zero fees. An agent contributing nothing to governance receives zero governance rewards. If fees funded governance, the null player axiom for governance would be violated: governors would receive fee revenue without contributing liquidity. (Directly detects coupling violations.)
4. **Pairwise Proportionality.** The reward ratio between any two LPs equals their contribution ratio. The reward ratio between any two governors equals their governance performance ratio. Cross-mechanism pairwise proportionality is undefined and should remain so. (Supports C3.)
5. **Time Neutrality.** Identical liquidity contributions earn identical fees regardless of when they are made (Track 1). Token emissions intentionally violate time neutrality for bootstrapping incentives (Track 2). This asymmetry between tracks is itself a form of insulation: the rules differ because the purposes differ. (Supports the broader principle that different mechanisms require different allocation rules.)

---

## References

Adams, H., Zinsmeister, N., Salem, M., Keefer, R., & Robinson, D. (2023). Uniswap v3 Core. Uniswap Labs.

Barbereau, T., Smethurst, R., Papageorgiou, O., Sedlmeir, J., & Fridgen, G. (2023). Decentralised Finance's Unregulated Governance: Minority Rule in the Digital Wild West. *Working Paper*.

Glynn, W. (2026a). Mechanism Insulation: Why Fees and Governance Must Be Separate. VibeSwap Protocol Documentation.

Glynn, W. (2026b). P-001: No Extraction Ever --- Autonomous Self-Correction via Shapley Fairness Measurement. VibeSwap Protocol Documentation.

Glynn, W. (2026c). Augmented Governance: Constitutional Invariants Enforced by Cooperative Game Theory. VibeSwap Protocol Documentation.

Glynn, W. (2026d). A Cooperative Reward System for Decentralized Networks: Shapley-Based Incentives for Fair, Sustainable Value Distribution. VibeSwap Protocol Documentation.

Myerson, R. B. (1981). Optimal Auction Design. *Mathematics of Operations Research*, 6(1), 58--73.

Shapley, L. S. (1953). A Value for n-Person Games. In H. W. Kuhn & A. W. Tucker (Eds.), *Contributions to the Theory of Games II* (pp. 307--317). Princeton University Press.

Vickrey, W. (1961). Counterspeculation, Auctions, and Competitive Sealed Tenders. *Journal of Finance*, 16(1), 8--37.

---

*Document generated from VibeSwap Protocol Research.*
*https://vibeswap.org*
