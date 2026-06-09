# FORK_PLAN.md - Nervos CKB → vibeswap-ckb Sovereign Fork

Operational plan for creating the sovereign VibeSwap chain by forking Nervos CKB upstream and applying the minimal augmentation set defined in `AUGMENTATION_SURFACE.md`.

Read first if you haven't:
- `../docs/architecture/ckb-sovereign-vibeswap.md` (architectural statement)
- `AUGMENTATION_SURFACE.md` (load-bearing list of changes vs upstream)
- `UPSTREAM.md` (artifacts we pull from)
- `specs/INDEX.md` (per-component cell specs catalog)

This document is operational: who clones what, where it lives, what gets patched, how it gets built and tested, in what order. The architectural rationale lives in the doc cited above; this is the playbook.

---

## Status

Pre-fork. No clone has been performed on this machine yet. This document is the plan, not a report. The first concrete action is Step 1 of Section 7 (clone the chosen upstream tag).

---

## Design preconditions

Four decisions were executed 2026-06-08. They are upstream of every step below. Reading them is the precondition for editing this plan.

- **Fork-vs-mainnet → Position F (fork).** `FORK_VS_MAINNET_ANSWER.md`. The chain is sovereign from genesis; chain-spec/ is critical-path.
- **NCI consensus shape → Position C (user-space app-layer boundary enforcement).** `NCI_CONSENSUS_ANSWER.md` plus `specs/nci-boundary-enforcement.md`. Substrate stays untouched; every vibeswap-app boundary lock/type-script mandates an `NCIScoreCell` cell-dep.
- **Reorg finality contract.** `REORG_BEHAVIOR_DESIGN.md`. Six per-decision-class finality thresholds encoded in `LawsonConstantsRegistry` and bounded by `ConstitutionalBoundsCell`.
- **Operations phasing (Phase 0–3).** `OPERATIONS.md`. The 3-validator bootstrap is the Day-0 chain; the Cincinnatus walkaway is the 12-month target.

---

## 1. Fork target identification

**Chosen tag**: `v0.206.0` of `nervosnetwork/ckb`, released 2026-05-06.

- Approximate short-commit observed on the GitHub releases page: `2c91814`. The authoritative full commit hash will be captured at clone time by running `git rev-parse v0.206.0` against the local fork and recorded back into this Section 1 at the time of fork execution.
- Release character: maintenance release. Dependency upgrades (notably `rustls-webpki` security patches), a fix in the rich-indexer, no consensus or protocol changes vs the v0.205.x line. This makes it a low-risk fork point: the consensus surface we may need to touch (per `AUGMENTATION_SURFACE.md`) has not just shifted.
- Why not absolute tip of `master`: tips drift. A tagged release gives a stable rebase target for our augmentation set and matches the Nervos upstream cadence we plan to track.
- Why not an older v0.119+ tag: the architectural doc named "v0.119+" as the floor, not the ceiling. The recent v0.20x series carries cumulative security patches and rich-indexer improvements relevant to off-chain tooling. Forking forward and rebasing back is harder than forking from the current stable tip.

**Rebase cadence**: when Nervos cuts the next stable tag (expected v0.207.x), we rebase our augmentation patches onto it within a 2-week window. Discipline is in `AUGMENTATION_SURFACE.md` rule 3.

**License**: MIT throughout, both `nervosnetwork/ckb` and every upstream artifact in `UPSTREAM.md`. No licensing blocker to forking, redistributing, or augmenting.

**Honest scope note**: the exact full commit SHA cannot be confirmed from this side without git access to the live remote. The tag `v0.206.0` is the authoritative reference; the SHA is a derivative we capture once the clone runs.

---

## 2. Repository layout (post-fork)

The fork preserves the upstream workspace structure verbatim. We do not reorganize Nervos's crates. Layout below was verified against `v0.206.0` on the Nervos repo:

