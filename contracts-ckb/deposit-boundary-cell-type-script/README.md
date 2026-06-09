# deposit-boundary-cell-type-script

CKB type-script for the **DepositBoundaryCell**: the first of seven boundary
cells per `specs/nci-boundary-enforcement.md`. Authorizes external -> internal
value transitions into the vibeswap-app domain.

## What this is

A cell representing funds that have crossed into vibeswap-app state. Created
on deposit (canonical-token inputs converted into a deposit record); consumed
on claim (deposit being spent into a downstream vibeswap-app cell, e.g. a
CommitCell or AMM pool).

## What this is NOT

- **Not audit-ready.** Cell-dep discrimination uses shape heuristics, not
  code-hash matching against the deployed NCI / Lawson / canonical-token
  binaries. Inline TODOs mark each gap.
- **Not the NCI authority.** The NCIScoreCell's own type-script enforces
  score-composition + per-pillar floors. This crate cell-deps it and reads
  `unified_score` for the threshold check.
- **Not the canonical-token authority.** The canonical-token type-script
  enforces sUDT conservation + burn/mint paths. This crate cell-deps the
  tx's canonical-token INPUTS and sums them for amount-conservation only.
- **Not the tip-anchor.** v1 uses a placeholder `read_tip_height_proxy()`.
  Production reads `load_header(Source::HeaderDep)` on a PoWAnchorCell per
  REORG_BEHAVIOR_DESIGN §4.

## Cell-data layout (Molecule fixed-struct)

| field                 | bytes | offset |
|-----------------------|-------|--------|
| version               |  1    |   0    |
| owner_lock_hash       | 32    |   1    |
| sudt_type_hash        | 32    |  33    |
| amount                | 16    |  65    |
| source_outpoint_tx    | 32    |  81    |
| source_outpoint_index |  4    | 113    |
| inclusion_height      |  8    | 117    |

Total: 125 bytes fixed.

## Type-script args

Exactly 32 bytes = own type-hash (used to discriminate sibling
DepositBoundaryCells in cell-dep scans for replay prevention).

## Invariants enforced (per nci-boundary-enforcement.md §2.1)

1. **NCI cell-dep present + score >= threshold**: NCIScoreCell cell-dep loaded;
   `unified_score >= DEPOSIT_SCORE_THRESHOLD` (Lawson).
2. **Freshness**: `tip - NCIScoreCell.inclusion_height <= MAX_SCORE_AGE_BLOCKS`.
3. **Replay prevention**: `(source_outpoint_tx, source_outpoint_index)` of
   every new output must not appear in any existing DepositBoundaryCell
   visible as a cell-dep.
4. **Amount conservation**: sum of canonical-token (sUDT) inputs matching
   `sudt_type_hash` equals recorded `amount`. (v1: type-hash match only; v2
   tightens by also matching owner_lock_hash on each input.)
5. **Finality on claim**: `tip - inclusion_height >= DEPOSIT_FINALITY_BLOCKS`
   (Lawson; default 6 per REORG_BEHAVIOR_DESIGN §6) before any
   DepositBoundaryCell can be consumed.
6. **Per-boundary score age**: `MAX_SCORE_AGE_BLOCKS` enforced per §2.1.

## Composition

- **NCIScoreCell** (cell-dep, mandatory per Position C): authorization gate.
- **LawsonConstantsRegistry** (cell-dep): `DEPOSIT_SCORE_THRESHOLD`,
  `MAX_SCORE_AGE_BLOCKS`, `DEPOSIT_FINALITY_BLOCKS`.
- **vibeswap-canonical-token-type-script** (same-tx inputs): amount
  conservation source.
- **PoWAnchorCell** (cell-dep, TODO): authoritative tip-height for freshness
  + finality. v1 uses a placeholder.

## Status

**Spec scaffold, not audit-ready, not yet machine-verified.** Capsule not
wired on this dev box (same toolchain blockers as sibling crates — see
`contracts-ckb/tests/README.md`). Cell-dep discrimination uses shape
heuristics; production wants compile-time-embedded code-hash matching. The
invariant arithmetic is enforced; the binding of "this cell-dep IS the NCI
cell" is currently shape-only.

Day 5 of OPERATIONS.md targets the first end-to-end smoke deposit
transaction with this crate as the boundary type-script.

## Error codes

See `src/error.rs`. Summary:

- 1-4: ckb-std passthrough
- 30-36: cell-shape invariants
- 50-53: NCI authorization
- 60: Lawson cell-dep
- 70: replay prevention
- 80-81: amount conservation
- 90-91: finality / tip-anchor
- 100: capacity

## Build

```bash
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p deposit-boundary-cell-type-script
```

## Tests

`tests/test_basic.rs` is a reviewable test-spec stub (gated by
`#[cfg(any())]`) following the workspace pattern. Runnable integration
tests land in `contracts-ckb/tests/src/deposit_boundary_cell_type_tests.rs`
once Capsule is wired.

## Cross-references

- Spec: `contracts-ckb/specs/nci-boundary-enforcement.md` §2.1
- Reorg behavior: `contracts-ckb/REORG_BEHAVIOR_DESIGN.md` §6
- Operations: `contracts-ckb/OPERATIONS.md` Day 5
- Siblings (composed with):
  - `nci-score-cell-type-script/` (authorization gate)
  - `constitutional-bounds-cell-type-script/` (bounds on Lawson values)
  - `lawson-constants-cell-type-script/` (threshold + finality reads)
  - `vibeswap-canonical-token-type-script/` (amount conservation source)
- Mechanism primitives: `[P·structure-does-the-work]`,
  `[P·augmented-mechanism-design]`, `[P·augmented-governance]`,
  `[P·honesty-as-structural-load-bearing-property]`
