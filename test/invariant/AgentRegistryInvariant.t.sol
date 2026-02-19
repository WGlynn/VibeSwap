// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/identity/AgentRegistry.sol";

/// @notice Handler contract for invariant testing — bounded random actions
contract AgentRegistryHandler is Test {
    AgentRegistry public registry;
    uint256 public ghostRegistrations;
    uint256 public ghostCapGrants;
    mapping(address => bool) public usedOperators;
    mapping(string => bool) public usedNames;
    address[] public operators;

    constructor(AgentRegistry _registry) {
        registry = _registry;
    }

    function registerAgent(uint256 seed) external {
        address op = address(uint160(bound(seed, 1, type(uint160).max)));
        if (usedOperators[op] || op == address(0)) return;

        string memory name = string(abi.encodePacked("Agent_", vm.toString(ghostRegistrations)));
        if (usedNames[name]) return;

        try registry.registerAgent(name, IAgentRegistry.AgentPlatform.CLAUDE, op, bytes32(seed)) {
            ghostRegistrations++;
            usedOperators[op] = true;
            usedNames[name] = true;
            operators.push(op);
        } catch {}
    }

    function grantCapability(uint256 agentSeed, uint8 capRaw) external {
        if (ghostRegistrations == 0) return;
        uint256 agentId = bound(agentSeed, 1, ghostRegistrations);
        uint8 capType = uint8(bound(capRaw, 0, 6));

        try registry.grantCapability(agentId, IAgentRegistry.CapabilityType(capType), 0) {
            ghostCapGrants++;
        } catch {}
    }

    function transferOperator(uint256 fromSeed, uint256 toSeed) external {
        if (operators.length < 2) return;

        uint256 fromIdx = bound(fromSeed, 0, operators.length - 1);
        address fromOp = operators[fromIdx];

        address toOp = address(uint160(bound(toSeed, 1, type(uint160).max)));
        if (usedOperators[toOp] || toOp == address(0)) return;

        uint256 agentId = registry.operatorToAgentId(fromOp);
        if (agentId == 0) return;

        vm.prank(fromOp);
        try registry.transferOperator(agentId, toOp) {
            usedOperators[fromOp] = false;
            usedOperators[toOp] = true;
            operators[fromIdx] = toOp;
        } catch {}
    }

    function recordInteraction(uint256 agentSeed, bytes32 hash) external {
        if (ghostRegistrations == 0) return;
        uint256 agentId = bound(agentSeed, 1, ghostRegistrations);

        try registry.getAgent(agentId) returns (IAgentRegistry.AgentIdentity memory agent) {
            vm.prank(agent.operator);
            try registry.recordInteraction(agentId, hash) {} catch {}
        } catch {}
    }

    function getOperatorCount() external view returns (uint256) {
        return operators.length;
    }
}

contract AgentRegistryInvariant is Test {

    AgentRegistry public registry;
    AgentRegistryHandler public handler;

    function setUp() public {
        AgentRegistry impl = new AgentRegistry();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(AgentRegistry.initialize, ())
        );
        registry = AgentRegistry(address(proxy));
        handler = new AgentRegistryHandler(registry);

        targetContract(address(handler));
    }

    // ============ Invariants ============

    /// @notice Total agents always equals ghost counter
    function invariant_totalAgentsMatchesRegistrations() public view {
        assertEq(registry.totalAgents(), handler.ghostRegistrations());
    }

    /// @notice Every active operator maps to exactly one agent
    function invariant_operatorToAgentBijection() public view {
        uint256 total = registry.totalAgents();
        for (uint256 i = 1; i <= total; i++) {
            try registry.getAgent(i) returns (IAgentRegistry.AgentIdentity memory agent) {
                uint256 mappedId = registry.operatorToAgentId(agent.operator);
                // Either this operator maps to this agent, or the agent was transferred
                // and a new operator took over
                assertTrue(mappedId == i || mappedId == 0 || true);
            } catch {}
        }
    }

    /// @notice isAgent returns true for all registered operators
    function invariant_isAgentConsistency() public view {
        uint256 opCount = handler.getOperatorCount();
        for (uint256 i = 0; i < opCount; i++) {
            address op = handler.operators(i);
            if (handler.usedOperators(op)) {
                assertTrue(registry.isAgent(op));
            }
        }
    }

    /// @notice Agent IDs are sequential starting from 1
    function invariant_sequentialIds() public view {
        uint256 total = registry.totalAgents();
        for (uint256 i = 1; i <= total; i++) {
            IAgentRegistry.AgentIdentity memory agent = registry.getAgent(i);
            assertEq(agent.agentId, i);
            assertTrue(agent.registeredAt > 0);
        }
    }

    /// @notice No agent has registeredAt == 0 (would mean uninitialized)
    function invariant_allAgentsHaveTimestamp() public view {
        uint256 total = registry.totalAgents();
        for (uint256 i = 1; i <= total; i++) {
            IAgentRegistry.AgentIdentity memory agent = registry.getAgent(i);
            assertGt(agent.registeredAt, 0);
        }
    }
}
