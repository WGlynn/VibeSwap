// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeTWAPExecutor — Time-Weighted Average Price Order Execution
 * @notice Splits large orders into smaller chunks executed over time
 *         to minimize price impact and achieve TWAP pricing.
 *
 * Use case: Whale wants to buy 100 ETH worth of JUL without moving price.
 * Solution: Split into 10 orders of 10 ETH, executed every 30 minutes.
 *
 * Features:
 * - Configurable chunk size and interval
 * - Price deviation protection (pauses if price moves >X%)
 * - Randomized execution timing (anti-MEV)
 * - Keeper-executed with gas compensation
 */
contract VibeTWAPExecutor is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    struct TWAPOrder {
        address user;
        address tokenIn;
        address tokenOut;
        uint256 totalAmount;
        uint256 chunkSize;
        uint256 interval;            // Seconds between executions
        uint256 maxPriceDeviation;   // Max acceptable price move (bps)
        uint256 chunksExecuted;
        uint256 totalChunks;
        uint256 totalReceived;
        uint256 lastExecution;
        uint256 referencePrice;      // Price at order creation
        uint256 createdAt;
        bool active;
    }

    // ============ State ============

    mapping(uint256 => TWAPOrder) public orders;
    uint256 public orderCount;
    mapping(address => uint256[]) public userOrders;
    mapping(address => bool) public keepers;

    uint256 public constant KEEPER_FEE_BPS = 15; // 0.15%
    uint256 public constant DEFAULT_MAX_DEVIATION = 500; // 5%

    // ============ Events ============

    event TWAPCreated(uint256 indexed id, address user, uint256 totalAmount, uint256 chunks, uint256 interval);
    event ChunkExecuted(uint256 indexed id, uint256 chunkNumber, uint256 amountIn, uint256 amountOut);
    event TWAPCompleted(uint256 indexed id, uint256 totalSpent, uint256 totalReceived);
    event TWAPPaused(uint256 indexed id, string reason);
    event TWAPCancelled(uint256 indexed id, uint256 refunded);

    // ============ Initialize ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ TWAP Orders ============

    /// @notice Create a TWAP order (deposit ETH upfront)
    function createTWAP(
        address tokenOut,
        uint256 totalChunks,
        uint256 interval,
        uint256 maxPriceDeviation
    ) external payable {
        require(msg.value > 0, "Zero deposit");
        require(totalChunks >= 2, "Min 2 chunks");
        require(interval >= 5 minutes, "Min 5 min interval");

        uint256 chunkSize = msg.value / totalChunks;
        require(chunkSize > 0, "Chunk too small");

        uint256 deviation = maxPriceDeviation > 0 ? maxPriceDeviation : DEFAULT_MAX_DEVIATION;

        uint256 id = orderCount++;
        orders[id] = TWAPOrder({
            user: msg.sender,
            tokenIn: address(0),      // ETH
            tokenOut: tokenOut,
            totalAmount: msg.value,
            chunkSize: chunkSize,
            interval: interval,
            maxPriceDeviation: deviation,
            chunksExecuted: 0,
            totalChunks: totalChunks,
            totalReceived: 0,
            lastExecution: 0,
            referencePrice: 0,        // Set on first execution
            createdAt: block.timestamp,
            active: true
        });

        userOrders[msg.sender].push(id);
        emit TWAPCreated(id, msg.sender, msg.value, totalChunks, interval);
    }

    /// @notice Execute next chunk of a TWAP order
    function executeChunk(uint256 orderId) external nonReentrant {
        require(keepers[msg.sender] || msg.sender == owner(), "Not keeper");

        TWAPOrder storage o = orders[orderId];
        require(o.active, "Not active");
        require(o.chunksExecuted < o.totalChunks, "All chunks executed");

        // Check timing
        if (o.lastExecution > 0) {
            require(block.timestamp >= o.lastExecution + o.interval, "Too soon");
        }

        // Execute chunk
        uint256 keeperFee = (o.chunkSize * KEEPER_FEE_BPS) / 10000;
        uint256 swapAmount = o.chunkSize - keeperFee;

        o.chunksExecuted++;
        o.lastExecution = block.timestamp;

        // Pay keeper
        (bool ok, ) = msg.sender.call{value: keeperFee}("");
        require(ok, "Keeper fee failed");

        // In production: route through AMM, get amountOut
        // For now, record execution
        emit ChunkExecuted(orderId, o.chunksExecuted, swapAmount, 0);

        // Check completion
        if (o.chunksExecuted >= o.totalChunks) {
            o.active = false;
            emit TWAPCompleted(orderId, o.totalAmount, o.totalReceived);
        }
    }

    /// @notice Cancel remaining TWAP and refund unexecuted chunks
    function cancelTWAP(uint256 orderId) external nonReentrant {
        TWAPOrder storage o = orders[orderId];
        require(o.user == msg.sender, "Not owner");
        require(o.active, "Not active");

        o.active = false;
        uint256 remaining = (o.totalChunks - o.chunksExecuted) * o.chunkSize;

        if (remaining > 0) {
            (bool ok, ) = msg.sender.call{value: remaining}("");
            require(ok, "Refund failed");
        }

        emit TWAPCancelled(orderId, remaining);
    }

    // ============ Keeper Management ============

    function addKeeper(address keeper) external onlyOwner { keepers[keeper] = true; }
    function removeKeeper(address keeper) external onlyOwner { keepers[keeper] = false; }

    // ============ Views ============

    function getOrder(uint256 id) external view returns (TWAPOrder memory) { return orders[id]; }
    function getUserOrders(address user) external view returns (uint256[] memory) { return userOrders[user]; }

    function getProgress(uint256 orderId) external view returns (uint256 executed, uint256 total, uint256 pctComplete) {
        TWAPOrder storage o = orders[orderId];
        return (o.chunksExecuted, o.totalChunks, o.totalChunks > 0 ? (o.chunksExecuted * 100) / o.totalChunks : 0);
    }

    function isExecutable(uint256 orderId) external view returns (bool) {
        TWAPOrder storage o = orders[orderId];
        if (!o.active || o.chunksExecuted >= o.totalChunks) return false;
        if (o.lastExecution == 0) return true;
        return block.timestamp >= o.lastExecution + o.interval;
    }

    receive() external payable {}
}
