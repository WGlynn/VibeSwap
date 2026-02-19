// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/strategies/SimpleYieldStrategy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockStratToken is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Unit Tests ============

contract SimpleYieldStrategyTest is Test {
    MockStratToken token;
    SimpleYieldStrategy strategy;

    address vault = makeAddr("vault");
    address owner;

    function setUp() public {
        owner = address(this);
        token = new MockStratToken();
        strategy = new SimpleYieldStrategy(address(token), vault);
    }

    // ============ Constructor ============

    function test_constructor() public view {
        assertEq(strategy.asset(), address(token));
        assertEq(strategy.vault(), vault);
        assertEq(strategy.totalAssets(), 0);
        assertEq(strategy.deployed(), 0);
        assertEq(strategy.pendingYield(), 0);
    }

    function test_constructor_revertsZeroAsset() public {
        vm.expectRevert(SimpleYieldStrategy.ZeroAddress.selector);
        new SimpleYieldStrategy(address(0), vault);
    }

    function test_constructor_revertsZeroVault() public {
        vm.expectRevert(SimpleYieldStrategy.ZeroAddress.selector);
        new SimpleYieldStrategy(address(token), address(0));
    }

    // ============ deposit ============

    function test_deposit() public {
        token.mint(address(strategy), 1000 ether);

        vm.prank(vault);
        strategy.deposit(1000 ether);

        assertEq(strategy.deployed(), 1000 ether);
        assertEq(strategy.totalAssets(), 1000 ether);
    }

    function test_deposit_onlyVault() public {
        token.mint(address(strategy), 1000 ether);

        vm.expectRevert(SimpleYieldStrategy.OnlyVault.selector);
        strategy.deposit(1000 ether);
    }

    function test_deposit_multiple() public {
        token.mint(address(strategy), 500 ether);
        vm.prank(vault);
        strategy.deposit(500 ether);

        token.mint(address(strategy), 300 ether);
        vm.prank(vault);
        strategy.deposit(300 ether);

        assertEq(strategy.deployed(), 800 ether);
    }

    // ============ withdraw ============

    function test_withdraw() public {
        token.mint(address(strategy), 1000 ether);
        vm.prank(vault);
        strategy.deposit(1000 ether);

        vm.prank(vault);
        uint256 actual = strategy.withdraw(500 ether);

        assertEq(actual, 500 ether);
        assertEq(strategy.deployed(), 500 ether);
        assertEq(token.balanceOf(vault), 500 ether);
    }

    function test_withdraw_moreDeployed() public {
        token.mint(address(strategy), 1000 ether);
        vm.prank(vault);
        strategy.deposit(1000 ether);

        vm.prank(vault);
        uint256 actual = strategy.withdraw(2000 ether);

        // Can only withdraw what's deployed
        assertEq(actual, 1000 ether);
        assertEq(strategy.deployed(), 0);
    }

    function test_withdraw_onlyVault() public {
        vm.expectRevert(SimpleYieldStrategy.OnlyVault.selector);
        strategy.withdraw(100 ether);
    }

    // ============ injectYield ============

    function test_injectYield() public {
        // Deploy some assets
        token.mint(address(strategy), 1000 ether);
        vm.prank(vault);
        strategy.deposit(1000 ether);

        // Send yield tokens
        token.mint(address(strategy), 50 ether);

        // Inject yield
        strategy.injectYield(50 ether);

        assertEq(strategy.pendingYield(), 50 ether);
        assertEq(strategy.totalAssets(), 1050 ether);
    }

    function test_injectYield_onlyOwner() public {
        vm.prank(makeAddr("random"));
        vm.expectRevert();
        strategy.injectYield(100 ether);
    }

    function test_injectYield_revertsZero() public {
        vm.expectRevert(SimpleYieldStrategy.ZeroAmount.selector);
        strategy.injectYield(0);
    }

    function test_injectYield_revertsInsufficientBalance() public {
        // No tokens in strategy
        vm.expectRevert(SimpleYieldStrategy.InsufficientBalance.selector);
        strategy.injectYield(100 ether);
    }

    // ============ harvest ============

    function test_harvest() public {
        token.mint(address(strategy), 1000 ether);
        vm.prank(vault);
        strategy.deposit(1000 ether);

        token.mint(address(strategy), 100 ether);
        strategy.injectYield(100 ether);

        vm.prank(vault);
        uint256 profit = strategy.harvest();

        assertEq(profit, 100 ether);
        assertEq(token.balanceOf(vault), 100 ether);
        assertEq(strategy.pendingYield(), 0);
    }

    function test_harvest_noPending() public {
        vm.prank(vault);
        uint256 profit = strategy.harvest();
        assertEq(profit, 0);
    }

    function test_harvest_onlyVault() public {
        vm.expectRevert(SimpleYieldStrategy.OnlyVault.selector);
        strategy.harvest();
    }

    // ============ emergencyWithdraw ============

    function test_emergencyWithdraw() public {
        token.mint(address(strategy), 1000 ether);
        vm.prank(vault);
        strategy.deposit(1000 ether);

        token.mint(address(strategy), 50 ether);
        strategy.injectYield(50 ether);

        vm.prank(vault);
        uint256 recovered = strategy.emergencyWithdraw();

        assertEq(recovered, 1050 ether);
        assertEq(token.balanceOf(vault), 1050 ether);
        assertEq(strategy.deployed(), 0);
        assertEq(strategy.pendingYield(), 0);
    }

    function test_emergencyWithdraw_onlyVault() public {
        vm.expectRevert(SimpleYieldStrategy.OnlyVault.selector);
        strategy.emergencyWithdraw();
    }

    // ============ Full Flow ============

    function test_fullFlow() public {
        // 1. Vault deposits
        token.mint(address(strategy), 10_000 ether);
        vm.prank(vault);
        strategy.deposit(10_000 ether);

        // 2. Owner injects yield (simulating external earnings)
        token.mint(address(strategy), 500 ether);
        strategy.injectYield(500 ether);

        assertEq(strategy.totalAssets(), 10_500 ether);

        // 3. Vault harvests
        vm.prank(vault);
        uint256 profit = strategy.harvest();
        assertEq(profit, 500 ether);

        // 4. Vault withdraws partial
        vm.prank(vault);
        strategy.withdraw(5000 ether);
        assertEq(strategy.deployed(), 5000 ether);

        // 5. More yield injected
        token.mint(address(strategy), 200 ether);
        strategy.injectYield(200 ether);

        // 6. Emergency exit
        vm.prank(vault);
        uint256 recovered = strategy.emergencyWithdraw();
        assertEq(recovered, 5200 ether);
    }
}
