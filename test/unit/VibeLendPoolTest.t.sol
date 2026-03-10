// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeLendPool.sol";
import "../../contracts/financial/interfaces/IVibeLendPool.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockLendToken is ERC20 {
    constructor(string memory name, string memory sym) ERC20(name, sym) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockFlashReceiver is IFlashLoanReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 fee,
        bytes calldata
    ) external returns (bool) {
        // Repay amount + fee
        IERC20(asset).transfer(msg.sender, amount + fee);
        return true;
    }
}

contract BadFlashReceiver is IFlashLoanReceiver {
    function executeOperation(address, uint256, uint256, bytes calldata) external pure returns (bool) {
        return true; // Doesn't repay
    }
}

// ============ Tests ============

contract VibeLendPoolTest is Test {
    VibeLendPool public pool;
    MockLendToken public dai;
    MockLendToken public weth;
    MockFlashReceiver public flashReceiver;

    address alice = address(0xA1);
    address bob = address(0xB0);
    address liquidator = address(0xCC);

    // Market params
    uint256 constant LTV = 7500;         // 75%
    uint256 constant LIQ_THRESHOLD = 8000; // 80%
    uint256 constant LIQ_BONUS = 500;    // 5%
    uint256 constant RESERVE_FACTOR = 1000; // 10%

    function setUp() public {
        // Deploy via proxy
        VibeLendPool impl = new VibeLendPool();
        bytes memory initData = abi.encodeCall(VibeLendPool.initialize, ());
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        pool = VibeLendPool(address(proxy));

        dai = new MockLendToken("DAI", "DAI");
        weth = new MockLendToken("WETH", "WETH");
        flashReceiver = new MockFlashReceiver();

        // Create markets
        pool.createMarket(address(dai), LTV, LIQ_THRESHOLD, LIQ_BONUS, RESERVE_FACTOR);
        pool.createMarket(address(weth), LTV, LIQ_THRESHOLD, LIQ_BONUS, RESERVE_FACTOR);

        // Fund accounts
        dai.mint(alice, 1_000_000e18);
        dai.mint(bob, 1_000_000e18);
        dai.mint(liquidator, 1_000_000e18);
        weth.mint(alice, 10_000e18);
        weth.mint(bob, 10_000e18);

        // Approve
        vm.prank(alice);
        dai.approve(address(pool), type(uint256).max);
        vm.prank(alice);
        weth.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        dai.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        weth.approve(address(pool), type(uint256).max);
        vm.prank(liquidator);
        dai.approve(address(pool), type(uint256).max);
    }

    // ============ Market Creation ============

    function test_createMarket() public view {
        IVibeLendPool.Market memory m = pool.getMarket(address(dai));
        assertEq(m.asset, address(dai));
        assertEq(m.ltvBps, LTV);
        assertEq(m.liquidationThreshold, LIQ_THRESHOLD);
        assertEq(m.liquidationBonus, LIQ_BONUS);
        assertTrue(m.active);
        assertEq(pool.getMarketCount(), 2);
    }

    function test_revertCreateDuplicateMarket() public {
        vm.expectRevert("LendPool: market exists");
        pool.createMarket(address(dai), LTV, LIQ_THRESHOLD, LIQ_BONUS, RESERVE_FACTOR);
    }

    function test_revertCreateMarketZeroAddress() public {
        vm.expectRevert("LendPool: zero address");
        pool.createMarket(address(0), LTV, LIQ_THRESHOLD, LIQ_BONUS, RESERVE_FACTOR);
    }

    function test_revertCreateMarketHighLTV() public {
        MockLendToken newToken = new MockLendToken("X", "X");
        vm.expectRevert("LendPool: ltv > 100%");
        pool.createMarket(address(newToken), 10001, LIQ_THRESHOLD, LIQ_BONUS, RESERVE_FACTOR);
    }

    function test_revertCreateMarketThresholdLessThanLTV() public {
        MockLendToken newToken = new MockLendToken("X", "X");
        vm.expectRevert("LendPool: threshold < ltv");
        pool.createMarket(address(newToken), 8000, 7000, LIQ_BONUS, RESERVE_FACTOR);
    }

    function test_revertCreateMarketNotOwner() public {
        MockLendToken newToken = new MockLendToken("X", "X");
        vm.prank(alice);
        vm.expectRevert();
        pool.createMarket(address(newToken), LTV, LIQ_THRESHOLD, LIQ_BONUS, RESERVE_FACTOR);
    }

    // ============ Deposit ============

    function test_deposit() public {
        vm.prank(alice);
        pool.deposit(address(dai), 1000e18);

        IVibeLendPool.UserPosition memory pos = pool.getUserPosition(address(dai), alice);
        assertEq(pos.deposited, 1000e18);

        IVibeLendPool.Market memory m = pool.getMarket(address(dai));
        assertEq(m.totalDeposits, 1000e18);
    }

    function test_depositMultiple() public {
        vm.prank(alice);
        pool.deposit(address(dai), 500e18);
        vm.prank(alice);
        pool.deposit(address(dai), 500e18);

        IVibeLendPool.UserPosition memory pos = pool.getUserPosition(address(dai), alice);
        assertEq(pos.deposited, 1000e18);
    }

    function test_revertDepositZero() public {
        vm.prank(alice);
        vm.expectRevert("LendPool: zero amount");
        pool.deposit(address(dai), 0);
    }

    // ============ Withdraw ============

    function test_withdraw() public {
        vm.prank(alice);
        pool.deposit(address(dai), 1000e18);

        uint256 balanceBefore = dai.balanceOf(alice);
        vm.prank(alice);
        pool.withdraw(address(dai), 500e18);

        assertEq(dai.balanceOf(alice), balanceBefore + 500e18);
        IVibeLendPool.UserPosition memory pos = pool.getUserPosition(address(dai), alice);
        assertEq(pos.deposited, 500e18);
    }

    function test_revertWithdrawInsufficient() public {
        vm.prank(alice);
        pool.deposit(address(dai), 100e18);

        vm.prank(alice);
        vm.expectRevert("LendPool: insufficient deposit");
        pool.withdraw(address(dai), 200e18);
    }

    // ============ Borrow ============

    function test_borrow() public {
        // Alice deposits collateral
        vm.prank(alice);
        pool.deposit(address(dai), 10_000e18);

        // Bob deposits DAI as lending supply
        vm.prank(bob);
        pool.deposit(address(dai), 100_000e18);

        // Alice borrows against her deposit
        vm.prank(alice);
        pool.borrow(address(dai), 5000e18);

        IVibeLendPool.UserPosition memory pos = pool.getUserPosition(address(dai), alice);
        assertEq(pos.borrowed, 5000e18);
    }

    function test_revertBorrowExceedsLTV() public {
        vm.prank(alice);
        pool.deposit(address(dai), 1000e18);

        // LTV = 75%, so max borrow = 800 (threshold), but health factor check is more nuanced
        // Try to borrow more than position supports
        vm.prank(alice);
        vm.expectRevert("LendPool: unhealthy position");
        pool.borrow(address(dai), 900e18);
    }

    function test_revertBorrowZero() public {
        vm.prank(alice);
        vm.expectRevert("LendPool: zero amount");
        pool.borrow(address(dai), 0);
    }

    // ============ Repay ============

    function test_repay() public {
        vm.prank(alice);
        pool.deposit(address(dai), 10_000e18);
        vm.prank(bob);
        pool.deposit(address(dai), 100_000e18);

        vm.prank(alice);
        pool.borrow(address(dai), 5000e18);

        vm.prank(alice);
        pool.repay(address(dai), 3000e18);

        IVibeLendPool.UserPosition memory pos = pool.getUserPosition(address(dai), alice);
        assertEq(pos.borrowed, 2000e18);
    }

    function test_repayFull() public {
        vm.prank(alice);
        pool.deposit(address(dai), 10_000e18);
        vm.prank(bob);
        pool.deposit(address(dai), 100_000e18);

        vm.prank(alice);
        pool.borrow(address(dai), 5000e18);

        vm.prank(alice);
        pool.repay(address(dai), 5000e18);

        IVibeLendPool.UserPosition memory pos = pool.getUserPosition(address(dai), alice);
        assertEq(pos.borrowed, 0);
    }

    function test_repayExcessCappedAtDebt() public {
        vm.prank(alice);
        pool.deposit(address(dai), 10_000e18);
        vm.prank(bob);
        pool.deposit(address(dai), 100_000e18);

        vm.prank(alice);
        pool.borrow(address(dai), 1000e18);

        // Try to repay more than owed — should cap at borrowed
        uint256 balanceBefore = dai.balanceOf(alice);
        vm.prank(alice);
        pool.repay(address(dai), 5000e18);

        IVibeLendPool.UserPosition memory pos = pool.getUserPosition(address(dai), alice);
        assertEq(pos.borrowed, 0);
        // Only 1000 was actually taken
        assertEq(dai.balanceOf(alice), balanceBefore - 1000e18);
    }

    // ============ Interest ============

    function test_interestAccrues() public {
        vm.prank(alice);
        pool.deposit(address(dai), 100_000e18);
        vm.prank(bob);
        pool.deposit(address(dai), 100_000e18);

        vm.prank(alice);
        pool.borrow(address(dai), 50_000e18);

        vm.warp(block.timestamp + 365 days);

        // Trigger interest accrual via deposit
        vm.prank(bob);
        pool.deposit(address(dai), 1);

        IVibeLendPool.Market memory m = pool.getMarket(address(dai));
        assertGt(m.totalBorrows, 50_000e18, "Borrows should increase from interest");
        assertGt(m.borrowIndex, 1e18, "Borrow index should increase");
    }

    function test_utilizationCalculation() public {
        vm.prank(alice);
        pool.deposit(address(dai), 100_000e18);

        // No borrows → 0 utilization
        assertEq(pool.getUtilization(address(dai)), 0);

        vm.prank(alice);
        pool.borrow(address(dai), 50_000e18);

        // 50% utilization
        assertEq(pool.getUtilization(address(dai)), 0.5e18);
    }

    function test_interestRateBelowOptimal() public view {
        // At 0 utilization: base rate = 2%
        uint256 rate = pool.getInterestRate(address(dai));
        assertEq(rate, 0.02e18);
    }

    // ============ Liquidation ============

    function test_liquidation() public {
        // Alice deposits collateral and borrows near liquidation threshold
        vm.prank(alice);
        pool.deposit(address(dai), 1000e18);
        vm.prank(bob);
        pool.deposit(address(dai), 100_000e18);

        // Borrow 799 DAI: HF = (1000 * 80%) / 799 = 1.00125 (barely healthy)
        vm.prank(alice);
        pool.borrow(address(dai), 799e18);

        // Accrue interest over 2 years to tip position underwater
        vm.warp(block.timestamp + 730 days);

        // Trigger accrual (view function doesn't accrue)
        vm.prank(bob);
        pool.deposit(address(dai), 1);

        // Check health factor is below 1
        uint256 hf = pool.getHealthFactor(alice);
        assertLt(hf, 1e18, "Position should be unhealthy after interest accrual");

        // Liquidator repays half the debt
        vm.prank(liquidator);
        pool.liquidate(alice, address(dai), address(dai));
    }

    function test_revertLiquidateHealthyPosition() public {
        vm.prank(alice);
        pool.deposit(address(dai), 10_000e18);
        vm.prank(bob);
        pool.deposit(address(dai), 100_000e18);

        vm.prank(alice);
        pool.borrow(address(dai), 1000e18); // Very healthy position

        vm.prank(liquidator);
        vm.expectRevert("LendPool: position healthy");
        pool.liquidate(alice, address(dai), address(dai));
    }

    function test_revertSelfLiquidation() public {
        vm.prank(alice);
        vm.expectRevert("LendPool: self-liquidation");
        pool.liquidate(alice, address(dai), address(dai));
    }

    // ============ Flash Loans ============

    function test_flashLoan() public {
        vm.prank(alice);
        pool.deposit(address(dai), 100_000e18);

        // Fund receiver to pay fee
        uint256 fee = (50_000e18 * 5) / 10_000;
        dai.mint(address(flashReceiver), fee);

        // Flash loan caller must implement executeOperation callback
        vm.prank(address(flashReceiver));
        pool.flashLoan(address(dai), 50_000e18, "");
    }

    function test_revertFlashLoanNotRepaid() public {
        vm.prank(alice);
        pool.deposit(address(dai), 100_000e18);

        BadFlashReceiver badReceiver = new BadFlashReceiver();

        vm.prank(address(badReceiver));
        vm.expectRevert("LendPool: flash loan not repaid");
        pool.flashLoan(address(dai), 50_000e18, "");
    }

    function test_revertFlashLoanZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert("LendPool: zero amount");
        pool.flashLoan(address(dai), 0, "");
    }

    // ============ Views ============

    function test_healthFactorNoDebt() public view {
        uint256 hf = pool.getHealthFactor(alice);
        assertEq(hf, type(uint256).max);
    }

    function test_getMarketCount() public view {
        assertEq(pool.getMarketCount(), 2);
    }

    // ============ Reserves ============

    function test_collectReserves() public {
        // Generate reserves via interest
        vm.prank(alice);
        pool.deposit(address(dai), 100_000e18);
        vm.prank(bob);
        pool.deposit(address(dai), 100_000e18);
        vm.prank(alice);
        pool.borrow(address(dai), 50_000e18);

        vm.warp(block.timestamp + 365 days);

        // Trigger accrual
        vm.prank(bob);
        pool.deposit(address(dai), 1);

        uint256 reserveBalance = pool.reserves(address(dai));
        assertGt(reserveBalance, 0, "Should have reserves after interest accrual");

        uint256 ownerBefore = dai.balanceOf(address(this));
        pool.collectReserves(address(dai), reserveBalance);
        assertEq(dai.balanceOf(address(this)), ownerBefore + reserveBalance);
    }

    function test_revertCollectReservesInsufficient() public {
        vm.expectRevert("LendPool: insufficient reserves");
        pool.collectReserves(address(dai), 1);
    }
}
