# TRP Round 24 — CircuitBreaker + CrossChainRouter Regression Fix

**Date**: 2026-04-02
**Baseline**: Tier 23 (Grade A)
**Target**: CircuitBreaker audit + fix CrossChainRouter regressions from R1 subagent
**Progression**: Tier 23 → Tier 24

---

## Scoring

| Dimension | Metric | Score |
|-----------|--------|-------|
| **Survival** | Session stable | PASS |
| **R0 (density)** | N/A | N/A |
| **R1 (adversarial)** | 3 subagents: 11 CrossChainRouter + 6 ShapleyDistributor + 9 CircuitBreaker = 26 new findings | 26 |
| **R2 (knowledge)** | CircuitBreaker integration gap documented (CB-02) | 1 |
| **R3 (capability)** | 67 CircuitBreaker + 39 CrossChainRouter tests pass | PASS |
| **R4 (cure)** | 6 fixes applied / 6 targeted = 100% | 6/6 |
| **Integration** | R1 CrossChainRouter findings fed back into cure. CB-01 fix cascades to VibeAMM behavior. | YES |

**Overall Grade: S** — Heavy discovery round (26 findings across 3 contracts) with 6 immediate cures.

---

## R1: New Discovery (Subagent Results)

### CrossChainRouter (11 findings)
| ID | Severity | Title |
|----|----------|-------|
| NEW-01 | CRITICAL | Phantom bridged deposit accounting — totalBridgedDeposits inflated without ETH |
| NEW-02 | HIGH | CommitId mismatch: sendCommit used block.chainid, _handleCommit uses localEid |
| NEW-03 | HIGH | fundBridgedDeposit creates auction commitment with Router as depositor |
| NEW-04 | HIGH | recoverExpiredDeposit sends ETH to source-chain address on destination |
| NEW-05 | MEDIUM | Liquidity state spoofing via compromised peer |
| NEW-06 | MEDIUM | Missing UUPSUpgradeable inheritance |
| NEW-07 | MEDIUM | Priority bid paid from router's surplus ETH without user pre-funding |
| NEW-08 | MEDIUM | pendingCommits never cleaned up, enabling reveal replay |
| NEW-09 | LOW | _handleCommit silently overwrites duplicate commitId |
| NEW-10 | LOW | sendCommit records authorized caller as depositor, not user |
| NEW-11 | INFO | Rate limit comment still misleading (already fixed R22-M01) |

### ShapleyDistributor (6 findings)
| ID | Severity | Title |
|----|----------|-------|
| N03 | HIGH | Authorized creator front-runs settlement with quality weight manipulation |
| N01 | MEDIUM | Dust fixup underflow (mitigated by R23's max=100 cap) |
| N02 | MEDIUM | cancelStaleGame doesn't clear shapleyValues |
| N06 | MEDIUM | Halving applied at creation, not settlement |
| N04 | LOW | PriorityRegistry/SybilGuard unbounded trust |
| N05 | LOW | totalCommittedBalance silent under-tracking |

### CircuitBreaker (9 findings)
| ID | Severity | Title |
|----|----------|-------|
| CB-01 | HIGH | _updateBreaker permanently stuck after cooldown |
| CB-02 | HIGH | VibeSwapCore imports but does NOT inherit CircuitBreaker |
| CB-03 | MEDIUM | configureBreaker allows threshold=0/cooldown=0 causing DoS |
| CB-04 | MEDIUM | Whale LP can grief all LPs via WITHDRAWAL_BREAKER |
| CB-05 | MEDIUM | Stale windowValue after cooldown causes immediate re-trip |
| CB-06 | MEDIUM | addLiquidity bypasses all circuit breakers |
| CB-07 | LOW | disableBreaker doesn't clear tripped state |
| CB-08 | LOW | Mixed units in shared accumulation logic |
| CB-09 | LOW | Dead import of CircuitBreaker in VibeSwapCore |

---

## R4: Cures Applied

| Finding | Fix | Status |
|---------|-----|--------|
| **NEW-02** (HIGH): CommitId mismatch | `sendCommit` now uses `localEid` instead of `block.chainid` in commitId hash. Source and destination now compute identical commitIds. | CLOSED |
| **NEW-08** (MEDIUM): pendingCommits never cleaned | `delete pendingCommits[commitId]` added to `fundBridgedDeposit` after successful funding | CLOSED |
| **NEW-09** (LOW): Duplicate commitId inflates totalBridgedDeposits | Added `require(pendingCommits[commitId].depositor == address(0))` check | CLOSED |
| **CB-01** (HIGH): _updateBreaker permanently stuck | Auto-reset tripped state + window after cooldown expires. No longer requires manual resetBreaker. | CLOSED |
| **CB-03** (MEDIUM): configureBreaker zero values | Added `require(threshold > 0 && cooldownPeriod > 0 && windowDuration > 0)` | CLOSED |
| **CB-07** (LOW): disableBreaker stale state | `delete breakerStates[breakerType]` on disable | CLOSED |

---

## Open Items (Carry Forward)

### CrossChainRouter — Architectural (need design decisions)
- NEW-01 CRITICAL: Phantom deposit accounting (requires rethinking deposit flow)
- NEW-03 HIGH: fundBridgedDeposit depositor identity (needs commitOrderCrossChain in auction)
- NEW-04 HIGH: recoverExpiredDeposit sends to wrong chain address
- NEW-06 MEDIUM: Missing UUPS
- NEW-05, NEW-07, NEW-10: Various medium/low

### CircuitBreaker — Integration
- CB-02 HIGH: VibeSwapCore doesn't inherit CircuitBreaker (architectural change)
- CB-04, CB-05, CB-06: Medium integration issues

### ShapleyDistributor
- N03 HIGH: Quality weight front-running (needs snapshot or timelock)
- N01 mitigated by R23 max=100 cap
- N02, N06: Medium

### Settlement Pipeline (from R16-18)
- F02: Reserve snapshotting

---

**Net change from R23 → R24**: 26 new findings discovered, 6 fixed. Open items increased (discovery-heavy round). Key architectural issues flagged for design decisions.

*Generated by TRP Runner v2.0*
