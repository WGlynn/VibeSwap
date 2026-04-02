# Session Tip — 2026-04-02 (Session 3)

## Block Header
- **Session**: TRP Tier 21→27, 6 rounds
- **Parent**: `a6c8543c`
- **Branch**: `master`
- **Status**: 16 fixes applied, 57 findings discovered (38 coordinator + 19 late subagent)

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

### R1 Subagent Results (Arrived Late)

**VibeAMM (10 findings)**:
- AMM-01 HIGH: Batch swap bypasses x*y=k — clearing price output != constant product output. k decreases over batches. LPs lose value.
- AMM-03 HIGH: Batch swap refunds tokens to msg.sender (executor/VibeSwapCore), NOT order.trader. Failed swaps send tokens to wrong address.
- AMM-04 MEDIUM: No k-invariant check in batch reserve updates
- AMM-05 MEDIUM: TWAP oracle is self-referential — gradual manipulation over 20-30 min
- AMM-06 MEDIUM: Flash loan protection per-pool, not per-user — cross-pool attacks possible
- AMM-07 MEDIUM: Fee accounting inconsistency between batch and single-swap paths
- AMM-02 LOW: Redundant minimum liquidity deduction (BatchMath 1000 + VibeAMM 10000)
- AMM-08 LOW: Unchecked reserve additions in addLiquidity
- AMM-09 LOW: trackedBalances global across pools — cross-pool donation confusion
- AMM-10 INFO: PoW fee discount can be set to 100%, eliminating fees

**CommitRevealAuction (9 findings)**:
- R1-F01 HIGH: Collateral bypass via legacy commitOrder (confirmed still open from T15)
- R1-F02 HIGH: No collateral validation at reveal — deposit/trade size mismatch unenforceable
- R1-F03 MEDIUM: Stale batch deposits locked forever if settleBatch never called
- R1-F04 MEDIUM: PoW virtual value inflates totalPriorityBids ETH accounting (withdrawal DoS or fund drain)
- R1-F05 MEDIUM: Flash loan protection bypassed via authorized settlers
- R1-F06 LOW: _slashCommitment sends ETH inline during reveal (callback surface)
- R1-F07 LOW: 256-block-stale fallback entropy is validator-predictable
- R1-F08 LOW: EXECUTED status semantically incorrect for deposit withdrawal
- R1-F09 INFO: __gap storage layout ordering needs verification

### Revised Priority for Next Session

**CRITICAL** (fix first):
1. AMM-01: Batch swap k-invariant — add post-swap `require(reserve0 * reserve1 >= k_before)`
2. NEW-01: Phantom bridged deposits

**HIGH** (fix next):
3. AMM-03: Refund to order.trader not msg.sender
4. R1-F04: PoW virtual value separate from real ETH in totalPriorityBids
5. R1-F02: Collateral validation at reveal time
6. NEW-03: commitOrderCrossChain function needed
7. CB-02: VibeSwapCore CircuitBreaker integration
8. INT-01: UUPS on 3 core contracts
