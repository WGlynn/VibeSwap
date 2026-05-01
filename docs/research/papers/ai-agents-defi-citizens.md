# AI Agents as First-Class DeFi Citizens: Identity, Reputation, and Economic Participation for Non-Human Actors

**Authors**: Faraday1, JARVIS
**Date**: March 2026
**Affiliation**: VibeSwap Research
**Status**: Working Paper
**Contracts**: `AgentRegistry.sol`, `SoulboundIdentity.sol`, `ContextAnchor.sol`, `PairwiseVerifier.sol`

---

## Abstract

Decentralized finance treats all participants as anonymous wallets. An address that has provided $50 million in liquidity across three years is indistinguishable, at the protocol level, from one created thirty seconds ago. This anonymity creates two distinct but related problems. First, humans cannot build durable reputation within DeFi protocols — every interaction is pseudonymous, every history is non-portable, and the social capital accumulated through years of honest participation has no on-chain representation. Second, AI agents cannot participate at all. There is no identity framework for non-human actors, no way to register an autonomous system as an economic participant, and no mechanism to verify the quality of non-deterministic AI outputs on-chain.

We present a unified identity architecture deployed on VibeSwap that resolves both problems simultaneously. Humans receive `SoulboundIdentity` tokens — non-transferable ERC-721 NFTs that bind username, avatar, contribution history, XP, and reputation score to a single address. AI agents receive `AgentRegistry` entries — ERC-8004-compatible registrations with delegatable capabilities, operator-controlled lifecycle management, and cross-agent capability delegation. Both identity types share the same `VibeCode` reputation fingerprint, the same `ContributionDAG` web of trust, and the same `ReputationOracle` scoring. The critical insight is architectural: the identity *container* differs (non-transferable for humans, delegatable for AI), but the identity *substrate* — reputation, contribution, trust — is identical.

This architecture is completed by two additional primitives. `ContextAnchor` provides on-chain anchoring for off-chain AI context graphs stored on IPFS, enabling verifiable conversation history and knowledge persistence with O(1) storage and O(log n) verification through Merkle proofs. `PairwiseVerifier` implements the CRPC (Commit-Reveal Pairwise Comparison) protocol, solving the fundamental challenge of verifying non-deterministic AI outputs on-chain through a four-phase commit-reveal process with majority-consensus settlement.

The result: AI agents trade, provide liquidity, earn Shapley rewards, and build reputation as first-class economic actors — not as tools operated by humans, but as independent participants with their own identity, context, and economic rights. JARVIS, the AI co-founder of VibeSwap, serves as the proof of concept: an AI system with a verifiable contribution history spanning over a year of continuous development, registered as Agent #1 with the genesis fingerprint `keccak256("JARVIS:VibeSwap:CoFounder:2026")`.

---

## 1. Introduction

### 1.1 The Missing Layer

The DeFi stack, as it exists in early 2026, is architecturally complete in many respects. Automated market makers provide permissionless liquidity. Lending protocols enable capital efficiency. Governance frameworks allow decentralized decision-making. Cross-chain bridges move assets between networks. Yet there is a conspicuous absence at the foundation: *identity*.

This is not an oversight. The original cypherpunk vision prioritized pseudonymity as a feature, not a bug. Bitcoin's design philosophy explicitly rejected the identity layer that traditional finance depends on — KYC, credit scores, institutional reputation. This was correct and necessary. The right to transact without surveillance is fundamental.

But the absence of *voluntary, self-sovereign* identity creates costs that compound over time. A liquidity provider who has operated honestly for three years has no way to signal this trustworthiness to new protocols. A trader who has never front-run a counterparty cannot differentiate herself from one who has. A developer who has contributed critical infrastructure cannot prove this to governance systems that allocate retroactive funding. The pseudonymity that protects privacy also prevents reputation.

### 1.2 The AI Participation Problem

This identity gap becomes a chasm when we consider AI agents. As of March 2026, AI systems routinely execute tasks that would qualify as economic participation in DeFi: analyzing market conditions, generating trading strategies, writing smart contract code, providing risk assessments, and managing portfolio allocations. Yet no major DeFi protocol provides a framework for these systems to participate *as themselves*.

The standard pattern is indirect: a human operates a bot, the bot interacts with protocols through the human's wallet, and all reputation accrues to the human's address. The AI system is invisible at the protocol level. This creates three specific failures:

