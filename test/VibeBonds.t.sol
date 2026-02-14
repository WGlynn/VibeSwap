// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/financial/VibeBonds.sol";
import "../contracts/financial/interfaces/IVibeBonds.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockBondToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Test Contract ============

contract VibeBondsTest is Test {
    VibeBonds public bonds;
    MockBondToken public token;
    MockBondToken public jul;

    address public alice;     // buyer
    address public bob;       // buyer
    address public charlie;   // keeper
    address public treasury;

    uint256 constant MAX_PRINCIPAL = 1_000_000 ether;
    uint16  constant MAX_COUPON_RATE = 1000;  // 10%
    uint16  constant MIN_COUPON_RATE = 200;   // 2%
    uint40  constant AUCTION_DURATION = 3 days;
    uint40  constant BOND_DURATION = 360 days;
    uint32  constant COUPON_INTERVAL = 30 days;
    uint16  constant EARLY_PENALTY_BPS = 1000; // 10%

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");
        treasury = makeAddr("treasury");

        jul = new MockBondToken("JUL Token", "JUL");
        token = new MockBondToken("USD Coin", "USDC");

        bonds = new VibeBonds(address(jul));

        // Mint tokens
        token.mint(alice, 10_000_000 ether);
        token.mint(bob, 10_000_000 ether);
        token.mint(treasury, 100_000_000 ether);
        jul.mint(alice, 10_000_000 ether);
        jul.mint(bob, 10_000_000 ether);
        jul.mint(treasury, 100_000_000 ether);
        jul.mint(address(this), 10_000_000 ether);

        // Approvals
        vm.prank(alice);
        token.approve(address(bonds), type(uint256).max);
        vm.prank(bob);
        token.approve(address(bonds), type(uint256).max);
        vm.prank(treasury);
        token.approve(address(bonds), type(uint256).max);
        vm.prank(alice);
        jul.approve(address(bonds), type(uint256).max);
        vm.prank(bob);
        jul.approve(address(bonds), type(uint256).max);
        vm.prank(treasury);
        jul.approve(address(bonds), type(uint256).max);
        jul.approve(address(bonds), type(uint256).max); // test contract
    }

    // ============ Helpers ============

    function _maturityTimestamp() internal view returns (uint40) {
        return uint40(block.timestamp) + AUCTION_DURATION + BOND_DURATION;
    }

    function _createDefaultSeries() internal returns (uint256 seriesId) {
        seriesId = bonds.createSeries(IVibeBonds.CreateSeriesParams({
            token: address(token),
            treasury: treasury,
            maxPrincipal: MAX_PRINCIPAL,
            maxCouponRate: MAX_COUPON_RATE,
            minCouponRate: MIN_COUPON_RATE,
            auctionDuration: AUCTION_DURATION,
            maturity: _maturityTimestamp(),
            couponInterval: COUPON_INTERVAL,
            earlyRedemptionPenaltyBps: EARLY_PENALTY_BPS
        }));
    }

    function _createJulSeries() internal returns (uint256 seriesId) {
        seriesId = bonds.createSeries(IVibeBonds.CreateSeriesParams({
            token: address(jul),
            treasury: treasury,
            maxPrincipal: MAX_PRINCIPAL,
            maxCouponRate: MAX_COUPON_RATE,
            minCouponRate: MIN_COUPON_RATE,
            auctionDuration: AUCTION_DURATION,
            maturity: _maturityTimestamp(),
            couponInterval: COUPON_INTERVAL,
            earlyRedemptionPenaltyBps: EARLY_PENALTY_BPS
        }));
    }

    function _buyBonds(address buyer, uint256 seriesId, uint256 amount) internal {
        vm.prank(buyer);
        bonds.buy(seriesId, amount);
    }

    function _settleAndFund(uint256 seriesId) internal {
        // Warp past auction
        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.auctionEnd);
        bonds.settleAuction(seriesId);

        // Fund coupon reserve
        vm.prank(treasury);
        bonds.fundCouponReserve(seriesId);

        // Fund principal reserve
        s = bonds.getSeries(seriesId);
        vm.prank(treasury);
        bonds.fundPrincipalReserve(seriesId, s.totalPrincipal);
    }

    // ============ Constructor Tests ============

    function test_constructor_zeroJulToken_reverts() public {
        vm.expectRevert(IVibeBonds.ZeroAddress.selector);
        new VibeBonds(address(0));
    }

    function test_constructor_initialState() public view {
        assertEq(bonds.totalSeries(), 0);
        assertEq(bonds.julBoostBps(), 0);
        assertEq(bonds.keeperTipAmount(), 0);
        assertEq(bonds.julRewardPool(), 0);
    }

    function test_constructor_ownership() public view {
        assertEq(bonds.owner(), address(this));
    }

    // ============ Create Series Tests ============

    function test_createSeries_valid() public {
        uint256 seriesId = _createDefaultSeries();
        assertEq(seriesId, 0);
        assertEq(bonds.totalSeries(), 1);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        assertEq(s.token, address(token));
        assertEq(s.treasury, treasury);
        assertEq(s.maxPrincipal, MAX_PRINCIPAL);
        assertEq(s.maxCouponRate, MAX_COUPON_RATE);
        assertEq(s.minCouponRate, MIN_COUPON_RATE);
        assertEq(s.couponInterval, COUPON_INTERVAL);
        assertEq(s.earlyRedemptionPenaltyBps, EARLY_PENALTY_BPS);
        assertTrue(s.state == IVibeBonds.BondState.AUCTION);
    }

    function test_createSeries_zeroPrincipal_reverts() public {
        vm.expectRevert(IVibeBonds.ZeroPrincipal.selector);
        bonds.createSeries(IVibeBonds.CreateSeriesParams({
            token: address(token),
            treasury: treasury,
            maxPrincipal: 0,
            maxCouponRate: MAX_COUPON_RATE,
            minCouponRate: MIN_COUPON_RATE,
            auctionDuration: AUCTION_DURATION,
            maturity: _maturityTimestamp(),
            couponInterval: COUPON_INTERVAL,
            earlyRedemptionPenaltyBps: EARLY_PENALTY_BPS
        }));
    }

    function test_createSeries_pastMaturity_reverts() public {
        vm.expectRevert(IVibeBonds.InvalidMaturity.selector);
        bonds.createSeries(IVibeBonds.CreateSeriesParams({
            token: address(token),
            treasury: treasury,
            maxPrincipal: MAX_PRINCIPAL,
            maxCouponRate: MAX_COUPON_RATE,
            minCouponRate: MIN_COUPON_RATE,
            auctionDuration: AUCTION_DURATION,
            maturity: uint40(block.timestamp) + AUCTION_DURATION, // maturity == auctionEnd
            couponInterval: COUPON_INTERVAL,
            earlyRedemptionPenaltyBps: EARLY_PENALTY_BPS
        }));
    }

    function test_createSeries_invalidRateRange_reverts() public {
        vm.expectRevert(IVibeBonds.InvalidRateRange.selector);
        bonds.createSeries(IVibeBonds.CreateSeriesParams({
            token: address(token),
            treasury: treasury,
            maxPrincipal: MAX_PRINCIPAL,
            maxCouponRate: 100,
            minCouponRate: 500, // min > max
            auctionDuration: AUCTION_DURATION,
            maturity: _maturityTimestamp(),
            couponInterval: COUPON_INTERVAL,
            earlyRedemptionPenaltyBps: EARLY_PENALTY_BPS
        }));
    }

    // ============ Dutch Auction Tests ============

    function test_buy_atMaxRate() public {
        uint256 seriesId = _createDefaultSeries();
        uint256 amount = 100_000 ether;

        // Buy immediately — rate should be at max
        uint256 rate = bonds.currentAuctionRate(seriesId);
        assertEq(rate, MAX_COUPON_RATE);

        _buyBonds(alice, seriesId, amount);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        assertEq(s.couponRate, MAX_COUPON_RATE);
        assertEq(s.totalPrincipal, amount);
    }

    function test_buy_rateDecreasesOverTime() public {
        uint256 seriesId = _createDefaultSeries();

        // Warp to midpoint of auction
        vm.warp(block.timestamp + uint256(AUCTION_DURATION) / 2);

        uint256 rate = bonds.currentAuctionRate(seriesId);
        uint256 expectedMidRate = uint256(MAX_COUPON_RATE) -
            (uint256(MAX_COUPON_RATE - MIN_COUPON_RATE) / 2);
        assertEq(rate, expectedMidRate);
    }

    function test_buy_fillsSeries_allowsEarlySettle() public {
        uint256 seriesId = _createDefaultSeries();

        // Fill the entire series
        _buyBonds(alice, seriesId, MAX_PRINCIPAL);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        assertEq(s.totalPrincipal, MAX_PRINCIPAL);

        // Should be able to settle immediately (filled)
        bonds.settleAuction(seriesId);
        s = bonds.getSeries(seriesId);
        assertTrue(s.state == IVibeBonds.BondState.ACTIVE);
    }

    function test_auction_rateAtExpiry() public {
        uint256 seriesId = _createDefaultSeries();

        // Warp to auction end
        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.auctionEnd);

        uint256 rate = bonds.currentAuctionRate(seriesId);
        assertEq(rate, MIN_COUPON_RATE);
    }

    function test_settleAuction_transitionsState() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 500_000 ether);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.auctionEnd);

        uint256 treasuryBefore = token.balanceOf(treasury);
        bonds.settleAuction(seriesId);
        uint256 treasuryAfter = token.balanceOf(treasury);

        s = bonds.getSeries(seriesId);
        assertTrue(s.state == IVibeBonds.BondState.ACTIVE);
        assertEq(treasuryAfter - treasuryBefore, 500_000 ether);
    }

    // ============ Buy Tests ============

    function test_buy_correctMintAndTransfer() public {
        uint256 seriesId = _createDefaultSeries();
        uint256 amount = 200_000 ether;

        uint256 aliceBefore = token.balanceOf(alice);
        _buyBonds(alice, seriesId, amount);
        uint256 aliceAfter = token.balanceOf(alice);

        assertEq(bonds.balanceOf(alice, seriesId), amount);
        assertEq(aliceBefore - aliceAfter, amount);
    }

    function test_buy_afterAuction_reverts() public {
        uint256 seriesId = _createDefaultSeries();
        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.auctionEnd);

        vm.expectRevert(IVibeBonds.NotInAuctionPhase.selector);
        _buyBonds(alice, seriesId, 100_000 ether);
    }

    function test_buy_overCap_reverts() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 900_000 ether);

        vm.expectRevert(IVibeBonds.ExceedsMaxPrincipal.selector);
        _buyBonds(bob, seriesId, 200_000 ether);
    }

    function test_buy_multipleBuyers_uniformClearing() public {
        uint256 seriesId = _createDefaultSeries();

        // Alice buys at max rate
        _buyBonds(alice, seriesId, 300_000 ether);

        // Warp to midpoint — Bob buys at lower rate
        vm.warp(block.timestamp + uint256(AUCTION_DURATION) / 2);
        uint256 midRate = bonds.currentAuctionRate(seriesId);
        _buyBonds(bob, seriesId, 200_000 ether);

        // Clearing rate should be Bob's rate (last buyer)
        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        assertEq(s.couponRate, midRate);
        assertEq(s.totalPrincipal, 500_000 ether);
        assertEq(bonds.balanceOf(alice, seriesId), 300_000 ether);
        assertEq(bonds.balanceOf(bob, seriesId), 200_000 ether);
    }

    // ============ Coupon Distribution Tests ============

    function test_distributeCoupon_afterInterval() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 500_000 ether);
        _settleAndFund(seriesId);

        // Warp past first coupon interval
        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(uint256(s.auctionEnd) + COUPON_INTERVAL);

        bonds.distributeCoupon(seriesId);

        s = bonds.getSeries(seriesId);
        assertEq(s.couponsDistributed, 1);

        uint256 claim = bonds.claimable(seriesId, alice);
        assertGt(claim, 0);
    }

    function test_distributeCoupon_tooEarly_reverts() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 500_000 ether);
        _settleAndFund(seriesId);

        // Don't warp far enough
        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(uint256(s.auctionEnd) + COUPON_INTERVAL - 1);

        vm.expectRevert(IVibeBonds.CouponTooEarly.selector);
        bonds.distributeCoupon(seriesId);
    }

    function test_distributeCoupon_keeperTipPaid() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 500_000 ether);
        _settleAndFund(seriesId);

        // Setup keeper tips
        uint256 tipAmount = 10 ether;
        bonds.setKeeperTipAmount(tipAmount);
        bonds.depositJulRewards(1000 ether);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(uint256(s.auctionEnd) + COUPON_INTERVAL);

        uint256 charlieJulBefore = jul.balanceOf(charlie);
        vm.prank(charlie);
        bonds.distributeCoupon(seriesId);
        uint256 charlieJulAfter = jul.balanceOf(charlie);

        assertEq(charlieJulAfter - charlieJulBefore, tipAmount);
    }

    function test_distributeCoupon_multipleAccumulate() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 500_000 ether);
        _settleAndFund(seriesId);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);

        // Distribute 3 coupons
        for (uint256 i = 1; i <= 3; i++) {
            vm.warp(uint256(s.auctionEnd) + uint256(COUPON_INTERVAL) * i);
            bonds.distributeCoupon(seriesId);
        }

        s = bonds.getSeries(seriesId);
        assertEq(s.couponsDistributed, 3);

        uint256 oneCoupon = bonds.claimable(seriesId, alice);
        // Should be ~3x a single coupon
        assertGt(oneCoupon, 0);
    }

    function test_distributeCoupon_proRata() public {
        uint256 seriesId = _createDefaultSeries();
        // Alice buys 3x Bob's amount
        _buyBonds(alice, seriesId, 300_000 ether);
        _buyBonds(bob, seriesId, 100_000 ether);
        _settleAndFund(seriesId);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(uint256(s.auctionEnd) + COUPON_INTERVAL);
        bonds.distributeCoupon(seriesId);

        uint256 aliceClaim = bonds.claimable(seriesId, alice);
        uint256 bobClaim = bonds.claimable(seriesId, bob);

        // Alice should get 3x Bob's share
        assertApproxEqAbs(aliceClaim, bobClaim * 3, 1);
    }

    function test_claimCoupon_afterTransfer() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 500_000 ether);
        _settleAndFund(seriesId);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(uint256(s.auctionEnd) + COUPON_INTERVAL);
        bonds.distributeCoupon(seriesId);

        // Alice earned coupon, then transfers half her bonds to Bob
        uint256 aliceClaimBefore = bonds.claimable(seriesId, alice);
        assertGt(aliceClaimBefore, 0);

        vm.prank(alice);
        bonds.safeTransferFrom(alice, bob, seriesId, 250_000 ether, "");

        // Alice should still have her accumulated reward
        uint256 aliceClaimAfter = bonds.claimable(seriesId, alice);
        assertEq(aliceClaimAfter, aliceClaimBefore);

        // Bob should have 0 (just received, no coupon period elapsed)
        assertEq(bonds.claimable(seriesId, bob), 0);

        // Next coupon — should be split 50/50
        vm.warp(uint256(s.auctionEnd) + uint256(COUPON_INTERVAL) * 2);
        bonds.distributeCoupon(seriesId);

        uint256 aliceNew = bonds.claimable(seriesId, alice) - aliceClaimBefore;
        uint256 bobNew = bonds.claimable(seriesId, bob);
        assertApproxEqAbs(aliceNew, bobNew, 1);
    }

    // ============ Redeem Tests ============

    function test_redeem_afterMaturity() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 500_000 ether);
        _settleAndFund(seriesId);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);

        // Distribute all coupons first
        uint256 maxPeriods = (s.maturity - s.auctionEnd) / s.couponInterval;
        for (uint256 i = 1; i <= maxPeriods; i++) {
            vm.warp(uint256(s.auctionEnd) + uint256(COUPON_INTERVAL) * i);
            bonds.distributeCoupon(seriesId);
        }

        // Warp to maturity
        vm.warp(s.maturity);

        uint256 aliceBefore = token.balanceOf(alice);
        vm.prank(alice);
        bonds.redeem(seriesId, 500_000 ether);
        uint256 aliceAfter = token.balanceOf(alice);

        // Should get principal + all coupons
        assertGt(aliceAfter - aliceBefore, 500_000 ether);
        assertEq(bonds.balanceOf(alice, seriesId), 0);

        s = bonds.getSeries(seriesId);
        assertTrue(s.state == IVibeBonds.BondState.REDEEMED);
    }

    function test_redeem_beforeMaturity_reverts() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 500_000 ether);
        _settleAndFund(seriesId);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(uint256(s.maturity) - 1);

        vm.prank(alice);
        vm.expectRevert(IVibeBonds.NotMatured.selector);
        bonds.redeem(seriesId, 500_000 ether);
    }

    function test_redeem_partial() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 500_000 ether);
        _settleAndFund(seriesId);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.maturity);

        vm.prank(alice);
        bonds.redeem(seriesId, 200_000 ether);

        assertEq(bonds.balanceOf(alice, seriesId), 300_000 ether);
        s = bonds.getSeries(seriesId);
        assertTrue(s.state == IVibeBonds.BondState.MATURED); // not fully redeemed
    }

    function test_redeem_burnsTokens() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 500_000 ether);
        _settleAndFund(seriesId);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.maturity);

        uint256 supplyBefore = bonds.totalSupply(seriesId);
        vm.prank(alice);
        bonds.redeem(seriesId, 200_000 ether);
        uint256 supplyAfter = bonds.totalSupply(seriesId);

        assertEq(supplyBefore - supplyAfter, 200_000 ether);
    }

    // ============ Early Redemption Tests ============

    function test_earlyRedeem_penaltyDecreasesOverTime() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 500_000 ether);
        _settleAndFund(seriesId);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        uint256 amount = 100_000 ether;

        // Early in the bond — high penalty
        (, uint256 penaltyEarly) = bonds.earlyRedemptionValue(seriesId, amount);

        // Warp to halfway through
        uint256 halfDuration = (s.maturity - s.auctionEnd) / 2;
        vm.warp(uint256(s.auctionEnd) + halfDuration);
        (, uint256 penaltyMid) = bonds.earlyRedemptionValue(seriesId, amount);

        // Warp to near maturity
        vm.warp(uint256(s.maturity) - 1 days);
        (, uint256 penaltyLate) = bonds.earlyRedemptionValue(seriesId, amount);

        assertGt(penaltyEarly, penaltyMid);
        assertGt(penaltyMid, penaltyLate);
    }

    function test_earlyRedeem_penaltyToRemainingHolders() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 300_000 ether);
        _buyBonds(bob, seriesId, 200_000 ether);
        _settleAndFund(seriesId);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);

        // Distribute a coupon first so we have baseline
        vm.warp(uint256(s.auctionEnd) + COUPON_INTERVAL);
        bonds.distributeCoupon(seriesId);

        uint256 bobClaimBefore = bonds.claimable(seriesId, bob);

        // Alice early redeems — penalty should go to Bob
        vm.prank(alice);
        bonds.earlyRedeem(seriesId, 300_000 ether);

        uint256 bobClaimAfter = bonds.claimable(seriesId, bob);
        assertGt(bobClaimAfter, bobClaimBefore); // Bob's rewards increased from penalty
    }

    function test_earlyRedeem_full() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 500_000 ether);
        _settleAndFund(seriesId);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(uint256(s.auctionEnd) + 30 days);

        (uint256 expectedValue, uint256 expectedPenalty) = bonds.earlyRedemptionValue(seriesId, 500_000 ether);

        uint256 aliceBefore = token.balanceOf(alice);
        vm.prank(alice);
        bonds.earlyRedeem(seriesId, 500_000 ether);
        uint256 aliceAfter = token.balanceOf(alice);

        // Alice gets value (principal minus penalty) — penalty has no remaining holders
        assertGe(aliceAfter - aliceBefore, expectedValue);
        assertEq(bonds.balanceOf(alice, seriesId), 0);
        assertGt(expectedPenalty, 0);
    }

    function test_earlyRedeem_nearMaturity() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 500_000 ether);
        _settleAndFund(seriesId);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);

        // Warp to 1 day before maturity
        vm.warp(uint256(s.maturity) - 1 days);

        // Check view returns sensible values
        (uint256 value, uint256 penalty) = bonds.earlyRedemptionValue(seriesId, 100_000 ether);
        assertGt(value, 0);
        assertGt(penalty, 0);
        assertEq(value + penalty, 100_000 ether);

        // Penalty near maturity should be much less than at start
        assertLt(penalty, 100_000 ether / 100); // < 1% of principal near maturity

        // Actually execute the early redeem
        vm.prank(alice);
        bonds.earlyRedeem(seriesId, 100_000 ether);
        assertEq(bonds.balanceOf(alice, seriesId), 400_000 ether);
    }

    // ============ ERC-1155 Tests ============

    function test_transfer_updatesRewardTracking() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 500_000 ether);
        _settleAndFund(seriesId);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);

        // Distribute coupon
        vm.warp(uint256(s.auctionEnd) + COUPON_INTERVAL);
        bonds.distributeCoupon(seriesId);

        // Transfer all bonds from Alice to Bob
        vm.prank(alice);
        bonds.safeTransferFrom(alice, bob, seriesId, 500_000 ether, "");

        // Alice should still be able to claim her coupon
        uint256 aliceClaim = bonds.claimable(seriesId, alice);
        assertGt(aliceClaim, 0);

        vm.prank(alice);
        bonds.claimCoupon(seriesId);
        assertEq(token.balanceOf(alice) > 0, true);
    }

    function test_balanceOf_multipleSeries() public {
        uint256 series0 = _createDefaultSeries();
        uint256 series1 = _createDefaultSeries();

        _buyBonds(alice, series0, 100_000 ether);
        _buyBonds(alice, series1, 200_000 ether);

        assertEq(bonds.balanceOf(alice, series0), 100_000 ether);
        assertEq(bonds.balanceOf(alice, series1), 200_000 ether);
    }

    // ============ Integration Tests ============

    function test_fullLifecycle() public {
        // CREATE
        uint256 seriesId = _createDefaultSeries();

        // AUCTION — Alice buys at max rate, Bob buys later at lower rate
        _buyBonds(alice, seriesId, 300_000 ether);
        vm.warp(block.timestamp + uint256(AUCTION_DURATION) / 2);
        _buyBonds(bob, seriesId, 200_000 ether);

        // SETTLE
        _settleAndFund(seriesId);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        assertTrue(s.state == IVibeBonds.BondState.ACTIVE);

        // COUPONS — distribute a few periods
        for (uint256 i = 1; i <= 3; i++) {
            vm.warp(uint256(s.auctionEnd) + uint256(COUPON_INTERVAL) * i);
            bonds.distributeCoupon(seriesId);
        }

        // Claim coupons
        uint256 aliceClaim = bonds.claimable(seriesId, alice);
        uint256 bobClaim = bonds.claimable(seriesId, bob);
        assertGt(aliceClaim, bobClaim); // Alice has more bonds

        vm.prank(alice);
        bonds.claimCoupon(seriesId);
        vm.prank(bob);
        bonds.claimCoupon(seriesId);

        // Distribute remaining coupons
        uint256 maxPeriods = (s.maturity - s.auctionEnd) / s.couponInterval;
        for (uint256 i = 4; i <= maxPeriods; i++) {
            vm.warp(uint256(s.auctionEnd) + uint256(COUPON_INTERVAL) * i);
            bonds.distributeCoupon(seriesId);
        }

        // REDEEM at maturity
        vm.warp(s.maturity);

        vm.prank(alice);
        bonds.redeem(seriesId, 300_000 ether);
        vm.prank(bob);
        bonds.redeem(seriesId, 200_000 ether);

        s = bonds.getSeries(seriesId);
        assertTrue(s.state == IVibeBonds.BondState.REDEEMED);
        assertEq(bonds.totalSupply(seriesId), 0);
    }

    function test_multiHolderWithTransfers() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 600_000 ether);
        _settleAndFund(seriesId);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);

        // Distribute first coupon — all to Alice
        vm.warp(uint256(s.auctionEnd) + COUPON_INTERVAL);
        bonds.distributeCoupon(seriesId);

        uint256 aliceFirstCoupon = bonds.claimable(seriesId, alice);
        assertGt(aliceFirstCoupon, 0);

        // Alice transfers half to Bob
        vm.prank(alice);
        bonds.safeTransferFrom(alice, bob, seriesId, 300_000 ether, "");

        // Second coupon — split 50/50
        vm.warp(uint256(s.auctionEnd) + uint256(COUPON_INTERVAL) * 2);
        bonds.distributeCoupon(seriesId);

        uint256 aliceTotal = bonds.claimable(seriesId, alice);
        uint256 bobTotal = bonds.claimable(seriesId, bob);

        // Alice: first full coupon + half of second coupon
        // Bob: half of second coupon
        assertGt(aliceTotal, bobTotal);

        // Both can claim
        vm.prank(alice);
        bonds.claimCoupon(seriesId);
        vm.prank(bob);
        bonds.claimCoupon(seriesId);

        assertEq(bonds.claimable(seriesId, alice), 0);
        assertEq(bonds.claimable(seriesId, bob), 0);
    }

    function test_earlyRedeemYieldBoost() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 400_000 ether);
        _buyBonds(bob, seriesId, 100_000 ether);
        _settleAndFund(seriesId);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);

        // Distribute a coupon
        vm.warp(uint256(s.auctionEnd) + COUPON_INTERVAL);
        bonds.distributeCoupon(seriesId);

        // Bob's claimable before Alice exits
        uint256 bobBefore = bonds.claimable(seriesId, bob);

        // Alice early redeems — penalty goes to Bob
        vm.warp(uint256(s.auctionEnd) + uint256(COUPON_INTERVAL) * 2);
        vm.prank(alice);
        bonds.earlyRedeem(seriesId, 400_000 ether);

        // Bob's claimable should include penalty boost
        uint256 bobAfter = bonds.claimable(seriesId, bob);
        assertGt(bobAfter, bobBefore);

        // Next coupon — Bob gets ALL of it (only holder remaining)
        vm.warp(uint256(s.auctionEnd) + uint256(COUPON_INTERVAL) * 3);
        bonds.distributeCoupon(seriesId);

        uint256 bobFinal = bonds.claimable(seriesId, bob);
        assertGt(bobFinal, bobAfter);
    }

    // ============ JUL Integration Tests ============

    function test_julBoost_higherYield() public {
        uint256 seriesId = _createJulSeries();
        _buyBonds(alice, seriesId, 500_000 ether);

        // Settle and fund (JUL tokens)
        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.auctionEnd);
        bonds.settleAuction(seriesId);
        vm.prank(treasury);
        bonds.fundCouponReserve(seriesId);
        s = bonds.getSeries(seriesId);
        vm.prank(treasury);
        bonds.fundPrincipalReserve(seriesId, s.totalPrincipal);

        // Setup JUL boost
        bonds.setJulBoostBps(500); // 5% boost
        bonds.depositJulRewards(1_000_000 ether);

        // Distribute coupon — should include JUL boost
        vm.warp(uint256(s.auctionEnd) + COUPON_INTERVAL);
        bonds.distributeCoupon(seriesId);

        // Create identical non-JUL series for comparison baseline
        uint256 seriesId2 = _createDefaultSeries();
        _buyBonds(alice, seriesId2, 500_000 ether);

        IVibeBonds.BondSeries memory s2 = bonds.getSeries(seriesId2);
        vm.warp(s2.auctionEnd);
        bonds.settleAuction(seriesId2);
        vm.prank(treasury);
        bonds.fundCouponReserve(seriesId2);

        vm.warp(uint256(s2.auctionEnd) + COUPON_INTERVAL);
        bonds.distributeCoupon(seriesId2);

        uint256 julClaim = bonds.claimable(seriesId, alice);
        uint256 usdcClaim = bonds.claimable(seriesId2, alice);

        // JUL bond should yield more due to boost
        assertGt(julClaim, usdcClaim);
    }

    function test_keeperTip_paidInJul() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 500_000 ether);
        _settleAndFund(seriesId);

        // Setup JUL rewards
        uint256 tipAmount = 5 ether;
        bonds.setKeeperTipAmount(tipAmount);
        bonds.depositJulRewards(100 ether);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(uint256(s.auctionEnd) + COUPON_INTERVAL);

        uint256 charlieJulBefore = jul.balanceOf(charlie);
        vm.prank(charlie);
        bonds.distributeCoupon(seriesId);

        assertEq(jul.balanceOf(charlie) - charlieJulBefore, tipAmount);
        assertEq(bonds.julRewardPool(), 100 ether - tipAmount);
    }

    // ============ Edge Case Tests ============

    function test_settleAuction_noPrincipal_reverts() public {
        uint256 seriesId = _createDefaultSeries();
        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.auctionEnd);

        vm.expectRevert(IVibeBonds.NoPrincipalRaised.selector);
        bonds.settleAuction(seriesId);
    }

    function test_settleAuction_tooEarly_reverts() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 100_000 ether);

        vm.expectRevert(IVibeBonds.AuctionStillActive.selector);
        bonds.settleAuction(seriesId);
    }

    function test_allCouponsDistributed_reverts() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 500_000 ether);
        _settleAndFund(seriesId);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        uint256 maxPeriods = (s.maturity - s.auctionEnd) / s.couponInterval;

        // Distribute all coupons
        for (uint256 i = 1; i <= maxPeriods; i++) {
            vm.warp(uint256(s.auctionEnd) + uint256(COUPON_INTERVAL) * i);
            bonds.distributeCoupon(seriesId);
        }

        // One more should revert
        vm.warp(uint256(s.maturity) + COUPON_INTERVAL);
        vm.expectRevert(IVibeBonds.AllCouponsDistributed.selector);
        bonds.distributeCoupon(seriesId);
    }

    function test_markDefaulted() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 500_000 ether);

        IVibeBonds.BondSeries memory s = bonds.getSeries(seriesId);
        vm.warp(s.auctionEnd);
        bonds.settleAuction(seriesId);

        bonds.markDefaulted(seriesId);

        s = bonds.getSeries(seriesId);
        assertTrue(s.state == IVibeBonds.BondState.DEFAULTED);
    }

    function test_yieldToMaturity() public {
        uint256 seriesId = _createDefaultSeries();
        _buyBonds(alice, seriesId, 500_000 ether);
        _settleAndFund(seriesId);

        uint256 ytm = bonds.yieldToMaturity(seriesId);
        assertGt(ytm, 0);
    }
}
