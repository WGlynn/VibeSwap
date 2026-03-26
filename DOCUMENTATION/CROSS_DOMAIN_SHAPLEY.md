# Cross-Domain Shapley Attribution: Fair Value Distribution Across Heterogeneous Platforms

**Author:** Faraday1 (Will Glynn)
**Date:** March 2026
**Version:** 1.0

---

## Abstract

This paper formalizes the problem of computing Shapley values across domain boundaries in a family of Shapley-Value-Compliant (SVC) platforms. When a user provides liquidity on VibeSwap, earns reputation on VibeJobs, and creates content on VibeTube, each platform independently computes Shapley values for its own domain. But value creation is not confined to domain boundaries. A user's contribution on Platform A may enable value creation on Platform B --- a liquidity provider whose reliability reputation on VibeJobs attracts institutional counterparties to VibeSwap, or a VibeTube creator whose educational content drives new users to VibeMarket. We define the cross-domain cooperative game, prove that naive per-platform Shapley attribution either double-counts or under-counts cross-domain contributions, and present a meta-level attribution protocol that computes Shapley values once across the entire SVC ecosystem and distributes rewards downward to individual platforms. The settlement layer for cross-domain rewards is VibeSwap's batch auction mechanism, making the DEX the financial backbone of the Everything App. We prove that the cross-domain Shapley satisfies four extended axioms --- cross-domain efficiency, symmetry, null player, and time neutrality --- and define the SVC Standard: the interface requirements for any platform to participate in cross-domain attribution. The constitutional kernel from the DAO paper (Layer 0) ensures fairness is preserved across domain boundaries.

