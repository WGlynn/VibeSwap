// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeAgentOrchestrator — VSOS Agent Orchestrator
 * @notice Coordinates multi-agent workflows and swarms for the VibeSwap Operating System.
 *         Agents execute DAG-based pipelines with parallel step execution when
 *         dependencies are satisfied. Swarms aggregate outputs via configurable consensus.
 *
 * @dev Integrates with AgentRegistry for agent identity verification.
 *      Budget tracking ensures workflows stay within allocation.
 *      Step dependencies form a DAG — no cycles enforced by stepId ordering.
 */
contract VibeAgentOrchestrator is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    // ============ Types ============

    enum WorkflowStatus { DRAFT, ACTIVE, COMPLETED, FAILED }
    enum StepStatus { PENDING, READY, EXECUTING, COMPLETED, FAILED }
    enum ConsensusType { MAJORITY, UNANIMOUS, WEIGHTED }

    struct Step {
        uint256 stepId;
        bytes32 agentId;
        bytes32 inputHash;
        bytes32 outputHash;
        StepStatus status;
        uint256 reward;
        uint256[] dependsOn;
    }

    struct Workflow {
        uint256 workflowId;
        address creator;
        string name;
        uint256 totalBudget;
        uint256 spent;
        WorkflowStatus status;
        uint256 createdAt;
        uint256 stepCount;
    }

    struct SwarmTask {
        bytes32 taskHash;
        bytes32[] submissions;
        mapping(bytes32 => bytes32) agentOutputs;
        bool resolved;
        bytes32 result;
    }

    struct AgentSwarm {
        uint256 swarmId;
        string name;
        bytes32[] agentIds;
        ConsensusType consensusType;
        uint256 totalTasks;
    }

    // ============ State ============

    uint256 public nextWorkflowId;
    uint256 public nextSwarmId;

    mapping(uint256 => Workflow) private _workflows;
    mapping(uint256 => mapping(uint256 => Step)) private _steps;
    mapping(uint256 => AgentSwarm) private _swarms;
    mapping(uint256 => mapping(uint256 => SwarmTask)) private _swarmTasks;

    /// @dev workflowId => true if active (for enumeration)
    mapping(uint256 => bool) private _isActive;
    uint256[] private _activeWorkflowIds;

    /// @dev agentId => authorized operator address
    mapping(bytes32 => address) public agentOperators;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event WorkflowCreated(uint256 indexed workflowId, address indexed creator, string name, uint256 budget);
    event WorkflowActivated(uint256 indexed workflowId);
    event WorkflowCompleted(uint256 indexed workflowId, uint256 spent);
    event WorkflowFailed(uint256 indexed workflowId, uint256 stepId);
    event StepAdded(uint256 indexed workflowId, uint256 stepId, bytes32 agentId);
    event StepExecuted(uint256 indexed workflowId, uint256 stepId, bytes32 agentId, bytes32 outputHash);
    event StepFailed(uint256 indexed workflowId, uint256 stepId);
    event SwarmCreated(uint256 indexed swarmId, string name, ConsensusType consensusType);
    event SwarmTaskAssigned(uint256 indexed swarmId, uint256 taskId, bytes32 taskHash);
    event SwarmConsensusReached(uint256 indexed swarmId, uint256 taskId, bytes32 result);

    // ============ Errors ============

    error WorkflowNotFound();
    error WorkflowNotDraft();
    error WorkflowNotActive();
    error StepNotFound();
    error StepNotReady();
    error NotStepAgent();
    error BudgetExceeded();
    error SwarmNotFound();
    error TaskAlreadyResolved();
    error NotSwarmMember();
    error AlreadySubmitted();
    error NoSubmissions();
    error InvalidDependency();

    // ============ Initializer ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    // ============ Agent Registration ============

    /// @notice Register an agent's operator address (owner-only for now)
    function registerAgentOperator(bytes32 agentId, address operator) external onlyOwner {
        agentOperators[agentId] = operator;
    }

    // ============ Workflow Management ============

    /// @notice Create a new multi-step agent workflow
    function createWorkflow(string calldata name, uint256 totalBudget) external returns (uint256 workflowId) {
        workflowId = nextWorkflowId++;
        Workflow storage wf = _workflows[workflowId];
        wf.workflowId = workflowId;
        wf.creator = msg.sender;
        wf.name = name;
        wf.totalBudget = totalBudget;
        wf.status = WorkflowStatus.DRAFT;
        wf.createdAt = block.timestamp;

        emit WorkflowCreated(workflowId, msg.sender, name, totalBudget);
    }

    /// @notice Add a step to a DRAFT workflow. dependsOn must reference earlier stepIds (DAG constraint).
    function addStep(
        uint256 workflowId,
        bytes32 agentId,
        bytes32 inputHash,
        uint256 reward,
        uint256[] calldata dependsOn
    ) external returns (uint256 stepId) {
        Workflow storage wf = _workflows[workflowId];
        if (wf.createdAt == 0) revert WorkflowNotFound();
        if (wf.status != WorkflowStatus.DRAFT) revert WorkflowNotDraft();
        if (wf.creator != msg.sender) revert WorkflowNotDraft();

        stepId = wf.stepCount++;

        // Validate DAG: all dependencies must reference earlier steps
        for (uint256 i; i < dependsOn.length; i++) {
            if (dependsOn[i] >= stepId) revert InvalidDependency();
        }

        // Check budget
        if (wf.spent + _pendingRewards(workflowId) + reward > wf.totalBudget) revert BudgetExceeded();

        Step storage s = _steps[workflowId][stepId];
        s.stepId = stepId;
        s.agentId = agentId;
        s.inputHash = inputHash;
        s.status = StepStatus.PENDING;
        s.reward = reward;
        s.dependsOn = dependsOn;

        emit StepAdded(workflowId, stepId, agentId);
    }

    /// @notice Activate a DRAFT workflow — marks steps with no dependencies as READY
    function activateWorkflow(uint256 workflowId) external {
        Workflow storage wf = _workflows[workflowId];
        if (wf.createdAt == 0) revert WorkflowNotFound();
        if (wf.status != WorkflowStatus.DRAFT) revert WorkflowNotDraft();
        if (wf.creator != msg.sender) revert WorkflowNotDraft();

        wf.status = WorkflowStatus.ACTIVE;
        _isActive[workflowId] = true;
        _activeWorkflowIds.push(workflowId);

        // Mark root steps (no dependencies) as READY
        for (uint256 i; i < wf.stepCount; i++) {
            if (_steps[workflowId][i].dependsOn.length == 0) {
                _steps[workflowId][i].status = StepStatus.READY;
            }
        }

        emit WorkflowActivated(workflowId);
    }

    /// @notice Agent executes their step, submitting the output hash
    function executeStep(uint256 workflowId, uint256 stepId, bytes32 outputHash) external nonReentrant {
        Workflow storage wf = _workflows[workflowId];
        if (wf.status != WorkflowStatus.ACTIVE) revert WorkflowNotActive();

        Step storage s = _steps[workflowId][stepId];
        if (s.agentId == bytes32(0)) revert StepNotFound();
        if (s.status != StepStatus.READY) revert StepNotReady();
        if (agentOperators[s.agentId] != msg.sender) revert NotStepAgent();

        s.status = StepStatus.COMPLETED;
        s.outputHash = outputHash;
        wf.spent += s.reward;

        emit StepExecuted(workflowId, stepId, s.agentId, outputHash);

        // Unlock dependent steps (DAG progression)
        _unlockDependents(workflowId, wf.stepCount);

        // Check if all steps completed
        if (_allStepsCompleted(workflowId, wf.stepCount)) {
            wf.status = WorkflowStatus.COMPLETED;
            _isActive[workflowId] = false;
            emit WorkflowCompleted(workflowId, wf.spent);
        }
    }

    /// @notice Mark a step as failed, which fails the entire workflow
    function failStep(uint256 workflowId, uint256 stepId) external {
        Workflow storage wf = _workflows[workflowId];
        if (wf.status != WorkflowStatus.ACTIVE) revert WorkflowNotActive();
        if (wf.creator != msg.sender && owner() != msg.sender) revert WorkflowNotActive();

        Step storage s = _steps[workflowId][stepId];
        if (s.agentId == bytes32(0)) revert StepNotFound();

        s.status = StepStatus.FAILED;
        wf.status = WorkflowStatus.FAILED;
        _isActive[workflowId] = false;

        emit StepFailed(workflowId, stepId);
        emit WorkflowFailed(workflowId, stepId);
    }

    // ============ Swarm Management ============

    /// @notice Create an agent swarm for collaborative task execution
    function createSwarm(
        string calldata name,
        bytes32[] calldata agentIds,
        ConsensusType consensusType
    ) external returns (uint256 swarmId) {
        swarmId = nextSwarmId++;
        AgentSwarm storage swarm = _swarms[swarmId];
        swarm.swarmId = swarmId;
        swarm.name = name;
        swarm.agentIds = agentIds;
        swarm.consensusType = consensusType;

        emit SwarmCreated(swarmId, name, consensusType);
    }

    /// @notice Assign a task to a swarm
    function assignSwarmTask(uint256 swarmId, bytes32 taskHash) external returns (uint256 taskId) {
        AgentSwarm storage swarm = _swarms[swarmId];
        if (swarm.agentIds.length == 0) revert SwarmNotFound();

        taskId = swarm.totalTasks++;
        _swarmTasks[swarmId][taskId].taskHash = taskHash;

        emit SwarmTaskAssigned(swarmId, taskId, taskHash);
    }

    /// @notice Agent submits their output for a swarm task
    function submitSwarmOutput(uint256 swarmId, uint256 taskId, bytes32 agentId, bytes32 outputHash) external {
        AgentSwarm storage swarm = _swarms[swarmId];
        if (swarm.agentIds.length == 0) revert SwarmNotFound();
        if (agentOperators[agentId] != msg.sender) revert NotSwarmMember();

        // Verify agent is in swarm
        bool isMember;
        for (uint256 i; i < swarm.agentIds.length; i++) {
            if (swarm.agentIds[i] == agentId) { isMember = true; break; }
        }
        if (!isMember) revert NotSwarmMember();

        SwarmTask storage task = _swarmTasks[swarmId][taskId];
        if (task.resolved) revert TaskAlreadyResolved();
        if (task.agentOutputs[agentId] != bytes32(0)) revert AlreadySubmitted();

        task.agentOutputs[agentId] = outputHash;
        task.submissions.push(agentId);
    }

    /// @notice Resolve swarm consensus based on the swarm's consensus type
    function resolveSwarmConsensus(uint256 swarmId, uint256 taskId) external returns (bytes32 result) {
        AgentSwarm storage swarm = _swarms[swarmId];
        if (swarm.agentIds.length == 0) revert SwarmNotFound();

        SwarmTask storage task = _swarmTasks[swarmId][taskId];
        if (task.resolved) revert TaskAlreadyResolved();
        if (task.submissions.length == 0) revert NoSubmissions();

        if (swarm.consensusType == ConsensusType.UNANIMOUS) {
            result = _resolveUnanimous(task, swarm);
        } else {
            // MAJORITY and WEIGHTED both use plurality (most common output)
            result = _resolveMajority(task);
        }

        task.resolved = true;
        task.result = result;

        emit SwarmConsensusReached(swarmId, taskId, result);
    }

    // ============ Views ============

    function getWorkflow(uint256 workflowId) external view returns (
        uint256 id, address creator, string memory name, uint256 totalBudget,
        uint256 spent, WorkflowStatus status, uint256 createdAt, uint256 stepCount
    ) {
        Workflow storage wf = _workflows[workflowId];
        return (wf.workflowId, wf.creator, wf.name, wf.totalBudget,
                wf.spent, wf.status, wf.createdAt, wf.stepCount);
    }

    function getStep(uint256 workflowId, uint256 stepId) external view returns (
        bytes32 agentId, bytes32 inputHash, bytes32 outputHash,
        StepStatus status, uint256 reward, uint256[] memory dependsOn
    ) {
        Step storage s = _steps[workflowId][stepId];
        return (s.agentId, s.inputHash, s.outputHash, s.status, s.reward, s.dependsOn);
    }

    function getSwarm(uint256 swarmId) external view returns (
        uint256 id, string memory name, bytes32[] memory agentIds,
        ConsensusType consensusType, uint256 totalTasks
    ) {
        AgentSwarm storage swarm = _swarms[swarmId];
        return (swarm.swarmId, swarm.name, swarm.agentIds, swarm.consensusType, swarm.totalTasks);
    }

    function getActiveWorkflows() external view returns (uint256[] memory) {
        uint256 count;
        for (uint256 i; i < _activeWorkflowIds.length; i++) {
            if (_isActive[_activeWorkflowIds[i]]) count++;
        }
        uint256[] memory result = new uint256[](count);
        uint256 idx;
        for (uint256 i; i < _activeWorkflowIds.length; i++) {
            if (_isActive[_activeWorkflowIds[i]]) {
                result[idx++] = _activeWorkflowIds[i];
            }
        }
        return result;
    }

    // ============ Internal ============

    function _unlockDependents(uint256 workflowId, uint256 stepCount) internal {
        for (uint256 i; i < stepCount; i++) {
            Step storage s = _steps[workflowId][i];
            if (s.status != StepStatus.PENDING) continue;

            bool allDepsComplete = true;
            for (uint256 j; j < s.dependsOn.length; j++) {
                if (_steps[workflowId][s.dependsOn[j]].status != StepStatus.COMPLETED) {
                    allDepsComplete = false;
                    break;
                }
            }
            if (allDepsComplete) {
                s.status = StepStatus.READY;
            }
        }
    }

    function _allStepsCompleted(uint256 workflowId, uint256 stepCount) internal view returns (bool) {
        for (uint256 i; i < stepCount; i++) {
            if (_steps[workflowId][i].status != StepStatus.COMPLETED) return false;
        }
        return true;
    }

    function _pendingRewards(uint256 workflowId) internal view returns (uint256 total) {
        uint256 count = _workflows[workflowId].stepCount;
        for (uint256 i; i < count; i++) {
            total += _steps[workflowId][i].reward;
        }
    }

    function _resolveMajority(SwarmTask storage task) internal view returns (bytes32) {
        // Find the most common output hash
        bytes32 bestOutput;
        uint256 bestCount;
        for (uint256 i; i < task.submissions.length; i++) {
            bytes32 output = task.agentOutputs[task.submissions[i]];
            uint256 count;
            for (uint256 j; j < task.submissions.length; j++) {
                if (task.agentOutputs[task.submissions[j]] == output) count++;
            }
            if (count > bestCount) {
                bestCount = count;
                bestOutput = output;
            }
        }
        return bestOutput;
    }

    function _resolveUnanimous(SwarmTask storage task, AgentSwarm storage swarm) internal view returns (bytes32) {
        // All swarm members must have submitted the same output
        require(task.submissions.length == swarm.agentIds.length, "Not all agents submitted");
        bytes32 first = task.agentOutputs[task.submissions[0]];
        for (uint256 i = 1; i < task.submissions.length; i++) {
            require(task.agentOutputs[task.submissions[i]] == first, "No unanimous consensus");
        }
        return first;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
