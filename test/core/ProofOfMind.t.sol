// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/ProofOfMind.sol";

/**
 * @title ProofOfMind Tests — PoW/PoS/PoM Hybrid Consensus
 * @notice Tests the three-layer security model and mind-weighted consensus.
 *         "The only way to hack the system is to contribute to it." — Will
 */
contract ProofOfMindTest is Test {
    ProofOfMind public pom;

    address node1 = makeAddr("node1");
    address node2 = makeAddr("node2");
    address node3 = makeAddr("node3");

    function setUp() public {
        pom = new ProofOfMind();
        // Lower PoW difficulty for tests: slot 7 = currentDifficulty, 8 = ~256 avg iterations
        vm.store(address(pom), bytes32(uint256(7)), bytes32(uint256(8)));
        vm.deal(node1, 100 ether);
        vm.deal(node2, 100 ether);
        vm.deal(node3, 100 ether);
    }

    // ============ Node Management ============

    function test_joinNetwork() public {
        vm.prank(node1);
        pom.joinNetwork{value: 1 ether}(0);

        (address addr, uint256 stake, uint256 mind, , , , , bool active, ) = pom.mindNodes(node1);
        assertEq(addr, node1);
        assertEq(stake, 1 ether);
        assertEq(mind, 0);
        assertTrue(active);
        assertEq(pom.activeNodeCount(), 1);
    }

    function test_joinWithMindScore() public {
        vm.prank(node1);
        pom.joinNetwork{value: 1 ether}(500e18); // imported mind score

        (, , uint256 mind, , , , , , ) = pom.mindNodes(node1);
        assertEq(mind, 500e18);
    }

    function test_cannotJoinBelowMinStake() public {
        vm.prank(node1);
        vm.expectRevert(ProofOfMind.InsufficientStake.selector);
        pom.joinNetwork{value: 0.001 ether}(0); // MIN_STAKE = 0.01 ether
    }

    function test_cannotJoinTwice() public {
        vm.prank(node1);
        pom.joinNetwork{value: 1 ether}(0);

        vm.prank(node1);
        vm.expectRevert(ProofOfMind.AlreadyRegistered.selector);
        pom.joinNetwork{value: 1 ether}(0);
    }

    function test_exitReturnsStake() public {
        vm.prank(node1);
        pom.joinNetwork{value: 5 ether}(0);

        uint256 before = node1.balance;
        vm.prank(node1);
        pom.exitNetwork();

        assertEq(node1.balance - before, 5 ether);
        assertEq(pom.activeNodeCount(), 0);
    }

    function test_inactiveCannotExit() public {
        vm.prank(node1);
        vm.expectRevert(ProofOfMind.NotActive.selector);
        pom.exitNetwork();
    }

    // ============ Mind Score (PoM) ============

    function test_recordContribution() public {
        vm.prank(node1);
        pom.joinNetwork{value: 1 ether}(0);

        bytes32 contribHash = keccak256("code_commit_1");

        vm.prank(node1);
        pom.recordContribution(node1, contribHash, 100);

        (, , uint256 mind, , , , , , ) = pom.mindNodes(node1);
        assertGt(mind, 0, "Mind score should increase");
        assertEq(pom.contributionCount(node1), 1);
        assertTrue(pom.verifiedContributions(contribHash));
    }

    function test_duplicateContributionIgnored() public {
        vm.prank(node1);
        pom.joinNetwork{value: 1 ether}(0);

        bytes32 contribHash = keccak256("same_work");

        vm.prank(node1);
        pom.recordContribution(node1, contribHash, 100);

        (, , uint256 mindAfter1, , , , , , ) = pom.mindNodes(node1);

        vm.prank(node1);
        pom.recordContribution(node1, contribHash, 100); // duplicate

        (, , uint256 mindAfter2, , , , , , ) = pom.mindNodes(node1);
        assertEq(mindAfter1, mindAfter2, "Duplicate should not increase score");
    }

    // ============ Consensus Rounds ============

    function test_startRound() public {
        vm.prank(node1);
        pom.joinNetwork{value: 1 ether}(0);

        vm.prank(node1);
        uint256 roundId = pom.startRound(keccak256("proposal_1"), 1 hours);

        assertEq(roundId, 1);
        assertEq(pom.currentRound(), 1);
    }

    function test_castVoteWithPoW() public {
        vm.prank(node1);
        pom.joinNetwork{value: 1 ether}(100e18);

        vm.prank(node1);
        pom.startRound(keccak256("topic"), 1 hours);

        // Find a valid PoW nonce
        bytes32 value = keccak256("my_vote");
        uint256 nonce = _findPowNonce(node1, 1, value);

        vm.prank(node1);
        pom.castVote(1, value, nonce);

        // Verify vote recorded
        (bytes32 v, uint256 w, , ) = pom.votes(1, node1);
        assertEq(v, value);
        assertGt(w, 0);
    }

    function test_cannotVoteTwice() public {
        vm.prank(node1);
        pom.joinNetwork{value: 1 ether}(0);
        vm.prank(node1);
        pom.startRound(keccak256("topic"), 1 hours);

        bytes32 value = keccak256("vote");
        uint256 nonce = _findPowNonce(node1, 1, value);
        vm.prank(node1);
        pom.castVote(1, value, nonce);

        bytes32 value2 = keccak256("vote2");
        uint256 nonce2 = _findPowNonce(node1, 1, value2);
        vm.prank(node1);
        vm.expectRevert(ProofOfMind.AlreadyVoted.selector);
        pom.castVote(1, value2, nonce2);
    }

    function test_finalizeRound() public {
        // Setup nodes
        vm.prank(node1);
        pom.joinNetwork{value: 2 ether}(200e18);
        vm.prank(node2);
        pom.joinNetwork{value: 1 ether}(100e18);

        // Start round
        vm.prank(node1);
        pom.startRound(keccak256("topic"), 1 hours);

        bytes32 valueA = keccak256("A");
        bytes32 valueB = keccak256("B");

        // Node1 (heavier) votes A
        uint256 nonce1 = _findPowNonce(node1, 1, valueA);
        vm.prank(node1);
        pom.castVote(1, valueA, nonce1);

        // Node2 (lighter) votes B
        uint256 nonce2 = _findPowNonce(node2, 1, valueB);
        vm.prank(node2);
        pom.castVote(1, valueB, nonce2);

        // Fast-forward past round end
        vm.warp(block.timestamp + 2 hours);

        bytes32[] memory candidates = new bytes32[](2);
        candidates[0] = valueA;
        candidates[1] = valueB;
        pom.finalizeRound(1, candidates);

        (bytes32 winner, , , bool finalized) = pom.getRoundResult(1);
        assertTrue(finalized);
        assertEq(winner, valueA, "Heavier node should win");
    }

    // ============ Vote Weight ============

    function test_voteWeightFormula() public {
        // Node with high mind score should have more weight than high stake
        vm.prank(node1);
        pom.joinNetwork{value: 10 ether}(0); // high stake, no mind

        vm.prank(node2);
        pom.joinNetwork{value: 0.01 ether}(1000e18); // min stake, high mind

        uint256 w1 = pom.getVoteWeight(node1);
        uint256 w2 = pom.getVoteWeight(node2);

        // Node2 should have higher weight — 60% comes from mind
        assertGt(w2, w1, "Knowledge > capital");
    }

    // ============ Equivocation ============

    function test_equivocationSlashes() public {
        vm.prank(node1);
        pom.joinNetwork{value: 10 ether}(100e18);

        vm.prank(node1);
        pom.startRound(keccak256("topic"), 1 hours);

        bytes32 v1 = keccak256("A");
        bytes32 v2 = keccak256("B");

        uint256 nonce1 = _findPowNonce(node1, 1, v1);
        uint256 nonce2 = _findPowNonce(node1, 1, v2);

        // Report equivocation
        pom.reportEquivocation(node1, 1, v1, nonce1, v2, nonce2);

        (, uint256 stake, uint256 mind, , , , , , bool slashed) = pom.mindNodes(node1);
        assertTrue(slashed);
        assertEq(stake, 5 ether); // 50% slashed
        assertEq(mind, 25e18);    // 75% mind score lost
    }

    // ============ Meta Nodes ============

    function test_registerMetaNode() public {
        address[] memory peers = new address[](1);
        peers[0] = node1;

        address metaNode = makeAddr("metaNode");
        vm.prank(metaNode);
        pom.registerMetaNode("http://localhost:8080", peers);

        (address addr, , , , bool active) = pom.metaNodes(metaNode);
        assertEq(addr, metaNode);
        assertTrue(active);
    }

    function test_metaNodeSync() public {
        address[] memory peers = new address[](0);
        address metaNode = makeAddr("metaNode");
        vm.prank(metaNode);
        pom.registerMetaNode("http://localhost:8080", peers);

        vm.prank(metaNode);
        pom.reportSync(42);

        (, , uint256 synced, , ) = pom.metaNodes(metaNode);
        assertEq(synced, 42);
    }

    function test_deactivateMetaNode() public {
        address[] memory peers = new address[](0);
        address metaNode = makeAddr("metaNode");
        vm.prank(metaNode);
        pom.registerMetaNode("http://localhost:8080", peers);

        vm.prank(metaNode);
        pom.deactivateMetaNode();

        (, , , , bool active) = pom.metaNodes(metaNode);
        assertFalse(active);
    }

    // ============ Attack Cost ============

    function test_attackCostScalesWithNetwork() public {
        vm.prank(node1);
        pom.joinNetwork{value: 10 ether}(1000e18);
        vm.prank(node2);
        pom.joinNetwork{value: 10 ether}(1000e18);

        (uint256 stakeNeeded, , uint256 mindNeeded, ) = pom.getAttackCost();
        assertEq(stakeNeeded, 10 ether + 1);
        assertEq(mindNeeded, 1000e18 + 1);
    }

    // ============ Helper ============

    function _findPowNonce(address node, uint256 roundId, bytes32 value) internal view returns (uint256) {
        uint256 difficulty = pom.currentDifficulty();
        uint256 threshold = type(uint256).max >> difficulty;

        for (uint256 nonce = 0; nonce < 2_000_000; nonce++) {
            bytes32 h = keccak256(abi.encodePacked(node, roundId, value, nonce, block.chainid));
            if (uint256(h) <= threshold) return nonce;
        }
        revert("Could not find PoW nonce");
    }
}
