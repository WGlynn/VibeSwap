// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/reputation/BehavioralReputationVerifier.sol";

contract BehavioralReputationVerifierTest is Test {
    BehavioralReputationVerifier public verifier;

    address public submitterAddr = makeAddr("submitter");
    address public recorder = makeAddr("recorder");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    uint256 constant BOND = 1 ether;
    uint256 constant DISPUTE_WINDOW = 1 hours;

    function setUp() public {
        BehavioralReputationVerifier impl = new BehavioralReputationVerifier();
        bytes memory initData = abi.encodeCall(
            BehavioralReputationVerifier.initialize,
            (DISPUTE_WINDOW, BOND, 100) // 100 actions per epoch rate limit
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        verifier = BehavioralReputationVerifier(payable(address(proxy)));

        verifier.authorizeRecorder(recorder);

        // Bond the submitter
        vm.deal(submitterAddr, 10 ether);
        vm.prank(submitterAddr);
        verifier.bond{value: BOND}();
    }

    function _makeReport(uint256 score, IBehavioralReputation.TrustTier tier) internal view returns (IBehavioralReputation.BehaviorReport memory) {
        return IBehavioralReputation.BehaviorReport({
            trustScore: score,
            tier: tier,
            epoch: verifier.currentEpoch(),
            totalFlags: 0,
            criticalFlags: 0,
            reportHash: keccak256(abi.encode(score, tier))
        });
    }

    function _submitEpoch(
        uint64 epoch,
        address[] memory users,
        IBehavioralReputation.BehaviorReport[] memory reports
    ) internal {
        IBehavioralReputation.FraudFlag[][] memory flags = new IBehavioralReputation.FraudFlag[][](users.length);
        IBehavioralReputation.Severity[][] memory severities = new IBehavioralReputation.Severity[][](users.length);

        for (uint256 i = 0; i < users.length; i++) {
            flags[i] = new IBehavioralReputation.FraudFlag[](0);
            severities[i] = new IBehavioralReputation.Severity[](0);
        }

        bytes32 merkleRoot = keccak256(abi.encode(users, reports));

        vm.prank(submitterAddr);
        verifier.submitBehaviorEpoch(epoch, users, reports, flags, severities, merkleRoot);
    }

    // ============ Submit + Finalize ============

    function test_submitAndFinalize() public {
        address[] memory users = new address[](2);
        users[0] = alice;
        users[1] = bob;

        IBehavioralReputation.BehaviorReport[] memory reports = new IBehavioralReputation.BehaviorReport[](2);
        reports[0] = _makeReport(85, IBehavioralReputation.TrustTier.TRUSTED);
        reports[1] = _makeReport(45, IBehavioralReputation.TrustTier.CAUTIOUS);

        _submitEpoch(1, users, reports);

        // Cannot finalize during dispute window
        vm.expectRevert();
        verifier.finalizeEpoch(1);

        // Warp past dispute window
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        verifier.finalizeEpoch(1);

        // Reports are now canonical
        IBehavioralReputation.BehaviorReport memory aliceReport = verifier.getBehaviorReport(alice);
        assertEq(aliceReport.trustScore, 85);
        assertEq(uint8(aliceReport.tier), uint8(IBehavioralReputation.TrustTier.TRUSTED));

        IBehavioralReputation.BehaviorReport memory bobReport = verifier.getBehaviorReport(bob);
        assertEq(bobReport.trustScore, 45);
        assertEq(uint8(bobReport.tier), uint8(IBehavioralReputation.TrustTier.CAUTIOUS));
    }

    // ============ IReputationOracle ============

    function test_implementsIReputationOracle() public {
        address[] memory users = new address[](1);
        users[0] = alice;
        IBehavioralReputation.BehaviorReport[] memory reports = new IBehavioralReputation.BehaviorReport[](1);
        reports[0] = _makeReport(80, IBehavioralReputation.TrustTier.TRUSTED);

        _submitEpoch(1, users, reports);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        verifier.finalizeEpoch(1);

        // getTrustScore scaled to 0-10000 (80 * 100 = 8000)
        assertEq(verifier.getTrustScore(alice), 8000);

        // getTrustTier = TRUSTED = 4
        assertEq(verifier.getTrustTier(alice), 4);

        // isEligible: TRUSTED(4) >= CAUTIOUS(2) = true
        assertTrue(verifier.isEligible(alice, 2));
        // isEligible: TRUSTED(4) >= TRUSTED(4) = true
        assertTrue(verifier.isEligible(alice, 4));
    }

    // ============ Fraud Flags ============

    function test_fraudFlags() public {
        address[] memory users = new address[](1);
        users[0] = alice;
        IBehavioralReputation.BehaviorReport[] memory reports = new IBehavioralReputation.BehaviorReport[](1);
        reports[0] = _makeReport(25, IBehavioralReputation.TrustTier.SUSPICIOUS);

        IBehavioralReputation.FraudFlag[][] memory flags = new IBehavioralReputation.FraudFlag[][](1);
        flags[0] = new IBehavioralReputation.FraudFlag[](2);
        flags[0][0] = IBehavioralReputation.FraudFlag.SELECTIVE_REVEAL;
        flags[0][1] = IBehavioralReputation.FraudFlag.VELOCITY_SPIKE;

        IBehavioralReputation.Severity[][] memory severities = new IBehavioralReputation.Severity[][](1);
        severities[0] = new IBehavioralReputation.Severity[](2);
        severities[0][0] = IBehavioralReputation.Severity.HIGH;
        severities[0][1] = IBehavioralReputation.Severity.WARNING;

        bytes32 merkleRoot = keccak256(abi.encode(users, reports));

        vm.prank(submitterAddr);
        verifier.submitBehaviorEpoch(1, users, reports, flags, severities, merkleRoot);

        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        verifier.finalizeEpoch(1);

        assertTrue(verifier.hasActiveFlag(alice, IBehavioralReputation.FraudFlag.SELECTIVE_REVEAL));
        assertTrue(verifier.hasActiveFlag(alice, IBehavioralReputation.FraudFlag.VELOCITY_SPIKE));
        assertFalse(verifier.hasActiveFlag(alice, IBehavioralReputation.FraudFlag.SYBIL_TIMING));
    }

    // ============ Rate Limiting ============

    function test_rateLimiting() public {
        assertFalse(verifier.isRateLimited(alice));

        vm.startPrank(recorder);
        for (uint256 i = 0; i < 100; i++) {
            verifier.recordAction(alice);
        }
        vm.stopPrank();

        assertTrue(verifier.isRateLimited(alice));
    }

    // ============ Invalid Trust Score ============

    function test_invalidTrustScore_reverts() public {
        address[] memory users = new address[](1);
        users[0] = alice;
        IBehavioralReputation.BehaviorReport[] memory reports = new IBehavioralReputation.BehaviorReport[](1);
        reports[0] = _makeReport(101, IBehavioralReputation.TrustTier.TRUSTED); // >100 invalid

        IBehavioralReputation.FraudFlag[][] memory flags = new IBehavioralReputation.FraudFlag[][](1);
        flags[0] = new IBehavioralReputation.FraudFlag[](0);
        IBehavioralReputation.Severity[][] memory severities = new IBehavioralReputation.Severity[][](1);
        severities[0] = new IBehavioralReputation.Severity[](0);

        vm.prank(submitterAddr);
        vm.expectRevert(IBehavioralReputation.InvalidTrustScore.selector);
        verifier.submitBehaviorEpoch(1, users, reports, flags, severities, bytes32(0));
    }

    // ============ Duplicate Epoch Reverts ============

    function test_duplicateEpoch_reverts() public {
        address[] memory users = new address[](1);
        users[0] = alice;
        IBehavioralReputation.BehaviorReport[] memory reports = new IBehavioralReputation.BehaviorReport[](1);
        reports[0] = _makeReport(50, IBehavioralReputation.TrustTier.CAUTIOUS);

        _submitEpoch(1, users, reports);

        vm.expectRevert(IBehavioralReputation.EpochAlreadySubmitted.selector);
        _submitEpoch(1, users, reports); // duplicate
    }
}
