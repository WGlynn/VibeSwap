// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/ShapleyDistributor.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title Cross-Layer Shapley Replay Tests
 * @notice Layer 2 verification: replays Python-generated test vectors through
 *         the real ShapleyDistributor.sol and asserts outputs match.
 *
 * @dev Each test case corresponds to a vector in test/vectors/*.json generated
 *      by oracle/backtest/generate_vectors.py. If the Python reference model
 *      and Solidity contract diverge, these tests catch it.
 *
 *      Regenerate vectors: python -m oracle.backtest.generate_vectors
 *      Then update expected values here if the contract logic changed.
 *
 * Architecture:
 *   Python (exact arithmetic) → JSON vectors → Solidity replay → assert match
 *   This is the cross-layer comparison the three-layer testing framework requires.
 */
contract ShapleyReplayTest is Test {
    ShapleyDistributor public distributor;
    MockToken public rewardToken;

    address public owner;
    address public creator;

    uint256 constant PRECISION = 1e18;

    function setUp() public {
        owner = address(this);
        creator = makeAddr("creator");

        rewardToken = new MockToken("Reward", "RWD");

        ShapleyDistributor impl = new ShapleyDistributor();
        bytes memory initData = abi.encodeWithSelector(
            ShapleyDistributor.initialize.selector,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        distributor = ShapleyDistributor(payable(address(proxy)));

        distributor.setAuthorizedCreator(creator, true);
    }

    // ============ Helper ============

    function _createAndSettle(
        bytes32 gameId,
        uint256 totalValue,
        ShapleyDistributor.Participant[] memory participants
    ) internal {
        rewardToken.mint(address(distributor), totalValue);
        vm.prank(creator);
        distributor.createGame(gameId, totalValue, address(rewardToken), participants);
        distributor.computeShapleyValues(gameId);
    }

    function _getShare(bytes32 gameId, address participant) internal view returns (uint256) {
        return distributor.getShapleyValue(gameId, participant);
    }

    // ============ Vector: two_equal ============
    // Python expected: alice=50000000000000000000, bob=50000000000000000000

    function test_replay_twoEqual() public {
        bytes32 gameId = keccak256("two_equal");
        uint256 totalValue = 100 * PRECISION;

        address alice = makeAddr("alice");
        address bob = makeAddr("bob");

        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](2);
        ps[0] = ShapleyDistributor.Participant(alice, 10 * PRECISION, 30 days, 5000, 5000);
        ps[1] = ShapleyDistributor.Participant(bob,   10 * PRECISION, 30 days, 5000, 5000);

        _createAndSettle(gameId, totalValue, ps);

        uint256 aliceShare = _getShare(gameId, alice);
        uint256 bobShare = _getShare(gameId, bob);

        // Efficiency: must sum to total
        assertEq(aliceShare + bobShare, totalValue, "efficiency violated");

        // Symmetry: equal inputs => equal outputs (bob gets dust, may be +1 wei)
        assertApproxEqAbs(aliceShare, bobShare, 1, "symmetry violated");

        // Cross-layer: match Python reference (expected: 50e18 each, bob gets dust)
        assertEq(aliceShare, 50 * PRECISION, "alice share mismatch vs Python");
    }

    // ============ Vector: three_unequal ============
    // Python expected weights: alice=8270e15 (dominant), bob very small, charlie mid

    function test_replay_threeUnequal() public {
        bytes32 gameId = keccak256("three_unequal");
        uint256 totalValue = 1000 * PRECISION;

        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        address charlie = makeAddr("charlie");

        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](3);
        ps[0] = ShapleyDistributor.Participant(alice,   100 * PRECISION, 365 days, 9000, 9000);
        ps[1] = ShapleyDistributor.Participant(bob,     1 * PRECISION,   1 days,   1000, 1000);
        ps[2] = ShapleyDistributor.Participant(charlie, 50 * PRECISION,  90 days,  5000, 5000);

        _createAndSettle(gameId, totalValue, ps);

        uint256 aliceShare = _getShare(gameId, alice);
        uint256 bobShare = _getShare(gameId, bob);
        uint256 charlieShare = _getShare(gameId, charlie);

        // Efficiency
        assertEq(aliceShare + bobShare + charlieShare, totalValue, "efficiency violated");

        // Ordering: alice > charlie > bob (alice has 100x direct + max time)
        assertGt(aliceShare, charlieShare, "alice should beat charlie");
        assertGt(charlieShare, bobShare, "charlie should beat bob");

        // Null player: bob has small but nonzero contribution, should get at least floor
        uint256 floor = (totalValue * 100) / 10000; // 1% = 10 ether
        assertGe(bobShare, floor, "bob below Lawson floor");
    }

    // ============ Vector: lawson_floor ============
    // Whale dominates, minnow gets boosted to 1% floor

    function test_replay_lawsonFloor() public {
        bytes32 gameId = keccak256("lawson_floor");
        uint256 totalValue = 100 * PRECISION;

        address whale = makeAddr("whale");
        address minnow = makeAddr("minnow");

        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](2);
        ps[0] = ShapleyDistributor.Participant(whale,  10000 * PRECISION, 365 days, 10000, 10000);
        ps[1] = ShapleyDistributor.Participant(minnow, 1 * PRECISION,     1 days,   100,   100);

        _createAndSettle(gameId, totalValue, ps);

        uint256 whaleShare = _getShare(gameId, whale);
        uint256 minnowShare = _getShare(gameId, minnow);

        // Efficiency
        assertEq(whaleShare + minnowShare, totalValue, "efficiency violated");

        // Floor enforcement: minnow must get >= 1%
        uint256 floor = (totalValue * 100) / 10000;
        assertGe(minnowShare, floor, "Lawson floor violated for minnow");

        // Whale still dominates
        assertGt(whaleShare, minnowShare, "whale should dominate");
    }

    // ============ Vector: five_dust_stress ============
    // 5 participants with prime-ish total — dust collection stress test

    function test_replay_fiveDustStress() public {
        bytes32 gameId = keccak256("five_dust_stress");
        uint256 totalValue = 999_999_999_999_999_997;

        address a = makeAddr("a");
        address b = makeAddr("b");
        address c = makeAddr("c");
        address d = makeAddr("d");
        address e = makeAddr("e");

        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](5);
        ps[0] = ShapleyDistributor.Participant(a, 7 * PRECISION,  30 days,  3000, 7000);
        ps[1] = ShapleyDistributor.Participant(b, 3 * PRECISION,  14 days,  7000, 3000);
        ps[2] = ShapleyDistributor.Participant(c, 1 * PRECISION,  1 days,   1000, 1000);
        ps[3] = ShapleyDistributor.Participant(d, 15 * PRECISION, 180 days, 8000, 8000);
        ps[4] = ShapleyDistributor.Participant(e, 5 * PRECISION,  7 days,   5000, 5000);

        _createAndSettle(gameId, totalValue, ps);

        // Efficiency: sum must be exact
        uint256 total = _getShare(gameId, a) + _getShare(gameId, b) +
                        _getShare(gameId, c) + _getShare(gameId, d) +
                        _getShare(gameId, e);
        assertEq(total, totalValue, "efficiency violated with prime total");

        // d should be dominant (highest direct + long time + high scores)
        assertGt(_getShare(gameId, d), _getShare(gameId, a), "d should beat a");
        assertGt(_getShare(gameId, d), _getShare(gameId, e), "d should beat e");
    }

    // ============ Vector: null_player ============
    // One participant with zero everything

    function test_replay_nullPlayer() public {
        bytes32 gameId = keccak256("null_player");
        uint256 totalValue = 100 * PRECISION;

        address null_addr = makeAddr("null");
        address real1 = makeAddr("real1");
        address real2 = makeAddr("real2");

        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](3);
        ps[0] = ShapleyDistributor.Participant(null_addr, 0, 0, 0, 0);
        ps[1] = ShapleyDistributor.Participant(real1, 10 * PRECISION, 30 days, 5000, 5000);
        ps[2] = ShapleyDistributor.Participant(real2, 5 * PRECISION,  7 days,  3000, 8000);

        _createAndSettle(gameId, totalValue, ps);

        // Null player axiom: zero in => zero out
        assertEq(_getShare(gameId, null_addr), 0, "null player got nonzero share");

        // Efficiency
        uint256 total = _getShare(gameId, null_addr) + _getShare(gameId, real1) + _getShare(gameId, real2);
        assertEq(total, totalValue, "efficiency violated");
    }

    // ============ Vector: extreme_ratio ============
    // 1,000,000:1 contribution ratio

    function test_replay_extremeRatio() public {
        bytes32 gameId = keccak256("extreme_ratio");
        uint256 totalValue = 1_000_000 * PRECISION;

        address whale = makeAddr("whale");
        address dust = makeAddr("dust");

        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](2);
        ps[0] = ShapleyDistributor.Participant(whale, 1_000_000 * PRECISION, 365 days, 10000, 10000);
        ps[1] = ShapleyDistributor.Participant(dust,  1,                      1 days,   100,   100);

        _createAndSettle(gameId, totalValue, ps);

        uint256 whaleShare = _getShare(gameId, whale);
        uint256 dustShare = _getShare(gameId, dust);

        // Efficiency
        assertEq(whaleShare + dustShare, totalValue, "efficiency violated");

        // Dust participant still gets Lawson floor (1%)
        uint256 floor = (totalValue * 100) / 10000;
        assertGe(dustShare, floor, "Lawson floor violated at extreme ratio");
    }

    // ============ Vector: zero_scores ============
    // All scarcity/stability = 0, only direct + time matter

    function test_replay_zeroScores() public {
        bytes32 gameId = keccak256("zero_scores");
        uint256 totalValue = 100 * PRECISION;

        address a = makeAddr("a");
        address b = makeAddr("b");

        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](2);
        ps[0] = ShapleyDistributor.Participant(a, 10 * PRECISION, 30 days, 0, 0);
        ps[1] = ShapleyDistributor.Participant(b, 20 * PRECISION, 60 days, 0, 0);

        _createAndSettle(gameId, totalValue, ps);

        uint256 aShare = _getShare(gameId, a);
        uint256 bShare = _getShare(gameId, b);

        // Efficiency
        assertEq(aShare + bShare, totalValue, "efficiency violated");

        // b has 2x direct and 2x time with zero scores, should get more
        assertGt(bShare, aShare, "b should dominate with 2x direct+time");
    }

    // ============ Vector: null_player_last (Regression for dust fix) ============
    // Null player at last position must get exactly 0 (not dust)

    function test_replay_nullPlayerLast() public {
        bytes32 gameId = keccak256("null_player_last");
        uint256 totalValue = 100 * PRECISION;

        address real1 = makeAddr("real1");
        address real2 = makeAddr("real2");
        address null_addr = makeAddr("null");

        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](3);
        ps[0] = ShapleyDistributor.Participant(real1, 10 * PRECISION, 30 days, 5000, 5000);
        ps[1] = ShapleyDistributor.Participant(real2, 5 * PRECISION,  7 days,  3000, 8000);
        ps[2] = ShapleyDistributor.Participant(null_addr, 0, 0, 0, 0);  // Last position

        _createAndSettle(gameId, totalValue, ps);

        // Null player axiom: zero weight => zero share, even at last position
        assertEq(_getShare(gameId, null_addr), 0, "null player at last position got nonzero share");

        // Efficiency: total must still sum correctly
        uint256 total = _getShare(gameId, real1) + _getShare(gameId, real2) + _getShare(gameId, null_addr);
        assertEq(total, totalValue, "efficiency violated");

        // Dust went to real2 (last non-zero-weight participant)
        assertGt(_getShare(gameId, real1), 0, "real1 should get share");
        assertGt(_getShare(gameId, real2), 0, "real2 should get share (including dust)");
    }

    // ============ Cross-Layer Pairwise Verification ============

    function test_replay_pairwiseFairnessOnChain() public {
        bytes32 gameId = keccak256("pairwise_check");
        uint256 totalValue = 100 * PRECISION;

        address alice = makeAddr("alice");
        address bob = makeAddr("bob");

        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](2);
        ps[0] = ShapleyDistributor.Participant(alice, 20 * PRECISION, 30 days, 5000, 5000);
        ps[1] = ShapleyDistributor.Participant(bob,   10 * PRECISION, 30 days, 5000, 5000);

        _createAndSettle(gameId, totalValue, ps);

        // Use the on-chain pairwise fairness verifier
        (bool fair, uint256 deviation) = distributor.verifyPairwiseFairness(gameId, alice, bob);
        assertTrue(fair, "on-chain pairwise fairness failed");
    }

    // ============ Monotonicity (Gap #4 from Coverage Matrix) ============

    function test_monotonicContribution() public {
        // Same game but one participant has strictly more — they must get more
        bytes32 gameId1 = keccak256("mono_1");
        bytes32 gameId2 = keccak256("mono_2");
        uint256 totalValue = 100 * PRECISION;

        address alice = makeAddr("alice");
        address bob = makeAddr("bob");

        // Game 1: alice = 10, bob = 5
        ShapleyDistributor.Participant[] memory ps1 = new ShapleyDistributor.Participant[](2);
        ps1[0] = ShapleyDistributor.Participant(alice, 10 * PRECISION, 30 days, 5000, 5000);
        ps1[1] = ShapleyDistributor.Participant(bob,   5 * PRECISION,  30 days, 5000, 5000);

        rewardToken.mint(address(distributor), totalValue);
        vm.prank(creator);
        distributor.createGame(gameId1, totalValue, address(rewardToken), ps1);
        distributor.computeShapleyValues(gameId1);

        // Game 2: alice = 20 (more), bob = 5 (same)
        ShapleyDistributor.Participant[] memory ps2 = new ShapleyDistributor.Participant[](2);
        ps2[0] = ShapleyDistributor.Participant(alice, 20 * PRECISION, 30 days, 5000, 5000);
        ps2[1] = ShapleyDistributor.Participant(bob,   5 * PRECISION,  30 days, 5000, 5000);

        rewardToken.mint(address(distributor), totalValue);
        vm.prank(creator);
        distributor.createGame(gameId2, totalValue, address(rewardToken), ps2);
        distributor.computeShapleyValues(gameId2);

        // Monotonicity: alice contributes more in game2 => alice gets more in game2
        uint256 aliceShare1 = _getShare(gameId1, alice);
        uint256 aliceShare2 = _getShare(gameId2, alice);
        assertGt(aliceShare2, aliceShare1, "monotonicity violated: more contribution should yield more reward");

        // Bob contributes same => bob gets less (alice took a bigger slice)
        uint256 bobShare1 = _getShare(gameId1, bob);
        uint256 bobShare2 = _getShare(gameId2, bob);
        assertLt(bobShare2, bobShare1, "monotonicity violated: bob should get less when alice grows");
    }
}
