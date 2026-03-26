// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeYieldAggregator.sol";
import "../../contracts/financial/interfaces/IStrategyVault.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockFuzzToken is ERC20 {
    constructor() ERC20("YIELD", "YLD") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice Mock strategy that holds tokens and simulates configurable yield
contract MockFuzzStrategy is IStrategy {
    address public immutable override asset;
    address public override vault;
    uint256 public pendingProfit;

    constructor(address asset_) {
        asset = asset_;
    }

    function setVault(address v) external { vault = v; }
    function setPendingProfit(uint256 p) external { pendingProfit = p; }

    function totalAssets() external view override returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    function deposit(uint256) external override {
        // Tokens are already transferred to us before deposit() is called
    }

    function withdraw(uint256 amount) external override returns (uint256) {
        uint256 bal = IERC20(asset).balanceOf(address(this));
        uint256 actual = amount < bal ? amount : bal;
        IERC20(asset).transfer(msg.sender, actual);
        return actual;
    }

    function harvest() external override returns (uint256 profit) {
        profit = pendingProfit;
        pendingProfit = 0;
    }

    function emergencyWithdraw() external override returns (uint256 recovered) {
        recovered = IERC20(asset).balanceOf(address(this));
        IERC20(asset).transfer(msg.sender, recovered);
    }
}

// ============ Fuzz Tests ============

/**
 * @title VibeYieldAggregator Fuzz Tests
 * @notice Fuzz testing for the yield aggregator. Covers:
 *         - Deposit/withdraw share accounting with random amounts
 *         - Multiple depositors with varying shares
 *         - Fee calculation correctness under random profits
 *         - Strategy debt ratio bounds
 *         - Migration timelock enforcement
 *         - Emergency shutdown behavior with random state
 */
