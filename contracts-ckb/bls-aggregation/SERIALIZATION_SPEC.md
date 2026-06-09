# SERIALIZATION_SPEC — Canonical Attestation Digest + Witness Layout

**Spec layer**: `contracts-ckb/bls-aggregation/`
**Consumers**: `bls-verify/` (on-chain), `bls-aggregator/` (off-chain),
`messaging-hub-attestation-cell-type-script/` (on-chain consumer),
`messaging-hub-validator-registry-cell-type-script/` (registry lookup).
**Status**: Draft. **Source-reviewable**, not yet machine-verified
end-to-end (same workspace blockers as the rest of `contracts-ckb/`:
toolchain pinning, cc on PATH, capsule install — see
`tests/README.md`).
**Date**: 2026-06-08
**Blocker resolved**: Per `bls12-381-cycle-budget-spike.md §8 Open
question 3` ("MessagingHub message canonical-digest format. **Blocks
AttestationCell implementation start.**"). This spec is that
resolution.

---

## 1. Why canonical serialization matters

The BLS aggregate signature is computed over a hash of bytes. If two
validators disagree about what those bytes are, their individual
signatures fail to aggregate — `pk_agg` and `H(m)` no longer pair
correctly. The on-chain `bls-verify::verify_aggregate` will reject the
attestation with `PairingMismatch` and the cross-chain mint stalls
indefinitely.

This spec fixes the bytes. Every validator MUST produce identical
preimage bytes for identical payload tuples. The off-chain
`bls-aggregator` and on-chain `bls-verify::molecule_digest` produce
those bytes by the SAME procedure.

The byte-equality is enforced by the cross-port test
`hash_to_g2_matches_aggregator` (`bls-verify/tests/test_basic.rs`),
which runs the off-chain digest through the on-chain hash-to-G2 and
compares the resulting G2 point against an aggregator-precomputed
expectation. CI MUST keep this test green or the BLS pipeline is
broken.

## 2. Canonical Digest

### 2.1 Preimage fields and layout

The signed-message preimage is the byte-concatenation of six fields in
fixed Molecule-style layout. **All multi-byte integers are
little-endian.** All `[u8; N]` arrays are raw bytes in the order
provided. No length prefix is emitted for the fixed-size struct (per
Molecule fixed-struct semantics).

| offset | size | field                   | type      | source             |
|--------|------|-------------------------|-----------|--------------------|
|   0    |   8  | `source_chain_id`       | `u64 LE`  | AttestationCell    |
|   8    |  32  | `source_burn_id`        | `[u8;32]` | BurnReceiptCell on source chain |
|  40    |  16  | `amount`                | `u128 LE` | AttestationCell    |
|  56    |  32  | `destination_recipient` | `[u8;32]` | AttestationCell    |
|  88    |   8  | `destination_chain_id`  | `u64 LE`  | AttestationCell (== our_chain_id) |
|  96    |   8  | `attested_at_epoch`     | `u64 LE`  | ValidatorRegistryCell.epoch |

**Total preimage size: 104 bytes.** Constant for every attestation.

### 2.2 Why these six fields

Each field is load-bearing for a distinct integrity property. Removing
any one of them opens a class of cross-chain replay or supply-leak:

- **`source_chain_id`** — Without it, two unrelated chains could emit
  the same `burn_id` and both attestations would mint on the
  destination. Per `messaging-hub.md § SupplyAccountantCell` the
  sum-of-supplies invariant requires per-source attribution.
- **`source_burn_id`** — The freshness primitive. Per `messaging-hub.md
  § BurnReceiptCell` invariant: `burn_id` is fresh (not present in any
  other BurnReceiptCell consumed by the SupplyAccountantCell update).
- **`amount`** — The mint authorization quantity. Per `messaging-hub.md
  § MintClaimCell` invariant: amount and recipient_lock_hash match the
  attestation.
- **`destination_recipient`** — Without it, an attestation could be
  rebound to a different recipient.
- **`destination_chain_id`** — Without it, an attestation valid for one
  chain could be replayed on another VibeSwap-canonical chain (BSC,
  Polygon, etc). All chains run identical bytecode per
  `vibeswap/docs/research/papers/post-layerzero-canonical-messaging.md`,
  so the destination_chain_id is the only thing distinguishing them.
- **`attested_at_epoch`** — Binds the attestation to a specific
  ValidatorRegistryCell epoch. Without it, an attestation from a
  previously-active validator set could be replayed after registry
  rotation. Per `messaging-hub.md § AttestationCell` invariant:
  `attested_at_epoch` matches the ValidatorRegistryCell's epoch (no
  stale attestations across registry updates).

### 2.3 Digest derivation

The 32-byte digest passed to BLS hash-to-G2 is:

```text
canonical_digest = blake2b-256(preimage_104_bytes)
```

Using blake2b (NOT blake3, NOT sha256, NOT keccak) because:

