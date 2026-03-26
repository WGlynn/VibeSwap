# Liquidity Migration with Shapley Preservation: Protocol Inheritance for the Cincinnatus Endgame

**Author:** Faraday1 (Will Glynn)
**Date:** March 2026
**Version:** 1.0

---

## Abstract

Every protocol upgrade in decentralized finance faces a liquidity cold-start problem. When a new version deploys, liquidity providers must withdraw from the old version, deposit to the new version, and begin accumulating reputation from zero. The Shapley credit they earned through months or years of cooperative participation --- their provable history of marginal contribution --- is abandoned. The old protocol's fairness record is treated as irrelevant. This paper formalizes the Shapley Transcript, an immutable, merkle-committed, on-chain record of all historical Shapley distributions, and defines the Migration Attestation Contract, a contract on the new protocol version that accepts cryptographic proofs of prior Shapley attribution and honors them during a bootstrapping period. Together, these mechanisms make protocol migration a covenant rather than a reset: liquidity providers carry their fairness record forward, the community can fork or upgrade without destroying contribution history, and the Cincinnatus Endgame becomes structurally possible. We prove that the migration protocol preserves Shapley axioms across version boundaries, define a challenge mechanism for excluding compromised distributions, and show that migration is temporal composition --- the same Composition Theorem that guarantees fairness across spatial boundaries guarantees fairness across temporal ones.