```
vibeswap-ckb/                          (fork of nervosnetwork/ckb @ v0.206.0)
├── block-filter/                      # block filtering for light clients
├── chain/                             # chain controller, service, verify
│   └── src/
│       ├── chain_controller.rs
│       ├── chain_service.rs
│       ├── verify.rs                  # block verification entry path
│       └── ...
├── ckb-bin/                           # the `ckb` binary entry point
├── db/                                # RocksDB-backed storage layer
├── db-migration/
├── db-schema/
├── error/
├── freezer/                           # cold-storage of old blocks
├── miner/                             # PoW miner binary
├── network/                           # P2P, peer discovery, gossip
├── notify/
├── pow/                               # NC-Max / Eaglesong PoW
├── resource/
│   └── specs/
│       ├── dev.toml                   # local dev chain spec (we touch this)
│       ├── mainnet.toml
│       ├── mainnet.toml.asc
│       ├── preview.toml
│       ├── staging.toml
│       └── testnet.toml
├── rpc/                               # JSON-RPC API surface
├── script/                            # CKB-VM integration layer (NOT ckb-vm itself)
├── shared/
├── spec/                              # ChainSpec type + chain-spec loading code
│   ├── src/
│   ├── CHANGELOG.md
│   ├── Cargo.toml
│   └── README.md
├── store/
├── sync/                              # block sync protocol
├── traits/
├── tx-pool/                           # mempool
├── util/
│   ├── constant/
│   │   └── src/
│   │       ├── consensus.rs           # consensus constants (dust threshold etc.)
│   │       ├── default_assume_valid_target.rs
│   │       ├── latest_assume_valid_target.rs
│   │       ├── store.rs
│   │       ├── sync.rs
│   │       ├── lib.rs
│   │       ├── hardfork/
│   │       └── softfork/
│   └── types/src/core/                # cell.rs, blockchain.rs, reward.rs, etc.
│       ├── cell.rs
│       ├── blockchain.rs
│       ├── reward.rs
│       ├── fee_rate.rs
│       ├── transaction_meta.rs
│       ├── tx_pool.rs
│       ├── views.rs
│       └── hardfork/
├── verification/                      # block + tx verification rules
├── benches/
├── test/                              # integration tests
├── devtools/
├── docs/
├── docker/
├── Cargo.toml                         # workspace manifest (touched: name/version only)
├── Cargo.lock
├── rust-toolchain.toml
├── Makefile
├── build.rs
└── README.md                          # rebranded; preserves upstream credit
```

Adjacent to the fork, in our existing `vibeswap/` monorepo, we keep the application-layer scripts unchanged in shape:

```
vibeswap/
├── contracts-ckb/                     # application-layer cell scripts (this directory)
│   ├── specs/                         # cell-architecture specs
│   ├── primitive-cell-type-script/    # PsiNet scripts (existing)
│   ├── proof-of-mind-lock-script/     # existing
│   ├── FORK_PLAN.md                   # this file
│   ├── AUGMENTATION_SURFACE.md
│   └── UPSTREAM.md
└── ckb-fork/                          # the forked Nervos repo (sibling to contracts-ckb/)
    └── ... (everything from the layout above)
```

`ckb-fork/` is the substrate. `contracts-ckb/` is the protocol. They cross-reference through chain-spec files: genesis (`resource/specs/dev.toml` in the fork) registers our deployed system scripts (built from `contracts-ckb/<crate>/`) as cell-deps.

---

## 3. AUGMENTATION_SURFACE → upstream files mapping

For each item from `AUGMENTATION_SURFACE.md`, the specific upstream files that contain the code or configuration to patch:

### 3.1 Genesis configuration

**Files touched**:
- `resource/specs/dev.toml` (used for local devnet from day one)
- `resource/specs/mainnet.toml` (eventually, for sovereign mainnet; untouched until launch decision)
- `spec/src/` (the chain-spec loading code, only if we need to introduce new optional spec fields)

**Type**: configuration plus minor code support for new optional fields, if any.
**Risk**: low. Every L1 fork does this.

### 3.2 Native token model (three-token JUL / VIBE / CKB-native)

