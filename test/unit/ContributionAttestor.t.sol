// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/ContributionAttestor.sol";
import "../../contracts/identity/ContributionDAG.sol";

// ============ Mock Tribunal ============

contract MockTribunal {
    mapping(bytes32 => ITribunal.Trial) private _trials;

    function setTrial(
        bytes32 trialId,
        bytes32 caseId,
        ITribunal.TrialPhase phase,
        ITribunal.Verdict verdict
    ) external {
        ITribunal.Trial storage trial = _trials[trialId];
        trial.caseId = caseId;
        trial.phase = phase;
        trial.verdict = verdict;
        trial.phaseDeadline = uint64(block.timestamp);
        trial.jurySize = 7;
        trial.guiltyVotes = 0;
        trial.notGuiltyVotes = 0;
        trial.jurorStake = 1e18;
        trial.appealCount = 0;
    }

    function getTrial(bytes32 trialId) external view returns (ITribunal.Trial memory) {
        return _trials[trialId];
    }
}

// ============ Mock Governance (QuadraticVoting) ============

contract MockGovernance {
    mapping(uint256 => IQuadraticVoting.Proposal) private _proposals;

    function setProposal(
        uint256 proposalId,
        address proposer,
        IQuadraticVoting.ProposalState state
    ) external {
        IQuadraticVoting.Proposal storage p = _proposals[proposalId];
        p.proposer = proposer;
        p.description = "Mock proposal";
        p.ipfsHash = bytes32(0);
        p.startTime = uint64(block.timestamp);
        p.endTime = uint64(block.timestamp + 7 days);
        p.forVotes = 0;
        p.againstVotes = 0;
        p.totalTokensLocked = 0;
        p.state = state;
    }

    function getProposal(uint256 proposalId) external view returns (IQuadraticVoting.Proposal memory) {
        return _proposals[proposalId];
    }
}

// ============ Tests ============

