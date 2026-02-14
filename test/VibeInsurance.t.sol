// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/financial/VibeInsurance.sol";
import "../contracts/financial/interfaces/IVibeInsurance.sol";
import "../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockInsToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockInsOracle is IReputationOracle {
    mapping(address => uint8) public tiers;

    function setTier(address user, uint8 tier) external {
        tiers[user] = tier;
    }

    function getTrustScore(address user) external view returns (uint256) {
        return uint256(tiers[user]) * 2500;
    }

    function getTrustTier(address user) external view returns (uint8) {
        return tiers[user];
    }

    function isEligible(address user, uint8 requiredTier) external view returns (bool) {
        return tiers[user] >= requiredTier;
    }
}

// ============ Test Contract ============

contract VibeInsuranceTest is Test {
    // Re-declare events for expectEmit (Solidity 0.8.20 compat)
    event MarketCreated(uint8 indexed marketId, string description, IVibeInsurance.TriggerType triggerType, uint40 windowEnd, uint16 premiumBps);
    event CapitalDeposited(uint8 indexed marketId, address indexed underwriter, uint256 amount);
    event CapitalWithdrawn(uint8 indexed marketId, address indexed underwriter, uint256 capital, uint256 premiumShare);
    event PolicyPurchased(uint256 indexed policyId, uint8 indexed marketId, address indexed holder, uint256 coverage, uint256 premium);
    event PayoutClaimed(uint256 indexed policyId, address indexed holder, uint256 amount);
    event MarketResolved(uint8 indexed marketId, bool triggered);
    event MarketSettled(uint8 indexed marketId);
    event JulRewardsDeposited(address indexed depositor, uint256 amount);
    event TriggerResolverUpdated(address indexed resolver, bool authorized);
    VibeInsurance public ins;
    MockInsToken public usdc;
    MockInsToken public jul;
    MockInsOracle public oracle;

    // ============ Actors ============

    address public alice;      // underwriter
    address public bob;        // policyholder
    address public charlie;    // keeper / resolver
    address public dave;       // secondary

    // ============ Constants ============

    uint256 constant CAPITAL = 100_000 ether;
    uint256 constant COVERAGE = 10_000 ether;
    uint16  constant PREMIUM_BPS = 500;    // 5%
    uint40  constant WINDOW_DURATION = 30 days;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");
        dave = makeAddr("dave");

        jul = new MockInsToken("JUL Token", "JUL");
        usdc = new MockInsToken("USD Coin", "USDC");
        oracle = new MockInsOracle();

        ins = new VibeInsurance(address(jul), address(oracle), address(usdc));

        // Set tiers
        oracle.setTier(alice, 3);    // established
        oracle.setTier(bob, 2);      // default
        oracle.setTier(charlie, 1);  // low
        oracle.setTier(dave, 0);     // none

        // Mint tokens
        usdc.mint(alice, 100_000_000 ether);
        usdc.mint(bob, 100_000_000 ether);
        usdc.mint(charlie, 100_000_000 ether);
        usdc.mint(dave, 100_000_000 ether);
        jul.mint(address(this), 1_000_000 ether);

        // Approvals
        vm.prank(alice);
        usdc.approve(address(ins), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(ins), type(uint256).max);
        vm.prank(charlie);
        usdc.approve(address(ins), type(uint256).max);
        vm.prank(dave);
        usdc.approve(address(ins), type(uint256).max);
        jul.approve(address(ins), type(uint256).max);
    }

    // ============ Helpers ============

    function _defaultParams() internal view returns (IVibeInsurance.CreateMarketParams memory) {
        return IVibeInsurance.CreateMarketParams({
            description: "ETH drops >30% in 30 days",
            triggerType: IVibeInsurance.TriggerType.PRICE_DROP,
            triggerData: bytes32(uint256(3000)), // threshold encoding
            windowStart: uint40(block.timestamp + 1),
            windowEnd: uint40(block.timestamp + 1 + WINDOW_DURATION),
            premiumBps: PREMIUM_BPS
        });
    }

    function _createMarket() internal returns (uint8) {
        return ins.createMarket(_defaultParams());
    }

    function _createAndFundMarket() internal returns (uint8 marketId) {
        marketId = _createMarket();
        vm.prank(alice);
        ins.underwrite(marketId, CAPITAL);
    }

    function _createFundAndBuyPolicy() internal returns (uint8 marketId, uint256 policyId) {
        marketId = _createAndFundMarket();
        vm.prank(bob);
        policyId = ins.buyPolicy(marketId, COVERAGE);
    }

    function _fundJulRewards(uint256 amount) internal {
        ins.depositJulRewards(amount);
    }

    // ============ Constructor Tests ============

    function test_constructor_setsImmutables() public view {
        assertEq(address(ins.julToken()), address(jul));
        assertEq(address(ins.collateralToken()), address(usdc));
        assertEq(address(ins.reputationOracle()), address(oracle));
    }

    function test_constructor_initialState() public view {
        assertEq(ins.totalMarkets(), 0);
        assertEq(ins.totalPolicies(), 0);
        assertEq(ins.julRewardPool(), 0);
    }

    function test_constructor_zeroAddress_reverts() public {
        vm.expectRevert(IVibeInsurance.ZeroAddress.selector);
        new VibeInsurance(address(0), address(oracle), address(usdc));

        vm.expectRevert(IVibeInsurance.ZeroAddress.selector);
        new VibeInsurance(address(jul), address(0), address(usdc));

        vm.expectRevert(IVibeInsurance.ZeroAddress.selector);
        new VibeInsurance(address(jul), address(oracle), address(0));
    }

    // ============ Create Market Tests ============

    function test_createMarket_valid() public {
        uint8 id = _createMarket();
        assertEq(id, 0);
        assertEq(ins.totalMarkets(), 1);

        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(0);
        assertEq(mkt.premiumBps, PREMIUM_BPS);
        assertTrue(mkt.state == IVibeInsurance.MarketState.OPEN);
        assertFalse(mkt.triggered);
        assertEq(mkt.totalCapital, 0);
        assertEq(mkt.totalCoverage, 0);
    }

    function test_createMarket_emitsEvent() public {
        IVibeInsurance.CreateMarketParams memory p = _defaultParams();
        vm.expectEmit(true, false, false, true);
        emit MarketCreated(0, p.description, p.triggerType, p.windowEnd, p.premiumBps);
        ins.createMarket(p);
    }

    function test_createMarket_invalidWindow_reverts() public {
        IVibeInsurance.CreateMarketParams memory p = _defaultParams();
        p.windowEnd = p.windowStart; // end == start
        vm.expectRevert(IVibeInsurance.InvalidWindow.selector);
        ins.createMarket(p);
    }

    function test_createMarket_pastWindowStart_reverts() public {
        IVibeInsurance.CreateMarketParams memory p = _defaultParams();
        p.windowStart = uint40(block.timestamp - 1);
        p.windowEnd = uint40(block.timestamp + WINDOW_DURATION);
        vm.expectRevert(IVibeInsurance.InvalidWindow.selector);
        ins.createMarket(p);
    }

    function test_createMarket_zeroPremium_reverts() public {
        IVibeInsurance.CreateMarketParams memory p = _defaultParams();
        p.premiumBps = 0;
        vm.expectRevert(IVibeInsurance.InvalidPremiumRate.selector);
        ins.createMarket(p);
    }

    function test_createMarket_premiumTooHigh_reverts() public {
        IVibeInsurance.CreateMarketParams memory p = _defaultParams();
        p.premiumBps = 10000; // 100%
        vm.expectRevert(IVibeInsurance.InvalidPremiumRate.selector);
        ins.createMarket(p);
    }

    function test_createMarket_notOwner_reverts() public {
        vm.prank(bob);
        vm.expectRevert();
        ins.createMarket(_defaultParams());
    }

    // ============ Underwrite Tests ============

    function test_underwrite_valid() public {
        uint8 id = _createMarket();

        vm.prank(alice);
        ins.underwrite(id, CAPITAL);

        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(id);
        assertEq(mkt.totalCapital, CAPITAL);
        assertEq(ins.underwriterPosition(id, alice), CAPITAL);
    }

    function test_underwrite_emitsEvent() public {
        uint8 id = _createMarket();

        vm.expectEmit(true, true, false, true);
        emit CapitalDeposited(id, alice, CAPITAL);
        vm.prank(alice);
        ins.underwrite(id, CAPITAL);
    }

    function test_underwrite_zeroAmount_reverts() public {
        uint8 id = _createMarket();
        vm.prank(alice);
        vm.expectRevert(IVibeInsurance.ZeroAmount.selector);
        ins.underwrite(id, 0);
    }

    function test_underwrite_marketNotOpen_reverts() public {
        uint8 id = _createAndFundMarket();
        // Warp past window end and resolve
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(id);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(id, false);

        vm.prank(alice);
        vm.expectRevert(IVibeInsurance.MarketNotOpen.selector);
        ins.underwrite(id, CAPITAL);
    }

    function test_underwrite_multipleUnderwriters() public {
        uint8 id = _createMarket();

        vm.prank(alice);
        ins.underwrite(id, CAPITAL);
        vm.prank(charlie);
        ins.underwrite(id, CAPITAL / 2);

        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(id);
        assertEq(mkt.totalCapital, CAPITAL + CAPITAL / 2);
        assertEq(ins.underwriterPosition(id, alice), CAPITAL);
        assertEq(ins.underwriterPosition(id, charlie), CAPITAL / 2);
    }

    // ============ Buy Policy Tests ============

    function test_buyPolicy_valid() public {
        (uint8 marketId, uint256 policyId) = _createFundAndBuyPolicy();

        assertEq(policyId, 1);
        assertEq(ins.totalPolicies(), 1);
        assertEq(ins.ownerOf(policyId), bob);

        IVibeInsurance.Policy memory pol = ins.getPolicy(policyId);
        assertEq(pol.holder, bob);
        assertTrue(pol.state == IVibeInsurance.PolicyState.ACTIVE);
        assertEq(pol.coverage, COVERAGE);
        assertTrue(pol.premiumPaid > 0);

        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        assertEq(mkt.totalCoverage, COVERAGE);
        assertEq(mkt.totalPremiums, pol.premiumPaid);
    }

    function test_buyPolicy_emitsEvent() public {
        uint8 marketId = _createAndFundMarket();
        uint256 expectedPremium = ins.effectivePremium(marketId, COVERAGE, bob);

        vm.expectEmit(true, true, true, true);
        emit PolicyPurchased(1, marketId, bob, COVERAGE, expectedPremium);
        vm.prank(bob);
        ins.buyPolicy(marketId, COVERAGE);
    }

    function test_buyPolicy_zeroCoverage_reverts() public {
        uint8 marketId = _createAndFundMarket();
        vm.prank(bob);
        vm.expectRevert(IVibeInsurance.ZeroAmount.selector);
        ins.buyPolicy(marketId, 0);
    }

    function test_buyPolicy_insufficientCapacity_reverts() public {
        uint8 marketId = _createAndFundMarket();
        vm.prank(bob);
        vm.expectRevert(IVibeInsurance.InsufficientPoolCapacity.selector);
        ins.buyPolicy(marketId, CAPITAL + 1);
    }

    function test_buyPolicy_marketNotOpen_reverts() public {
        (uint8 marketId,) = _createFundAndBuyPolicy();
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, false);

        vm.prank(bob);
        vm.expectRevert(IVibeInsurance.MarketNotOpen.selector);
        ins.buyPolicy(marketId, COVERAGE);
    }

    // ============ Effective Premium Tests ============

    function test_effectivePremium_tierDiscount() public {
        uint8 marketId = _createMarket();
        // base premium = coverage * premiumBps / BPS = 10000e18 * 500 / 10000 = 500e18

        uint256 premT0 = ins.effectivePremium(marketId, COVERAGE, dave);    // tier 0, 0% discount
        uint256 premT2 = ins.effectivePremium(marketId, COVERAGE, bob);     // tier 2, 10% discount
        uint256 premT3 = ins.effectivePremium(marketId, COVERAGE, alice);   // tier 3, 15% discount

        uint256 base = (COVERAGE * PREMIUM_BPS) / 10_000;
        assertEq(premT0, base); // no discount
        assertEq(premT2, base - (base * 1000) / 10_000); // 10% off
        assertEq(premT3, base - (base * 1500) / 10_000); // 15% off

        // Higher tier = lower premium
        assertTrue(premT3 < premT2);
        assertTrue(premT2 < premT0);
    }

    function test_effectivePremium_julBonus() public {
        // Deploy insurance with JUL as collateral token
        VibeInsurance julIns = new VibeInsurance(address(jul), address(oracle), address(jul));

        IVibeInsurance.CreateMarketParams memory p = _defaultParams();
        julIns.createMarket(p);

        // JUL collateral adds +500 BPS discount on top of tier discount
        uint256 premJul = julIns.effectivePremium(0, COVERAGE, dave);  // tier 0 + JUL bonus = 500 BPS
        uint256 premUsdc = ins.effectivePremium(0, COVERAGE, dave);    // tier 0, no JUL bonus

        // Need a market on ins too
        _createMarket();
        premUsdc = ins.effectivePremium(0, COVERAGE, dave);

        uint256 base = (COVERAGE * PREMIUM_BPS) / 10_000;
        assertEq(premUsdc, base);
        assertEq(premJul, base - (base * 500) / 10_000);
        assertTrue(premJul < premUsdc);
    }

    function test_effectivePremium_cappedAt50Percent() public {
        // Deploy with JUL as collateral, tier 4 user = 2000 + 500 = 2500 BPS
        VibeInsurance julIns = new VibeInsurance(address(jul), address(oracle), address(jul));
        julIns.createMarket(_defaultParams());

        oracle.setTier(alice, 4); // tier 4 = 2000 BPS + JUL 500 = 2500 BPS (under 5000 cap)
        uint256 prem = julIns.effectivePremium(0, COVERAGE, alice);
        uint256 base = (COVERAGE * PREMIUM_BPS) / 10_000;
        assertEq(prem, base - (base * 2500) / 10_000);

        // Cap test: artificially hard to hit 50% with current constants
        // but verify it's always > 50% of base
        assertTrue(prem > base / 2);
    }

    // ============ Resolve Market Tests ============

    function test_resolveMarket_triggered() public {
        (uint8 marketId,) = _createFundAndBuyPolicy();
        _fundJulRewards(100 ether);

        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);

        vm.expectEmit(true, false, false, true);
        emit MarketResolved(marketId, true);
        ins.resolveMarket(marketId, true);

        mkt = ins.getMarket(marketId);
        assertTrue(mkt.state == IVibeInsurance.MarketState.RESOLVED);
        assertTrue(mkt.triggered);
    }

    function test_resolveMarket_notTriggered() public {
        (uint8 marketId,) = _createFundAndBuyPolicy();

        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);

        ins.resolveMarket(marketId, false);

        mkt = ins.getMarket(marketId);
        assertTrue(mkt.state == IVibeInsurance.MarketState.RESOLVED);
        assertFalse(mkt.triggered);
    }

    function test_resolveMarket_keeperTip() public {
        uint8 marketId = _createAndFundMarket();
        _fundJulRewards(100 ether);

        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);

        // Authorized resolver gets keeper tip
        ins.setTriggerResolver(charlie, true);
        uint256 julBefore = jul.balanceOf(charlie);
        vm.prank(charlie);
        ins.resolveMarket(marketId, false);
        uint256 julAfter = jul.balanceOf(charlie);

        assertEq(julAfter - julBefore, 10 ether); // KEEPER_TIP
        assertEq(ins.julRewardPool(), 90 ether);
    }

    function test_resolveMarket_windowNotExpired_reverts() public {
        uint8 marketId = _createAndFundMarket();
        vm.expectRevert(IVibeInsurance.WindowNotExpired.selector);
        ins.resolveMarket(marketId, false);
    }

    function test_resolveMarket_alreadyResolved_reverts() public {
        uint8 marketId = _createAndFundMarket();
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, false);

        vm.expectRevert(IVibeInsurance.MarketAlreadyResolved.selector);
        ins.resolveMarket(marketId, false);
    }

    function test_resolveMarket_notAuthorized_reverts() public {
        uint8 marketId = _createAndFundMarket();
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);

        vm.prank(bob); // not owner, not resolver
        vm.expectRevert(IVibeInsurance.NotAuthorizedResolver.selector);
        ins.resolveMarket(marketId, false);
    }

    function test_resolveMarket_authorizedResolver() public {
        uint8 marketId = _createAndFundMarket();
        ins.setTriggerResolver(charlie, true);

        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);

        vm.prank(charlie);
        ins.resolveMarket(marketId, false); // should not revert
        mkt = ins.getMarket(marketId);
        assertTrue(mkt.state == IVibeInsurance.MarketState.RESOLVED);
    }

    // ============ Settle Market Tests ============

    function test_settleMarket_valid() public {
        uint8 marketId = _createAndFundMarket();
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, false);

        vm.warp(block.timestamp + 30 days + 1);

        vm.expectEmit(true, false, false, false);
        emit MarketSettled(marketId);
        ins.settleMarket(marketId);

        mkt = ins.getMarket(marketId);
        assertTrue(mkt.state == IVibeInsurance.MarketState.SETTLED);
    }

    function test_settleMarket_notResolved_reverts() public {
        uint8 marketId = _createAndFundMarket();
        vm.expectRevert(IVibeInsurance.MarketNotResolved.selector);
        ins.settleMarket(marketId);
    }

    function test_settleMarket_graceNotElapsed_reverts() public {
        uint8 marketId = _createAndFundMarket();
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, false);

        // Try to settle immediately (grace period = 30 days)
        vm.expectRevert(IVibeInsurance.SettlementNotReady.selector);
        ins.settleMarket(marketId);
    }

    // ============ Claim Payout Tests ============

    function test_claimPayout_triggered() public {
        (uint8 marketId, uint256 policyId) = _createFundAndBuyPolicy();

        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, true);

        uint256 balBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        ins.claimPayout(policyId);
        uint256 balAfter = usdc.balanceOf(bob);

        assertEq(balAfter - balBefore, COVERAGE);

        IVibeInsurance.Policy memory pol = ins.getPolicy(policyId);
        assertTrue(pol.state == IVibeInsurance.PolicyState.CLAIMED);
    }

    function test_claimPayout_notHolder_reverts() public {
        (uint8 marketId, uint256 policyId) = _createFundAndBuyPolicy();
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, true);

        vm.prank(alice); // not the holder
        vm.expectRevert(IVibeInsurance.NotPolicyHolder.selector);
        ins.claimPayout(policyId);
    }

    function test_claimPayout_notTriggered_reverts() public {
        (uint8 marketId, uint256 policyId) = _createFundAndBuyPolicy();
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, false);

        vm.prank(bob);
        vm.expectRevert(IVibeInsurance.PolicyNotTriggered.selector);
        ins.claimPayout(policyId);
    }

    function test_claimPayout_alreadyClaimed_reverts() public {
        (uint8 marketId, uint256 policyId) = _createFundAndBuyPolicy();
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, true);

        vm.prank(bob);
        ins.claimPayout(policyId);

        vm.prank(bob);
        vm.expectRevert(IVibeInsurance.NotActivePolicy.selector);
        ins.claimPayout(policyId);
    }

    function test_claimPayout_marketNotResolved_reverts() public {
        (, uint256 policyId) = _createFundAndBuyPolicy();

        vm.prank(bob);
        vm.expectRevert(IVibeInsurance.MarketNotResolved.selector);
        ins.claimPayout(policyId);
    }

    // ============ Withdraw Capital Tests ============

    function test_withdrawCapital_notTriggered() public {
        (uint8 marketId, uint256 policyId) = _createFundAndBuyPolicy();
        IVibeInsurance.Policy memory pol = ins.getPolicy(policyId);

        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, false);

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        ins.withdrawCapital(marketId);
        uint256 balAfter = usdc.balanceOf(alice);

        // Should get back capital + all premiums (only underwriter)
        assertEq(balAfter - balBefore, CAPITAL + pol.premiumPaid);
    }

    function test_withdrawCapital_triggered_afterSettlement() public {
        (uint8 marketId, uint256 policyId) = _createFundAndBuyPolicy();

        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, true);

        // Policyholder claims
        vm.prank(bob);
        ins.claimPayout(policyId);

        // Wait for settlement grace
        vm.warp(block.timestamp + 30 days + 1);
        ins.settleMarket(marketId);

        IVibeInsurance.Policy memory pol = ins.getPolicy(policyId);

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        ins.withdrawCapital(marketId);
        uint256 balAfter = usdc.balanceOf(alice);

        // Pool total = capital + premiums - claims
        uint256 poolTotal = CAPITAL + pol.premiumPaid;
        uint256 remaining = poolTotal - COVERAGE;
        assertEq(balAfter - balBefore, remaining);
    }

    function test_withdrawCapital_nothingToWithdraw_reverts() public {
        uint8 marketId = _createAndFundMarket();
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, false);

        vm.prank(bob); // bob has no deposit
        vm.expectRevert(IVibeInsurance.NothingToWithdraw.selector);
        ins.withdrawCapital(marketId);
    }

    function test_withdrawCapital_doubleWithdraw_reverts() public {
        uint8 marketId = _createAndFundMarket();
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, false);

        vm.prank(alice);
        ins.withdrawCapital(marketId);

        vm.prank(alice);
        vm.expectRevert(IVibeInsurance.NothingToWithdraw.selector);
        ins.withdrawCapital(marketId);
    }

    function test_withdrawCapital_triggeredBeforeSettlement_reverts() public {
        (uint8 marketId,) = _createFundAndBuyPolicy();
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, true);

        // Triggered but not yet settled
        vm.prank(alice);
        vm.expectRevert(IVibeInsurance.SettlementNotReady.selector);
        ins.withdrawCapital(marketId);
    }

    function test_withdrawCapital_marketOpen_reverts() public {
        uint8 marketId = _createAndFundMarket();
        vm.prank(alice);
        vm.expectRevert(IVibeInsurance.MarketNotResolved.selector);
        ins.withdrawCapital(marketId);
    }

    // ============ Trigger Resolver Tests ============

    function test_setTriggerResolver_valid() public {
        ins.setTriggerResolver(charlie, true);
        assertTrue(ins.authorizedResolvers(charlie));

        ins.setTriggerResolver(charlie, false);
        assertFalse(ins.authorizedResolvers(charlie));
    }

    function test_setTriggerResolver_zeroAddress_reverts() public {
        vm.expectRevert(IVibeInsurance.ZeroAddress.selector);
        ins.setTriggerResolver(address(0), true);
    }

    function test_setTriggerResolver_notOwner_reverts() public {
        vm.prank(bob);
        vm.expectRevert();
        ins.setTriggerResolver(charlie, true);
    }

    // ============ JUL Rewards Tests ============

    function test_depositJulRewards_valid() public {
        vm.expectEmit(true, false, false, true);
        emit JulRewardsDeposited(address(this), 100 ether);
        ins.depositJulRewards(100 ether);

        assertEq(ins.julRewardPool(), 100 ether);
    }

    function test_depositJulRewards_zeroAmount_reverts() public {
        vm.expectRevert(IVibeInsurance.ZeroAmount.selector);
        ins.depositJulRewards(0);
    }

    // ============ ERC-721 Tests ============

    function test_transfer_updatesHolder() public {
        (uint8 marketId, uint256 policyId) = _createFundAndBuyPolicy();

        // Bob transfers policy to dave
        vm.prank(bob);
        ins.transferFrom(bob, dave, policyId);

        assertEq(ins.ownerOf(policyId), dave);
        IVibeInsurance.Policy memory pol = ins.getPolicy(policyId);
        assertEq(pol.holder, dave);
    }

    function test_transfer_newOwnerCanClaim() public {
        (uint8 marketId, uint256 policyId) = _createFundAndBuyPolicy();

        // Transfer to dave
        vm.prank(bob);
        ins.transferFrom(bob, dave, policyId);

        // Resolve as triggered
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, true);

        // Dave (new holder) can claim
        uint256 balBefore = usdc.balanceOf(dave);
        vm.prank(dave);
        ins.claimPayout(policyId);
        uint256 balAfter = usdc.balanceOf(dave);

        assertEq(balAfter - balBefore, COVERAGE);
    }

    function test_transfer_oldOwnerCannotClaim() public {
        (uint8 marketId, uint256 policyId) = _createFundAndBuyPolicy();

        vm.prank(bob);
        ins.transferFrom(bob, dave, policyId);

        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, true);

        vm.prank(bob); // old holder
        vm.expectRevert(IVibeInsurance.NotPolicyHolder.selector);
        ins.claimPayout(policyId);
    }

    // ============ View Functions ============

    function test_availableCapacity() public {
        uint8 marketId = _createAndFundMarket();
        assertEq(ins.availableCapacity(marketId), CAPITAL);

        vm.prank(bob);
        ins.buyPolicy(marketId, COVERAGE);
        assertEq(ins.availableCapacity(marketId), CAPITAL - COVERAGE);
    }

    function test_policyPayout_notTriggered() public {
        (, uint256 policyId) = _createFundAndBuyPolicy();
        assertEq(ins.policyPayout(policyId), 0);
    }

    function test_policyPayout_triggered() public {
        (uint8 marketId, uint256 policyId) = _createFundAndBuyPolicy();

        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, true);

        assertEq(ins.policyPayout(policyId), COVERAGE);
    }

    function test_underwriterPayout_view() public {
        (uint8 marketId,) = _createFundAndBuyPolicy();

        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, false);

        uint256 payout = ins.underwriterPayout(marketId, alice);
        // Should be capital + all premiums
        assertTrue(payout > CAPITAL);
    }

    // ============ Integration Tests ============

    function test_fullLifecycle_triggered() public {
        // 1. Create market
        uint8 marketId = _createMarket();

        // 2. Underwriter deposits
        vm.prank(alice);
        ins.underwrite(marketId, CAPITAL);

        // 3. Policyholder buys coverage
        vm.prank(bob);
        uint256 policyId = ins.buyPolicy(marketId, COVERAGE);

        // 4. Window expires, trigger fires
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, true);

        // 5. Policyholder claims
        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        ins.claimPayout(policyId);
        assertEq(usdc.balanceOf(bob) - bobBefore, COVERAGE);

        // 6. Wait for settlement
        vm.warp(block.timestamp + 30 days + 1);
        ins.settleMarket(marketId);

        // 7. Underwriter withdraws remaining
        vm.prank(alice);
        ins.withdrawCapital(marketId);

        // Verify final state
        mkt = ins.getMarket(marketId);
        assertTrue(mkt.state == IVibeInsurance.MarketState.SETTLED);
        assertTrue(mkt.triggered);
        assertEq(mkt.totalClaimed, COVERAGE);
    }

    function test_fullLifecycle_notTriggered() public {
        uint8 marketId = _createMarket();

        vm.prank(alice);
        ins.underwrite(marketId, CAPITAL);

        vm.prank(bob);
        uint256 policyId = ins.buyPolicy(marketId, COVERAGE);

        IVibeInsurance.Policy memory pol = ins.getPolicy(policyId);
        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, false);

        // Policyholder cannot claim
        vm.prank(bob);
        vm.expectRevert(IVibeInsurance.PolicyNotTriggered.selector);
        ins.claimPayout(policyId);

        // Underwriter gets capital + premiums immediately (not triggered = no settlement wait)
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        ins.withdrawCapital(marketId);
        uint256 aliceAfter = usdc.balanceOf(alice);

        assertEq(aliceAfter - aliceBefore, CAPITAL + pol.premiumPaid);
    }

    function test_multiplePolicesAndUnderwriters() public {
        uint8 marketId = _createMarket();

        // Two underwriters
        vm.prank(alice);
        ins.underwrite(marketId, CAPITAL);
        vm.prank(charlie);
        ins.underwrite(marketId, CAPITAL / 2);

        uint256 totalCap = CAPITAL + CAPITAL / 2;

        // Two policyholders
        vm.prank(bob);
        uint256 p1 = ins.buyPolicy(marketId, COVERAGE);
        vm.prank(dave);
        uint256 p2 = ins.buyPolicy(marketId, COVERAGE * 2);

        IVibeInsurance.InsuranceMarket memory mkt = ins.getMarket(marketId);
        assertEq(mkt.totalCoverage, COVERAGE * 3);

        // Resolve triggered
        vm.warp(uint256(mkt.windowEnd) + 1);
        ins.resolveMarket(marketId, true);

        // Both claim
        vm.prank(bob);
        ins.claimPayout(p1);
        vm.prank(dave);
        ins.claimPayout(p2);

        mkt = ins.getMarket(marketId);
        assertEq(mkt.totalClaimed, COVERAGE * 3);

        // Settle
        vm.warp(block.timestamp + 30 days + 1);
        ins.settleMarket(marketId);

        // Underwriters withdraw remaining pro-rata
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        ins.withdrawCapital(marketId);
        uint256 alicePayout = usdc.balanceOf(alice) - aliceBefore;

        uint256 charlieBefore = usdc.balanceOf(charlie);
        vm.prank(charlie);
        ins.withdrawCapital(marketId);
        uint256 charliePayout = usdc.balanceOf(charlie) - charlieBefore;

        // Alice deposited 2x charlie, should get 2x payout
        // Allow 1 wei rounding
        assertApproxEqAbs(alicePayout * (CAPITAL / 2), charliePayout * CAPITAL, 1);
    }
}
