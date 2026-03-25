// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/ShapleyDistributor.sol";
import "../../contracts/libraries/PairwiseFairness.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title Formal Verification Specs for ShapleyDistributor
 * @notice Properties for Halmos/Certora symbolic execution.
 *
 * @dev These specs define LOCAL LEMMAS — bounded properties that can be
 *      proven via symbolic execution without needing full strategy-proofness.
 *
 *      From the GitHub discussion feedback:
 *      "Use Certora or Halmos for local lemmas, not to claim full strategy-proofness.
 *       They are well suited for: conservation, monotonicity, upper/lower payoff bounds,
 *       and 'under these assumptions, this deviation cannot improve payoff.'"
 *
 *      Run with Halmos: halmos --contract ShapleyFormalSpecs
 *      Run with Foundry (bounded): forge test --match-contract ShapleyFormalSpecs
 *
 *      These double as Foundry fuzz tests AND Halmos symbolic specs.
 *      Foundry: random inputs, bounded. Halmos: exhaustive symbolic, proven.
 */
contract ShapleyFormalSpecs is Test {
    ShapleyDistributor public distributor;
    MockToken public rewardToken;

    address public owner;
    address public creator;

    uint256 constant PRECISION = 1e18;
    uint256 constant BPS = 10000;

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

    // ============ SPEC 1: Conservation (Efficiency) ============
    // For any valid game, sum(shapleyValues) == totalValue.
    // This is the most important invariant — no value created or destroyed.

    function check_conservation_twoPlayers(
        uint256 totalValue,
        uint256 direct1,
        uint256 direct2,
        uint256 time1,
        uint256 time2,
        uint256 scarcity1,
        uint256 scarcity2,
        uint256 stability1,
        uint256 stability2
    ) public {
        // Bound inputs to realistic ranges
        totalValue = bound(totalValue, 1, 1000 * PRECISION);
        direct1 = bound(direct1, 1, 1000 * PRECISION);
        direct2 = bound(direct2, 1, 1000 * PRECISION);
        time1 = bound(time1, 1 days, 365 days);
        time2 = bound(time2, 1 days, 365 days);
        scarcity1 = bound(scarcity1, 0, BPS);
        scarcity2 = bound(scarcity2, 0, BPS);
        stability1 = bound(stability1, 0, BPS);
        stability2 = bound(stability2, 0, BPS);

        address alice = address(uint160(1));
        address bob = address(uint160(2));

        rewardToken.mint(address(distributor), totalValue);

        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](2);
        ps[0] = ShapleyDistributor.Participant(alice, direct1, time1, scarcity1, stability1);
        ps[1] = ShapleyDistributor.Participant(bob, direct2, time2, scarcity2, stability2);

        bytes32 gameId = keccak256(abi.encode(totalValue, direct1, direct2));

        vm.prank(creator);
        distributor.createGame(gameId, totalValue, address(rewardToken), ps);
        distributor.computeShapleyValues(gameId);

        uint256 v1 = distributor.getShapleyValue(gameId, alice);
        uint256 v2 = distributor.getShapleyValue(gameId, bob);

        // LEMMA: conservation
        assertEq(v1 + v2, totalValue, "CONSERVATION VIOLATED");
    }

    // ============ SPEC 2: Non-Negativity ============
    // No participant ever receives a negative share.
    // (Solidity uint256 makes this trivially true, but the SPEC documents the intent.)

    function check_nonNegativity_twoPlayers(
        uint256 totalValue,
        uint256 direct1,
        uint256 direct2
    ) public {
        totalValue = bound(totalValue, 1, 1000 * PRECISION);
        direct1 = bound(direct1, 0, 1000 * PRECISION);
        direct2 = bound(direct2, 1, 1000 * PRECISION); // At least one non-zero

        address alice = address(uint160(1));
        address bob = address(uint160(2));

        rewardToken.mint(address(distributor), totalValue);

        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](2);
        ps[0] = ShapleyDistributor.Participant(alice, direct1, 30 days, 5000, 5000);
        ps[1] = ShapleyDistributor.Participant(bob, direct2, 30 days, 5000, 5000);

        bytes32 gameId = keccak256(abi.encode("nonneg", totalValue, direct1, direct2));

        vm.prank(creator);
        distributor.createGame(gameId, totalValue, address(rewardToken), ps);
        distributor.computeShapleyValues(gameId);

        // LEMMA: non-negativity (trivially true for uint256, but spec documents intent)
        uint256 v1 = distributor.getShapleyValue(gameId, alice);
        uint256 v2 = distributor.getShapleyValue(gameId, bob);
        assertTrue(v1 >= 0, "NON-NEGATIVITY VIOLATED for alice");
        assertTrue(v2 >= 0, "NON-NEGATIVITY VIOLATED for bob");
    }

    // ============ SPEC 3: Upper Bound ============
    // No single participant can receive more than totalValue.

    function check_upperBound_twoPlayers(
        uint256 totalValue,
        uint256 direct1,
        uint256 direct2
    ) public {
        totalValue = bound(totalValue, 1, 1000 * PRECISION);
        direct1 = bound(direct1, 1, 1000 * PRECISION);
        direct2 = bound(direct2, 1, 1000 * PRECISION);

        address alice = address(uint160(1));
        address bob = address(uint160(2));

        rewardToken.mint(address(distributor), totalValue);

        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](2);
        ps[0] = ShapleyDistributor.Participant(alice, direct1, 30 days, 5000, 5000);
        ps[1] = ShapleyDistributor.Participant(bob, direct2, 30 days, 5000, 5000);

        bytes32 gameId = keccak256(abi.encode("upper", totalValue, direct1, direct2));

        vm.prank(creator);
        distributor.createGame(gameId, totalValue, address(rewardToken), ps);
        distributor.computeShapleyValues(gameId);

        // LEMMA: upper bound
        assertLe(distributor.getShapleyValue(gameId, alice), totalValue, "UPPER BOUND VIOLATED for alice");
        assertLe(distributor.getShapleyValue(gameId, bob), totalValue, "UPPER BOUND VIOLATED for bob");
    }

    // ============ SPEC 4: Lawson Floor Lower Bound ============
    // Any participant with non-zero weight gets at least 1% of totalValue.

    function check_lawsonFloor(
        uint256 totalValue,
        uint256 direct1,
        uint256 direct2
    ) public {
        totalValue = bound(totalValue, 100 * PRECISION, 1000 * PRECISION);  // Large enough for floor to matter
        direct1 = bound(direct1, 1, 1000 * PRECISION);
        direct2 = bound(direct2, 1, 1000 * PRECISION);

        address alice = address(uint160(1));
        address bob = address(uint160(2));

        rewardToken.mint(address(distributor), totalValue);

        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](2);
        ps[0] = ShapleyDistributor.Participant(alice, direct1, 30 days, 5000, 5000);
        ps[1] = ShapleyDistributor.Participant(bob, direct2, 30 days, 5000, 5000);

        bytes32 gameId = keccak256(abi.encode("floor", totalValue, direct1, direct2));

        vm.prank(creator);
        distributor.createGame(gameId, totalValue, address(rewardToken), ps);
        distributor.computeShapleyValues(gameId);

        uint256 floor = (totalValue * 100) / BPS;  // 1%

        // LEMMA: Lawson floor (for non-zero-weight participants)
        assertGe(distributor.getShapleyValue(gameId, alice), floor, "LAWSON FLOOR VIOLATED for alice");
        assertGe(distributor.getShapleyValue(gameId, bob), floor, "LAWSON FLOOR VIOLATED for bob");
    }

    // ============ SPEC 5: Monotonicity ============
    // Strictly more contribution (same other inputs) => weakly more reward.

    function check_monotonicity(
        uint256 totalValue,
        uint256 directLow,
        uint256 directBonus
    ) public {
        totalValue = bound(totalValue, 10 * PRECISION, 1000 * PRECISION);
        directLow = bound(directLow, 1 * PRECISION, 100 * PRECISION);
        directBonus = bound(directBonus, 1 * PRECISION, 100 * PRECISION);
        uint256 directHigh = directLow + directBonus;

        address alice = address(uint160(1));
        address bob = address(uint160(2));

        // Game with low contribution
        rewardToken.mint(address(distributor), totalValue);
        ShapleyDistributor.Participant[] memory ps1 = new ShapleyDistributor.Participant[](2);
        ps1[0] = ShapleyDistributor.Participant(alice, directLow, 30 days, 5000, 5000);
        ps1[1] = ShapleyDistributor.Participant(bob, 50 * PRECISION, 30 days, 5000, 5000);

        bytes32 gameId1 = keccak256(abi.encode("mono_low", totalValue, directLow));
        vm.prank(creator);
        distributor.createGame(gameId1, totalValue, address(rewardToken), ps1);
        distributor.computeShapleyValues(gameId1);

        // Game with high contribution
        rewardToken.mint(address(distributor), totalValue);
        ShapleyDistributor.Participant[] memory ps2 = new ShapleyDistributor.Participant[](2);
        ps2[0] = ShapleyDistributor.Participant(alice, directHigh, 30 days, 5000, 5000);
        ps2[1] = ShapleyDistributor.Participant(bob, 50 * PRECISION, 30 days, 5000, 5000);

        bytes32 gameId2 = keccak256(abi.encode("mono_high", totalValue, directHigh));
        vm.prank(creator);
        distributor.createGame(gameId2, totalValue, address(rewardToken), ps2);
        distributor.computeShapleyValues(gameId2);

        // LEMMA: monotonicity
        assertGe(
            distributor.getShapleyValue(gameId2, alice),
            distributor.getShapleyValue(gameId1, alice),
            "MONOTONICITY VIOLATED: more contribution should yield >= reward"
        );
    }

    // ============ SPEC 6: PairwiseFairness Reflexivity ============
    // verifyPairwiseFairness(a, a) should always be fair (a participant
    // is always proportional to themselves).

    function check_pairwiseSelfFair(uint256 totalValue, uint256 direct1) public {
        totalValue = bound(totalValue, 1 * PRECISION, 1000 * PRECISION);
        direct1 = bound(direct1, 1 * PRECISION, 1000 * PRECISION);

        address alice = address(uint160(1));
        address bob = address(uint160(2));

        rewardToken.mint(address(distributor), totalValue);

        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](2);
        ps[0] = ShapleyDistributor.Participant(alice, direct1, 30 days, 5000, 5000);
        ps[1] = ShapleyDistributor.Participant(bob, direct1, 30 days, 5000, 5000);

        bytes32 gameId = keccak256(abi.encode("self", totalValue, direct1));
        vm.prank(creator);
        distributor.createGame(gameId, totalValue, address(rewardToken), ps);
        distributor.computeShapleyValues(gameId);

        (bool fair, ) = distributor.verifyPairwiseFairness(gameId, alice, alice);
        assertTrue(fair, "PAIRWISE SELF-FAIRNESS VIOLATED");
    }
}
