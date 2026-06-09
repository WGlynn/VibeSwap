# Chain-Build README — vibeswap-ckb

Per Will course-correction 2026-06-08 18:47 ET: *"no we are building a blockchain not contracts"* (saved as [F·blockchain-not-contracts]).

This README orients any future session (human or AI) to the chain-build work in progress. We are building the actual vibeswap-ckb blockchain. Cell-specs serve the chain-build; they are not the deliverable.

---

## Two-layer architecture

```
┌─────────────────────────────────────────────────────────┐
│ Layer 2 — vibeswap-ckb chain (THE chain we're building)│
│   • Forked from nervosnetwork/ckb v0.206.0              │
│   • Augmented at config layer (chain-spec/dev.toml)     │
│   • NCI consensus integrated via user-space cells       │
│   • Native deployable nodes                             │
└─────────────────────────────────────────────────────────┘
                          ▲
                          │ deploys
                          │
┌─────────────────────────────────────────────────────────┐
│ Layer 1 — Cells (the protocol primitives, in Rust)      │
│   • datatoken-cell-type-script (PsiNet, shipped)        │
│   • primitive-cell-lock-script (PsiNet, shipped)        │
│   • primitive-cell-type-script (PsiNet, shipped)        │
│   • escrow-vault-cell-type-script (PsiNet, shipped)     │
│   • lineage-vault-cell-type-script (PsiNet, shipped)    │
│   • proof-of-mind-lock-script (PsiNet, shipped)         │
│   • vibeswap-canonical-token-type-script (in progress)  │
│   • [more cells: NCI, MessagingHub-impl, etc.]          │
└─────────────────────────────────────────────────────────┘
                          ▲
                          │ specced in
                          │
┌─────────────────────────────────────────────────────────┐
│ Layer 0 — Specs (what each cell does, as docs)          │
│   • contracts-ckb/specs/INDEX.md                        │
│   • 9 specs draft: commit-reveal, vibe-amm, shapley,    │
│     messaging-hub, nci-consensus, lawson-constants,     │
│     circuit-breaker, slash-router, pairwise-verifier    │
│   • + 6 match-or-beat-CoW extension specs               │
└─────────────────────────────────────────────────────────┘
```

**Spec ≠ chain-build**. Specs are the design docs. Chain-build is the Rust code + the node fork.

---

## What's shipped (real artifacts on disk)

### Layer 0 (specs, in `specs/`)
- 9 base specs + 6 match-or-beat extensions, all marked Draft. Use these as the source of truth for cell invariants.
- INDEX.md tracks status. PairwiseVerifier promoted to Draft 2026-06-08.

### Layer 1 (cells, in this directory)
- 6 PsiNet cells shipped (2026-05-24): `datatoken/`, `primitive-cell-{lock,type}-script/`, `escrow-vault/`, `lineage-vault/`, `proof-of-mind-lock-script/`
- 1 cell in progress: `vibeswap-canonical-token-type-script/` (sUDT-compatible canonical token, 2026-06-08)
- Workspace: `Cargo.toml` at `contracts-ckb/` root, ckb-std 0.16, release profile stripped + LTO
- Tests directory: `tests/`

### Layer 2 (chain, in progress)
- `chain-spec/vibeswap-ckb-dev.toml` (2026-06-08): augmented dev.toml, TIER 1 config-only augmentation, 7 TODO Will-decide markers
- `chain-spec/README.md` (2026-06-08): design philosophy + per-section walkthrough
- `FORK_PLAN.md` (2026-06-08): execution checklist for forking `nervosnetwork/ckb v0.206.0` into `vibeswap-ckb-fork/`
- `AUGMENTATION_SURFACE.md`: 6 augmentation candidates, default to config-only, escalate to Rust only when load-bearing
- `UPSTREAM.md`: Nervos artifacts we pull from

### Fork status
- FORK_PLAN.md Section 7 Step 1-3 (clone + branch + cargo build) in execution as of 2026-06-08 ~18:50 ET
- See `Desktop/fork-execution-step-1-3-log-2026-06-08.md` for results

---

## What's not yet built (Layer 1 cells that need Rust scaffolds)

Each spec needs a Rust crate. Priority order:

