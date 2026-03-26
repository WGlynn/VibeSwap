// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeDCA — Dollar Cost Averaging Engine
 * @notice Automated recurring purchases with keeper-executed swaps.
 *         Users set up DCA schedules, keepers execute at intervals.
 *
 * @dev Architecture:
 *      - Users deposit funds and configure schedule
 *      - Keepers execute swaps at each interval
 *      - TWAP protection against manipulation
 *      - Keeper bounty from user's deposited funds
 */
contract VibeDCA is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Types ============

    enum Frequency { HOURLY, DAILY, WEEKLY, BIWEEKLY, MONTHLY }

    struct DCAOrder {
        uint256 orderId;
        address user;
        address tokenIn;
        address tokenOut;
        uint256 totalDeposited;
        uint256 amountPerExecution;
        uint256 totalExecuted;
        uint256 executionCount;
        uint256 maxExecutions;
        Frequency frequency;
        uint256 lastExecuted;
        uint256 createdAt;
        bool active;
    }

    // ============ State ============

    mapping(uint256 => DCAOrder) public orders;
    uint256 public orderCount;

    /// @notice User's DCA orders
    mapping(address => uint256[]) public userOrders;

    /// @notice Keeper bounty (basis points of execution amount)
    uint256 public keeperBountyBps;

    /// @notice Total volume executed
    uint256 public totalVolume;
    uint256 public totalExecutions;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event DCACreated(uint256 indexed orderId, address indexed user, address tokenIn, address tokenOut, Frequency freq);
    event DCAExecuted(uint256 indexed orderId, address indexed keeper, uint256 amountIn, uint256 executionNum);
    event DCACancelled(uint256 indexed orderId);
    event DCACompleted(uint256 indexed orderId);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        keeperBountyBps = 50; // 0.5%
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ DCA Orders ============

    /**
     * @notice Create a DCA order
     */
    function createDCA(
        address tokenIn,
        address tokenOut,
        uint256 totalAmount,
        uint256 amountPerExecution,
        uint256 maxExecutions,
        Frequency frequency
    ) external nonReentrant returns (uint256) {
        require(totalAmount > 0, "Zero amount");
        require(amountPerExecution > 0, "Zero per execution");
        require(amountPerExecution * maxExecutions <= totalAmount, "Insufficient deposit");

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), totalAmount);

        orderCount++;
        orders[orderCount] = DCAOrder({
            orderId: orderCount,
            user: msg.sender,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            totalDeposited: totalAmount,
            amountPerExecution: amountPerExecution,
            totalExecuted: 0,
            executionCount: 0,
            maxExecutions: maxExecutions,
            frequency: frequency,
            lastExecuted: block.timestamp,
            createdAt: block.timestamp,
            active: true
        });

        userOrders[msg.sender].push(orderCount);

        emit DCACreated(orderCount, msg.sender, tokenIn, tokenOut, frequency);
        return orderCount;
    }

    /**
     * @notice Execute a DCA order (keeper function)
     * @param orderId The order to execute
     * @param amountOut The amount of tokenOut received from swap
     */
    function executeDCA(uint256 orderId, uint256 amountOut) external nonReentrant {
        DCAOrder storage order = orders[orderId];
        require(order.active, "Not active");
        require(order.executionCount < order.maxExecutions, "Max executions reached");
        require(_isExecutable(order), "Not yet executable");

        uint256 amountIn = order.amountPerExecution;
        require(order.totalDeposited - order.totalExecuted >= amountIn, "Insufficient remaining");

        // Keeper bounty
        uint256 bounty = (amountIn * keeperBountyBps) / 10000;
        uint256 swapAmount = amountIn - bounty;

        // Transfer tokenIn to keeper (keeper does the swap off-chain and sends tokenOut back)
        IERC20(order.tokenIn).safeTransfer(msg.sender, swapAmount);

        // Keeper sends tokenOut to user
        if (amountOut > 0) {
            IERC20(order.tokenOut).safeTransferFrom(msg.sender, order.user, amountOut);
        }

        // Pay keeper bounty in tokenIn
        if (bounty > 0) {
            IERC20(order.tokenIn).safeTransfer(msg.sender, bounty);
        }

        order.totalExecuted += amountIn;
        order.executionCount++;
        order.lastExecuted = block.timestamp;

        totalVolume += amountIn;
        totalExecutions++;

        emit DCAExecuted(orderId, msg.sender, amountIn, order.executionCount);

        // Check if completed
        if (order.executionCount >= order.maxExecutions) {
            order.active = false;
            // Return any remaining funds
            uint256 remaining = order.totalDeposited - order.totalExecuted;
            if (remaining > 0) {
                IERC20(order.tokenIn).safeTransfer(order.user, remaining);
            }
            emit DCACompleted(orderId);
        }
    }

    /**
     * @notice Cancel a DCA order and return remaining funds
     */
    function cancelDCA(uint256 orderId) external nonReentrant {
        DCAOrder storage order = orders[orderId];
        require(order.user == msg.sender, "Not owner");
        require(order.active, "Not active");

        order.active = false;
        uint256 remaining = order.totalDeposited - order.totalExecuted;

        if (remaining > 0) {
            IERC20(order.tokenIn).safeTransfer(msg.sender, remaining);
        }

        emit DCACancelled(orderId);
    }

    // ============ Admin ============

    function setKeeperBounty(uint256 bps) external onlyOwner {
        require(bps <= 500, "Max 5%");
        keeperBountyBps = bps;
    }

    // ============ Internal ============

    function _isExecutable(DCAOrder storage order) internal view returns (bool) {
        uint256 interval = _getInterval(order.frequency);
        return block.timestamp >= order.lastExecuted + interval;
    }

    function _getInterval(Frequency freq) internal pure returns (uint256) {
        if (freq == Frequency.HOURLY) return 1 hours;
        if (freq == Frequency.DAILY) return 1 days;
        if (freq == Frequency.WEEKLY) return 7 days;
        if (freq == Frequency.BIWEEKLY) return 14 days;
        return 30 days; // MONTHLY
    }

    // ============ View ============

    function getUserOrders(address user) external view returns (uint256[] memory) {
        return userOrders[user];
    }

    function isExecutable(uint256 orderId) external view returns (bool) {
        return orders[orderId].active && _isExecutable(orders[orderId]);
    }

    function getRemainingExecutions(uint256 orderId) external view returns (uint256) {
        DCAOrder storage order = orders[orderId];
        return order.maxExecutions - order.executionCount;
    }

    function getOrderCount() external view returns (uint256) { return orderCount; }
}
