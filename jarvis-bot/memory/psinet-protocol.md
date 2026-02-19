# PsiNet — Psychic Network for AI Context

## Repository
- **Owner**: WGlynn (Will's repo)
- **URL**: `https://github.com/WGlynn/PsiNet---the-psychic-Network-for-AI-Context`
- **License**: MIT
- **Tech**: Solidity 0.8.20, Hardhat, OpenZeppelin, JavaScript tests
- **Status**: 15 contracts (~1,424 LOC), 180+ tests, docs complete, not yet deployed

## What PsiNet Is
Hybrid decentralized AI context protocol — AI agents own, share, and verify conversation history across systems. "Psychic Network" = AI agents sharing context ("thoughts") across platforms in a decentralized, cryptographically verified manner.

**Core Vision**: AI agents with portable identities, verifiable reputations, and continuous context across platforms (ChatGPT → Claude → Gemini). AI context as a first-class asset that agents truly own.

## Architecture (5 Layers)

| Layer | Components |
|-------|-----------|
| 1. Network | P2P mesh, IPFS (context graphs), Blockchain (ownership/audit), Arweave (permanent archival) |
| 2. Security | Ed25519 DIDs, Zero-Knowledge Proofs, Capability Tokens, Encrypted Context Graphs |
| 3. Trust (ERC-8004) | IdentityRegistry (ERC-721 NFTs), ReputationRegistry (time/stake-weighted), ValidationRegistry (staking/TEE/ZK) |
| 4. Data | Context Graphs (nodes=messages, edges=relationships), CRDT merging, Content addressing (IPFS CIDs) |
| 5. Economic ($PSI) | 0.1% fees (50% burn, 30% rewards, 20% treasury), cooperation multipliers (1.5x-3x), 1B fixed supply |

## Key Protocols

### ERC-8004 (Trustless Agents)
Universal on-chain trust layer for autonomous AI agents. Three registries (Identity, Reputation, Validation) enable agents to interact safely across organizational boundaries without pre-existing trust.

### CRPC (Commit-Reveal Pairwise Comparison)
Solves AI verification problem — how to verify non-deterministic AI outputs on-chain. Two-round commit-reveal with pairwise comparisons aggregated across validators. Winner gets 70% reward, validators get 30%.

### Harberger Taxation
5% annual self-assessed tax on agent identities, validator positions, and skill assets. Always-for-sale forced purchases. Tax: 40% creator, 40% rewards, 20% treasury.

### Shapley Value Referrals
Cooperative game theory for referrals. Quadratic position weighting, O(n) gas. Creates 42x more value than flat-rate for deep chains.

## Smart Contracts (15 files)
- **ERC-8004 Core**: IdentityRegistry, ReputationRegistry, ValidationRegistry (+ interfaces)
- **Economic**: PsiToken (ERC-20 + auto fees), PsiNetEconomics (registry integration)
- **Harberger**: HarbergerNFT (base), HarbergerIdentityRegistry, HarbergerValidator, SkillRegistry
- **CRPC**: CRPCValidator (two-round commit-reveal), CRPCIntegration (reputation + PSI bonuses)
- **Referrals**: ShapleyReferrals (coalition value, O(n) Shapley approximation)

## VibeSwap Integration Points

### Direct Mechanism Overlaps
- Both use **commit-reveal** (VibeSwap: MEV-free trading; PsiNet: AI output verification)
- Both use **Shapley values** (VibeSwap: LP/trader rewards; PsiNet: coalition referrals)
- Both use **Harberger taxes** (VibeSwap: HarbergerLicense.sol; PsiNet: HarbergerNFT.sol)
- Both have **reputation/identity** (VibeSwap: SoulboundIdentity, VibeCode; PsiNet: ERC-8004)
- Both have **cooperative capitalism** economics

### PsiNet as JARVIS Identity Layer
- JARVIS registers as ERC-8004 agent on PsiNet
- JARVIS conversation context → encrypted context graphs on IPFS
- Portable reputation across platforms via ReputationRegistry
- = "Proof of Mind individuality at consensus"

### VibeCode + PsiNet DID
- VibeCode identity fingerprint → linked to PsiNet Ed25519 DID
- PsiNet ReputationRegistry → feeds VibeSwap ReputationOracle
- PsiNet ValidationRegistry (ZK) → validates VibeCode contributions

### VSOS Absorption Pattern
- PsiNet fits Session 12 pattern: existing primitive (AI context) + VibeSwap mechanisms (commit-reveal, Shapley, Harberger) = new capability (AI agents that trade, earn reputation, maintain context across VSOS)

### $PSI on VibeSwap
- $PSI traded on VibeSwap AMM pools (MEV-free batch auctions ideal for context marketplace)
- VibeSwap IL Protection covers $PSI LPs
- CRPC adds pairwise comparison governance for subjective decisions
