# Post-LayerZero Canonical Messaging — A Burn-and-Mint Architecture for VibeSwap

**Status**: Spec draft (v0.1) — 2026-05-08
**Author**: VibeSwap research
**Successor to**: `contracts/messaging/CrossChainRouter.sol` (LayerZero V2 OApp wrapper)
**Companion docs**:
- `docs/architecture/REASONING_VERIFICATION_OVERVIEW.md` (validator-set primitives)
- `docs/concepts/primitives/atomized-shapley.md` (honest-attestation reward)
- `docs/concepts/primitives/clawback-cascade.md` (slashing rail)

---

## 1. Motivation

VibeSwap currently uses LayerZero V2 as its cross-chain messaging substrate. The messaging layer's trust assumptions — Decentralized Verifier Networks (DVNs), executor permissioning, and library configuration — are not parameters VibeSwap controls end-to-end.

The April 2026 KelpDAO/LayerZero exploit demonstrated the structural failure mode: the verifier network's fallback path under DDoS converged onto attacker-controlled RPC nodes, and the DVN signed a forged source-chain view. The attack didn't break cryptography; it broke **infrastructure assumptions**. 47% of LayerZero OApp contracts ran the same 1-of-1 DVN configuration, exposing ~$4.5B in associated market value to the same class of risk.

The structural lesson, independent of the specific incident: **off-chain infrastructure security is not equivalent to on-chain economic security**. Off-chain infra can be DDoS'd into a single trust path; on-chain bonded validators cannot. A messaging layer where attestations are signed by economically bonded validators, submitted to a public mempool, and slashable on-chain has no equivalent of "the DVN failed over to the only nodes it could still reach."

This document specifies VibeSwap's replacement: a **canonical-issuer burn-and-mint architecture** with a **PoS attestation network** built from primitives VibeSwap already ships (`ShardOperatorRegistry`, `ClawbackCascade`, `ShapleyDistributor`, `BatchInvariantVerification`, `ProofOfMisbehavior`, commit-reveal).

## 2. Design Goals

| Goal | Property |
|---|---|
| **Canonical issuance** | VibeSwap is the issuer of record for its tokens on every supported chain. No wrapper-of-wrapper indirection. |
| **Total-supply invariant** | `Σ(supply across chains) = constant` between messaging events. Checkable on every batch. |
| **No migration burden** | Clean-slate launch. No legacy LZ-OFT redemption window required (no value to preserve). |
| **Per-batch latency** | Cross-chain orders settle in ~25s (one to two VibeSwap batches) under typical conditions. |
| **On-chain economic security** | Validator slashing is the security model. No off-chain trust assumptions on RPC infrastructure. |
| **Liveness fallback** | If the validator set is unresponsive, users can recover burns after a timeout. |
| **Reuse, don't rebuild** | Validator set, slashing, reward, commit-reveal mechanisms are inherited from existing audited contracts. |

## 3. Architecture Overview

Three layers, each with a single responsibility:

```
┌──────────────────────────────────────────────────────────────────┐
│ Token Layer                                                      │
│   VibeSwapCanonicalToken (deployed on every supported chain)     │
│   - mint() permissioned to MessagingHub                          │
│   - burn() user-callable, emits Burn event                       │
│   - Identical bytecode + name/symbol across chains               │
└──────────────────────────────────────────────────────────────────┘
                            ▲                ▲
                            │ mint           │ burn
                            │                │
┌──────────────────────────────────────────────────────────────────┐
│ Messaging Layer                                                  │
│   MessagingHub (per-chain orchestrator)                          │
│   - receiveAttestation(proof) → mint                             │
│   - initiateBurn(amount, dstChain, recipient) → burn + emit      │
│   - SupplyAccountant: tracks localSupply / inbound / outbound    │
│   - NonceRegistry: replay protection, monotonic per (src, dst)   │
└──────────────────────────────────────────────────────────────────┘
                            ▲
                            │ verify(proof)
                            │
┌──────────────────────────────────────────────────────────────────┐
│ Verifier Layer                                                   │
│   AttestationVerifier (BLS threshold sig verification)           │
│   MessagingValidatorRegistry (forks ShardOperatorRegistry)       │
│   - Validators bond stake, observe source events, sign           │
│   - Aggregator role rotates per nonce, rewarded via Shapley      │
│   - PoM contract slashes via ClawbackCascade                     │
└──────────────────────────────────────────────────────────────────┘
```

