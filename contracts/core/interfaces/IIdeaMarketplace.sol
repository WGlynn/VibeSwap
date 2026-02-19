// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IIdeaMarketplace
 * @notice Interface for the Idea Marketplace — Freedom's concept brought on-chain.
 *         Non-coders submit ideas, system assigns bounty, builders claim and execute,
 *         Shapley splits rewards between ideator and executor.
 *
 * Core flow:
 * 1. Ideator submits idea (stakes VIBE as anti-spam)
 * 2. Authorized scorers rate feasibility/impact/novelty
 * 3. Auto-threshold: <15 reject, >=24 approve, 15-23 pending review
 * 4. Builder claims bounty (stakes collateral, gets exclusive build rights)
 * 5. Builder submits proof of completion
 * 6. Approval triggers Shapley reward split (default 40% ideator / 60% builder)
 *
 * Integration:
 * - Reads ContributionDAG.isReferralExcluded() for referral checks
 * - Creates ShapleyDistributor games for reward splits
 * - Uses VIBE token (IERC20) for staking and bounties
 */
interface IIdeaMarketplace {

    // ============ Enums ============

    enum IdeaStatus {
        OPEN,           // Submitted, awaiting scoring
        CLAIMED,        // Builder claimed, not yet started
        IN_PROGRESS,    // Builder actively working
        REVIEW,         // Work submitted, awaiting approval
        COMPLETED,      // Approved and rewards distributed
        REJECTED,       // Auto-rejected by scoring threshold
        DISPUTED        // Under dispute resolution
    }

    enum IdeaCategory {
        UX,             // User experience improvements
        PROTOCOL,       // Protocol-level changes
        TOOLING,        // Developer tooling
        GROWTH,         // Growth and marketing
        SECURITY        // Security improvements
    }

    // ============ Structs ============

    struct Idea {
        uint256 id;
        address author;
        string title;
        bytes32 descriptionHash;    // IPFS hash
        IdeaCategory category;
        uint256 bountyAmount;
        IdeaStatus status;
        address builder;
        uint256 createdAt;
        uint256 claimedAt;
        uint256 completedAt;
        uint256 score;              // Aggregate score from scorers
        bytes32 proofHash;          // IPFS hash of completion proof
    }

    struct IdeaScore {
        uint8 feasibility;          // 0-10
        uint8 impact;               // 0-10
        uint8 novelty;              // 0-10
    }

    // ============ Events ============

    event IdeaSubmitted(
        uint256 indexed ideaId,
        address indexed author,
        IdeaCategory category,
        string title,
        uint256 bountyAmount
    );

    event IdeaScored(
        uint256 indexed ideaId,
        address indexed scorer,
        uint8 feasibility,
        uint8 impact,
        uint8 novelty,
        uint256 totalScore
    );

    event IdeaAutoApproved(uint256 indexed ideaId, uint256 totalScore);
    event IdeaAutoRejected(uint256 indexed ideaId, uint256 totalScore);

    event BountyClaimed(
        uint256 indexed ideaId,
        address indexed builder,
        uint256 collateralStaked,
        uint256 deadline
    );

    event WorkSubmitted(
        uint256 indexed ideaId,
        address indexed builder,
        bytes32 proofHash
    );

    event WorkApproved(
        uint256 indexed ideaId,
        address indexed builder,
        uint256 ideatorReward,
        uint256 builderReward
    );

    event IdeaDisputed(
        uint256 indexed ideaId,
        address indexed disputedBy,
        bytes32 reasonHash
    );

    event ClaimCancelled(
        uint256 indexed ideaId,
        address indexed builder,
        uint256 collateralSlashed
    );

    event ScorerUpdated(address indexed scorer, bool authorized);
    event BountyFunded(uint256 indexed ideaId, address indexed funder, uint256 amount);

    // ============ Errors ============

    error IdeaNotFound();
    error InvalidStatus();
    error NotAuthor();
    error NotBuilder();
    error NotScorer();
    error AlreadyScored();
    error AlreadyClaimed();
    error DeadlineExpired();
    error DeadlineNotExpired();
    error InsufficientStake();
    error InsufficientCollateral();
    error ReferralExcluded();
    error InvalidScore();
    error ZeroAddress();
    error EmptyTitle();
    error SelfClaim();

    // ============ Core Functions ============

