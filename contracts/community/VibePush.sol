// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibePush
 * @notice Decentralized notification system for the VSOS ecosystem.
 *         Protocols create channels, users subscribe, notifications are emitted as events.
 *         On-chain subscriber tracking, off-chain notification delivery for gas efficiency.
 */
contract VibePush is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    // ============ Structs ============

    struct Channel {
        bytes32 channelId;
        address owner;
        string name;
        string description;
        uint256 subscriberCount;
        bool active;
    }

    // ============ Constants ============

    uint256 public constant MAX_TITLE_LENGTH = 256;
    uint256 public constant MAX_BODY_LENGTH = 4096;
    uint256 public constant MAX_CHANNEL_NAME_LENGTH = 128;
    uint8 public constant MAX_PRIORITY = 3;

    // ============ State ============

    /// @notice channelId => Channel
    mapping(bytes32 => Channel) private _channels;

    /// @notice channelId => subscriber list
    mapping(bytes32 => address[]) private _subscribers;

    /// @notice channelId => user => subscribed
    mapping(bytes32 => mapping(address => bool)) private _isSubscribed;

    /// @notice channelId => user => index in _subscribers array
    mapping(bytes32 => mapping(address => uint256)) private _subscriberIndex;

    /// @notice user => list of subscribed channel IDs
    mapping(address => bytes32[]) private _userSubscriptions;

    /// @notice user => channelId => index in _userSubscriptions array
    mapping(address => mapping(bytes32 => uint256)) private _userSubIndex;

    /// @notice Nonce for generating unique channel IDs
    uint256 private _channelNonce;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event ChannelCreated(bytes32 indexed channelId, address indexed owner, string name);
    event ChannelDeactivated(bytes32 indexed channelId);
    event ChannelReactivated(bytes32 indexed channelId);
    event Subscribed(bytes32 indexed channelId, address indexed user);
    event Unsubscribed(bytes32 indexed channelId, address indexed user);

    /**
     * @notice Emitted when a notification is sent. This is the primary delivery mechanism.
     *         Off-chain indexers listen for this event to push notifications to subscribers.
     */
    event NotificationSent(
        bytes32 indexed channelId,
        string title,
        string body,
        string imageUrl,
        uint256 timestamp,
        uint8 priority
    );

    // ============ Errors ============

    error ChannelNotFound();
    error ChannelNotActive();
    error NotChannelOwner();
    error AlreadySubscribed();
    error NotSubscribed();
    error InvalidPriority();
    error InvalidChannelName();
    error TitleTooLong();
    error BodyTooLong();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    // ============ Channel Management ============

    /**
     * @notice Create a new notification channel
     * @param name The channel name
     * @param description A description of what notifications this channel sends
     * @return channelId The unique identifier for the new channel
     */
    function createChannel(string calldata name, string calldata description) external returns (bytes32) {
        if (bytes(name).length == 0 || bytes(name).length > MAX_CHANNEL_NAME_LENGTH) {
            revert InvalidChannelName();
        }

        _channelNonce++;
        bytes32 channelId = keccak256(abi.encodePacked(msg.sender, _channelNonce, block.timestamp));

        _channels[channelId] = Channel({
            channelId: channelId,
            owner: msg.sender,
            name: name,
            description: description,
            subscriberCount: 0,
            active: true
        });

        emit ChannelCreated(channelId, msg.sender, name);
        return channelId;
    }

    /**
     * @notice Deactivate a channel (owner only)
     * @param channelId The channel to deactivate
     */
    function deactivateChannel(bytes32 channelId) external {
        Channel storage channel = _channels[channelId];
        if (channel.owner == address(0)) revert ChannelNotFound();
        if (channel.owner != msg.sender) revert NotChannelOwner();

        channel.active = false;
        emit ChannelDeactivated(channelId);
    }

    /**
     * @notice Reactivate a channel (owner only)
     * @param channelId The channel to reactivate
     */
    function reactivateChannel(bytes32 channelId) external {
        Channel storage channel = _channels[channelId];
        if (channel.owner == address(0)) revert ChannelNotFound();
        if (channel.owner != msg.sender) revert NotChannelOwner();

        channel.active = true;
        emit ChannelReactivated(channelId);
    }

    // ============ Subscriptions ============

    /**
     * @notice Subscribe to a notification channel
     * @param channelId The channel to subscribe to
     */
    function subscribe(bytes32 channelId) external {
        Channel storage channel = _channels[channelId];
        if (channel.owner == address(0)) revert ChannelNotFound();
        if (!channel.active) revert ChannelNotActive();
        if (_isSubscribed[channelId][msg.sender]) revert AlreadySubscribed();

        _isSubscribed[channelId][msg.sender] = true;

        // Track subscriber in channel list
        _subscriberIndex[channelId][msg.sender] = _subscribers[channelId].length;
        _subscribers[channelId].push(msg.sender);

        // Track channel in user's subscription list
        _userSubIndex[msg.sender][channelId] = _userSubscriptions[msg.sender].length;
        _userSubscriptions[msg.sender].push(channelId);

        channel.subscriberCount++;

        emit Subscribed(channelId, msg.sender);
    }

    /**
     * @notice Unsubscribe from a notification channel
     * @param channelId The channel to unsubscribe from
     */
    function unsubscribe(bytes32 channelId) external {
        if (!_isSubscribed[channelId][msg.sender]) revert NotSubscribed();

        _isSubscribed[channelId][msg.sender] = false;

        // Remove from subscriber list (swap and pop)
        uint256 index = _subscriberIndex[channelId][msg.sender];
        uint256 lastIndex = _subscribers[channelId].length - 1;
        if (index != lastIndex) {
            address lastSubscriber = _subscribers[channelId][lastIndex];
            _subscribers[channelId][index] = lastSubscriber;
            _subscriberIndex[channelId][lastSubscriber] = index;
        }
        _subscribers[channelId].pop();
        delete _subscriberIndex[channelId][msg.sender];

        // Remove from user subscription list (swap and pop)
        uint256 userIndex = _userSubIndex[msg.sender][channelId];
        uint256 userLastIndex = _userSubscriptions[msg.sender].length - 1;
        if (userIndex != userLastIndex) {
            bytes32 lastChannel = _userSubscriptions[msg.sender][userLastIndex];
            _userSubscriptions[msg.sender][userIndex] = lastChannel;
            _userSubIndex[msg.sender][lastChannel] = userIndex;
        }
        _userSubscriptions[msg.sender].pop();
        delete _userSubIndex[msg.sender][channelId];

        // Decrement only if channel exists (allow unsub from deleted channels)
        if (_channels[channelId].owner != address(0)) {
            _channels[channelId].subscriberCount--;
        }

        emit Unsubscribed(channelId, msg.sender);
    }

    // ============ Notifications ============

    /**
     * @notice Send a notification to all channel subscribers.
     *         Notification content is emitted as an event (not stored on-chain) for gas efficiency.
     * @param channelId The channel to send from
     * @param title Notification title
     * @param body Notification body
     * @param imageUrl Optional image URL (can be empty)
     * @param priority 0=low, 1=medium, 2=high, 3=urgent
     */
    function sendNotification(
        bytes32 channelId,
        string calldata title,
        string calldata body,
        string calldata imageUrl,
        uint8 priority
    ) external {
        Channel storage channel = _channels[channelId];
        if (channel.owner == address(0)) revert ChannelNotFound();
        if (!channel.active) revert ChannelNotActive();
        if (channel.owner != msg.sender) revert NotChannelOwner();
        if (priority > MAX_PRIORITY) revert InvalidPriority();
        if (bytes(title).length > MAX_TITLE_LENGTH) revert TitleTooLong();
        if (bytes(body).length > MAX_BODY_LENGTH) revert BodyTooLong();

        emit NotificationSent(channelId, title, body, imageUrl, block.timestamp, priority);
    }

    // ============ View Functions ============

    /**
     * @notice Get all subscribers of a channel
     * @param channelId The channel to query
     * @return Array of subscriber addresses
     */
    function getChannelSubscribers(bytes32 channelId) external view returns (address[] memory) {
        return _subscribers[channelId];
    }

    /**
     * @notice Get all channels a user is subscribed to
     * @param user The user address
     * @return Array of channel IDs
     */
    function getUserSubscriptions(address user) external view returns (bytes32[] memory) {
        return _userSubscriptions[user];
    }

    /**
     * @notice Check if a user is subscribed to a channel
     * @param user The user address
     * @param channelId The channel to check
     * @return True if subscribed
     */
    function isSubscribed(address user, bytes32 channelId) external view returns (bool) {
        return _isSubscribed[channelId][user];
    }

    /**
     * @notice Get channel details
     * @param channelId The channel to query
     * @return The Channel struct
     */
    function getChannel(bytes32 channelId) external view returns (Channel memory) {
        return _channels[channelId];
    }

    /**
     * @notice Get the number of subscribers for a channel
     * @param channelId The channel to query
     * @return The subscriber count
     */
    function getSubscriberCount(bytes32 channelId) external view returns (uint256) {
        return _channels[channelId].subscriberCount;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
