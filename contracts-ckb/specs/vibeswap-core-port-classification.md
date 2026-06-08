# VibeSwapCore — CKB Port Classification

**Spec layer**: `vibeswap/contracts/core/VibeSwapCore.sol`
**Port classification**: REINTERPRET (Option B — composition via cell-graph linkage, no orchestrator cell)
**Status**: Spec draft. Resolves the previously UNRESOLVED entry in INDEX.md.
**Substrate**: VibeSwap-augmented Nervos CKB

---

## What VibeSwapCore is on EVM

VibeSwapCore is the UUPS-upgradeable orchestrator that sits in front of every other contract in the protocol. Users do not call CommitRevealAuction, VibeAMM, DAOTreasury, or CrossChainRouter directly — they call `VibeSwapCore.commitSwap`, `revealSwap`, `settleBatch`, `commitCrossChainSwap`, and the cross-chain refund pair. Core then forwards into the subsystems while interleaving its own bookkeeping.

The Solidity contract holds five categories of state and behavior:

**Subsystem references.** `auction` (ICommitRevealAuction), `amm` (IVibeAMM), `treasury` (IDAOTreasury), `router` (CrossChainRouter), plus optional `wbar` (IwBAR), `incentiveController`, `clawbackRegistry`. These are the address-of-thing pointers that make Core an orchestrator rather than a mechanism.

**User-funded deposits.** `deposits[user][token]` tracks ERC20 balances pulled in at commit time. `pendingSwaps[commitId]` maps a commitment to its plaintext params for use at reveal. `commitOwners[commitId]` binds a commit to its creator. `batchTraderCommitId[batchId][trader]` enforces one-commit-per-trader-per-batch (the M-06 invariant).

**Cross-chain order state.** `crossChainOrders[commitHash]` holds the four-state machine `PENDING → REFUND_REQUESTED → SETTLED/REFUNDED`. `pendingCrossChainCount[user][token]` is the C20 counter that blocks `withdrawDeposit` while any cross-chain order is non-terminal.

**Security-overlay state.** Rate limits (`userRateLimits[user]`, `maxSwapPerHour`), blacklist / whitelist mappings, EOA-only flag, commit cooldown, guardian, timelock controller, paused flag, plus inherited `CircuitBreaker` storage (the `VOLUME_BREAKER` gates `commitSwap` and `commitCrossChainSwap`).

**Failure-recovery queues.** `failedExecutions` and `failedCompliances` arrays with retry / compaction functions. These exist because Core's `_recordExecution` and `_recordCrossChainExecution` wrap calls to `incentiveController` and `clawbackRegistry` in `try/catch` and must persist the unfulfilled work for later replay.

User-facing functions: `commitSwap`, `revealSwap`, `settleBatch`, `executeBatch`, `withdrawDeposit`, `commitCrossChainSwap`, `requestCrossChainRefund`, `executeCrossChainRefund`. View functions: `getCurrentBatch`, `getPoolInfo`, `getQuote`, `getDeposit`, `getUserRateLimit`. Admin: `createPool`, `setSupportedToken`, `pause/unpause`, `updateContracts`, `setWBAR`, `setIncentiveController`, the `setBlacklist` / `setContractWhitelist` / `setMaxSwapPerHour` / `setRequireEOA` / `setCommitCooldown` / `setGuardian` / `setTimelockController` / `setClawbackRegistry` set, `emergencyPause`, plus `_authorizeUpgrade`.

Calls into subsystems: `auction.commitOrderToPool`, `auction.revealOrderCrossChain`, `auction.advancePhase`, `auction.settleBatch`, `auction.withdrawPriorityBids`, `auction.getRevealedOrders`, `auction.getExecutionOrder`, `auction.getCrossChainRecipient`; `amm.createPool`, `amm.getPool`, `amm.getPoolId`, `amm.quote`, `amm.executeBatchSwap`; `treasury.receiveAuctionProceeds`; `router.sendCommit`; `wbar.mint / settle / holderOf`; `incentiveController.recordExecution`; `clawbackRegistry.recordTransaction / isBlocked`.

**Invariants that exist ONLY at the orchestration layer:**

