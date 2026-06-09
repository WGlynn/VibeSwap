# messaging-hub-burn-receipt-cell-type-script

The burn-side receipt cell. Created in conjunction with a canonical-token
burn; consumed by SupplyAccountantCell updates. Off-chain validator
infra reads these receipts and produces BLS-aggregated AttestationCells
on the destination chain.

## Cell-data layout

| field | bytes | offset |
|-------|-------|--------|
| version | 1 | 0 |
| burn_id | 32 | 1 |
| burner_lock_hash | 32 | 33 |
| amount | 16 | 65 |
| destination_chain_id | 8 | 81 |
| source_chain_id | 8 | 89 |
| burn_block_height | 8 | 97 |
| destination_recipient | var | 105 |

Min 105 bytes. Tail is the destination-chain-specific recipient bytes
(variable length per chain family).

## Invariants enforced

1. **Conjunction with burn**: tx must show net-burn of canonical-token
   (wallet-side OR messaging-hub-side) matching the receipt amount.
2. **Freshness**: burn_ids within a single tx are distinct.
3. **Immutability**: receipts cannot be edited; create-only OR consume-only per tx.
4. **Non-zero chain ids**: both source and destination must be nonzero.

## Build

```bash
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p messaging-hub-burn-receipt-cell-type-script
```

## Status

Scaffold. Source-reviewable; not machine-verified (same blockers as
sibling crates).

Known limitations:
1. Canonical-token detection is data-shape-heuristic, not code-hash. Marked `// TODO`.
2. ChainConfigCell outbound-enabled check is deferred to a later crate; only zero-id is rejected.
3. Source chain id comes from cell-data and is trusted; should be cross-checked against ChainConfigCell once that crate ships.
4. No cycle benchmark.

## Cross-references

- Spec: `contracts-ckb/specs/messaging-hub.md` § BurnReceiptCell
- Siblings: `messaging-hub-canonical-token-cell-type-script/`, `messaging-hub-validator-registry-cell-type-script/`, `messaging-hub-attestation-cell-type-script/`