1. ckb-std exposes blake2b natively via `ckb_std::blake2b` (no extra
   dep on cell side).
2. CKB-VM ships a blake2b syscall fast-path; using anything else costs
   cycles for no benefit.
3. Per `messaging-hub.md` Open Question 3 the spec already gestured at
   blake2b-of-tuple as one option; this spec ratifies it.

The 32-byte digest is then mapped to G2 via the BLS hash-to-curve
suite documented in §3.

## 3. BLS hash-to-curve suite

### 3.1 Suite identifier

Per RFC9380 §8.8.1 and IETF `draft-irtf-cfrg-bls-signature-05` §4.2.3:

```text
BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_
```

Implemented in `bls12_381::hash_to_curve::ExpandMsgXmd<sha2::Sha256>`
+ `HashToCurve` trait on `G2Projective`.

### 3.2 Domain-separation tag (DST)

The VibeSwap-specific DST, baked into both the off-chain aggregator
and the on-chain verifier as a compile-time constant:

```text
BLS_SIG_VIBESWAP_MESSAGING_V1_BLS12381G2_XMD:SHA-256_SSWU_RO_
```

**Length**: 60 bytes. Under the RFC9380 §5.3 `expand_message_xmd`
255-byte cap.

### 3.3 Why a VibeSwap-specific DST

A bare IETF DST would allow validator BLS keys to be reused on any
unrelated BLS protocol (Ethereum staking, Filecoin, etc.) and a
signature from there could potentially be replayed as a VibeSwap
attestation. The DST `_VIBESWAP_MESSAGING_V1_` byte sequence in the
middle forces the SSWU map into a distinct hash output domain,
domain-separating VibeSwap attestations from every other BLS-using
protocol.

The trailing `_V1_` is an explicit version slot for a future migration
(e.g., if a key-rotation event ever required hard-cutting all stored
signatures). DO NOT change without a coordinated validator rotation —
any DST change forces every validator to re-sign every in-flight
attestation.

### 3.4 Proof-of-possession DST (separate constant)

The validator-bond proof-of-possession (per `bls12-381-cycle-budget-
spike.md §8 Open question 2`) uses a DIFFERENT DST so a PoP signature
cannot be replayed as a MessagingHub attestation:

```text
BLS_POP_VIBESWAP_VALIDATOR_BOND_V1_BLS12381G2_XMD:SHA-256_SSWU_RO_
```

Same suite, distinct VibeSwap-context bytes. Used by the (future)
`ValidatorBondCell` type-script's PoP verifier path
(`bls-verify::verify_proof_of_possession`).

## 4. Witness Layout

The aggregated witness blob produced by `bls-aggregator` and consumed
by `messaging-hub-attestation-cell-type-script` is a length-recoverable
binary blob. The on-chain consumer recovers length from
`n_validators`, so no separate length prefix is emitted.

| offset            | size       | field               | notes |
|-------------------|------------|---------------------|-------|
| 0                 | 1          | `version`           | = `1`. Bump on layout change. |
| 1                 | 32         | `canonical_digest`  | per §2.3 |
| 33                | 96         | `aggregate_signature` | G2 compressed |
| 129               | 2 (u16 LE) | `n_validators`      | active registry size |
| 131               | ceil(N/8)  | `signer_bitmap`     | bit i set ⇒ validator i contributed |
| 131 + ceil(N/8)   | 8 (u64 LE) | `attested_at_epoch` | must match registry epoch |

**Total: `139 + ceil(n_validators / 8)` bytes.**

Concrete cases:
- Genesis 24-validator set: `139 + 3 = 142 bytes`
- Spec ceiling 200-validator set: `139 + 25 = 164 bytes`

### 4.1 Bitmap encoding

Bit `i` of the whole bitmap is `(signer_bitmap[i / 8] >> (i % 8)) & 1`.
Bits past `n_validators - 1` MUST be zero. The on-chain verifier
rejects trailing set-bits with `BlsError::BitmapOutOfRange` to block
trailing-bit-flip attacks.

### 4.2 Aggregate signature encoding

96 bytes of BLS12-381 G2 compressed-point. `bls12_381::G2Affine::
to_compressed` on the aggregator side; `G2Affine::from_compressed` on
the verifier side. The compressed encoding is canonical per the
zkcrypto crate's documented behavior.

The aggregate is computed by the aggregator as
`Σ_{i ∈ signers} sig_i` in G2-projective space, then converted to
affine for compression. BLS aggregation is **commutative** in G2, so
the aggregator does not need to fix a signer-order convention — any
order produces bit-identical compressed bytes.

### 4.3 Canonical digest field

Included in the witness explicitly (NOT recomputed by the on-chain
verifier) for two reasons:

1. **Audit-trail**: the AttestationCell carries the exact bytes that
   were signed. A failed verify produces an immediate disagreement
   surface: re-derive the digest from the payload tuple, compare
   against the witness field, identify whether the failure was in
   serialization, hashing, or aggregation.
