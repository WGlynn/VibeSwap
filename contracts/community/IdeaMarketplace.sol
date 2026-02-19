// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../core/interfaces/IIdeaMarketplace.sol";
import "../identity/interfaces/IContributionDAG.sol";

/**
 * @title IdeaMarketplace
 * @notice Freedom's Idea Marketplace — non-coders submit ideas, builders execute,
 *         Shapley splits rewards between ideator and executor.
 *
 * @dev Composable contract that reads:
 *      - ContributionDAG for referral exclusion checks
 *      - VIBE token (IERC20) for staking and bounties
 *
 * Flow:
 * 1. Anyone submits an idea (stakes VIBE as anti-spam)
 * 2. Authorized scorers rate feasibility/impact/novelty (each 0-10)
 * 3. Auto-threshold on average total score:
 *    - totalScore < 15 => auto-reject (REJECTED)
 *    - totalScore >= 24 => auto-approve (stays OPEN for claiming)
 *    - 15-23 => pending manual review
 * 4. Builder claims bounty (stakes collateral, gets exclusive build rights + deadline)
 * 5. Builder submits proof of completion (IPFS hash)
 * 6. Owner/governance approves => Shapley reward split (default 40% ideator / 60% builder)
 *
 * Anti-spam: Configurable VIBE token stake required to submit ideas.
 * Builder collateral: Slashed on abandon/timeout, returned on approval.
 * Shapley split: Configurable per-idea (default 40/60 ideator/builder).
 *
 * Philosophy: "Cooperative Capitalism" — ideas have intrinsic value, execution has
 * time-bound value. Both are rewarded via cooperative game theory.
 */
