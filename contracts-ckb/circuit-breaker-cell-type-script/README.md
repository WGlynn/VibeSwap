# circuit-breaker-cell-type-script

CKB type-script enforcing the **multi-level circuit-breaker triad** on
the sovereign VibeSwap-CKB chain. REINTERPRET port of
`vibeswap/contracts/core/CircuitBreaker.sol` to the CKB cell model.

## What this is

A scaffold of the on-chain authority check for the three circuit-breaker
cells. One binary, role-multiplexed by `type_script.args[0]`:

- **BreakerCell** (role tag `0x01`) — live state for one
  `(mechanism, signal)` breaker. Holds counter, threshold, state
  (Clear/Tripped/Resuming), cooldown, attestation quorum, and the
  per-window counter.
- **BreakerAttestationCell** (role tag `0x02`) — multi-attester
  trip-clear evidence. BLS-aggregated signatures from a quorum of
  validators that the underlying condition has cleared. One-shot:
  minted by the resume-request tx, consumed in the same tx.
- **BreakerResumeQueueCell** (role tag `0x03`) — FIFO post-cooldown
  resume order. Consumed by the resume-finalize tx once
  `eligible_at_block` has elapsed.

## What this is NOT

- **Not audit-ready.** Marked `TODO` inline in five load-bearing
  places:
  1. LawsonConstantsRegistry cell-dep discovery is shape-heuristic
     (version-byte + minimum-length match), not code-hash matching.
     An adversary could supply a forged registry cell. Same gap as
     `lawson-constants-cell-type-script`'s `find_bounds_cell_dep`.
  2. NCI ValidatorRegistry cell-dep discovery is the
     second-shape-match heuristic, not code-hash matching. Distinguish
     by code-hash once the NCI consensus crates land.
  3. **BLS aggregated signature verification is NOT performed.** The
     scaffold validates only shape-level invariants on the attestation
     cell (length, version, breaker-id match, quorum count from
     bitmap, staleness window). The actual pairing check is delegated
     to the workspace `bls-verify` crate per
     `specs/bls12-381-cycle-budget-spike.md` and is gated until that
     crate's `verify_aggregated` is wired in.
  4. Header-dep block-height comparisons are not wired. The finalize
     transition delegates the current-block-vs-cooldown check to the
     ResumeQueueCell's `eligible_at_block` field rather than
     re-deriving from the live block header. Eligibility math is
     verified for internal consistency (eligible = requested +
     cooldown), but a forged "requested_at" in the future can defer
     the check by the same amount it lies. Audit gate.
  5. Cross-tx referential integrity is shape-only: the
     ResumeQueueCell's `attestation_outpoint` field is not verified to
     point at the actually-consumed AttestationCell. The same-tx
     pairing IS verified (BreakerCell transition Tripped -> Resuming
     finds the attestation by breaker_id in `Source::Input`), so the
     gap is bounded to "queue cell can encode a wrong outpoint",
     which is observability noise rather than a state-corruption
     vector — but should be tightened.

- **Not the BLS verifier.** Lives in the workspace `bls-verify` crate
  (per workspace `Cargo.toml`). The circuit-breaker scaffold delegates
  attestation verification to that crate when it ships.

- **Not the NCI consensus.** Validator-set membership + rotation
  authority lives in `nci-consensus-cells/` (Layer 1 priority 7 per
  `CHAIN_BUILD_README.md`). This crate only consumes the
  ValidatorRegistryCell via cell-dep.

- **Not a substitute for the existing Solidity `CircuitBreaker.sol`
  on EVM chains.** This is the CKB-native re-interpretation per the
  [J·vibeswap-ckb-sovereign-pivot] direction. The EVM Solidity
  implementation continues to exist and is the reference spec; this
  Rust scaffold has no test coverage yet (test-spec stub only, see
  Tests below).

## Lineage

Per `contracts-ckb/CHAIN_BUILD_README.md`, this is Layer 1 priority 8:
`circuit-breaker-cells`. Ships after `lawson-constants-cell-type-script`
because the breaker reads thresholds + cooldowns + quorum sizes from
the Lawson registry via cell-dep. Pattern matches the latest landed
scaffold (Lawson, 2026-06-08).

Per `[P·circuit-breaker-attested-resume]` the asymmetric trip-vs-resume
property is the load-bearing structural invariant: an attacker can
trigger a trip as a side-effect of attempted exploitation, but cannot
resume in the same flash-window. The substrate enforces both halves
via the three-cell decomposition, NOT via a monolithic guard.

## Composition (executed defaults)

