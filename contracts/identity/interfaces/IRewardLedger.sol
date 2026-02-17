// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IRewardLedger
 * @notice Interface for retroactive + active Shapley reward tracking.
 *         Port of frontend/src/utils/shapleyTrust.js
 *
 * Two modes:
 * 1. Retroactive: Owner submits pre-launch contributions with Shapley weights.
 *    Contributors claim tokens after governance approval (finalizeRetroactive).
 * 2. Active: Authorized contracts record value events in real-time.
 *    Rewards distributed via trust-chain-weighted Shapley.
 *
 * Shapley axioms enforced:
 * - Efficiency: All realized value is distributed
 * - Symmetry: Equal contributors rewarded equally
 * - Null player: No contribution = no reward
 * - No inflation: Rewards cannot exceed realized value
 */
interface IRewardLedger {

    // ============ Enums ============

    enum EventType {
        CONTRIBUTION,
        MECHANISM_DESIGN,
        CODE,
        TRADE,
        REFERRAL,
        GOVERNANCE,
        GITHUB_COMMIT,
        GITHUB_PR,
        GITHUB_REVIEW,
        GITHUB_ISSUE
    }

    // ============ Structs ============

    struct ValueEvent {
        bytes32 eventId;
        EventType eventType;
        address actor;
        uint256 value;
        uint256 timestamp;
        bool distributed;
    }

    // ============ Events ============

    event RetroactiveContributionRecorded(
        bytes32 indexed eventId,
        address indexed contributor,
        uint256 value,
        EventType eventType
    );
    event RetroactiveFinalized(uint256 totalRetroactiveValue);
    event ValueEventRecorded(
        bytes32 indexed eventId,
        address indexed actor,
        uint256 value,
        EventType eventType
    );
    event EventDistributed(
        bytes32 indexed eventId,
        uint256 totalDistributed,
        uint256 chainLength
    );
    event RetroactiveClaimed(address indexed user, uint256 amount);
    event ActiveClaimed(address indexed user, uint256 amount);
    event AuthorizedCallerSet(address indexed caller, bool authorized);

    // ============ Errors ============

    error RetroactiveAlreadyFinalized();
    error RetroactiveNotFinalized();
    error ZeroValue();
    error EventAlreadyExists();
    error EventNotFound();
    error EventAlreadyDistributed();
    error NothingToClaim();
    error UnauthorizedCaller();
    error ZeroAddress();
    error EmptyTrustChain();
    error TransferFailed();

    // ============ Retroactive Functions ============

    /// @notice Record a pre-launch contribution (owner only, before finalization)
    function recordRetroactiveContribution(
        address contributor,
        uint256 value,
        EventType eventType,
        bytes32 ipfsHash
    ) external;

    /// @notice Lock retroactive submissions and enable claims
    function finalizeRetroactive() external;

    // ============ Active Functions ============

    /// @notice Record a real-time value event (authorized callers only)
    function recordValueEvent(
        address actor,
        uint256 value,
        EventType eventType,
        address[] calldata trustChain
    ) external returns (bytes32 eventId);

    /// @notice Distribute a recorded event's value along trust chain via Shapley
    function distributeEvent(bytes32 eventId) external;

    // ============ Claim Functions ============

    /// @notice Claim retroactive rewards (pull pattern)
    function claimRetroactive() external;

    /// @notice Claim active rewards (pull pattern)
    function claimActive() external;

    // ============ View Functions ============

    /// @notice Get retroactive balance for an address
    function getRetroactiveBalance(address user) external view returns (uint256);

    /// @notice Get active balance for an address
    function getActiveBalance(address user) external view returns (uint256);

    /// @notice Get total distributed amounts
    function getTotalDistributed() external view returns (
        uint256 totalRetroactive,
        uint256 totalActive
    );

    /// @notice Check if retroactive phase is finalized
    function isRetroactiveFinalized() external view returns (bool);

    /// @notice Get a value event by ID
    function getValueEvent(bytes32 eventId) external view returns (ValueEvent memory);

    /// @notice Get distribution for a specific user in an event
    function getEventDistribution(bytes32 eventId, address user) external view returns (uint256);
}
