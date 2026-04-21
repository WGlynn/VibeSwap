// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeRewardStreamer — Continuous Per-Second Reward Streaming
 * @notice Instead of claiming rewards in chunks, rewards flow continuously
 *         to stakers every second. Like Sablier but for protocol rewards.
 *
 * Mechanism:
 * - Owner creates reward streams (X tokens over Y seconds)
 * - Stakers earn proportional share per-second
 * - Claimable balance increases in real-time
 * - Multiple concurrent streams supported
 */
contract VibeRewardStreamer is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    struct Stream {
        uint256 totalReward;
        uint256 rewardPerSecond;
        uint256 startTime;
        uint256 endTime;
        uint256 lastUpdateTime;
        uint256 rewardPerTokenStored;
        bool active;
    }

    // ============ State ============

    Stream[] public streams;
    mapping(address => uint256) public stakedBalance;
    uint256 public totalStaked;

    // Per stream, per user tracking
    mapping(uint256 => mapping(address => uint256)) public userRewardPerTokenPaid;
    mapping(uint256 => mapping(address => uint256)) public rewards;

    uint256 public totalClaimed;
    uint256 public stakerCount;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event StreamCreated(uint256 indexed id, uint256 totalReward, uint256 duration);
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 streamId, uint256 amount);

    // ============ Initialize ============

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

    // ============ Stream Management ============

    function createStream(uint256 duration) external payable onlyOwner {
        require(msg.value > 0, "Zero reward");
        require(duration > 0, "Zero duration");

        uint256 rps = msg.value / duration;
        require(rps > 0, "Reward rate too low");

        streams.push(Stream({
            totalReward: msg.value,
            rewardPerSecond: rps,
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            lastUpdateTime: block.timestamp,
            rewardPerTokenStored: 0,
            active: true
        }));

        emit StreamCreated(streams.length - 1, msg.value, duration);
    }

    // ============ Staking ============

    function stake() external payable {
        require(msg.value > 0, "Zero stake");
        _updateAllRewards(msg.sender);

        if (stakedBalance[msg.sender] == 0) stakerCount++;
        stakedBalance[msg.sender] += msg.value;
        totalStaked += msg.value;

        emit Staked(msg.sender, msg.value);
    }

    function unstake(uint256 amount) external nonReentrant {
        require(stakedBalance[msg.sender] >= amount, "Insufficient");
        _updateAllRewards(msg.sender);

        stakedBalance[msg.sender] -= amount;
        totalStaked -= amount;
        if (stakedBalance[msg.sender] == 0) stakerCount--;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Unstake failed");

        emit Unstaked(msg.sender, amount);
    }

    // ============ Rewards ============

    function claimAll() external nonReentrant {
        _updateAllRewards(msg.sender);

        uint256 totalOwed = 0;
        for (uint256 i = 0; i < streams.length; i++) {
            uint256 reward = rewards[i][msg.sender];
            if (reward > 0) {
                rewards[i][msg.sender] = 0;
                totalOwed += reward;
                emit RewardClaimed(msg.sender, i, reward);
            }
        }

        require(totalOwed > 0, "Nothing to claim");
        totalClaimed += totalOwed;

        (bool ok, ) = msg.sender.call{value: totalOwed}("");
        require(ok, "Claim failed");
    }

    function claimStream(uint256 streamId) external nonReentrant {
        require(streamId < streams.length, "Invalid stream");
        _updateReward(streamId, msg.sender);

        uint256 reward = rewards[streamId][msg.sender];
        require(reward > 0, "Nothing to claim");

        rewards[streamId][msg.sender] = 0;
        totalClaimed += reward;

        (bool ok, ) = msg.sender.call{value: reward}("");
        require(ok, "Claim failed");

        emit RewardClaimed(msg.sender, streamId, reward);
    }

    // ============ Internal ============

    function _updateAllRewards(address user) internal {
        for (uint256 i = 0; i < streams.length; i++) {
            _updateReward(i, user);
        }
    }

    function _updateReward(uint256 streamId, address user) internal {
        Stream storage s = streams[streamId];
        s.rewardPerTokenStored = _rewardPerToken(streamId);
        s.lastUpdateTime = _lastTimeRewardApplicable(streamId);

        if (user != address(0)) {
            rewards[streamId][user] = _earned(streamId, user);
            userRewardPerTokenPaid[streamId][user] = s.rewardPerTokenStored;
        }
    }

    function _rewardPerToken(uint256 streamId) internal view returns (uint256) {
        Stream storage s = streams[streamId];
        if (totalStaked == 0) return s.rewardPerTokenStored;

        uint256 timeElapsed = _lastTimeRewardApplicable(streamId) - s.lastUpdateTime;
        return s.rewardPerTokenStored + (timeElapsed * s.rewardPerSecond * 1e18) / totalStaked;
    }

    function _earned(uint256 streamId, address user) internal view returns (uint256) {
        return (stakedBalance[user] * (_rewardPerToken(streamId) - userRewardPerTokenPaid[streamId][user])) / 1e18
            + rewards[streamId][user];
    }

    function _lastTimeRewardApplicable(uint256 streamId) internal view returns (uint256) {
        Stream storage s = streams[streamId];
        return block.timestamp < s.endTime ? block.timestamp : s.endTime;
    }

    // ============ Views ============

    function streamCount() external view returns (uint256) { return streams.length; }

    function earned(address user, uint256 streamId) external view returns (uint256) {
        return _earned(streamId, user);
    }

    function totalEarned(address user) external view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < streams.length; i++) {
            total += _earned(i, user);
        }
        return total;
    }

    receive() external payable {}
}
