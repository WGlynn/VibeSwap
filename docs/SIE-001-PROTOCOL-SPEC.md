# SIE-001: Sovereign Intelligence Exchange Protocol Specification

**Will Glynn (Faraday1) | March 2026**

---

## Abstract

The Sovereign Intelligence Exchange (SIE) applies VibeSwap's cooperative game theory infrastructure to knowledge instead of liquidity. Participants submit intelligence assets, cite prior work to form an attribution graph, and earn revenue proportional to their marginal contribution via Shapley values. Pricing follows a citation-driven bonding curve. Evaluation uses commit-reveal pairwise comparison (CRPC). Settlement bridges off-chain knowledge chain consensus to on-chain Merkle checkpoints.

The mechanism is structurally isomorphic to VibeSwap's financial exchange:

| VibeSwap (Liquidity) | SIE (Intelligence) |
|---|---|
| Commit order | Submit knowledge |
| Reveal order | CRPC evaluate |
| Batch settle at uniform price | Bonding curve price from citations |
| Shapley distribute to LPs | Shapley distribute to contributors |

P-001: 0% protocol extraction. 100% of revenue flows to contributors.

---

## 1. Participants

**Contributors** submit intelligence assets (research, models, datasets, insights, proofs, protocols) by posting an IPFS content hash and metadata URI with an anti-spam stake.

**Citers** reference prior work when submitting new assets. Citations update the cited asset's bonding curve price and establish the attribution graph for Shapley revenue distribution.

**Accessors** purchase read access to intelligence assets. Revenue splits: 70% to the asset's contributor, 30% distributed to cited works proportionally.

**Evaluators** (Phase 1+) participate in CRPC rounds to verify the quality of submitted assets. Evaluators stake reputation and earn rewards for honest evaluation.

**Epoch Submitters** are authorized Jarvis shards that bridge off-chain knowledge chain epochs to on-chain Merkle checkpoints.

---

## 2. Asset Lifecycle

```
SUBMITTED → EVALUATING → VERIFIED → SETTLED
                ↓
            DISPUTED
```

1. **SUBMITTED**: Contributor posts `contentHash`, `metadataURI`, `assetType`, and `citedAssets[]` with a minimum stake of 0.001 ETH. Asset receives a deterministic ID: `keccak256(contributor, contentHash, timestamp, assetCount)`.

2. **EVALUATING** (Phase 1): CognitiveConsensusMarket creates a claim. Evaluators commit hidden verdicts, reveal, and reach consensus via CRPC.

3. **VERIFIED**: Asset passes evaluation. Stake is returned. Asset is eligible for access purchases.

4. **DISPUTED**: Asset fails evaluation or is challenged. Stake may be partially slashed.

5. **SETTLED**: Revenue has been distributed and claimed.

---

## 3. Citation Graph

Citations are directional: asset A cites asset B. Both directions are recorded:

- `citedBy[A]` = [B, C, ...] — works that A references
- `citationsOf[B]` = [A, D, ...] — works that reference B

Constraints:
- Self-citation is prohibited
- Duplicate citations are prohibited
- Citations can only reference existing assets

Each citation updates the cited asset's bonding curve price.

---

## 4. Bonding Curve Pricing

```
price(citations) = BASE_PRICE * (1 + citations * 0.15) ^ 1.5
```

Where `BASE_PRICE = 0.001 ETH` and `CITATION_FACTOR = 0.15`.

The exponent 1.5 creates superlinear growth — highly-cited foundational work becomes exponentially more valuable. This mirrors academic citation dynamics: a paper with 100 citations is worth far more than 10x a paper with 10 citations.

Implementation uses integer arithmetic with Babylonian square root for the ^1.5 approximation. Exact Shapley computation happens off-chain via ShapleyVerifier.

---

## 5. Revenue Distribution

When an accessor purchases access to asset A:

