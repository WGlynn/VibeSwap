# TRP Round 16 — Settlement Pipeline

**Date**: 2026-04-02
**Baseline**: Tier 15 (Grade S)
**Target**: Settlement pipeline (CommitRevealAuction + VibeSwapCore + VibeAMM)
**Progression**: Tier 15 → Tier 16

---

## Scoring

| Dimension | Metric | Score |
|-----------|--------|-------|
| **Survival** | Session stable, no crash | PASS |
| **R0 (density)** | +1 indexed memory, orphan ratio stable (~57%) | +1 |
| **R1 (adversarial)** | 11 findings (2 HIGH, 4 MEDIUM, 3 LOW, 2 INFO) | 11 |
| **R2 (knowledge)** | 8 gaps (3 HIGH, 3 MEDIUM, 2 LOW) | 8 |
| **R3 (capability)** | 1 E2E test file, 5 tests, all passing | 5 tests |
| **Integration** | 3 loop pairs confirmed cross-feeding | YES |

**Overall Grade: S** — All 4 loops produced findings + integration across 3 pairs.

---

## R0: Compression

- Memory index: ~65 indexed / ~150+ on disk (~57% orphaned — under-utilization, not bloat)
- Added: `feedback_trp-round-summaries.md` (permanent rule: push round summaries to GitHub after each TRP cycle)
- No stale links detected. Index structure clean.

---

## R1: Adversarial Findings

### Tier 15 HIGH Verification

| Finding | Status | Notes |
|---------|--------|-------|
| Collateral underpricing | **PARTIALLY FIXED** → LOW | `estimatedTradeValue` still user-supplied, but actual tokens deposited via `safeTransferFrom` separately. Residual risk = cheap batch slot griefing. |
| Storage layout risk (UUPS) | **STILL PRESENT** | VibeSwapCore has UUPSUpgradeable but CRA and VibeAMM are Initializable without upgrade path. No automated tooling enforces storage layout. |
| Stuck priority bids | **FIXED** | `claimRefund()` pull pattern handles excess ETH. New stuck-funds issue found (F01). |

### New Findings

| ID | Severity | Title | Description |
|----|----------|-------|-------------|
| F01 | **HIGH** | Priority bids permanently stuck in CRA | `VibeSwapCore._forwardPriorityBids()` checks `address(this).balance` but ETH is in CRA, not Core. Condition silently fails. All priority bid revenue permanently locked. |
| F02 | **HIGH** | Reserve corruption in sequential batch execution | `executeBatchSwap` updates reserves per-order inside the loop. Later orders execute against drained reserves at the "same" clearing price. Priority bidders get guaranteed fills; regular orders may fail. Breaks uniform price guarantee. |
| F03 | MEDIUM | Donation attack false positive | `_checkDonationAttack` runs after Core transfers tokens to AMM but before `trackedBalances` update. Batches >1% of pool reserves trigger false positive revert. |
| F04 | MEDIUM | Block entropy predictability window | `advancePhase()` sets `batchRevealEndBlock` to current block. Last revealer who is also a validator can predict shuffle via `prevrandao`. |
| F06 | MEDIUM | BatchMath overflow for large reserves | `sqrt(reserve0 * reserve1)` overflows uint256 for reserves above ~3.4e38. Makes batch unsettleable. |
| F07 | MEDIUM | _orderDepositors index desync | Direct CRA reveals (bypassing Core) desync `_orderRevealCount` from auction order indices. Wrong user's deposits get decremented. |
| F08 | LOW | Authorized settlers flash loan exemption | Trust-bounded but allows compromised settler to flash loan attack commits. |
| F09 | LOW | getExecutionOrder gas for large batches | Recomputes full Fisher-Yates shuffle every call. 500+ orders may exceed block gas for view calls. |
| F10 | LOW | Bubble sort for priority orders | O(n^2) sort. DoS vector with many tiny priority bids. |
| F11 | INFO | CRA and VibeAMM not upgradeable | Both use Initializable but no upgrade mechanism. Bug fixes require full contract replacement. |

**Most dangerous path**: F01 — every priority bid ever paid is permanently locked. Not an attack; a protocol-breaking accounting bug.

---

## R2: Knowledge Findings

### Tier 15 HIGH Verification

