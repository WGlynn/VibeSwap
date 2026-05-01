# Composable Fairness: A General Theory of Fair Mechanism Composition

## Why Shapley Values Are the Unique Solution to the Composition Problem

**Will Glynn (Faraday1)**

**March 2026**

---

## Abstract

Arrow's Impossibility Theorem (1951) proved that no voting system can simultaneously satisfy a minimal set of fairness criteria when aggregating individual preferences into collective choices. For seventy-five years, this result has cast a shadow over mechanism design: if fairness is impossible for something as simple as voting, how can it hold for complex, composed economic systems?

This paper proves the inverse for mechanism design. We demonstrate that there exists a composition rule --- Shapley value distribution --- that preserves fairness across mechanism composition. Specifically, when two mechanisms each satisfying Intrinsically Incentivized Altruism (IIA) are composed, the resulting mechanism satisfies IIA if and only if the composition respects the five Shapley axioms (Efficiency, Symmetry, Null Player, Pairwise Proportionality, Time Neutrality). We call this result the **Composable Fairness Theorem**.

The theorem resolves a fundamental open question in decentralized finance: under what conditions does fairness compose? DeFi's power derives from composability --- protocols snap together like building blocks. But composability is also DeFi's greatest vulnerability. Flash loans, cross-protocol arbitrage, and governance capture all exploit the gap between local fairness (each protocol is fair in isolation) and global fairness (the composed system is fair). We show that Shapley value distribution closes this gap uniquely. No other composition rule preserves all three IIA conditions (Extractive Strategy Elimination, Uniform Treatment, Value Conservation) across arbitrary mechanism composition.

We formalize the composition operator, prove necessity and sufficiency of the Shapley axioms, demonstrate the theorem's explanatory power by showing exactly why flash loans break fairness and why VibeSwap's architecture resists them, invert Arrow's Impossibility Theorem to derive a Possibility Theorem for coordination, map six dimensions of composable fairness to the VibeSwap research corpus, and present the "Everything App" vision as a mathematical consequence rather than a marketing aspiration.

**Keywords**: mechanism design, composability, Shapley values, cooperative game theory, Arrow's theorem, DeFi, MEV, flash loans, IIA

---

## Table of Contents