2. **Cycle budget**: re-running the blake2b-256 over the 104-byte
   preimage costs a few thousand cycles on CKB-VM. Trivial, but
   non-zero. Carrying the digest in witness lets the verifier go
   straight to hash-to-G2.

The on-chain verifier still recomputes the digest from the
AttestationCell's other data fields (per `messaging-hub.md §
AttestationCell` invariant: `attestation_id: [u8; 32]` hash of the
attested message) and compares against the witness field. Mismatch ⇒
verify aborts with the attestation-cell-level error code (NOT a BLS
error — this is a serialization integrity check).

## 5. Test vectors

A reviewable set of canned vectors lives in
`bls-aggregator/tests/vectors/`. **Status**: spec-skeleton, no
vectors committed yet. Vectors to land before merge of the integration-
test harness:

- **`vector_genesis_2of3.json`**: 3-validator set, 2 signers, fixed
  pubkeys, fixed signatures, fixed canonical digest, fixed expected
  witness bytes. The smallest fully-reproducible end-to-end vector.
- **`vector_genesis_16of24.json`**: 24-validator genesis case, 2/3
  threshold met exactly.
- **`vector_200_validators_134of200.json`**: spec-ceiling case from
  `bls12-381-cycle-budget-spike.md §8.4`.
- **`vector_trailing_bit_attack.json`**: bitmap with a trailing bit
  set; verifier MUST reject.
- **`vector_amount_overflow_boundary.json`**: `amount = u128::MAX`;
  serialization stable, verify still passes.

CI gate (post-harness): cross-implementation differential test against
`ark-bls12-381` per `bls12-381-cycle-budget-spike.md §8 Open question
5` runs over these same vectors. Disagreement ⇒ CI red.

## 6. Forward-compat policy

The `version` byte at offset 0 of the witness blob and the `V1_`
suffix in both DSTs (§3.2 + §3.4) reserve room for a future layout
change. Any change to:

- Field order or sizes in §2.1
- Hash function in §2.3
- Suite identifier in §3.1
- DST string in §3.2 or §3.4
- Witness layout in §4

is a **breaking on-chain change**. Requires a coordinated validator-
set rotation and a new genesis ValidatorRegistryCell. The witness
`version` byte bumps to `2`, the DST gets a `V2_` slot, and the on-
chain verifier supports both versions during the transition window
(implementation: match on the `version` byte and dispatch to the
correct decoder).

## 7. Open questions

1. **Recipient address shape for non-CKB destinations.** Section 2.1
   fixes `destination_recipient` at 32 bytes. CKB lock-hashes are 32
   bytes. Ethereum addresses are 20 bytes (pad how? left-pad with
   zero ⇒ collision-free per address class). Solana addresses are 32
   bytes (ed25519 pubkey ⇒ no padding). Other chains TBD. Recommend
   left-pad with zero for shorter address classes; tag the pad
   convention in the AttestationCell's destination-chain-id-to-class
   map (governance-gated).
2. **Multi-recipient attestations.** Current spec is one-recipient-per-
   attestation. If we want to batch (e.g., one attestation per validator
   epoch carrying N mints), the preimage shape changes to a Vec of
   sub-tuples and the digest folds them via a Merkle root. Deferred to
   V2.
3. **`attested_at_epoch` lookahead.** Validators sign at the epoch they
   observe the burn, which might lag the destination chain's epoch by
   a few blocks. Acceptance window: `|registry_epoch -
   attested_at_epoch| <= 1`? Or strict equality? Strict equality is
   simpler but forces validators to re-sign across epoch boundaries.
   Recommend strict equality + a 1-epoch grace window enforced at the
   AttestationCell type-script layer.

## 8. Cross-references

- Spec: `contracts-ckb/specs/bls12-381-cycle-budget-spike.md` § 5, § 8
- Spec: `contracts-ckb/specs/messaging-hub.md` § AttestationCell, §
  BurnReceiptCell, § SupplyAccountantCell
- Canonical messaging paper:
  `vibeswap/docs/research/papers/post-layerzero-canonical-messaging.md`
- On-chain verifier: `contracts-ckb/bls-verify/`
- Off-chain aggregator: `contracts-ckb/bls-aggregator/`
- Implementation plan:
  `contracts-ckb/bls-aggregation/IMPLEMENTATION_PLAN.md`
- IETF BLS draft:
  `draft-irtf-cfrg-bls-signature-05`
- RFC9380: Hashing to Elliptic Curves (§8.8.1 BLS12-381 G2 suite)
- Mechanism primitives: `[P·structure-does-the-work]`,
  `[P·honesty-as-structural-load-bearing-property]`,
  `[F·post-layerzero-canonical-messaging]`,
  `[F·augmented-mechanism-design-paper]`
