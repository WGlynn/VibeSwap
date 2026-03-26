# Disintermediation Grades

**The Cincinnatus Roadmap: A Six-Grade Scale for Measuring Protocol Sovereignty**

*Faraday1, March 2026*

---

## Abstract

We present a formal grading system for measuring the degree of peer-to-peer interaction in decentralized protocols. The scale runs from Grade 0 (fully intermediated, every interaction requires a trusted third party) to Grade 5 (pure peer-to-peer, no intermediation point exists). We apply this scale to every interaction in the VibeSwap protocol, assess the current state, and define a four-phase roadmap for systematic disintermediation. The central mechanism is P-001 (No Extraction Ever): Shapley fairness measurement proves that intermediaries who add zero marginal value are null players, the protocol pays them nothing, they starve, they exit, and the grade increases automatically. Disintermediation is not a design choice imposed from above — it is an emergent property of fairness enforcement. The roadmap's completion criterion is the Cincinnatus Test: "If Will disappeared tomorrow, does this still work?" When every interaction passes at Grade 4 or above, the protocol is finished.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [The Scale](#2-the-scale)
3. [Current State Assessment](#3-current-state-assessment)
4. [The Cincinnatus Test](#4-the-cincinnatus-test)
5. [Connection to P-001](#5-connection-to-p-001)
6. [The Four-Phase Roadmap](#6-the-four-phase-roadmap)
7. [Augmented Governance](#7-augmented-governance)
8. [Case Studies](#8-case-studies)
9. [Formal Properties](#9-formal-properties)
10. [Conclusion](#10-conclusion)

---

## 1. Introduction

### 1.1 The Problem

Every protocol claims to be decentralized. Few measure it. "Decentralization" in practice is a binary label applied to marketing materials, not a quantitative property of system architecture. A protocol with 50 `onlyOwner` functions and a single admin key calls itself decentralized because its smart contracts are on a public blockchain.

This is insufficient. A protocol that cannot function without its founder is a company with extra steps.

### 1.2 The Principle

> "If you figuratively imagine middlemen as satan getting in between people, they must be identified and eradicated from reality."

Every intermediary — including the founder — is a structural compromise. The question is not whether intermediaries exist (they do, in every early-stage protocol) but whether they are tracked, graded, and systematically eliminated.

### 1.3 The Name

Lucius Quinctius Cincinnatus was a Roman dictator who, having been granted absolute power to save the Republic, relinquished it the moment the crisis was resolved and returned to his farm. The Cincinnatus Roadmap is the protocol's plan for the founder to do the same: build the system, transfer control to the system itself, and walk away.

> "I want nothing left but a holy ghost."

---

## 2. The Scale

### 2.1 Grade Definitions

The disintermediation scale has six grades, from fully intermediated to pure peer-to-peer:

---

**Grade 0 — Fully Intermediated**

Every interaction requires a trusted third party. You cannot transact without them. They have full control and can censor, extract, or deny service. The intermediary is not optional — they are the system.

*Example*: A centralized exchange. You deposit funds to their custody. They execute trades on your behalf. They can freeze your account, front-run your orders, or exit-scam with your assets. You have no recourse except legal action in their jurisdiction.

---

**Grade 1 — Transparent Intermediary**

The middleman exists but their extraction is visible. You can see the fees, the MEV, the admin actions. Transparency without elimination. The intermediary is still required, but their behavior is observable and auditable.

*Example*: A DeFi protocol with public fee parameters and an `onlyOwner` admin key. The owner can change fees, pause the contract, or upgrade the logic. But every action is on-chain and visible. You can see the extraction — you just cannot prevent it.

---

**Grade 2 — Optional Intermediary**

A peer-to-peer path exists alongside the intermediated path. Users CAN go direct but the middleman is still available, and most users default to it out of convenience or habit. The infrastructure supports both modes.

*Example*: A protocol with a default frontend that routes through its own relayer, but also supports direct contract interaction. Power users bypass the frontend; most do not.

---

**Grade 3 — Economically Unviable Intermediary**

Shapley fairness proves the middleman adds zero marginal value. P-001 detects their extraction. The protocol does not pay them (null player axiom). They can exist in theory but they starve in practice. No rule forbids intermediation — the economics simply do not support it.

*Example*: A fee distribution system where rewards are allocated by marginal contribution. An intermediary who routes transactions without adding liquidity, governance, or computational value receives zero allocation. They can operate — but at a loss.

---

**Grade 4 — Structurally Impossible Intermediary**

The protocol architecture eliminates the surface for intermediation. No position exists for a middleman to occupy. The design itself prevents the insertion of a third party between participants.

*Example*: A commit-reveal auction. You cannot front-run what you cannot see. The commitment hash hides the order during the commit phase. The reveal is batch-settled at a uniform clearing price. There is no information asymmetry for a middleman to exploit. The attack surface does not exist.

---

**Grade 5 — Pure Peer-to-Peer**

No intermediation point exists. The protocol is the medium, not the middleman. Like language between two people — it facilitates communication but does not intermediate it. The question "who is the middleman?" has no meaningful answer.

*Example*: Direct atomic swap between two parties who have already agreed on terms. No order book, no batch settlement, no routing. Two signatures, one transaction, done.

---

### 2.2 Grade Comparison Table

| Grade | Intermediary Status | User Autonomy | P-001 Role | Founder Required? |
|-------|-------------------|---------------|------------|-------------------|
| 0 | Required, opaque | None | Not applicable | Yes (is the intermediary) |
| 1 | Required, visible | Observation only | Detection possible | Yes |
| 2 | Optional | Choice exists | Detection + alternative | Awkwardly replaceable |
| 3 | Starving | Default is P2P | Null player enforcement | No (but suboptimal) |
| 4 | Impossible | Guaranteed | Structural prevention | No |
| 5 | Nonexistent | Absolute | Not needed (no attack surface) | Question is meaningless |

---

## 3. Current State Assessment

### 3.1 Full Interaction Audit

The following table grades every major interaction in the VibeSwap protocol as of March 2026:

| Interaction | Current Grade | Middleman | Target Grade | Path to Target |
|-------------|:------------:|-----------|:------------:|----------------|
| Swap execution | **4** | None (commit-reveal) | 5 | Already near-P2P. Grade 5 = direct atomic swap without batch settlement |
| LP fee distribution | **2** | Authorized creator picks participants/weights | 4 | On-chain contribution tracking, auto-game creation, no human picks participants |
| Token minting | **1** | Owner can mint directly, bypassing emission schedule | 4 | Remove owner from mint path. Only EmissionController mints. Enforce in contract |
| Governance | **0** | 50+ onlyOwner functions, unilateral pause/blacklist/upgrade | 4 | Cincinnatus Protocol: timelock, multisig, governance, renounce. GovernanceGuard with Shapley veto |
| Trust scoring | **1** | Owner-only recalculateTrustScores() | 3 | Permissionless recalculation with rate limiting. Anyone can trigger, BFS is deterministic |
| Price oracle | **1** | Off-chain Python operator signs attestations | 3 | Multi-source oracle with Shapley-weighted consensus. On-chain TWAP as fallback. Operator becomes optional |
| Cross-chain messaging | **1** | LayerZero relayers | 2 | Already using LZ with permissionless relaying. Still depends on LZ infrastructure |
| Bot deployment | **0** | Will runs Fly.io servers | 3 | Shard-per-conversation on user devices. WebRTC P2P. Users run their own Jarvis |
| Contract upgrades | **0** | Owner calls upgradeToAndCall | 4 | Timelock + governance vote + Shapley fairness gate. Eventually renounce upgrade authority |
| Fee routing | **1** | FeeRouter controlled by owner | 4 | Governance-adjustable parameters, Shapley-gated changes, eventually immutable |
| Insurance claims | **1** | Manual claim validation | 3 | On-chain proof of loss (oracle-attested), automatic payout, no human review |
| Contributor registration | **2** | Authorized bridges can vouch on behalf | 4 | Self-sovereign vouching only. Remove addVouchOnBehalf. Trust is P2P or it is not trust |

### 3.2 Grade Distribution Summary

```
Grade 0: ████████████  3 interactions (Governance, Bot deployment, Contract upgrades)
Grade 1: ████████████████████  5 interactions (Minting, Trust, Oracle, Fee routing, Insurance)
Grade 2: ████████  2 interactions (LP distribution, Contributor registration)
Grade 3:          0 interactions
Grade 4: ████  1 interaction (Swap execution)
Grade 5:          0 interactions

Median grade: 1
Target median: 4
```

### 3.3 Honest Assessment

The protocol is early. Most interactions still require Will or a trusted operator. The commit-reveal swap mechanism is the architectural showpiece at Grade 4, but governance — the most important interaction for long-term sovereignty — is at Grade 0. This is the natural state of a bootstrapping protocol: the mechanism is ahead of the governance.

---

## 4. The Cincinnatus Test

### 4.1 The Test

For each interaction, ask one question:

> **"If Will disappeared tomorrow, does this still work?"**

### 4.2 Test Results by Grade

| Grade | Passes Cincinnatus Test? | Explanation |
|:-----:|:------------------------:|-------------|
| 0 | No | Will is required. The interaction stops without him. |
| 1 | No | Will is required. His actions are visible but still necessary. |
| 2 | Awkwardly | Someone has to step in. The P2P path exists but the intermediated path is the default and the P2P path may be poorly documented or difficult to use. |
| 3 | Yes, suboptimally | The protocol functions. Some features degrade. The intermediary was already starving, so their absence causes minimal disruption. |
| 4 | Yes, fully | The protocol runs itself. There is no role for Will to have vacated. The architecture does not accommodate a middleman. |
| 5 | The question does not apply | There is no position to vacate. The protocol is the medium, not the middleman. Asking "what happens without Will?" is like asking "what happens to language without its inventor?" |

### 4.3 Completion Criterion

**The protocol is finished when the Cincinnatus Test passes for every interaction at Grade 4 or above.**

This is not a marketing milestone. It is an engineering specification. Every `onlyOwner` function is a Grade 0 dependency. Every off-chain operator is a Grade 1 dependency. The roadmap is the systematic elimination of these dependencies.

---

## 5. Connection to P-001

### 5.1 The Mechanism

P-001 (No Extraction Ever) is not just a fairness axiom. It is the enforcement mechanism for disintermediation. The logic is:

```
Step 1: A middleman exists in interaction X.
Step 2: Shapley measures the middleman's marginal contribution to X.
Step 3: The middleman adds zero value (they route, they do not create).
Step 4: Shapley null player axiom: φᵢ(v) = 0 for null player i.
Step 5: The protocol pays them nothing.
Step 6: The middleman operates at a loss.
Step 7: The middleman exits.
Step 8: Interaction X is now more peer-to-peer.
Step 9: Grade increases.
```

### 5.2 Emergent Disintermediation

The critical insight is that **disintermediation is emergent from fairness enforcement**. P-001 does not target intermediaries directly. It targets extraction. But intermediaries who add no value ARE extractors by definition — they take payment for zero marginal contribution.

This means the grade scale is not a static classification imposed by the designer. It is a dynamic measurement of the protocol's current fairness state. As P-001 detection improves and more interactions come under Shapley measurement, grades increase automatically.

The designer does not need to identify every intermediary and build a specific disintermediation plan for each one. The designer needs to deploy Shapley measurement as broadly as possible. The math does the rest.

### 5.3 The Cascade

```
P-001 deployed
    ↓
Shapley measures marginal contribution for all participants
    ↓
Null players identified (φᵢ = 0)
    ↓
Null players receiving payment = extraction detected
    ↓
Self-correction: payment to null players → 0
    ↓
Intermediaries starve (Grade 1 → Grade 3)
    ↓
Architecture updated to remove intermediary surface (Grade 3 → Grade 4)
    ↓
P2P path becomes the only path (Grade 4 → Grade 5 where possible)
```

### 5.4 Why This Is Different

Traditional disintermediation roadmaps are policy documents: "In Q3 we will transfer ownership to a multisig. In Q4 we will add a timelock." These are plans that depend on the founder's willingness to execute them.

The P-001 approach is different. The founder deploys the Shapley measurement. After that, intermediary elimination happens whether the founder wants it or not. If the founder is the intermediary — and at Grade 0, the founder IS the intermediary — then P-001 will eventually detect the founder's extraction and self-correct.

The roadmap executes itself. The founder cannot stop it without removing P-001. And P-001 sits above governance in the protocol hierarchy.

---

## 6. The Four-Phase Roadmap

### Phase 1: Remove Will as Single Point of Failure (Grade 0 → 2)

| # | Action | Interaction Affected | Grade Change |
|---|--------|---------------------|:------------:|
| 1 | Transfer ownership to multisig (2-of-3: Will + 2 team members) | Governance, Upgrades | 0 → 1 |
| 2 | Add 48-hour timelock on all admin functions | All onlyOwner functions | 0 → 1 |
| 3 | Remove owner from VIBEToken.mint() path | Token minting | 1 → 2 |
| 4 | Make trust score recalculation permissionless | Trust scoring | 1 → 2 |
| 5 | Deploy GovernanceGuard (Shapley veto on proposals) | Governance | 1 → 2 |

**Cincinnatus Test after Phase 1**: The protocol limps without Will. The multisig can operate. The timelock prevents immediate damage. But Will's key is still in the multisig, and most advanced functions still need team coordination.

---

### Phase 2: Make Intermediaries Optional (Grade 1 → 3)

| # | Action | Interaction Affected | Grade Change |
|---|--------|---------------------|:------------:|
| 6 | On-chain contribution tracking with auto-game creation in ShapleyDistributor | LP distribution | 2 → 3 |
| 7 | Multi-source oracle consensus (not single operator) | Price oracle | 1 → 3 |
| 8 | Self-sovereign vouching only in ContributionDAG | Contributor registration | 2 → 3 |
| 9 | Insurance auto-payout via oracle proof of loss | Insurance claims | 1 → 3 |
| 10 | Fee router parameters become governance-adjustable | Fee routing | 1 → 3 |

**Cincinnatus Test after Phase 2**: The protocol functions without Will. Some features are suboptimal. The oracle degrades to TWAP-only without the Kalman filter operator. Governance is slow without a leader. But nothing breaks.

---

### Phase 3: Make Intermediaries Structurally Impossible (Grade 2 → 4)

| # | Action | Interaction Affected | Grade Change |
|---|--------|---------------------|:------------:|
| 11 | Renounce upgrade authority on core contracts (VibeSwapCore, VibeAMM) | Contract upgrades | 2 → 4 |
| 12 | Immutable fee routing (or governance-only with Shapley veto) | Fee routing | 3 → 4 |
| 13 | Fully on-chain oracle (TWAP + multi-source, no off-chain operator) | Price oracle | 3 → 4 |
| 14 | Permissionless settlement (anyone can call settleBatch) | Swap execution | 4 (maintained) |
| 15 | Permissionless emission (EmissionController.drip() already permissionless) | Token minting | 3 → 4 |

**Cincinnatus Test after Phase 3**: The protocol runs itself. Will's absence is not detectable by the system. Every critical function operates without human intervention. The remaining Grade < 4 interactions are convenience features, not critical path.

---

### Phase 4: Pure Peer-to-Peer Where Possible (Grade 4 → 5)

| # | Action | Interaction Affected | Grade Change |
|---|--------|---------------------|:------------:|
| 16 | Direct atomic swaps for willing counterparties (skip batch auction) | Swap execution | 4 → 5 |
| 17 | Peer-to-peer Jarvis instances (user runs own shard) | Bot deployment | 3 → 5 |
| 18 | Client-side oracle validation (verify, do not trust) | Price oracle | 4 → 5 |
| 19 | Local-first frontend (IPFS/Arweave hosted, no Vercel dependency) | Frontend access | 1 → 5 |

**Cincinnatus Test after Phase 4**: The question "does this work without Will?" no longer has meaning. There is no role for Will to occupy. The protocol is a medium, not a service. Cincinnatus has returned to his farm.

---

## 7. Augmented Governance

### 7.1 The Risk of Governance Capture

The most common failure mode in DeFi DAOs is governance capture: a whale or coordinated group acquires majority voting power and extracts value through governance proposals. Compound governance was captured by a whale who voted themselves $25M. MakerDAO governance nearly drained the surplus buffer. Curve wars turned governance capture into a business model.

Increasing the governance grade from 0 to 4 is meaningless if the governance itself can be captured. A captured DAO is just a different middleman.

### 7.2 The Augmented Governance Solution

VibeSwap's governance sits below P-000 and P-001 in the protocol hierarchy:

```
Layer 1: Physics (P-001 — Shapley invariants, self-correction)
Layer 2: Constitution (P-000 — Fairness Above All)
Layer 3: Governance (DAO votes, proposals, parameters)
```

Governance can freely adjust parameters within the invariants. It cannot adjust the invariants themselves. The enforcement mechanism is the GovernanceGuard contract (Phase 1, item 5), which wraps every governance proposal in a Shapley fairness check before execution.

### 7.3 What Governance Can and Cannot Do

| Governance CAN | Governance CANNOT |
|----------------|-------------------|
| Adjust fee tiers per pool (100% stays with LPs) | Enable protocol fee extraction from LP swaps |
| Fund initiatives from treasury (priority bid revenue) | Redirect LP fees to treasury/stakers/anyone |
| Change circuit breaker thresholds | Override Shapley distribution weights |
| Add new token pairs | Drain treasury beyond fair allocation |
| Approve grants and partnerships | Break the null player axiom |
| Modify emission schedules (within Shapley efficiency) | Remove the Lawson Constant |

### 7.4 The Constitutional Court

A constitutional court strikes down laws that violate the constitution. The legislature has full legislative power — within constitutional bounds.

Augmented governance is the same structure, except:
- The constitution is P-000 + P-001.
- The court is Shapley math.
- The ruling is autonomous (no judges needed).
- The enforcement is on-chain (no appeals).

A constitutional court staffed by math, not humans. Incorruptible by definition.

---

## 8. Case Studies

### 8.1 Swap Execution (Grade 4)

The commit-reveal batch auction is VibeSwap's architectural centerpiece for disintermediation:

```
Commit phase (8s):
  User submits hash(order || secret) with deposit.
  Order content is hidden from all other participants.
  No MEV bot can front-run what it cannot see.

Reveal phase (2s):
  Users reveal orders and secrets.
  Invalid reveals are slashed 50%.

Settlement:
  Fisher-Yates shuffle using XORed secrets (deterministic, unbiasable).
  Uniform clearing price (all trades at the same price).
  No priority based on speed, block position, or gas price.
```

**Why Grade 4**: There is no position for a middleman. The information asymmetry that enables front-running (MEV) is eliminated by the commit phase. The execution priority that enables sandwich attacks is eliminated by the shuffle. The price discrimination that enables arbitrage against users is eliminated by the uniform clearing price.

**Why not Grade 5**: The batch auction still requires a settlement function to be called. Currently, anyone can call `settleBatch()` (permissionless), but the batch mechanism itself is an intermediation structure — orders are collected, processed, and settled rather than executed directly between counterparties. Grade 5 would require direct atomic swaps between willing counterparties, bypassing the batch entirely.

### 8.2 Governance (Grade 0)

Governance is currently the weakest point:

```
Current state:
  50+ onlyOwner functions
  Single admin key controls: pause, blacklist, upgrade, parameter changes
  No timelock, no multisig, no DAO vote required
  Will IS the governance
```

**Why Grade 0**: Every governance action requires Will's private key. If Will's key is compromised, the entire protocol is compromised. If Will is unavailable, no governance action can occur. The protocol is, in governance terms, a centralized service with a decentralized execution layer.

**The path to Grade 4**: This is the most important and most difficult disintermediation in the roadmap. It requires four transitions:

1. **0 → 1**: Transfer to multisig. Multiple keys required. Actions are visible.
2. **1 → 2**: Add timelock. Actions are delayed. Community can react.
3. **2 → 3**: Deploy GovernanceGuard. Shapley veto prevents extraction. The DAO governs within invariants.
4. **3 → 4**: Renounce remaining admin keys. Governance is the only path. Shapley guards the gates.

### 8.3 Price Oracle (Grade 1)

```
Current state:
  Off-chain Python operator runs Kalman filter
  Operator signs price attestations
  On-chain TWAP exists as fallback (5% max deviation)
  Single operator = single point of failure
```

**Why Grade 1**: The oracle operator is transparent (attestations are on-chain, the Kalman filter algorithm is open source), but still required. If the operator goes offline, the protocol falls back to on-chain TWAP, which is less accurate and more manipulable.

**The path to Grade 3**: Multi-source oracle with Shapley-weighted consensus. Multiple independent operators submit attestations. Their weights are determined by their historical accuracy (Shapley marginal contribution to price discovery). A single operator's failure degrades quality but does not halt the system.

---

## 9. Formal Properties

### 9.1 Monotonicity

**Claim**: Under P-001 enforcement, disintermediation grades are monotonically non-decreasing.

**Argument**: P-001 detects extraction by null players. Once detected, the self-correction mechanism reduces payment to the null player to zero. The null player exits. The grade increases. P-001 does not create new intermediaries — it only removes existing ones. Therefore, grades can increase but not decrease under P-001 enforcement.

**Caveat**: This assumes P-001 is not removed or circumvented. If governance could remove P-001, grades could decrease. But P-001 sits above governance (Section 7.2), so this would require a protocol-level compromise, not a governance vote.

### 9.2 Convergence

**Claim**: For any finite set of interactions, the disintermediation process converges to a stable state where all intermediaries are either eliminated or provide genuine marginal value.

**Argument**: At each step, P-001 identifies the intermediary with the lowest Shapley value. If that value is zero (null player), the intermediary is removed. If all remaining intermediaries have nonzero Shapley values, they are genuine contributors, not intermediaries — and the process halts.

The process must converge because:
1. The number of intermediaries is finite.
2. Each step removes at least one intermediary (the null player).
3. No step adds a new intermediary.

### 9.3 The Shapley Null Player Axiom as Disintermediation Engine

The null player axiom states:

```
∀S ⊆ N \ {i}: v(S ∪ {i}) = v(S) ⟹ φᵢ(v) = 0
```

If player `i` adds zero value to every coalition, they receive zero. This is the mathematical foundation of Grades 3 and above. An intermediary who routes but does not create is a null player in the cooperative game of value creation. Shapley assigns them zero. P-001 enforces the assignment. The intermediary starves.

This is not a punishment mechanism. It is an accounting identity. The intermediary receives exactly what they contributed: nothing.

---

## 10. Conclusion

The disintermediation grades are not a marketing classification. They are an engineering measurement: for each protocol interaction, how many humans are required between the two parties who actually want to transact?

The current state is honest: median Grade 1, with governance at Grade 0 and swaps at Grade 4. Most interactions still need Will or a trusted operator. The protocol is early. The cave is still the workshop.

But the roadmap is not a promise — it is a mechanism. P-001, once deployed, does not ask permission to eliminate intermediaries. It measures marginal contribution, pays accordingly, and lets the market decide who survives. Intermediaries who add value will persist at their Shapley-fair compensation. Intermediaries who add nothing will starve.

The four phases are not deadlines. They are grade transitions: 0→2, 1→3, 2→4, 4→5. Each phase removes a class of intermediary. Each removal passes another interaction through the Cincinnatus Test. When every interaction passes at Grade 4 or above, the founder has nothing left to do.

> "I want nothing left but a holy ghost."

The protocol is the ghost. The math is the haunting. The founder returns to his farm.

---

```
Faraday1 (2026). "Disintermediation Grades: The Cincinnatus Roadmap for
Measuring Protocol Sovereignty." VibeSwap Protocol Documentation. March 2026.

Depends on:
  VibeSwap (2026). "Formal Fairness Proofs."
  VibeSwap (2026). "Incentives Whitepaper."
  VibeSwap (2026). "Security Mechanism Design."
  Faraday1 (2026). "The Lawson Constant."
  Faraday1 (2026). "The Three-Token Economy."
```
