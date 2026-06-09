# withdrawal-boundary-cell-type-script

CKB type-script for the **WithdrawalBoundaryCell**: companion to the
deposit boundary, second of seven boundary cells per
`specs/nci-boundary-enforcement.md`. Authorizes internal -> external value
transitions out of the vibeswap-app domain.

## What this is

A cell representing funds that have crossed out of vibeswap-app state. Created
on withdrawal (a matched DepositBoundaryCell is referenced, NCI authorizes,
finality is met, canonical-token output is minted to the owner); consumed on
settlement (the external transfer is acknowledged and the withdrawal record
retires).

## What this is NOT

- **Not audit-ready.** Cell-dep discrimination uses shape heuristics, not
  code-hash matching against the deployed NCI / Lawson / deposit / canonical-
  token binaries. Inline TODOs mark each gap.
- **Not the NCI authority.** The NCIScoreCell's own type-script enforces
  score-composition + per-pillar floors. This crate cell-deps it and reads
  `unified_score` for the withdrawal-threshold check.
- **Not the deposit authority.** The deposit-boundary type-script owns the
  DepositBoundaryCell's creation invariants. This crate cell-deps a matched
  DepositBoundaryCell and reads its `owner_lock_hash`, `sudt_type_hash`,
  `amount`, `inclusion_height` for the §2.2 checks.
- **Not the canonical-token authority.** The canonical-token type-script
  enforces sUDT conservation + burn/mint paths. This crate scans tx OUTPUTS
  for the canonical-token receipt that matches the withdrawal's owner and
  amount.
- **Not the tip-anchor.** v1 uses a placeholder `read_tip_height_proxy()`.
  Production reads `load_header(Source::HeaderDep)` on a PoWAnchorCell per
  REORG_BEHAVIOR_DESIGN §4.

## Cell-data layout (Molecule fixed-struct)

| field                          | bytes | offset |
|--------------------------------|-------|--------|
| version                        |  1    |   0    |
| owner_lock_hash                | 32    |   1    |
| sudt_type_hash                 | 32    |  33    |
| amount                         | 16    |  65    |
| matched_deposit_outpoint_tx    | 32    |  81    |
| matched_deposit_outpoint_index |  4    | 113    |
| inclusion_height               |  8    | 117    |

Total: 125 bytes fixed (symmetric with deposit).

## Type-script args

Exactly 32 bytes = own type-hash (discriminates sibling
WithdrawalBoundaryCells in cell-dep scans for double-withdrawal detection).

## Invariants enforced (per nci-boundary-enforcement.md §2.2)

1. **NCI cell-dep present + score >= withdrawal threshold**: NCIScoreCell
   cell-dep loaded; `unified_score >= WITHDRAWAL_SCORE_THRESHOLD` (Lawson;
   strictly higher than the deposit threshold per §2.2).
2. **Freshness**: `tip - NCIScoreCell.inclusion_height <= MAX_SCORE_AGE_BLOCKS`.
3. **Matched-deposit existence**: a DepositBoundaryCell visible as cell-dep
   with the same `owner_lock_hash` and `sudt_type_hash` as the withdrawal.
4. **Matched-deposit unconsumed**: no prior WithdrawalBoundaryCell visible as
   cell-dep references the same `matched_deposit_outpoint`.
5. **Amount bound**: `withdrawal.amount <= matched_deposit.amount`.
6. **Finality on matched deposit**: `tip - matched_deposit.inclusion_height
   >= WITHDRAWAL_FINALITY_BLOCKS` (Lawson; default 6 per
   REORG_BEHAVIOR_DESIGN §6).
7. **Same-tx canonical-token output**: a CanonicalTokenCell in this tx's
   outputs locked to `owner_lock_hash` and typed by `sudt_type_hash` whose
   amount sums to `withdrawal.amount`.

## Composition

- **NCIScoreCell** (cell-dep, mandatory per Position C): authorization gate.
- **LawsonConstantsRegistry** (cell-dep): `WITHDRAWAL_SCORE_THRESHOLD`,
  `MAX_SCORE_AGE_BLOCKS`, `WITHDRAWAL_FINALITY_BLOCKS`.
- **DepositBoundaryCell** (cell-dep, matched): owner + sudt + amount +
  inclusion source for §2.2 steps 3-6.
- **vibeswap-canonical-token-type-script** (same-tx outputs): receipt that
  the withdrawn value reached the owner.
- **PoWAnchorCell** (cell-dep, TODO): authoritative tip-height for freshness
  + finality. v1 uses a placeholder.

## Status

**Spec scaffold, not audit-ready, not yet machine-verified.** Capsule not
wired on this dev box (same toolchain blockers as sibling crates). Cell-dep
discrimination uses shape heuristics; production wants compile-time-embedded
code-hash matching. The arithmetic invariants are enforced; the binding of
"this cell-dep IS the matched deposit" is currently shape + owner/sudt-match
(v1 approximation; production exact-matches the OutPoint).

## Error codes

See `src/error.rs`. Summary:

- 1-4: ckb-std passthrough
- 30-35: cell-shape invariants
- 50-53: NCI authorization
- 60: Lawson cell-dep
- 70-73: matched-deposit existence + unconsumed
- 80-82: amount + canonical-token output
- 90-91: finality / tip-anchor
- 100: capacity

## Build

```bash
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p withdrawal-boundary-cell-type-script
```

## Tests

`tests/test_basic.rs` is a reviewable test-spec stub (gated by
`#[cfg(any())]`) following the workspace pattern. Runnable integration
tests land in `contracts-ckb/tests/src/withdrawal_boundary_cell_type_tests.rs`
once Capsule is wired.

## Cross-references

- Spec: `contracts-ckb/specs/nci-boundary-enforcement.md` §2.2
- Reorg behavior: `contracts-ckb/REORG_BEHAVIOR_DESIGN.md` §6 (finality = 6)
- Sibling: `contracts-ckb/deposit-boundary-cell-type-script/` (matched-deposit source)
- Siblings (composed with):
  - `nci-score-cell-type-script/` (authorization gate)
  - `constitutional-bounds-cell-type-script/` (bounds on Lawson values)
  - `lawson-constants-cell-type-script/` (threshold + finality reads)
  - `vibeswap-canonical-token-type-script/` (same-tx output receipt)
- Mechanism primitives: `[P·structure-does-the-work]`,
  `[P·augmented-mechanism-design]`, `[P·augmented-governance]`,
  `[P·honesty-as-structural-load-bearing-property]`