1. [Part I: The Composition Problem](#part-i-the-composition-problem)
2. [Part II: Formal Framework](#part-ii-formal-framework)
3. [Part III: The Composition Theorem](#part-iii-the-composition-theorem)
4. [Part IV: Why Flash Loans Break Fairness](#part-iv-why-flash-loans-break-fairness)
5. [Part V: The Arrow Inversion](#part-v-the-arrow-inversion)
6. [Part VI: Six Dimensions of Composable Fairness](#part-vi-six-dimensions-of-composable-fairness)
7. [Part VII: Implementation in VibeSwap](#part-vii-implementation-in-vibeswap)
8. [Part VIII: The Everything App](#part-viii-the-everything-app)
9. [Part IX: Implications](#part-ix-implications)
10. [Part X: Conclusion](#part-x-conclusion)
11. [References](#references)
12. [Appendix A: Formal Notation](#appendix-a-formal-notation)
13. [Appendix B: Proof Details](#appendix-b-proof-details)
14. [Appendix C: VibeSwap Contract Cross-References](#appendix-c-vibeswap-contract-cross-references)

---

## Part I: The Composition Problem

### 1.1 The Promise and Peril of Composability

The defining feature of decentralized finance is composability. Protocols are designed to interoperate: the output of one mechanism becomes the input of another. A user can borrow on Aave, swap on Uniswap, deposit into Yearn, and stake on Lido --- all within a single transaction. This composability is what makes DeFi powerful. It is also what makes DeFi dangerous.

Every major DeFi exploit in the past five years has been a composition attack. Not a bug in a single protocol, but a malicious composition of individually correct protocols:

| Attack | Date | Loss | Composition Exploited |
|--------|------|------|----------------------|
| bZx Flash Loan | Feb 2020 | $350K | Lending + DEX + Oracle |
| Harvest Finance | Oct 2020 | $34M | Flash loan + AMM + Vault |
| Cream Finance | Oct 2021 | $130M | Lending + Flash loan + Price oracle |
| Mango Markets | Oct 2022 | $114M | Perps + Lending + Oracle |
| Euler Finance | Mar 2023 | $197M | Lending + Flash loan + Donate function |

In every case, the individual protocols were functioning correctly. The vulnerability emerged from their composition. This is not a coincidence. It is a structural property of systems that lack a theory of fair composition.

### 1.2 Local Fairness Is Not Enough

Consider two protocols, each of which is fair in isolation:

**Protocol A** (DEX): Implements a batch auction with uniform clearing prices. All participants receive the same execution price for equivalent orders. No front-running is possible because orders are committed before they are revealed. By any reasonable definition, Protocol A is fair.

**Protocol B** (DEX): Also implements a batch auction with uniform clearing prices. Also fair by the same criteria.

Now compose them. An arbitrageur observes that ETH/USDC trades at $3,000 on Protocol A and $3,005 on Protocol B. They buy on A, sell on B, pocket $5 per ETH. This arbitrage is possible even though both protocols are individually fair. The composition creates an extraction opportunity that neither protocol creates alone.

Is this arbitrage harmful? In traditional markets, the answer is nuanced --- arbitrage improves price convergence. But the question reveals a deeper problem: **there is no formal framework for reasoning about whether fairness composes**. We know how to verify that a single mechanism is fair. We do not know how to verify that two fair mechanisms, composed, produce a fair system.

This is the composition problem.

### 1.3 Existing Approaches and Their Failures

The DeFi ecosystem has developed ad hoc defenses against composition attacks:

| Defense | Mechanism | Limitation |
|---------|-----------|------------|
| Reentrancy guards | Block recursive calls | Only prevents same-contract reentry |
| Flash loan detection | Check loan repayment in same tx | Attackers route through intermediary contracts |
| Oracle manipulation checks | TWAP validation | Vulnerable to multi-block manipulation |
| Timelock delays | Force waiting periods | Reduce capital efficiency, do not address composition |
| Access control lists | Whitelist allowed callers | Centralized, fragile, cannot anticipate novel compositions |

None of these address the root cause. They treat symptoms --- specific attack vectors --- without a theory of why composition creates attack vectors in the first place.

### 1.4 The Question

We pose the question formally:

> **The Composition Problem**: Given mechanisms M_1 and M_2, each satisfying a fairness property F, under what conditions does the composed mechanism M_1 compose M_2 also satisfy F?

If the answer is "never" --- if fairness fundamentally does not compose --- then DeFi is structurally broken. Every new protocol integration creates new attack surfaces, and the only defense is eternal vigilance against an ever-expanding set of composition exploits.

If the answer is "always" --- if fairness trivially composes --- then existing exploits would be impossible, which contradicts reality.

The answer, as we will prove, is "conditionally" --- and the condition is precisely the five Shapley axioms.

---

## Part II: Formal Framework

### 2.1 Mechanisms

**Definition 2.1 (Mechanism)**. A mechanism M is a tuple (N, A, O, f) where:
- N = {1, 2, ..., n} is the set of participants
- A = A_1 x A_2 x ... x A_n is the action space (each participant's available strategies)
- O is the outcome space
- f: A -> O is the outcome function mapping action profiles to outcomes

In the context of DeFi, a mechanism typically maps trades (actions) to executed prices and allocations (outcomes).

### 2.2 Intrinsically Incentivized Altruism (IIA)

We adopt the IIA framework from prior work (Glynn, 2026; IIA Empirical Verification, 2026) as our formal definition of fairness.

**Definition 2.2 (IIA)**. A mechanism M satisfies Intrinsically Incentivized Altruism if and only if it satisfies three conditions simultaneously:

**Condition 1 --- Extractive Strategy Elimination (ESE)**: For all strategies s in A, if s is extractive (the agent executing s gains value at another agent's expense), then s is infeasible under M.

Formally:
```
for all s in A: extractive(s) implies not feasible(s, M)
```

Where `extractive(s)` means there exist participants i, j such that executing s transfers value from j to i without j's informed consent, and `feasible(s, M)` means the mechanism permits the execution of s.

**Condition 2 --- Uniform Treatment (UT)**: For all participants i, j in N, the rules governing i are identical to the rules governing j.

Formally:
```
for all i, j in N: rules(i, M) = rules(j, M)
```

No participant has privileged access, preferential execution, or asymmetric information by virtue of their identity, capital, or history. The mechanism treats all participants as interchangeable.

**Condition 3 --- Value Conservation (VC)**: The total value captured by all participants equals the total value created by the mechanism. No value is destroyed by the mechanism itself, and no value is extracted by the mechanism operator.

Formally:
```
sum over i in N of V_i = V_total
```

Where V_i is the value captured by participant i and V_total is the total value created by the mechanism (e.g., gains from trade).

**Remark**. IIA is stronger than individual rationality (every participant weakly prefers participation) and incentive compatibility (truthful reporting is optimal). IIA requires that defection is not merely suboptimal but structurally impossible. The mechanism's architecture eliminates extractive strategies rather than making them costly.

### 2.3 The Composition Operator

**Definition 2.3 (Mechanism Composition)**. Given mechanisms M_1 = (N_1, A_1, O_1, f_1) and M_2 = (N_2, A_2, O_2, f_2), the composition M_1 compose M_2 is a mechanism where the outcomes of M_1 become available as inputs to M_2.

Formally, M_1 compose M_2 = (N_c, A_c, O_c, f_c) where:
- N_c = N_1 union N_2 (participants in either mechanism)
- A_c includes strategies that span both mechanisms (e.g., "buy on M_1 then sell on M_2")
- O_c = O_2 (the final outcome is determined by M_2's resolution)
- f_c = f_2 compose f_1 (outcomes are computed by applying M_1 first, then M_2)

**Key property**: Composition expands the action space. Even if M_1 and M_2 each restrict strategies to non-extractive ones, the composed action space A_c may contain strategies that are extractive in the composed system. This is why local fairness does not guarantee global fairness.

**Definition 2.4 (Composition Boundary)**. The composition boundary B(M_1, M_2) is the interface where outcomes of M_1 become inputs of M_2. Formally, B is the mapping O_1 -> A_2 that translates M_1 outcomes into M_2 actions.

The composition boundary is where fairness violations emerge. M_1 is fair within its action space. M_2 is fair within its action space. But the boundary creates new strategies that exist in neither action space individually.

### 2.4 Global Fairness

**Definition 2.5 (Global Fairness)**. The composed mechanism M_1 compose M_2 satisfies Global IIA if and only if M_1 compose M_2 satisfies all three IIA conditions (ESE, UT, VC) with respect to the expanded participant set N_c and the expanded action space A_c.

### 2.5 The Value Function for Composed Mechanisms

To apply Shapley value theory, we need a characteristic function for the composed mechanism.

**Definition 2.6 (Composed Value Function)**. Given mechanisms M_1 and M_2 with value functions v_1 and v_2 respectively, the composed value function v_c for M_1 compose M_2 is:

```
v_c(S) = v_1(S intersect N_1) + v_2(S intersect N_2) + delta(S, B)
```

Where delta(S, B) is the *composition surplus*: the additional value (positive or negative) created by the interaction of participants in S across the composition boundary B.

When delta = 0 for all S, the composition is *separable* --- the two mechanisms do not interact, and composition trivially preserves fairness. The interesting case is when delta is nonzero.

### 2.6 The Shapley Axioms for Composition

We now state the five Shapley axioms as conditions on the distribution of value in composed mechanisms.

**Axiom S1 (Efficiency)**. All value generated by the composed mechanism is distributed to participants:
```
sum over i in N_c of phi_i(v_c) = v_c(N_c)
```

No value leaks at the composition boundary. No value is retained by the composition itself.

**Axiom S2 (Symmetry)**. If participants i and j make identical contributions to every coalition in the composed mechanism, they receive identical rewards:
```
If v_c(S union {i}) = v_c(S union {j}) for all S subset N_c \ {i,j},
then phi_i(v_c) = phi_j(v_c)
```

This must hold across the composition boundary: a participant in M_1 who contributes identically to a participant in M_2 receives the same reward.

**Axiom S3 (Null Player)**. If participant i contributes nothing to any coalition in the composed mechanism, they receive nothing:
```
If v_c(S union {i}) = v_c(S) for all S subset N_c,
then phi_i(v_c) = 0
```

A participant who adds no value --- including at the composition boundary --- receives no reward. This is the axiom that flash loans violate, as we will demonstrate in Part IV.

**Axiom S4 (Pairwise Proportionality)**. For any two participants i, j, their reward ratio equals their contribution ratio:
```
phi_i(v_c) / phi_j(v_c) = w_i / w_j
```

Where w_i, w_j are their respective weighted contributions (direct, enabling, scarcity, stability). This extends VibeSwap's on-chain `PairwiseFairness` verification to composed mechanisms.

**Axiom S5 (Time Neutrality)**. For fee distribution across composed mechanisms, identical contributions yield identical rewards regardless of when the composition occurs:
```
If contributions(i, compose_t1) = contributions(i, compose_t2),
then phi_i(compose_t1) = phi_i(compose_t2)
```

A participant's reward depends on their contribution, not on whether they participated in the first batch or the hundredth.

---

## Part III: The Composition Theorem

### 3.1 Statement

**Theorem 3.1 (Composable Fairness)**. Let M_1 and M_2 be mechanisms that each satisfy IIA. The composed mechanism M_1 compose M_2 satisfies IIA if and only if the value distribution of M_1 compose M_2 respects Axioms S1--S5 (the five Shapley axioms for composition).

### 3.2 Proof of Sufficiency

We prove: if M_1 and M_2 each satisfy IIA, and the composition respects S1--S5, then M_1 compose M_2 satisfies IIA.

**Extractive Strategy Elimination composes under S1 + S3.**

By S1 (Efficiency), all value generated by the composition is distributed. There is no "hidden" value at the composition boundary available for extraction. By S3 (Null Player), any participant who contributes nothing to the composed game receives nothing. Consider a candidate extractive strategy s_e in the composed action space A_c. For s_e to be extractive, there must exist a participant i who executes s_e and gains value V > 0 at the expense of some participant j.

Case 1: s_e is entirely within M_1 or M_2. Then it is already infeasible by M_1's or M_2's individual IIA property. Contradiction.

Case 2: s_e spans the composition boundary. Then i's gain must come from the composition surplus delta(S, B). By S3, if i's contribution to the composed coalition is zero (i.e., removing i from the coalition does not reduce the value), then phi_i = 0. For i to gain V > 0, i must genuinely contribute V > 0 to some coalition. But if i is contributing genuine value, then i's gain is not extractive --- it is compensation for contribution. Therefore, no participant can gain value without contributing value. Extractive strategies (gain without contribution) are infeasible.

Formally: Suppose for contradiction that s_e is extractive and feasible under Shapley distribution. Then there exists i such that phi_i(v_c) > 0 but v_c(S union {i}) = v_c(S) for all S (i contributes nothing). By S3, phi_i(v_c) = 0. Contradiction. QED for ESE.

**Uniform Treatment composes under S2.**

By S2 (Symmetry), identical contributions yield identical rewards across the entire composed mechanism. If participant i in M_1 and participant j in M_2 contribute identically, they receive identical treatment. No participant is advantaged by which side of the composition boundary they occupy. This extends each mechanism's individual Uniform Treatment to the composed system.

Formally: Take arbitrary i, j in N_c. Suppose rules(i, M_1 compose M_2) != rules(j, M_1 compose M_2). Then there exists a coalition S where i and j make identical contributions but receive different rewards. This violates S2. Contradiction. QED for UT.

**Value Conservation composes under S1 + S4.**

By S1, the total distributed value equals the total generated value. No value is destroyed or created by the composition mechanism itself. By S4 (Pairwise Proportionality), the distribution is proportional to contribution, which means no value is redistributed from contributors to non-contributors. The sum of all participants' rewards equals the total value created by the composed mechanism.

Formally: sum over i in N_c of V_i = sum over i in N_c of phi_i(v_c) = v_c(N_c) (by S1). QED for VC.

Since ESE, UT, and VC all hold for M_1 compose M_2, the composed mechanism satisfies IIA. This completes the sufficiency proof.

### 3.3 Proof of Necessity

We prove: if M_1 compose M_2 satisfies IIA, then the composition must respect S1--S5. We do this by demonstrating that violating any axiom leads to a violation of at least one IIA condition.

**Violation of S1 (Efficiency) breaks Value Conservation.**

If the composition does not distribute all generated value, then sum of V_i < v_c(N_c). The missing value is retained by the composition mechanism (an operator, a protocol, or is simply destroyed). This directly violates VC: total value captured by participants does not equal total value created. Moreover, the undistributed value becomes an extraction target. If it accumulates in a contract, someone will eventually extract it --- either the operator (privileged extraction) or an attacker (composition exploit). Either way, ESE is violated.

*Counterexample*: Consider a cross-chain bridge that charges a 1% fee on transfers. M_1 (DEX on Chain A) satisfies IIA. M_2 (DEX on Chain B) satisfies IIA. The bridge retains 1% of every cross-chain trade. A bridge operator extracts value from all cross-chain participants without contributing to the cooperative game. VC is violated. The composition does not satisfy IIA.

**Violation of S2 (Symmetry) breaks Uniform Treatment.**

If identical contributions can yield different rewards based on which mechanism the participant interacted with, then participants are treated asymmetrically. A liquidity provider contributing $10,000 to M_1 should receive the same Shapley-weighted reward as a provider contributing $10,000 with identical characteristics to M_2. If the composition pays M_1 participants more (or less) for identical work, UT is violated.

*Counterexample*: Consider a composed system where M_1 is a priority-access DEX and M_2 is a public DEX. Both satisfy IIA individually. But the composition gives M_1 participants earlier access to M_2's liquidity. Two participants with identical contributions are treated differently based on which mechanism they entered through. UT is violated.

**Violation of S3 (Null Player) breaks Extractive Strategy Elimination.**

This is the critical case. If a participant who contributes nothing to the composed game can receive a nonzero reward, then extraction is possible. The participant can enter the system, add no value, and capture value from others.

*Counterexample*: Flash loans. See Part IV for the complete analysis.

**Violation of S4 (Pairwise Proportionality) breaks Value Conservation.**

If rewards are not proportional to contributions, then some participants receive more than their marginal contribution and others receive less. The excess captured by over-rewarded participants constitutes extraction from under-rewarded participants. Total value is conserved in aggregate (assuming S1 holds), but the distribution is extractive.

*Counterexample*: A composed system where M_1 pays LPs pro-rata (proportional to capital) while M_2 pays them using Shapley values (proportional to marginal contribution). A whale who deposits into M_1 receives more than their marginal contribution (because pro-rata over-rewards large passive deposits), while a small LP contributing the scarce side of the market in M_2 receives less than their marginal contribution. The composition violates VC at the individual level even if it holds in aggregate.

**Violation of S5 (Time Neutrality) breaks Uniform Treatment.**

If identical contributions in different time periods receive different rewards (for fee distribution games, not token emissions), then participants are treated differently based on when they contributed. Two participants performing identical work are distinguished by a factor --- time --- that is not part of their contribution. UT is violated.

*Counterexample*: A composed system where M_1 offers "early bird" bonuses --- the first participants in each batch receive 2x rewards. A participant contributing in batch 1 receives more than an identical participant contributing in batch 50. UT is violated.

### 3.4 Uniqueness Corollary

**Corollary 3.2 (Shapley Uniqueness for Composition)**. The Shapley value distribution is the *unique* composition rule that preserves IIA.

*Proof sketch*: By Shapley's original uniqueness theorem (1953), the Shapley value is the unique function satisfying Efficiency, Symmetry, Null Player, and Additivity for cooperative games. Our five axioms (S1--S5) extend Shapley's classical four with Pairwise Proportionality and Time Neutrality while replacing Additivity (which follows from our weighted linear model). Since the Shapley value is the unique solution to the classical axioms, and our extended axioms are strictly stronger (they include the classical axioms as special cases), the Shapley value is the unique distribution satisfying S1--S5.

Any other distribution rule violates at least one axiom. By the necessity proof (Section 3.3), violating any axiom breaks IIA. Therefore, the Shapley value is the only composition rule that preserves IIA. QED.

**Remark on significance**. This result parallels Shapley's original uniqueness theorem but operates at a higher level of abstraction. Shapley proved uniqueness for a single cooperative game. We prove uniqueness for the *composition* of cooperative games. The composition level is where DeFi's fairness problems actually live.

---

## Part IV: Why Flash Loans Break Fairness

### 4.1 Flash Loans as Composition Exploits

A flash loan is a zero-collateral loan that must be repaid within the same transaction. The borrower receives arbitrary capital, uses it across multiple protocols, and returns the capital plus a fee --- all atomically. If repayment fails, the entire transaction reverts.

Flash loans are the purest form of composition exploit. They exist *only* because DeFi protocols compose. A flash loan on Protocol A has no purpose unless its proceeds are used on Protocols B, C, D, ... within the same transaction.

### 4.2 The Null Player Violation

Consider the standard flash loan attack:

```
1. Borrow 1M USDC from Protocol A (flash loan, zero collateral)
2. Buy ETH on Protocol B (pushes ETH price up on B)
3. Use inflated ETH price on B to borrow more USDC on Protocol C (price oracle reads B)
4. Repay flash loan on Protocol A
5. Keep profits from over-collateralized borrow on C
```

We analyze this attack through the lens of the Null Player axiom.

**Who are the participants in the composed game?**

- Protocol A participants: depositors who funded the flash loan pool
- Protocol B participants: LPs who provided ETH/USDC liquidity
- Protocol C participants: depositors whose funds were borrowed against inflated collateral
- The attacker: the flash loan borrower

**What does the attacker contribute to each coalition?**

In M_A (lending): The attacker deposits zero collateral. Their contribution is zero. They borrow and repay in the same transaction, providing no duration of capital use to the pool.

In M_B (DEX): The attacker submits a market order that moves the price. Their trade creates no lasting liquidity, no price discovery, no enabling of future trades. Once the transaction completes, the price impact reverts.

In M_C (lending): The attacker deposits inflated collateral. The "value" of this collateral is ephemeral --- it exists only during the transaction.

**Across the composed game**: The attacker's net contribution is zero. They provide no capital (flash loan is repaid), no liquidity (trades revert in impact), and no price discovery (the price manipulation is transient). Yet they extract value.

This is a direct violation of Axiom S3 (Null Player):
```
v_c(S union {attacker}) = v_c(S) for all S
(adding the attacker to any coalition does not increase its value)

Yet the attacker captures V > 0
```

By S3, the attacker should receive nothing. The flash loan composition permits them to receive something. Therefore, the composition does not respect S3, and by the necessity proof, the composed mechanism does not satisfy IIA.

### 4.3 VibeSwap's Structural Defense

VibeSwap prevents flash loan exploitation through two mechanisms that enforce the Null Player axiom at the composition boundary:

**4.3.1 Collateral Lock (Temporal Commitment)**

VibeSwap requires deposits during the 8-second commit phase that cannot be withdrawn until after batch settlement. This creates a temporal gap between deposit and availability:

```solidity
// CommitRevealAuction.sol
function commitOrder(bytes32 commitment) external payable {
    require(msg.value >= minCollateral, "Insufficient collateral");
    // Collateral locked until batch settles
    commitments[msg.sender][currentBatch] = Commitment({
        hash: commitment,
        deposit: msg.value,
        timestamp: block.timestamp,
        revealed: false
    });
}
```

Flash loans require atomic execution: borrow and repay in the same transaction. VibeSwap's commit phase forces a delay between deposit and execution. The flash loan cannot be repaid within the same transaction because the borrowed capital is locked.

**4.3.2 Same-Block Interaction Guard**

VibeSwap explicitly blocks same-block deposits and withdrawals:

```solidity
// VibeAMM.sol
require(block.number > lastInteractionBlock[msg.sender],
    "Same-block interaction forbidden");
```

This prevents any transaction that deposits and withdraws in the same block --- the exact pattern required by flash loans.

**4.3.3 Connection to S3**

These defenses enforce S3 at the architectural level. A flash loan attacker contributes zero capital across blocks (they must repay within one block). The collateral lock forces genuine capital commitment. The same-block guard prevents atomic extraction. Together, they ensure that only participants with genuine marginal contributions (capital locked across time) can participate in the cooperative game.

The result: VibeSwap's composition boundary with any protocol satisfies S3 by construction. Null players cannot extract value because they cannot even enter the game.

### 4.4 Generalization: A Flash Loan Detection Theorem

**Theorem 4.1 (Flash Loan Detection)**. A composition M_1 compose M_2 is vulnerable to flash loan attacks if and only if the composition boundary B allows zero-duration capital commitment --- that is, if a participant can deposit in M_1 and withdraw in M_2 (or vice versa) within a single atomic transaction without leaving capital committed across any time boundary.

*Proof*: (Forward) If zero-duration commitment is possible, construct the flash loan: borrow from M_1, use in M_2, repay to M_1, all atomically. The attacker's capital duration is zero, their contribution is zero, but they can extract value from price impact or oracle manipulation. S3 is violated.

(Backward) If zero-duration commitment is impossible, any participant must commit capital for at least one time unit. During this time, their capital is genuinely at risk (the batch may settle unfavorably, the price may move against them). They are no longer a null player --- they have contributed capital-at-risk to the coalition. Their reward, if any, is compensation for this contribution. QED.

This theorem provides a constructive test for flash loan vulnerability: check whether the composition boundary permits zero-duration commitment. If yes, the composition is vulnerable. If no, it is not.

---

## Part V: The Arrow Inversion

### 5.1 Arrow's Impossibility Theorem (1951)

Kenneth Arrow proved that no voting rule can simultaneously satisfy five conditions:

1. **Unrestricted Domain**: The rule works for all possible preference orderings
2. **Non-Dictatorship**: No single voter's preferences determine the outcome
3. **Pareto Efficiency**: If everyone prefers A to B, the collective ranking prefers A to B
4. **Independence of Irrelevant Alternatives (IIA-Arrow)**: The collective ranking of A vs. B depends only on individual rankings of A vs. B, not on preferences about C
5. **Transitivity**: If the collective prefers A to B and B to C, then A to C

Arrow showed that conditions 1--5 are mutually inconsistent for three or more alternatives. There exists no function from individual preference orderings to a collective preference ordering that satisfies all five simultaneously.

This result has been interpreted --- correctly, within its domain --- as proving that perfect collective decision-making is impossible. Every voting system must sacrifice at least one fairness criterion.

### 5.2 The Domain Distinction

Arrow's theorem applies to **preference aggregation**: the problem of combining subjective preferences (votes) into a collective ranking. The domain is inherently adversarial. Voters have conflicting preferences. A voting rule must adjudicate between incompatible desires.

IIA (our Intrinsically Incentivized Altruism, distinct from Arrow's Independence of Irrelevant Alternatives, though the nomenclature is deliberately resonant) applies to **mechanism design**: the problem of designing architectures where individual incentives align with collective welfare. The domain is cooperative by construction. Defection is structurally impossible.

This is not a semantic distinction. It is the difference between two fundamentally different mathematical structures:

| Property | Arrow (Preference Aggregation) | IIA (Mechanism Design) |
|----------|-------------------------------|----------------------|
| Input | Subjective preference orderings | Objective actions (trades, deposits) |
| Conflict | Inherent (preferences disagree) | Eliminated (defection impossible) |
| Goal | Aggregate preferences fairly | Distribute value fairly |
| Strategy | Agents can misrepresent preferences | Agents cannot extract (ESE) |
| Output | Collective ranking | Value allocation |

### 5.3 Why Arrow Does Not Apply to IIA

Arrow's impossibility proof relies on a critical assumption: **agents can have arbitrary preferences and can act on them**. This is Condition 1 (Unrestricted Domain). In Arrow's framework, there is no mechanism to prevent a voter from expressing any preference ordering they choose.

IIA violates this assumption deliberately and by design. Under IIA:

- The action space is restricted: extractive strategies are infeasible (ESE)
- Agents cannot misrepresent: commit-reveal binds agents to truthful reporting (you commit before you know others' actions)
- The mechanism prevents conflicting actions from producing extractive outcomes

Arrow's theorem says: "If agents can do anything, you can't make everyone happy." IIA responds: "So don't let agents do anything. Restrict the action space to cooperative strategies, and fairness composes."

### 5.4 The Possibility Theorem

**Theorem 5.1 (Composable Fairness Possibility)**. For any N-mechanism coordination system {M_1, M_2, ..., M_N}, if:

(i) Each M_k satisfies IIA (k = 1, 2, ..., N), and

(ii) Every pairwise composition M_i compose M_j respects Axioms S1--S5,

then the global system M_1 compose M_2 compose ... compose M_N satisfies IIA.

*Proof*: By induction on N.

**Base case** (N = 2): This is exactly the Composable Fairness Theorem (Theorem 3.1).

**Inductive step**: Assume the theorem holds for N-1 mechanisms. Consider N mechanisms satisfying conditions (i) and (ii). Let M' = M_1 compose M_2 compose ... compose M_{N-1}. By the inductive hypothesis, M' satisfies IIA. By condition (ii), the composition M' compose M_N respects S1--S5 (because each pairwise composition, including those involving participants from multiple M_k's, respects the axioms). By Theorem 3.1, M' compose M_N satisfies IIA. QED.

**Remark**. The Possibility Theorem is constructive. It does not merely assert that fair composition is possible --- it tells you exactly how to achieve it. Design each mechanism to satisfy IIA. Design each composition to respect Shapley axioms. The global system will be fair.

### 5.5 The Inversion

Arrow proved impossibility for voting. We prove possibility for coordination. The difference is not a contradiction. It is a precise identification of what changes when you move from preference aggregation to mechanism design.

| | Arrow | Composable Fairness |
|-|-------|-------------------|
| Domain | Preference aggregation | Value distribution |
| Agents | Can express any preference | Can only take non-extractive actions |
| Conflict | Irreducible | Eliminated by design |
| Result | Impossibility | Possibility |
| Message | You cannot satisfy everyone when people disagree | You CAN satisfy everyone when defection is impossible |

The philosophical content of the inversion: **Arrow's theorem is not a statement about fairness. It is a statement about the impossibility of fair aggregation when agents can defect.** Remove the ability to defect, and fairness composes.

This is the core insight of IIA, now extended to composition: cooperation is not a moral aspiration that must be enforced through punishment. It is a structural consequence of architecture. Design the mechanism correctly, and cooperation emerges. Design the composition correctly, and cooperation scales.

---

## Part VI: Six Dimensions of Composable Fairness

The Composable Fairness Theorem is abstract. Its power becomes concrete when we map it to the six dimensions along which real systems must compose fairly. Each dimension corresponds to a specific paper in the VibeSwap research corpus, and each paper becomes a special case of the general theorem.

### 6.1 Dimension 1: Across Protocols (Horizontal Composition)

**Reference**: *Graceful Inversion* (Glynn, 2026)

When VibeSwap integrates with an external DEX, lending platform, or liquidity pool, the composition must be horizontal: two mechanisms at the same layer of the stack exchanging value.

The Graceful Inversion paper establishes that integration should be mutualistic, symmetrical, and positive-sum. The Composable Fairness Theorem tells us *why* this works: if both protocols satisfy IIA and the integration respects Shapley axioms, the composed system is fair.

| Principle from Graceful Inversion | Corresponding Shapley Axiom |
|----------------------------------|---------------------------|
| Mutualistic (both sides benefit) | S1 (Efficiency) --- all value distributed, no extraction by the bridge |
| Symmetrical (benefits flow both directions) | S2 (Symmetry) --- identical contributions on either side yield identical rewards |
| Positive-sum (both better off) | S3 (Null Player) --- no participant can free-ride the composition |
| Seamless (no forced migration) | S5 (Time Neutrality) --- when you migrate doesn't affect your reward |

The "vampire attack" --- hostile liquidity extraction via incentive manipulation --- violates S3. The attacker contributes nothing to the composed game (they move liquidity from one protocol to another, a zero-sum transfer) while extracting value (token incentives). A Shapley-compliant composition would assign zero reward to a participant whose net contribution across both protocols is zero.

### 6.2 Dimension 2: Across Domains (Vertical Composition)

**Reference**: *A Constitutional Interoperability Layer for DAOs* (Glynn, 2026)

When a financial mechanism (DEX) composes with a governance mechanism (DAO voting) or a labor mechanism (VibeJobs), the composition is vertical: mechanisms at different layers of the stack, governing different domains, must produce a fair combined outcome.

The Constitutional DAO Layer paper proposes a four-layer architecture: constitutional kernel (Layer 0), governance and identity (Layer 1), value distribution (Layer 2), interoperability (Layer 3). The Composable Fairness Theorem provides the mathematical foundation: each layer satisfies IIA individually, and the vertical composition respects Shapley axioms at every layer boundary.

The constitutional kernel is the enforcement mechanism for S1--S5 across layers. It is the "Shapley court" --- any composition that violates the axioms is vetoed by the kernel.

**Example**: A user's Shapley contribution on VibeSwap (Layer 2) feeds into their governance weight in DAO voting (Layer 1). This vertical composition respects S4 (Pairwise Proportionality) --- governance influence is proportional to marginal contribution, not to capital or tenure. It also respects S3 --- a user who contributes nothing to VibeSwap receives no governance weight from that source.

### 6.3 Dimension 3: Across Time (Temporal Composition)

**Reference**: *Time-Neutral Tokenomics* (Glynn, 2026)

Every protocol composes with itself across time. Today's batch auction composes with tomorrow's. This year's token emission composes with next year's. Temporal composition is the most pervasive form of composition and the most subtle.

The Time-Neutral Tokenomics paper introduces Axiom S5 (Time Neutrality) and proves that Shapley distribution achieves identical rewards for identical contributions regardless of epoch. The Composable Fairness Theorem extends this: temporal composition of fair mechanisms is fair if and only if the composition respects S5.

The distinction between fee distribution games and token emission games is critical:

| Game Type | Time Neutrality | Justification |
|-----------|----------------|---------------|
| Fee distribution (Track 1) | S5 holds strictly | Same work = same pay, regardless of when |
| Token emission (Track 2) | S5 intentionally relaxed | Bitcoin-style halving creates bootstrapping incentives |

The relaxation of S5 for token emissions does not violate the theorem because token emission games are explicitly designed with temporal asymmetry. The participants know the halving schedule in advance. There is no deception, no unfair surprise. The temporal asymmetry is part of the game's definition, not a violation of its fairness properties.

### 6.4 Dimension 4: Across Attacks (Adversarial Composition)

**Reference**: *The IT Meta-Pattern* (Glynn, 2026)

Fair systems must compose not only with other fair systems but with adversaries. An attacker who interacts with VibeSwap is, in a sense, composing their attack strategy with VibeSwap's mechanism. Adversarial composition is the most demanding form.

The IT Meta-Pattern's four behavioral primitives map directly to composable fairness under attack:

| IT Primitive | Fairness Under Attack | Shapley Connection |
|-------------|----------------------|-------------------|
| Adversarial Symbiosis | Attacks generate revenue (priority bids, slashing) | S1: attack-generated value is distributed to honest participants |
| Temporal Collateral | Time commitment binds attackers to outcomes | S3: zero-commitment attackers (flash loans) are null players |
| Epistemic Staking | Knowledge claims are backed by capital at risk | S4: reward proportional to accuracy of contribution |
| Memoryless Fairness | Each batch is a fresh game, history cannot be exploited | S5: temporal composition prevents long-range manipulation |

The key insight: Adversarial Symbiosis (attacks generate value for the system) is a direct consequence of S1 + S3. When an attacker's strategy is neutralized (S3 ensures they extract nothing), but the attack itself generates information or fees (S1 ensures all generated value is distributed), the attack becomes a net positive for honest participants.

This is composable fairness under adversarial conditions: even when one "mechanism" in the composition is a hostile agent, the Shapley axioms ensure that the composition benefits the cooperative players.

### 6.5 Dimension 5: Across Knowledge Types (Epistemic Composition)

**Reference**: *Cognitive Consensus Markets* (Glynn, 2026); CRPC protocol

Different types of knowledge --- price signals, governance decisions, identity attestations, contribution records --- must compose into a coherent system. A price oracle's output feeds into a liquidation engine. A reputation score feeds into governance weight. An identity attestation feeds into access control.

Epistemic composition is the composition of knowledge-producing mechanisms. The Composable Fairness Theorem applies: if each knowledge-producing mechanism satisfies IIA (no one can inject false knowledge for personal gain, all knowledge producers are treated uniformly, all information value is conserved), then the composed knowledge system is fair.

The Epistemic Staking primitive from the IT Meta-Pattern enforces this: agents who stake capital on knowledge claims receive rewards proportional to accuracy (S4) and nothing for zero-accuracy claims (S3).

**Example**: VibeSwap's Kalman filter oracle composes with the commit-reveal auction. The oracle produces price estimates; the auction uses them for clearing price validation. This composition is fair because:
- The oracle's TWAP validation prevents manipulation (ESE)
- All participants see the same oracle price (UT)
- The oracle captures no value for itself (VC, enforced by S1)
- A manipulated oracle reading contributes negative value and is rejected (S3 --- the manipulator is a null player after rejection)

### 6.6 Dimension 6: Across Protocol Versions (Evolutionary Composition)

**Reference**: *Cincinnatus Endgame* (Glynn, 2026); disintermediation grades

The hardest composition problem is evolutionary: how does a protocol compose with its own future versions? Every upgrade, migration, and governance change is a composition of "old protocol" with "new protocol." If this composition is unfair, upgrades become extraction events.

The Cincinnatus Endgame paper describes a disintermediation roadmap: Grade 0 (fully intermediated) to Grade 5 (pure peer-to-peer). Each grade transition is a composition of the current-grade mechanism with the next-grade mechanism. The Composable Fairness Theorem ensures these transitions are fair:

- S1 (Efficiency): No value lost during migration
- S2 (Symmetry): Old-version and new-version participants treated identically
- S3 (Null Player): Migration intermediaries who add no value receive no reward
- S4 (Pairwise Proportionality): Contribution-based rewards are preserved across versions
- S5 (Time Neutrality): The timing of migration does not affect rewards

The Cincinnatus test --- "If Will disappeared tomorrow, does this still work?" --- is a composition question. The protocol must compose fairly with the absence of its creator. By S3, if the creator's ongoing contribution is zero (the protocol runs autonomously), their ongoing reward should be zero. This is the mathematical formalization of walking away.

---

## Part VII: Implementation in VibeSwap

### 7.1 Batch Auction + AMM Composition

VibeSwap's core architecture composes two mechanisms:

**M_1 (CommitRevealAuction)**: Collects orders via commit-reveal, shuffles them using Fisher-Yates with XORed participant secrets, and computes a uniform clearing price.

**M_2 (VibeAMM)**: Maintains a constant-product invariant (x * y = k) that provides liquidity backing for the batch auction and continuous price discovery between batches.

The composition M_1 compose M_2 works as follows:

```
1. Batch auction collects committed orders (M_1 action space)
2. Clearing price is computed considering AMM reserves (M_1 outcome)
3. Matched orders execute against AMM liquidity (composition boundary)
4. AMM reserves update according to constant-product rule (M_2 outcome)
5. Fee distribution via Shapley values (composition reward allocation)
```

**Why this composition satisfies IIA**:

- **ESE**: The commit-reveal mechanism prevents front-running in M_1. The uniform clearing price prevents sandwich attacks at the composition boundary. The same-block interaction guard prevents flash loan attacks on M_2.

- **UT**: All participants submit orders through the same commit-reveal process. All orders execute at the same clearing price. All LPs are rewarded via the same Shapley distribution.

- **VC**: Trading fees (100% to LPs) are distributed via `ShapleyDistributor.sol`. The remainder-to-last-participant pattern ensures zero dust loss. All value is distributed; none is retained by the mechanism.

**Shapley axiom compliance at the composition boundary**:

| Axiom | Enforcement Mechanism |
|-------|---------------------|
| S1 (Efficiency) | `ShapleyDistributor.sol` distributes all `game.totalValue` (remainder-to-last-participant pattern, line 428-429) |
| S2 (Symmetry) | Weighted contribution model: identical inputs -> identical outputs (4-dimensional: direct, enabling, scarcity, stability) |
| S3 (Null Player) | `NoReward` revert for zero-contribution participants; same-block guard blocks flash loans |
| S4 (Pairwise Proportionality) | `PairwiseFairness.verifyPairwiseProportionality`: cross-multiplication check on-chain |
| S5 (Time Neutrality) | Fee distribution games use epoch-independent Shapley computation |

### 7.2 Cross-Chain Composition

VibeSwap operates across multiple chains via LayerZero V2 messaging. Cross-chain swaps compose the batch auction on Chain A with the batch auction on Chain B, bridged by `CrossChainRouter.sol`.

This is a three-mechanism composition: M_A (auction on A) compose M_bridge (LayerZero message) compose M_B (auction on B).

**Why this composition satisfies IIA**:

The bridge is a pass-through. It transmits committed orders from Chain A to Chain B (or vice versa) without modifying them. The bridge's contribution to the cooperative game is message delivery --- a genuine service, but one that does not alter the fairness properties of the endpoint mechanisms.

**Key properties**:

- **S1**: Bridge fees are zero. VibeSwap's bridge charges no protocol fee, ensuring full value conservation across chains. All value generated by cross-chain trades is distributed to participants (LPs, traders), not to the bridge operator.

- **S3**: Cross-chain attackers are null players. An attacker who sends a malicious message via LayerZero cannot profit because both endpoint auctions enforce commit-reveal. The attacker would need to commit on Chain A, bridge the commitment, and reveal on Chain B --- but the commitment binds them to a specific order, and the clearing price is determined by aggregate supply and demand, not by individual orders.

- **S2**: A trader on Chain A and a trader on Chain B submitting identical orders receive identical execution. The chain of origin does not affect the clearing price or the Shapley reward.

### 7.3 Shapley + Governance Composition

The Augmented Governance architecture composes financial mechanisms (DEX, AMM) with governance mechanisms (DAO voting, constitutional court).

The hierarchy is:
```
Physics (P-001: No Extraction) > Constitution (P-000: Fairness Above All) > Governance (DAO votes)
```

The "constitutional court" is the Shapley verification layer. Any governance proposal that would violate S1--S5 is vetoed --- not by a human judge, but by mathematical verification. The `PairwiseFairness` library checks proposed reward distributions against the Shapley axioms. A distribution that violates any axiom is rejected automatically.

This composition satisfies IIA because:

- **ESE**: Governance proposals that create extraction opportunities (e.g., directing fees to a specific address) are blocked by the constitutional court's S3 check (the beneficiary must have a positive marginal contribution).

- **UT**: Governance weight is derived from Shapley contribution, not from token holdings or temporal position. All participants have influence proportional to their demonstrated contribution.

- **VC**: The governance mechanism does not create or destroy value. It governs the distribution of value generated by financial mechanisms. S1 ensures all value reaches participants.

---

## Part VIII: The Everything App

### 8.1 From Vision to Theorem

"The Everything App" has been a meme in technology for a decade: WeChat in China, X's aspiration in the West, super-apps in Southeast Asia. The concept is always the same --- one platform for everything --- but the execution always converges on the same failure mode: the platform captures value from all domains, becoming an extractive monopoly.

VibeSwap's "Everything App" vision is structurally different because it is a mathematical consequence of the Composable Fairness Theorem, not a marketing aspiration.

**Theorem 8.1 (Everything App)**. If fairness composes (Theorem 3.1), then any mechanism satisfying IIA can be safely added to the VibeSwap ecosystem without reducing the fairness of the existing system.

*Proof*: Let M_existing = M_1 compose M_2 compose ... compose M_N be the current VibeSwap ecosystem, satisfying IIA by the Possibility Theorem (Theorem 5.1). Let M_new be a new mechanism satisfying IIA. If the composition M_existing compose M_new respects S1--S5, then M_existing compose M_new satisfies IIA by Theorem 3.1. QED.

This is not a trivial result. It means that the ecosystem can grow without bound, adding new mechanisms (new SVC platforms) without compromising the fairness of existing ones. Each new mechanism must individually satisfy IIA and its composition must respect Shapley axioms, but once these conditions are verified, integration is safe.

### 8.2 The SVC Platform Family

Each SVC (Shapley-Value-Compliant) platform is a mechanism M_k that satisfies IIA and composes with the existing ecosystem:

| SVC Platform | Domain | Mechanism | IIA Condition |
|-------------|--------|-----------|--------------|
| VibeSwap | Finance | Batch auction + AMM | Commit-reveal eliminates extraction |
| VibeJobs | Labor | Task marketplace | Shapley distributes project revenue to contributors by marginal contribution |
| VibeMarket | Commerce | Peer-to-peer marketplace | Reputation-weighted escrow, no platform fee extraction |
| VibeTube | Media | Content platform | Revenue distributed to creators by viewership contribution, not algorithmic amplification |
| VibeHouse | Housing | Rental marketplace | Harberger-licensed listings, self-assessed pricing eliminates rent extraction |
| VibeLearn | Education | Knowledge marketplace | Epistemic staking on course quality, refund for zero-value courses |
| VibeHealth | Health | Provider marketplace | Outcome-based payment, Shapley weights prevent overtreatment incentives |

### 8.3 Cross-Domain Shapley Attribution

The Composable Fairness Theorem enables cross-domain attribution: a user's contribution on VibeJobs feeds into their Shapley weight on VibeSwap, and vice versa.

**How this works formally**:

Define the cross-domain value function:
```
v_cross(S) = v_swap(S intersect N_swap) + v_jobs(S intersect N_jobs)
             + delta_cross(S)
```

Where delta_cross(S) is the cross-domain surplus: the additional value created when a VibeJobs contributor also provides liquidity on VibeSwap (e.g., a freelancer who reinvests earnings into LP positions, deepening liquidity).

The Shapley value of participant i in the cross-domain game:
```
phi_i(v_cross) = phi_i(v_swap) + phi_i(v_jobs) + phi_i(delta_cross)
```

The third term captures the cross-domain synergy. A user who contributes to both platforms may create value that neither platform creates alone (e.g., by demonstrating real economic activity that increases trust in the ecosystem).

By S4, this cross-domain reward is proportional to the cross-domain contribution. A user who contributes identically in both domains gets the same cross-domain bonus as any other user with the same cross-domain contribution pattern.

### 8.4 Why This Isn't a Super-App

The critical distinction between VibeSwap's Everything App and traditional super-apps:

| Property | Traditional Super-App | VibeSwap Everything App |
|----------|---------------------|------------------------|
| Value capture | Platform captures 20-30% | Platform captures 0% (S1) |
| Data ownership | Platform owns all data | Users own all data |
| Lock-in | High switching costs | Zero switching costs (graceful inversion) |
| Growth incentive | Extract more per user | Create more value per user (S4) |
| Failure mode | Extractive monopoly | Cannot extract by construction (ESE) |

The Composable Fairness Theorem guarantees that the platform cannot extract value (S3 --- the platform is a null player in the cooperative game of user-to-user value exchange). The platform's role is infrastructure: providing the composition boundary where mechanisms meet. Its reward comes from the genuine infrastructure contribution it makes (hosting, development, maintenance), not from extracting a percentage of all transactions.

---

## Part IX: Implications

### 9.1 For DeFi: Composable Fairness as a Design Standard

The DeFi ecosystem currently lacks a theory of composable security. Protocols are audited individually, but their compositions are not. The result is a permanent arms race: every new protocol integration creates new attack surfaces, and auditors must manually analyze each composition.

Composable Fairness provides a principled alternative. If every protocol satisfies IIA and every composition respects Shapley axioms, then:

1. **Local audits suffice for global security**. Auditing M_1 and M_2 individually, plus verifying S1--S5 at the composition boundary, guarantees the safety of M_1 compose M_2. There is no need to analyze all possible interaction patterns --- the theorem guarantees they are safe.

2. **New integrations are safe by construction**. Adding a new protocol to the ecosystem does not require re-auditing the entire system. It requires auditing the new protocol (IIA) and verifying the composition (S1--S5).

3. **Attack surface analysis becomes tractable**. Instead of enumerating all possible composition exploits, auditors check five axioms. If all five hold, no composition exploit is possible. If any axiom is violated, the violation points directly to the attack vector.

We propose that "IIA + Shapley composition" become a formal standard for DeFi protocols, analogous to how ERC-20 standardized token interfaces. A protocol that is certified IIA-compliant and Shapley-composable can be integrated with any other certified protocol without additional analysis.

### 9.2 For AI: Cooperative Intelligence as Composable Fair Coordination

The convergence thesis (Glynn, 2026) identifies blockchain and AI as two manifestations of a single discipline: coordination at scale. The Composable Fairness Theorem applies to AI coordination as directly as it applies to DeFi.

Consider a multi-agent AI system where each agent is a "mechanism" that produces outputs consumed by other agents. If each agent satisfies IIA (no agent extracts value from other agents, all agents are treated uniformly, all generated value is conserved), and the composition respects Shapley axioms (each agent's reward is proportional to its marginal contribution), then the multi-agent system is fair.

This provides a formal foundation for:

- **Shapley-attributed AI training**: Each data contributor's reward is proportional to their marginal contribution to model performance (Ghorbani & Zou, 2019). The Composable Fairness Theorem extends this to composed models: when Model A's output feeds into Model B's input, the data contributors to both models are rewarded proportionally.

- **Agent coordination without centralization**: In a swarm of AI agents, the Shapley axioms ensure that no agent can free-ride on the work of others (S3), all agents performing identical work receive identical rewards (S2), and the total reward is distributed efficiently (S1).

- **The Jarvis architecture**: VibeSwap's multi-shard AI system (Jarvis) composes multiple AI shards, each a "complete mind" (see *Shards Over Swarms*, Glynn, 2026). The Composable Fairness Theorem ensures that shard composition is fair: each shard's contribution to the global output is rewarded proportionally, and no shard can extract value by free-riding on others' computation.

### 9.3 For Governance: Constitutional Invariants Across Organizational Boundaries

Arrow's Impossibility Theorem has been used for seventy-five years to argue that perfect governance is impossible. The Composable Fairness Theorem does not refute Arrow --- it circumscribes Arrow's domain.

Arrow applies when agents have conflicting preferences and can act on them. This is the case in voting. It is not the case when defection is structurally impossible. In organizations governed by Shapley-compliant mechanisms, governance decisions compose fairly because the mechanisms prevent extractive proposals from being enacted.

This provides a formal basis for:

- **Inter-DAO cooperation**: Two DAOs can cooperate on a shared project, distribute rewards via Shapley values, and trust that neither DAO is exploiting the other (S3) and that both are rewarded proportionally (S4).

- **Constitutional hierarchies**: The Physics > Constitution > Governance hierarchy from the Augmented Governance paper is a composition of mechanisms at different levels. The Composable Fairness Theorem ensures that this vertical composition preserves fairness: constitutional invariants (P-001: No Extraction) compose with governance decisions (DAO votes) without either level undermining the other.

- **Cross-border coordination**: Nation-states, like DAOs, face composition problems when cooperating on trade, climate, or security. The theorem provides a theoretical framework for designing international institutions where cooperation is the Nash equilibrium --- not through enforcement, but through architecture.

### 9.4 For Economics: The Possibility of Genuinely Fair Markets

Classical economics assumes that market efficiency and individual fairness are sometimes in tension. The Composable Fairness Theorem suggests otherwise.

When defection is impossible (ESE), the standard efficiency-fairness tradeoff dissolves:

- **No deadweight loss from defensive behavior**: In traditional markets, participants spend resources on MEV protection, front-running infrastructure, and market manipulation detection. These are deadweight losses --- resources that produce no value. Under IIA, these expenditures are unnecessary because the mechanisms prevent extraction.

- **No information asymmetry premium**: In traditional markets, informed traders profit at the expense of uninformed traders. Under IIA with commit-reveal, all traders commit before information is revealed. The information asymmetry premium is zero.

- **No platform rent**: In traditional platform economies, the platform captures 20-30% of transaction value. Under IIA with Shapley distribution, the platform is a null player (S3) unless it contributes genuine infrastructure value.

The net effect: markets that satisfy IIA are both fairer *and* more efficient than traditional markets. There is no tradeoff. This is not because IIA is magical, but because the "tradeoff" between efficiency and fairness was always an artifact of allowing defection. Remove defection, and the tradeoff disappears.

---

## Part X: Conclusion

### 10.1 What We Proved

Arrow proved that fair preference aggregation is impossible when agents can defect. We proved that fair mechanism composition is possible when defection is structurally eliminated.

The difference is the mechanism. Arrow's agents express subjective preferences with no constraints on their strategy space. IIA agents take objective actions within a constrained strategy space where extraction is infeasible. Arrow's impossibility is a theorem about the consequences of unconstrained agency. Our possibility is a theorem about the consequences of architectural fairness.

### 10.2 The Composition Theorem in One Sentence

**Fairness composes if and only if the composition respects Shapley values.**

This is the central result. It is necessary (violating any Shapley axiom breaks fairness) and sufficient (respecting all five preserves fairness). It is unique (no other composition rule works). And it is constructive (it tells you exactly how to design composable fair systems).

### 10.3 The VibeSwap Proof of Concept

VibeSwap is not merely a DEX that uses Shapley values. It is a proof of concept for the Composable Fairness Theorem. Every architectural decision --- commit-reveal, uniform clearing prices, same-block interaction guards, zero bridge fees, Shapley distribution, constitutional governance --- enforces one or more of the five axioms at one or more composition boundaries.

The architecture was designed empirically before the theory was formalized. The theory explains why the architecture works: it satisfies, by construction, the necessary and sufficient conditions for composable fairness.

### 10.4 The Broader Vision

If fairness composes, then the vision described in the Graceful Inversion paper --- an ecosystem of SVC platforms spanning finance, labor, media, housing, education, health, and entertainment --- is not utopian. It is a mathematical consequence of the theorem.

Each new domain is a new mechanism M_k. If M_k satisfies IIA and its composition with the existing ecosystem respects S1--S5, then the expanded ecosystem is fair. The ecosystem can grow without bound. Fairness scales.

This is the inverse of every platform economy that has come before. Traditional platforms extract more value as they grow (network effects create monopoly power). SVC platforms distribute more value as they grow (Shapley distribution rewards marginal contribution, and marginal contributions increase with ecosystem size and diversity).

### 10.5 The Last Word

The question has never been whether fairness is possible. It is whether you design for it.

Arrow proved that fairness is impossible when you accept defection as given. The Composable Fairness Theorem proves that fairness is inevitable when you eliminate defection by design.

The choice is architectural. Build systems where defection is possible, and Arrow's shadow falls across every composition. Build systems where defection is impossible, and fairness composes --- across protocols, across domains, across time, across attacks, across knowledge, across versions.

VibeSwap chose the second path. The theorem says it works. The code proves it.

---

## References

Arrow, K. J. (1951). *Social Choice and Individual Values*. Yale University Press.

Ghorbani, A. & Zou, J. (2019). "Data Shapley: Equitable Valuation of Data for Machine Learning." *Proceedings of ICML*.

Glynn, W. (2026a). "Cooperative Markets: A Mathematical Foundation." VibeSwap Research.

Glynn, W. (2026b). "Shapley Value Distribution: Fair Reward Allocation Through Cooperative Game Theory." VibeSwap Research.

Glynn, W. (2026c). "Graceful Inversion: Positive-Sum Absorption as Protocol Strategy." VibeSwap Research.

Glynn, W. (2026d). "A Constitutional Interoperability Layer for DAOs." VibeSwap Research.

Glynn, W. (2026e). "Time-Neutral Tokenomics: Provably Fair Distribution via Shapley Values." VibeSwap Research.

Glynn, W. (2026f). "The IT Meta-Pattern: Four Behavioral Primitives That Invert the Protocol Trust Stack." VibeSwap Research.

Glynn, W. (2026g). "Economitra: On the False Binary of Monetary Policy and the Case for Elastic Non-Dilutive Money." VibeSwap Research.

Glynn, W. (2026h). "IIA Empirical Verification: VibeSwap as Proof of Concept." VibeSwap Research.

Glynn, W. (2026i). "Mechanism Insulation: Why Fees and Governance Must Be Separate." VibeSwap Research.

Glynn, W. (2026j). "Cognitive Consensus Markets." VibeSwap Research.

Glynn, W. (2026k). "Proof of Mind Consensus." VibeSwap Research.

Hurwicz, L. (1960). "Optimality and Informational Efficiency in Resource Allocation Processes." *Mathematical Methods in the Social Sciences*.

Moulin, H. (2003). *Fair Division and Collective Welfare*. MIT Press.

Myerson, R. B. (1981). "Optimal Auction Design." *Mathematics of Operations Research*, 6(1), 58-73.

Nash, J. F. (1950). "The Bargaining Problem." *Econometrica*, 18(2), 155-162.

Roth, A. E. (1988). *The Shapley Value: Essays in Honor of Lloyd S. Shapley*. Cambridge University Press.

Shapley, L. S. (1953). "A Value for n-Person Games." *Contributions to the Theory of Games*, Vol. II, 307-317.

Trivers, R. L. (1971). "The Evolution of Reciprocal Altruism." *The Quarterly Review of Biology*, 46(1), 35-57.

von Neumann, J. & Morgenstern, O. (1944). *Theory of Games and Economic Behavior*. Princeton University Press.

Winter, E. (2002). "The Shapley Value." *Handbook of Game Theory with Economic Applications*, Vol. 3, 2025-2054.

---

## Appendix A: Formal Notation

### A.1 Sets and Operators

| Symbol | Meaning |
|--------|---------|
| N | Set of participants {1, 2, ..., n} |
| N_c | Participant set of composed mechanism, N_1 union N_2 |
| A | Action space A_1 x A_2 x ... x A_n |
| A_c | Composed action space (includes cross-mechanism strategies) |
| O | Outcome space |
| f | Outcome function f: A -> O |
| M | Mechanism (N, A, O, f) |
| compose | Composition operator: M_1 compose M_2 |
| v | Characteristic function v: 2^N -> R |
| v_c | Composed characteristic function |
| phi_i | Shapley value of participant i |
| B | Composition boundary B: O_1 -> A_2 |
| delta | Composition surplus |
| S | Coalition (subset of N) |
| w_i | Weighted contribution of participant i |

### A.2 IIA Conditions

| Condition | Formal Statement |
|-----------|------------------|
| ESE | for all s in A: extractive(s) implies not feasible(s, M) |
| UT | for all i, j in N: rules(i, M) = rules(j, M) |
| VC | sum over i in N of V_i = V_total |

### A.3 Shapley Axioms for Composition

| Axiom | Symbol | Statement |
|-------|--------|-----------|
| Efficiency | S1 | sum phi_i(v_c) = v_c(N_c) |
| Symmetry | S2 | v_c(S union {i}) = v_c(S union {j}) for all S implies phi_i = phi_j |
| Null Player | S3 | v_c(S union {i}) = v_c(S) for all S implies phi_i = 0 |
| Pairwise Proportionality | S4 | phi_i / phi_j = w_i / w_j |
| Time Neutrality | S5 | Same contribution in different epochs implies same reward (fee games) |

### A.4 Key Functions

**Shapley Value**:
```
phi_i(v) = SUM over S in N\{i}:
    [ |S|! * (|N| - |S| - 1)! / |N|! ] * [ v(S union {i}) - v(S) ]
```

**Composed Value Function**:
```
v_c(S) = v_1(S intersect N_1) + v_2(S intersect N_2) + delta(S, B)
```

**VibeSwap Weighted Contribution**:
```
w_i = directContribution_i * 0.40
    + timeScore_i          * 0.30
    + scarcityScore_i      * 0.20
    + stabilityScore_i     * 0.10
```

---

## Appendix B: Proof Details

### B.1 Full Sufficiency Proof (Theorem 3.1, Forward Direction)

We prove that IIA(M_1) + IIA(M_2) + S1--S5 implies IIA(M_1 compose M_2).

**ESE for M_1 compose M_2**:

Let s_e be any strategy in A_c. We must show that if s_e is extractive, then s_e is infeasible under M_1 compose M_2 with Shapley distribution.

Suppose s_e is extractive: there exist i, j in N_c such that executing s_e transfers value from j to i without j's consent.

Case A: s_e is contained in A_1 (does not cross the composition boundary).
Then s_e is a strategy in M_1's action space. Since M_1 satisfies IIA, s_e is infeasible in M_1. Since M_1 compose M_2 preserves M_1's action space constraints, s_e is infeasible in M_1 compose M_2.

Case B: s_e is contained in A_2. Symmetric to Case A.

Case C: s_e crosses the composition boundary.
Then s_e involves actions in both M_1 and M_2. The value gained by i is phi_i(v_c) under Shapley distribution. By S3, phi_i(v_c) > 0 only if i contributes positively to some coalition. If i extracts from j, then i's "contribution" must come at j's expense.

But by S1, sum phi_k = v_c(N_c). And by the definition of v_c, v_c(N_c) = v_1(N_1) + v_2(N_2) + delta(N_c, B). The total value is fixed. If phi_i > 0, then i's share comes from the total, not from any specific j.

Now, for s_e to be extractive, j's payoff must decrease when i executes s_e. But under Shapley distribution, j's payoff phi_j depends only on j's marginal contribution to coalitions --- not on i's actions. The Shapley value is computed from the characteristic function v_c, which depends on coalition values, not on individual strategies.

The key insight: under Shapley distribution, a participant cannot reduce another participant's reward by changing their own strategy. Each participant's reward depends on their marginal contribution to all coalitions, which is determined by the characteristic function, not by other participants' actions. Extraction requires changing another's payoff, which Shapley distribution prevents.

Therefore, s_e cannot be extractive under Shapley distribution. ESE holds.

**UT for M_1 compose M_2**:

By S2, identical contributions yield identical rewards. By construction, M_1 compose M_2's rules are the union of M_1's rules, M_2's rules, and the composition rules (which are defined by S1--S5 and therefore participant-neutral). No rule distinguishes between participants based on identity. UT holds.

**VC for M_1 compose M_2**:

By S1, sum phi_i(v_c) = v_c(N_c). All generated value is distributed. No value is destroyed (the composition itself has no mechanism to destroy value). No value is retained (S1 mandates full distribution). VC holds.

### B.2 Full Necessity Proof (Theorem 3.1, Backward Direction)

We prove: if IIA(M_1 compose M_2) holds, then the composition must respect S1--S5.

**S1 is necessary**:

Suppose S1 is violated: sum phi_i < v_c(N_c). Then value v_c(N_c) - sum phi_i > 0 is undistributed. This violates VC (total captured != total created). Since IIA requires VC, IIA is violated. Contradiction.

**S2 is necessary**:

Suppose S2 is violated: identical contributions yield different rewards. Then there exist i, j with identical marginal contributions but phi_i != phi_j. The mechanism treats them differently. UT is violated. IIA is violated. Contradiction.

**S3 is necessary**:

Suppose S3 is violated: a null player receives phi_i > 0. Then i contributes nothing but captures value. The value phi_i must come from other participants' shares (by S1, total is fixed). This is extraction without contribution. ESE is violated. IIA is violated. Contradiction.

**S4 is necessary**:

Suppose S4 is violated: phi_i / phi_j != w_i / w_j for some i, j. Then either i receives more than their proportional contribution (extracting from others) or less (being extracted from). In either case, VC is violated at the individual level. IIA requires that no participant is extractively disadvantaged, which requires proportional distribution. Contradiction.

**S5 is necessary** (for fee distribution games):

Suppose S5 is violated: identical contributions in different epochs yield different rewards. Then participants contributing at time t_1 are treated differently from those contributing at time t_2. UT is violated. IIA is violated. Contradiction.

### B.3 Uniqueness Proof (Corollary 3.2)

By Shapley (1953), the Shapley value is the unique function phi: Games -> R^n satisfying Efficiency, Symmetry, Null Player, and Additivity. Our axioms S1--S3 correspond to Efficiency, Symmetry, and Null Player. S4 (Pairwise Proportionality) is implied by the Shapley value for weighted linear games (VibeSwap's characteristic function is linear in weighted contributions). S5 (Time Neutrality) is an additional constraint satisfied by the Shapley value for fee games.

Suppose there exists another composition rule psi != phi that preserves IIA. Then psi must satisfy S1--S5 (by necessity). But phi is the unique function satisfying the classical Shapley axioms (S1--S3), which are a subset of S1--S5. Therefore psi = phi. Contradiction.

---

## Appendix C: VibeSwap Contract Cross-References

### C.1 IIA Implementation

| IIA Condition | Contract | Key Function | Lines |
|--------------|----------|--------------|-------|
| ESE (commit-reveal) | CommitRevealAuction.sol | `commitOrder()`, `revealOrder()` | 295-442 |
| ESE (uniform price) | BatchMath.sol | `calculateClearingPrice()` | 37-99 |
| ESE (random order) | DeterministicShuffle.sol | `shuffle()` | 15-55 |
| ESE (flash loan guard) | VibeAMM.sol | `lastInteractionBlock` check | - |
| UT (same rules) | PoolComplianceConfig.sol | Access control configuration | - |
| VC (full distribution) | ShapleyDistributor.sol | `computeShapleyValues()`, `claimReward()` | 428-429 |

### C.2 Shapley Axiom Enforcement

| Axiom | Contract | Enforcement |
|-------|----------|-------------|
| S1 (Efficiency) | ShapleyDistributor.sol | Remainder-to-last-participant pattern (line 428-429) |
| S2 (Symmetry) | ShapleyDistributor.sol | Weighted contribution model with fixed weights |
| S3 (Null Player) | ShapleyDistributor.sol | `NoReward` revert for zero contribution |
| S4 (Proportionality) | PairwiseFairness.sol | `verifyPairwiseProportionality()` cross-multiplication check |
| S5 (Time Neutrality) | ShapleyDistributor.sol | Epoch-independent computation for fee games |

### C.3 Composition Boundary Contracts

| Composition | Boundary Contract | Fairness Enforcement |
|-------------|------------------|---------------------|
| Auction + AMM | VibeSwapCore.sol | Orchestrates auction clearing -> AMM reserve update |
| Cross-chain | CrossChainRouter.sol | LayerZero message verification, zero bridge fees |
| Governance | DAOTreasury.sol | Constitutional veto on Shapley-violating proposals |
| Fee + Governance | mechanism-insulation pattern | Separate tracks prevent cross-contamination |

### C.4 Weighted Contribution Parameters

| Component | Weight (BPS) | Percentage | Contract Constant |
|-----------|-------------|------------|-------------------|
| Direct contribution | 4000 | 40% | `DIRECT_WEIGHT` |
| Enabling duration | 3000 | 30% | `ENABLING_WEIGHT` |
| Scarcity score | 2000 | 20% | `SCARCITY_WEIGHT` |
| Stability score | 1000 | 10% | `STABILITY_WEIGHT` |

### C.5 Cross-Reference to VibeSwap Research Corpus

| Paper | Primary Theorem Connection | Dimension |
|-------|--------------------------|-----------|
| Cooperative Markets | IIA definition, multilevel selection | Foundation |
| Shapley Value Distribution | Five axioms, on-chain implementation | Foundation |
| IIA Empirical Verification | Code-level IIA validation | Verification |
| Graceful Inversion | Horizontal composition, positive-sum absorption | Dimension 1 |
| Constitutional DAO Layer | Vertical composition, governance hierarchy | Dimension 2 |
| Time-Neutral Tokenomics | Temporal composition, Axiom S5 | Dimension 3 |
| IT Meta-Pattern | Adversarial composition, attack absorption | Dimension 4 |
| Cognitive Consensus Markets | Epistemic composition, knowledge fairness | Dimension 5 |
| Cincinnatus Endgame | Evolutionary composition, disintermediation | Dimension 6 |
| Economitra | Monetary theory, elastic non-dilutive money | Economics |
| Mechanism Insulation | Fee/governance separation, composition safety | Architecture |
| **Composable Fairness (this paper)** | **Unifying theorem** | **All** |

---

*This paper is the twelfth in the VibeSwap research corpus and the first to unify all prior results under a single theorem. The eleven preceding papers are special cases of the Composable Fairness Theorem, each addressing one dimension of the composition problem. Together, they constitute a complete theory of fair mechanism design for decentralized systems.*

*"The question isn't whether fairness is possible. It's whether you design for it."*

---

**License**: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)

**Contact**: Faraday1 | vibeswap.io | github.com/wglynn/vibeswap

---

## See Also

- [Shapley Reward System](shapley/SHAPLEY_REWARD_SYSTEM.md) — Core Shapley-based reward distribution with four axioms
- [Cross-Domain Shapley](shapley/CROSS_DOMAIN_SHAPLEY.md) — Fair value distribution across heterogeneous platforms
- [Proof of Contribution](identity/PROOF_OF_CONTRIBUTION.md) — Shapley-based consensus for block production
- [Formal Fairness Proofs](../research/proofs/FORMAL_FAIRNESS_PROOFS.md) — Axiom verification and omniscient adversary proofs
- [Atomized Shapley (paper)](../research/papers/atomized-shapley.md) — Universal fair measurement for all protocol interactions
- [Shapley Value Distribution (paper)](../research/papers/shapley-value-distribution.md) — On-chain implementation with five axioms
