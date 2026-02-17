// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/identity/ContributionDAG.sol";

// ============ Fuzz Tests ============

contract ContributionDAGFuzzTest is Test {
    ContributionDAG public dag;

    address public owner;
    address public alice;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");

        dag = new ContributionDAG(address(0)); // no soulbound check
        dag.addFounder(alice);
    }

    // ============ Helpers ============

    function _handshake(address a, address b) internal {
        vm.prank(a);
        dag.addVouch(b, bytes32(0));
        vm.prank(b);
        dag.addVouch(a, bytes32(0));
    }

    function _makeUser(uint256 seed) internal pure returns (address) {
        return address(uint160(bound(seed, 100, type(uint160).max)));
    }

    // ============ Fuzz: trust score always bounded [0, 1e18] ============

    function testFuzz_trustScoreBounded(uint256 numHops) public {
        numHops = bound(numHops, 1, 6);

        address prev = alice;
        for (uint256 i = 0; i < numHops; i++) {
            address user = address(uint160(5000 + i));
            _handshake(prev, user);
            prev = user;
        }

        dag.recalculateTrustScores();

        (uint256 score,,,,) = dag.getTrustScore(prev);
        assertLe(score, 1e18, "Score must be <= 1e18");
    }

    // ============ Fuzz: trust decay is monotonically decreasing with hops ============

    function testFuzz_trustDecayMonotonic(uint256 numHops) public {
        numHops = bound(numHops, 2, 6);

        address[] memory users = new address[](numHops);
        address prev = alice;
        for (uint256 i = 0; i < numHops; i++) {
            users[i] = address(uint160(5000 + i));
            _handshake(prev, users[i]);
            prev = users[i];
        }

        dag.recalculateTrustScores();

        uint256 prevScore = 1e18; // founder score
        for (uint256 i = 0; i < numHops; i++) {
            (uint256 score,,,,) = dag.getTrustScore(users[i]);
            assertLt(score, prevScore, "Score must decrease with each hop");
            prevScore = score;
        }
    }

    // ============ Fuzz: trust score = (0.85)^hops exactly ============

    function testFuzz_trustScoreMatchesFormula(uint256 numHops) public {
        numHops = bound(numHops, 1, 6);

        address prev = alice;
        address target;
        for (uint256 i = 0; i < numHops; i++) {
            target = address(uint160(5000 + i));
            _handshake(prev, target);
            prev = target;
        }

        dag.recalculateTrustScores();

        // Expected: (8500/10000)^numHops * 1e18
        uint256 expected = 1e18;
        for (uint256 i = 0; i < numHops; i++) {
            expected = (expected * 8500) / 10000;
        }

        (uint256 score,,,,) = dag.getTrustScore(target);
        assertEq(score, expected, "Score must match decay formula");
    }

    // ============ Fuzz: multiplier consistent with score thresholds ============

    function testFuzz_multiplierConsistentWithScore(uint256 numHops) public {
        numHops = bound(numHops, 1, 6);

        address prev = alice;
        address target;
        for (uint256 i = 0; i < numHops; i++) {
            target = address(uint160(5000 + i));
            _handshake(prev, target);
            prev = target;
        }

        dag.recalculateTrustScores();

        (uint256 score,, uint256 multiplier,,) = dag.getTrustScore(target);
        uint256 votingMultiplier = dag.getVotingPowerMultiplier(target);
        assertEq(multiplier, votingMultiplier, "getTrustScore and getVotingPowerMultiplier must agree");

        if (score >= 7e17) {
            assertEq(multiplier, 20000, "TRUSTED: multiplier must be 20000");
        } else if (score >= 3e17) {
            assertEq(multiplier, 15000, "PARTIAL: multiplier must be 15000");
        } else if (score > 0) {
            assertEq(multiplier, 10000, "LOW_TRUST: multiplier must be 10000");
        }
    }

    // ============ Fuzz: vouch limit enforced for any number of vouches ============

    function testFuzz_vouchLimitEnforced(uint256 numVouches) public {
        numVouches = bound(numVouches, 1, 15);

        for (uint256 i = 0; i < numVouches; i++) {
            address target = address(uint160(2000 + i));
            if (i < 10) {
                vm.prank(alice);
                dag.addVouch(target, bytes32(0));
            } else {
                vm.prank(alice);
                vm.expectRevert(IContributionDAG.MaxVouchesReached.selector);
                dag.addVouch(target, bytes32(0));
            }
        }

        assertLe(dag.getVouchesFrom(alice).length, 10, "Vouch count must not exceed MAX_VOUCH_PER_USER");
    }

    // ============ Fuzz: referral quality penalty bounded [0, 0.5] ============

    function testFuzz_referralQualityPenaltyBounded(uint256 numVouches) public {
        numVouches = bound(numVouches, 1, 10);

        // alice vouches for random users (all untrusted → bad referrals)
        for (uint256 i = 0; i < numVouches; i++) {
            address target = address(uint160(3000 + i));
            vm.prank(alice);
            dag.addVouch(target, bytes32(0));
        }

        dag.recalculateTrustScores();

        (uint256 score, uint256 penalty) = dag.calculateReferralQuality(alice);

        assertLe(penalty, 5e17, "Penalty must be <= 0.5");
        assertGe(score, 5e17, "Score must be >= 0.5 (1.0 - maxPenalty)");
        assertEq(score + penalty, 1e18, "Score + penalty must equal PRECISION");
    }

    // ============ Fuzz: diversity penalty bounded [0, 1e18] ============

    function testFuzz_diversityPenaltyBounded(uint256 numVouchers, uint256 mutualSeed) public {
        numVouchers = bound(numVouchers, 1, 8);

        address target = address(uint160(7000));

        for (uint256 i = 0; i < numVouchers; i++) {
            address voucher = address(uint160(8000 + i));
            vm.prank(voucher);
            dag.addVouch(target, bytes32(0));

            // Some vouch back (mutual)
            if ((mutualSeed >> i) & 1 == 1) {
                vm.prank(target);
                dag.addVouch(voucher, bytes32(0));
            }
        }

        (uint256 score, uint256 penalty) = dag.calculateDiversityScore(target);

        assertLe(penalty, 1e18, "Diversity penalty must be <= PRECISION");
        assertLe(score, 1e18, "Diversity score must be <= PRECISION");
    }

    // ============ Fuzz: handshake creation is symmetric ============

    function testFuzz_handshakeSymmetric(uint256 userSeed1, uint256 userSeed2) public {
        address user1 = _makeUser(userSeed1);
        address user2 = _makeUser(userSeed2);
        vm.assume(user1 != user2);

        _handshake(user1, user2);

        assertTrue(dag.hasHandshake(user1, user2), "Handshake(a,b) must exist");
        assertTrue(dag.hasHandshake(user2, user1), "Handshake(b,a) must exist");
    }

    // ============ Fuzz: max founders limit enforced ============

    function testFuzz_maxFoundersEnforced(uint256 numFounders) public {
        numFounders = bound(numFounders, 1, 25);

        // alice is already founder (1)
        for (uint256 i = 1; i < numFounders; i++) {
            address founder = address(uint160(9000 + i));
            if (i < 20) {
                dag.addFounder(founder);
            } else {
                vm.expectRevert(IContributionDAG.MaxFoundersReached.selector);
                dag.addFounder(founder);
            }
        }

        assertLe(dag.getFounders().length, 20, "Founder count must not exceed MAX_FOUNDERS");
    }
}
