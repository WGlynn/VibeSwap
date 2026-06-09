# lawson-constants-cell-type-script

CKB type-script enforcing the **Lawson constitutional pipeline** on the
sovereign VibeSwap-CKB chain. Direct port of
`vibeswap/contracts/governance/LawsonConstantsRegistry.sol` to the CKB
cell model.

## What this is

A scaffold of the on-chain authority check for the three Lawson-constants
cells. One binary, role-multiplexed by `type_script.args[0]`:

- **ConstitutionalBoundsCell** (role tag `0x01`) — immutable post-genesis.
  Encodes `(name_hash, min_value, max_value, alpha_min, alpha_max)` per
  constant.
- **ConstantsRegistryCell** (role tag `0x02`) — governance-tunable within
  bounds. Encodes `(name_hash, value, alpha, last_updated_at_block)` per
  constant + a `bounds_cell_outpoint` reference.
- **ConstantsHistoryCell** (role tag `0x03`) — append-only audit trail of
  every value change.

## What this is NOT

- **Not audit-ready.** Marked `TODO` inline in three load-bearing places:
  1. BoundsCell genesis-only enforcement currently relies on
     "no input bearing this script", not a header-dep on block 0. A
     malicious miner who can construct a genesis-shaped tx post-launch
     could mint a competing BoundsCell. The lock-script is expected to
     close that gap (provably-unspendable, genesis-only).
  2. BoundsCell cell-dep lookup uses data-shape heuristics, not the
     code-hash of the deployed script binary. An adversary could provide
     a forged shape-matched cell as cell-dep.
  3. ConstantsHistoryCell's new-entry `decision_id` field is trusted —
     the type-script does not verify it corresponds to the
     ProtocolDecisionCell consumed in the same tx. Out-of-bounds value
     changes are still rejected by the registry-cell type-script, so the
     gap is bounded to "history can be falsified about which decision
     authorized a legitimate change", but should be tightened.
- **Not the ProtocolDecisionCell verifier.** That lives in the NCI
  consensus stack (see `specs/nci-consensus.md`); the Lawson type-script
  delegates authorization to the lock-script, which gates on the NCI
  decision cell when shipped.
- **Not a substitute for the existing Solidity
  `LawsonConstantsRegistry.sol` on EVM chains.** Both implementations
  enforce the same constitutional-pipeline invariants but in different
  substrates. The Solidity contract is also covered by 34 green Foundry
  tests (`test/governance/LawsonConstantsRegistry.t.sol`); this Rust
  scaffold has no equivalent yet (test-spec stub only, see Tests below).

## Lineage

This crate is the simplest DIRECT-PORT in the Layer 1 priority list per
`contracts-ckb/CHAIN_BUILD_README.md`. It is the second cell to land in
the chain-build pivot, after `vibeswap-canonical-token-type-script`
(2026-06-08).

Per [P·constitutional-pipeline-scaffolding] the three-layer architecture
(physics > constitution > governance) is structurally enforced in three
distinct cells, not collapsed into one — this is what makes the Lawson
Floor a load-bearing invariant rather than a tunable parameter.

## Invariants enforced (per role)

### ConstitutionalBoundsCell (`0x01`)
- Cannot appear as input. Single-deploy + freeze; the only way to
  "change a bound" is a hardfork (deploy new BoundsCell + new genesis).
- For each output: `min_value <= max_value`, `alpha_min <= alpha_max`.
- Schema version + bound-count layout validated.

### ConstantsRegistryCell (`0x02`)
- For each constant in output: `min_value <= value <= max_value` and
  `alpha_min <= alpha <= alpha_max`, looked up against the BoundsCell
  via cell-dep.
- Each `name_hash` in the registry must exist in the BoundsCell
  (rejects unknown constants).
- Cannot be destroyed (input present implies output present).
- On update: exactly one constant changes per tx; unchanged constants'
  `last_updated_at_block` is byte-identical to input; the set of
  `name_hash` keys is identical to input (the constant set is fixed at
  genesis).

### ConstantsHistoryCell (`0x03`)
- Append-only: output entry-count == input entry-count + 1.
- The first N entries of the output must be byte-identical to the input
  (no rewrites of prior history).
- New entry's `at_block` >= previous tail's `at_block` (monotonic).
- Cannot be destroyed.
- At genesis (no input), entry-count must be 0.