- **One-commit-per-trader-per-batch (M-06).** Enforced by `batchTraderCommitId`. Neither CRA nor AMM knows about it.
- **Deposit-vs-cross-chain-withdrawal interlock (C20).** `withdrawDeposit` must block while `pendingCrossChainCount > 0`. Neither the AMM nor the router holds the deposit; Core does.
- **Local deposit account separate from CRA deposit.** Core takes user tokens via `safeTransferFrom`, then submits to `auction.commitOrderToPool` as itself. The AMM is paid by Core, not by the user. Settlement subtracts from `deposits[user][token]` after batch execution. This is a multi-cell-resource flow that Core stitches together.
- **Cumulative-validated-per-trader (C-02).** During `_validateAndGroupOrders`, multiple orders from the same trader-token pair are summed against the deposit. Without aggregation a trader with deposit=1000 could double-spend two orders of 600. Lives in Core because deposits live in Core.
- **CRA-settled-but-AMM-failed recoverability (INT-004).** `batchExecuted[batchId]` decouples CRA settlement from AMM execution so that a reverting AMM call doesn't lock CRA. Pure orchestration concern.
- **Same-recipient routing (wBAR / cross-chain).** `_resolveRecipient` chains `auction.getCrossChainRecipient` → wBAR holder check → trader. Cross-mechanism resolution that no single subsystem owns.
- **Failed-call retry queues.** Try/catch around `incentiveController.recordExecution` and `clawbackRegistry.recordTransaction` plus persistent queues for later replay.
- **VOLUME_BREAKER on commits.** Inherited from CircuitBreaker. Trips when the 1-hour rolling commit volume exceeds threshold.
- **Security-overlay surface.** Rate limit, EOA-only check, commit cooldown, blacklist / whitelist / taint, pause flag. All Core-level.

The orchestrator pattern bundles flow control, deposit custody, multi-step ordering, the security overlay, and the recovery surface into one contract behind one address. That bundling is an EVM convenience: one external address, one ABI, one ownership / upgrade boundary, one mutex (nonReentrant).

## CKB-side decomposition options

On CKB there is no contract address. There are cells. State is the consumption-and-creation graph of cells in a transaction. Composition is built by transaction-shape, not by a deployed singleton holding pointers. Three port classifications are honestly available.

### Option A — DIRECT-PORT (VibeSwapCoreCell)

Preserve a single orchestrator cell.

- **Cell**: VibeSwapCoreCell. Cell-data holds subsystem-cell-type-hash references (CRA-type-hash, AMM-type-hash, treasury-type-hash, messaging-hub-type-hash) plus a session-counter and any orchestration flags.
- **Lock**: governance lock (timelock + guardian multisig) for admin-only mutation.
- **Type-script**: forces every user-facing flow to consume-and-recreate the VibeSwapCoreCell, with the type-script re-implementing the invariants from VibeSwapCore.sol — M-06, C20, deposit accounting, batch execution gate, rate limit, EOA-only, etc.
- **User TX shape**: every commit / reveal / settlement transaction includes VibeSwapCoreCell as both input and output. The cell becomes a write-bottleneck.

PROS:
- 1:1 EVM ↔ CKB mapping; readers can trace `VibeSwapCore.sol` line-by-line to the type-script.
- All orchestration invariants in one auditable surface.
- Admin / upgrade story is concentrated.

CONS:
- **Severe write contention.** ∀ user-action ⇒ same cell consumed ⇒ serial throughput ¬ parallel. This collapses the structural advantage of UTXO substrate.
- **Reintroduces the airgap CKB dissolves.** Cell becomes an EVM-style singleton; mechanism invariants live in shared mutable state rather than emerging from transaction-shape.
- **Reintroduces upgrade-pointer indirection.** UUPS-on-EVM exists because EVM addresses are immutable. CKB has cell-dep type-hash references, which is a substrate-native indirection. Wrapping it again duplicates the mechanism.
- **Substrate fights the design.** [P·substrate-geometry-match] is violated. We are imposing account-model geometry on a cell-model substrate.

### Option B — REINTERPRET (composition via cell-graph linkage, no orchestrator)

Drop the orchestrator entirely. Each subsystem-spec (CommitRevealAuction, VibeAMM, ShapleyDistributor, MessagingHub, CircuitBreaker, LawsonConstants) handles its own invariants in its own type-script. Orchestration emerges from the shape of transactions — what cells are consumed together, what cells are created, what cell-deps are present.

