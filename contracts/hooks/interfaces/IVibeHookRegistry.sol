// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeHookRegistry
 * @notice Pre/post swap hooks on pools — third parties attach logic
 *         (fees, rewards, compliance) without modifying core contracts.
 *
 *         Part of VSOS (VibeSwap Operating System) Protocol Framework.
 *
 *         Inspired by Uniswap V4 hooks, but adapted for VibeSwap's
 *         commit-reveal batch auction architecture:
 *
 *         Hook points:
 *           - beforeCommit: validate/modify before order commitment
 *           - afterCommit: track, log, or gate after commitment
 *           - beforeSettle: pre-settlement checks (compliance, circuit breaker)
 *           - afterSettle: post-settlement actions (rewards, rebalance, LP updates)
 *           - beforeSwap: pre-swap validation (AMM direct swaps)
 *           - afterSwap: post-swap effects (fee collection, event emission)
 *
 *         Each pool can have up to one hook contract. The hook contract
 *         declares which hook points it implements via a flags bitmap.
 *
 *         Hook contracts must implement IVibeHook interface.
 *         Only approved hooks (via VibePluginRegistry) can be attached.
 */
interface IVibeHookRegistry {
    // ============ Enums ============

    /// @notice Hook execution points (bitmap flags)
    /// @dev Each flag is a power of 2 for bitmap operations
    enum HookPoint {
        BEFORE_COMMIT,    // 0 → flag 1
        AFTER_COMMIT,     // 1 → flag 2
        BEFORE_SETTLE,    // 2 → flag 4
        AFTER_SETTLE,     // 3 → flag 8
        BEFORE_SWAP,      // 4 → flag 16
        AFTER_SWAP        // 5 → flag 32
    }

    // ============ Structs ============

    /// @notice Hook configuration for a pool
    struct HookConfig {
        address hook;          // Hook contract address (implements IVibeHook)
        uint8 flags;           // Bitmap of enabled hook points
        uint40 attachedAt;     // When hook was attached
        bool active;           // Can be deactivated by pool owner
    }

    // ============ Events ============

    event HookAttached(bytes32 indexed poolId, address indexed hook, uint8 flags);
    event HookDetached(bytes32 indexed poolId, address indexed hook);
    event HookUpdated(bytes32 indexed poolId, uint8 newFlags);
    event HookExecuted(bytes32 indexed poolId, HookPoint point, bool success);
    event PoolOwnerSet(bytes32 indexed poolId, address indexed owner);

    // ============ Errors ============

    error ZeroAddress();
    error NotPoolOwner();
    error HookAlreadyAttached();
    error HookNotAttached();
    error InvalidFlags();
    error HookExecutionFailed();

    // ============ Pool Owner Functions ============

    function attachHook(bytes32 poolId, address hook, uint8 flags) external;
    function detachHook(bytes32 poolId) external;
    function updateHookFlags(bytes32 poolId, uint8 newFlags) external;

    // ============ Execution Functions (called by protocol) ============

    function executeHook(bytes32 poolId, HookPoint point, bytes calldata data) external returns (bytes memory);

    // ============ Admin Functions ============

    function setPoolOwner(bytes32 poolId, address poolOwner) external;

    // ============ View Functions ============

    function getHookConfig(bytes32 poolId) external view returns (HookConfig memory);
    function hasHook(bytes32 poolId, HookPoint point) external view returns (bool);
    function isHookActive(bytes32 poolId) external view returns (bool);
}
