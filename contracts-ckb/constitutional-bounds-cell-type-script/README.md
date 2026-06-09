# constitutional-bounds-cell-type-script

CKB type-script enforcing the **ConstitutionalBoundsCell** — the immutable
genesis cell that defines per-Lawson-constant bounds and cross-constraint
op-codes for the sovereign VibeSwap-CKB chain.

## Why this cell exists

Per `specs/nci-boundary-enforcement.md` §2.5, the governance-parameter-update
boundary requires a constitutional veto that no NCI score can route around.
Bounds (`pow_bps ∈ [500,2000]`, `pos_bps ∈ [2000,4000]`, `pom_bps ∈ [4000,7000]`,
cross-constraint `pow_bps + pos_bps < pom_bps`) live here, immutable
post-genesis, so the math layer is constitutionally above the governance layer
per `[P·augmented-governance]`. Without this cell every other Lawson constraint
collapses into "whatever current governance permits."

Per `OPERATIONS.md` Phase 0 Day 2, this is the first post-genesis transaction;
its deploy retires the Lawson Deployment Reservation key and the cell becomes
read-only for the rest of chain history.

## Composition

- `lawson-constants-cell-type-script` reads this cell via cell-dep when
  validating ConstantsRegistryCell value/alpha updates. Without the bounds
  reference, registry-side bound checks have nothing to anchor against.
- Per `specs/nci-boundary-enforcement.md` §2.5, the governance-parameter-update
  boundary type-script also cell-deps this cell to verify proposed NCI
  weight payloads stay constitutional.

## Status

Spec scaffold. Source-reviewable; not yet machine-verified on this dev box
(same toolchain + cc + capsule blockers as sibling crates, see
`tests/README.md`). Severity per `[F·spec-vs-deployed-severity-calibration]`:
spec-only × load-bearing — TODOs cost zero pre-deploy, structurally locks
future deployed state.

## Invariants enforced

1. **Genesis-only mint.** Input set empty + exactly one output bearing
   this type-script + layout valid + cross-constraints satisfiable. Codes
   60–64, 70–74.
2. **Immutable post-genesis.** When consumed-as-input, the only legal shape
   is single-in / single-out / byte-identical data / byte-identical
   lock-hash. Any divergence is a mutation attempt. Codes 60–63.
3. **Bound shape.** Per bound, `min_value <= max_value` and
   `alpha_min <= alpha_max`. Code 70, 71.
4. **Cross-constraint shape.** Encoded as well-known op-codes (`SUM_LT`,
   `GTE_ZERO`, `SUM_EQ`) referencing `name_hash`-anchored operands. Each
   must reference an existing bound and be statically satisfiable by the
   declared ranges. Codes 72–74.
5. **Singleton anchor.** Once chain-spec emits the genesis lock-hash,
   `GENESIS_LOCK_HASH_PLACEHOLDER` is replaced and any cell carrying this
   type-script with a non-matching lock-hash is rejected (code 80).

## Cross-constraint encoding

| op-code | name      | semantics on bounds                                       |
|---------|-----------|-----------------------------------------------------------|
| `0x01`  | `SUM_LT`  | `min(a) + min(b) < max(c)` must be satisfiable            |
| `0x02`  | `GTE_ZERO`| presence-check on `a` (u128 always >= 0; reserved future) |
| `0x03`  | `SUM_EQ`  | `min(a)+min(b) <= max(c) AND max(a)+max(b) >= min(c)`     |

`SUM_LT(pow_bps, pos_bps, pom_bps)` is the canonical instance encoding the
three-pillar-diversity invariant from `nci-boundary-enforcement.md` §2.5
and `nci-consensus.md` invariant 10.

## Error codes

See `src/error.rs`. Summary:
- 1–4: ckb-std passthrough
- 50–53: cell-shape (malformed data, schema, args, capacity)
- 60–64: immutability (destroyed, multiplicity, data mutated, lock mutated,
  singleton violation)
- 70–74: bound + cross-constraint shape (ranges inverted, unknown op,
  missing operand, unsatisfiable)
- 80: singleton anchor (non-genesis instance attempted)

## What this is NOT

- Not the runtime value-checker. That lives in
  `lawson-constants-cell-type-script` (registry side) and the per-boundary
  type-scripts (deposit, withdrawal, validator-set, slash, gov-update,
  emergency-pause, xchain-in, xchain-out per `nci-boundary-enforcement.md`
  §2.1–2.8).
- Not the genesis-tx attester. Header-dep-on-block-0 enforcement is a TODO;
  the lock-script (provably-unspendable, genesis-only) is the load-bearing
  half of the immutability guarantee until the placeholder is wired.
- Not audit-ready. Two TODO gates inline:
  1. Genesis-tx assertion (`verify_genesis_mint`) deferred to lock-script
     until the chain-spec emits the genesis lock-hash.
  2. `GENESIS_LOCK_HASH_PLACEHOLDER` constant — zero until chain-spec wires
     the canonical hash.

## Build

```bash
# from contracts-ckb/
capsule build --release
# or
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p constitutional-bounds-cell-type-script
```

## Deploy

Day 2 per `OPERATIONS.md` §10:

1. Deploy this type-script binary as a CKB code-cell from the Lawson
   Deployment Reservation cell (`vibeswap-ckb-dev.toml` issued cell #4).
2. Construct the singleton ConstitutionalBoundsCell with
   `type_script.code_hash = blake2b256(code-cell-data)` and `args = []`;
   pack bounds + cross-constraints per `specs/lawson-constants.md` §
   ConstitutionalBoundsCell.
3. Retire the deployer key (cold storage, never reused — per OPERATIONS
   Day 2).

After confirmation the cell is read-only for the rest of chain history.

## Tests

See `tests/test_basic.rs` — reviewable test-spec stub. Runnable integration
tests follow the workspace pattern in `contracts-ckb/tests/`, gated on
Capsule emitting a binary at
`contracts-ckb/build/release/constitutional-bounds-cell-type-script`.

## Cross-references

- Spec: `contracts-ckb/specs/lawson-constants.md` § ConstitutionalBoundsCell
- Boundary spec: `contracts-ckb/specs/nci-boundary-enforcement.md` §2.5
- Position C context: `contracts-ckb/NCI_CONSENSUS_ANSWER.md`
- Ops Day 2: `contracts-ckb/OPERATIONS.md` §10
- Sibling crate: `contracts-ckb/lawson-constants-cell-type-script/`
- Mechanism primitives: `[P·augmented-governance]`,
  `[P·constitutional-pipeline-scaffolding]`, `[P·structure-does-the-work]`
