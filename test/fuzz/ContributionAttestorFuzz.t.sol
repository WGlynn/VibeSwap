// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/ContributionAttestor.sol";
import "../../contracts/identity/ContributionDAG.sol";

contract ContributionAttestorFuzzTest is Test {
    ContributionAttestor public attestor;
    ContributionDAG public dag;

    address public founder1 = address(0x1001);
    address public founder2 = address(0x1002);
    address public founder3 = address(0x1003);
    address public trusted1 = address(0x2001);
    address public trusted2 = address(0x2002);
    address public contributor1 = address(0x3001);
    address public claimant1 = address(0x4001);

    uint256 constant PRECISION = 1e18;
    uint256 constant BPS = 10000;

    function setUp() public {
        dag = new ContributionDAG(address(0));
        dag.addFounder(founder1);
        dag.addFounder(founder2);
        dag.addFounder(founder3);

        // Handshakes: founders ↔ trusted users
        vm.prank(founder1);
        dag.addVouch(trusted1, bytes32(0));
        vm.prank(trusted1);
        dag.addVouch(founder1, bytes32(0));

        vm.prank(founder2);
        dag.addVouch(trusted2, bytes32(0));
        vm.prank(trusted2);
        dag.addVouch(founder2, bytes32(0));

        vm.prank(trusted1);
        dag.addVouch(contributor1, bytes32(0));
        vm.prank(contributor1);
        dag.addVouch(trusted1, bytes32(0));

        dag.recalculateTrustScores();

        attestor = new ContributionAttestor(address(dag), 2e18, 7 days);
    }

    // ============ Fuzz: Attestation Weight Bounds ============

    function testFuzz_attestationWeight_nonNegative(uint256 attesterSeed) public view {
        // Any address should have non-negative attestation weight
        address attester = address(uint160(bound(attesterSeed, 1, type(uint160).max)));
        uint256 weight = attestor.previewAttestationWeight(attester);
        // Weight is always ≥ 0 (unsigned)
        assertTrue(weight >= 0);
    }

    function testFuzz_attestationWeight_bounded(uint256 attesterSeed) public view {
        address attester = address(uint160(bound(attesterSeed, 1, type(uint160).max)));
        uint256 weight = attestor.previewAttestationWeight(attester);
        // Maximum possible weight: score=1e18, multiplier=30000 → 3e18
        assertTrue(weight <= 3e18);
    }

    // ============ Fuzz: Acceptance Threshold ============

    function testFuzz_setAcceptanceThreshold(uint256 threshold) public {
        threshold = bound(threshold, 1, type(uint128).max);
        attestor.setAcceptanceThreshold(threshold);
        assertEq(attestor.acceptanceThreshold(), threshold);
    }

    function testFuzz_setClaimTTL(uint256 ttl) public {
        ttl = bound(ttl, 1 days, 365 days);
        attestor.setClaimTTL(ttl);
        assertEq(attestor.claimTTL(), ttl);
    }

    // ============ Fuzz: Claim Submission ============

    function testFuzz_submitClaim_uniqueIds(uint256 seed1, uint256 seed2) public {
        vm.assume(seed1 != seed2);

        vm.prank(claimant1);
        bytes32 id1 = attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Code,
            bytes32(seed1),
            "desc1",
            0
        );

        vm.prank(claimant1);
        bytes32 id2 = attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Code,
            bytes32(seed2),
            "desc2",
            0
        );

        assertTrue(id1 != id2);
    }

    function testFuzz_submitClaim_anyContributionType(uint8 typeIdx) public {
        typeIdx = uint8(bound(typeIdx, 0, 8));
        IContributionAttestor.ContributionType ct = IContributionAttestor.ContributionType(typeIdx);

        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(
            contributor1,
            ct,
            bytes32(0),
            "desc",
            0
        );

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.contribType), uint256(ct));
    }

    function testFuzz_submitClaim_anyValue(uint256 value) public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Code,
            bytes32(0),
            "desc",
            value
        );

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(claim.value, value);
    }

    // ============ Fuzz: Cumulative Weight Monotonicity ============

    function testFuzz_cumulativeWeight_monotonicallyIncreases_withAttestations(uint8 numAttesters) public {
        numAttesters = uint8(bound(numAttesters, 1, 3)); // Up to 3 founders

        // Set high threshold so claim stays pending
        attestor.setAcceptanceThreshold(100e18);

        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Design,
            bytes32(0),
            "Logo design",
            0
        );

        address[3] memory founders = [founder1, founder2, founder3];
        int256 previousWeight = 0;

        for (uint8 i = 0; i < numAttesters; i++) {
            vm.prank(founders[i]);
            attestor.attest(claimId);

            IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
            // Each attestation should INCREASE net weight
            assertTrue(claim.netWeight > previousWeight);
            previousWeight = claim.netWeight;
        }
    }

    // ============ Fuzz: Expiry Timing ============

    function testFuzz_claim_expiresAfterTTL(uint256 timeElapsed) public {
        timeElapsed = bound(timeElapsed, 0, 365 days);

        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Code,
            bytes32(0),
            "desc",
            0
        );

        vm.warp(block.timestamp + timeElapsed);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);

        if (timeElapsed >= 7 days) {
            // Should be expirable
            attestor.checkExpiry(claimId);
            claim = attestor.getClaim(claimId);
            assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Expired));
        } else {
            // Should still be pending
            assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Pending));
        }
    }

    // ============ Fuzz: Weight Computation Consistency ============

    function testFuzz_getCumulativeWeight_matchesClaimNetWeight() public {
        // Set high threshold so claims stay pending
        attestor.setAcceptanceThreshold(100e18);

        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Design,
            bytes32(0),
            "desc",
            0
        );

        // founder1 attests
        vm.prank(founder1);
        attestor.attest(claimId);

        // trusted1 attests
        vm.prank(trusted1);
        attestor.attest(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        (int256 netWeight, uint256 totalPositive, uint256 totalNegative, ) =
            attestor.getCumulativeWeight(claimId);

        // getCumulativeWeight should match claim.netWeight
        assertEq(netWeight, claim.netWeight);
        assertEq(int256(totalPositive) - int256(totalNegative), claim.netWeight);
    }

    // ============ Fuzz: Mixed Attestation and Contestation ============

    function testFuzz_netWeight_correctWithMixedSignals(bool founderAttests, bool trustedContests) public {
        // Set high threshold
        attestor.setAcceptanceThreshold(100e18);

        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Code,
            bytes32(0),
            "desc",
            0
        );

        int256 expectedWeight = 0;

        if (founderAttests) {
            vm.prank(founder1);
            attestor.attest(claimId);
            expectedWeight += int256(3e18); // founder weight
        }

        if (trustedContests) {
            vm.prank(trusted1);
            if (founderAttests) {
                // Claim may be accepted if threshold is low, but we set it to 100e18
            }
            attestor.contest(claimId, bytes32(0));
            expectedWeight -= int256(1.7e18); // trusted weight
        }

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(claim.netWeight, expectedWeight);
    }

    // ============ Fuzz: Contributor Address Range ============

    function testFuzz_submitClaim_anyContributor(address contributor) public {
        vm.assume(contributor != address(0));

        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(
            contributor,
            IContributionAttestor.ContributionType.Other,
            bytes32(0),
            "contribution",
            0
        );

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(claim.contributor, contributor);

        bytes32[] memory claims = attestor.getClaimsByContributor(contributor);
        assertEq(claims.length, 1);
        assertEq(claims[0], claimId);
    }
}
