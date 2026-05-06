# W5 Empty-Catch Sweep — Contracts Outside Cross-Chain + Oracle

**Date**: 2026-05-06
**Scope**: All `catch {}` / `catch (bytes memory) {}` sites in `contracts/` EXCLUDING `contracts/messaging/` and `contracts/oracles/` (already covered by XCM audit 2026-05-01).
**Method**: `grep -rn "catch" contracts/ --include="*.sol"` + per-site read of surrounding function, classify against C15/XCM failure-mode question: *"if the inner call fails and is swallowed, does that leave internal accounting in an observable, retryable state, or silently diverged state?"*
**Trigger**: SESSION_STATE backlog W5 — close silent-failure surface area that XCM audit did not scope.

---

## Classification Table

| # | File | Line | What's caught | Classification | Justification |
|---|------|------|--------------|----------------|---------------|
| 1 | `contracts/amm/VibeAMM.sol` | 571 | `priorityRegistry.recordPoolCreation` | **SAFE** | Notify-only hook into an optional external registry. Pool creation state is already finalized before the try. Failure loses a priority-record observation, not a load-bearing invariant. |
| 2 | `contracts/amm/VibeAMM.sol` | 682 | `incentiveController.onLiquidityAdded` | **SAFE** | Hook into optional incentiveController for IL/loyalty tracking. LP state (reserve updates, LP mint) finalized before try. IC failure loses an IL entry-price record; IC's own retry queue handles recovery if wired. |
| 3 | `contracts/amm/VibeAMM.sol` | 768 | `incentiveController.onLiquidityRemoved` | **SAFE** | Same as #2 for removal. LP tokens burned and transfers sent before the hook. |
| 4 | `contracts/amm/VibeAMM.sol` | 1144 | `incentiveController.routeVolatilityFee` | **SAFE** | Surplus fee has already been transferred to incentiveController address before try. The notification call is confirmation-only; IC holds the tokens regardless. |
| 5 | `contracts/amm/VibeAMM.sol` | 1614 | Same as #4 in `_trackProtocolFees` | **SAFE** | Identical pattern. |
| 6 | `contracts/amm/VibeAMM.sol` | 2329 | `truePriceOracle.getStablecoinContext` | **SAFE** | Read-only call inside validation. Failure leaves `adjustedMaxDeviation` at its prior computed value — conservative, not permissive. |
| 7 | `contracts/amm/VibeAMM.sol` | 2353 | `this.getVWAP` | **SAFE** | Read-only VWAP corroboration inside price validation. Failure skips the tightening adjustment, leaving bounds at the less-tight value — safe fallback (wider tolerance, not narrower). |
| 8 | `contracts/amm/VibeAMM.sol` | 2392 | outer catch for `truePriceOracle.getTruePrice` | **SAFE** | Oracle unavailable → pass through clearing price. Explicit comment. Trading must not halt when oracle is temporarily down. |
| 9 | `contracts/amm/VibeAMM.sol` | 2451 | `volatilityOracle.getVolatilityTier` inside `_crossValidateVolatility` | **SAFE** | Read-only. Failure returns `adjustedDeviation` unchanged — conservative (no bounds tightening, but also no bounds widening). |
| 10 | `contracts/amm/VibeAMM.sol` | 2514 | `volatilityOracle.getVolatilityTier` inside `_getEffectiveFeeRate` | **SAFE** | Read-only. Failure skips stealth-manipulation surcharge, leaving fee at base rate — conservative (not artificially low). |
| 11 | `contracts/amm/VibeAMM.sol` | 2524 | outer catch for entire `_getEffectiveFeeRate` | **SAFE** | Oracle unavailable → no surcharge. Same rationale as #8. |
| 12 | `contracts/amm/VibeLP.sol` | 81 | `IERC20Metadata.symbol()` | **SAFE** | View call for LP token name construction. Failure returns hex-truncated address string. Name is cosmetic. |
| 13 | `contracts/amm/VibePoolFactory.sol` | 219 | `hookRegistry.attachHook` | **SAFE** | Pool created without hook on failure. Explicit comment. Pool creation state finalized before try. |
| 14 | `contracts/community/IdeaMarketplace.sol` | 955 | `predictionMarket.resolveMarket` | **SAFE** | Prediction market resolution is downstream notification. Idea outcome state already recorded before try. Market resolution failure is observable via absence of resolution event; can be retried off-chain. Not a load-bearing fund invariant. |
| 15 | `contracts/compliance/ClawbackRegistry.sol` | 431 | `IERC20.transferFrom` for clawback execution | **SAFE** | Wallet has not pre-approved → catch preserves the "frozen at protocol level" state. Explicitly documented. The catch does not advance the case to RESOLVED; that happens after the catch block (line 440). Funds remain frozen at deposit level. |
| 16 | `contracts/compute/ComputeSubsidyManager.sol` | 456 | `reputationOracle.getTrustScore` | **SAFE** | View call for effective reputation computation. Failure returns `baseRep = 0`. Result is additive with stake boost — conservative (lower effective rep on failure, not higher). |
| 17 | `contracts/consensus/SecondaryIssuanceController.sol` | 236 | `shardRegistry.distributeRewards` | **SAFE** | Non-empty catch: redirects `shardShare` to `insurancePool` and emits `ShareRerouted`. Supply-neutral (minted tokens are transferred, not re-minted). Fully audited under C7-ISS-001 / C14-AUDIT-4. |
| 18 | `contracts/consensus/SecondaryIssuanceController.sol` | 268 | `daoShelter.depositYield` | **SAFE** | Non-empty catch: redirects `daoShare` to insurance, prevents double-emission. Audited under C10-AUDIT-4 / C14-AUDIT-4. |
| 19 | `contracts/core/BuybackEngine.sol` | 117 | `IVibeAMMSwap.swap` | **SAFE** | Catch resets allowance and reverts with `InsufficientOutput` — not a silent swallow. |
| 20 | `contracts/core/BuybackEngine.sol` | 148 | `this.executeBuyback` in batch loop | **SAFE** | Skips one failed buyback, continues with others. No fund accounting at risk: no tokens have been consumed at the point of catch. |
| 21 | `contracts/core/BuybackEngine.sol` | 190 | `IVibeAMMSwap.getPool` (view) | **SAFE** | Returns `(false, 0)` on failure — caller treats it as "pool invalid". |
| 22 | `contracts/core/BuybackEngine.sol` | 206 | `IVibeAMMSwap.getPool` (view, expected output) | **SAFE** | Returns 0 expected output → slippage check blocks the swap. Conservative. |
| 23 | `contracts/core/CommitRevealAuction.sol` | 1245 | `complianceRegistry.getKYCStatus` in `_checkUserCompliance` (VIEW PATH) | **SAFE** | Returns `(false, "KYC check failed")` — caller interprets as non-compliant. Conservative (blocks access on oracle failure, not opens). |
| 24 | `contracts/core/CommitRevealAuction.sol` | 1259 | `complianceRegistry.isAccredited` in `_checkUserCompliance` (VIEW PATH) | **SAFE** | Same as #23. Returns `(false, "Accreditation check failed")`. |
| 25 | `contracts/core/CommitRevealAuction.sol` | 1274 | `complianceRegistry.getUserProfile` in `_checkUserCompliance` (VIEW PATH) | **SAFE** | Catch allows access for open pools when jurisdiction cannot be fetched. View function only; no state change. |
| 26 | `contracts/core/CommitRevealAuction.sol` | 1368 | `complianceRegistry.getUserProfile` for tier lookup in `_getUserTier` | **SAFE** | Catch leaves `tier = 0`. Caller falls through to `reputationOracle` fallback. If both fail, `tier = 0` — the lowest possible tier, which is conservative. |
| 27 | `contracts/core/CommitRevealAuction.sol` | 1377 | `reputationOracle.getTrustTier` | **SAFE** | Same — leaves `tier = 0`. Conservative. |
| 28 | `contracts/core/CommitRevealAuction.sol` | 1416 | `complianceRegistry.getKYCStatus` in `_validateUserForPool` (ACCESS GATE) | **SAFE** | Catch reverts with `KYCRequired` — oracle failure means access is denied, not granted. Explicitly commented (FIX TRP-R1-F10). |
| 29 | `contracts/core/CommitRevealAuction.sol` | 1431 | `complianceRegistry.isAccredited` in `_validateUserForPool` | **SAFE** | Same — reverts with `AccreditationRequired`. |
| 30 | `contracts/core/CommitRevealAuction.sol` | 1451 | `complianceRegistry.getUserProfile` (jurisdiction) in `_validateUserForPool` | **SAFE** | Catch allows if `minTierRequired == 0` (open pool), blocks if `> 0`. Semi-permissive for open pools but `minTierRequired > 0` is the stricter gate. Conservative for restricted pools. |
| 31 | `contracts/core/VibeSwapCore.sol` | 978 | `incentiveController.recordExecution` in `_recordExecution` | **SAFE** | Non-empty catch: emits `ExecutionTrackingFailed` and queues for permissionless retry via `_queueFailedExecution`. C15-CC-F1 pattern. |
| 32 | `contracts/core/VibeSwapCore.sol` | 987 | `clawbackRegistry.recordTransaction` in `_recordExecution` | **SAFE** | Non-empty catch: emits `ComplianceCheckFailed` and queues via `_queueFailedCompliance`. C15-CC-F1 pattern. |
| 33 | `contracts/core/VibeSwapCore.sol` | 976/985 cross-chain variant | Same two catches in `_recordCrossChainExecution` | **SAFE** | Identical pattern. C15-CC-F1. |
| 34 | `contracts/core/VibeSwapCore.sol` | 1626 | `incentiveController.recordExecution` in `retryFailedExecution` | **SAFE** | If retry fails, re-queues the item and emits `FailedExecutionRetried(index, false)`. Not silently swallowed. |
| 35 | `contracts/core/VibeSwapCore.sol` | 1775 | `clawbackRegistry.recordTransaction` in `retryFailedCompliance` | **SAFE** | Same — re-queues on failure. Not silently swallowed. |
| 36 | `contracts/framework/VibeIntentRouter.sol` | 280 | `IVibeAMM.quote` in `_quoteAMM` | **SAFE** | View call for routing quote. Returns `(false, 0, pid)` — router tries next route. |
| 37 | `contracts/framework/VibeIntentRouter.sol` | 283 | `IVibeAMM.getPoolId` in `_quoteAMM` | **SAFE** | Same — returns `(false, 0, bytes32(0))`. |
| 38 | `contracts/framework/VibeProtocolOwnedLiquidity.sol` | 306 | `vibeAMM.removeLiquidity` in `emergencyWithdraw` | **SAFE** | `continue` skips one failed position, attempts others. Counter-tracked: if `withdrawn == 0` after loop, reverts with `NoActivePositions`. The partial-failure case means some liquidity is recovered — conservative. Note: positions where removeLiquidity fails remain with `pos.active = true`; operator can retry with another call. |
| 39 | `contracts/governance/AutomatedRegulator.sol` | 356 | `registry.openCase` in `_autoFileCase` | **LOAD-BEARING — FIXED** | See fix below. |
| 40 | `contracts/governance/TreasuryStabilizer.sol` | 281 | `vibeAMM.getPool` in `executeDeployment` | **SAFE** | View call for pool ratio. Catch falls back to 1:1 ratio for initial deposit. Documented comment. |
| 41 | `contracts/governance/TreasuryStabilizer.sol` | 330 | `daoTreasury.removeBackstopLiquidity` in `withdrawDeployment` | **LOAD-BEARING — FIXED** | See fix below. |
| 42 | `contracts/governance/TreasuryStabilizer.sol` | 385/386 | nested `vibeAMM.getTWAP` catches in `_calculateTrend` | **SAFE** | View calls. Nested catch: inner failure returns `trend = 0` (neutral), outer fallback uses volatility oracle. All conservative. |
| 43 | `contracts/governance/TreasuryStabilizer.sol` | 395 | `volatilityOracle.getVolatilityData` in `_calculateTrend` | **SAFE** | View call. Returns `trend = 0` (neutral — no market action triggered). |
| 44 | `contracts/identity/ContextAnchor.sol` | 81 | `agentRegistry.getAgent` in `onlyGraphOwner` | **SAFE** | Catch leaves `isOwner = false`. Downstream check `if (!isOwner) revert NotGraphOwner()` blocks access. Failure = access denied, not granted. |
| 45 | `contracts/identity/ContextAnchor.sol` | 190 | `agentRegistry.getAgent` in `mergeGraphs` | **SAFE** | Same — `canMerge` remains false, downstream `if (!canMerge) revert MergeNotAllowed()`. |
| 46 | `contracts/identity/ContextAnchor.sol` | 332 | `agentRegistry.getAgent` in `canAccessGraph` | **SAFE** | Catch doesn't return true. Falls through to access-grant check. |
| 47 | `contracts/identity/RewardLedger.sol` | 425 | `contributionDAG.getVotingPowerMultiplier` | **SAFE** | View call. Returns `PRECISION` (1.0 weight) on failure — neutral, not inflated. |
| 48 | `contracts/incentives/IncentiveController.sol` | 224 | `volatilityOracle.getVolatilityTier` in `routeVolatilityFee` | **SAFE** | View call. Failure leaves `effectiveRatio` at base rate (no volatility upscaling). Conservative. |
| 49-55 | `contracts/incentives/IncentiveController.sol` | 509, 517, 520, 528, 531, 539, 542, 550 | multiple view-only queries in `getPoolIncentiveStats` | **SAFE** | All inside a `view` stats aggregation function. Failure returns partial stats with zeros. No state mutation. Explicitly designed as best-effort aggregation. |
| 56 | `contracts/mechanism/IntelligenceExchange.sol` | 700 | `shapleyAdapter.onSettlement` | **SAFE** | Non-empty catch: settlement result is the source of truth (already stored). Adapter is a downstream notification. Failure is non-fatal by design (comment documents). |
| 57 | `contracts/mechanism/RosettaProtocol.sol` | 383 | `sieAddress.recordCitation` | **SAFE** | SIE is a secondary index. Translation result already emitted. Comment documents non-fatal design. |
| 58 | `contracts/mechanism/RosettaProtocol.sol` | 678 | `sieAddress.registerConceptAsset` | **SAFE** | SIE failure non-fatal. Rosetta is source of truth for lexicons. Comment documents. |
| 59 | `contracts/mechanism/VibeRNG.sol` | 136 | `callbacks[requestId].onRandomFulfilled` | **SAFE** | Random result stored in `req.randomResult` and `req.fulfilled = true` BEFORE callback. Caller can pull result via `getRandomResult`. Callback is push-notification; failure doesn't corrupt fulfilled state. |
| 60 | `contracts/metatx/VibeForwarder.sol` | 112 | `this.execute(requests[i])` in batch forward | **SAFE** | One failed forward in batch skips to next. Metatx is best-effort. `succeeded` counter tracked, emitted in `BatchForwarded`. Not a fund-accounting operation. |
| 61 | `contracts/reputation/ContributionPoolDistributor.sol` | 249 | `IDAG.distribute` | **LOAD-BEARING — FIXED** | See fix below. |
| 62 | `contracts/reputation/ContributionPoolDistributor.sol` | 214 | `dagRegistry.recordEpochActivity` | **SAFE** | Activity recording is an epoch-counter update in the registry. If it fails for one DAG, the weight computation at `getTotalWeight()` is still correct (weights based on registered values, not activity calls). The activity call is a pre-distribution hook. |

