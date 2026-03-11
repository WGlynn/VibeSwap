// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeCredit.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockCreditToken is ERC20 {
    constructor() ERC20("USDC", "USDC") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockRepOracle is IReputationOracle {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 100; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

// ============ Tests ============

contract VibeCreditTest is Test {
    VibeCredit public credit;
    MockCreditToken public usdc;
    MockCreditToken public julToken;
    MockRepOracle public oracle;

    address alice = address(0xA1); // delegator
    address bob = address(0xB0);   // borrower
    address keeper = address(0xCC);
    address owner;

    uint256 creditLineId;

    uint256 constant PRINCIPAL = 10_000e18;
    uint16 constant INTEREST_RATE = 1000; // 10% APR
    uint8 constant MIN_TIER = 2;
    uint40 maturity;

    function setUp() public {
        owner = address(this);
        vm.warp(1000); // start at non-zero timestamp

        usdc = new MockCreditToken();
        julToken = new MockCreditToken();
        oracle = new MockRepOracle();

        credit = new VibeCredit(address(julToken), address(oracle));

        maturity = uint40(block.timestamp) + 365 days;

        // Set Bob's tier to 3 (above min 2)
        oracle.setTier(bob, 3);

        // Fund users
        usdc.mint(alice, 1_000_000e18);
        usdc.mint(bob, 1_000_000e18);
        julToken.mint(owner, 100_000e18);

        vm.prank(alice);
        usdc.approve(address(credit), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(credit), type(uint256).max);
        julToken.approve(address(credit), type(uint256).max);

        // Create a credit line: Alice delegates, Bob borrows
        vm.prank(alice);
        creditLineId = credit.createCreditLine(IVibeCredit.CreateCreditLineParams({
            borrower: bob,
            token: address(usdc),
            amount: PRINCIPAL,
            interestRate: INTEREST_RATE,
            minTrustTier: MIN_TIER,
            maturity: maturity
        }));
    }

    // ============ Constructor ============

    function test_constructor() public view {
        assertEq(address(credit.julToken()), address(julToken));
        assertEq(address(credit.reputationOracle()), address(oracle));
    }

    function test_revertConstructorZeroJul() public {
        vm.expectRevert(IVibeCredit.ZeroAddress.selector);
        new VibeCredit(address(0), address(oracle));
    }

    function test_revertConstructorZeroOracle() public {
        vm.expectRevert(IVibeCredit.ZeroAddress.selector);
        new VibeCredit(address(julToken), address(0));
    }

    // ============ Create Credit Line ============

    function test_createCreditLine() public view {
        IVibeCredit.CreditLine memory cl = credit.getCreditLine(creditLineId);
        assertEq(cl.delegator, alice);
        assertEq(cl.borrower, bob);
        assertEq(cl.token, address(usdc));
        assertEq(cl.principal, PRINCIPAL);
        assertEq(cl.interestRate, INTEREST_RATE);
        assertEq(cl.minTrustTier, MIN_TIER);
        assertTrue(cl.state == IVibeCredit.CreditState.ACTIVE);
        assertEq(cl.borrowed, 0);
        assertEq(cl.tokensHeld, PRINCIPAL);
    }

    function test_createCreditLineMintsNFT() public view {
        assertEq(credit.ownerOf(creditLineId), alice);
        assertEq(credit.totalCreditLines(), 1);
    }

    function test_revertCreateZeroBorrower() public {
        vm.prank(alice);
        vm.expectRevert(IVibeCredit.ZeroAddress.selector);
        credit.createCreditLine(IVibeCredit.CreateCreditLineParams({
            borrower: address(0), token: address(usdc), amount: PRINCIPAL,
            interestRate: INTEREST_RATE, minTrustTier: MIN_TIER, maturity: maturity
        }));
    }

    function test_revertCreateZeroToken() public {
        vm.prank(alice);
        vm.expectRevert(IVibeCredit.ZeroAddress.selector);
        credit.createCreditLine(IVibeCredit.CreateCreditLineParams({
            borrower: bob, token: address(0), amount: PRINCIPAL,
            interestRate: INTEREST_RATE, minTrustTier: MIN_TIER, maturity: maturity
        }));
    }

    function test_revertCreateZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(IVibeCredit.ZeroAmount.selector);
        credit.createCreditLine(IVibeCredit.CreateCreditLineParams({
            borrower: bob, token: address(usdc), amount: 0,
            interestRate: INTEREST_RATE, minTrustTier: MIN_TIER, maturity: maturity
        }));
    }

    function test_revertCreatePastMaturity() public {
        vm.prank(alice);
        vm.expectRevert(IVibeCredit.InvalidMaturity.selector);
        credit.createCreditLine(IVibeCredit.CreateCreditLineParams({
            borrower: bob, token: address(usdc), amount: PRINCIPAL,
            interestRate: INTEREST_RATE, minTrustTier: MIN_TIER,
            maturity: uint40(block.timestamp) - 1
        }));
    }

    function test_revertCreateInvalidTier() public {
        vm.prank(alice);
        vm.expectRevert(IVibeCredit.InvalidTier.selector);
        credit.createCreditLine(IVibeCredit.CreateCreditLineParams({
            borrower: bob, token: address(usdc), amount: PRINCIPAL,
            interestRate: INTEREST_RATE, minTrustTier: 5, maturity: maturity
        }));
    }

    // ============ LTV Tiers ============

    function test_ltvTiers() public view {
        assertEq(credit.ltvForTier(0), 0);
        assertEq(credit.ltvForTier(1), 2500);
        assertEq(credit.ltvForTier(2), 5000);
        assertEq(credit.ltvForTier(3), 7500);
        assertEq(credit.ltvForTier(4), 9000);
    }

    function test_creditLimitByTier() public view {
        // Bob is tier 3 → LTV 75% of 10,000 = 7,500
        assertEq(credit.creditLimit(creditLineId), 7500e18);
    }

    // ============ Borrow ============

    function test_borrow() public {
        vm.prank(bob);
        credit.borrow(creditLineId, 5000e18);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(creditLineId);
        assertEq(cl.borrowed, 5000e18);
        assertEq(cl.tokensHeld, 5000e18);
        assertEq(usdc.balanceOf(bob), 1_000_000e18 + 5000e18);
    }

    function test_borrowUpToLimit() public {
        // Tier 3 → 7500 max
        vm.prank(bob);
        credit.borrow(creditLineId, 7500e18);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(creditLineId);
        assertEq(cl.borrowed, 7500e18);
    }

    function test_revertBorrowExceedsLimit() public {
        vm.prank(bob);
        vm.expectRevert(IVibeCredit.ExceedsCreditLimit.selector);
        credit.borrow(creditLineId, 7501e18);
    }

    function test_revertBorrowNotBorrower() public {
        vm.prank(alice);
        vm.expectRevert(IVibeCredit.NotBorrower.selector);
        credit.borrow(creditLineId, 1000e18);
    }

    function test_revertBorrowZero() public {
        vm.prank(bob);
        vm.expectRevert(IVibeCredit.ZeroAmount.selector);
        credit.borrow(creditLineId, 0);
    }

    function test_revertBorrowInsufficientReputation() public {
        oracle.setTier(bob, 1); // below min 2
        vm.prank(bob);
        vm.expectRevert(IVibeCredit.InsufficientReputation.selector);
        credit.borrow(creditLineId, 1000e18);
    }

    function test_revertBorrowPastMaturity() public {
        vm.warp(maturity + 1);
        vm.prank(bob);
        vm.expectRevert(IVibeCredit.PastMaturity.selector);
        credit.borrow(creditLineId, 1000e18);
    }

    // ============ Interest Accrual ============

    function test_interestAccrues() public {
        vm.prank(bob);
        credit.borrow(creditLineId, 5000e18);

        // 1 year later
        vm.warp(block.timestamp + 365 days);

        uint256 interest = credit.accruedInterest(creditLineId);
        // ~10% of 5000 = ~500 (approximate due to SECONDS_PER_YEAR)
        assertApproxEqAbs(interest, 500e18, 5e18);
    }

    function test_totalDebtIncludesInterest() public {
        vm.prank(bob);
        credit.borrow(creditLineId, 5000e18);

        vm.warp(block.timestamp + 365 days);

        uint256 debt = credit.totalDebt(creditLineId);
        assertGt(debt, 5000e18);
        assertApproxEqAbs(debt, 5500e18, 5e18);
    }

    // ============ Repay ============

    function test_repay() public {
        vm.prank(bob);
        credit.borrow(creditLineId, 5000e18);

        vm.prank(bob);
        credit.repay(creditLineId, 2000e18);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(creditLineId);
        assertEq(cl.borrowed, 3000e18);
    }

    function test_repayFull() public {
        vm.prank(bob);
        credit.borrow(creditLineId, 5000e18);

        vm.prank(bob);
        credit.repay(creditLineId, 5000e18);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(creditLineId);
        assertEq(cl.borrowed, 0);
        assertTrue(cl.state == IVibeCredit.CreditState.REPAID);
    }

    function test_repayCappedAtDebt() public {
        vm.prank(bob);
        credit.borrow(creditLineId, 5000e18);

        // Overpay
        vm.prank(bob);
        credit.repay(creditLineId, 100_000e18);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(creditLineId);
        assertEq(cl.borrowed, 0);
        assertTrue(cl.state == IVibeCredit.CreditState.REPAID);
    }

    function test_revertRepayZero() public {
        vm.prank(bob);
        vm.expectRevert(IVibeCredit.ZeroAmount.selector);
        credit.repay(creditLineId, 0);
    }

    function test_revertRepayNothingOwed() public {
        vm.prank(bob);
        vm.expectRevert(IVibeCredit.NothingToRepay.selector);
        credit.repay(creditLineId, 1000e18);
    }

    // ============ Liquidation ============

    function test_liquidateTierDrop() public {
        vm.prank(bob);
        credit.borrow(creditLineId, 5000e18);

        // Drop Bob's tier below minimum
        oracle.setTier(bob, 1);

        assertTrue(credit.isLiquidatable(creditLineId));

        // Fund JUL rewards
        credit.depositJulRewards(100e18);

        vm.prank(keeper);
        credit.liquidate(creditLineId);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(creditLineId);
        assertTrue(cl.state == IVibeCredit.CreditState.DEFAULTED);
        assertEq(credit.borrowerDefaults(bob), 1);
    }

    function test_liquidatePastGracePeriod() public {
        vm.prank(bob);
        credit.borrow(creditLineId, 5000e18);

        // Past maturity + grace period (7 days)
        vm.warp(uint256(maturity) + 7 days + 1);

        assertTrue(credit.isLiquidatable(creditLineId));

        vm.prank(keeper);
        credit.liquidate(creditLineId);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(creditLineId);
        assertTrue(cl.state == IVibeCredit.CreditState.DEFAULTED);
    }

    function test_liquidateKeeperTip() public {
        vm.prank(bob);
        credit.borrow(creditLineId, 5000e18);

        credit.depositJulRewards(100e18);
        oracle.setTier(bob, 0);

        uint256 keeperBal = julToken.balanceOf(keeper);
        vm.prank(keeper);
        credit.liquidate(creditLineId);

        assertEq(julToken.balanceOf(keeper) - keeperBal, 10e18); // KEEPER_TIP = 10 ether
    }

    function test_revertLiquidateHealthy() public {
        vm.prank(bob);
        credit.borrow(creditLineId, 5000e18);

        assertFalse(credit.isLiquidatable(creditLineId));

        vm.prank(keeper);
        vm.expectRevert(IVibeCredit.NotLiquidatable.selector);
        credit.liquidate(creditLineId);
    }

    function test_notLiquidatableNoBorrow() public view {
        assertFalse(credit.isLiquidatable(creditLineId));
    }

    // ============ Close & Reclaim ============

    function test_closeCreditLine() public {
        uint256 aliceBal = usdc.balanceOf(alice);
        vm.prank(alice);
        credit.closeCreditLine(creditLineId);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(creditLineId);
        assertTrue(cl.state == IVibeCredit.CreditState.CLOSED);
        assertEq(usdc.balanceOf(alice), aliceBal + PRINCIPAL);
    }

    function test_revertCloseWithDebt() public {
        vm.prank(bob);
        credit.borrow(creditLineId, 1000e18);

        vm.prank(alice);
        vm.expectRevert(IVibeCredit.HasOutstandingDebt.selector);
        credit.closeCreditLine(creditLineId);
    }

    function test_revertCloseNotDelegator() public {
        vm.prank(bob);
        vm.expectRevert(IVibeCredit.NotDelegator.selector);
        credit.closeCreditLine(creditLineId);
    }

    function test_reclaimAfterRepay() public {
        vm.prank(bob);
        credit.borrow(creditLineId, 5000e18);

        vm.prank(bob);
        credit.repay(creditLineId, 5000e18);

        uint256 aliceBal = usdc.balanceOf(alice);
        vm.prank(alice);
        credit.reclaimCollateral(creditLineId);

        assertGt(usdc.balanceOf(alice), aliceBal);
    }

    function test_reclaimAfterDefault() public {
        vm.prank(bob);
        credit.borrow(creditLineId, 5000e18);

        oracle.setTier(bob, 0);
        vm.prank(keeper);
        credit.liquidate(creditLineId);

        // Alice reclaims whatever is left
        uint256 aliceBal = usdc.balanceOf(alice);
        vm.prank(alice);
        credit.reclaimCollateral(creditLineId);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(creditLineId);
        assertTrue(cl.state == IVibeCredit.CreditState.CLOSED);
        assertGt(usdc.balanceOf(alice), aliceBal);
    }

    function test_revertReclaimNotRepaidOrDefaulted() public {
        vm.prank(alice);
        vm.expectRevert(IVibeCredit.NotRepaidOrDefaulted.selector);
        credit.reclaimCollateral(creditLineId);
    }

    function test_revertReclaimNotDelegator() public {
        vm.prank(bob);
        credit.borrow(creditLineId, 5000e18);
        vm.prank(bob);
        credit.repay(creditLineId, 5000e18);

        vm.prank(bob);
        vm.expectRevert(IVibeCredit.NotDelegator.selector);
        credit.reclaimCollateral(creditLineId);
    }

    // ============ NFT Transfer ============

    function test_nftTransferUpdatesDelegator() public {
        vm.prank(alice);
        credit.transferFrom(alice, keeper, creditLineId);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(creditLineId);
        assertEq(cl.delegator, keeper);

        // New delegator can close
        vm.prank(keeper);
        credit.closeCreditLine(creditLineId);
    }

    // ============ JUL Rewards ============

    function test_depositJulRewards() public {
        credit.depositJulRewards(100e18);
        assertEq(credit.julRewardPool(), 100e18);
    }

    function test_revertDepositJulZero() public {
        vm.expectRevert(IVibeCredit.ZeroAmount.selector);
        credit.depositJulRewards(0);
    }

    // ============ Full Lifecycle ============

    function test_fullLifecycle() public {
        // 1. Bob borrows 50% of limit
        vm.prank(bob);
        credit.borrow(creditLineId, 5000e18);

        // 2. Time passes, interest accrues
        vm.warp(block.timestamp + 180 days);

        uint256 debt = credit.totalDebt(creditLineId);
        assertGt(debt, 5000e18);

        // 3. Bob repays everything (principal + interest)
        usdc.mint(bob, 1000e18); // extra for interest
        vm.prank(bob);
        credit.repay(creditLineId, debt + 100e18); // slight overpay, capped

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(creditLineId);
        assertTrue(cl.state == IVibeCredit.CreditState.REPAID);

        // 4. Alice reclaims (principal + interest received)
        uint256 aliceBal = usdc.balanceOf(alice);
        vm.prank(alice);
        credit.reclaimCollateral(creditLineId);
        assertGt(usdc.balanceOf(alice), aliceBal);

        assertTrue(credit.getCreditLine(creditLineId).state == IVibeCredit.CreditState.CLOSED);
    }

    function test_defaultLifecycle() public {
        // Fund JUL
        credit.depositJulRewards(100e18);

        // 1. Bob borrows max
        vm.prank(bob);
        credit.borrow(creditLineId, 7500e18);

        // 2. Bob's reputation drops
        oracle.setTier(bob, 1);

        // 3. Keeper liquidates
        vm.prank(keeper);
        credit.liquidate(creditLineId);

        assertEq(credit.borrowerDefaults(bob), 1);

        // 4. Alice reclaims whatever is left (2500 principal remains)
        vm.prank(alice);
        credit.reclaimCollateral(creditLineId);

        IVibeCredit.CreditLine memory cl = credit.getCreditLine(creditLineId);
        assertTrue(cl.state == IVibeCredit.CreditState.CLOSED);
    }

    // ERC-721 receiver
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
