// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title VibeStaking
 * @notice VSOS staking module — ETH-based staking with lock-up tiers, delegation,
 *         auto-compounding, and time-weighted reward accrual.
 * @dev Uses UUPS upgradeable pattern. Rewards are funded in ETH by anyone.
 *      Part of the VSOS (VibeSwap Operating System) financial primitives.
 */
contract VibeStaking is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    // ============ Constants ============

    uint256 private constant PRECISION = 1e18;
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant EARLY_UNSTAKE_PENALTY_BPS = 5_000; // 50%

    uint256 public constant TIER_30  = 30 days;
    uint256 public constant TIER_90  = 90 days;
    uint256 public constant TIER_180 = 180 days;
    uint256 public constant TIER_365 = 365 days;
    uint256 public constant MULT_30  = 1e18;    // 1x
    uint256 public constant MULT_90  = 1.5e18;  // 1.5x
    uint256 public constant MULT_180 = 2e18;    // 2x
    uint256 public constant MULT_365 = 3e18;    // 3x

    // ============ Custom Errors ============

    error InvalidPool();
    error InvalidLockTier();
    error ZeroAmount();
    error NoStake();
    error NoPendingRewards();
    error TransferFailed();
    error PoolPaused();
    error InsufficientRewardBalance();

    // ============ Structs ============

    struct Pool {
        uint256 rewardRatePerSecond;  // ETH per second (scaled by PRECISION)
        uint256 totalStaked;          // Effective stake (with multipliers)
        uint256 totalRawStaked;       // Raw ETH staked
        uint256 accRewardPerShare;    // Accumulated rewards per share
        uint256 lastRewardTime;
        uint256 rewardBalance;        // Remaining funded rewards
        bool paused;
    }

    struct Stake {
        uint256 amount;               // Raw ETH staked
        uint256 effectiveAmount;      // amount * multiplier / PRECISION
        uint256 rewardDebt;
        uint256 lockEnd;
        uint256 lockDuration;
        uint256 pendingRewards;       // Accumulated unclaimed rewards
        address delegate;             // Voting power delegate
        bool autoCompound;
    }

    // ============ Events ============

    event PoolCreated(uint256 indexed poolId, uint256 rewardRate);
    event PoolFunded(uint256 indexed poolId, address indexed funder, uint256 amount);
    event PoolPausedToggled(uint256 indexed poolId, bool paused);
    event Staked(uint256 indexed poolId, address indexed user, uint256 amount, uint256 lock);
    event Unstaked(uint256 indexed poolId, address indexed user, uint256 amount, bool early);
    event RewardsClaimed(uint256 indexed poolId, address indexed user, uint256 amount);
    event RewardsCompounded(uint256 indexed poolId, address indexed user, uint256 amount);
    event DelegateChanged(uint256 indexed poolId, address indexed user, address indexed newDelegate);
    event AutoCompoundToggled(uint256 indexed poolId, address indexed user, bool enabled);
    event EmergencyWithdraw(uint256 indexed poolId, address indexed user, uint256 amount);

    // ============ State ============

    Pool[] public pools;
    mapping(uint256 => mapping(address => Stake)) public stakes;           // poolId => user => Stake
    mapping(uint256 => mapping(address => uint256)) public delegatedPower; // poolId => delegate => power

    uint256[50] private __gap;

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        __Ownable_init(owner_);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
    }

    // ============ Pool Management (Owner) ============

    function createPool(uint256 rewardRatePerSecond) external onlyOwner returns (uint256 poolId) {
        poolId = pools.length;
        pools.push(Pool({
            rewardRatePerSecond: rewardRatePerSecond, totalStaked: 0, totalRawStaked: 0,
            accRewardPerShare: 0, lastRewardTime: block.timestamp, rewardBalance: 0, paused: false
        }));
        emit PoolCreated(poolId, rewardRatePerSecond);
    }

    function setPoolRewardRate(uint256 poolId, uint256 newRate) external onlyOwner {
        _requireValidPool(poolId);
        _updatePool(poolId);
        pools[poolId].rewardRatePerSecond = newRate;
    }

    function togglePoolPause(uint256 poolId) external onlyOwner {
        _requireValidPool(poolId);
        pools[poolId].paused = !pools[poolId].paused;
        emit PoolPausedToggled(poolId, pools[poolId].paused);
    }

    // ============ Reward Funding ============

    function fundPool(uint256 poolId) external payable {
        _requireValidPool(poolId);
        if (msg.value == 0) revert ZeroAmount();
        pools[poolId].rewardBalance += msg.value;
        emit PoolFunded(poolId, msg.sender, msg.value);
    }

    // ============ Staking ============

    function stake(uint256 poolId, uint256 lockDuration) external payable nonReentrant {
        _requireValidPool(poolId);
        if (pools[poolId].paused) revert PoolPaused();
        if (msg.value == 0) revert ZeroAmount();

        uint256 multiplier = _getMultiplier(lockDuration);
        _updatePool(poolId);

        Stake storage s = stakes[poolId][msg.sender];

        // Harvest existing rewards first
        if (s.effectiveAmount > 0) {
            uint256 pending = (s.effectiveAmount * pools[poolId].accRewardPerShare / PRECISION) - s.rewardDebt;
            if (pending > 0) {
                s.pendingRewards += pending;
            }
        }

        uint256 effective = msg.value * multiplier / PRECISION;

        s.amount += msg.value;
        s.effectiveAmount += effective;
        s.lockEnd = block.timestamp + lockDuration;
        s.lockDuration = lockDuration;
        s.rewardDebt = s.effectiveAmount * pools[poolId].accRewardPerShare / PRECISION;

        if (s.delegate == address(0)) {
            s.delegate = msg.sender;
            delegatedPower[poolId][msg.sender] += effective;
        } else {
            delegatedPower[poolId][s.delegate] += effective;
        }

        pools[poolId].totalStaked += effective;
        pools[poolId].totalRawStaked += msg.value;

        emit Staked(poolId, msg.sender, msg.value, lockDuration);
    }

    function unstake(uint256 poolId) external nonReentrant {
        _requireValidPool(poolId);
        Stake storage s = stakes[poolId][msg.sender];
        if (s.amount == 0) revert NoStake();

        _updatePool(poolId);

        uint256 pending = (s.effectiveAmount * pools[poolId].accRewardPerShare / PRECISION) - s.rewardDebt;
        uint256 totalRewards = s.pendingRewards + pending;

        bool early = block.timestamp < s.lockEnd;
        uint256 rewardPayout = totalRewards;

        if (early) {
            // 50% penalty on rewards for early unstake
            rewardPayout = totalRewards * (BPS_DENOMINATOR - EARLY_UNSTAKE_PENALTY_BPS) / BPS_DENOMINATOR;
            // Forfeited rewards go back to pool
            pools[poolId].rewardBalance += (totalRewards - rewardPayout);
        }

        uint256 principal = s.amount;
        uint256 effective = s.effectiveAmount;

        // Remove delegation
        delegatedPower[poolId][s.delegate] -= effective;

        pools[poolId].totalStaked -= effective;
        pools[poolId].totalRawStaked -= principal;

        // Clear stake
        delete stakes[poolId][msg.sender];

        // Transfer principal + rewards
        uint256 total = principal + rewardPayout;
        if (rewardPayout > pools[poolId].rewardBalance) revert InsufficientRewardBalance();
        pools[poolId].rewardBalance -= rewardPayout;

        (bool ok,) = payable(msg.sender).call{value: total}("");
        if (!ok) revert TransferFailed();

        emit Unstaked(poolId, msg.sender, principal, early);
        if (rewardPayout > 0) {
            emit RewardsClaimed(poolId, msg.sender, rewardPayout);
        }
    }

    // ============ Rewards ============

    function claimRewards(uint256 poolId) external nonReentrant {
        _requireValidPool(poolId);
        Stake storage s = stakes[poolId][msg.sender];
        if (s.amount == 0) revert NoStake();

        _updatePool(poolId);

        uint256 pending = (s.effectiveAmount * pools[poolId].accRewardPerShare / PRECISION) - s.rewardDebt;
        uint256 totalRewards = s.pendingRewards + pending;
        if (totalRewards == 0) revert NoPendingRewards();

        s.pendingRewards = 0;
        s.rewardDebt = s.effectiveAmount * pools[poolId].accRewardPerShare / PRECISION;

        if (s.autoCompound) {
            _compound(poolId, msg.sender, totalRewards);
        } else {
            if (totalRewards > pools[poolId].rewardBalance) revert InsufficientRewardBalance();
            pools[poolId].rewardBalance -= totalRewards;

            (bool ok,) = payable(msg.sender).call{value: totalRewards}("");
            if (!ok) revert TransferFailed();

            emit RewardsClaimed(poolId, msg.sender, totalRewards);
        }
    }

    // ============ Auto-Compound ============

    function setAutoCompound(uint256 poolId, bool enabled) external {
        _requireValidPool(poolId);
        if (stakes[poolId][msg.sender].amount == 0) revert NoStake();
        stakes[poolId][msg.sender].autoCompound = enabled;
        emit AutoCompoundToggled(poolId, msg.sender, enabled);
    }

    function _compound(uint256 poolId, address user, uint256 rewardAmount) internal {
        if (rewardAmount > pools[poolId].rewardBalance) revert InsufficientRewardBalance();
        pools[poolId].rewardBalance -= rewardAmount;

        Stake storage s = stakes[poolId][user];
        uint256 multiplier = _getMultiplier(s.lockDuration);
        uint256 effective = rewardAmount * multiplier / PRECISION;

        s.amount += rewardAmount;
        s.effectiveAmount += effective;
        s.rewardDebt = s.effectiveAmount * pools[poolId].accRewardPerShare / PRECISION;

        delegatedPower[poolId][s.delegate] += effective;
        pools[poolId].totalStaked += effective;
        pools[poolId].totalRawStaked += rewardAmount;

        emit RewardsCompounded(poolId, user, rewardAmount);
    }

    // ============ Delegation ============

    function setDelegate(uint256 poolId, address delegate) external {
        _requireValidPool(poolId);
        Stake storage s = stakes[poolId][msg.sender];
        if (s.amount == 0) revert NoStake();

        address oldDelegate = s.delegate;
        delegatedPower[poolId][oldDelegate] -= s.effectiveAmount;
        delegatedPower[poolId][delegate] += s.effectiveAmount;
        s.delegate = delegate;

        emit DelegateChanged(poolId, msg.sender, delegate);
    }

    // ============ Emergency ============

    function emergencyWithdraw(uint256 poolId) external nonReentrant {
        _requireValidPool(poolId);
        Stake storage s = stakes[poolId][msg.sender];
        if (s.amount == 0) revert NoStake();

        uint256 principal = s.amount;
        uint256 effective = s.effectiveAmount;

        delegatedPower[poolId][s.delegate] -= effective;
        pools[poolId].totalStaked -= effective;
        pools[poolId].totalRawStaked -= principal;

        // Forfeit ALL rewards
        delete stakes[poolId][msg.sender];

        (bool ok,) = payable(msg.sender).call{value: principal}("");
        if (!ok) revert TransferFailed();

        emit EmergencyWithdraw(poolId, msg.sender, principal);
    }

    // ============ View Functions ============

    function getUserStake(uint256 poolId, address user) external view returns (
        uint256 amount, uint256 effectiveAmount, uint256 lockEnd,
        uint256 lockDuration, address delegate, bool autoCompound
    ) {
        Stake storage s = stakes[poolId][user];
        return (s.amount, s.effectiveAmount, s.lockEnd, s.lockDuration, s.delegate, s.autoCompound);
    }

    function getPendingRewards(uint256 poolId, address user) external view returns (uint256) {
        Pool storage pool = pools[poolId];
        Stake storage s = stakes[poolId][user];
        if (s.effectiveAmount == 0) return s.pendingRewards;

        uint256 accReward = pool.accRewardPerShare;
        if (block.timestamp > pool.lastRewardTime && pool.totalStaked > 0) {
            uint256 elapsed = block.timestamp - pool.lastRewardTime;
            uint256 reward = elapsed * pool.rewardRatePerSecond;
            if (reward > pool.rewardBalance) {
                reward = pool.rewardBalance;
            }
            accReward += reward * PRECISION / pool.totalStaked;
        }

        return s.pendingRewards + (s.effectiveAmount * accReward / PRECISION) - s.rewardDebt;
    }

    function getPoolInfo(uint256 poolId) external view returns (
        uint256 rewardRatePerSecond, uint256 totalStaked, uint256 totalRawStaked,
        uint256 rewardBalance, bool paused
    ) {
        _requireValidPool(poolId);
        Pool storage p = pools[poolId];
        return (p.rewardRatePerSecond, p.totalStaked, p.totalRawStaked, p.rewardBalance, p.paused);
    }

    function getTotalStaked(uint256 poolId) external view returns (uint256) {
        _requireValidPool(poolId);
        return pools[poolId].totalRawStaked;
    }

    function getPoolCount() external view returns (uint256) { return pools.length; }

    function getDelegatedPower(uint256 poolId, address delegate) external view returns (uint256) {
        return delegatedPower[poolId][delegate];
    }

    // ============ Internal ============

    function _updatePool(uint256 poolId) internal {
        Pool storage pool = pools[poolId];
        if (block.timestamp <= pool.lastRewardTime) return;
        if (pool.totalStaked == 0) { pool.lastRewardTime = block.timestamp; return; }
        uint256 elapsed = block.timestamp - pool.lastRewardTime;
        uint256 reward = elapsed * pool.rewardRatePerSecond;
        if (reward > pool.rewardBalance) reward = pool.rewardBalance; // cap at funded amount
        pool.accRewardPerShare += reward * PRECISION / pool.totalStaked;
        pool.lastRewardTime = block.timestamp;
    }

    function _getMultiplier(uint256 lockDuration) internal pure returns (uint256) {
        if (lockDuration == TIER_30)  return MULT_30;
        if (lockDuration == TIER_90)  return MULT_90;
        if (lockDuration == TIER_180) return MULT_180;
        if (lockDuration == TIER_365) return MULT_365;
        revert InvalidLockTier();
    }

    function _requireValidPool(uint256 poolId) internal view {
        if (poolId >= pools.length) revert InvalidPool();
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
