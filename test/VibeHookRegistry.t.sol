// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/hooks/VibeHookRegistry.sol";
import "../contracts/hooks/interfaces/IVibeHookRegistry.sol";
import "../contracts/hooks/interfaces/IVibeHook.sol";

// ============ Mock Hooks ============

contract MockHookAll is IVibeHook {
    bytes32 public lastPoolId;
    uint256 public callCount;

    function _track(bytes32 poolId) internal {
        lastPoolId = poolId;
        callCount++;
    }

    function beforeCommit(bytes32 poolId, bytes calldata) external returns (bytes memory) { _track(poolId); return abi.encode(true); }
    function afterCommit(bytes32 poolId, bytes calldata) external returns (bytes memory) { _track(poolId); return abi.encode(true); }
    function beforeSettle(bytes32 poolId, bytes calldata) external returns (bytes memory) { _track(poolId); return abi.encode(true); }
    function afterSettle(bytes32 poolId, bytes calldata) external returns (bytes memory) { _track(poolId); return abi.encode(true); }
    function beforeSwap(bytes32 poolId, bytes calldata) external returns (bytes memory) { _track(poolId); return abi.encode(true); }
    function afterSwap(bytes32 poolId, bytes calldata) external returns (bytes memory) { _track(poolId); return abi.encode(true); }
    function getHookFlags() external pure returns (uint8) { return 63; }
}

contract MockHookReverting is IVibeHook {
    function beforeCommit(bytes32, bytes calldata) external pure returns (bytes memory) { revert("boom"); }
    function afterCommit(bytes32, bytes calldata) external pure returns (bytes memory) { revert("boom"); }
    function beforeSettle(bytes32, bytes calldata) external pure returns (bytes memory) { revert("boom"); }
    function afterSettle(bytes32, bytes calldata) external pure returns (bytes memory) { revert("boom"); }
    function beforeSwap(bytes32, bytes calldata) external pure returns (bytes memory) { revert("boom"); }
    function afterSwap(bytes32, bytes calldata) external pure returns (bytes memory) { revert("boom"); }
    function getHookFlags() external pure returns (uint8) { return 63; }
}

// ============ Unit Tests — Part 1: Attach, Detach, Flags, Admin ============