    /// @notice Submit a new idea to the marketplace
    /// @param title Human-readable title
    /// @param descriptionHash IPFS hash of full description
    /// @param category Idea category
    /// @return ideaId The newly created idea's ID
    function submitIdea(
        string calldata title,
        bytes32 descriptionHash,
        IdeaCategory category
    ) external returns (uint256 ideaId);

    /// @notice Score an idea on feasibility, impact, and novelty
    /// @param ideaId The idea to score
    /// @param feasibility Score 0-10
    /// @param impact Score 0-10
    /// @param novelty Score 0-10
    function scoreIdea(
        uint256 ideaId,
        uint8 feasibility,
        uint8 impact,
        uint8 novelty
    ) external;

    /// @notice Claim exclusive build rights on an approved idea
    /// @param ideaId The idea to claim
    function claimBounty(uint256 ideaId) external;

    /// @notice Submit proof of completed work
    /// @param ideaId The idea being worked on
    /// @param proofHash IPFS hash of proof-of-completion
    function submitWork(uint256 ideaId, bytes32 proofHash) external;

    /// @notice Approve submitted work and trigger Shapley reward split
    /// @param ideaId The idea to approve
    function approveWork(uint256 ideaId) external;

    /// @notice Dispute work quality or idea ownership
    /// @param ideaId The idea to dispute
    /// @param reasonHash IPFS hash of dispute reason
    function disputeWork(uint256 ideaId, bytes32 reasonHash) external;

    /// @notice Builder cancels claim (loses collateral, idea reopens)
    /// @param ideaId The idea to abandon
    function cancelClaim(uint256 ideaId) external;

    // ============ View Functions ============

    /// @notice Get full idea details
    function getIdea(uint256 ideaId) external view returns (Idea memory);

    /// @notice Get ideas by status with pagination
    function getIdeasByStatus(IdeaStatus status, uint256 offset, uint256 limit)
        external view returns (Idea[] memory);

    /// @notice Get ideas by category with pagination
    function getIdeasByCategory(IdeaCategory category, uint256 offset, uint256 limit)
        external view returns (Idea[] memory);

    /// @notice Get ideas submitted by a specific author
    function getIdeasByAuthor(address author) external view returns (uint256[] memory);

    /// @notice Get ideas claimed by a specific builder
    function getIdeasByBuilder(address builder) external view returns (uint256[] memory);

    /// @notice Get the builder's deadline for completing an idea
    function getDeadline(uint256 ideaId) external view returns (uint256);

    /// @notice Get total number of ideas
    function totalIdeas() external view returns (uint256);

    /// @notice Check if a scorer has already scored an idea
    function hasScored(uint256 ideaId, address scorer) external view returns (bool);

    /// @notice Get the number of scorers for an idea
    function getScorerCount(uint256 ideaId) external view returns (uint256);

    // ============ Cross-Contract Integration ============

    /// @notice Create a prediction market for an idea's success
    function createIdeaMarket(
        uint256 ideaId,
        address collateralToken,
        uint256 liquidityParam,
        uint64 lockTime,
        uint64 resolutionDeadline
    ) external returns (uint256 marketId);

    /// @notice Report actual impact of a completed idea (feedback loop)
    function reportOutcome(uint256 ideaId, uint256 actualImpact) external;

    /// @notice Anchor a technical specification to an idea
    function anchorIdeaSpec(
        uint256 ideaId,
        bytes32 merkleRoot,
        bytes32 contentCID,
        uint256 nodeCount,
        uint256 edgeCount
    ) external returns (bytes32 graphId);

    /// @notice Get submitter's prediction accuracy
    function getSubmitterAccuracy(address submitter) external view returns (
        uint256 accuracyBps, uint256 completed, uint256 successes
    );

    /// @notice Get prediction market price for an idea
    function getIdeaMarketPrice(uint256 ideaId) external view returns (uint256 yesPrice);

    // ============ Events (Cross-Contract) ============

    event IdeaMarketCreated(uint256 indexed ideaId, uint256 indexed marketId);
    event IdeaOutcomeReported(uint256 indexed ideaId, uint256 predictedScore, uint256 actualImpact);
    event IdeaSpecAnchored(uint256 indexed ideaId, bytes32 indexed graphId);

    // ============ Errors (Cross-Contract) ============

    error MarketAlreadyExists();
    error OutcomeAlreadyReported();
    error IdeaNotCompleted();
    error PredictionMarketNotSet();
    error ContextAnchorNotSet();
}
