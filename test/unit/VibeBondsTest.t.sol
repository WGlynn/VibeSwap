// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeBonds.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock ============

contract MockBondToken is ERC20 {
    constructor() ERC20("USDC", "USDC") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Tests ============

contract VibeBondsTest is Test {
    VibeBonds public bonds;
    MockBondToken public usdc;
    MockBondToken public julToken;

    address alice = address(0xA1);
    address bob = address(0xB0);
    address treasury = address(0xDD);
    address keeper = address(0xEE);
    address owner;

    uint256 seriesId;

    // Series params
    uint256 constant MAX_PRINCIPAL = 100_000e18;
    uint16 constant MAX_COUPON_RATE = 1000; // 10% APR
    uint16 constant MIN_COUPON_RATE = 200;  // 2% APR
    uint40 constant AUCTION_DURATION = 3 days;
    uint32 constant COUPON_INTERVAL = 30 days;
    uint16 constant EARLY_PENALTY_BPS = 500; // 5%

    function setUp() public {
        owner = address(this);

        julToken = new MockBondToken();
        usdc = new MockBondToken();

        bonds = new VibeBonds(address(julToken));

        // Create a series
        uint40 maturity = uint40(block.timestamp) + AUCTION_DURATION + 365 days;
        seriesId = bonds.createSeries(IVibeBonds.CreateSeriesParams({
            token: address(usdc),
            treasury: treasury,
            maxPrincipal: MAX_PRINCIPAL,
            maxCouponRate: MAX_COUPON_RATE,
            minCouponRate: MIN_COUPON_RATE,
            auctionDuration: AUCTION_DURATION,
            maturity: maturity,
            couponInterval: COUPON_INTERVAL,
            earlyRedemptionPenaltyBps: EARLY_PENALTY_BPS
        }));

        // Fund traders
        usdc.mint(alice, 1_000_000e18);
        usdc.mint(bob, 1_000_000e18);
        usdc.mint(owner, 1_000_000e18);

        vm.prank(alice);
        usdc.approve(address(bonds), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(bonds), type(uint256).max);
        usdc.approve(address(bonds), type(uint256).max);

        // JUL for keeper rewards
        julToken.mint(owner, 100_000e18);
        julToken.approve(address(bonds), type(uint256).max);
    }

    // ============ Helpers ============

    function _buyBonds(address buyer, uint256 amount) internal {
        vm.prank(buyer);
        bonds.buy(seriesId, amount);
    }

    function _settleAndFund() internal {
        // Warp past auction
        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.auctionEnd);
        bonds.settleAuction(seriesId);

        // Fund coupon reserve
        bonds.fundCouponReserve(seriesId);

        // Fund principal reserve for redemption
        bonds.fundPrincipalReserve(seriesId, s.totalPrincipal);
    }

    // ============ Constructor ============

    function test_constructor() public view {
        assertEq(address(bonds.julToken()), address(julToken));
        assertEq(bonds.totalSeries(), 1);
    }

    function test_revertConstructorZeroJul() public {
        vm.expectRevert(IVibeBonds.ZeroAddress.selector);
        new VibeBonds(address(0));
    }

    // ============ Create Series ============

    function test_createSeries() public view {
        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        assertEq(s.token, address(usdc));
        assertEq(s.treasury, treasury);
        assertEq(s.maxPrincipal, MAX_PRINCIPAL);
        assertEq(s.maxCouponRate, MAX_COUPON_RATE);
        assertEq(s.minCouponRate, MIN_COUPON_RATE);
        assertTrue(s.state == IVibeBonds.BondState.AUCTION);
    }

    function test_revertCreateZeroToken() public {
        vm.expectRevert(IVibeBonds.ZeroAddress.selector);
        bonds.createSeries(IVibeBonds.CreateSeriesParams({
            token: address(0), treasury: treasury, maxPrincipal: MAX_PRINCIPAL,
            maxCouponRate: MAX_COUPON_RATE, minCouponRate: MIN_COUPON_RATE,
            auctionDuration: AUCTION_DURATION,
            maturity: uint40(block.timestamp) + AUCTION_DURATION + 365 days,
            couponInterval: COUPON_INTERVAL, earlyRedemptionPenaltyBps: EARLY_PENALTY_BPS
        }));
    }

    function test_revertCreateZeroTreasury() public {
        vm.expectRevert(IVibeBonds.ZeroAddress.selector);
        bonds.createSeries(IVibeBonds.CreateSeriesParams({
            token: address(usdc), treasury: address(0), maxPrincipal: MAX_PRINCIPAL,
            maxCouponRate: MAX_COUPON_RATE, minCouponRate: MIN_COUPON_RATE,
            auctionDuration: AUCTION_DURATION,
            maturity: uint40(block.timestamp) + AUCTION_DURATION + 365 days,
            couponInterval: COUPON_INTERVAL, earlyRedemptionPenaltyBps: EARLY_PENALTY_BPS
        }));
    }

    function test_revertCreateZeroPrincipal() public {
        vm.expectRevert(IVibeBonds.ZeroPrincipal.selector);
        bonds.createSeries(IVibeBonds.CreateSeriesParams({
            token: address(usdc), treasury: treasury, maxPrincipal: 0,
            maxCouponRate: MAX_COUPON_RATE, minCouponRate: MIN_COUPON_RATE,
            auctionDuration: AUCTION_DURATION,
            maturity: uint40(block.timestamp) + AUCTION_DURATION + 365 days,
            couponInterval: COUPON_INTERVAL, earlyRedemptionPenaltyBps: EARLY_PENALTY_BPS
        }));
    }

    function test_revertCreateInvalidRateRange() public {
        vm.expectRevert(IVibeBonds.InvalidRateRange.selector);
        bonds.createSeries(IVibeBonds.CreateSeriesParams({
            token: address(usdc), treasury: treasury, maxPrincipal: MAX_PRINCIPAL,
            maxCouponRate: 100, minCouponRate: 200, // min > max
            auctionDuration: AUCTION_DURATION,
            maturity: uint40(block.timestamp) + AUCTION_DURATION + 365 days,
            couponInterval: COUPON_INTERVAL, earlyRedemptionPenaltyBps: EARLY_PENALTY_BPS
        }));
    }

    function test_revertCreateZeroAuctionDuration() public {
        vm.expectRevert(IVibeBonds.InvalidAuctionDuration.selector);
        bonds.createSeries(IVibeBonds.CreateSeriesParams({
            token: address(usdc), treasury: treasury, maxPrincipal: MAX_PRINCIPAL,
            maxCouponRate: MAX_COUPON_RATE, minCouponRate: MIN_COUPON_RATE,
            auctionDuration: 0,
            maturity: uint40(block.timestamp) + 365 days,
            couponInterval: COUPON_INTERVAL, earlyRedemptionPenaltyBps: EARLY_PENALTY_BPS
        }));
    }

    function test_revertCreateNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        bonds.createSeries(IVibeBonds.CreateSeriesParams({
            token: address(usdc), treasury: treasury, maxPrincipal: MAX_PRINCIPAL,
            maxCouponRate: MAX_COUPON_RATE, minCouponRate: MIN_COUPON_RATE,
            auctionDuration: AUCTION_DURATION,
            maturity: uint40(block.timestamp) + AUCTION_DURATION + 365 days,
            couponInterval: COUPON_INTERVAL, earlyRedemptionPenaltyBps: EARLY_PENALTY_BPS
        }));
    }

    // ============ Dutch Auction Buy ============

    function test_buyBonds() public {
        _buyBonds(alice, 10_000e18);
        assertEq(bonds.balanceOf(alice, seriesId), 10_000e18);
    }

    function test_buyMultipleBuyers() public {
        _buyBonds(alice, 30_000e18);
        _buyBonds(bob, 20_000e18);
        assertEq(bonds.balanceOf(alice, seriesId), 30_000e18);
        assertEq(bonds.balanceOf(bob, seriesId), 20_000e18);
    }

    function test_auctionRateDecreases() public {
        uint256 rateStart = bonds.currentAuctionRate(seriesId);
        assertEq(rateStart, MAX_COUPON_RATE);

        vm.warp(block.timestamp + 1 days);
        uint256 rateMid = bonds.currentAuctionRate(seriesId);
        assertLt(rateMid, rateStart);
        assertGt(rateMid, MIN_COUPON_RATE);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.auctionEnd);
        uint256 rateEnd = bonds.currentAuctionRate(seriesId);
        assertEq(rateEnd, MIN_COUPON_RATE);
    }

    function test_revertBuyZero() public {
        vm.prank(alice);
        vm.expectRevert(IVibeBonds.ZeroAmount.selector);
        bonds.buy(seriesId, 0);
    }

    function test_revertBuyExceedsMax() public {
        vm.prank(alice);
        vm.expectRevert(IVibeBonds.ExceedsMaxPrincipal.selector);
        bonds.buy(seriesId, MAX_PRINCIPAL + 1);
    }

    function test_revertBuyAfterAuction() public {
        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.auctionEnd);
        vm.prank(alice);
        vm.expectRevert(IVibeBonds.NotInAuctionPhase.selector);
        bonds.buy(seriesId, 1000e18);
    }

    function test_revertBuyNonexistentSeries() public {
        vm.prank(alice);
        vm.expectRevert(IVibeBonds.SeriesNotFound.selector);
        bonds.buy(999, 1000e18);
    }

    // ============ Settle Auction ============

    function test_settleAuction() public {
        _buyBonds(alice, 50_000e18);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.auctionEnd);
        bonds.settleAuction(seriesId);

        s = bonds.getSeries(seriesId);
        assertTrue(s.state == IVibeBonds.BondState.ACTIVE);
        assertEq(usdc.balanceOf(treasury), 50_000e18);
    }

    function test_settleWhenFilled() public {
        _buyBonds(alice, MAX_PRINCIPAL);
        // Filled → can settle immediately
        bonds.settleAuction(seriesId);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        assertTrue(s.state == IVibeBonds.BondState.ACTIVE);
    }

    function test_revertSettleStillActive() public {
        _buyBonds(alice, 1000e18);
        vm.expectRevert(IVibeBonds.AuctionStillActive.selector);
        bonds.settleAuction(seriesId);
    }

    function test_revertSettleNoPrincipal() public {
        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.auctionEnd);
        vm.expectRevert(IVibeBonds.NoPrincipalRaised.selector);
        bonds.settleAuction(seriesId);
    }

    // ============ Coupon Distribution ============

    function test_distributeCoupon() public {
        _buyBonds(alice, 50_000e18);
        _settleAndFund();

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);

        // Warp to first coupon period
        vm.warp(uint256(s.auctionEnd) + uint256(COUPON_INTERVAL));
        bonds.distributeCoupon(seriesId);

        s = bonds.getSeries(seriesId);
        assertEq(s.couponsDistributed, 1);
    }

    function test_claimCoupon() public {
        _buyBonds(alice, 50_000e18);
        _settleAndFund();

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(uint256(s.auctionEnd) + uint256(COUPON_INTERVAL));
        bonds.distributeCoupon(seriesId);

        uint256 claimable = bonds.claimable(seriesId, alice);
        assertGt(claimable, 0);

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        bonds.claimCoupon(seriesId);
        assertEq(usdc.balanceOf(alice) - balBefore, claimable);
    }

    function test_revertCouponTooEarly() public {
        _buyBonds(alice, 50_000e18);
        _settleAndFund();

        vm.expectRevert(IVibeBonds.CouponTooEarly.selector);
        bonds.distributeCoupon(seriesId);
    }

    function test_revertClaimNothingToClaim() public {
        _buyBonds(alice, 50_000e18);
        _settleAndFund();

        vm.prank(alice);
        vm.expectRevert(IVibeBonds.NothingToClaim.selector);
        bonds.claimCoupon(seriesId);
    }

    function test_couponProportional() public {
        _buyBonds(alice, 30_000e18);
        _buyBonds(bob, 10_000e18);
        _settleAndFund();

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(uint256(s.auctionEnd) + uint256(COUPON_INTERVAL));
        bonds.distributeCoupon(seriesId);

        uint256 aliceClaim = bonds.claimable(seriesId, alice);
        uint256 bobClaim = bonds.claimable(seriesId, bob);

        // Alice has 3x Bob's bonds → 3x coupons
        assertApproxEqAbs(aliceClaim, bobClaim * 3, 1e3);
    }

    // ============ Redemption at Maturity ============

    function test_redeemAtMaturity() public {
        _buyBonds(alice, 10_000e18);
        _settleAndFund();

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.maturity);

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        bonds.redeem(seriesId, 10_000e18);

        // Gets back principal (+ any accumulated coupons)
        assertGe(usdc.balanceOf(alice) - balBefore, 10_000e18);
        assertEq(bonds.balanceOf(alice, seriesId), 0);
    }

    function test_redeemMarksFullyRedeemed() public {
        _buyBonds(alice, 10_000e18);
        _settleAndFund();

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.maturity);

        vm.prank(alice);
        bonds.redeem(seriesId, 10_000e18);

        s = bonds.getSeries(seriesId);
        assertTrue(s.state == IVibeBonds.BondState.REDEEMED);
    }

    function test_revertRedeemBeforeMaturity() public {
        _buyBonds(alice, 10_000e18);
        _settleAndFund();

        vm.prank(alice);
        vm.expectRevert(IVibeBonds.NotMatured.selector);
        bonds.redeem(seriesId, 10_000e18);
    }

    function test_revertRedeemZero() public {
        _buyBonds(alice, 10_000e18);
        _settleAndFund();

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.maturity);

        vm.prank(alice);
        vm.expectRevert(IVibeBonds.ZeroAmount.selector);
        bonds.redeem(seriesId, 0);
    }

    // ============ Early Redemption ============

    function test_earlyRedeem() public {
        _buyBonds(alice, 10_000e18);
        _settleAndFund();

        // Halfway through → penalty is proportional to remaining time
        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        uint256 midPoint = (uint256(s.auctionEnd) + uint256(s.maturity)) / 2;
        vm.warp(midPoint);

        (uint256 value, uint256 penalty) = bonds.earlyRedemptionValue(seriesId, 10_000e18);
        assertGt(penalty, 0);
        assertLt(value, 10_000e18);

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        bonds.earlyRedeem(seriesId, 10_000e18);

        assertEq(usdc.balanceOf(alice) - balBefore, value);
    }

    function test_earlyRedeemPenaltyDistributed() public {
        _buyBonds(alice, 5_000e18);
        _buyBonds(bob, 5_000e18);
        _settleAndFund();

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        uint256 midPoint = (uint256(s.auctionEnd) + uint256(s.maturity)) / 2;
        vm.warp(midPoint);

        // Alice early redeems → penalty goes to remaining holders (Bob)
        vm.prank(alice);
        bonds.earlyRedeem(seriesId, 5_000e18);

        // Bob should have claimable rewards from Alice's penalty
        uint256 bobClaimable = bonds.claimable(seriesId, bob);
        assertGt(bobClaimable, 0);
    }

    function test_revertEarlyRedeemZero() public {
        _buyBonds(alice, 10_000e18);
        _settleAndFund();

        vm.prank(alice);
        vm.expectRevert(IVibeBonds.ZeroAmount.selector);
        bonds.earlyRedeem(seriesId, 0);
    }

    function test_revertEarlyRedeemNotActive() public {
        _buyBonds(alice, 10_000e18);
        // Not settled yet → still in AUCTION
        vm.prank(alice);
        vm.expectRevert(IVibeBonds.NotActiveState.selector);
        bonds.earlyRedeem(seriesId, 1000e18);
    }

    // ============ Default ============

    function test_markDefaulted() public {
        _buyBonds(alice, 10_000e18);
        _settleAndFund();

        bonds.markDefaulted(seriesId);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        assertTrue(s.state == IVibeBonds.BondState.DEFAULTED);
    }

    function test_revertMarkDefaultedNotOwner() public {
        _buyBonds(alice, 10_000e18);
        _settleAndFund();

        vm.prank(alice);
        vm.expectRevert();
        bonds.markDefaulted(seriesId);
    }

    function test_revertMarkDefaultedTwice() public {
        _buyBonds(alice, 10_000e18);
        _settleAndFund();

        bonds.markDefaulted(seriesId);
        vm.expectRevert(IVibeBonds.AlreadyDefaulted.selector);
        bonds.markDefaulted(seriesId);
    }

    // ============ JUL Integration ============

    function test_depositJulRewards() public {
        bonds.depositJulRewards(1000e18);
        assertEq(bonds.julRewardPool(), 1000e18);
    }

    function test_revertDepositJulZero() public {
        vm.expectRevert(IVibeBonds.ZeroAmount.selector);
        bonds.depositJulRewards(0);
    }

    function test_setJulBoostBps() public {
        bonds.setJulBoostBps(500);
        assertEq(bonds.julBoostBps(), 500);
    }

    function test_setKeeperTipAmount() public {
        bonds.setKeeperTipAmount(10e18);
        assertEq(bonds.keeperTipAmount(), 10e18);
    }

    function test_keeperTipPaid() public {
        bonds.depositJulRewards(1000e18);
        bonds.setKeeperTipAmount(5e18);

        _buyBonds(alice, 50_000e18);
        _settleAndFund();

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(uint256(s.auctionEnd) + uint256(COUPON_INTERVAL));

        uint256 keeperBalBefore = julToken.balanceOf(keeper);
        vm.prank(keeper);
        bonds.distributeCoupon(seriesId);

        assertEq(julToken.balanceOf(keeper) - keeperBalBefore, 5e18);
    }

    // ============ Fund Reserves ============

    function test_fundCouponReserve() public {
        _buyBonds(alice, 50_000e18);
        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.auctionEnd);
        bonds.settleAuction(seriesId);

        bonds.fundCouponReserve(seriesId);

        s = bonds.getSeries(seriesId);
        assertGt(s.couponReserve, 0);
    }

    function test_revertFundCouponNotActive() public {
        vm.expectRevert(IVibeBonds.NotActiveState.selector);
        bonds.fundCouponReserve(seriesId);
    }

    function test_revertFundCouponTwice() public {
        _buyBonds(alice, 50_000e18);
        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.auctionEnd);
        bonds.settleAuction(seriesId);

        bonds.fundCouponReserve(seriesId);
        vm.expectRevert(IVibeBonds.AlreadyFunded.selector);
        bonds.fundCouponReserve(seriesId);
    }

    function test_fundPrincipalReserve() public {
        _buyBonds(alice, 10_000e18);
        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.auctionEnd);
        bonds.settleAuction(seriesId);

        bonds.fundPrincipalReserve(seriesId, 10_000e18);

        s = bonds.getSeries(seriesId);
        assertEq(s.principalReserve, 10_000e18);
    }

    function test_revertFundPrincipalInAuction() public {
        vm.expectRevert(IVibeBonds.NotActiveState.selector);
        bonds.fundPrincipalReserve(seriesId, 1000e18);
    }

    function test_revertFundPrincipalZero() public {
        _buyBonds(alice, 10_000e18);
        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.auctionEnd);
        bonds.settleAuction(seriesId);

        vm.expectRevert(IVibeBonds.ZeroAmount.selector);
        bonds.fundPrincipalReserve(seriesId, 0);
    }

    // ============ View Functions ============

    function test_yieldToMaturity() public {
        _buyBonds(alice, 50_000e18);
        _settleAndFund();

        uint256 ytm = bonds.yieldToMaturity(seriesId);
        assertGt(ytm, 0);
    }

    function test_totalSeries() public view {
        assertEq(bonds.totalSeries(), 1);
    }

    function test_revertGetNonexistentSeries() public {
        vm.expectRevert(IVibeBonds.SeriesNotFound.selector);
        bonds.getSeries(999);
    }

    // ============ Full Lifecycle ============

    function test_fullLifecycle() public {
        // 1. Auction: Alice buys at start (high rate), Bob buys later (lower rate)
        _buyBonds(alice, 30_000e18);

        vm.warp(block.timestamp + 1 days);
        _buyBonds(bob, 20_000e18);

        // 2. Settle auction
        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.auctionEnd);
        bonds.settleAuction(seriesId);

        // 3. Fund reserves
        bonds.fundCouponReserve(seriesId);
        bonds.fundPrincipalReserve(seriesId, s.totalPrincipal);

        // 4. Distribute first coupon
        vm.warp(uint256(s.auctionEnd) + uint256(COUPON_INTERVAL));
        bonds.distributeCoupon(seriesId);

        // 5. Both claim coupons
        uint256 aliceClaimable = bonds.claimable(seriesId, alice);
        uint256 bobClaimable = bonds.claimable(seriesId, bob);
        assertGt(aliceClaimable, 0);
        assertGt(bobClaimable, 0);

        vm.prank(alice);
        bonds.claimCoupon(seriesId);
        vm.prank(bob);
        bonds.claimCoupon(seriesId);

        // 6. Maturity → redeem
        vm.warp(s.maturity);

        vm.prank(alice);
        bonds.redeem(seriesId, 30_000e18);
        vm.prank(bob);
        bonds.redeem(seriesId, 20_000e18);

        // All bonds burned → REDEEMED
        s = bonds.getSeries(seriesId);
        assertTrue(s.state == IVibeBonds.BondState.REDEEMED);
    }

    // Required for ERC-1155 receiver
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }
}
