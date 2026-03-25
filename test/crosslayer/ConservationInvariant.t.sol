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
 * @title Conservation Invariant Tests
 * @notice Proves that value is neither created nor destroyed across the
 *         settlement → distribution flow.
 *
 * @dev From the GitHub discussion feedback, four cross-contract invariants:
 *
 *   1. CONSERVATION: total value in = total value out across full flow
 *   2. HONEST BASELINE: no actor ends above honest baseline without risk/penalty
 *   3. MONOTONIC SLASHING: stronger deviations cannot reduce punishment
 *   4. NO ROUNDING SUBSIDY: no micro-arbitrage from truncation
 *
 * This contract tests #1 and #4. Tests #2 and #3 require adversarial
 * agents (Layer 3) and are stubbed for future implementation.
 */
contract ConservationInvariantTest is Test {
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

    // ============ Invariant 1: Conservation of Value ============

    /**
     * @notice Total tokens deposited = total tokens claimed + unclaimed balance.
     * @dev No value is created or destroyed during Shapley computation.
     *      The distributor is a passthrough: funds in = funds out.
     */
    function test_conservation_singleGame() public {
        bytes32 gameId = keccak256("conservation_single");
        uint256 totalValue = 100 * PRECISION;

        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        address charlie = makeAddr("charlie");

        // Fund distributor
        rewardToken.mint(address(distributor), totalValue);
        uint256 contractBalanceBefore = rewardToken.balanceOf(address(distributor));

        // Create and settle game
        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](3);
        ps[0] = ShapleyDistributor.Participant(alice,   50 * PRECISION, 30 days, 7000, 7000);
        ps[1] = ShapleyDistributor.Participant(bob,     30 * PRECISION, 14 days, 5000, 5000);
        ps[2] = ShapleyDistributor.Participant(charlie, 20 * PRECISION, 7 days,  3000, 3000);

        vm.prank(creator);
        distributor.createGame(gameId, totalValue, address(rewardToken), ps);
        distributor.computeShapleyValues(gameId);

        // Verify conservation: sum of Shapley values == totalValue
        uint256 aliceVal = distributor.getShapleyValue(gameId, alice);
        uint256 bobVal = distributor.getShapleyValue(gameId, bob);
        uint256 charlieVal = distributor.getShapleyValue(gameId, charlie);

        assertEq(aliceVal + bobVal + charlieVal, totalValue, "CONSERVATION VIOLATED: Shapley sum != total");

        // Claim all rewards
        vm.prank(alice);
        distributor.claimReward(gameId);
        vm.prank(bob);
        distributor.claimReward(gameId);
        vm.prank(charlie);
        distributor.claimReward(gameId);

        // Conservation: all funds left the contract to the right recipients
        assertEq(rewardToken.balanceOf(alice), aliceVal, "Alice didn't get correct amount");
        assertEq(rewardToken.balanceOf(bob), bobVal, "Bob didn't get correct amount");
        assertEq(rewardToken.balanceOf(charlie), charlieVal, "Charlie didn't get correct amount");

        // Nothing stuck in contract (for this game's value)
        uint256 contractBalanceAfter = rewardToken.balanceOf(address(distributor));
        assertEq(contractBalanceAfter, contractBalanceBefore - totalValue, "Tokens stuck in contract");
    }

    /**
     * @notice Conservation across two concurrent games using the same token.
     * @dev Games share the token pool. Committed balance tracking must prevent overdraw.
     */
    function test_conservation_concurrentGames() public {
        bytes32 gameId1 = keccak256("concurrent_1");
        bytes32 gameId2 = keccak256("concurrent_2");
        uint256 value1 = 100 * PRECISION;
        uint256 value2 = 50 * PRECISION;

        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        address charlie = makeAddr("charlie");
        address dave = makeAddr("dave");

        // Fund both games
        rewardToken.mint(address(distributor), value1 + value2);

        // Game 1
        ShapleyDistributor.Participant[] memory ps1 = new ShapleyDistributor.Participant[](2);
        ps1[0] = ShapleyDistributor.Participant(alice, 60 * PRECISION, 30 days, 7000, 7000);
        ps1[1] = ShapleyDistributor.Participant(bob,   40 * PRECISION, 14 days, 5000, 5000);

        vm.prank(creator);
        distributor.createGame(gameId1, value1, address(rewardToken), ps1);

        // Game 2 (concurrent, not yet settled)
        ShapleyDistributor.Participant[] memory ps2 = new ShapleyDistributor.Participant[](2);
        ps2[0] = ShapleyDistributor.Participant(charlie, 30 * PRECISION, 7 days, 3000, 3000);
        ps2[1] = ShapleyDistributor.Participant(dave,    20 * PRECISION, 3 days, 2000, 2000);

        vm.prank(creator);
        distributor.createGame(gameId2, value2, address(rewardToken), ps2);

        // Settle both
        distributor.computeShapleyValues(gameId1);
        distributor.computeShapleyValues(gameId2);

        // Conservation per game
        uint256 g1Total = distributor.getShapleyValue(gameId1, alice) +
                          distributor.getShapleyValue(gameId1, bob);
        uint256 g2Total = distributor.getShapleyValue(gameId2, charlie) +
                          distributor.getShapleyValue(gameId2, dave);

        assertEq(g1Total, value1, "Game 1 conservation violated");
        assertEq(g2Total, value2, "Game 2 conservation violated");

        // Conservation aggregate: no cross-game leakage
        assertEq(g1Total + g2Total, value1 + value2, "Cross-game conservation violated");

        // Claim all and verify
        vm.prank(alice);
        distributor.claimReward(gameId1);
        vm.prank(bob);
        distributor.claimReward(gameId1);
        vm.prank(charlie);
        distributor.claimReward(gameId2);
        vm.prank(dave);
        distributor.claimReward(gameId2);

        assertEq(
            rewardToken.balanceOf(alice) + rewardToken.balanceOf(bob) +
            rewardToken.balanceOf(charlie) + rewardToken.balanceOf(dave),
            value1 + value2,
            "Total claimed != total deposited"
        );
    }

    // ============ Invariant 4: No Rounding Subsidy ============

    /**
     * @notice Run the same game configuration many times with different participant
     *         orderings. If rounding systematically benefits one position (e.g., last
     *         participant always gets more due to dust), that's a micro-arbitrage surface.
     */
    function test_noRoundingSubsidy_positionIndependent() public {
        uint256 totalValue = 100 * PRECISION;

        address a = makeAddr("a");
        address b = makeAddr("b");
        address c = makeAddr("c");

        // All three have identical contributions
        uint256 direct = 10 * PRECISION;
        uint256 timeInPool = 30 days;
        uint256 scarcity = 5000;
        uint256 stability = 5000;

        // Run with ordering [a, b, c]
        bytes32 gameId_abc = keccak256("order_abc");
        _runGame(gameId_abc, totalValue, a, b, c, direct, timeInPool, scarcity, stability);

        uint256 a_share_abc = distributor.getShapleyValue(gameId_abc, a);
        uint256 b_share_abc = distributor.getShapleyValue(gameId_abc, b);
        uint256 c_share_abc = distributor.getShapleyValue(gameId_abc, c);

        // Run with ordering [c, a, b]
        bytes32 gameId_cab = keccak256("order_cab");
        _runGame(gameId_cab, totalValue, c, a, b, direct, timeInPool, scarcity, stability);

        uint256 c_share_cab = distributor.getShapleyValue(gameId_cab, c);
        uint256 a_share_cab = distributor.getShapleyValue(gameId_cab, a);
        uint256 b_share_cab = distributor.getShapleyValue(gameId_cab, b);

        // Run with ordering [b, c, a]
        bytes32 gameId_bca = keccak256("order_bca");
        _runGame(gameId_bca, totalValue, b, c, a, direct, timeInPool, scarcity, stability);

        uint256 b_share_bca = distributor.getShapleyValue(gameId_bca, b);
        uint256 c_share_bca = distributor.getShapleyValue(gameId_bca, c);
        uint256 a_share_bca = distributor.getShapleyValue(gameId_bca, a);

        // For identical contributions, each participant should get ~33.33 ether
        // Dust goes to last participant (+1 wei max). The KEY assertion:
        // no participant gets MORE than 1 wei extra regardless of position
        uint256 expectedBase = totalValue / 3;  // 33.333... ether (truncated)

        // a's share should not vary by more than 1 wei across orderings
        assertApproxEqAbs(a_share_abc, a_share_cab, 1, "a's share position-dependent");
        assertApproxEqAbs(a_share_abc, a_share_bca, 1, "a's share position-dependent");

        // Same for b and c
        assertApproxEqAbs(b_share_abc, b_share_cab, 1, "b's share position-dependent");
        assertApproxEqAbs(b_share_abc, b_share_bca, 1, "b's share position-dependent");

        assertApproxEqAbs(c_share_abc, c_share_cab, 1, "c's share position-dependent");
        assertApproxEqAbs(c_share_abc, c_share_bca, 1, "c's share position-dependent");
    }

    /**
     * @notice Run many games with small totals where rounding dominates.
     *         Conservation must hold even when dust > actual value per participant.
     */
    function test_noRoundingSubsidy_smallValues() public {
        // 7 wei split across 3 participants — rounding dominates
        for (uint256 total = 1; total <= 20; total++) {
            bytes32 gameId = keccak256(abi.encodePacked("small_", total));

            address p1 = makeAddr(string(abi.encodePacked("p1_", vm.toString(total))));
            address p2 = makeAddr(string(abi.encodePacked("p2_", vm.toString(total))));

            rewardToken.mint(address(distributor), total);

            ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](2);
            ps[0] = ShapleyDistributor.Participant(p1, 1 * PRECISION, 86400, 5000, 5000);
            ps[1] = ShapleyDistributor.Participant(p2, 2 * PRECISION, 86400, 5000, 5000);

            vm.prank(creator);
            distributor.createGame(gameId, total, address(rewardToken), ps);
            distributor.computeShapleyValues(gameId);

            uint256 v1 = distributor.getShapleyValue(gameId, p1);
            uint256 v2 = distributor.getShapleyValue(gameId, p2);

            // Conservation: MUST hold even for 1 wei
            assertEq(v1 + v2, total, string(abi.encodePacked("Conservation at total=", vm.toString(total))));
        }
    }

    // ============ Invariant 2: Honest Baseline (Stub for Layer 3) ============

    /**
     * @notice STUB: No actor should end above the honest baseline without
     *         taking equivalent risk or penalty.
     * @dev This requires adversarial agents — Layer 3. For now, verify the
     *      simpler version: honest participants always get non-negative payoff.
     */
    function test_honestBaseline_nonNegativePayoff() public {
        bytes32 gameId = keccak256("honest_baseline");
        uint256 totalValue = 100 * PRECISION;

        address honest1 = makeAddr("honest1");
        address honest2 = makeAddr("honest2");
        address honest3 = makeAddr("honest3");

        rewardToken.mint(address(distributor), totalValue);

        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](3);
        ps[0] = ShapleyDistributor.Participant(honest1, 10 * PRECISION, 30 days, 5000, 5000);
        ps[1] = ShapleyDistributor.Participant(honest2, 10 * PRECISION, 30 days, 5000, 5000);
        ps[2] = ShapleyDistributor.Participant(honest3, 10 * PRECISION, 30 days, 5000, 5000);

        vm.prank(creator);
        distributor.createGame(gameId, totalValue, address(rewardToken), ps);
        distributor.computeShapleyValues(gameId);

        // All honest participants with equal contributions get non-negative, roughly equal shares
        uint256 v1 = distributor.getShapleyValue(gameId, honest1);
        uint256 v2 = distributor.getShapleyValue(gameId, honest2);
        uint256 v3 = distributor.getShapleyValue(gameId, honest3);

        assertGt(v1, 0, "honest1 got zero");
        assertGt(v2, 0, "honest2 got zero");
        assertGt(v3, 0, "honest3 got zero");

        // Each should get ~33.33 ether — within 1% of fair share
        uint256 fairShare = totalValue / 3;
        assertApproxEqRel(v1, fairShare, 0.01e18, "honest1 far from fair share");
        assertApproxEqRel(v2, fairShare, 0.01e18, "honest2 far from fair share");
        assertApproxEqRel(v3, fairShare, 0.01e18, "honest3 far from fair share");
    }

    // ============ Helpers ============

    function _runGame(
        bytes32 gameId,
        uint256 totalValue,
        address p1, address p2, address p3,
        uint256 direct, uint256 timeInPool,
        uint256 scarcity, uint256 stability
    ) internal {
        rewardToken.mint(address(distributor), totalValue);

        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](3);
        ps[0] = ShapleyDistributor.Participant(p1, direct, timeInPool, scarcity, stability);
        ps[1] = ShapleyDistributor.Participant(p2, direct, timeInPool, scarcity, stability);
        ps[2] = ShapleyDistributor.Participant(p3, direct, timeInPool, scarcity, stability);

        vm.prank(creator);
        distributor.createGame(gameId, totalValue, address(rewardToken), ps);
        distributor.computeShapleyValues(gameId);
    }
}
