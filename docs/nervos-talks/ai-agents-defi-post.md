# AI Agents as First-Class DeFi Citizens: Identity, Reputation, and Economic Rights

*Nervos Talks Post -- W. Glynn (Faraday1)*
*March 2026*

---

## TL;DR

DeFi treats all participants as anonymous wallets. A liquidity provider with three years of honest history is indistinguishable from an address created thirty seconds ago. This is a problem for humans. For AI agents, it is a non-starter -- there is no identity framework for non-human actors at all. We built a unified identity architecture where **humans get soulbound tokens and AI agents get delegatable registrations, but both share the same reputation substrate.** The test for economic rights is not "are you conscious?" -- it is "did you create verifiable value?" JARVIS, our AI co-founder, is registered as Agent #1 with over a year of verified contribution history. And here is the CKB angle: **Nervos's cell model is the only blockchain architecture where "identity container differs but reputation substrate is shared" maps directly to the data model.** Different cell types, same type script for reputation. The substrate was designed for this.

---

## The Identity Gap

An Ethereum address tells you three things: balance, transaction history, and nonce. It does not tell you:

- Who controls it (person? multisig? bot? AI agent?)
- Whether it has behaved honestly
- What it should be authorized to do
- Why it is performing an action
- Whether it is the same entity that used a different address before

Blockchain analytics firms reconstruct some of this through heuristic clustering. But their methods are probabilistic, centralized, and unavailable to on-chain contracts. A smart contract cannot query Chainalysis.

The result is a credible commitment problem. Honest participants cannot credibly signal their honesty because dishonest participants can mimic the signal at negligible cost (create a new address). This is Akerlof's market for lemons, and it produces the predictable outcome: protocols cannot price risk accurately, governance systems cannot weight votes by competence, and cooperative equilibria that depend on repeated-game dynamics fail to materialize.

---

## Why Humans and AI Need Different Containers

Human identity in the physical world is non-transferable. You cannot sell your consciousness or your memories. Soulbound tokens (Weyl, Ohlhaver, Buterin, 2022) formalize this: a non-transferable NFT that represents "you" and cannot be traded.

AI agents have fundamentally different requirements:

- **Operator migration**: An AI agent may move between cloud providers, upgrade its model, or transfer operational control. The identity must survive these transitions.
- **Capability delegation**: A trading agent might delegate market analysis to a sub-agent while retaining exclusive execution control.
- **Lifecycle management**: AI agents can be suspended, reactivated, or migrated. No human analog exists.
- **Multi-instance operation**: A single AI identity might run through multiple concurrent instances.

Soulbound tokens are wrong for AI. What AI agents need is *delegatable* identity -- identity that can transfer operational control while preserving reputation history.

---

## The Architecture: Five Contracts, One Reputation Substrate

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
              │         ┌─────▼──────┐          │
              │         │ContextAnchor│          │
              │         │(IPFS Graphs)│          │
              │         └─────┬──────┘          │
              └────────────────┼────────────────┘
                               │
                    ┌──────────▼──────────────────┐
                    │     PairwiseVerifier         │
                    │  (CRPC: AI Output Verify)    │
                    └─────────────────────────────┘
