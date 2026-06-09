# validator-update-boundary-cell-type-script

CKB type-script for the **ValidatorUpdateBoundaryCell**: the third boundary
cell per `specs/nci-boundary-enforcement.md` §2.3. Authorizes
`ValidatorRegistryCell` transitions (add / remove / stake-update) and
records the change as an on-chain commitment.

## What this is

A boundary cell that gates validator-set rotations. Created same-tx with a
`ValidatorRegistryCell` mutation; records `(prev_registry_outpoint,
new_registry_outpoint, change_type, affected_pubkey)`. Consumed (archived)
only after the governance-class finality wall (24 blocks per
`REORG_BEHAVIOR_DESIGN.md` §6).

## What this is NOT

- **Not audit-ready.** Cell-dep + registry discrimination uses shape
  heuristics, not code-hash matching against deployed binaries. Outpoint
  binding (`prev_registry_outpoint` matches a tx-input,
  `new_registry_outpoint` matches a tx-output) is stubbed pending the
  load-input / computed-tx-hash plumbing — inline `TODO`s mark each gap.
- **Not the NCI authority.** The NCIScoreCell's own type-script enforces
  score-composition + per-pillar floors. This crate cell-deps it and reads
  `unified_score` for the §2.3 threshold check.
- **Not the registry authority.** The ValidatorRegistryCell's own
  type-script enforces epoch monotonicity, threshold bounds, conservation,
  and governance auth on the registry itself. This crate cell-deps the
  same-tx input + output of the registry and checks the *delta* matches the
  declared `change_type`.
- **Not the tip-anchor.** v1 uses a placeholder `read_tip_height_proxy()`.
  Production reads `load_header(Source::HeaderDep)` on a PoWAnchorCell per
  REORG_BEHAVIOR_DESIGN §4.
- **Not the ProtocolDecisionCell.** §2.3 references a `ProtocolDecisionCell`
  binding the witness; v1 enforces the score + registry-pair gates; the
  decision-binding lands when `nci-consensus.md` ProtocolDecisionCell ships.

## Cell-data layout (Molecule fixed-struct)

| field                    | bytes | offset |
|--------------------------|-------|--------|
| version                  |   1   |   0    |
| epoch                    |   8   |   1    |
| prev_registry_outpoint   |  40   |   9    |
| new_registry_outpoint    |  40   |  49    |
| change_type              |   1   |  89    |
| affected_pubkey          |  48   |  90    |
| inclusion_height         |   8   | 138    |

Total: 146 bytes fixed. `change_type`: `0=add, 1=remove, 2=stake_update`.

## Type-script args

Exactly 32 bytes = own type-hash (used to discriminate sibling
ValidatorUpdateBoundaryCells in cell-dep scans).

## Invariants enforced (per nci-boundary-enforcement.md §2.3)

1. **NCI cell-dep present + score >= threshold**: NCIScoreCell cell-dep
   loaded; `unified_score >= VALIDATOR_UPDATE_SCORE_THRESHOLD` (Lawson;
   higher than CROSSCHAIN_IN per §2.3 — validator-set is load-bearing).
2. **Freshness**: `tip - NCIScoreCell.inclusion_height <= MAX_SCORE_AGE_BLOCKS`
   (tight per §2.3: 1-24 blocks).
3. **Registry monotonic**: `new_registry.epoch > prev_registry.epoch`.
4. **Same-tx registry-pair**: a `ValidatorRegistryCell`-shaped input and
   output are present in the tx; v1 binds by shape, v2 binds by outpoint
   byte equality against `prev_registry_outpoint` / `new_registry_outpoint`.
5. **Change-shape match**: `change_type` matches the delta between
   `prev_registry.validators` and `new_registry.validators`:
   - `add`: `|new| = |prev| + 1`, `affected_pubkey ∈ new \ prev`
   - `remove`: `|prev| = |new| + 1`, `affected_pubkey ∈ prev \ new`
   - `stake_update`: `|new| = |prev|`, `affected_pubkey ∈ prev ∩ new`
6. **Finality on consume**: `tip - inclusion_height >= VALIDATOR_UPDATE_FINALITY_BLOCKS`
   (Lawson; default 24 per REORG_BEHAVIOR_DESIGN §6 governance-class)
   before the boundary commitment can be archived.

## Composition

- **NCIScoreCell** (cell-dep, mandatory per Position C): authorization gate.
- **LawsonConstantsRegistry** (cell-dep): `VALIDATOR_UPDATE_SCORE_THRESHOLD`,
  `MAX_SCORE_AGE_BLOCKS`, `VALIDATOR_UPDATE_FINALITY_BLOCKS`.
- **ValidatorRegistryCell** (same-tx input + output): the registry being
  mutated; delta-shape source.
- **ProtocolDecisionCell** (cell-dep, deferred): payload-binding per §2.3.
- **PoWAnchorCell** (cell-dep, TODO): authoritative tip-height.

## Status

**Spec scaffold, not audit-ready, not yet machine-verified.** Capsule not
wired on this dev box (same toolchain blockers as sibling crates). Cell-dep
and registry discrimination use shape heuristics; production wants
compile-time-embedded code-hash matching + load-input outpoint binding. The
invariant arithmetic is enforced; the binding of "this same-tx cell IS the
referenced registry" is currently shape-only.

## Error codes

See `src/error.rs`. Summary:

- 1-4: ckb-std passthrough
- 30-35: cell-shape invariants
- 50-53: NCI authorization
- 60: Lawson cell-dep
- 70-74: registry binding
- 80-82: change-shape match
- 90-91: finality / tip-anchor
- 100: capacity

## Build

```bash
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p validator-update-boundary-cell-type-script
```

## Tests

`tests/test_basic.rs` is a reviewable test-spec stub (gated by
`#[cfg(any())]`) following the workspace pattern. Runnable integration
tests land in `contracts-ckb/tests/` once Capsule is wired.

## Cross-references

- Spec: `contracts-ckb/specs/nci-boundary-enforcement.md` §2.3
- Reorg behavior: `contracts-ckb/REORG_BEHAVIOR_DESIGN.md` §6 (governance-class)
- Siblings (composed with):
  - `nci-score-cell-type-script/` (authorization gate)
  - `lawson-constants-cell-type-script/` (threshold + finality reads)
  - `constitutional-bounds-cell-type-script/` (bounds on Lawson values)
  - `messaging-hub-validator-registry-cell-type-script/` (the registry being mutated)
  - `deposit-boundary-cell-type-script/` (Common Skeleton sibling)
  - `withdrawal-boundary-cell-type-script/` (Common Skeleton sibling)
  - `cross-chain-in-boundary-cell-type-script/` (Common Skeleton sibling)
- Mechanism primitives: `[P·structure-does-the-work]`,
  `[P·augmented-mechanism-design]`, `[P·augmented-governance]`,
  `[P·honesty-as-structural-load-bearing-property]`
