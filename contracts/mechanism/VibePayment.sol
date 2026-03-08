// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibePayment — Payment Processing and Invoicing
 * @notice Decentralized payment rails for real-world commerce.
 *         Request payments, recurring subscriptions, split payments,
 *         and invoice management — all on-chain.
 */
contract VibePayment is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Types ============

    struct PaymentRequest {
        uint256 requestId;
        address payee;
        address payer;            // address(0) = anyone can pay
        address token;            // address(0) = ETH
        uint256 amount;
        string memo;
        uint256 createdAt;
        uint256 expiresAt;
        bool paid;
        bool cancelled;
    }

    struct Subscription {
        uint256 subId;
        address subscriber;
        address merchant;
        address token;
        uint256 amount;
        uint256 interval;         // seconds between payments
        uint256 lastPayment;
        uint256 paymentsCount;
        uint256 maxPayments;      // 0 = unlimited
        bool active;
    }

    struct SplitPayment {
        uint256 splitId;
        address payer;
        address[] recipients;
        uint256[] shares;         // basis points per recipient
        address token;
        uint256 totalAmount;
        bool executed;
    }

    // ============ State ============

    mapping(uint256 => PaymentRequest) public requests;
    uint256 public requestCount;

    mapping(uint256 => Subscription) public subscriptions;
    uint256 public subscriptionCount;

    mapping(uint256 => SplitPayment) public splits;
    uint256 public splitCount;

    /// @notice Payment history
    uint256 public totalPaymentsProcessed;
    uint256 public totalVolumeProcessed;

    // ============ Events ============

    event PaymentRequested(uint256 indexed requestId, address indexed payee, uint256 amount);
    event PaymentMade(uint256 indexed requestId, address indexed payer, uint256 amount);
    event SubscriptionCreated(uint256 indexed subId, address indexed subscriber, address indexed merchant);
    event SubscriptionPayment(uint256 indexed subId, uint256 paymentNumber);
    event SubscriptionCancelled(uint256 indexed subId);
    event SplitExecuted(uint256 indexed splitId, uint256 totalAmount, uint256 recipientCount);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Payment Requests ============

    function requestPayment(
        address payer,
        address token,
        uint256 amount,
        string calldata memo,
        uint256 duration
    ) external returns (uint256) {
        requestCount++;
        requests[requestCount] = PaymentRequest({
            requestId: requestCount,
            payee: msg.sender,
            payer: payer,
            token: token,
            amount: amount,
            memo: memo,
            createdAt: block.timestamp,
            expiresAt: duration > 0 ? block.timestamp + duration : type(uint256).max,
            paid: false,
            cancelled: false
        });

        emit PaymentRequested(requestCount, msg.sender, amount);
        return requestCount;
    }

    function payRequest(uint256 requestId) external payable nonReentrant {
        PaymentRequest storage req = requests[requestId];
        require(!req.paid && !req.cancelled, "Invalid request");
        require(block.timestamp <= req.expiresAt, "Expired");
        if (req.payer != address(0)) require(msg.sender == req.payer, "Wrong payer");

        req.paid = true;

        if (req.token == address(0)) {
            require(msg.value >= req.amount, "Insufficient ETH");
            (bool ok, ) = req.payee.call{value: req.amount}("");
            require(ok, "Transfer failed");
            if (msg.value > req.amount) {
                (bool ok2, ) = msg.sender.call{value: msg.value - req.amount}("");
                require(ok2, "Refund failed");
            }
        } else {
            IERC20(req.token).safeTransferFrom(msg.sender, req.payee, req.amount);
        }

        totalPaymentsProcessed++;
        totalVolumeProcessed += req.amount;
        emit PaymentMade(requestId, msg.sender, req.amount);
    }

    function cancelRequest(uint256 requestId) external {
        require(requests[requestId].payee == msg.sender, "Not payee");
        requests[requestId].cancelled = true;
    }

    // ============ Subscriptions ============

    function createSubscription(
        address merchant,
        address token,
        uint256 amount,
        uint256 interval,
        uint256 maxPayments
    ) external returns (uint256) {
        subscriptionCount++;
        subscriptions[subscriptionCount] = Subscription({
            subId: subscriptionCount,
            subscriber: msg.sender,
            merchant: merchant,
            token: token,
            amount: amount,
            interval: interval,
            lastPayment: 0,
            paymentsCount: 0,
            maxPayments: maxPayments,
            active: true
        });

        emit SubscriptionCreated(subscriptionCount, msg.sender, merchant);
        return subscriptionCount;
    }

    function processSubscription(uint256 subId) external nonReentrant {
        Subscription storage sub = subscriptions[subId];
        require(sub.active, "Not active");
        require(block.timestamp >= sub.lastPayment + sub.interval, "Too soon");
        if (sub.maxPayments > 0) require(sub.paymentsCount < sub.maxPayments, "Max reached");

        sub.lastPayment = block.timestamp;
        sub.paymentsCount++;

        IERC20(sub.token).safeTransferFrom(sub.subscriber, sub.merchant, sub.amount);

        totalPaymentsProcessed++;
        emit SubscriptionPayment(subId, sub.paymentsCount);

        if (sub.maxPayments > 0 && sub.paymentsCount >= sub.maxPayments) {
            sub.active = false;
        }
    }

    function cancelSubscription(uint256 subId) external {
        require(subscriptions[subId].subscriber == msg.sender, "Not subscriber");
        subscriptions[subId].active = false;
        emit SubscriptionCancelled(subId);
    }

    // ============ Split Payments ============

    function splitPayment(
        address[] calldata recipients,
        uint256[] calldata shares,
        address token
    ) external payable nonReentrant returns (uint256) {
        require(recipients.length == shares.length, "Length mismatch");
        uint256 totalShares;
        for (uint256 i = 0; i < shares.length; i++) totalShares += shares[i];
        require(totalShares == 10000, "Shares must sum to 10000");

        uint256 totalAmount;
        if (token == address(0)) {
            totalAmount = msg.value;
        } else {
            // Caller must approve first
            totalAmount = 0; // Set by first transfer
        }

        splitCount++;
        splits[splitCount] = SplitPayment({
            splitId: splitCount,
            payer: msg.sender,
            recipients: recipients,
            shares: shares,
            token: token,
            totalAmount: totalAmount,
            executed: true
        });

        for (uint256 i = 0; i < recipients.length; i++) {
            uint256 share = (totalAmount * shares[i]) / 10000;
            if (token == address(0)) {
                (bool ok, ) = recipients[i].call{value: share}("");
                require(ok, "Transfer failed");
            } else {
                IERC20(token).safeTransferFrom(msg.sender, recipients[i], share);
            }
        }

        emit SplitExecuted(splitCount, totalAmount, recipients.length);
        return splitCount;
    }

    // ============ View ============

    function getRequestCount() external view returns (uint256) { return requestCount; }
    function getSubscriptionCount() external view returns (uint256) { return subscriptionCount; }

    receive() external payable {}
}
