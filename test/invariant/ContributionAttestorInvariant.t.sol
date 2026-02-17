// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/ContributionAttestor.sol";
import "../../contracts/identity/ContributionDAG.sol";

/**
 * @title ContributionAttestorInvariantHandler
 * @notice Handler contract for invariant testing of ContributionAttestor.
 *         Randomly submits claims, attests, contests, and checks expiry.
 */
contract ContributionAttestorInvariantHandler is Test {
    ContributionAttestor public attestor;
    ContributionDAG public dag;

    address[] public actors;
    bytes32[] public claimIds;

    // Ghost variables for tracking
    uint256 public totalAttestations;
    uint256 public totalContestations;
    uint256 public totalClaimsSubmitted;
    uint256 public totalClaimsAccepted;
    uint256 public totalClaimsExpired;

    // Track per-claim attestation weights
    mapping(bytes32 => uint256) public positiveWeightPerClaim;
    mapping(bytes32 => uint256) public negativeWeightPerClaim;

    constructor(ContributionAttestor _attestor, ContributionDAG _dag, address[] memory _actors) {
        attestor = _attestor;
        dag = _dag;
        actors = _actors;
    }

    function submitClaim(uint256 actorSeed, uint8 typeIdx) external {
        address actor = actors[actorSeed % actors.length];
        address contributor = actors[(actorSeed + 1) % actors.length];
        typeIdx = uint8(bound(typeIdx, 0, 8));

        vm.prank(actor);
        try attestor.submitClaim(
            contributor,
            IContributionAttestor.ContributionType(typeIdx),
            bytes32(totalClaimsSubmitted),
            "test claim",
            0
        ) returns (bytes32 claimId) {
            claimIds.push(claimId);
            totalClaimsSubmitted++;
        } catch {}
    }

    function attestClaim(uint256 actorSeed, uint256 claimSeed) external {
        if (claimIds.length == 0) return;

        address attester = actors[actorSeed % actors.length];
        bytes32 claimId = claimIds[claimSeed % claimIds.length];

        uint256 weight = attestor.previewAttestationWeight(attester);

        vm.prank(attester);
        try attestor.attest(claimId) {
            totalAttestations++;
            positiveWeightPerClaim[claimId] += weight;

            IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
            if (claim.status == IContributionAttestor.ClaimStatus.Accepted) {
                totalClaimsAccepted++;
            }
        } catch {}
    }

    function contestClaim(uint256 actorSeed, uint256 claimSeed) external {
        if (claimIds.length == 0) return;

        address contester = actors[actorSeed % actors.length];
        bytes32 claimId = claimIds[claimSeed % claimIds.length];

        uint256 weight = attestor.previewAttestationWeight(contester);

        vm.prank(contester);
        try attestor.contest(claimId, bytes32("reason")) {
            totalContestations++;
            negativeWeightPerClaim[claimId] += weight;
        } catch {}
    }

    function advanceTime(uint256 timeJump) external {
        timeJump = bound(timeJump, 0, 14 days);
        vm.warp(block.timestamp + timeJump);

        // Check expiry on all claims
        for (uint256 i = 0; i < claimIds.length; i++) {
            try attestor.checkExpiry(claimIds[i]) {
                IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimIds[i]);
                if (claim.status == IContributionAttestor.ClaimStatus.Expired) {
                    totalClaimsExpired++;
                }
            } catch {}
        }
    }

    function getClaimCount() external view returns (uint256) {
        return claimIds.length;
    }
}

