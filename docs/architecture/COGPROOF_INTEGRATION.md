# CogProof → VibeSwap Integration

CogProof was built by VibeSwap for the MIT Bitcoin Expo 2026 Hackathon.
This document maps the CogProof JavaScript implementation to its Solidity
counterparts in the VibeSwap monorepo — the first case of the protocol's
meta-pattern reaching back to the source.

## Module Crosswalk

| CogProof JS | Solidity Contract | Relationship |
|---|---|---|
| `cogproof/src/commit-reveal/commit-reveal.js` | `contracts/core/CommitRevealAuction.sol` | Same algorithm: `hash(output\|\|secret)`, XOR secrets, Fisher-Yates. Solidity predates JS — JS is a port for the hackathon. |
| `cogproof/src/credentials/credential-registry.js` | `contracts/reputation/CredentialRegistry.sol` | JS defines 9 credential types with weights. Solidity stores hashes + accumulates scores. JS runs off-chain, calls Solidity to persist. |
| `cogproof/src/trust/behavior-analyzer.js` | `contracts/reputation/BehavioralReputationVerifier.sol` | JS has 6 fraud detectors (O(n^2), too expensive on-chain). Solidity verifies Merkle-proven results via `VerifiedCompute`. JS = compute, Solidity = verification. |
| `cogproof/src/shapley-dag/shapley.js` | `contracts/incentives/ShapleyDistributor.sol` | Same algorithm, different parameterization. JS: 5% Lawson floor. Solidity: 1% (more conservative on-chain). Both use DAG-aware attribution. |
| `cogproof/src/bitcoin/op-return.js` | No EVM equivalent | Bitcoin L1 specific. OP_RETURN payloads anchor CogProof state to Bitcoin. Credential hashes can bridge to `CredentialRegistry` via cross-chain messaging. |
| `cogproof/src/compression-mining/` | No direct equivalent | CogCoin-specific proof-of-work. Maps conceptually to `CommitRevealAuction`'s `ProofOfWorkLib` for virtual priority. |

## Parameter Crosswalk

| CogProof JS Constant | Value | Solidity Constant | Value | Notes |
|---|---|---|---|---|
| `THRESHOLDS.SELECTIVE_REVEAL_RATE` | 0.4 (40%) | `selectiveRevealThreshold` | 4000 BPS | Same meaning |
| `THRESHOLDS.VELOCITY_SPIKE_MULTIPLIER` | 3x | `velocitySpikeMultiplier` | 3x | Identical |
| `THRESHOLDS.REPUTATION_CHURN_RATE` | 5 cycles | `reputationChurnThreshold` | 5 | Identical |
| `THRESHOLDS.SYBIL_TIMING_WINDOW_MS` | 2000ms | `sybilTimingWindowSeconds` | 2s | Block time resolution |
| Lawson floor | 5% | `LAWSON_FAIRNESS_FLOOR` | 1% (100 BPS) | On-chain is more conservative |

## Credential Type Weights

| Type | CogProof JS | Solidity |
|------|------------|----------|
| BATCH_PARTICIPANT | +1 | +1 |
| HONEST_REVEAL | +2 | +2 |
| FAIR_EXECUTION | +2 | +2 |
| FAILED_REVEAL | -3 | -3 |
| HIGH_CONTRIBUTOR | +5 | +5 |
| CONSISTENT_CONTRIBUTOR | +10 | +10 |
| COMPRESSION_MINER | +3 | +3 |
| HIGH_DENSITY_MINER | +5 | +5 |
| REPUTATION_BURN | +4 | +4 |

## Reputation Tiers

### Credential Tiers (CredentialRegistry)

| Tier | CogProof JS | Solidity | Threshold |
|------|------------|----------|-----------|
| FLAGGED | score < 0 | score < 0 | Identical |
| NEWCOMER | score 0-4 | score 0-4 | Identical |
| BRONZE | score 5-14 | score 5-14 | Identical |
| SILVER | score 15-29 | score 15-29 | Identical |
| GOLD | score 30-49 | score 30-49 | Identical |
| DIAMOND | score >= 50 | score >= 50 | Identical |

