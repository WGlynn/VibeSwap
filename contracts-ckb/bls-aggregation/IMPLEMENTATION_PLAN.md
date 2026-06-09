# IMPLEMENTATION_PLAN — BLS Aggregation Pipeline End-to-End

**Spec layer**: `contracts-ckb/bls-aggregation/`
**Status**: Living plan. Source-reviewable scaffolds shipped 2026-06-08;
machine-verified end-to-end build pending workspace toolchain blockers
documented in `tests/README.md`.
**Date**: 2026-06-08

---

## 1. Pipeline diagram

```
                       ┌──────────────────────────────────┐
                       │   Remote chain emits Burn event  │
                       │   (Ethereum / BSC / Polygon …)   │
                       └────────────────┬─────────────────┘
                                        │
                                        ▼
        ┌────────────────────────────────────────────────────┐
        │ Validator nodes (N = 24 at genesis, cap 200)       │
        │   each observes the burn via its light client      │
        │   each signs canonical_digest = blake2b-256(       │
        │     preimage_104_bytes per SERIALIZATION_SPEC §2)  │
        │   under VibeSwap MessagingHub DST                  │
        └────────────────┬───────────────────────────────────┘
                         │ gossip per-validator signatures
                         ▼
        ┌────────────────────────────────────────────────────┐
        │   bls-aggregator (off-chain, host-target binary)    │
        │     - reads ./sigs/ directory                       │
        │     - verifies each individual signature on host    │
        │     - drops bad signatures, logs skip reasons       │
        │     - aggregates surviving sigs into Σ in G2        │
        │     - emits witness blob per SERIALIZATION_SPEC §4  │
        │     - 139 + ceil(N/8) bytes                         │
        └────────────────┬───────────────────────────────────┘
                         │ binary witness
                         ▼
        ┌────────────────────────────────────────────────────┐
        │   AttestationCell submit transaction                │
        │     inputs:    capacity                             │
        │     outputs:   AttestationCell + MintClaimCell      │
        │     cell-deps: ValidatorRegistryCell + ChainConfig  │
        │     witnesses: [witness_blob_above]                 │
        └────────────────┬───────────────────────────────────┘
                         │ on-chain verify
                         ▼
        ┌────────────────────────────────────────────────────┐
        │   messaging-hub-attestation-cell-type-script        │
        │     parses witness, loads pubkeys from              │
        │     ValidatorRegistryCell, calls                    │
        │     bls-verify::verify_aggregate(&inputs)           │
        │     - Phase A: pk_agg reconstruction (~24×50K cyc)  │
        │     - Phase B: hash-to-G2 (~3-5M cycles)            │
        │     - Phase C: single pairing check (~50M cycles)   │
        │     ≈ 52M cycles total / 3.5B block budget = 1.5%   │
        └────────────────┬───────────────────────────────────┘
                         │ if Ok
                         ▼
        ┌────────────────────────────────────────────────────┐
        │   MintClaimCell consumable by destination_recipient │
        │     produces CanonicalTokenCell on consumption      │
        │     updates SupplyAccountantCell atomically         │
        └────────────────────────────────────────────────────┘
```

## 2. Component status — honest

Component-by-component as of 2026-06-08. **Source-reviewable** means
"the Rust file exists, the API surface matches the spec, the logic is
readable". **Machine-verified** means "cargo built it, tests passed
against canned vectors on this hardware".

| Component | Source-reviewable | Machine-verified | Blocker |
|-----------|-------------------|------------------|---------|
| `bls-verify/` (lib) | ✓ shipped 2026-06-08 | ✗ | workspace toolchain |
| `bls-verify/` API doc | ✓ shipped 2026-06-08 | n/a | — |
| `bls-aggregator/` (bin) | ✓ shipped 2026-06-08 | ✗ | needs keygen harness |
| `bls-aggregator/` CLI flags | ✓ defined | ✗ | needs `cargo build` smoke |
| `SERIALIZATION_SPEC.md` | ✓ shipped 2026-06-08 | n/a | — |
| Canned test vectors | ✗ enumerated, not written | n/a | needs keygen harness |
| `ValidatorRegistryCell` integration | partial (spec only) | ✗ | cell-type-script not landed |
| `AttestationCell` integration | partial (spec only) | ✗ | cell-type-script not landed |
| `MintClaimCell` linkage | spec only | ✗ | cell-type-script not landed |
| Differential test vs ark-bls12-381 | not started | n/a | post-harness |
| Cycle benchmark via ckb-debugger | not started | n/a | post-machine-build |

The pipeline is **not** end-to-end runnable on Will's dev machine
today. The bls-verify and bls-aggregator code is source-reviewable
against the spec; the workspace-wide toolchain blockers (rust-
toolchain pin vs stable, cc on PATH, capsule install) are documented in
`tests/README.md` and apply identically here.

## 3. End-to-end integration steps

Strict order, each step gates the next.

### Step 1 — Land per-validator BLS keygen harness

