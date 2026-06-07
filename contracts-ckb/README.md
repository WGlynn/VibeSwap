# contracts-ckb — CKB-Sovereign VibeSwap workspace

> **Active iteration target (2026-06-07)**: sovereign L1 modeled on Nervos CKB,
> augmented for VibeSwap requirements. See
> [`../docs/architecture/ckb-sovereign-vibeswap.md`](../docs/architecture/ckb-sovereign-vibeswap.md)
> for the architectural statement,
> [`AUGMENTATION_SURFACE.md`](AUGMENTATION_SURFACE.md) for the explicit set of
> changes against upstream Nervos, [`UPSTREAM.md`](UPSTREAM.md) for the survey
> of Nervos upstream artifacts we pull from, and
> [`specs/`](specs/) for per-component cell specs (CommitRevealAuction, VibeAMM,
> ShapleyDistributor, MessagingHub shipped; more pending).

This workspace originally housed the **deep-canonical track** of the PsiNet
primitive economy (Cycle 4 RSAW dispatch, 2026-05-24), parallel to the EVM
Solidity contracts in `vibeswap/contracts/psinet/`. The PsiNet scaffolds
continue to live here as DIRECT-PORT candidates per the sovereign pivot. The
broader DEX-core (CommitRevealAuction, VibeAMM, ShapleyDistributor,
MessagingHub) is now in scope and being specced in `specs/`.

## Status — read this first

- **SPEC + SCAFFOLD ONLY.** No CKB devnet deployments. No tests run. No
  Capsule build verified on this machine (Capsule may not be installed).
- The Rust files compile **in principle** against the documented toolchain;
  this has not been validated end-to-end on the developer's machine.
- Multiple scripts fail-closed with `*Unimplemented` errors on cryptographic
  primitives (SPHINCS+ verify, ed25519 verify, CRPC witness parse). These
  are explicit `CYCLE5:` markers — production work, not bugs.
- The EVM Solidity track is more mature today. Do not interpret these
  scaffolds as "production-ready CKB" anything.

Full spec doc: `vibeswap/docs/research/papers/psinet-ckb-cell-model-canonical-spec.md`

## Crates inventory

| Crate | Purpose | Status |
|---|---|---|
| `primitive-cell-type-script` | Structural invariants on PrimitiveCell | Scaffold |
| `primitive-cell-lock-script` | Post-quantum authorship sig (SPHINCS+) | Scaffold; PQ verify is CYCLE5 |
| `datatoken-cell-type-script` | UDT conservation + genesis 850K/100K/50K split | Scaffold |
| `lineage-vault-cell-type-script` | Royalty accumulator + settlement transitions | Scaffold; CRPC witness CYCLE5 |
| `escrow-vault-cell-type-script` | JUL bond + slash on CRPC dispute | Scaffold; CRPC witness CYCLE5 |
| `proof-of-mind-lock-script` | Cognitive-work attestation (WWWD gate fires + mesh attestations) | Scaffold; ed25519 verify CYCLE5 |

## Toolchain setup