contract VibeHookRegistryTest is Test {
    VibeHookRegistry public registry;
    MockHookAll public hookAll;
    MockHookReverting public hookBad;

    address public poolOwner;
    address public alice;

    bytes32 constant POOL_A = keccak256("POOL_A");
    bytes32 constant POOL_B = keccak256("POOL_B");

    function setUp() public {
        poolOwner = makeAddr("poolOwner");
        alice = makeAddr("alice");

        registry = new VibeHookRegistry();
        hookAll = new MockHookAll();
        hookBad = new MockHookReverting();

        registry.setPoolOwner(POOL_A, poolOwner);
        registry.setPoolOwner(POOL_B, poolOwner);
    }

    // ============ Attach Tests ============

    function test_attachHook() public {
        vm.prank(poolOwner);
        registry.attachHook(POOL_A, address(hookAll), 63);

        IVibeHookRegistry.HookConfig memory config = registry.getHookConfig(POOL_A);
        assertEq(config.hook, address(hookAll));
        assertEq(config.flags, 63);
        assertTrue(config.active);
        assertGt(config.attachedAt, 0);
    }

    function test_attachHook_revertsNotPoolOwner() public {
        vm.prank(alice);
        vm.expectRevert(IVibeHookRegistry.NotPoolOwner.selector);
        registry.attachHook(POOL_A, address(hookAll), 63);
    }

    function test_attachHook_revertsZeroAddress() public {
        vm.prank(poolOwner);
        vm.expectRevert(IVibeHookRegistry.ZeroAddress.selector);
        registry.attachHook(POOL_A, address(0), 63);
    }

    function test_attachHook_revertsAlreadyAttached() public {
        vm.prank(poolOwner);
        registry.attachHook(POOL_A, address(hookAll), 63);

        vm.prank(poolOwner);
        vm.expectRevert(IVibeHookRegistry.HookAlreadyAttached.selector);
        registry.attachHook(POOL_A, address(hookBad), 63);
    }

    function test_attachHook_revertsZeroFlags() public {
        vm.prank(poolOwner);
        vm.expectRevert(IVibeHookRegistry.InvalidFlags.selector);
        registry.attachHook(POOL_A, address(hookAll), 0);
    }

    function test_attachHook_revertsExcessiveFlags() public {
        vm.prank(poolOwner);
        vm.expectRevert(IVibeHookRegistry.InvalidFlags.selector);
        registry.attachHook(POOL_A, address(hookAll), 64);
    }

    // ============ Detach Tests ============

    function test_detachHook() public {
        vm.prank(poolOwner);
        registry.attachHook(POOL_A, address(hookAll), 63);

        vm.prank(poolOwner);
        registry.detachHook(POOL_A);

        assertFalse(registry.isHookActive(POOL_A));
    }

    function test_detachHook_revertsNotAttached() public {
        vm.prank(poolOwner);
        vm.expectRevert(IVibeHookRegistry.HookNotAttached.selector);
        registry.detachHook(POOL_A);
    }

    // ============ Update Flags Tests ============

    function test_updateHookFlags() public {
        vm.prank(poolOwner);
        registry.attachHook(POOL_A, address(hookAll), 63);

        vm.prank(poolOwner);
        registry.updateHookFlags(POOL_A, 3);

        IVibeHookRegistry.HookConfig memory config = registry.getHookConfig(POOL_A);
        assertEq(config.flags, 3);
    }

    function test_updateHookFlags_revertsNotAttached() public {
        vm.prank(poolOwner);
        vm.expectRevert(IVibeHookRegistry.HookNotAttached.selector);
        registry.updateHookFlags(POOL_A, 3);
    }

    function test_updateHookFlags_revertsInvalidFlags() public {
        vm.prank(poolOwner);
        registry.attachHook(POOL_A, address(hookAll), 63);

        vm.prank(poolOwner);
        vm.expectRevert(IVibeHookRegistry.InvalidFlags.selector);
        registry.updateHookFlags(POOL_A, 0);
    }

    // ============ View Tests ============

    function test_hasHook() public {
        vm.prank(poolOwner);
        registry.attachHook(POOL_A, address(hookAll), 5);

        assertTrue(registry.hasHook(POOL_A, IVibeHookRegistry.HookPoint.BEFORE_COMMIT));
        assertFalse(registry.hasHook(POOL_A, IVibeHookRegistry.HookPoint.AFTER_COMMIT));
        assertTrue(registry.hasHook(POOL_A, IVibeHookRegistry.HookPoint.BEFORE_SETTLE));
        assertFalse(registry.hasHook(POOL_A, IVibeHookRegistry.HookPoint.AFTER_SETTLE));
    }

    function test_isHookActive() public {
        assertFalse(registry.isHookActive(POOL_A));

        vm.prank(poolOwner);
        registry.attachHook(POOL_A, address(hookAll), 63);
        assertTrue(registry.isHookActive(POOL_A));
    }

    // ============ Admin Tests ============

    function test_setPoolOwner() public {
        registry.setPoolOwner(keccak256("NEW_POOL"), alice);

        vm.prank(alice);
        registry.attachHook(keccak256("NEW_POOL"), address(hookAll), 1);
        assertTrue(registry.isHookActive(keccak256("NEW_POOL")));
    }

    function test_setPoolOwner_revertsNotAdmin() public {
        vm.prank(alice);
        vm.expectRevert();
        registry.setPoolOwner(POOL_A, alice);
    }

    function test_setPoolOwner_revertsZeroAddress() public {
        vm.expectRevert(IVibeHookRegistry.ZeroAddress.selector);
        registry.setPoolOwner(POOL_A, address(0));
    }
}

// ============ Unit Tests — Part 2: Execution & Integration ============

