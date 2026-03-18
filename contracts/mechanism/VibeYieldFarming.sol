// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeYieldFarming — Multi-Pool Yield Farming
 * @notice MasterChef-style yield farming with allocation points.
 *         Distribute VIBE rewards across multiple staking pools.
 *
 * @dev Architecture:
 *      - Multiple pools, each with allocation points
 *      - Reward per block distributed proportionally
 *      - Deposit fee option (burned or sent to treasury)
 *      - Harvest and compound in one tx
 *      - Bonus multiplier for early participants
 */
contract VibeYieldFarming is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant SCALE = 1e18;

    // ============ Types ============

    struct PoolInfo {
        IERC20 stakeToken;
        uint256 allocPoint;
        uint256 lastRewardBlock;
        uint256 accRewardPerShare;
        uint256 depositFeeBps;      // Max 400 (4%)
        uint256 totalStaked;
        bool active;
    }

    struct UserInfo {
        uint256 amount;
        uint256 rewardDebt;
    }

    // ============ State ============

    PoolInfo[] public poolInfo;

    /// @notice User info per pool: pid => user => UserInfo
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;

    /// @notice Reward per block (in wei)
    uint256 public rewardPerBlock;

    /// @notice Total allocation points
    uint256 public totalAllocPoint;

    /// @notice Start block
    uint256 public startBlock;

    /// @notice Bonus multiplier (for first N blocks)
    uint256 public bonusMultiplier;
    uint256 public bonusEndBlock;

    /// @notice Fee recipient
    address public feeRecipient;

    /// @notice Total rewards distributed
    uint256 public totalRewardsDistributed;

    // ============ Events ============

    event PoolAdded(uint256 indexed pid, address stakeToken, uint256 allocPoint);
    event Deposited(uint256 indexed pid, address indexed user, uint256 amount);
    event Withdrawn(uint256 indexed pid, address indexed user, uint256 amount);
    event Harvested(uint256 indexed pid, address indexed user, uint256 reward);
    event EmergencyWithdrawn(uint256 indexed pid, address indexed user, uint256 amount);
    event PoolUpdated(uint256 indexed pid, uint256 allocPoint);

    // ============ Init ============

    function initialize(
        uint256 _rewardPerBlock,
        uint256 _startBlock,
        address _feeRecipient
    ) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        rewardPerBlock = _rewardPerBlock;
        startBlock = _startBlock;
        feeRecipient = _feeRecipient;
        bonusMultiplier = 3; // 3x for first period
        bonusEndBlock = _startBlock + 100000; // ~2 weeks of bonus
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Pool Management ============

    function addPool(
        address stakeToken,
        uint256 allocPoint,
        uint256 depositFeeBps
    ) external onlyOwner {
        require(depositFeeBps <= 400, "Max 4% fee");

        _massUpdatePools();

        uint256 lastRewardBlock = block.number > startBlock ? block.number : startBlock;
        totalAllocPoint += allocPoint;

        poolInfo.push(PoolInfo({
            stakeToken: IERC20(stakeToken),
            allocPoint: allocPoint,
            lastRewardBlock: lastRewardBlock,
            accRewardPerShare: 0,
            depositFeeBps: depositFeeBps,
            totalStaked: 0,
            active: true
        }));

        emit PoolAdded(poolInfo.length - 1, stakeToken, allocPoint);
    }

    function setPool(uint256 pid, uint256 allocPoint) external onlyOwner {
        _massUpdatePools();
        totalAllocPoint = totalAllocPoint - poolInfo[pid].allocPoint + allocPoint;
        poolInfo[pid].allocPoint = allocPoint;
        emit PoolUpdated(pid, allocPoint);
    }

    // ============ Farming ============

    function deposit(uint256 pid, uint256 amount) external nonReentrant {
        PoolInfo storage pool = poolInfo[pid];
        UserInfo storage user = userInfo[pid][msg.sender];
        require(pool.active, "Pool not active");

        _updatePool(pid);

        // Harvest pending rewards
        if (user.amount > 0) {
            uint256 pending = (user.amount * pool.accRewardPerShare) / SCALE - user.rewardDebt;
            if (pending > 0) {
                _safeRewardTransfer(msg.sender, pending);
                emit Harvested(pid, msg.sender, pending);
            }
        }

        if (amount > 0) {
            pool.stakeToken.safeTransferFrom(msg.sender, address(this), amount);

            // Deposit fee
            if (pool.depositFeeBps > 0) {
                uint256 fee = (amount * pool.depositFeeBps) / 10000;
                pool.stakeToken.safeTransfer(feeRecipient, fee);
                amount -= fee;
            }

            user.amount += amount;
            pool.totalStaked += amount;
        }

        user.rewardDebt = (user.amount * pool.accRewardPerShare) / SCALE;

        emit Deposited(pid, msg.sender, amount);
    }

    function withdraw(uint256 pid, uint256 amount) external nonReentrant {
        PoolInfo storage pool = poolInfo[pid];
        UserInfo storage user = userInfo[pid][msg.sender];
        require(user.amount >= amount, "Insufficient stake");

        _updatePool(pid);

        // Harvest pending
        uint256 pending = (user.amount * pool.accRewardPerShare) / SCALE - user.rewardDebt;
        if (pending > 0) {
            _safeRewardTransfer(msg.sender, pending);
            emit Harvested(pid, msg.sender, pending);
        }

        if (amount > 0) {
            user.amount -= amount;
            pool.totalStaked -= amount;
            pool.stakeToken.safeTransfer(msg.sender, amount);
        }

        user.rewardDebt = (user.amount * pool.accRewardPerShare) / SCALE;

        emit Withdrawn(pid, msg.sender, amount);
    }

    function harvest(uint256 pid) external nonReentrant {
        PoolInfo storage pool = poolInfo[pid];
        UserInfo storage user = userInfo[pid][msg.sender];

        _updatePool(pid);

        uint256 pending = (user.amount * pool.accRewardPerShare) / SCALE - user.rewardDebt;
        require(pending > 0, "No rewards");

        user.rewardDebt = (user.amount * pool.accRewardPerShare) / SCALE;
        _safeRewardTransfer(msg.sender, pending);

        emit Harvested(pid, msg.sender, pending);
    }

    function emergencyWithdraw(uint256 pid) external nonReentrant {
        PoolInfo storage pool = poolInfo[pid];
        UserInfo storage user = userInfo[pid][msg.sender];

        uint256 amount = user.amount;
        user.amount = 0;
        user.rewardDebt = 0;
        pool.totalStaked -= amount;

        pool.stakeToken.safeTransfer(msg.sender, amount);

        emit EmergencyWithdrawn(pid, msg.sender, amount);
    }

    // ============ Admin ============

    function setRewardPerBlock(uint256 _rewardPerBlock) external onlyOwner {
        _massUpdatePools();
        rewardPerBlock = _rewardPerBlock;
    }

    function setBonusMultiplier(uint256 multiplier) external onlyOwner {
        bonusMultiplier = multiplier;
    }

    // ============ Internal ============

    function _updatePool(uint256 pid) internal {
        PoolInfo storage pool = poolInfo[pid];
        if (block.number <= pool.lastRewardBlock) return;

        if (pool.totalStaked == 0 || totalAllocPoint == 0) {
            pool.lastRewardBlock = block.number;
            return;
        }

        uint256 blocks = _getMultiplier(pool.lastRewardBlock, block.number);
        uint256 reward = (blocks * rewardPerBlock * pool.allocPoint) / totalAllocPoint;

        pool.accRewardPerShare += (reward * SCALE) / pool.totalStaked;
        pool.lastRewardBlock = block.number;
        totalRewardsDistributed += reward;
    }

    function _massUpdatePools() internal {
        for (uint256 pid = 0; pid < poolInfo.length; pid++) {
            _updatePool(pid);
        }
    }

    function _getMultiplier(uint256 from, uint256 to) internal view returns (uint256) {
        if (to <= bonusEndBlock) {
            return (to - from) * bonusMultiplier;
        } else if (from >= bonusEndBlock) {
            return to - from;
        } else {
            return ((bonusEndBlock - from) * bonusMultiplier) + (to - bonusEndBlock);
        }
    }

    function _safeRewardTransfer(address to, uint256 amount) internal {
        uint256 bal = address(this).balance;
        uint256 transferAmount = amount > bal ? bal : amount;
        if (transferAmount > 0) {
            (bool ok, ) = to.call{value: transferAmount}("");
            require(ok, "Reward transfer failed");
        }
    }

    // ============ View ============

    function poolLength() external view returns (uint256) { return poolInfo.length; }

    function pendingReward(uint256 pid, address user) external view returns (uint256) {
        PoolInfo storage pool = poolInfo[pid];
        UserInfo storage u = userInfo[pid][user];

        uint256 accPerShare = pool.accRewardPerShare;
        if (block.number > pool.lastRewardBlock && pool.totalStaked > 0 && totalAllocPoint > 0) {
            uint256 blocks = _getMultiplier(pool.lastRewardBlock, block.number);
            uint256 reward = (blocks * rewardPerBlock * pool.allocPoint) / totalAllocPoint;
            accPerShare += (reward * SCALE) / pool.totalStaked;
        }

        return (u.amount * accPerShare) / SCALE - u.rewardDebt;
    }

    receive() external payable {}
}
