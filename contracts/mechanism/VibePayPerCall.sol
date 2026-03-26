// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibePayPerCall — x402 Micropayment Protocol for VSOS Services
 * @notice Absorbs Dexter's x402 pattern: HTTP 402 Payment Required as a
 *         machine-readable payment gate. Any VSOS service (oracles, Shapley
 *         queries, batch results, agent APIs) can gate access behind micropayments.
 *         No subscriptions, no API keys — pure pay-per-call.
 *
 * @dev Architecture (Dexter x402 absorption):
 *      - Service providers register endpoints with per-call pricing
 *      - Callers pay exact fee per request, receive access token
 *      - Revenue splits: provider gets 95%, protocol gets 5%
 *      - Usage tracking and rate limiting per caller
 *      - Supports prepaid credit balances for gas-efficient batch calls
 *      - Facilitator model: VSOS verifies payment, routes to provider
 */
contract VibePayPerCall is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum ServiceType { ORACLE_QUERY, SHAPLEY_SCORE, BATCH_RESULT, AGENT_API, ANALYTICS, COMPUTE, CUSTOM }

    struct Service {
        uint256 serviceId;
        address provider;
        ServiceType serviceType;
        bytes32 endpointHash;        // IPFS hash of API spec
        uint256 pricePerCall;        // Wei per call
        uint256 totalCalls;
        uint256 totalRevenue;
        uint256 rateLimit;           // Max calls per hour per caller
        bool active;
    }

    struct CallerAccount {
        address caller;
        uint256 prepaidBalance;      // Deposited credit
        uint256 totalSpent;
        uint256 totalCalls;
    }

    struct CallRecord {
        uint256 callId;
        uint256 serviceId;
        address caller;
        uint256 amount;
        bytes32 requestHash;         // Hash of the request
        bytes32 responseHash;        // Hash of the response (for verification)
        uint256 timestamp;
    }

    // ============ Constants ============

    uint256 public constant PROTOCOL_FEE_BPS = 500;  // 5%
    uint256 public constant MIN_PRICE = 1000;         // Min 1000 wei per call

    // ============ State ============

    mapping(uint256 => Service) public services;
    uint256 public serviceCount;

    mapping(address => CallerAccount) public callers;

    mapping(uint256 => CallRecord) public calls;
    uint256 public callCount;

    /// @notice Rate limiting: serviceId => caller => calls this hour
    mapping(uint256 => mapping(address => uint256)) public hourlyCallCount;
    mapping(uint256 => mapping(address => uint256)) public hourlyResetTime;

    /// @notice Protocol treasury
    uint256 public protocolRevenue;

    /// @notice Stats
    uint256 public totalServiceCalls;
    uint256 public totalVolumeProcessed;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event ServiceRegistered(uint256 indexed serviceId, address indexed provider, ServiceType serviceType, uint256 pricePerCall);
    event ServiceCalled(uint256 indexed callId, uint256 indexed serviceId, address indexed caller, uint256 amount);
    event CreditDeposited(address indexed caller, uint256 amount);
    event CreditWithdrawn(address indexed caller, uint256 amount);
    event ProviderPaid(uint256 indexed serviceId, address indexed provider, uint256 amount);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Service Registration ============

    function registerService(
        ServiceType serviceType,
        bytes32 endpointHash,
        uint256 pricePerCall,
        uint256 rateLimit
    ) external returns (uint256) {
        require(pricePerCall >= MIN_PRICE, "Price too low");
        require(rateLimit > 0, "Need rate limit");

        serviceCount++;
        services[serviceCount] = Service({
            serviceId: serviceCount,
            provider: msg.sender,
            serviceType: serviceType,
            endpointHash: endpointHash,
            pricePerCall: pricePerCall,
            totalCalls: 0,
            totalRevenue: 0,
            rateLimit: rateLimit,
            active: true
        });

        emit ServiceRegistered(serviceCount, msg.sender, serviceType, pricePerCall);
        return serviceCount;
    }

    function updatePrice(uint256 serviceId, uint256 newPrice) external {
        require(services[serviceId].provider == msg.sender, "Not provider");
        require(newPrice >= MIN_PRICE, "Price too low");
        services[serviceId].pricePerCall = newPrice;
    }

    function deactivateService(uint256 serviceId) external {
        require(services[serviceId].provider == msg.sender, "Not provider");
        services[serviceId].active = false;
    }

    // ============ Credit System ============

    function depositCredit() external payable {
        require(msg.value > 0, "Zero deposit");
        callers[msg.sender].caller = msg.sender;
        callers[msg.sender].prepaidBalance += msg.value;
        emit CreditDeposited(msg.sender, msg.value);
    }

    function withdrawCredit(uint256 amount) external nonReentrant {
        CallerAccount storage account = callers[msg.sender];
        require(account.prepaidBalance >= amount, "Insufficient balance");

        account.prepaidBalance -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");

        emit CreditWithdrawn(msg.sender, amount);
    }

    // ============ Pay-Per-Call ============

    /**
     * @notice Execute a pay-per-call request
     * @dev Caller pays from prepaid balance or msg.value
     *      Provider receives 95%, protocol receives 5%
     */
    function callService(
        uint256 serviceId,
        bytes32 requestHash
    ) external payable nonReentrant returns (uint256) {
        Service storage service = services[serviceId];
        require(service.active, "Service inactive");

        // Rate limiting
        if (block.timestamp >= hourlyResetTime[serviceId][msg.sender] + 1 hours) {
            hourlyCallCount[serviceId][msg.sender] = 0;
            hourlyResetTime[serviceId][msg.sender] = block.timestamp;
        }
        require(hourlyCallCount[serviceId][msg.sender] < service.rateLimit, "Rate limited");
        hourlyCallCount[serviceId][msg.sender]++;

        // Payment: prefer prepaid balance, fallback to msg.value
        uint256 price = service.pricePerCall;
        CallerAccount storage account = callers[msg.sender];

        if (account.prepaidBalance >= price) {
            account.prepaidBalance -= price;
        } else {
            require(msg.value >= price, "Insufficient payment");
            // Refund excess
            if (msg.value > price) {
                (bool refundOk, ) = msg.sender.call{value: msg.value - price}("");
                require(refundOk, "Refund failed");
            }
        }

        // Split payment
        uint256 protocolFee = (price * PROTOCOL_FEE_BPS) / 10000;
        uint256 providerPayment = price - protocolFee;

        protocolRevenue += protocolFee;
        service.totalRevenue += providerPayment;
        service.totalCalls++;

        account.totalSpent += price;
        account.totalCalls++;

        // Record call
        callCount++;
        calls[callCount] = CallRecord({
            callId: callCount,
            serviceId: serviceId,
            caller: msg.sender,
            amount: price,
            requestHash: requestHash,
            responseHash: bytes32(0),
            timestamp: block.timestamp
        });

        totalServiceCalls++;
        totalVolumeProcessed += price;

        // Pay provider immediately
        (bool ok, ) = service.provider.call{value: providerPayment}("");
        require(ok, "Provider payment failed");

        emit ServiceCalled(callCount, serviceId, msg.sender, price);
        emit ProviderPaid(serviceId, service.provider, providerPayment);

        return callCount;
    }

    /**
     * @notice Provider confirms response hash (for verification)
     */
    function confirmResponse(uint256 callId, bytes32 responseHash) external {
        CallRecord storage record = calls[callId];
        require(services[record.serviceId].provider == msg.sender, "Not provider");
        record.responseHash = responseHash;
    }

    // ============ Admin ============

    function withdrawProtocolRevenue() external onlyOwner nonReentrant {
        uint256 amount = protocolRevenue;
        protocolRevenue = 0;
        (bool ok, ) = owner().call{value: amount}("");
        require(ok, "Withdraw failed");
    }

    // ============ View ============

    function getService(uint256 id) external view returns (Service memory) { return services[id]; }
    function getCaller(address addr) external view returns (CallerAccount memory) { return callers[addr]; }
    function getCall(uint256 id) external view returns (CallRecord memory) { return calls[id]; }
    function getServiceCount() external view returns (uint256) { return serviceCount; }

    receive() external payable {}
}
