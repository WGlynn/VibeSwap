// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IFractalShapley
 * @notice Interface for recursive attribution through contribution DAGs.
 *
 * Git commits are flat attribution — they record WHO typed the code but not
 * WHO INSPIRED the code. This contract fixes that. Every contribution declares
 * its parents (inspirations), and when rewards flow to a contribution, credit
 * propagates backward through the influence chain.
 *
 * Architecture:
 *   [Contribution Registry]   — atomic claims: "this work happened, inspired by X,Y,Z"
 *           ↓
 *   [Influence DAG]           — edges: "this work was inspired by / builds on"
 *           ↓
 *   [Credit Propagation]      — Shapley: "therefore Alice gets X% of Bob's reward"
 *
 * See: primitive_fractalized-shapley-games.md
 */
interface IFractalShapley {

    // ============ Structs ============

    /// @notice A registered contribution with its influence parents
    struct Contribution {
        bytes32 id;                // Unique ID (commit hash, hypercert, arbitrary)
        address contributor;       // Who created this contribution
        bytes32[] parents;         // Parent contributions that inspired this one
        uint256 timestamp;
        uint256 totalReward;       // Cumulative rewards earned by this contribution
        uint256 propagatedCredit;  // Cumulative credit propagated to parents
    }

    /// @notice Result of a credit propagation computation
    struct CreditAllocation {
        address recipient;         // Who receives credit
        bytes32 contributionId;    // Which contribution earned this credit
        uint256 amount;            // Credit amount
        uint8 depth;               // Hops from the rewarded contribution
    }

    /// @notice An attestation that a parent claim is valid
    struct Attestation {
        address attester;
        bytes32 childId;
        bytes32 parentId;
        uint256 timestamp;
    }

    // ============ Events ============

    event ContributionRegistered(
        bytes32 indexed id,
        address indexed contributor,
        bytes32[] parents,
        uint256 timestamp
    );

    event CreditPropagated(
        bytes32 indexed sourceContribution,
        bytes32 indexed parentContribution,
        address indexed recipient,
        uint256 amount,
        uint8 depth
    );

    event InspirationAttested(
        bytes32 indexed childId,
        bytes32 indexed parentId,
        address indexed attester
    );

    event PropagationDecayUpdated(uint256 oldDecay, uint256 newDecay);
    event MaxDepthUpdated(uint8 oldDepth, uint8 newDepth);

    // ============ Core Functions ============

    /// @notice Register a new contribution with its inspirations
    /// @param id Unique identifier (commit hash, hypercert ID, etc.)
    /// @param parents Array of parent contribution IDs that inspired this work
    function registerContribution(
        bytes32 id,
        bytes32[] calldata parents
    ) external;

    /// @notice Compute credit allocation for a contribution's reward
    /// @param contributionId The contribution being rewarded
    /// @param rewardAmount The total reward amount
    /// @return allocations Array of credit allocations (direct + upstream)
    function computeCredit(
        bytes32 contributionId,
        uint256 rewardAmount
    ) external view returns (CreditAllocation[] memory allocations);

    /// @notice Distribute rewards with fractal credit propagation
    /// @dev Calls computeCredit, then actually distributes tokens
    /// @param contributionId The contribution being rewarded
    /// @param rewardAmount Amount to distribute
    /// @param token Token to distribute (address(0) for ETH)
    function distributeWithPropagation(
        bytes32 contributionId,
        uint256 rewardAmount,
        address token
    ) external payable;

    /// @notice Attest that a parent-child influence relationship is valid
    /// @param childId The contribution that claims influence
    /// @param parentId The contribution claimed as inspiration
    function attestInspiration(bytes32 childId, bytes32 parentId) external;

    // ============ View Functions ============

    /// @notice Get a contribution's full data
    function getContribution(bytes32 id) external view returns (Contribution memory);

    /// @notice Get all children of a contribution (who was inspired by this)
    function getChildren(bytes32 id) external view returns (bytes32[] memory);

    /// @notice Get attestation count for a parent-child edge
    function getAttestationCount(bytes32 childId, bytes32 parentId) external view returns (uint256);

    /// @notice Check if a contribution exists
    function contributionExists(bytes32 id) external view returns (bool);

    /// @notice Get total credit propagated to a contributor across all contributions
    function getTotalCreditReceived(address contributor) external view returns (uint256);
}