## 4. The Total-Supply Invariant

The architectural property that does the work — the messaging layer's correctness reduces to maintaining one global invariant.

**Definition**:
For any VibeSwap-canonical token `T`, at any moment between messaging events:

```
Σ_{c ∈ chains} supply_T(c) = TOTAL_T
```

where `TOTAL_T` is set at genesis on Ethereum and changes only via explicit `mintCanonical()` / `burnCanonical()` governance actions on the genesis chain.

**Per-chain accounting** (`SupplyAccountant`):
- `localSupply(c, T)` — current balance held by users on chain `c`
- `inboundPending(c, T)` — burns observed on other chains, awaiting attestation on `c`
- `outboundBurned(c, T)` — burns initiated locally, awaiting mint on destination

**Invariant check** (every batch, via `BatchInvariantVerification` primitive):
```
localSupply(c, T) + outboundBurned(c, T) = receivedFromGenesis(c, T) - sentToOthers(c, T)
```

If a batch ever violates this, the entire batch reverts and the originating burn/mint is rolled back. Same shape as VibeSwap's existing batch-level invariants on the auction side.

**Why this matters**: messaging-layer correctness becomes a checkable property, not a trust assumption about validators. Even if a validator quorum signs a forged attestation, the destination chain's invariant check catches a supply violation before the mint commits.

## 5. Token Layer

### 5.1 VibeSwapCanonicalToken

```solidity
contract VibeSwapCanonicalToken is ERC20Upgradeable, AccessControlUpgradeable {
    bytes32 public constant MESSAGING_HUB_ROLE = keccak256("MESSAGING_HUB_ROLE");

    function mint(address to, uint256 amount, uint256 sourceNonce)
        external
        onlyRole(MESSAGING_HUB_ROLE)
    {
        _mint(to, amount);
        emit CanonicalMint(to, amount, sourceNonce);
    }

    function burn(uint256 amount, uint64 dstChainId, address recipient)
        external
        returns (uint256 nonce)
    {
        _burn(msg.sender, amount);
        nonce = IMessagingHub(messagingHub).initiateBurn(
            msg.sender, amount, dstChainId, recipient
        );
        emit CanonicalBurn(msg.sender, amount, dstChainId, recipient, nonce);
    }
}
```

Deployed on every supported chain with **identical bytecode** (verifiable via on-chain hash check during validator onboarding). Identical name, symbol, decimals.

### 5.2 Genesis Chain (Ethereum)

Ethereum holds the genesis `mint` authority. The total supply of any VibeSwap-canonical token is fixed at genesis or modified only via on-chain governance on Ethereum. Other chains can only receive and send — never mint from nothing.

**Why Ethereum**: liquidity primacy. ETH staking depth gives us a deep validator-bond market for v2 economic security. CKB and Solana support follow as v1.5.

## 6. Messaging Layer

### 6.1 Burn-and-Mint Flow

