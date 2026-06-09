# nci-score-cell-type-script

CKB type-script for the **NCIScoreCell**: the three-pillar (PoW / PoS / PoM)
composite score that gates every vibeswap-app boundary transition per
`NCI_CONSENSUS_ANSWER.md` Position C and the per-boundary invariants in
`specs/nci-boundary-enforcement.md`.

## What this is

The on-chain score cell. Every deposit, withdrawal, validator-set update,
slash, governance parameter update, emergency pause, and cross-chain
in/out transition reads an NCIScoreCell as a cell-dep and asserts
`unified_score >= threshold` + per-pillar floor + freshness window
against `LawsonConstantsRegistry`.

## What this is NOT

- **Not audit-ready.** Cell-dep discrimination uses shape heuristics, not
  code-hash matching against the deployed Lawson / ValidatorRegistry /
  AttestationCell binaries. Inline TODOs mark each gap.
- **Not the boundary enforcer.** Each boundary cell's own type-script
  enforces its own NCI cell-dep + witness invariant per the Common
  Skeleton in `specs/nci-boundary-enforcement.md` § 1. This crate only
  enforces that the NCIScoreCell *itself* is internally consistent.
- **Not the BLS aggregate-verifier.** v1 checks tx-hash linkage to an
  AttestationCell + signer-bitmap-count vs `attestation_count` + quorum
  derived from ValidatorRegistry. v2 will inline-call
  `bls_verify::verify_aggregate`. The AttestationCell's own type-script
  already BLS-verifies at its creation.
- **Not the substrate consensus.** NC-Max + Eaglesong PoW remains
  block-production consensus, untouched. NCI is app-layer
  protocol-decision-weighting per Position C; this cell is read at
  every vibeswap-app boundary, not at block-production.

## Cell-data layout (Molecule fixed-struct)

| field | bytes | offset |
|-------|-------|--------|
| version | 1 | 0 |
| epoch | 8 | 1 |
| inclusion_height | 8 | 9 |
| score (composite) | 4 | 17 |
| pow_component | 4 | 21 |
| pos_component | 4 | 25 |
| pom_component | 4 | 29 |
| attestation_count | 2 | 33 |
| attestation_witness_ref | 32 | 35 |

Total: 67 bytes fixed.

## Type-script args

Exactly 32 bytes = type-hash of the bound `ValidatorRegistryCell`. Cell-dep
binding for v2 code-hash matching; currently informational.

## Invariants enforced

1. **Score composition**: `score == (pow_bps * pow_c + pos_bps * pos_c + pom_bps * pom_c) / 10000`
   where weights come from LawsonConstantsRegistry (cell-dep).
2. **Pillar floor**: each component >= its Lawson per-pillar floor.
3. **Constitutional cross-constraint**: `pow_bps + pos_bps < pom_bps`.
4. **Weights sum**: `pow_bps + pos_bps + pom_bps == 10000`.
5. **Attestation witness binding**: `attestation_witness_ref` resolves to
   a cell-dep'd cell shape-matching AttestationCell; its signer-bitmap
   bit-count equals `attestation_count`.
6. **Quorum**: `attestation_count >= ceil(n_validators * threshold_n / threshold_d)`
   from cell-dep'd ValidatorRegistryCell.
7. **Epoch monotonic** on transition: `output.epoch >= input.epoch`.
8. **Freshness (boundary-side)**: `MAX_SCORE_AGE_BLOCKS` is the bound
   every BOUNDARY script enforces when consuming this cell as dep; this
   script records `inclusion_height` faithfully (no enforcement here
   because there's no "current tip" inside a type-script — boundary
   scripts use `load_header` for the tip read).

## Composition

- **LawsonConstantsRegistry** (cell-dep): pillar weights, per-pillar
  floors, `MAX_SCORE_AGE_BLOCKS`, the cross-constraint.
- **ValidatorRegistryCell** (cell-dep): quorum derivation from
  `(n_validators, threshold_n, threshold_d)`.
- **AttestationCell** (cell-dep, looked up via `attestation_witness_ref`):
  BLS witness binding. Its own type-script already verified the aggregate.
- **bls-verify** (workspace crate): reserved for v2 inline aggregate-verify.

## Error codes

See `src/error.rs`. Summary:

- 1-4: ckb-std passthrough
- 30-34: cell-shape invariants
- 40-43: score-composition / weights / pillar floors / pom-dominance
- 50-54: cell-dep + witness binding
- 60-61: freshness / monotonicity
- 70: capacity

## Build

```bash
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p nci-score-cell-type-script
```

Same toolchain blockers as sibling crates (toolchain pin, cc on PATH,
capsule) — see `contracts-ckb/tests/README.md`.

## Tests

See `tests/test_basic.rs`. Reviewable test-spec stub (gated by
`#[cfg(any())]`) following the pattern from
`lawson-constants-cell-type-script`. Runnable integration tests will
land in `contracts-ckb/tests/src/nci_score_cell_type_tests.rs` once
Capsule is wired.

## Status

Spec scaffold, source-reviewable, not machine-verified. The score-
composition arithmetic is fully enforced; cell-dep discrimination is
heuristic and marked with explicit TODOs.

## Cross-references

- Position: `contracts-ckb/NCI_CONSENSUS_ANSWER.md` (Position C)
- Spec: `contracts-ckb/specs/nci-consensus.md`
- Boundary enforcement: `contracts-ckb/specs/nci-boundary-enforcement.md`
- Reorg behavior: `contracts-ckb/REORG_BEHAVIOR_DESIGN.md`
- Rust design: `contracts-ckb/consensus-integration/NCI_RUST_DESIGN.md`
- BLS verifier: `bls-verify/`
- Siblings: `lawson-constants-cell-type-script/`,
  `messaging-hub-validator-registry-cell-type-script/`,
  `messaging-hub-attestation-cell-type-script/`
- Mechanism primitives: `[P·substrate-geometry-match]`,
  `[P·augmented-mechanism-design]`, `[P·augmented-governance]`,
  `[P·structure-does-the-work]`, `[F·blockchain-not-contracts]`
