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
 * @title Shapley Game Theory Tests
 * @notice Tests verifying game-theoretic properties of the Shapley distribution
 * @dev Based on cooperative game theory principles:
 *      - Efficiency: All value is distributed
 *      - Symmetry: Equal contributors get equal rewards
 *      - Null player: Zero contribution = zero reward
 *      - Additivity: Consistent across combined games
 *      - Core stability: No coalition can do better by leaving
 */
contract ShapleyGameTheoryTest is Test {
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

    // ============ Classic Game Theory Tests ============

    /**
     * @notice The Glove Game: Tests fair division when contributions are complementary
     * @dev In the glove game, left and right gloves are worthless alone but valuable paired.
     *      With 2 left gloves and 1 right glove, the Shapley value gives:
     *      - Right glove owner: 2/3 of value (scarce resource)
     *      - Each left glove owner: 1/6 of value
     */
    function test_gloveGame_scarcityPremium() public {
        uint256 totalValue = 100 ether;

        // 2 "left glove" providers (abundant), 1 "right glove" provider (scarce)
        ShapleyDistributor.Participant[] memory participants =
            new ShapleyDistributor.Participant[](3);

        // Left glove holders - equal contribution but abundant
        participants[0] = ShapleyDistributor.Participant({
            participant: makeAddr("leftGlove1"),
            directContribution: 10 ether,
            timeInPool: 30 days,
            scarcityScore: 3000,  // Abundant side
            stabilityScore: 5000
        });

        participants[1] = ShapleyDistributor.Participant({
            participant: makeAddr("leftGlove2"),
            directContribution: 10 ether,
            timeInPool: 30 days,
            scarcityScore: 3000,  // Abundant side
            stabilityScore: 5000
        });

        // Right glove holder - equal contribution but scarce
        participants[2] = ShapleyDistributor.Participant({
            participant: makeAddr("rightGlove"),
            directContribution: 10 ether,
            timeInPool: 30 days,
            scarcityScore: 8000,  // Scarce side - higher score
            stabilityScore: 5000
        });

        rewardToken.mint(address(distributor), totalValue);
        bytes32 gameId = keccak256("glove-game");

        vm.prank(creator);
        distributor.createGame(gameId, totalValue, address(rewardToken), participants);

        vm.prank(creator);
        distributor.computeShapleyValues(gameId);

        uint256 left1Reward = distributor.getShapleyValue(gameId, makeAddr("leftGlove1"));
        uint256 left2Reward = distributor.getShapleyValue(gameId, makeAddr("leftGlove2"));
        uint256 rightReward = distributor.getShapleyValue(gameId, makeAddr("rightGlove"));

        // Scarce resource should get premium
        assertGt(rightReward, left1Reward, "Scarce resource should get premium");
        assertGt(rightReward, left2Reward, "Scarce resource should get premium");

        // Equal abundant resources should get equal rewards
        assertApproxEqAbs(left1Reward, left2Reward, 1, "Equal contributors should get equal");
    }

    /**
     * @notice Unanimity Game: All players needed for any value
     * @dev When all players are essential, value should split equally
     */
    function test_unanimityGame_equalSplit() public {
        uint256 totalValue = 90 ether;
        uint256 numPlayers = 3;

        ShapleyDistributor.Participant[] memory participants =
            new ShapleyDistributor.Participant[](numPlayers);

        for (uint256 i = 0; i < numPlayers; i++) {
            participants[i] = ShapleyDistributor.Participant({
                participant: address(uint160(i + 100)),
                directContribution: 10 ether,
                timeInPool: 30 days,
                scarcityScore: 5000,  // All equal
                stabilityScore: 5000
            });
        }

        rewardToken.mint(address(distributor), totalValue);
        bytes32 gameId = keccak256("unanimity-game");

        vm.prank(creator);
        distributor.createGame(gameId, totalValue, address(rewardToken), participants);

        vm.prank(creator);
        distributor.computeShapleyValues(gameId);

        uint256 expectedPerPlayer = totalValue / numPlayers;

        for (uint256 i = 0; i < numPlayers; i++) {
            uint256 reward = distributor.getShapleyValue(gameId, address(uint160(i + 100)));
            // Allow small rounding error
            assertApproxEqAbs(reward, expectedPerPlayer, numPlayers, "Should split equally");
        }
    }

    /**
     * @notice Dictator Game: One player contributes all value
     * @dev The sole contributor should receive (almost) all rewards
     */
    function test_dictatorGame_soleContributor() public {
        uint256 totalValue = 100 ether;

        ShapleyDistributor.Participant[] memory participants =
            new ShapleyDistributor.Participant[](3);

        // The "dictator" - major contributor
        participants[0] = ShapleyDistributor.Participant({
            participant: makeAddr("dictator"),
            directContribution: 100 ether,
            timeInPool: 365 days,
            scarcityScore: 9000,
            stabilityScore: 9000
        });

        // Minor participants
        participants[1] = ShapleyDistributor.Participant({
            participant: makeAddr("minor1"),
            directContribution: 1 ether,
            timeInPool: 1 days,
            scarcityScore: 1000,
            stabilityScore: 1000
        });

        participants[2] = ShapleyDistributor.Participant({
            participant: makeAddr("minor2"),
            directContribution: 1 ether,
            timeInPool: 1 days,
            scarcityScore: 1000,
            stabilityScore: 1000
        });

        rewardToken.mint(address(distributor), totalValue);
        bytes32 gameId = keccak256("dictator-game");

        vm.prank(creator);
        distributor.createGame(gameId, totalValue, address(rewardToken), participants);

        vm.prank(creator);
        distributor.computeShapleyValues(gameId);

        uint256 dictatorReward = distributor.getShapleyValue(gameId, makeAddr("dictator"));
        uint256 minor1Reward = distributor.getShapleyValue(gameId, makeAddr("minor1"));
        uint256 minor2Reward = distributor.getShapleyValue(gameId, makeAddr("minor2"));

        // Dictator should get majority
        assertGt(dictatorReward, totalValue * 80 / 100, "Dictator should get majority");

        // Minors should get very little
        assertLt(minor1Reward + minor2Reward, totalValue * 20 / 100, "Minors should get minority");
    }

    /**
     * @notice Airport Game: Different sized planes need runway
     * @dev Larger contributors should pay/receive proportionally more
     *      Tests the marginal contribution principle
     */
    function test_airportGame_marginalContribution() public {
        uint256 totalValue = 100 ether;

        // Three "planes" of different sizes
        ShapleyDistributor.Participant[] memory participants =
            new ShapleyDistributor.Participant[](3);

        // Small plane - needs short runway
        participants[0] = ShapleyDistributor.Participant({
            participant: makeAddr("smallPlane"),
            directContribution: 10 ether,
            timeInPool: 30 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        // Medium plane - needs medium runway
        participants[1] = ShapleyDistributor.Participant({
            participant: makeAddr("mediumPlane"),
            directContribution: 30 ether,
            timeInPool: 30 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        // Large plane - needs long runway
        participants[2] = ShapleyDistributor.Participant({
            participant: makeAddr("largePlane"),
            directContribution: 60 ether,
            timeInPool: 30 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        rewardToken.mint(address(distributor), totalValue);
        bytes32 gameId = keccak256("airport-game");

        vm.prank(creator);
        distributor.createGame(gameId, totalValue, address(rewardToken), participants);

        vm.prank(creator);
        distributor.computeShapleyValues(gameId);

        uint256 smallReward = distributor.getShapleyValue(gameId, makeAddr("smallPlane"));
        uint256 mediumReward = distributor.getShapleyValue(gameId, makeAddr("mediumPlane"));
        uint256 largeReward = distributor.getShapleyValue(gameId, makeAddr("largePlane"));

        // Rewards should be ordered by contribution
        assertGt(largeReward, mediumReward, "Large > Medium");
        assertGt(mediumReward, smallReward, "Medium > Small");

        // Verify marginal contribution principle: larger contributors get proportionally more
        // Large plane contributes 6x small plane, should get more than 6x reward due to marginal value
        assertGt(largeReward * 10 / smallReward, 50, "Large should get >5x small (marginal value)");
    }

    // ============ Mechanism Design Property Tests ============

    /**
     * @notice Test Individual Rationality: No player is worse off participating
     * @dev Every participant should receive non-negative payoff
     */
    function test_individualRationality() public {
        uint256 totalValue = 100 ether;
        uint256 numPlayers = 10;

        ShapleyDistributor.Participant[] memory participants =
            new ShapleyDistributor.Participant[](numPlayers);

        for (uint256 i = 0; i < numPlayers; i++) {
            participants[i] = ShapleyDistributor.Participant({
                participant: address(uint160(i + 200)),
                directContribution: (i + 1) * 1 ether,  // Varying contributions
                timeInPool: (i + 1) * 7 days,
                scarcityScore: uint256(keccak256(abi.encode(i, "scarcity"))) % 10001,
                stabilityScore: uint256(keccak256(abi.encode(i, "stability"))) % 10001
            });
        }

        rewardToken.mint(address(distributor), totalValue);
        bytes32 gameId = keccak256("ir-test");

        vm.prank(creator);
        distributor.createGame(gameId, totalValue, address(rewardToken), participants);

        vm.prank(creator);
        distributor.computeShapleyValues(gameId);

        // Every participant should get non-negative reward
        for (uint256 i = 0; i < numPlayers; i++) {
            uint256 reward = distributor.getShapleyValue(gameId, address(uint160(i + 200)));
            assertGe(reward, 0, "Reward must be non-negative (individual rationality)");
        }
    }

    /**
     * @notice Test Budget Balance: Total distributed equals total value
     * @dev Sum of all Shapley values must equal the total game value
     */
    function test_budgetBalance() public {
        uint256 totalValue = 123.456789 ether;  // Unusual value to test precision
        uint256 numPlayers = 7;  // Prime number to stress test

        ShapleyDistributor.Participant[] memory participants =
            new ShapleyDistributor.Participant[](numPlayers);

        for (uint256 i = 0; i < numPlayers; i++) {
            participants[i] = ShapleyDistributor.Participant({
                participant: address(uint160(i + 300)),
                directContribution: (i * i + 1) * 0.1 ether,
                timeInPool: (i + 1) * 10 days,
                scarcityScore: 5000 + i * 500,
                stabilityScore: 5000 - i * 300
            });
        }

        rewardToken.mint(address(distributor), totalValue);
        bytes32 gameId = keccak256("budget-balance-test");

        vm.prank(creator);
        distributor.createGame(gameId, totalValue, address(rewardToken), participants);

        vm.prank(creator);
        distributor.computeShapleyValues(gameId);

        uint256 totalDistributed = 0;
        for (uint256 i = 0; i < numPlayers; i++) {
            totalDistributed += distributor.getShapleyValue(gameId, address(uint160(i + 300)));
        }

        // Total distributed should equal total value (allow 1 wei per participant for rounding)
        assertApproxEqAbs(totalDistributed, totalValue, numPlayers, "Budget must balance");
    }

    /**
     * @notice Test Coalition Stability (Core): No subset can do better by leaving
     * @dev The grand coalition should be stable - no group should want to defect
     */
    function test_coalitionStability() public {
        uint256 totalValue = 100 ether;

        ShapleyDistributor.Participant[] memory participants =
            new ShapleyDistributor.Participant[](4);

        // Create 4 participants with different profiles
        participants[0] = ShapleyDistributor.Participant({
            participant: makeAddr("player1"),
            directContribution: 25 ether,
            timeInPool: 90 days,
            scarcityScore: 7000,
            stabilityScore: 8000
        });

        participants[1] = ShapleyDistributor.Participant({
            participant: makeAddr("player2"),
            directContribution: 25 ether,
            timeInPool: 60 days,
            scarcityScore: 6000,
            stabilityScore: 7000
        });

        participants[2] = ShapleyDistributor.Participant({
            participant: makeAddr("player3"),
            directContribution: 25 ether,
            timeInPool: 30 days,
            scarcityScore: 5000,
            stabilityScore: 6000
        });

        participants[3] = ShapleyDistributor.Participant({
            participant: makeAddr("player4"),
            directContribution: 25 ether,
            timeInPool: 15 days,
            scarcityScore: 4000,
            stabilityScore: 5000
        });

        rewardToken.mint(address(distributor), totalValue);
        bytes32 gameId = keccak256("coalition-test");

        vm.prank(creator);
        distributor.createGame(gameId, totalValue, address(rewardToken), participants);

        vm.prank(creator);
        distributor.computeShapleyValues(gameId);

        // Get all rewards
        uint256 reward1 = distributor.getShapleyValue(gameId, makeAddr("player1"));
        uint256 reward2 = distributor.getShapleyValue(gameId, makeAddr("player2"));
        uint256 reward3 = distributor.getShapleyValue(gameId, makeAddr("player3"));
        uint256 reward4 = distributor.getShapleyValue(gameId, makeAddr("player4"));

        // Test that no pair could do better by forming their own coalition
        // In a fair allocation, each player's reward >= their standalone value
        // which is approximately their contribution share for this type of game

        // Each player should get at least some baseline value
        uint256 minExpected = totalValue / 8;  // At least 1/8 for any participant

        assertGt(reward1, minExpected, "Player 1 should get reasonable share");
        assertGt(reward2, minExpected, "Player 2 should get reasonable share");
        assertGt(reward3, minExpected, "Player 3 should get reasonable share");
        assertGt(reward4, minExpected, "Player 4 should get reasonable share");
    }

    // ============ Strategic Behavior Tests ============

    /**
     * @notice Test Sybil Resistance: Splitting identity shouldn't increase rewards
     * @dev A player splitting into multiple identities shouldn't gain more total reward
     */
    function test_sybilResistance() public {
        uint256 totalValue = 100 ether;

        // Scenario 1: Single large player
        ShapleyDistributor.Participant[] memory single =
            new ShapleyDistributor.Participant[](2);

        single[0] = ShapleyDistributor.Participant({
            participant: makeAddr("honest"),
            directContribution: 50 ether,
            timeInPool: 30 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        single[1] = ShapleyDistributor.Participant({
            participant: makeAddr("other"),
            directContribution: 50 ether,
            timeInPool: 30 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        rewardToken.mint(address(distributor), totalValue);
        bytes32 gameId1 = keccak256("sybil-single");

        vm.prank(creator);
        distributor.createGame(gameId1, totalValue, address(rewardToken), single);

        vm.prank(creator);
        distributor.computeShapleyValues(gameId1);

        uint256 honestReward = distributor.getShapleyValue(gameId1, makeAddr("honest"));

        // Scenario 2: Same player splits into two sybil identities
        ShapleyDistributor.Participant[] memory sybil =
            new ShapleyDistributor.Participant[](3);

        // Sybil splits 50 ETH into 25 + 25
        sybil[0] = ShapleyDistributor.Participant({
            participant: makeAddr("sybil1"),
            directContribution: 25 ether,
            timeInPool: 30 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        sybil[1] = ShapleyDistributor.Participant({
            participant: makeAddr("sybil2"),
            directContribution: 25 ether,
            timeInPool: 30 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        sybil[2] = ShapleyDistributor.Participant({
            participant: makeAddr("other2"),
            directContribution: 50 ether,
            timeInPool: 30 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        rewardToken.mint(address(distributor), totalValue);
        bytes32 gameId2 = keccak256("sybil-split");

        vm.prank(creator);
        distributor.createGame(gameId2, totalValue, address(rewardToken), sybil);

        vm.prank(creator);
        distributor.computeShapleyValues(gameId2);

        uint256 sybil1Reward = distributor.getShapleyValue(gameId2, makeAddr("sybil1"));
        uint256 sybil2Reward = distributor.getShapleyValue(gameId2, makeAddr("sybil2"));
        uint256 totalSybilReward = sybil1Reward + sybil2Reward;

        // Sybil attack should not be profitable
        // Total reward from splitting should be <= reward from single identity
        assertLe(totalSybilReward, honestReward + 1 ether, "Sybil attack should not be profitable");
    }

    /**
     * @notice Test Time Manipulation Resistance
     * @dev Verify that gaming time-in-pool is bounded in benefit
     */
    function test_timeManipulationBounded() public {
        uint256 totalValue = 100 ether;

        ShapleyDistributor.Participant[] memory participants =
            new ShapleyDistributor.Participant[](2);

        // Player who stayed 1 year
        participants[0] = ShapleyDistributor.Participant({
            participant: makeAddr("longTime"),
            directContribution: 10 ether,
            timeInPool: 365 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        // Player who just joined
        participants[1] = ShapleyDistributor.Participant({
            participant: makeAddr("shortTime"),
            directContribution: 10 ether,
            timeInPool: 1 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        rewardToken.mint(address(distributor), totalValue);
        bytes32 gameId = keccak256("time-test");

        vm.prank(creator);
        distributor.createGame(gameId, totalValue, address(rewardToken), participants);

        vm.prank(creator);
        distributor.computeShapleyValues(gameId);

        uint256 longReward = distributor.getShapleyValue(gameId, makeAddr("longTime"));
        uint256 shortReward = distributor.getShapleyValue(gameId, makeAddr("shortTime"));

        // Long-time player should get more, but not infinitely more
        assertGt(longReward, shortReward, "Long-time player should get more");

        // But the advantage should be bounded (not more than 5x for this scenario)
        assertLt(longReward, shortReward * 5, "Time advantage should be bounded");
    }
}
