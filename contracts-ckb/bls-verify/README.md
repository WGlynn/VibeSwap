# bls-verify

Shared `no_std` BLS12-381 aggregate-signature verifier. Path 1+3 per
the cycle-budget spike (`contracts-ckb/specs/bls12-381-cycle-budget-spike.md` §5).

## What this does

One library, two callers:
- `messaging-hub-attestation-cell-type-script` (this batch)
- `nci-score-cell-type-script` (Agent 25 NCI work, future)

Verifies a threshold-aggregated BLS signature against a known
validator-pubkey set. Implements:
- Signer-bitmap parsing with trailing-bit zero-check
- G1 pubkey aggregation via projective accumulator
- IETF hash-to-G2 (SSWU map under `BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_`)
- Single pairing equality check
- Optional proof-of-possession verifier (Boneh-Drijvers-Neven rogue-key defense)

## Public API

```rust
pub struct AggregateInputs<'a> { ... }
pub fn verify_aggregate(inputs: &AggregateInputs) -> Result<(), BlsError>;
pub fn verify_proof_of_possession(pubkey: &[u8; 48], pop_sig: &[u8; 96], dst: &[u8]) -> Result<(), BlsError>;
pub mod molecule_digest {
    pub fn attestation_preimage(...) -> Vec<u8>;
}
```

## Build

```bash
# Library, not a binary. Builds with the workspace.
cargo build --release \
  --target riscv64imac-unknown-none-elf \
  -p bls-verify
```

## Cycle budget

Per spike (100-signer aggregate-verify):
- Post-MOP: ~58M-65M cycles (1.7% of max_block_cycles)
- Pre-MOP (out-of-box): ~75M-90M cycles (2.5%)
- Block budget: 3.5B cycles

24-signer genesis case: ~1.2M cycles for pk_agg phase + ~50M for the pairing = ~51M total.

## Known blockers (honest)

1. **`bls12_381 0.8.x` hash-to-curve feature gate.** The `experimental`
   feature must be enabled. If 0.8.x is what cargo resolves, that's
   already enabled in this crate's deps. If a newer minor version moves
   the API: see `// TODO: verify against bls12_381 0.x` in `src/hash_to_curve.rs`.
2. **No cycle benchmark yet.** The spike numbers are estimates by
   decomposition from the Nervos blog's 51.8M-cycle single-verify
   figure. Real cycle count gated on `ckb-debugger` integration (Task 27).
3. **Crate audit.** zkcrypto/bls12_381 carries an "unaudited" disclaimer.
   The spike's recommendation is to pin version + run differential tests
   against `ark-bls12-381` pre-mainnet.

## Cross-references

- Spec: `contracts-ckb/specs/bls12-381-cycle-budget-spike.md`
- Consumer A: `messaging-hub-attestation-cell-type-script/`
- Consumer B (future): `nci-score-cell-type-script/`
- Validator registry: `messaging-hub-validator-registry-cell-type-script/`