Per Nervos Capsule docs (https://docs.nervos.org/docs/labs/capsule):

1. **Install Rust + RISC-V target**:
   ```bash
   rustup install nightly-2024-09-01
   rustup target add riscv64imac-unknown-none-elf --toolchain nightly-2024-09-01
   rustup component add rust-src --toolchain nightly-2024-09-01
   ```
   (The exact channel pinned in `rust-toolchain.toml` may need updating
   to whatever current Capsule expects.)

2. **Install Capsule**:
   ```bash
   cargo install ckb-capsule
   ```
   Reference: https://github.com/nervosnetwork/capsule

3. **Install ckb-debugger** (for unit-test runs against the verifier):
   ```bash
   cargo install --git https://github.com/nervosnetwork/ckb-standalone-debugger ckb-debugger
   ```

4. **Set up local devnet** (optional, for integration tests):
   ```bash
   # ckb-cli or docker-compose-based devnet
   # See https://docs.nervos.org/docs/devchain/devchain-via-nodes
   ```

## Build commands

> All commands below are **untested in this repo state.** They reflect the
> documented Capsule workflow; if they fail, the underlying scaffold may
> need toolchain or dep-version adjustments.

```bash
# Build all script binaries (RISC-V64)
cd vibeswap/contracts-ckb
capsule build --release

# Build a single script
capsule build --release --name primitive-cell-type-script

# Alternative direct cargo build (without Capsule wrapper)
cargo build --release --target riscv64imac-unknown-none-elf
```

Output binaries land at `build/release/<script-name>` (Capsule convention)
and become deployable code-cells via `ckb-cli wallet transfer`.

## Devnet testing

The canonical CKB script test loop is via the `ckb-testtool` crate inside the
sibling `tests/` workspace member. **Scaffolded 2026-05-24** with three real
test fns covering `primitive-cell-type-script` (happy-path mint + two
adversarial cases against `ForkDepthExceeded` and `StatusTransitionInvalid`).
See `contracts-ckb/tests/README.md` for current status, including the
honest blockers (toolchain pin mismatch + missing C compiler + Capsule
binaries not yet built — each test does a `[CYCLE5 SKIP]` early-return
rather than falsely passing).

Current shape:

```
contracts-ckb/
  Cargo.toml                  (workspace - tests/ now a member)
  tests/
    Cargo.toml                (uses ckb-testtool 1.1)
    README.md
    src/
      lib.rs                       (module roots, load_script_binary! macro)
      primitive_cell_type_tests.rs (3 fns; the other 5 scripts = CYCLE5)
```

Each script test fixture follows the same recipe:
1. `capsule build --release` produces the script binary
2. Deploy as a code-cell via `Context::deploy_cell`
3. Construct happy-path + adversarial transactions via
   `TransactionBuilder` and `Context::complete_tx`
4. Assert `Context::verify_tx` returns Ok / the expected error code

## Workspace layout

```
contracts-ckb/
├── Cargo.toml                         # workspace root
├── rust-toolchain.toml                # nightly-2024-09-01 + riscv64imac target
├── README.md                          # this file
├── primitive-cell-type-script/
│   ├── Cargo.toml
│   └── src/main.rs
├── primitive-cell-lock-script/
│   ├── Cargo.toml
│   └── src/main.rs
├── datatoken-cell-type-script/
│   ├── Cargo.toml
│   └── src/main.rs
├── lineage-vault-cell-type-script/
│   ├── Cargo.toml
│   └── src/main.rs
├── escrow-vault-cell-type-script/
│   ├── Cargo.toml
│   └── src/main.rs
└── proof-of-mind-lock-script/
    ├── Cargo.toml
    └── src/main.rs
```

## Substrate-port-pattern note

Per `feedback_account-model-agnostic.md`:

| Property | EVM impl (Cycles 1-3) | CKB impl (this dir) |
|---|---|---|
| PrimitiveNFT identity | ERC-721 storage struct | PrimitiveCell data + type script |
| Datatoken conservation | ERC-20 `_balances` + restricted mint role | type-script `Σ(in) ≥ Σ(out)` |
| Lineage royalty accumulation | UUPS contract + storage mapping | LineageRoyaltyVaultCell + transition rules |
| Bond + slash | EscrowVault UUPS + AccessControl router | EscrowVaultCell + CRPC witness |
| Authorship sig | ECDSA (Ethereum-bound) | SPHINCS+ post-quantum lock script |
| PoM unlock | (no EVM equivalent — CKB-canonical) | proof-of-mind-lock-script |

Both tracks are bridged via VibeSwap's canonical burn-and-mint cross-chain
messaging (`contracts/messaging/`).

## Honest open questions for Cycle 5+

1. **PQ signature port.** SPHINCS+ (or chosen successor) verifier in
   ckb-std no_std environment. Stack/heap budget on the CKB VM is tight;
   reference impls may need substantial trimming.
2. **CRPC witness schema.** Cross-substrate canonical schema for
   "TaskSettled" attestations needs to land in the canonical-messaging
   stack before lineage-vault + escrow-vault scripts can verify witnesses.
3. **Cell-dep lookups.** Several CYCLE5: markers assume `parent.fork_depth`
   readable via cell-dep. Helper for this pattern needs to be specced
   and ported.
4. **Mesh validator set governance.** `mesh_validator_set_root` in PoM
   lock-script args is currently immutable per cell. Rotation policy needs
   spec (rolling root via CitationAnchor-style epoch cells?).
5. **Tests workspace.** ckb-testtool fixtures present for
   `primitive-cell-type-script` (3 fns: 1 happy-path + 2 adversarial).
   Five remaining scripts still need their own test modules; pattern
   established in `tests/src/primitive_cell_type_tests.rs`. None of
   the existing tests have **executed** against real script binaries
   yet — see `tests/README.md` blocker list.
6. **Capsule build verification.** None of the scaffolds have been
   run through `capsule build` on the developer's machine. First task
   when Capsule is installed: confirm every crate compiles to RISC-V64.

## Cycle 4 origin

This scaffold was produced by Cycle 4 Agent O of the RSAW psinet-mindmesh
dispatch (2026-05-24), as the parallel-canonical track to the EVM Solidity
Cycles 1-3 deliverables. Report: `audits/psinet-mindmesh-cycle-4/agent-O-ckb-spec.md`.
