// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IVibeKeeperNetwork.sol";
import "../oracle/IReputationOracle.sol";

/**
 * @title VibeKeeperNetwork
 * @notice Decentralized keeper network for protocol maintenance.
 * @dev Part of VSOS (VibeSwap Operating System) Protocol Framework.
 *
 *      Removes single-operator dependency: anyone can stake JUL, register
 *      as a keeper, and earn rewards for maintaining protocol health.
 *
 *      Keeper tasks include:
 *        - Settling batch auctions (CommitRevealAuction/VibeSwapCore)
 *        - Liquidating undercollateralized positions (VibeCredit/VibeSynth)
 *        - Executing timelocked governance (VibeTimelock)
 *        - Resolving insurance markets (VibeInsurance)
 *
 *      The network contract is authorized on target contracts (as settler,
 *      resolver, executor). Keepers call through the network, which:
 *        1. Validates the keeper is registered and active
 *        2. Forwards the call to the target contract
 *        3. Tracks success/failure
 *        4. Distributes JUL rewards on success
 *
 *      Reputation integration:
 *        - Higher trust tier = lower minimum stake
 *        - Performance score = successes / (successes + failures)
 *        - Slashing for governance-decided violations only
 */
contract VibeKeeperNetwork is Ownable, ReentrancyGuard, IVibeKeeperNetwork {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant MIN_STAKE = 100 ether;
    uint256 public constant STAKE_COOLDOWN = 7 days;
    uint256 public constant STAKE_REDUCTION_PER_TIER = 15 ether;
    uint256 public constant MIN_STAKE_FLOOR = 25 ether;
    uint256 private constant BPS = 10_000;

    // ============ Immutables ============

    IERC20 public immutable julToken;
    IReputationOracle public immutable reputationOracle;

    // ============ State ============

    uint256 public rewardPool;
    uint256 public totalKeepers;

    Task[] private _tasks;
    mapping(address => KeeperInfo) private _keepers;
    mapping(address => uint256) private _pendingRewards;
    mapping(address => bool) private _isKeeper;

    // ============ Constructor ============

    constructor(
        address _julToken,
        address _reputationOracle
    ) Ownable(msg.sender) {
        if (_julToken == address(0)) revert ZeroAddress();
        if (_reputationOracle == address(0)) revert ZeroAddress();
        julToken = IERC20(_julToken);
        reputationOracle = IReputationOracle(_reputationOracle);
    }

    // ============ Keeper Registration ============

    /**
     * @notice Register as a keeper by staking JUL.
     * @param stakeAmount Amount of JUL to stake (must meet effective minimum)
     */
    function registerKeeper(uint256 stakeAmount) external nonReentrant {
        if (_isKeeper[msg.sender]) revert AlreadyRegistered();
        uint256 minStake = _effectiveMinStake(msg.sender);
        if (stakeAmount < minStake) revert InsufficientStake();

        julToken.safeTransferFrom(msg.sender, address(this), stakeAmount);

        _keepers[msg.sender] = KeeperInfo({
            stakedAmount: uint128(stakeAmount),
            registeredAt: uint40(block.timestamp),
            unstakeRequestTime: 0,
            active: true,
            totalExecutions: 0,
            totalEarned: 0,
            totalSlashed: 0,
            failedExecutions: 0
        });
        _isKeeper[msg.sender] = true;
        totalKeepers++;

        emit KeeperRegistered(msg.sender, stakeAmount);
    }

    /**
     * @notice Request to unstake and deactivate.
     */
    function requestUnstake() external {
        KeeperInfo storage k = _keepers[msg.sender];
        if (!_isKeeper[msg.sender]) revert NotActiveKeeper();
        if (k.unstakeRequestTime > 0) revert UnstakePending();

        k.active = false;
        k.unstakeRequestTime = uint40(block.timestamp);

        emit UnstakeRequested(msg.sender, k.stakedAmount);
        emit KeeperDeactivated(msg.sender);
    }

    /**
     * @notice Complete unstake after cooldown.
     */
    function completeUnstake() external nonReentrant {
        KeeperInfo storage k = _keepers[msg.sender];
        if (k.unstakeRequestTime == 0) revert NoUnstakeRequest();
        if (block.timestamp < uint256(k.unstakeRequestTime) + STAKE_COOLDOWN) {
            revert UnstakeCooldownNotElapsed();
        }

        uint256 amount = k.stakedAmount;

        // Claim any pending rewards first
        uint256 rewards = _pendingRewards[msg.sender];
        _pendingRewards[msg.sender] = 0;

        k.stakedAmount = 0;
        k.unstakeRequestTime = 0;
        _isKeeper[msg.sender] = false;
        totalKeepers--;

        if (amount > 0) {
            julToken.safeTransfer(msg.sender, amount);
        }
        if (rewards > 0) {
            julToken.safeTransfer(msg.sender, rewards);
        }

        emit UnstakeCompleted(msg.sender, amount);
    }

    /**
     * @notice Add more stake to an existing keeper registration.
     */
    function topUpStake(uint256 amount) external nonReentrant {
        if (!_isKeeper[msg.sender]) revert NotActiveKeeper();
        if (amount == 0) revert ZeroAmount();

        KeeperInfo storage k = _keepers[msg.sender];
        julToken.safeTransferFrom(msg.sender, address(this), amount);
        k.stakedAmount += uint128(amount);

        // Reactivate if deactivated (and no pending unstake)
        if (!k.active && k.unstakeRequestTime == 0) {
            uint256 minStake = _effectiveMinStake(msg.sender);
            if (k.stakedAmount >= minStake) {
                k.active = true;
                emit KeeperReactivated(msg.sender, amount);
            }
        }
    }

    // ============ Task Execution ============

    /**
     * @notice Execute a registered keeper task.
     * @param taskId The task to execute
     * @param data Calldata to forward to the target contract
     */
    function executeTask(uint256 taskId, bytes calldata data) external nonReentrant {
        _requireActiveKeeper(msg.sender);
        bool success = _executeTaskInternal(taskId, data);
        emit TaskExecuted(taskId, msg.sender, success);
    }

    /**
     * @notice Execute multiple tasks in a single transaction.
     * @param taskIds Array of task IDs
     * @param datas Array of calldata for each task
     */
    function executeBatch(
        uint256[] calldata taskIds,
        bytes[] calldata datas
    ) external nonReentrant {
        if (taskIds.length != datas.length) revert ArrayLengthMismatch();
        _requireActiveKeeper(msg.sender);

        uint256 succeeded;
        for (uint256 i = 0; i < taskIds.length; i++) {
            if (_executeTaskInternal(taskIds[i], datas[i])) {
                succeeded++;
            }
        }

        emit BatchExecuted(msg.sender, taskIds.length, succeeded);
    }

    function _executeTaskInternal(uint256 taskId, bytes calldata data) internal returns (bool) {
        if (taskId >= _tasks.length) revert TaskNotFound();
        Task storage task = _tasks[taskId];
        if (!task.active) revert TaskNotActive();

        // Check cooldown (skip if never executed)
        if (task.cooldown > 0 && task.lastExecuted > 0 && block.timestamp < uint256(task.lastExecuted) + task.cooldown) {
            revert TaskCooldownNotElapsed();
        }

        // Validate selector if specified
        if (task.selector != bytes4(0) && data.length >= 4) {
            bytes4 callSelector;
            assembly {
                callSelector := calldataload(data.offset)
            }
            if (callSelector != task.selector) revert SelectorMismatch();
        }

        // Forward call to target
        (bool success,) = task.target.call(data);

        KeeperInfo storage k = _keepers[msg.sender];

        if (success) {
            task.lastExecuted = uint40(block.timestamp);
            k.totalExecutions++;

            // Distribute reward
            if (task.reward > 0 && rewardPool >= task.reward) {
                rewardPool -= task.reward;
                _pendingRewards[msg.sender] += task.reward;
                k.totalEarned += task.reward;
            }
        } else {
            k.failedExecutions++;
        }

        return success;
    }

    // ============ Reward Claims ============

    /**
     * @notice Claim accumulated keeper rewards.
     */
    function claimRewards() external nonReentrant {
        uint256 amount = _pendingRewards[msg.sender];
        if (amount == 0) revert NothingToClaim();

        _pendingRewards[msg.sender] = 0;
        julToken.safeTransfer(msg.sender, amount);

        emit RewardClaimed(msg.sender, amount);
    }

    // ============ Admin Functions ============

    /**
     * @notice Register a new keeper task.
     * @param target Contract address to call
     * @param selector Function selector (bytes4(0) for any)
     * @param reward JUL reward per successful execution
     * @param cooldown Minimum seconds between executions
     */
    function registerTask(
        address target,
        bytes4 selector,
        uint96 reward,
        uint32 cooldown
    ) external onlyOwner {
        if (target == address(0)) revert ZeroAddress();

        _tasks.push(Task({
            target: target,
            selector: selector,
            reward: reward,
            cooldown: cooldown,
            lastExecuted: 0,
            active: true
        }));

        emit TaskRegistered(_tasks.length - 1, target, selector, reward);
    }

    /**
     * @notice Update a task's parameters.
     */
    function updateTask(
        uint256 taskId,
        bool active,
        uint96 reward,
        uint32 cooldown
    ) external onlyOwner {
        if (taskId >= _tasks.length) revert TaskNotFound();

        Task storage task = _tasks[taskId];
        task.active = active;
        task.reward = reward;
        task.cooldown = cooldown;

        emit TaskUpdated(taskId, active, reward);
    }

    /**
     * @notice Slash a keeper's stake. Only for governance-decided violations.
     * @param keeper Address to slash
     * @param amount Amount of JUL to slash
     * @param reason Human-readable explanation
     */
    function slashKeeper(
        address keeper,
        uint256 amount,
        string calldata reason
    ) external onlyOwner {
        KeeperInfo storage k = _keepers[keeper];
        if (!_isKeeper[keeper]) revert NotActiveKeeper();
        if (amount > k.stakedAmount) revert SlashExceedsStake();

        k.stakedAmount -= uint128(amount);
        k.totalSlashed += amount;

        // Slashed JUL goes to reward pool (redistributed to honest keepers)
        rewardPool += amount;

        // Deactivate if below minimum
        uint256 minStake = _effectiveMinStake(keeper);
        if (k.stakedAmount < minStake) {
            k.active = false;
            emit KeeperDeactivated(keeper);
        }

        emit KeeperSlashed(keeper, amount, reason);
    }

    /**
     * @notice Deposit JUL into the keeper reward pool.
     */
    function depositRewards(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        rewardPool += amount;
        julToken.safeTransferFrom(msg.sender, address(this), amount);
        emit RewardPoolDeposited(msg.sender, amount);
    }

    // ============ View Functions ============

    function getKeeper(address keeper) external view returns (KeeperInfo memory) {
        return _keepers[keeper];
    }

    function getTask(uint256 taskId) external view returns (Task memory) {
        return _tasks[taskId];
    }

    function totalTasks() external view returns (uint256) {
        return _tasks.length;
    }

    function pendingRewards(address keeper) external view returns (uint256) {
        return _pendingRewards[keeper];
    }

    function effectiveMinStake(address keeper) external view returns (uint256) {
        return _effectiveMinStake(keeper);
    }

    function isActiveKeeper(address keeper) external view returns (bool) {
        return _isKeeper[keeper] && _keepers[keeper].active;
    }

    /**
     * @notice Keeper success rate in BPS (0-10000).
     */
    function keeperPerformance(address keeper) external view returns (uint256 successRate) {
        KeeperInfo storage k = _keepers[keeper];
        uint256 total = k.totalExecutions + k.failedExecutions;
        if (total == 0) return 0;
        return (k.totalExecutions * BPS) / total;
    }

    // ============ Internal ============

    function _requireActiveKeeper(address keeper) internal view {
        if (!_isKeeper[keeper] || !_keepers[keeper].active) revert NotActiveKeeper();
    }

    /**
     * @notice Reputation-gated minimum stake. Higher trust = lower barrier.
     */
    function _effectiveMinStake(address keeper) internal view returns (uint256) {
        uint8 tier = reputationOracle.getTrustTier(keeper);
        uint256 reduction = uint256(tier) * STAKE_REDUCTION_PER_TIER;
        uint256 stake = MIN_STAKE > reduction ? MIN_STAKE - reduction : 0;
        return stake < MIN_STAKE_FLOOR ? MIN_STAKE_FLOOR : stake;
    }
}
