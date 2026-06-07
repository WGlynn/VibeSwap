# Upstream Survey

Map of Nervos CKB open-source artifacts that VibeSwap pulls from. Every component in VibeSwap that has an upstream equivalent uses the upstream. We do not reinvent.

This file is a living index. Each entry names the upstream artifact, the version we depend on (or track), the license, the VibeSwap component that consumes it, and any wrapper or augmentation we add on top.

---

## Core Nervos CKB repositories

### `nervosnetwork/ckb`
- **Repo**: <https://github.com/nervosnetwork/ckb>
- **License**: MIT
- **Purpose**: The CKB full node. Consensus, networking, transaction pool, block validation, cell storage, RPC, the whole substrate.
- **VibeSwap use**: This is the upstream we fork. The sovereign VibeSwap chain is a fork of this with augmentations tracked in `AUGMENTATION_SURFACE.md`.
- **Track**: Pin a recent release tag, merge upstream releases on a regular cadence.

### `nervosnetwork/ckb-vm`
- **Repo**: <https://github.com/nervosnetwork/ckb-vm>
- **License**: MIT
- **Purpose**: RISC-V 64-bit virtual machine that executes lock-scripts and type-scripts.
- **VibeSwap use**: Inherited via `nervosnetwork/ckb`. No augmentation expected.

### `nervosnetwork/ckb-std`
- **Repo**: <https://github.com/nervosnetwork/ckb-std>
- **License**: MIT
- **Purpose**: Standard library for writing CKB scripts in Rust. Syscall wrappers, cell inspection, witness parsing.
- **VibeSwap use**: All our type-scripts and lock-scripts depend on `ckb-std`. Already used by `contracts-ckb/proof-of-mind-lock-script` and the PsiNet scripts.
- **Version pin**: Match the version compatible with the upstream `ckb` tag we're tracking.

### `nervosnetwork/ckb-script-templates`
- **Repo**: <https://github.com/nervosnetwork/ckb-script-templates>
- **License**: MIT
- **Purpose**: Cargo templates for creating CKB script crates with the right `no_std` setup, panic handler, allocator config.
- **VibeSwap use**: Scaffolding source when we add new crates to `contracts-ckb/`. Use as reference, not as runtime dep.

### `nervosnetwork/ckb-sdk-rs`
- **Repo**: <https://github.com/nervosnetwork/ckb-sdk-rs>
- **License**: MIT
- **Purpose**: Rust SDK for building CKB transactions, querying state, signing.
- **VibeSwap use**: Off-chain tooling, indexer integration, transaction construction for tests and clients.

### `nervosnetwork/ckb-system-scripts`
- **Repo**: <https://github.com/nervosnetwork/ckb-system-scripts>
- **License**: MIT
- **Purpose**: The system scripts that ship with CKB at genesis: secp256k1_blake160_sighash_all, secp256k1_blake160_multisig_all, dao.
- **VibeSwap use**: All authorization that can use secp256k1 should use these. Saves cell deployment cost and avoids reimplementing audited primitives.

---

## Token standards

### sUDT (Simple UDT)
- **Spec**: <https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0025-simple-udt/0025-simple-udt.md>
- **Reference impl**: <https://github.com/nervosnetwork/ckb-production-scripts/tree/master/c/simple_udt.c>
- **License**: MIT
- **Purpose**: Minimal user-defined token standard for CKB. Conservation invariant in type-script.
- **VibeSwap use**: JUL and VIBE tokens implemented as sUDT cells if we keep them in user-space (default plan per `AUGMENTATION_SURFACE.md`). Trading pairs in VibeAMM hold sUDT cells.