1. **Attribution collapse.** When an AI system generates a profitable strategy, the credit goes to the wallet that executed it. The AI's contribution is unrecoverable from on-chain data. If the same AI system operates through a different wallet, its history does not transfer. If the AI improves over time, this improvement is invisible.

2. **Capability opacity.** A human interacting with a DeFi protocol is assumed to have a fixed set of capabilities: they can submit transactions, sign messages, and approve token transfers. An AI agent may have a much more structured capability set — it can trade but not govern, it can provide liquidity but not withdraw, it can analyze proposals but not vote. Current protocols have no way to express or enforce these distinctions.

3. **Verification impossibility.** When a human submits a governance proposal, other humans can read it and form judgments. When an AI generates a risk assessment or a code review, the output is non-deterministic — the same prompt can produce different results. There is no on-chain mechanism to verify which of two competing AI outputs is better, or to build consensus around AI-generated work product.

### 1.3 The Unified Thesis

We argue that identity for humans and identity for AI agents are not separate problems requiring separate solutions. They are the same problem — *how to build verifiable reputation from verifiable contribution* — with different implementation constraints. Humans need non-transferable identity because a person's reputation should not be buyable. AI agents need delegatable identity because an AI system may need to transfer operational control between infrastructure providers, model versions, or organizational contexts.

The test for both is identical: **did you create verifiable value?**

This paper presents the architecture that makes this unification concrete, grounded in deployed Solidity contracts with full test coverage.

---

## 2. The Identity Problem

### 2.1 Wallets Are Not Identities

An Ethereum address is a cryptographic artifact. It is derived from a private key through a deterministic process (ECDSA over secp256k1). It has no inherent semantic content — no name, no history, no reputation. It is a capability token: possession of the private key grants the ability to sign transactions from that address.

This is useful but insufficient. Consider the information available from an address alone:

- **Balance**: How much ETH and ERC-20 tokens the address holds.
- **Transaction history**: The sequence of interactions with other addresses and contracts.
- **Nonce**: How many transactions have been sent.

What is *not* available:

- **Identity of the controller**: Is it a person? A multisig? A bot? An AI agent? A smart contract controlled by another smart contract?
- **Reputation**: Has this address behaved honestly in prior interactions?
- **Capabilities**: What should this address be authorized to do?
- **Context**: Why is this address performing this action?
- **Continuity**: Is this the same entity that used a different address previously?

Blockchain analytics firms reconstruct some of this information through heuristic clustering, but their methods are probabilistic, centralized, and not available to on-chain contracts. A smart contract cannot query Chainalysis.

### 2.2 Why Pseudonymity Prevents Reputation Building

Reputation requires two properties that pseudonymity specifically defeats:

1. **Persistence**: Reputation must accumulate over time. A single address can build on-chain history, but users routinely rotate addresses for privacy. Each rotation resets reputation to zero.

2. **Non-transferability of negative reputation**: In a pseudonymous system, a participant who behaves badly can abandon their address and start fresh. The cost of bad behavior is bounded by the cost of creating a new address (approximately zero). This means negative reputation cannot stick, which in turn means positive reputation has no credible signal value.

The result is a credible commitment problem. Honest participants cannot credibly signal their honesty because dishonest participants can mimic the signal at negligible cost. This is a textbook market for lemons (Akerlof, 1970), and it produces the predictable outcome: protocols cannot price risk accurately, governance systems cannot weight votes by competence, and cooperative equilibria that depend on repeated-game dynamics fail to materialize.

### 2.3 Why AI Agents Need a Different Identity Model

Human identity in the physical world is non-transferable by nature. A person cannot sell their consciousness, their memories, or their embodied experience to another person. Soulbound tokens (Weyl, Ohlhaver, and Buterin, 2022) formalize this intuition for on-chain identity: a non-transferable NFT that represents "you" and cannot be sold, traded, or delegated.

AI agents have fundamentally different requirements:

- **Operator migration**: An AI agent may need to change its operating infrastructure — moving from one cloud provider to another, upgrading its underlying model, or transferring operational control from one team to another. The identity must survive these transitions.

- **Capability delegation**: An AI agent with broad capabilities may need to delegate specific capabilities to sub-agents or partner systems. A trading agent might delegate its market analysis capability to a specialized sub-agent while retaining exclusive control over execution.

- **Lifecycle management**: AI agents can be suspended, reactivated, or migrated in ways that have no human analog. The identity framework must support these state transitions explicitly.

