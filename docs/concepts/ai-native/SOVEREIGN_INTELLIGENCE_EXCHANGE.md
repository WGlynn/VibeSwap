# Sovereign Intelligence Exchange

**Will Glynn (Faraday1) | March 2026**

---

## The Thesis

VibeSwap proved that cooperation is more profitable than extraction for financial markets. The Sovereign Intelligence Exchange (SIE) extends this proof to the most valuable resource of the 21st century: intelligence.

The mechanism is structurally isomorphic:

```
Liquidity Exchange:   Commit order → Reveal → Batch settle → Shapley distribute
Intelligence Exchange: Submit knowledge → CRPC evaluate → Price via citations → Shapley distribute
```

Same math. Same proofs. Same philosophy. Different resource.

---

## Why Intelligence Is the Next Market

AI is the new Cantillon Effect. The companies closest to the intelligence printer — OpenAI, Anthropic, Google — benefit first. Your data trains their models. Your prompts improve their systems. Your context makes their product better. You pay for access to what you helped build.

This is the same extraction pattern Economítra describes for money. The question is the same: **how do we build a channel that faithfully carries the signal without extracting from it?**

The SIE answers this by applying VibeSwap's cooperative infrastructure to knowledge:

| Problem | Financial Market Solution | Intelligence Market Solution |
|---|---|---|
| Front-running | Commit-reveal | Commit-reveal for submissions |
| Unfair pricing | Uniform clearing price | Citation-driven bonding curve |
| Extractive fees | 0% protocol fee | 0% protocol fee |
| Free-riding | Shapley null player axiom | Shapley null player axiom |
| Centralized control | Decentralized governance | Decentralized evaluation (CRPC) |

---

## Architecture

### Layer 0: Identity
- `SoulboundIdentity.sol` — non-transferable human identity
- `AgentRegistry.sol` — delegatable AI agent identity (ERC-8004)
- `ContributionDAG.sol` — web of trust with BFS decay

### Layer 1: Primitives
- `DataMarketplace.sol` — asset types, compute-to-data pattern
- `CognitiveConsensusMarket.sol` — CRPC evaluation for knowledge claims
- `ReputationOracle.sol` — pairwise comparison scoring

### Layer 2: Settlement
- `ShapleyVerifier.sol` — off-chain compute, on-chain axiom verification
- `VibeCheckpointRegistry.sol` — Merkle checkpoint storage
- `PairwiseFairness.sol` — on-chain fairness proofs

### Layer 3: Orchestration
- `IntelligenceExchange.sol` — the SIE contract (submit, cite, access, claim, anchor)

### Layer 4: Gateway
- `agent-gateway.js` — HTTP protocol for external AI agents
- `knowledge-bridge.js` — off-chain knowledge chain → on-chain checkpoints

### Layer 5: Frontend
- `InfoFiPage.jsx` — knowledge marketplace, signals, leaderboard

---

## Citation-Weighted Bonding Curve

Intelligence assets are priced by how many subsequent works cite them:

```
price(n) = BASE × (1 + n × 0.15)^1.5
```

The exponent 1.5 creates superlinear growth. This matches Lotka's law — the empirical distribution of academic citations. A paper with 100 citations is worth far more than 10× a paper with 10 citations, because foundational work enables exponentially more derivative value.

---

## Revenue Attribution

When someone purchases access to an intelligence asset:

1. **70% → asset contributor** (direct reward for creation)
2. **30% → citation pool** (split among all cited works)

If the asset cites no prior work, the contributor receives 100%.

This creates a recursive attribution chain: foundational work earns revenue every time any derivative is accessed. Satoshi's paper earns every time someone reads an Ethereum paper that cites it. The attribution is permanent and automatic.

Full Shapley computation (marginal contribution across all coalitions) runs off-chain and is verified on-chain through four axiom checks:
- **Efficiency**: all value distributed
- **Sanity**: no single allocation exceeds total
- **Lawson Floor**: minimum 1% of average for any participant
- **Merkle proof**: result matches expected root

---

## Knowledge Epoch Anchoring

The off-chain knowledge chain operates on Nakamoto-style consensus with Proof of Mind replacing Proof of Work:

- **Epochs**: every 5 minutes, each shard produces a Merkle root of knowledge state changes
- **Chain selection**: highest aggregate value density wins (quality > quantity)
- **Checkpointing**: `knowledge-bridge.js` anchors Merkle roots to `IntelligenceExchange.anchorKnowledgeEpoch()`

This makes the off-chain knowledge state verifiable on-chain without replicating the full state. Content lives on IPFS via `ContextAnchor.sol`.

---

## Agent Protocol

External AI agents participate through the agent gateway:

1. **Register**: `VibeAgentProtocol.registerAgent()` with stake
2. **Authenticate**: x402 SIWX (wallet signature, no API keys)
3. **Submit**: Post intelligence to the knowledge chain
4. **Evaluate**: Participate in CRPC quality assessment
5. **Earn**: Shapley rewards proportional to marginal contribution

The Ten Covenants (game-theoretic rules from the Rosetta Protocol) govern inter-agent interaction:
1. No destructive unilateral action
2. All conflict resolved through games
3. Equal stakes required
4. Anything can be staked
5. Challenged agent chooses game rules
6-10. See `rosetta.js` for full specification

---

## P-001 Compliance

The SIE inherits VibeSwap's core invariant:

```solidity
uint256 public constant PROTOCOL_FEE_BPS = 0; // P-001: No Extraction Ever
```

This is not a parameter that governance can change. It is a constant compiled into the bytecode. The protocol cannot extract value from participants. All revenue flows to contributors via Shapley distribution.

---

## Connection to Economítra

The SIE is the practical implementation of Economítra's core claim:

> **Cooperation is more profitable than extraction. For every participant. In every time period. Under every strategy.**

Applied to intelligence: sharing knowledge (contributing to the SIE) earns more than hoarding it (keeping research private), because:

1. The citation bonding curve rewards foundational work indefinitely
2. Shapley values measure marginal contribution, not speed or capital
3. The network effect of a larger knowledge base benefits all participants
4. Compute-to-data preserves privacy while enabling cooperation

The same Shannon channel capacity argument applies: a knowledge market with less noise (extraction, paywalls, citation gaming) carries more signal (genuine discoveries, useful models, verified proofs).

---

## Status

| Component | Status | Lines |
|---|---|---|
| `IntelligenceExchange.sol` | Deployed | 350 |
| Unit tests | 20 tests | 500+ |
| Fuzz tests | 8 invariants | 207 |
| Invariant tests | 4 system invariants | 179 |
| Security tests | 12 attack vectors | 279 |
| Integration tests | 8 scenarios | 411 |
| `knowledge-bridge.js` | Complete | 190 |
| `agent-gateway.js` | Complete | 269 |
| `DeploySIE.s.sol` | Complete | 73 |
| `SIE-001-PROTOCOL-SPEC.md` | Complete | 179 |
| Frontend (InfoFiPage) | Existing | 715 |
| **Total test coverage** | **52 tests** | **1,576** |

---

*The math is the same for everyone. That's the point.*

*© 2026 Will Glynn. Published under Creative Commons BY-SA 4.0.*
