// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeID — Unified Identity Interface for VSOS
 * @notice Backed by VibeNames + AgentRegistry + SoulboundIdentity + ContributionDAG.
 *         Humans and AI agents share the same identity layer.
 */
interface IVibeID {
    /// @notice Resolve a .vibe name to an address
    function resolve(string calldata name) external view returns (address);

    /// @notice Reverse resolve an address to a .vibe name
    function reverseResolve(address addr) external view returns (string memory);

    /// @notice Get trust score for an address (from ContributionDAG)
    function getTrustScore(address account) external view returns (uint256 score, uint8 hopDistance);

    /// @notice Check if an address is a registered AI agent
    function isAgent(address account) external view returns (bool);

    /// @notice Get Shapley contribution weight for an address
    function getContributionWeight(address account) external view returns (uint256);
}
