// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/oracle/ReputationOracle.sol";
import "../../contracts/identity/SoulboundIdentity.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract ReputationOracleTest is Test {
    ReputationOracle public oracle;
    SoulboundIdentity public identity;

    address public owner;
    address public generator;
    address public treasury;

    address public alice;
    address public bob;
    address public charlie;
    address public dave;
    address public eve;

    function setUp() public {
        owner = address(this);
        generator = makeAddr("generator");
        treasury = makeAddr("treasury");

        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");
        dave = makeAddr("dave");
        eve = makeAddr("eve");

        // Deploy SoulboundIdentity
        SoulboundIdentity idImpl = new SoulboundIdentity();
        bytes memory idInit = abi.encodeWithSelector(SoulboundIdentity.initialize.selector);
        ERC1967Proxy idProxy = new ERC1967Proxy(address(idImpl), idInit);
        identity = SoulboundIdentity(address(idProxy));

        // Deploy ReputationOracle
        ReputationOracle oracleImpl = new ReputationOracle();
        bytes memory oracleInit = abi.encodeWithSelector(
            ReputationOracle.initialize.selector, owner
        );
        ERC1967Proxy oracleProxy = new ERC1967Proxy(address(oracleImpl), oracleInit);
        oracle = ReputationOracle(payable(address(oracleProxy)));

        // Wire up
        oracle.setAuthorizedGenerator(generator, true);
        oracle.setSoulboundIdentity(address(identity));
        oracle.setTreasury(treasury);

        // Mint identities
        vm.prank(alice);
        identity.mintIdentity("alice");
        vm.prank(bob);
        identity.mintIdentity("bob");
        vm.prank(charlie);
        identity.mintIdentity("charlie");
        vm.prank(dave);
        identity.mintIdentity("dave");
        vm.prank(eve);
        identity.mintIdentity("eve");
    }

    // ============ Helpers ============

    function _createComparison(address a, address b) internal returns (bytes32) {
        vm.prank(generator);
        return oracle.createComparison(a, b);
    }

    function _commitVote(bytes32 compId, address voter, uint8 choice, bytes32 secret) internal {
        bytes32 commitment = keccak256(abi.encodePacked(choice, secret));
        vm.prank(voter);
        oracle.commitVote{value: 0.001 ether}(compId, commitment);
    }

    function _revealVote(bytes32 compId, address voter, uint8 choice, bytes32 secret) internal {
        vm.prank(voter);
        oracle.revealVote(compId, choice, secret);
    }

    function _fullVote(
        bytes32 compId,
        address voter,
        uint8 choice,
        bytes32 secret
    ) internal {
        _commitVote(compId, voter, choice, secret);
    }

    // ============ Comparison Creation ============

    function test_createComparison() public {
        bytes32 compId = _createComparison(alice, bob);

        ReputationOracle.Comparison memory comp = oracle.getComparison(compId);
        assertEq(comp.walletA, alice);
        assertEq(comp.walletB, bob);
        assertFalse(comp.settled);
        assertEq(comp.totalVotes, 0);
    }

    function test_createComparison_initsTrustProfiles() public {
        _createComparison(alice, bob);

        ReputationOracle.TrustProfile memory profileA = oracle.getTrustProfile(alice);
        ReputationOracle.TrustProfile memory profileB = oracle.getTrustProfile(bob);

        assertEq(profileA.score, 5000); // INITIAL_TRUST_SCORE
        assertEq(profileB.score, 5000);
        assertEq(profileA.tier, 2);
        assertEq(profileB.tier, 2);
    }

    function test_createComparison_unauthorized_reverts() public {
        vm.prank(alice);
        vm.expectRevert(ReputationOracle.Unauthorized.selector);
        oracle.createComparison(bob, charlie);
    }

    function test_createComparison_sameWallet_reverts() public {
        vm.prank(generator);
        vm.expectRevert(ReputationOracle.CannotVoteOnSelf.selector);
        oracle.createComparison(alice, alice);
    }

    // ============ Commit Phase ============

    function test_commitVote() public {
        bytes32 compId = _createComparison(alice, bob);
        vm.deal(charlie, 1 ether);

        bytes32 secret = keccak256("charlie_secret");
        _commitVote(compId, charlie, 1, secret);

        assertEq(oracle.getComparisonVoterCount(compId), 1);
    }

    function test_commitVote_noIdentity_reverts() public {
        bytes32 compId = _createComparison(alice, bob);
        address noId = makeAddr("noIdentity");
        vm.deal(noId, 1 ether);

        bytes32 commitment = keccak256(abi.encodePacked(uint8(1), bytes32("secret")));
        vm.prank(noId);
        vm.expectRevert(ReputationOracle.NoIdentity.selector);
        oracle.commitVote{value: 0.001 ether}(compId, commitment);
    }

    function test_commitVote_cannotVoteOnSelf() public {
        bytes32 compId = _createComparison(alice, bob);
        vm.deal(alice, 1 ether);

        bytes32 commitment = keccak256(abi.encodePacked(uint8(1), bytes32("secret")));
        vm.prank(alice);
        vm.expectRevert(ReputationOracle.CannotVoteOnSelf.selector);
        oracle.commitVote{value: 0.001 ether}(compId, commitment);
    }

    function test_commitVote_insufficientDeposit_reverts() public {
        bytes32 compId = _createComparison(alice, bob);
        vm.deal(charlie, 1 ether);

        bytes32 commitment = keccak256(abi.encodePacked(uint8(1), bytes32("secret")));
        vm.prank(charlie);
        vm.expectRevert(ReputationOracle.InsufficientDeposit.selector);
        oracle.commitVote{value: 0.0001 ether}(compId, commitment);
    }

    function test_commitVote_afterDeadline_reverts() public {
        bytes32 compId = _createComparison(alice, bob);
        vm.deal(charlie, 1 ether);

        // Warp past commit deadline
        vm.warp(block.timestamp + 301);

        bytes32 commitment = keccak256(abi.encodePacked(uint8(1), bytes32("secret")));
        vm.prank(charlie);
        vm.expectRevert(ReputationOracle.InvalidPhase.selector);
        oracle.commitVote{value: 0.001 ether}(compId, commitment);
    }

    function test_commitVote_duplicate_reverts() public {
        bytes32 compId = _createComparison(alice, bob);
        vm.deal(charlie, 1 ether);

        bytes32 secret = keccak256("charlie_secret");
        _commitVote(compId, charlie, 1, secret);

        bytes32 commitment2 = keccak256(abi.encodePacked(uint8(2), bytes32("other")));
        vm.prank(charlie);
        vm.expectRevert(ReputationOracle.AlreadyCommitted.selector);
        oracle.commitVote{value: 0.001 ether}(compId, commitment2);
    }

    // ============ Reveal Phase ============

    function test_revealVote() public {
        bytes32 compId = _createComparison(alice, bob);
        vm.deal(charlie, 1 ether);

        bytes32 secret = keccak256("charlie_secret");
        _commitVote(compId, charlie, 1, secret);

        // Warp to reveal phase
        vm.warp(block.timestamp + 301);

        _revealVote(compId, charlie, 1, secret);

        ReputationOracle.Comparison memory comp = oracle.getComparison(compId);
        assertEq(comp.votesForA, 1);
        assertEq(comp.totalVotes, 1);
    }

    function test_revealVote_invalidHash_reverts() public {
        bytes32 compId = _createComparison(alice, bob);
        vm.deal(charlie, 1 ether);

        bytes32 secret = keccak256("charlie_secret");
        _commitVote(compId, charlie, 1, secret);

        vm.warp(block.timestamp + 301);

        // Try to reveal with wrong choice
        vm.prank(charlie);
        vm.expectRevert(ReputationOracle.InvalidReveal.selector);
        oracle.revealVote(compId, 2, secret); // wrong choice!
    }

    function test_revealVote_duringCommitPhase_reverts() public {
        bytes32 compId = _createComparison(alice, bob);
        vm.deal(charlie, 1 ether);

        bytes32 secret = keccak256("charlie_secret");
        _commitVote(compId, charlie, 1, secret);

        // Still in commit phase
        vm.prank(charlie);
        vm.expectRevert(ReputationOracle.InvalidPhase.selector);
        oracle.revealVote(compId, 1, secret);
    }

    // ============ Settlement ============

    function test_settleComparison_AConsensus() public {
        bytes32 compId = _createComparison(alice, bob);
        vm.deal(charlie, 1 ether);
        vm.deal(dave, 1 ether);
        vm.deal(eve, 1 ether);

        bytes32 secretC = keccak256("c");
        bytes32 secretD = keccak256("d");
        bytes32 secretE = keccak256("e");

        // All three vote for A
        _commitVote(compId, charlie, 1, secretC);
        _commitVote(compId, dave, 1, secretD);
        _commitVote(compId, eve, 2, secretE); // Eve votes B

        // Reveal phase
        vm.warp(block.timestamp + 301);
        _revealVote(compId, charlie, 1, secretC);
        _revealVote(compId, dave, 1, secretD);
        _revealVote(compId, eve, 2, secretE);

        // Settle
        vm.warp(block.timestamp + 121);
        oracle.settleComparison(compId);

        ReputationOracle.Comparison memory comp = oracle.getComparison(compId);
        assertTrue(comp.settled);
        assertEq(comp.votesForA, 2);
        assertEq(comp.votesForB, 1);

        // Alice (walletA) should have gained trust
        ReputationOracle.TrustProfile memory profileA = oracle.getTrustProfile(alice);
        assertGt(profileA.score, 5000); // Above initial
        assertEq(profileA.wins, 1);

        // Bob (walletB) should have lost trust
        ReputationOracle.TrustProfile memory profileB = oracle.getTrustProfile(bob);
        assertLt(profileB.score, 5000); // Below initial
        assertEq(profileB.losses, 1);
    }

    function test_settleComparison_equivalent() public {
        bytes32 compId = _createComparison(alice, bob);
        vm.deal(charlie, 1 ether);
        vm.deal(dave, 1 ether);

        bytes32 secretC = keccak256("c");
        bytes32 secretD = keccak256("d");

        // Tie: one for A, one for B → equivalent
        _commitVote(compId, charlie, 1, secretC);
        _commitVote(compId, dave, 2, secretD);

        vm.warp(block.timestamp + 301);
        _revealVote(compId, charlie, 1, secretC);
        _revealVote(compId, dave, 2, secretD);

        vm.warp(block.timestamp + 121);
        oracle.settleComparison(compId);

        // Equivalent → scores unchanged
        ReputationOracle.TrustProfile memory profileA = oracle.getTrustProfile(alice);
        ReputationOracle.TrustProfile memory profileB = oracle.getTrustProfile(bob);
        assertEq(profileA.score, 5000);
        assertEq(profileB.score, 5000);
        assertEq(profileA.equivalences, 1);
        assertEq(profileB.equivalences, 1);
    }

    function test_settleComparison_slashesNonRevealers() public {
        bytes32 compId = _createComparison(alice, bob);
        vm.deal(charlie, 1 ether);
        vm.deal(dave, 1 ether);

        bytes32 secretC = keccak256("c");
        bytes32 secretD = keccak256("d");

        _commitVote(compId, charlie, 1, secretC);
        _commitVote(compId, dave, 1, secretD);

        // Only charlie reveals
        vm.warp(block.timestamp + 301);
        _revealVote(compId, charlie, 1, secretC);
        // dave doesn't reveal

        uint256 treasuryBefore = treasury.balance;

        vm.warp(block.timestamp + 121);
        oracle.settleComparison(compId);

        // Treasury should have received dave's slashed deposit
        uint256 expectedSlash = (0.001 ether * 5000) / 10000; // 50% of deposit
        assertEq(treasury.balance - treasuryBefore, expectedSlash);
    }

    function test_settleComparison_refundsHonestVoters() public {
        bytes32 compId = _createComparison(alice, bob);
        vm.deal(charlie, 1 ether);

        bytes32 secretC = keccak256("c");
        _commitVote(compId, charlie, 1, secretC);

        uint256 charlieBalBefore = charlie.balance;

        vm.warp(block.timestamp + 301);
        _revealVote(compId, charlie, 1, secretC);

        vm.warp(block.timestamp + 121);
        oracle.settleComparison(compId);

        // Charlie should get deposit back
        assertEq(charlie.balance, charlieBalBefore + 0.001 ether);
    }

    function test_settleComparison_alreadySettled_reverts() public {
        bytes32 compId = _createComparison(alice, bob);
        vm.deal(charlie, 1 ether);

        bytes32 secretC = keccak256("c");
        _commitVote(compId, charlie, 1, secretC);

        vm.warp(block.timestamp + 301);
        _revealVote(compId, charlie, 1, secretC);

        vm.warp(block.timestamp + 121);
        oracle.settleComparison(compId);

        vm.expectRevert(ReputationOracle.AlreadySettled.selector);
        oracle.settleComparison(compId);
    }

    // ============ Tier System ============

    function test_tierPromotion() public {
        // Alice wins many comparisons → score rises → tier increases
        for (uint256 i = 0; i < 10; i++) {
            address opponent = makeAddr(string(abi.encodePacked("opp", i)));
            vm.prank(opponent);
            identity.mintIdentity(string(abi.encodePacked("opponent", vm.toString(i))));

            bytes32 compId = _createComparison(alice, opponent);
            vm.deal(charlie, 1 ether);

            bytes32 secret = keccak256(abi.encodePacked("s", i));
            _commitVote(compId, charlie, 1, secret); // Vote for Alice

            vm.warp(block.timestamp + 301);
            _revealVote(compId, charlie, 1, secret);

            vm.warp(block.timestamp + 121);
            oracle.settleComparison(compId);
        }

        ReputationOracle.TrustProfile memory profile = oracle.getTrustProfile(alice);
        // 10 wins × 200 = 2000 points above initial 5000 = 7000
        assertEq(profile.score, 7000);
        assertEq(profile.tier, 3); // 7000 >= TIER_3_THRESHOLD (6000)
        assertEq(profile.wins, 10);
    }

    function test_tierDemotion() public {
        // Bob loses many comparisons → score drops → tier decreases
        for (uint256 i = 0; i < 15; i++) {
            address opponent = makeAddr(string(abi.encodePacked("opp", i)));
            vm.prank(opponent);
            identity.mintIdentity(string(abi.encodePacked("opponent", vm.toString(i))));

            bytes32 compId = _createComparison(opponent, bob); // bob is walletB
            vm.deal(charlie, 1 ether);

            bytes32 secret = keccak256(abi.encodePacked("s", i));
            _commitVote(compId, charlie, 1, secret); // Vote for opponent (A)

            vm.warp(block.timestamp + 301);
            _revealVote(compId, charlie, 1, secret);

            vm.warp(block.timestamp + 121);
            oracle.settleComparison(compId);
        }

        ReputationOracle.TrustProfile memory profile = oracle.getTrustProfile(bob);
        // 15 losses × 100 = 1500 below initial 5000 = 3500
        assertEq(profile.score, 3500);
        assertEq(profile.tier, 1); // 3500 >= TIER_1_THRESHOLD (2000) but < TIER_2 (4000)
    }

    // ============ IReputationOracle Interface ============

    function test_getTrustScore_default() public {
        // Unregistered user gets initial score
        address nobody = makeAddr("nobody");
        assertEq(oracle.getTrustScore(nobody), 5000);
    }

    function test_getTrustTier_default() public {
        address nobody = makeAddr("nobody");
        assertEq(oracle.getTrustTier(nobody), 2);
    }

    function test_isEligible() public {
        // Default tier 2 user
        assertTrue(oracle.isEligible(alice, 0));
        assertTrue(oracle.isEligible(alice, 1));
        assertTrue(oracle.isEligible(alice, 2));
        assertFalse(oracle.isEligible(alice, 3));
        assertFalse(oracle.isEligible(alice, 4));
    }

    // ============ Decay ============

    function test_decay_meanReversion() public {
        // Give alice a high score
        bytes32 compId = _createComparison(alice, bob);
        vm.deal(charlie, 1 ether);
        bytes32 secret = keccak256("s");
        _commitVote(compId, charlie, 1, secret);
        vm.warp(block.timestamp + 301);
        _revealVote(compId, charlie, 1, secret);
        vm.warp(block.timestamp + 121);
        oracle.settleComparison(compId);

        uint256 scoreAfterWin = oracle.getTrustProfile(alice).score;
        assertEq(scoreAfterWin, 5200); // 5000 + 200

        // Warp 6 months (6 decay periods)
        vm.warp(block.timestamp + 180 days);

        // Trigger decay via new comparison
        bytes32 compId2 = _createComparison(alice, bob);
        vm.deal(dave, 1 ether);
        bytes32 secret2 = keccak256("s2");
        _commitVote(compId2, dave, 3, secret2); // equivalent
        vm.warp(block.timestamp + 301);
        _revealVote(compId2, dave, 3, secret2);
        vm.warp(block.timestamp + 121);
        oracle.settleComparison(compId2);

        // Score should have decayed toward 5000
        uint256 decayedScore = oracle.getTrustProfile(alice).score;
        assertLt(decayedScore, scoreAfterWin);
        assertGt(decayedScore, 5000); // Still above mean since started above
    }

    // ============ Phase Checks ============

    function test_inCommitPhase() public {
        bytes32 compId = _createComparison(alice, bob);
        assertTrue(oracle.inCommitPhase(compId));
        assertFalse(oracle.inRevealPhase(compId));

        vm.warp(block.timestamp + 301);
        assertFalse(oracle.inCommitPhase(compId));
        assertTrue(oracle.inRevealPhase(compId));
    }

    // ============ Round Management ============

    function test_advanceRound() public {
        assertEq(oracle.currentRound(), 1);
        vm.prank(generator);
        oracle.advanceRound();
        assertEq(oracle.currentRound(), 2);
    }

    function test_roundComparisons_tracked() public {
        bytes32 compId1 = _createComparison(alice, bob);
        bytes32 compId2 = _createComparison(charlie, dave);

        bytes32[] memory comps = oracle.getRoundComparisons(1);
        assertEq(comps.length, 2);
        assertEq(comps[0], compId1);
        assertEq(comps[1], compId2);
    }

    // ============ No Identity Mode ============

    function test_noSoulboundRequirement_whenDisabled() public {
        // Disable soulbound requirement
        oracle.setSoulboundIdentity(address(0));

        bytes32 compId = _createComparison(alice, bob);

        // User without identity can vote
        address noId = makeAddr("noIdentity");
        vm.deal(noId, 1 ether);

        bytes32 secret = keccak256("s");
        bytes32 commitment = keccak256(abi.encodePacked(uint8(1), secret));
        vm.prank(noId);
        oracle.commitVote{value: 0.001 ether}(compId, commitment);

        assertEq(oracle.getComparisonVoterCount(compId), 1);
    }

    // ============ Fuzz ============

    function testFuzz_commitRevealIntegrity(uint8 choice, bytes32 secret) public {
        choice = uint8(bound(choice, 1, 3));

        bytes32 compId = _createComparison(alice, bob);
        vm.deal(charlie, 1 ether);

        bytes32 commitment = keccak256(abi.encodePacked(choice, secret));
        vm.prank(charlie);
        oracle.commitVote{value: 0.001 ether}(compId, commitment);

        vm.warp(block.timestamp + 301);

        vm.prank(charlie);
        oracle.revealVote(compId, choice, secret);

        ReputationOracle.Comparison memory comp = oracle.getComparison(compId);
        assertEq(comp.totalVotes, 1);

        if (choice == 1) assertEq(comp.votesForA, 1);
        if (choice == 2) assertEq(comp.votesForB, 1);
        if (choice == 3) assertEq(comp.votesEquivalent, 1);
    }
}
