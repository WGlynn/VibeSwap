# Session Tip — 2026-04-02 (Session 2)

## Block Header
- **Session**: TRP Tier 15, fee architecture Q&A
- **Parent**: `737bda93`
- **Branch**: `master`
- **Status**: No code changes. TRP research-only cycle.

## What Changed This Session

### TRP Cycle — TIER 15 Reached (Grade S)
Target: Core mechanism (CommitRevealAuction + VibeSwapCore)

**R0 (Compression)**: MEMORY.md at 45/200 lines (22.5%). 117/177 memory files orphaned (not in index). No compression needed — under-indexing is the problem, not bloat.

**R1 (Adversarial) — 16 findings**:
- HIGH: Collateral underpricing via zero `estimatedTradeValue` (slashing deterrent gutted — commitOrder always passes 0)
- HIGH: `commitOwners` storage layout risk in UUPS proxy (declared after first use)
- HIGH: Priority bid ETH stuck in CommitRevealAuction (never reaches treasury via VibeSwapCore)
- MEDIUM x5: Settler flash loan bypass, cross-chain hash identity mismatch, unbounded bubble sort gas grief, slash refund external call, treasury grief post-disintermediation
- LOW x5, INFO x3

**R2 (Knowledge) — 11 gaps**:
- HIGH: BuybackEngine not tombstoned (contradicts P-001), 3 competing FeeRouters (no canonical in CKB), FeeController absent from CKB/whitepapers, contracts-catalogue 42 days stale
- MEDIUM-HIGH: PoW priority no primitive, priority-first+uniform clearing coupling not formalized
- MEDIUM: wBAR absent from KB, PoolComplianceConfig undocumented, ClawbackRegistry no disintermediation grade, CLAUDE.md stale session state
- LOW-MED: FeeController not in Atomized Shapley map

**R3 (Capability) — 8 test gaps, 13 invariants, 5 infra improvements**:
- CRITICAL: _executeOrders settlement pipeline has zero end-to-end coverage through VibeSwapCore
- HIGH: Cross-chain refund/settle lifecycle zero tests, C-02 duplicate order griefing defense zero tests
- MEDIUM: Invariant handler never reveals, retryFailedExecution zero tests, wBAR routing zero tests, timelock/governance path zero tests

**Loop Integration**: R1↔R3 (3 direct mappings), R2↔R1 (2 connections), R0↔R2 (orphan→stale link)

### Fee Architecture Q&A
Confirmed: Two parallel LP reward streams, no contradiction.
1. Swap fees in native tokens via FEE_DISTRIBUTION track (time-neutral, no halving)
2. VIBE via TOKEN_EMISSION track (Bitcoin-style halving, 32 eras)
Same Shapley weights govern both. "VIBE never touches fee pipeline" = VIBE isn't bought/burned/redirected in fee flow.

## Pending / Next Session
- **R1 HIGHs to fix**: Collateral underpricing (most urgent), priority bid ETH stuck, commitOwners storage verify
- **R3 CRITICAL**: Build settlement pipeline integration test
- **R2 knowledge debt**: Tombstone BuybackEngine, update contracts-catalogue, add FeeController to CKB
- **R0 maintenance**: Triage 117 orphaned memory files
- Submit Arbitrum Audit Program application
- Post GEV ELI5 to LinkedIn (saved for 2026-04-03)
- Wire FeeController.measureAndUpdate() into batch settlement
