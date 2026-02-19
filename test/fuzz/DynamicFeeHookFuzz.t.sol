// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/hooks/DynamicFeeHook.sol";

// ============ Fuzz Tests ============

contract DynamicFeeHookFuzzTest is Test {
    DynamicFeeHook hook;

    bytes32 pool1 = keccak256("pool1");

    function setUp() public {
        hook = new DynamicFeeHook(
            30,           // 0.3% base
            300,          // 3% max
            100_000 ether, // surge threshold
            5000,         // 50% surge multiplier
            1 hours       // window
        );
    }

    // ============ Fuzz: fee always within bounds ============

    function testFuzz_feeAlwaysWithinBounds(uint256 volume) public view {
        volume = bound(volume, 0, 1_000_000_000 ether);

        uint256 fee = hook.calculateFeeForVolume(volume);

        assertGe(fee, hook.baseFeeBps());
        assertLe(fee, hook.maxFeeBps());
    }

    // ============ Fuzz: fee monotonically increases with volume ============

    function testFuzz_feeMonotonicWithVolume(uint256 vol1, uint256 vol2) public view {
        vol1 = bound(vol1, 0, 500_000_000 ether);
        vol2 = bound(vol2, vol1, 1_000_000_000 ether);

        uint256 fee1 = hook.calculateFeeForVolume(vol1);
        uint256 fee2 = hook.calculateFeeForVolume(vol2);

        assertGe(fee2, fee1);
    }

    // ============ Fuzz: window reset clears volume ============

    function testFuzz_windowResetClearsVolume(uint256 volume, uint256 waitTime) public {
        volume = bound(volume, 1 ether, 1_000_000 ether);
        waitTime = bound(waitTime, 1 hours + 1, 24 hours);

        hook.afterSwap(pool1, abi.encode(volume));

        DynamicFeeHook.PoolVolume memory before = hook.getPoolVolume(pool1);
        assertEq(before.totalVolume, volume);

        vm.warp(block.timestamp + waitTime);

        // Trigger reset via new swap
        hook.afterSwap(pool1, abi.encode(uint256(1 ether)));

        DynamicFeeHook.PoolVolume memory after_ = hook.getPoolVolume(pool1);
        assertEq(after_.totalVolume, 1 ether); // Only new swap
        assertEq(after_.swapCount, 1);
    }

    // ============ Fuzz: volume accumulates within window ============

    function testFuzz_volumeAccumulates(uint256 amt1, uint256 amt2) public {
        amt1 = bound(amt1, 1 ether, 500_000 ether);
        amt2 = bound(amt2, 1 ether, 500_000 ether);

        hook.afterSwap(pool1, abi.encode(amt1));
        hook.afterSwap(pool1, abi.encode(amt2));

        DynamicFeeHook.PoolVolume memory vol = hook.getPoolVolume(pool1);
        assertEq(vol.totalVolume, amt1 + amt2);
        assertEq(vol.swapCount, 2);
    }

    // ============ Fuzz: below threshold always returns base fee ============

    function testFuzz_belowThresholdBaseFee(uint256 volume) public view {
        volume = bound(volume, 0, 100_000 ether); // <= threshold

        uint256 fee = hook.calculateFeeForVolume(volume);
        assertEq(fee, hook.baseFeeBps());
    }

    // ============ Fuzz: parameter updates work correctly ============

    function testFuzz_parameterUpdates(uint256 base, uint256 max) public {
        base = bound(base, 1, 5000);
        max = bound(max, base, 10000);

        hook.setParameters(base, max, 100_000 ether, 5000);

        assertEq(hook.baseFeeBps(), base);
        assertEq(hook.maxFeeBps(), max);
    }
}
