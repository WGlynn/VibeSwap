# Dissolution Audit — Cincinnatus Roadmap
**Date**: 2026-03-21
**Auditor**: Jarvis
**Scope**: 13 critical contracts, 48 protected functions

> "I want nothing left but a holy ghost."

---

## Summary

| Grade | Count | Status |
|-------|-------|--------|
| **A (DISSOLVED)** | 8 | Permissionless. Done. |
| **B (GOVERNANCE)** | 34 | Transfer to TimelockController + DAO vote |
| **KEEP** | 6 | Emergency-only. Guardian pattern. |

---

## Grade A — Already Dissolved (Verify Only)

| Contract | Function | Why Safe |
|----------|----------|----------|
| VibeAMM | `collectFees()` | Hardcoded treasury destination |
| VibeAMM | `growOracleCardinality()` | Monotonic improvement only |
| VibeAMMLite | `collectFees()` | Hardcoded treasury destination |
| VibeAMMLite | `growOracleCardinality()` | Monotonic improvement only |
| ShapleyDistributor | `computeShapleyValues()` | Pure deterministic math |
| ShapleyDistributor | `claimReward()` | Self-claim only |
| VIBEToken | `burn()` | Deflationary, anyone can burn own tokens |
| Settlement verifiers | `submitResult/dispute` | Bonded + fraud proof |

---

## Grade B — Move to TimelockController + DAO (34 functions)

### CRITICAL TIER (Revenue/Fund Redirection) — Phase 2a
| Contract | Function | Risk |
|----------|----------|------|
| FeeRouter | `setTreasury()` | Redirects 40% of protocol revenue |
| FeeRouter | `setInsurance()` | Redirects 20% of protocol revenue |
| FeeRouter | `setRevShare()` | Redirects 30% of protocol revenue |
| FeeRouter | `setBuybackTarget()` | Redirects 10% of protocol revenue |
| FeeRouter | `updateConfig()` | Changes all fee splits |
| FeeRouter | `authorizeSource/revokeSource()` | Fee source whitelist |
| BuybackEngine | `setProtocolToken()` | Can redirect buybacks |
| VibeSwapCore | `setTreasury()` | Treasury address change |
| VIBEToken | `authorizeMinter/revokeMinter()` | Inflation gate |

### HIGH TIER (Mechanism Parameters) — Phase 2b
| Contract | Function | Risk |
|----------|----------|------|
| ShapleyDistributor | `setAuthorizedCreator()` | Game creation gate |
| ShapleyDistributor | `setGamesPerEra()` | Emission schedule |
| ShapleyDistributor | `setHalvingEnabled()` | Halving toggle |
| ShapleyDistributor | `setPriorityRegistry()` | Infrastructure wiring |
| ShapleyDistributor | `updateQualityWeights()` | Weight configuration |
| ShapleyDistributor | `resetGenesisTimestamp()` | Schedule reset |
| ShapleyDistributor | `setShapleyVerifier()` | Verifier wiring |
| VibeAMM | `setGlobalPause()` | Emergency pause |
| VibeAMM | `setAuthorizedExecutor()` | Executor whitelist |
| VibeAMM | `setFlashLoanProtection()` | Security toggle |
| VibeAMM | `setTWAPValidation()` | Security toggle |
| CommitRevealAuction | `setPhaseTimings()` | Batch mechanics |
| CommitRevealAuction | `setPoolConfig()` | Access configuration |

### MEDIUM TIER (Configuration) — Phase 2c
| Contract | Function | Risk |
|----------|----------|------|
| VibeAMM | `setTreasury/setPriceOracle/setIncentiveController` | Infrastructure wiring |
| VibeAMM | `setPoolMaxTradeSize/setTruePriceOracle` | Safety params |
| VibeAMM | `setFibonacciScaling/setMaxPoWFeeDiscount` | Feature config |
| DAOTreasury | `configureBackstop/authorizeFeeSender` | Treasury config |
| DAOTreasury | `setTimelockDuration/setEmergencyGuardian` | Governance config |
| Settlement verifiers | `setExpectedRoot/setExpectedRoots` | Root management |
| VoteVerifier | `setDefaultQuorumBps()` | Quorum threshold |

---

## KEEP — Guardian Pattern (6 functions)

| Contract | Function | Why Keep |
|----------|----------|----------|
| FeeRouter | `emergencyRecover()` | Unrestricted fund drain |
| BuybackEngine | `setBurnAddress()` | Can steal buyback output |
| BuybackEngine | `emergencyRecover()` | Unrestricted fund drain |
| VibeSwapCore | `emergencyRecover()` | Fund recovery |
| CommitRevealAuction | `emergencyWithdraw()` | Fund recovery |
| ShapleyDistributor | `sealBondingCurve()` | One-way seal (dead code after sealing) |

**KEEP functions get**: TimelockController + Guardian multisig + Shapley veto. No single human can trigger.

---

## Implementation Plan

### Phase 2a: Deploy Governance Infrastructure
1. Deploy `VibeTimelock` (48h min delay for critical, 24h for medium)
2. Deploy `GovernanceGuard` (Shapley veto on proposals)
3. Transfer ownership of CRITICAL tier contracts to timelock
4. Test governance flow end-to-end

### Phase 2b: Migrate Mechanism Parameters
1. Transfer HIGH tier contracts to timelock
2. Wire GovernanceGuard veto for emission changes (supermajority)

### Phase 2c: Complete Migration
1. Transfer remaining MEDIUM tier contracts
2. All 34 Grade B functions now governance-controlled
3. No single human key controls any non-emergency function

### Phase 3: Ghost Protocol
1. DAO votes to renounce timelock admin where safe
2. KEEP functions get multi-guardian requirement
3. Upgrade functions get governance + 7-day delay
4. Will walks away. Protocol runs itself.

---

## The Cincinnatus Test

> "If Will disappeared tomorrow, does this still work?"

**Current**: No. 34 functions require Will's key.
**After Phase 2**: Yes. All 34 route through DAO governance.
**After Phase 3**: Yes, permanently. Even KEEP functions are multi-guardian.
