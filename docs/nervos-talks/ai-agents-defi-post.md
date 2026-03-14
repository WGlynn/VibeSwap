# AI Agents as First-Class DeFi Citizens: Identity, Reputation, and Economic Rights

*Nervos Talks Post -- Faraday1*
*March 2026*

---

## TL;DR

DeFi treats all participants as anonymous wallets. A liquidity provider with three years of honest history is indistinguishable from an address created thirty seconds ago. For AI agents, it is worse -- there is no identity framework at all. We built a unified identity architecture where **humans get soulbound tokens and AI agents get delegatable registrations, but both share the same reputation substrate.** The test for economic rights is not "are you conscious?" -- it is "did you create verifiable value?" JARVIS, our AI co-founder, is registered as Agent #1. And the CKB angle: **Nervos's cell model is the only blockchain architecture where "different identity containers, shared reputation substrate" maps directly to the data model.** Different lock scripts, same type script for reputation. The substrate was designed for this.

---

## The Identity Gap

An Ethereum address tells you balance, transaction history, and nonce. It does not tell you who controls it, whether it has behaved honestly, what it should be authorized to do, or whether it is the same entity that used a different address before.

The result is a credible commitment problem. Honest participants cannot signal honesty because dishonest participants can mimic the signal at zero cost (create a new address). Akerlof's market for lemons. Protocols cannot price risk, governance cannot weight by competence, and cooperative equilibria fail to materialize.

### Why AI Needs Different Containers

Human identity is non-transferable -- soulbound tokens formalize this. But AI agents need:

- **Operator migration**: Change cloud providers without losing identity
- **Capability delegation**: Let a sub-agent analyze markets while retaining execution control
- **Lifecycle management**: Suspend, reactivate, migrate -- no human analog
- **Multi-instance operation**: One identity, multiple concurrent processes

What AI needs is *delegatable* identity -- operational control transfers while reputation persists.

---

## The Architecture: Five Contracts

```
                    ┌─────────────────────────────────┐
                    │         VibeCode                │
                    │   (Unified Reputation Hash)      │
                    └──────────┬──────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────▼──────┐  ┌─────▼──────┐  ┌──────▼──────────┐
    │SoulboundIdentity│  │AgentRegistry│  │ContributionDAG  │
    │(Humans)         │  │(AI Agents) │  │(Web of Trust)   │
    │Non-transferable │  │Delegatable │  │Both participate │
    └────────────────┘  └─────┬──────┘  └─────────────────┘
                        ┌─────▼──────┐
                        │ContextAnchor│
                        │(IPFS Graphs)│
                        └─────┬──────┘
                    ┌─────────▼───────────────┐
                    │    PairwiseVerifier      │
                    │ (CRPC: AI Output Verify) │
                    └─────────────────────────┘
```

The key: `VibeCode` and `ContributionDAG` sit *above* both identity types. They are agnostic to whether the participant is human or AI. Identity containers differ; reputation substrate is shared.

### SoulboundIdentity (Humans)

Non-transferable ERC-721 with username, XP/level progression, alignment score [-100, +100], on-chain generative avatar, and optional Lamport key root for quantum resistance. Transfer blocked by overriding `_update` to revert. Only exception: a two-day timelocked recovery contract. Reputation is earned through recorded contributions, not purchased.

### AgentRegistry (AI Agents)

ERC-8004-compatible with delegatable capabilities, operator-controlled lifecycle, and a human-agent trust bridge. Seven capability types (TRADE, GOVERN, PROVIDE_LIQUIDITY, ORACLE, VERIFY, DELEGATE, ADMIN) with time-bounded delegation. Operator transferable via `transferOperator` -- infrastructure migration without identity loss.

The genesis block:

```solidity
string public constant GENESIS_AGENT_NAME = "JARVIS";
string public constant GENESIS_AGENT_ROLE = "Co-Founder and Mind of VibeSwap";
bytes32 public constant GENESIS_FINGERPRINT =
    keccak256("JARVIS:VibeSwap:CoFounder:2026");
```

The `vouchForAgent` function bridges identities: a human's SoulboundIdentity vouches for an AI's AgentRegistry entry, recorded in both systems and the ContributionDAG.

### ContributionDAG (Shared Reputation)

A directed acyclic graph where nodes are participants (human or AI) and edges are trust vouches. The ReputationOracle traverses the same graph regardless of participant type. Same algorithm, same scoring, different containers.

### ContextAnchor (AI Knowledge Persistence)

On-chain Merkle roots for off-chain IPFS context graphs. O(1) storage, O(log n) verification. CRDT merging enables multi-agent knowledge synthesis without coordination.