contract ContributionAttestorTest is Test {
    ContributionAttestor public attestor;
    ContributionDAG public dag;
    MockTribunal public mockTribunal;
    MockGovernance public mockGovernance;

    address public owner = address(this);
    address public founder1 = address(0x1001);
    address public founder2 = address(0x1002);
    address public founder3 = address(0x1003);
    address public trusted1 = address(0x2001);
    address public trusted2 = address(0x2002);
    address public contributor1 = address(0x3001);
    address public claimant1 = address(0x4001);
    address public untrusted1 = address(0x5001);

    uint256 constant PRECISION = 1e18;
    uint256 constant ACCEPTANCE_THRESHOLD = 2e18; // 2.0
    uint256 constant CLAIM_TTL = 7 days;

    function setUp() public {
        // Deploy ContributionDAG
        dag = new ContributionDAG(address(0)); // No soulbound check

        // Add founders
        dag.addFounder(founder1);
        dag.addFounder(founder2);
        dag.addFounder(founder3);

        // Create handshakes: founders <-> trusted users
        vm.prank(founder1);
        dag.addVouch(trusted1, bytes32(0));
        vm.prank(trusted1);
        dag.addVouch(founder1, bytes32(0));

        vm.prank(founder2);
        dag.addVouch(trusted2, bytes32(0));
        vm.prank(trusted2);
        dag.addVouch(founder2, bytes32(0));

        // Handshake trusted1 <-> contributor1
        vm.prank(trusted1);
        dag.addVouch(contributor1, bytes32(0));
        vm.prank(contributor1);
        dag.addVouch(trusted1, bytes32(0));

        // Recalculate trust scores
        dag.recalculateTrustScores();

        // Deploy ContributionAttestor
        attestor = new ContributionAttestor(
            address(dag),
            ACCEPTANCE_THRESHOLD,
            CLAIM_TTL
        );

        // Deploy mocks and configure branches
        mockTribunal = new MockTribunal();
        mockGovernance = new MockGovernance();
        attestor.setTribunal(address(mockTribunal));
        attestor.setGovernance(address(mockGovernance));
    }

    // ============ Helpers ============

    /// @dev Submit a standard claim and return its claimId
    function _submitClaim() internal returns (bytes32) {
        vm.prank(claimant1);
        return attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Code,
            bytes32("evidence"),
            "Test contribution",
            0
        );
    }

    /// @dev Submit a claim and get it to Contested status
    function _createContestedClaim() internal returns (bytes32 claimId) {
        claimId = _submitClaim();

        // trusted1 attests (+1.7)
        vm.prank(trusted1);
        attestor.attest(claimId);

        // founder1 contests (-3.0) → net = 1.7 - 3.0 = -1.3 < -1.0 → Contested
        vm.prank(founder1);
        attestor.contest(claimId, bytes32("reason"));
    }

    // ============ Constructor ============

    function test_constructor() public view {
        assertEq(address(attestor.contributionDAG()), address(dag));
        assertEq(attestor.acceptanceThreshold(), ACCEPTANCE_THRESHOLD);
        assertEq(attestor.claimTTL(), CLAIM_TTL);
    }

    function test_constructor_revert_zeroAddress() public {
        vm.expectRevert(IContributionAttestor.ZeroAddress.selector);
        new ContributionAttestor(address(0), ACCEPTANCE_THRESHOLD, CLAIM_TTL);
    }

    function test_constructor_revert_zeroThreshold() public {
        vm.expectRevert(IContributionAttestor.ThresholdTooLow.selector);
        new ContributionAttestor(address(dag), 0, CLAIM_TTL);
    }

    function test_constructor_revert_shortTTL() public {
        vm.expectRevert(IContributionAttestor.TTLTooShort.selector);
        new ContributionAttestor(address(dag), ACCEPTANCE_THRESHOLD, 1 hours);
    }

    // ============ Submit Claim ============

    function test_submitClaim() public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Design,
            bytes32("evidence1"),
            "Created the VibeSwap logo",
            1000e18
        );

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(claim.contributor, contributor1);
        assertEq(claim.claimant, claimant1);
        assertEq(uint256(claim.contribType), uint256(IContributionAttestor.ContributionType.Design));
        assertEq(claim.evidenceHash, bytes32("evidence1"));
        assertEq(claim.value, 1000e18);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Pending));
        assertEq(uint256(claim.resolvedBy), uint256(IContributionAttestor.ResolutionSource.None));
        assertEq(claim.netWeight, 0);
        assertEq(claim.attestationCount, 0);
        assertEq(claim.contestationCount, 0);
    }

    function test_submitClaim_selfClaim() public {
        // Contributor can submit their own claim
        vm.prank(contributor1);
        bytes32 claimId = attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Code,
            bytes32("evidence2"),
            "Wrote the AMM contract",
            500e18
        );

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(claim.contributor, contributor1);
        assertEq(claim.claimant, contributor1);
    }

    function test_submitClaim_revert_zeroContributor() public {
        vm.expectRevert(IContributionAttestor.ZeroAddress.selector);
        attestor.submitClaim(
            address(0),
            IContributionAttestor.ContributionType.Code,
            bytes32(0),
            "desc",
            0
        );
    }

    function test_submitClaim_revert_emptyDescription() public {
        vm.expectRevert(IContributionAttestor.EmptyDescription.selector);
        attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Code,
            bytes32(0),
            "",
            0
        );
    }

    function test_submitClaim_trackedByContributor() public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Design,
            bytes32(0),
            "Logo design",
            0
        );

        bytes32[] memory claims = attestor.getClaimsByContributor(contributor1);
        assertEq(claims.length, 1);
        assertEq(claims[0], claimId);
    }

    function test_submitClaim_incrementsCount() public {
        assertEq(attestor.getClaimCount(), 0);

        vm.prank(claimant1);
        attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Code, bytes32(0), "desc1", 0);
        assertEq(attestor.getClaimCount(), 1);

        vm.prank(claimant1);
        attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Design, bytes32(0), "desc2", 0);
        assertEq(attestor.getClaimCount(), 2);
    }

    // ============ Attestation ============

    function test_attest_singleFounder() public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Design,
            bytes32("logo_hash"),
            "Freedomwarrior13 created our logo",
            0
        );

        // Founder1 attests — weight = score(1.0) x multiplier(3.0) = 3.0
        vm.prank(founder1);
        attestor.attest(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        // Founder: score=1e18, multiplier=30000 -> weight = 1e18 * 30000 / 10000 = 3e18
        assertEq(claim.netWeight, int256(3e18));
        assertEq(claim.attestationCount, 1);
        // 3e18 >= 2e18 threshold -> accepted
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Accepted));
    }

    function test_attest_twoTrustedUsers() public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Design,
            bytes32("logo_hash"),
            "Created the logo",
            0
        );

        // trusted1 attests — 1 hop from founder, score = 0.85, multiplier = 2.0 -> weight ~1.7
        vm.prank(trusted1);
        attestor.attest(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        // Score: (1e18 * 8500 / 10000) = 8.5e17, multiplier = 20000
        // Weight: 8.5e17 * 20000 / 10000 = 1.7e18
        assertEq(claim.netWeight, int256(1.7e18));
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Pending));

        // trusted2 attests — also ~1.7 weight
        vm.prank(trusted2);
        attestor.attest(claimId);

        claim = attestor.getClaim(claimId);
        // Cumulative: 1.7 + 1.7 = 3.4 >= 2.0 -> accepted
        assertEq(claim.netWeight, int256(3.4e18));
        assertEq(claim.attestationCount, 2);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Accepted));
    }

    function test_attest_threeFounders_strongSignal() public {
        // Set high threshold so all 3 founders are needed
        attestor.setAcceptanceThreshold(8e18);

        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Design,
            bytes32("logo_hash"),
            "Freedomwarrior13 created our logo",
            0
        );

        // All 3 founders attest
        vm.prank(founder1);
        attestor.attest(claimId);

        vm.prank(founder2);
        attestor.attest(claimId);

        vm.prank(founder3);
        attestor.attest(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        // 3 founders x 3.0 = 9.0 cumulative weight >= 8.0 -> accepted
        assertEq(claim.netWeight, int256(9e18));
        assertEq(claim.attestationCount, 3);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Accepted));
    }

    function test_attest_revert_claimNotFound() public {
        vm.prank(founder1);
        vm.expectRevert(IContributionAttestor.ClaimNotFound.selector);
        attestor.attest(bytes32("nonexistent"));
    }

    function test_attest_revert_alreadyAttested() public {
        // Set high threshold so claim stays pending after first attestation
        attestor.setAcceptanceThreshold(10e18);

        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Code, bytes32(0), "desc", 0);

        vm.prank(founder1);
        attestor.attest(claimId);

        vm.prank(founder1);
        vm.expectRevert(IContributionAttestor.AlreadyAttested.selector);
        attestor.attest(claimId);
    }

    function test_attest_revert_cannotAttestOwnClaim_asClaimant() public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Code, bytes32(0), "desc", 0);

        vm.prank(claimant1);
        vm.expectRevert(IContributionAttestor.CannotAttestOwnClaim.selector);
        attestor.attest(claimId);
    }

    function test_attest_revert_cannotAttestOwnClaim_asContributor() public {
        // Someone else submits a claim for contributor1
        vm.prank(founder1);
        bytes32 claimId = attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Code, bytes32(0), "desc", 0);

        vm.prank(contributor1);
        vm.expectRevert(IContributionAttestor.CannotAttestOwnClaim.selector);
        attestor.attest(claimId);
    }

    function test_attest_revert_expired() public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Code, bytes32(0), "desc", 0);

        // Fast forward past TTL
        vm.warp(block.timestamp + CLAIM_TTL + 1);

        vm.prank(founder1);
        vm.expectRevert(IContributionAttestor.ClaimExpiredError.selector);
        attestor.attest(claimId);
    }

    function test_attest_revert_claimNotPending() public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Code, bytes32(0), "desc", 0);

        // Founder1 accepts it (weight 3.0 >= 2.0 threshold)
        vm.prank(founder1);
        attestor.attest(claimId);

        // Now try to attest an already-accepted claim
        vm.prank(founder2);
        vm.expectRevert(IContributionAttestor.ClaimNotPending.selector);
        attestor.attest(claimId);
    }

    function test_attest_revert_zeroTrustScore() public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Code, bytes32(0), "desc", 0);

        // untrusted1 has no trust score (not in network)
        vm.prank(untrusted1);
        vm.expectRevert(IContributionAttestor.ZeroTrustScore.selector);
        attestor.attest(claimId);
    }

    // ============ Contestation ============

    function test_contest_basic() public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Code, bytes32(0), "desc", 0);

        // trusted1 attests (+1.7)
        vm.prank(trusted1);
        attestor.attest(claimId);

        // founder1 contests (-3.0)
        vm.prank(founder1);
        attestor.contest(claimId, bytes32("reason_hash"));

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        // net = 1.7 - 3.0 = -1.3
        assertEq(claim.netWeight, int256(1.7e18) - int256(3e18));
        assertEq(claim.contestationCount, 1);
        // -1.3 < -1.0 (half of threshold 2.0) -> contested
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Contested));
    }

    function test_contest_doesNotRejectIfWeakContester() public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Code, bytes32(0), "desc", 0);

        // trusted1 contests — weight ~1.7, net = -1.7
        vm.prank(trusted1);
        attestor.contest(claimId, bytes32(0));

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        // -1.7 < -1.0 -> contested
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Contested));
    }

    function test_contest_revert_alreadyAttested() public {
        // Set high threshold so claim stays pending
        attestor.setAcceptanceThreshold(10e18);

        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Code, bytes32(0), "desc", 0);

        vm.prank(founder1);
        attestor.attest(claimId);

        // Same user can't contest after attesting
        vm.prank(founder1);
        vm.expectRevert(IContributionAttestor.AlreadyAttested.selector);
        attestor.contest(claimId, bytes32(0));
    }

    // ============ Cumulative Weight View ============

    function test_getCumulativeWeight() public {
        // Set high threshold so claim stays pending for both attestations
        attestor.setAcceptanceThreshold(10e18);

        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Design, bytes32(0), "desc", 0);

        vm.prank(founder1);
        attestor.attest(claimId);

        vm.prank(trusted1);
        attestor.attest(claimId);

        (int256 netWeight, uint256 totalPositive, uint256 totalNegative, bool isAccepted) =
            attestor.getCumulativeWeight(claimId);

        // founder1: 3e18, trusted1: 1.7e18
        assertEq(totalPositive, 4.7e18);
        assertEq(totalNegative, 0);
        assertEq(netWeight, int256(4.7e18));
        // 4.7 < 10.0 threshold -> not accepted
        assertFalse(isAccepted);
    }

    function test_getCumulativeWeight_withContestations() public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Code, bytes32(0), "desc", 0);

        // founder1 attests +3.0, founder2 contests -3.0
        vm.prank(founder1);
        attestor.attest(claimId);

        // Claim is accepted after founder1 (3.0 >= 2.0), so founder2 can't contest
        // Let's use a higher threshold instead
    }

    // ============ Expiry ============

    function test_checkExpiry() public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Code, bytes32(0), "desc", 0);

        // Before expiry
        attestor.checkExpiry(claimId);
        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Pending));

        // After expiry
        vm.warp(block.timestamp + CLAIM_TTL + 1);
        attestor.checkExpiry(claimId);

        claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Expired));
    }

    function test_checkExpiry_revert_nonexistent() public {
        vm.expectRevert(IContributionAttestor.ClaimNotFound.selector);
        attestor.checkExpiry(bytes32("nonexistent"));
    }

    // ============ Has Attested ============

    function test_hasAttested() public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Code, bytes32(0), "desc", 0);

        assertFalse(attestor.hasAttested(claimId, founder1));

        vm.prank(founder1);
        attestor.attest(claimId);

        assertTrue(attestor.hasAttested(claimId, founder1));
    }

    // ============ Preview Weight ============

    function test_previewAttestationWeight_founder() public view {
        uint256 weight = attestor.previewAttestationWeight(founder1);
        // score=1e18, multiplier=30000 -> weight = 3e18
        assertEq(weight, 3e18);
    }

    function test_previewAttestationWeight_trusted() public view {
        uint256 weight = attestor.previewAttestationWeight(trusted1);
        // score=0.85e18, multiplier=20000 -> weight = 1.7e18
        assertEq(weight, 1.7e18);
    }

    function test_previewAttestationWeight_untrusted() public view {
        uint256 weight = attestor.previewAttestationWeight(untrusted1);
        // score=0, multiplier=5000 -> weight = 0
        assertEq(weight, 0);
    }

    // ============ Get Attestations ============

    function test_getAttestations() public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Design, bytes32(0), "desc", 0);

        vm.prank(founder1);
        attestor.attest(claimId);

        IContributionAttestor.Attestation[] memory attestations = attestor.getAttestations(claimId);
        assertEq(attestations.length, 1);
        assertEq(attestations[0].attester, founder1);
        assertEq(attestations[0].weight, 3e18);
        assertFalse(attestations[0].isContestation);
    }

    // ============ Admin Functions ============

    function test_setAcceptanceThreshold() public {
        attestor.setAcceptanceThreshold(5e18);
        assertEq(attestor.acceptanceThreshold(), 5e18);
    }

    function test_setAcceptanceThreshold_revert_zero() public {
        vm.expectRevert(IContributionAttestor.ThresholdTooLow.selector);
        attestor.setAcceptanceThreshold(0);
    }

    function test_setAcceptanceThreshold_revert_nonOwner() public {
        vm.prank(founder1);
        vm.expectRevert();
        attestor.setAcceptanceThreshold(5e18);
    }

    function test_setClaimTTL() public {
        attestor.setClaimTTL(14 days);
        assertEq(attestor.claimTTL(), 14 days);
    }

    function test_setClaimTTL_revert_tooShort() public {
        vm.expectRevert(IContributionAttestor.TTLTooShort.selector);
        attestor.setClaimTTL(1 hours);
    }

    function test_rejectClaim() public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Code, bytes32(0), "desc", 0);

        attestor.rejectClaim(claimId, "Fraudulent claim");

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Rejected));
    }

    function test_rejectClaim_revert_nonOwner() public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Code, bytes32(0), "desc", 0);

        vm.prank(founder1);
        vm.expectRevert();
        attestor.rejectClaim(claimId, "reason");
    }

    function test_rejectClaim_revert_notPending() public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Code, bytes32(0), "desc", 0);

        // Accept via founder attestation first
        vm.prank(founder1);
        attestor.attest(claimId);

        vm.expectRevert(IContributionAttestor.ClaimNotPending.selector);
        attestor.rejectClaim(claimId, "reason");
    }

    function test_setContributionDAG() public {
        ContributionDAG newDag = new ContributionDAG(address(0));
        attestor.setContributionDAG(address(newDag));
        assertEq(address(attestor.contributionDAG()), address(newDag));
    }

    function test_setContributionDAG_revert_zeroAddress() public {
        vm.expectRevert(IContributionAttestor.ZeroAddress.selector);
        attestor.setContributionDAG(address(0));
    }

    // ============ Admin: setTribunal / setGovernance ============

    function test_setTribunal() public {
        address newTribunal = address(0xBEEF);
        attestor.setTribunal(newTribunal);
        assertEq(address(attestor.tribunal()), newTribunal);
    }

    function test_setTribunal_revert_nonOwner() public {
        vm.prank(founder1);
        vm.expectRevert();
        attestor.setTribunal(address(0xBEEF));
    }

    function test_setGovernance() public {
        address newGov = address(0xCAFE);
        attestor.setGovernance(newGov);
        assertEq(address(attestor.governance()), newGov);
    }

    function test_setGovernance_revert_nonOwner() public {
        vm.prank(founder1);
        vm.expectRevert();
        attestor.setGovernance(address(0xCAFE));
    }

    // ============ Scenario: Freedomwarrior13's Logo ============

    function test_scenario_logoAttestation_singleFounder() public {
        // One founder attesting = strong enough (3.0 >= 2.0)
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Design,
            bytes32("ipfs_logo_evidence"),
            "Freedomwarrior13 designed the VibeSwap logo",
            0
        );

        vm.prank(founder1);
        attestor.attest(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Accepted));
        assertEq(claim.netWeight, int256(3e18)); // Single founder = 3.0
    }

    function test_scenario_logoAttestation_threeFounders() public {
        // Set higher threshold to show cumulative effect
        attestor.setAcceptanceThreshold(8e18); // Need 8.0 -> requires multiple founders

        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Design,
            bytes32("ipfs_logo_evidence"),
            "Freedomwarrior13 designed the VibeSwap logo",
            0
        );

        // First founder: 3.0 (not enough)
        vm.prank(founder1);
        attestor.attest(claimId);
        assertEq(uint256(attestor.getClaim(claimId).status), uint256(IContributionAttestor.ClaimStatus.Pending));

        // Second founder: 3.0 + 3.0 = 6.0 (not enough)
        vm.prank(founder2);
        attestor.attest(claimId);
        assertEq(uint256(attestor.getClaim(claimId).status), uint256(IContributionAttestor.ClaimStatus.Pending));

        // Third founder: 6.0 + 3.0 = 9.0 >= 8.0 -> accepted!
        vm.prank(founder3);
        attestor.attest(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Accepted));
        assertEq(claim.netWeight, int256(9e18)); // 3 x 3.0 = 9.0
        assertEq(claim.attestationCount, 3);
    }

    function test_scenario_mixedSignals() public {
        // Set threshold higher
        attestor.setAcceptanceThreshold(4e18);

        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Code,
            bytes32(0),
            "Wrote the AMM contract",
            0
        );

        // founder1 attests: +3.0
        vm.prank(founder1);
        attestor.attest(claimId);

        // trusted1 attests: +1.7
        vm.prank(trusted1);
        attestor.attest(claimId);

        // Total: 4.7 >= 4.0 -> accepted
        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Accepted));
        assertEq(claim.netWeight, int256(4.7e18));
    }

    // ============ Events (Executive Branch) ============

    // Re-declare events for test emission (Solidity requires this for emit in tests)
    event ClaimSubmitted(bytes32 indexed claimId, address indexed contributor, address indexed claimant, IContributionAttestor.ContributionType contribType, uint256 value);
    event ClaimAttested(bytes32 indexed claimId, address indexed attester, uint256 weight, int256 newNetWeight);
    event ClaimAccepted(bytes32 indexed claimId, address indexed contributor, int256 finalWeight, uint256 attestationCount);
    event ClaimEscalatedToTribunal(bytes32 indexed claimId, bytes32 indexed trialId);
    event ClaimResolvedByTribunal(bytes32 indexed claimId, bytes32 indexed trialId, bool accepted);
    event ClaimEscalatedToGovernance(bytes32 indexed claimId, uint256 indexed proposalId);
    event ClaimResolvedByGovernance(bytes32 indexed claimId, uint256 indexed proposalId, bool accepted);
    event TribunalUpdated(address oldTribunal, address newTribunal);
    event GovernanceUpdated(address oldGovernance, address newGovernance);

    function test_emit_ClaimSubmitted() public {
        vm.prank(claimant1);
        vm.expectEmit(false, true, true, false);
        emit ClaimSubmitted(
            bytes32(0), // claimId not predictable
            contributor1,
            claimant1,
            IContributionAttestor.ContributionType.Design,
            0
        );
        attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Design,
            bytes32(0),
            "desc",
            0
        );
    }

    function test_emit_ClaimAttested() public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Code, bytes32(0), "desc", 0);

        vm.prank(founder1);
        vm.expectEmit(true, true, false, true);
        emit ClaimAttested(claimId, founder1, 3e18, int256(3e18));
        attestor.attest(claimId);
    }

    function test_emit_ClaimAccepted() public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(contributor1, IContributionAttestor.ContributionType.Code, bytes32(0), "desc", 0);

        vm.prank(founder1);
        vm.expectEmit(true, true, false, false);
        emit ClaimAccepted(claimId, contributor1, int256(3e18), 1);
        attestor.attest(claimId);
    }

    // ============ resolvedBy: Executive ============

    function test_resolvedBy_executive() public {
        // When a claim is accepted via attestation weight, resolvedBy = Executive
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Code,
            bytes32("ev"),
            "Built the thing",
            0
        );

        vm.prank(founder1);
        attestor.attest(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Accepted));
        assertEq(uint256(claim.resolvedBy), uint256(IContributionAttestor.ResolutionSource.Executive));
    }

    // ================================================================
    //                  BRANCH 2: JUDICIAL (Tribunal) Tests
    // ================================================================

    // ============ escalateToTribunal ============

    function test_escalateToTribunal_basic() public {
        bytes32 claimId = _createContestedClaim();

        // Verify claim is Contested
        assertEq(uint256(attestor.getClaim(claimId).status), uint256(IContributionAttestor.ClaimStatus.Contested));

        // Set up a trial whose caseId matches the claimId
        bytes32 trialId = bytes32("trial_001");
        mockTribunal.setTrial(
            trialId,
            claimId, // caseId must match
            ITribunal.TrialPhase.JURY_SELECTION,
            ITribunal.Verdict.PENDING
        );

        // Escalate
        attestor.escalateToTribunal(claimId, trialId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Escalated));
        assertEq(attestor.claimTrialIds(claimId), trialId);
    }

    function test_escalateToTribunal_revert_tribunalNotSet() public {
        // Deploy a fresh attestor without tribunal set
        ContributionAttestor freshAttestor = new ContributionAttestor(
            address(dag),
            ACCEPTANCE_THRESHOLD,
            CLAIM_TTL
        );

        // Submit and contest a claim on the fresh attestor
        vm.prank(claimant1);
        bytes32 claimId = freshAttestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Code,
            bytes32(0),
            "desc",
            0
        );

        // Get it to contested status
        vm.prank(trusted1);
        freshAttestor.attest(claimId);
        vm.prank(founder1);
        freshAttestor.contest(claimId, bytes32("reason"));

        // Try to escalate with no tribunal set
        vm.expectRevert(IContributionAttestor.TribunalNotSet.selector);
        freshAttestor.escalateToTribunal(claimId, bytes32("trial"));
    }

    function test_escalateToTribunal_revert_notContested() public {
        // Claim is Accepted (not Contested or Pending) — should revert with ClaimNotContested
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Code,
            bytes32(0),
            "desc",
            0
        );

        // Accept the claim via founder attestation
        vm.prank(founder1);
        attestor.attest(claimId);

        assertEq(uint256(attestor.getClaim(claimId).status), uint256(IContributionAttestor.ClaimStatus.Accepted));

        bytes32 trialId = bytes32("trial_002");
        mockTribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.JURY_SELECTION, ITribunal.Verdict.PENDING);

        vm.expectRevert(IContributionAttestor.ClaimNotContested.selector);
        attestor.escalateToTribunal(claimId, trialId);
    }

    function test_escalateToTribunal_revert_caseIdMismatch() public {
        bytes32 claimId = _createContestedClaim();

        bytes32 trialId = bytes32("trial_003");
        // Set trial with WRONG caseId (does not match claimId)
        mockTribunal.setTrial(
            trialId,
            bytes32("wrong_case_id"),
            ITribunal.TrialPhase.JURY_SELECTION,
            ITribunal.Verdict.PENDING
        );

        vm.expectRevert(IContributionAttestor.TrialCaseIdMismatch.selector);
        attestor.escalateToTribunal(claimId, trialId);
    }

    // ============ resolveByTribunal ============

    function test_resolveByTribunal_notGuilty() public {
        bytes32 claimId = _createContestedClaim();
        bytes32 trialId = bytes32("trial_ng");

        // Set up trial matching the claim
        mockTribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.JURY_SELECTION, ITribunal.Verdict.PENDING);
        attestor.escalateToTribunal(claimId, trialId);

        // Now update trial to CLOSED with NOT_GUILTY verdict
        mockTribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.CLOSED, ITribunal.Verdict.NOT_GUILTY);

        attestor.resolveByTribunal(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Accepted));
        assertEq(uint256(claim.resolvedBy), uint256(IContributionAttestor.ResolutionSource.Judicial));
    }

    function test_resolveByTribunal_guilty() public {
        bytes32 claimId = _createContestedClaim();
        bytes32 trialId = bytes32("trial_g");

        mockTribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.JURY_SELECTION, ITribunal.Verdict.PENDING);
        attestor.escalateToTribunal(claimId, trialId);

        // Trial concludes GUILTY
        mockTribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.CLOSED, ITribunal.Verdict.GUILTY);

        attestor.resolveByTribunal(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Rejected));
        assertEq(uint256(claim.resolvedBy), uint256(IContributionAttestor.ResolutionSource.Judicial));
    }

    function test_resolveByTribunal_mistrial() public {
        bytes32 claimId = _createContestedClaim();
        bytes32 trialId = bytes32("trial_m");

        mockTribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.JURY_SELECTION, ITribunal.Verdict.PENDING);
        attestor.escalateToTribunal(claimId, trialId);

        // Trial concludes MISTRIAL -> claim goes back to Contested
        mockTribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.CLOSED, ITribunal.Verdict.MISTRIAL);

        attestor.resolveByTribunal(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Contested));
        // resolvedBy should NOT be set for mistrial (claim is not resolved)
        // The contract sets resolvedBy only for GUILTY/NOT_GUILTY, mistrial stays as-is
    }

    function test_resolveByTribunal_revert_notEscalated() public {
        // Claim is Contested but not Escalated
        bytes32 claimId = _createContestedClaim();

        vm.expectRevert(IContributionAttestor.ClaimNotEscalated.selector);
        attestor.resolveByTribunal(claimId);
    }

    function test_resolveByTribunal_revert_trialNotClosed() public {
        bytes32 claimId = _createContestedClaim();
        bytes32 trialId = bytes32("trial_open");

        mockTribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.JURY_SELECTION, ITribunal.Verdict.PENDING);
        attestor.escalateToTribunal(claimId, trialId);

        // Trial is still in DELIBERATION (not CLOSED)
        mockTribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.DELIBERATION, ITribunal.Verdict.PENDING);

        vm.expectRevert(IContributionAttestor.TrialNotClosed.selector);
        attestor.resolveByTribunal(claimId);
    }

    // ================================================================
    //                  BRANCH 3: LEGISLATIVE (Governance) Tests
    // ================================================================

    // ============ escalateToGovernance ============

    function test_escalateToGovernance_basic() public {
        bytes32 claimId = _createContestedClaim();
        uint256 proposalId = 42;

        // Create mock proposal
        mockGovernance.setProposal(proposalId, address(this), IQuadraticVoting.ProposalState.ACTIVE);

        attestor.escalateToGovernance(claimId, proposalId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.GovernanceReview));
        assertEq(attestor.claimProposalIds(claimId), proposalId);
    }

    function test_escalateToGovernance_overridesAccepted() public {
        // Governance is supreme — can override even Accepted claims
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Code,
            bytes32(0),
            "desc",
            0
        );

        // Accept via executive branch
        vm.prank(founder1);
        attestor.attest(claimId);
        assertEq(uint256(attestor.getClaim(claimId).status), uint256(IContributionAttestor.ClaimStatus.Accepted));

        // Governance can still escalate
        uint256 proposalId = 99;
        mockGovernance.setProposal(proposalId, address(this), IQuadraticVoting.ProposalState.ACTIVE);

        attestor.escalateToGovernance(claimId, proposalId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.GovernanceReview));
    }

    function test_escalateToGovernance_revert_governanceNotSet() public {
        // Deploy fresh attestor without governance set
        ContributionAttestor freshAttestor = new ContributionAttestor(
            address(dag),
            ACCEPTANCE_THRESHOLD,
            CLAIM_TTL
        );

        vm.prank(claimant1);
        bytes32 claimId = freshAttestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Code,
            bytes32(0),
            "desc",
            0
        );

        vm.expectRevert(IContributionAttestor.GovernanceNotSet.selector);
        freshAttestor.escalateToGovernance(claimId, 1);
    }

    function test_escalateToGovernance_revert_expired() public {
        vm.prank(claimant1);
        bytes32 claimId = attestor.submitClaim(
            contributor1,
            IContributionAttestor.ContributionType.Code,
            bytes32(0),
            "desc",
            0
        );

        // Expire the claim
        vm.warp(block.timestamp + CLAIM_TTL + 1);
        attestor.checkExpiry(claimId);

        assertEq(uint256(attestor.getClaim(claimId).status), uint256(IContributionAttestor.ClaimStatus.Expired));

        uint256 proposalId = 10;
        mockGovernance.setProposal(proposalId, address(this), IQuadraticVoting.ProposalState.ACTIVE);

        vm.expectRevert(IContributionAttestor.ClaimExpiredError.selector);
        attestor.escalateToGovernance(claimId, proposalId);
    }

    function test_escalateToGovernance_revert_alreadyInGovernanceReview() public {
        bytes32 claimId = _createContestedClaim();

        uint256 proposalId1 = 10;
        mockGovernance.setProposal(proposalId1, address(this), IQuadraticVoting.ProposalState.ACTIVE);
        attestor.escalateToGovernance(claimId, proposalId1);

        // Try to escalate again -> AlreadyEscalated
        uint256 proposalId2 = 20;
        mockGovernance.setProposal(proposalId2, address(this), IQuadraticVoting.ProposalState.ACTIVE);

        vm.expectRevert(IContributionAttestor.AlreadyEscalated.selector);
        attestor.escalateToGovernance(claimId, proposalId2);
    }

    // ============ resolveByGovernance ============

    function test_resolveByGovernance_succeeded() public {
        bytes32 claimId = _createContestedClaim();
        uint256 proposalId = 50;

        mockGovernance.setProposal(proposalId, address(this), IQuadraticVoting.ProposalState.ACTIVE);
        attestor.escalateToGovernance(claimId, proposalId);

        // Proposal succeeds
        mockGovernance.setProposal(proposalId, address(this), IQuadraticVoting.ProposalState.SUCCEEDED);

        attestor.resolveByGovernance(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Accepted));
        assertEq(uint256(claim.resolvedBy), uint256(IContributionAttestor.ResolutionSource.Legislative));
    }

    function test_resolveByGovernance_defeated() public {
        bytes32 claimId = _createContestedClaim();
        uint256 proposalId = 51;

        mockGovernance.setProposal(proposalId, address(this), IQuadraticVoting.ProposalState.ACTIVE);
        attestor.escalateToGovernance(claimId, proposalId);

        // Proposal defeated
        mockGovernance.setProposal(proposalId, address(this), IQuadraticVoting.ProposalState.DEFEATED);

        attestor.resolveByGovernance(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Rejected));
        assertEq(uint256(claim.resolvedBy), uint256(IContributionAttestor.ResolutionSource.Legislative));
    }

    function test_resolveByGovernance_revert_notUnderGovernance() public {
        // Claim is Contested, not GovernanceReview
        bytes32 claimId = _createContestedClaim();

        vm.expectRevert(IContributionAttestor.ClaimNotUnderGovernance.selector);
        attestor.resolveByGovernance(claimId);
    }

    function test_resolveByGovernance_revert_notFinalized() public {
        bytes32 claimId = _createContestedClaim();
        uint256 proposalId = 60;

        // Escalate with ACTIVE proposal
        mockGovernance.setProposal(proposalId, address(this), IQuadraticVoting.ProposalState.ACTIVE);
        attestor.escalateToGovernance(claimId, proposalId);

        // Try to resolve while proposal is still ACTIVE (not SUCCEEDED or DEFEATED)
        vm.expectRevert(IContributionAttestor.ProposalNotFinalized.selector);
        attestor.resolveByGovernance(claimId);
    }

    // ================================================================
    //                  FULL ESCALATION SCENARIO
    // ================================================================

    function test_scenario_fullEscalation() public {
        // Full flow: Contested -> Tribunal (MISTRIAL) -> Governance -> Accepted
        // Exercises all 3 branches of government

        // Step 1: Submit and contest via executive branch
        bytes32 claimId = _createContestedClaim();
        assertEq(uint256(attestor.getClaim(claimId).status), uint256(IContributionAttestor.ClaimStatus.Contested));

        // Step 2: Escalate to tribunal (judicial branch)
        bytes32 trialId = bytes32("full_trial");
        mockTribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.JURY_SELECTION, ITribunal.Verdict.PENDING);
        attestor.escalateToTribunal(claimId, trialId);
        assertEq(uint256(attestor.getClaim(claimId).status), uint256(IContributionAttestor.ClaimStatus.Escalated));

        // Step 3: Tribunal results in MISTRIAL -> back to Contested
        mockTribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.CLOSED, ITribunal.Verdict.MISTRIAL);
        attestor.resolveByTribunal(claimId);
        assertEq(uint256(attestor.getClaim(claimId).status), uint256(IContributionAttestor.ClaimStatus.Contested));

        // Step 4: Escalate to governance (legislative branch — supreme authority)
        uint256 proposalId = 100;
        mockGovernance.setProposal(proposalId, address(this), IQuadraticVoting.ProposalState.ACTIVE);
        attestor.escalateToGovernance(claimId, proposalId);
        assertEq(uint256(attestor.getClaim(claimId).status), uint256(IContributionAttestor.ClaimStatus.GovernanceReview));

        // Step 5: Governance vote succeeds -> Accepted by legislative branch
        mockGovernance.setProposal(proposalId, address(this), IQuadraticVoting.ProposalState.SUCCEEDED);
        attestor.resolveByGovernance(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Accepted));
        assertEq(uint256(claim.resolvedBy), uint256(IContributionAttestor.ResolutionSource.Legislative));
    }

    // ============ Events (Judicial + Legislative) ============

    function test_emit_escalateToTribunal() public {
        bytes32 claimId = _createContestedClaim();
        bytes32 trialId = bytes32("evt_trial");

        mockTribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.JURY_SELECTION, ITribunal.Verdict.PENDING);

        vm.expectEmit(true, true, false, false);
        emit ClaimEscalatedToTribunal(claimId, trialId);
        attestor.escalateToTribunal(claimId, trialId);
    }

    function test_emit_resolveByTribunal() public {
        bytes32 claimId = _createContestedClaim();
        bytes32 trialId = bytes32("evt_resolve");

        mockTribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.JURY_SELECTION, ITribunal.Verdict.PENDING);
        attestor.escalateToTribunal(claimId, trialId);

        mockTribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.CLOSED, ITribunal.Verdict.NOT_GUILTY);

        vm.expectEmit(true, true, false, true);
        emit ClaimResolvedByTribunal(claimId, trialId, true);
        attestor.resolveByTribunal(claimId);
    }

    function test_emit_escalateToGovernance() public {
        bytes32 claimId = _createContestedClaim();
        uint256 proposalId = 200;

        mockGovernance.setProposal(proposalId, address(this), IQuadraticVoting.ProposalState.ACTIVE);

        vm.expectEmit(true, true, false, false);
        emit ClaimEscalatedToGovernance(claimId, proposalId);
        attestor.escalateToGovernance(claimId, proposalId);
    }

    function test_emit_resolveByGovernance() public {
        bytes32 claimId = _createContestedClaim();
        uint256 proposalId = 201;

        mockGovernance.setProposal(proposalId, address(this), IQuadraticVoting.ProposalState.ACTIVE);
        attestor.escalateToGovernance(claimId, proposalId);

        mockGovernance.setProposal(proposalId, address(this), IQuadraticVoting.ProposalState.SUCCEEDED);

        vm.expectEmit(true, true, false, true);
        emit ClaimResolvedByGovernance(claimId, proposalId, true);
        attestor.resolveByGovernance(claimId);
    }
}
