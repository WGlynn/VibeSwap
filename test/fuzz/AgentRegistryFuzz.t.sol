// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/identity/AgentRegistry.sol";

contract AgentRegistryFuzz is Test {

    AgentRegistry public registry;
    address public owner = address(this);

    function setUp() public {
        AgentRegistry impl = new AgentRegistry();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(AgentRegistry.initialize, ())
        );
        registry = AgentRegistry(address(proxy));
    }

    // ============ Registration Fuzz ============

    function testFuzz_registerAgent_uniqueOperators(address operator, bytes32 modelHash) public {
        vm.assume(operator != address(0));
        vm.assume(operator != address(this)); // Avoid collision with test contract

        uint256 agentId = registry.registerAgent("Agent1", IAgentRegistry.AgentPlatform.CLAUDE, operator, modelHash);

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.operator, operator);
        assertEq(agent.modelHash, modelHash);
        assertEq(uint8(agent.platform), uint8(IAgentRegistry.AgentPlatform.CLAUDE));
        assertEq(uint8(agent.status), uint8(IAgentRegistry.AgentStatus.ACTIVE));
        assertTrue(registry.isAgent(operator));
    }

    function testFuzz_registerAgent_allPlatforms(uint8 platformRaw) public {
        // Bound to valid enum range
        uint8 platform = uint8(bound(platformRaw, 0, 5));
        address operator = address(uint160(platform) + 100);

        string memory name = string(abi.encodePacked("Agent_", vm.toString(platform)));

        uint256 agentId = registry.registerAgent(
            name,
            IAgentRegistry.AgentPlatform(platform),
            operator,
            bytes32(uint256(platform))
        );

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(uint8(agent.platform), platform);
    }

    // ============ Operator Transfer Fuzz ============

    function testFuzz_transferOperator(address op1, address op2) public {
        vm.assume(op1 != address(0) && op2 != address(0));
        vm.assume(op1 != op2);
        vm.assume(op1 != address(this) && op2 != address(this));

        uint256 agentId = registry.registerAgent("TransferTest", IAgentRegistry.AgentPlatform.CLAUDE, op1, bytes32(0));

        vm.prank(op1);
        registry.transferOperator(agentId, op2);

        assertFalse(registry.isAgent(op1));
        assertTrue(registry.isAgent(op2));

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.operator, op2);
    }

    // ============ Capability Fuzz ============

    function testFuzz_grantCapability_expiresAt(uint256 expiresAt) public {
        address operator = address(0xBEEF);
        uint256 agentId = registry.registerAgent("CapTest", IAgentRegistry.AgentPlatform.CLAUDE, operator, bytes32(0));

        registry.grantCapability(agentId, IAgentRegistry.CapabilityType.TRADE, expiresAt);

        if (expiresAt == 0 || expiresAt > block.timestamp) {
            assertTrue(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));
        } else {
            assertFalse(registry.hasCapability(agentId, IAgentRegistry.CapabilityType.TRADE));
        }
    }

    function testFuzz_grantCapability_allTypes(uint8 capRaw) public {
        uint8 capType = uint8(bound(capRaw, 0, 6)); // 7 capability types
        address operator = address(uint160(capType) + 200);

        string memory name = string(abi.encodePacked("CapAgent_", vm.toString(capType)));
        uint256 agentId = registry.registerAgent(name, IAgentRegistry.AgentPlatform.CLAUDE, operator, bytes32(0));

        registry.grantCapability(agentId, IAgentRegistry.CapabilityType(capType), 0);
        assertTrue(registry.hasCapability(agentId, IAgentRegistry.CapabilityType(capType)));
    }

    // ============ Interaction Tracking Fuzz ============

    function testFuzz_recordInteraction_countsUp(uint8 numInteractions) public {
        uint256 count = bound(numInteractions, 1, 50);
        address operator = address(0xCAFE);
        uint256 agentId = registry.registerAgent("InteractionTest", IAgentRegistry.AgentPlatform.CLAUDE, operator, bytes32(0));

        for (uint256 i = 0; i < count; i++) {
            vm.prank(operator);
            registry.recordInteraction(agentId, keccak256(abi.encodePacked(i)));
        }

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.totalInteractions, count);
    }

    // ============ Context Root Fuzz ============

    function testFuzz_updateContextRoot(bytes32 root1, bytes32 root2) public {
        address operator = address(0xDEAD);
        uint256 agentId = registry.registerAgent("ContextTest", IAgentRegistry.AgentPlatform.CLAUDE, operator, bytes32(0));

        vm.startPrank(operator);
        registry.updateContextRoot(agentId, root1);

        IAgentRegistry.AgentIdentity memory agent = registry.getAgent(agentId);
        assertEq(agent.contextRoot, root1);

        registry.updateContextRoot(agentId, root2);
        agent = registry.getAgent(agentId);
        assertEq(agent.contextRoot, root2);
        vm.stopPrank();
    }

    // ============ Sequential Registration Fuzz ============

    function testFuzz_multipleRegistrations_idsSequential(uint8 count) public {
        uint256 n = bound(count, 1, 20);

        for (uint256 i = 0; i < n; i++) {
            address op = address(uint160(i + 1000));
            string memory name = string(abi.encodePacked("SeqAgent_", vm.toString(i)));
            uint256 agentId = registry.registerAgent(name, IAgentRegistry.AgentPlatform.CLAUDE, op, bytes32(0));
            assertEq(agentId, i + 1);
        }

        assertEq(registry.totalAgents(), n);
    }

    // ============ Invariant: Agent count never decreases ============

    function testFuzz_totalAgents_neverDecreases(uint8 registrations, uint8 statusChanges) public {
        uint256 regCount = bound(registrations, 1, 10);

        for (uint256 i = 0; i < regCount; i++) {
            address op = address(uint160(i + 5000));
            string memory name = string(abi.encodePacked("InvAgent_", vm.toString(i)));
            registry.registerAgent(name, IAgentRegistry.AgentPlatform.CLAUDE, op, bytes32(0));
        }

        uint256 total = registry.totalAgents();
        assertEq(total, regCount);

        // Status changes don't affect total count
        uint256 changes = bound(statusChanges, 0, 5);
        for (uint256 i = 0; i < changes && i < regCount; i++) {
            address op = address(uint160(i + 5000));
            vm.prank(op);
            registry.setAgentStatus(i + 1, IAgentRegistry.AgentStatus.INACTIVE);
        }

        assertEq(registry.totalAgents(), total); // Unchanged
    }
}
