// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/incentives/ShapleyDistributor.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Token ============

contract MockRewardToken is ERC20 {
    constructor() ERC20("Reward", "RWD") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ ShapleyDistributor Unit Tests ============

contract ShapleyDistributorTest is Test {
    ShapleyDistributor public distributor;
    MockRewardToken public token;

    address public owner;
    address public creator;
    address public alice;
    address public bob;
    address public carol;

    bytes32 constant GAME_1 = keccak256("game1");
    bytes32 constant GAME_2 = keccak256("game2");

    event GameCreated(bytes32 indexed gameId, uint256 totalValue, address token, uint256 participantCount);
    event ShapleyComputed(bytes32 indexed gameId, address indexed participant, uint256 shapleyValue);
    event RewardClaimed(bytes32 indexed gameId, address indexed participant, uint256 amount);
    event AuthorizedCreatorUpdated(address indexed creator, bool authorized);
    event QualityWeightUpdated(address indexed participant, uint256 activity, uint256 reputation, uint256 economic);
    event HalvingToggled(bool enabled);

    function setUp() public {
        owner = address(this);
        creator = makeAddr("creator");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");

        token = new MockRewardToken();

        ShapleyDistributor impl = new ShapleyDistributor();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(ShapleyDistributor.initialize.selector, owner)
        );
        distributor = ShapleyDistributor(payable(address(proxy)));

        // Authorize creator
        distributor.setAuthorizedCreator(creator, true);
    }

    // ============ Helper: Build participants ============

    function _makeParticipants2(
        address p1, uint256 contrib1,
        address p2, uint256 contrib2
    ) internal pure returns (ShapleyDistributor.Participant[] memory) {
        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](2);
        ps[0] = ShapleyDistributor.Participant({
            participant: p1,
            directContribution: contrib1,
            timeInPool: 7 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });
        ps[1] = ShapleyDistributor.Participant({
            participant: p2,
            directContribution: contrib2,
            timeInPool: 7 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });
        return ps;
    }

    function _makeParticipants3(
        address p1, address p2, address p3
    ) internal pure returns (ShapleyDistributor.Participant[] memory) {
        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](3);
        ps[0] = ShapleyDistributor.Participant({ participant: p1, directContribution: 100 ether, timeInPool: 30 days, scarcityScore: 7000, stabilityScore: 8000 });
        ps[1] = ShapleyDistributor.Participant({ participant: p2, directContribution: 200 ether, timeInPool: 14 days, scarcityScore: 5000, stabilityScore: 5000 });
        ps[2] = ShapleyDistributor.Participant({ participant: p3, directContribution: 50 ether,  timeInPool: 3 days,  scarcityScore: 3000, stabilityScore: 4000 });
        return ps;
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(distributor.minParticipants(), 2);
        assertEq(distributor.maxParticipants(), 100);
        assertTrue(distributor.useQualityWeights());
        assertTrue(distributor.halvingEnabled());
        assertEq(distributor.gamesPerEra(), 52560);
        assertEq(distributor.getCurrentHalvingEra(), 0);
        assertFalse(distributor.bondingCurveSealed());
    }

    // ============ Authorization ============

    function test_setAuthorizedCreator_ownerOnly() public {
        // creator was authorized in setUp
        assertTrue(distributor.authorizedCreators(creator));

        // Non-owner cannot authorize
        vm.prank(alice);
        vm.expectRevert();
        distributor.setAuthorizedCreator(alice, true);
    }

    function test_createGame_unauthorizedReverts() public {
        uint256 value = 1 ether;
        vm.deal(address(distributor), value);

        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, bob, 100 ether);

        vm.prank(alice); // not authorized
        vm.expectRevert(ShapleyDistributor.Unauthorized.selector);
        distributor.createGame(GAME_1, value, address(0), ps);
    }

    // ============ createGame — ETH ============

    function test_createGame_eth_success() public {
        uint256 value = 1 ether;
        vm.deal(address(distributor), value);

        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, bob, 100 ether);

        vm.prank(creator);
        vm.expectEmit(true, false, false, true);
        emit GameCreated(GAME_1, value, address(0), 2);
        distributor.createGame(GAME_1, value, address(0), ps);

        (bytes32 gId, uint256 totalVal, address tok, , bool settled) = distributor.games(GAME_1);
        assertEq(gId, GAME_1);
        assertEq(totalVal, value);
        assertEq(tok, address(0));
        assertFalse(settled);
    }

    function test_createGame_insufficientETHReverts() public {
        // No ETH in contract
        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, bob, 100 ether);

        vm.prank(creator);
        vm.expectRevert("Insufficient ETH for game");
        distributor.createGame(GAME_1, 1 ether, address(0), ps);
    }

    function test_createGame_duplicateGameReverts() public {
        uint256 value = 1 ether;
        vm.deal(address(distributor), value * 2);

        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, bob, 100 ether);

        vm.prank(creator);
        distributor.createGame(GAME_1, value, address(0), ps);

        vm.prank(creator);
        vm.expectRevert(ShapleyDistributor.GameAlreadyExists.selector);
        distributor.createGame(GAME_1, value, address(0), ps);
    }

    function test_createGame_zeroValueReverts() public {
        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, bob, 100 ether);
        vm.prank(creator);
        vm.expectRevert(ShapleyDistributor.InvalidValue.selector);
        distributor.createGame(GAME_1, 0, address(0), ps);
    }

    function test_createGame_tooFewParticipantsReverts() public {
        vm.deal(address(distributor), 1 ether);
        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](1);
        ps[0] = ShapleyDistributor.Participant({ participant: alice, directContribution: 100 ether, timeInPool: 1 days, scarcityScore: 5000, stabilityScore: 5000 });

        vm.prank(creator);
        vm.expectRevert(ShapleyDistributor.TooFewParticipants.selector);
        distributor.createGame(GAME_1, 1 ether, address(0), ps);
    }

    function test_createGame_duplicateParticipantReverts() public {
        vm.deal(address(distributor), 1 ether);
        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, alice, 50 ether);

        vm.prank(creator);
        vm.expectRevert("Duplicate participant");
        distributor.createGame(GAME_1, 1 ether, address(0), ps);
    }

    function test_createGame_scarcityScoreExceedsBPSReverts() public {
        vm.deal(address(distributor), 1 ether);
        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](2);
        ps[0] = ShapleyDistributor.Participant({ participant: alice, directContribution: 100 ether, timeInPool: 1 days, scarcityScore: 10001, stabilityScore: 5000 });
        ps[1] = ShapleyDistributor.Participant({ participant: bob, directContribution: 100 ether, timeInPool: 1 days, scarcityScore: 5000, stabilityScore: 5000 });

        vm.prank(creator);
        vm.expectRevert("Scarcity score exceeds 10000");
        distributor.createGame(GAME_1, 1 ether, address(0), ps);
    }

    // ============ createGame — ERC20 ============

    function test_createGame_erc20_success() public {
        uint256 value = 500e18;
        token.mint(address(distributor), value);

        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, bob, 200 ether);

        vm.prank(creator);
        distributor.createGame(GAME_1, value, address(token), ps);

        (, uint256 totalVal, address tok, , ) = distributor.games(GAME_1);
        assertEq(totalVal, value);
        assertEq(tok, address(token));
    }

    function test_createGame_erc20_insufficientTokensReverts() public {
        // Only 100 tokens but requesting 500
        token.mint(address(distributor), 100e18);

        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, bob, 200 ether);

        vm.prank(creator);
        vm.expectRevert("Insufficient tokens for game");
        distributor.createGame(GAME_1, 500e18, address(token), ps);
    }

    // ============ computeShapleyValues + claimReward — Full Lifecycle ============

    function test_fullLifecycle_eth() public {
        uint256 value = 10 ether;
        vm.deal(address(distributor), value);

        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, bob, 100 ether);

        vm.prank(creator);
        distributor.createGame(GAME_1, value, address(0), ps);

        // Settle
        distributor.computeShapleyValues(GAME_1);
        assertTrue(distributor.isGameSettled(GAME_1));

        // Both participants should have non-zero Shapley values
        uint256 aliceVal = distributor.getShapleyValue(GAME_1, alice);
        uint256 bobVal = distributor.getShapleyValue(GAME_1, bob);
        assertGt(aliceVal, 0);
        assertGt(bobVal, 0);

        // Efficiency: sum == total value
        assertEq(aliceVal + bobVal, value);

        // Claim
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit RewardClaimed(GAME_1, alice, aliceVal);
        distributor.claimReward(GAME_1);
        assertEq(alice.balance, aliceBefore + aliceVal);

        // Double-claim reverts
        vm.prank(alice);
        vm.expectRevert(ShapleyDistributor.AlreadyClaimed.selector);
        distributor.claimReward(GAME_1);
    }

    function test_fullLifecycle_erc20() public {
        uint256 value = 1000e18;
        token.mint(address(distributor), value);

        ShapleyDistributor.Participant[] memory ps = _makeParticipants3(alice, bob, carol);

        vm.prank(creator);
        distributor.createGame(GAME_1, value, address(token), ps);

        distributor.computeShapleyValues(GAME_1);
        assertTrue(distributor.isGameSettled(GAME_1));

        uint256 aVal = distributor.getShapleyValue(GAME_1, alice);
        uint256 bVal = distributor.getShapleyValue(GAME_1, bob);
        uint256 cVal = distributor.getShapleyValue(GAME_1, carol);

        // Efficiency
        assertEq(aVal + bVal + cVal, value);

        // All non-zero (each has contribution)
        assertGt(aVal, 0);
        assertGt(bVal, 0);
        assertGt(cVal, 0);

        // bob (200 ether direct) earns more than alice (100 ether direct)
        assertGt(bVal, aVal);

        // Claim all
        vm.prank(alice); distributor.claimReward(GAME_1);
        vm.prank(bob);   distributor.claimReward(GAME_1);
        vm.prank(carol); distributor.claimReward(GAME_1);

        assertEq(token.balanceOf(alice), aVal);
        assertEq(token.balanceOf(bob),   bVal);
        assertEq(token.balanceOf(carol), cVal);
    }

    // ============ computeShapleyValues — Error Cases ============

    function test_computeShapley_gameNotFoundReverts() public {
        vm.expectRevert(ShapleyDistributor.GameNotFound.selector);
        distributor.computeShapleyValues(GAME_1);
    }

    function test_computeShapley_alreadySettledReverts() public {
        uint256 value = 1 ether;
        vm.deal(address(distributor), value);

        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, bob, 100 ether);
        vm.prank(creator);
        distributor.createGame(GAME_1, value, address(0), ps);

        distributor.computeShapleyValues(GAME_1);

        vm.expectRevert(ShapleyDistributor.GameAlreadySettled.selector);
        distributor.computeShapleyValues(GAME_1);
    }

    // ============ claimReward — Error Cases ============

    function test_claimReward_gameNotFoundReverts() public {
        vm.prank(alice);
        vm.expectRevert(ShapleyDistributor.GameNotFound.selector);
        distributor.claimReward(GAME_1);
    }

    function test_claimReward_gameNotSettledReverts() public {
        uint256 value = 1 ether;
        vm.deal(address(distributor), value);

        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, bob, 100 ether);
        vm.prank(creator);
        distributor.createGame(GAME_1, value, address(0), ps);

        vm.prank(alice);
        vm.expectRevert(ShapleyDistributor.GameNotSettled.selector);
        distributor.claimReward(GAME_1);
    }

    function test_claimReward_noRewardReverts() public {
        uint256 value = 1 ether;
        vm.deal(address(distributor), value);

        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, bob, 100 ether);
        vm.prank(creator);
        distributor.createGame(GAME_1, value, address(0), ps);

        distributor.computeShapleyValues(GAME_1);

        // Carol is not a participant
        vm.prank(carol);
        vm.expectRevert(ShapleyDistributor.NoReward.selector);
        distributor.claimReward(GAME_1);
    }

    // ============ Lawson Fairness Floor ============

    function test_lawsonFloor_smallContributorGetsMinimum() public {
        uint256 value = 100 ether;
        vm.deal(address(distributor), value);

        // Alice contributes 99% of direct, bob contributes 1% (tiny)
        ShapleyDistributor.Participant[] memory ps = new ShapleyDistributor.Participant[](2);
        ps[0] = ShapleyDistributor.Participant({ participant: alice, directContribution: 9900 ether, timeInPool: 1 days, scarcityScore: 5000, stabilityScore: 5000 });
        ps[1] = ShapleyDistributor.Participant({ participant: bob,   directContribution: 1 ether,   timeInPool: 1 days, scarcityScore: 5000, stabilityScore: 5000 });

        vm.prank(creator);
        distributor.createGame(GAME_1, value, address(0), ps);

        distributor.computeShapleyValues(GAME_1);

        uint256 bobVal = distributor.getShapleyValue(GAME_1, bob);
        uint256 floorAmount = (value * 100) / 10000; // 1% = 1 ether

        // Bob's share should be at least the floor
        assertGe(bobVal, floorAmount);
    }

    // ============ Quality Weights ============

    function test_qualityWeights_updateAndEffect() public {
        // Set quality weights for alice (high quality)
        vm.expectEmit(true, false, false, true);
        emit QualityWeightUpdated(alice, 9000, 8000, 9500);
        distributor.updateQualityWeight(alice, 9000, 8000, 9500);

        (uint256 act, uint256 rep, uint256 eco, uint64 ts) = distributor.qualityWeights(alice);
        assertEq(act, 9000);
        assertEq(rep, 8000);
        assertEq(eco, 9500);
        assertGt(ts, 0);

        // Create game with alice having same direct contribution as bob but higher quality
        uint256 value = 10 ether;
        vm.deal(address(distributor), value);

        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, bob, 100 ether);
        vm.prank(creator);
        distributor.createGame(GAME_1, value, address(0), ps);
        distributor.computeShapleyValues(GAME_1);

        // alice (high quality weight) should earn more than bob (no quality weight)
        assertGt(distributor.getShapleyValue(GAME_1, alice), distributor.getShapleyValue(GAME_1, bob));
    }

    function test_qualityWeights_scoreExceedsBPSReverts() public {
        vm.expectRevert(ShapleyDistributor.ScoreExceedsMax.selector);
        distributor.updateQualityWeight(alice, 10001, 5000, 5000);
    }

    function test_qualityWeights_disabledMakesEqual() public {
        // Disable quality weights
        distributor.setUseQualityWeights(false);
        assertFalse(distributor.useQualityWeights());

        // Give alice high quality (should be ignored)
        distributor.updateQualityWeight(alice, 9999, 9999, 9999);

        uint256 value = 10 ether;
        vm.deal(address(distributor), value);

        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, bob, 100 ether);
        vm.prank(creator);
        distributor.createGame(GAME_1, value, address(0), ps);
        distributor.computeShapleyValues(GAME_1);

        // With equal contributions and no quality weights, values should be equal
        assertEq(
            distributor.getShapleyValue(GAME_1, alice),
            distributor.getShapleyValue(GAME_1, bob)
        );
    }

    // ============ Halving Mechanics ============

    function test_halvingEra_era0_returns100Percent() public view {
        assertEq(distributor.getCurrentHalvingEra(), 0);
        assertEq(distributor.getEmissionMultiplier(0), 1e18); // 100%
    }

    function test_halvingEra_era1_returns50Percent() public view {
        assertEq(distributor.getEmissionMultiplier(1), 0.5e18); // 50%
    }

    function test_halvingEra_era2_returns25Percent() public view {
        assertEq(distributor.getEmissionMultiplier(2), 0.25e18); // 25%
    }

    function test_halvingEra_maxEra_returnsZero() public view {
        assertEq(distributor.getEmissionMultiplier(32), 0);
    }

    function test_tokenEmission_halvingReducesValue() public {
        // Accelerate to era 1 by creating gamesPerEra games first
        distributor.setGamesPerEra(2); // 2 games per era for fast testing

        uint256 valuePerGame = 0.1 ether;
        vm.deal(address(distributor), 10 ether);

        // Create 2 FEE_DISTRIBUTION games to exhaust era 0
        for (uint256 i = 0; i < 2; i++) {
            ShapleyDistributor.Participant[] memory ps = _makeParticipants2(
                address(uint160(i * 2 + 1)), 100 ether,
                address(uint160(i * 2 + 2)), 100 ether
            );
            bytes32 gId = keccak256(abi.encodePacked("warmup", i));
            vm.prank(creator);
            distributor.createGame(gId, valuePerGame, address(0), ps);
        }

        // Now in era 1
        assertEq(distributor.getCurrentHalvingEra(), 1);

        // Create a TOKEN_EMISSION game — value should be halved
        uint256 nominalValue = 1 ether;
        ShapleyDistributor.Participant[] memory ps2 = _makeParticipants2(alice, 100 ether, bob, 100 ether);
        bytes32 halvingGame = keccak256("halvingGame");
        vm.prank(creator);
        distributor.createGameTyped(halvingGame, nominalValue, address(0), ShapleyDistributor.GameType.TOKEN_EMISSION, ps2);

        (, uint256 storedValue, , , ) = distributor.games(halvingGame);
        // Era 1 => 50% emission multiplier => stored value = nominalValue / 2
        assertEq(storedValue, nominalValue / 2);
    }

    function test_feeDistribution_halvingDoesNotApply() public {
        distributor.setGamesPerEra(2);

        uint256 valuePerGame = 0.1 ether;
        vm.deal(address(distributor), 10 ether);

        // Exhaust era 0
        for (uint256 i = 0; i < 2; i++) {
            ShapleyDistributor.Participant[] memory ps = _makeParticipants2(
                address(uint160(i * 2 + 1)), 100 ether,
                address(uint160(i * 2 + 2)), 100 ether
            );
            bytes32 gId = keccak256(abi.encodePacked("warmup2", i));
            vm.prank(creator);
            distributor.createGame(gId, valuePerGame, address(0), ps);
        }

        assertEq(distributor.getCurrentHalvingEra(), 1);

        // FEE_DISTRIBUTION game — value must NOT be halved
        uint256 nominalValue = 1 ether;
        ShapleyDistributor.Participant[] memory ps2 = _makeParticipants2(alice, 100 ether, bob, 100 ether);
        bytes32 feeGame = keccak256("feeGame");
        vm.prank(creator);
        distributor.createGame(feeGame, nominalValue, address(0), ps2); // createGame defaults to FEE_DISTRIBUTION

        (, uint256 storedValue, , , ) = distributor.games(feeGame);
        assertEq(storedValue, nominalValue); // No halving for fee distribution
    }

    function test_halvingInfo() public view {
        (uint8 era, uint256 multiplier, uint256 multiplierBps, , uint256 totalGames) = distributor.getHalvingInfo();
        assertEq(era, 0);
        assertEq(multiplier, 1e18);
        assertEq(multiplierBps, 10000);
        assertEq(totalGames, 0);
    }

    function test_gamesUntilNextHalving() public view {
        uint256 remaining = distributor.gamesUntilNextHalving();
        assertEq(remaining, 52560); // DEFAULT_GAMES_PER_ERA
    }

    function test_halvingToggle() public {
        vm.expectEmit(false, false, false, true);
        emit HalvingToggled(false);
        distributor.setHalvingEnabled(false);
        assertFalse(distributor.halvingEnabled());
    }

    // ============ calculateScarcityScore ============

    function test_scarcityScore_neutral() public view {
        // In a balanced market (buy==sell), base score is 5000.
        // But the bonus applies: share of scarce side (50/100 = 50%) adds 500.
        uint256 score = distributor.calculateScarcityScore(100 ether, 100 ether, true, 50 ether);
        assertEq(score, 5500); // 5000 base + 500 bonus (50% of scarce side)
    }

    function test_scarcityScore_buyHeavy_sellSideIsScarce() public view {
        // 80% buy, 20% sell → sell side is scarce
        uint256 scarceScore = distributor.calculateScarcityScore(80 ether, 20 ether, false, 10 ether); // sell side
        uint256 abundantScore = distributor.calculateScarcityScore(80 ether, 20 ether, true, 40 ether); // buy side
        assertGt(scarceScore, 5000);
        assertLt(abundantScore, 5000);
    }

    function test_scarcityScore_zeroVolume_returnsNeutral() public view {
        uint256 score = distributor.calculateScarcityScore(0, 0, true, 0);
        assertEq(score, 5000);
    }

    function test_scarcityScore_capAt10000() public view {
        // Extreme imbalance + large share of scarce side
        uint256 score = distributor.calculateScarcityScore(9999 ether, 1 ether, false, 1 ether);
        assertLe(score, 10000);
    }

    // ============ Pairwise Fairness Verification ============

    function test_verifyPairwiseFairness_settledGame() public {
        uint256 value = 10 ether;
        vm.deal(address(distributor), value);

        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, bob, 300 ether);
        vm.prank(creator);
        distributor.createGame(GAME_1, value, address(0), ps);
        distributor.computeShapleyValues(GAME_1);

        (bool fair, ) = distributor.verifyPairwiseFairness(GAME_1, alice, bob);
        assertTrue(fair);
    }

    // ============ commitBalance Tracking ============

    function test_committedBalance_decreasesOnClaim() public {
        uint256 value = 2 ether;
        vm.deal(address(distributor), value);

        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, bob, 100 ether);
        vm.prank(creator);
        distributor.createGame(GAME_1, value, address(0), ps);

        assertEq(distributor.totalCommittedBalance(address(0)), value);

        distributor.computeShapleyValues(GAME_1);

        uint256 aliceVal = distributor.getShapleyValue(GAME_1, alice);
        vm.prank(alice);
        distributor.claimReward(GAME_1);

        assertEq(distributor.totalCommittedBalance(address(0)), value - aliceVal);
    }

    function test_concurrentGames_preventOverdraw() public {
        uint256 value = 1 ether;
        vm.deal(address(distributor), value); // Only enough for one game

        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, bob, 100 ether);
        ShapleyDistributor.Participant[] memory ps2 = _makeParticipants2(alice, 100 ether, carol, 100 ether);

        // First game succeeds
        vm.prank(creator);
        distributor.createGame(GAME_1, value, address(0), ps);

        // Second game with same amount fails (committed balance blocks it)
        vm.prank(creator);
        vm.expectRevert("Insufficient ETH for game");
        distributor.createGame(GAME_2, value, address(0), ps2);
    }

    // ============ View Functions ============

    function test_getPendingReward_beforeSettlement() public {
        uint256 value = 1 ether;
        vm.deal(address(distributor), value);

        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, bob, 100 ether);
        vm.prank(creator);
        distributor.createGame(GAME_1, value, address(0), ps);

        // Before settlement, pending = 0
        assertEq(distributor.getPendingReward(GAME_1, alice), 0);

        distributor.computeShapleyValues(GAME_1);

        // After settlement, pending = shapleyValue
        assertEq(distributor.getPendingReward(GAME_1, alice), distributor.getShapleyValue(GAME_1, alice));
    }

    function test_getPendingReward_afterClaim_returnsZero() public {
        uint256 value = 1 ether;
        vm.deal(address(distributor), value);

        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, bob, 100 ether);
        vm.prank(creator);
        distributor.createGame(GAME_1, value, address(0), ps);
        distributor.computeShapleyValues(GAME_1);

        vm.prank(alice);
        distributor.claimReward(GAME_1);

        assertEq(distributor.getPendingReward(GAME_1, alice), 0);
    }

    function test_getGameParticipants() public {
        uint256 value = 1 ether;
        vm.deal(address(distributor), value);

        ShapleyDistributor.Participant[] memory ps = _makeParticipants3(alice, bob, carol);
        vm.prank(creator);
        distributor.createGame(GAME_1, value, address(0), ps);

        ShapleyDistributor.Participant[] memory stored = distributor.getGameParticipants(GAME_1);
        assertEq(stored.length, 3);
        assertEq(stored[0].participant, alice);
        assertEq(stored[1].participant, bob);
        assertEq(stored[2].participant, carol);
    }

    function test_getGameType_feeDistribution() public {
        uint256 value = 1 ether;
        vm.deal(address(distributor), value);

        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, bob, 100 ether);
        vm.prank(creator);
        distributor.createGame(GAME_1, value, address(0), ps);

        assertEq(uint256(distributor.getGameType(GAME_1)), uint256(ShapleyDistributor.GameType.FEE_DISTRIBUTION));
    }

    // ============ Admin: setParticipantLimits ============

    function test_setParticipantLimits() public {
        distributor.setParticipantLimits(3, 50);
        assertEq(distributor.minParticipants(), 3);
        assertEq(distributor.maxParticipants(), 50);

        // Now 2 participants should fail
        vm.deal(address(distributor), 1 ether);
        ShapleyDistributor.Participant[] memory ps = _makeParticipants2(alice, 100 ether, bob, 100 ether);
        vm.prank(creator);
        vm.expectRevert(ShapleyDistributor.TooFewParticipants.selector);
        distributor.createGame(GAME_1, 1 ether, address(0), ps);
    }

    // ============ Admin: onlyOwner checks ============

    function test_adminFunctions_onlyOwner() public {
        vm.startPrank(alice);

        vm.expectRevert();
        distributor.setAuthorizedCreator(bob, true);

        vm.expectRevert();
        distributor.setParticipantLimits(1, 200);

        vm.expectRevert();
        distributor.setUseQualityWeights(false);

        vm.expectRevert();
        distributor.setHalvingEnabled(false);

        vm.expectRevert();
        distributor.setGamesPerEra(100);

        vm.stopPrank();
    }
}
