// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./interfaces/IContributionYieldTokenizer.sol";
import "./interfaces/IContributionDAG.sol";
import "./interfaces/IRewardLedger.sol";

// ============ Idea Token ============
// ERC20 representing ownership of an idea's intrinsic value.
// Minted 1:1 with funding deposited. Fully liquid, never expires.
// Holding IT = governance over execution streams for that idea.

contract IdeaToken is ERC20 {
    address public immutable tokenizer;

    modifier onlyTokenizer() {
        require(msg.sender == tokenizer, "Only tokenizer");
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) {
        tokenizer = msg.sender;
    }

    function mint(address to, uint256 amount) external onlyTokenizer {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyTokenizer {
        _burn(from, amount);
    }
}

// ============ Contribution Yield Tokenizer ============

/**
 * @title ContributionYieldTokenizer
 * @notice Pendle-inspired tokenization separating ideas from execution.
 *
 * Two primitives:
 *
 * 1. IDEA TOKEN (IT) — Instant, full-value tokenization of an idea.
 *    - Value is intrinsic: the concept/design/whitepaper itself
 *    - Minted 1:1 with funding deposited (1 IT = 1 reward token of funding)
 *    - Fully liquid from day zero — trade on any DEX
 *    - Ideas are eternal — IT never expires or decays
 *    - Holding IT gives governance over execution streams
 *
 * 2. EXECUTION STREAM (ES) — Continuous funding for whoever executes.
 *    - IT holders vote with conviction: commit IT toward a stream
 *    - Stream rate = proportional to accumulated conviction (grows over time)
 *    - Conviction is trust-weighted via ContributionDAG
 *    - Decays on stale execution (no milestones reported)
 *    - Stalled streams can be redirected to a new executor
 *    - Multiple executors can compete for the same idea
 *
 * Proactive funding flow:
 *   Idea created → IT minted → IT traded (instant liquidity) →
 *   Executor proposes → IT holders vote conviction →
 *   Stream flows reward tokens → Executor claims →
 *   Milestones reported → Conviction grows → Stream rate increases →
 *   If stalled → decay → redirect to new executor
 *
 * @dev Non-upgradeable. Integrates ContributionDAG for trust-weighted voting.
 */
contract ContributionYieldTokenizer is IContributionYieldTokenizer, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS = 10000;

    /// @notice Conviction half-life: conviction doubles every 3 days of continuous support
    uint256 public constant CONVICTION_GROWTH_PERIOD = 3 days;

    /// @notice Default stale duration before decay kicks in (14 days without milestone)
    uint256 public constant DEFAULT_STALE_DURATION = 14 days;

    /// @notice Decay rate when stale: stream loses 10% of rate per day of staleness
    uint256 public constant STALE_DECAY_RATE_BPS = 1000; // 10% per day

    /// @notice Minimum conviction threshold before a stream starts flowing
    uint256 public constant MIN_CONVICTION_THRESHOLD = 100e18;

    /// @notice Maximum streams per idea (prevents spam)
    uint256 public constant MAX_STREAMS_PER_IDEA = 10;

    // ============ State ============

    IERC20 public rewardToken;
    IContributionDAG public contributionDAG;
    IRewardLedger public rewardLedger;

    /// @notice Ideas by ID (starts at 1)
    mapping(uint256 => Idea) private _ideas;
    uint256 public nextIdeaId;

    /// @notice Execution streams by ID (starts at 1)
    mapping(uint256 => ExecutionStream) private _streams;
    uint256 public nextStreamId;

    /// @notice Conviction votes: streamId => voter => ConvictionVote
    mapping(uint256 => mapping(address => ConvictionVote)) private _convictionVotes;

    /// @notice Streams per idea: ideaId => streamId[]
    mapping(uint256 => uint256[]) private _ideaStreams;

    /// @notice Authorized callers (can create ideas on behalf, record milestones)
    mapping(address => bool) public authorizedCallers;

    // ============ Constructor ============

    constructor(
        address _rewardToken,
        address _contributionDAG,
        address _rewardLedger
    ) Ownable(msg.sender) {
        if (_rewardToken == address(0)) revert ZeroAddress();
        rewardToken = IERC20(_rewardToken);
        contributionDAG = IContributionDAG(_contributionDAG);
        rewardLedger = IRewardLedger(_rewardLedger);
        nextIdeaId = 1;
        nextStreamId = 1;
    }

    // ============ Idea Functions ============

    /// @inheritdoc IContributionYieldTokenizer
    function createIdea(
        bytes32 contentHash,
        uint256 initialFunding
    ) external nonReentrant returns (uint256 ideaId) {
        ideaId = nextIdeaId++;

        // Deploy Idea Token for this idea
        IdeaToken it = new IdeaToken(
            string.concat("VibeSwap Idea #", Strings.toString(ideaId)),
            string.concat("vIDEA-", Strings.toString(ideaId))
        );

        _ideas[ideaId] = Idea({
            ideaId: ideaId,
            creator: msg.sender,
            contentHash: contentHash,
            totalFunding: 0,
            createdAt: block.timestamp,
            status: IdeaStatus.ACTIVE,
            ideaToken: address(it)
        });

        emit IdeaCreated(ideaId, msg.sender, address(it), contentHash);

        // Optional initial funding
        if (initialFunding > 0) {
            _fundIdea(ideaId, msg.sender, initialFunding);
        }
    }

    /// @inheritdoc IContributionYieldTokenizer
    function fundIdea(uint256 ideaId, uint256 amount) external nonReentrant {
        if (_ideas[ideaId].createdAt == 0) revert IdeaNotFound();
        if (amount == 0) revert ZeroAmount();
        _fundIdea(ideaId, msg.sender, amount);
    }

    function _fundIdea(uint256 ideaId, address funder, uint256 amount) internal {
        Idea storage idea = _ideas[ideaId];

        // Transfer reward tokens from funder to this contract
        rewardToken.safeTransferFrom(funder, address(this), amount);

        // Mint IT 1:1 with funding
        IdeaToken(idea.ideaToken).mint(funder, amount);
        idea.totalFunding += amount;

        emit IdeaFunded(ideaId, funder, amount);
        emit IdeaTokensMinted(ideaId, funder, amount);
    }

    // ============ Execution Stream Functions ============

    /// @inheritdoc IContributionYieldTokenizer
    function proposeExecution(uint256 ideaId) external returns (uint256 streamId) {
        if (_ideas[ideaId].createdAt == 0) revert IdeaNotFound();
        if (_ideaStreams[ideaId].length >= MAX_STREAMS_PER_IDEA) revert Unauthorized();

        streamId = nextStreamId++;

        _streams[streamId] = ExecutionStream({
            streamId: streamId,
            ideaId: ideaId,
            executor: msg.sender,
            streamRate: 0,
            totalConviction: 0,
            totalStreamed: 0,
            lastUpdate: block.timestamp,
            lastMilestone: block.timestamp,
            staleDuration: DEFAULT_STALE_DURATION,
            status: StreamStatus.ACTIVE
        });

        _ideaStreams[ideaId].push(streamId);

        emit StreamCreated(streamId, ideaId, msg.sender);
    }

    /// @inheritdoc IContributionYieldTokenizer
    function reportMilestone(uint256 streamId, bytes32 evidenceHash) external {
        ExecutionStream storage stream = _streams[streamId];
        if (stream.lastUpdate == 0) revert StreamNotFound();
        if (stream.executor != msg.sender) revert NotExecutor();
        if (stream.status != StreamStatus.ACTIVE) revert StreamNotActive();

        // Settle pending stream before updating
        _settleStream(streamId);

        stream.lastMilestone = block.timestamp;

        // If stream was decayed due to staleness, restore it
        _updateStreamRate(streamId);

        emit MilestoneReported(streamId, evidenceHash, block.timestamp);
    }

    /// @inheritdoc IContributionYieldTokenizer
    function claimStream(uint256 streamId) external nonReentrant {
        ExecutionStream storage stream = _streams[streamId];
        if (stream.lastUpdate == 0) revert StreamNotFound();
        if (stream.executor != msg.sender) revert NotExecutor();

        uint256 claimable = _settleStream(streamId);
        if (claimable == 0) revert NothingToClaim();

        // Check contract has sufficient balance
        Idea storage idea = _ideas[stream.ideaId];
        if (claimable > idea.totalFunding - stream.totalStreamed + claimable) {
            // Can't stream more than total funding
            claimable = idea.totalFunding > stream.totalStreamed
                ? idea.totalFunding - stream.totalStreamed
                : 0;
            if (claimable == 0) revert NothingToClaim();
        }

        rewardToken.safeTransfer(msg.sender, claimable);

        emit StreamClaimed(streamId, msg.sender, claimable);
    }

    /// @inheritdoc IContributionYieldTokenizer
    function completeStream(uint256 streamId) external {
        ExecutionStream storage stream = _streams[streamId];
        if (stream.lastUpdate == 0) revert StreamNotFound();
        if (stream.executor != msg.sender && msg.sender != owner()) revert NotExecutor();
        if (stream.status != StreamStatus.ACTIVE) revert StreamNotActive();

        _settleStream(streamId);
        stream.status = StreamStatus.COMPLETED;
        stream.streamRate = 0;

        emit StreamCompleted(streamId);
    }

    // ============ Conviction Voting (Liquid Democracy) ============

    /// @inheritdoc IContributionYieldTokenizer
    function voteConviction(uint256 streamId, uint256 amount) external {
        ExecutionStream storage stream = _streams[streamId];
        if (stream.lastUpdate == 0) revert StreamNotFound();
        if (stream.status != StreamStatus.ACTIVE) revert StreamNotActive();
        if (amount == 0) revert ZeroAmount();

        Idea storage idea = _ideas[stream.ideaId];
        IdeaToken it = IdeaToken(idea.ideaToken);

        // Voter must hold sufficient IT
        if (it.balanceOf(msg.sender) < amount) revert InsufficientBalance();

        // Check not already voting on this stream
        ConvictionVote storage existing = _convictionVotes[streamId][msg.sender];
        if (existing.amount > 0) revert AlreadyVoting();

        // Lock IT tokens (transfer to this contract)
        it.burn(msg.sender, amount);

        // Get trust-weighted conviction
        uint256 trustMultiplier = _getTrustMultiplier(msg.sender);

        // Initial conviction = amount * trustMultiplier / BPS
        uint256 initialConviction = (amount * trustMultiplier) / BPS;

        _convictionVotes[streamId][msg.sender] = ConvictionVote({
            amount: amount,
            timestamp: block.timestamp,
            conviction: initialConviction
        });

        // Settle stream before updating conviction
        _settleStream(streamId);

        stream.totalConviction += initialConviction;
        _updateStreamRate(streamId);

        emit ConvictionVoteCast(streamId, msg.sender, amount);
    }

    /// @inheritdoc IContributionYieldTokenizer
    function withdrawConviction(uint256 streamId) external {
        ExecutionStream storage stream = _streams[streamId];
        if (stream.lastUpdate == 0) revert StreamNotFound();

        ConvictionVote storage vote = _convictionVotes[streamId][msg.sender];
        if (vote.amount == 0) revert NotVoting();

        // Settle stream before removing conviction
        _settleStream(streamId);

        // Calculate current conviction (may have grown over time)
        uint256 currentConviction = _calculateCurrentConviction(vote);

        // Remove conviction from stream
        if (stream.totalConviction > currentConviction) {
            stream.totalConviction -= currentConviction;
        } else {
            stream.totalConviction = 0;
        }

        // Return IT tokens (mint back to voter)
        Idea storage idea = _ideas[stream.ideaId];
        IdeaToken(idea.ideaToken).mint(msg.sender, vote.amount);

        // Clear vote
        delete _convictionVotes[streamId][msg.sender];

        // Update stream rate with new conviction
        _updateStreamRate(streamId);

        emit ConvictionVoteWithdrawn(streamId, msg.sender, vote.amount);
    }

    /// @inheritdoc IContributionYieldTokenizer
    function checkStale(uint256 streamId) external {
        ExecutionStream storage stream = _streams[streamId];
        if (stream.lastUpdate == 0) revert StreamNotFound();
        if (stream.status != StreamStatus.ACTIVE) revert StreamNotActive();

        uint256 timeSinceMilestone = block.timestamp - stream.lastMilestone;
        if (timeSinceMilestone < stream.staleDuration) revert StalePeriodNotReached();

        // Settle before staling
        _settleStream(streamId);

        stream.status = StreamStatus.STALLED;
        stream.streamRate = 0;

        emit StreamStalled(streamId);
    }

    /// @inheritdoc IContributionYieldTokenizer
    function redirectStream(uint256 streamId, address newExecutor) external {
        ExecutionStream storage stream = _streams[streamId];
        if (stream.lastUpdate == 0) revert StreamNotFound();
        if (stream.status != StreamStatus.STALLED) revert StreamStillActive();
        if (newExecutor == address(0)) revert ZeroAddress();

        // Must hold IT for this idea to redirect
        Idea storage idea = _ideas[stream.ideaId];
        IdeaToken it = IdeaToken(idea.ideaToken);
        if (it.balanceOf(msg.sender) == 0) revert NotIdeaTokenHolder();

        address oldExecutor = stream.executor;
        stream.executor = newExecutor;
        stream.status = StreamStatus.ACTIVE;
        stream.lastMilestone = block.timestamp;
        stream.lastUpdate = block.timestamp;

        // Recalculate stream rate
        _updateStreamRate(streamId);

        emit StreamRedirected(streamId, oldExecutor, newExecutor);
    }

    // ============ View Functions ============

    /// @inheritdoc IContributionYieldTokenizer
    function getIdea(uint256 ideaId) external view returns (Idea memory) {
        return _ideas[ideaId];
    }

    /// @inheritdoc IContributionYieldTokenizer
    function getStream(uint256 streamId) external view returns (ExecutionStream memory) {
        return _streams[streamId];
    }

    /// @inheritdoc IContributionYieldTokenizer
    function getStreamRate(uint256 streamId) external view returns (uint256) {
        return _streams[streamId].streamRate;
    }

    /// @inheritdoc IContributionYieldTokenizer
    function pendingStreamAmount(uint256 streamId) external view returns (uint256) {
        ExecutionStream storage stream = _streams[streamId];
        if (stream.status != StreamStatus.ACTIVE || stream.streamRate == 0) return 0;

        uint256 elapsed = block.timestamp - stream.lastUpdate;
        uint256 pending = stream.streamRate * elapsed;

        // Cap at remaining funding
        Idea storage idea = _ideas[stream.ideaId];
        uint256 remaining = idea.totalFunding > stream.totalStreamed
            ? idea.totalFunding - stream.totalStreamed
            : 0;

        return pending > remaining ? remaining : pending;
    }

    /// @inheritdoc IContributionYieldTokenizer
    function getConvictionVote(
        uint256 streamId,
        address voter
    ) external view returns (ConvictionVote memory) {
        return _convictionVotes[streamId][voter];
    }

    /// @inheritdoc IContributionYieldTokenizer
    function getIdeaStreamCount(uint256 ideaId) external view returns (uint256) {
        return _ideaStreams[ideaId].length;
    }

    /// @inheritdoc IContributionYieldTokenizer
    function getIdeaStreams(uint256 ideaId) external view returns (uint256[] memory) {
        return _ideaStreams[ideaId];
    }

    // ============ Admin ============

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
    }

    function setContributionDAG(address _dag) external onlyOwner {
        contributionDAG = IContributionDAG(_dag);
    }

    function setRewardLedger(address _ledger) external onlyOwner {
        rewardLedger = IRewardLedger(_ledger);
    }

    // ============ Internal: Stream Settlement ============

    /**
     * @notice Settle pending stream earnings and update lastUpdate
     * @return claimable Amount of reward tokens earned since last update
     */
    function _settleStream(uint256 streamId) internal returns (uint256 claimable) {
        ExecutionStream storage stream = _streams[streamId];
        if (stream.status != StreamStatus.ACTIVE || stream.streamRate == 0) {
            stream.lastUpdate = block.timestamp;
            return 0;
        }

        uint256 elapsed = block.timestamp - stream.lastUpdate;
        if (elapsed == 0) return 0;

        claimable = stream.streamRate * elapsed;

        // Cap at remaining funding for this idea
        Idea storage idea = _ideas[stream.ideaId];
        uint256 remaining = idea.totalFunding > stream.totalStreamed
            ? idea.totalFunding - stream.totalStreamed
            : 0;

        if (claimable > remaining) {
            claimable = remaining;
        }

        stream.totalStreamed += claimable;
        stream.lastUpdate = block.timestamp;
    }

    // ============ Internal: Conviction & Stream Rate ============

    /**
     * @notice Calculate current conviction for a vote (grows over time)
     * @dev Conviction doubles every CONVICTION_GROWTH_PERIOD.
     *      conviction(t) = initialConviction * 2^(elapsed / growthPeriod)
     *      Approximated with linear growth for gas efficiency:
     *      conviction(t) = initial * (1 + elapsed / growthPeriod)
     */
    function _calculateCurrentConviction(ConvictionVote storage vote) internal view returns (uint256) {
        uint256 elapsed = block.timestamp - vote.timestamp;
        // Linear approximation: conviction grows by initial amount per growth period
        uint256 growth = (vote.conviction * elapsed) / CONVICTION_GROWTH_PERIOD;
        return vote.conviction + growth;
    }

    /**
     * @notice Update stream rate based on total conviction and stale status
     * @dev Rate = totalConviction * fundingPool / (totalConvictionAcrossAllStreams * scaleFactor)
     *      Simplified: rate proportional to conviction, capped by funding pool
     */
    function _updateStreamRate(uint256 streamId) internal {
        ExecutionStream storage stream = _streams[streamId];
        if (stream.status != StreamStatus.ACTIVE) {
            stream.streamRate = 0;
            return;
        }

        // Below threshold: no funding flows
        if (stream.totalConviction < MIN_CONVICTION_THRESHOLD) {
            stream.streamRate = 0;
            emit StreamRateUpdated(streamId, 0, stream.totalConviction);
            return;
        }

        // Calculate available funding pool for this idea
        Idea storage idea = _ideas[stream.ideaId];

        // Sum total conviction across ALL streams for this idea
        uint256 totalIdeaConviction = 0;
        uint256[] storage streamIds = _ideaStreams[idea.ideaId];
        for (uint256 i = 0; i < streamIds.length; i++) {
            ExecutionStream storage s = _streams[streamIds[i]];
            if (s.status == StreamStatus.ACTIVE) {
                totalIdeaConviction += s.totalConviction;
            }
        }

        if (totalIdeaConviction == 0) {
            stream.streamRate = 0;
            return;
        }

        // Remaining funding
        uint256 remainingFunding = idea.totalFunding > _totalStreamedForIdea(idea.ideaId)
            ? idea.totalFunding - _totalStreamedForIdea(idea.ideaId)
            : 0;

        if (remainingFunding == 0) {
            stream.streamRate = 0;
            return;
        }

        // This stream's share of conviction
        uint256 convictionShare = (stream.totalConviction * PRECISION) / totalIdeaConviction;

        // Rate = this stream's share of remaining funding, distributed over 30 days
        // This means at current conviction, the stream would drain its share in ~30 days
        uint256 streamFundingShare = (remainingFunding * convictionShare) / PRECISION;
        uint256 newRate = streamFundingShare / 30 days;

        // Apply stale decay if past milestone deadline
        uint256 timeSinceMilestone = block.timestamp - stream.lastMilestone;
        if (timeSinceMilestone > stream.staleDuration) {
            uint256 staleDays = (timeSinceMilestone - stream.staleDuration) / 1 days;
            uint256 decayMultiplier = BPS;
            for (uint256 i = 0; i < staleDays && decayMultiplier > 0; i++) {
                decayMultiplier = (decayMultiplier * (BPS - STALE_DECAY_RATE_BPS)) / BPS;
            }
            newRate = (newRate * decayMultiplier) / BPS;
        }

        stream.streamRate = newRate;
        emit StreamRateUpdated(streamId, newRate, stream.totalConviction);
    }

    /**
     * @notice Sum totalStreamed across all streams for an idea
     */
    function _totalStreamedForIdea(uint256 ideaId) internal view returns (uint256 total) {
        uint256[] storage streamIds = _ideaStreams[ideaId];
        for (uint256 i = 0; i < streamIds.length; i++) {
            total += _streams[streamIds[i]].totalStreamed;
        }
    }

    /**
     * @notice Get trust-weighted multiplier for a voter from ContributionDAG
     * @dev Maps voting power to conviction multiplier. Founders 3x, trusted 2x, etc.
     */
    function _getTrustMultiplier(address user) internal view returns (uint256) {
        if (address(contributionDAG) == address(0)) return BPS; // 1.0x default

        try contributionDAG.getVotingPowerMultiplier(user) returns (uint256 multiplier) {
            return multiplier;
        } catch {
            return BPS; // 1.0x on failure
        }
    }
}