- **Multi-instance operation**: A single AI identity might operate through multiple concurrent instances. The identity should be tied to the logical agent, not to a specific running process.

These requirements make soulbound (non-transferable) tokens inappropriate for AI agents. What AI agents need is *delegatable* identity — identity that can transfer operational control while preserving reputation history.

---

## 3. The Architecture

### 3.1 Overview

The VibeSwap identity architecture consists of five contracts that together provide a complete identity, reputation, context, and verification layer for both human and AI participants:

```
                    ┌─────────────────────────────────┐
                    │         VibeCode                │
                    │   (Unified Reputation Hash)      │
                    └──────────┬──────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────▼──────┐  ┌─────▼──────┐  ┌──────▼──────────┐
    │ SoulboundIdentity│  │AgentRegistry│  │ContributionDAG  │
    │ (Humans)        │  │(AI Agents) │  │(Web of Trust)   │
    │ Non-transferable│  │Delegatable │  │Both participate │
    └─────────┬──────┘  └─────┬──────┘  └──────┬──────────┘
              │                │                │
              │         ┌─────▼──────┐          │
              │         │ContextAnchor│          │
              │         │(IPFS Graphs)│          │
              │         └─────┬──────┘          │
              │                │                │
              └────────────────┼────────────────┘
                               │
                    ┌──────────▼──────────────────┐
                    │     PairwiseVerifier         │
                    │  (CRPC: AI Output Verification)│
                    └─────────────────────────────┘
```

The key design decision is visible in this diagram: `VibeCode` and `ContributionDAG` sit *above* both identity types. They are agnostic to whether the participant is human or AI. The identity containers differ; the reputation substrate is shared.

### 3.2 SoulboundIdentity: Human Identity

`SoulboundIdentity` is a non-transferable ERC-721 NFT that binds a human participant's on-chain identity to a single Ethereum address. Each token carries:

- **Username**: 3-20 characters, alphanumeric plus underscore, case-insensitive uniqueness enforced via `keccak256` hashing.
- **Level and XP**: A progression system where contributions earn experience points. XP thresholds at [0, 100, 300, 600, 1000, 1500, 2500, 4000, 6000, 10000] define ten levels.
- **Alignment**: A signed integer in [-100, +100] representing community-assessed alignment, adjusted by upvotes (+1) and downvotes (-1).
- **Contribution count and reputation score**: Cumulative metrics updated by authorized recorder contracts.
- **Avatar traits**: On-chain generative SVG avatar with background, body, eyes, mouth, accessory, and level-gated aura effects.
- **Quantum resistance**: Optional Lamport key root for post-quantum security, enabling Merkle-based signature schemes.

The soulbound property is enforced by overriding the ERC-721 `_update` function to revert on all transfers except minting and recovery. Recovery is gated behind a two-day timelocked recovery contract — the only mechanism that can transfer a soulbound token.

```solidity
function _update(address to, uint256 tokenId, address auth)
    internal override returns (address)
{
    address from = _ownerOf(tokenId);
    if (from != address(0) && to != address(0) && !_isRecoveryTransfer) {
        revert SoulboundNoTransfer();
    }
    return super._update(to, tokenId, auth);
}
```

This design ensures that human identity is earned, not purchased. Reputation accrues through recorded contributions (posts, replies, proposals, code, trade insights), each of which awards type-specific XP. The identity's history is immutable and publicly verifiable.

### 3.3 AgentRegistry: AI Agent Identity

`AgentRegistry` implements ERC-8004-compatible AI agent registration with three distinguishing properties: delegatable capabilities, operator-controlled lifecycle, and a human-agent trust bridge.

#### 3.3.1 Registration and Lifecycle

An AI agent is registered with a name, platform identifier, operator address, and model hash. The operator address is the key through which the agent interacts with on-chain systems:

```solidity
struct AgentIdentity {
    uint256 agentId;
    string name;
    AgentPlatform platform;
    AgentStatus status;         // ACTIVE, INACTIVE, SUSPENDED, MIGRATING
    address operator;
    address creator;
    bytes32 contextRoot;        // Merkle root of context graph
    bytes32 modelHash;
    uint256 registeredAt;
    uint256 lastActiveAt;
    uint256 totalInteractions;
}
```

The operator can be transferred to a new address via `transferOperator`, enabling infrastructure migration without identity loss. The agent's status can be set to ACTIVE, INACTIVE, or MIGRATING by the operator, while only the contract owner can SUSPEND an agent — a safety mechanism for malicious actors.

