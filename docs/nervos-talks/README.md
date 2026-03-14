# VibeSwap Nervos Talks

Research papers and proposals for the Nervos CKB community, demonstrating VibeSwap's technical investment in the CKB ecosystem.

**Authors**: Faraday1, JARVIS
**Date**: March 2026
**Affiliation**: VibeSwap Research

---

## Reading Order

The papers are ordered from technical foundation to ecosystem vision. Start with the architecture overview, work through the specific mechanisms, and end with the big picture.

### 1. [VibeSwap on CKB: Technical Architecture](vibeswap-on-ckb-architecture.md)
How commit-reveal batch auctions map to CKB's Cell model. UTXO vs account model advantages. RISC-V verifiable shuffle. Codebase structure overview.

### 2. [Cell Model MEV Defense](cell-model-mev-defense.md)
Deep threat model analysis comparing MEV attack surfaces on EVM and CKB. Five adversary categories, six attack vectors, structural impossibility arguments.

### 3. [CKB DeFi Primitives](ckb-defi-primitives.md)
Catalog of seven DeFi primitives native to CKB but impossible or hard on EVM: native HTLC, multi-asset cells, type script composability, data-rich cells, light client swaps, PoW-gated state, self-custodial LP.

### 4. [PoW Shared State and VibeSwap](pow-shared-state-vibeswap.md)
How VibeSwap leverages Matt's PoW shared state proposal and recursive MMR for cell contention resolution. Forced inclusion protocol. Self-regulating difficulty economics.

### 5. [Knowledge Cells Proposal](knowledge-cells-proposal.md)
Proposal for verifiable AI inference on CKB. VibeSwap's Kalman filter oracle as proof-of-concept. 181-byte cell structure, PoW-gated updates, header chain linking, MMR history.

### 6. [CKB SDK Integration Guide](ckb-sdk-vibeswap-integration.md)
Developer guide for the VibeSwap CKB SDK. Transaction builders, type/lock script patterns, cell data layouts, Molecule schemas, annotated Rust code examples.

### 7. [Nervos and VibeSwap Synergy](nervos-vibeswap-synergy.md)
The big picture: why VibeSwap chose CKB, what we have built (15 crates, 9 scripts, 190 tests), governance participation plan, vision for CKB as omnichain settlement layer, road to mainnet.

---

## Quick Reference

| Paper | Focus | Audience |
|---|---|---|
| Architecture | How it works on CKB | Engineers, protocol designers |
| MEV Defense | Why CKB is safer than EVM | Security researchers, traders |
| DeFi Primitives | What CKB enables uniquely | Ecosystem developers |
| PoW Shared State | How contention is resolved | Infrastructure builders, miners |
| Knowledge Cells | Verifiable AI on CKB | AI/ML researchers, oracle operators |
| SDK Guide | How to build on VibeSwap | Application developers |
| Synergy | Why VibeSwap chose CKB | Community, governance, investors |

---

## CKB Codebase Stats

- **15 Rust crates** in the `ckb/` workspace
- **9 RISC-V scripts** compiled to `riscv64imac-unknown-none-elf`
- **190 passing tests** (integration, adversarial, fuzz, math parity)
- **All 7 implementation phases complete**
- **Molecule schemas** for all cell data types
- **SDK** with 9 transaction builder operations + mining client

---

*All papers reference VibeSwap's open-source CKB codebase. Technical review, adversarial analysis, and collaboration proposals are welcome.*
