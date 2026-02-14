// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeKeeperNetwork
 * @notice Interface for the decentralized keeper network — anyone can maintain
 *         protocol health and earn JUL rewards.
 *
 *         Part of VSOS (VibeSwap Operating System) Protocol Framework.
 *
 *         Removes single-operator dependency by allowing anyone to:
 *           - Settle batch auctions
 *           - Liquidate undercollateralized positions
 *           - Execute timelocked governance operations
 *           - Resolve insurance markets
 *
 *         Keeper economics:
 *           - Stake JUL to register (skin-in-the-game)
 *           - Earn JUL per successful task execution
 *           - Performance tracking builds keeper reputation
 *           - Reputation tiers reduce minimum stake requirement
 *           - Slashing for governance-decided violations
 *
 *         Architecture:
 *           - Network contract is authorized as settler/resolver on target contracts
 *           - Keepers call through the network, not directly
 *           - Network validates execution success and distributes rewards
 *           - Unified reward pool instead of per-contract pools
 */
interface IVibeKeeperNetwork {
    // ============ Structs ============

    /// @notice Registered keeper-callable task
    struct Task {
        address target;          // contract to call
        bytes4 selector;         // function selector (0x0 = any)
        uint96 reward;           // JUL per successful execution
        uint32 cooldown;         // min seconds between executions of this task
        uint40 lastExecuted;     // last successful execution timestamp
        bool active;             // can be disabled by owner
    }

    /// @notice Registered keeper
    struct KeeperInfo {
        uint128 stakedAmount;    // JUL staked
        uint40 registeredAt;     // registration timestamp
        uint40 unstakeRequestTime; // when unstake was requested (0 = none)
        bool active;             // enabled
        uint256 totalExecutions; // lifetime successful executions
        uint256 totalEarned;     // lifetime JUL earned
        uint256 totalSlashed;    // lifetime JUL slashed
        uint256 failedExecutions; // lifetime failed executions
    }

    // ============ Events ============

    event KeeperRegistered(address indexed keeper, uint256 stakeAmount);
    event KeeperDeactivated(address indexed keeper);
    event KeeperReactivated(address indexed keeper, uint256 additionalStake);
    event UnstakeRequested(address indexed keeper, uint256 amount);
    event UnstakeCompleted(address indexed keeper, uint256 amount);
    event KeeperSlashed(address indexed keeper, uint256 amount, string reason);
    event TaskRegistered(uint256 indexed taskId, address indexed target, bytes4 selector, uint96 reward);
    event TaskUpdated(uint256 indexed taskId, bool active, uint96 reward);
    event TaskExecuted(uint256 indexed taskId, address indexed keeper, bool success);
    event BatchExecuted(address indexed keeper, uint256 tasksAttempted, uint256 tasksSucceeded);
    event RewardPoolDeposited(address indexed depositor, uint256 amount);
    event RewardClaimed(address indexed keeper, uint256 amount);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error NotActiveKeeper();
    error AlreadyRegistered();
    error InsufficientStake();
    error TaskNotActive();
    error TaskCooldownNotElapsed();
    error SelectorMismatch();
    error NoUnstakeRequest();
    error UnstakeCooldownNotElapsed();
    error UnstakePending();
    error TaskNotFound();
    error ArrayLengthMismatch();
    error InsufficientRewardPool();
    error NothingToClaim();
    error SlashExceedsStake();

    // ============ Keeper Functions ============

    function registerKeeper(uint256 stakeAmount) external;
    function requestUnstake() external;
    function completeUnstake() external;
    function topUpStake(uint256 amount) external;
    function executeTask(uint256 taskId, bytes calldata data) external;
    function executeBatch(uint256[] calldata taskIds, bytes[] calldata datas) external;
    function claimRewards() external;

    // ============ Admin Functions ============

    function registerTask(address target, bytes4 selector, uint96 reward, uint32 cooldown) external;
    function updateTask(uint256 taskId, bool active, uint96 reward, uint32 cooldown) external;
    function slashKeeper(address keeper, uint256 amount, string calldata reason) external;
    function depositRewards(uint256 amount) external;

    // ============ View Functions ============

    function getKeeper(address keeper) external view returns (KeeperInfo memory);
    function getTask(uint256 taskId) external view returns (Task memory);
    function totalTasks() external view returns (uint256);
    function totalKeepers() external view returns (uint256);
    function rewardPool() external view returns (uint256);
    function pendingRewards(address keeper) external view returns (uint256);
    function effectiveMinStake(address keeper) external view returns (uint256);
    function isActiveKeeper(address keeper) external view returns (bool);
    function keeperPerformance(address keeper) external view returns (uint256 successRate);
}