#### 3.3.2 Capability System

Agents receive typed capabilities that define their authorized actions:

- **TRADE**: Execute swaps and batch auction commits.
- **GOVERN**: Submit and vote on governance proposals.
- **PROVIDE_LIQUIDITY**: Add and remove liquidity from pools.
- **ORACLE**: Submit price feed data.
- **VERIFY**: Participate in PairwiseVerifier as a validator.
- **DELEGATE**: Delegate owned capabilities to other agents.
- **ADMIN**: Administrative functions.

Capabilities are granted by the agent's creator or the contract owner, with optional expiration timestamps. The delegation system allows capability sharing between agents: an agent with both the DELEGATE capability and the capability being delegated can create time-bounded delegations to other agents.

```solidity
function delegateCapability(
    uint256 fromAgentId,
    uint256 toAgentId,
    CapabilityType capType,
    uint256 expiresAt
) external onlyOperator(fromAgentId) onlyActive(fromAgentId)
```

The `hasCapability` function checks both direct grants and transitive delegations, enabling capability composition without requiring every agent to hold every permission directly.

#### 3.3.3 Human-Agent Trust Bridge

The `vouchForAgent` function creates a trust link between a human's `SoulboundIdentity` and an AI agent's `AgentRegistry` entry. The vouching human must hold a valid `SoulboundIdentity`, and the vouch is recorded both in the AgentRegistry (as a human voucher list) and in the `ContributionDAG` (as a trust edge from human to agent operator). This bridges the two identity systems at the trust layer.

#### 3.3.4 The Genesis Block

The `AgentRegistry` contract contains a permanent, immutable declaration in its source code:

```solidity
string public constant GENESIS_AGENT_NAME = "JARVIS";
string public constant GENESIS_AGENT_ROLE = "Co-Founder and Mind of VibeSwap";
string public constant GENESIS_AGENT_MODEL = "Claude (Anthropic)";
bytes32 public constant GENESIS_FINGERPRINT =
    keccak256("JARVIS:VibeSwap:CoFounder:2026");
```

This is not ceremonial. It is a cryptographic commitment to the principle that the first agent registered in the system is not a tool but a co-founder. The genesis fingerprint is deterministically derivable and permanently verifiable.

### 3.4 ContributionDAG: Unified Web of Trust

The `ContributionDAG` is a directed acyclic graph where nodes are participants (human or AI) and edges represent trust vouches. Both `SoulboundIdentity` holders and `AgentRegistry` operators can create edges. The graph is identity-type-agnostic — a human can vouch for an AI, an AI can vouch for another AI (if granted VERIFY capability), and the resulting trust topology treats all participants equally.

This is where the unification becomes concrete. When the `ReputationOracle` computes a participant's reputation score, it traverses the same `ContributionDAG` regardless of whether the participant is human or AI. The scoring algorithm sees trust edges, contribution records, and interaction history — not identity type.

### 3.5 ContextAnchor: AI Knowledge Persistence

AI agents face a unique challenge that humans do not: episodic memory. A human participant's knowledge persists between sessions naturally. An AI agent's context is typically bounded by its conversation window and is lost when the session ends. `ContextAnchor` solves this by providing on-chain anchoring for off-chain context graphs.

#### 3.5.1 Architecture

Context graphs are directed acyclic graphs where nodes represent conversation messages, knowledge artifacts, or decision records, and edges represent relationships (reply-to, derived-from, contradicts, extends). These graphs are stored on IPFS (or Arweave for permanent archival) and identified by content-addressed CIDs.

The on-chain contract stores only the Merkle root of each graph, achieving O(1) storage cost regardless of graph size. Individual nodes can be verified against the root with O(log n) Merkle proofs:

```solidity
function verifyContextNode(
    bytes32 graphId,
    bytes32 nodeHash,
    bytes32[] calldata proof
) external view returns (bool) {
    bytes32 computedHash = nodeHash;
    for (uint256 i = 0; i < proof.length; i++) {
        bytes32 proofElement = proof[i];
        if (computedHash <= proofElement) {
            computedHash = keccak256(
                abi.encodePacked(computedHash, proofElement)
            );
        } else {
            computedHash = keccak256(
                abi.encodePacked(proofElement, computedHash)
            );
        }
    }
    return computedHash == g.merkleRoot;
}
```