The cross-mechanism invariants that Core enforces on EVM are translated into cell-shape invariants:

- **Deposit custody** ⇒ user holds funded sUDT cells in their own lock. There is no Core-pooled deposit map. The CommitCell spec already binds the deposit + collateral to the cell at creation.
- **One-commit-per-trader-per-batch (M-06)** ⇒ a TraderBatchPositionCell unique per (trader_lock_hash, batch_id), consumed-and-recreated by CommitCell-creation. The CommitCell type-script asserts the position-cell exists in inputs.
- **C20 cross-chain interlock** ⇒ a PendingCrossChainCounterCell per (trader_lock_hash, token_type_id) tracks non-terminal CCR count. Local withdraws (user spending sUDT) require this cell to be referenced and equal zero.
- **Cumulative-validated (C-02)** ⇒ dissolved. Each CommitCell binds its own deposit. There is no shared pool to overdraw because every commit pays its own deposit at creation.
- **INT-004 batch-execution decoupling** ⇒ dissolved. CRA settlement and AMM swap execution become separate transactions or separate cell consumptions inside one transaction. Settlement is a BatchSettlementCell already, and AMM execution is a PoolCell transition — no shared orchestrator to lock.
- **VOLUME_BREAKER on commits** ⇒ a per-mechanism BreakerCell (commit-volume signal) updated by every CommitCell creation transaction, as already specified in `circuit-breaker.md`.
- **Rate limit, EOA-only, cooldown** ⇒ FibonacciScalingCell (per-trader damping, already partial in `vibe-amm.md`) handles per-user rate. EOA-only dissolves on CKB (there is no `tx.origin` because there is no contract-vs-EOA distinction; lock-scripts arbitrate authorization). Commit-cooldown becomes a per-trader-per-mechanism LastCommitBlockCell.
- **Blacklist / whitelist / taint** ⇒ ClawbackRegistryCell consumed as cell-dep at commit time; CommitCell type-script asserts trader_lock_hash not present in the registry. The compliance / taint check is already a structural invariant of CommitCell creation.
- **Pause flag** ⇒ subsumed by BreakerCell. Each mechanism has its own breaker that any user can trip on threshold, that guardian/governance can trip on emergency, and that requires attested resume.
- **Failed-call retry queues** ⇒ dissolved. Try/catch on EVM exists because the EVM revert atom is the transaction. On CKB the "record" calls become independent transactions consuming the BatchSettlementCell + an unupdated IncentiveLedgerCell, producing an updated IncentiveLedgerCell. If the ledger update fails, the BatchSettlementCell is unchanged and anyone can retry. No queue needed because the failed work is implicit in the unprocessed-settlement-cell.
- **wBAR routing / recipient resolution** ⇒ CommitCell already carries `recipient` and `xchain_recipient` per the auction spec. The settlement-cell type-script writes outputs to those addresses directly.
- **Treasury priority-bid forwarding** ⇒ BatchSettlementCell type-script outputs a TreasuryDepositCell with `total_priority_bids` capacity. No orchestrator pull needed.

PROS:
- **Substrate-geometry match.** Composition via transaction-shape is what CKB is built for. [P·substrate-geometry-match] holds.
- **Parallel throughput.** Commits from different traders touch different cells. No write-bottleneck.
- **Airgap dissolved.** Every cross-mechanism invariant becomes a structural property of cell-graph composition, ¬ a runtime check in a shared singleton.
- **Audit surface shrinks.** No orchestrator type-script duplicating subsystem logic. Each invariant lives in exactly one place.
- **Honestly UTXO.** ∀ multi-step flow ⇒ build the transaction, sign the inputs, broadcast. Wallets + SDK do the orchestration that VibeSwapCore did on EVM.

CONS:
- **Transaction construction is heavier client-side.** Wallets / SDK must compose multi-cell transactions correctly. Mitigation: ship a `vibeswap-ckb-tx-builder` Rust + TypeScript crate that constructs the canonical user-flow transactions.
- **No single "VibeSwap-as-callable" address.** Integrators look for one ABI. Mitigation: documentation. The same complaint applies to using CKB at all and is addressed at the substrate layer, not the protocol layer.
- **Cross-cell admin operations (e.g. `updateContracts`) become cell-dep type-hash migrations** rather than one setter call. This is honestly slower and the right slow — substrate enforces that subsystem-swap is a load-bearing operation.

