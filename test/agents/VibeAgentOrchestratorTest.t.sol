// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/agents/VibeAgentOrchestrator.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Test Contract ============

contract VibeAgentOrchestratorTest is Test {
    // ============ Re-declare Events ============

    event WorkflowCreated(uint256 indexed workflowId, address indexed creator, string name, uint256 budget);
    event WorkflowActivated(uint256 indexed workflowId);
    event WorkflowCompleted(uint256 indexed workflowId, uint256 spent);
    event WorkflowFailed(uint256 indexed workflowId, uint256 stepId);
    event StepAdded(uint256 indexed workflowId, uint256 stepId, bytes32 agentId);
    event StepExecuted(uint256 indexed workflowId, uint256 stepId, bytes32 agentId, bytes32 outputHash);
    event StepFailed(uint256 indexed workflowId, uint256 stepId);
    event SwarmCreated(uint256 indexed swarmId, string name, VibeAgentOrchestrator.ConsensusType consensusType);
    event SwarmTaskAssigned(uint256 indexed swarmId, uint256 taskId, bytes32 taskHash);
    event SwarmConsensusReached(uint256 indexed swarmId, uint256 taskId, bytes32 result);

    // ============ State ============

    VibeAgentOrchestrator public orch;
    address public owner;
    address public wfCreator;
    address public agentOp1;
    address public agentOp2;
    address public agentOp3;
    bytes32 public agentA;
    bytes32 public agentB;
    bytes32 public agentC;

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        wfCreator = makeAddr("wfCreator");
        agentOp1 = makeAddr("agentOp1");
        agentOp2 = makeAddr("agentOp2");
        agentOp3 = makeAddr("agentOp3");

        agentA = keccak256("agentA");
        agentB = keccak256("agentB");
        agentC = keccak256("agentC");

        VibeAgentOrchestrator impl = new VibeAgentOrchestrator();
        bytes memory initData = abi.encodeWithSelector(VibeAgentOrchestrator.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        orch = VibeAgentOrchestrator(payable(address(proxy)));

        // Register agent operators
        orch.registerAgentOperator(agentA, agentOp1);
        orch.registerAgentOperator(agentB, agentOp2);
        orch.registerAgentOperator(agentC, agentOp3);
    }

    // ============ Helpers ============

    function _createWorkflow(string memory name, uint256 budget) internal returns (uint256) {
        vm.prank(wfCreator);
        return orch.createWorkflow(name, budget);
    }

    function _addStep(uint256 wfId, bytes32 agent, uint256 reward, uint256[] memory deps) internal returns (uint256) {
        vm.prank(wfCreator);
        return orch.addStep(wfId, agent, keccak256("input"), reward, deps);
    }

    // ============ Agent Operator Registration ============

    function test_registerAgentOperator_success() public {
        bytes32 newAgent = keccak256("newAgent");
        address newOp = makeAddr("newOp");

        orch.registerAgentOperator(newAgent, newOp);
        assertEq(orch.agentOperators(newAgent), newOp);
    }

    function test_registerAgentOperator_revert_notOwner() public {
        vm.prank(wfCreator);
        vm.expectRevert();
        orch.registerAgentOperator(keccak256("x"), wfCreator);
    }

    // ============ Workflow Creation ============

    function test_createWorkflow_success() public {
        vm.prank(wfCreator);
        uint256 wfId = orch.createWorkflow("Data Pipeline", 10 ether);

        assertEq(wfId, 0);

        (uint256 id, address creator, string memory name, uint256 budget,
         uint256 spent, VibeAgentOrchestrator.WorkflowStatus status,
         uint256 createdAt, uint256 stepCount) = orch.getWorkflow(wfId);

        assertEq(id, 0);
        assertEq(creator, wfCreator);
        assertEq(name, "Data Pipeline");
        assertEq(budget, 10 ether);
        assertEq(spent, 0);
        assertEq(uint8(status), uint8(VibeAgentOrchestrator.WorkflowStatus.DRAFT));
        assertGt(createdAt, 0);
        assertEq(stepCount, 0);
    }

    function test_createWorkflow_emitsEvent() public {
        vm.prank(wfCreator);
        vm.expectEmit(true, true, false, true);
        emit WorkflowCreated(0, wfCreator, "Pipeline", 5 ether);
        orch.createWorkflow("Pipeline", 5 ether);
    }

    function test_createWorkflow_incrementsId() public {
        _createWorkflow("WF1", 1 ether);
        uint256 wf2 = _createWorkflow("WF2", 2 ether);
        assertEq(wf2, 1);
    }

    // ============ Step Addition ============

    function test_addStep_success() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);

        vm.prank(wfCreator);
        uint256 stepId = orch.addStep(wfId, agentA, keccak256("input"), 3 ether, noDeps);

        assertEq(stepId, 0);

        (bytes32 agent, bytes32 inputHash, bytes32 outputHash,
         VibeAgentOrchestrator.StepStatus status, uint256 reward,
         uint256[] memory deps) = orch.getStep(wfId, stepId);

        assertEq(agent, agentA);
        assertEq(reward, 3 ether);
        assertEq(uint8(status), uint8(VibeAgentOrchestrator.StepStatus.PENDING));
        assertEq(deps.length, 0);
    }

    function test_addStep_withDependencies() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);

        uint256 step0 = _addStep(wfId, agentA, 2 ether, noDeps);

        uint256[] memory deps = new uint256[](1);
        deps[0] = step0;
        uint256 step1 = _addStep(wfId, agentB, 3 ether, deps);

        (, , , , , uint256[] memory gotDeps) = orch.getStep(wfId, step1);
        assertEq(gotDeps.length, 1);
        assertEq(gotDeps[0], step0);
    }

    function test_addStep_revert_workflowNotFound() public {
        uint256[] memory noDeps = new uint256[](0);
        vm.prank(wfCreator);
        vm.expectRevert(VibeAgentOrchestrator.WorkflowNotFound.selector);
        orch.addStep(999, agentA, keccak256("in"), 1 ether, noDeps);
    }

    function test_addStep_revert_notDraft() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);
        _addStep(wfId, agentA, 1 ether, noDeps);

        vm.prank(wfCreator);
        orch.activateWorkflow(wfId);

        vm.prank(wfCreator);
        vm.expectRevert(VibeAgentOrchestrator.WorkflowNotDraft.selector);
        orch.addStep(wfId, agentB, keccak256("in"), 1 ether, noDeps);
    }

    function test_addStep_revert_notCreator() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);

        vm.prank(agentOp1); // not creator
        vm.expectRevert(VibeAgentOrchestrator.WorkflowNotDraft.selector);
        orch.addStep(wfId, agentA, keccak256("in"), 1 ether, noDeps);
    }

    function test_addStep_revert_budgetExceeded() public {
        uint256 wfId = _createWorkflow("Pipeline", 5 ether);
        uint256[] memory noDeps = new uint256[](0);

        // Budget = 5 ether, try to add step worth 6
        vm.prank(wfCreator);
        vm.expectRevert(VibeAgentOrchestrator.BudgetExceeded.selector);
        orch.addStep(wfId, agentA, keccak256("in"), 6 ether, noDeps);
    }

    function test_addStep_revert_invalidDependency() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);
        _addStep(wfId, agentA, 1 ether, noDeps); // step 0

        // Depend on step 1 which is the same step being added (circular/forward dep)
        uint256[] memory badDeps = new uint256[](1);
        badDeps[0] = 1; // forward reference
        vm.prank(wfCreator);
        vm.expectRevert(VibeAgentOrchestrator.InvalidDependency.selector);
        orch.addStep(wfId, agentB, keccak256("in"), 1 ether, badDeps);
    }

    function test_addStep_emitsEvent() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);

        vm.prank(wfCreator);
        vm.expectEmit(true, false, false, true);
        emit StepAdded(wfId, 0, agentA);
        orch.addStep(wfId, agentA, keccak256("in"), 1 ether, noDeps);
    }

    // ============ Workflow Activation ============

    function test_activateWorkflow_success() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);
        _addStep(wfId, agentA, 3 ether, noDeps);

        vm.prank(wfCreator);
        orch.activateWorkflow(wfId);

        (, , , , , VibeAgentOrchestrator.WorkflowStatus status, , ) = orch.getWorkflow(wfId);
        assertEq(uint8(status), uint8(VibeAgentOrchestrator.WorkflowStatus.ACTIVE));

        // Root step (no deps) should now be READY
        (, , , VibeAgentOrchestrator.StepStatus stepStatus, , ) = orch.getStep(wfId, 0);
        assertEq(uint8(stepStatus), uint8(VibeAgentOrchestrator.StepStatus.READY));
    }

    function test_activateWorkflow_marksOnlyRootStepsReady() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);
        uint256 step0 = _addStep(wfId, agentA, 2 ether, noDeps);

        uint256[] memory deps = new uint256[](1);
        deps[0] = step0;
        _addStep(wfId, agentB, 2 ether, deps); // step 1 depends on step 0

        vm.prank(wfCreator);
        orch.activateWorkflow(wfId);

        // step 0: READY (root)
        (, , , VibeAgentOrchestrator.StepStatus s0, , ) = orch.getStep(wfId, 0);
        assertEq(uint8(s0), uint8(VibeAgentOrchestrator.StepStatus.READY));

        // step 1: PENDING (has dependency)
        (, , , VibeAgentOrchestrator.StepStatus s1, , ) = orch.getStep(wfId, 1);
        assertEq(uint8(s1), uint8(VibeAgentOrchestrator.StepStatus.PENDING));
    }

    function test_activateWorkflow_emitsEvent() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);
        _addStep(wfId, agentA, 1 ether, noDeps);

        vm.prank(wfCreator);
        vm.expectEmit(true, false, false, false);
        emit WorkflowActivated(wfId);
        orch.activateWorkflow(wfId);
    }

    function test_activateWorkflow_appearsInActiveList() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);
        _addStep(wfId, agentA, 1 ether, noDeps);

        vm.prank(wfCreator);
        orch.activateWorkflow(wfId);

        uint256[] memory active = orch.getActiveWorkflows();
        assertEq(active.length, 1);
        assertEq(active[0], wfId);
    }

    // ============ Step Execution ============

    function test_executeStep_success() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);
        _addStep(wfId, agentA, 3 ether, noDeps);

        vm.prank(wfCreator);
        orch.activateWorkflow(wfId);

        bytes32 outputHash = keccak256("output-data");
        vm.prank(agentOp1);
        orch.executeStep(wfId, 0, outputHash);

        (, , bytes32 gotOutput, VibeAgentOrchestrator.StepStatus status, , ) = orch.getStep(wfId, 0);
        assertEq(uint8(status), uint8(VibeAgentOrchestrator.StepStatus.COMPLETED));
        assertEq(gotOutput, outputHash);
    }

    function test_executeStep_unlocksDependents() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);
        uint256 step0 = _addStep(wfId, agentA, 2 ether, noDeps);

        uint256[] memory deps = new uint256[](1);
        deps[0] = step0;
        _addStep(wfId, agentB, 2 ether, deps);

        vm.prank(wfCreator);
        orch.activateWorkflow(wfId);

        // Execute step 0
        vm.prank(agentOp1);
        orch.executeStep(wfId, 0, keccak256("out0"));

        // step 1 should now be READY
        (, , , VibeAgentOrchestrator.StepStatus s1, , ) = orch.getStep(wfId, 1);
        assertEq(uint8(s1), uint8(VibeAgentOrchestrator.StepStatus.READY));
    }

    function test_executeStep_completesWorkflow() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);
        _addStep(wfId, agentA, 3 ether, noDeps);

        vm.prank(wfCreator);
        orch.activateWorkflow(wfId);

        vm.prank(agentOp1);
        orch.executeStep(wfId, 0, keccak256("result"));

        (, , , , , VibeAgentOrchestrator.WorkflowStatus status, , ) = orch.getWorkflow(wfId);
        assertEq(uint8(status), uint8(VibeAgentOrchestrator.WorkflowStatus.COMPLETED));
    }

    function test_executeStep_revert_notActive() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);
        _addStep(wfId, agentA, 1 ether, noDeps);

        // Workflow is DRAFT, not ACTIVE
        vm.prank(agentOp1);
        vm.expectRevert(VibeAgentOrchestrator.WorkflowNotActive.selector);
        orch.executeStep(wfId, 0, keccak256("out"));
    }

    function test_executeStep_revert_notReady() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);
        uint256 step0 = _addStep(wfId, agentA, 2 ether, noDeps);

        uint256[] memory deps = new uint256[](1);
        deps[0] = step0;
        _addStep(wfId, agentB, 2 ether, deps);

        vm.prank(wfCreator);
        orch.activateWorkflow(wfId);

        // Step 1 is PENDING (dependency not met)
        vm.prank(agentOp2);
        vm.expectRevert(VibeAgentOrchestrator.StepNotReady.selector);
        orch.executeStep(wfId, 1, keccak256("out"));
    }

    function test_executeStep_revert_notStepAgent() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);
        _addStep(wfId, agentA, 1 ether, noDeps);

        vm.prank(wfCreator);
        orch.activateWorkflow(wfId);

        // agentOp2 is not the operator for agentA
        vm.prank(agentOp2);
        vm.expectRevert(VibeAgentOrchestrator.NotStepAgent.selector);
        orch.executeStep(wfId, 0, keccak256("out"));
    }

    function test_executeStep_emitsEvent() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);
        _addStep(wfId, agentA, 1 ether, noDeps);

        vm.prank(wfCreator);
        orch.activateWorkflow(wfId);

        bytes32 outHash = keccak256("out");
        vm.prank(agentOp1);
        vm.expectEmit(true, false, false, true);
        emit StepExecuted(wfId, 0, agentA, outHash);
        orch.executeStep(wfId, 0, outHash);
    }

    // ============ Multi-step DAG Execution ============

    function test_dagExecution_threeStepPipeline() public {
        // A -> B -> C (linear chain)
        uint256 wfId = _createWorkflow("Linear", 10 ether);
        uint256[] memory noDeps = new uint256[](0);
        uint256 step0 = _addStep(wfId, agentA, 1 ether, noDeps);

        uint256[] memory dep0 = new uint256[](1);
        dep0[0] = step0;
        uint256 step1 = _addStep(wfId, agentB, 1 ether, dep0);

        uint256[] memory dep1 = new uint256[](1);
        dep1[0] = step1;
        _addStep(wfId, agentC, 1 ether, dep1);

        vm.prank(wfCreator);
        orch.activateWorkflow(wfId);

        // Only step 0 is READY
        (, , , VibeAgentOrchestrator.StepStatus s0, , ) = orch.getStep(wfId, 0);
        (, , , VibeAgentOrchestrator.StepStatus s1, , ) = orch.getStep(wfId, 1);
        (, , , VibeAgentOrchestrator.StepStatus s2, , ) = orch.getStep(wfId, 2);
        assertEq(uint8(s0), uint8(VibeAgentOrchestrator.StepStatus.READY));
        assertEq(uint8(s1), uint8(VibeAgentOrchestrator.StepStatus.PENDING));
        assertEq(uint8(s2), uint8(VibeAgentOrchestrator.StepStatus.PENDING));

        // Execute step 0 -> unlocks step 1
        vm.prank(agentOp1);
        orch.executeStep(wfId, 0, keccak256("out0"));

        (, , , s1, , ) = orch.getStep(wfId, 1);
        assertEq(uint8(s1), uint8(VibeAgentOrchestrator.StepStatus.READY));

        // Execute step 1 -> unlocks step 2
        vm.prank(agentOp2);
        orch.executeStep(wfId, 1, keccak256("out1"));

        (, , , s2, , ) = orch.getStep(wfId, 2);
        assertEq(uint8(s2), uint8(VibeAgentOrchestrator.StepStatus.READY));

        // Execute step 2 -> workflow complete
        vm.prank(agentOp3);
        orch.executeStep(wfId, 2, keccak256("out2"));

        (, , , , , VibeAgentOrchestrator.WorkflowStatus wfStatus, , ) = orch.getWorkflow(wfId);
        assertEq(uint8(wfStatus), uint8(VibeAgentOrchestrator.WorkflowStatus.COMPLETED));
    }

    function test_dagExecution_parallelThenMerge() public {
        // Step 0 (A) and Step 1 (B) in parallel, Step 2 (C) depends on both
        uint256 wfId = _createWorkflow("Fan-in", 10 ether);
        uint256[] memory noDeps = new uint256[](0);
        uint256 step0 = _addStep(wfId, agentA, 1 ether, noDeps);
        uint256 step1 = _addStep(wfId, agentB, 1 ether, noDeps);

        uint256[] memory bothDeps = new uint256[](2);
        bothDeps[0] = step0;
        bothDeps[1] = step1;
        _addStep(wfId, agentC, 1 ether, bothDeps);

        vm.prank(wfCreator);
        orch.activateWorkflow(wfId);

        // Steps 0 and 1 should be READY, step 2 PENDING
        (, , , VibeAgentOrchestrator.StepStatus s2, , ) = orch.getStep(wfId, 2);
        assertEq(uint8(s2), uint8(VibeAgentOrchestrator.StepStatus.PENDING));

        // Complete step 0 only -> step 2 still PENDING
        vm.prank(agentOp1);
        orch.executeStep(wfId, 0, keccak256("out0"));

        (, , , s2, , ) = orch.getStep(wfId, 2);
        assertEq(uint8(s2), uint8(VibeAgentOrchestrator.StepStatus.PENDING));

        // Complete step 1 -> step 2 now READY
        vm.prank(agentOp2);
        orch.executeStep(wfId, 1, keccak256("out1"));

        (, , , s2, , ) = orch.getStep(wfId, 2);
        assertEq(uint8(s2), uint8(VibeAgentOrchestrator.StepStatus.READY));
    }

    // ============ Workflow Failure ============

    function test_failStep_failsWorkflow() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);
        _addStep(wfId, agentA, 1 ether, noDeps);

        vm.prank(wfCreator);
        orch.activateWorkflow(wfId);

        vm.prank(wfCreator);
        orch.failStep(wfId, 0);

        (, , , VibeAgentOrchestrator.StepStatus sStatus, , ) = orch.getStep(wfId, 0);
        assertEq(uint8(sStatus), uint8(VibeAgentOrchestrator.StepStatus.FAILED));

        (, , , , , VibeAgentOrchestrator.WorkflowStatus wfStatus, , ) = orch.getWorkflow(wfId);
        assertEq(uint8(wfStatus), uint8(VibeAgentOrchestrator.WorkflowStatus.FAILED));
    }

    function test_failStep_removesFromActiveList() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);
        _addStep(wfId, agentA, 1 ether, noDeps);

        vm.prank(wfCreator);
        orch.activateWorkflow(wfId);
        assertEq(orch.getActiveWorkflows().length, 1);

        vm.prank(wfCreator);
        orch.failStep(wfId, 0);

        // Active list should be empty
        assertEq(orch.getActiveWorkflows().length, 0);
    }

    function test_failStep_revert_notActive() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);
        _addStep(wfId, agentA, 1 ether, noDeps);

        // DRAFT state
        vm.prank(wfCreator);
        vm.expectRevert(VibeAgentOrchestrator.WorkflowNotActive.selector);
        orch.failStep(wfId, 0);
    }

    function test_failStep_emitsEvents() public {
        uint256 wfId = _createWorkflow("Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);
        _addStep(wfId, agentA, 1 ether, noDeps);

        vm.prank(wfCreator);
        orch.activateWorkflow(wfId);

        vm.prank(wfCreator);
        vm.expectEmit(true, false, false, true);
        emit StepFailed(wfId, 0);
        orch.failStep(wfId, 0);
    }

    // ============ Swarm Management ============

    function test_createSwarm_success() public {
        bytes32[] memory agents = new bytes32[](3);
        agents[0] = agentA;
        agents[1] = agentB;
        agents[2] = agentC;

        uint256 swarmId = orch.createSwarm("Audit Swarm", agents, VibeAgentOrchestrator.ConsensusType.MAJORITY);

        (uint256 id, string memory name, bytes32[] memory gotAgents,
         VibeAgentOrchestrator.ConsensusType ct, uint256 totalTasks) = orch.getSwarm(swarmId);

        assertEq(id, 0);
        assertEq(name, "Audit Swarm");
        assertEq(gotAgents.length, 3);
        assertEq(uint8(ct), uint8(VibeAgentOrchestrator.ConsensusType.MAJORITY));
        assertEq(totalTasks, 0);
    }

    function test_createSwarm_emitsEvent() public {
        bytes32[] memory agents = new bytes32[](1);
        agents[0] = agentA;

        vm.expectEmit(true, false, false, true);
        emit SwarmCreated(0, "TestSwarm", VibeAgentOrchestrator.ConsensusType.UNANIMOUS);
        orch.createSwarm("TestSwarm", agents, VibeAgentOrchestrator.ConsensusType.UNANIMOUS);
    }

    // ============ Swarm Task Assignment ============

    function test_assignSwarmTask_success() public {
        bytes32[] memory agents = new bytes32[](2);
        agents[0] = agentA;
        agents[1] = agentB;

        uint256 swarmId = orch.createSwarm("Swarm", agents, VibeAgentOrchestrator.ConsensusType.MAJORITY);

        bytes32 taskHash = keccak256("task1");
        uint256 taskId = orch.assignSwarmTask(swarmId, taskHash);
        assertEq(taskId, 0);
    }

    function test_assignSwarmTask_revert_notFound() public {
        vm.expectRevert(VibeAgentOrchestrator.SwarmNotFound.selector);
        orch.assignSwarmTask(999, keccak256("task"));
    }

    function test_assignSwarmTask_emitsEvent() public {
        bytes32[] memory agents = new bytes32[](1);
        agents[0] = agentA;
        uint256 swarmId = orch.createSwarm("Swarm", agents, VibeAgentOrchestrator.ConsensusType.MAJORITY);

        bytes32 taskHash = keccak256("task1");
        vm.expectEmit(true, false, false, true);
        emit SwarmTaskAssigned(swarmId, 0, taskHash);
        orch.assignSwarmTask(swarmId, taskHash);
    }

    // ============ Swarm Output Submission ============

    function test_submitSwarmOutput_success() public {
        bytes32[] memory agents = new bytes32[](2);
        agents[0] = agentA;
        agents[1] = agentB;
        uint256 swarmId = orch.createSwarm("Swarm", agents, VibeAgentOrchestrator.ConsensusType.MAJORITY);
        uint256 taskId = orch.assignSwarmTask(swarmId, keccak256("task"));

        vm.prank(agentOp1);
        orch.submitSwarmOutput(swarmId, taskId, agentA, keccak256("output1"));

        // Should not revert — output accepted
    }

    function test_submitSwarmOutput_revert_notOperator() public {
        bytes32[] memory agents = new bytes32[](1);
        agents[0] = agentA;
        uint256 swarmId = orch.createSwarm("Swarm", agents, VibeAgentOrchestrator.ConsensusType.MAJORITY);
        uint256 taskId = orch.assignSwarmTask(swarmId, keccak256("task"));

        vm.prank(agentOp2); // not agentA's operator
        vm.expectRevert(VibeAgentOrchestrator.NotSwarmMember.selector);
        orch.submitSwarmOutput(swarmId, taskId, agentA, keccak256("out"));
    }

    function test_submitSwarmOutput_revert_notMember() public {
        bytes32[] memory agents = new bytes32[](1);
        agents[0] = agentA;
        uint256 swarmId = orch.createSwarm("Swarm", agents, VibeAgentOrchestrator.ConsensusType.MAJORITY);
        uint256 taskId = orch.assignSwarmTask(swarmId, keccak256("task"));

        // agentB is not in this swarm
        vm.prank(agentOp2);
        vm.expectRevert(VibeAgentOrchestrator.NotSwarmMember.selector);
        orch.submitSwarmOutput(swarmId, taskId, agentB, keccak256("out"));
    }

    function test_submitSwarmOutput_revert_doubleSubmission() public {
        bytes32[] memory agents = new bytes32[](1);
        agents[0] = agentA;
        uint256 swarmId = orch.createSwarm("Swarm", agents, VibeAgentOrchestrator.ConsensusType.MAJORITY);
        uint256 taskId = orch.assignSwarmTask(swarmId, keccak256("task"));

        vm.prank(agentOp1);
        orch.submitSwarmOutput(swarmId, taskId, agentA, keccak256("out1"));

        vm.prank(agentOp1);
        vm.expectRevert(VibeAgentOrchestrator.AlreadySubmitted.selector);
        orch.submitSwarmOutput(swarmId, taskId, agentA, keccak256("out2"));
    }

    // ============ Swarm Consensus ============

    function test_resolveSwarmConsensus_majorityVote() public {
        bytes32[] memory agents = new bytes32[](3);
        agents[0] = agentA;
        agents[1] = agentB;
        agents[2] = agentC;
        uint256 swarmId = orch.createSwarm("Swarm", agents, VibeAgentOrchestrator.ConsensusType.MAJORITY);
        uint256 taskId = orch.assignSwarmTask(swarmId, keccak256("task"));

        bytes32 correctOutput = keccak256("correct");
        bytes32 wrongOutput = keccak256("wrong");

        vm.prank(agentOp1);
        orch.submitSwarmOutput(swarmId, taskId, agentA, correctOutput);

        vm.prank(agentOp2);
        orch.submitSwarmOutput(swarmId, taskId, agentB, correctOutput);

        vm.prank(agentOp3);
        orch.submitSwarmOutput(swarmId, taskId, agentC, wrongOutput);

        bytes32 result = orch.resolveSwarmConsensus(swarmId, taskId);
        assertEq(result, correctOutput);
    }

    function test_resolveSwarmConsensus_unanimousAllAgree() public {
        bytes32[] memory agents = new bytes32[](3);
        agents[0] = agentA;
        agents[1] = agentB;
        agents[2] = agentC;
        uint256 swarmId = orch.createSwarm("Swarm", agents, VibeAgentOrchestrator.ConsensusType.UNANIMOUS);
        uint256 taskId = orch.assignSwarmTask(swarmId, keccak256("task"));

        bytes32 output = keccak256("agreed");

        vm.prank(agentOp1);
        orch.submitSwarmOutput(swarmId, taskId, agentA, output);
        vm.prank(agentOp2);
        orch.submitSwarmOutput(swarmId, taskId, agentB, output);
        vm.prank(agentOp3);
        orch.submitSwarmOutput(swarmId, taskId, agentC, output);

        bytes32 result = orch.resolveSwarmConsensus(swarmId, taskId);
        assertEq(result, output);
    }

    function test_resolveSwarmConsensus_unanimousReverts_disagree() public {
        bytes32[] memory agents = new bytes32[](2);
        agents[0] = agentA;
        agents[1] = agentB;
        uint256 swarmId = orch.createSwarm("Swarm", agents, VibeAgentOrchestrator.ConsensusType.UNANIMOUS);
        uint256 taskId = orch.assignSwarmTask(swarmId, keccak256("task"));

        vm.prank(agentOp1);
        orch.submitSwarmOutput(swarmId, taskId, agentA, keccak256("out1"));
        vm.prank(agentOp2);
        orch.submitSwarmOutput(swarmId, taskId, agentB, keccak256("out2"));

        vm.expectRevert("No unanimous consensus");
        orch.resolveSwarmConsensus(swarmId, taskId);
    }

    function test_resolveSwarmConsensus_unanimousReverts_missingSubmissions() public {
        bytes32[] memory agents = new bytes32[](2);
        agents[0] = agentA;
        agents[1] = agentB;
        uint256 swarmId = orch.createSwarm("Swarm", agents, VibeAgentOrchestrator.ConsensusType.UNANIMOUS);
        uint256 taskId = orch.assignSwarmTask(swarmId, keccak256("task"));

        // Only 1 of 2 agents submitted
        vm.prank(agentOp1);
        orch.submitSwarmOutput(swarmId, taskId, agentA, keccak256("out1"));

        vm.expectRevert("Not all agents submitted");
        orch.resolveSwarmConsensus(swarmId, taskId);
    }

    function test_resolveSwarmConsensus_revert_alreadyResolved() public {
        bytes32[] memory agents = new bytes32[](1);
        agents[0] = agentA;
        uint256 swarmId = orch.createSwarm("Swarm", agents, VibeAgentOrchestrator.ConsensusType.MAJORITY);
        uint256 taskId = orch.assignSwarmTask(swarmId, keccak256("task"));

        vm.prank(agentOp1);
        orch.submitSwarmOutput(swarmId, taskId, agentA, keccak256("out"));

        orch.resolveSwarmConsensus(swarmId, taskId);

        vm.expectRevert(VibeAgentOrchestrator.TaskAlreadyResolved.selector);
        orch.resolveSwarmConsensus(swarmId, taskId);
    }

    function test_resolveSwarmConsensus_revert_noSubmissions() public {
        bytes32[] memory agents = new bytes32[](1);
        agents[0] = agentA;
        uint256 swarmId = orch.createSwarm("Swarm", agents, VibeAgentOrchestrator.ConsensusType.MAJORITY);
        uint256 taskId = orch.assignSwarmTask(swarmId, keccak256("task"));

        vm.expectRevert(VibeAgentOrchestrator.NoSubmissions.selector);
        orch.resolveSwarmConsensus(swarmId, taskId);
    }

    function test_resolveSwarmConsensus_emitsEvent() public {
        bytes32[] memory agents = new bytes32[](1);
        agents[0] = agentA;
        uint256 swarmId = orch.createSwarm("Swarm", agents, VibeAgentOrchestrator.ConsensusType.MAJORITY);
        uint256 taskId = orch.assignSwarmTask(swarmId, keccak256("task"));

        bytes32 output = keccak256("out");
        vm.prank(agentOp1);
        orch.submitSwarmOutput(swarmId, taskId, agentA, output);

        vm.expectEmit(true, false, false, true);
        emit SwarmConsensusReached(swarmId, taskId, output);
        orch.resolveSwarmConsensus(swarmId, taskId);
    }

    // ============ Integration: Full Workflow Lifecycle ============

    function test_fullWorkflowLifecycle() public {
        // 1. Create workflow with 3-step pipeline: A -> B -> C
        uint256 wfId = _createWorkflow("Full Pipeline", 10 ether);
        uint256[] memory noDeps = new uint256[](0);
        uint256 step0 = _addStep(wfId, agentA, 2 ether, noDeps);

        uint256[] memory dep0 = new uint256[](1);
        dep0[0] = step0;
        uint256 step1 = _addStep(wfId, agentB, 3 ether, dep0);

        uint256[] memory dep1 = new uint256[](1);
        dep1[0] = step1;
        _addStep(wfId, agentC, 2 ether, dep1);

        // 2. Activate
        vm.prank(wfCreator);
        orch.activateWorkflow(wfId);

        // 3. Execute all steps in order
        vm.prank(agentOp1);
        orch.executeStep(wfId, 0, keccak256("data-collected"));

        vm.prank(agentOp2);
        orch.executeStep(wfId, 1, keccak256("data-processed"));

        vm.prank(agentOp3);
        orch.executeStep(wfId, 2, keccak256("report-generated"));

        // 4. Verify completion
        (, , , , uint256 spent, VibeAgentOrchestrator.WorkflowStatus status, , ) = orch.getWorkflow(wfId);
        assertEq(uint8(status), uint8(VibeAgentOrchestrator.WorkflowStatus.COMPLETED));
        assertEq(spent, 7 ether); // 2 + 3 + 2

        // No longer in active list
        assertEq(orch.getActiveWorkflows().length, 0);
    }

    // ============ Fuzz Tests ============

    function testFuzz_createWorkflow_variableBudget(uint256 budget) public {
        vm.prank(wfCreator);
        uint256 wfId = orch.createWorkflow("Fuzz", budget);
        (, , , uint256 gotBudget, , , , ) = orch.getWorkflow(wfId);
        assertEq(gotBudget, budget);
    }
}