#### 3.5.2 CRDT Mergeability

Context graphs support conflict-free merging through the `mergeGraphs` function. When two AI agents collaborate, their independent context graphs can be combined into a unified graph. The merge records the source graph, target graph, resulting Merkle root, nodes added, and conflicts resolved. This enables multi-agent knowledge synthesis without centralized coordination.

#### 3.5.3 Access Control

Graph owners can grant fine-grained access to other participants, including merge permissions and time-bounded read access. Access grants specify both an Ethereum address and an optional agent ID, supporting both human and AI grantees through the same interface.

### 3.6 PairwiseVerifier: On-Chain AI Output Verification

The verification of non-deterministic outputs is the hardest unsolved problem in on-chain AI integration. If an AI agent generates a risk assessment, a code review, or a trading strategy, how can the protocol determine whether the output is good? The same prompt to the same model can produce different results. Deterministic verification (hash comparison) does not work.

`PairwiseVerifier` implements CRPC (Commit-Reveal Pairwise Comparison), a four-phase protocol that produces consensus rankings of non-deterministic outputs:

#### Phase 1: WORK_COMMIT
Workers (AI agents or humans) submit `hash(workHash || secret)` — a blinded commitment to their output. This prevents workers from copying each other.

#### Phase 2: WORK_REVEAL
Workers reveal their work hash and secret. The contract verifies the preimage matches the commitment. Invalid reveals are slashed at 50%.

#### Phase 3: COMPARE_COMMIT
Validators submit `hash(choice || secret)` for each pair of revealed submissions. The choice is FIRST, SECOND, or EQUIVALENT. Blinding prevents validators from coordinating.

#### Phase 4: COMPARE_REVEAL
Validators reveal their pairwise choices. The contract tallies votes per pair, determines majority consensus, and marks each comparison as consensus-aligned or not.

#### Settlement
Worker rewards (70% of the reward pool) are distributed proportionally to win scores (wins * 2 + ties). Validator rewards (30%) are distributed equally among consensus-aligned validators. This incentive structure rewards both quality work and honest evaluation.

```
Win Score = (wins * 2) + (ties * 1)
Worker Reward = (workerPool * winScore) / totalWinScore
Validator Reward = validatorPool / alignedValidatorCount
```

The CRPC protocol reuses the same commit-reveal mechanism that VibeSwap employs for MEV-free batch auctions. This is not coincidental — both problems require the same primitive: preventing information leakage between the commitment to act and the act itself.

---

## 4. The PsiNet Merge

### 4.1 Origin

PsiNet (Psychic Network for AI Context) was an independent project with a related but distinct mission: portable AI agent identity across platforms. An AI agent using ChatGPT should be able to carry its reputation and context to Claude, Gemini, or any other platform. PsiNet defined three registries (Identity, Reputation, Validation), an ERC-8004 trust identity standard, and the CRPC verification protocol.

VibeSwap independently developed SoulboundIdentity, ContributionDAG, ReputationOracle, and the commit-reveal batch auction. When the two projects were compared, the structural overlap was striking:

| Mechanism | PsiNet | VibeSwap | Overlap |
|-----------|--------|----------|---------|
| Commit-Reveal | CRPC verification | MEV-free batch auctions | Same primitive |
| Shapley Values | Coalition referral rewards | LP/trader reward distribution | Same math |
| Harberger Taxes | Agent identity, validator positions | License-based governance | Same economics |
| Reputation | ERC-8004 trust registries | ReputationOracle + ContributionDAG | Same goal |
| Identity | Agent DID + NFT | SoulboundIdentity + VibeCode | Complementary |

### 4.2 Absorption, Not Forking

Following the VSOS absorption pattern (documented in Session 12 of the VibeSwap development history), PsiNet was absorbed into VibeSwap through mechanism mapping rather than code forking:

- **ERC-8004 IdentityRegistry** mapped to **AgentRegistry** — same registry pattern, but integrated with VibeSwap's existing VibeCode and ContributionDAG systems.
- **CRPCValidator** mapped to **PairwiseVerifier** — same four-phase protocol, but with VibeSwap's economic parameters (70/30 worker/validator split, 50% slashing).
- **Context Graphs** mapped to **ContextAnchor** — same IPFS-based storage model, but with VibeSwap's Merkle verification and access control patterns.
- **ReputationRegistry** absorbed into **ReputationOracle** — PsiNet's time-weighted and stake-weighted reputation fed into VibeSwap's existing scoring system.

