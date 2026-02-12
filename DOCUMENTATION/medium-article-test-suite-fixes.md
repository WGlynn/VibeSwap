# Fixing 34 Failing Solidity Tests: A War Story from the VibeSwap Test Suite

We recently hit a milestone on VibeSwap — our omnichain DEX built on LayerZero V2 — where 379 out of 413 Foundry tests were passing, but 34 stubbornly refused to go green. Rather than ignoring them or marking them as skipped, we systematically diagnosed and fixed every single one.

Here's what we found, what we learned, and the patterns that might save you hours of debugging on your own Solidity projects.

---

## The Setup

VibeSwap's test suite spans unit tests, fuzz tests, integration tests, stress tests, and game theory simulations across 27 test files. The contracts use OpenZeppelin v5 with UUPS upgradeable proxies, and the core mechanism is a commit-reveal batch auction that settles trades at uniform clearing prices to eliminate MEV.

After a major backend hardening sprint, we ran the full suite and found 34 failures clustered into four distinct categories. Each category had a single root cause that cascaded across multiple test files.

---

## Category 1: Flash Loan Detection False Positives (8 tests)

**Symptom:** Tests reverting with `FlashLoanDetected` when no flash loan was happening.

**Root cause:** Our `CommitRevealAuction` contract has a flash loan guard:

```solidity
if (lastInteractionBlock[msg.sender] == block.number) {
    revert FlashLoanDetected();
}
lastInteractionBlock[msg.sender] = block.number;
```

The problem? When multiple commits route through `VibeSwapCore` (the orchestrator), `msg.sender` inside the auction isn't the individual trader — it's `address(core)`. Two traders committing in the same block both appear as the same sender, triggering the flash loan check.

**The fix seemed simple:** Add `vm.roll(block.number + 1)` between commits in tests. But here's where it got interesting.

### The Foundry Nightly Bug

On our build environment (Foundry nightly on MINGW64/Windows), `vm.roll(block.number + 1)` doesn't work reliably. Both rolls evaluate to `vm.roll(2)` because `block.number` doesn't reflect the previous `vm.roll` call within the same test execution context. The trace confirmed it:

```
├─ [0] VM::roll(2)    // First roll
├─ [0] VM::roll(2)    // Second roll — should be 3, but block.number still returns 1
```

**Actual fix:** Use absolute block numbers instead of relative ones:

```solidity
vm.roll(10);   // First commit
// ... commit ...
vm.roll(20);   // Second commit — guaranteed different block
```

For loops with many commits:
```solidity
for (uint256 i = 0; i < numTraders; i++) {
    vm.roll(100 + i * 100);
    // ... commit ...
}
```

**Lesson:** Never trust `block.number` or `block.timestamp` as inputs to `vm.roll()` or `vm.warp()` in the same test. Use absolute values. This also affects `vm.warp(block.timestamp + x)` — we hit the exact same issue later with timestamp-dependent freshness checks.

---

## Category 2: Access Control Mismatch (13 tests)

**Symptom:** 13 tests across clawback resistance and Sybil resistance suites reverting with `NotActiveAuthority`.

**Root cause:** Our `FederatedConsensus` contract had an `onlyActiveAuthority` modifier on `createProposal()`:

```solidity
function createProposal(...) external onlyActiveAuthority returns (bytes32) {
```

But `createProposal` is called by `ClawbackRegistry` (the executor contract), not directly by human authorities. Inside `FederatedConsensus`, `msg.sender` is `address(registry)` — which isn't registered as an authority.

The registry already validates that the caller is an authorized authority before forwarding the call. The consensus contract was double-checking with the wrong identity.

**Fix:** Replace the modifier with an inline check that allows the executor, owner, or active authorities:

```solidity
function createProposal(...) external returns (bytes32) {
    if (msg.sender != executor && msg.sender != owner() && !authorities[msg.sender].active) {
        revert NotActiveAuthority();
    }
    // ...
}
```

**Bonus bugs in the same test file:**

- A test's `setUp()` was missing the `ClawbackVault` deployment entirely, causing `VaultNotSet` errors downstream
- A governance vote ordering issue: the SEC's rejection vote was placed *after* the 3/5 approval threshold was already met, meaning the proposal was already `APPROVED` and the vote reverted with `ProposalNotPending`

**Lesson:** When contracts call other contracts, trace `msg.sender` through the entire call chain. The identity at each hop matters for access control. And test `setUp()` functions deserve as much scrutiny as the tests themselves.

---

## Category 3: Stale String Reverts and Wrong Assertions (6 tests)

**Symptom:** A mix of `vm.expectRevert("string")` failures and incorrect balance/fee assertions.

This category was a grab bag of three sub-issues:

### 3a: String Reverts vs Custom Errors

The contracts had been upgraded to Solidity custom errors, but some tests still expected string reverts:

```solidity
// Old (broken):
vm.expectRevert("Wrong batch");
vm.expectRevert("Not slashable");
vm.expectRevert("Activity score exceeds max");

// Fixed:
vm.expectRevert(CommitRevealAuction.WrongBatch.selector);
vm.expectRevert(CommitRevealAuction.NotSlashable.selector);
vm.expectRevert(ShapleyDistributor.ScoreExceedsMax.selector);
```

