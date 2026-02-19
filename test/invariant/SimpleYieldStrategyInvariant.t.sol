// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/financial/strategies/SimpleYieldStrategy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockSYSInvToken is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Handler ============

contract StrategyHandler is Test {
    SimpleYieldStrategy public strategy;
    MockSYSInvToken public token;
    address public vault;
    address public owner;

    uint256 public ghost_deposited;
    uint256 public ghost_withdrawn;
    uint256 public ghost_yieldInjected;
    uint256 public ghost_harvested;

    constructor(SimpleYieldStrategy _strategy, MockSYSInvToken _token, address _vault, address _owner) {
        strategy = _strategy;
        token = _token;
        vault = _vault;
        owner = _owner;
    }

    function deposit(uint256 amount) public {
        amount = bound(amount, 1 ether, 1_000_000 ether);

        token.mint(address(strategy), amount);
        vm.prank(vault);
        strategy.deposit(amount);

        ghost_deposited += amount;
    }

    function withdraw(uint256 amount) public {
        uint256 deployed = strategy.deployed();
        if (deployed == 0) return;
        amount = bound(amount, 1, deployed);

        vm.prank(vault);
        uint256 actual = strategy.withdraw(amount);

        ghost_withdrawn += actual;
    }

    function injectYield(uint256 amount) public {
        amount = bound(amount, 1, 100_000 ether);

        token.mint(address(strategy), amount);
        vm.prank(owner);
        strategy.injectYield(amount);

        ghost_yieldInjected += amount;
    }

    function harvest() public {
        uint256 pending = strategy.pendingYield();
        if (pending == 0) return;

        vm.prank(vault);
        uint256 profit = strategy.harvest();

        ghost_harvested += profit;
    }
}

// ============ Invariant Tests ============

contract SimpleYieldStrategyInvariantTest is StdInvariant, Test {
    MockSYSInvToken token;
    SimpleYieldStrategy strategy;
    StrategyHandler handler;

    address vault = makeAddr("vault");

    function setUp() public {
        token = new MockSYSInvToken();
        strategy = new SimpleYieldStrategy(address(token), vault);

        handler = new StrategyHandler(strategy, token, vault, address(this));
        targetContract(address(handler));
    }

    // ============ Invariant: token conservation ============

    function invariant_tokenConservation() public view {
        uint256 inStrategy = token.balanceOf(address(strategy));
        uint256 inVault = token.balanceOf(vault);
        uint256 totalMinted = handler.ghost_deposited() + handler.ghost_yieldInjected();

        assertEq(inStrategy + inVault, totalMinted);
    }

    // ============ Invariant: totalAssets = deployed + pendingYield ============

    function invariant_totalAssetsEquation() public view {
        assertEq(strategy.totalAssets(), strategy.deployed() + strategy.pendingYield());
    }

    // ============ Invariant: strategy balance >= totalAssets ============

    function invariant_solvent() public view {
        assertGe(token.balanceOf(address(strategy)), strategy.totalAssets());
    }

    // ============ Invariant: ghost accounting matches ============

    function invariant_ghostAccounting() public view {
        uint256 totalIn = handler.ghost_deposited() + handler.ghost_yieldInjected();
        uint256 totalOut = handler.ghost_withdrawn() + handler.ghost_harvested();
        uint256 inStrategy = token.balanceOf(address(strategy));

        assertEq(totalIn - totalOut, inStrategy);
    }
}