**Default path: user-space** (per `AUGMENTATION_SURFACE.md` decision).

**User-space mapping**:
- JUL → sUDT cell deployed at genesis, type-script-args = JUL issuer hash
- VIBE → sUDT cell deployed at genesis, type-script-args = VIBE issuer hash
- CKB-native → upstream consensus reward, unchanged

**Files touched (user-space path)**: only `resource/specs/dev.toml` to register the genesis cells holding JUL and VIBE issuer scripts. Zero Rust code change.

**Substrate-augmentation escape hatch (only if user-space proves insufficient)**:
- `util/types/src/core/reward.rs` (consensus-reward structure)
- `verification/src/` and the reward-distribution path in `chain/src/chain_service.rs` would need three-token reward split.
Track as an open question (Section 8) until the JUL/VIBE issuance spec is finalized.

### 3.3 NCI consensus integration (60 PoM / 30 PoS / 10 PoW)

**Resolved 2026-06-08: Position C — hybrid app-layer enforced at the vibeswap-app boundary.** See `NCI_CONSENSUS_ANSWER.md` for the full triad walkthrough; `specs/nci-boundary-enforcement.md` for the per-boundary invariants.

**User-space mapping**: NCI lives as application-layer cells that consume PoW outputs (block hashes from on-chain headers via CKB syscalls), PoS bonded-validator signatures (BLS12-381 in lock-scripts), and PoM attestations (ed25519 in lock-scripts). The aggregation cell publishes an `NCIScoreCell` that **every vibeswap-app boundary lock/type-script mandatorily references as a cell-dep**. Block production stays NC-Max + Eaglesong, unchanged.

**Files touched**: zero in `ckb-fork/`. All work happens in `contracts-ckb/` cell scripts plus the boundary-enforcement discipline in `specs/nci-boundary-enforcement.md`.

**Escalation trigger (now narrow)**: only revisit substrate-patching if operational data shows the boundary-enforcement pattern is bypassable in ways the three-pillar math intended to prevent (e.g., a 51% PoS+PoM collusion that routes around the seam pre-deposit). Not a near-term concern; tracked in `NCI_CONSENSUS_ANSWER.md` §6.

### 3.4 System scripts as substrate-level primitives

**Default path: keep all VibeSwap primitives user-deployable.** Per `AUGMENTATION_SURFACE.md`, "Surface stays clean."

**Files touched**: zero in `ckb-fork/`. Our scripts are deployed as user code-cells at genesis (registered as cell-deps in `dev.toml`) and referenced by hash from application transactions.

### 3.5 Network parameters (block time, capacity per block)

**Files touched (configuration-only)**:
- `resource/specs/dev.toml` for devnet timing tuned to 10-second commit-reveal batches
- `util/constant/src/consensus.rs` only if our parameter values fall outside the safe ranges encoded as constants. First default: try to express our timing requirements within the existing parameter space.

**Type**: configuration first, code only if configuration cannot express the requirement.
**Risk**: low if configuration suffices. Medium if we have to touch `consensus.rs` because that file is read by all consensus paths.

### 3.6 Dust threshold (per-cell minimum capacity)

**Files touched**:
- `resource/specs/dev.toml` — `min_cell_capacity` field if exposed at the chain-spec layer for the dev chain
- `util/constant/src/consensus.rs` — `MIN_CELL_CAPACITY` constant if it must be reduced for VibeSwap's smaller commit-cells (raise eyebrows first; the upstream value exists for spam resistance reasons)

**Type**: configuration first; code change only if the default is incompatible with our cell sizes.
**Risk**: low to medium. Touching dust threshold has cascading economic effects; document any change carefully.

---

## 4. Per-augmentation patch strategy

Default principle: every augmentation defaults to user-space. Substrate patches are last-resort and must be justified against the user-space alternative.

