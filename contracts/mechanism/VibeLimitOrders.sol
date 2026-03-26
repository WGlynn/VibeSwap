// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeLimitOrders — On-Chain Limit Order Book
 * @notice Decentralized limit orders with keeper-executed fills.
 *         Integrates with VibeAMM for execution and VibeAutomation for triggers.
 *
 * @dev Architecture:
 *      - Users place limit orders with price conditions
 *      - Keepers monitor and fill when price conditions met
 *      - Partial fills supported
 *      - Expiration and cancellation
 *      - Keeper bounty from order creator
 */
contract VibeLimitOrders is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Types ============

    enum OrderType { LIMIT_BUY, LIMIT_SELL, STOP_LOSS, TAKE_PROFIT }
    enum OrderStatus { OPEN, FILLED, PARTIALLY_FILLED, CANCELLED, EXPIRED }

    struct Order {
        uint256 orderId;
        address maker;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountFilled;
        uint256 targetPrice;        // Price threshold (scaled by 1e18)
        OrderType orderType;
        OrderStatus status;
        uint256 keeperBounty;       // ETH bounty for keeper
        uint256 createdAt;
        uint256 expiresAt;
    }

    // ============ State ============

    mapping(uint256 => Order) public orders;
    uint256 public orderCount;

    /// @notice User's open orders
    mapping(address => uint256[]) public userOrders;

    /// @notice Total orders by status
    mapping(OrderStatus => uint256) public ordersByStatus;

    /// @notice Total volume filled
    uint256 public totalVolumeFilled;

    /// @notice Total keeper bounties paid
    uint256 public totalBountiesPaid;

    /// @notice Minimum keeper bounty
    uint256 public minKeeperBounty;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event OrderPlaced(uint256 indexed orderId, address indexed maker, OrderType orderType, uint256 amountIn, uint256 targetPrice);
    event OrderFilled(uint256 indexed orderId, address indexed keeper, uint256 amountFilled);
    event OrderPartiallyFilled(uint256 indexed orderId, uint256 amountFilled, uint256 remaining);
    event OrderCancelled(uint256 indexed orderId);
    event OrderExpired(uint256 indexed orderId);

    // ============ Init ============

    function initialize(uint256 _minKeeperBounty) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        minKeeperBounty = _minKeeperBounty;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Order Placement ============

    /**
     * @notice Place a limit order
     * @param tokenIn Token to sell
     * @param tokenOut Token to buy
     * @param amountIn Amount of tokenIn to sell
     * @param targetPrice Target execution price (1e18 scaled)
     * @param orderType Type of order (limit buy/sell, stop loss, take profit)
     * @param duration How long the order is valid (seconds)
     */
    function placeOrder(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 targetPrice,
        OrderType orderType,
        uint256 duration
    ) external payable nonReentrant returns (uint256) {
        require(amountIn > 0, "Zero amount");
        require(targetPrice > 0, "Zero price");
        require(duration > 0, "Zero duration");
        require(msg.value >= minKeeperBounty, "Insufficient bounty");

        // Transfer tokens from maker
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        orderCount++;
        orders[orderCount] = Order({
            orderId: orderCount,
            maker: msg.sender,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            amountFilled: 0,
            targetPrice: targetPrice,
            orderType: orderType,
            status: OrderStatus.OPEN,
            keeperBounty: msg.value,
            createdAt: block.timestamp,
            expiresAt: block.timestamp + duration
        });

        userOrders[msg.sender].push(orderCount);
        ordersByStatus[OrderStatus.OPEN]++;

        emit OrderPlaced(orderCount, msg.sender, orderType, amountIn, targetPrice);
        return orderCount;
    }

    /**
     * @notice Fill an order (keeper function)
     * @param orderId The order to fill
     * @param amountOut The amount of tokenOut being provided
     */
    function fillOrder(
        uint256 orderId,
        uint256 amountOut
    ) external nonReentrant {
        Order storage order = orders[orderId];
        require(order.status == OrderStatus.OPEN || order.status == OrderStatus.PARTIALLY_FILLED, "Not fillable");
        require(block.timestamp <= order.expiresAt, "Expired");

        uint256 remaining = order.amountIn - order.amountFilled;
        require(amountOut > 0, "Zero fill");

        // Verify price condition
        uint256 effectivePrice = (amountOut * 1e18) / remaining;
        if (order.orderType == OrderType.LIMIT_BUY || order.orderType == OrderType.TAKE_PROFIT) {
            require(effectivePrice >= order.targetPrice, "Price not met");
        } else {
            require(effectivePrice <= order.targetPrice, "Price not met");
        }

        // Transfer tokenOut from keeper to maker
        IERC20(order.tokenOut).safeTransferFrom(msg.sender, order.maker, amountOut);

        // Transfer tokenIn from contract to keeper
        IERC20(order.tokenIn).safeTransfer(msg.sender, remaining);

        order.amountFilled = order.amountIn;
        order.status = OrderStatus.FILLED;
        ordersByStatus[OrderStatus.OPEN]--;
        ordersByStatus[OrderStatus.FILLED]++;

        totalVolumeFilled += remaining;

        // Pay keeper bounty
        uint256 bounty = order.keeperBounty;
        order.keeperBounty = 0;
        totalBountiesPaid += bounty;

        (bool ok, ) = msg.sender.call{value: bounty}("");
        require(ok, "Bounty transfer failed");

        emit OrderFilled(orderId, msg.sender, remaining);
    }

    /**
     * @notice Cancel an open order
     */
    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        require(order.maker == msg.sender, "Not maker");
        require(order.status == OrderStatus.OPEN || order.status == OrderStatus.PARTIALLY_FILLED, "Not cancellable");

        uint256 remaining = order.amountIn - order.amountFilled;
        order.status = OrderStatus.CANCELLED;
        ordersByStatus[OrderStatus.OPEN]--;
        ordersByStatus[OrderStatus.CANCELLED]++;

        // Return remaining tokens
        if (remaining > 0) {
            IERC20(order.tokenIn).safeTransfer(msg.sender, remaining);
        }

        // Return keeper bounty
        uint256 bounty = order.keeperBounty;
        order.keeperBounty = 0;

        if (bounty > 0) {
            (bool ok, ) = msg.sender.call{value: bounty}("");
            require(ok, "Bounty refund failed");
        }

        emit OrderCancelled(orderId);
    }

    /**
     * @notice Mark expired orders (permissionless cleanup)
     */
    function markExpired(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        require(order.status == OrderStatus.OPEN, "Not open");
        require(block.timestamp > order.expiresAt, "Not expired");

        order.status = OrderStatus.EXPIRED;
        ordersByStatus[OrderStatus.OPEN]--;
        ordersByStatus[OrderStatus.EXPIRED]++;

        uint256 remaining = order.amountIn - order.amountFilled;

        // Return tokens to maker
        if (remaining > 0) {
            IERC20(order.tokenIn).safeTransfer(order.maker, remaining);
        }

        // Bounty goes to the person who cleaned up (small incentive)
        uint256 bounty = order.keeperBounty;
        order.keeperBounty = 0;
        uint256 cleanupReward = bounty / 10; // 10% to cleaner
        uint256 refund = bounty - cleanupReward;

        if (refund > 0) {
            (bool ok, ) = order.maker.call{value: refund}("");
            require(ok, "Refund failed");
        }
        if (cleanupReward > 0) {
            (bool ok2, ) = msg.sender.call{value: cleanupReward}("");
            require(ok2, "Cleanup reward failed");
        }

        emit OrderExpired(orderId);
    }

    // ============ Admin ============

    function setMinKeeperBounty(uint256 bounty) external onlyOwner {
        minKeeperBounty = bounty;
    }

    // ============ View ============

    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    function getUserOrders(address user) external view returns (uint256[] memory) {
        return userOrders[user];
    }

    function getOpenOrderCount() external view returns (uint256) {
        return ordersByStatus[OrderStatus.OPEN];
    }

    function isOrderFillable(uint256 orderId) external view returns (bool) {
        Order storage order = orders[orderId];
        return (order.status == OrderStatus.OPEN || order.status == OrderStatus.PARTIALLY_FILLED)
            && block.timestamp <= order.expiresAt;
    }

    receive() external payable {}
}