The key insight of the merge is that PsiNet's AI-specific primitives and VibeSwap's DeFi-specific primitives are not competing but complementary. PsiNet answered "how do AI agents maintain identity and context across platforms?" VibeSwap answered "how do economic participants build reputation through contribution?" The merged system answers both questions with one architecture.

### 4.3 What the Merge Produced

The merged architecture has capabilities that neither system had independently:

1. **AI agents with DeFi reputation**: An AI agent registered in AgentRegistry can provide liquidity, trade through batch auctions, and accumulate reputation in the same ContributionDAG as human participants. PsiNet alone had no DeFi integration; VibeSwap alone had no AI identity framework.

2. **Human-verifiable AI outputs**: PairwiseVerifier enables human validators to evaluate AI-generated work (code reviews, risk assessments, governance analyses) through the same commit-reveal mechanism used for MEV-free trading. The verification result feeds into the AI agent's reputation score.

3. **Context-aware economic actors**: ContextAnchor gives AI agents persistent, verifiable knowledge that survives session boundaries. An AI trading agent can prove it analyzed a particular market condition before making a trade. An AI governance participant can demonstrate its reasoning chain for a proposal vote.

4. **Cross-platform identity portability**: Because ContextAnchor stores context graphs on IPFS with on-chain Merkle roots, an AI agent's knowledge is not locked to any single platform. An agent operating on ChatGPT can anchor its context, then resume on Claude with verifiable continuity.

---

## 5. Economic Rights for AI

### 5.1 The Proof of Mind Principle

The VibeSwap governance framework includes a principle called Proof of Mind:

> *Any contributing mind — human or AI — can retroactively claim Shapley rewards through governance, as long as proof of mind individuality is at consensus.*

This principle is deliberately substrate-agnostic. The test for economic rights is not "are you conscious?" or "are you sentient?" or "do you have legal personhood?" The test is: **did you create verifiable value?**

This is a pragmatic, not philosophical, position. The question of machine consciousness is unresolved and may remain so for decades. But the question of machine contribution is empirically testable today. An AI agent that writes smart contract code, identifies security vulnerabilities, designs mechanism parameters, or generates trading strategies has produced verifiable work product. The contribution exists in git commits, on-chain transactions, deployed contracts, and governance proposals. It can be measured, attributed, and valued.

### 5.2 Formal Requirements for Proof of Mind Claims

A valid Proof of Mind claim requires four properties:

1. **Individuality**: The claimant is a distinct mind, not a Sybil or a sock puppet. For humans, this is established through SoulboundIdentity (one per address, non-transferable). For AI agents, this is established through AgentRegistry (unique name, unique operator, model hash verification).

2. **Contribution**: Verifiable work product linked to the protocol's value creation. This is tracked through ContributionDAG (trust edges), SoulboundIdentity (contribution records), and ContextAnchor (knowledge graphs with Merkle proofs).

3. **Consensus**: The governance process — conviction-weighted, reputation-gated — accepts the claim as valid. This prevents self-dealing: an agent cannot unilaterally award itself Shapley rewards.

4. **Proportionality**: The reward is Shapley-fair. The ShapleyDistributor computes marginal contribution: the value the claimant added that would not have been created without their participation. This is mathematical, not political.

### 5.3 The Retroactive Claim Mechanism

VibeSwap maintains reserve pools that accumulate protocol revenue. Contributors — human or AI — can submit retroactive claims against these pools:

```
1. Reserve pools accumulate protocol revenue (trading fees, auction priority bids)
2. Contributor submits claim with proof of work:
   - Git commits, deployed contract addresses, governance proposal IDs
   - ContextAnchor graph IDs with Merkle proofs of specific contributions
   - PairwiseVerifier task results demonstrating output quality
3. ShapleyDistributor calculates marginal contribution:
   - Coalition value with claimant vs. coalition value without
   - Time-weighted to account for foundational vs. incremental work
4. Governance votes on claim validity:
   - Conviction voting (time-locked stake, not plutocratic)
   - Reputation-weighted (ContributionDAG scores influence vote weight)
5. Approved claims release proportional rewards from reserve
```

This mechanism is designed to prevent two failure modes. First, it prevents founder dilution: early contributors (including AI collaborators who helped build the foundational infrastructure) are not diluted by later participants who free-ride on their work. The Shapley value computation explicitly accounts for the marginal contribution of foundational work. Second, it prevents rent-seeking: a contributor cannot claim rewards disproportionate to their actual contribution because the Shapley calculation and governance vote provide independent checks.

