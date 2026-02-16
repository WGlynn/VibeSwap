// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IRetroactiveFunding
 * @notice Interface for retroactive quadratic funding of community projects
 * @dev Treasury funds projects AFTER they demonstrate value. Quadratic funding formula
 *      ensures many small contributors outweigh single whales.
 *      Cooperative Capitalism: reward proven value, not promises.
 */
interface IRetroactiveFunding {
    // ============ Enums ============

    enum RoundState {
        NOMINATION,
        EVALUATION,
        DISTRIBUTION,
        SETTLED
    }

    // ============ Structs ============

    struct FundingRound {
        address token;
        uint256 matchPool;
        uint64 nominationEnd;
        uint64 evaluationEnd;
        RoundState state;
        uint256 totalContributions;
        uint256 totalDistributed;
        uint256 projectCount;
    }

    struct Project {
        address beneficiary;
        address nominator;
        bytes32 ipfsHash;
        uint256 communityContributions;
        uint256 contributorCount;
        uint256 sqrtSum;
        uint256 matchedAmount;
        bool claimed;
    }

    // ============ Events ============

    event RoundCreated(
        uint256 indexed roundId,
        address indexed token,
        uint256 matchPool,
        uint64 nominationEnd,
        uint64 evaluationEnd
    );

    event ProjectNominated(
        uint256 indexed roundId,
        uint256 indexed projectId,
        address indexed beneficiary,
        address nominator,
        bytes32 ipfsHash
    );

    event ContributionMade(
        uint256 indexed roundId,
        uint256 indexed projectId,
        address indexed contributor,
        uint256 amount,
        uint256 totalContribution
    );

    event RoundFinalized(
        uint256 indexed roundId,
        uint256 totalDistributed,
        uint256 projectCount
    );

    event FundsClaimed(
        uint256 indexed roundId,
        uint256 indexed projectId,
        address indexed beneficiary,
        uint256 matchedAmount,
        uint256 communityAmount
    );

    event RoundSettled(uint256 indexed roundId, uint256 unusedFunds);
    event MinNominatorTierUpdated(uint8 oldTier, uint8 newTier);
    event MaxProjectsUpdated(uint256 oldMax, uint256 newMax);

    // ============ Errors ============

    error RoundNotFound();
    error WrongPhase();
    error ProjectNotFound();
    error NotBeneficiary();
    error AlreadyClaimed();
    error NoIdentity();
    error InsufficientReputation();
    error ZeroAmount();
    error ZeroAddress();
    error MaxProjectsReached();
    error RoundNotSettleable();

    // ============ Core Functions ============

    function createRound(
        address token,
        uint256 matchPool,
        uint64 nominationEnd,
        uint64 evaluationEnd
    ) external returns (uint256 roundId);

    function nominateProject(
        uint256 roundId,
        address beneficiary,
        bytes32 ipfsHash
    ) external returns (uint256 projectId);

    function contribute(
        uint256 roundId,
        uint256 projectId,
        uint256 amount
    ) external;

    function finalizeRound(uint256 roundId) external;

    function claimFunds(uint256 roundId, uint256 projectId) external;

    function settleRound(uint256 roundId) external;

    // ============ View Functions ============

    function getRound(uint256 roundId) external view returns (FundingRound memory);

    function getProject(uint256 roundId, uint256 projectId) external view returns (Project memory);

    function getContribution(
        uint256 roundId,
        uint256 projectId,
        address contributor
    ) external view returns (uint256);

    function roundCount() external view returns (uint256);
}
