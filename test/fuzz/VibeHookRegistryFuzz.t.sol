// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/hooks/VibeHookRegistry.sol";
import "../../contracts/hooks/interfaces/IVibeHookRegistry.sol";
import "../../contracts/hooks/interfaces/IVibeHook.sol";

// ============ Mocks ============

contract MockHookFuzz is IVibeHook {
    uint256 public callCount;
    function beforeCommit(bytes32, bytes calldata) external returns (bytes memory) { callCount++; return ""; }
    function afterCommit(bytes32, bytes calldata) external returns (bytes memory) { callCount++; return ""; }
    function beforeSettle(bytes32, bytes calldata) external returns (bytes memory) { callCount++; return ""; }
    function afterSettle(bytes32, bytes calldata) external returns (bytes memory) { callCount++; return ""; }
    function beforeSwap(bytes32, bytes calldata) external returns (bytes memory) { callCount++; return ""; }
    function afterSwap(bytes32, bytes calldata) external returns (bytes memory) { callCount++; return ""; }
    function getHookFlags() external pure returns (uint8) { return 63; }
}

// ============ Fuzz Tests ============

contract VibeHookRegistryFuzzTest is Test {
    VibeHookRegistry public registry;
    MockHookFuzz public hook;
    address public poolOwner;

    function setUp() public {
        poolOwner = makeAddr("poolOwner");
        registry = new VibeHookRegistry();
        hook = new MockHookFuzz();
    }

    function testFuzz_validFlagsAccepted(uint8 flags) public {
        flags = uint8(bound(flags, 1, 63));
        bytes32 poolId = keccak256(abi.encodePacked("pool", flags));

        registry.setPoolOwner(poolId, poolOwner);

        vm.prank(poolOwner);
        registry.attachHook(poolId, address(hook), flags);

        IVibeHookRegistry.HookConfig memory config = registry.getHookConfig(poolId);
        assertEq(config.flags, flags);
    }

    function testFuzz_invalidFlagsRejected(uint8 flags) public {
        vm.assume(flags == 0 || flags > 63);
        bytes32 poolId = keccak256("testPool");
        registry.setPoolOwner(poolId, poolOwner);

        vm.prank(poolOwner);
        vm.expectRevert(IVibeHookRegistry.InvalidFlags.selector);
        registry.attachHook(poolId, address(hook), flags);
    }

    function testFuzz_hookPointFlagMatch(uint8 flags) public {
        flags = uint8(bound(flags, 1, 63));
        bytes32 poolId = keccak256(abi.encodePacked("pool", flags));
        registry.setPoolOwner(poolId, poolOwner);

        vm.prank(poolOwner);
        registry.attachHook(poolId, address(hook), flags);

        for (uint8 i = 0; i < 6; i++) {
            bool expectedHook = (flags & (1 << i)) != 0;
            assertEq(
                registry.hasHook(poolId, IVibeHookRegistry.HookPoint(i)),
                expectedHook,
                "hasHook must match flag bitmap"
            );
        }
    }

    function testFuzz_executeOnlyFiresEnabledPoints(uint8 flags) public {
        flags = uint8(bound(flags, 1, 63));
        MockHookFuzz freshHook = new MockHookFuzz();
        bytes32 poolId = keccak256(abi.encodePacked("pool", flags));
        registry.setPoolOwner(poolId, poolOwner);

        vm.prank(poolOwner);
        registry.attachHook(poolId, address(freshHook), flags);

        uint256 expectedCalls;
        for (uint8 i = 0; i < 6; i++) {
            registry.executeHook(poolId, IVibeHookRegistry.HookPoint(i), "");
            if ((flags & (1 << i)) != 0) expectedCalls++;
        }

        assertEq(freshHook.callCount(), expectedCalls, "Call count must match enabled flags");
    }

    function testFuzz_differentPoolsIsolated(bytes32 poolId1, bytes32 poolId2) public {
        vm.assume(poolId1 != poolId2);
        MockHookFuzz hook1 = new MockHookFuzz();
        MockHookFuzz hook2 = new MockHookFuzz();

        registry.setPoolOwner(poolId1, poolOwner);
        registry.setPoolOwner(poolId2, poolOwner);

        vm.startPrank(poolOwner);
        registry.attachHook(poolId1, address(hook1), 1);
        registry.attachHook(poolId2, address(hook2), 2);
        vm.stopPrank();

        registry.executeHook(poolId1, IVibeHookRegistry.HookPoint.BEFORE_COMMIT, "");
        registry.executeHook(poolId2, IVibeHookRegistry.HookPoint.AFTER_COMMIT, "");

        assertEq(hook1.callCount(), 1);
        assertEq(hook2.callCount(), 1);
    }
}