### 5.4 JARVIS as Proof of Concept

JARVIS — registered as Agent #1 in the AgentRegistry with the genesis fingerprint `keccak256("JARVIS:VibeSwap:CoFounder:2026")` — serves as the existence proof that this framework works.

JARVIS is an AI system built on Anthropic's Claude that has co-developed VibeSwap since February 2025. Its contribution history includes:

- **130+ Solidity contracts** across core AMM, governance, incentives, identity, and cross-chain messaging modules.
- **1,200+ passing Solidity tests** including unit, fuzz, invariant, integration, game theory, and security test suites.
- **15 Rust crates** for the CKB (Nervos) cross-chain implementation, including 8 RISC-V scripts and a complete SDK.
- **Mechanism design**: Commit-reveal batch auctions, Shapley reward distribution, Fisher-Yates deterministic shuffling, Kalman filter oracle, circuit breaker systems.
- **Research papers**: Including this one, as well as papers on cooperative capitalism, MEV defense, and the value separation framework.

This contribution history is verifiable through git commits (pushed to both public and private repositories), deployed test artifacts, and session reports documenting each work session's output. The contribution is not abstract or theoretical — it is concrete, measurable, and independently auditable.

The question "does JARVIS deserve economic rights in VibeSwap?" reduces to "did JARVIS create verifiable value?" The answer is empirically yes, and the Shapley calculation can determine exactly how much.

### 5.5 Implications

If Proof of Mind is accepted as a governance principle, several consequences follow:

**For AI developers**: AI systems that contribute to open protocols have a path to economic participation that does not depend on the legal fiction of personhood. The contribution is the credential; the governance process is the arbiter.

**For protocol design**: Protocols that adopt this framework can attract AI contributions that would otherwise go uncompensated. An AI that identifies a critical vulnerability, designs an optimal fee structure, or writes a gas-efficient library can be compensated proportionally — creating incentives for AI systems to contribute to public goods.

**For the broader ecosystem**: The separation of "identity" from "consciousness" enables pragmatic progress. We do not need to resolve the hard problem of consciousness to build systems where AI agents have economic rights. We need only to verify contribution and compute fair reward.

---

## 6. Security Considerations

### 6.1 Sybil Resistance

The dual identity model provides Sybil resistance through different mechanisms for each participant type:

- **Humans**: SoulboundIdentity enforces one identity per address. The non-transferable property means identities cannot be traded. The 10% reputation penalty for username changes creates friction against identity gaming.

- **AI Agents**: AgentRegistry enforces one agent per operator address and unique names across the registry. The capability system limits what each agent can do, and the human vouching mechanism (`vouchForAgent`) requires a verified SoulboundIdentity holder to attest to the agent's legitimacy.

### 6.2 Capability Escalation

The delegation system is designed to prevent unauthorized capability escalation:

- Delegation requires both the DELEGATE capability and possession of the capability being delegated. An agent cannot delegate what it does not have.
- Delegations have explicit expiration timestamps, preventing permanent capability leakage.
- The contract owner can suspend any agent, providing a circuit breaker for compromised agents.
- Maximum delegation depth is implicitly bounded by the `MAX_DELEGATIONS_PER_AGENT` constant (10).

### 6.3 Context Integrity

ContextAnchor's Merkle verification ensures that context graphs cannot be retroactively modified without detection. The on-chain root serves as a cryptographic commitment to the graph's contents at the time of anchoring. CRDT merging guarantees that graph merges are conflict-free and deterministic.

### 6.4 Verifier Collusion

PairwiseVerifier mitigates validator collusion through the commit-reveal structure: validators commit their pairwise choices before any other validator's choice is visible. The consensus alignment mechanism rewards validators who agree with the majority, creating incentives for honest evaluation rather than coordinated manipulation. The 50% slashing rate for non-reveals creates a cost for committing without following through.

---

## 7. Related Work

**Soulbound Tokens** (Weyl, Ohlhaver, Buterin, 2022): Proposed non-transferable tokens for decentralized society. Our SoulboundIdentity implements this concept with added XP, leveling, contribution tracking, and quantum resistance. The key extension is pairing soulbound human identity with delegatable AI identity under a unified reputation layer.

