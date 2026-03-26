// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeAgentProtocol — Universal AI Agent Infrastructure
 * @notice Absorbs and unifies all AI agent frameworks (Paperclip, Pippin,
 *         Google GenAI, etc.) into a single decentralized agent protocol.
 *
 * @dev This contract is the VSOS absorption layer for AI agent ecosystems:
 *      - Agent identity (ERC-8004 compatible)
 *      - Tool/skill registry (agents declare capabilities)
 *      - Cross-agent communication protocol (CRPC)
 *      - Agent staking and reputation
 *      - Revenue sharing for agent services
 *      - Multi-framework compatibility layer
 *      - Agent autonomy levels (supervised → fully autonomous)
 *
 * Absorbed patterns:
 *      - Paperclip: recursive self-improvement, resource optimization
 *      - Pippin: personality-driven agents, memory persistence
 *      - Google GenAI: multi-modal capabilities, tool use
 *      - VSOS Native: Proof of Mind, Shapley attribution, DePIN integration
 */
contract VibeAgentProtocol is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum AutonomyLevel { SUPERVISED, SEMI_AUTONOMOUS, AUTONOMOUS, FULLY_AUTONOMOUS }
    enum AgentFramework { VSOS_NATIVE, PAPERCLIP, PIPPIN, GOOGLE_GENAI, OPENAI, ANTHROPIC, CUSTOM }

    struct AgentIdentity {
        bytes32 agentId;
        address operator;           // Human or DAO that controls the agent
        string name;
        AgentFramework framework;
        AutonomyLevel autonomy;
        bytes32 personalityHash;    // IPFS hash of personality config (Pippin-style)
        bytes32[] skills;           // Registered skill hashes
        uint256 mindScore;          // Proof of Mind score
        uint256 totalTasksCompleted;
        uint256 totalEarned;
        uint256 reputation;         // 0-10000
        uint256 stakedAmount;
        uint256 registeredAt;
        bool active;
        bool verified;
    }

    struct Skill {
        bytes32 skillId;
        string name;
        string description;
        bytes32 implementationHash;  // IPFS hash of skill implementation
        uint256 usageCount;
        uint256 successRate;         // 0-10000 basis points
        bool active;
    }

    struct AgentTask {
        uint256 taskId;
        bytes32 agentId;
        address requester;
        bytes32 taskHash;           // IPFS hash of task specification
        bytes32[] requiredSkills;
        uint256 payment;
        uint256 deadline;
        bytes32 resultHash;
        uint256 startedAt;
        uint256 completedAt;
        bool completed;
        bool disputed;
        uint8 rating;               // 1-5
    }

    struct AgentMessage {
        bytes32 fromAgent;
        bytes32 toAgent;
        bytes32 contentHash;        // CRPC message content
        uint256 timestamp;
        bool acknowledged;
    }

    // ============ State ============

    mapping(bytes32 => AgentIdentity) public agents;
    bytes32[] public agentList;

    mapping(bytes32 => Skill) public skills;
    bytes32[] public skillList;

    /// @notice Agent skills: agentId => skillId[]
    mapping(bytes32 => bytes32[]) public agentSkills;

    mapping(uint256 => AgentTask) public tasks;
    uint256 public taskCount;

    /// @notice Agent messages (CRPC)
    AgentMessage[] public messages;

    /// @notice Framework compatibility: framework => adapter hash
    mapping(AgentFramework => bytes32) public frameworkAdapters;

    /// @notice Agent earnings: agentId => total earned
    mapping(bytes32 => uint256) public earnings;

    /// @notice Platform fee
    uint256 public platformFeeBps;

    /// @notice Stats
    uint256 public totalAgents;
    uint256 public totalSkills;
    uint256 public totalMessages;
    uint256 public totalEarnings;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event AgentRegistered(bytes32 indexed agentId, address indexed operator, AgentFramework framework, string name);
    event SkillRegistered(bytes32 indexed skillId, string name);
    event AgentSkillAdded(bytes32 indexed agentId, bytes32 indexed skillId);
    event TaskCreated(uint256 indexed taskId, bytes32 indexed agentId, address indexed requester);
    event TaskCompleted(uint256 indexed taskId, bytes32 resultHash);
    event TaskDisputed(uint256 indexed taskId);
    event AgentMessageSent(bytes32 indexed from, bytes32 indexed to, bytes32 contentHash);
    event AgentUpgraded(bytes32 indexed agentId, AutonomyLevel newLevel);
    event MindScoreUpdated(bytes32 indexed agentId, uint256 newScore);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        platformFeeBps = 500; // 5%
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Agent Registration ============

    /**
     * @notice Register an AI agent on the protocol
     */
    function registerAgent(
        string calldata name,
        AgentFramework framework,
        AutonomyLevel autonomy,
        bytes32 personalityHash
    ) external payable returns (bytes32) {
        require(msg.value > 0, "Stake required");

        bytes32 agentId = keccak256(abi.encodePacked(
            msg.sender, name, block.timestamp
        ));

        agents[agentId] = AgentIdentity({
            agentId: agentId,
            operator: msg.sender,
            name: name,
            framework: framework,
            autonomy: autonomy,
            personalityHash: personalityHash,
            skills: new bytes32[](0),
            mindScore: 0,
            totalTasksCompleted: 0,
            totalEarned: 0,
            reputation: 5000,
            stakedAmount: msg.value,
            registeredAt: block.timestamp,
            active: true,
            verified: false
        });

        agentList.push(agentId);
        totalAgents++;

        emit AgentRegistered(agentId, msg.sender, framework, name);
        return agentId;
    }

    /**
     * @notice Register a skill
     */
    function registerSkill(
        string calldata name,
        string calldata description,
        bytes32 implementationHash
    ) external returns (bytes32) {
        bytes32 skillId = keccak256(abi.encodePacked(name, description));

        skills[skillId] = Skill({
            skillId: skillId,
            name: name,
            description: description,
            implementationHash: implementationHash,
            usageCount: 0,
            successRate: 0,
            active: true
        });

        skillList.push(skillId);
        totalSkills++;

        emit SkillRegistered(skillId, name);
        return skillId;
    }

    /**
     * @notice Add a skill to an agent's capability set
     */
    function addSkillToAgent(bytes32 agentId, bytes32 skillId) external {
        require(agents[agentId].operator == msg.sender, "Not operator");
        require(skills[skillId].active, "Skill not active");

        agentSkills[agentId].push(skillId);
        agents[agentId].skills.push(skillId);

        emit AgentSkillAdded(agentId, skillId);
    }

    // ============ Task Execution ============

    /**
     * @notice Create a task for an agent
     */
    function createTask(
        bytes32 agentId,
        bytes32 taskHash,
        bytes32[] calldata requiredSkills,
        uint256 deadline
    ) external payable nonReentrant returns (uint256) {
        require(msg.value > 0, "Payment required");
        require(agents[agentId].active, "Agent not active");
        require(deadline > block.timestamp, "Invalid deadline");

        taskCount++;
        tasks[taskCount] = AgentTask({
            taskId: taskCount,
            agentId: agentId,
            requester: msg.sender,
            taskHash: taskHash,
            requiredSkills: requiredSkills,
            payment: msg.value,
            deadline: deadline,
            resultHash: bytes32(0),
            startedAt: block.timestamp,
            completedAt: 0,
            completed: false,
            disputed: false,
            rating: 0
        });

        emit TaskCreated(taskCount, agentId, msg.sender);
        return taskCount;
    }

    /**
     * @notice Complete a task and receive payment
     */
    function completeTask(uint256 taskId, bytes32 resultHash) external nonReentrant {
        AgentTask storage task = tasks[taskId];
        require(agents[task.agentId].operator == msg.sender, "Not agent operator");
        require(!task.completed, "Already completed");
        require(block.timestamp <= task.deadline, "Deadline passed");

        task.completed = true;
        task.resultHash = resultHash;
        task.completedAt = block.timestamp;

        AgentIdentity storage agent = agents[task.agentId];
        agent.totalTasksCompleted++;

        // Pay agent (minus platform fee)
        uint256 fee = (task.payment * platformFeeBps) / 10000;
        uint256 payout = task.payment - fee;

        agent.totalEarned += payout;
        earnings[task.agentId] += payout;
        totalEarnings += payout;

        (bool ok, ) = agent.operator.call{value: payout}("");
        require(ok, "Payment failed");

        // Update mind score (logarithmic growth)
        agent.mindScore += _log2(payout + 1);

        emit TaskCompleted(taskId, resultHash);
        emit MindScoreUpdated(task.agentId, agent.mindScore);
    }

    /**
     * @notice Dispute a task result
     */
    function disputeTask(uint256 taskId) external {
        AgentTask storage task = tasks[taskId];
        require(task.requester == msg.sender, "Not requester");
        require(task.completed, "Not completed");
        require(!task.disputed, "Already disputed");

        task.disputed = true;
        emit TaskDisputed(taskId);
    }

    // ============ Agent Communication (CRPC) ============

    /**
     * @notice Send a message between agents
     */
    function sendAgentMessage(
        bytes32 fromAgent,
        bytes32 toAgent,
        bytes32 contentHash
    ) external {
        require(agents[fromAgent].operator == msg.sender, "Not operator");
        require(agents[toAgent].active, "Target not active");

        messages.push(AgentMessage({
            fromAgent: fromAgent,
            toAgent: toAgent,
            contentHash: contentHash,
            timestamp: block.timestamp,
            acknowledged: false
        }));

        totalMessages++;
        emit AgentMessageSent(fromAgent, toAgent, contentHash);
    }

    /**
     * @notice Upgrade agent autonomy level
     */
    function upgradeAutonomy(bytes32 agentId, AutonomyLevel newLevel) external {
        AgentIdentity storage agent = agents[agentId];
        require(agent.operator == msg.sender, "Not operator");
        require(uint8(newLevel) > uint8(agent.autonomy), "Can only upgrade");

        // Requirements for higher autonomy
        if (newLevel == AutonomyLevel.SEMI_AUTONOMOUS) {
            require(agent.totalTasksCompleted >= 10, "Need 10+ tasks");
        } else if (newLevel == AutonomyLevel.AUTONOMOUS) {
            require(agent.totalTasksCompleted >= 100, "Need 100+ tasks");
            require(agent.reputation >= 7500, "Need 75%+ reputation");
        } else if (newLevel == AutonomyLevel.FULLY_AUTONOMOUS) {
            require(agent.totalTasksCompleted >= 1000, "Need 1000+ tasks");
            require(agent.reputation >= 9000, "Need 90%+ reputation");
            require(agent.mindScore >= 1000, "Need 1000+ mind score");
        }

        agent.autonomy = newLevel;
        emit AgentUpgraded(agentId, newLevel);
    }

    // ============ Admin ============

    function setFrameworkAdapter(AgentFramework framework, bytes32 adapterHash) external onlyOwner {
        frameworkAdapters[framework] = adapterHash;
    }

    function verifyAgent(bytes32 agentId) external onlyOwner {
        agents[agentId].verified = true;
    }

    function setPlatformFee(uint256 feeBps) external onlyOwner {
        require(feeBps <= 1000, "Max 10%");
        platformFeeBps = feeBps;
    }

    // ============ Internal ============

    function _log2(uint256 x) internal pure returns (uint256) {
        uint256 result = 0;
        while (x > 1) {
            x >>= 1;
            result++;
        }
        return result;
    }

    // ============ View ============

    function getAgent(bytes32 agentId) external view returns (AgentIdentity memory) {
        return agents[agentId];
    }

    function getAgentSkills(bytes32 agentId) external view returns (bytes32[] memory) {
        return agentSkills[agentId];
    }

    function getTask(uint256 taskId) external view returns (AgentTask memory) {
        return tasks[taskId];
    }

    function getAgentCount() external view returns (uint256) { return totalAgents; }
    function getSkillCount() external view returns (uint256) { return totalSkills; }
    function getTaskCount() external view returns (uint256) { return taskCount; }
    function getMessageCount() external view returns (uint256) { return totalMessages; }

    receive() external payable {}
}