### xUDT (Extensible UDT)
- **Spec**: <https://github.com/nervosnetwork/rfcs/pull/380>
- **Reference impl**: <https://github.com/nervosnetwork/ckb-production-scripts/blob/master/c/xudt_rce.c>
- **License**: MIT
- **Purpose**: Extension of sUDT with regulation-compliance hooks (RCE). Allows blacklist/whitelist extensions, time locks, etc.
- **VibeSwap use**: Possibly for tokens that need governance hooks beyond conservation. Probably not the default; sUDT is enough for JUL/VIBE.

---

## Common lock-scripts

### Omnilock
- **Repo**: <https://github.com/nervosnetwork/ckb-production-scripts/tree/master/c/omni_lock.c>
- **Spec**: <https://github.com/cryptape/ckb-production-scripts/blob/master/docs/omnilock.md>
- **License**: MIT
- **Purpose**: Universal lock-script supporting multiple authentication methods: secp256k1, Ethereum-compatible ECDSA, BLS, RSA, anyone-can-pay, multi-sig, exec-callout for arbitrary custom logic.
- **VibeSwap use**: Default lock for user wallets. Supports Ethereum-style addresses (useful for cross-chain UX) and exec-callout for VibeSwap-specific auth shapes like signed-intent-with-deadline.

### Anyone-can-pay (ACP)
- **Repo**: <https://github.com/nervosnetwork/ckb-production-scripts/tree/master/c/anyone_can_pay.c>
- **License**: MIT
- **Purpose**: Lock that permits incoming transfers without owner signature, only requiring signature for spending.
- **VibeSwap use**: AMM pool deposits, contribution-graph staking, donation-shaped flows.

### secp256k1-blake160-sighash-all
- **Repo**: `nervosnetwork/ckb-system-scripts`
- **License**: MIT
- **Purpose**: Standard single-signer lock-script. Genesis-installed.
- **VibeSwap use**: Default for basic-shape wallets. Used where Omnilock's flexibility is overkill.

---

## Commitment and aggregation primitives

### ckb-merkle-mountain-range
- **Repo**: <https://github.com/nervosnetwork/merkle-mountain-range>
- **License**: MIT
- **Purpose**: Merkle Mountain Range data structure for append-only logs with succinct inclusion proofs.
- **VibeSwap use**: Attestation logs (MindMesh), contribution-history accumulators (ShapleyDistributor), batch-commit logs (CommitRevealAuction).

### Sparse-Merkle-Tree
- **Repo**: <https://github.com/nervosnetwork/sparse-merkle-tree>
- **License**: MIT
- **Purpose**: Sparse Merkle tree implementation with efficient inclusion and exclusion proofs.
- **VibeSwap use**: Authorization registries, validator-set commitments, contribution-mapping commitments.

---

## Cryptographic primitives

### secp256k1 (libsecp256k1)
- **Inherited via**: `ckb-system-scripts`
- **Purpose**: ECDSA signatures over secp256k1 curve.
- **VibeSwap use**: Standard wallet signatures, EVM-compatible auth via Omnilock.

### ed25519 (compact)
- **Crate**: `ed25519-compact` (already used in `proof-of-mind-lock-script/src/main.rs`)
- **License**: BSD
- **Purpose**: ed25519 signature verification suitable for `no_std` CKB script environment.
- **VibeSwap use**: PoM lock-script attestations. MindMesh peer signatures.

### BLS12-381
- **Candidate crate**: `blst` or `ark-bls12-381`
- **License**: Apache-2.0 (blst), MIT-Apache-2.0 dual (ark-bls12-381)
- **Purpose**: BLS signatures with aggregation, supports threshold schemes.
- **VibeSwap use**: MessagingHub bonded-validator threshold signatures (canonical burn-and-mint). Needs `no_std` audit before use in lock-scripts.
- **Status**: Not yet integrated. Needs validation that BLS verification fits within CKB-VM cycle limits.

### SPHINCS+
- **Status**: Scaffold-only in `primitive-cell-lock-script`. Listed as CYCLE5 (production work).
- **VibeSwap use**: Post-quantum authorship for PrimitiveCells.

