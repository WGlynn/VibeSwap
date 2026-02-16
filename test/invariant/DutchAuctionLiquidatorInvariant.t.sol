// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/mechanism/DutchAuctionLiquidator.sol";

// ============ Mock Token ============

contract MockDALIToken {
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

// ============ Handler ============

contract DALHandler is Test {
    DutchAuctionLiquidator public dal;
    MockDALIToken public collateral;
    MockDALIToken public debt;

    address public keeper;
    address public posOwner;
    address[] public bidders;

    // Ghost variables
    uint256 public ghost_auctionsCreated;
    uint256 public ghost_auctionsBid;
    uint256 public ghost_auctionsExpired;
    uint256 public ghost_totalCollateralDeposited;
    uint256 public ghost_totalDebtPaid;

    constructor(
        DutchAuctionLiquidator _dal,
        MockDALIToken _collateral,
        MockDALIToken _debt,
        address _keeper,
        address _posOwner,
        address[] memory _bidders
    ) {
        dal = _dal;
        collateral = _collateral;
        debt = _debt;
        keeper = _keeper;
        posOwner = _posOwner;
        bidders = _bidders;
    }

    function createAuction(uint256 collAmt, uint256 debtAmt) public {
        collAmt = bound(collAmt, 0.01 ether, 100 ether);
        debtAmt = bound(debtAmt, 0.01 ether, 100 ether);

        vm.prank(keeper);
        try dal.createAuction(
            address(collateral),
            collAmt,
            address(debt),
            debtAmt,
            posOwner
        ) {
            ghost_auctionsCreated++;
            ghost_totalCollateralDeposited += collAmt;
        } catch {}
    }

    function bid(uint256 auctionSeed) public {
        if (ghost_auctionsCreated == 0) return;

        uint256 auctionId = (auctionSeed % ghost_auctionsCreated) + 1;
        address bidder = bidders[auctionSeed % bidders.length];

        vm.prank(bidder);
        try dal.bid(auctionId) {
            ghost_auctionsBid++;
        } catch {}
    }

    function settleExpired(uint256 auctionSeed) public {
        if (ghost_auctionsCreated == 0) return;

        uint256 auctionId = (auctionSeed % ghost_auctionsCreated) + 1;

        try dal.settleExpired(auctionId) {
            ghost_auctionsExpired++;
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 60 minutes);
        vm.warp(block.timestamp + delta);
    }
}

// ============ Invariant Tests ============

contract DutchAuctionLiquidatorInvariantTest is StdInvariant, Test {
    DutchAuctionLiquidator public dal;
    MockDALIToken public collateral;
    MockDALIToken public debt;
    DALHandler public handler;

    address public treasuryAddr;
    address public keeper;
    address public posOwner;
    address[] public bidders;

    function setUp() public {
        treasuryAddr = makeAddr("treasury");
        keeper = makeAddr("keeper");
        posOwner = makeAddr("posOwner");

        collateral = new MockDALIToken();
        debt = new MockDALIToken();

        dal = new DutchAuctionLiquidator(treasuryAddr);
        dal.addAuthorizedCreator(keeper);

        // Fund keeper with collateral
        collateral.mint(keeper, 100_000 ether);
        vm.prank(keeper);
        collateral.approve(address(dal), type(uint256).max);

        // Create bidders with debt tokens
        for (uint256 i = 0; i < 3; i++) {
            address b = makeAddr(string(abi.encodePacked("bidder", vm.toString(i))));
            bidders.push(b);
            debt.mint(b, 100_000 ether);
            vm.prank(b);
            debt.approve(address(dal), type(uint256).max);
        }

        handler = new DALHandler(dal, collateral, debt, keeper, posOwner, bidders);

        targetContract(address(handler));
    }

    // ============ Invariant: collateral balance covers active auctions ============

    function invariant_collateralSolvent() public view {
        uint256 contractBal = collateral.balanceOf(address(dal));
        uint256 activeCollateral = 0;

        uint256 count = dal.auctionCount();
        for (uint256 i = 1; i <= count; i++) {
            IDutchAuctionLiquidator.LiquidationAuction memory a = dal.getAuction(i);
            if (a.state == IDutchAuctionLiquidator.AuctionState.ACTIVE) {
                activeCollateral += a.collateralAmount;
            }
        }

        assertGe(
            contractBal,
            activeCollateral,
            "SOLVENCY VIOLATION: collateral balance < active auction collateral"
        );
    }

    // ============ Invariant: completed auctions have winners ============

    function invariant_completedHaveWinners() public view {
        uint256 count = dal.auctionCount();
        for (uint256 i = 1; i <= count; i++) {
            IDutchAuctionLiquidator.LiquidationAuction memory a = dal.getAuction(i);
            if (a.state == IDutchAuctionLiquidator.AuctionState.COMPLETED) {
                assertTrue(a.winner != address(0), "WINNER VIOLATION: completed auction has no winner");
                assertGt(a.winningBid, 0, "BID VIOLATION: completed auction has zero bid");
            }
        }
    }

    // ============ Invariant: no double settlement ============

    function invariant_noDoubleSettlement() public view {
        uint256 completed = handler.ghost_auctionsBid();
        uint256 expired = handler.ghost_auctionsExpired();
        uint256 total = handler.ghost_auctionsCreated();

        assertLe(
            completed + expired,
            total,
            "SETTLEMENT VIOLATION: more settlements than auctions"
        );
    }

    // ============ Invariant: auction state machine valid ============

    function invariant_validStateTransitions() public view {
        uint256 count = dal.auctionCount();
        for (uint256 i = 1; i <= count; i++) {
            IDutchAuctionLiquidator.LiquidationAuction memory a = dal.getAuction(i);
            uint8 state = uint8(a.state);
            assertTrue(
                state <= uint8(IDutchAuctionLiquidator.AuctionState.EXPIRED),
                "STATE VIOLATION: invalid auction state"
            );
        }
    }
}