---

## Load-Bearing Sites Fixed

### Fix 1: `TreasuryStabilizer.withdrawDeployment` (site #41)

**Problem**: `daoTreasury.removeBackstopLiquidity` revert was silently caught, `received = 0` returned. Owner had no observable failed state and no retry path. The treasury's LP position remained outstanding but the call appeared to succeed (returned 0 without reverting). `BackstopWithdrawn(token, poolId, 0)` was emitted, making it indistinguishable from a legitimate zero-value withdrawal.

**Fix**: 
- Added `mapping(bytes32 => bool) withdrawalFailed` + 3 helper mappings for retry arg reconstruction.
- On catch: compute `failKey = keccak256(token, poolId, lpAmount, block.timestamp)`, set `withdrawalFailed[failKey] = true`, emit `WithdrawalFailed(failKey, token, poolId, lpAmount)`.
- Added permissionless `retryWithdrawDeployment(failKey)` that recomputes slippage bounds at retry time, calls treasury, clears flag on success, emits `WithdrawalRetried(failKey, success, received)`.
- Gap reduced from `[50]` to `[46]` (4 new slots used).

**Tests**: `test_W5_withdrawDeployment_failedFlagSet`, `test_W5_withdrawDeployment_retrySucceeds`, `test_W5_withdrawDeployment_retryStillFails`, `test_W5_withdrawDeployment_retryNonExistentReverts` — all pass.

