# Architecture

> System design — how VibeSwap's mechanisms compose into a coherent whole.

## Read this first

[**ckb-sovereign-vibeswap.md**](ckb-sovereign-vibeswap.md) — the active iteration target. VibeSwap is iterating from EVM-smart-contract architecture to a sovereign L1 modeled on Nervos CKB, augmented for VibeSwap requirements. Solidity-as-spec, CKB-as-sovereign-deployment. Per-component port-classification (DIRECT-PORT / REINTERPRET / DROP / UNRESOLVED). Pull from upstream, augment minimally. Living document. Started 2026-06-07.

The documents below describe the current Solidity-based mechanism design, which now functions as the formal spec layer for the sovereign chain. They remain authoritative for what each mechanism *does*. The cell-spec files at `../../contracts-ckb/specs/` describe how each mechanism is reinterpreted into the substrate-native shape.

## What lives here

Top-level documents describe cross-cutting design (consensus, mechanism composition, security) and their interaction. Subfolders drill into specific subsystems: oracle, CKB integration, autonomous agents, emission control, fractal-fork networking. If you want to understand *how the pieces fit together*, start here. If you want a single primitive in isolation, try [`../concepts/`](../concepts/) instead.

## Highlights

| Document | What it covers |
|---|---|
| [VIBESWAP_COMPLETE_MECHANISM_DESIGN.md](VIBESWAP_COMPLETE_MECHANISM_DESIGN.md) | Master architectural reference — every mechanism in composition |
| [CONSENSUS_MASTER_DOCUMENT.md](CONSENSUS_MASTER_DOCUMENT.md) | Consensus stack: NCI, three pillars, the six-layer airgap closure |
| [AUGMENTED_MECHANISM_DESIGN.md](AUGMENTED_MECHANISM_DESIGN.md) | Methodology — augment markets with math invariants, never replace |
| [AUGMENTED_GOVERNANCE.md](AUGMENTED_GOVERNANCE.md) | Hierarchy: Physics > Constitution > Governance |
| [SECURITY_MECHANISM_DESIGN.md](SECURITY_MECHANISM_DESIGN.md) | Security architecture across the stack |
| [MECHANISM_COMPOSITION_ALGEBRA.md](MECHANISM_COMPOSITION_ALGEBRA.md) | How mechanisms compose without breaking each other |
| [MECHANISM_COVERAGE_MATRIX.md](MECHANISM_COVERAGE_MATRIX.md) | Coverage map: which threats which mechanisms address |
| [FISHER_YATES_SHUFFLE.md](FISHER_YATES_SHUFFLE.md) | Deterministic settlement-order shuffle |
| [RECURSIVE_BATCH_AUCTIONS.md](RECURSIVE_BATCH_AUCTIONS.md) | Recursive batching across chains |
| [ASYMMETRIC_COST_CONSENSUS.md](ASYMMETRIC_COST_CONSENSUS.md) | Cost asymmetry as the consensus primitive |

## Subfolders

- `ckb/` — Nervos CKB integration design (DID-cell mapping, integration reports)
- `oracle/` — oracle architecture deliveries
- `autonomous-agent-architecture/` — agent runtime design
- `emission-controller/` — emission controller architecture and activation
- `fractal-fork-network/` — fractal-fork network design and 2026 plan
- `ipfs-contribution-graph-spec/` — IPFS-anchored contribution graph spec
- `features/`, `features-existing/`, `patterns/`, `patterns-existing/`, `protocols/`, `security/` — additional architecture surfaces

## When NOT to look here

- Standalone primitive write-ups (one mechanism, one doc) → [`../concepts/`](../concepts/)
- Formal proofs, theorems, and signed papers → [`../research/`](../research/)
- Build/deploy/integrate runbooks → [`../developer/`](../developer/)
- Audit reports and exploit analyses → [`../audits/`](../audits/)

See [`../INDEX.md`](../INDEX.md) for the canonical encyclopedia and [`../README.md`](../README.md) for top-level navigation.
