// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/mechanism/DutchAuctionLiquidator.sol";

// ============ Mock Token ============

contract MockDALToken {
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

contract DutchAuctionLiquidatorTest is Test {
    DutchAuctionLiquidator public dal;
    MockDALToken public collateral;
    MockDALToken public debt;

    address public owner;
    address public treasuryAddr;
    address public keeper;
    address public bidder;
    address public positionOwner;

    uint256 constant COLLATERAL_AMOUNT = 10 ether;
    uint256 constant DEBT_AMOUNT = 8 ether;

    function setUp() public {
        owner = makeAddr("owner");
        treasuryAddr = makeAddr("treasury");
        keeper = makeAddr("keeper");
        bidder = makeAddr("bidder");
        positionOwner = makeAddr("positionOwner");

        collateral = new MockDALToken();
        debt = new MockDALToken();

        vm.prank(owner);
        dal = new DutchAuctionLiquidator(treasuryAddr);

        // Authorize keeper
        vm.prank(owner);
        dal.addAuthorizedCreator(keeper);

        // Fund keeper with collateral
        collateral.mint(keeper, 100 ether);
        vm.prank(keeper);
        collateral.approve(address(dal), type(uint256).max);

        // Fund bidder with debt tokens
        debt.mint(bidder, 100 ether);
        vm.prank(bidder);
        debt.approve(address(dal), type(uint256).max);
    }

    // ============ Helpers ============

    function _createDefaultAuction() internal returns (uint256) {
        vm.prank(keeper);
        return dal.createAuction(
            address(collateral),
            COLLATERAL_AMOUNT,
            address(debt),
            DEBT_AMOUNT,
            positionOwner
        );
    }

    // ============ Constructor Tests ============

    function test_constructor_setsTreasury() public view {
        assertEq(dal.treasury(), treasuryAddr);
    }

    function test_constructor_setsDefaults() public view {
        assertEq(dal.defaultDuration(), 30 minutes);
        assertEq(dal.startPremiumBps(), 5000);
        assertEq(dal.endDiscountBps(), 2000);
        assertEq(dal.surplusShareBps(), 8000);
    }

    // ============ createAuction Tests ============

    function test_createAuction_happyPath() public {
        uint256 id = _createDefaultAuction();
        assertEq(id, 1);

        IDutchAuctionLiquidator.LiquidationAuction memory a = dal.getAuction(1);
        assertEq(a.collateralToken, address(collateral));
        assertEq(a.collateralAmount, COLLATERAL_AMOUNT);
        assertEq(a.debtToken, address(debt));
        assertEq(a.debtAmount, DEBT_AMOUNT);
        assertEq(uint8(a.state), uint8(IDutchAuctionLiquidator.AuctionState.ACTIVE));

        // Start price = 150% of debt, end price = 80% of debt
        assertEq(a.startPrice, DEBT_AMOUNT * 15000 / 10000);
        assertEq(a.endPrice, DEBT_AMOUNT * 8000 / 10000);

        // Collateral transferred to contract
        assertEq(collateral.balanceOf(address(dal)), COLLATERAL_AMOUNT);
    }

    function test_createAuction_revertsNotAuthorized() public {
        address rando = makeAddr("rando");
        collateral.mint(rando, 10 ether);
        vm.prank(rando);
        collateral.approve(address(dal), type(uint256).max);

        vm.prank(rando);
        vm.expectRevert(IDutchAuctionLiquidator.NotAuthorizedCreator.selector);
        dal.createAuction(address(collateral), 1 ether, address(debt), 1 ether, positionOwner);
    }

    function test_createAuction_revertsZeroAmount() public {
        vm.prank(keeper);
        vm.expectRevert(IDutchAuctionLiquidator.ZeroAmount.selector);
        dal.createAuction(address(collateral), 0, address(debt), 1 ether, positionOwner);
    }

    // ============ currentPrice Tests ============

    function test_currentPrice_startsAtStartPrice() public {
        _createDefaultAuction();
        uint256 price = dal.currentPrice(1);
        assertEq(price, DEBT_AMOUNT * 15000 / 10000);
    }

    function test_currentPrice_descendsOverTime() public {
        uint256 start = block.timestamp;
        _createDefaultAuction();

        uint256 priceStart = dal.currentPrice(1);

        vm.warp(start + 15 minutes);
        uint256 priceMid = dal.currentPrice(1);

        vm.warp(start + 30 minutes);
        uint256 priceEnd = dal.currentPrice(1);

        assertGt(priceStart, priceMid, "Price should descend");
        assertGt(priceMid, priceEnd, "Price should keep descending");
        assertEq(priceEnd, DEBT_AMOUNT * 8000 / 10000, "End price at deadline");
    }

    function test_currentPrice_midpointCorrect() public {
        _createDefaultAuction();

        vm.warp(block.timestamp + 15 minutes); // halfway through 30min auction

        uint256 price = dal.currentPrice(1);
        uint256 startPrice = DEBT_AMOUNT * 15000 / 10000;
        uint256 endPrice = DEBT_AMOUNT * 8000 / 10000;
        uint256 expected = (startPrice + endPrice) / 2;

        assertEq(price, expected, "Midpoint price should be average of start and end");
    }

    // ============ bid Tests ============

    function test_bid_happyPath_withSurplus() public {
        _createDefaultAuction();

        // Bid immediately — price is at startPrice (150% of debt = 12 ether)
        uint256 priceBefore = dal.currentPrice(1);
        uint256 ownerBefore = debt.balanceOf(positionOwner);
        uint256 treasuryBefore = debt.balanceOf(treasuryAddr);

        vm.prank(bidder);
        dal.bid(1);

        IDutchAuctionLiquidator.LiquidationAuction memory a = dal.getAuction(1);
        assertEq(uint8(a.state), uint8(IDutchAuctionLiquidator.AuctionState.COMPLETED));
        assertEq(a.winner, bidder);
        assertEq(a.winningBid, priceBefore);

        // Bidder got collateral
        assertEq(collateral.balanceOf(bidder), COLLATERAL_AMOUNT);

        // Surplus distributed
        uint256 surplus = priceBefore - DEBT_AMOUNT;
        uint256 ownerShare = (surplus * 8000) / 10000;
        assertEq(debt.balanceOf(positionOwner) - ownerBefore, ownerShare);
        assertEq(debt.balanceOf(treasuryAddr) - treasuryBefore, priceBefore - ownerShare);
    }

    function test_bid_happyPath_noSurplus() public {
        uint256 start = block.timestamp;
        _createDefaultAuction();

        // Warp to near end — price = ~80% of debt (< debtAmount)
        vm.warp(start + 29 minutes + 59 seconds);

        uint256 price = dal.currentPrice(1);
        assertTrue(price <= DEBT_AMOUNT, "Price should be at or below debt");

        vm.prank(bidder);
        dal.bid(1);

        // All proceeds to treasury (no surplus)
        assertEq(debt.balanceOf(positionOwner), 0, "No surplus for owner");
        assertEq(debt.balanceOf(treasuryAddr), price, "Treasury gets all proceeds");
    }

    function test_bid_revertsAfterDeadline() public {
        _createDefaultAuction();

        vm.warp(block.timestamp + 30 minutes);

        vm.prank(bidder);
        vm.expectRevert(IDutchAuctionLiquidator.AuctionNotActive.selector);
        dal.bid(1);
    }

    // ============ settleExpired Tests ============

    function test_settleExpired_happyPath() public {
        _createDefaultAuction();

        vm.warp(block.timestamp + 30 minutes);

        dal.settleExpired(1);

        IDutchAuctionLiquidator.LiquidationAuction memory a = dal.getAuction(1);
        assertEq(uint8(a.state), uint8(IDutchAuctionLiquidator.AuctionState.EXPIRED));

        // Collateral sent to treasury
        assertEq(collateral.balanceOf(treasuryAddr), COLLATERAL_AMOUNT);
    }

    function test_settleExpired_revertsStillActive() public {
        _createDefaultAuction();

        vm.warp(block.timestamp + 15 minutes);

        vm.expectRevert(IDutchAuctionLiquidator.AuctionStillActive.selector);
        dal.settleExpired(1);
    }
}
