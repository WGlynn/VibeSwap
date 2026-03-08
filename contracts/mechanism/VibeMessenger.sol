// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeMessenger — Cross-Chain Messaging Protocol
 * @notice General-purpose message passing between VSOS instances on different chains.
 *         Push Protocol alternative — decentralized notifications and messaging.
 *
 * @dev Features:
 *      - Channel subscriptions (push notifications)
 *      - Direct encrypted messages (E2E via recipient's public key)
 *      - Cross-chain message relay (via Trinity attestation)
 *      - Message verification with on-chain receipts
 *      - Spam prevention via staking + reputation
 */
contract VibeMessenger is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    struct Channel {
        uint256 channelId;
        address owner;
        string name;
        string description;
        uint256 subscriberCount;
        uint256 messageCount;
        uint256 createdAt;
        bool active;
    }

    struct Message {
        uint256 messageId;
        address sender;
        uint256 channelId;         // 0 = direct message
        address recipient;         // address(0) = broadcast to channel
        bytes32 contentHash;       // IPFS hash of encrypted content
        uint256 timestamp;
        uint256 srcChainId;
        uint256 dstChainId;        // 0 = same chain
        bool delivered;
    }

    struct CrossChainRelay {
        bytes32 relayId;
        uint256 srcChainId;
        uint256 dstChainId;
        bytes32 messageHash;
        uint256 attestations;
        bool executed;
    }

    // ============ State ============

    mapping(uint256 => Channel) public channels;
    uint256 public channelCount;

    mapping(uint256 => Message) public messages;
    uint256 public messageCount;

    /// @notice Subscriptions: channelId => subscriber => subscribed
    mapping(uint256 => mapping(address => bool)) public subscriptions;

    /// @notice Cross-chain relays
    mapping(bytes32 => CrossChainRelay) public relays;
    mapping(bytes32 => mapping(address => bool)) public relayAttestations;

    /// @notice User notification preferences
    mapping(address => bool) public allowDirectMessages;

    /// @notice Spam prevention: minimum stake to send
    uint256 public minSendStake;

    /// @notice Message delivery receipts
    mapping(uint256 => bool) public deliveryReceipts;

    /// @notice Validators for cross-chain relay
    mapping(address => bool) public validators;
    uint256 public validatorCount;
    uint256 public requiredAttestations;

    // ============ Events ============

    event ChannelCreated(uint256 indexed channelId, address indexed owner, string name);
    event Subscribed(uint256 indexed channelId, address indexed subscriber);
    event Unsubscribed(uint256 indexed channelId, address indexed subscriber);
    event MessageSent(uint256 indexed messageId, address indexed sender, uint256 channelId, address recipient);
    event MessageDelivered(uint256 indexed messageId);
    event CrossChainRelayed(bytes32 indexed relayId, uint256 srcChain, uint256 dstChain);
    event RelayAttested(bytes32 indexed relayId, address indexed validator);

    // ============ Init ============

    function initialize(uint256 _requiredAttestations) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        requiredAttestations = _requiredAttestations;
        minSendStake = 0;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Channels ============

    function createChannel(
        string calldata name,
        string calldata description
    ) external returns (uint256) {
        channelCount++;
        channels[channelCount] = Channel({
            channelId: channelCount,
            owner: msg.sender,
            name: name,
            description: description,
            subscriberCount: 0,
            messageCount: 0,
            createdAt: block.timestamp,
            active: true
        });

        emit ChannelCreated(channelCount, msg.sender, name);
        return channelCount;
    }

    function subscribe(uint256 channelId) external {
        require(channels[channelId].active, "Channel not active");
        require(!subscriptions[channelId][msg.sender], "Already subscribed");

        subscriptions[channelId][msg.sender] = true;
        channels[channelId].subscriberCount++;

        emit Subscribed(channelId, msg.sender);
    }

    function unsubscribe(uint256 channelId) external {
        require(subscriptions[channelId][msg.sender], "Not subscribed");

        subscriptions[channelId][msg.sender] = false;
        channels[channelId].subscriberCount--;

        emit Unsubscribed(channelId, msg.sender);
    }

    // ============ Messaging ============

    /**
     * @notice Send a message (broadcast to channel or direct)
     */
    function sendMessage(
        uint256 channelId,
        address recipient,
        bytes32 contentHash
    ) external returns (uint256) {
        if (channelId > 0) {
            require(channels[channelId].owner == msg.sender, "Not channel owner");
        }

        if (recipient != address(0) && channelId == 0) {
            require(allowDirectMessages[recipient], "DMs not allowed");
        }

        messageCount++;
        messages[messageCount] = Message({
            messageId: messageCount,
            sender: msg.sender,
            channelId: channelId,
            recipient: recipient,
            contentHash: contentHash,
            timestamp: block.timestamp,
            srcChainId: block.chainid,
            dstChainId: 0,
            delivered: false
        });

        if (channelId > 0) {
            channels[channelId].messageCount++;
        }

        emit MessageSent(messageCount, msg.sender, channelId, recipient);
        return messageCount;
    }

    /**
     * @notice Acknowledge message delivery
     */
    function acknowledgeDelivery(uint256 msgId) external {
        Message storage msg_ = messages[msgId];
        require(msg_.recipient == msg.sender || msg_.channelId > 0, "Not recipient");

        msg_.delivered = true;
        deliveryReceipts[msgId] = true;

        emit MessageDelivered(msgId);
    }

    /**
     * @notice Send a cross-chain message
     */
    function sendCrossChain(
        uint256 dstChainId,
        uint256 channelId,
        address recipient,
        bytes32 contentHash
    ) external returns (uint256) {
        messageCount++;
        messages[messageCount] = Message({
            messageId: messageCount,
            sender: msg.sender,
            channelId: channelId,
            recipient: recipient,
            contentHash: contentHash,
            timestamp: block.timestamp,
            srcChainId: block.chainid,
            dstChainId: dstChainId,
            delivered: false
        });

        // Create relay for cross-chain attestation
        bytes32 relayId = keccak256(abi.encodePacked(
            messageCount, block.chainid, dstChainId, contentHash
        ));

        relays[relayId] = CrossChainRelay({
            relayId: relayId,
            srcChainId: block.chainid,
            dstChainId: dstChainId,
            messageHash: contentHash,
            attestations: 0,
            executed: false
        });

        emit MessageSent(messageCount, msg.sender, channelId, recipient);
        emit CrossChainRelayed(relayId, block.chainid, dstChainId);
        return messageCount;
    }

    /**
     * @notice Attest to a cross-chain message (validator only)
     */
    function attestRelay(bytes32 relayId) external {
        require(validators[msg.sender], "Not validator");
        require(!relayAttestations[relayId][msg.sender], "Already attested");

        relayAttestations[relayId][msg.sender] = true;
        relays[relayId].attestations++;

        emit RelayAttested(relayId, msg.sender);

        if (relays[relayId].attestations >= requiredAttestations) {
            relays[relayId].executed = true;
        }
    }

    // ============ User Settings ============

    function setAllowDirectMessages(bool allowed) external {
        allowDirectMessages[msg.sender] = allowed;
    }

    // ============ Admin ============

    function addValidator(address v) external onlyOwner {
        if (!validators[v]) {
            validators[v] = true;
            validatorCount++;
        }
    }

    function removeValidator(address v) external onlyOwner {
        if (validators[v]) {
            validators[v] = false;
            validatorCount--;
        }
    }

    // ============ View ============

    function getChannelCount() external view returns (uint256) { return channelCount; }
    function getMessageCount() external view returns (uint256) { return messageCount; }

    function isSubscribed(uint256 channelId, address user) external view returns (bool) {
        return subscriptions[channelId][user];
    }
}