| Augmentation | Default | If escalated to substrate, why |
|---|---|---|
| Genesis configuration | Substrate (config-only, `resource/specs/dev.toml`) | Genesis is definitionally substrate. No user-space alternative exists. |
| Three-token model | User-space (sUDT for JUL and VIBE) | Escalate only if a consensus-reward split into three tokens proves required for protocol-level supply commitments. Open question; not yet escalated. |
| NCI consensus | User-space, mandatorily cell-dep'd at vibeswap-app boundary (Position C) | Escalate only if boundary-enforcement is shown bypassable in ways the three-pillar math intended to prevent. Operational-data question, not near-term. |
| System scripts | User-deployable (code-cells, cell-dep refs) | Never escalate. The whole point of CKB's design is that user-deployable scripts are first-class. |
| Network params (block time) | Substrate (config-only, `dev.toml`) | Block-time parameters are consensus-level by construction. Configuration suffices; no code change unless we exceed the safe range. |
| Dust threshold | Substrate (config-only, `dev.toml`) | Configuration suffices if exposed; only touch `consensus.rs` if our cells can't fit within the configurable range. |

**Net summary**: in the best case the fork is **configuration-only** (genesis + network params + dust threshold all expressible in `resource/specs/dev.toml`). That is the most credible version of "Nervos CKB augmented to meet VibeSwap specifications" and the target we aim for. Any code-level escalation gets its own justification block added to `AUGMENTATION_SURFACE.md`.

---

## 5. Cell-spec → CKB-VM bytecode pipeline

How we go from the spec docs in `contracts-ckb/specs/` to actual deployable RISC-V code.

**Script language: Rust via `ckb-script-templates`** is the primary choice. Justification:

- All existing `contracts-ckb/` scripts (`primitive-cell-type-script`, `proof-of-mind-lock-script`, etc.) are already Rust + `ckb-std`.
- `no_std` Rust compiles cleanly to RISC-V 64-bit, the CKB-VM target.
- The cryptographic deps we need (`ed25519-compact` already used in PoM; `blst` or `ark-bls12-381` for BLS) have working `no_std` Rust paths.
- Rust gives us reusable crates for the shared code surfaces named in `specs/INDEX.md`: `vibeswap-ckb-bls`, `vibeswap-ckb-sudt-ext`, `vibeswap-ckb-shapley-axioms`, `vibeswap-ckb-fixed-point`.

**Build tool**: `capsule` from `nervosnetwork/capsule`. This is the established CKB-script build system. Already named as a known blocker in `UPSTREAM.md` (installation required on dev machine).

**Alternative considered and rejected**: Capsule + C (`ckb-c-stdlib`) for components where cycle budget is critical. Rejected for now because (a) we already have a Rust toolchain working in `contracts-ckb/`, (b) Rust gives stronger invariant enforcement, (c) cycle-budget concerns concentrate in BLS verification, which is solved by linking `blst` rather than hand-writing C.

**Pipeline stages**:

1. **Spec** (`contracts-ckb/specs/<mechanism>.md`) — read by humans; defines cell architecture, type-script invariants, lock-script auth, transaction shapes.
2. **Crate scaffold** (`contracts-ckb/<mechanism>/`) — Cargo crate created from `ckb-script-templates`, depending on `ckb-std` and the relevant shared crates from `specs/INDEX.md`.
3. **Implementation** — Rust source in `src/main.rs`. Tests in `tests/` using `ckb-testtool`.
4. **Build** — `capsule build` (or `cargo build` with the correct RISC-V target) produces a binary at `build/release/<mechanism>`.
5. **Deploy at genesis** — binary referenced from `resource/specs/dev.toml` as a system cell, with code_hash committed.
6. **Reference from app transactions** — application transactions cite the deployed cell by type_id or data_hash via `cell_deps`. Lock or type script `args` parameterize each instance.

**Shared-crate sequencing**: build `vibeswap-ckb-fixed-point` and `vibeswap-ckb-sudt-ext` first (simplest, broadest dependents). `vibeswap-ckb-bls` second (gated on the BLS12-381 cycle-budget spike flagged in `UPSTREAM.md` and `specs/INDEX.md`). `vibeswap-ckb-shapley-axioms` third (needs ShapleyDistributor design freeze).

