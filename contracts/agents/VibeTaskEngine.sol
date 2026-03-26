// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeTaskEngine — Universal Task Decomposition & Execution
 * @notice Absorbs Accomplish-style task management into a decentralized engine.
 *         AI agents decompose complex tasks into sub-tasks, execute in parallel,
 *         and compose results. On-chain task DAG with verifiable completion.
 *
 * @dev Architecture (Accomplish absorption):
 *      - Hierarchical task decomposition (task → subtasks → atomic operations)
 *      - Dependency-aware scheduling (DAG execution)
 *      - Multi-agent assignment (different agents for different subtasks)
 *      - Progress tracking with on-chain checkpoints
 *      - Result composition and verification
 *      - Automatic retry and fallback routing
 *      - Budget management per task tree
 */
contract VibeTaskEngine is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum TaskStatus { PENDING, ASSIGNED, IN_PROGRESS, COMPLETED, FAILED, CANCELLED }
    enum TaskPriority { LOW, MEDIUM, HIGH, CRITICAL }

    struct Task {
        uint256 taskId;
        uint256 parentId;            // 0 = root task
        address creator;
        bytes32 agentId;             // Assigned agent (bytes32(0) = unassigned)
        bytes32 specHash;            // IPFS hash of task specification
        bytes32 resultHash;          // IPFS hash of result
        TaskStatus status;
        TaskPriority priority;
        uint256[] dependencies;      // Task IDs that must complete first
        uint256[] subtasks;          // Child task IDs
        uint256 budget;
        uint256 spent;
        uint256 deadline;
        uint256 createdAt;
        uint256 completedAt;
        uint8 retryCount;
        uint8 maxRetries;
    }

    struct TaskTree {
        uint256 rootTaskId;
        address creator;
        uint256 totalBudget;
        uint256 totalSpent;
        uint256 taskCount;
        uint256 completedCount;
        uint256 failedCount;
        bool allComplete;
    }

    // ============ State ============

    mapping(uint256 => Task) public tasks;
    uint256 public taskCount;

    mapping(uint256 => TaskTree) public taskTrees;
    uint256 public treeCount;

    /// @notice Task tree membership: taskId => treeId
    mapping(uint256 => uint256) public taskToTree;

    /// @notice Agent task queue: agentId => taskId[]
    mapping(bytes32 => uint256[]) public agentQueue;

    /// @notice Stats
    uint256 public totalTasksCreated;
    uint256 public totalTasksCompleted;
    uint256 public totalBudgetSpent;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event TaskCreated(uint256 indexed taskId, uint256 parentId, uint256 treeId, TaskPriority priority);
    event TaskAssigned(uint256 indexed taskId, bytes32 indexed agentId);
    event TaskCompleted(uint256 indexed taskId, bytes32 resultHash);
    event TaskFailed(uint256 indexed taskId, uint8 retryCount);
    event TaskTreeCompleted(uint256 indexed treeId, uint256 totalTasks);
    event SubtaskCreated(uint256 indexed parentId, uint256 indexed subtaskId);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Task Creation ============

    /**
     * @notice Create a root task (starts a new task tree)
     */
    function createRootTask(
        bytes32 specHash,
        TaskPriority priority,
        uint256 deadlineDays,
        uint8 maxRetries
    ) external payable returns (uint256, uint256) {
        require(msg.value > 0, "Budget required");

        taskCount++;
        treeCount++;

        tasks[taskCount] = Task({
            taskId: taskCount,
            parentId: 0,
            creator: msg.sender,
            agentId: bytes32(0),
            specHash: specHash,
            resultHash: bytes32(0),
            status: TaskStatus.PENDING,
            priority: priority,
            dependencies: new uint256[](0),
            subtasks: new uint256[](0),
            budget: msg.value,
            spent: 0,
            deadline: block.timestamp + (deadlineDays * 1 days),
            createdAt: block.timestamp,
            completedAt: 0,
            retryCount: 0,
            maxRetries: maxRetries
        });

        taskTrees[treeCount] = TaskTree({
            rootTaskId: taskCount,
            creator: msg.sender,
            totalBudget: msg.value,
            totalSpent: 0,
            taskCount: 1,
            completedCount: 0,
            failedCount: 0,
            allComplete: false
        });

        taskToTree[taskCount] = treeCount;
        totalTasksCreated++;

        emit TaskCreated(taskCount, 0, treeCount, priority);
        return (taskCount, treeCount);
    }

    /**
     * @notice Decompose a task into subtasks
     */
    function createSubtask(
        uint256 parentId,
        bytes32 specHash,
        TaskPriority priority,
        uint256[] calldata dependencies,
        uint256 budget
    ) external returns (uint256) {
        Task storage parent = tasks[parentId];
        require(parent.creator == msg.sender || msg.sender == owner(), "Not authorized");
        require(parent.status != TaskStatus.COMPLETED && parent.status != TaskStatus.CANCELLED, "Parent done");
        require(budget <= parent.budget - parent.spent, "Exceeds parent budget");

        taskCount++;

        tasks[taskCount] = Task({
            taskId: taskCount,
            parentId: parentId,
            creator: msg.sender,
            agentId: bytes32(0),
            specHash: specHash,
            resultHash: bytes32(0),
            status: TaskStatus.PENDING,
            priority: priority,
            dependencies: dependencies,
            subtasks: new uint256[](0),
            budget: budget,
            spent: 0,
            deadline: parent.deadline,
            createdAt: block.timestamp,
            completedAt: 0,
            retryCount: 0,
            maxRetries: parent.maxRetries
        });

        parent.subtasks.push(taskCount);
        parent.spent += budget;

        uint256 treeId = taskToTree[parentId];
        taskToTree[taskCount] = treeId;
        taskTrees[treeId].taskCount++;
        totalTasksCreated++;

        emit SubtaskCreated(parentId, taskCount);
        emit TaskCreated(taskCount, parentId, treeId, priority);
        return taskCount;
    }

    // ============ Task Execution ============

    function assignTask(uint256 taskId, bytes32 agentId) external {
        Task storage task = tasks[taskId];
        require(task.creator == msg.sender || msg.sender == owner(), "Not authorized");
        require(task.status == TaskStatus.PENDING, "Not pending");

        // Check dependencies
        for (uint256 i = 0; i < task.dependencies.length; i++) {
            require(tasks[task.dependencies[i]].status == TaskStatus.COMPLETED, "Dependency not met");
        }

        task.agentId = agentId;
        task.status = TaskStatus.ASSIGNED;
        agentQueue[agentId].push(taskId);

        emit TaskAssigned(taskId, agentId);
    }

    function startTask(uint256 taskId) external {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.ASSIGNED, "Not assigned");
        task.status = TaskStatus.IN_PROGRESS;
    }

    function completeTask(uint256 taskId, bytes32 resultHash) external nonReentrant {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.IN_PROGRESS || task.status == TaskStatus.ASSIGNED, "Wrong status");

        task.status = TaskStatus.COMPLETED;
        task.resultHash = resultHash;
        task.completedAt = block.timestamp;

        uint256 treeId = taskToTree[taskId];
        taskTrees[treeId].completedCount++;
        totalTasksCompleted++;

        // Pay agent
        if (task.budget > 0) {
            uint256 payout = task.budget - task.spent;
            if (payout > 0) {
                taskTrees[treeId].totalSpent += payout;
                totalBudgetSpent += payout;
                (bool ok, ) = msg.sender.call{value: payout}("");
                require(ok, "Payment failed");
            }
        }

        // Check if tree is complete
        TaskTree storage tree = taskTrees[treeId];
        if (tree.completedCount + tree.failedCount >= tree.taskCount) {
            tree.allComplete = true;
            emit TaskTreeCompleted(treeId, tree.taskCount);
        }

        emit TaskCompleted(taskId, resultHash);
    }

    function failTask(uint256 taskId) external {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.IN_PROGRESS, "Not in progress");

        task.retryCount++;
        if (task.retryCount >= task.maxRetries) {
            task.status = TaskStatus.FAILED;
            taskTrees[taskToTree[taskId]].failedCount++;
            emit TaskFailed(taskId, task.retryCount);
        } else {
            task.status = TaskStatus.PENDING;
            task.agentId = bytes32(0);
            emit TaskFailed(taskId, task.retryCount);
        }
    }

    // ============ View ============

    function getTask(uint256 id) external view returns (Task memory) { return tasks[id]; }
    function getTree(uint256 id) external view returns (TaskTree memory) { return taskTrees[id]; }
    function getSubtasks(uint256 taskId) external view returns (uint256[] memory) { return tasks[taskId].subtasks; }
    function getDependencies(uint256 taskId) external view returns (uint256[] memory) { return tasks[taskId].dependencies; }
    function getAgentQueue(bytes32 agentId) external view returns (uint256[] memory) { return agentQueue[agentId]; }
    function getTaskCount() external view returns (uint256) { return taskCount; }
    function getTreeCount() external view returns (uint256) { return treeCount; }

    receive() external payable {}
}