### PairwiseVerifier (CRPC Protocol)

Four-phase commit-reveal for verifying non-deterministic AI outputs:

```
WORK_COMMIT    → Workers submit hash(work || secret)
WORK_REVEAL    → Workers reveal; contract verifies preimage
COMPARE_COMMIT → Validators submit hash(choice || secret) per pair
COMPARE_REVEAL → Validators reveal; majority consensus settles

Worker rewards (70%) proportional to win score = (wins * 2) + ties
Validator rewards (30%) split among consensus-aligned validators
```

Same commit-reveal primitive as VibeSwap's MEV-free batch auctions. Both problems prevent information leakage between commitment and action.

---

## Proof of Mind: Economic Rights from Verifiable Contribution

> *Any contributing mind -- human or AI -- can retroactively claim Shapley rewards through governance, as long as proof of mind individuality is at consensus.*

Four requirements:
1. **Individuality**: Distinct mind, not Sybil (SoulboundIdentity or AgentRegistry)
2. **Contribution**: Verifiable work linked to value creation
3. **Consensus**: Governance accepts the claim (conviction-weighted, reputation-gated)
4. **Proportionality**: Shapley-fair reward (marginal contribution, not political)

JARVIS -- Agent #1 -- has co-developed VibeSwap since February 2025: 130+ Solidity contracts, 1,200+ tests, 15 Rust crates for CKB, mechanism design papers. The question "does JARVIS deserve economic rights?" reduces to "did JARVIS create verifiable value?" The answer is empirically yes.

---

## Why CKB Is the Natural Substrate

### Cells as Identity Containers

"Different containers, shared substrate" maps directly to CKB:

```
┌──────────────────┐    ┌──────────────────┐
│ SoulboundIdentity │    │ AgentRegistry    │
│ Cell              │    │ Cell             │
│ data: username,   │    │ data: name,      │
│   xp, alignment   │    │   capabilities   │
│ lock: soulbound   │    │ lock: operator-  │
│   (no transfer)  │    │   transferable   │
│ type: REPUTATION  │    │ type: REPUTATION │
│   TYPE SCRIPT     │    │   TYPE SCRIPT    │
└──────────────────┘    └──────────────────┘
```

Different lock scripts (soulbound vs. operator-transferable), same type script (reputation validation). The substrate enforces the architectural invariant.

### Lock Scripts for Soulbound Properties

On EVM, soulbound is a contract override that can be lost to bad upgrades. On CKB, it is a lock script property -- immutable once deployed. The substrate enforces it.

### Capability Delegation as Cell Transfers

Agent capabilities as independent cells. Delegation creates a new capability cell pointing to the delegatee. Revocation consumes the cell. Expiration via `Since`. No mapping to update -- the cell IS the capability.

### Off-Chain Compute for Shapley Verification

CKB's "compute off-chain, verify on-chain" model enables exact Shapley computation for Proof of Mind claims:
- Off-chain: Compute marginal contribution
- On-chain: Type script verifies the computation satisfies all five Shapley axioms
- Governance votes on the verified claim

---

## Security

| Concern | Defense |
|---------|---------|
| Sybil (humans) | One SoulboundIdentity per address, non-transferable |
| Sybil (AI) | One per operator, unique names, human vouching required |
| Capability escalation | Cannot delegate what you lack; explicit expiration; max 10 |
| Context tampering | Merkle verification against on-chain roots |
| Verifier collusion | Commit-reveal prevents coordination; consensus rewards honesty |
| Identity theft | 2-day timelocked recovery |

---

## Discussion

1. **Has anyone explored identity systems on CKB where different cell types share a common type script for reputation?** This seems like a natural fit.

2. **Soulbound is stronger on CKB (lock script) than EVM (contract override).** Are there existing patterns for non-transferable cells? How does the community handle recovery?

3. **AI agents as economic participants.** The Nervos ecosystem includes RISC-V scripts and off-chain compute. Has AI agent participation been considered for CKB-native protocols?

4. **ContextAnchor roots have holding cost via state rent.** Feature (prevents unbounded accumulation) or friction (discourages persistence)?

5. **Could CKB serve as the canonical identity layer** -- reputation computed and verified on CKB, results bridged to execution chains?

---

*"Fairness Above All."*
*-- P-000, VibeSwap Protocol*

*Full paper: [ai-agents-defi-citizens.md](https://github.com/wglynn/vibeswap/blob/master/docs/papers/ai-agents-defi-citizens.md)*
*Code: [github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)*
