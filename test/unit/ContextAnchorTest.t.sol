// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/ContextAnchor.sol";
import "../../contracts/identity/interfaces/IAgentRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mock AgentRegistry ============

contract MockAgentRegistry {
    mapping(uint256 => IAgentRegistry.AgentIdentity) private _agents;
    mapping(uint256 => bool) private _exists;

    function setAgent(uint256 agentId, IAgentRegistry.AgentIdentity memory agent) external {
        _agents[agentId] = agent;
        _exists[agentId] = true;
    }

    function getAgent(uint256 agentId) external view returns (IAgentRegistry.AgentIdentity memory) {
        require(_exists[agentId], "Agent not found");
        return _agents[agentId];
    }
}

// ============ Test Contract ============

contract ContextAnchorTest is Test {
    // Re-declare events for expectEmit
    event GraphCreated(bytes32 indexed graphId, uint256 indexed ownerAgentId, address indexed ownerAddress, IContextAnchor.GraphType graphType);
    event GraphUpdated(bytes32 indexed graphId, bytes32 oldRoot, bytes32 newRoot, uint256 version);
    event GraphMerged(bytes32 indexed mergeId, bytes32 indexed sourceGraphId, bytes32 indexed targetGraphId, bytes32 resultRoot);
    event AccessGranted(bytes32 indexed graphId, address indexed grantee, uint256 granteeAgentId, bool canMerge);
    event AccessRevoked(bytes32 indexed graphId, address indexed grantee);
    event GraphArchived(bytes32 indexed graphId, bytes32 arweaveTxId);

    ContextAnchor public anchor;
    MockAgentRegistry public registry;

    address public owner;
    address public alice;
    address public bob;
    address public carol;
    address public operator;

    bytes32 constant MERKLE_ROOT = keccak256("merkleRoot");
    bytes32 constant CONTENT_CID = keccak256("contentCID");
    bytes32 constant NEW_ROOT = keccak256("newRoot");
    bytes32 constant NEW_CID = keccak256("newCID");
    bytes32 constant RESULT_ROOT = keccak256("resultRoot");
    bytes32 constant RESULT_CID = keccak256("resultCID");

    uint256 constant AGENT_ID = 1;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        operator = makeAddr("operator");

        registry = new MockAgentRegistry();

        // Deploy via UUPS proxy
        ContextAnchor impl = new ContextAnchor();
        bytes memory initData = abi.encodeWithSelector(ContextAnchor.initialize.selector, address(registry));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        anchor = ContextAnchor(address(proxy));

        // Set up a default agent with operator
        IAgentRegistry.AgentIdentity memory agent = IAgentRegistry.AgentIdentity({
            agentId: AGENT_ID,
            name: "JARVIS",
            platform: IAgentRegistry.AgentPlatform.CLAUDE,
            status: IAgentRegistry.AgentStatus.ACTIVE,
            operator: operator,
            creator: alice,
            contextRoot: bytes32(0),
            modelHash: keccak256("claude-opus"),
            registeredAt: block.timestamp,
            lastActiveAt: block.timestamp,
            totalInteractions: 0
        });
        registry.setAgent(AGENT_ID, agent);
    }

    // ============ Helpers ============

    /// @dev Create a human-owned graph as msg.sender
    function _createHumanGraph(address user) internal returns (bytes32 graphId) {
        vm.prank(user);
        graphId = anchor.createGraph(
            0,
            IContextAnchor.GraphType.CONVERSATION,
            IContextAnchor.StorageBackend.IPFS,
            MERKLE_ROOT,
            CONTENT_CID,
            10,
            5
        );
    }

    /// @dev Create an agent-owned graph (must be called by operator)
    function _createAgentGraph() internal returns (bytes32 graphId) {
        vm.prank(operator);
        graphId = anchor.createGraph(
            AGENT_ID,
            IContextAnchor.GraphType.KNOWLEDGE,
            IContextAnchor.StorageBackend.IPFS,
            MERKLE_ROOT,
            CONTENT_CID,
            20,
            15
        );
    }

    // ============ Initialization ============

    function test_initialize_SetsOwner() public view {
        assertEq(anchor.owner(), owner);
    }

    function test_initialize_SetsAgentRegistry() public view {
        assertEq(address(anchor.agentRegistry()), address(registry));
    }

    function test_initialize_TotalGraphsZero() public view {
        assertEq(anchor.totalGraphs(), 0);
    }

    // ============ createGraph — Human-Owned ============

    function test_createGraph_HumanOwned_Success() public {
        bytes32 graphId = _createHumanGraph(alice);

        assertTrue(graphId != bytes32(0));
        assertEq(anchor.totalGraphs(), 1);

        IContextAnchor.ContextGraph memory g = anchor.getGraph(graphId);
        assertEq(g.graphId, graphId);
        assertEq(g.ownerAgentId, 0);
        assertEq(g.ownerAddress, alice);
        assertEq(uint256(g.graphType), uint256(IContextAnchor.GraphType.CONVERSATION));
        assertEq(uint256(g.backend), uint256(IContextAnchor.StorageBackend.IPFS));
        assertEq(g.merkleRoot, MERKLE_ROOT);
        assertEq(g.contentCID, CONTENT_CID);
        assertEq(g.nodeCount, 10);
        assertEq(g.edgeCount, 5);
        assertEq(g.version, 1);
        assertEq(g.createdAt, block.timestamp);
        assertEq(g.lastUpdatedAt, block.timestamp);
    }

    function test_createGraph_HumanOwned_EmitsGraphCreated() public {
        vm.expectEmit(false, true, true, true);
        emit GraphCreated(bytes32(0), 0, alice, IContextAnchor.GraphType.CONVERSATION);

        vm.prank(alice);
        anchor.createGraph(
            0,
            IContextAnchor.GraphType.CONVERSATION,
            IContextAnchor.StorageBackend.IPFS,
            MERKLE_ROOT,
            CONTENT_CID,
            10,
            5
        );
    }

    function test_createGraph_HumanOwned_TrackedByOwner() public {
        bytes32 graphId = _createHumanGraph(alice);
        bytes32[] memory graphs = anchor.getGraphsByOwner(alice);
        assertEq(graphs.length, 1);
        assertEq(graphs[0], graphId);
    }

    function test_createGraph_HumanOwned_NotTrackedByAgent() public {
        _createHumanGraph(alice);
        bytes32[] memory graphs = anchor.getGraphsByAgent(0);
        assertEq(graphs.length, 0);
    }

    function test_createGraph_MultipleGraphs_IncrementsTotalGraphs() public {
        _createHumanGraph(alice);
        _createHumanGraph(bob);
        _createHumanGraph(alice);
        assertEq(anchor.totalGraphs(), 3);
    }

    function test_createGraph_MultipleByOwner_AllTracked() public {
        bytes32 g1 = _createHumanGraph(alice);
        bytes32 g2 = _createHumanGraph(alice);
        bytes32[] memory graphs = anchor.getGraphsByOwner(alice);
        assertEq(graphs.length, 2);
        assertEq(graphs[0], g1);
        assertEq(graphs[1], g2);
    }

    // ============ createGraph — Agent-Owned ============

    function test_createGraph_AgentOwned_Success() public {
        bytes32 graphId = _createAgentGraph();

        IContextAnchor.ContextGraph memory g = anchor.getGraph(graphId);
        assertEq(g.ownerAgentId, AGENT_ID);
        assertEq(g.ownerAddress, operator);
        assertEq(uint256(g.graphType), uint256(IContextAnchor.GraphType.KNOWLEDGE));
        assertEq(g.version, 1);
    }

    function test_createGraph_AgentOwned_TrackedByAgent() public {
        bytes32 graphId = _createAgentGraph();
        bytes32[] memory graphs = anchor.getGraphsByAgent(AGENT_ID);
        assertEq(graphs.length, 1);
        assertEq(graphs[0], graphId);
    }

    function test_createGraph_AgentOwned_TrackedByOperatorAddress() public {
        bytes32 graphId = _createAgentGraph();
        bytes32[] memory graphs = anchor.getGraphsByOwner(operator);
        assertEq(graphs.length, 1);
        assertEq(graphs[0], graphId);
    }

    function test_createGraph_AgentOwned_NotOperator_Reverts() public {
        vm.prank(alice); // alice is not the operator
        vm.expectRevert("Not agent operator");
        anchor.createGraph(
            AGENT_ID,
            IContextAnchor.GraphType.KNOWLEDGE,
            IContextAnchor.StorageBackend.IPFS,
            MERKLE_ROOT,
            CONTENT_CID,
            20,
            15
        );
    }

    // ============ createGraph — Reverts ============

    function test_createGraph_ZeroMerkleRoot_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(IContextAnchor.ZeroRoot.selector);
        anchor.createGraph(
            0,
            IContextAnchor.GraphType.CONVERSATION,
            IContextAnchor.StorageBackend.IPFS,
            bytes32(0),
            CONTENT_CID,
            10,
            5
        );
    }

    function test_createGraph_ZeroContentCID_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(IContextAnchor.ZeroCID.selector);
        anchor.createGraph(
            0,
            IContextAnchor.GraphType.CONVERSATION,
            IContextAnchor.StorageBackend.IPFS,
            MERKLE_ROOT,
            bytes32(0),
            10,
            5
        );
    }

    // ============ updateGraph — By Owner ============

    function test_updateGraph_ByOwner_Success() public {
        bytes32 graphId = _createHumanGraph(alice);

        vm.warp(block.timestamp + 100);

        vm.prank(alice);
        anchor.updateGraph(graphId, NEW_ROOT, NEW_CID, 25, 18);

        IContextAnchor.ContextGraph memory g = anchor.getGraph(graphId);
        assertEq(g.merkleRoot, NEW_ROOT);
        assertEq(g.contentCID, NEW_CID);
        assertEq(g.nodeCount, 25);
        assertEq(g.edgeCount, 18);
        assertEq(g.version, 2);
        assertEq(g.lastUpdatedAt, block.timestamp);
    }

    function test_updateGraph_ByOwner_EmitsGraphUpdated() public {
        bytes32 graphId = _createHumanGraph(alice);

        vm.expectEmit(true, false, false, true);
        emit GraphUpdated(graphId, MERKLE_ROOT, NEW_ROOT, 2);

        vm.prank(alice);
        anchor.updateGraph(graphId, NEW_ROOT, NEW_CID, 25, 18);
    }

    function test_updateGraph_ByOwner_IncrementsVersion() public {
        bytes32 graphId = _createHumanGraph(alice);

        vm.prank(alice);
        anchor.updateGraph(graphId, NEW_ROOT, NEW_CID, 25, 18);
        assertEq(anchor.getGraph(graphId).version, 2);

        vm.prank(alice);
        anchor.updateGraph(graphId, keccak256("third"), NEW_CID, 30, 20);
        assertEq(anchor.getGraph(graphId).version, 3);
    }

    // ============ updateGraph — By Agent Operator ============

    function test_updateGraph_ByAgentOperator_Success() public {
        bytes32 graphId = _createAgentGraph();

        vm.prank(operator);
        anchor.updateGraph(graphId, NEW_ROOT, NEW_CID, 30, 20);

        IContextAnchor.ContextGraph memory g = anchor.getGraph(graphId);
        assertEq(g.merkleRoot, NEW_ROOT);
        assertEq(g.version, 2);
    }

    // ============ updateGraph — By Contract Owner (admin) ============

    function test_updateGraph_ByContractOwner_Success() public {
        bytes32 graphId = _createHumanGraph(alice);

        // Contract owner (address(this)) can update any graph
        anchor.updateGraph(graphId, NEW_ROOT, NEW_CID, 30, 20);

        IContextAnchor.ContextGraph memory g = anchor.getGraph(graphId);
        assertEq(g.merkleRoot, NEW_ROOT);
    }

    // ============ updateGraph — Reverts ============

    function test_updateGraph_NotOwner_Reverts() public {
        bytes32 graphId = _createHumanGraph(alice);

        vm.prank(bob);
        vm.expectRevert(IContextAnchor.NotGraphOwner.selector);
        anchor.updateGraph(graphId, NEW_ROOT, NEW_CID, 25, 18);
    }

    function test_updateGraph_NonExistentGraph_Reverts() public {
        bytes32 fakeId = keccak256("fake");

        vm.expectRevert(IContextAnchor.GraphNotFound.selector);
        anchor.updateGraph(fakeId, NEW_ROOT, NEW_CID, 25, 18);
    }

    function test_updateGraph_ZeroMerkleRoot_Reverts() public {
        bytes32 graphId = _createHumanGraph(alice);

        vm.prank(alice);
        vm.expectRevert(IContextAnchor.ZeroRoot.selector);
        anchor.updateGraph(graphId, bytes32(0), NEW_CID, 25, 18);
    }

    // ============ mergeGraphs — By Target Owner ============

    function test_mergeGraphs_ByTargetOwner_Success() public {
        bytes32 sourceId = _createHumanGraph(alice);
        bytes32 targetId = _createHumanGraph(bob);

        vm.prank(bob);
        bytes32 mergeId = anchor.mergeGraphs(
            sourceId,
            targetId,
            RESULT_ROOT,
            RESULT_CID,
            5,
            2
        );

        assertTrue(mergeId != bytes32(0));

        // Target graph should be updated
        IContextAnchor.ContextGraph memory g = anchor.getGraph(targetId);
        assertEq(g.merkleRoot, RESULT_ROOT);
        assertEq(g.contentCID, RESULT_CID);
        assertEq(g.nodeCount, 15); // original 10 + 5 nodesAdded
        assertEq(g.version, 2);
    }

    function test_mergeGraphs_ByTargetOwner_EmitsGraphMerged() public {
        bytes32 sourceId = _createHumanGraph(alice);
        bytes32 targetId = _createHumanGraph(bob);

        vm.expectEmit(false, true, true, true);
        emit GraphMerged(bytes32(0), sourceId, targetId, RESULT_ROOT);

        vm.prank(bob);
        anchor.mergeGraphs(sourceId, targetId, RESULT_ROOT, RESULT_CID, 5, 2);
    }

    function test_mergeGraphs_ByTargetOwner_RecordsMergeHistory() public {
        bytes32 sourceId = _createHumanGraph(alice);
        bytes32 targetId = _createHumanGraph(bob);

        vm.prank(bob);
        bytes32 mergeId = anchor.mergeGraphs(sourceId, targetId, RESULT_ROOT, RESULT_CID, 5, 2);

        IContextAnchor.MergeRecord[] memory history = anchor.getMergeHistory(targetId);
        assertEq(history.length, 1);
        assertEq(history[0].mergeId, mergeId);
        assertEq(history[0].sourceGraphId, sourceId);
        assertEq(history[0].targetGraphId, targetId);
        assertEq(history[0].resultRoot, RESULT_ROOT);
        assertEq(history[0].mergedBy, bob);
        assertEq(history[0].nodesAdded, 5);
        assertEq(history[0].conflictsResolved, 2);
    }

    function test_mergeGraphs_IncrementsTargetVersion() public {
        bytes32 sourceId = _createHumanGraph(alice);
        bytes32 targetId = _createHumanGraph(bob);

        assertEq(anchor.getGraph(targetId).version, 1);

        vm.prank(bob);
        anchor.mergeGraphs(sourceId, targetId, RESULT_ROOT, RESULT_CID, 5, 2);

        assertEq(anchor.getGraph(targetId).version, 2);
    }

    // ============ mergeGraphs — By Access-Granted User ============

    function test_mergeGraphs_ByAccessGrantedUser_WithMergePermission_Success() public {
        bytes32 sourceId = _createHumanGraph(alice);
        bytes32 targetId = _createHumanGraph(bob);

        // Bob grants carol merge access to his graph
        vm.prank(bob);
        anchor.grantAccess(targetId, carol, 0, true, 0);

        // Carol can now merge into Bob's graph
        vm.prank(carol);
        bytes32 mergeId = anchor.mergeGraphs(sourceId, targetId, RESULT_ROOT, RESULT_CID, 3, 1);

        assertTrue(mergeId != bytes32(0));
        assertEq(anchor.getGraph(targetId).merkleRoot, RESULT_ROOT);
    }

    function test_mergeGraphs_ByAccessGrantedUser_WithoutMergePermission_Reverts() public {
        bytes32 sourceId = _createHumanGraph(alice);
        bytes32 targetId = _createHumanGraph(bob);

        // Bob grants carol read-only access (canMerge = false)
        vm.prank(bob);
        anchor.grantAccess(targetId, carol, 0, false, 0);

        vm.prank(carol);
        vm.expectRevert(IContextAnchor.MergeNotAllowed.selector);
        anchor.mergeGraphs(sourceId, targetId, RESULT_ROOT, RESULT_CID, 3, 1);
    }

    function test_mergeGraphs_ByAccessGrantedUser_Expired_Reverts() public {
        bytes32 sourceId = _createHumanGraph(alice);
        bytes32 targetId = _createHumanGraph(bob);

        uint256 expiry = block.timestamp + 100;
        vm.prank(bob);
        anchor.grantAccess(targetId, carol, 0, true, expiry);

        // Fast-forward past expiry
        vm.warp(expiry + 1);

        vm.prank(carol);
        vm.expectRevert(IContextAnchor.MergeNotAllowed.selector);
        anchor.mergeGraphs(sourceId, targetId, RESULT_ROOT, RESULT_CID, 3, 1);
    }

    // ============ mergeGraphs — By Agent Operator ============

    function test_mergeGraphs_ByAgentOperator_Success() public {
        bytes32 sourceId = _createHumanGraph(alice);
        bytes32 targetId = _createAgentGraph(); // owned by agent, operator = operator

        vm.prank(operator);
        bytes32 mergeId = anchor.mergeGraphs(sourceId, targetId, RESULT_ROOT, RESULT_CID, 5, 0);

        assertTrue(mergeId != bytes32(0));
    }

    // ============ mergeGraphs — By Contract Owner (admin) ============

    function test_mergeGraphs_ByContractOwner_Success() public {
        bytes32 sourceId = _createHumanGraph(alice);
        bytes32 targetId = _createHumanGraph(bob);

        // Contract owner can merge anything
        bytes32 mergeId = anchor.mergeGraphs(sourceId, targetId, RESULT_ROOT, RESULT_CID, 5, 0);
        assertTrue(mergeId != bytes32(0));
    }

    // ============ mergeGraphs — Reverts ============

    function test_mergeGraphs_Unauthorized_Reverts() public {
        bytes32 sourceId = _createHumanGraph(alice);
        bytes32 targetId = _createHumanGraph(bob);

        vm.prank(carol);
        vm.expectRevert(IContextAnchor.MergeNotAllowed.selector);
        anchor.mergeGraphs(sourceId, targetId, RESULT_ROOT, RESULT_CID, 5, 2);
    }

    function test_mergeGraphs_SourceNotFound_Reverts() public {
        bytes32 targetId = _createHumanGraph(bob);

        vm.prank(bob);
        vm.expectRevert(IContextAnchor.GraphNotFound.selector);
        anchor.mergeGraphs(keccak256("nonexistent"), targetId, RESULT_ROOT, RESULT_CID, 5, 2);
    }

    function test_mergeGraphs_TargetNotFound_Reverts() public {
        bytes32 sourceId = _createHumanGraph(alice);

        vm.prank(bob);
        vm.expectRevert(IContextAnchor.GraphNotFound.selector);
        anchor.mergeGraphs(sourceId, keccak256("nonexistent"), RESULT_ROOT, RESULT_CID, 5, 2);
    }

    function test_mergeGraphs_RevokedAccess_Reverts() public {
        bytes32 sourceId = _createHumanGraph(alice);
        bytes32 targetId = _createHumanGraph(bob);

        vm.prank(bob);
        anchor.grantAccess(targetId, carol, 0, true, 0);

        vm.prank(bob);
        anchor.revokeAccess(targetId, carol);

        vm.prank(carol);
        vm.expectRevert(IContextAnchor.MergeNotAllowed.selector);
        anchor.mergeGraphs(sourceId, targetId, RESULT_ROOT, RESULT_CID, 3, 1);
    }

    // ============ archiveGraph ============

    function test_archiveGraph_ByOwner_Success() public {
        bytes32 graphId = _createHumanGraph(alice);
        bytes32 arweaveTxId = keccak256("arweave-tx-123");

        vm.prank(alice);
        anchor.archiveGraph(graphId, arweaveTxId);

        IContextAnchor.ContextGraph memory g = anchor.getGraph(graphId);
        assertEq(uint256(g.backend), uint256(IContextAnchor.StorageBackend.HYBRID));
        assertEq(uint256(g.graphType), uint256(IContextAnchor.GraphType.ARCHIVE));
    }

    function test_archiveGraph_EmitsGraphArchived() public {
        bytes32 graphId = _createHumanGraph(alice);
        bytes32 arweaveTxId = keccak256("arweave-tx-123");

        vm.expectEmit(true, false, false, true);
        emit GraphArchived(graphId, arweaveTxId);

        vm.prank(alice);
        anchor.archiveGraph(graphId, arweaveTxId);
    }

    function test_archiveGraph_NotOwner_Reverts() public {
        bytes32 graphId = _createHumanGraph(alice);

        vm.prank(bob);
        vm.expectRevert(IContextAnchor.NotGraphOwner.selector);
        anchor.archiveGraph(graphId, keccak256("arweave"));
    }

    function test_archiveGraph_ByAgentOperator_Success() public {
        bytes32 graphId = _createAgentGraph();

        vm.prank(operator);
        anchor.archiveGraph(graphId, keccak256("arweave"));

        IContextAnchor.ContextGraph memory g = anchor.getGraph(graphId);
        assertEq(uint256(g.graphType), uint256(IContextAnchor.GraphType.ARCHIVE));
        assertEq(uint256(g.backend), uint256(IContextAnchor.StorageBackend.HYBRID));
    }

    // ============ grantAccess ============

    function test_grantAccess_Success() public {
        bytes32 graphId = _createHumanGraph(alice);

        vm.prank(alice);
        anchor.grantAccess(graphId, bob, 0, true, 0);

        assertTrue(anchor.hasAccess(graphId, bob));
    }

    function test_grantAccess_WithAgentId() public {
        bytes32 graphId = _createHumanGraph(alice);
        uint256 granteeAgentId = 42;

        vm.prank(alice);
        anchor.grantAccess(graphId, bob, granteeAgentId, false, 0);

        IContextAnchor.AccessGrant[] memory grants = anchor.getAccessGrants(graphId);
        assertEq(grants.length, 1);
        assertEq(grants[0].grantee, bob);
        assertEq(grants[0].granteeAgentId, granteeAgentId);
        assertFalse(grants[0].canMerge);
        assertFalse(grants[0].revoked);
    }

    function test_grantAccess_WithExpiry() public {
        bytes32 graphId = _createHumanGraph(alice);
        uint256 expiry = block.timestamp + 1 days;

        vm.prank(alice);
        anchor.grantAccess(graphId, bob, 0, true, expiry);

        // Before expiry — has access
        assertTrue(anchor.hasAccess(graphId, bob));

        // After expiry — no access
        vm.warp(expiry);
        assertFalse(anchor.hasAccess(graphId, bob));
    }

    function test_grantAccess_EmitsAccessGranted() public {
        bytes32 graphId = _createHumanGraph(alice);

        vm.expectEmit(true, true, false, true);
        emit AccessGranted(graphId, bob, 0, true);

        vm.prank(alice);
        anchor.grantAccess(graphId, bob, 0, true, 0);
    }

    function test_grantAccess_NotOwner_Reverts() public {
        bytes32 graphId = _createHumanGraph(alice);

        vm.prank(bob);
        vm.expectRevert(IContextAnchor.NotGraphOwner.selector);
        anchor.grantAccess(graphId, carol, 0, true, 0);
    }

    // ============ revokeAccess ============

    function test_revokeAccess_Success() public {
        bytes32 graphId = _createHumanGraph(alice);

        vm.prank(alice);
        anchor.grantAccess(graphId, bob, 0, true, 0);
        assertTrue(anchor.hasAccess(graphId, bob));

        vm.prank(alice);
        anchor.revokeAccess(graphId, bob);
        assertFalse(anchor.hasAccess(graphId, bob));
    }

    function test_revokeAccess_EmitsAccessRevoked() public {
        bytes32 graphId = _createHumanGraph(alice);

        vm.prank(alice);
        anchor.grantAccess(graphId, bob, 0, true, 0);

        vm.expectEmit(true, true, false, false);
        emit AccessRevoked(graphId, bob);

        vm.prank(alice);
        anchor.revokeAccess(graphId, bob);
    }

    function test_revokeAccess_NotOwner_Reverts() public {
        bytes32 graphId = _createHumanGraph(alice);

        vm.prank(alice);
        anchor.grantAccess(graphId, bob, 0, true, 0);

        vm.prank(bob);
        vm.expectRevert(IContextAnchor.NotGraphOwner.selector);
        anchor.revokeAccess(graphId, bob);
    }

    // ============ hasAccess ============

    function test_hasAccess_OwnerAlwaysHasAccess() public {
        bytes32 graphId = _createHumanGraph(alice);
        assertTrue(anchor.hasAccess(graphId, alice));
    }

    function test_hasAccess_AgentOperatorHasAccess() public {
        bytes32 graphId = _createAgentGraph();
        assertTrue(anchor.hasAccess(graphId, operator));
    }

    function test_hasAccess_UnauthorizedUser_NoAccess() public {
        bytes32 graphId = _createHumanGraph(alice);
        assertFalse(anchor.hasAccess(graphId, bob));
    }

    function test_hasAccess_GrantedUser_HasAccess() public {
        bytes32 graphId = _createHumanGraph(alice);

        vm.prank(alice);
        anchor.grantAccess(graphId, carol, 0, false, 0);

        assertTrue(anchor.hasAccess(graphId, carol));
    }

    function test_hasAccess_ExpiredGrant_NoAccess() public {
        bytes32 graphId = _createHumanGraph(alice);
        uint256 expiry = block.timestamp + 1 hours;

        vm.prank(alice);
        anchor.grantAccess(graphId, carol, 0, false, expiry);

        assertTrue(anchor.hasAccess(graphId, carol));

        vm.warp(expiry); // at exact expiry, should be expired (<=)
        assertFalse(anchor.hasAccess(graphId, carol));
    }

    function test_hasAccess_PermanentGrant_NeverExpires() public {
        bytes32 graphId = _createHumanGraph(alice);

        vm.prank(alice);
        anchor.grantAccess(graphId, carol, 0, false, 0); // expiresAt = 0 means permanent

        vm.warp(block.timestamp + 365 days);
        assertTrue(anchor.hasAccess(graphId, carol));
    }

    function test_hasAccess_RevokedGrant_NoAccess() public {
        bytes32 graphId = _createHumanGraph(alice);

        vm.prank(alice);
        anchor.grantAccess(graphId, carol, 0, false, 0);

        vm.prank(alice);
        anchor.revokeAccess(graphId, carol);

        assertFalse(anchor.hasAccess(graphId, carol));
    }

    // ============ verifyContextNode — Merkle Proof ============

    function test_verifyContextNode_ValidProof_ReturnsTrue() public {
        // Build a 4-leaf Merkle tree manually
        bytes32 leaf0 = keccak256("node0");
        bytes32 leaf1 = keccak256("node1");
        bytes32 leaf2 = keccak256("node2");
        bytes32 leaf3 = keccak256("node3");

        // Internal nodes: sorted hashing (matching contract logic)
        bytes32 internal0 = _hashPair(leaf0, leaf1);
        bytes32 internal1 = _hashPair(leaf2, leaf3);
        bytes32 root = _hashPair(internal0, internal1);

        // Create graph with this Merkle root
        vm.prank(alice);
        bytes32 graphId = anchor.createGraph(
            0,
            IContextAnchor.GraphType.KNOWLEDGE,
            IContextAnchor.StorageBackend.IPFS,
            root,
            CONTENT_CID,
            4,
            3
        );

        // Proof for leaf0: [leaf1, internal1]
        bytes32[] memory proof = new bytes32[](2);
        proof[0] = leaf1;
        proof[1] = internal1;

        bool valid = anchor.verifyContextNode(graphId, leaf0, proof);
        assertTrue(valid);
    }

    function test_verifyContextNode_ValidProof_Leaf2() public {
        bytes32 leaf0 = keccak256("node0");
        bytes32 leaf1 = keccak256("node1");
        bytes32 leaf2 = keccak256("node2");
        bytes32 leaf3 = keccak256("node3");

        bytes32 internal0 = _hashPair(leaf0, leaf1);
        bytes32 internal1 = _hashPair(leaf2, leaf3);
        bytes32 root = _hashPair(internal0, internal1);

        vm.prank(alice);
        bytes32 graphId = anchor.createGraph(
            0,
            IContextAnchor.GraphType.KNOWLEDGE,
            IContextAnchor.StorageBackend.IPFS,
            root,
            CONTENT_CID,
            4,
            3
        );

        // Proof for leaf2: [leaf3, internal0]
        bytes32[] memory proof = new bytes32[](2);
        proof[0] = leaf3;
        proof[1] = internal0;

        bool valid = anchor.verifyContextNode(graphId, leaf2, proof);
        assertTrue(valid);
    }

    function test_verifyContextNode_InvalidProof_ReturnsFalse() public {
        bytes32 leaf0 = keccak256("node0");
        bytes32 leaf1 = keccak256("node1");
        bytes32 leaf2 = keccak256("node2");
        bytes32 leaf3 = keccak256("node3");

        bytes32 internal0 = _hashPair(leaf0, leaf1);
        bytes32 internal1 = _hashPair(leaf2, leaf3);
        bytes32 root = _hashPair(internal0, internal1);

        vm.prank(alice);
        bytes32 graphId = anchor.createGraph(
            0,
            IContextAnchor.GraphType.KNOWLEDGE,
            IContextAnchor.StorageBackend.IPFS,
            root,
            CONTENT_CID,
            4,
            3
        );

        // Wrong proof: using leaf2 instead of leaf1 for leaf0's proof
        bytes32[] memory badProof = new bytes32[](2);
        badProof[0] = leaf2;
        badProof[1] = internal1;

        bool valid = anchor.verifyContextNode(graphId, leaf0, badProof);
        assertFalse(valid);
    }

    function test_verifyContextNode_WrongLeaf_ReturnsFalse() public {
        bytes32 leaf0 = keccak256("node0");
        bytes32 leaf1 = keccak256("node1");
        bytes32 leaf2 = keccak256("node2");
        bytes32 leaf3 = keccak256("node3");

        bytes32 internal0 = _hashPair(leaf0, leaf1);
        bytes32 internal1 = _hashPair(leaf2, leaf3);
        bytes32 root = _hashPair(internal0, internal1);

        vm.prank(alice);
        bytes32 graphId = anchor.createGraph(
            0,
            IContextAnchor.GraphType.KNOWLEDGE,
            IContextAnchor.StorageBackend.IPFS,
            root,
            CONTENT_CID,
            4,
            3
        );

        // Use correct proof for leaf0, but supply a different node hash
        bytes32[] memory proof = new bytes32[](2);
        proof[0] = leaf1;
        proof[1] = internal1;

        bytes32 fakeNode = keccak256("fakeNode");
        bool valid = anchor.verifyContextNode(graphId, fakeNode, proof);
        assertFalse(valid);
    }

    function test_verifyContextNode_EmptyProof_ReturnsFalse() public {
        vm.prank(alice);
        bytes32 graphId = anchor.createGraph(
            0,
            IContextAnchor.GraphType.KNOWLEDGE,
            IContextAnchor.StorageBackend.IPFS,
            MERKLE_ROOT,
            CONTENT_CID,
            4,
            3
        );

        bytes32[] memory emptyProof = new bytes32[](0);
        // nodeHash alone != MERKLE_ROOT (with overwhelming probability)
        bool valid = anchor.verifyContextNode(graphId, keccak256("node0"), emptyProof);
        assertFalse(valid);
    }

    function test_verifyContextNode_SingleLeafTree_ValidProof() public {
        // Single-leaf tree: root = the leaf itself, proof is empty
        bytes32 singleLeaf = keccak256("onlyNode");

        vm.prank(alice);
        bytes32 graphId = anchor.createGraph(
            0,
            IContextAnchor.GraphType.CONVERSATION,
            IContextAnchor.StorageBackend.IPFS,
            singleLeaf,
            CONTENT_CID,
            1,
            0
        );

        bytes32[] memory proof = new bytes32[](0);
        bool valid = anchor.verifyContextNode(graphId, singleLeaf, proof);
        assertTrue(valid);
    }

    function test_verifyContextNode_NonExistentGraph_Reverts() public {
        bytes32[] memory proof = new bytes32[](0);
        vm.expectRevert(IContextAnchor.GraphNotFound.selector);
        anchor.verifyContextNode(keccak256("fake"), keccak256("node"), proof);
    }

    // ============ View Functions ============

    function test_getGraph_ExistingGraph_ReturnsData() public {
        bytes32 graphId = _createHumanGraph(alice);

        IContextAnchor.ContextGraph memory g = anchor.getGraph(graphId);
        assertEq(g.graphId, graphId);
        assertEq(g.ownerAddress, alice);
        assertEq(g.merkleRoot, MERKLE_ROOT);
    }

    function test_getGraph_NonExistentGraph_Reverts() public {
        vm.expectRevert(IContextAnchor.GraphNotFound.selector);
        anchor.getGraph(keccak256("nonexistent"));
    }

    function test_getGraphsByAgent_ReturnsAllAgentGraphs() public {
        bytes32 g1 = _createAgentGraph();

        // Create a second agent graph
        vm.prank(operator);
        bytes32 g2 = anchor.createGraph(
            AGENT_ID,
            IContextAnchor.GraphType.DECISION,
            IContextAnchor.StorageBackend.ARWEAVE,
            keccak256("root2"),
            keccak256("cid2"),
            5,
            3
        );

        bytes32[] memory graphs = anchor.getGraphsByAgent(AGENT_ID);
        assertEq(graphs.length, 2);
        assertEq(graphs[0], g1);
        assertEq(graphs[1], g2);
    }

    function test_getGraphsByAgent_NoGraphs_ReturnsEmpty() public view {
        bytes32[] memory graphs = anchor.getGraphsByAgent(999);
        assertEq(graphs.length, 0);
    }

    function test_getGraphsByOwner_ReturnsAllOwnerGraphs() public {
        bytes32 g1 = _createHumanGraph(alice);
        bytes32 g2 = _createHumanGraph(alice);
        _createHumanGraph(bob); // shouldn't appear

        bytes32[] memory graphs = anchor.getGraphsByOwner(alice);
        assertEq(graphs.length, 2);
        assertEq(graphs[0], g1);
        assertEq(graphs[1], g2);
    }

    function test_getGraphsByOwner_NoGraphs_ReturnsEmpty() public view {
        bytes32[] memory graphs = anchor.getGraphsByOwner(carol);
        assertEq(graphs.length, 0);
    }

    function test_getMergeHistory_NoMerges_ReturnsEmpty() public {
        bytes32 graphId = _createHumanGraph(alice);
        IContextAnchor.MergeRecord[] memory history = anchor.getMergeHistory(graphId);
        assertEq(history.length, 0);
    }

    function test_getMergeHistory_MultipleMerges_ReturnsAll() public {
        bytes32 sourceId = _createHumanGraph(alice);
        bytes32 targetId = _createHumanGraph(bob);

        vm.prank(bob);
        anchor.mergeGraphs(sourceId, targetId, RESULT_ROOT, RESULT_CID, 5, 2);

        vm.prank(bob);
        anchor.mergeGraphs(sourceId, targetId, keccak256("root3"), keccak256("cid3"), 3, 0);

        IContextAnchor.MergeRecord[] memory history = anchor.getMergeHistory(targetId);
        assertEq(history.length, 2);
        assertEq(history[0].nodesAdded, 5);
        assertEq(history[1].nodesAdded, 3);
    }

    function test_totalGraphs_ReturnsCorrectCount() public {
        assertEq(anchor.totalGraphs(), 0);

        _createHumanGraph(alice);
        assertEq(anchor.totalGraphs(), 1);

        _createHumanGraph(bob);
        assertEq(anchor.totalGraphs(), 2);

        _createAgentGraph();
        assertEq(anchor.totalGraphs(), 3);
    }

    // ============ getAccessGrants ============

    function test_getAccessGrants_ReturnsAllGrants() public {
        bytes32 graphId = _createHumanGraph(alice);

        vm.prank(alice);
        anchor.grantAccess(graphId, bob, 0, true, 0);

        vm.prank(alice);
        anchor.grantAccess(graphId, carol, AGENT_ID, false, block.timestamp + 1 days);

        IContextAnchor.AccessGrant[] memory grants = anchor.getAccessGrants(graphId);
        assertEq(grants.length, 2);
        assertEq(grants[0].grantee, bob);
        assertTrue(grants[0].canMerge);
        assertEq(grants[1].grantee, carol);
        assertFalse(grants[1].canMerge);
    }

    function test_getAccessGrants_NoGrants_ReturnsEmpty() public {
        bytes32 graphId = _createHumanGraph(alice);
        IContextAnchor.AccessGrant[] memory grants = anchor.getAccessGrants(graphId);
        assertEq(grants.length, 0);
    }

    // ============ Admin ============

    function test_setAgentRegistry_ByOwner_Success() public {
        address newRegistry = makeAddr("newRegistry");
        anchor.setAgentRegistry(newRegistry);
        assertEq(address(anchor.agentRegistry()), newRegistry);
    }

    function test_setAgentRegistry_NotOwner_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        anchor.setAgentRegistry(makeAddr("newRegistry"));
    }

    // ============ Graph Types & Backends ============

    function test_createGraph_AllGraphTypes() public {
        vm.startPrank(alice);

        anchor.createGraph(0, IContextAnchor.GraphType.CONVERSATION, IContextAnchor.StorageBackend.IPFS, MERKLE_ROOT, CONTENT_CID, 1, 0);
        anchor.createGraph(0, IContextAnchor.GraphType.KNOWLEDGE, IContextAnchor.StorageBackend.IPFS, keccak256("r2"), keccak256("c2"), 1, 0);
        anchor.createGraph(0, IContextAnchor.GraphType.DECISION, IContextAnchor.StorageBackend.IPFS, keccak256("r3"), keccak256("c3"), 1, 0);
        anchor.createGraph(0, IContextAnchor.GraphType.COLLABORATION, IContextAnchor.StorageBackend.IPFS, keccak256("r4"), keccak256("c4"), 1, 0);
        anchor.createGraph(0, IContextAnchor.GraphType.ARCHIVE, IContextAnchor.StorageBackend.IPFS, keccak256("r5"), keccak256("c5"), 1, 0);

        vm.stopPrank();

        assertEq(anchor.totalGraphs(), 5);
    }

    function test_createGraph_AllStorageBackends() public {
        vm.startPrank(alice);

        bytes32 g1 = anchor.createGraph(0, IContextAnchor.GraphType.CONVERSATION, IContextAnchor.StorageBackend.IPFS, MERKLE_ROOT, CONTENT_CID, 1, 0);
        bytes32 g2 = anchor.createGraph(0, IContextAnchor.GraphType.CONVERSATION, IContextAnchor.StorageBackend.ARWEAVE, keccak256("r2"), keccak256("c2"), 1, 0);
        bytes32 g3 = anchor.createGraph(0, IContextAnchor.GraphType.CONVERSATION, IContextAnchor.StorageBackend.HYBRID, keccak256("r3"), keccak256("c3"), 1, 0);

        vm.stopPrank();

        assertEq(uint256(anchor.getGraph(g1).backend), uint256(IContextAnchor.StorageBackend.IPFS));
        assertEq(uint256(anchor.getGraph(g2).backend), uint256(IContextAnchor.StorageBackend.ARWEAVE));
        assertEq(uint256(anchor.getGraph(g3).backend), uint256(IContextAnchor.StorageBackend.HYBRID));
    }

    // ============ Edge Cases ============

    function test_createGraph_UniqueIdsAcrossCalls() public {
        vm.startPrank(alice);
        bytes32 g1 = anchor.createGraph(0, IContextAnchor.GraphType.CONVERSATION, IContextAnchor.StorageBackend.IPFS, MERKLE_ROOT, CONTENT_CID, 1, 0);
        bytes32 g2 = anchor.createGraph(0, IContextAnchor.GraphType.CONVERSATION, IContextAnchor.StorageBackend.IPFS, MERKLE_ROOT, CONTENT_CID, 1, 0);
        vm.stopPrank();

        assertTrue(g1 != g2, "Graph IDs should be unique");
    }

    function test_updateGraph_PreservesCreatedAt() public {
        bytes32 graphId = _createHumanGraph(alice);
        uint256 createdAt = anchor.getGraph(graphId).createdAt;

        vm.warp(block.timestamp + 1000);

        vm.prank(alice);
        anchor.updateGraph(graphId, NEW_ROOT, NEW_CID, 25, 18);

        IContextAnchor.ContextGraph memory g = anchor.getGraph(graphId);
        assertEq(g.createdAt, createdAt, "createdAt must not change");
        assertTrue(g.lastUpdatedAt > createdAt, "lastUpdatedAt must advance");
    }

    function test_mergeGraphs_AddsNodesToTarget() public {
        bytes32 sourceId = _createHumanGraph(alice);
        bytes32 targetId = _createHumanGraph(bob); // nodeCount = 10

        vm.prank(bob);
        anchor.mergeGraphs(sourceId, targetId, RESULT_ROOT, RESULT_CID, 7, 0);

        assertEq(anchor.getGraph(targetId).nodeCount, 17); // 10 + 7
    }

    function test_mergeGraphs_DoesNotChangeSource() public {
        bytes32 sourceId = _createHumanGraph(alice);
        bytes32 targetId = _createHumanGraph(bob);

        IContextAnchor.ContextGraph memory sourceBefore = anchor.getGraph(sourceId);

        vm.prank(bob);
        anchor.mergeGraphs(sourceId, targetId, RESULT_ROOT, RESULT_CID, 7, 0);

        IContextAnchor.ContextGraph memory sourceAfter = anchor.getGraph(sourceId);
        assertEq(sourceAfter.merkleRoot, sourceBefore.merkleRoot);
        assertEq(sourceAfter.nodeCount, sourceBefore.nodeCount);
        assertEq(sourceAfter.version, sourceBefore.version);
    }

    // ============ Internal Helpers ============

    /// @dev Hash pair with sorted ordering (matches contract Merkle proof verification)
    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        if (a <= b) {
            return keccak256(abi.encodePacked(a, b));
        } else {
            return keccak256(abi.encodePacked(b, a));
        }
    }
}
