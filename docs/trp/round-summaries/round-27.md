# TRP Round 27 — Cross-Contract Integration Pass

**Date**: 2026-04-02
**Baseline**: Tier 26 (Grade B)
**Target**: Cross-cutting audit — contract interactions, proxy patterns, systemic issues
**Progression**: Tier 26 → Tier 27

---

## Scoring

| Dimension | Metric | Score |
|-----------|--------|-------|
| **Survival** | Session stable (round 6/6 — session cap) | PASS |
| **R0 (density)** | N/A | N/A |
| **R1 (adversarial)** | 1 systemic finding (UUPS missing on 3 core contracts) | 1 |
| **R2 (knowledge)** | Cross-contract call chain mapped | 1 |
| **R3 (capability)** | N/A (no new tests) | N/A |
| **R4 (cure)** | 0 (systemic issues need design decisions) | 0 |
| **Integration** | Full open items consolidation across all 6 rounds | YES |

**Overall Grade: B** — Integration verification round. Key systemic finding: UUPS missing on 3 core contracts.

---

## R1: Integration Findings

### INT-01 | HIGH | UUPS Missing on 3 Core Proxy Contracts

VibeAMM, CommitRevealAuction, and CrossChainRouter all use `Initializable` + proxy deployment but do NOT inherit `UUPSUpgradeable`. Only VibeSwapCore has UUPS. This means:
- These contracts are permanently non-upgradeable via UUPS proxy
- If deployed behind ERC1967 proxy, the implementation slot can't be updated
- Deploy scripts use `ERC1967Proxy` (confirmed in test setup) expecting UUPS

**Fix**: Add `UUPSUpgradeable` to inheritance chain + `_authorizeUpgrade(address) internal override onlyOwner` to each.

### Cross-Contract Call Chain Map

```
User → VibeSwapCore.commitSwap()
         → CommitRevealAuction.commitOrderToPool()
User → VibeSwapCore.revealSwap()
         → CommitRevealAuction.revealOrder()
Settler → VibeSwapCore.settleBatch()
         → CommitRevealAuction.getCurrentReveals()
         → VibeAMM.executeBatchSwap()
              → CircuitBreaker._updateBreaker() / _checkBreaker()
User → VibeSwapCore.commitCrossChainSwap()
         → CrossChainRouter.sendCommit()
              → LayerZero Endpoint
Dest → CrossChainRouter.lzReceive()
         → CrossChainRouter._handleCommit()
         → CrossChainRouter.fundBridgedDeposit()  ← BROKEN (NEW-03)
              → CommitRevealAuction.commitOrder()
```

**Key Gap**: VibeSwapCore → CircuitBreaker connection is missing (CB-02). VibeAMM has breakers, but commits/reveals in VibeSwapCore are unprotected.

---

## CONSOLIDATED OPEN ITEMS — All Rounds (22-27)

### CRITICAL (1)
| ID | Contract | Description | Round |
|----|----------|-------------|-------|
| NEW-01 | CrossChainRouter | Phantom bridged deposit accounting inflates totalBridgedDeposits without ETH | R24 |

### HIGH (6)
| ID | Contract | Description | Round |
|----|----------|-------------|-------|
| NEW-03 | CrossChainRouter | fundBridgedDeposit sets Router as auction depositor (breaks reveal) | R24 |
| NEW-04 | CrossChainRouter | recoverExpiredDeposit sends ETH to source-chain address | R24 |
| CB-02 | CircuitBreaker | VibeSwapCore doesn't inherit CircuitBreaker | R24 |
| N03 | ShapleyDistributor | Authorized creator front-runs settlement with quality weights | R24 |
| INT-01 | Multiple | UUPS missing on VibeAMM, CommitRevealAuction, CrossChainRouter | R27 |
| — | CommitRevealAuction | Collateral underpricing via default commitOrder (Tier 15) | R26 |

### MEDIUM (9)
| ID | Contract | Description | Round |
|----|----------|-------------|-------|
| NEW-05 | CrossChainRouter | Liquidity state spoofing via peer | R24 |
| NEW-07 | CrossChainRouter | Priority bid from router surplus without user funding | R24 |
| NEW-10 | CrossChainRouter | sendCommit records caller as depositor, not user | R24 |
| CB-04 | CircuitBreaker | Whale LP griefs via WITHDRAWAL_BREAKER | R24 |
| CB-05 | CircuitBreaker | Stale windowValue after cooldown re-trips | R24 |
| N02 | ShapleyDistributor | cancelStaleGame doesn't clear shapleyValues | R24 |
| N06 | ShapleyDistributor | Halving at creation not settlement | R24 |
| M-03 | CrossChainRouter | setPeer allows zero (intentional for deletion) | R22 |
| M-06 | CrossChainRouter | _lzSend uses raw .call | R22 |

### LOW (4)
| ID | Contract | Description | Round |
|----|----------|-------------|-------|
| K-01 | CrossChainRouter | Not a real OApp | R22 |
| K-04 | CrossChainRouter | Hardcoded quote() | R22 |
| N04 | ShapleyDistributor | External call trust | R24 |
| N05 | ShapleyDistributor | Silent under-tracking | R24 |

### Documentation (K03-K08)
ShapleyDistributor documentation gaps — reduced priority after functional fixes.

---

## SESSION SUMMARY: 6 Rounds (Tier 21 → 27)

### Findings
- **Total discovered**: 38 new findings (1 CRITICAL, 6 HIGH, 9 MEDIUM, 4 LOW, rest knowledge/info)
- **Total fixed**: 16 (42% closure rate)
- **Subagents spawned**: 6 (3 R1 adversarial, 1 R1+R2 hybrid, 1 R3 capability, 1 test fixer)

### Fixes Applied
| Round | Fixes | Key Cures |
|-------|-------|-----------|
| R22 | 6 | H-02 emergency withdraw, H-03 deposit/fee separation, M-01/M-04/M-05 |
| R23 | 2 | F04 Lawson Floor cap, F05 quality weight validation |
| R24 | 6 | NEW-02 commitId fix, CB-01 breaker auto-reset, CB-03 validation, CB-07 state cleanup |
| R25 | 2 | CB-06 addLiquidity breaker, CB-09 dead import |
| R26 | 0 | Verification round |
| R27 | 0 | Integration verification round |

### Contracts Audited
1. CrossChainRouter — 3 rounds (R22, R24 cure, R27 integration)
2. ShapleyDistributor — 1 round (R23)
3. CircuitBreaker — 1 round (R24)
4. VibeAMM — 1 round (R25)
5. CommitRevealAuction — 1 round (R26)
6. VibeSwapCore — cross-cutting (R27)

### Architecture Issues Identified
1. Cross-chain deposit flow is fundamentally broken (NEW-01/03/04) — needs redesign
2. VibeSwapCore lacks CircuitBreaker integration (CB-02) — needs inheritance change
3. UUPS missing on 3 core contracts (INT-01) — needs upgrade
4. Quality weight front-running in ShapleyDistributor (N03) — needs snapshot or timelock

*Generated by TRP Runner v2.0*
