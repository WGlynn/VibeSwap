// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/ContributionAttestor.sol";
import "../../contracts/identity/ContributionDAG.sol";
import "../../contracts/governance/DecentralizedTribunal.sol";
import "../../contracts/mechanism/QuadraticVoting.sol";
import "../../contracts/compliance/FederatedConsensus.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockJULToken is ERC20 {
    constructor() ERC20("Joule", "JUL") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice Mock SoulboundIdentity that always returns valid identity
contract MockSoulboundIdentity {
    struct IdentityInfo {
        bytes32 identityHash;
        uint64 createdAt;
        uint8 level;
        uint256 reputation;
    }

    mapping(address => bool) public hasId;
    mapping(address => IdentityInfo) public identities;

    function grantIdentity(address user, uint8 level, uint256 reputation) external {
        hasId[user] = true;
        identities[user] = IdentityInfo({
            identityHash: keccak256(abi.encodePacked(user)),
            createdAt: uint64(block.timestamp),
            level: level,
            reputation: reputation
        });
    }

    function hasIdentity(address addr) external view returns (bool) {
        return hasId[addr];
    }

    function getIdentity(address addr) external view returns (IdentityInfo memory) {
        return identities[addr];
    }
}

/// @notice Mock ReputationOracle that always says eligible
contract MockReputationOracle {
    function isEligible(address, uint8) external pure returns (bool) {
        return true;
    }
}

// ============ Integration Test: Three-Branch Governance ============

/**
 * @title ThreeBranchGovernancePipelineTest
 * @notice Tests the complete 3-branch contribution attestation governance:
 *   Executive: submitClaim -> attest/contest via ContributionDAG trust scores -> auto-accept
 *   Judicial:  escalateToTribunal -> jury trial -> verdict -> resolveByTribunal
 *   Legislative: escalateToGovernance -> quadratic vote -> resolveByGovernance (supreme override)
 *
 * Hierarchy: Legislative > Judicial > Executive
 */