| Finding | Status | Notes |
|---------|--------|-------|
| BuybackEngine vs P-001 | **STILL PRESENT** (worse) | Three-way contradiction: FeeRouter says "no buyback, 100% to LPs", BuybackEngine says "FeeRouter routes 10% to buyback", ProtocolFeeAdapter says "FeeRouter splits to treasury/insurance/revshare/buyback". FeeRouter code matches its own NatSpec (100% to LPs). Other two are stale. |
| Stale catalogue | **FIXED** | Catalogue updated 2026-03-26. FeeController still missing. |
| FeeController undocumented | **FIXED** | PID mechanism, EWMA, IL measurement, disintermediation grade all documented. |

### New Knowledge Gaps

| ID | Severity | Title |
|----|----------|-------|
| K01 | **HIGH** | FeeController.MIN_FEE_BPS comment says "0.5 bps = 0.005%" but value is 1 (= 1 bps = 0.01%). Off by 2x. |
| K02 | **HIGH** | FeeController not listed in CONTRACTS_CATALOGUE.md despite being live and integrated. |
| K03 | **HIGH** | Three-way fee model contradiction (FeeRouter vs BuybackEngine vs ProtocolFeeAdapter NatSpec). |
| K04 | MEDIUM | `createPool()` documented as "PERMISSIONLESS" but VibeAMM gates it to owner/authorizedExecutors. Only permissionless via Core. |
| K05 | MEDIUM | Batch settlement reserve-update behavior (non-atomic) undocumented. Contradicts whitepaper "uniform clearing" mental model. |
| K06 | MEDIUM | CONTRACTS_CATALOGUE.md says "3 contracts use Initializable only" then lists 5. |
| K07 | LOW | `commitOrder()` legacy comment unclear on deprecation timeline. |
| K08 | LOW | Duplicate DEFAULT_FEE_BPS=5 in VibeAMM and FeeController. Accidental consistency, not documented alignment. |

**Most critical gap**: K03 — three contracts describe three incompatible revenue models. Anyone building on BuybackEngine or ProtocolFeeAdapter docs will have a wrong model.

---

## R3: Capability Build

**Created**: `test/integration/SettlementPipelineE2E.t.sol`
**Status**: 5/5 tests PASS

| Test | Gas | Coverage |
|------|-----|----------|
| `test_fullPipeline_singleOrder` | 1.75M | Commit → reveal → settle → execute, verify token balances |
| `test_fullPipeline_multipleOrders` | 2.99M | 3 traders, different order sizes, uniform clearing price |
| `test_fullPipeline_withPriorityBids` | 3.17M | Priority execution ordering, bid tracking |
| `test_fullPipeline_partialReveals` | 2.59M | Slashing of unrevealed commits, remaining orders settle |
| `test_fullPipeline_crossContractState` | 1.76M | State consistency across CRA, Core, AMM post-settlement |

**Remaining gaps**: Cross-pool settlement, fuzz testing, reentrancy vectors, gas limits with 100+ orders, cross-chain path, wBAR routing.

---

## Integration (Cross-Loop Feeding)

| Pair | Evidence |
|------|----------|
| **R1 ↔ R3** | R1 found F03 (donation attack false positive). R3 independently confirmed during test construction: "batch volume >1% of pool reserves will fail settlement." |
| **R1 ↔ R2** | R1 found F02 (reserve corruption during sequential execution). R2 found K05 (non-atomic settlement undocumented). Same finding from security and knowledge perspectives. |
| **R2 ↔ R3** | R3's code reading confirmed R2's observation about `_getDepositor` indirection being load-bearing and underdocumented. |

---

## Open Items (Carry Forward to Tier 17)

### Priority Fixes (from R1)
1. **F01**: Add ETH forwarding from CRA to Core/treasury for priority bids
2. **F02**: Snapshot reserves before batch loop OR document non-atomic behavior
3. **F03**: Transfer tokens to AMM after donation check, or pre-update trackedBalances

### Knowledge Fixes (from R2)
1. **K03**: Reconcile FeeRouter/BuybackEngine/ProtocolFeeAdapter NatSpec
2. **K01**: Fix MIN_FEE_BPS comment (1 bps, not 0.5 bps)
3. **K02**: Add FeeController to CONTRACTS_CATALOGUE.md

### Capability Gaps (from R3)
1. Cross-pool batch settlement test
2. Fuzz testing on order sizes
3. Gas limit boundary tests (100+ order batches)

---

*Generated by TRP Runner v1.0 — Recursive Self-Improvement Protocol*
