// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../contracts/core/VibeSwapCore.sol";
import "../contracts/core/interfaces/ICommitRevealAuction.sol";

// ============ Minimal Mocks (kept tiny — only what initialize needs) ============

contract _CompactMockAuction {
    function getCurrentBatchId() external pure returns (uint64) { return 1; }
    function getCurrentPhase() external pure returns (ICommitRevealAuction.BatchPhase) {
        return ICommitRevealAuction.BatchPhase.COMMIT;
    }
}
contract _CompactMockAMM {}
contract _CompactMockTreasury {}
contract _CompactMockRouter {}

/// @dev Test harness that exposes a helper to push synthetic failed executions
///      without driving a full settlement. Inherits public storage of VibeSwapCore.
contract VibeSwapCoreCompactionHarness is VibeSwapCore {
    /// @notice Test-only helper: directly push an entry into failedExecutions
    function pushFailedForTest(address trader_, uint256 amountIn_) external {
        failedExecutions.push(FailedExecution({
            poolId: bytes32(amountIn_),
            trader: trader_,
            amountIn: amountIn_,
            estimatedOut: 0,
            expectedMinOut: 0,
            reason: bytes(""),
            timestamp: block.timestamp
        }));
    }

    /// @notice Test-only helper: zero out an entry (simulate retryFailedExecution success)
    function deleteForTest(uint256 index) external {
        delete failedExecutions[index];
    }

    /// @notice Test-only getter for trader at a given index
    function traderAt(uint256 index) external view returns (address) {
        return failedExecutions[index].trader;
    }

    /// @notice Test-only getter: amountIn at a given index (for ordering checks)
    function amountInAt(uint256 index) external view returns (uint256) {
        return failedExecutions[index].amountIn;
    }
}

