// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IQuadraticVoting
 * @notice Interface for quadratic voting governance
 * @dev Cost of N votes = N^2 JUL tokens. Whale-resistant governance where
 *      intensity of preference is expressed through quadratic cost scaling.
 *      Cooperative Capitalism: amplifies community voice over capital concentration.
 */
interface IQuadraticVoting {
    // ============ Enums ============

    enum ProposalState {
        PENDING,
        ACTIVE,
        DEFEATED,
        SUCCEEDED,
        EXECUTED,
        EXPIRED
    }

    // ============ Structs ============

    struct Proposal {
        address proposer;
        string description;
        bytes32 ipfsHash;
        uint64 startTime;
        uint64 endTime;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 totalTokensLocked;
        ProposalState state;
    }

    struct VoterPosition {
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 tokensLocked;
        bool withdrawn;
    }

    // ============ Events ============

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        string description,
        bytes32 ipfsHash,
        uint64 startTime,
        uint64 endTime
    );

    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        bool support,
        uint256 numVotes,
        uint256 tokenCost
    );

    event ProposalFinalized(uint256 indexed proposalId, ProposalState state);
    event TokensWithdrawn(uint256 indexed proposalId, address indexed voter, uint256 amount);
    event QuorumUpdated(uint256 oldQuorum, uint256 newQuorum);
    event MinProposerTierUpdated(uint8 oldTier, uint8 newTier);
    event ProposalThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event VotingDurationUpdated(uint256 oldDuration, uint256 newDuration);

    // ============ Errors ============

    error ProposalNotFound();
    error ProposalNotActive();
    error ProposalNotFinalized();
    error ProposalAlreadyFinalized();
    error ProposalExpired();
    error InsufficientBalance();
    error InsufficientReputation();
    error NoIdentity();
    error BelowProposalThreshold();
    error ZeroVotes();
    error AlreadyWithdrawn();
    error VotingNotEnded();
    error VotingEnded();
    error NoTokensToWithdraw();

    // ============ Core Functions ============

    function createProposal(
        string calldata description,
        bytes32 ipfsHash
    ) external returns (uint256 proposalId);

    function castVote(
        uint256 proposalId,
        bool support,
        uint256 numVotes
    ) external;

    function finalizeProposal(uint256 proposalId) external;

    function withdrawTokens(uint256 proposalId) external;

    // ============ View Functions ============

    function voteCost(uint256 numVotes) external pure returns (uint256);

    function getProposal(uint256 proposalId) external view returns (Proposal memory);

    function getVoterPosition(
        uint256 proposalId,
        address voter
    ) external view returns (VoterPosition memory);

    function proposalCount() external view returns (uint256);
}