```
Source chain (S):
  1. user calls VibeSwapCanonicalToken(S).burn(amt, dstId, recipient)
  2. token contract calls MessagingHub(S).initiateBurn(...)
  3. SupplyAccountant(S).outboundBurned += amt
  4. NonceRegistry(S).next(dstId) → nonce n
  5. emit BurnInitiated(user, amt, srcId=S, dstId, recipient, nonce=n, blockHash)

Validator network:
  6. validators observe BurnInitiated after k confirmations on S
  7. each validator signs (srcId, dstId, nonce, user, amt, recipient, sourceBlockHash) with BLS
  8. aggregator (rotated per nonce) collects t-of-n signatures
  9. aggregator submits (sig, message) to MessagingHub(D)

Destination chain (D):
 10. AttestationVerifier(D).verify(sig, message) → ok
 11. NonceRegistry(D).consume(srcId, nonce) — reverts on replay
 12. SupplyAccountant(D).inboundPending += amt → committed
 13. VibeSwapCanonicalToken(D).mint(recipient, amt, nonce)
 14. emit AttestationConsumed(srcId, dstId, nonce, recipient, amt, aggregator)

Source chain (eventually):
 15. validator submits AttestationFinalized(srcId, dstId, nonce) to MessagingHub(S)
 16. SupplyAccountant(S).outboundBurned -= amt (clears pending row)
```

### 6.2 Replay Protection

- `NonceRegistry` is **per-(srcChain, dstChain) monotonic**. A nonce can be consumed exactly once on each destination.
- Source chain ID is part of the signed message, preventing cross-destination replay.
- `consume(srcId, nonce)` reverts if `nonce <= lastConsumed[srcId]` or if already in the consumed set.

### 6.3 SupplyAccountant

