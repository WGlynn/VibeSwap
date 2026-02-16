// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/mechanism/AdaptiveBatchTiming.sol";

// ============ Handler ============

contract ABTHandler is Test {
    AdaptiveBatchTiming public abt;

    uint64 public ghost_batchCount;

    constructor(AdaptiveBatchTiming _abt) {
        abt = _abt;
    }

    function recordMetrics(uint256 orderCount, uint256 revealRate, uint256 gasPrice) public {
        orderCount = bound(orderCount, 0, 500);
        revealRate = bound(revealRate, 0, 10000);
        gasPrice = bound(gasPrice, 1 gwei, 500 gwei);

        uint64 batchId = ++ghost_batchCount;

        try abt.recordBatchMetrics(batchId, orderCount, revealRate, gasPrice) {} catch {}
    }
}

// ============ Invariant Tests ============

contract AdaptiveBatchTimingInvariantTest is StdInvariant, Test {
    AdaptiveBatchTiming public abt;
    ABTHandler public handler;

    function setUp() public {
        abt = new AdaptiveBatchTiming();
        handler = new ABTHandler(abt);

        targetContract(address(handler));
    }

    // ============ Invariant: commit duration always within bounds ============

    function invariant_commitBounded() public view {
        IAdaptiveBatchTiming.TimingConfig memory c = abt.getConfig();
        assertGe(abt.currentCommitDuration(), c.minCommit, "COMMIT: below minimum");
        assertLe(abt.currentCommitDuration(), c.maxCommit, "COMMIT: above maximum");
    }

    // ============ Invariant: reveal duration always within bounds ============

    function invariant_revealBounded() public view {
        IAdaptiveBatchTiming.TimingConfig memory c = abt.getConfig();
        assertGe(abt.currentRevealDuration(), c.minReveal, "REVEAL: below minimum");
        assertLe(abt.currentRevealDuration(), c.maxReveal, "REVEAL: above maximum");
    }

    // ============ Invariant: batch = commit + reveal ============

    function invariant_batchDurationConsistent() public view {
        assertEq(
            abt.getBatchDuration(),
            abt.currentCommitDuration() + abt.currentRevealDuration(),
            "BATCH: duration != commit + reveal"
        );
    }

    // ============ Invariant: congestion level is valid ============

    function invariant_congestionLevelValid() public view {
        uint8 level = uint8(abt.getCurrentCongestionLevel());
        assertTrue(level <= uint8(IAdaptiveBatchTiming.CongestionLevel.EXTREME), "CONGESTION: invalid level");
    }
}
