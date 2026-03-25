// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/OmniscientAdversaryDefense.sol";

/**
 * @title OmniscientAdversaryDefense Tests
 * @notice "Even if God is your enemy, the game theory still holds."
 */
contract OmniscientAdversaryDefenseTest is Test {
    OmniscientAdversaryDefense public oad;

    address sentinel1 = makeAddr("sentinel1");
    address sentinel2 = makeAddr("sentinel2");
    address sentinel3 = makeAddr("sentinel3");
    address challenger = makeAddr("challenger");

    function setUp() public {
        oad = new OmniscientAdversaryDefense();
        oad.addSentinel(sentinel1);
        oad.addSentinel(sentinel2);
        oad.addSentinel(sentinel3);
        vm.deal(challenger, 10 ether);
        vm.deal(address(oad), 10 ether); // fund for rewards
    }

    // ============ Temporal Anchoring ============

    function test_setAnchor() public {
        bytes32 root = keccak256("state_root_1");
        vm.prank(sentinel1);
        oad.setAnchor(root, 1000);

        (uint256 bn, , , bytes32 sr, uint256 ms, bool fin) = oad.anchors(block.number);
        assertEq(bn, block.number);
        assertEq(sr, root);
        assertEq(ms, 1000);
        assertFalse(fin); // needs 2 attestations
    }

    function test_nonSentinelCannotAnchor() public {
        address rando = makeAddr("rando");
        vm.prank(rando);
        vm.expectRevert(OmniscientAdversaryDefense.NotSentinel.selector);
        oad.setAnchor(keccak256("fake"), 0);
    }

    function test_anchorFinalizesWith2Attestations() public {
        vm.prank(sentinel1);
        oad.setAnchor(keccak256("root"), 500);
        uint256 anchorBlock = block.number;

        // Second sentinel attests
        vm.prank(sentinel2);
        oad.attestAnchor(anchorBlock);

        (, , , , , bool fin) = oad.anchors(anchorBlock);
        assertTrue(fin, "Should finalize with 2 attestations");
    }

    function test_cannotDoubleAttest() public {
        vm.prank(sentinel1);
        oad.setAnchor(keccak256("root"), 500);
        uint256 anchorBlock = block.number;

        vm.prank(sentinel1);
        vm.expectRevert("Already attested");
        oad.attestAnchor(anchorBlock);
    }

    function test_cannotAnchorTooSoon() public {
        vm.prank(sentinel1);
        oad.setAnchor(keccak256("root1"), 100);

        vm.roll(block.number + 50); // only 50 blocks, need 100
        vm.prank(sentinel1);
        vm.expectRevert("Too soon");
        oad.setAnchor(keccak256("root2"), 200);
    }

    // ============ Causality Proofs ============

    function test_proveCausality() public {
        // Create and finalize first anchor
        vm.prank(sentinel1);
        oad.setAnchor(keccak256("root1"), 100);
        uint256 block1 = block.number;
        vm.prank(sentinel2);
        oad.attestAnchor(block1);

        // Create second anchor
        vm.roll(block.number + 100);
        vm.prank(sentinel1);
        oad.setAnchor(keccak256("root2"), 200);
        uint256 block2 = block.number;

        // Prove causality
        vm.prank(sentinel1);
        bytes32 proofId = oad.proveCausality(block1, block2, keccak256("transitions"), 100);

        (, , , , , , bool valid) = oad.causalityProofs(proofId);
        assertTrue(valid);
    }

    function test_causalityRequiresFinalizedFrom() public {
        vm.prank(sentinel1);
        oad.setAnchor(keccak256("root1"), 100);
        uint256 block1 = block.number;
        // NOT finalized (only 1 attestation)

        vm.roll(block.number + 100);
        vm.prank(sentinel1);
        oad.setAnchor(keccak256("root2"), 200);
        uint256 block2 = block.number;

        vm.prank(sentinel1);
        vm.expectRevert("From anchor not finalized");
        oad.proveCausality(block1, block2, keccak256("transitions"), 100);
    }

    // ============ Integrity Challenges ============

    function test_challengeIntegrity() public {
        vm.prank(sentinel1);
        oad.setAnchor(keccak256("root"), 100);
        uint256 anchorBlock = block.number;

        vm.prank(challenger);
        bytes32 challengeId = oad.challengeIntegrity{value: 0.01 ether}(anchorBlock, keccak256("wrong_root"));

        (bytes32 cid, address ch, uint256 ab, , , , bool resolved, ) = oad.challenges(challengeId);
        assertEq(cid, challengeId);
        assertEq(ch, challenger);
        assertEq(ab, anchorBlock);
        assertFalse(resolved);
    }

    function test_challengeNeedsStake() public {
        vm.prank(sentinel1);
        oad.setAnchor(keccak256("root"), 100);

        vm.prank(challenger);
        vm.expectRevert("Stake required");
        oad.challengeIntegrity{value: 0.001 ether}(block.number, keccak256("wrong"));
    }

    function test_resolveChallengeFraudProven() public {
        vm.prank(sentinel1);
        oad.setAnchor(keccak256("root"), 100);
        uint256 anchorBlock = block.number;
        vm.prank(sentinel2);
        oad.attestAnchor(anchorBlock);

        // Finalized anchor
        (, , , , , bool finBefore) = oad.anchors(anchorBlock);
        assertTrue(finBefore);

        // Challenge
        vm.prank(challenger);
        bytes32 challengeId = oad.challengeIntegrity{value: 0.01 ether}(anchorBlock, keccak256("wrong"));

        uint256 challengerBefore = challenger.balance;

        // Resolve as fraud
        vm.prank(sentinel1);
        oad.resolveChallenge(challengeId, true);

        // Anchor de-finalized
        (, , , , , bool finAfter) = oad.anchors(anchorBlock);
        assertFalse(finAfter, "Fraud should de-finalize anchor");

        // Challenger rewarded
        assertEq(challenger.balance - challengerBefore, 0.02 ether);
    }

    function test_resolveChallengeFalseAlarm() public {
        vm.prank(sentinel1);
        oad.setAnchor(keccak256("root"), 100);
        uint256 anchorBlock = block.number;

        vm.prank(challenger);
        bytes32 challengeId = oad.challengeIntegrity{value: 0.01 ether}(anchorBlock, keccak256("wrong"));

        uint256 challengerBefore = challenger.balance;

        // Resolve as no fraud
        vm.prank(sentinel1);
        oad.resolveChallenge(challengeId, false);

        // Challenger loses stake (no reward)
        assertEq(challenger.balance, challengerBefore);
    }

    function test_cannotResolveAlready() public {
        vm.prank(sentinel1);
        oad.setAnchor(keccak256("root"), 100);

        vm.prank(challenger);
        bytes32 cid = oad.challengeIntegrity{value: 0.01 ether}(block.number, keccak256("x"));

        vm.prank(sentinel1);
        oad.resolveChallenge(cid, false);

        vm.prank(sentinel1);
        vm.expectRevert(OmniscientAdversaryDefense.ChallengeAlreadyResolved.selector);
        oad.resolveChallenge(cid, false);
    }
}
