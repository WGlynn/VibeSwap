// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IReputationOracle
 * @notice Minimal interface for cross-contract reputation queries
 */
interface IReputationOracle {
    function getTrustScore(address user) external view returns (uint256 score);
    function getTrustTier(address user) external view returns (uint8 tier);
    function isEligible(address user, uint8 requiredTier) external view returns (bool);
}