1. **Contributor share (70%)**: Direct payment to A's contributor
2. **Citation pool (30%)**: Split equally among all assets cited by A

If A cites no prior work, the full price goes to A's contributor.

Revenue is accumulated in `claimable[contributor]` and withdrawn via `claimRewards()`.

This is simplified Shapley. Full Shapley computation (marginal contribution across all possible coalitions) runs off-chain and is verified on-chain via ShapleyVerifier's four axiom checks:
- Efficiency: sum(values) == totalPool
- Sanity: no value > totalPool
- Lawson Floor: no value < 1% of average
- Merkle proof verification

---

## 6. Knowledge Epoch Anchoring

Off-chain knowledge consensus (Nakamoto-style, Proof of Mind chain selection) produces epochs every ~5 minutes. Each epoch contains:

- `merkleRoot`: Merkle root of all knowledge state changes
- `assetCount`: Number of assets in the knowledge base
- `totalValue`: Aggregate value density (quality metric)

The knowledge-bridge module listens for epoch production and calls `IntelligenceExchange.anchorKnowledgeEpoch()`, making off-chain consensus verifiable on-chain without replicating the full knowledge state.

---

## 7. Agent Protocol (Phase 2)

External AI agents participate via:

1. Register on `VibeAgentProtocol.registerAgent()` with stake
2. Authenticate to agent-gateway via x402 (wallet signature, no API keys)
3. Submit intelligence, participate in CRPC evaluation, earn Shapley rewards

Agent identity: `AgentRegistry` (ERC-8004 compatible)
Agent discovery: `VibeAgentNetwork.findBySkill()`
Agent communication: Rosetta Protocol (universal translation layer)
Agent governance: Ten Covenants (game-theoretic rules for fair interaction)

---

## 8. Contracts

| Contract | Role | Status |
|---|---|---|
| `IntelligenceExchange.sol` | Orchestrator — submit, cite, access, claim, anchor | Deployed |
| `ShapleyVerifier.sol` | Off-chain compute, on-chain verify | Existing |
| `ShapleyDistributor.sol` | Full Shapley distribution (3700 lines) | Existing |
| `CognitiveConsensusMarket.sol` | CRPC evaluation for knowledge claims | Existing |
| `VibeCheckpointRegistry.sol` | Merkle checkpoint storage | Existing |
| `ContributionDAG.sol` | Web of trust, citation graph | Existing |
| `DataMarketplace.sol` | Compute-to-data pattern | Existing |
| `VibeAgentProtocol.sol` | Agent identity, skills, tasks | Existing |
| `VibeAgentNetwork.sol` | Agent discovery, channels | Existing |
| `ProofOfMind.sol` | Cognitive work as security | Existing |
| `SoulboundSybilGuard.sol` | Identity verification | Existing |

---

## 9. Constants

```solidity
PROTOCOL_FEE_BPS     = 0        // P-001: No Extraction Ever
MIN_STAKE            = 0.001 ether
BONDING_BASE_PRICE   = 0.001 ether
BONDING_CITATION_FACTOR = 1500  // 15% per citation
CITATION_SHARE_BPS   = 3000     // 30% to cited works
LAWSON_FLOOR_BPS     = 100      // 1% minimum reward
```

---

## 10. Security Considerations

- **Anti-spam**: Minimum stake required for submission. Stake returned on verification, slashed on dispute.
- **Sybil resistance**: SoulboundSybilGuard prevents identity splitting to game the Lawson Floor.
- **Citation gaming**: Self-citation prohibited. Citation rings detectable via ContributionDAG graph analysis.
- **Evaluation collusion**: CRPC commit-reveal prevents evaluators from copying each other. Asymmetric cost (linear gain, quadratic loss) makes strategic deception unprofitable.
- **Flash loan protection**: Same-block interaction guards inherited from VibeSwap core.

---

*The math is the same for everyone. That's the point.*

---

*© 2026 Will Glynn. Published under Creative Commons BY-SA 4.0.*