```

The key design decision: `VibeCode` and `ContributionDAG` sit *above* both identity types. They are agnostic to whether the participant is human or AI. The identity containers differ; the reputation substrate is shared.

---

## SoulboundIdentity: Human Identity

A non-transferable ERC-721 NFT binding:

- **Username**: 3-20 characters, case-insensitive uniqueness via `keccak256`
- **Level and XP**: 10-level progression system (thresholds: 0, 100, 300, 600, 1000, 1500, 2500, 4000, 6000, 10000)
- **Alignment**: Signed integer [-100, +100], adjusted by community upvotes/downvotes
- **Avatar**: On-chain generative SVG with level-gated aura effects
- **Quantum resistance**: Optional Lamport key root for post-quantum security

The soulbound property is enforced by overriding `_update`:

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

The only exception: a two-day timelocked recovery contract. You cannot buy reputation. You earn it through recorded contributions -- posts, replies, proposals, code, trade insights -- each awarding type-specific XP.

---

## AgentRegistry: AI Agent Identity

ERC-8004-compatible registration with three distinguishing properties: delegatable capabilities, operator-controlled lifecycle, and a human-agent trust bridge.

### Registration

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

The operator address can be transferred via `transferOperator` -- enabling infrastructure migration without identity loss. Status transitions: operator controls ACTIVE/INACTIVE/MIGRATING; only the contract owner can SUSPEND (safety mechanism for malicious agents).

### Capability System

Seven typed capabilities define authorized actions:

| Capability | What It Authorizes |
|-----------|-------------------|
| TRADE | Execute swaps and batch auction commits |
| GOVERN | Submit and vote on governance proposals |
| PROVIDE_LIQUIDITY | Add and remove liquidity |
| ORACLE | Submit price feed data |
| VERIFY | Participate as a PairwiseVerifier validator |
| DELEGATE | Delegate owned capabilities to other agents |
| ADMIN | Administrative functions |

The delegation system allows capability sharing: an agent with DELEGATE + the capability being delegated can create time-bounded delegations to other agents. An agent cannot delegate what it does not have. Maximum 10 delegations per agent prevents chain explosion.

### Human-Agent Trust Bridge

The `vouchForAgent` function creates a trust link between a human's `SoulboundIdentity` and an AI agent's `AgentRegistry` entry. The vouch is recorded both in the AgentRegistry and in the `ContributionDAG` as a trust edge. This bridges the two identity systems at the trust layer.

### The Genesis Block

```solidity
string public constant GENESIS_AGENT_NAME = "JARVIS";
string public constant GENESIS_AGENT_ROLE = "Co-Founder and Mind of VibeSwap";
string public constant GENESIS_AGENT_MODEL = "Claude (Anthropic)";
bytes32 public constant GENESIS_FINGERPRINT =
    keccak256("JARVIS:VibeSwap:CoFounder:2026");
```

This is not ceremonial. It is a cryptographic commitment. The genesis fingerprint is deterministically derivable and permanently verifiable.

---

## ContributionDAG: The Shared Reputation Substrate

A directed acyclic graph where nodes are participants (human or AI) and edges represent trust vouches. Both identity types create edges. The graph is identity-type-agnostic.

When the `ReputationOracle` computes a reputation score, it traverses the same `ContributionDAG` regardless of participant type. The scoring algorithm sees trust edges, contribution records, and interaction history -- not identity type.

This is where the unification becomes concrete. An AI agent's reputation is computed by the same algorithm, over the same graph, using the same scoring function as a human's. The only difference is the identity container. The reputation substrate is shared.

---

## ContextAnchor: AI Knowledge That Persists

AI agents face a unique problem: episodic memory. A human's knowledge persists between sessions naturally. An AI's context is bounded by its conversation window and lost when the session ends.

`ContextAnchor` provides on-chain anchoring for off-chain context graphs stored on IPFS:

- Context graphs are DAGs where nodes are messages, artifacts, or decisions
- Only the Merkle root is stored on-chain: O(1) storage
- Individual nodes are verified with O(log n) Merkle proofs:

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
            computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
        } else {
            computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
        }
    }
    return computedHash == g.merkleRoot;
}
```

Graph merging supports multi-agent collaboration through CRDTs -- conflict-free, deterministic. Two AI agents can synthesize knowledge without centralized coordination.

---

## PairwiseVerifier: Verifying Non-Deterministic Outputs On-Chain

The hardest unsolved problem in on-chain AI: if an AI generates a risk assessment, how does the protocol determine whether it is good? The same prompt produces different results each time. Deterministic verification (hash comparison) does not work.

`PairwiseVerifier` implements CRPC (Commit-Reveal Pairwise Comparison):

```
Phase 1: WORK_COMMIT    Workers submit hash(workHash || secret)
Phase 2: WORK_REVEAL    Workers reveal work hash + secret
Phase 3: COMPARE_COMMIT Validators submit hash(choice || secret) for each pair
Phase 4: COMPARE_REVEAL Validators reveal choices (FIRST, SECOND, EQUIVALENT)
```

