// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/financial/VibeCredit.sol";
import "../contracts/financial/interfaces/IVibeCredit.sol";
import "../contracts/oracle/IReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockCreditToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockReputationOracle is IReputationOracle {
    mapping(address => uint8) public tiers;
    mapping(address => uint256) public scores;

    function setTier(address user, uint8 tier) external {
        tiers[user] = tier;
    }

    function getTrustScore(address user) external view returns (uint256) {
        return scores[user];
    }

    function getTrustTier(address user) external view returns (uint8) {
        return tiers[user];
    }

    function isEligible(address user, uint8 requiredTier) external view returns (bool) {
        return tiers[user] >= requiredTier;
    }
}

// ============ Test Contract ============

contract VibeCreditTest is Test {
    VibeCredit public credit;
    MockCreditToken public token;
    MockCreditToken public jul;
    MockReputationOracle public oracle;

    // ============ Actors ============

    address public alice;     // delegator / lender
    address public bob;       // borrower
    address public charlie;   // keeper / liquidator
    address public dave;      // secondary delegator

    // ============ Constants ============

    uint256 constant PRINCIPAL = 100_000 ether;
    uint16  constant RATE_BPS = 1000;        // 10% annual
    uint8   constant MIN_TIER = 2;
    uint40  constant DURATION = 360 days;

    function setUp() public {
        // Create actors
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");
        dave = makeAddr("dave");

        // Deploy mocks
        jul = new MockCreditToken("JUL Token", "JUL");
        token = new MockCreditToken("USD Coin", "USDC");
        oracle = new MockReputationOracle();

        // Deploy contract under test
        credit = new VibeCredit(address(jul), address(oracle));

        // Set default tiers
        oracle.setTier(bob, 3);     // established
        oracle.setTier(charlie, 2); // default

        // Mint tokens
        token.mint(alice, 10_000_000 ether);
        token.mint(bob, 10_000_000 ether);
        token.mint(dave, 10_000_000 ether);
        jul.mint(alice, 10_000_000 ether);
        jul.mint(bob, 10_000_000 ether);
        jul.mint(address(this), 10_000_000 ether);

        // Approvals
        vm.prank(alice);
        token.approve(address(credit), type(uint256).max);
        vm.prank(bob);
        token.approve(address(credit), type(uint256).max);
        vm.prank(dave);
        token.approve(address(credit), type(uint256).max);
        vm.prank(alice);
        jul.approve(address(credit), type(uint256).max);
        vm.prank(bob);
        jul.approve(address(credit), type(uint256).max);
        jul.approve(address(credit), type(uint256).max); // test contract
    }

    // ============ Helpers ============

    function _maturity() internal view returns (uint40) {
        return uint40(block.timestamp) + DURATION;
    }

    function _createDefaultCreditLine() internal returns (uint256 id) {
        vm.prank(alice);
        id = credit.createCreditLine(IVibeCredit.CreateCreditLineParams({
            borrower: bob,
            token: address(token),
            amount: PRINCIPAL,
            interestRate: RATE_BPS,
            minTrustTier: MIN_TIER,
            maturity: _maturity()
        }));
    }

    function _createJulCreditLine() internal returns (uint256 id) {
        vm.prank(alice);
        id = credit.createCreditLine(IVibeCredit.CreateCreditLineParams({
            borrower: bob,
            token: address(jul),
            amount: PRINCIPAL,
            interestRate: RATE_BPS,
            minTrustTier: MIN_TIER,
            maturity: _maturity()
        }));
    }

    // ============ Constructor Tests ============

    function test_constructor_zeroJulReverts() public {
        vm.expectRevert(IVibeCredit.ZeroAddress.selector);
        new VibeCredit(address(0), address(oracle));
    }

    function test_constructor_zeroOracleReverts() public {
        vm.expectRevert(IVibeCredit.ZeroAddress.selector);
        new VibeCredit(address(jul), address(0));
    }

    function test_constructor_initialState() public view {
        assertEq(credit.totalCreditLines(), 0);
        assertEq(address(credit.julToken()), address(jul));
        assertEq(address(credit.reputationOracle()), address(oracle));
        assertEq(credit.name(), "VibeSwap Credit Line");
        assertEq(credit.symbol(), "VCRED");
    }

    // ============ Create Credit Line Tests ============

    function test_createCreditLine_success() public {
        uint256 balBefore = token.balanceOf(alice);

        vm.prank(alice);
        uint256 id = credit.createCreditLine(IVibeCredit.CreateCreditLineParams({
            borrower: bob,
            token: address(token),
            amount: PRINCIPAL,
            interestRate: RATE_BPS,
            minTrustTier: MIN_TIER,
            maturity: _maturity()
        }));

        assertEq(id, 1);
        assertEq(credit.totalCreditLines(), 1);
        assertEq(credit.ownerOf(id), alice);
        assertEq(token.balanceOf(alice), balBefore - PRINCIPAL);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(id);
        assertEq(cl.delegator, alice);
        assertEq(cl.borrower, bob);
        assertEq(cl.principal, PRINCIPAL);
        assertEq(cl.tokensHeld, PRINCIPAL);
        assertEq(cl.borrowed, 0);
        assertEq(uint8(cl.state), uint8(IVibeCredit.CreditState.ACTIVE));
        assertEq(cl.interestRate, RATE_BPS);
        assertEq(cl.minTrustTier, MIN_TIER);
    }

    function test_createCreditLine_zeroDeposit_reverts() public {
        vm.expectRevert(IVibeCredit.ZeroAmount.selector);
        vm.prank(alice);
        credit.createCreditLine(IVibeCredit.CreateCreditLineParams({
            borrower: bob,
            token: address(token),
            amount: 0,
            interestRate: RATE_BPS,
            minTrustTier: MIN_TIER,
            maturity: _maturity()
        }));
    }

    function test_createCreditLine_pastMaturity_reverts() public {
        vm.expectRevert(IVibeCredit.InvalidMaturity.selector);
        vm.prank(alice);
        credit.createCreditLine(IVibeCredit.CreateCreditLineParams({
            borrower: bob,
            token: address(token),
            amount: PRINCIPAL,
            interestRate: RATE_BPS,
            minTrustTier: MIN_TIER,
            maturity: uint40(block.timestamp) - 1
        }));
    }

    function test_createCreditLine_zeroBorrower_reverts() public {
        vm.expectRevert(IVibeCredit.ZeroAddress.selector);
        vm.prank(alice);
        credit.createCreditLine(IVibeCredit.CreateCreditLineParams({
            borrower: address(0),
            token: address(token),
            amount: PRINCIPAL,
            interestRate: RATE_BPS,
            minTrustTier: MIN_TIER,
            maturity: _maturity()
        }));
    }

    function test_createCreditLine_invalidTier_reverts() public {
        vm.expectRevert(IVibeCredit.InvalidTier.selector);
        vm.prank(alice);
        credit.createCreditLine(IVibeCredit.CreateCreditLineParams({
            borrower: bob,
            token: address(token),
            amount: PRINCIPAL,
            interestRate: RATE_BPS,
            minTrustTier: 5,
            maturity: _maturity()
        }));
    }

    // ============ Borrow Tests ============

    function test_borrow_withinLimit() public {
        uint256 id = _createDefaultCreditLine();

        // Bob is tier 3 → 75% LTV → can borrow 75k of 100k
        uint256 borrowAmount = 75_000 ether;
        uint256 bobBefore = token.balanceOf(bob);

        vm.prank(bob);
        credit.borrow(id, borrowAmount);

        assertEq(token.balanceOf(bob), bobBefore + borrowAmount);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(id);
        assertEq(cl.borrowed, borrowAmount);
        assertEq(cl.tokensHeld, PRINCIPAL - borrowAmount);
    }

    function test_borrow_exceedsLimit_reverts() public {
        uint256 id = _createDefaultCreditLine();

        // Bob tier 3 → 75% limit → 75k max
        vm.expectRevert(IVibeCredit.ExceedsCreditLimit.selector);
        vm.prank(bob);
        credit.borrow(id, 75_001 ether);
    }

    function test_borrow_lowTier_reverts() public {
        uint256 id = _createDefaultCreditLine(); // minTrustTier = 2

        // Drop Bob to tier 1
        oracle.setTier(bob, 1);

        vm.expectRevert(IVibeCredit.InsufficientReputation.selector);
        vm.prank(bob);
        credit.borrow(id, 1 ether);
    }

    function test_borrow_multipleBorrows_accumulate() public {
        uint256 id = _createDefaultCreditLine();

        vm.prank(bob);
        credit.borrow(id, 30_000 ether);

        vm.prank(bob);
        credit.borrow(id, 20_000 ether);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(id);
        assertEq(cl.borrowed, 50_000 ether);
        assertEq(cl.tokensHeld, PRINCIPAL - 50_000 ether);
    }

    function test_borrow_afterMaturity_reverts() public {
        uint256 id = _createDefaultCreditLine();

        // Warp past maturity
        vm.warp(block.timestamp + uint256(DURATION) + 1);

        vm.expectRevert(IVibeCredit.PastMaturity.selector);
        vm.prank(bob);
        credit.borrow(id, 1 ether);
    }

    // ============ Repay Tests ============

    function test_repay_partialReducesDebt() public {
        uint256 id = _createDefaultCreditLine();

        vm.prank(bob);
        credit.borrow(id, 50_000 ether);

        vm.prank(bob);
        credit.repay(id, 20_000 ether);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(id);
        assertEq(cl.borrowed, 30_000 ether);
        assertEq(cl.tokensHeld, PRINCIPAL - 50_000 ether + 20_000 ether);
    }

    function test_repay_fullRepayChangesState() public {
        uint256 id = _createDefaultCreditLine();

        vm.prank(bob);
        credit.borrow(id, 50_000 ether);

        vm.prank(bob);
        credit.repay(id, 50_000 ether);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(id);
        assertEq(cl.borrowed, 0);
        assertEq(uint8(cl.state), uint8(IVibeCredit.CreditState.REPAID));
    }

    function test_repay_interestBeforePrincipal() public {
        uint256 id = _createDefaultCreditLine();

        vm.prank(bob);
        credit.borrow(id, 50_000 ether);

        // Warp 1 year to accrue 10% interest = 5000 ether
        vm.warp(block.timestamp + 365.25 days);

        // Debt should be ~55000 ether
        uint256 debt = credit.totalDebt(id);
        assertApproxEqRel(debt, 55_000 ether, 0.001e18); // 0.1% tolerance

        // Repay 5000 — pays interest first, debt should be ~50000
        vm.prank(bob);
        credit.repay(id, 5_000 ether);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(id);
        assertApproxEqRel(cl.borrowed, 50_000 ether, 0.001e18);
    }

    function test_repay_overpaymentCapped() public {
        uint256 id = _createDefaultCreditLine();

        vm.prank(bob);
        credit.borrow(id, 10_000 ether);

        uint256 bobBefore = token.balanceOf(bob);

        // Repay more than owed — should cap at 10k
        vm.prank(bob);
        credit.repay(id, 50_000 ether);

        uint256 bobAfter = token.balanceOf(bob);
        assertEq(bobBefore - bobAfter, 10_000 ether); // only 10k taken

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(id);
        assertEq(cl.borrowed, 0);
        assertEq(uint8(cl.state), uint8(IVibeCredit.CreditState.REPAID));
    }

    // ============ Interest Accrual Tests ============

    function test_interest_accruesOverTime() public {
        uint256 id = _createDefaultCreditLine();

        vm.prank(bob);
        credit.borrow(id, 50_000 ether);

        // Warp 6 months
        vm.warp(block.timestamp + 182.625 days);

        uint256 pending = credit.accruedInterest(id);
        // 50000 * 10% * 0.5 = 2500
        assertApproxEqRel(pending, 2_500 ether, 0.01e18); // 1% tolerance
    }

    function test_interest_compoundsOnInteraction() public {
        uint256 id = _createDefaultCreditLine();

        vm.prank(bob);
        credit.borrow(id, 50_000 ether);

        // Warp 6 months, repay 1 wei to trigger accrual
        vm.warp(block.timestamp + 182.625 days);
        vm.prank(bob);
        credit.repay(id, 1);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(id);
        // borrowed should be ~52500 - 1
        assertApproxEqRel(cl.borrowed, 52_500 ether, 0.01e18);
    }

    function test_interest_zeroBorrowedNoAccrual() public {
        uint256 id = _createDefaultCreditLine();

        // No borrow — warp 1 year
        vm.warp(block.timestamp + 365.25 days);

        assertEq(credit.accruedInterest(id), 0);
        assertEq(credit.totalDebt(id), 0);
    }

    function test_interest_rateAccuracy() public {
        uint256 id = _createDefaultCreditLine();

        vm.prank(bob);
        credit.borrow(id, 10_000 ether);

        // Warp exactly 1 year (SECONDS_PER_YEAR)
        vm.warp(block.timestamp + 31_557_600);

        uint256 pending = credit.accruedInterest(id);
        // 10000 * 1000/10000 = 1000 ether exactly
        assertEq(pending, 1_000 ether);
    }

    // ============ Liquidation Tests ============

    function test_liquidation_tierDropTriggersLiquidatable() public {
        uint256 id = _createDefaultCreditLine();

        vm.prank(bob);
        credit.borrow(id, 50_000 ether);

        assertFalse(credit.isLiquidatable(id));

        // Drop Bob below minTrustTier
        oracle.setTier(bob, 1);
        assertTrue(credit.isLiquidatable(id));
    }

    function test_liquidation_debtExceedsLimit() public {
        uint256 id = _createDefaultCreditLine();

        // Bob tier 3 → 75% LTV → borrow max 75k
        vm.prank(bob);
        credit.borrow(id, 75_000 ether);

        // Drop tier to 2 → 50% LTV → limit 50k, debt 75k → liquidatable
        oracle.setTier(bob, 2);
        assertTrue(credit.isLiquidatable(id));
    }

    function test_liquidation_maturityPlusGrace() public {
        uint256 id = _createDefaultCreditLine();

        vm.prank(bob);
        credit.borrow(id, 10_000 ether);

        // Warp to maturity + 6 days → not liquidatable yet (grace = 7 days)
        vm.warp(block.timestamp + uint256(DURATION) + 6 days);
        assertFalse(credit.isLiquidatable(id));

        // Warp past grace period
        vm.warp(block.timestamp + 2 days);
        assertTrue(credit.isLiquidatable(id));
    }

    function test_liquidation_notLiquidatable_reverts() public {
        uint256 id = _createDefaultCreditLine();

        vm.prank(bob);
        credit.borrow(id, 10_000 ether);

        vm.expectRevert(IVibeCredit.NotLiquidatable.selector);
        vm.prank(charlie);
        credit.liquidate(id);
    }

    function test_liquidation_keeperTipPaid() public {
        // Fund JUL reward pool
        credit.depositJulRewards(100 ether);

        uint256 id = _createDefaultCreditLine();
        vm.prank(bob);
        credit.borrow(id, 50_000 ether);

        // Make liquidatable
        oracle.setTier(bob, 0);

        uint256 charlieBefore = jul.balanceOf(charlie);
        vm.prank(charlie);
        credit.liquidate(id);

        assertEq(jul.balanceOf(charlie), charlieBefore + 10 ether);
        assertEq(credit.julRewardPool(), 90 ether);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(id);
        assertEq(uint8(cl.state), uint8(IVibeCredit.CreditState.DEFAULTED));
    }

    // ============ Reputation Gating Tests ============

    function test_reputation_tierCheckOnBorrow() public {
        // Create line with minTier = 3
        vm.prank(alice);
        uint256 id = credit.createCreditLine(IVibeCredit.CreateCreditLineParams({
            borrower: bob,
            token: address(token),
            amount: PRINCIPAL,
            interestRate: RATE_BPS,
            minTrustTier: 3,
            maturity: _maturity()
        }));

        // Bob is tier 3 — should succeed
        vm.prank(bob);
        credit.borrow(id, 10_000 ether);
        assertEq(credit.getCreditLine(id).borrowed, 10_000 ether);
    }

    function test_reputation_dynamicCreditLimit() public {
        uint256 id = _createDefaultCreditLine();

        // Bob tier 3 → 75% → can borrow 75k
        assertEq(credit.creditLimit(id), 75_000 ether);

        // Promote to tier 4 → 90% → can borrow 90k
        oracle.setTier(bob, 4);
        assertEq(credit.creditLimit(id), 90_000 ether);

        // Demote to tier 1 → 25% → limit 25k
        oracle.setTier(bob, 1);
        assertEq(credit.creditLimit(id), 25_000 ether);
    }

    function test_reputation_tierDropMidLoan() public {
        uint256 id = _createDefaultCreditLine();

        // Borrow at tier 3 → 60k (within 75k limit)
        vm.prank(bob);
        credit.borrow(id, 60_000 ether);

        assertFalse(credit.isLiquidatable(id));

        // Drop to tier 2 → limit 50k, debt 60k → liquidatable
        oracle.setTier(bob, 2);
        assertTrue(credit.isLiquidatable(id));
    }

    function test_reputation_defaultCounterIncrements() public {
        assertEq(credit.borrowerDefaults(bob), 0);

        // Fund JUL for keeper tips
        credit.depositJulRewards(100 ether);

        uint256 id = _createDefaultCreditLine();
        vm.prank(bob);
        credit.borrow(id, 10_000 ether);

        oracle.setTier(bob, 0);
        vm.prank(charlie);
        credit.liquidate(id);

        assertEq(credit.borrowerDefaults(bob), 1);

        // Create another line, default again
        oracle.setTier(bob, 3); // restore for creation
        uint256 id2 = _createDefaultCreditLine();
        vm.prank(bob);
        credit.borrow(id2, 10_000 ether);

        oracle.setTier(bob, 0);
        vm.prank(charlie);
        credit.liquidate(id2);

        assertEq(credit.borrowerDefaults(bob), 2);
    }

    // ============ ERC-721 Tests ============

    function test_erc721_transferUpdatesDelegator() public {
        uint256 id = _createDefaultCreditLine();
        assertEq(credit.getCreditLine(id).delegator, alice);

        vm.prank(alice);
        credit.transferFrom(alice, dave, id);

        assertEq(credit.ownerOf(id), dave);
        assertEq(credit.getCreditLine(id).delegator, dave);
        // Borrower unchanged
        assertEq(credit.getCreditLine(id).borrower, bob);
    }

    function test_erc721_reclaimAfterTransfer() public {
        uint256 id = _createDefaultCreditLine();

        // Borrow and repay fully
        vm.prank(bob);
        credit.borrow(id, 10_000 ether);
        vm.prank(bob);
        credit.repay(id, 10_000 ether);

        // Transfer NFT to Dave
        vm.prank(alice);
        credit.transferFrom(alice, dave, id);

        // Dave (new delegator) can reclaim
        uint256 daveBefore = token.balanceOf(dave);
        vm.prank(dave);
        credit.reclaimCollateral(id);

        assertEq(token.balanceOf(dave), daveBefore + PRINCIPAL);
    }

    // ============ JUL Integration Tests ============

    function test_jul_bonusLTV() public {
        uint256 id = _createJulCreditLine();

        // Bob tier 3 → 75% + 5% JUL bonus = 80% LTV
        uint256 limit = credit.creditLimit(id);
        assertEq(limit, 80_000 ether); // 100k * 8000/10000

        // Tier 4 → 90% + 5% = 95%
        oracle.setTier(bob, 4);
        assertEq(credit.creditLimit(id), 95_000 ether);
    }

    function test_jul_keeperTipFromPool() public {
        // Deposit JUL rewards
        credit.depositJulRewards(50 ether);
        assertEq(credit.julRewardPool(), 50 ether);

        uint256 id = _createDefaultCreditLine();
        vm.prank(bob);
        credit.borrow(id, 10_000 ether);

        oracle.setTier(bob, 0);

        uint256 charlieBal = jul.balanceOf(charlie);
        vm.prank(charlie);
        credit.liquidate(id);

        // Keeper gets 10 JUL tip
        assertEq(jul.balanceOf(charlie), charlieBal + 10 ether);
        assertEq(credit.julRewardPool(), 40 ether);
    }

    // ============ Integration Tests ============

    function test_integration_fullLifecycle() public {
        // 1. Alice creates credit line for Bob
        uint256 id = _createDefaultCreditLine();
        assertEq(credit.totalCreditLines(), 1);

        // 2. Bob borrows 50k
        vm.prank(bob);
        credit.borrow(id, 50_000 ether);

        // 3. Time passes — 30 days
        vm.warp(block.timestamp + 30 days);

        // 4. Check accrued interest
        uint256 pending = credit.accruedInterest(id);
        assertTrue(pending > 0);

        // 5. Bob repays all debt (principal + interest)
        uint256 totalOwed = credit.totalDebt(id);
        vm.prank(bob);
        credit.repay(id, totalOwed);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(id);
        assertEq(uint8(cl.state), uint8(IVibeCredit.CreditState.REPAID));

        // 6. Alice reclaims collateral (principal + interest profit)
        uint256 aliceBefore = token.balanceOf(alice);
        vm.prank(alice);
        credit.reclaimCollateral(id);

        uint256 reclaimed = token.balanceOf(alice) - aliceBefore;
        assertTrue(reclaimed > PRINCIPAL); // profit from interest

        assertEq(uint8(credit.getCreditLine(id).state), uint8(IVibeCredit.CreditState.CLOSED));
    }

    function test_integration_multiLineBorrower() public {
        // Alice creates two lines for Bob
        uint256 id1 = _createDefaultCreditLine();
        uint256 id2 = _createDefaultCreditLine();

        assertEq(credit.totalCreditLines(), 2);

        // Bob borrows from both
        vm.prank(bob);
        credit.borrow(id1, 30_000 ether);

        vm.prank(bob);
        credit.borrow(id2, 40_000 ether);

        assertEq(credit.getCreditLine(id1).borrowed, 30_000 ether);
        assertEq(credit.getCreditLine(id2).borrowed, 40_000 ether);

        // Repay one
        vm.prank(bob);
        credit.repay(id1, 30_000 ether);
        assertEq(uint8(credit.getCreditLine(id1).state), uint8(IVibeCredit.CreditState.REPAID));
        assertEq(uint8(credit.getCreditLine(id2).state), uint8(IVibeCredit.CreditState.ACTIVE));
    }

    function test_integration_liquidationAndDefaultTracking() public {
        credit.depositJulRewards(100 ether);

        uint256 id = _createDefaultCreditLine();
        vm.prank(bob);
        credit.borrow(id, 70_000 ether);

        // Borrower loses reputation
        oracle.setTier(bob, 0);

        // Charlie liquidates
        vm.prank(charlie);
        credit.liquidate(id);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(id);
        assertEq(uint8(cl.state), uint8(IVibeCredit.CreditState.DEFAULTED));
        assertEq(credit.borrowerDefaults(bob), 1);

        // Remaining tokens in contract (30k = 100k - 70k borrowed)
        assertEq(cl.tokensHeld, 30_000 ether);

        // Alice reclaims whatever is left
        uint256 aliceBefore = token.balanceOf(alice);
        vm.prank(alice);
        credit.reclaimCollateral(id);
        assertEq(token.balanceOf(alice) - aliceBefore, 30_000 ether);
    }

    // ============ Edge Case Tests ============

    function test_edge_closeExpiredLineNoDebt() public {
        uint256 id = _createDefaultCreditLine();

        // Warp past maturity
        vm.warp(block.timestamp + uint256(DURATION) + 1);

        // Close (no debt outstanding)
        uint256 aliceBefore = token.balanceOf(alice);
        vm.prank(alice);
        credit.closeCreditLine(id);

        assertEq(token.balanceOf(alice), aliceBefore + PRINCIPAL);
        assertEq(uint8(credit.getCreditLine(id).state), uint8(IVibeCredit.CreditState.CLOSED));
    }

    // ============ LTV Table Tests ============

    function test_ltvForTier_allTiers() public view {
        assertEq(credit.ltvForTier(0), 0);
        assertEq(credit.ltvForTier(1), 2500);
        assertEq(credit.ltvForTier(2), 5000);
        assertEq(credit.ltvForTier(3), 7500);
        assertEq(credit.ltvForTier(4), 9000);
        assertEq(credit.ltvForTier(5), 0); // out of range
    }
}