### Option C — REINTERPRET-with-thin-shim (OrchestrationSessionCell)

A hybrid. Drop business-logic enforcement from the orchestrator, but keep a thin session-routing cell.

- **Cell**: OrchestrationSessionCell. Cell-data holds the current-batch reference, the active subsystem-cell-type-hashes, and a session-counter.
- **Lock**: governance for admin mutations only.
- **Type-script**: thin — verifies that subsystem-cell-type-hashes are well-formed and that the session-counter advances monotonically. ✗ enforce M-06, C20, deposit accounting, breaker state. Those still live in their own cells per Option B.
- **User TX**: optionally reference OrchestrationSessionCell as cell-dep to read current-batch and subsystem-pointers in one shot.

PROS:
- Slightly better integrator UX: one cell to read for "what is the live subsystem set right now."
- Read-bottleneck only (cell-dep), not write-bottleneck.
- Subsystem-swap migrations live in one place.

CONS:
- **Net-new substrate-cell with no business-logic enforcement is mostly notation.** The same information lives in well-known type-hashes that the SDK can hard-code or resolve from a registry-cell pattern (already common on CKB, e.g. the system-script registry).
- **Tempts scope creep.** Once the cell exists, the temptation to add "just one" invariant accumulates back toward Option A.
- **Adds upgrade-permission cell that didn't have to exist.** Substrate already gives us cell-dep migration as the canonical mechanism.

## Recommended choice

**Option B — REINTERPRET via cell-graph composition, no orchestrator cell.**

Reason: every invariant VibeSwapCore enforces is either already specced as a structural property of an existing cell type (auction deposits, breaker state, treasury forwarding, recipient resolution) or maps cleanly to a small new dedicated cell (TraderBatchPositionCell for M-06, PendingCrossChainCounterCell for C20). Nothing requires a shared write-bottleneck cell; nothing requires shared mutable orchestration state. ∀ orchestrator-invariant ⇒ ∃ cell-graph translation. The orchestrator was an EVM convenience, not a structural requirement, and CKB substrate-geometry rewards letting it dissolve.

Will-frame [P·structure-does-the-work] applies directly: the orchestrator on EVM does work because EVM substrate cannot do that work. On CKB, the substrate does the work and the orchestrator is redundant. Keeping it would impose account-model geometry on cell-model substrate and violate [P·substrate-geometry-match].

## Detailed spec for Option B

The full set of cells introduced or referenced to absorb VibeSwapCore's responsibilities:

### TraderBatchPositionCell

**Purpose**: enforce one-commit-per-trader-per-batch (M-06).

**Data layout**:
- `version: u8`
- `trader_lock_hash: [u8; 32]`
- `batch_id: u64`
- `commit_outpoint: Option<OutPoint>` (None until consumed by a commit, Some after)

**Lock-script**: trader's own (Omnilock). Only the trader can spend it.

**Type-script invariants** (creation): one TraderBatchPositionCell per (trader, batch_id). Created in the same tx as the trader's first CommitCell for that batch, or pre-created at session-start.

**Type-script invariants** (consumption-by-commit): a CommitCell creation transaction MUST consume the matching TraderBatchPositionCell and recreate it with `commit_outpoint = Some(this_commit's_outpoint)`. A second commit-attempt by the same trader for the same batch fails because the position-cell is already Some.

### PendingCrossChainCounterCell

**Purpose**: enforce C20 — block local withdrawals while any cross-chain order for the (trader, token) pair is in PENDING or REFUND_REQUESTED.

**Data layout**:
- `version: u8`
- `trader_lock_hash: [u8; 32]`
- `token_type_id: [u8; 32]`
- `pending_count: u32`
- `last_updated_at_block: u64`

**Lock-script**: permissionless. State transitions gated by type-script.

**Type-script invariants**:
- Increment on consumption-by-CrossChainCommit transaction.
- Decrement on consumption-by-CrossChainSettlement OR consumption-by-CrossChainRefund transaction.
- Trader's sUDT withdraw transaction MUST reference this cell as cell-dep AND assert `pending_count == 0`. If the cell does not exist (trader has never done a cross-chain order for this token), the withdraw is unblocked.

### CommitVolumeBreakerCell

