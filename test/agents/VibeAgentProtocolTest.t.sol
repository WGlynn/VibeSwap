// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/agents/VibeAgentProtocol.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Test Contract ============

contract VibeAgentProtocolTest is Test {
    // ============ Re-declare Events ============

    event AgentRegistered(bytes32 indexed agentId, address indexed operator, VibeAgentProtocol.AgentFramework framework, string name);
    event SkillRegistered(bytes32 indexed skillId, string name);
    event AgentSkillAdded(bytes32 indexed agentId, bytes32 indexed skillId);
    event TaskCreated(uint256 indexed taskId, bytes32 indexed agentId, address indexed requester);
    event TaskCompleted(uint256 indexed taskId, bytes32 resultHash);
    event TaskDisputed(uint256 indexed taskId);
    event AgentMessageSent(bytes32 indexed from, bytes32 indexed to, bytes32 contentHash);
    event AgentUpgraded(bytes32 indexed agentId, VibeAgentProtocol.AutonomyLevel newLevel);
    event MindScoreUpdated(bytes32 indexed agentId, uint256 newScore);

    // ============ State ============

    VibeAgentProtocol public protocol;
    address public owner;
    address public operator1;
    address public operator2;
    address public requester;

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        operator1 = makeAddr("operator1");
        operator2 = makeAddr("operator2");
        requester = makeAddr("requester");

        vm.deal(operator1, 100 ether);
        vm.deal(operator2, 100 ether);
        vm.deal(requester, 100 ether);

        // Deploy behind UUPS proxy
        VibeAgentProtocol impl = new VibeAgentProtocol();
        bytes memory initData = abi.encodeWithSelector(VibeAgentProtocol.initialize.selector);
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        protocol = VibeAgentProtocol(payable(address(proxy)));
    }

    // ============ Helper ============

    function _registerAgent(
        address op,
        string memory name,
        VibeAgentProtocol.AgentFramework framework,
        uint256 stake
    ) internal returns (bytes32 agentId) {
        vm.prank(op);
        agentId = protocol.registerAgent{value: stake}(
            name,
            framework,
            VibeAgentProtocol.AutonomyLevel.SUPERVISED,
            keccak256(bytes(name))
        );
    }

    function _registerSkill(string memory name, string memory desc) internal returns (bytes32 skillId) {
        skillId = protocol.registerSkill(name, desc, keccak256(bytes(desc)));
    }

    // ============ Agent Registration ============

    function test_registerAgent_success() public {
        vm.prank(operator1);
        bytes32 agentId = protocol.registerAgent{value: 1 ether}(
            "Jarvis",
            VibeAgentProtocol.AgentFramework.VSOS_NATIVE,
            VibeAgentProtocol.AutonomyLevel.SUPERVISED,
            keccak256("personality")
        );

        VibeAgentProtocol.AgentIdentity memory agent = protocol.getAgent(agentId);
        assertEq(agent.operator, operator1);
        assertEq(agent.name, "Jarvis");
        assertEq(uint8(agent.framework), uint8(VibeAgentProtocol.AgentFramework.VSOS_NATIVE));
        assertEq(uint8(agent.autonomy), uint8(VibeAgentProtocol.AutonomyLevel.SUPERVISED));
        assertEq(agent.stakedAmount, 1 ether);
        assertEq(agent.reputation, 5000);
        assertTrue(agent.active);
        assertFalse(agent.verified);
        assertEq(agent.totalTasksCompleted, 0);
        assertEq(agent.totalEarned, 0);
    }

    function test_registerAgent_emitsEvent() public {
        vm.prank(operator1);
        vm.expectEmit(false, true, false, true);
        emit AgentRegistered(bytes32(0), operator1, VibeAgentProtocol.AgentFramework.ANTHROPIC, "Claude");
        protocol.registerAgent{value: 1 ether}(
            "Claude",
            VibeAgentProtocol.AgentFramework.ANTHROPIC,
            VibeAgentProtocol.AutonomyLevel.SUPERVISED,
            keccak256("claude-personality")
        );
    }

    function test_registerAgent_incrementsTotalAgents() public {
        assertEq(protocol.totalAgents(), 0);
        _registerAgent(operator1, "Agent1", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        assertEq(protocol.totalAgents(), 1);
        _registerAgent(operator2, "Agent2", VibeAgentProtocol.AgentFramework.PAPERCLIP, 1 ether);
        assertEq(protocol.totalAgents(), 2);
    }

    function test_registerAgent_revert_zeroStake() public {
        vm.prank(operator1);
        vm.expectRevert("Stake required");
        protocol.registerAgent(
            "NoStake",
            VibeAgentProtocol.AgentFramework.VSOS_NATIVE,
            VibeAgentProtocol.AutonomyLevel.SUPERVISED,
            bytes32(0)
        );
    }

    function test_registerAgent_allFrameworks() public {
        for (uint8 i = 0; i <= uint8(VibeAgentProtocol.AgentFramework.CUSTOM); i++) {
            address op = makeAddr(string(abi.encodePacked("fw_op_", vm.toString(i))));
            vm.deal(op, 10 ether);
            bytes32 agentId = _registerAgent(
                op,
                string(abi.encodePacked("Agent_", vm.toString(i))),
                VibeAgentProtocol.AgentFramework(i),
                1 ether
            );
            VibeAgentProtocol.AgentIdentity memory agent = protocol.getAgent(agentId);
            assertEq(uint8(agent.framework), i);
        }
    }

    function test_registerAgent_multipleFromSameOperator() public {
        bytes32 id1 = _registerAgent(operator1, "Agent1", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        // Warp time so the keccak256 produces a different agentId
        vm.warp(block.timestamp + 1);
        bytes32 id2 = _registerAgent(operator1, "Agent2", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        assertTrue(id1 != id2);
        assertEq(protocol.totalAgents(), 2);
    }

    // ============ Skill Registration ============

    function test_registerSkill_success() public {
        bytes32 skillId = _registerSkill("Trading", "Autonomous trading capability");
        VibeAgentProtocol.Skill memory skill = protocol.getSkill(skillId);
        assertEq(skill.name, "Trading");
        assertEq(skill.description, "Autonomous trading capability");
        assertTrue(skill.active);
        assertEq(skill.usageCount, 0);
    }

    function test_registerSkill_emitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit SkillRegistered(bytes32(0), "Auditing");
        _registerSkill("Auditing", "Smart contract security audit");
    }

    function test_registerSkill_incrementsCount() public {
        assertEq(protocol.totalSkills(), 0);
        _registerSkill("Skill1", "desc1");
        assertEq(protocol.totalSkills(), 1);
        _registerSkill("Skill2", "desc2");
        assertEq(protocol.totalSkills(), 2);
    }

    // ============ Agent Skills ============

    function test_addSkillToAgent_success() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        bytes32 skillId = _registerSkill("Trading", "Trading skill");

        vm.prank(operator1);
        protocol.addSkillToAgent(agentId, skillId);

        bytes32[] memory skills = protocol.getAgentSkills(agentId);
        assertEq(skills.length, 1);
        assertEq(skills[0], skillId);
    }

    function test_addSkillToAgent_revert_notOperator() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        bytes32 skillId = _registerSkill("Trading", "Trading skill");

        vm.prank(operator2);
        vm.expectRevert("Not operator");
        protocol.addSkillToAgent(agentId, skillId);
    }

    function test_addSkillToAgent_revert_skillNotActive() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        bytes32 fakeSkill = keccak256("nonexistent");

        vm.prank(operator1);
        vm.expectRevert("Skill not active");
        protocol.addSkillToAgent(agentId, fakeSkill);
    }

    function test_addSkillToAgent_multiple() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        bytes32 s1 = _registerSkill("Trading", "Trading");
        bytes32 s2 = _registerSkill("Auditing", "Auditing");
        bytes32 s3 = _registerSkill("Memory", "Memory persistence");

        vm.startPrank(operator1);
        protocol.addSkillToAgent(agentId, s1);
        protocol.addSkillToAgent(agentId, s2);
        protocol.addSkillToAgent(agentId, s3);
        vm.stopPrank();

        bytes32[] memory skills = protocol.getAgentSkills(agentId);
        assertEq(skills.length, 3);
    }

    // ============ Task Creation ============

    function test_createTask_success() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        bytes32 taskHash = keccak256("analyze-portfolio");
        bytes32[] memory requiredSkills = new bytes32[](0);

        vm.prank(requester);
        uint256 taskId = protocol.createTask{value: 1 ether}(
            agentId, taskHash, requiredSkills, block.timestamp + 1 days
        );

        assertEq(taskId, 1);
        VibeAgentProtocol.AgentTask memory task = protocol.getTask(taskId);
        assertEq(task.agentId, agentId);
        assertEq(task.requester, requester);
        assertEq(task.payment, 1 ether);
        assertFalse(task.completed);
        assertFalse(task.disputed);
    }

    function test_createTask_emitsEvent() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        bytes32[] memory requiredSkills = new bytes32[](0);

        vm.prank(requester);
        vm.expectEmit(true, true, true, true);
        emit TaskCreated(1, agentId, requester);
        protocol.createTask{value: 1 ether}(agentId, keccak256("task"), requiredSkills, block.timestamp + 1 days);
    }

    function test_createTask_revert_zeroPayment() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        bytes32[] memory requiredSkills = new bytes32[](0);

        vm.prank(requester);
        vm.expectRevert("Payment required");
        protocol.createTask(agentId, keccak256("task"), requiredSkills, block.timestamp + 1 days);
    }

    function test_createTask_revert_inactiveAgent() public {
        bytes32 fakeAgent = keccak256("nonexistent");
        bytes32[] memory requiredSkills = new bytes32[](0);

        vm.prank(requester);
        vm.expectRevert("Agent not active");
        protocol.createTask{value: 1 ether}(fakeAgent, keccak256("task"), requiredSkills, block.timestamp + 1 days);
    }

    function test_createTask_revert_pastDeadline() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        bytes32[] memory requiredSkills = new bytes32[](0);

        vm.prank(requester);
        vm.expectRevert("Invalid deadline");
        protocol.createTask{value: 1 ether}(agentId, keccak256("task"), requiredSkills, block.timestamp - 1);
    }

    // ============ Task Completion & Payment ============

    function test_completeTask_success() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        bytes32[] memory requiredSkills = new bytes32[](0);

        vm.prank(requester);
        uint256 taskId = protocol.createTask{value: 10 ether}(
            agentId, keccak256("task"), requiredSkills, block.timestamp + 1 days
        );

        uint256 op1BalBefore = operator1.balance;
        bytes32 resultHash = keccak256("result");

        vm.prank(operator1);
        protocol.completeTask(taskId, resultHash);

        VibeAgentProtocol.AgentTask memory task = protocol.getTask(taskId);
        assertTrue(task.completed);
        assertEq(task.resultHash, resultHash);
        assertGt(task.completedAt, 0);

        // Check payment: 10 ether - 5% fee = 9.5 ether
        uint256 expectedPayout = 10 ether - (10 ether * 500 / 10000);
        assertEq(operator1.balance - op1BalBefore, expectedPayout);

        // Check agent stats updated
        VibeAgentProtocol.AgentIdentity memory agent = protocol.getAgent(agentId);
        assertEq(agent.totalTasksCompleted, 1);
        assertEq(agent.totalEarned, expectedPayout);
        assertGt(agent.mindScore, 0);
    }

    function test_completeTask_platformFeeAccumulates() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        bytes32[] memory requiredSkills = new bytes32[](0);

        vm.prank(requester);
        uint256 taskId = protocol.createTask{value: 10 ether}(
            agentId, keccak256("task"), requiredSkills, block.timestamp + 1 days
        );

        vm.prank(operator1);
        protocol.completeTask(taskId, keccak256("result"));

        // Fee stays in contract (10 ether * 5% = 0.5 ether)
        assertEq(address(protocol).balance, 0.5 ether + 1 ether); // fee + agent stake
    }

    function test_completeTask_revert_notOperator() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        bytes32[] memory requiredSkills = new bytes32[](0);

        vm.prank(requester);
        uint256 taskId = protocol.createTask{value: 1 ether}(
            agentId, keccak256("task"), requiredSkills, block.timestamp + 1 days
        );

        vm.prank(operator2);
        vm.expectRevert("Not agent operator");
        protocol.completeTask(taskId, keccak256("result"));
    }

    function test_completeTask_revert_alreadyCompleted() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        bytes32[] memory requiredSkills = new bytes32[](0);

        vm.prank(requester);
        uint256 taskId = protocol.createTask{value: 1 ether}(
            agentId, keccak256("task"), requiredSkills, block.timestamp + 1 days
        );

        vm.prank(operator1);
        protocol.completeTask(taskId, keccak256("result"));

        vm.prank(operator1);
        vm.expectRevert("Already completed");
        protocol.completeTask(taskId, keccak256("result2"));
    }

    function test_completeTask_revert_deadlinePassed() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        bytes32[] memory requiredSkills = new bytes32[](0);

        vm.prank(requester);
        uint256 taskId = protocol.createTask{value: 1 ether}(
            agentId, keccak256("task"), requiredSkills, block.timestamp + 1 days
        );

        vm.warp(block.timestamp + 2 days);

        vm.prank(operator1);
        vm.expectRevert("Deadline passed");
        protocol.completeTask(taskId, keccak256("result"));
    }

    function test_completeTask_updatesEarnings() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        bytes32[] memory requiredSkills = new bytes32[](0);

        vm.prank(requester);
        uint256 taskId = protocol.createTask{value: 10 ether}(
            agentId, keccak256("task"), requiredSkills, block.timestamp + 1 days
        );

        vm.prank(operator1);
        protocol.completeTask(taskId, keccak256("result"));

        uint256 expectedPayout = 10 ether - (10 ether * 500 / 10000);
        assertEq(protocol.earnings(agentId), expectedPayout);
        assertEq(protocol.totalEarnings(), expectedPayout);
    }

    // ============ Task Disputes ============

    function test_disputeTask_success() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        bytes32[] memory requiredSkills = new bytes32[](0);

        vm.prank(requester);
        uint256 taskId = protocol.createTask{value: 1 ether}(
            agentId, keccak256("task"), requiredSkills, block.timestamp + 1 days
        );

        vm.prank(operator1);
        protocol.completeTask(taskId, keccak256("result"));

        vm.prank(requester);
        protocol.disputeTask(taskId);

        VibeAgentProtocol.AgentTask memory task = protocol.getTask(taskId);
        assertTrue(task.disputed);
    }

    function test_disputeTask_revert_notRequester() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        bytes32[] memory requiredSkills = new bytes32[](0);

        vm.prank(requester);
        uint256 taskId = protocol.createTask{value: 1 ether}(
            agentId, keccak256("task"), requiredSkills, block.timestamp + 1 days
        );

        vm.prank(operator1);
        protocol.completeTask(taskId, keccak256("result"));

        vm.prank(operator1);
        vm.expectRevert("Not requester");
        protocol.disputeTask(taskId);
    }

    function test_disputeTask_revert_notCompleted() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        bytes32[] memory requiredSkills = new bytes32[](0);

        vm.prank(requester);
        uint256 taskId = protocol.createTask{value: 1 ether}(
            agentId, keccak256("task"), requiredSkills, block.timestamp + 1 days
        );

        vm.prank(requester);
        vm.expectRevert("Not completed");
        protocol.disputeTask(taskId);
    }

    function test_disputeTask_revert_alreadyDisputed() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        bytes32[] memory requiredSkills = new bytes32[](0);

        vm.prank(requester);
        uint256 taskId = protocol.createTask{value: 1 ether}(
            agentId, keccak256("task"), requiredSkills, block.timestamp + 1 days
        );

        vm.prank(operator1);
        protocol.completeTask(taskId, keccak256("result"));

        vm.prank(requester);
        protocol.disputeTask(taskId);

        vm.prank(requester);
        vm.expectRevert("Already disputed");
        protocol.disputeTask(taskId);
    }

    // ============ Agent Communication (CRPC) ============

    function test_sendAgentMessage_success() public {
        bytes32 agent1 = _registerAgent(operator1, "Agent1", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        vm.warp(block.timestamp + 1);
        bytes32 agent2 = _registerAgent(operator2, "Agent2", VibeAgentProtocol.AgentFramework.ANTHROPIC, 1 ether);

        bytes32 contentHash = keccak256("hello agent2");

        vm.prank(operator1);
        protocol.sendAgentMessage(agent1, agent2, contentHash);

        assertEq(protocol.totalMessages(), 1);
    }

    function test_sendAgentMessage_revert_notOperator() public {
        bytes32 agent1 = _registerAgent(operator1, "Agent1", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        vm.warp(block.timestamp + 1);
        bytes32 agent2 = _registerAgent(operator2, "Agent2", VibeAgentProtocol.AgentFramework.ANTHROPIC, 1 ether);

        vm.prank(operator2);
        vm.expectRevert("Not operator");
        protocol.sendAgentMessage(agent1, agent2, keccak256("msg"));
    }

    function test_sendAgentMessage_revert_targetNotActive() public {
        bytes32 agent1 = _registerAgent(operator1, "Agent1", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        bytes32 fakeAgent = keccak256("nonexistent");

        vm.prank(operator1);
        vm.expectRevert("Target not active");
        protocol.sendAgentMessage(agent1, fakeAgent, keccak256("msg"));
    }

    // ============ Autonomy Upgrades ============

    function test_upgradeAutonomy_toSemiAutonomous() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);

        // Complete 10 tasks to qualify
        bytes32[] memory requiredSkills = new bytes32[](0);
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(requester);
            uint256 tid = protocol.createTask{value: 0.1 ether}(
                agentId, keccak256(abi.encodePacked("task", i)), requiredSkills, block.timestamp + 1 days
            );
            vm.prank(operator1);
            protocol.completeTask(tid, keccak256(abi.encodePacked("result", i)));
        }

        vm.prank(operator1);
        protocol.upgradeAutonomy(agentId, VibeAgentProtocol.AutonomyLevel.SEMI_AUTONOMOUS);

        VibeAgentProtocol.AgentIdentity memory agent = protocol.getAgent(agentId);
        assertEq(uint8(agent.autonomy), uint8(VibeAgentProtocol.AutonomyLevel.SEMI_AUTONOMOUS));
    }

    function test_upgradeAutonomy_revert_notOperator() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);

        vm.prank(operator2);
        vm.expectRevert("Not operator");
        protocol.upgradeAutonomy(agentId, VibeAgentProtocol.AutonomyLevel.SEMI_AUTONOMOUS);
    }

    function test_upgradeAutonomy_revert_cannotDowngrade() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);

        // Complete 10 tasks first
        bytes32[] memory requiredSkills = new bytes32[](0);
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(requester);
            uint256 tid = protocol.createTask{value: 0.1 ether}(
                agentId, keccak256(abi.encodePacked("t", i)), requiredSkills, block.timestamp + 1 days
            );
            vm.prank(operator1);
            protocol.completeTask(tid, keccak256(abi.encodePacked("r", i)));
        }

        vm.prank(operator1);
        protocol.upgradeAutonomy(agentId, VibeAgentProtocol.AutonomyLevel.SEMI_AUTONOMOUS);

        vm.prank(operator1);
        vm.expectRevert("Can only upgrade");
        protocol.upgradeAutonomy(agentId, VibeAgentProtocol.AutonomyLevel.SUPERVISED);
    }

    function test_upgradeAutonomy_revert_insufficientTasks() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);

        // Only 5 tasks — need 10
        bytes32[] memory requiredSkills = new bytes32[](0);
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(requester);
            uint256 tid = protocol.createTask{value: 0.1 ether}(
                agentId, keccak256(abi.encodePacked("t", i)), requiredSkills, block.timestamp + 1 days
            );
            vm.prank(operator1);
            protocol.completeTask(tid, keccak256(abi.encodePacked("r", i)));
        }

        vm.prank(operator1);
        vm.expectRevert("Need 10+ tasks");
        protocol.upgradeAutonomy(agentId, VibeAgentProtocol.AutonomyLevel.SEMI_AUTONOMOUS);
    }

    // ============ Admin ============

    function test_setPlatformFee_success() public {
        protocol.setPlatformFee(300); // 3%
        assertEq(protocol.platformFeeBps(), 300);
    }

    function test_setPlatformFee_revert_tooHigh() public {
        vm.expectRevert("Max 10%");
        protocol.setPlatformFee(1001);
    }

    function test_setPlatformFee_revert_notOwner() public {
        vm.prank(operator1);
        vm.expectRevert();
        protocol.setPlatformFee(300);
    }

    function test_verifyAgent_success() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        assertFalse(protocol.getAgent(agentId).verified);

        protocol.verifyAgent(agentId);
        assertTrue(protocol.getAgent(agentId).verified);
    }

    function test_verifyAgent_revert_notOwner() public {
        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);

        vm.prank(operator1);
        vm.expectRevert();
        protocol.verifyAgent(agentId);
    }

    function test_setFrameworkAdapter_success() public {
        bytes32 adapter = keccak256("adapter-v1");
        protocol.setFrameworkAdapter(VibeAgentProtocol.AgentFramework.ANTHROPIC, adapter);
        assertEq(protocol.frameworkAdapters(VibeAgentProtocol.AgentFramework.ANTHROPIC), adapter);
    }

    // ============ View Functions ============

    function test_getAgentCount() public {
        assertEq(protocol.getAgentCount(), 0);
        _registerAgent(operator1, "A1", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        assertEq(protocol.getAgentCount(), 1);
    }

    function test_getSkillCount() public {
        assertEq(protocol.getSkillCount(), 0);
        _registerSkill("S1", "D1");
        assertEq(protocol.getSkillCount(), 1);
    }

    function test_getTaskCount() public {
        assertEq(protocol.getTaskCount(), 0);
    }

    function test_getMessageCount() public {
        assertEq(protocol.getMessageCount(), 0);
    }

    function test_receiveEther() public {
        (bool ok, ) = address(protocol).call{value: 1 ether}("");
        assertTrue(ok);
    }

    // ============ Fuzz Tests ============

    function testFuzz_registerAgent_variableStake(uint256 stake) public {
        stake = bound(stake, 1, 100 ether);
        vm.deal(operator1, stake);
        vm.prank(operator1);
        bytes32 agentId = protocol.registerAgent{value: stake}(
            "FuzzAgent",
            VibeAgentProtocol.AgentFramework.VSOS_NATIVE,
            VibeAgentProtocol.AutonomyLevel.SUPERVISED,
            keccak256("fuzz")
        );
        assertEq(protocol.getAgent(agentId).stakedAmount, stake);
    }

    function testFuzz_platformFee_correctPayout(uint256 payment, uint256 feeBps) public {
        payment = bound(payment, 0.01 ether, 50 ether);
        feeBps = bound(feeBps, 0, 1000);

        protocol.setPlatformFee(feeBps);

        bytes32 agentId = _registerAgent(operator1, "Jarvis", VibeAgentProtocol.AgentFramework.VSOS_NATIVE, 1 ether);
        bytes32[] memory requiredSkills = new bytes32[](0);

        vm.prank(requester);
        uint256 taskId = protocol.createTask{value: payment}(
            agentId, keccak256("task"), requiredSkills, block.timestamp + 1 days
        );

        uint256 balBefore = operator1.balance;
        vm.prank(operator1);
        protocol.completeTask(taskId, keccak256("result"));

        uint256 expectedFee = (payment * feeBps) / 10000;
        uint256 expectedPayout = payment - expectedFee;
        assertEq(operator1.balance - balBefore, expectedPayout);
    }
}
