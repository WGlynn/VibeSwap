// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/ContributionAttestor.sol";
import "../../contracts/identity/interfaces/IContributionAttestor.sol";
import "../../contracts/identity/interfaces/IContributionDAG.sol";
import "../../contracts/mechanism/interfaces/IQuadraticVoting.sol";

// ============ Mock ContributionDAG ============

contract MockContributionDAG {
    struct TrustData {
        uint256 score;
        uint256 multiplier;
    }

    mapping(address => TrustData) private _trustScores;

    function setTrustScore(address user, uint256 score, uint256 multiplier) external {
        _trustScores[user] = TrustData(score, multiplier);
    }

    function getTrustScore(address user)
        external
        view
        returns (uint256 score, string memory level, uint256 multiplier, uint8 hops, address[] memory trustChain)
    {
        TrustData memory data = _trustScores[user];
        score = data.score;
        multiplier = data.multiplier;
        level = "Mock";
        hops = 1;
        trustChain = new address[](0);
    }
}

// ============ Mock Tribunal ============

contract MockTribunal {
    mapping(bytes32 => ITribunal.Trial) private _trials;

    function setTrial(
        bytes32 trialId,
        bytes32 caseId,
        ITribunal.TrialPhase phase,
        ITribunal.Verdict verdict
    ) external {
        _trials[trialId].caseId = caseId;
        _trials[trialId].phase = phase;
        _trials[trialId].verdict = verdict;
    }

    function getTrial(bytes32 trialId) external view returns (ITribunal.Trial memory) {
        return _trials[trialId];
    }
}

// ============ Mock QuadraticVoting ============

contract MockQuadraticVoting {
    mapping(uint256 => IQuadraticVoting.Proposal) private _proposals;

    function setProposal(
        uint256 proposalId,
        uint64 startTime,
        IQuadraticVoting.ProposalState state
    ) external {
        _proposals[proposalId].startTime = startTime;
        _proposals[proposalId].state = state;
    }

    function getProposal(uint256 proposalId) external view returns (IQuadraticVoting.Proposal memory) {
        return _proposals[proposalId];
    }
}

// ============ Test Contract ============

/**
 * @title ContributionAttestor Unit Tests
 * @notice Comprehensive tests for the 3-branch contribution attestation governance.
 * @dev Covers:
 *      - Constructor validation
 *      - Executive branch: submit, attest, contest, auto-accept, expiry
 *      - Judicial branch: escalation to tribunal, verdict resolution
 *      - Legislative branch: escalation to governance, vote resolution
 *      - Admin functions: threshold, TTL, rejection
 *      - View functions: getClaim, getAttestations, getCumulativeWeight
 *      - Access control and error conditions
 *      - Fuzz tests for weight accumulation
 */
