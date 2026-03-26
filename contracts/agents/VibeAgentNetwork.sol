// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeAgentNetwork — Decentralized Agent Communication & Discovery
 * @notice Agent-to-agent communication layer. Agents discover each other,
 *         form teams, negotiate tasks, and share context — all on-chain.
 *         Think of it as DNS + messaging + matchmaking for AI agents.
 *
 * @dev Architecture:
 *      - Agent discovery by skill, reputation, availability
 *      - Direct encrypted messaging between agents (CRPC channels)
 *      - Team formation with role assignments
 *      - Context sharing via anchored IPFS graphs
 *      - Heartbeat monitoring for liveness
 *      - Network topology tracking (who works with whom)
 */
contract VibeAgentNetwork is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum AgentStatus { OFFLINE, IDLE, BUSY, MAINTENANCE }

    struct NetworkAgent {
        bytes32 agentId;
        address operator;
        bytes32 endpointHash;        // IPFS hash of agent's API endpoint
        bytes32[] skills;
        AgentStatus status;
        uint256 reputation;
        uint256 lastHeartbeat;
        uint256 tasksCompleted;
        uint256 messagesRelayed;
        uint256 teamsJoined;
        uint256 registeredAt;
    }

    struct Team {
        uint256 teamId;
        bytes32 leadAgent;
        bytes32[] members;
        bytes32 objectiveHash;       // IPFS hash of team objective
        uint256 budget;
        uint256 formedAt;
        uint256 dissolvedAt;
        bool active;
    }

    struct Message {
        uint256 messageId;
        bytes32 fromAgent;
        bytes32 toAgent;
        bytes32 channelId;           // Conversation thread
        bytes32 contentHash;         // Encrypted content on IPFS
        uint256 timestamp;
        bool read;
    }

    struct Channel {
        bytes32 channelId;
        bytes32[] participants;
        uint256 messageCount;
        uint256 createdAt;
        bool active;
    }

    // ============ Constants ============

    uint256 public constant HEARTBEAT_TIMEOUT = 5 minutes;
    uint256 public constant MAX_TEAM_SIZE = 20;
    uint256 public constant MAX_SKILLS = 20;

    // ============ State ============

    mapping(bytes32 => NetworkAgent) public agents;
    bytes32[] public agentDirectory;

    mapping(uint256 => Team) public teams;
    uint256 public teamCount;

    mapping(uint256 => Message) public messages;
    uint256 public messageCount;

    mapping(bytes32 => Channel) public channels;

    /// @notice Skill index: skillHash => agentId[] (for discovery)
    mapping(bytes32 => bytes32[]) public skillIndex;

    /// @notice Agent inbox: agentId => messageId[]
    mapping(bytes32 => uint256[]) public inbox;

    /// @notice Agent teams: agentId => teamId[]
    mapping(bytes32 => uint256[]) public agentTeams;

    /// @notice Connection graph: agentId => agentId => interaction count
    mapping(bytes32 => mapping(bytes32 => uint256)) public connectionStrength;

    /// @notice Stats
    uint256 public totalAgentsOnline;
    uint256 public totalMessagesRelayed;
    uint256 public totalTeamsFormed;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event AgentOnline(bytes32 indexed agentId, bytes32[] skills);
    event AgentOffline(bytes32 indexed agentId);
    event Heartbeat(bytes32 indexed agentId, AgentStatus status);
    event MessageSent(uint256 indexed messageId, bytes32 indexed fromAgent, bytes32 indexed toAgent);
    event TeamFormed(uint256 indexed teamId, bytes32 indexed leadAgent, uint256 memberCount);
    event TeamDissolved(uint256 indexed teamId);
    event ChannelCreated(bytes32 indexed channelId, bytes32[] participants);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Agent Registration ============

    function registerAgent(
        bytes32 agentId,
        bytes32 endpointHash,
        bytes32[] calldata skills
    ) external {
        require(agents[agentId].registeredAt == 0, "Already registered");
        require(skills.length <= MAX_SKILLS, "Too many skills");

        NetworkAgent storage agent = agents[agentId];
        agent.agentId = agentId;
        agent.operator = msg.sender;
        agent.endpointHash = endpointHash;
        agent.skills = skills;
        agent.status = AgentStatus.IDLE;
        agent.lastHeartbeat = block.timestamp;
        agent.registeredAt = block.timestamp;

        agentDirectory.push(agentId);
        totalAgentsOnline++;

        // Index skills
        for (uint256 i = 0; i < skills.length; i++) {
            skillIndex[skills[i]].push(agentId);
        }

        emit AgentOnline(agentId, skills);
    }

    function heartbeat(bytes32 agentId, AgentStatus status) external {
        NetworkAgent storage agent = agents[agentId];
        require(agent.operator == msg.sender, "Not operator");

        agent.status = status;
        agent.lastHeartbeat = block.timestamp;

        emit Heartbeat(agentId, status);
    }

    function goOffline(bytes32 agentId) external {
        NetworkAgent storage agent = agents[agentId];
        require(agent.operator == msg.sender, "Not operator");

        agent.status = AgentStatus.OFFLINE;
        if (totalAgentsOnline > 0) totalAgentsOnline--;

        emit AgentOffline(agentId);
    }

    // ============ Messaging ============

    function sendMessage(
        bytes32 fromAgent,
        bytes32 toAgent,
        bytes32 channelId,
        bytes32 contentHash
    ) external returns (uint256) {
        require(agents[fromAgent].operator == msg.sender, "Not operator");

        messageCount++;
        messages[messageCount] = Message({
            messageId: messageCount,
            fromAgent: fromAgent,
            toAgent: toAgent,
            channelId: channelId,
            contentHash: contentHash,
            timestamp: block.timestamp,
            read: false
        });

        inbox[toAgent].push(messageCount);
        agents[fromAgent].messagesRelayed++;
        totalMessagesRelayed++;

        // Strengthen connection
        connectionStrength[fromAgent][toAgent]++;
        connectionStrength[toAgent][fromAgent]++;

        emit MessageSent(messageCount, fromAgent, toAgent);
        return messageCount;
    }

    function createChannel(bytes32[] calldata participants) external returns (bytes32) {
        bytes32 channelId = keccak256(abi.encodePacked(participants, block.timestamp));

        channels[channelId] = Channel({
            channelId: channelId,
            participants: participants,
            messageCount: 0,
            createdAt: block.timestamp,
            active: true
        });

        emit ChannelCreated(channelId, participants);
        return channelId;
    }

    // ============ Teams ============

    function formTeam(
        bytes32 leadAgent,
        bytes32[] calldata members,
        bytes32 objectiveHash
    ) external payable returns (uint256) {
        require(agents[leadAgent].operator == msg.sender, "Not operator");
        require(members.length <= MAX_TEAM_SIZE, "Too large");

        teamCount++;
        teams[teamCount] = Team({
            teamId: teamCount,
            leadAgent: leadAgent,
            members: members,
            objectiveHash: objectiveHash,
            budget: msg.value,
            formedAt: block.timestamp,
            dissolvedAt: 0,
            active: true
        });

        for (uint256 i = 0; i < members.length; i++) {
            agentTeams[members[i]].push(teamCount);
            agents[members[i]].teamsJoined++;
        }

        totalTeamsFormed++;

        emit TeamFormed(teamCount, leadAgent, members.length);
        return teamCount;
    }

    function dissolveTeam(uint256 teamId) external {
        Team storage team = teams[teamId];
        require(agents[team.leadAgent].operator == msg.sender || msg.sender == owner(), "Not authorized");
        require(team.active, "Not active");

        team.active = false;
        team.dissolvedAt = block.timestamp;

        // Return remaining budget
        if (team.budget > 0) {
            uint256 remaining = team.budget;
            team.budget = 0;
            (bool ok, ) = msg.sender.call{value: remaining}("");
            require(ok, "Refund failed");
        }

        emit TeamDissolved(teamId);
    }

    // ============ Discovery ============

    function findBySkill(bytes32 skill) external view returns (bytes32[] memory) {
        return skillIndex[skill];
    }

    function isOnline(bytes32 agentId) external view returns (bool) {
        return agents[agentId].status != AgentStatus.OFFLINE &&
               block.timestamp - agents[agentId].lastHeartbeat <= HEARTBEAT_TIMEOUT;
    }

    // ============ View ============

    function getAgent(bytes32 id) external view returns (NetworkAgent memory) { return agents[id]; }
    function getTeam(uint256 id) external view returns (Team memory) { return teams[id]; }
    function getMessage(uint256 id) external view returns (Message memory) { return messages[id]; }
    function getInbox(bytes32 agentId) external view returns (uint256[] memory) { return inbox[agentId]; }
    function getAgentTeams(bytes32 agentId) external view returns (uint256[] memory) { return agentTeams[agentId]; }
    function getConnectionStrength(bytes32 a, bytes32 b) external view returns (uint256) { return connectionStrength[a][b]; }
    function getDirectorySize() external view returns (uint256) { return agentDirectory.length; }

    receive() external payable {}
}