contract VibeHookRegistryExecTest is Test {
    VibeHookRegistry public registry;
    MockHookAll public hookAll;
    MockHookReverting public hookBad;

    address public poolOwner;

    bytes32 constant POOL_A = keccak256("POOL_A");
    bytes32 constant POOL_B = keccak256("POOL_B");

    function setUp() public {
        poolOwner = makeAddr("poolOwner");

        registry = new VibeHookRegistry();
        hookAll = new MockHookAll();
        hookBad = new MockHookReverting();

        registry.setPoolOwner(POOL_A, poolOwner);
        registry.setPoolOwner(POOL_B, poolOwner);
    }

    function test_executeHook_beforeCommit() public {
        vm.prank(poolOwner);
        registry.attachHook(POOL_A, address(hookAll), 63);

        bytes memory result = registry.executeHook(
            POOL_A,
            IVibeHookRegistry.HookPoint.BEFORE_COMMIT,
            abi.encode("test data")
        );

        assertEq(hookAll.callCount(), 1);
        assertEq(hookAll.lastPoolId(), POOL_A);
        assertTrue(result.length > 0);
    }

    function test_executeHook_allPoints() public {
        vm.prank(poolOwner);
        registry.attachHook(POOL_A, address(hookAll), 63);

        for (uint8 i = 0; i < 6; i++) {
            registry.executeHook(POOL_A, IVibeHookRegistry.HookPoint(i), "");
        }

        assertEq(hookAll.callCount(), 6);
    }

    function test_executeHook_skipsDisabledPoint() public {
        vm.prank(poolOwner);
        registry.attachHook(POOL_A, address(hookAll), 1);

        registry.executeHook(POOL_A, IVibeHookRegistry.HookPoint.BEFORE_COMMIT, "");
        assertEq(hookAll.callCount(), 1);

        registry.executeHook(POOL_A, IVibeHookRegistry.HookPoint.AFTER_COMMIT, "");
        assertEq(hookAll.callCount(), 1);
    }

    function test_executeHook_noHookIsNoop() public {
        bytes memory result = registry.executeHook(
            POOL_A,
            IVibeHookRegistry.HookPoint.BEFORE_SWAP,
            ""
        );
        assertEq(result.length, 0);
    }

    function test_executeHook_revertingHookDoesNotPropagate() public {
        vm.prank(poolOwner);
        registry.attachHook(POOL_A, address(hookBad), 63);

        bytes memory result = registry.executeHook(
            POOL_A,
            IVibeHookRegistry.HookPoint.BEFORE_COMMIT,
            ""
        );

        assertEq(result.length, 0);
    }

    // ============ Integration Tests ============

    function test_fullLifecycle() public {
        registry.setPoolOwner(POOL_A, poolOwner);

        vm.prank(poolOwner);
        registry.attachHook(POOL_A, address(hookAll), 63);

        registry.executeHook(POOL_A, IVibeHookRegistry.HookPoint.BEFORE_COMMIT, abi.encode(42));
        registry.executeHook(POOL_A, IVibeHookRegistry.HookPoint.AFTER_COMMIT, abi.encode(42));
        registry.executeHook(POOL_A, IVibeHookRegistry.HookPoint.BEFORE_SETTLE, "");
        registry.executeHook(POOL_A, IVibeHookRegistry.HookPoint.AFTER_SETTLE, "");

        assertEq(hookAll.callCount(), 4);

        vm.prank(poolOwner);
        registry.updateHookFlags(POOL_A, 3);

        registry.executeHook(POOL_A, IVibeHookRegistry.HookPoint.BEFORE_SETTLE, "");
        assertEq(hookAll.callCount(), 4);

        vm.prank(poolOwner);
        registry.detachHook(POOL_A);
        assertFalse(registry.isHookActive(POOL_A));
    }

    function test_twoPoolsDifferentHooks() public {
        MockHookAll hook2 = new MockHookAll();

        vm.prank(poolOwner);
        registry.attachHook(POOL_A, address(hookAll), 63);

        vm.prank(poolOwner);
        registry.attachHook(POOL_B, address(hook2), 63);

        registry.executeHook(POOL_A, IVibeHookRegistry.HookPoint.BEFORE_SWAP, "");
        registry.executeHook(POOL_B, IVibeHookRegistry.HookPoint.AFTER_SWAP, "");

        assertEq(hookAll.callCount(), 1);
        assertEq(hook2.callCount(), 1);
    }
}