### Trust Tiers (BehavioralReputationVerifier)

| Tier | CogProof JS | Solidity | Score Range |
|------|------------|----------|-------------|
| FLAGGED | 0-19 | 0-19 | Identical |
| SUSPICIOUS | 20-39 | 20-39 | Identical |
| CAUTIOUS | 40-59 | 40-59 | Identical |
| NORMAL | 60-79 | 60-79 | Identical |
| TRUSTED | 80-100 | 80-100 | Identical |

## Memecoin Intent Market — Paper-to-Contract Mapping

Paper: `docs/papers/memecoin-intent-market-seed.md`

| Paper Fix | Contract | Mechanism |
|-----------|----------|-----------|
| Fix 1: Commit-reveal launches | `MemecoinLaunchAuction` → `CommitRevealAuction` | Batch auction, uniform clearing price |
| Fix 2: Duplicate elimination | `MemecoinLaunchAuction.intentToLaunch` | One canonical token per intent signal |
| Fix 3: Anti-rug | `CreatorLiquidityLock` | Time-locked creator deposit, 50% slashing |
| Fix 4: Wash trade resistance | `BehavioralReputationVerifier` + `SoulboundSybilGuard` | CogProof trust tiers + sybil guard |
| Fix 5: 0% protocol fees | `MemecoinLaunchAuction.PROTOCOL_FEE_BPS = 0` | Hardcoded zero extraction |

## Architecture

```
                  ┌──────────────────────────────────────┐
                  │         CogProof (off-chain)          │
                  │   cogproof/src/trust/behavior-*.js    │
                  │   6 fraud detectors, trust scoring    │
                  └───────────────┬──────────────────────┘
                                  │ Merkle-proven results
                                  ▼
┌─────────────────────────────────────────────────────────┐
│              BehavioralReputationVerifier                │
│   contracts/reputation/BehavioralReputationVerifier.sol  │
│   extends VerifiedCompute, implements IReputationOracle  │
├─────────────────────────────────────────────────────────┤
│              CredentialRegistry                          │
│   contracts/reputation/CredentialRegistry.sol            │
│   9 credential types, weighted scores, 6 tiers          │
└───────────────┬─────────────────────────────────────────┘
                │ isEligible(), getTrustTier()
                ▼
┌─────────────────────────────────────────────────────────┐
│              MemecoinLaunchAuction                       │
│   contracts/intent-markets/MemecoinLaunchAuction.sol    │
│   commit-reveal → uniform price → claim                 │
├─────────────────────────────────────────────────────────┤
│              CreatorLiquidityLock                        │
│   contracts/intent-markets/CreatorLiquidityLock.sol     │
│   time-lock + 50% slashing → LP pool                   │
└───────────────┬─────────────────────────────────────────┘
                │ commitOrder(), revealOrder()
                ▼
┌─────────────────────────────────────────────────────────┐
│              CommitRevealAuction (existing)              │
│   contracts/core/CommitRevealAuction.sol                │
│   10s batches, Fisher-Yates shuffle, 50% slash          │
├─────────────────────────────────────────────────────────┤
│              ShapleyDistributor (existing)               │
│   contracts/incentives/ShapleyDistributor.sol           │
│   Lawson floor, quality weights, DAG attribution        │
└─────────────────────────────────────────────────────────┘
```

## The Meta-Pattern

CogProof was created by VibeSwap for the MIT Bitcoin Expo 2026 Hackathon.
It implements VibeSwap's core mechanisms (commit-reveal, Shapley, behavioral
reputation) in JavaScript for a Bitcoin-native context.

The memecoin intent market paper identifies behavioral reputation as the
missing component for GEV-resistant meme launches. CogProof IS that
behavioral reputation.

This integration closes the loop: the child feeds back into the parent.
The same mechanisms that made CogProof work (fair ordering, game-theoretic
attribution, fraud detection) now serve as the trust layer for VibeSwap's
memecoin intent markets.

Self-referential by design. Cooperative capitalism in practice.
