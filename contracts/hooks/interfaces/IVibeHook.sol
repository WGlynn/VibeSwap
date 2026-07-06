// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeHook
 * @notice Interface that hook contracts must implement.
 *
 *         Part of VSOS (VibeSwap Operating System) Protocol Framework.
 *
 *         Hook contracts are attached to pools via VibeHookRegistry.
 *         They receive callbacks at configured hook points and can
 *         inspect/modify pool state within the callback.
 *
 *         Each function returns a single `bytes memory` of hook-defined data
 *         (no leading success bool). VibeHookRegistry.executeHook determines
 *         success from the low-level call status, not the payload. For
 *         ShapleyAttributionHook the first decoded field of afterSwap is
 *         `escalate` (bool), not success.
 */
interface IVibeHook {
    function beforeCommit(bytes32 poolId, bytes calldata data) external returns (bytes memory);
    function afterCommit(bytes32 poolId, bytes calldata data) external returns (bytes memory);
    function beforeSettle(bytes32 poolId, bytes calldata data) external returns (bytes memory);
    function afterSettle(bytes32 poolId, bytes calldata data) external returns (bytes memory);
    function beforeSwap(bytes32 poolId, bytes calldata data) external returns (bytes memory);
    function afterSwap(bytes32 poolId, bytes calldata data) external returns (bytes memory);

    /// @notice Which hook points this contract supports (bitmap).
    function getHookFlags() external view returns (uint8);
}
