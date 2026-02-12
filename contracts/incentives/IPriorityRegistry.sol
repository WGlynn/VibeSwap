// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPriorityRegistry
 * @notice Interface for querying first-to-publish priority records
 * @dev Used by ShapleyDistributor to look up pioneer scores without tight coupling
 */
interface IPriorityRegistry {
    function getPioneerScore(address participant, bytes32 scopeId) external view returns (uint256);
    function isPioneer(address participant, bytes32 scopeId) external view returns (bool);
}

/// @notice Extended interface for authorized recorders
interface IPriorityRecorder {
    function recordPoolCreation(bytes32 scopeId, address pioneer) external;
}
