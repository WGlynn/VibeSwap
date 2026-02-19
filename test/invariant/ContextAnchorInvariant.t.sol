// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/identity/ContextAnchor.sol";
import "../../contracts/identity/AgentRegistry.sol";

/// @notice Handler for ContextAnchor invariant testing
contract ContextAnchorHandler is Test {
    ContextAnchor public anchor;
    AgentRegistry public registry;

    uint256 public ghostGraphs;
    uint256 public ghostUpdates;
    bytes32[] public graphIds;

    address public operator = address(0xBEEF);
    uint256 public agentId;

    constructor(ContextAnchor _anchor, AgentRegistry _registry) {
        anchor = _anchor;
        registry = _registry;
        agentId = registry.registerAgent("InvAgent", IAgentRegistry.AgentPlatform.CLAUDE, operator, bytes32(0));
    }

    function createGraph(bytes32 rootSeed, bytes32 cidSeed) external {
        if (rootSeed == bytes32(0) || cidSeed == bytes32(0)) return;

        vm.prank(operator);
        try anchor.createGraph(
            agentId,
            IContextAnchor.GraphType.CONVERSATION,
            IContextAnchor.StorageBackend.IPFS,
            rootSeed, cidSeed, 1, 0
        ) returns (bytes32 graphId) {
            ghostGraphs++;
            graphIds.push(graphId);
        } catch {}
    }

    function updateGraph(uint256 graphSeed, bytes32 newRoot) external {
        if (graphIds.length == 0 || newRoot == bytes32(0)) return;
        uint256 idx = bound(graphSeed, 0, graphIds.length - 1);

        vm.prank(operator);
        try anchor.updateGraph(graphIds[idx], newRoot, keccak256(abi.encodePacked(newRoot)), 10, 5) {
            ghostUpdates++;
        } catch {}
    }

    function getGraphCount() external view returns (uint256) {
        return graphIds.length;
    }
}

contract ContextAnchorInvariant is Test {

    ContextAnchor public anchor;
    AgentRegistry public registry;
    ContextAnchorHandler public handler;

    function setUp() public {
        // Deploy AgentRegistry
        AgentRegistry regImpl = new AgentRegistry();
        ERC1967Proxy regProxy = new ERC1967Proxy(
            address(regImpl),
            abi.encodeCall(AgentRegistry.initialize, ())
        );
        registry = AgentRegistry(address(regProxy));

        // Deploy ContextAnchor
        ContextAnchor anchorImpl = new ContextAnchor();
        ERC1967Proxy anchorProxy = new ERC1967Proxy(
            address(anchorImpl),
            abi.encodeCall(ContextAnchor.initialize, (address(registry)))
        );
        anchor = ContextAnchor(address(anchorProxy));

        handler = new ContextAnchorHandler(anchor, registry);
        targetContract(address(handler));
    }

    // ============ Invariants ============

    /// @notice Total graphs matches ghost counter
    function invariant_totalGraphsMatchesGhost() public view {
        assertEq(anchor.totalGraphs(), handler.ghostGraphs());
    }

    /// @notice All graphs have non-zero creation timestamp
    function invariant_allGraphsHaveTimestamp() public view {
        uint256 count = handler.getGraphCount();
        for (uint256 i = 0; i < count; i++) {
            bytes32 graphId = handler.graphIds(i);
            IContextAnchor.ContextGraph memory g = anchor.getGraph(graphId);
            assertGt(g.createdAt, 0);
        }
    }

    /// @notice Graph version always >= 1
    function invariant_versionNeverZero() public view {
        uint256 count = handler.getGraphCount();
        for (uint256 i = 0; i < count; i++) {
            bytes32 graphId = handler.graphIds(i);
            IContextAnchor.ContextGraph memory g = anchor.getGraph(graphId);
            assertGe(g.version, 1);
        }
    }

    /// @notice All graphs have non-zero Merkle root
    function invariant_allGraphsHaveRoot() public view {
        uint256 count = handler.getGraphCount();
        for (uint256 i = 0; i < count; i++) {
            bytes32 graphId = handler.graphIds(i);
            IContextAnchor.ContextGraph memory g = anchor.getGraph(graphId);
            assertTrue(g.merkleRoot != bytes32(0));
        }
    }

    /// @notice Owner always has access to their own graphs
    function invariant_ownerAlwaysHasAccess() public view {
        uint256 count = handler.getGraphCount();
        for (uint256 i = 0; i < count; i++) {
            bytes32 graphId = handler.graphIds(i);
            assertTrue(anchor.hasAccess(graphId, handler.operator()));
        }
    }
}