Per-chain bookkeeping contract. Three storage maps per token:
- `localSupply` (mirror of token's `totalSupply`, updated on every mint/burn)
- `outboundBurned` (per-destination pending row count)
- `inboundConsumed` (per-source consumed row count)

Reads its own state during the batch invariant check; writes only via `MessagingHub` and `VibeSwapCanonicalToken` (both trusted callers).

## 7. Verifier Layer

### 7.1 Validator Set: `MessagingValidatorRegistry`

**Forked from `ShardOperatorRegistry`**, with messaging-specific bonding parameters:

- Bond size: floor at 32 ETH-equivalent on Ethereum, scaled to chain-native asset on others
- Activation delay: 7 days (Sybil resistance + time-lock against rapid validator churn)
- Unbonding delay: 14 days (slashing window must outlive any in-flight attestation challenge)
- Max set size: 128 active validators per chain (bounded for BLS aggregation efficiency)

**Why fork instead of reuse directly**: shard-bonds and messaging-bonds carry different slashing risk profiles. A shard operator slashed for shard misbehavior shouldn't lose their messaging stake (and vice versa). Separate registries, shared bond infrastructure.

### 7.2 BLS Threshold Signatures

- t-of-n threshold: **t = ⌈2n/3⌉ + 1** (>2/3 honest assumption, standard PoS finality threshold)
- Aggregation: BLS12-381, single 96-byte aggregate signature per attestation
- Pubkey aggregation: precomputed at validator-set rotation boundaries (gas-efficient verification)
- On-chain verification cost: ~110k gas on Ethereum (precompile-assisted)

### 7.3 Aggregator Rotation

The aggregator collects signatures off-chain and submits the final attestation. To prevent aggregator censorship:
- Aggregator role rotates **per nonce**, deterministic from `(nonce, validatorSet)` via `DeterministicShuffle` (existing primitive)
- If the chosen aggregator fails to submit within `aggregatorWindow` (60s), any other validator can submit and claim the aggregator reward
- Aggregator reward distributed via `ShapleyDistributor` (game-theoretic — incentives align with honest, prompt aggregation)

### 7.4 Slashing

Three slashable offenses, all enforced via `ProofOfMisbehavior` → `ClawbackCascade`:

| Offense | Detection | Penalty |
|---|---|---|
| **Forged attestation** | Destination invariant check fails OR conflicting attestation submitted | 100% bond, distributed to insurance pool |
| **Reorged source signature** | Validator signed attestation referencing a block subsequently orphaned | 50% bond |
| **Liveness failure** | Validator missed > 10% of attestation rounds in 24h window | 5% bond, ejection if repeat |

Slashing proofs are permissionless: anyone can submit a PoM with bond-stake and earn 10% of the slashed amount on success (existing whistleblower-incentive pattern).

## 8. Latency Budget & Cross-Chain Order Shape

### 8.1 End-to-End Latency

| Stage | Budget (ETH source) | Mechanism |
|---|---|---|
| Source-chain k-confirmation finality | ~12s (1 conf, soft) | Reorg risk covered by validator slashing |
| Validator observe + BLS sign | < 2s | Validators run light nodes |
| Threshold aggregation | < 3s | Off-chain, 60s aggregator window |
| Destination-chain inclusion | < 10s | Lands in next VibeSwap batch |
| **Typical user-perceived latency** | **~25s** | One to two VibeSwap batches |

### 8.2 Cross-Chain Order Shape

VibeSwap orders carry a `sourceChainId` field. A cross-chain order:
1. **Commits** at batch N on source chain (commit-reveal, deposit locked)
2. **Reveals + burns** at batch N's reveal phase (source-chain canonical token burned)
3. **Settles** at batch N+2 or N+3 on destination chain — at the *destination batch's* uniform clearing price

The destination batch's price is the price the user gets. This is a feature, not a bug: cross-chain orders are price-takers on the destination side, and uniform clearing absorbs latency-induced price drift the same way it absorbs MEV. Same MEV-resistance guarantee, just shifted by attestation latency.

**Cross-chain commit-reveal binding**: the user's source-chain commit hash includes `keccak256(orderParams || destBatchTarget || secret)`. If the attestation arrives outside the target batch window, the order auto-cancels and refunds. Prevents griefing where validators delay attestation to game destination prices.

## 9. Liveness Fallback

If the validator set is unresponsive, users must be able to recover their burned tokens.

**`recoverBurn(nonce, blockAge)`** on source chain:
- Callable after `livenessTimeout` (default 1 hour) since `BurnInitiated`
- Caller submits proof of "no attestation finalized" — i.e., source-chain has no `AttestationFinalized` for `nonce`
- `SupplyAccountant.outboundBurned -= amt` (clears pending row)
- `VibeSwapCanonicalToken.mint(originalUser, amt, nonce)` (re-issued on source)
- Triggers PoM-slashing cascade against all validators that didn't sign within window

**Why 1 hour**: enough buffer for cross-chain RPC issues / chain reorg recovery, short enough to be UX-acceptable. Tunable per source chain via governance.

**Race condition**: if attestation finalizes during the recovery window, the recovery reverts (nonce already consumed on destination). Standard CAS pattern.

## 10. Soft-Finality and Reorg Handling

We accept 1-confirmation finality on Ethereum (~12s) for typical operations. This is a reorg-risk acceptance — if Ethereum reorgs after attestation, the source-chain burn is un-burned but destination-chain mint has already settled.

**Defense**:
1. **Validator slashing**: validators that signed an attestation referencing a block subsequently orphaned lose 50% of bond. This is cryptographically detectable on-chain (the orphaned block hash vs canonical hash).
2. **Insurance pool**: shortfalls covered by VibeSwap's existing `ILProtection` / treasury reserves. Proven mechanism.
3. **High-value tier**: orders above `softFinalityThreshold` (e.g., $10k) require 32-block confirmation (~6.4 min). Tunable per chain.

For L2s (Arbitrum, Optimism, Base): we accept L2 soft-finality (sequencer confirmation) with the same slashing-backstopped model. Waiting for L1 settlement (hours/days) is incompatible with the 25s latency target.

## 11. Phased Rollout

### v1 — VibeSwap-issued tokens only (target: 2026 Q3)
**Scope**: JUL, VIBE, JCV, VibeStable. Pure burn-and-mint. We control supply natively.
**Chains**: Ethereum genesis, CKB and one L2 (Base or Arbitrum) as receivers.
**Validator set**: bootstrap with 16 validators (mix of VibeSwap-aligned operators + staking partners).
**Why first**: simplest case. No custody, no third-party issuer dependency. Validates the messaging layer end-to-end before we take on harder cases.

### v2 — Native USDC via CCTP integration (target: 2026 Q4)
**Scope**: USDC via Circle's CCTP. We don't custody USDC; we route burn-and-mint through Circle's native infrastructure and overlay our messaging layer for non-CCTP-supported routes.
**Why second**: high-volume stablecoin demand without taking on lock-and-mint custody risk. Issuer-cooperative.

### v3 — Lock-and-mint long tail (target: 2027 H1)
**Scope**: ETH, BTC (via wBTC routes), and permissionless long-tail tokens with `DiscoveryCeiling` gate.
**Mechanism**: `VaultLocker` contract on source chain holds locked assets; canonical-mint of `vToken` on destinations. Validator network attests to lock events same as v1 attests to burns.
**Why last**: custody risk is the highest-stakes part. We want v1 + v2 battle-tested before we hold third-party assets.

## 12. Reuse of Existing Primitives

The architectural moat: most of this is already built and audited.

| Need | Existing primitive | New work |
|---|---|---|
| Validator set management | `ShardOperatorRegistry` | Fork to `MessagingValidatorRegistry`, adjust bond params |
| Slashing rail | `ClawbackCascade` + `ClawbackVault` | New PoM detector contracts (forged-attestation, reorg, liveness) |
| Honest-attestation reward | `ShapleyDistributor` | New reward bucket: aggregator + signer rewards |
| Slashing trigger | `ProofOfMisbehavior` | Three new offense types |
| Anti-collusion gate | `NCI` (Nash Commit Initiative) | Optional layer on aggregator selection |
| Batch invariant check | `BatchInvariantVerification` | New invariant: total-supply across chains |
| MEV-resistant order shape | `CommitRevealAuction` + reveal-with-secret | Cross-chain commit binding (8.2 above) |
| Insurance backstop | `ILProtection` + treasury | New cross-chain shortfall coverage rule |
| Order execution | `VibeSwapCore` + `CommitRevealAuction` | `sourceChainId` field on orders, deferred-batch settlement |
| Long-tail asset gate | `DiscoveryCeiling` | Reused as-is for v3 |

**New contracts we need to write** (estimate):
- `VibeSwapCanonicalToken` (~200 LOC, ERC20 + role-gated mint/burn)
- `MessagingHub` (~600 LOC, orchestrator + supply accountant integration)
- `AttestationVerifier` (~300 LOC, BLS verification + nonce registry)
- `MessagingValidatorRegistry` (~400 LOC, fork of ShardOperatorRegistry)
- `MessagingPoM` (~500 LOC, three offense detectors)
- `SupplyAccountant` (~250 LOC, per-chain bookkeeping)

Total: ~2250 LOC of new Solidity, leveraging ~10x that in existing audited primitives.

## 13. Open Questions

| # | Question | Why it matters |
|---|---|---|
| Q1 | Validator client implementation: build in-house Rust client, or fork an existing PoS client (Lighthouse/Teku-style)? | Time-to-ship vs long-term maintenance |
| Q2 | BLS curve: BLS12-381 (Ethereum-native) vs BLS12-377 (cheaper proofs but less standard) | Gas cost vs ecosystem alignment |
| Q3 | Aggregator selection: deterministic shuffle (proposed) vs stake-weighted leader rotation vs VRF | Censorship resistance vs liveness |
| Q4 | Validator inclusion: permissionless w/ bond, or governance-curated v1? | Decentralization vs initial security |
| Q5 | Source-chain finality on Solana: accept fork-choice finality (~13s) or wait for finalized commitment (~30s)? | Latency target on non-EVM chains |
| Q6 | Cross-chain order auto-refund window: should this be governance-tunable per chain or fixed? | UX vs operational flexibility |
| Q7 | Insurance pool sizing: what's the right target reserve as a fraction of in-flight messaging volume? | Capital efficiency vs solvency margin |
| Q8 | Migration to ZK light client (v2.5+): which proof system (Succinct SP1, RISC0, custom)? | Trust-minimization roadmap |

## 14. Future Work — ZK Light Client Path

The endgame is **trust-minimization**, not just decentralization. v2.5+ replaces the BLS attestation network with ZK proofs of source-chain state:

- Validator signs attestation **and** generates ZK proof of source-block inclusion
- ZK proof becomes the cryptographic root of trust; validators become provers, not attestors
- Slashing model collapses — invalid proofs cannot be generated, period

Estimated timeline: 12-18 months post-v1 launch. Proving cost dropping ~10x/year; infrastructure (Succinct, RISC0) maturing fast. v1 is designed so that the messaging-layer interface (`AttestationVerifier`) can be swapped without changing the token layer or the user-facing flow.

---

## Appendix A — Threat Model Summary

| Threat | Defense |
|---|---|
| Validator collusion (>2/3) | Slashing on invariant violation; insurance backstop; ZK upgrade path |
| Source-chain reorg | k-confirmation policy + validator slashing for orphaned signatures |
| Aggregator censorship | Rotation + permissionless re-aggregation after window |
| Replay attack | Per-(src,dst) nonce registry; chain ID in signed message |
| Liveness failure | 1-hour `recoverBurn` fallback + PoM slashing for non-signers |
| Off-chain RPC compromise (LZ-hack class) | No off-chain trust path — all attestations submitted on-chain to public mempool |
| DDoS on validator infrastructure | n=128 validators, t=⌈2n/3⌉+1 — DDoS must hit >n/3 simultaneously |
| Forged attestation | Invariant check at destination batch + PoM slashing |
| Validator key compromise | Per-validator BLS key rotation on schedule + immediate replacement on detection |

## Appendix B — Comparison vs Alternatives

| Property | LayerZero V2 (current) | Chainlink CCIP | Wormhole | **VibeSwap (this spec)** |
|---|---|---|---|---|
| Trust model | Off-chain DVN config | Off-chain oracle network | Off-chain Guardian set | **On-chain bonded validators** |
| Default-safe | ✗ (47% ran 1-of-1) | ⚠ (DON-curated) | ⚠ (Guardian curated) | **✓ (t-of-n required)** |
| Slashing on-chain | ✗ | ✗ | ✗ | **✓ (ClawbackCascade)** |
| Canonical issuer model | ✗ (OFT wrappers) | ✓ (CCT standard) | ✗ | **✓ (per-chain identical)** |
| Reuses existing primitives | n/a | n/a | n/a | **✓ (~10x leverage)** |
| ZK upgrade path | Roadmap | Roadmap | Roadmap | **Designed-in (interface swap)** |
| Latency (typical) | ~30s | ~30-60s | ~13min | **~25s** |

## Appendix C — Why On-Chain Economic Security Beats Off-Chain Infrastructure

The KelpDAO exploit's structural lesson, generalized:

Off-chain infrastructure security depends on assumptions about node deployment, RPC availability, monitoring coverage, and operational discipline that **cannot be checked on-chain**. When attackers compromise the off-chain layer, the on-chain contracts have no way to detect divergence — they accept whatever the verifier signs.

On-chain economic security inverts this. Validator bonds, attestation submission, slashing proofs, and supply invariants are all checkable from chain state alone. An attacker who compromises a validator's RPC nodes still has to either:
1. Convince t-of-n validators to sign a forged attestation (each one's bond at risk), or
2. Forge a signature without the keys (cryptographically infeasible).

There is no failover path that bypasses the bonded honesty assumption. The "DDoS one node, force failover to attacker-controlled nodes" pattern doesn't apply because validators don't fail over — they're online and bonded, or they're slashed for liveness failure and replaced.

This is the same pattern as VibeSwap's airgap-dissolution argument on the trading side: by moving the security property into a place where rational-attack-doesn't-exist, we collapse the threat surface from "trust infrastructure" to "trust math + bonded incentives."

---

*This spec is the v0.1 draft. Pending decisions on Q1-Q8 above will refine the v0.2 cut.*
