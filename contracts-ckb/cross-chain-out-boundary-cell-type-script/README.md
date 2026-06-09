# cross-chain-out-boundary-cell-type-script

CKB type-script for the **CrossChainOutBoundaryCell**: the outbound side of
the VibeSwap-canonical burn-and-mint per
`specs/nci-boundary-enforcement.md` §2.8. Authorizes emission of a cross-chain
burn event by composing same-tx with a canonical-token burn and a
`BurnReceiptCell`.

## What this is

A cell representing an authorized outbound burn-and-mint emission. Created
when canonical tokens are burned on CKB-VibeSwap with intent to mint on a
destination chain; archived after finality once the BurnReceiptCell has been
absorbed by the SupplyAccountantCell.

## What this is NOT

- **Not audit-ready.** Cell-dep discrimination uses shape heuristics, not
  code-hash matching against the deployed NCI / Lawson / canonical-token /
  burn-receipt binaries. Inline TODOs mark each gap.
- **Not the NCI authority.** The NCIScoreCell's own type-script enforces
  score-composition + per-pillar floors. This crate cell-deps it and reads
  `unified_score` for the threshold check.
- **Not the burn authority.** The messaging-hub-canonical-token type-script
  enforces conservation + direction. This crate observes the net-burn and
  asserts magnitude-equality against the requested emission.
- **Not the receipt authority.** The `messaging-hub-burn-receipt-cell-type-script`
  enforces receipt internal invariants (chain-ids nonzero, distinct burn_ids,
  conjunction-with-burn). This crate cross-references receipt fields against
  the emission and rejects mismatches.
- **Not the tip-anchor.** v1 uses a placeholder `read_tip_height_proxy()`.
  Production reads `load_header(Source::HeaderDep)` on a PoWAnchorCell per
  REORG_BEHAVIOR_DESIGN §4.

## Cell-data layout (Molecule fixed-struct)

| field                    | bytes | offset |
|--------------------------|-------|--------|
| version                  |  1    |   0    |
| dest_chain_id            |  8    |   1    |
| dest_recipient_lock_hash | 32    |   9    |
| amount                   | 16    |  41    |
| burn_id                  |  8    |  57    |
| inclusion_height         |  8    |  65    |

Total: 73 bytes fixed.

## Type-script args

Exactly 32 bytes = own type-hash (used to discriminate sibling
CrossChainOutBoundaryCells in cell-dep scans for burn_id replay prevention).

## Invariants enforced (per nci-boundary-enforcement.md §2.8)

1. **NCI cell-dep present + score >= threshold**: NCIScoreCell cell-dep loaded;
   `unified_score >= XCHAIN_OUT_SCORE_THRESHOLD` (Lawson).
2. **Freshness**: `tip - NCIScoreCell.inclusion_height <= XCHAIN_OUT_MAX_SCORE_AGE_BLOCKS`.
3. **Same-tx canonical-token burn + companion BurnReceiptCell**: net-burn of
   messaging-hub canonical-token cells across the tx must equal the sum of
   emission amounts; for each emission, a same-tx output BurnReceiptCell
   exists with matching (amount, dest_chain_id, dest_recipient, burn_id).
4. **Replay prevention**: `burn_id` of every new output must not appear in
   any existing CrossChainOutBoundaryCell visible as a cell-dep, and must be
   distinct within the same tx.
5. **Finality on archive**: `tip - inclusion_height >= XCHAIN_OUT_FINALITY_BLOCKS`
   (Lawson; tracks withdrawal-class per REORG_BEHAVIOR_DESIGN §6) before any
   CrossChainOutBoundaryCell can be consumed.
6. **Destination-chain sanity**: `dest_chain_id != 0` and present in the
   Lawson-defined `SUPPORTED_DEST_CHAINS` list.

## Composition

- **NCIScoreCell** (cell-dep, mandatory per Position C): authorization gate.
- **LawsonConstantsRegistry** (cell-dep): `XCHAIN_OUT_SCORE_THRESHOLD`,
  `XCHAIN_OUT_MAX_SCORE_AGE_BLOCKS`, `XCHAIN_OUT_FINALITY_BLOCKS`,
  `SUPPORTED_DEST_CHAINS`.
- **messaging-hub-canonical-token-cell-type-script** (same-tx inputs/outputs):
  net-burn magnitude source.
- **messaging-hub-burn-receipt-cell-type-script** (same-tx output): the
  cross-chain wire-shape; this crate binds amount, dest_chain_id,
  dest_recipient, and burn_id to the receipt.
- **PoWAnchorCell** (cell-dep, TODO): authoritative tip-height for freshness
  + finality. v1 uses a placeholder.

## Status

**Spec scaffold, not audit-ready, not yet machine-verified.** Capsule not
wired on this dev box (same toolchain blockers as sibling crates — see
`contracts-ckb/tests/README.md`). Cell-dep + companion-cell discrimination
uses shape heuristics; production wants compile-time-embedded code-hash
matching. The invariant arithmetic is enforced; the binding of "this cell-dep
IS the NCI cell" / "this output IS a BurnReceiptCell" is currently
shape-only.

Known limitations:
1. Canonical-token + burn-receipt detection is data-shape-heuristic, not
   code-hash. Marked `// TODO`.
2. SUPPORTED_DEST_CHAINS is read from a packed-tail Lawson entry; once a
   dedicated registry cell ships, the lookup migrates.
3. Burn-id binding to the receipt's blake2b hash uses the low-8 bytes of the
   32-byte hash. Production tightens to full preimage verification.
4. No cycle benchmark.

## Error codes

See `src/error.rs`. Summary:

- 1-4: ckb-std passthrough
- 30-37: cell-shape invariants
- 50-53: NCI authorization
- 60: Lawson cell-dep
- 70-71: burn_id replay prevention
- 80-86: canonical-burn + burn-receipt composition
- 90-91: destination-chain sanity
- 95-96: finality / tip-anchor
- 100: capacity

## Build

```bash
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p cross-chain-out-boundary-cell-type-script
```

## Tests

`tests/test_basic.rs` is a reviewable test-spec stub (gated by
`#[cfg(any())]`) following the workspace pattern. Runnable integration
tests land in `contracts-ckb/tests/src/cross_chain_out_boundary_cell_type_tests.rs`
once Capsule is wired.

## Cross-references

- Spec: `contracts-ckb/specs/nci-boundary-enforcement.md` §2.8
- Reorg behavior: `contracts-ckb/REORG_BEHAVIOR_DESIGN.md` §6
- Messaging-hub spec: `contracts-ckb/specs/messaging-hub.md` § BurnReceiptCell
- Siblings (composed with):
  - `nci-score-cell-type-script/` (authorization gate)
  - `lawson-constants-cell-type-script/` (threshold + finality + dest-chain list)
  - `messaging-hub-canonical-token-cell-type-script/` (net-burn observation)
  - `messaging-hub-burn-receipt-cell-type-script/` (companion receipt cell)
- Mechanism primitives: `[P·structure-does-the-work]`,
  `[P·augmented-mechanism-design]`, `[P·augmented-governance]`,
  `[P·honesty-as-structural-load-bearing-property]`,
  `[F·post-layerzero-canonical-messaging]`
