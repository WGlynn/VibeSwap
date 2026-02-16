// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ICommitRevealGovernance
 * @notice Interface for commit-reveal governance voting
 * @dev Applies the CommitRevealAuction pattern to governance votes.
 *      Eliminates bandwagoning, vote-buying, and last-minute swing manipulation.
 *      Cooperative Capitalism: authentic preference revelation over strategic voting.
 */
interface ICommitRevealGovernance {
    // ============ Enums ============

    enum VotePhase {
        COMMIT,
        REVEAL,
        TALLY,
        EXECUTED
    }

    enum VoteChoice {
        NONE,
        FOR,
        AGAINST,
        ABSTAIN
    }

    // ============ Structs ============

    struct GovernanceVote {
        address proposer;
        string description;
        bytes32 ipfsHash;
        VotePhase phase;
        uint64 commitEnd;
        uint64 revealEnd;
        uint256 forWeight;
        uint256 againstWeight;
        uint256 abstainWeight;
        uint256 commitCount;
        uint256 revealCount;
        uint256 slashedDeposits;
        bool executed;
    }

    struct VoteCommitment {
        bytes32 commitHash;
        uint256 deposit;
        address voter;
        bool revealed;
        VoteChoice choice;
        uint256 weight;
    }

    // ============ Events ============

    event VoteCreated(
        uint256 indexed voteId,
        address indexed proposer,
        string description,
        uint64 commitEnd,
        uint64 revealEnd
    );

    event VoteCommitted(
        uint256 indexed voteId,
        bytes32 indexed commitId,
        address indexed voter,
        uint256 deposit
    );

    event VoteRevealed(
        uint256 indexed voteId,
        bytes32 indexed commitId,
        address indexed voter,
        VoteChoice choice,
        uint256 weight
    );

    event VoteTallied(
        uint256 indexed voteId,
        uint256 forWeight,
        uint256 againstWeight,
        uint256 abstainWeight,
        bool passed
    );

    event UnrevealedSlashed(
        uint256 indexed voteId,
        bytes32 indexed commitId,
        address indexed voter,
        uint256 slashAmount
    );

    event VoteExecuted(uint256 indexed voteId);
    event MinDepositUpdated(uint256 oldDeposit, uint256 newDeposit);
    event SlashRateUpdated(uint256 oldRate, uint256 newRate);
    event QuorumUpdated(uint256 oldQuorum, uint256 newQuorum);
    event DefaultDurationsUpdated(uint256 commitDuration, uint256 revealDuration);
    event ResolverAdded(address indexed resolver);
    event ResolverRemoved(address indexed resolver);

    // ============ Errors ============

    error VoteNotFound();
    error WrongPhase();
    error InsufficientDeposit();
    error AlreadyCommitted();
    error CommitmentNotFound();
    error InvalidReveal();
    error AlreadyRevealed();
    error QuorumNotMet();
    error AlreadyExecuted();
    error NotResolver();
    error InsufficientReputation();
    error NoIdentity();
    error NotSlashable();
    error VoteNotPassed();

    // ============ Core Functions ============

    function createVote(
        string calldata description,
        bytes32 ipfsHash
    ) external returns (uint256 voteId);

    function commitVote(
        uint256 voteId,
        bytes32 commitHash
    ) external payable returns (bytes32 commitId);

    function revealVote(
        uint256 voteId,
        bytes32 commitId,
        VoteChoice choice,
        bytes32 secret
    ) external;

    function tallyVotes(uint256 voteId) external;

    function slashUnrevealed(uint256 voteId, bytes32 commitId) external;

    function executeVote(uint256 voteId) external;

    // ============ View Functions ============

    function getVote(uint256 voteId) external view returns (GovernanceVote memory);

    function getCommitment(bytes32 commitId) external view returns (VoteCommitment memory);

    function voteCount() external view returns (uint256);
}