---

## 6. Local testing approach

Three layers, each with a different tool:

**Unit (script-level)**: `ckb-debugger` (`nervosnetwork/ckb-standalone-debugger`). Runs a single script against a synthetic transaction. Used for tight-loop iteration on lock-script and type-script logic. No node required.

**Integration (transaction-level)**: `ckb-testtool` Rust crate, already wired into `contracts-ckb/tests/Cargo.toml`. Pattern:
- `Context::deploy_cell(binary)` registers a script
- `Context::create_cell(...)` constructs input cells
- Build the transaction with `TransactionBuilder`
- `Context::complete_tx(tx)` resolves cell-deps
- `Context::verify_tx(&tx, MAX_CYCLES)` runs the full CKB-VM verification

Each spec gets at least: a positive-case test (transaction validates), a negative-case test per invariant the type-script enforces, and a cycle-budget test (consumed cycles < MAX_CYCLES).

**End-to-end (chain-level)**: a local devnet running the actual `ckb-fork` binary, configured via `resource/specs/dev.toml` with our system cells at genesis. Plan:
1. `cd ckb-fork && cargo build --release` — produce the `ckb` binary from our fork
2. `./target/release/ckb init --chain dev` — generate dev config
3. `./target/release/ckb run` — start the node
4. `./target/release/ckb miner` in a second terminal — produce blocks
5. Use `ckb-cli` (from `nervosnetwork/ckb-cli`) or a `ckb-sdk-rs`-based harness to submit application transactions
6. Verify expected state transitions through the indexer

This is the layer where commit-reveal-batch timing, AMM swap flows, and ShapleyDistributor end-to-end behavior get validated.

---

## 7. Fork execution checklist

Ordered steps to actually create the fork. Run from `C:/Users/Will/vibeswap/`.

**Day 0 Will-action blocker**: Visual Studio Build Tools (MSVC C++ workload) must be installed on the dev workstation before Step 5 (`cargo build --release`) succeeds — the `ckb` build chain depends on a native C linker. This is the single blocking precondition for the fork's first boot. Until it's installed, Steps 1–4 are runnable (clone + branch + edit) but Step 5 fails.

The Phase-0 three-validator bootstrap (Node 1 = Will home, Node 2 = Hetzner, Node 3 = JARVIS/GCP) and its 7-day operational checklist are specified in `OPERATIONS.md` §2 and §10. This Section 7 stands up Node 1; `OPERATIONS.md` extends the chain to the 3-validator Phase-0 set.

1. **Clone upstream at v0.206.0**:
   ```bash
   git clone --branch v0.206.0 --single-branch \
     https://github.com/nervosnetwork/ckb.git ckb-fork
   cd ckb-fork && git rev-parse HEAD > ../contracts-ckb/.fork-commit
   ```
   Record the full commit hash from `.fork-commit` into Section 1 of this document.

2. **Initialize as our repo**:
   ```bash
   cd ckb-fork
   git remote remove origin
   git remote add upstream https://github.com/nervosnetwork/ckb.git
   git remote add origin https://github.com/wglynn/vibeswap-ckb.git   # create the GH repo first
   git checkout -b vibeswap-master
   ```
   `upstream` stays pointed at Nervos for rebase pulls. `origin` is our fork.

3. **Minimal rebrand (commit 1)**:
   - `README.md`: prepend a "VibeSwap CKB Fork" header preserving upstream credit, MIT license, and a link to `contracts-ckb/FORK_PLAN.md`
   - `Cargo.toml` workspace metadata: leave crate names untouched (preserves upstream rebase compatibility); add a workspace-level comment naming the fork
   - Commit message: `chore: rebrand fork from nervosnetwork/ckb v0.206.0`

