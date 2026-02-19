// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/hooks/DynamicFeeHook.sol";

// ============ Handler ============

contract HookHandler is Test {
    DynamicFeeHook public hook;
    bytes32 public poolId;

    uint256 public ghost_totalVolume;
    uint256 public ghost_swapCount;

    constructor(DynamicFeeHook _hook) {
        hook = _hook;
        poolId = keccak256("testpool");
    }

    function doSwap(uint256 amount) public {
        amount = bound(amount, 1 ether, 1_000_000 ether);

        // beforeSwap — get fee recommendation
        hook.beforeSwap(poolId, abi.encode(amount));

        // afterSwap — record volume
        hook.afterSwap(poolId, abi.encode(amount));

        ghost_totalVolume += amount;
        ghost_swapCount++;
    }

    function advanceTime(uint256 time) public {
        time = bound(time, 1, 2 hours);
        vm.warp(block.timestamp + time);

        // If we crossed window boundary, ghost resets
        // (The hook handles this internally; we can't perfectly track it
        //  since the window resets on the next swap, not on time advance.
        //  So we track total volume and check fee bounds instead.)
    }
}

// ============ Invariant Tests ============

contract DynamicFeeHookInvariantTest is StdInvariant, Test {
    DynamicFeeHook hook;
    HookHandler handler;

    function setUp() public {
        hook = new DynamicFeeHook(
            30,           // 0.3% base
            300,          // 3% max
            100_000 ether,
            5000,
            1 hours
        );

        handler = new HookHandler(hook);
        targetContract(address(handler));
    }

    // ============ Invariant: fee always within [base, max] ============

    function invariant_feeWithinBounds() public {
        bytes32 poolId = handler.poolId();
        DynamicFeeHook.PoolVolume memory vol = hook.getPoolVolume(poolId);

        if (vol.lastFeeApplied > 0) {
            assertGe(vol.lastFeeApplied, hook.baseFeeBps());
            assertLe(vol.lastFeeApplied, hook.maxFeeBps());
        }
    }

    // ============ Invariant: swap count only increases ============

    function invariant_swapCountMonotonic() public view {
        bytes32 poolId = handler.poolId();
        DynamicFeeHook.PoolVolume memory vol = hook.getPoolVolume(poolId);

        // Volume count in pool may reset on window change, but ghost always increases
        assertGe(handler.ghost_swapCount(), vol.swapCount);
    }

    // ============ Invariant: hook flags never change ============

    function invariant_hookFlagsStable() public view {
        assertEq(hook.getHookFlags(), 48); // BEFORE_SWAP | AFTER_SWAP
    }
}