contract ThreeBranchGovernancePipelineTest is Test {
    // Core contracts
    ContributionAttestor attestor;
    ContributionDAG dag;
    DecentralizedTribunal tribunal;
    QuadraticVoting governance;
    FederatedConsensus consensus;

    // Support contracts
    MockSoulboundIdentity soulbound;
    MockReputationOracle reputationOracle;
    MockJULToken julToken;

    // Actors
    address owner;
    address founder1;
    address founder2;
    address trustedUser;
    address contributor;
    address juror1;
    address juror2;
    address juror3;
    address juror4;
    address juror5;
    address juror6;
    address juror7;
    address voter1;
    address voter2;

    function setUp() public {
        owner = address(this);
        founder1 = makeAddr("founder1");
        founder2 = makeAddr("founder2");
        trustedUser = makeAddr("trustedUser");
        contributor = makeAddr("contributor");
        juror1 = makeAddr("juror1");
        juror2 = makeAddr("juror2");
        juror3 = makeAddr("juror3");
        juror4 = makeAddr("juror4");
        juror5 = makeAddr("juror5");
        juror6 = makeAddr("juror6");
        juror7 = makeAddr("juror7");
        voter1 = makeAddr("voter1");
        voter2 = makeAddr("voter2");

        _deploySystem();
        _setupTrustNetwork();
        _setupIdentities();
        _fundVoters();
    }

    function _deploySystem() internal {
        // SoulboundIdentity mock
        soulbound = new MockSoulboundIdentity();

        // ReputationOracle mock
        reputationOracle = new MockReputationOracle();

        // JUL token
        julToken = new MockJULToken();

        // ContributionDAG — pass address(0) for soulbound to disable identity checks
        // (we'll test with trust scores, not identity gating)
        dag = new ContributionDAG(address(0));

        // FederatedConsensus — needed by Tribunal for verdict votes
        FederatedConsensus consensusImpl = new FederatedConsensus();
        ERC1967Proxy consensusProxy = new ERC1967Proxy(
            address(consensusImpl),
            abi.encodeWithSelector(FederatedConsensus.initialize.selector, owner, 1, 1 hours)
        );
        consensus = FederatedConsensus(address(consensusProxy));

        // DecentralizedTribunal — disable soulbound for easier juror testing
        DecentralizedTribunal tribunalImpl = new DecentralizedTribunal();
        ERC1967Proxy tribunalProxy = new ERC1967Proxy(
            address(tribunalImpl),
            abi.encodeWithSelector(DecentralizedTribunal.initialize.selector, owner, address(consensus))
        );
        tribunal = DecentralizedTribunal(payable(address(tribunalProxy)));
        // Disable soulbound identity check for jurors in test
        tribunal.setSoulboundIdentity(address(0));

        // QuadraticVoting
        governance = new QuadraticVoting(
            address(julToken),
            address(reputationOracle),
            address(soulbound)
        );

        // Register tribunal as authority so it can cast consensus votes on verdicts
        consensus.addAuthority(address(tribunal), FederatedConsensus.AuthorityRole.ONCHAIN_TRIBUNAL, "GLOBAL");

        // ContributionAttestor — threshold = 2e18 (approx 2 founder attestations)
        attestor = new ContributionAttestor(address(dag), 2e18, 7 days);

        // Wire tribunal and governance to attestor
        attestor.setTribunal(address(tribunal));
        attestor.setGovernance(address(governance));
    }

    function _setupTrustNetwork() internal {
        // Add founders (score = 1.0, multiplier = 3.0x)
        dag.addFounder(founder1);
        dag.addFounder(founder2);

        // Founders vouch for each other (handshake)
        vm.prank(founder1);
        dag.addVouch(founder2, keccak256("f1 vouches f2"));
        vm.prank(founder2);
        dag.addVouch(founder1, keccak256("f2 vouches f1"));

        // Founders vouch for trustedUser
        vm.prank(founder1);
        dag.addVouch(trustedUser, keccak256("f1 vouches trusted"));
        vm.prank(founder2);
        dag.addVouch(trustedUser, keccak256("f2 vouches trusted"));

        // trustedUser vouches back (handshake)
        vm.prank(trustedUser);
        dag.addVouch(founder1, keccak256("trusted vouches f1"));
        vm.prank(trustedUser);
        dag.addVouch(founder2, keccak256("trusted vouches f2"));

        // Recalculate trust scores
        dag.recalculateTrustScores();
    }

    function _setupIdentities() internal {
        // Grant soulbound identities (for QuadraticVoting)
        soulbound.grantIdentity(voter1, 3, 100);
        soulbound.grantIdentity(voter2, 3, 100);
        soulbound.grantIdentity(contributor, 2, 50);

        // Fund jurors with ETH for staking
        address[7] memory jurors = [juror1, juror2, juror3, juror4, juror5, juror6, juror7];
        for (uint256 i = 0; i < 7; i++) {
            vm.deal(jurors[i], 10 ether);
        }
    }

    function _fundVoters() internal {
        // Fund voters with JUL tokens for quadratic voting
        julToken.mint(voter1, 10000 ether);
        julToken.mint(voter2, 10000 ether);

        // Approve QuadraticVoting to spend JUL
        vm.prank(voter1);
        julToken.approve(address(governance), type(uint256).max);
        vm.prank(voter2);
        julToken.approve(address(governance), type(uint256).max);
    }

    // ============ Helper: Submit a claim ============

    function _submitClaim() internal returns (bytes32 claimId) {
        claimId = attestor.submitClaim(
            contributor,
            IContributionAttestor.ContributionType.Code,
            keccak256("evidence-hash-1"),
            "Implemented VibeSwap core module",
            100 ether
        );
    }

    // ============ Helper: Run full tribunal trial to verdict ============

    function _runTrial(bytes32 caseId, bool guiltyVerdict) internal returns (bytes32 trialId) {
        // Open trial
        trialId = tribunal.openTrial(caseId, bytes32(0));

        // All 7 jurors volunteer (default jury size = 7)
        address[7] memory jurorList = [juror1, juror2, juror3, juror4, juror5, juror6, juror7];
        for (uint256 i = 0; i < 7; i++) {
            vm.prank(jurorList[i]);
            tribunal.volunteerAsJuror{value: 0.1 ether}(trialId);
        }

        // Submit evidence
        tribunal.submitEvidence(trialId, "ipfs://evidence-1");

        // Advance past evidence deadline
        vm.warp(block.timestamp + 5 days + 1);
        tribunal.advanceToDeliberation(trialId);

        // Jurors vote (majority determines verdict)
        if (guiltyVerdict) {
            // 5 guilty, 2 not guilty
            for (uint256 i = 0; i < 5; i++) {
                vm.prank(jurorList[i]);
                tribunal.castJuryVote(trialId, true);
            }
            for (uint256 i = 5; i < 7; i++) {
                vm.prank(jurorList[i]);
                tribunal.castJuryVote(trialId, false);
            }
        } else {
            // 5 not guilty, 2 guilty
            for (uint256 i = 0; i < 5; i++) {
                vm.prank(jurorList[i]);
                tribunal.castJuryVote(trialId, false);
            }
            for (uint256 i = 5; i < 7; i++) {
                vm.prank(jurorList[i]);
                tribunal.castJuryVote(trialId, true);
            }
        }

        // Advance past deliberation and render verdict
        vm.warp(block.timestamp + 3 days + 1);
        tribunal.renderVerdict(trialId);

        // Advance past appeal window and close
        vm.warp(block.timestamp + 7 days + 1);
        tribunal.closeTrial(trialId);
    }

    // ============ BRANCH 1: Executive — Attestation via Trust Scores ============

    function test_executive_founderAttestationAcceptsClaim() public {
        bytes32 claimId = _submitClaim();

        // Founder1 attests — score=1e18, multiplier=30000 (3x)
        // Weight = 1e18 * 30000 / 10000 = 3e18 > threshold 2e18
        vm.prank(founder1);
        attestor.attest(claimId);

        // Claim should be auto-accepted (founder weight exceeds threshold)
        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint8(claim.status), uint8(IContributionAttestor.ClaimStatus.Accepted));
        assertEq(uint8(claim.resolvedBy), uint8(IContributionAttestor.ResolutionSource.Executive));
    }

    function test_executive_contestReducesWeight() public {
        bytes32 claimId = _submitClaim();

        // trustedUser attests (weight < threshold, so doesn't auto-accept)
        vm.prank(trustedUser);
        attestor.attest(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint8(claim.status), uint8(IContributionAttestor.ClaimStatus.Pending));
        assertTrue(claim.netWeight > 0);

        // Founder contests — negative weight
        vm.prank(founder1);
        attestor.contest(claimId, keccak256("reason: duplicate work"));

        claim = attestor.getClaim(claimId);
        // Founder's weight (3e18) > trustedUser's weight, so net < 0
        assertTrue(claim.netWeight < 0, "Net weight should be negative after founder contest");
    }

    // ============ BRANCH 2: Judicial — Tribunal Trial ============

    function test_judicial_tribunalAcceptsClaim() public {
        bytes32 claimId = _submitClaim();

        // Founder contests → claim becomes Contested
        vm.prank(founder1);
        attestor.contest(claimId, keccak256("suspicious contribution"));

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint8(claim.status), uint8(IContributionAttestor.ClaimStatus.Contested));

        // Run trial with NOT GUILTY verdict (claim is legitimate)
        bytes32 trialId = _runTrial(claimId, false);

        // Escalate to tribunal
        attestor.escalateToTribunal(claimId, trialId);

        claim = attestor.getClaim(claimId);
        assertEq(uint8(claim.status), uint8(IContributionAttestor.ClaimStatus.Escalated));

        // Resolve by tribunal
        attestor.resolveByTribunal(claimId);

        claim = attestor.getClaim(claimId);
        assertEq(uint8(claim.status), uint8(IContributionAttestor.ClaimStatus.Accepted));
        assertEq(uint8(claim.resolvedBy), uint8(IContributionAttestor.ResolutionSource.Judicial));
    }

    function test_judicial_tribunalRejectsClaim() public {
        bytes32 claimId = _submitClaim();

        // Run trial with GUILTY verdict (claim is fraudulent)
        bytes32 trialId = _runTrial(claimId, true);

        // Escalate pending claim to tribunal
        attestor.escalateToTribunal(claimId, trialId);

        // Resolve by tribunal
        attestor.resolveByTribunal(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint8(claim.status), uint8(IContributionAttestor.ClaimStatus.Rejected));
        assertEq(uint8(claim.resolvedBy), uint8(IContributionAttestor.ResolutionSource.Judicial));
    }

    // ============ BRANCH 3: Legislative — Governance Override ============

    function test_legislative_governanceOverridesRejection() public {
        bytes32 claimId = _submitClaim();

        // Founder contests → Contested → Tribunal rejects (GUILTY)
        vm.prank(founder1);
        attestor.contest(claimId, keccak256("contested"));

        bytes32 trialId = _runTrial(claimId, true);
        attestor.escalateToTribunal(claimId, trialId);
        attestor.resolveByTribunal(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint8(claim.status), uint8(IContributionAttestor.ClaimStatus.Rejected));

        // Governance overrides tribunal's rejection via quadratic vote
        vm.prank(voter1);
        uint256 proposalId = governance.createProposal("Override tribunal rejection for claim", keccak256("ipfs-hash"));

        // Vote FOR the override
        vm.prank(voter1);
        governance.castVote(proposalId, true, 10); // 10 votes = 100 JUL cost

        vm.prank(voter2);
        governance.castVote(proposalId, true, 10);

        // Advance past voting period and finalize
        vm.warp(block.timestamp + 3 days + 1);
        governance.finalizeProposal(proposalId);

        IQuadraticVoting.Proposal memory prop = governance.getProposal(proposalId);
        assertEq(uint8(prop.state), uint8(IQuadraticVoting.ProposalState.SUCCEEDED));

        // Escalate to governance
        attestor.escalateToGovernance(claimId, proposalId);

        // Resolve by governance — supreme override
        attestor.resolveByGovernance(claimId);

        claim = attestor.getClaim(claimId);
        assertEq(uint8(claim.status), uint8(IContributionAttestor.ClaimStatus.Accepted));
        assertEq(uint8(claim.resolvedBy), uint8(IContributionAttestor.ResolutionSource.Legislative));
    }

    function test_legislative_governanceRejectsAcceptedClaim() public {
        bytes32 claimId = _submitClaim();

        // Founder attests → auto-accepted by executive branch
        vm.prank(founder1);
        attestor.attest(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint8(claim.status), uint8(IContributionAttestor.ClaimStatus.Accepted));

        // Governance overrides executive's acceptance with DEFEATED proposal
        vm.prank(voter1);
        uint256 proposalId = governance.createProposal("Reject accepted claim via governance", keccak256("ipfs-2"));

        // Vote AGAINST (defeats the "accept" proposal)
        vm.prank(voter1);
        governance.castVote(proposalId, false, 10);

        vm.prank(voter2);
        governance.castVote(proposalId, false, 10);

        vm.warp(block.timestamp + 3 days + 1);
        governance.finalizeProposal(proposalId);

        IQuadraticVoting.Proposal memory prop = governance.getProposal(proposalId);
        assertEq(uint8(prop.state), uint8(IQuadraticVoting.ProposalState.DEFEATED));

        // Escalate to governance
        attestor.escalateToGovernance(claimId, proposalId);

        // Resolve by governance — rejects the previously accepted claim
        attestor.resolveByGovernance(claimId);

        claim = attestor.getClaim(claimId);
        assertEq(uint8(claim.status), uint8(IContributionAttestor.ClaimStatus.Rejected));
        assertEq(uint8(claim.resolvedBy), uint8(IContributionAttestor.ResolutionSource.Legislative));
    }

    // ============ Full Lifecycle: Executive → Judicial → Legislative ============

    function test_fullLifecycle_allThreeBranches() public {
        // 1. Executive branch: submit and attest (but don't auto-accept)
        bytes32 claimId = _submitClaim();

        vm.prank(trustedUser);
        attestor.attest(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint8(claim.status), uint8(IContributionAttestor.ClaimStatus.Pending));

        // Founder contests → Contested
        vm.prank(founder1);
        attestor.contest(claimId, keccak256("needs review"));

        claim = attestor.getClaim(claimId);
        assertEq(uint8(claim.status), uint8(IContributionAttestor.ClaimStatus.Contested));

        // 2. Judicial branch: tribunal (GUILTY → rejected)
        bytes32 trialId = _runTrial(claimId, true);
        attestor.escalateToTribunal(claimId, trialId);
        attestor.resolveByTribunal(claimId);

        claim = attestor.getClaim(claimId);
        assertEq(uint8(claim.status), uint8(IContributionAttestor.ClaimStatus.Rejected));

        // 3. Legislative branch: governance overrides tribunal's rejection
        vm.prank(voter1);
        uint256 proposalId = governance.createProposal("Full lifecycle override", keccak256("ipfs-3"));

        vm.prank(voter1);
        governance.castVote(proposalId, true, 15);

        vm.warp(block.timestamp + 3 days + 1);
        governance.finalizeProposal(proposalId);

        attestor.escalateToGovernance(claimId, proposalId);
        attestor.resolveByGovernance(claimId);

        claim = attestor.getClaim(claimId);
        assertEq(uint8(claim.status), uint8(IContributionAttestor.ClaimStatus.Accepted));
        assertEq(uint8(claim.resolvedBy), uint8(IContributionAttestor.ResolutionSource.Legislative));
    }

    // ============ Trust Score Verification ============

    function test_trustScores_correctlyConfigured() public view {
        // Founder1 should have score=1e18, multiplier=30000
        (uint256 score, , uint256 multiplier, , ) = dag.getTrustScore(founder1);
        assertEq(score, 1e18, "Founder score should be 1e18");
        assertEq(multiplier, 30000, "Founder multiplier should be 3x (30000 BPS)");

        // trustedUser should have non-zero score (1 hop from founders)
        (uint256 tsScore, , uint256 tsMult, , ) = dag.getTrustScore(trustedUser);
        assertTrue(tsScore > 0, "Trusted user should have positive score");
        assertTrue(tsMult > 0, "Trusted user should have positive multiplier");
    }

    // ============ Claim Expiry ============

    function test_claimExpiry() public {
        bytes32 claimId = _submitClaim();

        // Advance past TTL (7 days)
        vm.warp(block.timestamp + 7 days + 1);

        // Anyone can trigger expiry check
        attestor.checkExpiry(claimId);

        IContributionAttestor.ContributionClaim memory claim = attestor.getClaim(claimId);
        assertEq(uint8(claim.status), uint8(IContributionAttestor.ClaimStatus.Expired));
    }

    // ============ System Wiring Verification ============

    function test_systemWiring() public view {
        // Verify all cross-contract connections
        assertEq(address(attestor.contributionDAG()), address(dag));
        assertEq(attestor.getAcceptanceThreshold(), 2e18);
    }
}
