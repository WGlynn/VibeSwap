// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../contracts/identity/AGIResistantRecovery.sol";

contract AGIResistantRecoveryTest is Test {
    AGIResistantRecovery public recovery;
    address public verifier;
    address public user1;

    function setUp() public {
        verifier = makeAddr("verifier");
        user1 = makeAddr("user1");

        AGIResistantRecovery impl = new AGIResistantRecovery();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(AGIResistantRecovery.initialize.selector)
        );
        recovery = AGIResistantRecovery(address(proxy));

        // Warp past the implicit cooldown (lastAttemptTime=0 + ATTEMPT_COOLDOWN=7d)
        vm.warp(8 days);

        recovery.addVerifier(verifier);
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(recovery.MIN_ACCOUNT_AGE(), 30 days);
        assertEq(recovery.MIN_TX_COUNT(), 10);
        assertEq(recovery.MAX_RECOVERY_ATTEMPTS(), 3);
        assertEq(recovery.ATTEMPT_COOLDOWN(), 7 days);
        assertEq(recovery.BOND_AMOUNT(), 1 ether);
        assertEq(recovery.NOTIFICATION_DELAY(), 24 hours);
        assertEq(recovery.CHALLENGE_WINDOW(), 48 hours);
    }

    function test_defaultProofRequirements() public view {
        assertEq(recovery.minProofsRequired(uint8(AGIResistantRecovery.ProofType.HARDWARE_KEY)), 1);
        assertEq(recovery.minProofsRequired(uint8(AGIResistantRecovery.ProofType.VIDEO_VERIFICATION)), 1);
        assertEq(recovery.minProofsRequired(uint8(AGIResistantRecovery.ProofType.SOCIAL_VOUCHING)), 3);
    }

    // ============ Verifier Management ============

    function test_addVerifier() public view {
        assertTrue(recovery.trustedVerifiers(verifier));
    }

    function test_removeVerifier() public {
        recovery.removeVerifier(verifier);
        assertFalse(recovery.trustedVerifiers(verifier));
    }

    function test_addVerifier_onlyOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        recovery.addVerifier(user1);
    }

    // ============ Behavioral Fingerprinting ============

    function test_updateFingerprint() public {
        bytes32 timing = keccak256("timing");
        bytes32 graph = keccak256("graph");

        vm.prank(verifier);
        recovery.updateFingerprint(user1, 50, timing, graph, 20 gwei, 100 ether);

        (uint256 firstSeen, uint256 txCount, bytes32 timingPattern, bytes32 interactionGraph, uint256 avgGas, uint256 totalValue) = recovery.fingerprints(user1);

        assertEq(txCount, 50);
        assertEq(timingPattern, timing);
        assertEq(interactionGraph, graph);
        assertEq(avgGas, 20 gwei);
        assertEq(totalValue, 100 ether);
        assertGt(firstSeen, 0);
    }

    function test_updateFingerprint_preservesFirstSeen() public {
        vm.prank(verifier);
        recovery.updateFingerprint(user1, 10, bytes32(0), bytes32(0), 0, 0);

        (uint256 firstSeen1,,,,, ) = recovery.fingerprints(user1);

        vm.warp(block.timestamp + 1 days);

        vm.prank(verifier);
        recovery.updateFingerprint(user1, 20, bytes32(0), bytes32(0), 0, 0);

        (uint256 firstSeen2,,,,, ) = recovery.fingerprints(user1);

        assertEq(firstSeen1, firstSeen2); // firstSeen should not change
    }

    function test_updateFingerprint_unauthorized() public {
        vm.prank(user1);
        vm.expectRevert("Not authorized");
        recovery.updateFingerprint(user1, 10, bytes32(0), bytes32(0), 0, 0);
    }

    function test_updateFingerprint_ownerCanCall() public {
        // Owner can also call
        recovery.updateFingerprint(user1, 10, bytes32(0), bytes32(0), 0, 0);

        (, uint256 txCount,,,, ) = recovery.fingerprints(user1);
        assertEq(txCount, 10);
    }

    // ============ Behavioral Match Verification ============

    function test_verifyBehavioralMatch_noFingerprint() public view {
        uint256 score = recovery.verifyBehavioralMatch(user1, bytes32(0), bytes32(0), 0);
        assertEq(score, 0);
    }

    function test_verifyBehavioralMatch_fullMatch() public {
        bytes32 timing = keccak256("timing");
        bytes32 graph = keccak256("graph");

        vm.prank(verifier);
        recovery.updateFingerprint(user1, 200, timing, graph, 20 gwei, 100 ether);

        // Age the account > 365 days
        vm.warp(block.timestamp + 400 days);

        uint256 score = recovery.verifyBehavioralMatch(user1, timing, graph, 20 gwei);
        // 20 (age >365d) + 20 (txCount >100) + 25 (timing match) + 20 (graph match) + 15 (gas match) = 100
        assertEq(score, 100);
    }

    function test_verifyBehavioralMatch_partialMatch() public {
        bytes32 timing = keccak256("timing");
        bytes32 graph = keccak256("graph");

        vm.prank(verifier);
        recovery.updateFingerprint(user1, 200, timing, graph, 20 gwei, 100 ether);

        vm.warp(block.timestamp + 400 days);

        // Different graph and gas
        uint256 score = recovery.verifyBehavioralMatch(user1, timing, keccak256("different"), 100 gwei);
        // 20 (age) + 20 (txCount) + 25 (timing match) = 65
        assertEq(score, 65);
    }

    // ============ Challenge System ============

    function test_issueChallenge() public {
        vm.prank(verifier);
        bytes32 hash = recovery.issueChallenge(1, AGIResistantRecovery.ChallengeType.RANDOM_PHRASE);

        assertTrue(hash != bytes32(0));

        AGIResistantRecovery.RecoveryChallenge[] memory challenges = recovery.getChallenges(1);
        assertEq(challenges.length, 1);
        assertFalse(challenges[0].completed);
        assertEq(challenges[0].deadline, block.timestamp + 48 hours);
    }

    function test_issueChallenge_unauthorized() public {
        vm.prank(user1);
        vm.expectRevert("Not authorized");
        recovery.issueChallenge(1, AGIResistantRecovery.ChallengeType.RANDOM_PHRASE);
    }

    function test_verifyChallengeResponse() public {
        vm.prank(verifier);
        recovery.issueChallenge(1, AGIResistantRecovery.ChallengeType.RANDOM_PHRASE);

        bytes32 response = keccak256("correct answer");
        vm.prank(verifier);
        bool success = recovery.verifyChallengeResponse(1, 0, response);

        assertTrue(success);
        assertEq(recovery.getCompletedChallengeCount(1), 1);
    }

    function test_verifyChallengeResponse_expired() public {
        vm.prank(verifier);
        recovery.issueChallenge(1, AGIResistantRecovery.ChallengeType.RANDOM_PHRASE);

        vm.warp(block.timestamp + 49 hours);

        vm.prank(verifier);
        vm.expectRevert("Challenge expired");
        recovery.verifyChallengeResponse(1, 0, keccak256("late"));
    }

    function test_verifyChallengeResponse_alreadyCompleted() public {
        vm.prank(verifier);
        recovery.issueChallenge(1, AGIResistantRecovery.ChallengeType.RANDOM_PHRASE);

        vm.prank(verifier);
        recovery.verifyChallengeResponse(1, 0, keccak256("answer"));

        vm.prank(verifier);
        vm.expectRevert("Already completed");
        recovery.verifyChallengeResponse(1, 0, keccak256("again"));
    }

    // ============ Humanity Proof ============

    function test_submitHumanityProof() public {
        vm.prank(verifier);
        recovery.submitHumanityProof(1, AGIResistantRecovery.ProofType.HARDWARE_KEY, keccak256("proof"), 90);

        AGIResistantRecovery.HumanityProof[] memory proofs = recovery.getHumanityProofs(1);
        assertEq(proofs.length, 1);
        assertEq(proofs[0].confidenceScore, 90);
        assertEq(proofs[0].verifier, verifier);
    }

    function test_submitHumanityProof_invalidConfidence() public {
        vm.prank(verifier);
        vm.expectRevert("Invalid confidence");
        recovery.submitHumanityProof(1, AGIResistantRecovery.ProofType.HARDWARE_KEY, keccak256("proof"), 101);
    }

    function test_getHumanityScore() public {
        // Submit hardware key proof (weight 30) with confidence 80
        vm.prank(verifier);
        recovery.submitHumanityProof(1, AGIResistantRecovery.ProofType.HARDWARE_KEY, keccak256("p1"), 80);

        // Submit video proof (weight 35) with confidence 90
        vm.prank(verifier);
        recovery.submitHumanityProof(1, AGIResistantRecovery.ProofType.VIDEO_VERIFICATION, keccak256("p2"), 90);

        uint256 score = recovery.getHumanityScore(1);
        // Weighted average: (80*30 + 90*35) / (30+35) = (2400+3150)/65 = 5550/65 = 85
        assertEq(score, 85);
    }

    function test_getHumanityScore_noProofs() public view {
        assertEq(recovery.getHumanityScore(999), 0);
    }

    // ============ Recovery Attempt Tracking ============

    function test_canAttemptRecovery() public view {
        (bool can, ) = recovery.canAttemptRecovery(user1);
        assertTrue(can);
    }

    function test_recordAttempt() public {
        vm.prank(verifier);
        recovery.recordAttempt(user1);
        assertEq(recovery.recoveryAttempts(user1), 1);
    }

    function test_maxAttemptsExceeded() public {
        for (uint256 i = 0; i < 3; i++) {
            vm.warp(block.timestamp + 8 days);
            vm.prank(verifier);
            recovery.recordAttempt(user1);
        }

        (bool can, string memory reason) = recovery.canAttemptRecovery(user1);
        assertFalse(can);
        assertEq(reason, "Max attempts exceeded");
    }

    function test_cooldownNotElapsed() public {
        vm.prank(verifier);
        recovery.recordAttempt(user1);

        (bool can, string memory reason) = recovery.canAttemptRecovery(user1);
        assertFalse(can);
        assertEq(reason, "Cooldown not elapsed");
    }

    function test_cooldownElapsed() public {
        vm.prank(verifier);
        recovery.recordAttempt(user1);

        vm.warp(block.timestamp + 8 days);

        (bool can, ) = recovery.canAttemptRecovery(user1);
        assertTrue(can);
    }

    // ============ Suspicious Activity Detection ============

    function test_detectSuspicious_newAccount() public view {
        (bool suspicious, string memory indicator) = recovery.detectSuspiciousActivity(user1, block.timestamp, bytes32(0));
        assertTrue(suspicious);
        assertEq(indicator, "Account too new");
    }

    function test_detectSuspicious_roundTimestamp() public {
        // Register fingerprint so account isn't "too new"
        vm.prank(verifier);
        recovery.updateFingerprint(user1, 100, bytes32(0), bytes32(0), 0, 0);
        vm.warp(block.timestamp + 31 days);

        (bool suspicious, string memory indicator) = recovery.detectSuspiciousActivity(user1, 1000, bytes32(0));
        assertTrue(suspicious);
        assertEq(indicator, "Suspiciously round timestamp");
    }

    function test_detectSuspicious_insufficientHistory() public {
        vm.prank(verifier);
        recovery.updateFingerprint(user1, 5, bytes32(0), bytes32(0), 0, 0);
        vm.warp(block.timestamp + 31 days);

        // Use non-round timestamp
        (bool suspicious, string memory indicator) = recovery.detectSuspiciousActivity(user1, block.timestamp + 1, bytes32(0));
        assertTrue(suspicious);
        assertEq(indicator, "Insufficient history");
    }

    function test_detectSuspicious_clean() public {
        vm.prank(verifier);
        recovery.updateFingerprint(user1, 100, bytes32(0), bytes32(0), 0, 0);
        vm.warp(block.timestamp + 31 days);

        (bool suspicious, ) = recovery.detectSuspiciousActivity(user1, block.timestamp + 1, bytes32(0));
        assertFalse(suspicious);
    }

    // ============ Hardware Key Registration ============

    function test_registerHardwareKey() public {
        vm.prank(user1);
        recovery.registerHardwareKey(user1, keccak256("keyId"), "");
        // No revert = success (event emitted)
    }

    function test_registerHardwareKey_byVerifier() public {
        vm.prank(verifier);
        recovery.registerHardwareKey(user1, keccak256("keyId"), "");
    }

    // ============ Recovery Notification ============

    function test_emitRecoveryNotification() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(verifier);
        recovery.emitRecoveryNotification(1, user1, newOwner, block.timestamp + 7 days);
        // No revert = success
    }

    function test_emitRecoveryNotification_unauthorized() public {
        vm.prank(user1);
        vm.expectRevert("Not authorized");
        recovery.emitRecoveryNotification(1, user1, makeAddr("newOwner"), block.timestamp + 7 days);
    }
}