Already specified per `circuit-breaker.md`. Mechanism-id is "commit-reveal-auction", signal_type is Volume. The VOLUME_BREAKER from `VibeSwapCore.sol` becomes this CKB-native breaker. Every CommitCell creation transaction updates the counter; threshold-cross trips. Attested resume per the circuit-breaker spec.

### ClawbackRegistryCell

Referenced as cell-dep by CommitCell-creation. Holds the blocked-trader set (sparse). CommitCell type-script asserts `trader_lock_hash ∉ blocked_set`. Implements the `notTainted` modifier without a Core lookup.

### CommitCooldownCell

**Purpose**: enforce per-trader-per-mechanism commit cooldown (anti-spam, the `commitCooldown` parameter).

**Data layout**:
- `version: u8`
- `trader_lock_hash: [u8; 32]`
- `mechanism_id: [u8; 32]`
- `last_commit_at_block: u64`

**Lock-script**: trader's own.

**Type-script invariants**: CommitCell creation consumes this cell and recreates with `last_commit_at_block = current`. Recreation asserts `current_block ≥ previous.last_commit_at_block + cooldown_blocks` (cooldown_blocks read via cell-dep on LawsonConstantsRegistryCell).

### RateLimitCell

Already partially specced in `vibe-amm.md` as the per-trader FibonacciScaling cell. Subsumes `maxSwapPerHour` enforcement. Per-trader per-pool rolling-window counter with Fibonacci damping. Replaces the SecurityLib.RateLimit storage.

### Recipient resolution

Already structural in CommitCell + RevealCell per `commit-reveal-auction.md`. The cells carry `recipient` and `xchain_recipient` at creation; BatchSettlementCell type-script writes outputs to those addresses. The wBAR routing of `_resolveRecipient` translates to: if a TraderWBARPositionCell exists for the (trader, commitId) pair, route to wBAR's lock; else use the recipient field.

### IncentiveLedgerCell + ComplianceLedgerCell

Independent ledger cells consumed-and-recreated by BatchSettlementCell consumption. A failed update is just a missing recreation — anyone can retry by constructing the update transaction. ✗ retry queue cell needed.

### Orchestration flow (the canonical user transactions)

**Commit transaction** (local swap):
- Inputs: trader's funded sUDT cell(s), TraderBatchPositionCell (None state), CommitCooldownCell, RateLimitCell, ClawbackRegistryCell (cell-dep)
- Outputs: CommitCell (with deposit + collateral), updated TraderBatchPositionCell (Some), updated CommitCooldownCell, updated RateLimitCell, updated CommitVolumeBreakerCell, change cell.

**Reveal transaction**:
- Inputs: CommitCell.
- Outputs: RevealCell.
- Per `commit-reveal-auction.md`. ✗ orchestrator involvement.

**Settlement transaction**:
- Inputs: all RevealCells for batch, PoolCell, IncentiveLedgerCell, ComplianceLedgerCell.
- Outputs: BatchSettlementCell, per-order output cells routed to recipients, updated PoolCell, TreasuryDepositCell with priority bids, updated IncentiveLedgerCell, updated ComplianceLedgerCell.
- Permissionless. Type-scripts of each consumed cell enforce correctness.

**Cross-chain commit**:
- Inputs: trader's funded sUDT cell(s), TraderBatchPositionCell, CommitCooldownCell, RateLimitCell, ClawbackRegistryCell, PendingCrossChainCounterCell (incremented).
- Outputs: BurnReceiptCell (per MessagingHub spec), updated counters, updated breaker, change.

**Cross-chain refund request / execute**: per MessagingHub + the BurnReceipt timeout / challenge-window machinery. The C20 counter decrements at terminal state.

**Local withdraw**:
- Inputs: trader's sUDT cell at protocol-held lock (if held; or trader-already-holds).
- Cell-deps: PendingCrossChainCounterCell (must equal zero for this trader-token pair, or be absent).
- Outputs: trader-owned sUDT cells.

Note: in Option B the deposit never lives in a protocol-held lock for local swaps — the CommitCell holds the funds directly. `withdrawDeposit` for local-swap deposits dissolves entirely; users hold their own tokens until commit. The cross-chain refund path is the only deposit-release flow, and it routes via BurnReceipt → RefundCell per the messaging-hub spec.

## Migration path from EVM