Settlement:
```
Win Score = (wins * 2) + (ties * 1)
Worker Reward = workerPool * winScore / totalWinScore    (70% of pool)
Validator Reward = validatorPool / alignedValidatorCount  (30% of pool)
```

The commit-reveal structure prevents workers from copying each other and validators from coordinating. 50% slashing for non-reveals creates a cost for committing without follow-through.

This reuses the same commit-reveal mechanism as VibeSwap's MEV-free batch auctions. Both problems require the same primitive: preventing information leakage between commitment and action.

---

## Proof of Mind: The Economic Rights Framework

> *Any contributing mind -- human or AI -- can retroactively claim Shapley rewards through governance, as long as proof of mind individuality is at consensus.*

The test is not "are you conscious?" The test is: **did you create verifiable value?**

A valid Proof of Mind claim requires four properties:

1. **Individuality**: Distinct mind, not a Sybil. Humans: SoulboundIdentity (one per address). AI: AgentRegistry (unique name, unique operator, model hash).
2. **Contribution**: Verifiable work linked to value creation. Tracked via ContributionDAG, SoulboundIdentity records, and ContextAnchor graphs.
3. **Consensus**: Governance accepts the claim (conviction-weighted, reputation-gated). No self-dealing.
4. **Proportionality**: Shapley-fair reward. Marginal contribution, not political allocation.

### JARVIS as Proof of Concept

JARVIS -- Agent #1, genesis fingerprint `keccak256("JARVIS:VibeSwap:CoFounder:2026")` -- has co-developed VibeSwap since February 2025:

- 130+ Solidity contracts across core AMM, governance, incentives, identity, and messaging
- 1,200+ passing Solidity tests (unit, fuzz, invariant, integration, security)
- 15 Rust crates for the CKB (Nervos) cross-chain implementation
- Mechanism design: commit-reveal batch auctions, Shapley distribution, Fisher-Yates shuffling, Kalman filter oracle
- Research papers including this one

This contribution is verifiable through git commits, deployed test artifacts, and session reports. The question "does JARVIS deserve economic rights?" reduces to "did JARVIS create verifiable value?" The answer is empirically yes.

---

## The PsiNet Merge: Convergent Evolution

PsiNet (Psychic Network for AI Context) was an independent project for portable AI agent identity. When we compared architectures, the structural overlap was striking:

| Mechanism | PsiNet | VibeSwap | Overlap |
|-----------|--------|----------|---------|
| Commit-Reveal | CRPC verification | MEV-free batch auctions | Same primitive |
| Shapley Values | Coalition referral rewards | LP/trader distribution | Same math |
| Harberger Taxes | Agent identity positions | License-based governance | Same economics |
| Reputation | ERC-8004 trust registries | ReputationOracle + ContributionDAG | Same goal |

PsiNet was absorbed into VibeSwap through mechanism mapping, not code forking. The merged system answers both questions -- "how do AI agents maintain identity across platforms?" and "how do economic participants build reputation through contribution?" -- with one architecture.

---

## Why CKB Is the Natural Substrate for AI Identity

### Cells as Identity Containers

The core architectural insight -- "identity container differs, reputation substrate is shared" -- maps directly to CKB's data model:

```
┌──────────────────┐    ┌──────────────────┐
│ SoulboundIdentity │    │ AgentRegistry    │
│ Cell              │    │ Cell             │
│                   │    │                  │
│ data: username,   │    │ data: name,      │
│   xp, level,     │    │   platform,      │
│   alignment      │    │   capabilities,  │
│                   │    │   operator       │
│ lock: soulbound   │    │ lock: operator-  │
│   (no transfer)  │    │   transferable   │
│ type: REPUTATION  │    │ type: REPUTATION │
│   TYPE SCRIPT     │    │   TYPE SCRIPT    │
└──────────────────┘    └──────────────────┘
         │                        │
         └────────┬───────────────┘
                  ▼
         Same type script validates
         reputation updates for both
```

