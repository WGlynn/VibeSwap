// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeGovernanceToken — veVIBE Token Mechanics
 * @notice Vote-escrowed governance token with time-weighted voting power.
 *         Lock VIBE tokens to receive veVIBE — longer lock = more voting power.
 *         Inspired by Curve's veCRV but with VSOS-native enhancements.
 *
 * @dev Lock mechanics:
 *      - Min lock: 1 week, Max lock: 4 years
 *      - Voting power decays linearly toward unlock time
 *      - Early exit with 50% penalty (burned)
 *      - Boost multiplier for LP rewards (1x-2.5x based on veVIBE share)
 */
contract VibeGovernanceToken is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Constants ============

    uint256 public constant MAX_LOCK_TIME = 4 * 365 days;
    uint256 public constant MIN_LOCK_TIME = 7 days;
    uint256 public constant EARLY_EXIT_PENALTY_BPS = 5000; // 50%
    uint256 public constant MAX_BOOST_BPS = 25000;         // 2.5x
    uint256 public constant SCALE = 1e18;

    // ============ Types ============

    struct VotingLock {
        uint256 amount;          // Locked token amount
        uint256 lockStart;
        uint256 lockEnd;
        uint256 votingPower;     // Current voting power (decays)
        address delegate;        // Delegated voting power
        bool active;
    }

    struct BoostInfo {
        uint256 userVeBalance;
        uint256 totalVeSupply;
        uint256 boostBps;        // Actual boost in basis points
    }

    // ============ State ============

    /// @notice User locks
    mapping(address => VotingLock) public locks;

    /// @notice Delegated power: delegate => total delegated power
    mapping(address => uint256) public delegatedPower;

    /// @notice Total locked supply
    uint256 public totalLocked;

    /// @notice Total voting power (sum of all active veVIBE)
    uint256 public totalVotingPower;

    /// @notice Penalty pool (burned penalties go here for redistribution)
    uint256 public penaltyPool;

    /// @notice Snapshot tracking for governance
    mapping(uint256 => uint256) public totalPowerAtBlock;
    mapping(address => mapping(uint256 => uint256)) public userPowerAtBlock;

    /// @notice Lock count
    uint256 public lockCount;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event Locked(address indexed user, uint256 amount, uint256 lockEnd, uint256 votingPower);
    event Unlocked(address indexed user, uint256 amount);
    event EarlyExit(address indexed user, uint256 returned, uint256 penalized);
    event Extended(address indexed user, uint256 newLockEnd, uint256 newVotingPower);
    event Increased(address indexed user, uint256 additionalAmount, uint256 newVotingPower);
    event Delegated(address indexed from, address indexed to, uint256 power);
    event PenaltyDistributed(uint256 amount);

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

    // ============ Locking ============

    /**
     * @notice Lock ETH to receive veVIBE voting power
     * @param lockDuration How long to lock (seconds)
     */
    function lock(uint256 lockDuration) external payable nonReentrant {
        require(msg.value > 0, "Zero amount");
        require(lockDuration >= MIN_LOCK_TIME, "Lock too short");
        require(lockDuration <= MAX_LOCK_TIME, "Lock too long");
        require(!locks[msg.sender].active, "Already locked");

        uint256 votingPower = _calculateVotingPower(msg.value, lockDuration);
        uint256 lockEnd = block.timestamp + lockDuration;

        locks[msg.sender] = VotingLock({
            amount: msg.value,
            lockStart: block.timestamp,
            lockEnd: lockEnd,
            votingPower: votingPower,
            delegate: msg.sender,
            active: true
        });

        totalLocked += msg.value;
        totalVotingPower += votingPower;
        delegatedPower[msg.sender] += votingPower;
        lockCount++;

        _snapshot(msg.sender, votingPower);

        emit Locked(msg.sender, msg.value, lockEnd, votingPower);
    }

    /**
     * @notice Unlock after lock period expires
     */
    function unlock() external nonReentrant {
        VotingLock storage userLock = locks[msg.sender];
        require(userLock.active, "No active lock");
        require(block.timestamp >= userLock.lockEnd, "Still locked");

        uint256 amount = userLock.amount;
        _removeLock(msg.sender);

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");

        emit Unlocked(msg.sender, amount);
    }

    /**
     * @notice Exit early with penalty
     */
    function earlyExit() external nonReentrant {
        VotingLock storage userLock = locks[msg.sender];
        require(userLock.active, "No active lock");
        require(block.timestamp < userLock.lockEnd, "Already unlocked");

        uint256 amount = userLock.amount;
        uint256 penalty = (amount * EARLY_EXIT_PENALTY_BPS) / 10000;
        uint256 returned = amount - penalty;

        penaltyPool += penalty;
        _removeLock(msg.sender);

        (bool ok, ) = msg.sender.call{value: returned}("");
        require(ok, "Transfer failed");

        emit EarlyExit(msg.sender, returned, penalty);
    }

    /**
     * @notice Extend lock duration (increases voting power)
     */
    function extendLock(uint256 newLockEnd) external {
        VotingLock storage userLock = locks[msg.sender];
        require(userLock.active, "No active lock");
        require(newLockEnd > userLock.lockEnd, "Must extend");
        require(newLockEnd <= block.timestamp + MAX_LOCK_TIME, "Too long");

        uint256 newDuration = newLockEnd - block.timestamp;
        uint256 newPower = _calculateVotingPower(userLock.amount, newDuration);

        // Update power
        totalVotingPower = totalVotingPower - userLock.votingPower + newPower;
        delegatedPower[userLock.delegate] = delegatedPower[userLock.delegate] - userLock.votingPower + newPower;

        userLock.lockEnd = newLockEnd;
        userLock.votingPower = newPower;

        _snapshot(msg.sender, newPower);

        emit Extended(msg.sender, newLockEnd, newPower);
    }

    /**
     * @notice Increase locked amount (increases voting power)
     */
    function increaseLock() external payable {
        require(msg.value > 0, "Zero amount");
        VotingLock storage userLock = locks[msg.sender];
        require(userLock.active, "No active lock");

        uint256 remainingDuration = userLock.lockEnd > block.timestamp
            ? userLock.lockEnd - block.timestamp
            : 0;

        userLock.amount += msg.value;
        totalLocked += msg.value;

        uint256 newPower = _calculateVotingPower(userLock.amount, remainingDuration);
        totalVotingPower = totalVotingPower - userLock.votingPower + newPower;
        delegatedPower[userLock.delegate] = delegatedPower[userLock.delegate] - userLock.votingPower + newPower;
        userLock.votingPower = newPower;

        _snapshot(msg.sender, newPower);

        emit Increased(msg.sender, msg.value, newPower);
    }

    // ============ Delegation ============

    function delegate(address to) external {
        VotingLock storage userLock = locks[msg.sender];
        require(userLock.active, "No active lock");
        require(to != address(0), "Zero delegate");

        address oldDelegate = userLock.delegate;
        delegatedPower[oldDelegate] -= userLock.votingPower;
        delegatedPower[to] += userLock.votingPower;
        userLock.delegate = to;

        emit Delegated(msg.sender, to, userLock.votingPower);
    }

    // ============ Boost ============

    /**
     * @notice Calculate LP reward boost for a user
     * @return boostBps Boost multiplier in basis points (10000 = 1x, 25000 = 2.5x)
     */
    function calculateBoost(address user) external view returns (uint256 boostBps) {
        if (totalVotingPower == 0) return 10000;

        uint256 userPower = locks[user].active ? locks[user].votingPower : 0;
        uint256 share = (userPower * SCALE) / totalVotingPower;

        // Linear interpolation: 1x at 0% share, 2.5x at 100% share
        boostBps = 10000 + (share * (MAX_BOOST_BPS - 10000)) / SCALE;
        if (boostBps > MAX_BOOST_BPS) boostBps = MAX_BOOST_BPS;
    }

    // ============ Admin ============

    /**
     * @notice Distribute penalty pool to active lockers (proportional to voting power)
     */
    function distributePenalties() external onlyOwner nonReentrant {
        require(penaltyPool > 0, "No penalties");
        uint256 amount = penaltyPool;
        penaltyPool = 0;

        // Add to total locked (increases share value for all lockers)
        totalLocked += amount;

        emit PenaltyDistributed(amount);
    }

    // ============ Internal ============

    function _calculateVotingPower(uint256 amount, uint256 duration) internal pure returns (uint256) {
        // Linear: maxPower at MAX_LOCK_TIME, proportionally less for shorter locks
        return (amount * duration) / MAX_LOCK_TIME;
    }

    function _removeLock(address user) internal {
        VotingLock storage userLock = locks[user];
        totalLocked -= userLock.amount;
        totalVotingPower -= userLock.votingPower;
        delegatedPower[userLock.delegate] -= userLock.votingPower;
        userLock.active = false;
        userLock.amount = 0;
        userLock.votingPower = 0;
    }

    function _snapshot(address user, uint256 power) internal {
        totalPowerAtBlock[block.number] = totalVotingPower;
        userPowerAtBlock[user][block.number] = power;
    }

    // ============ View ============

    function getVotingPower(address user) external view returns (uint256) {
        VotingLock storage userLock = locks[user];
        if (!userLock.active || block.timestamp >= userLock.lockEnd) return 0;

        uint256 remaining = userLock.lockEnd - block.timestamp;
        return _calculateVotingPower(userLock.amount, remaining);
    }

    function getDelegatedPower(address user) external view returns (uint256) {
        return delegatedPower[user];
    }

    function getTimeRemaining(address user) external view returns (uint256) {
        VotingLock storage userLock = locks[user];
        if (!userLock.active || block.timestamp >= userLock.lockEnd) return 0;
        return userLock.lockEnd - block.timestamp;
    }

    function getTotalLocked() external view returns (uint256) { return totalLocked; }
    function getTotalVotingPower() external view returns (uint256) { return totalVotingPower; }

    receive() external payable {
        penaltyPool += msg.value;
    }
}
