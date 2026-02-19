// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/StrategyVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockFuzzToken is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockFuzzStrategy is IStrategy {
    IERC20 private _asset;
    address private _vault;
    uint256 private _harvestProfit;

    constructor(address asset_, address vault_) {
        _asset = IERC20(asset_);
        _vault = vault_;
    }

    function asset() external view returns (address) { return address(_asset); }
    function vault() external view returns (address) { return _vault; }
    function totalAssets() external view returns (uint256) { return _asset.balanceOf(address(this)); }

    // Vault sends tokens via safeTransfer before calling deposit — this is just a notification
    function deposit(uint256) external {}

    function withdraw(uint256 amount) external returns (uint256) {
        uint256 bal = _asset.balanceOf(address(this));
        uint256 actual = amount > bal ? bal : amount;
        _asset.transfer(msg.sender, actual);
        return actual;
    }

    function harvest() external returns (uint256) {
        uint256 profit = _harvestProfit;
        if (profit > 0) {
            _harvestProfit = 0;
            _asset.transfer(_vault, profit);
        }
        return profit;
    }

    function emergencyWithdraw() external returns (uint256) {
        uint256 bal = _asset.balanceOf(address(this));
        _asset.transfer(_vault, bal);
        return bal;
    }

    function setHarvestProfit(uint256 p) external { _harvestProfit = p; }
    function simulateGain(address token, uint256 amount) external {
        MockFuzzToken(token).mint(address(this), amount);
    }
}

// ============ Fuzz Tests ============

