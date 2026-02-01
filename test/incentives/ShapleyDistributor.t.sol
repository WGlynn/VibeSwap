// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/ShapleyDistributor.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ShapleyDistributorTest is Test {
    ShapleyDistributor public distributor;
    MockToken public token;

    address public owner;
    address public alice;
    address public bob;
    address public charlie;
    address public unauthorized;

    bytes32 public constant GAME_ID = keccak256("test-game-1");

    event GameCreated(bytes32 indexed gameId, uint256 totalValue, address token, uint256 participantCount);
    event ShapleyComputed(bytes32 indexed gameId, address indexed participant, uint256 shapleyValue);
    event RewardClaimed(bytes32 indexed gameId, address indexed participant, uint256 amount);

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");
        unauthorized = makeAddr("unauthorized");

        // Deploy token
        token = new MockToken();

        // Deploy distributor with proxy
        ShapleyDistributor impl = new ShapleyDistributor();
        bytes memory initData = abi.encodeWithSelector(
            ShapleyDistributor.initialize.selector,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        distributor = ShapleyDistributor(payable(address(proxy)));

        // Authorize owner as game creator
        distributor.setAuthorizedCreator(owner, true);
    }

    // ============ Initialization Tests ============

    function test_initialize() public view {
        assertEq(distributor.owner(), owner);
        assertEq(distributor.minParticipants(), 2);
        assertEq(distributor.maxParticipants(), 100);
        assertTrue(distributor.useQualityWeights());
    }

    // ============ Game Creation Tests ============

    function test_createGame() public {
        ShapleyDistributor.Participant[] memory participants = _createParticipants();

        token.mint(address(distributor), 100 ether);

        vm.expectEmit(true, false, false, true);
        emit GameCreated(GAME_ID, 100 ether, address(token), 3);

        distributor.createGame(GAME_ID, 100 ether, address(token), participants);

        (bytes32 gameId, uint256 totalValue, address gameToken, bool settled) = distributor.games(GAME_ID);
        assertEq(gameId, GAME_ID);
        assertEq(totalValue, 100 ether);
        assertEq(gameToken, address(token));
        assertFalse(settled);
    }

    function test_createGame_withETH() public {
        ShapleyDistributor.Participant[] memory participants = _createParticipants();

        vm.deal(address(distributor), 10 ether);

        distributor.createGame(GAME_ID, 10 ether, address(0), participants);

        (, uint256 totalValue, address gameToken,) = distributor.games(GAME_ID);
        assertEq(totalValue, 10 ether);
        assertEq(gameToken, address(0));
    }

    function test_createGame_revertUnauthorized() public {
        ShapleyDistributor.Participant[] memory participants = _createParticipants();

        vm.prank(unauthorized);
        vm.expectRevert(ShapleyDistributor.Unauthorized.selector);
        distributor.createGame(GAME_ID, 100 ether, address(token), participants);
    }

    function test_createGame_revertDuplicate() public {
        ShapleyDistributor.Participant[] memory participants = _createParticipants();
        token.mint(address(distributor), 200 ether);

        distributor.createGame(GAME_ID, 100 ether, address(token), participants);

        vm.expectRevert(ShapleyDistributor.GameAlreadyExists.selector);
        distributor.createGame(GAME_ID, 100 ether, address(token), participants);
    }

    function test_createGame_revertZeroValue() public {
        ShapleyDistributor.Participant[] memory participants = _createParticipants();

        vm.expectRevert(ShapleyDistributor.InvalidValue.selector);
        distributor.createGame(GAME_ID, 0, address(token), participants);
    }

    function test_createGame_revertTooFewParticipants() public {
        ShapleyDistributor.Participant[] memory participants = new ShapleyDistributor.Participant[](1);
        participants[0] = ShapleyDistributor.Participant({
            participant: alice,
            directContribution: 100 ether,
            timeInPool: 7 days,
            scarcityScore: 5000,
            stabilityScore: 8000
        });

        vm.expectRevert(ShapleyDistributor.TooFewParticipants.selector);
        distributor.createGame(GAME_ID, 100 ether, address(token), participants);
    }

    // ============ Shapley Computation Tests ============

    function test_computeShapleyValues() public {
        ShapleyDistributor.Participant[] memory participants = _createParticipants();
        token.mint(address(distributor), 100 ether);

        distributor.createGame(GAME_ID, 100 ether, address(token), participants);

        distributor.computeShapleyValues(GAME_ID);

        // Check game is settled
        assertTrue(distributor.isGameSettled(GAME_ID));

        // Check all value is distributed (efficiency property)
        uint256 totalDistributed = distributor.getShapleyValue(GAME_ID, alice)
            + distributor.getShapleyValue(GAME_ID, bob)
            + distributor.getShapleyValue(GAME_ID, charlie);
        assertEq(totalDistributed, 100 ether);
    }

    function test_computeShapleyValues_higherContributionGetsMore() public {
        // Alice contributes 3x more liquidity than Bob
        ShapleyDistributor.Participant[] memory participants = new ShapleyDistributor.Participant[](2);
        participants[0] = ShapleyDistributor.Participant({
            participant: alice,
            directContribution: 300 ether,
            timeInPool: 7 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });
        participants[1] = ShapleyDistributor.Participant({
            participant: bob,
            directContribution: 100 ether,
            timeInPool: 7 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        token.mint(address(distributor), 100 ether);
        distributor.createGame(GAME_ID, 100 ether, address(token), participants);
        distributor.computeShapleyValues(GAME_ID);

        uint256 aliceShare = distributor.getShapleyValue(GAME_ID, alice);
        uint256 bobShare = distributor.getShapleyValue(GAME_ID, bob);

        // Alice should get more (not necessarily 3x due to other factors)
        assertGt(aliceShare, bobShare);
    }

    function test_computeShapleyValues_scarcityBonus() public {
        // Alice on scarce side (high scarcity score), Bob on abundant side
        ShapleyDistributor.Participant[] memory participants = new ShapleyDistributor.Participant[](2);
        participants[0] = ShapleyDistributor.Participant({
            participant: alice,
            directContribution: 100 ether,
            timeInPool: 7 days,
            scarcityScore: 8000,  // High scarcity - on scarce side
            stabilityScore: 5000
        });
        participants[1] = ShapleyDistributor.Participant({
            participant: bob,
            directContribution: 100 ether,
            timeInPool: 7 days,
            scarcityScore: 2000,  // Low scarcity - on abundant side
            stabilityScore: 5000
        });

        token.mint(address(distributor), 100 ether);
        distributor.createGame(GAME_ID, 100 ether, address(token), participants);
        distributor.computeShapleyValues(GAME_ID);

        uint256 aliceShare = distributor.getShapleyValue(GAME_ID, alice);
        uint256 bobShare = distributor.getShapleyValue(GAME_ID, bob);

        // Alice should get more due to scarcity bonus
        assertGt(aliceShare, bobShare);
    }

    function test_computeShapleyValues_stabilityBonus() public {
        // Alice stayed during volatility, Bob didn't
        ShapleyDistributor.Participant[] memory participants = new ShapleyDistributor.Participant[](2);
        participants[0] = ShapleyDistributor.Participant({
            participant: alice,
            directContribution: 100 ether,
            timeInPool: 7 days,
            scarcityScore: 5000,
            stabilityScore: 10000  // Max stability
        });
        participants[1] = ShapleyDistributor.Participant({
            participant: bob,
            directContribution: 100 ether,
            timeInPool: 7 days,
            scarcityScore: 5000,
            stabilityScore: 0      // No stability
        });

        token.mint(address(distributor), 100 ether);
        distributor.createGame(GAME_ID, 100 ether, address(token), participants);
        distributor.computeShapleyValues(GAME_ID);

        uint256 aliceShare = distributor.getShapleyValue(GAME_ID, alice);
        uint256 bobShare = distributor.getShapleyValue(GAME_ID, bob);

        // Alice should get more due to stability
        assertGt(aliceShare, bobShare);
    }

    function test_computeShapleyValues_timeInPoolMatters() public {
        // Alice in pool for 30 days, Bob for 1 day
        ShapleyDistributor.Participant[] memory participants = new ShapleyDistributor.Participant[](2);
        participants[0] = ShapleyDistributor.Participant({
            participant: alice,
            directContribution: 100 ether,
            timeInPool: 30 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });
        participants[1] = ShapleyDistributor.Participant({
            participant: bob,
            directContribution: 100 ether,
            timeInPool: 1 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        token.mint(address(distributor), 100 ether);
        distributor.createGame(GAME_ID, 100 ether, address(token), participants);
        distributor.computeShapleyValues(GAME_ID);

        uint256 aliceShare = distributor.getShapleyValue(GAME_ID, alice);
        uint256 bobShare = distributor.getShapleyValue(GAME_ID, bob);

        // Alice should get more due to longer time (enabling)
        assertGt(aliceShare, bobShare);
    }

    function test_computeShapleyValues_revertNotFound() public {
        bytes32 fakeGame = keccak256("fake");

        vm.expectRevert(ShapleyDistributor.GameNotFound.selector);
        distributor.computeShapleyValues(fakeGame);
    }

    function test_computeShapleyValues_revertAlreadySettled() public {
        ShapleyDistributor.Participant[] memory participants = _createParticipants();
        token.mint(address(distributor), 100 ether);

        distributor.createGame(GAME_ID, 100 ether, address(token), participants);
        distributor.computeShapleyValues(GAME_ID);

        vm.expectRevert(ShapleyDistributor.GameAlreadySettled.selector);
        distributor.computeShapleyValues(GAME_ID);
    }

    // ============ Claim Tests ============

    function test_claimReward() public {
        ShapleyDistributor.Participant[] memory participants = _createParticipants();
        token.mint(address(distributor), 100 ether);

        distributor.createGame(GAME_ID, 100 ether, address(token), participants);
        distributor.computeShapleyValues(GAME_ID);

        uint256 aliceExpected = distributor.getShapleyValue(GAME_ID, alice);
        uint256 balanceBefore = token.balanceOf(alice);

        vm.prank(alice);
        uint256 claimed = distributor.claimReward(GAME_ID);

        assertEq(claimed, aliceExpected);
        assertEq(token.balanceOf(alice), balanceBefore + aliceExpected);
    }

    function test_claimReward_ETH() public {
        ShapleyDistributor.Participant[] memory participants = _createParticipants();
        vm.deal(address(distributor), 10 ether);

        distributor.createGame(GAME_ID, 10 ether, address(0), participants);
        distributor.computeShapleyValues(GAME_ID);

        uint256 aliceExpected = distributor.getShapleyValue(GAME_ID, alice);
        uint256 balanceBefore = alice.balance;

        vm.prank(alice);
        distributor.claimReward(GAME_ID);

        assertEq(alice.balance, balanceBefore + aliceExpected);
    }

    function test_claimReward_revertNotSettled() public {
        ShapleyDistributor.Participant[] memory participants = _createParticipants();
        token.mint(address(distributor), 100 ether);

        distributor.createGame(GAME_ID, 100 ether, address(token), participants);
        // Not calling computeShapleyValues

        vm.prank(alice);
        vm.expectRevert(ShapleyDistributor.GameNotSettled.selector);
        distributor.claimReward(GAME_ID);
    }

    function test_claimReward_revertAlreadyClaimed() public {
        ShapleyDistributor.Participant[] memory participants = _createParticipants();
        token.mint(address(distributor), 100 ether);

        distributor.createGame(GAME_ID, 100 ether, address(token), participants);
        distributor.computeShapleyValues(GAME_ID);

        vm.prank(alice);
        distributor.claimReward(GAME_ID);

        vm.prank(alice);
        vm.expectRevert(ShapleyDistributor.AlreadyClaimed.selector);
        distributor.claimReward(GAME_ID);
    }

    function test_claimReward_revertNoReward() public {
        ShapleyDistributor.Participant[] memory participants = _createParticipants();
        token.mint(address(distributor), 100 ether);

        distributor.createGame(GAME_ID, 100 ether, address(token), participants);
        distributor.computeShapleyValues(GAME_ID);

        // Unauthorized wasn't a participant
        vm.prank(unauthorized);
        vm.expectRevert(ShapleyDistributor.NoReward.selector);
        distributor.claimReward(GAME_ID);
    }

    // ============ Scarcity Score Tests ============

    function test_calculateScarcityScore_balanced() public view {
        // 50/50 buy/sell - neutral
        uint256 score = distributor.calculateScarcityScore(
            100 ether,  // buyVolume
            100 ether,  // sellVolume
            true,       // participantSide (buy)
            10 ether    // participantVolume
        );

        // Should be around 5000 (neutral)
        assertApproxEqAbs(score, 5000, 100);
    }

    function test_calculateScarcityScore_buyHeavy_sellScarce() public view {
        // 80% buy, 20% sell - sell side is scarce
        uint256 sellScore = distributor.calculateScarcityScore(
            80 ether,   // buyVolume
            20 ether,   // sellVolume
            false,      // participantSide (sell = scarce)
            10 ether    // participantVolume
        );

        uint256 buyScore = distributor.calculateScarcityScore(
            80 ether,
            20 ether,
            true,       // participantSide (buy = abundant)
            10 ether
        );

        // Sell side should score higher
        assertGt(sellScore, buyScore);
        assertGt(sellScore, 5000);  // Above neutral
        assertLt(buyScore, 5000);   // Below neutral
    }

    function test_calculateScarcityScore_sellHeavy_buyScarce() public view {
        // 20% buy, 80% sell - buy side is scarce
        uint256 buyScore = distributor.calculateScarcityScore(
            20 ether,   // buyVolume
            80 ether,   // sellVolume
            true,       // participantSide (buy = scarce)
            10 ether
        );

        uint256 sellScore = distributor.calculateScarcityScore(
            20 ether,
            80 ether,
            false,      // participantSide (sell = abundant)
            10 ether
        );

        // Buy side should score higher
        assertGt(buyScore, sellScore);
        assertGt(buyScore, 5000);
        assertLt(sellScore, 5000);
    }

    function test_calculateScarcityScore_largeShareBonus() public view {
        // Provider has 50% of scarce side - should get bonus
        uint256 largeShare = distributor.calculateScarcityScore(
            80 ether,   // buyVolume
            20 ether,   // sellVolume
            false,      // sell side (scarce)
            10 ether    // 50% of sell volume
        );

        uint256 smallShare = distributor.calculateScarcityScore(
            80 ether,
            20 ether,
            false,
            2 ether     // 10% of sell volume
        );

        // Larger share of scarce side should get higher score
        assertGt(largeShare, smallShare);
    }

    // ============ Quality Weight Tests ============

    function test_updateQualityWeight() public {
        distributor.updateQualityWeight(alice, 8000, 7000, 9000);

        (uint256 activity, uint256 reputation, uint256 economic, uint64 lastUpdate) =
            distributor.qualityWeights(alice);

        assertEq(activity, 8000);
        assertEq(reputation, 7000);
        assertEq(economic, 9000);
        assertEq(lastUpdate, uint64(block.timestamp));
    }

    function test_qualityWeight_affectsDistribution() public {
        // Set high quality weight for Alice
        distributor.updateQualityWeight(alice, 10000, 10000, 10000);
        // Set low quality weight for Bob
        distributor.updateQualityWeight(bob, 1000, 1000, 1000);

        // Same direct contributions
        ShapleyDistributor.Participant[] memory participants = new ShapleyDistributor.Participant[](2);
        participants[0] = ShapleyDistributor.Participant({
            participant: alice,
            directContribution: 100 ether,
            timeInPool: 7 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });
        participants[1] = ShapleyDistributor.Participant({
            participant: bob,
            directContribution: 100 ether,
            timeInPool: 7 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        token.mint(address(distributor), 100 ether);
        distributor.createGame(GAME_ID, 100 ether, address(token), participants);
        distributor.computeShapleyValues(GAME_ID);

        uint256 aliceShare = distributor.getShapleyValue(GAME_ID, alice);
        uint256 bobShare = distributor.getShapleyValue(GAME_ID, bob);

        // Alice should get more due to higher quality weights
        assertGt(aliceShare, bobShare);
    }

    function test_qualityWeight_canBeDisabled() public {
        distributor.setUseQualityWeights(false);

        // Set different quality weights
        distributor.updateQualityWeight(alice, 10000, 10000, 10000);
        distributor.updateQualityWeight(bob, 1000, 1000, 1000);

        // Same direct contributions
        ShapleyDistributor.Participant[] memory participants = new ShapleyDistributor.Participant[](2);
        participants[0] = ShapleyDistributor.Participant({
            participant: alice,
            directContribution: 100 ether,
            timeInPool: 7 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });
        participants[1] = ShapleyDistributor.Participant({
            participant: bob,
            directContribution: 100 ether,
            timeInPool: 7 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        token.mint(address(distributor), 100 ether);
        distributor.createGame(GAME_ID, 100 ether, address(token), participants);
        distributor.computeShapleyValues(GAME_ID);

        uint256 aliceShare = distributor.getShapleyValue(GAME_ID, alice);
        uint256 bobShare = distributor.getShapleyValue(GAME_ID, bob);

        // Should be equal when quality weights disabled
        assertEq(aliceShare, bobShare);
    }

    // ============ View Function Tests ============

    function test_getPendingReward() public {
        ShapleyDistributor.Participant[] memory participants = _createParticipants();
        token.mint(address(distributor), 100 ether);

        distributor.createGame(GAME_ID, 100 ether, address(token), participants);

        // Before settlement
        assertEq(distributor.getPendingReward(GAME_ID, alice), 0);

        distributor.computeShapleyValues(GAME_ID);

        // After settlement
        uint256 pending = distributor.getPendingReward(GAME_ID, alice);
        assertGt(pending, 0);

        // After claim
        vm.prank(alice);
        distributor.claimReward(GAME_ID);
        assertEq(distributor.getPendingReward(GAME_ID, alice), 0);
    }

    function test_getGameParticipants() public {
        ShapleyDistributor.Participant[] memory participants = _createParticipants();
        token.mint(address(distributor), 100 ether);

        distributor.createGame(GAME_ID, 100 ether, address(token), participants);

        ShapleyDistributor.Participant[] memory retrieved = distributor.getGameParticipants(GAME_ID);

        assertEq(retrieved.length, 3);
        assertEq(retrieved[0].participant, alice);
        assertEq(retrieved[1].participant, bob);
        assertEq(retrieved[2].participant, charlie);
    }

    // ============ Admin Tests ============

    function test_setAuthorizedCreator() public {
        address newCreator = makeAddr("newCreator");

        assertFalse(distributor.authorizedCreators(newCreator));

        distributor.setAuthorizedCreator(newCreator, true);
        assertTrue(distributor.authorizedCreators(newCreator));

        distributor.setAuthorizedCreator(newCreator, false);
        assertFalse(distributor.authorizedCreators(newCreator));
    }

    function test_setParticipantLimits() public {
        distributor.setParticipantLimits(5, 50);

        assertEq(distributor.minParticipants(), 5);
        assertEq(distributor.maxParticipants(), 50);
    }

    // ============ The Glove Game Test ============
    // This is the key insight: neither left nor right glove alone has value
    // Value only exists through cooperation

    function test_gloveGame_equalSplit() public {
        // Two participants with identical contributions
        // Like left glove + right glove = pair worth $10
        // Shapley says split $5 each

        ShapleyDistributor.Participant[] memory participants = new ShapleyDistributor.Participant[](2);
        participants[0] = ShapleyDistributor.Participant({
            participant: alice,  // "Left glove"
            directContribution: 100 ether,
            timeInPool: 7 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });
        participants[1] = ShapleyDistributor.Participant({
            participant: bob,    // "Right glove"
            directContribution: 100 ether,
            timeInPool: 7 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        // Disable quality weights for pure test
        distributor.setUseQualityWeights(false);

        token.mint(address(distributor), 100 ether);
        distributor.createGame(GAME_ID, 100 ether, address(token), participants);
        distributor.computeShapleyValues(GAME_ID);

        uint256 aliceShare = distributor.getShapleyValue(GAME_ID, alice);
        uint256 bobShare = distributor.getShapleyValue(GAME_ID, bob);

        // Equal contributors get equal shares (symmetry property)
        assertEq(aliceShare, bobShare);
        assertEq(aliceShare, 50 ether);

        // All value distributed (efficiency property)
        assertEq(aliceShare + bobShare, 100 ether);
    }

    // ============ Helpers ============

    function _createParticipants() internal view returns (ShapleyDistributor.Participant[] memory) {
        ShapleyDistributor.Participant[] memory participants = new ShapleyDistributor.Participant[](3);

        participants[0] = ShapleyDistributor.Participant({
            participant: alice,
            directContribution: 100 ether,
            timeInPool: 7 days,
            scarcityScore: 6000,
            stabilityScore: 8000
        });

        participants[1] = ShapleyDistributor.Participant({
            participant: bob,
            directContribution: 50 ether,
            timeInPool: 14 days,
            scarcityScore: 5000,
            stabilityScore: 5000
        });

        participants[2] = ShapleyDistributor.Participant({
            participant: charlie,
            directContribution: 75 ether,
            timeInPool: 3 days,
            scarcityScore: 4000,
            stabilityScore: 9000
        });

        return participants;
    }
}
