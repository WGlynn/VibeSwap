// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./interfaces/IContributionYieldTokenizer.sol";
import "./interfaces/IRewardLedger.sol";

// ============ Idea Token ============
// ERC20 representing ownership of an idea's intrinsic value.
// Minted 1:1 with funding deposited. Fully liquid, never expires.
// IT eternalizes the value of an idea — separate from its execution.

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
 *    - IT eternalizes the idea's value, independent of who executes it
 *
 * 2. EXECUTION STREAM (ES) — Continuous funding for whoever executes.
 *    - Anyone can propose to execute — free market, no gatekeeping
 *    - Streams auto-flow: equal share of remaining funding / 30 days
 *    - Multiple executors compete — funding split equally among active streams
 *    - Decays on stale execution (no milestones reported)
 *    - Stalled streams can be redirected by any IT holder
 *
 * Flow:
 *   Idea created → IT minted → IT traded (instant liquidity) →
 *   Executor proposes → Stream auto-flows →
 *   Milestones reported → Stream stays alive →
 *   If stalled → decay → redirect to new executor
 *
 * @dev Non-upgradeable.
 */
contract ContributionYieldTokenizer is IContributionYieldTokenizer, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS = 10000;

    /// @notice Default stale duration before decay kicks in (14 days without milestone)
    uint256 public constant DEFAULT_STALE_DURATION = 14 days;

    /// @notice Decay rate when stale: stream loses 10% of rate per day of staleness
    uint256 public constant STALE_DECAY_RATE_BPS = 1000; // 10% per day

    /// @notice Maximum streams per idea (prevents spam)
    uint256 public constant MAX_STREAMS_PER_IDEA = 10;

    // ============ State ============

    IERC20 public rewardToken;
    IRewardLedger public rewardLedger;

    /// @notice Ideas by ID (starts at 1)
    mapping(uint256 => Idea) private _ideas;
    uint256 public nextIdeaId;

    /// @notice Execution streams by ID (starts at 1)
    mapping(uint256 => ExecutionStream) private _streams;
    uint256 public nextStreamId;

    /// @notice Streams per idea: ideaId => streamId[]
    mapping(uint256 => uint256[]) private _ideaStreams;

    /// @notice Unclaimed rewards per stream (accrued but not yet transferred)
    mapping(uint256 => uint256) private _unclaimedRewards;

    /// @notice Authorized callers (can create ideas on behalf, record milestones)
    mapping(address => bool) public authorizedCallers;

    /// @notice Prevents duplicate ideas — contentHash must be unique
    mapping(bytes32 => uint256) public contentHashToIdeaId;

    /// @notice Merge tracking: sourceIdeaId => targetIdeaId
    mapping(uint256 => uint256) public mergedInto;

    /// @notice Merge bounty: 1% of remaining funding goes to whoever finds the duplicate
    uint256 public constant MERGE_BOUNTY_BPS = 100; // 1%

    // ============ Constructor ============

    constructor(
        address _rewardToken,
        address _rewardLedger
    ) Ownable(msg.sender) {
        if (_rewardToken == address(0)) revert ZeroAddress();
        rewardToken = IERC20(_rewardToken);
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
        if (contentHashToIdeaId[contentHash] != 0) revert DuplicateContentHash();
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

        contentHashToIdeaId[contentHash] = ideaId;

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

        // Recalculate stream rates for this idea (more funding = higher rates)
        _updateAllStreamRates(ideaId);
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

        // Settle all existing streams before adding a new one (changes their shares)
        _settleAllStreams(ideaId);

        streamId = nextStreamId++;

        _streams[streamId] = ExecutionStream({
            streamId: streamId,
            ideaId: ideaId,
            executor: msg.sender,
            streamRate: 0,
            totalStreamed: 0,
            lastUpdate: block.timestamp,
            lastMilestone: block.timestamp,
            staleDuration: DEFAULT_STALE_DURATION,
            status: StreamStatus.ACTIVE
        });

        _ideaStreams[ideaId].push(streamId);

        // Recalculate all stream rates (new stream changes the split)
        _updateAllStreamRates(ideaId);

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

        // Restore rate if it was decayed due to staleness
        _updateStreamRate(streamId);

        emit MilestoneReported(streamId, evidenceHash, block.timestamp);
    }

    /// @inheritdoc IContributionYieldTokenizer
    function claimStream(uint256 streamId) external nonReentrant {
        ExecutionStream storage stream = _streams[streamId];
        if (stream.lastUpdate == 0) revert StreamNotFound();
        if (stream.executor != msg.sender) revert NotExecutor();

        // Settle any new accrual first
        _settleStream(streamId);

        uint256 claimable = _unclaimedRewards[streamId];
        if (claimable == 0) revert NothingToClaim();

        _unclaimedRewards[streamId] = 0;
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

        // Recalculate remaining streams (they get bigger shares)
        _updateAllStreamRates(stream.ideaId);

        emit StreamCompleted(streamId);
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

        // Recalculate remaining streams (they get bigger shares)
        _updateAllStreamRates(stream.ideaId);

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

        // Recalculate all stream rates
        _updateAllStreamRates(stream.ideaId);

        emit StreamRedirected(streamId, oldExecutor, newExecutor);
    }

    // ============ Merge Functions ============

    /// @notice Merge a source idea into a target idea (the opposite of a fork)
    /// @dev Caller must hold source IdeaTokens. Transfers remaining funding,
    ///      halts source streams, marks source as MERGED. Caller receives a
    ///      bounty (1% of transferred funding) for finding the duplicate.
    ///      Source IT holders can swap their tokens 1:1 for target IT via claimMerge().
    function mergeIdeas(uint256 sourceIdeaId, uint256 targetIdeaId) external nonReentrant {
        if (sourceIdeaId == targetIdeaId) revert CannotMergeSelf();

        Idea storage source = _ideas[sourceIdeaId];
        Idea storage target = _ideas[targetIdeaId];
        if (source.createdAt == 0) revert IdeaNotFound();
        if (target.createdAt == 0) revert IdeaNotFound();
        if (source.status == IdeaStatus.MERGED) revert IdeaAlreadyMerged();
        if (target.status == IdeaStatus.MERGED) revert IdeaAlreadyMerged();

        // Caller must hold source IdeaTokens
        IdeaToken sourceIT = IdeaToken(source.ideaToken);
        if (sourceIT.balanceOf(msg.sender) == 0) revert NotIdeaTokenHolderForMerge();

        // Settle all source streams before merging
        _settleAllStreams(sourceIdeaId);

        // Halt all active source streams
        uint256[] storage sourceStreamIds = _ideaStreams[sourceIdeaId];
        for (uint256 i = 0; i < sourceStreamIds.length; i++) {
            ExecutionStream storage s = _streams[sourceStreamIds[i]];
            if (s.status == StreamStatus.ACTIVE) {
                s.status = StreamStatus.STALLED;
                s.streamRate = 0;
            }
        }

        // Calculate remaining funding to transfer
        uint256 totalStreamed = _totalStreamedForIdea(sourceIdeaId);
        uint256 remainingFunding = source.totalFunding > totalStreamed
            ? source.totalFunding - totalStreamed
            : 0;

        // Bounty to merger
        uint256 bounty = (remainingFunding * MERGE_BOUNTY_BPS) / BPS;
        uint256 transferAmount = remainingFunding - bounty;

        // Transfer remaining funding to target idea
        if (transferAmount > 0) {
            target.totalFunding += transferAmount;
            _updateAllStreamRates(targetIdeaId);
        }

        // Pay bounty to merger
        if (bounty > 0) {
            rewardToken.safeTransfer(msg.sender, bounty);
        }

        // Mark source as merged
        source.status = IdeaStatus.MERGED;
        mergedInto[sourceIdeaId] = targetIdeaId;

        emit IdeasMerged(sourceIdeaId, targetIdeaId, msg.sender, transferAmount, bounty);
    }

    /// @notice Swap source IdeaTokens 1:1 for target IdeaTokens after a merge
    /// @param sourceIdeaId The merged (source) idea
    /// @param amount How many source IT to swap
    function claimMerge(uint256 sourceIdeaId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (_ideas[sourceIdeaId].status != IdeaStatus.MERGED) revert IdeaNotFound();

        uint256 targetIdeaId = mergedInto[sourceIdeaId];
        Idea storage target = _ideas[targetIdeaId];

        IdeaToken sourceIT = IdeaToken(_ideas[sourceIdeaId].ideaToken);
        IdeaToken targetIT = IdeaToken(target.ideaToken);

        // Burn source IT from caller
        sourceIT.burn(msg.sender, amount);

        // Mint target IT 1:1
        targetIT.mint(msg.sender, amount);
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
        uint256 unclaimed = _unclaimedRewards[streamId];

        if (stream.status != StreamStatus.ACTIVE || stream.streamRate == 0) return unclaimed;

        uint256 elapsed = block.timestamp - stream.lastUpdate;
        uint256 newAccrual = stream.streamRate * elapsed;

        // Cap new accrual at remaining funding
        Idea storage idea = _ideas[stream.ideaId];
        uint256 remaining = idea.totalFunding > stream.totalStreamed
            ? idea.totalFunding - stream.totalStreamed
            : 0;

        if (newAccrual > remaining) newAccrual = remaining;

        return unclaimed + newAccrual;
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

    function setRewardLedger(address _ledger) external onlyOwner {
        rewardLedger = IRewardLedger(_ledger);
    }

    // ============ Internal: Stream Settlement ============

    /**
     * @notice Settle pending stream earnings and update lastUpdate
     * @return accrued Amount of reward tokens earned since last update
     */
    function _settleStream(uint256 streamId) internal returns (uint256 accrued) {
        ExecutionStream storage stream = _streams[streamId];
        if (stream.status != StreamStatus.ACTIVE || stream.streamRate == 0) {
            stream.lastUpdate = block.timestamp;
            return 0;
        }

        uint256 elapsed = block.timestamp - stream.lastUpdate;
        if (elapsed == 0) return 0;

        accrued = stream.streamRate * elapsed;

        // Cap at remaining funding for this idea (across ALL streams)
        Idea storage idea = _ideas[stream.ideaId];
        uint256 ideaTotalStreamed = _totalStreamedForIdea(stream.ideaId);
        uint256 remaining = idea.totalFunding > ideaTotalStreamed
            ? idea.totalFunding - ideaTotalStreamed
            : 0;

        if (accrued > remaining) {
            accrued = remaining;
        }

        stream.totalStreamed += accrued;
        _unclaimedRewards[streamId] += accrued;
        stream.lastUpdate = block.timestamp;
    }

    /**
     * @notice Settle all active streams for an idea
     */
    function _settleAllStreams(uint256 ideaId) internal {
        uint256[] storage streamIds = _ideaStreams[ideaId];
        for (uint256 i = 0; i < streamIds.length; i++) {
            if (_streams[streamIds[i]].status == StreamStatus.ACTIVE) {
                _settleStream(streamIds[i]);
            }
        }
    }

    // ============ Internal: Stream Rate Calculation ============

    /**
     * @notice Update stream rate for a single stream
     * @dev Rate = equal share of remaining funding / 30 days
     *      With stale decay applied if past milestone deadline
     */
    function _updateStreamRate(uint256 streamId) internal {
        ExecutionStream storage stream = _streams[streamId];
        if (stream.status != StreamStatus.ACTIVE) {
            stream.streamRate = 0;
            return;
        }

        Idea storage idea = _ideas[stream.ideaId];

        // Count active streams for this idea
        uint256 activeStreamCount = _countActiveStreams(stream.ideaId);
        if (activeStreamCount == 0) {
            stream.streamRate = 0;
            return;
        }

        // Remaining funding
        uint256 remainingFunding = idea.totalFunding > _totalStreamedForIdea(stream.ideaId)
            ? idea.totalFunding - _totalStreamedForIdea(stream.ideaId)
            : 0;

        if (remainingFunding == 0) {
            stream.streamRate = 0;
            return;
        }

        // Equal share among active streams, distributed over 30 days
        uint256 streamShare = remainingFunding / activeStreamCount;
        uint256 newRate = streamShare / 30 days;

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
        emit StreamRateUpdated(streamId, newRate);
    }

    /**
     * @notice Update rates for all active streams of an idea
     */
    function _updateAllStreamRates(uint256 ideaId) internal {
        uint256[] storage streamIds = _ideaStreams[ideaId];
        for (uint256 i = 0; i < streamIds.length; i++) {
            if (_streams[streamIds[i]].status == StreamStatus.ACTIVE) {
                _updateStreamRate(streamIds[i]);
            }
        }
    }

    /**
     * @notice Count active streams for an idea
     */
    function _countActiveStreams(uint256 ideaId) internal view returns (uint256 count) {
        uint256[] storage streamIds = _ideaStreams[ideaId];
        for (uint256 i = 0; i < streamIds.length; i++) {
            if (_streams[streamIds[i]].status == StreamStatus.ACTIVE) {
                count++;
            }
        }
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
}
