// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeLimitOrder
 * @notice On-chain limit orders settled via batch auction with uniform clearing prices
 * @dev Users place orders that execute when the batch clears at or better than their limit price.
 *      Integrates with CommitRevealAuction for MEV-resistant settlement.
 */
contract VibeLimitOrder is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @notice Price precision (18 decimals)
    uint256 public constant PRICE_PRECISION = 1e18;

    /// @notice Maximum expiry duration (30 days)
    uint256 public constant MAX_EXPIRY_DURATION = 30 days;

    // ============ Enums ============

    enum OrderStatus {
        PENDING,
        FILLED,
        PARTIALLY_FILLED,
        CANCELLED,
        EXPIRED
    }

    // ============ Structs ============

    struct LimitOrder {
        address owner;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 limitPrice;  // 18 decimals — min price for sells, max for buys
        uint256 expiry;      // block.timestamp deadline
        bool isBuy;          // true = buy tokenOut, false = sell tokenIn
        OrderStatus status;
    }

    /// @notice Internal tracking for partial fills
    struct FillInfo {
        uint256 amountFilled;   // amount of tokenIn consumed
        uint256 amountReceived; // amount of tokenOut received
        bool claimed;           // whether output has been claimed
    }

    // ============ Storage ============

    /// @notice Next order ID counter
    uint256 public nextOrderId;

    /// @notice All orders by ID
    mapping(uint256 => LimitOrder) private _orders;

    /// @notice Fill info for each order
    mapping(uint256 => FillInfo) private _fills;

    /// @notice User address => list of order IDs
    mapping(address => uint256[]) private _userOrders;

    /// @notice Authorized batch settlers (CommitRevealAuction, VibeSwapCore, etc.)
    mapping(address => bool) public isSettler;

    // ============ Events ============

    event OrderPlaced(
        uint256 indexed orderId,
        address indexed owner,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 limitPrice,
        uint256 expiry,
        bool isBuy
    );

    event OrderCancelled(uint256 indexed orderId, address indexed owner);

    event OrderFilled(
        uint256 indexed orderId,
        uint256 amountFilled,
        uint256 amountReceived,
        uint256 clearingPrice,
        bool isPartial
    );

    event OrderClaimed(uint256 indexed orderId, address indexed owner, uint256 amountReceived);

    event SettlerUpdated(address indexed settler, bool authorized);

    // ============ Custom Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error InvalidExpiry();
    error OrderNotFound(uint256 orderId);
    error NotOrderOwner(uint256 orderId);
    error OrderNotCancellable(uint256 orderId);
    error OrderExpired(uint256 orderId);
    error NotAuthorizedSettler();
    error PriceNotMet(uint256 orderId, uint256 clearingPrice, uint256 limitPrice);
    error OrderNotClaimable(uint256 orderId);
    error AlreadyClaimed(uint256 orderId);
    error InvalidPrice();
    error SameToken();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the limit order book
     * @param owner_ Protocol owner
     */
    function initialize(address owner_) external initializer {
        if (owner_ == address(0)) revert ZeroAddress();

        __Ownable_init(owner_);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
    }

    // ============ External Functions ============

    /**
     * @notice Place a new limit order
     * @param tokenIn Token to sell / provide as input
     * @param tokenOut Token to buy / receive as output
     * @param amountIn Amount of tokenIn to commit
     * @param limitPrice Price limit (18 decimals). For buys: max price willing to pay. For sells: min price willing to accept.
     * @param expiry Timestamp after which the order expires
     * @param isBuy True if buying tokenOut, false if selling tokenIn
     * @return orderId The ID of the newly created order
     */
    function placeLimitOrder(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 limitPrice,
        uint256 expiry,
        bool isBuy
    ) external nonReentrant returns (uint256 orderId) {
        if (tokenIn == address(0) || tokenOut == address(0)) revert ZeroAddress();
        if (tokenIn == tokenOut) revert SameToken();
        if (amountIn == 0) revert ZeroAmount();
        if (limitPrice == 0) revert InvalidPrice();
        if (expiry <= block.timestamp) revert InvalidExpiry();
        if (expiry > block.timestamp + MAX_EXPIRY_DURATION) revert InvalidExpiry();

        // Transfer tokenIn from user
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Create order
        orderId = nextOrderId++;

        _orders[orderId] = LimitOrder({
            owner: msg.sender,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            limitPrice: limitPrice,
            expiry: expiry,
            isBuy: isBuy,
            status: OrderStatus.PENDING
        });

        _userOrders[msg.sender].push(orderId);

        emit OrderPlaced(
            orderId,
            msg.sender,
            tokenIn,
            tokenOut,
            amountIn,
            limitPrice,
            expiry,
            isBuy
        );
    }

    /**
     * @notice Cancel a pending order and reclaim deposited tokens
     * @param orderId The order to cancel
     */
    function cancelOrder(uint256 orderId) external nonReentrant {
        LimitOrder storage order = _orders[orderId];
        if (order.owner == address(0)) revert OrderNotFound(orderId);
        if (order.owner != msg.sender) revert NotOrderOwner(orderId);
        if (order.status != OrderStatus.PENDING && order.status != OrderStatus.PARTIALLY_FILLED) {
            revert OrderNotCancellable(orderId);
        }

        order.status = OrderStatus.CANCELLED;

        // Refund remaining unfilled amount
        uint256 refundAmount = order.amountIn - _fills[orderId].amountFilled;
        if (refundAmount > 0) {
            IERC20(order.tokenIn).safeTransfer(msg.sender, refundAmount);
        }

        emit OrderCancelled(orderId, msg.sender);
    }

    /**
     * @notice Fill orders at a uniform clearing price (called by authorized batch settler)
     * @dev The settler must have already transferred the output tokens to this contract.
     *      For each order, checks that the clearing price satisfies the limit price constraint.
     * @param orderIds Array of order IDs to fill
     * @param clearingPrice The uniform clearing price from the batch auction (18 decimals)
     */
    function fillOrders(
        uint256[] calldata orderIds,
        uint256 clearingPrice
    ) external nonReentrant {
        if (!isSettler[msg.sender]) revert NotAuthorizedSettler();

        for (uint256 i; i < orderIds.length; ++i) {
            uint256 orderId = orderIds[i];
            LimitOrder storage order = _orders[orderId];

            if (order.owner == address(0)) revert OrderNotFound(orderId);

            // Skip expired orders
            if (block.timestamp > order.expiry) {
                order.status = OrderStatus.EXPIRED;
                // Refund unfilled portion
                uint256 refund = order.amountIn - _fills[orderId].amountFilled;
                if (refund > 0) {
                    IERC20(order.tokenIn).safeTransfer(order.owner, refund);
                }
                continue;
            }

            // Only fill PENDING or PARTIALLY_FILLED orders
            if (order.status != OrderStatus.PENDING && order.status != OrderStatus.PARTIALLY_FILLED) {
                continue;
            }

            // Check price constraint
            if (order.isBuy) {
                // Buy order: clearing price must be <= limit price (don't pay more than willing)
                if (clearingPrice > order.limitPrice) {
                    revert PriceNotMet(orderId, clearingPrice, order.limitPrice);
                }
            } else {
                // Sell order: clearing price must be >= limit price (don't sell for less than willing)
                if (clearingPrice < order.limitPrice) {
                    revert PriceNotMet(orderId, clearingPrice, order.limitPrice);
                }
            }

            // Calculate fill amounts
            uint256 remainingIn = order.amountIn - _fills[orderId].amountFilled;
            // amountOut = amountIn * clearingPrice / PRICE_PRECISION (for sells)
            // amountOut = amountIn * PRICE_PRECISION / clearingPrice (for buys)
            uint256 amountOut;
            if (order.isBuy) {
                amountOut = (remainingIn * PRICE_PRECISION) / clearingPrice;
            } else {
                amountOut = (remainingIn * clearingPrice) / PRICE_PRECISION;
            }

            // Update fill info
            _fills[orderId].amountFilled += remainingIn;
            _fills[orderId].amountReceived += amountOut;

            // Full fill
            order.status = OrderStatus.FILLED;

            // Transfer tokenIn to settler (the batch settlement contract)
            IERC20(order.tokenIn).safeTransfer(msg.sender, remainingIn);

            emit OrderFilled(orderId, remainingIn, amountOut, clearingPrice, false);
        }
    }

    /**
     * @notice Claim filled output tokens
     * @param orderId The order to claim tokens for
     */
    function claimFilled(uint256 orderId) external nonReentrant {
        LimitOrder storage order = _orders[orderId];
        if (order.owner == address(0)) revert OrderNotFound(orderId);
        if (order.owner != msg.sender) revert NotOrderOwner(orderId);
        if (order.status != OrderStatus.FILLED && order.status != OrderStatus.PARTIALLY_FILLED) {
            revert OrderNotClaimable(orderId);
        }

        FillInfo storage fill = _fills[orderId];
        if (fill.claimed) revert AlreadyClaimed(orderId);
        if (fill.amountReceived == 0) revert OrderNotClaimable(orderId);

        fill.claimed = true;

        IERC20(order.tokenOut).safeTransfer(msg.sender, fill.amountReceived);

        emit OrderClaimed(orderId, msg.sender, fill.amountReceived);
    }

    // ============ View Functions ============

    /**
     * @notice Get order details
     * @param orderId The order ID to query
     * @return The LimitOrder struct
     */
    function getOrder(uint256 orderId) external view returns (LimitOrder memory) {
        return _orders[orderId];
    }

    /**
     * @notice Get all order IDs for a user
     * @param user The user address
     * @return orderIds Array of order IDs belonging to the user
     */
    function getUserOrders(address user) external view returns (uint256[] memory orderIds) {
        return _userOrders[user];
    }

    /**
     * @notice Get fill info for an order
     * @param orderId The order ID
     * @return amountFilled Amount of tokenIn consumed
     * @return amountReceived Amount of tokenOut received
     * @return claimed Whether the output has been claimed
     */
    function getFillInfo(uint256 orderId)
        external
        view
        returns (uint256 amountFilled, uint256 amountReceived, bool claimed)
    {
        FillInfo storage fill = _fills[orderId];
        return (fill.amountFilled, fill.amountReceived, fill.claimed);
    }

    // ============ Admin Functions ============

    /**
     * @notice Authorize or deauthorize a batch settler
     * @param settler Address of the settler contract
     * @param authorized Whether to authorize or deauthorize
     */
    function setSettler(address settler, bool authorized) external onlyOwner {
        if (settler == address(0)) revert ZeroAddress();
        isSettler[settler] = authorized;
        emit SettlerUpdated(settler, authorized);
    }

    // ============ UUPS ============

    /**
     * @notice Authorize upgrade (UUPS)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
