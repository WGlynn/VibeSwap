// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/identity/AGIResistantRecovery.sol";

contract AGIResistantRecoveryFuzzTest is Test {
    AGIResistantRecovery public recovery;
    address public verifier;

    function setUp() public {
        verifier = makeAddr("verifier");

        AGIResistantRecovery impl = new AGIResistantRecovery();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(AGIResistantRecovery.initialize.selector)
        );
        recovery = AGIResistantRecovery(address(proxy));

        vm.warp(8 days);
        recovery.addVerifier(verifier);
    }

    /// @notice Behavioral score is always 0-100
    function testFuzz_behavioralScoreBounded(uint256 txCount, uint256 age) public {
        txCount = bound(txCount, 0, 1000);
        age = bound(age, 0, 1000 days);

        bytes32 timing = keccak256("timing");
        bytes32 graph = keccak256("graph");

        vm.prank(verifier);
        recovery.updateFingerprint(makeAddr("user"), txCount, timing, graph, 20 gwei, 100 ether);

        vm.warp(block.timestamp + age);

        uint256 score = recovery.verifyBehavioralMatch(makeAddr("user"), timing, graph, 20 gwei);
        assertLe(score, 100);
    }

    /// @notice Humanity score is always 0-100
    function testFuzz_humanityScoreBounded(uint256 confidence) public {
        confidence = bound(confidence, 0, 100);

        vm.prank(verifier);
        recovery.submitHumanityProof(1, AGIResistantRecovery.ProofType.HARDWARE_KEY, keccak256("p"), confidence);

        uint256 score = recovery.getHumanityScore(1);
        assertLe(score, 100);
    }

    /// @notice Recovery attempts increment correctly
    function testFuzz_attemptTracking(uint8 attempts) public {
        attempts = uint8(bound(attempts, 1, 3));

        for (uint256 i = 0; i < attempts; i++) {
            vm.warp(block.timestamp + 8 days);
            vm.prank(verifier);
            recovery.recordAttempt(makeAddr("user"));
        }

        assertEq(recovery.recoveryAttempts(makeAddr("user")), attempts);
    }

    /// @notice Challenge count matches issued count
    function testFuzz_challengeCount(uint8 count) public {
        count = uint8(bound(count, 1, 10));

        for (uint256 i = 0; i < count; i++) {
            vm.prank(verifier);
            recovery.issueChallenge(1, AGIResistantRecovery.ChallengeType.RANDOM_PHRASE);
        }

        AGIResistantRecovery.RecoveryChallenge[] memory challenges = recovery.getChallenges(1);
        assertEq(challenges.length, count);
    }

    /// @notice Confidence score is bounded in proofs
    function testFuzz_confidenceValidation(uint256 confidence) public {
        if (confidence > 100) {
            vm.prank(verifier);
            vm.expectRevert("Invalid confidence");
            recovery.submitHumanityProof(1, AGIResistantRecovery.ProofType.HARDWARE_KEY, keccak256("p"), confidence);
        } else {
            vm.prank(verifier);
            recovery.submitHumanityProof(1, AGIResistantRecovery.ProofType.HARDWARE_KEY, keccak256("p"), confidence);
        }
    }
}
