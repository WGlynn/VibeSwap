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
 *         Each function returns (bool success, bytes returnData).
 *         The registry checks success — if false, behavior depends
 *         on whether the hook point is mandatory or optional.
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
