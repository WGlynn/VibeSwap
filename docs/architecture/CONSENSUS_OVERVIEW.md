# Consensus Overview

> A reader's map of VibeSwap's six-mechanism consensus stack — what each layer does, what it guarantees, and how the layers compose to close the on-chain ↔ off-chain credibility gap.

This is the orientation document. For depth, see [`CONSENSUS_MASTER_DOCUMENT.md`](CONSENSUS_MASTER_DOCUMENT.md). For the formal accountability frame, see [`AUGMENTED_GOVERNANCE.md`](AUGMENTED_GOVERNANCE.md). For the methodology behind every choice here, see [`AUGMENTED_MECHANISM_DESIGN.md`](AUGMENTED_MECHANISM_DESIGN.md).

---

## 1. The 6-Mechanism Consensus Stack

VibeSwap does not use *one* consensus mechanism. It composes six, each addressing a distinct failure mode that earlier-generation DEXs leak through:

| # | Mechanism | One-line Role | Primary Source |
|---|-----------|---------------|----------------|
| 1 | **Commit-Reveal Batch Auctions** | Hide order intent until everyone is locked in; settle as a uniform-clearing batch. | [`contracts/core/CommitRevealAuction.sol`](../../contracts/core/CommitRevealAuction.sol) |
| 2 | **L1 Anchor (LayerZero V2)** | Cross-chain message + settlement substrate. Anchors batch results across chains. | [`contracts/messaging/CrossChainRouter.sol`](../../contracts/messaging/CrossChainRouter.sol) |
| 3 | **Proof-of-Mind (PoM)** | Cumulative cognitive contribution as Sybil-resistant vote weight. | [`contracts/core/ProofOfMind.sol`](../../contracts/core/ProofOfMind.sol) |
| 4 | **Siren Protocol** | Honeypot bait + cryptographic trap that makes attacking the protocol structurally unprofitable. | [`contracts/core/HoneypotDefense.sol`](../../contracts/core/HoneypotDefense.sol), [`contracts/core/OmniscientAdversaryDefense.sol`](../../contracts/core/OmniscientAdversaryDefense.sol) |
| 5 | **Shapley-Null Clawback** | Null-player axiom enforced — anyone whose marginal contribution is zero earns zero, eliminating wash-Sybil yield extraction. | [`contracts/incentives/ShapleyDistributor.sol`](../../contracts/incentives/ShapleyDistributor.sol) |
| 6 | **Clawback Cascade** | Tainted-fund propagation across linked wallets; recovers extracted value through the laundering graph. | [`contracts/compliance/ClawbackRegistry.sol`](../../contracts/compliance/ClawbackRegistry.sol) |

These are not redundant defenses. Each closes a *different* attack class that the other five cannot address on their own.

---

## 2. Airgap Closure Thesis

Standard blockchains have a structural gap: **the chain knows nothing about reality.** An attacker can submit perfectly-valid on-chain transactions while their off-chain behaviour (front-running, oracle manipulation, multi-account self-dipping) is invisible to the protocol.

VibeSwap's stack closes this gap not by adding more on-chain surveillance but by making **honesty the only profitable strategy** — a structural property, not a moral claim. When dishonesty is unprofitable across every attack vector, the on-chain ≡ off-chain trust boundary dissolves: rational attackers don't exist as a class because there's no rational attack.

The stack composition is the airgap closure:

- **Layer 1 (Commit-Reveal)** removes the information advantage that enables MEV.
- **Layer 2 (L1 Anchor)** binds settlement to a multi-chain substrate; no chain-isolated reorg recovers a profitable extraction.
- **Layer 3 (PoM)** prices reputation in cumulative cognitive work — Sybil farms can't buy their way past it.
- **Layer 4 (Siren)** turns adversarial probing into a self-incriminating economic loss.
- **Layer 5 (Shapley-Null)** withholds reward from any actor whose marginal value is zero — the null-player axiom from cooperative game theory, enforced on-chain.
- **Layer 6 (Clawback Cascade)** recovers extracted value across the wallet-link graph, so even successful extraction has negative expected value once the cascade resolves.

