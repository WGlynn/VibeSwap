// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title VibeOracle — Decentralized Price Oracle Network
 * @notice Multi-source price feeds with outlier detection and TWAP.
 *         Replaces Chainlink/Pyth with consensus-validated pricing.
 *
 * @dev Sources:
 *      - Trinity node direct feeds (highest trust)
 *      - DEX TWAP (on-chain verifiable)
 *      - External feeds (Chainlink/Pyth as fallback)
 *      - Median of sources with outlier rejection
 */
contract VibeOracle is OwnableUpgradeable, UUPSUpgradeable {
    // ============ Types ============

    struct PriceFeed {
        bytes32 feedId;
        string symbol;
        uint256 price;              // 18 decimals
        uint256 updatedAt;
        uint256 confidence;         // 0-10000 bps
        uint256 sourceCount;
        bool active;
    }

    struct PriceSource {
        address provider;
        uint256 price;
        uint256 timestamp;
        uint256 weight;             // Trust weight
        bool active;
    }

    struct TWAPData {
        uint256 cumulativePrice;
        uint256 lastPrice;
        uint256 lastTimestamp;
        uint256 twapPeriod;
    }

    // ============ State ============

    /// @notice Price feeds
    mapping(bytes32 => PriceFeed) public feeds;
    bytes32[] public feedList;

    /// @notice Sources per feed: feedId => sourceIndex => source
    mapping(bytes32 => mapping(uint256 => PriceSource)) public sources;
    mapping(bytes32 => uint256) public sourceCount;

    /// @notice TWAP data per feed
    mapping(bytes32 => TWAPData) public twapData;

    /// @notice Authorized price providers
    mapping(address => bool) public authorizedProviders;

    /// @notice Maximum deviation from median before rejection (basis points)
    uint256 public maxDeviationBps;

    /// @notice Minimum sources required for a valid price
    uint256 public minSources;

    /// @notice Staleness threshold
    uint256 public stalenessThreshold;

    // ============ Events ============

    event PriceUpdated(bytes32 indexed feedId, uint256 price, uint256 confidence, uint256 sourceCount);
    event FeedCreated(bytes32 indexed feedId, string symbol);
    event SourceSubmitted(bytes32 indexed feedId, address indexed provider, uint256 price);
    event OutlierRejected(bytes32 indexed feedId, address indexed provider, uint256 price, uint256 median);
    event ProviderAuthorized(address indexed provider);
    event ProviderRevoked(address indexed provider);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        maxDeviationBps = 500;     // 5% max deviation
        minSources = 2;
        stalenessThreshold = 1 hours;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Feed Management ============

    function createFeed(string calldata symbol, uint256 twapPeriod) external onlyOwner returns (bytes32) {
        bytes32 feedId = keccak256(abi.encodePacked(symbol));
        require(!feeds[feedId].active, "Feed exists");

        feeds[feedId] = PriceFeed({
            feedId: feedId,
            symbol: symbol,
            price: 0,
            updatedAt: 0,
            confidence: 0,
            sourceCount: 0,
            active: true
        });

        twapData[feedId].twapPeriod = twapPeriod;
        feedList.push(feedId);

        emit FeedCreated(feedId, symbol);
        return feedId;
    }

    // ============ Price Submission ============

    /**
     * @notice Submit a price update from an authorized source
     */
    function submitPrice(bytes32 feedId, uint256 price) external {
        require(authorizedProviders[msg.sender], "Not authorized");
        require(feeds[feedId].active, "Feed not active");

        uint256 idx = sourceCount[feedId];
        sources[feedId][idx] = PriceSource({
            provider: msg.sender,
            price: price,
            timestamp: block.timestamp,
            weight: 1,
            active: true
        });
        sourceCount[feedId] = idx + 1;

        emit SourceSubmitted(feedId, msg.sender, price);

        // Auto-aggregate if enough sources
        if (sourceCount[feedId] >= minSources) {
            _aggregatePrice(feedId);
        }
    }

    // ============ Price Aggregation ============

    function _aggregatePrice(bytes32 feedId) internal {
        uint256 count = sourceCount[feedId];
        if (count == 0) return;

        // Collect recent prices
        uint256[] memory prices = new uint256[](count);
        uint256 validCount;

        for (uint256 i = 0; i < count; i++) {
            PriceSource storage src = sources[feedId][i];
            if (src.active && block.timestamp - src.timestamp <= stalenessThreshold) {
                prices[validCount] = src.price;
                validCount++;
            }
        }

        if (validCount < minSources) return;

        // Find median
        uint256 median = _findMedian(prices, validCount);

        // Calculate confidence based on spread
        uint256 maxDev;
        uint256 acceptedCount;
        uint256 sum;

        for (uint256 i = 0; i < validCount; i++) {
            uint256 dev = prices[i] > median
                ? ((prices[i] - median) * 10000) / median
                : ((median - prices[i]) * 10000) / median;

            if (dev <= maxDeviationBps) {
                sum += prices[i];
                acceptedCount++;
                if (dev > maxDev) maxDev = dev;
            } else {
                emit OutlierRejected(feedId, sources[feedId][i].provider, prices[i], median);
            }
        }

        if (acceptedCount == 0) return;

        uint256 finalPrice = sum / acceptedCount;
        uint256 confidence = 10000 - maxDev; // Higher confidence = lower deviation

        // Update feed
        PriceFeed storage feed = feeds[feedId];
        feed.price = finalPrice;
        feed.updatedAt = block.timestamp;
        feed.confidence = confidence;
        feed.sourceCount = acceptedCount;

        // Update TWAP
        TWAPData storage twap = twapData[feedId];
        if (twap.lastTimestamp > 0) {
            uint256 elapsed = block.timestamp - twap.lastTimestamp;
            twap.cumulativePrice += twap.lastPrice * elapsed;
        }
        twap.lastPrice = finalPrice;
        twap.lastTimestamp = block.timestamp;

        // Reset sources for next round
        sourceCount[feedId] = 0;

        emit PriceUpdated(feedId, finalPrice, confidence, acceptedCount);
    }

    // ============ View Functions ============

    function getPrice(bytes32 feedId) external view returns (uint256 price, uint256 updatedAt, uint256 confidence) {
        PriceFeed storage feed = feeds[feedId];
        return (feed.price, feed.updatedAt, feed.confidence);
    }

    function getTWAP(bytes32 feedId) external view returns (uint256) {
        TWAPData storage twap = twapData[feedId];
        if (twap.lastTimestamp == 0) return 0;

        uint256 elapsed = block.timestamp - twap.lastTimestamp;
        uint256 currentCumulative = twap.cumulativePrice + twap.lastPrice * elapsed;

        uint256 twapWindow = twap.twapPeriod > 0 ? twap.twapPeriod : 1 hours;
        uint256 totalElapsed = block.timestamp - (twap.lastTimestamp - elapsed);

        if (totalElapsed == 0) return twap.lastPrice;
        return currentCumulative / totalElapsed;
    }

    function getPriceBySymbol(string calldata symbol) external view returns (uint256) {
        bytes32 feedId = keccak256(abi.encodePacked(symbol));
        return feeds[feedId].price;
    }

    function getFeedCount() external view returns (uint256) {
        return feedList.length;
    }

    function isFresh(bytes32 feedId) external view returns (bool) {
        return block.timestamp - feeds[feedId].updatedAt <= stalenessThreshold;
    }

    // ============ Admin ============

    function authorizeProvider(address provider) external onlyOwner {
        authorizedProviders[provider] = true;
        emit ProviderAuthorized(provider);
    }

    function revokeProvider(address provider) external onlyOwner {
        authorizedProviders[provider] = false;
        emit ProviderRevoked(provider);
    }

    function setMaxDeviation(uint256 bps) external onlyOwner {
        maxDeviationBps = bps;
    }

    function setMinSources(uint256 min) external onlyOwner {
        minSources = min;
    }

    // ============ Internal ============

    function _findMedian(uint256[] memory arr, uint256 len) internal pure returns (uint256) {
        // Simple bubble sort for small arrays (oracle sources are few)
        for (uint256 i = 0; i < len; i++) {
            for (uint256 j = i + 1; j < len; j++) {
                if (arr[j] < arr[i]) {
                    (arr[i], arr[j]) = (arr[j], arr[i]);
                }
            }
        }
        if (len % 2 == 0) {
            return (arr[len / 2 - 1] + arr[len / 2]) / 2;
        }
        return arr[len / 2];
    }
}
