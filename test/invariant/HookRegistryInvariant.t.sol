// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/hooks/VibeHookRegistry.sol";
import "../../contracts/hooks/interfaces/IVibeHookRegistry.sol";
import "../../contracts/hooks/interfaces/IVibeHook.sol";

// ============ Mock ============

contract InvariantMockHook is IVibeHook {
    function beforeCommit(bytes32, bytes calldata) external pure returns (bytes memory) { return ""; }
    function afterCommit(bytes32, bytes calldata) external pure returns (bytes memory) { return ""; }
    function beforeSettle(bytes32, bytes calldata) external pure returns (bytes memory) { return ""; }
    function afterSettle(bytes32, bytes calldata) external pure returns (bytes memory) { return ""; }
    function beforeSwap(bytes32, bytes calldata) external pure returns (bytes memory) { return ""; }
    function afterSwap(bytes32, bytes calldata) external pure returns (bytes memory) { return ""; }
    function getHookFlags() external pure returns (uint8) { return 63; }
}

// ============ Handler ============

contract HookRegistryHandler is Test {
    VibeHookRegistry public registry;
    InvariantMockHook public hook;
    address public admin;
    address public poolOwner;

    // Ghost variables
    uint256 public ghost_attachCount;
    uint256 public ghost_detachCount;
    uint256 public ghost_updateCount;
    uint256 public ghost_executeCount;

    bytes32[] public pools;
    mapping(bytes32 => bool) public ghost_isAttached;

    constructor(VibeHookRegistry _registry, InvariantMockHook _hook, address _admin, address _poolOwner) {
        registry = _registry;
        hook = _hook;
        admin = _admin;
        poolOwner = _poolOwner;
    }

    function attachHook(uint8 seed) external {
        bytes32 poolId = keccak256(abi.encodePacked("pool", seed, ghost_attachCount));

        // Admin sets pool owner
        vm.prank(admin);
        registry.setPoolOwner(poolId, poolOwner);

        uint8 flags = uint8(bound(seed, 1, 63));

        vm.prank(poolOwner);
        registry.attachHook(poolId, address(hook), flags);

        pools.push(poolId);
        ghost_isAttached[poolId] = true;
        ghost_attachCount++;
    }

    function detachHook(uint256 index) external {
        if (pools.length == 0) return;
        index = bound(index, 0, pools.length - 1);
        bytes32 poolId = pools[index];

        if (!ghost_isAttached[poolId]) return;

        vm.prank(poolOwner);
        registry.detachHook(poolId);

        ghost_isAttached[poolId] = false;
        ghost_detachCount++;
    }

    function updateFlags(uint256 index, uint8 newFlags) external {
        if (pools.length == 0) return;
        index = bound(index, 0, pools.length - 1);
        bytes32 poolId = pools[index];

        if (!ghost_isAttached[poolId]) return;

        newFlags = uint8(bound(newFlags, 1, 63));

        vm.prank(poolOwner);
        registry.updateHookFlags(poolId, newFlags);

        ghost_updateCount++;
    }

    function executeHook(uint256 index, uint8 point) external {
        if (pools.length == 0) return;
        index = bound(index, 0, pools.length - 1);
        point = uint8(bound(point, 0, 5));

        bytes32 poolId = pools[index];
        registry.executeHook(poolId, IVibeHookRegistry.HookPoint(point), "");
        ghost_executeCount++;
    }

    function poolCount() external view returns (uint256) {
        return pools.length;
    }

    function getPool(uint256 i) external view returns (bytes32) {
        return pools[i];
    }
}

// ============ Invariant Tests ============

contract HookRegistryInvariantTest is StdInvariant, Test {
    VibeHookRegistry public registry;
    InvariantMockHook public hook;
    HookRegistryHandler public handler;

    address public admin;
    address public poolOwner;

    function setUp() public {
        admin = address(this);
        poolOwner = makeAddr("poolOwner");

        registry = new VibeHookRegistry();
        hook = new InvariantMockHook();
        handler = new HookRegistryHandler(registry, hook, admin, poolOwner);

        targetContract(address(handler));
    }

    /// @notice Active hooks always have valid flags (1-63)
    function invariant_activeFlagsAlwaysValid() public view {
        uint256 count = handler.poolCount();
        for (uint256 i = 0; i < count; i++) {
            bytes32 poolId = handler.getPool(i);
            IVibeHookRegistry.HookConfig memory config = registry.getHookConfig(poolId);
            if (config.active) {
                assertGt(config.flags, 0, "Active hook must have flags > 0");
                assertLe(config.flags, 63, "Active hook must have flags <= 63");
            }
        }
    }

    /// @notice Active hooks always have a non-zero hook address
    function invariant_activeHookHasAddress() public view {
        uint256 count = handler.poolCount();
        for (uint256 i = 0; i < count; i++) {
            bytes32 poolId = handler.getPool(i);
            IVibeHookRegistry.HookConfig memory config = registry.getHookConfig(poolId);
            if (config.active) {
                assertTrue(config.hook != address(0), "Active hook must have non-zero address");
            }
        }
    }

    /// @notice Ghost tracking matches on-chain state
    function invariant_ghostMatchesOnChain() public view {
        uint256 count = handler.poolCount();
        for (uint256 i = 0; i < count; i++) {
            bytes32 poolId = handler.getPool(i);
            bool onChain = registry.isHookActive(poolId);
            bool ghost = handler.ghost_isAttached(poolId);
            assertEq(onChain, ghost, "Ghost must match on-chain active state");
        }
    }

    /// @notice hasHook returns true only for bits set in flags
    function invariant_hasHookMatchesFlags() public view {
        uint256 count = handler.poolCount();
        for (uint256 i = 0; i < count; i++) {
            bytes32 poolId = handler.getPool(i);
            IVibeHookRegistry.HookConfig memory config = registry.getHookConfig(poolId);
            if (!config.active) continue;

            for (uint8 p = 0; p < 6; p++) {
                bool flagSet = (config.flags & (1 << p)) != 0;
                bool hookExists = registry.hasHook(poolId, IVibeHookRegistry.HookPoint(p));
                assertEq(flagSet, hookExists, "hasHook must match flag bitmap");
            }
        }
    }

    /// @notice Detached pools are fully cleared
    function invariant_detachedPoolsCleared() public view {
        uint256 count = handler.poolCount();
        for (uint256 i = 0; i < count; i++) {
            bytes32 poolId = handler.getPool(i);
            if (!handler.ghost_isAttached(poolId)) {
                IVibeHookRegistry.HookConfig memory config = registry.getHookConfig(poolId);
                assertFalse(config.active, "Detached pool must not be active");
                assertEq(config.hook, address(0), "Detached pool must have zero hook");
                assertEq(config.flags, 0, "Detached pool must have zero flags");
            }
        }
    }

    function invariant_callSummary() public view {
        // Just log activity for debugging
        handler.ghost_attachCount();
        handler.ghost_detachCount();
        handler.ghost_updateCount();
        handler.ghost_executeCount();
    }
}
