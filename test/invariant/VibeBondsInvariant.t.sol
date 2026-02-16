// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/financial/VibeBonds.sol";
import "../../contracts/financial/interfaces/IVibeBonds.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Token ============

contract MockBondIToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

contract BondsHandler is Test {
    VibeBonds public bonds;
    MockBondIToken public token;
    MockBondIToken public jul;

    address public buyer;
    address public treasury;
    address public owner;

    // Ghost variables
    uint256 public ghost_seriesCount;
    uint256 public ghost_totalBought;
    uint256 public ghost_totalRedeemed;
    uint256 public ghost_auctionsSettled;

    uint256[] public activeSeries;

    constructor(
        VibeBonds _bonds,
        MockBondIToken _token,
        MockBondIToken _jul,
        address _buyer,
        address _treasury,
        address _owner
    ) {
        bonds = _bonds;
        token = _token;
        jul = _jul;
        buyer = _buyer;
        treasury = _treasury;
        owner = _owner;
    }

    function createAndBuy(uint256 amount) public {
        amount = bound(amount, 1 ether, 100_000 ether);

        uint40 auctionDur = 3 days;
        uint40 bondDur = 360 days;

        vm.prank(owner);
        try bonds.createSeries(IVibeBonds.CreateSeriesParams({
            token: address(token),
            treasury: treasury,
            maxPrincipal: 1_000_000 ether,
            maxCouponRate: 1000,
            minCouponRate: 200,
            auctionDuration: auctionDur,
            maturity: uint40(block.timestamp) + auctionDur + bondDur,
            couponInterval: 30 days,
            earlyRedemptionPenaltyBps: 1000
        })) returns (uint256 seriesId) {
            activeSeries.push(seriesId);
            ghost_seriesCount++;

            // Buy bonds
            token.mint(buyer, amount);
            vm.startPrank(buyer);
            token.approve(address(bonds), amount);
            try bonds.buy(seriesId, amount) {
                ghost_totalBought += amount;
            } catch {}
            vm.stopPrank();
        } catch {}
    }

    function settleAuction(uint256 seriesSeed) public {
        if (activeSeries.length == 0) return;

        uint256 seriesId = activeSeries[seriesSeed % activeSeries.length];

        try bonds.getSeries(seriesId) returns (IVibeBonds.BondSeries memory s) {
            if (s.state != IVibeBonds.BondState.AUCTION) return;
            if (block.timestamp < s.auctionEnd && s.totalPrincipal < s.maxPrincipal) return;

            try bonds.settleAuction(seriesId) {
                ghost_auctionsSettled++;
            } catch {}
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 30 days);
        vm.warp(block.timestamp + delta);
    }

    function getActiveCount() external view returns (uint256) {
        return activeSeries.length;
    }
}

// ============ Invariant Tests ============

contract VibeBondsInvariantTest is StdInvariant, Test {
    VibeBonds public bonds;
    MockBondIToken public token;
    MockBondIToken public jul;
    BondsHandler public handler;

    address public buyer;
    address public treasury;

    function setUp() public {
        buyer = makeAddr("buyer");
        treasury = makeAddr("treasury");

        jul = new MockBondIToken("JUL", "JUL");
        token = new MockBondIToken("USDC", "USDC");

        bonds = new VibeBonds(address(jul));

        handler = new BondsHandler(bonds, token, jul, buyer, treasury, address(this));
        targetContract(address(handler));
    }

    // ============ Invariant: totalSeries = ghost series count ============

    function invariant_seriesCountConsistent() public view {
        assertEq(
            bonds.totalSeries(),
            handler.ghost_seriesCount(),
            "SERIES: count mismatch"
        );
    }

    // ============ Invariant: bought >= redeemed ============

    function invariant_boughtGeRedeemed() public view {
        assertGe(
            handler.ghost_totalBought(),
            handler.ghost_totalRedeemed(),
            "FLOW: redeemed exceeds bought"
        );
    }

    // ============ Invariant: auction rate within bounds for active auctions ============

    function invariant_auctionRateBounded() public view {
        uint256 count = handler.getActiveCount();
        for (uint256 i = 0; i < count && i < 5; i++) {
            uint256 seriesId = handler.activeSeries(i);
            try bonds.getSeries(seriesId) returns (IVibeBonds.BondSeries memory s) {
                if (s.state == IVibeBonds.BondState.AUCTION) {
                    uint256 rate = bonds.currentAuctionRate(seriesId);
                    assertGe(rate, s.minCouponRate, "RATE: below min");
                    assertLe(rate, s.maxCouponRate, "RATE: above max");
                }
            } catch {}
        }
    }

    // ============ Invariant: bond state is valid ============

    function invariant_bondStateValid() public view {
        uint256 count = handler.getActiveCount();
        for (uint256 i = 0; i < count && i < 5; i++) {
            uint256 seriesId = handler.activeSeries(i);
            try bonds.getSeries(seriesId) returns (IVibeBonds.BondSeries memory s) {
                uint8 state = uint8(s.state);
                assertTrue(
                    state <= uint8(IVibeBonds.BondState.DEFAULTED),
                    "STATE: invalid bond state"
                );
            } catch {}
        }
    }

    // ============ Invariant: totalPrincipal <= maxPrincipal for every series ============

    function invariant_principalBounded() public view {
        uint256 count = handler.getActiveCount();
        for (uint256 i = 0; i < count && i < 5; i++) {
            uint256 seriesId = handler.activeSeries(i);
            try bonds.getSeries(seriesId) returns (IVibeBonds.BondSeries memory s) {
                assertLe(
                    s.totalPrincipal,
                    s.maxPrincipal,
                    "PRINCIPAL: exceeds max"
                );
            } catch {}
        }
    }
}
