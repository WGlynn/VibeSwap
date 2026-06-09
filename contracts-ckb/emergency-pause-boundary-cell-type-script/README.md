# emergency-pause-boundary-cell-type-script

CKB type-script for the **EmergencyPauseBoundaryCell**: the sixth boundary
cell per `specs/nci-boundary-enforcement.md` §2.6. Gates discretionary trip
and attested resume of a `BreakerCell` (companion crate
`circuit-breaker-cell-type-script`). Automatic threshold-cross trips do
NOT flow through this boundary — they remain structural, handled inside
the BreakerCell's own type-script.

## What this is

A cell representing an explicit, NCI-authorized command to either trip or
resume one BreakerCell. Created on issuance (governance / guardian
issues the pause/resume command); consumed downstream by archival or
proof-of-action cells.

## What this is NOT

- **Not audit-ready.** Cell-dep discrimination uses shape heuristics, not
  code-hash matching against the deployed NCI / Lawson / BreakerCell /
  ValidatorRegistry binaries. Inline TODOs mark each gap.
- **Not the BreakerCell authority.** The BreakerCell's own type-script
  enforces state-transition legality (Clear -> Tripped -> Resuming ->
  Clear). This crate cell-deps the BreakerCell and verifies the
  same-tx output reflects the action.
- **Not the automatic-trip path.** Automatic threshold-cross trips are a
  side-effect of mechanism transactions and do NOT consume an
  EmergencyPauseBoundaryCell — they fire inside the BreakerCell's
  counter update.
- **Not the BLS verifier.** Attestation pairing checks are delegated to
  `bls-verify` per `specs/bls12-381-cycle-budget-spike.md`. This
  scaffold validates only signer-count from the bitmap.
- **Not the tip-anchor.** v1 uses a placeholder `read_tip_height_proxy()`.
  Production reads `load_header(Source::HeaderDep)` on a PoWAnchorCell.

## Cell-data layout (Molecule fixed-struct)

| field                 | bytes | offset |
|-----------------------|-------|--------|
| version               |  1    |   0    |
| action                |  1    |   1    | 0 = trip, 1 = resume
| scope                 |  1    |   2    | 0 = global, 1 = pool, 2 = domain
| breaker_cell_outpoint | 40    |   3    |
| epoch                 |  8    |  43    |
| inclusion_height      |  8    |  51    |

Total: 59 bytes fixed.

## Type-script args

Exactly 32 bytes = own type-hash (used to discriminate sibling
EmergencyPauseBoundaryCells in cell-dep scans, reserved for future
replay primitives).

## Invariants enforced (per nci-boundary-enforcement.md §2.6)

1. **NCI cell-dep + asymmetric score threshold**: NCIScoreCell cell-dep
   loaded. Trip requires `unified_score >= EMERGENCY_TRIP_SCORE_THRESHOLD`;
   resume requires `unified_score >= EMERGENCY_RESUME_SCORE_THRESHOLD`
   where `RESUME > TRIP`. The asymmetry is enforced both in the Lawson
   parse (resume threshold must exceed trip threshold; otherwise the
   registry is treated as malformed) AND at the per-output check.
2. **Freshness**: `tip - NCIScoreCell.inclusion_height <= MAX_SCORE_AGE_BLOCKS`.
3. **BreakerCell cell-dep present + state check**: a BreakerCell input AND
   output must be present in the same tx. Trip requires input state ==
   Clear AND output state == Tripped (rejects already-tripped breakers);
   resume requires input state == Tripped AND output state == Resuming.
   `breaker_id` must be preserved across the transition.
4. **Asymmetric attestation requirement**: trip path treats attestation as
   optional evidence (if presented, signer count must be >= 3 per the
   NCI minimum-validator-rotation floor). Resume path REQUIRES an
   AttestationCell cell-dep AND signer count must be >= the
   ValidatorRegistry's `n_validators` (unanimous), AND >= the
   BreakerCell's `attestation_quorum`. Asymmetry per
   `[P·circuit-breaker-attested-resume]` — false-resume after exploit is
   the failure mode the asymmetry exists to prevent.
5. **Asymmetric finality on consume**: trip cells have 0-block finality
   (security-priority — REORG_BEHAVIOR_DESIGN §6); resume cells require
   `tip - inclusion_height >= EMERGENCY_RESUME_FINALITY_BLOCKS` (default
   24 per REORG §6). A still-reorgable resume must not actuate
   downstream effects.
6. **Same-tx BreakerCell reflects action**: the BreakerCell output
   produced in the same transaction must encode the new state (Tripped
   for trip, Resuming for resume) and preserve `breaker_id`. A
   boundary cell whose action does not match the same-tx BreakerCell
   transition is rejected.

