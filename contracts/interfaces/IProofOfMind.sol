// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IProofOfMind — Hybrid PoW/PoS/PoM Consensus Interface
 * @notice The only way to hack the system is to contribute to it.
 *         Cumulative cognitive work as an economic barrier to attack.
 */
interface IProofOfMind {
    /// @notice Get a node's combined vote weight (30% stake + 10% PoW + 60% mind)
    function getVoteWeight(address node) external view returns (uint256);

    /// @notice Record a verified cognitive contribution
    function recordContribution(address contributor, bytes32 contributionHash, uint256 mindValue) external;

    /// @notice Cast a PoW-backed vote in a consensus round
    function castVote(uint256 roundId, bytes32 value, uint256 powNonce) external;

    /// @notice Get attack cost estimate (stake + compute + mind + time)
    function getAttackCost() external view returns (
        uint256 stakeNeeded,
        uint256 computeDifficulty,
        uint256 mindScoreNeeded,
        uint256 timeEstimateYears
    );

    /// @notice Register as a meta node (client-side P2P, no voting power)
    function registerMetaNode(string calldata endpoint, address[] calldata trinityPeers) external;

    /// @notice Get all active meta nodes
    function getActiveMetaNodes() external view returns (address[] memory);

    /// @notice Get round result
    function getRoundResult(uint256 roundId) external view returns (
        bytes32 winningValue,
        uint256 totalWeight,
        uint256 participantCount,
        bool finalized
    );
}