**Commits**: `feat(W5): durable failed-flag + retry for TreasuryStabilizer.withdrawDeployment`

---

### Fix 2: `AutomatedRegulator._autoFileCase` (site #39)

**Problem**: `registry.openCase` revert was silently caught. `v.actionTaken = true` was set before the try (correct — prevents re-trigger), but `v.caseId` remained `bytes32(0)` with no observable indicator that the filing failed. The violation was permanently marked as "actioned" even though no compliance case was ever opened. No retry path existed. Off-chain observers who saw `CaseAutoFiled(..., bytes32(0), ...)` could not distinguish "case filed at id zero" from "case filing failed".

**Fix**:
- Added `mapping(bytes32 => bool) caseFilingFailed`.
- On catch: set `caseFilingFailed[violationId] = true`, emit `CaseFilingFailed(violationId, wallet)` (replaces old `CaseAutoFiled(..., bytes32(0))` which was ambiguous).
- Added permissionless `retryFilingCase(violationId)` that reconstructs the `openCase` call from stored violation data, clears flag on success, emits `CaseFilingRetried(violationId, success, caseId)`.
- Gap reduced from `[50]` to `[49]` (1 new slot used).

**Tests**: `test_W5_autoFileCase_failedFlagSet`, `test_W5_autoFileCase_retrySucceeds`, `test_W5_autoFileCase_retryStillFails`, `test_W5_autoFileCase_retryNonFailedReverts` — all pass.

