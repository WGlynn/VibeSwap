# The SVC Standard: Shapley-Value-Compliance as a Universal Platform Interface

**Faraday1 (Will Glynn)**

**March 2026**

**Version 1.0**

---

## Abstract

Every platform extracts. This is not a bug in platform design; it is the business model. The platform provides infrastructure, users create value on that infrastructure, and the platform captures a percentage of the value created. The percentage varies — 30% for app stores, 20% for ride-sharing, 15-25% for marketplaces — but the structure is universal: the platform is a tollbooth on other people's productivity.

This paper defines the **Shapley-Value-Compliance (SVC) Standard**, a formal interface specification that any platform must satisfy to guarantee zero extraction and provably fair value distribution. SVC is to platform economics what ERC-20 is to token interoperability: a minimal, composable interface that enables safe interaction between compliant systems. A platform that implements SVC distributes 100% of generated value to the participants who created it, in proportion determined by Shapley axioms. A platform that does not implement SVC is, by definition, extracting.

We derive five SVC Axioms from the classical Shapley value, define the on-chain interface (`ISVCPlatform`), establish three compliance levels with increasing verification requirements, specify the SVC Registry for on-chain compliance attestation, formalize the cross-domain reward flow between SVC platforms, prove the anti-rent-seeking guarantee, and connect SVC to the Composition Theorem for composable fairness. The result is a standard that makes the Everything App possible: any platform meeting the specification can safely compose with any other, and users are guaranteed that their contributions are never taxed by intermediaries.

