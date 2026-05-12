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

    // ============ Mind Score (PoM) — AA#2 CRIT-1 k-of-n attestation ============

    /// @dev Helper: join all three test nodes and return them as attesters.
    function _joinThreeAttesters() internal returns (address[3] memory) {
        vm.prank(node1); pom.joinNetwork{value: 1 ether}(0);
        vm.prank(node2); pom.joinNetwork{value: 1 ether}(0);
        vm.prank(node3); pom.joinNetwork{value: 1 ether}(0);
        return [node1, node2, node3];
    }

    function test_recordContribution_requiresMinAttesters() public {
        _joinThreeAttesters();
        bytes32 contribHash = keccak256("code_commit_1");

        // First attestation: no finalization yet
        vm.prank(node2);
        pom.recordContribution(node1, contribHash, 100);
        (, , uint256 mindAfter1, , , , , , ) = pom.mindNodes(node1);
        assertEq(mindAfter1, 0, "Single attester must not finalize");
        assertEq(pom.contributionCount(node1), 0);
        assertFalse(pom.verifiedContributions(contribHash));

        // Second attestation: still no finalization
        vm.prank(node3);
        pom.recordContribution(node1, contribHash, 100);
        (, , uint256 mindAfter2, , , , , , ) = pom.mindNodes(node1);
        assertEq(mindAfter2, 0, "Two attesters must not finalize");

        // Third attestation: threshold reached, finalizes
        vm.prank(node1);
        pom.recordContribution(node1, contribHash, 100);
        (, , uint256 mindAfter3, , , , , , ) = pom.mindNodes(node1);
        assertGt(mindAfter3, 0, "Mind score should increase at threshold");
        assertEq(pom.contributionCount(node1), 1);
        assertTrue(pom.verifiedContributions(contribHash));
    }

    /// @dev The core AA#2 CRIT-1 attack vector: single node tries to self-mint
    ///      arbitrary mindScore. Pre-fix this succeeded; post-fix it stalls
    ///      forever at attesterCount=1.
    function test_recordContribution_singleNodeCannotSelfMint() public {
        vm.prank(node1);
        pom.joinNetwork{value: 1 ether}(0);

        bytes32 contribHash = keccak256("self_mint_attempt");

        vm.prank(node1);
        pom.recordContribution(node1, contribHash, type(uint256).max);

        (, , uint256 mind, , , , , , ) = pom.mindNodes(node1);
        assertEq(mind, 0, "Self-attestation must not credit mindScore");
        assertFalse(pom.verifiedContributions(contribHash));

        // Cannot re-attest as the same node
        vm.prank(node1);
        vm.expectRevert(ProofOfMind.AlreadyAttested.selector);
        pom.recordContribution(node1, contribHash, type(uint256).max);
    }

    function test_recordContribution_revertsOnValueMismatch() public {
        _joinThreeAttesters();
        bytes32 contribHash = keccak256("disputed_value");

        // First attester proposes 100
        vm.prank(node2);
        pom.recordContribution(node1, contribHash, 100);

        // Second attester tries 200 → revert
        vm.prank(node3);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProofOfMind.AttestationValueMismatch.selector,
                uint256(100),
                uint256(200)
            )
        );
        pom.recordContribution(node1, contribHash, 200);
    }

    function test_recordContribution_revertsDuplicateAttesterSameTuple() public {
        _joinThreeAttesters();
        bytes32 contribHash = keccak256("dup_attester");

        vm.prank(node2);
        pom.recordContribution(node1, contribHash, 100);

        vm.prank(node2);
        vm.expectRevert(ProofOfMind.AlreadyAttested.selector);
        pom.recordContribution(node1, contribHash, 100);
    }

    function test_recordContribution_finalizedCallIsNoop() public {
        _joinThreeAttesters();
        bytes32 contribHash = keccak256("once_done");

        vm.prank(node2); pom.recordContribution(node1, contribHash, 100);
        vm.prank(node3); pom.recordContribution(node1, contribHash, 100);
        vm.prank(node1); pom.recordContribution(node1, contribHash, 100);
        // Finalized.

        (, , uint256 mindBefore, , , , , , ) = pom.mindNodes(node1);
        uint256 countBefore = pom.contributionCount(node1);

        // Join a fourth node and try to attest after finalization → no-op (silent)
        address node4 = makeAddr("node4");
        vm.deal(node4, 100 ether);
        vm.prank(node4); pom.joinNetwork{value: 1 ether}(0);

        vm.prank(node4);
        pom.recordContribution(node1, contribHash, 100); // already finalized
        (, , uint256 mindAfter, , , , , , ) = pom.mindNodes(node1);
        assertEq(mindAfter, mindBefore, "Post-finalize attestation must not credit");
        assertEq(pom.contributionCount(node1), countBefore);
    }

    function test_recordContribution_revertsNonActiveCaller() public {
        _joinThreeAttesters();
        bytes32 contribHash = keccak256("outsider");

        address outsider = makeAddr("outsider");
        vm.prank(outsider);
        vm.expectRevert(ProofOfMind.NotActive.selector);
        pom.recordContribution(node1, contribHash, 100);
    }

    function test_recordContribution_independentContributorsAccumulateSeparately() public {
        _joinThreeAttesters();
        bytes32 contribHash = keccak256("shared_hash");

        // Three attest contribution credited to node1
        vm.prank(node2); pom.recordContribution(node1, contribHash, 100);
        vm.prank(node3); pom.recordContribution(node1, contribHash, 100);
        vm.prank(node1); pom.recordContribution(node1, contribHash, 100);

        (, , uint256 mind1, , , , , , ) = pom.mindNodes(node1);
        (, , uint256 mind2, , , , , , ) = pom.mindNodes(node2);
        assertGt(mind1, 0);
        assertEq(mind2, 0, "node2 was an attester, not the contributor");
    }

    function test_recordContribution_attesterCountIncrementsAcrossDistinctNodes() public {
        _joinThreeAttesters();
        bytes32 contribHash = keccak256("counter_test");

        vm.prank(node2); pom.recordContribution(node1, contribHash, 100);
        (uint256 v1, uint256 c1, bool f1) = pom.attestationState(contribHash, node1);
        assertEq(v1, 100); assertEq(c1, 1); assertFalse(f1);

        vm.prank(node3); pom.recordContribution(node1, contribHash, 100);
        (uint256 v2, uint256 c2, bool f2) = pom.attestationState(contribHash, node1);
        assertEq(v2, 100); assertEq(c2, 2); assertFalse(f2);

        vm.prank(node1); pom.recordContribution(node1, contribHash, 100);
        (uint256 v3, uint256 c3, bool f3) = pom.attestationState(contribHash, node1);
        assertEq(v3, 100); assertEq(c3, 3); assertTrue(f3);
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