**Commits**: `feat(W5): durable failed-flag + retry for AutomatedRegulator._autoFileCase`

---

### Fix 3: `ContributionPoolDistributor.distributeEpoch` DAG distribute catch (site #61)

**Problem**: VIBE tokens were minted to the distributor, then `forceApprove(dag, share)` was called, then `IDAG(dag).distribute(share)` was tried. On catch: approval cleared, but tokens stayed on the distributor with no tracking, no event, and no retry. `actuallyDistributed` was not incremented (correct), but `totalDistributed` at epoch end therefore undercounted, and the stranded tokens had no observable owner or recovery path. Across multiple epochs, stranded amounts would accumulate silently.

**Fix**:
- Added `mapping(address => uint256) strandedShares`.
- On catch: `strandedShares[dag] += share`, emit `DAGDistributeFailed(dag, share)`.
- Added permissionless `retryDAGDistribute(dag)` that: clears `strandedShares[dag]` before the external call (reentrancy guard via nonReentrant), re-approves, tries `distribute(amount)`, on success increments `totalDistributed` and emits `DAGDistributeRetried(dag, amount, true)`; on failure restores `strandedShares[dag] = amount` and emits retry-failed.
- Gap reduced from `[48]` to `[47]` (1 new slot used).

**Tests**: 5 tests in `test/reputation/ContributionPoolDistributorW5.t.sol` — all pass.

**Commits**: `feat(W5): durable failed-flag + retry for ContributionPoolDistributor DAG distribute catch`

---

## Summary

| Classification | Count |
|----------------|-------|
| **Safe-swallow** (justified inline + in this doc) | 59 |
| **Load-bearing — fixed** | 3 |
| **Load-bearing — deferred (arch-call-required)** | 0 |
| **Total inventoried** | 62 |

No sites were classified arch-call-required. All three load-bearing fixes were achievable via appended storage slots + permissionless retry functions, within the existing UUPS gap budgets.

---

## Orchestrator Verification Command

```bash
# Run all three targeted test suites:
forge test --match-path "test/TreasuryStabilizer.t.sol" -vvv
forge test --match-path "test/AutomatedRegulator.t.sol" -vvv
forge test --match-path "test/reputation/ContributionPoolDistributorW5.t.sol" -vvv

# Expected: 41 pass + 28 pass + 5 pass = 74 total, 0 failed.
```

---

*Audit performed per W5 cycle spec. Three `.sol` files modified (contracts), three test files modified/added. Commit pattern: one `feat(W5)` per fix + one `docs(W5)` for this doc.*
