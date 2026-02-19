// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/strategies/SimpleYieldStrategy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockSYSFuzzToken is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Fuzz Tests ============

contract SimpleYieldStrategyFuzzTest is Test {
    MockSYSFuzzToken token;
    SimpleYieldStrategy strategy;
    address vault = makeAddr("vault");

    function setUp() public {
        token = new MockSYSFuzzToken();
        strategy = new SimpleYieldStrategy(address(token), vault);
    }

    // ============ Fuzz: deposit + withdraw roundtrip ============

    function testFuzz_depositWithdrawRoundtrip(uint256 depositAmt, uint256 withdrawAmt) public {
        depositAmt = bound(depositAmt, 1, 100_000_000 ether);
        withdrawAmt = bound(withdrawAmt, 1, depositAmt);

        token.mint(address(strategy), depositAmt);
        vm.prank(vault);
        strategy.deposit(depositAmt);

        vm.prank(vault);
        uint256 actual = strategy.withdraw(withdrawAmt);

        assertEq(actual, withdrawAmt);
        assertEq(strategy.deployed(), depositAmt - withdrawAmt);
        assertEq(token.balanceOf(vault), withdrawAmt);
    }

    // ============ Fuzz: yield injection tracks correctly ============

    function testFuzz_yieldInjection(uint256 depositAmt, uint256 yieldAmt) public {
        depositAmt = bound(depositAmt, 1, 100_000_000 ether);
        yieldAmt = bound(yieldAmt, 1, 10_000_000 ether);

        token.mint(address(strategy), depositAmt);
        vm.prank(vault);
        strategy.deposit(depositAmt);

        token.mint(address(strategy), yieldAmt);
        strategy.injectYield(yieldAmt);

        assertEq(strategy.totalAssets(), depositAmt + yieldAmt);
        assertEq(strategy.pendingYield(), yieldAmt);
    }

    // ============ Fuzz: harvest returns all pending yield ============

    function testFuzz_harvestReturnsAll(uint256 depositAmt, uint256 yieldAmt) public {
        depositAmt = bound(depositAmt, 1, 100_000_000 ether);
        yieldAmt = bound(yieldAmt, 1, 10_000_000 ether);

        token.mint(address(strategy), depositAmt);
        vm.prank(vault);
        strategy.deposit(depositAmt);

        token.mint(address(strategy), yieldAmt);
        strategy.injectYield(yieldAmt);

        vm.prank(vault);
        uint256 profit = strategy.harvest();

        assertEq(profit, yieldAmt);
        assertEq(strategy.pendingYield(), 0);
        assertEq(token.balanceOf(vault), yieldAmt);
    }

    // ============ Fuzz: emergency recovers everything ============

    function testFuzz_emergencyRecoversAll(uint256 depositAmt, uint256 yieldAmt) public {
        depositAmt = bound(depositAmt, 1, 100_000_000 ether);
        yieldAmt = bound(yieldAmt, 0, 10_000_000 ether);

        token.mint(address(strategy), depositAmt + yieldAmt);
        vm.prank(vault);
        strategy.deposit(depositAmt);

        if (yieldAmt > 0) {
            strategy.injectYield(yieldAmt);
        }

        vm.prank(vault);
        uint256 recovered = strategy.emergencyWithdraw();

        assertEq(recovered, depositAmt + yieldAmt);
        assertEq(strategy.deployed(), 0);
        assertEq(strategy.pendingYield(), 0);
    }

    // ============ Fuzz: totalAssets = deployed + pendingYield ============

    function testFuzz_totalAssetsInvariant(uint256 depositAmt, uint256 yieldAmt) public {
        depositAmt = bound(depositAmt, 1, 100_000_000 ether);
        yieldAmt = bound(yieldAmt, 0, 10_000_000 ether);

        token.mint(address(strategy), depositAmt + yieldAmt);
        vm.prank(vault);
        strategy.deposit(depositAmt);

        if (yieldAmt > 0) {
            strategy.injectYield(yieldAmt);
        }

        assertEq(strategy.totalAssets(), strategy.deployed() + strategy.pendingYield());
    }
}
