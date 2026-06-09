# slash-boundary-cell-type-script

CKB type-script for the **SlashBoundaryCell**: the fourth boundary cell per
`specs/nci-boundary-enforcement.md` §2.4. Turns "validators commit" into
"validators are accountable" — authorizes a slash against a bonded validator's
stake on evidence, gated by the highest NCI threshold (false-slash is an
adversarial weapon, so the gate is the strictest of all boundaries).

## What this is

A boundary cell representing an authorized slash dispatch against a specific
validator. Created when an evidence cell (TaskVerdictCell, PoMFailCell, etc.)
exists and consensus has authorized the slash. Same-tx, the loser's BondCell
is consumed and the slashed amount routed to the insurance pool per
`slash-router.md`.

## What this is NOT

- **Not the evidence authority.** The evidence cell's own type-script
  (PairwiseVerifier's TaskVerdictCell, the messaging-hub PoM-fail cell, etc.)
  produces and signs the verdict. This crate cell-deps the evidence and
  matches by shape + reason-tag; it does not re-derive the verdict.
- **Not the slash-router.** Bond consumption + insurance-pool routing happen
  at the BondCell type-script (per `slash-router.md` § BondCell slash path)
  in the same tx. This crate authorizes; the router executes.
- **Not the validator-registry authority.** The
  `messaging-hub-validator-registry-cell-type-script` defines the bonded set.
  This crate cell-deps it to confirm the slashed pubkey is currently bonded
  and to read the validator's bond amount for the cap check.
- **Not the canonical-token mint authority.** Slashed value flows out via
  the BondCell's existing slash path, not through a fresh mint.
- **Not the tip-anchor.** v1 uses a placeholder `read_tip_height_proxy()`.
  Production reads `load_header(Source::HeaderDep)` on a PoWAnchorCell per
  REORG_BEHAVIOR_DESIGN §4.

## Cell-data layout (Molecule fixed-struct)

| field                    | bytes | offset |
|--------------------------|-------|--------|
| version                  |   1   |   0    |
| slashed_pubkey           |  48   |   1    |
| slash_amount             |  16   |  49    |
| slash_reason             |   1   |  65    |
| evidence_cell_outpoint   |  40   |  66    |
| epoch                    |   8   | 106    |
| inclusion_height         |   8   | 114    |

Total: 122 bytes fixed.

`slashed_pubkey` = compressed BLS12-381 G1 (matches ValidatorRegistry entry
pubkey format). `slash_amount` is u128 LE. `slash_reason` enum:

| code | reason            | required evidence cell                            |
|-----:|-------------------|---------------------------------------------------|
| 0    | Equivocation      | EquivocationProofCell (double-sign over same epoch) |
| 1    | Offline           | OfflineAttestationCell (quorum-attested no-show)   |
| 2    | PairwiseVerdict   | TaskVerdictCell (per `pairwise-verifier.md`)       |
| 3    | PoMFail           | MessagingPoMFailCell (failed PoM challenge)        |

`evidence_cell_outpoint` = `tx_hash[32] | index u64 LE[8]`. Resolves the
specific evidence cell that authorizes this slash.

## Type-script args

Exactly 32 bytes = own type-hash (used to discriminate sibling
SlashBoundaryCells in cell-dep scans for replay prevention).

## Invariants enforced (per nci-boundary-enforcement.md §2.4)

1. **NCI cell-dep + score >= threshold (highest of all boundaries)**:
   NCIScoreCell loaded; `unified_score >= SLASH_SCORE_THRESHOLD` (Lawson;
   highest threshold across boundaries — false-slash is adversarial weapon).
2. **NCI freshness**: `tip - NCIScoreCell.inclusion_height <= MAX_SCORE_AGE_BLOCKS`.
3. **Evidence cell-dep + reason match**: evidence cell resolved via
   `evidence_cell_outpoint`; cell shape must match the `slash_reason` tag
   (e.g. `slash_reason = 2` requires a TaskVerdictCell shape).
4. **Validator existence**: `slashed_pubkey` must appear in the current
   `ValidatorRegistryCell` (cell-dep) as a bonded entry; bond amount read
   for the cap check.
5. **Slash cap**: `slash_amount <= bond_amount * SLASH_LOSING_SHARE_BPS / 10000`
   (Lawson; OPERATIONS.md Phase 1 default = 5000 bps = 50%). Constitutional
   bounds [5000, 8000] per `slash-router.md` § property preservation.
6. **Finality on consume**: `tip - inclusion_height >= SLASH_FINALITY_BLOCKS`
   (Lawson; default 100 per REORG_BEHAVIOR_DESIGN §6 — deepest threshold of
   any boundary; slash is irreversible, so the cost of waiting an extra
   ~17-34 min is bounded vs the cost of false-slash in deep reorg).
7. **Replay prevention**: scan sibling SlashBoundaryCells via cell-dep for
   `(evidence_cell_outpoint)` uniqueness — each evidence cell can authorize
   at most one slash dispatch.

## Composition

- **NCIScoreCell** (cell-dep, mandatory per Position C): authorization gate.
- **LawsonConstantsRegistry** (cell-dep): `SLASH_SCORE_THRESHOLD`,
  `MAX_SCORE_AGE_BLOCKS`, `SLASH_LOSING_SHARE_BPS`, `SLASH_FINALITY_BLOCKS`.
- **Evidence cell** (cell-dep): TaskVerdictCell (from PairwiseVerifier),
  EquivocationProofCell, OfflineAttestationCell, or MessagingPoMFailCell.
  Shape match dispatches on `slash_reason`.
- **ValidatorRegistryCell** (cell-dep): bonded-set membership + bond amount
  for cap arithmetic.
- **BondCell** (same-tx input): the loser's bond, consumed in the same tx
  per `slash-router.md` § BondCell slash path. This crate authorizes; the
  bond's own type-script splits to insurance-pool + remainder.
- **PoWAnchorCell** (cell-dep, TODO): authoritative tip-height for freshness
  + finality. v1 uses a placeholder.

## Status

**Spec scaffold, not audit-ready, not yet machine-verified.** Capsule not
wired on this dev box (same toolchain blockers as sibling crates). Cell-dep
discrimination uses shape heuristics; production wants compile-time-embedded
code-hash matching per evidence-reason. The invariant arithmetic is
enforced; the binding of "this cell-dep IS the evidence cell" is currently
shape-only and reason-dispatched.

## Error codes

See `src/error.rs`. Summary:

- 1-4: ckb-std passthrough
- 30-37: cell-shape invariants
- 50-53: NCI authorization
- 60: Lawson cell-dep
- 70-74: evidence + registry binding
- 80-82: slash cap + amount
- 90: replay prevention
- 100-101: finality / tip-anchor
- 110: capacity

## Build

```bash
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p slash-boundary-cell-type-script
```

## Tests

`tests/test_basic.rs` is a reviewable test-spec stub (gated by
`#[cfg(any())]`). Runnable integration tests land in
`contracts-ckb/tests/src/slash_boundary_cell_type_tests.rs` once Capsule is
wired.

## Cross-references

- Spec: `contracts-ckb/specs/nci-boundary-enforcement.md` §2.4
- Slash mechanism: `contracts-ckb/specs/slash-router.md`
- Evidence source: `contracts-ckb/specs/pairwise-verifier.md` (TaskVerdictCell)
- Reorg behavior: `contracts-ckb/REORG_BEHAVIOR_DESIGN.md` §6 (100-block,
  deepest threshold)
- Operations: `contracts-ckb/OPERATIONS.md` Phase 1 (50% losing share)
- Siblings (composed with):
  - `nci-score-cell-type-script/` (authorization gate)
  - `lawson-constants-cell-type-script/` (threshold + finality + cap reads)
  - `messaging-hub-validator-registry-cell-type-script/` (bonded-set + bond
    amount)
  - `escrow-vault-cell-type-script/` (BondCell slash path consumer)
- Mechanism primitives: `[P·structure-does-the-work]`,
  `[P·augmented-mechanism-design]`, `[P·augmented-governance]`,
  `[P·honesty-as-structural-load-bearing-property]`,
  `[P·dissolve-attack-surface]`, `[P·unbonding-slash-completeness]`
