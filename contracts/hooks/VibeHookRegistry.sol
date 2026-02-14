// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IVibeHookRegistry.sol";
import "./interfaces/IVibeHook.sol";

/**
 * @title VibeHookRegistry
 * @notice Pre/post swap hooks on pools (Uniswap V4 style).
 * @dev Part of VSOS (VibeSwap Operating System) Protocol Framework.
 *
 *      Third parties attach hook logic (fees, rewards, compliance)
 *      to pools without modifying core protocol contracts.
 *
 *      Hook points map to VibeSwap's commit-reveal auction flow:
 *        - beforeCommit / afterCommit: order submission phase
 *        - beforeSettle / afterSettle: batch settlement phase
 *        - beforeSwap / afterSwap: AMM direct swap path
 *
 *      Security model:
 *        - Pool owners control which hook is attached to their pool
 *        - Protocol admin manages pool owner assignments
 *        - Hooks execute in a try/catch — failures are logged, not fatal
 *        - Gas limit on hook execution prevents griefing
 *
 *      Flag bitmap:
 *        bit 0 = BEFORE_COMMIT  (1)
 *        bit 1 = AFTER_COMMIT   (2)
 *        bit 2 = BEFORE_SETTLE  (4)
 *        bit 3 = AFTER_SETTLE   (8)
 *        bit 4 = BEFORE_SWAP    (16)
 *        bit 5 = AFTER_SWAP     (32)
 */
contract VibeHookRegistry is Ownable, IVibeHookRegistry {
    // ============ Constants ============

    uint8 public constant MAX_FLAGS = 63; // 6 bits: 111111
    uint256 public constant HOOK_GAS_LIMIT = 500_000;

    // ============ State ============

    mapping(bytes32 => HookConfig) private _hookConfigs;
    mapping(bytes32 => address) private _poolOwners;

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Modifiers ============

    modifier onlyPoolOwner(bytes32 poolId) {
        if (_poolOwners[poolId] != msg.sender) revert NotPoolOwner();
        _;
    }

    // ============ Pool Owner Functions ============

    /**
     * @notice Attach a hook contract to a pool.
     * @param poolId The pool identifier
     * @param hook The hook contract address (must implement IVibeHook)
     * @param flags Bitmap of enabled hook points
     */
    function attachHook(
        bytes32 poolId,
        address hook,
        uint8 flags
    ) external onlyPoolOwner(poolId) {
        if (hook == address(0)) revert ZeroAddress();
        if (_hookConfigs[poolId].active) revert HookAlreadyAttached();
        if (flags == 0 || flags > MAX_FLAGS) revert InvalidFlags();

        _hookConfigs[poolId] = HookConfig({
            hook: hook,
            flags: flags,
            attachedAt: uint40(block.timestamp),
            active: true
        });

        emit HookAttached(poolId, hook, flags);
    }

    /**
     * @notice Detach a hook from a pool.
     */
    function detachHook(bytes32 poolId) external onlyPoolOwner(poolId) {
        if (!_hookConfigs[poolId].active) revert HookNotAttached();

        address hook = _hookConfigs[poolId].hook;
        delete _hookConfigs[poolId];

        emit HookDetached(poolId, hook);
    }

    /**
     * @notice Update which hook points are enabled.
     */
    function updateHookFlags(bytes32 poolId, uint8 newFlags) external onlyPoolOwner(poolId) {
        if (!_hookConfigs[poolId].active) revert HookNotAttached();
        if (newFlags == 0 || newFlags > MAX_FLAGS) revert InvalidFlags();

        _hookConfigs[poolId].flags = newFlags;
        emit HookUpdated(poolId, newFlags);
    }

    // ============ Execution Functions ============

    /**
     * @notice Execute a hook for a pool at a specific hook point.
     * @dev Called by protocol contracts (CommitRevealAuction, VibeAMM, etc.)
     *      during their execution flow.
     *
     *      Non-reverting: if the hook fails, logs the failure and returns empty.
     *      This prevents malicious hooks from blocking protocol operations.
     */
    function executeHook(
        bytes32 poolId,
        HookPoint point,
        bytes calldata data
    ) external returns (bytes memory) {
        HookConfig storage config = _hookConfigs[poolId];

        // No hook or not active — silent no-op
        if (!config.active) return "";

        // Check if this hook point is enabled
        uint8 flag = uint8(1 << uint8(point));
        if (config.flags & flag == 0) return "";

        // Build selector based on hook point
        bytes4 selector = _hookSelector(point);

        // Low-level call with gas limit (avoids Yul stack-too-deep from try/catch chain)
        (bool success, bytes memory returnData) = config.hook.call{gas: HOOK_GAS_LIMIT}(
            abi.encodeWithSelector(selector, poolId, data)
        );

        emit HookExecuted(poolId, point, success);

        if (success && returnData.length > 0) {
            return abi.decode(returnData, (bytes));
        }
        return "";
    }

    function _hookSelector(HookPoint point) internal pure returns (bytes4) {
        if (point == HookPoint.BEFORE_COMMIT) return IVibeHook.beforeCommit.selector;
        if (point == HookPoint.AFTER_COMMIT) return IVibeHook.afterCommit.selector;
        if (point == HookPoint.BEFORE_SETTLE) return IVibeHook.beforeSettle.selector;
        if (point == HookPoint.AFTER_SETTLE) return IVibeHook.afterSettle.selector;
        if (point == HookPoint.BEFORE_SWAP) return IVibeHook.beforeSwap.selector;
        return IVibeHook.afterSwap.selector;
    }

    // ============ Admin Functions ============

    /**
     * @notice Assign a pool owner. Only protocol admin.
     */
    function setPoolOwner(bytes32 poolId, address poolOwner) external onlyOwner {
        if (poolOwner == address(0)) revert ZeroAddress();
        _poolOwners[poolId] = poolOwner;
        emit PoolOwnerSet(poolId, poolOwner);
    }

    // ============ View Functions ============

    function getHookConfig(bytes32 poolId) external view returns (HookConfig memory) {
        return _hookConfigs[poolId];
    }

    function hasHook(bytes32 poolId, HookPoint point) external view returns (bool) {
        HookConfig storage config = _hookConfigs[poolId];
        if (!config.active) return false;
        uint8 flag = uint8(1 << uint8(point));
        return (config.flags & flag) != 0;
    }

    function isHookActive(bytes32 poolId) external view returns (bool) {
        return _hookConfigs[poolId].active;
    }
}
