# messaging-hub-attestation-cell-type-script

The BLS verification cell. Anyone can produce one by collecting threshold
validator signatures off-chain and submitting them as an AttestationCell.
This script verifies the aggregate signature against the active
ValidatorRegistryCell (read via cell-dep).

## Cell-data layout

| field | bytes | offset |
|-------|-------|--------|
| version | 1 | 0 |
| attestation_id | 32 | 1 |
| source_chain_id | 8 | 33 |
| source_burn_id | 32 | 41 |
| amount | 16 | 73 |
| destination_recipient | 32 | 89 |
| destination_chain_id | 8 | 121 |
| attested_at_epoch | 8 | 129 |
| aggregate_signature | 96 | 137 |
| signer_bitmap | var | 233 |

Fixed header: 233 bytes. Bitmap tail: ceil(n_validators / 8) bytes.

## Signed-message format (per PairwiseVerifier decision)

Molecule struct concatenation of the six fields (source_chain_id,
source_burn_id, amount, destination_recipient, destination_chain_id,
attested_at_epoch). 32-byte blake2b digest is what validators sign.

DST: `BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_VIBESWAP_ATTESTATION_V1_`

## Invariants enforced

1. `destination_chain_id == OUR_CHAIN_ID` (compile-time sentinel pending ChainConfigCell)
2. `attested_at_epoch == registry.epoch`
3. `attestation_id == blake2b(canonical preimage)`
4. `signer_bitmap.len() == ceil(registry.n_validators / 8)`
5. BLS aggregate signature verifies under selected pubkeys (via bls-verify)
6. Threshold met (via bls-verify)
7. Attestation cells are create-only (no in+out same type in one tx)

## BLS integration end-to-end (skeleton)

This crate is the END-TO-END SKELETON of BLS aggregate-verify integration
on CKB. Wired:
- Cell-data layout
- Molecule preimage builder (`bls-verify::molecule_digest`)
- blake2b digest (`ckb-std::high_level::blake2b_256`)
- bls-verify call with `AggregateInputs`
- Error pass-through (BlsLibError variant)

NOT finished:
- Cell-dep loading of registry uses positional index walk, not type-script-hash match
- bls12_381 0.x API symbol confirmation (marked `// TODO` in `bls-verify/src/`)
- ChainConfigCell integration (OUR_CHAIN_ID is a hardcoded sentinel)
- Actual cycle measurement (no ckb-debugger run yet)

## Build

```bash
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p messaging-hub-attestation-cell-type-script
```

## Status

Scaffold. Source-reviewable; not machine-verified. Most-likely
compilation hot spots are the bls-verify call site and the
`ckb-std::high_level::blake2b_256` symbol path.

Known limitations:
1. Registry cell-dep matched by data-shape, not type-script code-hash.
2. ChainConfigCell missing; OUR_CHAIN_ID is a sentinel.
3. No PoP verification at this layer (PoP lives at ValidatorBondCell).
4. No cycle benchmark.
5. The `bls-verify` symbol paths for `bls12_381::pairing` and
   `bls12_381::hash_to_curve` are marked `// TODO: verify against
   bls12_381 0.x` — they may need a small `cargo check` pass to lock in.

## Cross-references

- Spec: `contracts-ckb/specs/messaging-hub.md` § AttestationCell
- Cycle spike: `contracts-ckb/specs/bls12-381-cycle-budget-spike.md`
- BLS verifier: `bls-verify/`
- Registry: `messaging-hub-validator-registry-cell-type-script/`
- Siblings: `messaging-hub-canonical-token-cell-type-script/`, `messaging-hub-burn-receipt-cell-type-script/`