/// @notice C48-F2 — gas-griefing fix on VibeSwapCore.compactFailedExecutions
///
/// FINDING: Pre-fix `compactFailedExecutions` iterated the FULL `failedExecutions`
/// array (capped at MAX_FAILED_QUEUE = 1000) in one call. At full queue, the storage
/// touches (~1k reads + writes + pops) approached 25M gas, leaving the queue stuck
/// full and silently dropping new failures (per INT-R1-INT005).
///
/// FIX: Cap scan window at MAX_COMPACTION_PER_CALL = 200 entries. The algorithm is
/// idempotent across partial calls; anyone can re-invoke until convergence.
contract VibeSwapCoreCompactionTest is Test {
    VibeSwapCoreCompactionHarness public core;

    address public owner;
    address public alice;
    address public bob;

    function setUp() public {
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        address auction = address(new _CompactMockAuction());
        address amm = address(new _CompactMockAMM());
        address treasury = address(new _CompactMockTreasury());
        address router = address(new _CompactMockRouter());

        VibeSwapCoreCompactionHarness impl = new VibeSwapCoreCompactionHarness();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                VibeSwapCore.initialize.selector,
                owner, auction, amm, treasury, router
            )
        );
        core = VibeSwapCoreCompactionHarness(payable(address(proxy)));
    }

    // ============ C48-F2 Cap Constant ============

    function test_C48F2_capValueExposed() public view {
        assertEq(core.MAX_COMPACTION_PER_CALL(), 200);
    }

    // ============ C48-F2 Bounded Single-Call Work ============

    /// @notice With queue full (1000 entries, all zeroed), single compaction touches
    ///         at most 200 entries — well under any reasonable gas budget.
    function test_C48F2_capsWorkPerCall() public {
        // Fill queue to capacity with entries (alternating live/dead to test compaction).
        for (uint256 i = 0; i < 1000; i++) {
            core.pushFailedForTest(alice, i + 1);
        }
        // Mark all entries dead
        for (uint256 i = 0; i < 1000; i++) {
            core.deleteForTest(i);
        }
        assertEq(core.getFailedExecutionCount(), 1000);

        // First compaction: should remove at most MAX_COMPACTION_PER_CALL entries
        (uint256 scanned, uint256 removed) = core.compactFailedExecutions();
        assertEq(scanned, 200, "scanned == 200");
        assertEq(removed, 200, "removed == 200 (all dead)");
        assertEq(core.getFailedExecutionCount(), 800);
    }

    /// @notice Multiple invocations converge — anyone can drive the queue to empty.
    function test_C48F2_multipleInvocationsConverge() public {
        // Push 600 entries, all zeroed
        for (uint256 i = 0; i < 600; i++) core.pushFailedForTest(alice, i + 1);
        for (uint256 i = 0; i < 600; i++) core.deleteForTest(i);

        // Three calls should drain (600 / 200 = 3)
        core.compactFailedExecutions();
        core.compactFailedExecutions();
        core.compactFailedExecutions();
        assertEq(core.getFailedExecutionCount(), 0, "drained after 3 calls");
    }

    // ============ C48-F2 Correctness — Live Entry Preservation ============

    /// @notice Mixed live/dead pattern in scan window: live entries shift left,
    ///         dead entries get popped. Tail unaffected.
    function test_C48F2_liveEntriesPreserved_inWindow() public {
        // Push 5 entries: live (1), dead (2), live (3), dead (4), live (5)
        core.pushFailedForTest(alice, 1);
        core.pushFailedForTest(bob, 2);
        core.pushFailedForTest(alice, 3);
        core.pushFailedForTest(bob, 4);
        core.pushFailedForTest(alice, 5);
        core.deleteForTest(1); // dead
        core.deleteForTest(3); // dead
        assertEq(core.getFailedExecutionCount(), 5);

        // 5 < 200, so cap == len; full-window compaction
        (uint256 scanned, uint256 removed) = core.compactFailedExecutions();
        assertEq(scanned, 5);
        assertEq(removed, 2);
        assertEq(core.getFailedExecutionCount(), 3);

        // Surviving entries: amountIn = 1, 3, 5 (in original order)
        assertEq(core.amountInAt(0), 1);
        assertEq(core.amountInAt(1), 3);
        assertEq(core.amountInAt(2), 5);
    }

    /// @notice Tail outside the scan window is preserved correctly:
    ///         compaction shifts only the unscanned tail down by `(cap - writeIdx)`.
    function test_C48F2_tailPreservedCorrectly_acrossWindow() public {
        // Push 250 entries; mark first 100 dead, leave last 150 live.
        for (uint256 i = 0; i < 250; i++) core.pushFailedForTest(alice, i + 1);
        for (uint256 i = 0; i < 100; i++) core.deleteForTest(i);
        // Verify pre-state: 100 dead at front, 150 live at back
        assertEq(core.traderAt(0), address(0));
        assertEq(core.traderAt(150), alice); // index 150 is live

        // First compaction: scan window of 200 (entries 0-199).
        // 100 of those are dead (0-99) + 100 live (100-199).
        // After compaction: writeIdx = 100 (the 100 live entries from window).
        // shift = cap - writeIdx = 200 - 100 = 100. Tail [200, 250) shifted down by 100 → [100, 150).
        // Pop 100. New length = 150. All entries should be alice with amountIn 101..250.
        (uint256 scanned, uint256 removed) = core.compactFailedExecutions();
        assertEq(scanned, 200);
        assertEq(removed, 100);
        assertEq(core.getFailedExecutionCount(), 150);

        // Verify the live entries survived in the correct order: amountIn 101 ... 250.
        assertEq(core.amountInAt(0), 101, "first live entry preserved");
        assertEq(core.amountInAt(49), 150, "mid-tail preserved");
        assertEq(core.amountInAt(149), 250, "last tail entry preserved");
    }

    // ============ C48-F2 Idempotent Across Partial Calls ============

    /// @notice An already-compact array compacts cleanly: scanned ≤ cap, removed = 0.
    function test_C48F2_alreadyCompactArray_noOp() public {
        for (uint256 i = 0; i < 50; i++) core.pushFailedForTest(alice, i + 1);
        // No deletes — all live

        (uint256 scanned, uint256 removed) = core.compactFailedExecutions();
        assertEq(scanned, 50);
        assertEq(removed, 0);
        assertEq(core.getFailedExecutionCount(), 50);

        // All amountIn preserved 1..50
        assertEq(core.amountInAt(0), 1);
        assertEq(core.amountInAt(49), 50);
    }

    /// @notice Empty array compacts to empty (no-op without reverting).
    function test_C48F2_emptyArray_noOp() public {
        (uint256 scanned, uint256 removed) = core.compactFailedExecutions();
        assertEq(scanned, 0);
        assertEq(removed, 0);
        assertEq(core.getFailedExecutionCount(), 0);
    }

    // ============ Demonstrates Pre-Fix Gas Profile (informational) ============

    /// @notice The fix bounds compaction work to MAX_COMPACTION_PER_CALL touches.
    ///         Pre-fix, a 1000-entry-all-dead compaction would do ~1000 storage writes
    ///         (~25M gas, near block limit). Post-fix, 200 entries cost ~5M gas.
    function test_C48F2_gasUnderBlockBudget() public {
        for (uint256 i = 0; i < 1000; i++) core.pushFailedForTest(alice, i + 1);
        for (uint256 i = 0; i < 1000; i++) core.deleteForTest(i);

        uint256 g0 = gasleft();
        core.compactFailedExecutions();
        uint256 used = g0 - gasleft();
        // Empirical: 200 storage-pop + bookkeeping. Cap well under 30M block limit.
        assertLt(used, 15_000_000, "single call < 15M gas");
    }
}
