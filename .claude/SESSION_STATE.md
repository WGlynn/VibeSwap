# Session Tip — 2026-04-02 (Session 3)

## Block Header
- **Session**: TRP Tier 21→27, 6 rounds
- **Parent**: `a6c8543c`
- **Branch**: `master`
- **Status**: 16 fixes applied, 38 findings discovered

## What Changed This Session

### TRP Cycle — TIER 27 Reached (Tier 21→27, Grade mix S/A/A/S/A/B/B)

**R22 (CrossChainRouter cure)**: 6 fixes — H-02 emergency withdraw, H-03 deposit/fee separation, M-01 rate limit comment, M-04 peerless ETH refund, M-05 stub docs. 45 tests pass.

**R23 (ShapleyDistributor cure)**: 2 fixes — F04 Lawson Floor cap at 100 (prevents 500%+ pool overcommit), F05 quality weight nonzero requirement. 45 tests pass.

**R24 (CircuitBreaker + CrossChainRouter)**: 26 new findings from 3 subagents. 6 fixes — CB-01 auto-reset breaker after cooldown, CB-03 param validation, CB-07 state cleanup on disable, NEW-02 commitId localEid fix, NEW-08 pendingCommits cleanup, NEW-09 duplicate check. 67+39 tests pass.

**R25 (VibeAMM)**: 2 fixes — CB-06 addLiquidity PRICE_BREAKER check, CB-09 dead import removal. 109/116 tests (7 pre-existing failures).

**R26 (CommitRevealAuction)**: Verification round. Confirmed Tier 15 collateral underpricing still open. Confirmed NEW-03 depositor mismatch is real.

**R27 (Integration)**: Systemic finding — UUPS missing on VibeAMM, CommitRevealAuction, CrossChainRouter. Call chain mapped.

## Pending / Next Session

### CRITICAL Priority
- **NEW-01**: Phantom bridged deposits — `_handleCommit` credits totalBridgedDeposits without ETH arriving. Needs architectural fix: don't credit until `fundBridgedDeposit`.

### HIGH Priority
- **NEW-03**: `fundBridgedDeposit` → `commitOrder` sets Router as depositor, breaks reveals. Need `commitOrderCrossChain` function.
- **NEW-04**: `recoverExpiredDeposit` sends ETH to source-chain address on destination chain.
- **CB-02**: VibeSwapCore needs CircuitBreaker integration (inherit or query AMM).
- **N03**: ShapleyDistributor quality weight front-running — snapshot at game creation or add timelock.
- **INT-01**: Add UUPSUpgradeable to VibeAMM, CommitRevealAuction, CrossChainRouter.
- **Collateral underpricing**: commitOrder defaults estimatedTradeValue=0 → MIN_DEPOSIT=0.001 ETH always.

### MEDIUM Priority
- CB-04/CB-05: Withdrawal breaker griefing, stale window re-trip
- NEW-05/07/10: CrossChainRouter medium issues
- N02/N06: ShapleyDistributor medium issues
- 7 pre-existing VibeAMM test failures (DonationAttackSuspected)

### R1 Subagent Results Pending
- VibeAMM R1 subagent was still running at session end — check git for any commits
- CommitRevealAuction R1 subagent was still running — check git for any commits
