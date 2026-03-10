// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeYieldAggregator.sol";
import "../../contracts/financial/interfaces/IStrategyVault.sol";
import "../../contracts/incentives/interfaces/IShapleyDistributor.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockYieldToken is ERC20 {
    constructor() ERC20("YIELD", "YLD") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice Mock strategy that holds tokens and simulates yield
contract MockStrategy is IStrategy {
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
        // Simulate: profit tokens already exist in strategy (minted externally)
    }

    function emergencyWithdraw() external override returns (uint256 recovered) {
        recovered = IERC20(asset).balanceOf(address(this));
        IERC20(asset).transfer(msg.sender, recovered);
    }
}

// ============ Tests ============

contract VibeYieldAggregatorTest is Test {
    VibeYieldAggregator public agg;
    MockYieldToken public token;
    MockStrategy public strategy1;
    MockStrategy public strategy2;

    address alice = address(0xA1);
    address bob = address(0xB0);
    address keeperAddr = address(0xCC);

    uint256 constant PERF_FEE = 2000;  // 20%
    uint256 constant MGMT_FEE = 200;   // 2%

    uint256 vaultId;

    function setUp() public {
        token = new MockYieldToken();

        // Deploy via proxy (_disableInitializers)
        VibeYieldAggregator impl = new VibeYieldAggregator();
        bytes memory initData = abi.encodeCall(
            VibeYieldAggregator.initialize,
            (address(0), keeperAddr) // no shapley distributor
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        agg = VibeYieldAggregator(address(proxy));

        // Create vault
        vaultId = agg.createVault(address(token), "YLD Vault", 0, PERF_FEE, MGMT_FEE);

        // Create strategies
        strategy1 = new MockStrategy(address(token));
        strategy2 = new MockStrategy(address(token));
        strategy1.setVault(address(agg));
        strategy2.setVault(address(agg));

        // Fund accounts
        token.mint(alice, 1_000_000e18);
        token.mint(bob, 1_000_000e18);

        // Approvals
        vm.prank(alice);
        token.approve(address(agg), type(uint256).max);
        vm.prank(bob);
        token.approve(address(agg), type(uint256).max);
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(agg.keeper(), keeperAddr);
        assertEq(agg.vaultCount(), 1);
        assertEq(agg.keeperTip(), 0.001 ether);
    }

    function test_revertInitializeZeroKeeper() public {
        VibeYieldAggregator impl2 = new VibeYieldAggregator();
        bytes memory initData = abi.encodeCall(
            VibeYieldAggregator.initialize,
            (address(0), address(0))
        );
        vm.expectRevert(VibeYieldAggregator.ZeroAddress.selector);
        new ERC1967Proxy(address(impl2), initData);
    }

    // ============ Vault Creation ============

    function test_createVault() public view {
        VibeYieldAggregator.VaultConfig memory v = agg.getVault(vaultId);
        assertEq(v.asset, address(token));
        assertEq(v.performanceFeeBps, PERF_FEE);
        assertEq(v.managementFeeBps, MGMT_FEE);
        assertTrue(v.exists);
        assertFalse(v.emergencyShutdown);
    }

    function test_revertCreateVaultZeroAsset() public {
        vm.expectRevert(VibeYieldAggregator.ZeroAddress.selector);
        agg.createVault(address(0), "Bad", 0, PERF_FEE, MGMT_FEE);
    }

    function test_revertCreateVaultExcessivePerfFee() public {
        vm.expectRevert(VibeYieldAggregator.ExcessiveFee.selector);
        agg.createVault(address(token), "Bad", 0, 3001, MGMT_FEE);
    }

    function test_revertCreateVaultExcessiveMgmtFee() public {
        vm.expectRevert(VibeYieldAggregator.ExcessiveFee.selector);
        agg.createVault(address(token), "Bad", 0, PERF_FEE, 501);
    }

    function test_revertCreateVaultNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        agg.createVault(address(token), "Bad", 0, PERF_FEE, MGMT_FEE);
    }

    // ============ Deposit ============

    function test_deposit() public {
        vm.prank(alice);
        uint256 shares = agg.deposit(vaultId, 10_000e18);

        assertEq(shares, 10_000e18); // 1:1 first deposit
        assertEq(agg.balanceOf(vaultId, alice), 10_000e18);
    }

    function test_depositMultipleUsers() public {
        vm.prank(alice);
        agg.deposit(vaultId, 10_000e18);

        vm.prank(bob);
        uint256 shares = agg.deposit(vaultId, 10_000e18);

        assertEq(shares, 10_000e18); // same share price
    }

    function test_revertDepositZero() public {
        vm.prank(alice);
        vm.expectRevert(VibeYieldAggregator.ZeroAmount.selector);
        agg.deposit(vaultId, 0);
    }

    function test_revertDepositNonexistentVault() public {
        vm.prank(alice);
        vm.expectRevert(VibeYieldAggregator.VaultNotFound.selector);
        agg.deposit(99, 1000e18);
    }

    function test_depositCapEnforced() public {
        // Set deposit cap
        agg.setDepositCap(vaultId, 50_000e18);

        vm.prank(alice);
        agg.deposit(vaultId, 40_000e18);

        vm.prank(bob);
        vm.expectRevert(VibeYieldAggregator.DepositCapExceeded.selector);
        agg.deposit(vaultId, 20_000e18);
    }

    function test_revertDepositShutdown() public {
        agg.setEmergencyShutdown(vaultId, true);

        vm.prank(alice);
        vm.expectRevert(VibeYieldAggregator.VaultShutdown.selector);
        agg.deposit(vaultId, 1000e18);
    }

    // ============ Withdraw ============

    function test_withdraw() public {
        vm.prank(alice);
        agg.deposit(vaultId, 10_000e18);

        uint256 balanceBefore = token.balanceOf(alice);
        vm.prank(alice);
        uint256 assets = agg.withdraw(vaultId, 5000e18);

        assertEq(assets, 5000e18);
        assertEq(token.balanceOf(alice), balanceBefore + 5000e18);
        assertEq(agg.balanceOf(vaultId, alice), 5000e18);
    }

    function test_revertWithdrawZero() public {
        vm.prank(alice);
        vm.expectRevert(VibeYieldAggregator.ZeroAmount.selector);
        agg.withdraw(vaultId, 0);
    }

    function test_revertWithdrawInsufficient() public {
        vm.prank(alice);
        agg.deposit(vaultId, 1000e18);

        vm.prank(alice);
        vm.expectRevert(VibeYieldAggregator.InsufficientShares.selector);
        agg.withdraw(vaultId, 2000e18);
    }

    // ============ Emergency Withdraw ============

    function test_emergencyWithdraw() public {
        vm.prank(alice);
        agg.deposit(vaultId, 10_000e18);

        uint256 balanceBefore = token.balanceOf(alice);
        vm.prank(alice);
        agg.emergencyWithdraw(vaultId);

        assertGe(token.balanceOf(alice), balanceBefore + 10_000e18 - 1); // rounding
        assertEq(agg.balanceOf(vaultId, alice), 0);
    }

    function test_revertEmergencyWithdrawNoShares() public {
        vm.prank(alice);
        vm.expectRevert(VibeYieldAggregator.ZeroAmount.selector);
        agg.emergencyWithdraw(vaultId);
    }

    // ============ Strategy Management ============

    function test_addStrategy() public {
        agg.addStrategy(vaultId, address(strategy1), 5000); // 50%

        assertEq(agg.strategyCount(vaultId), 1);
        VibeYieldAggregator.StrategySlot[] memory slots = agg.getStrategies(vaultId);
        assertEq(slots[0].strategy, address(strategy1));
        assertEq(slots[0].debtRatio, 5000);
        assertTrue(slots[0].active);
    }

    function test_addMultipleStrategies() public {
        agg.addStrategy(vaultId, address(strategy1), 4000);
        agg.addStrategy(vaultId, address(strategy2), 3000);

        assertEq(agg.strategyCount(vaultId), 2);
    }

    function test_revertAddStrategyDuplicate() public {
        agg.addStrategy(vaultId, address(strategy1), 5000);

        vm.expectRevert(VibeYieldAggregator.StrategyAlreadyAdded.selector);
        agg.addStrategy(vaultId, address(strategy1), 3000);
    }

    function test_revertAddStrategyZeroAddress() public {
        vm.expectRevert(VibeYieldAggregator.ZeroAddress.selector);
        agg.addStrategy(vaultId, address(0), 5000);
    }

    function test_revertAddStrategyDebtRatioExceeded() public {
        agg.addStrategy(vaultId, address(strategy1), 7000);

        vm.expectRevert(VibeYieldAggregator.DebtRatioExceeded.selector);
        agg.addStrategy(vaultId, address(strategy2), 4000); // 7000 + 4000 > 10000
    }

    function test_revertAddStrategyAssetMismatch() public {
        MockYieldToken otherToken = new MockYieldToken();
        MockStrategy badStrategy = new MockStrategy(address(otherToken));

        vm.expectRevert(VibeYieldAggregator.StrategyAssetMismatch.selector);
        agg.addStrategy(vaultId, address(badStrategy), 5000);
    }

    function test_revertAddStrategyNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        agg.addStrategy(vaultId, address(strategy1), 5000);
    }

    function test_revokeStrategy() public {
        agg.addStrategy(vaultId, address(strategy1), 5000);
        agg.revokeStrategy(vaultId, address(strategy1));

        VibeYieldAggregator.StrategySlot[] memory slots = agg.getStrategies(vaultId);
        assertFalse(slots[0].active);
        assertEq(slots[0].debtRatio, 0);
    }

    function test_updateDebtRatio() public {
        agg.addStrategy(vaultId, address(strategy1), 5000);
        agg.updateDebtRatio(vaultId, address(strategy1), 3000);

        VibeYieldAggregator.StrategySlot[] memory slots = agg.getStrategies(vaultId);
        assertEq(slots[0].debtRatio, 3000);
    }

    function test_revertUpdateDebtRatioExceeded() public {
        agg.addStrategy(vaultId, address(strategy1), 5000);
        agg.addStrategy(vaultId, address(strategy2), 3000);

        vm.expectRevert(VibeYieldAggregator.DebtRatioExceeded.selector);
        agg.updateDebtRatio(vaultId, address(strategy1), 8000); // 8000 + 3000 > 10000
    }

    function test_revertUpdateDebtRatioInactive() public {
        agg.addStrategy(vaultId, address(strategy1), 5000);
        agg.revokeStrategy(vaultId, address(strategy1));

        vm.expectRevert(VibeYieldAggregator.StrategyNotActive.selector);
        agg.updateDebtRatio(vaultId, address(strategy1), 3000);
    }

    // ============ Harvest ============

    function test_harvestProfit() public {
        agg.addStrategy(vaultId, address(strategy1), 5000);

        // Alice deposits
        vm.prank(alice);
        agg.deposit(vaultId, 100_000e18);

        // Simulate profit
        strategy1.setPendingProfit(10_000e18);

        // Keeper harvests
        vm.prank(keeperAddr);
        uint256 profit = agg.harvest(vaultId, address(strategy1));

        // Profit after 20% perf fee = 8000e18 (mgmt fee negligible at t=0)
        assertGt(profit, 0);
    }

    function test_harvestAccumulatesFees() public {
        agg.addStrategy(vaultId, address(strategy1), 5000);

        vm.prank(alice);
        agg.deposit(vaultId, 100_000e18);

        strategy1.setPendingProfit(10_000e18);

        vm.prank(keeperAddr);
        agg.harvest(vaultId, address(strategy1));

        VibeYieldAggregator.VaultConfig memory v = agg.getVault(vaultId);
        assertGt(v.accumulatedFees, 0);
    }

    function test_revertHarvestNotKeeper() public {
        agg.addStrategy(vaultId, address(strategy1), 5000);

        vm.prank(alice);
        vm.expectRevert(VibeYieldAggregator.NotKeeperOrOwner.selector);
        agg.harvest(vaultId, address(strategy1));
    }

    function test_harvestOwnerAllowed() public {
        agg.addStrategy(vaultId, address(strategy1), 5000);
        vm.prank(alice);
        agg.deposit(vaultId, 100_000e18);

        strategy1.setPendingProfit(5000e18);

        // Owner can harvest too
        agg.harvest(vaultId, address(strategy1));
    }

    // ============ Migration ============

    function test_queueMigration() public {
        agg.addStrategy(vaultId, address(strategy1), 5000);

        uint256 migId = agg.queueMigration(vaultId, address(strategy1), address(strategy2));

        VibeYieldAggregator.PendingMigration memory m = agg.getPendingMigration(migId);
        assertEq(m.vaultId, vaultId);
        assertEq(m.newStrategy, address(strategy2));
        assertGt(m.executeAfter, block.timestamp);
    }

    function test_executeMigration() public {
        agg.addStrategy(vaultId, address(strategy1), 5000);

        // Deposit and deploy to strategy
        vm.prank(alice);
        agg.deposit(vaultId, 100_000e18);

        // Give strategy tokens to simulate deployed capital
        token.mint(address(strategy1), 50_000e18);

        uint256 migId = agg.queueMigration(vaultId, address(strategy1), address(strategy2));

        // Wait for timelock
        vm.warp(block.timestamp + 2 days);

        agg.executeMigration(migId);

        // New strategy should have the capital
        VibeYieldAggregator.StrategySlot[] memory slots = agg.getStrategies(vaultId);
        assertEq(slots[0].strategy, address(strategy2));
        assertTrue(slots[0].active);
    }

    function test_revertExecuteMigrationTimelockActive() public {
        agg.addStrategy(vaultId, address(strategy1), 5000);
        uint256 migId = agg.queueMigration(vaultId, address(strategy1), address(strategy2));

        vm.expectRevert(VibeYieldAggregator.MigrationTimelockActive.selector);
        agg.executeMigration(migId);
    }

    function test_cancelMigration() public {
        agg.addStrategy(vaultId, address(strategy1), 5000);
        uint256 migId = agg.queueMigration(vaultId, address(strategy1), address(strategy2));

        agg.cancelMigration(migId);

        VibeYieldAggregator.PendingMigration memory m = agg.getPendingMigration(migId);
        assertEq(m.newStrategy, address(0)); // deleted
    }

    function test_revertCancelNonexistentMigration() public {
        vm.expectRevert(VibeYieldAggregator.MigrationNotFound.selector);
        agg.cancelMigration(999);
    }

    // ============ Emergency Shutdown ============

    function test_emergencyShutdown() public {
        agg.setEmergencyShutdown(vaultId, true);

        VibeYieldAggregator.VaultConfig memory v = agg.getVault(vaultId);
        assertTrue(v.emergencyShutdown);
    }

    function test_emergencyShutdownBlocksDeposits() public {
        agg.setEmergencyShutdown(vaultId, true);

        vm.prank(alice);
        vm.expectRevert(VibeYieldAggregator.VaultShutdown.selector);
        agg.deposit(vaultId, 1000e18);
    }

    function test_emergencyShutdownAllowsWithdrawals() public {
        vm.prank(alice);
        agg.deposit(vaultId, 10_000e18);

        agg.setEmergencyShutdown(vaultId, true);

        vm.prank(alice);
        agg.withdraw(vaultId, 5000e18);

        assertEq(agg.balanceOf(vaultId, alice), 5000e18);
    }

    function test_emergencyShutdownPullsFromStrategies() public {
        agg.addStrategy(vaultId, address(strategy1), 5000);

        vm.prank(alice);
        agg.deposit(vaultId, 100_000e18);

        // Harvest to deploy capital to strategy (rebalance pushes 50% = 50k)
        agg.harvest(vaultId, address(strategy1));

        // Verify strategy has debt
        VibeYieldAggregator.StrategySlot[] memory slotsBefore = agg.getStrategies(vaultId);
        assertGt(slotsBefore[0].totalDebt, 0, "Strategy should have debt after rebalance");

        // Emergency shutdown pulls all funds back
        agg.setEmergencyShutdown(vaultId, true);

        VibeYieldAggregator.StrategySlot[] memory slotsAfter = agg.getStrategies(vaultId);
        assertEq(slotsAfter[0].totalDebt, 0);
        assertFalse(slotsAfter[0].active);
    }

    // ============ Admin ============

    function test_setKeeper() public {
        address newKeeper = address(0xEEEE);
        agg.setKeeper(newKeeper);
        assertEq(agg.keeper(), newKeeper);
    }

    function test_revertSetKeeperZero() public {
        vm.expectRevert(VibeYieldAggregator.ZeroAddress.selector);
        agg.setKeeper(address(0));
    }

    function test_setKeeperTip() public {
        agg.setKeeperTip(0.01 ether);
        assertEq(agg.keeperTip(), 0.01 ether);
    }

    function test_setVaultFees() public {
        agg.setVaultFees(vaultId, 1500, 300);

        VibeYieldAggregator.VaultConfig memory v = agg.getVault(vaultId);
        assertEq(v.performanceFeeBps, 1500);
        assertEq(v.managementFeeBps, 300);
    }

    function test_revertSetVaultFeesExcessive() public {
        vm.expectRevert(VibeYieldAggregator.ExcessiveFee.selector);
        agg.setVaultFees(vaultId, 3001, 200);
    }

    function test_setDepositCap() public {
        agg.setDepositCap(vaultId, 500_000e18);

        VibeYieldAggregator.VaultConfig memory v = agg.getVault(vaultId);
        assertEq(v.depositCap, 500_000e18);
    }

    // ============ Views ============

    function test_pricePerShareInitial() public view {
        // No deposits → 1e18
        assertEq(agg.pricePerShare(vaultId), 1e18);
    }

    function test_pricePerShareAfterDeposit() public {
        vm.prank(alice);
        agg.deposit(vaultId, 10_000e18);

        assertEq(agg.pricePerShare(vaultId), 1e18);
    }

    function test_convertToAssets() public {
        vm.prank(alice);
        agg.deposit(vaultId, 10_000e18);

        assertEq(agg.convertToAssets(vaultId, 5000e18), 5000e18);
    }

    function test_convertToShares() public {
        vm.prank(alice);
        agg.deposit(vaultId, 10_000e18);

        assertEq(agg.convertToShares(vaultId, 5000e18), 5000e18);
    }

    function test_totalVaultAssets() public {
        vm.prank(alice);
        agg.deposit(vaultId, 50_000e18);

        assertEq(agg.totalVaultAssets(vaultId), 50_000e18);
    }

    // ============ Full Lifecycle ============

    function test_fullLifecycle() public {
        // 1. Add strategy
        agg.addStrategy(vaultId, address(strategy1), 5000);

        // 2. Alice deposits
        vm.prank(alice);
        agg.deposit(vaultId, 100_000e18);

        // 3. Bob deposits
        vm.prank(bob);
        agg.deposit(vaultId, 50_000e18);

        // 4. Simulate yield and harvest
        strategy1.setPendingProfit(15_000e18);
        vm.prank(keeperAddr);
        uint256 profit = agg.harvest(vaultId, address(strategy1));
        assertGt(profit, 0);

        // 5. Fees accumulated
        VibeYieldAggregator.VaultConfig memory v = agg.getVault(vaultId);
        assertGt(v.accumulatedFees, 0);

        // 6. Alice withdraws
        uint256 aliceShares = agg.balanceOf(vaultId, alice);
        vm.prank(alice);
        uint256 aliceAssets = agg.withdraw(vaultId, aliceShares);
        assertGt(aliceAssets, 0);

        // 7. Bob emergency withdraws
        vm.prank(bob);
        agg.emergencyWithdraw(vaultId);
        assertEq(agg.balanceOf(vaultId, bob), 0);
    }

    function test_multiVaultLifecycle() public {
        // Create second vault with different token
        MockYieldToken token2 = new MockYieldToken();
        uint256 vault2 = agg.createVault(address(token2), "V2", 0, 1000, 100);

        token2.mint(alice, 100_000e18);
        vm.prank(alice);
        token2.approve(address(agg), type(uint256).max);

        // Deposit into both vaults
        vm.prank(alice);
        agg.deposit(vaultId, 50_000e18);

        vm.prank(alice);
        agg.deposit(vault2, 30_000e18);

        // Verify independence
        assertEq(agg.balanceOf(vaultId, alice), 50_000e18);
        assertEq(agg.balanceOf(vault2, alice), 30_000e18);
        assertEq(agg.vaultCount(), 2);
    }
}