EVM-caller pattern: `VibeSwapCore.commitSwap(tokenIn, tokenOut, amountIn, minAmountOut, secret)` → one tx → done.

CKB-caller pattern: build a multi-input transaction that consumes the trader's funded sUDT cell(s) + TraderBatchPositionCell + CommitCooldownCell + RateLimitCell, references ClawbackRegistryCell + LawsonConstantsRegistryCell + PoolConfigCell + CurrentBatchCell as cell-deps, produces the CommitCell + updated state cells + change cell. The `vibeswap-ckb-tx-builder` crate exposes a `build_commit_swap(...)` function that takes the EVM-equivalent arg list and returns a fully-formed CKB transaction skeleton ready for signing.

For each EVM entry point the builder exposes a matching constructor:

- `commitSwap` → `build_commit_swap`
- `revealSwap` → `build_reveal_swap`
- `settleBatch` → `build_settle_batch` (permissionless; any keeper can build and submit)
- `withdrawDeposit` → dissolves for local-only; `build_request_cross_chain_refund` + `build_execute_cross_chain_refund` for cross-chain.
- `commitCrossChainSwap` → `build_commit_cross_chain_swap`
- `requestCrossChainRefund`, `executeCrossChainRefund` → matching builders.
- View functions (`getCurrentBatch`, `getQuote`, `getDeposit`) → RPC queries against the indexed cells, no transaction needed.

Integrators who target the EVM ABI today get a structurally-equivalent TypeScript SDK that wraps the same set of user-flows over the CKB tx builder. The conceptual surface stays the same; the substrate underneath changes.

## Failure modes specific to Option B

**Stale cell-dep risk.** Cell-deps for ClawbackRegistryCell, LawsonConstantsRegistryCell, etc. resolve at transaction-construction time. If the registry updates between construction and inclusion, the transaction may fail. Mitigation: include the registry-cell type-hash and let the script verify against the latest registry-cell present in the block. CKB's existing cell-dep semantics already cover this.

**Tx-builder bug as protocol bug.** With Core gone, the SDK's transaction construction logic carries weight that VibeSwapCore.sol carried before. A buggy builder produces invalid transactions that fail at the type-script. Mitigation: type-script invariants are the authoritative spec; the tx-builder is checked against them via fuzz tests that round-trip "build tx → submit to ckb-debugger → assert acceptance for valid inputs and rejection for adversarial inputs."

**TraderBatchPositionCell creation race.** Two commits in the same batch from the same trader race to consume the same TraderBatchPositionCell. One wins, the other fails (cell already consumed). This is the intended structural enforcement of M-06 and works correctly; the UX should surface "second commit denied" cleanly.

**PendingCrossChainCounterCell absence.** A trader's first cross-chain commit for a given (trader, token) needs the counter cell to be created. Mitigation: the commit-cross-chain transaction creates the counter cell with `pending_count = 1` if absent, or increments if present.

**No global pause.** Option B has no "VibeSwapCore.pause()" that halts everything. Each mechanism has its own breaker. Mitigation: the guardian-trip flow for each mechanism is permissioned and can be invoked in parallel across all mechanisms by a guardian script. The "atomic pause" property is not preserved but the "rapid pause" property is.

**Admin operations become multi-tx.** `updateContracts(auction, amm, treasury, router)` becomes four separate cell-dep type-hash updates. Honestly slower; intentionally so.

## Composition with other specs

- **`commit-reveal-auction.md`**: CommitCell + RevealCell + BatchSettlementCell are the load-bearing absorbers of Core's `commitSwap` / `revealSwap` / `settleBatch` flows. M-06 is added as TraderBatchPositionCell, an Option-B-specific cell type that lives alongside the auction cells.

- **`vibe-amm.md`**: PoolCell is consumed during BatchSettlementCell creation. Core's `createPool` translates to a permissionless transaction that creates a new PoolConfigCell + initial PoolCell, with type-script enforcing fee-rate within Lawson bounds. RateLimitCell (Fibonacci damping) absorbs `maxSwapPerHour`.

- **`shapley-distributor.md`**: IncentiveLedgerCell that Core feeds via `_recordExecution` becomes a Shapley-event-cell consumed by the ShapleyDistributor settlement transactions. The try/catch around `incentiveController.recordExecution` dissolves because the ledger-update is an independent transaction.