- **Threshold source = LawsonConstantsRegistry** (cell-dep). Three
  constants are consumed dispatched on `signal_type`:
  `volume_breaker_bps`, `price_breaker_bps`, `withdrawal_breaker_bps`.
  The BreakerCell's `threshold` field is projected from Lawson at
  mint-time. The type-script's `validate_threshold_against_lawson`
  currently requires the Lawson cell-dep to be PRESENT (proves
  composition wiring) but does NOT yet enforce equality between the
  projected threshold and the live Lawson value (TODO inline).

- **Cooldown duration = LawsonConstantsRegistry** (`breaker_cooldown_blocks`).
  The BreakerCell's `cooldown_blocks` field is projected from Lawson
  at mint-time. The eligibility math `eligible_at = requested_at +
  cooldown` is enforced exactly between the ResumeQueueCell and
  BreakerCell on the finalize transition.

- **Attester identity = NCI ValidatorRegistry** (cell-dep). The
  attestation's `signer_bitmap` indexes into the NCI validator set;
  the BLS aggregated signature verifies against the validator-set's
  BLS pubkeys.

- **Attestation quorum = 3** (executed default, matches NCI minimum-
  validator-rotation). Encoded in the BreakerCell's
  `attestation_quorum` field. The type-script enforces this as a floor
  (`DEFAULT_ATTESTATION_QUORUM = 3`).

- **Resume policy = FIFO**, ordered by `sequence_num` on the
  ResumeQueueCell. Multiple queued resumes for the same breaker are
  serviced in monotonic-sequence order; the type-script rejects
  output queue cells whose sequence_num is non-increasing.

- **Asymmetric trip vs resume**:
  - **Trip**: any single tx that crosses `current_counter > threshold`
    triggers `Clear -> Tripped` in the same tx. No quorum, no cooldown.
    Pure output-side invariant: state must be Tripped (or Resuming)
    whenever counter > threshold.
  - **Resume**: 3-of-N attestations + cooldown + finalize. Resume
    request consumes the AttestationCell; finalize consumes the
    matured ResumeQueueCell; counter resets to 0 on transition to
    Clear.

## Invariants enforced (per role)

### BreakerCell (`0x01`)
- Cannot be destroyed (input present implies output present).
- `breaker_id`, `mechanism_id`, `signal_type`, `threshold`,
  `counter_window_blocks`, `cooldown_blocks`, `attestation_quorum`
  are immutable across input/output transitions.
- `counter_window_start` is monotonic non-decreasing.
- State transitions are restricted to the legal set:
  - `Clear -> Clear` (counter update)
  - `Clear -> Tripped` (threshold crossed; tripped_at_block must be set)
  - `Tripped -> Tripped` (no-op while waiting for attestation)
  - `Tripped -> Resuming` (requires AttestationCell with matching
    breaker_id consumed in the same tx, quorum met, not stale)
  - `Resuming -> Resuming` (no-op while waiting for cooldown)
  - `Resuming -> Clear` (requires ResumeQueueCell consumed in the same
    tx with valid eligibility math; counter must reset to 0)
- If `current_counter > threshold` AND `state == Clear` on the output,
  the trip MUST be fired (rejected: code 62).
- LawsonConstantsRegistry cell-dep must be present (proves wiring;
  equality enforcement gated CYCLE5).

### BreakerAttestationCell (`0x02`)
- Layout validated (version, bitmap-length consistency).
- ValidatorRegistry cell-dep must be present.
- Per-attestation invariants checked at the BreakerCell transition
  site (not here): breaker_id match, quorum from bitmap, staleness
  window vs tripped_at_block.
- BLS pairing verification gated CYCLE5 (delegated to `bls-verify`).

### BreakerResumeQueueCell (`0x03`)
- Layout validated (length, version).
- FIFO ordering: `sequence_num` strictly monotonic across outputs.
- Eligibility math: `eligible_at_block >= resume_requested_at`. Exact
  equality `eligible = requested + breaker.cooldown_blocks` enforced
  at the BreakerCell finalize transition site.

## Error codes

See `src/error.rs`. Summary:

- 1-4: ckb-std passthrough.
- 50-54: cell-shape invariants (malformed data, unsupported schema,
  malformed args, capacity exceeded, unknown enum discriminant).
- 60-69: BreakerCell invariants (destroyed, id mutated, trip-not-
  fired, illegal transition, tripped-at-block missing, counter-window
  invariant, threshold-mismatch, resume-missing-attestation,
  cooldown-not-elapsed, resume-queue-missing).
- 70-74: BreakerAttestationCell invariants (breaker-id mismatch,
  quorum not met, stale, signature invalid, leaked).
- 80-84: BreakerResumeQueueCell invariants (breaker-id mismatch,
  eligibility wrong, order violated, attestation outpoint missing,
  immature).
