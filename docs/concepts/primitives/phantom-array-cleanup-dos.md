# Phantom-Array Cleanup-DoS

**Status**: shipped (cycle C48-F2)
**First instance**: `VibeSwapCore.compactFailedExecutions` paginated cleanup
**Convergence with**: `revert-wipes-counter-non-reverting-twin.md`

## The pattern

A bounded-write data structure (write-side capped, e.g., `MAX_FAILED_QUEUE = 1000`) accumulates entries that need periodic cleanup. The cleanup function iterates the structure to remove zeroed / settled / expired entries. The write-side bound was the only DoS-defense; the **cleanup function itself** is unbounded — at the upper end of the queue, a single `compact` call can touch every slot, exceed block gas, and brick the queue.

This is the *cleanup-side child* of the phantom-array antipattern: the obvious DoS surface (write-side) was hardened; the hidden DoS surface (read/cleanup-side) is unprotected. The fix is **not** cap-and-revert (capping the cleanup work just blocks cleanup entirely once the queue is full). The fix is **pagination + idempotent partial-progress**:

```solidity
uint256 public constant MAX_COMPACTION_PER_CALL = 200;

function compact() external {
    uint256 cap = Math.min(queue.length, MAX_COMPACTION_PER_CALL);
    uint256 writeIdx = 0;
    for (uint256 readIdx = 0; readIdx < cap; readIdx++) {
        if (!isZeroed(queue[readIdx])) {
            if (writeIdx != readIdx) queue[writeIdx] = queue[readIdx];
            writeIdx++;
        }
    }
    // Tail-shift unscanned entries to keep array contiguous, then pop slack.
    if (cap < queue.length) {
        for (uint256 i = cap; i < queue.length; i++) {
            queue[writeIdx + (i - cap)] = queue[i];
        }
    }
    uint256 newLen = queue.length - (cap - writeIdx);
    while (queue.length > newLen) queue.pop();
}
```

Each call shrinks the array by exactly the count of zeroed entries observed in this call's scan window. Multiple invocations converge to a fully-compact array. Anyone can re-invoke; idempotent.

## Why it works

The pathology of the phantom-array antipattern is that the SIZE of the structure (the source of DoS) is computed by the read path, not the write path. A bounded write-side does not bound the read-side; the read can still touch every entry.

Pagination splits the unbounded read into a sequence of bounded reads. Each call does at most `MAX_COMPACTION_PER_CALL` work. The work is *durable* — earlier calls do not block later calls — so the array converges over O(N / cap) calls regardless of N's upper bound. This is true forward progress: every call makes the array shorter (by the count of zeroed entries it found), so the queue's compactness is monotonically increasing.

Cap-and-revert, by contrast, fails the cleanup transaction entirely once the queue is too full, leaving the queue stuck. That is *worse* than no protection — it converts a slow degradation into a hard failure.

## Concrete example

From `contracts/core/VibeSwapCore.sol`:

```solidity
/// @notice C48-F2: Maximum entries scanned per `compactFailedExecutions` invocation.
/// @dev With MAX_FAILED_QUEUE=1000, the previous unbounded `compactFailedExecutions`
///      could touch ~1000 storage slots in a single tx (read + conditional write +
///      pop), which exceeds the block gas budget at the upper end. That left the
///      queue with no recourse once full.
uint256 public constant MAX_COMPACTION_PER_CALL = 200;

/**
 * @notice Compact the failedExecutions array by removing zeroed entries.
 * @dev    C48-F2 (gas-griefing): scan window capped at MAX_COMPACTION_PER_CALL. If
 *         more compaction is needed, the caller (or anyone) re-invokes. The algorithm
 *         is idempotent: each call shrinks the array by exactly the count of zeroed
 *         entries seen in this call's scan window. Multiple invocations converge to
 *         a fully-compact array.
 */
function compactFailedExecutions() external {
    uint256 len = failedExecutions.length;
    uint256 cap = len < MAX_COMPACTION_PER_CALL ? len : MAX_COMPACTION_PER_CALL;
    uint256 writeIdx = 0;

    for (uint256 readIdx = 0; readIdx < cap; ) {
        FailedExecution storage entry = failedExecutions[readIdx];
        if (!_isZeroed(entry)) {
            if (writeIdx != readIdx) failedExecutions[writeIdx] = entry;
            unchecked { ++writeIdx; }
        }
        unchecked { ++readIdx; }
    }

    // C48-F2: Tail-shift only the entries WITHIN the scan window.
    // If we scanned the entire array (cap == len), pop the slack;
    // otherwise we must shift the unscanned tail down by `(cap - writeIdx)`
    // to keep the array contiguous before popping.
    // ... (tail shift + pop)
}
```

The contract callers re-invoke the function until convergence. There is no admin role required; cleanup is permissionless.

## When to use

- A data structure has a bounded write-side but an unbounded cleanup / read / scan.
- The cleanup is a maintenance operation, not a per-transaction invariant — it can run across multiple blocks without correctness issues.
- The structure is used at runtime in operations where its size matters for gas (e.g., consumed by other contracts).

## When NOT to use

- The structure must be fully-compact synchronously for correctness (e.g., a per-block invariant). Then either bound the structure tightly or design the consumer to tolerate non-compact reads.
- The cleanup is naturally bounded by the protocol (e.g., queue grows by at most 1 per block, cleanup runs every block). Pagination is unnecessary.
- A simple cap-and-revert is acceptable because the queue can be rebuilt or the cap is high enough that reverts are expected to be rare and recoverable. (This is rarely the right call — cap-and-revert is the pathology, not the cure.)

## Related primitives

- [`revert-wipes-counter-non-reverting-twin.md`](./revert-wipes-counter-non-reverting-twin.md) — both primitives are about *not letting the EVM's failure modes break observability or maintenance*.
- [First-Available Trap](../FIRST_AVAILABLE_TRAP.md) — the parent failure-mode where the first-available shape (cap-and-revert) is convenient but wrong.
