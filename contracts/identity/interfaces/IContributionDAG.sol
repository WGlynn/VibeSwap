// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IContributionDAG
 * @notice Interface for the on-chain trust DAG (Web of Trust).
 *         Port of frontend/src/utils/trustChain.js
 *
 * Core concepts:
 * - Vouch: One-way endorsement from one identity to another
 * - Handshake: Bidirectional vouch (mutual trust confirmation)
 * - Trust Score: BFS distance-based decay from founder nodes
 * - Referral Quality: Your trust is weighted by who you vouched for
 * - Diversity Score: Penalizes insular echo-chamber clusters
 */
interface IContributionDAG {

    // ============ Structs ============

    struct Vouch {
        uint256 timestamp;
        bytes32 messageHash; // IPFS hash of endorsement message
    }

    struct Handshake {
        address user1;
        address user2;
        uint256 timestamp;
    }

    struct TrustScore {
        uint256 score;           // 0–1e18 (PRECISION scale)
        uint8 hopsFromFounder;   // BFS distance
        bool isFounder;
        address[] trustChain;    // Path from founder to user
    }

    // ============ Events ============

    event VouchAdded(address indexed from, address indexed to, bytes32 messageHash);
    event VouchRevoked(address indexed from, address indexed to);
    event HandshakeConfirmed(address indexed user1, address indexed user2);
    event HandshakeRevoked(address indexed user1, address indexed user2);
    event TrustScoresRecalculated(uint256 usersScored);
    event FounderAdded(address indexed founder);
    event FounderRemoved(address indexed founder);
    event ReferralExclusionSet(address indexed account, bool excluded);

    // ============ Errors ============

    error CannotVouchSelf();
    error MaxVouchesReached();
    error VouchAlreadyExists();
    error VouchCooldown(uint256 remaining);
    error NoVouchExists();
    error NoIdentity();
    error AlreadyFounder();
    error NotFounder();
    error MaxFoundersReached();

    // ============ Core Functions ============

    /// @notice Add a directed vouch (endorsement) toward another identity
    /// @param to Address being vouched for
    /// @param messageHash IPFS hash of endorsement message (0x0 = none)
    /// @return isHandshake True if this creates a bidirectional handshake
    function addVouch(address to, bytes32 messageHash) external returns (bool isHandshake);

    /// @notice Add a vouch on behalf of a verified human (bridge pattern)
    /// @dev Only callable by authorized bridges (e.g., AgentRegistry)
    /// @param from Address doing the vouching (must be verified by bridge)
    /// @param to Address being vouched for
    /// @param messageHash IPFS hash of endorsement message
    /// @return isHandshake True if this creates a bidirectional handshake
    function addVouchOnBehalf(address from, address to, bytes32 messageHash) external returns (bool isHandshake);

    /// @notice Revoke a previously given vouch
    /// @param to Address whose vouch is being revoked
    function revokeVouch(address to) external;

    /// @notice Recalculate trust scores via BFS from founders
    /// @dev Gas-bounded by MAX_TRUST_HOPS (6). Anyone can call.
    function recalculateTrustScores() external;

    // ============ View Functions ============

    /// @notice Get full trust score data for an address
    function getTrustScore(address user) external view returns (
        uint256 score,
        string memory level,
        uint256 multiplier,
        uint8 hops,
        address[] memory trustChain
    );

    /// @notice Get voting power multiplier (BPS) for an address
    function getVotingPowerMultiplier(address user) external view returns (uint256);

    /// @notice Calculate referral quality score for a user
    function calculateReferralQuality(address user) external view returns (
        uint256 score,
        uint256 penalty
    );

    /// @notice Calculate diversity score for a user
    function calculateDiversityScore(address user) external view returns (
        uint256 score,
        uint256 penalty
    );

    /// @notice Check if a vouch exists from→to
    function hasVouch(address from, address to) external view returns (bool);

    /// @notice Check if a handshake exists between two addresses
    function hasHandshake(address user1, address user2) external view returns (bool);

    /// @notice Get all addresses a user has vouched for
    function getVouchesFrom(address user) external view returns (address[] memory);

    /// @notice Get all addresses that have vouched for a user
    function getVouchesFor(address user) external view returns (address[] memory);

    /// @notice Check if an address is a founder
    function isFounder(address user) external view returns (bool);

    /// @notice Get all founders
    function getFounders() external view returns (address[] memory);

    /// @notice Get total handshake count
    function getHandshakeCount() external view returns (uint256);

    /// @notice Check if an address is excluded from referral bonuses
    function isReferralExcluded(address account) external view returns (bool);
}
