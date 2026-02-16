// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/DutchAuctionLiquidator.sol";

// ============ Mock Token ============

contract MockDALFToken {
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

// ============ Fuzz Tests ============

contract DutchAuctionLiquidatorFuzzTest is Test {
    DutchAuctionLiquidator public dal;
    MockDALFToken public collateral;
    MockDALFToken public debt;

    address public treasuryAddr;
    address public keeper;
    address public bidder;
    address public posOwner;

    function setUp() public {
        treasuryAddr = makeAddr("treasury");
        keeper = makeAddr("keeper");
        bidder = makeAddr("bidder");
        posOwner = makeAddr("posOwner");

        collateral = new MockDALFToken();
        debt = new MockDALFToken();

        dal = new DutchAuctionLiquidator(treasuryAddr);
        dal.addAuthorizedCreator(keeper);

        collateral.mint(keeper, type(uint128).max);
        vm.prank(keeper);
        collateral.approve(address(dal), type(uint256).max);

        debt.mint(bidder, type(uint128).max);
        vm.prank(bidder);
        debt.approve(address(dal), type(uint256).max);
    }

    // ============ Fuzz: price monotonically descends ============

    function testFuzz_priceMonotonicallyDescends(uint256 debtAmt, uint256 t1, uint256 t2) public {
        debtAmt = bound(debtAmt, 0.1 ether, 1_000_000 ether);
        t1 = bound(t1, 0, 29 minutes);
        t2 = bound(t2, t1 + 1, 30 minutes);

        vm.prank(keeper);
        dal.createAuction(address(collateral), 10 ether, address(debt), debtAmt, posOwner);

        vm.warp(block.timestamp + t1);
        uint256 p1 = dal.currentPrice(1);

        vm.warp(block.timestamp + (t2 - t1));
        uint256 p2 = dal.currentPrice(1);

        assertLe(p2, p1, "Price must be monotonically non-increasing");
    }

    // ============ Fuzz: price bounded between start and end ============

    function testFuzz_priceBounded(uint256 debtAmt, uint256 elapsed) public {
        debtAmt = bound(debtAmt, 0.1 ether, 1_000_000 ether);
        elapsed = bound(elapsed, 0, 30 minutes);

        vm.prank(keeper);
        dal.createAuction(address(collateral), 10 ether, address(debt), debtAmt, posOwner);

        IDutchAuctionLiquidator.LiquidationAuction memory a = dal.getAuction(1);

        vm.warp(block.timestamp + elapsed);
        uint256 price = dal.currentPrice(1);

        assertGe(price, a.endPrice, "Price must be >= endPrice");
        assertLe(price, a.startPrice, "Price must be <= startPrice");
    }

    // ============ Fuzz: surplus share formula correct ============

    function testFuzz_surplusShareCorrect(uint256 debtAmt, uint256 collAmt) public {
        debtAmt = bound(debtAmt, 0.1 ether, 100_000 ether);
        collAmt = bound(collAmt, 0.1 ether, 100_000 ether);

        vm.prank(keeper);
        dal.createAuction(address(collateral), collAmt, address(debt), debtAmt, posOwner);

        // Bid immediately (at startPrice = 150% of debt = surplus guaranteed)
        uint256 price = dal.currentPrice(1);
        uint256 surplus = price - debtAmt;
        uint256 expectedOwnerShare = (surplus * 8000) / 10000;

        uint256 ownerBefore = debt.balanceOf(posOwner);
        vm.prank(bidder);
        dal.bid(1);
        uint256 ownerAfter = debt.balanceOf(posOwner);

        assertEq(ownerAfter - ownerBefore, expectedOwnerShare, "Owner share must match formula");
    }

    // ============ Fuzz: collateral always goes to bidder ============

    function testFuzz_collateralGoesToBidder(uint256 collAmt, uint256 elapsed) public {
        collAmt = bound(collAmt, 0.01 ether, 100_000 ether);
        elapsed = bound(elapsed, 0, 29 minutes);

        vm.prank(keeper);
        dal.createAuction(address(collateral), collAmt, address(debt), 1 ether, posOwner);

        vm.warp(block.timestamp + elapsed);

        uint256 bidderColBefore = collateral.balanceOf(bidder);
        vm.prank(bidder);
        dal.bid(1);

        assertEq(
            collateral.balanceOf(bidder) - bidderColBefore,
            collAmt,
            "Bidder must receive exact collateral"
        );
    }

    // ============ Fuzz: expired auction sends collateral to treasury ============

    function testFuzz_expiredSendsToTreasury(uint256 collAmt, uint256 extraTime) public {
        collAmt = bound(collAmt, 0.01 ether, 100_000 ether);
        extraTime = bound(extraTime, 0, 365 days);

        vm.prank(keeper);
        dal.createAuction(address(collateral), collAmt, address(debt), 1 ether, posOwner);

        vm.warp(block.timestamp + 30 minutes + extraTime);

        dal.settleExpired(1);

        assertEq(
            collateral.balanceOf(treasuryAddr),
            collAmt,
            "Treasury must receive collateral on expiry"
        );
    }
}
