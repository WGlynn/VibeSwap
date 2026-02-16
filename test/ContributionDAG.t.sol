// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/identity/ContributionDAG.sol";

// ============ Mocks ============

/// @dev Mock SoulboundIdentity that tracks who has identity
contract MockSoulbound {
    mapping(address => bool) public _has;

    function setHasIdentity(address user, bool has_) external {
        _has[user] = has_;
    }

    function hasIdentity(address user) external view returns (bool) {
        return _has[user];
    }
}

// ============ Test Contract ============

contract ContributionDAGTest is Test {
    // Re-declare events for expectEmit (Solidity 0.8.20 doesn't support Interface.Event syntax)
    event FounderAdded(address indexed founder);
    event VouchAdded(address indexed from, address indexed to, bytes32 messageHash);
    event VouchRevoked(address indexed from, address indexed to);
    ContributionDAG public dag;
    MockSoulbound public soulbound;

    address public owner;
    address public alice;
    address public bob;
    address public carol;
    address public dave;
    address public eve;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        dave = makeAddr("dave");
        eve = makeAddr("eve");

        // Deploy without soulbound check (address(0) disables it)
        dag = new ContributionDAG(address(0));

        // Add alice as founder
        dag.addFounder(alice);
    }

    // ============ Helpers ============

    /// @dev Create a bidirectional handshake between two users
    function _handshake(address a, address b) internal {
        vm.prank(a);
        dag.addVouch(b, bytes32(0));
        vm.prank(b);
        dag.addVouch(a, bytes32(0));
    }

    // ============ Constructor Tests ============

    function test_constructor_setsOwner() public view {
        assertEq(dag.owner(), owner);
    }

    function test_constructor_soulboundZeroDisablesCheck() public view {
        assertEq(dag.soulboundIdentity(), address(0));
    }

    // ============ Founder Tests ============

    function test_addFounder_success() public {
        dag.addFounder(bob);
        assertTrue(dag.isFounder(bob));

        address[] memory founders = dag.getFounders();
        assertEq(founders.length, 2); // alice + bob
    }

    function test_addFounder_emitsEvent() public {
        vm.expectEmit(true, false, false, false);
        emit FounderAdded(bob);
        dag.addFounder(bob);
    }

    function test_addFounder_duplicate_reverts() public {
        vm.expectRevert(IContributionDAG.AlreadyFounder.selector);
        dag.addFounder(alice); // already added in setUp
    }

    function test_addFounder_onlyOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        dag.addFounder(bob);
    }

    function test_removeFounder_success() public {
        dag.removeFounder(alice);
        assertFalse(dag.isFounder(alice));
        assertEq(dag.getFounders().length, 0);
    }

    function test_removeFounder_notFounder_reverts() public {
        vm.expectRevert(IContributionDAG.NotFounder.selector);
        dag.removeFounder(bob);
    }

    function test_addFounder_maxFounders_reverts() public {
        // Add 19 more founders (alice is already 1)
        for (uint256 i = 1; i < 20; i++) {
            dag.addFounder(address(uint160(1000 + i)));
        }
        // 21st should revert
        vm.expectRevert(IContributionDAG.MaxFoundersReached.selector);
        dag.addFounder(address(uint160(9999)));
    }

    // ============ Vouch Tests ============

    function test_addVouch_success() public {
        vm.prank(alice);
        bool isHS = dag.addVouch(bob, bytes32("hello"));

        assertFalse(isHS); // bob hasn't vouched back
        assertTrue(dag.hasVouch(alice, bob));

        address[] memory from = dag.getVouchesFrom(alice);
        assertEq(from.length, 1);
        assertEq(from[0], bob);

        address[] memory forBob = dag.getVouchesFor(bob);
        assertEq(forBob.length, 1);
        assertEq(forBob[0], alice);
    }

    function test_addVouch_emitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit VouchAdded(alice, bob, bytes32("msg"));
        vm.prank(alice);
        dag.addVouch(bob, bytes32("msg"));
    }

    function test_addVouch_self_reverts() public {
        vm.prank(alice);
        vm.expectRevert(IContributionDAG.CannotVouchSelf.selector);
        dag.addVouch(alice, bytes32(0));
    }

    function test_addVouch_maxReached_reverts() public {
        // Alice vouches for 10 different users
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(alice);
            dag.addVouch(address(uint160(2000 + i)), bytes32(0));
        }
        // 11th vouch should fail
        vm.prank(alice);
        vm.expectRevert(IContributionDAG.MaxVouchesReached.selector);
        dag.addVouch(address(uint160(3000)), bytes32(0));
    }

    function test_addVouch_cooldown_reverts() public {
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));

        // Try re-vouching immediately
        vm.prank(alice);
        vm.expectRevert(); // VouchCooldown
        dag.addVouch(bob, bytes32("new"));
    }

    function test_addVouch_afterCooldown_success() public {
        vm.prank(alice);
        dag.addVouch(bob, bytes32("first"));

        // Warp past cooldown
        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(alice);
        dag.addVouch(bob, bytes32("second")); // should succeed (re-vouch)
    }

    // ============ Handshake Tests ============

    function test_handshake_createdOnBidirectionalVouch() public {
        vm.prank(alice);
        bool hs1 = dag.addVouch(bob, bytes32(0));
        assertFalse(hs1);

        vm.prank(bob);
        bool hs2 = dag.addVouch(alice, bytes32(0));
        assertTrue(hs2);

        assertTrue(dag.hasHandshake(alice, bob));
        assertTrue(dag.hasHandshake(bob, alice)); // symmetric
        assertEq(dag.getHandshakeCount(), 1);
    }

    function test_handshake_notCreatedForOneWay() public {
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));

        assertFalse(dag.hasHandshake(alice, bob));
        assertEq(dag.getHandshakeCount(), 0);
    }

    // ============ Revoke Tests ============

    function test_revokeVouch_success() public {
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));

        vm.prank(alice);
        dag.revokeVouch(bob);

        assertFalse(dag.hasVouch(alice, bob));
        assertEq(dag.getVouchesFrom(alice).length, 0);
        assertEq(dag.getVouchesFor(bob).length, 0);
    }

    function test_revokeVouch_emitsEvent() public {
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));

        vm.expectEmit(true, true, false, false);
        emit VouchRevoked(alice, bob);
        vm.prank(alice);
        dag.revokeVouch(bob);
    }

    function test_revokeVouch_noVouch_reverts() public {
        vm.prank(alice);
        vm.expectRevert(IContributionDAG.NoVouchExists.selector);
        dag.revokeVouch(bob);
    }

    function test_revokeVouch_removesHandshake() public {
        _handshake(alice, bob);
        assertEq(dag.getHandshakeCount(), 1);

        vm.prank(alice);
        dag.revokeVouch(bob);

        assertEq(dag.getHandshakeCount(), 0);
        assertFalse(dag.hasHandshake(alice, bob));
    }

    // ============ BFS Trust Score Tests ============

    function test_recalculate_founderGetsMaxScore() public {
        dag.recalculateTrustScores();

        (uint256 score, string memory level, uint256 multiplier, uint8 hops, address[] memory chain) =
            dag.getTrustScore(alice);

        assertEq(score, 1e18); // Full trust
        assertEq(keccak256(bytes(level)), keccak256(bytes("FOUNDER")));
        assertEq(multiplier, 30000); // 3.0x
        assertEq(hops, 0);
        assertEq(chain.length, 1);
        assertEq(chain[0], alice);
    }

    function test_recalculate_untrustedUserGetsZero() public {
        dag.recalculateTrustScores();

        (uint256 score, string memory level, uint256 multiplier, uint8 hops,) =
            dag.getTrustScore(bob);

        assertEq(score, 0);
        assertEq(keccak256(bytes(level)), keccak256(bytes("UNTRUSTED")));
        assertEq(multiplier, 5000); // 0.5x
        assertEq(hops, type(uint8).max);
    }

    function test_recalculate_oneHopFromFounder() public {
        // Handshake: alice <-> bob
        _handshake(alice, bob);
        dag.recalculateTrustScores();

        (uint256 score,, uint256 multiplier, uint8 hops, address[] memory chain) =
            dag.getTrustScore(bob);

        // 1 hop: score = (1 - 0.15)^1 = 0.85
        assertEq(score, 85e16);
        assertEq(multiplier, 20000); // TRUSTED (>= 0.7)
        assertEq(hops, 1);
        assertEq(chain.length, 2);
        assertEq(chain[0], alice);
        assertEq(chain[1], bob);
    }

    function test_recalculate_twoHopsFromFounder() public {
        // Chain: alice <-> bob <-> carol
        _handshake(alice, bob);
        _handshake(bob, carol);
        dag.recalculateTrustScores();

        (uint256 score,,, uint8 hops,) = dag.getTrustScore(carol);

        // 2 hops: score = (0.85)^2 = 0.7225
        assertEq(score, 7225e14);
        assertEq(hops, 2);
    }

    function test_recalculate_threeHopsDecaysBelow70() public {
        // Chain: alice <-> bob <-> carol <-> dave
        _handshake(alice, bob);
        _handshake(bob, carol);
        _handshake(carol, dave);
        dag.recalculateTrustScores();

        (uint256 score, string memory level, uint256 multiplier, uint8 hops,) =
            dag.getTrustScore(dave);

        // 3 hops: score = 0.85^3 = 0.614125
        assertEq(score, 614125e12);
        assertEq(hops, 3);
        assertEq(keccak256(bytes(level)), keccak256(bytes("PARTIAL_TRUST")));
        assertEq(multiplier, 15000);
    }

    function test_recalculate_oneWayVouchDoesNotPropagateTrust() public {
        // Alice vouches for bob, but bob doesn't vouch back (no handshake)
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));
        dag.recalculateTrustScores();

        (uint256 score,,,,) = dag.getTrustScore(bob);
        assertEq(score, 0); // No trust without handshake
    }

    function test_recalculate_maxHopsBoundary() public {
        // Build a chain of 7 handshakes (7 hops from founder — exceeds MAX_TRUST_HOPS=6)
        address prev = alice;
        address[] memory users = new address[](7);
        for (uint256 i = 0; i < 7; i++) {
            users[i] = address(uint160(5000 + i));
            _handshake(prev, users[i]);
            prev = users[i];
        }

        dag.recalculateTrustScores();

        // 6 hops should have a score
        (uint256 score6,,, uint8 hops6,) = dag.getTrustScore(users[5]);
        assertGt(score6, 0);
        assertEq(hops6, 6);

        // 7 hops should NOT have a score (exceeds MAX_TRUST_HOPS)
        (uint256 score7,,,,) = dag.getTrustScore(users[6]);
        assertEq(score7, 0);
    }

    // ============ Voting Power Multiplier Tests ============

    function test_getVotingPowerMultiplier_founder() public {
        dag.recalculateTrustScores();
        assertEq(dag.getVotingPowerMultiplier(alice), 30000);
    }

    function test_getVotingPowerMultiplier_untrusted() public {
        assertEq(dag.getVotingPowerMultiplier(bob), 5000);
    }

    function test_getVotingPowerMultiplier_trusted() public {
        _handshake(alice, bob);
        dag.recalculateTrustScores();
        // bob at 1 hop = 0.85 >= 0.7 → TRUSTED → 20000
        assertEq(dag.getVotingPowerMultiplier(bob), 20000);
    }

    // ============ Referral Quality Tests ============

    function test_referralQuality_noVouches() public view {
        (uint256 score, uint256 penalty) = dag.calculateReferralQuality(bob);
        assertEq(score, 1e18); // No vouches = no penalty
        assertEq(penalty, 0);
    }

    function test_referralQuality_withTrustedReferrals() public {
        // alice vouches for bob, bob is trusted (handshake + BFS)
        _handshake(alice, bob);
        dag.recalculateTrustScores();

        (uint256 score, uint256 penalty) = dag.calculateReferralQuality(alice);
        // bob has score 0.85 > 0.2, so no bad referrals
        assertEq(penalty, 0);
        assertEq(score, 1e18);
    }

    function test_referralQuality_withUntrustedReferrals() public {
        // alice vouches for bob (no handshake, bob untrusted → score 0)
        vm.prank(alice);
        dag.addVouch(bob, bytes32(0));
        dag.recalculateTrustScores();

        (uint256 score, uint256 penalty) = dag.calculateReferralQuality(alice);
        // bob has score 0 < 0.2, so 1/1 bad referrals → ratio=1.0 → penalty=0.5
        assertEq(penalty, 5e17);
        assertEq(score, 5e17);
    }

    // ============ Diversity Score Tests ============

    function test_diversityScore_noVouchers() public view {
        (uint256 score, uint256 penalty) = dag.calculateDiversityScore(bob);
        assertEq(score, 0);
        assertEq(penalty, 0);
    }

    function test_diversityScore_allMutual_highInsularity() public {
        // alice <-> bob (mutual vouch)
        _handshake(alice, bob);

        (uint256 score, uint256 penalty) = dag.calculateDiversityScore(bob);
        // Only 1 voucher (alice), and it's mutual → diversity=0, insularity=1.0
        // penalty = (1.0 - 0.8) * 2 = 0.4
        assertEq(penalty, 4e17);
        assertEq(score, 6e17);
    }

    function test_diversityScore_oneWayInward_noPenalty() public {
        // carol vouches for bob (one-way inward), bob doesn't vouch for carol
        vm.prank(carol);
        dag.addVouch(bob, bytes32(0));

        (uint256 score, uint256 penalty) = dag.calculateDiversityScore(bob);
        // 1 voucher, all inward → diversity = 1.0, insularity = 0 → no penalty
        assertEq(penalty, 0);
        assertEq(score, 1e18);
    }

    // ============ Soulbound Identity Check Tests ============

    function test_soulboundCheck_blocksWithoutIdentity() public {
        soulbound = new MockSoulbound();

        ContributionDAG dagWithSB = new ContributionDAG(address(soulbound));
        dagWithSB.addFounder(alice);

        // alice has no identity
        vm.prank(alice);
        vm.expectRevert(IContributionDAG.NoIdentity.selector);
        dagWithSB.addVouch(bob, bytes32(0));
    }

    function test_soulboundCheck_allowsWithIdentity() public {
        soulbound = new MockSoulbound();
        soulbound.setHasIdentity(alice, true);

        ContributionDAG dagWithSB = new ContributionDAG(address(soulbound));
        dagWithSB.addFounder(alice);

        vm.prank(alice);
        dagWithSB.addVouch(bob, bytes32(0)); // should succeed
        assertTrue(dagWithSB.hasVouch(alice, bob));
    }

    // ============ Admin Tests ============

    function test_setSoulboundIdentity_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        dag.setSoulboundIdentity(address(1));
    }

    function test_setSoulboundIdentity_success() public {
        dag.setSoulboundIdentity(address(42));
        assertEq(dag.soulboundIdentity(), address(42));
    }
}
