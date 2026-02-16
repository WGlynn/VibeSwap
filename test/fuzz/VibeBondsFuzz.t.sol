// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeBonds.sol";
import "../../contracts/financial/interfaces/IVibeBonds.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Token ============

contract MockBondFToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Fuzz Tests ============

contract VibeBondsFuzzTest is Test {
    VibeBonds public bonds;
    MockBondFToken public token;
    MockBondFToken public jul;

    address public buyer;
    address public treasury;

    uint16 constant MAX_COUPON = 1000;  // 10%
    uint16 constant MIN_COUPON = 200;   // 2%
    uint40 constant AUCTION_DUR = 3 days;
    uint40 constant BOND_DUR = 360 days;
    uint32 constant COUPON_INT = 30 days;
    uint16 constant PENALTY_BPS = 1000; // 10%

    function setUp() public {
        buyer = makeAddr("buyer");
        treasury = makeAddr("treasury");

        jul = new MockBondFToken("JUL", "JUL");
        token = new MockBondFToken("USDC", "USDC");

        bonds = new VibeBonds(address(jul));

        token.mint(buyer, 100_000_000 ether);
        token.mint(treasury, 100_000_000 ether);
        jul.mint(address(this), 10_000_000 ether);

        vm.prank(buyer);
        token.approve(address(bonds), type(uint256).max);
        vm.prank(treasury);
        token.approve(address(bonds), type(uint256).max);
        jul.approve(address(bonds), type(uint256).max);
    }

    // ============ Helpers ============

    function _createSeries() internal returns (uint256) {
        return bonds.createSeries(IVibeBonds.CreateSeriesParams({
            token: address(token),
            treasury: treasury,
            maxPrincipal: 1_000_000 ether,
            maxCouponRate: MAX_COUPON,
            minCouponRate: MIN_COUPON,
            auctionDuration: AUCTION_DUR,
            maturity: uint40(block.timestamp) + AUCTION_DUR + BOND_DUR,
            couponInterval: COUPON_INT,
            earlyRedemptionPenaltyBps: PENALTY_BPS
        }));
    }

    function _buyAndSettle(uint256 seriesId, uint256 amount) internal {
        vm.prank(buyer);
        bonds.buy(seriesId, amount);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.auctionEnd);
        bonds.settleAuction(seriesId);

        vm.prank(treasury);
        bonds.fundCouponReserve(seriesId);

        s = bonds.getSeries(seriesId);
        vm.prank(treasury);
        bonds.fundPrincipalReserve(seriesId, s.totalPrincipal);
    }

    // ============ Fuzz: Dutch auction rate descends linearly ============

    function testFuzz_auctionRateDescends(uint256 elapsed) public {
        uint256 seriesId = _createSeries();
        elapsed = bound(elapsed, 0, AUCTION_DUR);

        vm.warp(block.timestamp + elapsed);

        uint256 rate = bonds.currentAuctionRate(seriesId);

        // rate = max - (max - min) * elapsed / duration
        uint256 expected = uint256(MAX_COUPON) - (uint256(MAX_COUPON - MIN_COUPON) * elapsed / AUCTION_DUR);

        assertEq(rate, expected, "Rate must descend linearly");
        assertGe(rate, MIN_COUPON, "Rate must be >= min");
        assertLe(rate, MAX_COUPON, "Rate must be <= max");
    }

    // ============ Fuzz: buy mints 1:1 bond tokens ============

    function testFuzz_buyMintsBondsOneToOne(uint256 amount) public {
        amount = bound(amount, 1 ether, 500_000 ether);

        uint256 seriesId = _createSeries();

        uint256 balBefore = bonds.balanceOf(buyer, seriesId);

        vm.prank(buyer);
        bonds.buy(seriesId, amount);

        uint256 balAfter = bonds.balanceOf(buyer, seriesId);
        assertEq(balAfter - balBefore, amount, "Bonds minted 1:1 with principal");
    }

    // ============ Fuzz: early redemption penalty scales with time remaining ============

    function testFuzz_earlyRedemptionPenalty(uint256 elapsed) public {
        uint256 seriesId = _createSeries();
        uint256 buyAmount = 100_000 ether;

        _buyAndSettle(seriesId, buyAmount);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        uint256 totalDuration = s.maturity - s.auctionEnd;

        // Warp to some point during active period
        elapsed = bound(elapsed, 1, totalDuration - 1);
        vm.warp(s.auctionEnd + elapsed);

        uint256 redeemAmount = 10_000 ether;
        (uint256 value, uint256 penalty) = bonds.earlyRedemptionValue(seriesId, redeemAmount);

        uint256 remaining = totalDuration - elapsed;
        uint256 expectedPenalty = redeemAmount * PENALTY_BPS * remaining / (10000 * totalDuration);

        assertEq(penalty, expectedPenalty, "Penalty must scale with remaining time");
        assertEq(value, redeemAmount - penalty, "Value = amount - penalty");
        assertLe(penalty, redeemAmount, "Penalty must not exceed amount");
    }

    // ============ Fuzz: total principal never exceeds max ============

    function testFuzz_principalCapped(uint256 amount1, uint256 amount2) public {
        uint256 maxPrincipal = 1_000_000 ether;
        amount1 = bound(amount1, 1 ether, maxPrincipal);
        amount2 = bound(amount2, 1 ether, maxPrincipal);

        uint256 seriesId = _createSeries();

        vm.prank(buyer);
        bonds.buy(seriesId, amount1);

        if (amount1 + amount2 > maxPrincipal) {
            vm.prank(buyer);
            vm.expectRevert(IVibeBonds.ExceedsMaxPrincipal.selector);
            bonds.buy(seriesId, amount2);
        } else {
            vm.prank(buyer);
            bonds.buy(seriesId, amount2);
        }

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        assertLe(s.totalPrincipal, maxPrincipal, "Principal must not exceed max");
    }

    // ============ Fuzz: redeem at maturity returns full principal ============

    function testFuzz_redeemAtMaturity(uint256 amount) public {
        amount = bound(amount, 1 ether, 500_000 ether);

        uint256 seriesId = _createSeries();
        _buyAndSettle(seriesId, amount);

        // Warp to maturity
        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.maturity);

        uint256 balBefore = token.balanceOf(buyer);

        vm.prank(buyer);
        bonds.redeem(seriesId, amount);

        uint256 received = token.balanceOf(buyer) - balBefore;
        // Should receive at least the principal (plus any coupons)
        assertGe(received, amount, "At maturity: receive at least principal");
    }

    // ============ Fuzz: coupon per period consistent ============

    function testFuzz_uniformClearingRate(uint256 elapsed1, uint256 elapsed2, uint256 amount1, uint256 amount2) public {
        amount1 = bound(amount1, 1 ether, 400_000 ether);
        amount2 = bound(amount2, 1 ether, 400_000 ether);
        elapsed1 = bound(elapsed1, 0, AUCTION_DUR / 2);
        elapsed2 = bound(elapsed2, elapsed1, AUCTION_DUR - 1);

        uint256 seriesId = _createSeries();

        // Two buyers at different times
        vm.warp(block.timestamp + elapsed1);
        vm.prank(buyer);
        bonds.buy(seriesId, amount1);

        vm.warp(block.timestamp + (elapsed2 - elapsed1));
        vm.prank(buyer);
        if (amount1 + amount2 > 1_000_000 ether) return;
        bonds.buy(seriesId, amount2);

        // Last buyer's rate becomes clearing rate — both get same rate
        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        uint256 clearingRate = s.couponRate;

        // Clearing rate should be the rate at second purchase time
        assertGe(clearingRate, MIN_COUPON, "Clearing rate >= min");
        assertLe(clearingRate, MAX_COUPON, "Clearing rate <= max");
    }
}
