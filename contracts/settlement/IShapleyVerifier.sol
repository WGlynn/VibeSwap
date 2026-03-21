// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IShapleyVerifier
 * @notice Interface for consuming verified off-chain Shapley values
 * @dev Used by ShapleyDistributor to accept pre-verified results
 *      instead of computing on-chain — execution/settlement separation.
 */
interface IShapleyVerifier {
    function getVerifiedValues(bytes32 gameId) external view returns (address[] memory, uint256[] memory);
    function getVerifiedTotalPool(bytes32 gameId) external view returns (uint256);
    function isFinalized(bytes32 gameId) external view returns (bool);
}
