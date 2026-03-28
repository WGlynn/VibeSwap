// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/agents/VibeTaskEngine.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Test Contract ============

contract VibeTaskEngineTest is Test {
    // ============ Re-declare Events ============

    event TaskCreated(uint256 indexed taskId, uint256 parentId, uint256 treeId, VibeTaskEngine.TaskPriority priority);
    event TaskAssigned(uint256 indexed taskId, bytes32 indexed agentId);
    event TaskCompleted(uint256 indexed taskId, bytes32 resultHash);
    event TaskFailed(uint256 indexed taskId, uint8 retryCount);
    event TaskTreeCompleted(uint256 indexed treeId, uint256 totalTasks);
    event SubtaskCreated(uint256 indexed parentId, uint256 indexed subtaskId);

    // ============ Helpers ============

    /// @dev Reconstruct Task struct from split getters (getTask was removed to avoid stack-too-deep)
    function _getTask(uint256 id) internal view returns (VibeTaskEngine.Task memory t) {
        (t.taskId, t.parentId, t.creator, t.agentId, t.specHash, t.resultHash, t.status, t.priority) = engine.getTaskCore(id);
        (t.budget, t.spent, t.deadline, t.createdAt, t.completedAt, t.retryCount, t.maxRetries) = engine.getTaskMeta(id);
        t.dependencies = engine.getDependencies(id);
        t.subtasks = engine.getSubtasks(id);
    }

    // ============ State ============

    VibeTaskEngine public engine;
    address public owner;
    address public creator;
    address public agent1Op;
    bytes32 public agentId1;

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        creator = makeAddr("creator");
        agent1Op = makeAddr("agent1Op");
        agentId1 = keccak256("agent1");

        vm.deal(creator, 100 ether);
        vm.deal(agent1Op, 100 ether);

        VibeTaskEngine impl = new VibeTaskEngine();
        bytes memory initData = abi.encodeWithSelector(VibeTaskEngine.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        engine = VibeTaskEngine(payable(address(proxy)));
    }

    // ============ Helpers ============

    function _createRootTask(uint256 budget, uint8 maxRetries) internal returns (uint256 taskId, uint256 treeId) {
        vm.prank(creator);
        (taskId, treeId) = engine.createRootTask{value: budget}(
            keccak256("spec"),
            VibeTaskEngine.TaskPriority.MEDIUM,
            7, // 7 days
            maxRetries
        );
    }

    // ============ Root Task Creation ============

    function test_createRootTask_success() public {
        vm.prank(creator);
        (uint256 taskId, uint256 treeId) = engine.createRootTask{value: 10 ether}(
            keccak256("spec"),
            VibeTaskEngine.TaskPriority.HIGH,
            7,
            3
        );

        assertEq(taskId, 1);
        assertEq(treeId, 1);

        VibeTaskEngine.Task memory task = _getTask(taskId);
        assertEq(task.parentId, 0);
        assertEq(task.creator, creator);
        assertEq(task.budget, 10 ether);
        assertEq(uint8(task.status), uint8(VibeTaskEngine.TaskStatus.PENDING));
        assertEq(uint8(task.priority), uint8(VibeTaskEngine.TaskPriority.HIGH));
        assertEq(task.maxRetries, 3);
        assertEq(task.deadline, block.timestamp + 7 days);

        VibeTaskEngine.TaskTree memory tree = engine.getTree(treeId);
        assertEq(tree.rootTaskId, taskId);
        assertEq(tree.creator, creator);
        assertEq(tree.totalBudget, 10 ether);
        assertEq(tree.taskCount, 1);
        assertFalse(tree.allComplete);
    }

    function test_createRootTask_emitsEvent() public {
        vm.prank(creator);
        vm.expectEmit(true, false, false, true);
        emit TaskCreated(1, 0, 1, VibeTaskEngine.TaskPriority.CRITICAL);
        engine.createRootTask{value: 1 ether}(
            keccak256("spec"),
            VibeTaskEngine.TaskPriority.CRITICAL,
            7,
            3
        );
    }

    function test_createRootTask_revert_zeroBudget() public {
        vm.prank(creator);
        vm.expectRevert("Budget required");
        engine.createRootTask(keccak256("spec"), VibeTaskEngine.TaskPriority.LOW, 7, 3);
    }

    function test_createRootTask_incrementsStats() public {
        _createRootTask(1 ether, 3);
        assertEq(engine.totalTasksCreated(), 1);
        assertEq(engine.taskCount(), 1);
        assertEq(engine.treeCount(), 1);

        _createRootTask(2 ether, 2);
        assertEq(engine.totalTasksCreated(), 2);
        assertEq(engine.taskCount(), 2);
        assertEq(engine.treeCount(), 2);
    }

    function test_createRootTask_allPriorities() public {
        for (uint8 i = 0; i <= uint8(VibeTaskEngine.TaskPriority.CRITICAL); i++) {
            vm.prank(creator);
            (uint256 taskId, ) = engine.createRootTask{value: 1 ether}(
                keccak256(abi.encodePacked("spec", i)),
                VibeTaskEngine.TaskPriority(i),
                7,
                3
            );
            assertEq(uint8(_getTask(taskId).priority), i);
        }
    }

    // ============ Subtask Creation ============

    function test_createSubtask_success() public {
        (uint256 rootId, uint256 treeId) = _createRootTask(10 ether, 3);

        uint256[] memory deps = new uint256[](0);
        vm.prank(creator);
        uint256 subId = engine.createSubtask(rootId, keccak256("sub-spec"), VibeTaskEngine.TaskPriority.LOW, deps, 3 ether);

        VibeTaskEngine.Task memory sub = _getTask(subId);
        assertEq(sub.parentId, rootId);
        assertEq(sub.budget, 3 ether);
        assertEq(uint8(sub.status), uint8(VibeTaskEngine.TaskStatus.PENDING));

        // Parent's subtask list updated
        uint256[] memory subtasks = engine.getSubtasks(rootId);
        assertEq(subtasks.length, 1);
        assertEq(subtasks[0], subId);

        // Tree task count updated
        assertEq(engine.getTree(treeId).taskCount, 2);
    }

    function test_createSubtask_withDependencies() public {
        (uint256 rootId, ) = _createRootTask(10 ether, 3);

        uint256[] memory noDeps = new uint256[](0);
        vm.prank(creator);
        uint256 sub1 = engine.createSubtask(rootId, keccak256("s1"), VibeTaskEngine.TaskPriority.MEDIUM, noDeps, 2 ether);

        uint256[] memory deps = new uint256[](1);
        deps[0] = sub1;
        vm.prank(creator);
        uint256 sub2 = engine.createSubtask(rootId, keccak256("s2"), VibeTaskEngine.TaskPriority.MEDIUM, deps, 2 ether);

        uint256[] memory gotDeps = engine.getDependencies(sub2);
        assertEq(gotDeps.length, 1);
        assertEq(gotDeps[0], sub1);
    }

    function test_createSubtask_revert_notAuthorized() public {
        (uint256 rootId, ) = _createRootTask(10 ether, 3);

        uint256[] memory deps = new uint256[](0);
        vm.prank(agent1Op);
        vm.expectRevert("Not authorized");
        engine.createSubtask(rootId, keccak256("sub"), VibeTaskEngine.TaskPriority.LOW, deps, 1 ether);
    }

    function test_createSubtask_revert_exceedsBudget() public {
        (uint256 rootId, ) = _createRootTask(10 ether, 3);

        uint256[] memory deps = new uint256[](0);
        vm.prank(creator);
        vm.expectRevert("Exceeds parent budget");
        engine.createSubtask(rootId, keccak256("sub"), VibeTaskEngine.TaskPriority.LOW, deps, 11 ether);
    }

    function test_createSubtask_multipleExhaustBudget() public {
        (uint256 rootId, ) = _createRootTask(10 ether, 3);

        uint256[] memory deps = new uint256[](0);
        vm.startPrank(creator);
        engine.createSubtask(rootId, keccak256("s1"), VibeTaskEngine.TaskPriority.LOW, deps, 5 ether);
        engine.createSubtask(rootId, keccak256("s2"), VibeTaskEngine.TaskPriority.LOW, deps, 5 ether);

        // Budget exhausted
        vm.expectRevert("Exceeds parent budget");
        engine.createSubtask(rootId, keccak256("s3"), VibeTaskEngine.TaskPriority.LOW, deps, 1 ether);
        vm.stopPrank();
    }

    function test_createSubtask_emitsEvents() public {
        (uint256 rootId, uint256 treeId) = _createRootTask(10 ether, 3);

        uint256[] memory deps = new uint256[](0);
        vm.prank(creator);
        vm.expectEmit(true, true, false, false);
        emit SubtaskCreated(rootId, 2); // subtask will be taskCount=2
        engine.createSubtask(rootId, keccak256("sub"), VibeTaskEngine.TaskPriority.MEDIUM, deps, 1 ether);
    }

    // ============ Task Assignment ============

    function test_assignTask_success() public {
        (uint256 rootId, ) = _createRootTask(10 ether, 3);

        vm.prank(creator);
        engine.assignTask(rootId, agentId1);

        VibeTaskEngine.Task memory task = _getTask(rootId);
        assertEq(task.agentId, agentId1);
        assertEq(uint8(task.status), uint8(VibeTaskEngine.TaskStatus.ASSIGNED));

        // Check agent queue
        uint256[] memory queue = engine.getAgentQueue(agentId1);
        assertEq(queue.length, 1);
        assertEq(queue[0], rootId);
    }

    function test_assignTask_revert_notPending() public {
        (uint256 rootId, ) = _createRootTask(10 ether, 3);

        vm.prank(creator);
        engine.assignTask(rootId, agentId1);

        // Already assigned
        vm.prank(creator);
        vm.expectRevert("Not pending");
        engine.assignTask(rootId, agentId1);
    }

    function test_assignTask_revert_notAuthorized() public {
        (uint256 rootId, ) = _createRootTask(10 ether, 3);

        vm.prank(agent1Op);
        vm.expectRevert("Not authorized");
        engine.assignTask(rootId, agentId1);
    }

    function test_assignTask_revert_unmetDependency() public {
        (uint256 rootId, ) = _createRootTask(10 ether, 3);

        uint256[] memory noDeps = new uint256[](0);
        vm.prank(creator);
        uint256 sub1 = engine.createSubtask(rootId, keccak256("s1"), VibeTaskEngine.TaskPriority.MEDIUM, noDeps, 2 ether);

        uint256[] memory deps = new uint256[](1);
        deps[0] = sub1;
        vm.prank(creator);
        uint256 sub2 = engine.createSubtask(rootId, keccak256("s2"), VibeTaskEngine.TaskPriority.MEDIUM, deps, 2 ether);

        // sub1 not completed yet
        vm.prank(creator);
        vm.expectRevert("Dependency not met");
        engine.assignTask(sub2, agentId1);
    }

    function test_assignTask_emitsEvent() public {
        (uint256 rootId, ) = _createRootTask(10 ether, 3);

        vm.prank(creator);
        vm.expectEmit(true, true, false, false);
        emit TaskAssigned(rootId, agentId1);
        engine.assignTask(rootId, agentId1);
    }

    // ============ Task Start ============

    function test_startTask_success() public {
        (uint256 rootId, ) = _createRootTask(10 ether, 3);

        vm.prank(creator);
        engine.assignTask(rootId, agentId1);

        engine.startTask(rootId);
        assertEq(uint8(_getTask(rootId).status), uint8(VibeTaskEngine.TaskStatus.IN_PROGRESS));
    }

    function test_startTask_revert_notAssigned() public {
        (uint256 rootId, ) = _createRootTask(10 ether, 3);

        vm.expectRevert("Not assigned");
        engine.startTask(rootId);
    }

    // ============ Task Completion ============

    function test_completeTask_success() public {
        (uint256 rootId, uint256 treeId) = _createRootTask(10 ether, 3);

        vm.prank(creator);
        engine.assignTask(rootId, agentId1);
        engine.startTask(rootId);

        uint256 balBefore = address(this).balance;
        bytes32 resultHash = keccak256("result");

        engine.completeTask(rootId, resultHash);

        VibeTaskEngine.Task memory task = _getTask(rootId);
        assertEq(uint8(task.status), uint8(VibeTaskEngine.TaskStatus.COMPLETED));
        assertEq(task.resultHash, resultHash);
        assertGt(task.completedAt, 0);

        // Tree marked complete (only 1 task)
        assertTrue(engine.getTree(treeId).allComplete);
    }

    function test_completeTask_fromAssignedState() public {
        // completeTask allows ASSIGNED or IN_PROGRESS
        (uint256 rootId, ) = _createRootTask(10 ether, 3);

        vm.prank(creator);
        engine.assignTask(rootId, agentId1);

        // Complete directly from ASSIGNED (no startTask)
        engine.completeTask(rootId, keccak256("result"));
        assertEq(uint8(_getTask(rootId).status), uint8(VibeTaskEngine.TaskStatus.COMPLETED));
    }

    function test_completeTask_revert_wrongStatus() public {
        (uint256 rootId, ) = _createRootTask(10 ether, 3);

        // Still PENDING
        vm.expectRevert("Wrong status");
        engine.completeTask(rootId, keccak256("result"));
    }

    function test_completeTask_paysAgent() public {
        (uint256 rootId, ) = _createRootTask(10 ether, 3);

        vm.prank(creator);
        engine.assignTask(rootId, agentId1);
        engine.startTask(rootId);

        uint256 balBefore = address(this).balance;
        engine.completeTask(rootId, keccak256("result"));

        // Payment = budget - spent = 10 ether - 0 = 10 ether
        assertEq(address(this).balance - balBefore, 10 ether);
    }

    function test_completeTask_treeCompletion() public {
        (uint256 rootId, uint256 treeId) = _createRootTask(10 ether, 3);

        uint256[] memory noDeps = new uint256[](0);
        vm.prank(creator);
        uint256 sub1 = engine.createSubtask(rootId, keccak256("s1"), VibeTaskEngine.TaskPriority.LOW, noDeps, 3 ether);

        // Complete subtask
        vm.prank(creator);
        engine.assignTask(sub1, agentId1);
        engine.startTask(sub1);
        engine.completeTask(sub1, keccak256("r1"));

        // Tree not complete yet (root still pending)
        assertFalse(engine.getTree(treeId).allComplete);

        // Complete root
        vm.prank(creator);
        engine.assignTask(rootId, agentId1);
        engine.startTask(rootId);
        engine.completeTask(rootId, keccak256("r-root"));

        // Now tree is complete
        assertTrue(engine.getTree(treeId).allComplete);
    }

    function test_completeTask_emitsTreeCompletedEvent() public {
        (uint256 rootId, uint256 treeId) = _createRootTask(10 ether, 3);

        vm.prank(creator);
        engine.assignTask(rootId, agentId1);
        engine.startTask(rootId);

        vm.expectEmit(true, false, false, true);
        emit TaskTreeCompleted(treeId, 1);
        engine.completeTask(rootId, keccak256("result"));
    }

    // ============ Task Failure & Retry ============

    function test_failTask_retries() public {
        (uint256 rootId, ) = _createRootTask(10 ether, 3);

        vm.prank(creator);
        engine.assignTask(rootId, agentId1);
        engine.startTask(rootId);

        // First failure — should reset to PENDING (retry)
        engine.failTask(rootId);
        assertEq(uint8(_getTask(rootId).status), uint8(VibeTaskEngine.TaskStatus.PENDING));
        assertEq(_getTask(rootId).retryCount, 1);
        assertEq(_getTask(rootId).agentId, bytes32(0)); // unassigned
    }

    function test_failTask_exhaustsRetries() public {
        (uint256 rootId, uint256 treeId) = _createRootTask(10 ether, 2); // maxRetries=2

        for (uint256 i = 0; i < 2; i++) {
            vm.prank(creator);
            engine.assignTask(rootId, agentId1);
            engine.startTask(rootId);
            engine.failTask(rootId);
        }

        // After 2 retries (maxRetries=2), task should be FAILED
        assertEq(uint8(_getTask(rootId).status), uint8(VibeTaskEngine.TaskStatus.FAILED));
    }

    function test_failTask_revert_notInProgress() public {
        (uint256 rootId, ) = _createRootTask(10 ether, 3);

        vm.expectRevert("Not in progress");
        engine.failTask(rootId);
    }

    function test_failTask_emitsEvent() public {
        (uint256 rootId, ) = _createRootTask(10 ether, 3);

        vm.prank(creator);
        engine.assignTask(rootId, agentId1);
        engine.startTask(rootId);

        vm.expectEmit(true, false, false, true);
        emit TaskFailed(rootId, 1);
        engine.failTask(rootId);
    }

    // ============ Budget Tracking ============

    function test_budgetTracking_acrossTree() public {
        (uint256 rootId, uint256 treeId) = _createRootTask(10 ether, 3);

        uint256[] memory noDeps = new uint256[](0);
        vm.startPrank(creator);
        engine.createSubtask(rootId, keccak256("s1"), VibeTaskEngine.TaskPriority.LOW, noDeps, 3 ether);
        engine.createSubtask(rootId, keccak256("s2"), VibeTaskEngine.TaskPriority.LOW, noDeps, 4 ether);
        vm.stopPrank();

        // Parent spent = 3 + 4 = 7 ether
        assertEq(_getTask(rootId).spent, 7 ether);
    }

    // ============ View Functions ============

    function test_getTaskCount() public {
        assertEq(engine.getTaskCount(), 0);
        _createRootTask(1 ether, 3);
        assertEq(engine.getTaskCount(), 1);
    }

    function test_getTreeCount() public {
        assertEq(engine.getTreeCount(), 0);
        _createRootTask(1 ether, 3);
        assertEq(engine.getTreeCount(), 1);
    }

    function test_receiveEther() public {
        (bool ok, ) = address(engine).call{value: 1 ether}("");
        assertTrue(ok);
    }

    // ============ Fuzz Tests ============

    function testFuzz_createRootTask_variableBudget(uint128 budget) public {
        budget = uint128(bound(budget, 1, 50 ether));
        vm.deal(creator, uint256(budget));

        vm.prank(creator);
        (uint256 taskId, uint256 treeId) = engine.createRootTask{value: budget}(
            keccak256("spec"),
            VibeTaskEngine.TaskPriority.MEDIUM,
            7,
            3
        );
        assertEq(_getTask(taskId).budget, budget);
        assertEq(engine.getTree(treeId).totalBudget, budget);
    }

    function testFuzz_createSubtask_variableBudget(uint128 subBudget) public {
        uint256 rootBudget = 50 ether;
        subBudget = uint128(bound(subBudget, 0, rootBudget));

        (uint256 rootId, ) = _createRootTask(rootBudget, 3);

        uint256[] memory deps = new uint256[](0);
        vm.prank(creator);
        uint256 subId = engine.createSubtask(rootId, keccak256("sub"), VibeTaskEngine.TaskPriority.LOW, deps, subBudget);

        assertEq(_getTask(subId).budget, subBudget);
        assertEq(_getTask(rootId).spent, subBudget);
    }

    // ============ Receive for payment callback ============

    receive() external payable {}
}