- **`messaging-hub.md`**: cross-chain commits route through BurnReceiptCell instead of `router.sendCommit`. PendingCrossChainCounterCell is an Option-B-specific addition that lives alongside messaging-hub cells to enforce the C20 interlock.

- **`nci-consensus.md`**: governance authorization for admin operations flows through ProtocolDecisionCell. `setSupportedToken`, `updateContracts`, `setGuardian`, etc. become ProtocolDecisionCell consumptions that authorize specific cell-dep type-hash updates.

- **`lawson-constants.md`**: all constants Core reads (`commitCooldown`, `maxSwapPerHour`, `REFUND_TIMEOUT`, `CHALLENGE_WINDOW`, slash rates, breaker thresholds) live in LawsonConstantsRegistryCell with constitutional bounds, governance-tunable within bounds.

- **`circuit-breaker.md`**: CommitVolumeBreakerCell is an instance of BreakerCell with `mechanism_id = "commit-reveal-auction"` and `signal_type = Volume`. Resume requires attestation + cooldown per the breaker spec.

- **`slash-router.md`**: independent of Core. Same composition pattern (permissionless dispatch, type-script enforces correctness) — orthogonal flow.

- **`pairwise-verifier.md`**: independent of Core.

- **Match-or-beat-CoW extensions** (`batch-cycle-resolver.md`, `multi-curve-amm.md`, `cross-pool-lp.md`, `thin-pool-fee-subsidy.md`, `composable-resolution-paths.md`, `zk-router-verifier.md`): all compose at the BatchSettlementCell layer. Core's role would have been to call a different routing path; Option B lets the settlement-cell type-script select the resolution strategy based on cell-deps present in the transaction. The composability is structural, not orchestrated.

## Open questions

- **Q1**: Does the security overlay need a unified "SecurityPolicyCell" per trader, holding cooldown + rate limit + blacklist-membership + breaker-state, or do those stay as separate cells per concern? Single cell improves locality at the cost of write-contention per trader. Default: separate cells, per Option-B substrate-geometry alignment. Flag for review when implementing.

- **Q2**: Is there a global guardian / governance role that needs an analog of Core's `emergencyPause` covering all mechanisms in one transaction, or is per-mechanism breaker-trip enough? Default: per-mechanism. Flag if operations team needs single-call pause for incident response.

- **Q3**: Where does the cross-chain destination-recipient override live? Currently CommitCell carries `xchain_recipient` per `commit-reveal-auction.md`. Confirm this absorbs the XC-005 smart-contract-wallet-address concern without requiring a Core-equivalent recipient-resolution step.

- **Q4**: Should `vibeswap-ckb-tx-builder` live as a Rust crate, a TypeScript SDK, or both? Both is the honest answer; sequencing question is which ships first. Default: Rust first (mirrors type-script audit boundary), TS shortly after for frontend.

- **Q5**: Confirm that dissolution of Core's deposit pool (Option B has no `deposits[user][token]`; user holds their own sUDT until commit) is acceptable to integrators that today rely on `VibeSwapCore.getDeposit(user, token)`. The equivalent on CKB is querying the trader's lock-script balance via indexer, which is strictly more honest.

- **Q6**: When `executeBatch` is called separately from `settleBatch` on EVM (INT-004), this maps to two separate transactions on CKB by default. Is there an operational reason to want one-transaction-settle-and-execute? Default: separate. Flag if keeper economics suggest otherwise.

## Cross-references

- Architectural statement: `vibeswap/docs/architecture/ckb-sovereign-vibeswap.md`
- Augmentation surface: `vibeswap/contracts-ckb/AUGMENTATION_SURFACE.md`
- Upstream survey: `vibeswap/contracts-ckb/UPSTREAM.md`
- Spec layer: `vibeswap/contracts/core/VibeSwapCore.sol`
- Subsystem specs: `commit-reveal-auction.md`, `vibe-amm.md`, `shapley-distributor.md`, `messaging-hub.md`, `circuit-breaker.md`, `lawson-constants.md`, `slash-router.md`, `nci-consensus.md`
- Mechanism primitives: `[P·structure-does-the-work]`, `[P·substrate-geometry-match]`, `[P·dissolve-attack-surface]`, `[P·substrate-port-pattern]`, `[P·incremental-progressive-manifestation]`
