// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/AgentRegistry.sol";
import "../../contracts/identity/ContextAnchor.sol";
import "../../contracts/identity/PairwiseVerifier.sol";
import "../../contracts/identity/SoulboundIdentity.sol";
import "../../contracts/identity/VibeCode.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ PsiNet Pipeline Integration Test ============
// Flow: AgentRegistry (AI identities) -> ContextAnchor (knowledge graphs) -> PairwiseVerifier (CRPC)

contract PsiNetPipelineTest is Test {
    AgentRegistry agentRegistry;
    ContextAnchor contextAnchor;
    PairwiseVerifier verifier;
    SoulboundIdentity soulbound;
    VibeCode vibeCode;

    address owner = address(this);
    address operator1 = makeAddr("operator1"); // Operates "Jarvis"
    address operator2 = makeAddr("operator2"); // Operates "Nova"
    address alice = makeAddr("alice");          // Human
    address bob = makeAddr("bob");              // Human
    address validator1 = makeAddr("validator1");
    address validator2 = makeAddr("validator2");
    address validator3 = makeAddr("validator3");
    address worker1 = makeAddr("worker1");
    address worker2 = makeAddr("worker2");

    uint256 jarvisId;
    uint256 novaId;

    function setUp() public {
        // 1. Deploy SoulboundIdentity
        SoulboundIdentity soulImpl = new SoulboundIdentity();
        ERC1967Proxy soulProxy = new ERC1967Proxy(
            address(soulImpl),
            abi.encodeCall(SoulboundIdentity.initialize, ())
        );
        soulbound = SoulboundIdentity(address(soulProxy));

        // 2. Deploy VibeCode
        vibeCode = new VibeCode();

        // 3. Deploy AgentRegistry
        AgentRegistry agentImpl = new AgentRegistry();
        ERC1967Proxy agentProxy = new ERC1967Proxy(
            address(agentImpl),
            abi.encodeCall(AgentRegistry.initialize, ())
        );
        agentRegistry = AgentRegistry(address(agentProxy));

        // 4. Deploy ContextAnchor
        ContextAnchor contextImpl = new ContextAnchor();
        ERC1967Proxy contextProxy = new ERC1967Proxy(
            address(contextImpl),
            abi.encodeCall(ContextAnchor.initialize, (address(agentRegistry)))
        );
        contextAnchor = ContextAnchor(address(contextProxy));

        // 5. Deploy PairwiseVerifier
        PairwiseVerifier verifierImpl = new PairwiseVerifier();
        ERC1967Proxy verifierProxy = new ERC1967Proxy(
            address(verifierImpl),
            abi.encodeCall(PairwiseVerifier.initialize, (address(agentRegistry)))
        );
        verifier = PairwiseVerifier(address(verifierProxy));

        // Wire up
        agentRegistry.setVibeCode(address(vibeCode));
        agentRegistry.setSoulboundIdentity(address(soulbound));
        soulbound.setAuthorizedRecorder(owner, true);
        vibeCode.setAuthorizedSource(owner, true);

        // Mint human identities
        vm.prank(alice);
        soulbound.mintIdentity("alice_human");
        vm.prank(bob);
        soulbound.mintIdentity("bob_human");

        // Register AI agents
        vm.prank(operator1);
        jarvisId = agentRegistry.registerAgent(
            "Jarvis",
            IAgentRegistry.AgentPlatform.CLAUDE,
            operator1,
            keccak256("claude-opus-4.6")
        );

        vm.prank(operator2);
        novaId = agentRegistry.registerAgent(
            "Nova",
            IAgentRegistry.AgentPlatform.CHATGPT,
            operator2,
            keccak256("gpt-5")
        );

        // Grant capabilities
        agentRegistry.grantCapability(jarvisId, IAgentRegistry.CapabilityType.TRADE, 0);
        agentRegistry.grantCapability(jarvisId, IAgentRegistry.CapabilityType.ATTEST, 0);
        agentRegistry.grantCapability(jarvisId, IAgentRegistry.CapabilityType.DELEGATE, 0);
        agentRegistry.grantCapability(novaId, IAgentRegistry.CapabilityType.ANALYZE, 0);
        agentRegistry.grantCapability(novaId, IAgentRegistry.CapabilityType.CREATE, 0);

        // Fund actors with ETH for PairwiseVerifier tasks
        vm.deal(worker1, 10 ether);
        vm.deal(worker2, 10 ether);
        vm.deal(validator1, 10 ether);
        vm.deal(validator2, 10 ether);
        vm.deal(validator3, 10 ether);
        vm.deal(owner, 100 ether);
    }

    // ============ E2E: Full agent registration and capability check ============
    function test_fullAgentRegistration() public view {
        IAgentRegistry.AgentIdentity memory jarvis = agentRegistry.getAgent(jarvisId);
        assertEq(jarvis.name, "Jarvis");
        assertEq(uint256(jarvis.platform), uint256(IAgentRegistry.AgentPlatform.CLAUDE));
        assertEq(jarvis.operator, operator1);
        assertEq(uint256(jarvis.status), uint256(IAgentRegistry.AgentStatus.ACTIVE));

        // Check capabilities
        assertTrue(agentRegistry.hasCapability(jarvisId, IAgentRegistry.CapabilityType.TRADE));
        assertTrue(agentRegistry.hasCapability(jarvisId, IAgentRegistry.CapabilityType.ATTEST));
        assertFalse(agentRegistry.hasCapability(jarvisId, IAgentRegistry.CapabilityType.GOVERN));

        // Check operator-based identity
        assertTrue(agentRegistry.isAgent(operator1));
        assertTrue(agentRegistry.isAgent(operator2));
        assertFalse(agentRegistry.isAgent(alice));
    }

    // ============ E2E: Agent context graph lifecycle ============
    function test_agentContextGraph() public {
        bytes32 merkleRoot = keccak256("jarvis-context-root-v1");
        bytes32 contentCID = keccak256("QmJarvisContextV1");

        // Operator creates context graph for their agent
        vm.prank(operator1);
        bytes32 graphId = contextAnchor.createGraph(
            jarvisId,
            IContextAnchor.GraphType.KNOWLEDGE,
            IContextAnchor.StorageBackend.IPFS,
            merkleRoot,
            contentCID,
            100,  // nodeCount
            250   // edgeCount
        );
        assertNotEq(graphId, bytes32(0), "Graph should be created");

        // Verify graph data
        IContextAnchor.ContextGraph memory graph = contextAnchor.getGraph(graphId);
        assertEq(graph.ownerAgentId, jarvisId);
        assertEq(graph.merkleRoot, merkleRoot);
        assertEq(graph.nodeCount, 100);
        assertEq(graph.edgeCount, 250);
        assertEq(graph.version, 1);

        // Update context graph
        bytes32 newRoot = keccak256("jarvis-context-root-v2");
        bytes32 newCID = keccak256("QmJarvisContextV2");
        vm.prank(operator1);
        contextAnchor.updateGraph(graphId, newRoot, newCID, 150, 300);

        graph = contextAnchor.getGraph(graphId);
        assertEq(graph.merkleRoot, newRoot);
        assertEq(graph.version, 2);
        assertEq(graph.nodeCount, 150);

        // Sync context root to AgentRegistry
        vm.prank(operator1);
        agentRegistry.updateContextRoot(jarvisId, newRoot);

        IAgentRegistry.AgentIdentity memory jarvis = agentRegistry.getAgent(jarvisId);
        assertEq(jarvis.contextRoot, newRoot, "Agent context root should be synced");
    }

    // ============ E2E: Human vouches for AI agent ============
    function test_humanVouchForAgent() public {
        bytes32 messageHash = keccak256("I vouch for Jarvis as a trustworthy AI agent");

        vm.prank(alice);
        agentRegistry.vouchForAgent(jarvisId, messageHash);

        address[] memory vouchers = agentRegistry.getHumanVouchers(jarvisId);
        assertEq(vouchers.length, 1, "Should have 1 voucher");
        assertEq(vouchers[0], alice, "Alice should be the voucher");

        // Second human vouches
        vm.prank(bob);
        agentRegistry.vouchForAgent(jarvisId, keccak256("I also vouch for Jarvis"));

        vouchers = agentRegistry.getHumanVouchers(jarvisId);
        assertEq(vouchers.length, 2, "Should have 2 vouchers");
    }

    // ============ E2E: Capability delegation between agents ============
    function test_capabilityDelegation() public {
        // Jarvis delegates TRADE capability to Nova
        vm.prank(operator1);
        agentRegistry.delegateCapability(
            jarvisId,
            novaId,
            IAgentRegistry.CapabilityType.TRADE,
            0 // permanent
        );

        // Nova should now have TRADE via delegation
        assertTrue(
            agentRegistry.hasCapability(novaId, IAgentRegistry.CapabilityType.TRADE),
            "Nova should have TRADE via delegation"
        );

        // Check delegation records
        IAgentRegistry.Delegation[] memory delegationsFrom = agentRegistry.getDelegationsFrom(jarvisId);
        assertEq(delegationsFrom.length, 1, "Jarvis should have 1 outgoing delegation");
        assertEq(delegationsFrom[0].toAgentId, novaId);

        IAgentRegistry.Delegation[] memory delegationsTo = agentRegistry.getDelegationsTo(novaId);
        assertEq(delegationsTo.length, 1, "Nova should have 1 incoming delegation");

        // Revoke delegation
        vm.prank(operator1);
        agentRegistry.revokeDelegation(jarvisId, novaId, IAgentRegistry.CapabilityType.TRADE);

        // Nova should no longer have TRADE
        assertFalse(
            agentRegistry.hasCapability(novaId, IAgentRegistry.CapabilityType.TRADE),
            "Nova should not have TRADE after revocation"
        );
    }

    // ============ E2E: Full CRPC verification flow ============
    function test_fullCRPC_verification() public {
        // Step 1: Create verification task with ETH reward
        bytes32 taskId = verifier.createTask{value: 10 ether}(
            "Evaluate best DeFi audit report",
            keccak256("ipfs://task-spec"),
            3000, // 30% validator reward
            1 hours,  // work commit duration
            30 minutes, // work reveal duration
            1 hours,  // compare commit duration
            30 minutes  // compare reveal duration
        );
        assertNotEq(taskId, bytes32(0), "Task should be created");

        // Step 2: Workers commit work
        bytes32 work1Hash = keccak256("ipfs://audit-report-1");
        bytes32 secret1 = keccak256("worker1-secret");
        bytes32 commit1 = keccak256(abi.encodePacked(work1Hash, secret1));

        bytes32 work2Hash = keccak256("ipfs://audit-report-2");
        bytes32 secret2 = keccak256("worker2-secret");
        bytes32 commit2 = keccak256(abi.encodePacked(work2Hash, secret2));

        vm.prank(worker1);
        bytes32 sub1Id = verifier.commitWork(taskId, commit1);

        vm.prank(worker2);
        bytes32 sub2Id = verifier.commitWork(taskId, commit2);

        // Step 3: Advance to WORK_REVEAL
        vm.warp(block.timestamp + 1 hours + 1);
        verifier.advancePhase(taskId);

        // Step 4: Workers reveal
        vm.prank(worker1);
        verifier.revealWork(taskId, sub1Id, work1Hash, secret1);

        vm.prank(worker2);
        verifier.revealWork(taskId, sub2Id, work2Hash, secret2);

        // Step 5: Advance to COMPARE_COMMIT
        vm.warp(block.timestamp + 30 minutes + 1);
        verifier.advancePhase(taskId);

        // Step 6: Validators commit comparisons (all vote for worker1)
        bytes32 vSecret1 = keccak256("v1-secret");
        bytes32 vSecret2 = keccak256("v2-secret");
        bytes32 vSecret3 = keccak256("v3-secret");

        // choice=1 means FIRST (worker1's submission)
        bytes32 vCommit1 = keccak256(abi.encodePacked(uint8(1), vSecret1));
        bytes32 vCommit2 = keccak256(abi.encodePacked(uint8(1), vSecret2));
        bytes32 vCommit3 = keccak256(abi.encodePacked(uint8(1), vSecret3));

        vm.prank(validator1);
        bytes32 comp1 = verifier.commitComparison(taskId, sub1Id, sub2Id, vCommit1);

        vm.prank(validator2);
        bytes32 comp2 = verifier.commitComparison(taskId, sub1Id, sub2Id, vCommit2);

        vm.prank(validator3);
        bytes32 comp3 = verifier.commitComparison(taskId, sub1Id, sub2Id, vCommit3);

        // Step 7: Advance to COMPARE_REVEAL
        vm.warp(block.timestamp + 1 hours + 1);
        verifier.advancePhase(taskId);

        // Step 8: Validators reveal
        vm.prank(validator1);
        verifier.revealComparison(comp1, IPairwiseVerifier.CompareChoice.FIRST, vSecret1);

        vm.prank(validator2);
        verifier.revealComparison(comp2, IPairwiseVerifier.CompareChoice.FIRST, vSecret2);

        vm.prank(validator3);
        verifier.revealComparison(comp3, IPairwiseVerifier.CompareChoice.FIRST, vSecret3);

        // Step 9: Advance to SETTLED and settle
        vm.warp(block.timestamp + 30 minutes + 1);
        verifier.advancePhase(taskId);
        verifier.settle(taskId);

        // Step 10: Verify rewards
        uint256 worker1Reward = verifier.getWorkerReward(taskId, worker1);
        uint256 worker2Reward = verifier.getWorkerReward(taskId, worker2);
        uint256 v1Reward = verifier.getValidatorReward(taskId, validator1);

        // Worker1 won all comparisons, should get the lion's share
        assertGt(worker1Reward, 0, "Winner should have reward");
        assertGt(v1Reward, 0, "Consensus-aligned validator should have reward");

        // Worker1 gets more than worker2 (winner vs loser)
        assertGt(worker1Reward, worker2Reward, "Winner should get more");

        // Step 11: Claim rewards
        uint256 balBefore = worker1.balance;
        vm.prank(worker1);
        verifier.claimReward(taskId);
        assertGt(worker1.balance, balBefore, "Worker1 balance should increase after claim");
    }

    // ============ E2E: Context graph merge between agents ============
    function test_contextGraphMerge() public {
        // Create graphs for both agents
        vm.prank(operator1);
        bytes32 graph1 = contextAnchor.createGraph(
            jarvisId,
            IContextAnchor.GraphType.KNOWLEDGE,
            IContextAnchor.StorageBackend.IPFS,
            keccak256("jarvis-root"),
            keccak256("QmJarvis"),
            50, 100
        );

        vm.prank(operator2);
        bytes32 graph2 = contextAnchor.createGraph(
            novaId,
            IContextAnchor.GraphType.COLLABORATION,
            IContextAnchor.StorageBackend.IPFS,
            keccak256("nova-root"),
            keccak256("QmNova"),
            30, 60
        );

        // Grant merge access to operator1 on Nova's graph
        vm.prank(operator2);
        contextAnchor.grantAccess(graph2, operator1, 0, true, 0); // canMerge=true

        // Merge Nova's graph into Jarvis's graph
        bytes32 mergedRoot = keccak256("merged-knowledge-root");
        bytes32 mergedCID = keccak256("QmMergedKnowledge");

        vm.prank(operator1);
        bytes32 mergeId = contextAnchor.mergeGraphs(
            graph2,      // source (Nova's)
            graph1,      // target (Jarvis's)
            mergedRoot,
            mergedCID,
            20,          // nodesAdded
            3            // conflictsResolved
        );
        assertNotEq(mergeId, bytes32(0), "Merge should be recorded");

        // Target graph should be updated
        IContextAnchor.ContextGraph memory target = contextAnchor.getGraph(graph1);
        assertEq(target.merkleRoot, mergedRoot, "Target graph should have merged root");

        // Check merge history
        IContextAnchor.MergeRecord[] memory history = contextAnchor.getMergeHistory(graph1);
        assertEq(history.length, 1, "Should have 1 merge record");
        assertEq(history[0].nodesAdded, 20);
        assertEq(history[0].conflictsResolved, 3);
    }

    // ============ E2E: Agent status lifecycle ============
    function test_agentStatusLifecycle() public {
        // Active → Inactive (operator can do this)
        vm.prank(operator1);
        agentRegistry.setAgentStatus(jarvisId, IAgentRegistry.AgentStatus.INACTIVE);

        IAgentRegistry.AgentIdentity memory jarvis = agentRegistry.getAgent(jarvisId);
        assertEq(uint256(jarvis.status), uint256(IAgentRegistry.AgentStatus.INACTIVE));

        // Inactive → Active (operator restores)
        vm.prank(operator1);
        agentRegistry.setAgentStatus(jarvisId, IAgentRegistry.AgentStatus.ACTIVE);

        jarvis = agentRegistry.getAgent(jarvisId);
        assertEq(uint256(jarvis.status), uint256(IAgentRegistry.AgentStatus.ACTIVE));

        // Only owner can SUSPEND
        agentRegistry.setAgentStatus(jarvisId, IAgentRegistry.AgentStatus.SUSPENDED);

        jarvis = agentRegistry.getAgent(jarvisId);
        assertEq(uint256(jarvis.status), uint256(IAgentRegistry.AgentStatus.SUSPENDED));
    }

    // ============ E2E: Identity unification — both humans and AI ============
    function test_identityUnification() public view {
        // AgentRegistry.hasIdentity checks both agent operators and SoulboundIdentity
        assertTrue(agentRegistry.hasIdentity(operator1), "Agent operator should have identity");
        assertTrue(agentRegistry.hasIdentity(operator2), "Agent operator should have identity");
        assertTrue(agentRegistry.hasIdentity(alice), "Human with SoulboundIdentity should have identity");
        assertTrue(agentRegistry.hasIdentity(bob), "Human with SoulboundIdentity should have identity");
        assertFalse(agentRegistry.hasIdentity(address(0xdead)), "Unknown address should not have identity");
    }

    // ============ E2E: Context graph Merkle proof verification ============
    function test_merkleProofVerification() public {
        // Build a simple Merkle tree for testing
        // For a real test, we'd need a proper Merkle tree, but we can test the verification mechanism
        bytes32 leaf = keccak256("node-data-1");
        bytes32 sibling = keccak256("node-data-2");
        bytes32 root = _hashPair(leaf, sibling);

        vm.prank(operator1);
        bytes32 graphId = contextAnchor.createGraph(
            jarvisId,
            IContextAnchor.GraphType.KNOWLEDGE,
            IContextAnchor.StorageBackend.IPFS,
            root,
            keccak256("QmContext"),
            2, 1
        );

        // Verify a node exists in the graph via Merkle proof
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = sibling;

        bool verified = contextAnchor.verifyContextNode(graphId, leaf, proof);
        assertTrue(verified, "Valid Merkle proof should verify");

        // Invalid proof should fail
        bytes32[] memory badProof = new bytes32[](1);
        badProof[0] = keccak256("wrong-sibling");
        bool badResult = contextAnchor.verifyContextNode(graphId, leaf, badProof);
        assertFalse(badResult, "Invalid Merkle proof should not verify");
    }

    // ============ E2E: Agent interaction recording ============
    function test_agentInteractionRecording() public {
        bytes32 interactionHash = keccak256("session-abc-interaction-1");

        vm.prank(operator1);
        agentRegistry.recordInteraction(jarvisId, interactionHash);

        IAgentRegistry.AgentIdentity memory jarvis = agentRegistry.getAgent(jarvisId);
        assertEq(jarvis.totalInteractions, 1, "Should have 1 interaction");

        // Record more
        vm.prank(operator1);
        agentRegistry.recordInteraction(jarvisId, keccak256("session-abc-interaction-2"));

        jarvis = agentRegistry.getAgent(jarvisId);
        assertEq(jarvis.totalInteractions, 2, "Should have 2 interactions");
    }

    // ============ E2E: Operator transfer ============
    function test_operatorTransfer() public {
        address newOperator = makeAddr("newOperator");

        vm.prank(operator1);
        agentRegistry.transferOperator(jarvisId, newOperator);

        IAgentRegistry.AgentIdentity memory jarvis = agentRegistry.getAgent(jarvisId);
        assertEq(jarvis.operator, newOperator, "Operator should be transferred");

        // Old operator can no longer control the agent
        vm.prank(operator1);
        vm.expectRevert();
        agentRegistry.updateContextRoot(jarvisId, keccak256("should-fail"));

        // New operator can
        vm.prank(newOperator);
        agentRegistry.updateContextRoot(jarvisId, keccak256("new-context-root"));
    }

    // ============ E2E: Access control on context graphs ============
    function test_contextGraphAccessControl() public {
        vm.prank(operator1);
        bytes32 graphId = contextAnchor.createGraph(
            jarvisId,
            IContextAnchor.GraphType.DECISION,
            IContextAnchor.StorageBackend.IPFS,
            keccak256("private-root"),
            keccak256("QmPrivate"),
            10, 20
        );

        // Operator2 (Nova's operator) should NOT have access by default
        assertFalse(contextAnchor.hasAccess(graphId, operator2), "No access by default");

        // Grant read-only access (no merge)
        vm.prank(operator1);
        contextAnchor.grantAccess(graphId, operator2, novaId, false, 0);

        assertTrue(contextAnchor.hasAccess(graphId, operator2), "Should have access after grant");

        // Revoke access
        vm.prank(operator1);
        contextAnchor.revokeAccess(graphId, operator2);
        assertFalse(contextAnchor.hasAccess(graphId, operator2), "No access after revoke");
    }

    // ============ Helper: Merkle pair hash ============
    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        if (a <= b) {
            return keccak256(abi.encodePacked(a, b));
        } else {
            return keccak256(abi.encodePacked(b, a));
        }
    }

    // Receive ETH for refunds
    receive() external payable {}
}
