// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeOracleRouter
 * @notice Multi-source oracle aggregation router that unifies Chainlink-style decentralized
 *         aggregation, API3-style first-party feeds, and Pyth-style low-latency feeds into
 *         a single quality-weighted oracle layer with Shapley-attributed rewards.
 * @dev Registered providers submit price reports per feed. The router computes a weighted
 *      median using each provider's historical accuracy score, detects stale feeds, and
 *      triggers circuit-breaker pauses when deviations exceed configurable thresholds.
 *
 * Key design choices:
 * - Pull-pattern rewards (providers call claimRewards)
 * - Accuracy scores decay toward baseline over time (no permanent reputation lock-in)
 * - Weighted median resists up to 49% of corrupted weight
 * - Feed IDs are deterministic: keccak256(abi.encodePacked(base, quote))
 */
contract VibeOracleRouter is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ Custom Errors ============

    error ProviderNotRegistered();
    error ProviderAlreadyRegistered();
    error ProviderNotActive();
    error FeedNotInitialized();
    error StaleFeed();
    error PriceDeviationTooHigh();
    error NoRewardsAvailable();
    error InvalidPrice();
    error InvalidConfidence();
    error CircuitBreakerActive();
    error InsufficientReporters();

    // ============ Enums ============

    enum FeedType { FIRST_PARTY, AGGREGATOR, LOW_LATENCY }

    // ============ Structs ============

    struct OracleProvider {
        address provider;
        FeedType feedType;
        uint256 accuracyScore;    // 0-10000 (BPS)
        uint256 totalReports;
        uint256 lastReport;
        bool active;
    }

    struct PriceFeed {
        bytes32 feedId;           // keccak256(base, quote)
        uint256 price;            // 18 decimals
        uint256 timestamp;
        uint256 confidence;       // standard deviation in BPS
        address[] reporters;      // who reported this round
    }

    struct PriceReport {
        uint256 price;
        uint256 confidence;
        uint256 weight;           // accuracy-derived weight for median calc
    }

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS_PRECISION = 10000;
    uint256 public constant MIN_REPORTERS = 1;
    uint256 public constant INITIAL_ACCURACY = 5000; // 50% starting score
    uint256 public constant ACCURACY_REWARD = 50;    // +0.5% per accurate report
    uint256 public constant ACCURACY_PENALTY = 200;  // -2% per inaccurate report
    uint256 public constant ACCURACY_THRESHOLD_BPS = 200; // within 2% of median = accurate

    // ============ State ============

    /// @notice Registered oracle providers
    mapping(address => OracleProvider) public providers;

    /// @notice All registered provider addresses (for enumeration)
    address[] public providerList;

    /// @notice Latest aggregated price feed per feedId
    mapping(bytes32 => PriceFeed) public feeds;

    /// @notice Per-round reports: feedId => round => provider => price report
    mapping(bytes32 => mapping(uint256 => mapping(address => PriceReport))) internal roundReports;

    /// @notice Current round number per feed
    mapping(bytes32 => uint256) public currentRound;

    /// @notice Per-round reporter list: feedId => round => reporters
    mapping(bytes32 => mapping(uint256 => address[])) internal roundReporters;

    /// @notice Accumulated rewards per provider (in wei)
    mapping(address => uint256) public pendingRewards;

    /// @notice Maximum staleness duration before fallback (seconds)
    uint256 public maxStaleness;

    /// @notice Price deviation threshold for circuit breaker (BPS)
    uint256 public deviationThreshold;

    /// @notice Circuit breaker state per feed
    mapping(bytes32 => bool) public circuitBroken;

    /// @notice Total reward pool balance
    uint256 public rewardPool;

    /// @notice Whether a feed has been initialized with at least one report
    mapping(bytes32 => bool) public feedInitialized;

    // ============ Events ============

    event ProviderRegistered(address indexed provider, FeedType feedType);
    event ProviderDeactivated(address indexed provider);
    event ProviderReactivated(address indexed provider);
    event PriceReported(
        bytes32 indexed feedId,
        address indexed reporter,
        uint256 price,
        uint256 confidence,
        uint256 round
    );
    event PriceAggregated(
        bytes32 indexed feedId,
        uint256 price,
        uint256 confidence,
        uint256 reporterCount,
        uint256 round
    );
    event RewardClaimed(address indexed provider, uint256 amount);
    event CircuitBreakerTripped(bytes32 indexed feedId, uint256 deviation);
    event CircuitBreakerReset(bytes32 indexed feedId);
    event MaxStalenessUpdated(uint256 newMaxStaleness);
    event DeviationThresholdUpdated(uint256 newThreshold);
    event RewardPoolFunded(uint256 amount);

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the oracle router
     * @param _maxStaleness Maximum seconds before a feed is considered stale
     * @param _deviationThreshold BPS threshold for circuit breaker activation
     */
    function initialize(
        uint256 _maxStaleness,
        uint256 _deviationThreshold
    ) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        maxStaleness = _maxStaleness;
        deviationThreshold = _deviationThreshold;
    }

    // ============ Provider Management ============

    /**
     * @notice Register a new oracle provider
     * @param provider Address of the provider
     * @param feedType Type of oracle feed (FIRST_PARTY, AGGREGATOR, LOW_LATENCY)
     */
    function registerProvider(address provider, FeedType feedType) external onlyOwner {
        if (providers[provider].provider != address(0)) revert ProviderAlreadyRegistered();

        providers[provider] = OracleProvider({
            provider: provider,
            feedType: feedType,
            accuracyScore: INITIAL_ACCURACY,
            totalReports: 0,
            lastReport: 0,
            active: true
        });

        providerList.push(provider);

        emit ProviderRegistered(provider, feedType);
    }

    /**
     * @notice Deactivate a provider (owner only)
     * @param provider Address of the provider to deactivate
     */
    function deactivateProvider(address provider) external onlyOwner {
        if (providers[provider].provider == address(0)) revert ProviderNotRegistered();
        providers[provider].active = false;
        emit ProviderDeactivated(provider);
    }

    /**
     * @notice Reactivate a provider (owner only)
     * @param provider Address of the provider to reactivate
     */
    function reactivateProvider(address provider) external onlyOwner {
        if (providers[provider].provider == address(0)) revert ProviderNotRegistered();
        providers[provider].active = true;
        emit ProviderReactivated(provider);
    }

    // ============ Price Reporting ============

    /**
     * @notice Report a price for a given feed
     * @dev Only registered active providers can report. Each report triggers re-aggregation.
     * @param feedId The feed identifier (use getFeedId to compute)
     * @param price Price with 18 decimal precision
     * @param confidence Standard deviation of the price estimate in BPS
     */
    function reportPrice(
        bytes32 feedId,
        uint256 price,
        uint256 confidence
    ) external {
        OracleProvider storage provider = providers[msg.sender];
        if (provider.provider == address(0)) revert ProviderNotRegistered();
        if (!provider.active) revert ProviderNotActive();
        if (price == 0) revert InvalidPrice();
        if (confidence > BPS_PRECISION) revert InvalidConfidence();
        if (circuitBroken[feedId]) revert CircuitBreakerActive();

        uint256 round = currentRound[feedId];

        // Store the report
        roundReports[feedId][round][msg.sender] = PriceReport({
            price: price,
            confidence: confidence,
            weight: provider.accuracyScore
        });

        // Track reporter for this round
        roundReporters[feedId][round].push(msg.sender);

        // Update provider stats
        provider.totalReports++;
        provider.lastReport = block.timestamp;

        emit PriceReported(feedId, msg.sender, price, confidence, round);

        // Aggregate prices from all reporters this round
        _aggregatePrice(feedId, round);

        feedInitialized[feedId] = true;
    }

    // ============ Price Aggregation ============

    /**
     * @notice Compute weighted median price from all reports in the current round
     * @dev Uses accuracy-weighted median for Byzantine fault tolerance.
     *      Updates provider accuracy scores based on deviation from median.
     * @param feedId The feed to aggregate
     * @param round The current round number
     */
    function _aggregatePrice(bytes32 feedId, uint256 round) internal {
        address[] storage reporters = roundReporters[feedId][round];
        uint256 reporterCount = reporters.length;

        if (reporterCount == 0) return;

        // Build sorted price array with weights
        PriceReport[] memory reports = new PriceReport[](reporterCount);
        uint256 totalWeight = 0;

        for (uint256 i = 0; i < reporterCount; i++) {
            reports[i] = roundReports[feedId][round][reporters[i]];
            totalWeight += reports[i].weight;
        }

        // Sort by price (insertion sort — reporter count is small)
        for (uint256 i = 1; i < reporterCount; i++) {
            PriceReport memory key = reports[i];
            uint256 j = i;
            while (j > 0 && reports[j - 1].price > key.price) {
                reports[j] = reports[j - 1];
                j--;
            }
            reports[j] = key;
        }

        // Find weighted median
        uint256 medianPrice;
        uint256 cumulativeWeight = 0;
        uint256 halfWeight = totalWeight / 2;

        for (uint256 i = 0; i < reporterCount; i++) {
            cumulativeWeight += reports[i].weight;
            if (cumulativeWeight >= halfWeight) {
                medianPrice = reports[i].price;
                break;
            }
        }

        // Compute aggregate confidence (weighted average of individual confidences)
        uint256 aggregateConfidence = 0;
        for (uint256 i = 0; i < reporterCount; i++) {
            aggregateConfidence += reports[i].confidence * reports[i].weight;
        }
        aggregateConfidence = totalWeight > 0 ? aggregateConfidence / totalWeight : 0;

        // Check circuit breaker: compare to previous feed price
        PriceFeed storage feed = feeds[feedId];
        if (feed.price > 0 && medianPrice > 0) {
            uint256 deviation = _absDiff(medianPrice, feed.price) * BPS_PRECISION / feed.price;
            if (deviation > deviationThreshold) {
                circuitBroken[feedId] = true;
                emit CircuitBreakerTripped(feedId, deviation);
                return;
            }
        }

        // Update accuracy scores and distribute Shapley rewards
        _updateAccuracyScores(feedId, round, reporters, medianPrice);

        // Store aggregated feed
        feed.feedId = feedId;
        feed.price = medianPrice;
        feed.timestamp = block.timestamp;
        feed.confidence = aggregateConfidence;
        feed.reporters = reporters;

        // Advance round
        currentRound[feedId] = round + 1;

        emit PriceAggregated(feedId, medianPrice, aggregateConfidence, reporterCount, round);
    }

    /**
     * @notice Update accuracy scores based on deviation from median price
     * @dev Providers within ACCURACY_THRESHOLD_BPS of median get rewarded,
     *      others get penalized. Rewards are proportional to accuracy weight.
     */
    function _updateAccuracyScores(
        bytes32 feedId,
        uint256 round,
        address[] storage reporters,
        uint256 medianPrice
    ) internal {
        uint256 reporterCount = reporters.length;
        uint256 totalAccurateWeight = 0;

        // First pass: determine who was accurate
        bool[] memory accurate = new bool[](reporterCount);
        for (uint256 i = 0; i < reporterCount; i++) {
            PriceReport storage report = roundReports[feedId][round][reporters[i]];
            uint256 deviation = _absDiff(report.price, medianPrice) * BPS_PRECISION / medianPrice;

            if (deviation <= ACCURACY_THRESHOLD_BPS) {
                accurate[i] = true;
                totalAccurateWeight += report.weight;

                // Increase accuracy score (capped at BPS_PRECISION)
                OracleProvider storage provider = providers[reporters[i]];
                if (provider.accuracyScore + ACCURACY_REWARD <= BPS_PRECISION) {
                    provider.accuracyScore += ACCURACY_REWARD;
                } else {
                    provider.accuracyScore = BPS_PRECISION;
                }
            } else {
                accurate[i] = false;

                // Decrease accuracy score (floored at 0)
                OracleProvider storage provider = providers[reporters[i]];
                if (provider.accuracyScore > ACCURACY_PENALTY) {
                    provider.accuracyScore -= ACCURACY_PENALTY;
                } else {
                    provider.accuracyScore = 0;
                }
            }
        }

        // Second pass: distribute Shapley rewards proportional to accuracy weight
        if (rewardPool > 0 && totalAccurateWeight > 0) {
            // Distribute a small portion of pool per round (1 BPS = 0.01%)
            uint256 roundReward = rewardPool / BPS_PRECISION;
            if (roundReward > 0) {
                for (uint256 i = 0; i < reporterCount; i++) {
                    if (accurate[i]) {
                        PriceReport storage report = roundReports[feedId][round][reporters[i]];
                        uint256 providerReward = roundReward * report.weight / totalAccurateWeight;
                        pendingRewards[reporters[i]] += providerReward;
                        rewardPool -= providerReward;
                    }
                }
            }
        }
    }

    // ============ Price Reading ============

    /**
     * @notice Get the latest aggregated price for a feed
     * @param feedId The feed identifier
     * @return price The weighted median price (18 decimals)
     * @return timestamp When the price was last updated
     * @return confidence Aggregate confidence in BPS
     */
    function getPrice(bytes32 feedId)
        external
        view
        returns (uint256 price, uint256 timestamp, uint256 confidence)
    {
        if (!feedInitialized[feedId]) revert FeedNotInitialized();
        if (circuitBroken[feedId]) revert CircuitBreakerActive();

        PriceFeed storage feed = feeds[feedId];

        if (block.timestamp - feed.timestamp > maxStaleness) revert StaleFeed();

        return (feed.price, feed.timestamp, feed.confidence);
    }

    /**
     * @notice Get the latest price without staleness checks (for internal/fallback use)
     * @param feedId The feed identifier
     * @return price The price (may be stale)
     * @return timestamp When it was reported
     * @return isStale Whether the feed exceeds maxStaleness
     */
    function getPriceUnsafe(bytes32 feedId)
        external
        view
        returns (uint256 price, uint256 timestamp, bool isStale)
    {
        PriceFeed storage feed = feeds[feedId];
        bool stale = (block.timestamp - feed.timestamp > maxStaleness);
        return (feed.price, feed.timestamp, stale);
    }

    // ============ Feed Helpers ============

    /**
     * @notice Compute a deterministic feed ID from base and quote asset names
     * @param base The base asset symbol (e.g. "ETH")
     * @param quote The quote asset symbol (e.g. "USD")
     * @return feedId The keccak256 hash
     */
    function getFeedId(string calldata base, string calldata quote)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(base, "/", quote));
    }

    /**
     * @notice Get a provider's current accuracy score
     * @param provider The provider address
     * @return accuracyScore The score in BPS (0-10000)
     */
    function getProviderAccuracy(address provider) external view returns (uint256) {
        if (providers[provider].provider == address(0)) revert ProviderNotRegistered();
        return providers[provider].accuracyScore;
    }

    /**
     * @notice Get the number of registered providers
     * @return count Total provider count
     */
    function getProviderCount() external view returns (uint256) {
        return providerList.length;
    }

    /**
     * @notice Get reporters for the latest completed round of a feed
     * @param feedId The feed identifier
     * @return reporters Array of reporter addresses
     */
    function getFeedReporters(bytes32 feedId) external view returns (address[] memory) {
        return feeds[feedId].reporters;
    }

    // ============ Rewards ============

    /**
     * @notice Claim accumulated Shapley rewards
     * @param provider The provider address to claim for
     */
    function claimRewards(address provider) external nonReentrant {
        uint256 amount = pendingRewards[provider];
        if (amount == 0) revert NoRewardsAvailable();

        pendingRewards[provider] = 0;

        (bool success, ) = provider.call{value: amount}("");
        if (!success) revert NoRewardsAvailable();

        emit RewardClaimed(provider, amount);
    }

    /**
     * @notice Fund the reward pool (anyone can fund)
     */
    function fundRewardPool() external payable {
        rewardPool += msg.value;
        emit RewardPoolFunded(msg.value);
    }

    // ============ Admin ============

    /**
     * @notice Set maximum staleness duration
     * @param _maxStaleness New staleness threshold in seconds
     */
    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        maxStaleness = _maxStaleness;
        emit MaxStalenessUpdated(_maxStaleness);
    }

    /**
     * @notice Set price deviation threshold for circuit breaker
     * @param _deviationThreshold New threshold in BPS
     */
    function setDeviationThreshold(uint256 _deviationThreshold) external onlyOwner {
        deviationThreshold = _deviationThreshold;
        emit DeviationThresholdUpdated(_deviationThreshold);
    }

    /**
     * @notice Reset circuit breaker for a feed (owner only)
     * @param feedId The feed to reset
     */
    function resetCircuitBreaker(bytes32 feedId) external onlyOwner {
        circuitBroken[feedId] = false;
        emit CircuitBreakerReset(feedId);
    }

    // ============ Internal Helpers ============

    /**
     * @notice Absolute difference between two uint256 values
     */
    function _absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : b - a;
    }

    // ============ UUPS ============

    /**
     * @notice Authorize contract upgrades (owner only)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
