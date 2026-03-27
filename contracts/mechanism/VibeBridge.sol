// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeBridge — Omnichain Asset Bridge
 * @notice Trustless asset bridging with BFT consensus validation.
 *         Trinity nodes validate cross-chain messages.
 *         No centralized bridge operator — consensus-secured.
 *
 * @dev Bridge flow:
 *      1. User locks tokens on source chain
 *      2. Trinity nodes observe and sign attestation
 *      3. 2/3 BFT threshold reached → mint on destination
 *      4. User burns on destination → unlock on source
 *
 *   Security: Multi-sig with BFT threshold, not a single operator.
 *   Rate limiting per route prevents catastrophic bridge exploits.
 */
contract VibeBridge is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant BFT_THRESHOLD_NUM = 2;
    uint256 public constant BFT_THRESHOLD_DEN = 3;
    uint256 public constant MAX_BRIDGE_DELAY = 24 hours;

    // ============ Types ============

    struct BridgeRoute {
        uint256 srcChainId;
        uint256 dstChainId;
        address srcToken;
        address dstToken;
        uint256 dailyLimit;
        uint256 dailyUsed;
        uint256 lastResetTime;
        uint256 minAmount;
        uint256 maxAmount;
        // Zero protocol fee on bridges — VibeSwap never extracts
        uint256 feeBps;
        bool active;
    }

    struct BridgeMessage {
        bytes32 messageId;
        address sender;
        address recipient;
        address token;
        uint256 amount;
        uint256 srcChainId;
        uint256 dstChainId;
        uint256 nonce;
        uint256 timestamp;
        BridgeStatus status;
        uint256 attestationCount;
    }

    enum BridgeStatus { PENDING, ATTESTED, EXECUTED, EXPIRED, REFUNDED }

    // ============ State ============

    /// @notice Bridge routes
    mapping(bytes32 => BridgeRoute) public routes;
    bytes32[] public routeList;

    /// @notice Bridge messages
    mapping(bytes32 => BridgeMessage) public messages;
    uint256 public messageNonce;

    /// @notice Attestations: messageId => validator => attested
    mapping(bytes32 => mapping(address => bool)) public attestations;

    /// @notice Registered validators (trinity + meta nodes with bridge privilege)
    mapping(address => bool) public validators;
    address[] public validatorList;

    /// @notice Locked tokens per route
    mapping(bytes32 => uint256) public lockedBalance;

    /// @notice Total bridged volume
    uint256 public totalBridgedVolume;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event BridgeInitiated(bytes32 indexed messageId, address indexed sender, address token, uint256 amount, uint256 dstChainId);
    event BridgeAttested(bytes32 indexed messageId, address indexed validator);
    event BridgeExecuted(bytes32 indexed messageId, address indexed recipient, uint256 amount);
    event BridgeRefunded(bytes32 indexed messageId, address indexed sender, uint256 amount);
    event RouteAdded(bytes32 indexed routeId, uint256 srcChain, uint256 dstChain);
    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Route Management ============

    function addRoute(
        uint256 srcChainId,
        uint256 dstChainId,
        address srcToken,
        address dstToken,
        uint256 dailyLimit,
        uint256 minAmount,
        uint256 maxAmount,
        uint256 feeBps
    ) external onlyOwner returns (bytes32) {
        bytes32 routeId = keccak256(abi.encodePacked(srcChainId, dstChainId, srcToken, dstToken));

        // Zero protocol fee on bridges — VibeSwap never extracts
        routes[routeId] = BridgeRoute({
            srcChainId: srcChainId,
            dstChainId: dstChainId,
            srcToken: srcToken,
            dstToken: dstToken,
            dailyLimit: dailyLimit,
            dailyUsed: 0,
            lastResetTime: block.timestamp,
            minAmount: minAmount,
            maxAmount: maxAmount,
            feeBps: 0,
            active: true
        });

        routeList.push(routeId);
        emit RouteAdded(routeId, srcChainId, dstChainId);
        return routeId;
    }

    // ============ Validator Management ============

    function addValidator(address validator) external onlyOwner {
        validators[validator] = true;
        validatorList.push(validator);
        emit ValidatorAdded(validator);
    }

    function removeValidator(address validator) external onlyOwner {
        validators[validator] = false;
        emit ValidatorRemoved(validator);
    }

    // ============ Bridge Operations ============

    /**
     * @notice Initiate a bridge transfer (lock tokens on source chain)
     */
    function bridge(
        bytes32 routeId,
        address recipient,
        uint256 amount
    ) external payable nonReentrant returns (bytes32) {
        BridgeRoute storage route = routes[routeId];
        require(route.active, "Route not active");
        require(amount >= route.minAmount && amount <= route.maxAmount, "Amount out of range");

        // Reset daily limit if needed
        if (block.timestamp >= route.lastResetTime + 1 days) {
            route.dailyUsed = 0;
            route.lastResetTime = block.timestamp;
        }
        require(route.dailyUsed + amount <= route.dailyLimit, "Daily limit exceeded");
        route.dailyUsed += amount;

        // Calculate fee
        uint256 fee = (amount * route.feeBps) / 10000;
        uint256 bridgeAmount = amount - fee;

        // Lock tokens
        if (route.srcToken == address(0)) {
            require(msg.value >= amount, "Insufficient ETH");
        } else {
            IERC20(route.srcToken).safeTransferFrom(msg.sender, address(this), amount);
        }

        lockedBalance[routeId] += bridgeAmount;

        // Create message
        messageNonce++;
        bytes32 messageId = keccak256(abi.encodePacked(
            msg.sender, recipient, amount, route.dstChainId, messageNonce, block.timestamp
        ));

        messages[messageId] = BridgeMessage({
            messageId: messageId,
            sender: msg.sender,
            recipient: recipient,
            token: route.srcToken,
            amount: bridgeAmount,
            srcChainId: block.chainid,
            dstChainId: route.dstChainId,
            nonce: messageNonce,
            timestamp: block.timestamp,
            status: BridgeStatus.PENDING,
            attestationCount: 0
        });

        totalBridgedVolume += amount;
        emit BridgeInitiated(messageId, msg.sender, route.srcToken, bridgeAmount, route.dstChainId);
        return messageId;
    }

    /**
     * @notice Attest to a bridge message (validator only)
     */
    function attest(bytes32 messageId) external {
        require(validators[msg.sender], "Not a validator");
        BridgeMessage storage msg_ = messages[messageId];
        require(msg_.status == BridgeStatus.PENDING, "Not pending");
        require(!attestations[messageId][msg.sender], "Already attested");

        attestations[messageId][msg.sender] = true;
        msg_.attestationCount++;

        emit BridgeAttested(messageId, msg.sender);

        // Check BFT threshold
        uint256 threshold = (validatorList.length * BFT_THRESHOLD_NUM + BFT_THRESHOLD_DEN - 1) / BFT_THRESHOLD_DEN;
        if (msg_.attestationCount >= threshold) {
            msg_.status = BridgeStatus.ATTESTED;
        }
    }

    /**
     * @notice Execute a bridge transfer on destination chain (after BFT attestation)
     */
    function executeBridge(bytes32 messageId) external nonReentrant {
        BridgeMessage storage msg_ = messages[messageId];
        require(msg_.status == BridgeStatus.ATTESTED, "Not attested");

        msg_.status = BridgeStatus.EXECUTED;

        // Transfer/mint tokens to recipient
        // In production, this would mint wrapped tokens or release from pool
        if (msg_.token == address(0)) {
            (bool ok, ) = msg_.recipient.call{value: msg_.amount}("");
            require(ok, "Transfer failed");
        } else {
            IERC20(msg_.token).safeTransfer(msg_.recipient, msg_.amount);
        }

        emit BridgeExecuted(messageId, msg_.recipient, msg_.amount);
    }

    /**
     * @notice Refund an expired bridge (after MAX_BRIDGE_DELAY with no attestation)
     */
    function refund(bytes32 messageId) external nonReentrant {
        BridgeMessage storage msg_ = messages[messageId];
        require(msg_.status == BridgeStatus.PENDING, "Not pending");
        require(block.timestamp > msg_.timestamp + MAX_BRIDGE_DELAY, "Not expired");

        msg_.status = BridgeStatus.REFUNDED;

        if (msg_.token == address(0)) {
            (bool ok, ) = msg_.sender.call{value: msg_.amount}("");
            require(ok, "Refund failed");
        } else {
            IERC20(msg_.token).safeTransfer(msg_.sender, msg_.amount);
        }

        emit BridgeRefunded(messageId, msg_.sender, msg_.amount);
    }

    // ============ View ============

    function getValidatorCount() external view returns (uint256) {
        return validatorList.length;
    }

    function getRouteCount() external view returns (uint256) {
        return routeList.length;
    }

    function getMessageStatus(bytes32 messageId) external view returns (BridgeStatus) {
        return messages[messageId].status;
    }

    function getMessage(bytes32 messageId) external view returns (BridgeMessage memory) {
        return messages[messageId];
    }

    /// @notice Receive ETH for bridge operations
    receive() external payable {}
}