contract IdeaMarketplace is
    IIdeaMarketplace,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant BPS_PRECISION = 10000;

    /// @notice Maximum individual score per dimension (feasibility, impact, novelty)
    uint8 public constant MAX_SCORE = 10;

    /// @notice Auto-reject threshold: average totalScore < 15
    uint256 public constant AUTO_REJECT_THRESHOLD = 15;

    /// @notice Auto-approve threshold: average totalScore >= 24
    uint256 public constant AUTO_APPROVE_THRESHOLD = 24;

    /// @notice Maximum total score per scorer (3 dimensions * 10 max each)
    uint256 public constant MAX_TOTAL_SCORE = 30;

    // ============ State ============

    /// @notice VIBE token used for staking and bounties
    IERC20 public vibeToken;

    /// @notice ContributionDAG for referral exclusion checks
    IContributionDAG public contributionDAG;

    /// @notice Minimum VIBE stake required to submit an idea (anti-spam)
    uint256 public minIdeaStake;

    /// @notice Builder collateral required (BPS of bounty amount)
    uint256 public builderCollateralBps;

    /// @notice Default build deadline in seconds (7 days)
    uint256 public buildDeadline;

    /// @notice Default ideator share in BPS (40%)
    uint256 public defaultIdeatorShareBps;

    /// @notice Default builder share in BPS (60%)
    uint256 public defaultBuilderShareBps;

    /// @notice Minimum number of scorers before thresholds apply
    uint256 public minScorers;

    /// @notice Next idea ID counter
    uint256 private _nextIdeaId;

    /// @notice Idea ID => Idea data
    mapping(uint256 => Idea) private _ideas;

    /// @notice Idea ID => per-idea ideator share override (0 = use default)
    mapping(uint256 => uint256) public ideatorShareOverride;

    /// @notice Idea ID => scorer address => IdeaScore
    mapping(uint256 => mapping(address => IdeaScore)) private _scores;

    /// @notice Idea ID => scorer address => has scored
    mapping(uint256 => mapping(address => bool)) private _hasScored;

    /// @notice Idea ID => number of scorers
    mapping(uint256 => uint256) private _scorerCount;

    /// @notice Idea ID => sum of all totalScores (for averaging)
    mapping(uint256 => uint256) private _scoreSums;

    /// @notice Authorized scorers
    mapping(address => bool) public scorers;

    /// @notice Builder collateral held per idea
    mapping(uint256 => uint256) public builderCollateral;

    /// @notice Ideator stake held per idea (returned on completion/rejection)
    mapping(uint256 => uint256) public ideatorStake;

    /// @notice Status => list of idea IDs
    mapping(IdeaStatus => uint256[]) private _ideasByStatus;

    /// @notice Category => list of idea IDs
    mapping(IdeaCategory => uint256[]) private _ideasByCategory;

    /// @notice Author => list of idea IDs
    mapping(address => uint256[]) private _ideasByAuthor;

    /// @notice Builder => list of idea IDs claimed
    mapping(address => uint256[]) private _ideasByBuilder;

    /// @notice Treasury address for slashed collateral
    address public treasury;

    // ============ Modifiers ============

    modifier ideaExists(uint256 ideaId) {
        if (ideaId == 0 || ideaId >= _nextIdeaId) revert IdeaNotFound();
        _;
    }

    modifier onlyScorer() {
        if (!scorers[msg.sender] && msg.sender != owner()) revert NotScorer();
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the IdeaMarketplace
     * @param _vibeToken VIBE ERC20 token address
     * @param _contributionDAG ContributionDAG contract address
     * @param _treasury Treasury address for slashed collateral
     */
    function initialize(
        address _vibeToken,
        address _contributionDAG,
        address _treasury
    ) public initializer {
        if (_vibeToken == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();

        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        vibeToken = IERC20(_vibeToken);
        contributionDAG = IContributionDAG(_contributionDAG);
        treasury = _treasury;

        // Defaults
        minIdeaStake = 100e18;              // 100 VIBE
        builderCollateralBps = 1000;        // 10% of bounty
        buildDeadline = 7 days;
        defaultIdeatorShareBps = 4000;      // 40%
        defaultBuilderShareBps = 6000;      // 60%
        minScorers = 3;

        _nextIdeaId = 1;
    }

    // ============ Core Functions ============

    /**
     * @notice Submit a new idea to the marketplace
     * @dev Requires minimum VIBE stake (anti-spam). Stake is held in escrow
     *      and returned when the idea is completed or rejected.
     *      Checks ContributionDAG.isReferralExcluded() — excluded addresses cannot submit.
     * @param title Human-readable title
     * @param descriptionHash IPFS hash of full description
     * @param category Idea category
     * @return ideaId The newly created idea's ID
     */
    function submitIdea(
        string calldata title,
        bytes32 descriptionHash,
        IdeaCategory category
    ) external nonReentrant returns (uint256 ideaId) {
        if (bytes(title).length == 0) revert EmptyTitle();
        if (descriptionHash == bytes32(0)) revert EmptyTitle(); // reuse error for empty content

        // Referral exclusion check
        if (address(contributionDAG) != address(0)) {
            if (contributionDAG.isReferralExcluded(msg.sender)) {
                revert ReferralExcluded();
            }
        }

        // Transfer VIBE stake (anti-spam)
        vibeToken.safeTransferFrom(msg.sender, address(this), minIdeaStake);

        ideaId = _nextIdeaId++;

        _ideas[ideaId] = Idea({
            id: ideaId,
            author: msg.sender,
            title: title,
            descriptionHash: descriptionHash,
            category: category,
            bountyAmount: 0,
            status: IdeaStatus.OPEN,
            builder: address(0),
            createdAt: block.timestamp,
            claimedAt: 0,
            completedAt: 0,
            score: 0,
            proofHash: bytes32(0)
        });

        ideatorStake[ideaId] = minIdeaStake;

        // Track by status, category, and author
        _ideasByStatus[IdeaStatus.OPEN].push(ideaId);
        _ideasByCategory[category].push(ideaId);
        _ideasByAuthor[msg.sender].push(ideaId);

        emit IdeaSubmitted(ideaId, msg.sender, category, title, 0);

        return ideaId;
    }

    /**
     * @notice Score an idea on three dimensions
     * @dev Only authorized scorers can score. Each scorer can score once per idea.
     *      After minScorers have scored, auto-threshold is applied:
     *      - Average totalScore < 15 => auto-reject
     *      - Average totalScore >= 24 => auto-approve
     *      - 15-23 => pending manual review (stays OPEN)
     * @param ideaId The idea to score
     * @param feasibility 0-10 feasibility score
     * @param impact 0-10 impact score
     * @param novelty 0-10 novelty score
     */
    function scoreIdea(
        uint256 ideaId,
        uint8 feasibility,
        uint8 impact,
        uint8 novelty
    ) external ideaExists(ideaId) onlyScorer {
        Idea storage idea = _ideas[ideaId];
        if (idea.status != IdeaStatus.OPEN) revert InvalidStatus();
        if (_hasScored[ideaId][msg.sender]) revert AlreadyScored();
        if (feasibility > MAX_SCORE || impact > MAX_SCORE || novelty > MAX_SCORE) {
            revert InvalidScore();
        }

        // Record score
        _scores[ideaId][msg.sender] = IdeaScore({
            feasibility: feasibility,
            impact: impact,
            novelty: novelty
        });
        _hasScored[ideaId][msg.sender] = true;

        uint256 totalScore = uint256(feasibility) + uint256(impact) + uint256(novelty);
        _scoreSums[ideaId] += totalScore;
        _scorerCount[ideaId]++;

        // Update idea's average score
        uint256 avgScore = _scoreSums[ideaId] / _scorerCount[ideaId];
        idea.score = avgScore;

        emit IdeaScored(ideaId, msg.sender, feasibility, impact, novelty, avgScore);

        // Apply auto-thresholds if enough scorers
        if (_scorerCount[ideaId] >= minScorers) {
            if (avgScore < AUTO_REJECT_THRESHOLD) {
                _transitionStatus(ideaId, IdeaStatus.REJECTED);
                // Return ideator stake on rejection
                _returnIdeatorStake(ideaId);
                emit IdeaAutoRejected(ideaId, avgScore);
            } else if (avgScore >= AUTO_APPROVE_THRESHOLD) {
                // Stays OPEN but is now approved for claiming
                emit IdeaAutoApproved(ideaId, avgScore);
            }
            // 15-23 range: stays OPEN, pending manual review
        }
    }

    /**
     * @notice Fund the bounty for an idea
     * @dev Anyone can add VIBE tokens to an idea's bounty pool.
     *      Idea must be OPEN (approved or pending).
     * @param ideaId The idea to fund
     * @param amount VIBE token amount to add
     */
    function fundBounty(uint256 ideaId, uint256 amount) external nonReentrant ideaExists(ideaId) {
        Idea storage idea = _ideas[ideaId];
        if (idea.status != IdeaStatus.OPEN) revert InvalidStatus();
        if (amount == 0) revert InsufficientStake();

        vibeToken.safeTransferFrom(msg.sender, address(this), amount);
        idea.bountyAmount += amount;

        emit BountyFunded(ideaId, msg.sender, amount);
    }

    /**
     * @notice Claim exclusive build rights on an approved idea
     * @dev Requires:
     *      - Idea is OPEN with score >= AUTO_APPROVE_THRESHOLD (or owner-approved)
     *      - Builder stakes collateral (builderCollateralBps % of bounty)
     *      - Builder cannot be the idea author (prevents self-dealing)
     *      - Builder not referral-excluded
     *      - Sets deadline = now + buildDeadline
     * @param ideaId The idea to claim
     */
    function claimBounty(uint256 ideaId) external nonReentrant ideaExists(ideaId) {
        Idea storage idea = _ideas[ideaId];
        if (idea.status != IdeaStatus.OPEN) revert InvalidStatus();
        if (idea.builder != address(0)) revert AlreadyClaimed();
        if (msg.sender == idea.author) revert SelfClaim();

        // Must have been scored and auto-approved (or manually approved)
        if (_scorerCount[ideaId] >= minScorers && idea.score < AUTO_APPROVE_THRESHOLD) {
            revert InvalidStatus();
        }

        // Referral exclusion check
        if (address(contributionDAG) != address(0)) {
            if (contributionDAG.isReferralExcluded(msg.sender)) {
                revert ReferralExcluded();
            }
        }

        // Calculate and transfer collateral
        uint256 collateral = (idea.bountyAmount * builderCollateralBps) / BPS_PRECISION;
        if (collateral > 0) {
            vibeToken.safeTransferFrom(msg.sender, address(this), collateral);
        }
        builderCollateral[ideaId] = collateral;

        // Assign builder and transition
        idea.builder = msg.sender;
        idea.claimedAt = block.timestamp;
        _transitionStatus(ideaId, IdeaStatus.CLAIMED);
        _ideasByBuilder[msg.sender].push(ideaId);

        uint256 deadline = block.timestamp + buildDeadline;

        emit BountyClaimed(ideaId, msg.sender, collateral, deadline);
    }

    /**
     * @notice Mark idea as in-progress (builder acknowledgment)
     * @dev Transitions from CLAIMED to IN_PROGRESS. Only the assigned builder.
     * @param ideaId The idea being worked on
     */
    function startWork(uint256 ideaId) external ideaExists(ideaId) {
        Idea storage idea = _ideas[ideaId];
        if (idea.status != IdeaStatus.CLAIMED) revert InvalidStatus();
        if (msg.sender != idea.builder) revert NotBuilder();

        _transitionStatus(ideaId, IdeaStatus.IN_PROGRESS);
    }

    /**
     * @notice Submit proof of completed work
     * @dev Builder submits IPFS hash of completion proof. Must be within deadline.
     *      Transitions to REVIEW status for approval.
     * @param ideaId The idea being worked on
     * @param proofHash IPFS hash of proof-of-completion
     */
    function submitWork(
        uint256 ideaId,
        bytes32 proofHash
    ) external ideaExists(ideaId) {
        Idea storage idea = _ideas[ideaId];
        if (idea.status != IdeaStatus.CLAIMED && idea.status != IdeaStatus.IN_PROGRESS) {
            revert InvalidStatus();
        }
        if (msg.sender != idea.builder) revert NotBuilder();
        if (proofHash == bytes32(0)) revert EmptyTitle(); // reuse for empty content
        if (block.timestamp > idea.claimedAt + buildDeadline) revert DeadlineExpired();

        idea.proofHash = proofHash;
        _transitionStatus(ideaId, IdeaStatus.REVIEW);

        emit WorkSubmitted(ideaId, msg.sender, proofHash);
    }

    /**
     * @notice Approve submitted work and trigger Shapley reward split
     * @dev Only owner/governance can approve. Distributes bounty:
     *      - Ideator gets ideatorShareBps (default 40%)
     *      - Builder gets builderShareBps (default 60%)
     *      - Builder collateral is returned
     *      - Ideator stake is returned
     * @param ideaId The idea to approve
     */
    function approveWork(uint256 ideaId) external nonReentrant ideaExists(ideaId) onlyOwner {
        Idea storage idea = _ideas[ideaId];
        if (idea.status != IdeaStatus.REVIEW) revert InvalidStatus();

        idea.completedAt = block.timestamp;
        _transitionStatus(ideaId, IdeaStatus.COMPLETED);

        // Calculate Shapley split
        uint256 ideatorBps = ideatorShareOverride[ideaId] > 0
            ? ideatorShareOverride[ideaId]
            : defaultIdeatorShareBps;
        uint256 builderBps = BPS_PRECISION - ideatorBps;

        uint256 bounty = idea.bountyAmount;
        uint256 ideatorReward = (bounty * ideatorBps) / BPS_PRECISION;
        uint256 builderReward = bounty - ideatorReward; // remainder to builder (no dust)

        // Distribute rewards
        if (ideatorReward > 0) {
            vibeToken.safeTransfer(idea.author, ideatorReward);
        }
        if (builderReward > 0) {
            vibeToken.safeTransfer(idea.builder, builderReward);
        }

        // Return builder collateral
        uint256 collateral = builderCollateral[ideaId];
        if (collateral > 0) {
            builderCollateral[ideaId] = 0;
            vibeToken.safeTransfer(idea.builder, collateral);
        }

        // Return ideator stake
        _returnIdeatorStake(ideaId);

        emit WorkApproved(ideaId, idea.builder, ideatorReward, builderReward);
    }

    /**
     * @notice Dispute work quality or idea ownership
     * @dev Either the ideator or builder can dispute. Transitions to DISPUTED status
     *      for external resolution (e.g., DecentralizedTribunal).
     * @param ideaId The idea to dispute
     * @param reasonHash IPFS hash of dispute reason
     */
    function disputeWork(
        uint256 ideaId,
        bytes32 reasonHash
    ) external ideaExists(ideaId) {
        Idea storage idea = _ideas[ideaId];
        // Can dispute during REVIEW or IN_PROGRESS
        if (idea.status != IdeaStatus.REVIEW &&
            idea.status != IdeaStatus.IN_PROGRESS &&
            idea.status != IdeaStatus.CLAIMED) {
            revert InvalidStatus();
        }
        // Only ideator or builder can dispute
        if (msg.sender != idea.author && msg.sender != idea.builder) {
            revert NotAuthor();
        }

        _transitionStatus(ideaId, IdeaStatus.DISPUTED);

        emit IdeaDisputed(ideaId, msg.sender, reasonHash);
    }

    /**
     * @notice Builder cancels their claim (loses collateral, idea reopens)
     * @dev Collateral is sent to treasury. Idea returns to OPEN status.
     * @param ideaId The idea to abandon
     */
    function cancelClaim(uint256 ideaId) external nonReentrant ideaExists(ideaId) {
        Idea storage idea = _ideas[ideaId];
        if (idea.status != IdeaStatus.CLAIMED &&
            idea.status != IdeaStatus.IN_PROGRESS) {
            revert InvalidStatus();
        }
        if (msg.sender != idea.builder) revert NotBuilder();

        // Slash collateral to treasury
        uint256 collateral = builderCollateral[ideaId];
        if (collateral > 0) {
            builderCollateral[ideaId] = 0;
            vibeToken.safeTransfer(treasury, collateral);
        }

        // Reset builder and reopen
        address slashedBuilder = idea.builder;
        idea.builder = address(0);
        idea.claimedAt = 0;
        idea.proofHash = bytes32(0);
        _transitionStatus(ideaId, IdeaStatus.OPEN);

        emit ClaimCancelled(ideaId, slashedBuilder, collateral);
    }

    /**
     * @notice Reclaim an expired idea (builder missed deadline)
     * @dev Anyone can call this after the builder's deadline has passed.
     *      Builder loses collateral, idea reopens for new claims.
     * @param ideaId The idea with expired deadline
     */
    function reclaimExpired(uint256 ideaId) external nonReentrant ideaExists(ideaId) {
        Idea storage idea = _ideas[ideaId];
        if (idea.status != IdeaStatus.CLAIMED &&
            idea.status != IdeaStatus.IN_PROGRESS) {
            revert InvalidStatus();
        }
        if (block.timestamp <= idea.claimedAt + buildDeadline) {
            revert DeadlineNotExpired();
        }

        // Slash collateral to treasury
        uint256 collateral = builderCollateral[ideaId];
        if (collateral > 0) {
            builderCollateral[ideaId] = 0;
            vibeToken.safeTransfer(treasury, collateral);
        }

        // Reset builder and reopen
        address expiredBuilder = idea.builder;
        idea.builder = address(0);
        idea.claimedAt = 0;
        idea.proofHash = bytes32(0);
        _transitionStatus(ideaId, IdeaStatus.OPEN);

        emit ClaimCancelled(ideaId, expiredBuilder, collateral);
    }

    // ============ View Functions ============

    /// @inheritdoc IIdeaMarketplace
    function getIdea(uint256 ideaId) external view returns (Idea memory) {
        return _ideas[ideaId];
    }

    /// @inheritdoc IIdeaMarketplace
    function getIdeasByStatus(
        IdeaStatus status,
        uint256 offset,
        uint256 limit
    ) external view returns (Idea[] memory) {
        uint256[] storage ids = _ideasByStatus[status];
        return _paginateIdeas(ids, offset, limit);
    }

    /// @inheritdoc IIdeaMarketplace
    function getIdeasByCategory(
        IdeaCategory category,
        uint256 offset,
        uint256 limit
    ) external view returns (Idea[] memory) {
        uint256[] storage ids = _ideasByCategory[category];
        return _paginateIdeas(ids, offset, limit);
    }

    /// @inheritdoc IIdeaMarketplace
    function getIdeasByAuthor(address author) external view returns (uint256[] memory) {
        return _ideasByAuthor[author];
    }

    /// @inheritdoc IIdeaMarketplace
    function getIdeasByBuilder(address builder) external view returns (uint256[] memory) {
        return _ideasByBuilder[builder];
    }

    /// @inheritdoc IIdeaMarketplace
    function getDeadline(uint256 ideaId) external view ideaExists(ideaId) returns (uint256) {
        Idea storage idea = _ideas[ideaId];
        if (idea.claimedAt == 0) return 0;
        return idea.claimedAt + buildDeadline;
    }

    /// @inheritdoc IIdeaMarketplace
    function totalIdeas() external view returns (uint256) {
        return _nextIdeaId - 1;
    }

    /// @inheritdoc IIdeaMarketplace
    function hasScored(uint256 ideaId, address scorer) external view returns (bool) {
        return _hasScored[ideaId][scorer];
    }

    /// @inheritdoc IIdeaMarketplace
    function getScorerCount(uint256 ideaId) external view returns (uint256) {
        return _scorerCount[ideaId];
    }

    /**
     * @notice Get an individual scorer's scores for an idea
     * @param ideaId The idea
     * @param scorer The scorer address
     * @return The IdeaScore struct
     */
    function getScore(uint256 ideaId, address scorer) external view returns (IdeaScore memory) {
        return _scores[ideaId][scorer];
    }

    // ============ Admin Functions ============

    /**
     * @notice Set authorized scorer status
     * @param scorer Address to authorize/deauthorize
     * @param authorized Whether to authorize
     */
    function setScorer(address scorer, bool authorized) external onlyOwner {
        if (scorer == address(0)) revert ZeroAddress();
        scorers[scorer] = authorized;
        emit ScorerUpdated(scorer, authorized);
    }

    /**
     * @notice Set minimum VIBE stake for submitting ideas
     * @param _minStake New minimum stake amount
     */
    function setMinIdeaStake(uint256 _minStake) external onlyOwner {
        minIdeaStake = _minStake;
    }

    /**
     * @notice Set builder collateral requirement in BPS
     * @param _collateralBps Collateral as basis points of bounty
     */
    function setBuilderCollateralBps(uint256 _collateralBps) external onlyOwner {
        require(_collateralBps <= BPS_PRECISION, "Collateral exceeds 100%");
        builderCollateralBps = _collateralBps;
    }

    /**
     * @notice Set build deadline in seconds
     * @param _deadline New deadline duration
     */
    function setBuildDeadline(uint256 _deadline) external onlyOwner {
        require(_deadline >= 1 days, "Deadline too short");
        buildDeadline = _deadline;
    }

    /**
     * @notice Set default Shapley split (must sum to BPS_PRECISION)
     * @param _ideatorBps Ideator share in BPS
     * @param _builderBps Builder share in BPS
     */
    function setDefaultSplit(uint256 _ideatorBps, uint256 _builderBps) external onlyOwner {
        require(_ideatorBps + _builderBps == BPS_PRECISION, "Split must sum to 10000");
        defaultIdeatorShareBps = _ideatorBps;
        defaultBuilderShareBps = _builderBps;
    }

    /**
     * @notice Override Shapley split for a specific idea
     * @param ideaId The idea to override
     * @param _ideatorBps Ideator share in BPS (builder gets remainder)
     */
    function setIdeaSplit(uint256 ideaId, uint256 _ideatorBps) external onlyOwner ideaExists(ideaId) {
        require(_ideatorBps <= BPS_PRECISION, "Ideator share exceeds 100%");
        ideatorShareOverride[ideaId] = _ideatorBps;
    }

    /**
     * @notice Set minimum number of scorers before auto-thresholds apply
     * @param _minScorers New minimum scorers
     */
    function setMinScorers(uint256 _minScorers) external onlyOwner {
        require(_minScorers >= 1, "Need at least 1 scorer");
        minScorers = _minScorers;
    }

    /**
     * @notice Set the treasury address for slashed collateral
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }

    /**
     * @notice Set the ContributionDAG contract (address(0) to disable checks)
     * @param _contributionDAG New ContributionDAG address
     */
    function setContributionDAG(address _contributionDAG) external onlyOwner {
        contributionDAG = IContributionDAG(_contributionDAG);
    }

    /**
     * @notice Resolve a disputed idea (owner/governance decision)
     * @dev Can transition to COMPLETED (with rewards) or OPEN (reopen for new builder)
     * @param ideaId The disputed idea
     * @param approve True = approve and distribute rewards, False = reopen
     */
    function resolveDispute(uint256 ideaId, bool approve) external nonReentrant onlyOwner ideaExists(ideaId) {
        Idea storage idea = _ideas[ideaId];
        if (idea.status != IdeaStatus.DISPUTED) revert InvalidStatus();

        if (approve) {
            // Approve the work — same logic as approveWork
            idea.completedAt = block.timestamp;
            _transitionStatus(ideaId, IdeaStatus.COMPLETED);

            uint256 ideatorBps = ideatorShareOverride[ideaId] > 0
                ? ideatorShareOverride[ideaId]
                : defaultIdeatorShareBps;

            uint256 bounty = idea.bountyAmount;
            uint256 ideatorReward = (bounty * ideatorBps) / BPS_PRECISION;
            uint256 builderReward = bounty - ideatorReward;

            if (ideatorReward > 0) {
                vibeToken.safeTransfer(idea.author, ideatorReward);
            }
            if (builderReward > 0) {
                vibeToken.safeTransfer(idea.builder, builderReward);
            }

            // Return collateral and stake
            uint256 collateral = builderCollateral[ideaId];
            if (collateral > 0) {
                builderCollateral[ideaId] = 0;
                vibeToken.safeTransfer(idea.builder, collateral);
            }
            _returnIdeatorStake(ideaId);

            emit WorkApproved(ideaId, idea.builder, ideatorReward, builderReward);
        } else {
            // Reject the work — slash builder collateral, reopen idea
            uint256 collateral = builderCollateral[ideaId];
            if (collateral > 0) {
                builderCollateral[ideaId] = 0;
                vibeToken.safeTransfer(treasury, collateral);
            }

            address slashedBuilder = idea.builder;
            idea.builder = address(0);
            idea.claimedAt = 0;
            idea.proofHash = bytes32(0);
            _transitionStatus(ideaId, IdeaStatus.OPEN);

            emit ClaimCancelled(ideaId, slashedBuilder, collateral);
        }
    }

    // ============ Internal Functions ============

    /**
     * @notice Transition an idea's status and update tracking arrays
     * @param ideaId The idea to transition
     * @param newStatus The new status
     */
    function _transitionStatus(uint256 ideaId, IdeaStatus newStatus) internal {
        Idea storage idea = _ideas[ideaId];
        IdeaStatus oldStatus = idea.status;
        idea.status = newStatus;

        // Add to new status tracking
        _ideasByStatus[newStatus].push(ideaId);

        // Note: We don't remove from old status array for gas efficiency.
        // View functions should check current status when iterating.
    }

    /**
     * @notice Return the ideator's anti-spam stake
     * @param ideaId The idea whose stake to return
     */
    function _returnIdeatorStake(uint256 ideaId) internal {
        uint256 stake = ideatorStake[ideaId];
        if (stake > 0) {
            ideatorStake[ideaId] = 0;
            vibeToken.safeTransfer(_ideas[ideaId].author, stake);
        }
    }

    /**
     * @notice Paginate through an array of idea IDs
     * @param ids Array of idea IDs
     * @param offset Starting index
     * @param limit Maximum results
     * @return result Array of Idea structs
     */
    function _paginateIdeas(
        uint256[] storage ids,
        uint256 offset,
        uint256 limit
    ) internal view returns (Idea[] memory result) {
        uint256 len = ids.length;
        if (offset >= len) return new Idea[](0);

        uint256 end = offset + limit;
        if (end > len) end = len;

        result = new Idea[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = _ideas[ids[i]];
        }
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
