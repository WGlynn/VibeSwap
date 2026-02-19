// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/hooks/DynamicFeeHook.sol";

// ============ Unit Tests ============

contract DynamicFeeHookTest is Test {
    DynamicFeeHook hook;

    bytes32 pool1 = keccak256("pool1");
    bytes32 pool2 = keccak256("pool2");

    uint256 constant BASE_FEE = 30;      // 0.3%
    uint256 constant MAX_FEE = 300;      // 3%
    uint256 constant SURGE_THRESHOLD = 100_000 ether;
    uint256 constant SURGE_MULTIPLIER = 5000; // 50%
    uint256 constant WINDOW = 1 hours;

    function setUp() public {
        hook = new DynamicFeeHook(BASE_FEE, MAX_FEE, SURGE_THRESHOLD, SURGE_MULTIPLIER, WINDOW);
    }

    // ============ Constructor ============

    function test_constructor() public view {
        assertEq(hook.baseFeeBps(), BASE_FEE);
        assertEq(hook.maxFeeBps(), MAX_FEE);
        assertEq(hook.surgeThreshold(), SURGE_THRESHOLD);
        assertEq(hook.surgeMultiplierBps(), SURGE_MULTIPLIER);
        assertEq(hook.windowDuration(), WINDOW);
    }

    function test_constructor_revertsInvalidBase() public {
        vm.expectRevert(DynamicFeeHook.InvalidFee.selector);
        new DynamicFeeHook(10001, MAX_FEE, SURGE_THRESHOLD, SURGE_MULTIPLIER, WINDOW);
    }

    function test_constructor_revertsMaxBelowBase() public {
        vm.expectRevert(DynamicFeeHook.InvalidFee.selector);
        new DynamicFeeHook(300, 100, SURGE_THRESHOLD, SURGE_MULTIPLIER, WINDOW);
    }

    function test_constructor_revertsZeroThreshold() public {
        vm.expectRevert(DynamicFeeHook.InvalidThreshold.selector);
        new DynamicFeeHook(BASE_FEE, MAX_FEE, 0, SURGE_MULTIPLIER, WINDOW);
    }

    // ============ getHookFlags ============

    function test_getHookFlags() public view {
        uint8 flags = hook.getHookFlags();
        // BEFORE_SWAP (16) | AFTER_SWAP (32) = 48
        assertEq(flags, 48);
    }

    // ============ beforeSwap — Dynamic Fee Calculation ============

    function test_beforeSwap_baseFee_lowVolume() public {
        bytes memory data = abi.encode(uint256(10_000 ether)); // Below threshold

        bytes memory result = hook.beforeSwap(pool1, data);
        uint256 fee = abi.decode(result, (uint256));

        assertEq(fee, BASE_FEE);
    }

    function test_beforeSwap_surgeFee() public {
        // First, record some volume
        bytes memory swapData = abi.encode(uint256(100_000 ether));
        hook.afterSwap(pool1, swapData);

        // Now a swap that brings total over threshold
        bytes memory newSwap = abi.encode(uint256(200_000 ether));
        bytes memory result = hook.beforeSwap(pool1, newSwap);
        uint256 fee = abi.decode(result, (uint256));

        // Total volume = 100k + 200k = 300k. After threshold (100k), excess = 200k
        // surgeLevel = 200k / 100k = 2
        // surgeIncrease = 30 * 2 * 5000 / 10000 = 30
        // dynamicFee = 30 + 30 = 60
        assertEq(fee, 60);
    }

    function test_beforeSwap_maxFeeCap() public {
        // Record massive volume
        bytes memory bigSwap = abi.encode(uint256(10_000_000 ether));
        hook.afterSwap(pool1, bigSwap);

        // Next swap should hit max fee
        bytes memory result = hook.beforeSwap(pool1, bigSwap);
        uint256 fee = abi.decode(result, (uint256));

        assertEq(fee, MAX_FEE);
    }

    function test_beforeSwap_emptyData() public {
        bytes memory result = hook.beforeSwap(pool1, "");
        uint256 fee = abi.decode(result, (uint256));

        assertEq(fee, BASE_FEE);
    }

    // ============ afterSwap — Volume Tracking ============

    function test_afterSwap_recordsVolume() public {
        bytes memory data = abi.encode(uint256(50_000 ether));
        hook.afterSwap(pool1, data);

        DynamicFeeHook.PoolVolume memory vol = hook.getPoolVolume(pool1);
        assertEq(vol.totalVolume, 50_000 ether);
        assertEq(vol.swapCount, 1);
    }

    function test_afterSwap_accumulatesVolume() public {
        hook.afterSwap(pool1, abi.encode(uint256(30_000 ether)));
        hook.afterSwap(pool1, abi.encode(uint256(20_000 ether)));

        DynamicFeeHook.PoolVolume memory vol = hook.getPoolVolume(pool1);
        assertEq(vol.totalVolume, 50_000 ether);
        assertEq(vol.swapCount, 2);
    }

    function test_afterSwap_windowReset() public {
        hook.afterSwap(pool1, abi.encode(uint256(50_000 ether)));

        // Advance past window
        vm.warp(block.timestamp + WINDOW + 1);

        hook.afterSwap(pool1, abi.encode(uint256(10_000 ether)));

        DynamicFeeHook.PoolVolume memory vol = hook.getPoolVolume(pool1);
        assertEq(vol.totalVolume, 10_000 ether);
        assertEq(vol.swapCount, 1);
    }

    function test_afterSwap_independentPools() public {
        hook.afterSwap(pool1, abi.encode(uint256(50_000 ether)));
        hook.afterSwap(pool2, abi.encode(uint256(30_000 ether)));

        DynamicFeeHook.PoolVolume memory vol1 = hook.getPoolVolume(pool1);
        DynamicFeeHook.PoolVolume memory vol2 = hook.getPoolVolume(pool2);

        assertEq(vol1.totalVolume, 50_000 ether);
        assertEq(vol2.totalVolume, 30_000 ether);
    }

    // ============ No-op hooks ============

    function test_noopHooks() public {
        assertEq(hook.beforeCommit(pool1, ""), "");
        assertEq(hook.afterCommit(pool1, ""), "");
        assertEq(hook.beforeSettle(pool1, ""), "");
        assertEq(hook.afterSettle(pool1, ""), "");
    }

    // ============ Configuration ============

    function test_setParameters() public {
        hook.setParameters(50, 500, 200_000 ether, 3000);

        assertEq(hook.baseFeeBps(), 50);
        assertEq(hook.maxFeeBps(), 500);
        assertEq(hook.surgeThreshold(), 200_000 ether);
        assertEq(hook.surgeMultiplierBps(), 3000);
    }

    function test_setParameters_onlyOwner() public {
        vm.prank(makeAddr("random"));
        vm.expectRevert();
        hook.setParameters(50, 500, 200_000 ether, 3000);
    }

    function test_setWindowDuration() public {
        hook.setWindowDuration(2 hours);
        assertEq(hook.windowDuration(), 2 hours);
    }

    // ============ calculateFeeForVolume ============

    function test_calculateFeeForVolume() public view {
        assertEq(hook.calculateFeeForVolume(0), BASE_FEE);
        assertEq(hook.calculateFeeForVolume(50_000 ether), BASE_FEE);
        assertEq(hook.calculateFeeForVolume(SURGE_THRESHOLD), BASE_FEE);

        // At 2x threshold: surgeLevel=1, increase = 30*1*5000/10000 = 15
        assertEq(hook.calculateFeeForVolume(200_000 ether), BASE_FEE + 15);
    }

    // ============ Full Flow ============

    function test_fullFlow_volumeSurge() public {
        // Normal swap — base fee
        bytes memory result = hook.beforeSwap(pool1, abi.encode(uint256(10_000 ether)));
        assertEq(abi.decode(result, (uint256)), BASE_FEE);
        hook.afterSwap(pool1, abi.encode(uint256(10_000 ether)));

        // Build up volume to 150k (multiple swaps)
        hook.afterSwap(pool1, abi.encode(uint256(140_000 ether)));

        // Next swap sees surge pricing
        result = hook.beforeSwap(pool1, abi.encode(uint256(50_000 ether)));
        uint256 fee = abi.decode(result, (uint256));
        assertGt(fee, BASE_FEE);

        // Wait for window reset
        vm.warp(block.timestamp + WINDOW + 1);

        // Back to base fee
        result = hook.beforeSwap(pool1, abi.encode(uint256(10_000 ether)));
        assertEq(abi.decode(result, (uint256)), BASE_FEE);
    }
}