### 3b: Fee Accounting with PROTOCOL_FEE_SHARE = 0

Our AMM has `PROTOCOL_FEE_SHARE = 0`, meaning all trading fees go to LP reserves (increasing k in the constant product formula) rather than to an `accumulatedFees` mapping. Two tests were asserting `accumulatedFees > 0` after trades.

**Fix:** Check that k increased instead:

```solidity
IVibeAMM.Pool memory poolAfter = amm.getPool(poolId);
uint256 kAfter = poolAfter.reserve0 * poolAfter.reserve1;
assertGt(kAfter, kBefore, "Fees should increase k");
```

### 3c: Slippage Rejection Doesn't Auto-Return Tokens

A test expected that when a batch fails due to slippage, the trader's tokens would be automatically returned. They aren't — tokens stay in the AMM contract and require explicit withdrawal. The assertion checking `balanceAfter == balanceBefore + depositAmount` was wrong; it should check `balanceAfter == balanceBefore`.

**Lesson:** When protocol parameters change (like fee shares), grep for every test that asserts on the old behavior. And always verify your mental model of token flow against the actual contract logic.

---

## Category 4: Oracle Ring Buffer Bug + Auth Issues (7 tests)

This was the most interesting category because it included an actual **contract bug**, not just test issues.

### The Ring Buffer Off-by-One

Our `StablecoinFlowRegistry` tracks a rolling average of USDT/USDC flow ratios using a ring buffer:

```solidity
uint8 nextIndex = (historyIndex + 1) % HISTORY_SIZE;
flowRatioHistory[nextIndex] = FlowObservation({...});
historyIndex = nextIndex;
if (historyCount < HISTORY_SIZE) historyCount++;
```

The `_calculateAverage()` function iterated from index 0:

```solidity
// BUG: iterates from 0, but first write goes to index 1
for (uint8 i = 0; i < historyCount; i++) {
    sum += flowRatioHistory[i].ratio;
}
```

Since `historyIndex` starts at 0 (Solidity default), the first write goes to index 1. But the average calculation reads from index 0 — which is still zero-initialized. After three updates (values 1.0, 2.0, 3.0 stored at indices 1, 2, 3), the average reads indices 0, 1, 2 and computes `(0 + 1.0 + 2.0) / 3 = 1.0` instead of the correct `(1.0 + 2.0 + 3.0) / 3 = 2.0`.

**Fix:** Walk backwards from `historyIndex` to read the actually-populated entries:

```solidity
for (uint8 i = 0; i < historyCount; i++) {
    uint8 idx = (historyIndex + HISTORY_SIZE - i) % HISTORY_SIZE;
    sum += flowRatioHistory[idx].ratio;
}
```

### Missing Authorization in Oracle Tests

Three tests called `registry.updateFlowRatio()` without `vm.prank(signer)`. The registry requires authorized updaters, and the test contract wasn't registered as one. Simple fix: add `vm.prank(signer)` before each call.

### Registry Override in Context Test

`test_updateStablecoinContext` updated the oracle's *local* stablecoin context via a signed message, then called `getStablecoinContext()` expecting to read it back. But `getStablecoinContext()` preferentially reads from the connected `StablecoinFlowRegistry` if one is set — and the test setUp connected them. The local update was being ignored.

**Fix:** Disconnect the registry at the start of the test:

```solidity
oracle.setStablecoinRegistry(address(0));
```

**Lesson:** Ring buffers are deceptively tricky. The write index and read index must be consistent. Always test with at least 3 values and verify the average manually. And when a contract has multiple data sources with priority logic, test each source in isolation.

---

## The Final Score

| Category | Root Cause | Tests Fixed |
|----------|-----------|-------------|
| Flash loan detection | `msg.sender` identity through proxy + Foundry vm.roll bug | 8 |
| Access control | Modifier checked caller identity, not forwarded identity | 13 |
| String reverts + assertions | Stale test expectations after contract upgrades | 6 |
| Oracle ring buffer | Off-by-one in averaging + missing auth pranks | 7 |

**Before: 379/413 passing. After: 413/413 passing.**

Four commits. Three test-only fixes. One real contract bug caught and fixed before deployment.

---

## Takeaways

1. **Categorize before you fix.** Grouping 34 failures into 4 root causes turned an overwhelming problem into four focused debugging sessions.

2. **Trace `msg.sender` through the call chain.** In a system with proxy contracts and orchestrators, the identity at each hop changes. Access control modifiers need to account for this.

3. **Use absolute values in Foundry cheatcodes.** `vm.roll(block.number + 1)` and `vm.warp(block.timestamp + x)` can silently fail on certain Foundry builds. Absolute values are deterministic and portable.

4. **Ring buffers need careful index management.** If your write index starts at `(default + 1)`, your read loop starting at `default` will include uninitialized data. Always walk backwards from the most recent write.

5. **Tests catch contract bugs, but only if the tests are correct.** The ring buffer bug would have shipped to production if we hadn't fixed the test that was (correctly) catching it. Failing tests aren't just noise — sometimes they're the canary.

---

*VibeSwap is an omnichain DEX built on LayerZero V2 that eliminates MEV through commit-reveal batch auctions with Shapley value-based reward distribution. The full test suite runs 413 tests including fuzz tests, invariant tests, and game theory simulations.*