contract ContributionAttestorInvariantTest is Test {
    ContributionAttestor public attestor;
    ContributionDAG public dag;
    ContributionAttestorInvariantHandler public handler;

    address public founder1 = address(0x1001);
    address public founder2 = address(0x1002);
    address public founder3 = address(0x1003);
    address public trusted1 = address(0x2001);
    address public trusted2 = address(0x2002);
    address public contributor1 = address(0x3001);
    address public claimant1 = address(0x4001);
    address public untrusted1 = address(0x5001);

    function setUp() public {
        dag = new ContributionDAG(address(0));
        dag.addFounder(founder1);
        dag.addFounder(founder2);
        dag.addFounder(founder3);

        // Handshakes
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

        // High threshold to keep more claims pending for testing
        attestor = new ContributionAttestor(address(dag), 5e18, 7 days);

        address[] memory actors = new address[](8);
        actors[0] = founder1;
        actors[1] = founder2;
        actors[2] = founder3;
        actors[3] = trusted1;
        actors[4] = trusted2;
        actors[5] = contributor1;
        actors[6] = claimant1;
        actors[7] = untrusted1;

        handler = new ContributionAttestorInvariantHandler(attestor, dag, actors);

        targetContract(address(handler));
    }

    // ============ Invariant: Claim Count Consistency ============

    function invariant_claimCountMatchesNonce() public view {
        assertEq(attestor.getClaimCount(), handler.totalClaimsSubmitted());
    }

    // ============ Invariant: Net Weight = Positive - Negative ============

    function invariant_netWeightConsistency() public view {
        uint256 claimCount = handler.getClaimCount();
        for (uint256 i = 0; i < claimCount && i < 10; i++) {
            bytes32 claimId = handler.claimIds(i);
            (int256 netWeight, uint256 totalPositive, uint256 totalNegative, ) =
                attestor.getCumulativeWeight(claimId);

            assertEq(netWeight, int256(totalPositive) - int256(totalNegative));
        }
    }

    // ============ Invariant: Accepted Claims Have Sufficient Weight ============

    function invariant_acceptedClaimsMetThreshold() public view {
        uint256 claimCount = handler.getClaimCount();
        for (uint256 i = 0; i < claimCount && i < 10; i++) {
            bytes32 claimId = handler.claimIds(i);
            IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);

            if (claim.status == IContributionAttestor.ClaimStatus.Accepted) {
                assertTrue(
                    claim.netWeight >= int256(attestor.acceptanceThreshold()),
                    "Accepted claim has insufficient weight"
                );
            }
        }
    }

    // ============ Invariant: Attestation Count ≥ 0 ============

    function invariant_attestationCountNonNegative() public view {
        uint256 claimCount = handler.getClaimCount();
        for (uint256 i = 0; i < claimCount && i < 10; i++) {
            bytes32 claimId = handler.claimIds(i);
            IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);

            IContributionAttestor.Attestation[] memory attestations = attestor.getAttestations(claimId);
            assertEq(
                attestations.length,
                claim.attestationCount + claim.contestationCount,
                "Attestation array length mismatch"
            );
        }
    }

    // ============ Invariant: No Double Attestation ============

    function invariant_noDoubleAttestation() public view {
        uint256 claimCount = handler.getClaimCount();
        for (uint256 i = 0; i < claimCount && i < 5; i++) {
            bytes32 claimId = handler.claimIds(i);
            IContributionAttestor.Attestation[] memory attestations = attestor.getAttestations(claimId);

            // Check no duplicate attesters
            for (uint256 j = 0; j < attestations.length; j++) {
                for (uint256 k = j + 1; k < attestations.length; k++) {
                    assertTrue(
                        attestations[j].attester != attestations[k].attester,
                        "Duplicate attester found"
                    );
                }
            }
        }
    }

    // ============ Invariant: Status Transitions Are One-Way ============

    function invariant_pendingClaimsHaveValidExpiry() public view {
        uint256 claimCount = handler.getClaimCount();
        for (uint256 i = 0; i < claimCount && i < 10; i++) {
            bytes32 claimId = handler.claimIds(i);
            IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);

            // All claims should have a valid expiry
            assertTrue(claim.expiresAt > claim.timestamp, "Expiry should be after creation");
            assertEq(claim.expiresAt, claim.timestamp + attestor.claimTTL(), "Expiry should match TTL");
        }
    }

    // ============ Invariant: Attestation Weights Are Bounded ============

    function invariant_attestationWeightsBounded() public view {
        uint256 claimCount = handler.getClaimCount();
        for (uint256 i = 0; i < claimCount && i < 5; i++) {
            bytes32 claimId = handler.claimIds(i);
            IContributionAttestor.Attestation[] memory attestations = attestor.getAttestations(claimId);

            for (uint256 j = 0; j < attestations.length; j++) {
                // Max weight: founder score(1e18) × founder multiplier(30000) / BPS = 3e18
                assertTrue(
                    attestations[j].weight <= 3e18,
                    "Attestation weight exceeds maximum"
                );
            }
        }
    }

    // ============ Invariant: Total Attestations ≥ Accepted Claims ============

    function invariant_acceptedNeedsAtLeastOneAttestation() public view {
        uint256 claimCount = handler.getClaimCount();
        for (uint256 i = 0; i < claimCount && i < 10; i++) {
            bytes32 claimId = handler.claimIds(i);
            IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);

            if (claim.status == IContributionAttestor.ClaimStatus.Accepted) {
                assertTrue(
                    claim.attestationCount >= 1,
                    "Accepted claim must have at least one attestation"
                );
            }
        }
    }
}