See also: [`../concepts/primitives/`](../concepts/primitives/) for the primitive-level write-ups, especially [`generation-isolated-commit-reveal.md`](../concepts/primitives/generation-isolated-commit-reveal.md) and [`bonded-permissionless-contest.md`](../concepts/primitives/bonded-permissionless-contest.md).

---

## 3. Per-Batch Lifecycle

Every 10 seconds, the protocol resolves a batch. The cadence is calibrated to the human+bot substrate's ~10-second characteristic attention time (see [`CommitRevealAuction.sol:90-104`](../../contracts/core/CommitRevealAuction.sol)) — short enough to feel synchronous, long enough that even attentive human committers can ship a reveal without losing to HFT infra.

```
    0s              8s             10s          ~10s+1blk
    │               │               │               │
    ▼               ▼               ▼               ▼
┌──────────────┬──────────────┬──────────────┬──────────────┐
│   COMMIT     │   REVEAL     │   SETTLE     │  CLEARED     │
│   (8s)       │   (2s)       │   (perm-less)│              │
└──────────────┴──────────────┴──────────────┴──────────────┘
   hash(order   reveal+secret  Fisher-Yates    uniform price
   ‖ secret)    + priority      shuffle from   applied to all
   + deposit    bid (opt.)      XOR'd secrets  matched orders
                                + block entropy
```

- **COMMIT (0–8s)** — `keccak256(order || secret)` + ETH deposit. Nobody (not validators, not the protocol) can read intent. Constants live at [`CommitRevealAuction.sol:108-114`](../../contracts/core/CommitRevealAuction.sol).
- **REVEAL (8–10s)** — Reveal order + secret + optional priority bid. Hash mismatch ⇒ 50% deposit slash. Priority bid pays into the cooperative fee distribution path (see Section 5 of [`AMM_OVERVIEW.md`](AMM_OVERVIEW.md)).
- **SETTLE (permissionless)** — Anyone can call `settleBatch()` ([`CommitRevealAuction.sol:796`](../../contracts/core/CommitRevealAuction.sol)). Order resolution uses Fisher-Yates over XOR'd secrets seeded with `blockhash(revealEndBlock)` and a 1-block gap so the last revealer can't grind the seed (TRP-R17-F04, [`CommitRevealAuction.sol:810-829`](../../contracts/core/CommitRevealAuction.sol)).
- **Uniform clearing** — All matched orders execute at one batch-cleared price. No first-mover advantage.

Deeper read: [`FISHER_YATES_SHUFFLE.md`](FISHER_YATES_SHUFFLE.md), [`RECURSIVE_BATCH_AUCTIONS.md`](RECURSIVE_BATCH_AUCTIONS.md).

---

## 4. Failure Modes Addressed

| Failure Class | Mechanism(s) That Close It |
|---|---|
| MEV / front-running / sandwich attacks | Commit-Reveal (intent hidden), uniform clearing (no ordering bonus), priority-bid auction (MEV redirected to LPs) |
| Oracle manipulation | TWAP gate, AMM-05 cross-window drift gate, TruePriceOracle freshness, OracleAggregationCRA commit-reveal opacity. See [`ORACLE_OVERVIEW.md`](ORACLE_OVERVIEW.md). |
| Sybil farming / wash trading for rewards | Shapley-Null axiom ([`ShapleyDistributor.sol:32`](../../contracts/incentives/ShapleyDistributor.sol)), PoM cumulative-work weighting, SoulboundSybilGuard |
| Governance capture | Augmented governance hierarchy: Physics (Shapley invariants) > Constitution > DAO. See [`AUGMENTED_GOVERNANCE.md`](AUGMENTED_GOVERNANCE.md). |
| Last-revealer seed grinding | TRP-R17-F04 1-block gap before settlement ([`CommitRevealAuction.sol:810-818`](../../contracts/core/CommitRevealAuction.sol)) |
| Cross-chain replay | Per-message destination-chain encoding, settlement confirmation callback ([`CrossChainRouter.sol:62-69`](../../contracts/messaging/CrossChainRouter.sol)) |
| Adversarial probing of defenses | Siren / HoneypotDefense — probing the trap is itself the loss |
| Laundering of extracted value | Clawback Cascade across wallet-link graph ([`ClawbackRegistry.sol:410`](../../contracts/compliance/ClawbackRegistry.sol)) |

