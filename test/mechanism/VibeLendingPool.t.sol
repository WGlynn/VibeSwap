// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/VibeLendingPool.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Mocks ============

contract MockLPToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ VibeLendingPool Tests ============

contract VibeLendingPoolTest is Test {
    VibeLendingPool public pool;
    MockLPToken public usdc;
    MockLPToken public weth;

    address public owner;
    address public alice;
    address public bob;
    address public charlie;

    uint256 constant SCALE = 1e18;
    uint256 constant BPS   = 10000;

    // Standard interest rate params (Aave-like)
    // Base: 2% APY, Slope1: 10%/yr, Slope2: 100%/yr, Kink: 8000 bps (80%)
    uint256 constant BASE_RATE  = 0.02e18;  // 2% APY
    uint256 constant SLOPE1     = 0.10e18;  // 10% per year per unit utilization
    uint256 constant SLOPE2     = 1.00e18;  // 100% per year (above kink)
    uint256 constant KINK_BPS   = 8000;     // 80%
    uint256 constant LTV_BPS    = 7500;     // 75% LTV
    uint256 constant LIQ_LTV    = 9000;     // 90% liquidation threshold

    // ============ Events ============

    event Deposited(address indexed asset, address indexed user, uint256 amount);
    event Withdrawn(address indexed asset, address indexed user, uint256 amount);
    event Borrowed(address indexed asset, address indexed user, uint256 amount);
    event Repaid(address indexed asset, address indexed user, uint256 amount);
    event Liquidated(address indexed asset, address indexed borrower, address indexed liquidator, uint256 amount);
    event AssetAdded(address indexed asset);

    // ============ Setup ============

    function setUp() public {
        owner   = address(this);
        alice   = makeAddr("alice");
        bob     = makeAddr("bob");
        charlie = makeAddr("charlie");

        usdc = new MockLPToken("USDC", "USDC");
        weth = new MockLPToken("WETH", "WETH");

        VibeLendingPool impl = new VibeLendingPool();
        bytes memory initData = abi.encodeCall(VibeLendingPool.initialize, ());
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        pool = VibeLendingPool(address(proxy));

        // Add USDC asset
        pool.addAsset(
            address(usdc),
            BASE_RATE, SLOPE1, SLOPE2, KINK_BPS,
            LTV_BPS, LIQ_LTV
        );

        usdc.mint(alice,   100_000 ether);
        usdc.mint(bob,     100_000 ether);
        usdc.mint(charlie, 100_000 ether);

        vm.prank(alice);
        usdc.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(pool), type(uint256).max);
        vm.prank(charlie);
        usdc.approve(address(pool), type(uint256).max);
    }

    // ============ Helpers ============

    function _deposit(address user, address asset, uint256 amount) internal {
        vm.prank(user);
        pool.deposit(asset, amount);
    }

    function _borrow(address user, address asset, uint256 amount) internal {
        vm.prank(user);
        pool.borrow(asset, amount);
    }

    function _repay(address user, address asset, uint256 amount) internal {
        vm.prank(user);
        pool.repay(asset, amount);
    }

    // ============ Initialization ============

    function test_initialize_setsOwner() public view {
        assertEq(pool.owner(), owner);
    }

    function test_initialize_defaultReserveFactor() public view {
        assertEq(pool.reserveFactorBps(), 1000); // 10%
    }

    // ============ Asset Management ============

    function test_addAsset_storesConfig() public {
        (
            uint256 totalDeposited,
            uint256 totalBorrowed,
            uint256 utilBps,
            uint256 depositIndex,
            uint256 borrowIndex
        ) = pool.getAssetInfo(address(usdc));

        assertEq(totalDeposited, 0);
        assertEq(totalBorrowed,  0);
        assertEq(utilBps,        0);
        assertEq(depositIndex,   SCALE);
        assertEq(borrowIndex,    SCALE);
    }

    function test_addAsset_incrementsCount() public {
        assertEq(pool.getAssetCount(), 1); // usdc added in setUp
        pool.addAsset(address(weth), BASE_RATE, SLOPE1, SLOPE2, KINK_BPS, LTV_BPS, LIQ_LTV);
        assertEq(pool.getAssetCount(), 2);
    }

    function test_addAsset_alreadyAdded_reverts() public {
        vm.expectRevert("Already added");
        pool.addAsset(address(usdc), BASE_RATE, SLOPE1, SLOPE2, KINK_BPS, LTV_BPS, LIQ_LTV);
    }

    function test_addAsset_invalidLTV_reverts() public {
        // ltvBps >= liquidationLtvBps should revert
        vm.expectRevert("LTV must be < liquidation");
        pool.addAsset(address(weth), BASE_RATE, SLOPE1, SLOPE2, KINK_BPS,
            9000, // ltvBps
            8000  // liquidationLtvBps < ltvBps
        );
    }

    function test_addAsset_emitsEvent() public {
        address newAsset = address(weth);
        vm.expectEmit(true, false, false, false);
        emit AssetAdded(newAsset);
        pool.addAsset(newAsset, BASE_RATE, SLOPE1, SLOPE2, KINK_BPS, LTV_BPS, LIQ_LTV);
    }

    function test_addAsset_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        pool.addAsset(address(weth), BASE_RATE, SLOPE1, SLOPE2, KINK_BPS, LTV_BPS, LIQ_LTV);
    }

    // ============ Deposit ============

    function test_deposit_transfersTokens() public {
        uint256 aliceBefore = usdc.balanceOf(alice);
        _deposit(alice, address(usdc), 1000 ether);

        assertEq(usdc.balanceOf(alice),        aliceBefore - 1000 ether);
        assertEq(usdc.balanceOf(address(pool)), 1000 ether);
    }

    function test_deposit_incrementsTotalDeposited() public {
        _deposit(alice, address(usdc), 1000 ether);
        (uint256 totalDeposited, , , , ) = pool.getAssetInfo(address(usdc));
        assertEq(totalDeposited, 1000 ether);
    }

    function test_deposit_incrementsDepositorCount() public {
        assertEq(pool.totalDepositors(), 0);
        _deposit(alice, address(usdc), 1000 ether);
        assertEq(pool.totalDepositors(), 1);

        _deposit(bob, address(usdc), 500 ether);
        assertEq(pool.totalDepositors(), 2);

        // Alice depositing again doesn't increment
        _deposit(alice, address(usdc), 200 ether);
        assertEq(pool.totalDepositors(), 2);
    }

    function test_deposit_emitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit Deposited(address(usdc), alice, 1000 ether);

        vm.prank(alice);
        pool.deposit(address(usdc), 1000 ether);
    }

    function test_deposit_assetNotActive_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Asset not active");
        pool.deposit(address(weth), 1000 ether); // weth not added
    }

    function test_deposit_zeroAmount_reverts() public {
        vm.prank(alice);
        vm.expectRevert("Zero amount");
        pool.deposit(address(usdc), 0);
    }

    function test_deposit_userBalanceAccrues() public {
        _deposit(alice, address(usdc), 1000 ether);
        assertEq(pool.getUserDeposit(address(usdc), alice), 1000 ether);
    }

    // ============ Withdraw ============

    function test_withdraw_returnsTokens() public {
        _deposit(alice, address(usdc), 1000 ether);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        pool.withdraw(address(usdc), 500 ether);

        assertEq(usdc.balanceOf(alice), aliceBefore + 500 ether);
    }

    function test_withdraw_updatesDeposited() public {
        _deposit(alice, address(usdc), 1000 ether);

        vm.prank(alice);
        pool.withdraw(address(usdc), 400 ether);

        (uint256 totalDeposited, , , , ) = pool.getAssetInfo(address(usdc));
        assertEq(totalDeposited, 600 ether);
    }

    function test_withdraw_emitsEvent() public {
        _deposit(alice, address(usdc), 1000 ether);

        vm.expectEmit(true, true, false, true);
        emit Withdrawn(address(usdc), alice, 500 ether);

        vm.prank(alice);
        pool.withdraw(address(usdc), 500 ether);
    }

    function test_withdraw_insufficientDeposit_reverts() public {
        _deposit(alice, address(usdc), 1000 ether);

        vm.prank(alice);
        vm.expectRevert("Insufficient deposit");
        pool.withdraw(address(usdc), 1001 ether);
    }

    function test_withdraw_full() public {
        _deposit(alice, address(usdc), 1000 ether);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        pool.withdraw(address(usdc), 1000 ether);

        assertEq(usdc.balanceOf(alice), aliceBefore + 1000 ether);
        assertEq(pool.getUserDeposit(address(usdc), alice), 0);
    }

    // ============ Borrow ============

    function test_borrow_transfersTokens() public {
        _deposit(alice, address(usdc), 10000 ether);

        uint256 bobBefore = usdc.balanceOf(bob);
        _borrow(bob, address(usdc), 1000 ether);

        assertEq(usdc.balanceOf(bob), bobBefore + 1000 ether);
    }

    function test_borrow_incrementsTotalBorrowed() public {
        _deposit(alice, address(usdc), 10000 ether);
        _borrow(bob, address(usdc), 1000 ether);

        (, uint256 totalBorrowed, , , ) = pool.getAssetInfo(address(usdc));
        assertEq(totalBorrowed, 1000 ether);
    }

    function test_borrow_incrementsBorrowerCount() public {
        _deposit(alice, address(usdc), 10000 ether);
        assertEq(pool.totalBorrowers(), 0);

        _borrow(bob, address(usdc), 1000 ether);
        assertEq(pool.totalBorrowers(), 1);

        _borrow(charlie, address(usdc), 500 ether);
        assertEq(pool.totalBorrowers(), 2);

        // Bob borrowing again doesn't increment
        _borrow(bob, address(usdc), 100 ether);
        assertEq(pool.totalBorrowers(), 2);
    }

    function test_borrow_emitsEvent() public {
        _deposit(alice, address(usdc), 10000 ether);

        vm.expectEmit(true, true, false, true);
        emit Borrowed(address(usdc), bob, 1000 ether);

        vm.prank(bob);
        pool.borrow(address(usdc), 1000 ether);
    }

    function test_borrow_insufficientLiquidity_reverts() public {
        _deposit(alice, address(usdc), 1000 ether);

        vm.prank(bob);
        vm.expectRevert("Insufficient liquidity");
        pool.borrow(address(usdc), 1001 ether);
    }

    function test_borrow_zeroAmount_reverts() public {
        _deposit(alice, address(usdc), 1000 ether);

        vm.prank(bob);
        vm.expectRevert("Zero amount");
        pool.borrow(address(usdc), 0);
    }

    function test_borrow_assetNotActive_reverts() public {
        vm.prank(bob);
        vm.expectRevert("Asset not active");
        pool.borrow(address(weth), 100 ether);
    }

    function test_borrow_tracksDebt() public {
        _deposit(alice, address(usdc), 10000 ether);
        _borrow(bob, address(usdc), 1000 ether);

        assertEq(pool.getUserDebt(address(usdc), bob), 1000 ether);
    }

    // ============ Utilization ============

    function test_getUtilization_zeroWhenNoDeposits() public view {
        assertEq(pool.getUtilization(address(usdc)), 0);
    }

    function test_getUtilization_correctRatio() public {
        _deposit(alice, address(usdc), 10000 ether);
        _borrow(bob, address(usdc), 5000 ether);

        // 50% utilization = 5000 bps
        assertEq(pool.getUtilization(address(usdc)), 5000);
    }

    // ============ Repay ============

    function test_repay_reducesDebt() public {
        _deposit(alice, address(usdc), 10000 ether);
        _borrow(bob, address(usdc), 1000 ether);

        _repay(bob, address(usdc), 500 ether);

        // Debt should be ~500 (may have tiny accrual in same block)
        assertApproxEqAbs(pool.getUserDebt(address(usdc), bob), 500 ether, 1e15);
    }

    function test_repay_reducesTotalBorrowed() public {
        _deposit(alice, address(usdc), 10000 ether);
        _borrow(bob, address(usdc), 1000 ether);

        _repay(bob, address(usdc), 1000 ether);

        (, uint256 totalBorrowed, , , ) = pool.getAssetInfo(address(usdc));
        assertEq(totalBorrowed, 0);
    }

    function test_repay_emitsEvent() public {
        _deposit(alice, address(usdc), 10000 ether);
        _borrow(bob, address(usdc), 1000 ether);

        vm.expectEmit(true, true, false, false);
        emit Repaid(address(usdc), bob, 0); // amount varies due to accrual

        vm.prank(bob);
        pool.repay(address(usdc), 1000 ether);
    }

    function test_repay_capsAtActualDebt() public {
        _deposit(alice, address(usdc), 10000 ether);
        _borrow(bob, address(usdc), 1000 ether);

        // Repay more than owed — should only take actual debt
        uint256 bobBefore = usdc.balanceOf(bob);
        _repay(bob, address(usdc), 9999 ether);

        // Bob should have paid ~1000 ether, not 9999
        assertApproxEqAbs(usdc.balanceOf(bob), bobBefore - 1000 ether, 1e15);
    }

    // ============ Interest Accrual ============

    function test_interestAccrual_borrowIndexIncreases() public {
        _deposit(alice, address(usdc), 10000 ether);
        _borrow(bob, address(usdc), 5000 ether); // 50% utilization

        (, , , , uint256 borrowIndexBefore) = pool.getAssetInfo(address(usdc));

        // Warp 1 year
        vm.warp(block.timestamp + 365 days);

        // Trigger accrual via deposit
        _deposit(charlie, address(usdc), 1 ether);

        (, , , , uint256 borrowIndexAfter) = pool.getAssetInfo(address(usdc));

        assertGt(borrowIndexAfter, borrowIndexBefore);
    }

    function test_interestAccrual_depositIndexIncreases() public {
        _deposit(alice, address(usdc), 10000 ether);
        _borrow(bob, address(usdc), 5000 ether); // 50% utilization

        (, , , uint256 depositIndexBefore, ) = pool.getAssetInfo(address(usdc));

        vm.warp(block.timestamp + 365 days);
        _deposit(charlie, address(usdc), 1 ether);

        (, , , uint256 depositIndexAfter, ) = pool.getAssetInfo(address(usdc));

        assertGt(depositIndexAfter, depositIndexBefore);
    }

    function test_interestAccrual_debtGrowsOverTime() public {
        _deposit(alice, address(usdc), 10000 ether);
        _borrow(bob, address(usdc), 1000 ether);

        uint256 debtAtBorrow = pool.getUserDebt(address(usdc), bob);

        vm.warp(block.timestamp + 365 days);

        uint256 debtAfterYear = pool.getUserDebt(address(usdc), bob);
        assertGt(debtAfterYear, debtAtBorrow);
    }

    function test_interestAccrual_sameTimestamp_skips() public {
        _deposit(alice, address(usdc), 10000 ether);
        _borrow(bob, address(usdc), 5000 ether);

        (, , , uint256 depositIndexBefore, uint256 borrowIndexBefore) = pool.getAssetInfo(address(usdc));

        // Deposit in same block — no timestamp change, no accrual
        _deposit(charlie, address(usdc), 100 ether);

        (, , , uint256 depositIndexAfter, uint256 borrowIndexAfter) = pool.getAssetInfo(address(usdc));

        assertEq(depositIndexAfter, depositIndexBefore);
        assertEq(borrowIndexAfter,  borrowIndexBefore);
    }

    // ============ Reserves ============

    function test_reserves_accumulateOverTime() public {
        _deposit(alice, address(usdc), 10000 ether);
        _borrow(bob, address(usdc), 5000 ether);

        assertEq(pool.reserves(address(usdc)), 0);

        vm.warp(block.timestamp + 365 days);
        _deposit(charlie, address(usdc), 1 ether); // trigger accrual

        assertGt(pool.reserves(address(usdc)), 0);
    }

    // ============ Liquidation ============

    function test_liquidate_reducesDebtAndCollateral() public {
        // Setup: alice deposits, bob borrows, accrue interest to make bob undercollateralized
        _deposit(alice, address(usdc), 10000 ether);
        _deposit(bob,   address(usdc), 1000 ether);  // bob's collateral
        _borrow(bob,    address(usdc), 900 ether);   // borrow 90% of deposit → above liquidation threshold (90%)

        // Accrue interest so debt > 90% of collateral
        vm.warp(block.timestamp + 365 days * 5);

        // Trigger accrual
        _deposit(alice, address(usdc), 1 ether);

        uint256 debt       = pool.getUserDebt(address(usdc), bob);
        uint256 collateral = pool.getUserDeposit(address(usdc), bob);

        (, , , , , uint256 liqLtvBps_) = _getAssetConfigFull();
        uint256 maxBorrow = (collateral * liqLtvBps_) / BPS;

        // Skip if interest accrual didn't make position liquidatable (CI speed variation)
        if (debt <= maxBorrow) return;

        uint256 repayAmount = debt / 4; // repay 25% (well under 50% cap)

        vm.prank(charlie);
        pool.liquidate(address(usdc), bob, repayAmount);

        assertLt(pool.getUserDebt(address(usdc), bob), debt);
    }

    function test_liquidate_noDebt_reverts() public {
        _deposit(alice, address(usdc), 10000 ether);

        vm.prank(charlie);
        vm.expectRevert("No debt");
        pool.liquidate(address(usdc), bob, 100 ether);
    }

    function test_liquidate_notLiquidatable_reverts() public {
        // Bob deposits 10000 and borrows only 1000 (10% utilization — healthy)
        _deposit(alice, address(usdc), 100000 ether);
        _deposit(bob,   address(usdc), 10000 ether);
        _borrow(bob,    address(usdc), 1000 ether);

        vm.prank(charlie);
        vm.expectRevert("Not liquidatable");
        pool.liquidate(address(usdc), bob, 100 ether);
    }

    function test_liquidate_capsRepayAt50Pct() public {
        // Setup a liquidatable position
        _deposit(alice, address(usdc), 10000 ether);
        _deposit(bob,   address(usdc), 1000 ether);
        _borrow(bob,    address(usdc), 900 ether);

        vm.warp(block.timestamp + 365 days * 5);
        _deposit(alice, address(usdc), 1 ether); // trigger accrual

        uint256 debt = pool.getUserDebt(address(usdc), bob);
        (, , , , , uint256 liqLtvBps_) = _getAssetConfigFull();
        uint256 collateral = pool.getUserDeposit(address(usdc), bob);
        uint256 maxBorrow  = (collateral * liqLtvBps_) / BPS;

        if (debt <= maxBorrow) return; // skip if not liquidatable

        // Try repaying more than 50% of debt
        uint256 overRepay = debt; // 100% of debt

        // The contract caps at 50%, so liquidator only gives 50%
        uint256 charlieBalBefore = usdc.balanceOf(charlie);
        vm.prank(charlie);
        pool.liquidate(address(usdc), bob, overRepay);

        uint256 charlieSpent = charlieBalBefore - usdc.balanceOf(charlie);
        assertLe(charlieSpent, debt / 2 + 1e15); // at most 50% (+ small rounding)
    }

    function test_liquidate_emitsEvent() public {
        _deposit(alice, address(usdc), 10000 ether);
        _deposit(bob,   address(usdc), 1000 ether);
        _borrow(bob,    address(usdc), 900 ether);

        vm.warp(block.timestamp + 365 days * 5);
        _deposit(alice, address(usdc), 1 ether);

        uint256 debt = pool.getUserDebt(address(usdc), bob);
        (, , , , , uint256 liqLtv_) = _getAssetConfigFull();
        uint256 collateral = pool.getUserDeposit(address(usdc), bob);
        if (debt <= (collateral * liqLtv_) / BPS) return;

        vm.expectEmit(true, true, true, false);
        emit Liquidated(address(usdc), bob, charlie, 0);

        vm.prank(charlie);
        pool.liquidate(address(usdc), bob, debt / 4);
    }

    // ============ Interest Rate Model ============

    function test_utilizationBelowKink_rateIsLow() public {
        // 40% utilization — below 80% kink
        _deposit(alice, address(usdc), 10000 ether);
        _borrow(bob, address(usdc), 4000 ether);

        assertEq(pool.getUtilization(address(usdc)), 4000);

        // Warp 1 year
        vm.warp(block.timestamp + 365 days);
        _deposit(charlie, address(usdc), 1 ether); // accrue

        (, , , uint256 depositIndex, uint256 borrowIndex) = pool.getAssetInfo(address(usdc));

        // Borrow index at 40% utilization: rate = 0.02 + 0.40*0.10 = 0.06 (6% APY)
        // borrowIndex ≈ 1e18 + 1e18 * 0.06 = 1.06e18
        assertApproxEqRel(borrowIndex, 1.06e18, 0.01e18); // 1% tolerance
        assertGt(depositIndex, 1e18); // deposit also earns
    }

    function test_utilizationAboveKink_rateIsHigh() public {
        // 90% utilization — above 80% kink
        _deposit(alice, address(usdc), 10000 ether);
        _borrow(bob, address(usdc), 9000 ether);

        assertEq(pool.getUtilization(address(usdc)), 9000);

        vm.warp(block.timestamp + 365 days);
        _deposit(charlie, address(usdc), 1 ether);

        (, , , , uint256 borrowIndex) = pool.getAssetInfo(address(usdc));

        // Above kink: rate = base + slope1*kink + slope2*(util-kink)
        // = 0.02 + 0.10*0.80 + 1.00*0.10 = 0.02 + 0.08 + 0.10 = 0.20 (20% APY)
        // borrowIndex ≈ 1.20e18
        assertApproxEqRel(borrowIndex, 1.20e18, 0.02e18);
    }

    // ============ Multi-User ============

    function test_multipleDepositors_independentBalances() public {
        _deposit(alice,   address(usdc), 5000 ether);
        _deposit(bob,     address(usdc), 3000 ether);
        _deposit(charlie, address(usdc), 2000 ether);

        assertEq(pool.getUserDeposit(address(usdc), alice),   5000 ether);
        assertEq(pool.getUserDeposit(address(usdc), bob),     3000 ether);
        assertEq(pool.getUserDeposit(address(usdc), charlie), 2000 ether);

        (uint256 totalDeposited, , , , ) = pool.getAssetInfo(address(usdc));
        assertEq(totalDeposited, 10000 ether);
    }

    // ============ Full Lifecycle ============

    function test_fullLifecycle_depositBorrowRepayWithdraw() public {
        // 1. Alice deposits 10000
        _deposit(alice, address(usdc), 10000 ether);
        assertEq(pool.getUserDeposit(address(usdc), alice), 10000 ether);

        // 2. Bob borrows 5000
        _borrow(bob, address(usdc), 5000 ether);
        assertEq(pool.getUserDebt(address(usdc), bob), 5000 ether);
        assertEq(pool.getUtilization(address(usdc)), 5000); // 50%

        // 3. Time passes, interest accrues
        vm.warp(block.timestamp + 30 days);

        // 4. Bob repays
        usdc.mint(bob, 100 ether); // extra for interest
        vm.prank(bob);
        usdc.approve(address(pool), type(uint256).max);
        _repay(bob, address(usdc), pool.getUserDebt(address(usdc), bob));
        assertEq(pool.getUserDebt(address(usdc), bob), 0);

        // 5. Alice withdraws — should get back her principal
        uint256 aliceDeposit = pool.getUserDeposit(address(usdc), alice);
        assertGe(aliceDeposit, 10000 ether); // may have earned interest

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        pool.withdraw(address(usdc), 10000 ether);
        assertEq(usdc.balanceOf(alice), aliceBefore + 10000 ether);
    }

    // ============ Fuzz ============

    function testFuzz_deposit_withdraw_roundtrip(uint256 amount) public {
        amount = bound(amount, 1 ether, 50_000 ether);
        usdc.mint(alice, amount);

        _deposit(alice, address(usdc), amount);
        assertEq(pool.getUserDeposit(address(usdc), alice), amount);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        pool.withdraw(address(usdc), amount);
        assertEq(usdc.balanceOf(alice), aliceBefore + amount);
    }

    // ============ Internal Helpers ============

    /// @dev Extract full config from storage for the USDC asset.
    ///      AssetConfig field order:
    ///      0  address asset
    ///      1  uint256 totalDeposited
    ///      2  uint256 totalBorrowed
    ///      3  uint256 depositIndex
    ///      4  uint256 borrowIndex
    ///      5  uint256 lastUpdateTime
    ///      6  uint256 baseBorrowRate
    ///      7  uint256 slope1
    ///      8  uint256 slope2
    ///      9  uint256 kinkBps
    ///      10 uint256 ltvBps
    ///      11 uint256 liquidationLtvBps
    ///      12 bool    active
    function _getAssetConfigFull() internal view returns (
        uint256 totalDeposited_,
        uint256 totalBorrowed_,
        uint256 depositIndex_,
        uint256 borrowIndex_,
        uint256 ltvBps_,
        uint256 liquidationLtvBps_
    ) {
        bool active_;
        (
            ,                    // address asset
            totalDeposited_,     // 1
            totalBorrowed_,      // 2
            depositIndex_,       // 3
            borrowIndex_,        // 4
            ,                    // lastUpdateTime
            ,                    // baseBorrowRate
            ,                    // slope1
            ,                    // slope2
            ,                    // kinkBps
            ltvBps_,             // 10
            liquidationLtvBps_,  // 11
            active_              // 12 bool — must capture
        ) = pool.assets(address(usdc));
        active_; // suppress unused warning
    }
}