### blake2b
- **Inherited via**: `ckb-std::syscalls` (CKB uses blake2b-256 as native hash).
- **VibeSwap use**: All hashing in lock-scripts and type-scripts.

---

## Tooling

### Capsule
- **Repo**: <https://github.com/nervosnetwork/capsule>
- **License**: MIT
- **Purpose**: Build system for CKB scripts. Wraps Cargo with the right cross-compile flags and produces deployable script binaries.
- **VibeSwap use**: Primary build tool for all `contracts-ckb/` crates.
- **Status**: Installation required on dev machine. Currently a known blocker.

### ckb-debugger
- **Repo**: <https://github.com/nervosnetwork/ckb-standalone-debugger>
- **License**: MIT
- **Purpose**: Standalone CKB-VM that runs scripts against test transactions, useful for debugging without a live node.
- **VibeSwap use**: Local unit testing of scripts. Used by `ckb-testtool` internally.

### ckb-testtool
- **Crate**: `ckb-testtool` 1.1.x (already in `contracts-ckb/tests/Cargo.toml`)
- **License**: MIT
- **Purpose**: Rust crate that scaffolds CKB transaction tests with `Context::deploy_cell`, `Context::complete_tx`, `Context::verify_tx`.
- **VibeSwap use**: All integration tests for our scripts. Already wired up in `tests/`.

### ckb-cli
- **Repo**: <https://github.com/nervosnetwork/ckb-cli>
- **License**: MIT
- **Purpose**: Command-line tool for wallet operations, transaction construction, deploy operations.
- **VibeSwap use**: Deploy scripts to devnet/testnet, manage genesis-derived accounts.

---

## Existing CKB DEX prior art

These are not directly upstream from Nervos Foundation but are CKB-ecosystem projects that have shipped DEX-shape mechanics. Worth reviewing for design patterns and to identify what to reuse vs avoid.

### Yokaiswap
- **Site**: <https://yokaiswap.com>
- **License**: Unknown (verify before reusing code)
- **Pattern**: AMM on CKB Layer 2 (Godwoken). Different substrate model than what we want, but useful for AMM-on-CKB design notes.
- **VibeSwap use**: Reference only. Our AMM lives on L1 cells, not L2.

### NervDEX / Nervina Labs work
- **Status**: Various early experimental DEX work on CKB.
- **VibeSwap use**: Reference only.

### Spore Protocol
- **Repo**: <https://github.com/sporeprotocol/spore-contract>
- **License**: MIT
- **Purpose**: NFT-shape primitive on CKB cells. Demonstrates cell-as-asset patterns with immutable content and updatable owner.
- **VibeSwap use**: Pattern reference for ownership-cells in LP-shares and PrimitiveCell-style assets.

---

## Open questions

- **BLS12-381 in `no_std` CKB-VM**: Does any pure-Rust BLS impl fit within the cycle limit for lock-script verification? Need spike before MessagingHub spec finalizes.
- **NCI consensus shape**: Application-layer cells consuming PoW + PoS + PoM signals, or substrate-level integration? Decision pending per `AUGMENTATION_SURFACE.md`.
- **Block-time predictability**: Does NC-Max's variable block time work for 10-second commit-reveal batches, or do we need parameterization?
- **State-rent at scale**: How does CKB capacity-pricing interact with a high-frequency commit-reveal stream? Do we need a sweep mechanism for expired commit-cells that didn't reveal?

---

## How to add an entry

When a new upstream artifact is identified:

1. Name the repo or spec, license, and purpose
2. Identify the VibeSwap component that consumes it
3. Note the version we pin or track
4. Note any wrapper or augmentation we add (link to the spec doc that describes the wrapper)
5. If it's a candidate (not yet committed), mark **Status** explicitly

If an entry turns out not to fit and we need to fork or replace, document the reason and move to "Replaced upstream" archive at the bottom.

---

## Replaced upstream

(None yet.)
