// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/TrinityGuardian.sol";

// ============ TrinityGuardian Tests ============

contract TrinityGuardianTest is Test {
    TrinityGuardian public guardian;

    address node1 = makeAddr("node1");
    address node2 = makeAddr("node2");
    address node3 = makeAddr("node3");
    address node4 = makeAddr("node4");
    address rando = makeAddr("rando");

    bytes32 constant IDENTITY_1 = keccak256("identity_node1");
    bytes32 constant IDENTITY_2 = keccak256("identity_node2");
    bytes32 constant IDENTITY_3 = keccak256("identity_node3");
    bytes32 constant IDENTITY_4 = keccak256("identity_node4");

    function setUp() public {
        guardian = new TrinityGuardian();

        // Fund all test addresses
        vm.deal(node1, 10 ether);
        vm.deal(node2, 10 ether);
        vm.deal(node3, 10 ether);
        vm.deal(node4, 10 ether);
        vm.deal(rando, 10 ether);
    }

    // ============ Helpers ============

    /// @dev Registers the 3 genesis nodes and completes genesis
    function _completeGenesis() internal {
        vm.prank(node1);
        guardian.registerGenesis{value: 1 ether}("https://node1.example.com", IDENTITY_1);

        vm.prank(node2);
        guardian.registerGenesis{value: 1 ether}("https://node2.example.com", IDENTITY_2);

        vm.prank(node3);
        guardian.registerGenesis{value: 1 ether}("https://node3.example.com", IDENTITY_3);
    }

    // ============ Genesis Registration Tests ============

    function test_registerGenesis_singleNode() public {
        vm.prank(node1);
        guardian.registerGenesis{value: 0.5 ether}("https://node1.example.com", IDENTITY_1);

        (uint256 stake, uint256 registeredAt, uint256 lastHeartbeat, uint256 missedHeartbeats, bool active, string memory endpoint) =
            guardian.getNode(node1);

        assertEq(stake, 0.5 ether);
        assertEq(registeredAt, block.timestamp);
        assertEq(lastHeartbeat, block.timestamp);
        assertEq(missedHeartbeats, 0);
        assertTrue(active);
        assertEq(endpoint, "https://node1.example.com");
        assertEq(guardian.activeNodeCount(), 1);
        assertEq(guardian.genesisNodeCount(), 1);
        assertFalse(guardian.genesisComplete());
    }

    function test_registerGenesis_completesAfterThreeNodes() public {
        _completeGenesis();

        assertTrue(guardian.genesisComplete());
        assertEq(guardian.activeNodeCount(), 3);
        assertEq(guardian.genesisNodeCount(), 3);
    }

    function test_registerGenesis_revertsInsufficientStake() public {
        vm.prank(node1);
        vm.expectRevert(TrinityGuardian.InsufficientStake.selector);
        guardian.registerGenesis{value: 0.01 ether}("https://node1.example.com", IDENTITY_1);
    }

    function test_registerGenesis_revertsAlreadyRegistered() public {
        vm.prank(node1);
        guardian.registerGenesis{value: 0.5 ether}("https://node1.example.com", IDENTITY_1);

        vm.prank(node1);
        vm.expectRevert(TrinityGuardian.AlreadyRegistered.selector);
        guardian.registerGenesis{value: 0.5 ether}("https://node1.example.com", IDENTITY_1);
    }

    function test_registerGenesis_revertsAfterGenesisComplete() public {
        _completeGenesis();

        vm.prank(node4);
        vm.expectRevert(TrinityGuardian.GenesisAlreadyComplete.selector);
        guardian.registerGenesis{value: 1 ether}("https://node4.example.com", IDENTITY_4);
    }

    // ============ Heartbeat Tests ============

    function test_heartbeat_updatesTimestamp() public {
        _completeGenesis();

        // Advance time 12 hours
        vm.warp(block.timestamp + 12 hours);

        vm.prank(node1);
        guardian.heartbeat();

        (, , uint256 lastHeartbeat, uint256 missedHeartbeats, , ) = guardian.getNode(node1);
        assertEq(lastHeartbeat, block.timestamp);
        assertEq(missedHeartbeats, 0);
    }

    function test_heartbeat_revertsNotANode() public {
        _completeGenesis();

        vm.prank(rando);
        vm.expectRevert(TrinityGuardian.NotANode.selector);
        guardian.heartbeat();
    }

    function test_heartbeat_resetsAfterMissedReport() public {
        _completeGenesis();

        // Advance time to cause 2 missed heartbeats
        vm.warp(block.timestamp + 2 * 24 hours + 1);

        // Report missed heartbeat
        guardian.reportMissedHeartbeat(node1);
        (, , , uint256 missed, , ) = guardian.getNode(node1);
        assertEq(missed, 2);

        // Node sends heartbeat — resets
        vm.prank(node1);
        guardian.heartbeat();

        (, , , uint256 missedAfter, , ) = guardian.getNode(node1);
        assertEq(missedAfter, 0);
    }

    // ============ Missed Heartbeat Reporting ============

    function test_reportMissedHeartbeat_incrementsMissedCount() public {
        _completeGenesis();

        // Advance past 3 heartbeat intervals
        vm.warp(block.timestamp + 3 * 24 hours + 1);

        guardian.reportMissedHeartbeat(node2);

        (, , , uint256 missed, , ) = guardian.getNode(node2);
        assertEq(missed, 3);
    }

    function test_reportMissedHeartbeat_noUpdateIfWithinInterval() public {
        _completeGenesis();

        // Advance only 12 hours — no full interval elapsed
        vm.warp(block.timestamp + 12 hours);

        guardian.reportMissedHeartbeat(node1);

        // missedHeartbeats should still be 0 since 0 / HEARTBEAT_INTERVAL = 0
        (, , , uint256 missed, , ) = guardian.getNode(node1);
        assertEq(missed, 0);
    }

    function test_reportMissedHeartbeat_revertsForInactiveNode() public {
        vm.prank(rando);
        vm.expectRevert(TrinityGuardian.NotANode.selector);
        guardian.reportMissedHeartbeat(rando);
    }

    // ============ Propose Add Node ============

    function test_proposeAddNode_createsProposal() public {
        _completeGenesis();

        vm.prank(node1);
        bytes32 proposalId = guardian.proposeAddNode(node4, "Adding 4th node");

        (
            bytes32 id, TrinityGuardian.ProposalAction action, address target,
            uint256 votesFor, uint256 votesAgainst, uint256 createdAt, uint256 deadline, bool executed
        ) = _getProposalFields(proposalId);

        assertEq(id, proposalId);
        assertEq(uint8(action), uint8(TrinityGuardian.ProposalAction.ADD_NODE));
        assertEq(target, node4);
        assertEq(votesFor, 1); // proposer auto-votes
        assertEq(votesAgainst, 0);
        assertEq(createdAt, block.timestamp);
        assertEq(deadline, block.timestamp + 3 days);
        assertFalse(executed);
    }

    function test_proposeAddNode_revertsBeforeGenesis() public {
        vm.prank(node1);
        guardian.registerGenesis{value: 1 ether}("https://node1.example.com", IDENTITY_1);

        vm.prank(node1);
        vm.expectRevert(TrinityGuardian.GenesisNotComplete.selector);
        guardian.proposeAddNode(node4, "Too early");
    }

    function test_proposeAddNode_revertsNonNode() public {
        _completeGenesis();

        vm.prank(rando);
        vm.expectRevert(TrinityGuardian.NotANode.selector);
        guardian.proposeAddNode(node4, "Not allowed");
    }

    function test_proposeAddNode_revertsAlreadyRegistered() public {
        _completeGenesis();

        vm.prank(node1);
        vm.expectRevert(TrinityGuardian.AlreadyRegistered.selector);
        guardian.proposeAddNode(node2, "Already a node");
    }

    // ============ Propose Remove Node ============

    function test_proposeRemoveNode_createsProposal() public {
        _completeGenesis();

        vm.prank(node1);
        bytes32 proposalId = guardian.proposeRemoveNode(node3, "Inactivity");

        (
            , TrinityGuardian.ProposalAction action, address target,
            uint256 votesFor, , , , bool executed
        ) = _getProposalFields(proposalId);

        assertEq(uint8(action), uint8(TrinityGuardian.ProposalAction.REMOVE_NODE));
        assertEq(target, node3);
        assertEq(votesFor, 1);
        assertFalse(executed);
    }

    function test_proposeRemoveNode_revertsAtMinNodes() public {
        // Only register 2 genesis nodes, then complete genesis with a 3rd
        _completeGenesis();

        // First, remove one node via consensus so we're at exactly MIN_NODES
        // Propose removal of node3
        vm.prank(node1);
        bytes32 proposalId = guardian.proposeRemoveNode(node3, "test");

        vm.prank(node2);
        guardian.vote(proposalId, true);

        // Execute — threshold with 3 nodes is ceil(6/3) = 2, we have 2 votes
        guardian.executeProposal(proposalId);

        assertEq(guardian.activeNodeCount(), 2);

        // Now trying to remove another should revert
        vm.prank(node1);
        vm.expectRevert(TrinityGuardian.CannotRemoveBelowMinimum.selector);
        guardian.proposeRemoveNode(node2, "Cannot go below minimum");
    }

    // ============ Voting Tests ============

    function test_vote_success() public {
        _completeGenesis();

        vm.prank(node1);
        bytes32 proposalId = guardian.proposeAddNode(node4, "Add node4");

        vm.prank(node2);
        guardian.vote(proposalId, true);

        (, , , uint256 votesFor, , , , ) = _getProposalFields(proposalId);
        assertEq(votesFor, 2);
    }

    function test_vote_against() public {
        _completeGenesis();

        vm.prank(node1);
        bytes32 proposalId = guardian.proposeAddNode(node4, "Add node4");

        vm.prank(node2);
        guardian.vote(proposalId, false);

        (, , , uint256 votesFor, uint256 votesAgainst, , , ) = _getProposalFields(proposalId);
        assertEq(votesFor, 1);
        assertEq(votesAgainst, 1);
    }

    function test_vote_revertsDoubleVote() public {
        _completeGenesis();

        vm.prank(node1);
        bytes32 proposalId = guardian.proposeAddNode(node4, "test");

        // node1 already auto-voted via propose
        vm.prank(node1);
        vm.expectRevert(TrinityGuardian.AlreadyVoted.selector);
        guardian.vote(proposalId, true);
    }

    function test_vote_revertsExpiredProposal() public {
        _completeGenesis();

        vm.prank(node1);
        bytes32 proposalId = guardian.proposeAddNode(node4, "test");

        // Warp past deadline
        vm.warp(block.timestamp + 3 days + 1);

        vm.prank(node2);
        vm.expectRevert(TrinityGuardian.ProposalExpired.selector);
        guardian.vote(proposalId, false);
    }

    function test_vote_revertsNonNode() public {
        _completeGenesis();

        vm.prank(node1);
        bytes32 proposalId = guardian.proposeAddNode(node4, "test");

        vm.prank(rando);
        vm.expectRevert(TrinityGuardian.NotANode.selector);
        guardian.vote(proposalId, true);
    }

    function test_vote_revertsProposalNotFound() public {
        _completeGenesis();

        bytes32 fakeId = keccak256("nonexistent");

        vm.prank(node1);
        vm.expectRevert(TrinityGuardian.ProposalNotFound.selector);
        guardian.vote(fakeId, true);
    }

    // ============ Execute Proposal Tests ============

    function test_executeProposal_addNode() public {
        _completeGenesis();

        vm.prank(node1);
        bytes32 proposalId = guardian.proposeAddNode(node4, "Add node4");

        vm.prank(node2);
        guardian.vote(proposalId, true);

        // Threshold for 3 nodes = ceil(6/3) = 2. We have 2 votes.
        guardian.executeProposal(proposalId);

        (, , , , bool active, ) = guardian.getNode(node4);
        assertTrue(active);
        assertEq(guardian.activeNodeCount(), 4);
    }

    function test_executeProposal_removeNode() public {
        _completeGenesis();

        vm.prank(node1);
        bytes32 proposalId = guardian.proposeRemoveNode(node3, "Removing node3");

        vm.prank(node2);
        guardian.vote(proposalId, true);

        uint256 node3BalanceBefore = node3.balance;

        guardian.executeProposal(proposalId);

        (, , , , bool active, ) = guardian.getNode(node3);
        assertFalse(active);
        assertEq(guardian.activeNodeCount(), 2);

        // Stake returned to removed node
        assertEq(node3.balance - node3BalanceBefore, 1 ether);
    }

    function test_executeProposal_revertsNotEnoughVotes() public {
        _completeGenesis();

        vm.prank(node1);
        bytes32 proposalId = guardian.proposeAddNode(node4, "Add node4");

        // Only 1 vote (proposer), threshold = 2
        vm.expectRevert(TrinityGuardian.ProposalNotPassed.selector);
        guardian.executeProposal(proposalId);
    }

    function test_executeProposal_revertsDoubleExecute() public {
        _completeGenesis();

        vm.prank(node1);
        bytes32 proposalId = guardian.proposeAddNode(node4, "Add");

        vm.prank(node2);
        guardian.vote(proposalId, true);

        guardian.executeProposal(proposalId);

        vm.expectRevert(TrinityGuardian.ProposalAlreadyExecuted.selector);
        guardian.executeProposal(proposalId);
    }

    function test_executeProposal_revertsRemoveBelowMinimum() public {
        _completeGenesis();

        // Remove node3 first — go from 3 to 2
        vm.prank(node1);
        bytes32 pid1 = guardian.proposeRemoveNode(node3, "remove first");

        vm.prank(node2);
        guardian.vote(pid1, true);

        guardian.executeProposal(pid1);
        assertEq(guardian.activeNodeCount(), 2);

        // Now only 2 nodes left, so proposeRemoveNode should revert
        vm.prank(node1);
        vm.expectRevert(TrinityGuardian.CannotRemoveBelowMinimum.selector);
        guardian.proposeRemoveNode(node2, "below min");
    }

    // ============ View Function Tests ============

    function test_consensusThreshold_threeNodes() public {
        _completeGenesis();
        // ceil(3*2/3) = ceil(2) = 2
        assertEq(guardian.consensusThreshold(), 2);
    }

    function test_consensusThreshold_fourNodes() public {
        _completeGenesis();

        // Add a 4th node via consensus
        vm.prank(node1);
        bytes32 pid = guardian.proposeAddNode(node4, "Add 4th");
        vm.prank(node2);
        guardian.vote(pid, true);
        guardian.executeProposal(pid);

        // ceil(4*2/3) = ceil(8/3) = 3
        assertEq(guardian.consensusThreshold(), 3);
    }

    function test_isHealthy_trueAfterGenesis() public {
        _completeGenesis();
        assertTrue(guardian.isHealthy());
    }

    function test_isHealthy_falseBeforeGenesis() public {
        assertFalse(guardian.isHealthy());

        // Register one node
        vm.prank(node1);
        guardian.registerGenesis{value: 0.5 ether}("https://node1.example.com", IDENTITY_1);
        assertFalse(guardian.isHealthy());
    }

    function test_getActiveNodes_returnsCorrectList() public {
        _completeGenesis();

        address[] memory active = guardian.getActiveNodes();
        assertEq(active.length, 3);
        assertEq(active[0], node1);
        assertEq(active[1], node2);
        assertEq(active[2], node3);
    }

    function test_getActiveNodes_excludesRemovedNodes() public {
        _completeGenesis();

        // Remove node3
        vm.prank(node1);
        bytes32 pid = guardian.proposeRemoveNode(node3, "test");
        vm.prank(node2);
        guardian.vote(pid, true);
        guardian.executeProposal(pid);

        address[] memory active = guardian.getActiveNodes();
        assertEq(active.length, 2);
        assertEq(active[0], node1);
        assertEq(active[1], node2);
    }

    // ============ TopUpStake Tests ============

    function test_topUpStake_increasesNodeStake() public {
        _completeGenesis();

        guardian.topUpStake{value: 2 ether}(node1);

        (uint256 stake, , , , , ) = guardian.getNode(node1);
        assertEq(stake, 3 ether); // 1 ether genesis + 2 ether top-up
    }

    function test_topUpStake_anyoneCanTopUp() public {
        _completeGenesis();

        vm.prank(rando);
        guardian.topUpStake{value: 0.5 ether}(node2);

        (uint256 stake, , , , , ) = guardian.getNode(node2);
        assertEq(stake, 1.5 ether);
    }

    function test_topUpStake_revertsForInactiveNode() public {
        vm.expectRevert(TrinityGuardian.NotANode.selector);
        guardian.topUpStake{value: 1 ether}(rando);
    }

    // ============ Receive Ether ============

    function test_receiveEther() public {
        // Contract should accept bare ether transfers
        (bool ok, ) = address(guardian).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(guardian).balance, 1 ether);
    }

    // ============ Full Lifecycle Integration ============

    function test_fullLifecycle_genesisToRemoval() public {
        // 1. Genesis: register 3 nodes
        _completeGenesis();
        assertTrue(guardian.genesisComplete());
        assertTrue(guardian.isHealthy());

        // 2. Heartbeat from all nodes
        vm.warp(block.timestamp + 12 hours);
        vm.prank(node1);
        guardian.heartbeat();
        vm.prank(node2);
        guardian.heartbeat();
        vm.prank(node3);
        guardian.heartbeat();

        // 3. Add 4th node via consensus
        vm.prank(node1);
        bytes32 addPid = guardian.proposeAddNode(node4, "Expand network");
        vm.prank(node2);
        guardian.vote(addPid, true);
        guardian.executeProposal(addPid);
        assertEq(guardian.activeNodeCount(), 4);

        // 4. Node4 tops up stake
        guardian.topUpStake{value: 1 ether}(node4);
        (uint256 node4Stake, , , , , ) = guardian.getNode(node4);
        assertEq(node4Stake, 1 ether);

        // 5. Node3 goes offline — report missed heartbeats
        vm.warp(block.timestamp + 3 * 24 hours + 1);
        guardian.reportMissedHeartbeat(node3);
        (, , , uint256 missed, , ) = guardian.getNode(node3);
        assertGe(missed, 3);

        // 6. Remove node3 via consensus (threshold for 4 nodes = ceil(8/3) = 3)
        vm.prank(node1);
        bytes32 removePid = guardian.proposeRemoveNode(node3, "Offline too long");
        vm.prank(node2);
        guardian.vote(removePid, true);
        vm.prank(node4);
        guardian.vote(removePid, true);

        uint256 node3BalBefore = node3.balance;
        guardian.executeProposal(removePid);

        // Verify removal
        (, , , , bool active, ) = guardian.getNode(node3);
        assertFalse(active);
        assertEq(guardian.activeNodeCount(), 3);
        // Stake returned
        assertEq(node3.balance - node3BalBefore, 1 ether);
    }

    // ============ Fuzz Tests ============

    function testFuzz_registerGenesis_variousStakes(uint256 stakeAmount) public {
        stakeAmount = bound(stakeAmount, 0.1 ether, 10 ether);

        vm.prank(node1);
        guardian.registerGenesis{value: stakeAmount}("https://fuzz.example.com", IDENTITY_1);

        (uint256 stake, , , , bool active, ) = guardian.getNode(node1);
        assertEq(stake, stakeAmount);
        assertTrue(active);
    }

    function testFuzz_consensusThreshold_bftProperty(uint8 nodeCount) public {
        // Threshold must always be > n/2 (strict majority) for BFT
        // Skip nodeCount = 0 since we can't have 0 active nodes
        vm.assume(nodeCount > 0 && nodeCount < 100);

        uint256 n = uint256(nodeCount);
        uint256 threshold = (n * 2 + 2) / 3; // ceil(2n/3)

        // BFT property: threshold > n/2
        assertGt(threshold * 2, n, "BFT threshold must be strict majority");
        // threshold <= n (can't require more votes than nodes)
        assertLe(threshold, n, "Threshold cannot exceed node count");
    }

    // ============ Helper: Destructure Proposal ============

    function _getProposalFields(bytes32 proposalId) internal view returns (
        bytes32 id,
        TrinityGuardian.ProposalAction action,
        address target,
        uint256 votesFor,
        uint256 votesAgainst,
        uint256 createdAt,
        uint256 deadline,
        bool executed
    ) {
        (id, action, target, votesFor, votesAgainst, createdAt, deadline, executed) =
            guardian.proposals(proposalId);
    }
}