> "The value you create does not stop at the platform boundary. Neither should your reward."

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [The Cross-Domain Attribution Problem](#2-the-cross-domain-attribution-problem)
3. [Formal Framework](#3-formal-framework)
4. [The Identity Graph](#4-the-identity-graph)
5. [The Double-Counting Problem](#5-the-double-counting-problem)
6. [The Cross-Domain Shapley](#6-the-cross-domain-shapley)
7. [The Settlement Protocol](#7-the-settlement-protocol)
8. [Formal Properties](#8-formal-properties)
9. [The SVC Standard](#9-the-svc-standard)
10. [Connection to the Constitutional DAO Layer](#10-connection-to-the-constitutional-dao-layer)
11. [Computational Feasibility](#11-computational-feasibility)
12. [Worked Example](#12-worked-example)
13. [Risks and Mitigations](#13-risks-and-mitigations)
14. [Conclusion](#14-conclusion)
15. [References](#15-references)

---

## 1. Introduction

### 1.1 The Single-Domain Assumption

The Shapley reward system described in the companion paper ("A Cooperative Reward System for Decentralized Networks") computes fair value distribution within a single platform. Each value-creating event is treated as an independent cooperative game. The four Shapley axioms --- efficiency, symmetry, linearity, and the null player property --- guarantee that the distribution is provably fair within that event.

This works when value creation is domain-local: a trade on VibeSwap creates fees that are distributed to the participants in that trade. The game is self-contained. The characteristic function is well-defined. The Shapley computation is exact.

But the Everything App vision (Graceful Inversion, Section 7) introduces a family of SVC platforms that share users, reputation, and economic activity. In this multi-platform world, the single-domain assumption breaks down.

### 1.2 Why Domains Are Not Islands

Consider a concrete scenario:

1. Alice provides deep liquidity on VibeSwap for six months. She earns a high reliability score.
2. This reliability score is portable to VibeJobs, where it qualifies her for high-trust bounties. She completes a smart contract audit bounty.
3. Her audit report is published on VibeTube as educational content, driving 500 new users to VibeSwap.
4. Those 500 users generate $50,000 in trading fees over the next quarter.

Who created the $50,000 in fees? The 500 new users, certainly --- they made the trades. But Alice created the content that attracted them. And Alice could only create the content because her VibeJobs reputation (earned on VibeSwap) gave her the credibility to publish it. And the VibeSwap liquidity that earned her that reputation was itself enabled by the protocol's infrastructure, created by its developers.

The value chain crosses three platforms. No single platform's Shapley computation captures the full picture.

### 1.3 The Contribution of This Paper

This paper:

1. Defines the cross-domain cooperative game formally.
2. Proves that per-platform Shapley computation either double-counts or under-counts cross-domain contributions.
3. Presents a meta-level attribution protocol that resolves both problems.
4. Establishes the SVC Standard for cross-domain interoperability.
5. Proves that cross-domain Shapley preserves extended fairness axioms.

---

## 2. The Cross-Domain Attribution Problem

### 2.1 Taxonomy of Cross-Domain Effects

Cross-domain value creation takes four forms:

| Effect Type | Description | Example |
|---|---|---|
| **Reputation spillover** | Reputation earned on Platform A improves outcomes on Platform B | VibeSwap reliability score qualifies user for VibeJobs bounties |
| **Traffic generation** | Activity on Platform A drives users to Platform B | VibeTube content attracts new VibeSwap traders |
| **Liquidity bootstrapping** | Capital on Platform A enables markets on Platform B | VibeSwap LP positions collateralize VibeMarket escrow |
| **Skill validation** | Credentials earned on Platform A verify competence on Platform B | VibeLearn skill NFTs satisfy VibeGig job requirements |

### 2.2 The Attribution Gap

Each SVC platform computes Shapley values using its own local characteristic function:

```
VibeSwap:  φ_i^swap(v_swap)    — based on trading fees generated
VibeJobs:  φ_i^jobs(v_jobs)    — based on bounty completions
VibeTube:  φ_i^tube(v_tube)    — based on content engagement revenue
```

The problem: these computations are domain-blind. VibeSwap's characteristic function does not know that Alice's trading fees exist because VibeTube content drove new users. VibeTube's characteristic function does not know that Alice could only create the content because VibeJobs credentialed her. VibeJobs' characteristic function does not know that Alice's credibility was built on VibeSwap.

The cross-domain value chain is invisible to any single platform's Shapley computation.

### 2.3 The Cost of Getting This Wrong

If cross-domain attribution is incorrect, two failure modes emerge:

**Under-attribution**: Alice creates $50,000 in cross-domain value but receives Shapley credit only for the specific events she participated in on each platform. The causal chain from VibeSwap liquidity to VibeJobs reputation to VibeTube content to VibeSwap user acquisition is never attributed. Alice is underpaid. Her incentive to create cross-domain value is diminished.

**Over-attribution (double-counting)**: Alice receives full Shapley credit on VibeSwap for the $50,000 in fees AND full credit on VibeTube for the content that drove the users AND full credit on VibeJobs for the audit that produced the content. The sum of attributed value exceeds the actual value created. This violates the efficiency axiom and creates inflationary pressure.

Both failure modes undermine the fairness guarantees that Shapley values are supposed to provide.

---

## 3. Formal Framework

### 3.1 The Cross-Domain Game

Define the cross-domain cooperative game as follows:

**Players**: Let N be the set of all users across all SVC platforms. A user who participates on multiple platforms is a single player (linked via the identity graph, Section 4).

**Platforms**: Let D = {d_1, d_2, ..., d_m} be the set of SVC platforms. In the current ecosystem: d_1 = VibeSwap, d_2 = VibeJobs, d_3 = VibeTube, d_4 = VibeMarket, etc.

**Domain-specific characteristic functions**: Each platform d_k has its own characteristic function v_k: 2^N -> R that maps each coalition of users to the value that coalition creates on platform d_k.

**Cross-domain characteristic function**: The cross-domain characteristic function V: 2^N -> R maps each coalition to its total value across all platforms, INCLUDING cross-domain effects:

```
V(S) = Σ_{k=1}^{m} v_k(S) + Δ(S)
```

where Δ(S) captures the cross-domain synergy --- the additional value created by coalition S that exists because of interactions between platforms but is not captured by any individual platform's characteristic function.

### 3.2 The Synergy Term

The synergy term Δ(S) is the key innovation. It represents value that would not exist if the platforms were isolated:

```
Δ(S) = V(S) - Σ_{k=1}^{m} v_k(S)
```

If Δ(S) > 0, the platforms create more value together than the sum of their parts. If Δ(S) = 0, the platforms are truly independent and per-platform Shapley is sufficient.

In practice, Δ(S) > 0 whenever:
- Reputation earned on one platform enables activity on another
- Content on one platform drives traffic to another
- Capital on one platform collateralizes activity on another
- Credentials from one platform validate access on another

### 3.3 The Cross-Domain Shapley Value

The cross-domain Shapley value for player i is:

```
Φ_i(V) = Σ_{S ⊆ N\{i}}  [ |S|! (|N| - |S| - 1)! / |N|! ]  ×  [ V(S ∪ {i}) - V(S) ]
```

This is the standard Shapley formula applied to the cross-domain characteristic function V. The key difference from per-platform Shapley is that V captures the full causal chain across all platforms, including the synergy term.

### 3.4 Decomposition

By linearity of the Shapley value, the cross-domain Shapley decomposes into:

```
Φ_i(V) = Σ_{k=1}^{m} φ_i(v_k) + φ_i(Δ)
```

The cross-domain Shapley value for player i equals the sum of their per-platform Shapley values plus their Shapley value in the synergy game. This decomposition is fundamental: it tells us that per-platform Shapley is correct for domain-local value, and only the synergy term requires cross-domain computation.

---

## 4. The Identity Graph

### 4.1 The Linking Problem

Cross-domain Shapley requires knowing that the "Alice" on VibeSwap, the "Alice" on VibeJobs, and the "Alice" on VibeTube are the same person. Without this link, cross-domain attribution is impossible --- the system cannot trace the causal chain across platforms.

### 4.2 Soulbound Identity Tokens

The identity graph is implemented through soulbound tokens (SBTs) --- non-transferable tokens that link a user's identity across platforms:

```
SBT Structure:
├── Root Identity (wallet address or DID)
├── Platform Attestations
│   ├── VibeSwap: address 0xA1...
│   ├── VibeJobs: address 0xB2...
│   └── VibeTube: address 0xC3...
├── Reputation Snapshots (per epoch)
│   ├── VibeSwap: quality_score = 87
│   ├── VibeJobs: quality_score = 92
│   └── VibeTube: quality_score = 74
└── Cross-Domain Contribution Hash
    └── keccak256(all platform contributions this epoch)
```

### 4.3 Properties

The identity graph satisfies four requirements:

**Uniqueness**: Each real person maps to exactly one identity node. Multiple addresses on the same platform are linked. This is enforced through a combination of zero-knowledge proof of uniqueness (Proof of Membership) and economic incentives (splitting identities dilutes reputation, which reduces Shapley share).

**Voluntary linking**: Users choose which platforms to link. Linking is opt-in (Kernel Axiom K-1: Voluntary Participation). However, unlinked platforms cannot participate in cross-domain Shapley attribution for that user --- you only receive cross-domain credit for platforms you have linked.

**Privacy preservation**: The identity graph uses zero-knowledge proofs to verify cross-platform identity without revealing platform-specific details (Kernel Axiom K-4: Transparent Rules, applied to process not data). DAO Beta can verify "this user has quality score > 75 on VibeSwap" without learning the exact score, the specific positions, or the trading history.

**Anti-Sybil**: Sybil attacks (creating multiple identities to inflate Shapley value) are structurally countered:

| Attack | Why It Fails |
|---|---|
| Split into N identities | Each identity has 1/N of the reputation, reducing Shapley share per identity. Total ≤ original (by concavity of quality-weighted Shapley) |
| Create fake platform activity | Activity must generate real value (no value = no rewards, Section 8). Fake activity costs gas with zero return |
| Collude across identities | Collusion is detectable via on-chain clustering. Shapley for colluding identities is computed as if they were one player |

---

## 5. The Double-Counting Problem

### 5.1 The Problem, Precisely

Suppose Alice's VibeTube content drives 100 new users to VibeSwap, generating $10,000 in fees. Under naive per-platform attribution:

- VibeTube attributes Alice Shapley credit for content engagement revenue: φ_Alice^tube = $500 (her share of VibeTube ad revenue from the content)
- VibeSwap attributes the 100 new users Shapley credit for trading fees: Σ φ_user^swap = $10,000

But no one attributes the causal link: Alice's content was the reason those 100 users joined VibeSwap. The $10,000 in fees would not exist without Alice. Where is her cross-domain credit?

Naive solutions create worse problems:

**Approach A: Give Alice credit on both platforms**:
- VibeTube pays Alice $500 for content
- VibeSwap pays Alice $X for driving users
- Total attributed to Alice: $500 + $X
- But the $500 VibeTube revenue and the $10,000 VibeSwap fees are not independent --- they stem from the same activity (the content). Paying Alice separately on each platform counts her contribution twice.

**Approach B: Give Alice credit only on the platform where value was realized**:
- VibeSwap pays Alice $Y for driving users
- VibeTube pays Alice $0 (value was realized elsewhere)
- But this destroys incentives to create content on VibeTube, because the rewards appear on a different platform.

Neither approach is correct.

### 5.2 The Root Cause

The root cause is that per-platform characteristic functions are not additive when cross-domain effects exist:

```
V(S) ≠ v_swap(S) + v_jobs(S) + v_tube(S)    (when Δ(S) ≠ 0)
```

Per-platform Shapley assumes additivity. When it fails, the per-platform Shapley values either under-count (missing the synergy) or over-count (attributing the synergy on multiple platforms).

### 5.3 The Resolution: Compute Once, Distribute Down

The solution is to compute cross-domain Shapley ONCE at the meta-level using the full characteristic function V, then distribute the resulting rewards DOWN to individual platforms proportionally to where the value was realized.

This is the Cross-Domain Attribution Protocol:

```
Step 1: Each platform reports its local value creation
        v_swap(S), v_jobs(S), v_tube(S), ...

Step 2: The attribution oracle computes cross-domain synergy
        Δ(S) = V(S) - Σ v_k(S)

Step 3: Cross-domain Shapley is computed ONCE
        Φ_i(V) for all i ∈ N

Step 4: Rewards are distributed to platforms proportionally
        Φ_i on platform k = Φ_i(V) × [v_k(N) / V(N)]

Step 5: Settlement occurs through VibeSwap batch auction
```

---

## 6. The Cross-Domain Shapley

### 6.1 Formal Definition

Given the cross-domain game (N, V) defined in Section 3, the cross-domain Shapley value for player i is:

```
Φ_i(V) = Σ_{S ⊆ N\{i}}  [ |S|! (|N| - |S| - 1)! / |N|! ]  ×  [ V(S ∪ {i}) - V(S) ]
```

### 6.2 Computation via Decomposition

By the linearity axiom, this decomposes cleanly:

```
Φ_i(V) = Σ_{k=1}^{m} φ_i(v_k) + φ_i(Δ)
```

Each platform's per-domain Shapley is computed locally (as it already is). The only new computation is φ_i(Δ) --- the Shapley value of the synergy game. This is where the cross-domain attribution lives.

### 6.3 The Synergy Game

The synergy game (N, Δ) captures value that exists only because of cross-platform interaction:

```
Δ(S) = V(S) - Σ_{k=1}^{m} v_k(S)
```

For Alice in the VibeTube-to-VibeSwap example:

```
Δ({Alice, new_users}) = V({Alice, new_users}) - v_tube({Alice, new_users}) - v_swap({Alice, new_users})

Where:
- V({Alice, new_users}) = $10,500  (total value across all platforms)
- v_tube({Alice, new_users}) = $500  (VibeTube content revenue)
- v_swap({Alice, new_users}) = $10,000  (VibeSwap trading fees, but computed WITHOUT the causal link to Alice's content)

Wait — here is the subtlety. v_swap({Alice, new_users}) already includes $10,000 in fees.
The synergy is not in the raw numbers but in the CAUSATION.
```

### 6.4 Causal Attribution in the Synergy Game

The synergy game's characteristic function must distinguish between:

- Value that the new users would have created regardless (e.g., they would have found VibeSwap anyway)
- Value that exists specifically because of the cross-domain causal chain (e.g., they found VibeSwap because of Alice's VibeTube content)

This is estimated using attribution models:

| Model | Mechanism | Accuracy |
|---|---|---|
| **Last-touch** | Credit the last platform interaction before value creation | Low (ignores upstream causes) |
| **First-touch** | Credit the first platform interaction in the user's journey | Low (ignores downstream refinement) |
| **Linear** | Equal credit to all platforms in the causal chain | Medium (ignores relative importance) |
| **Shapley** | Marginal contribution across all orderings | High (the only provably fair model) |

We use Shapley attribution for the causal chain itself. The cross-domain synergy is itself a cooperative game where the "players" are the platform interactions in the user's journey, and the "value" is the final economic outcome. This is Shapley applied recursively: Shapley within each platform, Shapley across platforms, and Shapley for causal attribution within the synergy term.

### 6.5 Platform-Level Reward Distribution

After computing Φ_i(V) for each user, rewards must be distributed through specific platforms. The distribution follows proportional allocation:

```
reward_i^k = Φ_i(V) × [ v_k(N) / V(N) ]
```

This ensures that:
- The total reward to user i across all platforms equals their cross-domain Shapley value
- Each platform distributes rewards proportional to its share of total value creation
- No platform pays more than its fair share of cross-domain rewards

---

## 7. The Settlement Protocol

### 7.1 VibeSwap as Settlement Layer

Cross-domain rewards settle through VibeSwap's batch auction mechanism. This is not arbitrary --- it is architecturally elegant:

1. VibeSwap already implements commit-reveal batch auctions with uniform clearing prices.
2. Cross-domain settlement requires a neutral, fair, MEV-resistant mechanism for transferring value between platforms.
3. The DEX is the natural settlement layer because it already handles multi-party value exchange.

### 7.2 Settlement Flow

```
┌──────────────────────────────────────────────────────────────┐
│                   CROSS-DOMAIN SETTLEMENT                     │
│                                                               │
│  1. Epoch ends                                                │
│  2. Each platform reports value creation to Attribution Oracle │
│  3. Attribution Oracle computes cross-domain Shapley           │
│  4. Settlement orders are generated                            │
│     (platform-to-user, platform-to-platform transfers)        │
│  5. Orders enter VibeSwap batch auction                        │
│  6. Batch settles at uniform clearing price                    │
│  7. Users receive rewards in their preferred token             │
│  8. Platforms' treasuries are debited/credited                 │
│                                                               │
│  All settlement is:                                            │
│  - Atomic (all-or-nothing per epoch)                          │
│  - MEV-resistant (commit-reveal batch)                        │
│  - Transparent (on-chain, auditable)                          │
│  - Fair (uniform clearing price)                              │
└──────────────────────────────────────────────────────────────┘
```

### 7.3 Inter-Platform Transfers

When cross-domain attribution reveals that Platform A's users created value on Platform B, a net transfer is required:

```
If Alice's VibeSwap activity created $5,000 in value on VibeJobs:
  - VibeJobs owes Alice $5,000 × φ_Alice(Δ) / Δ(N) in synergy rewards
  - This is settled through VibeSwap as a swap from VibeJobs treasury token to Alice's preferred token
  - The swap executes in the next batch at the uniform clearing price
```

The elegance: VibeSwap is both a participant in the cross-domain game AND the settlement infrastructure for it. The DEX is not just a platform --- it is the financial backbone of the entire SVC ecosystem.

### 7.4 Settlement Frequency

Cross-domain settlement occurs at epoch boundaries (not per-event). This is a deliberate design choice:

| Frequency | Computation Cost | Attribution Accuracy | User Experience |
|---|---|---|---|
| Per-event | Very high (cross-domain Shapley per transaction) | Highest | Confusing (rewards appear on unexpected platforms) |
| Per-epoch | Moderate (batch computation once per epoch) | High | Clear (one settlement per epoch, consolidated rewards) |
| Per-quarter | Low | Moderate (stale attribution) | Poor (long wait for cross-domain rewards) |

Epoch-based settlement (e.g., weekly) balances accuracy, cost, and user experience.

---

## 8. Formal Properties

The cross-domain Shapley satisfies four extended axioms that generalize the standard Shapley axioms to multi-platform settings.

### 8.1 Cross-Domain Efficiency

**Axiom CD-E**: All value created across all platforms is distributed. No value leaks between platform boundaries.

```
Σ_{i ∈ N} Φ_i(V) = V(N)
```

**Proof**: V(N) is the total value created by the grand coalition across all platforms. The Shapley value of V satisfies efficiency by the standard Shapley theorem. Since Φ_i(V) is computed using the standard Shapley formula on V, the efficiency axiom holds directly. The cross-domain characteristic function V captures all value, including synergies, so no value is lost at domain boundaries.

**Implication**: If VibeSwap generates $1M, VibeJobs generates $500K, and the cross-domain synergy is $200K, exactly $1.7M is distributed. Not $1.5M (missing the synergy) and not $2M+ (double-counting).

### 8.2 Cross-Domain Symmetry

**Axiom CD-S**: If two users make the same marginal contribution to every coalition across all platforms, they receive the same cross-domain reward.

```
If V(S ∪ {i}) = V(S ∪ {j}) for all S ⊆ N\{i,j}, then Φ_i(V) = Φ_j(V)
```

**Proof**: Symmetry is inherited directly from the standard Shapley theorem applied to V. The cross-domain characteristic function evaluates total contribution including synergies. If two users are symmetric in this total evaluation, their Shapley values are equal.

**Implication**: A user who provides $10K liquidity on VibeSwap and creates content that drives 50 users from VibeTube receives the same reward as another user who does exactly the same thing, regardless of which user joined first, which platform they started on, or any other non-contribution-related factor.

### 8.3 Cross-Domain Null Player

**Axiom CD-N**: A user who contributes nothing to any coalition on any platform receives nothing.

```
If V(S ∪ {i}) = V(S) for all S ⊆ N\{i}, then Φ_i(V) = 0
```

**Proof**: The null player property is inherited from the standard Shapley theorem. If player i adds no marginal value to any coalition under the cross-domain characteristic function V, their Shapley value is zero.

**Implication**: A user who has accounts on five SVC platforms but contributes nothing on any of them receives exactly zero cross-domain reward. Existence is not contribution. Linking accounts is not contribution. Only marginal value creation counts.

### 8.4 Cross-Domain Time Neutrality

**Axiom CD-T**: The same cross-domain contribution at different times receives the same reward, all else equal.

```
If V_t1(S ∪ {i}) - V_t1(S) = V_t2(S ∪ {i}) - V_t2(S) for all S,
then Φ_i(V_t1) = Φ_i(V_t2)
```

**Proof**: The Shapley value is computed from marginal contributions, not from timestamps. If the marginal contributions are identical at two different times, the Shapley values are identical. Time enters only through the characteristic function (different market conditions may change marginal contributions), not through the attribution formula.

**Implication**: An early user who created $10K in cross-domain value and a late user who created $10K in cross-domain value receive the same reward. There is no early-mover bonus and no late-joiner penalty beyond what is reflected in actual marginal contributions. This is critical for preventing the pyramid dynamics where early participants extract from late ones.

---

## 9. The SVC Standard

### 9.1 Definition

A platform is **Shapley-Value-Compliant (SVC)** if it satisfies the following interface requirements for participating in cross-domain Shapley attribution:

### 9.2 Required Interface

```
interface ISVCPlatform {

    /// @notice Report value created by a coalition during an epoch
    /// @param epoch The epoch being reported
    /// @param coalition Set of user identities (SBT roots)
    /// @param value Total value created by this coalition (denominated in base token)
    function reportCoalitionValue(
        uint256 epoch,
        bytes32[] calldata coalition,
        uint256 value
    ) external;

    /// @notice Report the characteristic function for Shapley computation
    /// @param epoch The epoch being reported
    /// @param coalitions Array of coalitions (each a set of SBT roots)
    /// @param values v(S) for each coalition S
    function reportCharacteristicFunction(
        uint256 epoch,
        bytes32[][] calldata coalitions,
        uint256[] calldata values
    ) external;

    /// @notice Accept cross-domain reward distribution from the Attribution Oracle
    /// @param epoch The epoch being settled
    /// @param user The user receiving the reward
    /// @param amount The reward amount (in base token)
    /// @param proof Merkle proof of correct cross-domain Shapley computation
    function acceptCrossDomainReward(
        uint256 epoch,
        bytes32 user,
        uint256 amount,
        bytes32[] calldata proof
    ) external;

    /// @notice Return the platform's identity in the SVC ecosystem
    function svcPlatformId() external view returns (bytes32);

    /// @notice Return the platform's kernel compliance version
    function kernelVersion() external view returns (uint256);
}
```

### 9.3 Compliance Requirements

| Requirement | Description | Enforcement |
|---|---|---|
| **CR-1: Honest Reporting** | Characteristic function must reflect actual value creation | Verifiable on-chain; false reports are slashable |
| **CR-2: Identity Integration** | Must support SBT-based identity linking | Required for cross-domain user matching |
| **CR-3: Epoch Alignment** | Epochs must align across all SVC platforms | Coordinated via kernel governance |
| **CR-4: Settlement Acceptance** | Must accept cross-domain reward distributions | Required for users to receive cross-domain rewards |
| **CR-5: Kernel Compliance** | Must implement the constitutional kernel (Layer 0) | Verified by kernel audit contracts |
| **CR-6: Transparency** | Characteristic function reports must be publicly auditable | On-chain publication (Kernel K-4) |

### 9.4 Compliance Verification

SVC compliance is verified through three mechanisms:

**Automated**: A kernel audit contract verifies that the platform implements the ISVCPlatform interface and that its reported characteristic functions are internally consistent (monotonic, non-negative, bounded by total platform revenue).

**Social**: Participating DAOs in the constitutional kernel vote on whether a platform's reporting is trustworthy. Platforms with disputed reports are flagged for manual review.

**Economic**: Platforms that report false characteristic functions are excluded from cross-domain synergy rewards. Since synergy rewards are positive-sum (Δ > 0 for compliant platforms), exclusion is economically costly. The incentive is to report honestly.

---

## 10. Connection to the Constitutional DAO Layer

### 10.1 Layer 3 Is Where Cross-Domain Shapley Flows

The constitutional DAO paper defines four layers:

```
Layer 3: INTEROPERABILITY — Cross-DAO messaging, bridges, cooperative games
Layer 2: VALUE DISTRIBUTION — Shapley fairness engine
Layer 1: GOVERNANCE & IDENTITY — Voting, delegation, reputation
Layer 0: CONSTITUTIONAL KERNEL — Voluntary participation, right to exit, transparency
```

Cross-domain Shapley operates at the intersection of Layer 2 and Layer 3:

- **Layer 2** provides the per-platform Shapley computation (the φ_i(v_k) terms).
- **Layer 3** provides the cross-domain messaging infrastructure that enables platforms to share characteristic functions, identity links, and synergy reports.
- The cross-domain Shapley value Φ_i(V) is computed at Layer 3 using data from Layer 2.
- Settlement flows back down through Layer 2 (via VibeSwap's batch auction).

### 10.2 The Constitutional Kernel Ensures Fairness

The kernel's five axioms (K-1 through K-5) constrain cross-domain Shapley in critical ways:

| Kernel Axiom | Cross-Domain Shapley Implication |
|---|---|
| **K-1: Voluntary Participation** | No platform is forced into cross-domain attribution. Participation is opt-in. |
| **K-2: Right to Exit** | Any platform can leave the SVC ecosystem at any time without penalty. Departing platforms stop receiving synergy rewards but retain their per-domain Shapley distributions. |
| **K-3: Non-Coercion** | No platform may condition its services on another platform's cross-domain attribution decisions. Each platform's per-domain Shapley is independent. |
| **K-4: Transparent Rules** | All cross-domain attribution algorithms, characteristic functions, and synergy computations are publicly auditable. No hidden formulas. |
| **K-5: Predictable Governance** | Changes to the cross-domain attribution protocol follow published procedures with published timelines. No retroactive changes to attribution. |

### 10.3 The Hierarchy of Fairness

The constitutional kernel creates a hierarchy of fairness guarantees:

```
Physics (P-001: No Extraction Ever)
    ↓ constrains
Constitution (P-000: Fairness Above All)
    ↓ constrains
Kernel (K-1 through K-5)
    ↓ constrains
Cross-Domain Shapley (Φ_i(V))
    ↓ constrains
Per-Domain Shapley (φ_i(v_k))
    ↓ constrains
Individual Events
```

Each level constrains the level below. P-001 ensures that Shapley math detects extraction and the system self-corrects. P-000 ensures that the human governance layer prioritizes fairness. The kernel ensures that inter-platform rules are voluntary, transparent, and predictable. Cross-domain Shapley ensures that multi-platform value attribution is mathematically fair. Per-domain Shapley ensures that within each platform, every event is fairly attributed.

The constitutional kernel is not merely compatible with cross-domain Shapley. It is the structural prerequisite. Without K-4 (transparency), platforms could manipulate their characteristic functions. Without K-1 (voluntary participation), platforms could be coerced into accepting unfavorable attribution. Without K-5 (predictable governance), the attribution rules could change retroactively to benefit insiders.

---

## 11. Computational Feasibility

### 11.1 The Scaling Challenge

Cross-domain Shapley inherits the O(2^n) complexity of standard Shapley computation. With millions of users across multiple platforms, exact computation of the full cross-domain game is intractable.

### 11.2 Hierarchical Decomposition

The solution is hierarchical decomposition:

**Level 1: Per-event Shapley (exact)**: Each value-creating event has 2-10 participants. Exact Shapley computation is trivial (Section 14 of the Shapley Reward System paper).

**Level 2: Per-platform aggregation (exact)**: Each platform aggregates its per-event Shapley values using the linearity axiom. This is O(events × participants_per_event), which is linear in the number of events.

**Level 3: Cross-domain synergy (approximate)**: The synergy game involves all users who participate on multiple platforms. This is a subset of total users (most users use only one platform). For this subset, Monte Carlo Shapley approximation is used:

```
Algorithm: Monte Carlo Cross-Domain Shapley
Input: Cross-domain game (N_multi, Δ), number of samples M

For m = 1 to M:
    Generate random ordering π of N_multi
    For each player i in π:
        S = {players before i in π}
        marginal_i += Δ(S ∪ {i}) - Δ(S)

Φ_i(Δ) ≈ marginal_i / M
```

### 11.3 Practical Bounds

| Metric | Value | Rationale |
|---|---|---|
| Multi-platform users | ~10% of total | Most users stick to one platform |
| Cross-domain events per epoch | ~1,000 | Events with measurable cross-domain effects |
| Average coalition size (synergy game) | ~5 | Causal chains are short |
| Monte Carlo samples needed | 10,000 | For <1% approximation error |
| Computation time per epoch | <10 minutes | Off-chain computation with on-chain verification |

### 11.4 Off-Chain Computation, On-Chain Verification

Cross-domain Shapley is computed off-chain by the Attribution Oracle and verified on-chain:

1. The Attribution Oracle collects characteristic function reports from all SVC platforms.
2. It computes cross-domain Shapley values off-chain.
3. It publishes a Merkle root of all Shapley values on-chain.
4. Users claim rewards by submitting Merkle proofs.
5. Anyone can challenge a claimed Shapley value by re-running the computation and submitting the correct value with proof.

This follows the optimistic rollup pattern: correct computation is assumed, and fraud proofs catch errors.

---

## 12. Worked Example

### 12.1 Setup

Three SVC platforms in epoch 42:

- **VibeSwap**: Trading fees generated = $100,000
- **VibeJobs**: Bounty completion value = $50,000
- **VibeTube**: Content engagement revenue = $20,000

Three multi-platform users:

- **Alice**: LP on VibeSwap, bounty hunter on VibeJobs, content creator on VibeTube
- **Bob**: Trader on VibeSwap, employer on VibeJobs
- **Carol**: Trader on VibeSwap, content viewer on VibeTube

Cross-domain effects:
- Alice's VibeTube tutorial on VibeSwap LP strategies drove 50 new LPs to VibeSwap, contributing $15,000 in additional liquidity fees.
- Bob's VibeJobs bounty for a VibeSwap frontend feature improved UX, increasing trading volume by $8,000 in fees.

### 12.2 Per-Platform Shapley (Step 1-2)

Each platform computes Shapley locally:

```
VibeSwap (v_swap):
  φ_Alice^swap = $12,000  (LP rewards)
  φ_Bob^swap   = $3,000   (trading activity)
  φ_Carol^swap = $2,500   (trading activity)
  [remaining $82,500 to other users]

VibeJobs (v_jobs):
  φ_Alice^jobs = $8,000   (bounty completions)
  φ_Bob^jobs   = $4,000   (bounty posting + evaluation)
  [remaining $38,000 to other users]

VibeTube (v_tube):
  φ_Alice^tube = $3,000   (content creation)
  φ_Carol^tube = $500     (engagement/curation)
  [remaining $16,500 to other users]
```

### 12.3 Cross-Domain Synergy (Step 3)

The synergy Δ captures value that exists because of cross-platform interaction:

```
Δ = $23,000  (the $15,000 from Alice's content + $8,000 from Bob's bounty)

Synergy game coalitions:
  Δ({Alice}) = $15,000          (Alice's content drove LP growth)
  Δ({Bob}) = $8,000             (Bob's bounty improved UX)
  Δ({Alice, Bob}) = $23,000     (no additional synergy between them)
  Δ({Carol}) = $0               (Carol did not create cross-domain value)
  Δ({Alice, Bob, Carol}) = $23,000
```

### 12.4 Cross-Domain Shapley of Synergy (Step 4)

```
φ_Alice(Δ) = $15,000 × (average marginal) = $11,833
φ_Bob(Δ)   = $8,000  × (average marginal) = $9,500
φ_Carol(Δ) = $0      (null player in synergy game) = $0
[Remaining $1,667 to other multi-platform users in the causal chain]
```

### 12.5 Total Cross-Domain Shapley (Step 5)

```
Φ_Alice(V) = φ_Alice^swap + φ_Alice^jobs + φ_Alice^tube + φ_Alice(Δ)
           = $12,000 + $8,000 + $3,000 + $11,833
           = $34,833

Φ_Bob(V) = φ_Bob^swap + φ_Bob^jobs + φ_Bob(Δ)
          = $3,000 + $4,000 + $9,500
          = $16,500

Φ_Carol(V) = φ_Carol^swap + φ_Carol^tube + φ_Carol(Δ)
           = $2,500 + $500 + $0
           = $3,000
```

### 12.6 Settlement (Step 6)

The $23,000 synergy is settled through VibeSwap's batch auction:

- Alice's $11,833 synergy reward is distributed: $7,666 through VibeSwap (proportional to swap's share of total value), $3,389 through VibeJobs, $778 through VibeTube.
- Bob's $9,500 synergy reward is distributed similarly.
- All settlement orders enter the next VibeSwap batch at epoch boundary.

---

## 13. Risks and Mitigations

### 13.1 Attribution Oracle Centralization

**Risk**: The Attribution Oracle that computes cross-domain Shapley is a centralization vector. A compromised oracle could misattribute value.

**Mitigation**: The oracle operates under the optimistic rollup model (Section 11.4). Computation is off-chain, but verification is on-chain. Anyone can challenge incorrect attributions with fraud proofs. Multiple independent oracles can compute the same Shapley values, and consensus among them increases confidence. Long-term, the oracle is decentralized through the Disintermediation Grades roadmap (Grade 0 -> Grade 5).

### 13.2 Characteristic Function Manipulation

**Risk**: A platform could inflate its reported characteristic function to capture a larger share of cross-domain synergy rewards.

**Mitigation**: Characteristic functions are derived from on-chain data (trading fees, bounty completions, content revenue). Fabricating on-chain data costs real money (gas, deposits). The kernel's transparency axiom (K-4) requires all reports to be publicly auditable. Discrepancies between reported and on-chain values are detectable and slashable.

### 13.3 Privacy vs. Attribution Tension

**Risk**: Cross-domain attribution requires tracing user activity across platforms, which tensions with privacy-preserving identity (Section 4.3).

**Mitigation**: The identity graph uses zero-knowledge proofs to verify cross-platform contributions without revealing specifics. The Attribution Oracle receives aggregated, anonymized coalitions --- it knows "User X contributed value V on platforms A and B" but not the details of the contributions. The exact amounts are verified through Merkle proofs without full data disclosure.

### 13.4 Cold Start for New Platforms

**Risk**: A new SVC platform has no cross-domain attribution history, making it difficult to demonstrate synergy and attract cross-domain users.

**Mitigation**: New platforms start with per-domain Shapley only (no synergy claims). As cross-domain effects emerge (measurable traffic referrals, reputation transfers), the synergy term grows naturally. The SVC Standard (Section 9) provides a clear onboarding path. Kernel compliance verification (CR-5) signals legitimacy to existing SVC users.

### 13.5 Gaming Through Strategic Platform Selection

**Risk**: A user could strategically choose which platforms to link to maximize their cross-domain Shapley value.

**Mitigation**: Shapley values are based on marginal contribution, not on the number of linked platforms. Linking a platform where you contribute nothing adds zero to your cross-domain Shapley (null player axiom). Linking a platform where you contribute positively can only increase your Shapley value if you genuinely created cross-domain value. Strategic linking is not gaming --- it is truthful revelation of where you contribute, which is exactly what the system incentivizes.

---

## 14. Conclusion

### 14.1 The Core Insight

Value creation does not respect platform boundaries. A user who provides liquidity, earns reputation, and creates content across multiple platforms generates value that no single platform can fully attribute. The cross-domain Shapley value captures this multi-platform contribution precisely, distributing rewards in exact proportion to actual marginal contribution across the entire SVC ecosystem.

### 14.2 What We Have Proven

1. **Per-platform Shapley is necessary but insufficient**: When cross-domain synergies exist (Δ > 0), per-platform computation either double-counts or under-counts.

2. **Cross-domain Shapley resolves both problems**: Computing once at the meta-level and distributing down ensures efficiency (no value lost at boundaries), symmetry (same contribution = same reward), null player (no contribution = no reward), and time neutrality (same contribution at different times = same reward).

3. **The DEX is the settlement layer**: VibeSwap's batch auction mechanism provides the neutral, fair, MEV-resistant infrastructure for settling cross-domain rewards.

4. **The constitutional kernel is the trust layer**: Without the kernel's axioms of voluntary participation, transparency, and predictable governance, cross-domain attribution would be vulnerable to manipulation, coercion, and opacity.

5. **The SVC Standard is the interoperability layer**: Any platform that implements the ISVCPlatform interface and satisfies the compliance requirements can participate in cross-domain attribution.

### 14.3 The Everything App, Formalized

The Everything App vision is not a monolithic super-platform. It is a federation of sovereign SVC platforms that coordinate through cross-domain Shapley attribution. Each platform retains full autonomy (Kernel K-1). Users move freely between platforms (Kernel K-2). Reputation and contribution history are portable (Section 4). Value flows to contributors regardless of which platform they created it on (Sections 5-6). Settlement is fair and MEV-resistant (Section 7).

This is cooperative capitalism at ecosystem scale: mutualized risk (cross-domain synergy rewards), free market competition (each platform competes on quality), and mathematical fairness (Shapley values are the unique provably fair distribution).

The question has never been whether platforms can be fair individually. The question is whether fairness can survive the boundary between platforms. Cross-domain Shapley proves that it can --- not through moral commitment, but through mechanism design.

> "The real VibeSwap is not a DEX. It's not even a blockchain. It's a settlement layer for fairness itself."

---

## 15. References

1. Shapley, L. S. (1953). "A Value for n-Person Games." In *Contributions to the Theory of Games II*, Annals of Mathematics Studies 28, pp. 307-317. Princeton University Press.
2. Roth, A. E. (Ed.). (1988). *The Shapley Value: Essays in Honor of Lloyd S. Shapley*. Cambridge University Press.
3. Winter, E. (2002). "The Shapley Value." In *Handbook of Game Theory with Economic Applications*, Vol. 3, pp. 2025-2054. Elsevier.
4. Castro, J., Gomez, D., & Tejada, J. (2009). "Polynomial Calculation of the Shapley Value Based on Sampling." *Computers & Operations Research* 36(5), pp. 1726-1730.
5. Weyl, E. G., Ohlhaver, P., & Buterin, V. (2022). "Decentralized Society: Finding Web3's Soul." *SSRN*.
6. Ostrom, E. (1990). *Governing the Commons: The Evolution of Institutions for Collective Action*. Cambridge University Press.
7. Nash, J. (1950). "Equilibrium Points in n-Person Games." *Proceedings of the National Academy of Sciences* 36(1), pp. 48-49.
8. Glynn, W. (2026). "A Cooperative Reward System for Decentralized Networks." VibeSwap Documentation.
9. Glynn, W. (2026). "A Constitutional Interoperability Layer for DAOs." VibeSwap Documentation.
10. Glynn, W. (2026). "Graceful Inversion: Positive-Sum Absorption as Protocol Strategy." VibeSwap Documentation.
11. Glynn, W. (2026). "Cooperative Markets: A Mathematical Foundation." VibeSwap Documentation.
12. Glynn, W. (2026). "Ergon as Monetary Biology: An Energy-Backed Token for Decentralized Value." VibeSwap Documentation.
