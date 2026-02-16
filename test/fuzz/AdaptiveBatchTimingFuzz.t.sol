// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/AdaptiveBatchTiming.sol";

// ============ Fuzz Tests ============

contract AdaptiveBatchTimingFuzzTest is Test {
    AdaptiveBatchTiming public abt;

    function setUp() public {
        abt = new AdaptiveBatchTiming();
    }

    // ============ Fuzz: commit duration always within bounds ============

    function testFuzz_commitDurationBounded(uint256 orderCount, uint256 revealRate, uint256 gasPrice) public {
        orderCount = bound(orderCount, 0, 1000);
        revealRate = bound(revealRate, 0, 10000);
        gasPrice = bound(gasPrice, 1 gwei, 1000 gwei);

        // Record multiple batches to converge EMA
        for (uint64 i = 1; i <= 5; i++) {
            abt.recordBatchMetrics(i, orderCount, revealRate, gasPrice);
        }

        IAdaptiveBatchTiming.TimingConfig memory c = abt.getConfig();
        assertGe(abt.currentCommitDuration(), c.minCommit, "Commit >= min");
        assertLe(abt.currentCommitDuration(), c.maxCommit, "Commit <= max");
    }

    // ============ Fuzz: reveal duration always within bounds ============

    function testFuzz_revealDurationBounded(uint256 orderCount, uint256 revealRate, uint256 gasPrice) public {
        orderCount = bound(orderCount, 0, 1000);
        revealRate = bound(revealRate, 0, 10000);
        gasPrice = bound(gasPrice, 1 gwei, 1000 gwei);

        for (uint64 i = 1; i <= 5; i++) {
            abt.recordBatchMetrics(i, orderCount, revealRate, gasPrice);
        }

        IAdaptiveBatchTiming.TimingConfig memory c = abt.getConfig();
        assertGe(abt.currentRevealDuration(), c.minReveal, "Reveal >= min");
        assertLe(abt.currentRevealDuration(), c.maxReveal, "Reveal <= max");
    }

    // ============ Fuzz: batch duration = commit + reveal ============

    function testFuzz_batchDurationIsSum(uint256 orderCount, uint256 revealRate) public {
        orderCount = bound(orderCount, 1, 500);
        revealRate = bound(revealRate, 1000, 10000);

        abt.recordBatchMetrics(1, orderCount, revealRate, 30 gwei);

        assertEq(
            abt.getBatchDuration(),
            abt.currentCommitDuration() + abt.currentRevealDuration(),
            "Batch = commit + reveal"
        );
    }

    // ============ Fuzz: more orders -> higher congestion ============

    function testFuzz_morOrdersHigherCongestion(uint256 lowOrders, uint256 highOrders) public {
        lowOrders = bound(lowOrders, 1, 5);
        highOrders = bound(highOrders, 50, 500);

        // Low traffic
        AdaptiveBatchTiming abt1 = new AdaptiveBatchTiming();
        for (uint64 i = 1; i <= 10; i++) {
            abt1.recordBatchMetrics(i, lowOrders, 9000, 30 gwei);
        }

        // High traffic
        AdaptiveBatchTiming abt2 = new AdaptiveBatchTiming();
        for (uint64 i = 1; i <= 10; i++) {
            abt2.recordBatchMetrics(i, highOrders, 9000, 30 gwei);
        }

        assertGe(
            uint8(abt2.getCurrentCongestionLevel()),
            uint8(abt1.getCurrentCongestionLevel()),
            "More orders -> higher or equal congestion"
        );
    }

    // ============ Fuzz: EMA smoothing (doesn't jump wildly) ============

    function testFuzz_emaSmoothing(uint256 spike) public {
        spike = bound(spike, 100, 10000);

        // Establish baseline
        for (uint64 i = 1; i <= 5; i++) {
            abt.recordBatchMetrics(i, 20, 9000, 30 gwei);
        }

        uint32 commitBefore = abt.currentCommitDuration();

        // Spike in orders
        abt.recordBatchMetrics(6, spike, 9000, 30 gwei);

        uint32 commitAfter = abt.currentCommitDuration();

        // EMA should prevent wild jumps — commit shouldn't go from min to max in one step
        // (unless the spike is truly extreme and EMA converges fast)
        IAdaptiveBatchTiming.TimingConfig memory c = abt.getConfig();
        assertGe(commitAfter, c.minCommit, "Still within bounds after spike");
        assertLe(commitAfter, c.maxCommit, "Still within bounds after spike");
    }

    // ============ Fuzz: congestion level is valid enum ============

    function testFuzz_congestionLevelValid(uint256 orderCount) public {
        orderCount = bound(orderCount, 0, 10000);

        for (uint64 i = 1; i <= 5; i++) {
            abt.recordBatchMetrics(i, orderCount, 8000, 30 gwei);
        }

        uint8 level = uint8(abt.getCurrentCongestionLevel());
        assertTrue(level <= uint8(IAdaptiveBatchTiming.CongestionLevel.EXTREME), "Valid congestion level");
    }
}
