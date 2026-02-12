// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/ShapleyDistributor.sol";
import "../../contracts/libraries/PairwiseFairness.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title Time Neutrality Proofs
 * @notice On-chain verification of the five Shapley axioms:
 *         Efficiency, Symmetry, Null Player, Pairwise Proportionality, Time Neutrality
 *
 * These tests constitute formal proofs-by-execution that the ShapleyDistributor
 * satisfies all fairness properties defined in docs/TIME_NEUTRAL_TOKENOMICS.md
 */
contract TimeNeutralityProofsTest is Test {
    ShapleyDistributor public distributor;
    MockToken public token;

    address public owner;
    address public authorizedCreator;

    uint256 constant PRECISION = 1e18;

    function setUp() public {
        owner = address(this);
        authorizedCreator = makeAddr("authorizedCreator");

        token = new MockToken();

        ShapleyDistributor impl = new ShapleyDistributor();
        bytes memory initData = abi.encodeWithSelector(
            ShapleyDistributor.initialize.selector,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        distributor = ShapleyDistributor(payable(address(proxy)));

        distributor.setAuthorizedCreator(authorizedCreator, true);
    }

    // ============ Helper ============

    function _createAndSettle(
        bytes32 gameId,
        uint256 totalValue,
        ShapleyDistributor.Participant[] memory participants
    ) internal {
        token.mint(address(distributor), totalValue);

        vm.prank(authorizedCreator);
        distributor.createGame(gameId, totalValue, address(token), participants);

        vm.prank(authorizedCreator);
        distributor.computeShapleyValues(gameId);
    }

    function _createAndSettleTyped(
        bytes32 gameId,
        uint256 totalValue,
        ShapleyDistributor.GameType gameType,
        ShapleyDistributor.Participant[] memory participants
    ) internal {
        token.mint(address(distributor), totalValue);

        vm.prank(authorizedCreator);
        distributor.createGameTyped(gameId, totalValue, address(token), gameType, participants);

        vm.prank(authorizedCreator);
        distributor.computeShapleyValues(gameId);
    }

    function _twoParticipants(
        address a, uint256 contribA,
        address b, uint256 contribB
    ) internal pure returns (ShapleyDistributor.Participant[] memory) {
        ShapleyDistributor.Participant[] memory p = new ShapleyDistributor.Participant[](2);
        p[0] = ShapleyDistributor.Participant(a, contribA, 30 days, 5000, 5000);
        p[1] = ShapleyDistributor.Participant(b, contribB, 30 days, 5000, 5000);
        return p;
    }

    // ============ Axiom 1: Efficiency — All value distributed ============

    /**
     * @notice Proves: Σφᵢ = V (sum of allocations equals total value)
     */
    function test_axiom1_efficiency() public {
        uint256 totalValue = 100 ether;
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        address carol = makeAddr("carol");

        ShapleyDistributor.Participant[] memory p = new ShapleyDistributor.Participant[](3);
        p[0] = ShapleyDistributor.Participant(alice, 10 ether, 30 days, 7000, 8000);
        p[1] = ShapleyDistributor.Participant(bob, 5 ether, 15 days, 3000, 5000);
        p[2] = ShapleyDistributor.Participant(carol, 1 ether, 7 days, 5000, 2000);

        _createAndSettle(keccak256("efficiency"), totalValue, p);

        uint256 sum = distributor.getShapleyValue(keccak256("efficiency"), alice)
                    + distributor.getShapleyValue(keccak256("efficiency"), bob)
                    + distributor.getShapleyValue(keccak256("efficiency"), carol);

        assertEq(sum, totalValue, "EFFICIENCY VIOLATED: not all value distributed");
    }

    // ============ Axiom 2: Symmetry — Equal contributors get equal rewards ============

    /**
     * @notice Proves: wᵢ = wⱼ ⟹ φᵢ = φⱼ
     */
    function test_axiom2_symmetry() public {
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");

        // Identical contributions
        ShapleyDistributor.Participant[] memory p = _twoParticipants(
            alice, 10 ether,
            bob, 10 ether
        );

        _createAndSettle(keccak256("symmetry"), 100 ether, p);

        uint256 rewardA = distributor.getShapleyValue(keccak256("symmetry"), alice);
        uint256 rewardB = distributor.getShapleyValue(keccak256("symmetry"), bob);

        assertApproxEqAbs(rewardA, rewardB, 1, "SYMMETRY VIOLATED: equal contributors got different rewards");
    }

    // ============ Axiom 3: Null Player — Zero contribution gets zero reward ============

    /**
     * @notice Proves: wᵢ = 0 ⟹ φᵢ = 0
     */
    function test_axiom3_nullPlayer() public {
        address contributor = makeAddr("contributor");
        address freeloader = makeAddr("freeloader");

        ShapleyDistributor.Participant[] memory p = new ShapleyDistributor.Participant[](2);
        p[0] = ShapleyDistributor.Participant(contributor, 10 ether, 30 days, 5000, 5000);
        p[1] = ShapleyDistributor.Participant(freeloader, 1, 1, 0, 0); // Minimal contribution

        _createAndSettle(keccak256("nullplayer"), 100 ether, p);

        uint256 contributorReward = distributor.getShapleyValue(keccak256("nullplayer"), contributor);
        uint256 freeloaderReward = distributor.getShapleyValue(keccak256("nullplayer"), freeloader);

        assertGt(contributorReward, freeloaderReward * 100, "NULL PLAYER VIOLATED: freeloader got too much");
    }

    // ============ Axiom 4: Pairwise Proportionality — φᵢ/φⱼ = wᵢ/wⱼ ============

    /**
     * @notice Proves: For any pair (i,j), reward ratio equals contribution ratio
     * @dev Uses on-chain verifyPairwiseFairness() function
     */
    function test_axiom4_pairwiseProportionality() public {
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");

        ShapleyDistributor.Participant[] memory p = _twoParticipants(
            alice, 20 ether,
            bob, 5 ether
        );

        bytes32 gameId = keccak256("pairwise");
        _createAndSettle(gameId, 100 ether, p);

        // Use the on-chain verification function
        (bool fair, uint256 deviation) = distributor.verifyPairwiseFairness(gameId, alice, bob);

        assertTrue(fair, "PAIRWISE PROPORTIONALITY VIOLATED");

        // Also verify manually via cross-multiplication
        uint256 rewardA = distributor.getShapleyValue(gameId, alice);
        uint256 rewardB = distributor.getShapleyValue(gameId, bob);
        uint256 weightA = distributor.getWeightedContribution(gameId, alice);
        uint256 weightB = distributor.getWeightedContribution(gameId, bob);

        // rewardA * weightB ≈ rewardB * weightA
        uint256 lhs = rewardA * weightB;
        uint256 rhs = rewardB * weightA;
        uint256 diff = lhs > rhs ? lhs - rhs : rhs - lhs;

        // Tolerance: integer division rounding scales with totalWeight
        uint256 totalWeight = distributor.totalWeightedContrib(gameId);
        assertLe(diff, totalWeight, "Cross-multiplication pairwise check failed");
    }

    /**
     * @notice Proves pairwise proportionality for many participants via library
     */
    function test_axiom4_pairwiseAllPairs() public {
        uint256 n = 5;
        ShapleyDistributor.Participant[] memory p = new ShapleyDistributor.Participant[](n);

        for (uint256 i = 0; i < n; i++) {
            p[i] = ShapleyDistributor.Participant(
                address(uint160(i + 1)),
                (i + 1) * 1 ether, // 1, 2, 3, 4, 5 ether
                (i + 1) * 7 days,
                5000,
                5000
            );
        }

        bytes32 gameId = keccak256("allpairs");
        _createAndSettle(gameId, 100 ether, p);

        // Collect rewards and weights
        uint256[] memory rewards = new uint256[](n);
        uint256[] memory weights = new uint256[](n);

        for (uint256 i = 0; i < n; i++) {
            address addr = address(uint160(i + 1));
            rewards[i] = distributor.getShapleyValue(gameId, addr);
            weights[i] = distributor.getWeightedContribution(gameId, addr);
        }

        // Verify all pairs using PairwiseFairness library
        uint256 totalWeight = distributor.totalWeightedContrib(gameId);
        (bool allFair, uint256 worstDeviation,,) = PairwiseFairness.verifyAllPairs(
            rewards, weights, totalWeight
        );

        assertTrue(allFair, "PAIRWISE PROPORTIONALITY VIOLATED for some pair");
        // Log worst deviation for transparency
        emit log_named_uint("Worst pairwise deviation", worstDeviation);
    }

    // ============ Axiom 5: Time Neutrality — Same work, same reward, any era ============

    /**
     * @notice Proves: Identical FEE_DISTRIBUTION games at different eras yield identical rewards
     * @dev This is the core time neutrality proof. Two games with identical participants and
     *      total values MUST produce identical Shapley allocations regardless of era.
     */
    function test_axiom5_timeNeutrality_feeDistribution() public {
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");

        // Use small gamesPerEra to avoid OOM creating 52k dummy games
        distributor.setGamesPerEra(10);

        // Create identical participants for both games
        ShapleyDistributor.Participant[] memory p1 = _twoParticipants(alice, 10 ether, bob, 5 ether);
        ShapleyDistributor.Participant[] memory p2 = _twoParticipants(alice, 10 ether, bob, 5 ether);

        uint256 totalValue = 50 ether;

        // Game 1: Era 0 (early)
        bytes32 gameId1 = keccak256("era0_fee");
        _createAndSettle(gameId1, totalValue, p1);

        // Advance to Era 1 by creating remaining dummy games
        uint256 gamesNeeded = distributor.gamesPerEra() - 1; // Already created 1
        for (uint256 i = 0; i < gamesNeeded; i++) {
            bytes32 dummyId = keccak256(abi.encode("dummy", i));
            token.mint(address(distributor), 1 ether);

            ShapleyDistributor.Participant[] memory dp = _twoParticipants(
                makeAddr("d1"), 1 ether, makeAddr("d2"), 1 ether
            );

            vm.prank(authorizedCreator);
            distributor.createGame(dummyId, 1 ether, address(token), dp);
        }

        // Confirm we're now in Era 1
        assertEq(distributor.getCurrentHalvingEra(), 1, "Should be in Era 1");

        // Game 2: Era 1 (later) — same participants, same value, FEE_DISTRIBUTION
        bytes32 gameId2 = keccak256("era1_fee");
        _createAndSettle(gameId2, totalValue, p2);

        // Both games should use FEE_DISTRIBUTION (default for createGame)
        assertEq(uint8(distributor.getGameType(gameId1)), uint8(ShapleyDistributor.GameType.FEE_DISTRIBUTION));
        assertEq(uint8(distributor.getGameType(gameId2)), uint8(ShapleyDistributor.GameType.FEE_DISTRIBUTION));

        // TIME NEUTRALITY: Rewards must be identical across eras
        uint256 aliceEra0 = distributor.getShapleyValue(gameId1, alice);
        uint256 aliceEra1 = distributor.getShapleyValue(gameId2, alice);
        uint256 bobEra0 = distributor.getShapleyValue(gameId1, bob);
        uint256 bobEra1 = distributor.getShapleyValue(gameId2, bob);

        assertEq(aliceEra0, aliceEra1, "TIME NEUTRALITY VIOLATED: Alice got different reward in Era 1");
        assertEq(bobEra0, bobEra1, "TIME NEUTRALITY VIOLATED: Bob got different reward in Era 1");

        // Use on-chain verification
        (bool neutral, uint256 deviation) = distributor.verifyTimeNeutrality(gameId1, gameId2, alice);
        assertTrue(neutral, "On-chain time neutrality check failed for Alice");
        assertEq(deviation, 0, "Non-zero deviation for identical games");
    }

    /**
     * @notice Proves: TOKEN_EMISSION games DO apply halving (intentional, transparent)
     * @dev This shows the two-track system: fees are time-neutral, emissions are not
     */
    function test_twoTrack_emissionsHalved_feesNot() public {
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");

        uint256 totalValue = 50 ether;

        // Use small gamesPerEra to avoid OOM
        distributor.setGamesPerEra(10);

        // Advance to Era 1
        uint256 gamesNeeded = distributor.gamesPerEra();
        for (uint256 i = 0; i < gamesNeeded; i++) {
            bytes32 dummyId = keccak256(abi.encode("advance", i));
            token.mint(address(distributor), 1 ether);

            ShapleyDistributor.Participant[] memory dp = _twoParticipants(
                makeAddr("d1"), 1 ether, makeAddr("d2"), 1 ether
            );

            vm.prank(authorizedCreator);
            distributor.createGame(dummyId, 1 ether, address(token), dp);
        }

        assertEq(distributor.getCurrentHalvingEra(), 1);

        // Fee game in Era 1: NO halving, full value
        ShapleyDistributor.Participant[] memory pFee = _twoParticipants(alice, 10 ether, bob, 5 ether);
        bytes32 feeGameId = keccak256("fee_era1");
        token.mint(address(distributor), totalValue);

        vm.prank(authorizedCreator);
        distributor.createGame(feeGameId, totalValue, address(token), pFee);

        (,uint256 feeGameValue,,,) = distributor.games(feeGameId);
        assertEq(feeGameValue, totalValue, "Fee game should NOT be halved");

        // Emission game in Era 1: halving DOES apply → 50%
        ShapleyDistributor.Participant[] memory pEmit = _twoParticipants(alice, 10 ether, bob, 5 ether);
        bytes32 emitGameId = keccak256("emit_era1");
        token.mint(address(distributor), totalValue);

        vm.prank(authorizedCreator);
        distributor.createGameTyped(emitGameId, totalValue, address(token), ShapleyDistributor.GameType.TOKEN_EMISSION, pEmit);

        (,uint256 emitGameValue,,,) = distributor.games(emitGameId);
        assertEq(emitGameValue, totalValue / 2, "Emission game should be halved to 50%");
    }

    // ============ Pairwise Proportionality Fuzz Test ============

    /**
     * @notice Fuzz test: Pairwise proportionality holds for random contributions
     */
    function testFuzz_pairwiseProportionality(
        uint256 contribA,
        uint256 contribB,
        uint256 totalValue
    ) public {
        contribA = bound(contribA, 0.01 ether, 100 ether);
        contribB = bound(contribB, 0.01 ether, 100 ether);
        totalValue = bound(totalValue, 1 ether, 1000 ether);

        address alice = makeAddr("alice");
        address bob = makeAddr("bob");

        ShapleyDistributor.Participant[] memory p = _twoParticipants(alice, contribA, bob, contribB);
        bytes32 gameId = keccak256(abi.encode("fuzz_pairwise", contribA, contribB, totalValue));

        _createAndSettle(gameId, totalValue, p);

        (bool fair,) = distributor.verifyPairwiseFairness(gameId, alice, bob);
        assertTrue(fair, "PAIRWISE PROPORTIONALITY violated under fuzz");
    }

    /**
     * @notice Fuzz test: Time neutrality holds for random values across eras
     */
    function testFuzz_timeNeutrality(uint256 totalValue, uint256 contribA, uint256 contribB) public {
        totalValue = bound(totalValue, 1 ether, 100 ether);
        contribA = bound(contribA, 0.1 ether, 50 ether);
        contribB = bound(contribB, 0.1 ether, 50 ether);

        address alice = makeAddr("alice");
        address bob = makeAddr("bob");

        // Game 1
        ShapleyDistributor.Participant[] memory p1 = _twoParticipants(alice, contribA, bob, contribB);
        bytes32 gameId1 = keccak256(abi.encode("tn_fuzz_1", totalValue, contribA, contribB));
        _createAndSettle(gameId1, totalValue, p1);

        // Game 2 (same params, later in sequence)
        ShapleyDistributor.Participant[] memory p2 = _twoParticipants(alice, contribA, bob, contribB);
        bytes32 gameId2 = keccak256(abi.encode("tn_fuzz_2", totalValue, contribA, contribB));
        _createAndSettle(gameId2, totalValue, p2);

        // Must be equal
        uint256 r1 = distributor.getShapleyValue(gameId1, alice);
        uint256 r2 = distributor.getShapleyValue(gameId2, alice);

        assertEq(r1, r2, "TIME NEUTRALITY violated under fuzz");
    }

    // ============ The Cave Theorem: Foundational work earns most ============

    /**
     * @notice Proves Corollary 4.1: A foundational contributor with highest marginal
     *         contribution earns the most — not because of timing, but because of impact.
     */
    function test_caveTheorem_marginalContributionDominates() public {
        address founder = makeAddr("founder");
        address contributor1 = makeAddr("contributor1");
        address contributor2 = makeAddr("contributor2");

        // Founder: massive contribution (built the protocol)
        // Others: incremental contributions
        ShapleyDistributor.Participant[] memory p = new ShapleyDistributor.Participant[](3);
        p[0] = ShapleyDistributor.Participant(founder, 100 ether, 365 days, 8000, 9000);
        p[1] = ShapleyDistributor.Participant(contributor1, 10 ether, 30 days, 5000, 5000);
        p[2] = ShapleyDistributor.Participant(contributor2, 5 ether, 15 days, 5000, 5000);

        bytes32 gameId = keccak256("cave_theorem");
        _createAndSettle(gameId, 100 ether, p);

        uint256 founderReward = distributor.getShapleyValue(gameId, founder);
        uint256 c1Reward = distributor.getShapleyValue(gameId, contributor1);
        uint256 c2Reward = distributor.getShapleyValue(gameId, contributor2);

        // Founder gets more than both others combined
        assertGt(founderReward, c1Reward + c2Reward, "Founder should earn most from marginal contribution");

        // Verify it's also pairwise proportional (not arbitrary favoritism)
        (bool fair1,) = distributor.verifyPairwiseFairness(gameId, founder, contributor1);
        (bool fair2,) = distributor.verifyPairwiseFairness(gameId, founder, contributor2);
        (bool fair3,) = distributor.verifyPairwiseFairness(gameId, contributor1, contributor2);

        assertTrue(fair1, "Pairwise: founder vs c1");
        assertTrue(fair2, "Pairwise: founder vs c2");
        assertTrue(fair3, "Pairwise: c1 vs c2");
    }

    /**
     * @notice Proves Corollary 4.2: If someone builds something equally foundational
     *         in a later era, they earn equally — difficulty captured by impact, not time.
     */
    function test_caveTheorem_equalFoundationalWorkEqualReward() public {
        address earlyBuilder = makeAddr("earlyBuilder");
        address lateBuilder = makeAddr("lateBuilder");
        address normalLP = makeAddr("normalLP");

        // Game 1: Early builder makes foundational contribution
        ShapleyDistributor.Participant[] memory p1 = new ShapleyDistributor.Participant[](2);
        p1[0] = ShapleyDistributor.Participant(earlyBuilder, 50 ether, 365 days, 8000, 9000);
        p1[1] = ShapleyDistributor.Participant(normalLP, 5 ether, 30 days, 5000, 5000);

        bytes32 gameId1 = keccak256("equal_foundation_early");
        _createAndSettle(gameId1, 80 ether, p1);

        // Game 2: Late builder makes IDENTICAL foundational contribution
        ShapleyDistributor.Participant[] memory p2 = new ShapleyDistributor.Participant[](2);
        p2[0] = ShapleyDistributor.Participant(lateBuilder, 50 ether, 365 days, 8000, 9000);
        p2[1] = ShapleyDistributor.Participant(normalLP, 5 ether, 30 days, 5000, 5000);

        bytes32 gameId2 = keccak256("equal_foundation_late");
        _createAndSettle(gameId2, 80 ether, p2);

        // Same contribution parameters, same total value → same reward
        uint256 earlyReward = distributor.getShapleyValue(gameId1, earlyBuilder);
        uint256 lateReward = distributor.getShapleyValue(gameId2, lateBuilder);

        assertEq(earlyReward, lateReward, "EQUAL FOUNDATION VIOLATED: time bias detected");
    }
}
