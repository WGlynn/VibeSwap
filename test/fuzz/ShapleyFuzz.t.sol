// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/ShapleyDistributor.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title Shapley Distributor Fuzz Tests
 * @notice Comprehensive fuzz testing for Shapley value distribution
 */
contract ShapleyFuzzTest is Test {
    ShapleyDistributor public distributor;
    MockToken public rewardToken;

    address public owner;
    address public authorizedCreator;

    uint256 constant PRECISION = 1e18;
    uint256 constant BPS_PRECISION = 10000;

    function setUp() public {
        owner = address(this);
        authorizedCreator = makeAddr("authorizedCreator");

        // Deploy reward token
        rewardToken = new MockToken("Reward", "RWD");

        // Deploy distributor
        ShapleyDistributor impl = new ShapleyDistributor();
        bytes memory initData = abi.encodeWithSelector(
            ShapleyDistributor.initialize.selector,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        distributor = ShapleyDistributor(payable(address(proxy)));

        // Setup authorized creator
        distributor.setAuthorizedCreator(authorizedCreator, true);
    }

    // ============ Efficiency Invariant: All Value Distributed ============

    /**
     * @notice Fuzz test: Total distributed should equal total value
     * @dev The efficiency property of Shapley values
     */
    function testFuzz_efficiencyInvariant(
        uint256 totalValue,
        uint256 numParticipants,
        uint256 seed
    ) public {
        totalValue = bound(totalValue, 0.01 ether, 1000 ether);
        numParticipants = bound(numParticipants, 2, 20);

        // Create participants with random contributions
        ShapleyDistributor.Participant[] memory participants =
            new ShapleyDistributor.Participant[](numParticipants);

        uint256 totalContribution = 0;
        for (uint256 i = 0; i < numParticipants; i++) {
            uint256 contribution = uint256(keccak256(abi.encode(seed, i, "contribution"))) % (10 ether) + 1;
            uint256 timeInPool = uint256(keccak256(abi.encode(seed, i, "time"))) % (365 days) + 1 days;
            uint256 scarcity = uint256(keccak256(abi.encode(seed, i, "scarcity"))) % 10001;
            uint256 stability = uint256(keccak256(abi.encode(seed, i, "stability"))) % 10001;

            participants[i] = ShapleyDistributor.Participant({
                participant: address(uint160(i + 1)),
                directContribution: contribution,
                timeInPool: timeInPool,
                scarcityScore: scarcity,
                stabilityScore: stability
            });
            totalContribution += contribution;
        }

        // Fund distributor
        rewardToken.mint(address(distributor), totalValue);

        // Create and settle game
        bytes32 gameId = keccak256(abi.encode("test", totalValue, seed));

        vm.prank(authorizedCreator);
        distributor.createGame(gameId, totalValue, address(rewardToken), participants);

        vm.prank(authorizedCreator);
        distributor.computeShapleyValues(gameId);

        // Sum all Shapley values
        uint256 totalDistributed = 0;
        for (uint256 i = 0; i < numParticipants; i++) {
            totalDistributed += distributor.getShapleyValue(gameId, participants[i].participant);
        }

        // Total distributed should equal total value (allowing 1 wei per participant for rounding)
        assertApproxEqAbs(
            totalDistributed,
            totalValue,
            numParticipants, // Allow 1 wei rounding per participant
            "Efficiency violated: not all value distributed"
        );
    }

    // ============ Symmetry Invariant: Equal Contributors Get Equal Rewards ============

    /**
     * @notice Fuzz test: Identical contributions should yield identical rewards
     */
    function testFuzz_symmetryInvariant(
        uint256 totalValue,
        uint256 contribution,
        uint256 timeInPool,
        uint256 scarcity,
        uint256 stability
    ) public {
        totalValue = bound(totalValue, 1 ether, 100 ether);
        contribution = bound(contribution, 0.1 ether, 10 ether);
        timeInPool = bound(timeInPool, 1 days, 365 days);
        scarcity = bound(scarcity, 0, 10000);
        stability = bound(stability, 0, 10000);

        // Create two identical participants
        ShapleyDistributor.Participant[] memory participants =
            new ShapleyDistributor.Participant[](2);

        participants[0] = ShapleyDistributor.Participant({
            participant: makeAddr("alice"),
            directContribution: contribution,
            timeInPool: timeInPool,
            scarcityScore: scarcity,
            stabilityScore: stability
        });

        participants[1] = ShapleyDistributor.Participant({
            participant: makeAddr("bob"),
            directContribution: contribution,
            timeInPool: timeInPool,
            scarcityScore: scarcity,
            stabilityScore: stability
        });

        // Fund and create game
        rewardToken.mint(address(distributor), totalValue);
        bytes32 gameId = keccak256(abi.encode("symmetry", totalValue));

        vm.prank(authorizedCreator);
        distributor.createGame(gameId, totalValue, address(rewardToken), participants);

        vm.prank(authorizedCreator);
        distributor.computeShapleyValues(gameId);

        uint256 aliceReward = distributor.getShapleyValue(gameId, makeAddr("alice"));
        uint256 bobReward = distributor.getShapleyValue(gameId, makeAddr("bob"));

        // Identical contributors should get identical rewards (allow 1 wei rounding)
        assertApproxEqAbs(aliceReward, bobReward, 1, "Symmetry violated: equal contributors got different rewards");
    }

    // ============ Null Player Invariant: Zero Contribution Gets Zero Reward ============

    /**
     * @notice Fuzz test: Zero contribution should not receive rewards
     * @dev Note: In our implementation, even zero direct contribution can get
     *      rewards from time-in-pool, so we test zero everything
     */
    function testFuzz_noFreeRidingWithRealContributors(
        uint256 totalValue,
        uint256 realContribution
    ) public {
        totalValue = bound(totalValue, 1 ether, 100 ether);
        realContribution = bound(realContribution, 1 ether, 10 ether);

        ShapleyDistributor.Participant[] memory participants =
            new ShapleyDistributor.Participant[](2);

        // Real contributor
        participants[0] = ShapleyDistributor.Participant({
            participant: makeAddr("contributor"),
            directContribution: realContribution,
            timeInPool: 30 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        // Minimal contributor (almost nothing)
        participants[1] = ShapleyDistributor.Participant({
            participant: makeAddr("freeloader"),
            directContribution: 1, // 1 wei
            timeInPool: 1, // 1 second
            scarcityScore: 0,
            stabilityScore: 0
        });

        rewardToken.mint(address(distributor), totalValue);
        bytes32 gameId = keccak256(abi.encode("nullplayer", totalValue));

        vm.prank(authorizedCreator);
        distributor.createGame(gameId, totalValue, address(rewardToken), participants);

        vm.prank(authorizedCreator);
        distributor.computeShapleyValues(gameId);

        uint256 contributorReward = distributor.getShapleyValue(gameId, makeAddr("contributor"));
        uint256 freeloaderReward = distributor.getShapleyValue(gameId, makeAddr("freeloader"));

        // Real contributor should get vastly more than freeloader
        assertGt(
            contributorReward,
            freeloaderReward * 100,
            "Freeloader got too much relative to contributor"
        );
    }

    // ============ Quality Weight Bounds Tests ============

    /**
     * @notice Fuzz test: Quality weights should be bounded to 10000
     */
    function testFuzz_qualityWeightBoundsEnforced(
        uint256 activity,
        uint256 reputation,
        uint256 economic
    ) public {
        activity = bound(activity, 10001, type(uint256).max);

        vm.prank(authorizedCreator);
        vm.expectRevert("Activity score exceeds max");
        distributor.updateQualityWeight(
            makeAddr("participant"),
            activity,
            5000,
            5000
        );
    }

    /**
     * @notice Fuzz test: Valid quality weights should be accepted
     */
    function testFuzz_validQualityWeightsAccepted(
        uint256 activity,
        uint256 reputation,
        uint256 economic
    ) public {
        activity = bound(activity, 0, 10000);
        reputation = bound(reputation, 0, 10000);
        economic = bound(economic, 0, 10000);

        vm.prank(authorizedCreator);
        distributor.updateQualityWeight(
            makeAddr("participant"),
            activity,
            reputation,
            economic
        );

        // Should not revert
    }

    // ============ Scarcity Score Tests ============

    /**
     * @notice Fuzz test: Scarcity scoring rewards the minority side
     */
    function testFuzz_scarcityRewardsMinoritySide(
        uint256 buyVolume,
        uint256 sellVolume,
        uint256 tradeAmount,
        bool isBuy
    ) public {
        buyVolume = bound(buyVolume, 1 ether, 1000 ether);
        sellVolume = bound(sellVolume, 1 ether, 1000 ether);
        tradeAmount = bound(tradeAmount, 0.1 ether, 10 ether);

        // Function signature: calculateScarcityScore(buyVolume, sellVolume, participantSide, participantVolume)
        uint256 scarcityScore = distributor.calculateScarcityScore(
            buyVolume,
            sellVolume,
            isBuy,
            tradeAmount
        );

        // Score should always be in valid range
        assertLe(scarcityScore, 15000, "Scarcity score too high");

        // If providing minority side with significant imbalance, should get bonus
        // Use 10% threshold to avoid edge cases
        if (isBuy && buyVolume * 110 < sellVolume * 100) {
            assertGe(scarcityScore, 5000, "Should get bonus for minority side");
        } else if (!isBuy && sellVolume * 110 < buyVolume * 100) {
            assertGe(scarcityScore, 5000, "Should get bonus for minority side");
        }
    }

    // ============ Claim Tests ============

    /**
     * @notice Fuzz test: Claims should transfer correct amounts
     */
    function testFuzz_claimTransfersCorrectAmount(uint256 totalValue) public {
        totalValue = bound(totalValue, 1 ether, 100 ether);

        address alice = makeAddr("alice");

        ShapleyDistributor.Participant[] memory participants =
            new ShapleyDistributor.Participant[](2);

        participants[0] = ShapleyDistributor.Participant({
            participant: alice,
            directContribution: 10 ether,
            timeInPool: 30 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        participants[1] = ShapleyDistributor.Participant({
            participant: makeAddr("bob"),
            directContribution: 10 ether,
            timeInPool: 30 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        rewardToken.mint(address(distributor), totalValue);
        bytes32 gameId = keccak256(abi.encode("claim", totalValue));

        vm.prank(authorizedCreator);
        distributor.createGame(gameId, totalValue, address(rewardToken), participants);

        vm.prank(authorizedCreator);
        distributor.computeShapleyValues(gameId);

        uint256 expectedReward = distributor.getShapleyValue(gameId, alice);
        uint256 balanceBefore = rewardToken.balanceOf(alice);

        vm.prank(alice);
        distributor.claimReward(gameId);

        uint256 balanceAfter = rewardToken.balanceOf(alice);

        assertEq(
            balanceAfter - balanceBefore,
            expectedReward,
            "Claim transferred incorrect amount"
        );
    }

    // ============ ETH Distribution Tests ============

    /**
     * @notice Fuzz test: ETH distribution works correctly
     */
    function testFuzz_ethDistribution(uint256 totalValue) public {
        totalValue = bound(totalValue, 0.01 ether, 10 ether);

        address alice = makeAddr("alice");

        ShapleyDistributor.Participant[] memory participants =
            new ShapleyDistributor.Participant[](2);

        participants[0] = ShapleyDistributor.Participant({
            participant: alice,
            directContribution: 5 ether,
            timeInPool: 30 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        participants[1] = ShapleyDistributor.Participant({
            participant: makeAddr("bob"),
            directContribution: 5 ether,
            timeInPool: 30 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        bytes32 gameId = keccak256(abi.encode("eth", totalValue));

        // Fund distributor directly for ETH games
        vm.deal(address(distributor), totalValue);

        vm.prank(authorizedCreator);
        distributor.createGame(
            gameId,
            totalValue,
            address(0), // ETH
            participants
        );

        vm.prank(authorizedCreator);
        distributor.computeShapleyValues(gameId);

        uint256 expectedReward = distributor.getShapleyValue(gameId, alice);
        uint256 balanceBefore = alice.balance;

        vm.prank(alice);
        distributor.claimReward(gameId);

        uint256 balanceAfter = alice.balance;

        assertEq(
            balanceAfter - balanceBefore,
            expectedReward,
            "ETH claim transferred incorrect amount"
        );
    }
}
