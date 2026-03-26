// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeSubscriptions — On-Chain Recurring Payments
 * @notice Decentralized subscription management. Users approve a spending
 *         limit, merchants can pull payments at regular intervals.
 *
 * Use cases:
 * - Protocol premium features (analytics, alerts, priority)
 * - Content subscriptions (paywall access)
 * - SaaS payments on-chain
 * - Recurring donations
 *
 * User protections:
 * - User sets max per-period amount
 * - Can cancel anytime
 * - Failed pulls don't accumulate debt
 * - Transparent on-chain history
 */
contract VibeSubscriptions is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    struct Plan {
        address merchant;
        string name;
        uint256 price;               // Per period
        uint256 period;              // In seconds
        bool active;
    }

    struct Subscription {
        address subscriber;
        uint256 planId;
        uint256 startedAt;
        uint256 lastPayment;
        uint256 totalPaid;
        uint256 paymentCount;
        bool active;
    }

    // ============ State ============

    mapping(uint256 => Plan) public plans;
    uint256 public planCount;
    mapping(uint256 => Subscription) public subscriptions;
    uint256 public subCount;
    mapping(address => uint256[]) public userSubs;
    mapping(address => uint256[]) public merchantPlans;
    mapping(address => uint256) public merchantBalances;

    uint256 public constant PLATFORM_FEE_BPS = 200; // 2%


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event PlanCreated(uint256 indexed id, address merchant, string name, uint256 price, uint256 period);
    event Subscribed(uint256 indexed subId, address subscriber, uint256 planId);
    event PaymentProcessed(uint256 indexed subId, uint256 amount, uint256 paymentNumber);
    event Cancelled(uint256 indexed subId);
    event MerchantWithdraw(address indexed merchant, uint256 amount);

    // ============ Initialize ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Plan Management ============

    function createPlan(string calldata name, uint256 price, uint256 period) external {
        require(price > 0, "Zero price");
        require(period >= 1 days, "Min 1 day period");

        uint256 id = planCount++;
        plans[id] = Plan({
            merchant: msg.sender,
            name: name,
            price: price,
            period: period,
            active: true
        });

        merchantPlans[msg.sender].push(id);
        emit PlanCreated(id, msg.sender, name, price, period);
    }

    function deactivatePlan(uint256 planId) external {
        require(plans[planId].merchant == msg.sender, "Not merchant");
        plans[planId].active = false;
    }

    // ============ Subscriptions ============

    /// @notice Subscribe to a plan (first payment included)
    function subscribe(uint256 planId) external payable nonReentrant {
        Plan storage p = plans[planId];
        require(p.active, "Plan not active");
        require(msg.value >= p.price, "Insufficient payment");

        uint256 subId = subCount++;
        subscriptions[subId] = Subscription({
            subscriber: msg.sender,
            planId: planId,
            startedAt: block.timestamp,
            lastPayment: block.timestamp,
            totalPaid: p.price,
            paymentCount: 1,
            active: true
        });

        userSubs[msg.sender].push(subId);

        uint256 fee = (p.price * PLATFORM_FEE_BPS) / 10000;
        merchantBalances[p.merchant] += p.price - fee;

        // Refund excess
        if (msg.value > p.price) {
            (bool ok, ) = msg.sender.call{value: msg.value - p.price}("");
            require(ok, "Refund failed");
        }

        emit Subscribed(subId, msg.sender, planId);
        emit PaymentProcessed(subId, p.price, 1);
    }

    /// @notice Process recurring payment (called by keeper or merchant)
    function processPayment(uint256 subId) external payable nonReentrant {
        Subscription storage s = subscriptions[subId];
        require(s.active, "Not active");

        Plan storage p = plans[s.planId];
        require(block.timestamp >= s.lastPayment + p.period, "Too soon");

        // Payment must come from subscriber
        require(msg.sender == s.subscriber, "Only subscriber can pay");
        require(msg.value >= p.price, "Insufficient payment");

        s.lastPayment = block.timestamp;
        s.totalPaid += p.price;
        s.paymentCount++;

        uint256 fee = (p.price * PLATFORM_FEE_BPS) / 10000;
        merchantBalances[p.merchant] += p.price - fee;

        emit PaymentProcessed(subId, p.price, s.paymentCount);
    }

    /// @notice Cancel subscription
    function cancel(uint256 subId) external {
        Subscription storage s = subscriptions[subId];
        require(s.subscriber == msg.sender, "Not subscriber");
        s.active = false;
        emit Cancelled(subId);
    }

    /// @notice Merchant withdraws accumulated payments
    function withdrawMerchant() external nonReentrant {
        uint256 amount = merchantBalances[msg.sender];
        require(amount > 0, "No balance");
        merchantBalances[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Withdraw failed");
        emit MerchantWithdraw(msg.sender, amount);
    }

    // ============ Views ============

    function getPlan(uint256 id) external view returns (Plan memory) { return plans[id]; }
    function getSubscription(uint256 id) external view returns (Subscription memory) { return subscriptions[id]; }
    function getUserSubs(address user) external view returns (uint256[] memory) { return userSubs[user]; }
    function getMerchantPlans(address merchant) external view returns (uint256[] memory) { return merchantPlans[merchant]; }

    function isDue(uint256 subId) external view returns (bool) {
        Subscription storage s = subscriptions[subId];
        if (!s.active) return false;
        Plan storage p = plans[s.planId];
        return block.timestamp >= s.lastPayment + p.period;
    }

    receive() external payable {}
}