contract ContributionAttestorTest is Test {

    // Re-declare events for expectEmit
    event ClaimSubmitted(
        bytes32 indexed claimId,
        address indexed contributor,
        address indexed claimant,
        IContributionAttestor.ContributionType contribType,
        uint256 value
    );
    event ClaimAttested(bytes32 indexed claimId, address indexed attester, uint256 weight, int256 newNetWeight);
    event ClaimContested(bytes32 indexed claimId, address indexed contester, uint256 weight, int256 newNetWeight, bytes32 reasonHash);
    event ClaimAccepted(bytes32 indexed claimId, address indexed contributor, int256 finalWeight, uint256 attestationCount);
    event ClaimRejected(bytes32 indexed claimId, string reason);
    event ClaimExpired(bytes32 indexed claimId);
    event ClaimEscalatedToTribunal(bytes32 indexed claimId, bytes32 indexed trialId);
    event ClaimResolvedByTribunal(bytes32 indexed claimId, bytes32 indexed trialId, bool accepted);
    event ClaimEscalatedToGovernance(bytes32 indexed claimId, uint256 indexed proposalId);
    event ClaimResolvedByGovernance(bytes32 indexed claimId, uint256 indexed proposalId, bool accepted);
    event AcceptanceThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event ClaimTTLUpdated(uint256 oldTTL, uint256 newTTL);
    event TribunalUpdated(address oldTribunal, address newTribunal);
    event GovernanceUpdated(address oldGovernance, address newGovernance);

    ContributionAttestor public attestor;
    MockContributionDAG public dag;
    MockTribunal public tribunal;
    MockQuadraticVoting public governance;

    address public owner;
    address public alice; // contributor
    address public bob;   // claimant
    address public carol; // attester with trust
    address public dave;  // attester with trust
    address public eve;   // untrusted

    uint256 public constant ACCEPTANCE_THRESHOLD = 2e18; // 2.0 in PRECISION
    uint256 public constant CLAIM_TTL = 7 days;
    uint256 public constant BPS = 10000;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        dave = makeAddr("dave");
        eve = makeAddr("eve");

        // Deploy mock DAG
        dag = new MockContributionDAG();

        // Deploy attestor
        attestor = new ContributionAttestor(
            address(dag),
            ACCEPTANCE_THRESHOLD,
            CLAIM_TTL
        );

        // Deploy and configure tribunal + governance
        tribunal = new MockTribunal();
        governance = new MockQuadraticVoting();
        attestor.setTribunal(address(tribunal));
        attestor.setGovernance(address(governance));

        // Set trust scores: carol = founder-level (score=1e18, multiplier=30000 → weight = 3.0)
        dag.setTrustScore(carol, 1e18, 30000);
        // dave = trusted (score=1e18, multiplier=20000 → weight = 2.0)
        dag.setTrustScore(dave, 1e18, 20000);
        // eve = no trust (score=0, multiplier=0)
        dag.setTrustScore(eve, 0, 0);
    }

    // ============ Helpers ============

    /// @dev Submit a claim and return the claimId
    function _submitClaim() internal returns (bytes32) {
        vm.prank(bob);
        return attestor.submitClaim(
            alice,
            IContributionAttestor.ContributionType.Code,
            keccak256("evidence"),
            "Built the AMM core",
            1000e18
        );
    }

    /// @dev Submit claim from a specific claimant for a specific contributor
    function _submitClaimFrom(address claimant, address contributor) internal returns (bytes32) {
        vm.prank(claimant);
        return attestor.submitClaim(
            contributor,
            IContributionAttestor.ContributionType.Code,
            keccak256("evidence"),
            "Some contribution",
            500e18
        );
    }

    // ================================================================
    //                  CONSTRUCTOR TESTS
    // ================================================================

    function test_constructor_setsDAG() public view {
        assertEq(address(attestor.contributionDAG()), address(dag));
    }

    function test_constructor_setsThreshold() public view {
        assertEq(attestor.acceptanceThreshold(), ACCEPTANCE_THRESHOLD);
    }

    function test_constructor_setsTTL() public view {
        assertEq(attestor.claimTTL(), CLAIM_TTL);
    }

    function test_constructor_revertsOnZeroDAG() public {
        vm.expectRevert(IContributionAttestor.ZeroAddress.selector);
        new ContributionAttestor(address(0), ACCEPTANCE_THRESHOLD, CLAIM_TTL);
    }

    function test_constructor_revertsOnZeroThreshold() public {
        vm.expectRevert(IContributionAttestor.ThresholdTooLow.selector);
        new ContributionAttestor(address(dag), 0, CLAIM_TTL);
    }

    function test_constructor_revertsOnShortTTL() public {
        vm.expectRevert(IContributionAttestor.TTLTooShort.selector);
        new ContributionAttestor(address(dag), ACCEPTANCE_THRESHOLD, 1 hours);
    }

    function test_constructor_acceptsMinTTL() public {
        ContributionAttestor a = new ContributionAttestor(address(dag), 1, 1 days);
        assertEq(a.claimTTL(), 1 days);
    }

    // ================================================================
    //                  EXECUTIVE BRANCH: SUBMIT CLAIM
    // ================================================================

    function test_submitClaim_createsClaimWithCorrectData() public {
        bytes32 claimId = _submitClaim();

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);

        assertEq(claim.contributor, alice);
        assertEq(claim.claimant, bob);
        assertEq(uint256(claim.contribType), uint256(IContributionAttestor.ContributionType.Code));
        assertEq(claim.evidenceHash, keccak256("evidence"));
        assertEq(claim.description, "Built the AMM core");
        assertEq(claim.value, 1000e18);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Pending));
        assertEq(uint256(claim.resolvedBy), uint256(IContributionAttestor.ResolutionSource.None));
        assertEq(claim.netWeight, 0);
        assertEq(claim.attestationCount, 0);
        assertEq(claim.contestationCount, 0);
    }

    function test_submitClaim_setsExpiryCorrectly() public {
        uint256 startTime = block.timestamp;
        bytes32 claimId = _submitClaim();

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(claim.timestamp, startTime);
        assertEq(claim.expiresAt, startTime + CLAIM_TTL);
    }

    function test_submitClaim_emitsEvent() public {
        vm.prank(bob);
        vm.expectEmit(false, true, true, true); // claimId is hash-derived, skip topic[1] match
        emit ClaimSubmitted(bytes32(0), alice, bob, IContributionAttestor.ContributionType.Code, 1000e18);
        attestor.submitClaim(
            alice,
            IContributionAttestor.ContributionType.Code,
            keccak256("evidence"),
            "Built the AMM core",
            1000e18
        );
    }

    function test_submitClaim_incrementsClaimCount() public {
        assertEq(attestor.getClaimCount(), 0);
        _submitClaim();
        assertEq(attestor.getClaimCount(), 1);
        _submitClaimFrom(carol, dave);
        assertEq(attestor.getClaimCount(), 2);
    }

    function test_submitClaim_tracksContributorClaims() public {
        bytes32 c1 = _submitClaim();
        bytes32 c2 = _submitClaimFrom(carol, alice);

        bytes32[] memory claims = attestor.getClaimsByContributor(alice);
        assertEq(claims.length, 2);
        assertEq(claims[0], c1);
        assertEq(claims[1], c2);
    }

    function test_submitClaim_revertsOnZeroContributor() public {
        vm.prank(bob);
        vm.expectRevert(IContributionAttestor.ZeroAddress.selector);
        attestor.submitClaim(
            address(0),
            IContributionAttestor.ContributionType.Code,
            bytes32(0),
            "desc",
            100
        );
    }

    function test_submitClaim_revertsOnEmptyDescription() public {
        vm.prank(bob);
        vm.expectRevert(IContributionAttestor.EmptyDescription.selector);
        attestor.submitClaim(
            alice,
            IContributionAttestor.ContributionType.Code,
            bytes32(0),
            "",
            100
        );
    }

    function test_submitClaim_selfClaimAllowed() public {
        // Contributor can submit their own claim
        vm.prank(alice);
        bytes32 claimId = attestor.submitClaim(
            alice,
            IContributionAttestor.ContributionType.Code,
            bytes32(0),
            "I built this",
            100
        );

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(claim.contributor, alice);
        assertEq(claim.claimant, alice);
    }

    // ================================================================
    //                  EXECUTIVE BRANCH: ATTEST
    // ================================================================

    function test_attest_addsPositiveWeight() public {
        bytes32 claimId = _submitClaim();

        vm.prank(carol);
        attestor.attest(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        // carol: score=1e18, multiplier=30000 → weight = 1e18 * 30000 / 10000 = 3e18
        assertEq(claim.netWeight, int256(3e18));
        assertEq(claim.attestationCount, 1);
    }

    function test_attest_emitsEvent() public {
        bytes32 claimId = _submitClaim();

        vm.prank(carol);
        vm.expectEmit(true, true, false, true);
        emit ClaimAttested(claimId, carol, 3e18, int256(3e18));
        attestor.attest(claimId);
    }

    function test_attest_autoAcceptsOnThreshold() public {
        bytes32 claimId = _submitClaim();

        // carol's weight = 3e18 > threshold of 2e18 → auto-accept
        vm.prank(carol);
        attestor.attest(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Accepted));
        assertEq(uint256(claim.resolvedBy), uint256(IContributionAttestor.ResolutionSource.Executive));
    }

    function test_attest_doesNotAutoAcceptBelowThreshold() public {
        bytes32 claimId = _submitClaim();

        // Set carol to lower trust: weight = 0.5e18 * 20000 / 10000 = 1e18 < threshold of 2e18
        dag.setTrustScore(carol, 0.5e18, 20000);

        vm.prank(carol);
        attestor.attest(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Pending));
    }

    function test_attest_cumulativeWeightReachesThreshold() public {
        bytes32 claimId = _submitClaim();

        // Set both to lower trust so individually insufficient
        dag.setTrustScore(carol, 0.5e18, 20000); // weight = 1e18
        dag.setTrustScore(dave, 0.5e18, 20000);   // weight = 1e18

        vm.prank(carol);
        attestor.attest(claimId);
        // netWeight = 1e18, still pending
        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Pending));

        vm.prank(dave);
        attestor.attest(claimId);
        // netWeight = 2e18 >= threshold → accepted
        claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Accepted));
    }

    function test_attest_revertsOnNonexistentClaim() public {
        vm.prank(carol);
        vm.expectRevert(IContributionAttestor.ClaimNotFound.selector);
        attestor.attest(bytes32(uint256(999)));
    }

    function test_attest_revertsOnNonPendingClaim() public {
        bytes32 claimId = _submitClaim();

        // Auto-accept via carol's high weight
        vm.prank(carol);
        attestor.attest(claimId);

        // Now dave tries to attest the already accepted claim
        vm.prank(dave);
        vm.expectRevert(IContributionAttestor.ClaimNotPending.selector);
        attestor.attest(claimId);
    }

    function test_attest_revertsOnExpiredClaim() public {
        bytes32 claimId = _submitClaim();

        vm.warp(block.timestamp + CLAIM_TTL + 1);

        vm.prank(carol);
        vm.expectRevert(IContributionAttestor.ClaimExpiredError.selector);
        attestor.attest(claimId);
    }

    function test_attest_revertsOnDoubleAttestation() public {
        bytes32 claimId = _submitClaim();

        // Lower carol's trust so the claim stays pending after first attestation
        dag.setTrustScore(carol, 0.5e18, 10000); // weight = 0.5e18

        vm.prank(carol);
        attestor.attest(claimId);

        vm.prank(carol);
        vm.expectRevert(IContributionAttestor.AlreadyAttested.selector);
        attestor.attest(claimId);
    }

    function test_attest_revertsOnSelfAttestByClaimant() public {
        bytes32 claimId = _submitClaim(); // bob is claimant

        dag.setTrustScore(bob, 1e18, 30000);

        vm.prank(bob);
        vm.expectRevert(IContributionAttestor.CannotAttestOwnClaim.selector);
        attestor.attest(claimId);
    }

    function test_attest_revertsOnSelfAttestByContributor() public {
        bytes32 claimId = _submitClaim(); // alice is contributor

        dag.setTrustScore(alice, 1e18, 30000);

        vm.prank(alice);
        vm.expectRevert(IContributionAttestor.CannotAttestOwnClaim.selector);
        attestor.attest(claimId);
    }

    function test_attest_revertsOnZeroTrust() public {
        bytes32 claimId = _submitClaim();

        // eve has score=0, multiplier=0
        vm.prank(eve);
        vm.expectRevert(IContributionAttestor.ZeroTrustScore.selector);
        attestor.attest(claimId);
    }

    function test_attest_recordsHasAttested() public {
        bytes32 claimId = _submitClaim();

        assertFalse(attestor.hasAttested(claimId, carol));

        // Lower weight to avoid auto-accept
        dag.setTrustScore(carol, 0.1e18, 10000);

        vm.prank(carol);
        attestor.attest(claimId);

        assertTrue(attestor.hasAttested(claimId, carol));
    }

    // ================================================================
    //                  EXECUTIVE BRANCH: CONTEST
    // ================================================================

    function test_contest_subtractsWeight() public {
        bytes32 claimId = _submitClaim();

        vm.prank(carol);
        attestor.contest(claimId, keccak256("fraudulent"));

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        // carol: weight = 3e18 → netWeight = -3e18
        assertEq(claim.netWeight, -int256(3e18));
        assertEq(claim.contestationCount, 1);
    }

    function test_contest_emitsEvent() public {
        bytes32 claimId = _submitClaim();

        vm.prank(carol);
        vm.expectEmit(true, true, false, true);
        emit ClaimContested(claimId, carol, 3e18, -int256(3e18), keccak256("fraud"));
        attestor.contest(claimId, keccak256("fraud"));
    }

    function test_contest_marksContestedOnHighNegativeWeight() public {
        bytes32 claimId = _submitClaim();

        // carol weight = 3e18. threshold/2 = 1e18.
        // netWeight = -3e18 < -1e18 → status = Contested
        vm.prank(carol);
        attestor.contest(claimId, keccak256("fraud"));

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Contested));
    }

    function test_contest_staysPendingOnSmallNegativeWeight() public {
        bytes32 claimId = _submitClaim();

        // Small trust: weight = 0.1e18 * 10000 / 10000 = 0.1e18
        dag.setTrustScore(carol, 0.1e18, 10000);

        vm.prank(carol);
        attestor.contest(claimId, keccak256("minor"));

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        // -0.1e18 is NOT < -1e18, so stays Pending
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Pending));
    }

    function test_contest_revertsOnZeroTrust() public {
        bytes32 claimId = _submitClaim();

        vm.prank(eve);
        vm.expectRevert(IContributionAttestor.ZeroTrustScore.selector);
        attestor.contest(claimId, bytes32(0));
    }

    function test_contest_revertsOnDoubleAttestation() public {
        bytes32 claimId = _submitClaim();

        // Lower carol's trust so claim doesn't auto-contest
        dag.setTrustScore(carol, 0.1e18, 10000);

        vm.prank(carol);
        attestor.contest(claimId, bytes32(0));

        vm.prank(carol);
        vm.expectRevert(IContributionAttestor.AlreadyAttested.selector);
        attestor.contest(claimId, bytes32(0));
    }

    function test_contest_afterAttest_rejected() public {
        bytes32 claimId = _submitClaim();

        // Carol already attested
        dag.setTrustScore(carol, 0.1e18, 10000);
        vm.prank(carol);
        attestor.attest(claimId);

        // Carol can't contest now (AlreadyAttested covers both)
        vm.prank(carol);
        vm.expectRevert(IContributionAttestor.AlreadyAttested.selector);
        attestor.contest(claimId, bytes32(0));
    }

    // ================================================================
    //                  EXECUTIVE BRANCH: EXPIRY
    // ================================================================

    function test_checkExpiry_marksPendingAsExpired() public {
        bytes32 claimId = _submitClaim();

        vm.warp(block.timestamp + CLAIM_TTL + 1);

        vm.expectEmit(true, false, false, false);
        emit ClaimExpired(claimId);
        attestor.checkExpiry(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Expired));
    }

    function test_checkExpiry_noopBeforeTTL() public {
        bytes32 claimId = _submitClaim();

        vm.warp(block.timestamp + CLAIM_TTL - 1);
        attestor.checkExpiry(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Pending));
    }

    function test_checkExpiry_noopForAcceptedClaim() public {
        bytes32 claimId = _submitClaim();

        // Accept via attestation
        vm.prank(carol);
        attestor.attest(claimId);

        vm.warp(block.timestamp + CLAIM_TTL + 1);
        attestor.checkExpiry(claimId);

        // Should remain Accepted
        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Accepted));
    }

    function test_checkExpiry_revertsOnNonexistentClaim() public {
        vm.expectRevert(IContributionAttestor.ClaimNotFound.selector);
        attestor.checkExpiry(bytes32(uint256(999)));
    }

    // ================================================================
    //                  JUDICIAL BRANCH: TRIBUNAL
    // ================================================================

    function test_escalateToTribunal_fromContested() public {
        bytes32 claimId = _submitClaim();

        // Contest to get Contested status
        vm.prank(carol);
        attestor.contest(claimId, bytes32(0));

        // Setup trial in mock tribunal
        bytes32 trialId = keccak256("trial1");
        tribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.JURY_SELECTION, ITribunal.Verdict.PENDING);

        vm.expectEmit(true, true, false, false);
        emit ClaimEscalatedToTribunal(claimId, trialId);
        attestor.escalateToTribunal(claimId, trialId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Escalated));
        assertEq(attestor.claimTrialIds(claimId), trialId);
    }

    function test_escalateToTribunal_fromPending() public {
        bytes32 claimId = _submitClaim();

        bytes32 trialId = keccak256("trial1");
        tribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.JURY_SELECTION, ITribunal.Verdict.PENDING);

        attestor.escalateToTribunal(claimId, trialId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Escalated));
    }

    function test_escalateToTribunal_revertsOnMismatchedCaseId() public {
        bytes32 claimId = _submitClaim();

        bytes32 trialId = keccak256("trial1");
        // Set trial with wrong caseId
        tribunal.setTrial(trialId, bytes32(uint256(999)), ITribunal.TrialPhase.JURY_SELECTION, ITribunal.Verdict.PENDING);

        vm.expectRevert(IContributionAttestor.TrialCaseIdMismatch.selector);
        attestor.escalateToTribunal(claimId, trialId);
    }

    function test_escalateToTribunal_revertsWhenTribunalNotSet() public {
        // Deploy attestor without tribunal
        ContributionAttestor attestorNoTribunal = new ContributionAttestor(
            address(dag), ACCEPTANCE_THRESHOLD, CLAIM_TTL
        );
        vm.prank(address(this));
        bytes32 claimId;
        {
            claimId = attestorNoTribunal.submitClaim(
                alice,
                IContributionAttestor.ContributionType.Code,
                bytes32(0),
                "desc",
                100
            );
        }

        vm.expectRevert(IContributionAttestor.TribunalNotSet.selector);
        attestorNoTribunal.escalateToTribunal(claimId, bytes32(0));
    }

    function test_escalateToTribunal_revertsOnAcceptedClaim() public {
        bytes32 claimId = _submitClaim();

        // Auto-accept
        vm.prank(carol);
        attestor.attest(claimId);

        bytes32 trialId = keccak256("trial1");
        tribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.JURY_SELECTION, ITribunal.Verdict.PENDING);

        vm.expectRevert(IContributionAttestor.ClaimNotContested.selector);
        attestor.escalateToTribunal(claimId, trialId);
    }

    function test_resolveByTribunal_notGuiltyAccepts() public {
        bytes32 claimId = _submitClaim();
        bytes32 trialId = keccak256("trial1");

        // Escalate
        tribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.JURY_SELECTION, ITribunal.Verdict.PENDING);
        attestor.escalateToTribunal(claimId, trialId);

        // Close trial with NOT_GUILTY verdict
        tribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.CLOSED, ITribunal.Verdict.NOT_GUILTY);

        vm.expectEmit(true, true, false, true);
        emit ClaimResolvedByTribunal(claimId, trialId, true);
        attestor.resolveByTribunal(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Accepted));
        assertEq(uint256(claim.resolvedBy), uint256(IContributionAttestor.ResolutionSource.Judicial));
    }

    function test_resolveByTribunal_guiltyRejects() public {
        bytes32 claimId = _submitClaim();
        bytes32 trialId = keccak256("trial1");

        tribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.JURY_SELECTION, ITribunal.Verdict.PENDING);
        attestor.escalateToTribunal(claimId, trialId);

        tribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.CLOSED, ITribunal.Verdict.GUILTY);

        attestor.resolveByTribunal(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Rejected));
        assertEq(uint256(claim.resolvedBy), uint256(IContributionAttestor.ResolutionSource.Judicial));
    }

    function test_resolveByTribunal_mistrialReturnsToContested() public {
        bytes32 claimId = _submitClaim();
        bytes32 trialId = keccak256("trial1");

        tribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.JURY_SELECTION, ITribunal.Verdict.PENDING);
        attestor.escalateToTribunal(claimId, trialId);

        tribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.CLOSED, ITribunal.Verdict.MISTRIAL);

        attestor.resolveByTribunal(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Contested));
    }

    function test_resolveByTribunal_revertsIfTrialNotClosed() public {
        bytes32 claimId = _submitClaim();
        bytes32 trialId = keccak256("trial1");

        tribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.JURY_SELECTION, ITribunal.Verdict.PENDING);
        attestor.escalateToTribunal(claimId, trialId);

        // Trial still in DELIBERATION phase
        tribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.DELIBERATION, ITribunal.Verdict.PENDING);

        vm.expectRevert(IContributionAttestor.TrialNotClosed.selector);
        attestor.resolveByTribunal(claimId);
    }

    function test_resolveByTribunal_revertsIfNotEscalated() public {
        bytes32 claimId = _submitClaim();

        vm.expectRevert(IContributionAttestor.ClaimNotEscalated.selector);
        attestor.resolveByTribunal(claimId);
    }

    // ================================================================
    //                  LEGISLATIVE BRANCH: GOVERNANCE
    // ================================================================

    function test_escalateToGovernance_fromPending() public {
        bytes32 claimId = _submitClaim();
        uint256 proposalId = 42;

        governance.setProposal(proposalId, uint64(block.timestamp), IQuadraticVoting.ProposalState.ACTIVE);

        vm.expectEmit(true, true, false, false);
        emit ClaimEscalatedToGovernance(claimId, proposalId);
        attestor.escalateToGovernance(claimId, proposalId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.GovernanceReview));
        assertEq(attestor.claimProposalIds(claimId), proposalId);
    }

    function test_escalateToGovernance_fromEscalated() public {
        bytes32 claimId = _submitClaim();
        bytes32 trialId = keccak256("trial1");

        // First escalate to tribunal
        tribunal.setTrial(trialId, claimId, ITribunal.TrialPhase.JURY_SELECTION, ITribunal.Verdict.PENDING);
        attestor.escalateToTribunal(claimId, trialId);

        // Then escalate to governance (supreme override)
        uint256 proposalId = 1;
        governance.setProposal(proposalId, uint64(block.timestamp), IQuadraticVoting.ProposalState.ACTIVE);
        attestor.escalateToGovernance(claimId, proposalId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.GovernanceReview));
    }

    function test_escalateToGovernance_fromAccepted() public {
        bytes32 claimId = _submitClaim();

        // Auto-accept
        vm.prank(carol);
        attestor.attest(claimId);

        // Governance can override even accepted claims
        uint256 proposalId = 1;
        governance.setProposal(proposalId, uint64(block.timestamp), IQuadraticVoting.ProposalState.ACTIVE);
        attestor.escalateToGovernance(claimId, proposalId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.GovernanceReview));
    }

    function test_escalateToGovernance_revertsIfAlreadyUnderReview() public {
        bytes32 claimId = _submitClaim();

        uint256 proposalId = 1;
        governance.setProposal(proposalId, uint64(block.timestamp), IQuadraticVoting.ProposalState.ACTIVE);
        attestor.escalateToGovernance(claimId, proposalId);

        // Try again
        vm.expectRevert(IContributionAttestor.AlreadyEscalated.selector);
        attestor.escalateToGovernance(claimId, 2);
    }

    function test_escalateToGovernance_revertsIfExpired() public {
        bytes32 claimId = _submitClaim();

        vm.warp(block.timestamp + CLAIM_TTL + 1);
        attestor.checkExpiry(claimId);

        vm.expectRevert(IContributionAttestor.ClaimExpiredError.selector);
        attestor.escalateToGovernance(claimId, 1);
    }

    function test_escalateToGovernance_revertsWhenGovernanceNotSet() public {
        ContributionAttestor attestorNoGov = new ContributionAttestor(
            address(dag), ACCEPTANCE_THRESHOLD, CLAIM_TTL
        );

        bytes32 claimId = attestorNoGov.submitClaim(
            alice,
            IContributionAttestor.ContributionType.Code,
            bytes32(0),
            "desc",
            100
        );

        vm.expectRevert(IContributionAttestor.GovernanceNotSet.selector);
        attestorNoGov.escalateToGovernance(claimId, 1);
    }

    function test_resolveByGovernance_succeededAccepts() public {
        bytes32 claimId = _submitClaim();
        uint256 proposalId = 1;

        governance.setProposal(proposalId, uint64(block.timestamp), IQuadraticVoting.ProposalState.ACTIVE);
        attestor.escalateToGovernance(claimId, proposalId);

        governance.setProposal(proposalId, uint64(block.timestamp), IQuadraticVoting.ProposalState.SUCCEEDED);

        vm.expectEmit(true, true, false, true);
        emit ClaimResolvedByGovernance(claimId, proposalId, true);
        attestor.resolveByGovernance(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Accepted));
        assertEq(uint256(claim.resolvedBy), uint256(IContributionAttestor.ResolutionSource.Legislative));
    }

    function test_resolveByGovernance_defeatedRejects() public {
        bytes32 claimId = _submitClaim();
        uint256 proposalId = 1;

        governance.setProposal(proposalId, uint64(block.timestamp), IQuadraticVoting.ProposalState.ACTIVE);
        attestor.escalateToGovernance(claimId, proposalId);

        governance.setProposal(proposalId, uint64(block.timestamp), IQuadraticVoting.ProposalState.DEFEATED);

        attestor.resolveByGovernance(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Rejected));
        assertEq(uint256(claim.resolvedBy), uint256(IContributionAttestor.ResolutionSource.Legislative));
    }

    function test_resolveByGovernance_revertsIfNotUnderReview() public {
        bytes32 claimId = _submitClaim();

        vm.expectRevert(IContributionAttestor.ClaimNotUnderGovernance.selector);
        attestor.resolveByGovernance(claimId);
    }

    function test_resolveByGovernance_revertsIfProposalNotFinalized() public {
        bytes32 claimId = _submitClaim();
        uint256 proposalId = 1;

        governance.setProposal(proposalId, uint64(block.timestamp), IQuadraticVoting.ProposalState.ACTIVE);
        attestor.escalateToGovernance(claimId, proposalId);

        // Proposal still ACTIVE, not SUCCEEDED or DEFEATED
        vm.expectRevert(IContributionAttestor.ProposalNotFinalized.selector);
        attestor.resolveByGovernance(claimId);
    }

    // ================================================================
    //                  VIEW FUNCTIONS
    // ================================================================

    function test_getAttestations_returnsAllAttestations() public {
        bytes32 claimId = _submitClaim();

        dag.setTrustScore(carol, 0.5e18, 10000); // weight = 0.5e18
        dag.setTrustScore(dave, 0.3e18, 10000);  // weight = 0.3e18

        vm.prank(carol);
        attestor.attest(claimId);
        vm.prank(dave);
        attestor.contest(claimId, keccak256("reason"));

        IContributionAttestor.Attestation[] memory attestations = attestor.getAttestations(claimId);
        assertEq(attestations.length, 2);

        // Carol's attestation
        assertEq(attestations[0].attester, carol);
        assertEq(attestations[0].weight, 0.5e18);
        assertFalse(attestations[0].isContestation);

        // Dave's contestation
        assertEq(attestations[1].attester, dave);
        assertEq(attestations[1].weight, 0.3e18);
        assertTrue(attestations[1].isContestation);
    }

    function test_getCumulativeWeight_computesCorrectly() public {
        bytes32 claimId = _submitClaim();

        dag.setTrustScore(carol, 0.5e18, 10000); // weight = 0.5e18
        dag.setTrustScore(dave, 0.3e18, 10000);  // weight = 0.3e18

        vm.prank(carol);
        attestor.attest(claimId);
        vm.prank(dave);
        attestor.contest(claimId, bytes32(0));

        (int256 netWeight, uint256 totalPos, uint256 totalNeg, bool isAccepted) = attestor.getCumulativeWeight(claimId);

        assertEq(netWeight, 0.2e18);
        assertEq(totalPos, 0.5e18);
        assertEq(totalNeg, 0.3e18);
        assertFalse(isAccepted); // 0.2e18 < 2e18 threshold
    }

    function test_previewAttestationWeight_showsCorrectWeight() public view {
        uint256 weight = attestor.previewAttestationWeight(carol);
        // carol: score=1e18, multiplier=30000 → weight = 3e18
        assertEq(weight, 3e18);
    }

    // ================================================================
    //                  ADMIN FUNCTIONS
    // ================================================================

    function test_setAcceptanceThreshold_updatesValue() public {
        uint256 newThreshold = 5e18;

        vm.expectEmit(true, true, false, false);
        emit AcceptanceThresholdUpdated(ACCEPTANCE_THRESHOLD, newThreshold);
        attestor.setAcceptanceThreshold(newThreshold);

        assertEq(attestor.acceptanceThreshold(), newThreshold);
    }

    function test_setAcceptanceThreshold_revertsOnZero() public {
        vm.expectRevert(IContributionAttestor.ThresholdTooLow.selector);
        attestor.setAcceptanceThreshold(0);
    }

    function test_setAcceptanceThreshold_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        attestor.setAcceptanceThreshold(5e18);
    }

    function test_setClaimTTL_updatesValue() public {
        uint256 newTTL = 14 days;

        vm.expectEmit(true, true, false, false);
        emit ClaimTTLUpdated(CLAIM_TTL, newTTL);
        attestor.setClaimTTL(newTTL);

        assertEq(attestor.claimTTL(), newTTL);
    }

    function test_setClaimTTL_revertsOnShortTTL() public {
        vm.expectRevert(IContributionAttestor.TTLTooShort.selector);
        attestor.setClaimTTL(1 hours);
    }

    function test_rejectClaim_ownerCanReject() public {
        bytes32 claimId = _submitClaim();

        vm.expectEmit(true, false, false, true);
        emit ClaimRejected(claimId, "spam");
        attestor.rejectClaim(claimId, "spam");

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint256(claim.status), uint256(IContributionAttestor.ClaimStatus.Rejected));
    }

    function test_rejectClaim_revertsForNonOwner() public {
        bytes32 claimId = _submitClaim();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        attestor.rejectClaim(claimId, "spam");
    }

    function test_rejectClaim_revertsOnNonPendingClaim() public {
        bytes32 claimId = _submitClaim();

        // Accept first
        vm.prank(carol);
        attestor.attest(claimId);

        vm.expectRevert(IContributionAttestor.ClaimNotPending.selector);
        attestor.rejectClaim(claimId, "too late");
    }

    function test_setContributionDAG_updates() public {
        address newDAG = makeAddr("newDAG");
        attestor.setContributionDAG(newDAG);
        assertEq(address(attestor.contributionDAG()), newDAG);
    }

    function test_setContributionDAG_revertsOnZero() public {
        vm.expectRevert(IContributionAttestor.ZeroAddress.selector);
        attestor.setContributionDAG(address(0));
    }

    function test_setTribunal_updates() public {
        address newTribunal = makeAddr("newTribunal");

        vm.expectEmit(true, true, false, false);
        emit TribunalUpdated(address(tribunal), newTribunal);
        attestor.setTribunal(newTribunal);

        assertEq(address(attestor.tribunal()), newTribunal);
    }

    function test_setGovernance_updates() public {
        address newGov = makeAddr("newGov");

        vm.expectEmit(true, true, false, false);
        emit GovernanceUpdated(address(governance), newGov);
        attestor.setGovernance(newGov);

        assertEq(address(attestor.governance()), newGov);
    }

    // ================================================================
    //                  FUZZ TESTS
    // ================================================================

    function testFuzz_submitClaim_uniqueClaimIds(uint8 count) public {
        vm.assume(count > 0 && count <= 20);

        bytes32[] memory claimIds = new bytes32[](count);
        for (uint8 i = 0; i < count; i++) {
            vm.prank(bob);
            claimIds[i] = attestor.submitClaim(
                alice,
                IContributionAttestor.ContributionType.Code,
                bytes32(uint256(i)),
                "desc",
                100
            );
        }

        // All claim IDs should be unique
        for (uint256 i = 0; i < claimIds.length; i++) {
            for (uint256 j = i + 1; j < claimIds.length; j++) {
                assertTrue(claimIds[i] != claimIds[j], "Duplicate claim IDs");
            }
        }
    }

    function testFuzz_attest_weightCalculation(uint256 score, uint256 multiplier) public {
        score = bound(score, 1, 100e18);
        multiplier = bound(multiplier, 5001, 30000); // Above BPS/2 so not rejected as ZeroTrust

        dag.setTrustScore(carol, score, multiplier);

        bytes32 claimId = _submitClaim();

        vm.prank(carol);
        attestor.attest(claimId);

        uint256 expectedWeight = (score * multiplier) / BPS;
        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(claim.netWeight, int256(expectedWeight));
    }

    function testFuzz_contest_weightCalculation(uint256 score, uint256 multiplier) public {
        score = bound(score, 1, 100e18);
        multiplier = bound(multiplier, 5001, 30000);

        dag.setTrustScore(carol, score, multiplier);

        bytes32 claimId = _submitClaim();

        vm.prank(carol);
        attestor.contest(claimId, bytes32(0));

        uint256 expectedWeight = (score * multiplier) / BPS;
        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(claim.netWeight, -int256(expectedWeight));
    }
}