**What**: Host-side Rust binary `bls-keygen` (sibling of `bls-
aggregator/`) that generates a validator keypair (sk: Scalar, pk:
G1Affine) and a proof-of-possession signature against the PoP DST
from `SERIALIZATION_SPEC §3.4`. Output written as JSON for the
`bls-aggregator`'s expected input shape.

**Why first**: every downstream test needs synthetic keypairs. We
can't write integration tests without it.

**Gating**: out of scope for THIS task (Agent 9 BLS pipeline); proposed
as a follow-up task. Estimated 100–150 LOC.

### Step 2 — Wire up canned test vectors

**What**: Run `bls-keygen` once to produce 3-, 24-, and 200-validator
sets. Use those to populate `bls-aggregator/tests/vectors/` per
`SERIALIZATION_SPEC §5`. Each vector is a committed
`{payload.json, registry.json, sigs/*.json, expected_witness.bin}`
quad.

**Why second**: vectors are the cross-implementation check. Without
them we cannot prove the off-chain digest agrees with the on-chain
digest.

**Gating**: depends on Step 1.

### Step 3 — Cross-port byte-equality test

**What**: A workspace test (in `tests/src/bls_verify_tests.rs`) that
calls `bls-verify::molecule_digest::attestation_preimage(...)` with
the same fields as one of the canned vectors, blake2b-256s the
result, and asserts byte-equality against
`bls-aggregator/digest::canonical_attestation_digest(...)`. Failure
⇒ serialization drift between off-chain and on-chain.

**Why critical**: this is the SINGLE test that catches all
serialization regressions. Make it gate-on-CI.

**Gating**: depends on Steps 1 and 2 and workspace `cargo test`
blockers clearing.

### Step 4 — End-to-end aggregate-verify

**What**: A workspace integration test that:
1. Runs the aggregator on a canned vector
2. Loads the emitted witness blob
3. Constructs a synthetic AttestationCell tx with the blob in witnesses
4. Loads a synthetic ValidatorRegistryCell with the same pubkeys
5. Invokes `bls-verify::verify_aggregate` on the parsed inputs
6. Asserts `Ok(())`

Plus the failure-mode cases enumerated in `bls-verify/tests/
test_basic.rs` (threshold-not-met, off-curve pubkey, trailing-bit
attack, etc.).

**Why critical**: this is the load-bearing protocol test. If this
passes, the pipeline works.

**Gating**: depends on Step 3.

### Step 5 — Cycle benchmark via ckb-debugger

**What**: Wire `bls-verify::verify_aggregate` into a minimal CKB script
binary, run via `ckb-debugger` against the canned vectors. Log cycle
counts for the 3-, 24-, and 200-validator cases.

**Expected results** (per `bls12-381-cycle-budget-spike.md §2`):

| Vector | Estimated cycles | Block budget % |
|--------|------------------|----------------|
| 2-of-3 | ~52M | 1.5% |
| 16-of-24 | ~53M | 1.5% |
| 134-of-200 | ~63M | 1.8% |

If measured cycles deviate by > 2x from these estimates, escalate per
`bls12-381-cycle-budget-spike.md §6 Hand-tuning escalation` — MOP-
friendly inner-loop assembly rewrite of the Miller-loop hot path.

**Gating**: depends on `ckb-debugger` install (workspace blocker per
`tests/README.md`).

### Step 6 — Differential test vs ark-bls12-381

**What**: Build a parallel verify path using `ark-bls12-381`. Run the
same canned vectors through both `bls-verify` (zkcrypto/bls12_381)
and the ark-bls12-381 path. Disagreement ⇒ at least one crate has a
bug.

**Why**: per `bls12-381-cycle-budget-spike.md §8 Open question 5`,
the zkcrypto crate carries an "unaudited" disclaimer. A second
implementation in parallel is the cheapest meaningful integrity
gate before mainnet.

**Gating**: depends on Step 4.

### Step 7 — `messaging-hub-attestation-cell-type-script` wire-up

**What**: The cell-type-script crate (workspace member,
`riscv64imac-unknown-none-elf` target) parses the witness blob, loads
pubkeys from ValidatorRegistryCell via cell-dep, builds an
`AggregateInputs` struct, calls `bls_verify::verify_aggregate`, maps
the returned `BlsError` to the cell's own error enum, returns the
exit code.

**Status**: workspace member declared per
`contracts-ckb/Cargo.toml`, crate not yet scaffolded. THIS is the
direct consumer of `bls-verify`. Companion task in the chain-build
queue (priority slot 3 in `CHAIN_BUILD_README.md §What's not yet
built`).

**Gating**: depends on `bls-verify` being source-reviewable (✓ shipped
2026-06-08) and the lawson-constants / canonical-token cell scaffold
pattern (✓ shipped).

### Step 8 — Genesis ValidatorRegistryCell deploy

