# bls-aggregator

Off-chain BLS12-381 signature aggregator for VibeSwap-CKB MessagingHub
attestations. Per `specs/bls12-381-cycle-budget-spike.md §4 Path 3` —
the validator-side companion to the on-chain `bls-verify` library.

## What this does

Runs on a validator node (host-target, NOT a CKB cell). Reads a
directory of per-validator signature files, verifies each individual
signature against the canonical attestation digest, aggregates the
surviving signatures into a single 96-byte BLS aggregate sig +
signer-bitmap, and emits a witness blob ready for direct embedding in
an `AttestationCell` transaction witness.

The 5-tuple under attestation is:
`(source_chain_id, source_burn_id, amount, destination_recipient,
destination_chain_id)`, plus `attested_at_epoch` per
`SERIALIZATION_SPEC.md`.

## Why off-chain

Per the cycle-budget spike's Path 3 rationale:

- N individual signature verifies cost ~10ms each on host hardware.
  Cheap, parallelizable, and CKB-VM-cycle-free.
- Drop bad signatures BEFORE they corrupt the aggregate.
- Keep the on-chain verify at exactly one pairing-check (~50M cycles,
  1.7% of `max_block_cycles`).

## Usage

```bash
bls-aggregator \
    --attestation-payload  ./payload.json \
    --validator-registry   ./registry.json \
    --signatures-dir       ./sigs/ \
    --output               ./attestation-witness.bin \
    --attested-at-epoch    42 \
    [--min-signers 16]
```

### Input file shapes

`payload.json`:
```json
{
  "source_chain_id":        1,
  "source_burn_id":         "00..32-bytes-hex..00",
  "amount":                 1000000000,
  "destination_recipient":  "ff..32-bytes-hex..ff",
  "destination_chain_id":   2
}
```

`registry.json`:
```json
{
  "epoch":       7,
  "threshold_n": 16,
  "threshold_d": 24,
  "validators": [
    { "index": 0,  "pubkey_hex": "..." },
    { "index": 1,  "pubkey_hex": "..." },
    ...
    { "index": 23, "pubkey_hex": "..." }
  ]
}
```

`sigs/*.json` (one file per validator):
```json
{
  "validator_index": 7,
  "pubkey_hex":      "...",
  "signature_hex":   "..."
}
```

### Output

Binary blob, layout per `SERIALIZATION_SPEC.md § Witness Layout`:

| offset            | size       | field               |
|-------------------|------------|---------------------|
| 0                 | 1          | version (= 1)       |
| 1                 | 32         | canonical_digest    |
| 33                | 96         | aggregate_signature |
| 129               | 2 (u16 LE) | n_validators        |
| 131               | ceil(N/8)  | signer_bitmap       |
| 131 + ceil(N/8)   | 8 (u64 LE) | attested_at_epoch   |

Total = 139 + ceil(N/8) bytes. For the 24-validator genesis set
(`ceil(24/8) = 3`): 142 bytes.

## Build

This is a standalone Cargo project, NOT a workspace member of
`contracts-ckb/`. The host toolchain is stable Rust:

```bash
cd contracts-ckb/bls-aggregator
cargo build --release
# emits: target/release/bls-aggregator
```

The binary is intended to ship inside the validator-node distribution
(systemd unit, container image, etc).

## Cross-references

- Spec: `contracts-ckb/specs/bls12-381-cycle-budget-spike.md` §4 Path 3
- Spec: `contracts-ckb/specs/messaging-hub.md` § AttestationCell
- Serialization spec: `contracts-ckb/bls-aggregation/SERIALIZATION_SPEC.md`
- Implementation plan: `contracts-ckb/bls-aggregation/IMPLEMENTATION_PLAN.md`
- On-chain companion: `contracts-ckb/bls-verify/`
- Mechanism primitives: `[P·structure-does-the-work]`,
  `[P·honesty-as-structural-load-bearing-property]`,
  `[F·augmented-mechanism-design-paper]`