See [`MECHANISM_COVERAGE_MATRIX.md`](MECHANISM_COVERAGE_MATRIX.md) for the full threat × mechanism matrix.

---

## 5. Critical Invariants

What each mechanism mathematically guarantees (not "tries to enforce" — guarantees structurally):

| Mechanism | Invariant |
|---|---|
| Commit-Reveal | Order intent is information-theoretically hidden until reveal; valid commits are bound to a single batch. |
| Fisher-Yates Shuffle | Settlement order is a uniform random permutation of revealed orders, conditional on `blockhash(revealEndBlock)` being unknown at reveal time. |
| Uniform Clearing | All matched orders in a batch execute at a single price; no ordering bonus exists. |
| Proof-of-Mind | Vote weight = `0.3·stake + 0.1·PoW + 0.6·mind_score`; mind_score grows logarithmically and cannot be purchased ([`ProofOfMind.sol:31-44`](../../contracts/core/ProofOfMind.sol)). |
| Shapley Distribution | Five axioms: Efficiency, Symmetry, Null-Player, Pairwise Proportionality, Time Neutrality (FEE_DISTRIBUTION track) ([`ShapleyDistributor.sol:29-42`](../../contracts/incentives/ShapleyDistributor.sol)). |
| Clawback Cascade | Tainted funds remain tainted across transfers up to a bounded cascade depth — extraction has no clean exit. |

Formal proofs live in [`../research/theorems/`](../research/theorems/) — see especially [`THE_FAIRNESS_FIXED_POINT.md`](../research/theorems/THE_FAIRNESS_FIXED_POINT.md), [`THE_POSSIBILITY_THEOREM.md`](../research/theorems/THE_POSSIBILITY_THEOREM.md), and [`KOLMOGOROV_COMPLEXITY_OF_ATTRIBUTION.md`](../research/theorems/KOLMOGOROV_COMPLEXITY_OF_ATTRIBUTION.md).

---

## 6. Cross-References

- **Concept depth (one mechanism per doc)** → [`../concepts/`](../concepts/)
  - Security primitives: [`../concepts/security/`](../concepts/security/), especially [`SIREN_PROTOCOL.md`](../concepts/security/SIREN_PROTOCOL.md), [`CIRCUIT_BREAKER_DESIGN.md`](../concepts/security/CIRCUIT_BREAKER_DESIGN.md), [`FLASH_LOAN_PROTECTION.md`](../concepts/security/FLASH_LOAN_PROTECTION.md), [`CLAWBACK_CASCADE_MECHANICS.md`](../concepts/security/CLAWBACK_CASCADE_MECHANICS.md), [`FIBONACCI_SCALING.md`](../concepts/security/FIBONACCI_SCALING.md)
  - Identity / Sybil: [`../concepts/identity/`](../concepts/identity/), especially [`PROOF_OF_CONTRIBUTION.md`](../concepts/identity/PROOF_OF_CONTRIBUTION.md), [`NCI_WEIGHT_FUNCTION.md`](../concepts/identity/NCI_WEIGHT_FUNCTION.md), [`SOCIAL_SCALABILITY_VIBESWAP.md`](../concepts/identity/SOCIAL_SCALABILITY_VIBESWAP.md)
  - Oracles: [`../concepts/oracles/`](../concepts/oracles/) — covered in [`ORACLE_OVERVIEW.md`](ORACLE_OVERVIEW.md)
- **Formal proofs and theorems** → [`../research/theorems/`](../research/theorems/)
- **Companion overviews** → [`AMM_OVERVIEW.md`](AMM_OVERVIEW.md), [`ORACLE_OVERVIEW.md`](ORACLE_OVERVIEW.md)
- **Composition rules between mechanisms** → [`MECHANISM_COMPOSITION_ALGEBRA.md`](MECHANISM_COMPOSITION_ALGEBRA.md)

---

*The protocol does not require participants to be good. It makes extraction mathematically unprofitable — so individual optimization naturally produces collective welfare.*
