# XCM-Pattern Applicability Audit — VibeSwap Cross-Chain + Oracle

**Date**: 2026-05-01
**Trigger**: Polkadot/XCM disclosure — `InitiateTransfer` instruction silently fell through (`preserve_origin=true ∧ origin=None`) instead of reverting with `BadOrigin`. Outbound message arrived at Asset Hub carrying the *transport sender's* origin (Parachain(1000)), and Asset Hub's `LocationAsSuperuser` config let any signed account get root on the relay chain. Root cause: a refactor (PR #7423) that itself fixed an earlier audit-flagged `UnpaidExecution` issue replaced an explicit `Err(BadOrigin)` with a no-op fall-through.
**Scope**: Read-only scan of VibeSwap cross-chain + oracle code for the same structural failure mode — Solidity equivalents of "if-Some / no-else / silent fall-through that leaves security state at a permissive default."
**Method**: Per-file end-to-end read, classify each candidate as (a) safe / (b) needs-attention / (c) actual-finding. Every silent-skip / try-catch / origin-default site checked against the question: *"if X were the XCM bug, what would the attacker do?"*

---

## File: `contracts/messaging/CrossChainRouter.sol` (1212 LOC, primary in-scope)

### Origin handling — `lzReceive` (line 588–618)

```solidity
function lzReceive(Origin calldata _origin, bytes32 _guid, bytes calldata _message, ...)
    external onlyEndpoint rateLimited(_origin.srcEid) nonReentrant {
    // Verify sender is a peer
    if (peers[_origin.srcEid] != _origin.sender) revert InvalidPeer();
    // Check replay
    if (processedMessages[_guid]) revert AlreadyProcessed();
    processedMessages[_guid] = true;
    // Decode and process message
    (MessageType msgType, bytes memory payload) = abi.decode(_message, (MessageType, bytes));
    if (msgType == MessageType.ORDER_COMMIT) { _handleCommit(payload, _origin.srcEid); }
    else if (...) { ... }
    else { revert InvalidMessage(); }
}
```

- **File:line**: `CrossChainRouter.sol:588–618`
- **Pattern**: Origin-of-message handling; structural origin enforcement.
- **Classification**: **SAFE**.
- **Attacker reasoning (if XCM-style bug existed here)**: An attacker would attempt to land a message at this contract carrying a forged `_origin.sender` claiming to be a trusted peer, hoping the dispatch logic trusted the field without re-verification. They would also attempt to inject a `MessageType` outside the enum to trigger silent fall-through.
- **Why safe**:
  1. `onlyEndpoint` modifier rejects calls not from the canonical LZ endpoint — only the endpoint can deliver `_origin`.
  2. `if (peers[_origin.srcEid] != _origin.sender) revert InvalidPeer()` — explicit revert, not silent skip. The origin field IS verified by structure: every payload MUST carry an `srcEid + sender` pair that exact-matches a configured peer. There is no "fall back to msg.sender" or "fall back to authorized list."
  3. Unknown `MessageType` hits the explicit `else { revert InvalidMessage(); }` — no silent dispatch fall-through.
  4. Replay guard (`processedMessages[_guid]`) marked BEFORE handler dispatch — closes re-entry replay.

### `_handleReveal` empty/lossy try-catch (line 696–746)

```solidity
try auctionContract.revealOrderCrossChain{...}(...) {
    delete pendingCommits[reveal.commitId];
} catch {
    emit CrossChainRevealFailed(reveal.commitId, srcEid, "Reveal rejected");
}
emit CrossChainRevealReceived(reveal.commitId, srcEid);
```

- **File:line**: `CrossChainRouter.sol:728–746`
- **Pattern**: Try-with-empty-catch (XCM-analog: `if let Some(...) {...}` no else).
- **Classification**: **SAFE**.
- **Attacker reasoning**: Attacker sends a malformed reveal hoping the catch swallows the error AND advances state in a way that grants them output without completing the auction-side reveal. Or: attacker forces the reveal to revert and replays it later when state has changed in their favor.
- **Why safe**:
  1. The catch path does NOT advance any settlement state. `pendingCommits[reveal.commitId]` is deleted ONLY in the success branch (line 739). On catch, the commit stays pending, available for either retry or eventual expiry/claim.
  2. No deposit flag flips on the catch. `bridgedDepositFunded[reveal.commitId]` was already true (gate at line 707 already passed); the catch leaves it true, which is correct — funds were genuinely received and remain claimable via `recoverExpiredDeposit` after `bridgedDepositExpiry`.
  3. Replay guard on `_guid` (set in `lzReceive` before dispatch) prevents the same LZ message from being re-delivered. The catch only swallows the auction-side revert, not the LZ-channel state machine.
  4. **Material distinction from XCM bug**: in the XCM case, the silent skip *changed* the outbound origin to a permissive default. Here, the silent skip *preserves* the prior pending state — fall-through state is the conservative state, not the permissive one.

### `_handleBatchResult` / `_handleSettlementConfirm` try-catch (lines 768–796, 808–826)

```solidity
try IVibeSwapCoreSettlement(vibeSwapCore).settleCrossChainOrder(commitHash, result.poolId, estimatedOut) {
    if (settlementFailed[commitHash]) { settlementFailed[commitHash] = false; ... }
} catch (bytes memory reason) {
    settlementFailed[commitHash] = true;
    failedSettlementEstimatedOut[commitHash] = estimatedOut;
    failedSettlementPoolId[commitHash] = result.poolId;
    emit SettlementMarkFailed(commitHash, reason);
}
```

- **File:line**: `CrossChainRouter.sol:768–796` and `808–826`
- **Pattern**: Try-with-non-empty-catch that records failure for retry.
- **Classification**: **SAFE** — and this is the closest VibeSwap analog to the XCM bug class. The contract already underwent the audit (see git: `a04bf05d` "RSI C15 — supply-conservation + cross-chain settlement density scan").
- **Attacker reasoning (counterfactual)**: The pre-C15-AUDIT-1 version of this code had an empty catch — an attacker could deliberately make `settleCrossChainOrder` revert (transient pause, `CrossChainOrderAlreadySettled` replay, OOG within the LZ-side gas budget), causing the silent swallow to leave `deposits[trader][tokenIn]` un-decremented on source. Trader then calls `VibeSwapCore.withdrawDeposit(token)` on source while having already received output on destination. Classic cross-chain double-spend.
- **Why safe now**:
  1. C15-AUDIT-1 fix: catch records `settlementFailed[commitHash] = true` + caches `(poolId, estimatedOut)` so the failed settlement is **observable** on-chain.
  2. Permissionless `retrySettlementOrder(commitHash)` / `retrySettlementMark(commitHash)` (lines 839–872) lets anyone monitoring `SettlementMarkFailed` close the window.
  3. **Acknowledged residual surface** (per the in-source comment at lines 203–207): until `VibeSwapCore.withdrawDeposit` reads `settlementFailed`, there is still a `[BatchResult-received → next retry]` window. This is documented and bounded, not silent. **Not a finding** under XCM-pattern criteria — the silent-fall-through behavior was already removed.

### `_handleLiquiditySync` rate-of-change reject (line 877–906)

```solidity
if (delta0 > maxDelta0 || delta1 > maxDelta1) {
    emit LiquiditySyncRejected(sync.poolId, srcEid, ...);
    return; // Silently reject — don't revert the LZ message
}
liquidityState[sync.poolId] = sync;
```

- **File:line**: `CrossChainRouter.sol:894–900`
- **Pattern**: `if (precondition) { skip update + emit; return }` — early return on policy violation rather than revert.
- **Classification**: **SAFE**.
- **Attacker reasoning**: Compromised peer attempts to spoof a >50% reserve change — does the silent reject leave any caller-controllable state at a permissive default?
- **Why safe**: The early-return path deliberately does NOT update `liquidityState[sync.poolId]`. The fall-through state is the *prior validated state*, not a default. The attacker gains nothing — they cannot poison liquidity with one shot, and the LZ channel stays alive (per the in-source rationale). The gate is `if-violation { return }`, not `if-valid { update }` with an implicit fall-through, so the order of conditional vs default is structurally inverted from the XCM bug pattern.

### `recoverExpiredDeposit` funded/unfunded branch (line 1118–1169)

```solidity
if (isFunded) {
    totalBridgedDeposits -= depositAmount;
    claimableDeposits[commitId] = depositAmount;
    address escrowOwner = commit.destinationRecipient != address(0)
        ? commit.destinationRecipient
        : commit.depositor; // Backwards compat: fallback to depositor
    claimableDepositOwner[commitId] = escrowOwner;
    ...
} else {
    // UNFUNDED: ETH never arrived — only clean up accounting.
    emit CrossChainCommitExpired(...);
}
```

- **File:line**: `CrossChainRouter.sol:1140–1166`
- **Pattern**: Recipient default — `destinationRecipient ?? depositor`.
- **Classification**: **SAFE**.
- **Attacker reasoning**: Could an attacker get themselves named as the escrow owner via a manipulated `destinationRecipient`?
- **Why safe**: `destinationRecipient` is set at commit-time on the source chain (line 808 in `VibeSwapCore.sol`) and ferried in the `CrossChainCommit` payload. The signed message contents are integrity-checked via the LZ peer/replay gates. The fallback to `depositor` only fires when `destinationRecipient == address(0)`, which is a deliberate backwards-compat path; both options are user-controlled at commit time, not attacker-controlled. The downstream `claimExpiredDeposit` (line 1180) further requires `msg.sender == owner() || msg.sender == claimableDepositOwner[commitId]` — explicit revert on mismatch, no silent fall-through to `msg.sender == recipient`. The author specifically called out that they did NOT use `msg.sender == recipient` (NEW-04 vuln) at lines 1186–1187.

### `sendCommit` recipient default (line 348–405)

```solidity
require(depositor != address(0), "Invalid depositor");
if (destinationRecipient == address(0)) destinationRecipient = depositor;
```

- **File:line**: `CrossChainRouter.sol:358–360`
- **Pattern**: Default-to-depositor if recipient zero.
- **Classification**: **SAFE**.
- **Attacker reasoning**: Caller passes `depositor=victim, destinationRecipient=address(0)`, hoping the contract defaults destinationRecipient to victim's address but then settles to caller via some other path.
- **Why safe**: Caller is gated by `onlyAuthorized` (line 355), so only `VibeSwapCore` (and any other explicitly-authorized contract) can invoke. `VibeSwapCore.commitCrossChainSwap` (line 808) passes `msg.sender` as `depositor`, so the depositor is the original user who initiated the swap. Default fall-through is to that same depositor — consistent with the conservative interpretation, not a permissive one.

---

## File: `contracts/oracles/IssuerReputationRegistry.sol` (316 LOC)

- No cross-chain message handling.
- `slashIssuer` correctly uses `onlySlasher` modifier with explicit revert (line 95). No silent fall-through on unauthorized callers.
- Reputation decay (`_decayedReputation`, line 296) uses pure math — no permission state at risk.
- `touchReputation` (line 256) intentionally does NOT auto-reactivate SLASHED_OUT issuers (comment at line 265–267 documents this) — opposite of the XCM bug pattern (here the conservative state is preserved by design).
- **Classification**: **SAFE — no candidates matching the XCM pattern.**

---

## File: `contracts/oracles/OracleAggregationCRA.sol` (279 LOC)

### `_isAuthorizedIssuer` permissive stub (line 145–151)

```solidity
function _isAuthorizedIssuer(address /*issuer*/) internal view returns (bool) {
    // V1 permissive: any non-zero registry presence allows.
    // Replaced with real registry check in next commit.
    return issuerRegistry != address(0);
}
```

- **File:line**: `OracleAggregationCRA.sol:147–151`
- **Pattern**: Stub-with-permissive-default. NOT structurally identical to the XCM bug (no silent fall-through; the function explicitly returns `true` for any caller when the registry pointer is set), but the spirit is similar: a security check that defaults open.
- **Classification**: **NEEDS-ATTENTION** (pre-existing, documented stub — not introduced by a refactor).
- **Attacker reasoning**: As long as `issuerRegistry != address(0)`, ANY address can `commitPrice` and `revealPrice` to influence the median. They would need to spam ≥3 reveals (`MIN_REVEALS_FOR_SETTLEMENT`) to push a manipulated median to TPO via `pullFromAggregator`.
- **Mitigations already present**:
  1. Median computation (`settleBatch`, line 179) is robust to outliers if honest reveals exceed manipulator count.
  2. `pullFromAggregator` in TPO requires `block.timestamp <= batch.revealDeadline + MAX_STALENESS` (TPO line 469–472, C49-F1 fix) — bounded freshness window.
  3. `_validatePriceJump` in TPO (line 638–645) caps single-update price jump at `MAX_PRICE_JUMP_BPS = 1000` (10%).
- **Why this is NOT the XCM-pattern finding**: The permissive default is **intentional and documented** (V1 stub, marked "Replaced with real registry check in next commit"). It is not a refactor that silently dropped a security check; it is a known-incomplete authorization gate awaiting wiring. The XCM bug class is about *unintended* silent fall-through introduced by a refactor.
- **Recommendation**: Track to closure as part of normal C39 FAT-AUDIT-2 follow-up (already on roadmap per commit history). Not an XCM-pattern finding requiring a separate cycle. **Flagged here for visibility, not as exploitable-via-XCM-pattern.**

### Other oracle paths

- `commitPrice` (line 126), `revealPrice` (line 153), `settleBatch` (line 179), `slashNonRevealer` (line 216): all use explicit `require(...)` with revert. No try-catch with silent fall-through. No origin-default.
- `sweepSlashPoolToTreasury` early-returns on zero pool (`if (amount == 0) return;` line 273) — safe; pre-zero state is the conservative one.
- **Classification**: **SAFE** with one stub flagged above.

---

## File: `contracts/oracles/StablecoinFlowRegistry.sol` (423 LOC)

- All update paths gated with `if (!authorizedUpdaters[...]) revert Unauthorized();` — explicit revert (lines 295, 306).
- EIP-712 signature verification path (`_verifySignature`, line 386) uses fork-aware domain separator (C37-F1-TWIN). No silent acceptance of replayed signatures.
- Nonce check uses `if (nonce != updaterNonces[signer]) revert InvalidNonce();` — explicit (line 307).
- No cross-chain origin handling. No try-catch.
- **Classification**: **SAFE — no candidates matching the XCM pattern.**

---

## File: `contracts/oracles/TruePriceOracle.sol` (742 LOC)

### `getStablecoinContext` registry preference (line 228–239)

```solidity
function getStablecoinContext() external view override returns (StablecoinContext memory) {
    if (address(stablecoinRegistry) != address(0)) {
        return StablecoinContext({...});  // pull from registry
    }
    return stablecoinContext;  // fall back to internal
}
```

- **File:line**: `TruePriceOracle.sol:228–239`, mirrored at `_getStablecoinContext` (line 626).
- **Pattern**: `if (registry != 0) { use registry } else { use internal }` — registry preference with internal fallback.
- **Classification**: **SAFE**.
- **Attacker reasoning**: Could the silent fall-through to internal `stablecoinContext` give the attacker a more permissive state than the registry would?
- **Why safe**: Both branches return a `StablecoinContext`. The internal `stablecoinContext` was set at init to a neutral baseline (`PRECISION` = 1.0 ratio, both dominance flags false, multiplier = 1.0) and only mutated by `updateStablecoinContext` (which itself requires authorized signer + nonce + deadline + signature). There is no permissive default — both branches require explicit prior authorization to set values. The attacker has no path to control which branch fires (they cannot wipe `stablecoinRegistry` to address(0); only owner can via `setStablecoinRegistry`).

### `pullFromAggregator` permissionless pull (line 454–496)

- **File:line**: `TruePriceOracle.sol:454–496`
- **Pattern**: Permissionless price pull from aggregator.
- **Classification**: **SAFE**.
- **Attacker reasoning**: Can an attacker pull a stale or favorable batch into TPO?
- **Why safe**: Three explicit gates with revert:
  1. `require(oracleAggregator != address(0), "Aggregator unset")` — line 455.
  2. `require(batch.phase == ...SETTLED, "Batch not settled")` — line 458.
  3. `require(batch.medianPrice > 0, "Zero median")` — line 459.
  4. `require(block.timestamp <= batch.revealDeadline + MAX_STALENESS, "Batch too stale")` — line 469 (C49-F1 fix, explicitly added to prevent stale-batch attack).
  5. `require(newData.timestamp > truePrices[poolId].timestamp, "Stale or replay")` — line 489.
- All gates are explicit `require` with revert. No silent fall-through.

### `updateTruePriceBundle` issuer verification (line 501–545)

- All gates explicit-revert: `UnsupportedBundleVersion`, `IssuerRegistryNotSet`, `StablecoinContextMismatch`, `IssuerNotActive`, `InvalidNonce`, `ExpiredSignature`. No silent skip.
- **Classification**: **SAFE.**

### Admin setters (`setStablecoinRegistry`, `setIssuerRegistry`, `setOracleAggregator`)

- All `onlyOwner`. None silently update. All emit observability events.
- **Classification**: **SAFE.**

---

## File: `contracts/oracles/VibeOracleRouter.sol` (560 LOC)

### `_aggregatePrice` circuit-breaker early return (line 316–325)

```solidity
if (deviation > deviationThreshold) {
    circuitBroken[feedId] = true;
    emit CircuitBreakerTripped(feedId, deviation);
    return;
}
```

- **File:line**: `VibeOracleRouter.sol:320–324`
- **Pattern**: Early return on circuit-breaker trip.
- **Classification**: **SAFE**.
- **Attacker reasoning**: Trip the breaker to halt updates and force consumers to use stale prices.
- **Why safe**: The early-return path explicitly *sets* `circuitBroken[feedId] = true`, which causes downstream `getPrice` to revert with `CircuitBreakerActive` (line 419) — consumers cannot read the stale price as if it were live. The attacker gains DoS but cannot extract value from a permissive default. (DoS-via-tripping is a separate orthogonal concern, not an XCM-pattern finding.)

### `claimRewards` push-call check (line 494–504)

```solidity
(bool success, ) = provider.call{value: amount}("");
if (!success) revert NoRewardsAvailable();
```

- **File:line**: `VibeOracleRouter.sol:500–501`
- **Pattern**: Reverts on transfer failure (per the audit task's pattern #2 — this is the *correct* form).
- **Classification**: **SAFE.**

- No cross-chain origin handling. No try-catch with silent state advance.
- **Classification**: **SAFE — no candidates matching the XCM pattern.**

---

## File: `contracts/oracles/VolatilityOracle.sol` (386 LOC)

### `updateVolatility` early-return on price-zero / too-soon (line 150–186)

```solidity
uint256 currentPrice = _getCurrentPrice(poolId);
if (currentPrice == 0) return;
...
if (block.timestamp < lastTimestamp + OBSERVATION_INTERVAL) {
    return; // Too soon for new observation
}
```

- **File:line**: `VolatilityOracle.sol:155, 162–164`
- **Pattern**: Early-return on no-new-data.
- **Classification**: **SAFE**.
- **Attacker reasoning**: Force an early return to suppress volatility updates and lock the cached tier at LOW for fee-multiplier abuse.
- **Why safe**: The early-return paths do not advance any security state. The cache `data.cachedVolatility` is only used inside `getVolatilityData` view path; production fee multipliers are derived from `_calculateVolatility` directly (line 360) which recomputes from observations on every read. The early-return path leaves the prior valid observation buffer intact — fall-through state is conservative.

### `_getCurrentPrice` try-catch (line 329–335)

```solidity
function _getCurrentPrice(bytes32 poolId) internal view returns (uint256 price) {
    try vibeAMM.getSpotPrice(poolId) returns (uint256 spotPrice) {
        return spotPrice;
    } catch {
        return 0;
    }
}
```

- **File:line**: `VolatilityOracle.sol:329–335`
- **Pattern**: Try with empty-catch returning zero.
- **Classification**: **SAFE**.
- **Attacker reasoning**: Force `getSpotPrice` to revert so the catch returns 0, then exploit the zero-price downstream.
- **Why safe**: Returning 0 from `_getCurrentPrice` causes the upstream `updateVolatility` to early-return at line 155 (`if (currentPrice == 0) return;`) — no observation gets recorded with a zero price, so downstream variance calculations are not poisoned. The fall-through state is *no observation*, which is conservative.

- **Classification**: **SAFE.**

---

## File: `contracts/core/VibeSwapCore.sol` (1881 LOC, scoped to cross-chain settlement only)

### `markCrossChainSettled` / `settleCrossChainOrder` authorization (lines 878–905)

```solidity
function markCrossChainSettled(bytes32 commitHash) external {
    require(msg.sender == owner() || msg.sender == address(router), "Only owner or router");
    _settleSourceChainOrder(commitHash);
}
function settleCrossChainOrder(bytes32 commitHash, bytes32 poolId, uint256 estimatedOut) external {
    require(msg.sender == owner() || msg.sender == address(router), "Only owner or router");
    ...
}
```

- **File:line**: `VibeSwapCore.sol:878–905`
- **Pattern**: Caller authorization for settlement.
- **Classification**: **SAFE**.
- **Attacker reasoning**: Bypass the require to settle an arbitrary commit hash, marking it SETTLED while still claiming the source-chain deposit elsewhere.
- **Why safe**: Explicit `require` revert. No fall-through to alternative auth path. `msg.sender` is *not* used as a fallback — it is used as the authorization check itself. There is no XCM-style "if X then explicit-auth, else implicit-msg.sender" — both branches are within the explicit `require`.

### `_settleSourceChainOrder` state-transition (line 913–932)

- All preconditions (`order.trader == address(0)`, `order.status == SETTLED|REFUNDED`) explicit-revert.
- The `pendingCrossChainCount` decrement is guarded `if > 0` to avoid underflow on orphaned orders — early-skip path is conservative (does not leak permissive state); just skips the decrement on already-zero counter.
- **Classification**: **SAFE.**

### `_recordCrossChainExecution` swallow-and-queue catches (line 938–961)

```solidity
try incentiveController.recordExecution(...) {} catch (bytes memory reason) {
    emit ExecutionTrackingFailed(poolId, trader, reason);
    _queueFailedExecution(...);
}
try clawbackRegistry.recordTransaction(...) {} catch (bytes memory reason) {
    emit ComplianceCheckFailed(poolId, trader, reason);
}
```

- **File:line**: `VibeSwapCore.sol:946–960`
- **Pattern**: Try-with-non-empty-catch.
- **Classification**: **NEEDS-ATTENTION** for the second catch (compliance), **SAFE** for the first.
- **Attacker reasoning**: Force `clawbackRegistry.recordTransaction` to revert (e.g., gas-griefing, paused registry). The catch swallows the revert and emits `ComplianceCheckFailed` — but does NOT queue for retry. Settlement proceeds. The trader's transaction is now invisible to compliance.
- **Why this is NOT a structural XCM-style finding (but worth noting)**:
  1. The settlement state has already been finalized in `_settleSourceChainOrder` BEFORE this catch runs. The catch does not advance any unauthorized state — it only loses an *observability* signal (compliance recording).
  2. There is no permissive default being granted to a caller. The compliance failure is observable on-chain via `ComplianceCheckFailed` event; off-chain monitoring can re-run compliance checks against the emitted data.
  3. Contrast with the XCM bug: the XCM silent-skip changed the *authorization context* for the next dispatch step. Here, the silent-skip preserves the authorization context and only loses a non-load-bearing log.
- **Recommendation**: Consider symmetric retry-queue treatment to match the `incentiveController` catch (which already calls `_queueFailedExecution`). Track in normal compliance-hardening backlog. **Not an XCM-pattern finding requiring an immediate cycle.**

---

## Summary

| Classification          | Count | Items                                                                                                                                                                                                                                              |
|-------------------------|-------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Actual finding**      | **0** | (none)                                                                                                                                                                                                                                             |
| **Needs-attention**     | **2** | `OracleAggregationCRA._isAuthorizedIssuer` (V1 permissive stub, documented + roadmapped); `VibeSwapCore._recordCrossChainExecution` clawback catch (loses compliance log, settlement state already final — observability gap, not authorization gap) |
| **Safe** (XCM-class)    | ~14   | All `lzReceive` origin paths, all try-catches in `_handleReveal` / `_handleBatchResult` / `_handleSettlementConfirm` (post-C15-AUDIT-1), all oracle origin/sig-verification paths, both `markCrossChainSettled` / `settleCrossChainOrder` authorizations, recipient defaults in `sendCommit` / `recoverExpiredDeposit` / `claimExpiredDeposit`. |

### Verdict: **CLEAN PASS** with respect to XCM-pattern applicability.

VibeSwap's cross-chain message receive paths verify origin **by structure** (`onlyEndpoint` + `peers[srcEid] != sender → revert InvalidPeer`), not by convention. There is no silent fall-through that leaves a security-critical state at a permissive default. The closest structural analog (the C15-AUDIT-1 case in `_handleBatchResult` / `_handleSettlementConfirm`) was *previously* an empty catch that produced a bookkeeping inconsistency exploitable as a cross-chain double-spend, and was already remediated 2026-04-16 by recording `settlementFailed[commitHash]` plus exposing permissionless retry. Acknowledged residual surface (`VibeSwapCore.withdrawDeposit` not yet reading `settlementFailed`) is documented in-source and bounded by retry availability — explicitly not silent.

The two **needs-attention** items are not XCM-pattern findings:
- The `OracleAggregationCRA` stub is a known-incomplete check awaiting wiring (intentional, documented, on roadmap), not an unintended refactor regression.
- The `VibeSwapCore` clawback catch loses an observability signal but does not advance any unauthorized state — settlement finalization happens before the catch fires, and the compliance gap is observable on-chain via the emitted event.

### Recommendations
1. **No follow-up cycle required** for XCM-pattern remediation.
2. **Existing roadmap items** to track (NOT escalated by this audit):
   - Wire `OracleAggregationCRA._isAuthorizedIssuer` to `IssuerReputationRegistry` (already in C39 FAT-AUDIT-2 followups).
   - Symmetric retry-queue treatment for the `_recordCrossChainExecution` clawback catch (compliance hardening backlog).
   - Add `settlementFailed` read to `VibeSwapCore.withdrawDeposit` to fully close the C15-AUDIT-1 residual window (already documented in-source).
3. **Add an XCM-style structural-skip rule** to the standing audit checklist:
   > For every silent early-return / empty-catch / `if (registry != 0)` fallback, ask: *"if execution silently continues here, what is the resulting authorization state, and is it the conservative default or the permissive default?"* The bug class is when the silent path leaves caller in a *more-trusted* state than the explicit path would.

---

*Audit performed read-only. No `.sol` files modified. No tests run. Suggested commit: `docs(audit): XCM-pattern applicability sweep on cross-chain + oracle code (post-Polkadot-disclosure 2026-05-01)`.*
