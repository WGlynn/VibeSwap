// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IRewardLedger.sol";
import "./interfaces/IContributionDAG.sol";

/**
 * @title RewardLedger
 * @notice Retroactive + active Shapley reward tracking — direct port of shapleyTrust.js.
 *
 * Two modes:
 * 1. Retroactive: Owner submits pre-launch contributions. Contributors claim after
 *    finalizeRetroactive() is called.
 * 2. Active: Authorized contracts record value events in real-time. Rewards distributed
 *    via trust-chain-weighted Shapley values.
 *
 * Shapley Distribution (from shapleyTrust.js):
 * - Actor gets 50% base share
 * - Remaining 50% decays along trust chain: 60% per hop
 * - Quality weights from ContributionDAG modify shares
 * - Normalized so all value distributed (efficiency axiom)
 *
 * Integration:
 * - Reads ContributionDAG.getTrustScore() for trust chains
 * - Reads ContributionDAG.getVotingPowerMultiplier() for quality weights
 * - Token: configurable ERC20 (JUL or governance token)
 *
 * @dev Non-upgradeable. Pull-pattern claims.
 */
contract RewardLedger is IRewardLedger, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants (from SHAPLEY_CONFIG) ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS = 10000;

    /// @notice Actor (value creator) base share — 50%
    uint256 public constant ACTOR_BASE_SHARE = 5000; // BPS

    /// @notice Chain decay factor — each hop back gets 60% of previous
    uint256 public constant CHAIN_DECAY = 6000; // BPS

    /// @notice Maximum chain depth for reward distribution
    uint256 public constant MAX_REWARD_DEPTH = 5;

    /// @notice Minimum value threshold to distribute (prevents dust)
    uint256 public constant MIN_VALUE_THRESHOLD = 1;

    /// @notice Quality weight bounds (PRECISION scale)
    uint256 public constant MIN_QUALITY_WEIGHT = 1e17;  // 0.1
    uint256 public constant MAX_QUALITY_WEIGHT = 2e18;   // 2.0

    // ============ State ============

    /// @notice ERC20 token used for reward payouts
    IERC20 public rewardToken;

    /// @notice ContributionDAG for trust chain lookups
    IContributionDAG public contributionDAG;

    /// @notice Value events by ID
    mapping(bytes32 => ValueEvent) private _events;

    /// @notice Per-event per-user distribution amounts
    mapping(bytes32 => mapping(address => uint256)) private _eventDistributions;

    /// @notice Retroactive claimable balances
    mapping(address => uint256) public retroactiveBalances;

    /// @notice Active claimable balances
    mapping(address => uint256) public activeBalances;

    /// @notice Total retroactive value distributed
    uint256 public totalRetroactiveDistributed;

    /// @notice Total active value distributed
    uint256 public totalActiveDistributed;

    /// @notice Whether retroactive submissions are locked
    bool public retroactiveFinalized;

    /// @notice Authorized callers that can record active value events
    mapping(address => bool) public authorizedCallers;

    /// @notice Counter for generating event IDs
    uint256 private _eventNonce;

    // ============ Constructor ============

    constructor(
        address _rewardToken,
        address _contributionDAG
    ) Ownable(msg.sender) {
        if (_rewardToken == address(0)) revert ZeroAddress();
        rewardToken = IERC20(_rewardToken);
        contributionDAG = IContributionDAG(_contributionDAG);
    }

    // ============ Modifiers ============

    modifier onlyAuthorized() {
        if (!authorizedCallers[msg.sender] && msg.sender != owner()) {
            revert UnauthorizedCaller();
        }
        _;
    }

    // ============ Retroactive Functions ============

    /// @inheritdoc IRewardLedger
    function recordRetroactiveContribution(
        address contributor,
        uint256 value,
        EventType eventType,
        bytes32 ipfsHash
    ) external onlyOwner {
        if (retroactiveFinalized) revert RetroactiveAlreadyFinalized();
        if (contributor == address(0)) revert ZeroAddress();
        if (value == 0) revert ZeroValue();

        bytes32 eventId = keccak256(abi.encodePacked(
            "retro",
            contributor,
            _eventNonce++,
            block.timestamp
        ));

        if (_events[eventId].timestamp != 0) revert EventAlreadyExists();

        _events[eventId] = ValueEvent({
            eventId: eventId,
            eventType: eventType,
            actor: contributor,
            value: value,
            timestamp: block.timestamp,
            distributed: true // Retroactive events are immediately credited
        });

        // Credit directly to retroactive balance
        retroactiveBalances[contributor] += value;
        totalRetroactiveDistributed += value;

        // Store IPFS reference in event distribution as a marker
        _eventDistributions[eventId][contributor] = value;

        emit RetroactiveContributionRecorded(eventId, contributor, value, eventType);
    }

    /// @inheritdoc IRewardLedger
    function finalizeRetroactive() external onlyOwner {
        if (retroactiveFinalized) revert RetroactiveAlreadyFinalized();
        retroactiveFinalized = true;
        emit RetroactiveFinalized(totalRetroactiveDistributed);
    }

    // ============ Active Functions ============

    /// @inheritdoc IRewardLedger
    function recordValueEvent(
        address actor,
        uint256 value,
        EventType eventType,
        address[] calldata trustChain
    ) external onlyAuthorized returns (bytes32 eventId) {
        if (actor == address(0)) revert ZeroAddress();
        if (value == 0) revert ZeroValue();
        if (trustChain.length == 0) revert EmptyTrustChain();

        eventId = keccak256(abi.encodePacked(
            "active",
            actor,
            _eventNonce++,
            block.timestamp
        ));

        _events[eventId] = ValueEvent({
            eventId: eventId,
            eventType: eventType,
            actor: actor,
            value: value,
            timestamp: block.timestamp,
            distributed: false
        });

        emit ValueEventRecorded(eventId, actor, value, eventType);
    }

    /// @inheritdoc IRewardLedger
    function distributeEvent(bytes32 eventId) external {
        ValueEvent storage evt = _events[eventId];
        if (evt.timestamp == 0) revert EventNotFound();
        if (evt.distributed) revert EventAlreadyDistributed();

        evt.distributed = true;

        // Get actor's trust chain from ContributionDAG
        (, , , , address[] memory trustChain) = contributionDAG.getTrustScore(evt.actor);

        uint256 value = evt.value;
        if (value < MIN_VALUE_THRESHOLD) return;

        // If no trust chain or single-person chain, actor gets everything
        if (trustChain.length <= 1) {
            activeBalances[evt.actor] += value;
            _eventDistributions[eventId][evt.actor] = value;
            totalActiveDistributed += value;
            emit EventDistributed(eventId, value, 1);
            return;
        }

        // Shapley distribution along trust chain
        // Actor (last in chain) gets ACTOR_BASE_SHARE (50%)
        // Remaining decays along enablers (closest first)
        _distributeShapley(eventId, value, trustChain);
    }

    // ============ Claim Functions ============

    /// @inheritdoc IRewardLedger
    function claimRetroactive() external nonReentrant {
        if (!retroactiveFinalized) revert RetroactiveNotFinalized();

        uint256 amount = retroactiveBalances[msg.sender];
        if (amount == 0) revert NothingToClaim();

        retroactiveBalances[msg.sender] = 0;
        rewardToken.safeTransfer(msg.sender, amount);

        emit RetroactiveClaimed(msg.sender, amount);
    }

    /// @inheritdoc IRewardLedger
    function claimActive() external nonReentrant {
        uint256 amount = activeBalances[msg.sender];
        if (amount == 0) revert NothingToClaim();

        activeBalances[msg.sender] = 0;
        rewardToken.safeTransfer(msg.sender, amount);

        emit ActiveClaimed(msg.sender, amount);
    }

    // ============ View Functions ============

    /// @inheritdoc IRewardLedger
    function getRetroactiveBalance(address user) external view returns (uint256) {
        return retroactiveBalances[user];
    }

    /// @inheritdoc IRewardLedger
    function getActiveBalance(address user) external view returns (uint256) {
        return activeBalances[user];
    }

    /// @inheritdoc IRewardLedger
    function getTotalDistributed() external view returns (
        uint256 totalRetroactive,
        uint256 totalActive
    ) {
        return (totalRetroactiveDistributed, totalActiveDistributed);
    }

    /// @inheritdoc IRewardLedger
    function isRetroactiveFinalized() external view returns (bool) {
        return retroactiveFinalized;
    }

    /// @inheritdoc IRewardLedger
    function getValueEvent(bytes32 eventId) external view returns (ValueEvent memory) {
        return _events[eventId];
    }

    /// @inheritdoc IRewardLedger
    function getEventDistribution(bytes32 eventId, address user) external view returns (uint256) {
        return _eventDistributions[eventId][user];
    }

    // ============ Admin Functions ============

    /// @notice Set authorized caller status
    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerSet(caller, authorized);
    }

    /// @notice Update the ContributionDAG address
    function setContributionDAG(address _dag) external onlyOwner {
        if (_dag == address(0)) revert ZeroAddress();
        contributionDAG = IContributionDAG(_dag);
    }

    /// @notice Update the reward token address
    function setRewardToken(address _token) external onlyOwner {
        if (_token == address(0)) revert ZeroAddress();
        rewardToken = IERC20(_token);
    }

    // ============ Internal: Shapley Distribution ============

    /**
     * @notice Distribute value along trust chain using Shapley values
     * @dev Mirrors shapleyTrust.js calculateShapleyDistribution:
     *      - Actor gets 50% base share
     *      - Remaining 50% decays at 60% per hop along enablers
     *      - Quality weights modify raw shares
     *      - Normalized so total = value (efficiency axiom)
     */
    function _distributeShapley(
        bytes32 eventId,
        uint256 value,
        address[] memory trustChain
    ) internal {
        address actor = trustChain[trustChain.length - 1];

        // Calculate raw shares (BPS scale)
        uint256 chainLen = trustChain.length;
        uint256 enablerCount = chainLen - 1;

        // Cap enablers at MAX_REWARD_DEPTH
        if (enablerCount > MAX_REWARD_DEPTH) {
            enablerCount = MAX_REWARD_DEPTH;
        }

        // Build raw shares array: [actor, enabler_closest, enabler_next, ...]
        uint256[] memory rawShares = new uint256[](enablerCount + 1);
        rawShares[0] = ACTOR_BASE_SHARE; // Actor: 50%

        // Enablers: decay from closest to actor (end of chain) backward
        uint256 remaining = BPS - ACTOR_BASE_SHARE; // 5000 BPS
        uint256 decayFactor = BPS; // starts at 1.0

        for (uint256 i = 0; i < enablerCount; i++) {
            decayFactor = (decayFactor * CHAIN_DECAY) / BPS;
            uint256 share = (remaining * decayFactor * (BPS - CHAIN_DECAY)) / (BPS * BPS);
            rawShares[i + 1] = share;
        }

        // Apply quality weights from ContributionDAG
        uint256[] memory weightedShares = new uint256[](enablerCount + 1);
        uint256 totalWeighted = 0;

        // Actor weight
        uint256 actorWeight = _getQualityWeight(actor);
        weightedShares[0] = (rawShares[0] * actorWeight) / PRECISION;
        totalWeighted += weightedShares[0];

        // Enabler weights (closest to actor first)
        for (uint256 i = 0; i < enablerCount; i++) {
            // enablers[i] = trustChain[chainLen - 2 - i] (closest first, walking backward)
            uint256 chainIdx = chainLen - 2 - i;
            address enabler = trustChain[chainIdx];
            uint256 weight = _getQualityWeight(enabler);
            weightedShares[i + 1] = (rawShares[i + 1] * weight) / PRECISION;
            totalWeighted += weightedShares[i + 1];
        }

        // Normalize and distribute (efficiency: all value distributed)
        if (totalWeighted == 0) {
            // Fallback: actor gets everything
            activeBalances[actor] += value;
            _eventDistributions[eventId][actor] = value;
            totalActiveDistributed += value;
            emit EventDistributed(eventId, value, chainLen);
            return;
        }

        uint256 distributed = 0;

        // Actor share
        uint256 actorAmount = (value * weightedShares[0]) / totalWeighted;
        activeBalances[actor] += actorAmount;
        _eventDistributions[eventId][actor] = actorAmount;
        distributed += actorAmount;

        // Enabler shares
        for (uint256 i = 0; i < enablerCount; i++) {
            uint256 chainIdx = chainLen - 2 - i;
            address enabler = trustChain[chainIdx];

            uint256 amount;
            if (i == enablerCount - 1) {
                // Last enabler gets remainder (prevents dust)
                amount = value - distributed;
            } else {
                amount = (value * weightedShares[i + 1]) / totalWeighted;
            }

            activeBalances[enabler] += amount;
            _eventDistributions[eventId][enabler] += amount;
            distributed += amount;
        }

        totalActiveDistributed += value;
        emit EventDistributed(eventId, value, chainLen);
    }

    /**
     * @notice Get quality weight for a user from ContributionDAG
     * @dev Maps voting power multiplier to quality weight range [0.1, 2.0]
     */
    function _getQualityWeight(address user) internal view returns (uint256) {
        if (address(contributionDAG) == address(0)) return PRECISION;

        try contributionDAG.getVotingPowerMultiplier(user) returns (uint256 multiplier) {
            // multiplier is in BPS (5000 = 0.5x, 30000 = 3.0x)
            // Map to quality weight: multiplier / BPS * PRECISION, clamped
            uint256 weight = (multiplier * PRECISION) / BPS;
            if (weight < MIN_QUALITY_WEIGHT) return MIN_QUALITY_WEIGHT;
            if (weight > MAX_QUALITY_WEIGHT) return MAX_QUALITY_WEIGHT;
            return weight;
        } catch {
            return PRECISION; // Default 1.0 on failure
        }
    }
}