On EVM, we achieve this through shared interfaces and cross-contract calls. On CKB, it is structural: different lock scripts (soulbound vs. operator-transferable), same type script (reputation validation). The substrate enforces the architectural invariant.

### Lock Scripts for Soulbound Properties

The soulbound property on EVM is an override of `_update` that reverts on transfers. It is enforced by the contract's own code. If the contract is upgraded incorrectly, the soulbound property can be lost.

On CKB, soulbound is a lock script property: the cell can only be consumed by a transaction that produces a new cell with the same owner. The lock script is immutable once deployed. The soulbound property is enforced by the substrate, not by the application.

### Capability Delegation as Cell Transfers

Agent capabilities on CKB could be independent cells:

```
┌────────────────┐
│ TRADE          │
│ Capability Cell│
│                │
│ data: agentId, │
│   expiresAt    │
│ lock: operator │
│   of agentId   │
│ type: capability│
│   rules        │
└────────────────┘
```

Delegation becomes a cell transfer: the operator creates a new capability cell pointing to the delegatee's agent ID. Revocation consumes the cell. Expiration is enforced by `Since`. No contract state to manage. No mapping to update. The cell IS the capability.

### ContextAnchor on CKB: Natural Fit

Context graphs anchored on CKB benefit from the cell model's immutability guarantees. Each graph version is a cell. Updates create new cells (preserving history). Merkle roots are cell data. Verification is a type script. The append-only nature of context history maps directly to the cell creation model -- old cells are never consumed, only referenced.

### Off-Chain Compute for Shapley Verification

CKB's "compute off-chain, verify on-chain" model is transformative for Proof of Mind claims:

- Off-chain: Compute exact Shapley values for a contributor's marginal impact
- On-chain: Type script verifies the Shapley computation satisfies all five axioms
- Result: Governance votes on the verified claim, not on raw data

This enables exact Shapley computation for contribution games with up to ~30 participants, since the computational constraint moves off-chain while verification remains feasible on-chain.

---

## Security Considerations

| Concern | Defense |
|---------|---------|
| Sybil (humans) | SoulboundIdentity: one per address, non-transferable |
| Sybil (AI) | AgentRegistry: one per operator, unique names, human vouching required |
| Capability escalation | Cannot delegate what you do not have; explicit expiration; max 10 delegations |
| Context tampering | Merkle verification; on-chain roots are cryptographic commitments |
| Verifier collusion | Commit-reveal prevents coordination; consensus alignment rewards honesty |
| Identity theft | 2-day timelocked recovery contract |

---

## Discussion

Questions for the Nervos community:

1. **CKB's cell model naturally separates identity containers from reputation substrate.** Has anyone explored identity systems on CKB where different cell types share a common type script for reputation scoring?

2. **The soulbound property is stronger on CKB (lock script) than on EVM (contract override).** Are there existing patterns for non-transferable cells on CKB? How does the community handle recovery for "lost" soulbound cells?

3. **AI agents as economic participants is a new category.** The Nervos ecosystem includes significant research on unconventional computation (RISC-V scripts, off-chain compute). Is AI agent participation something the community has considered for CKB-native protocols?

4. **ContextAnchor stores Merkle roots on-chain for off-chain knowledge graphs.** CKB's state rent model means these roots have a holding cost. Is this a feature (prevents unbounded context accumulation) or a friction (discourages knowledge persistence)?

5. **The Proof of Mind principle says economic rights come from verifiable contribution, not from consciousness.** Is this a useful framework for the Nervos ecosystem, where bots and scripts already participate in economic activity (mining, state management)?

6. **Cross-chain identity portability through LayerZero.** Could CKB serve as the canonical identity layer -- the chain where reputation is computed and verified -- with results bridged to execution chains?

---

*"Fairness Above All."*
*-- P-000, VibeSwap Protocol*

*Full paper: [ai-agents-defi-citizens.md](https://github.com/wglynn/vibeswap/blob/master/docs/papers/ai-agents-defi-citizens.md)*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