4. **First augmentation: dev genesis (commit 2)**:
   - Edit `resource/specs/dev.toml`: change `name` to `ckb_vibeswap_dev`, set a VibeSwap-specific genesis-block message, leave consensus parameters at upstream defaults for the first build
   - Commit message: `feat(genesis): VibeSwap dev chain spec`

5. **Build the fork**:
   ```bash
   cd ckb-fork
   rustup show     # ensure rust-toolchain.toml is honored
   cargo build --release
   ./target/release/ckb --version
   ```
   First success = binary produced. First failure = upstream tooling drift; investigate before patching further.

6. **First devnet smoke test**:
   ```bash
   ./target/release/ckb init --chain dev --import-spec resource/specs/dev.toml
   ./target/release/ckb run &
   ./target/release/ckb miner &
   ckb-cli rpc get_tip_block_number
   ```
   Expected: tip increases. If yes, the fork is alive.

7. **Application-layer first test**: from `contracts-ckb/`, deploy `proof-of-mind-lock-script` to the local devnet, construct a transaction using it, verify the lock-script passes. This validates the application <-> substrate seam.

8. **Set rebase cadence**: add a `Makefile` target `rebase-upstream` that fetches `upstream/master`, rebases `vibeswap-master`, and runs the test suite. Document the rebase procedure in `ckb-fork/REBASE_PROCEDURE.md` (created at this step).

9. **Update this document**: replace Section 1's short-hash with the full commit hash captured in step 1; mark this Section 7 as Done in any relevant tracker; commit.

---

## Minimum-viable-first-iteration milestones (post-fork)

These layer on top of the Section-7 checklist and describe the smallest meaningful milestones after the fork is alive.

**Milestone 1: Devnet up, identical to upstream.** Clone, build, run a single-node devnet with no VibeSwap changes. Verify block production and a basic transaction send. Establishes the build environment (Capsule, ckb-debugger, ckb-cli) and the upstream baseline against which all augmentations are diff-able.

**Milestone 2: Genesis configuration changed.** Replace upstream's dev genesis with a VibeSwap genesis. Single-node devnet still runs, with our network ID and our initial cell allocation. Tests the merge-from-upstream-with-our-genesis pattern.

**Milestone 3: First VibeSwap type-script deployed.** Deploy `lawson-constants` type-script (smallest, simplest spec) to the VibeSwap devnet. Construct a transaction that creates a ConstitutionalBoundsCell and a ConstantsRegistryCell. Validates that our `contracts-ckb/` crates compile to RISC-V, deploy to our chain, and verify against transactions.

**Milestone 4: PoM lock-script integration.** Deploy the existing `proof-of-mind-lock-script` to the VibeSwap devnet. Cycle 4 RSAW already shipped this code, gated only on toolchain. This milestone unblocks the toolchain blocker recorded in `contracts-ckb/README.md`.

After Milestone 4, iteration continues by speccing → implementing → deploying additional mechanisms in priority order. CommitRevealAuction is the highest-leverage next implementation because most other mechanisms either consume its output (Shapley fee distribution) or compose with it (VibeAMM batch settlement).

---

## Required local environment

For implementation work to begin, the following must be installed and verified on the dev machine:

- **Rust** with the `riscv64imac-unknown-none-elf` target (`rustup target add riscv64imac-unknown-none-elf`). Toolchain version per the locked `rust-toolchain.toml` of the chosen ckb upstream tag.
- **C compiler** (MinGW gcc OR MSVC Build Tools C++ workload on Windows). Required for the ckb-testtool dependency chain and possibly for `blst` if we use BLS via the C reference impl.
- **Capsule** (`cargo install ckb-capsule`). The CKB script build tool.
- **ckb-debugger** (`cargo install --git https://github.com/nervosnetwork/ckb-standalone-debugger ckb-debugger`).
- **ckb-cli** (build from `nervosnetwork/ckb-cli`).
- **gh CLI** (already in use for the Odysseus campaign).

