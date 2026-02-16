// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IConvictionGovernance
 * @notice Interface for conviction-weighted governance
 * @dev Conviction = stake x duration. Long-term holders shape governance,
 *      not flash-loan attackers. Dynamic threshold: bigger asks need more conviction.
 *      Cooperative Capitalism: patient capital over speculative manipulation.
 */
interface IConvictionGovernance {
    // ============ Enums ============

    enum GovernanceProposalState {
        ACTIVE,
        PASSED,
        REJECTED,
        EXECUTED,
        EXPIRED
    }

    // ============ Structs ============

    struct GovernanceProposal {
        address proposer;
        string description;
        bytes32 ipfsHash;
        uint64 startTime;
        uint64 maxDuration;
        uint256 requestedAmount;
        GovernanceProposalState state;
    }

    struct ConvictionState {
        uint256 totalStake;
        uint256 stakeTimeProd;
    }

    struct StakerPosition {
        uint256 amount;
        uint64 signalTime;
    }

    // ============ Events ============

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        string description,
        uint256 requestedAmount,
        uint64 maxDuration
    );

    event ConvictionSignaled(
        uint256 indexed proposalId,
        address indexed staker,
        uint256 amount
    );

    event ConvictionRemoved(
        uint256 indexed proposalId,
        address indexed staker,
        uint256 amount
    );

    event ProposalPassed(uint256 indexed proposalId, uint256 conviction, uint256 threshold);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalExpired(uint256 indexed proposalId);
    event ProposalRejected(uint256 indexed proposalId);

    event BaseThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event ThresholdMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier);
    event MaxDurationUpdated(uint256 oldDuration, uint256 newDuration);

    // ============ Errors ============

    error ProposalNotFound();
    error ProposalNotActive();
    error ProposalNotPassed();
    error ProposalAlreadyFinalized();
    error ProposalNotExpired();
    error ZeroAmount();
    error ZeroRequestedAmount();
    error NoIdentity();
    error InsufficientReputation();
    error AlreadyStaking();
    error NotStaking();
    error ThresholdNotMet();
    error InsufficientBalance();
    error NotResolver();

    // ============ Core Functions ============

    function createProposal(
        string calldata description,
        bytes32 ipfsHash,
        uint256 requestedAmount
    ) external returns (uint256 proposalId);

    function signalConviction(uint256 proposalId, uint256 amount) external;

    function removeSignal(uint256 proposalId) external;

    function triggerPass(uint256 proposalId) external;

    function executeProposal(uint256 proposalId) external;

    function expireProposal(uint256 proposalId) external;

    // ============ View Functions ============

    function getConviction(uint256 proposalId) external view returns (uint256);

    function getThreshold(uint256 proposalId) external view returns (uint256);

    function getProposal(uint256 proposalId) external view returns (GovernanceProposal memory);

    function getStakerPosition(
        uint256 proposalId,
        address staker
    ) external view returns (StakerPosition memory);

    function proposalCount() external view returns (uint256);
}
