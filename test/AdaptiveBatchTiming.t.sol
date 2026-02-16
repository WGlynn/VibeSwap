// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/mechanism/AdaptiveBatchTiming.sol";

// ============ Test Contract ============

contract AdaptiveBatchTimingTest is Test {
    AdaptiveBatchTiming public abt;

    address public owner;
    address public recorder;

    function setUp() public {
        owner = makeAddr("owner");

        vm.prank(owner);
        abt = new AdaptiveBatchTiming();

        recorder = makeAddr("recorder");
        vm.prank(owner);
        abt.addRecorder(recorder);
    }

    // ============ Constructor Tests ============

    function test_constructor_setsDefaults() public view {
        assertEq(abt.currentCommitDuration(), 8);
        assertEq(abt.currentRevealDuration(), 2);
        assertEq(abt.owner(), owner);
    }

    function test_constructor_setsConfig() public view {
        IAdaptiveBatchTiming.TimingConfig memory c = abt.getConfig();
        assertEq(c.minCommit, 4);
        assertEq(c.maxCommit, 30);
        assertEq(c.minReveal, 2);
        assertEq(c.maxReveal, 10);
        assertEq(c.targetOrders, 20);
    }

    // ============ recordBatchMetrics Tests ============

    function test_recordBatchMetrics_happyPath() public {
        vm.prank(recorder);
        abt.recordBatchMetrics(1, 20, 9000, 30 gwei);

        IAdaptiveBatchTiming.BatchMetrics memory m = abt.getMetrics(1);
        assertEq(m.batchId, 1);
        assertEq(m.orderCount, 20);
        assertEq(m.revealRate, 9000);
    }

    function test_recordBatchMetrics_revertsNotAuthorized() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert(IAdaptiveBatchTiming.NotAuthorized.selector);
        abt.recordBatchMetrics(1, 20, 9000, 30 gwei);
    }

    function test_recordBatchMetrics_revertsAlreadyRecorded() public {
        vm.prank(recorder);
        abt.recordBatchMetrics(1, 20, 9000, 30 gwei);

        vm.prank(recorder);
        vm.expectRevert(IAdaptiveBatchTiming.AlreadyRecorded.selector);
        abt.recordBatchMetrics(1, 20, 9000, 30 gwei);
    }

    // ============ Timing Adaptation Tests ============

    function test_lowCongestion_shortWindows() public {
        // Record low order count (5 orders, target is 20 -> LOW)
        vm.prank(recorder);
        abt.recordBatchMetrics(1, 5, 9500, 10 gwei);

        // With low congestion, should tend toward minimum durations
        // After one EMA update, should be close to min
        // Multiple updates to converge
        for (uint64 i = 2; i <= 10; i++) {
            vm.prank(recorder);
            abt.recordBatchMetrics(i, 5, 9500, 10 gwei);
        }

        assertEq(uint8(abt.getCurrentCongestionLevel()), uint8(IAdaptiveBatchTiming.CongestionLevel.LOW));
        assertEq(abt.currentCommitDuration(), 4, "Low congestion -> min commit");
    }

    function test_highCongestion_longerWindows() public {
        // Record very high order count (50+ orders, target is 20 -> EXTREME)
        for (uint64 i = 1; i <= 10; i++) {
            vm.prank(recorder);
            abt.recordBatchMetrics(i, 60, 9000, 100 gwei);
        }

        assertTrue(
            abt.getCurrentCongestionLevel() >= IAdaptiveBatchTiming.CongestionLevel.HIGH,
            "Should be HIGH or EXTREME"
        );
        assertGt(abt.currentCommitDuration(), 4, "High congestion -> longer commit");
    }

    function test_lowRevealRate_longerRevealWindow() public {
        // Record low reveal rate (40% = 4000 bps)
        for (uint64 i = 1; i <= 10; i++) {
            vm.prank(recorder);
            abt.recordBatchMetrics(i, 20, 4000, 30 gwei);
        }

        assertGt(abt.currentRevealDuration(), 2, "Low reveal rate -> longer reveal window");
    }

    // ============ getBatchDuration Tests ============

    function test_getBatchDuration_sumOfCommitAndReveal() public view {
        assertEq(abt.getBatchDuration(), abt.currentCommitDuration() + abt.currentRevealDuration());
    }

    // ============ setConfig Tests ============

    function test_setConfig_happyPath() public {
        IAdaptiveBatchTiming.TimingConfig memory newConfig = IAdaptiveBatchTiming.TimingConfig({
            minCommit: 2,
            maxCommit: 60,
            minReveal: 1,
            maxReveal: 20,
            targetOrders: 50,
            volatilityWeight: 4000,
            congestionWeight: 6000
        });

        vm.prank(owner);
        abt.setConfig(newConfig);

        IAdaptiveBatchTiming.TimingConfig memory c = abt.getConfig();
        assertEq(c.minCommit, 2);
        assertEq(c.maxCommit, 60);
        assertEq(c.targetOrders, 50);
    }

    function test_setConfig_revertsInvalidConfig() public {
        IAdaptiveBatchTiming.TimingConfig memory bad = IAdaptiveBatchTiming.TimingConfig({
            minCommit: 0, // invalid
            maxCommit: 30,
            minReveal: 2,
            maxReveal: 10,
            targetOrders: 20,
            volatilityWeight: 5000,
            congestionWeight: 5000
        });

        vm.prank(owner);
        vm.expectRevert(IAdaptiveBatchTiming.InvalidConfig.selector);
        abt.setConfig(bad);
    }

    function test_setConfig_revertsMinGtMax() public {
        IAdaptiveBatchTiming.TimingConfig memory bad = IAdaptiveBatchTiming.TimingConfig({
            minCommit: 30,
            maxCommit: 4, // min > max
            minReveal: 2,
            maxReveal: 10,
            targetOrders: 20,
            volatilityWeight: 5000,
            congestionWeight: 5000
        });

        vm.prank(owner);
        vm.expectRevert(IAdaptiveBatchTiming.InvalidConfig.selector);
        abt.setConfig(bad);
    }

    // ============ CongestionLevel Tests ============

    function test_congestionLevel_startsAtHigh() public view {
        // Initial EMA = 20 orders, target = 20 -> ratio = 10000 (exactly 100%)
        // 10000 is >= 10000 threshold, so HIGH (not MEDIUM)
        assertEq(uint8(abt.getCurrentCongestionLevel()), uint8(IAdaptiveBatchTiming.CongestionLevel.HIGH));
    }
}
