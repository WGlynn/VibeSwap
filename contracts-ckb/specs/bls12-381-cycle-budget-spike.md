# BLS12-381 Cycle Budget Spike — CKB-VM Feasibility

**Spike ID**: CKB-pivot task queue #9
**Status**: Research spike, decision-ready for MessagingHub
**Substrate**: VibeSwap-augmented Nervos CKB
**Consumers**: `messaging-hub.md` (AttestationCell type-script), `nci-consensus.md` (StakeWeightedVoteCell type-script)
**Date**: 2026-06-08

---

## 1. The problem

MessagingHub's AttestationCell type-script and NCI's StakeWeightedVoteCell type-script both need to verify a **BLS12-381 threshold-aggregated signature against an active validator set** inside CKB-VM. The verifier runs in `no_std` Rust compiled to RISC-V (RV64IMC + B extension, MOP-friendly assembly), with cell-data, witness, and cell-dep inputs.

Three pieces of structural friction make this non-trivial:

1. **Pairing cost at the substrate.** BLS verification is dominated by the `e(σ, g_2)` vs `e(H(m), pk_agg)` pairing check. A single optimal-ate pairing over BLS12-381 is roughly 4M–8M field-arithmetic operations on a 381-bit prime field. On a 64-bit RISC-V target without dedicated curve-arithmetic instructions, each field multiplication unrolls to ~30+ RV64 instructions per `Fp` mul, plus carry handling. The full pairing on bare CKB-VM is published at **~76.6M cycles pre-MOP, ~51.8M cycles post-MOP** (Nervos blog, [CKB-VM V1 upgrade](https://www.nervos.org/blog/major-protocol-upgrade-diving-into-ckb-vm-v1)). That figure refers to *one signature verify*, which is 2 pairings.
2. **CKB-VM has no native EC precompile.** Unlike EVM (EIP-2537) or Solana (curve syscalls), CKB-VM ships only blake2b, secp256k1, schnorr, ed25519 as user-space scripts. BLS12-381 must be brought along as a user-space Rust crate. No syscall fast-path exists today.
3. **Validator-set scale.** MessagingHub assumes a bonded validator set with a 2/3 threshold. Realistic n is 50–200. Aggregate-verify is BLS's whole point — but the type-script still has to:
   - Reconstruct `pk_agg = Σ pk_i` over selected signers (Σ in G1: each addition is ~10 `Fp` mul-equivalent),
   - Hash-to-G2 the message (`H(m)` over BLS12-381 G2: 1 SWU map + cofactor clearing ~ 2M–5M cycles),
   - Run a single pairing equality check (2 Miller loops + 1 final exponentiation).

The shape of cost is dominated by the pairing. The signature-count dimension only affects the `pk_agg` reconstruction phase, which is *linear in selected signers* but **at G1 cost (cheap)**, not pairing cost. This is the load-bearing property: BLS aggregate-verify is asymptotically O(1) in the number of signatures.

---

## 2. Measured & published cycle costs

Two sources give us concrete CKB-VM cycle numbers for BLS12-381 work. Both reference the `bls12_381` zkcrypto pure-Rust crate compiled to RV64.

### Single BLS12-381 signature verify (2 pairings)

| Implementation | Cycles | Source |
|---|---|---|
| Pre-MOP hand-optimized BLS verify | 76,600,000 | [Nervos blog](https://www.nervos.org/blog/major-protocol-upgrade-diving-into-ckb-vm-v1) |
| Post-MOP hand-optimized BLS verify | 51,800,000 | [Nervos blog](https://www.nervos.org/blog/major-protocol-upgrade-diving-into-ckb-vm-v1) |
| Groth16 verify (BLS12-381, sec-bit/ckb-zkp, pre-hardfork) | 121,139,970 | [Nervos Talk](https://talk.nervos.org/t/performance-improvement-of-ckb-hard-fork-take-ckb-zkp-as-an-example/6265) |
| Groth16 verify (BLS12-381, sec-bit/ckb-zkp, post-hardfork) | 106,577,254 | [Nervos Talk](https://talk.nervos.org/t/performance-improvement-of-ckb-hard-fork-take-ckb-zkp-as-an-example/6265) |
| Universal PLONK verify (BLS12-381, post-hardfork) | 159,745,129 | [Nervos Talk](https://talk.nervos.org/t/performance-improvement-of-ckb-hard-fork-take-ckb-zkp-as-an-example/6265) |

Groth16 verify is **3 pairings + a G1 multi-scalar mul over public inputs**. Subtract the MSM (~10–20M cycles at typical Groth16 public-input counts) and you get an upper bound on a 3-pairing batch: 86–96M cycles. Per-pairing isolated cost is therefore in the 25M–30M cycle band. A 2-pairing single-signature verify lands at ~50M cycles, matching the post-MOP figure. The numbers triangulate.

### Aggregate signature verify (N signatures, same message → 1 pairing-check)

This is the BLS case where threshold validators sign the **same attestation message** (the canonical case for MessagingHub and NCI). Verification cost decomposes as:

| Phase | Operation | Estimated cycles |
|---|---|---|
| Phase A: aggregate pubkeys | `pk_agg = Σ_{i ∈ S} pk_i` in G1, S = signer set | ~50K cycles × \|S\| |
| Phase B: hash to G2 | `H(m) → G2`, optimized SWU + cofactor | ~3M–5M cycles |
| Phase C: pairing-check | `e(σ_agg, g_2) =? e(H(m), pk_agg)` | ~50M cycles (post-MOP) |
| **Total (N=100 signers)** | | **~58M–60M cycles** |
| **Total (N=200 signers)** | | **~63M–65M cycles** |

The phase-A cost is **bounded and linear in selected-signer count**, but the constant is small (a G1 point add is roughly 11 `Fp` mul-equivalents). Even at 200 signers, phase A is single-digit percent of total. Phase C dominates. This is exactly the structural property BLS is designed for. No published CKB-VM benchmark of this aggregate-verify shape exists, but the decomposition follows directly from the per-pairing cost.

**No published benchmarks found for aggregate-verify on CKB-VM specifically; numbers above are estimated by decomposition from the published 51.8M-cycle single-verify figure.**

### Multi-signature verify (different message per signer)

If signers attest to **distinct messages**, BLS aggregate-verify needs `N+1` pairings ([IETF BLS draft](https://www.ietf.org/archive/id/draft-irtf-cfrg-bls-signature-05.html), Boneh-Drijvers-Neven). This is the worst case:

| Signer count N | Pairings | Estimated cycles |
|---|---|---|
| 10 | 11 | ~275M cycles |
| 50 | 51 | ~1.275B cycles |
| 100 | 101 | ~2.525B cycles |
| 200 | 201 | ~5.025B cycles |

The 200-signer distinct-message case **exceeds `max_block_cycles` (3.5B)** — see Section 3. This is a hard ceiling. For MessagingHub and NCI, we MUST stay in the same-message regime (validators sign the same canonical attestation digest), or use batch-verify with random scalars, which approximates same-message in 2 pairings + O(N) G1 ops.

---

## 3. CKB script cycle limit

Per [Nervos docs — Regulate Scripts via Cycle Limits](https://docs.nervos.org/docs/script/vm-cycle-limits):

- **No per-script cap.** A single script can consume the full block budget if it wants to.
- **No per-transaction cap.** Same — a transaction is allowed to dominate a block.
- **The hard ceiling is `max_block_cycles`.** Current CKB mainnet (MIRANA) value: **3,500,000,000 (3.5 billion cycles)**.
- A script that exceeds `max_block_cycles` causes block rejection. Practically: any single tx that wants block inclusion has to leave room for at least one other tx, so the practical per-tx ceiling is ~2.5B–3B cycles.

**Headroom assessment**: A post-MOP single aggregate-verify at ~60M cycles is **1.7% of `max_block_cycles`**. Even the unoptimized 76.6M-cycle figure is 2.2%. Aggregate-verify of a bonded-validator threshold attestation **comfortably fits**, by two orders of magnitude. This is the load-bearing finding.

---

## 4. Options analysis

Three paths to BLS12-381 verify in CKB-VM. Each evaluated on cycle cost, augmentation-surface footprint, dev velocity, and audit-risk.

### Path 1 — Pure user-space (`bls12_381` zkcrypto crate, no_std)

**What**: Pull [zkcrypto/bls12_381](https://crates.io/crates/bls12_381) as a `no_std` dependency in the AttestationTypeScript and StakeWeightedVoteTypeScript crates. Compile to RV64IMC+B. Verify aggregate signatures inside the type-script via the standard `pairing` API.

**Pros**:
- Zero augmentation surface. `AUGMENTATION_SURFACE.md` stays configuration-only.
- Pure Rust, `no_std`-clean, audited by zkcrypto ecosystem, constant-time.
- Compatible with `ckb-script-templates` scaffolding.
- Matches existing PoM/ed25519 pattern (`ed25519-compact` is already pulled the same way).

**Cons**:
- 51.8M–60M cycles per AttestationCell. Two orders of magnitude under the block limit, but **3–6× the cost of an ed25519 verify** and substantially more than secp256k1.
- Crate is unaudited per its own README. Acceptable for protocol-level use only with a budgeted formal-verification pass or external audit.
- MOP optimizations require hand-tuned assembly, not yet emitted by stock `rustc`. Out-of-box cycle cost may be closer to 76.6M than 51.8M until we hand-optimize the inner loop.

**Cycle estimate (no MOP hand-tuning)**: ~75M–90M for a 100-signer aggregate-verify.
**Cycle estimate (with MOP hand-tuning)**: ~58M–65M for a 100-signer aggregate-verify.

### Path 2 — Substrate-augmentation precompile

**What**: Patch CKB-VM with native BLS12-381 instructions (or a syscall fast-path) analogous to EIP-2537 on EVM. Verify becomes a single syscall returning a boolean. Lives in `AUGMENTATION_SURFACE.md` as the largest patch we'd take on.

**Pros**:
- ~10–50× speedup, plausibly down to 1M–5M cycles per verify.
- Enables much higher attestation throughput if NCI proposal-volume grows.

**Cons**:
- **Adds a substrate-level augmentation.** Per `AUGMENTATION_SURFACE.md` discipline rule #1, this is last-resort. Current document explicitly says "we have not yet forked Nervos CKB source." Taking this path opens the fork.
- Active-maintenance burden against upstream CKB releases.
- Upstream is already shipping the RISC-V V (Vector) extension via the Cryptape RVV roadmap. RVV gives much of the speedup natively without a VibeSwap-specific fork. Forking BLS into the substrate would be redundant within ~1 release cycle.
- The PR-shape-upstream-first rule (`AUGMENTATION_SURFACE.md` #4) would have us contribute the precompile to Nervos rather than fork. Nervos is unlikely to accept a precompile when RVV is the official path.

**Cycle estimate**: ~1M–5M per verify (precompile latency dominated by syscall overhead).

### Path 3 — Off-chain aggregation + thin on-chain verify

**What**: Validators aggregate signatures off-chain (as already specified in `messaging-hub.md` — "validator gossip layer"). The AttestationCell carries **only** the aggregated signature plus the signer bitmap. The on-chain type-script does exactly one pairing check after reconstructing `pk_agg`. This is the **default architectural shape** of MessagingHub already — Path 3 is not really an alternative, it's the named architecture made explicit.

**Pros**:
- This is what the spec already specifies. Zero re-architecture.
- Minimum on-chain cycle cost in the user-space regime.
- Compatible with Path 1's crate choice. Path 3 IS Path 1's optimization strategy.

**Cons**:
- Same crate-audit risk as Path 1.
- Requires a healthy off-chain gossip mesh among validators (already an open question in `messaging-hub.md`).

**Cycle estimate**: same as Path 1 (~58M–90M depending on MOP tuning).

---

## 5. Recommendation

**For MessagingHub AttestationCell**: **Path 1 + Path 3** combined. Path 3 is already the spec's intended shape (off-chain aggregate, on-chain single-pair verify). Path 1 supplies the user-space crate. This keeps `AUGMENTATION_SURFACE.md` clean and lands a working AttestationCell in O(weeks) not O(quarters).

Reasoning chain:
- Cycle budget is **not** the binding constraint. 60M cycles ≪ 3.5B block budget.
- The structural discipline rule (`AUGMENTATION_SURFACE.md` rule #1: nothing on the surface unless required) forbids Path 2 when Path 1+3 demonstrably works.
- Path 2's speedup buys nothing useful given current expected attestation throughput (≤ a few per block during normal cross-chain volume).
- If post-launch data shows attestation contention pushing on `max_block_cycles`, we have a credible escalation path: PR the BLS RVV implementation to upstream Cryptape RVV work rather than fork.

**For NCI StakeWeightedVoteCell**: **Same recommendation, Path 1 + Path 3.** The StakeWeightedVoteCell uses the **same** BLS verifier code and reads from the **same** ValidatorRegistryCell. Shared crate in `contracts-ckb/bls-verify/` consumed by both type-scripts. NCI's vote frequency is lower than messaging's attestation frequency, so if MessagingHub fits, NCI fits trivially.

**Crate choice**: `zkcrypto/bls12_381` over `blst` / `blstrs_plus`. Reasoning:
- `blst` includes assembly fast paths for x86-64 and ARM64 but **not RV64**. The portable-feature fallback compiles, but loses the speed advantage that motivates `blst` in the first place.
- `zkcrypto/bls12_381` is pure Rust, native `no_std`, used in production by Filecoin and Zcash ecosystem tooling. The same crate underlies most published CKB-VM BLS work.
- `ark-bls12-381` is a viable second choice if zkcrypto integration surfaces issues; both are MIT/Apache.

---

## 6. Implementation plan

### Workspace layout

```
contracts-ckb/
├── bls-verify/                          # new shared crate
│   ├── Cargo.toml                       # no_std, depends on bls12_381 with default-features=false
│   ├── src/lib.rs                       # public API: verify_aggregate(msg, pk_agg, sig) -> Result<()>
│   └── src/aggregate.rs                 # pk_agg reconstruction from validator registry + signer bitmap
├── attestation-type-script/             # MessagingHub AttestationCell verifier
│   └── src/main.rs                      # calls bls-verify
├── stake-weighted-vote-type-script/     # NCI StakeWeightedVoteCell verifier
│   └── src/main.rs                      # calls bls-verify
└── validator-registry-type-script/      # shared registry cell logic
    └── src/main.rs
```

### Public API of `bls-verify`

```rust
#![no_std]

pub struct AggregateInputs<'a> {
    pub message: &'a [u8],              // canonical attestation digest (32 bytes)
    pub validator_pubkeys: &'a [[u8; 48]],   // ordered as in ValidatorRegistryCell
    pub signer_bitmap: &'a [u8],        // bit i set => validator i contributed
    pub aggregate_signature: &'a [u8; 96],
    pub threshold_n: u16,
    pub threshold_d: u16,
}

pub fn verify_aggregate(inputs: &AggregateInputs) -> Result<(), BlsError>;
```

### Integration points

1. **AttestationCell type-script** loads ValidatorRegistryCell via cell-dep, parses signer_bitmap, calls `verify_aggregate`. On Err, return CKB-VM error code; cell creation fails.
2. **StakeWeightedVoteCell type-script** same shape, different message format (proposal_id + vote-direction + voting_epoch).
3. **ValidatorBondCell**, **MintClaimCell**, **NCIScoreCell** do NOT need BLS — they consume the verdict of an already-verified AttestationCell or StakeWeightedVoteCell.

### Test approach

- **Local cycle benchmark** before integration: build `bls-verify` standalone, run via `ckb-debugger` against canned inputs, log cycle count for 50/100/200-signer aggregates. Establish whether we're at 51.8M (good), 76.6M (acceptable), or worse (investigate MOP tuning).
- **Integration tests** via `ckb-testtool` (already wired in `contracts-ckb/tests/`): construct AttestationCell with valid + invalid aggregates, verify type-script accepts/rejects correctly.
- **Fuzz the bitmap-to-pubkey-set reconstruction** since signer_bitmap parsing is the most likely silent-corruption surface.
- **Reproducibility harness**: pin `bls12_381` crate version and `rustc` version. The cycle count is deterministic given the inputs; CI should detect regressions.

### Hand-tuning escalation

If the out-of-box cycle count exceeds 100M for the target signer-set size, escalate to:
- Manually arrange the inner-loop assembly for MOP-friendly `mul`/`mulhu` adjacency per the Nervos blog guidance.
- Apply the patterns from `sec-bit/ckb-zkp` whose 106.5M-cycle Groth16 verify is the closest published comparable.

---

## 7. Failure modes

| Failure | Trigger | Graceful degradation |
|---|---|---|
| Cycle cost > expected, but < block limit | Crate compiles to slow path | Hand-tune the inner loop. Document MOP-friendly assembly in `bls-verify/MOP.md`. |
| Cycle cost exceeds `max_block_cycles` | Signer count > 1000, or pathological inputs | This shouldn't happen given the per-verify ≈ 60M budget. If it does, the AttestationCell type-script returns an error before reaching pairing-check, and the spec bounds signer-set size via ValidatorRegistryCell's `validator_set` length cap. |
| Crate has a soundness bug (unaudited) | zkcrypto/bls12_381 carries a known disclaimer | Audit pass before mainnet deploy. Pin version to a known-reviewed tag. Consider parallel-run with `ark-bls12-381` for differential testing. |
| Rogue-key attack on aggregation | Validator submits a crafted pubkey that lets them forge | Enforce proof-of-possession on validator registration (per Boneh-Drijvers-Neven). Add a `pop_signature` field to ValidatorBondCell. |
| RVV upstream lands a BLS path | Cryptape ships RVV BLS within a release | We migrate; this is an unambiguous win. Path 1's interface (`verify_aggregate`) becomes a thin wrapper around the RVV-accelerated implementation. |
| Off-chain gossip layer doesn't deliver | Validators can't form quorum | Independent failure mode — addressed in `messaging-hub.md` open question "validator gossip layer". Doesn't affect this spike's recommendation. |

---

## 8. Open questions for Will-decision

1. **Crate version pinning policy.** Pin to a specific `bls12_381` release tag, or track latest? Recommend pinning until we have a parallel audit-budget process; then revisit per quarterly upstream-merge cadence.
2. **Proof-of-possession on ValidatorBondCell.** Adds a one-time BLS verify at bond-time but closes the rogue-key attack class. Recommend enabling; trivial cycle cost amortized over bond lifetime. Does this go into the MessagingHub spec or stay here as a sub-spec?
3. **MessagingHub message canonical-digest format.** What exactly do validators sign? Current spec says `(source_chain_id, source_burn_id, amount, destination_recipient, destination_chain_id)`. Confirm canonical serialization (Molecule? RLP? blake2b-of-tuple?) so all validators produce identical digests. **Blocks AttestationCell implementation start.**
4. **Validator registry size cap.** What's the hard maximum number of validators? Affects the upper bound on aggregate-verify cycle cost via pk_agg reconstruction. Recommend 200 as initial cap; tunable via LawsonConstantsRegistry.
5. **Differential-testing budget.** Worth running `ark-bls12-381` in parallel with `bls12_381` against canned vectors as a pre-mainnet gate? Recommend yes; small ops cost.
6. **NCI same-crate decision.** Confirm NCI's StakeWeightedVoteCell shares `bls-verify` directly (no version skew between mechanisms). Recommend yes; same registry, same threshold model.

---

## Cross-references

- Consumer specs: `contracts-ckb/specs/messaging-hub.md` (AttestationCell), `contracts-ckb/specs/nci-consensus.md` (StakeWeightedVoteCell)
- Augmentation discipline: `contracts-ckb/AUGMENTATION_SURFACE.md`
- Upstream artifacts: `contracts-ckb/UPSTREAM.md` (BLS12-381 entry)
- Canonical messaging paper: `vibeswap/docs/research/papers/post-layerzero-canonical-messaging.md`
- Mechanism primitives: `[P·structure-does-the-work]`, `[F·augmented-mechanism-design-paper]`

## Sources

- [Nervos blog — Diving Into CKB-VM V1](https://www.nervos.org/blog/major-protocol-upgrade-diving-into-ckb-vm-v1) (51.8M-cycle post-MOP BLS verify figure)
- [Nervos Talk — Performance improvement of CKB hard fork (ckb-zkp example)](https://talk.nervos.org/t/performance-improvement-of-ckb-hard-fork-take-ckb-zkp-as-an-example/6265) (Groth16 / PLONK verify cycle counts)
- [Nervos docs — Regulate Scripts via Cycle Limits](https://docs.nervos.org/docs/script/vm-cycle-limits) (`max_block_cycles` = 3.5B)
- [Cryptape blog — RVV: Key to Efficient On-Chain Cryptography](https://blog.cryptape.com/rvv-risc-v-v-extension-key-to-the-efficient-on-chain-cryptography) (upstream RVV roadmap)
- [zkcrypto/bls12_381 crate](https://crates.io/crates/bls12_381) (recommended dep)
- [IETF draft-irtf-cfrg-bls-signature-05](https://www.ietf.org/archive/id/draft-irtf-cfrg-bls-signature-05.html) (aggregate-verify pairing-count semantics)
- [EIP-2537: Precompile for BLS12-381 curve operations](https://eips.ethereum.org/EIPS/eip-2537) (EVM-side comparable; precedent for substrate precompile path we are *not* taking)
- [ckb-auth](https://github.com/nervosnetwork/ckb-auth) (existing user-space signature-verification library pattern)
