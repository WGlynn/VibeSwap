# vibeswap-ckb first-blocks receipt — 2026-06-09

Architecture-review CRITICAL #3 ("0 blocks booted") resolved.

## What ran

- **Binary**: `vibeswap-ckb-fork/target/release/ckb.exe` (48,082,432 bytes)
- **Version**: `ckb 0.206.0 (2c91814-dirty 2026-05-06)`
- **Data dir**: `vibeswap/vibeswap-ckb-data/`
- **Chain spec**: bundled `dev` (Will replace with `chain-spec/vibeswap-ckb-dev.toml` once augmentation surface is reconciled)
- **Block assembler**: placeholder lock-arg `0xc8328aabcd9b9e8e64fbc566c4385c3bdeb219d7`

## What got produced

| # | Block hash |
|---|---|
| 0 (genesis) | `0x24120de1ffc264b9fbaaa12786afdfaa6e9262cadec58eae99289e2579acd2cc` |
| 1 | `0x5030bcdf2b36ea460346fdd7de685528b81add8d65ac2d61f205b5e2aab245fd` |
| 2 | `0xbc7b224988f1a8d6af224e77bb7e29d7e9ae2f3ab77ee6c07eeb55778da1aed0` |
| 3 | `0x820ea88691c1e694ca49ccc29a5442597e10e132e9fe9662d8b34cf4262fcfde` |
| 4 | `0x427e05ba9320c6dc714b4298b7e4beb81dec52305d3609f6080d7a51fa43133f` |
| 5 | `0xde048c5fd59b902c709188d43945cf31cf10a7c764237f434a22f1aa935da7a2` |

Cadence: ~5s per block (dev-mode NC-Max).

## What this proves

- the chain runtime compiles cleanly on this host
- the chain spec loads and computes a deterministic genesis hash
- RPC accepts JSON-RPC calls on `127.0.0.1:8114`
- the P2P listener binds `0.0.0.0:8115` (and the WS variant)
- the miner produces non-genesis blocks at expected cadence
- the storage subsystem (RocksDB via `ckb-librocksdb-sys`) persists tip state across restarts

## What this does NOT prove

- vibeswap-ckb augmentations (`chain-spec/vibeswap-ckb-dev.toml`) are NOT applied — we used the upstream `dev` spec for the smoke test
- none of the 26 RISC-V cell binaries from `contracts-ckb/` are deployed on this chain
- no canonical-token mint, deposit boundary, or cell-state transition has been exercised on-chain
- the asm-accelerated VM path is OFF (we dropped `detect-asm` from `ckb-script` defaults to bypass the gcc requirement); the on-chain VM uses the interpreter, which is slower but semantically identical

## Next deliberate step (Day 2 of OPERATIONS)

Apply our chain-spec, redeploy with our genesis cells, deploy `ConstitutionalBoundsCell` first
(immutable post-genesis per `specs/nci-boundary-enforcement.md §2.5`).