## Error codes

See `src/error.rs`. Summary:
- 1-4: ckb-std passthrough
- 50-53: cell-shape invariants (malformed data, unsupported schema,
  malformed args, capacity exceeded)
- 60-63: BoundsCell invariants (consumed, minted post-genesis, range
  inverted)
- 70-77: RegistryCell invariants (out-of-bounds value/alpha, unknown
  name, BoundsCell mismatch, unchanged-constant mutated, multi-
  constant update, set mutated, destroyed)
- 80-84: HistoryCell invariants (truncated, multi-entry, rewritten,
  non-monotonic, destroyed)

## Build

The build path matches the rest of `contracts-ckb/`. Two known
approaches:

### Via `capsule` (Nervos-canonical for CKB scripts)

```bash
# from contracts-ckb/
capsule build --release
# emits: contracts-ckb/build/release/lawson-constants-cell-type-script
```

### Via raw cargo (RISC-V target)

```bash
# from contracts-ckb/
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p lawson-constants-cell-type-script
```

The workspace already pins `riscv64imac-unknown-none-elf` in
`rust-toolchain.toml` and uses `ckb-std 0.16` workspace-wide.

## Known build blockers (honest)

The crate **source** is reviewable today. Actually producing the RISC-V
binary on the current dev machine has the same blockers as the rest of
`contracts-ckb/` (documented in `tests/README.md`):

1. **Toolchain pinning.** `rust-toolchain.toml` pins
   `nightly-2024-09-01`. Some transitive deps of `ckb-testtool` now
   require Rust 1.85+. Workaround: `RUSTUP_TOOLCHAIN=stable` for the
   test harness; keep the nightly pin for the on-chain crates.
2. **C compiler not on PATH.** `ckb-testtool` pulls `blake2b-rs`
   which needs `cc`. MinGW-w64 or MSVC Build Tools required. Not
   installed on the current machine.
3. **`capsule` not installed.** Required for the canonical build path.
   Listed as a known blocker in `UPSTREAM.md`.

Until the above are cleared, this crate is in the same state as its
siblings: **source-reviewable, not yet machine-verified**.

## Deploy

Three-step pattern:

1. **Deploy the script binary** as a CKB code-cell. Once deployed, the
   code-cell's outpoint becomes the canonical reference for every
   Lawson-constants cell.
2. **Construct cells** with `type_script.code_hash =
   blake2b256(code-cell-data)`, `type_script.hash_type = data1`, and
   `type_script.args = [role_tag, ...]`:
   - `args = [0x01]` for ConstitutionalBoundsCell
   - `args = [0x02]` for ConstantsRegistryCell
   - `args = [0x03]` for ConstantsHistoryCell
3. **Genesis distribution.** The BoundsCell + initial RegistryCell +
   empty HistoryCell are minted in the chain's genesis transaction
   per `chain-spec/vibeswap-ckb-dev.toml`.

## Tests

See `tests/test_basic.rs`. The integration tests live in the
workspace's `tests/` crate and follow the pattern documented in
`contracts-ckb/tests/README.md` — they use `ckb-testtool` and depend
on the Capsule-built binary being present. Until then they emit
`[CYCLE5 SKIP]` rather than falsely pass.

## Cross-references

- Spec: `vibeswap/contracts-ckb/specs/lawson-constants.md`
- EVM source: `vibeswap/contracts/governance/LawsonConstantsRegistry.sol`
- EVM tests (34/34 green): `vibeswap/test/governance/LawsonConstantsRegistry.t.sol`
- Math reference: `vibeswap/docs/research/proofs/THE_LAWSON_FLOOR_MATHEMATICS.md`
- Mechanism primitives:
  `[P·constitutional-pipeline-scaffolding]`,
  `[P·augmented-governance]`,
  `[P·structure-does-the-work]`
- Companion specs:
  `specs/nci-consensus.md` (ProtocolDecisionCell for updates),
  `specs/circuit-breaker.md` (circuit-breaker thresholds live here),
  `specs/vibe-amm.md` (consumes `fee_rate`, `MAX_TWAP_DRIFT_BPS`, ...)
- Latest-pattern reference crate:
  `vibeswap-canonical-token-type-script/` (shipped 2026-06-08)
