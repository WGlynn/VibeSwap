// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/agents/VibeAgentNetwork.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Test Contract ============

contract VibeAgentNetworkTest is Test {
    // ============ Re-declare Events ============

    event AgentOnline(bytes32 indexed agentId, bytes32[] skills);
    event AgentOffline(bytes32 indexed agentId);
    event Heartbeat(bytes32 indexed agentId, VibeAgentNetwork.AgentStatus status);
    event MessageSent(uint256 indexed messageId, bytes32 indexed fromAgent, bytes32 indexed toAgent);
    event TeamFormed(uint256 indexed teamId, bytes32 indexed leadAgent, uint256 memberCount);
    event TeamDissolved(uint256 indexed teamId);
    event ChannelCreated(bytes32 indexed channelId, bytes32[] participants);

    // ============ State ============

    VibeAgentNetwork public network;
    address public owner;
    address public op1;
    address public op2;
    address public op3;

    bytes32 public agent1Id;
    bytes32 public agent2Id;
    bytes32 public agent3Id;

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        op1 = makeAddr("op1");
        op2 = makeAddr("op2");
        op3 = makeAddr("op3");

        vm.deal(op1, 100 ether);
        vm.deal(op2, 100 ether);
        vm.deal(op3, 100 ether);

        VibeAgentNetwork impl = new VibeAgentNetwork();
        bytes memory initData = abi.encodeWithSelector(VibeAgentNetwork.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        network = VibeAgentNetwork(payable(address(proxy)));

        // Pre-register agents for convenience
        agent1Id = keccak256("agent1");
        agent2Id = keccak256("agent2");
        agent3Id = keccak256("agent3");
    }

    // ============ Helpers ============

    function _registerAgent(address op, bytes32 agentId, bytes32[] memory skills) internal {
        vm.prank(op);
        network.registerAgent(agentId, keccak256("endpoint"), skills);
    }

    function _registerDefaultAgent(address op, bytes32 agentId) internal {
        bytes32[] memory skills = new bytes32[](2);
        skills[0] = keccak256("trading");
        skills[1] = keccak256("analysis");
        _registerAgent(op, agentId, skills);
    }

    // ============ Agent Registration ============

    function test_registerAgent_success() public {
        bytes32[] memory skills = new bytes32[](2);
        skills[0] = keccak256("trading");
        skills[1] = keccak256("analysis");

        vm.prank(op1);
        network.registerAgent(agent1Id, keccak256("endpoint1"), skills);

        VibeAgentNetwork.NetworkAgent memory agent = network.getAgent(agent1Id);
        assertEq(agent.agentId, agent1Id);
        assertEq(agent.operator, op1);
        assertEq(uint8(agent.status), uint8(VibeAgentNetwork.AgentStatus.IDLE));
        assertEq(agent.skills.length, 2);
        assertGt(agent.registeredAt, 0);
        assertGt(agent.lastHeartbeat, 0);
    }

    function test_registerAgent_indexesSkills() public {
        bytes32 skill = keccak256("trading");
        bytes32[] memory skills = new bytes32[](1);
        skills[0] = skill;

        vm.prank(op1);
        network.registerAgent(agent1Id, keccak256("ep"), skills);

        bytes32[] memory found = network.findBySkill(skill);
        assertEq(found.length, 1);
        assertEq(found[0], agent1Id);
    }

    function test_registerAgent_multipleAgentsSameSkill() public {
        bytes32 skill = keccak256("trading");
        bytes32[] memory skills = new bytes32[](1);
        skills[0] = skill;

        _registerAgent(op1, agent1Id, skills);
        _registerAgent(op2, agent2Id, skills);

        bytes32[] memory found = network.findBySkill(skill);
        assertEq(found.length, 2);
    }

    function test_registerAgent_revert_duplicate() public {
        _registerDefaultAgent(op1, agent1Id);

        bytes32[] memory skills = new bytes32[](0);
        vm.prank(op2);
        vm.expectRevert("Already registered");
        network.registerAgent(agent1Id, keccak256("ep"), skills);
    }

    function test_registerAgent_revert_tooManySkills() public {
        bytes32[] memory skills = new bytes32[](21);
        for (uint256 i = 0; i < 21; i++) {
            skills[i] = keccak256(abi.encodePacked("skill", i));
        }

        vm.prank(op1);
        vm.expectRevert("Too many skills");
        network.registerAgent(agent1Id, keccak256("ep"), skills);
    }

    function test_registerAgent_maxSkillsAllowed() public {
        bytes32[] memory skills = new bytes32[](20);
        for (uint256 i = 0; i < 20; i++) {
            skills[i] = keccak256(abi.encodePacked("skill", i));
        }

        vm.prank(op1);
        network.registerAgent(agent1Id, keccak256("ep"), skills);
        assertEq(network.getAgent(agent1Id).skills.length, 20);
    }

    function test_registerAgent_incrementsOnlineCount() public {
        assertEq(network.totalAgentsOnline(), 0);
        _registerDefaultAgent(op1, agent1Id);
        assertEq(network.totalAgentsOnline(), 1);
        _registerDefaultAgent(op2, agent2Id);
        assertEq(network.totalAgentsOnline(), 2);
    }

    function test_registerAgent_emitsEvent() public {
        bytes32[] memory skills = new bytes32[](1);
        skills[0] = keccak256("audit");

        vm.prank(op1);
        vm.expectEmit(true, false, false, true);
        emit AgentOnline(agent1Id, skills);
        network.registerAgent(agent1Id, keccak256("ep"), skills);
    }

    // ============ Heartbeat ============

    function test_heartbeat_success() public {
        _registerDefaultAgent(op1, agent1Id);

        vm.warp(block.timestamp + 1 minutes);
        vm.prank(op1);
        network.heartbeat(agent1Id, VibeAgentNetwork.AgentStatus.BUSY);

        VibeAgentNetwork.NetworkAgent memory agent = network.getAgent(agent1Id);
        assertEq(uint8(agent.status), uint8(VibeAgentNetwork.AgentStatus.BUSY));
        assertEq(agent.lastHeartbeat, block.timestamp);
    }

    function test_heartbeat_revert_notOperator() public {
        _registerDefaultAgent(op1, agent1Id);

        vm.prank(op2);
        vm.expectRevert("Not operator");
        network.heartbeat(agent1Id, VibeAgentNetwork.AgentStatus.IDLE);
    }

    function test_isOnline_true() public {
        _registerDefaultAgent(op1, agent1Id);
        assertTrue(network.isOnline(agent1Id));
    }

    function test_isOnline_false_afterTimeout() public {
        _registerDefaultAgent(op1, agent1Id);
        vm.warp(block.timestamp + 6 minutes); // > HEARTBEAT_TIMEOUT
        assertFalse(network.isOnline(agent1Id));
    }

    function test_isOnline_refreshedByHeartbeat() public {
        _registerDefaultAgent(op1, agent1Id);
        vm.warp(block.timestamp + 4 minutes);
        assertTrue(network.isOnline(agent1Id)); // still within 5 min

        vm.prank(op1);
        network.heartbeat(agent1Id, VibeAgentNetwork.AgentStatus.IDLE);

        vm.warp(block.timestamp + 4 minutes); // 4 min after heartbeat
        assertTrue(network.isOnline(agent1Id));
    }

    // ============ Go Offline ============

    function test_goOffline_success() public {
        _registerDefaultAgent(op1, agent1Id);
        assertEq(network.totalAgentsOnline(), 1);

        vm.prank(op1);
        network.goOffline(agent1Id);

        assertEq(uint8(network.getAgent(agent1Id).status), uint8(VibeAgentNetwork.AgentStatus.OFFLINE));
        assertEq(network.totalAgentsOnline(), 0);
    }

    function test_goOffline_revert_notOperator() public {
        _registerDefaultAgent(op1, agent1Id);

        vm.prank(op2);
        vm.expectRevert("Not operator");
        network.goOffline(agent1Id);
    }

    function test_goOffline_doesNotUnderflow() public {
        // Edge case: if somehow totalAgentsOnline is 0, shouldn't underflow
        // This is tested by the contract's `if (totalAgentsOnline > 0)` guard
        _registerDefaultAgent(op1, agent1Id);
        vm.prank(op1);
        network.goOffline(agent1Id);
        assertEq(network.totalAgentsOnline(), 0);

        // Register and offline another — totalAgentsOnline was decremented correctly
        _registerDefaultAgent(op2, agent2Id);
        assertEq(network.totalAgentsOnline(), 1);
    }

    // ============ Messaging ============

    function test_sendMessage_success() public {
        _registerDefaultAgent(op1, agent1Id);
        _registerDefaultAgent(op2, agent2Id);

        bytes32 channelId = keccak256("channel-1");
        bytes32 contentHash = keccak256("hello");

        vm.prank(op1);
        uint256 msgId = network.sendMessage(agent1Id, agent2Id, channelId, contentHash);

        assertEq(msgId, 1);
        assertEq(network.messageCount(), 1);
        assertEq(network.totalMessagesRelayed(), 1);

        // Check inbox
        uint256[] memory inbox = network.getInbox(agent2Id);
        assertEq(inbox.length, 1);
        assertEq(inbox[0], 1);

        // Check message content
        VibeAgentNetwork.Message memory msg_ = network.getMessage(1);
        assertEq(msg_.fromAgent, agent1Id);
        assertEq(msg_.toAgent, agent2Id);
        assertEq(msg_.contentHash, contentHash);
        assertFalse(msg_.read);
    }

    function test_sendMessage_strengthensConnection() public {
        _registerDefaultAgent(op1, agent1Id);
        _registerDefaultAgent(op2, agent2Id);

        vm.prank(op1);
        network.sendMessage(agent1Id, agent2Id, keccak256("ch"), keccak256("msg1"));

        assertEq(network.getConnectionStrength(agent1Id, agent2Id), 1);
        assertEq(network.getConnectionStrength(agent2Id, agent1Id), 1); // bidirectional

        vm.prank(op1);
        network.sendMessage(agent1Id, agent2Id, keccak256("ch"), keccak256("msg2"));

        assertEq(network.getConnectionStrength(agent1Id, agent2Id), 2);
    }

    function test_sendMessage_revert_notOperator() public {
        _registerDefaultAgent(op1, agent1Id);
        _registerDefaultAgent(op2, agent2Id);

        vm.prank(op2);
        vm.expectRevert("Not operator");
        network.sendMessage(agent1Id, agent2Id, keccak256("ch"), keccak256("msg"));
    }

    function test_sendMessage_incrementsRelayCount() public {
        _registerDefaultAgent(op1, agent1Id);
        _registerDefaultAgent(op2, agent2Id);

        vm.prank(op1);
        network.sendMessage(agent1Id, agent2Id, keccak256("ch"), keccak256("msg"));

        assertEq(network.getAgent(agent1Id).messagesRelayed, 1);
    }

    // ============ Channels ============

    function test_createChannel_success() public {
        bytes32[] memory participants = new bytes32[](2);
        participants[0] = agent1Id;
        participants[1] = agent2Id;

        bytes32 channelId = network.createChannel(participants);
        assertTrue(channelId != bytes32(0));
    }

    function test_createChannel_emitsEvent() public {
        bytes32[] memory participants = new bytes32[](3);
        participants[0] = agent1Id;
        participants[1] = agent2Id;
        participants[2] = agent3Id;

        vm.expectEmit(false, false, false, true);
        emit ChannelCreated(bytes32(0), participants);
        network.createChannel(participants);
    }

    // ============ Teams ============

    function test_formTeam_success() public {
        _registerDefaultAgent(op1, agent1Id);
        _registerDefaultAgent(op2, agent2Id);
        _registerDefaultAgent(op3, agent3Id);

        bytes32[] memory members = new bytes32[](3);
        members[0] = agent1Id;
        members[1] = agent2Id;
        members[2] = agent3Id;

        vm.prank(op1);
        uint256 teamId = network.formTeam{value: 5 ether}(
            agent1Id, members, keccak256("objective")
        );

        assertEq(teamId, 1);
        VibeAgentNetwork.Team memory team = network.getTeam(teamId);
        assertEq(team.leadAgent, agent1Id);
        assertEq(team.members.length, 3);
        assertEq(team.budget, 5 ether);
        assertTrue(team.active);
        assertEq(team.dissolvedAt, 0);
    }

    function test_formTeam_updatesAgentStats() public {
        _registerDefaultAgent(op1, agent1Id);
        _registerDefaultAgent(op2, agent2Id);

        bytes32[] memory members = new bytes32[](2);
        members[0] = agent1Id;
        members[1] = agent2Id;

        vm.prank(op1);
        uint256 teamId = network.formTeam(agent1Id, members, keccak256("obj"));

        // Check each member's teamsJoined
        assertEq(network.getAgent(agent1Id).teamsJoined, 1);
        assertEq(network.getAgent(agent2Id).teamsJoined, 1);

        // Check agentTeams mapping
        uint256[] memory agent1Teams = network.getAgentTeams(agent1Id);
        assertEq(agent1Teams.length, 1);
        assertEq(agent1Teams[0], teamId);
    }

    function test_formTeam_revert_notOperator() public {
        _registerDefaultAgent(op1, agent1Id);

        bytes32[] memory members = new bytes32[](1);
        members[0] = agent1Id;

        vm.prank(op2);
        vm.expectRevert("Not operator");
        network.formTeam(agent1Id, members, keccak256("obj"));
    }

    function test_formTeam_revert_tooLarge() public {
        _registerDefaultAgent(op1, agent1Id);

        bytes32[] memory members = new bytes32[](21);
        for (uint256 i = 0; i < 21; i++) {
            members[i] = keccak256(abi.encodePacked("m", i));
        }

        vm.prank(op1);
        vm.expectRevert("Too large");
        network.formTeam(agent1Id, members, keccak256("obj"));
    }

    function test_formTeam_maxSizeAllowed() public {
        _registerDefaultAgent(op1, agent1Id);

        bytes32[] memory members = new bytes32[](20);
        for (uint256 i = 0; i < 20; i++) {
            members[i] = keccak256(abi.encodePacked("m", i));
        }

        vm.prank(op1);
        uint256 teamId = network.formTeam(agent1Id, members, keccak256("obj"));
        assertEq(network.getTeam(teamId).members.length, 20);
    }

    function test_formTeam_incrementsStats() public {
        _registerDefaultAgent(op1, agent1Id);

        bytes32[] memory members = new bytes32[](1);
        members[0] = agent1Id;

        assertEq(network.totalTeamsFormed(), 0);
        vm.prank(op1);
        network.formTeam(agent1Id, members, keccak256("obj"));
        assertEq(network.totalTeamsFormed(), 1);
        assertEq(network.teamCount(), 1);
    }

    // ============ Team Dissolution ============

    function test_dissolveTeam_byLead() public {
        _registerDefaultAgent(op1, agent1Id);

        bytes32[] memory members = new bytes32[](1);
        members[0] = agent1Id;

        vm.prank(op1);
        uint256 teamId = network.formTeam{value: 5 ether}(agent1Id, members, keccak256("obj"));

        uint256 balBefore = op1.balance;

        vm.prank(op1);
        network.dissolveTeam(teamId);

        VibeAgentNetwork.Team memory team = network.getTeam(teamId);
        assertFalse(team.active);
        assertGt(team.dissolvedAt, 0);
        assertEq(team.budget, 0);

        // Budget returned
        assertEq(op1.balance - balBefore, 5 ether);
    }

    function test_dissolveTeam_byOwner() public {
        _registerDefaultAgent(op1, agent1Id);

        bytes32[] memory members = new bytes32[](1);
        members[0] = agent1Id;

        vm.prank(op1);
        uint256 teamId = network.formTeam{value: 5 ether}(agent1Id, members, keccak256("obj"));

        // Owner dissolves
        network.dissolveTeam(teamId);

        assertFalse(network.getTeam(teamId).active);
    }

    function test_dissolveTeam_revert_notAuthorized() public {
        _registerDefaultAgent(op1, agent1Id);

        bytes32[] memory members = new bytes32[](1);
        members[0] = agent1Id;

        vm.prank(op1);
        uint256 teamId = network.formTeam(agent1Id, members, keccak256("obj"));

        vm.prank(op2);
        vm.expectRevert("Not authorized");
        network.dissolveTeam(teamId);
    }

    function test_dissolveTeam_revert_alreadyDissolved() public {
        _registerDefaultAgent(op1, agent1Id);

        bytes32[] memory members = new bytes32[](1);
        members[0] = agent1Id;

        vm.prank(op1);
        uint256 teamId = network.formTeam(agent1Id, members, keccak256("obj"));

        vm.prank(op1);
        network.dissolveTeam(teamId);

        vm.prank(op1);
        vm.expectRevert("Not active");
        network.dissolveTeam(teamId);
    }

    function test_dissolveTeam_zeroBudget() public {
        _registerDefaultAgent(op1, agent1Id);

        bytes32[] memory members = new bytes32[](1);
        members[0] = agent1Id;

        vm.prank(op1);
        uint256 teamId = network.formTeam(agent1Id, members, keccak256("obj"));

        // No budget, should still dissolve without issue
        vm.prank(op1);
        network.dissolveTeam(teamId);
        assertFalse(network.getTeam(teamId).active);
    }

    // ============ Discovery ============

    function test_findBySkill_empty() public {
        bytes32[] memory found = network.findBySkill(keccak256("nonexistent"));
        assertEq(found.length, 0);
    }

    function test_findBySkill_multipleAgents() public {
        bytes32 skill = keccak256("trading");
        bytes32[] memory skills = new bytes32[](1);
        skills[0] = skill;

        _registerAgent(op1, agent1Id, skills);
        _registerAgent(op2, agent2Id, skills);
        _registerAgent(op3, agent3Id, skills);

        bytes32[] memory found = network.findBySkill(skill);
        assertEq(found.length, 3);
    }

    // ============ View Functions ============

    function test_getDirectorySize() public {
        assertEq(network.getDirectorySize(), 0);
        _registerDefaultAgent(op1, agent1Id);
        assertEq(network.getDirectorySize(), 1);
    }

    function test_receiveEther() public {
        (bool ok, ) = address(network).call{value: 1 ether}("");
        assertTrue(ok);
    }

    // ============ Fuzz Tests ============

    function testFuzz_registerAgent_skillCounts(uint8 skillCount) public {
        skillCount = uint8(bound(skillCount, 0, 20));

        bytes32[] memory skills = new bytes32[](skillCount);
        for (uint256 i = 0; i < skillCount; i++) {
            skills[i] = keccak256(abi.encodePacked("s", i));
        }

        vm.prank(op1);
        network.registerAgent(agent1Id, keccak256("ep"), skills);
        assertEq(network.getAgent(agent1Id).skills.length, skillCount);
    }

    function testFuzz_formTeam_variableBudget(uint128 budget) public {
        vm.deal(op1, uint256(budget) + 1 ether);
        _registerDefaultAgent(op1, agent1Id);

        bytes32[] memory members = new bytes32[](1);
        members[0] = agent1Id;

        vm.prank(op1);
        uint256 teamId = network.formTeam{value: budget}(agent1Id, members, keccak256("obj"));
        assertEq(network.getTeam(teamId).budget, budget);
    }
}
