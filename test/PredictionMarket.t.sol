// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/mechanism/PredictionMarket.sol";

// ============ Mock Token ============

contract MockPMToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount);
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount);
        require(allowance[from][msg.sender] >= amount);
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        return true;
    }
}

// ============ Test Contract ============

contract PredictionMarketTest is Test {
    PredictionMarket public pm;
    MockPMToken public collateral;

    address public owner;
    address public treasuryAddr;
    address public creator;
    address public resolver;
    address public alice;
    address public bob;

    uint256 constant LIQUIDITY = 100 ether;

    function setUp() public {
        owner = makeAddr("owner");
        treasuryAddr = makeAddr("treasury");
        creator = makeAddr("creator");
        resolver = makeAddr("resolver");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        vm.prank(owner);
        pm = new PredictionMarket(treasuryAddr);

        vm.prank(owner);
        pm.addResolver(resolver);

        collateral = new MockPMToken();

        // Fund creator for initial liquidity
        collateral.mint(creator, 1_000 ether);
        vm.prank(creator);
        collateral.approve(address(pm), type(uint256).max);

        // Fund participants
        collateral.mint(alice, 10_000 ether);
        vm.prank(alice);
        collateral.approve(address(pm), type(uint256).max);

        collateral.mint(bob, 10_000 ether);
        vm.prank(bob);
        collateral.approve(address(pm), type(uint256).max);
    }

    // ============ Helpers ============

    function _createDefaultMarket() internal returns (uint256) {
        uint256 start = block.timestamp;
        vm.prank(creator);
        return pm.createMarket(
            bytes32("Will ETH hit 10k?"),
            address(collateral),
            LIQUIDITY,
            uint64(start + 7 days),
            uint64(start + 14 days)
        );
    }

    // ============ Constructor Tests ============

    function test_constructor_setsTreasury() public view {
        assertEq(pm.treasury(), treasuryAddr);
    }

    function test_constructor_setsOwner() public view {
        assertEq(pm.owner(), owner);
    }

    // ============ createMarket Tests ============

    function test_createMarket_happyPath() public {
        uint256 id = _createDefaultMarket();
        assertEq(id, 1);

        IPredictionMarket.PredictionMarketData memory m = pm.getMarket(1);
        assertEq(m.question, bytes32("Will ETH hit 10k?"));
        assertEq(m.collateralToken, address(collateral));
        assertEq(m.creator, creator);
        assertEq(m.yPool, LIQUIDITY);
        assertEq(m.nPool, LIQUIDITY);
        assertEq(m.totalSets, 0);
        assertEq(m.liquidityParam, LIQUIDITY);
        assertEq(uint8(m.phase), uint8(IPredictionMarket.MarketPhase.OPEN));

        // Liquidity transferred from creator
        assertEq(collateral.balanceOf(address(pm)), LIQUIDITY);
    }

    function test_createMarket_revertsZeroAddress() public {
        vm.expectRevert(IPredictionMarket.ZeroAddress.selector);
        pm.createMarket(bytes32("Q"), address(0), LIQUIDITY, uint64(block.timestamp + 7 days), uint64(block.timestamp + 14 days));
    }

    function test_createMarket_revertsInvalidTiming() public {
        vm.expectRevert(IPredictionMarket.InvalidParams.selector);
        vm.prank(creator);
        pm.createMarket(bytes32("Q"), address(collateral), LIQUIDITY, uint64(block.timestamp - 1), uint64(block.timestamp + 14 days));
    }

    // ============ buyShares Tests ============

    function test_buyShares_yesHappyPath() public {
        _createDefaultMarket();

        vm.prank(alice);
        pm.buyShares(1, true, 10 ether, 0);

        IPredictionMarket.Position memory pos = pm.getPosition(1, alice);
        assertGt(pos.yesShares, 0, "Should have YES shares");
        assertEq(pos.noShares, 0, "Should have no NO shares");
    }

    function test_buyShares_noHappyPath() public {
        _createDefaultMarket();

        vm.prank(alice);
        pm.buyShares(1, false, 10 ether, 0);

        IPredictionMarket.Position memory pos = pm.getPosition(1, alice);
        assertEq(pos.yesShares, 0, "Should have no YES shares");
        assertGt(pos.noShares, 0, "Should have NO shares");
    }

    function test_buyShares_priceMovesWithDemand() public {
        _createDefaultMarket();

        uint256 yesPriceBefore = pm.getPrice(1, true);

        // Buy YES -> YES price should increase
        vm.prank(alice);
        pm.buyShares(1, true, 10 ether, 0);

        uint256 yesPriceAfter = pm.getPrice(1, true);
        assertGt(yesPriceAfter, yesPriceBefore, "YES price should increase after YES buy");
    }

    function test_buyShares_revertsAfterLock() public {
        uint256 start = block.timestamp;
        _createDefaultMarket();

        vm.warp(start + 7 days);

        vm.prank(alice);
        vm.expectRevert(IPredictionMarket.MarketNotOpen.selector);
        pm.buyShares(1, true, 10 ether, 0);
    }

    function test_buyShares_revertsSlippage() public {
        _createDefaultMarket();

        vm.prank(alice);
        vm.expectRevert(IPredictionMarket.SlippageExceeded.selector);
        pm.buyShares(1, true, 10 ether, type(uint256).max); // minShares impossible
    }

    // ============ sellShares Tests ============

    function test_sellShares_happyPath() public {
        _createDefaultMarket();

        // Buy YES
        vm.prank(alice);
        pm.buyShares(1, true, 10 ether, 0);

        IPredictionMarket.Position memory posBefore = pm.getPosition(1, alice);
        uint256 balBefore = collateral.balanceOf(alice);

        // Sell half
        uint256 sellAmount = posBefore.yesShares / 2;
        vm.prank(alice);
        pm.sellShares(1, true, sellAmount, 0);

        IPredictionMarket.Position memory posAfter = pm.getPosition(1, alice);
        assertEq(posAfter.yesShares, posBefore.yesShares - sellAmount);
        assertGt(collateral.balanceOf(alice) - balBefore, 0, "Should receive proceeds");
    }

    function test_sellShares_revertsInsufficientTokens() public {
        _createDefaultMarket();

        vm.prank(alice);
        vm.expectRevert(IPredictionMarket.InsufficientTokens.selector);
        pm.sellShares(1, true, 100 ether, 0);
    }

    // ============ resolveMarket Tests ============

    function test_resolveMarket_happyPath() public {
        uint256 start = block.timestamp;
        _createDefaultMarket();

        vm.warp(start + 7 days);

        vm.prank(resolver);
        pm.resolveMarket(1, IPredictionMarket.MarketOutcome.YES);

        IPredictionMarket.PredictionMarketData memory m = pm.getMarket(1);
        assertEq(uint8(m.phase), uint8(IPredictionMarket.MarketPhase.RESOLVED));
        assertEq(uint8(m.outcome), uint8(IPredictionMarket.MarketOutcome.YES));
    }

    function test_resolveMarket_revertsNotResolver() public {
        uint256 start = block.timestamp;
        _createDefaultMarket();

        vm.warp(start + 7 days);

        vm.prank(alice);
        vm.expectRevert(IPredictionMarket.NotResolver.selector);
        pm.resolveMarket(1, IPredictionMarket.MarketOutcome.YES);
    }

    function test_resolveMarket_revertsBeforeLock() public {
        _createDefaultMarket();

        vm.prank(resolver);
        vm.expectRevert(IPredictionMarket.MarketNotLocked.selector);
        pm.resolveMarket(1, IPredictionMarket.MarketOutcome.YES);
    }

    // ============ claimWinnings Tests ============

    function test_claimWinnings_yesWins() public {
        uint256 start = block.timestamp;
        _createDefaultMarket();

        // Alice buys YES
        vm.prank(alice);
        pm.buyShares(1, true, 10 ether, 0);

        IPredictionMarket.Position memory pos = pm.getPosition(1, alice);
        uint256 yesShares = pos.yesShares;

        // Lock + resolve YES
        vm.warp(start + 7 days);
        vm.prank(resolver);
        pm.resolveMarket(1, IPredictionMarket.MarketOutcome.YES);

        // Claim
        uint256 balBefore = collateral.balanceOf(alice);
        vm.prank(alice);
        pm.claimWinnings(1);

        assertEq(collateral.balanceOf(alice) - balBefore, yesShares, "Should receive 1 collateral per winning share");
    }

    function test_claimWinnings_noWins() public {
        uint256 start = block.timestamp;
        _createDefaultMarket();

        // Bob buys NO
        vm.prank(bob);
        pm.buyShares(1, false, 10 ether, 0);

        IPredictionMarket.Position memory pos = pm.getPosition(1, bob);
        uint256 noShares = pos.noShares;

        // Lock + resolve NO
        vm.warp(start + 7 days);
        vm.prank(resolver);
        pm.resolveMarket(1, IPredictionMarket.MarketOutcome.NO);

        uint256 balBefore = collateral.balanceOf(bob);
        vm.prank(bob);
        pm.claimWinnings(1);

        assertEq(collateral.balanceOf(bob) - balBefore, noShares);
    }

    function test_claimWinnings_revertsAlreadyClaimed() public {
        uint256 start = block.timestamp;
        _createDefaultMarket();

        vm.prank(alice);
        pm.buyShares(1, true, 10 ether, 0);

        vm.warp(start + 7 days);
        vm.prank(resolver);
        pm.resolveMarket(1, IPredictionMarket.MarketOutcome.YES);

        vm.prank(alice);
        pm.claimWinnings(1);

        vm.prank(alice);
        vm.expectRevert(IPredictionMarket.AlreadyClaimed.selector);
        pm.claimWinnings(1);
    }

    function test_claimWinnings_revertsNoWinnings() public {
        uint256 start = block.timestamp;
        _createDefaultMarket();

        // Alice buys YES, market resolves NO
        vm.prank(alice);
        pm.buyShares(1, true, 10 ether, 0);

        vm.warp(start + 7 days);
        vm.prank(resolver);
        pm.resolveMarket(1, IPredictionMarket.MarketOutcome.NO);

        vm.prank(alice);
        vm.expectRevert(IPredictionMarket.NoWinnings.selector);
        pm.claimWinnings(1);
    }

    // ============ Price Tests ============

    function test_getPrice_startsAt50_50() public {
        _createDefaultMarket();

        uint256 yesPrice = pm.getPrice(1, true);
        uint256 noPrice = pm.getPrice(1, false);

        assertEq(yesPrice, 0.5 ether, "YES should start at 50%");
        assertEq(noPrice, 0.5 ether, "NO should start at 50%");
    }

    function test_getPrice_sumApproxOne() public {
        _createDefaultMarket();

        // Buy some YES to move prices
        vm.prank(alice);
        pm.buyShares(1, true, 20 ether, 0);

        uint256 yesPrice = pm.getPrice(1, true);
        uint256 noPrice = pm.getPrice(1, false);

        assertApproxEqAbs(yesPrice + noPrice, 1 ether, 1, "Prices should sum to ~1");
    }
}