Recorded blockers per `contracts-ckb/README.md` (still pending — all Will-side actions):
- **VS Build Tools (MSVC C++ workload) not installed** — Day-0 blocker per Section 7; gates the `ckb` node build, not just script crates.
- `rust-toolchain.toml` pin (nightly-2024-09-01) too old for current Capsule.
- Capsule not installed.

---

## 8. Open questions for Will

The four design resolutions on 2026-06-08 (see "Design preconditions") closed the largest of the previously-open questions. What remains below is the residual set that still shapes fork-execution.

1. **GitHub repo for the fork**: do we host `vibeswap-ckb` under `wglynn/` (matching the existing `vibeswap` org pattern) or under a new `vibeswap-ckb/` org? Visibility: public from day one, or private until first end-to-end test passes? Default assumption in Section 7 step 2: `wglynn/vibeswap-ckb`, private at first per the existing fork-plan stance. Confirm or override.

2. **Three-token model: user-space sUDT vs substrate consensus-reward split**. Default plan (held): user-space sUDT for JUL and VIBE; CKB-native reward distribution untouched per `[F·jul-is-primary-liquidity]`. Substrate escalation remains the named escape hatch but is un-scoped. Decision still needed before MessagingHub spec finalizes.

3. **Block-time parameter**: 10-second commit-reveal batches need block-time predictability. NC-Max upstream uses variable block time. Two paths: (a) keep variable block time, build commit-reveal tolerance into the application layer; (b) parameterize block time toward a tight band in our `dev.toml`. Path (a) is configuration-zero on the substrate; the chain-spec currently sits at (a). Spike needed before (b) gets specified.

4. **Dust threshold**: defer until `commit-reveal-auction.md`, `vibe-amm.md`, and the other specs surface concrete cell-size numbers.

5. **Rebase cadence**: 2-week window after every Nervos stable tag is the proposed cadence (Section 1). The pre-existing `FORK_PLAN.md` said quarterly. Pick one.

6. **Capsule installation on Windows**: gated on the VS Build Tools blocker above. Once VS Build Tools is in place, the known-good Capsule install path on Windows is the next operational question; WSL/Docker fallback is the alternative.

7. **BLS12-381 cycle-budget spike**: gates `vibeswap-ckb-bls` and therefore MessagingHub, CircuitBreaker, and SlashRouter. Same item in `UPSTREAM.md`. Run in parallel with fork-execution — BLS-dependent components are not on the critical path for the first devnet smoke test.

8. **License**: Nervos CKB is MIT. VibeSwap can be MIT or Apache-2.0 with no upstream license conflict. Confirm MIT for `vibeswap-ckb` to match upstream.

9. **Validator-set bootstrap (operational)**: who runs Nodes 1/2/3 in the Phase-0 set per `OPERATIONS.md` §2? The default-named-roles are Will-home / Hetzner / JARVIS-on-GCP; confirm or override. Operator names for Phase-1 (5-validator open set) are explicitly **not** committed at this stage; they're tracked under `OPERATIONS.md` §3.

---

## What this fork plan is not

This document does not commit to implementation timelines. It does not authorize taking the actions in Section 7 without Will-approval at each milestone. It describes the path; Will-supervision authorizes traversal.

The fork plan is the operational doc that translates the architectural statement into actionable steps. It is not a substitute for `AUGMENTATION_SURFACE.md` (which authorizes specific changes), `UPSTREAM.md` (which catalogs upstream dependencies), or the per-component specs (which describe what we're building).

---

## Cross-references

- Architectural statement: `vibeswap/docs/architecture/ckb-sovereign-vibeswap.md`
- Augmentation surface: `vibeswap/contracts-ckb/AUGMENTATION_SURFACE.md`
- Upstream survey: `vibeswap/contracts-ckb/UPSTREAM.md`
- Specs catalog: `vibeswap/contracts-ckb/specs/INDEX.md`
- Workspace README: `vibeswap/contracts-ckb/README.md`
- Memory primitive: `[J·vibeswap-ckb-sovereign-pivot]`
- Upstream: `https://github.com/nervosnetwork/ckb` (tag `v0.206.0`)
