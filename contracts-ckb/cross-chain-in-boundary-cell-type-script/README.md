# cross-chain-in-boundary-cell-type-script

CKB type-script for the **CrossChainInBoundaryCell**: the seventh boundary cell
per `specs/nci-boundary-enforcement.md` §2.7. Authorizes the mint of
canonical-token cells on CKB-VibeSwap in response to a BLS-attested
remote-chain burn.

## What this is

A boundary cell representing an inbound cross-chain mint claim. Created when
an off-chain aggregator collects sufficient validator BLS signatures over a
remote-burn payload and submits the mint transaction. The boundary cell
records the claim; same-tx canonical-token outputs mint the value to the
recipient.

## What this is NOT

- **Not the BLS verifier.** The `AttestationCell` cell-dep's own type-script
  runs `bls-verify::verify_aggregate`. This crate trusts the attestation by
  shape + amount/recipient/source binding equality, never re-verifies the
  signature.
- **Not the validator-set authority.** The `ValidatorRegistryCell` cell-dep's
  type-script defines the active signer set + threshold. This crate reads
  `epoch` for freshness composition only.
- **Not the canonical-token mint authority.** The
  `messaging-hub-canonical-token-cell-type-script` enforces inbound-mint
  semantics on its own outputs. This crate cell-deps the same-tx outputs
  and asserts amount + recipient + chain-id match.
- **Not the supply accountant.** Replay against historical `source_burn_id`
  is the `SupplyAccountantCell`'s job (out of v1 scope). This crate scans
  sibling CrossChainInBoundaryCells for in-window replay.
- **Not the tip-anchor.** v1 uses a placeholder `read_tip_height_proxy()`.
  Production reads `load_header(Source::HeaderDep)` on a PoWAnchorCell per
  REORG_BEHAVIOR_DESIGN §4.

## Cell-data layout (Molecule fixed-struct)

| field                     | bytes | offset |
|---------------------------|-------|--------|
| version                   |   1   |   0    |
| source_chain_id           |   8   |   1    |
| source_burn_id            |   8   |   9    |
| amount                    |  16   |  17    |
| recipient_lock_hash       |  32   |  33    |
| attestation_cell_outpoint |  40   |  65    |
| inclusion_height          |   8   | 105    |

Total: 113 bytes fixed.

`attestation_cell_outpoint` = `tx_hash[32] | index u64 LE[8]`. Resolves the
specific AttestationCell that authorizes this mint.

## Type-script args

Exactly 32 bytes = own type-hash (used to discriminate sibling
CrossChainInBoundaryCells in cell-dep scans for replay prevention).

## Invariants enforced (per nci-boundary-enforcement.md §2.7)

1. **NCI cell-dep present + score >= threshold**: NCIScoreCell cell-dep
   loaded; `unified_score >= CROSSCHAIN_IN_SCORE_THRESHOLD` (Lawson).
2. **NCI freshness**: `tip - NCIScoreCell.inclusion_height <= MAX_SCORE_AGE_BLOCKS`.
3. **AttestationCell cell-dep**: resolved via `attestation_cell_outpoint`;
   the attestation's `source_chain_id`, `source_burn_id`, `amount`,
   `destination_recipient` must match the boundary cell's fields. BLS
   verification is trusted to the attestation's own type-script.
4. **ValidatorRegistry cell-dep**: epoch read for cross-cell freshness; the
   attestation's `attested_at_epoch` must match.
5. **Replay prevention**: scan sibling CrossChainInBoundaryCells via cell-dep
   for `(source_chain_id, source_burn_id)` uniqueness.
6. **Finality on consume**: `tip - inclusion_height >= CROSSCHAIN_IN_FINALITY_BLOCKS`
   (Lawson; default 24 per REORG_BEHAVIOR_DESIGN §6 — most reorg-sensitive
   boundary: reorg here = mint without burn = supply inflation).
7. **Same-tx mint match**: a canonical-token output exists with
   type-hash matching expected canonical token, lock-hash =
   `recipient_lock_hash`, amount = recorded `amount`.

## Composition

- **NCIScoreCell** (cell-dep, mandatory per Position C): authorization gate.
- **LawsonConstantsRegistry** (cell-dep): `CROSSCHAIN_IN_SCORE_THRESHOLD`,
  `MAX_SCORE_AGE_BLOCKS`, `CROSSCHAIN_IN_FINALITY_BLOCKS`.
- **AttestationCell** (cell-dep): BLS-verified remote-burn payload binding
  source_chain_id + source_burn_id + amount + recipient.
- **ValidatorRegistryCell** (cell-dep): quorum + epoch source.
- **MessagingHubCanonicalTokenCell** (same-tx output): the minted value to
  the recipient.
- **PoWAnchorCell** (cell-dep, TODO): authoritative tip-height for freshness
  + finality. v1 uses a placeholder.

## Status

**Spec scaffold, not audit-ready, not yet machine-verified.** Capsule not
wired on this dev box (same toolchain blockers as sibling crates). Cell-dep
discrimination uses shape heuristics; production wants compile-time-embedded
code-hash matching. The invariant arithmetic is enforced.

## Error codes

See `src/error.rs`. Summary:

- 1-4: ckb-std passthrough
- 30-36: cell-shape invariants
- 50-53: NCI authorization
- 60: Lawson cell-dep
- 70-74: attestation binding + registry
- 80: replay prevention
- 90-92: same-tx mint match
- 100-101: finality / tip-anchor
- 110: capacity

## Build

```bash
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p cross-chain-in-boundary-cell-type-script
```

## Tests

`tests/test_basic.rs` is a reviewable test-spec stub (gated by `#[cfg(any())]`).
Runnable integration tests land in
`contracts-ckb/tests/src/cross_chain_in_boundary_cell_type_tests.rs` once
Capsule is wired.

## Cross-references

- Spec: `contracts-ckb/specs/nci-boundary-enforcement.md` §2.7
- Reorg behavior: `contracts-ckb/REORG_BEHAVIOR_DESIGN.md` §6 (24-block, most
  reorg-sensitive)
- BLS preimage: `contracts-ckb/bls-aggregation/SERIALIZATION_SPEC.md` (104 bytes)
- Siblings (composed with):
  - `nci-score-cell-type-script/` (authorization gate)
  - `lawson-constants-cell-type-script/` (thresholds + finality reads)
  - `messaging-hub-attestation-cell-type-script/` (BLS-verified payload)
  - `messaging-hub-validator-registry-cell-type-script/` (quorum + epoch)
  - `messaging-hub-canonical-token-cell-type-script/` (mint output)
- Mechanism primitives: `[P·structure-does-the-work]`,
  `[P·augmented-mechanism-design]`, `[P·augmented-governance]`,
  `[P·honesty-as-structural-load-bearing-property]`,
  `[P·dissolve-attack-surface]`
