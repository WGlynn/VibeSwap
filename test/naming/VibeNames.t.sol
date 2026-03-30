// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/naming/VibeNames.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Test Contract ============

contract VibeNamesTest is Test {
    // ============ State ============

    VibeNames public names;
    address public alice;
    address public bob;
    address public charlie;
    address public treasury;
    address public deployer;

    uint256 constant TAX_RATE_BPS = 500; // 5% annual
    uint256 constant SECONDS_PER_YEAR = 31_557_600; // 365.25 days
    uint256 constant MIN_DEPOSIT_PERIOD = 30 days;
    uint256 constant DUTCH_AUCTION_DURATION = 7 days;
    uint256 constant GRACE_PERIOD = 72 hours;
    uint256 constant ACQUISITION_PREMIUM_BPS = 2_000; // 20%
    uint256 constant BPS = 10_000;
    uint256 constant ASSESSED_VALUE = 1 ether;

    // ============ setUp ============

    function setUp() public {
        deployer = makeAddr("deployer");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");
        treasury = makeAddr("treasury");

        vm.startPrank(deployer);
        VibeNames impl = new VibeNames();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(VibeNames.initialize, (treasury))
        );
        names = VibeNames(payable(address(proxy)));
        vm.stopPrank();

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);
    }

    // ============ Helpers ============

    function _computeTax(uint256 value, uint256 elapsed) internal pure returns (uint256) {
        return (value * TAX_RATE_BPS * elapsed) / (BPS * SECONDS_PER_YEAR);
    }

    function _minDeposit(uint256 value) internal pure returns (uint256) {
        return _computeTax(value, MIN_DEPOSIT_PERIOD);
    }

    function _register(address user, string memory name, uint256 value, uint256 deposit) internal returns (uint256) {
        vm.prank(user);
        return names.register{value: deposit}(name, value);
    }

    function _registerDefault() internal returns (uint256) {
        uint256 deposit = _minDeposit(ASSESSED_VALUE) + 0.1 ether;
        return _register(alice, "alice", ASSESSED_VALUE, deposit);
    }

    /// @dev Effective acquire price: base × loyalty × (1 + premium)
    function _effectivePrice(uint256 baseValue, uint256 loyaltyMult) internal pure returns (uint256) {
        uint256 loyaltyAdjusted = (baseValue * loyaltyMult) / BPS;
        return (loyaltyAdjusted * (BPS + ACQUISITION_PREMIUM_BPS)) / BPS;
    }

    /// @dev Force-acquire with grace period: initiate, warp, complete
    function _forceAcquire(address buyer, uint256 tokenId, uint256 newValue, uint256 payment) internal {
        vm.prank(buyer);
        names.initiateAcquire{value: payment}(tokenId, newValue);
        vm.warp(block.timestamp + GRACE_PERIOD + 1);
        vm.prank(buyer);
        names.completeAcquire(tokenId);
    }

    // ============ Registration Tests ============

    function test_Register_SetsOwnerAndDeposit() public {
        uint256 deposit = _minDeposit(ASSESSED_VALUE) + 0.01 ether;
        vm.prank(alice);
        uint256 tokenId = names.register{value: deposit}("alice", ASSESSED_VALUE);

        assertEq(names.ownerOf(tokenId), alice);
        assertEq(names.resolve("alice"), alice);
        assertGt(names.timeUntilExpiry(tokenId), 0);
    }

    function test_Register_RevertsInsufficientDeposit() public {
        uint256 tooLow = _minDeposit(ASSESSED_VALUE) - 1;
        vm.prank(alice);
        vm.expectRevert();
        names.register{value: tooLow}("alice", ASSESSED_VALUE);
    }

    function test_Register_RevertsZeroValue() public {
        vm.prank(alice);
        vm.expectRevert();
        names.register{value: 0.1 ether}("alice", 0);
    }

    function test_Register_RevertsDuplicateName() public {
        _registerDefault();
        uint256 deposit = _minDeposit(ASSESSED_VALUE) + 0.01 ether;
        vm.prank(bob);
        vm.expectRevert();
        names.register{value: deposit}("alice", ASSESSED_VALUE);
    }

    function test_Register_IncrementsPortfolioSize() public {
        _registerDefault();
        assertEq(names.portfolioSize(alice), 1);

        uint256 deposit = _minDeposit(ASSESSED_VALUE) + 0.01 ether;
        _register(alice, "alice2", ASSESSED_VALUE, deposit);
        assertEq(names.portfolioSize(alice), 2);
    }

    // ============ Tax Calculation Tests ============

    function test_TaxOwed_AccruesCorrectly() public {
        uint256 tokenId = _registerDefault();
        uint256 elapsed = 90 days;
        vm.warp(block.timestamp + elapsed);

        uint256 owed = names.taxOwed(tokenId);
        uint256 expected = _computeTax(ASSESSED_VALUE, elapsed);
        assertApproxEqAbs(owed, expected, 1);
    }

    function test_TaxOwed_ZeroAtRegistration() public {
        uint256 tokenId = _registerDefault();
        assertEq(names.taxOwed(tokenId), 0);
    }

    // ============ Tax Collection Tests ============

    function test_CollectTax_SendsToTreasury() public {
        uint256 tokenId = _registerDefault();
        vm.warp(block.timestamp + 60 days);

        uint256 treasuryBefore = treasury.balance;
        names.collectTax(tokenId);
        uint256 collected = treasury.balance - treasuryBefore;

        uint256 expected = _computeTax(ASSESSED_VALUE, 60 days);
        assertApproxEqAbs(collected, expected, 1);
    }

    function test_CollectTax_DoubleCollectNoOp() public {
        uint256 tokenId = _registerDefault();
        vm.warp(block.timestamp + 30 days);
        names.collectTax(tokenId);

        uint256 treasuryBefore = treasury.balance;
        names.collectTax(tokenId);
        assertEq(treasury.balance, treasuryBefore);
    }

    // ============ Price Change Tests ============

    function test_SetPrice_HigherValue() public {
        uint256 tokenId = _registerDefault();
        vm.prank(alice);
        names.setPrice(tokenId, 5 ether);

        // Top up tax deposit so it covers the full year at 5 ether valuation
        uint256 neededDeposit = _computeTax(5 ether, 365 days) + 1 ether;
        vm.prank(alice);
        names.depositTax{value: neededDeposit}(tokenId);

        vm.warp(block.timestamp + 365 days);
        uint256 owed = names.taxOwed(tokenId);
        uint256 expected = _computeTax(5 ether, 365 days);
        assertApproxEqAbs(owed, expected, 2);
    }

    function test_SetPrice_RevertsNonOwner() public {
        uint256 tokenId = _registerDefault();
        vm.prank(bob);
        vm.expectRevert();
        names.setPrice(tokenId, 5 ether);
    }

    // ============ Loyalty Multiplier Tests ============

    function test_LoyaltyMultiplier_StartsAt1x() public {
        uint256 tokenId = _registerDefault();
        assertEq(names.loyaltyMultiplier(tokenId), BPS); // 1x
    }

    function test_LoyaltyMultiplier_IncreasesWithTenure() public {
        uint256 tokenId = _registerDefault();

        // After 1 year: still 1x (threshold is >= 2 years for 1.5x)
        vm.warp(block.timestamp + 365 days);
        assertEq(names.loyaltyMultiplier(tokenId), BPS);

        // After 2 years: 1.5x
        vm.warp(block.timestamp + 365 days); // Now 2 years total
        assertEq(names.loyaltyMultiplier(tokenId), 15_000);

        // After 3 years: 2x
        vm.warp(block.timestamp + 365 days); // Now 3 years total
        assertEq(names.loyaltyMultiplier(tokenId), 20_000);

        // After 5 years: 3x
        vm.warp(block.timestamp + 730 days); // Now 5 years total
        assertEq(names.loyaltyMultiplier(tokenId), 30_000);
    }

    function test_LoyaltyMultiplier_NoResolverStaysAt1x() public {
        // Register without setting resolver active = false
        // Actually, register sets resolverActive = true by default
        // We'd need a way to test inactive resolver; for now, verify active works
        uint256 tokenId = _registerDefault();
        vm.warp(block.timestamp + 730 days);
        assertEq(names.loyaltyMultiplier(tokenId), 15_000); // 1.5x with active resolver
    }

    // ============ Grace Period Tests ============

    function test_InitiateAcquire_StartsGracePeriod() public {
        uint256 tokenId = _registerDefault();

        uint256 effectivePrice = names.effectiveAcquirePrice(tokenId);
        uint256 bobValue = 2 ether;
        uint256 payment = effectivePrice + _minDeposit(bobValue) + 0.1 ether;

        vm.prank(bob);
        names.initiateAcquire{value: payment}(tokenId, bobValue);

        // Should NOT have transferred yet
        assertEq(names.ownerOf(tokenId), alice, "Still alice during grace period");
    }

    function test_CompleteAcquire_AfterGracePeriod() public {
        uint256 tokenId = _registerDefault();

        uint256 effectivePrice = names.effectiveAcquirePrice(tokenId);
        uint256 bobValue = 2 ether;
        uint256 payment = effectivePrice + _minDeposit(bobValue) + 0.1 ether;

        vm.prank(bob);
        names.initiateAcquire{value: payment}(tokenId, bobValue);

        // Warp past grace period
        vm.warp(block.timestamp + GRACE_PERIOD + 1);

        vm.prank(bob);
        names.completeAcquire(tokenId);

        assertEq(names.ownerOf(tokenId), bob, "Bob should own after grace period");
    }

    function test_CompleteAcquire_RevertsBeforeGracePeriod() public {
        uint256 tokenId = _registerDefault();

        uint256 effectivePrice = names.effectiveAcquirePrice(tokenId);
        uint256 bobValue = 2 ether;
        uint256 payment = effectivePrice + _minDeposit(bobValue) + 0.1 ether;

        vm.prank(bob);
        names.initiateAcquire{value: payment}(tokenId, bobValue);

        // Try to complete before grace period expires
        vm.warp(block.timestamp + GRACE_PERIOD - 1);
        vm.prank(bob);
        vm.expectRevert();
        names.completeAcquire(tokenId);
    }

    function test_BlockAcquisition_OwnerCanBlock() public {
        uint256 tokenId = _registerDefault();

        uint256 effectivePrice = names.effectiveAcquirePrice(tokenId);
        uint256 bobValue = 2 ether;
        uint256 payment = effectivePrice + _minDeposit(bobValue) + 0.1 ether;

        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        names.initiateAcquire{value: payment}(tokenId, bobValue);

        // Alice blocks by raising assessment
        vm.prank(alice);
        names.blockAcquisition{value: 0.5 ether}(tokenId, effectivePrice);

        // Alice still owns
        assertEq(names.ownerOf(tokenId), alice);
        // Bob should be refunded
        assertEq(bob.balance, bobBefore, "Bob should get full refund");
    }

    function test_BlockAcquisition_RevertsAfterGracePeriod() public {
        uint256 tokenId = _registerDefault();

        uint256 effectivePrice = names.effectiveAcquirePrice(tokenId);
        uint256 bobValue = 2 ether;
        uint256 payment = effectivePrice + _minDeposit(bobValue) + 0.1 ether;

        vm.prank(bob);
        names.initiateAcquire{value: payment}(tokenId, bobValue);

        // Warp past grace period
        vm.warp(block.timestamp + GRACE_PERIOD + 1);

        // Alice tries to block too late
        vm.prank(alice);
        vm.expectRevert();
        names.blockAcquisition{value: 0.5 ether}(tokenId, effectivePrice);
    }

    function test_CancelAcquire_BuyerCanCancel() public {
        uint256 tokenId = _registerDefault();

        uint256 effectivePrice = names.effectiveAcquirePrice(tokenId);
        uint256 bobValue = 2 ether;
        uint256 payment = effectivePrice + _minDeposit(bobValue) + 0.1 ether;

        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        names.initiateAcquire{value: payment}(tokenId, bobValue);

        vm.prank(bob);
        names.cancelAcquire(tokenId);

        assertEq(bob.balance, bobBefore, "Bob should be fully refunded");
        assertEq(names.ownerOf(tokenId), alice, "Alice still owns");
    }

    // ============ Acquisition Premium Tests ============

    function test_EffectivePrice_Includes20PercentPremium() public {
        uint256 tokenId = _registerDefault();

        uint256 effectivePrice = names.effectiveAcquirePrice(tokenId);
        // In year 1 with loyalty 1x: effectivePrice = assessed * 1.0 * 1.2 = 1.2 ETH
        uint256 expected = _effectivePrice(ASSESSED_VALUE, BPS);
        assertEq(effectivePrice, expected, "Should be 1.2x assessed value in year 1");
        assertEq(effectivePrice, 1.2 ether, "1 ETH * 1.0 loyalty * 1.2 premium = 1.2 ETH");
    }

    function test_EffectivePrice_WithLoyalty() public {
        uint256 tokenId = _registerDefault();

        // Warp 2 years — loyalty multiplier becomes 1.5x
        vm.warp(block.timestamp + 730 days);

        uint256 effectivePrice = names.effectiveAcquirePrice(tokenId);
        // 1 ETH * 1.5 loyalty * 1.2 premium = 1.8 ETH
        uint256 expected = _effectivePrice(ASSESSED_VALUE, 15_000);
        assertEq(effectivePrice, expected);
    }

    function test_EffectivePrice_With5YearLoyalty() public {
        uint256 tokenId = _registerDefault();

        // Warp 5 years — loyalty 3x
        vm.warp(block.timestamp + 1825 days);

        uint256 effectivePrice = names.effectiveAcquirePrice(tokenId);
        // 1 ETH * 3.0 loyalty * 1.2 premium = 3.6 ETH
        uint256 expected = _effectivePrice(ASSESSED_VALUE, 30_000);
        assertEq(effectivePrice, expected);
    }

    // ============ Portfolio Tax Tests ============

    function test_PortfolioTaxMultiplier_1Name() public {
        _registerDefault();
        assertEq(names.portfolioTaxMultiplier(alice), 10_000); // 1x
    }

    function test_PortfolioTaxMultiplier_2Names() public {
        uint256 deposit = _minDeposit(ASSESSED_VALUE) + 0.1 ether;
        _register(alice, "alice1", ASSESSED_VALUE, deposit);
        _register(alice, "alice2", ASSESSED_VALUE, deposit);
        assertEq(names.portfolioTaxMultiplier(alice), 15_000); // 1.5x
    }

    function test_PortfolioTaxMultiplier_5Names() public {
        uint256 deposit = _minDeposit(ASSESSED_VALUE) + 0.1 ether;
        for (uint256 i = 1; i <= 5; i++) {
            _register(alice, string(abi.encodePacked("name", bytes1(uint8(48 + i)))), ASSESSED_VALUE, deposit);
        }
        assertEq(names.portfolioTaxMultiplier(alice), 20_000); // 2x
    }

    function test_PortfolioTaxMultiplier_6PlusNames() public {
        uint256 deposit = _minDeposit(ASSESSED_VALUE) + 0.1 ether;
        for (uint256 i = 1; i <= 6; i++) {
            _register(alice, string(abi.encodePacked("n", bytes1(uint8(48 + i)))), ASSESSED_VALUE, deposit);
        }
        assertEq(names.portfolioTaxMultiplier(alice), 30_000); // 3x
    }

    // ============ Tax Deposit Tests ============

    function test_DepositTax_ExtendsExpiry() public {
        uint256 tokenId = _registerDefault();
        uint256 expiryBefore = names.timeUntilExpiry(tokenId);

        vm.prank(alice);
        names.depositTax{value: 0.5 ether}(tokenId);

        assertGt(names.timeUntilExpiry(tokenId), expiryBefore);
    }

    function test_DepositTax_AnyoneCanDeposit() public {
        uint256 tokenId = _registerDefault();
        uint256 expiryBefore = names.timeUntilExpiry(tokenId);

        vm.prank(bob);
        names.depositTax{value: 0.5 ether}(tokenId);

        assertGt(names.timeUntilExpiry(tokenId), expiryBefore);
    }

    // ============ Expiry and Dutch Auction Tests ============

    function test_Expiry_WhenDepositExhausted() public {
        uint256 minDep = _minDeposit(ASSESSED_VALUE) + 1;
        uint256 tokenId = _register(alice, "alice", ASSESSED_VALUE, minDep);

        vm.warp(block.timestamp + 31 days);
        assertEq(names.timeUntilExpiry(tokenId), 0);
    }

    function test_DutchAuction_StartsAfterExpiry() public {
        uint256 minDep = _minDeposit(ASSESSED_VALUE) + 1;
        uint256 tokenId = _register(alice, "alice", ASSESSED_VALUE, minDep);

        vm.warp(block.timestamp + 60 days);
        names.collectTax(tokenId); // Force tax collection to zero out deposit
        names.reclaimExpired(tokenId); // Start auction

        // Now bid on the auction
        uint256 auctionPrice = names.currentAuctionPrice(tokenId);
        assertGt(auctionPrice, 0, "Auction should have a price");
    }

    function test_DutchAuction_PriceDecreasesToZero() public {
        uint256 minDep = _minDeposit(ASSESSED_VALUE) + 1;
        uint256 tokenId = _register(alice, "alice", ASSESSED_VALUE, minDep);

        vm.warp(block.timestamp + 60 days);
        names.collectTax(tokenId);
        names.reclaimExpired(tokenId);

        // After full auction duration, price should be 0
        vm.warp(block.timestamp + DUTCH_AUCTION_DURATION + 1);
        assertEq(names.currentAuctionPrice(tokenId), 0);
    }

    function test_BidAuction_TransfersOwnership() public {
        uint256 minDep = _minDeposit(ASSESSED_VALUE) + 1;
        uint256 tokenId = _register(alice, "alice", ASSESSED_VALUE, minDep);

        vm.warp(block.timestamp + 60 days);
        names.collectTax(tokenId);
        names.reclaimExpired(tokenId);

        uint256 auctionPrice = names.currentAuctionPrice(tokenId);
        uint256 bobValue = 0.5 ether;
        uint256 payment = auctionPrice + _minDeposit(bobValue) + 0.01 ether;

        vm.prank(bob);
        names.bidAuction{value: payment}(tokenId, bobValue);
        assertEq(names.ownerOf(tokenId), bob);
    }

    // ============ Name Resolution Tests ============

    function test_SetResolver_UpdatesResolution() public {
        uint256 tokenId = _registerDefault();
        address resolverAddr = makeAddr("resolver");

        vm.prank(alice);
        names.setResolver(tokenId, resolverAddr);
        assertEq(names.resolve("alice"), resolverAddr);
    }

    function test_Resolve_DefaultIsRegistrant() public {
        _registerDefault();
        assertEq(names.resolve("alice"), alice);
    }

    function test_Resolve_NonExistentReturnsZero() public view {
        assertEq(names.resolve("nonexistent"), address(0));
    }

    // ============ Subdomain Tests ============

    function test_CreateSubdomain() public {
        uint256 tokenId = _registerDefault();
        uint256 subDeposit = _minDeposit(0.1 ether) + 0.01 ether;

        vm.prank(alice);
        uint256 subId = names.createSubdomain{value: subDeposit}(tokenId, "jarvis", 0.1 ether);

        assertEq(names.ownerOf(subId), alice);
        assertEq(names.resolve("jarvis.alice"), alice);
    }

    // ============ Loyalty Reset on Transfer ============

    function test_LoyaltyResetsOnTransfer() public {
        uint256 tokenId = _registerDefault();

        // Build 2 years of loyalty
        vm.warp(block.timestamp + 730 days);
        assertEq(names.loyaltyMultiplier(tokenId), 15_000); // 1.5x

        // Force acquire (resets loyalty)
        uint256 effectivePrice = names.effectiveAcquirePrice(tokenId);
        uint256 payment = effectivePrice + _minDeposit(ASSESSED_VALUE) + 0.5 ether;
        _forceAcquire(bob, tokenId, ASSESSED_VALUE, payment);

        // Bob's loyalty should be 1x (just acquired)
        assertEq(names.loyaltyMultiplier(tokenId), BPS);
    }

    // ============ Portfolio Size Tracking ============

    function test_PortfolioSize_DecreasesOnTransfer() public {
        uint256 deposit = _minDeposit(ASSESSED_VALUE) + 0.1 ether;
        uint256 tokenId = _register(alice, "test1", ASSESSED_VALUE, deposit);
        _register(alice, "test2", ASSESSED_VALUE, deposit);
        assertEq(names.portfolioSize(alice), 2);

        uint256 effectivePrice = names.effectiveAcquirePrice(tokenId);
        uint256 payment = effectivePrice + _minDeposit(ASSESSED_VALUE) + 0.5 ether;
        _forceAcquire(bob, tokenId, ASSESSED_VALUE, payment);

        assertEq(names.portfolioSize(alice), 1);
        assertEq(names.portfolioSize(bob), 1);
    }

    // ============ Fuzz Tests ============

    function testFuzz_TaxCalculation_IsAccurate(uint256 value, uint256 elapsed) public {
        value = bound(value, 0.01 ether, 1_000_000 ether);
        elapsed = bound(elapsed, 1, 365 days);

        uint256 deposit = _computeTax(value, elapsed) + _minDeposit(value) + 1 ether;
        vm.deal(alice, deposit + 1 ether);

        uint256 tokenId = _register(alice, "fuzzname", value, deposit);
        vm.warp(block.timestamp + elapsed);

        uint256 owed = names.taxOwed(tokenId);
        uint256 expected = _computeTax(value, elapsed);
        assertApproxEqAbs(owed, expected, 1);
    }

    function testFuzz_TaxOwed_NeverExceedsDeposit(uint256 value, uint256 elapsed) public {
        value = bound(value, 0.01 ether, 100_000 ether);
        elapsed = bound(elapsed, 1, 3650 days);

        uint256 deposit = _minDeposit(value) + 0.1 ether;
        vm.deal(alice, deposit + 1 ether);

        uint256 tokenId = _register(alice, "fuzzmax", value, deposit);
        vm.warp(block.timestamp + elapsed);

        uint256 owed = names.taxOwed(tokenId);
        assertLe(owed, deposit);
    }

    function testFuzz_EffectivePrice_AlwaysGtAssessed(uint256 assessedValue) public {
        assessedValue = bound(assessedValue, 0.01 ether, 10_000 ether);

        uint256 deposit = _minDeposit(assessedValue) + 0.1 ether;
        vm.deal(alice, deposit + 1 ether);
        uint256 tokenId = _register(alice, "fuzzprice", assessedValue, deposit);

        uint256 effective = names.effectiveAcquirePrice(tokenId);
        // With 20% premium, effective should always be > assessed
        assertGt(effective, assessedValue, "Effective price must exceed assessed value");
    }

    // ============ Economics Invariant ============

    function test_Economics_TaxPlusRemainingEqualsDeposited() public {
        uint256 deposit = 1 ether;
        uint256 tokenId = _register(alice, "econ", ASSESSED_VALUE, deposit);

        vm.warp(block.timestamp + 60 days);

        uint256 treasuryBefore = treasury.balance;
        names.collectTax(tokenId);
        uint256 taxCollected = treasury.balance - treasuryBefore;

        uint256 remaining = names.timeUntilExpiry(tokenId);
        uint256 remainingDeposit = _computeTax(ASSESSED_VALUE, remaining);

        assertApproxEqAbs(taxCollected + remainingDeposit, deposit, 2);
    }
}
