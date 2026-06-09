# governance-update-boundary-cell-type-script

CKB type-script for the **GovernanceUpdateBoundaryCell**: the structurally
most load-bearing boundary cell per `specs/nci-boundary-enforcement.md`
§2.5. Authorizes `LawsonConstantsRegistry` mutations and records the
change as a recursive, dual-layer-vetoed on-chain commitment.

## Why this is the hardest boundary

The constants gated by every other boundary cell live in
`LawsonConstantsRegistry`. Authorizing a mutation here changes the rules
the other boundaries enforce. The structural defense has to survive a
51% NCI quorum colluding to push a payload that dissolves the 3-pillar
mix or pushes weights outside `[500,2000]`/`[2000,4000]`/`[4000,7000]`.
A single layer cannot defeat that attack: NCI authorization alone is
governance-tunable, and the constants are the governance lever. The
required defense is dual-layer:

1. **NCI authorization** (governance layer): an `NCIScoreCell` with
   `decision_type = ParameterUpdate` whose `unified_score` clears the
   highest threshold in the NCI tier.
2. **`ConstitutionalBoundsCell` veto** (math layer): the proposed
   payload MUST satisfy every per-constant `[min,max]` range AND every
   cross-constraint op-code (SUM_LT, GTE_ZERO, SUM_EQ) encoded in the
   immutable BoundsCell.

The math layer cannot be tuned by the governance layer; the
ConstitutionalBoundsCell is set at genesis and rejects any consume tx
that does not byte-preserve its data. Physics > Constitution > Gov.

## What this is NOT

- **Not audit-ready.** Cell-dep discrimination uses shape heuristics,
  not code-hash matching against deployed binaries. Outpoint binding
  (`prev_lawson_outpoint` matches a tx-input, `new_lawson_outpoint`
  matches a tx-output) is stubbed pending the load-input /
  computed-tx-hash plumbing. Inline `TODO`s mark each gap.
- **Not the NCI authority.** The NCIScoreCell's own type-script enforces
  score-composition + per-pillar floors. This crate cell-deps it and
  reads `unified_score` for the §2.5 threshold check.
- **Not the Lawson authority.** The LawsonConstantsRegistry's own
  type-script enforces single-constant-change + preservation. This
  crate cell-deps the same-tx input + output and verifies the new
  payload against the immutable BoundsCell.
- **Not the BoundsCell authority.** The ConstitutionalBoundsCell's own
  type-script enforces immutability. This crate cell-deps the BoundsCell
  and applies its op-codes to the proposed payload.
- **Not the tip-anchor.** v1 uses a placeholder `read_tip_height_proxy()`.
  Production reads `load_header(Source::HeaderDep)` on a PoWAnchorCell
  per REORG_BEHAVIOR_DESIGN §4.
- **Not the ProtocolDecisionCell.** §2.5 references a
  `ProtocolDecisionCell` binding the witness payload; v1 enforces the
  score + bounds + cross-constraint gates; the decision-binding lands
  when `nci-consensus.md` ProtocolDecisionCell ships.

## Cell-data layout (Molecule fixed-struct)

| field                  | bytes | offset |
|------------------------|-------|--------|
| version                |   1   |   0    |
| epoch                  |   8   |   1    |
| prev_lawson_outpoint   |  40   |   9    |
| new_lawson_outpoint    |  40   |  49    |
| decision_id            |  32   |  89    |
| inclusion_height       |   8   | 121    |

Total: 129 bytes fixed.

## Type-script args

Exactly 32 bytes = own type-hash (discriminates sibling
GovernanceUpdateBoundaryCells in cell-dep scans).

## Invariants enforced (per nci-boundary-enforcement.md §2.5)

1. **NCI cell-dep present + score >= threshold**: NCIScoreCell cell-dep
   loaded; `unified_score >= PARAMETER_UPDATE_SCORE_THRESHOLD` (Lawson;
   highest of any boundary — these are the rules everything else uses).
2. **Freshness**: `tip - NCIScoreCell.inclusion_height <= MAX_SCORE_AGE_BLOCKS`
   (tight per §2.5: 1-24 blocks).
3. **DUAL-LAYER bounds veto**: `ConstitutionalBoundsCell` cell-dep
   loaded; every constant in `new_lawson` satisfies
   `bound.min_value <= value <= bound.max_value` AND
   `bound.alpha_min <= alpha <= bound.alpha_max`; every cross-constraint
   (SUM_LT / GTE_ZERO / SUM_EQ) over the proposed payload holds.
4. **Same-tx Lawson registry pair**: a `LawsonRegistry`-shaped input and
   output are present in the tx; v1 binds by shape, v2 binds by outpoint
   byte equality against `prev_lawson_outpoint` / `new_lawson_outpoint`.
5. **Lawson monotonic**: max `last_updated_at_block` across the new
   registry strictly exceeds that of the prev registry (epoch proxy —
   Lawson has no explicit epoch field).
6. **Finality on consume**: `tip - inclusion_height >= GOVERNANCE_FINALITY_BLOCKS`
   (Lawson; default 24 per REORG_BEHAVIOR_DESIGN §6 governance-class)
   before the boundary commitment can be archived.