## Composition

- **NCIScoreCell** (cell-dep, mandatory per Position C): authorization gate
  with asymmetric thresholds.
- **LawsonConstantsRegistry** (cell-dep):
  `EMERGENCY_TRIP_SCORE_THRESHOLD`, `EMERGENCY_RESUME_SCORE_THRESHOLD`,
  `MAX_SCORE_AGE_BLOCKS`, `EMERGENCY_RESUME_FINALITY_BLOCKS`.
- **BreakerCell** (same-tx input + output, from
  `circuit-breaker-cell-type-script`): target of the action. State
  transition is enforced by the BreakerCell's own type-script; this
  boundary verifies the action matches and the breaker_id is preserved.
- **BreakerAttestationCell** (cell-dep): required for resume (unanimous
  signer floor), optional for trip (3-signer floor when presented).
  Authority lives in the BreakerAttestation type-script.
- **ValidatorRegistryCell** (cell-dep): supplies `n_validators` for the
  unanimous-resume reference.
- **PoWAnchorCell** (cell-dep, TODO): authoritative tip-height for
  freshness + finality. v1 uses a placeholder.

## Composition statement (with CircuitBreaker)

The EmergencyPauseBoundaryCell IS the discretionary half of the
CircuitBreaker's trip-vs-resume asymmetry. The BreakerCell triad
(`circuit-breaker-cell-type-script`) enforces the structural property —
no resume can complete without attestation + cooldown + queue maturity.
This boundary adds the NCI-authorization layer on top: even an
attestation-quorum-met resume must clear NCI's higher-than-trip score
threshold AND the 24-block finality window. The asymmetric finality
(0 for trip / 24 for resume) is the cell-graph implementation of
[P·circuit-breaker-attested-resume]: trips are immediate and cheap to
issue under security pressure; resumes are slow and expensive to issue
to absorb false-resume risk during the window an exploit is still being
adjudicated. The two layers compose multiplicatively — the
BreakerCell triad cannot resume without this boundary's NCI
authorization, and this boundary cannot issue a resume that breaks the
BreakerCell triad's attestation+cooldown contract.

## Status

**Spec scaffold, not audit-ready, not yet machine-verified.** Same
toolchain blockers as sibling crates (see
`circuit-breaker-cell-type-script/README.md` § Known build blockers).
Cell-dep discrimination uses shape heuristics. Outpoint equality
between boundary's `breaker_cell_outpoint` and the same-tx BreakerCell
input is shape-only; production wants byte-equality.

Day 6+ of OPERATIONS.md target for first end-to-end smoke trip + smoke
resume tx using this boundary.

## Error codes

See `src/error.rs`. Summary:

- 1-4: ckb-std passthrough
- 30-37: cell-shape invariants (malformed, schema, args, action/scope
  discriminants)
- 50-53: NCI authorization (cell-dep missing, below trip threshold,
  below resume threshold, stale)
- 60: Lawson cell-dep
- 70-75: BreakerCell binding (cell-dep missing, malformed,
  already-tripped, not-tripped, output state mismatch, output id
  mismatch)
- 80-83: Attestation (cell-dep missing, breaker_id mismatch, trip
  attester floor not met, resume unanimous not met)
- 90-91: Finality (resume not yet final, tip-anchor missing)
- 100: Capacity

## Build

```bash
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p emergency-pause-boundary-cell-type-script
```

## Tests

`tests/test_basic.rs` is a reviewable test-spec stub (gated by
`#[cfg(any())]`) following the workspace pattern. Runnable integration
tests land in
`contracts-ckb/tests/src/emergency_pause_boundary_cell_type_tests.rs`
once Capsule is wired.

## Cross-references

- Spec: `contracts-ckb/specs/nci-boundary-enforcement.md` §2.6
- Reorg behavior: `contracts-ckb/REORG_BEHAVIOR_DESIGN.md` §6
- Companion (target of action): `circuit-breaker-cell-type-script/`
- Siblings (composed with):
  - `nci-score-cell-type-script/` (authorization gate)
  - `lawson-constants-cell-type-script/` (threshold + finality reads)
  - `circuit-breaker-cell-type-script/` (BreakerCell + attestation triad)
  - `messaging-hub-validator-registry-cell-type-script/` (n_validators)
  - `deposit-boundary-cell-type-script/` (Common Skeleton reference)
- Mechanism primitives:
  - `[P·circuit-breaker-attested-resume]`
  - `[P·structure-does-the-work]`
  - `[P·augmented-mechanism-design]`
  - `[P·augmented-governance]`
  - `[P·dissolve-attack-surface]`