> "A protocol that forgets its contributors every time it upgrades is not decentralized. It is amnesiac."

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [The Liquidity Cold-Start Problem](#2-the-liquidity-cold-start-problem)
3. [The Shapley Transcript](#3-the-shapley-transcript)
4. [The Migration Attestation Contract](#4-the-migration-attestation-contract)
5. [Continuity of Identity](#5-continuity-of-identity)
6. [The Migration Protocol](#6-the-migration-protocol)
7. [The Cincinnatus Dependency](#7-the-cincinnatus-dependency)
8. [Handling Compromised History](#8-handling-compromised-history)
9. [Connection to Composable Fairness](#9-connection-to-composable-fairness)
10. [Connection to Disintermediation Grades](#10-connection-to-disintermediation-grades)
11. [Covenants, Not Token Swaps](#11-covenants-not-token-swaps)
12. [Formal Properties](#12-formal-properties)
13. [Worked Example](#13-worked-example)
14. [Risks and Mitigations](#14-risks-and-mitigations)
15. [Conclusion](#15-conclusion)
16. [References](#16-references)

---

## 1. Introduction

### 1.1 The Upgrade Paradox

Decentralized protocols are designed to be immutable. Immutability is the source of their trustworthiness: users interact with code, not with promises, and the code cannot change after deployment. But immutability is also the source of their fragility. Bugs cannot be patched. Parameters cannot be tuned. New features cannot be added. The protocol that was deployed on day one is the protocol that runs on day ten thousand, regardless of what has been learned in the intervening years.

The standard response is upgradeability: proxy patterns, governance-controlled parameter changes, versioned deployments. VibeSwap uses UUPS upgradeable proxies for precisely this reason. But upgradeability has a limit. When the change is architectural --- a new auction mechanism, a revised AMM invariant, a restructured incentive model --- the old contract cannot be patched. A new version must be deployed, and liquidity must migrate.

### 1.2 The Cost of Migration

Migration is expensive. Not in gas fees, though those are nontrivial, but in reputation. A liquidity provider who has participated faithfully in VibeSwap V1 for twelve months has accumulated a Shapley attribution history that reflects their actual marginal contribution to the protocol. They have demonstrated reliability, depth, and consistency. This history is the on-chain proof that they are a cooperative participant rather than a mercenary.

When V2 deploys, that proof vanishes. The LP withdraws from V1, deposits to V2, and arrives as a stranger. Their Shapley credit resets to zero. Their contribution history is stranded on a contract that the community is leaving behind. Every LP faces the same cold start, regardless of whether they contributed for one day or one year.

This is not merely inconvenient. It is structurally unfair. And it violates Shapley axioms in a specific, provable way.

### 1.3 The Contribution of This Paper

This paper:

1. Defines the Shapley Transcript as a first-class protocol artifact.
2. Specifies the Migration Attestation Contract for cross-version Shapley recognition.
3. Formalizes the five-phase migration protocol.
4. Proves that the protocol preserves Shapley axioms across version boundaries.
5. Connects migration to the Cincinnatus Endgame: the founder's ability to walk away depends on the community's ability to upgrade without losing fairness history.

---

## 2. The Liquidity Cold-Start Problem

### 2.1 How Other Protocols Handle Migration

The DeFi ecosystem has seen numerous protocol migrations. The patterns are remarkably consistent in their inadequacy:

| Protocol | Migration Method | What Was Lost |
|----------|-----------------|---------------|
| Uniswap V2 → V3 | Manual withdrawal and redeposit | LP position history, fee-earning record |
| Compound V2 → V3 | Governance proposal, manual migration | Supplier reputation, borrow history |
| Aave V2 → V3 | Migration tool, manual execution | Position tenure, governance weight from participation |
| SushiSwap → V2 | Liquidity mining incentives on new version | Community trust, accumulated governance goodwill |

In every case, the protocol treated migration as a financial operation: move tokens from address A to address B. The contribution history --- the record of who cooperated, who provided deep liquidity during volatile periods, who remained when mercenary capital fled --- was discarded.

### 2.2 Why Incentive-Based Migration Fails

The standard mitigation is liquidity mining: offer elevated rewards on the new version to attract deposits. This approach has three structural problems.

**Problem 1: It rewards the wrong behavior.** Liquidity mining on V2 rewards deposits, not contribution history. A mercenary LP who arrives on day one of V2 receives the same mining rewards as a loyal LP who supported V1 for a year. The incentive is to be fast, not to be reliable.

**Problem 2: It is extractive by construction.** Liquidity mining requires token emissions. Those tokens come from somewhere --- treasury, inflation, or dilution. The protocol pays mercenaries to show up, and the cost is borne by existing holders. This is the opposite of P-001.

**Problem 3: It resets the fairness clock.** Even if the new version computes Shapley values correctly, it starts from epoch zero. The first epoch's distributions are based on zero history. The second epoch has one epoch of history. It takes months before the Shapley computation has enough data to distinguish cooperative from mercenary behavior. During that bootstrapping period, the protocol is vulnerable to the same gaming that Shapley attribution was designed to prevent.

### 2.3 The Root Cause

The root cause is not technical. It is conceptual. Existing protocols treat liquidity as fungible capital and migration as a capital reallocation event. But in a Shapley-fair system, liquidity is not merely capital. It is capital plus contribution history plus cooperative reputation. Migration must preserve all three, or the new version starts in a fairness deficit.

---

## 3. The Shapley Transcript

### 3.1 Definition

The **Shapley Transcript** is the complete, ordered, merkle-committed record of all Shapley distributions ever computed by a protocol version.

Formally, let $T = \{d_1, d_2, \ldots, d_n\}$ be the sequence of distribution events, where each $d_i$ is a mapping from participant addresses to Shapley values:

$$d_i : \mathcal{A} \rightarrow \mathbb{R}_{\geq 0}$$

The transcript is committed to on-chain storage as a Merkle tree, where each leaf is the hash of a single distribution event:

$$\text{leaf}_i = \text{keccak256}(\text{abi.encode}(d_i.\text{epoch}, d_i.\text{participants}, d_i.\text{values}))$$

The Merkle root is stored on-chain at the end of each epoch. The full leaf data may be stored on-chain, in calldata, or in a verified off-chain data availability layer, depending on cost constraints. What matters is that the root is on-chain and the data is reconstructable.

### 3.2 Properties

The Shapley Transcript has four critical properties:

**Immutability.** Once an epoch's distribution is committed, it cannot be altered. The Merkle root is written to contract storage and is part of the blockchain's permanent history. Even if the contract is upgraded or deprecated, the historical state is recoverable from archive nodes.

**Completeness.** Every Shapley distribution event is included. There are no gaps. Each epoch's root references the previous epoch's root, forming a hash chain that makes omission detectable.

**Verifiability.** Any participant can prove their Shapley value for any epoch by presenting a Merkle proof against the corresponding root. Verification is O(log n) in the number of participants per epoch.

**Composability.** The transcript is a self-contained record. It does not depend on the contract's current state, its storage layout, or its execution logic. A transcript from V1 is meaningful to V2 without V2 needing to understand V1's internal implementation.

### 3.3 Epoch Structure

Each epoch in the transcript contains:

```
struct EpochRecord {
    uint256 epochId;            // Sequential epoch number
    bytes32 previousRoot;       // Hash chain link
    bytes32 distributionRoot;   // Merkle root of distributions
    uint256 totalDistributed;   // Sum of all Shapley values (efficiency check)
    uint256 participantCount;   // Number of participants in this epoch
    uint256 timestamp;          // Block timestamp of commitment
    bytes32 protocolVersion;    // Identifies the protocol version
}
```

The `previousRoot` field creates a hash chain across epochs. This chain is the backbone of the transcript: to verify that a transcript is complete, one traces the chain from the most recent epoch back to genesis. Any gap breaks the chain and is immediately detectable.

### 3.4 Storage Considerations

Storing full distribution data on-chain for every epoch is expensive. The transcript design separates commitment from storage:

- **On-chain**: Merkle roots, epoch metadata, and the hash chain. This is compact --- approximately 256 bytes per epoch.
- **Data availability**: Full distribution data (participant addresses and Shapley values) can be stored in calldata (accessible via event logs), on IPFS with content-addressed links, or on a dedicated data availability layer.
- **Reconstruction**: Any participant who needs to prove their historical Shapley value retrieves the relevant distribution data from the DA layer and constructs a Merkle proof against the on-chain root.

This design ensures that the on-chain footprint grows linearly in the number of epochs (not the number of participants), while the full transcript remains provably reconstructable.

---

## 4. The Migration Attestation Contract

### 4.1 Purpose

The Migration Attestation Contract (MAC) is deployed as part of V2 and serves a single function: it accepts Merkle proofs of V1 Shapley distributions and translates them into V2-native Shapley credit.

The MAC does not mint tokens. It does not transfer capital. It does not interact with V1's contracts. It is a pure verification contract that reads Merkle proofs and writes attestation records.

### 4.2 Interface

```solidity
interface IMigrationAttestation {
    /// @notice Submit a merkle proof of V1 Shapley credit
    /// @param epochId The V1 epoch being attested
    /// @param shapleyValue The participant's Shapley value in that epoch
    /// @param merkleProof The proof against V1's committed root
    /// @return attestationId Unique identifier for this attestation
    function attest(
        uint256 epochId,
        uint256 shapleyValue,
        bytes32[] calldata merkleProof
    ) external returns (uint256 attestationId);

    /// @notice Query a participant's total attested V1 Shapley credit
    /// @param participant The address to query
    /// @return totalCredit Sum of all verified V1 Shapley values
    function attestedCredit(address participant) external view returns (uint256 totalCredit);

    /// @notice Challenge an attestation during the challenge period
    /// @param attestationId The attestation to challenge
    /// @param evidence Proof of Shapley axiom violation
    function challenge(uint256 attestationId, bytes calldata evidence) external;
}
```

### 4.3 Verification Logic

When a participant calls `attest()`, the MAC performs the following verification:

1. **Root lookup.** The MAC stores the set of V1 Merkle roots, either copied at deployment or read from a trusted root registry. It verifies that the claimed `epochId` maps to a known root.
2. **Proof verification.** The MAC verifies the Merkle proof against the stored root, confirming that the claimed Shapley value was indeed committed in that epoch.
3. **Identity binding.** The MAC verifies that the caller is the same identity (via SoulboundIdentity, discussed in Section 5) that earned the V1 credit. Address changes between V1 and V2 are permitted as long as the underlying identity is the same.
4. **Replay prevention.** Each (identity, epochId) pair can be attested exactly once. Double-attestation is rejected.
5. **Challenge period.** The attestation enters a challenge period (default: 7 days) during which anyone can dispute it by providing evidence of Shapley axiom violation in the original distribution.

If all checks pass and the challenge period expires without successful challenge, the attestation is finalized and the participant's V2 Shapley credit includes the attested V1 value.

### 4.4 Trust Assumptions

The MAC trusts exactly one thing: that the V1 Merkle roots accurately represent the distributions that occurred. This trust is justified by the on-chain commitment mechanism described in Section 3. The roots are written to V1's contract storage and are part of the blockchain's immutable history. They cannot be retroactively altered.

The MAC does not trust V1's logic, V1's governance, or V1's operators. It trusts only the committed output. If V1's logic was flawed and produced unfair distributions, the challenge mechanism (Section 8) provides recourse.

---

## 5. Continuity of Identity

### 5.1 The Address Problem

Ethereum addresses are not identities. A single person may use multiple addresses across protocol versions. An address rotation between V1 and V2 --- for privacy, security, or operational reasons --- should not sever the connection between a participant's V1 history and their V2 presence.

### 5.2 SoulboundIdentity Tokens

VibeSwap's `SoulboundIdentity` token is a non-transferable, non-fungible token that represents a unique participant identity across chains and protocol versions. The token is:

- **Non-transferable.** It cannot be sent to another address. It is bound to the identity, not the address.
- **Multi-address.** A single SoulboundIdentity can be linked to multiple addresses across multiple chains. Address rotation is a first-class operation.
- **Cross-version.** The same SoulboundIdentity that existed on V1 is recognized on V2. The identity persists even as the protocol evolves.
- **Chain-agnostic.** Via LayerZero messaging, a SoulboundIdentity on Ethereum is the same identity as on Base, Arbitrum, or any other supported chain.

### 5.3 Identity Binding in Migration

During migration, the MAC verifies identity continuity as follows:

1. The participant's V2 address is linked to a SoulboundIdentity.
2. That SoulboundIdentity is verified to be the same identity that earned V1 Shapley credit (via the V1 address linked to the same SoulboundIdentity).
3. The attestation binds the V1 credit to the V2 identity, not to the V1 address.

This means:

- **Address changes are permitted.** A participant can migrate from V1 address `0xABC` to V2 address `0xDEF` as long as both are linked to the same SoulboundIdentity.
- **Identity splitting is not permitted.** A single V1 identity cannot attest credit to multiple V2 identities.
- **Identity merging is not permitted.** Multiple V1 identities cannot attest credit to a single V2 identity.

The one-to-one mapping between identities across versions ensures that Shapley values are neither diluted nor concentrated during migration.

---

## 6. The Migration Protocol

### 6.1 Overview

The migration protocol consists of five phases, executed in strict sequence. Each phase has explicit entry conditions, exit conditions, and failure modes.

### 6.2 Phase 1: Migration Announcement (30-Day Notice)

**Duration:** Minimum 30 days before any on-chain migration action.

**Actions:**
- Governance proposal announces the migration, specifying the reason, the target version, and the timeline.
- The proposal includes the V2 contract addresses (or deployment plan) and the Migration Attestation Contract specification.
- A 30-day discussion and objection period begins.

**Rationale:** Liquidity providers have capital at risk. They deserve advance notice of any structural change. The 30-day minimum is not arbitrary --- it corresponds to the longest standard DeFi lock period and ensures that even time-locked positions can be unwound before migration begins.

**Exit condition:** Governance approval of the migration proposal.

### 6.3 Phase 2: Shapley Transcript Finalization

**Duration:** One epoch after governance approval.

**Actions:**
- The final V1 epoch is computed and committed.
- The complete Shapley Transcript --- all epoch roots, the hash chain, and the total attested Merkle tree --- is finalized.
- A `TranscriptFinalized` event is emitted with the final root and the total epoch count.
- The V1 ShapleyDistributor enters read-only mode. No further distributions are computed.

**Rationale:** Finalization creates a clean boundary between V1 and V2 history. The hash chain from genesis to the final epoch is the complete record. No V1 distributions can be added after finalization, ensuring that the MAC's root set is fixed and verifiable.

**Exit condition:** `TranscriptFinalized` event emitted and confirmed.

### 6.4 Phase 3: V2 Deployment

**Duration:** Variable (depends on deployment complexity).

**Actions:**
- V2 contracts are deployed, including the Migration Attestation Contract.
- The MAC is initialized with the set of V1 Merkle roots (copied from V1's finalized transcript).
- V2's ShapleyDistributor is configured with a bootstrapping mode that incorporates attested V1 credit (see Phase 5).
- V2 contracts are verified on block explorers and audited.

**Rationale:** V2 must be fully deployed and verified before any migration activity begins. The MAC must have the complete V1 root set before it can accept attestations.

**Exit condition:** V2 contracts deployed, verified, and MAC initialized with V1 roots.

### 6.5 Phase 4: Migration Execution

**Duration:** Open-ended (no deadline for individual migration).

**Actions:**
- LPs withdraw their capital from V1. This is a standard withdrawal --- no special migration mechanism is needed.
- LPs deposit their capital to V2. Again, standard deposit.
- LPs call `attest()` on the MAC, presenting Merkle proofs of their V1 Shapley credit for each epoch they participated in.
- Each attestation enters the 7-day challenge period.

**Important design decision:** There is no deadline for migration. An LP who does not migrate immediately is not penalized. Their V1 capital remains withdrawable indefinitely (V1 contracts are not destroyed). Their V1 Shapley credit remains attestable indefinitely (the MAC's root set is permanent). This ensures that no participant is forced to migrate on someone else's timeline.

**Exit condition:** None. Phase 4 remains open permanently. Individual LPs migrate at their own pace.

### 6.6 Phase 5: Bootstrapping Period

**Duration:** Configurable (default: 90 days after V2 deployment).

**Actions:**
- During the bootstrapping period, V2's ShapleyDistributor incorporates attested V1 credit as a weighting factor in new distributions.
- The incorporation is multiplicative, not additive: V1 credit does not generate V2 rewards directly. Instead, it adjusts the cooperative game's characteristic function to recognize that participants with V1 history have demonstrated cooperative behavior.
- Concretely: when computing Shapley values for a V2 epoch, the characteristic function assigns higher marginal contribution to participants whose presence in a coalition is backed by attested V1 credit. This is not a bonus --- it is a more accurate estimate of their actual marginal contribution, informed by historical data.
- After the bootstrapping period ends, V2 has accumulated enough native history that V1 credit is no longer needed. The MAC remains functional (attestations are still verifiable) but V2's ShapleyDistributor no longer consults it for new distributions.

**Rationale:** The bootstrapping period solves the cold-start problem identified in Section 2. Without it, V2's first epochs would treat all participants as identical, ignoring the information embedded in V1's fairness record. With it, V2's early distributions reflect the reality that some participants have a proven track record of cooperation.

**Exit condition:** Bootstrapping period expires. V2 operates independently.

---

## 7. The Cincinnatus Dependency

### 7.1 Why Migration Matters for Founder Independence

The Cincinnatus Endgame, as defined in the companion paper, requires that the protocol can survive and evolve without its founder. Evolution requires upgrades. Upgrades require migration. If migration destroys fairness history, then every upgrade is a crisis that threatens community cohesion and incentive alignment.

In a protocol with founder dependency, the founder can shepherd the community through migration: they can vouch for the new version, coordinate the transition, and use their personal credibility to maintain trust during the uncertainty of the switchover. Without the founder, migration is a coordination problem with no natural Schelling point.

The Shapley Transcript provides that Schelling point. It is an objective, verifiable, cryptographically committed record that does not depend on any individual's credibility. The community does not need the founder to tell them whether V2 is fair --- they can verify that V2 honors V1's fairness record by checking the MAC.

### 7.2 The Fork Scenario

The most critical application of migration is the hostile fork. If VibeSwap's governance is captured, or if the founder's keys are compromised, the community must be able to deploy an independent version that inherits the protocol's fairness history. Without the Shapley Transcript, a fork starts from zero --- the community must re-bootstrap not only liquidity but reputation. With the transcript, the fork inherits the complete fairness record. The community can deploy a new MAC that references the same V1 roots and resume from where V1 left off.

This is the structural guarantee that makes the Cincinnatus Endgame credible. The founder can walk away because the fairness record walks with the community, not with the founder.

### 7.3 The Precondition

Migration with Shapley preservation is not merely a feature of the Cincinnatus Endgame. It is a precondition. Without it, the protocol's fairness is bound to a specific deployment. With it, fairness is portable, and the protocol is genuinely sovereign.

---

## 8. Handling Compromised History

### 8.1 The Problem

What if V1's Shapley distributions were unfair? The Merkle commitment guarantees that the transcript accurately records what was distributed, but it does not guarantee that what was distributed was correct. If V1's ShapleyDistributor had a bug, or if V1's governance was captured and the characteristic function was manipulated, the transcript faithfully records unfair distributions.

Importing unfair distributions into V2 would propagate the unfairness. The MAC must therefore include a mechanism for identifying and excluding compromised distributions.

### 8.2 The Challenge Mechanism

During the 7-day challenge period following each attestation, anyone can submit a challenge. A valid challenge must include:

1. **Identification of the epoch.** Which V1 epoch is alleged to contain unfair distributions.
2. **Axiom violation proof.** Evidence that the distribution violated one or more Shapley axioms:
   - **Efficiency violation:** The sum of distributed values does not equal the total value generated.
   - **Symmetry violation:** Two participants with identical marginal contributions received different values.
   - **Null player violation:** A participant with zero marginal contribution received a nonzero value.
   - **Additivity violation:** The distribution for a compound game does not equal the sum of distributions for its component games.
3. **Reconstructable evidence.** The full distribution data for the challenged epoch, verifiable against the on-chain Merkle root.

### 8.3 Challenge Resolution

Challenges are resolved by an on-chain arbitration mechanism:

- If the challenge provides a valid proof of axiom violation, the attestation for that specific epoch is voided. The participant's attested credit is reduced by the voided epoch's value.
- If the challenge fails (the evidence does not constitute a valid axiom violation), the challenger's bond is forfeited.
- Voiding an epoch's attestation for one participant does not automatically void it for others. Each attestation is challenged and resolved independently.

### 8.4 Systemic Compromise

If an entire range of epochs is compromised (e.g., a bug affected the ShapleyDistributor for epochs 100--200), governance can propose a blanket exclusion. This requires a supermajority vote and a 14-day deliberation period. Blanket exclusions are expected to be rare --- they represent a failure of V1's verification, not a feature of V2's design.

### 8.5 The Unforgeable Guarantee

The challenge mechanism cannot forge history. It can only exclude history. If a distribution was fair, no challenge can succeed against it (because no axiom violation proof exists). If a distribution was unfair, the challenge provides a mechanism for redress. The worst case is over-exclusion --- a fair distribution that is mistakenly challenged and voided. The bond mechanism and the requirement for constructive proof make this unlikely but not impossible. The 14-day governance override provides a final backstop.

---

## 9. Connection to Composable Fairness

### 9.1 Migration as Temporal Composition

The Composition Theorem, as stated in the companion paper on composable fairness, guarantees that if two Shapley-fair mechanisms are composed, the resulting mechanism is also Shapley-fair, provided both satisfy the Independence of Irrelevant Alternatives (IIA) condition.

Migration is composition across time. V1 is a mechanism that operated from time $t_0$ to $t_1$. V2 is a mechanism that operates from $t_1$ onward. The migration protocol composes V1 and V2 by carrying forward V1's fairness record into V2's computation.

The Composition Theorem applies directly:

**Theorem (Migration Preserves Fairness).** Let $M_1$ be a Shapley-fair mechanism operating in $[t_0, t_1]$ and $M_2$ be a Shapley-fair mechanism operating in $[t_1, \infty)$. If both $M_1$ and $M_2$ satisfy IIA, then the composed mechanism $M_1 \circ M_2$, defined by the migration protocol, is Shapley-fair.

**Proof sketch.** IIA requires that a mechanism's output for a participant depends only on that participant's marginal contribution, not on the presence or absence of irrelevant alternatives. The migration protocol uses V1's Shapley values as inputs to V2's characteristic function during the bootstrapping period. Since V1's values were computed under IIA and V2's characteristic function satisfies IIA, the composed computation satisfies IIA. The four Shapley axioms (efficiency, symmetry, null player, additivity) are preserved because the bootstrapping adjustment is multiplicative and does not inject value that was not present in the cooperative game. $\square$

### 9.2 The IIA Condition in Practice

The IIA condition is critical. It means that V2's treatment of a migrating LP depends only on their actual V1 contribution (as recorded in the transcript), not on who else migrates. If Alice migrates and Bob does not, Alice's V2 Shapley credit is the same regardless of Bob's decision. This prevents strategic migration timing --- there is no advantage to migrating first or last.

### 9.3 Spatial and Temporal Composition Unified

The cross-domain Shapley paper addresses spatial composition: computing Shapley values across platform boundaries within a single time period. This paper addresses temporal composition: computing Shapley values across version boundaries within a single platform. The mathematical structure is identical. In both cases, the key requirement is IIA, and the result is that the composed Shapley satisfies the same axioms as the components.

This unification is not coincidental. Spatial composition (across platforms) and temporal composition (across versions) are both instances of the general composition of cooperative games. The Shapley value's additivity axiom is precisely the property that makes composition possible.

---

## 10. Connection to Disintermediation Grades

### 10.1 Migration as a Disintermediation Test

The Disintermediation Grades framework, as defined in the companion paper, assigns a grade from 0 to 5 to each protocol interaction based on the degree of intermediation required. The migration interaction is itself gradeable:

| Grade | Migration Description |
|-------|----------------------|
| **Grade 0** | Founder personally coordinates migration, moves liquidity, vouches for V2 |
| **Grade 1** | Founder deploys V2 and provides migration tooling; LPs must trust founder |
| **Grade 2** | Governance approves migration; founder executes; LPs verify via Merkle proofs |
| **Grade 3** | Governance approves and executes migration; founder involvement optional |
| **Grade 4** | Migration is fully automated; governance approves but execution is permissionless |
| **Grade 5** | Migration occurs without any governance action; V2 self-deploys based on trigger conditions |

### 10.2 Current Target: Grade 4

The migration protocol described in this paper targets Grade 4. The five-phase protocol requires governance approval (Phases 1 and 3) but execution is permissionless: any participant can deploy V2, initialize the MAC, and attest their own credit. No single party controls the migration. The founder's involvement is optional at every stage.

Grade 5 would require fully autonomous versioning --- the protocol detecting the need for an upgrade, generating the new version, deploying it, and migrating liquidity without human intervention. This is aspirational and is not addressed in this paper.

### 10.3 The Self-Inheriting Protocol

At Grade 4+, the protocol inherits itself. The community does not need the founder, a core team, or any privileged party to execute a migration. The Shapley Transcript provides the continuity; the MAC provides the verification; SoulboundIdentity provides the identity binding. The protocol's fairness record is a public good that anyone can read, verify, and honor.

This is what we mean by "the protocol inherits itself." It is not a metaphor. It is a precise description of a protocol whose fairness history is portable, verifiable, and available to any successor version, deployed by anyone, without permission.

---

## 11. Covenants, Not Token Swaps

### 11.1 What Migration Is Not

The migration protocol does not involve token swaps. There is no V1 token that must be exchanged for a V2 token. There is no liquidity pool that bridges old tokens to new tokens. There is no airdrop of V2 tokens to V1 holders.

Token swap migrations are inherently extractive. They create arbitrage opportunities (buy V1 cheap, swap to V2 at a fixed rate), they require the protocol to set an exchange rate (which is a centralized pricing decision), and they conflate capital migration with reputation migration. A participant's V1 tokens represent their capital. Their V1 Shapley credit represents their contribution. These are separate quantities and must be migrated separately.

### 11.2 What Migration Is

Migration is a **covenant**: a binding commitment by V2 to honor V1's fairness record. The commitment is encoded in the Migration Attestation Contract, verified by cryptographic proof, and enforced by the challenge mechanism. No tokens change hands. No exchange rates are set. No arbitrage is possible.

The LP's migration consists of two independent operations:

1. **Capital migration.** Withdraw from V1, deposit to V2. This is a standard financial transaction. The LP moves their capital.
2. **Reputation migration.** Attest V1 Shapley credit to the MAC. This is a cryptographic operation. The LP proves their history.

The two operations are independent. An LP can migrate capital without migrating reputation (they start fresh on V2). An LP can migrate reputation without migrating capital (they attest their V1 history but do not deposit to V2). The covenant structure respects participant autonomy: no one is forced to carry forward their history, and no one is forced to abandon it.

### 11.3 Why This Matters

Token swap migrations bind reputation to capital. If you don't swap your tokens, you lose your history. If you do swap, your history is diluted into a fungible token that does not distinguish cooperative from mercenary participation.

Covenant migrations separate reputation from capital. Your history is proven, not purchased. Your reputation is attested, not traded. The MAC does not care how many tokens you hold --- it cares what your Shapley values were. This is the correct abstraction, and it is the only abstraction compatible with P-001.

---

## 12. Formal Properties

### 12.1 Axiom Preservation

**Theorem 1 (Efficiency Preservation).** If V1's Shapley distributions satisfied the efficiency axiom (all generated value was distributed), then the migration protocol preserves efficiency in V2.

*Proof.* The MAC does not inject value. V1 credit modifies V2's characteristic function weighting but does not add to the total value distributed. V2's efficiency is determined by V2's value generation, which is independent of V1 history. $\square$

**Theorem 2 (Symmetry Preservation).** If two participants have identical V1 Shapley histories and identical V2 marginal contributions, they receive identical V2 Shapley values during and after the bootstrapping period.

*Proof.* The bootstrapping adjustment is a function of attested V1 credit. Identical V1 credit produces identical adjustments. Identical V2 contributions produce identical marginal contributions. By symmetry of the Shapley value, identical inputs produce identical outputs. $\square$

**Theorem 3 (Null Player Preservation).** A participant with zero V1 Shapley credit and zero V2 marginal contribution receives zero V2 Shapley value.

*Proof.* Zero V1 credit contributes zero to the bootstrapping adjustment. Zero V2 contribution produces zero marginal contribution. By the null player property, the Shapley value is zero. $\square$

**Theorem 4 (No Artificial Advantage).** V1 Shapley credit cannot generate V2 Shapley value in the absence of V2 participation.

*Proof.* The bootstrapping adjustment modifies the characteristic function for participants who are active in V2 coalitions. A participant who is not in any V2 coalition has zero marginal contribution regardless of their V1 credit. By the null player property, their V2 Shapley value is zero. V1 credit is not a substitute for V2 participation; it is a modifier of the V2 computation for active participants. $\square$

### 12.2 Incentive Compatibility

**Claim.** The migration protocol is incentive-compatible: no participant benefits from misrepresenting their V1 history.

*Argument.* Overstatement is impossible because Merkle proofs are non-forgeable. Understatement (attesting fewer epochs than earned) reduces the participant's bootstrapping advantage with no compensating benefit. Strategic timing is neutralized by IIA: the benefit of attesting does not depend on when others attest. The dominant strategy is honest, complete attestation.

### 12.3 Sybil Resistance

**Claim.** The migration protocol is Sybil-resistant: splitting a V1 identity into multiple V2 identities does not increase total attested credit.

*Argument.* SoulboundIdentity is non-transferable and non-splittable. Identity splitting requires creating a new SoulboundIdentity, which has no link to V1 history. The one-to-one identity mapping (Section 5.3) ensures that total attested credit per identity is conserved.

---

## 13. Worked Example

### 13.1 Setup

Consider a migration from VibeSwap V1 to V2, with three participants:

- **Alice:** Provided deep liquidity for 100 epochs. Average Shapley value per epoch: 500 VIBE.
- **Bob:** Provided liquidity for 50 epochs. Average Shapley value per epoch: 300 VIBE.
- **Charlie:** New to V2. No V1 history.

### 13.2 Phase 2: Transcript Finalization

V1's ShapleyDistributor commits the final epoch and emits `TranscriptFinalized`. The transcript contains 100 epochs. Alice has Merkle proofs for all 100. Bob has proofs for epochs 51--100.

### 13.3 Phase 4: Migration

Alice withdraws 10,000 USDC from V1, deposits to V2, and calls `attest()` for all 100 epochs. Her total attested V1 credit: 50,000 VIBE.

Bob withdraws 5,000 USDC from V1, deposits to V2, and calls `attest()` for epochs 51--100. His total attested V1 credit: 15,000 VIBE.

Charlie deposits 10,000 USDC to V2. He has no V1 credit to attest.

### 13.4 Phase 5: Bootstrapping

During V2's first epoch, the characteristic function is adjusted:

- Alice's coalition weight reflects her 50,000 VIBE V1 credit + her 10,000 USDC V2 deposit.
- Bob's coalition weight reflects his 15,000 VIBE V1 credit + his 5,000 USDC V2 deposit.
- Charlie's coalition weight reflects his 10,000 USDC V2 deposit only.

The Shapley computation for this epoch treats Alice and Bob as higher-marginal-contribution participants because their historical reliability reduces the uncertainty of their cooperative behavior. Charlie is not penalized --- he receives the Shapley value of his actual marginal contribution. But Alice and Bob receive higher values because the characteristic function, informed by V1 history, assigns higher marginal value to their presence in coalitions.

After 90 days, the bootstrapping period ends. V2 has accumulated enough native history that V1 credit is no longer consulted. Charlie's V2 Shapley credit now reflects 90 days of participation. The playing field is level.

### 13.5 What Changed

Without migration: Alice, Bob, and Charlie start V2 as equals. Alice's 100 epochs of cooperative behavior are forgotten. The characteristic function has no basis for distinguishing reliable from mercenary participants. V2's first 90 days are a free-for-all.

With migration: Alice's history travels with her. The bootstrapping period bridges V1's information into V2's computation. Charlie is not excluded --- he participates fully and earns credit from day one. But Alice's proven reliability is recognized, as it should be.

---

## 14. Risks and Mitigations

### 14.1 Risk: MAC Compromise

**Threat:** If the MAC contract has a bug, attestations could be falsified or valid attestations could be rejected.

**Mitigation:** The MAC is a simple contract --- Merkle proof verification and attestation storage. It has no complex logic, no token transfers, and no external calls. Its attack surface is minimal. Formal verification of the MAC is feasible and recommended.

### 14.2 Risk: V1 Root Tampering

**Threat:** If V1's Merkle roots were manipulated before finalization, the transcript is corrupted at the source.

**Mitigation:** V1 roots are committed to on-chain storage at the end of each epoch. Tampering requires rewriting blockchain history, which is infeasible on any proof-of-stake or proof-of-work chain with sufficient confirmations. The hash chain across epochs provides an additional integrity check.

### 14.3 Risk: Data Availability Failure

**Threat:** If the full distribution data (needed to construct Merkle proofs) is lost, participants cannot attest their credit.

**Mitigation:** Distribution data should be stored in multiple DA layers (calldata, IPFS, Arweave). The protocol should incentivize archival: any participant who maintains a copy of the distribution data can attest for themselves and assist others. The on-chain roots are permanent; only the leaf data requires DA.

### 14.4 Risk: Bootstrapping Manipulation

**Threat:** A participant with high V1 credit could provide minimal V2 liquidity and receive disproportionate V2 Shapley values during bootstrapping.

**Mitigation:** Theorem 4 (Section 12.1) prevents this. V1 credit modifies the characteristic function but does not substitute for V2 participation. A participant with high V1 credit and minimal V2 liquidity has low marginal contribution in V2 coalitions, and the Shapley value reflects this. V1 credit amplifies the signal of V2 participation; it does not replace it.

### 14.5 Risk: Permanent History Lock-In

**Threat:** Participants who performed poorly on V1 might prefer to start fresh, but the migration protocol makes their history permanent.

**Mitigation:** Attestation is voluntary. No participant is required to attest their V1 history. A participant who prefers a fresh start simply does not call `attest()`. Their V1 history remains in the transcript (it is immutable) but is not imported into V2.

---

## 15. Conclusion

### 15.1 Summary

Liquidity migration in DeFi has been treated as a capital reallocation problem. It is, in fact, a fairness preservation problem. The Shapley Transcript and Migration Attestation Contract transform migration from a destructive reset into a constructive inheritance. Contribution history becomes portable. Protocol versions become composable across time. The community's fairness record survives any upgrade, fork, or governance crisis.

### 15.2 The Cincinnatus Connection

The Cincinnatus Endgame requires that the founder's departure does not diminish the protocol. A protocol that can migrate without losing its fairness record does not need a founder to shepherd upgrades. The Shapley Transcript is the protocol's memory; the MAC is the protocol's recognition; SoulboundIdentity is the protocol's continuity. Together, they ensure that fairness is not a property of any particular deployment but a property of the community itself.

### 15.3 The Covenant Principle

> "Your reputation is not stored in a contract. It is proven by a proof."

Migration is a covenant, not a transaction. No tokens are swapped. No exchange rates are set. No intermediary is required. The old protocol commits its fairness record to an immutable transcript. The new protocol reads that transcript through cryptographic verification. The participant's identity bridges the gap. This is protocol inheritance at Grade 4: permissionless, verifiable, and sovereign.

### 15.4 Future Work

- **Grade 5 migration:** Autonomous upgrade detection and self-deployment.
- **Cross-chain transcript aggregation:** Merging Shapley Transcripts from multiple chains into a unified cross-chain history.
- **Transcript compression:** Succinct proofs (SNARKs/STARKs) for attesting entire transcript ranges in a single proof, reducing the per-epoch attestation cost.
- **Retroactive challenge:** Extending the challenge mechanism beyond the 7-day window for systemic issues discovered after finalization.

---

## 16. References

1. Shapley, L. S. (1953). "A Value for n-Person Games." In *Contributions to the Theory of Games*, vol. II, pp. 307--317. Princeton University Press.
2. Faraday1. (2026). "A Cooperative Reward System for Decentralized Networks: Shapley-Based Incentives for Fair, Sustainable Value Distribution." VibeSwap Documentation.
3. Faraday1. (2026). "The Cincinnatus Endgame: Designing a Protocol That Outlives Its Founder." VibeSwap Documentation.
4. Faraday1. (2026). "Disintermediation Grades: A Six-Grade Scale for Measuring Protocol Sovereignty." VibeSwap Documentation.
5. Faraday1. (2026). "Cross-Domain Shapley Attribution: Fair Value Distribution Across Heterogeneous Platforms." VibeSwap Documentation.
6. Faraday1. (2026). "Memoryless Fairness: Structural Fairness as a Mechanism Property, Not a Participant Property." VibeSwap Documentation.
7. Faraday1. (2026). "Formal Fairness Proofs: Mathematical Analysis of Fairness, Symmetry, and Neutrality." VibeSwap Documentation.
8. Merkle, R. C. (1987). "A Digital Signature Based on a Conventional Encryption Function." *CRYPTO '87*, pp. 369--378.
9. Buterin, V. (2014). "A Next-Generation Smart Contract and Decentralized Application Platform." Ethereum White Paper.
10. Adams, H., Zinsmeister, N., & Robinson, D. (2021). "Uniswap v3 Core." Uniswap White Paper.

---

*This document is part of the VibeSwap formal documentation series. For the complete mechanism design, see `VIBESWAP_COMPLETE_MECHANISM_DESIGN.md`. For the Shapley reward system, see `SHAPLEY_REWARD_SYSTEM.md`. For the Cincinnatus Endgame, see `CINCINNATUS_ENDGAME.md`.*