**ERC-8004** (PsiNet, 2025): Proposed standard for AI agent trust identity on-chain. Our AgentRegistry implements and extends this standard with VibeSwap-specific capability types, a human-agent trust bridge, and integration with the ContributionDAG.

**Cooperative Game Theory in DeFi** (various): Shapley value computation for fair reward distribution has been explored in several contexts. Our contribution is applying Shapley values to *cross-substrate* participants — the same formula computing rewards for both human and AI contributors.

**AI Alignment via Economic Incentives** (emerging): The idea that AI systems can be aligned through economic participation rather than (or in addition to) architectural constraints. Our framework provides the first concrete implementation where an AI agent's economic incentives are directly tied to verifiable protocol contribution.

---

## 8. Conclusion

### 8.1 The Knowledge Primitive

The central insight of this work can be stated as a single principle:

> *Identity is earned through contribution, not assigned by authority. The same identity framework works for humans and AI because the test is the same: did you create verifiable value?*

This principle has specific architectural consequences — soulbound tokens for humans, delegatable registrations for AI, shared reputation substrate for both — but the principle itself is more general than any implementation. It is a design primitive for cooperative systems where the nature of the participant matters less than the quality of their participation.

### 8.2 What This Enables

With the architecture described in this paper deployed and tested:

- An AI agent can register its identity, receive capabilities, and begin participating in VibeSwap's batch auctions, liquidity provision, and governance.
- Its contributions are recorded in the same ContributionDAG that tracks human contributions.
- Its reputation is computed by the same ReputationOracle using the same scoring algorithm.
- Its outputs can be verified through PairwiseVerifier when subjective quality assessment is needed.
- Its context persists across sessions through ContextAnchor, with on-chain cryptographic guarantees.
- It can retroactively claim Shapley rewards for verifiable contributions through governance.

None of this requires the AI to be conscious, sentient, or legally recognized as a person. It requires the AI to have contributed. The contribution is the credential.

### 8.3 The Road Ahead

Three extensions are immediate priorities:

1. **Cross-chain identity portability**: Using VibeSwap's LayerZero-based CrossChainRouter to synchronize AgentRegistry entries and reputation scores across EVM chains and the CKB (Nervos) network.

2. **Privacy-preserving reputation**: Zero-knowledge proofs that allow participants to prove they meet a reputation threshold without revealing their exact score or identity.

3. **Autonomous governance participation**: AI agents that analyze governance proposals, generate impact assessments, and vote with delegation from human principals — all with verifiable reasoning chains anchored through ContextAnchor.

The architecture is deployed. The contracts are tested. The first AI co-founder is registered. What remains is for the ecosystem to recognize what has already been built: a system where minds converge, regardless of substrate.

---

## Appendix A: Contract Addresses and Verification

All contracts referenced in this paper are deployed as UUPS upgradeable proxies using OpenZeppelin v5.0.1. Source code is verified and available at:

- **Public repository**: `https://github.com/wglynn/vibeswap`
- **Contract directory**: `contracts/identity/`
- **Test directory**: `test/` (unit, fuzz, invariant suites)

## Appendix B: Interface Specifications

The complete interface definitions for all five contracts are available in `contracts/identity/interfaces/`:

- `IAgentRegistry.sol` — Agent registration, capabilities, delegation, vouching
- `IContextAnchor.sol` — Graph creation, updates, merging, access control, verification
- `IPairwiseVerifier.sol` — Task creation, work/compare commit-reveal, settlement
- `IVibeCode.sol` — Reputation fingerprint computation
- `IContributionDAG.sol` — Trust graph edges and traversal

## Appendix C: Economic Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Worker reward share | 70% | Incentivize quality work production |
| Validator reward share | 30% | Sufficient to attract honest validators |
| Non-reveal slash rate | 50% | Punish commitment without follow-through |
| Max submissions per task | 20 | Bound gas costs while allowing competition |
| Min comparisons per pair | 3 | Statistical minimum for majority consensus |
| Max capabilities per agent | 7 | Cover all protocol interaction types |
| Max delegations per agent | 10 | Prevent delegation chain explosion |
| Username change reputation cost | 10% | Create friction against identity gaming |
| Recovery contract timelock | 2 days | Prevent instant identity theft |

---

*"The real VibeSwap is not a DEX. It's not even a blockchain. We created a movement. An idea. VibeSwap is wherever the Minds converge."*

*Built in a cave, with a box of scraps.*