- 90-91: composition invariants (Lawson registry missing,
  ValidatorRegistry missing).

## Build

The build path matches the rest of `contracts-ckb/`. Two known
approaches:

### Via `capsule` (Nervos-canonical for CKB scripts)

```bash
# from contracts-ckb/
capsule build --release
# emits: contracts-ckb/build/release/circuit-breaker-cell-type-script
```

### Via raw cargo (RISC-V target)

```bash
# from contracts-ckb/
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p circuit-breaker-cell-type-script
```

The workspace already pins `riscv64imac-unknown-none-elf` in
`rust-toolchain.toml` and uses `ckb-std 0.16` workspace-wide.

## Known build blockers (honest)

The crate **source** is reviewable today. Actually producing the
RISC-V binary on the current dev machine has the same blockers as the
rest of `contracts-ckb/` (documented in `tests/README.md`):

1. **Toolchain pinning.** `rust-toolchain.toml` pins
   `nightly-2024-09-01`. Some transitive deps of `ckb-testtool` now
   require Rust 1.85+. Workaround: `RUSTUP_TOOLCHAIN=stable` for the
   test harness; keep the nightly pin for the on-chain crates.
2. **C compiler not on PATH.** `ckb-testtool` pulls `blake2b-rs`
   which needs `cc`. MinGW-w64 or MSVC Build Tools required. Not
   installed on the current machine.
3. **`capsule` not installed.** Required for the canonical build
   path. Listed as a known blocker in `UPSTREAM.md`.
4. **`bls-verify` crate not yet implemented.** Workspace member
   declared in `Cargo.toml` but contents pending per the BLS12-381
   cycle-budget spike (Path 1+3). The circuit-breaker scaffold does
   NOT depend on `bls-verify` as a Cargo dep yet — the integration
   point is a TODO inline in `verify_attestation_cell` /
   `validate_attestation_against_breaker`.
5. **NCI consensus crates not yet implemented.** The
   `nci-consensus-cells/` priority-7 crate (per
   `CHAIN_BUILD_README.md`) will provide the ValidatorRegistry cell-
   shape. Until then, the attestation flow's signer-set lookup is
   stubbed via the shape-heuristic finder.

Until the above are cleared, this crate is in the same state as its
siblings: **source-reviewable, not yet machine-verified**.

## Deploy

Three-step pattern:

1. **Deploy the script binary** as a CKB code-cell. Once deployed,
   the code-cell's outpoint becomes the canonical reference for every
   circuit-breaker cell.
2. **Construct cells** with `type_script.code_hash =
   blake2b256(code-cell-data)`, `type_script.hash_type = data1`, and
   `type_script.args = [role_tag, ...]`:
   - `args = [0x01]` for BreakerCell
   - `args = [0x02]` for BreakerAttestationCell
   - `args = [0x03]` for BreakerResumeQueueCell
3. **Genesis breakers.** For each `(mechanism, signal)` pair the
   protocol needs to protect (e.g., `(VibeAMM, Volume)`,
   `(VibeAMM, Price)`, `(MessagingHub, Withdrawal)`), a BreakerCell
   is minted in the chain's genesis transaction with the appropriate
   `signal_type`, `threshold`, `cooldown_blocks`, and
   `attestation_quorum` projected from the LawsonConstantsRegistry
   genesis values.

## Tests

See `tests/test_basic.rs`. The integration tests live in the
workspace's `tests/` crate and follow the pattern documented in
`contracts-ckb/tests/README.md` — they use `ckb-testtool` and depend
on the Capsule-built binary being present. Until then they emit
`[CYCLE5 SKIP]` rather than falsely pass.

## Cross-references

- Spec: `vibeswap/contracts-ckb/specs/circuit-breaker.md`
- EVM source: `vibeswap/contracts/core/CircuitBreaker.sol`
- Mechanism primitives:
  `[P·circuit-breaker-attested-resume]`,
  `[P·structure-does-the-work]`,
  `[P·dissolve-attack-surface]`,
  `[P·TWAP-depeg-detector]`
- Companion specs:
  `specs/lawson-constants.md` (thresholds, cooldown, quorum),
  `specs/nci-consensus.md` (validator set + BLS pubkeys),
  `specs/vibe-amm.md` (primary consumer; reads BreakerCell on every
  swap),
  `specs/messaging-hub.md` (consumer for Withdrawal breaker)
- Companion crates:
  `lawson-constants-cell-type-script/` (threshold-source),
  `bls-verify/` (attestation pairing check, pending),
  `nci-consensus-cells/` (ValidatorRegistry, pending)
- Latest-pattern reference crate:
  `lawson-constants-cell-type-script/` (shipped 2026-06-08)