contract VibeYieldAggregatorFuzzTest is Test {
    VibeYieldAggregator public agg;
    MockFuzzToken public token;
    MockFuzzStrategy public strategy;

    address alice = address(0xA1);
    address bob = address(0xB0);
    address keeperAddr = address(0xCC);

    uint256 constant PERF_FEE = 2000;  // 20%
    uint256 constant MGMT_FEE = 200;   // 2%
    uint256 constant BPS = 10_000;

    uint256 vaultId;

    function setUp() public {
        token = new MockFuzzToken();

        VibeYieldAggregator impl = new VibeYieldAggregator();
        bytes memory initData = abi.encodeCall(
            VibeYieldAggregator.initialize,
            (address(0), keeperAddr)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        agg = VibeYieldAggregator(address(proxy));

        vaultId = agg.createVault(address(token), "YLD Vault", 0, PERF_FEE, MGMT_FEE);

        strategy = new MockFuzzStrategy(address(token));
        strategy.setVault(address(agg));

        // Fund accounts generously
        token.mint(alice, 1_000_000_000e18);
        token.mint(bob, 1_000_000_000e18);

        vm.prank(alice);
        token.approve(address(agg), type(uint256).max);
        vm.prank(bob);
        token.approve(address(agg), type(uint256).max);
    }

    // ============ Deposit Share Accounting ============

    function testFuzz_firstDepositorGets1to1(uint256 amount) public {
        amount = bound(amount, 1e18, 100_000_000e18);

        vm.prank(alice);
        uint256 shares = agg.deposit(vaultId, amount);

        assertEq(shares, amount, "First depositor should get 1:1 shares");
        assertEq(agg.balanceOf(vaultId, alice), amount);
    }

    function testFuzz_secondDepositorProportional(uint256 firstDeposit, uint256 secondDeposit) public {
        firstDeposit = bound(firstDeposit, 1e18, 100_000_000e18);
        secondDeposit = bound(secondDeposit, 1e18, 100_000_000e18);

        vm.prank(alice);
        uint256 aliceShares = agg.deposit(vaultId, firstDeposit);

        vm.prank(bob);
        uint256 bobShares = agg.deposit(vaultId, secondDeposit);

        // With no strategy gains, shares should be 1:1 with deposits
        assertEq(aliceShares, firstDeposit);
        assertEq(bobShares, secondDeposit);
    }

    function testFuzz_depositAndWithdrawPreservesBalance(uint256 amount) public {
        amount = bound(amount, 1e18, 10_000_000e18);

        uint256 balBefore = token.balanceOf(alice);

        vm.prank(alice);
        uint256 shares = agg.deposit(vaultId, amount);

        vm.prank(alice);
        uint256 assets = agg.withdraw(vaultId, shares);

        uint256 balAfter = token.balanceOf(alice);

        // Should get back exactly what was deposited (no strategy, no gains/losses)
        assertEq(balAfter, balBefore, "Full deposit-withdraw cycle should preserve balance");
        assertEq(assets, amount);
    }

    function testFuzz_depositCapEnforced(uint256 cap, uint256 depositAmount) public {
        cap = bound(cap, 1e18, 100_000e18);
        depositAmount = bound(depositAmount, cap + 1, cap + 100_000e18);

        agg.setDepositCap(vaultId, cap);

        vm.prank(alice);
        vm.expectRevert(VibeYieldAggregator.DepositCapExceeded.selector);
        agg.deposit(vaultId, depositAmount);
    }

    // ============ Withdraw Accounting ============

    function testFuzz_partialWithdraw(uint256 depositAmount, uint256 withdrawPercent) public {
        depositAmount = bound(depositAmount, 10e18, 10_000_000e18);
        withdrawPercent = bound(withdrawPercent, 1, 99);

        vm.prank(alice);
        uint256 shares = agg.deposit(vaultId, depositAmount);

        uint256 sharesToWithdraw = (shares * withdrawPercent) / 100;
        if (sharesToWithdraw == 0) sharesToWithdraw = 1;

        vm.prank(alice);
        uint256 assets = agg.withdraw(vaultId, sharesToWithdraw);

        assertGt(assets, 0, "Should receive some assets");
        assertEq(
            agg.balanceOf(vaultId, alice),
            shares - sharesToWithdraw,
            "Remaining shares should match"
        );
    }

    function testFuzz_revertWithdrawMoreThanBalance(uint256 depositAmount, uint256 extraShares) public {
        depositAmount = bound(depositAmount, 1e18, 10_000_000e18);
        extraShares = bound(extraShares, 1, 10_000_000e18);

        vm.prank(alice);
        uint256 shares = agg.deposit(vaultId, depositAmount);

        vm.prank(alice);
        vm.expectRevert(VibeYieldAggregator.InsufficientShares.selector);
        agg.withdraw(vaultId, shares + extraShares);
    }

    // ============ Emergency Withdraw ============

    function testFuzz_emergencyWithdrawReturnsAll(uint256 amount) public {
        amount = bound(amount, 1e18, 10_000_000e18);

        vm.prank(alice);
        agg.deposit(vaultId, amount);

        uint256 balBefore = token.balanceOf(alice);
        vm.prank(alice);
        agg.emergencyWithdraw(vaultId);
        uint256 balAfter = token.balanceOf(alice);

        assertGe(balAfter - balBefore, amount - 1, "Emergency withdraw should return all (minus rounding)");
        assertEq(agg.balanceOf(vaultId, alice), 0, "Shares should be zero after emergency withdraw");
    }

    // ============ Strategy Debt Ratio ============

    function testFuzz_addStrategyValidDebtRatio(uint256 ratio) public {
        ratio = bound(ratio, 1, BPS);

        agg.addStrategy(vaultId, address(strategy), ratio);

        VibeYieldAggregator.StrategySlot[] memory slots = agg.getStrategies(vaultId);
        assertEq(slots[0].debtRatio, ratio);
    }

    function testFuzz_updateDebtRatioBounded(uint256 initialRatio, uint256 newRatio) public {
        initialRatio = bound(initialRatio, 1, BPS);
        newRatio = bound(newRatio, 0, BPS);

        agg.addStrategy(vaultId, address(strategy), initialRatio);
        agg.updateDebtRatio(vaultId, address(strategy), newRatio);

        VibeYieldAggregator.StrategySlot[] memory slots = agg.getStrategies(vaultId);
        assertEq(slots[0].debtRatio, newRatio);
    }

    function testFuzz_twoStrategyDebtRatioSum(uint256 ratio1, uint256 ratio2) public {
        ratio1 = bound(ratio1, 1, 5000);
        ratio2 = bound(ratio2, 1, BPS - ratio1);

        MockFuzzStrategy strategy2 = new MockFuzzStrategy(address(token));
        strategy2.setVault(address(agg));

        agg.addStrategy(vaultId, address(strategy), ratio1);
        agg.addStrategy(vaultId, address(strategy2), ratio2);

        VibeYieldAggregator.StrategySlot[] memory slots = agg.getStrategies(vaultId);
        uint256 totalRatio = slots[0].debtRatio + slots[1].debtRatio;
        assertTrue(totalRatio <= BPS, "Total debt ratio must not exceed 100%");
    }

    function testFuzz_revertDebtRatioExceeded(uint256 ratio1, uint256 ratio2) public {
        ratio1 = bound(ratio1, 5001, BPS);
        ratio2 = bound(ratio2, BPS - ratio1 + 1, BPS);

        MockFuzzStrategy strategy2 = new MockFuzzStrategy(address(token));
        strategy2.setVault(address(agg));

        agg.addStrategy(vaultId, address(strategy), ratio1);

        vm.expectRevert(VibeYieldAggregator.DebtRatioExceeded.selector);
        agg.addStrategy(vaultId, address(strategy2), ratio2);
    }

    // ============ Harvest Fee Accounting ============

    function testFuzz_harvestFeeCalculation(uint256 profit) public {
        profit = bound(profit, 1e18, 10_000_000e18);

        agg.addStrategy(vaultId, address(strategy), 5000);

        vm.prank(alice);
        agg.deposit(vaultId, 100_000e18);

        strategy.setPendingProfit(profit);

        vm.prank(keeperAddr);
        uint256 netProfit = agg.harvest(vaultId, address(strategy));

        // Performance fee = profit * 20% = profit * 2000 / 10000
        uint256 expectedPerfFee = (profit * PERF_FEE) / BPS;
        // Management fee is tiny at t=0 so we check perf fee dominates
        uint256 expectedNetProfit = profit - expectedPerfFee;

        // Net profit should be close to expected (mgmt fee is negligible at same block)
        assertApproxEqAbs(netProfit, expectedNetProfit, 1e18, "Net profit should match expected");

        // Fees accumulated
        VibeYieldAggregator.VaultConfig memory v = agg.getVault(vaultId);
        assertGt(v.accumulatedFees, 0, "Fees should be accumulated");
    }

    function testFuzz_harvestZeroProfitNoFees(uint256 depositAmount) public {
        depositAmount = bound(depositAmount, 1e18, 10_000_000e18);

        agg.addStrategy(vaultId, address(strategy), 5000);

        vm.prank(alice);
        agg.deposit(vaultId, depositAmount);

        // Zero profit
        strategy.setPendingProfit(0);

        vm.prank(keeperAddr);
        uint256 profit = agg.harvest(vaultId, address(strategy));

        assertEq(profit, 0, "No profit means no net return");
    }

    // ============ Vault Fee Bounds ============

    function testFuzz_setVaultFeesWithinBounds(uint256 perfFee, uint256 mgmtFee) public {
        perfFee = bound(perfFee, 0, 3000);  // MAX_PERFORMANCE_FEE
        mgmtFee = bound(mgmtFee, 0, 500);   // MAX_MANAGEMENT_FEE

        agg.setVaultFees(vaultId, perfFee, mgmtFee);

        VibeYieldAggregator.VaultConfig memory v = agg.getVault(vaultId);
        assertEq(v.performanceFeeBps, perfFee);
        assertEq(v.managementFeeBps, mgmtFee);
    }

    function testFuzz_revertSetExcessivePerfFee(uint256 perfFee) public {
        perfFee = bound(perfFee, 3001, 10_000);

        vm.expectRevert(VibeYieldAggregator.ExcessiveFee.selector);
        agg.setVaultFees(vaultId, perfFee, MGMT_FEE);
    }

    function testFuzz_revertSetExcessiveMgmtFee(uint256 mgmtFee) public {
        mgmtFee = bound(mgmtFee, 501, 10_000);

        vm.expectRevert(VibeYieldAggregator.ExcessiveFee.selector);
        agg.setVaultFees(vaultId, PERF_FEE, mgmtFee);
    }

    // ============ Migration Timelock ============

    function testFuzz_migrationTimelockEnforced(uint256 waitTime) public {
        waitTime = bound(waitTime, 0, 2 days - 1);

        agg.addStrategy(vaultId, address(strategy), 5000);

        MockFuzzStrategy newStrategy = new MockFuzzStrategy(address(token));
        newStrategy.setVault(address(agg));

        uint256 migId = agg.queueMigration(vaultId, address(strategy), address(newStrategy));

        vm.warp(block.timestamp + waitTime);

        vm.expectRevert(VibeYieldAggregator.MigrationTimelockActive.selector);
        agg.executeMigration(migId);
    }

    function testFuzz_migrationTimelockExpired(uint256 extraTime) public {
        extraTime = bound(extraTime, 0, 30 days);

        agg.addStrategy(vaultId, address(strategy), 5000);

        // Give strategy some tokens
        token.mint(address(strategy), 50_000e18);

        MockFuzzStrategy newStrategy = new MockFuzzStrategy(address(token));
        newStrategy.setVault(address(agg));

        uint256 migId = agg.queueMigration(vaultId, address(strategy), address(newStrategy));

        vm.warp(block.timestamp + 2 days + extraTime);
        agg.executeMigration(migId);

        // New strategy should be in place
        VibeYieldAggregator.StrategySlot[] memory slots = agg.getStrategies(vaultId);
        assertEq(slots[0].strategy, address(newStrategy), "Strategy should be migrated");
    }

    // ============ View Function Consistency ============

    function testFuzz_pricePerShareNeverZero(uint256 amount) public {
        amount = bound(amount, 1e18, 100_000_000e18);

        vm.prank(alice);
        agg.deposit(vaultId, amount);

        uint256 pps = agg.pricePerShare(vaultId);
        assertGt(pps, 0, "Price per share must never be zero");
    }

    function testFuzz_convertToAssetsRoundTrip(uint256 amount) public {
        amount = bound(amount, 1e18, 100_000_000e18);

        vm.prank(alice);
        agg.deposit(vaultId, amount);

        uint256 shares = agg.convertToShares(vaultId, amount);
        uint256 assets = agg.convertToAssets(vaultId, shares);

        // Round-trip should be within 1 wei of original
        assertApproxEqAbs(assets, amount, 1, "Convert round-trip should preserve value");
    }

    // ============ Multi-User Fuzz ============

    function testFuzz_multiUserDepositsProportional(uint256 aliceAmount, uint256 bobAmount) public {
        aliceAmount = bound(aliceAmount, 1e18, 100_000_000e18);
        bobAmount = bound(bobAmount, 1e18, 100_000_000e18);

        vm.prank(alice);
        uint256 aliceShares = agg.deposit(vaultId, aliceAmount);

        vm.prank(bob);
        uint256 bobShares = agg.deposit(vaultId, bobAmount);

        // Share ratio should match deposit ratio
        // aliceShares / bobShares ≈ aliceAmount / bobAmount
        // Cross-multiply: aliceShares * bobAmount ≈ bobShares * aliceAmount
        uint256 lhs = aliceShares * bobAmount;
        uint256 rhs = bobShares * aliceAmount;

        // Allow 1 share of rounding per party
        assertApproxEqAbs(lhs, rhs, aliceAmount + bobAmount, "Share ratio should match deposit ratio");
    }

    // ============ Vault Creation Fuzz ============

    function testFuzz_createMultipleVaults(uint8 count) public {
        count = uint8(bound(count, 1, 50));

        for (uint8 i = 0; i < count; i++) {
            MockFuzzToken newToken = new MockFuzzToken();
            agg.createVault(address(newToken), "V", 0, PERF_FEE, MGMT_FEE);
        }

        // +1 for the vault created in setUp
        assertEq(agg.vaultCount(), uint256(count) + 1, "Vault count should match");
    }

    // ============ Emergency Shutdown Fuzz ============

    function testFuzz_emergencyShutdownBlocksDeposits(uint256 amount) public {
        amount = bound(amount, 1e18, 10_000_000e18);

        agg.setEmergencyShutdown(vaultId, true);

        vm.prank(alice);
        vm.expectRevert(VibeYieldAggregator.VaultShutdown.selector);
        agg.deposit(vaultId, amount);
    }

    function testFuzz_emergencyShutdownAllowsWithdraw(uint256 depositAmount) public {
        depositAmount = bound(depositAmount, 1e18, 10_000_000e18);

        vm.prank(alice);
        uint256 shares = agg.deposit(vaultId, depositAmount);

        agg.setEmergencyShutdown(vaultId, true);

        // Should still be able to withdraw
        vm.prank(alice);
        uint256 assets = agg.withdraw(vaultId, shares);
        assertGt(assets, 0, "Should receive assets during emergency");
    }
}
