// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/SoulboundIdentity.sol";
import "../../contracts/oracle/ReputationOracle.sol";
import "../../contracts/mechanism/ConvictionGovernance.sol";
import "../../contracts/mechanism/RetroactiveFunding.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Tokens ============

contract JULToken is ERC20 {
    constructor() ERC20("JUL Token", "JUL") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract FundToken is ERC20 {
    constructor() ERC20("Fund Token", "FUND") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Governance Identity Pipeline Integration Test ============
// Flow: SoulboundIdentity -> ReputationOracle -> ConvictionGovernance / RetroactiveFunding

contract GovernanceIdentityPipelineTest is Test {
    SoulboundIdentity soulbound;
    ReputationOracle oracle;
    ConvictionGovernance conviction;
    RetroactiveFunding funding;
    JULToken julToken;
    FundToken fundToken;

    address owner = address(this);
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address charlie = makeAddr("charlie");
    address dave = makeAddr("dave");
    address resolver = makeAddr("resolver");

    function setUp() public {
        julToken = new JULToken();
        fundToken = new FundToken();

        // 1. Deploy SoulboundIdentity (UUPS proxy)
        SoulboundIdentity soulImpl = new SoulboundIdentity();
        ERC1967Proxy soulProxy = new ERC1967Proxy(
            address(soulImpl),
            abi.encodeCall(SoulboundIdentity.initialize, ())
        );
        soulbound = SoulboundIdentity(address(soulProxy));

        // 2. Deploy ReputationOracle (UUPS proxy)
        ReputationOracle oracleImpl = new ReputationOracle();
        ERC1967Proxy oracleProxy = new ERC1967Proxy(
            address(oracleImpl),
            abi.encodeCall(ReputationOracle.initialize, (owner))
        );
        oracle = ReputationOracle(payable(address(oracleProxy)));

        // 3. Deploy ConvictionGovernance
        conviction = new ConvictionGovernance(
            address(julToken),
            address(oracle),
            address(soulbound)
        );

        // 4. Deploy RetroactiveFunding
        funding = new RetroactiveFunding(
            address(oracle),
            address(soulbound)
        );

        // Wire up
        soulbound.setAuthorizedRecorder(owner, true);
        oracle.setAuthorizedGenerator(owner, true);
        oracle.setSoulboundIdentity(address(soulbound));
        conviction.addResolver(resolver);

        // Lower base threshold for faster test convergence
        conviction.setBaseThreshold(100 ether);

        // Mint identities for all actors
        vm.prank(alice);
        soulbound.mintIdentity("alice_gov");
        vm.prank(bob);
        soulbound.mintIdentity("bob_gov");
        vm.prank(charlie);
        soulbound.mintIdentity("charlie_gov");
        vm.prank(dave);
        soulbound.mintIdentity("dave_gov");

        // Fund actors with JUL tokens
        julToken.mint(alice, 10_000 ether);
        julToken.mint(bob, 10_000 ether);
        julToken.mint(charlie, 5_000 ether);

        // Fund actors with funding tokens for RetroactiveFunding contributions
        fundToken.mint(alice, 5_000 ether);
        fundToken.mint(bob, 5_000 ether);
        fundToken.mint(charlie, 5_000 ether);
        fundToken.mint(dave, 5_000 ether);

        // Fund owner with funding tokens for match pool
        fundToken.mint(owner, 50_000 ether);

        // Fund actors with ETH for oracle vote deposits
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(charlie, 10 ether);
        vm.deal(dave, 10 ether);
    }

    // ============ E2E: Full conviction governance pipeline ============
    function test_fullConvictionPipeline() public {
        // Step 1: Alice creates a proposal (has identity + default tier 2 >= minProposerTier 1)
        vm.prank(alice);
        uint256 proposalId = conviction.createProposal(
            "Fund VibeSwap security audit",
            keccak256("ipfs://audit-proposal"),
            50 ether
        );
        assertGt(proposalId, 0, "Proposal should be created");

        // Step 2: Alice and Bob signal conviction with JUL tokens
        vm.prank(alice);
        julToken.approve(address(conviction), 500 ether);
        vm.prank(alice);
        conviction.signalConviction(proposalId, 500 ether);

        vm.prank(bob);
        julToken.approve(address(conviction), 300 ether);
        vm.prank(bob);
        conviction.signalConviction(proposalId, 300 ether);

        // Step 3: Time passes to accumulate conviction
        // conviction = totalStake * elapsed = 800 * elapsed
        // threshold = 100 + (50 * 100) / 10000 = 100.5 ether
        // Need elapsed = 100.5 / 800 ≈ 0.126 seconds -> 1 second is enough
        vm.warp(block.timestamp + 2);

        // Step 4: Check conviction exceeds threshold
        uint256 currentConviction = conviction.getConviction(proposalId);
        uint256 threshold = conviction.getThreshold(proposalId);
        assertGt(currentConviction, threshold, "Conviction should exceed threshold");

        // Step 5: Trigger pass
        conviction.triggerPass(proposalId);

        IConvictionGovernance.GovernanceProposal memory prop = conviction.getProposal(proposalId);
        assertEq(
            uint256(prop.state),
            uint256(IConvictionGovernance.GovernanceProposalState.PASSED),
            "Proposal should be PASSED"
        );

        // Step 6: Resolver executes proposal
        vm.prank(resolver);
        conviction.executeProposal(proposalId);

        prop = conviction.getProposal(proposalId);
        assertEq(
            uint256(prop.state),
            uint256(IConvictionGovernance.GovernanceProposalState.EXECUTED),
            "Proposal should be EXECUTED"
        );

        // Step 7: Stakers can remove signals after execution
        vm.prank(alice);
        conviction.removeSignal(proposalId);
        assertEq(julToken.balanceOf(alice), 10_000 ether, "Alice should get JUL back");

        vm.prank(bob);
        conviction.removeSignal(proposalId);
        assertEq(julToken.balanceOf(bob), 10_000 ether, "Bob should get JUL back");
    }

    // ============ E2E: Full retroactive funding round ============
    function test_fullRetroactiveFundingRound() public {
        uint256 matchPool = 10_000 ether;

        // Owner approves match pool tokens
        fundToken.approve(address(funding), matchPool);

        // Step 1: Create funding round
        uint64 nominationEnd = uint64(block.timestamp + 1 days);
        uint64 evaluationEnd = uint64(block.timestamp + 3 days);

        uint256 roundId = funding.createRound(
            address(fundToken),
            matchPool,
            nominationEnd,
            evaluationEnd
        );
        assertGt(roundId, 0, "Round should be created");

        // Step 2: Alice and Bob nominate projects (need identity + reputation tier >= 1)
        vm.prank(alice);
        uint256 project1 = funding.nominateProject(
            roundId,
            alice,
            keccak256("ipfs://project-alpha")
        );

        vm.prank(bob);
        uint256 project2 = funding.nominateProject(
            roundId,
            bob,
            keccak256("ipfs://project-beta")
        );

        // Step 3: Advance to evaluation phase
        vm.warp(nominationEnd + 1);

        // Step 4: Contributors contribute (need identity)
        // Project 1 gets 3 small contributions (quadratic advantage)
        vm.prank(alice);
        fundToken.approve(address(funding), 100 ether);
        vm.prank(alice);
        funding.contribute(roundId, project1, 100 ether);

        vm.prank(bob);
        fundToken.approve(address(funding), 50 ether);
        vm.prank(bob);
        funding.contribute(roundId, project1, 50 ether);

        vm.prank(charlie);
        fundToken.approve(address(funding), 50 ether);
        vm.prank(charlie);
        funding.contribute(roundId, project1, 50 ether);

        // Project 2 gets 1 large contribution (same total but fewer contributors)
        vm.prank(alice);
        fundToken.approve(address(funding), 200 ether);
        vm.prank(alice);
        funding.contribute(roundId, project2, 200 ether);

        // Step 5: Finalize after evaluation period
        vm.warp(evaluationEnd + 1);
        funding.finalizeRound(roundId);

        // Step 6: Check quadratic matching — project1 should get more match
        IRetroactiveFunding.Project memory p1 = funding.getProject(roundId, project1);
        IRetroactiveFunding.Project memory p2 = funding.getProject(roundId, project2);

        // Project 1 has 3 contributors (broader community support)
        // Project 2 has 1 contributor (concentrated)
        // Quadratic matching should favor project 1
        assertGt(p1.matchedAmount, p2.matchedAmount, "Quadratic matching should favor more contributors");

        // Step 7: Beneficiaries claim funds
        vm.prank(alice);
        funding.claimFunds(roundId, project1);

        vm.prank(bob);
        funding.claimFunds(roundId, project2);

        // Both should have received their matched + community contributions
        assertGt(fundToken.balanceOf(alice), 5_000 ether, "Alice should receive funding");
    }

    // ============ E2E: Identity required for governance proposal ============
    function test_identityRequired_forProposal() public {
        address noIdentity = makeAddr("noIdentity");

        vm.prank(noIdentity);
        vm.expectRevert();
        conviction.createProposal("test", keccak256("test"), 10 ether);
    }

    // ============ E2E: Identity required for funding nomination ============
    function test_identityRequired_forNomination() public {
        fundToken.approve(address(funding), 1000 ether);
        uint256 roundId = funding.createRound(
            address(fundToken),
            1000 ether,
            uint64(block.timestamp + 1 days),
            uint64(block.timestamp + 3 days)
        );

        address noIdentity = makeAddr("noIdentity");
        vm.prank(noIdentity);
        vm.expectRevert();
        funding.nominateProject(roundId, noIdentity, keccak256("test"));
    }

    // ============ E2E: Identity required for signaling conviction ============
    function test_identityRequired_forSignal() public {
        vm.prank(alice);
        uint256 proposalId = conviction.createProposal("test", keccak256("t"), 10 ether);

        address noIdentity = makeAddr("noIdentity");
        julToken.mint(noIdentity, 100 ether);

        vm.prank(noIdentity);
        julToken.approve(address(conviction), 100 ether);

        vm.prank(noIdentity);
        vm.expectRevert();
        conviction.signalConviction(proposalId, 100 ether);
    }

    // ============ E2E: Reputation tier gates proposal creation ============
    function test_reputationTier_gatesProposal() public {
        // Set high tier requirement
        conviction.setMinProposerTier(4); // tier 4 requires score >= 8000

        // Default score is 5000 (tier 2), should be rejected
        vm.prank(alice);
        vm.expectRevert();
        conviction.createProposal("high tier test", keccak256("ht"), 10 ether);
    }

    // ============ E2E: ReputationOracle comparison flow ============
    function test_reputationOracle_comparisonFlow() public {
        // Step 1: Create a comparison between alice and bob
        bytes32 compId = oracle.createComparison(alice, bob);
        assertNotEq(compId, bytes32(0), "Comparison should be created");

        // Step 2: Charlie and Dave commit votes
        bytes32 charlieSecret = keccak256("charlie-secret");
        bytes32 daveSecret = keccak256("dave-secret");

        // Charlie votes for alice (choice=1)
        bytes32 charlieCommit = keccak256(abi.encodePacked(uint8(1), charlieSecret));
        vm.prank(charlie);
        oracle.commitVote{value: 0.001 ether}(compId, charlieCommit);

        // Dave votes for alice (choice=1)
        bytes32 daveCommit = keccak256(abi.encodePacked(uint8(1), daveSecret));
        vm.prank(dave);
        oracle.commitVote{value: 0.001 ether}(compId, daveCommit);

        // Step 3: Wait for commit phase to end, enter reveal phase
        vm.warp(block.timestamp + 301); // 5 min commit + 1 sec

        // Step 4: Reveal votes
        vm.prank(charlie);
        oracle.revealVote(compId, 1, charlieSecret);

        vm.prank(dave);
        oracle.revealVote(compId, 1, daveSecret);

        // Step 5: Wait for reveal phase to end
        vm.warp(block.timestamp + 121); // 2 min reveal + 1 sec

        // Step 6: Settle comparison
        oracle.settleComparison(compId);

        // Step 7: Alice should have gained trust (won the comparison)
        ReputationOracle.TrustProfile memory aliceProfile = oracle.getTrustProfile(alice);
        assertGt(aliceProfile.score, 5000, "Alice's trust score should increase after winning");
        assertEq(aliceProfile.wins, 1, "Alice should have 1 win");

        // Bob should have lost trust
        ReputationOracle.TrustProfile memory bobProfile = oracle.getTrustProfile(bob);
        assertLt(bobProfile.score, 5000, "Bob's trust score should decrease after losing");
        assertEq(bobProfile.losses, 1, "Bob should have 1 loss");
    }

    // ============ E2E: Conviction decay when signal removed ============
    function test_convictionDecay_onRemoveSignal() public {
        vm.prank(alice);
        uint256 proposalId = conviction.createProposal("test", keccak256("t"), 10 ether);

        // Alice and Bob signal
        vm.prank(alice);
        julToken.approve(address(conviction), 500 ether);
        vm.prank(alice);
        conviction.signalConviction(proposalId, 500 ether);

        vm.prank(bob);
        julToken.approve(address(conviction), 300 ether);
        vm.prank(bob);
        conviction.signalConviction(proposalId, 300 ether);

        vm.warp(block.timestamp + 5);

        uint256 convictionBefore = conviction.getConviction(proposalId);
        assertGt(convictionBefore, 0, "Should have conviction");

        // Bob removes signal
        vm.prank(bob);
        conviction.removeSignal(proposalId);

        // Conviction should be lower (only alice's stake remains)
        uint256 convictionAfter = conviction.getConviction(proposalId);
        assertLt(convictionAfter, convictionBefore, "Conviction should decrease after removal");
    }

    // ============ E2E: Proposal expiry after max duration ============
    function test_proposalExpiry() public {
        vm.prank(alice);
        uint256 proposalId = conviction.createProposal("expire test", keccak256("e"), 10 ether);

        IConvictionGovernance.GovernanceProposal memory prop = conviction.getProposal(proposalId);
        assertEq(
            uint256(prop.state),
            uint256(IConvictionGovernance.GovernanceProposalState.ACTIVE)
        );

        // Warp past max duration (default 30 days)
        vm.warp(block.timestamp + 31 days);

        conviction.expireProposal(proposalId);

        prop = conviction.getProposal(proposalId);
        assertEq(
            uint256(prop.state),
            uint256(IConvictionGovernance.GovernanceProposalState.EXPIRED),
            "Proposal should be EXPIRED"
        );
    }

    // ============ E2E: Quadratic matching math verification ============
    function test_quadraticMatching_favorsDistribution() public {
        uint256 matchPool = 1000 ether;
        fundToken.approve(address(funding), matchPool);

        uint256 roundId = funding.createRound(
            address(fundToken),
            matchPool,
            uint64(block.timestamp + 1 days),
            uint64(block.timestamp + 3 days)
        );

        // Nominate two projects
        vm.prank(alice);
        uint256 p1 = funding.nominateProject(roundId, alice, keccak256("p1"));
        vm.prank(bob);
        uint256 p2 = funding.nominateProject(roundId, bob, keccak256("p2"));

        vm.warp(block.timestamp + 1 days + 1);

        // Project 1: many small contributions from 3 people
        // sqrt(10) + sqrt(10) + sqrt(10) = 3*sqrt(10) ≈ 9.49
        // sqrtSum^2 ≈ 90
        vm.prank(alice);
        fundToken.approve(address(funding), 10 ether);
        vm.prank(alice);
        funding.contribute(roundId, p1, 10 ether);

        vm.prank(bob);
        fundToken.approve(address(funding), 10 ether);
        vm.prank(bob);
        funding.contribute(roundId, p1, 10 ether);

        vm.prank(charlie);
        fundToken.approve(address(funding), 10 ether);
        vm.prank(charlie);
        funding.contribute(roundId, p1, 10 ether);

        // Project 2: one large contribution
        // sqrt(30) ≈ 5.48
        // sqrtSum^2 ≈ 30
        vm.prank(dave);
        fundToken.approve(address(funding), 30 ether);
        vm.prank(dave);
        funding.contribute(roundId, p2, 30 ether);

        vm.warp(block.timestamp + 2 days + 1);
        funding.finalizeRound(roundId);

        IRetroactiveFunding.Project memory proj1 = funding.getProject(roundId, p1);
        IRetroactiveFunding.Project memory proj2 = funding.getProject(roundId, p2);

        // Same total contributions (30 each), but project 1 should get ~3x the match
        // because quadratic formula: matchPool * sqrtSum^2 / totalQScore
        // p1: 90 / (90 + 30) = 75% of match pool
        // p2: 30 / (90 + 30) = 25% of match pool
        assertGt(proj1.matchedAmount, proj2.matchedAmount, "Quadratic: distributed > concentrated");
        assertGt(proj1.matchedAmount, (matchPool * 60) / 100, "P1 should get >60% of match");
        assertLt(proj2.matchedAmount, (matchPool * 40) / 100, "P2 should get <40% of match");
    }

    // ============ E2E: Full lifecycle — reputation -> governance -> funding ============
    function test_fullLifecycle_reputationToGovernance() public {
        // Phase 1: Build reputation through oracle comparisons
        // Run two comparisons where alice wins both
        for (uint256 i = 0; i < 2; i++) {
            address opponent = i == 0 ? bob : charlie;
            bytes32 compId = oracle.createComparison(alice, opponent);

            bytes32 voterSecret = keccak256(abi.encodePacked("voter-secret", i));
            bytes32 voterCommit = keccak256(abi.encodePacked(uint8(1), voterSecret));

            // Dave votes for alice
            vm.prank(dave);
            oracle.commitVote{value: 0.001 ether}(compId, voterCommit);

            vm.warp(block.timestamp + 301);

            vm.prank(dave);
            oracle.revealVote(compId, 1, voterSecret);

            vm.warp(block.timestamp + 121);
            oracle.settleComparison(compId);
        }

        // Alice should have higher reputation now
        ReputationOracle.TrustProfile memory aliceProfile = oracle.getTrustProfile(alice);
        assertGt(aliceProfile.score, 5000, "Alice should have elevated trust");
        assertEq(aliceProfile.wins, 2, "Alice should have 2 wins");

        // Phase 2: Alice creates conviction governance proposal
        vm.prank(alice);
        uint256 proposalId = conviction.createProposal(
            "Fund community audit based on reputation",
            keccak256("reputation-backed-proposal"),
            20 ether
        );

        // Phase 3: Bob signals conviction
        vm.prank(bob);
        julToken.approve(address(conviction), 1000 ether);
        vm.prank(bob);
        conviction.signalConviction(proposalId, 1000 ether);

        vm.warp(block.timestamp + 2);

        // Phase 4: Trigger pass
        conviction.triggerPass(proposalId);

        IConvictionGovernance.GovernanceProposal memory prop = conviction.getProposal(proposalId);
        assertEq(
            uint256(prop.state),
            uint256(IConvictionGovernance.GovernanceProposalState.PASSED)
        );

        // Phase 5: Create retroactive funding round for same purpose
        fundToken.approve(address(funding), 5000 ether);
        uint256 roundId = funding.createRound(
            address(fundToken),
            5000 ether,
            uint64(block.timestamp + 1 days),
            uint64(block.timestamp + 3 days)
        );

        // Alice (high reputation) nominates
        vm.prank(alice);
        uint256 projectId = funding.nominateProject(roundId, alice, keccak256("audit-project"));

        vm.warp(block.timestamp + 1 days + 1);

        // Multiple contributors
        vm.prank(bob);
        fundToken.approve(address(funding), 100 ether);
        vm.prank(bob);
        funding.contribute(roundId, projectId, 100 ether);

        vm.prank(charlie);
        fundToken.approve(address(funding), 100 ether);
        vm.prank(charlie);
        funding.contribute(roundId, projectId, 100 ether);

        vm.warp(block.timestamp + 2 days + 1);
        funding.finalizeRound(roundId);

        // Alice claims
        vm.prank(alice);
        funding.claimFunds(roundId, projectId);

        // Alice should have received matched + contributions
        assertGt(fundToken.balanceOf(alice), 5_000 ether, "Alice should receive funding");
    }

    // Receive ETH for oracle refunds
    receive() external payable {}
}