1. **`vibeswap-canonical-token-type-script/`** — in progress 2026-06-08 (sUDT base for cross-chain messaging)
2. **`lawson-constants-cell-type-script/`** — DIRECT-PORT, simplest first, gates other cells
3. **`messaging-hub-cells/`** — the actual IMessagingHub implementation (was specced as `messaging-hub.md`, never implemented). Probably 3-4 cells: `CanonicalTokenCell`, `BurnReceiptCell`, `ValidatorRegistryCell`, `AttestationCell` (already specced; just need Rust)
4. **`commit-reveal-auction-cells/`** — `CommitCell`, `RevealCell`, `BatchSettlementCell`, `SlashCell`
5. **`vibe-amm-cells/`** — `PoolCell`, `VibeLPCell`, `TwapObservation`, `Breaker integration`
6. **`shapley-distributor-cells/`** — `ContributionEventCell`, `ShapleyDistributionCell`, `RewardClaimCell`, `EmissionSchedule`, `SybilGuard`
7. **`nci-consensus-cells/`** — `PoWAnchorCell`, `StakeWeightedVoteCell`, `PoMAttestationCell`, `NCIScoreCell`, `ProtocolDecisionCell` (Rust design in progress, see `consensus-integration/NCI_RUST_DESIGN.md`)
8. **`circuit-breaker-cells/`** — `BreakerCell`, `BreakerAttestationCell`, `BreakerResumeQueueCell`
9. **`slash-router-cells/`** — `TaskVerdictCell`, `SlashEventCell`, `DispatchedTaskRegistryCell`, `BondCell`
10. **`pairwise-verifier-cells/`** — `VerificationTaskCell`, `Work{Commit,Reveal}Cell`, `Comparison{Commit,Reveal}Cell`, `TaskVerdictCell` (per spec, 2026-06-08)

---

## What's not yet built (Layer 2 chain components beyond config)

- BLS aggregation pipeline (Agent 9's BLS spike concluded Path 1+3 user-space + off-chain aggregation; implementation plan queued as Task 29)
- ckb-debugger + ckb-testtool integration test harness (Task 27): SETUP.md + first canonical-token test scaffolded 2026-06-08 (`contracts-ckb/test-infra/SETUP.md`, `tests/src/vibeswap_canonical_token_tests.rs`). Source compiles; VM execution gated on RISC-V binary build + C-toolchain install on dev machine.
- Genesis cell deployment scripts (post-chain-spec, post-fork)
- Boot scripts for `ckb run --chain vibeswap-ckb-dev.toml`

---

## How to add a new cell crate

Match the pattern of existing scaffolds (e.g., `datatoken-cell-type-script/`):

```toml
# Cargo.toml
[package]
name = "<your-cell>-cell-type-script"
version.workspace = true
edition.workspace = true
authors.workspace = true
license.workspace = true
publish.workspace = true

[[bin]]
name = "<your-cell>-cell-type-script"
path = "src/main.rs"

[dependencies]
ckb-std = { workspace = true }
# Add others as needed
```

Then add to `contracts-ckb/Cargo.toml` workspace `members = [...]` array.

Build: `cd contracts-ckb && cargo build --release --target riscv64imac-unknown-none-elf` (per CKB convention).

---

## Discipline for chain-build work

Per [F·blockchain-not-contracts]:
- ✗ More cell specs in spec-shape (the specs are good enough; build them)
- ✓ Rust crate scaffolds in `contracts-ckb/<name>/`
- ✓ chain-spec TOML augmentations (in `chain-spec/`)
- ✓ Actual `ckb run` smoke tests once the fork is buildable
- ✗ Treating the contracts/ EVM directory as the artifact-of-record (it's aspirational-spec per [P·repo-as-aspirational-spec])

Per [F·burn-compute-toward-mission]: when in doubt, ship Rust code over more docs.

Per [F·full-leverage-only-moves]: pick the next cell that's the most-load-bearing for shipping the smoke-test chain, not the one that's easiest. Order suggested above.

---

## Open Will-questions

Aggregated from agent outputs (see `~/.claude/WILL_PENDING_DECISIONS.md`):

- vibeswap-ckb-dev.toml has 7 TODO Will-decide markers (genesis timestamp, deployer faucet/JUL/VIBE/Lawson multisig args, max_block_cycles, epoch_duration_target)
- FORK_PLAN.md has 9 open Qs (repo visibility, three-token lock-in, NCI shape confirm, block-time, rebase cadence, Capsule install, BLS sequencing, fork naming, license)
- PairwiseVerifier spec has 7 open Qs (cycle budget tally, settlement enum, AgentRegistry gating, PoM, reward denomination, tie-break, witness serialization)
- BLS implementation Q3 is THE blocker: canonical serialization of attestation digest

---

## Next-session boot checklist

When booting into chain-build mode:
1. Read this file
2. Check `Desktop/fork-execution-step-1-3-log-2026-06-08.md` — is `vibeswap-ckb-fork/` ready?
3. Check `chain-spec/vibeswap-ckb-dev.toml` TODO markers — any resolved by Will overnight?
4. Pick next cell from priority list (Section "What's not yet built (Layer 1)")
5. Match existing scaffold pattern
6. Spawn agent (if multi-agent mode) or implement directly
7. Smoke test if a meaningful subset is buildable: `cd contracts-ckb && cargo build --release`

Stay in chain-build mode until the smoke-test chain boots + a Hello-World-cell transaction confirms in a local dev block.