**What**: Generate 24 validator keypairs, sign PoP for each, populate
the genesis ValidatorRegistryCell, embed in
`chain-spec/vibeswap-ckb-dev.toml`. Boot the dev chain and post a
synthetic burn attestation end-to-end.

**Gating**: depends on Steps 1, 4, 7 and the chain-fork build
landing (per `FORK_PLAN.md`).

## 4. Risk register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| zkcrypto/bls12_381 0.x API drift between commit and audit | Medium | Medium | Pin to specific tag per `bls12-381-cycle-budget-spike.md §8.1`. |
| Cycle count exceeds budget at 200 validators | Low | High | MOP hand-tuning fallback per spike §6. RVV upstream landing is a fallback win condition. |
| Validator gossip layer doesn't deliver enough signatures | Medium | High | Not BLS-side. Tracked separately in `messaging-hub.md § Open Q "validator gossip layer"`. |
| DST drift between off-chain and on-chain | Low | Critical | Both use compile-time constant; cross-port test catches drift. |
| Trailing-bit attack on signer_bitmap | Medium (attacker class) | High | Trailing-bit check in `bls-verify` (`BlsError::BitmapOutOfRange`). |
| Rogue-key attack on aggregation | Low | Critical | Proof-of-possession at validator-bond time per spike §8.2. `bls-verify::verify_proof_of_possession` already shipped. |
| Cross-protocol BLS signature replay | Low | Critical | VibeSwap-specific DST forces distinct hash output domain. |
| Aggregator crash mid-aggregation | Medium | Low | Aggregator is restartable; signature files on disk; idempotent. |
| Witness blob too large for tx (> 100KB tx-size limit) | Negligible | High | Max witness = 164 bytes (200 validators). 4 orders of magnitude under. |

## 5. Out of scope for this pipeline

- **Validator gossip layer** — how validators distribute individual
  signatures before the aggregator runs. CKB-native libp2p gossip is
  one path; a designated coordinator pattern is another. Tracked in
  `messaging-hub.md § Open Questions`.
- **Multi-message aggregate-verify** — same-message is the supported
  case per `bls12-381-cycle-budget-spike.md §2`. The N+1-pairing
  multi-message case exceeds `max_block_cycles` at 200 validators and
  is structurally disallowed by THIS pipeline.
- **Cross-chain inbound from non-CKB chains** — validators run light
  clients of source chains. Light-client implementation is independent
  of the BLS pipeline; the BLS pipeline assumes the light client has
  already produced a verified burn observation.
- **Slashing on bad-attestation evidence** — `messaging-hub.md §
  ValidatorBondCell` and `slash-router.md`. The BLS pipeline produces
  the *evidence shape* (a signed attestation that turned out to be on
  a non-existent burn) but does not implement the slashing logic.

## 6. Open questions (carried forward)

1. **`bls12_381` crate version pin.** Recommend pinning to a specific
   release tag for reproducibility. Per spike §8.1 — revisit
   quarterly.
2. **Validator-registry size cap.** Spec says 200; current `bls-verify`
   heapless cap is 256 (safety margin). Should the cap be governance-
   tunable via LawsonConstantsRegistry? Recommend yes; bounded at the
   constitutional layer at 256.
3. **Witness blob length-prefix.** Current spec recovers length from
   `n_validators` field at offset 129. Should we add an explicit u16
   length prefix for parser robustness? Marginal cost (2 bytes), real
   robustness gain. **Recommend yes — bump witness version to 1
   between now and mainnet.**
4. **Attested-at-epoch grace window.** §3 Open Question in
   SERIALIZATION_SPEC. Recommend strict equality + 1-epoch grace
   window enforced at AttestationCell type-script layer (not in
   bls-verify itself, which is epoch-agnostic).

## 7. Cross-references

- Spec: `contracts-ckb/specs/bls12-381-cycle-budget-spike.md`
- Spec: `contracts-ckb/specs/messaging-hub.md`
- Sibling: `contracts-ckb/bls-aggregation/SERIALIZATION_SPEC.md`
- Crate: `contracts-ckb/bls-verify/`
- Crate: `contracts-ckb/bls-aggregator/`
- Chain-build context: `contracts-ckb/CHAIN_BUILD_README.md`
- Augmentation surface: `contracts-ckb/AUGMENTATION_SURFACE.md`
- Canonical messaging paper:
  `vibeswap/docs/research/papers/post-layerzero-canonical-messaging.md`
- Companion cell-type-scripts (workspace members, scaffolds pending):
  - `messaging-hub-canonical-token-cell-type-script/`
  - `messaging-hub-burn-receipt-cell-type-script/`
  - `messaging-hub-validator-registry-cell-type-script/`
  - `messaging-hub-attestation-cell-type-script/`
- Mechanism primitives: `[P·structure-does-the-work]`,
  `[P·honesty-as-structural-load-bearing-property]`,
  `[F·post-layerzero-canonical-messaging]`,
  `[F·augmented-mechanism-design-paper]`,
  `[P·dissolve-attack-surface]`
