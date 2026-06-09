# messaging-hub-canonical-token-cell-type-script

The bridged-token boundary cell at the MessagingHub level. Distinct from
the wallet-side `vibeswap-canonical-token-type-script` despite the
similar name.

## Two-layer mental model

```text
   VibeSwapCanonicalToken (wallet-side sUDT, vibeswap-canonical-token-type-script)
        |  burn   /   mint
        v
   MessagingHubCanonicalToken (this crate, boundary cell)
        |  produces BurnReceiptCell  /  absorbs MintClaimCell + AttestationCell
        v
   BurnReceiptCell / MintClaimCell (wire shape)
```

## Cell-data layout

| field | bytes | offset |
|-------|-------|--------|
| version | 1 | 0 |
| amount | 16 | 1 |
| chain_id | 8 | 17 |
| direction | 1 | 25 |
| reserved | 6 | 26 |

Min 32 bytes. `direction` = 0 (inbound from another chain) or 1 (outbound
toward another chain).

## Authority modes

1. **Burn into receipt**: input direction=outbound MessagingHubCanonicalTokenCell ⇒ BurnReceiptCell with matching amount.
2. **Mint from attestation**: MintClaimCell consumed + AttestationCell present ⇒ output direction=inbound cell with matching amount.
3. **Direction-preserved transit**: per-direction sum-equality across inputs/outputs (no inbound <-> outbound flips).

## Build

```bash
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p messaging-hub-canonical-token-cell-type-script
```

## Status

Scaffold. Source-reviewable; not machine-verified (same blockers as
sibling crates: capsule not installed + nightly-2024-09-01 vs deps
requiring stable 1.85+ + C-compiler not on PATH per
`contracts-ckb/test-infra/SETUP.md`).

Known limitations:
1. Companion-cell detection is data-shape-heuristic, not code-hash-matched. Marked `// TODO` in source.
2. No cycle benchmark.
3. AttestationCell presence check is presence-only — actual BLS verify happens in the AttestationCell type-script.

## Cross-references

- Spec: `contracts-ckb/specs/messaging-hub.md`
- Sibling: `messaging-hub-burn-receipt-cell-type-script/`
- Sibling: `messaging-hub-validator-registry-cell-type-script/`
- Sibling: `messaging-hub-attestation-cell-type-script/`
- Wallet-side: `vibeswap-canonical-token-type-script/`
