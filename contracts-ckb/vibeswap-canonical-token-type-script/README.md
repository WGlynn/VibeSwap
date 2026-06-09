# vibeswap-canonical-token-type-script

CKB type-script for the **CanonicalTokenCell** of VibeSwap's canonical
burn-and-mint cross-chain messaging mechanism. Compiles to RISC-V via
`ckb-script-templates` conventions; runs inside CKB-VM as the type-script
gating mint / burn / transfer of canonical-VibeSwap tokens on the sovereign
CKB-VibeSwap chain.

## What this is

A scaffold of the on-chain authority check for `CanonicalTokenCell`. It
inherits the sUDT (RFC-0025) shape so existing sUDT lock-script ecosystem
tooling (Omnilock, secp256k1-sighash, anyone-can-pay) works unchanged, and
extends the cell-data with a `source_chain_id` field so every token unit
carries provenance for the SupplyAccountantCell sum-of-supplies invariant.

## What this is NOT

- Not audit-ready. Specifically the companion-cell detection
  (`find_mint_claim_amount` / `find_burn_receipt_amount`) currently uses
  data-shape heuristics. The production version must match on the deployed
  `mint-claim-type-script` / `burn-receipt-type-script` **code-hash**.
  Searched as `TODO` in the source.
- Not the validator-attestation logic. That lives in
  `attestation-cell-type-script` (also scaffold-only).
- Not the supply accountant. That lives in
  `supply-accountant-cell-type-script` (also scaffold-only).
- Not a substitute for the existing Solidity `VibeSwapCanonicalToken.sol`
  on EVM chains; both implementations enforce the same canonical-burn-and-
  mint invariants but in different substrates.

## Lineage

This crate replaces VibeSwap's previous reliance on LayerZero V2 / OFT for
canonical cross-chain messaging. The LayerZero dependency was abandoned
after the 2026-04 KelpDAO/LZ DVN-RPC compromise; the replacement mechanism
is documented in `vibeswap/docs/research/papers/post-layerzero-canonical-
messaging.md`.

## Invariants enforced

### Cell-data layout

```text
| field             | bytes | offset |
|-------------------|-------|--------|
| amount            |  16   |   0    |   sUDT canonical, u128 LE
| version           |   1   |  16    |   must == SCHEMA_VERSION (1)
| source_chain_id   |   8   |  17    |   u64 LE; must be non-zero
| reserved          |   7   |  25    |   zero, ignored
```

Total minimum cell-data = 32 bytes. Trailing bytes tolerated.

### Type-script args

Exactly 32 bytes = `blake2b256(owner_lock_script)`. Mirrors sUDT.

### Authority modes

Three modes selected by amount-direction:

1. **Transfer** (`sum_in == sum_out`): standard sUDT conservation. Plus:
   every `source_chain_id` on output must appear on input. Blocks origin-
   relabel attacks.

2. **Mint** (`sum_out > sum_in`): allowed if owner-mode (sUDT-canonical
   governance path) OR if the transaction consumes a MintClaimCell of the
   exact mint delta. The MintClaimCell is itself produced only against a
   validator-threshold-signed AttestationCell — see messaging-hub.md.

3. **Burn** (`sum_in > sum_out`): allowed if owner-mode OR if the
   transaction produces a BurnReceiptCell of the exact burn delta. The
   BurnReceiptCell is the public evidence consumed by destination-chain
   validators to authorize a corresponding mint there.

### Error codes

See `src/error.rs`. Summary:
- 1-4: ckb-std passthrough
- 30-34: sUDT-shape violations (conservation, overflow, malformed data,
  malformed args, unsupported schema)
- 40-45: canonical-burn-and-mint violations (mint without claim, burn
  without receipt, amount mismatch, origin mutated, reserved chain ID)

## Build

The build path matches the rest of `contracts-ckb/`. Two known approaches:

### Via `capsule` (Nervos-canonical for CKB scripts)

```bash
# from contracts-ckb/
capsule build --release
# emits: contracts-ckb/build/release/vibeswap-canonical-token-type-script
```

### Via raw cargo (RISC-V target)

```bash
# from contracts-ckb/
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p vibeswap-canonical-token-type-script
```

The workspace already pins `riscv64imac-unknown-none-elf` in
`rust-toolchain.toml` and uses `ckb-std 0.16` workspace-wide.

## Known build blockers (honest)

The crate **source** is reviewable today, but actually producing the
RISC-V binary on the current dev machine has the same blockers as the
rest of `contracts-ckb/` (documented in `tests/README.md`):

1. **Toolchain pinning.** `rust-toolchain.toml` pins
   `nightly-2024-09-01`. Some transitive deps of `ckb-testtool` now
   require Rust 1.85+. Workaround: `RUSTUP_TOOLCHAIN=stable` for the test
   harness; keep the nightly pin for the on-chain crates.

2. **C compiler not on PATH.** `ckb-testtool` pulls `blake2b-rs` which
   needs `cc`. MinGW-w64 or MSVC Build Tools required. Not installed on
   the current machine.

3. **`capsule` not installed.** Required for the canonical build path.
   Listed as a known blocker in `UPSTREAM.md`.

Until the above are cleared, this crate is in the same state as its
siblings: **source-reviewable, not yet machine-verified**.

## Deploy

Two-step pattern (matches the rest of the sovereign CKB-VibeSwap chain):

1. **Deploy the script binary** as a CKB code-cell. Once deployed, the
   code-cell's outpoint becomes the canonical reference for the type-
   script across every CanonicalTokenCell.

2. **Construct CanonicalTokenCells** with `type_script.code_hash =
   blake2b256(code-cell-data)`, `type_script.hash_type = data1`, and
   `type_script.args = owner_lock_hash` (32 bytes).

The genesis distribution of canonical tokens is governed by the chain's
genesis configuration, not by this script. Post-genesis, all supply
changes flow through the mint / burn authority modes above.

## Tests

See `tests/test_basic.rs`. The integration tests live in the workspace's
`tests/` crate and follow the pattern documented in
`contracts-ckb/tests/README.md` — they use `ckb-testtool` and depend on
the Capsule-built binary being present. Until then they emit
`[CYCLE5 SKIP]` rather than falsely pass.

## Cross-references

- Spec: `vibeswap/contracts-ckb/specs/messaging-hub.md`
- Upstream survey: `vibeswap/contracts-ckb/UPSTREAM.md` (sUDT, ckb-std)
- Companion crates (also scaffolding):
  - `burn-receipt-type-script/` (planned)
  - `mint-claim-type-script/` (planned)
  - `attestation-type-script/` (planned)
  - `supply-accountant-type-script/` (planned)
  - `validator-registry-type-script/` (planned)
- Solidity sibling: `vibeswap/contracts/messaging/VibeSwapCanonicalToken.sol`
- Paper: `vibeswap/docs/research/papers/post-layerzero-canonical-messaging.md`