contract StrategyVaultFuzzTest is Test {
    MockFuzzToken token;
    StrategyVault vault;
    MockFuzzStrategy strategy;

    address feeRecipient = makeAddr("feeRecipient");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        token = new MockFuzzToken();
        vault = new StrategyVault(
            IERC20(address(token)),
            "Vault Shares",
            "vUSDC",
            feeRecipient,
            0 // no deposit cap
        );

        strategy = new MockFuzzStrategy(address(token), address(vault));
        vault.proposeStrategy(address(strategy));
        vm.warp(block.timestamp + 2 days + 1);
        vault.activateStrategy();
    }

    // ============ Fuzz: deposit/withdraw symmetry ============

    function testFuzz_depositWithdraw(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000_000 ether);

        token.mint(alice, amount);
        vm.startPrank(alice);
        token.approve(address(vault), amount);
        uint256 shares = vault.deposit(amount, alice);

        uint256 withdrawn = vault.redeem(shares, alice, alice);
        vm.stopPrank();

        // Should get back exactly what was deposited (no yield, no fees)
        assertEq(withdrawn, amount);
    }

    // ============ Fuzz: multiple depositors share proportionally ============

    function testFuzz_proportionalShares(uint256 aliceAmt, uint256 bobAmt) public {
        aliceAmt = bound(aliceAmt, 1 ether, 1_000_000 ether);
        bobAmt = bound(bobAmt, 1 ether, 1_000_000 ether);

        token.mint(alice, aliceAmt);
        token.mint(bob, bobAmt);

        vm.prank(alice);
        token.approve(address(vault), aliceAmt);
        vm.prank(bob);
        token.approve(address(vault), bobAmt);

        vm.prank(alice);
        uint256 aliceShares = vault.deposit(aliceAmt, alice);
        vm.prank(bob);
        uint256 bobShares = vault.deposit(bobAmt, bob);

        // Shares proportional to deposits
        assertApproxEqRel(
            aliceShares * bobAmt,
            bobShares * aliceAmt,
            0.001e18 // 0.1% tolerance for rounding
        );
    }

    // ============ Fuzz: deposit cap enforcement ============

    function testFuzz_depositCap(uint256 cap, uint256 deposit1, uint256 deposit2) public {
        cap = bound(cap, 1 ether, 1_000_000 ether);
        deposit1 = bound(deposit1, 1, cap);
        deposit2 = bound(deposit2, 1, 1_000_000 ether);

        vault.setDepositCap(cap);

        token.mint(alice, deposit1 + deposit2);
        vm.startPrank(alice);
        token.approve(address(vault), deposit1 + deposit2);

        vault.deposit(deposit1, alice);

        if (deposit2 > cap - deposit1) {
            vm.expectRevert();
            vault.deposit(deposit2, alice);
        } else {
            vault.deposit(deposit2, alice);
            assertLe(vault.totalAssets(), cap);
        }
        vm.stopPrank();
    }

    // ============ Fuzz: totalAssets includes strategy ============

    function testFuzz_totalAssetsIncludesStrategy(uint256 depositAmt) public {
        depositAmt = bound(depositAmt, 1 ether, 1_000_000 ether);

        token.mint(alice, depositAmt);
        vm.startPrank(alice);
        token.approve(address(vault), depositAmt);
        vault.deposit(depositAmt, alice);
        vm.stopPrank();

        // totalAssets = vault idle + strategy balance
        uint256 vaultBal = token.balanceOf(address(vault));
        uint256 stratBal = token.balanceOf(address(strategy));
        assertEq(vault.totalAssets(), vaultBal + stratBal);
    }

    // ============ Fuzz: harvest fee calculation ============

    function testFuzz_harvestFees(uint256 depositAmt, uint256 profitAmt) public {
        depositAmt = bound(depositAmt, 10 ether, 1_000_000 ether);
        profitAmt = bound(profitAmt, 1 ether, depositAmt / 2);

        token.mint(alice, depositAmt);
        vm.startPrank(alice);
        token.approve(address(vault), depositAmt);
        vault.deposit(depositAmt, alice);
        vm.stopPrank();

        // Simulate profit: mint tokens to strategy and set harvest amount
        strategy.simulateGain(address(token), profitAmt);
        strategy.setHarvestProfit(profitAmt);

        // Warp for management fee accrual
        vm.warp(block.timestamp + 30 days);

        // Fee recipient receives asset tokens (not vault shares)
        uint256 feeRecipientBalBefore = token.balanceOf(feeRecipient);
        vault.harvest();
        uint256 feeRecipientBalAfter = token.balanceOf(feeRecipient);

        // Fee recipient should have received fee tokens
        assertGt(feeRecipientBalAfter, feeRecipientBalBefore);
    }

    // ============ Fuzz: fee BPS bounds ============

    function testFuzz_setFees(uint256 perfFee, uint256 mgmtFee) public {
        perfFee = bound(perfFee, 0, 5000);
        mgmtFee = bound(mgmtFee, 0, 1000);

        if (perfFee > 3000 || mgmtFee > 500) {
            vm.expectRevert(IStrategyVault.ExcessiveFee.selector);
            vault.setFees(perfFee, mgmtFee);
        } else {
            vault.setFees(perfFee, mgmtFee);
            assertEq(vault.performanceFeeBps(), perfFee);
            assertEq(vault.managementFeeBps(), mgmtFee);
        }
    }

    // ============ Fuzz: share price never decreases from deposits ============

    function testFuzz_sharePriceNonDecreasing(uint256 amt1, uint256 amt2) public {
        amt1 = bound(amt1, 1 ether, 1_000_000 ether);
        amt2 = bound(amt2, 1 ether, 1_000_000 ether);

        token.mint(alice, amt1);
        vm.startPrank(alice);
        token.approve(address(vault), amt1);
        vault.deposit(amt1, alice);
        vm.stopPrank();

        uint256 priceBefore = vault.totalAssets() * 1e18 / vault.totalSupply();

        token.mint(bob, amt2);
        vm.startPrank(bob);
        token.approve(address(vault), amt2);
        vault.deposit(amt2, bob);
        vm.stopPrank();

        uint256 priceAfter = vault.totalAssets() * 1e18 / vault.totalSupply();

        // Share price should not decrease from deposits
        assertGe(priceAfter, priceBefore - 1); // -1 for rounding
    }
}
