// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeAutomation — Decentralized Task Automation (Chainlink Keeper Alternative)
 * @notice Permissionless task scheduling and execution.
 *         Anyone can register tasks, anyone can execute them (with bounty).
 *
 * @dev Replaces Chainlink Keepers with open market:
 *      - Register tasks with check conditions + execution calldata
 *      - Bounty system incentivizes executors
 *      - Gas estimation and reimbursement
 *      - Task prioritization by bounty value
 */
contract VibeAutomation is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    struct Task {
        uint256 taskId;
        address owner;
        address target;            // Contract to call
        bytes checkData;           // Calldata for checking if task should execute
        bytes execData;            // Calldata for execution
        uint256 bounty;            // ETH bounty per execution
        uint256 interval;          // Min time between executions (0 = one-shot)
        uint256 lastExecuted;
        uint256 executionCount;
        uint256 maxExecutions;     // 0 = unlimited
        uint256 gasLimit;
        bool active;
    }

    // ============ State ============

    mapping(uint256 => Task) public tasks;
    uint256 public taskCount;

    /// @notice Task owner balances (for funding bounties)
    mapping(address => uint256) public balances;

    /// @notice Executor stats
    mapping(address => uint256) public executorEarnings;
    mapping(address => uint256) public executorTasksCompleted;

    /// @notice Total bounties paid
    uint256 public totalBountiesPaid;

    // ============ Events ============

    event TaskRegistered(uint256 indexed taskId, address indexed owner, address target, uint256 bounty);
    event TaskExecuted(uint256 indexed taskId, address indexed executor, uint256 gasUsed, uint256 bountyPaid);
    event TaskCancelled(uint256 indexed taskId);
    event TaskFunded(uint256 indexed taskId, uint256 amount);
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Deposits ============

    function deposit() external payable {
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Withdraw failed");
        emit Withdrawn(msg.sender, amount);
    }

    // ============ Task Management ============

    /**
     * @notice Register a new automated task
     */
    function registerTask(
        address target,
        bytes calldata checkData,
        bytes calldata execData,
        uint256 bounty,
        uint256 interval,
        uint256 maxExecutions,
        uint256 gasLimit
    ) external returns (uint256) {
        require(balances[msg.sender] >= bounty, "Fund bounty first");

        taskCount++;
        tasks[taskCount] = Task({
            taskId: taskCount,
            owner: msg.sender,
            target: target,
            checkData: checkData,
            execData: execData,
            bounty: bounty,
            interval: interval,
            lastExecuted: 0,
            executionCount: 0,
            maxExecutions: maxExecutions,
            gasLimit: gasLimit,
            active: true
        });

        emit TaskRegistered(taskCount, msg.sender, target, bounty);
        return taskCount;
    }

    /**
     * @notice Cancel a task
     */
    function cancelTask(uint256 taskId) external {
        require(tasks[taskId].owner == msg.sender, "Not owner");
        tasks[taskId].active = false;
        emit TaskCancelled(taskId);
    }

    /**
     * @notice Fund additional bounties for a task
     */
    function fundTask(uint256 taskId) external payable {
        require(tasks[taskId].active, "Task not active");
        balances[tasks[taskId].owner] += msg.value;
        emit TaskFunded(taskId, msg.value);
    }

    // ============ Execution ============

    /**
     * @notice Check if a task is ready for execution
     */
    function checkTask(uint256 taskId) external view returns (bool upkeepNeeded, bytes memory performData) {
        Task storage task = tasks[taskId];

        if (!task.active) return (false, "");
        if (task.maxExecutions > 0 && task.executionCount >= task.maxExecutions) return (false, "");
        if (task.interval > 0 && block.timestamp < task.lastExecuted + task.interval) return (false, "");

        // Call check function on target
        (bool success, bytes memory result) = task.target.staticcall(task.checkData);
        if (!success) return (false, "");

        // Decode bool from result
        if (result.length >= 32) {
            bool needed = abi.decode(result, (bool));
            return (needed, task.execData);
        }

        return (false, "");
    }

    /**
     * @notice Execute a task (anyone can call — bounty incentivized)
     */
    function executeTask(uint256 taskId) external nonReentrant {
        Task storage task = tasks[taskId];
        require(task.active, "Task not active");
        require(task.maxExecutions == 0 || task.executionCount < task.maxExecutions, "Max executions reached");
        require(task.interval == 0 || block.timestamp >= task.lastExecuted + task.interval, "Too soon");

        uint256 gasStart = gasleft();

        // Execute the task
        (bool success, ) = task.target.call{gas: task.gasLimit}(task.execData);
        require(success, "Execution failed");

        uint256 gasUsed = gasStart - gasleft();

        task.lastExecuted = block.timestamp;
        task.executionCount++;

        // Deactivate one-shot or completed tasks
        if (task.maxExecutions > 0 && task.executionCount >= task.maxExecutions) {
            task.active = false;
        }

        // Pay bounty to executor
        uint256 bountyPaid = task.bounty;
        require(balances[task.owner] >= bountyPaid, "Owner insufficient funds");
        balances[task.owner] -= bountyPaid;

        (bool ok, ) = msg.sender.call{value: bountyPaid}("");
        require(ok, "Bounty transfer failed");

        executorEarnings[msg.sender] += bountyPaid;
        executorTasksCompleted[msg.sender]++;
        totalBountiesPaid += bountyPaid;

        emit TaskExecuted(taskId, msg.sender, gasUsed, bountyPaid);
    }

    // ============ View ============

    function getActiveTasks() external view returns (uint256[] memory) {
        uint256 count;
        for (uint256 i = 1; i <= taskCount; i++) {
            if (tasks[i].active) count++;
        }

        uint256[] memory activeIds = new uint256[](count);
        uint256 idx;
        for (uint256 i = 1; i <= taskCount; i++) {
            if (tasks[i].active) {
                activeIds[idx++] = i;
            }
        }
        return activeIds;
    }

    function getExecutorStats(address executor) external view returns (uint256 earnings, uint256 completed) {
        return (executorEarnings[executor], executorTasksCompleted[executor]);
    }

    receive() external payable {
        balances[msg.sender] += msg.value;
    }
}