> "If the protocol takes a cut, it is not a protocol. It is a landlord."

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [The Five SVC Axioms](#2-the-five-svc-axioms)
3. [The SVC Interface](#3-the-svc-interface)
4. [SVC Compliance Levels](#4-svc-compliance-levels)
5. [The SVC Registry](#5-the-svc-registry)
6. [Cross-Domain Reward Flow](#6-cross-domain-reward-flow)
7. [The Anti-Rent-Seeking Guarantee](#7-the-anti-rent-seeking-guarantee)
8. [Why This Matters](#8-why-this-matters)
9. [Connection to Composable Fairness](#9-connection-to-composable-fairness)
10. [Implementation Path](#10-implementation-path)
11. [Security Considerations](#11-security-considerations)
12. [Conclusion](#12-conclusion)
13. [References](#13-references)

---

## 1. Introduction

### 1.1 The Extraction Problem

Consider the value chain of a typical platform transaction. A driver provides a ride. A passenger pays for it. The platform — Uber, Lyft, or any of their descendants — sits between them and captures 20-30% of the fare. The driver did the work. The passenger paid the price. The platform provided the matching algorithm and the payment rail.

The question that platform economics has never answered honestly is: **what is the matching algorithm actually worth?**

Shapley value theory provides a precise answer. In cooperative game theory, the Shapley value of a player is their average marginal contribution across all possible coalitions. If we model a ride as a cooperative game between the driver, the passenger, and the platform infrastructure, the Shapley value of the infrastructure is exactly the marginal value it adds — no more, no less.

In practice, the infrastructure's marginal contribution is real but bounded. Without the driver, no ride occurs. Without the passenger, no ride occurs. Without the platform, the ride is harder to arrange but not impossible. The platform's Shapley value is positive, but it is nowhere near 25% of every transaction in perpetuity.

The gap between the platform's Shapley value and its actual take rate is extraction. This paper defines a standard that closes that gap to zero.

### 1.2 From Shapley Theory to Platform Standard

The companion papers in the VibeSwap series have established the theoretical foundations:

- **"A Cooperative Reward System for Decentralized Networks"** (the Shapley Reward System paper) formalizes per-event Shapley computation and proves that the five axioms guarantee fair distribution within a single platform.
- **"Cross-Domain Shapley Attribution"** extends the framework across platform boundaries and defines the ISVCPlatform interface for cross-domain interoperability.
- **"Memoryless Fairness"** proves that fairness properties compose across protocols.
- **"The Constitutional DAO Layer"** establishes the governance hierarchy that constrains all Shapley computations.

What is missing is the standard itself: a precise, implementable specification that any platform — not just VibeSwap — can adopt to become Shapley-Value-Compliant. This paper fills that gap.

### 1.3 What SVC Is Not

SVC is not a token standard. It does not specify how tokens are minted, transferred, or burned. SVC is not a governance framework. It does not prescribe how decisions are made. SVC is not a consensus mechanism. It does not dictate how platforms achieve agreement.

SVC is a **value distribution standard**. It specifies, with mathematical precision, how the value created on a platform must be attributed and distributed. Everything else — tokens, governance, consensus — is implementation detail. A platform can use any token, any governance model, any consensus mechanism, and still be SVC-compliant, provided it distributes value according to the five axioms.

---

## 2. The Five SVC Axioms

The five SVC Axioms are derived from the classical Shapley axioms with two extensions (Proportionality and Time Neutrality) that address practical requirements absent from the original formulation. Together, they constitute the necessary and sufficient conditions for a value distribution to be Shapley-fair.

### 2.1 Axiom 1: Efficiency

**Statement.** For any value-creating event with total realized value V, the sum of all participant rewards equals V exactly:

```
∑ᵢ φᵢ = V
```

**Interpretation.** No value is retained by the platform. No value is destroyed. No value is redirected to a treasury, a foundation, a team wallet, or a fee address. Every unit of value that enters the system exits through participant rewards.

**Verification.** On-chain, efficiency is verified by the PairwiseFairness library's `verifyEfficiency` function, which asserts that the sum of all Shapley allocations equals the total distributable value within a bounded tolerance (accounting for integer rounding in fixed-point arithmetic).

**Why it matters.** Efficiency is the axiom that separates SVC from every existing platform. When Uniswap charges a 0.3% fee and distributes it to LPs, it satisfies efficiency for the fee pool. But the protocol fee switch — which diverts a portion to governance token holders — violates efficiency. The value that was created by traders and LPs is redirected to a third party whose marginal contribution to that specific trade was zero. SVC does not permit this.

### 2.2 Axiom 2: Symmetry

**Statement.** If two participants i and j make identical contributions to every coalition, they receive identical rewards:

```
If v(S ∪ {i}) = v(S ∪ {j}) for all S ⊆ N \ {i, j}, then φᵢ = φⱼ
```

**Interpretation.** No participant receives preferential treatment. There are no VIP tiers, no whale bonuses, no insider allocations. If two participants contributed identically, they are rewarded identically.

**Verification.** Symmetry is verified through the PairwiseFairness library's pairwise proportionality check. When two participants have identical weights, the cross-multiplication check reduces to verifying that their rewards are equal within tolerance.

**Why it matters.** Symmetry eliminates the structural advantages that platforms grant to large participants. In traditional finance, institutional traders receive better spreads, faster execution, and rebate structures unavailable to retail. In SVC, the mechanism does not know whether a participant is institutional or retail. It knows only their contribution.

### 2.3 Axiom 3: Null Player

**Statement.** If a participant's marginal contribution to every coalition is zero, their reward is zero:

```
If v(S ∪ {i}) = v(S) for all S ⊆ N, then φᵢ = 0
```

**Interpretation.** No participation trophy. No reward for merely existing, for holding a token, for staking without providing utility. If you did not contribute to the value that was created, you receive none of it.

**Verification.** The PairwiseFairness library handles null players as an edge case: when a participant's weight is zero, the proportionality check asserts that their reward is also zero. Any non-zero reward to a zero-weight participant fails verification.

**Why it matters.** The null player axiom is the formal expression of P-001 (No Extraction Ever). A platform that rewards its token holders from user-generated fees violates the null player axiom — the token holders' marginal contribution to that specific value-creating event was zero, yet they received a reward. SVC makes this structurally impossible.

### 2.4 Axiom 4: Proportionality

**Statement.** For any two participants i and j with non-zero contributions, the ratio of their rewards equals the ratio of their contributions:

```
φᵢ / φⱼ = wᵢ / wⱼ   for all i, j where wᵢ, wⱼ > 0
```

**Interpretation.** Reward is linearly proportional to contribution. No diminishing returns for large contributions. No accelerating returns for small contributions. The mapping from contribution to reward is a straight line through the origin.

**Verification.** This is directly verified by the PairwiseFairness library's `verifyPairwiseProportionality` function via cross-multiplication: `|φᵢ × wⱼ - φⱼ × wᵢ| ≤ ε`. The cross-multiplication formulation avoids division-by-zero edge cases and minimizes rounding error in fixed-point arithmetic.

**Why it matters.** Proportionality is the axiom that prevents platforms from implementing progressive or regressive fee structures that subsidize one class of participant at the expense of another. In a proportional system, a participant who contributes twice as much value receives exactly twice the reward. The linearity is not a design choice — it is a mathematical consequence of the Shapley value for weighted voting games.

### 2.5 Axiom 5: Time Neutrality

**Statement.** Identical contributions made at different times, in events with equal total value and coalition structure, yield identical rewards:

```
If v₁ = v₂ and S₁ = S₂ and wᵢ(t₁) = wᵢ(t₂), then φᵢ(t₁) = φᵢ(t₂)
```

**Interpretation.** The mechanism does not discriminate based on when a contribution was made. An LP providing $10,000 of liquidity in epoch 1 receives the same reward as an LP providing $10,000 of liquidity in epoch 1000, assuming the same event parameters.

**Verification.** Time Neutrality is verified by checking that the Shapley computation uses no time-dependent parameters. The ShapleyDistributor's Track 1 (FEE_DISTRIBUTION) satisfies this by construction: fee distribution uses pure proportional Shapley with no halving multiplier, no tenure bonus, and no early-participant premium.

**Why it matters.** Time Neutrality is what distinguishes SVC from Ponzi-adjacent "early adopter" incentive schemes. Many DeFi protocols offer boosted rewards to early participants that decrease over time. While this may be rational for bootstrapping, it violates Time Neutrality because it pays more for the same work depending on when the work is done. SVC requires that fee distribution — the core value distribution mechanism — be time-neutral.

**Important distinction.** Token emissions (Track 2 in VibeSwap's ShapleyDistributor) are explicitly excluded from the Time Neutrality requirement. Emission schedules, like Bitcoin's halving, are bootstrapping mechanisms that intentionally reward early participation. SVC's Time Neutrality applies to realized value distribution (fees, rewards from actual economic activity), not to protocol-level token issuance.

### 2.6 Axiom Summary

| # | Axiom | Formal Condition | Violation Example |
|---|-------|------------------|-------------------|
| 1 | Efficiency | ∑φᵢ = V | Protocol fee switch diverting value to governance token holders |
| 2 | Symmetry | Equal contributions → equal rewards | VIP tiers, whale bonuses, institutional rebates |
| 3 | Null Player | Zero contribution → zero reward | Staking rewards from user-generated fees without contributing to those fees |
| 4 | Proportionality | φᵢ/φⱼ = wᵢ/wⱼ | Progressive/regressive fee structures, tiered reward rates |
| 5 | Time Neutrality | Same work = same reward regardless of when | Early-adopter fee bonuses, time-decaying reward multipliers |

---

## 3. The SVC Interface

### 3.1 Design Philosophy

The SVC Interface follows the same design philosophy as ERC-20: minimal, composable, and implementation-agnostic. ERC-20 does not specify how tokens are minted or how balances are stored. It specifies the external interface that any compliant token must expose. Similarly, the SVC Interface does not specify how Shapley values are computed internally or how rewards are funded. It specifies the external interface that any compliant platform must expose for interoperability with the SVC ecosystem.

### 3.2 Interface Specification

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ISVCPlatform
 * @notice The Shapley-Value-Compliance interface.
 * @dev Any platform implementing this interface commits to distributing
 *      100% of realized value to contributors via Shapley axioms.
 *
 *      This is the ERC-20 of platform economics: a minimal interface
 *      that enables safe composition between compliant systems.
 */
interface ISVCPlatform {

    // ============ Events ============

    /// @notice Emitted when a contribution is reported
    event ContributionReported(
        address indexed user,
        uint256 value,
        bytes32 indexed category,
        uint256 timestamp
    );

    /// @notice Emitted when rewards are claimed
    event RewardsClaimed(
        address indexed user,
        uint256 amount,
        uint256 epoch
    );

    /// @notice Emitted when a cross-domain attestation is registered
    event ContributionAttested(
        address indexed user,
        bytes32 indexed proof,
        bytes32 sourcePlatform
    );

    // ============ Core Functions ============

    /// @notice Report a user's contribution to the platform
    /// @dev Called by the platform's internal mechanisms (batch settlement,
    ///      fee distribution, etc.) to register value creation.
    ///      The category parameter enables typed contributions (liquidity,
    ///      trading, content, labor, etc.) for Shapley weight computation.
    /// @param user The address of the contributing user
    /// @param value The quantified value of the contribution (base token denomination)
    /// @param category A bytes32 identifier for the contribution type
    function reportContribution(
        address user,
        uint256 value,
        bytes32 category
    ) external;

    /// @notice Query a user's current Shapley weight on this platform
    /// @dev Returns the user's accumulated Shapley weight, which determines
    ///      their share of the next reward distribution. The weight is
    ///      computed from all reported contributions according to the
    ///      platform's Shapley computation engine.
    /// @param user The address to query
    /// @return weight The user's current Shapley weight (PRECISION = 1e18)
    function getShapleyWeight(
        address user
    ) external view returns (uint256 weight);

    /// @notice Claim accumulated Shapley rewards
    /// @dev Transfers the user's pending rewards. The amount is determined
    ///      by the user's Shapley weight relative to all participants in
    ///      settled epochs. Reverts if no rewards are pending.
    /// @param user The address claiming rewards
    /// @return amount The amount of rewards claimed
    function claimRewards(
        address user
    ) external returns (uint256 amount);

    /// @notice Return the hash of the platform's constitutional corpus
    /// @dev The corpus hash commits the platform to a specific set of
    ///      governance rules, fairness axioms, and operational constraints.
    ///      Cross-domain partners verify this hash to ensure constitutional
    ///      alignment before enabling cross-domain reward flow.
    /// @return hash The keccak256 hash of the constitutional corpus
    function getCorpusHash() external view returns (bytes32 hash);

    /// @notice Attest a user's contribution from another SVC platform
    /// @dev Enables cross-domain Shapley attribution. When a user's
    ///      contribution on Platform A creates measurable value on this
    ///      platform, this function registers the cross-domain link.
    ///      The proof parameter contains a Merkle proof or signature
    ///      from the source platform verifying the contribution.
    /// @param user The address whose cross-domain contribution is attested
    /// @param proof The cryptographic proof from the source platform
    /// @return valid Whether the attestation was accepted
    function attestContribution(
        address user,
        bytes32 proof
    ) external returns (bool valid);

    // ============ View Functions ============

    /// @notice Return the platform's unique identifier in the SVC ecosystem
    /// @return id The platform's SVC identifier (registered in the SVC Registry)
    function svcPlatformId() external view returns (bytes32 id);

    /// @notice Return the SVC compliance level (1, 2, or 3)
    /// @return level The platform's current compliance level
    function svcComplianceLevel() external view returns (uint8 level);

    /// @notice Return the total undistributed value pending for the current epoch
    /// @return pending The total value awaiting Shapley distribution
    function pendingDistribution() external view returns (uint256 pending);
}
```

### 3.3 Function Semantics

**`reportContribution`** is the entry point for value creation events. Every time a user performs a value-creating action — executing a trade, providing liquidity, completing a task, publishing content — the platform calls `reportContribution` to register the contribution. The `category` parameter is a bytes32 tag that classifies the contribution type (e.g., `keccak256("LIQUIDITY")`, `keccak256("TRADING")`, `keccak256("CONTENT")`). Categories enable the Shapley computation to weight different contribution types according to their marginal impact on value creation.

**`getShapleyWeight`** exposes the user's current standing in the cooperative game. This is not a balance — it is a weight that determines the user's share of the next distribution. The weight is computed from the user's reported contributions via the platform's internal Shapley engine. External systems (including cross-domain attribution oracles) use this function to query a user's position without needing to understand the platform's internal computation.

**`claimRewards`** executes the actual value transfer. When epochs settle and Shapley values are computed, users accumulate claimable rewards. This function transfers those rewards. The pull-based design (user claims, rather than platform pushes) follows the established pattern in DeFi for gas efficiency and reentrancy safety.

**`getCorpusHash`** is the constitutional alignment check. Before two SVC platforms enable cross-domain reward flow, they verify each other's corpus hash. The corpus is the platform's constitutional document — its equivalent of the VibeSwap Constitutional DAO Layer. Two platforms with aligned corpora can safely compose; platforms with incompatible constitutional commitments cannot. The hash is computed as `keccak256(abi.encodePacked(constitutionalDocument))`.

**`attestContribution`** is the cross-domain bridge. When a user's contribution on Platform A creates measurable value on Platform B, Platform B calls `attestContribution` to register the cross-domain link. The `proof` parameter contains a cryptographic attestation from Platform A — typically a Merkle proof of the user's contribution, signed by Platform A's SVC contract. This function is the mechanism by which value flows across domain boundaries.

---

## 4. SVC Compliance Levels

Not every platform can or should implement the full SVC specification on day one. The standard defines three compliance levels, each building on the previous, to provide a clear adoption path from basic fairness to full cross-domain interoperability.

### 4.1 Level 1: Basic

**Requirements:**
- Implements the ISVCPlatform interface (all functions callable)
- Passes the Efficiency axiom: `∑φᵢ = V` for every distribution event
- Passes the Null Player axiom: zero-contribution participants receive zero reward
- Emits all required events

**What Level 1 proves:** The platform does not extract. Every unit of value created by users is returned to users. No value leaks to a protocol treasury, team allocation, or fee address. This is the minimum bar for SVC compliance.

**Verification method:** Automated. A Level 1 verifier contract checks:
1. The ISVCPlatform interface is implemented (ERC-165 introspection).
2. For a sample of historical distribution events, `∑φᵢ = V` within tolerance.
3. For participants with zero reported contributions, reward is zero.

**What Level 1 does not prove:** It does not verify Symmetry, Proportionality, or Time Neutrality. A Level 1 platform could, in principle, distribute all value but distribute it unfairly — favoring some participants over others. Level 1 guarantees non-extraction. It does not guarantee fairness of the distribution.

### 4.2 Level 2: Standard

**Requirements:**
- All Level 1 requirements
- Passes all five SVC Axioms (Efficiency, Symmetry, Null Player, Proportionality, Time Neutrality)
- On-chain verification via the PairwiseFairness library (or an equivalent verifier)
- Publicly auditable Shapley computation

**What Level 2 proves:** The platform distributes value fairly. Not only does it avoid extraction, but the internal distribution among participants satisfies the Shapley axioms. Equal contributors receive equal rewards. Reward ratios match contribution ratios. The mechanism does not discriminate based on timing.

**Verification method:** On-chain + automated. A Level 2 verifier performs all Level 1 checks plus:
1. Pairwise proportionality: for sampled participant pairs, `|φᵢ × wⱼ - φⱼ × wᵢ| ≤ ε`.
2. Symmetry: for participants with identical weights, `|φᵢ - φⱼ| ≤ ε`.
3. Time Neutrality: for identical contributions in different epochs with equal parameters, `|φᵢ(t₁) - φᵢ(t₂)| ≤ ε`.

**PairwiseFairness integration:** The PairwiseFairness library already deployed in VibeSwap provides the verification primitives. Third-party platforms implementing Level 2 can import this library directly or implement equivalent verification logic that passes the same test vectors.

### 4.3 Level 3: Full

**Requirements:**
- All Level 2 requirements
- Cross-domain attestation enabled (`attestContribution` fully functional)
- Constitutional corpus loaded (`getCorpusHash` returns a non-zero, verifiable hash)
- Registered in the SVC Registry (Section 5)
- Epoch alignment with the SVC ecosystem (coordinated settlement periods)

**What Level 3 proves:** The platform is a full participant in the cross-domain Shapley ecosystem. Its users' contributions can create value on other SVC platforms and receive attribution for it. The platform's constitutional commitments are verifiable. Its compliance is publicly registered.

**Verification method:** On-chain + social + economic. All Level 2 automated checks plus:
1. Corpus hash verification: the constitutional document is published and its hash matches `getCorpusHash()`.
2. Registry verification: the platform's `svcPlatformId()` is registered in the SVC Registry with Level 3 status.
3. Cross-domain test: a test attestation from another Level 3 platform is accepted and correctly processed.
4. Epoch alignment: the platform's epoch boundaries align with the SVC ecosystem's coordinated schedule.

### 4.4 Compliance Level Summary

| Aspect | Level 1 (Basic) | Level 2 (Standard) | Level 3 (Full) |
|--------|-----------------|-------------------|----------------|
| Axioms verified | Efficiency, Null Player | All 5 | All 5 |
| Verification | Automated only | Automated + on-chain | Automated + on-chain + social |
| Cross-domain | No | No | Yes |
| Constitutional corpus | Not required | Not required | Required |
| Registry | Optional | Recommended | Required |
| What it guarantees | Non-extraction | Fair distribution | Cross-domain interoperability |

---

## 5. The SVC Registry

### 5.1 Purpose

The SVC Registry is an on-chain contract that maintains a public, verifiable record of all SVC-compliant platforms. It serves three functions:

1. **Discovery.** Any protocol or user can query the registry to find SVC-compliant platforms.
2. **Verification.** Any protocol can verify another protocol's compliance level by checking the registry.
3. **Coordination.** The registry coordinates epoch alignment, cross-domain attestation routing, and compliance upgrades.

### 5.2 Registry Interface

```solidity
interface ISVCRegistry {

    /// @notice Register a platform in the SVC ecosystem
    /// @param platform The address of the ISVCPlatform contract
    /// @param level The compliance level being claimed (1, 2, or 3)
    /// @param corpusHash The platform's constitutional corpus hash (required for Level 3)
    function register(
        address platform,
        uint8 level,
        bytes32 corpusHash
    ) external;

    /// @notice Query a platform's compliance status
    /// @param platform The address to query
    /// @return level The verified compliance level (0 if not registered)
    /// @return verified Whether the compliance has been independently verified
    /// @return lastAudit The timestamp of the last compliance verification
    function getComplianceStatus(
        address platform
    ) external view returns (uint8 level, bool verified, uint256 lastAudit);

    /// @notice Challenge a platform's compliance (triggers re-verification)
    /// @param platform The address being challenged
    /// @param axiom The specific axiom alleged to be violated (1-5)
    /// @param evidence On-chain evidence of the violation
    function challengeCompliance(
        address platform,
        uint8 axiom,
        bytes calldata evidence
    ) external;

    /// @notice List all registered platforms at a given compliance level
    /// @param level The compliance level to filter by
    /// @return platforms Array of registered platform addresses
    function listPlatforms(
        uint8 level
    ) external view returns (address[] memory platforms);
}
```

### 5.3 Registration Process

**Level 1 registration** is permissionless. Any contract that implements the ISVCPlatform interface can register. The registry verifies interface compliance via ERC-165 and records the registration. Verification is automated and immediate.

**Level 2 registration** requires an on-chain compliance proof. The registering platform submits a set of historical distribution events, and the registry's verification module runs the five-axiom check against the submitted data. If all checks pass, Level 2 status is recorded.

**Level 3 registration** requires Level 2 verification plus constitutional corpus publication, cross-domain attestation testing with at least one existing Level 3 platform, and epoch alignment confirmation. Level 3 registration is the gateway to the cross-domain Shapley ecosystem.

### 5.4 Compliance Challenges

Any address can challenge a registered platform's compliance by submitting on-chain evidence of an axiom violation. A challenge triggers re-verification:

- If the challenge is valid (the evidence demonstrates a genuine axiom violation), the platform's compliance level is downgraded or revoked.
- If the challenge is invalid, it is dismissed. Frivolous challenges are discouraged by requiring a challenge bond that is returned only if the challenge succeeds.

The challenge mechanism ensures that compliance is not a one-time checkbox but a continuous obligation. A platform that was compliant at registration but later introduces extraction (e.g., activating a protocol fee switch) can be challenged and de-registered.

---

## 6. Cross-Domain Reward Flow

### 6.1 The Problem

When a user's contribution on Platform A creates value on Platform B, who pays the user? Platform A did not capture the value — it was created on Platform B. Platform B benefited, but the causal contribution came from Platform A's user. Neither platform's per-domain Shapley computation captures the cross-domain effect.

This is the cross-domain attribution problem formalized in the companion paper ("Cross-Domain Shapley Attribution"). The SVC Standard provides the interface through which the solution is implemented.

### 6.2 The Flow

The cross-domain reward flow proceeds in five stages:

**Stage 1: Contribution reporting.** User Alice provides liquidity on Platform A (VibeSwap). Platform A calls `reportContribution(alice, 10000e18, keccak256("LIQUIDITY"))`.

**Stage 2: Cross-domain effect.** Alice's liquidity enables a deep market that attracts traders from Platform B (VibeJobs, where freelancers earn in tokens and swap them). Platform B observes increased trading volume attributable to Alice's liquidity.

**Stage 3: Cross-domain attestation.** Platform B calls `attestContribution(alice, proof)` where `proof` is a Merkle proof from Platform A verifying Alice's liquidity contribution. Platform B's SVC contract validates the proof against Platform A's state.

**Stage 4: Meta-level Shapley computation.** The Cross-Domain Attribution Oracle (a specialized off-chain computation with on-chain verification) computes the meta-level Shapley value. Using the characteristic functions reported by both platforms, it determines Alice's marginal contribution to the cross-domain coalition. The computation follows the approach described in the Cross-Domain Shapley paper: the synergy term captures the value that exists only because both platforms interact.

**Stage 5: Settlement.** The cross-domain reward is settled through VibeSwap's batch auction mechanism. Platform B's SVC contract transfers Alice's cross-domain reward into the next batch settlement. Alice receives her reward in the same mechanism she uses for trading — no separate claim process, no additional gas costs, no new trust assumptions.

### 6.3 The Settlement Layer

VibeSwap's batch auction serves as the settlement layer for cross-domain rewards. This is not an arbitrary architectural choice. The batch auction provides three properties essential for cross-domain settlement:

1. **Atomic settlement.** All rewards in a batch are settled simultaneously. There is no partial settlement, no ordering dependency, no front-running of cross-domain reward claims.
2. **Uniform clearing price.** Cross-domain rewards denominated in different tokens are exchanged at the batch clearing price, eliminating the need for per-reward price negotiation.
3. **MEV resistance.** The commit-reveal mechanism prevents extractors from front-running cross-domain reward settlements, which would otherwise be predictable (and thus exploitable) transfers.

### 6.4 The Identity Layer

Cross-domain attribution requires cross-domain identity. Alice on Platform A must be recognizable as Alice on Platform B. The SVC Standard does not prescribe a specific identity solution but requires that SVC Level 3 platforms implement compatible identity linking. In practice, this is achieved through:

- **Address identity.** The simplest case: Alice uses the same Ethereum address on both platforms. No additional infrastructure required.
- **SBT-based identity.** For platforms spanning multiple chains or requiring richer identity, soulbound tokens (SBTs) provide a non-transferable identity link. The SBT root serves as the cross-domain identifier.
- **Cryptographic attestation.** For privacy-preserving cross-domain identity, zero-knowledge proofs can attest that the same entity controls accounts on both platforms without revealing which accounts.

---

## 7. The Anti-Rent-Seeking Guarantee

### 7.1 The Guarantee

The anti-rent-seeking guarantee is the simplest and most consequential property of SVC:

> **If `PROTOCOL_FEE_SHARE > 0`, the platform is not SVC-compliant. Period.**

This is not a recommendation. It is not a best practice. It is a hard binary. A platform either distributes 100% of realized value to the participants who created it, or it does not. There is no "mostly SVC-compliant." There is no "SVC-compliant except for a small protocol fee." The axiom of Efficiency requires `∑φᵢ = V`. Any `PROTOCOL_FEE_SHARE > 0` means `∑φᵢ < V`, which violates Efficiency, which disqualifies the platform from SVC compliance at every level.

### 7.2 Formal Statement

Let V be the total value created in an economic event. Let F be the amount retained by the platform (the protocol fee). Let R = V - F be the amount distributed to participants. Then:

```
SVC compliance requires: F = 0
Therefore: R = V
Therefore: ∑φᵢ = V
```

The proof is trivial by construction. The Efficiency axiom requires that the sum of Shapley allocations equals total value. If the platform retains any portion, the sum of Shapley allocations is less than total value. Efficiency is violated. QED.

### 7.3 The Revenue Question

The immediate objection is: "How does the platform sustain itself if it takes no fees?"

This is the right question, and SVC provides a clear answer: **the platform sustains itself through the same Shapley mechanism it uses to reward everyone else.** The platform's infrastructure — its smart contracts, its matching engine, its oracle network, its frontend — is a participant in the cooperative game. Its contribution is reported via `reportContribution`, its Shapley weight is computed via `getShapleyWeight`, and its reward is claimed via `claimRewards`.

The platform earns exactly its Shapley value: the marginal contribution of the infrastructure to the value-creating event. This is typically a small percentage (the infrastructure enables the event but does not perform the economic activity). The platform's revenue is real, non-zero, and provably fair. What it cannot do is set an arbitrary take rate that exceeds its marginal contribution.

In the VibeSwap implementation, revenue flows through auxiliary mechanisms that do not violate the core value distribution: priority auction bids (users voluntarily pay for execution priority), penalty revenues (slashing for invalid reveals), and SVC marketplace fees (value-added services built on top of the core protocol). None of these extract from the base value distribution. They are separate value-creating events with their own Shapley computations.

### 7.4 Why This Disqualifies Most Existing Platforms

Consider the current landscape:

| Platform | Protocol Fee | SVC-Compliant? |
|----------|-------------|----------------|
| Uniswap (fee switch off) | 0% | Potentially (depends on other axioms) |
| Uniswap (fee switch on) | 10-25% of LP fees | No |
| OpenSea | 2.5% marketplace fee | No |
| Uber | 20-30% of fare | No |
| YouTube | 45% of ad revenue | No |
| App Store | 30% of purchases | No |
| VibeSwap | 0% (all fees to LPs) | Yes (Level 2+) |

The table is not meant to shame these platforms. They operate under different economic assumptions and regulatory constraints. The table demonstrates that SVC is a genuinely novel standard — not a rebranding of existing practice but a structural departure from the universal platform business model.

---

## 8. Why This Matters

### 8.1 The Everything App

The Everything App is not a single application. It is a family of interoperable platforms that collectively provide every service a user needs: trading (VibeSwap), employment (VibeJobs), content (VibeTube), commerce (VibeMarket), governance (VibeDAO). The vision is described in the Graceful Inversion paper.

The Everything App requires a universal interface. Without it, each platform is an island. With SVC, every platform speaks the same language of value distribution. A user's contribution on any platform is recognized by every other platform. Rewards flow across boundaries. Reputation compounds across domains. The user's experience is seamless.

SVC is the standard that makes this possible. Not because it imposes uniformity — each platform implements SVC differently, optimized for its own domain — but because it guarantees compatibility. Any two SVC-compliant platforms can safely compose. The Composition Theorem (Section 9) provides the formal guarantee.

### 8.2 The End of Platform Lock-In

Platform lock-in exists because switching costs are high: your reputation, your history, your network effects are trapped in the platform you started on. SVC eliminates lock-in by making contributions portable. If you are an LP on VibeSwap, your Shapley weight is queryable by any SVC platform. If you are a freelancer on VibeJobs, your contribution history is attestable on any SVC platform. You are not locked in because your value follows you.

This is not theoretical. The `attestContribution` function is the concrete mechanism. When Platform B calls `attestContribution(user, proof)` with a proof from Platform A, it is importing the user's contribution history from Platform A. The user did not have to re-earn their reputation. They did not have to start from zero. Their value, attested by the source platform and verified cryptographically, transfers with them.

### 8.3 The Trustless Trust Layer

The SVC Registry provides something that does not exist in the current platform ecosystem: a trustless mechanism for verifying that a platform is not extracting from its users. Today, users trust platforms based on reputation, brand, and regulatory compliance — all of which are imperfect signals. A platform can claim to be fair while quietly siphoning value through opaque fee structures.

SVC makes extraction verifiable. Any user, any competing platform, any regulator can query the SVC Registry, inspect a platform's compliance level, and verify it on-chain. If the platform violates an axiom, anyone can submit a challenge with evidence. The verification is not a promise — it is a mathematical proof executed on-chain.

---

## 9. Connection to Composable Fairness

### 9.1 The Composition Problem

DeFi is composable. Protocols are building blocks. A user might provide liquidity on VibeSwap, use the LP tokens as collateral on a lending protocol, and borrow against them to fund a position on a prediction market. If each protocol is individually fair, is the composition fair?

This is not obvious. Two individually fair mechanisms can compose into an unfair one if the composition introduces new extraction opportunities — for example, if the lending protocol charges a fee on LP-token collateral that effectively taxes the VibeSwap LP's Shapley reward.

### 9.2 The IIA Connection

SVC platforms satisfy the Independence of Irrelevant Alternatives (IIA) property from social choice theory: the relative ranking of two participants' rewards depends only on their relative contributions, not on the contributions of third parties. This is a direct consequence of the Proportionality axiom (Axiom 4): `φᵢ/φⱼ = wᵢ/wⱼ` regardless of any other participant's weight.

IIA is the property that makes composition safe. If Protocol A satisfies IIA and Protocol B satisfies IIA, then the composition of A and B satisfies IIA — adding or removing a third protocol does not change the relative fairness of the remaining two. This is proven formally in the IIA Empirical Verification paper.

### 9.3 The Composition Theorem

**Theorem (Composable Fairness).** The sequential composition of SVC-compliant platforms is SVC-compliant. Formally: if Platform A satisfies all five SVC Axioms and Platform B satisfies all five SVC Axioms, then the composite system (A; B) satisfies all five SVC Axioms.

**Proof sketch.** We verify each axiom for the composition:

1. *Efficiency.* Platform A distributes 100% of its value. Platform B distributes 100% of its value. No value is lost at the composition boundary (the cross-domain attestation mechanism transfers attribution, not value). Therefore the composition distributes 100% of total value.

2. *Symmetry.* Equal contributions to A yield equal rewards from A. Equal contributions to B yield equal rewards from B. Cross-domain attestation preserves equality (identical proofs yield identical attestations). Therefore equal total contributions yield equal total rewards.

3. *Null Player.* Zero contribution to A yields zero reward from A. Zero contribution to B yields zero reward from B. Zero cross-domain attestation (no proof to attest) yields zero cross-domain reward. Therefore zero total contribution yields zero total reward.

4. *Proportionality.* Within each platform, reward ratios equal contribution ratios. Cross-domain rewards are computed via Shapley on the meta-level characteristic function, which also satisfies proportionality. Therefore total reward ratios equal total contribution ratios.

5. *Time Neutrality.* Each platform's fee distribution is time-neutral by assumption. Cross-domain settlement through VibeSwap's batch auction is time-neutral (same batch parameters yield same clearing price). Therefore the composition is time-neutral. ∎

### 9.4 Implications

The Composition Theorem is the formal guarantee that the Everything App is possible. Without it, composing platforms would require per-pair verification — every pair of platforms would need a custom proof that their composition is fair. With it, compliance is modular: verify each platform independently, and the composition is guaranteed fair.

This is the same insight that makes ERC-20 powerful. You do not need to verify that every pair of ERC-20 tokens can be exchanged. You verify that each token satisfies the standard, and interoperability follows. SVC provides the same modularity for fairness.

---

## 10. Implementation Path

### 10.1 Phase 1: VibeSwap (SVC Level 3)

VibeSwap is the reference implementation. It already satisfies all five SVC Axioms through its existing architecture:

| Axiom | VibeSwap Implementation |
|-------|------------------------|
| Efficiency | ShapleyDistributor distributes 100% of fees (Track 1). Zero protocol fee. |
| Symmetry | PairwiseFairness library verifies equal-weight → equal-reward. |
| Null Player | Zero-weight participants receive zero allocation (enforced in PairwiseFairness). |
| Proportionality | Cross-multiplication check: `\|φᵢ × wⱼ - φⱼ × wᵢ\| ≤ ε`. |
| Time Neutrality | Track 1 (FEE_DISTRIBUTION) uses no time-dependent multipliers. |

The ISVCPlatform interface will be extracted from the existing ShapleyDistributor and deployed as a standalone contract that VibeSwap's core contracts implement. The SVC Registry will be deployed on the same chain, with VibeSwap as the first Level 3 registrant.

### 10.2 Phase 2: VibeJobs

VibeJobs — the decentralized labor marketplace — is the first extension. In VibeJobs, the value-creating event is a completed task. The cooperative game involves the client (who posts the bounty), the freelancer (who completes the work), and the platform infrastructure (which provides matching, escrow, and dispute resolution).

SVC compliance for VibeJobs means:
- The client's bounty is distributed 100% to participants (freelancer, reviewers, infrastructure).
- The freelancer's Shapley weight is proportional to the quality and complexity of the work delivered.
- The platform infrastructure earns its Shapley value — the marginal contribution of matching and escrow — not an arbitrary percentage.
- Cross-domain attestation: a freelancer's completed work on VibeJobs is attestable on VibeSwap (enabling reputation-based liquidity tiers) and on VibeTube (enabling credentialed content publishing).

### 10.3 Phase 3: VibeTube

VibeTube — the decentralized content platform — introduces a new contribution type: content creation. The cooperative game involves the creator (who produces content), the audience (whose attention generates value), and the platform infrastructure.

SVC compliance for VibeTube means:
- Ad revenue (or equivalent value) is distributed 100% to content creators and engaged audience members.
- A creator's Shapley weight reflects their content's marginal contribution to platform value (views, engagement, user acquisition).
- The audience's Shapley weight reflects their attention's marginal contribution (ad exposure, social sharing, community building).
- Cross-domain attestation: a creator's audience on VibeTube is attestable on VibeSwap (enabling community-driven liquidity pools) and on VibeJobs (enabling content-credentialed freelancing).

### 10.4 Phase 4: Third-Party Adoption

The SVC Standard is open. Any platform — not just Vibe-branded platforms — can implement it. The standard is published, the interface is permissionless, and the registry is open for registration.

Third-party adoption follows the ERC-20 precedent: early adopters implement the standard because it provides interoperability with an existing ecosystem (the Vibe platforms). As the ecosystem grows, the standard becomes self-reinforcing — non-SVC platforms lose users to SVC platforms because users prefer provable fairness over trust-based promises.

The critical mass threshold is the point at which SVC compliance becomes a competitive necessity rather than a competitive advantage. We estimate this threshold at approximately 10 Level 3 platforms with meaningful cross-domain reward flow, at which point the network effects of cross-domain Shapley attribution make non-compliance economically irrational.

---

## 11. Security Considerations

### 11.1 Sybil Attacks

A malicious actor could create multiple identities to inflate their Shapley weight. The SVC Standard does not prescribe a specific Sybil defense but requires that SVC Level 2+ platforms implement one. VibeSwap uses the ISybilGuard interface, which gates contribution reporting behind identity verification. Third-party platforms may use alternative Sybil defenses (proof of humanity, stake-weighted identity, social graph analysis) provided the defense is effective.

### 11.2 False Contribution Reporting

A platform could inflate its users' contributions to increase cross-domain reward claims. This is mitigated by three mechanisms:
1. **On-chain verifiability.** Contributions are reported on-chain and can be audited against the platform's actual economic activity.
2. **Challenge mechanism.** Any party can challenge a platform's compliance (Section 5.4), triggering re-verification.
3. **Economic incentive.** False reporting, if detected, results in de-registration from the SVC Registry, which cuts off cross-domain rewards — a loss that exceeds the gain from inflation.

### 11.3 Constitutional Corpus Manipulation

A platform could publish a constitutional corpus that appears aligned but contains hidden extraction mechanisms. The corpus hash (`getCorpusHash`) enables detection: the full corpus is published off-chain, its hash is committed on-chain, and any discrepancy is evidence of manipulation. Level 3 compliance requires that the corpus be publicly auditable and that its hash match the on-chain commitment.

### 11.4 Oracle Manipulation

The Cross-Domain Attribution Oracle computes meta-level Shapley values from platform-reported data. If the oracle is compromised, cross-domain rewards can be misdirected. The SVC Standard mitigates this through:
1. **On-chain verification.** The oracle's output is verified against the reported characteristic functions via Merkle proofs.
2. **Redundancy.** Multiple independent oracle implementations can compute the same attribution; divergence signals compromise.
3. **Constitutional constraint.** The oracle operates under the same constitutional corpus as the platforms it serves. P-001 (No Extraction Ever) applies to the oracle itself.

---

## 12. Conclusion

### 12.1 Summary

The SVC Standard defines a minimal, composable interface for platforms that distribute 100% of realized value to the participants who created it. The standard is built on five axioms derived from Shapley value theory (Efficiency, Symmetry, Null Player, Proportionality, Time Neutrality), implemented through a concrete Solidity interface (ISVCPlatform), verified at three compliance levels (Basic, Standard, Full), registered in an on-chain registry (ISVCRegistry), and proven to compose safely via the Composition Theorem.

### 12.2 The Bright Line

SVC draws a bright line in platform economics. On one side: platforms that extract. On the other: platforms that distribute. There is no middle ground. The Efficiency axiom is binary — either `∑φᵢ = V` or it does not. The anti-rent-seeking guarantee is binary — either `PROTOCOL_FEE_SHARE = 0` or it does not.

This binary is intentional. The extraction economy survives on ambiguity — on "reasonable" fee structures, on "competitive" take rates, on "industry standard" commissions. SVC eliminates the ambiguity. A platform is either SVC-compliant or it is extracting. Users deserve to know which.

### 12.3 The Path Forward

VibeSwap is SVC-compliant today. The ShapleyDistributor distributes 100% of trading fees to the participants who created them. The PairwiseFairness library verifies all five axioms on-chain. The cross-domain attestation infrastructure is specified and ready for deployment.

The next step is deployment of the ISVCPlatform interface as a standalone standard, the SVC Registry as a public contract, and the first cross-domain attestation between VibeSwap and the next Vibe platform (VibeJobs). Third-party platforms are invited — and expected — to adopt the standard independently.

The SVC Standard is not a product. It is not a protocol. It is not a token. It is a commitment: the commitment that platforms exist to serve their users, not to extract from them. The mathematics makes the commitment enforceable. The on-chain verification makes it transparent. The Composition Theorem makes it scalable.

> "The standard is simple: give back everything. The math just makes sure you do."

---

## 13. References

1. Shapley, L. S. (1953). "A Value for n-Person Games." *Contributions to the Theory of Games*, Volume II.

2. Glynn, W. (2026). "A Cooperative Reward System for Decentralized Networks." VibeSwap Documentation. — Defines the Shapley reward system and the five axioms for single-domain value distribution.

3. Glynn, W. (2026). "Cross-Domain Shapley Attribution: Fair Value Distribution Across Heterogeneous Platforms." VibeSwap Documentation. — Formalizes cross-domain Shapley computation and the ISVCPlatform interface.

4. Glynn, W. (2026). "The Constitutional DAO Layer." VibeSwap Documentation. — Establishes the four-layer governance hierarchy (Kernel, Governance, Value Distribution, Interoperability).

5. Glynn, W. (2026). "Memoryless Fairness: Structural Fairness as a Mechanism Property, Not a Participant Property." VibeSwap Documentation. — Proves the Composition Theorem for memoryless-fair mechanisms.

6. Glynn, W. (2026). "Economitra: On the False Binary of Monetary Policy." VibeSwap Documentation. — Defines the seven requirements for a cooperative economy.

7. Glynn, W. (2026). "Intrinsically Incentivized Altruism." VibeSwap Documentation. — Defines the three IIA conditions (Extractive Strategy Elimination, Uniform Treatment, Value Conservation).

8. Algaba, E., Bilbao, J. M., & Lopez, J. J. (2001). "A unified approach to restricted games." *Theory and Decision*, 50(4), 333-345. — Foundational work on cooperative games with restricted coalition structures, applicable to cross-domain characteristic functions.

9. Algaba, E., Fragnelli, V., & Sanchez-Soriano, J. (2019). *Handbook of the Shapley Value*. CRC Press. — Comprehensive reference on Shapley value computation, approximation, and applications.

10. ERC-20 Token Standard. Ethereum Improvement Proposal 20. — The precedent for minimal, composable interface standards in decentralized systems.

---

*The SVC Standard is open. The interface is permissionless. The registry is public. The mathematics is verifiable. The only thing a platform must give up to be SVC-compliant is the right to take what it did not earn.*
