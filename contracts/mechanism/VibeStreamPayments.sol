// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeStreamPayments — Sablier-Style Continuous Payment Streams
 * @notice Absorbs Sablier/Superfluid streaming pattern: real-time per-second
 *         payment flows. Employers pay workers continuously, DAOs stream
 *         contributor salaries, subscription services charge per-second.
 *         Combined with x402 for metered API access.
 *
 * @dev Architecture:
 *      - Linear streams: constant rate from start to end
 *      - Cliff streams: nothing until cliff, then linear
 *      - Cancellable: sender can cancel, recipient keeps accrued
 *      - Multi-recipient: one sender, many streams
 *      - Composable: streams can fund other streams (cascade)
 */
contract VibeStreamPayments is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum StreamType { LINEAR, CLIFF, EXPONENTIAL }
    enum StreamStatus { ACTIVE, PAUSED, CANCELLED, COMPLETED }

    struct Stream {
        uint256 streamId;
        address sender;
        address recipient;
        StreamType streamType;
        uint256 deposit;             // Total ETH deposited
        uint256 ratePerSecond;       // Wei per second
        uint256 startTime;
        uint256 endTime;
        uint256 cliffTime;           // 0 if no cliff
        uint256 withdrawn;           // Already withdrawn by recipient
        StreamStatus status;
        bytes32 memo;                // Purpose hash
    }

    // ============ State ============

    mapping(uint256 => Stream) public streams;
    uint256 public streamCount;

    /// @notice Sender's active streams
    mapping(address => uint256[]) public senderStreams;

    /// @notice Recipient's active streams
    mapping(address => uint256[]) public recipientStreams;

    /// @notice Stats
    uint256 public totalStreamed;
    uint256 public totalWithdrawn;
    uint256 public activeStreamCount;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event StreamCreated(uint256 indexed streamId, address indexed sender, address indexed recipient, uint256 deposit, uint256 ratePerSecond);
    event StreamWithdrawn(uint256 indexed streamId, address indexed recipient, uint256 amount);
    event StreamCancelled(uint256 indexed streamId, uint256 recipientAmount, uint256 senderRefund);
    event StreamPaused(uint256 indexed streamId);
    event StreamResumed(uint256 indexed streamId);

    // ============ Init ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Create Streams ============

    function createStream(
        address recipient,
        StreamType streamType,
        uint256 durationSeconds,
        uint256 cliffSeconds,
        bytes32 memo
    ) external payable returns (uint256) {
        require(msg.value > 0, "Zero deposit");
        require(recipient != address(0) && recipient != msg.sender, "Invalid recipient");
        require(durationSeconds > 0, "Zero duration");

        uint256 ratePerSecond = msg.value / durationSeconds;
        require(ratePerSecond > 0, "Rate too low");

        streamCount++;
        streams[streamCount] = Stream({
            streamId: streamCount,
            sender: msg.sender,
            recipient: recipient,
            streamType: streamType,
            deposit: msg.value,
            ratePerSecond: ratePerSecond,
            startTime: block.timestamp,
            endTime: block.timestamp + durationSeconds,
            cliffTime: cliffSeconds > 0 ? block.timestamp + cliffSeconds : 0,
            withdrawn: 0,
            status: StreamStatus.ACTIVE,
            memo: memo
        });

        senderStreams[msg.sender].push(streamCount);
        recipientStreams[recipient].push(streamCount);
        activeStreamCount++;
        totalStreamed += msg.value;

        emit StreamCreated(streamCount, msg.sender, recipient, msg.value, ratePerSecond);
        return streamCount;
    }

    // ============ Withdraw ============

    function withdraw(uint256 streamId) external nonReentrant {
        Stream storage s = streams[streamId];
        require(s.recipient == msg.sender, "Not recipient");
        require(s.status == StreamStatus.ACTIVE, "Not active");

        uint256 available = _availableBalance(s);
        require(available > 0, "Nothing to withdraw");

        s.withdrawn += available;
        totalWithdrawn += available;

        if (s.withdrawn >= s.deposit) {
            s.status = StreamStatus.COMPLETED;
            activeStreamCount--;
        }

        (bool ok, ) = msg.sender.call{value: available}("");
        require(ok, "Transfer failed");

        emit StreamWithdrawn(streamId, msg.sender, available);
    }

    // ============ Cancel ============

    function cancelStream(uint256 streamId) external nonReentrant {
        Stream storage s = streams[streamId];
        require(s.sender == msg.sender, "Not sender");
        require(s.status == StreamStatus.ACTIVE, "Not active");

        uint256 recipientAmount = _availableBalance(s);
        uint256 senderRefund = s.deposit - s.withdrawn - recipientAmount;

        s.status = StreamStatus.CANCELLED;
        s.withdrawn += recipientAmount;
        activeStreamCount--;

        if (recipientAmount > 0) {
            (bool ok1, ) = s.recipient.call{value: recipientAmount}("");
            require(ok1, "Recipient payment failed");
        }

        if (senderRefund > 0) {
            (bool ok2, ) = msg.sender.call{value: senderRefund}("");
            require(ok2, "Sender refund failed");
        }

        emit StreamCancelled(streamId, recipientAmount, senderRefund);
    }

    // ============ Internal ============

    function _availableBalance(Stream storage s) internal view returns (uint256) {
        if (s.cliffTime > 0 && block.timestamp < s.cliffTime) {
            return 0; // Before cliff
        }

        uint256 elapsed;
        if (block.timestamp >= s.endTime) {
            elapsed = s.endTime - s.startTime;
        } else {
            elapsed = block.timestamp - s.startTime;
        }

        uint256 totalEarned = elapsed * s.ratePerSecond;
        if (totalEarned > s.deposit) totalEarned = s.deposit;

        return totalEarned - s.withdrawn;
    }

    // ============ View ============

    function balanceOf(uint256 streamId) external view returns (uint256) {
        return _availableBalance(streams[streamId]);
    }

    function getStream(uint256 id) external view returns (Stream memory) { return streams[id]; }
    function getSenderStreams(address sender) external view returns (uint256[] memory) { return senderStreams[sender]; }
    function getRecipientStreams(address recipient) external view returns (uint256[] memory) { return recipientStreams[recipient]; }

    receive() external payable {}
}
