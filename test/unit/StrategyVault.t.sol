// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/StrategyVault.sol";
import "../../contracts/financial/interfaces/IStrategyVault.sol";
import "../../contracts/core/FeeRouter.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Contracts ============

contract MockToken is ERC20 {
    constructor() ERC20("Mock Token", "MOCK") {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockStrategy is IStrategy {
    address public override asset;
    address public override vault;
    uint256 private _totalAssets;
    uint256 private _harvestProfit;

    constructor(address asset_, address vault_) {
        asset = asset_;
        vault = vault_;
    }

    function totalAssets() external view override returns (uint256) {
        return _totalAssets;
    }

    function deposit(uint256 amount) external override {
        _totalAssets += amount;
    }

    function withdraw(uint256 amount) external override returns (uint256) {
        uint256 actual = amount > _totalAssets ? _totalAssets : amount;
        _totalAssets -= actual;
        IERC20(asset).transfer(vault, actual);
        return actual;
    }

    function harvest() external override returns (uint256) {
        uint256 profit = _harvestProfit;
        _harvestProfit = 0;
        if (profit > 0) {
            IERC20(asset).transfer(vault, profit);
        }
        return profit;
    }

    function emergencyWithdraw() external override returns (uint256) {
        uint256 recovered = _totalAssets;
        _totalAssets = 0;
        if (recovered > 0) {
            IERC20(asset).transfer(vault, recovered);
        }
        return recovered;
    }

    // Test helpers
    function setHarvestProfit(uint256 profit) external {
        _harvestProfit = profit;
    }

    function simulateGain(uint256 amount) external {
        // Mint tokens to strategy to simulate yield
        _totalAssets += amount;
    }
}

contract BadStrategy is IStrategy {
    address public override asset;
    address public override vault;

    constructor(address asset_) {
        asset = asset_;
        vault = msg.sender;
    }

    function totalAssets() external pure override returns (uint256) { return 0; }
    function deposit(uint256) external override {}
    function withdraw(uint256) external pure override returns (uint256) { return 0; }
    function harvest() external pure override returns (uint256) { return 0; }
    function emergencyWithdraw() external pure override returns (uint256) { return 0; }
}

contract WrongAssetStrategy is IStrategy {
    address public override asset;
    address public override vault;

    constructor() {
        asset = address(0xdead); // wrong asset
        vault = msg.sender;
    }

    function totalAssets() external pure override returns (uint256) { return 0; }
    function deposit(uint256) external override {}
    function withdraw(uint256) external pure override returns (uint256) { return 0; }
    function harvest() external pure override returns (uint256) { return 0; }
    function emergencyWithdraw() external pure override returns (uint256) { return 0; }
}

// ============ Test Contract ============

contract StrategyVaultTest is Test {
    MockToken token;
    StrategyVault vault;
    MockStrategy strategy;
    address feeRecipient = address(0xFEE);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        token = new MockToken();
        vault = new StrategyVault(
            IERC20(address(token)),
            "Vibe Yield Vault",
            "vyMOCK",
            feeRecipient,
            1_000_000 ether
        );

        strategy = new MockStrategy(address(token), address(vault));

        // Fund users
        token.mint(alice, 100_000 ether);
        token.mint(bob, 100_000 ether);
        token.mint(address(strategy), 10_000 ether); // for harvest profits

        // Approve vault
        vm.prank(alice);
        token.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        token.approve(address(vault), type(uint256).max);
    }

    // ============ Constructor Tests ============

    function test_constructor() public view {
        assertEq(vault.asset(), address(token));
        assertEq(vault.feeRecipient(), feeRecipient);
        assertEq(vault.depositCap(), 1_000_000 ether);
        assertEq(vault.performanceFeeBps(), 1000);
        assertEq(vault.managementFeeBps(), 200);
        assertEq(vault.emergencyShutdownActive(), false);
        assertEq(vault.strategy(), address(0));
    }

    function test_constructor_revert_zeroFeeRecipient() public {
        vm.expectRevert(IStrategyVault.ZeroAddress.selector);
        new StrategyVault(
            IERC20(address(token)),
            "Vault",
            "V",
            address(0),
            1_000_000 ether
        );
    }

    // ============ Deposit Tests ============

    function test_deposit() public {
        vm.prank(alice);
        vault.deposit(1000 ether, alice);

        assertEq(vault.balanceOf(alice), 1000 ether);
        assertEq(vault.totalAssets(), 1000 ether);
    }

    function test_deposit_withStrategy() public {
        // Set up strategy
        vault.proposeStrategy(address(strategy));
        vm.warp(block.timestamp + 2 days + 1);
        vault.activateStrategy();

        vm.prank(alice);
        vault.deposit(1000 ether, alice);

        // Assets should be deployed to strategy
        assertEq(strategy.totalAssets(), 1000 ether);
        assertEq(vault.totalAssets(), 1000 ether);
    }

    function test_deposit_revert_exceedsCap() public {
        vm.prank(alice);
        // ERC4626 base catches this via maxDeposit() before _deposit() override
        vm.expectRevert();
        vault.deposit(1_000_001 ether, alice);
    }

    function test_deposit_revert_emergencyShutdown() public {
        vault.setEmergencyShutdown(true);

        vm.prank(alice);
        // ERC4626 base catches this via maxDeposit() returning 0
        vm.expectRevert();
        vault.deposit(1000 ether, alice);
    }

    function test_deposit_noCap() public {
        StrategyVault noCap = new StrategyVault(
            IERC20(address(token)),
            "No Cap Vault",
            "ncV",
            feeRecipient,
            0 // no cap
        );

        vm.prank(alice);
        token.approve(address(noCap), type(uint256).max);
        vm.prank(alice);
        noCap.deposit(100_000 ether, alice);
        assertEq(noCap.totalAssets(), 100_000 ether);
    }

    // ============ Withdraw Tests ============

    function test_withdraw() public {
        vm.prank(alice);
        vault.deposit(1000 ether, alice);

        vm.prank(alice);
        vault.withdraw(500 ether, alice, alice);

        assertEq(vault.balanceOf(alice), 500 ether);
        assertEq(token.balanceOf(alice), 99_500 ether);
    }

    function test_withdraw_pullsFromStrategy() public {
        vault.proposeStrategy(address(strategy));
        vm.warp(block.timestamp + 2 days + 1);
        vault.activateStrategy();

        vm.prank(alice);
        vault.deposit(1000 ether, alice);

        // All 1000 is in strategy now
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(strategy.totalAssets(), 1000 ether);

        vm.prank(alice);
        vault.withdraw(500 ether, alice, alice);

        assertEq(strategy.totalAssets(), 500 ether);
        assertEq(token.balanceOf(alice), 99_500 ether);
    }

    // ============ Strategy Management Tests ============

    function test_proposeStrategy() public {
        vault.proposeStrategy(address(strategy));

        assertEq(vault.proposedStrategy(), address(strategy));
        assertGt(vault.strategyActivationTime(), block.timestamp);
    }

    function test_proposeStrategy_revert_zeroAddress() public {
        vm.expectRevert(IStrategyVault.ZeroAddress.selector);
        vault.proposeStrategy(address(0));
    }

    function test_proposeStrategy_revert_wrongAsset() public {
        WrongAssetStrategy wrong = new WrongAssetStrategy();
        vm.expectRevert(IStrategyVault.StrategyAssetMismatch.selector);
        vault.proposeStrategy(address(wrong));
    }

    function test_proposeStrategy_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.proposeStrategy(address(strategy));
    }

    function test_activateStrategy() public {
        vault.proposeStrategy(address(strategy));
        vm.warp(block.timestamp + 2 days + 1);
        vault.activateStrategy();

        assertEq(vault.strategy(), address(strategy));
        assertEq(vault.proposedStrategy(), address(0));
    }

    function test_activateStrategy_revert_noProposal() public {
        vm.expectRevert(IStrategyVault.NoProposedStrategy.selector);
        vault.activateStrategy();
    }

    function test_activateStrategy_revert_timelockNotElapsed() public {
        vault.proposeStrategy(address(strategy));
        // Don't warp — timelock hasn't passed
        vm.expectRevert(IStrategyVault.TimelockNotElapsed.selector);
        vault.activateStrategy();
    }

    function test_migrateStrategy() public {
        // Activate first strategy
        vault.proposeStrategy(address(strategy));
        vm.warp(block.timestamp + 3 days);
        vault.activateStrategy();

        // Deposit some assets
        vm.prank(alice);
        vault.deposit(1000 ether, alice);

        // Create and propose new strategy
        MockStrategy newStrategy = new MockStrategy(address(token), address(vault));
        token.mint(address(newStrategy), 10_000 ether);

        vm.warp(block.timestamp + 1); // ensure time moves forward
        vault.proposeStrategy(address(newStrategy));
        uint256 activationTime = vault.strategyActivationTime();
        vm.warp(activationTime + 1); // warp past activation time
        vault.activateStrategy();

        // Old strategy emptied, new strategy has funds
        assertEq(strategy.totalAssets(), 0);
        assertEq(vault.strategy(), address(newStrategy));
    }

    // ============ Harvest Tests ============

    function test_harvest() public {
        vault.proposeStrategy(address(strategy));
        vm.warp(block.timestamp + 2 days + 1);
        vault.activateStrategy();

        vm.prank(alice);
        vault.deposit(1000 ether, alice);

        // Simulate profit in strategy
        strategy.setHarvestProfit(100 ether);

        vm.warp(block.timestamp + 7 days);
        vault.harvest();

        // Fee recipient should have received fees
        assertGt(token.balanceOf(feeRecipient), 0);
    }

    function test_harvest_revert_noStrategy() public {
        vm.expectRevert(IStrategyVault.NoStrategy.selector);
        vault.harvest();
    }

    function test_harvest_revert_noProfit() public {
        vault.proposeStrategy(address(strategy));
        vm.warp(block.timestamp + 2 days + 1);
        vault.activateStrategy();

        vm.prank(alice);
        vault.deposit(1000 ether, alice);

        vm.expectRevert(IStrategyVault.NothingToHarvest.selector);
        vault.harvest();
    }

    function test_harvest_performanceFee() public {
        vault.proposeStrategy(address(strategy));
        vm.warp(block.timestamp + 2 days + 1);
        vault.activateStrategy();

        vm.prank(alice);
        vault.deposit(10_000 ether, alice);

        // 100 ether profit
        strategy.setHarvestProfit(100 ether);

        uint256 feeRecipientBefore = token.balanceOf(feeRecipient);
        vm.warp(block.timestamp + 1); // minimal time for mgmt fee
        vault.harvest();

        uint256 fees = token.balanceOf(feeRecipient) - feeRecipientBefore;
        // Performance fee should be ~10% of 100 = 10 ether (plus small mgmt fee)
        assertGt(fees, 9 ether);
        assertLt(fees, 15 ether); // reasonable range including mgmt
    }

    // ============ Admin Tests ============

    function test_setDepositCap() public {
        vault.setDepositCap(500_000 ether);
        assertEq(vault.depositCap(), 500_000 ether);
    }

    function test_setFees() public {
        vault.setFees(2000, 300);
        assertEq(vault.performanceFeeBps(), 2000);
        assertEq(vault.managementFeeBps(), 300);
    }

    function test_setFees_revert_excessive() public {
        vm.expectRevert(IStrategyVault.ExcessiveFee.selector);
        vault.setFees(3001, 200); // >30% performance

        vm.expectRevert(IStrategyVault.ExcessiveFee.selector);
        vault.setFees(1000, 501); // >5% management
    }

    function test_setFeeRecipient() public {
        address newRecip = address(0x123);
        vault.setFeeRecipient(newRecip);
        assertEq(vault.feeRecipient(), newRecip);
    }

    function test_setFeeRecipient_revert_zero() public {
        vm.expectRevert(IStrategyVault.ZeroAddress.selector);
        vault.setFeeRecipient(address(0));
    }

    function test_emergencyShutdown() public {
        vault.proposeStrategy(address(strategy));
        vm.warp(block.timestamp + 2 days + 1);
        vault.activateStrategy();

        vm.prank(alice);
        vault.deposit(1000 ether, alice);

        // Strategy has the funds
        assertEq(strategy.totalAssets(), 1000 ether);

        vault.setEmergencyShutdown(true);

        // Funds pulled back from strategy
        assertEq(strategy.totalAssets(), 0);
        assertEq(vault.emergencyShutdownActive(), true);

        // Users can still withdraw
        vm.prank(alice);
        vault.withdraw(1000 ether, alice, alice);
        assertEq(token.balanceOf(alice), 100_000 ether);
    }

    function test_setStrategyTimelock() public {
        vault.setStrategyTimelock(5 days);
        assertEq(vault.strategyTimelock(), 5 days);
    }

    // ============ ERC-4626 Compliance Tests ============

    function test_maxDeposit_normal() public view {
        assertEq(vault.maxDeposit(alice), 1_000_000 ether);
    }

    function test_maxDeposit_emergency() public {
        vault.setEmergencyShutdown(true);
        assertEq(vault.maxDeposit(alice), 0);
    }

    function test_maxDeposit_atCap() public {
        token.mint(alice, 1_000_000 ether);
        vm.prank(alice);
        vault.deposit(1_000_000 ether, alice);
        assertEq(vault.maxDeposit(alice), 0);
    }

    function test_sharePrice() public {
        // 1:1 initially
        vm.prank(alice);
        vault.deposit(1000 ether, alice);
        assertEq(vault.convertToAssets(1000 ether), 1000 ether);
    }

    function test_multipleDepositors() public {
        vm.prank(alice);
        vault.deposit(1000 ether, alice);

        vm.prank(bob);
        vault.deposit(2000 ether, bob);

        assertEq(vault.totalAssets(), 3000 ether);
        assertEq(vault.balanceOf(alice), 1000 ether);
        assertEq(vault.balanceOf(bob), 2000 ether);
    }

    function test_redeem() public {
        vm.prank(alice);
        vault.deposit(1000 ether, alice);

        vm.prank(alice);
        uint256 assets = vault.redeem(500 ether, alice, alice);

        assertEq(assets, 500 ether);
        assertEq(vault.balanceOf(alice), 500 ether);
    }

    // ============ Integration Tests ============

    function test_fullLifecycle() public {
        // 1. Deploy vault with strategy
        vault.proposeStrategy(address(strategy));
        vm.warp(block.timestamp + 2 days + 1);
        vault.activateStrategy();

        // 2. Alice deposits
        vm.prank(alice);
        vault.deposit(5000 ether, alice);

        // 3. Bob deposits
        vm.prank(bob);
        vault.deposit(3000 ether, bob);

        assertEq(vault.totalAssets(), 8000 ether);
        assertEq(strategy.totalAssets(), 8000 ether);

        // 4. Strategy generates profit
        strategy.setHarvestProfit(800 ether); // 10% yield

        // 5. Harvest
        vm.warp(block.timestamp + 7 days);
        vault.harvest();

        // 6. Alice withdraws her share
        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(aliceShares, alice, alice);

        // Alice should get more than she deposited (share of yield minus fees)
        assertGt(token.balanceOf(alice), 99_000 ether);

        // 7. Bob withdraws
        uint256 bobShares = vault.balanceOf(bob);
        vm.prank(bob);
        vault.redeem(bobShares, bob, bob);

        assertGt(token.balanceOf(bob), 99_000 ether);
    }

    // ============ FeeRouter Integration Tests ============

    function test_setFeeRouter() public {
        address router = address(0xF001);
        vault.setFeeRouter(router);
        assertEq(vault.feeRouter(), router);
    }

    function test_setFeeRouter_zeroDisables() public {
        vault.setFeeRouter(address(0xF001));
        vault.setFeeRouter(address(0));
        assertEq(vault.feeRouter(), address(0));
    }

    function test_harvest_routesThroughFeeRouter() public {
        // Setup FeeRouter
        address treasury = address(0x1111);
        address insurance = address(0x2222);
        address revShareAddr = address(0x3333);
        address buybackAddr = address(0x4444);
        FeeRouter router = new FeeRouter(treasury, insurance, revShareAddr, buybackAddr);
        router.authorizeSource(address(vault));

        // Wire vault to router
        vault.setFeeRouter(address(router));

        // Setup strategy
        vault.proposeStrategy(address(strategy));
        vm.warp(block.timestamp + 2 days + 1);
        vault.activateStrategy();

        // Alice deposits
        vm.prank(alice);
        vault.deposit(5000 ether, alice);

        // Strategy generates profit
        strategy.setHarvestProfit(500 ether);

        // Harvest (fees should go to router, not feeRecipient)
        vm.warp(block.timestamp + 7 days);
        vault.harvest();

        // FeeRouter should have collected fees
        assertGt(router.totalCollected(address(token)), 0);
        // Direct feeRecipient should NOT have received tokens
        assertEq(token.balanceOf(feeRecipient), 0);

        // Distribute and verify
        router.distribute(address(token));
        assertGt(token.balanceOf(treasury), 0);
        assertGt(token.balanceOf(insurance), 0);
        assertGt(token.balanceOf(revShareAddr), 0);
        assertGt(token.balanceOf(buybackAddr), 0);
    }
}
