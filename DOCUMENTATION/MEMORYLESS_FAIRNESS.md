# Memoryless Fairness: Structural Fairness as a Mechanism Property, Not a Participant Property

**Faraday1 (Will Glynn)**

Version 1.0 | March 2026

---

## Abstract

Most systems that claim to be "fair" rely on memory: reputation scores, trust tiers, stake history, time-weighted participation. But memory is a liability. It creates cold-start disadvantages for newcomers and gaming opportunities for incumbents. This paper introduces **Memoryless Fairness** as a formal mechanism design property: a mechanism is memoryless-fair if its outcome for any participant depends exclusively on their current action, never on their history. We demonstrate that VibeSwap's commit-reveal batch auction satisfies this property by construction, propose Memoryless Fairness as a sixth axiom for Shapley-class mechanism design, connect it to the IIA Uniform Treatment condition, and prove that memoryless-fair mechanisms compose without losing the property. The result is a design principle that eliminates cold-start disadvantage, renders history gaming structurally impossible, and makes fairness as impersonal as gravity.

---

## Table of Contents

1. [The Memory Problem](#1-the-memory-problem)
2. [Memoryless Fairness Defined](#2-memoryless-fairness-defined)
3. [VibeSwap's Batch Auction as Memoryless Fair](#3-vibeswaps-batch-auction-as-memoryless-fair)
4. [Where Memory IS Appropriate](#4-where-memory-is-appropriate)
5. [The Two-Layer Architecture](#5-the-two-layer-architecture)
6. [Cross-Protocol Memoryless Fairness](#6-cross-protocol-memoryless-fairness)
7. [Comparison with Traditional Finance](#7-comparison-with-traditional-finance)
8. [The Memoryless Fairness Axiom](#8-the-memoryless-fairness-axiom)
9. [Connection to IIA Condition 2: Uniform Treatment](#9-connection-to-iia-condition-2-uniform-treatment)
10. [Implications](#10-implications)

---

## 1. The Memory Problem

### 1.1 The Assumption Behind "Fair" Systems

Virtually every system that claims to distribute outcomes fairly relies on some form of participant history. Credit scores determine loan terms. Reputation systems gate marketplace access. Staking duration multiplies governance weight. Loyalty programs reward tenure. The implicit assumption is universal: **past behavior predicts future trustworthiness, and fairness means rewarding good history.**

This assumption is wrong. Not because history is irrelevant to risk assessment, but because encoding history into execution creates two structural vulnerabilities that no amount of tuning can eliminate.

### 1.2 Vulnerability 1: Cold Start

If the mechanism consults history, new participants are structurally disadvantaged:

| System | Cold-Start Penalty |
|--------|--------------------|
| Credit scoring | No score = high interest or denial |
| DeFi reputation | No history = restricted access + worse terms |
| Staking weight | No duration = diluted voting power |
| Loyalty programs | No tenure = full price, no perks |
| Traditional exchanges | No relationship = no dark pool access, wider spreads |

The cold-start problem is not a bug. It is a **mathematical certainty** of any history-dependent mechanism. If `outcome = f(action, history)` and `history(new) = {}`, then the new participant's outcome is determined by the mechanism's default for empty history. That default is never the best outcome — if it were, history would be irrelevant and the mechanism wouldn't consult it.

**Consequence**: History-dependent fairness is inherently exclusionary. The longer a system runs, the higher the barrier for new entrants. The mechanism that was designed to reward good behavior becomes a moat that protects incumbents.

### 1.3 Vulnerability 2: History Gaming

If the mechanism rewards good history, rational actors will manufacture it:

```
Attack pattern: Build-then-Exploit

Phase 1 (Build):
    For t = 1 to T:
        Behave honestly
        Accumulate reputation R(T) = f(T, good_actions)

Phase 2 (Exploit):
    At t = T+1:
        Use accumulated R(T) to access high-value opportunity
        Defect once, extracting V_exploit >> cost of Phase 1
        R drops, but V_exploit - cost(Phase 1) > 0
```

This is not theoretical. Real-world examples:

| System | Gaming Strategy | Outcome |
|--------|----------------|---------|
| eBay reputation | Small honest trades, then one big scam | Buyer loss, reputation worthless |
| DeFi governance | Stake for months, then governance attack | Protocol drained |
| Credit markets | Years of payments, then strategic default | Lender loss |
| Academic peer review | Build reputation, then approve fraudulent work | Institutional trust eroded |

**The fundamental problem**: History is a depletable resource. It can be accumulated with patience and spent in a single defection. Any system that trusts history trusts a resource the participant controls.

### 1.4 The Deeper Issue

Both vulnerabilities share a root cause: **the mechanism's fairness depends on something external to the mechanism itself.** History is a participant property. It exists in the participant's past, is subject to the participant's manipulation, and varies across participants regardless of their current intentions.

A mechanism that depends on participant properties for fairness is a mechanism whose fairness is contingent. It can be subverted by anyone who can manipulate those properties.

The question becomes: can we design mechanisms where fairness is not contingent on anything about the participants?

---

## 2. Memoryless Fairness Defined

### 2.1 Formal Definition

**Definition 1 (Memoryless Fairness).** A mechanism M is *memoryless-fair* if and only if for any two participants i and j, and any round t:

```
If action(i, t) = action(j, t),
then outcome(i, t) = outcome(j, t)

regardless of history(i) and history(j).
```

Where:
- `action(i, t)` is the complete action submitted by participant i in round t (order parameters, deposit, timing — everything the mechanism observes)
- `outcome(i, t)` is the mechanism's output for participant i in round t (execution price, fill amount, position in queue)
- `history(i)` is the complete record of participant i's prior interactions with the mechanism

**Equivalently**: The mechanism's outcome function has no history parameter.

```
Memory-dependent:    outcome = f(action, history)
Memoryless-fair:     outcome = f(action)
```

### 2.2 Relation to Markov Property

In probability theory, a stochastic process is *memoryless* (Markov) if:

```
P(X_{t+1} | X_t, X_{t-1}, ..., X_0) = P(X_{t+1} | X_t)
```

The future depends only on the present, not the past.

Memoryless fairness is the mechanism design analog. The outcome of the current round depends only on the current actions, not the history of prior rounds. Each batch is a fresh game. Each participant enters with the same standing. The past is irrelevant to the mechanism.

### 2.3 What Memoryless Fairness Is NOT

Memoryless fairness does not mean:

| Misconception | Reality |
|---------------|---------|
| Everyone gets the same outcome | Equal actions get equal outcomes; different actions get different outcomes |
| History doesn't exist | History exists but the mechanism does not consult it during execution |
| No accountability | Accountability can exist in a separate layer (see Section 5) |
| All participants are identical | Participants differ in actions, wealth, and intent — the mechanism treats them identically for identical actions |
| Reputation is useless | Reputation can gate access; it must not affect execution (see Section 4) |

### 2.4 Strength of the Property

Memoryless fairness is a strong property. It is strictly stronger than several familiar fairness notions:

```
Memoryless Fairness
    ⊃ Equal Treatment (same rules for all now)
    ⊃ Non-Discrimination (no identity-based outcomes)
    ⊃ Anonymity (outcome independent of name)
```

Equal treatment says the rules are the same. Memoryless fairness says the rules are the same AND the outcome is independent of anything the rules don't see. A system can have equal rules but consult history within those rules — such a system is equal-treatment but not memoryless-fair.

---

## 3. VibeSwap's Batch Auction as Memoryless Fair

### 3.1 The Mechanism

VibeSwap's commit-reveal batch auction operates in 10-second cycles:

```
[0s ─── COMMIT PHASE ─── 8s][8s ─── REVEAL PHASE ─── 10s]
```

1. **Commit (0-8s)**: Participants submit `hash(order || secret)` with collateral deposit
2. **Reveal (8-10s)**: Participants reveal order parameters and secret
3. **Settlement**: Fisher-Yates shuffle using XORed secrets; uniform clearing price computed; all orders execute at P*

### 3.2 Proof of Memoryless Fairness

**Theorem 1.** VibeSwap's commit-reveal batch auction is memoryless-fair.

**Proof.** We show that no step of the mechanism consults participant history.

**Step 1: Commitment.**

The commitment hash is computed as:

```solidity
commitment = keccak256(abi.encodePacked(
    msg.sender,
    tokenIn,
    tokenOut,
    amountIn,
    minAmountOut,
    secret
));
```

The inputs are: sender address, order parameters, and a secret. None of these are history-dependent. `msg.sender` is a current-state identifier. The order parameters are the current action. The secret is freshly generated. The collateral requirement (`COLLATERAL_BPS = 500`, i.e. 5%) is a protocol-level constant — the same for every participant in every batch.

**Step 2: Reveal.**

Reveal verification checks `hash(revealed) == committed_hash`. This depends only on the current commitment and current reveal. The slash penalty for invalid reveals (`SLASH_RATE_BPS = 5000`, i.e. 50%) is a protocol-level constant — identical for all participants.

**Step 3: Ordering.**

Execution order is determined by Fisher-Yates shuffle seeded with XORed secrets from all participants in the batch. No participant's history influences the shuffle. The seed is a function of current-round secrets only.

**Step 4: Pricing.**

The clearing price P* is computed by `BatchMath.calculateClearingPrice()`:

```
Find P* such that Demand(P*) = Supply(P*)
```

The algorithm takes as input the current batch's buy orders and sell orders. It does not accept, reference, or have access to any participant's historical trading record.

**Step 5: Execution.**

All orders in the batch that are above the clearing price execute at P*. The fill is determined by the participant's current order size relative to the batch's fillable volume.

**Conclusion**: At every step — commitment, reveal, ordering, pricing, execution — the mechanism's behavior depends exclusively on the current round's actions. For any two participants i and j: if `action(i) = action(j)` (same order parameters, same deposit, same timing), then `outcome(i) = outcome(j)`. History is structurally absent from the computation. **QED.**

### 3.3 Concrete Example

```
Batch #47,291:

Participant A:
    History: First trade ever. Account created 2 minutes ago.
    Action: Buy 100 USDC worth of ETH

Participant B:
    History: 10 years of trading. 50,000 prior trades. $10B lifetime volume.
    Action: Buy 100 USDC worth of ETH

Result:
    Participant A execution price: P* = 2,847.32 USDC/ETH
    Participant B execution price: P* = 2,847.32 USDC/ETH

    Same action. Same outcome. History is invisible to the mechanism.
```

### 3.4 What About Priority Bids?

VibeSwap's batch auction includes an optional priority bidding mechanism: participants can bid for execution priority within a batch. This does not violate memoryless fairness because:

1. The priority bid is part of the **current action**, not history
2. Two participants submitting identical priority bids in the same batch receive identical priority treatment
3. Priority bidding is a current-round decision, available to all participants equally

Priority bids are memoryless-fair: they depend on what you do NOW, not what you did before.

---

## 4. Where Memory IS Appropriate

### 4.1 The Access vs. Execution Distinction

Memoryless fairness applies to **execution** — how trades are processed once submitted. It does not preclude the use of memory for **access** — who is permitted to submit trades in the first place.

This distinction is critical. Consider:

| Layer | Memory Used? | Purpose |
|-------|-------------|---------|
| Access control | Yes | Determine who can trade in which pools |
| Order execution | No | Process trades with uniform clearing price |
| Price discovery | No | Compute P* from current batch only |
| Settlement | No | Distribute proceeds based on current orders |

### 4.2 Why Access Can Use Memory

Access control serves a fundamentally different purpose than execution. Access determines the *composition* of the participant set. Execution determines the *outcome* for a given composition.

Reputation tiers, KYC status, and accreditation requirements are access-layer concerns:

| Access Parameter | Memory Source | Purpose |
|-----------------|--------------|---------|
| `minTierRequired` | Reputation history | Risk segmentation |
| `kycRequired` | Identity verification | Regulatory compliance |
| `accreditationRequired` | Financial status | Investor protection |
| `blockedJurisdictions` | Geographic identity | Legal compliance |
| `maxTradeSize` | Tier-based limits | Risk management |

These are configurable per pool. But once a participant clears the access gate — once they are *in* the pool — the execution mechanism treats them identically to every other participant.

### 4.3 The Design Philosophy Insight

This is precisely the insight from VibeSwap's Design Philosophy on Configurability: **pools differ in WHO can access them, not HOW trading works.**

An OPEN pool and an INSTITUTIONAL pool use the same execution rules: same commit duration, same reveal duration, same collateral rate, same slash rate, same clearing price algorithm, same Fisher-Yates shuffle. The only difference is the access gate.

```
┌──────────────────────────────────────────────┐
│                ACCESS LAYER                   │
│         (Memory-ful: history matters)         │
│                                               │
│   Pool A: Open           Pool B: Institutional│
│   Min tier: 0            Min tier: 3          │
│   KYC: No                KYC: Yes             │
│   Max trade: 10K         Max trade: 10M       │
│                                               │
│   ┌─────────────────────────────────────────┐ │
│   │          EXECUTION LAYER                │ │
│   │     (Memoryless: history irrelevant)    │ │
│   │                                         │ │
│   │   Commit: 8s (all pools)               │ │
│   │   Reveal: 2s (all pools)               │ │
│   │   Collateral: 5% (all pools)           │ │
│   │   Slash: 50% (all pools)               │ │
│   │   Price: Uniform P* (all pools)        │ │
│   │   Order: Fisher-Yates (all pools)      │ │
│   │                                         │ │
│   │   action(i) = action(j) → same outcome │ │
│   └─────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

Memory is used where it belongs (access gating) and excluded where it doesn't (execution). The layers are insulated. Access-layer decisions cannot leak into execution-layer outcomes.

---

## 5. The Two-Layer Architecture

### 5.1 Layer 1: Memoryless Execution

Layer 1 handles everything that occurs after a participant has been admitted to a pool. It is memoryless by construction.

**Components:**

| Component | Function | History Consulted |
|-----------|----------|-------------------|
| `CommitRevealAuction.sol` | Order submission, reveal, slashing | None |
| `BatchMath.sol` | Clearing price calculation | None |
| `DeterministicShuffle.sol` | Execution ordering | None |
| `VibeAMM.sol` | Constant-product pricing | None (uses current reserves) |
| `VibeSwapCore.sol` | Orchestration | None |

**Invariant**: No function in Layer 1 accepts a participant identifier as input for outcome computation. `msg.sender` is used only for deposit/withdrawal tracking and access verification — never for price, fill, or priority determination.

### 5.2 Layer 2: Memory-ful Governance

Layer 2 handles access control, governance, and protocol evolution. It legitimately uses history.

**Components:**

| Component | Function | History Consulted |
|-----------|----------|-------------------|
| `PoolComplianceConfig.sol` | Access gating per pool | Reputation tier, KYC status |
| `ShapleyDistributor.sol` | Reward distribution | Contribution history |
| `DAOTreasury.sol` | Governance decisions | Token holding history |

### 5.3 The Insulation Principle

The two layers are insulated. Information flows from Layer 2 to Layer 1 only as a boolean gate:

```
Layer 2 → Layer 1:  "Is participant i permitted in pool P?"  →  {yes, no}

NOT:  "What is participant i's reputation score?"
NOT:  "How long has participant i been staking?"
NOT:  "What is participant i's trading history?"
```

The gate is binary. Once open, the participant is in the memoryless execution environment. No gradient of history leaks through. No "partial access" or "tiered execution." In or out. If in, equal.

This is the mechanism insulation principle applied to the temporal dimension: just as VibeSwap insulates trading fees from governance rewards to prevent cross-contamination, it insulates execution from history to prevent temporal contamination.

### 5.4 Why Insulation Must Be Structural

Insulation by policy ("we promise not to use history in execution") is worthless. Policy can change. Promises can break.

Insulation must be structural: **the execution-layer code physically cannot access history data.** In VibeSwap's architecture:

- `BatchMath.calculateClearingPrice()` is a `pure` function — it cannot read state at all
- `DeterministicShuffle.shuffle()` is a `pure` function — same
- The commit hash includes `msg.sender` but not any historical lookup
- No mapping from address to historical performance exists in any execution-layer contract

The absence of history is not a choice. It is an impossibility. The code does not have the capability to discriminate based on history even if someone wanted it to.

---

## 6. Cross-Protocol Memoryless Fairness

### 6.1 The Composability Question

Decentralized finance is composable. Protocols are building blocks. A swap on VibeSwap might be one step in a multi-protocol transaction. The question: **if Protocol A is memoryless-fair and Protocol B is memoryless-fair, is the composition memoryless-fair?**

### 6.2 Composition Theorem

**Theorem 2.** The sequential composition of memoryless-fair mechanisms is memoryless-fair.

**Proof.** Let M_A and M_B be memoryless-fair mechanisms. Consider the composed mechanism M_C = M_B(M_A(action)).

For participants i and j with `action(i) = action(j)`:

```
Step 1: M_A is memoryless-fair
    → outcome_A(i) = outcome_A(j)
    (identical actions produce identical intermediate outcomes)

Step 2: outcome_A feeds into M_B as its action
    → action_B(i) = outcome_A(i) = outcome_A(j) = action_B(j)
    (identical intermediate outcomes become identical inputs to M_B)

Step 3: M_B is memoryless-fair
    → outcome_B(i) = outcome_B(j)
    (identical inputs produce identical final outcomes)

Therefore: outcome_C(i) = outcome_C(j). QED.
```

The key insight: **neither protocol consults history, so the composition cannot introduce history-dependent outcomes.** History-dependence cannot emerge from history-independent components.

### 6.3 The Parallel Composition Case

What about protocols that execute in parallel (e.g., simultaneous swaps on two pools)?

**Theorem 3.** The parallel composition of memoryless-fair mechanisms is memoryless-fair.

**Proof.** Let M_A and M_B execute independently. For participants i and j:

```
If action_A(i) = action_A(j) and action_B(i) = action_B(j):
    → outcome_A(i) = outcome_A(j)    (M_A memoryless-fair)
    → outcome_B(i) = outcome_B(j)    (M_B memoryless-fair)
    → (outcome_A(i), outcome_B(i)) = (outcome_A(j), outcome_B(j))

The combined outcome is identical. QED.
```

### 6.4 Composability as the Easiest Dimension

Composable fairness has multiple dimensions: safety composability, liveness composability, incentive composability, and fairness composability. Of these, memoryless fairness composability is the easiest to prove because it is a *negative* property — the absence of history-dependence — and the absence of something composes trivially. You cannot create history-dependence by combining history-independent components.

This is analogous to purity in functional programming: the composition of pure functions is pure. Memoryless-fair mechanisms are the "pure functions" of mechanism design.

---

## 7. Comparison with Traditional Finance

### 7.1 Are Stock Exchanges Memoryless-Fair?

No. Traditional stock exchanges violate memoryless fairness at every level:

| Feature | History Used | Fairness Violation |
|---------|-------------|-------------------|
| Market maker designation | Firm history, capital history | Designated market makers get priority execution |
| Dark pool access | Institutional status, trading volume history | Large institutions see orders retail cannot |
| Colocation | Capital expenditure history | HFT firms with colocated servers execute microseconds before retail |
| Payment for order flow | Broker relationship history | Retail orders routed to market makers, not best execution |
| IPO allocation | Brokerage relationship, account history | Long-term clients get IPO shares; new accounts don't |
| Margin rates | Account history, portfolio history | Established accounts get cheaper leverage |

In every case, the exchange mechanism consults participant history and produces different outcomes for identical current actions. A new retail trader submitting the exact same order as a colocated HFT firm receives a different execution — worse price, slower fill, wider spread.

**Traditional finance is structurally memory-dependent.** This is not a flaw to be patched. It is the business model.

### 7.2 Why Traditional Finance Uses Memory

Memory serves two legitimate purposes and one illegitimate one:

| Purpose | Legitimate? | Example |
|---------|-------------|---------|
| Risk management | Yes | Credit checks before lending |
| Regulatory compliance | Yes | KYC/AML requirements |
| Rent extraction | **No** | Better prices for profitable clients |

The illegitimate use — rent extraction — is the one that traditional finance refuses to separate from the legitimate uses. Memoryless fairness demands this separation. Risk management and compliance belong in the access layer. Execution must be memoryless.

### 7.3 The VibeSwap Comparison

| Property | NYSE / NASDAQ | VibeSwap |
|----------|--------------|----------|
| Price determination | Continuous order matching (time priority) | Batch auction (uniform clearing price) |
| New participant price | Worse (no colocation, wide spreads) | Same P* as everyone |
| Execution priority | History-dependent (market maker status) | Randomized (Fisher-Yates shuffle) |
| Information access | Tiered (dark pools, Level II data) | Uniform (all orders hidden until reveal) |
| Cold-start penalty | Severe (no relationships, no access) | Zero (first trade same as ten-thousandth) |
| History gaming | Profitable (build relationship, extract) | Impossible (history not consulted) |

---

## 8. The Memoryless Fairness Axiom

### 8.1 The Existing Shapley Axioms

The Shapley value is defined by five axioms (as implemented in VibeSwap's `ShapleyDistributor.sol`):

| Axiom | Statement |
|-------|-----------|
| **Efficiency** | All value is distributed: `sum(V_i) = V_total` |
| **Symmetry** | Equal contributors receive equal rewards |
| **Null Player** | Zero contribution yields zero reward |
| **Pairwise Proportionality** | Reward ratio equals contribution ratio for any pair |
| **Time Neutrality** | Identical contributions yield identical rewards regardless of when |

### 8.2 The Proposed Sixth Axiom

**Axiom 6 (Memoryless Fairness).** The mechanism's outcome for a participant depends only on their current action, not their history.

```
Formally:

∀ i, j ∈ Participants, ∀ t ∈ Rounds:
    action(i, t) = action(j, t) → outcome(i, t) = outcome(j, t)

independent of history(i), history(j).
```

### 8.3 Relationship to Existing Axioms

Memoryless fairness is **strictly stronger** than the Symmetry axiom:

- **Symmetry** says: if two participants make equal contributions, they receive equal rewards
- **Memoryless Fairness** says: if two participants take equal *current actions*, they receive equal outcomes — even if their *historical contributions* are radically different

Consider two participants:
- Alice: contributed $10M in value over 3 years
- Bob: just arrived, has contributed nothing historically
- Both submit identical buy orders in the current batch

**Symmetry** does not guarantee equal execution — it speaks only about equal contributions, and Alice's historical contribution far exceeds Bob's.

**Memoryless Fairness** guarantees equal execution — Alice and Bob submitted the same current action, and the mechanism does not consult the past.

The distinction matters because Symmetry is compatible with history-dependent mechanisms (equal current contributions get equal outcomes, but "equal contributions" could include historical factors). Memoryless fairness is not compatible with history-dependence in any form.

### 8.4 Independence from Existing Axioms

Memoryless Fairness is independent of the existing five axioms:

- A mechanism can satisfy Efficiency, Symmetry, Null Player, Pairwise Proportionality, and Time Neutrality while still consulting history (e.g., a Shapley distribution that uses historical contribution data)
- A mechanism can satisfy Memoryless Fairness while violating Efficiency (e.g., a mechanism that ignores history but doesn't distribute all value)

Therefore, Axiom 6 is not derivable from Axioms 1-5 and adds genuine new information to the axiomatic system.

### 8.5 Why Time Neutrality Is Not Sufficient

Time Neutrality (Axiom 5) says: identical contributions yield identical rewards *regardless of when*. This might seem equivalent to memoryless fairness, but it is weaker:

Time Neutrality says: `contribution(i, t1) = contribution(j, t2) → reward(i, t1) = reward(j, t2)`

This is about equal treatment **across time** for equal contributions. It does not prevent the mechanism from using history to *define* what counts as a contribution or to *weight* contributions differently based on accumulated history.

Memoryless fairness is stronger: it says the mechanism cannot look at history at all during execution. Time Neutrality is a constraint on the *reward function*. Memoryless fairness is a constraint on the *entire mechanism*.

---

## 9. Connection to IIA Condition 2: Uniform Treatment

### 9.1 IIA Uniform Treatment

The Intrinsically Incentivized Altruism framework defines Condition 2 (Uniform Treatment) as:

```
∀ i, j ∈ Participants: rules(i) = rules(j)
```

All participants face the same rules. No special treatment. No privileged classes within the execution layer.

### 9.2 Memoryless Fairness as Temporal Uniform Treatment

Uniform Treatment ensures fairness across *space* (across participants at a given time). Memoryless fairness ensures fairness across *time* (across the same participant's lifetime, and across participants who arrive at different times).

```
Uniform Treatment:         rules(i, t) = rules(j, t)         ∀ i,j at time t
Memoryless Fairness:       outcome(i, t) ⊥ history(i)        ∀ i at any time t
Combined:                  Same rules, no history consulted    → Fairness is universal
```

Memoryless fairness is Uniform Treatment extended across the temporal dimension. It says: not only do all participants face the same rules RIGHT NOW, but the rules produce the same outcomes regardless of WHEN each participant arrived or WHAT they did before.

### 9.3 Why the Temporal Extension Matters

A mechanism can satisfy Uniform Treatment while violating Memoryless Fairness:

```
Example: A "fair" exchange with loyalty discounts

Rules (same for all):
    - Base fee: 0.3%
    - 100+ trades: fee drops to 0.2%
    - 1000+ trades: fee drops to 0.1%

Uniform Treatment: ✓ (everyone faces the same rule structure)
Memoryless Fairness: ✗ (outcome depends on history)
```

The loyalty discount system applies the same rules to everyone — it is uniform. But it consults trading history to determine the fee tier. A first-time trader pays 3x the fee of a veteran. The mechanism is spatially uniform but temporally discriminatory.

VibeSwap rejects this pattern. If you build in fee tiers, you are saying that a veteran's trade is worth more to the protocol than a newcomer's identical trade. There is no principled basis for this — the two trades contribute identical liquidity and volume. History-based fee discrimination is extraction by another name.

### 9.4 Completing the IIA Framework

The three IIA conditions, extended with memoryless fairness:

| Condition | Original Scope | Extended Scope |
|-----------|---------------|----------------|
| Extractive Strategy Elimination | No extraction strategies feasible | Same |
| Uniform Treatment | Same rules for all participants | Same rules, **independent of history** |
| Value Conservation | All value distributed to participants | Same |

Memoryless fairness strengthens IIA Condition 2 without altering Conditions 1 or 3. It closes a gap in the original formulation: Uniform Treatment as originally stated permits history-dependent outcomes as long as the history-dependence rule is the same for everyone. Memoryless fairness closes this gap.

---

## 10. Implications

### 10.1 Zero Cold-Start Disadvantage

In a memoryless-fair mechanism, a participant's first interaction is treated identically to their ten-thousandth. There is no learning period. No probationary phase. No "building a track record."

```
Trade #1:       action = buy 1 ETH → outcome = fill at P*
Trade #10,000:  action = buy 1 ETH → outcome = fill at P*

The mechanism does not know the difference.
The mechanism cannot know the difference.
The mechanism has no facility for knowing the difference.
```

This is not a policy choice. It is a structural impossibility. The execution-layer contracts do not contain mappings from addresses to trade counts. The information required to discriminate simply does not exist within the mechanism's state.

### 10.2 No History Gaming

If the mechanism does not consult history, there is nothing to game:

| Gaming Strategy | Memory-Based System | Memoryless System |
|----------------|--------------------|--------------------|
| Build fake reputation | Effective (gains access/priority) | Pointless (mechanism doesn't check) |
| Sybil attack for fresh identity | Effective (resets bad history) | Unnecessary (history is already irrelevant) |
| Wash trading for volume | Effective (may unlock tiers) | Pointless (no tier system in execution) |
| Long-con (honest then exploit) | Effective (accumulated trust is spent) | Impossible (no trust to accumulate) |

The entire category of history-gaming attacks is eliminated. Not mitigated. Not made expensive. Eliminated. The attack surface does not exist.

### 10.3 Whales Cannot Leverage History

In traditional finance, large participants benefit from history in compounding ways:

```
Traditional:
    Large volume → better relationships → dark pool access → better prices
    → more volume → better relationships → ...
    (positive feedback loop favoring incumbents)

VibeSwap:
    Large volume → same clearing price as small volume
    Small volume → same clearing price as large volume
    (no feedback loop; history creates no advantage)
```

A whale with $10B in historical volume and a first-time trader with $100 receive the same clearing price for identical orders. The whale's history buys exactly nothing in the execution layer.

### 10.4 The Only Thing That Matters Is Now

Memoryless fairness reduces the relevant state for each participant to a single point: their current action. Not who they are. Not where they came from. Not how long they've been here. Not what they did last time.

```
Relevant:
    ✓ What are you doing right now?
    ✓ What is your current order?
    ✓ What collateral are you posting now?

Irrelevant:
    ✗ What did you do yesterday?
    ✗ How many times have you traded?
    ✗ How much volume have you generated?
    ✗ What is your reputation score?
    ✗ When did you first use the protocol?
    ✗ What is your wallet balance history?
```

This is the strongest possible fairness guarantee for execution. It says: the mechanism is fair the way a mathematical function is deterministic — not because it tries to be, but because its structure admits no alternative. Fairness is a property of the mechanism, not a property of the participants. It holds regardless of who shows up, what they intend, or what they've done before.

Like gravity, it does not choose to be impartial. It simply is.

---

## Appendix A: Formal Notation Summary

| Symbol | Meaning |
|--------|---------|
| M | Mechanism |
| i, j | Participants |
| t | Round (batch) index |
| action(i, t) | Complete action by participant i in round t |
| outcome(i, t) | Mechanism output for participant i in round t |
| history(i) | Complete record of participant i's prior interactions |
| P* | Uniform clearing price for a batch |
| COLLATERAL_BPS | Protocol-level collateral rate (500 = 5%) |
| SLASH_RATE_BPS | Protocol-level slash rate (5000 = 50%) |
| M_A, M_B | Component mechanisms in composition |
| M_C | Composed mechanism |

---

## Appendix B: Checklist for Memoryless-Fair Mechanism Design

When designing a new mechanism or evaluating an existing one, verify:

- [ ] **No historical lookups in execution path**: Does any function in the execution path read a mapping indexed by participant address for historical data?
- [ ] **Protocol-level constants**: Are all execution parameters (fees, timing, penalties) protocol-wide constants, not per-participant or per-tier variables?
- [ ] **Pure pricing function**: Is the price/outcome function `pure` or `view` with no participant-history state reads?
- [ ] **Binary access gate**: Does the access layer communicate with the execution layer via a boolean (permitted/not-permitted), with no gradient of history leaking through?
- [ ] **No loyalty mechanisms in execution**: Are there loyalty discounts, tenure bonuses, or volume tiers that affect execution quality?
- [ ] **Shuffle independence**: Is execution ordering determined by current-round randomness, not by any historical priority?
- [ ] **Composability preserved**: If this mechanism composes with others, does the composition maintain memoryless fairness?

If all boxes are checked, the mechanism is memoryless-fair.

---

## References

1. Glynn, W. (2026). "Intrinsically Incentivized Altruism: Empirical Verification." VibeSwap Documentation.
2. Glynn, W. (2026). "Cooperative Markets: A Mathematical Foundation." VibeSwap Documentation.
3. Glynn, W. (2026). "Mechanism Insulation: Why Fees and Governance Must Be Separate." VibeSwap Documentation.
4. Glynn, W. (2026). "Design Philosophy: Configurability vs Uniformity." VibeSwap Documentation.
5. Glynn, W. (2026). "The IT Meta-Pattern: Adversarial Symbiosis and the Four Primitives." VibeSwap Documentation.
6. Shapley, L. S. (1953). "A Value for n-Person Games." Contributions to the Theory of Games II.
7. Arrow, K. J. (1950). "A Difficulty in the Concept of Social Welfare." Journal of Political Economy.
8. Budish, E., Cramton, P., & Shim, J. (2015). "The High-Frequency Trading Arms Race: Frequent Batch Auctions as a Market Design Response." Quarterly Journal of Economics.

---

*"Fairness is a property of the mechanism, not a property of the participants. The mechanism is fair the way gravity is impartial: not because it chooses to be, but because its structure admits no alternative."*

*— Faraday1, March 2026*