## The structurally hardest invariant

**Invariant 3 (dual-layer bounds veto)**. The others map onto patterns
already shipped in sibling boundary cells. The dual-layer veto is what
makes §2.5 different from every other boundary:

- The cross-constraint op-codes (SUM_LT on `pow_bps + pos_bps < pom_bps`)
  must be evaluated against the **proposed** payload, not against the
  current registry, because the proposed payload is what the tx
  installs. That requires the type-script to read the new Lawson cell
  data, look up the named constants by hash within it, and apply the
  op-code arithmetically. A subtle bug in the lookup-by-name or in the
  op-code dispatch silently breaks the constitutional veto.
- The BoundsCell-shape discrimination has to distinguish a BoundsCell
  from a LawsonRegistry on cell-dep scan. v1 uses a tail-shape heuristic
  (cross-constraint section vs outpoint tail) which is shape-only;
  production wants code-hash equality against the deployed BoundsCell
  binary.
- The recursion: this boundary cell type-script reads the same Lawson
  registry it is gating, AND the same BoundsCell that bounds it. A
  miscoded interaction here lets a single tx both install
  out-of-bounds constants AND silence the veto. The structural answer
  is that the BoundsCell is immutable (its own type-script rejects any
  consume), so the only attack surface is the boundary cell's
  cross-constraint code, which is precisely the load-bearing logic in
  this crate.

## Composition (dual-layer + supporting cells)

- **NCIScoreCell** (cell-dep, mandatory per Position C): authorization
  gate (governance layer).
- **ConstitutionalBoundsCell** (cell-dep, MANDATORY for §2.5): bounds +
  cross-constraint op-codes (math layer veto). This is what makes §2.5
  dual-layer.
- **LawsonConstantsRegistry** (same-tx input + output): the registry
  being mutated; also cell-dep'd for the read of this boundary's own
  thresholds + finality (recursive).
- **ProtocolDecisionCell** (cell-dep, deferred): payload-binding per
  §2.5 once `nci-consensus.md` ProtocolDecisionCell ships.
- **PoWAnchorCell** (cell-dep, TODO): authoritative tip-height.

## Correspondence Triad

- **Substrate-geometry match**: governance constants govern themselves
  — the structure is recursive. Dual-layer (NCI + Constitution) is the
  natural geometric match: governance can change constants within
  bounds, but cannot change the bounds themselves. The fixed-point of
  the recursion is the immutable BoundsCell.
- **Augmented-mechanism-design**: math-enforced via the
  ConstitutionalBoundsCell, which cannot be mutated post-genesis.
  Constants are governance-tunable WITHIN bounds; bounds are NOT
  governance-tunable. The math layer is above the governance layer per
  `[P·augmented-mechanism-design]`.
- **Augmented-governance**: preserves Physics > Constitution >
  Governance. A 51% NCI quorum cannot break invariants because the
  cross-constraints run on the proposed payload before the gate opens.
  The cabal's choices are "include the user's authorized in-bounds
  transaction" or "include nothing."

## Status

**Spec scaffold, not audit-ready, not yet machine-verified.** Capsule
not wired on this dev box (same toolchain blockers as sibling crates).
Cell-dep discrimination uses shape heuristics; production wants
compile-time code-hash matching + load-input outpoint binding. The
dual-layer arithmetic is enforced; the binding of "this same-tx cell
IS the referenced Lawson registry" is currently shape-only.

## Error codes

See `src/error.rs`. Summary:

- 1-4: ckb-std passthrough
- 30-35: cell-shape invariants
- 50-53: NCI authorization
- 60: Lawson cell-dep (read-only)
- 70-74: Lawson registry binding (same-tx pair)
- 80-86: ConstitutionalBoundsCell dual-layer veto
- 90-91: finality / tip-anchor
- 100: capacity

## Build

```bash
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p governance-update-boundary-cell-type-script
```

## Tests

`tests/test_basic.rs` is a reviewable test-spec stub (gated by
`#[cfg(any())]`) following the workspace pattern. Runnable integration
tests land in `contracts-ckb/tests/` once Capsule is wired.

## Cross-references

- Spec: `contracts-ckb/specs/nci-boundary-enforcement.md` §2.5
- Lawson spec: `contracts-ckb/specs/lawson-constants.md`
- Reorg behavior: `contracts-ckb/REORG_BEHAVIOR_DESIGN.md` §6 (governance-class)
- Siblings (composed with):
  - `nci-score-cell-type-script/` (authorization gate)
  - `constitutional-bounds-cell-type-script/` (immutable bounds + op-codes)
  - `lawson-constants-cell-type-script/` (the registry being mutated)
  - `validator-update-boundary-cell-type-script/` (monotonic-update sibling)
  - `deposit-boundary-cell-type-script/` (Common Skeleton sibling)
- Mechanism primitives: `[P·structure-does-the-work]`,
  `[P·augmented-mechanism-design]`, `[P·augmented-governance]`,
  `[P·honesty-as-structural-load-bearing-property]`,
  `[P·substrate-geometry-match]`
