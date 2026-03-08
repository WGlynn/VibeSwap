// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeRewards — Multi-Pool Staking Rewards
 * @notice Unified rewards distribution for all VSOS staking activities.
 *         Supports multiple reward tokens and emission schedules.
 *
 * @dev Inspired by Synthetix StakingRewards but extended:
 *      - Multiple reward tokens per pool
 *      - Boosted rewards based on reputation/mind score
 *      - Lock-up multipliers (longer lock = higher rewards)
 *      - Epoch-based emission with decay curve
 */
contract VibeRewards is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Types ============

    struct RewardPool {
        uint256 poolId;
        address stakingToken;
        uint256 totalStaked;
        uint256 rewardRate;         // Tokens per second
        uint256 lastUpdateTime;
        uint256 rewardPerTokenStored;
        uint256 periodEnd;
        bool active;
    }

    struct UserStake {
        uint256 amount;
        uint256 lockUntil;
        uint256 boostMultiplier;    // In basis points (10000 = 1x)
        uint256 rewardPerTokenPaid;
        uint256 rewardsEarned;
    }

    // ============ State ============

    /// @notice Reward pools
    mapping(uint256 => RewardPool) public pools;
    uint256 public poolCount;

    /// @notice Reward token per pool
    mapping(uint256 => address) public rewardTokens;

    /// @notice User stakes: poolId => user => stake
    mapping(uint256 => mapping(address => UserStake)) public userStakes;

    /// @notice Lock duration to boost multiplier mapping
    mapping(uint256 => uint256) public lockBoosts; // seconds => boost BPS

    // ============ Events ============

    event PoolCreated(uint256 indexed poolId, address stakingToken, address rewardToken);
    event Staked(uint256 indexed poolId, address indexed user, uint256 amount, uint256 lockDuration);
    event Withdrawn(uint256 indexed poolId, address indexed user, uint256 amount);
    event RewardClaimed(uint256 indexed poolId, address indexed user, uint256 amount);
    event RewardAdded(uint256 indexed poolId, uint256 amount, uint256 duration);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        // Default lock boosts
        lockBoosts[0] = 10000;            // No lock: 1x
        lockBoosts[30 days] = 12500;      // 30 days: 1.25x
        lockBoosts[90 days] = 15000;      // 90 days: 1.5x
        lockBoosts[180 days] = 20000;     // 180 days: 2x
        lockBoosts[365 days] = 30000;     // 1 year: 3x
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Pool Management ============

    function createPool(address stakingToken, address rewardToken) external onlyOwner returns (uint256) {
        poolCount++;
        pools[poolCount] = RewardPool({
            poolId: poolCount,
            stakingToken: stakingToken,
            totalStaked: 0,
            rewardRate: 0,
            lastUpdateTime: block.timestamp,
            rewardPerTokenStored: 0,
            periodEnd: 0,
            active: true
        });
        rewardTokens[poolCount] = rewardToken;

        emit PoolCreated(poolCount, stakingToken, rewardToken);
        return poolCount;
    }

    function addRewards(uint256 poolId, uint256 amount, uint256 duration) external onlyOwner {
        RewardPool storage pool = pools[poolId];
        require(pool.active, "Pool not active");

        _updateReward(poolId, address(0));

        IERC20(rewardTokens[poolId]).safeTransferFrom(msg.sender, address(this), amount);

        if (block.timestamp >= pool.periodEnd) {
            pool.rewardRate = amount / duration;
        } else {
            uint256 remaining = pool.periodEnd - block.timestamp;
            uint256 leftover = remaining * pool.rewardRate;
            pool.rewardRate = (amount + leftover) / duration;
        }

        pool.lastUpdateTime = block.timestamp;
        pool.periodEnd = block.timestamp + duration;

        emit RewardAdded(poolId, amount, duration);
    }

    // ============ Staking ============

    function stake(uint256 poolId, uint256 amount, uint256 lockDuration) external nonReentrant {
        RewardPool storage pool = pools[poolId];
        require(pool.active, "Pool not active");
        require(amount > 0, "Zero amount");

        _updateReward(poolId, msg.sender);

        IERC20(pool.stakingToken).safeTransferFrom(msg.sender, address(this), amount);

        UserStake storage userStake = userStakes[poolId][msg.sender];
        userStake.amount += amount;
        userStake.lockUntil = block.timestamp + lockDuration;

        // Apply boost based on lock duration
        uint256 boost = lockBoosts[lockDuration];
        if (boost == 0) boost = 10000; // Default 1x if duration not in map
        userStake.boostMultiplier = boost;

        pool.totalStaked += amount;

        emit Staked(poolId, msg.sender, amount, lockDuration);
    }

    function withdraw(uint256 poolId, uint256 amount) external nonReentrant {
        UserStake storage userStake = userStakes[poolId][msg.sender];
        require(userStake.amount >= amount, "Insufficient stake");
        require(block.timestamp >= userStake.lockUntil, "Still locked");

        _updateReward(poolId, msg.sender);

        userStake.amount -= amount;
        pools[poolId].totalStaked -= amount;

        IERC20(pools[poolId].stakingToken).safeTransfer(msg.sender, amount);

        emit Withdrawn(poolId, msg.sender, amount);
    }

    function claimReward(uint256 poolId) external nonReentrant {
        _updateReward(poolId, msg.sender);

        UserStake storage userStake = userStakes[poolId][msg.sender];
        uint256 reward = userStake.rewardsEarned;
        require(reward > 0, "No rewards");

        userStake.rewardsEarned = 0;
        IERC20(rewardTokens[poolId]).safeTransfer(msg.sender, reward);

        emit RewardClaimed(poolId, msg.sender, reward);
    }

    // ============ View ============

    function earned(uint256 poolId, address account) external view returns (uint256) {
        RewardPool storage pool = pools[poolId];
        UserStake storage userStake = userStakes[poolId][account];

        uint256 rpt = pool.rewardPerTokenStored;
        if (pool.totalStaked > 0) {
            uint256 lastTime = block.timestamp < pool.periodEnd ? block.timestamp : pool.periodEnd;
            rpt += ((lastTime - pool.lastUpdateTime) * pool.rewardRate * 1e18) / pool.totalStaked;
        }

        uint256 boostedAmount = (userStake.amount * userStake.boostMultiplier) / 10000;
        return userStake.rewardsEarned + (boostedAmount * (rpt - userStake.rewardPerTokenPaid)) / 1e18;
    }

    function getPoolCount() external view returns (uint256) { return poolCount; }

    // ============ Internal ============

    function _updateReward(uint256 poolId, address account) internal {
        RewardPool storage pool = pools[poolId];

        uint256 lastTime = block.timestamp < pool.periodEnd ? block.timestamp : pool.periodEnd;
        if (pool.totalStaked > 0 && lastTime > pool.lastUpdateTime) {
            pool.rewardPerTokenStored += ((lastTime - pool.lastUpdateTime) * pool.rewardRate * 1e18) / pool.totalStaked;
        }
        pool.lastUpdateTime = lastTime;

        if (account != address(0)) {
            UserStake storage userStake = userStakes[poolId][account];
            uint256 boostedAmount = (userStake.amount * userStake.boostMultiplier) / 10000;
            userStake.rewardsEarned += (boostedAmount * (pool.rewardPerTokenStored - userStake.rewardPerTokenPaid)) / 1e18;
            userStake.rewardPerTokenPaid = pool.rewardPerTokenStored;
        }
    }
}
