# messaging-hub-validator-registry-cell-type-script

The BLS validator registry cell. Singleton on the chain. Read via
cell-dep by AttestationCells to verify threshold aggregate signatures.
Updated via governance-gated transitions.

## Cell-data layout

| field | bytes | offset |
|-------|-------|--------|
| version | 1 | 0 |
| epoch | 8 | 1 |
| threshold_n | 2 | 9 |
| threshold_d | 2 | 11 |
| total_bonded | 16 | 13 |
| n_validators | 2 | 29 |
| validators[] | 64 each | 31 |

Each validator entry: 48-byte BLS G1 pubkey + 16-byte u128 LE bond
amount. Per Will-DECISIONS_MADE 2026-06-08.

## Genesis parameters (per Will-DECISIONS_MADE)

- 24 validators (mid of 16-32 range)
- Threshold 16/24 = 2/3
- Proof-of-possession YES (at ValidatorBondCell, not here)

## Invariants enforced

1. Epoch monotonic (output == input + 1).
2. Threshold floor 2/3 (3n >= 2d, n <= d).
3. Validator count in [16, 32].
4. `sum(bond_amount) == total_bonded`.
5. Governance lock-hash present in tx inputs.
6. Genesis epoch == 0; destroy permitted only with governance auth.

## What's deferred to siblings

- BLS pubkey PoP verification: ValidatorBondCell type-script (future crate)
- Slashing evidence handling: SlashRouter cells (future)
- Capacity movement (actual CKB-side bond accounting): ValidatorBondCell

## Build

```bash
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p messaging-hub-validator-registry-cell-type-script
```

## Status

Scaffold. Source-reviewable; not machine-verified (same blockers as
sibling crates).

Known limitations:
1. Governance auth is single-lock-hash presence; multi-sig N-of-M not enforced here (rely on the lock-script).
2. Per-validator pubkey distinctness is NOT checked at registry transition time. Could be added with a sort-and-pairwise-compare; deferred.
3. Validator-set bound is 16-32 by Will-decision; `bls-verify`'s aggregator can accept up to 256 (signer-bitmap byte limit). Registry is the tighter gate.
4. No cycle benchmark.

## Cross-references

- Spec: `contracts-ckb/specs/messaging-hub.md` § ValidatorRegistryCell
- BLS verifier: `bls-verify/`
- Siblings: `messaging-hub-canonical-token-cell-type-script/`, `messaging-hub-burn-receipt-cell-type-script/`, `messaging-hub-attestation-cell-type-script/`
